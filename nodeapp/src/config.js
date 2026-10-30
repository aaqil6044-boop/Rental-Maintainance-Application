"use strict";
const path = require("path");

const production = process.env.NODE_ENV === "production";
const secret = process.env.JWT_SECRET;

if (production && (!secret || secret.length < 32)) {
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters when NODE_ENV=production.");
}

/** A numeric setting. Missing -> the default. Present but not a number, or outside min..max -> startup stops and names the variable,
 *  so a typo such as RL_LOGIN_MAX=sixty can never be silently ignored. */
function num(name, dflt, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max} (got "${raw}").`);
  return n;
}
/** The time zone people see dates in. Default: the server's own zone (as before). In a container set TIMEZONE, e.g. Asia/Kolkata. */
function zone() {
  const z = process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try { new Intl.DateTimeFormat("en-GB", { timeZone: z }); } catch { throw new Error(`TIMEZONE "${z}" is not a valid IANA time zone (for example Asia/Kolkata or UTC).`); }
  return z;
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");

/** Outgoing email. transport: smtp (a real mail server or Amazon SES's SMTP endpoint), outbox (write each message to a file; the default
 *  when no SMTP_HOST is set, so development and tests never send anything), or off. */
function mailSettings() {
  const transport = process.env.MAIL_TRANSPORT || (process.env.SMTP_HOST ? "smtp" : "outbox");
  if (!["smtp", "outbox", "off"].includes(transport)) throw new Error(`MAIL_TRANSPORT must be smtp, outbox or off (got "${transport}").`);
  if (transport === "smtp" && !process.env.SMTP_HOST) throw new Error("MAIL_TRANSPORT=smtp needs SMTP_HOST.");
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "") || null;
  if (appUrl && !/^https?:\/\/[^\s/]+/.test(appUrl)) throw new Error(`APP_URL must start with http:// or https:// (got "${appUrl}").`);
  if (production && transport === "smtp" && !appUrl) throw new Error("APP_URL (the public address of this site, e.g. https://estateops.example.com) is required in production when email is on: it is used in the links inside emails.");
  return { transport, from: process.env.MAIL_FROM || "EstateOps <no-reply@localhost>", appUrl,
           smtp: { host: process.env.SMTP_HOST || null, port: num("SMTP_PORT", 587, 1, 65535), secure: process.env.SMTP_SECURE === "1",
                   user: process.env.SMTP_USER || null, pass: process.env.SMTP_PASS || null },
           enabled: transport !== "off" };
}
const mail = mailSettings();

