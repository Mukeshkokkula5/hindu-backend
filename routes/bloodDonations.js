const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* =====================================================
   📸 MULTER DISK STORAGE FOR BLOOD DONOR PHOTOS
===================================================== */
const isProd = process.env.VERCEL || process.env.NODE_ENV === "production";
const uploadDir = isProd ? "/tmp" : path.join(__dirname, "..", "uploads", "blood");

if (!isProd) {
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Blood upload dir init notice:", e.message);
  }
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "blood-hero-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = /png|jpg|jpeg|webp|avif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (!ext || !mime) {
      return cb(new Error("Only image files (.png, .jpg, .jpeg, .webp, .avif) are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/* =====================================================
   📤 1. UPLOAD DONOR BLOOD PHOTO
   POST /blood-donations/upload-photo
===================================================== */
router.post(
  "/upload-photo",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "TREASURER", "EC_MEMBER", "MEMBER"),
  upload.single("photo"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No photo file uploaded" });
      }
      let photoUrl = `/uploads/blood/${req.file.filename}`;
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        if (req.file.path && fs.existsSync(req.file.path)) {
          const b64 = fs.readFileSync(req.file.path).toString("base64");
          const mime = req.file.mimetype || "image/jpeg";
          photoUrl = `data:${mime};base64,${b64}`;
        }
      }
      res.json({
        success: true,
        message: "Donor photo uploaded successfully",
        photo_url: photoUrl,
        url: photoUrl,
        fileUrl: photoUrl,
        imageUrl: photoUrl,
      });
    } catch (err) {
      console.error("Photo Upload Error:", err);
      res.status(500).json({ success: false, error: "Failed to process photo upload" });
    }
  }
);

/* =====================================================
   🌐 2. GET PUBLIC BLOOD HEROES & METRICS
   GET /blood-donations/public
===================================================== */
router.get("/public", async (req, res) => {
  try {
    const { blood_group, limit = 50 } = req.query;

    let query = `
      SELECT id, donor_name, donor_type, member_id, blood_group, 
             donation_date, hospital_or_camp, units, photo_url, certificate_id, 
             honor_badge, donation_count_milestone, notes, verified_by, created_at
      FROM blood_donations
      WHERE is_public = true
    `;
    const params = [];

    if (blood_group && blood_group !== "ALL") {
      params.push(blood_group);
      query += ` AND blood_group = $${params.length}`;
    }

    query += ` ORDER BY donation_date DESC, id DESC LIMIT $${params.length + 1}`;
    params.push(Number(limit));

    const result = await pool.query(query, params);

    // Compute aggregated metrics
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*)::int as total_donations,
        COALESCE(SUM(units), 0)::int as total_units,
        COUNT(DISTINCT donor_name)::int as unique_donors,
        COALESCE(SUM(units * 3), 0)::int as lives_impacted
      FROM blood_donations
      WHERE is_public = true
    `);

    const groupStats = await pool.query(`
      SELECT blood_group, COUNT(*)::int as count, COALESCE(SUM(units), 0)::int as units
      FROM blood_donations
      WHERE is_public = true
      GROUP BY blood_group
      ORDER BY count DESC
    `);

    // Fetch official association settings for digital certificate signatures & seal
    const assocRes = await pool.query(`
      SELECT association_name, president_name, gs_name, treasurer_name, president_signature_url, gs_signature_url, treasurer_signature_url, association_seal_url, regd_no
      FROM association_settings
      ORDER BY id DESC LIMIT 1
    `);

    res.json({
      success: true,
      stats: statsResult.rows[0] || { total_donations: 0, total_units: 0, unique_donors: 0, lives_impacted: 0 },
      group_breakdown: groupStats.rows || [],
      heroes: result.rows,
      assoc_info: assocRes.rows[0] || {},
    });
  } catch (err) {
    console.error("Public Blood Heroes Error:", err);
    res.status(500).json({ success: false, error: "Failed to load blood heroes: " + err.message });
  }
});

/* =====================================================
   📜 3. GET SINGLE DIGITAL BLOOD CERTIFICATE
   GET /blood-donations/certificate/:certId
===================================================== */
router.get("/certificate/:certId", async (req, res) => {
  try {
    const { certId } = req.params;
    const result = await pool.query(
      `SELECT * FROM blood_donations WHERE certificate_id = $1 OR id::text = $1 LIMIT 1`,
      [certId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Blood donation certificate not found" });
    }

    const assocRes = await pool.query(`
      SELECT association_name, president_signature_url, gs_signature_url, treasurer_signature_url, association_seal_url, regd_no
      FROM association_settings
      ORDER BY id DESC LIMIT 1
    `);

    res.json({
      success: true,
      donation: result.rows[0],
      assoc_info: assocRes.rows[0] || {},
    });
  } catch (err) {
    console.error("Certificate Query Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch certificate: " + err.message });
  }
});

/* =====================================================
   👑 4. GET ALL BLOOD DONATIONS (ADMIN)
   GET /blood-donations/admin
===================================================== */
router.get(
  "/admin",
  verifyToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM blood_donations ORDER BY donation_date DESC, id DESC`
      );
      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("Admin Blood Donations Error:", err);
      res.status(500).json({ success: false, error: "Failed to fetch blood donations: " + err.message });
    }
  }
);

