package com.pmp.identity.persistence;

import jakarta.persistence.*;
import java.util.UUID;
import com.pmp.identity.types.*;

@Entity
@Table(name = "identity_resource_scope")
public class ResourceScope {

    @Id
    @Column(name = "id")
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "scope_type")
    private ResourceScopeScopeType scopeType;

    @Column(name = "resource_id")
    private UUID resourceId;

    @Column(name = "organization_id")
    private UUID organizationId;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public ResourceScopeScopeType getScopeType() { return scopeType; }
    public void setScopeType(ResourceScopeScopeType scopeType) { this.scopeType = scopeType; }
    public UUID getResourceId() { return resourceId; }
    public void setResourceId(UUID resourceId) { this.resourceId = resourceId; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
}
