package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
public record AddMediaRequest(@NotBlank String fileRef, @NotBlank String mediaType) {}
