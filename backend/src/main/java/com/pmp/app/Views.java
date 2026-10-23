package com.pmp.app;

import java.time.format.DateTimeFormatter;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

/** Entity to DTO mapping. Called inside transactional service methods so lazy fields resolve. */
final class Views {

    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm").withZone(ZoneId.systemDefault());

    private Views() { }

    static String stamp(java.time.Instant instant) {
        return instant == null ? null : STAMP.format(instant);
    }

    static Dto.RequestView request(MaintenanceRequest r) {
        return new Dto.RequestView(
                r.getId(), r.getTitle(), r.getDescription(), r.getCategory(), r.getPriority(),
                r.getStatus(), r.getUnit().getLabel(), r.getUnit().getProperty().getName(),
                r.getUnit().getId(),
                r.getReporter().getFullName(), r.getReporter().getId(),
                r.getTechnician() == null ? null : r.getTechnician().getFullName(),
                r.getTechnician() == null ? null : r.getTechnician().getId(),
                r.getCompletionNotes(), r.getPhotoName(), r.getDueDate(), r.isOverdue(),
                stamp(r.getCreatedAt()), stamp(r.getUpdatedAt()),
                new ArrayList<>(r.getStatus().allowedNext()));
    }

    static List<Dto.RequestView> requests(List<MaintenanceRequest> list) {
        List<Dto.RequestView> out = new ArrayList<>();
        for (MaintenanceRequest r : list) out.add(request(r));
        return out;
    }

    static Dto.CommentView comment(RequestComment c) {
        return new Dto.CommentView(c.getId(), c.getAuthor().getFullName(),
                c.getAuthor().getRole(), c.getBody(), stamp(c.getCreatedAt()));
    }

    static Dto.EventView event(RequestEvent e) {
        return new Dto.EventView(e.getId(), e.getActor().getFullName(),
                e.getFromStatus(), e.getToStatus(), e.getNote(), stamp(e.getCreatedAt()));
    }

    static Dto.ExpenseView expense(Expense x) {
        return new Dto.ExpenseView(x.getId(), x.getAmount(), x.getDescription(),
                x.getRecordedBy().getFullName(), x.isApproved(),
                x.getApprovedBy() == null ? null : x.getApprovedBy().getFullName(),
                stamp(x.getCreatedAt()));
    }

    static Dto.PropertyView property(Property p, int unitCount) {
        return new Dto.PropertyView(p.getId(), p.getName(), p.getAddress(),
                p.getPropertyType(), unitCount, p.getManager().getFullName());
    }

    static Dto.UnitView unit(Unit u) {
        return new Dto.UnitView(u.getId(), u.getProperty().getId(),
                u.getProperty().getName(), u.getLabel());
    }

    static Dto.NotificationView notification(Notification n) {
        return new Dto.NotificationView(n.getId(), n.getMessage(), n.getRequestId(),
                n.isRead(), stamp(n.getCreatedAt()));
    }

    static Dto.AccountView account(Account a) {
        return new Dto.AccountView(a.getId(), a.getEmail(), a.getFullName(), a.getRole());
    }
}
