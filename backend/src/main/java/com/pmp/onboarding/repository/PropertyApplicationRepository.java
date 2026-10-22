package com.pmp.onboarding.repository;

import com.pmp.onboarding.persistence.PropertyApplication;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface PropertyApplicationRepository extends JpaRepository<PropertyApplication, UUID> {
    List<PropertyApplication> findByOrganizationId(UUID organizationId);
}
