package com.pmp.billing.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.domain.shared.DomainException;
import com.pmp.billing.api.BillingService;
import com.pmp.billing.api.dto.*;
import com.pmp.billing.persistence.*;
import com.pmp.billing.repository.*;
import com.pmp.billing.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class BillingServiceImpl implements BillingService {

    private final QuotationRepository quotations;
    private final WorkAuthorizationRepository authorizations;
    private final InvoiceRepository invoices;
    private final PaymentRecordRepository payments;
    private final ExpenseRecordRepository expenses;

    public BillingServiceImpl(QuotationRepository quotations, WorkAuthorizationRepository authorizations,
            InvoiceRepository invoices, PaymentRecordRepository payments, ExpenseRecordRepository expenses) {
        this.quotations = quotations; this.authorizations = authorizations; this.invoices = invoices;
        this.payments = payments; this.expenses = expenses;
    }

    @Override @Transactional
    public QuotationResponse submitQuotation(SubmitQuotationRequest r) {
        Quotation q = new Quotation();
        q.setId(UUID.randomUUID());
        q.setWorkOrderId(r.workOrderId());
        q.setAmount(r.amount());
        q.setCurrency(r.currency());
        q.setStatus(QuotationStatus.submitted);
        q.setCreatedAt(Instant.now());
        return toResponse(quotations.save(q));
    }
    @Override @Transactional
    public QuotationResponse approveQuotation(UUID quotationId, ApproveQuotationRequest r) {
        Quotation q = quotations.findById(quotationId)
                .orElseThrow(() -> new NotFoundException("quotation " + quotationId + " not found"));
        if (q.getStatus() != QuotationStatus.submitted) throw new DomainException("cannot approve from " + q.getStatus());
        q.setStatus(q.getAmount().compareTo(r.limitAmount()) > 0 ? QuotationStatus.escalated : QuotationStatus.approved);
        quotations.save(q);
        return toResponse(q);
    }
    @Override @Transactional
    public QuotationResponse rejectQuotation(UUID quotationId) {
        Quotation q = quotations.findById(quotationId)
                .orElseThrow(() -> new NotFoundException("quotation " + quotationId + " not found"));
        q.setStatus(QuotationStatus.rejected); quotations.save(q);
        return toResponse(q);
    }
    @Override @Transactional
    public List<QuotationResponse> listQuotations(UUID workOrderId) {
        return quotations.findByWorkOrderId(workOrderId).stream().map(BillingServiceImpl::toResponse).toList();
    }

    @Override @Transactional
    public WorkAuthorizationResponse authorizeWork(AuthorizeWorkRequest r) {
        WorkAuthorization a = new WorkAuthorization();
        a.setId(UUID.randomUUID());
        a.setWorkOrderId(r.workOrderId());
        if (r.emergency()) {
            if (r.reason() == null || r.reason().isBlank()) throw new DomainException("emergency authorization requires a reason");
            a.setAuthorizationType(WorkAuthorizationAuthorizationType.emergency);
            a.setCapAmount(r.capAmount());
            a.setReason(r.reason());
        } else {
            a.setAuthorizationType(WorkAuthorizationAuthorizationType.normal);
        }
        a.setAuthorizedAt(Instant.now());
        authorizations.save(a);
        return toResponse(a);
    }
    @Override @Transactional
    public WorkAuthorizationResponse postHocApprove(UUID authorizationId) {
        WorkAuthorization a = authorizations.findById(authorizationId)
                .orElseThrow(() -> new NotFoundException("authorization " + authorizationId + " not found"));
        if (a.getAuthorizationType() != WorkAuthorizationAuthorizationType.emergency)
            throw new DomainException("only emergency authorizations need post-hoc approval");
        a.setPostHocApprovedBy(UUID.randomUUID()); // the approving manager, from the security context in production
        authorizations.save(a);
        return toResponse(a);
    }

    @Override @Transactional
    public InvoiceResponse submitInvoice(SubmitInvoiceRequest r) {
        Invoice i = new Invoice();
        i.setId(UUID.randomUUID());
        i.setWorkOrderId(r.workOrderId());
        i.setAmount(r.amount());
        i.setCurrency(r.currency());
        i.setStatus(InvoiceStatus.submitted);
        i.setCreatedAt(Instant.now());
        return toResponse(invoices.save(i));
    }
    @Override @Transactional
    public InvoiceResponse verifyInvoice(UUID invoiceId) {
        Invoice i = invoices.findById(invoiceId)
                .orElseThrow(() -> new NotFoundException("invoice " + invoiceId + " not found"));
        if (i.getStatus() != InvoiceStatus.submitted) throw new DomainException("cannot verify from " + i.getStatus());
        i.setStatus(InvoiceStatus.verified); invoices.save(i);
        return toResponse(i);
    }
    @Override @Transactional
    public void recordPayment(UUID invoiceId, RecordPaymentRequest r) {
        invoices.findById(invoiceId).orElseThrow(() -> new NotFoundException("invoice " + invoiceId + " not found"));
        PaymentRecord p = new PaymentRecord();
        p.setId(UUID.randomUUID());
        p.setInvoiceId(invoiceId);
        p.setPaymentStatus(PaymentRecordPaymentStatus.valueOf(r.paymentStatus()));
        p.setPaidAmount(r.paidAmount());
        p.setRecordedAt(Instant.now());
        payments.save(p);
    }
    @Override @Transactional
    public ExpenseResponse recordExpense(RecordExpenseRequest r) {
        ExpenseRecord e = new ExpenseRecord();
        e.setId(UUID.randomUUID());
        e.setRequestId(r.requestId());
        e.setWorkOrderId(r.workOrderId());
        e.setAmount(r.amount());
        e.setCurrency(r.currency());
        e.setCostCategory(r.costCategory());
        e.setPayerType(ExpenseRecordPayerType.valueOf(r.payerType()));
        e.setPayerPartyId(r.payerPartyId());
        e.setRecordedAt(Instant.now());
        expenses.save(e);
        return new ExpenseResponse(e.getId(), e.getRequestId(), e.getWorkOrderId(), e.getAmount(),
                e.getCurrency(), e.getPayerType() == null ? null : e.getPayerType().name());
    }

    private static QuotationResponse toResponse(Quotation q) {
        return new QuotationResponse(q.getId(), q.getWorkOrderId(), q.getAmount(), q.getCurrency(),
                q.getStatus() == null ? null : q.getStatus().name());
    }
    private static InvoiceResponse toResponse(Invoice i) {
        return new InvoiceResponse(i.getId(), i.getWorkOrderId(), i.getAmount(), i.getCurrency(),
                i.getStatus() == null ? null : i.getStatus().name());
    }
    private static WorkAuthorizationResponse toResponse(WorkAuthorization a) {
        boolean needs = a.getAuthorizationType() == WorkAuthorizationAuthorizationType.emergency
                && a.getPostHocApprovedBy() == null;
        return new WorkAuthorizationResponse(a.getId(), a.getWorkOrderId(),
                a.getAuthorizationType() == null ? null : a.getAuthorizationType().name(), needs);
    }
}
