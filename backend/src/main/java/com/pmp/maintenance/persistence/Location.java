package com.pmp.maintenance.persistence;

import jakarta.persistence.*;
import java.util.UUID;
import com.pmp.maintenance.types.*;

@Entity
@Table(name = "maintenance_location")
public class Location {

    @Id
    @Column(name = "id")
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "location_type")
    private LocationLocationType locationType;

    @Column(name = "unit_id")
    private UUID unitId;

    @Column(name = "building_id")
    private UUID buildingId;

    @Column(name = "common_area_id")
    private UUID commonAreaId;

    @Column(name = "property_id")
    private UUID propertyId;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public LocationLocationType getLocationType() { return locationType; }
    public void setLocationType(LocationLocationType locationType) { this.locationType = locationType; }
    public UUID getUnitId() { return unitId; }
    public void setUnitId(UUID unitId) { this.unitId = unitId; }
    public UUID getBuildingId() { return buildingId; }
    public void setBuildingId(UUID buildingId) { this.buildingId = buildingId; }
    public UUID getCommonAreaId() { return commonAreaId; }
    public void setCommonAreaId(UUID commonAreaId) { this.commonAreaId = commonAreaId; }
    public UUID getPropertyId() { return propertyId; }
    public void setPropertyId(UUID propertyId) { this.propertyId = propertyId; }
}
