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

module.exports = router;
