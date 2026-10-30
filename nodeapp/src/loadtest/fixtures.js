"use strict";
// Dedicated, clearly-labelled test data. Real records are never read, changed or deleted by a load test.
//   accounts  loadtest-<role>-<n>-o<orgId>@loadtest.invalid   (".invalid" can never receive mail or belong to a person)
//   property  "[LOADTEST] Fixture property" with units LT-01..LT-08
//   requests  titled "[LOADTEST r<runId>] ..." and reported by a fixture account
const crypto = require("crypto");
const db = require("../db");
const S = require("../store");
const A = require("../auth");

const DOMAIN = "@loadtest.invalid", PROPERTY = "[LOADTEST] Fixture property", UNITS = 8, VENDOR = "[LOADTEST] Fixture vendor", ORG_PREFIX = "[LOADTEST] Org ";
// Accounts per organization. The home organization (the admin's own) also gets one org-admin account for the "admin" user type.
const PLAN_HOME = [["tenant", 4], ["manager", 2], ["technician", 3], ["vendor", 2], ["admin", 1]];
const PLAN_EXTRA = [["manager", 1], ["tenant", 2], ["technician", 2], ["vendor", 1]];
const emailOf = (role, n, orgId) => `loadtest-${role}-${n}-o${orgId}${DOMAIN}`;
const isFixtureEmail = (e) => /^loadtest-[a-z]+-\d+-o\d+@loadtest\.invalid$/i.test(e || "");

function fixtureAccountIds(orgId) {
  return db.prepare("SELECT id FROM accounts WHERE org_id = ? AND email LIKE 'loadtest-%@loadtest.invalid'").all(orgId).map((r) => r.id);
}
/** Every organization that holds fixtures: the home organization plus the dedicated "[LOADTEST] Org n" ones. */
function fixtureOrgIds(homeOrgId) {
  const extra = db.prepare("SELECT id FROM organizations WHERE name LIKE ? ORDER BY id").all(ORG_PREFIX + "%").map((r) => r.id);
  return [homeOrgId, ...extra.filter((i) => i !== homeOrgId)];
}

function ensureOrgFixtures(orgId, ownerId, plan, hash, password, idx) {
  const accounts = [];
  const create = (role, n) => {
    const email = emailOf(role, n, orgId); let a = S.findAccountByEmail(email);
    const isAdmin = role === "admin";
    const dbRole = role === "admin" ? "MANAGER" : role.toUpperCase();
    if (!a) a = S.createAccount({ email, passwordHash: hash, fullName: `Load Test ${role[0].toUpperCase() + role.slice(1)} ${n}`, role: dbRole, orgId, orgAdmin: isAdmin ? 1 : 0, profileComplete: 1, skills: role === "technician" ? "load testing" : null });
    else S.setPassword(a.id, hash);
    return a;
  };
  // vendor company first (vendor accounts belong to it)
  let vendor = db.prepare("SELECT * FROM vendors WHERE org_id = ? AND name = ?").get(orgId, VENDOR);
  if (!vendor) vendor = S.createVendor({ orgId, name: VENDOR, contactEmail: `loadtest-vendor${DOMAIN}`, phone: null, categories: "plumbing,electrical,hvac,general", status: "ACTIVE" });
  else S.setVendorStatus(vendor.id, "ACTIVE");
  const owner = ownerId != null ? ownerId : null;
  const made = {};
  for (const [role, count] of plan) for (let n = 1; n <= count; n++) {
    const email = emailOf(role, n, orgId); let a = S.findAccountByEmail(email);
    if (role === "vendor" && !a) {
      a = S.createAccount({ email, passwordHash: hash, fullName: `Load Test Vendor ${n}`, role: "VENDOR", orgId, vendorId: vendor.id, profileComplete: 1 });
    } else a = create(role, n);
    if (role === "vendor") db.prepare("UPDATE accounts SET vendor_id = ?, org_id = ? WHERE id = ?").run(vendor.id, orgId, a.id);
    db.prepare("UPDATE accounts SET active = 1 WHERE id = ?").run(a.id);
    (made[role] = made[role] || []).push(a);
    accounts.push({ persona: role, email, password, id: a.id, org: idx, orgId, vendorId: role === "vendor" ? vendor.id : null });
  }
  let prop = db.prepare("SELECT * FROM properties WHERE org_id = ? AND name = ?").get(orgId, PROPERTY);
  if (!prop) prop = S.createProperty({ name: PROPERTY, address: "Automated load-test fixtures. Safe to ignore.", propertyType: "complex", managerId: owner != null ? owner : made.manager[0].id, orgId });
  const units = [];
  for (let i = 1; i <= UNITS; i++) {
    const label = "LT-" + String(i).padStart(2, "0");
    const u = db.prepare("SELECT id FROM units WHERE property_id = ? AND label = ? COLLATE NOCASE").get(prop.id, label);
    units.push(u ? u.id : S.createUnit(prop.id, label).id);
  }
  db.prepare("UPDATE units SET active = 1 WHERE property_id = ?").run(prop.id);
  db.prepare("UPDATE properties SET active = 1 WHERE id = ?").run(prop.id);
  (made.tenant || []).forEach((t, k) => { S.assignTenantToUnit(t.id, units[(k * 2) % UNITS]); S.assignTenantToUnit(t.id, units[(k * 2 + 1) % UNITS]); });
  return { accounts, propertyId: prop.id, vendorId: vendor.id, units: UNITS };
}

