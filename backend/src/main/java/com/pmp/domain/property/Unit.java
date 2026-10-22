package com.pmp.domain.property;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** Aggregate root. References its property (and optional building/floor) by id. */
public class Unit {
    public enum Status { ACTIVE, DEACTIVATED }
    private final UUID id;
    private final UUID organizationId;
    private final UUID propertyId;
    private final UUID buildingId; // nullable
    private final UUID floorId;    // nullable
    private final String unitIdentifier;
    private Status status = Status.ACTIVE;

    public Unit(UUID organizationId, UUID propertyId, UUID buildingId, UUID floorId, String unitIdentifier) {
        this.id = Guard.id();
        this.organizationId = Guard.notNull(organizationId, "organizationId");
        this.propertyId = Guard.notNull(propertyId, "propertyId");
        this.buildingId = buildingId;
        this.floorId = floorId;
        this.unitIdentifier = Guard.notBlank(unitIdentifier, "unitIdentifier");
    }
    public UUID id() { return id; }
    public UUID propertyId() { return propertyId; }
    public String unitIdentifier() { return unitIdentifier; }
    public Status status() { return status; }
    public void deactivate() { this.status = Status.DEACTIVATED; }
    public boolean isActive() { return status == Status.ACTIVE; }
}
