/* =====================================================
   🧩 COMMON HEADER & FOOTER (HSY BRANDING)
===================================================== */

const header = `
  <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#0b1320;padding:30px 15px;margin:0;color:#1e293b;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.35);border:1px solid #1e3a5f;">
      <!-- TOP GOLD STRIPE -->
      <div style="height:5px;background:linear-gradient(90deg, #b45309 0%, #d4af37 30%, #fef08a 50%, #d4af37 70%, #b45309 100%);"></div>
      
      <!-- BRAND HEADER BLOCK -->
      <div style="background:linear-gradient(135deg, #091929 0%, #0f2942 60%, #163659 100%);padding:24px 20px 20px 20px;text-align:center;">
        <img src="https://www.hinduswarajyouth.online/images/logo_v2.png" alt="HSYWA Logo" style="width:72px;height:auto;margin-bottom:12px;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.4));" />
        <h1 style="color:#ffffff;font-size:17px;letter-spacing:0.8px;margin:0 0 4px 0;font-weight:800;text-transform:uppercase;">
          HINDUSWARAJ YOUTH WELFARE ASSOCIATION
        </h1>
        <div style="color:#f59e0b;font-size:13px;font-weight:700;margin-bottom:8px;letter-spacing:0.3px;">
          హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్
        </div>
        <div style="display:inline-block;background:rgba(255,255,255,0.1);border:1px solid rgba(212,175,55,0.4);border-radius:20px;padding:3px 12px;color:#fef08a;font-size:10.5px;font-weight:600;letter-spacing:0.5px;">
          Govt. Regd. Society No: 784/2025 • Jagtial, Telangana
        </div>
      </div>

      <!-- MAIN BODY CONTAINER -->
      <div style="padding:28px 25px 20px 25px;">
`;

