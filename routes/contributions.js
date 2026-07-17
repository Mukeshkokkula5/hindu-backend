const express = require("express");
const router = express.Router();
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

/* =====================================================
   ROLES
===================================================== */
const FINANCE_ROLES = ["TREASURER", "SUPER_ADMIN", "PRESIDENT"];

/* =====================================================
   1️⃣ CREATE CONTRIBUTION (ALL LOGGED-IN USERS)
   POST /contributions/submit
===================================================== */
router.post("/submit", verifyToken, async (req, res) => {
  try {
    const { fund_id, amount, payment_mode, reference_no } = req.body;

    if (!fund_id || !amount || amount <= 0 || !payment_mode) {
      return res.status(400).json({ error: "Missing / invalid fields" });
    }

    await pool.query(
      `
      INSERT INTO contributions
        (fund_id, member_id, amount, payment_mode, reference_no, status)
      VALUES
        ($1, $2, $3, $4, $5, 'PENDING')
      `,
      [
        fund_id,
        req.user.id,
        amount,
        payment_mode,
        reference_no || null,
      ]
    );

    res.status(201).json({ message: "Contribution submitted (Pending approval)" });
  } catch (err) {
    console.error("SUBMIT CONTRIBUTION ERROR 👉", err.message);
    res.status(500).json({ error: "Contribution failed" });
  }
});

/* =====================================================
   2️⃣ MY CONTRIBUTIONS (ALL USERS)
   GET /contributions/my
===================================================== */
router.get("/my", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
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

    res.json(rows);
  } catch (err) {
    console.error("MY CONTRIBUTIONS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load contributions" });
  }
});

/* =====================================================
   3️⃣ ALL CONTRIBUTIONS (TREASURER / ADMIN)
   GET /contributions/all
===================================================== */
router.get(
  "/all",
  verifyToken,
  checkRole(...FINANCE_ROLES),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          c.id,
          u.name AS member_name,
          f.fund_name,
          c.amount,
          c.payment_mode,
          c.reference_no,
          c.status,
          c.created_at,
          c.receipt_no
        FROM contributions c
        JOIN users u ON u.id = c.member_id
        JOIN funds f ON f.id = c.fund_id
        ORDER BY c.created_at DESC
        `
      );

      res.json(rows);
    } catch (err) {
      console.error("ALL CONTRIBUTIONS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load contributions" });
    }
  }
);

/* =====================================================
   4️⃣ DASHBOARD SUMMARY (ROLE BASED)
   GET /contributions/dashboard
===================================================== */
router.get("/dashboard", verifyToken, async (req, res) => {
  try {
    let query, params = [];

    if (FINANCE_ROLES.includes(req.user.role)) {
      query = `
        SELECT
          COUNT(*)::int AS total_count,
          COALESCE(SUM(amount),0) AS total_amount
        FROM contributions
        WHERE status='APPROVED'
      `;
    } else {
      query = `
        SELECT
          COUNT(*)::int AS total_count,
          COALESCE(SUM(amount),0) AS total_amount
        FROM contributions
        WHERE member_id=$1 AND status='APPROVED'
      `;
      params = [req.user.id];
    }

    const { rows } = await pool.query(query, params);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Dashboard load failed" });
  }
});

/* =====================================================
   5️⃣ RECORD DONATION DIRECTLY (ADMIN RECORD)
   POST /contributions/admin
   ✔ TREASURER / SUPER_ADMIN / PRESIDENT
===================================================== */
router.post(
  "/admin",
  verifyToken,
  checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { title, category, fund_id, amount, receipt_date, description } = req.body;

      if (!title || !amount || amount <= 0 || !fund_id || !receipt_date) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      await client.query("BEGIN");

      // 1. Insert into contributions as PENDING, storing admin's ID as member_id (who created it)
      const contRes = await client.query(
        `
        INSERT INTO contributions (
          member_id,
          donor_name,
          source,
          fund_id,
          amount,
          payment_mode,
          payment_note,
          status,
          receipt_date,
          qr_locked
        )
        VALUES ($1, $2, $3, $4, $5, 'CASH', $6, 'PENDING', $7, true)
        RETURNING *
        `,
        [
          req.user.id,
          title,
          category || "DONATION",
          fund_id,
          amount,
          description || null,
          receipt_date,
        ]
      );

      const contribution = contRes.rows[0];

      // 2. Log audit log
      const logAudit = require("../utils/auditLogger");
      await logAudit("CREATE", "DONATION", contribution.id, req.user.id);

      await client.query("COMMIT");

      res.status(201).json({
        message: "Donation recorded successfully (Pending approval)",
        contribution,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("ADMIN RECORD CONTRIBUTION ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to record donation: " + err.message });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   6️⃣ GET ALL DONATIONS/CONTRIBUTIONS LIST
   GET /contributions/admin-list
   ✔ TREASURER / SUPER_ADMIN / PRESIDENT
===================================================== */
router.get(
  "/admin-list",
  verifyToken,
  checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT 
          c.id,
          c.receipt_date AS date,
          COALESCE(c.donor_name, u.name) AS title,
          c.source AS category,
          f.fund_name,
          c.amount,
          c.payment_note AS desc,
          c.status
        FROM contributions c
        LEFT JOIN users u ON u.id = c.member_id
        LEFT JOIN funds f ON f.id = c.fund_id
        ORDER BY c.receipt_date DESC, c.id DESC
        `
      );
      res.json(rows);
    } catch (err) {
      console.error("ADMIN GET CONTRIBUTIONS LIST ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load donations list" });
    }
  }
);

module.exports = router;
