import { create } from 'zustand';
import type {
  ExpenseList,
  FinanceExpensesBlob,
  FinanceListsBlob,
  FinanceRecurringBlob,
  FinanceRemindersBlob,
  FinanceSavingsBlob,
  Note,
  NotesBlob,
  Obligation,
  Outfit,
  Payment,
  RecurringPayment,
  ReminderPrefs,
  SavingsGoal,
  SizeEntry,
  WardrobeItem,
  WardrobeItemsBlob,
  WardrobeOutfitsBlob,
  WardrobeSizesBlob,
  WardrobeWishlistBlob,
  WishItem,
} from '@/types';

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { enabled: true, leads: [0], hour: 9, minute: 0 };
import { getStorage, STORAGE_KEYS } from '@/lib/storage';
import { genId } from '@/lib/id';
import { deriveStatus, paidSoFar, resolve } from '@/lib/finance-calc';

export type ObligationDraft = Omit<
  Obligation,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'payments'
> & { payments?: Payment[] };

export type SavingsDraft = Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>;

export type RecurringDraft = Omit<RecurringPayment, 'id' | 'createdAt' | 'updatedAt'>;

export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

export type ListDraft = Omit<ExpenseList, 'id' | 'createdAt' | 'updatedAt'>;

export type WardrobeItemDraft = Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>;
export type OutfitDraft = Omit<Outfit, 'id' | 'createdAt' | 'updatedAt'>;
export type WishDraft = Omit<WishItem, 'id' | 'createdAt' | 'updatedAt'>;

/** Recompute the auto-status from the payments and bump updatedAt. */
function normalize(o: Obligation): Obligation {
  const total = resolve(o).totalToPay;
  const paid = paidSoFar(o.payments);
  const status = o.manuallyClosed ? 'closed' : deriveStatus(paid, total);
  return { ...o, status, updatedAt: Date.now() };
}

// --- Debounced persistence --------------------------------------------------
// Writes are debounced (to avoid hammering CloudStorage), but ALWAYS flushed
// immediately when the Mini App is hidden/closed so a just-made change is never
// lost if the user swipes the app away right after editing.
const flushers: Array<() => void> = [];

function makePersister<T>(key: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: T | undefined;
  const write = () => {
    if (pending !== undefined) {
      void getStorage().set<T>(key, pending);
      pending = undefined;
    }
  };
  flushers.push(write);
  return (blob: T) => {
    pending = blob;
    clearTimeout(timer);
    timer = setTimeout(write, 300);
  };
}

