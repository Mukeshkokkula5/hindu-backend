const PDFDocument = require("pdfkit");
const path = require("path");

/**
 * Generate Financial Year Closing PDF
 * @param {Response} res
 * @param {Object} data
 */
module.exports = async function generateYearClosingPDF(res, data) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });

  /* =========================
     RESPONSE HEADERS
  ========================= */
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=year-closing-${data.year}.pdf`
  );

  doc.pipe(res);

  const logoPath = path.join(__dirname, "../assets/logo.jpeg");

  /* =========================
     WATERMARK
  ========================= */
  try {
    doc.save();
    doc.opacity(0.12);
    doc.image(logoPath, 170, 260, { width: 260 });
    doc.restore();
  } catch (err) {
    // watermark optional
  }

  /* =========================
     HEADER
  ========================= */
  try {
    doc.image(logoPath, 50, 40, { width: 50 });
  } catch (err) {}

  doc
    .fontSize(16)
    .text(
      data.association_name || "HinduSwaraj Youth Welfare Association",
      120,
      40
    )
    .fontSize(10)
    .text("Hyderabad, Telangana", 120, 65);

  doc
    .moveTo(50, 105)
    .lineTo(545, 105)
    .strokeColor("#aaaaaa")
    .stroke();

  doc.moveDown(3);

  /* =========================
     TITLE
  ========================= */
  doc
    .fontSize(14)
    .text(`Financial Year Closing Report – ${data.year}`, {
      align: "center",
      underline: true,
    });

  doc.moveDown(2);

  /* =========================
     SUMMARY
  ========================= */
  const formatMoney = value =>
    `₹ ${Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
    })}`;

  doc.fontSize(11);
  doc.text(`Opening Balance : ${formatMoney(data.opening_balance)}`);
  doc.text(`Total Receipts  : ${formatMoney(data.total_receipts)}`);
  doc.text(`Total Cancelled : ${formatMoney(data.total_cancelled)}`);
  doc.text(`Closing Balance : ${formatMoney(data.closing_balance)}`);

  doc.moveDown(2);

  /* =========================
     FUND-WISE SUMMARY (OPTIONAL)
  ========================= */
  if (Array.isArray(data.funds) && data.funds.length > 0) {
    doc.fontSize(12).text("Fund-wise Collection", { underline: true });
    doc.moveDown(1);

    data.funds.forEach(f => {
      doc.fontSize(11).text(
        `${f.fund_name} : ${formatMoney(f.total)}`
      );
    });

    doc.moveDown(2);
  }

  /* =========================
     SIGNATURE SECTION
  ========================= */
  doc.fontSize(11);
  doc.text(`Prepared By : ${data.prepared_by || "System"}`);
  doc.text(`Approved By : ${data.approved_by || "President"}`);

  /* =========================
     FOOTER
  ========================= */
  doc
    .fontSize(9)
    .fillColor("gray")
    .text(
      "This is a system generated document. No manual alteration allowed.",
      50,
      780,
      { align: "center" }
    )
    .fillColor("black");

  doc.end();
};
