package com.pmp.identity.repository;

import com.pmp.identity.persistence.ResourceScope;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ResourceScopeRepository extends JpaRepository<ResourceScope, UUID> {
    List<ResourceScope> findByOrganizationId(UUID organizationId);
}