/* =====================================================
   ➕ 5. CREATE NEW BLOOD DONATION RECORD (ADMIN)
   POST /blood-donations/admin
===================================================== */
router.post(
  "/admin",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const {
        donor_name,
        donor_type = "MEMBER",
        member_id,
        phone,
        email,
        blood_group,
        donation_date,
        hospital_or_camp,
        units = 1,
        photo_url,
        honor_badge = "Rakta Datha",
        donation_count_milestone = 1,
        notes,
        verified_by = "Hindu Swaraj Executive Committee",
        is_public = true,
      } = req.body;

      if (!donor_name || !blood_group || !hospital_or_camp) {
        return res.status(400).json({
          success: false,
          error: "Donor Name, Blood Group, and Hospital/Camp name are required.",
        });
      }

      // Generate unique serial certificate ID: e.g. HSY-BD-2026-0042
      const year = new Date(donation_date || Date.now()).getFullYear();
      const countRes = await pool.query(`SELECT COUNT(*)::int as count FROM blood_donations`);
      const nextNum = (countRes.rows[0]?.count || 0) + 1;
      const certificate_id = `HSY-BD-${year}-${String(nextNum).padStart(4, "0")}`;

      const defaultPhoto = photo_url || "/images/activity-blood.png";

      const insertRes = await pool.query(
        `
        INSERT INTO blood_donations (
          donor_name, donor_type, member_id, phone, email,
          blood_group, donation_date, hospital_or_camp, units,
          photo_url, certificate_id, honor_badge, donation_count_milestone,
          notes, verified_by, is_public, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        RETURNING *
        `,
        [
          donor_name.trim(),
          donor_type,
          member_id || null,
          phone || null,
          email || null,
          blood_group.trim().toUpperCase(),
          donation_date || new Date().toISOString().split("T")[0],
          hospital_or_camp.trim(),
          Number(units) || 1,
          defaultPhoto,
          certificate_id,
          honor_badge || "Rakta Datha",
          Number(donation_count_milestone) || 1,
          notes || "",
          verified_by || "Hindu Swaraj Executive Committee",
          is_public !== false,
        ]
      );

      res.status(201).json({
        success: true,
        message: "Blood donation record & Certificate generated successfully!",
        data: insertRes.rows[0],
      });
    } catch (err) {
      console.error("Create Blood Donation Error:", err);
      res.status(500).json({ success: false, error: "Failed to create blood donation: " + err.message });
    }
  }
);

