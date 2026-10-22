package com.pmp.identity.repository;

import com.pmp.identity.persistence.AccessGrant;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

public interface AccessGrantRepository extends JpaRepository<AccessGrant, UUID> {
    List<AccessGrant> findByUserId(UUID userId);
}
