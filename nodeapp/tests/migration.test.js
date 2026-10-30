"use strict";
// Upgrades a database created by the previous release and checks that nothing is lost.
const { isolate, reporter } = require("./helpers");
const DIR = isolate();
const path = require("path");
const Database = require("better-sqlite3");
const T = reporter("Migration");
const { ok, section } = T;

section("Build a database exactly as the previous release left it");
const old = new Database(path.join(DIR, "estateops.db"));
old.pragma("foreign_keys = ON");
old.exec(`
CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('TENANT','MANAGER','TECHNICIAN')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, property_type TEXT NOT NULL DEFAULT 'complex',
  manager_id INTEGER NOT NULL REFERENCES accounts(id), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE units (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  label TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, UNIQUE (property_id, label COLLATE NOCASE));
CREATE TABLE unit_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE (tenant_id, unit_id));
CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, unit_id INTEGER NOT NULL REFERENCES units(id), reporter_id INTEGER NOT NULL REFERENCES accounts(id),
  technician_id INTEGER REFERENCES accounts(id), title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'OTHER',
  priority TEXT NOT NULL DEFAULT 'MEDIUM', status TEXT NOT NULL DEFAULT 'REPORTED', photo_name TEXT, completion_notes TEXT, due_date TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT);
CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES accounts(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES accounts(id), from_status TEXT, to_status TEXT, note TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  recorded_by_id INTEGER NOT NULL REFERENCES accounts(id), amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), description TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 0, approved_by_id INTEGER REFERENCES accounts(id), created_at TEXT NOT NULL);
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, recipient_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  message TEXT NOT NULL, request_id INTEGER, read_flag INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
`);
const n = new Date().toISOString();
old.prepare("INSERT INTO accounts VALUES (1,'m@x.test','hash1','Old Manager','MANAGER',1,?)").run(n);
old.prepare("INSERT INTO accounts VALUES (2,'t@x.test','hash2','Old Tenant','TENANT',1,?)").run(n);
old.prepare("INSERT INTO accounts VALUES (3,'k@x.test','hash3','Old Tech','TECHNICIAN',1,?)").run(n);
old.prepare("INSERT INTO properties (id,name,manager_id,created_at) VALUES (1,'Old Property',1,?)").run(n);
old.prepare("INSERT INTO units (id,property_id,label) VALUES (1,1,'1A')").run();
old.prepare("INSERT INTO unit_assignments (tenant_id,unit_id,created_at) VALUES (2,1,?)").run(n);
old.prepare("INSERT INTO requests (id,unit_id,reporter_id,technician_id,title,description,status,created_at,updated_at) VALUES (1,1,2,3,'Old leak','desc','ASSIGNED',?,?)").run(n, n);
old.prepare("INSERT INTO expenses (request_id,recorded_by_id,amount_cents,description,approved,approved_by_id,created_at) VALUES (1,3,1234,'Old part',1,1,?)").run(n);
old.prepare("INSERT INTO notifications (recipient_id,message,created_at) VALUES (1,'hello',?)").run(n);
old.close();
ok("legacy database created with real rows", true);

section("Open it with the new release");
const db = require("../src/db");
ok("all eight migrations were applied", db.appliedMigrations.length === 8 && /organizations/.test(db.appliedMigrations[1]) && /load test/.test(db.appliedMigrations[2]) && /performance testing/.test(db.appliedMigrations[3]), db.appliedMigrations);
ok("the load-test table exists and is empty", db.prepare("SELECT COUNT(*) n FROM loadtest_runs").get().n === 0);
const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
ok("accounts preserved", count("accounts") === 3);
ok("passwords preserved", db.prepare("SELECT password_hash h FROM accounts WHERE id = 2").get().h === "hash2");
ok("properties, units, assignments preserved", count("properties") === 1 && count("units") === 1 && count("unit_assignments") === 1);
ok("requests preserved with their technician", db.prepare("SELECT technician_id t, title FROM requests WHERE id = 1").get().t === 3);
const x = db.prepare("SELECT amount_cents a, approved ap, kind FROM expenses").get();
ok("expenses preserved exactly, existing ones typed EXPENSE", x.a === 1234 && x.ap === 1 && x.kind === "EXPENSE");
ok("notifications preserved", count("notifications") === 1);
const org = db.prepare("SELECT * FROM organizations").all();
ok("one organization was created for the old data", org.length === 1);
ok("every account and property belongs to it", db.prepare("SELECT COUNT(*) n FROM accounts WHERE org_id IS NULL").get().n === 0 && db.prepare("SELECT COUNT(*) n FROM properties WHERE org_id IS NULL").get().n === 0);
ok("the old manager became the organization admin", db.prepare("SELECT org_admin a FROM accounts WHERE id = 1").get().a === 1);
ok("foreign keys are all intact", db.pragma("foreign_key_check").length === 0);
ok("foreign key enforcement is back on", db.pragma("foreign_keys")[0].foreign_keys === 1);
db.prepare("INSERT INTO vendors (org_id,name,contact_email,created_at) VALUES (1,'V','v@x.test',?)").run(n);
let accepted = true;
try { db.prepare("INSERT INTO accounts (email,password_hash,full_name,role,created_at,org_id,vendor_id) VALUES ('v@x.test','h','V','VENDOR',?,1,1)").run(n); } catch (e) { accepted = false; }
ok("the rebuilt accounts table accepts the VENDOR role", accepted);
let rejected = false;
try { db.prepare("INSERT INTO accounts (email,password_hash,full_name,role,created_at) VALUES ('z@x.test','h','Z','SUPERUSER',?)").run(n); } catch (e) { rejected = true; }
ok("and still rejects an invented role", rejected);
ok("the schema version is recorded", count("schema_migrations") === 8);

section("Opening it again is a no-op");
const { execFileSync } = require("child_process");
const out = execFileSync(process.execPath, ["-e", "const d=require('./src/db');console.log(d.appliedMigrations.length, d.prepare('SELECT COUNT(*) n FROM accounts').get().n)"],
  { cwd: path.join(__dirname, ".."), env: process.env }).toString().trim();
ok("a second start applies nothing and loses nothing", out === "0 4", out);

require("fs").rmSync(DIR, { recursive: true, force: true });
T.done();
