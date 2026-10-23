package com.pmp.app;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "app_request_comment",
       indexes = @Index(name = "ix_comment_request", columnList = "request_id"))
public class RequestComment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "request_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_comment_request"))
    private MaintenanceRequest request;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "author_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_comment_author"))
    private Account author;

    @Column(nullable = false, length = 2000)
    private String body;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected RequestComment() { }

    public RequestComment(MaintenanceRequest request, Account author, String body) {
        this.request = request;
        this.author = author;
        this.body = body;
    }

    public Long getId() { return id; }
    public MaintenanceRequest getRequest() { return request; }
    public Account getAuthor() { return author; }
    public String getBody() { return body; }
    public Instant getCreatedAt() { return createdAt; }
}
