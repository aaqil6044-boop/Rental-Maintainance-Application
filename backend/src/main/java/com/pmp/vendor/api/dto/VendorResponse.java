package com.pmp.vendor.api.dto;
import java.util.UUID;
public record VendorResponse(UUID id, UUID organizationId, String name, String vendorType, String status) {}
