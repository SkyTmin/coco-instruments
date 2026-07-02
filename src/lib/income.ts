// ---------------------------------------------------------------------------
// Income forecasting for Russian pay schemes.
//
// Turns an IncomeSource (оклад, вахта, смены, регулярный, разовый) into dated
// expected payouts and a normalised monthly estimate — the income mirror of
// finance-calc.ts. Amounts are estimates, deliberately transparent rather than
// payroll-exact: they drive the calendar, cashflow and analytics.
//
// Legal basis for the defaults (see the project notes / research):
//  • ТК РФ ст.136 — зарплата не реже каждые полмесяца: two payouts a month
//    (аванс + окончательный расчёт), final no later than the 15th of next month.
//    Роструд: аванс ≈ фактически отработанное, на практике ~40–50% оклада.
//  • ТК РФ ст.301–302 — вахта: надбавка взамен суточных (необлагаемая до 700 ₽/день
//    в РФ), плюс районный коэффициент и северная надбавка на «тело» заработка.
//  • Ночные часы — доплата не ниже 20% (ст.154).
// ---------------------------------------------------------------------------

import type { IncomeSource, RecurringPayment } from '@/types';
import { monthlyEquivalent, recurringOccurrences } from '@/lib/finance-calc';
import { computePayslip } from '@/lib/salary';
import { addMonths, daysInMonth, parseISO, toISO, todayISO } from '@/lib/date';

/** Average calendar days per month (365.25 / 12). */
const AVG_DAYS_PER_MONTH = 30.4375;
export const DEFAULT_ADVANCE_PERCENT = 45;
export const DEFAULT_NIGHT_BONUS_PERCENT = 20;

/** One expected income payout on a specific date. */
export interface IncomeEvent {
  date: string; // ISO
  amount: number; // RUB, rounded
  kind: 'advance' | 'salary' | 'payout';
  sourceId: string;
  name: string;
}

/** Ready-made rotational (вахта) cycles the user can pick in one tap. */
export const VAHTA_PRESETS: { label: string; onDays: number; offDays: number }[] = [
  { label: '15/15', onDays: 15, offDays: 15 },
  { label: '20/10', onDays: 20, offDays: 10 },
  { label: '30/30', onDays: 30, offDays: 30 },
  { label: '45/45', onDays: 45, offDays: 45 },
  { label: '60/30', onDays: 60, offDays: 30 },
];

/** Ready-made shift cycles (on/off days + typical shift length). */
export const SHIFT_PRESETS: {
  label: string;
  onDays: number;
  offDays: number;
  shiftHours: number;
}[] = [
  { label: '2/2', onDays: 2, offDays: 2, shiftHours: 12 },
  { label: '3/3', onDays: 3, offDays: 3, shiftHours: 12 },
  { label: 'сутки/трое', onDays: 1, offDays: 3, shiftHours: 24 },
  { label: 'сутки/двое', onDays: 1, offDays: 2, shiftHours: 24 },
];

const rub = (n: number) => Math.round(n) || 0;

/** Fraction of the cycle spent working (onDays / (onDays + offDays)). */
function onFraction(src: IncomeSource): number {
  const cycle = (src.onDays || 0) + (src.offDays || 0);
  return cycle > 0 ? (src.onDays || 0) / cycle : 0;
}

/** Northern multiplier applied to the "body" of earnings (not to надбавка). */
function northMultiplier(src: IncomeSource): number {
  return (src.districtCoeff || 1) * (1 + (src.northPercent || 0) / 100);
}

/**
 * Estimated monthly income for a вахта source:
 *   dayRate × avg worked days × (районный коэф. × северная) + вахтовая надбавка.
 * The надбавка is NOT multiplied by the coefficients (ст.302).
 */
export function vahtaEstimate(src: IncomeSource): number {
  const workedDays = AVG_DAYS_PER_MONTH * onFraction(src);
  const body = (src.dayRate || 0) * workedDays * northMultiplier(src);
  const allowance = (src.vahtaAllowancePerDay || 0) * workedDays;
  return rub(body + allowance);
}

/**
 * Estimated monthly income for a shift source:
 *   hourRate × shiftHours × shifts/month (+ ночные) × northern coefficients.
 * Night hours are assumed 8h per 24h shift (22:00–06:00), 0 for shorter shifts.
 */
export function shiftEstimate(src: IncomeSource): number {
  const shifts = AVG_DAYS_PER_MONTH * onFraction(src);
  const hours = src.shiftHours || 0;
  const rate = src.hourRate || 0;
  const nightHoursPerShift = hours >= 24 ? 8 : 0;
  const nightPct = src.nightBonusPercent ?? DEFAULT_NIGHT_BONUS_PERCENT;
  const basePay = rate * hours * shifts;
  const nightPay = rate * (nightPct / 100) * nightHoursPerShift * shifts;
  return rub((basePay + nightPay) * northMultiplier(src));
}

