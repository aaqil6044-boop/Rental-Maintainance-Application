package com.pmp.app;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class PropertyController {

    private final PropertyService properties;
    private final CurrentUser currentUser;
    private final AccountRepository accounts;

    public PropertyController(PropertyService properties, CurrentUser currentUser,
                              AccountRepository accounts) {
        this.properties = properties;
        this.currentUser = currentUser;
        this.accounts = accounts;
    }

    @GetMapping("/properties")
    public List<Dto.PropertyView> list() {
        return properties.list(currentUser.require());
    }

    @PostMapping("/properties")
    public ResponseEntity<Dto.PropertyView> create(@Valid @RequestBody Dto.CreatePropertyRequest req) {
        Dto.PropertyView created = properties.create(currentUser.require(), req);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping("/properties/{id}/units")
    public List<Dto.UnitView> units(@PathVariable Long id) {
        return properties.unitsOf(currentUser.require(), id);
    }

    @GetMapping("/units/reportable")
    public List<Dto.UnitView> reportable() {
        return properties.reportableUnits(currentUser.require());
    }

    @PostMapping("/units")
    public ResponseEntity<Dto.UnitView> createUnit(@Valid @RequestBody Dto.CreateUnitRequest req) {
        Dto.UnitView created = properties.createUnit(currentUser.require(), req);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PostMapping("/units/{unitId}/tenants/{tenantId}")
    public ResponseEntity<Void> assignTenant(@PathVariable Long unitId, @PathVariable Long tenantId) {
        properties.assignTenant(currentUser.require(), tenantId, unitId, accounts);
        return ResponseEntity.noContent().build();
    }
}
