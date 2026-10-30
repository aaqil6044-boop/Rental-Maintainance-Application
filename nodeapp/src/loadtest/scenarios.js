"use strict";
// Scenarios are valid user journeys built ONLY from real EstateOps endpoints (see /openapi.json).
// A virtual user belongs to one persona (tenant, manager, technician, vendor or admin) and only performs that persona's journeys,
// so authentication and role permissions are always respected. Randomness only varies WHICH valid journey runs,
// the pacing, the data chosen and the order of independent reads. It never produces an invalid sequence.

const ISSUES = [
  ["Tap dripping in kitchen", "PLUMBING"], ["Bedroom socket not working", "ELECTRICAL"], ["Air conditioner not cooling", "HVAC"],
  ["Crack in living room wall", "STRUCTURAL"], ["Washing machine will not drain", "APPLIANCE"], ["Hallway light flickering", "ELECTRICAL"],
  ["Bathroom drain slow", "PLUMBING"], ["Door lock sticking", "OTHER"], ["Heater makes noise", "HVAC"], ["Fridge not cooling", "APPLIANCE"],
];
const PRIORITIES = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "URGENT"];
const STATUSES = ["REPORTED", "UNDER_REVIEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CLOSED"];
const CATEGORIES = ["PLUMBING", "ELECTRICAL", "HVAC", "STRUCTURAL", "APPLIANCE", "OTHER"];
const WORDS = ["leak", "light", "door", "water", "noise", "crack", "heater", "drain"];

const enc = encodeURIComponent;
const TPL_REQ = "/api/maintenance-requests/{id}";

