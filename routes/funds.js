const express = require("express");
const router = express.Router();
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const logAudit = require("../utils/auditLogger");
const isYearClosed = require("../utils/isYearClosed");

/* =====================================================
   🔹 GET ALL FUNDS (ADMIN / DASHBOARD)
   ✔ Ledger-driven balance
===================================================== */
router.get(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "VICE_PRESIDENT", "GENERAL_SECRETARY", "TREASURER", "EC_MEMBER"),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          f.id,
          f.fund_name,
          f.fund_type,
          f.base_amount,
          f.status,

          COALESCE((
            SELECT l.balance_after
            FROM ledger l
            WHERE l.fund_id = f.id
            ORDER BY l.id DESC
            LIMIT 1
          ), 0) AS balance,

          COALESCE((
            SELECT SUM(l.amount)
            FROM ledger l
            WHERE l.fund_id = f.id
              AND l.entry_type = 'CREDIT'
          ), 0) AS total_collection

        FROM funds f
        ORDER BY f.id DESC
      `);

      res.json(result.rows);
    } catch (err) {
      console.error("GET FUNDS ERROR 👉", err.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* =====================================================
   ➕ ADD FUND (SUPER_ADMIN / PRESIDENT)
===================================================== */
router.post(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { fund_name, fund_type, description, base_amount } = req.body;

      if (!fund_name || !fund_type) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const parsedBaseAmount = base_amount !== undefined ? Number(base_amount) : 
        (description && description.startsWith("Base Amount: ") ? Number(description.replace("Base Amount: ", "")) : 0);

      await client.query("BEGIN");

      const result = await client.query(
        `
        INSERT INTO funds (fund_name, fund_type, description, base_amount, status)
        VALUES ($1, $2, $3, $4, 'ACTIVE')
        RETURNING *
        `,
        [fund_name, fund_type, description || null, parsedBaseAmount]
      );

      const newFund = result.rows[0];

      // Automatically credit initial starting balance to ledger if base_amount > 0
      if (parsedBaseAmount > 0) {
        await client.query(
          `
          INSERT INTO ledger (entry_type, source, source_id, fund_id, amount, balance_after, created_by)
          VALUES ('CREDIT', 'INITIAL_BALANCE', $1, $2, $3, $4, $5)
          `,
          [newFund.id, newFund.id, parsedBaseAmount, parsedBaseAmount, req.user.id]
        );
      }

      await client.query("COMMIT");

      const logAudit = require("../utils/auditLogger");
      await logAudit("CREATE", "FUND", newFund.id, req.user.id);
      res.status(201).json(newFund);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("ADD FUND ERROR 👉", err.message);
      res.status(500).json({ error: "Server error: " + err.message });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   🔄 ENABLE / DISABLE FUND
===================================================== */
router.patch(
  "/:id/toggle",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE funds
        SET status = CASE
          WHEN status = 'ACTIVE' THEN 'INACTIVE'
          ELSE 'ACTIVE'
        END
        WHERE id = $1
        RETURNING *
        `,
        [req.params.id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: "Fund not found" });
      }

      await logAudit("UPDATE", "FUND_STATUS", req.params.id, req.user.id);
      res.json(result.rows[0]);
    } catch (err) {
      console.error("TOGGLE FUND ERROR 👉", err.message);
      res.status(500).json({ error: "Server error" });
    }
  }
);

/* =====================================================
   📋 ACTIVE FUNDS (ALL USERS – FOR CONTRIBUTION)
===================================================== */
router.get("/list", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        f.id,
        f.fund_name,
        COALESCE((
          SELECT l.balance_after
          FROM ledger l
          WHERE l.fund_id = f.id
          ORDER BY l.id DESC
          LIMIT 1
        ), 0) AS balance
      FROM funds f
      WHERE f.status = 'ACTIVE'
      ORDER BY f.fund_name
    `);

    res.json({ funds: result.rows });
  } catch (err) {
    console.error("FUND LIST ERROR 👉", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   🗑️ DELETE FUND (SUPER_ADMIN – HARD DELETE)
===================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const fundId = req.params.id;

      // Check if any expenses are linked to this fund
      const expCheck = await pool.query(
        "SELECT COUNT(*) FROM expenses WHERE fund_id = $1",
        [fundId]
      );
      if (parseInt(expCheck.rows[0].count, 10) > 0) {
        return res.status(400).json({
          error: "Cannot delete this fund because expenses are linked to it. Please deactivate the fund instead.",
        });
      }

      // Remove all ledger entries first
      await pool.query("DELETE FROM ledger WHERE fund_id = $1", [fundId]);

      // Remove all contributions linked to this fund
      await pool.query("DELETE FROM contributions WHERE fund_id = $1", [fundId]);

      // Now delete the fund
      const result = await pool.query(
        "DELETE FROM funds WHERE id = $1 RETURNING *",
        [fundId]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: "Fund not found" });
      }

      await logAudit("DELETE", "FUND", fundId, req.user.id);

      res.json({ message: "Fund deleted permanently" });
    } catch (err) {
      console.error("DELETE FUND ERROR 👉", err.message);
      res.status(500).json({ error: "Server error: " + err.message });
    }
  }
);

/* =====================================================
   💰 CREATE CONTRIBUTION (ALL ROLES)
   ✔ Approval via treasurer.js
===================================================== */
router.post("/contribute", verifyToken, async (req, res) => {
  try {
    const year = new Date().getFullYear();
    if (await isYearClosed(year)) {
      return res.status(400).json({ error: "Financial year closed" });
    }

    const { fund_id, amount, payment_mode, reference_no, note } = req.body;

    if (!fund_id || !amount || !payment_mode) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await pool.query(
      `
      INSERT INTO contributions
        (fund_id, member_id, amount, payment_mode, reference_no, payment_note, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, 'PENDING')
      RETURNING *
      `,
      [
        fund_id,
        req.user.id,
        amount,
        payment_mode,
        reference_no || null,
        note || null,
      ]
    );

    await logAudit(
      "CREATE",
      "CONTRIBUTION",
      result.rows[0].id,
      req.user.id,
      { amount }
    );

    res.status(201).json({
      message: "Contribution submitted successfully",
      contribution: result.rows[0],
    });
  } catch (err) {
    console.error("CONTRIBUTION ERROR 👉", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/* =====================================================
   📜 MY CONTRIBUTIONS (ALL USERS)
===================================================== */
router.get("/my-contributions", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        c.id,
        f.fund_name,
        c.amount,
        c.payment_mode,
        c.reference_no,
        c.status,
        c.created_at,
        c.receipt_no,
        c.receipt_date
      FROM contributions c
      JOIN funds f ON f.id = c.fund_id
      WHERE c.member_id = $1
      ORDER BY c.created_at DESC
      `,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("MY CONTRIBUTIONS ERROR 👉", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
