package com.pmp.app;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

/** Every figure here is counted from the database. Nothing on this screen is a constant. */
@Service
public class DashboardService {

    private final MaintenanceRequestRepository requests;
    private final ExpenseRepository expenses;
    private final RequestEventRepository events;
    private final NotificationService notifier;

    public DashboardService(MaintenanceRequestRepository requests, ExpenseRepository expenses,
                            RequestEventRepository events, NotificationService notifier) {
        this.requests = requests;
        this.expenses = expenses;
        this.events = events;
        this.notifier = notifier;
    }

    @Transactional(readOnly = true)
    public Dto.DashboardView forAccount(Account who) {
        List<MaintenanceRequest> scope;
        switch (who.getRole()) {
            case MANAGER:    scope = requests.findAllByOrderByCreatedAtDesc(); break;
            case TENANT:     scope = requests.findByReporterIdOrderByCreatedAtDesc(who.getId()); break;
            case TECHNICIAN: scope = requests.findByTechnicianIdOrderByCreatedAtDesc(who.getId()); break;
            default:         scope = new ArrayList<>();
        }

        long open = 0, high = 0, overdue = 0, inProgress = 0, awaitingReview = 0, closed = 0;
        long turnaroundCount = 0;
        long turnaroundSeconds = 0;
        List<MaintenanceRequest> attention = new ArrayList<>();

        for (MaintenanceRequest r : scope) {
            if (r.getStatus().isOpen()) open++;
            if (r.getStatus() == RequestStatus.IN_PROGRESS) inProgress++;
            if (r.getStatus() == RequestStatus.COMPLETED) awaitingReview++;
            if (r.getStatus() == RequestStatus.CLOSED) closed++;
            if (r.getStatus().isOpen()
                    && (r.getPriority() == Priority.HIGH || r.getPriority() == Priority.URGENT)) high++;
            if (r.isOverdue()) overdue++;

            if (r.getStatus() == RequestStatus.CLOSED && r.getClosedAt() != null) {
                turnaroundCount++;
                turnaroundSeconds += Duration.between(r.getCreatedAt(), r.getClosedAt()).getSeconds();
            }
            if (r.getStatus().isOpen()
                    && (r.isOverdue() || r.getPriority() == Priority.URGENT
                        || r.getStatus() == RequestStatus.REPORTED)) {
                if (attention.size() < 8) attention.add(r);
            }
        }

        BigDecimal monthlySpend = BigDecimal.ZERO;
        if (who.getRole() != Role.TENANT) {
            Instant monthAgo = Instant.now().minus(30, ChronoUnit.DAYS);
            for (Expense x : expenses.findAll()) {
                if (x.getCreatedAt().isAfter(monthAgo) && inScope(who, x.getRequest())) {
                    monthlySpend = monthlySpend.add(x.getAmount());
                }
            }
        }

        Double avgDays = null;
        if (turnaroundCount > 0) {
            avgDays = BigDecimal.valueOf(turnaroundSeconds)
                    .divide(BigDecimal.valueOf(turnaroundCount), 4, RoundingMode.HALF_UP)
                    .divide(BigDecimal.valueOf(86400), 2, RoundingMode.HALF_UP)
                    .doubleValue();
        }

        List<Dto.EventView> recent = new ArrayList<>();
        if (who.getRole() == Role.MANAGER) {
            for (RequestEvent e : events.findTop10ByOrderByCreatedAtDesc()) recent.add(Views.event(e));
        }

        return new Dto.DashboardView(
                who.getRole(), open, high, overdue, inProgress, awaitingReview, closed,
                monthlySpend, avgDays, notifier.unreadCount(who),
                Views.requests(attention), recent);
    }

    private boolean inScope(Account who, MaintenanceRequest r) {
        if (who.getRole() == Role.MANAGER) return true;
        if (who.getRole() == Role.TECHNICIAN) {
            return r.getTechnician() != null && r.getTechnician().getId().equals(who.getId());
        }
        return r.getReporter().getId().equals(who.getId());
    }
}
