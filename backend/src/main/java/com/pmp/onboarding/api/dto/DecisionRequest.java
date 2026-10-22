package com.pmp.onboarding.api.dto;
import jakarta.validation.constraints.*;
public record DecisionRequest(@NotBlank String reason) {}
