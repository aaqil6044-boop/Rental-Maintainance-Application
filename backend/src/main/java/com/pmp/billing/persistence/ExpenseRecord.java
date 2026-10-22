package com.pmp.billing.persistence;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import com.pmp.billing.types.*;

@Entity
@Table(name = "billing_expense_record")
public class ExpenseRecord {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "request_id")
    private UUID requestId;

    @Column(name = "work_order_id")
    private UUID workOrderId;

    @Column(name = "amount")
    private BigDecimal amount;

    @Column(name = "currency")
    private String currency;

    @Column(name = "cost_category")
    private String costCategory;

    @Enumerated(EnumType.STRING)
    @Column(name = "payer_type")
    private ExpenseRecordPayerType payerType;

    @Column(name = "payer_party_id")
    private UUID payerPartyId;

    @Column(name = "recorded_by")
    private UUID recordedBy;

    @Column(name = "recorded_at")
    private Instant recordedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public UUID getRequestId() { return requestId; }
    public void setRequestId(UUID requestId) { this.requestId = requestId; }
    public UUID getWorkOrderId() { return workOrderId; }
    public void setWorkOrderId(UUID workOrderId) { this.workOrderId = workOrderId; }
    public BigDecimal getAmount() { return amount; }
    public void setAmount(BigDecimal amount) { this.amount = amount; }
    public String getCurrency() { return currency; }
    public void setCurrency(String currency) { this.currency = currency; }
    public String getCostCategory() { return costCategory; }
    public void setCostCategory(String costCategory) { this.costCategory = costCategory; }
    public ExpenseRecordPayerType getPayerType() { return payerType; }
    public void setPayerType(ExpenseRecordPayerType payerType) { this.payerType = payerType; }
    public UUID getPayerPartyId() { return payerPartyId; }
    public void setPayerPartyId(UUID payerPartyId) { this.payerPartyId = payerPartyId; }
    public UUID getRecordedBy() { return recordedBy; }
    public void setRecordedBy(UUID recordedBy) { this.recordedBy = recordedBy; }
    public Instant getRecordedAt() { return recordedAt; }
    public void setRecordedAt(Instant recordedAt) { this.recordedAt = recordedAt; }
}
