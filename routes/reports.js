const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const PDFDocument = require("pdfkit");
const path = require("path");
const fs = require("fs");

const LOGO_PATH = path.join(__dirname, "../assets/logo.png");

/* ======================================================
   🔐 ROLE CHECK & PERMISSION HELPERS
====================================================== */
function normalizeRole(role) {
  if (!role) return "";
  const r = role.toUpperCase().trim().replace(/[\s-]+/g, "_");
  if (r === "SECRETARY") return "GENERAL_SECRETARY";
  if (r === "EC" || r === "EXECUTIVE" || r === "EXECUTIVE_COMMITTEE") return "EC_MEMBER";
  return r;
}

function allowReports(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  const allowed = ["SUPER_ADMIN", "ADMIN", "PRESIDENT", "TREASURER", "GENERAL_SECRETARY", "EC_MEMBER"];
  const userRole = normalizeRole(req.user.role);
  if (!allowed.includes(userRole) && userRole !== "SUPER_ADMIN" && userRole !== "PRESIDENT") {
    res.status(403).json({ error: "Access denied: insufficient permissions to view financial reports" });
    return false;
  }
  return true;
}

function parseMonth(monthStr) {
  if (!monthStr) return new Date().getMonth() + 1;
  if (!isNaN(monthStr)) {
    const m = parseInt(monthStr, 10);
    return m >= 1 && m <= 12 ? m : new Date().getMonth() + 1;
  }
  const map = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  return map[monthStr.toLowerCase().trim()] || new Date().getMonth() + 1;
}

