package com.pmp.maintenance.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.domain.shared.DomainException;
import com.pmp.maintenance.api.MaintenanceRequestService;
import com.pmp.maintenance.api.dto.*;
import com.pmp.maintenance.persistence.*;
import com.pmp.maintenance.repository.*;
import com.pmp.maintenance.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class MaintenanceRequestServiceImpl implements MaintenanceRequestService {

    private final RequestRepository requests;
    private final LocationRepository locations;
    private final RequestMediaRepository media;
    private final RequestCommentRepository comments;
    private final WorkOrderRepository workOrders;

    public MaintenanceRequestServiceImpl(RequestRepository requests, LocationRepository locations,
            RequestMediaRepository media, RequestCommentRepository comments, WorkOrderRepository workOrders) {
        this.requests = requests; this.locations = locations; this.media = media;
        this.comments = comments; this.workOrders = workOrders;
    }

    @Override @Transactional
    public RequestResponse create(CreateRequestRequest r) {
        LocationLocationType type = LocationLocationType.valueOf(r.locationType());
        Location loc = new Location();
        loc.setId(UUID.randomUUID());
        loc.setLocationType(type);
        switch (type) {
            case unit -> loc.setUnitId(r.locationReferenceId());
            case building -> loc.setBuildingId(r.locationReferenceId());
            case common_area -> loc.setCommonAreaId(r.locationReferenceId());
            case property -> loc.setPropertyId(r.locationReferenceId());
        }
        locations.save(loc);

        Request req = new Request();
        req.setId(UUID.randomUUID());
        req.setOrganizationId(r.organizationId());
        req.setLocationId(loc.getId());
        req.setReporterPartyId(r.reporterPartyId());
        req.setTitle(r.title());
        req.setDescription(r.description());
        req.setCategoryId(r.categoryId());
        req.setPriority(RequestPriority.valueOf(r.priority() == null ? "normal" : r.priority()));
        req.setUrgency(RequestUrgency.valueOf(r.urgency() == null ? "normal" : r.urgency()));
        req.setStatus(RequestStatus.reported);
        req.setReferenceNo("REQ-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        req.setReportedAt(Instant.now());
        req.setCreatedAt(Instant.now());
        req.setUpdatedAt(Instant.now());
        return toResponse(requests.save(req), loc);
    }

    @Override @Transactional
    public RequestResponse get(UUID id) { Request req = load(id); return toResponse(req, loc(req)); }

    @Override @Transactional
    public List<RequestResponse> list(UUID organizationId, String status) {
        return requests.findByOrganizationId(organizationId).stream()
                .filter(req -> status == null || req.getStatus().name().equals(status))
                .map(req -> toResponse(req, loc(req)))
                .toList();
    }

    @Override @Transactional
    public void addMedia(UUID id, AddMediaRequest r) {
        load(id);
        RequestMedia m = new RequestMedia();
        m.setId(UUID.randomUUID());
        m.setRequestId(id);
        m.setFileRef(r.fileRef());
        m.setMediaType(RequestMediaMediaType.valueOf(r.mediaType()));
        m.setUploadedAt(Instant.now());
        media.save(m);
    }
    @Override @Transactional
    public void addComment(UUID id, AddCommentRequest r) {
        load(id);
        RequestComment c = new RequestComment();
        c.setId(UUID.randomUUID());
        c.setRequestId(id);
        c.setBody(r.body());
        c.setCreatedAt(Instant.now());
        comments.save(c);
    }

    @Override @Transactional
    public RequestResponse review(UUID id) { return transition(id, RequestStatus.reported, RequestStatus.under_review); }

    @Override @Transactional
    public WorkOrderResponse raiseWorkOrder(UUID id, CreateWorkOrderRequest r) {
        Request req = load(id);
        if (req.getStatus() != RequestStatus.under_review && req.getStatus() != RequestStatus.in_progress)
            throw new DomainException("work orders are raised after review");
        WorkOrder wo = new WorkOrder();
        wo.setId(UUID.randomUUID());
        wo.setOrganizationId(req.getOrganizationId());
        wo.setRequestId(req.getId());
        wo.setTrade(WorkOrderTrade.valueOf(r.trade()));
        wo.setScopeOfWork(r.scopeOfWork());
        wo.setStatus(WorkOrderStatus.created);
        wo.setCreatedAt(Instant.now());
        wo.setUpdatedAt(Instant.now());
        workOrders.save(wo);
        if (req.getStatus() == RequestStatus.under_review) { req.setStatus(RequestStatus.in_progress); touch(req); }
        return new WorkOrderResponse(wo.getId(), wo.getRequestId(), wo.getTrade().name(),
                wo.getStatus().name(), wo.getVendorId());
    }

    @Override @Transactional
    public RequestResponse hold(UUID id) { return transition(id, RequestStatus.in_progress, RequestStatus.on_hold); }
    @Override @Transactional
    public RequestResponse resume(UUID id) { return transition(id, RequestStatus.on_hold, RequestStatus.in_progress); }
    @Override @Transactional
    public RequestResponse complete(UUID id) { return transition(id, RequestStatus.in_progress, RequestStatus.work_completed); }
    @Override @Transactional
    public RequestResponse verify(UUID id) { return transition(id, RequestStatus.work_completed, RequestStatus.verified); }
    @Override @Transactional
    public RequestResponse close(UUID id) {
        Request req = load(id);
        if (req.getStatus() != RequestStatus.verified) throw new DomainException("cannot close before verification");
        req.setStatus(RequestStatus.closed); req.setClosedAt(Instant.now()); touch(req);
        return toResponse(req, loc(req));
    }
    @Override @Transactional
    public RequestResponse reopen(UUID id, ReasonRequest r) {
        Request req = load(id);
        if (req.getStatus() != RequestStatus.closed) throw new DomainException("only a closed request can be reopened");
        req.setStatus(RequestStatus.reopened); touch(req);
        return toResponse(req, loc(req));
    }
    @Override @Transactional
    public RequestResponse escalate(UUID id) {
        Request req = load(id);
        if (req.getStatus() != RequestStatus.in_progress && req.getStatus() != RequestStatus.on_hold)
            throw new DomainException("only active requests can be escalated");
        req.setStatus(RequestStatus.escalated); touch(req);
        return toResponse(req, loc(req));
    }

    private RequestResponse transition(UUID id, RequestStatus from, RequestStatus to) {
        Request req = load(id);
        if (req.getStatus() != from) throw new DomainException("cannot move to " + to + " from " + req.getStatus());
        req.setStatus(to); touch(req);
        return toResponse(req, loc(req));
    }
    private Request load(UUID id) {
        return requests.findById(id).orElseThrow(() -> new NotFoundException("request " + id + " not found"));
    }
    private Location loc(Request req) {
        return locations.findById(req.getLocationId())
                .orElseThrow(() -> new NotFoundException("location " + req.getLocationId() + " not found"));
    }
    private void touch(Request req) { req.setUpdatedAt(Instant.now()); requests.save(req); }
    private static RequestResponse toResponse(Request req, Location loc) {
        UUID ref = switch (loc.getLocationType()) {
            case unit -> loc.getUnitId();
            case building -> loc.getBuildingId();
            case common_area -> loc.getCommonAreaId();
            case property -> loc.getPropertyId();
        };
        return new RequestResponse(req.getId(), req.getOrganizationId(), loc.getLocationType().name(),
                ref, req.getTitle(), req.getPriority() == null ? null : req.getPriority().name(),
                req.getStatus() == null ? null : req.getStatus().name(), req.getReferenceNo());
    }
}
