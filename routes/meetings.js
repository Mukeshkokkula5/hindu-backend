const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const notifyUsers = require("../utils/notify");

const router = express.Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "PRESIDENT"];
const VOTING_ROLES = [
  "SUPER_ADMIN",
  "PRESIDENT",
  "VICE_PRESIDENT",
  "GENERAL_SECRETARY",
  "SECRETARY",
  "JOINT_SECRETARY",
  "TREASURER",
  "EC_MEMBER",
  "EC",
  "MEMBER",
];

// Initialize required tables & columns on module load
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        meeting_type VARCHAR(50) DEFAULT 'GBM',
        meeting_date TIMESTAMPTZ NOT NULL,
        location VARCHAR(255),
        join_link VARCHAR(255),
        presided_by VARCHAR(150) DEFAULT 'President',
        convener VARCHAR(150) DEFAULT 'General Secretary',
        agenda TEXT,
        agenda_locked BOOLEAN DEFAULT false,
        status VARCHAR(50) DEFAULT 'SCHEDULED',
        minutes_text TEXT,
        quorum_required_pct INT DEFAULT 67,
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_type VARCHAR(50) DEFAULT 'GBM';
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS presided_by VARCHAR(150) DEFAULT 'President';
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS convener VARCHAR(150) DEFAULT 'General Secretary';
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'SCHEDULED';
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS minutes_text TEXT;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS quorum_required_pct INT DEFAULT 67;

      CREATE TABLE IF NOT EXISTS meeting_resolutions (
        id SERIAL PRIMARY KEY,
        meeting_id INT REFERENCES meetings(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        voting_rule VARCHAR(50) DEFAULT 'TWO_THIRDS',
        quorum_required INT DEFAULT 67,
        is_locked BOOLEAN DEFAULT false,
        status VARCHAR(50) DEFAULT 'VOTING_OPEN',
        vote_deadline TIMESTAMPTZ,
        pdf_path TEXT,
        created_by INT,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      ALTER TABLE meeting_resolutions ADD COLUMN IF NOT EXISTS voting_rule VARCHAR(50) DEFAULT 'TWO_THIRDS';
      ALTER TABLE meeting_resolutions ADD COLUMN IF NOT EXISTS quorum_required INT DEFAULT 67;
      ALTER TABLE meeting_resolutions ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'VOTING_OPEN';

      CREATE TABLE IF NOT EXISTS meeting_votes (
        id SERIAL PRIMARY KEY,
        resolution_id INT REFERENCES meeting_resolutions(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        vote VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(resolution_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS meeting_attendance (
        id SERIAL PRIMARY KEY,
        meeting_id INT REFERENCES meetings(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'PRESENT',
        marked_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(meeting_id, user_id)
      );
    `);
  } catch (err) {
    console.warn("Meeting tables initialization warning:", err.message);
  }
})();

/* ======================================================
   📅 1. GET ALL MEETINGS (WITH STATS & COUNTS)
====================================================== */
router.get("/", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        m.*,
        u.name AS organizer_name,
        (SELECT COUNT(*) FROM meeting_attendance ma WHERE ma.meeting_id = m.id AND ma.status = 'PRESENT') AS present_count,
        (SELECT COUNT(*) FROM meeting_resolutions mr WHERE mr.meeting_id = m.id) AS resolution_count
      FROM meetings m
      LEFT JOIN users u ON u.id = m.created_by
      ORDER BY m.meeting_date DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("GET MEETINGS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch meetings" });
  }
});

/* ======================================================
   ➕ 2. CREATE MEETING (SUPER ADMIN & PRESIDENT)
====================================================== */
router.post(
  "/create",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const {
        title,
        description,
        meeting_type = "GBM",
        meeting_date,
        location = "Association Executive Chamber (Head Office)",
        presided_by = "President",
        convener = "General Secretary",
        agenda,
        quorum_required_pct = 67,
        join_link = null,
      } = req.body;

      if (!title || !meeting_date) {
        return res.status(400).json({ error: "Title and meeting date/time are required" });
      }

      const { rows } = await pool.query(
        `
        INSERT INTO meetings
        (title, description, meeting_type, meeting_date, location, presided_by, convener, agenda, quorum_required_pct, join_link, created_by, status)
        VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, 'SCHEDULED')
        RETURNING *
        `,
        [
          title.trim(),
          description || null,
          meeting_type,
          meeting_date,
          location,
          presided_by,
          convener,
          agenda || null,
          Number(quorum_required_pct) || 67,
          join_link || null,
          req.user.id,
        ]
      );

      const newMeeting = rows[0];

      try {
        const users = await pool.query("SELECT id FROM users");
        await notifyUsers(
          users.rows.map((u) => u.id),
          "📅 New Association Meeting Scheduled",
          `Meeting: ${title} (${meeting_type}) on ${new Date(meeting_date).toLocaleString("en-IN")}`,
          "/admin"
        );
      } catch (notifyErr) {
        console.warn("Meeting notification warning:", notifyErr.message);
      }

      res.status(201).json({
        success: true,
        message: "Association meeting scheduled successfully! Agenda and quorum tracking initialized.",
        meeting: newMeeting,
      });
    } catch (err) {
      console.error("CREATE MEETING ERROR:", err.message);
      res.status(500).json({ error: "Failed to schedule meeting" });
    }
  }
);

/* ======================================================
   ✏️ 3. UPDATE MEETING DETAILS & STATUS
====================================================== */
router.put(
  "/:id",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const {
        title,
        description,
        meeting_type,
        meeting_date,
        location,
        presided_by,
        convener,
        agenda,
        status,
        quorum_required_pct,
        minutes_text,
        join_link,
      } = req.body;

      const { rows } = await pool.query(
        `
        UPDATE meetings
        SET title = COALESCE($1, title),
            description = COALESCE($2, description),
            meeting_type = COALESCE($3, meeting_type),
            meeting_date = COALESCE($4::timestamptz, meeting_date),
            location = COALESCE($5, location),
            presided_by = COALESCE($6, presided_by),
            convener = COALESCE($7, convener),
            agenda = COALESCE($8, agenda),
            status = COALESCE($9, status),
            quorum_required_pct = COALESCE($10, quorum_required_pct),
            minutes_text = COALESCE($11, minutes_text),
            join_link = COALESCE($12, join_link)
        WHERE id = $13
        RETURNING *
        `,
        [
          title,
          description,
          meeting_type,
          meeting_date,
          location,
          presided_by,
          convener,
          agenda,
          status,
          quorum_required_pct,
          minutes_text,
          join_link,
          req.params.id,
        ]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Meeting not found" });
      }

      res.json({ success: true, meeting: rows[0] });
    } catch (err) {
      console.error("UPDATE MEETING ERROR:", err.message);
      res.status(500).json({ error: "Failed to update meeting" });
    }
  }
);

/* ======================================================
   🗑 4. DELETE MEETING (SUPER ADMIN & PRESIDENT)
====================================================== */
router.delete(
  "/:id",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      await pool.query("DELETE FROM meetings WHERE id=$1", [req.params.id]);
      res.json({ success: true, message: "Meeting deleted successfully" });
    } catch (err) {
      console.error("DELETE MEETING ERROR:", err.message);
      res.status(500).json({ error: "Failed to delete meeting" });
    }
  }
);

/* ======================================================
   👥 5. ATTENDANCE & QUORUM CALCULATION
====================================================== */

// Get attendance roll call and calculate quorum
router.get("/attendance/:id", verifyToken, async (req, res) => {
  try {
    const meetingRes = await pool.query(
      "SELECT id, meeting_type, quorum_required_pct FROM meetings WHERE id=$1",
      [req.params.id]
    );

    if (!meetingRes.rows.length) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const meeting = meetingRes.rows[0];

    // Fetch all active association members with their attendance status for this meeting
    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.role,
        u.member_id AS association_id,
        u.phone,
        COALESCE(ma.status, 'ABSENT') AS attendance_status,
        ma.marked_at
      FROM users u
      LEFT JOIN meeting_attendance ma
        ON ma.user_id = u.id AND ma.meeting_id = $1
      WHERE u.status = 'ACTIVE' OR u.status IS NULL
      ORDER BY
        CASE
          WHEN u.role = 'PRESIDENT' THEN 1
          WHEN u.role = 'VICE_PRESIDENT' THEN 2
          WHEN u.role = 'GENERAL_SECRETARY' THEN 3
          WHEN u.role = 'SECRETARY' THEN 4
          WHEN u.role = 'JOINT_SECRETARY' THEN 5
          WHEN u.role = 'TREASURER' THEN 6
          WHEN u.role = 'EC_MEMBER' THEN 7
          ELSE 8
        END,
        u.name ASC
      `,
      [req.params.id]
    );

    const totalMembers = rows.length;
    const presentCount = rows.filter((r) => r.attendance_status === "PRESENT").length;
    const excusedCount = rows.filter((r) => r.attendance_status === "EXCUSED").length;
    const absentCount = totalMembers - presentCount - excusedCount;

    const quorumPct = meeting.quorum_required_pct || 67;
    const currentPct = totalMembers > 0 ? ((presentCount / totalMembers) * 100).toFixed(1) : 0;
    const quorumMet = Number(currentPct) >= quorumPct;
    const requiredPresentForQuorum = Math.ceil(totalMembers * (quorumPct / 100));

    res.json({
      meeting_id: Number(req.params.id),
      total_members: totalMembers,
      present_count: presentCount,
      absent_count: absentCount,
      excused_count: excusedCount,
      attendance_pct: Number(currentPct),
      quorum_required_pct: quorumPct,
      required_for_quorum: requiredPresentForQuorum,
      quorum_met: quorumMet,
      members: rows,
    });
  } catch (err) {
    console.error("ATTENDANCE ERROR:", err.message);
    res.status(500).json({ error: "Failed to load attendance roll call" });
  }
});

// Member Self Check-in / Join
router.post("/check-in/:id", verifyToken, async (req, res) => {
  try {
    await pool.query(
      `
      INSERT INTO meeting_attendance (meeting_id, user_id, status, marked_at)
      VALUES ($1, $2, 'PRESENT', NOW())
      ON CONFLICT (meeting_id, user_id)
      DO UPDATE SET status = 'PRESENT', marked_at = NOW()
      `,
      [req.params.id, req.user.id]
    );

    res.json({ success: true, message: "Attendance marked: PRESENT! Welcome to the meeting chamber." });
  } catch (err) {
    console.error("CHECK-IN ERROR:", err.message);
    res.status(500).json({ error: "Check-in failed" });
  }
});

// President / General Secretary Update Member Attendance
router.post(
  "/attendance/:id/update",
  verifyToken,
  checkRole(...ADMIN_ROLES, "GENERAL_SECRETARY", "SECRETARY"),
  async (req, res) => {
    try {
      const { user_id, status } = req.body;
      if (!user_id || !status) {
        return res.status(400).json({ error: "User ID and status are required" });
      }

      await pool.query(
        `
        INSERT INTO meeting_attendance (meeting_id, user_id, status, marked_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (meeting_id, user_id)
        DO UPDATE SET status = $3, marked_at = NOW()
        `,
        [req.params.id, user_id, status]
      );

      res.json({ success: true, message: `Attendance updated to ${status}` });
    } catch (err) {
      console.error("UPDATE ATTENDANCE ERROR:", err.message);
      res.status(500).json({ error: "Failed to update attendance" });
    }
  }
);

/* ======================================================
   📜 6. RESOLUTIONS & 2/3 SUPERMAJORITY VOTING
====================================================== */

// Get resolutions with live voting tally & 2/3 calculation
router.get("/resolution/:meetingId", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        r.*,
        u.name AS proposer_name,
        u.role AS proposer_role,
        (SELECT COUNT(*) FROM meeting_votes mv WHERE mv.resolution_id = r.id AND mv.vote = 'YES') AS yes_votes,
        (SELECT COUNT(*) FROM meeting_votes mv WHERE mv.resolution_id = r.id AND mv.vote = 'NO') AS no_votes,
        (SELECT COUNT(*) FROM meeting_votes mv WHERE mv.resolution_id = r.id AND mv.vote = 'ABSTAIN') AS abstain_votes,
        (SELECT COUNT(*) FROM meeting_votes mv WHERE mv.resolution_id = r.id) AS total_votes_cast,
        (SELECT mv.vote FROM meeting_votes mv WHERE mv.resolution_id = r.id AND mv.user_id = $2) AS user_vote
      FROM meeting_resolutions r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.meeting_id = $1
      ORDER BY r.created_at ASC
      `,
      [req.params.meetingId, req.user.id]
    );

    // Calculate 2/3 ratio and status for each resolution
    const resolutions = rows.map((r) => {
      const yes = Number(r.yes_votes) || 0;
      const no = Number(r.no_votes) || 0;
      const abstain = Number(r.abstain_votes) || 0;
      const total = Number(r.total_votes_cast) || 0;
      const activeVotes = yes + no;

      const yesPct = activeVotes > 0 ? Number(((yes / activeVotes) * 100).toFixed(1)) : 0;
      const noPct = activeVotes > 0 ? Number(((no / activeVotes) * 100).toFixed(1)) : 0;
      const isTwoThirdsMet = activeVotes > 0 && yesPct >= 66.67;

      return {
        ...r,
        yes_votes: yes,
        no_votes: no,
        abstain_votes: abstain,
        total_votes_cast: total,
        yes_percentage: yesPct,
        no_percentage: noPct,
        two_thirds_met: isTwoThirdsMet,
      };
    });

    res.json(resolutions);
  } catch (err) {
    console.error("GET RESOLUTIONS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch resolutions" });
  }
});

// Propose New Resolution (Super Admin, President, GS, Treasurer, EC)
router.post(
  "/resolution/:meetingId",
  verifyToken,
  checkRole(...ADMIN_ROLES, "GENERAL_SECRETARY", "TREASURER", "EC_MEMBER"),
  async (req, res) => {
    try {
      const {
        title,
        content,
        voting_rule = "TWO_THIRDS",
        quorum_required = 67,
        vote_deadline,
      } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: "Resolution title and text content are required" });
      }

      const deadline = vote_deadline || new Date(Date.now() + 48 * 60 * 60 * 1000);

      const { rows } = await pool.query(
        `
        INSERT INTO meeting_resolutions
        (meeting_id, title, content, voting_rule, quorum_required, vote_deadline, created_by, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'VOTING_OPEN')
        RETURNING *
        `,
        [
          req.params.meetingId,
          title.trim(),
          content.trim(),
          voting_rule,
          Number(quorum_required) || 67,
          deadline,
          req.user.id,
        ]
      );

      res.status(201).json({
        success: true,
        message: "Resolution tabled for voting! Eligible members can now cast their votes.",
        resolution: rows[0],
      });
    } catch (err) {
      console.error("CREATE RESOLUTION ERROR:", err.message);
      res.status(500).json({ error: "Failed to create resolution" });
    }
  }
);

// Cast Vote on Resolution (YES, NO, ABSTAIN)
router.post("/vote/:rid", verifyToken, async (req, res) => {
  try {
    const { vote } = req.body;
    if (!vote || !["YES", "NO", "ABSTAIN"].includes(vote)) {
      return res.status(400).json({ error: "Invalid vote. Allowed values: YES, NO, ABSTAIN" });
    }

    const resCheck = await pool.query(
      "SELECT * FROM meeting_resolutions WHERE id=$1",
      [req.params.rid]
    );

    if (!resCheck.rows.length) {
      return res.status(404).json({ error: "Resolution not found" });
    }

    const resolution = resCheck.rows[0];

    if (resolution.is_locked || resolution.status === "APPROVED" || resolution.status === "REJECTED") {
      return res.status(403).json({ error: "Voting on this resolution is closed and finalized." });
    }

    await pool.query(
      `
      INSERT INTO meeting_votes (resolution_id, user_id, vote, created_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (resolution_id, user_id)
      DO UPDATE SET vote = $3, created_at = NOW()
      `,
      [req.params.rid, req.user.id, vote]
    );

    // Auto-check 2/3 threshold in background
    finalizeResolutionTally(req.params.rid).catch((err) =>
      console.warn("Auto tally error:", err.message)
    );

    res.json({
      success: true,
      message: `Your vote "${vote}" has been officially recorded in the association voting ledger.`,
    });
  } catch (err) {
    console.error("VOTE ERROR:", err.message);
    res.status(500).json({ error: "Failed to record vote" });
  }
});

// View Detailed Voter Breakdown for Resolution
router.get("/votes/:rid", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id AS user_id,
        u.name,
        u.role,
        u.member_id AS association_id,
        v.vote,
        v.created_at AS voted_at
      FROM meeting_votes v
      JOIN users u ON u.id = v.user_id
      WHERE v.resolution_id = $1
      ORDER BY v.created_at ASC
      `,
      [req.params.rid]
    );

    res.json(rows);
  } catch (err) {
    console.error("GET VOTES ERROR:", err.message);
    res.status(500).json({ error: "Failed to load voter breakdown" });
  }
});