if (typeof window !== 'undefined') {
  const flushAll = () => flushers.forEach((f) => f());
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

const writeExpenses = makePersister<FinanceExpensesBlob>(STORAGE_KEYS.expenses);
const writeSavings = makePersister<FinanceSavingsBlob>(STORAGE_KEYS.savings);
const writeRecurring = makePersister<FinanceRecurringBlob>(STORAGE_KEYS.recurring);
const writeLists = makePersister<FinanceListsBlob>(STORAGE_KEYS.lists);
const writeNotes = makePersister<NotesBlob>(STORAGE_KEYS.notes);
const writeReminders = makePersister<FinanceRemindersBlob>(STORAGE_KEYS.reminders);
const writeWardrobe = makePersister<WardrobeItemsBlob>(STORAGE_KEYS.wardrobe);
const writeOutfits = makePersister<WardrobeOutfitsBlob>(STORAGE_KEYS.outfits);
const writeWishlist = makePersister<WardrobeWishlistBlob>(STORAGE_KEYS.wishlist);
const writeSizes = makePersister<WardrobeSizesBlob>(STORAGE_KEYS.sizes);

const persistExpenses = (items: Obligation[]) => writeExpenses({ version: 1, items });
const persistSavings = (items: SavingsGoal[]) => writeSavings({ version: 1, items });
const persistRecurring = (items: RecurringPayment[]) => writeRecurring({ version: 1, items });
const persistLists = (items: ExpenseList[]) => writeLists({ version: 1, items });
const persistNotes = (items: Note[]) => writeNotes({ version: 1, items });
const persistReminderPrefs = (prefs: ReminderPrefs) => writeReminders({ version: 1, prefs });
const persistWardrobe = (items: WardrobeItem[]) => writeWardrobe({ version: 1, items });
const persistOutfits = (items: Outfit[]) => writeOutfits({ version: 1, items });
const persistWishlist = (items: WishItem[]) => writeWishlist({ version: 1, items });
const persistSizes = (items: SizeEntry[]) => writeSizes({ version: 1, items });

interface FinanceState {
  expenses: Obligation[];
  savings: SavingsGoal[];
  recurring: RecurringPayment[];
  lists: ExpenseList[];
  notes: Note[];
  wardrobe: WardrobeItem[];
  outfits: Outfit[];
  wishlist: WishItem[];
  sizes: SizeEntry[];
  reminderPrefs: ReminderPrefs;
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

  addList: (draft: ListDraft) => ExpenseList;
  updateList: (id: string, patch: Partial<ExpenseList>) => void;
  removeList: (id: string) => void;
  getList: (id: string) => ExpenseList | undefined;

  addNote: (draft: NoteDraft) => Note;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  getNote: (id: string) => Note | undefined;

  addItem: (draft: WardrobeItemDraft) => WardrobeItem;
  updateItem: (id: string, patch: Partial<WardrobeItem>) => void;
  removeItem: (id: string) => void;
  getItem: (id: string) => WardrobeItem | undefined;

  addOutfit: (draft: OutfitDraft) => Outfit;
  updateOutfit: (id: string, patch: Partial<Outfit>) => void;
  removeOutfit: (id: string) => void;
  getOutfit: (id: string) => Outfit | undefined;

  addWish: (draft: WishDraft) => WishItem;
  updateWish: (id: string, patch: Partial<WishItem>) => void;
  removeWish: (id: string) => void;
  getWish: (id: string) => WishItem | undefined;

  setSizes: (items: SizeEntry[]) => void;

  setReminderPrefs: (patch: Partial<ReminderPrefs>) => void;
}

export const useFinanceStore = create<FinanceState>((set, get) => ({
  expenses: [],
  savings: [],
  recurring: [],
  lists: [],
  notes: [],
  wardrobe: [],
  outfits: [],
  wishlist: [],
  sizes: [],
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  hydrated: false,

  hydrate: async () => {
    const storage = getStorage();
    const [exp, sav, rec, lists, notes, rem, ward, outf, wish, sizes] = await Promise.all([
      storage.get<FinanceExpensesBlob>(STORAGE_KEYS.expenses),
      storage.get<FinanceSavingsBlob>(STORAGE_KEYS.savings),
      storage.get<FinanceRecurringBlob>(STORAGE_KEYS.recurring),
      storage.get<FinanceListsBlob>(STORAGE_KEYS.lists),
      storage.get<NotesBlob>(STORAGE_KEYS.notes),
      storage.get<FinanceRemindersBlob>(STORAGE_KEYS.reminders),
      storage.get<WardrobeItemsBlob>(STORAGE_KEYS.wardrobe),
      storage.get<WardrobeOutfitsBlob>(STORAGE_KEYS.outfits),
      storage.get<WardrobeWishlistBlob>(STORAGE_KEYS.wishlist),
      storage.get<WardrobeSizesBlob>(STORAGE_KEYS.sizes),
    ]);
    set({
      expenses: exp?.items ?? [],
      savings: sav?.items ?? [],
      recurring: rec?.items ?? [],
      lists: lists?.items ?? [],
      notes: notes?.items ?? [],
      wardrobe: ward?.items ?? [],
      outfits: outf?.items ?? [],
      wishlist: wish?.items ?? [],
      sizes: sizes?.items ?? [],
      reminderPrefs: { ...DEFAULT_REMINDER_PREFS, ...(rem?.prefs ?? {}) },
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

  addList: (draft) => {
    const now = Date.now();
    const list: ExpenseList = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const lists = [list, ...get().lists];
    set({ lists });
    persistLists(lists);
    return list;
  },

  updateList: (id, patch) => {
    const lists = get().lists.map((l) => (l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l));
    set({ lists });
    persistLists(lists);
  },

  removeList: (id) => {
    const lists = get().lists.filter((l) => l.id !== id);
    // Keep the items, just detach them from the deleted list.
    const expenses = get().expenses.map((o) => (o.listId === id ? { ...o, listId: undefined } : o));
    const recurring = get().recurring.map((r) => (r.listId === id ? { ...r, listId: undefined } : r));
    set({ lists, expenses, recurring });
    persistLists(lists);
    persistExpenses(expenses);
    persistRecurring(recurring);
  },

  getList: (id) => get().lists.find((l) => l.id === id),

  addNote: (draft) => {
    const now = Date.now();
    const note: Note = {
      ...draft,
      title: draft.title.trim(),
      body: draft.body.trim(),
      id: genId(),
      createdAt: now,
      updatedAt: now,
    };
    const notes = [note, ...get().notes];
    set({ notes });
    persistNotes(notes);
    return note;
  },

  updateNote: (id, patch) => {
    const notes = get().notes.map((n) =>
      n.id === id
        ? {
            ...n,
            ...patch,
            title: patch.title !== undefined ? patch.title.trim() : n.title,
            body: patch.body !== undefined ? patch.body.trim() : n.body,
            updatedAt: Date.now(),
          }
        : n,
    );
    set({ notes });
    persistNotes(notes);
  },

  removeNote: (id) => {
    const notes = get().notes.filter((n) => n.id !== id);
    set({ notes });
    persistNotes(notes);
  },

  getNote: (id) => get().notes.find((n) => n.id === id),

  addItem: (draft) => {
    const now = Date.now();
    const item: WardrobeItem = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const wardrobe = [item, ...get().wardrobe];
    set({ wardrobe });
    persistWardrobe(wardrobe);
    return item;
  },

  updateItem: (id, patch) => {
    const wardrobe = get().wardrobe.map((it) =>
      it.id === id ? { ...it, ...patch, updatedAt: Date.now() } : it,
    );
    set({ wardrobe });
    persistWardrobe(wardrobe);
  },

  removeItem: (id) => {
    const wardrobe = get().wardrobe.filter((it) => it.id !== id);
    // Detach the item from any outfit that referenced it.
    const outfits = get().outfits.map((o) =>
      o.itemIds.includes(id) ? { ...o, itemIds: o.itemIds.filter((x) => x !== id) } : o,
    );
    set({ wardrobe, outfits });
    persistWardrobe(wardrobe);
    persistOutfits(outfits);
  },

  getItem: (id) => get().wardrobe.find((it) => it.id === id),

  addOutfit: (draft) => {
    const now = Date.now();
    const outfit: Outfit = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const outfits = [outfit, ...get().outfits];
    set({ outfits });
    persistOutfits(outfits);
    return outfit;
  },

  updateOutfit: (id, patch) => {
    const outfits = get().outfits.map((o) =>
      o.id === id ? { ...o, ...patch, updatedAt: Date.now() } : o,
    );
    set({ outfits });
    persistOutfits(outfits);
  },

  removeOutfit: (id) => {
    const outfits = get().outfits.filter((o) => o.id !== id);
    set({ outfits });
    persistOutfits(outfits);
  },

  getOutfit: (id) => get().outfits.find((o) => o.id === id),

  addWish: (draft) => {
    const now = Date.now();
    const wish: WishItem = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const wishlist = [wish, ...get().wishlist];
    set({ wishlist });
    persistWishlist(wishlist);
    return wish;
  },

  updateWish: (id, patch) => {
    const wishlist = get().wishlist.map((w) =>
      w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w,
    );
    set({ wishlist });
    persistWishlist(wishlist);
  },

  removeWish: (id) => {
    const wishlist = get().wishlist.filter((w) => w.id !== id);
    set({ wishlist });
    persistWishlist(wishlist);
  },

  getWish: (id) => get().wishlist.find((w) => w.id === id),

  setSizes: (items) => {
    set({ sizes: items });
    persistSizes(items);
  },

  setReminderPrefs: (patch) => {
    const reminderPrefs = { ...get().reminderPrefs, ...patch };
    set({ reminderPrefs });
    persistReminderPrefs(reminderPrefs);
  },
}));
