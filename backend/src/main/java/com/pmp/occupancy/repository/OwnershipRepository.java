package com.pmp.occupancy.repository;

import com.pmp.occupancy.persistence.Ownership;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface OwnershipRepository extends JpaRepository<Ownership, UUID> {
    List<Ownership> findByOrganizationId(UUID organizationId);
    List<Ownership> findByUnitId(UUID unitId);
    List<Ownership> findByOwnerPartyId(UUID ownerPartyId);
}
