const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const pool = require("../db");

// Session storage directory
const authDir = process.env.VERCEL
  ? path.join("/tmp", "baileys_auth_hsy")
  : path.join(__dirname, "..", "auth_info_baileys");

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
 * Format phone number to 91XXXXXXXXXX
 */
function cleanPhoneNumber(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) {
    digits = "91" + digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = "91" + digits.slice(1);
  }
  if (digits.length < 10) return null;
  return digits;
}

/**
 * Format phone to WhatsApp JID for Baileys
 */
function formatToWhatsAppJid(phone) {
  const clean = cleanPhoneNumber(phone);
  if (!clean) return null;
  return `${clean}@s.whatsapp.net`;
}

/**
 * 🌟 1. SEND VIA OFFICIAL META CLOUD API (HTTP REST)
 */
async function sendViaMetaCloudAPI(phone, messageText) {
  const token = process.env.WHATSAPP_TOKEN || process.env.META_WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID || process.env.META_PHONE_ID;

  if (!token || !phoneId) {
    return { success: false, error: "Meta WhatsApp API credentials not set in environment." };
  }

  const cleanPhone = cleanPhoneNumber(phone);
  if (!cleanPhone) {
    return { success: false, error: `Invalid phone format: ${phone}` };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanPhone,
        type: "text",
        text: { preview_url: true, body: messageText.trim() },
      }),
    });

    const data = await res.json();
    if (!res.ok || data.error) {
      console.error("❌ [MetaCloudAPI] Send Error:", data.error || data);
      return { success: false, error: data.error?.message || "Meta API error" };
    }

    console.log(`💬 [MetaCloudAPI] Message delivered to ${cleanPhone} (MsgId: ${data.messages?.[0]?.id})`);
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
      provider: "META_CLOUD_API",
    };
  } catch (err) {
    console.error("❌ [MetaCloudAPI] Network error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * ⚡ 2. SEND VIA BAILEYS WEBSOCKET
 */
async function sendViaBaileys(phone, messageText) {
  if (!sock || connectionStatus !== "CONNECTED") {
    return { success: false, error: "Baileys gateway is offline." };
  }

  const jid = formatToWhatsAppJid(phone);
  if (!jid) return { success: false, error: "Invalid phone number." };

  try {
    const sent = await sock.sendMessage(jid, { text: messageText.trim() });
    console.log(`💬 [Baileys] Message sent to ${phone} (ID: ${sent?.key?.id})`);
    return {
      success: true,
      messageId: sent?.key?.id,
      recipient: jid,
      provider: "BAILEYS_SOCKET",
    };
  } catch (err) {
    console.error(`❌ [Baileys] Send error to ${phone}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 🚀 3. UNIFIED DIRECT WHATSAPP SENDER (Attempts Cloud API first, then Baileys with Auto-Reconnect)
 */
async function sendDirectWhatsApp(phone, textMessage) {
  // Try Meta Cloud API if configured
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    const metaRes = await sendViaMetaCloudAPI(phone, textMessage);
    if (metaRes.success) return metaRes;
  }

  // If Baileys is not active, try auto-connecting from stored DB session
  if (!sock || connectionStatus !== "CONNECTED") {
    console.log("[WhatsAppBot] Socket offline. Attempting on-demand reconnection from stored session...");
    try {
      await initWhatsApp();
      let waits = 0;
      while (connectionStatus !== "CONNECTED" && waits < 8) {
        await new Promise((r) => setTimeout(r, 500));
        waits++;
      }
    } catch (e) {}
  }

  // Send via Baileys if connected
  if (sock && connectionStatus === "CONNECTED") {
    return await sendViaBaileys(phone, textMessage);
  }

  return {
    success: false,
    error: "WhatsApp gateway is not connected. Please scan the QR code in Admin Dashboard to connect.",
  };
}

async function backupAuthToDatabase(dir) {
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    if (!files.length) return;
    const sessionPayload = {};
    for (const f of files) {
      const filePath = path.join(dir, f);
      try {
        sessionPayload[f] = fs.readFileSync(filePath, "utf-8");
      } catch (e) {}
    }
    await pool.query(
      `INSERT INTO whatsapp_bot_session (session_id, session_data, updated_at)
       VALUES ('default_hsy_session', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (session_id) DO UPDATE SET session_data = $1, updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(sessionPayload)]
    ).catch(() => {});
  } catch (err) {}
}

async function restoreAuthFromDatabase(dir) {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir);
    if (existing.length > 0) return;

    const res = await pool.query(
      "SELECT session_data FROM whatsapp_bot_session WHERE session_id = 'default_hsy_session'"
    );
    if (res.rows.length && res.rows[0].session_data) {
      const sessionData = res.rows[0].session_data;
      for (const [filename, content] of Object.entries(sessionData)) {
        try {
          fs.writeFileSync(path.join(dir, filename), content, "utf-8");
        } catch (e) {}
      }
      console.log("🔄 [WhatsAppBot] Restored WhatsApp session from PostgreSQL database!");
    }
  } catch (err) {}
}

