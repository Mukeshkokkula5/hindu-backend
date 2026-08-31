const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const logAudit = require("../utils/auditLogger");
const sendMail = require("../utils/sendMail");
const {
  volunteerRegistrationTemplate,
  volunteerStatusTemplate,
  addMemberTemplate,
} = require("../utils/emailTemplates");

const router = express.Router();

function generateRandomMemberPassword() {
  const prefix = "HSY@";
  const num = Math.floor(1000 + Math.random() * 9000);
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  let suffix = "";
  for (let i = 0; i < 2; i++) {
    suffix += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return `${prefix}${num}${suffix}`;
}

// Role Constants
const ADMIN_WRITE_ROLES = ["SUPER_ADMIN", "PRESIDENT"];
const VIEW_ALL_ROLES = [
  "SUPER_ADMIN",
  "PRESIDENT",
  "VICE_PRESIDENT",
  "GENERAL_SECRETARY",
  "SECRETARY",
  "JOINT_SECRETARY",
  "TREASURER",
  "EC_MEMBER",
];

// Helper: Member ID generator
async function generateMemberId(client) {
  const year = new Date().getFullYear();
  const prefix = `HSY/JGTL/${year}/`;

  const last = await client.query(
    `
    SELECT member_id
    FROM users
    WHERE member_id LIKE $1
    ORDER BY member_id DESC
    LIMIT 1
    FOR UPDATE
    `,
    [`${prefix}%`]
  );

  const next = last.rowCount
    ? Number(last.rows[0].member_id.split("/").pop()) + 1
    : 1;

  return prefix + String(next).padStart(4, "0");
}

// Helper: Username generator
async function generateUsername(name) {
  const base = name.toLowerCase().replace(/[^a-z]/g, "") || "volunteer";
  let username = `${base}@hsy.org`;
  let i = 1;

  while (true) {
    const exists = await pool.query(
      "SELECT id FROM users WHERE username=$1",
      [username]
    );
    if (!exists.rowCount) break;
    username = `${base}${++i}@hsy.org`;
  }

  return username;
}

/* =====================================================
   🤝 1. REGISTER VOLUNTEER (PUBLIC)
   POST /volunteer/register
===================================================== */
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      city = "Jagtial",
      address,
      occupation,
      blood_group,
      areas_of_interest,
      skills,
      availability = "Weekends & Events",
      message,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Full name is required" });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({ error: "Mobile/WhatsApp number is required" });
    }

    // Format interests string if array passed
    const interestStr = Array.isArray(areas_of_interest)
      ? areas_of_interest.join(", ")
      : areas_of_interest || "";

    const { rows } = await pool.query(
      `INSERT INTO volunteers (
        name,
        email,
        phone,
        city,
        address,
        occupation,
        blood_group,
        areas_of_interest,
        skills,
        availability,
        message,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'PENDING')
      RETURNING id, name, email, phone, city, status, created_at`,
      [
        name.trim(),
        email ? email.trim() : null,
        phone.trim(),
        city ? city.trim() : "Jagtial",
        address ? address.trim() : null,
        occupation ? occupation.trim() : null,
        blood_group ? blood_group.trim() : null,
        interestStr.trim(),
        skills ? skills.trim() : null,
        availability ? availability.trim() : "Weekends & Events",
        message ? message.trim() : null,
      ]
    );

    const newVolunteer = rows[0];

    // Send confirmation email if email provided
    if (email && email.trim()) {
      sendMail(
        email.trim(),
        `Volunteer Application Received (#VOL-${newVolunteer.id}) - Hindu Swaraj Youth`,
        volunteerRegistrationTemplate({
          id: newVolunteer.id,
          name: name.trim(),
          phone: phone.trim(),
          interests: interestStr,
          city: city || "Jagtial",
          blood_group: blood_group ? blood_group.trim() : null,
          availability: availability ? availability.trim() : "Weekends & Events",
        })
      ).catch((err) => console.error("Volunteer Email Error 👉", err.message));
    }

    // Send automated WhatsApp Welcome Message
    try {
      const { sendVolunteerWelcomeWhatsApp } = require("../services/whatsappBot");
      await sendVolunteerWelcomeWhatsApp({
        name: name.trim(),
        id: newVolunteer.id,
        phone: phone.trim(),
        city: city || "Jagtial",
        interests: interestStr,
      });
    } catch (waErr) {
      console.warn("Volunteer WhatsApp notice:", waErr.message);
    }

    res.status(201).json({
      success: true,
      message: "Volunteer application submitted successfully! Welcome alerts dispatched via Email & WhatsApp.",
      volunteer: newVolunteer,
    });
  } catch (err) {
    console.error("VOLUNTEER REGISTER ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to submit volunteer application. Please try again." });
  }
});

