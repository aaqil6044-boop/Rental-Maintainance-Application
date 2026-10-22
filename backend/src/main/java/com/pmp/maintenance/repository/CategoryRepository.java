package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.Category;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface CategoryRepository extends JpaRepository<Category, UUID> {
    List<Category> findByOrganizationId(UUID organizationId);
}
