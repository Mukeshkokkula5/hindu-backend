const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");
const pool = require("../db");

async function generateMinutesPDF(meetingId) {
  const { rows } = await pool.query(`
    SELECT 
      m.*, 
      a.name AS association_name,
      a.registration_no,
      a.address,
      a.president_name,
      a.secretary_name
    FROM meetings m
    JOIN association_info a ON a.id = 1
    WHERE m.id = $1
  `, [meetingId]);

  if (!rows.length) return;
  const m = rows[0];
  

  const attendees = await pool.query(`
    SELECT u.name
    FROM meeting_attendance ma
    JOIN users u ON u.id = ma.user_id
    WHERE ma.meeting_id = $1 AND ma.status='PRESENT'
  `, [meetingId]);

  const resolutions = await pool.query(`
    SELECT title, status, yes_count, no_count
    FROM meeting_resolutions
    WHERE meeting_id = $1
  `, [meetingId]);

  const minutesNo = `MIN/HSY/${new Date().getFullYear()}/${String(meetingId).padStart(4,"0")}`;

  const dir = path.join(__dirname, "../uploads/minutes");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `minutes_${meetingId}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(fs.createWriteStream(filePath));

  const logoPath = path.join(__dirname, "../uploads/logo.png");
  const sealPath = path.join(__dirname, "../uploads/seal.png");

  /* PAGE BORDER */
  doc.rect(25, 25, 545, 792 - 50).stroke();

  /* HEADER */
  doc.rect(40, 40, 515, 80).stroke();

  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 50, 50, { width: 60 });
  }

  doc.font("Helvetica-Bold").fontSize(16)
    .text(m.association_name, 40, 55, { width: 515, align: "center" });

  doc.font("Helvetica").fontSize(10)
    .text(`Reg No: ${m.registration_no}`, { align: "center" })
    .text(m.address, { align: "center" });

  /* TITLE */
  doc.rect(40, 135, 515, 45).stroke();
  doc.font("Helvetica-Bold").fontSize(14)
    .text("MINUTES OF MEETING", 40, 150, { width: 515, align: "center" });

  doc.fontSize(9)
    .text(`Minutes No: ${minutesNo}`, { align: "center" });

  /* MEETING INFO */
  doc.rect(40, 190, 515, 90).stroke();
  doc.fontSize(11)
    .text(`Meeting Title : ${m.title}`, 55, 205)
    .text(`Meeting Date  : ${new Date(m.meeting_date).toLocaleString()}`)
    .text(`Place         : ${m.location || "-"}`);

  /* AGENDA */
  doc.rect(40, 290, 515, 120).stroke();
  doc.font("Helvetica-Bold").text("AGENDA", 55, 305);
  doc.font("Helvetica")
    .text(m.agenda || "No agenda", 55, 330, { width: 485 });

  /* ATTENDANCE */
  doc.rect(40, 420, 515, 120).stroke();
  doc.font("Helvetica-Bold").text("MEMBERS PRESENT", 55, 435);

  let y = 460;
  attendees.rows.forEach((a, i) => {
    doc.text(`${i+1}. ${a.name}`, 55, y);
    y += 18;
  });

  /* RESOLUTIONS */
  doc.rect(40, 550, 515, 120).stroke();
  doc.font("Helvetica-Bold").text("RESOLUTIONS", 55, 565);

  let ry = 590;
  resolutions.rows.forEach((r, i) => {
    doc.font("Helvetica")
      .text(`${i+1}. ${r.title} - ${r.status} (YES ${r.yes_count} / NO ${r.no_count})`, 55, ry);
    ry += 18;
  });

  /* SIGNATURES */
  doc.rect(40, 680, 515, 60).stroke();
  doc.text("President", 80, 695);
  doc.text("Secretary", 360, 695);
  doc.text("__________________", 80, 715);
  doc.text("__________________", 360, 715);

  /* SEAL */
  if (fs.existsSync(sealPath)) {
    doc.image(sealPath, 230, 690, { width: 80 });
  }

  /* QR */
  const qr = await QRCode.toDataURL(`Minutes: ${minutesNo}`);
  doc.image(Buffer.from(qr.split(",")[1], "base64"), 470, 690, { width: 60 });

  doc.end();

  await pool.query(
    "UPDATE meetings SET minutes_pdf=$1 WHERE id=$2",
    [`uploads/minutes/minutes_${meetingId}.pdf`, meetingId]
  );

  return `uploads/minutes/minutes_${meetingId}.pdf`;
}

module.exports = { generateMinutesPDF };
