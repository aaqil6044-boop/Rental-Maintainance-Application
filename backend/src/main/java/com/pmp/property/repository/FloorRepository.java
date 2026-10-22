package com.pmp.property.repository;

import com.pmp.property.persistence.Floor;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface FloorRepository extends JpaRepository<Floor, UUID> {
    List<Floor> findByOrganizationId(UUID organizationId);
    List<Floor> findByBuildingId(UUID buildingId);
}
