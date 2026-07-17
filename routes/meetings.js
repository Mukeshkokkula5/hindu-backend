const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const notifyUsers = require("../utils/notify");
const { generateResolutionPDF } = require("../utils/generateResolutionPDF");
const { generateMinutesPDF } = require("../utils/generateMinutesPDF");


const router = express.Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "PRESIDENT"];
/* ======================================================
   📝 AGENDA SYSTEM
====================================================== */
/* ======================================================
   📥 GET AGENDA (ALL USERS)
====================================================== */
router.get("/agenda/:id", verifyToken, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT agenda, agenda_locked FROM meetings WHERE id=$1",
      [req.params.id]
    );

    res.json(r.rows[0] || {});
  } catch (err) {
    console.error("GET AGENDA ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch agenda" });
  }
});
/* ======================================================
   💾 SAVE AGENDA (ONLY BEFORE MEETING STARTS)
====================================================== */
router.post(
  "/agenda/:id",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const m = await pool.query(
        "SELECT meeting_date, agenda_locked FROM meetings WHERE id=$1",
        [req.params.id]
      );

      if (!m.rows.length)
        return res.status(404).json({ error: "Meeting not found" });

  const lockTime = new Date(m.rows[0].meeting_date).getTime() + 15 * 60 * 1000;

// If time passed AND still locked → block
if (Date.now() > lockTime && m.rows[0].agenda_locked) {
  return res.status(403).json({
    error: "Agenda is locked by system",
  });
}

      await pool.query(
  `
  UPDATE meetings
  SET agenda=$1,
      agenda_locked=false
  WHERE id=$2
  `,
  [req.body.agenda, req.params.id]
);
      res.json({ success: true });

    } catch (err) {
      console.error("SAVE AGENDA ERROR:", err.message);
      res.status(500).json({ error: "Failed to save agenda" });
    }
  }
);

/* ======================================================
   🔓 PRESIDENT AGENDA OVERRIDE
====================================================== */
router.post("/agenda-unlock/:id", verifyToken, checkRole("PRESIDENT"), async (req, res) => {
  try {
    await pool.query(
      "UPDATE meetings SET agenda_locked=false WHERE id=$1",
      [req.params.id]
    );

    await notifyUsers(
      [req.user.id],
      "🔓 Agenda Unlocked",
      "President unlocked the agenda",
      "/meetings"
    );

    res.json({ success: true });
  } catch (err) {
    console.error("AGENDA OVERRIDE ERROR:", err.message);
    res.status(500).json({ error: "Failed to unlock agenda" });
  }
});
/* ======================================================
   📅 GET ALL MEETINGS (ALL USERS)
====================================================== */
router.get("/", verifyToken, async (req, res) => {
  try {
    // 🔒 Auto-lock agendas when meeting starts
    await pool.query(`
UPDATE meetings
SET agenda_locked = true
WHERE
  (meeting_date AT TIME ZONE 'UTC') + INTERVAL '15 minutes' < NOW()
  AND agenda_locked = false;
`);

    const { rows } = await pool.query(
      "SELECT * FROM meetings ORDER BY meeting_date DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error("GET MEETINGS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

/* ======================================================
   ➕ CREATE MEETING (ADMIN / PRESIDENT)
====================================================== */
router.post(
  "/create",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { title, description, meeting_date, location, join_link } = req.body;

      if (!title || !meeting_date) {
        return res.status(400).json({ error: "Title & date required" });
      }

      const { rows } = await pool.query(
        `
        INSERT INTO meetings
(title, description, meeting_date, location, join_link, created_by)
VALUES ($1,$2,$3::timestamptz,$4,$5,$6)
        RETURNING *
        `,
        [
          title,
          description || null,
          meeting_date,
          location || null,
          join_link || null,
          req.user.id,
        ]
      );

      const users = await pool.query("SELECT id FROM users");
      await notifyUsers(
        users.rows.map(u => u.id),
        "📅 New Meeting Scheduled",
        `Meeting: ${title}`,
        "/meetings"
      );

      res.json(rows[0]);
    } catch (err) {
      console.error("CREATE MEETING ERROR:", err.message);
      res.status(500).json({ error: "Failed to create meeting" });
    }
  }
);

/* ======================================================
   ✏️ UPDATE MEETING (ADMIN / PRESIDENT)
====================================================== */
router.put(
  "/:id",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { title, description, meeting_date, location, join_link } = req.body;

      const { rows } = await pool.query(
        `
        UPDATE meetings
SET title=$1,
    description=$2,
    meeting_date=$3::timestamptz,
    location=$4,
    join_link=$5
WHERE id=$6
RETURNING *
        `,
        [
          title,
          description,
          meeting_date,
          location,
          join_link,
          req.params.id,
        ]
      );

      res.json(rows[0]);
    } catch (err) {
      console.error("UPDATE MEETING ERROR:", err.message);
      res.status(500).json({ error: "Failed to update meeting" });
    }
  }
);

