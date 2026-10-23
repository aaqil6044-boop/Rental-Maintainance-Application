package com.pmp.app;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/**
 * The maintenance lifecycle. Every method re-checks the caller's role and scope against the
 * record being touched, so authorization never depends on what the browser chose to show.
 */
@Service
public class RequestService {

    private final MaintenanceRequestRepository requests;
    private final RequestCommentRepository comments;
    private final RequestEventRepository events;
    private final ExpenseRepository expenses;
    private final UnitRepository units;
    private final AccountRepository accounts;
    private final UnitAssignmentRepository assignments;
    private final NotificationService notifier;

    public RequestService(MaintenanceRequestRepository requests, RequestCommentRepository comments,
                          RequestEventRepository events, ExpenseRepository expenses,
                          UnitRepository units, AccountRepository accounts,
                          UnitAssignmentRepository assignments, NotificationService notifier) {
        this.requests = requests;
        this.comments = comments;
        this.events = events;
        this.expenses = expenses;
        this.units = units;
        this.accounts = accounts;
        this.assignments = assignments;
        this.notifier = notifier;
    }

    // ---------- visibility ----------

    private boolean canView(Account who, MaintenanceRequest r) {
        switch (who.getRole()) {
            case MANAGER:    return true;
            case TENANT:     return r.getReporter().getId().equals(who.getId());
            case TECHNICIAN: return r.getTechnician() != null
                                 && r.getTechnician().getId().equals(who.getId());
            default:         return false;
        }
    }

    private MaintenanceRequest loadVisible(Account who, Long id) {
        MaintenanceRequest r = requests.findById(id)
                .orElseThrow(() -> AppException.notFound("That request"));
        if (!canView(who, r)) throw AppException.forbidden();
        return r;
    }

    // ---------- reads ----------

    @Transactional(readOnly = true)
    public List<Dto.RequestView> list(Account who, RequestStatus status) {
        List<MaintenanceRequest> found;
        switch (who.getRole()) {
            case MANAGER:    found = requests.findAllByOrderByCreatedAtDesc(); break;
            case TENANT:     found = requests.findByReporterIdOrderByCreatedAtDesc(who.getId()); break;
            case TECHNICIAN: found = requests.findByTechnicianIdOrderByCreatedAtDesc(who.getId()); break;
            default:         found = new ArrayList<>();
        }
        List<MaintenanceRequest> filtered = new ArrayList<>();
        for (MaintenanceRequest r : found) {
            if (status == null || r.getStatus() == status) filtered.add(r);
        }
        return Views.requests(filtered);
    }

    @Transactional(readOnly = true)
    public Dto.RequestDetailView detail(Account who, Long id) {
        MaintenanceRequest r = loadVisible(who, id);

        List<Dto.CommentView> cs = new ArrayList<>();
        for (RequestComment c : comments.findByRequestIdOrderByCreatedAtAsc(id)) cs.add(Views.comment(c));

        List<Dto.EventView> hs = new ArrayList<>();
        for (RequestEvent e : events.findByRequestIdOrderByCreatedAtAsc(id)) hs.add(Views.event(e));

        List<Dto.ExpenseView> xs = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        boolean showExpenses = who.getRole() != Role.TENANT;
        if (showExpenses) {
            for (Expense x : expenses.findByRequestIdOrderByCreatedAtAsc(id)) {
                xs.add(Views.expense(x));
                total = total.add(x.getAmount());
            }
        }
        return new Dto.RequestDetailView(Views.request(r), cs, hs, xs, total);
    }

    // ---------- create ----------

    @Transactional
    public Dto.RequestView create(Account who, Dto.CreateRequestRequest req) {
        Unit unit = units.findById(req.unitId())
                .orElseThrow(() -> AppException.notFound("That unit"));

        if (!unit.isActive()) {
            throw AppException.badRequest("That unit is deactivated and cannot take new requests.");
        }
        if (who.getRole() == Role.TECHNICIAN) throw AppException.forbidden();
        if (who.getRole() == Role.TENANT
                && !assignments.existsByTenantIdAndUnitId(who.getId(), unit.getId())) {
            throw AppException.forbidden();
        }

        MaintenanceRequest r = new MaintenanceRequest(unit, who, req.title().trim(),
                req.description().trim(), req.category(), req.priority());
        if (req.photoName() != null && !req.photoName().isBlank()) {
            r.setPhotoName(req.photoName().trim());
        }
        requests.save(r);

        events.save(new RequestEvent(r, who, null, RequestStatus.REPORTED, "Request raised"));
        notifier.notifyAllManagers("New request: " + r.getTitle()
                + " (" + unit.getProperty().getName() + " " + unit.getLabel() + ")", r.getId());

        return Views.request(r);
    }

    // ---------- lifecycle ----------

