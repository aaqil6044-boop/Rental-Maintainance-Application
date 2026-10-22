package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.RequestMedia;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequestMediaRepository extends JpaRepository<RequestMedia, UUID> {
    List<RequestMedia> findByRequestId(UUID requestId);
}
