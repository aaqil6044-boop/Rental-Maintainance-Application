"use strict";
// Negative authorization checks. Each one asks the server for something the caller must NOT be allowed to do.
//   refused  (any 4xx)       -> PASS. It is reported as a security check, never as an application error.
//   succeeded (2xx)          -> LEAK. A real authorization defect; fails the test.
//   5xx / timeout / network  -> ERROR. The server could not even answer; counted as an ordinary error.
// Every check is read-only or targets a record that must be refused, so a leak is the only way a probe can change data.
const MANAGER_ONLY = ["/api/audit", "/api/team", "/api/insights", "/api/invitations", "/api/organization", "/api/vendors"];

const CHECKS = [
  { name: "unauthenticated request is refused", personas: null,
    async run(c) { await c.probe("unauthenticated request is refused", "GET", c.rng.pick(["/api/dashboard", "/api/maintenance-requests", "/api/notifications"]), { token: false }); } },
  { name: "manager-only page refused to other roles", personas: ["tenant", "technician", "vendor"],
    async run(c) { await c.probe("manager-only page refused to other roles", "GET", c.rng.pick(MANAGER_ONLY)); } },
  { name: "vendor-only page refused to other roles", personas: ["tenant", "technician", "manager", "admin"],
    async run(c) { await c.probe("vendor-only page refused to other roles", "GET", "/api/vendors/me"); } },
  { name: "tenant cannot change request status", personas: ["tenant"],
    async run(c) {
      const list = await c.get("/api/maintenance-requests?limit=10"); const row = c.choose(Array.isArray(list.json) ? list.json : []);
      if (row) await c.probe("tenant cannot change request status", "POST", `/api/maintenance-requests/${row.id}/status`, { body: { target: "CLOSED" }, tpl: "/api/maintenance-requests/{id}/status" });
    } },
  { name: "only vendors may submit quotations", personas: ["tenant", "technician", "manager", "admin"],
    async run(c) {
      const f = c.anyCreated(); if (!f) return;
      await c.probe("only vendors may submit quotations", "POST", `/api/maintenance-requests/${f.id}/quotations`, { body: { amount: 10, description: "probe" }, tpl: "/api/maintenance-requests/{id}/quotations" });
    } },
  { name: "cannot read another organization's request", personas: ["tenant", "manager", "admin", "technician", "vendor"],
    async run(c) { const f = c.foreignOrgCreated(); if (f) await c.probe("cannot read another organization's request", "GET", `/api/maintenance-requests/${f.id}`, { tpl: "/api/maintenance-requests/{id}" }); } },
  { name: "cannot change another organization's request", personas: ["manager", "admin"],
    async run(c) {
      const f = c.foreignOrgCreated(); if (!f) return;
      await c.probe("cannot change another organization's request", "POST", `/api/maintenance-requests/${f.id}/status`, { body: { target: "UNDER_REVIEW" }, tpl: "/api/maintenance-requests/{id}/status" });
    } },
  { name: "cannot comment on another organization's request", personas: ["tenant", "technician", "vendor"],
    async run(c) { const f = c.foreignOrgCreated(); if (f) await c.probe("cannot comment on another organization's request", "POST", `/api/maintenance-requests/${f.id}/comments`, { body: { body: "probe" }, tpl: "/api/maintenance-requests/{id}/comments" }); } },
  { name: "tenant cannot read another tenant's request", personas: ["tenant"],
    async run(c) { const f = c.otherTenantCreated(); if (f) await c.probe("tenant cannot read another tenant's request", "GET", `/api/maintenance-requests/${f.id}`, { tpl: "/api/maintenance-requests/{id}" }); } },
];

const forPersona = (persona) => CHECKS.filter((k) => !k.personas || k.personas.includes(persona));
module.exports = { CHECKS, forPersona };
