const generateMemberCode = async (pool) => {
  const year = new Date().getFullYear();
  const prefix = `HSY/JGTL/${year}/`;

  const result = await pool.query(
    `
    SELECT member_id
    FROM users
    WHERE member_id LIKE $1
    ORDER BY member_id DESC
    LIMIT 1
    `,
    [`${prefix}%`]
  );

  let next = 1;
  if (result.rowCount > 0 && result.rows[0].member_id) {
    const parts = result.rows[0].member_id.split("/");
    const lastNum = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastNum)) {
      next = lastNum + 1;
    }
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
};

module.exports = generateMemberCode;
