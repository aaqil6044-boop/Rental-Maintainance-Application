package com.pmp.security.api.dto;
import jakarta.validation.constraints.*;
public record LoginRequest(@NotBlank String email, @NotBlank String password) {}
