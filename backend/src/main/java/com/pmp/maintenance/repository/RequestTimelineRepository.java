package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.RequestTimeline;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequestTimelineRepository extends JpaRepository<RequestTimeline, UUID> {
    List<RequestTimeline> findByRequestId(UUID requestId);
}
