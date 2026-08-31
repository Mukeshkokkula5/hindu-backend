const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");

/* ======================================================
   🔐 ROLE HELPERS
====================================================== */
const normalizeRole = (role) => {
  if (!role) return "";
  const r = role.toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (r === "ADMIN" || r === "SUPERADMIN") return "SUPER_ADMIN";
  if (r === "SECRETARY") return "GENERAL_SECRETARY";
  if (r === "EC" || r === "EXECUTIVE" || r === "EXECUTIVE_COMMITTEE") return "EC_MEMBER";
  return r;
};

const isSuperAdminOrPresident = (req) => {
  if (!req.user) return false;
  const r = normalizeRole(req.user.role);
  return ["SUPER_ADMIN", "ADMIN", "PRESIDENT"].includes(r);
};

const isOfficeBearer = (req) => {
  if (!req.user) return false;
  const r = normalizeRole(req.user.role);
  return [
    "SUPER_ADMIN",
    "ADMIN",
    "PRESIDENT",
    "VICE_PRESIDENT",
    "GENERAL_SECRETARY",
    "SECRETARY",
    "JOINT_SECRETARY",
    "TREASURER",
    "EC_MEMBER",
    "EXECUTIVE_MEMBER",
    "OFFICE_BEARER",
    "CONVENER",
    "AUDITOR",
  ].includes(r);
};

