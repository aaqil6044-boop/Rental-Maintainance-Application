package com.pmp.app;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class PropertyService {

    private final PropertyRepository properties;
    private final UnitRepository units;
    private final UnitAssignmentRepository assignments;

    public PropertyService(PropertyRepository properties, UnitRepository units,
                           UnitAssignmentRepository assignments) {
        this.properties = properties;
        this.units = units;
        this.assignments = assignments;
    }

    @Transactional(readOnly = true)
    public List<Dto.PropertyView> list(Account account) {
        List<Property> found = (account.getRole() == Role.MANAGER)
                ? properties.findByActiveTrueOrderByNameAsc()
                : properties.findByActiveTrueOrderByNameAsc();
        List<Dto.PropertyView> out = new ArrayList<>();
        for (Property p : found) {
            out.add(Views.property(p, units.findByPropertyIdAndActiveTrueOrderByLabelAsc(p.getId()).size()));
        }
        return out;
    }

    @Transactional
    public Dto.PropertyView create(Account account, Dto.CreatePropertyRequest req) {
        if (account.getRole() != Role.MANAGER) throw AppException.forbidden();
        String type = (req.propertyType() == null || req.propertyType().isBlank())
                ? "complex" : req.propertyType().trim();
        Property p = new Property(req.name().trim(),
                req.address() == null ? null : req.address().trim(), type, account);
        properties.save(p);
        return Views.property(p, 0);
    }

    @Transactional(readOnly = true)
    public List<Dto.UnitView> unitsOf(Account account, Long propertyId) {
        List<Dto.UnitView> out = new ArrayList<>();
        for (Unit u : units.findByPropertyIdAndActiveTrueOrderByLabelAsc(propertyId)) {
            out.add(Views.unit(u));
        }
        return out;
    }

    /** Units a tenant may report against. Managers get every unit. */
    @Transactional(readOnly = true)
    public List<Dto.UnitView> reportableUnits(Account account) {
        List<Dto.UnitView> out = new ArrayList<>();
        if (account.getRole() == Role.MANAGER) {
            for (Unit u : units.findAll()) {
                if (u.isActive()) out.add(Views.unit(u));
            }
        } else {
            for (UnitAssignment a : assignments.findByTenantId(account.getId())) {
                if (a.getUnit().isActive()) out.add(Views.unit(a.getUnit()));
            }
        }
        return out;
    }

    @Transactional
    public Dto.UnitView createUnit(Account account, Dto.CreateUnitRequest req) {
        if (account.getRole() != Role.MANAGER) throw AppException.forbidden();
        Property p = properties.findById(req.propertyId())
                .orElseThrow(() -> AppException.notFound("That property"));
        String label = req.label().trim();
        if (units.existsByPropertyIdAndLabelIgnoreCase(p.getId(), label)) {
            throw AppException.conflict("A unit called " + label + " already exists in this property.");
        }
        Unit u = new Unit(p, label);
        units.save(u);
        return Views.unit(u);
    }

    @Transactional
    public void assignTenant(Account account, Long tenantId, Long unitId, AccountRepository accounts) {
        if (account.getRole() != Role.MANAGER) throw AppException.forbidden();
        Account tenant = accounts.findById(tenantId)
                .orElseThrow(() -> AppException.notFound("That tenant"));
        Unit unit = units.findById(unitId)
                .orElseThrow(() -> AppException.notFound("That unit"));
        if (tenant.getRole() != Role.TENANT) {
            throw AppException.badRequest("Only a tenant account can be assigned to a unit.");
        }
        if (!assignments.existsByTenantIdAndUnitId(tenantId, unitId)) {
            assignments.save(new UnitAssignment(tenant, unit));
        }
    }
}
