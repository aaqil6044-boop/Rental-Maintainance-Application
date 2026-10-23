package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface UnitRepository extends JpaRepository<Unit, Long> {
    List<Unit> findByPropertyIdAndActiveTrueOrderByLabelAsc(Long propertyId);
    Optional<Unit> findByPropertyIdAndLabelIgnoreCase(Long propertyId, String label);
    boolean existsByPropertyIdAndLabelIgnoreCase(Long propertyId, String label);
}
