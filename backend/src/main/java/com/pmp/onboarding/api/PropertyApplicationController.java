package com.pmp.onboarding.api;

import com.pmp.onboarding.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/onboarding/applications")
public class PropertyApplicationController {
    private final PropertyApplicationService service;
    public PropertyApplicationController(PropertyApplicationService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<ApplicationResponse> submit(@Valid @RequestBody SubmitApplicationRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.submit(request));
    }
    @GetMapping("/{id}")
    public ResponseEntity<ApplicationResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }
    @GetMapping
    public ResponseEntity<List<ApplicationResponse>> list(@RequestParam UUID organizationId) {
        return ResponseEntity.ok(service.listByOrganization(organizationId));
    }
    @PostMapping("/{id}/approve")
    public ResponseEntity<ApplicationResponse> approve(@PathVariable UUID id) {
        return ResponseEntity.ok(service.approve(id));
    }
    @PostMapping("/{id}/reject")
    public ResponseEntity<ApplicationResponse> reject(@PathVariable UUID id,
            @Valid @RequestBody DecisionRequest request) {
        return ResponseEntity.ok(service.reject(id, request));
    }
    @PostMapping("/{id}/request-more-info")
    public ResponseEntity<ApplicationResponse> moreInfo(@PathVariable UUID id,
            @Valid @RequestBody DecisionRequest request) {
        return ResponseEntity.ok(service.requestMoreInfo(id, request));
    }
    @PostMapping("/{id}/withdraw")
    public ResponseEntity<Void> withdraw(@PathVariable UUID id) {
        service.withdraw(id); return ResponseEntity.noContent().build();
    }
}
