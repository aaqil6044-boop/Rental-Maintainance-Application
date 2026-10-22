package com.pmp.domain.maintenance;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** Value object. Exactly one reference, matching the location type.
 *  Replaces the old nullable FlatId; supports common-area maintenance. */
public final class MaintenanceLocation {
    private final LocationType type;
    private final UUID referenceId;

    private MaintenanceLocation(LocationType type, UUID referenceId) {
        this.type = Guard.notNull(type, "type");
        this.referenceId = Guard.notNull(referenceId, "referenceId");
    }
    public static MaintenanceLocation forUnit(UUID unitId) { return new MaintenanceLocation(LocationType.UNIT, unitId); }
    public static MaintenanceLocation forBuilding(UUID buildingId) { return new MaintenanceLocation(LocationType.BUILDING, buildingId); }
    public static MaintenanceLocation forCommonArea(UUID commonAreaId) { return new MaintenanceLocation(LocationType.COMMON_AREA, commonAreaId); }
    public static MaintenanceLocation forProperty(UUID propertyId) { return new MaintenanceLocation(LocationType.PROPERTY, propertyId); }

    public LocationType type() { return type; }
    public UUID referenceId() { return referenceId; }
    public boolean isPrivate() { return type == LocationType.UNIT; }
}
