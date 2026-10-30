"use strict";
// Configuration, data safety and operations: settings are validated, dates follow TIMEZONE, due dates are real dates,
// the new indexes exist, a running server stops cleanly, and the backup tool produces a verified, restorable copy.
const { isolate, reporter } = require("./helpers");
const dir = isolate();
const T = reporter("Operations");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { execFileSync, spawn } = require("child_process");
const root = path.join(__dirname, "..");
const node = (code, env = {}) => { try { return { out: execFileSync(process.execPath, ["-e", code], { cwd: root, env: { PATH: process.env.PATH, ...env }, stdio: ["ignore", "pipe", "pipe"] }).toString(), err: "" }; } catch (e) { return { out: "", err: String(e.stderr) }; } };

(async () => {
  section("Settings are validated and defaults are unchanged");
  const d = JSON.parse(node('const c=require("./src/config");console.log(JSON.stringify({a:c.auth,r:c.rateLimits,p:c.paging,m:c.maxAmount,i:c.insights,h:c.http,t:c.cacheTtlScale,u:c.maxAttachmentsPerRequest}))', { NODE_ENV: "test" }).out);
  ok(d.a.bcryptRounds === 10 && d.a.passwordMinLength === 8 && d.a.maxLoginFailures === 8 && d.a.lockoutMinutes === 15 && d.a.resetLinkHours === 24, "authentication defaults match the previous behaviour");
  ok(d.r.registerMax === 20 && d.r.loginMax === 60 && d.r.setupMax === 10 && d.r.tokenMax === 30 && d.r.passwordMax === 8 && d.r.windowMin === 15, "rate-limit defaults match the previous behaviour");
  ok(d.p.defaultSize === 100 && d.p.maxSize === 200 && d.m === 10000000 && d.u === 10 && d.t === 1, "paging, amount, attachment and cache defaults match");
  ok(d.i.windowDays === 90 && d.i.recurringMin === 2 && d.i.costFactor === 2 && d.h.bodyLimit === "100kb" && d.h.keepAliveMs === 65000, "insight thresholds, body limit and keep-alive defaults");
  const tuned = JSON.parse(node('const c=require("./src/config");console.log(JSON.stringify({l:c.rateLimits.loginMax,b:c.auth.bcryptRounds,p:c.paging.maxSize}))', { NODE_ENV: "test", RL_LOGIN_MAX: "25", BCRYPT_ROUNDS: "12", PAGE_SIZE_MAX: "50" }).out);
  ok(tuned.l === 25 && tuned.b === 12 && tuned.p === 50, "settings are read from the environment (and therefore from config files)");
  for (const [name, value] of [["RL_LOGIN_MAX", "sixty"], ["BCRYPT_ROUNDS", "99"], ["LOGIN_MAX_FAILURES", "0"], ["PASSWORD_MIN_LENGTH", "3"], ["TIMEZONE", "Mars/Base"]]) {
    const r = node('require("./src/config")', { NODE_ENV: "test", [name]: value });
    ok(r.err.includes(name), `${name}=${value} stops startup and names the variable`);
  }

  section("Dates follow TIMEZONE");
  const show = (tz) => node('const V=require("./src/views");console.log(V.requestView({id:1,title:"t",created_at:"2026-10-29T15:09:00.000Z",updated_at:"2026-03-01T23:30:00.000Z",status:"REPORTED",priority:"LOW",due_date:null}).createdAt+"|"+V.requestView({id:1,title:"t",created_at:"2026-10-29T15:09:00.000Z",updated_at:"2026-03-01T23:30:00.000Z",status:"REPORTED",priority:"LOW"}).updatedAt)', { NODE_ENV: "test", TIMEZONE: tz }).out.trim();
  ok(show("UTC") === "29 Oct 2026, 15:09|01 Mar 2026, 23:30", "UTC shows 15:09 as 15:09", show("UTC"));
  ok(show("Asia/Kolkata") === "29 Oct 2026, 20:39|02 Mar 2026, 05:00", "Asia/Kolkata shows the same moment as 20:39 and rolls over midnight correctly", show("Asia/Kolkata"));
  ok(show("America/New_York") === "29 Oct 2026, 11:09|01 Mar 2026, 18:30", "America/New_York follows daylight-saving rules", show("America/New_York"));
  const od = (tz, due) => node(`const V=require("./src/views");console.log(V.isOverdue({status:"ASSIGNED",due_date:${JSON.stringify(due)}}))`, { NODE_ENV: "test", TIMEZONE: tz }).out.trim();
  const dayIn = (tz, offsetDays) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86400000));
  ok(od("Asia/Kolkata", dayIn("Asia/Kolkata", 0)) === "false" && od("Asia/Kolkata", dayIn("Asia/Kolkata", -1)) === "true", "a request due today is not overdue until that day ends in the configured zone");

  section("Due dates must be real dates");
  const app = require("../server"); const S = require("../src/store"); require("../src/seed")();
  const server = app.listen(0); await new Promise((r) => server.once("listening", r)); const BASE = "http://127.0.0.1:" + server.address().port;
  const call = async (m, p, token, body) => { const r = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { s: r.status, j, h: r.headers }; };
  const mgr = (await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" })).j.token;
  const tech = S.findAccountByEmail("tech@estateops.test").id;
  const open = (await call("GET", "/api/maintenance-requests?status=REPORTED&limit=5", mgr)).j;
  const id = open[0].id;
  for (const bad of ["not-a-date", "2026-02-31", "31/12/2026", "2026-13-01", "2026-1-5", "<script>"]) {
    const r = await call("POST", `/api/maintenance-requests/${id}/assign`, mgr, { technicianId: tech, dueDate: bad });
    ok(r.s === 400, `due date "${bad}" is refused`, r.s);
  }
  let r = await call("POST", `/api/maintenance-requests/${id}/assign`, mgr, { technicianId: tech, dueDate: "2026-12-31" });
  ok(r.s === 200 && r.j.dueDate === "2026-12-31", "a real date is accepted");
  r = await call("POST", `/api/maintenance-requests/${id}/assign`, mgr, { technicianId: tech });
  ok(r.s === 200, "no due date is still allowed");

  section("Indexes");
  const db = require("../src/db");
  const idx = (t) => db.prepare(`PRAGMA index_list(${t})`).all().flatMap((i) => db.prepare(`PRAGMA index_info(${i.name})`).all().map((c) => c.name).slice(0, 1));
  for (const [t, c] of [["requests", "unit_id"], ["requests", "created_at"], ["events", "request_id"], ["comments", "request_id"], ["expenses", "request_id"], ["units", "property_id"]]) ok(idx(t).includes(c), `${t}.${c} is indexed`);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT * FROM events WHERE request_id = 1").all().map((x) => x.detail).join(" ");
  ok(/USING INDEX/i.test(plan), "the history lookup uses an index", plan);
  ok(db.appliedMigrations.length >= 0 && db.prepare("SELECT COUNT(*) n FROM schema_migrations").get().n === 8, "all eight migrations are recorded");

  section("Paging limit comes from settings");
  r = await call("GET", "/api/maintenance-requests?limit=100000", mgr);
  ok(r.s === 200 && r.j.length <= 200, "a huge limit is capped at the configured maximum");

  section("Backup");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-bk-"));
  fs.writeFileSync(path.join(dir, "uploads", "sample.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const runBackup = () => execFileSync(process.execPath, [path.join(root, "scripts", "backup.js"), "--out", out, "--keep", "2"], { env: { PATH: process.env.PATH, DATA_DIR: dir } }).toString();
  const o1 = runBackup();
  ok(/Backup written/.test(o1) && /integrity ok/.test(o1), "a backup is written while the app is running and passes its integrity check", o1);
  const made = fs.readdirSync(out).filter((x) => x.startsWith("estateops-")); const first = path.join(out, made[0]);
  const Database = require("better-sqlite3"); const copy = new Database(path.join(first, "estateops.db"), { readonly: true });
  ok(copy.prepare("SELECT COUNT(*) n FROM accounts").get().n === db.prepare("SELECT COUNT(*) n FROM accounts").get().n, "the copy holds the same accounts as the live database");
  ok(copy.prepare("SELECT COUNT(*) n FROM requests").get().n === db.prepare("SELECT COUNT(*) n FROM requests").get().n, "and the same requests");
  copy.close();
  ok(fs.existsSync(path.join(first, "uploads", "sample.png")) && /accounts:/.test(fs.readFileSync(path.join(first, "MANIFEST.txt"), "utf8")), "uploaded files and a manifest are included");
  await new Promise((r2) => setTimeout(r2, 1100)); runBackup(); await new Promise((r2) => setTimeout(r2, 1100)); runBackup();
  ok(fs.readdirSync(out).filter((x) => x.startsWith("estateops-")).length === 2, "only the newest --keep backups are retained");
  const empty = (() => { try { execFileSync(process.execPath, [path.join(root, "scripts", "backup.js"), "--out", out], { env: { PATH: process.env.PATH, DATA_DIR: path.join(os.tmpdir(), "no-such-estateops-dir") }, stdio: "pipe" }); return 0; } catch (e) { return e.status; } })();
  ok(empty === 1, "a wrong DATA_DIR is reported instead of creating an empty backup");
  server.close();

  section("A stopping server finishes running requests");
  const port = await new Promise((r2) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r2(p)); }); });
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "estateops-stop-"));
  const child = spawn(process.execPath, [path.join(root, "bootstrap.js")], { env: { PATH: process.env.PATH, NODE_ENV: "development", SEED_DEV: "1", PORT: String(port), DATA_DIR: d2, LOG_REQUESTS: "0", SHUTDOWN_TIMEOUT_MS: "5000" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", (x) => (log += x)); child.stderr.on("data", (x) => (log += x));
  for (let i = 0; i < 80 && !/EstateOps running/.test(log); i++) await new Promise((r2) => setTimeout(r2, 100));
  const pending = fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "manager@estateops.test", password: "password123" }) });
  await new Promise((r2) => setTimeout(r2, 20)); child.kill("SIGTERM");
  const answered = await pending.then((x) => x.status).catch(() => "dropped");
  const code = await new Promise((r2) => child.on("exit", r2));
  ok(answered === 200, "a sign-in already in progress when SIGTERM arrives still gets its answer", answered);
  ok(code === 0 && /\[shutdown\] SIGTERM/.test(log), "the process then exits cleanly (code 0) and says why", code);
  const refused = await fetch(`http://127.0.0.1:${port}/health`).then(() => false).catch(() => true);
  ok(refused, "and no longer accepts connections");

  T.done();
})().catch((e) => { console.error(e); process.exit(1); });
