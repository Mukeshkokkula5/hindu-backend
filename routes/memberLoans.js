const express = require("express");
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const checkRole = require("../middleware/checkRole");
const sendMail = require("../utils/sendMail");

const router = express.Router();

/* =====================================================
   📊 1. GET MCP BUDGET POOLS OVERVIEW & ALLOCATION METRICS
   GET /loans/pools-overview
===================================================== */
router.get("/pools-overview", async (req, res) => {
  try {
    const { year = 2026 } = req.query;
    const fiscalYear = Number(year) || 2026;

    // Fetch budget settings for all years
    const settingsRes = await pool.query(
      "SELECT * FROM mcp_budget_settings ORDER BY fiscal_year ASC"
    );
    const allSettings = settingsRes.rows;
    const currentSetting =
      allSettings.find((s) => s.fiscal_year === fiscalYear) || allSettings[0] || {
        fiscal_year: 2026,
        monthly_fee: 216.0,
        active_members: 30,
        emergency_pct: 15.0,
        loan_pct: 10.0,
        operations_pct: 75.0,
        max_emergency_cap: 3000.0,
        max_loan_cap: 3000.0,
      };

    const monthlyFee = Number(currentSetting.monthly_fee);
    const activeMembers = Number(currentSetting.active_members || 30);
    const annualBasePool = monthlyFee * activeMembers * 12; // e.g. 216 * 30 * 12 = 77760

    // Fetch actual collected subscriptions from subscriptions table
    const subsRes = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total_collected, COUNT(*) as total_payments 
       FROM member_subscription_dues 
       WHERE status = 'PAID'`
    );
    const actualCollected = Number(subsRes.rows[0]?.total_collected || 0);

    // Compute Pools
    const emergencyPct = Number(currentSetting.emergency_pct) / 100;
    const loanPct = Number(currentSetting.loan_pct) / 100;
    const opsPct = Number(currentSetting.operations_pct) / 100;

    // Budgeted vs Actual Pools
    const emergencyBudgeted = annualBasePool * emergencyPct; // ₹11,664
    const loanBudgeted = annualBasePool * loanPct; // ₹7,776
    const operationsBudgeted = annualBasePool * opsPct; // ₹58,320

    // Disbursed emergency grants
    const grantRes = await pool.query(
      `SELECT COALESCE(SUM(grant_amount), 0) as total_disbursed, COUNT(*) as count 
       FROM member_emergency_grants 
       WHERE voting_status = 'DISBURSED'`
    );
    const emergencyDisbursed = Number(grantRes.rows[0]?.total_disbursed || 0);

    // Loans Disbursed & Repaid
    const loansRes = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN status IN ('DISBURSED', 'ACTIVE', 'REPAID') THEN loan_amount ELSE 0 END), 0) as total_disbursed,
        COALESCE(SUM(CASE WHEN status IN ('DISBURSED', 'ACTIVE') THEN outstanding_balance ELSE 0 END), 0) as total_outstanding,
        COALESCE(SUM(total_repaid), 0) as total_repaid,
        COUNT(CASE WHEN status IN ('DISBURSED', 'ACTIVE') THEN 1 END) as active_loans_count
       FROM member_credit_loans`
    );
    const loanDisbursed = Number(loansRes.rows[0]?.total_disbursed || 0);
    const loanOutstanding = Number(loansRes.rows[0]?.total_outstanding || 0);
    const loanRepaid = Number(loansRes.rows[0]?.total_repaid || 0);
    const activeLoansCount = Number(loansRes.rows[0]?.active_loans_count || 0);

    // Dynamic Available Liquidity (Budgeted + Repayments - Active Disbursed)
    const emergencyAvailable = Math.max(0, emergencyBudgeted - emergencyDisbursed);
    const loanAvailable = Math.max(0, loanBudgeted + loanRepaid - loanDisbursed);

    res.json({
      success: true,
      fiscal_year: fiscalYear,
      current_settings: currentSetting,
      all_matrix: allSettings,
      summary: {
        active_members: activeMembers,
        monthly_fee: monthlyFee,
        annual_base_pool: annualBasePool,
        actual_collected: actualCollected,
        emergency_pool: {
          percentage: currentSetting.emergency_pct,
          budgeted: emergencyBudgeted,
          disbursed: emergencyDisbursed,
          available: emergencyAvailable,
          max_cap_per_person: Number(currentSetting.max_emergency_cap || 3000),
        },
        loan_pool: {
          percentage: currentSetting.loan_pct,
          budgeted: loanBudgeted,
          disbursed: loanDisbursed,
          repaid: loanRepaid,
          outstanding: loanOutstanding,
          available: loanAvailable,
          active_loans_count: activeLoansCount,
          max_cap_per_person: Number(currentSetting.max_loan_cap || 3000),
        },
        operations_pool: {
          percentage: currentSetting.operations_pct,
          budgeted: operationsBudgeted,
        },
      },
    });
  } catch (err) {
    console.error("Pools Overview Error:", err);
    res.status(500).json({ success: false, error: "Failed to compute pool metrics: " + err.message });
  }
});

