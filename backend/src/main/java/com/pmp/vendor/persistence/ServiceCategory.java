package com.pmp.vendor.persistence;

import jakarta.persistence.*;
import java.util.UUID;
import com.pmp.vendor.types.*;

@Entity
@Table(name = "vendor_service_category")
public class ServiceCategory {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "vendor_id")
    private UUID vendorId;

    @Enumerated(EnumType.STRING)
    @Column(name = "category")
    private ServiceCategoryCategory category;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getVendorId() { return vendorId; }
    public void setVendorId(UUID vendorId) { this.vendorId = vendorId; }
    public ServiceCategoryCategory getCategory() { return category; }
    public void setCategory(ServiceCategoryCategory category) { this.category = category; }
}
