package com.pmp.app;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private final AccountRepository accounts;
    private final PasswordEncoder encoder;
    private final JwtService jwt;

    public AuthService(AccountRepository accounts, PasswordEncoder encoder, JwtService jwt) {
        this.accounts = accounts;
        this.encoder = encoder;
        this.jwt = jwt;
    }

    @Transactional
    public Dto.AuthResponse register(Dto.RegisterRequest req) {
        String email = req.email().trim().toLowerCase();
        if (accounts.existsByEmailIgnoreCase(email)) {
            throw AppException.conflict("That email is already registered. Switch to Sign in.");
        }
        Role role = req.role() == null ? Role.TENANT : req.role();
        Account account = new Account(email, encoder.encode(req.password()), req.fullName().trim(), role);
        accounts.save(account);
        return toResponse(account);
    }

    @Transactional(readOnly = true)
    public Dto.AuthResponse login(Dto.LoginRequest req) {
        Account account = accounts.findByEmailIgnoreCase(req.email().trim())
                .orElseThrow(() -> new AppException(HttpStatus.UNAUTHORIZED, "Wrong email or password."));

        if (!account.isActive()) {
            throw new AppException(HttpStatus.FORBIDDEN, "This account has been deactivated.");
        }
        if (!encoder.matches(req.password(), account.getPasswordHash())) {
            throw new AppException(HttpStatus.UNAUTHORIZED, "Wrong email or password.");
        }
        return toResponse(account);
    }

    private Dto.AuthResponse toResponse(Account account) {
        return new Dto.AuthResponse(jwt.issue(account), account.getEmail(),
                account.getFullName(), account.getRole(), account.getId());
    }
}
