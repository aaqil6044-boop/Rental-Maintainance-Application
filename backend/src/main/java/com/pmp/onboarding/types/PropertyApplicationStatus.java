package com.pmp.onboarding.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum PropertyApplicationStatus {
    draft, submitted, under_review, more_info, approved, rejected, withdrawn
}
