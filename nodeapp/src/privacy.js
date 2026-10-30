"use strict";
// Personal-data duties (India's DPDP Act, the GDPR and similar): a person can get a copy of their data, and an account can be
// erased by anonymizing it. Maintenance history itself is kept — a landlord must be able to show what was done to a property —
// but everything that identifies the person is removed and cannot be recovered.
const S = require("./store");
const config = require("./config");

/** Everything this account holds, as one JSON object. Other people's personal data is not included. */
function exportAccount(accountId) {
  const db = S.db;
  const a = db.prepare("SELECT id, email, full_name, role, phone, skills, active, created_at, email_verified, mfa_enabled, org_id, vendor_id, org_admin FROM accounts WHERE id = ?").get(accountId);
  if (!a) return null;
  const q = (sql, ...args) => db.prepare(sql).all(...args);
  return {
    exportedAt: new Date().toISOString(),
    about: "Everything EstateOps holds about this account. Records that also describe other people show only what you yourself wrote or did.",
    account: {
      id: a.id, email: a.email, fullName: a.full_name, role: a.role, phone: a.phone, skills: a.skills,
      active: !!a.active, createdAt: a.created_at, emailVerified: !!a.email_verified, twoFactor: !!a.mfa_enabled,
      organization: a.org_id ? (db.prepare("SELECT name FROM organizations WHERE id = ?").get(a.org_id) || {}).name : null,
      company: a.vendor_id ? (db.prepare("SELECT name FROM vendors WHERE id = ?").get(a.vendor_id) || {}).name : null,
      organizationAdmin: !!a.org_admin,
    },
    homes: q(`SELECT p.name AS property, u.label AS unit, ua.created_at AS since
                FROM unit_assignments ua JOIN units u ON u.id = ua.unit_id JOIN properties p ON p.id = u.property_id
               WHERE ua.tenant_id = ?`, accountId),
    requestsYouReported: q("SELECT id, title, description, category, priority, status, created_at, closed_at, completion_notes FROM requests WHERE reporter_id = ?", accountId),
    requestsAssignedToYou: q("SELECT id, title, category, priority, status, due_date, created_at FROM requests WHERE technician_id = ?", accountId),
    commentsYouWrote: q("SELECT id, request_id, body, created_at FROM comments WHERE author_id = ?", accountId),
    statusChangesYouMade: q("SELECT id, request_id, from_status, to_status, note, created_at FROM events WHERE actor_id = ?", accountId),
    expensesYouRecorded: q("SELECT id, request_id, amount_cents, description, approved, created_at FROM expenses WHERE recorded_by_id = ?", accountId),
    filesYouUploaded: q("SELECT id, request_id, original_name, mime, size_bytes, created_at FROM attachments WHERE uploader_id = ?", accountId),
    quotationsYouSubmitted: q("SELECT id, request_id, amount_cents, description, status, created_at FROM quotations WHERE submitted_by = ?", accountId),
    notifications: q("SELECT id, message, request_id, read_flag AS read, created_at FROM notifications WHERE recipient_id = ?", accountId),
    signInsRecorded: q("SELECT created_at, last_seen_at, expires_at, revoked_at, ip, user_agent FROM sessions WHERE account_id = ?", accountId),
    yourActionsInTheAuditLog: q("SELECT action, entity, entity_id, detail, created_at FROM audit_log WHERE actor_id = ?", accountId),
  };
}

/** Erase a person: the account is anonymized in place and everything they wrote that names them is scrubbed.
 *  Maintenance records stay, attributed to "Deleted user". Not reversible. */
function eraseAccount(accountId, byAccount) {
  const db = S.db;
  const a = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  if (!a) return null;
  if (a.email.startsWith("deleted-")) return { already: true, email: a.email };
  const marker = `deleted-${accountId}@removed.invalid`;
  db.transaction(() => {
    db.prepare(`UPDATE accounts SET email = ?, full_name = 'Deleted user', phone = NULL, skills = NULL, active = 0,
                       password_hash = 'erased', token_version = token_version + 1,
                       mfa_enabled = 0, mfa_secret = NULL, email_verified = 0 WHERE id = ?`).run(marker, accountId);
    db.prepare("UPDATE sessions SET revoked_at = ? WHERE account_id = ?").run(S.now(), accountId);
    db.prepare("DELETE FROM sessions WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM mfa_recovery WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM account_tokens WHERE account_id = ?").run(accountId);
    db.prepare("DELETE FROM notifications WHERE recipient_id = ?").run(accountId);
    db.prepare("DELETE FROM unit_assignments WHERE tenant_id = ?").run(accountId);
    db.prepare("UPDATE invitations SET email = ? WHERE account_id = ? OR email = ?").run(marker, accountId, a.email);
    // Free text the person wrote can carry their name or contact details, so it goes; the record of the action stays.
    db.prepare("UPDATE comments SET body = '[removed at the author''s request]' WHERE author_id = ?").run(accountId);
    db.prepare("UPDATE events SET note = '[removed]' WHERE actor_id = ? AND note IS NOT NULL AND note != 'Request raised'").run(accountId);
    db.prepare("UPDATE audit_log SET detail = NULL WHERE actor_id = ? OR detail LIKE ?").run(accountId, `%${a.email}%`);
  })();
  if (byAccount) S.audit(byAccount, "ACCOUNT_ERASED", "account", accountId, `#${accountId}`);
  return { erased: true, email: marker };
}

/** Retention: closed requests and audit entries older than the configured number of days are removed. Off (0) unless set. */
function applyRetention({ requestDays = config.retention.requestDays, auditDays = config.retention.auditDays, now = Date.now() } = {}) {
  const db = S.db, out = { requests: 0, auditEntries: 0, attachments: [], sessions: 0 };
  if (requestDays) {
    const cutoff = new Date(now - requestDays * 86400000).toISOString();
    const old = db.prepare("SELECT id FROM requests WHERE status = 'CLOSED' AND COALESCE(closed_at, updated_at) < ?").all(cutoff).map((r) => r.id);
    if (old.length) {
      const marks = old.map(() => "?").join(",");
      out.attachments = db.prepare(`SELECT stored_name FROM attachments WHERE request_id IN (${marks})`).all(...old).map((r) => r.stored_name);
      db.transaction(() => {
        for (const t of ["attachments", "comments", "events", "expenses", "quotations", "ai_suggestions", "notifications"]) {
          db.prepare(`DELETE FROM ${t} WHERE request_id IN (${marks})`).run(...old);
        }
        db.prepare(`DELETE FROM requests WHERE id IN (${marks})`).run(...old);
      })();
      out.requests = old.length;
    }
  }
  if (auditDays) {
    out.auditEntries = db.prepare("DELETE FROM audit_log WHERE created_at < ?").run(new Date(now - auditDays * 86400000).toISOString()).changes;
  }
  out.sessions = S.purgeSessions();
  return out;
}
module.exports = { exportAccount, eraseAccount, applyRetention };
