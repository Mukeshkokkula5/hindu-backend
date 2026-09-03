const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* =====================================================
   📸 MULTER DISK STORAGE CONFIGURATION
===================================================== */
const isProd = process.env.VERCEL || process.env.NODE_ENV === "production";
const uploadDir = isProd ? "/tmp" : path.join(__dirname, "..", "uploads");

if (!isProd) {
  try {
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } catch (e) {
    console.warn("Upload dir init notice:", e.message);
  }
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "assoc-" + uniqueSuffix + ext);
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
   📤 1. UPLOAD IMAGE ENDPOINT
   POST /association-posts/upload
===================================================== */
router.post(
  "/upload",
  verifyToken,
  upload.any(),
  (req, res) => {
    try {
      const uploadedFile = req.file || (req.files && req.files[0]);
      if (!uploadedFile) {
        return res.status(400).json({ success: false, error: "No image file provided" });
      }
      let fileUrl = `/uploads/${uploadedFile.filename}`;
      if (process.env.VERCEL || process.env.NODE_ENV === "production") {
        if (uploadedFile.path && fs.existsSync(uploadedFile.path)) {
          const b64 = fs.readFileSync(uploadedFile.path).toString("base64");
          const mime = uploadedFile.mimetype || "image/jpeg";
          fileUrl = `data:${mime};base64,${b64}`;
        }
      }
      res.json({
        success: true,
        message: "Image uploaded successfully!",
        fileUrl,
        url: fileUrl,
        photo_url: fileUrl,
        imageUrl: fileUrl,
      });
    } catch (err) {
      console.error("UPLOAD ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to upload image" });
    }
  }
);

