package com.pmp.app;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Exercises the maintenance workflow against in-memory repositories.
 * These tests cover business logic and authorization; they do not start Spring.
 */
class MaintenanceWorkflowTest {

    Fakes.Accounts accounts;
    Fakes.Properties props;
    Fakes.Units units;
    Fakes.Assignments assigns;
    Fakes.Requests requests;
    Fakes.Comments comments;
    Fakes.Events events;
    Fakes.Expenses expenses;
    Fakes.Notifications notifs;

    NotificationService notifier;
    RequestService svc;
    DashboardService dash;
    PropertyService propSvc;

    Account manager, tech, tech2, tenant, tenant2;
    Unit u7b, u9c;
    Long reqId;

    @BeforeEach
    void setUp() {
        Fakes.SEQ = 0;
        accounts = new Fakes.Accounts();
        props = new Fakes.Properties();
        units = new Fakes.Units();
        assigns = new Fakes.Assignments();
        requests = new Fakes.Requests();
        comments = new Fakes.Comments();
        events = new Fakes.Events();
        expenses = new Fakes.Expenses();
        notifs = new Fakes.Notifications();

        notifier = new NotificationService(notifs, accounts);
        svc = new RequestService(requests, comments, events, expenses, units, accounts, assigns, notifier);
        dash = new DashboardService(requests, expenses, events, notifier);
        propSvc = new PropertyService(props, units, assigns);

        manager = accounts.save(new Account("m@x.test", "h", "Maya Iqbal", Role.MANAGER));
        tech    = accounts.save(new Account("t@x.test", "h", "Sanjay Nair", Role.TECHNICIAN));
        tech2   = accounts.save(new Account("t2@x.test", "h", "Other Tech", Role.TECHNICIAN));
        tenant  = accounts.save(new Account("r@x.test", "h", "Riya Thomas", Role.TENANT));
        tenant2 = accounts.save(new Account("r2@x.test", "h", "Other Tenant", Role.TENANT));

        propSvc.create(manager, new Dto.CreatePropertyRequest("Rosewood Residency", "12 Rosewood Ave", "complex"));
        Property rosewood = props.all.get(0);
        propSvc.createUnit(manager, new Dto.CreateUnitRequest(Fakes.idOf(rosewood), "7B"));
        u7b = units.all.get(0);
        u9c = units.save(new Unit(rosewood, "9C"));
        assigns.save(new UnitAssignment(tenant, u7b));

        reqId = svc.create(tenant, new Dto.CreateRequestRequest(Fakes.idOf(u7b),
                "Kitchen tap leaking", "Water runs constantly.",
                Category.PLUMBING, Priority.HIGH, "leak.jpg")).id();
    }

    private void assignToTech() {
        svc.transition(manager, reqId, new Dto.TransitionRequest(RequestStatus.UNDER_REVIEW, null, null));
        svc.assign(manager, reqId, new Dto.AssignRequest(Fakes.idOf(tech),
                LocalDate.now().plusDays(2), null, null));
    }

    // ---------- setup and creation ----------

    @Test @DisplayName("A tenant cannot create a property")
    void tenantCannotCreateProperty() {
        assertThrows(AppException.class, () ->
            propSvc.create(tenant, new Dto.CreatePropertyRequest("Sneaky", null, "villa")));
    }

    @Test @DisplayName("A duplicate unit label in the same property is rejected")
    void duplicateUnitLabelRejected() {
        Property p = props.all.get(0);
        assertThrows(AppException.class, () ->
            propSvc.createUnit(manager, new Dto.CreateUnitRequest(Fakes.idOf(p), "7b")));
    }

    @Test @DisplayName("A new request starts as REPORTED, with history and a manager notification")
    void requestStartsReported() {
        Dto.RequestDetailView d = svc.detail(manager, reqId);
        assertEquals(RequestStatus.REPORTED, d.request().status());
        assertEquals("7B", d.request().unitLabel());
        assertEquals(1, d.history().size());
        assertEquals(1, notifs.countByRecipientIdAndReadFalse(Fakes.idOf(manager)));
    }

