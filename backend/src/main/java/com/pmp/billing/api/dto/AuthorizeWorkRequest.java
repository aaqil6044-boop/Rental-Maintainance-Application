package com.pmp.billing.api.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.UUID;
public record AuthorizeWorkRequest(@NotNull UUID workOrderId, boolean emergency,
        BigDecimal capAmount, String currency, String reason) {}
