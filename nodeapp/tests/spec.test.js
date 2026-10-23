"use strict";
// The API documentation must describe the API that actually runs.
const { isolate, reporter } = require("./helpers");
const DIR = isolate();
process.env.SEED_DEV = "1";
const Ajv = require("ajv");
const T = reporter("Docs");
const { ok, section } = T;

const spec = require("../src/openapi");
const routes = require("../src/routes");
const config = require("../src/config");
const AI = require("../src/ai");
const app = require("../server");
require("../src/seed")();

/* ---------------------------------------------------------------- 1. route coverage */
section("1. Every route is documented and every documented route exists");
const norm = (p) => p.replace(/\{(\w+)\}/g, ":$1");
const documented = new Set();
for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops)) documented.add(m.toUpperCase() + " " + norm(p));
const implemented = new Set(["GET /health"]);
for (const layer of routes.stack) {
  if (!layer.route) continue;
  for (const m of Object.keys(layer.route.methods)) implemented.add(m.toUpperCase() + " /api" + layer.route.path);
}
const docOnly = [...documented].filter((x) => !implemented.has(x)).sort();
const implOnly = [...implemented].filter((x) => !documented.has(x)).sort();
ok(`documented operations: ${documented.size}, implemented: ${implemented.size}`, documented.size === implemented.size);
ok("nothing documented that does not exist", docOnly.length === 0, docOnly);
ok("nothing implemented that is not documented", implOnly.length === 0, implOnly);

/* ---------------------------------------------------------------- 2. structure */
section("2. The document is well-formed");
const tagNames = new Set(spec.tags.map((t) => t.name));
let missingBits = [];
for (const [p, ops] of Object.entries(spec.paths)) for (const [m, o] of Object.entries(ops)) {
  if (!o.summary || !o.tags || !o.tags.every((t) => tagNames.has(t)) || !o.responses || !Object.keys(o.responses).length) missingBits.push(m + " " + p);
  const needsId = [...p.matchAll(/\{(\w+)\}/g)].map((x) => x[1]);
  const have = (o.parameters || []).filter((x) => x.in === "path").map((x) => x.name);
  if (needsId.join() !== have.join()) missingBits.push(`${m} ${p} path parameters ${have} vs ${needsId}`);
}
ok("every operation has a summary, a known tag, responses and its path parameters", missingBits.length === 0, missingBits);
const dumped = JSON.stringify(spec);
const refs = [...dumped.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]);
ok("every $ref points at a real schema", refs.every((r) => spec.components.schemas[r]), refs.filter((r) => !spec.components.schemas[r]));
const publicOps = []; for (const [p, ops] of Object.entries(spec.paths)) for (const [m, o] of Object.entries(ops)) if (o.security && o.security.length === 0) publicOps.push(m + " " + p);
ok("public operations are exactly the intended ones", publicOps.sort().join("|") === ["get /api/setup/status", "post /api/setup", "post /api/auth/register", "post /api/auth/login", "get /api/invitations/lookup", "post /api/invitations/accept", "get /health"].sort().join("|"), publicOps);

