"use strict";
const { isolate, reporter } = require("./helpers");
const DIR = isolate();
const path = require("path");
const { execFileSync } = require("child_process");
const T = reporter("API");
const { ok, section } = T;

const app = require("../server");
const config = require("../src/config");
const AI = require("../src/ai");
const S = require("../src/store");

let BASE;
async function call(method, p, token, body, raw) {
  const res = await fetch(BASE + p, {
    method,
    headers: Object.assign(raw ? {} : { "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: raw ? raw : body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  return { status: res.status, data, headers: res.headers };
}
const expect = async (what, status, method, p, token, body) => {
  const r = await call(method, p, token, body);
  ok(`${what} -> ${r.status}`, r.status === status, r.data && r.data.message);
  return r;
};
const upload = async (p, token, name, bytes, type) => {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), name);
  return call("POST", p, token, undefined, fd);
};
const login = async (email, password) => (await call("POST", "/api/auth/login", null, { email, password })).data;

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const PW = "Str0ngPassw0rd";

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  BASE = "http://127.0.0.1:" + server.address().port;

  /* ------------------------------------------------------------------ */
  section("1. First-run setup (safe first administrator)");
  let r = await call("GET", "/api/setup/status");
  ok("empty database reports needsSetup", r.data.needsSetup === true);
  await expect("a weak password is refused", 400, "POST", "/api/setup", null,
    { email: "a@org-a.test", password: "short", fullName: "Alice Admin", organizationName: "Org A" });
  r = await call("POST", "/api/setup", null, { email: "alice@org-a.test", password: PW, fullName: "Alice Admin", organizationName: "Org A" });
  ok("setup creates the first manager", r.status === 201 && r.data.role === "MANAGER");
  const MA = r.data.token;
  await expect("setup cannot be run a second time", 409, "POST", "/api/setup", null,
    { email: "evil@x.test", password: PW, fullName: "Evil", organizationName: "Evil Org" });
  r = await call("GET", "/api/setup/status");
  ok("status flips to false after setup", r.data.needsSetup === false);
  r = await call("GET", "/api/auth/me", MA);
  ok("first manager is the organization admin", r.data.orgAdmin === true && r.data.organizationName === "Org A");

  /* ------------------------------------------------------------------ */
  section("2. Authentication");
  r = await call("POST", "/api/auth/login", null, { email: "alice@org-a.test", password: PW });
  ok("valid login returns a token", r.status === 200 && !!r.data.token);
  await expect("wrong password", 401, "POST", "/api/auth/login", null, { email: "alice@org-a.test", password: "nope-nope" });
  await expect("unknown email", 401, "POST", "/api/auth/login", null, { email: "ghost@x.test", password: PW });
  await expect("no token on a protected route", 401, "GET", "/api/dashboard", null);
  await expect("tampered token", 401, "GET", "/api/dashboard", MA.slice(0, -3) + "aaa");
  await expect("malformed JSON body", 400, "POST", "/api/auth/login", null, "{not json");
  r = await call("POST", "/api/auth/register", null, { email: "self.tenant@x.test", password: PW, fullName: "Self Tenant", role: "MANAGER" });
  ok("self-registration works", r.status === 201);
  ok("self-registration CANNOT grant MANAGER", r.data.role === "TENANT");
  const SELF = r.data.token;
  r = await call("POST", "/api/auth/register", null, { email: "self2.tenant@x.test", password: PW, fullName: "Self Two", role: "VENDOR", organizationId: 1 });
  ok("self-registration CANNOT grant VENDOR or an organization", r.data.role === "TENANT" && S.findAccountByEmail("self2.tenant@x.test").org_id === null);
  await expect("duplicate email", 409, "POST", "/api/auth/register", null, { email: "SELF.tenant@x.test", password: PW, fullName: "Dup" });
  await expect("short password", 400, "POST", "/api/auth/register", null, { email: "s@x.test", password: "abc", fullName: "S" });
  await expect("bad email", 400, "POST", "/api/auth/register", null, { email: "not-an-email", password: PW, fullName: "S" });
  for (let i = 0; i < 8; i++) await call("POST", "/api/auth/login", null, { email: "brute@x.test", password: "wrong" + i });
  await expect("repeated failures are throttled", 429, "POST", "/api/auth/login", null, { email: "brute@x.test", password: "wrong9" });

  /* ------------------------------------------------------------------ */
  section("3. Organization A: properties, units, vendors");
  r = await expect("manager creates a property", 201, "POST", "/api/properties", MA, { name: "Rosewood Residency", address: "12 Rosewood Ave" });
  const PROP_A = r.data.id;
  r = await expect("manager creates a unit", 201, "POST", "/api/units", MA, { propertyId: PROP_A, label: "7B" });
  const U7B = r.data.id;
  r = await call("POST", "/api/units", MA, { propertyId: PROP_A, label: "9C" });
  const U9C = r.data.id;
  await expect("duplicate unit label (case-insensitive)", 409, "POST", "/api/units", MA, { propertyId: PROP_A, label: "7b" });
  r = await expect("manager creates a vendor (starts PENDING)", 201, "POST", "/api/vendors", MA,
    { name: "Nair Plumbing Works", contactEmail: "office@nair.test", categories: ["PLUMBING", "HVAC"] });
  const VEN1 = r.data.id;
  ok("a new vendor is PENDING, not active", r.data.status === "PENDING");
  await expect("unknown service category refused", 400, "POST", "/api/vendors", MA, { name: "Bad Co", contactEmail: "b@x.test", categories: ["MAGIC"] });
  await expect("duplicate vendor name", 409, "POST", "/api/vendors", MA, { name: "nair plumbing works", contactEmail: "x@x.test" });
  r = await call("POST", "/api/vendors", MA, { name: "Spark Electricals", contactEmail: "spark@x.test", categories: ["ELECTRICAL"] });
  const VEN2 = r.data.id;

  /* ------------------------------------------------------------------ */
  section("4. Invitations and onboarding for every role");
  await expect("tenant cannot create invitations", 403, "POST", "/api/invitations", SELF, { email: "x@y.test", role: "TENANT" });
  r = await expect("manager invites a technician", 201, "POST", "/api/invitations", MA, { email: "tech1@org-a.test", role: "TECHNICIAN" });
  const TECH_TOKEN = r.data.token;
  ok("the invite link is returned once and is not guessable", TECH_TOKEN.length >= 40 && r.data.path.includes(TECH_TOKEN));
  r = await call("GET", "/api/invitations", MA);
  ok("pending invitation list never exposes tokens", r.data.length === 1 && r.data[0].token === undefined && r.data[0].tokenHash === undefined);
  r = await call("GET", "/api/invitations/lookup?token=" + TECH_TOKEN);
  ok("invite lookup shows email, role and organization", r.data.email === "tech1@org-a.test" && r.data.role === "TECHNICIAN" && r.data.organizationName === "Org A");
  await expect("a made-up token is rejected", 404, "GET", "/api/invitations/lookup?token=abc");
  await expect("accept needs a strong password", 400, "POST", "/api/invitations/accept", null, { token: TECH_TOKEN, fullName: "Tom Tech", password: "short" });
  r = await expect("technician accepts the invitation", 201, "POST", "/api/invitations/accept", null,
    { token: TECH_TOKEN, fullName: "Tom Tech", password: PW, skills: "Plumbing, HVAC", role: "MANAGER" });
  ok("the role comes from the invitation, never from the request", r.data.role === "TECHNICIAN");
  const T1 = r.data.token;
  await expect("an invitation cannot be used twice", 404, "POST", "/api/invitations/accept", null, { token: TECH_TOKEN, fullName: "Again", password: PW });

  r = await call("POST", "/api/invitations", MA, { email: "tech2@org-a.test", role: "TECHNICIAN" });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Tessa Tech", password: PW, skills: "Electrical" });
  const T2 = r.data.token;

  r = await expect("manager invites a tenant to a unit", 201, "POST", "/api/invitations", MA, { email: "riya@org-a.test", role: "TENANT", unitId: U7B });
  ok("tenant invite carries the unit", r.data.unit === "Rosewood Residency 7B");
  const TENANT_INVITE = r.data;
  r = await call("POST", "/api/invitations/accept", null, { token: TENANT_INVITE.token, fullName: "Riya Thomas", password: PW });
  const TN = r.data.token;
  ok("tenant is linked to the invited unit and only that unit", (await call("GET", "/api/units/reportable", TN)).data.map((u) => u.label).join() === "7B");
  r = await call("POST", "/api/invitations", MA, { email: "other@org-a.test", role: "TENANT", unitId: U9C });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Other Tenant", password: PW });
  const TN2 = r.data.token;

  await expect("vendor invitation needs a vendor company", 400, "POST", "/api/invitations", MA, { email: "kiran@nair.test", role: "VENDOR" });
  r = await expect("manager invites a vendor employee", 201, "POST", "/api/invitations", MA, { email: "kiran@nair.test", role: "VENDOR", vendorId: VEN1 });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Kiran Nair", password: PW });
  ok("vendor account created", r.status === 201 && r.data.role === "VENDOR");
  const V1 = r.data.token;
  r = await call("POST", "/api/invitations", MA, { email: "meera@nair.test", role: "VENDOR", vendorId: VEN1 });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Meera Nair", password: PW });
  const V1B = r.data.token;
  r = await call("POST", "/api/invitations", MA, { email: "sam@spark.test", role: "VENDOR", vendorId: VEN2 });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Sam Spark", password: PW });
  const V2 = r.data.token;

  r = await call("POST", "/api/invitations", MA, { email: "second.mgr@org-a.test", role: "MANAGER" });
  ok("an organization admin can invite another manager", r.status === 201);
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Mike Manager", password: PW });
  const MA2 = r.data.token;
  ok("the second manager is not an admin", (await call("GET", "/api/auth/me", MA2)).data.orgAdmin === false);
  await expect("a non-admin manager cannot invite a manager", 403, "POST", "/api/invitations", MA2, { email: "x1@org-a.test", role: "MANAGER" });
  await expect("a non-admin manager cannot create a manager account", 403, "POST", "/api/accounts", MA2, { email: "x2@org-a.test", password: PW, fullName: "X", role: "MANAGER" });
  await expect("email that already has an account", 409, "POST", "/api/invitations", MA, { email: "riya@org-a.test", role: "TENANT" });
  r = await call("POST", "/api/invitations", MA, { email: "revoked@org-a.test", role: "TENANT" });
  await expect("manager revokes an invitation", 204, "POST", `/api/invitations/${r.data.id}/revoke`, MA);
  await expect("a revoked invitation cannot be accepted", 404, "POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "R", password: PW });

  // expired invitation
  r = await call("POST", "/api/invitations", MA, { email: "late@org-a.test", role: "TENANT" });
  S.db.prepare("UPDATE invitations SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), r.data.id);
  await expect("an expired invitation is refused", 404, "POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "L", password: PW });

  r = await expect("manager provisions an account directly", 201, "POST", "/api/accounts", MA, { email: "direct.tech@org-a.test", password: PW, fullName: "Direct Tech", role: "TECHNICIAN" });
  await expect("direct creation needs a real role", 400, "POST", "/api/accounts", MA, { email: "z@org-a.test", password: PW, fullName: "Z", role: "SUPERUSER" });

  /* ------------------------------------------------------------------ */
  section("5. Organization B exists and is fully separate");
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "create-admin.js"),
    "--email", "bob@org-b.test", "--name", "Bob Admin", "--org", "Org B"],
    { env: Object.assign({}, process.env, { ADMIN_PASSWORD: PW }), stdio: "pipe" });
  const MB = (await login("bob@org-b.test", PW)).token;
  ok("the command-line tool created a working administrator", !!MB);
  r = await call("POST", "/api/properties", MB, { name: "Bayview Towers" });
  const PROP_B = r.data.id;
  r = await call("POST", "/api/units", MB, { propertyId: PROP_B, label: "1A" });
  const UB = r.data.id;
  r = await call("POST", "/api/invitations", MB, { email: "tb@org-b.test", role: "TENANT", unitId: UB });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Tara B", password: PW });
  const TNB = r.data.token;
  r = await call("POST", "/api/invitations", MB, { email: "techb@org-b.test", role: "TECHNICIAN" });
  r = await call("POST", "/api/invitations/accept", null, { token: r.data.token, fullName: "Tech B", password: PW });
  const TB = r.data.token;
  r = await call("POST", "/api/vendors", MB, { name: "Bay Fixers", contactEmail: "bay@x.test" });
  const VENB = r.data.id;

  r = await call("GET", "/api/properties", MB);
  ok("manager B sees only organization B's properties", r.data.length === 1 && r.data[0].name === "Bayview Towers");
  r = await call("GET", "/api/properties", MA);
  ok("manager A sees only organization A's properties", r.data.length === 1 && r.data[0].name === "Rosewood Residency");
  await expect("B cannot list A's units", 404, "GET", `/api/properties/${PROP_A}/units`, MB);
  await expect("B cannot add a unit to A's property", 404, "POST", "/api/units", MB, { propertyId: PROP_A, label: "X1" });
  await expect("B cannot see A's vendor status change", 404, "POST", `/api/vendors/${VEN1}/status`, MB, { status: "ACTIVE" });
  await expect("B cannot invite into A's unit", 404, "POST", "/api/invitations", MB, { email: "sneak@x.test", role: "TENANT", unitId: U7B });
  await expect("B cannot invite A's vendor staff", 404, "POST", "/api/invitations", MB, { email: "sneak2@x.test", role: "VENDOR", vendorId: VEN1 });
  r = await call("GET", "/api/vendors", MB);
  ok("B's vendor list holds only B's vendor", r.data.length === 1 && r.data[0].name === "Bay Fixers");
  r = await call("GET", "/api/team", MB);
  ok("B's team list never includes A's people", r.data.every((p) => !p.email.includes("org-a")));
  const selfId = (await call("GET", "/api/auth/me", T1)).data.id;
  await expect("B cannot deactivate A's technician", 404, "POST", `/api/accounts/${selfId}/status`, MB, { active: false });
  await expect("B cannot issue a reset link for A's user", 404, "POST", `/api/accounts/${selfId}/reset-link`, MB);

  /* ------------------------------------------------------------------ */
  section("6. Tenant onboarding: no claiming units by id");
  r = await call("GET", "/api/units/reportable", SELF);
  ok("a self-registered tenant starts with no units", r.status === 200 && r.data.length === 0);
  await expect("a tenant cannot report on a unit they were never linked to", 403, "POST", "/api/maintenance-requests", SELF,
    { unitId: U7B, title: "Free flat?", description: "Trying to claim a unit by id" });
  await expect("a tenant cannot report on another tenant's unit", 403, "POST", "/api/maintenance-requests", TN,
    { unitId: U9C, title: "Wrong unit", description: "Not mine" });
  await expect("manager B cannot link to A's unit", 404, "POST", `/api/units/${U7B}/tenants`, MB, { email: "self.tenant@x.test" });
  await expect("linking an unknown email", 404, "POST", `/api/units/${U7B}/tenants`, MA, { email: "nobody@x.test" });
  await expect("linking a non-tenant account", 404, "POST", `/api/units/${U7B}/tenants`, MA, { email: "tech1@org-a.test" });
  await expect("manager A approves the tenancy by email", 204, "POST", `/api/units/${U7B}/tenants`, MA, { email: "self.tenant@x.test" });
  r = await call("GET", "/api/units/reportable", SELF);
  ok("after approval the tenant can report on that unit only", r.data.length === 1 && r.data[0].label === "7B");
  await expect("a tenant who belongs to org A cannot be linked by org B", 409, "POST", `/api/units/${UB}/tenants`, MB, { email: "self.tenant@x.test" });

  /* ------------------------------------------------------------------ */
  section("7. Maintenance workflow end to end (in-house technician)");
  r = await expect("tenant reports an issue", 201, "POST", "/api/maintenance-requests", TN,
    { unitId: U7B, title: "Kitchen tap leaking", description: "Water runs from the tap base.", category: "PLUMBING", priority: "HIGH" });
  const REQ = r.data.id;
  ok("a new request starts REPORTED", r.data.status === "REPORTED");
  ok("the tenant is offered no status actions yet", r.data.allowedNext.length === 0);
  await expect("title too long", 400, "POST", "/api/maintenance-requests", TN, { unitId: U7B, title: "x".repeat(200), description: "d" });
  await expect("invalid category", 400, "POST", "/api/maintenance-requests", TN, { unitId: U7B, title: "t", description: "d", category: "MAGIC" });
  await expect("technician cannot report issues", 403, "POST", "/api/maintenance-requests", T1, { unitId: U7B, title: "t", description: "d" });
  await expect("vendor cannot report issues", 403, "POST", "/api/maintenance-requests", V1, { unitId: U7B, title: "t", description: "d" });

  r = await call("GET", "/api/notifications", MA);
  ok("organization A's manager was notified", r.data.some((n) => n.message.includes("Kitchen tap leaking")));
  r = await call("GET", "/api/notifications", MB);
  ok("organization B's manager was NOT notified", !r.data.some((n) => n.message.includes("Kitchen tap leaking")));

  await expect("another tenant cannot read the request", 403, "GET", `/api/maintenance-requests/${REQ}`, TN2);
  await expect("organization B's tenant cannot read it", 403, "GET", `/api/maintenance-requests/${REQ}`, TNB);
  await expect("organization B's manager cannot read it", 403, "GET", `/api/maintenance-requests/${REQ}`, MB);
  await expect("unassigned technician cannot read it", 403, "GET", `/api/maintenance-requests/${REQ}`, T1);
  await expect("tenant cannot change status", 403, "POST", `/api/maintenance-requests/${REQ}/status`, TN, { target: "UNDER_REVIEW" });
  await expect("tenant cannot assign", 403, "POST", `/api/maintenance-requests/${REQ}/assign`, TN, { technicianId: 1 });
  await expect("organization B's manager cannot assign A's request", 403, "POST", `/api/maintenance-requests/${REQ}/assign`, MB, { technicianId: 1 });
  await expect("an unlisted transition is rejected", 400, "POST", `/api/maintenance-requests/${REQ}/status`, MA, { target: "COMPLETED" });
  await expect("an invented status is rejected", 400, "POST", `/api/maintenance-requests/${REQ}/status`, MA, { target: "TELEPORTED" });
  r = await expect("manager moves it to review", 200, "POST", `/api/maintenance-requests/${REQ}/status`, MA, { target: "UNDER_REVIEW", note: "Looking at it" });
  ok("manager is offered only legal next steps", r.data.allowedNext.join() === "ASSIGNED,CLOSED");
  await expect("moving to ASSIGNED with nobody assigned is refused", 400, "POST", `/api/maintenance-requests/${REQ}/status`, MA, { target: "ASSIGNED" });

  const t1id = (await call("GET", "/api/auth/me", T1)).data.id;
  const t2id = (await call("GET", "/api/auth/me", T2)).data.id;
  const tbid = (await call("GET", "/api/auth/me", TB)).data.id;
  await expect("cannot assign another organization's technician", 404, "POST", `/api/maintenance-requests/${REQ}/assign`, MA, { technicianId: tbid });
  await expect("cannot assign a tenant as technician", 400, "POST", `/api/maintenance-requests/${REQ}/assign`, MA, { technicianId: (await call("GET", "/api/auth/me", TN)).data.id });
  await expect("must choose one assignee", 400, "POST", `/api/maintenance-requests/${REQ}/assign`, MA, { technicianId: t1id, vendorId: VEN1 });
  await expect("cannot assign a vendor that is still PENDING", 400, "POST", `/api/maintenance-requests/${REQ}/assign`, MA, { vendorId: VEN1 });
  r = await expect("manager assigns the technician", 200, "POST", `/api/maintenance-requests/${REQ}/assign`, MA,
    { technicianId: t1id, dueDate: "2030-01-01" });
  ok("assigning moves the request to ASSIGNED", r.data.status === "ASSIGNED" && r.data.technicianName === "Tom Tech");

  r = await call("GET", "/api/maintenance-requests", T1);
  ok("the technician's list holds exactly their job", r.data.length === 1 && r.data[0].id === REQ);
  r = await call("GET", "/api/maintenance-requests", T2);
  ok("the other technician sees nothing", r.data.length === 0);
  await expect("the other technician cannot open it", 403, "GET", `/api/maintenance-requests/${REQ}`, T2);
  await expect("the other technician cannot update it", 403, "POST", `/api/maintenance-requests/${REQ}/status`, T2, { target: "IN_PROGRESS" });
  await expect("the technician cannot close it", 403, "POST", `/api/maintenance-requests/${REQ}/status`, T1, { target: "CLOSED" });
  r = await expect("technician starts work", 200, "POST", `/api/maintenance-requests/${REQ}/status`, T1, { target: "IN_PROGRESS" });
  ok("technician is offered only COMPLETED", r.data.allowedNext.join() === "COMPLETED");
  await expect("completion needs notes", 400, "POST", `/api/maintenance-requests/${REQ}/status`, T1, { target: "COMPLETED" });
  await expect("technician completes with notes", 200, "POST", `/api/maintenance-requests/${REQ}/status`, T1, { target: "COMPLETED", completionNotes: "Replaced the washer." });
  await expect("technician cannot reopen", 403, "POST", `/api/maintenance-requests/${REQ}/status`, T1, { target: "REOPENED" });

  /* expenses and approvals */
  await expect("tenant cannot record an expense", 403, "POST", `/api/maintenance-requests/${REQ}/expenses`, TN, { amount: 10, description: "x" });
  await expect("zero amount refused", 400, "POST", `/api/maintenance-requests/${REQ}/expenses`, T1, { amount: 0, description: "x" });
  await expect("negative amount refused", 400, "POST", `/api/maintenance-requests/${REQ}/expenses`, T1, { amount: -5, description: "x" });
  r = await expect("technician records an expense", 201, "POST", `/api/maintenance-requests/${REQ}/expenses`, T1, { amount: 12.34, description: "Washer set" });
  const EXP = r.data.id;
  ok("money round-trips exactly (12.34)", r.data.amount === 12.34 && r.data.kind === "EXPENSE" && r.data.approved === false);
  await expect("technician cannot approve (not a manager)", 403, "POST", `/api/expenses/${EXP}/approve`, T1);
  await expect("organization B's manager cannot approve A's expense", 404, "POST", `/api/expenses/${EXP}/approve`, MB);
  r = await call("GET", `/api/maintenance-requests/${REQ}`, TN);
  ok("tenant sees no cost information", r.data.expenses.length === 0 && r.data.totalExpense === 0 && r.data.pendingExpense === 0);
  r = await expect("manager approves the expense", 200, "POST", `/api/expenses/${EXP}/approve`, MA);
  ok("approval records who approved", r.data.approved === true && r.data.approvedByName === "Alice Admin");
  await expect("approving twice is refused", 400, "POST", `/api/expenses/${EXP}/approve`, MA);
  r = await call("POST", `/api/maintenance-requests/${REQ}/expenses`, MA, { amount: 5, description: "Manager bought tape" });
  await expect("a manager cannot approve the expense they recorded", 400, "POST", `/api/expenses/${r.data.id}/approve`, MA);
  await expect("a second manager can", 200, "POST", `/api/expenses/${r.data.id}/approve`, MA2);
  r = await call("GET", `/api/maintenance-requests/${REQ}`, MA);
  ok("approved total = 12.34 + 5.00", r.data.totalExpense === 17.34, r.data.totalExpense);

  // approval threshold
  await expect("only the admin may set the approval limit", 403, "PUT", "/api/organization", MA2, { name: "Org A", approvalLimit: 100 });
  await expect("admin sets a 100.00 approval limit", 200, "PUT", "/api/organization", MA, { name: "Org A", approvalLimit: 100 });
  r = await call("POST", `/api/maintenance-requests/${REQ}/expenses`, T1, { amount: 250, description: "Replacement valve" });
  await expect("a non-admin manager is blocked above the limit", 403, "POST", `/api/expenses/${r.data.id}/approve`, MA2);
  await expect("the admin can approve above the limit", 200, "POST", `/api/expenses/${r.data.id}/approve`, MA);

  await expect("manager closes the request", 200, "POST", `/api/maintenance-requests/${REQ}/status`, MA, { target: "CLOSED" });
  await expect("comments are blocked on a closed request", 400, "POST", `/api/maintenance-requests/${REQ}/comments`, TN, { body: "hello" });
  await expect("recording cost on a closed request is blocked", 400, "POST", `/api/maintenance-requests/${REQ}/expenses`, T1, { amount: 1, description: "late" });
  await expect("the other tenant cannot reopen it", 403, "POST", `/api/maintenance-requests/${REQ}/status`, TN2, { target: "REOPENED" });
  await expect("the reporting tenant can reopen it", 200, "POST", `/api/maintenance-requests/${REQ}/status`, TN, { target: "REOPENED", note: "Still leaking" });
  await expect("comment works once reopened", 201, "POST", `/api/maintenance-requests/${REQ}/comments`, TN, { body: "Dripping again this morning." });
  await expect("empty comment refused", 400, "POST", `/api/maintenance-requests/${REQ}/comments`, TN, { body: "   " });
  r = await call("GET", `/api/maintenance-requests/${REQ}`, MA);
  const hist = r.data.history.map((h) => h.toStatus).join(">");
  ok("history records every change with who made it", hist.startsWith("REPORTED>UNDER_REVIEW>ASSIGNED>IN_PROGRESS>COMPLETED") && hist.endsWith("CLOSED>REOPENED") && r.data.history.every((h) => h.actorName));
  r = await call("GET", "/api/notifications", TN);
  ok("the tenant received notifications about their request", r.data.some((n) => n.message.includes("Kitchen tap leaking")));

  /* ------------------------------------------------------------------ */
  section("8. Vendor workflow and separation");
  r = await expect("manager reassigns the reopened request to the technician again", 200, "POST", `/api/maintenance-requests/${REQ}/assign`, MA, { technicianId: t1id });
  r = await call("POST", "/api/maintenance-requests", TN2, { unitId: U9C, title: "Ceiling seepage", description: "Damp patch near the window.", category: "PLUMBING", priority: "URGENT" });
  const VREQ = r.data.id;
  await expect("a PENDING vendor cannot be assigned", 400, "POST", `/api/maintenance-requests/${VREQ}/assign`, MA, { vendorId: VEN1 });
  r = await call("GET", "/api/maintenance-requests", V1);
  ok("a vendor of a PENDING company sees no work", r.data.length === 0);
  await expect("technician cannot activate a vendor", 403, "POST", `/api/vendors/${VEN1}/status`, T1, { status: "ACTIVE" });
  await expect("vendor cannot activate itself", 403, "POST", `/api/vendors/${VEN1}/status`, V1, { status: "ACTIVE" });
  await expect("an invalid vendor status is refused", 400, "POST", `/api/vendors/${VEN1}/status`, MA, { status: "SUPERHERO" });
  await expect("manager approves the vendor", 200, "POST", `/api/vendors/${VEN1}/status`, MA, { status: "ACTIVE" });
  await call("POST", `/api/vendors/${VEN2}/status`, MA, { status: "ACTIVE" });
  await expect("a vendor from another organization cannot be assigned", 404, "POST", `/api/maintenance-requests/${VREQ}/assign`, MA, { vendorId: VENB });
  r = await expect("manager assigns the vendor", 200, "POST", `/api/maintenance-requests/${VREQ}/assign`, MA, { vendorId: VEN1, dueDate: "2030-02-02" });
  ok("the request shows the vendor and no technician", r.data.vendorName === "Nair Plumbing Works" && r.data.technicianId === null);

  r = await call("GET", "/api/maintenance-requests", V1);
  ok("the vendor sees their work order", r.data.length === 1 && r.data[0].id === VREQ);
  r = await call("GET", "/api/maintenance-requests", V1B);
  ok("a colleague at the same vendor sees it too", r.data.length === 1);
  r = await call("GET", "/api/maintenance-requests", V2);
  ok("a different vendor sees nothing", r.data.length === 0);
  await expect("a different vendor cannot open it", 403, "GET", `/api/maintenance-requests/${VREQ}`, V2);
  await expect("the vendor cannot open the technician's job", 403, "GET", `/api/maintenance-requests/${REQ}`, V1);
  await expect("the technician cannot open the vendor's job", 403, "GET", `/api/maintenance-requests/${VREQ}`, T1);
  await expect("the vendor cannot assign anything", 403, "POST", `/api/maintenance-requests/${VREQ}/assign`, V1, { vendorId: VEN1 });
  await expect("the vendor cannot close the request", 403, "POST", `/api/maintenance-requests/${VREQ}/status`, V1, { target: "CLOSED" });
  await expect("a vendor cannot list the vendor directory", 403, "GET", "/api/vendors", V1);
  await expect("a vendor cannot see properties", 403, "GET", "/api/properties", V1);
  await expect("a vendor cannot see the team", 403, "GET", "/api/team", V1);
  await expect("a vendor cannot see the audit log", 403, "GET", "/api/audit", V1);
  await expect("a different vendor cannot quote", 403, "POST", `/api/maintenance-requests/${VREQ}/quotations`, V2, { amount: 100, description: "x" });
  await expect("a technician cannot quote", 403, "POST", `/api/maintenance-requests/${VREQ}/quotations`, T1, { amount: 100, description: "x" });
  r = await expect("the vendor submits a quotation", 201, "POST", `/api/maintenance-requests/${VREQ}/quotations`, V1, { amount: 4800, description: "Locate and seal the leak." });
  const QUOTE = r.data.id;
  r = await call("GET", `/api/maintenance-requests/${VREQ}`, V2).catch(() => null);
  r = await call("GET", `/api/maintenance-requests/${VREQ}`, V1B);
  ok("a colleague sees the company's quotation", r.data.quotations.length === 1);
  r = await call("GET", `/api/maintenance-requests/${VREQ}`, TN2);
  ok("the tenant does not see quotations", r.data.quotations.length === 0);
  await expect("vendor cannot approve its own quotation", 403, "POST", `/api/quotations/${QUOTE}/decision`, V1, { decision: "APPROVE" });
  await expect("organization B's manager cannot decide it", 404, "POST", `/api/quotations/${QUOTE}/decision`, MB, { decision: "APPROVE" });
  await expect("manager approves the quotation", 200, "POST", `/api/quotations/${QUOTE}/decision`, MA, { decision: "APPROVE" });
  await expect("a quotation cannot be decided twice", 400, "POST", `/api/quotations/${QUOTE}/decision`, MA, { decision: "REJECT" });
  r = await call("GET", "/api/notifications", V1);
  ok("the vendor was told about the work order and the decision", r.data.some((n) => n.message.includes("work order")) && r.data.some((n) => n.message.includes("approved")));

  await expect("the vendor starts the work", 200, "POST", `/api/maintenance-requests/${VREQ}/status`, V1, { target: "IN_PROGRESS" });
  await expect("a colleague completes it", 200, "POST", `/api/maintenance-requests/${VREQ}/status`, V1B, { target: "COMPLETED", completionNotes: "Sealed and repainted." });
  r = await expect("the vendor raises an invoice", 201, "POST", `/api/maintenance-requests/${VREQ}/expenses`, V1, { amount: 4700, description: "Invoice 0042" });
  ok("a vendor's cost is an INVOICE", r.data.kind === "INVOICE");
  const INV = r.data.id;
  await expect("the vendor cannot approve its own invoice", 403, "POST", `/api/expenses/${INV}/approve`, V1);
  r = await call("GET", `/api/maintenance-requests/${VREQ}`, T1).catch(() => null);
  await expect("the manager approves the invoice", 200, "POST", `/api/expenses/${INV}/approve`, MA);
  r = await call("GET", `/api/maintenance-requests/${VREQ}`, V1);
  ok("the vendor sees only its own invoice and the approved total", r.data.expenses.length === 1 && r.data.totalExpense === 4700);
  await call("POST", `/api/maintenance-requests/${VREQ}/status`, MA, { target: "CLOSED" });
  await expect("manager suspends the vendor", 200, "POST", `/api/vendors/${VEN1}/status`, MA, { status: "SUSPENDED" });
  await expect("a suspended vendor loses access to its work orders", 403, "GET", `/api/maintenance-requests/${VREQ}`, V1);
  r = await call("GET", "/api/maintenance-requests", V1);
  ok("a suspended vendor's list is empty", r.data.length === 0);
  r = await call("GET", "/api/vendors/me", V1);
  ok("the vendor can still see its own status", r.status === 200 && r.data.status === "SUSPENDED");
  await call("POST", `/api/vendors/${VEN1}/status`, MA, { status: "ACTIVE" });
  r = await expect("the vendor updates its own profile", 200, "PUT", "/api/vendors/me", V1, { phone: "555 0100", categories: ["PLUMBING"] });
  ok("profile saved", r.data.phone === "555 0100" && r.data.categories.join() === "PLUMBING");

  /* ------------------------------------------------------------------ */
  section("9. File uploads are real");
  await expect("an upload with no file is refused", 400, "POST", `/api/maintenance-requests/${REQ}/attachments`, TN, undefined);
  r = await upload(`/api/maintenance-requests/${REQ}/attachments`, TN, "leak photo.png", PNG, "image/png");
  ok("tenant uploads a PNG", r.status === 201 && r.data.mime === "image/png" && r.data.kind === "PHOTO", r.data);
  const ATT = r.data.id;
  r = await upload(`/api/maintenance-requests/${REQ}/attachments`, TN, "evil.png", Buffer.from("<script>alert(1)</script>"), "image/png");
  ok("a file that only pretends to be an image is refused", r.status === 400);
  r = await upload(`/api/maintenance-requests/${REQ}/attachments`, TN, "big.png", Buffer.concat([PNG, Buffer.alloc(config.maxUploadBytes + 10)]), "image/png");
  ok("an oversized file is refused", r.status === 400, r.data);
  r = await upload(`/api/maintenance-requests/${REQ}/attachments`, T1, "completion.pdf", PDF, "application/pdf");
  ok("the technician uploads completion evidence (PDF)", r.status === 201 && r.data.kind === "EVIDENCE");
  r = await upload(`/api/maintenance-requests/${REQ}/attachments`, TN2, "x.png", PNG, "image/png");
  ok("another tenant cannot upload to it", r.status === 403);
  r = await upload(`/api/maintenance-requests/${REQ}/attachments`, null, "x.png", PNG, "image/png");
  ok("an anonymous upload is refused", r.status === 401);
  const dl = await fetch(BASE + `/api/attachments/${ATT}`, { headers: { Authorization: "Bearer " + TN } });
  const bytes = Buffer.from(await dl.arrayBuffer());
  ok("the owner downloads the identical bytes with the right type", dl.status === 200 && bytes.equals(PNG) && dl.headers.get("content-type").startsWith("image/png"));
  ok("downloads are not sniffable", dl.headers.get("x-content-type-options") === "nosniff");
  await expect("the assigned technician can download it", 200, "GET", `/api/attachments/${ATT}`, T1);
  await expect("another tenant cannot download it", 403, "GET", `/api/attachments/${ATT}`, TN2);
  await expect("another organization's manager cannot download it", 403, "GET", `/api/attachments/${ATT}`, MB);
  await expect("an anonymous download is refused", 401, "GET", `/api/attachments/${ATT}`, null);
  r = await call("GET", `/api/maintenance-requests/${REQ}`, MA);
  ok("the request lists its attachments", r.data.attachments.length === 2);
  ok("the stored name never leaves the server", JSON.stringify(r.data).indexOf("stored") === -1);
  const fs = require("fs");
  ok("the files exist on disk under the upload folder", fs.readdirSync(config.uploadDir).length === 2);

  /* ------------------------------------------------------------------ */
  section("10. Notifications");
  r = await call("GET", "/api/notifications", TN);
  const mine = r.data[0].id;
  await expect("another user cannot mark my notification read", 403, "POST", `/api/notifications/${mine}/read`, TN2);
  await expect("I can mark my own notification read", 204, "POST", `/api/notifications/${mine}/read`, TN);
  await expect("mark all read", 204, "POST", "/api/notifications/read-all", TN);
  r = await call("GET", "/api/dashboard", TN);
  ok("unread count is zero afterwards", r.data.unreadNotifications === 0);

  /* ------------------------------------------------------------------ */
  section("11. Dashboards are computed from stored records");
  r = await call("GET", "/api/maintenance-requests", MA);
  const all = r.data;
  const dm = (await call("GET", "/api/dashboard", MA)).data;
  ok("manager open count matches the list", dm.openRequests === all.filter((x) => x.status !== "CLOSED").length, dm.openRequests);
  ok("manager closed count matches the list", dm.closedTotal === all.filter((x) => x.status === "CLOSED").length);
  const approvedSum = S.db.prepare(`SELECT COALESCE(SUM(x.amount_cents),0) AS s FROM expenses x JOIN requests r ON r.id=x.request_id
    JOIN units u ON u.id=r.unit_id JOIN properties p ON p.id=u.property_id WHERE p.org_id=? AND x.approved=1`).get(1).s;
  ok("manager spend equals the approved expenses in the database", Math.round(dm.monthlySpend * 100) === approvedSum, [dm.monthlySpend, approvedSum]);
  ok("manager sees vendor and technician load", Array.isArray(dm.assignments) && dm.assignments.length >= 1);
  ok("manager sees a monthly trend", dm.trend.length >= 1 && dm.trend[dm.trend.length - 1].reported >= 2);
  const dbOrgB = (await call("GET", "/api/dashboard", MB)).data;
  ok("organization B's dashboard shows none of A's activity", dbOrgB.openRequests === 0 && dbOrgB.monthlySpend === 0 && dbOrgB.recentActivity.length === 0);
  const dt = (await call("GET", "/api/dashboard", TN)).data;
  ok("tenant dashboard shows only their units and no spend", dt.units.length === 1 && dt.monthlySpend === 0 && dt.pendingSpend === 0);
  const dtech = (await call("GET", "/api/dashboard", T1)).data;
  ok("technician dashboard counts only their own work", dtech.openRequests === 1);
  const dv = (await call("GET", "/api/dashboard", V1)).data;
  ok("vendor dashboard shows the company and its status", dv.vendor.name === "Nair Plumbing Works" && dv.vendor.status === "ACTIVE");

  /* ------------------------------------------------------------------ */
  section("12. Search, filters and pagination run on the database");
  for (let i = 1; i <= 5; i++) await call("POST", "/api/maintenance-requests", TN, { unitId: U7B, title: `Bulk issue ${i}`, description: "bulk", category: "OTHER", priority: "LOW" });
  r = await call("GET", "/api/maintenance-requests?limit=2&offset=0", MA);
  ok("limit is honoured and the total is reported", r.data.length === 2 && Number(r.headers.get("x-total-count")) >= 7);
  const total = Number(r.headers.get("x-total-count"));
  r = await call("GET", `/api/maintenance-requests?limit=200&offset=${total - 1}`, MA);
  ok("offset pages to the end", r.data.length === 1);
  r = await call("GET", "/api/maintenance-requests?q=bulk%20issue%203", MA);
  ok("search finds the matching title only", r.data.length === 1 && r.data[0].title === "Bulk issue 3");
  r = await call("GET", "/api/maintenance-requests?q=7B", MA);
  ok("search matches unit labels", r.data.length >= 6);
  r = await call("GET", "/api/maintenance-requests?q=%25", MA);
  ok("a % in the search is a literal, not a wildcard", r.data.length === 0);
  r = await call("GET", "/api/maintenance-requests?status=REPORTED&priority=LOW", MA);
  ok("status and priority filters combine", r.data.length === 5 && r.data.every((x) => x.status === "REPORTED" && x.priority === "LOW"));
  await expect("an invalid filter value is refused", 400, "GET", "/api/maintenance-requests?status=NOPE", MA);
  r = await call("GET", "/api/maintenance-requests?q=bulk", TN2);
  ok("search never leaks another tenant's requests", r.data.length === 0);

  /* ------------------------------------------------------------------ */
  section("13. Insights from stored records");
  r = await call("GET", "/api/insights", MA);
  ok("repeat reports on the same unit and category are flagged", r.data.recurringIssues.some((x) => x.unitLabel === "7B" && x.category === "OTHER" && x.occurrences === 5), r.data.recurringIssues);
  ok("insights say they are rule-based, not AI", /rule-based/.test(r.data.method));
  // cost anomaly: three normal OTHER expenses and one big one
  const bulk = (await call("GET", "/api/maintenance-requests?q=bulk&limit=10", MA)).data;
  for (let i = 0; i < 3; i++) await call("POST", `/api/maintenance-requests/${bulk[i].id}/expenses`, MA, { amount: 100, description: "Parts" });
  await call("POST", `/api/maintenance-requests/${bulk[3].id}/expenses`, MA, { amount: 900, description: "Big job" });
  r = await call("GET", "/api/insights", MA);
  ok("an expense over twice the category norm is flagged", r.data.costAnomalies.some((x) => x.amount === 900 && x.typicalAmount === 100), r.data.costAnomalies);
  await expect("tenants cannot read insights", 403, "GET", "/api/insights", TN);
  r = await call("GET", "/api/insights", MB);
  ok("organization B's insights are empty", r.data.recurringIssues.length === 0 && r.data.costAnomalies.length === 0);

  /* ------------------------------------------------------------------ */
  section("14. AI suggestions: honest when unavailable, validated when available");
  r = await call("GET", "/api/ai/status", MA);
  ok("status reports AI as not configured", r.data.configured === false);
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("no key -> 503 AI_NOT_CONFIGURED, never a fake result", r.status === 503 && r.data.code === "AI_NOT_CONFIGURED");
  await expect("tenants cannot request AI suggestions", 403, "POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, TN);
  config.gemini.key = "test-key-not-real";
  let sent = null, reply;
  AI.useFetch(async (url, opts) => { sent = { url, opts }; return reply(); });
  const gem = (obj, status = 200) => () => ({ ok: status < 400, status, json: async () => ({ candidates: [{ content: { parts: [{ text: typeof obj === "string" ? obj : JSON.stringify(obj) }] } }] }) });
  reply = gem({ category: "PLUMBING", priority: "urgent", explanation: "Active leak can damage the unit." });
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("a valid reply is stored as a suggestion", r.status === 201 && r.data.category === "PLUMBING" && r.data.priority === "URGENT" && !r.data.decision, r.data);
  const SUG = r.data.id;
  const payload = sent.opts.body;
  ok("only the issue text is sent: no names, emails or unit labels", !/Riya|Tenant|org-a|7B|Rosewood/.test(payload), payload.slice(0, 200));
  ok("the key travels in a header, not the URL", sent.opts.headers["x-goog-api-key"] === "test-key-not-real" && !sent.url.includes("test-key"));
  r = await call("GET", `/api/maintenance-requests/${REQ}`, MA);
  ok("the suggestion shows on the request for managers", r.data.aiSuggestion && r.data.aiSuggestion.id === SUG);
  r = await call("GET", `/api/maintenance-requests/${REQ}`, TN);
  ok("tenants never see AI suggestions", r.data.aiSuggestion === null);
  await expect("organization B's manager cannot decide it", 404, "POST", `/api/ai-suggestions/${SUG}/decision`, MB, { decision: "ACCEPT" });
  await expect("a decision must be ACCEPT or REJECT", 400, "POST", `/api/ai-suggestions/${SUG}/decision`, MA, { decision: "MAYBE" });
  await expect("a manager accepts the suggestion", 200, "POST", `/api/ai-suggestions/${SUG}/decision`, MA, { decision: "ACCEPT" });
  r = await call("GET", `/api/maintenance-requests/${REQ}`, MA);
  ok("accepting applies the priority to the request", r.data.request.priority === "URGENT" && r.data.aiSuggestion.decision === "ACCEPTED");
  await expect("a suggestion is decided once", 400, "POST", `/api/ai-suggestions/${SUG}/decision`, MA, { decision: "REJECT" });
  reply = gem({ category: "TELEPORTATION", priority: "LOW", explanation: "nonsense" });
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("an invalid category from the model is rejected", r.status === 502 && r.data.code === "AI_BAD_RESPONSE");
  reply = gem("this is not json");
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("a non-JSON reply is rejected", r.status === 502 && r.data.code === "AI_BAD_RESPONSE");
  reply = () => ({ ok: false, status: 429, json: async () => ({}) });
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("a rate limit is reported as such", r.status === 503 && r.data.code === "AI_RATE_LIMITED");
  reply = () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; };
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("a timeout is reported as such", r.status === 504 && r.data.code === "AI_TIMEOUT");
  reply = () => { throw new Error("ECONNREFUSED"); };
  r = await call("POST", `/api/maintenance-requests/${REQ}/ai-suggestion`, MA);
  ok("an unreachable service is reported as such", r.status === 502 && r.data.code === "AI_UNREACHABLE");
  r = await call("GET", "/api/dashboard", MA);
  ok("the core application keeps working while the AI is down", r.status === 200);
  config.gemini.key = null;

  /* ------------------------------------------------------------------ */
  section("15. Sessions, passwords and deactivation");
  let tok = (await login("tenant.session@x.test", PW));
  r = await call("POST", "/api/auth/register", null, { email: "tenant.session@x.test", password: PW, fullName: "Session Tenant" });
  const S1 = r.data.token;
  await expect("token works", 200, "GET", "/api/auth/me", S1);
  await expect("logout", 204, "POST", "/api/auth/logout", S1);
  await expect("the token is dead after logout", 401, "GET", "/api/auth/me", S1);
  const S2 = (await login("tenant.session@x.test", PW)).token;
  await expect("signing in again works", 200, "GET", "/api/auth/me", S2);
  await expect("changing the password needs the current one", 401, "POST", "/api/auth/change-password", S2, { currentPassword: "wrong", newPassword: "AnotherStr0ng!" });
  await expect("the new password must be strong enough", 400, "POST", "/api/auth/change-password", S2, { currentPassword: PW, newPassword: "short" });
  r = await expect("password change succeeds", 200, "POST", "/api/auth/change-password", S2, { currentPassword: PW, newPassword: "AnotherStr0ng!" });
  const S3 = r.data.token;
  await expect("the old session is signed out", 401, "GET", "/api/auth/me", S2);
  await expect("the fresh token works", 200, "GET", "/api/auth/me", S3);
  await expect("the old password no longer logs in", 401, "POST", "/api/auth/login", null, { email: "tenant.session@x.test", password: PW });

  const victim = await call("GET", "/api/auth/me", T2);
  await expect("manager deactivates a technician", 200, "POST", `/api/accounts/${victim.data.id}/status`, MA, { active: false });
  await expect("a deactivated user's token stops working at once", 401, "GET", "/api/auth/me", T2);
  await expect("a deactivated user cannot log in", 403, "POST", "/api/auth/login", null, { email: "tech2@org-a.test", password: PW });
  await expect("a manager cannot deactivate themselves", 400, "POST", `/api/accounts/${(await call("GET", "/api/auth/me", MA)).data.id}/status`, MA, { active: false });
  await expect("manager reactivates the technician", 200, "POST", `/api/accounts/${victim.data.id}/status`, MA, { active: true });
  r = await expect("manager issues a password reset link", 201, "POST", `/api/accounts/${victim.data.id}/reset-link`, MA);
  r = await expect("the user sets a new password through the link", 201, "POST", "/api/invitations/accept", null, { token: r.data.token, password: "BrandNewPassw0rd" });
  await expect("the new password works", 200, "POST", "/api/auth/login", null, { email: "tech2@org-a.test", password: "BrandNewPassw0rd" });
  await expect("the old password is gone", 401, "POST", "/api/auth/login", null, { email: "tech2@org-a.test", password: PW });
  r = await expect("profile can be completed", 200, "PUT", "/api/auth/profile", T1, { fullName: "Tom Tech", phone: "555 0111", skills: "Plumbing, HVAC, Gas" });
  ok("profile saved", r.data.phone === "555 0111" && r.data.skills.includes("Gas") && r.data.profileComplete);

  /* ------------------------------------------------------------------ */
  section("16. Audit log");
  r = await call("GET", "/api/audit?limit=200", MA);
  const acts = new Set(r.data.map((x) => x.action));
  for (const a of ["SETUP_COMPLETED", "INVITATION_CREATED", "INVITATION_ACCEPTED", "REQUEST_ASSIGNED", "EXPENSE_APPROVED", "STATUS_CHANGED",
                   "QUOTATION_APPROVED", "VENDOR_STATUS_CHANGED", "AI_SUGGESTION_ACCEPTED", "ACCOUNT_DEACTIVATED", "PASSWORD_RESET_ISSUED"]) {
    ok(`audit log records ${a}`, acts.has(a));
  }
  ok("every entry names who did it", r.data.every((x) => x.actorName));
  r = await call("GET", "/api/audit", MB);
  ok("organization B sees none of A's audit trail", !r.data.some((x) => ["REQUEST_ASSIGNED", "EXPENSE_APPROVED"].includes(x.action)));
  await expect("tenant cannot read the audit log", 403, "GET", "/api/audit", TN);
  await expect("technician cannot read the audit log", 403, "GET", "/api/audit", T1);

  /* ------------------------------------------------------------------ */
  section("17. Platform behaviour");
  r = await call("GET", "/health");
  ok("health endpoint reports the database", r.status === 200 && r.data.status === "UP" && r.data.database === "UP");
  await expect("unknown API path is a JSON 404", 404, "GET", "/api/nope", MA);
  r = await call("GET", "/openapi.json");
  ok("the OpenAPI document is served", r.status === 200 && r.data.openapi.startsWith("3."));
  r = await fetch(BASE + "/docs/");
  ok("Swagger UI is served", r.status === 200);
  r = await fetch(BASE + "/login.html");
  ok("static pages carry security headers", r.headers.get("x-frame-options") === "DENY" && r.headers.get("x-content-type-options") === "nosniff");
  await expect("an oversized JSON body is refused", 413, "POST", "/api/auth/login", null, JSON.stringify({ email: "a@b.co", password: "x".repeat(200000) }));
  ok("the attachments folder is not reachable as a static path", (await fetch(BASE + "/uploads/")).status === 404);

  /* persistence: a brand-new process reads the same database */
  const out = execFileSync(process.execPath, ["-e",
    "const S=require('./src/store');console.log(JSON.stringify({a:S.countAccounts(),r:S.db.prepare('SELECT COUNT(*) n FROM requests').get().n,x:S.db.prepare('SELECT COUNT(*) n FROM expenses WHERE approved=1').get().n}))"],
    { cwd: path.join(__dirname, ".."), env: process.env }).toString();
  const persisted = JSON.parse(out);
  ok("data survives a restart (separate process reads it back)", persisted.a >= 15 && persisted.r >= 7 && persisted.x >= 4, persisted);
  const fk = S.db.pragma("foreign_key_check");
  ok("foreign keys are consistent", fk.length === 0);
  ok("foreign key enforcement is on", S.db.pragma("foreign_keys")[0].foreign_keys === 1);
  let blocked = false;
  try { S.db.prepare("INSERT INTO requests (unit_id, reporter_id, title, description, created_at, updated_at) VALUES (999,1,'x','x','n','n')").run(); } catch (e) { blocked = true; }
  ok("the database rejects a request for a unit that does not exist", blocked);
  blocked = false;
  try { S.db.prepare("INSERT INTO expenses (request_id, recorded_by_id, amount_cents, description, created_at) VALUES (1,1,-5,'x','n')").run(); } catch (e) { blocked = true; }
  ok("the database rejects a negative expense", blocked);

  server.close();
  require("fs").rmSync(DIR, { recursive: true, force: true });
  T.done();
})().catch((e) => { console.error(e); process.exit(2); });
