package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ExpenseRepository extends JpaRepository<Expense, Long> {
    List<Expense> findByRequestIdOrderByCreatedAtAsc(Long requestId);
    List<Expense> findByApprovedTrue();
}
