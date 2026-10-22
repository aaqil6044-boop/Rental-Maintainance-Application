package com.pmp.reporting.api;

import com.pmp.reporting.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/reports")
public class ReportingController {
    private final ReportingService service;
    public ReportingController(ReportingService service) { this.service = service; }

    @GetMapping("/requests/summary")
    public ResponseEntity<RequestSummaryResponse> requests(@RequestParam UUID organizationId) {
        return ResponseEntity.ok(service.requestSummary(organizationId));
    }
    @GetMapping("/spend/summary")
    public ResponseEntity<SpendSummaryResponse> spend(@RequestParam UUID organizationId) {
        return ResponseEntity.ok(service.spendSummary(organizationId));
    }
}
