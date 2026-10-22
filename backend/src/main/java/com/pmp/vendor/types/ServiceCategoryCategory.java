package com.pmp.vendor.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum ServiceCategoryCategory {
    plumbing, electrical, carpentry, painting, ac, appliance, cleaning, general
}
