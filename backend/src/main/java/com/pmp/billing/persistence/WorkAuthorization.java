package com.pmp.billing.persistence;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;
import com.pmp.billing.types.*;

@Entity
@Table(name = "billing_work_authorization")
public class WorkAuthorization {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "work_order_id")
    private UUID workOrderId;

    @Enumerated(EnumType.STRING)
    @Column(name = "authorization_type")
    private WorkAuthorizationAuthorizationType authorizationType;

    @Column(name = "cap_amount")
    private BigDecimal capAmount;

    @Column(name = "reason")
    private String reason;

    @Column(name = "authorized_by")
    private UUID authorizedBy;

    @Column(name = "post_hoc_approved_by")
    private UUID postHocApprovedBy;

    @Column(name = "authorized_at")
    private Instant authorizedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public UUID getWorkOrderId() { return workOrderId; }
    public void setWorkOrderId(UUID workOrderId) { this.workOrderId = workOrderId; }
    public WorkAuthorizationAuthorizationType getAuthorizationType() { return authorizationType; }
    public void setAuthorizationType(WorkAuthorizationAuthorizationType authorizationType) { this.authorizationType = authorizationType; }
    public BigDecimal getCapAmount() { return capAmount; }
    public void setCapAmount(BigDecimal capAmount) { this.capAmount = capAmount; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public UUID getAuthorizedBy() { return authorizedBy; }
    public void setAuthorizedBy(UUID authorizedBy) { this.authorizedBy = authorizedBy; }
    public UUID getPostHocApprovedBy() { return postHocApprovedBy; }
    public void setPostHocApprovedBy(UUID postHocApprovedBy) { this.postHocApprovedBy = postHocApprovedBy; }
    public Instant getAuthorizedAt() { return authorizedAt; }
    public void setAuthorizedAt(Instant authorizedAt) { this.authorizedAt = authorizedAt; }
}
