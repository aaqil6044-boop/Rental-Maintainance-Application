package com.pmp.vendor.repository;

import com.pmp.vendor.persistence.Document;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface DocumentRepository extends JpaRepository<Document, UUID> {
    List<Document> findByVendorId(UUID vendorId);
}
