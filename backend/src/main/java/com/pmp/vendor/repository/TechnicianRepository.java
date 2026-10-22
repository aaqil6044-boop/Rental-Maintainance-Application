package com.pmp.vendor.repository;

import com.pmp.vendor.persistence.Technician;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface TechnicianRepository extends JpaRepository<Technician, UUID> {
    List<Technician> findByVendorId(UUID vendorId);
    List<Technician> findByUserId(UUID userId);
}
