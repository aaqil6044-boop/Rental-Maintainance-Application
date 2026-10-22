package com.pmp.domain.billing;

import com.pmp.domain.shared.Guard;
import com.pmp.domain.shared.Money;
import java.util.UUID;

/** Aggregate root. Normal authorization, or emergency with a cap + post-hoc approval. */
public class WorkAuthorization {
    public enum Type { NORMAL, EMERGENCY }
    private final UUID id;
    private final UUID workOrderId;
    private final Type type;
    private final Money cap;      // emergency only
    private final String reason;  // required for emergency
    private UUID postHocApprovedBy;

    private WorkAuthorization(UUID workOrderId, Type type, Money cap, String reason) {
        this.id = Guard.id();
        this.workOrderId = Guard.notNull(workOrderId, "workOrderId");
        this.type = type;
        this.cap = cap;
        this.reason = reason;
    }
    public static WorkAuthorization normal(UUID workOrderId) {
        return new WorkAuthorization(workOrderId, Type.NORMAL, null, null);
    }
    public static WorkAuthorization emergency(UUID workOrderId, Money cap, String reason) {
        Guard.notNull(cap, "cap");
        Guard.notBlank(reason, "reason");
        return new WorkAuthorization(workOrderId, Type.EMERGENCY, cap, reason);
    }
    public UUID id() { return id; }
    public Type type() { return type; }

    /** Emergency authorizations must be approved after the fact. */
    public void postHocApprove(UUID approver) {
        Guard.require(type == Type.EMERGENCY, "only emergency authorizations need post-hoc approval");
        this.postHocApprovedBy = Guard.notNull(approver, "approver");
    }
    public boolean needsPostHocApproval() { return type == Type.EMERGENCY && postHocApprovedBy == null; }
}
