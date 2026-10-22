package com.pmp.property.api;
import com.pmp.property.api.dto.*;
import java.util.UUID;
public interface UnitService {
    UnitResponse get(UUID id);
    void deactivate(UUID id);
}
