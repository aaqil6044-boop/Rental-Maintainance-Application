package com.pmp.domain.shared;

import java.math.BigDecimal;
import java.util.Objects;

/** Immutable monetary value object. */
public final class Money {
    private final BigDecimal amount;
    private final String currency;

    public Money(BigDecimal amount, String currency) {
        Guard.notNull(amount, "amount");
        Guard.require(amount.signum() >= 0, "amount must not be negative");
        Guard.notBlank(currency, "currency");
        this.amount = amount;
        this.currency = currency;
    }
    public BigDecimal amount() { return amount; }
    public String currency() { return currency; }

    public Money add(Money other) {
        Guard.require(currency.equals(other.currency), "currency mismatch");
        return new Money(amount.add(other.amount), currency);
    }
    public boolean exceeds(Money limit) {
        Guard.require(currency.equals(limit.currency), "currency mismatch");
        return amount.compareTo(limit.amount) > 0;
    }
    @Override public boolean equals(Object o) {
        if (!(o instanceof Money m)) return false;
        return amount.compareTo(m.amount) == 0 && currency.equals(m.currency);
    }
    @Override public int hashCode() { return Objects.hash(amount.stripTrailingZeros(), currency); }
    @Override public String toString() { return amount + " " + currency; }
}
