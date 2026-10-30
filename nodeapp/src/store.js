"use strict";
/** Every SQL statement lives here. Anything scoped to an organization takes the org id explicitly. */
const db = require("./db");
const config = require("./config");
const now = () => new Date().toISOString();

/* ================= organizations ================= */
const createOrganization = (name) =>
  findOrganization(db.prepare("INSERT INTO organizations (name, created_at) VALUES (?,?)").run(name, now()).lastInsertRowid);
const findOrganization = (id) => db.prepare("SELECT * FROM organizations WHERE id = ?").get(id);
const updateOrganization = (id, name, limitCents) =>
  db.prepare("UPDATE organizations SET name = ?, approval_limit_cents = ? WHERE id = ?").run(name, limitCents, id);

/* ================= accounts ================= */
const findAccountByEmail = (email) =>
  db.prepare("SELECT * FROM accounts WHERE email = ? COLLATE NOCASE").get(email);
const findAccount = (id) => db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
const countAccounts = () => db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n;

function createAccount({ email, passwordHash, fullName, role, orgId = null, vendorId = null,
                         orgAdmin = 0, phone = null, skills = null, profileComplete = 0, emailVerified = 1 }) {
  // emailVerified defaults to 1 because every path except public self-registration proves the address (invitation link,
  // manager-created account, first-run setup). Public sign-up passes 0 until the person opens the verification link.
  const info = db.prepare(`
    INSERT INTO accounts (email, password_hash, full_name, role, active, created_at,
                          org_id, vendor_id, org_admin, phone, skills, profile_complete, email_verified)
    VALUES (?,?,?,?,1,?,?,?,?,?,?,?,?)`)
    .run(email, passwordHash, fullName, role, now(), orgId, vendorId, orgAdmin, phone, skills, profileComplete, emailVerified ? 1 : 0);
  return findAccount(info.lastInsertRowid);
}
const accountsByRole = (orgId, role) => db.prepare(
  "SELECT * FROM accounts WHERE org_id = ? AND role = ? AND active = 1 ORDER BY full_name").all(orgId, role);
const teamOf = (orgId) => db.prepare(`
  SELECT a.*, v.name AS vendor_name FROM accounts a LEFT JOIN vendors v ON v.id = a.vendor_id
   WHERE a.org_id = ? AND a.email NOT LIKE 'loadtest-%@loadtest.invalid' ORDER BY a.role, a.full_name`).all(orgId);   // load-test fixtures are not team members
const managersOf = (orgId) => accountsByRole(orgId, "MANAGER");
// Anything that bumps token_version ends every token the account holds, so the session rows are closed too (the list of devices stays truthful).
const endSessions = (id) => db.prepare("UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL").run(now(), id);
const setAccountActive = (id, active) => db.transaction(() => {
  db.prepare("UPDATE accounts SET active = ?, token_version = token_version + 1 WHERE id = ?").run(active ? 1 : 0, id); endSessions(id); })();
const setPassword = (id, hash) => db.transaction(() => {
  db.prepare("UPDATE accounts SET password_hash = ?, token_version = token_version + 1 WHERE id = ?").run(hash, id); endSessions(id); })();
const bumpTokenVersion = (id) => db.transaction(() => {
  db.prepare("UPDATE accounts SET token_version = token_version + 1 WHERE id = ?").run(id); endSessions(id); })();
const updateProfile = (id, fullName, phone, skills) =>
  db.prepare("UPDATE accounts SET full_name = ?, phone = ?, skills = ?, profile_complete = 1 WHERE id = ?")
    .run(fullName, phone, skills, id);
const setAccountOrg = (id, orgId) => db.prepare("UPDATE accounts SET org_id = ? WHERE id = ?").run(orgId, id);

/* ================= vendors ================= */
const findVendor = (id) => db.prepare("SELECT * FROM vendors WHERE id = ?").get(id);
const vendorNameTaken = (orgId, name) => !!db.prepare(
  "SELECT 1 FROM vendors WHERE org_id = ? AND name = ? COLLATE NOCASE").get(orgId, name);
