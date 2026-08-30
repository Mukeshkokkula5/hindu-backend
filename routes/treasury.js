const express = require("express");
const router = express.Router();
const pool = require("../db");
const jwt = require("jsonwebtoken");

const verifyToken = require("../middleware/verifyToken");

const normalizeRole = (role) => (role || "").toUpperCase().replace(/\s+/g, "_");

const isFinanceBearer = (req) => {
  const r = normalizeRole(req.user?.role);
  return ["SUPER_ADMIN", "PRESIDENT", "TREASURER", "GENERAL_SECRETARY"].includes(r);
};

/* ======================================================
   📦 AUTO-INIT DATABASE TABLES (VENDORS & TRANSFERS)
====================================================== */
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vendors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100) DEFAULT 'GENERAL',
        phone VARCHAR(50),
        upi_id VARCHAR(100),
        address TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cash_bank_transfers (
        id SERIAL PRIMARY KEY,
        transfer_type VARCHAR(50) NOT NULL, -- 'DEPOSIT_TO_BANK' or 'WITHDRAWAL_TO_CASH'
        amount NUMERIC(12, 2) NOT NULL,
        bank_name VARCHAR(100) DEFAULT 'Union Bank of India',
        transaction_ref VARCHAR(100),
        notes TEXT,
        recorded_by INT REFERENCES users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(50) DEFAULT 'CASH';
      ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vendor_id INT REFERENCES vendors(id) ON DELETE SET NULL;
    `);

    // Seed sample initial vendors if empty
    const vendorCount = await pool.query("SELECT COUNT(*) FROM vendors");
    if (parseInt(vendorCount.rows[0].count, 10) === 0) {
      await pool.query(`
        INSERT INTO vendors (name, category, phone, upi_id, address, notes)
        VALUES
          ('Sri Sai Tent House & Lighting', 'TENT_HOUSE', '9848012345', 'srisaitents@upi', 'Tower Circle, Jagtial', 'Stage, sound, shamiana & festival lighting'),
          ('Ganesh Printing Press', 'PRINTING', '9440112233', 'ganeshprint@upi', 'Main Road, Jagtial', 'Receipt books, banners, ID cards & letterheads'),
          ('Mahalaxmi Flower & Puja Stores', 'PUJA_SAMAGRI', '9988776655', 'mahalaxmipuja@upi', 'Temple Street, Jagtial', 'Puja flowers, garlanding & havan materials'),
          ('Swaraj Community Caterers', 'CATERING', '9876543210', 'swarajfood@upi', 'Gandhi Nagar, Jagtial', 'Annadanam preparation & meeting refreshments'),
          ('CloudWave IT & Web Hosting', 'TECH_HOSTING', '8499878425', 'cloudwave@upi', 'Hyderabad', 'Domain, cloud servers, WhatsApp API & email gateways')
        ON CONFLICT DO NOTHING;
      `);
    }
  } catch (err) {
    console.warn("Treasury Table Init Notice:", err.message);
  }
})();

/* ======================================================
   💵 1. CASH-IN-HAND VS BANK BALANCE RECONCILIATION SUMMARY
   GET /treasury/cash-bank-summary
====================================================== */
router.get("/cash-bank-summary", verifyToken, async (req, res) => {
  try {
    // 1. Total Contributions / Donations
    const contribRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN payment_mode ILIKE '%CASH%' THEN amount ELSE 0 END), 0) as cash_donations,
        COALESCE(SUM(CASE WHEN payment_mode NOT ILIKE '%CASH%' THEN amount ELSE 0 END), 0) as bank_donations,
        COALESCE(SUM(amount), 0) as total_donations
      FROM contributions
      WHERE status = 'APPROVED' OR status = 'SUCCESS'
    `);
    const cashDonations = Number(contribRes.rows[0]?.cash_donations || 0);
    const bankDonations = Number(contribRes.rows[0]?.bank_donations || 0);

    // 2. Total Monthly Subscriptions (dues)
    const subsRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN payment_mode = 'CASH' THEN amount ELSE 0 END), 0) as cash_subs,
        COALESCE(SUM(CASE WHEN payment_mode != 'CASH' AND payment_mode IS NOT NULL THEN amount ELSE 0 END), 0) as bank_subs,
        COALESCE(SUM(amount), 0) as total_subs
      FROM member_subscription_dues
      WHERE status = 'PAID'
    `);
    const cashSubs = Number(subsRes.rows[0]?.cash_subs || 0);
    const bankSubs = Number(subsRes.rows[0]?.bank_subs || 0);

    // 3. Total Approved Expenses
    const expRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN payment_mode ILIKE '%CASH%' OR payment_mode IS NULL THEN amount ELSE 0 END), 0) as cash_expenses,
        COALESCE(SUM(CASE WHEN payment_mode NOT ILIKE '%CASH%' AND payment_mode IS NOT NULL THEN amount ELSE 0 END), 0) as bank_expenses,
        COALESCE(SUM(amount), 0) as total_expenses
      FROM expenses
      WHERE status = 'APPROVED'
    `);
    const cashExpenses = Number(expRes.rows[0]?.cash_expenses || 0);
    const bankExpenses = Number(expRes.rows[0]?.bank_expenses || 0);

    // 4. Transfers between Cash and Bank
    const transferRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN transfer_type = 'DEPOSIT_TO_BANK' THEN amount ELSE 0 END), 0) as deposits_to_bank,
        COALESCE(SUM(CASE WHEN transfer_type = 'WITHDRAWAL_TO_CASH' THEN amount ELSE 0 END), 0) as withdrawals_to_cash
      FROM cash_bank_transfers
    `);
    const depositsToBank = Number(transferRes.rows[0]?.deposits_to_bank || 0);
    const withdrawalsToCash = Number(transferRes.rows[0]?.withdrawals_to_cash || 0);

    // Compute Net Physical Cash in Hand & Bank Balance
    const cashInflow = cashDonations + cashSubs + withdrawalsToCash;
    const cashOutflow = cashExpenses + depositsToBank;
    const cashInHand = Math.max(0, cashInflow - cashOutflow);

    const bankInflow = bankDonations + bankSubs + depositsToBank;
    const bankOutflow = bankExpenses + withdrawalsToCash;
    const bankBalance = Math.max(0, bankInflow - bankOutflow);

    const totalNetWorth = cashInHand + bankBalance;

    // Recent transfers log
    const recentTransfers = await pool.query(`
      SELECT t.*, u.name as recorded_by_name
      FROM cash_bank_transfers t
      LEFT JOIN users u ON u.id = t.recorded_by
      ORDER BY t.recorded_at DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      summary: {
        cash_in_hand: cashInHand,
        bank_balance: bankBalance,
        total_net_worth: totalNetWorth,
        breakdown: {
          cash: {
            donations: cashDonations,
            subscriptions: cashSubs,
            withdrawals_from_bank: withdrawalsToCash,
            expenses: cashExpenses,
            deposited_to_bank: depositsToBank,
            net_in_hand: cashInHand,
          },
          bank: {
            donations: bankDonations,
            subscriptions: bankSubs,
            cash_deposits: depositsToBank,
            expenses: bankExpenses,
            withdrawals_to_cash: withdrawalsToCash,
            net_balance: bankBalance,
          },
        },
      },
      recent_transfers: recentTransfers.rows,
    });
  } catch (err) {
    console.error("TREASURY SUMMARY ERROR:", err);
    res.status(500).json({ error: "Failed to calculate treasury summary" });
  }
});

