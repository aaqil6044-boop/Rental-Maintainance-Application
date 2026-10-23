"use strict";
/**
 * Ordered, append-only migrations. Each runs once, inside a transaction, and is recorded in
 * schema_migrations. Never edit a migration that has shipped: add a new one.
 */
const now = () => new Date().toISOString();

const MIGRATIONS = [
  {
    id: 1,
    name: "base schema",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('TENANT','MANAGER','TECHNICIAN')),
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS properties (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL, address TEXT,
          property_type TEXT NOT NULL DEFAULT 'complex',
          manager_id INTEGER NOT NULL REFERENCES accounts(id),
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS units (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
          label TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          UNIQUE (property_id, label COLLATE NOCASE)
        );
        CREATE TABLE IF NOT EXISTS unit_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          UNIQUE (tenant_id, unit_id)
        );
        CREATE TABLE IF NOT EXISTS requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          unit_id INTEGER NOT NULL REFERENCES units(id),
          reporter_id INTEGER NOT NULL REFERENCES accounts(id),
          technician_id INTEGER REFERENCES accounts(id),
          title TEXT NOT NULL, description TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'OTHER',
          priority TEXT NOT NULL DEFAULT 'MEDIUM',
          status TEXT NOT NULL DEFAULT 'REPORTED',
          photo_name TEXT, completion_notes TEXT, due_date TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_req_status ON requests(status);
        CREATE INDEX IF NOT EXISTS ix_req_reporter ON requests(reporter_id);
        CREATE INDEX IF NOT EXISTS ix_req_technician ON requests(technician_id);
        CREATE TABLE IF NOT EXISTS comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          author_id INTEGER NOT NULL REFERENCES accounts(id),
          body TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          actor_id INTEGER NOT NULL REFERENCES accounts(id),
          from_status TEXT, to_status TEXT, note TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          recorded_by_id INTEGER NOT NULL REFERENCES accounts(id),
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          description TEXT NOT NULL,
          approved INTEGER NOT NULL DEFAULT 0,
          approved_by_id INTEGER REFERENCES accounts(id),
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          message TEXT NOT NULL, request_id INTEGER,
          read_flag INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_notif_recipient ON notifications(recipient_id);
      `);
    },
  },

  {
    id: 2,
    name: "organizations, vendors, invitations, attachments, quotations, AI, audit",
    up(db) {
      db.exec(`
        CREATE TABLE organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          approval_limit_cents INTEGER,
          created_at TEXT NOT NULL
        );
        CREATE TABLE vendors (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          name TEXT NOT NULL,
          contact_email TEXT NOT NULL,
          phone TEXT,
          categories TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','INACTIVE')),
          created_at TEXT NOT NULL,
          UNIQUE (org_id, name COLLATE NOCASE)
        );

        -- accounts is rebuilt so the role CHECK can include VENDOR and to add the new columns.
        CREATE TABLE accounts_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          full_name TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('TENANT','MANAGER','TECHNICIAN','VENDOR')),
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          org_id INTEGER REFERENCES organizations(id),
          vendor_id INTEGER REFERENCES vendors(id),
          phone TEXT,
          skills TEXT,
          org_admin INTEGER NOT NULL DEFAULT 0,
          profile_complete INTEGER NOT NULL DEFAULT 0,
          token_version INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO accounts_v2 (id,email,password_hash,full_name,role,active,created_at)
          SELECT id,email,password_hash,full_name,role,active,created_at FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_v2 RENAME TO accounts;
        CREATE INDEX ix_accounts_org ON accounts(org_id, role);

        ALTER TABLE properties ADD COLUMN org_id INTEGER REFERENCES organizations(id);
        ALTER TABLE requests   ADD COLUMN vendor_id INTEGER REFERENCES vendors(id);
        ALTER TABLE expenses   ADD COLUMN kind TEXT NOT NULL DEFAULT 'EXPENSE';
        CREATE INDEX ix_req_vendor ON requests(vendor_id);
        CREATE INDEX ix_prop_org ON properties(org_id);

        CREATE TABLE invitations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          token_hash TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL DEFAULT 'INVITE' CHECK (kind IN ('INVITE','RESET')),
          email TEXT NOT NULL COLLATE NOCASE,
          role TEXT NOT NULL,
          org_id INTEGER NOT NULL REFERENCES organizations(id),
          unit_id INTEGER REFERENCES units(id),
          vendor_id INTEGER REFERENCES vendors(id),
          account_id INTEGER REFERENCES accounts(id),
          invited_by INTEGER NOT NULL REFERENCES accounts(id),
          expires_at TEXT NOT NULL,
          accepted_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          uploader_id INTEGER NOT NULL REFERENCES accounts(id),
          original_name TEXT NOT NULL,
          stored_name TEXT NOT NULL UNIQUE,
          mime TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          kind TEXT NOT NULL DEFAULT 'PHOTO' CHECK (kind IN ('PHOTO','EVIDENCE')),
          created_at TEXT NOT NULL
        );
        CREATE INDEX ix_att_request ON attachments(request_id);

        CREATE TABLE quotations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          vendor_id INTEGER NOT NULL REFERENCES vendors(id),
          submitted_by INTEGER NOT NULL REFERENCES accounts(id),
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
          decided_by INTEGER REFERENCES accounts(id),
          decided_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX ix_quote_request ON quotations(request_id);

        CREATE TABLE ai_suggestions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          priority TEXT NOT NULL,
          explanation TEXT NOT NULL,
          model TEXT NOT NULL,
          decision TEXT CHECK (decision IN ('ACCEPTED','REJECTED')),
          decided_by INTEGER REFERENCES accounts(id),
          decided_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id INTEGER,
          actor_id INTEGER,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id INTEGER,
          detail TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX ix_audit_org ON audit_log(org_id, id);
      `);

      // Preserve data from version 1: before organizations existed, every manager saw everything,
      // so all existing records are placed in one organization owned by the first manager.
      const first = db.prepare("SELECT id, full_name FROM accounts WHERE role='MANAGER' ORDER BY id LIMIT 1").get();
      if (first) {
        const org = db.prepare("INSERT INTO organizations (name, created_at) VALUES (?, ?)")
          .run(`${first.full_name}'s organization`, now()).lastInsertRowid;
        db.prepare("UPDATE accounts SET org_id = ?").run(org);
        db.prepare("UPDATE accounts SET org_admin = 1 WHERE id = ?").run(first.id);
        db.prepare("UPDATE properties SET org_id = ?").run(org);
      }
    },
  },
];

module.exports = MIGRATIONS;
