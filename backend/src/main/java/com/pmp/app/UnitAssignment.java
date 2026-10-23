package com.pmp.app;

import jakarta.persistence.*;
import java.time.Instant;

/** Links a tenant account to the unit they occupy. A tenant may report only against these. */
@Entity
@Table(name = "app_unit_assignment",
       uniqueConstraints = @UniqueConstraint(name = "uk_assignment_tenant_unit",
                                             columnNames = {"tenant_id", "unit_id"}))
public class UnitAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_assignment_tenant"))
    private Account tenant;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unit_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_assignment_unit"))
    private Unit unit;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    protected UnitAssignment() { }

    public UnitAssignment(Account tenant, Unit unit) {
        this.tenant = tenant;
        this.unit = unit;
    }

    public Long getId() { return id; }
    public Account getTenant() { return tenant; }
    public Unit getUnit() { return unit; }
}
