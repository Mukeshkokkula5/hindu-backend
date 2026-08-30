const express = require("express");
const router = express.Router();
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

/* =====================================================
   ROLES
===================================================== */
const FINANCE_ROLES = [
  "TREASURER",
  "SUPER_ADMIN",
  "PRESIDENT",
  "VICE_PRESIDENT",
  "GENERAL_SECRETARY",
  "JOINT_SECRETARY",
  "EC_MEMBER",
  "AUDITOR",
];

/* =====================================================
   0️⃣ PUBLIC FUNDS (NO TOKEN REQUIRED)
   GET /contributions/funds
===================================================== */
router.get("/funds", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT fund_name as name FROM funds WHERE status = 'ACTIVE' ORDER BY id ASC`);
    res.json(rows.map(r => r.name));
  } catch (err) {
    console.error("FETCH FUNDS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load funds" });
  }
});

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
      const { title, category, fund_id, amount, receipt_date, description, donor_phone, member_id, target_member_id } = req.body;

      if (!title || !amount || amount <= 0 || !fund_id || !receipt_date) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const assignedMemberId = member_id || target_member_id || req.user.id;

      await client.query("BEGIN");

      // 1. Insert into contributions as PENDING
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
          donor_phone,
          qr_locked
        )
        VALUES ($1, $2, $3, $4, $5, 'CASH', $6, 'PENDING', $7, $8, true)
        RETURNING *
        `,
        [
          assignedMemberId,
          title,
          category || "DONATION",
          fund_id,
          amount,
          description || null,
          receipt_date,
          donor_phone || null,
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
          COALESCE(c.donor_phone, u.phone) AS phone,
          c.status,
          c.public_token
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


/* =====================================================
   7️⃣ DELETE CONTRIBUTION/DONATION
   DELETE /contributions/:id
===================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { id } = req.params;
      await pool.query("DELETE FROM contributions WHERE id = $1", [id]);
      res.json({ message: "Donation deleted successfully" });
    } catch (err) {
      console.error("DELETE CONTRIBUTION ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to delete donation" });
    }
  }
);

/* =====================================================
   8️⃣ UPDATE CONTRIBUTION/DONATION
   PUT /contributions/:id
===================================================== */
router.put(
  "/:id",
  verifyToken,
  checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, fund_id, amount, receipt_date, description, donor_phone } = req.body;
      
      await pool.query(
        `
        UPDATE contributions
        SET donor_name = $1,
            fund_id = $2,
            amount = $3,
            receipt_date = $4,
            payment_note = $5,
            donor_phone = $6
        WHERE id = $7
        `,
        [title, fund_id, amount, receipt_date, description, donor_phone, id]
      );
      res.json({ message: "Donation updated successfully" });
    } catch (err) {
      console.error("UPDATE CONTRIBUTION ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update donation" });
    }
  }
);

module.exports = router;
