package com.pmp.app;

import jakarta.persistence.*;
import java.time.Instant;

/** Append-only history. Every status change and assignment writes one row. */
@Entity
@Table(name = "app_request_event",
       indexes = @Index(name = "ix_event_request", columnList = "request_id"))
public class RequestEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "request_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_event_request"))
    private MaintenanceRequest request;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "actor_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_event_actor"))
    private Account actor;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", length = 20)
    private RequestStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", length = 20)
    private RequestStatus toStatus;

    @Column(nullable = false, length = 500)
    private String note;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected RequestEvent() { }

    public RequestEvent(MaintenanceRequest request, Account actor,
                        RequestStatus fromStatus, RequestStatus toStatus, String note) {
        this.request = request;
        this.actor = actor;
        this.fromStatus = fromStatus;
        this.toStatus = toStatus;
        this.note = note;
    }

    public Long getId() { return id; }
    public MaintenanceRequest getRequest() { return request; }
    public Account getActor() { return actor; }
    public RequestStatus getFromStatus() { return fromStatus; }
    public RequestStatus getToStatus() { return toStatus; }
    public String getNote() { return note; }
    public Instant getCreatedAt() { return createdAt; }
}
