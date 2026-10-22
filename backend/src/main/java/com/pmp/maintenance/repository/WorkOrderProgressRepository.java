package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.WorkOrderProgress;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface WorkOrderProgressRepository extends JpaRepository<WorkOrderProgress, UUID> {
    List<WorkOrderProgress> findByWorkOrderId(UUID workOrderId);
}
