package com.pmp.billing.repository;

import com.pmp.billing.persistence.ExpenseRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ExpenseRecordRepository extends JpaRepository<ExpenseRecord, UUID> {
    List<ExpenseRecord> findByOrganizationId(UUID organizationId);
    List<ExpenseRecord> findByRequestId(UUID requestId);
    List<ExpenseRecord> findByWorkOrderId(UUID workOrderId);
}
