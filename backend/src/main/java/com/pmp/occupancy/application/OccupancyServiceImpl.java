package com.pmp.occupancy.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.occupancy.api.OccupancyService;
import com.pmp.occupancy.api.dto.*;
import com.pmp.occupancy.persistence.*;
import com.pmp.occupancy.repository.*;
import com.pmp.occupancy.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class OccupancyServiceImpl implements OccupancyService {

    private final OwnershipRepository ownerships;
    private final TenancyRepository tenancies;

    public OccupancyServiceImpl(OwnershipRepository ownerships, TenancyRepository tenancies) {
        this.ownerships = ownerships; this.tenancies = tenancies;
    }

    @Override @Transactional
    public OwnershipResponse startOwnership(CreateOwnershipRequest r) {
        Ownership o = new Ownership();
        o.setId(UUID.randomUUID());
        // organizationId is resolved from the unit in production.
        o.setUnitId(r.unitId());
        o.setOwnerPartyId(r.ownerPartyId());
        o.setShare(r.share());
        o.setEffectiveFrom(r.effectiveFrom());
        o.setCreatedAt(Instant.now());
        return toResponse(ownerships.save(o));
    }
    @Override @Transactional
    public void endOwnership(UUID ownershipId, EndDateRequest r) {
        Ownership o = ownerships.findById(ownershipId)
                .orElseThrow(() -> new NotFoundException("ownership " + ownershipId + " not found"));
        o.setEffectiveTo(r.endDate()); ownerships.save(o);
    }
    @Override @Transactional
    public List<OwnershipResponse> listOwnerships(UUID unitId) {
        return ownerships.findByUnitId(unitId).stream().map(OccupancyServiceImpl::toResponse).toList();
    }

    @Override @Transactional
    public TenancyResponse startTenancy(CreateTenancyRequest r) {
        Tenancy t = new Tenancy();
        t.setId(UUID.randomUUID());
        t.setUnitId(r.unitId());
        t.setResidentPartyId(r.residentPartyId());
        t.setResidentRole(TenancyResidentRole.valueOf(r.residentRole()));
        t.setEffectiveFrom(r.effectiveFrom());
        t.setCreatedAt(Instant.now());
        return toResponse(tenancies.save(t));
    }
    @Override @Transactional
    public void endTenancy(UUID tenancyId, EndDateRequest r) {
        Tenancy t = tenancies.findById(tenancyId)
                .orElseThrow(() -> new NotFoundException("tenancy " + tenancyId + " not found"));
        t.setEffectiveTo(r.endDate()); tenancies.save(t);
    }
    @Override @Transactional
    public List<TenancyResponse> listTenancies(UUID unitId) {
        return tenancies.findByUnitId(unitId).stream().map(OccupancyServiceImpl::toResponse).toList();
    }

    private static OwnershipResponse toResponse(Ownership o) {
        return new OwnershipResponse(o.getId(), o.getUnitId(), o.getOwnerPartyId(), o.getShare(),
                o.getEffectiveFrom(), o.getEffectiveTo());
    }
    private static TenancyResponse toResponse(Tenancy t) {
        return new TenancyResponse(t.getId(), t.getUnitId(), t.getResidentPartyId(),
                t.getResidentRole() == null ? null : t.getResidentRole().name(),
                t.getEffectiveFrom(), t.getEffectiveTo());
    }
}
