package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface UnitAssignmentRepository extends JpaRepository<UnitAssignment, Long> {
    List<UnitAssignment> findByTenantId(Long tenantId);
    boolean existsByTenantIdAndUnitId(Long tenantId, Long unitId);
}
