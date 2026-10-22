package com.pmp.property.persistence;

import jakarta.persistence.*;
import java.util.UUID;
import com.pmp.property.types.*;

@Entity
@Table(name = "property_building")
public class Building {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "property_id")
    private UUID propertyId;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "name")
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(name = "status")
    private BuildingStatus status;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getPropertyId() { return propertyId; }
    public void setPropertyId(UUID propertyId) { this.propertyId = propertyId; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public BuildingStatus getStatus() { return status; }
    public void setStatus(BuildingStatus status) { this.status = status; }
}
