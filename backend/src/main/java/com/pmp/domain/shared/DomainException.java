package com.pmp.domain.shared;

/** Thrown when a domain invariant or state transition is violated. */
public class DomainException extends RuntimeException {
    public DomainException(String message) { super(message); }
}
