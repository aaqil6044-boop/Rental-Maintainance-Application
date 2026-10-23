package com.pmp.app;

import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;

/**
 * Development seed data only. Runs under the dev profile, and does nothing if accounts already
 * exist, so it is safe to start the application repeatedly.
 */
@Component
@Profile("dev")
public class DevSeeder implements CommandLineRunner {

    private final AccountRepository accounts;
    private final PropertyRepository properties;
    private final UnitRepository units;
    private final UnitAssignmentRepository assignments;
    private final MaintenanceRequestRepository requests;
    private final RequestEventRepository events;
    private final PasswordEncoder encoder;

    public DevSeeder(AccountRepository accounts, PropertyRepository properties, UnitRepository units,
                     UnitAssignmentRepository assignments, MaintenanceRequestRepository requests,
                     RequestEventRepository events, PasswordEncoder encoder) {
        this.accounts = accounts;
        this.properties = properties;
        this.units = units;
        this.assignments = assignments;
        this.requests = requests;
        this.events = events;
        this.encoder = encoder;
    }

    @Override
    @Transactional
    public void run(String... args) {
        if (accounts.count() > 0) {
            return;
        }

        Account manager = accounts.save(new Account("manager@estateops.test",
                encoder.encode("password123"), "Maya Iqbal", Role.MANAGER));
        Account tech = accounts.save(new Account("tech@estateops.test",
                encoder.encode("password123"), "Sanjay Nair", Role.TECHNICIAN));
        Account tenant = accounts.save(new Account("tenant@estateops.test",
                encoder.encode("password123"), "Riya Thomas", Role.TENANT));

        Property rosewood = properties.save(new Property("Rosewood Residency",
                "12 Rosewood Avenue", "complex", manager));
        Property lakeview = properties.save(new Property("Lakeview Enclave",
                "4 Lakeview Road", "apartment", manager));

        Unit u7b = units.save(new Unit(rosewood, "7B"));
        Unit u9c = units.save(new Unit(rosewood, "9C"));
        units.save(new Unit(lakeview, "2A"));

        assignments.save(new UnitAssignment(tenant, u7b));
        assignments.save(new UnitAssignment(tenant, u9c));

        MaintenanceRequest leak = new MaintenanceRequest(u7b, tenant,
                "Kitchen tap leaking continuously",
                "Water runs from the base of the mixer tap even when closed.",
                Category.PLUMBING, Priority.HIGH);
        leak.setDueDate(LocalDate.now().plusDays(2));
        requests.save(leak);
        events.save(new RequestEvent(leak, tenant, null, RequestStatus.REPORTED, "Request raised"));

        MaintenanceRequest ac = new MaintenanceRequest(u9c, tenant,
                "Air conditioning not cooling",
                "The bedroom unit runs but the air stays warm.",
                Category.HVAC, Priority.MEDIUM);
        requests.save(ac);
        events.save(new RequestEvent(ac, tenant, null, RequestStatus.REPORTED, "Request raised"));

        System.out.println("[DevSeeder] Seeded dev accounts: "
                + "manager@estateops.test / tech@estateops.test / tenant@estateops.test "
                + "(password: password123)");
    }
}