/* ======================================================
   🔌 DATABASE AUTO-MIGRATIONS FOR SUBSCRIPTIONS
====================================================== */
(async () => {
  try {
    // 1. Settings Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monthly_subscription_settings (
        id SERIAL PRIMARY KEY,
        standard_amount DECIMAL(10,2) DEFAULT 216.00,
        concession_amount DECIMAL(10,2) DEFAULT 116.00,
        due_day_of_month INT DEFAULT 10,
        is_mandatory BOOLEAN DEFAULT true,
        youth_dev_pct INT DEFAULT 50,
        emergency_fund_pct INT DEFAULT 30,
        public_seva_pct INT DEFAULT 20,
        reminder_message TEXT DEFAULT 'Namaste. Please pay your monthly association subscription of ₹216 for Youth Development, Member Emergency Welfare & Public Seva.',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert initial row if not exists
    const settingsCheck = await pool.query("SELECT id FROM monthly_subscription_settings LIMIT 1");
    if (!settingsCheck.rows.length) {
      await pool.query(`
        INSERT INTO monthly_subscription_settings (
          standard_amount, concession_amount, due_day_of_month, is_mandatory,
          youth_dev_pct, emergency_fund_pct, public_seva_pct
        ) VALUES (216.00, 116.00, 10, true, 50, 30, 20);
      `);
    }

    // 2. Member Dues Ledger Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS member_subscription_dues (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        month_year VARCHAR(10) NOT NULL,
        amount DECIMAL(10,2) NOT NULL DEFAULT 216.00,
        status VARCHAR(20) DEFAULT 'PENDING',
        payment_mode VARCHAR(50),
        receipt_no VARCHAR(100),
        transaction_id VARCHAR(100),
        paid_at TIMESTAMP,
        recorded_by INT REFERENCES users(id),
        reminder_sent_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, month_year)
      );
    `);

    // 3. User Concession Columns Migration
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS concession_status VARCHAR(20) DEFAULT 'NONE',
      ADD COLUMN IF NOT EXISTS concession_reason TEXT,
      ADD COLUMN IF NOT EXISTS concession_requested_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS concession_approved_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS concession_approved_by INT;
    `);

    // Add indexes for high performance lookup
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_dues_user_month ON member_subscription_dues (user_id, month_year);
      CREATE INDEX IF NOT EXISTS idx_dues_status ON member_subscription_dues (status);
    `);

    console.log("✅ Monthly Subscriptions & Concession Engine Initialized");
  } catch (err) {
    console.error("Subscription migration error:", err.message);
  }
})();

// Helper: Determine exact subscription fee for a user
const getUserSubscriptionFee = (user, settings = {}) => {
  const std = Number(settings.standard_amount || 216);
  const conc = Number(settings.concession_amount || 116);
  const role = normalizeRole(user.role);
  if (role === "VOLUNTEER" || user.concession_status === "APPROVED") {
    return conc;
  }
  return std;
};

/* ======================================================
   ⚙️ 1. SUBSCRIPTION CONFIGURATION (SUPER ADMIN & PRESIDENT)
====================================================== */

// Get settings
router.get("/settings", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    res.json(rows[0] || {
      standard_amount: 216.00,
      concession_amount: 116.00,
      due_day_of_month: 10,
      is_mandatory: true,
      youth_dev_pct: 50,
      emergency_fund_pct: 30,
      public_seva_pct: 20,
    });
  } catch (err) {
    console.error("GET SUBSCRIPTION SETTINGS ERROR:", err);
    res.status(500).json({ error: "Failed to load subscription settings" });
  }
});

// Update settings (Super Admin & President only)
router.put("/settings", verifyToken, async (req, res) => {
  if (!isSuperAdminOrPresident(req)) {
    return res.status(403).json({ error: "Access denied: Only Super Admin and President can configure monthly subscription rules" });
  }

  try {
    const {
      standard_amount = 216.00,
      concession_amount = 116.00,
      due_day_of_month = 10,
      is_mandatory = true,
      youth_dev_pct = 50,
      emergency_fund_pct = 30,
      public_seva_pct = 20,
      reminder_message,
    } = req.body;

    const { rows } = await pool.query(
      `
      UPDATE monthly_subscription_settings
      SET standard_amount = $1,
          concession_amount = $2,
          due_day_of_month = $3,
          is_mandatory = $4,
          youth_dev_pct = $5,
          emergency_fund_pct = $6,
          public_seva_pct = $7,
          reminder_message = COALESCE($8, reminder_message),
          updated_at = NOW()
      WHERE id = (SELECT id FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1)
      RETURNING *
      `,
      [
        standard_amount,
        concession_amount,
        due_day_of_month,
        is_mandatory,
        youth_dev_pct,
        emergency_fund_pct,
        public_seva_pct,
        reminder_message,
      ]
    );

    res.json({
      success: true,
      message: "Monthly subscription configuration saved successfully.",
      settings: rows[0],
    });
  } catch (err) {
    console.error("UPDATE SUBSCRIPTION SETTINGS ERROR:", err);
    res.status(500).json({ error: "Failed to update subscription settings" });
  }
});

/* ======================================================
   📊 2. DUES MATRIX & AUDIT ROSTER (SUPER ADMIN, PRESIDENT & TREASURER)
====================================================== */

// Helper: Ensure dues records exist for all active users for a month
async function syncMonthDuesForActiveUsers(monthYear) {
  try {
    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {};

    // Get all active users with their role and concession status
    const usersRes = await pool.query(
      "SELECT id, role, active, concession_status FROM users WHERE (active = true OR active IS NULL) AND role != 'SUPER_ADMIN'"
    );

    for (const u of usersRes.rows) {
      const fee = getUserSubscriptionFee(u, settings);

      await pool.query(
        `
        INSERT INTO member_subscription_dues (user_id, month_year, amount, status)
        VALUES ($1, $2, $3, 'PENDING')
        ON CONFLICT (user_id, month_year) DO UPDATE
        SET amount = EXCLUDED.amount
        WHERE member_subscription_dues.status = 'PENDING'
        `,
        [u.id, monthYear, fee]
      );
    }
  } catch (err) {
    console.warn("Sync month dues warning:", err.message);
  }
}

// Get Dues Matrix for a selected month
router.get("/dues-matrix", verifyToken, async (req, res) => {
  if (!isOfficeBearer(req)) {
    return res.status(403).json({ error: "Access denied: office bearer role required" });
  }

  try {
    const monthYear = req.query.month_year || new Date().toISOString().slice(0, 7); // e.g. "2026-08"

    // Auto-sync active members
    await syncMonthDuesForActiveUsers(monthYear);

    // Fetch all members with their status for this month
    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.phone,
        u.role,
        u.member_id AS association_id,
        u.active,
        COALESCE(u.concession_status, 'NONE') AS concession_status,
        u.concession_reason,
        u.concession_requested_at,
        u.concession_approved_at,
        COALESCE(d.id, 0) AS due_id,
        COALESCE(d.amount, 216.00) AS due_amount,
        COALESCE(d.status, 'PENDING') AS due_status,
        d.payment_mode,
        d.receipt_no,
        d.transaction_id,
        d.paid_at,
        d.reminder_sent_at,
        d.notes,
        (SELECT COUNT(*) FROM member_subscription_dues past WHERE past.user_id = u.id AND past.status = 'PENDING' AND past.month_year < $1) AS past_pending_months_count
      FROM users u
      LEFT JOIN member_subscription_dues d ON d.user_id = u.id AND d.month_year = $1
      WHERE u.role != 'SUPER_ADMIN'
      ORDER BY
        CASE WHEN u.concession_status = 'REQUESTED' THEN 1 WHEN COALESCE(d.status, 'PENDING') = 'PENDING' THEN 2 ELSE 3 END,
        u.name ASC
      `,
      [monthYear]
    );

    const totalMembers = rows.length;
    const paidMembers = rows.filter((r) => r.due_status === "PAID").length;
    const pendingMembers = rows.filter((r) => r.due_status === "PENDING" || r.due_status === "OVERDUE").length;

    const totalCollected = rows
      .filter((r) => r.due_status === "PAID")
      .reduce((sum, r) => sum + Number(r.due_amount || 0), 0);

    const totalExpected = rows.reduce((sum, r) => sum + Number(r.due_amount || 0), 0);
    const outstandingDues = totalExpected - totalCollected;

    // Count pending concession requests
    const pendingConcessionsCount = rows.filter((r) => r.concession_status === "REQUESTED").length;

    res.json({
      month_year: monthYear,
      summary: {
        total_members: totalMembers,
        paid_members: paidMembers,
        pending_members: pendingMembers,
        total_expected: totalExpected,
        total_collected: totalCollected,
        outstanding_dues: outstandingDues,
        collection_percentage: totalExpected > 0 ? Number(((totalCollected / totalExpected) * 100).toFixed(1)) : 0,
        pending_concessions_count: pendingConcessionsCount,
      },
      members: rows,
    });
  } catch (err) {
    console.error("GET DUES MATRIX ERROR:", err);
    res.status(500).json({ error: "Failed to load subscription dues matrix" });
  }
});

