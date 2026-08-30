const express = require("express");
const router = express.Router();
const pool = require("../db");

/* ==========================================================
   🤖 HINDU SWARAJ YOUTH AI CHATBOT & KNOWLEDGE ENGINE
   Bilingual Support: English, Telugu (తెలుగు), Tanglish
========================================================== */

const KNOWLEDGE_BASE = [
  {
    category: "donation",
    keywords: [
      "donate", "donation", "dhanam", "chanda", "fund", "funds", "bank", "account",
      "upi", "qr", "transfer", "neft", "imps", "pay", "payment", "డొనేషన్", "విరాళం", "డబ్బులు", "ఖాతా", "బ్యాంక్"
    ],
    answer: {
      title: "🙏 Donations & Seva Contributions",
      telugu: "హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ సేవలకు మీరు ఆన్‌లైన్ లేదా డైరెక్ట్ బ్యాంక్ ద్వారా విరాళం అందించవచ్చు:",
      english: "You can support Hindu Swaraj Youth initiatives via Instant Online UPI/Cards or Direct Official Bank Transfer:",
      details: [
        "💳 **Instant Online Payment**: Supports Google Pay, PhonePe, Paytm, UPI, Cards.",
        "🏦 **Official Bank Transfer Details**:\n• **Bank**: Union Bank of India\n• **A/C Name**: Hindu Swaraj Youth Welfare Association\n• **A/C No**: `084910100054321`\n• **IFSC**: `UBIN0808491`\n• **Branch**: Jagtial (505327)",
        "📜 **Official Computerized Receipt**: Issued instantly with Registration No. 784/2025 for all contributions."
      ],
      quickActions: [
        { label: "💳 Donate Online Now", link: "/#donate" },
        { label: "💬 Send Payment Proof on WhatsApp", isWhatsApp: true, text: "Namaste! I have made a donation / would like bank transfer verification." }
      ]
    }
  },
  {
    category: "navaratri",
    keywords: [
      "navaratri", "vinayaka", "ganesha", "ganapathi", "puja", "pooja", "aarti", "harathi",
      "annadanam", "darshan", "live", "laddu", "prasadam", "నవరాత్రి", "వినాయక", "గణపతి", "పూజ", "హారతి", "అన్నదానం"
    ],
    answer: {
      title: "🪔 Sri Vinayaka Navaratri Mahotsavams",
      telugu: "జగిత్యాలలో వైభవంగా జరిగే శ్రీ వినాయక చతుర్థి నవరాత్రి మహోత్సవాల విశేషాలు:",
      english: "Details regarding the grand annual Jagtial Sri Vinayaka Navaratri Utsavams:",
      details: [
        "🪔 **Daily Aarti Timings**: Morning Maha Puja at 8:00 AM • Evening Maha Deeparadhana at 7:30 PM.",
        "🍲 **Maha Annadanam**: Daily sacred Prasad & community Annadanam distribution to 2,000+ devotees.",
        "📿 **Gotra Sahasranamarchana & Seva**: Book special Abhishekams, Aarti seva & Archana in your family's name.",
        "📡 **Live Darshan & Bhajans**: Watch continuous 4K darshan & sacred Vedic stotrams online."
      ],
      quickActions: [
        { label: "🪔 View Navaratri Portal", link: "/vinayaka-navaratri" },
        { label: "🍲 Book Annadanam Seva", isWhatsApp: true, text: "Namaste! I would like to sponsor Maha Annadanam / Aarti seva for Vinayaka Navaratri." }
      ]
    }
  },
  {
    category: "volunteer",
    keywords: [
      "volunteer", "join", "help", "serve", "seva", "youth", "member join", "participate",
      "స్వచ్ఛంద", "సేవకుడు", "చేరడం", "వాలంటీర్", "సేవ"
    ],
    answer: {
      title: "🤝 Join as a Hindu Swaraj Volunteer",
      telugu: "మా సమాజ సేవ, రక్తదానం, మరియు సాంస్కృతిక కార్యక్రమాల్లో పాల్గొనడానికి యువతను సాదరంగా ఆహ్వానిస్తున్నాము!",
      english: "We warmly welcome dedicated youth to join our community service, emergency relief, and cultural events:",
      details: [
        "🚀 **Key Seva Areas**: Emergency Blood Help, Youth Leadership Camps, Clean & Green Drives, Temple & Festival Seva.",
        "📜 **Recognition**: Official Volunteer Certificate & recommendation from Hindu Swaraj Youth.",
        "📝 **How to Apply**: Fill the quick online registration form. Our coordinator will contact you within 24 hours."
      ],
      quickActions: [
        { label: "🤝 Register as Volunteer", link: "/volunteer" },
        { label: "💬 WhatsApp Coordinator", isWhatsApp: true, text: "Namaste! I want to enroll as a volunteer in Hindu Swaraj Youth Welfare Association." }
      ]
    }
  },
  {
    category: "membership",
    keywords: [
      "member", "membership", "id card", "card", "pvc", "login", "subscription", "dues",
      "సభ్యత్వం", "ఐడీ కార్డు", "లాగిన్", "రుసుము"
    ],
    answer: {
      title: "🪪 Member Portal & Digital ID Card",
      telugu: "హిందూ స్వరాజ్ అసోసియేషన్ సభ్యుల సౌకర్యాలు మరియు అధికారిక గుర్తింపు కార్డు వివరాలు:",
      english: "Association membership features and official digital identity credentials:",
      details: [
        "🪪 **Digital & PVC ID Card**: High-res verification card with dynamic QR code & President seal.",
        "💳 **Monthly Subscription**: ₹216/month (50% Youth Development, 30% Member Emergency Health Relief, 20% Public Seva).",
        "🔐 **Member Dashboard**: Access meeting agendas, expense audit sheets, voting & certificates at `/admin`."
      ],
      quickActions: [
        { label: "🔐 Member Portal Login", link: "/admin" },
        { label: "💬 Inquire on WhatsApp", isWhatsApp: true, text: "Namaste! I need assistance regarding my Member ID Card or Association Portal login." }
      ]
    }
  },
  {
    category: "blood_emergency",
    keywords: [
      "blood", "emergency", "help", "hospital", "patient", "ambulance", "రక్తం", "ఎమర్జెన్సీ", "ఆసుపత్రి", "సహాయం"
    ],
    answer: {
      title: "🩸 24/7 Emergency Blood & Medical Seva",
      telugu: "అత్యవసర రక్త అవసరాల కోసం హిందూ స్వరాజ్ యువజన సేవా విభాగం ఎల్లప్పుడూ అందుబాటులో ఉంటుంది:",
      english: "Our 24/7 emergency youth blood donation network is active across Jagtial and surrounding districts:",
      details: [
        "🚑 **Immediate Blood Support**: All blood groups (A+, B+, O+, AB+, Rare negative groups).",
        "📞 **Direct Emergency Hotline**: Call or WhatsApp `+91 8499878425` immediately with patient details & hospital name."
      ],
      quickActions: [
        { label: "🚨 Urgent WhatsApp Blood Request", isWhatsApp: true, text: "URGENT BLOOD REQUIRED: Patient Name: ___, Blood Group: ___, Hospital: Jagtial, Units needed: ___" },
        { label: "📞 Call Helpline", link: "tel:+918499878425" }
      ]
    }
  },
  {
    category: "about_contact",
    keywords: [
      "about", "address", "location", "office", "contact", "phone", "email", "regd",
      "president", "who are you", "చరిత్ర", "చిరునామా", "ఎక్కడ", "ఫోన్"
    ],
    answer: {
      title: "🏛️ About Hindu Swaraj Youth Welfare Association",
      telugu: "హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ - రిజిస్టర్డ్ సమాజ సేవా సంస్థ (జగిత్యాల):",
      english: "Registered non-profit youth welfare & cultural association in Jagtial, Telangana:",
      details: [
        "🏛️ **Registration**: Regd. No: `784/2025` (Under Telangana Societies Registration Act 2001).",
        "📍 **Head Office**: H.No. 4-1-140, Vani Nagar, Jagtial, Telangana - 505327.",
        "📞 **Official Helpline / WhatsApp**: `+91 8499878425`",
        "✉️ **Email**: `hinduswarajyouth@gmail.com` • `info@hinduswarajyouth.online`"
      ],
      quickActions: [
        { label: "💬 Chat with President on WhatsApp", isWhatsApp: true, text: "Namaste! I would like to speak with the Executive Committee of Hindu Swaraj Youth." },
        { label: "🌐 Visit Public Portal", link: "/" }
      ]
    }
  },
  {
    category: "greetings",
    keywords: [
      "hi", "hello", "namaste", "namaskaram", "hey", "jai sri ram", "ram", "ganapathi bappa",
      "నమస్తే", "నమస్కారం", "జై శ్రీ రామ్"
    ],
    answer: {
      title: "🙏 నమస్తే! Welcome to Hindu Swaraj Helpline",
      telugu: "జై శ్రీ రామ్! హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ AI సహాయకుడికి స్వాగతం. మీకు ఏ సమాచారం కావాలో క్రింది ఆప్షన్ల ద్వారా ఎంచుకోవచ్చు లేదా టైప్ చేయవచ్చు.",
      english: "Jai Sri Ram! Welcome to Hindu Swaraj Youth AI Assistant. How can I help you today with our community seva, donations, or events?",
      details: [
        "You can ask about:\n• 💳 **Donations & Bank Transfer**\n• 🤝 **Volunteer Enrollment**\n• 🪔 **Vinayaka Navaratri Timings & Annadanam**\n• 🪪 **Membership & Digital ID Cards**\n• 🩸 **Emergency Blood Support**"
      ],
      quickActions: [
        { label: "💳 Donation Info", text: "How can I donate?" },
        { label: "🤝 Join Volunteer", text: "How to join as a volunteer?" },
        { label: "🪔 Navaratri Seva", text: "Vinayaka Navaratri details" },
        { label: "💬 Connect on WhatsApp", isWhatsApp: true, text: "Namaste! I would like to connect with Hindu Swaraj Association team." }
      ]
    }
  }
];

