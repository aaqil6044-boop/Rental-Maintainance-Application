package com.pmp.property.api;
import com.pmp.property.api.dto.*;
import java.util.List;
import java.util.UUID;
public interface PropertyService {
    PropertyResponse create(CreatePropertyRequest request);
    PropertyResponse get(UUID id);
    List<PropertyResponse> listByOrganization(UUID organizationId);
    void activate(UUID id);
    void suspend(UUID id);
    void deactivate(UUID id);
    BuildingResponse addBuilding(UUID propertyId, CreateBuildingRequest request);
    UnitResponse addUnit(UUID propertyId, CreateUnitRequest request);
    List<UnitResponse> bulkAddUnits(UUID propertyId, BulkCreateUnitsRequest request);
    List<UnitResponse> listUnits(UUID propertyId);
}
