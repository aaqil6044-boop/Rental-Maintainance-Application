package com.pmp.domain.billing;

import com.pmp.domain.shared.Guard;
import com.pmp.domain.shared.Money;
import java.util.UUID;

/** A cost booked against a request/work order, attributed to a payer. */
public class ExpenseRecord {
    private final UUID id;
    private final UUID requestId;
    private final UUID workOrderId; // nullable
    private final Money amount;
    private final PayerType payerType;
    private final UUID payerPartyId;

    public ExpenseRecord(UUID requestId, UUID workOrderId, Money amount,
                         PayerType payerType, UUID payerPartyId) {
        this.id = Guard.id();
        this.requestId = Guard.notNull(requestId, "requestId");
        this.workOrderId = workOrderId;
        this.amount = Guard.notNull(amount, "amount");
        this.payerType = Guard.notNull(payerType, "payerType");
        this.payerPartyId = payerPartyId;
    }
    public UUID id() { return id; }
    public Money amount() { return amount; }
    public PayerType payerType() { return payerType; }
}
