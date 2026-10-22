package com.pmp.property.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record CreatePropertyRequest(@NotNull UUID organizationId, @NotBlank String name,
        @NotBlank String propertyType, String addressLine, String city,
        String region, String postalCode, String country) {}
