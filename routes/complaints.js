const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

const router = express.Router();

/* =========================
   ROLES
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
  VOLUNTEER: "VOLUNTEER",
};

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.PRESIDENT];
const OFFICE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.PRESIDENT,
  ROLES.VICE_PRESIDENT,
  ROLES.GENERAL_SECRETARY,
  ROLES.JOINT_SECRETARY,
  ROLES.TREASURER,
  ROLES.EC_MEMBER,
];

/* =========================
   CREATE COMPLAINT (ALL MEMBERS & ROLES)
========================= */
router.post("/create", verifyToken, async (req, res) => {
  try {
    const { subject, description, comment } = req.body;
    if (!subject || !description) {
      return res.status(400).json({ error: "Subject and description are required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO complaints (member_id, subject, description, status, sla_days)
       VALUES ($1, $2, $3, 'OPEN', 7) RETURNING *`,
      [req.user.id, subject.trim(), description.trim()]
    );

    const complaint = rows[0];

    await pool.query(
      `INSERT INTO complaint_comments
       (complaint_id, comment, commented_by, comment_type)
       VALUES ($1, $2, $3, 'COMMENT')`,
      [complaint.id, comment ? comment.trim() : "Complaint submitted by member.", req.user.id]
    );

    res.status(201).json({
      success: true,
      message: "Complaint registered successfully! The President / Admin team will review and assign it.",
      complaint,
    });
  } catch (err) {
    console.error("CREATE COMPLAINT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to register complaint" });
  }
});

/* =========================
   VIEW COMPLAINTS
========================= */

// 1. All complaints (Office Bearers & Admin)
router.get("/all", verifyToken, checkRole(...OFFICE_ROLES), async (_, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        c.*,
        u.name AS reporter_name,
        u.username AS reporter_username,
        u.member_id AS reporter_member_id,
        u.phone AS reporter_phone,
        u.personal_email AS reporter_email,
        u.role AS reporter_role
      FROM complaints c
      LEFT JOIN users u ON u.id = c.member_id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("GET ALL COMPLAINTS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load complaints" });
  }
});

// 2. Complaints assigned to current role (VP, GS, Treasurer, EC)
router.get("/assigned", verifyToken, checkRole(...OFFICE_ROLES), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        c.*,
        u.name AS reporter_name,
        u.username AS reporter_username,
        u.member_id AS reporter_member_id,
        u.phone AS reporter_phone,
        u.role AS reporter_role
       FROM complaints c
       LEFT JOIN users u ON u.id = c.member_id
       WHERE c.assigned_role = $1
       ORDER BY c.updated_at DESC`,
      [req.user.role]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET ASSIGNED COMPLAINTS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load assigned complaints" });
  }
});

// 3. My submitted complaints (Logged-in User / Member)
router.get("/my", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
        c.*,
        u.name AS reporter_name,
        u.username AS reporter_username,
        u.member_id AS reporter_member_id,
        u.phone AS reporter_phone,
        u.role AS reporter_role
       FROM complaints c
       LEFT JOIN users u ON u.id = c.member_id
       WHERE c.member_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET MY COMPLAINTS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load complaints" });
  }
});

/* =========================
   ASSIGN TO ROLE (SUPER ADMIN & PRESIDENT ONLY)
========================= */
router.put("/assign/:id", verifyToken, checkRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { assigned_role, comment } = req.body;
    if (!assigned_role) {
      return res.status(400).json({ error: "Assigned role is required" });
    }

    const { rows } = await pool.query(
      `UPDATE complaints
       SET assigned_role = $1,
           status = 'FORWARDED',
           sla_days = 7,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [assigned_role, req.params.id]
    );

    if (!rows.rowCount && rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    await pool.query(
      `INSERT INTO complaint_comments
       (complaint_id, comment, commented_by, comment_type)
       VALUES ($1, $2, $3, 'INSTRUCTION')`,
      [
        req.params.id,
        comment ? comment.trim() : `Assigned to ${assigned_role} for review and action by President.`,
        req.user.id,
      ]
    );

    res.json({
      success: true,
      message: `Complaint assigned to ${assigned_role} successfully.`,
      complaint: rows[0],
    });
  } catch (err) {
    console.error("ASSIGN COMPLAINT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to assign complaint" });
  }
});

/* =========================
   ACCEPT / START WORKING (ASSIGNED ROLE)
========================= */
router.put("/accept/:id", verifyToken, checkRole(...OFFICE_ROLES), async (req, res) => {
  try {
    const { comment } = req.body;

    const { rows } = await pool.query(
      `UPDATE complaints
       SET status = 'IN_PROGRESS', updated_at = NOW()
       WHERE id = $1 AND (assigned_role = $2 OR $2 IN ('SUPER_ADMIN', 'PRESIDENT'))
       RETURNING *`,
      [req.params.id, req.user.role]
    );

    if (!rows.rowCount && rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found or not assigned to your role" });
    }

    await pool.query(
      `INSERT INTO complaint_comments
       (complaint_id, comment, commented_by, comment_type)
       VALUES ($1, $2, $3, 'ACCEPT')`,
      [
        req.params.id,
        comment ? comment.trim() : `Complaint accepted and work started by ${req.user.role}.`,
        req.user.id,
      ]
    );

    res.json({
      success: true,
      message: "Complaint status updated to IN PROGRESS",
      complaint: rows[0],
    });
  } catch (err) {
    console.error("ACCEPT COMPLAINT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to accept complaint" });
  }
});

/* =========================
   RESOLVE / COMPLETE (ASSIGNED ROLE OR ADMIN)
========================= */
router.put("/resolve/:id", verifyToken, checkRole(...OFFICE_ROLES), async (req, res) => {
  try {
    const { comment } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Resolution details/comment are required" });
    }

    const { rows } = await pool.query(
      `UPDATE complaints
       SET status = 'RESOLVED', updated_at = NOW()
       WHERE id = $1 AND (assigned_role = $2 OR $2 IN ('SUPER_ADMIN', 'PRESIDENT'))
       RETURNING *`,
      [req.params.id, req.user.role]
    );

    if (!rows.rowCount && rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found or unauthorized" });
    }

    await pool.query(
      `INSERT INTO complaint_comments
       (complaint_id, comment, commented_by, comment_type)
       VALUES ($1, $2, $3, 'RESOLVE')`,
      [req.params.id, comment.trim(), req.user.id]
    );

    res.json({
      success: true,
      message: "Complaint marked as RESOLVED. Awaiting final closing by President.",
      complaint: rows[0],
    });
  } catch (err) {
    console.error("RESOLVE COMPLAINT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to resolve complaint" });
  }
});

/* =========================
   OFFICIAL CLOSE (SUPER ADMIN & PRESIDENT ONLY)
========================= */
router.put("/close/:id", verifyToken, checkRole(...ADMIN_ROLES), async (req, res) => {
  try {
    const { comment } = req.body;

    const { rows } = await pool.query(
      `UPDATE complaints
       SET status = 'CLOSED', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );

    if (!rows.rowCount && rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    await pool.query(
      `INSERT INTO complaint_comments
       (complaint_id, comment, commented_by, comment_type)
       VALUES ($1, $2, $3, 'CLOSE')`,
      [
        req.params.id,
        comment ? comment.trim() : "Complaint verified and officially closed by President.",
        req.user.id,
      ]
    );

    res.json({
      success: true,
      message: "Complaint officially closed by President.",
      complaint: rows[0],
    });
  } catch (err) {
    console.error("CLOSE COMPLAINT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to close complaint" });
  }
});

