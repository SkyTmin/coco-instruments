import type {
  ExpenseType,
  IntervalUnit,
  Obligation,
  ObligationComputed,
  ObligationStatus,
  Payment,
  RecurringComputed,
  RecurringPayment,
  ScheduleEntry,
} from '@/types';
import { addInterval, monthsBetween, parseISO, paymentDueDate, toISO, todayISO } from './date';

// ---------------------------------------------------------------------------
// Pure finance math. No React, no side effects — fully unit-testable.
// Shared paid/remaining/progress/status logic is ported from legacy js/debts.js.
// ---------------------------------------------------------------------------

/** Sum of real (non-preliminary) payments. Ported from debts.js. */
export function paidSoFar(payments: Payment[]): number {
  return payments.filter((p) => !p.isPreliminary).reduce((sum, p) => sum + (p.amount || 0), 0);
}

export function remainingOf(totalToPay: number, paid: number): number {
  return Math.max(0, totalToPay - paid);
}

export function progressPercent(paid: number, totalToPay: number): number {
  if (totalToPay <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((paid / totalToPay) * 100)));
}

export function deriveStatus(paid: number, totalToPay: number): ObligationStatus {
  if (totalToPay > 0 && paid >= totalToPay) return 'closed';
  if (paid > 0) return 'partial';
  return 'active';
}

/** Annuity payment for principal P at monthly rate i over n months. */
export function annuityPayment(p: number, i: number, n: number): number {
  if (n <= 0) return 0;
  if (i === 0) return p / n;
  return (p * i) / (1 - Math.pow(1 + i, -n));
}

/**
 * Solve for the monthly interest rate implied by (principal, monthly payment, term)
 * via bisection. Returns 0 when there is no overpayment.
 */
export function deriveMonthlyRate(principal: number, monthly: number, term: number): number {
  if (principal <= 0 || term <= 0) return 0;
  if (monthly * term <= principal + 1e-6) return 0;
  let lo = 0;
  let hi = 1; // 100%/month upper bound — far above any real loan
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    const pay = annuityPayment(principal, mid, term);
    if (pay > monthly) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

interface Resolved {
  totalToPay: number;
  totalOverpayment: number;
  monthlyPayment: number;
  termMonths: number;
  monthlyRate: number; // monthly interest rate used for amortization (credit only)
}

/** Resolve the headline numbers for an obligation based on its type. */
export function resolve(o: Obligation): Resolved {
  const principal = Math.max(0, o.principalAmount || 0);

  if (o.type === 'single') {
    return {
      totalToPay: principal,
      totalOverpayment: 0,
      monthlyPayment: principal,
      termMonths: 1,
      monthlyRate: 0,
    };
  }

  const term = Math.max(1, Math.round(o.termMonths || 1));

  if (o.type === 'installment') {
    // Installment can be defined by any of: principal (тело), monthlyPayment,
    // totalAmount, overpayment. We resolve total + monthly from whatever is known,
    // preferring explicit total/monthly over a derived principal.
    let total = 0;
    if (o.totalAmount && o.totalAmount > 0) {
      total = o.totalAmount;
    } else if (o.monthlyPayment && o.monthlyPayment > 0) {
      total = o.monthlyPayment * term;
    } else if (principal > 0) {
      const overTotal =
        o.overpayment != null
          ? Math.max(0, o.overpayment)
          : o.overpaymentPerMonth != null
            ? Math.max(0, o.overpaymentPerMonth) * term
            : 0;
      total = principal + overTotal;
    } else if (o.monthlyPayment) {
      total = o.monthlyPayment * term;
    }
    const monthly = o.monthlyPayment && o.monthlyPayment > 0 ? o.monthlyPayment : total / term;
    // Overpayment is only meaningful when we know the body (principal).
    const overpayment = principal > 0 ? Math.max(0, total - principal) : 0;
    return {
      totalToPay: total,
      totalOverpayment: overpayment,
      monthlyPayment: monthly,
      termMonths: term,
      monthlyRate: 0,
    };
  }

  // credit
  if (o.monthlyPayment && o.monthlyPayment > 0) {
    const monthly = o.monthlyPayment;
    const total = monthly * term;
    return {
      totalToPay: total,
      totalOverpayment: Math.max(0, total - principal),
      monthlyPayment: monthly,
      termMonths: term,
      monthlyRate: deriveMonthlyRate(principal, monthly, term),
    };
  }
  if (o.interestRate && o.interestRate > 0) {
    const rate = o.interestRate / 100 / 12;
    const monthly = annuityPayment(principal, rate, term);
    const total = monthly * term;
    return {
      totalToPay: total,
      totalOverpayment: Math.max(0, total - principal),
      monthlyPayment: monthly,
      termMonths: term,
      monthlyRate: rate,
    };
  }
  // no rate / no monthly given → interest-free even split
  return {
    totalToPay: principal,
    totalOverpayment: 0,
    monthlyPayment: principal / term,
    termMonths: term,
    monthlyRate: 0,
  };
}

/** Cumulative real payments made on or before a given ISO date. */
function paidByDate(payments: Payment[], iso: string): number {
  const cutoff = parseISO(iso)?.getTime() ?? Infinity;
  return payments
    .filter((p) => !p.isPreliminary && p.date)
    .filter((p) => (parseISO(p.date)?.getTime() ?? Infinity) <= cutoff)
    .reduce((sum, p) => sum + (p.amount || 0), 0);
}

/** Build the month-by-month schedule that feeds the charts. */
export function buildSchedule(o: Obligation, r: Resolved): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  const term = r.termMonths;
  let balance = Math.max(0, o.principalAmount || 0);
  let cumulativeScheduled = 0;

  for (let k = 1; k <= term; k++) {
    const dueDate = paymentDueDate(o.startDate, o.paymentDay || 1, k);
    let amount = r.monthlyPayment;
    let interestPortion = 0;
    let principalPortion = 0;

    if (o.type === 'credit' && r.monthlyRate > 0) {
      interestPortion = balance * r.monthlyRate;
      principalPortion = amount - interestPortion;
      if (k === term) {
        // settle any rounding drift on the final installment
        principalPortion = balance;
        amount = principalPortion + interestPortion;
      }
      balance = Math.max(0, balance - principalPortion);
    } else if (o.type === 'installment') {
      principalPortion = (o.principalAmount || 0) / term;
      interestPortion = r.totalOverpayment / term;
    } else {
      // single or interest-free credit
      principalPortion = amount;
      interestPortion = 0;
    }

    cumulativeScheduled += amount;
    const cumulativePaid = Math.min(r.totalToPay, paidByDate(o.payments, dueDate));

    entries.push({
      index: k,
      dueDate,
      amount,
      cumulativeScheduled,
      cumulativePaid,
      remaining: Math.max(0, r.totalToPay - cumulativePaid),
      principalPortion,
      interestPortion,
    });
  }
  return entries;
}

