const dotenv = require("dotenv");
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";
dotenv.config({ path: envFile });
dotenv.config(); // Fallback to standard .env if specific one doesn't exist

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
  }),
);

/* =========================
   🌐 CORS (FINAL – NO ERRORS)
========================= */
const allowedOrigins = [
  "https://hinduswarajyouth.online",
  "https://www.hinduswarajyouth.online",
  "https://api.hinduswarajyouth.online",
  "https://hindu-swaraj.vercel.app",
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
      "Pragma",
    ],
    credentials: true,
  }),
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
  }),
);

/* =========================
   🗂 STATIC FILES
========================= */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* =========================
   🔌 DB HEALTH CHECK & MIGRATIONS
========================= */
pool
  .query("SELECT 1")
  .then(async () => {
    console.log("✅ DB Connected");
    try {
      // Add public_token column with default MD5 token generation if it does not exist
      await pool.query(
        "ALTER TABLE contributions ADD COLUMN IF NOT EXISTS public_token VARCHAR(64) UNIQUE DEFAULT md5(random()::text || clock_timestamp()::text)",
      );
      // Generate tokens for any old rows that didn't have one before
      await pool.query(
        "UPDATE contributions SET public_token = md5(random()::text || clock_timestamp()::text) WHERE public_token IS NULL",
      );
      // Create qr_transactions table for scanner payments
      await pool.query(`
        CREATE TABLE IF NOT EXISTS qr_transactions (
          id SERIAL PRIMARY KEY,
          payer_name VARCHAR(255) NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          transaction_id VARCHAR(100) UNIQUE NOT NULL,
          status VARCHAR(20) DEFAULT 'PENDING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Create pg_transactions table for Razorpay payments
      await pool.query(`
        CREATE TABLE IF NOT EXISTS pg_transactions (
          id SERIAL PRIMARY KEY,
          order_id VARCHAR(100) UNIQUE NOT NULL,
          payment_id VARCHAR(100),
          payer_name VARCHAR(255) NOT NULL,
          amount DECIMAL(10,2) NOT NULL,
          status VARCHAR(20) DEFAULT 'PENDING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      // Add extra donor details columns if they don't exist
      await pool.query(`
        ALTER TABLE pg_transactions 
        ADD COLUMN IF NOT EXISTS email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(20),
        ADD COLUMN IF NOT EXISTS address TEXT;
      `);
      console.log("✅ DB Migrations completed successfully");
    } catch (err) {
      console.error("❌ DB Migrations failed:", err.message);
    }
  })
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
app.use("/qr-transactions", require("./routes/qrTransactions"));
app.use("/payment", require("./routes/paymentGateway"));

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
