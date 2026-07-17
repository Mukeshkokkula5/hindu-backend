const express = require("express");
const router = express.Router();
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

/* =========================
   ROLE CONSTANTS
========================= */
const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  PRESIDENT: "PRESIDENT",
  VICE_PRESIDENT: "VICE_PRESIDENT",
  GENERAL_SECRETARY: "GENERAL_SECRETARY",
  JOINT_SECRETARY: "JOINT_SECRETARY",
  TREASURER: "TREASURER",
  EC_MEMBER: "EC_MEMBER",
  MEMBER: "MEMBER",
};

/* =====================================================
   🔵 ADMIN / OFFICE BEARERS SUMMARY
   GET /dashboard/admin-summary
===================================================== */
router.get(
  "/admin-summary",
  verifyToken,
  checkRole(
    ROLES.SUPER_ADMIN,
    ROLES.PRESIDENT,
    ROLES.VICE_PRESIDENT,
    ROLES.GENERAL_SECRETARY,
    ROLES.JOINT_SECRETARY,
    ROLES.EC_MEMBER
  ),
  async (req, res) => {
    try {
      const [members, approved, cancelled] = await Promise.all([
        pool.query("SELECT COUNT(*) FROM users WHERE active=true"),
        pool.query(`
          SELECT COUNT(*) AS count, COALESCE(SUM(amount),0) AS total
          FROM contributions
          WHERE status='APPROVED'
        `),
        pool.query(
          "SELECT COUNT(*) FROM contributions WHERE status='CANCELLED'"
        ),
      ]);

      res.json({
        success: true,
        data: {
          total_members: Number(members.rows[0].count),
          approved_receipts: Number(approved.rows[0].count),
          total_collection: Number(approved.rows[0].total),
          cancelled_receipts: Number(cancelled.rows[0].count),
        },
      });
    } catch (err) {
      console.error("ADMIN SUMMARY ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Admin dashboard failed" });
    }
  }
);

/* =====================================================
   🧾 RECENT CONTRIBUTIONS
   GET /dashboard/recent-contributions
===================================================== */
router.get(
  "/recent-contributions",
  verifyToken,
  checkRole(
    ROLES.SUPER_ADMIN,
    ROLES.PRESIDENT,
    ROLES.VICE_PRESIDENT,
    ROLES.GENERAL_SECRETARY,
    ROLES.JOINT_SECRETARY,
    ROLES.EC_MEMBER
  ),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          c.receipt_no,
          c.amount,
          c.receipt_date,
          u.name AS member_name
        FROM contributions c
        JOIN users u ON u.id = c.member_id
        WHERE c.status='APPROVED'
        ORDER BY c.receipt_date DESC
        LIMIT 5
      `);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("RECENT ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to load recent receipts" });
    }
  }
);

/* =====================================================
   💰 FUND BALANCES
   GET /dashboard/funds
===================================================== */
router.get(
  "/funds",
  verifyToken,
  checkRole(
    ROLES.SUPER_ADMIN,
    ROLES.PRESIDENT,
    ROLES.VICE_PRESIDENT,
    ROLES.GENERAL_SECRETARY,
    ROLES.JOINT_SECRETARY,
    ROLES.TREASURER,
    ROLES.EC_MEMBER
  ),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          f.id,
          f.fund_name,
          COALESCE(l.balance_after,0) AS balance
        FROM funds f
        LEFT JOIN LATERAL (
          SELECT balance_after
          FROM ledger
          WHERE fund_id = f.id
          ORDER BY id DESC
          LIMIT 1
        ) l ON true
        WHERE f.status='ACTIVE'
        ORDER BY f.fund_name
      `);

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("FUNDS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to load funds" });
    }
  }
);

/* =====================================================
   📈 CASHFLOW
   GET /dashboard/cashflow?year=2025&month=9
===================================================== */
router.get(
  "/cashflow",
  verifyToken,
  checkRole(
    ROLES.SUPER_ADMIN,
    ROLES.PRESIDENT,
    ROLES.VICE_PRESIDENT,
    ROLES.GENERAL_SECRETARY,
    ROLES.JOINT_SECRETARY
  ),
  async (req, res) => {
    try {
      const { year, month } = req.query;
      if (!year || !month) {
        return res.status(400).json({ success: false, error: "year & month required" });
      }

      const result = await pool.query(
        `
        SELECT
          SUM(CASE WHEN entry_type='CREDIT' THEN amount ELSE 0 END) AS total_credit,
          SUM(CASE WHEN entry_type='DEBIT' THEN amount ELSE 0 END) AS total_debit
        FROM ledger
        WHERE EXTRACT(YEAR FROM created_at)=$1
          AND EXTRACT(MONTH FROM created_at)=$2
        `,
        [year, month]
      );

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (err) {
      console.error("CASHFLOW ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Cashflow failed" });
    }
  }
);

/* =====================================================
   🟠 TREASURER SUMMARY
   GET /dashboard/treasurer-summary
===================================================== */
router.get(
  "/treasurer-summary",
  verifyToken,
  checkRole(ROLES.TREASURER),
  async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*) FROM contributions WHERE status='PENDING') AS pending_contributions,
          (SELECT COUNT(*) FROM contributions WHERE status='APPROVED') AS approved_contributions
      `);

      res.json({
        success: true,
        data: result.rows[0],
      });
    } catch (err) {
      console.error("TREASURER SUMMARY ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Treasurer dashboard failed" });
    }
  }
);

/* =====================================================
   🟣 MEMBER DASHBOARD
   GET /dashboard/member
===================================================== */
router.get(
  "/member",
  verifyToken,
  checkRole(ROLES.MEMBER),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT
          receipt_no,
          amount,
          status,
          receipt_date
        FROM contributions
        WHERE member_id=$1
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("MEMBER DASHBOARD ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Member dashboard failed" });
    }
  }
);

module.exports = router;
