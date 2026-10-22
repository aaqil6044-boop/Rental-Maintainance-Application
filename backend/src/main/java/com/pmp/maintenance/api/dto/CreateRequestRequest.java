package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record CreateRequestRequest(@NotNull UUID organizationId, @NotBlank String locationType,
        @NotNull UUID locationReferenceId, UUID reporterPartyId, @NotBlank String title,
        String description, UUID categoryId, String priority, String urgency) {}
