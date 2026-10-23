package com.pmp.app;

import jakarta.persistence.*;

@Entity
@Table(name = "app_unit",
       uniqueConstraints = @UniqueConstraint(name = "uk_unit_label_per_property",
                                             columnNames = {"property_id", "label"}))
public class Unit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "property_id", nullable = false,
                foreignKey = @ForeignKey(name = "fk_unit_property"))
    private Property property;

    @Column(nullable = false, length = 40)
    private String label;

    @Column(nullable = false)
    private boolean active = true;

    protected Unit() { }

    public Unit(Property property, String label) {
        this.property = property;
        this.label = label;
    }

    public Long getId() { return id; }
    public Property getProperty() { return property; }
    public String getLabel() { return label; }
    public boolean isActive() { return active; }

    public void setLabel(String label) { this.label = label; }
    public void setActive(boolean active) { this.active = active; }
}
