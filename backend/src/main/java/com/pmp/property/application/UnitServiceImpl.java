package com.pmp.property.application;

import com.pmp.api.common.NotFoundException;
import com.pmp.property.api.UnitService;
import com.pmp.property.api.dto.UnitResponse;
import com.pmp.property.persistence.Unit;
import com.pmp.property.repository.UnitRepository;
import com.pmp.property.types.UnitStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.UUID;

@Service
public class UnitServiceImpl implements UnitService {
    private final UnitRepository units;
    public UnitServiceImpl(UnitRepository units) { this.units = units; }

    @Override @Transactional
    public UnitResponse get(UUID id) {
        Unit u = units.findById(id).orElseThrow(() -> new NotFoundException("unit " + id + " not found"));
        return new UnitResponse(u.getId(), u.getPropertyId(), u.getBuildingId(), u.getFloorId(),
                u.getUnitIdentifier(), u.getStatus() == null ? null : u.getStatus().name());
    }
    @Override @Transactional
    public void deactivate(UUID id) {
        Unit u = units.findById(id).orElseThrow(() -> new NotFoundException("unit " + id + " not found"));
        u.setStatus(UnitStatus.deactivated); units.save(u);
    }
}