/* ======================================================
   📑 2. TREASURER'S MONTHLY AUDIT BALANCE SHEET
   GET /treasury/balance-sheet?month_year=2026-08
====================================================== */
router.get("/balance-sheet", verifyToken, async (req, res) => {
  try {
    const targetMonth = req.query.month_year || new Date().toISOString().slice(0, 7);
    const startDate = `${targetMonth}-01`;
    
    // Calculate Next Month Date for boundary
    const [year, month] = targetMonth.split("-").map(Number);
    const nextMonthDate = new Date(year, month, 1).toISOString().slice(0, 10);

    // 1. OPENING BALANCE (Cumulative Inflow - Cumulative Outflow prior to startDate)
    const priorDonations = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as sum FROM contributions WHERE (status = 'APPROVED' OR status = 'SUCCESS') AND created_at < $1",
      [startDate]
    );
    const priorSubs = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as sum FROM member_subscription_dues WHERE status = 'PAID' AND month_year < $1",
      [targetMonth]
    );
    const priorExpenses = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as sum FROM expenses WHERE status = 'APPROVED' AND (expense_date < $1 OR (expense_date IS NULL AND created_at < $2))",
      [startDate, startDate]
    );
    const openingBalance = Math.max(
      0,
      Number(priorDonations.rows[0]?.sum || 0) +
      Number(priorSubs.rows[0]?.sum || 0) -
      Number(priorExpenses.rows[0]?.sum || 0)
    );

    // 2. MONTH INFLOWS
    const monthDonationsRes = await pool.query(
      `
      SELECT 
        COALESCE(f.fund_name, 'General Seva Fund') as category,
        COUNT(*) as count,
        COALESCE(SUM(c.amount), 0) as total
      FROM contributions c
      LEFT JOIN funds f ON f.id = c.fund_id
      WHERE (c.status = 'APPROVED' OR c.status = 'SUCCESS')
        AND c.created_at >= $1 AND c.created_at < $2
        AND (c.source IS NULL OR c.source NOT LIKE 'MONTHLY_SUBSCRIPTION%')
      GROUP BY f.fund_name
      `,
      [startDate, nextMonthDate]
    );

    const monthSubsRes = await pool.query(
      `
      SELECT 
        COUNT(*) as paid_count,
        COALESCE(SUM(amount), 0) as total
      FROM member_subscription_dues
      WHERE status = 'PAID' AND month_year = $1
      `,
      [targetMonth]
    );
    const monthSubsTotal = Number(monthSubsRes.rows[0]?.total || 0);

    let totalMonthInflow = monthSubsTotal;
    monthDonationsRes.rows.forEach((r) => {
      totalMonthInflow += Number(r.total || 0);
    });

    // 3. MONTH OUTFLOWS (Approved Expenses by Category)
    const monthExpensesRes = await pool.query(
      `
      SELECT 
        COALESCE(category, 'General Seva') as category,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total
      FROM expenses
      WHERE status = 'APPROVED'
        AND ((expense_date >= $1 AND expense_date < $2) OR (expense_date IS NULL AND created_at >= $1 AND created_at < $2))
      GROUP BY category
      `,
      [startDate, nextMonthDate]
    );

    let totalMonthOutflow = 0;
    monthExpensesRes.rows.forEach((r) => {
      totalMonthOutflow += Number(r.total || 0);
    });

    // 4. NET SURPLUS / DEFICIT & CLOSING BALANCE
    const netMonthlySurplus = totalMonthInflow - totalMonthOutflow;
    const closingBalance = openingBalance + netMonthlySurplus;

    // Signatures and Association Data
    const settingsRes = await pool.query("SELECT * FROM association_settings ORDER BY id DESC LIMIT 1");
    const settings = settingsRes.rows[0] || {};

    res.json({
      success: true,
      month_year: targetMonth,
      balance_sheet: {
        opening_balance: openingBalance,
        inflows: {
          monthly_subscriptions: {
            paid_count: Number(monthSubsRes.rows[0]?.paid_count || 0),
            total: monthSubsTotal,
          },
          donations_by_fund: monthDonationsRes.rows.map((r) => ({
            fund_name: r.category,
            count: Number(r.count),
            total: Number(r.total),
          })),
          total_inflow: totalMonthInflow,
        },
        outflows: {
          expenses_by_category: monthExpensesRes.rows.map((r) => ({
            category: r.category,
            count: Number(r.count),
            total: Number(r.total),
          })),
          total_outflow: totalMonthOutflow,
        },
        net_surplus_or_deficit: netMonthlySurplus,
        closing_balance: closingBalance,
      },
      association: {
        name: "HINDU SWARAJ YOUTH WELFARE ASSOCIATION",
        regd_no: "784/2025",
        act: "Telangana Societies Registration Act, 2001",
        address: "H.No. 4-1-140, Vani Nagar, Jagtial, Telangana - 505327",
        email: "hinduswarajyouth@gmail.com",
        signatures: {
          president_name: settings.president_name || "Vinodh Kumar K",
          president_signature_url: settings.president_signature_url || null,
          gs_name: settings.gs_name || "Mani Deep",
          gs_signature_url: settings.gs_signature_url || null,
          treasurer_name: settings.treasurer_name || "Treasurer",
          treasurer_signature_url: settings.treasurer_signature_url || null,
          association_seal_url: settings.association_seal_url || null,
        },
      },
    });
  } catch (err) {
    console.error("TREASURY BALANCE SHEET ERROR:", err);
    res.status(500).json({ error: "Failed to generate monthly balance sheet" });
  }
});

