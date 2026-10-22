package com.pmp.vendor.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum TechnicianStatus {
    active, inactive
}
