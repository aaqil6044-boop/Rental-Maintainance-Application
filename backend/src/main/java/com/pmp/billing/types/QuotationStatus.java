package com.pmp.billing.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum QuotationStatus {
    submitted, approved, rejected, escalated
}
