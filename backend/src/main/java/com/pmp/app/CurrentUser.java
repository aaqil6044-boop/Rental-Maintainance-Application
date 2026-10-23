package com.pmp.app;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/** Resolves the signed-in account from the security context. Never trusts a client-supplied id. */
@Component
public class CurrentUser {

    private final AccountRepository accounts;

    public CurrentUser(AccountRepository accounts) {
        this.accounts = accounts;
    }

    public Account require() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || auth.getName() == null) {
            throw new AppException(org.springframework.http.HttpStatus.UNAUTHORIZED, "Not signed in.");
        }
        return accounts.findByEmailIgnoreCase(auth.getName())
                .orElseThrow(() -> new AppException(
                        org.springframework.http.HttpStatus.UNAUTHORIZED, "Session is no longer valid."));
    }

    public void requireRole(Account account, Role... allowed) {
        for (Role r : allowed) {
            if (account.getRole() == r) return;
        }
        throw AppException.forbidden();
    }
}
