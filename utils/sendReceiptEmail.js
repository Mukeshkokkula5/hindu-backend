const sendMail = require("./sendMail");
const { publicDonationReceiptTemplate } = require("./emailTemplates");
const generateReceiptPDF = require("./receiptPdf");

module.exports = async function sendReceiptEmail(donation) {
  try {
    const {
      donor_email,
      donor_name,
      receipt_no,
      amount,
      fund_name,
      receipt_date,
    } = donation;

    const frontendBase = (process.env.FRONTEND_URL || "https://www.hinduswarajyouth.online").replace(/\/$/, "");
    const verifyUrl = `${frontendBase}/receipts/${receipt_no}`;

    // Build receipt object for PDF
    const receipt = {
      receipt_no,
      name: donor_name,
      fund_name,
      amount,
      receipt_date,
      verifyUrl,
    };

    // 🔥 Generate SAME professional PDF used by member & public download
    const pdfBuffer = await generateReceiptPDF(null, receipt, true);

    const html = publicDonationReceiptTemplate({
      name: donor_name,
      receiptNo: receipt_no,
      amount,
      fund: fund_name,
      date: new Date(receipt_date).toDateString(),
      verifyUrl,
    });

    await sendMail(
      donor_email,
      "Your Donation Receipt – Hinduswaraj Youth Welfare Association",
      html,
      [
        {
          filename: `${receipt_no}.pdf`,
          content: pdfBuffer,
        },
      ]
    );

    // 📱 Automated WhatsApp Receipt Dispatch (temporarily disabled per user directive)
    // const { sendDonationReceiptWhatsApp } = require("../services/whatsappBot");
    // await sendDonationReceiptWhatsApp(donation);

    return true;
  } catch (err) {
    console.error("❌ SEND RECEIPT EMAIL FAILED:", err.message);
    return false;
  }
};
