"use strict";
// Time-based one-time passwords (RFC 6238, HMAC-SHA1, 30 s steps, 6 digits) as used by Google Authenticator, Microsoft Authenticator, Authy, 1Password...
// The secret is stored encrypted (AES-256-GCM) with a key derived from MFA_ENC_KEY, or from JWT_SECRET when that is not set.
const crypto = require("crypto");
const config = require("./config");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function unbase32(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=-]/g, "")) {
    const i = ALPHABET.indexOf(ch); if (i < 0) throw new Error("not base32");
    value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
const newSecret = () => base32(crypto.randomBytes(20));

function code(secretBuf, step, digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", secretBuf).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}
const stepAt = (ms = Date.now()) => Math.floor(ms / 30000);

/** Returns the matching time step (so the caller can refuse a replay of the same step), or null. Accepts one step either side for clock drift. */
function verify(secretBase32, given, ms = Date.now()) {
  const g = String(given || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(g)) return null;
  const secret = unbase32(secretBase32), now = stepAt(ms);
  let hit = null;
  for (const s of [now - 1, now, now + 1]) {                      // always compute all three: timing must not show which matched
    const c = code(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(c), Buffer.from(g)) && hit === null) hit = s;
  }
  return hit;
}
const otpauthUrl = (secret, email, issuer = "EstateOps") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

const key = () => crypto.createHash("sha256").update("estateops-mfa|" + (process.env.MFA_ENC_KEY || config.jwtSecret)).digest();
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function open(sealed) {
  const [iv, tag, enc] = String(sealed).split(".").map((p) => Buffer.from(p, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** Ten single-use recovery codes, shown once. Stored only as SHA-256 hashes (they hold 50 bits of randomness each). */
function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => { const h = crypto.randomBytes(5).toString("hex"); return `${h.slice(0, 5)}-${h.slice(5)}`; });
}
const hashRecovery = (c) => crypto.createHash("sha256").update(String(c).toLowerCase().replace(/[^0-9a-f]/g, "")).digest("hex");
const looksLikeRecovery = (c) => /^[0-9a-f]{5}-?[0-9a-f]{5}$/i.test(String(c).trim());

module.exports = { base32, unbase32, newSecret, code, stepAt, verify, otpauthUrl, seal, open, newRecoveryCodes, hashRecovery, looksLikeRecovery };
