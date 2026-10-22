package com.pmp.property.api.dto;
import java.util.UUID;
public record UnitResponse(UUID id, UUID propertyId, UUID buildingId, UUID floorId,
        String unitIdentifier, String status) {}
