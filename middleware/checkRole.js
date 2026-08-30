const normalizeRole = (role) => {
  if (!role) return "";
  const r = role.toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (r === "SECRETARY") return "GENERAL_SECRETARY";
  if (r === "EC" || r === "EXECUTIVE" || r === "EXECUTIVE_COMMITTEE") return "EC_MEMBER";
  return r;
};

module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: "Unauthorized: user not authenticated",
        });
      }

      if (!req.user.role) {
        return res.status(403).json({
          error: "Access denied: role not found",
        });
      }

      if (!allowedRoles || allowedRoles.length === 0) {
        return res.status(500).json({
          error: "Server error: no roles configured",
        });
      }

      const userRole = normalizeRole(req.user.role);
      const normalizedAllowed = allowedRoles.map(normalizeRole);

      // Super Admin and President always have full admin privileges unless explicitly restricted
      if (normalizedAllowed.includes("SUPER_ADMIN") && (userRole === "SUPER_ADMIN" || userRole === "PRESIDENT")) {
        return next();
      }

      if (!normalizedAllowed.includes(userRole)) {
        return res.status(403).json({
          error: "Access denied: insufficient permissions for role " + req.user.role,
        });
      }

      next();
    } catch (err) {
      return res.status(500).json({
        error: "Authorization error",
      });
    }
  };
};