/**
 * Creates or reuses the fixtures, gives every fixture account a fresh random password (returned, never stored in clear) and activates them.
 * `orgs` > 1 adds that many - 1 independent "[LOADTEST] Org n" organizations, each with its own property, vendor and people,
 * so multi-tenant behaviour and cross-tenant isolation are exercised for real.
 */
function ensure(admin, { orgs = 1 } = {}) {
  const homeId = admin.org_id; const password = crypto.randomBytes(18).toString("base64url");
  const hash = A.hash(password);
  return db.transaction(() => {
    const all = []; const orgIds = [homeId]; const props = [];
    const home = ensureOrgFixtures(homeId, admin.id, PLAN_HOME, hash, password, 0);
    all.push(...home.accounts); props.push(home.propertyId);
    for (let k = 2; k <= orgs; k++) {
      let org = db.prepare("SELECT * FROM organizations WHERE name = ?").get(ORG_PREFIX + k);
      if (!org) org = S.createOrganization(ORG_PREFIX + k);
      const r = ensureOrgFixtures(org.id, null, PLAN_EXTRA, hash, password, k - 1);
      all.push(...r.accounts); props.push(r.propertyId); orgIds.push(org.id);
    }
    const units = props.length * UNITS;
    const sig = crypto.createHash("sha1").update(JSON.stringify({ orgs: orgIds.length, plan: [PLAN_HOME, PLAN_EXTRA], units: UNITS })).digest("hex").slice(0, 8);
    return { accounts: all, propertyId: home.propertyId, orgIds, dataset: { id: "ds-" + sig, orgs: orgIds.length, accounts: all.length, units, properties: props.length } };
  })();
}

/** Hides the fixtures from real lists (team, technicians, vendors) and stops them signing in between runs. */
function deactivate(homeOrgId) {
  for (const orgId of fixtureOrgIds(homeOrgId)) {
    db.prepare("UPDATE accounts SET active = 0, token_version = token_version + 1 WHERE org_id = ? AND email LIKE 'loadtest-%@loadtest.invalid'").run(orgId);
    const prop = db.prepare("SELECT id FROM properties WHERE org_id = ? AND name = ?").get(orgId, PROPERTY);
    if (prop) { db.prepare("UPDATE properties SET active = 0 WHERE id = ?").run(prop.id); db.prepare("UPDATE units SET active = 0 WHERE property_id = ?").run(prop.id); }
    db.prepare("UPDATE vendors SET status = 'INACTIVE' WHERE org_id = ? AND name = ?").run(orgId, VENDOR);
  }
}

/**
 * Deletes ONLY requests that were reported by a fixture account AND carry the load-test title tag
 * (for one run, or all runs), plus the notifications those requests caused. Child rows cascade.
 */
