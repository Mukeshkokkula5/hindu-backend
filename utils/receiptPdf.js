const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const pool = require("../db");

/* ========================================================
   🔢 AMOUNT TO WORDS (INDIAN NUMBERING SYSTEM)
======================================================== */
function amountToWords(num) {
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const n = Math.floor(Number(num) || 0);
  if (n === 0) return "Zero Rupees Only";
  if (n === 1) return "One Rupee Only";

  const convert = (val) => {
    if (val < 20) return a[val];
    if (val < 100) return b[Math.floor(val / 10)] + (val % 10 ? " " + a[val % 10] : "");
    if (val < 1000) return a[Math.floor(val / 100)] + " Hundred" + (val % 100 ? " " + convert(val % 100) : "");
    if (val < 100000) return convert(Math.floor(val / 1000)) + " Thousand" + (val % 1000 ? " " + convert(val % 1000) : "");
    if (val < 10000000) return convert(Math.floor(val / 100000)) + " Lakh" + (val % 100000 ? " " + convert(val % 100000) : "");
    return convert(Math.floor(val / 10000000)) + " Crore" + (val % 10000000 ? " " + convert(val % 10000000) : "");
  };

  return `${convert(n).trim()} Rupees Only`;
}

function parseDataUrlBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  const match = dataUrl.match(/^data:image\/[a-zA-Z0-9+]+;base64,(.+)$/);
  if (match && match[1]) {
    return Buffer.from(match[1], "base64");
  }
  if (dataUrl.startsWith("/uploads/") || dataUrl.startsWith("uploads/")) {
    const cleanPath = path.join(__dirname, "..", dataUrl.replace(/^\//, ""));
    if (fs.existsSync(cleanPath)) {
      return fs.readFileSync(cleanPath);
    }
  }
  return null;
}

/* ========================================================
   📄 MAIN PROFESSIONAL PDF GENERATOR
   returnBuffer = true  → Buffer for Resend email attachment
   returnBuffer = false → Express HTTP response stream
======================================================== */
module.exports = async function generateReceiptPDF(res, receipt, returnBuffer = false) {
  const {
    receipt_no,
    name,
    fund_name,
    amount,
    receipt_date,
    verifyUrl,
    phone,
  } = receipt;

  // 1. Fetch Official Association Settings & Digital Signatures
  let settings = {
    president_name: "Vinodh Kumar K",
    gs_name: "Mani Deep",
    treasurer_name: "Treasurer",
    regd_no: "Regd. No: 784/2025 (Govt. of Telangana)",
    association_name: "Hindu Swaraj Youth Welfare Association",
    president_signature_url: null,
    gs_signature_url: null,
    treasurer_signature_url: null,
  };

  try {
    const sRes = await pool.query(
      "SELECT president_name, gs_name, treasurer_name, president_signature_url, gs_signature_url, treasurer_signature_url, regd_no, association_name FROM association_settings ORDER BY id DESC LIMIT 1"
    );
    if (sRes.rows.length > 0) {
      settings = { ...settings, ...sRes.rows[0] };
    }
  } catch (e) {
    console.warn("Notice: Association settings query fallback in PDF:", e.message);
  }

  const presSigBuf = parseDataUrlBuffer(settings.president_signature_url);
  const tresSigBuf = parseDataUrlBuffer(settings.treasurer_signature_url || settings.gs_signature_url);

  // 2. Generate High-Fidelity QR Code
  const qrTargetUrl = verifyUrl || `https://www.hinduswarajyouth.online/receipts/${receipt_no}`;
  const qrBuffer = await QRCode.toBuffer(qrTargetUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 250,
    color: { dark: "#0f2942", light: "#ffffff" },
  });

  // 3. Initialize Document
  const doc = new PDFDocument({ size: "A4", margin: 24 });
  const pageWidth = doc.page.width;   // 595.28
  const pageHeight = doc.page.height; // 841.89

  let buffers = [];
  if (returnBuffer) {
    doc.on("data", buffers.push.bind(buffers));
  } else {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${receipt_no}.pdf`);
    doc.pipe(res);
  }

  const logoPath = path.join(__dirname, "../assets/logo.png");
  const sealPath = path.join(__dirname, "../assets/seal.png");

  /* ========================================================
     0. WATERMARK EMBOSSED SEAL
  ======================================================== */
  if (fs.existsSync(sealPath)) {
    doc.save();
    doc.opacity(0.045);
    doc.image(sealPath, (pageWidth / 2) - 130, (pageHeight / 2) - 130, { width: 260 });
    doc.restore();
  }

  /* ========================================================
     1. OFFICIAL DUAL BORDER WITH GOLD CORNER ACCENTS
  ======================================================== */
  doc.save();
  // Outer Navy Border
  doc.rect(20, 20, pageWidth - 40, pageHeight - 40)
     .lineWidth(2.2)
     .strokeColor("#0f2942")
     .stroke();

  // Inner Gold Border
  doc.rect(25, 25, pageWidth - 50, pageHeight - 50)
     .lineWidth(0.8)
     .strokeColor("#c59b27")
     .stroke();

  // Corner Accent Flourishes
  const cornerSize = 7;
  const corners = [
    [22, 22],
    [pageWidth - 22 - cornerSize, 22],
    [22, pageHeight - 22 - cornerSize],
    [pageWidth - 22 - cornerSize, pageHeight - 22 - cornerSize],
  ];
  corners.forEach(([cx, cy]) => {
    doc.rect(cx, cy, cornerSize, cornerSize).fillColor("#c59b27").fill();
  });
  doc.restore();

  /* ========================================================
     2. OFFICIAL LETTERHEAD HEADER
  ======================================================== */
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 36, 35, { width: 72 });
  }

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f2942")
     .text("HINDUSWARAJ YOUTH WELFARE ASSOCIATION", 115, 36, { align: "center", width: 440 });

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#991b1b")
     .text("GOVT. REGISTERED SOCIETY NO: 784/2025", 115, 56, { align: "center", width: 440 });

  doc.font("Helvetica").fontSize(7.5).fillColor("#475569")
     .text("Registered Under Telangana Societies Registration Act 35 of 2001", 115, 68, { align: "center", width: 440 })
     .text("H.No. 4-2-123, Aravind Nagar, Jagtial, Telangana - 505327, India", 115, 79, { align: "center", width: 440 });

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#0284c7")
     .text("Web: www.hinduswarajyouth.online   |   Email: hinduswarajyouth@gmail.com   |   Ph: +91 84998 78425", 115, 91, { align: "center", width: 440 });

  // Double Decorative Rule
  doc.save();
  doc.moveTo(35, 108).lineTo(pageWidth - 35, 108).lineWidth(1.5).strokeColor("#0f2942").stroke();
  doc.moveTo(35, 111).lineTo(pageWidth - 35, 111).lineWidth(0.6).strokeColor("#c59b27").stroke();
  doc.restore();

  /* ========================================================
     3. OFFICIAL TITLE BADGE
  ======================================================== */
  const bannerY = 118;
  doc.save();
  doc.roundedRect(35, bannerY, pageWidth - 70, 26, 4)
     .fillColor("#0f2942")
     .fill();
  doc.roundedRect(35, bannerY, pageWidth - 70, 26, 4)
     .lineWidth(0.8)
     .strokeColor("#c59b27")
     .stroke();

  doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff")
     .text("OFFICIAL DONATION & CONTRIBUTION RECEIPT", 35, bannerY + 5, { align: "center", width: pageWidth - 70 });

  doc.font("Helvetica").fontSize(6.5).fillColor("#fde68a")
     .text("OFFICIAL COMPUTER-GENERATED TAX & AUDIT VOUCHER - ACKNOWLEDGMENT OF CHARITABLE DONATION", 35, bannerY + 17, { align: "center", width: pageWidth - 70 });
  doc.restore();

  /* ========================================================
     4. RECEIPT METADATA 4-CELL CARD GRID
  ======================================================== */
  const metaY = 150;
  const metaW = pageWidth - 70; // 525.28
  const colW = metaW / 4;

  doc.save();
  doc.rect(35, metaY, metaW, 36).fillColor("#f8fafc").fill();
  doc.rect(35, metaY, metaW, 36).lineWidth(0.6).strokeColor("#cbd5e1").stroke();

  [1, 2, 3].forEach((i) => {
    doc.moveTo(35 + (colW * i), metaY).lineTo(35 + (colW * i), metaY + 36).lineWidth(0.6).strokeColor("#cbd5e1").stroke();
  });

  // Cell 1: Receipt No
  doc.font("Helvetica").fontSize(6.8).fillColor("#64748b").text("RECEIPT NUMBER", 40, metaY + 6);
  doc.font("Helvetica-Bold").fontSize(8.2).fillColor("#0f2942").text(receipt_no, 40, metaY + 17, { width: colW - 10, ellipsis: true });

  // Cell 2: Date
  const dateFormatted = new Date(receipt_date || Date.now()).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  doc.font("Helvetica").fontSize(6.8).fillColor("#64748b").text("DATE OF ISSUE", 35 + colW + 8, metaY + 6);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f2942").text(dateFormatted, 35 + colW + 8, metaY + 17);

  // Cell 3: Payment Channel
  doc.font("Helvetica").fontSize(6.8).fillColor("#64748b").text("PAYMENT CHANNEL", 35 + (colW * 2) + 8, metaY + 6);
  doc.font("Helvetica-Bold").fontSize(8.2).fillColor("#0f2942").text("Razorpay Online (UPI)", 35 + (colW * 2) + 8, metaY + 17);

  // Cell 4: Status
  doc.font("Helvetica").fontSize(6.8).fillColor("#64748b").text("PAYMENT STATUS", 35 + (colW * 3) + 8, metaY + 6);
  doc.font("Helvetica-Bold").fontSize(8.2).fillColor("#047857").text("[ CLEARED / SUCCESS ]", 35 + (colW * 3) + 8, metaY + 17);
  doc.restore();

  /* ========================================================
     5. STRUCTURED PARTICULARS TABLE
  ======================================================== */
  const tableY = 194;
  const tableW = pageWidth - 70;
  const rowH = 26;
  const colSplit = 215;

  // Header Row
  doc.save();
  doc.rect(35, tableY, tableW, 20).fillColor("#0f2942").fill();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff")
     .text("PARTICULARS / CONTRIBUTION SPECIFICATIONS", 45, tableY + 6)
     .text("VERIFIED VALUE & OFFICIAL DETAILS", 35 + colSplit + 15, tableY + 6);
  doc.restore();

  const rows = [
    { label: "Received With Thanks From", val: name || "Devotee / Contributor", isBold: true, highlight: false },
    { label: "Donor Contact / Village", val: `${phone || "Devotee / Supporter"}  •  Jagtial, Telangana`, isBold: false, highlight: false },
    { label: "Seva / Fund Allocation", val: fund_name || "Youth & Community Welfare", isBold: true, highlight: false },
    { label: "Transaction / Gateway Reference", val: (receipt_no || "").replace("HSYWA-", "order_"), isBold: false, highlight: false },
    { label: "Total Net Amount Paid", val: `Rs. ${Number(amount || 0).toLocaleString("en-IN")}.00`, isBold: true, highlight: "amount" },
    { label: "Amount in Words (INR)", val: amountToWords(amount || 0), isBold: true, highlight: "words" },
  ];

  let currY = tableY + 20;
  rows.forEach((r, idx) => {
    doc.save();
    if (r.highlight === "amount") {
      doc.rect(35, currY, tableW, rowH).fillColor("#ecfdf5").fill();
    } else if (r.highlight === "words") {
      doc.rect(35, currY, tableW, rowH).fillColor("#fffbeb").fill();
    } else if (idx % 2 === 1) {
      doc.rect(35, currY, tableW, rowH).fillColor("#f8fafc").fill();
    } else {
      doc.rect(35, currY, tableW, rowH).fillColor("#ffffff").fill();
    }

    doc.rect(35, currY, tableW, rowH).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
    doc.moveTo(35 + colSplit, currY).lineTo(35 + colSplit, currY + rowH).lineWidth(0.5).strokeColor("#cbd5e1").stroke();

    doc.font("Helvetica-Bold").fontSize(7.8).fillColor("#475569").text(r.label, 45, currY + 8);

    if (r.highlight === "amount") {
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#047857").text(r.val, 35 + colSplit + 15, currY + 6);
    } else if (r.highlight === "words") {
      doc.font("Helvetica-BoldOblique").fontSize(8.5).fillColor("#92400e").text(r.val, 35 + colSplit + 15, currY + 8);
    } else {
      doc.font(r.isBold ? "Helvetica-Bold" : "Helvetica").fontSize(8.8).fillColor("#0f172a").text(r.val, 35 + colSplit + 15, currY + 8);
    }

    doc.restore();
    currY += rowH;
  });

  /* ========================================================
     6. QR CODE & DIGITAL INTEGRITY VERIFICATION BLOCK
  ======================================================== */
  const secY = currY + 12;
  const secH = 92;

  const leftW = tableW - 105; // 420
  doc.save();
  doc.rect(35, secY, leftW, secH).fillColor("#f8fafc").fill();
  doc.rect(35, secY, leftW, secH).lineWidth(0.6).strokeColor("#cbd5e1").stroke();

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f2942")
     .text("[ DIGITAL SECURITY & AUDIT VERIFICATION ]", 45, secY + 8);

  doc.font("Helvetica").fontSize(7.2).fillColor("#475569").lineGap(2)
     .text(
       "This donation receipt is officially recorded in the digital central register of Hindu Swaraj Youth Welfare Association under the Telangana Societies Registration Act. It is an unalterable financial document issued for accounting, audit, and tax compliance.",
       45, secY + 22, { width: leftW - 20 }
     );

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#0369a1")
     .text("LIVE DIGITAL VERIFICATION URL:", 45, secY + 54);
  doc.font("Helvetica").fontSize(7).fillColor("#0f172a")
     .text(qrTargetUrl, 45, secY + 64, { width: leftW - 20, ellipsis: true });

  const hashSnippet = crypto.createHash("sha256").update(receipt_no || "HSYWA-RECEIPT").digest("hex").substring(0, 32).toUpperCase();
  doc.font("Helvetica").fontSize(6.5).fillColor("#64748b")
     .text(`INTEGRITY HASH: SHA256-${hashSnippet}  •  TIMESTAMP: ${new Date().toISOString()}`, 45, secY + 77);
  doc.restore();

  // Right QR Code Box
  const qrX = 35 + leftW + 8;
  const qrW = tableW - leftW - 8; // 97
  doc.save();
  doc.rect(qrX, secY, qrW, secH).fillColor("#ffffff").fill();
  doc.rect(qrX, secY, qrW, secH).lineWidth(0.6).strokeColor("#cbd5e1").stroke();

  doc.image(qrBuffer, qrX + 9, secY + 6, { width: 78, height: 78 });
  doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#0f2942")
     .text("SCAN TO VERIFY", qrX, secY + 82, { align: "center", width: qrW });
  doc.restore();

  /* ========================================================
     7. OFFICIAL SEAL & AUTHORIZED SIGNATORIES (3-COLUMN)
  ======================================================== */
  const sigY = secY + secH + 12;
  const sigH = 110;
  const sigColW = tableW / 3;

  doc.save();
  doc.rect(35, sigY, tableW, sigH).fillColor("#fafafa").fill();
  doc.rect(35, sigY, tableW, sigH).lineWidth(0.6).strokeColor("#cbd5e1").stroke();

  // --- COLUMN 1: PRESIDENT ---
  const col1X = 40;
  if (presSigBuf) {
    doc.image(presSigBuf, col1X + 15, sigY + 12, { fit: [120, 42], align: "center" });
  }
  doc.moveTo(col1X + 10, sigY + 62).lineTo(col1X + sigColW - 20, sigY + 62).lineWidth(0.8).strokeColor("#0f2942").stroke();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f2942")
     .text(settings.president_name, col1X, sigY + 67, { align: "center", width: sigColW - 10 });
  doc.font("Helvetica").fontSize(7).fillColor("#475569")
     .text("President - HSYWA", col1X, sigY + 79, { align: "center", width: sigColW - 10 })
     .text("Authorized Executive Signatory", col1X, sigY + 89, { align: "center", width: sigColW - 10 });

  // --- COLUMN 2: OFFICIAL SEAL ---
  const col2X = 35 + sigColW;
  if (fs.existsSync(sealPath)) {
    doc.image(sealPath, col2X + (sigColW / 2) - 36, sigY + 8, { width: 72 });
  }
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#991b1b")
     .text("OFFICIAL EMBOSSED SEAL", col2X, sigY + 83, { align: "center", width: sigColW });
  doc.font("Helvetica").fontSize(6.5).fillColor("#64748b")
     .text("Regd. No: 784/2025 - Jagtial", col2X, sigY + 93, { align: "center", width: sigColW });

  // --- COLUMN 3: TREASURER / GENERAL SECRETARY ---
  const col3X = 35 + (sigColW * 2);
  if (tresSigBuf) {
    doc.image(tresSigBuf, col3X + 15, sigY + 12, { fit: [120, 42], align: "center" });
  }
  doc.moveTo(col3X + 10, sigY + 62).lineTo(col3X + sigColW - 20, sigY + 62).lineWidth(0.8).strokeColor("#0f2942").stroke();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f2942")
     .text(settings.treasurer_name || settings.gs_name || "Treasurer", col3X, sigY + 67, { align: "center", width: sigColW - 10 });
  doc.font("Helvetica").fontSize(7).fillColor("#475569")
     .text("Treasurer / Finance In-Charge", col3X, sigY + 79, { align: "center", width: sigColW - 10 })
     .text("Authorized Finance Signatory", col3X, sigY + 89, { align: "center", width: sigColW - 10 });

  doc.restore();

  /* ========================================================
     8. FOOTER & STATUTORY APPRECIATION
  ======================================================== */
  const footY = sigY + sigH + 10;

  doc.font("Helvetica-Oblique").fontSize(7).fillColor("#475569").lineGap(1.5)
     .text(
       "\"Thank you for your noble contribution and generous solidarity with Hindu Swaraj Youth Welfare Association. Your support fuels our sacred mission towards youth empowerment, emergency relief, community development, and dharmic seva.\"",
       40, footY, { align: "center", width: tableW - 10 }
     );

  doc.save();
  doc.moveTo(40, footY + 22).lineTo(pageWidth - 40, footY + 22).lineWidth(0.5).strokeColor("#cbd5e1").stroke();
  doc.restore();

  doc.font("Helvetica-Bold").fontSize(6.5).fillColor("#64748b")
     .text(
       "HSYWA Registered Office: H.No. 4-2-123, Aravind Nagar, Jagtial, Telangana - 505327 • Official Helpline: +91 84998 78425 • Page 1 of 1",
       40, footY + 26, { align: "center", width: tableW - 10 }
     );

  doc.end();

  if (returnBuffer) {
    return new Promise((resolve) => {
      doc.on("end", () => {
        resolve(Buffer.concat(buffers));
      });
    });
  }
};