    @Test @DisplayName("A tenant cannot report against a unit that is not theirs")
    void tenantCannotReportOnForeignUnit() {
        assertThrows(AppException.class, () ->
            svc.create(tenant, new Dto.CreateRequestRequest(Fakes.idOf(u9c), "Nope", "x",
                    Category.OTHER, Priority.LOW, null)));
    }

    // ---------- visibility ----------

    @Test @DisplayName("Each role sees only the requests within its scope")
    void listIsScopedByRole() {
        assertEquals(1, svc.list(tenant, null).size());
        assertEquals(0, svc.list(tenant2, null).size());
        assertEquals(1, svc.list(manager, null).size());
        assertEquals(0, svc.list(tech, null).size());

        assignToTech();
        assertEquals(1, svc.list(tech, null).size());
        assertEquals(0, svc.list(tech2, null).size());
    }

    @Test @DisplayName("Another tenant cannot open the request by its id")
    void foreignTenantCannotRead() {
        assertThrows(AppException.class, () -> svc.detail(tenant2, reqId));
    }

    // ---------- lifecycle ----------

    @Test @DisplayName("An illegal status jump is rejected")
    void illegalTransitionRejected() {
        AppException ex = assertThrows(AppException.class, () ->
            svc.transition(manager, reqId, new Dto.TransitionRequest(RequestStatus.COMPLETED, null, "x")));
        assertTrue(ex.getMessage().contains("cannot move"));
    }

    @Test @DisplayName("A tenant cannot drive the workflow")
    void tenantCannotTriage() {
        assertThrows(AppException.class, () ->
            svc.transition(tenant, reqId, new Dto.TransitionRequest(RequestStatus.UNDER_REVIEW, null, null)));
    }

    @Test @DisplayName("A request cannot reach ASSIGNED without a technician")
    void assignedRequiresTechnician() {
        svc.transition(manager, reqId, new Dto.TransitionRequest(RequestStatus.UNDER_REVIEW, null, null));
        assertThrows(AppException.class, () ->
            svc.transition(manager, reqId, new Dto.TransitionRequest(RequestStatus.ASSIGNED, null, null)));
    }

    @Test @DisplayName("Only a technician account can be assigned work")
    void cannotAssignNonTechnician() {
        svc.transition(manager, reqId, new Dto.TransitionRequest(RequestStatus.UNDER_REVIEW, null, null));
        assertThrows(AppException.class, () ->
            svc.assign(manager, reqId, new Dto.AssignRequest(Fakes.idOf(tenant), null, null, null)));
    }

    @Test @DisplayName("Only the assigned technician can start the job")
    void onlyAssignedTechnicianStarts() {
        assignToTech();
        assertThrows(AppException.class, () ->
            svc.transition(tech2, reqId, new Dto.TransitionRequest(RequestStatus.IN_PROGRESS, null, null)));
        assertEquals(RequestStatus.IN_PROGRESS, svc.transition(tech, reqId,
            new Dto.TransitionRequest(RequestStatus.IN_PROGRESS, null, null)).status());
    }

    @Test @DisplayName("Work cannot be completed without completion notes")
    void completionRequiresNotes() {
        assignToTech();
        svc.transition(tech, reqId, new Dto.TransitionRequest(RequestStatus.IN_PROGRESS, null, null));
        assertThrows(AppException.class, () ->
            svc.transition(tech, reqId, new Dto.TransitionRequest(RequestStatus.COMPLETED, null, "   ")));

        Dto.RequestView done = svc.transition(tech, reqId,
            new Dto.TransitionRequest(RequestStatus.COMPLETED, null, "Replaced the cartridge."));
        assertEquals(RequestStatus.COMPLETED, done.status());
        assertEquals("Replaced the cartridge.", done.completionNotes());
    }

