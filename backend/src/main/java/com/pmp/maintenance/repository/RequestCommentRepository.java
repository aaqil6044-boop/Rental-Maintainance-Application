package com.pmp.maintenance.repository;

import com.pmp.maintenance.persistence.RequestComment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface RequestCommentRepository extends JpaRepository<RequestComment, UUID> {
    List<RequestComment> findByRequestId(UUID requestId);
}
