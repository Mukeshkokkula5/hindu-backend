const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const rateLimit = require("express-rate-limit");
const generateReceiptPDF = require("../utils/receiptPdf");

/* =========================
   🔐 RATE LIMIT
========================= */
const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
});

/* =========================
   🌐 QR VERIFICATION PAGE
========================= */
router.get("/verify/:receiptNo", verifyLimiter, async (req, res) => {
  try {
    const { receiptNo } = req.params;

    const { rows } = await pool.query(
      `SELECT c.receipt_no, c.amount, c.receipt_date,
              COALESCE(u.name, c.donor_name) AS name,
              f.fund_name
       FROM contributions c
       LEFT JOIN users u ON u.id = c.member_id
       JOIN funds f ON f.id = c.fund_id
       WHERE c.receipt_no=$1
         AND c.status='APPROVED'
         AND c.qr_locked=true`,
      [receiptNo]
    );

    if (!rows.length) {
      return res.send("<h2>❌ Invalid or Unapproved Receipt</h2>");
    }

    const r = rows[0];

    res.send(`
      <h2>✅ Receipt Verified</h2>
      <p><b>Receipt:</b> ${r.receipt_no}</p>
      <p><b>Name:</b> ${r.name}</p>
      <p><b>Fund:</b> ${r.fund_name}</p>
      <p><b>Amount:</b> ₹${Number(r.amount).toLocaleString("en-IN")}</p>
      <p><b>Date:</b> ${new Date(r.receipt_date).toDateString()}</p>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* =========================
   🌍 PUBLIC PDF RECEIPT
========================= */
router.get("/public-pdf/:receiptNo", async (req, res) => {
  try {
    const { receiptNo } = req.params;

    const { rows } = await pool.query(
      `SELECT c.receipt_no, c.amount, c.receipt_date,
              c.donor_name, f.fund_name
       FROM contributions c
       JOIN funds f ON f.id = c.fund_id
       WHERE c.receipt_no=$1
         AND c.source='PUBLIC'
         AND c.status='APPROVED'
         AND c.qr_locked=true`,
      [receiptNo]
    );

    if (!rows.length) return res.status(404).send("Receipt not found");

    const r = rows[0];

    const receipt = {
      receipt_no: r.receipt_no,
      name: r.donor_name,
      fund_name: r.fund_name,
      amount: r.amount,
      receipt_date: r.receipt_date,
      verifyUrl: `${process.env.BASE_URL}/receipts/verify/${r.receipt_no}`,
    };

    // 🔥 PROFESSIONAL PDF
    generateReceiptPDF(res, receipt);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

/* =========================
   👤 MEMBER PDF RECEIPT
========================= */
router.get("/pdf/:receiptNo", verifyToken, async (req, res) => {
  try {
    const { receiptNo } = req.params;

    const { rows } = await pool.query(
      `SELECT c.receipt_no, c.amount, c.receipt_date,
              u.name AS donor_name, f.fund_name, c.member_id
       FROM contributions c
       JOIN users u ON u.id = c.member_id
       JOIN funds f ON f.id = c.fund_id
       WHERE c.receipt_no=$1
         AND c.status='APPROVED'
         AND c.qr_locked=true`,
      [receiptNo]
    );

    if (!rows.length) return res.status(404).send("Receipt not found");

    const r = rows[0];

    // 🔐 Member can download only his receipt
    if (req.user.role === "MEMBER" && r.member_id !== req.user.id) {
      return res.status(403).send("Access denied");
    }

    const receipt = {
      receipt_no: r.receipt_no,
      name: r.donor_name,
      fund_name: r.fund_name,
      amount: r.amount,
      receipt_date: r.receipt_date,
      verifyUrl: `${process.env.BASE_URL}/receipts/verify/${r.receipt_no}`,
    };

    // 🔥 SAME PROFESSIONAL PDF
    generateReceiptPDF(res, receipt);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

module.exports = router;
