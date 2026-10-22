package com.pmp.billing.api.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.util.UUID;
public record SubmitQuotationRequest(@NotNull UUID workOrderId, @NotNull @Positive BigDecimal amount,
        @NotBlank String currency) {}
