package com.pmp.domain.occupancy;

import com.pmp.domain.shared.EffectivePeriod;
import com.pmp.domain.shared.Guard;
import java.time.LocalDate;
import java.util.UUID;

/** Aggregate root: physical occupancy of a unit by a resident, for a period. */
public class Tenancy {
    private final UUID id;
    private final UUID unitId;
    private final UUID residentPartyId;
    private final ResidentRole role;
    private EffectivePeriod period;

    public Tenancy(UUID unitId, UUID residentPartyId, ResidentRole role, LocalDate from) {
        this.id = Guard.id();
        this.unitId = Guard.notNull(unitId, "unitId");
        this.residentPartyId = Guard.notNull(residentPartyId, "residentPartyId");
        this.role = Guard.notNull(role, "role");
        this.period = EffectivePeriod.startingOn(from);
    }
    public UUID id() { return id; }
    public UUID unitId() { return unitId; }
    public boolean isActive() { return period.isActive(); }
    public void moveOut(LocalDate date) { this.period = period.endOn(date); }
}