/* Intelligent Keyword / Intent Matcher */
function findBestReply(userQuery) {
  const query = (userQuery || "").toLowerCase().trim();
  if (!query) {
    return KNOWLEDGE_BASE[KNOWLEDGE_BASE.length - 1].answer;
  }

  // Calculate score for each category
  let bestMatch = null;
  let highestScore = 0;

  for (const item of KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of item.keywords) {
      if (query.includes(kw)) {
        score += kw.length; // weight longer keyword matches higher
      }
    }
    if (score > highestScore) {
      highestScore = score;
      bestMatch = item.answer;
    }
  }

  if (bestMatch && highestScore > 0) {
    return bestMatch;
  }

  // Fallback intelligent response with WhatsApp handoff
  return {
    title: "🤖 Hindu Swaraj Assistant",
    telugu: "మీ ప్రశ్నకు సంబంధించిన సమాచారం కోసం లేదా మా కమిటీ సభ్యులతో మాట్లాడటానికి నేరుగా వాట్సాప్‌లో కనెక్ట్ అవ్వండి:",
    english: `Thank you for reaching out! Regarding: "${userQuery}", our executive team is ready to assist you directly:`,
    details: [
      "• **Helpline & WhatsApp**: `+91 8499878425`",
      "• **Head Office**: Vani Nagar, Jagtial, Telangana",
      "• Click the green button below to send this inquiry directly to our official WhatsApp."
    ],
    quickActions: [
      { label: "💬 Send this query to WhatsApp", isWhatsApp: true, text: `Namaste! I have a question regarding: "${userQuery}". Please guide me.` },
      { label: "💳 View Donations", link: "/#donate" },
      { label: "🤝 Volunteer Form", link: "/volunteer" }
    ]
  };
}

