import nodemailer from "nodemailer";
import { config } from "./config.js";

const smtpConfigured = Boolean(
  config.smtp.host && config.smtp.port && config.smtp.user && config.smtp.pass && config.smtp.from,
);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    })
  : null;

export async function sendRegistrationOtp(email: string, otpCode: string) {
  if (!transporter) {
    throw new Error("SMTP is not configured");
  }

  await transporter.sendMail({
    from: config.smtp.from,
    to: email,
    subject: "Your registration verification code",
    text: [
      `Your verification code is: ${otpCode}`,
      "",
      "This code expires in 10 minutes.",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
  });
}
