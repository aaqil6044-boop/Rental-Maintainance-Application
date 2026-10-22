package com.pmp.domain.identity;

import com.pmp.domain.shared.Guard;
import java.util.Objects;
import java.util.UUID;

/** Value object: the resource a permission applies to. */
public final class ResourceScope {
    private final ScopeType type;
    private final UUID resourceId;
    public ResourceScope(ScopeType type, UUID resourceId) {
        this.type = Guard.notNull(type, "type");
        this.resourceId = Guard.notNull(resourceId, "resourceId");
    }
    public ScopeType type() { return type; }
    public UUID resourceId() { return resourceId; }
    public boolean covers(ScopeType t, UUID id) { return type == t && resourceId.equals(id); }
    @Override public boolean equals(Object o) {
        return o instanceof ResourceScope r && type == r.type && resourceId.equals(r.resourceId);
    }
    @Override public int hashCode() { return Objects.hash(type, resourceId); }
}
