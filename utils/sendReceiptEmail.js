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

    const verifyUrl = `${process.env.BASE_URL}/receipts/verify/${receipt_no}`;

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

    return true;
  } catch (err) {
    console.error("❌ SEND RECEIPT EMAIL FAILED:", err.message);
    return false;
  }
};
