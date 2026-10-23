package com.pmp.app;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "app_notification",
       indexes = @Index(name = "ix_notification_recipient", columnList = "recipient_id"))
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "recipient_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_notification_recipient"))
    private Account recipient;

    @Column(nullable = false, length = 300)
    private String message;

    @Column(name = "request_id")
    private Long requestId;

    @Column(name = "read_flag", nullable = false)
    private boolean read = false;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected Notification() { }

    public Notification(Account recipient, String message, Long requestId) {
        this.recipient = recipient;
        this.message = message;
        this.requestId = requestId;
    }

    public Long getId() { return id; }
    public Account getRecipient() { return recipient; }
    public String getMessage() { return message; }
    public Long getRequestId() { return requestId; }
    public boolean isRead() { return read; }
    public Instant getCreatedAt() { return createdAt; }

    public void markRead() { this.read = true; }
}