module.exports = {
  production,
  mail,
  // Link-by-email needs the tenant to have proven the address. Default: on in production when real email is configured.
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION ? process.env.REQUIRE_EMAIL_VERIFICATION === "1" : (production && mail.transport === "smtp"),
  // Sessions: one row per sign-in (so signing out on one device leaves the others), an optional idle timeout (default 2 h in production), and a cap per account.
  sessionIdleMin: num("SESSION_IDLE_MIN", production ? 120 : 0, 0, 10080),
  maxSessionsPerAccount: num("MAX_SESSIONS", 20, 1, 200),
  // Two-factor sign-in with an authenticator app. Optional for everyone; MFA_REQUIRED_FOR_MANAGERS=1 makes managers enrol before they can use anything else.
  mfa: { requireForManagers: process.env.MFA_REQUIRED_FOR_MANAGERS === "1" },
  // Retention. 0 = keep for ever (the default, and what the application did before). Set in days, e.g. RETENTION_REQUEST_DAYS=2555 for seven years.
  retention: { requestDays: num("RETENTION_REQUEST_DAYS", 0, 0, 36500), auditDays: num("RETENTION_AUDIT_DAYS", 0, 0, 36500) },
  verifyLinkHours: num("VERIFY_LINK_HOURS", 48, 1, 720),
  jwtSecret: secret || "dev-only-secret-never-use-in-production-0000",
  jwtTtl: process.env.JWT_TTL || "12h",
  dataDir,
  uploadDir: process.env.UPLOAD_DIR || path.join(dataDir, "uploads"),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024,
  metricsToken: process.env.METRICS_TOKEN && process.env.METRICS_TOKEN.length >= 16 ? process.env.METRICS_TOKEN : (process.env.METRICS_TOKEN ? (() => { throw new Error("METRICS_TOKEN must be at least 16 characters."); })() : null),
  log: { requests: process.env.LOG_REQUESTS !== "0" && process.env.NODE_ENV !== "test",
         json: process.env.LOG_FORMAT ? process.env.LOG_FORMAT === "json" : production },
  scan: { host: process.env.SCAN_CLAMD_HOST || null, port: num("SCAN_CLAMD_PORT", 3310, 1, 65535),
          timeoutMs: num("SCAN_TIMEOUT_MS", 15000, 100, 300000), failOpen: process.env.SCAN_FAIL_OPEN === "1" },
  maxAttachmentsPerRequest: num("MAX_ATTACHMENTS", 10, 1, 100),
  setupKey: process.env.SETUP_KEY || null,          // required to create the first admin when in production
  corsOrigin: process.env.CORS_ORIGIN || null,      // leave empty when UI and API share one origin
  inviteTtlDays: Number(process.env.INVITE_TTL_DAYS) || 7,
  seedDev: !production && process.env.SEED_DEV === "1",
  timezone: zone(),
  http: {
    bodyLimit: process.env.BODY_LIMIT || "100kb",                       // largest JSON body accepted
    keepAliveMs: num("HTTP_KEEPALIVE_MS", 65000, 1000, 600000),         // must exceed the load balancer's idle timeout (AWS ALB: 60 s), or it sees random resets
    shutdownMs: num("SHUTDOWN_TIMEOUT_MS", 10000, 0, 120000),           // how long a stopping server lets running requests finish
  },
  auth: {
    bcryptRounds: num("BCRYPT_ROUNDS", 10, 4, 15),                      // password hashing cost: +1 doubles the time of every sign-in
    passwordMinLength: num("PASSWORD_MIN_LENGTH", 8, 8, 64),
    maxLoginFailures: num("LOGIN_MAX_FAILURES", 8, 1, 100),             // wrong passwords per email and address before a lockout...
    lockoutMinutes: num("LOGIN_LOCKOUT_MIN", 15, 1, 1440),              // ...lasting this long
    resetLinkHours: num("RESET_LINK_HOURS", 24, 1, 168),                // how long a manager-issued password-reset link works
  },
  // Per client address (see src/ratelimit.js). "Failures" budgets count only refused attempts.
  rateLimits: {
    windowMin: num("RL_WINDOW_MIN", 15, 1, 1440),
    registerMax: num("RL_REGISTER_MAX", 20, 1, 100000), registerWindowMin: num("RL_REGISTER_WINDOW_MIN", 60, 1, 1440),
    loginMax: num("RL_LOGIN_MAX", 60, 1, 100000), setupMax: num("RL_SETUP_MAX", 10, 1, 100000),
    tokenMax: num("RL_TOKEN_MAX", 30, 1, 100000), forgotMax: num("RL_FORGOT_MAX", 10, 1, 100000), mfaMax: num("RL_MFA_MAX", 10, 1, 100000), forgotEmailMax: num("RL_FORGOT_EMAIL_MAX", 3, 1, 1000), passwordMax: num("RL_PASSWORD_MAX", 8, 1, 100000),
  },
  paging: { defaultSize: num("PAGE_SIZE_DEFAULT", 100, 1, 500), maxSize: num("PAGE_SIZE_MAX", 200, 1, 1000) },
  maxAmount: num("MAX_AMOUNT", 10000000, 1),                            // largest expense / quotation amount accepted
  cacheTtlScale: num("CACHE_TTL_SCALE", 1, 0.1, 100),                   // multiplies every response-cache lifetime (0.5 = half as long)
  insights: { windowDays: num("INSIGHTS_WINDOW_DAYS", 90, 1, 3650), recurringMin: num("INSIGHTS_RECURRING_MIN", 2, 2, 100), costFactor: num("INSIGHTS_COST_FACTOR", 2, 1.1, 100) },
  // Abuse protection (src/ratelimit.js). On in production; RATE_LIMIT=0/1 overrides.
  rateLimit: process.env.RATE_LIMIT ? process.env.RATE_LIMIT === "1" : production,
  // Anyone may sign up as a tenant when this is 1 (the default). Set SELF_REGISTRATION=0 if tenants only join by invitation.
  selfRegistration: process.env.SELF_REGISTRATION ? process.env.SELF_REGISTRATION === "1" : true,
  // Interactive API documentation at /docs and /openapi.json. Off in production unless DOCS=1.
  docs: process.env.DOCS ? process.env.DOCS === "1" : !production,
  // Load testing. Off by default in production; every limit can be tightened (never raised past the ceilings in src/loadtest/limits.js).
  loadtest: {
    enabled: process.env.LOADTEST_ENABLED ? process.env.LOADTEST_ENABLED === "1" : !production,
    maxUsers: Number(process.env.LOADTEST_MAX_VUS) || 200,
    maxDurationSec: Number(process.env.LOADTEST_MAX_DURATION_SEC) || 1800,
    maxRequests: Number(process.env.LOADTEST_MAX_REQUESTS) || 500000,
    maxCreates: Number(process.env.LOADTEST_MAX_CREATES) || 2000,
    targets: process.env.LOADTEST_TARGETS || "",             // name=https://host[:port],name2=...
    allowRemote: process.env.LOADTEST_ALLOW_REMOTE === "1",
    remoteAccounts: process.env.LOADTEST_REMOTE_ACCOUNTS || null,   // JSON: [{"persona":"tenant","email":"..","password":".."}]
    abortErrorRatePct: Number(process.env.LOADTEST_ABORT_ERROR_PCT) || 50,
  },
  gemini: {
    key: process.env.GEMINI_API_KEY || null,
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 12000,
  },
};