// President Lock & Finalize Resolution
router.put(
  "/resolution-lock/:rid",
  verifyToken,
  checkRole(...ADMIN_ROLES),
  async (req, res) => {
    try {
      const { force_status } = req.body;
      const rid = Number(req.params.rid);
      if (!rid) {
        return res.status(400).json({ error: "Invalid resolution ID" });
      }

      const tally = await finalizeResolutionTally(rid, force_status);
      if (!tally) {
        return res.status(404).json({ error: "Resolution not found" });
      }

      res.json({
        success: true,
        message: `Resolution officially finalized with status: ${tally.status}`,
        resolution: tally,
      });
    } catch (err) {
      console.error("LOCK RESOLUTION ERROR:", err);
      res.status(500).json({ error: err.message || "Failed to lock resolution" });
    }
  }
);

/* ======================================================
   ⚖️ 7. RESOLUTION 2/3 SUPERMAJORITY TALLY HELPER
====================================================== */
async function finalizeResolutionTally(resolutionId, forceStatus = null) {
  const rid = Number(resolutionId);
  const resRow = await pool.query(
    "SELECT * FROM meeting_resolutions WHERE id=$1",
    [rid]
  );
  if (!resRow.rows.length) return null;
  const resData = resRow.rows[0];

  const votesRes = await pool.query(
    "SELECT vote FROM meeting_votes WHERE resolution_id=$1",
    [rid]
  );

  let yes = 0, no = 0, abstain = 0;
  votesRes.rows.forEach((v) => {
    if (v.vote === "YES") yes++;
    else if (v.vote === "NO") no++;
    else if (v.vote === "ABSTAIN") abstain++;
  });

  const activeVotes = yes + no;
  let status = forceStatus || resData.status || "VOTING_OPEN";

  if (!forceStatus && activeVotes > 0) {
    const isTwoThirds = resData.voting_rule === "TWO_THIRDS" || !resData.voting_rule;
    const requiredRatio = isTwoThirds ? 2 / 3 : 0.5;

    if (yes / activeVotes >= requiredRatio) {
      status = "APPROVED";
    } else if (no / activeVotes > 1 - requiredRatio) {
      status = "REJECTED";
    }
  }

  const isLocked = (status === "APPROVED" || status === "REJECTED");
  const approvedAt = status === "APPROVED" ? (resData.approved_at || new Date()) : null;

  const { rows } = await pool.query(
    `
    UPDATE meeting_resolutions
    SET status = $1,
        is_locked = $2,
        approved_at = $3
    WHERE id = $4
    RETURNING *
    `,
    [status, isLocked, approvedAt, rid]
  );

  return rows[0];
}

