"use strict";
// Consistent backup of the database and the uploaded files, safe while the app is running.
//   node scripts/backup.js [--out backups] [--keep 14]
//   npm run backup
// Uses SQLite's online backup (a point-in-time copy, never a half-written file), then verifies the copy and prunes old backups.
// DATA_DIR / UPLOAD_DIR are read exactly as the app reads them. Restore: stop the app, copy estateops.db and uploads/ back.
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt; };
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const uploadDir = process.env.UPLOAD_DIR || path.join(dataDir, "uploads");
const outRoot = path.resolve(arg("out", process.env.BACKUP_DIR || "backups"));
const keep = Math.max(1, Number(arg("keep", process.env.BACKUP_KEEP || 14)));

(async () => {
  const dbFile = path.join(dataDir, "estateops.db");
  if (!fs.existsSync(dbFile)) { console.error(`No database at ${dbFile}. Set DATA_DIR to the folder the app uses.`); process.exit(1); }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(outRoot, "estateops-" + stamp);
  fs.mkdirSync(dest, { recursive: true });

  const src = new Database(dbFile, { readonly: true, fileMustExist: true });
  try { await src.backup(path.join(dest, "estateops.db")); } finally { src.close(); }

  const copy = new Database(path.join(dest, "estateops.db"), { readonly: true });
  const check = copy.pragma("integrity_check", { simple: true });
  const accounts = copy.prepare("SELECT COUNT(*) n FROM accounts").get().n, requests = copy.prepare("SELECT COUNT(*) n FROM requests").get().n;
  copy.close();
  if (check !== "ok") { console.error("The backup failed its integrity check: " + check); fs.rmSync(dest, { recursive: true, force: true }); process.exit(2); }

  let files = 0;
  if (fs.existsSync(uploadDir)) { fs.cpSync(uploadDir, path.join(dest, "uploads"), { recursive: true }); files = fs.readdirSync(path.join(dest, "uploads")).length; }
  fs.writeFileSync(path.join(dest, "MANIFEST.txt"), `EstateOps backup\ncreated: ${new Date().toISOString()}\naccounts: ${accounts}\nrequests: ${requests}\nuploads: ${files}\nintegrity_check: ${check}\n`);

  const old = fs.readdirSync(outRoot).filter((d) => d.startsWith("estateops-")).sort().reverse().slice(keep);
  for (const d of old) fs.rmSync(path.join(outRoot, d), { recursive: true, force: true });
  console.log(`Backup written to ${dest}\n  accounts ${accounts}, requests ${requests}, uploaded files ${files}, integrity ${check}` + (old.length ? `\n  removed ${old.length} older backup(s), keeping ${keep}` : ""));
})().catch((e) => { console.error("Backup failed: " + e.message); process.exit(1); });
