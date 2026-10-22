package com.pmp.identity.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum RoleName {
    super_admin, org_admin, approver, property_manager, owner, tenant, vendor
}
