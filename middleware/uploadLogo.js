const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = process.env.NODE_ENV === "production" ? "/tmp" : "uploads/";
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, "association-logo" + path.extname(file.originalname));
  },
});

const uploadLogo = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only images allowed"));
    }
    cb(null, true);
  },
});

module.exports = uploadLogo;
