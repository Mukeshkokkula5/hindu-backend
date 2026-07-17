require("dotenv").config();
const sendMail = require("./utils/sendMail");

(async () => {
  const ok = await sendMail(
  "hinduswarajyouth@gmail.com", // 🔥 SAME AS RESEND ACCOUNT EMAIL
  "Resend Test ✅",
  "<h2>Resend test mail working 🚀</h2>"
);
  console.log("RESULT:", ok);
})();
