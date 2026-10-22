package com.pmp.billing.api.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
public record RecordPaymentRequest(@NotBlank String paymentStatus, @NotNull BigDecimal paidAmount) {}
