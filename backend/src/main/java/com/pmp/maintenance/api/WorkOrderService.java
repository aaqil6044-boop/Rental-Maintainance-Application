package com.pmp.maintenance.api;
import com.pmp.maintenance.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface WorkOrderService {
    WorkOrderResponse get(UUID id);
    List<WorkOrderResponse> listByRequest(UUID requestId);
    WorkOrderResponse offer(UUID id, OfferRequest request);
    WorkOrderResponse accept(UUID id);
    WorkOrderResponse reject(UUID id, ReasonRequest request);
    void recordProgress(UUID id, ProgressRequest request);
    void addEvidence(UUID id, EvidenceRequest request);
    WorkOrderResponse complete(UUID id);
    WorkOrderResponse verify(UUID id);
    WorkOrderResponse cancel(UUID id);
}
