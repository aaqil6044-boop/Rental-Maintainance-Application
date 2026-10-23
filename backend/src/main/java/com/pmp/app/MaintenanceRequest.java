package com.pmp.app;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "app_request", indexes = {
    @Index(name = "ix_request_status", columnList = "status"),
    @Index(name = "ix_request_unit", columnList = "unit_id"),
    @Index(name = "ix_request_technician", columnList = "technician_id"),
    @Index(name = "ix_request_reporter", columnList = "reporter_id")
})
public class MaintenanceRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unit_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_request_unit"))
    private Unit unit;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "reporter_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_request_reporter"))
    private Account reporter;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "technician_id",
                foreignKey = @ForeignKey(name = "fk_request_technician"))
    private Account technician;

    @Column(nullable = false, length = 160)
    private String title;

    @Column(nullable = false, length = 4000)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Category category = Category.OTHER;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Priority priority = Priority.MEDIUM;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private RequestStatus status = RequestStatus.REPORTED;

    @Column(name = "photo_name", length = 255)
    private String photoName;

    @Column(name = "completion_notes", length = 2000)
    private String completionNotes;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @Column(name = "closed_at")
    private Instant closedAt;

    protected MaintenanceRequest() { }

    public MaintenanceRequest(Unit unit, Account reporter, String title, String description,
                              Category category, Priority priority) {
        this.unit = unit;
        this.reporter = reporter;
        this.title = title;
        this.description = description;
        if (category != null) this.category = category;
        if (priority != null) this.priority = priority;
    }

    public Long getId() { return id; }
    public Unit getUnit() { return unit; }
    public Account getReporter() { return reporter; }
    public Account getTechnician() { return technician; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public Category getCategory() { return category; }
    public Priority getPriority() { return priority; }
    public RequestStatus getStatus() { return status; }
    public String getPhotoName() { return photoName; }
    public String getCompletionNotes() { return completionNotes; }
    public LocalDate getDueDate() { return dueDate; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getClosedAt() { return closedAt; }

    public void setTechnician(Account technician) { this.technician = technician; touch(); }
    public void setCategory(Category category) { this.category = category; touch(); }
    public void setPriority(Priority priority) { this.priority = priority; touch(); }
    public void setDueDate(LocalDate dueDate) { this.dueDate = dueDate; touch(); }
    public void setPhotoName(String photoName) { this.photoName = photoName; touch(); }
    public void setCompletionNotes(String notes) { this.completionNotes = notes; touch(); }

    public void setStatus(RequestStatus status) {
        this.status = status;
        this.closedAt = (status == RequestStatus.CLOSED) ? Instant.now() : null;
        touch();
    }

    public boolean isOverdue() {
        return dueDate != null && status.isOpen() && dueDate.isBefore(LocalDate.now());
    }

    private void touch() { this.updatedAt = Instant.now(); }
}
