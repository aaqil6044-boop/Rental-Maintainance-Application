package com.pmp.identity.persistence;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "identity_role_assignment")
public class RoleAssignment {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "membership_id")
    private UUID membershipId;

    @Column(name = "role_id")
    private UUID roleId;

    @Column(name = "scope_id")
    private UUID scopeId;

    @Column(name = "granted_at")
    private Instant grantedAt;

    @Column(name = "granted_by")
    private UUID grantedBy;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getMembershipId() { return membershipId; }
    public void setMembershipId(UUID membershipId) { this.membershipId = membershipId; }
    public UUID getRoleId() { return roleId; }
    public void setRoleId(UUID roleId) { this.roleId = roleId; }
    public UUID getScopeId() { return scopeId; }
    public void setScopeId(UUID scopeId) { this.scopeId = scopeId; }
    public Instant getGrantedAt() { return grantedAt; }
    public void setGrantedAt(Instant grantedAt) { this.grantedAt = grantedAt; }
    public UUID getGrantedBy() { return grantedBy; }
    public void setGrantedBy(UUID grantedBy) { this.grantedBy = grantedBy; }
}
