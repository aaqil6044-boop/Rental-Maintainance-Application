package com.pmp.app;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "app_property")
public class Property {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 160)
    private String name;

    @Column(length = 255)
    private String address;

    @Column(name = "property_type", nullable = false, length = 40)
    private String propertyType = "complex";

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "manager_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_property_manager"))
    private Account manager;

    @Column(nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected Property() { }

    public Property(String name, String address, String propertyType, Account manager) {
        this.name = name;
        this.address = address;
        this.propertyType = propertyType;
        this.manager = manager;
    }

    public Long getId() { return id; }
    public String getName() { return name; }
    public String getAddress() { return address; }
    public String getPropertyType() { return propertyType; }
    public Account getManager() { return manager; }
    public boolean isActive() { return active; }
    public Instant getCreatedAt() { return createdAt; }

    public void setName(String name) { this.name = name; }
    public void setAddress(String address) { this.address = address; }
    public void setPropertyType(String propertyType) { this.propertyType = propertyType; }
    public void setActive(boolean active) { this.active = active; }
}