/* ======================================================
   🗑 DELETE MEETING (ADMIN / PRESIDENT)
====================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM meetings WHERE id=$1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE MEETING ERROR:", err.message);
      res.status(500).json({ error: "Failed to delete meeting" });
    }
  }
);

/* ======================================================
   👥 JOIN MEETING (ALL ROLES)
====================================================== */
router.post("/join/:id", verifyToken, async (req, res) => {
  try {
    await pool.query(
      `
      INSERT INTO meeting_attendance (meeting_id, user_id, status)
      VALUES ($1, $2, 'PRESENT')
      ON CONFLICT (meeting_id, user_id)
      DO UPDATE
      SET status='PRESENT', marked_at=NOW()
      `,
      [req.params.id, req.user.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("JOIN MEETING ERROR:", err.message);
    res.status(500).json({ error: "Failed to join meeting" });
  }
});
/* ======================================================
   👥 GET MEETING ATTENDANCE
====================================================== */
router.get("/attendance/:id", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT 
        u.id,
        u.name,
        CASE 
          WHEN ma.user_id IS NOT NULL THEN true 
          ELSE false 
        END AS present
      FROM users u
      LEFT JOIN meeting_attendance ma
        ON ma.user_id = u.id AND ma.meeting_id = $1
      ORDER BY u.name
      `,
      [req.params.id]
    );

    res.json(rows);
  } catch (err) {
    console.error("ATTENDANCE ERROR:", err.message);
    res.status(500).json({ error: "Failed to load attendance" });
  }
});


/* ======================================================
   📜 GET RESOLUTIONS
====================================================== */
router.get("/resolution/:meetingId", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM meeting_resolutions
      WHERE meeting_id=$1
      ORDER BY created_at DESC
      `,
      [req.params.meetingId]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET RESOLUTION ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch resolutions" });
  }
});

/* ======================================================
   ➕ CREATE RESOLUTION (ADMIN / PRESIDENT)
====================================================== */
router.post(
  "/resolution/:meetingId",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { title, content, vote_deadline } = req.body;

      const deadline =
        vote_deadline || new Date(Date.now() + 24 * 60 * 60 * 1000);

      const { rows } = await pool.query(
        `
        INSERT INTO meeting_resolutions
        (meeting_id, title, content, created_by, vote_deadline)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING *
        `,
        [req.params.meetingId, title, content, req.user.id, deadline]
      );

      res.json(rows[0]);
    } catch (err) {
      console.error("CREATE RESOLUTION ERROR:", err.message);
      res.status(500).json({ error: "Failed to create resolution" });
    }
  }
);

