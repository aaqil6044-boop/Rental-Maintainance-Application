package com.pmp.property.api;

import com.pmp.property.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/properties")
public class PropertyController {
    private final PropertyService service;
    public PropertyController(PropertyService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<PropertyResponse> create(@Valid @RequestBody CreatePropertyRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(request));
    }
    @GetMapping("/{id}")
    public ResponseEntity<PropertyResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }
    @GetMapping
    public ResponseEntity<List<PropertyResponse>> list(@RequestParam UUID organizationId) {
        return ResponseEntity.ok(service.listByOrganization(organizationId));
    }
    @PostMapping("/{id}/activate")
    public ResponseEntity<Void> activate(@PathVariable UUID id) {
        service.activate(id); return ResponseEntity.noContent().build();
    }
    @PostMapping("/{id}/suspend")
    public ResponseEntity<Void> suspend(@PathVariable UUID id) {
        service.suspend(id); return ResponseEntity.noContent().build();
    }
    @PostMapping("/{id}/deactivate")
    public ResponseEntity<Void> deactivate(@PathVariable UUID id) {
        service.deactivate(id); return ResponseEntity.noContent().build();
    }
    @PostMapping("/{id}/buildings")
    public ResponseEntity<BuildingResponse> addBuilding(@PathVariable UUID id,
            @Valid @RequestBody CreateBuildingRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.addBuilding(id, request));
    }
    @PostMapping("/{id}/units")
    public ResponseEntity<UnitResponse> addUnit(@PathVariable UUID id,
            @Valid @RequestBody CreateUnitRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.addUnit(id, request));
    }
    @PostMapping("/{id}/units/bulk")
    public ResponseEntity<List<UnitResponse>> bulkAddUnits(@PathVariable UUID id,
            @Valid @RequestBody BulkCreateUnitsRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.bulkAddUnits(id, request));
    }
    @GetMapping("/{id}/units")
    public ResponseEntity<List<UnitResponse>> listUnits(@PathVariable UUID id) {
        return ResponseEntity.ok(service.listUnits(id));
    }
}
