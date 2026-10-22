package com.pmp.vendor.api;
import com.pmp.vendor.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface VendorService {
    VendorResponse register(RegisterVendorRequest request);
    VendorResponse get(UUID id);
    List<VendorResponse> listByOrganization(UUID organizationId);
    void submit(UUID id);
    void approve(UUID id);
    void suspend(UUID id);
    void reinstate(UUID id);
    void addCategory(UUID id, AddCategoryRequest request);
}
