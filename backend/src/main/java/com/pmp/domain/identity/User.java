package com.pmp.domain.identity;

import com.pmp.domain.shared.Guard;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Aggregate root: a login account that may hold several scoped roles. */
public class User {
    public enum Status { INVITED, ACTIVE, DISABLED }
    private final UUID id;
    private final String email;
    private String fullName;
    private Status status = Status.INVITED;
    private final List<RoleAssignment> roles = new ArrayList<>();

    public User(String email, String fullName) {
        this.id = Guard.id();
        this.email = Guard.notBlank(email, "email");
        this.fullName = fullName;
    }
    public UUID id() { return id; }
    public String email() { return email; }
    public Status status() { return status; }
    public void activate() { this.status = Status.ACTIVE; }
    public void disable() { this.status = Status.DISABLED; }

    public void assign(RoleAssignment assignment) {
        Guard.require(status != Status.DISABLED, "disabled user cannot be granted roles");
        roles.add(Guard.notNull(assignment, "assignment"));
    }
    public void revoke(UUID assignmentId) { roles.removeIf(r -> r.id().equals(assignmentId)); }

    /** Resource-level authorization: a grant must match the target scope exactly. */
    public boolean canActOn(ScopeType type, UUID resourceId) {
        return status == Status.ACTIVE && roles.stream().anyMatch(r -> r.grants(type, resourceId));
    }
    public List<RoleAssignment> roles() { return List.copyOf(roles); }
}