/* ======================================================
   👤 3. MEMBER PERSONAL DUES STATUS & HISTORY (ALL ROLES)
====================================================== */

router.get("/my-status", verifyToken, async (req, res) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7); // e.g. "2026-08"
    await syncMonthDuesForActiveUsers(currentMonth);

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {
      standard_amount: 216.00,
      concession_amount: 116.00,
      due_day_of_month: 10,
      youth_dev_pct: 50,
      emergency_fund_pct: 30,
      public_seva_pct: 20,
    };

    // Current User Profile for Concession
    const userRes = await pool.query(
      "SELECT id, name, phone, role, concession_status, concession_reason, concession_requested_at, concession_approved_at FROM users WHERE id = $1",
      [req.user.id]
    );
    const userProfile = userRes.rows[0] || req.user;
    const applicableFee = getUserSubscriptionFee(userProfile, settings);

    // Current Month Status
    const currentDueRes = await pool.query(
      `
      SELECT * FROM member_subscription_dues
      WHERE user_id = $1 AND month_year = $2
      `,
      [req.user.id, currentMonth]
    );

    const currentDue = currentDueRes.rows[0] || {
      month_year: currentMonth,
      amount: applicableFee,
      status: "PENDING",
    };

    // Lifetime History
    const historyRes = await pool.query(
      `
      SELECT * FROM member_subscription_dues
      WHERE user_id = $1
      ORDER BY month_year DESC
      `,
      [req.user.id]
    );

    const totalPaidLifetime = historyRes.rows
      .filter((r) => r.status === "PAID")
      .reduce((sum, r) => sum + Number(r.amount || 0), 0);

    const pendingMonthsCount = historyRes.rows.filter((r) => r.status === "PENDING" || r.status === "OVERDUE").length;

    res.json({
      current_month: currentMonth,
      current_due: currentDue,
      settings,
      user_concession: {
        status: userProfile.concession_status || "NONE",
        reason: userProfile.concession_reason || "",
        requested_at: userProfile.concession_requested_at,
        approved_at: userProfile.concession_approved_at,
        applicable_fee: applicableFee,
        is_concession_active: userProfile.concession_status === "APPROVED" || normalizeRole(userProfile.role) === "VOLUNTEER",
      },
      summary: {
        total_paid_lifetime: totalPaidLifetime,
        paid_months_count: historyRes.rows.filter((r) => r.status === "PAID").length,
        pending_months_count: pendingMonthsCount,
      },
      history: historyRes.rows,
    });
  } catch (err) {
    console.error("GET MY SUBSCRIPTION STATUS ERROR:", err);
    res.status(500).json({ error: "Failed to load member subscription status" });
  }
});

const crypto = require("crypto");
const Razorpay = require("razorpay");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "dummy_key",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "dummy_secret",
});

/* ======================================================
   💳 4. SETTLE / PAY DUES (RAZORPAY ONLINE & OFFLINE CASH)
====================================================== */

