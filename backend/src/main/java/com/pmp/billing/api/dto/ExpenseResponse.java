package com.pmp.billing.api.dto;
import java.math.BigDecimal;
import java.util.UUID;
public record ExpenseResponse(UUID id, UUID requestId, UUID workOrderId, BigDecimal amount,
        String currency, String payerType) {}
