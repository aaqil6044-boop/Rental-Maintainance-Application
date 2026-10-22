package com.pmp.identity.api.dto;
import java.util.UUID;
public record UserResponse(UUID id, String email, String fullName, String status) {}