function formatINR(num) {
  return Number(num || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function amountInWords(num) {
  const n = Math.floor(Number(num || 0));
  if (n === 0) return "Rupees Zero Only";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const words = (val) => {
    if (val < 20) return a[val];
    if (val < 100) return b[Math.floor(val / 10)] + (val % 10 ? " " + a[val % 10] : "");
    if (val < 1000) return a[Math.floor(val / 100)] + " Hundred " + words(val % 100);
    if (val < 100000) return words(Math.floor(val / 1000)) + " Thousand " + words(val % 1000);
    if (val < 10000000) return words(Math.floor(val / 100000)) + " Lakh " + words(val % 100000);
    return words(Math.floor(val / 10000000)) + " Crore " + words(val % 10000000);
  };

  return `Rupees ${words(n).trim()} Only`;
}

/* ======================================================
   📊 1. JSON DATA ENDPOINTS
====================================================== */

// Monthly Comprehensive Report Data
router.get("/monthly-data", verifyToken, async (req, res) => {
  if (!allowReports(req, res)) return;
  try {
    const monthNum = parseMonth(req.query.month);
    const yearNum = parseInt(req.query.year || new Date().getFullYear(), 10);

    // 1. Offline Approved Contributions for this Month
    const contributionsRes = await pool.query(
      `
      SELECT c.id, c.donor_name AS payer_name, c.donor_phone AS mobile, c.amount,
             c.payment_mode, c.receipt_no, COALESCE(c.receipt_date, c.created_at) AS transaction_date,
             f.fund_name, 'OFFLINE' AS channel
      FROM contributions c
      LEFT JOIN funds f ON f.id = c.fund_id
      WHERE c.status = 'APPROVED'
        AND EXTRACT(MONTH FROM COALESCE(c.receipt_date, c.created_at)) = $1
        AND EXTRACT(YEAR FROM COALESCE(c.receipt_date, c.created_at)) = $2
      ORDER BY transaction_date DESC
      `,
      [monthNum, yearNum]
    );

    // 2. Online PG Transactions for this Month
    const pgRes = await pool.query(
      `
      SELECT p.id, p.payer_name, p.mobile_number AS mobile, p.amount,
             'ONLINE' AS payment_mode, p.order_id AS receipt_no, p.created_at AS transaction_date,
             p.fund_type AS fund_name, 'ONLINE_PG' AS channel
      FROM pg_transactions p
      WHERE (p.status = 'SUCCESS' OR p.status = 'APPROVED')
        AND EXTRACT(MONTH FROM p.created_at) = $1
        AND EXTRACT(YEAR FROM p.created_at) = $2
      ORDER BY p.created_at DESC
      `,
      [monthNum, yearNum]
    );

    // Combine collections
    const collections = [...contributionsRes.rows, ...pgRes.rows].sort(
      (a, b) => new Date(b.transaction_date) - new Date(a.transaction_date)
    );

    // 3. Expenses for this Month
    const expensesRes = await pool.query(
      `
      SELECT e.*, u.name AS recorded_by_name
      FROM expenses e
      LEFT JOIN users u ON u.id = e.requested_by
      WHERE EXTRACT(MONTH FROM e.expense_date) = $1
        AND EXTRACT(YEAR FROM e.expense_date) = $2
      ORDER BY e.expense_date DESC
      `,
      [monthNum, yearNum]
    );

    const totalCollections = collections.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalExpenses = expensesRes.rows.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const netBalance = totalCollections - totalExpenses;

    // Fund breakdown for this month
    const fundMap = {};
    collections.forEach((c) => {
      const fn = c.fund_name || "General Donation";
      fundMap[fn] = (fundMap[fn] || 0) + Number(c.amount || 0);
    });
    const fundSummary = Object.keys(fundMap).map((k) => ({
      fund_name: k,
      total_amount: fundMap[k],
    }));

    res.json({
      month: monthNum,
      year: yearNum,
      summary: {
        total_collections: totalCollections,
        total_expenses: totalExpenses,
        net_balance: netBalance,
        transactions_count: collections.length,
        expenses_count: expensesRes.rows.length,
      },
      fund_summary: fundSummary,
      collections,
      expenses: expensesRes.rows,
    });
  } catch (err) {
    console.error("GET MONTHLY REPORT DATA ERROR:", err);
    res.status(500).json({ error: "Failed to compile monthly report data" });
  }
});

// Fund-wise Report Data
router.get("/fund-wise-data", verifyToken, async (req, res) => {
  if (!allowReports(req, res)) return;
  try {
    const { rows } = await pool.query(`
      SELECT f.id, f.fund_name, f.fund_type, f.base_amount,
        COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.fund_id = f.id AND c.status = 'APPROVED'), 0) +
        COALESCE((SELECT SUM(p.amount) FROM pg_transactions p WHERE (p.fund_type = f.fund_name OR p.fund_type = f.fund_type) AND (p.status = 'SUCCESS' OR p.status = 'APPROVED')), 0) AS total_collected,
        COALESCE((SELECT COUNT(*) FROM contributions c WHERE c.fund_id = f.id AND c.status = 'APPROVED'), 0) +
        COALESCE((SELECT COUNT(*) FROM pg_transactions p WHERE (p.fund_type = f.fund_name OR p.fund_type = f.fund_type) AND (p.status = 'SUCCESS' OR p.status = 'APPROVED')), 0) AS total_donors
      FROM funds f
      ORDER BY total_collected DESC
    `);

    res.json({ report: rows });
  } catch (err) {
    console.error("GET FUND-WISE DATA ERROR:", err);
    res.status(500).json({ error: "Failed to load fund report data" });
  }
});

// Member-wise Report Data
router.get("/member-wise-data", verifyToken, async (req, res) => {
  if (!allowReports(req, res)) return;
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.role, u.member_id, u.phone,
        COALESCE(SUM(c.amount), 0) AS total_amount,
        COUNT(c.id) AS total_contributions,
        MAX(COALESCE(c.receipt_date, c.created_at)) AS last_contribution_date
      FROM users u
      LEFT JOIN contributions c ON c.member_id = u.id AND c.status = 'APPROVED'
      GROUP BY u.id, u.name, u.role, u.member_id, u.phone
      ORDER BY total_amount DESC, u.name ASC
    `);

    res.json({ report: rows });
  } catch (err) {
    console.error("GET MEMBER-WISE DATA ERROR:", err);
    res.status(500).json({ error: "Failed to load member report data" });
  }
});

/* ======================================================
   📄 2. ADVANCED PDF GENERATION SUITE
====================================================== */

async function getAssociationMeta() {
  try {
    const res = await pool.query("SELECT * FROM association_settings ORDER BY id DESC LIMIT 1");
    if (res.rows.length) return res.rows[0];
  } catch (e) {
    console.warn("Could not load association_settings for PDF:", e.message);
  }
  return {
    association_name: "HINDU SWARAJ YOUTH WELFARE ASSOCIATION",
    reg_number: "486/2024",
    address: "Registered Office: Jagtial, Telangana - 505327",
    president_signature_url: null,
    treasurer_signature_url: null,
    association_seal_url: null,
  };
}

function renderPdfHeader(doc, meta, title, subtitle = "") {
  // Association Emblem / Logo
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, doc.page.width / 2 - 30, 25, { width: 60 });
    } catch (e) {}
  }
  doc.moveDown(fs.existsSync(LOGO_PATH) ? 3.5 : 1);

  // Top header text
  doc.font("Helvetica-Bold").fontSize(14).fillColor("#580505").text("HINDU SWARAJ YOUTH WELFARE ASSOCIATION", { align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#475569")
    .text(`(Regd. Under Telangana Societies Registration Act 2001 • Regd No: ${meta.reg_number || "486/2024"})`, { align: "center" })
    .text(meta.address || "Jagtial, Telangana - 505327 • Email: support@hinduswarajyouth.online", { align: "center" });

  doc.moveDown(0.8);
  doc.strokeColor("#580505").lineWidth(1.5)
    .moveTo(40, doc.y)
    .lineTo(doc.page.width - 40, doc.y)
    .stroke();

  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(title.toUpperCase(), { align: "center" });
  if (subtitle) {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#4338ca").text(subtitle, { align: "center" });
  }
  const istTime = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  });
  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b").text(`Generated On: ${istTime}`, { align: "center" });
  doc.moveDown(1.2);
}

function renderPdfFooterAndSignatures(doc, meta) {
  const bottomY = doc.page.height - 110;

  // Signature divider
  doc.strokeColor("#cbd5e1").lineWidth(0.8)
    .moveTo(40, bottomY)
    .lineTo(doc.page.width - 40, bottomY)
    .stroke();

  // President Sign block
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text("PRESIDENT", 60, bottomY + 30, { align: "left", lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b").text("Hindu Swaraj Youth", 60, bottomY + 42, { align: "left", lineBreak: false });

  // Official Seal in center
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#580505").text("[ ASSOCIATION SEAL ]", doc.page.width / 2 - 50, bottomY + 30, { width: 100, align: "center", lineBreak: false });

  // Treasurer Sign block
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text("TREASURER", doc.page.width - 150, bottomY + 30, { align: "right", width: 90, lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b").text("Hindu Swaraj Youth", doc.page.width - 150, bottomY + 42, { align: "right", width: 90, lineBreak: false });

  // Page Numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8")
      .text(`Page ${i + 1} of ${range.count} • Official Financial Record`, 40, doc.page.height - 25, { align: "center", lineBreak: false });
    doc.page.margins.bottom = prevBottom;
  }
}

// 1. PDF: Monthly Financial Statement & Ledger
router.get("/pdf/monthly", async (req, res) => {
  try {
    const monthNum = parseMonth(req.query.month);
    const yearNum = parseInt(req.query.year || new Date().getFullYear(), 10);
    const meta = await getAssociationMeta();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthTitle = `${monthNames[monthNum - 1]} ${yearNum}`;

    // Fetch data
    const [contRes, pgRes, expRes] = await Promise.all([
      pool.query(
        `SELECT c.donor_name AS name, c.donor_phone AS phone, c.amount, c.payment_mode, c.receipt_no,
                COALESCE(c.receipt_date, c.created_at) AS date, f.fund_name
         FROM contributions c
         LEFT JOIN funds f ON f.id = c.fund_id
         WHERE c.status = 'APPROVED'
           AND EXTRACT(MONTH FROM COALESCE(c.receipt_date, c.created_at)) = $1
           AND EXTRACT(YEAR FROM COALESCE(c.receipt_date, c.created_at)) = $2
         ORDER BY date DESC`,
        [monthNum, yearNum]
      ),
      pool.query(
        `SELECT p.payer_name AS name, p.mobile_number AS phone, p.amount, 'ONLINE' AS payment_mode,
                p.order_id AS receipt_no, p.created_at AS date, p.fund_type AS fund_name
         FROM pg_transactions p
         WHERE (p.status = 'SUCCESS' OR p.status = 'APPROVED')
           AND EXTRACT(MONTH FROM p.created_at) = $1
           AND EXTRACT(YEAR FROM p.created_at) = $2
         ORDER BY date DESC`,
        [monthNum, yearNum]
      ),
      pool.query(
        `SELECT e.title, e.category, e.description, e.amount, e.expense_date AS date
         FROM expenses e
         WHERE EXTRACT(MONTH FROM e.expense_date) = $1
           AND EXTRACT(YEAR FROM e.expense_date) = $2
         ORDER BY e.expense_date DESC`,
        [monthNum, yearNum]
      ),
    ]);

    const collections = [...contRes.rows, ...pgRes.rows];
    const expenses = expRes.rows;

    const totalCollected = collections.reduce((s, i) => s + Number(i.amount || 0), 0);
    const totalSpent = expenses.reduce((s, i) => s + Number(i.amount || 0), 0);
    const netBalance = totalCollected - totalSpent;

    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Hindu_Swaraj_Monthly_Report_${monthNames[monthNum - 1]}_${yearNum}.pdf"`);
    doc.pipe(res);

    renderPdfHeader(doc, meta, "Monthly Financial Statement & Audit Ledger", `Period: ${monthTitle}`);

    // Summary Highlight Boxes
    const startY = doc.y;
    const boxWidth = (doc.page.width - 80 - 20) / 3;

    // Box 1: Total Collections
    doc.rect(40, startY, boxWidth, 42).fillAndStroke("#f0fdf4", "#86efac");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#15803d").text("TOTAL COLLECTIONS", 50, startY + 8);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#166534").text(`Rs. ${formatINR(totalCollected)}`, 50, startY + 22);

    // Box 2: Total Expenses
    doc.rect(40 + boxWidth + 10, startY, boxWidth, 42).fillAndStroke("#fef2f2", "#fca5a5");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#b91c1c").text("TOTAL EXPENDITURE", 40 + boxWidth + 20, startY + 8);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#991b1b").text(`Rs. ${formatINR(totalSpent)}`, 40 + boxWidth + 20, startY + 22);

    // Box 3: Net Balance
    doc.rect(40 + (boxWidth + 10) * 2, startY, boxWidth, 42).fillAndStroke(netBalance >= 0 ? "#eff6ff" : "#fff7ed", netBalance >= 0 ? "#93c5fd" : "#fdba74");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(netBalance >= 0 ? "#1d4ed8" : "#c2410c").text("NET SURPLUS / BALANCE", 40 + (boxWidth + 10) * 2 + 10, startY + 8);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(netBalance >= 0 ? "#1e40af" : "#9a3412").text(`Rs. ${formatINR(netBalance)}`, 40 + (boxWidth + 10) * 2 + 10, startY + 22);

    doc.y = startY + 54;
    doc.x = 40;

    // Collections Table
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#580505").text(`1. Itemized Inflow & Donations Ledger (${collections.length} Records)`, 40, doc.y);
    doc.moveDown(0.4);

    let tableY = doc.y;
    doc.rect(40, tableY, doc.page.width - 80, 18).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#334155")
      .text("Date", 45, tableY + 5)
      .text("Donor / Payer Name", 95, tableY + 5)
      .text("Fund / Seva Category", 240, tableY + 5)
      .text("Mode", 370, tableY + 5)
      .text("Amount (Rs.)", 440, tableY + 5, { width: 70, align: "right" });

    tableY += 20;
    doc.font("Helvetica").fontSize(7).fillColor("#1e293b");

    if (collections.length === 0) {
      doc.text("No collections recorded in this billing cycle.", 45, tableY + 4);
      tableY += 16;
    } else {
      collections.forEach((item, idx) => {
        const cleanName = (item.name || "Anonymous").replace(/[\r\n]+/g, " ").trim();
        const cleanFund = (item.fund_name || "General Donation").replace(/[\r\n]+/g, " ").trim();

        doc.font("Helvetica").fontSize(7);
        const nameH = doc.heightOfString(cleanName, { width: 140 });
        const fundH = doc.heightOfString(cleanFund, { width: 125 });
        const rowH = Math.max(15, Math.max(nameH, fundH) + 5);

        if (tableY + rowH > doc.page.height - 140) {
          doc.addPage();
          renderPdfHeader(doc, meta, "Monthly Financial Statement & Audit Ledger", `Period: ${monthTitle}`);
          tableY = doc.y;
          doc.rect(40, tableY, doc.page.width - 80, 18).fill("#f1f5f9");
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#334155")
            .text("Date", 45, tableY + 5)
            .text("Donor / Payer Name", 95, tableY + 5)
            .text("Fund / Seva Category", 240, tableY + 5)
            .text("Mode", 370, tableY + 5)
            .text("Amount (Rs.)", 440, tableY + 5, { width: 70, align: "right" });
          tableY += 20;
          doc.font("Helvetica").fontSize(7);
        }

        if (idx % 2 === 1) doc.rect(40, tableY - 1, doc.page.width - 80, rowH).fill("#fafafa");
        doc.fillColor("#1e293b")
          .text(new Date(item.date).toLocaleDateString("en-IN"), 45, tableY + 2)
          .text(cleanName, 95, tableY + 2, { width: 140 })
          .text(cleanFund, 240, tableY + 2, { width: 125 })
          .text(item.payment_mode || "ONLINE", 370, tableY + 2)
          .text(formatINR(item.amount), 440, tableY + 2, { width: 70, align: "right" });
        tableY += rowH;
      });
    }

    // Expenditures Table
    doc.y = tableY + 14;
    doc.x = 40;
    if (doc.y > doc.page.height - 160) {
      doc.addPage();
      renderPdfHeader(doc, meta, "Monthly Financial Statement & Audit Ledger", `Period: ${monthTitle}`);
      doc.x = 40;
    }

    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#580505").text(`2. Outflows & Expenditures Incurred (${expenses.length} Records)`, 40, doc.y);
    doc.moveDown(0.4);

    tableY = doc.y;
    doc.rect(40, tableY, doc.page.width - 80, 18).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#334155")
      .text("Date", 45, tableY + 5)
      .text("Category", 100, tableY + 5)
      .text("Title / Payee", 180, tableY + 5)
      .text("Description", 305, tableY + 5)
      .text("Amount (Rs.)", 450, tableY + 5, { width: 65, align: "right" });

    tableY += 20;
    doc.font("Helvetica").fontSize(7).fillColor("#1e293b");

    if (expenses.length === 0) {
      doc.text("No expenditures booked in this billing cycle.", 45, tableY + 4);
      tableY += 16;
    } else {
      expenses.forEach((item, idx) => {
        const cleanCat = (item.category || "General").replace(/[\r\n]+/g, " ").trim();
        const cleanTitle = (item.title || "N/A").replace(/[\r\n]+/g, " ").trim();
        const cleanDesc = (item.description || "N/A").replace(/[\r\n]+/g, " ").trim();

        doc.font("Helvetica").fontSize(7);
        const titleH = doc.heightOfString(cleanTitle, { width: 120 });
        const descH = doc.heightOfString(cleanDesc, { width: 140 });
        const rowH = Math.max(16, Math.max(titleH, descH) + 6);

        if (tableY + rowH > doc.page.height - 140) {
          doc.addPage();
          renderPdfHeader(doc, meta, "Monthly Financial Statement & Audit Ledger", `Period: ${monthTitle}`);
          tableY = doc.y;
          doc.rect(40, tableY, doc.page.width - 80, 18).fill("#f1f5f9");
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#334155")
            .text("Date", 45, tableY + 5)
            .text("Category", 100, tableY + 5)
            .text("Title / Payee", 180, tableY + 5)
            .text("Description", 305, tableY + 5)
            .text("Amount (Rs.)", 450, tableY + 5, { width: 65, align: "right" });
          tableY += 20;
          doc.font("Helvetica").fontSize(7);
        }

        if (idx % 2 === 1) doc.rect(40, tableY - 1, doc.page.width - 80, rowH).fill("#fafafa");
        doc.fillColor("#1e293b")
          .text(new Date(item.date).toLocaleDateString("en-IN"), 45, tableY + 3)
          .text(cleanCat, 100, tableY + 3, { width: 75 })
          .text(cleanTitle, 180, tableY + 3, { width: 120 })
          .text(cleanDesc, 305, tableY + 3, { width: 140 })
          .text(formatINR(item.amount), 450, tableY + 3, { width: 65, align: "right" });
        tableY += rowH;
      });
    }

    doc.y = tableY + 12;
    doc.x = 40;
    if (doc.y > doc.page.height - 130) {
      doc.addPage();
      renderPdfHeader(doc, meta, "Monthly Financial Statement & Audit Ledger", `Period: ${monthTitle}`);
      doc.x = 40;
    }

    doc.font("Helvetica-Oblique").fontSize(8).fillColor("#475569")
      .text(`Total Collections in Words: ${amountInWords(totalCollected)}`, 40, doc.y);

    renderPdfFooterAndSignatures(doc, meta);
    doc.end();
  } catch (err) {
    console.error("GENERATE MONTHLY PDF ERROR:", err);
    res.status(500).json({ error: "Failed to generate monthly PDF report" });
  }
});

