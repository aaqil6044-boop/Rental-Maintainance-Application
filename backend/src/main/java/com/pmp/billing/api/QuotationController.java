package com.pmp.billing.api;

import com.pmp.billing.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/quotations")
public class QuotationController {
    private final BillingService service;
    public QuotationController(BillingService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<QuotationResponse> submit(@Valid @RequestBody SubmitQuotationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.submitQuotation(request));
    }
    @GetMapping
    public ResponseEntity<List<QuotationResponse>> list(@RequestParam UUID workOrderId) {
        return ResponseEntity.ok(service.listQuotations(workOrderId));
    }
    @PostMapping("/{id}/approve")
    public ResponseEntity<QuotationResponse> approve(@PathVariable UUID id,
            @Valid @RequestBody ApproveQuotationRequest request) {
        return ResponseEntity.ok(service.approveQuotation(id, request));
    }
    @PostMapping("/{id}/reject")
    public ResponseEntity<QuotationResponse> reject(@PathVariable UUID id) {
        return ResponseEntity.ok(service.rejectQuotation(id));
    }
}
