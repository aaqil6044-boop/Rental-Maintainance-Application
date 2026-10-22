package com.pmp.onboarding.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record SubmitApplicationRequest(@NotNull UUID organizationId, @NotBlank String propertyName,
        @NotBlank String propertyType, String addressLine, String city, String region,
        String postalCode, String country) {}
