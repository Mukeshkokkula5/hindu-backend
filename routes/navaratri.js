const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const sendMail = require("../utils/sendMail");

const router = express.Router();

// Ensure upload directory exists
const isProd = process.env.VERCEL || process.env.NODE_ENV === "production";
const uploadDir = isProd ? "/tmp" : path.join(__dirname, "../uploads");

if (!isProd) {
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Navaratri upload dir init notice:", e.message);
  }
}


// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "navaratri-" + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const allowed = /png|jpg|jpeg|webp|avif|mp3|wav|m4a|ogg|aac|flac/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype.startsWith("audio/") || file.mimetype.startsWith("image/");
    if (!ext || !mime) {
      return cb(new Error("Only images (.png, .jpg, .webp) and audio files (.mp3, .wav, .m4a, .ogg) are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 35 * 1024 * 1024 }, // 35MB for MP3 Audio / HD Posters
});

// Helper to extract YouTube video ID or Embed ID from ANY format
function extractYouTubeId(urlOrId) {
  if (!urlOrId) return "";
  const trimmed = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/|shorts\/))([\w-]{11})/
  );
  if (match && match[1]) {
    return match[1];
  }
  const vMatch = trimmed.match(/[?&]v=([\w-]{11})/);
  if (vMatch && vMatch[1]) {
    return vMatch[1];
  }
  return trimmed;
}

/* =====================================================
   📦 AUTO-INIT DATABASE TABLES & SPONSOR COLUMNS
===================================================== */
(async () => {
  try {
    // 1. Sponsors Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS navaratri_sponsors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'TITLE_SPONSOR', -- TITLE_SPONSOR, ANNADANAM_PATRON, AARTI_SPONSOR, CO_SPONSOR, MEDIA_PARTNER, SHOP_COMMERCIAL
        tagline TEXT,
        offer_badge VARCHAR(100),
        shop_address TEXT,
        whatsapp_number VARCHAR(50),
        logo_url TEXT,
        banner_url TEXT,
        contact_phone VARCHAR(50),
        website_url TEXT,
        amount_sponsored NUMERIC(12, 2) DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        display_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE navaratri_sponsors ADD COLUMN IF NOT EXISTS offer_badge VARCHAR(100);
      ALTER TABLE navaratri_sponsors ADD COLUMN IF NOT EXISTS shop_address TEXT;
      ALTER TABLE navaratri_sponsors ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(50);
    `);

    // 2. Settings table extensions for Live Ads, Ticker & Devotional Audio Jukebox
    await pool.query(`
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ticker_text TEXT DEFAULT '🔴 LIVE: Vinayaka Navaratri Seva Mahotsavam 2026 in Jagtial • Daily Sahasranamarchana, Maha Annadanam & Divya Mangala Aarti • Book your Gotra Namavali Seva online';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ticker_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ad_banner_url TEXT;
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ad_banner_link TEXT DEFAULT '#seva-booking';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ad_banner_title TEXT DEFAULT 'Sri Venkateshwara Swarna Kireetam & Jewellers';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ad_banner_tagline TEXT DEFAULT 'Official Grand Aarti & Swarna Kavacha Sponsor • Jagtial';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS ad_banner_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS annadanam_count_today INT DEFAULT 2850;
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS laddu_auction_info TEXT DEFAULT 'Grand Maha Laddu Auction on Day 9 (22 Sep) at 6:00 PM';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS pandal_map_url TEXT DEFAULT 'https://maps.google.com/?q=Jagtial+Telangana';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS bg_audio_url TEXT DEFAULT 'https://assets.mixkit.co/music/preview/mixkit-meditation-flute-and-bells-ambient-sound-581.mp3';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS bg_audio_title TEXT DEFAULT 'Om Gam Ganapataye Namaha • 108 Divine Dhun';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS bg_audio_artist TEXT DEFAULT 'Sacred Jagtial Pandal Vedic Chants';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS bg_audio_active BOOLEAN DEFAULT TRUE;
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS bg_audio_autoplay BOOLEAN DEFAULT TRUE;
      
      -- Certificate Management Columns
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_header_title TEXT DEFAULT '॥ శ్రీ సిద్ధి వినాయక ప్రసన్నః • ఓం శ్రీ గణేశాయ నమః ॥';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_assoc_name TEXT DEFAULT 'HINDU SWARAJ YOUTH WELFARE ASSOCIATION';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_regd_no TEXT DEFAULT 'Regd. No: 784/2025 (Govt. of Telangana) • Head Office: H.No. 4-1-140, Vani Nagar, Jagtial - 505327';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_festival_name TEXT DEFAULT '🪔 VINAYAKA NAVARATRI SEVA MAHOTSAVAM - 2026 🪔';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_main_title TEXT DEFAULT 'దివ్య గోత్ర నామావళి & పూజా ఆశీర్వచన పత్రం';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_main_sub TEXT DEFAULT 'Official Sacred Seva & Divine Blessings Certificate';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_shloka TEXT DEFAULT 'वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषు सर्वदा॥';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_blessing_telugu TEXT DEFAULT 'శ్రీ సిద్ధి వినాయక స్వామి వారి దివ్య కృపా కటాక్షములచే మీ సంకల్పములన్నియు సిద్ధింపబడి, ఆయురారోగ్య ఐశ్వర్యాభివృద్ధి, సకల కార్యజయములు, సదా సుఖశాంతులు కలుగుగాక!';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_blessing_english TEXT DEFAULT 'May Lord Vighnaharta Ganesha shower his supreme blessings, remove all obstacles, and bestow peace, longevity, sound health, and boundless prosperity upon you and your entire family.';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_priest_name TEXT DEFAULT 'ప్రధాన అర్చకులు (Chief Archaka)';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_priest_role TEXT DEFAULT 'Pandal Puja Committee';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_president_name TEXT DEFAULT 'Mukesh Kokkula';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_president_role TEXT DEFAULT 'అధ్యక్షుడు (President), Hindu Swaraj Youth Association';
      ALTER TABLE navaratri_settings ADD COLUMN IF NOT EXISTS cert_seal_text TEXT DEFAULT 'HINDU SWARAJ • REGD. 784/2025 • JAGTIAL • SEAL';

      -- Wishes / Gotra Namavali Table Migration
      CREATE TABLE IF NOT EXISTS navaratri_wishes (
        id SERIAL PRIMARY KEY,
        devotee_name VARCHAR(255) NOT NULL,
        gotram VARCHAR(255),
        city VARCHAR(100) DEFAULT 'Jagtial',
        message TEXT,
        mobile VARCHAR(20),
        email VARCHAR(255),
        offering_amount NUMERIC(10,2) DEFAULT 0,
        payment_id VARCHAR(100),
        token_no VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE navaratri_wishes ADD COLUMN IF NOT EXISTS mobile VARCHAR(20);
      ALTER TABLE navaratri_wishes ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE navaratri_wishes ADD COLUMN IF NOT EXISTS offering_amount NUMERIC(10,2) DEFAULT 0;
      ALTER TABLE navaratri_wishes ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100);
      ALTER TABLE navaratri_wishes ADD COLUMN IF NOT EXISTS token_no VARCHAR(100);
    `);

    // 3. Seed Default Professional Sponsors if empty
    const checkSponsors = await pool.query("SELECT COUNT(*) FROM navaratri_sponsors");
    if (parseInt(checkSponsors.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO navaratri_sponsors (name, category, tagline, offer_badge, shop_address, whatsapp_number, logo_url, contact_phone, website_url, amount_sponsored, is_active, display_order)
        VALUES
        ('Sri Venkateshwara Swarna Kireetam & Jewellers', 'TITLE_SPONSOR', 'Official Swarna Kavacham & Grand Aarti Title Sponsor • Pure 916 KDM Gold & Silver Articles', '🌟 Special 15% Festive Making Charge Off', 'Main Road, Clock Tower Center, Jagtial', '+91 98480 12345', '/images/navaratri-ganesha.jpg', '+91 98480 12345', 'https://hinduswaraj.org', 50000, true, 1),
        ('Gayatri Agro & Modern Rice Industries', 'ANNADANAM_PATRON', 'Maha Annadanam Chief Patron • Sponsoring Daily Sacred Prasadam for 3,000+ Devotees', '🍲 Sona Masoori Rice Special Pack', 'Industrial Area, Bypass Road, Jagtial', '+91 94400 54321', '/images/navaratri-aarti.jpg', '+91 94400 54321', '', 35000, true, 2),
        ('Lakshmi Srinivasa Silk & Handloom Vastralaya', 'AARTI_SPONSOR', 'Divya Pattu Vastrams & Daily Pushpalankarana Partner • Jagtial', '🥻 Festive 20% Discount on Wedding Sarees', 'Beside Gandhi Chowk, Jagtial', '+91 99890 67890', '/images/navaratri-ganesha.jpg', '+91 99890 67890', '', 25000, true, 3),
        ('Balaji Pure Ghee Sweets & Bakery', 'SHOP_COMMERCIAL', 'Special 108 Modaka Nivedana, Kaju Katli & Pure Ghee Laddu Offer', '🍬 Buy 1kg Get 250g Free Festival Offer', 'Station Road, Near Bus Stand, Jagtial', '+91 98765 43210', '/images/logo_v2.png', '+91 98765 43210', '', 15000, true, 4),
        ('Telangana Fiber Net & Digital Broadcasters', 'MEDIA_PARTNER', 'Official Ultra-HD 4K Live Broadcast & YouTube Streaming Partner', '⚡ High Speed 200 Mbps Fiber Connect', 'Vani Nagar, Jagtial', '+91 84998 78425', '/images/logo_v2.png', '+91 84998 78425', '', 10000, true, 5)
      `);
      console.log("✅ Seeded default Navaratri Sponsors & Ad Patrons");
    }
  } catch (err) {
    console.warn("Navaratri Auto-init notice:", err.message);
  }
})();

