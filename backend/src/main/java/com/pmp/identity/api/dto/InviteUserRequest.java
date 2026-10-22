package com.pmp.identity.api.dto;
import jakarta.validation.constraints.*;
public record InviteUserRequest(@NotBlank String email, String fullName) {}
