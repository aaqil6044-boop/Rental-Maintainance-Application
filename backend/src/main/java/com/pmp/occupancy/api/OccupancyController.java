package com.pmp.occupancy.api;

import com.pmp.occupancy.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api")
public class OccupancyController {
    private final OccupancyService service;
    public OccupancyController(OccupancyService service) { this.service = service; }

    @PostMapping("/ownerships")
    public ResponseEntity<OwnershipResponse> startOwnership(@Valid @RequestBody CreateOwnershipRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.startOwnership(request));
    }
    @PostMapping("/ownerships/{id}/end")
    public ResponseEntity<Void> endOwnership(@PathVariable UUID id, @Valid @RequestBody EndDateRequest request) {
        service.endOwnership(id, request); return ResponseEntity.noContent().build();
    }
    @GetMapping("/units/{unitId}/ownerships")
    public ResponseEntity<List<OwnershipResponse>> listOwnerships(@PathVariable UUID unitId) {
        return ResponseEntity.ok(service.listOwnerships(unitId));
    }
    @PostMapping("/tenancies")
    public ResponseEntity<TenancyResponse> startTenancy(@Valid @RequestBody CreateTenancyRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.startTenancy(request));
    }
    @PostMapping("/tenancies/{id}/end")
    public ResponseEntity<Void> endTenancy(@PathVariable UUID id, @Valid @RequestBody EndDateRequest request) {
        service.endTenancy(id, request); return ResponseEntity.noContent().build();
    }
    @GetMapping("/units/{unitId}/tenancies")
    public ResponseEntity<List<TenancyResponse>> listTenancies(@PathVariable UUID unitId) {
        return ResponseEntity.ok(service.listTenancies(unitId));
    }
}
