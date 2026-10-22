package com.pmp.domain.vendor;

import com.pmp.domain.shared.Guard;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

/** Aggregate root. Owns profile, categories and lifecycle; NOT work orders. */
public class Vendor {
    public enum Status { DRAFT, SUBMITTED, PENDING_VERIFICATION, APPROVED, ACTIVE, REJECTED, SUSPENDED, INACTIVE }
    private final UUID id;
    private final UUID organizationId;
    private String name;
    private Status status = Status.DRAFT;
    private final Set<ServiceCategory> categories = EnumSet.noneOf(ServiceCategory.class);

    public Vendor(UUID organizationId, String name) {
        this.id = Guard.id();
        this.organizationId = Guard.notNull(organizationId, "organizationId");
        this.name = Guard.notBlank(name, "name");
    }
    public UUID id() { return id; }
    public Status status() { return status; }
    public void addCategory(ServiceCategory c) { categories.add(c); }

    public void submit() { this.status = Status.SUBMITTED; }
    public void approve() {
        Guard.require(status == Status.SUBMITTED || status == Status.PENDING_VERIFICATION,
                "cannot approve from " + status);
        this.status = Status.ACTIVE;
    }
    public void suspend() { this.status = Status.SUSPENDED; }
    public void reinstate() {
        Guard.require(status == Status.SUSPENDED, "only a suspended vendor can be reinstated");
        this.status = Status.ACTIVE;
    }

    /** Eligibility checked before a work order is offered. */
    public boolean isEligibleFor(ServiceCategory category) {
        return status == Status.ACTIVE && categories.contains(category);
    }
}