/* =====================================================
   📤 IMAGE UPLOAD ENDPOINT
   POST /navaratri/upload (ADMIN / PRESIDENT / EC)
===================================================== */
router.post(
  "/upload",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  upload.single("photo"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No image file provided" });
      }

      let relativePath = `/uploads/${req.file.filename}`;
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        if (req.file.path && fs.existsSync(req.file.path)) {
          const b64 = fs.readFileSync(req.file.path).toString("base64");
          const mime = req.file.mimetype || "image/jpeg";
          relativePath = `data:${mime};base64,${b64}`;
        }
      }
      res.json({
        success: true,
        message: "Image uploaded successfully!",
        imageUrl: relativePath,
        url: relativePath,
        fileUrl: relativePath,
        photo_url: relativePath,
        filename: req.file.filename,
      });
    } catch (err) {
      console.error("NAVARATRI UPLOAD ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Upload failed: " + err.message });
    }
  }
);

/* =====================================================
   🏛 1. PUBLIC: GET NAVARATRI INFO & LIVE STREAM STATUS
   GET /navaratri/info & GET /navaratri/settings
===================================================== */
router.get(["/info", "/settings"], async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM navaratri_settings ORDER BY id ASC LIMIT 1"
    );

    let settings = result.rows[0];
    if (!settings) {
      settings = {
        is_live: false,
        youtube_url: "https://youtu.be/rn-99Ole2Mk",
        youtube_embed_id: "rn-99Ole2Mk",
        stream_title: "Vinayaka Navaratri Seva 2026 - Jagtial Live Darshan & Maha Aarti",
        live_announcement: "Daily Morning Abhishekam at 7:00 AM, Sahasranamarchana at 10:00 AM, Maha Annadanam at 1:00 PM, and Divya Maha Aarti at 7:30 PM live from Jagtial Pandal.",
        banner_image: "/images/navaratri-ganesha.jpg",
        location: "Jagtial, Telangana",
        start_date: "2026-09-14",
        end_date: "2026-09-24",
        morning_timings: "07:00 AM - 09:30 AM",
        annadanam_timings: "01:00 PM - 03:00 PM",
        evening_timings: "07:30 PM - 09:00 PM",
        shloka: "वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा॥",
        pandal_name: "Hindu Swaraj Youth Pandal, Jagtial",
        whatsapp_contact: "+91 8499878425",
        ticker_text: "🔴 LIVE: Vinayaka Navaratri Seva Mahotsavam 2026 in Jagtial • Daily Sahasranamarchana, Maha Annadanam & Divya Mangala Aarti • Book your Gotra Namavali Seva online",
        ticker_active: true,
        ad_banner_url: "/images/navaratri-aarti.jpg",
        ad_banner_link: "#seva-booking",
        ad_banner_title: "Sri Venkateshwara Swarna Kireetam & Jewellers",
        ad_banner_tagline: "Official Grand Aarti & Swarna Kavacha Sponsor • Jagtial",
        ad_banner_active: true,
        annadanam_count_today: 2850,
        laddu_auction_info: "Grand Maha Laddu Auction on Day 9 (22 Sep) at 6:00 PM",
        pandal_map_url: "https://maps.google.com/?q=Jagtial+Telangana",
      };
    }

    res.json({
      success: true,
      data: settings,
    });
  } catch (err) {
    console.error("GET NAVARATRI INFO ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to load Navaratri info" });
  }
});