/* ---------------------------------------------------------------- 3. live contract */
const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
const validators = new Map();
// OpenAPI 3.0 "nullable" -> JSON Schema, so a validator can use the document as written.
function toJsonSchema(n) {
  if (Array.isArray(n)) return n.map(toJsonSchema);
  if (!n || typeof n !== "object") return n;
  const o = {}; for (const k of Object.keys(n)) o[k] = toJsonSchema(n[k]);
  if (o.nullable === true) {
    delete o.nullable;
    if (o.type) { o.type = [o.type, "null"]; if (o.enum) o.enum = [...o.enum, null]; }
    else return { anyOf: [o, { type: "null" }] };
  }
  return o;
}
const components = toJsonSchema(spec.components);
function validatorFor(schema) {
  const key = JSON.stringify(schema);
  if (!validators.has(key)) validators.set(key, ajv.compile({ components, ...toJsonSchema(schema) }));
  return validators.get(key);
}
let BASE;
async function call(method, p, token, body, raw) {
  const res = await fetch(BASE + p, { method,
    headers: Object.assign(raw ? {} : { "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: raw ? raw : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  return { status: res.status, data };
}
/** Calls the real server and validates the reply against what the document promises for that status. */
async function contract(label, method, template, actual, token, body, expectStatus, raw) {
  const r = await call(method, actual, token, body, raw);
  const op = spec.paths[template] && spec.paths[template][method.toLowerCase()];
  const doc = op && op.responses[r.status];
  if (!ok(`${label}: ${r.status} is a documented response`, r.status === expectStatus && !!doc, [r.status, r.data && r.data.message])) return r;
  const media = doc.content && doc.content["application/json"];
  if (media && r.data !== null) {
    const v = validatorFor(media.schema);
    const valid = v(r.data);
    ok(`${label}: body matches the documented schema`, valid, valid ? "" : v.errors.slice(0, 3).map((e) => e.instancePath + " " + e.message));
  }
  return r;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

(async () => {
  const server = app.listen(0); await new Promise((r) => server.once("listening", r));
  BASE = "http://127.0.0.1:" + server.address().port;

  section("3. Live responses match the documented schemas");
  await contract("health", "GET", "/health", "/health", null, undefined, 200);
  await contract("setup status", "GET", "/api/setup/status", "/api/setup/status", null, undefined, 200);
  await contract("setup already done", "POST", "/api/setup", "/api/setup", null, { email: "a@b.co", password: "Str0ngPassw0rd", fullName: "A", organizationName: "O" }, 409);
  const tok = {};
  for (const [role, email] of [["M", "manager@estateops.test"], ["K", "tech@estateops.test"], ["T", "tenant@estateops.test"], ["V", "vendor@estateops.test"]]) {
    const r = await contract("login " + role, "POST", "/api/auth/login", "/api/auth/login", null, { email, password: "password123" }, 200);
    tok[role] = r.data.token;
    await contract("me " + role, "GET", "/api/auth/me", "/api/auth/me", tok[role], undefined, 200);
    await contract("dashboard " + role, "GET", "/api/dashboard", "/api/dashboard", tok[role], undefined, 200);
    await contract("requests " + role, "GET", "/api/maintenance-requests", "/api/maintenance-requests", tok[role], undefined, 200);
    await contract("notifications " + role, "GET", "/api/notifications", "/api/notifications", tok[role], undefined, 200);
  }
  await contract("bad login", "POST", "/api/auth/login", "/api/auth/login", null, { email: "manager@estateops.test", password: "nope" }, 401);
  await contract("no token", "GET", "/api/team", "/api/team", null, undefined, 401);
  await contract("wrong role", "GET", "/api/team", "/api/team", tok.T, undefined, 403);

  for (const [t, p] of [["/api/team", "/api/team"], ["/api/technicians", "/api/technicians"], ["/api/tenants", "/api/tenants"], ["/api/vendors", "/api/vendors?status=ACTIVE"],
    ["/api/properties", "/api/properties"], ["/api/organization", "/api/organization"], ["/api/invitations", "/api/invitations"], ["/api/insights", "/api/insights"],
    ["/api/audit", "/api/audit"], ["/api/ai/status", "/api/ai/status"], ["/api/units/reportable", "/api/units/reportable"]]) {
    await contract("manager " + t, "GET", t, p, tok.M, undefined, 200);
  }
  await contract("tenant units", "GET", "/api/units/reportable", "/api/units/reportable", tok.T, undefined, 200);
  await contract("vendor company", "GET", "/api/vendors/me", "/api/vendors/me", tok.V, undefined, 200);
  const props = (await call("GET", "/api/properties", tok.M)).data;
  await contract("units of a property", "GET", "/api/properties/{id}/units", `/api/properties/${props[0].id}/units`, tok.M, undefined, 200);

  const list = (await call("GET", "/api/maintenance-requests?limit=50", tok.M)).data;
  for (const r of list) await contract(`request ${r.id} detail`, "GET", "/api/maintenance-requests/{id}", `/api/maintenance-requests/${r.id}`, tok.M, undefined, 200);
  await contract("filtered list", "GET", "/api/maintenance-requests", "/api/maintenance-requests?q=tap&status=REPORTED&limit=5&offset=0", tok.M, undefined, 200);
  await contract("vendor detail", "GET", "/api/maintenance-requests/{id}", `/api/maintenance-requests/${list.find((x) => x.vendorId).id}`, tok.V, undefined, 200);
  await contract("tenant detail", "GET", "/api/maintenance-requests/{id}", `/api/maintenance-requests/${list[0].id}`, tok.T, undefined, 200);
  await contract("forbidden detail", "GET", "/api/maintenance-requests/{id}", `/api/maintenance-requests/${list[0].id}`, tok.K, undefined, 403);
  await contract("missing request", "GET", "/api/maintenance-requests/{id}", "/api/maintenance-requests/99999", tok.M, undefined, 404);

  section("4. Writes and their documented replies");
  const unit = (await call("GET", "/api/units/reportable", tok.T)).data[0];
  const created = await contract("report an issue", "POST", "/api/maintenance-requests", "/api/maintenance-requests", tok.T, { unitId: unit.id, title: "Doc test leak", description: "d", category: "PLUMBING", priority: "HIGH" }, 201);
  const id = created.data.id;
  await contract("report with bad data", "POST", "/api/maintenance-requests", "/api/maintenance-requests", tok.T, { unitId: unit.id, title: "", description: "d" }, 400);
  await contract("comment", "POST", "/api/maintenance-requests/{id}/comments", `/api/maintenance-requests/${id}/comments`, tok.T, { body: "hi" }, 201);
  const upload = new FormData(); upload.append("file", new Blob([png], { type: "image/png" }), "a.png");
  await contract("upload", "POST", "/api/maintenance-requests/{id}/attachments", `/api/maintenance-requests/${id}/attachments`, tok.T, undefined, 201, upload);
  await contract("review", "POST", "/api/maintenance-requests/{id}/status", `/api/maintenance-requests/${id}/status`, tok.M, { target: "UNDER_REVIEW" }, 200);
  const techs = (await call("GET", "/api/technicians", tok.M)).data;
  await contract("assign", "POST", "/api/maintenance-requests/{id}/assign", `/api/maintenance-requests/${id}/assign`, tok.M, { technicianId: (techs.find((t) => t.email === "tech@estateops.test") || techs[0]).id, dueDate: "2031-01-01" }, 200);
  const dl = await fetch(BASE + "/api/attachments/1", { headers: { Authorization: "Bearer " + tok.M } });
  ok("attachment download documented as 200 with bytes", dl.status === 200 && !!spec.paths["/api/attachments/{id}"].get.responses[200]);
  await contract("technician starts", "POST", "/api/maintenance-requests/{id}/status", `/api/maintenance-requests/${id}/status`, tok.K, { target: "IN_PROGRESS" }, 200);
  const exp = await contract("technician expense", "POST", "/api/maintenance-requests/{id}/expenses", `/api/maintenance-requests/${id}/expenses`, tok.K, { amount: 99.5, description: "part" }, 201);
  await contract("approve expense", "POST", "/api/expenses/{id}/approve", `/api/expenses/${exp.data.id}/approve`, tok.M, undefined, 200);
  await contract("complete", "POST", "/api/maintenance-requests/{id}/status", `/api/maintenance-requests/${id}/status`, tok.K, { target: "COMPLETED", completionNotes: "done" }, 200);

  const vreq = list.find((x) => x.vendorId && x.status === "ASSIGNED");
  const q = await contract("vendor quotation", "POST", "/api/maintenance-requests/{id}/quotations", `/api/maintenance-requests/${vreq.id}/quotations`, tok.V, { amount: 500, description: "work" }, 201);
  await contract("decide quotation", "POST", "/api/quotations/{id}/decision", `/api/quotations/${q.data.id}/decision`, tok.M, { decision: "APPROVE" }, 200);

  await contract("ai suggestion without a key", "POST", "/api/maintenance-requests/{id}/ai-suggestion", `/api/maintenance-requests/${id}/ai-suggestion`, tok.M, undefined, 503);
  config.gemini.key = "k";
  AI.useFetch(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ category: "PLUMBING", priority: "HIGH", explanation: "x" }) }] } }] }) }));
  const sug = await contract("ai suggestion", "POST", "/api/maintenance-requests/{id}/ai-suggestion", `/api/maintenance-requests/${id}/ai-suggestion`, tok.M, undefined, 201);
  await contract("ai decision", "POST", "/api/ai-suggestions/{id}/decision", `/api/ai-suggestions/${sug.data.id}/decision`, tok.M, { decision: "ACCEPT" }, 200);
  AI.useFetch(async () => { throw new Error("down"); });
  await contract("ai unreachable", "POST", "/api/maintenance-requests/{id}/ai-suggestion", `/api/maintenance-requests/${id}/ai-suggestion`, tok.M, undefined, 502);
  config.gemini.key = null;

  const prop = await contract("add property", "POST", "/api/properties", "/api/properties", tok.M, { name: "Doc Court", address: "1 Doc St" }, 201);
  const u = await contract("add unit", "POST", "/api/units", "/api/units", tok.M, { propertyId: prop.data.id, label: "D1" }, 201);
  await contract("duplicate unit", "POST", "/api/units", "/api/units", tok.M, { propertyId: prop.data.id, label: "d1" }, 409);
  await contract("self sign-up", "POST", "/api/auth/register", "/api/auth/register", null, { email: "doc.tenant@x.test", password: "Str0ngPassw0rd", fullName: "Doc Tenant" }, 201);
  await contract("link tenant", "POST", "/api/units/{unitId}/tenants", `/api/units/${u.data.id}/tenants`, tok.M, { email: "doc.tenant@x.test" }, 204);
  const v = await contract("add vendor", "POST", "/api/vendors", "/api/vendors", tok.M, { name: "Doc Vendor", contactEmail: "v@doc.test", categories: ["HVAC"] }, 201);
  await contract("vendor status", "POST", "/api/vendors/{id}/status", `/api/vendors/${v.data.id}/status`, tok.M, { status: "ACTIVE" }, 200);
  const inv = await contract("invite", "POST", "/api/invitations", "/api/invitations", tok.M, { email: "doc.vendor@x.test", role: "VENDOR", vendorId: v.data.id }, 201);
  await contract("lookup", "GET", "/api/invitations/lookup", "/api/invitations/lookup?token=" + inv.data.token, null, undefined, 200);
  const acc = await contract("accept", "POST", "/api/invitations/accept", "/api/invitations/accept", null, { token: inv.data.token, fullName: "Doc Vendor Staff", password: "Str0ngPassw0rd" }, 201);
  await contract("accept twice", "POST", "/api/invitations/accept", "/api/invitations/accept", null, { token: inv.data.token, fullName: "x", password: "Str0ngPassw0rd" }, 404);
  const inv2 = await call("POST", "/api/invitations", tok.M, { email: "revoke@x.test", role: "TENANT" });
  await contract("revoke", "POST", "/api/invitations/{id}/revoke", `/api/invitations/${inv2.data.id}/revoke`, tok.M, undefined, 204);
  const made = await contract("direct account", "POST", "/api/accounts", "/api/accounts", tok.M, { email: "direct@x.test", password: "Str0ngPassw0rd", fullName: "Direct", role: "TECHNICIAN" }, 201);
  await contract("deactivate", "POST", "/api/accounts/{id}/status", `/api/accounts/${made.data.id}/status`, tok.M, { active: false }, 200);
  await contract("reset link", "POST", "/api/accounts/{id}/reset-link", `/api/accounts/${made.data.id}/reset-link`, tok.M, undefined, 201);
  await contract("profile", "PUT", "/api/auth/profile", "/api/auth/profile", tok.K, { fullName: "Sanjay Nair", phone: "1", skills: "Plumbing" }, 200);
  await contract("organization", "PUT", "/api/organization", "/api/organization", tok.M, { name: "Rosewood Estates (sample)", approvalLimit: 5000 }, 200);
  await contract("vendor company update", "PUT", "/api/vendors/me", "/api/vendors/me", tok.V, { phone: "9", categories: ["PLUMBING"] }, 200);
  const notes = (await call("GET", "/api/notifications", tok.T)).data;
  await contract("mark one read", "POST", "/api/notifications/{id}/read", `/api/notifications/${notes[0].id}/read`, tok.T, undefined, 204);
  await contract("mark all read", "POST", "/api/notifications/read-all", "/api/notifications/read-all", tok.T, undefined, 204);
  const pw = await contract("change password", "POST", "/api/auth/change-password", "/api/auth/change-password", acc.data.token, { currentPassword: "Str0ngPassw0rd", newPassword: "An0therStr0ngOne" }, 200);
  await contract("logout", "POST", "/api/auth/logout", "/api/auth/logout", pw.data.token, undefined, 204);

  server.close();
  require("fs").rmSync(DIR, { recursive: true, force: true });
  T.done();
})().catch((e) => { console.error(e); process.exit(2); });
