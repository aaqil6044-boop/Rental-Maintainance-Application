package com.pmp.billing.api;
import com.pmp.billing.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface BillingService {
    QuotationResponse submitQuotation(SubmitQuotationRequest request);
    QuotationResponse approveQuotation(UUID quotationId, ApproveQuotationRequest request);
    QuotationResponse rejectQuotation(UUID quotationId);
    List<QuotationResponse> listQuotations(UUID workOrderId);
    WorkAuthorizationResponse authorizeWork(AuthorizeWorkRequest request);
    WorkAuthorizationResponse postHocApprove(UUID authorizationId);
    InvoiceResponse submitInvoice(SubmitInvoiceRequest request);
    InvoiceResponse verifyInvoice(UUID invoiceId);
    void recordPayment(UUID invoiceId, RecordPaymentRequest request);
    ExpenseResponse recordExpense(RecordExpenseRequest request);
}
