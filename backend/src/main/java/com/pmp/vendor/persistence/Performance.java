package com.pmp.vendor.persistence;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "vendor_performance")
public class Performance {

    @Id
    @Column(name = "vendor_id")
    private UUID vendorId;

    @Column(name = "acceptance_rate")
    private BigDecimal acceptanceRate;

    @Column(name = "avg_completion_hours")
    private BigDecimal avgCompletionHours;

    @Column(name = "repeat_repair_rate")
    private BigDecimal repeatRepairRate;

    @Column(name = "jobs_completed")
    private Integer jobsCompleted;

    @Column(name = "updated_at")
    private Instant updatedAt;

    public UUID getVendorId() { return vendorId; }
    public void setVendorId(UUID vendorId) { this.vendorId = vendorId; }
    public BigDecimal getAcceptanceRate() { return acceptanceRate; }
    public void setAcceptanceRate(BigDecimal acceptanceRate) { this.acceptanceRate = acceptanceRate; }
    public BigDecimal getAvgCompletionHours() { return avgCompletionHours; }
    public void setAvgCompletionHours(BigDecimal avgCompletionHours) { this.avgCompletionHours = avgCompletionHours; }
    public BigDecimal getRepeatRepairRate() { return repeatRepairRate; }
    public void setRepeatRepairRate(BigDecimal repeatRepairRate) { this.repeatRepairRate = repeatRepairRate; }
    public Integer getJobsCompleted() { return jobsCompleted; }
    public void setJobsCompleted(Integer jobsCompleted) { this.jobsCompleted = jobsCompleted; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
