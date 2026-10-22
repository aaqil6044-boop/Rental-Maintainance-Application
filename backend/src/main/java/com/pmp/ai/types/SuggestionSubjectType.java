package com.pmp.ai.types;

/** Constant names intentionally match the MySQL ENUM values exactly,
 *  so @Enumerated(EnumType.STRING) round-trips without a converter. */
public enum SuggestionSubjectType {
    request, work_order
}
