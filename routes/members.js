const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const bcrypt = require("bcryptjs");
const sendMail = require("../utils/sendMail");
const logAudit = require("../utils/auditLogger");
const { addMemberTemplate, resendLoginTemplate } = require("../utils/emailTemplates");

const router = express.Router();

function generateRandomMemberPassword() {
  const prefix = "HSY@";
  const num = Math.floor(1000 + Math.random() * 9000);
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 2; i++) {
    suffix += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return `${prefix}${num}${suffix}`;
}

/* =====================================================
   1️⃣ GET ALL MEMBERS (USERS TABLE)
===================================================== */
router.get(
  "/",
  verifyToken,
  checkRole(
    "SUPER_ADMIN",
    "PRESIDENT",
    "VICE_PRESIDENT",
    "GENERAL_SECRETARY",
    "JOINT_SECRETARY",
    "TREASURER",
    "EC_MEMBER",
    "AUDITOR"
  ),
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
          COALESCE(blood_group, 'B+') AS blood_group,
          COALESCE(photo_url, '/images/leader-president.png') AS photo_url,
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
        blood_group,
        photo_url,
      } = req.body;

      let rawPassword = (password && typeof password === "string") ? password.trim() : "";
      if (!rawPassword || rawPassword === "password123") {
        rawPassword = generateRandomMemberPassword();
      }
      const hashedPassword = await bcrypt.hash(rawPassword, 10);

      const result = await pool.query(
        `
        INSERT INTO users
        (member_id, name, username, personal_email, phone, address, role, password, blood_group, photo_url, is_first_login, active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'B+'),COALESCE($10,'/images/leader-president.png'),true,true)
        RETURNING member_id, username
        `,
        [
          member_id,
          name,
          association_id,
          personal_email,
          phone,
          address,
          role || "MEMBER",
          hashedPassword,
          blood_group,
          photo_url,
        ]
      );

      const savedMemberId = result.rows[0].member_id;
      const savedAssociationId = result.rows[0].username;

      // Welcome mail with full login credentials
      if (personal_email) {
        await sendMail(
          personal_email,
          "Welcome to HSY Association 🎉",
          addMemberTemplate({
            name,
            username: savedAssociationId || association_id,
            memberId: savedMemberId || member_id,
            password: rawPassword,
          })
        );
      }

      res.status(201).json({
        message: "Member added successfully",
        member_id: savedMemberId,
        username: savedAssociationId,
        tempPassword: rawPassword,
      });
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
        blood_group,
        photo_url,
      } = req.body;

      const userId = Number(req.params.id);

      /* 🛡️ STRICT SUPER_ADMIN PROTECTION */
      const targetUser = await pool.query("SELECT role FROM users WHERE id=$1", [userId]);
      if (!targetUser.rowCount) {
        return res.status(404).json({ error: "Member not found" });
      }
      if (targetUser.rows[0].role === "SUPER_ADMIN") {
        return res.status(403).json({
          error: "Strict Security: Super Admin accounts cannot be edited or modified via member management.",
        });
      }

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
          name = COALESCE($1, name),
          personal_email = COALESCE($2, personal_email),
          phone = COALESCE($3, phone),
          address = COALESCE($4, address),
          role = COALESCE($5, role),
          active = COALESCE($6, active),
          blood_group = COALESCE($7, blood_group),
          photo_url = COALESCE($8, photo_url)
        WHERE id = $9
        RETURNING id, member_id, name, username, personal_email, phone, address, role, blood_group, photo_url, active
        `,
        [
          name,
          personal_email,
          phone,
          address,
          role,
          active,
          blood_group,
          photo_url,
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
      const targetUser = await pool.query("SELECT role FROM users WHERE id=$1", [req.params.id]);
      if (!targetUser.rowCount) {
        return res.status(404).json({ error: "Member not found" });
      }
      if (targetUser.rows[0].role === "SUPER_ADMIN") {
        return res.status(403).json({ error: "Strict Security: Super Admin account cannot be deactivated." });
      }

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
      const targetUser = await pool.query("SELECT role FROM users WHERE id=$1", [req.params.id]);
      if (!targetUser.rowCount) {
        return res.status(404).json({ error: "Member not found" });
      }
      if (targetUser.rows[0].role === "SUPER_ADMIN") {
        return res.status(403).json({ error: "Strict Security: Super Admin account cannot be deleted." });
      }

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

/* =====================================================
   8️⃣ ADMIN RESET / CHANGE MEMBER PASSWORD (SUPER_ADMIN / PRESIDENT)
   POST /members/:id/reset-password
===================================================== */
router.post(
  "/:id/reset-password",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword, sendEmail = true } = req.body;

      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters long" });
      }

      const userRes = await pool.query(
        "SELECT id, name, username, personal_email, role FROM users WHERE id=$1",
        [id]
      );

      if (!userRes.rowCount) {
        return res.status(404).json({ error: "Member not found" });
      }

      const user = userRes.rows[0];

      /* 🛡️ STRICT SUPER_ADMIN PROTECTION */
      if (user.role === "SUPER_ADMIN") {
        return res.status(403).json({
          error: "Strict Security: Super Admin password cannot be reset via member management.",
        });
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await pool.query(
        "UPDATE users SET password=$1, is_first_login=true WHERE id=$2",
        [hashedPassword, id]
      );

      if (sendEmail && user.personal_email) {
        await sendMail(
          user.personal_email,
          "Your HSY Association Password Has Been Reset 🔐",
          resendLoginTemplate({
            username: user.username,
            password: newPassword,
          })
        ).catch((err) => console.error("Email send error:", err.message));
      }

      await logAudit("ADMIN_RESET_PASSWORD", "USER", id, req.user.id);

      res.json({
        success: true,
        message: `Password for ${user.name} (${user.role}) has been updated successfully.`,
      });
    } catch (err) {
      console.error("ADMIN RESET PASSWORD ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to reset member password" });
    }
  }
);

module.exports = router;