/** Full computed view of an obligation. */
export function computeObligation(o: Obligation): ObligationComputed {
  const r = resolve(o);
  const paid = paidSoFar(o.payments);
  const remaining = remainingOf(r.totalToPay, paid);
  const today = todayISO();
  const monthsElapsed = Math.min(r.termMonths, monthsBetween(o.startDate, today));
  const schedule = buildSchedule(o, r);

  const nextEntry = schedule.find(
    (e) =>
      (parseISO(e.dueDate)?.getTime() ?? 0) > (parseISO(today)?.getTime() ?? 0) && remaining > 0,
  );

  const derivedInterestRate =
    o.type === 'credit' && r.monthlyRate > 0 ? r.monthlyRate * 12 * 100 : undefined;

  return {
    totalToPay: r.totalToPay,
    totalOverpayment: r.totalOverpayment,
    paidSoFar: paid,
    remaining,
    progressPercent: progressPercent(paid, r.totalToPay),
    monthlyPayment: r.monthlyPayment,
    monthsElapsed,
    monthsRemaining: Math.max(0, r.termMonths - monthsElapsed),
    nextPaymentDate: nextEntry ? nextEntry.dueDate : null,
    derivedInterestRate,
    schedule,
  };
}

// ---- Savings ---------------------------------------------------------------

export interface SavingsComputed {
  progressPercent: number;
  remaining: number;
  /** Daily/monthly pace required to hit the goal by the deadline, if set. */
  requiredPerMonth: number | null;
}

export function computeSavings(
  target: number,
  current: number,
  deadline?: string,
): SavingsComputed {
  const remaining = Math.max(0, target - current);
  const pct = target > 0 ? Math.min(100, Math.max(0, Math.round((current / target) * 100))) : 0;
  let requiredPerMonth: number | null = null;
  if (deadline) {
    const months = Math.max(1, monthsBetween(todayISO(), deadline));
    requiredPerMonth = remaining / months;
  }
  return { progressPercent: pct, remaining, requiredPerMonth };
}

