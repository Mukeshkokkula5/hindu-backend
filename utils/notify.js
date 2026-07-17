const pool = require("../db");

async function notifyUsers(userIds, title, message, link = null) {
  for (const uid of userIds) {
    await pool.query(
      `INSERT INTO notifications (user_id,title,message,link)
       VALUES ($1,$2,$3,$4)`,
      [uid, title, message, link]
    );
  }
}

module.exports = notifyUsers;