/* ==========================================
   POST /chatbot/message
   Body: { message: string, history: array }
========================================== */
router.post("/message", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    let reply = findBestReply(message);

    // If query is donation/bank related, enrich with live settings from DB
    const lower = message.toLowerCase();
    if (lower.includes("donate") || lower.includes("bank") || lower.includes("account") || lower.includes("ఖాతా") || lower.includes("విరాళం") || lower.includes("upi")) {
      try {
        const setRes = await pool.query("SELECT * FROM association_settings ORDER BY id DESC LIMIT 1");
        const s = setRes.rows[0];
        if (s && s.account_no) {
          reply = JSON.parse(JSON.stringify(reply));
          reply.details = [
            "💳 **Instant Online Payment**: Supports Google Pay, PhonePe, Paytm, UPI, Cards with automated receipts.",
            `🏦 **Official Bank Transfer Details**:\n• **Bank**: ${s.bank_name || 'Union Bank of India'}\n• **A/C Name**: ${s.account_name || 'Hindu Swaraj Youth Welfare Association'}\n• **A/C No**: \`${s.account_no}\`\n• **IFSC**: \`${s.ifsc_code || 'UBIN0808491'}\`\n• **Branch**: ${s.branch_name || 'Jagtial'}${s.account_type ? ' (' + s.account_type + ')' : ''}${s.upi_id ? '\n• **Official UPI ID**: `' + s.upi_id + '`' : ''}`,
            `📜 **Official Badge**: ${s.regd_no || 'Regd. No: 784/2025 (Govt. of Telangana)'}`
          ];
        }
      } catch (dbErr) {
        console.warn("Could not fetch DB settings for chatbot reply:", dbErr.message);
      }
    }

    res.json({
      success: true,
      reply,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("CHATBOT ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to process chat message" });
  }
});

/* GET /chatbot/faq */
router.get("/faq", (req, res) => {
  res.json({
    success: true,
    categories: KNOWLEDGE_BASE.map(k => ({ category: k.category, title: k.answer.title }))
  });
});

module.exports = router;
