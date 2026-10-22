package com.pmp.notifications.api.dto;
import java.util.UUID;
public record NotificationResponse(UUID id, String type, String status, UUID subjectRef) {}
