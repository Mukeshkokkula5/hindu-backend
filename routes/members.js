const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const sendMail = require("../utils/sendMail");

const router = express.Router();

/* =====================================================
   1️⃣ GET ALL MEMBERS (USERS TABLE)
===================================================== */
router.get(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          id,
          member_id,
          name,
          username AS association_id,
          personal_email,
          phone,
          address,
          role,
          active,
          created_at
        FROM users
        WHERE role != 'SUPER_ADMIN'
        ORDER BY created_at DESC
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET MEMBERS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to fetch members" });
    }
  }
);

/* =====================================================
   2️⃣ ADD MEMBER (CREATE USER)
===================================================== */
router.post(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        member_id,
        name,
        association_id,
        personal_email,
        phone,
        address,
        role,
        password,
      } = req.body;

    const result = await pool.query(
  `
  INSERT INTO users
  (member_id, name, username, personal_email, phone, address, role, password, active)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
  RETURNING member_id, username
  `,
  [
    member_id,
    name,
    association_id,
    personal_email,
    phone,
    address,
    role,
    password,
  ]
);

const savedMemberId = result.rows[0].member_id;
const savedAssociationId = result.rows[0].username;

      // Optional welcome mail
      if (personal_email) {
        await sendMail(
          personal_email,
          "Welcome to Association System",
          `
          <h3>Hello ${name}</h3>
          <p>Your Association ID:</p>
          <b>${association_id}</b>
          <p>Please login and change your password.</p>
          `
        );
      }

      res.status(201).json({ message: "Member added successfully" });
    } catch (err) {
      console.error("ADD MEMBER ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to add member" });
    }
  }
);

/* =====================================================
   3️⃣ UPDATE MEMBER (DETAILS + ROLE + ACTIVE)
===================================================== */
router.put(
  "/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        name,
        personal_email,
        phone,
        address,
        role,
        active,
      } = req.body;

      const userId = Number(req.params.id);

      /* 🚨 ENFORCE SINGLE VICE PRESIDENT */
      if (role === "VICE_PRESIDENT") {
        const checkVP = await pool.query(
          `
          SELECT id
          FROM users
          WHERE role = 'VICE_PRESIDENT'
            AND id != $1
            AND active = true
          `,
          [userId]
        );

        if (checkVP.rowCount > 0) {
          return res.status(400).json({
            error: "Only one Vice President is allowed",
          });
        }
      }

      await pool.query(
        `
        UPDATE users
        SET
          name=$1,
          personal_email=$2,
          phone=$3,
          address=$4,
          role=$5,
          active=$6
        WHERE id=$7
        `,
        [
          name,
          personal_email,
          phone,
          address,
          role,
          active,
          userId,
        ]
      );

      res.json({ message: "Member updated successfully" });
    } catch (err) {
      console.error("UPDATE MEMBER ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update member" });
    }
  }
);

/* =====================================================
   4️⃣ ACTIVATE / DEACTIVATE MEMBER
===================================================== */
router.patch(
  "/:id/status",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      await pool.query(
        `UPDATE users SET active = NOT active WHERE id=$1`,
        [req.params.id]
      );

      res.json({ message: "Status updated" });
    } catch (err) {
      console.error("STATUS UPDATE ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update status" });
    }
  }
);

/* =====================================================
   5️⃣ DELETE MEMBER (SUPER_ADMIN ONLY)
===================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    try {
      await pool.query(`DELETE FROM users WHERE id=$1`, [
        req.params.id,
      ]);

      res.json({ message: "Member deleted successfully" });
    } catch (err) {
      console.error("DELETE MEMBER ERROR 👉", err.message);
      res.status(500).json({ error: "Delete failed" });
    }
  }
);

/* =====================================================
   6️⃣ RESEND LOGIN DETAILS
===================================================== */
router.post(
  "/resend-login/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        SELECT name, username AS association_id, personal_email
        FROM users
        WHERE id=$1
        `,
        [req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Member not found" });
      }

      const u = result.rows[0];

      if (!u.personal_email) {
        return res
          .status(400)
          .json({ error: "Member email not available" });
      }

      await sendMail(
        u.personal_email,
        "Association Login Details",
        `
        <h3>Hello ${u.name}</h3>
        <p>Your login ID:</p>
        <b>${u.association_id}</b>
        <p>Please use your existing password.</p>
        `
      );

      res.json({ message: "Login details sent" });
    } catch (err) {
      console.error("RESEND LOGIN ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to send login details" });
    }
  }
);

/* =====================================================
   7️⃣ MEMBER DASHBOARD (SELF)
===================================================== */
router.get(
  "/dashboard",
  verifyToken,
  async (req, res) => {
    try {
      const memberId = req.user.member_id;

      const profile = await pool.query(
        `
        SELECT
          name,
          member_id,
          username AS association_id,
          role
        FROM users
        WHERE member_id=$1
        `,
        [memberId]
      );

      const stats = await pool.query(
        `
        SELECT
          COUNT(*) AS total_contributions,
          COALESCE(SUM(amount),0) AS total_amount
        FROM contributions
        WHERE member_id=$1
          AND status='APPROVED'
        `,
        [memberId]
      );

      const recent = await pool.query(
        `
        SELECT fund_name, amount, status, receipt_no
        FROM contributions
        WHERE member_id=$1
        ORDER BY created_at DESC
        LIMIT 5
        `,
        [memberId]
      );

      res.json({
        profile: profile.rows[0],
        stats: stats.rows[0],
        recent_contributions: recent.rows,
      });
    } catch (err) {
      console.error("MEMBER DASHBOARD ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  }
);
/* =====================================================
   💰 MEMBER CONTRIBUTIONS (SELF DASHBOARD)
===================================================== */
router.get(
  "/contributions",
  verifyToken,
  async (req, res) => {
    try {
      const memberId = req.user.member_id;

      const result = await pool.query(
        `
        SELECT
          receipt_no,
          fund_name,
          amount,
          status,
          created_at
        FROM contributions
        WHERE member_id = $1
        ORDER BY created_at DESC
        `,
        [memberId]
      );

      res.json(result.rows);
    } catch (err) {
      console.error("MEMBER CONTRIBUTIONS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load contributions" });
    }
  }
);
module.exports = router;