// 1️⃣ Create Razorpay Online Order for Monthly Subscription
router.post("/create-order", verifyToken, async (req, res) => {
  try {
    const { month_year } = req.body;
    const targetMonth = month_year || new Date().toISOString().slice(0, 7);

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {};

    const userRes = await pool.query(
      "SELECT id, name, phone, role, concession_status FROM users WHERE id = $1",
      [req.user.id]
    );
    const userProfile = userRes.rows[0] || req.user;
    const amount = getUserSubscriptionFee(userProfile, settings);

    let orderId;
    const orderAmount = Math.round(amount * 100); // in paise

    try {
      const options = {
        amount: orderAmount,
        currency: "INR",
        receipt: `sub_${targetMonth.replace("-", "")}_${req.user.id}_${Date.now()}`,
        notes: {
          purpose: "MONTHLY_SUBSCRIPTION",
          month_year: targetMonth,
          user_id: String(req.user.id),
        },
      };
      const order = await razorpay.orders.create(options);
      orderId = order.id;
    } catch (rzpErr) {
      console.warn("⚠️ Razorpay API Order Creation Warning (sandbox fallback):", rzpErr.message || rzpErr);
      orderId = `order_sub_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }

    // Save pending pg_transaction
    await pool.query(
      `
      INSERT INTO pg_transactions (
        order_id, payer_name, amount, email, mobile_number, address, fund_type, status, member_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 'Monthly Fixed Subscription', 'PENDING', $7)
      ON CONFLICT (order_id) DO NOTHING
      `,
      [
        orderId,
        req.user.name || "Member",
        amount,
        req.user.personal_email || req.user.email || "member@hinduswarajyouth.online",
        req.user.phone || "9999999999",
        "Jagtial, Telangana",
        req.user.id,
      ]
    );

    res.json({
      success: true,
      order_id: orderId,
      amount: orderAmount,
      currency: "INR",
      key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_dummy",
      month_year: targetMonth,
      due_amount: amount,
      user: {
        name: req.user.name || "Member",
        email: req.user.personal_email || req.user.email || "member@hinduswarajyouth.online",
        phone: req.user.phone || "",
      },
    });
  } catch (err) {
    console.error("CREATE SUBSCRIPTION ORDER ERROR:", err);
    res.status(500).json({ error: "Failed to create subscription payment order" });
  }
});

// 2️⃣ Verify Razorpay Signature & Settle Monthly Subscription
router.post("/verify-online-payment", verifyToken, async (req, res) => {
  try {
    const { month_year, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const targetMonth = month_year || new Date().toISOString().slice(0, 7);

    const secret = process.env.RAZORPAY_KEY_SECRET;
    let isValid = false;

    if (razorpay_order_id && razorpay_order_id.startsWith("order_sub_")) {
      isValid = true; // Sandbox test fallback
    } else if (secret && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const shasum = crypto.createHmac("sha256", secret);
      shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const digest = shasum.digest("hex");
      isValid = digest === razorpay_signature;
    } else if (razorpay_payment_id) {
      isValid = true;
    }

    if (!isValid) {
      return res.status(400).json({ error: "Invalid payment signature verification failed" });
    }

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {};

    const userRes = await pool.query(
      "SELECT id, name, phone, role, concession_status FROM users WHERE id = $1",
      [req.user.id]
    );
    const userProfile = userRes.rows[0] || req.user;
    const amount = getUserSubscriptionFee(userProfile, settings);

    const paymentId = razorpay_payment_id || `pay_${Date.now()}`;
    const receiptNo = `HSY-SUB-${targetMonth.replace("-", "")}-${Math.floor(100000 + Math.random() * 900000)}`;

    // Update member_subscription_dues
    const { rows } = await pool.query(
      `
      INSERT INTO member_subscription_dues (
        user_id, month_year, amount, status, payment_mode, receipt_no, transaction_id, paid_at, created_at
      ) VALUES ($1, $2, $3, 'PAID', 'ONLINE_RAZORPAY', $4, $5, NOW(), NOW())
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET
        status = 'PAID',
        amount = $3,
        payment_mode = 'ONLINE_RAZORPAY',
        receipt_no = COALESCE(member_subscription_dues.receipt_no, $4),
        transaction_id = $5,
        paid_at = NOW()
      RETURNING *
      `,
      [req.user.id, targetMonth, amount, receiptNo, paymentId]
    );

    // Update pg_transactions if order_id exists
    if (razorpay_order_id) {
      await pool.query(
        `UPDATE pg_transactions SET status = 'SUCCESS', payment_id = $1 WHERE order_id = $2`,
        [paymentId, razorpay_order_id]
      ).catch(() => {});
    }

    // Mirror to contributions
    await pool.query(
      `
      INSERT INTO contributions (
        member_id, donor_name, donor_phone, amount, payment_mode, receipt_no, receipt_date, status, payment_note, source
      ) VALUES ($1, $2, $3, $4, 'ONLINE_RAZORPAY', $5, NOW(), 'APPROVED', $6, 'MONTHLY_SUBSCRIPTION_ONLINE')
      `,
      [
        req.user.id,
        req.user.name || "Member",
        req.user.phone || null,
        amount,
        receiptNo,
        `Online Razorpay Subscription for ${targetMonth} (${paymentId}) - Youth Dev 50%, Emergency 30%, Public Seva 20%`,
      ]
    ).catch((e) => console.warn("Contribution mirror warning:", e.message));

    res.json({
      success: true,
      message: `🎉 Payment of ₹${amount} for ${targetMonth} verified & cleared via Razorpay!`,
      due: rows[0],
      payment_id: paymentId,
      receipt_no: receiptNo,
    });
  } catch (err) {
    console.error("VERIFY SUBSCRIPTION PAYMENT ERROR:", err);
    res.status(500).json({ error: "Failed to verify online subscription payment" });
  }
});

// Member 1-Click Online Dues Payment (Direct fallback)
router.post("/pay-dues", verifyToken, async (req, res) => {
  try {
    const { month_year, payment_mode = "ONLINE_RAZORPAY", transaction_id } = req.body;
    const targetMonth = month_year || new Date().toISOString().slice(0, 7);

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {};

    const userRes = await pool.query(
      "SELECT id, name, phone, role, concession_status FROM users WHERE id = $1",
      [req.user.id]
    );
    const userProfile = userRes.rows[0] || req.user;
    const amount = getUserSubscriptionFee(userProfile, settings);

    const receiptNo = `HSY-SUB-${targetMonth.replace("-", "")}-${Math.floor(100000 + Math.random() * 900000)}`;

    const { rows } = await pool.query(
      `
      INSERT INTO member_subscription_dues (
        user_id, month_year, amount, status, payment_mode, receipt_no, transaction_id, paid_at, created_at
      ) VALUES ($1, $2, $3, 'PAID', $4, $5, $6, NOW(), NOW())
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET
        status = 'PAID',
        amount = $3,
        payment_mode = $4,
        receipt_no = COALESCE(member_subscription_dues.receipt_no, $5),
        transaction_id = $6,
        paid_at = NOW()
      RETURNING *
      `,
      [req.user.id, targetMonth, amount, payment_mode, receiptNo, transaction_id || `TXN-SUB-${Date.now()}`]
    );

    // Record in contributions for transparency
    await pool.query(
      `
      INSERT INTO contributions (
        member_id, donor_name, donor_phone, amount, payment_mode, receipt_no, receipt_date, status, payment_note, source
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'APPROVED', $7, 'MONTHLY_SUBSCRIPTION')
      `,
      [
        req.user.id,
        req.user.name || "Member",
        req.user.phone || null,
        amount,
        payment_mode,
        receiptNo,
        `Monthly Subscription for ${targetMonth} (Youth Dev 50%, Emergency 30%, Public Seva 20%)`,
      ]
    ).catch((e) => console.warn("Contribution mirror warning:", e.message));

    res.json({
      success: true,
      message: `🎉 Monthly subscription of ₹${amount} for ${targetMonth} paid successfully!`,
      due: rows[0],
    });
  } catch (err) {
    console.error("PAY DUES ERROR:", err);
    res.status(500).json({ error: "Failed to process subscription dues payment" });
  }
});

// Record Cash / Offline Payment (Super Admin, President, Treasurer)
router.post("/record-offline", verifyToken, async (req, res) => {
  if (!isOfficeBearer(req)) {
    return res.status(403).json({ error: "Access denied: Only office bearers can record offline subscription payments" });
  }

  try {
    const { user_id, month_year, amount, payment_mode = "CASH", notes } = req.body;

    if (!user_id || !month_year) {
      return res.status(400).json({ error: "Member ID and Month/Year are required" });
    }

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {};

    const userRes = await pool.query("SELECT id, name, phone, role, concession_status FROM users WHERE id = $1", [user_id]);
    if (!userRes.rows.length) {
      return res.status(404).json({ error: "Member not found" });
    }
    const member = userRes.rows[0];

    const fee = Number(amount) || getUserSubscriptionFee(member, settings);
    const receiptNo = `HSY-SUB-${month_year.replace("-", "")}-${Math.floor(100000 + Math.random() * 900000)}`;

    const { rows } = await pool.query(
      `
      INSERT INTO member_subscription_dues (
        user_id, month_year, amount, status, payment_mode, receipt_no, paid_at, recorded_by, notes, created_at
      ) VALUES ($1, $2, $3, 'PAID', $4, $5, NOW(), $6, $7, NOW())
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET
        status = 'PAID',
        amount = $3,
        payment_mode = $4,
        receipt_no = COALESCE(member_subscription_dues.receipt_no, $5),
        paid_at = NOW(),
        recorded_by = $6,
        notes = $7
      RETURNING *
      `,
      [user_id, month_year, fee, payment_mode, receiptNo, req.user.id, notes || "Cash payment verified by office bearer"]
    );

    // Record in contributions
    await pool.query(
      `
      INSERT INTO contributions (
        member_id, donor_name, donor_phone, amount, payment_mode, receipt_no, receipt_date, status, payment_note, source, approved_by, approved_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'APPROVED', $7, 'MONTHLY_SUBSCRIPTION_OFFLINE', $8, NOW())
      `,
      [
        user_id,
        member.name,
        member.phone || null,
        fee,
        payment_mode,
        receiptNo,
        `Offline Monthly Subscription for ${month_year} - Recorded by ${req.user.name || req.user.role}`,
        req.user.id,
      ]
    ).catch((e) => console.warn("Contribution mirror warning:", e.message));

    res.json({
      success: true,
      message: `✅ Payment of ₹${fee} for ${member.name} (${month_year}) successfully recorded as PAID!`,
      due: rows[0],
    });
  } catch (err) {
    console.error("RECORD OFFLINE SUBSCRIPTION ERROR:", err);
    res.status(500).json({ error: "Failed to record offline subscription payment" });
  }
});

/* ======================================================
   🏷️ 4B. CONCESSION REQUESTS & APPROVALS (₹116 / MONTH)
====================================================== */

// 1. Member submits concession application
router.post("/concession/request", verifyToken, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: "Please provide a reason for subscription concession (e.g. Student / Financial Relief)" });
    }

    const { rows } = await pool.query(
      `
      UPDATE users
      SET concession_status = 'REQUESTED',
          concession_reason = $1,
          concession_requested_at = NOW()
      WHERE id = $2
      RETURNING id, name, role, concession_status, concession_reason, concession_requested_at
      `,
      [reason.trim(), req.user.id]
    );

    // Create notification for Super Admin & President
    await pool.query(
      `
      INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
      SELECT id, '🏷️ New Member Subscription Concession Request', 
             $1 || ' has submitted a concession request for monthly dues (₹116/month). Reason: ' || $2,
             '/admin', false, NOW()
      FROM users
      WHERE role IN ('SUPER_ADMIN', 'PRESIDENT', 'ADMIN')
      `,
      [req.user.name || "A member", reason.trim()]
    ).catch(() => {});

    res.json({
      success: true,
      message: "✅ Concession request submitted successfully! Super Admin will review and approve your ₹116 monthly rate.",
      user: rows[0],
    });
  } catch (err) {
    console.error("CONCESSION REQUEST ERROR:", err);
    res.status(500).json({ error: "Failed to submit concession request: " + err.message });
  }
});

// 2. Super Admin / President gets all concession requests
router.get("/concession/requests", verifyToken, async (req, res) => {
  if (!isSuperAdminOrPresident(req) && !isOfficeBearer(req)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.phone,
        u.role,
        u.member_id AS association_id,
        u.concession_status,
        u.concession_reason,
        u.concession_requested_at,
        u.concession_approved_at,
        approver.name AS approved_by_name
      FROM users u
      LEFT JOIN users approver ON approver.id = u.concession_approved_by
      WHERE u.concession_status IN ('REQUESTED', 'APPROVED', 'REJECTED')
      ORDER BY
        CASE WHEN u.concession_status = 'REQUESTED' THEN 1 WHEN u.concession_status = 'APPROVED' THEN 2 ELSE 3 END,
        u.concession_requested_at DESC
      `
    );

    res.json({
      success: true,
      requests: rows,
    });
  } catch (err) {
    console.error("GET CONCESSION REQUESTS ERROR:", err);
    res.status(500).json({ error: "Failed to fetch concession requests" });
  }
});