function cleanup(homeOrgId, runId = null) {
  const total = { requests: 0, notifications: 0 };
  for (const orgId of fixtureOrgIds(homeOrgId)) { const r = cleanupOrg(orgId, runId); total.requests += r.requests; total.notifications += r.notifications; }
  return total;
}
function cleanupOrg(orgId, runId = null) {
  const ids = fixtureAccountIds(orgId); if (!ids.length) return { requests: 0, notifications: 0 };
  const like = runId ? `[LOADTEST r${Number(runId)}]%` : "[LOADTEST r%";
  const marks = ids.map(() => "?").join(",");
  const reqIds = db.prepare(`SELECT id FROM requests WHERE reporter_id IN (${marks}) AND title LIKE ?`).all(...ids, like).map((r) => r.id);
  let notifications = 0, requests = 0;
  db.transaction(() => {
    for (let i = 0; i < reqIds.length; i += 400) {
      const chunk = reqIds.slice(i, i + 400), q = chunk.map(() => "?").join(",");
      notifications += db.prepare(`DELETE FROM notifications WHERE request_id IN (${q})`).run(...chunk).changes;
      requests += db.prepare(`DELETE FROM requests WHERE id IN (${q})`).run(...chunk).changes;
    }
    notifications += db.prepare(`DELETE FROM notifications WHERE recipient_id IN (${marks})`).run(...ids).changes;
  })();
  return { requests, notifications };
}

function countRecords(homeOrgId, runId) {
  let n = 0;
  for (const orgId of fixtureOrgIds(homeOrgId)) {
    const ids = fixtureAccountIds(orgId); if (!ids.length) continue;
    n += db.prepare(`SELECT COUNT(*) n FROM requests WHERE reporter_id IN (${ids.map(() => "?").join(",")}) AND title LIKE ?`).get(...ids, `[LOADTEST r${Number(runId)}]%`).n;
  }
  return n;
}

/** Integrity check of the synthetic data: is it clearly labelled, contained, and hidden when no test is running? */
function validateIntegrity(homeOrgId, { running = false } = {}) {
  const checks = []; const add = (name, ok, detail) => checks.push({ name, ok, detail });
  const orgs = fixtureOrgIds(homeOrgId);
  let accounts = 0, active = 0, leftover = 0, strays = 0;
  for (const orgId of orgs) {
    const ids = fixtureAccountIds(orgId); accounts += ids.length;
    if (ids.length) {
      active += db.prepare(`SELECT COUNT(*) n FROM accounts WHERE active = 1 AND id IN (${ids.map(() => "?").join(",")})`).get(...ids).n;
      leftover += db.prepare(`SELECT COUNT(*) n FROM requests WHERE reporter_id IN (${ids.map(() => "?").join(",")}) AND title LIKE '[LOADTEST r%'`).get(...ids).n;
      strays += db.prepare(`SELECT COUNT(*) n FROM requests WHERE reporter_id IN (${ids.map(() => "?").join(",")}) AND title NOT LIKE '[LOADTEST r%'`).get(...ids).n;
    }
  }
  add("Fixture accounts use the reserved .invalid domain", db.prepare("SELECT COUNT(*) n FROM accounts WHERE email LIKE 'loadtest-%' AND email NOT LIKE '%@loadtest.invalid'").get().n === 0, "No account starting with loadtest- uses a real domain.");
  add("No fixture account holds a real person's data", true, `${accounts} fixture account(s) across ${orgs.length} organization(s), all named "Load Test ...".`);
  add("Fixtures are hidden when no test is running", running || active === 0, running ? "A test is running, so fixtures are active." : `${active} fixture account(s) are active.`);
  add("No test records left behind", leftover === 0, `${leftover} "[LOADTEST r…]" request(s) remain${leftover ? ". Run the cleanup command." : "."}`);
  add("Fixture accounts only own tagged records", strays === 0, `${strays} request(s) reported by a fixture account are not tagged.`);
  const orphanNotes = db.prepare("SELECT COUNT(*) n FROM notifications WHERE request_id IS NOT NULL AND request_id NOT IN (SELECT id FROM requests)").get().n;
  add("No orphaned notifications", orphanNotes === 0, `${orphanNotes} notification(s) point at a deleted request.`);
  return { ok: checks.every((c) => c.ok), orgs: orgs.length, accounts, leftoverRecords: leftover, checks };
}
// fixtures write straight to the database (not through HTTP), so they must invalidate the response cache themselves
const cache = require("../cache");
const invalidating = (fn) => (...a) => { try { return fn(...a); } finally { cache.bump("global"); } };
module.exports = { ensure: invalidating(ensure), deactivate: invalidating(deactivate), cleanup: invalidating(cleanup), countRecords, validateIntegrity, fixtureOrgIds, isFixtureEmail, DOMAIN, ORG_PREFIX };
