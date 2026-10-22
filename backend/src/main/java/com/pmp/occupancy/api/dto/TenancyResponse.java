package com.pmp.occupancy.api.dto;
import java.time.LocalDate;
import java.util.UUID;
public record TenancyResponse(UUID id, UUID unitId, UUID residentPartyId, String residentRole,
        LocalDate effectiveFrom, LocalDate effectiveTo) {}
