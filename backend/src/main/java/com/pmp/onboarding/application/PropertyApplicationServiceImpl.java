package com.pmp.onboarding.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.onboarding.api.PropertyApplicationService;
import com.pmp.onboarding.api.dto.*;
import com.pmp.onboarding.persistence.*;
import com.pmp.onboarding.repository.*;
import com.pmp.onboarding.types.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class PropertyApplicationServiceImpl implements PropertyApplicationService {

    private final PropertyApplicationRepository applications;
    private final ApprovalDecisionRepository decisions;

    public PropertyApplicationServiceImpl(PropertyApplicationRepository applications, ApprovalDecisionRepository decisions) {
        this.applications = applications; this.decisions = decisions;
    }

    @Override @Transactional
    public ApplicationResponse submit(SubmitApplicationRequest r) {
        PropertyApplication a = new PropertyApplication();
        a.setId(UUID.randomUUID());
        a.setOrganizationId(r.organizationId());
        a.setSubmittedPropertyName(r.propertyName());
        a.setPropertyType(PropertyApplicationPropertyType.valueOf(r.propertyType()));
        a.setAddressLine(r.addressLine());
        a.setCity(r.city());
        a.setRegion(r.region());
        a.setPostalCode(r.postalCode());
        a.setCountry(r.country());
        a.setStatus(PropertyApplicationStatus.submitted);
        a.setSubmittedAt(Instant.now());
        a.setCreatedAt(Instant.now());
        a.setUpdatedAt(Instant.now());
        return toResponse(applications.save(a));
    }

    @Override @Transactional
    public ApplicationResponse get(UUID id) { return toResponse(load(id)); }

    @Override @Transactional
    public List<ApplicationResponse> listByOrganization(UUID organizationId) {
        return applications.findByOrganizationId(organizationId).stream()
                .map(PropertyApplicationServiceImpl::toResponse).toList();
    }

    @Override @Transactional
    public ApplicationResponse approve(UUID id) {
        PropertyApplication a = load(id);
        a.setStatus(PropertyApplicationStatus.approved); touch(a);
        decision(a.getId(), ApprovalDecisionOutcome.approved, null);
        return toResponse(a);
    }
    @Override @Transactional
    public ApplicationResponse reject(UUID id, DecisionRequest r) {
        PropertyApplication a = load(id);
        a.setStatus(PropertyApplicationStatus.rejected); touch(a);
        decision(a.getId(), ApprovalDecisionOutcome.rejected, r.reason());
        return toResponse(a);
    }
    @Override @Transactional
    public ApplicationResponse requestMoreInfo(UUID id, DecisionRequest r) {
        PropertyApplication a = load(id);
        a.setStatus(PropertyApplicationStatus.more_info); touch(a);
        decision(a.getId(), ApprovalDecisionOutcome.more_info, r.reason());
        return toResponse(a);
    }
    @Override @Transactional
    public void withdraw(UUID id) {
        PropertyApplication a = load(id);
        a.setStatus(PropertyApplicationStatus.withdrawn); touch(a);
    }

    private void decision(UUID appId, ApprovalDecisionOutcome outcome, String reason) {
        ApprovalDecision d = new ApprovalDecision();
        d.setId(UUID.randomUUID());
        d.setApplicationId(appId);
        d.setOutcome(outcome);
        d.setReason(reason);
        d.setDecidedAt(Instant.now());
        decisions.save(d);
    }
    private PropertyApplication load(UUID id) {
        return applications.findById(id).orElseThrow(() -> new NotFoundException("application " + id + " not found"));
    }
    private void touch(PropertyApplication a) { a.setUpdatedAt(Instant.now()); applications.save(a); }
    private static ApplicationResponse toResponse(PropertyApplication a) {
        return new ApplicationResponse(a.getId(), a.getOrganizationId(), a.getSubmittedPropertyName(),
                a.getStatus() == null ? null : a.getStatus().name(), a.getCreatedPropertyId());
    }
}
