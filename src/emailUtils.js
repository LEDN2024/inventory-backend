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
    text: `Current stock for "${itemType}" at "${storeName}" has fallen below your set threshold. Current stock: ${currentCount}.`,
  };

  await transporter.sendMail(mailOptions);
}

async function sendResetEmail(to, token) {
  const resetUrl = `http://localhost:5173/reset-password?token=${token}`; // Update if hosted
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject: "Reset your ScoopBase password",
    text: `You've requested to reset your password. Click the link below:\n\n${resetUrl}\n\nIf you didn’t request this, ignore this message.`,
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendEmail };
module.exports = { sendEmail, sendResetEmail };