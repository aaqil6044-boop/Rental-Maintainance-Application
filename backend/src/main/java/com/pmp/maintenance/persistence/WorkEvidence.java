package com.pmp.maintenance.persistence;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "maintenance_work_evidence")
public class WorkEvidence {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "work_order_id")
    private UUID workOrderId;

    @Column(name = "file_ref")
    private String fileRef;

    @Column(name = "note")
    private String note;

    @Column(name = "uploaded_at")
    private Instant uploadedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getWorkOrderId() { return workOrderId; }
    public void setWorkOrderId(UUID workOrderId) { this.workOrderId = workOrderId; }
    public String getFileRef() { return fileRef; }
    public void setFileRef(String fileRef) { this.fileRef = fileRef; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public Instant getUploadedAt() { return uploadedAt; }
    public void setUploadedAt(Instant uploadedAt) { this.uploadedAt = uploadedAt; }
}
