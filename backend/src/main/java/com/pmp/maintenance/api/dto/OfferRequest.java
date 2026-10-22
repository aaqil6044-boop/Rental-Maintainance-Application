package com.pmp.maintenance.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record OfferRequest(@NotNull UUID vendorId) {}
