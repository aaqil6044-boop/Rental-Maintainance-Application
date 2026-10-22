package com.pmp.domain.occupancy;

import com.pmp.domain.shared.EffectivePeriod;
import com.pmp.domain.shared.Guard;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/** Aggregate root: legal ownership of a unit by a party, for a period. */
public class Ownership {
    private final UUID id;
    private final UUID unitId;
    private final UUID ownerPartyId;
    private final BigDecimal share; // 0..1
    private EffectivePeriod period;

    public Ownership(UUID unitId, UUID ownerPartyId, BigDecimal share, LocalDate from) {
        this.id = Guard.id();
        this.unitId = Guard.notNull(unitId, "unitId");
        this.ownerPartyId = Guard.notNull(ownerPartyId, "ownerPartyId");
        Guard.require(share != null && share.signum() > 0 && share.compareTo(BigDecimal.ONE) <= 0,
                "share must be within (0, 1]");
        this.share = share;
        this.period = EffectivePeriod.startingOn(from);
    }
    public UUID id() { return id; }
    public UUID unitId() { return unitId; }
    public BigDecimal share() { return share; }
    public boolean isActive() { return period.isActive(); }
    /** Ending ownership preserves the record (transfer = end one, start another). */
    public void endOn(LocalDate date) { this.period = period.endOn(date); }
}
