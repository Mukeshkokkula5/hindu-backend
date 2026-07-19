const express = require("express");
const router = express.Router();
const pool = require("../db");

/* =========================
   🏛 PUBLIC ASSOCIATION INFO
   GET /public/association-info
========================= */
router.get("/association-info", async (req, res) => {
  try {
    const assoc = await pool.query(
      "SELECT * FROM association_info ORDER BY id DESC LIMIT 1"
    );

    const funds = await pool.query(
      "SELECT id, fund_name FROM funds WHERE status='ACTIVE' ORDER BY fund_name"
    );

    res.json({
      success: true,
      data: {
        association: assoc.rows[0] || null,
        funds: funds.rows,
      },
    });
  } catch (err) {
    console.error("PUBLIC ASSOCIATION ERROR 👉", err.message);
    res.status(500).json({
      success: false,
      error: "Failed to load association info",
    });
  }
});

/* =========================
   🤝 PUBLIC DONATION
   POST /public/donate
========================= */
router.post("/donate", async (req, res) => {
  try {
    const {
      donor_name,
      donor_phone,
      donor_email,
      fund_id,
      amount,
      payment_mode,
      reference_no,
    } = req.body;

    if (!fund_id || !amount || !payment_mode) {
      return res.status(400).json({
        success: false,
        error: "Required fields missing",
      });
    }

    await pool.query(
      `
      INSERT INTO contributions
      (member_id, donor_name, donor_phone, donor_email, fund_id, amount, payment_mode, reference_no, status, source)
      VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, 'PENDING', 'PUBLIC')
      `,
      [
        donor_name || "Public Donor",
        donor_phone || null,
        donor_email || null,
        fund_id,
        amount,
        payment_mode,
        reference_no || null,
      ]
    );

    res.json({
      success: true,
      message: "🙏 Thank you! Donation submitted successfully",
    });
  } catch (err) {
    console.error("PUBLIC DONATION ERROR 👉", err.message);
    res.status(500).json({
      success: false,
      error: "Donation failed",
    });
  }
});

/* =========================
   📄 PUBLIC SINGLE CONTRIBUTION (RECEIPT VIEW)
   GET /public/contribution/:token
========================= */
router.get("/contribution/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { rows } = await pool.query(
      `
      SELECT 
        c.id,
        c.receipt_date AS date,
        COALESCE(c.donor_name, u.name) AS title,
        c.source AS category,
        f.fund_name,
        c.amount,
        c.payment_note AS desc,
        COALESCE(c.donor_phone, u.phone) AS phone,
        c.status,
        c.public_token
      FROM contributions c
      LEFT JOIN users u ON u.id = c.member_id
      LEFT JOIN funds f ON f.id = c.fund_id
      WHERE c.public_token = $1
      `,
      [token]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, error: "Contribution not found" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error("GET PUBLIC CONTRIBUTION ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

module.exports = router;