/* ======================================================
   📝 8. MINUTES OF MEETING (MoM) & STRUCTURED PRINT DATA
====================================================== */
router.post(
  "/minutes/:meetingId",
  verifyToken,
  checkRole(...ADMIN_ROLES, "GENERAL_SECRETARY"),
  async (req, res) => {
    try {
      const { minutes_text, status = "CONCLUDED" } = req.body;

      const { rows } = await pool.query(
        `
        UPDATE meetings
        SET minutes_text = $1,
            status = $2
        WHERE id = $3
        RETURNING *
        `,
        [minutes_text, status, req.params.meetingId]
      );

      res.json({
        success: true,
        message: "Minutes of the Meeting (MoM) successfully recorded and signed.",
        meeting: rows[0],
      });
    } catch (err) {
      console.error("SAVE MINUTES ERROR:", err.message);
      res.status(500).json({ error: "Failed to save minutes" });
    }
  }
);

// Structured Print Data (MoM, Quorum, Resolutions, Signatures)
router.get("/mom-print/:meetingId", verifyToken, async (req, res) => {
  try {
    const meetingRes = await pool.query("SELECT * FROM meetings WHERE id=$1", [
      req.params.meetingId,
    ]);
    if (!meetingRes.rows.length) {
      return res.status(404).json({ error: "Meeting not found" });
    }

    const meeting = meetingRes.rows[0];

    const [attendanceRes, resolutionsRes, signaturesRes] = await Promise.all([
      pool.query(
        `SELECT u.name, u.role, u.member_id, ma.status
         FROM users u
         JOIN meeting_attendance ma ON ma.user_id = u.id AND ma.meeting_id = $1
         ORDER BY u.name`,
        [req.params.meetingId]
      ),
      pool.query(
        `SELECT r.*,
          (SELECT COUNT(*) FROM meeting_votes mv WHERE mv.resolution_id = r.id AND mv.vote = 'YES') AS yes_votes,
          (SELECT COUNT(*) FROM meeting_votes mv WHERE mv.resolution_id = r.id AND mv.vote = 'NO') AS no_votes
         FROM meeting_resolutions r
         WHERE r.meeting_id = $1
         ORDER BY r.id`,
        [req.params.meetingId]
      ),
      pool.query("SELECT * FROM association_settings ORDER BY id DESC LIMIT 1"),
    ]);

    const sig = signaturesRes.rows[0] || {};

    res.json({
      meeting,
      attendance: attendanceRes.rows,
      resolutions: resolutionsRes.rows,
      signatures: {
        president_signature_url: sig.president_signature_url,
        gs_signature_url: sig.gs_signature_url,
        treasurer_signature_url: sig.treasurer_signature_url,
        association_seal_url: sig.association_seal_url,
      },
    });
  } catch (err) {
    console.error("MOM PRINT DATA ERROR:", err.message);
    res.status(500).json({ error: "Failed to load MoM print data" });
  }
});

module.exports = router;

