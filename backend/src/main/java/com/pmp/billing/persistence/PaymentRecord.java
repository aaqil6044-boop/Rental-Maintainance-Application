package com.pmp.billing.persistence;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import com.pmp.billing.types.*;

@Entity
@Table(name = "billing_payment_record")
public class PaymentRecord {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "invoice_id")
    private UUID invoiceId;

    @Enumerated(EnumType.STRING)
    @Column(name = "payment_status")
    private PaymentRecordPaymentStatus paymentStatus;

    @Column(name = "paid_amount")
    private BigDecimal paidAmount;

    @Column(name = "recorded_by")
    private UUID recordedBy;

    @Column(name = "recorded_at")
    private Instant recordedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getInvoiceId() { return invoiceId; }
    public void setInvoiceId(UUID invoiceId) { this.invoiceId = invoiceId; }
    public PaymentRecordPaymentStatus getPaymentStatus() { return paymentStatus; }
    public void setPaymentStatus(PaymentRecordPaymentStatus paymentStatus) { this.paymentStatus = paymentStatus; }
    public BigDecimal getPaidAmount() { return paidAmount; }
    public void setPaidAmount(BigDecimal paidAmount) { this.paidAmount = paidAmount; }
    public UUID getRecordedBy() { return recordedBy; }
    public void setRecordedBy(UUID recordedBy) { this.recordedBy = recordedBy; }
    public Instant getRecordedAt() { return recordedAt; }
    public void setRecordedAt(Instant recordedAt) { this.recordedAt = recordedAt; }
}