/* =====================================================
   ✏️ 6. UPDATE BLOOD DONATION RECORD (ADMIN)
   PUT /blood-donations/admin/:id
===================================================== */
router.put(
  "/admin/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        donor_name,
        donor_type,
        member_id,
        phone,
        email,
        blood_group,
        donation_date,
        hospital_or_camp,
        units,
        photo_url,
        honor_badge,
        donation_count_milestone,
        notes,
        verified_by,
        is_public,
      } = req.body;

      const updateRes = await pool.query(
        `
        UPDATE blood_donations SET
          donor_name = COALESCE($1, donor_name),
          donor_type = COALESCE($2, donor_type),
          member_id = COALESCE($3, member_id),
          phone = COALESCE($4, phone),
          email = COALESCE($5, email),
          blood_group = COALESCE($6, blood_group),
          donation_date = COALESCE($7, donation_date),
          hospital_or_camp = COALESCE($8, hospital_or_camp),
          units = COALESCE($9, units),
          photo_url = COALESCE($10, photo_url),
          honor_badge = COALESCE($11, honor_badge),
          donation_count_milestone = COALESCE($12, donation_count_milestone),
          notes = COALESCE($13, notes),
          verified_by = COALESCE($14, verified_by),
          is_public = COALESCE($15, is_public)
        WHERE id = $16
        RETURNING *
        `,
        [
          donor_name ? donor_name.trim() : null,
          donor_type || null,
          member_id || null,
          phone || null,
          email || null,
          blood_group ? blood_group.trim().toUpperCase() : null,
          donation_date || null,
          hospital_or_camp ? hospital_or_camp.trim() : null,
          units ? Number(units) : null,
          photo_url || null,
          honor_badge || null,
          donation_count_milestone ? Number(donation_count_milestone) : null,
          notes !== undefined ? notes : null,
          verified_by || null,
          is_public !== undefined ? is_public : null,
          id,
        ]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Blood donation record not found" });
      }

      res.json({
        success: true,
        message: "Blood donation record updated successfully!",
        data: updateRes.rows[0],
      });
    } catch (err) {
      console.error("Update Blood Donation Error:", err);
      res.status(500).json({ success: false, error: "Failed to update blood donation: " + err.message });
    }
  }
);

/* =====================================================
   🗑️ 7. DELETE BLOOD DONATION RECORD (ADMIN)
   DELETE /blood-donations/admin/:id
===================================================== */
router.delete(
  "/admin/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `DELETE FROM blood_donations WHERE id = $1 RETURNING *`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Blood donation record not found" });
      }

      res.json({
        success: true,
        message: "Blood donation record deleted successfully!",
      });
    } catch (err) {
      console.error("Delete Blood Donation Error:", err);
      res.status(500).json({ success: false, error: "Failed to delete blood donation: " + err.message });
    }
  }
);

/* =====================================================
   🚨 8. SUBMIT EMERGENCY BLOOD SOS REQUEST (PUBLIC)
   POST /blood-donations/sos
   - Saves to DB
   - Automated Email Broadcast to All Members & Volunteers
   - Returns WhatsApp payload
===================================================== */
const sendMail = require("../utils/sendMail");

