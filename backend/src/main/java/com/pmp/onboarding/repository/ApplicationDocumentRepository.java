package com.pmp.onboarding.repository;

import com.pmp.onboarding.persistence.ApplicationDocument;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ApplicationDocumentRepository extends JpaRepository<ApplicationDocument, UUID> {
    List<ApplicationDocument> findByApplicationId(UUID applicationId);
}