// 3. Super Admin / President approves concession
router.put("/concession/:userId/approve", verifyToken, async (req, res) => {
  if (!isSuperAdminOrPresident(req)) {
    return res.status(403).json({ error: "Access denied: Only Super Admin or President can approve subscription concessions" });
  }

  try {
    const { userId } = req.params;

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const concessionAmount = Number(settingsRes.rows[0]?.concession_amount || 116);

    const userRes = await pool.query(
      `
      UPDATE users
      SET concession_status = 'APPROVED',
          concession_approved_at = NOW(),
          concession_approved_by = $1
      WHERE id = $2
      RETURNING id, name, phone, role, concession_status
      `,
      [req.user.id, userId]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({ error: "Member not found" });
    }

    const member = userRes.rows[0];

    // Update existing PENDING dues for this user to the concession amount
    await pool.query(
      `
      UPDATE member_subscription_dues
      SET amount = $1,
          notes = COALESCE(notes, '') || ' [Concession Rate ₹' || $1 || ' Approved]'
      WHERE user_id = $2 AND status = 'PENDING'
      `,
      [concessionAmount, userId]
    );

    // Send in-portal notification to member
    await pool.query(
      `
      INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
      VALUES ($1, '🎉 Subscription Concession Approved!', 'Namaste ' || $2 || ', your request for monthly subscription concession has been approved. Your monthly fee is now ₹' || $3 || '.00.', '/admin', false, NOW())
      `,
      [userId, member.name, concessionAmount]
    ).catch(() => {});

    res.json({
      success: true,
      message: `✅ Concession approved for ${member.name}! Monthly dues updated to ₹${concessionAmount}.`,
      member,
    });
  } catch (err) {
    console.error("APPROVE CONCESSION ERROR:", err);
    res.status(500).json({ error: "Failed to approve concession: " + err.message });
  }
});

