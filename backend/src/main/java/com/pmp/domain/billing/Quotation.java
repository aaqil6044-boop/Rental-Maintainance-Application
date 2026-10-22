package com.pmp.domain.billing;

import com.pmp.domain.shared.Guard;
import com.pmp.domain.shared.Money;
import java.util.UUID;

/** Aggregate root. */
public class Quotation {
    public enum Status { SUBMITTED, APPROVED, REJECTED, ESCALATED }
    private final UUID id;
    private final UUID workOrderId;
    private final Money amount;
    private Status status = Status.SUBMITTED;

    public Quotation(UUID workOrderId, Money amount) {
        this.id = Guard.id();
        this.workOrderId = Guard.notNull(workOrderId, "workOrderId");
        this.amount = Guard.notNull(amount, "amount");
    }
    public UUID id() { return id; }
    public Status status() { return status; }

    /** Approve within a manager's limit, else it must escalate. */
    public void approveWithinLimit(Money limit) {
        Guard.require(status == Status.SUBMITTED, "cannot approve from " + status);
        if (amount.exceeds(limit)) { this.status = Status.ESCALATED; }
        else { this.status = Status.APPROVED; }
    }
    public void reject() { this.status = Status.REJECTED; }
    public boolean isApproved() { return status == Status.APPROVED; }
}
