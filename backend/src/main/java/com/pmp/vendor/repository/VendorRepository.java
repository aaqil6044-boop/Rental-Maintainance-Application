package com.pmp.vendor.repository;

import com.pmp.vendor.persistence.Vendor;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface VendorRepository extends JpaRepository<Vendor, UUID> {
    List<Vendor> findByOrganizationId(UUID organizationId);
}
