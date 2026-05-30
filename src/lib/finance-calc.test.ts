import { describe, expect, it } from 'vitest';
import type { Obligation, Payment } from '@/types';
import {
  annuityPayment,
  computeObligation,
  computeSavings,
  deriveMonthlyRate,
  paidSoFar,
  progressPercent,
} from './finance-calc';

function payment(amount: number, isPreliminary = false): Payment {
  return { id: Math.random().toString(36), amount, date: '2020-01-01', isPreliminary };
}

function obligation(partial: Partial<Obligation>): Obligation {
  return {
    id: 'x',
    name: 'test',
    type: 'single',
    principalAmount: 0,
    paymentDay: 5,
    termMonths: 1,
    startDate: '2020-01-05',
    status: 'active',
    payments: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('shared helpers', () => {
  it('paidSoFar ignores preliminary payments', () => {
    expect(paidSoFar([payment(100), payment(50, true), payment(25)])).toBe(125);
  });

  it('progressPercent clamps to 0..100', () => {
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(25, 100)).toBe(25);
    expect(progressPercent(150, 100)).toBe(100);
    expect(progressPercent(10, 0)).toBe(0);
  });
});

describe('credit — the worked example (100 000 ₽, 12 mo, 9 456 ₽/mo)', () => {
  const o = obligation({
    type: 'credit',
    principalAmount: 100_000,
    monthlyPayment: 9_456,
    termMonths: 12,
    payments: [payment(9_456), payment(9_456), payment(9_456)],
  });
  const c = computeObligation(o);

  it('totals are exact', () => {
    expect(c.totalToPay).toBe(113_472);
    expect(c.totalOverpayment).toBe(13_472);
    expect(c.monthlyPayment).toBe(9_456);
  });

  it('paid / remaining / progress after 3 payments', () => {
    expect(c.paidSoFar).toBe(28_368);
    expect(c.remaining).toBe(85_104);
    expect(c.progressPercent).toBe(25);
  });

  it('derived annual rate ≈ 24%', () => {
    expect(c.derivedInterestRate).toBeDefined();
    expect(Math.abs((c.derivedInterestRate ?? 0) - 24)).toBeLessThan(1);
  });

  it('amortization schedule has 12 entries and pays down the balance', () => {
    expect(c.schedule).toHaveLength(12);
    // interest shrinks as the balance is paid off
    expect(c.schedule[0].interestPortion).toBeGreaterThan(c.schedule[11].interestPortion);
    const totalPrincipal = c.schedule.reduce((s, e) => s + e.principalPortion, 0);
    expect(Math.round(totalPrincipal)).toBe(100_000);
  });
});

describe('installment — counter-check (100 000 + 13 472 over 12 mo)', () => {
  const o = obligation({
    type: 'installment',
    principalAmount: 100_000,
    overpayment: 13_472,
    termMonths: 12,
  });
  const c = computeObligation(o);

  it('matches the credit totals with zero interest', () => {
    expect(c.totalToPay).toBe(113_472);
    expect(c.totalOverpayment).toBe(13_472);
    expect(c.monthlyPayment).toBe(9_456);
    expect(c.derivedInterestRate).toBeUndefined();
  });

  it('supports per-month overpayment input', () => {
    const c2 = computeObligation(
      obligation({ type: 'installment', principalAmount: 100_000, overpaymentPerMonth: 1_000, termMonths: 12 }),
    );
    expect(c2.totalOverpayment).toBe(12_000);
    expect(c2.totalToPay).toBe(112_000);
  });
});

describe('single payment', () => {
  const c = computeObligation(obligation({ type: 'single', principalAmount: 5_000 }));
  it('total equals principal, no overpayment, term 1', () => {
    expect(c.totalToPay).toBe(5_000);
    expect(c.totalOverpayment).toBe(0);
    expect(c.schedule).toHaveLength(1);
  });
});

describe('credit with interest rate input (no monthly given)', () => {
  it('derives a monthly payment from the annuity formula', () => {
    const c = computeObligation(
      obligation({ type: 'credit', principalAmount: 100_000, interestRate: 24, termMonths: 12 }),
    );
    // 24%/yr → 2%/mo → ≈ 9 456 ₽/mo
    expect(Math.round(c.monthlyPayment)).toBe(9_456);
  });
});

describe('annuity / rate round-trip', () => {
  it('deriveMonthlyRate inverts annuityPayment', () => {
    const monthly = annuityPayment(100_000, 0.02, 12);
    const rate = deriveMonthlyRate(100_000, monthly, 12);
    expect(Math.abs(rate - 0.02)).toBeLessThan(1e-4);
  });
});

describe('savings', () => {
  it('computes progress and remaining', () => {
    const s = computeSavings(100_000, 25_000);
    expect(s.progressPercent).toBe(25);
    expect(s.remaining).toBe(75_000);
    expect(s.requiredPerMonth).toBeNull();
  });
});