/* =====================================================
   📊 2. GET VOLUNTEER STATS (ADMIN)
   GET /volunteer/stats
===================================================== */
router.get(
  "/stats",
  verifyToken,
  checkRole(...VIEW_ALL_ROLES),
  async (req, res) => {
    try {
      const statsRes = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE UPPER(status) = 'PENDING' OR status IS NULL) AS pending,
          COUNT(*) FILTER (WHERE UPPER(status) = 'APPROVED') AS approved,
          COUNT(*) FILTER (WHERE UPPER(status) = 'CONTACTED') AS contacted,
          COUNT(*) FILTER (WHERE UPPER(status) = 'REJECTED') AS rejected
        FROM volunteers
      `);

      const s = statsRes.rows[0];
      res.json({
        total: parseInt(s.total, 10) || 0,
        pending: parseInt(s.pending, 10) || 0,
        approved: parseInt(s.approved, 10) || 0,
        contacted: parseInt(s.contacted, 10) || 0,
        rejected: parseInt(s.rejected, 10) || 0,
      });
    } catch (err) {
      console.error("VOLUNTEER STATS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load volunteer stats" });
    }
  }
);

/* =====================================================
   👥 3. GET VOLUNTEERS LIST (ADMIN)
   GET /volunteer/list
===================================================== */
router.get(
  "/list",
  verifyToken,
  checkRole(...VIEW_ALL_ROLES),
  async (req, res) => {
    try {
      const { search = "", status = "ALL", interest = "" } = req.query;

      let query = `
        SELECT
          id,
          name,
          email,
          phone,
          city,
          address,
          occupation,
          blood_group,
          areas_of_interest,
          skills,
          availability,
          message,
          COALESCE(status, 'PENDING') AS status,
          notes,
          created_at,
          updated_at
        FROM volunteers
        WHERE 1=1
      `;
      const params = [];

      if (status && status !== "ALL") {
        params.push(status.toUpperCase());
        query += ` AND UPPER(COALESCE(status, 'PENDING')) = $${params.length}`;
      }

      if (search && search.trim()) {
        params.push(`%${search.trim()}%`);
        query += ` AND (
          name ILIKE $${params.length} OR
          email ILIKE $${params.length} OR
          phone ILIKE $${params.length} OR
          city ILIKE $${params.length} OR
          occupation ILIKE $${params.length} OR
          skills ILIKE $${params.length}
        )`;
      }

      if (interest && interest.trim()) {
        params.push(`%${interest.trim()}%`);
        query += ` AND areas_of_interest ILIKE $${params.length}`;
      }

      query += ` ORDER BY created_at DESC`;

      const { rows } = await pool.query(query, params);

      res.json(rows);
    } catch (err) {
      console.error("GET VOLUNTEERS LIST ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to load volunteer list" });
    }
  }
);

/* =====================================================
   ✏️ 4. UPDATE VOLUNTEER STATUS & NOTES (PRESIDENT / SUPER ADMIN)
   PATCH /volunteer/:id/status
===================================================== */
router.patch(
  "/:id/status",
  verifyToken,
  checkRole(...ADMIN_WRITE_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const validStatuses = ["PENDING", "APPROVED", "CONTACTED", "REJECTED"];
      if (!validStatuses.includes(status.toUpperCase())) {
        return res.status(400).json({ error: "Invalid status value" });
      }

      const current = await pool.query(
        "SELECT id, name, email, status FROM volunteers WHERE id = $1",
        [id]
      );

      if (!current.rowCount) {
        return res.status(404).json({ error: "Volunteer not found" });
      }

      const { rows } = await pool.query(
        `UPDATE volunteers
         SET
           status = $1,
           notes = COALESCE($2, notes),
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [status.toUpperCase(), notes !== undefined ? notes : null, id]
      );

      const updated = rows[0];

      // Audit Log
      await logAudit(
        `VOLUNTEER_STATUS_${status.toUpperCase()}`,
        "VOLUNTEER",
        id,
        req.user.id
      );

      // Send update email if status changed and email exists
      if (updated.email && (status.toUpperCase() === "APPROVED" || status.toUpperCase() === "CONTACTED" || status.toUpperCase() === "REJECTED")) {
        sendMail(
          updated.email,
          `Volunteer Application Update [${status.toUpperCase()}] (#VOL-${updated.id}) - Hindu Swaraj Youth`,
          volunteerStatusTemplate({
            id: updated.id,
            name: updated.name,
            status: status.toUpperCase(),
            notes: notes || "Thank you for your willingness to serve with us.",
          })
        ).catch((err) => console.error("Volunteer Status Email Error 👉", err.message));
      }

      res.json({
        success: true,
        message: `Volunteer status updated to ${status.toUpperCase()}`,
        volunteer: updated,
      });
    } catch (err) {
      console.error("UPDATE VOLUNTEER STATUS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update volunteer status" });
    }
  }
);

