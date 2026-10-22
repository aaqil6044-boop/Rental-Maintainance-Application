package com.pmp.identity.api;

import com.pmp.identity.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.UUID;

@RestController
@RequestMapping("/api/users")
public class UserController {
    private final IdentityService service;
    public UserController(IdentityService service) { this.service = service; }

    @PostMapping
    public ResponseEntity<UserResponse> invite(@Valid @RequestBody InviteUserRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.invite(request));
    }
    @GetMapping("/{id}")
    public ResponseEntity<UserResponse> get(@PathVariable UUID id) {
        return ResponseEntity.ok(service.get(id));
    }
    @PostMapping("/{id}/activate")
    public ResponseEntity<Void> activate(@PathVariable UUID id) {
        service.activate(id); return ResponseEntity.noContent().build();
    }
    @PostMapping("/{id}/disable")
    public ResponseEntity<Void> disable(@PathVariable UUID id) {
        service.disable(id); return ResponseEntity.noContent().build();
    }
    @PostMapping("/roles")
    public ResponseEntity<Void> assignRole(@Valid @RequestBody AssignRoleRequest request) {
        service.assignRole(request); return ResponseEntity.status(HttpStatus.CREATED).build();
    }
    @DeleteMapping("/roles/{assignmentId}")
    public ResponseEntity<Void> revokeRole(@PathVariable UUID assignmentId) {
        service.revokeRole(assignmentId); return ResponseEntity.noContent().build();
    }
}
