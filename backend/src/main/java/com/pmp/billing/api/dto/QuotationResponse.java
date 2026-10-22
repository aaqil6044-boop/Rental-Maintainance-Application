package com.pmp.billing.api.dto;
import java.math.BigDecimal;
import java.util.UUID;
public record QuotationResponse(UUID id, UUID workOrderId, BigDecimal amount, String currency, String status) {}
