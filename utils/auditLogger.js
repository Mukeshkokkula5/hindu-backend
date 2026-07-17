const pool = require("../db");

/**
 * =====================================================
 * FINAL AUDIT LOGGER (PRODUCTION SAFE)
 * =====================================================
 *
 * TABLE: audit_logs
 * -----------------------------------------------------
 * id            UUID DEFAULT gen_random_uuid()
 * action        TEXT NOT NULL
 * entity        TEXT
 * entity_id     INTEGER
 * performed_by  VARCHAR
 * user_id       UUID NOT NULL
 * metadata      JSONB
 * created_at    TIMESTAMP DEFAULT NOW()
 * -----------------------------------------------------
 */

module.exports = async function logAudit(
  action,
  entity,
  entityId = null,
  user,
  metadata = {}
) {
  try {
    let userId = null;
    let performedBy = "SYSTEM";

    if (user) {
      if (typeof user === "object") {
        userId = user.id;
        performedBy = user.name || user.username || "SYSTEM";
      } else {
        userId = user;
      }
    }

    if (!userId) {
      console.warn("Audit skipped: missing user or user id");
      return;
    }

    // If we only have the ID, resolve performed_by from the users table
    if (performedBy === "SYSTEM" && userId) {
      try {
        const u = await pool.query("SELECT name, username FROM users WHERE id = $1", [userId]);
        if (u.rowCount > 0) {
          performedBy = u.rows[0].name || u.rows[0].username || "SYSTEM";
        }
      } catch (err) {
        console.error("Audit lookup user error 👉", err.message);
      }
    }

    await pool.query(
      `
      INSERT INTO audit_logs
        (action, entity, entity_id, performed_by, user_id, metadata)
      VALUES
        ($1, $2, $3, $4, $5, $6)
      `,
      [
        action,
        entity,
        entityId,
        performedBy,
        userId,
        metadata,
      ]
    );
  } catch (err) {
    console.error("AUDIT LOG ERROR 👉", err.message);
  }
};
