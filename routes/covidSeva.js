const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* ================= ENSURE UPLOAD DIRS ================= */
const isProd = process.env.VERCEL || process.env.NODE_ENV === "production";
const uploadDir = isProd ? "/tmp" : path.join("uploads", "covid-seva");
if (!isProd) {
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {}
}

/* ================= MULTER CONFIG ================= */
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => {
    cb(null, "covid_" + Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const allowed = /png|jpg|jpeg|webp|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (!ext) {
      return cb(new Error("Only images and PDFs allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/* ================= INITIAL DB TABLE SETUP ================= */
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS covid_seva_settings (
      id SERIAL PRIMARY KEY,
      hero_title VARCHAR(255) DEFAULT '50 DAYS NON-STOP CORONA FOOD SEVA MAHAYAGNAM',
      hero_subtitle TEXT DEFAULT 'Standing strong for Jagtial during the COVID-19 pandemic — 50 consecutive days of hot meals, groceries, and medical relief for the needy and migrant families.',
      story_telugu TEXT DEFAULT 'కరోనా విపత్కర లాక్‌డౌన్ సమయంలో ఆకలితో అలమటించిన వేలాది మంది పేదలకు, వలస కూలీలకు, పారిశుద్ధ్య కార్మికులకు మరియు ఆసుపత్రి రోగులకు హిందూ స్వరాజ్ యూత్ ఆధ్వర్యంలో వరుసగా 50 రోజుల పాటు నిరంతరాయంగా పౌష్టికాహార భోజన ప్యాకెట్లను ఉచితంగా పంపిణీ చేసిన పవిత్ర సేవా యజ్ఞం.',
      story_english TEXT DEFAULT 'When the entire nation stood still in lockdown, our dedicated youth stepped onto the streets risking their lives to ensure no soul in Jagtial went to sleep hungry. For 50 unbroken days, fresh nutritious food was cooked, packed, and delivered to doorsteps, quarantine centres, hospitals, and highways.',
      youtube_url TEXT DEFAULT '',
      video_title VARCHAR(255) DEFAULT '50 Days Corona Annadanam Documentary - Hindu Swaraj Youth, Jagtial',
      stat_days INT DEFAULT 50,
      stat_meals VARCHAR(50) DEFAULT '50,000+',
      stat_volunteers VARCHAR(50) DEFAULT '100+',
      stat_families VARCHAR(50) DEFAULT '5,000+',
      photos JSONB DEFAULT '[]'::jsonb,
      newspaper_clippings JSONB DEFAULT '[]'::jsonb,
      certificates JSONB DEFAULT '[]'::jsonb,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const countRes = await pool.query("SELECT COUNT(*)::int as count FROM covid_seva_settings");
  if ((countRes.rows[0]?.count || 0) === 0) {
    await pool.query(`
      INSERT INTO covid_seva_settings (
        hero_title, hero_subtitle, youtube_url, stat_days, stat_meals, stat_volunteers, stat_families,
        photos, newspaper_clippings, certificates
      ) VALUES (
        '50 DAYS NON-STOP CORONA FOOD SEVA MAHAYAGNAM',
        'Standing strong for Jagtial during the COVID-19 pandemic — 50 consecutive days of hot meals, groceries, and medical relief for the needy and migrant families.',
        '',
        50,
        '50,000+',
        '100+',
        '5,000+',
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb
      )
    `);
  }
}

ensureTable().catch((e) => console.warn("Notice: covid_seva_settings table init:", e.message));

/* ================= PUBLIC GET ================= */
router.get("/public", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM covid_seva_settings ORDER BY id DESC LIMIT 1"
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error("COVID SEVA PUBLIC GET ERROR:", err.message);
    res.status(500).json({ success: false, error: "Failed to load Covid Seva data" });
  }
});

/* ================= ADMIN GET ================= */
router.get("/admin", verifyToken, checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "ADMIN"), async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM covid_seva_settings ORDER BY id DESC LIMIT 1"
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    console.error("COVID SEVA ADMIN GET ERROR:", err.message);
    res.status(500).json({ success: false, error: "Failed to load admin settings" });
  }
});