const SCENARIOS = [
  /* ---------------- tenant ---------------- */
  { key: "tenant.dashboard", persona: "tenant", weight: 30, writes: false, label: "Tenant: open dashboard",
    description: "Dashboard and notifications, in either order.",
    endpoints: ["GET /api/dashboard", "GET /api/notifications"],
    async run(c) { await c.anyOrder([() => c.get("/api/dashboard"), () => c.get("/api/notifications")]); } },
  { key: "tenant.browse", persona: "tenant", weight: 35, writes: false, label: "Tenant: browse and open a request",
    description: "Lists own requests (sometimes filtered), then opens one.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}"],
    async run(c) {
      const q = c.rng.chance(c.r * 0.5) ? `?status=${c.rng.pick(STATUSES)}&limit=20` : "?limit=20";
      const list = await c.get("/api/maintenance-requests" + q);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think();
      await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
    } },
  { key: "tenant.report", persona: "tenant", weight: 20, writes: true, label: "Tenant: report an issue",
    description: "Finds the tenant's unit, reports a test issue, may open it and add a comment.",
    endpoints: ["GET /api/units/reportable", "POST /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/maintenance-requests/{id}/comments"],
    async run(c) {
      const units = await c.get("/api/units/reportable");
      const unit = c.choose(Array.isArray(units.json) ? units.json : []);
      if (!unit || !c.takeCreate()) return;
      await c.think("form");
      const [title, category] = c.rng.pick(ISSUES);
      const made = await c.post("/api/maintenance-requests", { unitId: unit.id, title: `${c.tag} ${title} #${c.uniq()}`, description: "Created by an automated load test. Safe to delete.", category, priority: c.rng.pick(PRIORITIES) }, { expect: [201] });
      const id = made.json && made.json.id; if (!id) return;
      c.created(id);
      if (c.optional(1)) { await c.think(); await c.get(`/api/maintenance-requests/${id}`, { tpl: TPL_REQ }); }
      if (c.optional(0.6)) { await c.think("form"); await c.post(`/api/maintenance-requests/${id}/comments`, { body: "Load test comment" }, { tpl: "/api/maintenance-requests/{id}/comments", expect: [201] }); }
    } },

  /* ---------------- manager ---------------- */
  { key: "manager.overview", persona: "manager", weight: 30, writes: false, label: "Manager: overview and request queue",
    description: "Dashboard and the request queue, newest first or filtered.",
    endpoints: ["GET /api/dashboard", "GET /api/maintenance-requests"],
    async run(c) {
      await c.anyOrder([() => c.get("/api/dashboard"), () => c.get(`/api/maintenance-requests?limit=25${c.rng.chance(c.r) ? "&priority=" + c.rng.pick(PRIORITIES) : ""}`)]);
    } },
  { key: "manager.search", persona: "manager", weight: 20, writes: false, label: "Manager: search and page through requests",
    description: "Keyword and category searches with paging, then opens one result.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}"],
    async run(c) {
      const params = [`limit=${c.rng.pick([10, 20, 50])}`, `offset=${c.rng.pick([0, 0, 10, 20])}`];
      if (c.rng.chance(0.6)) params.push("q=" + enc(c.rng.pick(WORDS)));
      if (c.rng.chance(0.4)) params.push("category=" + c.rng.pick(CATEGORIES));
      const list = await c.get("/api/maintenance-requests?" + params.join("&"));
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (row && c.optional(1.2)) { await c.think(); await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ }); }
    } },
  { key: "manager.reports", persona: "manager", weight: 25, writes: false, label: "Manager: reporting pages",
    description: "Insights, properties, team and audit log, in any order.",
    endpoints: ["GET /api/insights", "GET /api/properties", "GET /api/team", "GET /api/audit"],
    async run(c) { await c.anyOrder([() => c.get("/api/insights"), () => c.get("/api/properties"), () => c.get("/api/team"), () => c.get("/api/audit?limit=50")]); } },
  { key: "manager.triage", persona: "manager", weight: 25, writes: true, label: "Manager: triage load-test requests",
    description: "Finds this run's new requests, opens one, may start review and assign a test technician. Touches only requests created by this run.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/maintenance-requests/{id}/status", "POST /api/maintenance-requests/{id}/assign"],
    async run(c) {
      const list = await c.get(`/api/maintenance-requests?status=REPORTED&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think(); await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
      if (c.optional(1)) { await c.think("review"); await c.post(`/api/maintenance-requests/${row.id}/status`, { target: "UNDER_REVIEW" }, { tpl: "/api/maintenance-requests/{id}/status", expect: [200, 400] }); }
      const tech = c.rng.pick(c.technicianIds);
      if (tech && c.optional(0.8)) { await c.think(); await c.post(`/api/maintenance-requests/${row.id}/assign`, { technicianId: tech }, { tpl: "/api/maintenance-requests/{id}/assign", expect: [200, 400] }); }
    } },

  /* ---------------- technician ---------------- */
  { key: "technician.jobs", persona: "technician", weight: 60, writes: false, label: "Technician: my jobs",
    description: "Lists assigned jobs and opens one.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "GET /api/notifications"],
    async run(c) {
      const list = await c.get("/api/maintenance-requests?limit=25");
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (row) { await c.think(); await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ }); }
      if (c.optional(0.7)) { await c.think(); await c.get("/api/notifications"); }
    } },
  { key: "technician.work", persona: "technician", weight: 40, writes: true, label: "Technician: work an assigned test job",
    description: "Starts work on a test job assigned in this run, may record a small expense and complete it.",
    endpoints: ["GET /api/maintenance-requests", "POST /api/maintenance-requests/{id}/status", "POST /api/maintenance-requests/{id}/expenses"],
    async run(c) {
      const list = await c.get(`/api/maintenance-requests?status=ASSIGNED&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think();
      const started = await c.post(`/api/maintenance-requests/${row.id}/status`, { target: "IN_PROGRESS" }, { tpl: "/api/maintenance-requests/{id}/status", expect: [200, 400, 403] });
      if (started.status !== 200) return;
      if (c.optional(0.7) && c.takeCreate()) { await c.think("form"); await c.post(`/api/maintenance-requests/${row.id}/expenses`, { amount: c.rng.int(10, 500), description: "Load test part" }, { tpl: "/api/maintenance-requests/{id}/expenses", expect: [201] }); }
      if (c.optional(0.9)) { await c.think(); await c.post(`/api/maintenance-requests/${row.id}/status`, { target: "COMPLETED", completionNotes: "Load test completion." }, { tpl: "/api/maintenance-requests/{id}/status", expect: [200, 400] }); }
    } },

  /* ---------------- manager: vendor coordination (the hand-offs that vendor.* pick up) ---------------- */
  { key: "manager.vendorAssign", persona: "manager", weight: 14, writes: true, label: "Manager: send a test job to the vendor",
    description: "Finds a new load-test request, starts review and assigns it to the organization's test vendor, which then sees it as a work order.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/maintenance-requests/{id}/status", "POST /api/maintenance-requests/{id}/assign"],
    async run(c) {
      if (!c.vendorId) return;
      const list = await c.get(`/api/maintenance-requests?status=REPORTED&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think(); await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
      await c.think("review"); await c.post(`/api/maintenance-requests/${row.id}/status`, { target: "UNDER_REVIEW" }, { tpl: "/api/maintenance-requests/{id}/status", expect: [200, 400] });
      await c.think("form"); await c.post(`/api/maintenance-requests/${row.id}/assign`, { vendorId: c.vendorId }, { tpl: "/api/maintenance-requests/{id}/assign", expect: [200, 400] });
    } },
  { key: "manager.quotations", persona: "manager", weight: 12, writes: true, label: "Manager: review and decide vendor quotations",
    description: "Opens a vendor job that has a pending quotation and approves or rejects it.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/quotations/{id}/decision"],
    async run(c) {
      const list = await c.get(`/api/maintenance-requests?status=ASSIGNED&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think(); const d = await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
      const pending = d.json && Array.isArray(d.json.quotations) ? d.json.quotations.filter((q) => q.status === "PENDING") : [];
      if (!pending.length) return;
      await c.think("review");
      await c.post(`/api/quotations/${c.choose(pending).id}/decision`, { decision: c.rng.chance(0.8) ? "APPROVE" : "REJECT" }, { tpl: "/api/quotations/{id}/decision", expect: [200, 400] });
    } },
  { key: "manager.invoices", persona: "manager", weight: 8, writes: true, label: "Manager: approve vendor invoices",
    description: "Opens a job in progress with an unapproved vendor invoice and approves it.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/expenses/{id}/approve"],
    async run(c) {
      const list = await c.get(`/api/maintenance-requests?status=IN_PROGRESS&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think(); const d = await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
      const open = d.json && Array.isArray(d.json.expenses) ? d.json.expenses.filter((x) => !x.approved) : [];
      if (!open.length) return;
      await c.think("review");
      await c.post(`/api/expenses/${c.choose(open).id}/approve`, {}, { tpl: "/api/expenses/{id}/approve", expect: [200, 400, 403] });
    } },

  /* ---------------- vendor ---------------- */
  { key: "vendor.jobs", persona: "vendor", weight: 55, writes: false, label: "Vendor: check work orders",
    description: "Opens the vendor profile, lists assigned work orders, opens one and checks notifications.",
    endpoints: ["GET /api/vendors/me", "GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "GET /api/notifications"],
    async run(c) {
      await c.get("/api/vendors/me");
      await c.think();
      const list = await c.get("/api/maintenance-requests?limit=25");
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (row) { await c.think(); await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ }); }
      if (c.optional(0.7)) { await c.think(); await c.get("/api/notifications"); }
    } },
  { key: "vendor.quote", persona: "vendor", weight: 25, writes: true, label: "Vendor: quote a work order",
    description: "Opens a work order assigned in this run and submits a quotation for the manager to decide.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/maintenance-requests/{id}/quotations"],
    async run(c) {
      const list = await c.get(`/api/maintenance-requests?status=ASSIGNED&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row || !c.takeCreate()) return;
      await c.think(); await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
      await c.think("form");
      await c.post(`/api/maintenance-requests/${row.id}/quotations`, { amount: c.rng.int(80, 2400), description: "Load test quotation. Safe to delete." }, { tpl: "/api/maintenance-requests/{id}/quotations", expect: [201] });
    } },
  { key: "vendor.work", persona: "vendor", weight: 20, writes: true, label: "Vendor: carry out a work order and invoice it",
    description: "Starts a work order, records an invoice and marks it completed. Prefers jobs whose quotation was approved.",
    endpoints: ["GET /api/maintenance-requests", "GET /api/maintenance-requests/{id}", "POST /api/maintenance-requests/{id}/status", "POST /api/maintenance-requests/{id}/expenses"],
    async run(c) {
      const list = await c.get(`/api/maintenance-requests?status=ASSIGNED&limit=20&q=${enc(c.tag)}`);
      const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (!row) return;
      await c.think(); const d = await c.get(`/api/maintenance-requests/${row.id}`, { tpl: TPL_REQ });
      const approved = d.json && Array.isArray(d.json.quotations) && d.json.quotations.some((q) => q.status === "APPROVED");
      if (!approved && !c.optional(0.5)) return;
      await c.think("form");
      const started = await c.post(`/api/maintenance-requests/${row.id}/status`, { target: "IN_PROGRESS" }, { tpl: "/api/maintenance-requests/{id}/status", expect: [200, 400, 403] });
      if (started.status !== 200) return;
      if (c.takeCreate()) { await c.think("form"); await c.post(`/api/maintenance-requests/${row.id}/expenses`, { amount: c.rng.int(20, 300), description: "Load test invoice" }, { tpl: "/api/maintenance-requests/{id}/expenses", expect: [201] }); }
      if (c.optional(0.8)) { await c.think(); await c.post(`/api/maintenance-requests/${row.id}/status`, { target: "COMPLETED", completionNotes: "Load test completion." }, { tpl: "/api/maintenance-requests/{id}/status", expect: [200, 400] }); }
    } },

  /* ---------------- admin (organization admin, read-only) ---------------- */
  { key: "admin.console", persona: "admin", weight: 45, writes: false, label: "Admin: organization console",
    description: "Organization settings, team, vendors, pending invitations and properties, in any order.",
    endpoints: ["GET /api/organization", "GET /api/team", "GET /api/vendors", "GET /api/invitations", "GET /api/properties"],
    async run(c) { await c.anyOrder([() => c.get("/api/organization"), () => c.get("/api/team"), () => c.get("/api/vendors"), () => c.get("/api/invitations"), () => c.get("/api/properties")]); } },
  { key: "admin.overview", persona: "admin", weight: 35, writes: false, label: "Admin: dashboard, insights and queue",
    description: "Dashboard, insights and the newest requests.",
    endpoints: ["GET /api/dashboard", "GET /api/insights", "GET /api/maintenance-requests"],
    async run(c) { await c.anyOrder([() => c.get("/api/dashboard"), () => c.get("/api/insights"), () => c.get("/api/maintenance-requests?limit=25")]); } },
  { key: "admin.audit", persona: "admin", weight: 20, writes: false, label: "Admin: audit log review",
    description: "Reads the audit log, then the team list.",
    endpoints: ["GET /api/audit", "GET /api/team"],
    async run(c) { await c.get(`/api/audit?limit=${c.rng.pick([50, 100, 200])}`); if (c.optional(1)) { await c.think("review"); await c.get("/api/team"); } } },
];

const KEYS = SCENARIOS.map((s) => s.key);
const PERSONAS = ["tenant", "manager", "technician", "vendor", "admin"];
const crypto = require("crypto");
/** Changes whenever a scenario's identity, persona, default weight or endpoints change, so reports made with different journeys are never silently compared. */
const SCENARIO_VERSION = "3." + crypto.createHash("sha1").update(JSON.stringify(SCENARIOS.map((s) => [s.key, s.persona, s.weight, s.writes, s.endpoints]))).digest("hex").slice(0, 8);
const catalog = () => SCENARIOS.map(({ key, persona, weight, writes, label, description, endpoints }) => ({ key, persona, defaultWeight: weight, writes, label, description, endpoints }));
module.exports = { SCENARIOS, KEYS, PERSONAS, SCENARIO_VERSION, catalog, ISSUES };
