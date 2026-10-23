package com.pmp.app;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;

@Entity
@Table(name = "app_expense",
       indexes = @Index(name = "ix_expense_request", columnList = "request_id"))
public class Expense {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "request_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_expense_request"))
    private MaintenanceRequest request;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "recorded_by_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_expense_recorder"))
    private Account recordedBy;

    /** Monetary values use a fixed-scale decimal, never a floating point type. */
    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Column(nullable = false, length = 300)
    private String description;

    @Column(nullable = false)
    private boolean approved = false;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approved_by_id",
                foreignKey = @ForeignKey(name = "fk_expense_approver"))
    private Account approvedBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected Expense() { }

    public Expense(MaintenanceRequest request, Account recordedBy, BigDecimal amount, String description) {
        this.request = request;
        this.recordedBy = recordedBy;
        this.amount = amount;
        this.description = description;
    }

    public Long getId() { return id; }
    public MaintenanceRequest getRequest() { return request; }
    public Account getRecordedBy() { return recordedBy; }
    public BigDecimal getAmount() { return amount; }
    public String getDescription() { return description; }
    public boolean isApproved() { return approved; }
    public Account getApprovedBy() { return approvedBy; }
    public Instant getCreatedAt() { return createdAt; }

    public void approve(Account approver) {
        this.approved = true;
        this.approvedBy = approver;
    }
}