/* ================= ADMIN SAVE SETTINGS ================= */
router.post("/admin", verifyToken, checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "ADMIN"), async (req, res) => {
  try {
    const {
      hero_title,
      hero_subtitle,
      story_telugu,
      story_english,
      youtube_url,
      video_title,
      stat_days,
      stat_meals,
      stat_volunteers,
      stat_families,
      photos,
      newspaper_clippings,
      certificates,
      is_active,
    } = req.body;

    const existing = await pool.query("SELECT id FROM covid_seva_settings ORDER BY id DESC LIMIT 1");
    let saved;

    if (existing.rows.length > 0) {
      saved = await pool.query(
        `UPDATE covid_seva_settings SET
          hero_title = COALESCE($1, hero_title),
          hero_subtitle = COALESCE($2, hero_subtitle),
          story_telugu = COALESCE($3, story_telugu),
          story_english = COALESCE($4, story_english),
          youtube_url = COALESCE($5, youtube_url),
          video_title = COALESCE($6, video_title),
          stat_days = COALESCE($7, stat_days),
          stat_meals = COALESCE($8, stat_meals),
          stat_volunteers = COALESCE($9, stat_volunteers),
          stat_families = COALESCE($10, stat_families),
          photos = COALESCE($11::jsonb, photos),
          newspaper_clippings = COALESCE($12::jsonb, newspaper_clippings),
          certificates = COALESCE($13::jsonb, certificates),
          is_active = COALESCE($14, is_active),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $15
        RETURNING *`,
        [
          hero_title,
          hero_subtitle,
          story_telugu,
          story_english,
          youtube_url,
          video_title,
          stat_days,
          stat_meals,
          stat_volunteers,
          stat_families,
          photos ? JSON.stringify(photos) : null,
          newspaper_clippings ? JSON.stringify(newspaper_clippings) : null,
          certificates ? JSON.stringify(certificates) : null,
          is_active,
          existing.rows[0].id,
        ]
      );
    } else {
      saved = await pool.query(
        `INSERT INTO covid_seva_settings (
          hero_title, hero_subtitle, story_telugu, story_english, youtube_url, video_title,
          stat_days, stat_meals, stat_volunteers, stat_families, photos, newspaper_clippings, certificates, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14)
        RETURNING *`,
        [
          hero_title || '50 DAYS NON-STOP CORONA FOOD SEVA MAHAYAGNAM',
          hero_subtitle || 'Standing strong for Jagtial during the COVID-19 pandemic...',
          story_telugu || '',
          story_english || '',
          youtube_url || '',
          video_title || '50 Days Corona Annadanam Documentary',
          stat_days || 50,
          stat_meals || '50,000+',
          stat_volunteers || '100+',
          stat_families || '5,000+',
          JSON.stringify(photos || []),
          JSON.stringify(newspaper_clippings || []),
          JSON.stringify(certificates || []),
          is_active !== undefined ? is_active : true,
        ]
      );
    }

    res.json({ success: true, message: "Covid Seva settings saved successfully", data: saved.rows[0] });
  } catch (err) {
    console.error("COVID SEVA ADMIN SAVE ERROR:", err.message);
    res.status(500).json({ success: false, error: "Failed to save Covid Seva settings" });
  }
});

/* ================= ADMIN FILE UPLOAD ================= */
router.post(
  "/admin/upload",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "ADMIN"),
  upload.single("file"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded" });
      }
      const publicUrl = `/uploads/covid-seva/${req.file.filename}`;
      res.json({ success: true, url: publicUrl, filename: req.file.filename });
    } catch (err) {
      console.error("UPLOAD ERROR:", err.message);
      res.status(500).json({ success: false, error: "File upload failed" });
    }
  }
);

module.exports = router;
