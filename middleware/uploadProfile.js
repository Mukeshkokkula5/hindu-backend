const multer = require("multer");
const path = require("path");
const fs = require("fs");

/* =========================
   ENSURE UPLOAD DIRECTORY
========================= */
const uploadDir = "uploads/profile-dp";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/* =========================
   STORAGE CONFIG
========================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(
      null,
      `dp_${req.user.id}_${Date.now()}${ext}`
    );
  },
});

/* =========================
   FILE FILTER & LIMITS
========================= */
const uploadProfile = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024, // ✅ 2 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/jpg"];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG / PNG images are allowed"));
    }
  },
});

module.exports = uploadProfile;
