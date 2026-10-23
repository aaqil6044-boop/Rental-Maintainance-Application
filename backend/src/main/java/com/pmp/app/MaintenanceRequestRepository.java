package com.pmp.app;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MaintenanceRequestRepository extends JpaRepository<MaintenanceRequest, Long> {
    List<MaintenanceRequest> findByReporterIdOrderByCreatedAtDesc(Long reporterId);
    List<MaintenanceRequest> findByTechnicianIdOrderByCreatedAtDesc(Long technicianId);
    List<MaintenanceRequest> findAllByOrderByCreatedAtDesc();
    List<MaintenanceRequest> findByStatusOrderByCreatedAtDesc(RequestStatus status);
    List<MaintenanceRequest> findByUnitPropertyIdOrderByCreatedAtDesc(Long propertyId);
    long countByStatus(RequestStatus status);
    long countByPriorityAndStatusNot(Priority priority, RequestStatus status);
}