    @Test @DisplayName("A closed request can be reopened by its reporter and keeps its id")
    void closeThenReopen() {
        assignToTech();
        svc.transition(tech, reqId, new Dto.TransitionRequest(RequestStatus.IN_PROGRESS, null, null));
        svc.transition(tech, reqId, new Dto.TransitionRequest(RequestStatus.COMPLETED, null, "Done."));

        assertThrows(AppException.class, () ->
            svc.transition(tech, reqId, new Dto.TransitionRequest(RequestStatus.CLOSED, null, null)));

        assertEquals(RequestStatus.CLOSED, svc.transition(manager, reqId,
            new Dto.TransitionRequest(RequestStatus.CLOSED, null, null)).status());
        assertThrows(AppException.class, () ->
            svc.addComment(tenant, reqId, new Dto.CommentRequest("hello")));

        Dto.RequestView reopened = svc.transition(tenant, reqId,
            new Dto.TransitionRequest(RequestStatus.REOPENED, "Still leaking", null));
        assertEquals(RequestStatus.REOPENED, reopened.status());
        assertEquals(reqId, reopened.id());
    }

    // ---------- expenses ----------

    @Test @DisplayName("A tenant cannot record an expense and cannot see expenses")
    void tenantHasNoExpenseAccess() {
        assertThrows(AppException.class, () ->
            svc.addExpense(tenant, reqId, new Dto.ExpenseRequest(new BigDecimal("10"), "x")));
        svc.addExpense(manager, reqId, new Dto.ExpenseRequest(new BigDecimal("100"), "Part"));
        assertTrue(svc.detail(tenant, reqId).expenses().isEmpty());
    }

    @Test @DisplayName("Nobody can approve an expense they recorded themselves")
    void noSelfApproval() {
        Dto.ExpenseView own = svc.addExpense(manager, reqId,
            new Dto.ExpenseRequest(new BigDecimal("500.00"), "Manager-recorded part"));
        AppException ex = assertThrows(AppException.class, () -> svc.approveExpense(manager, own.id()));
        assertTrue(ex.getMessage().contains("cannot be approved by the person who recorded it"));
    }

    @Test @DisplayName("A manager approves another person's expense and is recorded as approver")
    void managerApproves() {
        assignToTech();
        Dto.ExpenseView ex = svc.addExpense(tech, reqId,
            new Dto.ExpenseRequest(new BigDecimal("2400.00"), "Cartridge"));
        assertFalse(ex.approved());
        Dto.ExpenseView approved = svc.approveExpense(manager, ex.id());
        assertTrue(approved.approved());
        assertEquals("Maya Iqbal", approved.approvedByName());
    }

    // ---------- dashboard and notifications ----------

    @Test @DisplayName("Dashboard figures are computed from stored records, scoped per role")
    void dashboardIsScopedAndReal() {
        svc.addExpense(manager, reqId, new Dto.ExpenseRequest(new BigDecimal("2400.00"), "Cartridge"));

        Dto.DashboardView md = dash.forAccount(manager);
        assertEquals(1, md.openRequests());
        assertEquals(0, new BigDecimal("2400.00").compareTo(md.monthlySpend()));

        Dto.DashboardView td = dash.forAccount(tenant);
        assertEquals(1, td.openRequests());
        assertEquals(0, BigDecimal.ZERO.compareTo(td.monthlySpend()));

        assertEquals(0, dash.forAccount(tenant2).openRequests());
    }

    @Test @DisplayName("Notifications reach only the people involved")
    void notificationsAreTargeted() {
        assignToTech();
        assertFalse(notifier.listFor(tenant).isEmpty());
        assertTrue(notifier.listFor(tenant2).isEmpty());
        assertTrue(notifier.listFor(tech).stream().anyMatch(n -> n.message().contains("assigned")));
    }
}
