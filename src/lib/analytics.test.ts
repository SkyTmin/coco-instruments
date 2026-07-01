import { describe, expect, it } from 'vitest';

import type { IncomeSource, Transaction } from '@/types';
import { cashflowByMonth, monthlyForecast, spendByCategory } from '@/lib/analytics';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2),
  direction: 'expense',
  amount: 0,
  date: '2026-07-01',
  category: 'other',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('spendByCategory', () => {
  const txs = [
    tx({ amount: 1000, category: 'food', date: '2026-07-03' }),
    tx({ amount: 500, category: 'food', date: '2026-07-10' }),
    tx({ amount: 3000, category: 'transport', date: '2026-07-05' }),
    tx({ amount: 999, category: 'food', date: '2026-08-01' }), // out of range
    tx({ amount: 800, category: 'food', direction: 'income', date: '2026-07-04' }), // income ignored
  ];

  it('sums expenses per category, largest first, with shares', () => {
    const slices = spendByCategory(txs, '2026-07-01', '2026-07-31');
    expect(slices.map((s) => s.category)).toEqual(['transport', 'food']);
    expect(slices[0].amount).toBe(3000);
    expect(slices[1].amount).toBe(1500);
    // Total = 4500 → food is 1/3.
    expect(Math.round(slices[1].percent)).toBe(33);
    expect(slices[0].label).toBe('Транспорт');
  });
});

describe('cashflowByMonth', () => {
  it('buckets income and expense into the trailing months', () => {
    const txs = [
      tx({ amount: 100000, direction: 'income', date: '2026-07-05' }),
      tx({ amount: 40000, direction: 'expense', date: '2026-07-06' }),
      tx({ amount: 20000, direction: 'expense', date: '2026-06-20' }),
    ];
    const rows = cashflowByMonth(txs, 3, '2026-07-15');
    expect(rows.map((r) => r.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    const jul = rows.find((r) => r.month === '2026-07')!;
    expect(jul.income).toBe(100000);
    expect(jul.expense).toBe(40000);
    expect(jul.net).toBe(60000);
    expect(rows.find((r) => r.month === '2026-06')!.net).toBe(-20000);
  });
});

describe('monthlyForecast', () => {
  it('is income minus scheduled outgoings for the month', () => {
    const sources: IncomeSource[] = [
      {
        id: 'i1',
        name: 'Оклад',
        scheme: 'salary',
        monthlyNet: 90000,
        startDate: '2026-01-01',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const recurring = [
      {
        id: 'r1',
        name: 'Аренда',
        amount: 30000,
        intervalCount: 1,
        intervalUnit: 'month' as const,
        startDate: '2026-07-10',
        createdAt: 0,
        updatedAt: 0,
      },
    ];
    const f = monthlyForecast(sources, [], recurring, '2026-07-01');
    expect(f.income).toBe(90000);
    expect(f.outgoings).toBe(30000);
    expect(f.free).toBe(60000);
  });
});
