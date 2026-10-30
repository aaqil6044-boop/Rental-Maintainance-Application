#!/usr/bin/env node
"use strict";
// Applies the retention rules (RETENTION_REQUEST_DAYS, RETENTION_AUDIT_DAYS) once and exits. Run it from cron or a scheduled task.
// With no settings it only tidies long-dead session rows. Add --dry-run to see what would go.
process.env.NODE_ENV = process.env.NODE_ENV || "production";
const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const dry = process.argv.includes("--dry-run");

const { requestDays, auditDays } = config.retention;
if (!requestDays && !auditDays) console.log("No retention period is set (RETENTION_REQUEST_DAYS / RETENTION_AUDIT_DAYS). Only old session rows will be tidied.");
else console.log(`Retention: closed requests older than ${requestDays || "(kept)"} days, audit entries older than ${auditDays || "(kept)"} days.`);

if (dry) {
  const S = require("../src/store");
  const cut = (d) => new Date(Date.now() - d * 86400000).toISOString();
  const r = requestDays ? S.db.prepare("SELECT COUNT(*) n FROM requests WHERE status = 'CLOSED' AND COALESCE(closed_at, updated_at) < ?").get(cut(requestDays)).n : 0;
  const a = auditDays ? S.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE created_at < ?").get(cut(auditDays)).n : 0;
  console.log(`Would remove ${r} closed request(s) with their comments, history, expenses and files, and ${a} audit entries.`);
  process.exit(0);
}
const out = require("../src/privacy").applyRetention();
for (const name of out.attachments) {
  try { fs.unlinkSync(path.join(config.uploadDir, path.basename(name))); } catch (e) { if (e.code !== "ENOENT") console.error(`could not remove ${name}: ${e.message}`); }
}
console.log(`Removed ${out.requests} closed request(s), ${out.attachments.length} file(s), ${out.auditEntries} audit entries and ${out.sessions} finished session rows.`);
