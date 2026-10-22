package com.pmp.domain.maintenance;

import com.pmp.domain.shared.Guard;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** CORE aggregate root. Has a typed location (not a nullable flat id) and
 *  may hold several work orders. */
public class MaintenanceRequest {
    private final UUID id;
    private final UUID organizationId;
    private final MaintenanceLocation location;
    private final UUID reporterPartyId;
    private String title;
    private Priority priority;
    private RequestStatus status = RequestStatus.REPORTED;
    private final List<WorkOrder> workOrders = new ArrayList<>();

    public MaintenanceRequest(UUID organizationId, MaintenanceLocation location,
                              UUID reporterPartyId, String title, Priority priority) {
        this.id = Guard.id();
        this.organizationId = Guard.notNull(organizationId, "organizationId");
        this.location = Guard.notNull(location, "location");
        this.reporterPartyId = reporterPartyId;
        this.title = Guard.notBlank(title, "title");
        this.priority = priority == null ? Priority.NORMAL : priority;
    }
    public UUID id() { return id; }
    public MaintenanceLocation location() { return location; }
    public RequestStatus status() { return status; }
    public List<WorkOrder> workOrders() { return List.copyOf(workOrders); }

    public void review() { transition(RequestStatus.REPORTED, RequestStatus.UNDER_REVIEW); }

    public WorkOrder raiseWorkOrder(Trade trade) {
        Guard.require(status == RequestStatus.UNDER_REVIEW || status == RequestStatus.IN_PROGRESS,
                "work orders are raised after review");
        WorkOrder wo = new WorkOrder(id, trade);
        workOrders.add(wo);
        if (status == RequestStatus.UNDER_REVIEW) status = RequestStatus.IN_PROGRESS;
        return wo;
    }
    public void putOnHold() { transition(RequestStatus.IN_PROGRESS, RequestStatus.ON_HOLD); }
    public void resume() { transition(RequestStatus.ON_HOLD, RequestStatus.IN_PROGRESS); }

    /** All work orders must be closed out before the request is marked complete. */
    public void markWorkCompleted() {
        Guard.require(status == RequestStatus.IN_PROGRESS, "cannot complete from " + status);
        Guard.require(!workOrders.isEmpty(), "no work orders to complete");
        Guard.require(workOrders.stream().allMatch(WorkOrder::isClosedOut),
                "all work orders must be completed first");
        this.status = RequestStatus.WORK_COMPLETED;
    }
    public void verify() { transition(RequestStatus.WORK_COMPLETED, RequestStatus.VERIFIED); }

    /** Closing requires verification and a reporter/manager confirmation. */
    public void close(boolean confirmed) {
        Guard.require(status == RequestStatus.VERIFIED, "cannot close before verification");
        Guard.require(confirmed, "closure must be confirmed");
        this.status = RequestStatus.CLOSED;
    }
    public void reopen(String reason) {
        Guard.require(status == RequestStatus.CLOSED, "only a closed request can be reopened");
        Guard.notBlank(reason, "reason");
        this.status = RequestStatus.REOPENED; // keeps the same id and history
    }
    public void escalate() {
        Guard.require(status == RequestStatus.IN_PROGRESS || status == RequestStatus.ON_HOLD,
                "only active requests can be escalated");
        this.status = RequestStatus.ESCALATED;
    }
    private void transition(RequestStatus from, RequestStatus to) {
        Guard.require(status == from, "cannot move to " + to + " from " + status);
        this.status = to;
    }
}