/**
 * Initialize Baileys WhatsApp Socket
 */
async function initWhatsApp(forceNew = false) {
  // If Meta Cloud API is set, we are always connected via Cloud API
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID) {
    return {
      status: "CONNECTED",
      isConnected: true,
      provider: "META_CLOUD_API",
      connectedPhoneNumber: process.env.WHATSAPP_DISPLAY_PHONE || "+91 8499878425",
    };
  }

  if (sock && connectionStatus === "CONNECTED" && !forceNew) {
    return {
      status: connectionStatus,
      isConnected: true,
      provider: "BAILEYS_SOCKET",
      connectedPhoneNumber,
      lastConnectedAt,
    };
  }

  // Restore auth credentials from DB if starting fresh on new host
  await restoreAuthFromDatabase(authDir);

  // Local / Long-running or On-Demand Server: Initialize Baileys
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
    }, 6000);

    try {
      let Baileys;
      try {
        Baileys = require("@whiskeysockets/baileys");
      } catch (reqErr) {
        console.warn("Baileys require notice:", reqErr.message);
        if (!hasResolved) {
          hasResolved = true;
          clearTimeout(timeout);
          return resolve({ status: "DISCONNECTED", isConnected: false, error: "Baileys not installed" });
        }
      }

      const makeWASocket = Baileys.default || Baileys.makeWASocket || Baileys;
      const { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers } = Baileys;

      if (!fs.existsSync(authDir)) {
        try {
          fs.mkdirSync(authDir, { recursive: true });
        } catch (e) {}
      }

      connectionStatus = "CONNECTING";
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      let version = [2, 3000, 1015901307];
      try {
        const v = await fetchLatestBaileysVersion();
        if (v && v.version) version = v.version;
      } catch (e) {}

      let pinoLogger;
      try {
        const pino = require("pino");
        pinoLogger = pino({ level: "silent" });
      } catch (e) {}

      sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pinoLogger || { level: () => {}, info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, trace: () => {}, child: () => ({ level: () => {}, info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, trace: () => {} }) },
        browser: Browsers ? Browsers.macOS("Desktop") : ["Hindu Swaraj", "Desktop", "1.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: true,
      });

      sock.ev.on("creds.update", async () => {
        await saveCreds();
        backupAuthToDatabase(authDir).catch(() => {});
      });

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
            console.log("📲 [WhatsAppBot] New QR code ready!");

            if (!hasResolved) {
              hasResolved = true;
              clearTimeout(timeout);
              resolve({
                status: "SCAN_QR_CODE",
                isConnected: false,
                qrCodeDataUrl,
              });
            }
          } catch (qrErr) {}
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
          console.log(`✅ [WhatsAppBot] Connected: ${connectedPhoneNumber}`);

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
          const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;

          connectionStatus = "DISCONNECTED";
          connectedPhoneNumber = "";

          if (statusCode === DisconnectReason?.loggedOut) {
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
      console.error("[WhatsAppBot] Init Error:", err.message);
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
 * Logout WhatsApp
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
      await pool.query("DELETE FROM whatsapp_bot_session WHERE session_id = 'default_hsy_session'").catch(() => {});
    } catch (e) {}
    return { success: true, message: "WhatsApp session disconnected." };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get Status Info
 */
function getWhatsAppStatus() {
  const isCloudAPI = Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

  if (isCloudAPI) {
    return {
      status: "CONNECTED",
      isConnected: true,
      provider: "META_CLOUD_API",
      connectedPhoneNumber: process.env.WHATSAPP_DISPLAY_PHONE || "+91 8499878425",
      lastConnectedAt: new Date().toISOString(),
      qrCodeDataUrl: null,
    };
  }

  return {
    status: connectionStatus,
    isConnected: connectionStatus === "CONNECTED",
    provider: "BAILEYS_SOCKET",
    qrCodeDataUrl: qrCodeDataUrl || null,
    connectedPhoneNumber,
    lastConnectedAt,
    isServerless: Boolean(process.env.VERCEL),
  };
}

