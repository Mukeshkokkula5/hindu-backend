const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");

/* =========================
   🔔 GET USER NOTIFICATIONS
========================= */
router.get("/", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT id, title, message, link, is_read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error("NOTIFICATION FETCH ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

/* =========================
   ✅ MARK AS READ
========================= */
router.post("/:id/read", verifyToken, async (req, res) => {
  try {
    await pool.query(
      `
      UPDATE notifications
      SET is_read = true
      WHERE id = $1 AND user_id = $2
      `,
      [req.params.id, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("NOTIFICATION READ ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

/* =========================
   🧹 MARK ALL AS READ
========================= */
router.post("/read-all", verifyToken, async (req, res) => {
  try {
    await pool.query(
      `
      UPDATE notifications
      SET is_read = true
      WHERE user_id = $1
      `,
      [req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("READ ALL ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});

module.exports = router;
