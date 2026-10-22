package com.pmp.security.api.dto;
import jakarta.validation.constraints.*;
public record RegisterRequest(@NotBlank @Email String email, String fullName, @NotBlank String password) {}
