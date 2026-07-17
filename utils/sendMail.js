const { Resend } = require("resend");

/**
 * Initialize Resend with API Key
 * Ensure RESEND_API_KEY & MAIL_FROM are set in environment
 */
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Send email using verified domain (supports attachments)
 *
 * @param {string} to - recipient email
 * @param {string} subject - email subject
 * @param {string} html - email HTML content
 * @param {Array} attachments - optional attachments (PDF, etc.)
 * @returns {Promise<boolean>}
 */
const sendMail = async (to, subject, html, attachments = []) => {
  try {
    // 🔎 Basic validation
    if (!to || !subject || !html) {
      throw new Error("Missing email parameters");
    }

    const { data, error } = await resend.emails.send({
      from: process.env.MAIL_FROM, // ✅ verified domain
      to: [to],
      subject,
      html,
      attachments, // 📎 PDF / file support
      reply_to: "support@hinduswarajyouth.online",
    });

    if (error) {
      console.error("❌ RESEND ERROR:", error);
      return false;
    }

    console.log("📨 EMAIL SENT SUCCESSFULLY");
    console.log("📨 RESEND MESSAGE ID:", data?.id);

    return true;
  } catch (err) {
    console.error("❌ MAIL SEND FAILED:", err.message);
    return false;
  }
};

module.exports = sendMail;
