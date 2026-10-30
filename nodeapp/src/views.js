"use strict";
const { allowedNext, isOpen, mayTransition } = require("./rules");

const config = require("./config");

// Dates are shown in the configured time zone (TIMEZONE), not whatever zone the server or container happens to use.
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PARTS = new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: config.timezone, year: "numeric", month: "2-digit", day: "2-digit" });
function stamp(iso) {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const p = Object.fromEntries(PARTS.formatToParts(when).map((x) => [x.type, x.value]));
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute}`;
}
/** Today's date (YYYY-MM-DD) where the organization is: a due date is overdue only after that day has ended there. */
const today = () => DAY.format(new Date());
const money = (cents) => Math.round(cents) / 100;
const isOverdue = (row) => !!row.due_date && isOpen(row.status) && row.due_date < today();

/** A joined request row -> what the screen renders. allowedNext is already filtered for this caller. */
function requestView(r, actor) {
  return {
    id: r.id, title: r.title, description: r.description,
    category: r.category, priority: r.priority, status: r.status,
    unitLabel: r.unit_label, propertyName: r.property_name, unitId: r.unit_id,
    reporterName: r.reporter_name, reporterId: r.reporter_id,
    technicianName: r.technician_name || null, technicianId: r.technician_id || null,
    vendorName: r.vendor_name || null, vendorId: r.vendor_id || null,
    completionNotes: r.completion_notes || null,
    dueDate: r.due_date || null, overdue: isOverdue(r),
    createdAt: stamp(r.created_at), updatedAt: stamp(r.updated_at),
    allowedNext: actor ? allowedNext(r.status).filter((t) => mayTransition(actor, r, t)) : [],
  };
}

const commentView = (c) => ({ id: c.id, authorName: c.author_name, authorRole: c.author_role, body: c.body, createdAt: stamp(c.created_at) });
const eventView = (e) => ({ id: e.id, actorName: e.actor_name, fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: stamp(e.created_at) });
const expenseView = (x) => ({
  id: x.id, kind: x.kind, amount: money(x.amount_cents), description: x.description,
  recordedByName: x.recorded_by_name, approved: !!x.approved,
  approvedByName: x.approved_by_name || null, createdAt: stamp(x.created_at),
});
const propertyView = (p) => ({ id: p.id, name: p.name, address: p.address, propertyType: p.property_type, unitCount: p.unit_count, managerName: p.manager_name });
const unitView = (u, withTenants) => {
  const v = { id: u.id, propertyId: u.property_id, propertyName: u.property_name, label: u.label };
  if (withTenants) v.tenantNames = u.tenant_names || null;
  return v;
};
const notificationView = (n) => ({ id: n.id, message: n.message, requestId: n.request_id, read: !!n.read_flag, createdAt: stamp(n.created_at) });
const accountView = (a) => ({ id: a.id, email: a.email, fullName: a.full_name, role: a.role });
const meView = (a) => ({
  id: a.id, email: a.email, fullName: a.full_name, role: a.role,
  organizationName: a.org_name || null, orgAdmin: !!a.org_admin, emailVerified: !!a.email_verified, mfaEnabled: !!a.mfa_enabled,
  mfaRequired: !!(config.mfa.requireForManagers && a.role === "MANAGER" && !a.mfa_enabled),
  phone: a.phone || null, skills: a.skills || null, profileComplete: !!a.profile_complete,
  vendorId: a.vendor_id || null, vendorName: a.vendor_name || null, vendorStatus: a.vendor_status || null,
});
const teamView = (a) => ({
  id: a.id, email: a.email, fullName: a.full_name, role: a.role, active: !!a.active,
  phone: a.phone || null, skills: a.skills || null, vendorName: a.vendor_name || null,
  orgAdmin: !!a.org_admin, createdAt: stamp(a.created_at),
});
const vendorView = (v) => ({
  id: v.id, name: v.name, contactEmail: v.contact_email, phone: v.phone || null,
  categories: v.categories ? v.categories.split(",").filter(Boolean) : [], status: v.status,
  memberCount: v.member_count, openJobs: v.open_jobs,
});
const invitationView = (i) => ({
  id: i.id, email: i.email, role: i.role, kind: i.kind,
  vendorName: i.vendor_name || null,
  unit: i.unit_label ? `${i.property_name} ${i.unit_label}` : null,
  expiresAt: stamp(i.expires_at), createdAt: stamp(i.created_at),
});
const attachmentView = (a) => ({
  id: a.id, name: a.original_name, mime: a.mime, sizeBytes: a.size_bytes, kind: a.kind,
  uploaderName: a.uploader_name, createdAt: stamp(a.created_at),
});
const quotationView = (q) => ({
  id: q.id, vendorName: q.vendor_name, amount: money(q.amount_cents), description: q.description,
  status: q.status, submittedByName: q.submitted_by_name, decidedByName: q.decided_by_name || null,
  createdAt: stamp(q.created_at),
});
const suggestionView = (s) => !s ? null : ({
  id: s.id, category: s.category, priority: s.priority, explanation: s.explanation,
  model: s.model, decision: s.decision || null, createdAt: stamp(s.created_at),
});
const auditView = (l) => ({ id: l.id, actorName: l.actor_name || "system", action: l.action, entity: l.entity, entityId: l.entity_id, detail: l.detail, createdAt: stamp(l.created_at) });

module.exports = { stamp, today, money, isOverdue, requestView, commentView, eventView, expenseView,
  propertyView, unitView, notificationView, accountView, meView, teamView, vendorView, invitationView,
  attachmentView, quotationView, suggestionView, auditView };
