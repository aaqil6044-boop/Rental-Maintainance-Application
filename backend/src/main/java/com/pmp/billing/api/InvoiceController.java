package com.pmp.billing.api;

import com.pmp.billing.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.UUID;

@RestController
@RequestMapping("/api/invoices")
public class InvoiceController {
    private final BillingService service;
    public InvoiceController(BillingService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<InvoiceResponse> submit(@Valid @RequestBody SubmitInvoiceRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.submitInvoice(request));
    }
    @PostMapping("/{id}/verify")
    public ResponseEntity<InvoiceResponse> verify(@PathVariable UUID id) {
        return ResponseEntity.ok(service.verifyInvoice(id));
    }
    @PostMapping("/{id}/payment")
    public ResponseEntity<Void> recordPayment(@PathVariable UUID id,
            @Valid @RequestBody RecordPaymentRequest request) {
        service.recordPayment(id, request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
}
