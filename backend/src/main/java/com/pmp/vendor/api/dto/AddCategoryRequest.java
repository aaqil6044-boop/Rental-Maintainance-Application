package com.pmp.vendor.api.dto;
import jakarta.validation.constraints.*;
public record AddCategoryRequest(@NotBlank String category) {}
