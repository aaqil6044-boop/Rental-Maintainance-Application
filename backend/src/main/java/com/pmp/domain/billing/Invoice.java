package com.pmp.domain.billing;

import com.pmp.domain.shared.Guard;
import com.pmp.domain.shared.Money;
import java.util.UUID;

/** Aggregate root. Submission is decoupled from verification. */
public class Invoice {
    public enum Status { SUBMITTED, VERIFIED, APPROVED, REJECTED }
    private final UUID id;
    private final UUID workOrderId;
    private final Money amount;
    private Status status = Status.SUBMITTED;

    public Invoice(UUID workOrderId, Money amount) {
        this.id = Guard.id();
        this.workOrderId = Guard.notNull(workOrderId, "workOrderId");
        this.amount = Guard.notNull(amount, "amount");
    }
    public UUID id() { return id; }
    public Status status() { return status; }
    public void verify() { transition(Status.SUBMITTED, Status.VERIFIED); }
    public void approve() { transition(Status.VERIFIED, Status.APPROVED); }
    public void reject() { this.status = Status.REJECTED; }
    private void transition(Status from, Status to) {
        Guard.require(status == from, "cannot move to " + to + " from " + status);
        this.status = to;
    }
}