// The load-test fixture vendor is hidden from real lists (it is only ever used by the load-test engine).
const vendorsOf = (orgId, status, includeFixtures = false) => db.prepare(`
  SELECT v.*, (SELECT COUNT(*) FROM accounts a WHERE a.vendor_id = v.id AND a.active = 1) AS member_count,
         (SELECT COUNT(*) FROM requests r WHERE r.vendor_id = v.id AND r.status != 'CLOSED') AS open_jobs
    FROM vendors v WHERE v.org_id = ? ${status ? "AND v.status = ?" : ""} ${includeFixtures ? "" : "AND v.name NOT LIKE '[LOADTEST] Fixture vendor%'"} ORDER BY v.name`)
  .all(...(status ? [orgId, status] : [orgId]));
function createVendor({ orgId, name, contactEmail, phone, categories, status = "PENDING" }) {
  const info = db.prepare(`INSERT INTO vendors (org_id, name, contact_email, phone, categories, status, created_at)
                           VALUES (?,?,?,?,?,?,?)`).run(orgId, name, contactEmail, phone, categories, status, now());
  return findVendor(info.lastInsertRowid);
}
const setVendorStatus = (id, status) => db.prepare("UPDATE vendors SET status = ? WHERE id = ?").run(status, id);
const updateVendorProfile = (id, phone, categories) =>
  db.prepare("UPDATE vendors SET phone = ?, categories = ? WHERE id = ?").run(phone, categories, id);

/* ================= invitations ================= */
function createInvitation(d) {
  const info = db.prepare(`
    INSERT INTO invitations (token_hash, kind, email, role, org_id, unit_id, vendor_id, account_id,
                             invited_by, expires_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d.tokenHash, d.kind || "INVITE", d.email, d.role, d.orgId, d.unitId || null, d.vendorId || null,
         d.accountId || null, d.invitedBy, d.expiresAt, now());
  return db.prepare("SELECT * FROM invitations WHERE id = ?").get(info.lastInsertRowid);
}
const findInvitationByHash = (h) => db.prepare(`
  SELECT i.*, o.name AS org_name, v.name AS vendor_name, u.label AS unit_label, p.name AS property_name
    FROM invitations i
    JOIN organizations o ON o.id = i.org_id
    LEFT JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN units u ON u.id = i.unit_id
    LEFT JOIN properties p ON p.id = u.property_id
   WHERE i.token_hash = ?`).get(h);
/* ---- sessions: one row per sign-in; the token carries the sid, so a session can be ended on its own ---- */
function createSession(accountId, sid, expiresAt, ip, ua, cap) {
  db.prepare("INSERT INTO sessions (sid, account_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?)")
    .run(sid, accountId, now(), now(), expiresAt, String(ip || "").slice(0, 64), String(ua || "").slice(0, 200));
  // Keep only the newest `cap` live sessions: the oldest sign-ins are ended first.
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL AND id NOT IN
              (SELECT id FROM sessions WHERE account_id = ? AND revoked_at IS NULL ORDER BY id DESC LIMIT ?)`).run(now(), accountId, accountId, cap);
}
const findSession = (sid, accountId) => db.prepare("SELECT * FROM sessions WHERE sid = ? AND account_id = ?").get(sid, accountId);
const touchSession = (id) => db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now(), id);
const revokeSession = (id, accountId) => db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ? AND account_id = ? AND revoked_at IS NULL").run(now(), id, accountId).changes;
const revokeAccountSessions = (accountId, exceptId = 0) => db.prepare("UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND id != ? AND revoked_at IS NULL").run(now(), accountId, exceptId).changes;
const activeSessions = (accountId) => db.prepare("SELECT * FROM sessions WHERE account_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC").all(accountId, now());
/** Housekeeping: rows that ended more than 30 days ago are of no use. */
const purgeSessions = () => db.prepare("DELETE FROM sessions WHERE COALESCE(revoked_at, expires_at) < ?").run(new Date(Date.now() - 30 * 86400000).toISOString()).changes;

