"use strict";
// Outgoing email. Never throws into a request: a mail problem is logged and reported as { delivered: false }.
//   smtp    send through a real server (SMTP_HOST...) or Amazon SES's SMTP endpoint
//   outbox  write each message to DATA_DIR/outbox/*.json (default without SMTP_HOST; nothing leaves the machine)
//   off     send nothing
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

let transporter = null;
function smtp() {
  if (!transporter) {
    const s = config.mail.smtp;
    transporter = require("nodemailer").createTransport({
      host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    });
  }
  return transporter;
}
const oneLine = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();
const outboxDir = () => path.join(path.dirname(config.uploadDir), "outbox");

async function send({ to, subject, text }) {
  const m = { from: config.mail.from, to: oneLine(to), subject: oneLine(subject), text: String(text) };
  if (!config.mail.enabled) return { delivered: false, mode: "off" };
  try {
    if (config.mail.transport === "outbox") {
      fs.mkdirSync(outboxDir(), { recursive: true, mode: 0o700 });
      const file = path.join(outboxDir(), `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...m, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
      return { delivered: true, mode: "outbox", file };
    }
    await smtp().sendMail(m);
    return { delivered: true, mode: "smtp" };
  } catch (e) {
    console.error(`[mail] could not send "${m.subject}": ${oneLine(e.message)}`);   // never log the body: it holds a sign-in link
    return { delivered: false, mode: config.mail.transport, error: oneLine(e.message) };
  }
}

const base = () => config.mail.appUrl || `http://localhost:${process.env.PORT || 8080}`;
const link = (page, token) => `${base()}/${page}?token=${encodeURIComponent(token)}`;
const sign = "\n\n— EstateOps\nIf you did not expect this email you can ignore it; nothing happens until the link is opened.";

const templates = {
  invitation: ({ to, orgName, role, token, days }) => ({ to, subject: `You have been invited to ${orgName} on EstateOps`,
    text: `You have been invited to join ${orgName} as ${String(role).toLowerCase()}.\n\nCreate your account here (the link works once and expires in ${days} days):\n${link("accept.html", token)}${sign}` }),
  managerReset: ({ to, name, token, hours }) => ({ to, subject: "Reset your EstateOps password",
    text: `Hello ${oneLine(name)},\n\nYour property manager has issued a password reset for your account. Choose a new password here (the link works once and expires in ${hours} hours):\n${link("accept.html", token)}${sign}` }),
  forgot: ({ to, name, token, hours }) => ({ to, subject: "Reset your EstateOps password",
    text: `Hello ${oneLine(name)},\n\nSomeone asked to reset the password for this account. If that was you, choose a new password here (the link works once and expires in ${hours} hours):\n${link("reset.html", token)}${sign}` }),
  verify: ({ to, name, token, hours }) => ({ to, subject: "Confirm your email address for EstateOps",
    text: `Hello ${oneLine(name)},\n\nPlease confirm this email address so your property manager can link you to your home (the link works once and expires in ${hours} hours):\n${link("verify.html", token)}${sign}` }),
};
const sendTemplate = (name, data) => send(templates[name](data));
module.exports = { send, sendTemplate, templates, link };
