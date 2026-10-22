package com.pmp.identity.repository;

import com.pmp.identity.persistence.RoleAssignment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RoleAssignmentRepository extends JpaRepository<RoleAssignment, UUID> {
    List<RoleAssignment> findByMembershipId(UUID membershipId);
}
