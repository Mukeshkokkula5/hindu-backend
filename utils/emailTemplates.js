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
   🔑 CHANGE PASSWORD – OTP
================================ */
exports.changePasswordOtpTemplate = ({ name, otp }) => `
${header}

<h3 style="color:#0d47a1">Change Password Verification 🔐</h3>

<p>Dear <b>${name}</b>,</p>

<p>
We received a request to change your account password from within the Hinduswaraj Youth portal.
Please use the following 6-digit One Time Password (OTP) to authorize this change:
</p>

<div style="
  font-size:24px;
  font-weight:bold;
  text-align:center;
  letter-spacing:6px;
  background:#eff6ff;
  border:1px solid #bfdbfe;
  padding:14px;
  margin:20px 0;
  border-radius:8px;
  color:#1d4ed8">
  ${otp}
</div>

<p>⏱️ This OTP is valid for <b>10 minutes</b>.</p>

<p style="color:#dc2626;font-size:13px">
⚠️ <b>Security Notice:</b> Never share this OTP with anyone. If you did not initiate this password change, please contact the Super Admin immediately.
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

/* ===============================
   🤝 VOLUNTEER REGISTRATION ACKNOWLEDGEMENT (BILINGUAL)
================================ */
exports.volunteerRegistrationTemplate = ({
  id,
  name,
  phone,
  interests,
  city,
  blood_group,
  availability,
}) => `
${header}

<div style="text-align:center;margin-bottom:20px">
  <span style="background:#fff7ed;color:#c2410c;padding:6px 14px;border-radius:20px;font-size:12px;font-weight:bold;border:1px solid #ffedd5">
    🚩 RASHTRA SEVA • COMMUNITY WELFARE
  </span>
  <h3 style="color:#c2410c;margin:12px 0 6px 0;font-size:20px">
    Welcome to the Hindu Swaraj Volunteer Family! 🤝
  </h3>
  <p style="color:#64748b;font-size:13px;margin:0">
    Application Reference ID: <b>#VOL-${id || "REG"}</b>
  </p>
</div>

<p>Dear <b>${name}</b>,</p>

<p style="line-height:1.6">
Thank you for stepping forward to serve society with <b>Hinduswaraj Youth Welfare Association</b>.
Your registration has been successfully received and submitted to our core executive team for review.
</p>

<!-- APPLICATION SUMMARY CARD -->
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:20px 0">
  <h4 style="margin:0 0 12px 0;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:8px">
    📋 Your Application Summary
  </h4>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr>
      <td style="padding:6px 0;color:#64748b"><b>Application ID:</b></td>
      <td style="padding:6px 0;color:#0f172a;font-weight:bold">#VOL-${id || "REG"}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#64748b"><b>Full Name:</b></td>
      <td style="padding:6px 0;color:#0f172a">${name}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#64748b"><b>Mobile / WhatsApp:</b></td>
      <td style="padding:6px 0;color:#0f172a">${phone}</td>
    </tr>
    ${
      city
        ? `<tr>
      <td style="padding:6px 0;color:#64748b"><b>City / Area:</b></td>
      <td style="padding:6px 0;color:#0f172a">${city}</td>
    </tr>`
        : ""
    }
    ${
      blood_group
        ? `<tr>
      <td style="padding:6px 0;color:#64748b"><b>Blood Group:</b></td>
      <td style="padding:6px 0;color:#0f172a">${blood_group}</td>
    </tr>`
        : ""
    }
    ${
      availability
        ? `<tr>
      <td style="padding:6px 0;color:#64748b"><b>Availability:</b></td>
      <td style="padding:6px 0;color:#0f172a">${availability}</td>
    </tr>`
        : ""
    }
    ${
      interests
        ? `<tr>
      <td style="padding:6px 0;color:#64748b"><b>Seva Interests:</b></td>
      <td style="padding:6px 0;color:#0f172a">${interests}</td>
    </tr>`
        : ""
    }
    <tr>
      <td style="padding:6px 0;color:#64748b"><b>Status:</b></td>
      <td style="padding:6px 0"><span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:bold">⏳ Pending Review</span></td>
    </tr>
  </table>
</div>

<!-- TIMELINE / WHAT'S NEXT -->
<div style="background:#fff7ed;border-left:4px solid #ea580c;padding:16px;border-radius:4px;margin:20px 0">
  <h4 style="margin:0 0 8px 0;color:#9a3412">⏳ How will you know your status? (What happens next)</h4>
  <ul style="margin:0;padding-left:20px;color:#7c2d12;font-size:13px;line-height:1.7">
    <li><b>1. Application Review:</b> Our President and Seva Coordinators review your profile within 24–48 hours.</li>
    <li><b>2. Status Email &amp; Call:</b> You will receive an official status update email when your application is approved.</li>
    <li><b>3. Direct WhatsApp Contact:</b> Our team will reach out via WhatsApp/Call to welcome you and assign you to upcoming seva drives (Blood donation, Annadanam, Youth camps, or Cultural events).</li>
  </ul>
