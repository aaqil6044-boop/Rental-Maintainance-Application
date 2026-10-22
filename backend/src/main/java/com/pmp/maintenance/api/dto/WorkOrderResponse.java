package com.pmp.maintenance.api.dto;
import java.util.UUID;
public record WorkOrderResponse(UUID id, UUID requestId, String trade, String status, UUID vendorId) {}
