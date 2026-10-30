"use strict";
// Personal data: a copy of everything, erasure that cannot be undone, and retention.
const { isolate, reporter } = require("./helpers");
isolate();
const T = reporter("Personal data");
const { section } = T;
const ok = (cond, what, extra) => T.ok(what, cond, extra);
const app = require("../server");
const S = require("../src/store");
const A = require("../src/auth");
const P = require("../src/privacy");
const config = require("../src/config");
require("../src/seed")();

let BASE;
async function call(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  return { status: res.status, data, text, h: res.headers };
}
const login = async (email, password = "password123") => (await call("POST", "/api/auth/login", null, { email, password })).data;

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r)); BASE = "http://127.0.0.1:" + server.address().port;
  const tenant = await login("tenant@estateops.test"), mgr = await login("manager@estateops.test");
  const tAcc = S.findAccountByEmail("tenant@estateops.test");

  section("A copy of your data");
  let r = await call("GET", "/api/auth/my-data", tenant.token);
  ok(r.status === 200 && /attachment; filename="estateops-my-data-/.test(r.h.get("content-disposition")), "it downloads as a file");
  const d = r.data;
  ok(d.account.email === "tenant@estateops.test" && d.account.fullName, "the account is in it");
  ok(Array.isArray(d.homes) && d.homes.length >= 1 && d.homes[0].property && d.homes[0].unit, "the homes are in it");
  ok(d.requestsYouReported.length >= 1 && d.requestsYouReported[0].title, "the requests they reported are in it");
  ok("commentsYouWrote" in d && "notifications" in d && "signInsRecorded" in d && "yourActionsInTheAuditLog" in d, "comments, notifications, sign-ins and audit entries are in it");
  ok(!r.text.includes("password_hash") && !/\$2[aby]\$/.test(r.text), "no password hash");
  ok(!r.text.includes("mfa_secret") && !/manager@estateops\.test/.test(r.text), "no two-factor key and nobody else's email address");
  ok(S.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'DATA_EXPORTED'").get().n === 1, "the export is recorded in the audit log");
  ok((await call("GET", "/api/auth/my-data", null)).status === 401, "it needs a sign-in");
  const mine = await call("GET", "/api/auth/my-data", mgr.token);
  ok(mine.data.account.email === "manager@estateops.test", "each person gets only their own data");

  section("Erasing your own account");
  r = await call("POST", "/api/auth/delete-account", tenant.token, { password: "wrong", confirm: "DELETE" }); ok(r.status === 401, "the password is required");
  r = await call("POST", "/api/auth/delete-account", tenant.token, { password: "password123", confirm: "yes" }); ok(r.status === 400, "it must be confirmed with the word DELETE");
  const reqIds = S.db.prepare("SELECT id, title FROM requests WHERE reporter_id = ?").all(tAcc.id);
  const commentId = S.addComment(reqIds[0].id, tAcc.id, "Please call me on 98450 11122").id;
  r = await call("POST", "/api/auth/delete-account", tenant.token, { password: "password123", confirm: "delete" });
  ok(r.status === 204, "password plus DELETE erases the account");
  const after = S.db.prepare("SELECT * FROM accounts WHERE id = ?").get(tAcc.id);
  ok(after.email === `deleted-${tAcc.id}@removed.invalid` && after.full_name === "Deleted user" && !after.phone, "name, email and phone are gone");
  ok(after.active === 0 && after.password_hash === "erased", "the account is closed and cannot be signed in to");
  ok((await call("GET", "/api/auth/me", tenant.token)).status === 401, "their session ended");
  ok((await call("POST", "/api/auth/login", null, { email: "tenant@estateops.test", password: "password123" })).status === 401, "the old email no longer signs in");
  ok(S.db.prepare("SELECT body FROM comments WHERE id = ?").get(commentId).body === "[removed at the author's request]", "free text they wrote is removed (it can carry a phone number)");
  ok(S.db.prepare("SELECT COUNT(*) n FROM notifications WHERE recipient_id = ?").get(tAcc.id).n === 0, "their notifications are deleted");
  ok(S.db.prepare("SELECT COUNT(*) n FROM unit_assignments WHERE tenant_id = ?").get(tAcc.id).n === 0, "they are no longer linked to a home");
  ok(S.db.prepare("SELECT COUNT(*) n FROM sessions WHERE account_id = ?").get(tAcc.id).n === 0 && S.db.prepare("SELECT COUNT(*) n FROM mfa_recovery WHERE account_id = ?").get(tAcc.id).n === 0, "sessions and recovery codes are deleted");
  ok(S.db.prepare("SELECT COUNT(*) n FROM requests WHERE reporter_id = ?").get(tAcc.id).n === reqIds.length, "the maintenance history itself is kept (the landlord must keep it)");
  const list = await call("GET", "/api/maintenance-requests", mgr.token);
  ok(list.status === 200 && list.data.some((x) => x.reporterName === "Deleted user"), "and now shows 'Deleted user'");
  const dump = JSON.stringify(S.db.prepare("SELECT * FROM audit_log").all());
  ok(!dump.includes("tenant@estateops.test"), "their email is scrubbed from the audit log detail");
  ok(S.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'ACCOUNT_ERASED'").get().n === 1, "the erasure itself is recorded");

  section("A manager erasing someone who has left");
  const leaver = S.createAccount({ email: "leaver@estateops.test", passwordHash: A.hash("password123"), fullName: "Leaver Person", role: "TECHNICIAN", orgId: tAcc.org_id, profileComplete: 1, phone: "99999 00000" });
  r = await call("POST", `/api/accounts/${leaver.id}/erase`, mgr.token, { confirm: "ERASE" });
  ok(r.status === 409 && /Deactivate/.test(r.data.message), "the account must be deactivated first");
  await call("POST", `/api/accounts/${leaver.id}/status`, mgr.token, { active: false });
  r = await call("POST", `/api/accounts/${leaver.id}/erase`, mgr.token, { confirm: "no" }); ok(r.status === 400, "it must be confirmed with the word ERASE");
  r = await call("POST", `/api/accounts/${leaver.id}/erase`, mgr.token, { confirm: "ERASE" });
  ok(r.status === 200 && r.data.erased, "a manager can erase them");
  ok(S.db.prepare("SELECT full_name, phone FROM accounts WHERE id = ?").get(leaver.id).full_name === "Deleted user", "their name and phone are gone");
  r = await call("POST", `/api/accounts/${leaver.id}/erase`, mgr.token, { confirm: "ERASE" }); ok(r.data.already === true, "erasing twice is harmless");
  const otherOrg = S.createOrganization("Far Away"), far = S.createAccount({ email: "far@x.test", passwordHash: A.hash("password123"), fullName: "Far", role: "TECHNICIAN", orgId: otherOrg.id });
  S.setAccountActive(far.id, false);
  ok((await call("POST", `/api/accounts/${far.id}/erase`, mgr.token, { confirm: "ERASE" })).status === 404, "a manager cannot erase someone in another organization");
  const tech = await login("tech@estateops.test");
  ok((await call("POST", `/api/accounts/${leaver.id}/erase`, tech.token, { confirm: "ERASE" })).status === 403, "a technician cannot erase anyone");
  const onlyAdmin = await login("manager@estateops.test");
  r = await call("POST", "/api/auth/delete-account", onlyAdmin.token, { password: "password123", confirm: "DELETE" });
  ok(r.status === 409 && /only administrator/.test(r.data.message), "the last administrator must hand over before erasing themselves");

  section("Retention");
  ok(config.retention.requestDays === 0 && config.retention.auditDays === 0, "nothing is deleted unless a retention period is set");
  const unit = S.db.prepare("SELECT id FROM units LIMIT 1").get().id;
  const old = S.createRequest({ unitId: unit, reporterId: S.findAccountByEmail("manager@estateops.test").id, title: "Old closed job", description: "x", category: "PLUMBING", priority: "LOW" });
  S.db.prepare("UPDATE requests SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(new Date(Date.now() - 400 * 86400000).toISOString(), old.id);
  S.addComment(old.id, S.findAccountByEmail("manager@estateops.test").id, "note on the old job");
  const recent = S.createRequest({ unitId: unit, reporterId: S.findAccountByEmail("manager@estateops.test").id, title: "Recent job", description: "y", category: "PLUMBING", priority: "LOW" });
  let out = P.applyRetention({ requestDays: 0, auditDays: 0 });
  ok(out.requests === 0 && S.findRequest(old.id), "with retention off nothing is removed");
  out = P.applyRetention({ requestDays: 365, auditDays: 0 });
  ok(out.requests === 1 && !S.findRequest(old.id), "a closed request older than the period is removed");
  ok(S.db.prepare("SELECT COUNT(*) n FROM comments WHERE request_id = ?").get(old.id).n === 0, "with its comments, history and files");
  ok(!!S.findRequest(recent.id), "a recent request is untouched");
  S.db.prepare("UPDATE requests SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(new Date(Date.now() - 400 * 86400000).toISOString(), recent.id);
  const openOld = S.createRequest({ unitId: unit, reporterId: S.findAccountByEmail("manager@estateops.test").id, title: "Still open", description: "z", category: "PLUMBING", priority: "LOW" });
  S.db.prepare("UPDATE requests SET created_at = ?, updated_at = ? WHERE id = ?").run(new Date(Date.now() - 900 * 86400000).toISOString(), new Date(Date.now() - 900 * 86400000).toISOString(), openOld.id);
  S.db.prepare("UPDATE audit_log SET created_at = ? WHERE id IN (SELECT id FROM audit_log LIMIT 3)").run(new Date(Date.now() - 400 * 86400000).toISOString());
  out = P.applyRetention({ requestDays: 365, auditDays: 1 });
  ok(!!S.findRequest(openOld.id), "an old request that is not closed is kept");
  ok(out.auditEntries >= 1 && S.db.prepare("SELECT COUNT(*) n FROM audit_log WHERE created_at < ?").get(new Date(Date.now() - 86400000).toISOString()).n === 0, "old audit entries are removed when a period is set");

  server.close(); T.done();
})().catch((e) => { console.error(e); process.exit(1); });
