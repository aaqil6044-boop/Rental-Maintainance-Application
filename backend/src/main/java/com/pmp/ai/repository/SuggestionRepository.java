package com.pmp.ai.repository;

import com.pmp.ai.persistence.Suggestion;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface SuggestionRepository extends JpaRepository<Suggestion, UUID> {
    List<Suggestion> findByOrganizationId(UUID organizationId);
    List<Suggestion> findBySubjectId(UUID subjectId);
}
