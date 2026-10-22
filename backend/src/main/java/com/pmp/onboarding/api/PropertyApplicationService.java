package com.pmp.onboarding.api;
import com.pmp.onboarding.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface PropertyApplicationService {
    ApplicationResponse submit(SubmitApplicationRequest request);
    ApplicationResponse get(UUID id);
    List<ApplicationResponse> listByOrganization(UUID organizationId);
    ApplicationResponse approve(UUID id);
    ApplicationResponse reject(UUID id, DecisionRequest request);
    ApplicationResponse requestMoreInfo(UUID id, DecisionRequest request);
    void withdraw(UUID id);
}
