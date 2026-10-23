"use strict";
/**
 * DEVELOPMENT sample data. Enabled only by SEED_DEV=1 and never when NODE_ENV=production.
 * Safe to run repeatedly: it does nothing if the sample manager already exists.
 */
const S = require("./store");
const A = require("./auth");

const PASSWORD = process.env.SEED_PASSWORD || "password123";
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function backdate(requestId, days) {
  S.db.prepare("UPDATE requests SET created_at = ?, updated_at = ? WHERE id = ?").run(daysAgo(days), daysAgo(days), requestId);
}

function seed() {
  if (S.findAccountByEmail("manager@estateops.test")) return false;
  return S.db.transaction(() => {
    const pw = A.hash(PASSWORD);
    const org = S.createOrganization("Rosewood Estates (sample)");
    const mk = (email, fullName, role, extra = {}) =>
      S.createAccount({ email, passwordHash: pw, fullName, role, orgId: org.id, profileComplete: 1, ...extra });

    const manager = mk("manager@estateops.test", "Maya Iqbal", "MANAGER", { orgAdmin: 1 });
    const tech1 = mk("tech@estateops.test", "Sanjay Nair", "TECHNICIAN", { skills: "Plumbing, HVAC", phone: "98450 11122" });
    const tech2 = mk("tech2@estateops.test", "Priya Menon", "TECHNICIAN", { skills: "Electrical, Appliances" });
    const tenant = mk("tenant@estateops.test", "Riya Thomas", "TENANT");
    const tenant2 = mk("tenant2@estateops.test", "Arun Das", "TENANT");

    const nair = S.createVendor({ orgId: org.id, name: "Nair Plumbing Works", contactEmail: "office@nairplumbing.test",
      phone: "98450 33344", categories: "PLUMBING,HVAC", status: "ACTIVE" });
    S.createVendor({ orgId: org.id, name: "Spark Electricals", contactEmail: "hello@spark.test",
      categories: "ELECTRICAL", status: "PENDING" });
    const vendorUser = mk("vendor@estateops.test", "Kiran Nair", "VENDOR", { vendorId: nair.id });

    const rose = S.createProperty({ name: "Rosewood Residency", address: "12 Rosewood Avenue", propertyType: "complex", managerId: manager.id, orgId: org.id });
    const lake = S.createProperty({ name: "Lakeview Enclave", address: "4 Lakeview Road", propertyType: "apartment", managerId: manager.id, orgId: org.id });
    const u7b = S.createUnit(rose.id, "7B"), u9c = S.createUnit(rose.id, "9C"), u2a = S.createUnit(lake.id, "2A");
    S.assignTenantToUnit(tenant.id, u7b.id);
    S.assignTenantToUnit(tenant.id, u9c.id);
    S.assignTenantToUnit(tenant2.id, u2a.id);

    const raise = (unit, who, title, description, category, priority, days) => {
      const r = S.createRequest({ unitId: unit.id, reporterId: who.id, title, description, category, priority });
      S.addEvent(r.id, who.id, null, "REPORTED", "Request raised");
      backdate(r.id, days);
      return r;
    };
    const move = (r, actor, to, note) => { S.addEvent(r.id, actor.id, r.status, to, note); return S.updateRequestStatus(r.id, to, to === "COMPLETED" ? note : null); };

    // 1. fresh report, waiting for the manager
    const fresh = raise(u7b, tenant, "Kitchen tap leaking continuously", "Water runs from the base of the mixer tap even when closed.", "PLUMBING", "HIGH", 1);
    S.managersOf(org.id).forEach((m) => S.notify(m.id, `New request: ${fresh.title} (Rosewood Residency 7B)`, fresh.id));

    // 2. assigned to the in-house technician
    let ac = raise(u9c, tenant, "Air conditioning not cooling", "The bedroom unit runs but the air stays warm.", "HVAC", "MEDIUM", 4);
    S.updateAssignment(ac.id, { technicianId: tech1.id, dueDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), status: "ASSIGNED" });
    S.addEvent(ac.id, manager.id, "REPORTED", "ASSIGNED", `Assigned to ${tech1.full_name}`);
    S.notify(tech1.id, `You have been assigned: ${ac.title}`, ac.id);

    // 3. sent to the vendor, quotation waiting for approval
    const seep = raise(u2a, tenant2, "Seepage on bedroom ceiling", "A damp patch is spreading near the window.", "PLUMBING", "URGENT", 3);
    S.updateAssignment(seep.id, { vendorId: nair.id, dueDate: new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10), status: "ASSIGNED" });
    S.addEvent(seep.id, manager.id, "REPORTED", "ASSIGNED", `Assigned to ${nair.name}`);
    S.addQuotation(seep.id, nair.id, vendorUser.id, 4800 * 100, "Locate and seal the leak, repaint the patch.");

    // 4. finished work waiting for the manager to review
    const socket = raise(u7b, tenant, "Socket not working", "The socket beside the desk has no power.", "ELECTRICAL", "LOW", 6);
    S.updateAssignment(socket.id, { technicianId: tech2.id, status: "ASSIGNED" });
    S.addEvent(socket.id, manager.id, "REPORTED", "ASSIGNED", `Assigned to ${tech2.full_name}`);
    move(S.findRequest(socket.id), tech2, "IN_PROGRESS", "Started");
    move(S.findRequest(socket.id), tech2, "COMPLETED", "Replaced the faulty socket.");
    S.addExpense(socket.id, tech2.id, 350 * 100, "Socket and fitting", "EXPENSE");

    // 5. closed with an approved invoice
    const gate = raise(u9c, tenant, "Main door lock jammed", "The key turns but the bolt does not move.", "STRUCTURAL", "HIGH", 12);
    S.updateAssignment(gate.id, { vendorId: nair.id, status: "ASSIGNED" });
    S.addEvent(gate.id, manager.id, "REPORTED", "ASSIGNED", `Assigned to ${nair.name}`);
    move(S.findRequest(gate.id), vendorUser, "IN_PROGRESS", "Started");
    move(S.findRequest(gate.id), vendorUser, "COMPLETED", "Replaced the lock barrel.");
    const inv = S.addExpense(gate.id, vendorUser.id, 1200 * 100, "Lock barrel and labour", "INVOICE");
    S.approveExpense(inv.id, manager.id);
    move(S.findRequest(gate.id), manager, "CLOSED", "Checked and closed");
    return true;
  })();
}

module.exports = seed;
