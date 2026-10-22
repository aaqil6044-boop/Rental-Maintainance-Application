package com.pmp.billing.repository;

import com.pmp.billing.persistence.WorkAuthorization;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface WorkAuthorizationRepository extends JpaRepository<WorkAuthorization, UUID> {
    List<WorkAuthorization> findByOrganizationId(UUID organizationId);
    List<WorkAuthorization> findByWorkOrderId(UUID workOrderId);
}