// 2. PDF: Fund-Wise Collection & Allocation Report
router.get("/pdf/fund-wise", async (req, res) => {
  try {
    const meta = await getAssociationMeta();
    const { rows } = await pool.query(`
      SELECT f.id, f.fund_name, f.fund_type, f.base_amount,
        COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.fund_id = f.id AND c.status = 'APPROVED'), 0) +
        COALESCE((SELECT SUM(p.amount) FROM pg_transactions p WHERE (p.fund_type = f.fund_name OR p.fund_type = f.fund_type) AND (p.status = 'SUCCESS' OR p.status = 'APPROVED')), 0) AS total_collected,
        COALESCE((SELECT COUNT(*) FROM contributions c WHERE c.fund_id = f.id AND c.status = 'APPROVED'), 0) +
        COALESCE((SELECT COUNT(*) FROM pg_transactions p WHERE (p.fund_type = f.fund_name OR p.fund_type = f.fund_type) AND (p.status = 'SUCCESS' OR p.status = 'APPROVED')), 0) AS total_donors
      FROM funds f
      ORDER BY total_collected DESC
    `);

    const totalAllFunds = rows.reduce((s, r) => s + Number(r.total_collected || 0), 0);

    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Hindu_Swaraj_Fundwise_Report.pdf"`);
    doc.pipe(res);

    renderPdfHeader(doc, meta, "Fund-wise Collection & Seva Allocation Report");

    let tableY = doc.y;
    doc.rect(40, tableY, doc.page.width - 80, 20).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#334155")
      .text("Sl", 45, tableY + 6)
      .text("Fund / Seva Name", 75, tableY + 6)
      .text("Category", 230, tableY + 6)
      .text("Base Amount (Rs.)", 320, tableY + 6)
      .text("Donors", 400, tableY + 6)
      .text("Total Raised (Rs.)", 440, tableY + 6, { width: 70, align: "right" });

    tableY += 22;
    doc.font("Helvetica").fontSize(8).fillColor("#1e293b");

    rows.forEach((fund, idx) => {
      if (idx % 2 === 1) doc.rect(40, tableY - 3, doc.page.width - 80, 18).fill("#fafafa");
      doc.fillColor("#1e293b")
        .text(idx + 1, 45, tableY)
        .text(fund.fund_name, 75, tableY, { width: 150, lineBreak: false })
        .text(fund.fund_type || "GENERAL", 230, tableY)
        .text(formatINR(fund.base_amount), 320, tableY)
        .text(fund.total_donors, 400, tableY)
        .text(formatINR(fund.total_collected), 440, tableY, { width: 70, align: "right" });
      tableY += 18;
    });

    // Total Row
    doc.rect(40, tableY - 3, doc.page.width - 80, 20).fill("#f8fafc");
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a")
      .text("CONSOLIDATED TOTAL", 75, tableY + 2)
      .text(`Rs. ${formatINR(totalAllFunds)}`, 440, tableY + 2, { width: 70, align: "right" });

    doc.moveDown(2);
    doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#475569")
      .text(`Consolidated Total in Words: ${amountInWords(totalAllFunds)}`, 45, doc.y);

    renderPdfFooterAndSignatures(doc, meta);
    doc.end();
  } catch (err) {
    console.error("GENERATE FUNDWISE PDF ERROR:", err);
    res.status(500).json({ error: "Failed to generate fund-wise report" });
  }
});

