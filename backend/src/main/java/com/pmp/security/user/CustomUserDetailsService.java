package com.pmp.security.user;

import com.pmp.identity.persistence.AppUser;
import com.pmp.identity.repository.*;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.*;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Loads a user and their authorities from the data layer:
 * app_user -> organization_membership -> role_assignment -> role.
 */
@Service
public class CustomUserDetailsService implements UserDetailsService {

    private final AppUserRepository users;
    private final OrganizationMembershipRepository memberships;
    private final RoleAssignmentRepository assignments;
    private final RoleRepository roles;

    public CustomUserDetailsService(AppUserRepository users, OrganizationMembershipRepository memberships,
                                    RoleAssignmentRepository assignments, RoleRepository roles) {
        this.users = users; this.memberships = memberships;
        this.assignments = assignments; this.roles = roles;
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        AppUser user = users.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("no user: " + email));

        Set<GrantedAuthority> authorities = new HashSet<>();
        memberships.findByUserId(user.getId()).forEach(m ->
            assignments.findByMembershipId(m.getId()).forEach(ra ->
                roles.findById(ra.getRoleId()).ifPresent(r ->
                    authorities.add(new SimpleGrantedAuthority("ROLE_" + r.getName().name().toUpperCase())))));

        String password = user.getPasswordHash() == null ? "" : user.getPasswordHash();
        boolean enabled = user.getStatus() == null || user.getStatus().name().equals("active");

        return User.builder()
                .username(user.getEmail())
                .password(password)
                .authorities(authorities)
                .disabled(!enabled)
                .build();
    }
}