/* ---- two-factor ---- */
const mfaBegin = (id, sealedSecret) => db.prepare("UPDATE accounts SET mfa_secret = ? WHERE id = ? AND mfa_enabled = 0").run(sealedSecret, id);
function mfaEnable(id, step, hashes) {
  db.transaction(() => {
    db.prepare("UPDATE accounts SET mfa_enabled = 1, mfa_last_step = ? WHERE id = ?").run(step, id);
    db.prepare("DELETE FROM mfa_recovery WHERE account_id = ?").run(id);
    const ins = db.prepare("INSERT INTO mfa_recovery (account_id, code_hash) VALUES (?,?)");
    hashes.forEach((h) => ins.run(id, h));
  })();
}
const mfaDisable = (id) => db.transaction(() => {
  db.prepare("UPDATE accounts SET mfa_enabled = 0, mfa_secret = NULL, mfa_last_step = 0 WHERE id = ?").run(id);
  db.prepare("DELETE FROM mfa_recovery WHERE account_id = ?").run(id);
})();
/** A time step may be used once: false if it (or a later one) was already accepted. */
const mfaClaimStep = (id, step) => db.prepare("UPDATE accounts SET mfa_last_step = ? WHERE id = ? AND mfa_last_step < ?").run(step, id, step).changes === 1;
const mfaUseRecovery = (id, hash) => db.prepare("UPDATE mfa_recovery SET used_at = ? WHERE account_id = ? AND code_hash = ? AND used_at IS NULL").run(now(), id, hash).changes === 1;
const mfaRecoveryLeft = (id) => db.prepare("SELECT COUNT(*) n FROM mfa_recovery WHERE account_id = ? AND used_at IS NULL").get(id).n;

/* ---- single-use account tokens: self-service password reset and email verification (only the SHA-256 hash is stored) ---- */
function createAccountToken(accountId, purpose, tokenHash, ttlHours) {
  db.prepare("UPDATE account_tokens SET used_at = ? WHERE account_id = ? AND purpose = ? AND used_at IS NULL").run(now(), accountId, purpose);   // newest link wins
  db.prepare("INSERT INTO account_tokens (token_hash, purpose, account_id, expires_at, created_at) VALUES (?,?,?,?,?)")
    .run(tokenHash, purpose, accountId, new Date(Date.now() + ttlHours * 3600000).toISOString(), now());
}
const findAccountToken = (hash, purpose) => db.prepare(
  "SELECT * FROM account_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?").get(hash, purpose, now());
/** Marks the token used; false if someone else used it first. */
const useAccountToken = (id) => db.prepare("UPDATE account_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL").run(now(), id).changes === 1;
const markEmailVerified = (accountId) => db.prepare("UPDATE accounts SET email_verified = 1 WHERE id = ?").run(accountId);
const findInvitation = (id) => db.prepare("SELECT * FROM invitations WHERE id = ?").get(id);
const pendingInvitations = (orgId) => db.prepare(`
  SELECT i.*, v.name AS vendor_name, u.label AS unit_label, p.name AS property_name
    FROM invitations i LEFT JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN units u ON u.id = i.unit_id LEFT JOIN properties p ON p.id = u.property_id
   WHERE i.org_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
   ORDER BY i.created_at DESC`).all(orgId, now());
const acceptInvitation = (id) => db.prepare("UPDATE invitations SET accepted_at = ? WHERE id = ?").run(now(), id);
const revokeInvitation = (id) => db.prepare("UPDATE invitations SET revoked_at = ? WHERE id = ?").run(now(), id);

/* ================= properties and units ================= */
const listProperties = (orgId) => db.prepare(`
  SELECT p.*, a.full_name AS manager_name,
         (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.active = 1) AS unit_count
    FROM properties p JOIN accounts a ON a.id = p.manager_id
   WHERE p.org_id = ? AND p.active = 1 ORDER BY p.name`).all(orgId);
