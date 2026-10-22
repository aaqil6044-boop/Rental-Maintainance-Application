package com.pmp.property.api.dto;
import jakarta.validation.constraints.*;
import java.util.List;
import java.util.UUID;
public record BulkCreateUnitsRequest(UUID buildingId, UUID floorId,
        @NotEmpty List<@NotBlank String> unitIdentifiers) {}
