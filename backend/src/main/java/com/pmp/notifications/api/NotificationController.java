package com.pmp.notifications.api;

import com.pmp.notifications.api.dto.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService service;
    public NotificationController(NotificationService service) { this.service = service; }

    @GetMapping
    public ResponseEntity<List<NotificationResponse>> list(@RequestParam UUID userId) {
        return ResponseEntity.ok(service.listForUser(userId));
    }
    @PostMapping("/{id}/read")
    public ResponseEntity<Void> markRead(@PathVariable UUID id) {
        service.markRead(id); return ResponseEntity.noContent().build();
    }
    @PutMapping("/preferences")
    public ResponseEntity<Void> setPreference(@RequestParam UUID userId,
            @Valid @RequestBody PreferenceRequest request) {
        service.setPreference(userId, request); return ResponseEntity.noContent().build();
    }
}
