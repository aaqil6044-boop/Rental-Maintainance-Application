package com.pmp.identity.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.identity.api.IdentityService;
import com.pmp.identity.api.dto.*;
import com.pmp.identity.persistence.*;
import com.pmp.identity.repository.*;
import com.pmp.identity.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.UUID;

@Service
public class IdentityServiceImpl implements IdentityService {

    private final AppUserRepository users;
    private final RoleRepository roles;
    private final ResourceScopeRepository scopes;
    private final RoleAssignmentRepository assignments;

    public IdentityServiceImpl(AppUserRepository users, RoleRepository roles,
                               ResourceScopeRepository scopes, RoleAssignmentRepository assignments) {
        this.users = users; this.roles = roles; this.scopes = scopes; this.assignments = assignments;
    }

    @Override @Transactional
    public UserResponse invite(InviteUserRequest r) {
        AppUser u = new AppUser();
        u.setId(UUID.randomUUID());
        u.setEmail(r.email());
        u.setFullName(r.fullName());
        u.setStatus(AppUserStatus.invited);
        u.setCreatedAt(Instant.now());
        u.setUpdatedAt(Instant.now());
        return toResponse(users.save(u));
    }

    @Override @Transactional
    public UserResponse get(UUID userId) { return toResponse(load(userId)); }

    @Override @Transactional
    public void activate(UUID userId) { AppUser u = load(userId); u.setStatus(AppUserStatus.active); users.save(u); }

    @Override @Transactional
    public void disable(UUID userId) { AppUser u = load(userId); u.setStatus(AppUserStatus.disabled); users.save(u); }

    @Override @Transactional
    public void assignRole(AssignRoleRequest r) {
        // Simplified wiring: in production the role is resolved from the catalogue and
        // membershipId from the user's organization membership.
        Role role = new Role();
        role.setId(UUID.randomUUID());
        role.setName(RoleName.valueOf(r.role()));
        roles.save(role);

        ResourceScope scope = new ResourceScope();
        scope.setId(UUID.randomUUID());
        scope.setScopeType(ResourceScopeScopeType.valueOf(r.scopeType()));
        scope.setResourceId(r.resourceId());
        scopes.save(scope);

        RoleAssignment ra = new RoleAssignment();
        ra.setId(UUID.randomUUID());
        ra.setMembershipId(r.userId());
        ra.setRoleId(role.getId());
        ra.setScopeId(scope.getId());
        ra.setGrantedAt(Instant.now());
        assignments.save(ra);
    }

    @Override @Transactional
    public void revokeRole(UUID assignmentId) { assignments.deleteById(assignmentId); }

    private AppUser load(UUID id) {
        return users.findById(id).orElseThrow(() -> new NotFoundException("user " + id + " not found"));
    }
    private static UserResponse toResponse(AppUser u) {
        return new UserResponse(u.getId(), u.getEmail(), u.getFullName(),
                u.getStatus() == null ? null : u.getStatus().name());
    }
}
