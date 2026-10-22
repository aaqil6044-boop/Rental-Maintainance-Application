package com.pmp.maintenance.api.dto;
import java.util.UUID;
public record RequestResponse(UUID id, UUID organizationId, String locationType,
        UUID locationReferenceId, String title, String priority, String status, String referenceNo) {}
