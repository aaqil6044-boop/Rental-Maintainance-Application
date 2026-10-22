package com.pmp.vendor.repository;

import com.pmp.vendor.persistence.Performance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface PerformanceRepository extends JpaRepository<Performance, UUID> {
    List<Performance> findByVendorId(UUID vendorId);
}
