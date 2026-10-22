package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
public record CreateWorkOrderRequest(@NotBlank String trade, String scopeOfWork) {}
