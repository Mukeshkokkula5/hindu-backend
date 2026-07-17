/* =====================================================
   🧩 COMMON HEADER & FOOTER (HSY BRANDING)
===================================================== */

const header = `
  <div style="font-family:Arial,sans-serif;background:#f4f6f8;padding:30px">
    <div style="max-width:550px;margin:auto;background:#ffffff;padding:25px;border-radius:8px">
      <h2 style="color:#0d47a1;text-align:center;margin-bottom:5px">
        HINDUSWARAJ YOUTH WELFARE ASSOCIATION
      </h2>
      <p style="text-align:center;font-size:13px;color:#555">
        Aravind Nagar, Jagtial – 505327<br/>
        📞 8499878425 | 📧 hinduswarajyouth@gmail.com
      </p>
      <hr/>
`;

const footer = `
      <br/>
      <p style="font-size:13px;color:#555">
        Regards,<br/>
        <b>HSY Admin Team</b>
      </p>
    </div>
  </div>
`;

/* ===============================
   🔐 FORGOT PASSWORD – OTP
================================ */
exports.forgotPasswordTemplate = ({ name, otp }) => `
${header}

<p>Dear <b>${name}</b>,</p>

<p>
We received a request to reset your account password.
Please use the OTP below to continue.
</p>

<div style="
  font-size:22px;
  font-weight:bold;
  text-align:center;
  letter-spacing:4px;
  background:#eef3ff;
  padding:12px;
  margin:20px 0;
  border-radius:6px;
  color:#0d47a1">
  ${otp}
</div>

<p>⏱️ This OTP is valid for <b>10 minutes</b>.</p>

<p style="color:#d32f2f">
If you did not request this, please ignore this email.
</p>

${footer}
`;

/* ===============================
   ✅ PASSWORD RESET SUCCESS
================================ */
exports.passwordResetSuccessTemplate = ({ name }) => `
${header}

<h3 style="color:#2e7d32">Password Reset Successful ✅</h3>

<p>Dear <b>${name}</b>,</p>

<p>Your password has been updated successfully.</p>

<p>You can now login using your new password.</p>

<p style="color:#d32f2f">
⚠️ If this was not done by you, contact admin immediately.
</p>

${footer}
`;

/* ===============================
   👤 ADD MEMBER – WELCOME MAIL
================================ */
exports.addMemberTemplate = ({ name, username, memberId, password }) => `
${header}

<h3 style="color:#0d47a1">Welcome to HSY Association 🎉</h3>

<p>Dear <b>${name}</b>,</p>

<p>
You have been successfully added as a member of
<b>Hinduswaraj Youth Welfare Association</b>.
</p>

<h4>🔐 Login Details</h4>

<table style="width:100%;border-collapse:collapse">
  <tr>
  <td style="padding:6px"><b>Association ID</b></td>
  <td style="padding:6px">${username}</td>
</tr>
<tr>
  <td style="padding:6px"><b>Member ID</b></td>
  <td style="padding:6px">${memberId}</td>
</tr>
<tr>
  <td style="padding:6px"><b>Temporary Password</b></td>
  <td style="padding:6px">${password}</td>
</tr>


<p style="color:#d32f2f">
⚠️ Please change your password after first login.
</p>

${footer}
`;

/* ===============================
   🔁 RESEND LOGIN CREDENTIALS
================================ */
exports.resendLoginTemplate = ({ username, password }) => `
${header}

<h3 style="color:#0d47a1">Login Credentials Reset 🔁</h3>

<p>Dear Member,</p>

<p>
Your login credentials have been reset by the administrator.
Please find your updated login details below.
</p>

<h4>🔐 Updated Login Details</h4>

<table style="width:100%;border-collapse:collapse">
  <tr>
    <td style="padding:6px"><b>Username</b></td>
    <td style="padding:6px">${username}</td>
  </tr>
  <tr>
    <td style="padding:6px"><b>Temporary Password</b></td>
    <td style="padding:6px">${password}</td>
  </tr>
</table>

<p style="color:#d32f2f">
⚠️ For security reasons, please change your password immediately after login.
</p>

${footer}
`;

/* ===============================
   📢 ANNOUNCEMENT EMAIL (BILINGUAL ✅ FINAL)
================================ */
exports.announcementTemplate = ({
  title,
  message_en,
  message_te,
  category = "GENERAL",
  priority = "NORMAL",
  expiry_date,
  viewUrl,
}) => `
${header}

<h3 style="color:#0d47a1">📢 ${title}</h3>

<table style="width:100%;border-collapse:collapse;margin:15px 0">
  <tr>
    <td style="padding:6px"><b>Category</b></td>
    <td style="padding:6px">${category}</td>
  </tr>
  <tr>
    <td style="padding:6px"><b>Priority</b></td>
    <td style="padding:6px">
      ${priority === "PINNED" ? "📌 Important" : "Normal"}
    </td>
  </tr>
  ${
    expiry_date
      ? `
  <tr>
    <td style="padding:6px"><b>Valid Till</b></td>
    <td style="padding:6px">${expiry_date}</td>
  </tr>`
      : ""
  }
</table>

<!-- ENGLISH -->
${
  message_en
    ? `
