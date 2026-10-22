package com.pmp.maintenance.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum LocationLocationType {
    unit, building, common_area, property
}
