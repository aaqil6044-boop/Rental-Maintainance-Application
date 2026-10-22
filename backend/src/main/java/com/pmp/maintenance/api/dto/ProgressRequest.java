package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
public record ProgressRequest(@NotBlank String statusNote) {}
