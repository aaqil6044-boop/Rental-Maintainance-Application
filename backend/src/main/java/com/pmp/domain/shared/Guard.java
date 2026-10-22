package com.pmp.domain.shared;

import java.util.UUID;

public final class Guard {
    private Guard() {}
    public static void require(boolean condition, String message) {
        if (!condition) throw new DomainException(message);
    }
    public static <T> T notNull(T value, String name) {
        if (value == null) throw new DomainException(name + " must not be null");
        return value;
    }
    public static String notBlank(String value, String name) {
        if (value == null || value.isBlank()) throw new DomainException(name + " must not be blank");
        return value;
    }
    public static UUID id() { return UUID.randomUUID(); }
}
