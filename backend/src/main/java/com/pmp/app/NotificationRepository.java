package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    List<Notification> findTop50ByRecipientIdOrderByCreatedAtDesc(Long recipientId);
    long countByRecipientIdAndReadFalse(Long recipientId);
}
