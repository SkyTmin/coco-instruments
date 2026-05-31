// ---------------------------------------------------------------------------
// Domain types for the Coco finance feature.
// The Obligation shape intentionally reuses the proven legacy `debts.js` model
// ({ id, name, amount, date, note, payments[] }) and extends it with a type
// discriminator + per-type fields.
// ---------------------------------------------------------------------------

/** How an expense is paid off. */
export type ExpenseType = 'single' | 'credit' | 'installment';

/** Auto-derived lifecycle status (mirrors legacy debts statuses). */
export type ObligationStatus = 'active' | 'partial' | 'closed';

/** A single recorded repayment. `isPreliminary` payments do NOT count toward paid. */
export interface Payment {
  id: string;
  amount: number;
  /** ISO 'YYYY-MM-DD'. Empty string allowed for preliminary (planned) payments. */
  date: string;
  note?: string;
  isPreliminary: boolean;
}

/**
 * A finance obligation / expense.
 * - single:      `principalAmount` is the one-off total. termMonths = 1.
 * - credit:      user enters `monthlyPayment` + `termMonths`; `interestRate` is informational/derived.
 * - installment: `principalAmount` + overpayment (total or per-month) define the total; no interest.
 */
export interface Obligation {
  id: string;
  name: string;
  type: ExpenseType;

  /** Base sum borrowed / owed / price, in RUB. */
  principalAmount: number;
  /** Monthly payment (entered for credit; optional for installment). */
  monthlyPayment?: number;
  /** Day of month the payment is due (1..31). */
  paymentDay: number;
  /** Duration in months (single ⇒ 1). */
  termMonths: number;
  /** ISO date the schedule begins. */
  startDate: string;

  /** credit only — annual nominal % (informational or used to derive monthly). */
  interestRate?: number;

  /** installment only — absolute total overpayment, RUB. */
  overpayment?: number;
  /** installment only — alternative input; total = overpaymentPerMonth * termMonths. */
  overpaymentPerMonth?: number;
  /** installment only — the full amount you will pay over the term, RUB. */
  totalAmount?: number;

  status: ObligationStatus;
  /** Manually marked as finished by the user. Excluded from statistics. */
  manuallyClosed?: boolean;
  note?: string;
  category?: string;
  /** Optional grouping list (e.g. "Свадьба"). */
  listId?: string;
  /** Send a Telegram reminder before/at each due date (default on). */
  notify?: boolean;

  /** Source of truth for "paid so far". */
  payments: Payment[];

  createdAt: number;
  updatedAt: number;
}

/** A savings goal. */
export interface SavingsGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  /** Optional ISO deadline. */
  deadline?: string;
  /** Optional itemized deposits (reuses the Payment shape). */
  contributions?: Payment[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** One month of an obligation's schedule (feeds the charts). */
export interface ScheduleEntry {
  index: number; // 1..termMonths
  dueDate: string; // ISO
  amount: number; // scheduled payment this month
  cumulativeScheduled: number;
  cumulativePaid: number;
  remaining: number;
  principalPortion: number;
  interestPortion: number; // for installment this is the "переплата" portion
}

/** Computed view of an obligation — never persisted. */
export interface ObligationComputed {
  totalToPay: number;
  totalOverpayment: number;
  paidSoFar: number;
  remaining: number;
  progressPercent: number; // 0..100
  monthlyPayment: number; // resolved/derived
  monthsElapsed: number;
  monthsRemaining: number;
  nextPaymentDate: string | null;
  /** Annual nominal % derived from the cash flows (for display). */
  derivedInterestRate?: number;
  schedule: ScheduleEntry[];
}

// ---- Persisted blob shapes (one per storage key) --------------------------

export interface FinanceExpensesBlob {
  version: 1;
  items: Obligation[];
}

export interface FinanceSavingsBlob {
  version: 1;
  items: SavingsGoal[];
}

// ---- Recurring payments (subscriptions, rent, internet, …) ----------------

/** Unit of a recurring cycle. */
export type IntervalUnit = 'day' | 'week' | 'month' | 'year';

/** A recurring/periodic payment that repeats forever on a fixed cycle. */
export interface RecurringPayment {
  id: string;
  name: string;
  amount: number;
  /** Repeats every `intervalCount` × `intervalUnit` (e.g. 2 weeks, 1 month). */
  intervalCount: number;
  intervalUnit: IntervalUnit;
  /** Anchor date — when the cycle starts / first due. */
  startDate: string;
  /** Temporarily paused (excluded from totals & upcoming). */
  paused?: boolean;
  category?: string;
  note?: string;
  /** Optional grouping list (e.g. "Свадьба"). */
  listId?: string;
  /** Send a Telegram reminder before/at each charge (default on). */
  notify?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FinanceRecurringBlob {
  version: 1;
  items: RecurringPayment[];
}

/** Computed view of a recurring payment — never persisted. */
export interface RecurringComputed {
  nextDue: string; // ISO of the next upcoming charge
  monthlyEquivalent: number; // normalized cost per month
  upcoming: string[]; // next few ISO dates
}

// ---- Lists (group expenses by project, e.g. "Свадьба") --------------------

export interface ExpenseList {
  id: string;
  name: string;
  emoji?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FinanceListsBlob {
  version: 1;
  items: ExpenseList[];
}

// ---- Reminder preferences (Telegram notifications) ------------------------

export interface ReminderPrefs {
  enabled: boolean;
  /** Days before the due date to notify; 0 = on the due date. */
  leadDays: number;
  hour: number; // 0..23, local time
  minute: number; // 0..59
}

export interface FinanceRemindersBlob {
  version: 1;
  prefs: ReminderPrefs;
}

// ---- Notes ----------------------------------------------------------------

/** A markdown-like note with Obsidian-style [[wiki links]]. */
export interface Note {
  id: string;
  title: string;
  body: string;
  attachments?: NoteAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface NoteAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  dataUrl?: string;
  createdAt: number;
}

export interface NotesBlob {
  version: 1;
  items: Note[];
}
