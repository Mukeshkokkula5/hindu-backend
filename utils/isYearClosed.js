const pool = require("../db");

module.exports = async function isYearClosed(year) {
  const result = await pool.query(
    `SELECT status
     FROM financial_years
     WHERE year = $1
     LIMIT 1`,
    [year]
  );

  // ❗ No record means CLOSED by default
  if (result.rowCount === 0) {
    return true;
  }

  return result.rows[0].status !== "OPEN";
};
