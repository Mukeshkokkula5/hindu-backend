const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const sendMail = require("../utils/sendMail");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* =====================================================
   📸 MULTER DISK STORAGE FOR AAPADBANDHAVA FILES
===================================================== */
const uploadDir = path.join(__dirname, "..", "uploads", "aapadbandhava");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "aapadbandhava-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = /png|jpg|jpeg|webp|pdf|avif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype === "application/pdf";
    if (!ext || !mime) {
      return cb(new Error("Only image files (.png, .jpg, .jpeg, .webp) and PDF documents are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

/* =====================================================
   📦 AUTO-INIT DATABASE TABLES
===================================================== */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aapadbandhava_cases (
        id SERIAL PRIMARY KEY,
        case_code VARCHAR(50) UNIQUE NOT NULL,
        patient_name VARCHAR(255) NOT NULL,
        patient_age INT,
        gender VARCHAR(20) DEFAULT 'Male',
        city VARCHAR(100) DEFAULT 'Jagtial',
        address TEXT,
        guardian_name VARCHAR(255),
        guardian_relation VARCHAR(100),
        guardian_phone VARCHAR(30) NOT NULL,
        emergency_category VARCHAR(100) DEFAULT 'MEDICAL_SURGERY', -- MEDICAL_SURGERY, CANCER_TREATMENT, CHILD_CARE, ACCIDENT_TRAUMA, DISABILITY_ORPHAN, DISASTER_FIRE
        title VARCHAR(255) NOT NULL,
        story TEXT NOT NULL,
        hospital_name VARCHAR(255) NOT NULL,
        doctor_name VARCHAR(255),
        hospital_city VARCHAR(100) DEFAULT 'Jagtial',
        target_amount NUMERIC(12,2) NOT NULL,
        amount_raised NUMERIC(12,2) DEFAULT 0,
        urgency_level VARCHAR(50) DEFAULT 'CRITICAL', -- CRITICAL_48_HOURS, URGENT_7_DAYS, HIGH_PRIORITY
        primary_photo_url TEXT DEFAULT '/images/activity-disaster.png',
        additional_photos TEXT[] DEFAULT '{}',
        documents_urls TEXT[] DEFAULT '{}',
        beneficiary_acc_name VARCHAR(255) NOT NULL,
        beneficiary_bank_name VARCHAR(255) NOT NULL,
        beneficiary_acc_no VARCHAR(100) NOT NULL,
        beneficiary_ifsc VARCHAR(50) NOT NULL,
        beneficiary_upi_id VARCHAR(100),
        beneficiary_upi_phone VARCHAR(50),
        beneficiary_qr_url TEXT,
        status VARCHAR(50) DEFAULT 'PENDING', -- PENDING, ASSIGNED_FOR_STUDY, VERIFIED_ACTIVE, GOAL_REACHED, CLOSED_HELPED, REJECTED
        assigned_member_id INT REFERENCES users(id) ON DELETE SET NULL,
        assigned_member_name VARCHAR(255),
        assigned_member_phone VARCHAR(50),
        assigned_at TIMESTAMP,
        verification_report TEXT,
        verification_date TIMESTAMP,
        verified_by_role VARCHAR(100),
        doctor_contact_verified BOOLEAN DEFAULT FALSE,
        hospital_bill_verified BOOLEAN DEFAULT FALSE,
        home_visit_done BOOLEAN DEFAULT FALSE,
        is_featured BOOLEAN DEFAULT FALSE,
        views_count INT DEFAULT 0,
        shares_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS aapadbandhava_updates (
        id SERIAL PRIMARY KEY,
        case_id INT REFERENCES aapadbandhava_cases(id) ON DELETE CASCADE,
        update_title VARCHAR(255) NOT NULL,
        update_content TEXT NOT NULL,
        update_photo_url TEXT,
        posted_by VARCHAR(100) DEFAULT 'Hindu Swaraj Committee',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS aapadbandhava_contributions (
        id SERIAL PRIMARY KEY,
        case_id INT REFERENCES aapadbandhava_cases(id) ON DELETE CASCADE,
        donor_name VARCHAR(255) NOT NULL,
        donor_phone VARCHAR(50) NOT NULL,
        donor_email VARCHAR(255),
        donor_city VARCHAR(100) DEFAULT 'Jagtial',
        amount NUMERIC(12,2) NOT NULL,
        utr_reference VARCHAR(100),
        screenshot_url TEXT,
        certificate_code VARCHAR(100) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING_VERIFICATION', -- PENDING_VERIFICATION, APPROVED_DISPATCHED, REJECTED
        verified_by_admin VARCHAR(255),
        verified_at TIMESTAMP,
        email_sent BOOLEAN DEFAULT FALSE,
        whatsapp_sent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Auto-migrate columns if table already existed
      ALTER TABLE aapadbandhava_contributions ADD COLUMN IF NOT EXISTS donor_email VARCHAR(255);
      ALTER TABLE aapadbandhava_contributions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDING_VERIFICATION';
      ALTER TABLE aapadbandhava_contributions ADD COLUMN IF NOT EXISTS verified_by_admin VARCHAR(255);
      ALTER TABLE aapadbandhava_contributions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
      ALTER TABLE aapadbandhava_contributions ADD COLUMN IF NOT EXISTS email_sent BOOLEAN DEFAULT FALSE;
      ALTER TABLE aapadbandhava_contributions ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN DEFAULT FALSE;
    `);

    // Seed sample verified cases if empty
    const checkCount = await pool.query("SELECT COUNT(*) FROM aapadbandhava_cases");
    if (parseInt(checkCount.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO aapadbandhava_cases (
          case_code, patient_name, patient_age, gender, city, address,
          guardian_name, guardian_relation, guardian_phone, emergency_category,
          title, story, hospital_name, doctor_name, hospital_city,
          target_amount, amount_raised, urgency_level,
          primary_photo_url, documents_urls,
          beneficiary_acc_name, beneficiary_bank_name, beneficiary_acc_no, beneficiary_ifsc, beneficiary_upi_id, beneficiary_upi_phone, beneficiary_qr_url,
          status, assigned_member_name, verification_report, verification_date, verified_by_role,
          doctor_contact_verified, hospital_bill_verified, home_visit_done, is_featured
        ) VALUES 
        (
          'HSY-AID-2026-0001',
          'Master Sai Krishna',
          6,
          'Male',
          'Jagtial',
          'Near Clock Tower, Jagtial, Telangana',
          'Ramesh Goud',
          'Father (Daily Wage Worker)',
          '+91 98480 12345',
          'CHILD_CARE',
          'Urgent Open Heart Surgery for 6-Year-Old Sai Krishna in Jagtial',
          'Master Sai Krishna, a vibrant 6-year-old boy from a low-income family in Jagtial, was diagnosed with severe Congenital Heart Defect (Ventricular Septal Defect). His father Ramesh works as a daily wage laborer and has exhausted all life savings on preliminary ICU tests. The surgeons have scheduled an emergency corrective surgery. Without this surgery in 7 days, his oxygen levels are critically dropping. All funds will go directly to the hospital account and father''s bank account without any middleman.',
          'Apollo Children Hospital & Jagtial Area Hospital',
          'Dr. K. Srinivas Rao, Senior Pediatric Cardiologist',
          'Jagtial & Hyderabad',
          250000.00,
          145000.00,
          'CRITICAL_48_HOURS',
          '/images/activity-disaster.png',
          ARRAY['/images/navaratri-ganesha.jpg', '/images/signature.jpg'],
          'Ramesh Goud (Father of Sai Krishna)',
          'Union Bank of India, Jagtial Branch',
          '084910100098765',
          'UBIN0808491',
          'ramesh.saikrishna@upi',
          '+91 98480 12345',
          '/images/logo_v2.png',
          'VERIFIED_ACTIVE',
          'Mukesh Kokkula (President, HSY)',
          'Personally visited the hospital in Jagtial and verified with Dr. Srinivas Rao. The medical estimation certificate and echocardiogram reports were audited. Family background is verified to be genuine and in dire need. 100% Recommended for urgent public community assistance.',
          NOW(),
          'President & Executive Committee',
          TRUE,
          TRUE,
          TRUE,
          TRUE
        ),
        (
          'HSY-AID-2026-0002',
          'Smt. Lakshmi Bai',
          42,
          'Female',
          'Korutla, Jagtial District',
          'Vani Nagar, Korutla, Jagtial',
          'Suresh Kumar',
          'Husband (Auto Driver)',
          '+91 94400 54321',
          'CANCER_TREATMENT',
          'Emergency Chemotherapy & Radiation Support for Mother of Two',
          'Smt. Lakshmi Bai from Jagtial district is battling Stage 3 Breast Carcinoma. Her husband is an auto driver who is the sole breadwinner for a family of 4, including two school-going daughters. Doctors have recommended immediate 6 cycles of Targeted Chemotherapy. The family has sold their ancestral gold and needs urgent community assistance for immediate therapy medicine bills.',
          'District Govt Headquarters Hospital & Cancer Centre',
          'Dr. Anitha Reddy, Oncologist',
          'Jagtial District',
          180000.00,
          95000.00,
          'URGENT_7_DAYS',
          '/images/about-volunteers.png',
          ARRAY['/images/activity-blood.png'],
          'Suresh Kumar (Husband)',
          'State Bank of India, Korutla',
          '620194857321',
          'SBIN0020150',
          'suresh.lakshmi@oksbi',
          '+91 94400 54321',
          '/images/logo_v2.png',
          'VERIFIED_ACTIVE',
          'Karthik Rao (Executive Member)',
          'Verified medical records at Cancer Care Centre. Spoke with Dr. Anitha Reddy. Husband''s income certificate and hospital diagnosis audited on site.',
          NOW(),
          'Executive Committee Investigation Wing',
          TRUE,
          TRUE,
          TRUE,
          TRUE
        );
      `);

      // Seed sample update
      await pool.query(`
        INSERT INTO aapadbandhava_updates (case_id, update_title, update_content, posted_by)
        VALUES 
        (1, 'Pre-Surgery Medications Initiated & ICU Slot Booked', 'Thanks to generous donors, ₹1,45,000 has been received directly into father''s account. The hospital has booked the ICU surgery theatre for upcoming Tuesday morning.', 'Hindu Swaraj Ground Seva Team');
      `);

      console.log("✅ Seeded initial verified Aapadbandhava Emergency Cases");
    }
  } catch (err) {
    console.warn("Aapadbandhava auto-init notice:", err.message);
  }
})();

/* =====================================================
   📤 1. UPLOAD IMAGE / DOCUMENT FILE
   POST /aapadbandhava/upload
===================================================== */
router.post(
  "/upload",
  upload.single("file"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded" });
      }
      const fileUrl = `/uploads/aapadbandhava/${req.file.filename}`;
      res.json({
        success: true,
        message: "File uploaded successfully!",
        fileUrl,
        filename: req.file.filename,
      });
    } catch (err) {
      console.error("AAPADBANDHAVA UPLOAD ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Upload failed: " + err.message });
    }
  }
);

