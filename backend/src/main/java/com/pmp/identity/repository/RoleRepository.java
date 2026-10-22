package com.pmp.identity.repository;

import com.pmp.identity.persistence.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RoleRepository extends JpaRepository<Role, UUID> {
    List<Role> findByOrganizationId(UUID organizationId);
}
