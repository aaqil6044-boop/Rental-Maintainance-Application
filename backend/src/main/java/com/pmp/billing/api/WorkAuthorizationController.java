package com.pmp.billing.api;

import com.pmp.billing.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.UUID;

@RestController
@RequestMapping("/api/work-authorizations")
public class WorkAuthorizationController {
    private final BillingService service;
    public WorkAuthorizationController(BillingService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<WorkAuthorizationResponse> authorize(@Valid @RequestBody AuthorizeWorkRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.authorizeWork(request));
    }
    @PostMapping("/{id}/post-hoc-approve")
    public ResponseEntity<WorkAuthorizationResponse> postHoc(@PathVariable UUID id) {
        return ResponseEntity.ok(service.postHocApprove(id));
    }
}
