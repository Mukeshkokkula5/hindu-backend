const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* ================= ENSURE UPLOAD DIR ================= */
const isProd = process.env.VERCEL || process.env.NODE_ENV === "production";
const uploadDir = isProd ? "/tmp" : path.join("uploads", "logo");
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
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const allowed = /png|jpg|jpeg|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (!ext) {
      return cb(new Error("Only images allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

/* ================= PUBLIC ================= */
router.get("/public", async (_, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM association_settings ORDER BY id DESC LIMIT 1"
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error("PUBLIC SETTINGS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load settings" });
  }
});

/* ================= ADMIN GET ================= */
router.get(
  "/admin",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (_, res) => {
    try {
      const r = await pool.query(
        "SELECT * FROM association_settings ORDER BY id DESC LIMIT 1"
      );
      res.json(r.rows[0] || {});
    } catch (err) {
      res.status(500).json({ error: "Failed to load admin settings" });
    }
  }
);

router.put(
  "/admin",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const s = req.body;

      const existing = await pool.query(
        "SELECT id FROM association_settings ORDER BY id DESC LIMIT 1"
      );

      let result;
      if (existing.rows.length > 0) {
        result = await pool.query(
          `
          UPDATE association_settings SET
            association_name = COALESCE($1, association_name),
            hero_title = COALESCE($2, hero_title),
            hero_subtitle = COALESCE($3, hero_subtitle),
            facebook_url = COALESCE($4, facebook_url),
            instagram_url = COALESCE($5, instagram_url),
            youtube_url = COALESCE($6, youtube_url),
            whatsapp_url = COALESCE($7, whatsapp_url),
            bank_name = COALESCE($8, bank_name),
            account_name = COALESCE($9, account_name),
            account_no = COALESCE($10, account_no),
            ifsc_code = COALESCE($11, ifsc_code),
            branch_name = COALESCE($12, branch_name),
            account_type = COALESCE($13, account_type),
            upi_id = COALESCE($14, upi_id),
            regd_no = COALESCE($15, regd_no)
          WHERE id = $16
          RETURNING *
          `,
          [
            s.association_name || null,
            s.hero_title || null,
            s.hero_subtitle || null,
            s.facebook_url || null,
            s.instagram_url || null,
            s.youtube_url || null,
            s.whatsapp_url || null,
            s.bank_name || null,
            s.account_name || null,
            s.account_no || null,
            s.ifsc_code || null,
            s.branch_name || null,
            s.account_type || null,
            s.upi_id || null,
            s.regd_no || null,
            existing.rows[0].id,
          ]
        );
      } else {
        result = await pool.query(
          `
          INSERT INTO association_settings (
            association_name,
            hero_title, hero_subtitle,
            facebook_url, instagram_url, youtube_url, whatsapp_url,
            bank_name, account_name, account_no, ifsc_code, branch_name, account_type, upi_id, regd_no
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING *
          `,
          [
            s.association_name || "Hindu Swaraj Youth Welfare Association",
            s.hero_title || "",
            s.hero_subtitle || "",
            s.facebook_url || "https://facebook.com",
            s.instagram_url || "https://instagram.com",
            s.youtube_url || "https://youtube.com",
            s.whatsapp_url || "https://wa.me/918499878425",
            s.bank_name || "Union Bank of India",
            s.account_name || "HINDU SWARAJ YOUTH WELFARE ASSOCIATION",
            s.account_no || "084910100054321",
            s.ifsc_code || "UBIN0808491",
            s.branch_name || "Jagtial Main Branch",
            s.account_type || "Current Account",
            s.upi_id || "8499878425@ybl",
            s.regd_no || "Regd. No: 784/2025 (Govt. of Telangana)",
          ]
        );
      }

      res.json({ success: true, message: "Association settings & Bank details saved successfully!", data: result.rows[0] });
    } catch (err) {
      console.error("UPDATE SETTINGS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to save settings: " + err.message });
    }
  }
);

