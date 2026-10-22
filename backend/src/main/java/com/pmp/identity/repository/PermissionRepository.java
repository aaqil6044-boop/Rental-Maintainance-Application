package com.pmp.identity.repository;

import com.pmp.identity.persistence.Permission;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.UUID;

public interface PermissionRepository extends JpaRepository<Permission, UUID> {
}
