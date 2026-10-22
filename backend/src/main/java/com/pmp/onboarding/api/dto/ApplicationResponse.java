package com.pmp.onboarding.api.dto;
import java.util.UUID;
public record ApplicationResponse(UUID id, UUID organizationId, String propertyName,
        String status, UUID createdPropertyId) {}
