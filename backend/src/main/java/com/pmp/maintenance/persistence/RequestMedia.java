package com.pmp.maintenance.persistence;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import com.pmp.maintenance.types.*;

@Entity
@Table(name = "maintenance_request_media")
public class RequestMedia {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "request_id")
    private UUID requestId;

    @Column(name = "file_ref")
    private String fileRef;

    @Enumerated(EnumType.STRING)
    @Column(name = "media_type")
    private RequestMediaMediaType mediaType;

    @Column(name = "uploaded_at")
    private Instant uploadedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getRequestId() { return requestId; }
    public void setRequestId(UUID requestId) { this.requestId = requestId; }
    public String getFileRef() { return fileRef; }
    public void setFileRef(String fileRef) { this.fileRef = fileRef; }
    public RequestMediaMediaType getMediaType() { return mediaType; }
    public void setMediaType(RequestMediaMediaType mediaType) { this.mediaType = mediaType; }
    public Instant getUploadedAt() { return uploadedAt; }
    public void setUploadedAt(Instant uploadedAt) { this.uploadedAt = uploadedAt; }
}