// ---- Recurring payments ----------------------------------------------------

const AVG_DAYS_PER_MONTH = 30.4375;

/** Approximate number of days in one cycle. */
function cycleDays(count: number, unit: IntervalUnit): number {
  if (unit === 'day') return count;
  if (unit === 'week') return count * 7;
  if (unit === 'month') return count * AVG_DAYS_PER_MONTH;
  return count * 365.25; // year
}

/** Normalize a recurring charge to an average cost per month. */
export function monthlyEquivalent(amount: number, count: number, unit: IntervalUnit): number {
  const days = cycleDays(count, unit);
  return days > 0 ? amount * (AVG_DAYS_PER_MONTH / days) : 0;
}

/** First due date on/after `fromISO`, stepping from the anchor by the interval. */
export function nextDueFrom(
  startISO: string,
  count: number,
  unit: IntervalUnit,
  fromISO: string,
): string {
  const from = parseISO(fromISO) ?? new Date();
  let d = parseISO(startISO) ?? new Date();
  let guard = 0;
  while (d.getTime() < from.getTime() && guard < 5000) {
    d = addInterval(d, Math.max(1, count), unit);
    guard++;
  }
  return toISO(d);
}

/** Full computed view of a recurring payment. */
export function computeRecurring(r: RecurringPayment, fromISO = todayISO()): RecurringComputed {
  const next = nextDueFrom(r.startDate, r.intervalCount, r.intervalUnit, fromISO);
  const upcoming: string[] = [];
  let d = parseISO(next) ?? new Date();
  for (let i = 0; i < 4; i++) {
    upcoming.push(toISO(d));
    d = addInterval(d, Math.max(1, r.intervalCount), r.intervalUnit);
  }
  return {
    nextDue: next,
    monthlyEquivalent: monthlyEquivalent(r.amount, r.intervalCount, r.intervalUnit),
    upcoming,
  };
}

/** All occurrence dates of a recurring payment within [fromISO, untilISO]. */
export function recurringOccurrences(
  r: RecurringPayment,
  fromISO: string,
  untilISO: string,
): string[] {
  const until = parseISO(untilISO);
  if (!until) return [];
  const dates: string[] = [];
  let d = parseISO(nextDueFrom(r.startDate, r.intervalCount, r.intervalUnit, fromISO));
  let guard = 0;
  while (d && d.getTime() <= until.getTime() && guard < 400) {
    dates.push(toISO(d));
    d = addInterval(d, Math.max(1, r.intervalCount), r.intervalUnit);
    guard++;
  }
  return dates;
}

export interface CalendarPayment {
  date: string;
  name: string;
  amount: number;
  kind: 'obligation' | 'recurring';
  tag: ExpenseType | 'recurring';
  id: string;
}

/**
 * Collect every scheduled payment (obligations + recurring) that falls within
 * [fromISO, untilISO]. Closed/paused items are skipped; optional listId filter.
 */
export function collectPayments(
  fromISO: string,
  untilISO: string,
  expenses: Obligation[],
  recurring: RecurringPayment[],
  listId?: string,
): CalendarPayment[] {
  const fromT = parseISO(fromISO)?.getTime() ?? 0;
  const untilT = parseISO(untilISO)?.getTime() ?? 0;
  const out: CalendarPayment[] = [];
  for (const o of expenses) {
    if (o.status === 'closed') continue;
    if (listId && o.listId !== listId) continue;
    for (const e of computeObligation(o).schedule) {
      const t = parseISO(e.dueDate)?.getTime() ?? -1;
      if (t >= fromT && t <= untilT) {
        out.push({
          date: e.dueDate,
          name: o.name,
          amount: e.amount,
          kind: 'obligation',
          tag: o.type,
          id: o.id,
        });
      }
    }
  }
  for (const r of recurring) {
    if (r.paused) continue;
    if (listId && r.listId !== listId) continue;
    for (const d of recurringOccurrences(r, fromISO, untilISO)) {
      out.push({
        date: d,
        name: r.name,
        amount: r.amount,
        kind: 'recurring',
        tag: 'recurring',
        id: r.id,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
