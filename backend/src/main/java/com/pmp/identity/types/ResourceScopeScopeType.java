package com.pmp.identity.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum ResourceScopeScopeType {
    organization, property, building, unit, work_order
}
