package com.pmp.app;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

@Service
public class NotificationService {

    private final NotificationRepository notifications;
    private final AccountRepository accounts;

    public NotificationService(NotificationRepository notifications, AccountRepository accounts) {
        this.notifications = notifications;
        this.accounts = accounts;
    }

    @Transactional
    public void notifyAccount(Account recipient, String message, Long requestId) {
        if (recipient == null) return;
        notifications.save(new Notification(recipient, message, requestId));
    }

    @Transactional
    public void notifyAllManagers(String message, Long requestId) {
        for (Account manager : accounts.findByRoleAndActiveTrue(Role.MANAGER)) {
            notifications.save(new Notification(manager, message, requestId));
        }
    }

    @Transactional(readOnly = true)
    public List<Dto.NotificationView> listFor(Account account) {
        List<Dto.NotificationView> out = new ArrayList<>();
        for (Notification n : notifications.findTop50ByRecipientIdOrderByCreatedAtDesc(account.getId())) {
            out.add(Views.notification(n));
        }
        return out;
    }

    @Transactional(readOnly = true)
    public long unreadCount(Account account) {
        return notifications.countByRecipientIdAndReadFalse(account.getId());
    }

    @Transactional
    public void markRead(Account account, Long notificationId) {
        Notification n = notifications.findById(notificationId)
                .orElseThrow(() -> AppException.notFound("That notification"));
        if (!n.getRecipient().getId().equals(account.getId())) throw AppException.forbidden();
        n.markRead();
        notifications.save(n);
    }

    @Transactional
    public void markAllRead(Account account) {
        for (Notification n : notifications.findTop50ByRecipientIdOrderByCreatedAtDesc(account.getId())) {
            if (!n.isRead()) { n.markRead(); notifications.save(n); }
        }
    }
}
