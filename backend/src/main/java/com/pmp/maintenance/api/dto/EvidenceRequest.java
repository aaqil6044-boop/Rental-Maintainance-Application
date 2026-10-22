package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
public record EvidenceRequest(@NotBlank String fileRef, String note) {}
