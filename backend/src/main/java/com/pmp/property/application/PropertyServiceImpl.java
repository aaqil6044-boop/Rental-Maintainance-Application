package com.pmp.property.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.domain.shared.DomainException;
import com.pmp.property.api.PropertyService;
import com.pmp.property.api.dto.*;
import com.pmp.property.persistence.*;
import com.pmp.property.repository.*;
import com.pmp.property.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class PropertyServiceImpl implements PropertyService {

    private final PropertyRepository properties;
    private final BuildingRepository buildings;
    private final UnitRepository units;

    public PropertyServiceImpl(PropertyRepository properties, BuildingRepository buildings, UnitRepository units) {
        this.properties = properties; this.buildings = buildings; this.units = units;
    }

    @Override @Transactional
    public PropertyResponse create(CreatePropertyRequest r) {
        Property p = new Property();
        p.setId(UUID.randomUUID());
        p.setOrganizationId(r.organizationId());
        p.setName(r.name());
        p.setPropertyType(PropertyPropertyType.valueOf(r.propertyType()));
        p.setAddressLine(r.addressLine());
        p.setCity(r.city());
        p.setRegion(r.region());
        p.setPostalCode(r.postalCode());
        p.setCountry(r.country());
        p.setStatus(PropertyStatus.draft);
        p.setCreatedAt(Instant.now());
        p.setUpdatedAt(Instant.now());
        return toResponse(properties.save(p));
    }

    @Override @Transactional
    public PropertyResponse get(UUID id) { return toResponse(load(id)); }

    @Override @Transactional
    public List<PropertyResponse> listByOrganization(UUID organizationId) {
        return properties.findByOrganizationId(organizationId).stream().map(PropertyServiceImpl::toResponse).toList();
    }

    @Override @Transactional
    public void activate(UUID id) {
        Property p = load(id);
        if (p.getStatus() != PropertyStatus.draft && p.getStatus() != PropertyStatus.suspended)
            throw new DomainException("cannot activate from " + p.getStatus());
        p.setStatus(PropertyStatus.active); touch(p);
    }
    @Override @Transactional
    public void suspend(UUID id) {
        Property p = load(id);
        if (p.getStatus() != PropertyStatus.active) throw new DomainException("only an active property can be suspended");
        p.setStatus(PropertyStatus.suspended); touch(p);
    }
    @Override @Transactional
    public void deactivate(UUID id) { Property p = load(id); p.setStatus(PropertyStatus.deactivated); touch(p); }

    @Override @Transactional
    public BuildingResponse addBuilding(UUID propertyId, CreateBuildingRequest r) {
        Property p = load(propertyId);
        Building b = new Building();
        b.setId(UUID.randomUUID());
        b.setPropertyId(p.getId());
        b.setOrganizationId(p.getOrganizationId());
        b.setName(r.name());
        b.setStatus(BuildingStatus.active);
        buildings.save(b);
        return new BuildingResponse(b.getId(), b.getPropertyId(), b.getName(), b.getStatus().name());
    }

    @Override @Transactional
    public UnitResponse addUnit(UUID propertyId, CreateUnitRequest r) {
        Property p = load(propertyId);
        return toResponse(saveUnit(p, r.buildingId(), r.floorId(), r.unitIdentifier()));
    }

    @Override @Transactional
    public List<UnitResponse> bulkAddUnits(UUID propertyId, BulkCreateUnitsRequest r) {
        Property p = load(propertyId);
        return r.unitIdentifiers().stream()
                .map(uid -> toResponse(saveUnit(p, r.buildingId(), r.floorId(), uid)))
                .toList();
    }

    @Override @Transactional
    public List<UnitResponse> listUnits(UUID propertyId) {
        return units.findByPropertyId(propertyId).stream().map(PropertyServiceImpl::toResponse).toList();
    }

    private Unit saveUnit(Property p, UUID buildingId, UUID floorId, String identifier) {
        Unit u = new Unit();
        u.setId(UUID.randomUUID());
        u.setOrganizationId(p.getOrganizationId());
        u.setPropertyId(p.getId());
        u.setBuildingId(buildingId);
        u.setFloorId(floorId);
        u.setUnitIdentifier(identifier);
        u.setStatus(UnitStatus.active);
        u.setCreatedAt(Instant.now());
        u.setUpdatedAt(Instant.now());
        return units.save(u);
    }
    private Property load(UUID id) {
        return properties.findById(id).orElseThrow(() -> new NotFoundException("property " + id + " not found"));
    }
    private void touch(Property p) { p.setUpdatedAt(Instant.now()); properties.save(p); }
    private static PropertyResponse toResponse(Property p) {
        return new PropertyResponse(p.getId(), p.getOrganizationId(), p.getName(),
                p.getPropertyType() == null ? null : p.getPropertyType().name(),
                p.getStatus() == null ? null : p.getStatus().name());
    }
    private static UnitResponse toResponse(Unit u) {
        return new UnitResponse(u.getId(), u.getPropertyId(), u.getBuildingId(), u.getFloorId(),
                u.getUnitIdentifier(), u.getStatus() == null ? null : u.getStatus().name());
    }
}
