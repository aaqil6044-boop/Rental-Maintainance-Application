"use strict";
// Unit tests for src/rules.js (pure functions, no database or server). Run: npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../src/rules");

const request = (o = {}) => ({ org_id: 1, reporter_id: 10, technician_id: 20, vendor_id: null, ...o });
const manager = (o = {}) => ({ id: 1, role: "MANAGER", org_id: 1, ...o });
const tenant = (o = {}) => ({ id: 10, role: "TENANT", org_id: 1, ...o });
const tech = (o = {}) => ({ id: 20, role: "TECHNICIAN", org_id: 1, ...o });
const vendor = (o = {}) => ({ id: 30, role: "VENDOR", org_id: 1, vendor_id: 5, vendor_status: "ACTIVE", ...o });

test("lifecycle: allowed moves", () => {
  assert.deepEqual(R.allowedNext("REPORTED"), ["UNDER_REVIEW", "ASSIGNED", "CLOSED"]);
  assert.ok(R.canMoveTo("ASSIGNED", "IN_PROGRESS"));
  assert.ok(R.canMoveTo("COMPLETED", "REOPENED"));
  assert.ok(R.canMoveTo("CLOSED", "REOPENED"));
});

test("lifecycle: forbidden moves and unknown states", () => {
  assert.ok(!R.canMoveTo("REPORTED", "COMPLETED"), "cannot skip work");
  assert.ok(!R.canMoveTo("IN_PROGRESS", "REPORTED"), "cannot go backwards");
  assert.ok(!R.canMoveTo("CLOSED", "COMPLETED"));
  assert.deepEqual(R.allowedNext("NOPE"), []);
  assert.ok(!R.canMoveTo("NOPE", "CLOSED"));
});

test("lifecycle: every target state is itself a known state or terminal", () => {
  const states = new Set([...Object.keys(R.TRANSITIONS), "COMPLETED"]);
  for (const targets of Object.values(R.TRANSITIONS)) for (const t of targets) assert.ok(states.has(t), t);
});

test("isOpen is false only for CLOSED", () => {
  assert.equal(R.isOpen("CLOSED"), false);
  assert.equal(R.isOpen("REPORTED"), true);
  assert.equal(R.isOpen("COMPLETED"), true);
});

test("isAssignee: technician must be the assigned one", () => {
  assert.equal(R.isAssignee(tech(), request()), true);
  assert.equal(R.isAssignee(tech({ id: 21 }), request()), false);
  assert.equal(R.isAssignee(tech(), request({ technician_id: null })), false);
});

test("isAssignee: vendor must match the vendor company and be ACTIVE", () => {
  assert.equal(R.isAssignee(vendor(), request({ vendor_id: 5 })), true);
  assert.equal(R.isAssignee(vendor(), request({ vendor_id: 6 })), false);
  assert.equal(R.isAssignee(vendor({ vendor_status: "SUSPENDED" }), request({ vendor_id: 5 })), false);
  assert.equal(R.isAssignee(vendor({ vendor_status: "PENDING" }), request({ vendor_id: 5 })), false);
  assert.equal(R.isAssignee(vendor(), request({ vendor_id: null })), false);
});

test("isAssignee: tenants and managers are never assignees", () => {
  assert.equal(R.isAssignee(tenant(), request()), false);
  assert.equal(R.isAssignee(manager(), request()), false);
});

test("sameOrg requires a non-null org on the actor", () => {
  assert.equal(R.sameOrg(manager(), request()), true);
  assert.equal(R.sameOrg(manager({ org_id: 2 }), request()), false);
  assert.equal(R.sameOrg(manager({ org_id: null }), request({ org_id: null })), false);
});

test("mayTransition: only managers review, assign or close", () => {
  for (const to of ["UNDER_REVIEW", "ASSIGNED", "CLOSED"]) {
    assert.equal(R.mayTransition(manager(), request(), to), true, to);
    assert.equal(R.mayTransition(tenant(), request(), to), false, to);
    assert.equal(R.mayTransition(tech(), request(), to), false, to);
    assert.equal(R.mayTransition(vendor(), request({ vendor_id: 5 }), to), false, to);
  }
});

test("mayTransition: assigned technician or active vendor can do the work", () => {
  for (const to of ["IN_PROGRESS", "COMPLETED"]) {
    assert.equal(R.mayTransition(tech(), request(), to), true, to);
    assert.equal(R.mayTransition(tech({ id: 99 }), request(), to), false, to);
    assert.equal(R.mayTransition(vendor(), request({ vendor_id: 5 }), to), true, to);
    assert.equal(R.mayTransition(vendor({ vendor_status: "SUSPENDED" }), request({ vendor_id: 5 }), to), false, to);
    assert.equal(R.mayTransition(tenant(), request(), to), false, to);
  }
});

test("mayTransition: reopening is for the manager or the reporting tenant", () => {
  assert.equal(R.mayTransition(tenant(), request(), "REOPENED"), true);
  assert.equal(R.mayTransition(tenant({ id: 11 }), request(), "REOPENED"), false, "another tenant");
  assert.equal(R.mayTransition(manager(), request(), "REOPENED"), true);
  assert.equal(R.mayTransition(tech(), request(), "REOPENED"), false);
});

test("mayTransition: a manager of another organization is refused everything", () => {
  const other = manager({ org_id: 2 });
  for (const to of ["UNDER_REVIEW", "ASSIGNED", "CLOSED", "IN_PROGRESS", "COMPLETED", "REOPENED"]) {
    assert.equal(R.mayTransition(other, request(), to), false, to);
  }
});

test("mayTransition: unknown target is refused", () => {
  assert.equal(R.mayTransition(manager(), request(), "REPORTED"), false);
  assert.equal(R.mayTransition(manager(), request(), "BOGUS"), false);
});

test("mayView per role", () => {
  assert.equal(R.mayView(manager(), request()), true);
  assert.equal(R.mayView(manager({ org_id: 2 }), request()), false);
  assert.equal(R.mayView(tenant(), request()), true);
  assert.equal(R.mayView(tenant({ id: 11 }), request()), false);
  assert.equal(R.mayView(tech(), request()), true);
  assert.equal(R.mayView(tech({ id: 21 }), request()), false);
  assert.equal(R.mayView(tech({ org_id: 2 }), request()), false, "technician from another org");
  assert.equal(R.mayView(vendor(), request({ vendor_id: 5 })), true);
  assert.equal(R.mayView(vendor({ vendor_status: "INACTIVE" }), request({ vendor_id: 5 })), false);
  assert.equal(R.mayView({ id: 1, role: "ADMIN", org_id: 1 }, request()), false, "unknown role");
});

test("constants are consistent", () => {
  assert.deepEqual(R.ROLES, ["TENANT", "MANAGER", "TECHNICIAN", "VENDOR"]);
  for (const s of R.ASSIGNABLE) assert.ok(R.TRANSITIONS[s], s + " is a real state");
  for (const r of R.INVITABLE) assert.ok(R.ROLES.includes(r));
});
