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
  EC_MEMBER: "EC_MEMBER",
  MEMBER: "MEMBER",
};

const ADMIN_ROLES = [ROLES.SUPER_ADMIN, ROLES.PRESIDENT];
const OFFICE_ROLES = [
  ROLES.VICE_PRESIDENT,
  ROLES.GENERAL_SECRETARY,
  ROLES.JOINT_SECRETARY,
  ROLES.EC_MEMBER,
];

/* =========================
   CREATE COMPLAINT (ALL)
========================= */
router.post("/create", verifyToken, async (req, res) => {
  const { subject, description, comment } = req.body;
  if (!subject || !description || !comment)
    return res.status(400).json({ error: "All fields required" });

  const { rows } = await pool.query(
    `INSERT INTO complaints (member_id, subject, description)
     VALUES ($1,$2,$3) RETURNING id`,
    [req.user.id, subject, description]
  );

  await pool.query(
    `INSERT INTO complaint_comments
     (complaint_id, comment, commented_by, comment_type)
     VALUES ($1,$2,$3,'COMMENT')`,
    [rows[0].id, comment, req.user.id]
  );

  res.json({ success: true });
});

/* =========================
   VIEW
========================= */
router.get("/my", verifyToken, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM complaints WHERE member_id=$1 ORDER BY created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

router.get("/assigned", verifyToken, checkRole(...OFFICE_ROLES), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM complaints
     WHERE assigned_role=$1
     ORDER BY updated_at DESC`,
    [req.user.role]
  );
  res.json(rows);
});

router.get("/all", verifyToken, checkRole(...ADMIN_ROLES), async (_, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM complaints ORDER BY created_at DESC`
  );
  res.json(rows);
});

/* =========================
   ASSIGN (ADMIN)
========================= */
router.put("/assign/:id", verifyToken, checkRole(...ADMIN_ROLES), async (req, res) => {
  const { assigned_role, comment } = req.body;
  if (!assigned_role || !comment)
    return res.status(400).json({ error: "Comment required" });

  await pool.query(
    `UPDATE complaints
     SET assigned_role=$1,
         status='FORWARDED',
         sla_days=7,
         updated_at=NOW()
     WHERE id=$2`,
    [assigned_role, req.params.id]
  );

  await pool.query(
    `INSERT INTO complaint_comments
     (complaint_id, comment, commented_by, comment_type)
     VALUES ($1,$2,$3,'INSTRUCTION')`,
    [req.params.id, comment, req.user.id]
  );

  res.json({ success: true });
});

/* =========================
   ACCEPT (OFFICE)
========================= */
router.put("/accept/:id", verifyToken, checkRole(...OFFICE_ROLES), async (req, res) => {
  const { comment } = req.body;
  if (!comment) return res.status(400).json({ error: "Comment required" });

  await pool.query(
    `UPDATE complaints
     SET status='IN_PROGRESS', updated_at=NOW()
     WHERE id=$1 AND assigned_role=$2`,
    [req.params.id, req.user.role]
  );

  await pool.query(
    `INSERT INTO complaint_comments
     (complaint_id, comment, commented_by, comment_type)
     VALUES ($1,$2,$3,'ACCEPT')`,
    [req.params.id, comment, req.user.id]
  );

  res.json({ success: true });
});

/* =========================
   RESOLVE (OFFICE)
========================= */
router.put("/resolve/:id", verifyToken, checkRole(...OFFICE_ROLES), async (req, res) => {
  const { comment } = req.body;
  if (!comment) return res.status(400).json({ error: "Comment required" });

  await pool.query(
    `UPDATE complaints
     SET status='RESOLVED', updated_at=NOW()
     WHERE id=$1 AND assigned_role=$2`,
    [req.params.id, req.user.role]
  );

  await pool.query(
    `INSERT INTO complaint_comments
     (complaint_id, comment, commented_by, comment_type)
     VALUES ($1,$2,$3,'RESOLVE')`,
    [req.params.id, comment, req.user.id]
  );

  res.json({ success: true });
});

/* =========================
   CLOSE (PRESIDENT)
========================= */
router.put("/close/:id", verifyToken, checkRole(ROLES.PRESIDENT), async (req, res) => {
  const { comment } = req.body;
  if (!comment) return res.status(400).json({ error: "Comment required" });

  await pool.query(
    `UPDATE complaints
     SET status='CLOSED', updated_at=NOW()
     WHERE id=$1 AND status='RESOLVED'`,
    [req.params.id]
  );

  await pool.query(
    `INSERT INTO complaint_comments
     (complaint_id, comment, commented_by, comment_type)
     VALUES ($1,$2,$3,'CLOSE')`,
    [req.params.id, comment, req.user.id]
  );

  res.json({ success: true });
});

/* =========================
   REOPEN (MEMBER)
========================= */
router.put("/reopen/:id", verifyToken, async (req, res) => {
  const { comment } = req.body;
  if (!comment) return res.status(400).json({ error: "Comment required" });

  await pool.query(
    `UPDATE complaints
     SET status='OPEN', sla_days=7, updated_at=NOW()
     WHERE id=$1`,
    [req.params.id]
  );

  await pool.query(
    `INSERT INTO complaint_comments
     (complaint_id, comment, commented_by, comment_type)
     VALUES ($1,$2,$3,'REOPEN')`,
    [req.params.id, comment, req.user.id]
  );

  res.json({ success: true });
});

/* =========================
   COMMENTS / TIMELINE
========================= */
router.get("/comments/:id", verifyToken, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT cc.comment, cc.comment_type, cc.created_at,
            u.name, u.role
     FROM complaint_comments cc
     JOIN users u ON u.id = cc.commented_by
     WHERE complaint_id=$1
     ORDER BY cc.created_at`,
    [req.params.id]
  );
  res.json(rows);
});

/* =========================
   DASHBOARD STATS
========================= */
router.get("/stats", verifyToken, checkRole(...ADMIN_ROLES), async (_, res) => {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status='OPEN') open,
      COUNT(*) FILTER (WHERE status='FORWARDED') forwarded,
      COUNT(*) FILTER (WHERE status='IN_PROGRESS') in_progress,
      COUNT(*) FILTER (WHERE status='RESOLVED') resolved,
      COUNT(*) FILTER (WHERE status='CLOSED') closed,
      COUNT(*) FILTER (
        WHERE status!='CLOSED'
        AND NOW() > created_at + (sla_days || ' days')::INTERVAL
      ) sla_missed
    FROM complaints
  `);
  res.json(rows[0]);
});

module.exports = router;
