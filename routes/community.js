const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage for Community Posts & Stories
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "community-" + uniqueSuffix + path.extname(file.originalname).toLowerCase());
  },
});

const upload = multer({
  storage,
  fileFilter: (_, file, cb) => {
    const allowed = /png|jpg|jpeg|webp|avif|gif/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype) || file.mimetype.startsWith("image/");
    if (!ext || !mime) {
      return cb(new Error("Only images (.png, .jpg, .webp, .gif) are allowed for community posts"));
    }
    cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per image
});

/* =====================================================
   📦 AUTO-INIT DATABASE TABLES FOR COMMUNITY SOCIAL FEED
===================================================== */
(async () => {
  try {
    // 1. Community Posts Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_posts (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(255) NOT NULL,
        author_username VARCHAR(255),
        author_role VARCHAR(100) DEFAULT 'MEMBER',
        author_avatar TEXT DEFAULT '/images/leader-president.png',
        caption TEXT NOT NULL,
        media_urls TEXT[] DEFAULT '{}',
        category VARCHAR(100) DEFAULT 'GENERAL', -- NAVARATRI, BLOOD_SEVA, EMERGENCY, YOUTH, GENERAL
        location VARCHAR(255) DEFAULT 'Jagtial, Telangana',
        tags TEXT[] DEFAULT '{}',
        likes_count INT DEFAULT 0,
        comments_count INT DEFAULT 0,
        is_pinned BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS author_username VARCHAR(255);
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS author_role VARCHAR(100) DEFAULT 'MEMBER';
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS author_avatar TEXT DEFAULT '/images/leader-president.png';
      ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;
    `);

    // 2. Community Likes Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_likes (
        id SERIAL PRIMARY KEY,
        post_id INT REFERENCES community_posts(id) ON DELETE CASCADE,
        user_id INT,
        ip_address VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (post_id, user_id),
        UNIQUE (post_id, ip_address)
      );
    `);

    // 3. Community Comments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_comments (
        id SERIAL PRIMARY KEY,
        post_id INT REFERENCES community_posts(id) ON DELETE CASCADE,
        user_id INT,
        author_name VARCHAR(255) NOT NULL,
        author_role VARCHAR(100) DEFAULT 'MEMBER',
        author_avatar TEXT DEFAULT '/images/leader-president.png',
        comment_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Community Stories / Highlights Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_stories (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(255) NOT NULL,
        author_avatar TEXT DEFAULT '/images/leader-president.png',
        title VARCHAR(255) NOT NULL,
        media_url TEXT NOT NULL,
        tag VARCHAR(100) DEFAULT 'MOMENTS',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Community Direct Messages Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_direct_messages (
        id SERIAL PRIMARY KEY,
        sender_id INT,
        sender_name VARCHAR(255) NOT NULL,
        sender_role VARCHAR(100) DEFAULT 'MEMBER',
        sender_avatar TEXT DEFAULT '/images/leader-president.png',
        receiver_id INT,
        receiver_name VARCHAR(255) NOT NULL,
        message_text TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 6. User last_active_at column for online status
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // 5. Seed default starter moments if empty
    const checkPosts = await pool.query("SELECT COUNT(*) FROM community_posts");
    if (parseInt(checkPosts.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO community_posts (author_name, author_username, author_role, author_avatar, caption, media_urls, category, location, tags, likes_count, comments_count, is_pinned)
        VALUES
        (
          'Mukesh Kokkula',
          'mukesh@hsy.org',
          'PRESIDENT',
          '/images/leader-president.png',
          '🚩 Welcome to HSY Community Feed! Share your Vinayaka Navaratri celebrations, Maha Annadanam seva moments, blood donation heroics, and youth initiatives right here. Jai Hind! Jai Bharat! 🇮🇳✨',
          ARRAY['/images/navaratri-ganesha.jpg', '/images/navaratri-aarti.jpg'],
          'NAVARATRI',
          'Hindu Swaraj Youth Pandal, Jagtial',
          ARRAY['VinayakaNavaratri2026', 'HinduSwaraj', 'JagtialUtsav', 'SevaMoments'],
          108,
          12,
          true
        ),
        (
          'Dr. K. Srinivas',
          'srinivas@hsy.org',
          'EC_MEMBER',
          '/images/leader-general-secretary.png',
          '🩸 Mega Blood Donation Camp organized at Jagtial Pandal premises! Over 45 youth volunteers stepped forward today to donate rare blood groups. Proud of our Hindu Swaraj warriors! 💪',
          ARRAY['/images/navaratri-aarti.jpg'],
          'BLOOD_SEVA',
          'District Hospital Road, Jagtial',
          ARRAY['BloodDonation', 'SaveLives', 'YuvaShakti', 'JagtialBloodHeroes'],
          64,
          5,
          false
        ),
        (
          'Rajesh Kumar (Volunteer)',
          'rajesh@hsy.org',
          'VOLUNTEER',
          '/images/logo_v2.png',
          '🍲 Grand Maha Annadanam Seva started for 3,000+ devotees today. The joy of serving hot prasad to pilgrims and children is truly divine! Har Har Mahadev! 🕉️',
          ARRAY['/images/navaratri-ganesha.jpg'],
          'NAVARATRI',
          'Vani Nagar Main Mandapam, Jagtial',
          ARRAY['MahaAnnadanam', 'PrasadSeva', 'BappaBlessings'],
          89,
          8,
          false
        );
      `);
      console.log("✅ Seeded initial HSY Community Feed posts");
    }

    // Seed default stories if empty
    const checkStories = await pool.query("SELECT COUNT(*) FROM community_stories");
    if (parseInt(checkStories.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO community_stories (author_name, author_avatar, title, media_url, tag)
        VALUES
        ('President Desk', '/images/leader-president.png', 'Navaratri Welcome', '/images/navaratri-ganesha.jpg', 'OFFICIAL'),
        ('Live Utsav', '/images/navaratri-aarti.jpg', 'Evening Aarti', '/images/navaratri-aarti.jpg', 'LIVE'),
        ('Blood Camp', '/images/logo_v2.png', 'Donor Heroes', '/images/navaratri-ganesha.jpg', 'HEROES'),
        ('Maha Annadanam', '/images/navaratri-ganesha.jpg', 'Food For All', '/images/navaratri-aarti.jpg', 'SEVA'),
        ('Aapadbandhava', '/images/logo_v2.png', 'Direct Relief', '/images/navaratri-ganesha.jpg', 'EMERGENCY');
      `);
      console.log("✅ Seeded initial HSY Community Stories");
    }
  } catch (err) {
    console.warn("Community tables auto-init notice:", err.message);
  }
})();

/* =====================================================
   1. GET ALL POSTS (PUBLIC FEED)
   GET /community/posts?category=...&tag=...&page=...
===================================================== */
router.get("/posts", async (req, res) => {
  try {
    const { category, tag, search, page = 1, limit = 20 } = req.query;
    const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);

    let query = `
      SELECT
        p.id,
        p.user_id,
        p.author_name,
        p.author_username,
        p.author_role,
        p.author_avatar,
        p.caption,
        p.media_urls,
        p.category,
        p.location,
        p.tags,
        p.likes_count,
        p.comments_count,
        p.is_pinned,
        p.created_at
      FROM community_posts p
      WHERE p.is_active = TRUE
    `;
    const params = [];

    if (category && category !== "ALL") {
      params.push(category.toUpperCase());
      query += ` AND p.category = $${params.length}`;
    }

    if (tag) {
      params.push(`%${tag.toLowerCase()}%`);
      query += ` AND EXISTS (SELECT 1 FROM unnest(p.tags) t WHERE LOWER(t) LIKE $${params.length})`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (LOWER(p.caption) LIKE $${params.length} OR LOWER(p.author_name) LIKE $${params.length} OR LOWER(p.location) LIKE $${params.length})`;
    }

    query += ` ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), offset);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) FROM community_posts WHERE is_active = TRUE`;
    const countResult = await pool.query(countQuery);

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: parseInt(page, 10),
    });
  } catch (err) {
    console.error("GET /community/posts ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to load community feed" });
  }
});

/* =====================================================
   2. CREATE POST (MEMBERS & VOLUNTEERS ONLY)
   POST /community/posts
===================================================== */
router.post("/posts", verifyToken, upload.array("photos", 8), async (req, res) => {
  try {
    const { caption, category = "GENERAL", location = "Jagtial, Telangana", tags } = req.body;

    if (!caption || !caption.trim()) {
      return res.status(400).json({ success: false, error: "Post caption/story is required" });
    }

    // Process uploaded photos
    let mediaUrls = [];
    if (req.files && req.files.length > 0) {
      mediaUrls = req.files.map((file) => `/uploads/${file.filename}`);
    } else if (req.body.media_urls) {
      if (Array.isArray(req.body.media_urls)) {
        mediaUrls = req.body.media_urls;
      } else {
        mediaUrls = [req.body.media_urls];
      }
    }

    // Process tags array
    let tagsArray = [];
    if (tags) {
      if (Array.isArray(tags)) {
        tagsArray = tags;
      } else {
        tagsArray = tags.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
      }
    } else {
      // Auto-extract hashtags from caption
      const matches = caption.match(/#(\w+)/g);
      if (matches) {
        tagsArray = matches.map((m) => m.replace("#", ""));
      }
    }

    // Fetch user details
    const userRes = await pool.query(
      "SELECT id, name, username, role, COALESCE(photo_url, '/images/leader-president.png') as avatar FROM users WHERE id = $1",
      [req.user.id]
    );

    const user = userRes.rows[0] || {
      id: req.user.id,
      name: req.user.name || "HSY Volunteer",
      username: "member@hsy.org",
      role: req.user.role || "MEMBER",
      avatar: "/images/leader-president.png",
    };

    const insertRes = await pool.query(
      `INSERT INTO community_posts
       (user_id, author_name, author_username, author_role, author_avatar, caption, media_urls, category, location, tags, likes_count, comments_count, is_pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, false)
       RETURNING *`,
      [
        user.id,
        user.name,
        user.username,
        user.role,
        user.avatar,
        caption.trim(),
        mediaUrls,
        category.toUpperCase(),
        location.trim(),
        tagsArray,
      ]
    );

    res.status(201).json({
      success: true,
      message: "🎉 Your Seva Moment has been posted successfully!",
      data: insertRes.rows[0],
    });
  } catch (err) {
    console.error("POST /community/posts ERROR 👉", err);
    res.status(500).json({ success: false, error: err.message || "Failed to create post" });
  }
});

/* =====================================================
   3. TOGGLE LIKE (JAI SHREE RAM / LIKE)
   POST /community/posts/:id/like
===================================================== */
router.post("/posts/:id/like", async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const userId = req.body.user_id || null;
    const ip = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";

    // Check if already liked
    const check = await pool.query(
      `SELECT id FROM community_likes WHERE post_id = $1 AND (user_id = $2 OR (user_id IS NULL AND ip_address = $3))`,
      [postId, userId, ip]
    );

    let liked = false;
    if (check.rowCount > 0) {
      // Unlike
      await pool.query(`DELETE FROM community_likes WHERE id = $1`, [check.rows[0].id]);
      await pool.query(`UPDATE community_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = $1`, [postId]);
      liked = false;
    } else {
      // Like
      await pool.query(
        `INSERT INTO community_likes (post_id, user_id, ip_address) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [postId, userId, ip]
      );
      await pool.query(`UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = $1`, [postId]);
      liked = true;
    }

    const updated = await pool.query(`SELECT likes_count FROM community_posts WHERE id = $1`, [postId]);

    res.json({
      success: true,
      liked,
      likes_count: updated.rows[0]?.likes_count || 0,
    });
  } catch (err) {
    console.error("LIKE ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to process reaction" });
  }
});

