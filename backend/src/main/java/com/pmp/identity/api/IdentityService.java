package com.pmp.identity.api;
import com.pmp.identity.api.dto.*;
import java.util.UUID;
public interface IdentityService {
    UserResponse invite(InviteUserRequest request);
    UserResponse get(UUID userId);
    void activate(UUID userId);
    void disable(UUID userId);
    void assignRole(AssignRoleRequest request);
    void revokeRole(UUID assignmentId);
}
