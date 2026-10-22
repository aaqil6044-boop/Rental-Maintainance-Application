package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.WorkOrder;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface WorkOrderRepository extends JpaRepository<WorkOrder, UUID> {
    List<WorkOrder> findByOrganizationId(UUID organizationId);
    List<WorkOrder> findByRequestId(UUID requestId);
    List<WorkOrder> findByVendorId(UUID vendorId);
}
