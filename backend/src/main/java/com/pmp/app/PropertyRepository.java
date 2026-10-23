package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PropertyRepository extends JpaRepository<Property, Long> {
    List<Property> findByActiveTrueOrderByNameAsc();
    List<Property> findByManagerIdAndActiveTrueOrderByNameAsc(Long managerId);
}