function generateEmergencyBloodEmailHtml({ patient_name, blood_group, units, hospital, contact_phone, urgency, notes }) {
  return `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #ffffff; border: 3px solid #dc2626; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 30px rgba(220,38,38,0.2);">
      <div style="background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%); color: #ffffff; padding: 24px 20px; text-align: center;">
        <div style="font-size: 0.85rem; font-weight: 800; color: #fef08a; letter-spacing: 1px; text-transform: uppercase;">
          ॥ రక్తదానమే ప్రాణదానం • EMERGENCY LIFE SAVING ALERT ॥
        </div>
        <h1 style="margin: 8px 0 4px 0; font-size: 1.6rem; font-weight: 900; color: #ffffff;">
          🚨 URGENT BLOOD REQUIRED IN JAGTIAL
        </h1>
        <div style="font-size: 0.82rem; color: #fee2e2;">
          HINDU SWARAJ YOUTH WELFARE ASSOCIATION • 24/7 EMERGENCY BLOOD NETWORK
        </div>
      </div>

      <div style="padding: 28px 24px; color: #1e293b;">
        <div style="background: #fef2f2; border: 2px dashed #f87171; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px;">
          <div style="font-size: 0.85rem; font-weight: 800; color: #991b1b; text-transform: uppercase;">REQUIRED BLOOD GROUP</div>
          <div style="font-size: 2.8rem; font-weight: 900; color: #b91c1c; line-height: 1.1; margin: 6px 0;">
            🩸 ${blood_group}
          </div>
          <div style="font-size: 1rem; font-weight: 800; color: #7f1d1d;">
            ${units} Unit (${units * 350} ml) Needed Urgently
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 0.95rem;">
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 700; width: 40%;">👤 Patient Name:</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 800; font-size: 1.05rem;">${patient_name}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 700;">🏥 Hospital / Location:</td>
            <td style="padding: 10px 0; color: #0f172a; font-weight: 800;">${hospital}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 10px 0; color: #64748b; font-weight: 700;">📞 Attender Phone:</td>
            <td style="padding: 10px 0; color: #b91c1c; font-weight: 900; font-size: 1.1rem;">
              <a href="tel:${contact_phone}" style="color: #b91c1c; text-decoration: none;">${contact_phone} 📱</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 0; color: #64748b; font-weight: 700;">⚡ Urgency Level:</td>
            <td style="padding: 10px 0; color: #dc2626; font-weight: 800;">🔴 ${urgency || "CRITICAL / IMMEDIATE"}</td>
          </tr>
        </table>

        ${notes ? `<div style="background: #f8fafc; border-left: 4px solid #dc2626; padding: 10px 14px; font-size: 0.88rem; color: #475569; margin-bottom: 24px; font-style: italic;">"${notes}"</div>` : ""}

        <div style="text-align: center; margin: 30px 0 10px 0;">
          <a href="tel:${contact_phone}" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 14px 28px; border-radius: 10px; font-weight: 800; font-size: 1rem; text-decoration: none; box-shadow: 0 4px 15px rgba(220,38,38,0.3); margin: 6px;">
            📞 Call Attender Immediately
          </a>
          <a href="https://wa.me/918499878425?text=${encodeURIComponent(`🚨 I can donate or coordinate ${blood_group} blood for patient ${patient_name} at ${hospital}!`)}" style="display: inline-block; background: #22c55e; color: #ffffff; padding: 14px 28px; border-radius: 10px; font-weight: 800; font-size: 1rem; text-decoration: none; box-shadow: 0 4px 15px rgba(34,197,94,0.3); margin: 6px;">
            💬 I Can Donate / WhatsApp
          </a>
        </div>

        <p style="font-size: 0.85rem; color: #64748b; text-align: center; margin-top: 20px; line-height: 1.5;">
          Dear Member / Volunteer, this automated life-saving alert was generated by the <b>Hindu Swaraj Youth Welfare Association</b> emergency system. If you are in Jagtial and eligible to donate, please act immediately.
        </p>
      </div>

      <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 14px 20px; text-align: center; font-size: 0.78rem; color: #94a3b8;">
        Hindu Swaraj Youth Welfare Association • Regd. No: 784/2025 • Jagtial, Telangana • Helpline: +91 8499878425
      </div>
    </div>
  `;
}

