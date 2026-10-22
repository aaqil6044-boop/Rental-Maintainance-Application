package com.pmp.occupancy.repository;

import com.pmp.occupancy.persistence.Tenancy;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface TenancyRepository extends JpaRepository<Tenancy, UUID> {
    List<Tenancy> findByOrganizationId(UUID organizationId);
    List<Tenancy> findByUnitId(UUID unitId);
    List<Tenancy> findByResidentPartyId(UUID residentPartyId);
}
