package com.pmp.notifications.api.dto;
import jakarta.validation.constraints.*;
public record PreferenceRequest(@NotBlank String channel, boolean enabled) {}
