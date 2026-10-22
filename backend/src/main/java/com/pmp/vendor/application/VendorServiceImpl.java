package com.pmp.vendor.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.domain.shared.DomainException;
import com.pmp.vendor.api.VendorService;
import com.pmp.vendor.api.dto.*;
import com.pmp.vendor.persistence.ServiceCategory;
import com.pmp.vendor.persistence.Vendor;
import com.pmp.vendor.repository.ServiceCategoryRepository;
import com.pmp.vendor.repository.VendorRepository;
import com.pmp.vendor.types.ServiceCategoryCategory;
import com.pmp.vendor.types.VendorStatus;
import com.pmp.vendor.types.VendorVendorType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Application service for the Vendor context. Orchestrates the repositories and
 * enforces the lifecycle rules defined by the domain model
 * (com.pmp.domain.vendor.Vendor). Controllers depend on the VendorService port;
 * this is its implementation.
 */
@Service
public class VendorServiceImpl implements VendorService {

    private final VendorRepository vendors;
    private final ServiceCategoryRepository categories;

    public VendorServiceImpl(VendorRepository vendors, ServiceCategoryRepository categories) {
        this.vendors = vendors;
        this.categories = categories;
    }

    @Override
    @Transactional
    public VendorResponse register(RegisterVendorRequest request) {
        // Validate business invariants through the domain model (throws DomainException).
        new com.pmp.domain.vendor.Vendor(request.organizationId(), request.name());

        Vendor e = new Vendor();
        e.setId(UUID.randomUUID());
        e.setOrganizationId(request.organizationId());
        e.setName(request.name());
        e.setVendorType(parseType(request.vendorType()));
        e.setStatus(VendorStatus.draft);
        e.setCreatedAt(Instant.now());
        e.setUpdatedAt(Instant.now());
        return VendorMapper.toResponse(vendors.save(e));
    }

    @Override
    @Transactional(/* readOnly */)
    public VendorResponse get(UUID id) {
        return VendorMapper.toResponse(load(id));
    }

    @Override
    @Transactional
    public List<VendorResponse> listByOrganization(UUID organizationId) {
        return vendors.findByOrganizationId(organizationId).stream()
                .map(VendorMapper::toResponse)
                .toList();
    }

    @Override
    @Transactional
    public void submit(UUID id) {
        Vendor e = load(id);
        e.setStatus(VendorStatus.submitted);
        touch(e);
    }

    @Override
    @Transactional
    public void approve(UUID id) {
        Vendor e = load(id);
        require(e.getStatus() == VendorStatus.submitted
                || e.getStatus() == VendorStatus.pending_verification,
                "only a submitted or pending vendor can be approved");
        e.setStatus(VendorStatus.active);
        touch(e);
    }

    @Override
    @Transactional
    public void suspend(UUID id) {
        Vendor e = load(id);
        require(e.getStatus() == VendorStatus.active, "only an active vendor can be suspended");
        e.setStatus(VendorStatus.suspended);
        touch(e);
    }

    @Override
    @Transactional
    public void reinstate(UUID id) {
        Vendor e = load(id);
        require(e.getStatus() == VendorStatus.suspended, "only a suspended vendor can be reinstated");
        e.setStatus(VendorStatus.active);
        touch(e);
    }

    @Override
    @Transactional
    public void addCategory(UUID id, AddCategoryRequest request) {
        load(id); // ensure the vendor exists
        ServiceCategory c = new ServiceCategory();
        c.setId(UUID.randomUUID());
        c.setVendorId(id);
        c.setCategory(parseCategory(request.category()));
        categories.save(c);
    }

    // ---- helpers ----
    private Vendor load(UUID id) {
        return vendors.findById(id)
                .orElseThrow(() -> new NotFoundException("vendor " + id + " not found"));
    }
    private void touch(Vendor e) { e.setUpdatedAt(Instant.now()); vendors.save(e); }
    private static void require(boolean ok, String message) {
        if (!ok) throw new DomainException(message);
    }
    private static VendorVendorType parseType(String v) {
        try { return VendorVendorType.valueOf(v); }
        catch (Exception ex) { throw new IllegalArgumentException("invalid vendorType: " + v); }
    }
    private static ServiceCategoryCategory parseCategory(String v) {
        try { return ServiceCategoryCategory.valueOf(v); }
        catch (Exception ex) { throw new IllegalArgumentException("invalid category: " + v); }
    }
}
