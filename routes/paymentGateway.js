const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Razorpay = require("razorpay");
const pool = require("../db");
const sendReceiptEmail = require("../utils/sendReceiptEmail");

// Initialize Razorpay (ensure these are set in your .env file)
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});

/* =====================================================
   1️⃣ CREATE RAZORPAY ORDER
   POST /payment/create-order
===================================================== */
router.post("/create-order", async (req, res) => {
  try {
    const { payer_name, amount, email, mobile_number, address, fund_type, member_id } = req.body;

    const cleanMobile = mobile_number ? String(mobile_number).trim() : "";
    const effectiveEmail = email && email.trim() ? email.trim() : `${cleanMobile || 'devotee'}@hinduswarajyouth.online`;
    const effectiveAddress = address && address.trim() ? address.trim() : "Jagtial, Telangana";

    if (!payer_name || !amount || !cleanMobile || !fund_type) {
      return res.status(400).json({ error: "Missing required fields (name, amount, mobile, fund_type)" });
    }

    let orderId;
    let orderAmount = Math.round(Number(amount) * 100);
    let currency = "INR";

    try {
      const options = {
        amount: orderAmount,
        currency,
        receipt: `receipt_${Date.now()}`,
      };

      const order = await razorpay.orders.create(options);
      orderId = order.id;
    } catch (rzpErr) {
      console.warn("⚠️ Razorpay API Order Creation Failed (using test order fallback):", rzpErr.error?.description || rzpErr.message || rzpErr);
      
      // Fallback for invalid/unauthenticated Razorpay test keys during local testing
      orderId = `order_test_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

    // Save pending transaction to DB
    await pool.query(
      `
      INSERT INTO pg_transactions (order_id, payer_name, amount, email, mobile_number, address, fund_type, status, member_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8)
      `,
      [orderId, payer_name, amount, effectiveEmail, cleanMobile, effectiveAddress, fund_type, member_id || null]
    );

    res.json({
      success: true,
      order_id: orderId,
      amount: orderAmount,
      currency,
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
    });
  } catch (err) {
    console.error("RAZORPAY CREATE ORDER ERROR 👉", err.message || err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

/* =====================================================
   2️⃣ RAZORPAY WEBHOOK (Automated Verification)
   POST /payment/webhook
===================================================== */
router.post("/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    
    if (!secret) {
        console.error("Missing RAZORPAY_WEBHOOK_SECRET in .env");
        return res.status(500).json({ error: "Server configuration error" });
    }

    // Verify Webhook Signature
    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(req.body);
    const digest = shasum.digest('hex');

    if (digest === signature) {
      // Body is raw Buffer because of express.raw(), parse it
      const payloadString = req.body.toString('utf8');
      const payloadData = JSON.parse(payloadString);
      const event = payloadData.event;
      
      if (event === 'payment.captured') {
        const paymentData = payloadData.payload.payment.entity;
        const order_id = paymentData.order_id;
        const payment_id = paymentData.id;

        // Update database transaction to SUCCESS and returning the row
        const { rows } = await pool.query(
          `UPDATE pg_transactions SET status = 'SUCCESS', payment_id = $1 WHERE order_id = $2 RETURNING *`,
          [payment_id, order_id]
        );
        console.log(`✅ Payment successful for order: ${order_id}`);

        // Send Email Receipt
        if (rows.length > 0) {
          const transaction = rows[0];
          const formattedReceiptNo = transaction.order_id
            ? transaction.order_id.replace(/^order_/, "HSYWA-")
            : `HSYWA-${String(transaction.id).padStart(6, "0")}`;
          await sendReceiptEmail({
            donor_email: transaction.email,
            donor_name: transaction.payer_name,
            receipt_no: formattedReceiptNo,
            amount: transaction.amount,
            fund_name: transaction.fund_type,
            receipt_date: transaction.created_at,
          });
        }
      }

      res.status(200).json({ status: "ok" });
    } else {
      res.status(400).json({ error: "Invalid signature" });
    }
  } catch (err) {
    console.error("WEBHOOK ERROR 👉", err.message);
    res.status(500).json({ error: "Webhook failed" });
  }
});

/* =====================================================
   2.5️⃣ MANUAL VERIFICATION (Frontend Fallback)
   POST /payment/verify
===================================================== */
router.post("/verify", express.json(), async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const secret = process.env.RAZORPAY_KEY_SECRET;

    let isValid = false;

    if (razorpay_order_id && razorpay_order_id.startsWith("order_test_") && process.env.NODE_ENV !== "production") {
      // Test order fallback for local development environment
      isValid = true;
    } else if (secret && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const shasum = crypto.createHmac('sha256', secret);
      shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const digest = shasum.digest('hex');
      isValid = (digest === razorpay_signature);
    }

    if (isValid) {
      const paymentId = razorpay_payment_id || `pay_test_${Date.now()}`;
      // Update database transaction to SUCCESS
      const { rows } = await pool.query(
        `UPDATE pg_transactions SET status = 'SUCCESS', payment_id = $1 WHERE order_id = $2 RETURNING *`,
        [paymentId, razorpay_order_id]
      );

      // Send Email Receipt
      if (rows.length > 0 && rows[0].status === 'SUCCESS') {
        const transaction = rows[0];
        const formattedReceiptNo = transaction.order_id
          ? transaction.order_id.replace(/^order_/, "HSYWA-")
          : `HSYWA-${String(transaction.id).padStart(6, "0")}`;
        try {
          await sendReceiptEmail({
            donor_email: transaction.email,
            donor_name: transaction.payer_name,
            receipt_no: formattedReceiptNo,
            amount: transaction.amount,
            fund_name: transaction.fund_type,
            receipt_date: transaction.created_at,
          });
        } catch (mailErr) {
          console.warn("Receipt email warning 👉", mailErr.message);
        }
      }

      res.json({ success: true, message: "Payment verified successfully" });
    } else {
      res.status(400).json({ error: "Invalid payment signature" });
    }
  } catch (err) {
    console.error("VERIFY PAYMENT ERROR 👉", err.message);
    res.status(500).json({ error: "Payment verification failed" });
  }
});

/* =====================================================
   3️⃣ GET ALL TRANSACTIONS (ADMIN/TREASURER)
   GET /payment/transactions
===================================================== */
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

router.get("/transactions", verifyToken, checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM pg_transactions ORDER BY created_at DESC`);
    res.json(rows);
  } catch (err) {
    console.error("FETCH TRANSACTIONS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

/* =====================================================
   4✅ GET MY TRANSACTIONS (MEMBER)
   GET /payment/my-transactions
===================================================== */
router.get("/my-transactions", verifyToken, async (req, res) => {
  try {
    const { id } = req.user;
    const userRes = await pool.query(`SELECT personal_email, phone FROM users WHERE id = $1`, [id]);
    const email = userRes.rows.length > 0 ? userRes.rows[0].personal_email : null;
    const phone = userRes.rows.length > 0 ? userRes.rows[0].phone : null;

    // 1. Online transactions
    let pgRows = [];
    try {
      const pgRes = await pool.query(
        `SELECT id::text, order_id, fund_type, amount, status, created_at, REPLACE(order_id, 'order_', 'HSYWA-') as receipt_no, 'ONLINE' as source 
         FROM pg_transactions 
         WHERE member_id = $1 OR (email IS NOT NULL AND email = $2) 
         ORDER BY created_at DESC`,
        [id, email]
      );
      pgRows = pgRes.rows;
    } catch (err1) {
      console.error("PG TRANSACTIONS QUERY ERROR 👉", err1.message);
    }

    // 2. Manual / Offline contributions
    let contRows = [];
    try {
      const contRes = await pool.query(
        `SELECT 
           c.id::text, 
           COALESCE(c.reference_no, c.receipt_no, CONCAT('DONATION_', c.id)) AS order_id,
           f.fund_name AS fund_type,
           c.amount,
           c.status,
           c.created_at,
           c.receipt_no,
           'OFFLINE' as source
         FROM contributions c
         LEFT JOIN funds f ON f.id = c.fund_id
         WHERE c.member_id = $1 OR (c.donor_phone IS NOT NULL AND c.donor_phone = $2)
         ORDER BY c.created_at DESC`,
        [id, phone]
      );
      contRows = contRes.rows.map((r) => ({
        ...r,
        status: r.status === "APPROVED" ? "SUCCESS" : r.status,
      }));
    } catch (err2) {
      console.error("CONTRIBUTIONS QUERY ERROR 👉", err2.message);
    }

    const combined = [...pgRows, ...contRows].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json(combined);
  } catch (err) {
    console.error("FETCH MY TRANSACTIONS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

/* =====================================================
   5✅ GET ALL FUND TYPES
   GET /payment/fund-types
===================================================== */
router.get("/fund-types", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT fund_name as name FROM funds WHERE status = 'ACTIVE' ORDER BY id ASC`);
    res.json(rows.map(r => r.name));
  } catch (err) {
    console.error("FETCH FUND TYPES ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to fetch fund types" });
  }
});

module.exports = router;
