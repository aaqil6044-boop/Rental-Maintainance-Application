package com.pmp.occupancy.api;
import com.pmp.occupancy.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface OccupancyService {
    OwnershipResponse startOwnership(CreateOwnershipRequest request);
    void endOwnership(UUID ownershipId, EndDateRequest request);
    List<OwnershipResponse> listOwnerships(UUID unitId);
    TenancyResponse startTenancy(CreateTenancyRequest request);
    void endTenancy(UUID tenancyId, EndDateRequest request);
    List<TenancyResponse> listTenancies(UUID unitId);
}
