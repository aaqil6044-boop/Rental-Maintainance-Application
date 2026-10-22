package com.pmp.billing.repository;

import com.pmp.billing.persistence.Quotation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface QuotationRepository extends JpaRepository<Quotation, UUID> {
    List<Quotation> findByOrganizationId(UUID organizationId);
    List<Quotation> findByWorkOrderId(UUID workOrderId);
}
