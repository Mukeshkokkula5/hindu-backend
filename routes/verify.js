const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/verify-resolution/:id", async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT r.title, r.status, r.approved_at,
           m.title meeting_title,
           a.name association_name
    FROM meeting_resolutions r
    JOIN meetings m ON m.id=r.meeting_id
    JOIN association_info a ON TRUE
    WHERE r.id=$1 AND r.status='APPROVED'
    `,
    [req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({ valid: false });
  }

  res.json({
    valid: true,
    resolution: rows[0],
  });
});

module.exports = router;