/* =====================================================
   4. GET COMMENTS FOR A POST
   GET /community/posts/:id/comments
===================================================== */
router.get("/posts/:id/comments", async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const result = await pool.query(
      `SELECT id, post_id, user_id, author_name, author_role, author_avatar, comment_text, created_at
       FROM community_comments
       WHERE post_id = $1
       ORDER BY created_at ASC`,
      [postId]
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET COMMENTS ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to load comments" });
  }
});

/* =====================================================
   5. POST A COMMENT
   POST /community/posts/:id/comments
===================================================== */
router.post("/posts/:id/comments", async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const { comment_text, author_name = "Devotee / Volunteer", user_id = null, author_role = "MEMBER" } = req.body;

    if (!comment_text || !comment_text.trim()) {
      return res.status(400).json({ success: false, error: "Comment text cannot be empty" });
    }

    const insertRes = await pool.query(
      `INSERT INTO community_comments (post_id, user_id, author_name, author_role, author_avatar, comment_text)
       VALUES ($1, $2, $3, $4, '/images/leader-president.png', $5)
       RETURNING *`,
      [postId, user_id, author_name.trim(), author_role, comment_text.trim()]
    );

    // Update post comments count
    await pool.query(`UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = $1`, [postId]);

    res.status(201).json({
      success: true,
      data: insertRes.rows[0],
    });
  } catch (err) {
    console.error("POST COMMENT ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to submit comment" });
  }
});

