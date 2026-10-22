package com.pmp.ai.persistence;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import com.pmp.ai.types.*;

@Entity
@Table(name = "ai_suggestion")
public class Suggestion {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Enumerated(EnumType.STRING)
    @Column(name = "subject_type")
    private SuggestionSubjectType subjectType;

    @Column(name = "subject_id")
    private UUID subjectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "suggestion_type")
    private SuggestionSuggestionType suggestionType;

    @Column(name = "suggestion")
    private String suggestion;

    @Enumerated(EnumType.STRING)
    @Column(name = "user_decision")
    private SuggestionUserDecision userDecision;

    @Column(name = "created_at")
    private Instant createdAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public SuggestionSubjectType getSubjectType() { return subjectType; }
    public void setSubjectType(SuggestionSubjectType subjectType) { this.subjectType = subjectType; }
    public UUID getSubjectId() { return subjectId; }
    public void setSubjectId(UUID subjectId) { this.subjectId = subjectId; }
    public SuggestionSuggestionType getSuggestionType() { return suggestionType; }
    public void setSuggestionType(SuggestionSuggestionType suggestionType) { this.suggestionType = suggestionType; }
    public String getSuggestion() { return suggestion; }
    public void setSuggestion(String suggestion) { this.suggestion = suggestion; }
    public SuggestionUserDecision getUserDecision() { return userDecision; }
    public void setUserDecision(SuggestionUserDecision userDecision) { this.userDecision = userDecision; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
