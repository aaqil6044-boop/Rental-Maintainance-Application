"use strict";

/** The maintenance lifecycle. Anything not listed here is rejected by the server. */
const TRANSITIONS = {
  REPORTED:     ["UNDER_REVIEW", "ASSIGNED", "CLOSED"],
  UNDER_REVIEW: ["ASSIGNED", "CLOSED"],
  ASSIGNED:     ["IN_PROGRESS", "UNDER_REVIEW"],
  IN_PROGRESS:  ["COMPLETED"],
  COMPLETED:    ["CLOSED", "REOPENED"],
  CLOSED:       ["REOPENED"],
  REOPENED:     ["ASSIGNED", "UNDER_REVIEW"],
};
const ASSIGNABLE = ["REPORTED", "UNDER_REVIEW", "ASSIGNED", "REOPENED"];

const ROLES = ["TENANT", "MANAGER", "TECHNICIAN", "VENDOR"];
const INVITABLE = ["TENANT", "TECHNICIAN", "VENDOR", "MANAGER"];
const CATEGORIES = ["PLUMBING", "ELECTRICAL", "HVAC", "STRUCTURAL", "APPLIANCE", "OTHER"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const VENDOR_STATUSES = ["PENDING", "ACTIVE", "SUSPENDED", "INACTIVE"];

const allowedNext = (status) => TRANSITIONS[status] || [];
const canMoveTo = (from, to) => allowedNext(from).includes(to);
const isOpen = (status) => status !== "CLOSED";

/** Is this account the person (or company) doing the work on this request? */
function isAssignee(actor, request) {
  if (actor.role === "TECHNICIAN") {
    return request.technician_id != null && request.technician_id === actor.id;
  }
  if (actor.role === "VENDOR") {
    return request.vendor_id != null && request.vendor_id === actor.vendor_id
        && actor.vendor_status === "ACTIVE";
  }
  return false;
}

const sameOrg = (actor, request) => actor.org_id != null && request.org_id === actor.org_id;

/** Which role may perform a given transition on a given request. */
function mayTransition(actor, request, to) {
  if (actor.role === "MANAGER" && !sameOrg(actor, request)) return false;
  switch (to) {
    case "UNDER_REVIEW":
    case "ASSIGNED":
    case "CLOSED":
      return actor.role === "MANAGER";
    case "IN_PROGRESS":
    case "COMPLETED":
      return actor.role === "MANAGER" || isAssignee(actor, request);
    case "REOPENED":
      return actor.role === "MANAGER" || request.reporter_id === actor.id;
    default:
      return false;
  }
}

/** Whether this account may read this request at all. */
function mayView(actor, request) {
  switch (actor.role) {
    case "MANAGER":    return sameOrg(actor, request);
    case "TENANT":     return request.reporter_id === actor.id;
    case "TECHNICIAN": return isAssignee(actor, request) && sameOrg(actor, request);
    case "VENDOR":     return isAssignee(actor, request);
    default:           return false;
  }
}

module.exports = { TRANSITIONS, ASSIGNABLE, ROLES, INVITABLE, CATEGORIES, PRIORITIES, VENDOR_STATUSES,
                   allowedNext, canMoveTo, isOpen, isAssignee, sameOrg, mayTransition, mayView };
