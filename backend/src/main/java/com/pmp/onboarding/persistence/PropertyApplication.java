package com.pmp.onboarding.persistence;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;
import com.pmp.onboarding.types.*;

@Entity
@Table(name = "onboarding_property_application")
public class PropertyApplication {

    @Id
    @Column(name = "id")
    private UUID id;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "submitted_property_name")
    private String submittedPropertyName;

    @Enumerated(EnumType.STRING)
    @Column(name = "property_type")
    private PropertyApplicationPropertyType propertyType;

    @Column(name = "address_line")
    private String addressLine;

    @Column(name = "city")
    private String city;

    @Column(name = "region")
    private String region;

    @Column(name = "postal_code")
    private String postalCode;

    @Column(name = "country")
    private String country;

    @Enumerated(EnumType.STRING)
    @Column(name = "status")
    private PropertyApplicationStatus status;

    @Column(name = "created_property_id")
    private UUID createdPropertyId;

    @Column(name = "submitted_by")
    private UUID submittedBy;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }
    public UUID getOrganizationId() { return organizationId; }
    public void setOrganizationId(UUID organizationId) { this.organizationId = organizationId; }
    public String getSubmittedPropertyName() { return submittedPropertyName; }
    public void setSubmittedPropertyName(String submittedPropertyName) { this.submittedPropertyName = submittedPropertyName; }
    public PropertyApplicationPropertyType getPropertyType() { return propertyType; }
    public void setPropertyType(PropertyApplicationPropertyType propertyType) { this.propertyType = propertyType; }
    public String getAddressLine() { return addressLine; }
    public void setAddressLine(String addressLine) { this.addressLine = addressLine; }
    public String getCity() { return city; }
    public void setCity(String city) { this.city = city; }
    public String getRegion() { return region; }
    public void setRegion(String region) { this.region = region; }
    public String getPostalCode() { return postalCode; }
    public void setPostalCode(String postalCode) { this.postalCode = postalCode; }
    public String getCountry() { return country; }
    public void setCountry(String country) { this.country = country; }
    public PropertyApplicationStatus getStatus() { return status; }
    public void setStatus(PropertyApplicationStatus status) { this.status = status; }
    public UUID getCreatedPropertyId() { return createdPropertyId; }
    public void setCreatedPropertyId(UUID createdPropertyId) { this.createdPropertyId = createdPropertyId; }
    public UUID getSubmittedBy() { return submittedBy; }
    public void setSubmittedBy(UUID submittedBy) { this.submittedBy = submittedBy; }
    public Instant getSubmittedAt() { return submittedAt; }
    public void setSubmittedAt(Instant submittedAt) { this.submittedAt = submittedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
