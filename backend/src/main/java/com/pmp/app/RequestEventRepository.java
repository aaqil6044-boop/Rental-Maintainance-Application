package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RequestEventRepository extends JpaRepository<RequestEvent, Long> {
    List<RequestEvent> findByRequestIdOrderByCreatedAtAsc(Long requestId);
    List<RequestEvent> findTop10ByOrderByCreatedAtDesc();
}
