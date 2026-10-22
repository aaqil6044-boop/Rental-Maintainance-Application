package com.pmp.onboarding.repository;

import com.pmp.onboarding.persistence.ApprovalDecision;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface ApprovalDecisionRepository extends JpaRepository<ApprovalDecision, UUID> {
    List<ApprovalDecision> findByApplicationId(UUID applicationId);
}
