package com.pmp.maintenance.api;
import com.pmp.maintenance.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface MaintenanceRequestService {
    RequestResponse create(CreateRequestRequest request);
    RequestResponse get(UUID id);
    List<RequestResponse> list(UUID organizationId, String status);
    void addMedia(UUID id, AddMediaRequest request);
    void addComment(UUID id, AddCommentRequest request);
    RequestResponse review(UUID id);
    WorkOrderResponse raiseWorkOrder(UUID id, CreateWorkOrderRequest request);
    RequestResponse hold(UUID id);
    RequestResponse resume(UUID id);
    RequestResponse complete(UUID id);
    RequestResponse verify(UUID id);
    RequestResponse close(UUID id);
    RequestResponse reopen(UUID id, ReasonRequest request);
    RequestResponse escalate(UUID id);
}
