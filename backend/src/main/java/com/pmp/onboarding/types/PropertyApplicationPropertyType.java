package com.pmp.onboarding.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum PropertyApplicationPropertyType {
    house, single_building, complex
}
