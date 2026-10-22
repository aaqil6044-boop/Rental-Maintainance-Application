package com.pmp.occupancy.api.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;
public record CreateOwnershipRequest(@NotNull UUID unitId, @NotNull UUID ownerPartyId,
        @NotNull @Positive BigDecimal share, @NotNull LocalDate effectiveFrom) {}
