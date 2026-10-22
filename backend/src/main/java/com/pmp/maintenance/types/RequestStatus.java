package com.pmp.maintenance.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum RequestStatus {
    reported, under_review, in_progress, on_hold, work_completed, verified, closed, reopened, escalated, rejected
}