/* =====================================================
   📅 2. PUBLIC: GET DAILY PUJA SCHEDULE
   GET /navaratri/schedule
===================================================== */
router.get("/schedule", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM navaratri_schedule ORDER BY day_number ASC"
    );
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET NAVARATRI SCHEDULE ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to load schedule" });
  }
});

/* =====================================================
   📸 3. PUBLIC: GET DAILY PHOTO POSTS & UPDATES
   GET /navaratri/posts
===================================================== */
router.get("/posts", async (req, res) => {
  try {
    const { category, day } = req.query;
    let query = "SELECT * FROM navaratri_posts WHERE 1=1";
    const params = [];

    if (category && category !== "ALL") {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (day && day !== "ALL") {
      params.push(Number(day));
      query += ` AND day_number = $${params.length}`;
    }

    query += " ORDER BY day_number DESC, created_at DESC";

    const result = await pool.query(query, params);
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET NAVARATRI POSTS ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to load updates" });
  }
});

/* =====================================================
   🏆 4. PUBLIC: GET FESTIVAL SPONSOR ADS & PATRONS
   GET /navaratri/sponsors
===================================================== */
router.get("/sponsors", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM navaratri_sponsors WHERE is_active = TRUE ORDER BY display_order ASC, created_at DESC"
    );
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET NAVARATRI SPONSORS ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to load sponsors" });
  }
});

/* =====================================================
   🏆 4B. ADMIN: GET ALL SPONSORS (INCLUDING INACTIVE)
   GET /navaratri/admin-sponsors
===================================================== */
router.get(
  "/admin-sponsors",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM navaratri_sponsors ORDER BY display_order ASC, created_at DESC"
      );
      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("GET ADMIN SPONSORS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to load sponsors" });
    }
  }
);

/* =====================================================
   ➕ 4C. ADMIN: CREATE SPONSOR AD
   POST /navaratri/sponsors
===================================================== */
router.post(
  "/sponsors",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        name,
        category = "TITLE_SPONSOR",
        tagline,
        offer_badge,
        shop_address,
        whatsapp_number,
        logo_url,
        banner_url,
        contact_phone,
        website_url,
        amount_sponsored = 0,
        is_active = true,
        display_order = 0,
      } = req.body;

      if (!name) {
        return res.status(400).json({ success: false, error: "Sponsor name is required" });
      }

      const result = await pool.query(
        `
        INSERT INTO navaratri_sponsors
        (name, category, tagline, offer_badge, shop_address, whatsapp_number, logo_url, banner_url, contact_phone, website_url, amount_sponsored, is_active, display_order, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
        RETURNING *
        `,
        [
          name.trim(),
          category,
          tagline || null,
          offer_badge || null,
          shop_address || null,
          whatsapp_number || null,
          logo_url || null,
          banner_url || null,
          contact_phone || null,
          website_url || null,
          Number(amount_sponsored) || 0,
          Boolean(is_active),
          Number(display_order) || 0,
        ]
      );

      res.json({
        success: true,
        message: "Sponsor ad created successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("CREATE NAVARATRI SPONSOR ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to create sponsor: " + err.message });
    }
  }
);

/* =====================================================
   ✏️ 4D. ADMIN: UPDATE SPONSOR AD
   PUT /navaratri/sponsors/:id
===================================================== */
router.put(
  "/sponsors/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        name,
        category,
        tagline,
        offer_badge,
        shop_address,
        whatsapp_number,
        logo_url,
        banner_url,
        contact_phone,
        website_url,
        amount_sponsored,
        is_active,
        display_order,
      } = req.body;

      const result = await pool.query(
        `
        UPDATE navaratri_sponsors
        SET name = COALESCE($1, name),
            category = COALESCE($2, category),
            tagline = COALESCE($3, tagline),
            offer_badge = COALESCE($4, offer_badge),
            shop_address = COALESCE($5, shop_address),
            whatsapp_number = COALESCE($6, whatsapp_number),
            logo_url = COALESCE($7, logo_url),
            banner_url = COALESCE($8, banner_url),
            contact_phone = COALESCE($9, contact_phone),
            website_url = COALESCE($10, website_url),
            amount_sponsored = COALESCE($11, amount_sponsored),
            is_active = COALESCE($12, is_active),
            display_order = COALESCE($13, display_order)
        WHERE id = $14
        RETURNING *
        `,
        [
          name,
          category,
          tagline,
          offer_badge,
          shop_address,
          whatsapp_number,
          logo_url,
          banner_url,
          contact_phone,
          website_url,
          amount_sponsored !== undefined ? Number(amount_sponsored) : null,
          is_active !== undefined ? Boolean(is_active) : null,
          display_order !== undefined ? Number(display_order) : null,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Sponsor not found" });
      }

      res.json({
        success: true,
        message: "Sponsor updated successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("UPDATE NAVARATRI SPONSOR ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to update sponsor: " + err.message });
    }
  }
);

