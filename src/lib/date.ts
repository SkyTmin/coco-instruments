/** Date helpers operating on ISO 'YYYY-MM-DD' strings (no timezone surprises). */

import type { IntervalUnit } from '@/types';

export function todayISO(): string {
  return toISO(new Date());
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseISO(iso: string): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Number of days in a given month (1-based month). */
export function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** Add `n` months to a base date, clamping the day to the target month length. */
export function addMonths(base: Date, n: number, clampDay?: number): Date {
  const year = base.getFullYear();
  const month0 = base.getMonth() + n;
  const targetYear = year + Math.floor(month0 / 12);
  const targetMonth0 = ((month0 % 12) + 12) % 12;
  const wantDay = clampDay ?? base.getDate();
  const maxDay = daysInMonth(targetYear, targetMonth0 + 1);
  return new Date(targetYear, targetMonth0, Math.min(wantDay, maxDay));
}

/** Whole months elapsed between two ISO dates (>= 0). */
export function monthsBetween(fromISO: string, toISODate: string): number {
  const a = parseISO(fromISO);
  const b = parseISO(toISODate);
  if (!a || !b) return 0;
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1; // not a full month yet
  return Math.max(0, months);
}

/**
 * Due date of the k-th payment (1-based) for a schedule that starts at
 * `startDate` and is due on `paymentDay` each month.
 */
export function paymentDueDate(startISO: string, paymentDay: number, k: number): string {
  const start = parseISO(startISO) ?? new Date();
  // First payment is in the start month; subsequent ones add months.
  const due = addMonths(start, k - 1, paymentDay);
  return toISO(due);
}

/** Add `n` calendar days to a date. */
export function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** Advance a date by one recurring interval (count × unit). */
export function addInterval(base: Date, count: number, unit: IntervalUnit): Date {
  if (unit === 'day') return addDays(base, count);
  if (unit === 'week') return addDays(base, count * 7);
  if (unit === 'month') return addMonths(base, count);
  return addMonths(base, count * 12); // year
}
