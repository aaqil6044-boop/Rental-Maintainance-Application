package com.pmp.property.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record CreateUnitRequest(UUID buildingId, UUID floorId, @NotBlank String unitIdentifier) {}
