"use strict";
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const MIGRATIONS = require("./migrations");

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(path.join(config.dataDir, "estateops.db"));
db.pragma("journal_mode = WAL");

function migrate() {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const done = new Set(db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id));
  const pending = MIGRATIONS.filter((m) => !done.has(m.id));
  if (pending.length === 0) return [];

  // A database created before migrations existed already has the base tables: record step 1
  // as applied rather than re-running it.
  const legacy = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'").get();
  db.pragma("foreign_keys = OFF");           // required while a table is rebuilt; checked again below
  const applied = [];
  for (const m of pending) {
    db.transaction(() => {
      if (!(m.id === 1 && legacy)) m.up(db);
      const broken = db.pragma("foreign_key_check");
      if (broken.length) throw new Error(`Migration ${m.id} left ${broken.length} broken foreign key(s).`);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)")
        .run(m.id, m.name, new Date().toISOString());
    })();
    applied.push(m.name);
  }
  db.pragma("foreign_keys = ON");
  return applied;
}

const applied = migrate();
db.pragma("foreign_keys = ON");
db.appliedMigrations = applied;
module.exports = db;