    @Transactional
    public Dto.RequestView transition(Account who, Long id, Dto.TransitionRequest req) {
        MaintenanceRequest r = loadVisible(who, id);
        RequestStatus from = r.getStatus();
        RequestStatus to = req.target();

        if (!from.canMoveTo(to)) {
            throw AppException.badRequest("A request cannot move from " + from + " to " + to + ".");
        }
        requireRoleForTransition(who, r, to);

        if (to == RequestStatus.COMPLETED) {
            String notes = req.completionNotes();
            if (notes == null || notes.isBlank()) {
                throw AppException.badRequest("Completion notes are required before marking work complete.");
            }
            r.setCompletionNotes(notes.trim());
        }
        if (to == RequestStatus.ASSIGNED && r.getTechnician() == null) {
            throw AppException.badRequest("Assign a technician before moving the request to ASSIGNED.");
        }

        r.setStatus(to);
        requests.save(r);

        String note = (req.note() == null || req.note().isBlank())
                ? (from + " to " + to) : req.note().trim();
        events.save(new RequestEvent(r, who, from, to, note));

        notifier.notifyAccount(r.getReporter(),
                "Your request \"" + r.getTitle() + "\" is now " + to + ".", r.getId());
        if (r.getTechnician() != null && !r.getTechnician().getId().equals(who.getId())) {
            notifier.notifyAccount(r.getTechnician(),
                    "Request \"" + r.getTitle() + "\" is now " + to + ".", r.getId());
        }
        return Views.request(r);
    }

    private void requireRoleForTransition(Account who, MaintenanceRequest r, RequestStatus to) {
        switch (to) {
            case UNDER_REVIEW:
            case ASSIGNED:
            case CLOSED:
                if (who.getRole() != Role.MANAGER) throw AppException.forbidden();
                break;
            case IN_PROGRESS:
            case COMPLETED:
                boolean assignedTech = who.getRole() == Role.TECHNICIAN
                        && r.getTechnician() != null
                        && r.getTechnician().getId().equals(who.getId());
                if (!assignedTech && who.getRole() != Role.MANAGER) throw AppException.forbidden();
                break;
            case REOPENED:
                boolean isReporter = r.getReporter().getId().equals(who.getId());
                if (who.getRole() != Role.MANAGER && !isReporter) throw AppException.forbidden();
                break;
            default:
                throw AppException.forbidden();
        }
    }

    @Transactional
    public Dto.RequestView assign(Account who, Long id, Dto.AssignRequest req) {
        if (who.getRole() != Role.MANAGER) throw AppException.forbidden();

        MaintenanceRequest r = requests.findById(id)
                .orElseThrow(() -> AppException.notFound("That request"));
        Account tech = accounts.findById(req.technicianId())
                .orElseThrow(() -> AppException.notFound("That technician"));

        if (tech.getRole() != Role.TECHNICIAN) {
            throw AppException.badRequest("Only a technician account can be assigned work.");
        }
        if (!tech.isActive()) {
            throw AppException.badRequest("That technician account is deactivated.");
        }

        RequestStatus from = r.getStatus();
        r.setTechnician(tech);
        if (req.dueDate() != null) r.setDueDate(req.dueDate());
        if (req.priority() != null) r.setPriority(req.priority());
        if (req.category() != null) r.setCategory(req.category());

        if (from.canMoveTo(RequestStatus.ASSIGNED)) {
            r.setStatus(RequestStatus.ASSIGNED);
        }
        requests.save(r);

        events.save(new RequestEvent(r, who, from, r.getStatus(),
                "Assigned to " + tech.getFullName()));
        notifier.notifyAccount(tech, "You have been assigned: " + r.getTitle(), r.getId());
        notifier.notifyAccount(r.getReporter(),
                "Your request \"" + r.getTitle() + "\" was assigned to a technician.", r.getId());

        return Views.request(r);
    }

    // ---------- comments ----------

    @Transactional
    public Dto.CommentView addComment(Account who, Long id, Dto.CommentRequest req) {
        MaintenanceRequest r = loadVisible(who, id);
        if (r.getStatus() == RequestStatus.CLOSED) {
            throw AppException.badRequest("This request is closed. Reopen it before adding a comment.");
        }
        RequestComment c = new RequestComment(r, who, req.body().trim());
        comments.save(c);

        if (!r.getReporter().getId().equals(who.getId())) {
            notifier.notifyAccount(r.getReporter(),
                    "New comment on \"" + r.getTitle() + "\".", r.getId());
        }
        return Views.comment(c);
    }

    // ---------- expenses ----------

    @Transactional
    public Dto.ExpenseView addExpense(Account who, Long id, Dto.ExpenseRequest req) {
        MaintenanceRequest r = loadVisible(who, id);
        if (who.getRole() == Role.TENANT) throw AppException.forbidden();
        if (req.amount().signum() <= 0) {
            throw AppException.badRequest("An expense amount must be greater than zero.");
        }
        Expense x = new Expense(r, who, req.amount(), req.description().trim());
        expenses.save(x);
        events.save(new RequestEvent(r, who, r.getStatus(), r.getStatus(),
                "Expense recorded: " + req.amount()));
        return Views.expense(x);
    }

    @Transactional
    public Dto.ExpenseView approveExpense(Account who, Long expenseId) {
        if (who.getRole() != Role.MANAGER) throw AppException.forbidden();
        Expense x = expenses.findById(expenseId)
                .orElseThrow(() -> AppException.notFound("That expense"));
        if (x.getRecordedBy().getId().equals(who.getId())) {
            throw AppException.badRequest("An expense cannot be approved by the person who recorded it.");
        }
        x.approve(who);
        expenses.save(x);
        return Views.expense(x);
    }
}