/* =====================================================
   🏛 2. PUBLIC: GET ALL VERIFIED ACTIVE CASES
   GET /aapadbandhava/public/cases
===================================================== */
router.get("/public/cases", async (req, res) => {
  try {
    const { category, search, urgency, status } = req.query;

    let query = `
      SELECT 
        id, case_code, patient_name, patient_age, gender, city,
        guardian_name, guardian_relation, guardian_phone, emergency_category,
        title, story, hospital_name, doctor_name, hospital_city,
        target_amount, amount_raised, urgency_level,
        primary_photo_url, additional_photos, documents_urls,
        beneficiary_acc_name, beneficiary_bank_name, beneficiary_acc_no, beneficiary_ifsc,
        beneficiary_upi_id, beneficiary_upi_phone, beneficiary_qr_url,
        status, assigned_member_name, verification_report, verification_date, verified_by_role,
        doctor_contact_verified, hospital_bill_verified, home_visit_done, is_featured,
        views_count, shares_count, created_at
      FROM aapadbandhava_cases
      WHERE status IN ('VERIFIED_ACTIVE', 'GOAL_REACHED', 'CLOSED_HELPED')
    `;
    const params = [];

    if (category && category !== "ALL") {
      params.push(category);
      query += ` AND emergency_category = $${params.length}`;
    }

    if (urgency && urgency !== "ALL") {
      params.push(urgency);
      query += ` AND urgency_level = $${params.length}`;
    }

    if (status && status !== "ALL") {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` AND (patient_name ILIKE $${params.length} OR title ILIKE $${params.length} OR hospital_name ILIKE $${params.length} OR city ILIKE $${params.length})`;
    }

    query += ` ORDER BY is_featured DESC, urgency_level = 'CRITICAL_48_HOURS' DESC, created_at DESC`;

    const { rows } = await pool.query(query, params);

    // Calculate summary statistics
    const statsRes = await pool.query(`
      SELECT 
        COUNT(*)::int as total_cases,
        COALESCE(SUM(target_amount), 0) as total_needed,
        COALESCE(SUM(amount_raised), 0) as total_facilitated,
        COUNT(CASE WHEN status = 'CLOSED_HELPED' THEN 1 END)::int as lives_saved
      FROM aapadbandhava_cases
      WHERE status IN ('VERIFIED_ACTIVE', 'GOAL_REACHED', 'CLOSED_HELPED')
    `);

    res.json({
      success: true,
      data: rows,
      stats: statsRes.rows[0] || {
        total_cases: 0,
        total_needed: 0,
        total_facilitated: 0,
        lives_saved: 0,
      },
    });
  } catch (err) {
    console.error("GET PUBLIC CASES ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to load emergency cases" });
  }
});

