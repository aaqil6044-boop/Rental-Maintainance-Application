package com.pmp.domain.occupancy;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** An owner or resident; linked to a login (userId) only when they have one. */
public class Party {
    public enum Type { INDIVIDUAL, COMPANY }
    private final UUID id;
    private final UUID organizationId;
    private UUID userId; // nullable
    private String fullName;
    private final Type type;
    public Party(UUID organizationId, String fullName, Type type) {
        this.id = Guard.id();
        this.organizationId = Guard.notNull(organizationId, "organizationId");
        this.fullName = fullName;
        this.type = Guard.notNull(type, "type");
    }
    public UUID id() { return id; }
    public void linkUser(UUID userId) { this.userId = userId; }
    public UUID userId() { return userId; }
}