const findProperty = (id) => db.prepare("SELECT * FROM properties WHERE id = ?").get(id);
function createProperty({ name, address, propertyType, managerId, orgId }) {
  const info = db.prepare(`INSERT INTO properties (name, address, property_type, manager_id, org_id, active, created_at)
                           VALUES (?,?,?,?,?,1,?)`).run(name, address, propertyType, managerId, orgId, now());
  return db.prepare(`SELECT p.*, a.full_name AS manager_name, 0 AS unit_count
                       FROM properties p JOIN accounts a ON a.id = p.manager_id WHERE p.id = ?`).get(info.lastInsertRowid);
}

const UNIT_SELECT = `
  SELECT u.*, p.name AS property_name, p.org_id AS org_id,
         (SELECT group_concat(t.full_name, ', ') FROM unit_assignments ua JOIN accounts t ON t.id = ua.tenant_id
           WHERE ua.unit_id = u.id) AS tenant_names
    FROM units u JOIN properties p ON p.id = u.property_id`;
const findUnit = (id) => db.prepare(UNIT_SELECT + " WHERE u.id = ?").get(id);
const unitsOfProperty = (propertyId) =>
  db.prepare(UNIT_SELECT + " WHERE u.property_id = ? AND u.active = 1 ORDER BY u.label").all(propertyId);
const unitLabelTaken = (propertyId, label) => !!db.prepare(
  "SELECT 1 FROM units WHERE property_id = ? AND label = ? COLLATE NOCASE").get(propertyId, label);
function createUnit(propertyId, label) {
  const info = db.prepare("INSERT INTO units (property_id, label, active) VALUES (?,?,1)").run(propertyId, label);
  return findUnit(info.lastInsertRowid);
}
const allActiveUnits = (orgId) =>
  db.prepare(UNIT_SELECT + " WHERE p.org_id = ? AND u.active = 1 AND p.active = 1 ORDER BY p.name, u.label").all(orgId);
const unitsForTenant = (tenantId) => db.prepare(UNIT_SELECT + `
   WHERE u.active = 1 AND u.id IN (SELECT unit_id FROM unit_assignments WHERE tenant_id = ?)
   ORDER BY p.name, u.label`).all(tenantId);
const tenantHasUnit = (tenantId, unitId) => !!db.prepare(
  "SELECT 1 FROM unit_assignments WHERE tenant_id = ? AND unit_id = ?").get(tenantId, unitId);
const assignTenantToUnit = (tenantId, unitId) =>
  db.prepare("INSERT OR IGNORE INTO unit_assignments (tenant_id, unit_id, created_at) VALUES (?,?,?)")
    .run(tenantId, unitId, now());

/* ================= requests ================= */
const REQUEST_SELECT = `
  SELECT r.*, u.label AS unit_label, p.name AS property_name, p.org_id AS org_id,
         rep.full_name AS reporter_name, tec.full_name AS technician_name,
         v.name AS vendor_name, v.status AS vendor_status
    FROM requests r
    JOIN units u ON u.id = r.unit_id
    JOIN properties p ON p.id = u.property_id
    JOIN accounts rep ON rep.id = r.reporter_id
    LEFT JOIN accounts tec ON tec.id = r.technician_id
    LEFT JOIN vendors v ON v.id = r.vendor_id`;
const findRequest = (id) => db.prepare(REQUEST_SELECT + " WHERE r.id = ?").get(id);

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => "\\" + c);

