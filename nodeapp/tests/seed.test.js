"use strict";
const { isolate, reporter } = require("./helpers");
const DIR = isolate();
const path = require("path");
const { execFileSync } = require("child_process");
const T = reporter("Seed");
const { ok, section } = T;
const cwd = path.join(__dirname, "..");

section("Development seed");
const seed = require("../src/seed");
const S = require("../src/store");
ok("seeds a fresh database", seed() === true);
const before = S.countAccounts();
ok("is idempotent: a second run changes nothing", seed() === false && S.countAccounts() === before);
const roles = S.db.prepare("SELECT role, COUNT(*) n FROM accounts GROUP BY role").all().reduce((m, r) => (m[r.role] = r.n, m), {});
ok("covers all four roles", roles.MANAGER && roles.TECHNICIAN && roles.TENANT && roles.VENDOR);
ok("sample requests span several statuses", S.db.prepare("SELECT COUNT(DISTINCT status) n FROM requests").get().n >= 4);
ok("foreign keys are consistent", S.db.pragma("foreign_key_check").length === 0);

section("Seed is impossible in production");
const base = { PATH: process.env.PATH, DATA_DIR: DIR + "-prod", SEED_DEV: "1", LOG_REQUESTS: "0" };
const run = (env, code) => { try { return execFileSync(process.execPath, ["-e", code], { cwd, env: { ...base, ...env }, stdio: "pipe" }).toString().trim(); } catch (e) { return "ERR:" + e.stderr.toString().split("\n").find((l) => l.includes("Error")) ; } };
ok("SEED_DEV is ignored when NODE_ENV=production", run({ NODE_ENV: "production", JWT_SECRET: "x".repeat(40) }, "console.log(require('./src/config').seedDev)") === "false");
ok("SEED_DEV is honoured in development", run({ NODE_ENV: "development" }, "console.log(require('./src/config').seedDev)") === "true");
ok("production refuses to start without a real JWT secret", /JWT_SECRET/.test(run({ NODE_ENV: "production" }, "require('./src/config')")));
ok("production refuses a short JWT secret", /JWT_SECRET/.test(run({ NODE_ENV: "production", JWT_SECRET: "short" }, "require('./src/config')")));

section("First administrator in production needs the setup key");
const prodScript = `
process.env.NODE_ENV='production';
const app=require('./server'); const s=app.listen(0,async()=>{
  const b='http://127.0.0.1:'+s.address().port, h={'Content-Type':'application/json'};
  const body=(k)=>JSON.stringify({email:'a@b.co',password:'Str0ngPassw0rd',fullName:'A',organizationName:'O',setupKey:k});
  const r1=await fetch(b+'/api/setup',{method:'POST',headers:h,body:body('wrong')});
  const r2=await fetch(b+'/api/setup',{method:'POST',headers:h,body:body()});
  const r3=await fetch(b+'/api/setup',{method:'POST',headers:h,body:body('${"k".repeat(24)}')});
  console.log([r1.status,r2.status,r3.status].join(','));
  const st=await (await fetch(b+'/api/setup/status')).json();
  console.log(JSON.stringify(st)); s.close(); });`;
const o = run({ NODE_ENV: "production", JWT_SECRET: "y".repeat(40), SETUP_KEY: "k".repeat(24), SEED_DEV: "" }, prodScript).split("\n");
ok("wrong or missing setup key -> 403, right key -> 201", o[0] === "403,403,201", o);
ok("production setup page asks for the key", JSON.parse(o[1]).requiresSetupKey === true);

require("fs").rmSync(DIR, { recursive: true, force: true });
require("fs").rmSync(DIR + "-prod", { recursive: true, force: true });
T.done();
