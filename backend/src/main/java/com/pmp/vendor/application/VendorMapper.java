package com.pmp.vendor.application;

import com.pmp.vendor.persistence.Vendor;
import com.pmp.vendor.api.dto.VendorResponse;

/** Maps the persistence entity to the transport DTO. */
final class VendorMapper {
    private VendorMapper() {}
    static VendorResponse toResponse(Vendor e) {
        return new VendorResponse(
                e.getId(),
                e.getOrganizationId(),
                e.getName(),
                e.getVendorType() == null ? null : e.getVendorType().name(),
                e.getStatus() == null ? null : e.getStatus().name());
    }
}
