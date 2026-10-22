package com.pmp.property.api;

import com.pmp.property.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;

@RestController
@RequestMapping("/api/units")
public class UnitController {
    private final UnitService service;
    public UnitController(UnitService service) { this.service = service; }

    @GetMapping("/{id}")
    public ResponseEntity<UnitResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }
    @PostMapping("/{id}/deactivate")
    public ResponseEntity<Void> deactivate(@PathVariable UUID id) {
        service.deactivate(id); return ResponseEntity.noContent().build();
    }
}
