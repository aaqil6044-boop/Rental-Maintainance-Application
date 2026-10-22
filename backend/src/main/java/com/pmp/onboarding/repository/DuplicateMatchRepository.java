package com.pmp.onboarding.repository;

import com.pmp.onboarding.persistence.DuplicateMatch;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface DuplicateMatchRepository extends JpaRepository<DuplicateMatch, UUID> {
    List<DuplicateMatch> findByApplicationId(UUID applicationId);
}
