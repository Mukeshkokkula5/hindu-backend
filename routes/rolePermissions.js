const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const logAudit = require("../utils/auditLogger");

/* =====================================================
   DEFAULT RECOMMENDED PERMISSIONS BY ROLE
===================================================== */
const DEFAULT_ROLE_PERMISSIONS = {
  PRESIDENT: [
    "overview",
    "members",
    "meetings",
    "elections",
    "subscriptions",
    "funds",
    "donations",
    "expenses",
    "reports",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "member_credit_loans",
    "aapadbandhava",
    "all_pages_cms",
    "team_posts",
    "navaratri",
    "id_card",
    "change_password",
    "logs",
  ],
  VICE_PRESIDENT: [
    "overview",
    "members",
    "meetings",
    "elections",
    "subscriptions",
    "funds",
    "donations",
    "expenses",
    "reports",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "aapadbandhava",
    "team_posts",
    "navaratri",
    "id_card",
    "change_password",
  ],
  GENERAL_SECRETARY: [
    "overview",
    "members",
    "meetings",
    "elections",
    "subscriptions",
    "donations",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "aapadbandhava",
    "team_posts",
    "navaratri",
    "id_card",
    "change_password",
  ],
  JOINT_SECRETARY: [
    "overview",
    "members",
    "meetings",
    "elections",
    "subscriptions",
    "donations",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "aapadbandhava",
    "id_card",
    "change_password",
  ],
  TREASURER: [
    "overview",
    "funds",
    "expenses",
    "donations",
    "subscriptions",
    "member_credit_loans",
    "reports",
    "meetings",
    "elections",
    "complaints",
    "suggestions",
    "id_card",
    "change_password",
  ],
  EC_MEMBER: [
    "overview",
    "members",
    "meetings",
    "elections",
    "subscriptions",
    "donations",
    "expenses",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "aapadbandhava",
    "id_card",
    "change_password",
  ],
  MEMBER: [
    "pay_donation",
    "donation_history",
    "subscriptions",
    "member_credit_loans",
    "meetings",
    "elections",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "aapadbandhava",
    "id_card",
    "change_password",
  ],
  VOLUNTEER: [
    "pay_donation",
    "donation_history",
    "meetings",
    "elections",
    "complaints",
    "suggestions",
    "volunteers",
    "blood_seva",
    "aapadbandhava",
    "id_card",
    "change_password",
  ],
};

/* =====================================================
   1️⃣ GET ALL ROLE PERMISSIONS (PUBLIC/AUTHENTICATED)
===================================================== */
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT role, permissions FROM role_permissions"
    );

    const permissionsMap = { ...DEFAULT_ROLE_PERMISSIONS };

    result.rows.forEach((row) => {
      if (row.role && Array.isArray(row.permissions)) {
        permissionsMap[row.role] = row.permissions;
      }
    });

    res.json({
      success: true,
      data: permissionsMap,
    });
  } catch (err) {
    console.error("GET ROLE PERMISSIONS ERROR 👉", err.message);
    res.json({
      success: true,
      data: DEFAULT_ROLE_PERMISSIONS,
    });
  }
});

/* =====================================================
   2️⃣ UPDATE ROLE PERMISSIONS (SUPER_ADMIN ONLY)
===================================================== */
router.put(
  "/",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    try {
      const { role, permissions, permissionsMap } = req.body;

      if (permissionsMap && typeof permissionsMap === "object") {
        for (const [rKey, pList] of Object.entries(permissionsMap)) {
          if (rKey === "SUPER_ADMIN") continue; // Super admin always has 100% access
          await pool.query(
            `INSERT INTO role_permissions (role, permissions, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (role)
             DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
            [rKey, JSON.stringify(Array.isArray(pList) ? pList : [])]
          );
        }
      } else if (role && Array.isArray(permissions)) {
        if (role === "SUPER_ADMIN") {
          return res.status(400).json({ error: "Super Admin permissions cannot be restricted" });
        }
        await pool.query(
          `INSERT INTO role_permissions (role, permissions, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role)
           DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
          [role, JSON.stringify(permissions)]
        );
      } else {
        return res.status(400).json({ error: "Invalid role or permissions payload" });
      }

      try {
        await logAudit("UPDATE_ROLE_PERMISSIONS", "ROLE_PERMISSIONS", 1, req.user.id);
      } catch (_) {}

      // Fetch fresh updated map
      const fresh = await pool.query("SELECT role, permissions FROM role_permissions");
      const updatedMap = { ...DEFAULT_ROLE_PERMISSIONS };
      fresh.rows.forEach((row) => {
        if (row.role && Array.isArray(row.permissions)) {
          updatedMap[row.role] = row.permissions;
        }
      });

      res.json({
        success: true,
        message: "Role permissions updated successfully! 🔐",
        data: updatedMap,
      });
    } catch (err) {
      console.error("UPDATE ROLE PERMISSIONS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to update role permissions" });
    }
  }
);

/* =====================================================
   3️⃣ RESET TO RECOMMENDED DEFAULTS (SUPER_ADMIN ONLY)
===================================================== */
router.post(
  "/reset-defaults",
  verifyToken,
  checkRole("SUPER_ADMIN"),
  async (req, res) => {
    try {
      for (const [rKey, pList] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        await pool.query(
          `INSERT INTO role_permissions (role, permissions, updated_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (role)
           DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = NOW()`,
          [rKey, JSON.stringify(pList)]
        );
      }

      res.json({
        success: true,
        message: "Role permissions reset to recommended system defaults! ✅",
        data: DEFAULT_ROLE_PERMISSIONS,
      });
    } catch (err) {
      console.error("RESET ROLE PERMISSIONS ERROR 👉", err.message);
      res.status(500).json({ error: "Failed to reset role permissions" });
    }
  }
);

module.exports = router;
