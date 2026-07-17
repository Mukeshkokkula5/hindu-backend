const express = require("express");
const router = express.Router();
const pool = require("../db");
const verifyToken = require("../middleware/verifyToken");
const PDFDocument = require("pdfkit");
const path = require("path");

const LOGO_PATH = path.join(__dirname, "../assets/logo.png");

/* =========================
   🔐 ROLE CHECK
========================= */
function allowReports(req, res) {
  const allowed = ["SUPER_ADMIN", "ADMIN", "PRESIDENT", "TREASURER"];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }
  return true;
}

/* =========================
   💰 HELPERS
========================= */
function formatINR(num) {
  return Number(num).toLocaleString("en-IN", { minimumFractionDigits: 2 });
}

function amountInWords(num) {
  const a = ["","One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
    "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["","","Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  const words = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n/10)] + (n%10 ? " " + a[n%10] : "");
    if (n < 1000) return a[Math.floor(n/100)] + " Hundred " + words(n%100);
    if (n < 100000) return words(Math.floor(n/1000)) + " Thousand " + words(n%1000);
    if (n < 10000000) return words(Math.floor(n/100000)) + " Lakh " + words(n%100000);
    return words(Math.floor(n/10000000)) + " Crore " + words(n%10000000);
  };

  return `Rupees ${words(Math.floor(num))} Only`;
}

/* =========================
   📊 JSON REPORTS
========================= */
router.get("/monthly", verifyToken, async (req, res) => {
  if (!allowReports(req, res)) return;
  const r = await pool.query(`
    SELECT TO_CHAR(receipt_date,'YYYY-MM') AS month,
           COUNT(*) AS count,
           COALESCE(SUM(amount),0) AS total_amount
    FROM contributions
    WHERE status='APPROVED'
    GROUP BY month
    ORDER BY month DESC
  `);
  res.json({ report: r.rows });
});

router.get("/fund-wise", verifyToken, async (req, res) => {
  if (!allowReports(req, res)) return;
  const r = await pool.query(`
    SELECT f.fund_name, COALESCE(SUM(c.amount),0) AS total_amount
    FROM funds f
    LEFT JOIN contributions c ON c.fund_id=f.id AND c.status='APPROVED'
    GROUP BY f.fund_name
    ORDER BY total_amount DESC
  `);
  res.json({ report: r.rows });
});

router.get("/member-wise", verifyToken, async (req, res) => {
  if (!allowReports(req, res)) return;
  const r = await pool.query(`
    SELECT u.name AS member_name, COALESCE(SUM(c.amount),0) AS total_amount
    FROM users u
    LEFT JOIN contributions c ON c.member_id=u.id AND c.status='APPROVED'
    GROUP BY u.name
    ORDER BY total_amount DESC
  `);
  res.json({ report: r.rows });
});

/* =========================
   📄 PDF HELPERS
========================= */
function addWatermark(doc) {
  doc.save();
  doc.opacity(0.08);
  doc.image(LOGO_PATH, doc.page.width/2 - 150, doc.page.height/2 - 150, { width: 300 });
  doc.restore();
}

function pdfHeader(doc, title, subtitle="") {
  doc.image(LOGO_PATH, doc.page.width/2 - 35, 30, { width: 70 });
  doc.moveDown(4);
  doc.font("Helvetica-Bold").fontSize(16).text("HinduSwaraj Youth Welfare Association",{align:"center"});
  doc.font("Helvetica").fontSize(10)
    .text("Aravind Nagar – Jagtial 505327",{align:"center"})
    .text("Reg No: 784/25",{align:"center"})
    .text("Mobile: 8499878425 | Email: hinduswarajyouth@gmail.com",{align:"center"});
  doc.moveDown(1.5);
  doc.fontSize(15).text(title,{align:"center"});
  if (subtitle) doc.fontSize(11).text(subtitle,{align:"center"});
  doc.fontSize(9).text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`,{align:"center"});
  doc.moveDown(2);
}

function addPageNumber(doc) {
  const range = doc.bufferedPageRange();
  for (let i=range.start;i<range.start+range.count;i++) {
    doc.switchToPage(i);
    doc.fontSize(9).text(`Page ${i+1} of ${range.count}`,50,doc.page.height-40,{align:"center"});
  }
}

/* =========================
   📄 COMMON PDF
========================= */
function generatePDF(res,title,subtitle,rows) {
  const doc = new PDFDocument({ size:"A4", margin:50, bufferPages:true });
  res.setHeader("Content-Type","application/pdf");
  doc.pipe(res);

  addWatermark(doc);
  pdfHeader(doc,title,subtitle);

  let y = doc.y;
  let total = 0;

  doc.font("Helvetica-Bold").text("Sl",60,y).text("Name",100,y).text("Amount (Rs.)",420,y,{align:"right"});
  y+=20;

  doc.font("Helvetica");
  rows.forEach((r,i)=>{
    const amt = Number(r.total||0);
    doc.text(i+1,60,y).text(r.name,100,y).text(`Rs. ${formatINR(amt)}`,420,y,{align:"right"});
    total+=amt; y+=20;
  });

  doc.font("Helvetica-Bold").text("TOTAL",100,y).text(`Rs. ${formatINR(total)}`,420,y,{align:"right"});
  doc.moveDown().fontSize(10).text(`Amount in Words: ${amountInWords(total)}`);

  addPageNumber(doc);
  doc.end();
}

/* =========================
   📄 PDF ROUTES
========================= */
router.get("/pdf/fund-wise", async (req,res)=>{
  const r = await pool.query(`
    SELECT f.fund_name AS name, COALESCE(SUM(c.amount),0) AS total
    FROM funds f
    LEFT JOIN contributions c ON c.fund_id=f.id AND c.status='APPROVED'
    GROUP BY f.fund_name
  `);
  generatePDF(res,"Fund-wise Collection Report","",r.rows);
});

router.get("/pdf/member-wise", async (req,res)=>{
  const r = await pool.query(`
    SELECT u.name AS name, COALESCE(SUM(c.amount),0) AS total
    FROM users u
    LEFT JOIN contributions c ON c.member_id=u.id AND c.status='APPROVED'
    GROUP BY u.name
  `);
  generatePDF(res,"Member-wise Contribution Report","",r.rows);
});

router.get("/pdf/monthly", async (req,res)=>{
  const {month,year} = req.query;
  const r = await pool.query(`
    SELECT f.fund_name AS name, COALESCE(SUM(c.amount),0) AS total
    FROM contributions c
    JOIN funds f ON c.fund_id=f.id
    WHERE c.status='APPROVED'
      AND EXTRACT(MONTH FROM c.receipt_date)=$1
      AND EXTRACT(YEAR FROM c.receipt_date)=$2
    GROUP BY f.fund_name
  `,[month,year]);
  generatePDF(res,"Monthly Collection Report",`Month: ${month}/${year}`,r.rows);
});

module.exports = router;
