package com.pmp.billing.api.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
public record ApproveQuotationRequest(@NotNull @Positive BigDecimal limitAmount, @NotBlank String currency) {}
