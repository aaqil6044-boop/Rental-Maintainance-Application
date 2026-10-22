package com.pmp.occupancy.api.dto;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
import java.util.UUID;
public record CreateTenancyRequest(@NotNull UUID unitId, @NotNull UUID residentPartyId,
        @NotBlank String residentRole, @NotNull LocalDate effectiveFrom) {}
