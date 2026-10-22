package com.pmp.property.api.dto;
import java.util.UUID;
public record BuildingResponse(UUID id, UUID propertyId, String name, String status) {}
