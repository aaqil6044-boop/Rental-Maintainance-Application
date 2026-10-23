package com.pmp.app;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService notifications;
    private final CurrentUser currentUser;

    public NotificationController(NotificationService notifications, CurrentUser currentUser) {
        this.notifications = notifications;
        this.currentUser = currentUser;
    }

    @GetMapping
    public List<Dto.NotificationView> list() {
        return notifications.listFor(currentUser.require());
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<Void> markRead(@PathVariable Long id) {
        notifications.markRead(currentUser.require(), id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/read-all")
    public ResponseEntity<Void> markAllRead() {
        notifications.markAllRead(currentUser.require());
        return ResponseEntity.noContent().build();
    }
}