/** The only way requests are listed: the WHERE clause is built from the caller's identity. */
function listRequests(account, f = {}) {
  const where = [], args = [];
  switch (account.role) {
    case "MANAGER":    where.push("p.org_id = ?"); args.push(account.org_id); break;
    case "TENANT":     where.push("r.reporter_id = ?"); args.push(account.id); break;
    case "TECHNICIAN": where.push("r.technician_id = ? AND p.org_id = ?"); args.push(account.id, account.org_id); break;
    case "VENDOR":     where.push("r.vendor_id = ? AND v.status = 'ACTIVE'"); args.push(account.vendor_id || -1); break;
    default:           where.push("1 = 0");
  }
  if (f.status)   { where.push("r.status = ?");   args.push(f.status); }
  if (f.priority) { where.push("r.priority = ?"); args.push(f.priority); }
  if (f.category) { where.push("r.category = ?"); args.push(f.category); }
  if (f.q) {
    const like = "%" + likeEscape(f.q) + "%";
    where.push("(r.title LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\' OR u.label LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')");
    args.push(like, like, like, like);
  }
  const clause = " WHERE " + where.join(" AND ");
  const total = db.prepare(`SELECT COUNT(*) AS n FROM requests r JOIN units u ON u.id = r.unit_id
    JOIN properties p ON p.id = u.property_id LEFT JOIN vendors v ON v.id = r.vendor_id` + clause).get(...args).n;
  let sql = REQUEST_SELECT + clause + " ORDER BY r.created_at DESC, r.id DESC";
  const a2 = args.slice();
  if (f.limit) { sql += " LIMIT ? OFFSET ?"; a2.push(f.limit, f.offset || 0); }
  return { rows: db.prepare(sql).all(...a2), total };
}

function createRequest(d) {
  const t = now();
  const info = db.prepare(`
    INSERT INTO requests (unit_id, reporter_id, title, description, category, priority, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?, 'REPORTED', ?, ?)`)
    .run(d.unitId, d.reporterId, d.title, d.description, d.category, d.priority, t, t);
  return findRequest(info.lastInsertRowid);
}
/** Compare-and-set: the row changes only if it still has the status the caller looked at. Returns null when someone else got there first. */
function updateRequestStatus(id, status, completionNotes, expectedStatus) {
  const r = db.prepare(`UPDATE requests SET status = ?, closed_at = ?, updated_at = ?,
                     completion_notes = COALESCE(?, completion_notes) WHERE id = ? AND (? IS NULL OR status = ?)`)
    .run(status, status === "CLOSED" ? now() : null, now(), completionNotes || null, id, expectedStatus || null, expectedStatus || null);
  return r.changes ? findRequest(id) : null;
}
function updateAssignment(id, { technicianId, vendorId, dueDate, priority, category, status, expectedStatus }) {
  const r = db.prepare(`UPDATE requests SET technician_id = ?, vendor_id = ?, due_date = COALESCE(?, due_date),
                     priority = COALESCE(?, priority), category = COALESCE(?, category),
                     status = ?, updated_at = ? WHERE id = ? AND (? IS NULL OR status = ?)`)
    .run(technicianId || null, vendorId || null, dueDate || null, priority || null, category || null,
         status, now(), id, expectedStatus || null, expectedStatus || null);
  return r.changes ? findRequest(id) : null;
}
function setClassification(id, category, priority) {
  db.prepare("UPDATE requests SET category = ?, priority = ?, updated_at = ? WHERE id = ?")
    .run(category, priority, now(), id);
  return findRequest(id);
}

/* ================= comments, events ================= */
function addEvent(requestId, actorId, fromStatus, toStatus, note) {
  db.prepare("INSERT INTO events (request_id, actor_id, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?)")
    .run(requestId, actorId, fromStatus, toStatus, note, now());
}
const eventsOf = (requestId) => db.prepare(`
  SELECT e.*, a.full_name AS actor_name FROM events e JOIN accounts a ON a.id = e.actor_id
   WHERE e.request_id = ? ORDER BY e.created_at, e.id`).all(requestId);
const recentEvents = (orgId, limit) => db.prepare(`
  SELECT e.*, a.full_name AS actor_name FROM events e
    JOIN accounts a ON a.id = e.actor_id
    JOIN requests r ON r.id = e.request_id
    JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
   WHERE p.org_id = ? ORDER BY e.created_at DESC, e.id DESC LIMIT ?`).all(orgId, limit);

