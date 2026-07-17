const express = require("express");
const router = express.Router();
const pool = require("../db");

// REGISTER VOLUNTEER
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, city, skills, message } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({ error: "Required fields missing" });
    }

    await pool.query(
      `INSERT INTO volunteers (name, email, phone, city, skills, message)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [name, email, phone, city, skills, message]
    );

    res.json({ success: true, message: "Registered successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;