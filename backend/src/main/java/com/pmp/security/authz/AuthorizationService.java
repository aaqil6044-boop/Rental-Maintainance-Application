package com.pmp.security.authz;

import com.pmp.identity.repository.*;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Resource-level authorization: does a user hold a role whose scope covers a given
 * resource? Services call this before returning or mutating scoped data, enforcing
 * the privacy / multi-tenancy rules (owner sees only own units, vendor only assigned
 * work orders, etc.). Backed by the identity data layer.
 */
@Service
public class AuthorizationService {

    private final OrganizationMembershipRepository memberships;
    private final RoleAssignmentRepository assignments;
    private final ResourceScopeRepository scopes;

    public AuthorizationService(OrganizationMembershipRepository memberships,
                                RoleAssignmentRepository assignments, ResourceScopeRepository scopes) {
        this.memberships = memberships; this.assignments = assignments; this.scopes = scopes;
    }

    /** True if the user has any role assignment whose scope matches (scopeType, resourceId). */
    public boolean hasScope(UUID userId, String scopeType, UUID resourceId) {
        return memberships.findByUserId(userId).stream()
                .flatMap(m -> assignments.findByMembershipId(m.getId()).stream())
                .map(ra -> scopes.findById(ra.getScopeId()).orElse(null))
                .filter(s -> s != null)
                .anyMatch(s -> s.getScopeType() != null
                        && s.getScopeType().name().equals(scopeType)
                        && resourceId.equals(s.getResourceId()));
    }

    public void requireScope(UUID userId, String scopeType, UUID resourceId) {
        if (!hasScope(userId, scopeType, resourceId))
            throw new org.springframework.security.access.AccessDeniedException(
                    "not authorized for " + scopeType + " " + resourceId);
    }
}
