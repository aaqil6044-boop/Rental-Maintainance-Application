package com.pmp.maintenance.api;

import com.pmp.maintenance.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/requests")
public class MaintenanceRequestController {
    private final MaintenanceRequestService service;
    public MaintenanceRequestController(MaintenanceRequestService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<RequestResponse> create(@Valid @RequestBody CreateRequestRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }
    @GetMapping("/{id}")
    public ResponseEntity<RequestResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }
    @GetMapping
    public ResponseEntity<List<RequestResponse>> list(@RequestParam UUID organizationId,
            @RequestParam(required = false) String status) {
        return ResponseEntity.ok(service.list(organizationId, status));
    }
    @PostMapping("/{id}/media")
    public ResponseEntity<Void> addMedia(@PathVariable UUID id, @Valid @RequestBody AddMediaRequest request) {
        service.addMedia(id, request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    @PostMapping("/{id}/comments")
    public ResponseEntity<Void> addComment(@PathVariable UUID id, @Valid @RequestBody AddCommentRequest request) {
        service.addComment(id, request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    @PostMapping("/{id}/review")
    public ResponseEntity<RequestResponse> review(@PathVariable UUID id) {
        return ResponseEntity.ok(service.review(id));
    }
    @PostMapping("/{id}/work-orders")
    public ResponseEntity<WorkOrderResponse> raiseWorkOrder(@PathVariable UUID id,
            @Valid @RequestBody CreateWorkOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.raiseWorkOrder(id, request));
    }
    @PostMapping("/{id}/hold")
    public ResponseEntity<RequestResponse> hold(@PathVariable UUID id) { return ResponseEntity.ok(service.hold(id)); }
    @PostMapping("/{id}/resume")
    public ResponseEntity<RequestResponse> resume(@PathVariable UUID id) { return ResponseEntity.ok(service.resume(id)); }
    @PostMapping("/{id}/complete")
    public ResponseEntity<RequestResponse> complete(@PathVariable UUID id) { return ResponseEntity.ok(service.complete(id)); }
    @PostMapping("/{id}/verify")
    public ResponseEntity<RequestResponse> verify(@PathVariable UUID id) { return ResponseEntity.ok(service.verify(id)); }
    @PostMapping("/{id}/close")
    public ResponseEntity<RequestResponse> close(@PathVariable UUID id) { return ResponseEntity.ok(service.close(id)); }
    @PostMapping("/{id}/reopen")
    public ResponseEntity<RequestResponse> reopen(@PathVariable UUID id, @Valid @RequestBody ReasonRequest request) {
        return ResponseEntity.ok(service.reopen(id, request));
    }
    @PostMapping("/{id}/escalate")
    public ResponseEntity<RequestResponse> escalate(@PathVariable UUID id) { return ResponseEntity.ok(service.escalate(id)); }
}
