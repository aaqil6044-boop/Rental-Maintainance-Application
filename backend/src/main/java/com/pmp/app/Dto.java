package com.pmp.app;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** All request and response shapes, kept together so the API surface is readable in one place. */
public final class Dto {

    private Dto() { }

    // ---- auth ----
    public record RegisterRequest(
            @NotBlank @Email String email,
            @NotBlank @Size(min = 6, max = 72) String password,
            @NotBlank @Size(max = 120) String fullName,
            Role role) { }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank String password) { }

    public record AuthResponse(String token, String email, String fullName, Role role, Long accountId) { }

    public record AccountView(Long id, String email, String fullName, Role role) { }

    // ---- property and unit ----
    public record CreatePropertyRequest(
            @NotBlank @Size(max = 160) String name,
            @Size(max = 255) String address,
            @Size(max = 40) String propertyType) { }

    public record PropertyView(Long id, String name, String address, String propertyType,
                               int unitCount, String managerName) { }

    public record CreateUnitRequest(
            @NotNull Long propertyId,
            @NotBlank @Size(max = 40) String label) { }

    public record UnitView(Long id, Long propertyId, String propertyName, String label) { }

    // ---- requests ----
    public record CreateRequestRequest(
            @NotNull Long unitId,
            @NotBlank @Size(max = 160) String title,
            @NotBlank @Size(max = 4000) String description,
            Category category,
            Priority priority,
            @Size(max = 255) String photoName) { }

    public record RequestView(
            Long id, String title, String description, Category category, Priority priority,
            RequestStatus status, String unitLabel, String propertyName, Long unitId,
            String reporterName, Long reporterId, String technicianName, Long technicianId,
            String completionNotes, String photoName, LocalDate dueDate, boolean overdue,
            String createdAt, String updatedAt, List<RequestStatus> allowedNext) { }

    public record RequestDetailView(RequestView request, List<CommentView> comments,
                                    List<EventView> history, List<ExpenseView> expenses,
                                    BigDecimal totalExpense) { }

    public record TransitionRequest(
            @NotNull RequestStatus target,
            @Size(max = 500) String note,
            @Size(max = 2000) String completionNotes) { }

    public record AssignRequest(
            @NotNull Long technicianId,
            LocalDate dueDate,
            Priority priority,
            Category category) { }

    public record CommentRequest(@NotBlank @Size(max = 2000) String body) { }

    public record CommentView(Long id, String authorName, Role authorRole, String body, String createdAt) { }

    public record EventView(Long id, String actorName, RequestStatus fromStatus,
                            RequestStatus toStatus, String note, String createdAt) { }

    // ---- expenses ----
    public record ExpenseRequest(
            @NotNull @Positive BigDecimal amount,
            @NotBlank @Size(max = 300) String description) { }

    public record ExpenseView(Long id, BigDecimal amount, String description,
                              String recordedByName, boolean approved, String approvedByName,
                              String createdAt) { }

    // ---- notifications ----
    public record NotificationView(Long id, String message, Long requestId, boolean read, String createdAt) { }

    // ---- dashboard ----
    public record DashboardView(
            Role role,
            long openRequests,
            long highPriority,
            long overdue,
            long inProgress,
            long completedAwaitingReview,
            long closedTotal,
            BigDecimal monthlySpend,
            Double averageTurnaroundDays,
            long unreadNotifications,
            List<RequestView> attention,
            List<EventView> recentActivity) { }
}
