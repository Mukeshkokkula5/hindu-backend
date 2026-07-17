const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const sendReceiptEmail = require("../utils/sendReceiptEmail");

/* =====================================================
   📊 TREASURER SUMMARY
===================================================== */
router.get("/summary",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN","PRESIDENT"),
  async (req,res)=>{
    try{
      const { rows } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE source='MEMBER') AS member_count,
          COUNT(*) FILTER (WHERE source='PUBLIC') AS public_count,
          COALESCE(SUM(amount) FILTER (WHERE status='APPROVED'),0) AS total_collection
        FROM contributions
      `);
      res.json(rows[0]);
    }catch(err){
      res.status(500).json({error:"Server error"});
    }
});

/* =====================================================
   📋 MEMBER PENDING
===================================================== */
router.get("/pending-members",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN","PRESIDENT"),
  async (req,res)=>{
    const { rows } = await pool.query(`
      SELECT c.id, c.amount, c.payment_mode, c.reference_no,
             c.created_at, u.name AS member_name, f.fund_name
      FROM contributions c
      JOIN users u ON u.id = c.member_id
      JOIN funds f ON f.id = c.fund_id
      WHERE c.status='PENDING' AND c.source='MEMBER'
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
});

/* =====================================================
   🌍 PUBLIC PENDING
===================================================== */
router.get("/pending-public",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN","PRESIDENT"),
  async (req,res)=>{
    const { rows } = await pool.query(`
      SELECT id, donor_name, amount, payment_mode, reference_no, created_at
      FROM contributions
      WHERE status='PENDING' AND source='PUBLIC'
      ORDER BY created_at DESC
    `);
    res.json(rows);
});

/* =====================================================
   ✅ APPROVE MEMBER
===================================================== */
router.patch("/approve-member/:id",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN"),
  async (req,res)=>{
    const client = await pool.connect();
    try{
      await client.query("BEGIN");

      const contRes = await client.query(
        `SELECT fund_id, amount FROM contributions WHERE id=$1 AND source='MEMBER' AND status='PENDING' FOR UPDATE`,
        [req.params.id]
      );

      if(!contRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({error:"Invalid or already processed"});
      }

      const { fund_id, amount } = contRes.rows[0];

      await client.query(`
        UPDATE contributions
        SET status='APPROVED',
            approved_by=$1,
            approved_at=NOW(),
            receipt_no = 'HYW-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(id::text,6,'0'),
            receipt_date = NOW(),
            qr_locked = true
        WHERE id=$2
      `,[req.user.id, req.params.id]);

      // Calculate new balance
      const balRes = await client.query(
        `SELECT COALESCE(balance_after,0) AS balance FROM ledger WHERE fund_id=$1 ORDER BY id DESC LIMIT 1`,
        [fund_id]
      );
      const currentBalance = balRes.rows.length > 0 ? Number(balRes.rows[0].balance) : 0;
      const newBalance = currentBalance + Number(amount);

      // Insert CREDIT entry into ledger
      await client.query(
        `INSERT INTO ledger (entry_type, source, source_id, fund_id, amount, balance_after, created_by)
         VALUES ('CREDIT', 'CONTRIBUTION', $1, $2, $3, $4, $5)`,
        [req.params.id, fund_id, amount, newBalance, req.user.id]
      );

      await client.query("COMMIT");
      res.json({message:"Member donation approved"});
    }catch(e){
      await client.query("ROLLBACK");
      res.status(500).json({error:e.message});
    }finally{
      client.release();
    }
});

/* =====================================================
   ✅ APPROVE PUBLIC (RECEIPT + EMAIL)
===================================================== */
router.patch("/approve-public/:id",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN"),
  async (req,res)=>{
    const client = await pool.connect();
    try{
      await client.query("BEGIN");

      const contRes = await client.query(
        `SELECT fund_id, amount FROM contributions WHERE id=$1 AND source != 'MEMBER' AND status='PENDING' FOR UPDATE`,
        [req.params.id]
      );

      if(!contRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(400).json({error:"Invalid or already processed"});
      }

      const { fund_id, amount } = contRes.rows[0];

      const updateRes = await client.query(`
        UPDATE contributions
        SET status='APPROVED',
            approved_by=$1,
            approved_at=NOW(),
            receipt_no = 'HYW-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(id::text,6,'0'),
            receipt_date = NOW(),
            qr_locked = true
        WHERE id=$2
        RETURNING donor_email, donor_name, receipt_no, amount, fund_id, receipt_date
      `,[req.user.id, req.params.id]);

      // Calculate new balance
      const balRes = await client.query(
        `SELECT COALESCE(balance_after,0) AS balance FROM ledger WHERE fund_id=$1 ORDER BY id DESC LIMIT 1`,
        [fund_id]
      );
      const currentBalance = balRes.rows.length > 0 ? Number(balRes.rows[0].balance) : 0;
      const newBalance = currentBalance + Number(amount);

      // Insert CREDIT entry into ledger
      await client.query(
        `INSERT INTO ledger (entry_type, source, source_id, fund_id, amount, balance_after, created_by)
         VALUES ('CREDIT', 'CONTRIBUTION', $1, $2, $3, $4, $5)`,
        [req.params.id, fund_id, amount, newBalance, req.user.id]
      );

      const fund = await client.query("SELECT fund_name FROM funds WHERE id=$1",[fund_id]);

      try {
        await sendReceiptEmail({
          ...updateRes.rows[0],
          fund_name: fund.rows[0].fund_name
        });
      } catch (emailErr) {
        console.warn("Receipt email failed to send, proceeding with approval:", emailErr.message);
      }

      await client.query("COMMIT");
      res.json({
        message:"Public donation approved and receipt emailed",
        receipt: updateRes.rows[0].receipt_no
      });
    }catch(e){
      await client.query("ROLLBACK");
      console.error(e);
      res.status(500).json({error:"Approve or email failed: " + e.message});
    }finally{
      client.release();
    }
});

/* =====================================================
   ❌ REJECT MEMBER
===================================================== */
router.patch("/reject-member/:id",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN"),
  async (req,res)=>{
    const { reason } = req.body;
    if(!reason) return res.status(400).json({error:"Reason required"});

    const { rowCount } = await pool.query(`
      UPDATE contributions
      SET status='REJECTED',
          cancel_reason=$1,
          cancelled_by=$2,
          cancelled_at=NOW()
      WHERE id=$3 AND source='MEMBER' AND status='PENDING'
    `,[reason, req.user.id, req.params.id]);

    if(!rowCount)
      return res.status(400).json({error:"Invalid or already processed"});

    res.json({message:"Member donation rejected"});
});

/* =====================================================
   ❌ REJECT PUBLIC
===================================================== */
router.patch("/reject-public/:id",
  verifyToken,
  checkRole("TREASURER","SUPER_ADMIN"),
  async (req,res)=>{
    const { reason } = req.body;
    if(!reason) return res.status(400).json({error:"Reason required"});

    const { rowCount } = await pool.query(`
      UPDATE contributions
      SET status='REJECTED',
          cancel_reason=$1,
          cancelled_by=$2,
          cancelled_at=NOW()
      WHERE id=$3 AND source != 'MEMBER' AND status='PENDING'
    `,[reason, req.user.id, req.params.id]);

    if(!rowCount)
      return res.status(400).json({error:"Invalid or already processed"});

    res.json({message:"Public donation rejected"});
});

module.exports = router;
