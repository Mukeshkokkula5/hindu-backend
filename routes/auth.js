const logAudit = require("../utils/auditLogger");
const express = require("express");
const bcrypt = require("bcryptjs"); // ✅ ONLY bcrypt
const jwt = require("jsonwebtoken");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const sendMail = require("../utils/sendMail");
const {
  forgotPasswordTemplate,
  passwordResetSuccessTemplate,
} = require("../utils/emailTemplates");

const router = express.Router();

/* =========================
   🔐 REGISTER (SUPER ADMIN – RUN ONCE)
========================= */
router.post("/register", async (req, res) => {
  try {
    const { name, personal_email, password } = req.body;

    if (!name || !password) {
      return res.status(400).json({ error: "Name and password required" });
    }

    const existingSA = await pool.query(
      "SELECT id FROM users WHERE role='SUPER_ADMIN'"
    );

    if (existingSA.rowCount > 0) {
      return res.status(403).json({ error: "Super Admin already exists" });
    }

    const username = `${name.toLowerCase().replace(/\s+/g, "")}@hsy.org`;
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users
       (name, username, personal_email, password, role, is_first_login, active, status)
       VALUES ($1,$2,$3,$4,'SUPER_ADMIN',false,true,'ACTIVE')
       RETURNING id,name,username,role,is_first_login`,
      [name, username, personal_email || null, hashedPassword]
    );

    res.status(201).json({
      message: "Super Admin created successfully",
      user: result.rows[0],
    });
  } catch (err) {
    console.error("REGISTER ERROR 👉", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   🔑 LOGIN (USERNAME / EMAIL)
========================= */
router.post("/login", async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const loginId = email || username;

    if (!loginId || !password) {
      return res
        .status(400)
        .json({ error: "Association ID and password required" });
    }

    const result = await pool.query(
      `SELECT id,name,username,password,role,is_first_login,active
       FROM users
       WHERE username=$1 OR username=$1 || '@hsy.org' OR personal_email=$1`,
      [loginId]
    );

    if (!result.rowCount) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];

    if (!user.active) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // ✅ CORRECT bcrypt compare
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!process.env.JWT_SECRET) {
      console.error("❌ JWT_SECRET missing");
      return res.status(500).json({ error: "Server configuration error" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      role: user.role,
      isFirstLogin: user.is_first_login,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR 👉", err);
    res.status(500).json({ error: "Server error" });
  }
});
/* =========================
   🔐 GET LOGGED IN USER
========================= */
router.get("/me", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        id,
        member_id,
        name,
        username AS association_id,
        personal_email,
        phone,
        address,
        role,
        active,
        is_first_login
      FROM users
      WHERE id = $1
      `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("AUTH /me ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});
/* =========================
   🔐 FORGOT PASSWORD – SEND OTP
========================= */
router.post("/forgot-password", async (req, res) => {
  try {
    const { username, email } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier) {
      return res.status(400).json({ error: "Username or registered email is required" });
    }

    const userResult = await pool.query(
      `SELECT id, name, username, personal_email 
       FROM users 
       WHERE username=$1 OR username=$1 || '@hsy.org' OR personal_email=$1`,
      [identifier]
    );

    if (!userResult.rowCount) {
      return res.status(404).json({ error: "No account found with this username/email" });
    }

    const user = userResult.rows[0];
    if (!user.personal_email) {
      return res.status(400).json({ error: "No personal email registered for this account. Please contact Super Admin." });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    // Invalidate previous unused OTPs for this user
    await pool.query(
      "UPDATE password_resets SET used=true WHERE user_id=$1 AND used=false",
      [user.id]
    );

    await pool.query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`,
      [user.id, otpHash]
    );

    // Mask email for privacy
    const [userPart, domain] = user.personal_email.split("@");
    const maskedEmail =
      userPart.length > 2
        ? `${userPart[0]}***${userPart[userPart.length - 1]}@${domain}`
        : `${userPart[0]}***@${domain}`;

    console.log(`🔑 [PASSWORD RESET OTP] For ${user.username} (${user.personal_email}): ${otp}`);

    const mailSent = await sendMail(
      user.personal_email,
      "Password Reset OTP – HSY Association",
      forgotPasswordTemplate({ name: user.name, otp })
    );

    if (!mailSent) {
      console.warn("⚠️ Email delivery failed (check RESEND_API_KEY). OTP is logged above for local testing.");
      if (process.env.NODE_ENV === "production") {
        return res.status(500).json({
          error: "Failed to deliver reset email. Please contact the administrator.",
        });
      }
    }

    res.json({
      success: true,
      message: mailSent
        ? `OTP sent to your registered email (${maskedEmail})`
        : `Email delivery failed (Invalid API key), but OTP generated for testing: ${otp}`,
      username: user.username,
      maskedEmail,
      mailSent: !!mailSent,
      ...(process.env.NODE_ENV !== "production" ? { devOtp: otp } : {}),
    });
  } catch (err) {
    console.error("FORGOT PASSWORD ERROR 👉", err);
    res.status(500).json({ error: "Server error while generating OTP" });
  }
});

/* =========================
   🔐 VERIFY OTP (FORGOT PASSWORD)
========================= */
router.post("/verify-otp", async (req, res) => {
  try {
    const { username, email, otp } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier || !otp) {
      return res.status(400).json({ error: "Username and OTP are required" });
    }

    const userResult = await pool.query(
      `SELECT id, username FROM users 
       WHERE username=$1 OR username=$1 || '@hsy.org' OR personal_email=$1`,
      [identifier]
    );

    if (!userResult.rowCount) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const otpResult = await pool.query(
      `SELECT otp_hash, expires_at
       FROM password_resets
       WHERE user_id=$1 AND used=false AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (!otpResult.rowCount) {
      return res.status(400).json({ error: "No active OTP found or OTP has expired. Please request a new OTP." });
    }

    const { otp_hash, expires_at } = otpResult.rows[0];

    if (new Date() > new Date(expires_at)) {
      return res.status(400).json({ error: "OTP has expired. Please request a new OTP." });
    }

    const isValid = await bcrypt.compare(otp.trim(), otp_hash);

    if (!isValid) {
      return res.status(400).json({ error: "Invalid OTP. Please check and try again." });
    }

    res.json({
      success: true,
      message: "OTP verified successfully",
      username: userResult.rows[0].username,
    });
  } catch (err) {
    console.error("VERIFY OTP ERROR 👉", err);
    res.status(500).json({ error: "Server error while verifying OTP" });
  }
});

/* =========================
   🔐 RESET PASSWORD
========================= */
router.post("/reset-password", async (req, res) => {
  try {
    const { username, email, otp, newPassword } = req.body;
    const identifier = (username || email || "").trim();

    if (!identifier || !newPassword) {
      return res.status(400).json({ error: "Username and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters long" });
    }

    const userResult = await pool.query(
      `SELECT id, name, username, personal_email FROM users 
       WHERE username=$1 OR username=$1 || '@hsy.org' OR personal_email=$1`,
      [identifier]
    );

    if (!userResult.rowCount) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    // If OTP is provided, verify it
    if (otp) {
      const otpResult = await pool.query(
        `SELECT otp_hash, expires_at
         FROM password_resets
         WHERE user_id=$1 AND used=false AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [user.id]
      );

      if (!otpResult.rowCount) {
        return res.status(400).json({ error: "No active OTP found or OTP has expired. Please request a new OTP." });
      }

      const { otp_hash, expires_at } = otpResult.rows[0];
      if (new Date() > new Date(expires_at)) {
        return res.status(400).json({ error: "OTP has expired. Please request a new OTP." });
      }

      const isValid = await bcrypt.compare(otp.trim(), otp_hash);
      if (!isValid) {
        return res.status(400).json({ error: "Invalid OTP" });
      }
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE users SET password=$1, is_first_login=false WHERE id=$2",
      [hashed, user.id]
    );

    await pool.query(
      "UPDATE password_resets SET used=true WHERE user_id=$1",
      [user.id]
    );

    if (user.personal_email) {
      await sendMail(
        user.personal_email,
        "Password Reset Successful – HSY Association",
        passwordResetSuccessTemplate({ name: user.name })
      );
    }

    try {
      await logAudit("RESET_PASSWORD", "USER", user.id, user.id);
    } catch (auditErr) {
      console.warn("Audit log warning:", auditErr.message);
    }

    res.json({
      success: true,
      message: "Password reset successfully! You can now log in with your new password.",
    });
  } catch (err) {
    console.error("RESET PASSWORD ERROR 👉", err);
    res.status(500).json({ error: "Server error while resetting password" });
  }
});

/* =========================
   🔐 VERIFY TOKEN
========================= */
router.get("/verify", verifyToken, (req, res) => {
  res.json({ message: "Token valid", user: req.user });
});

/* =========================
   🔁 CHANGE PASSWORD (LOGGED IN)
========================= */
router.post("/change-password", verifyToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: "All fields required" });
    }

    const userResult = await pool.query(
      "SELECT password FROM users WHERE id=$1",
      [req.user.id]
    );

    const match = await bcrypt.compare(
      oldPassword,
      userResult.rows[0].password
    );

    if (!match) {
      return res.status(401).json({ error: "Old password incorrect" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE users SET password=$1, is_first_login=false WHERE id=$2",
      [hashed, req.user.id]
    );

    res.json({
      message: "Password changed successfully. Please login again.",
      forceLogout: true,
    });
  } catch (err) {
    console.error("CHANGE PASSWORD ERROR 👉", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
