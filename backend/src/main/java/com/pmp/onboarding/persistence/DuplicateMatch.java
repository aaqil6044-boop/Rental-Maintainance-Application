package com.pmp.onboarding.persistence;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.util.UUID;

@Entity
@Table(name = "onboarding_duplicate_match")
public class DuplicateMatch {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "application_id")
    private UUID applicationId;

    @Column(name = "matched_property_id")
    private UUID matchedPropertyId;

    @Column(name = "score")
    private BigDecimal score;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getApplicationId() { return applicationId; }
    public void setApplicationId(UUID applicationId) { this.applicationId = applicationId; }
    public UUID getMatchedPropertyId() { return matchedPropertyId; }
    public void setMatchedPropertyId(UUID matchedPropertyId) { this.matchedPropertyId = matchedPropertyId; }
    public BigDecimal getScore() { return score; }
    public void setScore(BigDecimal score) { this.score = score; }
}
