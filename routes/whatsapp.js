const express = require("express");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const pool = require("../db");
const {
  initWhatsApp,
  getWhatsAppStatus,
  sendDirectWhatsApp,
  logoutWhatsApp,
  broadcastEmergencyBloodAlertWhatsApp,
} = require("../services/whatsappBot");

const router = express.Router();

/* =====================================================
   📡 1. GET WHATSAPP GATEWAY CONNECTION STATUS
   GET /whatsapp/status
===================================================== */
router.get("/status", verifyToken, async (req, res) => {
  try {
    const status = getWhatsAppStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (err) {
    console.error("WhatsApp status error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   🔄 2. INITIALIZE / REFRESH WHATSAPP QR CODE
   POST /whatsapp/init
===================================================== */
router.post(
  "/init",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const { forceNew = false } = req.body || {};
      const result = await initWhatsApp(forceNew);
      res.json({
        success: true,
        message: "WhatsApp Gateway initialization requested.",
        ...getWhatsAppStatus(),
        ...result,
      });
    } catch (err) {
      console.error("WhatsApp init error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   🔒 3. LOGOUT / DISCONNECT WHATSAPP SESSION
   POST /whatsapp/logout
===================================================== */
router.post(
  "/logout",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const result = await logoutWhatsApp();
      res.json({
        success: true,
        ...result,
        ...getWhatsAppStatus(),
      });
    } catch (err) {
      console.error("WhatsApp logout error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   💬 4. SEND DIRECT TEST WHATSAPP MESSAGE
   POST /whatsapp/send-test
===================================================== */
router.post(
  "/send-test",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "TREASURER"),
  async (req, res) => {
    try {
      const { phone, message } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, error: "Phone number is required." });
      }

      const defaultMsg = `🚩 *Hindu Swaraj Youth Association • Test Message* 🚩\n\nనమస్తే! This is a test WhatsApp message from Hindu Swaraj Youth Association automated system.\n\nDate: ${new Date().toLocaleString("en-IN")}\nStatus: ✅ Active & Ready`;
      const textToSend = message && message.trim() ? message.trim() : defaultMsg;

      const result = await sendDirectWhatsApp(phone, textToSend);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json({
        success: true,
        message: `✅ Test WhatsApp message delivered directly to ${phone}!`,
        ...result,
      });
    } catch (err) {
      console.error("WhatsApp send test error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   ⚡ 4B. INTERNAL DIRECT WHATSAPP API (FOR CLOUD / DELEGATION)
   POST /whatsapp/send-direct-api
===================================================== */
router.post("/send-direct-api", async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, error: "Phone and message are required." });
    }

    const result = await sendDirectWhatsApp(phone, message);
    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: `✅ Message delivered directly to ${phone}!`,
      ...result,
    });
  } catch (err) {
    console.error("WhatsApp send-direct-api error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   📢 5. CUSTOM ANNOUNCEMENT BROADCAST (ADMIN)
   POST /whatsapp/broadcast-custom
===================================================== */
router.post(
  "/broadcast-custom",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { message, target = "ALL" } = req.body; // ALL | MEMBERS | VOLUNTEERS
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: "Broadcast message is required." });
      }

      const status = getWhatsAppStatus();
      if (!status.isConnected) {
        return res.status(400).json({
          success: false,
          error: "WhatsApp Gateway is not connected. Please scan the QR code in Admin Dashboard.",
        });
      }

      // Fetch targets
      const [usersRes, volRes] = await Promise.all([
        pool.query("SELECT id, name, phone, role FROM users WHERE phone IS NOT NULL AND phone != ''"),
        pool.query("SELECT id, name, phone FROM volunteers WHERE phone IS NOT NULL AND phone != ''"),
      ]);

      const targetPhones = new Map();

      if (target === "ALL" || target === "MEMBERS") {
        usersRes.rows.forEach((u) => {
          const clean = (u.phone || "").replace(/\D/g, "");
          if (clean.length >= 10) targetPhones.set(clean.slice(-10), { name: u.name, type: "MEMBER" });
        });
      }

      if (target === "ALL" || target === "VOLUNTEERS") {
        volRes.rows.forEach((v) => {
          const clean = (v.phone || "").replace(/\D/g, "");
          if (clean.length >= 10 && !targetPhones.has(clean.slice(-10))) {
            targetPhones.set(clean.slice(-10), { name: v.name, type: "VOLUNTEER" });
          }
        });
      }

      const header = `📢 *HINDU SWARAJ YOUTH WELFARE ASSOCIATION*\n॥ అధికారిక సమాచారం • JAGTIAL ॥\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      const footer = `\n\n━━━━━━━━━━━━━━━━━━━━\n_హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ (Regd. No: 784/2025)_\nHelpline: +91 8499878425`;
      const fullText = header + message.trim() + footer;

      let sentCount = 0;
      for (const [phone10] of targetPhones) {
        try {
          const ok = await sendDirectWhatsApp(`91${phone10}`, fullText);
          if (ok.success) sentCount++;
        } catch (e) {
          console.error(`Broadcast error for ${phone10}:`, e.message);
        }
        await new Promise((r) => setTimeout(r, 1200));
      }

      res.json({
        success: true,
        message: `📢 Broadcast dispatched to ${sentCount}/${targetPhones.size} contacts via WhatsApp!`,
        total_targets: targetPhones.size,
        sent_count: sentCount,
      });
    } catch (err) {
      console.error("WhatsApp broadcast custom error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
