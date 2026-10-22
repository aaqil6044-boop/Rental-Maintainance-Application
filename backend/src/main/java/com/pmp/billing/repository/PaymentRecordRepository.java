package com.pmp.billing.repository;

import com.pmp.billing.persistence.PaymentRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface PaymentRecordRepository extends JpaRepository<PaymentRecord, UUID> {
    List<PaymentRecord> findByInvoiceId(UUID invoiceId);
}