/* =====================================================
   🔍 2. GET LOGGED-IN MEMBER'S LOAN ELIGIBILITY STATUS
   GET /loans/my-eligibility
===================================================== */
router.get("/my-eligibility", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check user profile
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const user = userRes.rows[0];

    // Check subscriptions paid count
    const subsRes = await pool.query(
      `SELECT COUNT(*)::int as months_paid, COALESCE(SUM(amount), 0)::numeric as total_paid
       FROM member_subscription_dues
       WHERE user_id = $1 AND status = 'PAID'`,
      [userId]
    );

    const monthsPaid = Number(subsRes.rows[0]?.months_paid || 0);
    const totalPaid = Number(subsRes.rows[0]?.total_paid || 0);
    const REQUIRED_MONTHS = 12;

    const isEligible = monthsPaid >= REQUIRED_MONTHS || totalPaid >= 2592; // 216 * 12

    // Check active loan
    const activeLoanRes = await pool.query(
      `SELECT * FROM member_credit_loans 
       WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED', 'DISBURSED', 'ACTIVE')
       ORDER BY id DESC LIMIT 1`,
      [userId]
    );
    const activeLoan = activeLoanRes.rows[0] || null;

    // Current year cap
    const settingsRes = await pool.query(
      "SELECT max_loan_cap FROM mcp_budget_settings WHERE fiscal_year = 2026 LIMIT 1"
    );
    const maxLoanCap = Number(settingsRes.rows[0]?.max_loan_cap || 3000);

    res.json({
      success: true,
      eligibility: {
        user_id: user.id,
        name: user.name,
        role: user.role,
        months_paid: monthsPaid,
        required_months: REQUIRED_MONTHS,
        months_remaining: Math.max(0, REQUIRED_MONTHS - monthsPaid),
        total_subscription_paid: totalPaid,
        is_eligible: isEligible && !activeLoan,
        eligibility_reason: !isEligible
          ? `Requires 12 consecutive months of subscription (${monthsPaid}/${REQUIRED_MONTHS} completed).`
          : activeLoan
          ? "You have an existing active credit loan in progress."
          : `Eligible for up to ₹${maxLoanCap} Micro-Credit Loan.`,
        max_eligible_amount: isEligible ? maxLoanCap : 0,
        has_active_loan: !!activeLoan,
        active_loan: activeLoan,
      },
    });
  } catch (err) {
    console.error("Eligibility Check Error:", err);
    res.status(500).json({ success: false, error: "Failed to check eligibility: " + err.message });
  }
});

