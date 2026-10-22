package com.pmp.occupancy.api.dto;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;
public record OwnershipResponse(UUID id, UUID unitId, UUID ownerPartyId, BigDecimal share,
        LocalDate effectiveFrom, LocalDate effectiveTo) {}
