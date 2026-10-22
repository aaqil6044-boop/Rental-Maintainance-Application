package com.pmp.domain.property;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** Aggregate root. Buildings and floors are modelled within Property;
 *  Unit is a SEPARATE aggregate to avoid an unbounded Property aggregate. */
public class Property {
    public enum Status { DRAFT, ACTIVE, SUSPENDED, DEACTIVATED }
    private final UUID id;
    private final UUID organizationId;
    private String name;
    private final PropertyType type;
    private Address address;
    private Status status = Status.DRAFT;

    public Property(UUID organizationId, String name, PropertyType type) {
        this.id = Guard.id();
        this.organizationId = Guard.notNull(organizationId, "organizationId");
        this.name = Guard.notBlank(name, "name");
        this.type = Guard.notNull(type, "type");
    }
    public UUID id() { return id; }
    public UUID organizationId() { return organizationId; }
    public PropertyType type() { return type; }
    public Status status() { return status; }

    /** Only an approved property may be activated. */
    public void activate() {
        Guard.require(status == Status.DRAFT || status == Status.SUSPENDED, "cannot activate from " + status);
        this.status = Status.ACTIVE;
    }
    public void suspend() {
        Guard.require(status == Status.ACTIVE, "only an active property can be suspended");
        this.status = Status.SUSPENDED;
    }
    public void deactivate() { this.status = Status.DEACTIVATED; } // history retained
    public boolean isOperational() { return status == Status.ACTIVE; }
}
