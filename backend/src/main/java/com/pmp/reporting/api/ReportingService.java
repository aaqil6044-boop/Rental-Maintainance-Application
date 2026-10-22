package com.pmp.reporting.api;
import com.pmp.reporting.api.dto.*;
import java.util.UUID;
public interface ReportingService {
    RequestSummaryResponse requestSummary(UUID organizationId);
    SpendSummaryResponse spendSummary(UUID organizationId);
}
