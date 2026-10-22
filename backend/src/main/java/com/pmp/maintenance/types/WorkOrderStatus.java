package com.pmp.maintenance.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum WorkOrderStatus {
    created, offered, accepted, rejected, in_progress, awaiting_parts, awaiting_approval, completed, verified, cancelled, reassigned
}