/* ======================================================
   🔄 3. LOG CASH TO BANK DEPOSIT / WITHDRAWAL
   POST /treasury/cash-bank-transfer
====================================================== */
router.post("/cash-bank-transfer", verifyToken, async (req, res) => {
  if (!isFinanceBearer(req)) {
    return res.status(403).json({ error: "Access denied: Only office bearers can record treasury transfers" });
  }

  try {
    const { transfer_type, amount, bank_name = "Union Bank of India", transaction_ref, notes } = req.body;

    if (!transfer_type || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "Transfer type and valid positive amount are required" });
    }

    if (!["DEPOSIT_TO_BANK", "WITHDRAWAL_TO_CASH"].includes(transfer_type)) {
      return res.status(400).json({ error: "Invalid transfer type. Use DEPOSIT_TO_BANK or WITHDRAWAL_TO_CASH" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO cash_bank_transfers (
        transfer_type, amount, bank_name, transaction_ref, notes, recorded_by, recorded_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
      `,
      [transfer_type, Number(amount), bank_name, transaction_ref || `TRF-${Date.now()}`, notes || "", req.user.id]
    );

    res.json({
      success: true,
      message: `✅ Transfer of ₹${amount} (${transfer_type === "DEPOSIT_TO_BANK" ? "Cash Deposited to Bank" : "Cash Withdrawn from Bank"}) logged successfully!`,
      transfer: rows[0],
    });
  } catch (err) {
    console.error("CASH BANK TRANSFER ERROR:", err);
    res.status(500).json({ error: "Failed to record cash/bank transfer" });
  }
});

/* ======================================================
   🏪 4. VENDOR / PAYEE DIRECTORY (CRUD)
====================================================== */

// Get all vendors
router.get("/vendors", verifyToken, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM vendors ORDER BY name ASC");
    res.json({ success: true, vendors: rows });
  } catch (err) {
    console.error("GET VENDORS ERROR:", err);
    res.status(500).json({ error: "Failed to load vendors" });
  }
});

// Create Vendor
router.post("/vendors", verifyToken, async (req, res) => {
  if (!isFinanceBearer(req)) {
    return res.status(403).json({ error: "Access denied: Only office bearers can manage vendors" });
  }

  try {
    const { name, category = "GENERAL", phone, upi_id, address, notes } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Vendor name is required" });
    }

    const { rows } = await pool.query(
      `
      INSERT INTO vendors (name, category, phone, upi_id, address, notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *
      `,
      [name, category, phone || null, upi_id || null, address || null, notes || null]
    );

    res.json({
      success: true,
      message: `✅ Vendor '${name}' successfully added to directory!`,
      vendor: rows[0],
    });
  } catch (err) {
    console.error("CREATE VENDOR ERROR:", err);
    res.status(500).json({ error: "Failed to add vendor" });
  }
});

// Delete Vendor
router.delete("/vendors/:id", verifyToken, async (req, res) => {
  if (!isFinanceBearer(req)) {
    return res.status(403).json({ error: "Access denied: Only office bearers can delete vendors" });
  }

  try {
    await pool.query("DELETE FROM vendors WHERE id = $1", [req.params.id]);
    res.json({ success: true, message: "Vendor deleted successfully" });
  } catch (err) {
    console.error("DELETE VENDOR ERROR:", err);
    res.status(500).json({ error: "Failed to delete vendor" });
  }
});

module.exports = router;