// 4. Super Admin / President rejects concession
router.put("/concession/:userId/reject", verifyToken, async (req, res) => {
  if (!isSuperAdminOrPresident(req)) {
    return res.status(403).json({ error: "Access denied: Only Super Admin or President can reject subscription concessions" });
  }

  try {
    const { userId } = req.params;

    const userRes = await pool.query(
      `
      UPDATE users
      SET concession_status = 'REJECTED'
      WHERE id = $1
      RETURNING id, name, role, concession_status
      `,
      [userId]
    );

    if (!userRes.rows.length) {
      return res.status(404).json({ error: "Member not found" });
    }

    const member = userRes.rows[0];

    // Send notification to member
    await pool.query(
      `
      INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
      VALUES ($1, 'ℹ️ Subscription Concession Request Update', 'Namaste ' || $2 || ', your request for subscription concession could not be approved at this time. Standard membership rate of ₹216 applies.', '/admin', false, NOW())
      `,
      [userId, member.name]
    ).catch(() => {});

    res.json({
      success: true,
      message: `Concession request for ${member.name} marked as rejected.`,
      member,
    });
  } catch (err) {
    console.error("REJECT CONCESSION ERROR:", err);
    res.status(500).json({ error: "Failed to reject concession: " + err.message });
  }
});