router.post("/sos", async (req, res) => {
  try {
    const {
      patient_name,
      blood_group,
      units = 1,
      hospital,
      contact_phone,
      urgency = "CRITICAL_IMMEDIATE",
      notes = "",
    } = req.body;

    if (!patient_name || !blood_group || !hospital || !contact_phone) {
      return res.status(400).json({
        success: false,
        error: "Patient name, blood group, hospital, and contact phone are required.",
      });
    }

    // 1. Insert into blood_requests table
    const insertRes = await pool.query(
      `
      INSERT INTO blood_requests (
        patient_name, blood_group, units, hospital, contact_phone, urgency, notes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
      RETURNING *
      `,
      [
        patient_name.trim(),
        blood_group.trim().toUpperCase(),
        Number(units) || 1,
        hospital.trim(),
        contact_phone.trim(),
        urgency,
        notes ? notes.trim() : "",
      ]
    );

    const sosRecord = insertRes.rows[0];

    // 2. Query all recipients for Automated Email Broadcast
    // Query users (personal_email / username) and volunteers (email)
    const [usersResult, volResult] = await Promise.all([
      pool.query(
        "SELECT id, name, role, personal_email, username, phone, blood_group FROM users WHERE (personal_email IS NOT NULL AND personal_email != '') OR (username LIKE '%@%')"
      ),
      pool.query(
        "SELECT id, name, email, phone, blood_group, city FROM volunteers"
      ),
    ]);

    const recipientMap = new Map();

    // Add registered members & officers
    usersResult.rows.forEach((u) => {
      const email = (u.personal_email || u.username || "").trim().toLowerCase();
      if (email && email.includes("@")) {
        recipientMap.set(email, {
          id: u.id,
          name: u.name || "Association Member",
          role: u.role || "MEMBER",
          type: "MEMBER",
          email,
          phone: u.phone || "N/A",
          blood_group: u.blood_group || "N/A",
          status: "SENT",
          sent_at: new Date().toISOString(),
        });
      }
    });

    // Add registered volunteers
    volResult.rows.forEach((v) => {
      const email = (v.email || "").trim().toLowerCase();
      if (email && email.includes("@")) {
        if (!recipientMap.has(email)) {
          recipientMap.set(email, {
            id: v.id,
            name: v.name || "Volunteer Donor",
            role: "VOLUNTEER",
            type: "VOLUNTEER",
            email,
            phone: v.phone || "N/A",
            blood_group: v.blood_group || "N/A",
            city: v.city || "Jagtial",
            status: "SENT",
            sent_at: new Date().toISOString(),
          });
        }
      }
    });

    // Always include official association email
    if (!recipientMap.has("hinduswarajyouth@gmail.com")) {
      recipientMap.set("hinduswarajyouth@gmail.com", {
        name: "Hindu Swaraj Central Helpline",
        role: "SUPER_ADMIN",
        type: "CENTRAL_DESK",
        email: "hinduswarajyouth@gmail.com",
        phone: "+91 8499878425",
        blood_group: "ALL",
        status: "SENT",
        sent_at: new Date().toISOString(),
      });
    }

    const dispatchedList = Array.from(recipientMap.values());
    console.log(`🚨 DISPATCHING EMERGENCY BLOOD ALERT TO ${dispatchedList.length} RECIPIENTS (MEMBERS & VOLUNTEERS)...`);

    const emailHtml = generateEmergencyBloodEmailHtml({
      patient_name: sosRecord.patient_name,
      blood_group: sosRecord.blood_group,
      units: sosRecord.units,
      hospital: sosRecord.hospital,
      contact_phone: sosRecord.contact_phone,
      urgency: sosRecord.urgency,
      notes: sosRecord.notes,
    });

    const subject = `🚨 URGENT BLOOD NEEDED IN JAGTIAL: ${sosRecord.blood_group} (${sosRecord.units} Unit) for ${sosRecord.patient_name}`;

    // Dispatch emails asynchronously in parallel batches
    let dispatchedCount = 0;
    const sendPromises = dispatchedList.map(async (rec) => {
      try {
        const ok = await sendMail(rec.email, subject, emailHtml);
        if (ok) dispatchedCount++;
      } catch (e) {
        console.error(`Email send failed for ${rec.email}:`, e.message);
      }
    });

    // Wait or background resolve and save full audit JSON to DB
    Promise.allSettled(sendPromises).then(async () => {
      console.log(`✅ DISPATCHED EMERGENCY BLOOD EMAILS TO ${dispatchedCount} MEMBERS.`);
      await pool.query(
        "UPDATE blood_requests SET emails_dispatched = $1, dispatched_recipients = $2 WHERE id = $3",
        [dispatchedCount, JSON.stringify(dispatchedList), sosRecord.id]
      ).catch(() => {});
    });

    // WhatsApp preformatted text
    const whatsappMsg = `🚨 *URGENT BLOOD REQUIRED IN JAGTIAL*%0A• *Patient*: ${encodeURIComponent(sosRecord.patient_name)}%0A• *Blood Group*: ${encodeURIComponent(sosRecord.blood_group)}%0A• *Units Needed*: ${sosRecord.units} Unit%0A• *Hospital*: ${encodeURIComponent(sosRecord.hospital)}%0A• *Attender Contact*: ${encodeURIComponent(sosRecord.contact_phone)}%0A• *Urgency*: ${encodeURIComponent(sosRecord.urgency)}%0A%0A🛑 *Please respond immediately if you can donate or know someone in Jagtial!*`;

    res.json({
      success: true,
      message: "🚨 Emergency Blood SOS registered! Automated email broadcast dispatched to all members and volunteers.",
      data: {
        ...sosRecord,
        dispatched_recipients: dispatchedList,
      },
      total_recipients: dispatchedList.length,
      dispatched_recipients: dispatchedList,
      whatsapp_url: `https://wa.me/918499878425?text=${whatsappMsg}`,
    });
  } catch (err) {
    console.error("Emergency Blood SOS Error:", err);
    res.status(500).json({ success: false, error: "Failed to submit SOS request: " + err.message });
  }
});

