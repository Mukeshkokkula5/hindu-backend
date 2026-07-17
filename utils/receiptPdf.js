const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");

/* =========================
   🔢 AMOUNT TO WORDS
========================= */
function amountToWords(num) {
  const a = ["", "One","Two","Three","Four","Five","Six","Seven","Eight","Nine",
    "Ten","Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen","Eighteen","Nineteen"];
  const b = ["", "", "Twenty","Thirty","Forty","Fifty","Sixty","Seventy","Eighty","Ninety"];

  const inWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "");
    return "";
  };

  return inWords(Math.floor(num)) + " Rupees Only";
}

/* =========================
   📄 MAIN PDF GENERATOR
   returnBuffer = true → Email
   returnBuffer = false → Browser
========================= */
module.exports = async function generateReceiptPDF(res, receipt, returnBuffer = false) {
  const {
    receipt_no,
    name,
    fund_name,
    amount,
    receipt_date,
    verifyUrl
  } = receipt;

  // Generate QR
  const qrBuffer = Buffer.from(
    (await QRCode.toDataURL(verifyUrl)).split(",")[1],
    "base64"
  );

  const doc = new PDFDocument({ size: "A4", margin: 50 });

  // 🔥 Buffer support for email
  let buffers = [];
  if (returnBuffer) {
    doc.on("data", buffers.push.bind(buffers));
  } else {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${receipt_no}.pdf`);
    doc.pipe(res);
  }

  /* =========================
     🅰 Unicode Font
  ========================= */
  const fontPath = path.join(__dirname, "../assets/NotoSans-Regular.ttf");
  if (fs.existsSync(fontPath)) {
    doc.registerFont("Noto", fontPath);
    doc.font("Noto");
  }

  /* =========================
     🖼 Assets
  ========================= */
  const logoPath = path.join(__dirname, "../assets/logo.png");
  const sealPath = path.join(__dirname, "../assets/seal.png");

  /* =========================
     🧾 HEADER
  ========================= */
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 30, { width: 90 });
  }

  doc
    .fontSize(16)
    .fillColor("#0d47a1")
    .text("HINDUSWARAJ YOUTH WELFARE ASSOCIATION", 150, 40, { align: "center" });

  doc
    .fontSize(10)
    .fillColor("black")
    .text("Aravind Nagar, Jagtial – 505327", 150, 65, { align: "center" })
    .text("Reg No: 784/25 | Ph: 8499878425", 150, 80, { align: "center" })
    .text("hinduswarajyouth@gmail.com", 150, 95, { align: "center" });

  /* =========================
     📦 MAIN BOX
  ========================= */
  const startY = 140;
  doc.rect(40, startY, 520, 430).stroke();

  doc
    .fontSize(14)
    .fillColor("#c9a227")
    .text("OFFICIAL DONATION RECEIPT", 0, startY + 15, { align: "center" });

  doc.fontSize(11).fillColor("black");

  let y = startY + 70;
  const drawRow = (label, value) => {
    doc.text(label, 80, y);
    doc.text(value, 260, y);
    y += 28;
  };

  drawRow("Receipt No", receipt_no);
  drawRow("Donor / Member", name);
  drawRow("Fund", fund_name);
  drawRow("Amount Paid", `Rs. ${Number(amount).toLocaleString("en-IN")}`);
  drawRow("Amount in Words", amountToWords(amount));
  drawRow("Receipt Date", new Date(receipt_date).toDateString());

  /* =========================
     📱 QR
  ========================= */
  doc
    .fontSize(10)
    .fillColor("#0d47a1")
    .text("Scan QR to verify receipt", 360, startY + 90, { align: "center" });

  doc.image(qrBuffer, 390, startY + 120, { width: 120 });

  /* =========================
     📝 FOOTER
  ========================= */
  doc
    .fontSize(9)
    .fillColor("gray")
    .text(
      "This is a system generated receipt. No signature required.",
      0,
      startY + 350,
      { align: "center" }
    );

  /* =========================
     🏅 SEAL
  ========================= */
  if (fs.existsSync(sealPath)) {
    doc.image(sealPath, 240, startY + 365, { width: 120 });
  }

  doc.end();

  // 🔥 Return buffer for email
  if (returnBuffer) {
    return new Promise(resolve => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });
  }
};
