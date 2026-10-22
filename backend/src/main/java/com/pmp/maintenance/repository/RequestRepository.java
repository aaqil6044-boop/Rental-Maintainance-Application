package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.Request;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequestRepository extends JpaRepository<Request, UUID> {
    List<Request> findByOrganizationId(UUID organizationId);
}
