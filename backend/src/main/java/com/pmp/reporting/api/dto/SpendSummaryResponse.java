package com.pmp.reporting.api.dto;
import java.math.BigDecimal;
public record SpendSummaryResponse(BigDecimal total, String currency) {}
