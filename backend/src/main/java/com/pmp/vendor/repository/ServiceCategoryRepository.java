package com.pmp.vendor.repository;

import com.pmp.vendor.persistence.ServiceCategory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ServiceCategoryRepository extends JpaRepository<ServiceCategory, UUID> {
    List<ServiceCategory> findByVendorId(UUID vendorId);
}
