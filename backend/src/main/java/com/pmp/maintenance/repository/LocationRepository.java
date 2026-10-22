package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.Location;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface LocationRepository extends JpaRepository<Location, UUID> {
    List<Location> findByPropertyId(UUID propertyId);
    List<Location> findByBuildingId(UUID buildingId);
    List<Location> findByUnitId(UUID unitId);
}