/* =====================================================
   🎨 PROFESSIONAL WHATSAPP TEMPLATES
===================================================== */

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

async function broadcastEmergencyBloodAlertWhatsApp(sosRecord) {
  try {
    const [usersResult, volResult] = await Promise.all([
      pool.query("SELECT id, name, phone FROM users WHERE phone IS NOT NULL AND phone != ''"),
      pool.query("SELECT id, name, phone FROM volunteers WHERE phone IS NOT NULL AND phone != ''"),
    ]);

    const targetPhones = new Map();

    const isRealPhone = (p) => {
      if (!p || typeof p !== "string") return false;
      const digits = p.replace(/\D/g, "").slice(-10);
      if (digits.length !== 10) return false;
      if (digits === "1234567890" || digits === "9876543210" || digits === "0000000000" || digits === "9440000000") return false;
      return /^[6-9]\d{9}$/.test(digits);
    };

    usersResult.rows.forEach((u) => {
      const clean = cleanPhoneNumber(u.phone);
      if (clean) {
        const phone10 = clean.slice(-10);
        if (isRealPhone(phone10)) {
          targetPhones.set(phone10, { name: u.name, type: "MEMBER" });
        }
      }
    });

    volResult.rows.forEach((v) => {
      const clean = cleanPhoneNumber(v.phone);
      if (clean) {
        const phone10 = clean.slice(-10);
        if (isRealPhone(phone10) && !targetPhones.has(phone10)) {
          targetPhones.set(phone10, { name: v.name, type: "VOLUNTEER" });
        }
      }
    });

    const msgText = buildEmergencyBloodWhatsAppTemplate(sosRecord);
    let sentCount = 0;
    console.log(`🚨 [WhatsAppBot] Broadcasting SOS to ${targetPhones.size} verified phone numbers...`);

    for (const [phone10, info] of targetPhones) {
      try {
        const res = await sendDirectWhatsApp(`91${phone10}`, msgText);
        if (res.success) {
          sentCount++;
          console.log(`✅ [WhatsAppBot] Emergency SOS sent to ${info.name} (91${phone10})`);
        }
      } catch (e) {
        console.warn(`⚠️ [WhatsAppBot] Failed to send SOS to 91${phone10}:`, e.message);
      }
      // Small pause between messages to prevent spam throttle
      await new Promise((r) => setTimeout(r, 400));
    }

    return { success: true, dispatchedCount: sentCount, totalTargets: targetPhones.size };
  } catch (err) {
    console.error("❌ [WhatsAppBot] SOS Broadcast Error:", err);
    return { success: false, error: err.message, dispatchedCount: 0 };
  }
}

/**
 * 🌟 4. PUBLIC / SEVA DONATION RECEIPT TEMPLATE
 */