/* =====================================================
   🚨 9. GET LIVE ACTIVE SOS REQUESTS (PUBLIC FOR HOMEPAGE TICKER)
   GET /blood-donations/active-sos
===================================================== */
router.get("/active-sos", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT * FROM blood_requests
      WHERE status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 10
      `
    );
    res.json({
      success: true,
      active_requests: result.rows,
      count: result.rows.length,
    });
  } catch (err) {
    console.error("Fetch Active SOS Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   🩸 10. LIVE BLOOD MATCH & COMPATIBILITY DONOR FINDER
   GET /blood-donations/match-donors?blood_group=...
===================================================== */
const COMPATIBILITY_MAP = {
  "O-": ["O-"],
  "O+": ["O+", "O-"],
  "A-": ["A-", "O-"],
  "A+": ["A+", "A-", "O+", "O-"],
  "B-": ["B-", "O-"],
  "B+": ["B+", "B-", "O+", "O-"],
  "AB-": ["AB-", "A-", "B-", "O-"],
  "AB+": ["AB+", "AB-", "A+", "A-", "B+", "B-", "O+", "O-"],
};

router.get("/match-donors", async (req, res) => {
  try {
    let rawGroup = (req.query.blood_group || "O+").trim();
    if (rawGroup.includes(" ")) rawGroup = rawGroup.replace(/\s+/g, "+");
    if (!rawGroup.endsWith("+") && !rawGroup.endsWith("-")) rawGroup = rawGroup + "+";
    const targetGroup = rawGroup.toUpperCase();
    const compatibleGroups = COMPATIBILITY_MAP[targetGroup] || [targetGroup, "O+", "O-"];

    // Query matched volunteers & members
    const [volRes, userRes] = await Promise.all([
      pool.query(
        `SELECT id, name, blood_group, city, phone, created_at
         FROM volunteers
         WHERE blood_group = ANY($1)
         ORDER BY created_at DESC
         LIMIT 20`,
        [compatibleGroups]
      ),
      pool.query(
        `SELECT id, name, role, blood_group, phone, COALESCE(photo_url, '/images/leader-president.png') as photo_url
         FROM users
         WHERE active = true AND blood_group = ANY($1)
         ORDER BY id ASC
         LIMIT 10`,
        [compatibleGroups]
      ),
    ]);

    const donors = [];

    // Add members
    userRes.rows.forEach((u) => {
      donors.push({
        id: `user-${u.id}`,
        name: u.name,
        type: "MEMBER",
        badge: u.role === "PRESIDENT" ? "👑 President" : "🛡️ Core Member",
        blood_group: u.blood_group,
        city: "Jagtial Head Office",
        phone: u.phone || "9440000000",
        photo_url: u.photo_url,
        is_exact_match: u.blood_group === targetGroup,
        availability: "24/7 Priority Emergency",
      });
    });

    // Add volunteers
    volRes.rows.forEach((v) => {
      donors.push({
        id: `vol-${v.id}`,
        name: v.name,
        type: "VOLUNTEER",
        badge: "🦸 Registered Volunteer",
        blood_group: v.blood_group,
        city: v.city || "Jagtial District",
        phone: v.phone || "9848000000",
        photo_url: "/images/logo_v2.png",
        is_exact_match: v.blood_group === targetGroup,
        availability: "Active On-Call",
      });
    });

    res.json({
      success: true,
      target_blood_group: targetGroup,
      compatible_groups: compatibleGroups,
      total_matches: donors.length,
      donors,
    });
  } catch (err) {
    console.error("Match Donors Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   🚨 10. GET ALL BLOOD SOS REQUESTS (ADMIN)
   GET /blood-donations/sos/admin
===================================================== */
router.get(
  "/sos/admin",
  verifyToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT * FROM blood_requests ORDER BY created_at DESC`
      );

      const activeCount = result.rows.filter((r) => r.status === "ACTIVE").length;
      const fulfilledCount = result.rows.filter((r) => r.status === "FULFILLED").length;

      res.json({
        success: true,
        data: result.rows,
        summary: {
          total: result.rows.length,
          active: activeCount,
          fulfilled: fulfilledCount,
        },
      });
    } catch (err) {
      console.error("Admin SOS List Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   🚨 11. UPDATE SOS REQUEST STATUS (ADMIN)
   PUT /blood-donations/sos/admin/:id/status
===================================================== */
router.put(
  "/sos/admin/:id/status",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, fulfilled_donor_name } = req.body;

      const updateRes = await pool.query(
        `
        UPDATE blood_requests SET
          status = COALESCE($1, status),
          fulfilled_donor_name = COALESCE($2, fulfilled_donor_name),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
        `,
        [status, fulfilled_donor_name || null, id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "SOS record not found" });
      }

      res.json({
        success: true,
        message: `SOS status updated to ${status}!`,
        data: updateRes.rows[0],
      });
    } catch (err) {
      console.error("Update SOS Status Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   🚨 12. RE-BROADCAST SOS ALERT (ADMIN)
   POST /blood-donations/sos/admin/:id/rebroadcast
===================================================== */
router.post(
  "/sos/admin/:id/rebroadcast",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const sosRes = await pool.query("SELECT * FROM blood_requests WHERE id = $1", [id]);
      if (sosRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "SOS record not found" });
      }
      const sosRecord = sosRes.rows[0];

      const [usersResult, volResult] = await Promise.all([
        pool.query(
          "SELECT id, name, role, personal_email, username, phone, blood_group FROM users WHERE (personal_email IS NOT NULL AND personal_email != '') OR (username LIKE '%@%')"
        ),
        pool.query("SELECT id, name, email, phone, blood_group, city FROM volunteers"),
      ]);

      const recipientMap = new Map();
      usersResult.rows.forEach((u) => {
        const email = (u.personal_email || u.username || "").trim().toLowerCase();
        if (email && email.includes("@")) {
          recipientMap.set(email, {
            id: u.id,
            name: u.name || "Association Member",
            role: u.role || "MEMBER",
            type: "MEMBER",
            email,
            phone: u.phone || "N/A",
            blood_group: u.blood_group || "N/A",
            status: "SENT",
            sent_at: new Date().toISOString(),
          });
        }
      });

      volResult.rows.forEach((v) => {
        const email = (v.email || "").trim().toLowerCase();
        if (email && email.includes("@")) {
          if (!recipientMap.has(email)) {
            recipientMap.set(email, {
              id: v.id,
              name: v.name || "Volunteer Donor",
              role: "VOLUNTEER",
              type: "VOLUNTEER",
              email,
              phone: v.phone || "N/A",
              blood_group: v.blood_group || "N/A",
              city: v.city || "Jagtial",
              status: "SENT",
              sent_at: new Date().toISOString(),
            });
          }
        }
      });

      if (!recipientMap.has("hinduswarajyouth@gmail.com")) {
        recipientMap.set("hinduswarajyouth@gmail.com", {
          name: "Hindu Swaraj Central Helpline",
          role: "SUPER_ADMIN",
          type: "CENTRAL_DESK",
          email: "hinduswarajyouth@gmail.com",
          phone: "+91 8499878425",
          blood_group: "ALL",
          status: "SENT",
          sent_at: new Date().toISOString(),
        });
      }

      const dispatchedList = Array.from(recipientMap.values());
      const emailHtml = generateEmergencyBloodEmailHtml(sosRecord);
      const subject = `🚨 [RE-ALERT] URGENT BLOOD NEEDED IN JAGTIAL: ${sosRecord.blood_group} for ${sosRecord.patient_name}`;

      let dispatchedCount = 0;
      await Promise.allSettled(
        dispatchedList.map(async (rec) => {
          const ok = await sendMail(rec.email, subject, emailHtml);
          if (ok) dispatchedCount++;
        })
      );

      await pool.query(
        "UPDATE blood_requests SET emails_dispatched = $1, dispatched_recipients = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3",
        [dispatchedCount, JSON.stringify(dispatchedList), id]
      );

      res.json({
        success: true,
        message: `🚨 Emergency Alert re-broadcasted to ${dispatchedCount} members and volunteers!`,
        dispatched_recipients: dispatchedList,
      });
    } catch (err) {
      console.error("Rebroadcast Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
