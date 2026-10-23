package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RequestCommentRepository extends JpaRepository<RequestComment, Long> {
    List<RequestComment> findByRequestIdOrderByCreatedAtAsc(Long requestId);
}