function addComment(requestId, authorId, body) {
  const info = db.prepare("INSERT INTO comments (request_id, author_id, body, created_at) VALUES (?,?,?,?)")
                 .run(requestId, authorId, body, now());
  return db.prepare(`SELECT c.*, a.full_name AS author_name, a.role AS author_role
                       FROM comments c JOIN accounts a ON a.id = c.author_id WHERE c.id = ?`).get(info.lastInsertRowid);
}
const commentsOf = (requestId) => db.prepare(`
  SELECT c.*, a.full_name AS author_name, a.role AS author_role
    FROM comments c JOIN accounts a ON a.id = c.author_id
   WHERE c.request_id = ? ORDER BY c.created_at, c.id`).all(requestId);

/* ================= expenses and invoices ================= */
const EXPENSE_SELECT = `
  SELECT x.*, rec.full_name AS recorded_by_name, rec.vendor_id AS recorder_vendor_id,
         app.full_name AS approved_by_name, r.title AS request_title, r.category AS request_category,
         p.org_id AS org_id
    FROM expenses x
    JOIN accounts rec ON rec.id = x.recorded_by_id
    JOIN requests r ON r.id = x.request_id
    JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
    LEFT JOIN accounts app ON app.id = x.approved_by_id`;
function addExpense(requestId, recordedById, amountCents, description, kind) {
  const info = db.prepare(`INSERT INTO expenses (request_id, recorded_by_id, amount_cents, description, kind, approved, created_at)
                           VALUES (?,?,?,?,?,0,?)`).run(requestId, recordedById, amountCents, description, kind, now());
  return findExpense(info.lastInsertRowid);
}
const findExpense = (id) => db.prepare(EXPENSE_SELECT + " WHERE x.id = ?").get(id);
/** Which expenses this account may see on a request. Tenants never see cost. */
function expensesOf(requestId, account) {
  let extra = "", args = [requestId];
  if (account.role === "TENANT") return [];
  if (account.role === "TECHNICIAN") { extra = " AND x.recorded_by_id = ?"; args.push(account.id); }
  if (account.role === "VENDOR")     { extra = " AND rec.vendor_id = ?"; args.push(account.vendor_id || -1); }
  return db.prepare(EXPENSE_SELECT + " WHERE x.request_id = ?" + extra + " ORDER BY x.created_at, x.id").all(...args);
}
function approveExpense(id, approverId) {
  const r = db.prepare("UPDATE expenses SET approved = 1, approved_by_id = ? WHERE id = ? AND approved = 0").run(approverId, id);
  return r.changes ? findExpense(id) : null;
}
/** Spend across what this account may see since a date, split into approved and awaiting approval. */
function spendSince(account, isoDate) {
  let where = "x.created_at >= ?", args = [isoDate];
  if (account.role === "MANAGER") { where += " AND p.org_id = ?"; args.push(account.org_id); }
  else if (account.role === "TECHNICIAN") { where += " AND x.recorded_by_id = ?"; args.push(account.id); }
  else if (account.role === "VENDOR") { where += " AND rec.vendor_id = ?"; args.push(account.vendor_id || -1); }
  else return { approved: 0, pending: 0 };
  const rows = db.prepare(EXPENSE_SELECT + " WHERE " + where).all(...args);
  let approved = 0, pending = 0;
  for (const x of rows) { if (x.approved) approved += x.amount_cents; else pending += x.amount_cents; }
  return { approved, pending };
}

/* ================= notifications ================= */
function notify(recipientId, message, requestId) {
  db.prepare("INSERT INTO notifications (recipient_id, message, request_id, read_flag, created_at) VALUES (?,?,?,0,?)")
    .run(recipientId, message, requestId || null, now());
}
const notificationsFor = (id) => db.prepare(
  "SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC, id DESC LIMIT 50").all(id);
