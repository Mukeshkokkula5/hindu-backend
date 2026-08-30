const dotenv = require("dotenv");
dotenv.config();
const { Pool } = require("pg");

console.log("🔌 Initializing DB connection pool...");

const isRemoteDb =
  process.env.DATABASE_URL &&
  (process.env.DATABASE_URL.includes("supabase.com") ||
    process.env.DATABASE_URL.includes("neon.tech") ||
    process.env.DATABASE_URL.includes("render.com") ||
    process.env.DATABASE_URL.includes("sslmode=require") ||
    process.env.NODE_ENV === "production");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
});

pool.on("connect", () => {
  console.log("DB Connected");
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle client", err);
});

module.exports = pool;