const footer = `
      </div>

      <!-- OFFICIAL BRAND FOOTER -->
      <div style="background:#091929;border-top:1px solid #1e3a5f;padding:22px 20px;text-align:center;color:#94a3b8;font-size:11.5px;line-height:1.7;">
        <div style="color:#f59e0b;font-weight:700;font-size:12.5px;margin-bottom:4px;">
          HINDUSWARAJ YOUTH WELFARE ASSOCIATION
        </div>
        <div style="color:#cbd5e1;font-size:11.5px;margin-bottom:8px;">
          📍 Registered Office: H.No. 4-1-140, Vani Nagar, Jagtial, Telangana – 505327
        </div>
        <div style="color:#94a3b8;font-size:11px;margin-bottom:12px;">
          📞 Helpline: <b>+91 84998 78425</b> &nbsp;|&nbsp; 📧 Email: <b>hinduswarajyouth@gmail.com</b><br/>
          🌐 Web: <a href="https://www.hinduswarajyouth.online" style="color:#38bdf8;text-decoration:none;">www.hinduswarajyouth.online</a>
        </div>
        <div style="height:1px;background:rgba(255,255,255,0.1);margin:12px 0;"></div>
        <div style="font-size:10px;color:#64748b;">
          This is an official computer-generated communication from Hindu Swaraj Youth Welfare Association.
        </div>
      </div>
      <!-- BOTTOM GOLD STRIPE -->
      <div style="height:4px;background:linear-gradient(90deg, #b45309 0%, #d4af37 50%, #b45309 100%);"></div>
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

<!-- HERO ACKNOWLEDGMENT BANNER -->
<div style="text-align:center;margin-bottom:24px;">
  <span style="display:inline-block;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:5px 16px;border-radius:24px;font-size:11.5px;font-weight:700;letter-spacing:0.5px;margin-bottom:10px;">
    ✓ OFFICIAL CONTRIBUTION VOUCHER • అధికారిక రసీదు
  </span>
  <h2 style="color:#0f2942;margin:6px 0 4px 0;font-size:22px;font-weight:800;">
    🙏 Thank You for Your Noble Seva
  </h2>
  <div style="color:#d97706;font-size:15px;font-weight:700;">
    మీ విలువైన విరాళానికి మా హృదయపూర్వక ధన్యవాదాలు
  </div>
</div>

<p style="font-size:14px;color:#334155;line-height:1.7;margin:0 0 10px 0;">
  Dear / ప్రియమైన <b>${name}</b> గారికి,
</p>

<p style="font-size:13.5px;color:#475569;line-height:1.7;margin:0 0 18px 0;">
  Thank you for your generous contribution to <b>Hinduswaraj Youth Welfare Association</b>. Your support empowers our social welfare, emergency relief, and dharmic seva initiatives in Jagtial. Your donation has been successfully received and officially recorded.
  <br/><br/>
  <span style="color:#1e293b;font-weight:500;">
  హిందూ స్వరాజ్ యూత్ వెల్ఫేర్ అసోసియేషన్ కి మీరు అందించిన పవిత్రమైన విరాళం విజయవంతంగా స్వీకరించబడింది మరియు లెక్కలలో నమోదు చేయబడింది. సమాజ సేవలో మీ భాగస్వామ్యం ఎంతో అమూల్యమైనది.
  </span>
</p>

<!-- HIGHLIGHT DONATION CARD -->
<div style="background:linear-gradient(180deg, #fffdf8 0%, #fffbf0 100%);border:1.5px solid #d4af37;border-radius:12px;padding:20px;margin:22px 0;box-shadow:0 4px 14px rgba(212,175,55,0.15);">
  
  <!-- AMOUNT DISPLAY -->
  <div style="text-align:center;padding-bottom:16px;border-bottom:1px dashed #cbd5e1;margin-bottom:16px;">
    <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">
      Total Donation Amount / విరాళం మొత్తం
    </div>
    <div style="font-size:32px;font-weight:900;color:#047857;letter-spacing:-0.5px;">
      ₹ ${Number(amount).toLocaleString("en-IN")}.00
    </div>
    <div style="display:inline-block;background:#ecfdf5;color:#065f46;padding:3px 12px;border-radius:12px;font-size:11px;font-weight:700;margin-top:6px;">
      ● PAYMENT STATUS: SUCCESS / విజయవంతమైంది
    </div>
  </div>

  <!-- TABLE DETAILS -->
  <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1e293b;">
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:9px 6px;color:#64748b;font-weight:600;width:42%;">
        Receipt Number / రసీదు సంఖ్య:
      </td>
      <td style="padding:9px 6px;font-weight:700;color:#0f2942;font-family:monospace;font-size:13.5px;">
        ${receiptNo}
      </td>
    </tr>
    <tr style="border-bottom:1px solid #f1f5f9;background:rgba(248,250,252,0.6);">
      <td style="padding:9px 6px;color:#64748b;font-weight:600;">
        Donor Name / దాత పేరు:
      </td>
      <td style="padding:9px 6px;font-weight:700;color:#0f172a;">
        ${name}
      </td>
    </tr>
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:9px 6px;color:#64748b;font-weight:600;">
        Allocated Fund / సేవా విభాగం:
      </td>
      <td style="padding:9px 6px;font-weight:700;color:#1e40af;">
        ${fund}
      </td>
    </tr>
    <tr style="border-bottom:1px solid #f1f5f9;background:rgba(248,250,252,0.6);">
      <td style="padding:9px 6px;color:#64748b;font-weight:600;">
        Payment Mode / చెల్లింపు విధానం:
      </td>
      <td style="padding:9px 6px;font-weight:600;color:#047857;">
        Razorpay Online (UPI / Cards)
      </td>
    </tr>
    <tr>
      <td style="padding:9px 6px;color:#64748b;font-weight:600;">
        Receipt Date / జారీ చేసిన తేదీ:
      </td>
      <td style="padding:9px 6px;font-weight:600;color:#334155;">
        ${date}
      </td>
    </tr>
  </table>
</div>

<!-- PDF RECEIPT ATTACHED BADGE -->
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #0f2942;border-radius:6px;padding:14px;margin:18px 0;">
  <div style="font-weight:700;color:#0f2942;font-size:13px;margin-bottom:4px;">
    📎 Official PDF Receipt Attached to This Email
  </div>
  <div style="color:#475569;font-size:12px;line-height:1.6;">
    మీ రసీదు యొక్క అధికారిక PDF ఫైల్ (డిజిటల్ సంతకాలు మరియు క్యూఆర్ కోడ్‌తో) ఈ ఇమెయిల్‌కు జతచేయబడింది. మీరు మీ రికార్డుల కొరకు లేదా ఆడిట్ కోసం దీనిని డౌన్‌లోడ్ చేసుకోవచ్చు.
  </div>
</div>

<!-- LIVE VERIFY CTA -->
<div style="background:linear-gradient(135deg, #091929 0%, #0f2942 100%);border-radius:10px;padding:20px;margin:22px 0;text-align:center;box-shadow:0 4px 16px rgba(15,41,66,0.2);">
  <div style="color:#fef08a;font-size:12px;font-weight:700;letter-spacing:0.5px;margin-bottom:6px;">
    🔐 LIVE DIGITAL VERIFICATION • రసీదు ధృవీకరణ
  </div>
  <p style="color:#ffffff;font-size:12.5px;margin:0 0 15px 0;line-height:1.5;">
    Click below to verify this official receipt in real time on our official portal:
  </p>
  <div>
    <a href="${verifyUrl}"
       target="_blank"
       style="display:inline-block;background:linear-gradient(90deg, #d4af37 0%, #f59e0b 100%);color:#0f2942;padding:12px 28px;text-decoration:none;border-radius:30px;font-weight:800;font-size:13.5px;letter-spacing:0.5px;box-shadow:0 4px 15px rgba(212,175,55,0.4);">
      🔍 Verify Official Receipt / రసీదు ధృవీకరణ
    </a>
  </div>
</div>

<p style="font-size:11.5px;color:#64748b;line-height:1.6;margin:16px 0 0 0;text-align:center;">
  Contributions to Hindu Swaraj Youth Welfare Association are utilized strictly for registered association objectives under Society Byelaws.
</p>

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


