package com.pmp.property.persistence;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "property_floor")
public class Floor {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "building_id")
    private UUID buildingId;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "label")
    private String label;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getBuildingId() { return buildingId; }
    public void setBuildingId(UUID buildingId) { this.buildingId = buildingId; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public String getLabel() { return label; }
    public void setLabel(String label) { this.label = label; }
}
