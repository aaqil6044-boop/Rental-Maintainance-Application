package com.pmp.billing.api;

import com.pmp.billing.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/expenses")
public class ExpenseController {
    private final BillingService service;
    public ExpenseController(BillingService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<ExpenseResponse> record(@Valid @RequestBody RecordExpenseRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.recordExpense(request));
    }
}
