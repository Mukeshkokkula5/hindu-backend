const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const multer = require("multer");
const path = require("path");

/* =========================
   MULTER CONFIG
========================= */
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (_, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

/* =========================
   GET ASSOCIATION (ADMIN)
   GET /association
========================= */
router.get(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    const result = await pool.query(
      "SELECT * FROM association_info ORDER BY id DESC LIMIT 1"
    );

    res.json({
      success: true,
      data: result.rows[0] || {},
    });
  }
);

/* =========================
   SAVE / UPDATE ASSOCIATION
   POST /association
========================= */
router.post(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  upload.single("logo"),
  async (req, res) => {
    const {
      name,
      registration_no,
      established_year,
      phone,
      email,
      address,
      bank_name,
      account_no,
      ifsc,
    } = req.body;

    const logo = req.file ? `/uploads/${req.file.filename}` : null;

    const existing = await pool.query(
      "SELECT id FROM association_info ORDER BY id DESC LIMIT 1"
    );

    if (existing.rows.length > 0) {
      // UPDATE
      await pool.query(
        `
        UPDATE association_info SET
          name=$1,
          registration_no=$2,
          established_year=$3,
          phone=$4,
          email=$5,
          address=$6,
          bank_name=$7,
          account_no=$8,
          ifsc=$9,
          logo=COALESCE($10, logo),
          updated_at=NOW()
        WHERE id=$11
        `,
        [
          name,
          registration_no,
          established_year,
          phone,
          email,
          address,
          bank_name,
          account_no,
          ifsc,
          logo,
          existing.rows[0].id,
        ]
      );
    } else {
      // INSERT
      await pool.query(
        `
        INSERT INTO association_info
        (name, registration_no, established_year, phone, email, address,
         bank_name, account_no, ifsc, logo, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
        `,
        [
          name,
          registration_no,
          established_year,
          phone,
          email,
          address,
          bank_name,
          account_no,
          ifsc,
          logo,
        ]
      );
    }

    res.json({ success: true, message: "Association info saved" });
  }
);

module.exports = router;
