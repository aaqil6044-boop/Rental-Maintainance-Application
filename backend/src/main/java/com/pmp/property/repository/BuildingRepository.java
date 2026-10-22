package com.pmp.property.repository;

import com.pmp.property.persistence.Building;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface BuildingRepository extends JpaRepository<Building, UUID> {
    List<Building> findByOrganizationId(UUID organizationId);
    List<Building> findByPropertyId(UUID propertyId);
}
