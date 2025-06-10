const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendEmail(to, itemType, storeName, currentCount) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: `Low Inventory Alert for ${itemType}`,
    text: `Alert:\n\n"${itemType}" at "${storeName}" is below threshold.\nCurrent stock: ${currentCount}.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Alert email sent to ${to}`);
  } catch (err) {
    console.error(`Failed to send alert email to ${to}:`, err);
  }
}

async function sendResetEmail(to, token) {
  const resetUrl = `${process.env.FRONTEND_BASE_URL}/reset-password?token=${token}`;
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: "Reset your ScoopBase password",
    text: `You've requested to reset your password.\n\nReset link:\n${resetUrl}\n\nIf this wasn't you, you can ignore this message.`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent to ${to}`);
  } catch (err) {
    console.error(`Failed to send reset email to ${to}:`, err);
  }
}

module.exports = { sendEmail, sendResetEmail };