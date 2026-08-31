const Baileys = require("@whiskeysockets/baileys");
const makeWASocket = Baileys.default || Baileys.makeWASocket || Baileys;
const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = Baileys;
const pino = require("pino");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const pool = require("../db");

// Session storage directory
const authDir = process.env.VERCEL
  ? path.join("/tmp", "baileys_auth_hsy")
  : path.join(__dirname, "..", "auth_info_baileys");

if (!fs.existsSync(authDir)) {
  try {
    fs.mkdirSync(authDir, { recursive: true });
  } catch (e) {}
}

// Global state
let sock = null;
let connectionStatus = "DISCONNECTED"; // DISCONNECTED | SCAN_QR_CODE | CONNECTING | CONNECTED
let qrCodeRaw = "";
let qrCodeDataUrl = "";
let connectedUserJid = "";
let connectedPhoneNumber = "";
let lastConnectedAt = null;
let isReconnecting = false;

/**
 * Clean and format phone number to international WhatsApp JID
 * e.g. "98480 12345" -> "919848012345@s.whatsapp.net"
 */
function formatToWhatsAppJid(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) {
    digits = "91" + digits;
  } else if (digits.length === 12 && digits.startsWith("91")) {
    // already 91
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = "91" + digits.slice(1);
  }
  if (digits.length < 10) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * Initialize Baileys WhatsApp Socket & await QR code generation
 */
async function initWhatsApp(forceNew = false) {
  if (sock && connectionStatus === "CONNECTED" && !forceNew) {
    return {
      status: connectionStatus,
      isConnected: true,
      connectedPhoneNumber,
      lastConnectedAt,
    };
  }

  if (forceNew && sock) {
    try {
      sock.end();
      sock = null;
    } catch (e) {}
  }

  return new Promise(async (resolve) => {
    let hasResolved = false;

    const timeout = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        resolve({
          status: connectionStatus,
          isConnected: connectionStatus === "CONNECTED",
          qrCodeDataUrl: qrCodeDataUrl || null,
          connectedPhoneNumber,
        });
      }
    }, 7500);

    try {
      connectionStatus = "CONNECTING";
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      let version = [2, 3000, 1015901307];
      try {
        const v = await fetchLatestBaileysVersion();
        if (v && v.version) version = v.version;
      } catch (e) {}

      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers ? Browsers.macOS("Desktop") : ["Hindu Swaraj Youth", "Desktop", "1.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          qrCodeRaw = qr;
          try {
            qrCodeDataUrl = await QRCode.toDataURL(qr, {
              margin: 2,
              scale: 8,
              color: { dark: "#7f1d1d", light: "#ffffff" },
            });
            connectionStatus = "SCAN_QR_CODE";
            console.log("📲 [WhatsAppBot] New QR code generated successfully!");

            if (!hasResolved) {
              hasResolved = true;
              clearTimeout(timeout);
              resolve({
                status: "SCAN_QR_CODE",
                isConnected: false,
                qrCodeDataUrl,
              });
            }
          } catch (qrErr) {
            console.error("[WhatsAppBot] QR Error:", qrErr.message);
          }
        }

        if (connection === "connecting") {
          connectionStatus = "CONNECTING";
        }

        if (connection === "open") {
          connectionStatus = "CONNECTED";
          qrCodeRaw = "";
          qrCodeDataUrl = "";
          lastConnectedAt = new Date().toISOString();

          connectedUserJid = sock.user?.id || "";
          connectedPhoneNumber = connectedUserJid.split(":")[0] || connectedUserJid.split("@")[0] || "";
          console.log(`✅ [WhatsAppBot] WhatsApp Gateway Connected: ${connectedPhoneNumber}`);

          if (!hasResolved) {
            hasResolved = true;
            clearTimeout(timeout);
            resolve({
              status: "CONNECTED",
              isConnected: true,
              connectedPhoneNumber,
              lastConnectedAt,
            });
          }
        }

        if (connection === "close") {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log("🔴 [WhatsAppBot] Connection closed:", lastDisconnect?.error?.message || statusCode);

          connectionStatus = "DISCONNECTED";
          connectedPhoneNumber = "";

          if (statusCode === DisconnectReason.loggedOut) {
            try {
              fs.rmSync(authDir, { recursive: true, force: true });
            } catch (rmErr) {}
          } else if (shouldReconnect && !isReconnecting) {
            isReconnecting = true;
            setTimeout(() => {
              isReconnecting = false;
              initWhatsApp();
            }, 5000);
          }
        }
      });
    } catch (err) {
      console.error("[WhatsAppBot] Init Socket Error:", err);
      connectionStatus = "DISCONNECTED";
      if (!hasResolved) {
        hasResolved = true;
        clearTimeout(timeout);
        resolve({ status: "ERROR", error: err.message, qrCodeDataUrl: null });
      }
    }
  });
}