/* =====================================================
   🗑️ 4E. ADMIN: DELETE SPONSOR AD
   DELETE /navaratri/sponsors/:id
===================================================== */
router.delete(
  "/sponsors/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM navaratri_sponsors WHERE id = $1", [req.params.id]);
      res.json({
        success: true,
        message: "Sponsor ad deleted successfully",
      });
    } catch (err) {
      console.error("DELETE NAVARATRI SPONSOR ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to delete sponsor" });
    }
  }
);

/* =====================================================
   🙏 5. ADMIN: GET ALL PRAYERS / WISHES
   GET /navaratri/wishes (SUPER ADMIN / PRESIDENT / EC)
===================================================== */
router.get(
  "/wishes",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM navaratri_wishes ORDER BY created_at DESC"
      );
      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("GET NAVARATRI WISHES ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to load prayers" });
    }
  }
);

/* =====================================================
   🙏 5B. PUBLIC: SUBMIT PRAYER / GOTRA WISH & OFFERING
   POST /navaratri/wishes
===================================================== */
router.post("/wishes", async (req, res) => {
  try {
    const {
      devotee_name,
      mobile,
      email,
      gotram,
      city,
      message,
      offering_amount = 0,
      payment_id = null,
    } = req.body;

    if (!devotee_name || !devotee_name.trim()) {
      return res.status(400).json({ success: false, error: "Devotee name is required" });
    }

    const cleanMobile = mobile ? mobile.trim().replace(/[^0-9]/g, "") : "";
    if (!cleanMobile || cleanMobile.length < 10) {
      return res.status(400).json({ success: false, error: "Valid 10-digit mobile number is required" });
    }

    const numOffering = Number(offering_amount) || 0;

    // Rate-limiting / anti-spam: 1 free submission per mobile number
    if (numOffering === 0) {
      const checkFree = await pool.query(
        `SELECT id FROM navaratri_wishes 
         WHERE mobile = $1 AND (offering_amount = 0 OR offering_amount IS NULL) 
         LIMIT 1`,
        [cleanMobile]
      );

      if (checkFree.rows.length > 0) {
        return res.status(400).json({
          success: false,
          already_free: true,
          error: "ఈ మొబైల్ నంబర్‌తో ఉచిత పూజా సంకల్పం ఇప్పటికే నమోదు చేయబడింది. మీరు స్వామివారి నిత్య అన్నదానానికి ₹51, ₹101 లేదా ₹116 కానుక సమర్పించి అదనపు సంకల్పం చేసుకోవచ్చు.",
        });
      }
    }

    const token_no = `HSY-NAV-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await pool.query(
      `
      INSERT INTO navaratri_wishes (devotee_name, mobile, email, gotram, city, message, offering_amount, payment_id, token_no)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
      `,
      [
        devotee_name.trim(),
        cleanMobile,
        email ? email.trim() : null,
        gotram ? gotram.trim() : "శివ / కాశ్యప గోత్రం",
        city ? city.trim() : "Jagtial, Telangana",
        message ? message.trim() : null,
        numOffering,
        payment_id,
        token_no,
      ]
    );

    // If Email provided, send full royal Golden Blessing Certificate email
    if (email && email.trim()) {
      try {
        const cleanEmail = email.trim();
        const sevaTitle = numOffering > 0 
          ? `శ్రీ వినాయక దివ్య కానుక సేవ (₹${numOffering.toLocaleString("en-IN")})`
          : "శ్రీ వినాయక నిత్య సహస్రనామార్చన & ఉచిత సంకల్ప పూజ";

        const settingsRes = await pool.query("SELECT * FROM navaratri_settings ORDER BY id ASC LIMIT 1");
        const s = settingsRes.rows[0] || {};

        const headerTitle = s.cert_header_title || "॥ శ్రీ సిద్ధి వినాయక ప్రసన్నః • ఓం శ్రీ గణేశాయ నమః ॥";
        const assocName = s.cert_assoc_name || "HINDU SWARAJ YOUTH WELFARE ASSOCIATION";
        const regdNo = s.cert_regd_no || "Regd. No: 784/2025 (Govt. of Telangana) • Head Office: H.No. 4-1-140, Vani Nagar, Jagtial - 505327";
        const festivalName = s.cert_festival_name || "🪔 VINAYAKA NAVARATRI SEVA MAHOTSAVAM - 2026 🪔";
        const mainTitle = s.cert_main_title || "దివ్య గోత్ర నామావళి & పూజా ఆశీర్వచన పత్రం";
        const mainSub = s.cert_main_sub || "Official Sacred Seva & Divine Blessings Certificate";
        const shlokaText = s.cert_shloka || "वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा॥";
        const blessingTelugu = s.cert_blessing_telugu || "శ్రీ సిద్ధి వినాయక స్వామి వారి దివ్య కృపా కటాక్షములచే మీ సంకల్పములన్నియు సిద్ధింపబడి, ఆయురారోగ్య ఐశ్వర్యాభివృద్ధి, సకల కార్యజయములు, సదా సుఖశాంతులు కలుగుగాక!";
        const blessingEnglish = s.cert_blessing_english || "May Lord Vighnaharta Ganesha shower his supreme blessings, remove all obstacles, and bestow peace, longevity, sound health, and boundless prosperity upon you and your entire family.";
        const priestName = s.cert_priest_name || "ప్రధాన అర్చకులు (Chief Archaka)";
        const priestRole = s.cert_priest_role || "Pandal Puja Committee";
        const presidentName = s.cert_president_name || "Mukesh Kokkula";
        const presidentRole = s.cert_president_role || "అధ్యక్షుడు (President), Hindu Swaraj Youth Association";
        const sealText = s.cert_seal_text || "HINDU SWARAJ • REGD. 784/2025 • JAGTIAL • SEAL";

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <title>${mainTitle}</title>
          </head>
          <body style="margin: 0; padding: 20px; background-color: #1a0803; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <table width="100%" border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td align="center">
                  <div style="max-width: 680px; width: 100%; margin: 0 auto; background: #fffcf4; border: 8px solid #b45309; outline: 3px solid #f59e0b; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); position: relative; text-align: center; box-sizing: border-box;">
                    
                    <!-- Inner Gold Border Frame -->
                    <div style="border: 2px dashed #b45309; border-radius: 10px; padding: 20px;">
                      
                      <!-- Top Sacred Inscription -->
                      <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: bold; color: #9a3412; letter-spacing: 1px;">
                        ${headerTitle}
                      </p>
                      <h1 style="margin: 4px 0 2px 0; font-size: 20px; color: #78350f; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase;">
                        ${assocName}
                      </h1>
                      <p style="margin: 0 0 14px 0; font-size: 11px; color: #b45309; line-height: 1.4;">
                        ${regdNo}
                      </p>

                      <!-- Festival Gold Ribbon Badge -->
                      <div style="margin: 0 auto 16px auto; display: inline-block; background: linear-gradient(135deg, #78350f 0%, #9a3412 100%); color: #fef3c7; font-size: 12px; font-weight: bold; padding: 5px 18px; border-radius: 999px; border: 1px solid #f59e0b; letter-spacing: 0.5px;">
                        ${festivalName}
                      </div>

                      <!-- Sacred Shloka -->
                      <div style="margin: 12px 0 16px 0; padding: 8px 14px; background: rgba(254, 243, 199, 0.6); border: 1px solid #fde68a; border-radius: 8px;">
                        <p style="margin: 0; font-size: 14px; font-weight: bold; color: #9a3412; font-style: italic;">
                          "${shlokaText}"
                        </p>
                      </div>

                      <!-- Certificate Main Title -->
                      <h2 style="margin: 0 0 4px 0; font-size: 22px; color: #78350f; font-weight: 900;">
                        ${mainTitle}
                      </h2>
                      <p style="margin: 0 0 18px 0; font-size: 12px; color: #b45309; font-style: italic; font-weight: 600;">
                        ${mainSub}
                      </p>

                      <!-- Devotee Details Box -->
                      <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 16px; margin-bottom: 18px; text-align: left;">
                        <table width="100%" border="0" cellspacing="0" cellpadding="6" style="font-size: 13px; color: #451a03;">
                          <tr>
                            <td width="50%" valign="top">
                              <span style="font-size: 11px; color: #9a3412; font-weight: bold; display: block; text-transform: uppercase;">భక్తుని / యజమాని పేరు (DEVOTEE NAME):</span>
                              <strong style="font-size: 15px; color: #78350f;">${devotee_name.trim()}</strong>
                            </td>
                            <td width="50%" valign="top">
                              <span style="font-size: 11px; color: #9a3412; font-weight: bold; display: block; text-transform: uppercase;">గోత్ర నామావళి (GOTRAM &amp; NAKSHATRAM):</span>
                              <strong style="font-size: 14px; color: #78350f;">${gotram ? gotram.trim() : "శివ / కాశ్యప గోత్రం (Shiva Gotram)"}</strong>
                            </td>
                          </tr>
                          <tr>
                            <td width="50%" valign="top">
                              <span style="font-size: 11px; color: #9a3412; font-weight: bold; display: block; text-transform: uppercase;">నిర్వహించిన పవిత్ర సేవ (PERFORMED SEVA):</span>
                              <strong style="font-size: 13px; color: #9a3412;">${sevaTitle}</strong>
                            </td>
                            <td width="50%" valign="top">
                              <span style="font-size: 11px; color: #9a3412; font-weight: bold; display: block; text-transform: uppercase;">సేవా మహోత్సవ తేదీ (SEVA DATE):</span>
                              <strong style="font-size: 13px; color: #78350f;">Vinayaka Navaratri Mahotsavam 2026</strong>
                            </td>
                          </tr>
                          <tr>
                            <td width="50%" valign="top">
                              <span style="font-size: 11px; color: #9a3412; font-weight: bold; display: block; text-transform: uppercase;">ప్రాంతం (CITY / VILLAGE):</span>
                              <strong style="font-size: 13px; color: #78350f;">${city ? city.trim() : "Jagtial, Telangana"}</strong>
                            </td>
                            <td width="50%" valign="top">
                              <span style="font-size: 11px; color: #9a3412; font-weight: bold; display: block; text-transform: uppercase;">అధికారిక టోకెన్ సంఖ్య (OFFICIAL TOKEN ID):</span>
                              <strong style="font-size: 14px; color: #b45309; letter-spacing: 0.5px;">${token_no}</strong>
                            </td>
                          </tr>
                        </table>
                      </div>

                      <!-- Divine Blessing Verse Box -->
                      <div style="background: #ffffff; border: 1.5px solid #d97706; border-radius: 10px; padding: 14px 18px; margin-bottom: 20px; text-align: center;">
                        <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: bold; color: #78350f; line-height: 1.6;">
                          "${blessingTelugu}"
                        </p>
                        <p style="margin: 0; font-size: 11px; color: #9a3412; font-style: italic; line-height: 1.5;">
                          "${blessingEnglish}"
                        </p>
                      </div>

                      <!-- Signatories & Official Seal -->
                      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-top: 16px; border-top: 1px dashed #b45309; padding-top: 14px;">
                        <tr>
                          <td width="33%" align="center" valign="bottom">
                            <p style="margin: 0 0 4px 0; font-size: 12px; font-weight: bold; color: #78350f;">✍️ ${priestName}</p>
                            <p style="margin: 0; font-size: 10px; color: #b45309;">${priestRole}</p>
                          </td>
                          <td width="34%" align="center" valign="middle">
                            <div style="display: inline-block; border: 2px solid #dc2626; color: #dc2626; padding: 4px 8px; border-radius: 6px; font-size: 9px; font-weight: 900; letter-spacing: 0.5px; text-transform: uppercase; background: #fff5f5;">
                              ★ ${sealText} ★
                            </div>
                          </td>
                          <td width="33%" align="center" valign="bottom">
                            <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 900; color: #78350f;">✍️ ${presidentName}</p>
                            <p style="margin: 0; font-size: 10px; color: #b45309;">${presidentRole}</p>
                          </td>
                        </tr>
                      </table>

                      <!-- Action Button -->
                      <div style="margin-top: 24px; text-align: center;">
                        <a href="https://hinduswaraj.org/vinayaka-navaratri?token=${token_no}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #ff6b00 0%, #d4a017 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 900; padding: 12px 28px; border-radius: 999px; box-shadow: 0 4px 15px rgba(255, 107, 0, 0.4); text-transform: uppercase; letter-spacing: 0.5px;">
                          🖨️ View &amp; Print Full Certificate (పూర్తి సర్టిఫికేట్ డౌన్‌లోడ్ చేసుకోండి) ↗
                        </a>
                      </div>

                    </div>
                  </div>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;

        sendMail(cleanEmail, `🪔 ${mainTitle} - 2026 | ${devotee_name.trim()} (${token_no})`, emailHtml);
      } catch (mailErr) {
        console.warn("Devotional email send notice:", mailErr.message);
      }
    }

    res.json({
      success: true,
      message: "🙏 మీ గోత్ర నామావళి & పూజా సంకల్పం విజయవంతంగా సమర్పించబడింది!",
      data: result.rows[0],
      token_no,
    });
  } catch (err) {
    console.error("POST NAVARATRI WISH ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to submit prayer" });
  }
});

/* =====================================================
   ⚙️ 6. ADMIN: UPDATE LIVE STREAM & EVENT PAGE SETTINGS
   PUT /navaratri/settings
===================================================== */
router.put(
  "/settings",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        is_live,
        youtube_url,
        stream_title,
        live_announcement,
        banner_image,
        location,
        start_date,
        end_date,
        morning_timings,
        annadanam_timings,
        evening_timings,
        shloka,
        pandal_name,
        whatsapp_contact,
        ticker_text,
        ticker_active,
        ad_banner_url,
        ad_banner_link,
        ad_banner_title,
        ad_banner_tagline,
        ad_banner_active,
        annadanam_count_today,
        laddu_auction_info,
        pandal_map_url,
        bg_audio_url,
        bg_audio_title,
        bg_audio_artist,
        bg_audio_active,
        bg_audio_autoplay,
        cert_header_title,
        cert_assoc_name,
        cert_regd_no,
        cert_festival_name,
        cert_main_title,
        cert_main_sub,
        cert_shloka,
        cert_blessing_telugu,
        cert_blessing_english,
        cert_priest_name,
        cert_priest_role,
        cert_president_name,
        cert_president_role,
        cert_seal_text,
      } = req.body;

      const youtube_embed_id = extractYouTubeId(youtube_url);

      const check = await pool.query("SELECT id FROM navaratri_settings LIMIT 1");
      let result;

      if (check.rows.length === 0) {
        result = await pool.query(
          `
          INSERT INTO navaratri_settings
          (is_live, youtube_url, youtube_embed_id, stream_title, live_announcement, banner_image, location, start_date, end_date, morning_timings, annadanam_timings, evening_timings, shloka, pandal_name, whatsapp_contact, ticker_text, ticker_active, ad_banner_url, ad_banner_link, ad_banner_title, ad_banner_tagline, ad_banner_active, annadanam_count_today, laddu_auction_info, pandal_map_url, bg_audio_url, bg_audio_title, bg_audio_artist, bg_audio_active, bg_audio_autoplay, cert_header_title, cert_assoc_name, cert_regd_no, cert_festival_name, cert_main_title, cert_main_sub, cert_shloka, cert_blessing_telugu, cert_blessing_english, cert_priest_name, cert_priest_role, cert_president_name, cert_president_role, cert_seal_text, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, CURRENT_TIMESTAMP)
          RETURNING *
          `,
          [
            Boolean(is_live),
            youtube_url || "",
            youtube_embed_id,
            stream_title || "Vinayaka Navaratri Seva 2026 - Live Darshan",
            live_announcement || "",
            banner_image || "/images/navaratri-ganesha.jpg",
            location || "Jagtial, Telangana",
            start_date || "2026-09-14",
            end_date || "2026-09-24",
            morning_timings || "07:00 AM - 09:30 AM",
            annadanam_timings || "01:00 PM - 03:00 PM",
            evening_timings || "07:30 PM - 09:00 PM",
            shloka || "वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा॥",
            pandal_name || "Hindu Swaraj Youth Pandal, Jagtial",
            whatsapp_contact || "+91 8499878425",
            ticker_text || "🔴 LIVE: Vinayaka Navaratri Seva Mahotsavam 2026 in Jagtial • Daily Sahasranamarchana, Maha Annadanam & Divya Mangala Aarti • Book your Gotra Namavali Seva online",
            ticker_active !== undefined ? Boolean(ticker_active) : true,
            ad_banner_url || null,
            ad_banner_link || "#seva-booking",
            ad_banner_title || "Sri Venkateshwara Swarna Kireetam & Jewellers",
            ad_banner_tagline || "Official Grand Aarti & Swarna Kavacha Sponsor • Jagtial",
            ad_banner_active !== undefined ? Boolean(ad_banner_active) : true,
            annadanam_count_today !== undefined ? Number(annadanam_count_today) : 2850,
            laddu_auction_info || "Grand Maha Laddu Auction on Day 9 (22 Sep) at 6:00 PM",
            pandal_map_url || "https://maps.google.com/?q=Jagtial+Telangana",
            bg_audio_url || "https://assets.mixkit.co/music/preview/mixkit-meditation-flute-and-bells-ambient-sound-581.mp3",
            bg_audio_title || "Om Gam Ganapataye Namaha • 108 Divine Dhun",
            bg_audio_artist || "Sacred Jagtial Pandal Vedic Chants",
            bg_audio_active !== undefined ? Boolean(bg_audio_active) : true,
            bg_audio_autoplay !== undefined ? Boolean(bg_audio_autoplay) : true,
            cert_header_title || "॥ శ్రీ సిద్ధి వినాయక ప్రసన్నః • ఓం శ్రీ గణేశాయ నమః ॥",
            cert_assoc_name || "HINDU SWARAJ YOUTH WELFARE ASSOCIATION",
            cert_regd_no || "Regd. No: 784/2025 (Govt. of Telangana) • Head Office: H.No. 4-1-140, Vani Nagar, Jagtial - 505327",
            cert_festival_name || "🪔 VINAYAKA NAVARATRI SEVA MAHOTSAVAM - 2026 🪔",
            cert_main_title || "దివ్య గోత్ర నామావళి & పూజా ఆశీర్వచన పత్రం",
            cert_main_sub || "Official Sacred Seva & Divine Blessings Certificate",
            cert_shloka || "वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषు सर्वदा॥",
            cert_blessing_telugu || "శ్రీ సిద్ధి వినాయక స్వామి వారి దివ్య కృపా కటాక్షములచే మీ సంకల్పములన్నియు సిద్ధింపబడి, ఆయురారోగ్య ఐశ్వర్యాభివృద్ధి, సకల కార్యజయములు, సదా సుఖశాంతులు కలుగుగాక!",
            cert_blessing_english || "May Lord Vighnaharta Ganesha shower his supreme blessings, remove all obstacles, and bestow peace, longevity, sound health, and boundless prosperity upon you and your entire family.",
            cert_priest_name || "ప్రధాన అర్చకులు (Chief Archaka)",
            cert_priest_role || "Pandal Puja Committee",
            cert_president_name || "Mukesh Kokkula",
            cert_president_role || "అధ్యక్షుడు (President), Hindu Swaraj Youth Association",
            cert_seal_text || "HINDU SWARAJ • REGD. 784/2025 • JAGTIAL • SEAL",
          ]
        );
      } else {
        result = await pool.query(
          `
          UPDATE navaratri_settings
          SET is_live = $1,
              youtube_url = $2,
              youtube_embed_id = $3,
              stream_title = COALESCE($4, stream_title),
              live_announcement = COALESCE($5, live_announcement),
              banner_image = COALESCE($6, banner_image),
              location = COALESCE($7, location),
              start_date = COALESCE($8, start_date),
              end_date = COALESCE($9, end_date),
              morning_timings = COALESCE($10, morning_timings),
              annadanam_timings = COALESCE($11, annadanam_timings),
              evening_timings = COALESCE($12, evening_timings),
              shloka = COALESCE($13, shloka),
              pandal_name = COALESCE($14, pandal_name),
              whatsapp_contact = COALESCE($15, whatsapp_contact),
              ticker_text = COALESCE($16, ticker_text),
              ticker_active = COALESCE($17, ticker_active),
              ad_banner_url = COALESCE($18, ad_banner_url),
              ad_banner_link = COALESCE($19, ad_banner_link),
              ad_banner_title = COALESCE($20, ad_banner_title),
              ad_banner_tagline = COALESCE($21, ad_banner_tagline),
              ad_banner_active = COALESCE($22, ad_banner_active),
              annadanam_count_today = COALESCE($23, annadanam_count_today),
              laddu_auction_info = COALESCE($24, laddu_auction_info),
              pandal_map_url = COALESCE($25, pandal_map_url),
              bg_audio_url = COALESCE($26, bg_audio_url),
              bg_audio_title = COALESCE($27, bg_audio_title),
              bg_audio_artist = COALESCE($28, bg_audio_artist),
              bg_audio_active = COALESCE($29, bg_audio_active),
              bg_audio_autoplay = COALESCE($30, bg_audio_autoplay),
              cert_header_title = COALESCE($31, cert_header_title),
              cert_assoc_name = COALESCE($32, cert_assoc_name),
              cert_regd_no = COALESCE($33, cert_regd_no),
              cert_festival_name = COALESCE($34, cert_festival_name),
              cert_main_title = COALESCE($35, cert_main_title),
              cert_main_sub = COALESCE($36, cert_main_sub),
              cert_shloka = COALESCE($37, cert_shloka),
              cert_blessing_telugu = COALESCE($38, cert_blessing_telugu),
              cert_blessing_english = COALESCE($39, cert_blessing_english),
              cert_priest_name = COALESCE($40, cert_priest_name),
              cert_priest_role = COALESCE($41, cert_priest_role),
              cert_president_name = COALESCE($42, cert_president_name),
              cert_president_role = COALESCE($43, cert_president_role),
              cert_seal_text = COALESCE($44, cert_seal_text),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $45
          RETURNING *
          `,
          [
            Boolean(is_live),
            youtube_url || "",
            youtube_embed_id,
            stream_title,
            live_announcement,
            banner_image,
            location,
            start_date,
            end_date,
            morning_timings,
            annadanam_timings,
            evening_timings,
            shloka,
            pandal_name,
            whatsapp_contact,
            ticker_text,
            ticker_active !== undefined ? Boolean(ticker_active) : null,
            ad_banner_url,
            ad_banner_link,
            ad_banner_title,
            ad_banner_tagline,
            ad_banner_active !== undefined ? Boolean(ad_banner_active) : null,
            annadanam_count_today !== undefined ? Number(annadanam_count_today) : null,
            laddu_auction_info,
            pandal_map_url,
            bg_audio_url,
            bg_audio_title,
            bg_audio_artist,
            bg_audio_active !== undefined ? Boolean(bg_audio_active) : null,
            bg_audio_autoplay !== undefined ? Boolean(bg_audio_autoplay) : null,
            cert_header_title,
            cert_assoc_name,
            cert_regd_no,
            cert_festival_name,
            cert_main_title,
            cert_main_sub,
            cert_shloka,
            cert_blessing_telugu,
            cert_blessing_english,
            cert_priest_name,
            cert_priest_role,
            cert_president_name,
            cert_president_role,
            cert_seal_text,
            check.rows[0].id,
          ]
        );
      }

      res.json({
        success: true,
        message: "Page, Live Stream & Ads settings saved successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("UPDATE NAVARATRI SETTINGS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to update settings: " + err.message });
    }
  }
);

/* =====================================================
   📸 7. ADMIN: CREATE DAILY PHOTO POST / UPDATE
   POST /navaratri/posts
===================================================== */
router.post(
  "/posts",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { day_number, title, description, image_url, category } = req.body;

      if (!title || !image_url) {
        return res.status(400).json({ success: false, error: "Title and Image URL are required" });
      }

      const result = await pool.query(
        `
        INSERT INTO navaratri_posts (day_number, title, description, image_url, category)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [
          Number(day_number) || 1,
          title.trim(),
          description ? description.trim() : null,
          image_url.trim(),
          category || "Puja & Darshan",
        ]
      );

      res.json({
        success: true,
        message: "Photo update published successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("CREATE NAVARATRI POST ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to create post" });
    }
  }
);

/* =====================================================
   🗑️ 8. ADMIN: DELETE DAILY POST
   DELETE /navaratri/posts/:id
===================================================== */
router.delete(
  "/posts/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM navaratri_posts WHERE id = $1", [req.params.id]);
      res.json({
        success: true,
        message: "Post deleted successfully",
      });
    } catch (err) {
      console.error("DELETE NAVARATRI POST ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to delete post" });
    }
  }
);

