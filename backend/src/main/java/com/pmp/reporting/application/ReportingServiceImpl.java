package com.pmp.reporting.application;

import com.pmp.reporting.api.ReportingService;
import com.pmp.reporting.api.dto.*;
import com.pmp.maintenance.persistence.Request;
import com.pmp.maintenance.repository.RequestRepository;
import com.pmp.maintenance.types.RequestStatus;
import com.pmp.billing.persistence.ExpenseRecord;
import com.pmp.billing.repository.ExpenseRecordRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Read-side projections computed from the maintenance and billing modules. */
@Service
public class ReportingServiceImpl implements ReportingService {

    private final RequestRepository requests;
    private final ExpenseRecordRepository expenses;

    public ReportingServiceImpl(RequestRepository requests, ExpenseRecordRepository expenses) {
        this.requests = requests; this.expenses = expenses;
    }

    @Override @Transactional
    public RequestSummaryResponse requestSummary(UUID organizationId) {
        List<Request> all = requests.findByOrganizationId(organizationId);
        long open = all.stream().filter(r -> isOpen(r.getStatus())).count();
        long resolved = all.stream().filter(r -> r.getStatus() == RequestStatus.verified
                || r.getStatus() == RequestStatus.closed).count();
        long overdue = all.stream().filter(r -> r.getStatus() == RequestStatus.escalated).count();
        return new RequestSummaryResponse(open, resolved, overdue);
    }

    @Override @Transactional
    public SpendSummaryResponse spendSummary(UUID organizationId) {
        BigDecimal total = expenses.findByOrganizationId(organizationId).stream()
                .map(ExpenseRecord::getAmount)
                .filter(a -> a != null)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new SpendSummaryResponse(total, "INR");
    }

    private static boolean isOpen(RequestStatus s) {
        return s == RequestStatus.reported || s == RequestStatus.under_review
                || s == RequestStatus.in_progress || s == RequestStatus.on_hold
                || s == RequestStatus.escalated || s == RequestStatus.reopened;
    }
}