/* =====================================================
   🔍 3. PUBLIC: GET SINGLE CASE DETAILS WITH UPDATES
   GET /aapadbandhava/public/case/:idOrCode
===================================================== */
router.get("/public/case/:idOrCode", async (req, res) => {
  try {
    const { idOrCode } = req.params;

    // Increment view count
    await pool.query(
      `UPDATE aapadbandhava_cases SET views_count = views_count + 1 WHERE id::text = $1 OR case_code = $1`,
      [idOrCode]
    );

    const caseRes = await pool.query(
      `SELECT * FROM aapadbandhava_cases WHERE id::text = $1 OR case_code = $1`,
      [idOrCode]
    );

    if (caseRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Emergency case not found" });
    }

    const currentCase = caseRes.rows[0];

    // Fetch recovery updates
    const updatesRes = await pool.query(
      `SELECT * FROM aapadbandhava_updates WHERE case_id = $1 ORDER BY created_at DESC`,
      [currentCase.id]
    );

    res.json({
      success: true,
      data: {
        ...currentCase,
        updates: updatesRes.rows,
      },
    });
  } catch (err) {
    console.error("GET SINGLE CASE ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to load case details" });
  }
});

/* =====================================================
   📝 4. PUBLIC: SUBMIT NEW EMERGENCY AID APPLICATION
   POST /aapadbandhava/public/apply
===================================================== */
router.post("/public/apply", async (req, res) => {
  try {
    const {
      patient_name,
      patient_age,
      gender,
      city,
      address,
      guardian_name,
      guardian_relation,
      guardian_phone,
      emergency_category,
      title,
      story,
      hospital_name,
      doctor_name,
      hospital_city,
      target_amount,
      urgency_level,
      primary_photo_url,
      additional_photos,
      documents_urls,
      beneficiary_acc_name,
      beneficiary_bank_name,
      beneficiary_acc_no,
      beneficiary_ifsc,
      beneficiary_upi_id,
      beneficiary_upi_phone,
      beneficiary_qr_url,
    } = req.body;

    if (
      !patient_name ||
      !guardian_phone ||
      !title ||
      !story ||
      !hospital_name ||
      !target_amount ||
      !beneficiary_acc_name ||
      !beneficiary_bank_name ||
      !beneficiary_acc_no ||
      !beneficiary_ifsc
    ) {
      return res.status(400).json({
        success: false,
        error: "అన్ని తప్పనిసరి వివరాలను పూరించండి (Required fields missing: Patient Name, Contact Phone, Title, Story, Hospital, Target Amount, Bank Details)",
      });
    }

    // 1. Strict Name Validation (no numeric-only or junk strings)
    const cleanPatientName = String(patient_name || "").trim();
    if (cleanPatientName.length < 3 || /^\d+$/.test(cleanPatientName)) {
      return res.status(400).json({
        success: false,
        error: "దయచేసి సరైన పేషెంట్ పేరు నమోదు చేయండి (కనీసం 3 అక్షరాలు, సంఖ్యలు మాత్రమే ఉండకూడదు)",
      });
    }

    // 2. Strict Phone Validation (10 digits Indian mobile)
    const cleanPhone = String(guardian_phone || "").replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({
        success: false,
        error: "దయచేసి చెల్లుబాటు అయ్యే 10 అంకెల మొబైల్ నంబర్ నమోదు చేయండి (Valid 10-digit Indian mobile starting with 6,7,8,9 required)",
      });
    }

    // 3. Strict Amount Validation
    const amountNum = Number(target_amount);
    if (isNaN(amountNum) || amountNum < 1000 || amountNum > 50000000) {
      return res.status(400).json({
        success: false,
        error: "అవసరమైన సహాయ నిధి మొత్తం ₹1,000 నుండి ₹5,00,00,000 మధ్య మాత్రమే ఉండాలి",
      });
    }

    // 4. Strict Bank Account Number Validation (9 to 18 digits)
    const cleanAccNo = String(beneficiary_acc_no || "").replace(/\s+/g, "");
    if (!/^\d{9,18}$/.test(cleanAccNo)) {
      return res.status(400).json({
        success: false,
        error: "బ్యాంక్ ఖాతా సంఖ్య 9 నుండి 18 అంకెలు మాత్రమే ఉండాలి (Bank account must be 9-18 digits)",
      });
    }

    // 5. Strict IFSC Code Validation (11 characters standard format)
    const cleanIfsc = String(beneficiary_ifsc || "").trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleanIfsc)) {
      return res.status(400).json({
        success: false,
        error: "దయచేసి సరైన 11 అక్షరాల IFSC కోడ్ నమోదు చేయండి (ఉదా: SBIN0001234, UBIN0808491)",
      });
    }

    // 6. Medical Documents Mandatory Check (prevent fake cases)
    if (!documents_urls || !Array.isArray(documents_urls) || documents_urls.length === 0) {
      return res.status(400).json({
        success: false,
        error: "దయచేసి కనీసం ఒక హాస్పిటల్ ఎస్టిమేట్ లెటర్ లేదా డాక్టర్ బిల్లు డాక్యుమెంట్ అప్‌లోడ్ చేయండి (Medical Proof required)",
      });
    }

    // Generate unique Case Code
    const year = new Date().getFullYear();
    const countRes = await pool.query("SELECT COUNT(*) FROM aapadbandhava_cases");
    const nextNum = parseInt(countRes.rows[0].count, 10) + 1;
    const caseCode = `HSY-AID-${year}-${String(nextNum).padStart(4, "0")}`;

    const insertRes = await pool.query(
      `
      INSERT INTO aapadbandhava_cases (
        case_code, patient_name, patient_age, gender, city, address,
        guardian_name, guardian_relation, guardian_phone, emergency_category,
        title, story, hospital_name, doctor_name, hospital_city,
        target_amount, urgency_level,
        primary_photo_url, additional_photos, documents_urls,
        beneficiary_acc_name, beneficiary_bank_name, beneficiary_acc_no, beneficiary_ifsc,
        beneficiary_upi_id, beneficiary_upi_phone, beneficiary_qr_url,
        status
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17,
        $18, $19, $20,
        $21, $22, $23, $24,
        $25, $26, $27,
        'PENDING'
      ) RETURNING *
      `,
      [
        caseCode,
        patient_name,
        patient_age || null,
        gender || "Male",
        city || "Jagtial",
        address || "",
        guardian_name || "",
        guardian_relation || "",
        guardian_phone,
        emergency_category || "MEDICAL_SURGERY",
        title,
        story,
        hospital_name,
        doctor_name || "",
        hospital_city || "Jagtial",
        Number(target_amount),
        urgency_level || "CRITICAL",
        primary_photo_url || "/images/activity-disaster.png",
        additional_photos || [],
        documents_urls || [],
        beneficiary_acc_name,
        beneficiary_bank_name,
        beneficiary_acc_no,
        beneficiary_ifsc,
        beneficiary_upi_id || "",
        beneficiary_upi_phone || "",
        beneficiary_qr_url || "",
      ]
    );

    res.json({
      success: true,
      message: "🙏 Emergency appeal submitted successfully! Our ground investigation team will review documents and visit hospital for verification.",
      case_code: caseCode,
      data: insertRes.rows[0],
    });
  } catch (err) {
    console.error("APPLY AAPADBANDHAVA ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to submit emergency application" });
  }
});

