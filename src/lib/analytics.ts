// ---------------------------------------------------------------------------
// Cashflow analytics — "куда уходят деньги" and income-vs-expense over time.
//
// Two complementary tracks, kept separate so nothing is double-counted:
//  • ACTUAL   — aggregated from logged Transactions (what really happened).
//  • FORECAST — expected monthly income (IncomeSource) minus expected outgoings
//               (obligation schedules + recurring payments).
// ---------------------------------------------------------------------------

import type { IncomeSource, Obligation, RecurringPayment, Transaction } from '@/types';
import { collectPayments } from '@/lib/finance-calc';
import { getCategory } from '@/lib/categories';
import { totalMonthlyIncome } from '@/lib/income';
import { addMonths, daysInMonth, parseISO, toISO, todayISO } from '@/lib/date';

/** 'YYYY-MM' bucket key for an ISO date. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** First/last ISO day of the calendar month containing `iso`. */
export function monthBounds(iso: string): { from: string; until: string } {
  const d = parseISO(iso) ?? new Date();
  const y = d.getFullYear();
  const m0 = d.getMonth();
  return {
    from: toISO(new Date(y, m0, 1)),
    until: toISO(new Date(y, m0, daysInMonth(y, m0 + 1))),
  };
}

export interface CategorySlice {
  category: string;
  label: string;
  emoji: string;
  color: string;
  amount: number;
  /** Share of the total, 0..100. */
  percent: number;
}

/**
 * Expense transactions grouped by category within [fromISO, untilISO],
 * largest first, with each slice's share of the total.
 */
export function spendByCategory(
  transactions: Transaction[],
  fromISO: string,
  untilISO: string,
): CategorySlice[] {
  const totals = new Map<string, number>();
  let grand = 0;
  for (const t of transactions) {
    if (t.direction !== 'expense') continue;
    if (t.date < fromISO || t.date > untilISO) continue;
    totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
    grand += t.amount;
  }
  return [...totals.entries()]
    .map(([category, amount]) => {
      const c = getCategory(category, 'expense');
      return {
        category,
        label: c.label,
        emoji: c.emoji,
        color: c.color,
        amount,
        percent: grand > 0 ? (amount / grand) * 100 : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface MonthCashflow {
  month: string; // 'YYYY-MM'
  income: number;
  expense: number;
  net: number;
}

/**
 * Logged income vs expense for the last `monthsBack` months (oldest first),
 * including the current month. Purely from transactions.
 */
export function cashflowByMonth(
  transactions: Transaction[],
  monthsBack = 6,
  refISO = todayISO(),
): MonthCashflow[] {
  const ref = parseISO(refISO) ?? new Date();
  const buckets: MonthCashflow[] = [];
  const index = new Map<string, MonthCashflow>();
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = addMonths(ref, -i, 1);
    const key = toISO(d).slice(0, 7);
    const row = { month: key, income: 0, expense: 0, net: 0 };
    buckets.push(row);
    index.set(key, row);
  }
  for (const t of transactions) {
    const row = index.get(monthKey(t.date));
    if (!row) continue;
    if (t.direction === 'income') row.income += t.amount;
    else row.expense += t.amount;
  }
  for (const row of buckets) row.net = row.income - row.expense;
  return buckets;
}

export interface MonthlyForecast {
  income: number;
  outgoings: number;
  free: number;
}

/**
 * Expected free money this month: total monthly income from all sources minus
 * everything scheduled to go out (obligation payments + recurring) this month.
 */
export function monthlyForecast(
  sources: IncomeSource[],
  expenses: Obligation[],
  recurring: RecurringPayment[],
  refISO = todayISO(),
): MonthlyForecast {
  const income = totalMonthlyIncome(sources);
  const { from, until } = monthBounds(refISO);
  const outgoings = collectPayments(from, until, expenses, recurring).reduce(
    (sum, p) => sum + p.amount,
    0,
  );
  return { income, outgoings: Math.round(outgoings), free: Math.round(income - outgoings) };
}
