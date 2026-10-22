package com.pmp.vendor.api.dto;
import jakarta.validation.constraints.*;
import java.util.UUID;
public record RegisterVendorRequest(@NotNull UUID organizationId, @NotBlank String name,
        @NotBlank String vendorType) {}