/* ======================================================
   🗳 VOTE ON RESOLUTION
====================================================== */
router.post("/vote/:rid", verifyToken, async (req, res) => {
  try {
    // 🔐 Only EC members can vote
    const userRole = await pool.query(
      "SELECT role FROM users WHERE id=$1",
      [req.user.id]
    );

    const allowedRoles = [
      "EC_MEMBER",
      "PRESIDENT",
      "VICE_PRESIDENT",
      "GENERAL_SECRETARY",
      "JOINT_SECRETARY",
    ];

    if (!allowedRoles.includes(userRole.rows[0].role)) {
      return res.status(403).json({
        error: "You are not authorized to vote",
      });
    }
    const { vote } = req.body;

    if (!vote || !["YES", "NO"].includes(vote)) {
      return res.status(400).json({ error: "Invalid vote" });
    }
// 🔒 Prevent second vote
const alreadyVoted = await pool.query(
  `SELECT 1 FROM meeting_votes 
   WHERE resolution_id=$1 AND user_id=$2`,
  [req.params.rid, req.user.id]
);

if (alreadyVoted.rows.length > 0) {
  return res.status(409).json({
    error: "You already voted on this resolution",
  });
}
    const r = await pool.query(
      "SELECT vote_deadline, is_locked FROM meeting_resolutions WHERE id=$1",
      [req.params.rid]
    );

    if (!r.rows.length) {
      return res.status(404).json({ error: "Resolution not found" });
    }

    if (r.rows[0].is_locked || new Date() > new Date(r.rows[0].vote_deadline)) {
      return res.status(403).json({ error: "Voting closed" });
    }

    await pool.query(
      `
      INSERT INTO meeting_votes (resolution_id, user_id, vote)
      VALUES ($1,$2,$3)
      
      `,
      [req.params.rid, req.user.id, vote]
    );

    // ✅ send success immediately
    res.json({ success: true });

    // ✅ background finalize
    finalizeResolution(req.params.rid)
      .catch(err => console.error("FINALIZE ERROR:", err.message));

  } catch (err) {
    console.error("VOTE ERROR:", err.message);
    res.status(500).json({ error: "Vote failed" });
  }
});
/* ======================================================
   🧾 WHO VOTED (YES / NO)
====================================================== */
router.get("/votes/:rid", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT u.name, v.vote
      FROM meeting_votes v
      JOIN users u ON u.id = v.user_id
      WHERE v.resolution_id = $1
      ORDER BY u.name
      `,
      [req.params.rid]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET VOTES ERROR:", err.message);
    res.status(500).json({ error: "Failed to load votes" });
  }
});

/* ======================================================
   🔒 FINALIZE RESOLUTION
====================================================== */
async function finalizeResolution(resolutionId) {
  try {
     // 🛑 Already finalized check
    const lockCheck = await pool.query(
      "SELECT is_locked FROM meeting_resolutions WHERE id=$1",
      [resolutionId]
    );

    if (!lockCheck.rows.length || lockCheck.rows[0].is_locked) return;
    // 1️⃣ Count eligible voters
    const ec = await pool.query(`
      SELECT COUNT(*) 
      FROM users 
      WHERE role IN (
        'EC_MEMBER',
        'PRESIDENT',
        'VICE_PRESIDENT',
        'GENERAL_SECRETARY',
        'JOINT_SECRETARY'
      )
    `);

    const totalEC = Number(ec.rows[0].count);

    // 2️⃣ Fetch votes with roles
    const votes = await pool.query(`
  SELECT v.vote, u.role
  FROM meeting_votes v
  JOIN users u ON u.id = v.user_id
  WHERE v.resolution_id = $1
    AND u.role IN (
      'EC_MEMBER',
      'PRESIDENT',
      'VICE_PRESIDENT',
      'GENERAL_SECRETARY',
      'JOINT_SECRETARY'
    )
`, [resolutionId]);

    const totalVotes = votes.rows.length;

    // 3️⃣ Quorum (50%)
    const quorum = Math.ceil(totalEC * 0.5);
    if (totalVotes < quorum) return;

    let yes = 0, no = 0;
    let presidentVote = null;

    votes.rows.forEach(v => {
      if (v.vote === "YES") yes++;
      if (v.vote === "NO") no++;
      if (v.role === "PRESIDENT") presidentVote = v.vote;
    });

    let status = "REJECTED";

    if (yes > no) status = "APPROVED";
    else if (no > yes) status = "REJECTED";
    else {
      if (!presidentVote) return;
      status = presidentVote === "YES" ? "APPROVED" : "REJECTED";
    }

    // 4️⃣ Lock resolution
    await pool.query(`
      UPDATE meeting_resolutions
      SET status=$1, is_locked=true, approved_at=NOW()
      WHERE id=$2
    `, [status, resolutionId]);

    // 5️⃣ SAFE side-effects
    if (status === "APPROVED") {

      // 🧾 PDF (SAFE)
      try {
        await generateResolutionPDF(resolutionId);
      } catch (pdfErr) {
        console.error("PDF GENERATION ERROR:", pdfErr.message);
      }

      // 🔔 Notification (SAFE)
      try {
        const users = await pool.query("SELECT id FROM users");

await notifyUsers(
  users.rows.map(u => u.id),
  "🔓 Agenda Unlocked",
  "President unlocked the agenda",
  "/meetings"
);
await notifyUsers(
  users.rows.map(u => u.id),
  "✅ Resolution Approved",
  "A resolution has been approved",
  "/meetings"
);
      } catch (notifyErr) {
        console.error("NOTIFICATION ERROR:", notifyErr.message);
      }
    }

  } catch (err) {
    console.error("FINALIZE RESOLUTION ERROR:", err.message);
  }
}


// ===============================
// 🧾 GENERATE MINUTES PDF
// ===============================
router.post(
  "/minutes-pdf/:meetingId",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      const meetingId = Number(req.params.meetingId);

      if (!meetingId) {
        return res.status(400).json({ error: "Invalid meeting id" });
      }

      const pdfPath = await generateMinutesPDF(meetingId);

      res.json({ pdf: pdfPath });
    } catch (err) {
      console.error("MINUTES PDF ERROR:", err.message);
      res.status(500).json({ error: "Failed to generate minutes PDF" });
    }
  }
);
/* ======================================================
   📄 MANUAL RESOLUTION PDF GENERATE
====================================================== */
router.post(
  "/resolution-generate-pdf/:id",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT"),
  async (req, res) => {
    try {
      // 1️⃣ Generate PDF
      await generateResolutionPDF(req.params.id);

      // 2️⃣ Fetch updated path
      const r = await pool.query(
        "SELECT pdf_path FROM meeting_resolutions WHERE id=$1",
        [req.params.id]
      );

      res.json({ pdf: r.rows[0].pdf_path });
    } catch (err) {
      console.error("RESOLUTION PDF ERROR:", err);
      res.status(500).json({ error: "PDF generation failed" });
    }
  }
);
module.exports = router;
