package com.pmp.api.common;

import com.pmp.domain.shared.DomainException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.time.Instant;

/** Maps domain and application exceptions to HTTP responses.
 *  DomainException (invariant / illegal state) -> 409 Conflict.
 *  NotFoundException -> 404.  IllegalArgumentException -> 400. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(DomainException.class)
    public ResponseEntity<ApiError> handleDomain(DomainException ex) {
        return build(HttpStatus.CONFLICT, ex.getMessage());
    }
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ApiError> handleNotFound(NotFoundException ex) {
        return build(HttpStatus.NOT_FOUND, ex.getMessage());
    }
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiError> handleBadRequest(IllegalArgumentException ex) {
        return build(HttpStatus.BAD_REQUEST, ex.getMessage());
    }
    private ResponseEntity<ApiError> build(HttpStatus status, String message) {
        ApiError err = new ApiError(Instant.now(), status.value(), status.name(), message, null);
        return ResponseEntity.status(status).body(err);
    }
}
