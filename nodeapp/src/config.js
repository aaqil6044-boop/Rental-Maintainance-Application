"use strict";
const path = require("path");

const production = process.env.NODE_ENV === "production";
const secret = process.env.JWT_SECRET;

if (production && (!secret || secret.length < 32)) {
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters when NODE_ENV=production.");
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");

module.exports = {
  production,
  jwtSecret: secret || "dev-only-secret-never-use-in-production-0000",
  jwtTtl: process.env.JWT_TTL || "12h",
  dataDir,
  uploadDir: process.env.UPLOAD_DIR || path.join(dataDir, "uploads"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024,
  maxAttachmentsPerRequest: 10,
  setupKey: process.env.SETUP_KEY || null,          // required to create the first admin when in production
  corsOrigin: process.env.CORS_ORIGIN || null,      // leave empty when UI and API share one origin
  inviteTtlDays: Number(process.env.INVITE_TTL_DAYS) || 7,
  seedDev: !production && process.env.SEED_DEV === "1",
  gemini: {
    key: process.env.GEMINI_API_KEY || null,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 12000,
  },
};