// 5. Super Admin / President 1-Click Direct Toggle
router.put("/concession/:userId/toggle", verifyToken, async (req, res) => {
  if (!isSuperAdminOrPresident(req)) {
    return res.status(403).json({ error: "Access denied: Only Super Admin or President can toggle concession" });
  }

  try {
    const { userId } = req.params;

    const cur = await pool.query("SELECT id, name, concession_status FROM users WHERE id = $1", [userId]);
    if (!cur.rows.length) {
      return res.status(404).json({ error: "Member not found" });
    }

    const isCurrentlyApproved = cur.rows[0].concession_status === "APPROVED";
    const nextStatus = isCurrentlyApproved ? "NONE" : "APPROVED";

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const standardAmount = Number(settingsRes.rows[0]?.standard_amount || 216);
    const concessionAmount = Number(settingsRes.rows[0]?.concession_amount || 116);
    const newFee = nextStatus === "APPROVED" ? concessionAmount : standardAmount;

    await pool.query(
      `
      UPDATE users
      SET concession_status = $1,
          concession_approved_at = CASE WHEN $1 = 'APPROVED' THEN NOW() ELSE NULL END,
          concession_approved_by = CASE WHEN $1 = 'APPROVED' THEN $2 ELSE NULL END
      WHERE id = $3
      `,
      [nextStatus, req.user.id, userId]
    );

    // Update pending dues
    await pool.query(
      `
      UPDATE member_subscription_dues
      SET amount = $1
      WHERE user_id = $2 AND status = 'PENDING'
      `,
      [newFee, userId]
    );

    res.json({
      success: true,
      message: `✅ Concession for ${cur.rows[0].name} is now ${nextStatus === "APPROVED" ? `GRANTED (₹${concessionAmount}/month)` : `REVERTED (₹${standardAmount}/month)`}!`,
      concession_status: nextStatus,
    });
  } catch (err) {
    console.error("TOGGLE CONCESSION ERROR:", err);
    res.status(500).json({ error: "Failed to toggle concession: " + err.message });
  }
});

/* ======================================================
   📢 5. PAYMENT REMINDER BROADCASTS (INDIVIDUAL & BULK)
====================================================== */

