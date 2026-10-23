package com.pmp.app;

import java.lang.reflect.Field;
import java.util.*;

/** In-memory stand-ins for the JPA repositories, so the real services can be exercised. */
final class Fakes {

    static long SEQ = 0;

    static <T> T withId(T entity) {
        try {
            Field f = entity.getClass().getDeclaredField("id");
            f.setAccessible(true);
            if (f.get(entity) == null) f.set(entity, ++SEQ);
        } catch (Exception e) { throw new RuntimeException(e); }
        return entity;
    }

    static Long idOf(Object entity) {
        try {
            Field f = entity.getClass().getDeclaredField("id");
            f.setAccessible(true);
            return (Long) f.get(entity);
        } catch (Exception e) { throw new RuntimeException(e); }
    }

    static class Accounts implements AccountRepository {
        final List<Account> all = new ArrayList<>();
        public <S extends Account> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<Account> findById(Long id) {
            return all.stream().filter(a -> idOf(a).equals(id)).findFirst(); }
        public List<Account> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { all.removeIf(a -> idOf(a).equals(id)); }
        public boolean existsById(Long id) { return findById(id).isPresent(); }
        public Optional<Account> findByEmailIgnoreCase(String email) {
            return all.stream().filter(a -> a.getEmail().equalsIgnoreCase(email)).findFirst(); }
        public boolean existsByEmailIgnoreCase(String email) { return findByEmailIgnoreCase(email).isPresent(); }
        public List<Account> findByRoleAndActiveTrue(Role role) {
            List<Account> out = new ArrayList<>();
            for (Account a : all) if (a.getRole() == role && a.isActive()) out.add(a);
            return out; }
    }

