package com.pmp.domain.vendor;

import com.pmp.domain.shared.Guard;
import java.util.UUID;

/** Entity within the Vendor aggregate: a person who performs work for a vendor. */
public class Technician {
    public enum Status { ACTIVE, INACTIVE }
    private final UUID id;
    private final UUID vendorId;
    private String fullName;
    private String phone;
    private Status status = Status.ACTIVE;

    public Technician(UUID vendorId, String fullName, String phone) {
        this.id = Guard.id();
        this.vendorId = Guard.notNull(vendorId, "vendorId");
        this.fullName = Guard.notBlank(fullName, "fullName");
        this.phone = phone;
    }
    public UUID id() { return id; }
    public UUID vendorId() { return vendorId; }
    public String fullName() { return fullName; }
    public Status status() { return status; }
    public void deactivate() { this.status = Status.INACTIVE; }
    public boolean isActive() { return status == Status.ACTIVE; }
}
