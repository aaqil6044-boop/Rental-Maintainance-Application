package com.pmp.maintenance.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.domain.shared.DomainException;
import com.pmp.maintenance.api.WorkOrderService;
import com.pmp.maintenance.api.dto.*;
import com.pmp.maintenance.persistence.*;
import com.pmp.maintenance.repository.*;
import com.pmp.maintenance.types.WorkOrderStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class WorkOrderServiceImpl implements WorkOrderService {

    private final WorkOrderRepository workOrders;
    private final WorkOrderProgressRepository progress;
    private final WorkEvidenceRepository evidence;

    public WorkOrderServiceImpl(WorkOrderRepository workOrders, WorkOrderProgressRepository progress,
                                WorkEvidenceRepository evidence) {
        this.workOrders = workOrders; this.progress = progress; this.evidence = evidence;
    }

    @Override @Transactional
    public WorkOrderResponse get(UUID id) { return toResponse(load(id)); }

    @Override @Transactional
    public List<WorkOrderResponse> listByRequest(UUID requestId) {
        return workOrders.findByRequestId(requestId).stream().map(WorkOrderServiceImpl::toResponse).toList();
    }

    @Override @Transactional
    public WorkOrderResponse offer(UUID id, OfferRequest r) {
        WorkOrder wo = load(id);
        if (wo.getStatus() != WorkOrderStatus.created && wo.getStatus() != WorkOrderStatus.rejected
                && wo.getStatus() != WorkOrderStatus.reassigned)
            throw new DomainException("cannot offer from " + wo.getStatus());
        wo.setVendorId(r.vendorId());
        wo.setStatus(WorkOrderStatus.offered);
        wo.setOfferedAt(Instant.now());
        touch(wo);
        return toResponse(wo);
    }
    @Override @Transactional
    public WorkOrderResponse accept(UUID id) { return transition(id, WorkOrderStatus.offered, WorkOrderStatus.accepted); }
    @Override @Transactional
    public WorkOrderResponse reject(UUID id, ReasonRequest r) {
        WorkOrder wo = load(id);
        if (wo.getStatus() != WorkOrderStatus.offered) throw new DomainException("cannot reject from " + wo.getStatus());
        wo.setStatus(WorkOrderStatus.rejected); wo.setVendorId(null); touch(wo);
        return toResponse(wo);
    }
    @Override @Transactional
    public void recordProgress(UUID id, ProgressRequest r) {
        load(id);
        WorkOrderProgress p = new WorkOrderProgress();
        p.setId(UUID.randomUUID());
        p.setWorkOrderId(id);
        p.setStatusNote(r.statusNote());
        p.setRecordedAt(Instant.now());
        progress.save(p);
    }
    @Override @Transactional
    public void addEvidence(UUID id, EvidenceRequest r) {
        load(id);
        WorkEvidence e = new WorkEvidence();
        e.setId(UUID.randomUUID());
        e.setWorkOrderId(id);
        e.setFileRef(r.fileRef());
        e.setNote(r.note());
        e.setUploadedAt(Instant.now());
        evidence.save(e);
    }
    @Override @Transactional
    public WorkOrderResponse complete(UUID id) {
        WorkOrder wo = load(id);
        if (wo.getStatus() != WorkOrderStatus.in_progress) throw new DomainException("cannot complete from " + wo.getStatus());
        if (evidence.findByWorkOrderId(id).isEmpty()) throw new DomainException("completion requires evidence");
        wo.setStatus(WorkOrderStatus.completed); touch(wo);
        return toResponse(wo);
    }
    @Override @Transactional
    public WorkOrderResponse verify(UUID id) { return transition(id, WorkOrderStatus.completed, WorkOrderStatus.verified); }
    @Override @Transactional
    public WorkOrderResponse cancel(UUID id) {
        WorkOrder wo = load(id);
        if (wo.getStatus() == WorkOrderStatus.verified) throw new DomainException("a verified work order cannot be cancelled");
        wo.setStatus(WorkOrderStatus.cancelled); touch(wo);
        return toResponse(wo);
    }

    private WorkOrderResponse transition(UUID id, WorkOrderStatus from, WorkOrderStatus to) {
        WorkOrder wo = load(id);
        if (wo.getStatus() != from) throw new DomainException("cannot move to " + to + " from " + wo.getStatus());
        wo.setStatus(to); touch(wo);
        return toResponse(wo);
    }
    private WorkOrder load(UUID id) {
        return workOrders.findById(id).orElseThrow(() -> new NotFoundException("work order " + id + " not found"));
    }
    private void touch(WorkOrder wo) { wo.setUpdatedAt(Instant.now()); workOrders.save(wo); }
    private static WorkOrderResponse toResponse(WorkOrder wo) {
        return new WorkOrderResponse(wo.getId(), wo.getRequestId(),
                wo.getTrade() == null ? null : wo.getTrade().name(),
                wo.getStatus() == null ? null : wo.getStatus().name(), wo.getVendorId());
    }
}
