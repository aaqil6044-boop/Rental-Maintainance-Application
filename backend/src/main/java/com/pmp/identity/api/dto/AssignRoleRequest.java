package com.pmp.identity.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record AssignRoleRequest(@NotNull UUID userId, @NotBlank String role,
                                @NotBlank String scopeType, @NotNull UUID resourceId) {}
