package com.pmp.billing.repository;

import com.pmp.billing.persistence.Invoice;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface InvoiceRepository extends JpaRepository<Invoice, UUID> {
    List<Invoice> findByOrganizationId(UUID organizationId);
    List<Invoice> findByWorkOrderId(UUID workOrderId);
}
