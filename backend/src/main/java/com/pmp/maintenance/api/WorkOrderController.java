package com.pmp.maintenance.api;

import com.pmp.maintenance.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/work-orders")
public class WorkOrderController {
    private final WorkOrderService service;
    public WorkOrderController(WorkOrderService service) { this.service = service; }

    @GetMapping("/{id}")
    public ResponseEntity<WorkOrderResponse> get(@PathVariable UUID id) { return ResponseEntity.ok(service.get(id)); }
    @GetMapping
    public ResponseEntity<List<WorkOrderResponse>> list(@RequestParam UUID requestId) {
        return ResponseEntity.ok(service.listByRequest(requestId));
    }
    @PostMapping("/{id}/offer")
    public ResponseEntity<WorkOrderResponse> offer(@PathVariable UUID id, @Valid @RequestBody OfferRequest request) {
        return ResponseEntity.ok(service.offer(id, request));
    }
    @PostMapping("/{id}/accept")
    public ResponseEntity<WorkOrderResponse> accept(@PathVariable UUID id) { return ResponseEntity.ok(service.accept(id)); }
    @PostMapping("/{id}/reject")
    public ResponseEntity<WorkOrderResponse> reject(@PathVariable UUID id, @Valid @RequestBody ReasonRequest request) {
        return ResponseEntity.ok(service.reject(id, request));
    }
    @PostMapping("/{id}/progress")
    public ResponseEntity<Void> progress(@PathVariable UUID id, @Valid @RequestBody ProgressRequest request) {
        service.recordProgress(id, request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    @PostMapping("/{id}/evidence")
    public ResponseEntity<Void> evidence(@PathVariable UUID id, @Valid @RequestBody EvidenceRequest request) {
        service.addEvidence(id, request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    @PostMapping("/{id}/complete")
    public ResponseEntity<WorkOrderResponse> complete(@PathVariable UUID id) { return ResponseEntity.ok(service.complete(id)); }
    @PostMapping("/{id}/verify")
    public ResponseEntity<WorkOrderResponse> verify(@PathVariable UUID id) { return ResponseEntity.ok(service.verify(id)); }
    @PostMapping("/{id}/cancel")
    public ResponseEntity<WorkOrderResponse> cancel(@PathVariable UUID id) { return ResponseEntity.ok(service.cancel(id)); }
}
