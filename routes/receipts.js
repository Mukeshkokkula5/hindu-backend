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

    // 1️⃣ Check if it's an online Razorpay donation (starts with order_)
    if (receiptNo.startsWith('order_')) {
      const { rows } = await pool.query(
        `SELECT * FROM pg_transactions WHERE order_id=$1 AND status='SUCCESS'`,
        [receiptNo]
      );
      
      if (!rows.length) {
        return res.send("<h2>❌ Invalid or Pending Receipt</h2>");
      }
      
      const r = rows[0];
      return res.send(`
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 40px auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #059669; text-align: center;">✅ Online Donation Verified</h2>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
          <p><b>Receipt ID:</b> <span style="font-family: monospace;">${r.order_id}</span></p>
          <p><b>Donor Name:</b> ${r.payer_name}</p>
          <p><b>Fund:</b> General Donation</p>
          <p><b>Amount:</b> ₹${Number(r.amount).toLocaleString("en-IN")}</p>
          <p><b>Payment Status:</b> <span style="color: white; background: #059669; padding: 2px 8px; border-radius: 4px; font-size: 14px;">SUCCESS</span></p>
          <p><b>Date:</b> ${new Date(r.created_at).toDateString()}</p>
        </div>
      `);
    }

    // 2️⃣ Otherwise, check the standard offline contributions table
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
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 40px auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
        <h2 style="color: #059669; text-align: center;">✅ Receipt Verified</h2>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">
        <p><b>Receipt:</b> ${r.receipt_no}</p>
        <p><b>Name:</b> ${r.name}</p>
        <p><b>Fund:</b> ${r.fund_name}</p>
        <p><b>Amount:</b> ₹${Number(r.amount).toLocaleString("en-IN")}</p>
        <p><b>Date:</b> ${new Date(r.receipt_date).toDateString()}</p>
      </div>
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
