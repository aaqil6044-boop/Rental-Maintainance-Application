package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.WorkEvidence;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface WorkEvidenceRepository extends JpaRepository<WorkEvidence, UUID> {
    List<WorkEvidence> findByWorkOrderId(UUID workOrderId);
}
