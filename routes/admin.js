const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const logAudit = require("../utils/auditLogger");
const sendMail = require("../utils/sendMail");

const {
  addMemberTemplate,
  resendLoginTemplate,
} = require("../utils/emailTemplates");

const router = express.Router();

/* =========================
   🔐 ROLE CONSTANTS
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

const ALL_ROLES = Object.values(ROLES);
const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.PRESIDENT];
const DASHBOARD_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.PRESIDENT,
  ROLES.VICE_PRESIDENT,
  ROLES.GENERAL_SECRETARY,
  ROLES.JOINT_SECRETARY,
  ROLES.TREASURER,
  ROLES.EC_MEMBER,
];

/* =========================
   🆔 MEMBER ID GENERATOR
========================= */
async function generateMemberId(client) {
  const year = new Date().getFullYear();
  const prefix = `HSY/JGTL/${year}/`;

  const last = await client.query(
    `
    SELECT member_id
    FROM users
    WHERE member_id LIKE $1
    ORDER BY member_id DESC
    LIMIT 1
    FOR UPDATE
    `,
    [`${prefix}%`]
  );

  const next = last.rowCount
    ? Number(last.rows[0].member_id.split("/").pop()) + 1
    : 1;

  return prefix + String(next).padStart(4, "0");
}

/* =========================
   👤 USERNAME GENERATOR
========================= */
async function generateUsername(name) {
  const base = name.toLowerCase().replace(/[^a-z]/g, "");
  let username = `${base}@hsy.org`;
  let i = 1;

  while (true) {
    const exists = await pool.query(
      "SELECT id FROM users WHERE username=$1",
      [username]
    );
    if (!exists.rowCount) break;
    username = `${base}${++i}@hsy.org`;
  }

  return username;
}

/* =====================================================
   👥 GET ALL MEMBERS
===================================================== */
router.get(
  "/members",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          id,
          member_id,
          name,
          username,
          personal_email,
          phone,
          address,
          role,
          active
        FROM users
        WHERE role != 'SUPER_ADMIN'
        ORDER BY member_id
      `);

      res.json(rows);
    } catch (err) {
      console.error("GET MEMBERS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load members" });
    }
  }
);

/* =====================================================
   👤 ADD MEMBER
===================================================== */
router.post(
  "/add-member",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { name, personal_email, email, phone, address, role = ROLES.MEMBER } =
        req.body;

      const targetEmail = personal_email || email;

      if (!name) return res.status(400).json({ error: "Name required" });
      if (!ALL_ROLES.includes(role))
        return res.status(400).json({ error: "Invalid role" });

      await client.query("BEGIN");

      const memberId = await generateMemberId(client);
      const username = await generateUsername(name);
      const password = Math.random().toString(36).slice(-8);
      const hashed = await bcrypt.hash(password, 10);

      const { rows } = await client.query(
        `
        INSERT INTO users
          (member_id, name, username, personal_email, phone, address, password, role, is_first_login, active)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,true,true)
        RETURNING id
        `,
        [
          memberId,
          name,
          username,
          targetEmail || null,
          phone || null,
          address || null,
          hashed,
          role,
        ]
      );

      await client.query("COMMIT");

      if (targetEmail) {
        await sendMail(
          targetEmail,
          "Welcome to HSY Association",
          addMemberTemplate({ name, username, password, memberId })
        );
      }

      await logAudit("CREATE_MEMBER", "USER", rows[0].id, req.user.id);

      res.status(201).json({
        message: "Member added successfully",
        member_id: memberId,
        username,
        password,
        tempPassword: password,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("ADD MEMBER ERROR 👉", err.message);
      res.status(500).json({ error: "Add member failed" });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   ✏️ EDIT MEMBER (FINAL)
===================================================== */
router.put(
  "/edit-member/:id",
  verifyToken,
  checkRole(ROLES.SUPER_ADMIN, ROLES.PRESIDENT),
  async (req, res) => {
    try {
      const { name, personal_email, phone, address, role, active } = req.body;

      const result = await pool.query(
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
        RETURNING id
        `,
        [
          name,
          personal_email || null,
          phone || null,
          address || null,
          role,
          active,
          req.params.id,
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: "Member not found" });
      }

      await logAudit("EDIT_MEMBER", "USER", req.params.id, req.user.id);

      res.json({ message: "Member updated successfully" });
    } catch (err) {
      console.error("EDIT MEMBER ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update member" });
    }
  }
);

