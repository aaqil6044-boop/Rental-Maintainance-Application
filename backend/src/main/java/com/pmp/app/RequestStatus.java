package com.pmp.app;

import java.util.EnumSet;
import java.util.Set;

/**
 * The maintenance lifecycle. Transitions are declared here and enforced in RequestService,
 * so an invalid move is rejected by the server rather than prevented only in the UI.
 */
public enum RequestStatus {
    REPORTED,
    UNDER_REVIEW,
    ASSIGNED,
    IN_PROGRESS,
    COMPLETED,
    CLOSED,
    REOPENED;

    public Set<RequestStatus> allowedNext() {
        switch (this) {
            case REPORTED:     return EnumSet.of(UNDER_REVIEW, CLOSED);
            case UNDER_REVIEW: return EnumSet.of(ASSIGNED, CLOSED);
            case ASSIGNED:     return EnumSet.of(IN_PROGRESS, UNDER_REVIEW);
            case IN_PROGRESS:  return EnumSet.of(COMPLETED);
            case COMPLETED:    return EnumSet.of(CLOSED, REOPENED);
            case CLOSED:       return EnumSet.of(REOPENED);
            case REOPENED:     return EnumSet.of(ASSIGNED, UNDER_REVIEW);
            default:           return EnumSet.noneOf(RequestStatus.class);
        }
    }

    public boolean canMoveTo(RequestStatus next) {
        return allowedNext().contains(next);
    }

    public boolean isOpen() {
        return this != CLOSED;
    }
}
