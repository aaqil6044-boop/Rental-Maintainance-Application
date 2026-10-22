package com.pmp.occupancy.repository;

import com.pmp.occupancy.persistence.Party;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface PartyRepository extends JpaRepository<Party, UUID> {
    List<Party> findByOrganizationId(UUID organizationId);
    List<Party> findByUserId(UUID userId);
}
