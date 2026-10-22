package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
public record AddCommentRequest(@NotBlank String body) {}
