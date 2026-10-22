package com.pmp.identity.persistence;

import jakarta.persistence.*;
import java.util.UUID;
import com.pmp.identity.types.*;

@Entity
@Table(name = "identity_role")
public class Role {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "name")
    private RoleName name;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public RoleName getName() { return name; }
    public void setName(RoleName name) { this.name = name; }
}
