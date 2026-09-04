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
   🌐 CORS (BULLETPROOF & UNIVERSAL)
========================= */
const allowedOrigins = [
  "https://hinduswarajyouth.online",
  "https://www.hinduswarajyouth.online",
  "https://api.hinduswarajyouth.online",
  "https://hindu-swaraj.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:5173",
];

const isOriginAllowed = (origin) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (
    origin.endsWith(".vercel.app") ||
    origin.endsWith("hinduswarajyouth.online") ||
    origin.includes("hinduswarajyouth.online")
  ) {
    return true;
  }
  return true;
};

app.use(
  cors({
    origin: (origin, callback) => {
      return callback(null, origin || true);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Cache-Control",
      "Pragma",
      "X-Requested-With",
      "Accept",
      "Origin",
    ],
    credentials: true,
  }),
);

// Manual CORS fallback headers on every response
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Cache-Control, Pragma, X-Requested-With, Accept, Origin",
  );
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

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
    max: 2000,
    skip: (req) =>
      req.ip === "127.0.0.1" ||
      req.ip === "::1" ||
      req.ip === "::ffff:127.0.0.1" ||
      process.env.NODE_ENV === "development",
    standardHeaders: true,
    legacyHeaders: false,
  }),
);

/* =========================
   🗂 STATIC FILES
========================= */
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
if (process.env.VERCEL || process.env.NODE_ENV === "production") {
  app.use("/uploads", express.static("/tmp"));
  app.use("/uploads/blood", express.static("/tmp"));
  app.use("/uploads/signatures", express.static("/tmp"));
  app.use("/uploads/aapadbandhava", express.static("/tmp"));
}


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

      // Add blood_group, photo_url to users table if they don't exist
      await pool.query(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS blood_group VARCHAR(20) DEFAULT 'B+',
        ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '/images/leader-president.png';
      `);

      // Password Resets / OTP Table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id SERIAL PRIMARY KEY,
          user_id INT REFERENCES users(id) ON DELETE CASCADE,
          otp_hash VARCHAR(255) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          used BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Dynamic Role Permissions Matrix Table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS role_permissions (
          id SERIAL PRIMARY KEY,
          role VARCHAR(50) UNIQUE NOT NULL,
          permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Navaratri Seva Tables
      await pool.query(`
        CREATE TABLE IF NOT EXISTS navaratri_settings (
          id SERIAL PRIMARY KEY,
          is_live BOOLEAN DEFAULT false,
          youtube_url TEXT DEFAULT '',
          youtube_embed_id TEXT DEFAULT '',
          stream_title TEXT DEFAULT 'Vinayaka Navaratri Seva 2026 - Jagtial Live Darshan & Maha Aarti',
          live_announcement TEXT DEFAULT 'Daily Morning Abhishekam 7:00 AM & Evening Maha Aarti 7:30 PM live from Jagtial Pandal.',
          banner_image TEXT DEFAULT '/images/navaratri-ganesha.jpg',
          location TEXT DEFAULT 'Jagtial, Telangana',
          start_date VARCHAR(50) DEFAULT '2026-09-14',
          end_date VARCHAR(50) DEFAULT '2026-09-24',
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        ALTER TABLE navaratri_settings
        ADD COLUMN IF NOT EXISTS morning_timings VARCHAR(100) DEFAULT '07:00 AM - 09:30 AM',
        ADD COLUMN IF NOT EXISTS annadanam_timings VARCHAR(100) DEFAULT '01:00 PM - 03:00 PM',
        ADD COLUMN IF NOT EXISTS evening_timings VARCHAR(100) DEFAULT '07:30 PM - 09:00 PM',
        ADD COLUMN IF NOT EXISTS shloka TEXT DEFAULT 'वक्रतुण्ड महाकाय सूर्यकोटि समप्रभ। निर्विघ्नं कुरु मे देव सर्वकार्येषु सर्वदा॥',
        ADD COLUMN IF NOT EXISTS pandal_name VARCHAR(255) DEFAULT 'Hindu Swaraj Youth Pandal, Jagtial',
        ADD COLUMN IF NOT EXISTS whatsapp_contact VARCHAR(50) DEFAULT '+91 8499878425';
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS navaratri_schedule (
          id SERIAL PRIMARY KEY,
          day_number INT NOT NULL,
          date_str VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          alankaram VARCHAR(255) NOT NULL,
          morning_puja TEXT,
          evening_aarti TEXT,
          annadanam_info TEXT,
          special_events TEXT,
          status VARCHAR(50) DEFAULT 'UPCOMING',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS navaratri_posts (
          id SERIAL PRIMARY KEY,
          day_number INT DEFAULT 1,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          image_url TEXT NOT NULL,
          category VARCHAR(100) DEFAULT 'Puja & Darshan',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS navaratri_wishes (
          id SERIAL PRIMARY KEY,
          devotee_name VARCHAR(100) NOT NULL,
          gotram VARCHAR(100) DEFAULT 'Ganesha Gotram',
          message TEXT,
          city VARCHAR(100) DEFAULT 'Jagtial',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Seed initial settings if empty
      const settingsCount = await pool.query("SELECT COUNT(*) FROM navaratri_settings");
      if (parseInt(settingsCount.rows[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO navaratri_settings (is_live, youtube_url, youtube_embed_id, stream_title, live_announcement, banner_image, location, start_date, end_date)
          VALUES (
            false,
            'https://www.youtube.com/watch?v=live_stream_placeholder',
            '',
            'Vinayaka Navaratri Seva 2026 - Jagtial Live Darshan & Maha Aarti',
            'Daily Morning Abhishekam at 7:00 AM, Sahasranamarchana at 10:00 AM, Maha Annadanam at 1:00 PM, and Divya Maha Aarti at 7:30 PM live from Jagtial Pandal.',
            '/images/navaratri-ganesha.jpg',
            'Jagtial, Telangana',
            '2026-09-14',
            '2026-09-24'
          );
        `);
      }

      // Seed initial schedule if empty
      const scheduleCount = await pool.query("SELECT COUNT(*) FROM navaratri_schedule");
      if (parseInt(scheduleCount.rows[0].count, 10) === 0) {
        const initialSchedule = [
          [1, '14 Sep 2026 (Mon)', 'Day 1 - Vinayaka Chavithi Pratishtapana', 'Swarna Ganapathi Alankaram', '07:00 AM - Ganapathi Homam, Kalasha Sthapana & Prana Pratishta', '07:30 PM - Maha Mangala Harathi, Modaka Nivedana', '12:30 PM - Maha Annadanam for 1,500 devotees', 'Bhajan Sandhya & Vedic Chanting by youth volunteers', 'ACTIVE'],
          [2, '15 Sep 2026 (Tue)', 'Day 2 - Panchamrutha Abhishekam', 'Bala Ganapathi Alankaram', '07:30 AM - Ksheerabhishekam & Bilva Archana', '07:30 PM - Deeparadhana & Lalitha Sahasranama Parayana', '01:00 PM - Nithya Annadanam Seva', 'Devotional singing competition for local youth', 'UPCOMING'],
          [3, '16 Sep 2026 (Wed)', 'Day 3 - Gaja Vahana Seva', 'Siddhi Buddhi Sametha Ganapathi', '07:30 AM - Ashtothara Shata Kalasabhishekam', '07:30 PM - Divya Gaja Vahana Harathi & Drum Seva', '01:00 PM - Maha Prasadam Distribution', 'Spiritual Discourse on Dharma & Youth Values', 'UPCOMING'],
          [4, '17 Sep 2026 (Thu)', 'Day 4 - Valli Devasena & Ganapathi Puja', 'Mayura Vahana Alankaram', '07:30 AM - Sugandha Dravya Abhishekam', '07:30 PM - Akhanda Deeparadhana & Harikatha', '01:00 PM - Maha Annadanam', 'Harikatha Gana Seva by Jagtial artists', 'UPCOMING'],
          [5, '18 Sep 2026 (Fri)', 'Day 5 - Lalitha Devi Sametha Ganapathi', 'Sri Chakra Alankaram', '07:00 AM - Kumkumarchana & Chandi Parayana', '07:30 PM - Suvasini Puja & Maha Deepothsavam', '01:00 PM - Annadanam Seva', 'Cultural dance performance by children', 'UPCOMING'],
          [6, '19 Sep 2026 (Sat)', 'Day 6 - Sahasra Modaka Maha Yagnam', 'Maha Ganapathi Alankaram', '08:00 AM - Sahasra Modaka Homam & Purnahuti', '07:30 PM - Gaja Vahana Aarti & Bhajans', '01:00 PM - Vishesha Annadanam', 'Kolatam & folk devotional dance by youth groups', 'UPCOMING'],
          [7, '20 Sep 2026 (Sun)', 'Day 7 - Pushpa Yagam & Pushpalankaram', 'Vana Durga Sahitha Ganapathi', '07:30 AM - Ashtottara Pushpanjali & Rudra Parayana', '07:30 PM - Grand Pushpa Vrishti Aarti (1 Quintal flowers)', '01:00 PM - Maha Annadanam for 2,500 devotees', 'Mega Blood Donation Camp at Jagtial Pandal premises', 'UPCOMING'],
          [8, '21 Sep 2026 (Mon)', 'Day 8 - Simha Vahana Utsavam', 'Raja Ganapathi Royal Alankaram', '07:30 AM - Ekadasa Dravya Abhishekam', '07:30 PM - Rajadhi Raja Maha Aarti & Chhatrapati Shivaji tribute', '01:00 PM - Nithya Annaprasadam', 'Youth leadership felicitation & seva recognition', 'UPCOMING'],
          [9, '22 Sep 2026 (Tue)', 'Day 9 - Maha Purnahuti & Laddu Auction', 'Vishwa Roopa Ganapathi Alankaram', '08:30 AM - Maha Ganapathi Yagnam & Maha Purnahuti', '06:00 PM - Jagtial Maha Ganapathi Laddu Auction & Harathi', '01:00 PM - Grand Maha Annadanam (3,000+ devotees)', 'Acrobatic Dhol Tasha performance by Hindu Swaraj Team', 'UPCOMING'],
          [10, '23 Sep 2026 (Wed)', 'Day 10 - Shobha Yatra (Grand Procession)', 'Digvijaya Alankaram', '09:00 AM - Visarjan Special Archana & Send-off Aarti', '04:00 PM - Grand Shobha Yatra across Jagtial Main Roads', 'All Day - Continuous water & buttermilk seva to yatris', 'Cultural tableaux, Dhol Tasha, Lezim & Saffron rally', 'UPCOMING'],
          [11, '24 Sep 2026 (Thu)', 'Day 11 - Jaladhivasa Nimajjana Seva', 'Nirmalya Seva & Nimajjanam', '08:00 AM - Nimajjana Prarthana at Jagtial Temple Lake', '12:00 PM - Sacred Nimajjanam with full honors', '01:00 PM - Shanti Puja & Prasad Distribution', 'Conclusion of Navaratri Seva Mahotsavam 2026', 'UPCOMING']
        ];
        for (const row of initialSchedule) {
          await pool.query(
            `INSERT INTO navaratri_schedule (day_number, date_str, title, alankaram, morning_puja, evening_aarti, annadanam_info, special_events, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            row
          );
        }
      }

      // Seed initial sample posts if empty
      const postsCount = await pool.query("SELECT COUNT(*) FROM navaratri_posts");
      if (parseInt(postsCount.rows[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO navaratri_posts (day_number, title, description, image_url, category)
          VALUES 
          (1, 'Ganesh Chaturthi Grand Pratishtapana 2026', 'Grand welcoming of Lord Ganesha in Jagtial with full Vedic rituals and youth seva team.', '/images/navaratri-ganesha.jpg', 'Puja & Darshan'),
          (1, 'Evening Maha Mangala Aarti & Deeparadhana', 'Divya Harathi performed with hundreds of devotees singing devotional bhajans.', '/images/navaratri-aarti.jpg', 'Maha Aarti');
        `);
      }

      // Ensure fund 'Vinayaka Navaratri Seva' exists
      const fundCheck = await pool.query("SELECT id FROM funds WHERE fund_name ILIKE '%Vinayaka Navaratri%'");
      if (fundCheck.rows.length === 0) {
        await pool.query(`
          INSERT INTO funds (fund_name, fund_type, description, base_amount, status)
          VALUES ('Vinayaka Navaratri Seva', 'FESTIVAL', 'Dedicated fund for Ganesh Navaratri celebrations, Maha Annadanam, Daily Puja & Pandal Seva in Jagtial', 500, 'ACTIVE')
        `);
      }

      // Ensure funds with base_amount > 0 have initial balance recorded in ledger if ledger is empty for that fund
      const unseededFunds = await pool.query(`
        SELECT f.id, f.fund_name, f.base_amount
        FROM funds f
        WHERE f.base_amount > 0
          AND NOT EXISTS (SELECT 1 FROM ledger l WHERE l.fund_id = f.id)
      `);
      for (const fund of unseededFunds.rows) {
        const amt = Number(fund.base_amount);
        if (amt > 0) {
          await pool.query(`
            INSERT INTO ledger (entry_type, source, source_id, fund_id, amount, balance_after, created_by)
            VALUES ('CREDIT', 'INITIAL_BALANCE', $1, $2, $3, $4, 1)
          `, [fund.id, fund.id, amt, amt]);
          console.log(`✅ Seeded initial ledger balance for fund ${fund.fund_name} (₹${amt})`);
        }
      }

      // Association Members Table (Leadership & Team)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS association_members (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(100) NOT NULL DEFAULT 'Executive Member',
          photo_url TEXT DEFAULT '/images/leader-president.png',
          bio TEXT,
          phone VARCHAR(50),
          email VARCHAR(100),
          social_fb TEXT,
          social_insta TEXT,
          social_linkedin TEXT,
          social_twitter TEXT,
          display_order INT DEFAULT 0,
          show_on_website BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Association Posts & Photo Gallery Table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS association_posts (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          image_url TEXT NOT NULL,
          category VARCHAR(100) DEFAULT 'Community Seva',
          author_name VARCHAR(100) DEFAULT 'Hindu Swaraj Youth',
          author_role VARCHAR(100) DEFAULT 'Executive Committee',
          event_date VARCHAR(50),
          is_featured BOOLEAN DEFAULT false,
          likes_count INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // No fake members seeded; members are dynamically sourced from verified users table

      // Seed initial posts if empty
      const assocPostsCount = await pool.query("SELECT COUNT(*) FROM association_posts");
      if (parseInt(assocPostsCount.rows[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO association_posts (title, description, image_url, category, author_name, author_role, event_date, is_featured, likes_count)
          VALUES
          ('Mega Blood Donation Camp at Jagtial', 'Successfully organized our 14th Mega Blood Donation Camp collecting 120+ units of blood for local hospitals and patients in need.', '/images/activity-blood.png', 'Blood Donation', 'Rajesh Kumar', 'President', '12 Aug 2026', true, 42),
          ('Green Jagtial Tree Plantation Drive', 'Youth volunteers planted over 250 saplings across schools and community parks in Jagtial to promote environmental awareness.', '/images/activity-trees.png', 'Environment', 'Suresh Reddy', 'Vice President', '05 Aug 2026', true, 38),
          ('Free Educational Kit & Scholarship Distribution', 'Distributed notebooks, school bags, and academic supplies to 150+ underprivileged students in Jagtial district.', '/images/activity-education.png', 'Education', 'Anil Sharma', 'General Secretary', '28 Jul 2026', false, 29),
          ('Youth Leadership & Social Empowerment Workshop', 'Interactive workshop empowering 80+ youth with leadership principles, team building, and community service skills.', '/images/activity-leadership.png', 'Youth Leadership', 'Karthik Rao', 'Executive Member', '15 Jul 2026', false, 35),
          ('Chhatrapati Shivaji Maharaj Jayanti Celebrations', 'Grand cultural procession and patriotic program celebrating the legacy and values of Chhatrapati Shivaji Maharaj in Jagtial.', '/images/hero-shivaji.png', 'Cultural & Heritage', 'Hindu Swaraj Team', 'Executive Committee', '19 Feb 2026', true, 56);
        `);
      }

      // Volunteers Table
      await pool.query(`
        CREATE TABLE IF NOT EXISTS volunteers (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          phone VARCHAR(50) NOT NULL,
          city VARCHAR(100) DEFAULT 'Jagtial',
          address TEXT,
          occupation VARCHAR(100),
          blood_group VARCHAR(20),
          areas_of_interest TEXT,
          skills TEXT,
          availability VARCHAR(100) DEFAULT 'Weekends & Events',
          message TEXT,
          status VARCHAR(50) DEFAULT 'PENDING',
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Ensure all columns exist for volunteers
      await pool.query(`
        ALTER TABLE volunteers
        ADD COLUMN IF NOT EXISTS address TEXT,
        ADD COLUMN IF NOT EXISTS occupation VARCHAR(100),
        ADD COLUMN IF NOT EXISTS blood_group VARCHAR(20),
        ADD COLUMN IF NOT EXISTS areas_of_interest TEXT,
        ADD COLUMN IF NOT EXISTS skills TEXT,
        ADD COLUMN IF NOT EXISTS availability VARCHAR(100) DEFAULT 'Weekends & Events',
        ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDING',
        ADD COLUMN IF NOT EXISTS notes TEXT,
        ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      `);

      // Create blood_donations table for Blood Seva & Donor Recognition
      await pool.query(`
        CREATE TABLE IF NOT EXISTS blood_donations (
          id SERIAL PRIMARY KEY,
          donor_name VARCHAR(150) NOT NULL,
          donor_type VARCHAR(50) DEFAULT 'MEMBER',
          member_id VARCHAR(50),
          volunteer_id INTEGER,
          phone VARCHAR(30),
          email VARCHAR(150),
          blood_group VARCHAR(10) NOT NULL,
          donation_date DATE NOT NULL DEFAULT CURRENT_DATE,
          hospital_or_camp VARCHAR(200) NOT NULL,
          units INTEGER DEFAULT 1,
          photo_url TEXT DEFAULT '/images/activity-blood.png',
          certificate_id VARCHAR(100) UNIQUE,
          honor_badge VARCHAR(100) DEFAULT 'Rakta Datha',
          donation_count_milestone INTEGER DEFAULT 1,
          notes TEXT,
          verified_by VARCHAR(100) DEFAULT 'Hindu Swaraj Executive Committee',
          is_public BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Seed initial sample blood donors if table is empty
      const bloodCount = await pool.query(`SELECT COUNT(*)::int as count FROM blood_donations`);
      if ((bloodCount.rows[0]?.count || 0) === 0) {
        await pool.query(`
          INSERT INTO blood_donations (
            donor_name, donor_type, member_id, phone, email, blood_group,
            donation_date, hospital_or_camp, units, photo_url, certificate_id,
            honor_badge, donation_count_milestone, notes, verified_by, is_public
          ) VALUES
          ('Sai Krishna', 'MEMBER', 'HSY-2026-004', '+91 8499878425', 'saikrishna@hinduswarajyouth.online', 'O+', '2026-08-15', 'Area Hospital Jagtial - Emergency Ward', 1, '/images/activity-blood.png', 'HSY-BD-2026-0001', 'Life Saver Hero', 3, 'Donated blood for emergency dengue case in Jagtial', 'President - Rajesh Kumar', true),
          ('Venkatesh Goud', 'MEMBER', 'HSY-2026-008', '+91 9848012345', 'venkatesh@gmail.com', 'A+', '2026-08-10', 'Red Cross Society Blood Bank Jagtial', 1, '/images/activity-blood.png', 'HSY-BD-2026-0002', 'Rakta Datha', 2, 'Voluntary blood donation during Independence Day drive', 'General Secretary - Mani Deep', true),
          ('Ramesh Varma', 'VOLUNTEER', NULL, '+91 9959123456', 'ramesh.varma@gmail.com', 'B+', '2026-08-05', 'District Govt Hospital Blood Centre', 1, '/images/activity-blood.png', 'HSY-BD-2026-0003', 'Star Donor', 5, '5th Milestone Voluntary Blood Donation Seva', 'Executive Committee', true),
          ('Naveen Chary', 'MEMBER', 'HSY-2026-012', '+91 9440123456', 'naveen.chary@gmail.com', 'AB+', '2026-07-28', 'Prathima Hospital Blood Bank', 1, '/images/activity-blood.png', 'HSY-BD-2026-0004', 'Rakta Datha', 1, 'First time voluntary blood donation with youth wing', 'President - Rajesh Kumar', true)
        `);
        console.log("✅ Seeded initial Blood Donation Seva records");
      }

      console.log("✅ DB Migrations, Association Members/Posts, Volunteers, and Blood Seva setup completed successfully");
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

// ASSOCIATION & COMMUNITY POSTS
app.use("/association", require("./routes/association"));
app.use("/association-posts", require("./routes/associationPosts"));
app.use("/blood-donations", require("./routes/bloodDonations"));
app.use("/public", require("./routes/public"));
app.use("/volunteer", require("./routes/volunteer"));
app.use("/navaratri", require("./routes/navaratri"));

// ASSOCIATION SETTINGS (CMS)
app.use("/association-settings", require("./routes/associationSettings"));

// EXPENSES
app.use("/expenses", require("./routes/expenses"));

// ADMIN & DASHBOARD
app.use("/admin", require("./routes/admin"));
app.use("/dashboard", require("./routes/dashboard"));
app.use("/role-permissions", require("./routes/rolePermissions"));

// FEATURES
app.use("/suggestions", require("./routes/suggestions"));
app.use("/complaints", require("./routes/complaints"));
app.use("/meetings", require("./routes/meetings"));
app.use("/elections", require("./routes/elections"));
app.use("/subscriptions", require("./routes/subscriptions"));
app.use("/loans", require("./routes/memberLoans"));
app.use("/treasury", require("./routes/treasury"));
app.use("/announcements", require("./routes/announcements"));
app.use("/contributions", require("./routes/contributions"));
app.use("/qr-transactions", require("./routes/qrTransactions"));
app.use("/payment", require("./routes/paymentGateway"));
app.use("/chatbot", require("./routes/chatbot"));
app.use("/aapadbandhava", require("./routes/aapadbandhava"));
app.use("/community", require("./routes/community"));
app.use("/whatsapp", require("./routes/whatsapp"));

// WhatsApp auto-init disabled per user directive
// if (!process.env.VERCEL) {
//   const { initWhatsApp } = require("./services/whatsappBot");
//   initWhatsApp().catch((err) => console.warn("WhatsApp initial connection notice:", err.message));
// }

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
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;

