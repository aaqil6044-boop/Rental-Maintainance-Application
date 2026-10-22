package com.pmp.identity.persistence;

import jakarta.persistence.*;
import java.util.UUID;

@Entity
@Table(name = "identity_permission")
public class Permission {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "role_id")
    private UUID roleId;

    @Column(name = "action")
    private String action;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getRoleId() { return roleId; }
    public void setRoleId(UUID roleId) { this.roleId = roleId; }
    public String getAction() { return action; }
    public void setAction(String action) { this.action = action; }
}
