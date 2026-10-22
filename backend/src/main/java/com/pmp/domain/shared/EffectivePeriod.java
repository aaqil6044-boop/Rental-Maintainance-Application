package com.pmp.domain.shared;

import java.time.LocalDate;

/** A date range; a null end means currently open. */
public final class EffectivePeriod {
    private final LocalDate from;
    private final LocalDate to; // nullable

    public EffectivePeriod(LocalDate from, LocalDate to) {
        Guard.notNull(from, "from");
        Guard.require(to == null || !to.isBefore(from), "end must not precede start");
        this.from = from;
        this.to = to;
    }
    public static EffectivePeriod startingOn(LocalDate from) { return new EffectivePeriod(from, null); }
    public LocalDate from() { return from; }
    public LocalDate to() { return to; }
    public boolean isActive() { return to == null; }
    public EffectivePeriod endOn(LocalDate end) { return new EffectivePeriod(from, end); }
    public boolean overlaps(EffectivePeriod other) {
        LocalDate aEnd = to == null ? LocalDate.MAX : to;
        LocalDate bEnd = other.to == null ? LocalDate.MAX : other.to;
        return !from.isAfter(bEnd) && !other.from.isAfter(aEnd);
    }
}
