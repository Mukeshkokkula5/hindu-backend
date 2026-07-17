const generateMemberCode = async (pool) => {
  const result = await pool.query(`
    SELECT COUNT(*) 
    FROM users 
    WHERE member_code IS NOT NULL
  `);

  const next = Number(result.rows[0].count) + 1;

  return `HSY/JGTL/2026/${String(next).padStart(4, "0")}`;
};

module.exports = generateMemberCode;
