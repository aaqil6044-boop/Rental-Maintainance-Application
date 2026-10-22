package com.pmp.vendor.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum VendorStatus {
    draft, submitted, pending_verification, approved, active, rejected, suspended, inactive
}
