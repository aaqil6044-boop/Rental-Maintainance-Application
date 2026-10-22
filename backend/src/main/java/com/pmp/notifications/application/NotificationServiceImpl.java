package com.pmp.notifications.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.notifications.api.NotificationService;
import com.pmp.notifications.api.dto.*;
import com.pmp.notif.persistence.*;
import com.pmp.notif.repository.*;
import com.pmp.notif.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.UUID;

@Service
public class NotificationServiceImpl implements NotificationService {

    private final NotificationRepository notifications;
    private final NotificationPreferenceRepository preferences;

    public NotificationServiceImpl(NotificationRepository notifications, NotificationPreferenceRepository preferences) {
        this.notifications = notifications; this.preferences = preferences;
    }

    @Override @Transactional
    public List<NotificationResponse> listForUser(UUID userId) {
        return notifications.findByRecipientUserId(userId).stream()
                .map(n -> new NotificationResponse(n.getId(), n.getType(),
                        n.getStatus() == null ? null : n.getStatus().name(), n.getSubjectRef()))
                .toList();
    }
    @Override @Transactional
    public void markRead(UUID id) {
        Notification n = notifications.findById(id)
                .orElseThrow(() -> new NotFoundException("notification " + id + " not found"));
        n.setStatus(NotificationStatus.read); notifications.save(n);
    }
    @Override @Transactional
    public void setPreference(UUID userId, PreferenceRequest r) {
        NotificationPreference p = new NotificationPreference();
        p.setId(UUID.randomUUID());
        p.setUserId(userId);
        p.setChannel(NotificationPreferenceChannel.valueOf(r.channel()));
        p.setEnabled(r.enabled());
        preferences.save(p);
    }
}