/* =====================================================
   6. DELETE POST (AUTHOR OR ADMIN)
   DELETE /community/posts/:id
===================================================== */
router.delete("/posts/:id", verifyToken, async (req, res) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const postRes = await pool.query(`SELECT id, user_id FROM community_posts WHERE id = $1`, [postId]);

    if (postRes.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Post not found" });
    }

    const post = postRes.rows[0];
    const isAdmin = ["SUPER_ADMIN", "PRESIDENT", "VICE_PRESIDENT", "GENERAL_SECRETARY", "SECRETARY", "EC_MEMBER"].includes(req.user.role);
    const isAuthor = post.user_id && post.user_id === req.user.id;

    if (!isAdmin && !isAuthor) {
      return res.status(403).json({ success: false, error: "You do not have permission to delete this post" });
    }

    await pool.query(`DELETE FROM community_posts WHERE id = $1`, [postId]);

    res.json({
      success: true,
      message: "🗑️ Post deleted successfully",
    });
  } catch (err) {
    console.error("DELETE POST ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to delete post" });
  }
});

/* =====================================================
   7. PIN / UNPIN POST (ADMIN ONLY)
   PUT /community/posts/:id/pin
===================================================== */
router.put("/posts/:id/pin", verifyToken, async (req, res) => {
  try {
    const isAdmin = ["SUPER_ADMIN", "PRESIDENT", "VICE_PRESIDENT", "GENERAL_SECRETARY"].includes(req.user.role);
    if (!isAdmin) {
      return res.status(403).json({ success: false, error: "Only Admins can pin posts" });
    }

    const postId = parseInt(req.params.id, 10);
    const updated = await pool.query(
      `UPDATE community_posts SET is_pinned = NOT is_pinned WHERE id = $1 RETURNING id, is_pinned`,
      [postId]
    );

    res.json({
      success: true,
      data: updated.rows[0],
      message: updated.rows[0].is_pinned ? "📌 Post pinned to top!" : "Unpinned post",
    });
  } catch (err) {
    console.error("PIN POST ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to update pin status" });
  }
});

