const express = require("express");
const router = express.Router();
const pool = require("../db");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const logAudit = require("../utils/auditLogger");
const isYearClosed = require("../utils/isYearClosed");

// Ensure upload directory for bills
const isProd = process.env.VERCEL || process.env.NODE_ENV === "production";
const uploadDir = isProd ? "/tmp" : path.join(__dirname, "..", "uploads", "bills");

if (!isProd) {
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Expenses upload dir init notice:", e.message);
  }
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `bill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/* =====================================================
   📎 UPLOAD BILL / VOUCHER RECEIPT
   POST /expenses/upload-bill
   ✔ SUPER_ADMIN / PRESIDENT / TREASURER
===================================================== */
router.post(
  "/upload-bill",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  upload.single("bill"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No bill/receipt file uploaded" });
      }
      let fileUrl = `/uploads/bills/${req.file.filename}`;
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        if (req.file.path && fs.existsSync(req.file.path)) {
          const b64 = fs.readFileSync(req.file.path).toString("base64");
          const ext = path.extname(req.file.originalname || "").toLowerCase();
          const mime = req.file.mimetype || (ext === ".pdf" ? "application/pdf" : "image/jpeg");
          fileUrl = `data:${mime};base64,${b64}`;
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
        }
      }
      res.json({
        success: true,
        fileUrl,
        url: fileUrl,
        imageUrl: fileUrl,
        photo_url: fileUrl,
        filename: req.file.filename,
      });
    } catch (err) {
      console.error("BILL UPLOAD ERROR 👉", err.message);
      res.status(500).json({ error: "Bill upload failed" });
    }
  }
);

/* =====================================================
   ➕ CREATE EXPENSE & SUBMIT BILL (REQUEST)
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
        bill_url,
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
          bill_url,
          status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')
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
          bill_url || null,
        ]
      );

      await logAudit(
        "CREATE",
        "EXPENSE",
        result.rows[0].id,
        req.user.id
      );

      res.status(201).json({
        message: "Expense & Bill submitted successfully (pending approval)",
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
   ✔ SUPER_ADMIN / PRESIDENT / VICE_PRESIDENT / GENERAL_SECRETARY / TREASURER / EC_MEMBER
===================================================== */
router.get(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "VICE_PRESIDENT", "GENERAL_SECRETARY", "TREASURER", "EC_MEMBER"),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          e.*,
          u.name AS requested_by_name,
          u.role AS requested_by_role,
          passer.name AS passed_by_name,
          passer.role AS passed_by_role,
          approver.name AS approved_by_name,
          approver.role AS approved_by_role,
          f.fund_name
        FROM expenses e
        LEFT JOIN users u ON u.id = e.requested_by
        LEFT JOIN users passer ON passer.id = e.passed_by
        LEFT JOIN users approver ON approver.id = e.approved_by
        LEFT JOIN funds f ON f.id = e.fund_id
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
   🔍 VERIFY & PASS EXPENSE BILL (GENERAL SECRETARY / VP)
   PUT /expenses/:id/pass
   ✔ GENERAL_SECRETARY / VICE_PRESIDENT / SUPER_ADMIN / PRESIDENT
===================================================== */
router.put(
  "/:id/pass",
  verifyToken,
  checkRole("GENERAL_SECRETARY", "VICE_PRESIDENT", "SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const expenseId = Number(req.params.id);
      const passedBy = req.user.id;
      const { notes } = req.body;

      const expRes = await pool.query("SELECT * FROM expenses WHERE id=$1", [expenseId]);
      if (!expRes.rowCount) {
        return res.status(404).json({ error: "Expense not found" });
      }

      const expense = expRes.rows[0];
      if (expense.status !== "PENDING") {
        return res.status(400).json({ error: `Only PENDING expenses can be passed (current: ${expense.status})` });
      }

      await pool.query(
        `UPDATE expenses
         SET status = 'PASSED_BY_GS',
             passed_by = $1,
             passed_at = NOW(),
             passed_notes = $2
         WHERE id = $3`,
        [passedBy, notes || "Verified & Passed by General Secretary for President Approval", expenseId]
      );

      await logAudit("PASS", "EXPENSE", expenseId, passedBy);

      res.json({
        success: true,
        message: "Expense bill verified and passed to President for final approval",
      });
    } catch (err) {
      console.error("PASS EXPENSE ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to pass expense: " + err.message });
    }
  }
);

/* =====================================================
   ✏️ UPDATE / CORRECT EXPENSE RECORD
   PUT /expenses/:id
   ✔ SUPER_ADMIN / PRESIDENT / TREASURER
===================================================== */
router.put(
  "/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const expenseId = Number(req.params.id);
      const {
        title,
        category,
        description,
        amount,
        expense_date,
        fund_id,
        bill_url,
      } = req.body;

      const expRes = await pool.query("SELECT * FROM expenses WHERE id=$1", [expenseId]);
      if (!expRes.rowCount) {
        return res.status(404).json({ error: "Expense not found" });
      }

      const expense = expRes.rows[0];

      // Non-admins can edit PENDING or PASSED_BY_GS expenses, or re-attach/update bill on APPROVED expenses
      const isFullAdmin = req.user.role === "SUPER_ADMIN" || req.user.role === "PRESIDENT";
      const isOnlyUpdatingBill = bill_url !== undefined && !amount && !title && !fund_id;
      if (!isFullAdmin && expense.status !== "PENDING" && expense.status !== "PASSED_BY_GS" && !isOnlyUpdatingBill) {
        return res.status(403).json({ error: "Only PENDING or PASSED expenses can be edited by Treasurer" });
      }

      const updatedTitle = title || expense.title;
      const updatedCategory = category !== undefined ? category : expense.category;
      const updatedDesc = description !== undefined ? description : expense.description;
      const updatedAmount = amount ? Number(amount) : expense.amount;
      const updatedDate = expense_date || expense.expense_date;
      const updatedFundId = fund_id ? Number(fund_id) : expense.fund_id;
      const updatedBillUrl = bill_url !== undefined ? bill_url : expense.bill_url;

      const result = await pool.query(
        `
        UPDATE expenses
        SET
          title = $1,
          category = $2,
          description = $3,
          amount = $4,
          expense_date = $5,
          fund_id = $6,
          bill_url = $7
        WHERE id = $8
        RETURNING *
        `,
        [
          updatedTitle,
          updatedCategory,
          updatedDesc,
          updatedAmount,
          updatedDate,
          updatedFundId,
          updatedBillUrl,
          expenseId,
        ]
      );

      await logAudit(
        "UPDATE",
        "EXPENSE",
        expenseId,
        req.user.id
      );

      res.json({
        success: true,
        message: "Expense updated and corrected successfully",
        expense: result.rows[0],
      });
    } catch (err) {
      console.error("UPDATE EXPENSE ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update expense: " + err.message });
    }
  }
);

/* =====================================================
   🗑️ DELETE PENDING EXPENSE
   DELETE /expenses/:id
   ✔ SUPER_ADMIN / PRESIDENT
===================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const expenseId = Number(req.params.id);
      const expRes = await pool.query("SELECT * FROM expenses WHERE id=$1", [expenseId]);
      if (!expRes.rowCount) {
        return res.status(404).json({ error: "Expense not found" });
      }

      if (expRes.rows[0].status === "APPROVED") {
        return res.status(400).json({ error: "Approved expenses cannot be deleted, must be cancelled with reversal" });
      }

      await pool.query("DELETE FROM expenses WHERE id=$1", [expenseId]);
      await logAudit("DELETE", "EXPENSE", expenseId, req.user.id);

      res.json({ success: true, message: "Expense record deleted successfully" });
    } catch (err) {
      console.error("DELETE EXPENSE ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to delete expense" });
    }
  }
);

/* =====================================================
   ✅ APPROVE EXPENSE (LEDGER DEBIT)
   PUT /expenses/:id/approve
   ✔ SUPER_ADMIN / PRESIDENT
===================================================== */
router.put(
  "/:id/approve",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
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

      if (expense.status !== "PENDING" && expense.status !== "PASSED_BY_GS") {
        throw new Error("Only PENDING or PASSED_BY_GS expenses can be approved");
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

      const currentBalance =
        balRes.rows.length > 0 ? Number(balRes.rows[0].balance) : 0;

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
        (balRes.rows.length > 0 ? Number(balRes.rows[0].balance_after) : 0) + Number(expense.amount);

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
