"use strict";
const app = require("./server");
const seed = require("./src/seed");

let pass = 0, fail = 0;
const ok  = (what, cond) => { if (cond) { pass++; console.log("  PASS  " + what); }
                              else { fail++; console.log("  FAIL  " + what); } };

let BASE;
async function call(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" },
                           token ? { Authorization: "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  return { status: res.status, data };
}
const refused = async (what, expect, method, path, token, body) => {
  const r = await call(method, path, token, body);
  ok(`${what} -> ${r.status}`, r.status === expect);
  return r;
};

(async () => {
  seed();
  const server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  BASE = "http://127.0.0.1:" + server.address().port;

  console.log("\n== 1. Authentication ==");
  let r = await call("POST", "/api/auth/login", null, { email: "manager@estateops.test", password: "password123" });
  ok("manager signs in", r.status === 200 && !!r.data.token);
  const MGR = r.data.token;
  ok("login returns the role", r.data.role === "MANAGER");

  r = await call("POST", "/api/auth/login", null, { email: "tech@estateops.test", password: "password123" });
  const TECH = r.data.token;
  r = await call("POST", "/api/auth/login", null, { email: "tenant@estateops.test", password: "password123" });
  const TEN = r.data.token;
  ok("three roles signed in", !!MGR && !!TECH && !!TEN);

  await refused("wrong password", 401, "POST", "/api/auth/login", null,
                { email: "manager@estateops.test", password: "nope" });
  await refused("unknown email", 401, "POST", "/api/auth/login", null,
                { email: "ghost@x.test", password: "password123" });
  await refused("no token on a protected route", 401, "GET", "/api/dashboard", null);
  await refused("tampered token", 401, "GET", "/api/dashboard", MGR.slice(0, -3) + "aaa");

  r = await call("POST", "/api/auth/register", null,
                 { email: "new.tenant@x.test", password: "password123", fullName: "New Tenant", role: "MANAGER" });
  ok("self-registration succeeds", r.status === 201);
  ok("self-registration CANNOT grant MANAGER (privilege escalation blocked)", r.data.role === "TENANT");
  const NEWTEN = r.data.token;
  await refused("duplicate email", 409, "POST", "/api/auth/register", null,
                { email: "new.tenant@x.test", password: "password123", fullName: "Dup" });
  await refused("short password", 400, "POST", "/api/auth/register", null,
                { email: "x2@x.test", password: "123", fullName: "X" });

  console.log("\n== 2. Identity ==");
  r = await call("GET", "/api/auth/me", TEN);
  ok("me returns the signed-in tenant", r.data.email === "tenant@estateops.test" && r.data.role === "TENANT");

  console.log("\n== 3. Properties and units ==");
  r = await call("GET", "/api/properties", MGR);
  ok("seeded properties are listed", r.status === 200 && r.data.length === 2);
  ok("unit counts are computed", r.data.find(p => p.name === "Rosewood Residency").unitCount === 2);

  r = await call("POST", "/api/properties", MGR, { name: "Garden Court", propertyType: "villa" });
  ok("manager creates a property", r.status === 201 && r.data.name === "Garden Court");
  const newPropId = r.data.id;
  await refused("tenant cannot create a property", 403, "POST", "/api/properties", TEN, { name: "Sneaky" });

  r = await call("POST", "/api/units", MGR, { propertyId: newPropId, label: "A1" });
  ok("manager adds a unit", r.status === 201 && r.data.label === "A1");
  await refused("duplicate unit label", 409, "POST", "/api/units", MGR, { propertyId: newPropId, label: "a1" });
  await refused("blank unit label", 400, "POST", "/api/units", MGR, { propertyId: newPropId, label: "  " });

  r = await call("GET", "/api/units/reportable", TEN);
  ok("tenant sees only their own units", r.data.length === 2);
  r = await call("GET", "/api/units/reportable", NEWTEN);
  ok("a tenant with no unit sees none", r.data.length === 0);

  console.log("\n== 4. Reporting an issue ==");
  r = await call("GET", "/api/units/reportable", TEN);
  const myUnit = r.data[0].id, otherUnit = (await call("GET", "/api/units/reportable", MGR)).data
                                 .find(u => u.label === "A1").id;

  r = await call("POST", "/api/maintenance-requests", TEN,
       { unitId: myUnit, title: "Bathroom drain blocked", description: "Water backs up.",
         category: "PLUMBING", priority: "HIGH", photoName: "drain.jpg" });
  ok("tenant reports an issue", r.status === 201 && r.data.status === "REPORTED");
  ok("photo name recorded", r.data.photoName === "drain.jpg");
  const REQ = r.data.id;

  await refused("tenant cannot report on a unit that is not theirs", 403,
                "POST", "/api/maintenance-requests", TEN,
                { unitId: otherUnit, title: "Nope", description: "x" });
  await refused("technician cannot raise a request", 403,
                "POST", "/api/maintenance-requests", TECH,
                { unitId: myUnit, title: "Nope", description: "x" });
  await refused("missing title is rejected", 400, "POST", "/api/maintenance-requests", TEN,
                { unitId: myUnit, description: "x" });
  await refused("bad category is rejected", 400, "POST", "/api/maintenance-requests", TEN,
                { unitId: myUnit, title: "T", description: "x", category: "NONSENSE" });

  console.log("\n== 5. Visibility ==");
  ok("manager sees all requests", (await call("GET", "/api/maintenance-requests", MGR)).data.length === 3);
  ok("tenant sees only their own", (await call("GET", "/api/maintenance-requests", TEN)).data.length === 3);
  ok("new tenant sees none", (await call("GET", "/api/maintenance-requests", NEWTEN)).data.length === 0);
  ok("unassigned technician sees none", (await call("GET", "/api/maintenance-requests", TECH)).data.length === 0);
  await refused("other tenant cannot read the request", 403, "GET", "/api/maintenance-requests/" + REQ, NEWTEN);
  await refused("technician cannot read an unassigned request", 403, "GET", "/api/maintenance-requests/" + REQ, TECH);

  console.log("\n== 6. Lifecycle ==");
  await refused("illegal jump REPORTED -> COMPLETED", 400,
                "POST", `/api/maintenance-requests/${REQ}/status`, MGR,
                { target: "COMPLETED", completionNotes: "x" });
  await refused("tenant cannot triage", 403,
                "POST", `/api/maintenance-requests/${REQ}/status`, TEN, { target: "UNDER_REVIEW" });

  r = await call("POST", `/api/maintenance-requests/${REQ}/status`, MGR, { target: "UNDER_REVIEW", note: "Triaged" });
  ok("manager triages", r.status === 200 && r.data.status === "UNDER_REVIEW");
  await refused("cannot reach ASSIGNED with no technician", 400,
                "POST", `/api/maintenance-requests/${REQ}/status`, MGR, { target: "ASSIGNED" });

  console.log("\n== 7. Assignment ==");
  const techId = (await call("GET", "/api/technicians", MGR)).data[0].id;
  await refused("technician cannot list technicians", 403, "GET", "/api/technicians", TECH);
  await refused("cannot assign a non-technician", 400,
                `POST`, `/api/maintenance-requests/${REQ}/assign`, MGR, { technicianId: 3 });
  await refused("technician cannot assign", 403,
                "POST", `/api/maintenance-requests/${REQ}/assign`, TECH, { technicianId: techId });

  r = await call("POST", `/api/maintenance-requests/${REQ}/assign`, MGR,
                 { technicianId: techId, dueDate: "2026-01-01", priority: "URGENT" });
  ok("manager assigns the technician", r.status === 200 && r.data.status === "ASSIGNED");
  ok("technician name recorded", r.data.technicianName === "Sanjay Nair");
  ok("priority override applied", r.data.priority === "URGENT");
  ok("past due date marks it overdue", r.data.overdue === true);
  ok("assigned technician now sees it", (await call("GET", "/api/maintenance-requests", TECH)).data.length === 1);

  console.log("\n== 8. Doing the work ==");
  r = await call("POST", `/api/maintenance-requests/${REQ}/status`, TECH, { target: "IN_PROGRESS" });
  ok("technician starts the job", r.data.status === "IN_PROGRESS");
  await refused("cannot complete without notes", 400,
                "POST", `/api/maintenance-requests/${REQ}/status`, TECH, { target: "COMPLETED" });
  r = await call("POST", `/api/maintenance-requests/${REQ}/status`, TECH,
                 { target: "COMPLETED", completionNotes: "Cleared the trap." });
  ok("completes with notes", r.data.status === "COMPLETED" && r.data.completionNotes === "Cleared the trap.");

  console.log("\n== 9. Expenses ==");
  r = await call("POST", `/api/maintenance-requests/${REQ}/expenses`, TECH,
                 { amount: 1850.5, description: "Drain rods and labour" });
  ok("technician records an expense", r.status === 201 && r.data.amount === 1850.5);
  const EXP = r.data.id;
  ok("expense starts unapproved", r.data.approved === false);
  await refused("tenant cannot record an expense", 403,
                "POST", `/api/maintenance-requests/${REQ}/expenses`, TEN, { amount: 1, description: "x" });
  await refused("zero amount rejected", 400,
                "POST", `/api/maintenance-requests/${REQ}/expenses`, MGR, { amount: 0, description: "x" });
  await refused("negative amount rejected", 400,
                "POST", `/api/maintenance-requests/${REQ}/expenses`, MGR, { amount: -5, description: "x" });
  r = await call("POST", `/api/maintenance-requests/${REQ}/expenses`, MGR,
                 { amount: 100, description: "Manager-recorded part" });
  const OWN = r.data.id;
  await refused("manager cannot approve their own expense", 400, "POST", `/api/expenses/${OWN}/approve`, MGR);
  await refused("technician cannot approve expenses", 403, "POST", `/api/expenses/${EXP}/approve`, TECH);
  r = await call("POST", `/api/expenses/${EXP}/approve`, MGR);
  ok("manager approves another person's expense", r.data.approved === true && r.data.approvedByName === "Maya Iqbal");

  console.log("\n== 10. Detail, history, scoping of cost ==");
  r = await call("GET", "/api/maintenance-requests/" + REQ, MGR);
  ok("history recorded every step", r.data.history.length >= 6);
  ok("manager sees expenses", r.data.expenses.length === 2);
  ok("expense total is exact (no float drift)", r.data.totalExpense === 1950.5);
  r = await call("GET", "/api/maintenance-requests/" + REQ, TEN);
  ok("tenant cannot see expenses", r.data.expenses.length === 0 && r.data.totalExpense === 0);

  console.log("\n== 11. Closing, reopening, comments ==");
  await refused("technician cannot close", 403,
                "POST", `/api/maintenance-requests/${REQ}/status`, TECH, { target: "CLOSED" });
  r = await call("POST", `/api/maintenance-requests/${REQ}/status`, MGR, { target: "CLOSED" });
  ok("manager closes", r.data.status === "CLOSED");
  await refused("cannot comment on a closed request", 400,
                "POST", `/api/maintenance-requests/${REQ}/comments`, TEN, { body: "hi" });
  r = await call("POST", `/api/maintenance-requests/${REQ}/status`, TEN, { target: "REOPENED", note: "Still blocked" });
  ok("reporter reopens it", r.data.status === "REOPENED" && r.data.id === REQ);
  r = await call("POST", `/api/maintenance-requests/${REQ}/comments`, TEN, { body: "Water still backing up." });
  ok("comment posts on a reopened request", r.status === 201);
  await refused("empty comment rejected", 400,
                "POST", `/api/maintenance-requests/${REQ}/comments`, TEN, { body: "   " });

  console.log("\n== 12. Dashboard from real data ==");
  r = await call("GET", "/api/dashboard", MGR);
  ok("manager open count is real", r.data.openRequests === 3);
  ok("manager spend is real", r.data.monthlySpend === 1950.5);
  ok("manager gets recent activity", r.data.recentActivity.length > 0);
  r = await call("GET", "/api/dashboard", TEN);
  ok("tenant spend hidden", r.data.monthlySpend === 0);
  ok("tenant has no activity feed", r.data.recentActivity.length === 0);
  r = await call("GET", "/api/dashboard", NEWTEN);
  ok("unrelated tenant sees zeros", r.data.openRequests === 0);

  console.log("\n== 13. Notifications ==");
  r = await call("GET", "/api/notifications", TEN);
  ok("reporter has notifications", r.data.length > 0);
  const unreadBefore = (await call("GET", "/api/dashboard", TEN)).data.unreadNotifications;
  ok("unread counted", unreadBefore > 0);
  await call("POST", "/api/notifications/read-all", TEN);
  ok("mark all read works", (await call("GET", "/api/dashboard", TEN)).data.unreadNotifications === 0);
  ok("unrelated tenant has none", (await call("GET", "/api/notifications", NEWTEN)).data.length === 0);

  console.log("\n== 14. Persistence across restart ==");
  server.close();
  delete require.cache[require.resolve("./server")];
  const app2 = require("./server");
  const s2 = app2.listen(0);
  await new Promise(r2 => s2.once("listening", r2));
  BASE = "http://127.0.0.1:" + s2.address().port;
  r = await call("POST", "/api/auth/login", null, { email: "tenant@estateops.test", password: "password123" });
  const TEN2 = r.data.token;
  r = await call("GET", "/api/maintenance-requests/" + REQ, TEN2);
  ok("request survived a restart", r.status === 200 && r.data.request.status === "REOPENED");
  ok("comments survived", r.data.comments.length === 1);
  s2.close();

  console.log("\n--------------------------------------------");
  console.log(`PASSED: ${pass}   FAILED: ${fail}`);
  console.log("--------------------------------------------");
  process.exit(fail ? 1 : 0);
})();
