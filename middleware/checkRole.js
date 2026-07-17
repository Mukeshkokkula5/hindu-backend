module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      // 1. Ensure authentication middleware ran
      if (!req.user) {
        return res.status(401).json({
          error: "Unauthorized: user not authenticated",
        });
      }

      // 2. Ensure user role exists
      if (!req.user.role) {
        return res.status(403).json({
          error: "Access denied: role not found",
        });
      }

      // 3. Ensure roles were provided to middleware
      if (!allowedRoles || allowedRoles.length === 0) {
        return res.status(500).json({
          error: "Server error: no roles configured",
        });
      }

      // 4. Check if user role is allowed
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: "Access denied: insufficient permissions",
        });
      }

      // 5. Allow access
      next();
    } catch (err) {
      return res.status(500).json({
        error: "Authorization error",
      });
    }
  };
};
