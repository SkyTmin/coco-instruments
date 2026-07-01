import { describe, expect, it } from 'vitest';

import type { IncomeSource } from '@/types';
import {
  incomeOccurrences,
  monthlyIncome,
  nextIncome,
  shiftEstimate,
  vahtaEstimate,
} from '@/lib/income';

const base = (over: Partial<IncomeSource>): IncomeSource => ({
  id: 's1',
  name: 'Работа',
  scheme: 'salary',
  startDate: '2026-01-01',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('salary (оклад: аванс + зарплата, ТК ст.136)', () => {
  it('splits the month into two payouts on the configured days', () => {
    const src = base({
      scheme: 'salary',
      monthlyNet: 100000,
      advancePercent: 45,
      advanceDay: 25,
      salaryDay: 10,
    });
    const events = incomeOccurrences(src, '2026-07-01', '2026-07-31');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ date: '2026-07-10', amount: 55000, kind: 'salary' });
    expect(events[1]).toMatchObject({ date: '2026-07-25', amount: 45000, kind: 'advance' });
  });

  it('yields two payouts for every month in the range', () => {
    const src = base({ scheme: 'salary', monthlyNet: 60000 });
    const events = incomeOccurrences(src, '2026-07-01', '2026-08-31');
    expect(events).toHaveLength(4);
  });

  it('clamps a day-31 payout into short months', () => {
    const src = base({ scheme: 'salary', monthlyNet: 50000, advanceDay: 31, salaryDay: 15 });
    const events = incomeOccurrences(src, '2026-02-01', '2026-02-28');
    // February has no 31st → clamped to the 28th.
    expect(events.some((e) => e.date === '2026-02-28' && e.kind === 'advance')).toBe(true);
  });
});

describe('vahta (вахта)', () => {
  it('estimates 30/30 with надбавка and northern coefficients', () => {
    const src = base({
      scheme: 'vahta',
      dayRate: 5000,
      onDays: 30,
      offDays: 30,
      vahtaAllowancePerDay: 700,
      districtCoeff: 1.7,
      northPercent: 50,
    });
    // dayRate·15.21875·(1.7·1.5) + 700·15.21875 = 194039.0625 + 10653.125
    expect(vahtaEstimate(src)).toBe(204692);
  });

  it('does NOT multiply the надбавка by the district coefficient', () => {
    const common = { scheme: 'vahta' as const, dayRate: 4000, onDays: 15, offDays: 15 };
    const noAllowance = vahtaEstimate(base({ ...common, districtCoeff: 2 }));
    const withAllowance = vahtaEstimate(
      base({ ...common, districtCoeff: 2, vahtaAllowancePerDay: 700 }),
    );
    const workedDays = 30.4375 * 0.5;
    // The delta is exactly the (un-multiplied) allowance.
    expect(withAllowance - noAllowance).toBe(Math.round(700 * workedDays));
  });
});

describe('shift (сменный график)', () => {
  it('estimates a 2/2 twelve-hour schedule with no night bonus', () => {
    const src = base({ scheme: 'shift', hourRate: 300, onDays: 2, offDays: 2, shiftHours: 12 });
    // 300·12·15.21875 = 54787.5
    expect(shiftEstimate(src)).toBe(54788);
  });

  it('adds a night bonus for 24-hour shifts only', () => {
    const day = base({ scheme: 'shift', hourRate: 200, onDays: 2, offDays: 2, shiftHours: 12 });
    const night = base({ scheme: 'shift', hourRate: 200, onDays: 1, offDays: 3, shiftHours: 24 });
    // 12h shift: night bonus % has no effect.
    expect(shiftEstimate({ ...day, nightBonusPercent: 0 })).toBe(
      shiftEstimate({ ...day, nightBonusPercent: 20 }),
    );
    // 24h shift: night bonus raises the estimate.
    expect(shiftEstimate({ ...night, nightBonusPercent: 20 })).toBeGreaterThan(
      shiftEstimate({ ...night, nightBonusPercent: 0 }),
    );
  });
});

describe('recurring & oneoff', () => {
  it('repeats a monthly recurring income', () => {
    const src = base({
      scheme: 'recurring',
      monthlyNet: 40000,
      intervalCount: 1,
      intervalUnit: 'month',
      startDate: '2026-07-05',
    });
    const events = incomeOccurrences(src, '2026-07-01', '2026-09-30');
    expect(events.map((e) => e.date)).toEqual(['2026-07-05', '2026-08-05', '2026-09-05']);
    expect(events.every((e) => e.amount === 40000)).toBe(true);
  });

  it('fires a one-off only inside the range', () => {
    const src = base({ scheme: 'oneoff', monthlyNet: 15000, startDate: '2026-07-20' });
    expect(incomeOccurrences(src, '2026-07-01', '2026-07-31')).toHaveLength(1);
    expect(incomeOccurrences(src, '2026-08-01', '2026-08-31')).toHaveLength(0);
  });
});

describe('monthlyIncome & nextIncome', () => {
  it('is zero for paused sources and one-offs', () => {
    expect(monthlyIncome(base({ scheme: 'salary', monthlyNet: 50000, paused: true }))).toBe(0);
    expect(monthlyIncome(base({ scheme: 'oneoff', monthlyNet: 50000 }))).toBe(0);
  });

  it('finds the next upcoming payout', () => {
    const src = base({ scheme: 'salary', monthlyNet: 80000, advanceDay: 25, salaryDay: 10 });
    const next = nextIncome(src, '2026-07-12');
    expect(next?.date).toBe('2026-07-25');
  });
});
