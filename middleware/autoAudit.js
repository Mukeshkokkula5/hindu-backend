const logAudit = require("../utils/auditLogger");

/**
 * Auto Audit Middleware
 *
 * @param {string} action   CREATE | UPDATE | DELETE | APPROVE | LOGIN
 * @param {string} entity   EXPENSE | MEMBER | FUND | USER | etc
 * @param {function|null} getEntityId (req, res) => entityId
 * @param {function|null} getMeta (req, res) => metadata
 */
module.exports = function autoAudit(
  action,
  entity,
  getEntityId = null,
  getMeta = null
) {
  return async (req, res, next) => {
    res.on("finish", async () => {
      try {
        // Log only successful operations
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const entityId = getEntityId ? getEntityId(req, res) : null;
          const metadata = getMeta ? getMeta(req, res) : null;

          await logAudit(
            action,
            entity,
            entityId,
            req.user || null,
            metadata
          );
        }
      } catch (err) {
        console.error("AUTO AUDIT ERROR 👉", err.message);
      }
    });

    next();
  };
};
