package com.pmp.vendor.api;

import com.pmp.vendor.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/vendors")
public class VendorController {
    private final VendorService service;
    public VendorController(VendorService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<VendorResponse> register(@Valid @RequestBody RegisterVendorRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.register(request));
    }
    @GetMapping("/{id}")
    public ResponseEntity<VendorResponse> get(@PathVariable UUID id) { return ResponseEntity.ok(service.get(id)); }
    @GetMapping
    public ResponseEntity<List<VendorResponse>> list(@RequestParam UUID organizationId) {
        return ResponseEntity.ok(service.listByOrganization(organizationId));
    }
    @PostMapping("/{id}/submit")
    public ResponseEntity<Void> submit(@PathVariable UUID id) { service.submit(id); return ResponseEntity.noContent().build(); }
    @PostMapping("/{id}/approve")
    public ResponseEntity<Void> approve(@PathVariable UUID id) { service.approve(id); return ResponseEntity.noContent().build(); }
    @PostMapping("/{id}/suspend")
    public ResponseEntity<Void> suspend(@PathVariable UUID id) { service.suspend(id); return ResponseEntity.noContent().build(); }
    @PostMapping("/{id}/reinstate")
    public ResponseEntity<Void> reinstate(@PathVariable UUID id) { service.reinstate(id); return ResponseEntity.noContent().build(); }
    @PostMapping("/{id}/categories")
    public ResponseEntity<Void> addCategory(@PathVariable UUID id, @Valid @RequestBody AddCategoryRequest request) {
        service.addCategory(id, request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
}