const unreadCount = (id) => db.prepare(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient_id = ? AND read_flag = 0").get(id).n;
const findNotification = (id) => db.prepare("SELECT * FROM notifications WHERE id = ?").get(id);
const markRead = (id) => db.prepare("UPDATE notifications SET read_flag = 1 WHERE id = ?").run(id);
const markAllRead = (recipientId) =>
  db.prepare("UPDATE notifications SET read_flag = 1 WHERE recipient_id = ?").run(recipientId);

/* ================= attachments ================= */
function addAttachment(d) {
  const info = db.prepare(`INSERT INTO attachments (request_id, uploader_id, original_name, stored_name, mime, size_bytes, kind, created_at)
                           VALUES (?,?,?,?,?,?,?,?)`)
    .run(d.requestId, d.uploaderId, d.originalName, d.storedName, d.mime, d.size, d.kind, now());
  return findAttachment(info.lastInsertRowid);
}
const ATTACHMENT_SELECT = `SELECT t.*, a.full_name AS uploader_name FROM attachments t JOIN accounts a ON a.id = t.uploader_id`;
const findAttachment = (id) => db.prepare(ATTACHMENT_SELECT + " WHERE t.id = ?").get(id);
const attachmentsOf = (requestId) =>
  db.prepare(ATTACHMENT_SELECT + " WHERE t.request_id = ? ORDER BY t.id").all(requestId);
const countAttachments = (requestId) =>
  db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE request_id = ?").get(requestId).n;

/* ================= quotations ================= */
const QUOTE_SELECT = `SELECT q.*, v.name AS vendor_name, s.full_name AS submitted_by_name, d.full_name AS decided_by_name
  FROM quotations q JOIN vendors v ON v.id = q.vendor_id JOIN accounts s ON s.id = q.submitted_by
  LEFT JOIN accounts d ON d.id = q.decided_by`;
function addQuotation(requestId, vendorId, submittedBy, amountCents, description) {
  const info = db.prepare(`INSERT INTO quotations (request_id, vendor_id, submitted_by, amount_cents, description, status, created_at)
                           VALUES (?,?,?,?,?, 'PENDING', ?)`).run(requestId, vendorId, submittedBy, amountCents, description, now());
  return findQuotation(info.lastInsertRowid);
}
const findQuotation = (id) => db.prepare(QUOTE_SELECT + " WHERE q.id = ?").get(id);
function quotationsOf(requestId, account) {
  if (account.role === "VENDOR") {
    return db.prepare(QUOTE_SELECT + " WHERE q.request_id = ? AND q.vendor_id = ? ORDER BY q.id").all(requestId, account.vendor_id || -1);
  }
  if (account.role !== "MANAGER") return [];
  return db.prepare(QUOTE_SELECT + " WHERE q.request_id = ? ORDER BY q.id").all(requestId);
}
function decideQuotation(id, status, deciderId) {
  const r = db.prepare("UPDATE quotations SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'PENDING'").run(status, deciderId, now(), id);
  return r.changes ? findQuotation(id) : null;
}
const pendingQuotationCount = (orgId) => db.prepare(`
  SELECT COUNT(*) AS n FROM quotations q JOIN requests r ON r.id = q.request_id
    JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
   WHERE p.org_id = ? AND q.status = 'PENDING'`).get(orgId).n;

/* ================= AI suggestions ================= */
function addSuggestion(requestId, s, model) {
  const info = db.prepare(`INSERT INTO ai_suggestions (request_id, category, priority, explanation, model, created_at)
                           VALUES (?,?,?,?,?,?)`).run(requestId, s.category, s.priority, s.explanation, model, now());
  return findSuggestion(info.lastInsertRowid);
}
const findSuggestion = (id) => db.prepare("SELECT * FROM ai_suggestions WHERE id = ?").get(id);
const latestSuggestion = (requestId) =>
  db.prepare("SELECT * FROM ai_suggestions WHERE request_id = ? ORDER BY id DESC LIMIT 1").get(requestId);
const decideSuggestion = (id, decision, by) =>
  db.prepare("UPDATE ai_suggestions SET decision = ?, decided_by = ?, decided_at = ? WHERE id = ? AND decision IS NULL").run(decision, by, now(), id).changes;

/* ================= audit ================= */
function audit(account, action, entity, entityId, detail) {
  db.prepare("INSERT INTO audit_log (org_id, actor_id, action, entity, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(account ? account.org_id : null, account ? account.id : null, action, entity, entityId || null,
         detail ? String(detail).slice(0, 500) : null, now());
}
const auditOf = (orgId, limit) => db.prepare(`
  SELECT l.*, a.full_name AS actor_name FROM audit_log l LEFT JOIN accounts a ON a.id = l.actor_id
   WHERE l.org_id = ? ORDER BY l.id DESC LIMIT ?`).all(orgId, limit);

/* ================= insights (rule-based analysis of stored records) ================= */
/** Same unit + same category reported several times (INSIGHTS_RECURRING_MIN, default 2) within INSIGHTS_WINDOW_DAYS (default 90). */
function recurringIssues(orgId) {
  const since = new Date(Date.now() - config.insights.windowDays * 86400000).toISOString();
  return db.prepare(`
    SELECT u.id AS unit_id, u.label AS unit_label, p.name AS property_name, r.category,
           COUNT(*) AS occurrences, MAX(r.created_at) AS last_reported
      FROM requests r JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
     WHERE p.org_id = ? AND r.created_at >= ?
     GROUP BY u.id, r.category HAVING COUNT(*) >= ? ORDER BY occurrences DESC, last_reported DESC`).all(orgId, since, config.insights.recurringMin);
}
/** Expenses far above the typical amount for their category (needs 3+ other samples). */
function costAnomalies(orgId) {
  const rows = db.prepare(`
    SELECT x.id, x.amount_cents, x.description, r.id AS request_id, r.title, r.category
      FROM expenses x JOIN requests r ON r.id = x.request_id
      JOIN units u ON u.id = r.unit_id JOIN properties p ON p.id = u.property_id
     WHERE p.org_id = ?`).all(orgId);
  const out = [];
  for (const x of rows) {
    const others = rows.filter((o) => o.category === x.category && o.id !== x.id);
    if (others.length < 3) continue;
    const mean = others.reduce((s, o) => s + o.amount_cents, 0) / others.length;
    if (x.amount_cents > mean * config.insights.costFactor) out.push({ ...x, typical_cents: Math.round(mean) });
  }
  return out.sort((a, b) => b.amount_cents - a.amount_cents);
}

module.exports = {
  db, now,
  createOrganization, findOrganization, updateOrganization,
  findAccountByEmail, findAccount, countAccounts, createAccount, accountsByRole, teamOf, managersOf,
  setAccountActive, setPassword, bumpTokenVersion, updateProfile, setAccountOrg,
  findVendor, vendorNameTaken, vendorsOf, createVendor, setVendorStatus, updateVendorProfile,
  createSession, findSession, touchSession, revokeSession, revokeAccountSessions, activeSessions, purgeSessions,
  mfaBegin, mfaEnable, mfaDisable, mfaClaimStep, mfaUseRecovery, mfaRecoveryLeft,
  createAccountToken, findAccountToken, useAccountToken, markEmailVerified,
  createInvitation, findInvitationByHash, findInvitation, pendingInvitations, acceptInvitation, revokeInvitation,
  listProperties, findProperty, createProperty,
  findUnit, unitsOfProperty, unitLabelTaken, createUnit, allActiveUnits, unitsForTenant, tenantHasUnit, assignTenantToUnit,
  findRequest, listRequests, createRequest, updateRequestStatus, updateAssignment, setClassification,
  addEvent, eventsOf, recentEvents, addComment, commentsOf,
  addExpense, findExpense, expensesOf, approveExpense, spendSince,
  notify, notificationsFor, unreadCount, findNotification, markRead, markAllRead,
  addAttachment, findAttachment, attachmentsOf, countAttachments,
  addQuotation, findQuotation, quotationsOf, decideQuotation, pendingQuotationCount,
  addSuggestion, findSuggestion, latestSuggestion, decideSuggestion,
  audit, auditOf, recurringIssues, costAnomalies,
};
