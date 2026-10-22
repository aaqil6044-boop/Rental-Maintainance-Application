package com.pmp.property.api.dto;
import jakarta.validation.constraints.*;
public record CreateBuildingRequest(@NotBlank String name) {}