<div style="background:#eef3ff;padding:15px;border-radius:6px">
  <h4>📘 English</h4>
  <p style="line-height:1.6">${message_en}</p>
</div>
`
    : ""
}

<br/>

<!-- TELUGU -->
${
  message_te
    ? `
<div style="background:#e8f5e9;padding:15px;border-radius:6px">
  <h4>📗 తెలుగు</h4>
  <p style="line-height:1.8;font-family:Noto Sans Telugu,Arial">
    ${message_te}
  </p>
</div>
`
    : ""
}

<!-- CTA BUTTON -->
${
  viewUrl
    ? `
<div style="text-align:center;margin:25px 0">
  <a href="${viewUrl}"
     style="
       background:#0d47a1;
       color:#ffffff;
       padding:12px 22px;
       text-decoration:none;
       border-radius:6px;
       font-weight:bold;
       display:inline-block
     ">
     🔎 View Announcement
  </a>
</div>
`
    : ""
}

${footer}
`;
/* ===============================
   🧾 PUBLIC DONATION RECEIPT EMAIL
================================ */
exports.publicDonationReceiptTemplate = ({
  name,
  receiptNo,
  amount,
  fund,
  date,
  verifyUrl,
}) => `
${header}

<h3 style="color:#2e7d32">🙏 Donation Receipt – Thank You</h3>

<p>Dear <b>${name}</b>,</p>

<p>
Thank you for your generous contribution to
<b>Hinduswaraj Youth Welfare Association</b>.
Your donation has been successfully received and officially approved.
</p>

<p>
This email serves as the official acknowledgement of your donation.
Please find your receipt details below.
</p>

<h4>🧾 Receipt Details</h4>

<table style="width:100%;border-collapse:collapse;margin:15px 0">
  <tr><td><b>Receipt Number</b></td><td>${receiptNo}</td></tr>
  <tr><td><b>Donor Name</b></td><td>${name}</td></tr>
  <tr><td><b>Fund</b></td><td>${fund}</td></tr>
  <tr><td><b>Amount</b></td><td>₹ ${Number(amount).toLocaleString("en-IN")}</td></tr>
  <tr><td><b>Date</b></td><td>${date}</td></tr>
</table>

<p>
Your official QR-verified PDF receipt is attached to this email.
You may use it for your records, accounting, or audit purposes.
</p>

<div style="background:#eef3ff;padding:14px;border-radius:6px;margin:20px 0">
  <p>🔐 You can verify the authenticity of this receipt here:</p>
  <p style="text-align:center">
    <a href="${verifyUrl}"
       style="background:#0d47a1;color:#fff;padding:10px 18px;
              text-decoration:none;border-radius:6px;font-weight:bold">
      Verify Receipt
    </a>
  </p>
</div>

<hr/>

<h3 style="color:#0d47a1;font-family:Noto Sans Telugu,Arial">
🙏 మీ విరాళానికి ధన్యవాదాలు
</h3>

<p style="font-family:Noto Sans Telugu,Arial">
ప్రియమైన <b>${name}</b> గారికి,
</p>

<p style="font-family:Noto Sans Telugu,Arial;line-height:1.8">

హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ కి మీరు చేసిన విలువైన విరాళానికి
మా హృదయపూర్వక ధన్యవాదాలు.
మీ విరాళం విజయవంతంగా స్వీకరించబడింది మరియు అధికారికంగా ఆమోదించబడింది.
</p>

<p style="font-family:Noto Sans Telugu,Arial;line-height:1.8">
ఈ ఇమెయిల్ మీ విరాళానికి సంబంధించిన అధికారిక రసీదు ధృవీకరణగా పంపబడింది.
క్రింద మీ రసీదు వివరాలు ఇవ్వబడ్డాయి.
</p>

<table style="width:100%;border-collapse:collapse;font-family:Noto Sans Telugu,Arial">
  <tr><td><b>రసీదు సంఖ్య</b></td><td>${receiptNo}</td></tr>
  <tr><td><b>దాత పేరు</b></td><td>${name}</td></tr>
  <tr><td><b>ఫండ్</b></td><td>${fund}</td></tr>
  <tr><td><b>విరాళం మొత్తం</b></td><td>₹ ${Number(amount).toLocaleString("en-IN")}</td></tr>
  <tr><td><b>తేదీ</b></td><td>${date}</td></tr>
</table>

<p style="font-family:Noto Sans Telugu,Arial;line-height:1.8">
ఈ ఇమెయిల్‌కు జతచేయబడిన PDF రసీదు QR కోడ్ ద్వారా ధృవీకరించబడింది.
మీ రికార్డుల కోసం దీనిని ఉపయోగించుకోవచ్చు.
</p>

<div style="background:#e8f5e9;padding:14px;border-radius:6px;margin:20px 0">
  <p style="font-family:Noto Sans Telugu,Arial">
    🔐 మీ రసీదును ధృవీకరించడానికి ఇక్కడ క్లిక్ చేయండి:
    
  </p>
  <p style="text-align:center">
    <a href="${verifyUrl}"
       style="background:#2e7d32;color:#fff;padding:10px 18px;
              text-decoration:none;border-radius:6px;font-weight:bold">
      రసీదు ధృవీకరణ
    </a>
  </p>
</div>

${footer}
`;
