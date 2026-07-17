require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");

const pool = require("./db");

const app = express();
const volunteerRoutes = require("./routes/volunteer");

/* =========================
   ✅ TRUST PROXY (RENDER)
========================= */
app.set("trust proxy", 1);

/* =========================
   🔐 SECURITY HEADERS
========================= */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

/* =========================
   🌐 CORS (FINAL – NO ERRORS)
========================= */
const allowedOrigins = [
  "https://hinduswarajyouth.online",
  "https://www.hinduswarajyouth.online",
  "https://api.hinduswarajyouth.online",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-side tools (Postman, curl)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // ❗ IMPORTANT: do NOT throw error
       return callback(null, true);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
  "Content-Type",
  "Authorization",
  "Cache-Control",
  "Pragma"
],
    credentials: true,
  })
);

// 🔥 Preflight support (VERY IMPORTANT)
app.options("*", cors());

/* =========================
   📦 BODY PARSERS
========================= */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================
   ⏱ RATE LIMITING
========================= */
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

/* =========================
   🗂 STATIC FILES
========================= */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* =========================
   🔌 DB HEALTH CHECK
========================= */
pool
  .query("SELECT 1")
  .then(() => console.log("✅ DB Connected"))
  .catch((err) => console.error("❌ DB Error:", err.message));

/* =========================
   🚏 ROUTES
========================= */

// AUTH
app.use("/auth", require("./routes/auth"));

// CORE MODULES
app.use("/members", require("./routes/members"));
app.use("/funds", require("./routes/funds"));
app.use("/treasurer", require("./routes/treasurer"));
app.use("/reports", require("./routes/reports"));
app.use("/receipts", require("./routes/receipts"));
app.use("/notifications", require("./routes/notifications"));

// ASSOCIATION
app.use("/association", require("./routes/association"));
app.use("/public", require("./routes/public"));
app.use("/volunteer", volunteerRoutes);

// ASSOCIATION SETTINGS (CMS)
app.use("/association-settings", require("./routes/associationSettings"));

// EXPENSES
app.use("/expenses", require("./routes/expenses"));

// ADMIN & DASHBOARD
app.use("/admin", require("./routes/admin"));
app.use("/dashboard", require("./routes/dashboard"));

// FEATURES
app.use("/suggestions", require("./routes/suggestions"));
app.use("/complaints", require("./routes/complaints"));
app.use("/meetings", require("./routes/meetings"));
app.use("/announcements", require("./routes/announcements"));
app.use("/contributions", require("./routes/contributions"));

/* =========================
   🏠 ROOT & HEALTH
========================= */
app.get("/", (req, res) => {
  res.send("🚀 Association Backend Running");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

/* =========================
   ❗ GLOBAL ERROR HANDLER
========================= */
app.use((err, req, res, next) => {
  console.error("GLOBAL ERROR 👉", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
  });
});

/* =========================
   🚀 START SERVER
========================= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

module.exports = app;