/* =====================================================
   8. GET STORIES / HIGHLIGHTS
   GET /community/stories
===================================================== */
router.get("/stories", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, author_name, author_avatar, title, media_url, tag, created_at
       FROM community_stories
       WHERE is_active = TRUE
       ORDER BY id ASC`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET STORIES ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to load stories" });
  }
});

/* =====================================================
   9. USER HEARTBEAT (ONLINE STATUS PING)
   POST /community/heartbeat
===================================================== */
router.post("/heartbeat", verifyToken, async (req, res) => {
  try {
    if (req.user && req.user.id) {
      await pool.query(
        "UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1",
        [req.user.id]
      );
    }
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("HEARTBEAT ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to update heartbeat" });
  }
});

/* =====================================================
   10. GET GENUINELY ONLINE MEMBERS (ACTIVE WITHIN 15 MINS)
   GET /community/online-members
===================================================== */
router.get("/online-members", async (req, res) => {
  try {
    // Fetch users who updated heartbeat / were active within the last 15 minutes
    const dbUsers = await pool.query(
      `SELECT id, name, username, role, COALESCE(photo_url, '/images/leader-president.png') as avatar, COALESCE(blood_group, 'B+') as blood_group, phone, last_active_at
       FROM users
       WHERE active = true 
         AND (last_active_at >= NOW() - INTERVAL '15 minutes' OR role = 'PRESIDENT')
       ORDER BY last_active_at DESC
       LIMIT 10`
    );

    const members = dbUsers.rows.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      role: u.role,
      avatar: u.avatar || "/images/leader-president.png",
      blood_group: u.blood_group,
      phone: u.phone || "",
      is_online: true,
      status_text: u.role === "PRESIDENT" ? "President Desk • Online" : "Active on Community Feed",
    }));

    res.json({
      success: true,
      count: members.length,
      data: members,
    });
  } catch (err) {
    console.error("GET ONLINE MEMBERS ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to load online members" });
  }
});

/* =====================================================
   11. GET DIRECT MESSAGES WITH A USER
   GET /community/messages/:targetUserId
===================================================== */
router.get("/messages/:targetUserId", verifyToken, async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.targetUserId, 10);
    const myUserId = req.user.id;

    const result = await pool.query(
      `SELECT id, sender_id, sender_name, sender_role, sender_avatar, receiver_id, receiver_name, message_text, is_read, created_at
       FROM community_direct_messages
       WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
       ORDER BY created_at ASC
       LIMIT 100`,
      [myUserId, targetUserId]
    );

    // If empty, return a welcoming seed message from target user
    let messages = result.rows;
    if (messages.length === 0) {
      messages = [
        {
          id: `seed-${targetUserId}`,
          sender_id: targetUserId,
          sender_name: "HSY Seva Officer",
          sender_role: "MEMBER",
          sender_avatar: "/images/leader-president.png",
          receiver_id: myUserId,
          receiver_name: req.user.name,
          message_text: "🚩 Jai Shree Ram! Welcome to direct seva connect. How can we serve you or collaborate on Jagtial youth initiatives today? 🙏",
          created_at: new Date().toISOString(),
        },
      ];
    }

    res.json({
      success: true,
      data: messages,
    });
  } catch (err) {
    console.error("GET MESSAGES ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to load conversation" });
  }
});

/* =====================================================
   12. SEND DIRECT MESSAGE
   POST /community/messages
===================================================== */
router.post("/messages", verifyToken, async (req, res) => {
  try {
    const { receiver_id, receiver_name, message_text } = req.body;

    if (!message_text || !message_text.trim()) {
      return res.status(400).json({ success: false, error: "Message text cannot be empty" });
    }

    const sender_id = req.user.id;
    const sender_name = req.user.name || "HSY Member";
    const sender_role = req.user.role || "MEMBER";

    const insertRes = await pool.query(
      `INSERT INTO community_direct_messages
       (sender_id, sender_name, sender_role, sender_avatar, receiver_id, receiver_name, message_text, is_read)
       VALUES ($1, $2, $3, '/images/leader-president.png', $4, $5, $6, false)
       RETURNING *`,
      [sender_id, sender_name, sender_role, receiver_id, receiver_name || "Member", message_text.trim()]
    );

    res.status(201).json({
      success: true,
      data: insertRes.rows[0],
    });
  } catch (err) {
    console.error("SEND MESSAGE ERROR 👉", err);
    res.status(500).json({ success: false, error: "Failed to send message" });
  }
});

module.exports = router;
