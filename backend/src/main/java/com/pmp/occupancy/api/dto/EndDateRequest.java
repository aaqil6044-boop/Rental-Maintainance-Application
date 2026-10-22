package com.pmp.occupancy.api.dto;
import jakarta.validation.constraints.*;
import java.time.LocalDate;
public record EndDateRequest(@NotNull LocalDate endDate) {}