</div>

<!-- WHATSAPP CONNECT BUTTON -->
<div style="text-align:center;margin:25px 0">
  <a href="https://wa.me/918499878425?text=Hello%20Hindu%20Swaraj%20Team%2C%20I%20have%20registered%20as%20a%20volunteer%20(Ref%3A%20%23VOL-${id || ""})."
     style="
       background:#25d366;
       color:#ffffff;
       padding:12px 24px;
       text-decoration:none;
       border-radius:6px;
       font-weight:bold;
       display:inline-block;
       font-size:14px;
       box-shadow:0 2px 4px rgba(0,0,0,0.1);
     ">
     💬 Connect with Coordinator on WhatsApp
  </a>
</div>

<hr style="border:none;border-top:1px solid #e2e8f0;margin:25px 0" />

<!-- TELUGU SECTION -->
<div style="font-family:'Noto Sans Telugu',Arial,sans-serif;color:#334155">
  <h4 style="color:#c2410c;margin-bottom:8px">
    🙏 సేవా ప్రయాణంలో భాగస్వామ్యం అయినందుకు ధన్యవాదాలు
  </h4>
  <p style="font-size:13px;line-height:1.8">
    ప్రియమైన <b>${name}</b> గారికి,<br/>
    హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ లో వాలంటీర్ గా నమోదు చేసుకున్నందుకు ధన్యవాదాలు.
    మీ దరఖాస్తు మా కార్యవర్గ బృందానికి చేరింది. మా అధ్యక్షులు మరియు సమన్వయకర్తలు మీ దరఖాస్తును పరిశీలించి, త్వరలోనే వాట్సాప్ లేదా ఫోన్ ద్వారా మిమ్మల్ని సంప్రదిస్తారు.
  </p>
</div>

${footer}
`;

/* ===============================
   ✅ VOLUNTEER STATUS UPDATE EMAIL (BILINGUAL)
================================ */
exports.volunteerStatusTemplate = ({ id, name, status, notes }) => {
  const isApproved = status.toUpperCase() === "APPROVED";
  const isContacted = status.toUpperCase() === "CONTACTED";
  const statusColor = isApproved ? "#16a34a" : isContacted ? "#2563eb" : "#d97706";
  const statusBg = isApproved ? "#f0fdf4" : isContacted ? "#eff6ff" : "#fffbeb";
  const statusIcon = isApproved ? "✅" : isContacted ? "📞" : "📋";

  return `
${header}

<div style="text-align:center;margin-bottom:20px">
  <div style="font-size:36px;margin-bottom:8px">${statusIcon}</div>
  <h3 style="color:#0f172a;margin:0 0 6px 0;font-size:20px">
    Volunteer Application Status Update
  </h3>
  <p style="color:#64748b;font-size:13px;margin:0">
    Application Reference ID: <b>#VOL-${id || ""}</b>
  </p>
</div>

<p>Dear <b>${name}</b>,</p>

<p style="line-height:1.6">
This is an official update regarding your volunteer registration with <b>Hinduswaraj Youth Welfare Association</b>.
</p>

<!-- STATUS BADGE CARD -->
<div style="background:${statusBg};border:1px solid ${statusColor};border-radius:8px;padding:16px;margin:20px 0;text-align:center">
  <span style="color:#64748b;font-size:13px;display:block;margin-bottom:4px">Current Application Status:</span>
  <span style="color:${statusColor};font-size:20px;font-weight:bold;letter-spacing:1px">
    ${statusIcon} ${status.toUpperCase()}
  </span>
  ${
    notes
      ? `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #cbd5e1;font-size:13px;color:#334155;text-align:left">
          <b>Coordinator Remarks:</b><br/>${notes}
        </div>`
      : ""
  }
</div>

${
  isApproved
    ? `
<div style="background:#f8fafc;border-left:4px solid #16a34a;padding:14px;border-radius:4px;margin:20px 0;font-size:13px;color:#1e293b;line-height:1.7">
  <b>🎉 Congratulations!</b> Your application to join our youth volunteer brigade has been officially approved.
  You will soon be added to the official Seva Group and invited to our upcoming community programs.
</div>
`
    : ""
}

<div style="text-align:center;margin:25px 0">
  <a href="https://wa.me/918499878425?text=Hello%20Hindu%20Swaraj%20Team%2C%20I%20am%20following%20up%20on%20my%20volunteer%20application%20(%23VOL-${id || ""})."
     style="
       background:#0d47a1;
       color:#ffffff;
       padding:12px 24px;
       text-decoration:none;
       border-radius:6px;
       font-weight:bold;
       display:inline-block;
       font-size:14px;
     ">
     💬 Message Coordinator on WhatsApp
  </a>
</div>

<p style="font-size:13px;color:#64748b;text-align:center">
  For queries or emergency seva coordination, reach us directly at 📞 +91 84998 78425
</p>

${footer}
`;
};


