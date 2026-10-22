package com.pmp.notifications.api;
import com.pmp.notifications.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface NotificationService {
    List<NotificationResponse> listForUser(UUID userId);
    void markRead(UUID id);
    void setPreference(UUID userId, PreferenceRequest request);
}