/* =====================================================
   👥 2. PUBLIC: GET ACTIVE MEMBERS FOR WEBSITE
   GET /association-posts/public/members
===================================================== */
router.get("/public/members", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        name,
        CASE 
          WHEN UPPER(role) = 'PRESIDENT' THEN 'President'
          WHEN UPPER(role) = 'VICE_PRESIDENT' THEN 'Vice President'
          WHEN UPPER(role) = 'GENERAL_SECRETARY' THEN 'General Secretary'
          WHEN UPPER(role) = 'JOINT_SECRETARY' THEN 'Joint Secretary'
          WHEN UPPER(role) = 'TREASURER' THEN 'Treasurer'
          WHEN UPPER(role) = 'EC_MEMBER' THEN 'Executive Committee Member'
          ELSE 'Member'
        END AS role,
        photo_url,
        NULL AS bio,
        NULL AS phone,
        NULL AS email,
        NULL AS social_fb,
        NULL AS social_insta,
        NULL AS social_linkedin,
        NULL AS social_twitter,
        CASE 
          WHEN UPPER(role) = 'PRESIDENT' THEN 1
          WHEN UPPER(role) = 'VICE_PRESIDENT' THEN 2
          WHEN UPPER(role) = 'GENERAL_SECRETARY' THEN 3
          WHEN UPPER(role) = 'JOINT_SECRETARY' THEN 4
          WHEN UPPER(role) = 'TREASURER' THEN 5
          WHEN UPPER(role) = 'EC_MEMBER' THEN 6
          ELSE 7
        END AS display_order
      FROM users
      WHERE active = true AND role != 'SUPER_ADMIN'
      ORDER BY display_order ASC, id ASC
    `);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET PUBLIC MEMBERS ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch members" });
  }
});

/* =====================================================
   📸 3. PUBLIC: GET POSTS & PHOTO GALLERY
   GET /association-posts/public/posts
===================================================== */
router.get("/public/posts", async (req, res) => {
  try {
    const { category } = req.query;
    let query = "SELECT * FROM association_posts WHERE 1=1";
    const params = [];

    if (category && category !== "ALL") {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += " ORDER BY is_featured DESC, created_at DESC";

    const result = await pool.query(query, params);
    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("GET PUBLIC POSTS ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch posts" });
  }
});

/* =====================================================
   ❤️ 4. PUBLIC: LIKE A POST
   POST /association-posts/public/posts/:id/like
===================================================== */
router.post("/public/posts/:id/like", async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE association_posts SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = $1 RETURNING likes_count",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Post not found" });
    }

    res.json({
      success: true,
      likes_count: result.rows[0].likes_count,
    });
  } catch (err) {
    console.error("LIKE POST ERROR 👉", err.message);
    res.status(500).json({ success: false, error: "Failed to like post" });
  }
});

/* =====================================================
   👥 5. ADMIN: GET ALL MEMBERS
   GET /association-posts/admin/members
===================================================== */
router.get(
  "/admin/members",
  verifyToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM association_members ORDER BY display_order ASC, id ASC"
      );
      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("GET ADMIN MEMBERS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch members" });
    }
  }
);

/* =====================================================
   ➕ 6. ADMIN: ADD NEW MEMBER
   POST /association-posts/admin/members
===================================================== */
router.post(
  "/admin/members",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        name,
        role,
        photo_url,
        bio,
        phone,
        email,
        social_fb,
        social_insta,
        social_linkedin,
        social_twitter,
        display_order,
        show_on_website,
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: "Member name is required" });
      }

      const result = await pool.query(
        `
        INSERT INTO association_members
        (name, role, photo_url, bio, phone, email, social_fb, social_insta, social_linkedin, social_twitter, display_order, show_on_website)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING *
        `,
        [
          name.trim(),
          role ? role.trim() : "Executive Member",
          photo_url || "/images/leader-president.png",
          bio || "",
          phone || "",
          email || "",
          social_fb || "",
          social_insta || "",
          social_linkedin || "",
          social_twitter || "",
          display_order ? Number(display_order) : 0,
          show_on_website !== undefined ? Boolean(show_on_website) : true,
        ]
      );

      res.json({
        success: true,
        message: "Member added successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("ADD MEMBER ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to add member" });
    }
  }
);

/* =====================================================
   ✏️ 7. ADMIN: UPDATE MEMBER
   PUT /association-posts/admin/members/:id
===================================================== */
router.put(
  "/admin/members/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const {
        name,
        role,
        photo_url,
        bio,
        phone,
        email,
        social_fb,
        social_insta,
        social_linkedin,
        social_twitter,
        display_order,
        show_on_website,
      } = req.body;

      const result = await pool.query(
        `
        UPDATE association_members
        SET name = COALESCE($1, name),
            role = COALESCE($2, role),
            photo_url = COALESCE($3, photo_url),
            bio = COALESCE($4, bio),
            phone = COALESCE($5, phone),
            email = COALESCE($6, email),
            social_fb = COALESCE($7, social_fb),
            social_insta = COALESCE($8, social_insta),
            social_linkedin = COALESCE($9, social_linkedin),
            social_twitter = COALESCE($10, social_twitter),
            display_order = COALESCE($11, display_order),
            show_on_website = COALESCE($12, show_on_website)
        WHERE id = $13
        RETURNING *
        `,
        [
          name ? name.trim() : null,
          role ? role.trim() : null,
          photo_url,
          bio,
          phone,
          email,
          social_fb,
          social_insta,
          social_linkedin,
          social_twitter,
          display_order !== undefined ? Number(display_order) : null,
          show_on_website !== undefined ? Boolean(show_on_website) : null,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Member not found" });
      }

      res.json({
        success: true,
        message: "Member updated successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("UPDATE MEMBER ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to update member" });
    }
  }
);

/* =====================================================
   🗑️ 8. ADMIN: DELETE MEMBER
   DELETE /association-posts/admin/members/:id
===================================================== */
router.delete(
  "/admin/members/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM association_members WHERE id = $1", [req.params.id]);
      res.json({
        success: true,
        message: "Member deleted successfully",
      });
    } catch (err) {
      console.error("DELETE MEMBER ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to delete member" });
    }
  }
);

/* =====================================================
   📸 9. ADMIN: GET ALL POSTS
   GET /association-posts/admin/posts
===================================================== */
router.get(
  "/admin/posts",
  verifyToken,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM association_posts ORDER BY created_at DESC"
      );
      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("GET ADMIN POSTS ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to fetch posts" });
    }
  }
);

/* =====================================================
   ➕ 10. ADMIN: CREATE NEW POST
   POST /association-posts/admin/posts
===================================================== */
router.post(
  "/admin/posts",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "EC_MEMBER", "TREASURER"),
  async (req, res) => {
    try {
      const {
        title,
        description,
        image_url,
        category,
        author_name,
        author_role,
        event_date,
        is_featured,
      } = req.body;

      if (!title || !title.trim() || !image_url) {
        return res.status(400).json({
          success: false,
          error: "Title and Image URL are required",
        });
      }

      const result = await pool.query(
        `
        INSERT INTO association_posts
        (title, description, image_url, category, author_name, author_role, event_date, is_featured, likes_count)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)
        RETURNING *
        `,
        [
          title.trim(),
          description ? description.trim() : "",
          image_url.trim(),
          category ? category.trim() : "Community Seva",
          author_name ? author_name.trim() : "Hindu Swaraj Youth",
          author_role ? author_role.trim() : "Executive Committee",
          event_date || new Date().toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" }),
          Boolean(is_featured),
        ]
      );

      res.json({
        success: true,
        message: "Association post published successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("CREATE POST ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to create post" });
    }
  }
);

/* =====================================================
   ✏️ 11. ADMIN: UPDATE POST
   PUT /association-posts/admin/posts/:id
===================================================== */
router.put(
  "/admin/posts/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "EC_MEMBER"),
  async (req, res) => {
    try {
      const {
        title,
        description,
        image_url,
        category,
        author_name,
        author_role,
        event_date,
        is_featured,
      } = req.body;

      const result = await pool.query(
        `
        UPDATE association_posts
        SET title = COALESCE($1, title),
            description = COALESCE($2, description),
            image_url = COALESCE($3, image_url),
            category = COALESCE($4, category),
            author_name = COALESCE($5, author_name),
            author_role = COALESCE($6, author_role),
            event_date = COALESCE($7, event_date),
            is_featured = COALESCE($8, is_featured)
        WHERE id = $9
        RETURNING *
        `,
        [
          title ? title.trim() : null,
          description ? description.trim() : null,
          image_url ? image_url.trim() : null,
          category ? category.trim() : null,
          author_name ? author_name.trim() : null,
          author_role ? author_role.trim() : null,
          event_date,
          is_featured !== undefined ? Boolean(is_featured) : null,
          req.params.id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Post not found" });
      }

      res.json({
        success: true,
        message: "Post updated successfully!",
        data: result.rows[0],
      });
    } catch (err) {
      console.error("UPDATE POST ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to update post" });
    }
  }
);

/* =====================================================
   🗑️ 12. ADMIN: DELETE POST
   DELETE /association-posts/admin/posts/:id
===================================================== */
router.delete(
  "/admin/posts/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "EC_MEMBER"),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM association_posts WHERE id = $1", [req.params.id]);
      res.json({
        success: true,
        message: "Post deleted successfully",
      });
    } catch (err) {
      console.error("DELETE POST ERROR 👉", err.message);
      res.status(500).json({ success: false, error: "Failed to delete post" });
    }
  }
);

module.exports = router;