/* =====================================================
   📝 3. APPLY FOR MEMBER CREDIT LOAN
   POST /loans/apply
===================================================== */
router.post("/apply", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { loan_amount, purpose, tenure_months = 6, notes = "" } = req.body;

    if (!loan_amount || !purpose) {
      return res.status(400).json({ success: false, error: "Loan amount and purpose are required." });
    }

    const amount = Number(loan_amount);
    const tenure = Number(tenure_months) || 6;

    if (amount <= 0) {
      return res.status(400).json({ success: false, error: "Invalid loan amount." });
    }

    // Check member profile & eligibility
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];

    const subsRes = await pool.query(
      "SELECT COUNT(*)::int as count, COALESCE(SUM(amount), 0)::numeric as total FROM member_subscription_dues WHERE user_id = $1 AND status = 'PAID'",
      [userId]
    );
    const monthsPaid = Number(subsRes.rows[0]?.count || 0);
    const totalPaid = Number(subsRes.rows[0]?.total || 0);

    if (monthsPaid < 12 && totalPaid < 2592 && user.role !== "SUPER_ADMIN" && user.role !== "PRESIDENT") {
      return res.status(400).json({
        success: false,
        error: `Membership requirement not met: You have completed ${monthsPaid}/12 months of subscriptions.`,
      });
    }

    // Check Safety Cap
    const settingsRes = await pool.query(
      "SELECT max_loan_cap FROM mcp_budget_settings WHERE fiscal_year = 2026 LIMIT 1"
    );
    const maxCap = Number(settingsRes.rows[0]?.max_loan_cap || 3000);

    if (amount > maxCap) {
      return res.status(400).json({
        success: false,
        error: `Requested amount (₹${amount}) exceeds safety cap of ₹${maxCap} for this fiscal year.`,
      });
    }

    // Check for active loan
    const activeRes = await pool.query(
      "SELECT id FROM member_credit_loans WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED', 'DISBURSED', 'ACTIVE')",
      [userId]
    );
    if (activeRes.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: "You already have an active loan application or outstanding balance.",
      });
    }

    const monthlyEmi = Math.round((amount / tenure) * 100) / 100;

    const insertRes = await pool.query(
      `
      INSERT INTO member_credit_loans (
        user_id, member_name, member_id, phone, loan_amount,
        purpose, tenure_months, monthly_emi, total_repaid,
        outstanding_balance, status, fiscal_year, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, 'PENDING', 2026, $10)
      RETURNING *
      `,
      [
        userId,
        user.name,
        user.member_id || `HSY-M-${userId}`,
        user.phone || "",
        amount,
        purpose.trim(),
        tenure,
        monthlyEmi,
        amount,
        notes ? notes.trim() : "",
      ]
    );

    res.status(201).json({
      success: true,
      message: `🎉 Micro-credit loan application for ₹${amount} submitted successfully! It is pending executive committee review.`,
      data: insertRes.rows[0],
    });
  } catch (err) {
    console.error("Loan Application Error:", err);
    res.status(500).json({ success: false, error: "Failed to submit application: " + err.message });
  }
});

