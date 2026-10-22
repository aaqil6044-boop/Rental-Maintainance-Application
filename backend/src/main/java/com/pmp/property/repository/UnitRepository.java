package com.pmp.property.repository;

import com.pmp.property.persistence.Unit;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface UnitRepository extends JpaRepository<Unit, UUID> {
    List<Unit> findByOrganizationId(UUID organizationId);
    List<Unit> findByPropertyId(UUID propertyId);
    List<Unit> findByBuildingId(UUID buildingId);
    List<Unit> findByFloorId(UUID floorId);
}
