package com.pmp.security.api;

import com.pmp.identity.persistence.AppUser;
import com.pmp.identity.repository.AppUserRepository;
import com.pmp.identity.types.AppUserStatus;
import com.pmp.security.api.dto.*;
import com.pmp.security.jwt.JwtService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.security.authentication.*;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Authentication endpoints: register (sign up) and login (issue JWT). */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AppUserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final AuthenticationManager authManager;

    public AuthController(AppUserRepository users, PasswordEncoder encoder,
                          JwtService jwt, AuthenticationManager authManager) {
        this.users = users; this.encoder = encoder; this.jwt = jwt; this.authManager = authManager;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest r) {
        users.findByEmail(r.email()).ifPresent(u -> { throw new IllegalArgumentException("email already registered"); });
        AppUser u = new AppUser();
        u.setId(UUID.randomUUID());
        u.setEmail(r.email());
        u.setFullName(r.fullName());
        u.setPasswordHash(encoder.encode(r.password()));
        u.setStatus(AppUserStatus.active);
        u.setCreatedAt(Instant.now());
        u.setUpdatedAt(Instant.now());
        users.save(u);
        String token = jwt.generate(u.getEmail(), u.getId(), List.of());
        return ResponseEntity.status(HttpStatus.CREATED).body(new AuthResponse(token, u.getId(), u.getEmail()));
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest r) {
        Authentication auth = authManager.authenticate(
                new UsernamePasswordAuthenticationToken(r.email(), r.password()));
        AppUser u = users.findByEmail(r.email()).orElseThrow();
        List<String> roles = auth.getAuthorities().stream().map(GrantedAuthority::getAuthority).toList();
        String token = jwt.generate(u.getEmail(), u.getId(), roles);
        return ResponseEntity.ok(new AuthResponse(token, u.getId(), u.getEmail()));
    }
}
