package com.pmp.app;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final CurrentUser currentUser;

    public AuthController(AuthService auth, CurrentUser currentUser) {
        this.auth = auth;
        this.currentUser = currentUser;
    }

    @PostMapping("/register")
    public ResponseEntity<Dto.AuthResponse> register(@Valid @RequestBody Dto.RegisterRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED).body(auth.register(req));
    }

    @PostMapping("/login")
    public Dto.AuthResponse login(@Valid @RequestBody Dto.LoginRequest req) {
        return auth.login(req);
    }

    @GetMapping("/me")
    public Dto.AccountView me() {
        return Views.account(currentUser.require());
    }
}