/* =====================================================
   📅 9. ADMIN: CREATE SCHEDULE DAY
   POST /navaratri/schedule
===================================================== */
router.post(
  "/schedule",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        day_number,
        date_str,
        title,
        alankaram,
        morning_puja,
        evening_aarti,
        annadanam_info,
        special_events,
        status = "UPCOMING",
      } = req.body;

      if (!title || !day_number) {
        return res.status(400).json({ success: false, error: "Day number and title are required" });
      }

      const result = await pool.query(
        `
        INSERT INTO navaratri_schedule
        (day_number, date_str, title, alankaram, morning_puja, evening_aarti, annadanam_info, special_events, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          Number(day_number),
          date_str || `Day ${day_number}`,
          title.trim(),
          alankaram ? alankaram.trim() : null,
          morning_puja ? morning_puja.trim() : null,
          evening_aarti ? evening_aarti.trim() : null,
          annadanam_info ? annadanam_info.trim() : null,
          special_events ? special_events.trim() : null,
          status,
        ]
      );

      res.json({
        success: true,
        message: "Schedule day created successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("CREATE NAVARATRI SCHEDULE ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to create schedule" });
    }
  }
);

/* =====================================================
   📅 10. ADMIN: UPDATE SCHEDULE DAY
   PUT /navaratri/schedule/:id
===================================================== */
router.put(
  "/schedule/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        day_number,
        date_str,
        title,
        alankaram,
        morning_puja,
        evening_aarti,
        annadanam_info,
        special_events,
        status,
      } = req.body;

      const result = await pool.query(
        `
        UPDATE navaratri_schedule
        SET day_number = COALESCE($1, day_number),
            date_str = COALESCE($2, date_str),
            title = COALESCE($3, title),
            alankaram = COALESCE($4, alankaram),
            morning_puja = COALESCE($5, morning_puja),
            evening_aarti = COALESCE($6, evening_aarti),
            annadanam_info = COALESCE($7, annadanam_info),
            special_events = COALESCE($8, special_events),
            status = COALESCE($9, status)
        WHERE id = $10
        RETURNING *
        `,
        [
          day_number !== undefined ? Number(day_number) : null,
          date_str,
          title,
          alankaram,
          morning_puja,
          evening_aarti,
          annadanam_info,
          special_events,
          status,
          req.params.id,
        ]
      );

      res.json({
        success: true,
        message: "Schedule updated successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("UPDATE NAVARATRI SCHEDULE ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to update schedule" });
    }
  }
);

/* =====================================================
   🗑️ 11. ADMIN: DELETE SCHEDULE DAY
   DELETE /navaratri/schedule/:id
===================================================== */
router.delete(
  "/schedule/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM navaratri_schedule WHERE id = $1", [req.params.id]);
      res.json({
        success: true,
        message: "Schedule day deleted successfully",
      });
    } catch (err) {
      console.error("DELETE NAVARATRI SCHEDULE ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to delete schedule day" });
    }
  }
);

/* =====================================================
   🗑️ 12. ADMIN: DELETE PRAYER WISH
   DELETE /navaratri/wishes/:id
===================================================== */
router.delete(
  "/wishes/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM navaratri_wishes WHERE id = $1", [req.params.id]);
      res.json({
        success: true,
        message: "Prayer wish deleted successfully",
      });
    } catch (err) {
      console.error("DELETE NAVARATRI WISH ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to delete wish" });
    }
  }
);

module.exports = router;