/**
 * Send Direct WhatsApp Text Message
 */
async function sendDirectWhatsApp(phone, textMessage) {
  try {
    if (!sock || connectionStatus !== "CONNECTED") {
      return {
        success: false,
        error: "WhatsApp gateway is not connected. Please scan the QR code in Admin Dashboard.",
      };
    }

    const jid = formatToWhatsAppJid(phone);
    if (!jid) {
      return {
        success: false,
        error: `Invalid phone number format: ${phone}`,
      };
    }

    const sent = await sock.sendMessage(jid, { text: textMessage.trim() });
    console.log(`💬 [WhatsAppBot] Message sent to ${phone} (JID: ${jid}, ID: ${sent?.key?.id})`);

    return {
      success: true,
      messageId: sent?.key?.id,
      recipient: jid,
    };
  } catch (err) {
    console.error(`❌ [WhatsAppBot] Failed to send message to ${phone}:`, err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Logout & Reset WhatsApp Auth Session
 */
async function logoutWhatsApp() {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
      sock.end();
      sock = null;
    }
    connectionStatus = "DISCONNECTED";
    qrCodeRaw = "";
    qrCodeDataUrl = "";
    connectedPhoneNumber = "";
    try {
      fs.rmSync(authDir, { recursive: true, force: true });
    } catch (e) {}
    console.log("🔒 [WhatsAppBot] Successfully logged out and reset WhatsApp session.");
    return { success: true, message: "WhatsApp session disconnected." };
  } catch (err) {
    console.error("[WhatsAppBot] Logout error:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Get Current Status Info
 */
function getWhatsAppStatus() {
  return {
    status: connectionStatus,
    isConnected: connectionStatus === "CONNECTED",
    qrCodeDataUrl: qrCodeDataUrl || null,
    connectedPhoneNumber,
    lastConnectedAt,
  };
}

/* =====================================================
   🎨 PROFESSIONAL WHATSAPP TEMPLATE GENERATORS
===================================================== */

/**
 * 🚨 Template 1: Emergency Blood SOS Alert
 */
function buildEmergencyBloodWhatsAppTemplate(sos) {
  const patient = sos.patient_name || "Emergency Patient";
  const bg = sos.blood_group || "O+";
  const units = sos.units || 1;
  const hospital = sos.hospital || "Area Hospital Jagtial";
  const phone = sos.contact_phone || "+91 8499878425";
  const urgency = sos.urgency || "CRITICAL_IMMEDIATE";
  const notes = sos.notes ? `\n💬 *వివరణ*: _"${sos.notes}"_` : "";

  return `🚨 *HINDU SWARAJ • EMERGENCY BLOOD ALERT* 🚨
॥ రక్తదానమే ప్రాణదానం • జగిత్యాల అత్యవసర సేవ ॥
━━━━━━━━━━━━━━━━━━━━
🩸 *REQUIRED BLOOD*: *${bg}* (${units} Unit / ${units * 350} ml)
👤 *Patient Name*: *${patient}*
🏥 *Hospital / Area*: ${hospital}
⚡ *Urgency Level*: 🔴 ${urgency}
📞 *Attender Contact*: *${phone}*${notes}
━━━━━━━━━━━━━━━━━━━━
🛑 *మీరు జగిత్యాలలో ఉండి రక్తదానం చేయగలరా?*
దయచేసి వెంటనే పై ఫోన్ నంబర్‌కు లేదా అసోసియేషన్ హెల్ప్‌లైన్‌కు కాల్ చేయండి.

☎️ *Association 24/7 Helpline*: +91 8499878425
🌐 *Live Portal*: https://hinduswarajyouth.online/blood
━━━━━━━━━━━━━━━━━━━━
_హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ (Regd. No: 784/2025)_`;
}

/**
 * 💳 Template 2: Monthly Subscription Dues Reminder
 */
function buildSubscriptionReminderWhatsAppTemplate({ name, monthYear, dueAmount, role }) {
  const amount = dueAmount || 216;
  const targetMonth = monthYear || "Current Month";

  return `🚩 *HINDU SWARAJ YOUTH WELFARE ASSOCIATION* 🚩
॥ సంఘటిత శక్తియే సమాజ ప్రగతి • జగిత్యాల ॥
━━━━━━━━━━━━━━━━━━━━
నమస్తే *${name || "మెంబర్"}* గారు (${role || "MEMBER"}),

మీ *${targetMonth}* నెలవారీ సభ్యత్వ చందా (Monthly Subscription):
💰 *నెల చందా*: *₹${amount}.00*
📅 *చెల్లించాల్సిన తేదీ*: ఈ నెల 10వ తేదీ లోపు

🌟 *మీ చందా క్రింది ప్రజా సేవా విభాగాలకు వెళ్తుంది:*
• 🚀 Youth Skill & Leadership (50%)
• 🚑 Member Emergency Health Relief (30%)
• 🤝 Public Social Seva & Charity (20%)

🔗 *చందా చెల్లించడానికి / రసీదు డౌన్‌లోడ్ చేసుకోవడానికి క్లిక్ చేయండి:*
👉 https://hinduswarajyouth.online/admin

ఏదైనా సహాయం కొరకు హెల్ప్‌లైన్: +91 8499878425
ధన్యవాదాలు,
*కార్యనిర్వాహక వర్గం, హిందూ స్వరాజ్ అసోసియేషన్*`;
}

/**
 * 🧾 Template 3: Payment Receipt Confirmation
 */
function buildPaymentReceiptWhatsAppTemplate({ name, receiptNo, monthYear, amount, paymentMode, paidDate, receiptToken }) {
  return `🧾 *OFFICIAL PAYMENT RECEIPT & APPRECIATION* 🧾
*HINDU SWARAJ YOUTH WELFARE ASSOCIATION*
━━━━━━━━━━━━━━━━━━━━
నమస్తే *${name || "మెంబర్"}* గారు,

మీ నెలవారీ చందా విజయవంతంగా స్వీకరించబడింది!

📑 *Receipt No*: *${receiptNo}*
📅 *Billing Month*: *${monthYear}*
💵 *Amount Paid*: *₹${amount}.00*
💳 *Payment Mode*: ${paymentMode || "ONLINE"}
🗓️ *Date*: ${paidDate || new Date().toLocaleDateString("en-IN")}
🏛️ *Status*: ✅ VERIFIED & RECORDED IN LEDGER

📥 *మీ అధికారిక సీల్ & సంతకాలతో కూడిన రసీదును డౌన్‌లోడ్ చేసుకోండి:*
👉 https://hinduswarajyouth.online/receipt/${receiptToken || receiptNo}

_మీ నిరంతర తోడ్పాటుకు హృదయపూర్వక ధన్యవాదాలు!_
━━━━━━━━━━━━━━━━━━━━
_హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ (Regd. No: 784/2025)_`;
}

/**
 * 🚀 Broadcast Emergency Blood Alert to All Members & Volunteers via WhatsApp
 */
async function broadcastEmergencyBloodAlertWhatsApp(sosRecord) {
  if (!sock || connectionStatus !== "CONNECTED") {
    console.warn("[WhatsAppBot] Cannot broadcast SOS: WhatsApp Gateway is not connected.");
    return { success: false, error: "WhatsApp Gateway is not connected.", dispatchedCount: 0 };
  }

  try {
    const [usersResult, volResult] = await Promise.all([
      pool.query("SELECT id, name, phone FROM users WHERE phone IS NOT NULL AND phone != ''"),
      pool.query("SELECT id, name, phone FROM volunteers WHERE phone IS NOT NULL AND phone != ''"),
    ]);

    const targetPhones = new Map();

    usersResult.rows.forEach((u) => {
      const clean = (u.phone || "").replace(/\D/g, "");
      if (clean.length >= 10) targetPhones.set(clean.slice(-10), { name: u.name, type: "MEMBER" });
    });

    volResult.rows.forEach((v) => {
      const clean = (v.phone || "").replace(/\D/g, "");
      if (clean.length >= 10 && !targetPhones.has(clean.slice(-10))) {
        targetPhones.set(clean.slice(-10), { name: v.name, type: "VOLUNTEER" });
      }
    });

    const msgText = buildEmergencyBloodWhatsAppTemplate(sosRecord);
    console.log(`🚨 [WhatsAppBot] Broadcasting Emergency Blood SOS to ${targetPhones.size} phone numbers...`);

    let sentCount = 0;
    for (const [phone10] of targetPhones) {
      try {
        const res = await sendDirectWhatsApp(`91${phone10}`, msgText);
        if (res.success) sentCount++;
      } catch (e) {
        console.error(`WhatsApp send error for ${phone10}:`, e.message);
      }
      await new Promise((r) => setTimeout(r, 1200));
    }

    console.log(`✅ [WhatsAppBot] Successfully broadcasted WhatsApp SOS to ${sentCount}/${targetPhones.size} members.`);
    return { success: true, dispatchedCount: sentCount, totalTargets: targetPhones.size };
  } catch (err) {
    console.error("[WhatsAppBot] Broadcast SOS error:", err);
    return { success: false, error: err.message, dispatchedCount: 0 };
  }
}

module.exports = {
  initWhatsApp,
  getWhatsAppStatus,
  sendDirectWhatsApp,
  logoutWhatsApp,
  broadcastEmergencyBloodAlertWhatsApp,
  buildEmergencyBloodWhatsAppTemplate,
  buildSubscriptionReminderWhatsAppTemplate,
  buildPaymentReceiptWhatsAppTemplate,
};
