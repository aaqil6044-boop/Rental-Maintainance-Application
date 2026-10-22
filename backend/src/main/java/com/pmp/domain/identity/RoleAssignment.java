package com.pmp.domain.identity;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** A role granted to a user within a resource scope. */
public final class RoleAssignment {
    private final UUID id;
    private final UUID userId;
    private final RoleName role;
    private final ResourceScope scope;

    public RoleAssignment(UUID userId, RoleName role, ResourceScope scope) {
        this.id = Guard.id();
        this.userId = Guard.notNull(userId, "userId");
        this.role = Guard.notNull(role, "role");
        this.scope = Guard.notNull(scope, "scope");
    }
    public UUID id() { return id; }
    public UUID userId() { return userId; }
    public RoleName role() { return role; }
    public ResourceScope scope() { return scope; }
    public boolean grants(ScopeType type, UUID resourceId) { return scope.covers(type, resourceId); }
}