/* =========================
   REOPEN (MEMBER OR ADMIN)
========================= */
router.put("/reopen/:id", verifyToken, async (req, res) => {
  try {
    const { comment } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Reason for reopening is required" });
    }

    const { rows } = await pool.query(
      `UPDATE complaints
       SET status = 'OPEN', sla_days = 7, updated_at = NOW()
       WHERE id = $1 AND (member_id = $2 OR $3 IN ('SUPER_ADMIN', 'PRESIDENT'))
       RETURNING *`,
      [req.params.id, req.user.id, req.user.role]
    );

    if (!rows.rowCount && rows.length === 0) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    await pool.query(
      `INSERT INTO complaint_comments
       (complaint_id, comment, commented_by, comment_type)
       VALUES ($1, $2, $3, 'REOPEN')`,
      [req.params.id, comment.trim(), req.user.id]
    );

    res.json({
      success: true,
      message: "Complaint has been reopened for further action.",
      complaint: rows[0],
    });
  } catch (err) {
    console.error("REOPEN COMPLAINT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to reopen complaint" });
  }
});

/* =========================
   COMMENTS / TIMELINE
========================= */
router.get("/comments/:id", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cc.comment, cc.comment_type, cc.created_at,
              u.name, u.role, u.username
       FROM complaint_comments cc
       JOIN users u ON u.id = cc.commented_by
       WHERE cc.complaint_id = $1
       ORDER BY cc.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET COMMENTS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load timeline comments" });
  }
});

/* =========================
   DASHBOARD STATS
========================= */
router.get("/stats", verifyToken, async (req, res) => {
  try {
    const roleUpper = (req.user.role || "").toUpperCase();
    const isAdmin = roleUpper === "SUPER_ADMIN" || roleUpper === "PRESIDENT";

    let query = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status='OPEN') AS open,
        COUNT(*) FILTER (WHERE status='FORWARDED') AS forwarded,
        COUNT(*) FILTER (WHERE status='IN_PROGRESS') AS in_progress,
        COUNT(*) FILTER (WHERE status='RESOLVED') AS resolved,
        COUNT(*) FILTER (WHERE status='CLOSED') AS closed,
        COUNT(*) FILTER (
          WHERE status != 'CLOSED'
          AND NOW() > created_at + (sla_days || ' days')::INTERVAL
        ) AS sla_missed
      FROM complaints
    `;

    const params = [];
    if (!isAdmin) {
      // If office bearer, show complaints assigned to them or created by them
      params.push(req.user.id, req.user.role);
      query += ` WHERE member_id = $1 OR assigned_role = $2`;
    }

    const { rows } = await pool.query(query, params);
    const s = rows[0];

    res.json({
      total: parseInt(s.total, 10) || 0,
      open: parseInt(s.open, 10) || 0,
      forwarded: parseInt(s.forwarded, 10) || 0,
      in_progress: parseInt(s.in_progress, 10) || 0,
      resolved: parseInt(s.resolved, 10) || 0,
      closed: parseInt(s.closed, 10) || 0,
      sla_missed: parseInt(s.sla_missed, 10) || 0,
    });
  } catch (err) {
    console.error("COMPLAINTS STATS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load complaint stats" });
  }
});

module.exports = router;

