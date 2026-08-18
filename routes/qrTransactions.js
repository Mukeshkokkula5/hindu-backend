const express = require("express");
const router = express.Router();
const pool = require("../db");

const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");

/* =====================================================
   1️⃣ SUBMIT QR TRANSACTION (PUBLIC)
   POST /qr-transactions/submit
===================================================== */
router.post("/submit", async (req, res) => {
  try {
    const { payer_name, amount, transaction_id } = req.body;

    if (!payer_name || !amount || !transaction_id) {
      return res.status(400).json({ error: "Missing required fields (payer_name, amount, transaction_id)" });
    }

    await pool.query(
      `
      INSERT INTO qr_transactions (payer_name, amount, transaction_id, status)
      VALUES ($1, $2, $3, 'PENDING')
      `,
      [payer_name, amount, transaction_id]
    );

    res.status(201).json({ message: "Transaction submitted successfully. Pending admin verification." });
  } catch (err) {
    console.error("QR TRANSACTION SUBMIT ERROR 👉", err.message);
    if (err.code === '23505') {
       return res.status(400).json({ error: "Transaction ID already exists." });
    }
    res.status(500).json({ error: "Failed to submit transaction" });
  }
});

/* =====================================================
   2️⃣ GET ALL QR TRANSACTIONS (ADMIN/TREASURER)
   GET /qr-transactions/all
===================================================== */
router.get("/all", verifyToken, checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM qr_transactions ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("QR TRANSACTION GET ALL ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

/* =====================================================
   3️⃣ UPDATE TRANSACTION STATUS (ADMIN/TREASURER)
   PUT /qr-transactions/:id/status
===================================================== */
router.put("/:id/status", verifyToken, checkRole("TREASURER", "SUPER_ADMIN", "PRESIDENT"), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; 

    if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be APPROVED or REJECTED." });
    }

    await pool.query(
      `UPDATE qr_transactions SET status = $1 WHERE id = $2`,
      [status, id]
    );
    res.json({ message: `Transaction marked as ${status}` });
  } catch (err) {
    console.error("QR TRANSACTION UPDATE STATUS ERROR 👉", err.message);
    res.status(500).json({ error: "Failed to update transaction status" });
  }
});

module.exports = router;