/* =====================================================
   🚫 BLOCK / UNBLOCK MEMBER
===================================================== */
router.patch(
  "/members/:id/status",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { active } = req.body;

      const result = await pool.query(
        "UPDATE users SET active=$1 WHERE id=$2 RETURNING id",
        [active, req.params.id]
      );

      if (!result.rowCount)
        return res.status(404).json({ error: "Member not found" });

      await logAudit(
        active ? "UNBLOCK_MEMBER" : "BLOCK_MEMBER",
        "USER",
        req.params.id,
        req.user.id
      );

      res.json({
        message: active ? "Member unblocked" : "Member blocked",
      });
    } catch (err) {
      console.error("BLOCK/UNBLOCK ERROR 👉", err.message);
      res.status(500).json({ error: "Action failed" });
    }
  }
);

/* =====================================================
   🔁 RESEND LOGIN
===================================================== */
router.post(
  "/members/:id/resend-login",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const user = await pool.query(
        "SELECT username, personal_email FROM users WHERE id=$1",
        [req.params.id]
      );

      if (!user.rowCount)
        return res.status(404).json({ error: "Member not found" });

      if (!user.rows[0].personal_email)
        return res.status(400).json({ error: "Email not available" });

      const password = Math.random().toString(36).slice(-8);
      const hashed = await bcrypt.hash(password, 10);

      await pool.query(
        "UPDATE users SET password=$1, is_first_login=true WHERE id=$2",
        [hashed, req.params.id]
      );

      await sendMail(
        user.rows[0].personal_email,
        "HSY Login Credentials Reset",
        resendLoginTemplate({
          username: user.rows[0].username,
          password,
        })
      );

      await logAudit("RESEND_LOGIN", "USER", req.params.id, req.user.id);

      res.json({ message: "Login credentials resent successfully" });
    } catch (err) {
      console.error("RESEND LOGIN ERROR 👉", err.message);
      res.status(500).json({ error: "Resend failed" });
    }
  }
);

/* =====================================================
   🗑 DELETE MEMBER (SUPER ADMIN ONLY)
===================================================== */
router.delete(
  "/members/:id",
  verifyToken,
  checkRole(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);

      await logAudit("DELETE_MEMBER", "USER", req.params.id, req.user.id);

      res.json({ message: "Member deleted successfully" });
    } catch (err) {
      console.error("DELETE MEMBER ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to delete member" });
    }
  }
);
/* =====================================================
   📜 GET AUDIT LOGS
   GET /api/admin/audit-logs
   ✔ SUPER_ADMIN ONLY
===================================================== */
router.get(
  "/audit-logs",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
      const offset = (page - 1) * limit;

      const countRes = await pool.query("SELECT COUNT(*) FROM audit_logs");
      const totalCount = parseInt(countRes.rows[0].count, 10);
      const totalPages = Math.ceil(totalCount / limit) || 1;

      const result = await pool.query(
        `
        SELECT
          a.id,
          a.action,
          a.entity,
          a.entity_id,
          COALESCE(NULLIF(a.performed_by, 'SYSTEM'), u.name, u.username, 'SYSTEM') AS performed_by,
          u.name AS performer_name,
          u.username AS performer_username,
          a.user_id,
          a.metadata,
          a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );

      res.json({
        logs: result.rows,
        pagination: {
          totalCount,
          totalPages,
          currentPage: page,
          limit,
        },
      });
    } catch (err) {
      console.error("AUDIT LOGS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load audit logs" });
    }
  }
);


module.exports = router;
