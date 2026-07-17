const express = require("express");
const router = express.Router();
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const logAudit = require("../utils/auditLogger");
const isYearClosed = require("../utils/isYearClosed");

/* =====================================================
   ➕ CREATE EXPENSE (REQUEST)
   POST /expenses
   ✔ SUPER_ADMIN / PRESIDENT / TREASURER
===================================================== */
router.post(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const {
        title,
        category,
        description,
        amount,
        expense_date,
        fund_id,
      } = req.body;

      if (!title || !amount || !expense_date || !fund_id) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (amount <= 0) {
        return res.status(400).json({ error: "Invalid amount" });
      }

      const year = new Date(expense_date).getFullYear();
      if (await isYearClosed(year)) {
        return res.status(400).json({ error: "Financial year closed" });
      }

      const result = await pool.query(
        `
        INSERT INTO expenses
        (
          title,
          category,
          description,
          amount,
          expense_date,
          fund_id,
          requested_by,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING')
        RETURNING *
        `,
        [
          title,
          category || null,
          description || null,
          amount,
          expense_date,
          fund_id,
          req.user.id,
        ]
      );

      await logAudit(
        "CREATE",
        "EXPENSE",
        result.rows[0].id,
        req.user.id
      );

      res.status(201).json({
        message: "Expense created (pending approval)",
        expense: result.rows[0],
      });
    } catch (err) {
      console.error("CREATE EXPENSE ERROR 👉", err.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* =====================================================
   📋 GET ALL EXPENSES
   GET /expenses
   ✔ SUPER_ADMIN / PRESIDENT / TREASURER
===================================================== */
router.get(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          e.*,
          u.name AS requested_by_name
        FROM expenses e
        JOIN users u ON u.id = e.requested_by
        ORDER BY e.created_at DESC
      `);

      res.json(result.rows);
    } catch (err) {
      console.error("GET EXPENSES ERROR 👉", err.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* =====================================================
   ✅ APPROVE EXPENSE (LEDGER DEBIT)
   PUT /expenses/:id/approve
   ✔ SUPER_ADMIN ONLY
===================================================== */
router.put(
  "/:id/approve",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const expenseId = Number(req.params.id);
      const approvedBy = req.user.id;

      await client.query("BEGIN");

      const expRes = await client.query(
        `SELECT * FROM expenses WHERE id=$1 FOR UPDATE`,
        [expenseId]
      );

      if (!expRes.rowCount) throw new Error("Expense not found");

      const expense = expRes.rows[0];

      if (expense.status !== "PENDING") {
        throw new Error("Only PENDING expenses can be approved");
      }

      const year = new Date(expense.expense_date).getFullYear();
      if (await isYearClosed(year)) {
        throw new Error("Financial year closed");
      }

      const balRes = await client.query(
        `
        SELECT COALESCE(balance_after,0) AS balance
        FROM ledger
        WHERE fund_id=$1
        ORDER BY id DESC
        LIMIT 1
        `,
        [expense.fund_id]
      );

      const currentBalance = Number(balRes.rows[0].balance);

      if (currentBalance < expense.amount) {
        throw new Error("Insufficient fund balance");
      }

      const newBalance = currentBalance - Number(expense.amount);

      await client.query(
        `
        UPDATE expenses
        SET
          status='APPROVED',
          approved_by=$1,
          approved_at=NOW()
        WHERE id=$2
        `,
        [approvedBy, expenseId]
      );

      await client.query(
        `
        INSERT INTO ledger
        (
          entry_type,
          source,
          source_id,
          fund_id,
          amount,
          balance_after,
          created_by
        )
        VALUES
        ('DEBIT','EXPENSE',$1,$2,$3,$4,$5)
        `,
        [
          expenseId,
          expense.fund_id,
          expense.amount,
          newBalance,
          approvedBy,
        ]
      );

      await logAudit(
        "APPROVE",
        "EXPENSE",
        expenseId,
        approvedBy
      );

      await client.query("COMMIT");

      res.json({
        message: "Expense approved successfully",
        balance_after: newBalance,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("APPROVE EXPENSE ERROR 👉", err.message);
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   🔁 CANCEL APPROVED EXPENSE (REVERSAL)
   PUT /expenses/:id/cancel
   ✔ SUPER_ADMIN ONLY
===================================================== */
router.put(
  "/:id/cancel",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const expenseId = Number(req.params.id);
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: "Cancel reason required" });
      }

      await client.query("BEGIN");

      const expRes = await client.query(
        `SELECT * FROM expenses WHERE id=$1 FOR UPDATE`,
        [expenseId]
      );

      if (!expRes.rowCount) throw new Error("Expense not found");

      const expense = expRes.rows[0];

      if (expense.status !== "APPROVED") {
        throw new Error("Only APPROVED expenses can be cancelled");
      }

      const year = new Date(expense.expense_date).getFullYear();
      if (await isYearClosed(year)) {
        throw new Error("Financial year closed");
      }

      const balRes = await client.query(
        `
        SELECT balance_after
        FROM ledger
        WHERE fund_id=$1
        ORDER BY id DESC
        LIMIT 1
        `,
        [expense.fund_id]
      );

      const newBalance =
        Number(balRes.rows[0].balance_after) + Number(expense.amount);

      await client.query(
        `
        UPDATE expenses
        SET
          status='CANCELLED',
          cancelled_by=$1,
          cancelled_at=NOW(),
          cancel_reason=$2
        WHERE id=$3
        `,
        [req.user.id, reason, expenseId]
      );

      await client.query(
        `
        INSERT INTO ledger
        (
          entry_type,
          source,
          source_id,
          fund_id,
          amount,
          balance_after,
          created_by
        )
        VALUES
        ('CREDIT','EXPENSE_REVERSAL',$1,$2,$3,$4,$5)
        `,
        [
          expenseId,
          expense.fund_id,
          expense.amount,
          newBalance,
          req.user.id,
        ]
      );

      await logAudit(
        "CANCEL",
        "EXPENSE",
        expenseId,
        req.user.id
      );

      await client.query("COMMIT");

      res.json({
        message: "Expense cancelled and reversed",
        balance_after: newBalance,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("CANCEL EXPENSE ERROR 👉", err.message);
      res.status(400).json({ error: err.message });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
