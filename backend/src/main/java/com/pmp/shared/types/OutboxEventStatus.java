package com.pmp.shared.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum OutboxEventStatus {
    pending, dispatched, failed
}
