package com.pmp.occupancy.persistence;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import com.pmp.occupancy.types.*;

@Entity
@Table(name = "occupancy_tenancy")
public class Tenancy {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "unit_id")
    private UUID unitId;

    @Column(name = "resident_party_id")
    private UUID residentPartyId;

    @Enumerated(EnumType.STRING)
    @Column(name = "resident_role")
    private TenancyResidentRole residentRole;

    @Column(name = "effective_from")
    private LocalDate effectiveFrom;

    @Column(name = "effective_to")
    private LocalDate effectiveTo;

    @Column(name = "created_at")
    private Instant createdAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public UUID getUnitId() { return unitId; }
    public void setUnitId(UUID unitId) { this.unitId = unitId; }
    public UUID getResidentPartyId() { return residentPartyId; }
    public void setResidentPartyId(UUID residentPartyId) { this.residentPartyId = residentPartyId; }
    public TenancyResidentRole getResidentRole() { return residentRole; }
    public void setResidentRole(TenancyResidentRole residentRole) { this.residentRole = residentRole; }
    public LocalDate getEffectiveFrom() { return effectiveFrom; }
    public void setEffectiveFrom(LocalDate effectiveFrom) { this.effectiveFrom = effectiveFrom; }
    public LocalDate getEffectiveTo() { return effectiveTo; }
    public void setEffectiveTo(LocalDate effectiveTo) { this.effectiveTo = effectiveTo; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
