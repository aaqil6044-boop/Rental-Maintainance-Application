package com.pmp.notif.repository;

import com.pmp.notif.persistence.Notification;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {
    List<Notification> findByOrganizationId(UUID organizationId);
    List<Notification> findByRecipientUserId(UUID recipientUserId);
}