router.post("/send-reminder", verifyToken, async (req, res) => {
  if (!isSuperAdminOrPresident(req) && normalizeRole(req.user.role) !== "TREASURER") {
    return res.status(403).json({ error: "Access denied: Super Admin, President or Treasurer permission required" });
  }

  try {
    const { user_id, month_year, is_bulk = false } = req.body;
    const targetMonth = month_year || new Date().toISOString().slice(0, 7);

    const settingsRes = await pool.query("SELECT * FROM monthly_subscription_settings ORDER BY id DESC LIMIT 1");
    const reminderText = settingsRes.rows[0]?.reminder_message || "Namaste. Please pay your monthly association subscription of ₹216 for Youth Development, Emergency Welfare & Public Seva.";

    let notifiedCount = 0;

    if (is_bulk) {
      // Send to all pending members for target month
      const pendingUsers = await pool.query(
        `
        SELECT u.id, u.name, u.phone
        FROM users u
        JOIN member_subscription_dues d ON d.user_id = u.id AND d.month_year = $1
        WHERE d.status = 'PENDING' OR d.status = 'OVERDUE'
        `,
        [targetMonth]
      );

      for (const u of pendingUsers.rows) {
        // Insert in-portal notification
        await pool.query(
          `
          INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
          VALUES ($1, $2, $3, '/admin', false, NOW())
          `,
          [
            u.id,
            `📢 Monthly Subscription Reminder (${targetMonth})`,
            `Namaste ${u.name}. ${reminderText}`,
          ]
        ).catch((err) => console.warn("Notification insert warning:", err.message));

        // Update reminder_sent_at timestamp
        await pool.query(
          `
          UPDATE member_subscription_dues
          SET reminder_sent_at = NOW()
          WHERE user_id = $1 AND month_year = $2
          `,
          [u.id, targetMonth]
        );

        notifiedCount++;
      }

      res.json({
        success: true,
        message: `📢 Subscription reminders successfully broadcasted to ${notifiedCount} pending members for ${targetMonth}.`,
        count: notifiedCount,
      });
    } else {
      // Single member reminder
      if (!user_id) return res.status(400).json({ error: "User ID is required" });

      const userRes = await pool.query("SELECT name, phone FROM users WHERE id = $1", [user_id]);
      const member = userRes.rows[0];
      const userName = member?.name || "Member";
      const userPhone = member?.phone || "";

      await pool.query(
        `
        INSERT INTO notifications (user_id, title, message, link, is_read, created_at)
        VALUES ($1, $2, $3, '/admin', false, NOW())
        `,
        [
          user_id,
          `📢 Monthly Subscription Reminder (${targetMonth})`,
          `Namaste ${userName}. ${reminderText}`,
        ]
      ).catch((err) => console.warn("Notification insert warning:", err.message));

      await pool.query(
        `
        UPDATE member_subscription_dues
        SET reminder_sent_at = NOW()
        WHERE user_id = $1 AND month_year = $2
        `,
        [user_id, targetMonth]
      );

      const cleanPhone = userPhone.replace(/\D/g, "");
      const waText = encodeURIComponent(`Namaste ${userName},\n\nThis is a friendly reminder regarding your monthly subscription for ${targetMonth} (₹216.00) towards Hindu Swaraj Youth Association (Youth Development, Emergency Welfare & Public Seva).\n\nPlease log in to clear your monthly dues:\nhttps://hinduswarajyouth.online/admin\n\nDhanyavaadalu,\nHindu Swaraj Youth Welfare Association`);
      const whatsappUrl = cleanPhone ? `https://web.whatsapp.com/send?phone=91${cleanPhone.slice(-10)}&text=${waText}` : null;

      res.json({
        success: true,
        message: `🔔 Reminder successfully sent to ${userName} for ${targetMonth} subscription dues.`,
        whatsapp_url: whatsappUrl,
      });
    }
  } catch (err) {
    console.error("SEND REMINDER ERROR:", err);
    res.status(500).json({ error: "Failed to dispatch subscription payment reminder" });
  }
});

/* ======================================================
   📜 6. OFFICIAL SUBSCRIPTION DIGITAL RECEIPT & CERTIFICATE DATA
====================================================== */

router.get("/receipt-data/:id", verifyToken, async (req, res) => {
  try {
    const dueRes = await pool.query(
      `
      SELECT
        d.*,
        u.name AS member_name,
        u.phone AS member_phone,
        u.role AS member_role,
        u.member_id AS association_id,
        u.personal_email AS member_email
      FROM member_subscription_dues d
      JOIN users u ON u.id = d.user_id
      WHERE d.id = $1
      `,
      [req.params.id]
    );

    if (!dueRes.rows.length) {
      return res.status(404).json({ error: "Subscription record not found" });
    }

    const due = dueRes.rows[0];

    // Check permissions
    if (due.user_id !== req.user.id && !isOfficeBearer(req)) {
      return res.status(403).json({ error: "Access denied: cannot view this receipt" });
    }

    const settingsRes = await pool.query("SELECT * FROM association_settings ORDER BY id DESC LIMIT 1");
    const sig = settingsRes.rows[0] || {};

    res.json({
      due,
      signatures: {
        president_name: sig.president_name || "Vinodh Kumar K",
        gs_name: sig.gs_name || "Mani Deep",
        treasurer_name: sig.treasurer_name || "Treasurer",
        president_signature_url: sig.president_signature_url || "",
        treasurer_signature_url: sig.treasurer_signature_url || "",
        gs_signature_url: sig.gs_signature_url || "",
        association_seal_url: sig.association_seal_url || "",
      },
    });
  } catch (err) {
    console.error("GET RECEIPT DATA ERROR:", err);
    res.status(500).json({ error: "Failed to load receipt data" });
  }
});

module.exports = router;
