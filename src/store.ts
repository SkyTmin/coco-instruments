import { create } from 'zustand';
import type {
  FinanceExpensesBlob,
  FinanceRecurringBlob,
  FinanceSavingsBlob,
  Obligation,
  Payment,
  RecurringPayment,
  SavingsGoal,
} from '@/types';
import { getStorage, STORAGE_KEYS } from '@/lib/storage';
import { genId } from '@/lib/id';
import { deriveStatus, paidSoFar, resolve } from '@/lib/finance-calc';

export type ObligationDraft = Omit<
  Obligation,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'payments'
> & { payments?: Payment[] };

export type SavingsDraft = Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>;

export type RecurringDraft = Omit<RecurringPayment, 'id' | 'createdAt' | 'updatedAt'>;

/** Recompute the auto-status from the payments and bump updatedAt. */
function normalize(o: Obligation): Obligation {
  const total = resolve(o).totalToPay;
  const paid = paidSoFar(o.payments);
  const status = o.manuallyClosed ? 'closed' : deriveStatus(paid, total);
  return { ...o, status, updatedAt: Date.now() };
}

// --- Debounced persistence (avoids hammering CloudStorage) ------------------
let expensesTimer: ReturnType<typeof setTimeout> | undefined;
let savingsTimer: ReturnType<typeof setTimeout> | undefined;

function persistExpenses(items: Obligation[]): void {
  clearTimeout(expensesTimer);
  expensesTimer = setTimeout(() => {
    void getStorage().set<FinanceExpensesBlob>(STORAGE_KEYS.expenses, { version: 1, items });
  }, 300);
}

function persistSavings(items: SavingsGoal[]): void {
  clearTimeout(savingsTimer);
  savingsTimer = setTimeout(() => {
    void getStorage().set<FinanceSavingsBlob>(STORAGE_KEYS.savings, { version: 1, items });
  }, 300);
}

let recurringTimer: ReturnType<typeof setTimeout> | undefined;
function persistRecurring(items: RecurringPayment[]): void {
  clearTimeout(recurringTimer);
  recurringTimer = setTimeout(() => {
    void getStorage().set<FinanceRecurringBlob>(STORAGE_KEYS.recurring, { version: 1, items });
  }, 300);
}

interface FinanceState {
  expenses: Obligation[];
  savings: SavingsGoal[];
  recurring: RecurringPayment[];
  hydrated: boolean;

  hydrate: () => Promise<void>;

  addExpense: (draft: ObligationDraft) => Obligation;
  updateExpense: (id: string, patch: Partial<Obligation>) => void;
  removeExpense: (id: string) => void;
  getExpense: (id: string) => Obligation | undefined;

  addPayment: (expenseId: string, payment: Omit<Payment, 'id'>) => void;
  updatePayment: (expenseId: string, paymentId: string, patch: Partial<Payment>) => void;
  removePayment: (expenseId: string, paymentId: string) => void;

  addSaving: (draft: SavingsDraft) => SavingsGoal;
  updateSaving: (id: string, patch: Partial<SavingsGoal>) => void;
  removeSaving: (id: string) => void;
  getSaving: (id: string) => SavingsGoal | undefined;

  addRecurring: (draft: RecurringDraft) => RecurringPayment;
  updateRecurring: (id: string, patch: Partial<RecurringPayment>) => void;
  removeRecurring: (id: string) => void;
  getRecurring: (id: string) => RecurringPayment | undefined;
}

export const useFinanceStore = create<FinanceState>((set, get) => ({
  expenses: [],
  savings: [],
  recurring: [],
  hydrated: false,

  hydrate: async () => {
    const storage = getStorage();
    const [exp, sav, rec] = await Promise.all([
      storage.get<FinanceExpensesBlob>(STORAGE_KEYS.expenses),
      storage.get<FinanceSavingsBlob>(STORAGE_KEYS.savings),
      storage.get<FinanceRecurringBlob>(STORAGE_KEYS.recurring),
    ]);
    set({
      expenses: exp?.items ?? [],
      savings: sav?.items ?? [],
      recurring: rec?.items ?? [],
      hydrated: true,
    });
  },

  addExpense: (draft) => {
    const now = Date.now();
    const obligation = normalize({
      ...draft,
      id: genId(),
      status: 'active',
      payments: draft.payments ?? [],
      createdAt: now,
      updatedAt: now,
    });
    const expenses = [obligation, ...get().expenses];
    set({ expenses });
    persistExpenses(expenses);
    return obligation;
  },

  updateExpense: (id, patch) => {
    const expenses = get().expenses.map((o) => (o.id === id ? normalize({ ...o, ...patch }) : o));
    set({ expenses });
    persistExpenses(expenses);
  },

  removeExpense: (id) => {
    const expenses = get().expenses.filter((o) => o.id !== id);
    set({ expenses });
    persistExpenses(expenses);
  },

  getExpense: (id) => get().expenses.find((o) => o.id === id),

  addPayment: (expenseId, payment) => {
    const expenses = get().expenses.map((o) =>
      o.id === expenseId
        ? normalize({ ...o, payments: [...o.payments, { ...payment, id: genId() }] })
        : o,
    );
    set({ expenses });
    persistExpenses(expenses);
  },

  updatePayment: (expenseId, paymentId, patch) => {
    const expenses = get().expenses.map((o) =>
      o.id === expenseId
        ? normalize({
            ...o,
            payments: o.payments.map((p) => (p.id === paymentId ? { ...p, ...patch } : p)),
          })
        : o,
    );
    set({ expenses });
    persistExpenses(expenses);
  },

  removePayment: (expenseId, paymentId) => {
    const expenses = get().expenses.map((o) =>
      o.id === expenseId
        ? normalize({ ...o, payments: o.payments.filter((p) => p.id !== paymentId) })
        : o,
    );
    set({ expenses });
    persistExpenses(expenses);
  },

  addSaving: (draft) => {
    const now = Date.now();
    const goal: SavingsGoal = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const savings = [goal, ...get().savings];
    set({ savings });
    persistSavings(savings);
    return goal;
  },

  updateSaving: (id, patch) => {
    const savings = get().savings.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s,
    );
    set({ savings });
    persistSavings(savings);
  },

  removeSaving: (id) => {
    const savings = get().savings.filter((s) => s.id !== id);
    set({ savings });
    persistSavings(savings);
  },

  getSaving: (id) => get().savings.find((s) => s.id === id),

  addRecurring: (draft) => {
    const now = Date.now();
    const item: RecurringPayment = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const recurring = [item, ...get().recurring];
    set({ recurring });
    persistRecurring(recurring);
    return item;
  },

  updateRecurring: (id, patch) => {
    const recurring = get().recurring.map((r) =>
      r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r,
    );
    set({ recurring });
    persistRecurring(recurring);
  },

  removeRecurring: (id) => {
    const recurring = get().recurring.filter((r) => r.id !== id);
    set({ recurring });
    persistRecurring(recurring);
  },

  getRecurring: (id) => get().recurring.find((r) => r.id === id),
}));
