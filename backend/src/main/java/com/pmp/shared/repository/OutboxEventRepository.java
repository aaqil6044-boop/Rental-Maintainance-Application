package com.pmp.shared.repository;

import com.pmp.shared.persistence.OutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {
    List<OutboxEvent> findByOrganizationId(UUID organizationId);
}
