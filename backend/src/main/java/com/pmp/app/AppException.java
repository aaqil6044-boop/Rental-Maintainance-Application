package com.pmp.app;

import org.springframework.http.HttpStatus;

/** A business failure that maps to a specific HTTP status and a message safe to show a user. */
public class AppException extends RuntimeException {

    private final HttpStatus status;

    public AppException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public HttpStatus getStatus() { return status; }

    public static AppException notFound(String what) {
        return new AppException(HttpStatus.NOT_FOUND, what + " was not found.");
    }

    public static AppException forbidden() {
        return new AppException(HttpStatus.FORBIDDEN, "You do not have access to this record.");
    }

    public static AppException badRequest(String message) {
        return new AppException(HttpStatus.BAD_REQUEST, message);
    }

    public static AppException conflict(String message) {
        return new AppException(HttpStatus.CONFLICT, message);
    }
}