    static class Properties implements PropertyRepository {
        final List<Property> all = new ArrayList<>();
        public <S extends Property> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<Property> findById(Long id) { return all.stream().filter(p -> idOf(p).equals(id)).findFirst(); }
        public List<Property> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return findById(id).isPresent(); }
        public List<Property> findByActiveTrueOrderByNameAsc() {
            List<Property> o = new ArrayList<>();
            for (Property p : all) if (p.isActive()) o.add(p);
            o.sort(Comparator.comparing(Property::getName)); return o; }
        public List<Property> findByManagerIdAndActiveTrueOrderByNameAsc(Long managerId) {
            List<Property> o = new ArrayList<>();
            for (Property p : all) if (p.isActive() && idOf(p.getManager()).equals(managerId)) o.add(p);
            return o; }
    }

    static class Units implements UnitRepository {
        final List<Unit> all = new ArrayList<>();
        public <S extends Unit> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<Unit> findById(Long id) { return all.stream().filter(u -> idOf(u).equals(id)).findFirst(); }
        public List<Unit> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return findById(id).isPresent(); }
        public List<Unit> findByPropertyIdAndActiveTrueOrderByLabelAsc(Long propertyId) {
            List<Unit> o = new ArrayList<>();
            for (Unit u : all) if (u.isActive() && idOf(u.getProperty()).equals(propertyId)) o.add(u);
            return o; }
        public Optional<Unit> findByPropertyIdAndLabelIgnoreCase(Long pid, String label) {
            return all.stream().filter(u -> idOf(u.getProperty()).equals(pid)
                    && u.getLabel().equalsIgnoreCase(label)).findFirst(); }
        public boolean existsByPropertyIdAndLabelIgnoreCase(Long pid, String label) {
            return findByPropertyIdAndLabelIgnoreCase(pid, label).isPresent(); }
    }

    static class Assignments implements UnitAssignmentRepository {
        final List<UnitAssignment> all = new ArrayList<>();
        public <S extends UnitAssignment> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<UnitAssignment> findById(Long id) { return all.stream().filter(a -> idOf(a).equals(id)).findFirst(); }
        public List<UnitAssignment> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return findById(id).isPresent(); }
        public List<UnitAssignment> findByTenantId(Long tenantId) {
            List<UnitAssignment> o = new ArrayList<>();
            for (UnitAssignment a : all) if (idOf(a.getTenant()).equals(tenantId)) o.add(a);
            return o; }
        public boolean existsByTenantIdAndUnitId(Long tenantId, Long unitId) {
            for (UnitAssignment a : all)
                if (idOf(a.getTenant()).equals(tenantId) && idOf(a.getUnit()).equals(unitId)) return true;
            return false; }
    }

    static class Requests implements MaintenanceRequestRepository {
        final List<MaintenanceRequest> all = new ArrayList<>();
        public <S extends MaintenanceRequest> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<MaintenanceRequest> findById(Long id) { return all.stream().filter(r -> idOf(r).equals(id)).findFirst(); }
        public List<MaintenanceRequest> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return findById(id).isPresent(); }
        public List<MaintenanceRequest> findByReporterIdOrderByCreatedAtDesc(Long rid) {
            List<MaintenanceRequest> o = new ArrayList<>();
            for (MaintenanceRequest r : all) if (idOf(r.getReporter()).equals(rid)) o.add(r);
            return o; }
        public List<MaintenanceRequest> findByTechnicianIdOrderByCreatedAtDesc(Long tid) {
            List<MaintenanceRequest> o = new ArrayList<>();
            for (MaintenanceRequest r : all)
                if (r.getTechnician() != null && idOf(r.getTechnician()).equals(tid)) o.add(r);
            return o; }
        public List<MaintenanceRequest> findAllByOrderByCreatedAtDesc() { return all; }
        public List<MaintenanceRequest> findByStatusOrderByCreatedAtDesc(RequestStatus s) {
            List<MaintenanceRequest> o = new ArrayList<>();
            for (MaintenanceRequest r : all) if (r.getStatus() == s) o.add(r);
            return o; }
        public List<MaintenanceRequest> findByUnitPropertyIdOrderByCreatedAtDesc(Long pid) { return all; }
        public long countByStatus(RequestStatus s) { return findByStatusOrderByCreatedAtDesc(s).size(); }
        public long countByPriorityAndStatusNot(Priority p, RequestStatus s) {
            long n = 0; for (MaintenanceRequest r : all) if (r.getPriority() == p && r.getStatus() != s) n++;
            return n; }
    }

    static class Comments implements RequestCommentRepository {
        final List<RequestComment> all = new ArrayList<>();
        public <S extends RequestComment> S save(S e) { withId(e); all.add(e); return e; }
        public Optional<RequestComment> findById(Long id) { return all.stream().filter(c -> idOf(c).equals(id)).findFirst(); }
        public List<RequestComment> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return false; }
        public List<RequestComment> findByRequestIdOrderByCreatedAtAsc(Long rid) {
            List<RequestComment> o = new ArrayList<>();
            for (RequestComment c : all) if (idOf(c.getRequest()).equals(rid)) o.add(c);
            return o; }
    }

    static class Events implements RequestEventRepository {
        final List<RequestEvent> all = new ArrayList<>();
        public <S extends RequestEvent> S save(S e) { withId(e); all.add(e); return e; }
        public Optional<RequestEvent> findById(Long id) { return all.stream().filter(x -> idOf(x).equals(id)).findFirst(); }
        public List<RequestEvent> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return false; }
        public List<RequestEvent> findByRequestIdOrderByCreatedAtAsc(Long rid) {
            List<RequestEvent> o = new ArrayList<>();
            for (RequestEvent e : all) if (idOf(e.getRequest()).equals(rid)) o.add(e);
            return o; }
        public List<RequestEvent> findTop10ByOrderByCreatedAtDesc() {
            List<RequestEvent> o = new ArrayList<>(all);
            Collections.reverse(o);
            return o.subList(0, Math.min(10, o.size())); }
    }

    static class Expenses implements ExpenseRepository {
        final List<Expense> all = new ArrayList<>();
        public <S extends Expense> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<Expense> findById(Long id) { return all.stream().filter(x -> idOf(x).equals(id)).findFirst(); }
        public List<Expense> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return false; }
        public List<Expense> findByRequestIdOrderByCreatedAtAsc(Long rid) {
            List<Expense> o = new ArrayList<>();
            for (Expense x : all) if (idOf(x.getRequest()).equals(rid)) o.add(x);
            return o; }
        public List<Expense> findByApprovedTrue() {
            List<Expense> o = new ArrayList<>();
            for (Expense x : all) if (x.isApproved()) o.add(x);
            return o; }
    }

    static class Notifications implements NotificationRepository {
        final List<Notification> all = new ArrayList<>();
        public <S extends Notification> S save(S e) { withId(e); if (!all.contains(e)) all.add(e); return e; }
        public Optional<Notification> findById(Long id) { return all.stream().filter(n -> idOf(n).equals(id)).findFirst(); }
        public List<Notification> findAll() { return all; }
        public long count() { return all.size(); }
        public void deleteById(Long id) { }
        public boolean existsById(Long id) { return false; }
        public List<Notification> findTop50ByRecipientIdOrderByCreatedAtDesc(Long rid) {
            List<Notification> o = new ArrayList<>();
            for (Notification n : all) if (idOf(n.getRecipient()).equals(rid)) o.add(n);
            return o; }
        public long countByRecipientIdAndReadFalse(Long rid) {
            long n = 0;
            for (Notification x : all) if (idOf(x.getRecipient()).equals(rid) && !x.isRead()) n++;
            return n; }
    }
}
