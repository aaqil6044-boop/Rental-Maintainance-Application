package com.pmp.billing.api.dto;
import java.util.UUID;
public record WorkAuthorizationResponse(UUID id, UUID workOrderId, String authorizationType,
        boolean needsPostHocApproval) {}
