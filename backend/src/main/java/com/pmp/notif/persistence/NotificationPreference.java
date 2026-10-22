package com.pmp.notif.persistence;

import jakarta.persistence.*;
import java.util.UUID;
import com.pmp.notif.types.*;

@Entity
@Table(name = "notif_notification_preference")
public class NotificationPreference {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "user_id")
    private UUID userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "channel")
    private NotificationPreferenceChannel channel;

    @Column(name = "notification_type")
    private String notificationType;

    @Column(name = "enabled")
    private Boolean enabled;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getUserId() { return userId; }
    public void setUserId(UUID userId) { this.userId = userId; }
    public NotificationPreferenceChannel getChannel() { return channel; }
    public void setChannel(NotificationPreferenceChannel channel) { this.channel = channel; }
    public String getNotificationType() { return notificationType; }
    public void setNotificationType(String notificationType) { this.notificationType = notificationType; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
}