/** Normalised monthly income estimate for any source (0 for one-offs). */
export function monthlyIncome(src: IncomeSource): number {
  if (src.paused) return 0;
  // Sources configured through the salary constructor are computed by the
  // payslip engine (exact, per this month's calendar) — not the estimates.
  if (src.salary && (src.scheme === 'salary' || src.scheme === 'vahta' || src.scheme === 'shift')) {
    return computePayslip(src, todayISO().slice(0, 7)).net;
  }
  switch (src.scheme) {
    case 'salary':
      return rub(src.monthlyNet || 0);
    case 'vahta':
      return vahtaEstimate(src);
    case 'shift':
      return shiftEstimate(src);
    case 'recurring':
      return rub(
        monthlyEquivalent(src.monthlyNet || 0, src.intervalCount || 1, src.intervalUnit || 'month'),
      );
    case 'oneoff':
    default:
      return 0;
  }
}

/** Clamp a wished day-of-month to a real day in the given month. */
function dayInMonth(year: number, month0: number, day: number): string {
  const max = daysInMonth(year, month0 + 1);
  return toISO(new Date(year, month0, Math.min(Math.max(1, day || 1), max)));
}

/** Iterate every calendar month that overlaps [fromISO, untilISO]. */
function eachMonth(fromISO: string, untilISO: string, cb: (year: number, month0: number) => void) {
  const from = parseISO(fromISO);
  const until = parseISO(untilISO);
  if (!from || !until) return;
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  let guard = 0;
  while (cursor.getTime() <= until.getTime() && guard < 240) {
    cb(cursor.getFullYear(), cursor.getMonth());
    cursor = addMonths(cursor, 1, 1);
    guard++;
  }
}

/**
 * Split a monthly amount into two dated payouts a month (аванс + зарплата) per
 * ТК ст.136, for every month in the range. Used by salary/vahta/shift.
 */
function twiceMonthly(
  src: IncomeSource,
  monthly: number,
  fromISO: string,
  untilISO: string,
): IncomeEvent[] {
  const pct = Math.min(90, Math.max(10, src.advancePercent ?? DEFAULT_ADVANCE_PERCENT));
  const advance = rub(monthly * (pct / 100));
  const remainder = rub(monthly - advance);
  const advanceDay = src.advanceDay || 25;
  const salaryDay = src.salaryDay || 10;
  const out: IncomeEvent[] = [];
  eachMonth(fromISO, untilISO, (y, m0) => {
    out.push({
      date: dayInMonth(y, m0, salaryDay),
      amount: remainder,
      kind: 'salary',
      sourceId: src.id,
      name: src.name,
    });
    out.push({
      date: dayInMonth(y, m0, advanceDay),
      amount: advance,
      kind: 'advance',
      sourceId: src.id,
      name: src.name,
    });
  });
  return out.filter((e) => e.date >= fromISO && e.date <= untilISO);
}

/**
 * All expected income payouts of a source within [fromISO, untilISO], sorted by
 * date. Paused sources yield nothing.
 */
export function incomeOccurrences(
  src: IncomeSource,
  fromISO: string,
  untilISO: string,
): IncomeEvent[] {
  if (src.paused) return [];
  let events: IncomeEvent[] = [];

  if (src.scheme === 'salary' || src.scheme === 'vahta' || src.scheme === 'shift') {
    if (src.salary) {
      // Salary-constructor sources: amounts differ month to month (calendar!),
      // so compute a payslip per month and emit its advance/salary payouts.
      const advanceDay = src.advanceDay || 25;
      const salaryDay = src.salaryDay || 10;
      const out: IncomeEvent[] = [];
      eachMonth(fromISO, untilISO, (y, m0) => {
        const p = computePayslip(src, `${y}-${String(m0 + 1).padStart(2, '0')}`);
        out.push({
          date: dayInMonth(y, m0, salaryDay),
          amount: p.salary,
          kind: 'salary',
          sourceId: src.id,
          name: src.name,
        });
        out.push({
          date: dayInMonth(y, m0, advanceDay),
          amount: p.advance,
          kind: 'advance',
          sourceId: src.id,
          name: src.name,
        });
      });
      events = out.filter((e) => e.date >= fromISO && e.date <= untilISO);
    } else {
      events = twiceMonthly(src, monthlyIncome(src), fromISO, untilISO);
    }
  } else if (src.scheme === 'recurring') {
    const pseudo = {
      startDate: src.startDate,
      intervalCount: src.intervalCount || 1,
      intervalUnit: src.intervalUnit || 'month',
    } as RecurringPayment;
    events = recurringOccurrences(pseudo, fromISO, untilISO).map((date) => ({
      date,
      amount: rub(src.monthlyNet || 0),
      kind: 'payout' as const,
      sourceId: src.id,
      name: src.name,
    }));
  } else if (src.scheme === 'oneoff') {
    if (src.startDate >= fromISO && src.startDate <= untilISO) {
      events = [
        {
          date: src.startDate,
          amount: rub(src.monthlyNet || 0),
          kind: 'payout',
          sourceId: src.id,
          name: src.name,
        },
      ];
    }
  }

  return events.filter((e) => e.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
}

/** The next expected payout on/after `fromISO` (or null within a 1-year horizon). */
export function nextIncome(src: IncomeSource, fromISO = todayISO()): IncomeEvent | null {
  const until = toISO(addMonths(parseISO(fromISO) ?? new Date(), 12, 1));
  return incomeOccurrences(src, fromISO, until)[0] ?? null;
}

/** Sum of every source's monthly income (for the cashflow dashboard). */
export function totalMonthlyIncome(sources: IncomeSource[]): number {
  return sources.reduce((sum, s) => sum + monthlyIncome(s), 0);
}
