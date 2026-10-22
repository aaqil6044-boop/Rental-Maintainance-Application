package com.pmp.property.api.dto;
import java.util.UUID;
public record PropertyResponse(UUID id, UUID organizationId, String name,
        String propertyType, String status) {}
