package com.pmp.app;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final AccountRepository accounts;

    public JwtAuthFilter(JwtService jwtService, AccountRepository accounts) {
        this.jwtService = jwtService;
        this.accounts = accounts;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {

            String email = jwtService.subjectOf(header.substring(7).trim());
            if (email != null) {
                Optional<Account> found = accounts.findByEmailIgnoreCase(email);
                if (found.isPresent() && found.get().isActive()) {
                    Account account = found.get();
                    var authority = new SimpleGrantedAuthority("ROLE_" + account.getRole().name());
                    var auth = new UsernamePasswordAuthenticationToken(
                            account.getEmail(), null, List.of(authority));
                    SecurityContextHolder.getContext().setAuthentication(auth);
                }
            }
        }
        chain.doFilter(request, response);
    }
}
