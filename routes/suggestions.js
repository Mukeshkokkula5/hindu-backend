const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const router = express.Router();

/* =====================================================
   📦 AUTO-INIT & MIGRATE DATABASE TABLE
===================================================== */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS suggestions (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        member_id VARCHAR(255),
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'GENERAL',
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED'
        admin_notes TEXT,
        reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'GENERAL';
      ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS admin_notes TEXT;
      ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE suggestions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
    `);
  } catch (err) {
    console.warn("Suggestions Table Init Notice:", err.message);
  }
})();

const normalizeRole = (role) => (role || "").toUpperCase().replace(/\s+/g, "_");

const isGovernanceBearer = (req) => {
  const r = normalizeRole(req.user?.role);
  return ["SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY"].includes(r);
};

/* =====================================================
   1. SUBMIT SUGGESTION (ALL ROLES UPTO MEMBERS)
   POST /suggestions
===================================================== */
router.post("/", verifyToken, async (req, res) => {
  try {
    const { title, message, category = "GENERAL" } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: "Title and message are required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO suggestions (user_id, member_id, title, category, message, status, created_at)
      VALUES ($1, $2, $3, $4, $5, 'PENDING', NOW())
      RETURNING *
      `,
      [req.user.id, String(req.user.id), title.trim(), category, message.trim()]
    );

    res.json({
      success: true,
      message: "💡 Suggestion submitted successfully! Association executive committee will review it.",
      data: rows[0],
    });
  } catch (err) {
    console.error("SUBMIT SUGGESTION ERROR:", err.message);
    res.status(500).json({ error: "Failed to submit suggestion" });
  }
});

/* =====================================================
   2. GET ALL SUGGESTIONS (FOR ALL USERS / MEMBERS)
   GET /suggestions
===================================================== */
router.get("/", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id,
        s.user_id,
        s.member_id,
        s.title,
        s.category,
        s.message,
        s.status,
        s.admin_notes,
        s.reviewed_at,
        s.created_at,
        COALESCE(u.name, 'Member') AS author_name,
        COALESCE(u.role, 'MEMBER') AS author_role,
        u.phone AS author_phone,
        u.personal_email AS author_email,
        u.member_id AS author_assoc_id,
        reviewer.name AS reviewer_name
      FROM suggestions s
      LEFT JOIN users u ON u.id = s.user_id OR (s.member_id IS NOT NULL AND s.member_id ~ '^[0-9]+$' AND u.id = s.member_id::int)
      LEFT JOIN users reviewer ON reviewer.id = s.reviewed_by
      ORDER BY s.created_at DESC
    `);

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("GET SUGGESTIONS ERROR:", err.message);
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

/* =====================================================
   3. GET MY SUGGESTIONS
   GET /suggestions/my
===================================================== */
router.get("/my", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        s.*,
        COALESCE(u.name, 'Me') AS author_name,
        COALESCE(u.role, 'MEMBER') AS author_role
      FROM suggestions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.user_id = $1 OR s.member_id = $2
      ORDER BY s.created_at DESC
      `,
      [req.user.id, String(req.user.id)]
    );

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("MY SUGGESTIONS ERROR:", err.message);
    res.status(500).json({ error: "Failed to load my suggestions" });
  }
});

/* =====================================================
   4. APPROVE / REJECT / UPDATE STATUS (SUPER ADMIN & PRESIDENT)
   PUT /suggestions/:id/status
===================================================== */
router.put("/:id/status", verifyToken, async (req, res) => {
  if (!isGovernanceBearer(req)) {
    return res.status(403).json({ error: "Access denied: Only Super Admin, President or General Secretary can review suggestions" });
  }

  try {
    const { status, admin_notes } = req.body;

    if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Use PENDING, APPROVED, or REJECTED" });
    }

    const { rows } = await pool.query(
      `
      UPDATE suggestions
      SET status = $1, admin_notes = $2, reviewed_by = $3, reviewed_at = NOW()
      WHERE id = $4
      RETURNING *
      `,
      [status, admin_notes || null, req.user.id, req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    res.json({
      success: true,
      message: `Suggestion status updated to ${status}`,
      data: rows[0],
    });
  } catch (err) {
    console.error("UPDATE SUGGESTION STATUS ERROR:", err.message);
    res.status(500).json({ error: "Failed to update suggestion status" });
  }
});

/* =====================================================
   5. DELETE SUGGESTION (AUTHOR OR ADMIN)
   DELETE /suggestions/:id
===================================================== */
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const checkRes = await pool.query("SELECT * FROM suggestions WHERE id = $1", [req.params.id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    const sug = checkRes.rows[0];
    const isOwner = Number(sug.user_id) === Number(req.user.id) || String(sug.member_id) === String(req.user.id);
    
    if (!isOwner && !isGovernanceBearer(req)) {
      return res.status(403).json({ error: "Access denied: You can only delete your own suggestions" });
    }

    await pool.query("DELETE FROM suggestions WHERE id = $1", [req.params.id]);

    res.json({
      success: true,
      message: "Suggestion deleted successfully",
    });
  } catch (err) {
    console.error("DELETE SUGGESTION ERROR:", err.message);
    res.status(500).json({ error: "Failed to delete suggestion" });
  }
});

module.exports = router;