/* =====================================================
   📲 5. PUBLIC: TRACK WHATSAPP SHARE
   POST /aapadbandhava/public/track-share/:id
===================================================== */
router.post("/public/track-share/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query(
      `UPDATE aapadbandhava_cases SET shares_count = shares_count + 1 WHERE id::text = $1 OR case_code = $1`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   📜 6. PUBLIC: SUBMIT DONOR CONTRIBUTION & ISSUE CERTIFICATE
   POST /aapadbandhava/public/submit-contribution
===================================================== */
router.post("/public/submit-contribution", async (req, res) => {
  try {
    const { case_id, donor_name, donor_phone, donor_city, amount, utr_reference, screenshot_url } = req.body;

    if (!case_id || !donor_name || !amount) {
      return res.status(400).json({
        success: false,
        error: "దయచేసి దాత పేరు మరియు సహాయం చేసిన మొత్తాన్ని నమోదు చేయండి",
      });
    }

    const cleanDonorName = String(donor_name).trim();
    const cleanAmount = Number(amount);

    if (cleanDonorName.length < 2 || isNaN(cleanAmount) || cleanAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: "దయచేసి సరైన దాత పేరు మరియు మొత్తాన్ని నమోదు చేయండి",
      });
    }

    // Verify Case exists
    const caseRes = await pool.query(`SELECT * FROM aapadbandhava_cases WHERE id = $1`, [case_id]);
    if (caseRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: "కేసు లభ్యం కాలేదు (Case not found)" });
    }
    const currentCase = caseRes.rows[0];

    // Generate unique Certificate Code: HSY-SEVA-2026-XXXX
    const year = new Date().getFullYear();
    const countRes = await pool.query("SELECT COUNT(*) FROM aapadbandhava_contributions");
    const nextNum = parseInt(countRes.rows[0].count, 10) + 1;
    const certCode = `HSY-SEVA-${year}-${String(nextNum).padStart(4, "0")}`;

    // Insert contribution
    const insertRes = await pool.query(
      `
      INSERT INTO aapadbandhava_contributions (
        case_id, donor_name, donor_phone, donor_city, amount, utr_reference, screenshot_url, certificate_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        case_id,
        cleanDonorName,
        donor_phone || "",
        donor_city || "Jagtial",
        cleanAmount,
        utr_reference || "",
        screenshot_url || "",
        certCode,
      ]
    );

    // Increment amount_raised on the emergency case
    const updatedCaseRes = await pool.query(
      `
      UPDATE aapadbandhava_cases 
      SET amount_raised = amount_raised + $1, updated_at = NOW()
      WHERE id = $2
      RETURNING amount_raised, target_amount, status
      `,
      [cleanAmount, case_id]
    );

    const contribution = insertRes.rows[0];
    const updatedCase = updatedCaseRes.rows[0];

    res.json({
      success: true,
      message: "🙏 ధన్యవాదాలు! మీ సేవా ప్రశంసా పత్రం విజయవంతంగా రూపొందించబడింది.",
      data: {
        contribution,
        certificate: {
          certificate_code: certCode,
          donor_name: cleanDonorName,
          donor_city: donor_city || "Jagtial",
          amount: cleanAmount,
          patient_name: currentCase.patient_name,
          case_code: currentCase.case_code,
          case_title: currentCase.title,
          hospital_name: currentCase.hospital_name,
          date: new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }),
          association_name: "హిందూ స్వరాజ్ యూత్ అసోసియేషన్ జగిత్యాల",
          reg_no: "Regd. No. 784/2025",
          president_name: "Mukesh Kokkula (President, HSY)",
          seal_text: "HSY 100% DIRECT SEVA VERIFIED",
        },
        case_stats: {
          amount_raised: updatedCase.amount_raised,
          target_amount: updatedCase.target_amount,
          percentage: Math.min(100, Math.round((Number(updatedCase.amount_raised) / Number(updatedCase.target_amount)) * 100)),
        },
      },
    });
  } catch (err) {
    console.error("SUBMIT CONTRIBUTION ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to record contribution and generate certificate" });
  }
});

/* =====================================================
   🔍 7. PUBLIC: GET CERTIFICATE DETAILS
   GET /aapadbandhava/public/certificate/:certCode
===================================================== */
router.get("/public/certificate/:certCode", async (req, res) => {
  try {
    const { certCode } = req.params;
    const certRes = await pool.query(
      `
      SELECT con.*, c.patient_name, c.title as case_title, c.case_code, c.hospital_name
      FROM aapadbandhava_contributions con
      JOIN aapadbandhava_cases c ON c.id = con.case_id
      WHERE con.certificate_code = $1
      `,
      [certCode]
    );

    if (certRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Certificate not found" });
    }

    const row = certRes.rows[0];
    res.json({
      success: true,
      data: {
        certificate_code: row.certificate_code,
        donor_name: row.donor_name,
        donor_city: row.donor_city,
        amount: row.amount,
        patient_name: row.patient_name,
        case_code: row.case_code,
        case_title: row.case_title,
        hospital_name: row.hospital_name,
        created_at: row.created_at,
        association_name: "హిందూ స్వరాజ్ యూత్ అసోసియేషన్ జగిత్యాల",
        reg_no: "Regd. No. 784/2025",
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   📋 8. PUBLIC: GET RECENT DONORS / CONTRIBUTIONS FOR CASE
   GET /aapadbandhava/public/contributions/:caseId
===================================================== */
router.get("/public/contributions/:caseId", async (req, res) => {
  try {
    const { caseId } = req.params;
    const { rows } = await pool.query(
      `
      SELECT donor_name, donor_city, amount, certificate_code, created_at
      FROM aapadbandhava_contributions
      WHERE case_id = $1 AND is_verified = TRUE
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [caseId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   🔒 6. ADMIN: GET ALL CASES (PENDING, ASSIGNED, ACTIVE, CLOSED)
   GET /aapadbandhava/admin/all-cases
===================================================== */
router.get(
  "/admin/all-cases",
  verifyToken,
  async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT c.*, 
          COALESCE((SELECT COUNT(*) FROM aapadbandhava_updates u WHERE u.case_id = c.id), 0)::int as updates_count
        FROM aapadbandhava_cases c
        ORDER BY 
          CASE WHEN c.status = 'PENDING' THEN 1
               WHEN c.status = 'ASSIGNED_FOR_STUDY' THEN 2
               WHEN c.status = 'VERIFIED_ACTIVE' THEN 3
               ELSE 4 END,
          c.created_at DESC
      `);

      // Get list of active committee members for assignment dropdown
      const membersRes = await pool.query(`
        SELECT id, name, username, role, phone, COALESCE(photo_url, '/images/leader-president.png') as photo_url
        FROM users
        WHERE active = true AND role != 'MEMBER'
        ORDER BY name ASC
      `);

      res.json({
        success: true,
        cases: rows,
        committeeMembers: membersRes.rows,
      });
    } catch (err) {
      console.error("ADMIN ALL CASES ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch admin cases" });
    }
  }
);

/* =====================================================
   🔒 7. ADMIN: ASSIGN MEMBER FOR GROUND STUDY
   PUT /aapadbandhava/admin/assign/:id
===================================================== */
router.put(
  "/admin/assign/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { member_id } = req.body;

      if (!member_id) {
        return res.status(400).json({ success: false, error: "Please select a member to assign" });
      }

      const userRes = await pool.query(
        "SELECT id, name, phone, role FROM users WHERE id = $1",
        [member_id]
      );

      if (userRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Member not found" });
      }

      const member = userRes.rows[0];

      const { rows } = await pool.query(
        `
        UPDATE aapadbandhava_cases
        SET 
          assigned_member_id = $1,
          assigned_member_name = $2,
          assigned_member_phone = $3,
          assigned_at = CURRENT_TIMESTAMP,
          status = 'ASSIGNED_FOR_STUDY',
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
        `,
        [member.id, member.name, member.phone, id]
      );

      res.json({
        success: true,
        message: `Case assigned to ${member.name} for ground study and hospital verification.`,
        data: rows[0],
      });
    } catch (err) {
      console.error("ASSIGN MEMBER ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to assign member" });
    }
  }
);

/* =====================================================
   🔒 8. MEMBER / ADMIN: SUBMIT GROUND STUDY & VERIFICATION REPORT
   PUT /aapadbandhava/member/submit-report/:id
===================================================== */
router.put(
  "/member/submit-report/:id",
  verifyToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        verification_report,
        doctor_contact_verified,
        hospital_bill_verified,
        home_visit_done,
        verified_by_role,
      } = req.body;

      if (!verification_report || verification_report.trim().length < 15) {
        return res.status(400).json({
          success: false,
          error: "Detailed ground verification report is required (minimum 15 characters).",
        });
      }

      const { rows } = await pool.query(
        `
        UPDATE aapadbandhava_cases
        SET 
          verification_report = $1,
          doctor_contact_verified = COALESCE($2, doctor_contact_verified),
          hospital_bill_verified = COALESCE($3, hospital_bill_verified),
          home_visit_done = COALESCE($4, home_visit_done),
          verified_by_role = COALESCE($5, 'Investigating Member'),
          verification_date = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6
        RETURNING *
        `,
        [
          verification_report,
          doctor_contact_verified,
          hospital_bill_verified,
          home_visit_done,
          verified_by_role || req.user.role,
          id,
        ]
      );

      res.json({
        success: true,
        message: "Ground verification report submitted successfully! Awaiting Super Admin final approval.",
        data: rows[0],
      });
    } catch (err) {
      console.error("SUBMIT REPORT ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to submit verification report" });
    }
  }
);

/* =====================================================
   🔒 9. SUPER ADMIN / PRESIDENT: VERIFY & PUBLISH CASE
   PUT /aapadbandhava/admin/verify-publish/:id
===================================================== */
router.put(
  "/admin/verify-publish/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { is_featured, target_amount, status } = req.body;

      const { rows } = await pool.query(
        `
        UPDATE aapadbandhava_cases
        SET 
          status = COALESCE($1, 'VERIFIED_ACTIVE'),
          is_featured = COALESCE($2, is_featured),
          target_amount = COALESCE($3, target_amount),
          verification_date = COALESCE(verification_date, CURRENT_TIMESTAMP),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
        `,
        [status || "VERIFIED_ACTIVE", is_featured !== undefined ? is_featured : true, target_amount || null, id]
      );

      res.json({
        success: true,
        message: "Case 100% Verified and Published Live on Public Portal! 🛡️",
        data: rows[0],
      });
    } catch (err) {
      console.error("VERIFY PUBLISH ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to publish case" });
    }
  }
);

/* =====================================================
   🔒 10. ADMIN: UPDATE CASE STATUS & AMOUNT RAISED
   PUT /aapadbandhava/admin/update-status/:id
===================================================== */
router.put(
  "/admin/update-status/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER", "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, amount_raised, is_featured } = req.body;

      const { rows } = await pool.query(
        `
        UPDATE aapadbandhava_cases
        SET 
          status = COALESCE($1, status),
          amount_raised = COALESCE($2, amount_raised),
          is_featured = COALESCE($3, is_featured),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
        `,
        [status, amount_raised, is_featured, id]
      );

      res.json({
        success: true,
        message: "Case status updated successfully!",
        data: rows[0],
      });
    } catch (err) {
      console.error("UPDATE STATUS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to update status" });
    }
  }
);

/* =====================================================
   🔒 11. ADMIN: ADD SURGERY / RECOVERY MILESTONE UPDATE
   POST /aapadbandhava/admin/add-case-update/:id
===================================================== */
router.post(
  "/admin/add-case-update/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "TREASURER", "EC_MEMBER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { update_title, update_content, update_photo_url } = req.body;

      if (!update_title || !update_content) {
        return res.status(400).json({ success: false, error: "Title and content required" });
      }

      const { rows } = await pool.query(
        `
        INSERT INTO aapadbandhava_updates (case_id, update_title, update_content, update_photo_url, posted_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
        `,
        [id, update_title, update_content, update_photo_url || null, req.user.name || "Hindu Swaraj Committee"]
      );

      res.json({
        success: true,
        message: "Patient recovery update posted successfully!",
        data: rows[0],
      });
    } catch (err) {
      console.error("ADD UPDATE ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to add milestone update" });
    }
  }
);

/* =====================================================
   🔒 12. ADMIN: GET ALL CONTRIBUTIONS / AUDIT LIST
   GET /aapadbandhava/admin/contributions
===================================================== */
router.get(
  "/admin/contributions",
  verifyToken,
  async (req, res) => {
    try {
      const { status, case_id } = req.query;
      let query = `
        SELECT con.*, c.patient_name, c.title as case_title, c.case_code, c.hospital_name, c.target_amount, c.amount_raised
        FROM aapadbandhava_contributions con
        JOIN aapadbandhava_cases c ON c.id = con.case_id
        WHERE 1=1
      `;
      const params = [];

      if (status && status !== "ALL") {
        params.push(status);
        query += ` AND con.status = $${params.length}`;
      }

      if (case_id) {
        params.push(case_id);
        query += ` AND con.case_id = $${params.length}`;
      }

      query += ` ORDER BY con.created_at DESC`;

      const { rows } = await pool.query(query, params);
      res.json({ success: true, data: rows });
    } catch (err) {
      console.error("ADMIN CONTRIBUTIONS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch contributions" });
    }
  }
);

/* =====================================================
   🔒 13. ADMIN: VERIFY & APPROVE DONATION + DISPATCH CERTIFICATE
   PUT /aapadbandhava/admin/verify-contribution/:id
===================================================== */
router.put(
  "/admin/verify-contribution/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER", "GENERAL_SECRETARY", "EC_MEMBER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { action, notes } = req.body; // 'APPROVE' or 'REJECT'

      const contribRes = await pool.query(
        `
        SELECT con.*, c.patient_name, c.title as case_title, c.case_code, c.hospital_name
        FROM aapadbandhava_contributions con
        JOIN aapadbandhava_cases c ON c.id = con.case_id
        WHERE con.id = $1
        `,
        [id]
      );

      if (contribRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Contribution record not found" });
      }

      const con = contribRes.rows[0];

      if (action === "REJECT") {
        await pool.query(
          `UPDATE aapadbandhava_contributions SET status = 'REJECTED', verified_by_admin = $1, verified_at = NOW() WHERE id = $2`,
          [req.user.name || "Admin", id]
        );
        return res.json({
          success: true,
          message: "Contribution rejected as unverified.",
        });
      }

      // Approve Contribution
      await pool.query(
        `
        UPDATE aapadbandhava_contributions 
        SET status = 'APPROVED_DISPATCHED', verified_by_admin = $1, verified_at = NOW()
        WHERE id = $2
        `,
        [req.user.name || "Admin", id]
      );

      // Increment case amount_raised
      await pool.query(
        `UPDATE aapadbandhava_cases SET amount_raised = amount_raised + $1, updated_at = NOW() WHERE id = $2`,
        [con.amount, con.case_id]
      );

      // 1. Prepare WhatsApp text & Direct Link
      const cleanPhone = String(con.donor_phone).replace(/\D/g, "").slice(-10);
      const certViewUrl = `https://hinduswarajyouth.online/aapadbandhava?cert=${con.certificate_code}`;
      const whatsappText = `🚩 *హిందూ స్వరాజ్ యూత్ అసోసియేషన్ జగిత్యాల (Regd. 784/2025)* 🚩\n*ఆపద్బాంధవ అత్యవసర ప్రజా సహాయ నిధి*\n\nనమస్కారం శ్రీ/శ్రీమతి *${con.donor_name}* గారు 🙏,\n\nజగిత్యాల ఆపద్బాంధవ ద్వారా ప్రాణాపాయ స్థితిలో ఉన్న *${con.patient_name}* గారి అత్యవసర చికిత్స నిమిత్తం మీరు అందించిన *₹${Number(con.amount).toLocaleString("en-IN")}* విరాళం బాధితుడి ఖాతాకు చేరినట్లు మా అసోసియేషన్ విజయవంతంగా నిర్ధారించింది.\n\nమీ నిస్వార్థ సేవకు కృతజ్ఞతగా అసోసియేషన్ అధ్యక్షులు ముకేష్ కొక్కుల గారి సంతకంతో అధికారిక *సేవా ప్రశంసా పత్రం (Certificate of Appreciation)* జారీ చేయబడింది.\n\n🆔 *సర్టిఫికెట్ నంబర్:* \`${con.certificate_code}\`\n🔗 *మీ అధికారిక సర్టిఫికెట్ ఇక్కడ వీక్షించండి / డౌన్‌లోడ్ చేసుకోండి:*\n👉 ${certViewUrl}\n\nమీ సహృదయానికి హిందూ స్వరాజ్ యూత్ అసోసియేషన్ జగిత్యాల హృదయపూర్వక ధన్యవాదాలు తెలియజేస్తోంది.\n|| ప్రజా సేవయే ఈశ్వర సేవ || 🚩`;
      const whatsappUrl = `https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent(whatsappText)}`;

      // 2. Dispatch Email via sendMail (Resend)
      let emailDispatched = false;
      if (con.donor_email && con.donor_email.includes("@")) {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; background: #0b0f17; color: #ffffff; padding: 30px; border-radius: 12px; border: 2px solid #ffd700; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; border-bottom: 2px solid #ffd700; padding-bottom: 15px;">
              <h2 style="color: #ff9933; margin: 0;">HINDU SWARAJ YOUTH WELFARE ASSOCIATION</h2>
              <p style="color: #ffd700; font-size: 13px; margin: 5px 0 0;">Regd. No. 784/2025 • Jagtial, Telangana</p>
            </div>
            <div style="text-align: center; padding: 25px 15px;">
              <h1 style="color: #ffd700; font-size: 22px;">🚩 ఆపద్బాంధవ జీవనదాత సేవా ప్రశంసా పత్రం 🚩</h1>
              <p style="color: #cbd5e1; font-size: 15px;">గౌరవనీయులైన <strong>శ్రీ/శ్రీమతి ${con.donor_name}</strong> గారికి,</p>
              <p style="color: #e2e8f0; line-height: 1.6; font-size: 14px;">
                జగిత్యాల ఆపద్బాంధవ అత్యవసర ప్రజా సేవా నిధి ద్వారా ప్రాణాపాయ స్థితిలో ఉన్న <strong>${con.patient_name}</strong> గారి వైద్య చికిత్స కోసం మీరు అందించిన <strong>₹${Number(con.amount).toLocaleString("en-IN")}</strong> విరాళం బాధితుడి ఖాతాకు చేరినట్లు హిందూ స్వరాజ్ యూత్ కార్యవర్గం ధృవీకరించింది.
              </p>
              <div style="background: rgba(255,215,0,0.1); border: 1px solid #ffd700; padding: 12px; border-radius: 8px; margin: 20px 0;">
                <span style="color: #ffd700; font-weight: bold;">సర్టిఫికెట్ ఐడీ: ${con.certificate_code}</span>
              </div>
              <a href="${certViewUrl}" style="background: #ff7700; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block; margin-top: 10px;">
                📜 మీ అధికారిక సర్టిఫికెట్ డౌన్‌లోడ్ చేసుకోండి
              </a>
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 15px; font-size: 12px; color: #94a3b8; text-align: center;">
              హిందూ స్వరాజ్ యూత్ అసోసియేషన్, జగిత్యాల • ప్రెసిడెంట్: ముకేష్ కొక్కుల
            </div>
          </div>
        `;

        try {
          emailDispatched = await sendMail(
            con.donor_email,
            `🚩 మీ ఆపద్బాంధవ సేవా ప్రశంసా పత్రం [${con.certificate_code}] - హిందూ స్వరాజ్ యూత్`,
            emailHtml
          );
          if (emailDispatched) {
            await pool.query(`UPDATE aapadbandhava_contributions SET email_sent = TRUE WHERE id = $1`, [id]);
          }
        } catch (mailErr) {
          console.error("Mail send error:", mailErr.message);
        }
      }

      res.json({
        success: true,
        message: `✅ Donation verified! Certificate ${con.certificate_code} approved and dispatched!`,
        whatsapp_url: whatsappUrl,
        email_sent: emailDispatched,
        certificate_code: con.certificate_code,
      });
    } catch (err) {
      console.error("VERIFY CONTRIBUTION ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to verify donation" });
    }
  }
);

module.exports = router;