/* ================= DIGITAL SIGNATURES UPLOAD ================= */
const signatureUploadDir = isProd ? "/tmp" : path.join(__dirname, "..", "uploads", "signatures");
if (!isProd) {
  try {
    if (!fs.existsSync(signatureUploadDir)) {
      fs.mkdirSync(signatureUploadDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Signatures upload dir init notice:", e.message);
  }
}


const signatureStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, signatureUploadDir);
  },
  filename: (req, file, cb) => {
    const rolePrefix = (req.body.role || "sign").toLowerCase().replace(/[^a-z0-9]/g, "_");
    cb(null, `${rolePrefix}_${Date.now()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const uploadSignature = multer({
  storage: signatureStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_, file, cb) => {
    const allowed = /png|jpg|jpeg|webp|svg/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    if (!ext) return cb(new Error("Only image files (.png, .jpg, .jpeg, .webp, .svg) are allowed"));
    cb(null, true);
  },
});

router.post(
  "/signatures/upload",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "VICE_PRESIDENT", "GENERAL_SECRETARY", "TREASURER"),
  uploadSignature.single("signature"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No signature image file provided" });
      }
      let fileUrl = `/uploads/signatures/${req.file.filename}`;
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        if (req.file.path && fs.existsSync(req.file.path)) {
          const b64 = fs.readFileSync(req.file.path).toString("base64");
          const mime = req.file.mimetype || "image/png";
          fileUrl = `data:${mime};base64,${b64}`;
        }
      }
      res.json({
        success: true,
        fileUrl,
        url: fileUrl,
        photo_url: fileUrl,
        imageUrl: fileUrl,
        filename: req.file.filename,
      });
    } catch (err) {
      console.error("SIGNATURE UPLOAD ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to upload signature" });
    }
  }
);

router.get("/signatures", async (_, res) => {
  try {
    const r = await pool.query(
      "SELECT president_name, gs_name, treasurer_name, treasurer_signature_url, gs_signature_url, president_signature_url, association_seal_url FROM association_settings ORDER BY id DESC LIMIT 1"
    );
    res.json({
      success: true,
      data: r.rows[0] || {
        president_name: "Vinodh Kumar K",
        gs_name: "Mani Deep",
        treasurer_name: "Treasurer",
        treasurer_signature_url: "",
        gs_signature_url: "",
        president_signature_url: "",
        association_seal_url: "",
      },
    });
  } catch (err) {
    console.error("GET SIGNATURES ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to load signatures" });
  }
});

router.put(
  "/signatures",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "VICE_PRESIDENT", "GENERAL_SECRETARY", "TREASURER"),
  async (req, res) => {
    try {
      const {
        president_name,
        gs_name,
        treasurer_name,
        treasurer_signature_url,
        gs_signature_url,
        president_signature_url,
        association_seal_url,
      } = req.body;

      const check = await pool.query("SELECT id FROM association_settings ORDER BY id DESC LIMIT 1");
      if (check.rows.length === 0) {
        await pool.query(
          `INSERT INTO association_settings
           (president_name, gs_name, treasurer_name, treasurer_signature_url, gs_signature_url, president_signature_url, association_seal_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            president_name || "Vinodh Kumar K",
            gs_name || "Mani Deep",
            treasurer_name || "Treasurer",
            treasurer_signature_url || "",
            gs_signature_url || "",
            president_signature_url || "",
            association_seal_url || ""
          ]
        );
      } else {
        await pool.query(
          `UPDATE association_settings
           SET president_name = COALESCE($1, president_name),
               gs_name = COALESCE($2, gs_name),
               treasurer_name = COALESCE($3, treasurer_name),
               treasurer_signature_url = COALESCE($4, treasurer_signature_url),
               gs_signature_url = COALESCE($5, gs_signature_url),
               president_signature_url = COALESCE($6, president_signature_url),
               association_seal_url = COALESCE($7, association_seal_url)
           WHERE id = $8`,
          [
            president_name !== undefined ? president_name : null,
            gs_name !== undefined ? gs_name : null,
            treasurer_name !== undefined ? treasurer_name : null,
            treasurer_signature_url !== undefined ? treasurer_signature_url : null,
            gs_signature_url !== undefined ? gs_signature_url : null,
            president_signature_url !== undefined ? president_signature_url : null,
            association_seal_url !== undefined ? association_seal_url : null,
            check.rows[0].id
          ]
        );
      }

      res.json({ success: true, message: "Digital signatures and officer names updated successfully" });
    } catch (err) {
      console.error("UPDATE SIGNATURES ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update signatures: " + err.message });
    }
  }
);

module.exports = router;
