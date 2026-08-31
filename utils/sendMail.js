const { Resend } = require("resend");

/**
 * Helper to check if an email is deliverable and not a dummy/testing domain
 */
const isDeliverableEmail = (email) => {
  if (!email || typeof email !== "string") return false;
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return false;
  if (
    clean.endsWith("@example.com") ||
    clean.endsWith("@test.com") ||
    clean.endsWith("@test.org") ||
    clean.endsWith("@localhost") ||
    clean.endsWith("@hsy.org") // internal usernames unless personal_email
  ) {
    return false;
  }
  return true;
};

/**
 * Send email using verified domain (supports attachments)
 *
 * @param {string} to - recipient email
 * @param {string} subject - email subject
 * @param {string} html - email HTML content
 * @param {Array} attachments - optional attachments (PDF, etc.)
 * @returns {Promise<boolean>}
 */
const sendMail = async (toOrOptions, subjectParam, htmlParam, attachmentsParam = []) => {
  try {
    let to, subject, html, attachments;

    if (typeof toOrOptions === "object" && toOrOptions !== null && !Array.isArray(toOrOptions)) {
      to = toOrOptions.to;
      subject = toOrOptions.subject;
      html = toOrOptions.html;
      attachments = toOrOptions.attachments || [];
    } else {
      to = toOrOptions;
      subject = subjectParam;
      html = htmlParam;
      attachments = attachmentsParam;
    }

    // 🔎 Basic validation
    if (!to || !subject || !html) {
      console.warn(`[sendMail] Missing parameters: to=${Boolean(to)}, subject=${Boolean(subject)}, html=${Boolean(html)}`);
      return false;
    }

    const recipients = (Array.isArray(to) ? to : [to]).map(e => e.trim().toLowerCase());
    const validRecipients = recipients.filter(isDeliverableEmail);

    if (validRecipients.length === 0) {
      console.warn(`[sendMail] Skipped non-deliverable/dummy recipient(s):`, recipients);
      return false;
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: process.env.MAIL_FROM || "noreply@hinduswarajyouth.online",
      to: validRecipients.length === 1 ? validRecipients[0] : validRecipients,
      subject,
      html,
      attachments,
      reply_to: "support@hinduswarajyouth.online",
    });

    if (error) {
      console.error("❌ RESEND ERROR:", error);
      return false;
    }

    console.log("📨 EMAIL SENT SUCCESSFULLY TO:", validRecipients.join(", "), "ID:", data?.id);
    return true;
  } catch (err) {
    console.error("❌ MAIL SEND FAILED:", err.message);
    return false;
  }
};

module.exports = sendMail;

