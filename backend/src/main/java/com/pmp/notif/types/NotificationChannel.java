package com.pmp.notif.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum NotificationChannel {
    push, email, in_app
}