/* =====================================================
   👑 5. CONVERT VOLUNTEER TO OFFICIAL MEMBER / USER (PRESIDENT / SUPER ADMIN)
   POST /volunteer/:id/convert-to-member
===================================================== */
router.post(
  "/:id/convert-to-member",
  verifyToken,
  checkRole(...ADMIN_WRITE_ROLES),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const { role = "VOLUNTEER" } = req.body;

      const volRes = await pool.query("SELECT * FROM volunteers WHERE id = $1", [id]);
      if (!volRes.rowCount) {
        return res.status(404).json({ error: "Volunteer not found" });
      }

      const vol = volRes.rows[0];

      await client.query("BEGIN");

      const memberId = await generateMemberId(client);
      const username = await generateUsername(vol.name);
      const password = generateRandomMemberPassword();
      const hashed = await bcrypt.hash(password, 10);

      const userRes = await client.query(
        `
        INSERT INTO users
          (member_id, name, username, personal_email, phone, address, password, role, is_first_login, active)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, true, true)
        RETURNING id
        `,
        [
          memberId,
          vol.name,
          username,
          vol.email || null,
          vol.phone || null,
          vol.address || vol.city || null,
          hashed,
          role,
        ]
      );

      // Update volunteer record status
      await client.query(
        `UPDATE volunteers
         SET
           status = 'APPROVED',
           notes = COALESCE(notes || ' | ', '') || 'Converted to system account with Member ID: ' || $1,
           updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [memberId, id]
      );

      await client.query("COMMIT");

      // Send login credentials email if email is present
      if (vol.email) {
        await sendMail(
          vol.email,
          "Welcome to HSY Association - Member Account Created",
          addMemberTemplate({
            name: vol.name,
            username,
            password,
            memberId,
          })
        );
      }

      await logAudit("CONVERT_VOLUNTEER_TO_MEMBER", "USER", userRes.rows[0].id, req.user.id);

      res.status(201).json({
        success: true,
        message: "Volunteer successfully converted to registered member account!",
        member_id: memberId,
        username,
        tempPassword: password,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("CONVERT VOLUNTEER ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to convert volunteer to member" });
    } finally {
      client.release();
    }
  }
);

/* =====================================================
   🗑 6. DELETE VOLUNTEER APPLICATION (PRESIDENT / SUPER ADMIN)
   DELETE /volunteer/:id
===================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole(...ADMIN_WRITE_ROLES),
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        "DELETE FROM volunteers WHERE id = $1 RETURNING id, name",
        [id]
      );

      if (!result.rowCount) {
        return res.status(404).json({ error: "Volunteer record not found" });
      }

      await logAudit("DELETE_VOLUNTEER", "VOLUNTEER", id, req.user.id);

      res.json({
        success: true,
        message: `Volunteer application for ${result.rows[0].name} deleted successfully`,
      });
    } catch (err) {
      console.error("DELETE VOLUNTEER ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to delete volunteer application" });
    }
  }
);

module.exports = router;