const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

const router = express.Router();

/* =====================================================
   SUBMIT SUGGESTION (ALL USERS)
===================================================== */
router.post("/", verifyToken, async (req, res) => {
  try {
    const { title, message, type = "GENERAL" } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    await pool.query(
      `
      INSERT INTO suggestions (member_id, title, message, type, status)
      VALUES ($1, $2, $3, $4, 'PENDING')
      `,
      [String(req.user.id), title || null, message, type]
    );

    res.json({
      success: true,
      message: "Suggestion submitted",
    });
  } catch (err) {
    console.error("SUBMIT SUGGESTION ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to submit suggestion" });
  }
});

/* =====================================================
   MY SUGGESTIONS (LOGGED-IN USER)
===================================================== */
router.get("/my", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        member_id,
        title,
        message,
        type,
        status,
        created_at
      FROM suggestions
      WHERE member_id = $1
      ORDER BY created_at DESC
      `,
      [String(req.user.id)]
    );

    res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error("MY SUGGESTIONS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

/* =====================================================
   ALL SUGGESTIONS (ADMIN / PRESIDENT)
===================================================== */
router.get(
  "/all",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT
          s.id,
          s.member_id,
          s.title,
          s.message,
          s.type,
          s.status,
          s.created_at,
          m.name AS member_name
        FROM suggestions s
        LEFT JOIN members m
          ON m.id::text = s.member_id
        ORDER BY s.created_at DESC
      `);

      res.json({
        success: true,
        data: rows,
      });
    } catch (err) {
      console.error("ALL SUGGESTIONS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load suggestions" });
    }
  }
);

/* =====================================================
   APPROVE / REJECT (ADMIN / PRESIDENT)
===================================================== */
router.put(
  "/:id/status",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { status } = req.body;

      if (!["APPROVED", "REJECTED"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      await pool.query(
        `UPDATE suggestions SET status = $1 WHERE id = $2`,
        [status, req.params.id]
      );

      res.json({
        success: true,
        message: "Status updated",
      });
    } catch (err) {
      console.error("UPDATE STATUS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update status" });
    }
  }
);

module.exports = router;
