package com.pmp.domain.maintenance;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** Aggregate root. One request may spawn several work orders (one per trade). */
public class WorkOrder {
    private final UUID id;
    private final UUID requestId;
    private final Trade trade;
    private UUID vendorId; // set when offered
    private WorkOrderStatus status = WorkOrderStatus.CREATED;
    private boolean evidenceAttached = false;

    public WorkOrder(UUID requestId, Trade trade) {
        this.id = Guard.id();
        this.requestId = Guard.notNull(requestId, "requestId");
        this.trade = Guard.notNull(trade, "trade");
    }
    public UUID id() { return id; }
    public UUID requestId() { return requestId; }
    public WorkOrderStatus status() { return status; }

    public void offerTo(UUID vendorId) {
        Guard.require(status == WorkOrderStatus.CREATED || status == WorkOrderStatus.REJECTED
                || status == WorkOrderStatus.REASSIGNED, "cannot offer from " + status);
        this.vendorId = Guard.notNull(vendorId, "vendorId");
        this.status = WorkOrderStatus.OFFERED;
    }
    public void accept() { transition(WorkOrderStatus.OFFERED, WorkOrderStatus.ACCEPTED); }
    public void reject(String reason) {
        Guard.notBlank(reason, "reason");
        transition(WorkOrderStatus.OFFERED, WorkOrderStatus.REJECTED);
        this.vendorId = null;
    }
    public void start() { transition(WorkOrderStatus.ACCEPTED, WorkOrderStatus.IN_PROGRESS); }
    public void awaitParts() { transition(WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.AWAITING_PARTS); }
    public void resume() { transition(WorkOrderStatus.AWAITING_PARTS, WorkOrderStatus.IN_PROGRESS); }

    /** Completion requires evidence. */
    public void complete(boolean hasEvidence) {
        Guard.require(status == WorkOrderStatus.IN_PROGRESS, "cannot complete from " + status);
        Guard.require(hasEvidence, "completion requires evidence");
        this.evidenceAttached = true;
        this.status = WorkOrderStatus.COMPLETED;
    }
    public void verify() { transition(WorkOrderStatus.COMPLETED, WorkOrderStatus.VERIFIED); }
    public void cancel() {
        Guard.require(status != WorkOrderStatus.VERIFIED, "a verified work order cannot be cancelled");
        this.status = WorkOrderStatus.CANCELLED;
    }
    public boolean isClosedOut() {
        return status == WorkOrderStatus.VERIFIED || status == WorkOrderStatus.CANCELLED;
    }
    private void transition(WorkOrderStatus from, WorkOrderStatus to) {
        Guard.require(status == from, "cannot move to " + to + " from " + status);
        this.status = to;
    }
}