function buildPublicDonationWhatsAppTemplate({ name, receiptNo, amount, fundName, receiptDate, verifyUrl }) {
  return `🚩 *HINDU SWARAJ YOUTH WELFARE ASSOCIATION* 🚩
॥ ధర్మో రక్షతి రక్షితః • జగిత్యాల (Regd: 784/2025) ॥
━━━━━━━━━━━━━━━━━━━━
నమస్తే *${name || "దాత"}* గారు 🙏,

సమాజ సేవ & ప్రజా సంక్షేమం కొరకు మీరు అందించిన పవిత్ర విరాళం విజయవంతంగా స్వీకరించబడింది!

🧾 *రసీదు నంబర్*: *${receiptNo}*
🏛️ *సేవా విభాగం*: *${fundName || "General Seva Fund"}*
💰 *విరాళం మొత్తం*: *₹${Number(amount).toLocaleString("en-IN")}.00*
🗓️ *స్వీకరించిన తేదీ*: ${receiptDate || new Date().toLocaleDateString("en-IN")}
🏛️ *స్థితి*: ✅ VERIFIED & RECORDED IN AUDIT LEDGER

📥 *మీ అధికారిక సీల్ & సంతకాలతో కూడిన అసలైన PDF రసీదును ఇక్కడ డౌన్‌లోడ్ చేసుకోండి:*
👉 ${verifyUrl || `https://hinduswarajyouth.online/receipt/${receiptNo}`}

_మీ నిస్వార్థ సహకారానికి అసోసియేషన్ కార్యవర్గం హృదయపూర్వక ధన్యవాదాలు తెలియజేస్తోంది._
━━━━━━━━━━━━━━━━━━━━
*కార్యనిర్వాహక వర్గం, హిందూ స్వరాజ్ అసోసియేషన్, జగిత్యాల*
హెల్ప్‌లైన్: +91 8499878425`;
}

/**
 * 🌟 5. AAPADBANDHAVA LIFE-SAVER CERTIFICATE TEMPLATE
 */
function buildAapadbandhavaWhatsAppTemplate({ donorName, patientName, amount, certificateCode, certUrl }) {
  return `🚩 *HINDU SWARAJ YOUTH WELFARE ASSOCIATION* 🚩
॥ ఆపద్బాంధవ అత్యవసర ప్రజా సహాయ నిధి • జగిత్యాల ॥
━━━━━━━━━━━━━━━━━━━━
నమస్కారం *శ్రీ/శ్రీమతి ${donorName || "జీవనదాత"}* గారు 🙏,

జగిత్యాల ఆపద్బాంధవ ద్వారా ప్రాణాపాయ స్థితిలో ఉన్న *${patientName}* గారి అత్యవసర వైద్య చికిత్స నిమిత్తం మీరు అందించిన *₹${Number(amount).toLocaleString("en-IN")}.00* సహాయాన్ని మా అసోసియేషన్ విజయవంతంగా బాధితుడికి అందించింది.

మీ నిస్వార్థ మానవత్వ సేవకు కృతజ్ఞతగా అధికారిక *సేవా ప్రశంసా పత్రం (Certificate of Appreciation)* జారీ చేయబడింది.

🆔 *సర్టిఫికెట్ ఐడీ*: \`${certificateCode}\`
🔗 *మీ అధికారిక సర్టిఫికెట్ డౌన్‌లోడ్ చేసుకోండి:*
👉 ${certUrl || `https://hinduswarajyouth.online/aapadbandhava?cert=${certificateCode}`}

_|| ప్రజా సేవయే ఈశ్వర సేవ ||_
━━━━━━━━━━━━━━━━━━━━
*అధ్యక్షులు & కార్యవర్గం, హిందూ స్వరాజ్ అసోసియేషన్*`;
}

/**
 * 🌟 6. VOLUNTEER WELCOME TEMPLATE
 */
function buildVolunteerWelcomeWhatsAppTemplate({ name, volunteerId, city, interests }) {
  return `🚩 *WELCOME TO HINDU SWARAJ VOLUNTEER FORCE* 🚩
॥ సంఘటిత శక్తియే సమాజ ప్రగతి • జగిత్యాల ॥
━━━━━━━━━━━━━━━━━━━━
నమస్తే *${name}* గారు,

హిందూ స్వరాజ్ యూత్ సేవా దళంలో (Volunteer Force) రిజిస్టర్ అయినందుకు హృదయపూర్వక స్వాగతం! 

🆔 *Volunteer ID*: *#VOL-${volunteerId}*
📍 *సేవా ప్రాంతం*: ${city || "Jagtial"}
🎯 *మీ ఆసక్తి*: ${interests || "Social Welfare & Emergency Aid"}

సమాజంలో రక్తదానం, ఆపద్బాంధవ అత్యవసర సేవలు, యువజన నైపుణ్య వికాసం వంటి సేవా కార్యక్రమాలలో మీ పాత్ర ఎంతో విలువైంది.

🔗 *అసోసియేషన్ పోర్టల్*: https://hinduswarajyouth.online
ఏదైనా సమాచారం కొరకు హెల్ప్‌లైన్: +91 8499878425
━━━━━━━━━━━━━━━━━━━━
*హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్*`;
}

/**
 * 🌟 7. NAVARATRI SEVA & POOJA TOKEN TEMPLATE
 */
function buildNavaratriSevaWhatsAppTemplate({ devoteeName, tokenNo, sevaName, amount, gotram, certUrl }) {
  return `🪔 *శ్రీ వినాయక / దేవి శరన్నవరాత్రి మహోత్సవాలు - 2026* 🪔
*హిందూ స్వరాజ్ యూత్ అసోసియేషన్ • జగిత్యాల*
━━━━━━━━━━━━━━━━━━━━
నమస్తే *${devoteeName}* గారు 🙏,

మీ గోత్ర నామావళి & పూజా సంకల్పం శ్రీ స్వామివారి పాదపద్మముల వద్ద సమర్పించబడింది!

🎫 *పూజా సంకల్పం టోకెన్*: *${tokenNo}*
🙏 *గోత్రం*: ${gotram || "స్వ గోత్రం"}
🪔 *పూజా సేవ*: ${sevaName || "నిత్య పూజ & మహామంగళ హారతి"}
💰 *సేవా రుసుము*: ₹${amount ? Number(amount).toLocaleString("en-IN") : "0"}.00

🖨️ *మీ అధికారిక పూజా ప్రసాద పత్రం / సర్టిఫికేట్ ఇక్కడ వీక్షించండి:*
👉 ${certUrl || `https://hinduswarajyouth.online/vinayaka-navaratri?token=${tokenNo}`}

_శ్రీ గణపతి & దుర్గామాత అనుగ్రహంతో మీకు, మీ కుటుంబ సభ్యులకు ఆయురారోగ్య ఐశ్వర్యాలు కలగాలని ప్రార్థిస్తున్నాము._
━━━━━━━━━━━━━━━━━━━━
*ఉత్సవ కమిటీ, హిందూ స్వరాజ్ అసోసియేషన్*`;
}

/**
 * Helper Dispatchers for Background Execution
 */
async function sendDonationReceiptWhatsApp(donation) {
  try {
    const phone = donation.donor_phone || donation.phone;
    if (!phone) return { success: false, error: "No donor phone" };
    const clean = cleanPhoneNumber(phone);
    if (!clean) return { success: false, error: "Invalid phone" };

    const msg = buildPublicDonationWhatsAppTemplate({
      name: donation.donor_name || donation.name,
      receiptNo: donation.receipt_no,
      amount: donation.amount,
      fundName: donation.fund_name,
      receiptDate: donation.receipt_date,
      verifyUrl: `https://hinduswarajyouth.online/receipts/verify/${donation.receipt_no}`,
    });

    return await sendDirectWhatsApp(clean, msg);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendAapadbandhavaCertificateWhatsApp(contribution) {
  try {
    const phone = contribution.donor_phone || contribution.phone;
    if (!phone) return { success: false, error: "No phone" };
    const clean = cleanPhoneNumber(phone);
    if (!clean) return { success: false, error: "Invalid phone" };

    const msg = buildAapadbandhavaWhatsAppTemplate({
      donorName: contribution.donor_name,
      patientName: contribution.patient_name,
      amount: contribution.amount,
      certificateCode: contribution.certificate_code,
      certUrl: `https://hinduswarajyouth.online/aapadbandhava?cert=${contribution.certificate_code}`,
    });

    return await sendDirectWhatsApp(clean, msg);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendVolunteerWelcomeWhatsApp(volunteer) {
  try {
    const phone = volunteer.phone;
    if (!phone) return { success: false, error: "No phone" };
    const clean = cleanPhoneNumber(phone);
    if (!clean) return { success: false, error: "Invalid phone" };

    const msg = buildVolunteerWelcomeWhatsAppTemplate({
      name: volunteer.name,
      volunteerId: volunteer.id,
      city: volunteer.city,
      interests: volunteer.interests || volunteer.interest,
    });

    return await sendDirectWhatsApp(clean, msg);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sendNavaratriPoojaReceiptWhatsApp(devotee) {
  try {
    const phone = devotee.mobile || devotee.phone_number || devotee.phone || devotee.cleanMobile;
    if (!phone) return { success: false, error: "No phone" };
    const clean = cleanPhoneNumber(phone);
    if (!clean) return { success: false, error: "Invalid phone" };

    const msg = buildNavaratriSevaWhatsAppTemplate({
      devoteeName: devotee.devotee_name || devotee.name,
      tokenNo: devotee.token_no,
      sevaName: devotee.seva_type || devotee.sevaName,
      amount: devotee.amount || devotee.offering_amount,
      gotram: devotee.gotram,
      certUrl: `https://hinduswarajyouth.online/vinayaka-navaratri?token=${devotee.token_no}`,
    });

    return await sendDirectWhatsApp(clean, msg);
  } catch (err) {
    return { success: false, error: err.message };
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
  buildPublicDonationWhatsAppTemplate,
  buildAapadbandhavaWhatsAppTemplate,
  buildVolunteerWelcomeWhatsAppTemplate,
  buildNavaratriSevaWhatsAppTemplate,
  sendDonationReceiptWhatsApp,
  sendAapadbandhavaCertificateWhatsApp,
  sendVolunteerWelcomeWhatsApp,
  sendNavaratriPoojaReceiptWhatsApp,
};