// 3. PDF: Member-Wise Contribution Report
router.get("/pdf/member-wise", async (req, res) => {
  try {
    const meta = await getAssociationMeta();
    const { rows } = await pool.query(`
      SELECT u.name, u.role, u.member_id, u.phone,
        COALESCE(SUM(c.amount), 0) AS total_amount,
        COUNT(c.id) AS total_contributions
      FROM users u
      LEFT JOIN contributions c ON c.member_id = u.id AND c.status = 'APPROVED'
      GROUP BY u.id, u.name, u.role, u.member_id, u.phone
      ORDER BY total_amount DESC, u.name ASC
    `);

    const totalMemberContrib = rows.reduce((s, r) => s + Number(r.total_amount || 0), 0);

    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Hindu_Swaraj_Memberwise_Report.pdf"`);
    doc.pipe(res);

    renderPdfHeader(doc, meta, "Member-wise Contribution Ledger");

    let tableY = doc.y;
    doc.rect(40, tableY, doc.page.width - 80, 20).fill("#f1f5f9");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#334155")
      .text("Sl", 45, tableY + 6)
      .text("Member Name", 70, tableY + 6)
      .text("Official Role", 210, tableY + 6)
      .text("Member ID", 310, tableY + 6)
      .text("Count", 390, tableY + 6)
      .text("Total Paid (Rs.)", 440, tableY + 6, { width: 70, align: "right" });

    tableY += 22;
    doc.font("Helvetica").fontSize(7.5).fillColor("#1e293b");

    rows.forEach((m, idx) => {
      if (tableY > doc.page.height - 140) {
        doc.addPage();
        renderPdfHeader(doc, meta, "Member-wise Contribution Ledger");
        tableY = doc.y;
      }
      if (idx % 2 === 1) doc.rect(40, tableY - 3, doc.page.width - 80, 16).fill("#fafafa");
      doc.fillColor("#1e293b")
        .text(idx + 1, 45, tableY)
        .text(m.name || "Member", 70, tableY, { width: 135, lineBreak: false })
        .text(m.role || "MEMBER", 210, tableY)
        .text(m.member_id || "HSY-MEM", 310, tableY)
        .text(m.total_contributions, 390, tableY)
        .text(formatINR(m.total_amount), 440, tableY, { width: 70, align: "right" });
      tableY += 16;
    });

    // Total Row
    doc.rect(40, tableY - 3, doc.page.width - 80, 20).fill("#f8fafc");
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a")
      .text("CONSOLIDATED MEMBER CONTRIBUTIONS", 70, tableY + 2)
      .text(`Rs. ${formatINR(totalMemberContrib)}`, 440, tableY + 2, { width: 70, align: "right" });

    renderPdfFooterAndSignatures(doc, meta);
    doc.end();
  } catch (err) {
    console.error("GENERATE MEMBERWISE PDF ERROR:", err);
    res.status(500).json({ error: "Failed to generate member-wise report" });
  }
});

module.exports = router;