/* =====================================================
   📜 4. GET LOGGED-IN MEMBER'S LOAN PASSBOOK
   GET /loans/my-loans
===================================================== */
router.get("/my-loans", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const loansRes = await pool.query(
      `SELECT l.*, 
        COALESCE(
          json_agg(r.* ORDER BY r.installment_number ASC) FILTER (WHERE r.id IS NOT NULL), '[]'
        ) as repayments
       FROM member_credit_loans l
       LEFT JOIN member_loan_repayments r ON l.id = r.loan_id
       WHERE l.user_id = $1
       GROUP BY l.id
       ORDER BY l.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: loansRes.rows,
    });
  } catch (err) {
    console.error("Fetch My Loans Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   👑 5. GET ALL LOANS & REPAYMENTS (ADMIN)
   GET /loans/admin/all
===================================================== */
router.get(
  "/admin/all",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "GENERAL_SECRETARY", "TREASURER", "AUDITOR"),
  async (req, res) => {
    try {
      const { status } = req.query;
      let query = `
        SELECT l.*, 
          COALESCE(
            json_agg(r.* ORDER BY r.installment_number ASC) FILTER (WHERE r.id IS NOT NULL), '[]'
          ) as repayments
        FROM member_credit_loans l
        LEFT JOIN member_loan_repayments r ON l.id = r.loan_id
      `;
      const params = [];

      if (status && status !== "ALL") {
        params.push(status);
        query += ` WHERE l.status = $${params.length}`;
      }

      query += ` GROUP BY l.id ORDER BY l.created_at DESC`;

      const result = await pool.query(query, params);
      res.json({
        success: true,
        data: result.rows,
      });
    } catch (err) {
      console.error("Admin Loans Fetch Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   ✓ 6. APPROVE LOAN APPLICATION (ADMIN)
   PUT /loans/admin/:id/approve
===================================================== */
router.put(
  "/admin/:id/approve",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const approverName = req.user.name || "Executive Committee";

      const updateRes = await pool.query(
        `UPDATE member_credit_loans 
         SET status = 'APPROVED', approved_by = $1, updated_at = NOW() 
         WHERE id = $2 AND status = 'PENDING'
         RETURNING *`,
        [approverName, id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(400).json({ success: false, error: "Loan record not found or not in PENDING state." });
      }

      res.json({
        success: true,
        message: "✅ Loan application approved! Ready for disbursal.",
        data: updateRes.rows[0],
      });
    } catch (err) {
      console.error("Approve Loan Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   💸 7. DISBURSE APPROVED LOAN (ADMIN)
   POST /loans/admin/:id/disburse
===================================================== */
router.post(
  "/admin/:id/disburse",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { disbursement_mode = "UPI", disbursement_ref = "", notes = "" } = req.body;
      const disburserName = req.user.name || "Treasurer";

      const updateRes = await pool.query(
        `UPDATE member_credit_loans 
         SET status = 'DISBURSED', 
             disbursed_at = NOW(),
             disbursement_mode = $1,
             disbursement_ref = $2,
             notes = CASE WHEN $3 != '' THEN $3 ELSE notes END,
             updated_at = NOW() 
         WHERE id = $4 AND status IN ('PENDING', 'APPROVED')
         RETURNING *`,
        [disbursement_mode, disbursement_ref || `DISB-${Date.now()}`, notes, id]
      );

      if (updateRes.rows.length === 0) {
        return res.status(400).json({ success: false, error: "Loan not ready for disbursal." });
      }

      const loan = updateRes.rows[0];

      res.json({
        success: true,
        message: `💸 Loan of ₹${loan.loan_amount} successfully marked as DISBURSED to ${loan.member_name}!`,
        data: loan,
      });
    } catch (err) {
      console.error("Disburse Loan Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   💵 8. RECORD EMI REPAYMENT INSTALLMENT (ADMIN)
   POST /loans/admin/:id/repay-emi
===================================================== */
router.post(
  "/admin/:id/repay-emi",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { amount_paid, payment_mode = "UPI", transaction_ref = "" } = req.body;
      const recorderName = req.user.name || "Treasurer";

      const loanRes = await pool.query("SELECT * FROM member_credit_loans WHERE id = $1", [id]);
      if (loanRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Loan record not found." });
      }
      const loan = loanRes.rows[0];

      const paid = Number(amount_paid) || Number(loan.monthly_emi);
      const countRes = await pool.query(
        "SELECT COUNT(*)::int as count FROM member_loan_repayments WHERE loan_id = $1",
        [id]
      );
      const installmentNum = (countRes.rows[0]?.count || 0) + 1;

      // Insert repayment record
      await pool.query(
        `INSERT INTO member_loan_repayments (
          loan_id, user_id, installment_number, amount_paid, payment_mode, transaction_ref, recorded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          loan.user_id,
          installmentNum,
          paid,
          payment_mode,
          transaction_ref || `EMI-${Date.now()}`,
          recorderName,
        ]
      );

      // Update loan balance
      const newTotalRepaid = Number(loan.total_repaid) + paid;
      const newOutstanding = Math.max(0, Number(loan.loan_amount) - newTotalRepaid);
      const newStatus = newOutstanding <= 0 ? "REPAID" : "ACTIVE";

      const updatedRes = await pool.query(
        `UPDATE member_credit_loans 
         SET total_repaid = $1, outstanding_balance = $2, status = $3, updated_at = NOW() 
         WHERE id = $4
         RETURNING *`,
        [newTotalRepaid, newOutstanding, newStatus, id]
      );

      res.json({
        success: true,
        message: `✅ EMI Installment #${installmentNum} of ₹${paid} recorded! Outstanding balance: ₹${newOutstanding}.`,
        data: updatedRes.rows[0],
      });
    } catch (err) {
      console.error("Repay EMI Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   🚨 9. SUBMIT EMERGENCY GRANT REQUEST (WITH 2/3 VOTING BROADCAST)
   POST /loans/emergency-request
===================================================== */
router.post("/emergency-request", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { grant_amount, emergency_category, reason, hospital_or_proof = "" } = req.body;

    if (!grant_amount || !emergency_category || !reason) {
      return res.status(400).json({
        success: false,
        error: "Grant amount, emergency category, and reason are required.",
      });
    }

    const amount = Number(grant_amount);
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];

    // Check Safety Cap
    const settingsRes = await pool.query(
      "SELECT max_emergency_cap FROM mcp_budget_settings WHERE fiscal_year = 2026 LIMIT 1"
    );
    const maxCap = Number(settingsRes.rows[0]?.max_emergency_cap || 3000);

    if (amount > maxCap) {
      return res.status(400).json({
        success: false,
        error: `Requested emergency grant (₹${amount}) exceeds safety cap of ₹${maxCap} per person.`,
      });
    }

    // Determine required 2/3 quorum count based on committee users
    const committeeCountRes = await pool.query(
      "SELECT COUNT(*)::int as count FROM users WHERE role IN ('SUPER_ADMIN', 'PRESIDENT', 'GENERAL_SECRETARY', 'TREASURER', 'EC_MEMBER')"
    );
    const totalCommittee = Math.max(3, committeeCountRes.rows[0]?.count || 10);
    const votesRequired = Math.ceil((totalCommittee * 2) / 3); // 2/3 Supermajority

    const insertRes = await pool.query(
      `
      INSERT INTO member_emergency_grants (
        user_id, member_name, phone, grant_amount, emergency_category,
        reason, hospital_or_proof, fiscal_year, votes_required,
        votes_for, votes_against, voting_status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 2026, $8, 0, 0, 'VOTING_ACTIVE')
      RETURNING *
      `,
      [
        userId,
        user.name,
        user.phone || "",
        amount,
        emergency_category,
        reason.trim(),
        hospital_or_proof ? hospital_or_proof.trim() : "",
        votesRequired,
      ]
    );

    const grantRecord = insertRes.rows[0];

    // Broadcast notification to Committee Members via email asynchronously
    const committeeUsers = await pool.query(
      "SELECT personal_email, name FROM users WHERE personal_email IS NOT NULL AND personal_email != ''"
    );

    const emailSubject = `🚨 [URGENT VOTE REQUIRED] Member Emergency Relief Request: ₹${amount} for ${user.name}`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 3px solid #dc2626; border-radius: 12px; overflow: hidden;">
        <div style="background: #dc2626; color: #fff; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 1.4rem;">🚨 EMERGENCY WELFARE GRANT REQUEST</h2>
          <div style="font-size: 0.85rem; margin-top: 4px;">Hindu Swaraj Youth 15% Emergency Relief Pool</div>
        </div>
        <div style="padding: 24px; background: #ffffff; color: #1e293b;">
          <p style="font-size: 1rem; line-height: 1.6;">
            A high-priority emergency welfare request has been submitted by <b>${user.name}</b> (${user.phone || "No phone"}).
          </p>
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <div><b>Amount Requested:</b> ₹${amount} (From 15% Pool)</div>
            <div style="margin-top: 6px;"><b>Emergency Category:</b> ${emergency_category}</div>
            <div style="margin-top: 6px;"><b>Reason / Hospital:</b> ${reason}</div>
            <div style="margin-top: 6px;"><b>Quorum Needed:</b> 2/3 Supermajority (${votesRequired} YES Votes)</div>
          </div>
          <p style="font-size: 0.9rem; color: #475569;">
            As an Executive Committee Member, please log in to the portal and cast your electronic vote (YES/NO) to sanction this emergency relief.
          </p>
          <div style="text-align: center; margin-top: 20px;">
            <a href="${(process.env.FRONTEND_URL || process.env.BASE_URL || 'https://www.hinduswarajyouth.online').replace(/\/$/, '')}/admin" style="background: #1e293b; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 800; display: inline-block;">
              🗳️ Cast Your Vote in Portal
            </a>
          </div>
        </div>
      </div>
    `;

    Promise.allSettled(
      committeeUsers.rows.map((u) => sendMail(u.personal_email, emailSubject, emailHtml))
    ).catch(() => {});

    res.status(201).json({
      success: true,
      message: `🚨 Emergency grant request of ₹${amount} registered! Team notified. Enters 2/3 voting chamber (Requires ${votesRequired} YES votes).`,
      data: grantRecord,
    });
  } catch (err) {
    console.error("Emergency Request Error:", err);
    res.status(500).json({ success: false, error: "Failed to submit request: " + err.message });
  }
});

/* =====================================================
   🗳️ 10. CAST ELECTRONIC VOTE ON EMERGENCY GRANT
   POST /loans/emergency/:id/vote
===================================================== */
router.post("/emergency/:id/vote", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { vote_choice, comments = "" } = req.body; // 'YES' | 'NO'

    if (!vote_choice || !["YES", "NO"].includes(vote_choice.toUpperCase())) {
      return res.status(400).json({ success: false, error: "Vote choice must be YES or NO." });
    }

    const normalizedVote = vote_choice.toUpperCase();
    const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user = userRes.rows[0];

    const grantRes = await pool.query("SELECT * FROM member_emergency_grants WHERE id = $1", [id]);
    if (grantRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Emergency grant record not found." });
    }
    const grant = grantRes.rows[0];

    if (grant.voting_status !== "VOTING_ACTIVE") {
      return res.status(400).json({
        success: false,
        error: `Voting is closed for this grant (Status: ${grant.voting_status}).`,
      });
    }

    // 🔒 Enforce strictly One Vote Per User
    const existingVote = await pool.query(
      "SELECT * FROM emergency_grant_votes WHERE grant_id = $1 AND user_id = $2",
      [id, userId]
    );
    if (existingVote.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: `You have already cast your official ballot (${existingVote.rows[0].vote_choice}) on this emergency request. Strictly one vote per member!`,
      });
    }

    // Insert new ballot
    await pool.query(
      `
      INSERT INTO emergency_grant_votes (grant_id, user_id, voter_name, voter_role, vote_choice, comments, voted_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `,
      [id, userId, user.name, user.role || "MEMBER", normalizedVote, comments]
    );

    // Tally votes
    const tallyRes = await pool.query(
      `SELECT 
        COUNT(CASE WHEN vote_choice = 'YES' THEN 1 END)::int as votes_for,
        COUNT(CASE WHEN vote_choice = 'NO' THEN 1 END)::int as votes_against,
        COUNT(*)::int as total_votes
       FROM emergency_grant_votes
       WHERE grant_id = $1`,
      [id]
    );

    const votesFor = Number(tallyRes.rows[0]?.votes_for || 0);
    const votesAgainst = Number(tallyRes.rows[0]?.votes_against || 0);
    const votesRequired = Number(grant.votes_required || 7);

    // Check if 2/3 supermajority is achieved
    let newStatus = "VOTING_ACTIVE";
    if (votesFor >= votesRequired) {
      newStatus = "APPROVED_2_THIRDS";
    }

    const updatedGrant = await pool.query(
      `UPDATE member_emergency_grants 
       SET votes_for = $1, votes_against = $2, voting_status = $3
       WHERE id = $4
       RETURNING *`,
      [votesFor, votesAgainst, newStatus, id]
    );

    res.json({
      success: true,
      message: `🗳️ Your vote (${normalizedVote}) has been recorded! Current tally: ${votesFor}/${votesRequired} YES votes.`,
      data: updatedGrant.rows[0],
      is_approved: newStatus === "APPROVED_2_THIRDS",
    });
  } catch (err) {
    console.error("Emergency Vote Error:", err);
    res.status(500).json({ success: false, error: "Failed to record vote: " + err.message });
  }
});

/* =====================================================
   💸 11. DISBURSE APPROVED EMERGENCY GRANT (ADMIN)
   POST /loans/emergency/:id/disburse
===================================================== */
router.post(
  "/emergency/:id/disburse",
  verifyToken,
  checkRole("SUPER_ADMIN", "PRESIDENT", "TREASURER"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { disbursement_ref = "", notes = "" } = req.body;
      const disburserName = req.user.name || "Treasurer";

      const grantRes = await pool.query("SELECT * FROM member_emergency_grants WHERE id = $1", [id]);
      if (grantRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Grant record not found." });
      }
      const grant = grantRes.rows[0];

      if (grant.voting_status !== "APPROVED_2_THIRDS" && req.user.role !== "SUPER_ADMIN") {
        return res.status(400).json({
          success: false,
          error: `Grant requires 2/3 Supermajority vote approval before disbursal (Current: ${grant.votes_for}/${grant.votes_required}).`,
        });
      }

      const updateRes = await pool.query(
        `UPDATE member_emergency_grants 
         SET voting_status = 'DISBURSED',
             disbursed_at = NOW(),
             disbursed_by = $1,
             disbursement_ref = $2,
             notes = $3
         WHERE id = $4
         RETURNING *`,
        [disburserName, disbursement_ref || `EMERG-DISB-${Date.now()}`, notes, id]
      );

      res.json({
        success: true,
        message: `💸 Emergency relief grant of ₹${grant.grant_amount} successfully disbursed to ${grant.member_name}!`,
        data: updateRes.rows[0],
      });
    } catch (err) {
      console.error("Disburse Emergency Grant Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

/* =====================================================
   📋 12. GET ALL EMERGENCY GRANTS WITH BALLOT AUDIT (ADMIN & COMMITTEE)
   GET /loans/emergency/all
===================================================== */
router.get("/emergency/all", verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*, 
        COALESCE(
          json_agg(v.* ORDER BY v.voted_at DESC) FILTER (WHERE v.id IS NOT NULL), '[]'
        ) as ballots
       FROM member_emergency_grants g
       LEFT JOIN emergency_grant_votes v ON g.id = v.grant_id
       GROUP BY g.id
       ORDER BY g.created_at DESC`
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error("Fetch Emergency Grants Error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
