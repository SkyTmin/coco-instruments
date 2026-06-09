import { create } from 'zustand';
import type {
  Attachment,
  CalculatorBlob,
  CalculatorHistoryEntry,
  CalculatorPrefs,
  ExpenseList,
  FinanceExpensesBlob,
  FinanceListsBlob,
  FinanceRecurringBlob,
  FinanceRemindersBlob,
  FinanceSavingsBlob,
  Collection,
  InspirationImage,
  Note,
  NoteList,
  NotesBlob,
  TagPage,
  Obligation,
  Outfit,
  Payment,
  Conversation,
  Gift,
  MeetIdea,
  PeopleBlob,
  Person,
  PersonNoteLink,
  PersonPromise,
  PersonRelation,
  Preference,
  RecurringPayment,
  ReminderPrefs,
  SavingsGoal,
  SizeEntry,
  WardrobeCollectionsBlob,
  WardrobeFittingBlob,
  WardrobeInspirationBlob,
  WardrobeItem,
  WardrobeItemsBlob,
  WardrobeOutfitsBlob,
  WardrobeSizesBlob,
  WardrobeWishlistBlob,
  WishItem,
} from '@/types';

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { enabled: true, leads: [0], hour: 9, minute: 0 };
export const DEFAULT_CALCULATOR_PREFS: CalculatorPrefs = {
  angleMode: 'DEG',
  memory: 0,
  lastAns: 0,
  onboardingDone: false,
  scientific: false,
};
import { getStorage, STORAGE_KEYS } from '@/lib/storage';
import { genId } from '@/lib/id';
import { normalizeNoteTitle } from '@/lib/notes-graph';
import { deriveStatus, paidSoFar, resolve } from '@/lib/finance-calc';

export type ObligationDraft = Omit<
  Obligation,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'payments'
> & { payments?: Payment[] };

export type SavingsDraft = Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>;

export type RecurringDraft = Omit<RecurringPayment, 'id' | 'createdAt' | 'updatedAt'>;

export type NoteDraft = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

export type ListDraft = Omit<ExpenseList, 'id' | 'createdAt' | 'updatedAt'>;

export type PersonDraft = Omit<Person, 'id' | 'createdAt' | 'updatedAt'>;
export type PreferenceDraft = Omit<Preference, 'id' | 'createdAt' | 'updatedAt'>;
export type GiftDraft = Omit<Gift, 'id' | 'createdAt' | 'updatedAt'>;
export type ConversationDraft = Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>;
export type PersonPromiseDraft = Omit<PersonPromise, 'id' | 'createdAt' | 'updatedAt'>;
export type MeetIdeaDraft = Omit<MeetIdea, 'id' | 'createdAt' | 'updatedAt'>;
export type PersonRelationDraft = Omit<PersonRelation, 'id' | 'createdAt' | 'updatedAt'>;

export type WardrobeItemDraft = Omit<WardrobeItem, 'id' | 'createdAt' | 'updatedAt'>;
export type OutfitDraft = Omit<Outfit, 'id' | 'createdAt' | 'updatedAt'>;
export type CollectionDraft = Omit<Collection, 'id' | 'createdAt' | 'updatedAt'>;
export type WishDraft = Omit<WishItem, 'id' | 'createdAt' | 'updatedAt'>;

/** Recompute the auto-status from the payments and bump updatedAt. */
function normalize(o: Obligation): Obligation {
  const total = resolve(o).totalToPay;
  const paid = paidSoFar(o.payments);
  const status = o.manuallyClosed ? 'closed' : deriveStatus(paid, total);
  return { ...o, status, updatedAt: Date.now() };
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
}

function uniqueCategories(categories: Person['category'][] | undefined, fallback: Person['category']): Person['category'][] {
  const values = Array.from(new Set([...(categories ?? []), fallback])).filter(Boolean);
  return values.length ? values : [fallback];
}

function touchPeople(people: Person[], personId: string): Person[] {
  const now = Date.now();
  return people.map((person) => (person.id === personId ? { ...person, updatedAt: now } : person));
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
const writePeople = makePersister<PeopleBlob>(STORAGE_KEYS.people);
const writeCalculator = makePersister<CalculatorBlob>(STORAGE_KEYS.calculator);
const writeReminders = makePersister<FinanceRemindersBlob>(STORAGE_KEYS.reminders);
const writeWardrobe = makePersister<WardrobeItemsBlob>(STORAGE_KEYS.wardrobe);
const writeOutfits = makePersister<WardrobeOutfitsBlob>(STORAGE_KEYS.outfits);
const writeCollections = makePersister<WardrobeCollectionsBlob>(STORAGE_KEYS.collections);
const writeInspiration = makePersister<WardrobeInspirationBlob>(STORAGE_KEYS.inspiration);
const writeFitting = makePersister<WardrobeFittingBlob>(STORAGE_KEYS.fitting);
const writeWishlist = makePersister<WardrobeWishlistBlob>(STORAGE_KEYS.wishlist);
const writeSizes = makePersister<WardrobeSizesBlob>(STORAGE_KEYS.sizes);

const persistExpenses = (items: Obligation[]) => writeExpenses({ version: 1, items });
const persistSavings = (items: SavingsGoal[]) => writeSavings({ version: 1, items });
const persistRecurring = (items: RecurringPayment[]) => writeRecurring({ version: 1, items });
const persistLists = (items: ExpenseList[]) => writeLists({ version: 1, items });
const persistNotes = (items: Note[], lists: NoteList[], tagPages: TagPage[]) =>
  writeNotes({ version: 1, items, lists, tagPages });
const persistPeople = (blob: Omit<PeopleBlob, 'version'>) => writePeople({ version: 1, ...blob });
const persistCalculator = (history: CalculatorHistoryEntry[], prefs: CalculatorPrefs) =>
  writeCalculator({ version: 1, history, prefs });
const persistReminderPrefs = (prefs: ReminderPrefs) => writeReminders({ version: 1, prefs });
const persistWardrobe = (items: WardrobeItem[]) => writeWardrobe({ version: 1, items });
const persistOutfits = (items: Outfit[]) => writeOutfits({ version: 1, items });
const persistCollections = (items: Collection[]) => writeCollections({ version: 1, items });
const persistInspiration = (items: InspirationImage[]) => writeInspiration({ version: 1, items });
const persistFitting = (itemIds: string[]) => writeFitting({ version: 1, itemIds });
const persistWishlist = (items: WishItem[]) => writeWishlist({ version: 1, items });
const persistSizes = (items: SizeEntry[]) => writeSizes({ version: 1, items });

// ---- Full data export / import (user-controlled backup) -------------------
interface ExportData {
  expenses?: Obligation[];
  savings?: SavingsGoal[];
  recurring?: RecurringPayment[];
  lists?: ExpenseList[];
  notes?: Note[];
  noteLists?: NoteList[];
  tagPages?: TagPage[];
  people?: Partial<Omit<PeopleBlob, 'version'>>;
  calculator?: { history?: CalculatorHistoryEntry[]; prefs?: Partial<CalculatorPrefs> };
  wardrobe?: WardrobeItem[];
  outfits?: Outfit[];
  collections?: Collection[];
  inspiration?: InspirationImage[];
  fitting?: string[];
  wishlist?: WishItem[];
  sizes?: SizeEntry[];
  reminderPrefs?: Partial<ReminderPrefs>;
}
export interface ExportBundle {
  app: string;
  version: number;
  exportedAt: number;
  data: ExportData;
}

interface FinanceState {
  expenses: Obligation[];
  savings: SavingsGoal[];
  recurring: RecurringPayment[];
  lists: ExpenseList[];
  notes: Note[];
  noteLists: NoteList[];
  tagPages: TagPage[];
  people: Person[];
  preferences: Preference[];
  gifts: Gift[];
  conversations: Conversation[];
  promises: PersonPromise[];
  meetIdeas: MeetIdea[];
  personRelations: PersonRelation[];
  personNoteLinks: PersonNoteLink[];
  calculatorHistory: CalculatorHistoryEntry[];
  calculatorPrefs: CalculatorPrefs;
  wardrobe: WardrobeItem[];
  outfits: Outfit[];
  collections: Collection[];
  inspiration: InspirationImage[];
  fitting: string[];
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
  getTagPage: (tag: string) => TagPage | undefined;
  upsertTagPage: (tag: string, patch: Partial<Pick<TagPage, 'body' | 'attachments'>>) => TagPage;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  getNote: (id: string) => Note | undefined;
  addNoteList: (name: string, emoji?: string) => NoteList;
  updateNoteList: (id: string, patch: Partial<Pick<NoteList, 'name' | 'emoji'>>) => void;
  removeNoteList: (id: string, deleteNotes?: boolean) => void;
  getNoteList: (id: string) => NoteList | undefined;

  addPerson: (draft: PersonDraft) => Person;
  updatePerson: (id: string, patch: Partial<Person>) => void;
  removePerson: (id: string) => void;
  getPerson: (id: string) => Person | undefined;

  addPreference: (draft: PreferenceDraft) => Preference;
  removePreference: (id: string) => void;

  addGift: (draft: GiftDraft) => Gift;
  updateGift: (id: string, patch: Partial<Gift>) => void;
  removeGift: (id: string) => void;

  addConversation: (draft: ConversationDraft) => Conversation;
  removeConversation: (id: string) => void;

  addPromise: (draft: PersonPromiseDraft) => PersonPromise;
  updatePromise: (id: string, patch: Partial<PersonPromise>) => void;
  removePromise: (id: string) => void;

  addMeetIdea: (draft: MeetIdeaDraft) => MeetIdea;
  updateMeetIdea: (id: string, patch: Partial<MeetIdea>) => void;
  removeMeetIdea: (id: string) => void;

  addPersonRelation: (draft: PersonRelationDraft) => PersonRelation;
  removePersonRelation: (id: string) => void;

  linkNoteToPerson: (personId: string, noteId: string) => void;
  unlinkNoteFromPerson: (personId: string, noteId: string) => void;

  addCalculatorHistory: (expression: string, result: string, value: number) => void;
  clearCalculatorHistory: () => void;
  setCalculatorPrefs: (patch: Partial<CalculatorPrefs>) => void;
  exportAll: () => ExportBundle;
  importAll: (payload: unknown) => boolean;

  addItem: (draft: WardrobeItemDraft) => WardrobeItem;
  updateItem: (id: string, patch: Partial<WardrobeItem>) => void;
  removeItem: (id: string) => void;
  getItem: (id: string) => WardrobeItem | undefined;

  addOutfit: (draft: OutfitDraft) => Outfit;
  updateOutfit: (id: string, patch: Partial<Outfit>) => void;
  removeOutfit: (id: string) => void;
  getOutfit: (id: string) => Outfit | undefined;

  addCollection: (draft: CollectionDraft) => Collection;
  updateCollection: (id: string, patch: Partial<Collection>) => void;
  removeCollection: (id: string) => void;
  getCollection: (id: string) => Collection | undefined;

  toggleFitting: (id: string) => void;
  setFitting: (ids: string[]) => void;
  clearFitting: () => void;

  addInspiration: (photos: Attachment[]) => void;
  removeInspiration: (id: string) => void;

  addWish: (draft: WishDraft) => WishItem;
  updateWish: (id: string, patch: Partial<WishItem>) => void;
  removeWish: (id: string) => void;
  getWish: (id: string) => WishItem | undefined;

  setSizes: (items: SizeEntry[]) => void;

  setReminderPrefs: (patch: Partial<ReminderPrefs>) => void;
}

function peopleSnapshot(state: FinanceState): Omit<PeopleBlob, 'version'> {
  return {
    people: state.people,
    preferences: state.preferences,
    gifts: state.gifts,
    conversations: state.conversations,
    promises: state.promises,
    meetIdeas: state.meetIdeas,
    relations: state.personRelations,
    noteLinks: state.personNoteLinks,
  };
}

export const useFinanceStore = create<FinanceState>((set, get) => ({
  expenses: [],
  savings: [],
  recurring: [],
  lists: [],
  notes: [],
  noteLists: [],
  tagPages: [],
  people: [],
  preferences: [],
  gifts: [],
  conversations: [],
  promises: [],
  meetIdeas: [],
  personRelations: [],
  personNoteLinks: [],
  calculatorHistory: [],
  calculatorPrefs: DEFAULT_CALCULATOR_PREFS,
  wardrobe: [],
  outfits: [],
  collections: [],
  inspiration: [],
  fitting: [],
  wishlist: [],
  sizes: [],
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  hydrated: false,

  hydrate: async () => {
    const storage = getStorage();
    const [exp, sav, rec, lists, notes, people, calc, rem, ward, outf, coll, insp, fit, wish, sizes] =
      await Promise.all([
        storage.get<FinanceExpensesBlob>(STORAGE_KEYS.expenses),
        storage.get<FinanceSavingsBlob>(STORAGE_KEYS.savings),
        storage.get<FinanceRecurringBlob>(STORAGE_KEYS.recurring),
        storage.get<FinanceListsBlob>(STORAGE_KEYS.lists),
        storage.get<NotesBlob>(STORAGE_KEYS.notes),
        storage.get<PeopleBlob>(STORAGE_KEYS.people),
        storage.get<CalculatorBlob>(STORAGE_KEYS.calculator),
        storage.get<FinanceRemindersBlob>(STORAGE_KEYS.reminders),
        storage.get<WardrobeItemsBlob>(STORAGE_KEYS.wardrobe),
        storage.get<WardrobeOutfitsBlob>(STORAGE_KEYS.outfits),
        storage.get<WardrobeCollectionsBlob>(STORAGE_KEYS.collections),
        storage.get<WardrobeInspirationBlob>(STORAGE_KEYS.inspiration),
        storage.get<WardrobeFittingBlob>(STORAGE_KEYS.fitting),
        storage.get<WardrobeWishlistBlob>(STORAGE_KEYS.wishlist),
        storage.get<WardrobeSizesBlob>(STORAGE_KEYS.sizes),
      ]);
    set({
      expenses: exp?.items ?? [],
      savings: sav?.items ?? [],
      recurring: rec?.items ?? [],
      lists: lists?.items ?? [],
      notes: notes?.items ?? [],
      noteLists: notes?.lists ?? [],
      tagPages: notes?.tagPages ?? [],
      people: people?.people ?? [],
      preferences: people?.preferences ?? [],
      gifts: people?.gifts ?? [],
      conversations: people?.conversations ?? [],
      promises: people?.promises ?? [],
      meetIdeas: people?.meetIdeas ?? [],
      personRelations: people?.relations ?? [],
      personNoteLinks: people?.noteLinks ?? [],
      calculatorHistory: calc?.history ?? [],
      calculatorPrefs: { ...DEFAULT_CALCULATOR_PREFS, ...(calc?.prefs ?? {}) },
      wardrobe: ward?.items ?? [],
      outfits: outf?.items ?? [],
      collections: coll?.items ?? [],
      inspiration: insp?.items ?? [],
      fitting: fit?.itemIds ?? [],
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
    persistNotes(notes, get().noteLists, get().tagPages);
    return note;
  },

  // A tag IS a page: its content lives on the tag itself (no separate note).
  getTagPage: (tag) => {
    const key = normalizeNoteTitle(tag);
    return get().tagPages.find((p) => p.tag === key);
  },
  upsertTagPage: (tag, patch) => {
    const key = normalizeNoteTitle(tag);
    const now = Date.now();
    const existing = get().tagPages.find((p) => p.tag === key);
    const next: TagPage = existing
      ? { ...existing, ...patch, updatedAt: now }
      : { tag: key, body: '', attachments: [], ...patch, createdAt: now, updatedAt: now };
    const tagPages = existing
      ? get().tagPages.map((p) => (p.tag === key ? next : p))
      : [next, ...get().tagPages];
    set({ tagPages });
    persistNotes(get().notes, get().noteLists, tagPages);
    return next;
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
    persistNotes(notes, get().noteLists, get().tagPages);
  },

  removeNote: (id) => {
    const notes = get().notes.filter((n) => n.id !== id);
    const personNoteLinks = get().personNoteLinks.filter((link) => link.noteId !== id);
    set({ notes, personNoteLinks });
    persistNotes(notes, get().noteLists, get().tagPages);
    persistPeople(peopleSnapshot(get()));
  },

  getNote: (id) => get().notes.find((n) => n.id === id),

  addNoteList: (name, emoji) => {
    const now = Date.now();
    const list: NoteList = { id: genId(), name: name.trim() || 'Список', emoji, createdAt: now, updatedAt: now };
    const noteLists = [list, ...get().noteLists];
    set({ noteLists });
    persistNotes(get().notes, noteLists, get().tagPages);
    return list;
  },

  updateNoteList: (id, patch) => {
    const noteLists = get().noteLists.map((l) =>
      l.id === id
        ? {
            ...l,
            name: patch.name !== undefined ? patch.name.trim() || l.name : l.name,
            emoji: patch.emoji !== undefined ? patch.emoji || undefined : l.emoji,
            updatedAt: Date.now(),
          }
        : l,
    );
    set({ noteLists });
    persistNotes(get().notes, noteLists, get().tagPages);
  },

  removeNoteList: (id, deleteNotes = false) => {
    const noteLists = get().noteLists.filter((l) => l.id !== id);
    let notes = get().notes;
    let personNoteLinks = get().personNoteLinks;
    if (deleteNotes) {
      const goneIds = new Set(notes.filter((n) => n.listId === id).map((n) => n.id));
      notes = notes.filter((n) => !goneIds.has(n.id));
      personNoteLinks = personNoteLinks.filter((link) => !goneIds.has(link.noteId));
    } else {
      // Keep the notes, just detach them from the (now gone) list.
      notes = notes.map((n) => (n.listId === id ? { ...n, listId: undefined } : n));
    }
    set({ noteLists, notes, personNoteLinks });
    persistNotes(notes, noteLists, get().tagPages);
    if (deleteNotes) persistPeople(peopleSnapshot(get()));
  },

  getNoteList: (id) => get().noteLists.find((l) => l.id === id),

  addPerson: (draft) => {
    const now = Date.now();
    const categories = uniqueCategories(draft.categories, draft.category);
    const person: Person = {
      ...draft,
      id: genId(),
      name: draft.name.trim(),
      category: categories[0],
      categories,
      description: draft.description?.trim() || undefined,
      phone: draft.phone?.trim() || undefined,
      socials: draft.socials?.trim() || undefined,
      city: draft.city?.trim() || undefined,
      tags: uniqueTags(draft.tags),
      createdAt: now,
      updatedAt: now,
    };
    const people = [person, ...get().people];
    set({ people });
    persistPeople(peopleSnapshot(get()));
    return person;
  },

  updatePerson: (id, patch) => {
    const people = get().people.map((person) =>
      person.id === id
        ? (() => {
            const categories = uniqueCategories(
              patch.categories !== undefined ? patch.categories : person.categories,
              patch.category ?? person.category,
            );
            return {
            ...person,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() : person.name,
            category: categories[0],
            categories,
            description: patch.description !== undefined ? patch.description.trim() || undefined : person.description,
            phone: patch.phone !== undefined ? patch.phone.trim() || undefined : person.phone,
            socials: patch.socials !== undefined ? patch.socials.trim() || undefined : person.socials,
            city: patch.city !== undefined ? patch.city.trim() || undefined : person.city,
            tags: patch.tags !== undefined ? uniqueTags(patch.tags) : person.tags,
            updatedAt: Date.now(),
          };
          })()
        : person,
    );
    set({ people });
    persistPeople(peopleSnapshot(get()));
  },

  removePerson: (id) => {
    const people = get().people.filter((person) => person.id !== id);
    const preferences = get().preferences.filter((item) => item.personId !== id);
    const gifts = get().gifts.filter((item) => item.personId !== id);
    const conversations = get().conversations.filter((item) => item.personId !== id);
    const promises = get().promises.filter((item) => item.personId !== id);
    const meetIdeas = get().meetIdeas.filter((item) => item.personId !== id);
    const personRelations = get().personRelations.filter(
      (item) => item.fromPersonId !== id && item.toPersonId !== id,
    );
    const personNoteLinks = get().personNoteLinks.filter((item) => item.personId !== id);
    set({ people, preferences, gifts, conversations, promises, meetIdeas, personRelations, personNoteLinks });
    persistPeople(peopleSnapshot(get()));
  },

  getPerson: (id) => get().people.find((person) => person.id === id),

  addPreference: (draft) => {
    const now = Date.now();
    const preference: Preference = {
      ...draft,
      id: genId(),
      value: draft.value.trim(),
      note: draft.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const preferences = [preference, ...get().preferences];
    const people = touchPeople(get().people, draft.personId);
    set({ preferences, people });
    persistPeople(peopleSnapshot(get()));
    return preference;
  },

  removePreference: (id) => {
    const item = get().preferences.find((pref) => pref.id === id);
    const preferences = get().preferences.filter((pref) => pref.id !== id);
    const people = item ? touchPeople(get().people, item.personId) : get().people;
    set({ preferences, people });
    persistPeople(peopleSnapshot(get()));
  },

  addGift: (draft) => {
    const now = Date.now();
    const gift: Gift = {
      ...draft,
      id: genId(),
      title: draft.title.trim(),
      reaction: draft.reaction?.trim() || undefined,
      note: draft.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const gifts = [gift, ...get().gifts];
    const people = touchPeople(get().people, draft.personId);
    set({ gifts, people });
    persistPeople(peopleSnapshot(get()));
    return gift;
  },

  updateGift: (id, patch) => {
    let personId = '';
    const gifts = get().gifts.map((gift) => {
      if (gift.id !== id) return gift;
      personId = gift.personId;
      return {
        ...gift,
        ...patch,
        title: patch.title !== undefined ? patch.title.trim() : gift.title,
        reaction: patch.reaction !== undefined ? patch.reaction.trim() || undefined : gift.reaction,
        note: patch.note !== undefined ? patch.note.trim() || undefined : gift.note,
        updatedAt: Date.now(),
      };
    });
    const people = personId ? touchPeople(get().people, personId) : get().people;
    set({ gifts, people });
    persistPeople(peopleSnapshot(get()));
  },

  removeGift: (id) => {
    const item = get().gifts.find((gift) => gift.id === id);
    const gifts = get().gifts.filter((gift) => gift.id !== id);
    const people = item ? touchPeople(get().people, item.personId) : get().people;
    set({ gifts, people });
    persistPeople(peopleSnapshot(get()));
  },

  addConversation: (draft) => {
    const now = Date.now();
    const conversation: Conversation = {
      ...draft,
      id: genId(),
      title: draft.title.trim(),
      note: draft.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const conversations = [conversation, ...get().conversations];
    const people = touchPeople(get().people, draft.personId);
    set({ conversations, people });
    persistPeople(peopleSnapshot(get()));
    return conversation;
  },

  removeConversation: (id) => {
    const item = get().conversations.find((conversation) => conversation.id === id);
    const conversations = get().conversations.filter((conversation) => conversation.id !== id);
    const people = item ? touchPeople(get().people, item.personId) : get().people;
    set({ conversations, people });
    persistPeople(peopleSnapshot(get()));
  },

  addPromise: (draft) => {
    const now = Date.now();
    const promise: PersonPromise = {
      ...draft,
      id: genId(),
      title: draft.title.trim(),
      note: draft.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const promises = [promise, ...get().promises];
    const people = touchPeople(get().people, draft.personId);
    set({ promises, people });
    persistPeople(peopleSnapshot(get()));
    return promise;
  },

  updatePromise: (id, patch) => {
    let personId = '';
    const promises = get().promises.map((promise) => {
      if (promise.id !== id) return promise;
      personId = promise.personId;
      return {
        ...promise,
        ...patch,
        title: patch.title !== undefined ? patch.title.trim() : promise.title,
        note: patch.note !== undefined ? patch.note.trim() || undefined : promise.note,
        updatedAt: Date.now(),
      };
    });
    const people = personId ? touchPeople(get().people, personId) : get().people;
    set({ promises, people });
    persistPeople(peopleSnapshot(get()));
  },

  removePromise: (id) => {
    const item = get().promises.find((promise) => promise.id === id);
    const promises = get().promises.filter((promise) => promise.id !== id);
    const people = item ? touchPeople(get().people, item.personId) : get().people;
    set({ promises, people });
    persistPeople(peopleSnapshot(get()));
  },

  addMeetIdea: (draft) => {
    const now = Date.now();
    const meetIdea: MeetIdea = {
      ...draft,
      id: genId(),
      title: draft.title.trim(),
      note: draft.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const meetIdeas = [meetIdea, ...get().meetIdeas];
    const people = touchPeople(get().people, draft.personId);
    set({ meetIdeas, people });
    persistPeople(peopleSnapshot(get()));
    return meetIdea;
  },

  updateMeetIdea: (id, patch) => {
    let personId = '';
    const meetIdeas = get().meetIdeas.map((meetIdea) => {
      if (meetIdea.id !== id) return meetIdea;
      personId = meetIdea.personId;
      return {
        ...meetIdea,
        ...patch,
        title: patch.title !== undefined ? patch.title.trim() : meetIdea.title,
        note: patch.note !== undefined ? patch.note.trim() || undefined : meetIdea.note,
        updatedAt: Date.now(),
      };
    });
    const people = personId ? touchPeople(get().people, personId) : get().people;
    set({ meetIdeas, people });
    persistPeople(peopleSnapshot(get()));
  },

  removeMeetIdea: (id) => {
    const item = get().meetIdeas.find((meetIdea) => meetIdea.id === id);
    const meetIdeas = get().meetIdeas.filter((meetIdea) => meetIdea.id !== id);
    const people = item ? touchPeople(get().people, item.personId) : get().people;
    set({ meetIdeas, people });
    persistPeople(peopleSnapshot(get()));
  },

  addPersonRelation: (draft) => {
    const now = Date.now();
    const existing = get().personRelations.find(
      (relation) =>
        relation.fromPersonId === draft.fromPersonId &&
        relation.toPersonId === draft.toPersonId &&
        relation.relationType === draft.relationType,
    );
    if (existing) return existing;
    const relation: PersonRelation = {
      ...draft,
      id: genId(),
      note: draft.note?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const personRelations = [relation, ...get().personRelations];
    const people = touchPeople(touchPeople(get().people, draft.fromPersonId), draft.toPersonId);
    set({ personRelations, people });
    persistPeople(peopleSnapshot(get()));
    return relation;
  },

  removePersonRelation: (id) => {
    const item = get().personRelations.find((relation) => relation.id === id);
    const personRelations = get().personRelations.filter((relation) => relation.id !== id);
    const people = item
      ? touchPeople(touchPeople(get().people, item.fromPersonId), item.toPersonId)
      : get().people;
    set({ personRelations, people });
    persistPeople(peopleSnapshot(get()));
  },

  linkNoteToPerson: (personId, noteId) => {
    const exists = get().personNoteLinks.some((link) => link.personId === personId && link.noteId === noteId);
    if (exists) return;
    const personNoteLinks = [{ id: genId(), personId, noteId, createdAt: Date.now() }, ...get().personNoteLinks];
    const people = touchPeople(get().people, personId);
    set({ personNoteLinks, people });
    persistPeople(peopleSnapshot(get()));
  },

  unlinkNoteFromPerson: (personId, noteId) => {
    const personNoteLinks = get().personNoteLinks.filter(
      (link) => !(link.personId === personId && link.noteId === noteId),
    );
    const people = touchPeople(get().people, personId);
    set({ personNoteLinks, people });
    persistPeople(peopleSnapshot(get()));
  },

  addCalculatorHistory: (expression, result, value) => {
    const entry: CalculatorHistoryEntry = {
      id: genId(),
      expression,
      result,
      value,
      createdAt: Date.now(),
    };
    const calculatorHistory = [entry, ...get().calculatorHistory].slice(0, 30);
    const calculatorPrefs = { ...get().calculatorPrefs, lastAns: value };
    set({ calculatorHistory, calculatorPrefs });
    persistCalculator(calculatorHistory, calculatorPrefs);
  },

  clearCalculatorHistory: () => {
    const calculatorHistory: CalculatorHistoryEntry[] = [];
    set({ calculatorHistory });
    persistCalculator(calculatorHistory, get().calculatorPrefs);
  },

  setCalculatorPrefs: (patch) => {
    const calculatorPrefs = { ...get().calculatorPrefs, ...patch };
    set({ calculatorPrefs });
    persistCalculator(get().calculatorHistory, calculatorPrefs);
  },

  exportAll: () => {
    const s = get();
    return {
      app: 'coco',
      version: 1,
      exportedAt: Date.now(),
      data: {
        expenses: s.expenses,
        savings: s.savings,
        recurring: s.recurring,
        lists: s.lists,
        notes: s.notes,
        noteLists: s.noteLists,
        tagPages: s.tagPages,
        people: peopleSnapshot(s),
        calculator: { history: s.calculatorHistory, prefs: s.calculatorPrefs },
        wardrobe: s.wardrobe,
        outfits: s.outfits,
        collections: s.collections,
        inspiration: s.inspiration,
        fitting: s.fitting,
        wishlist: s.wishlist,
        sizes: s.sizes,
        reminderPrefs: s.reminderPrefs,
      },
    };
  },

  importAll: (payload) => {
    const bundle = payload as Partial<ExportBundle> | null;
    const d = bundle?.data;
    if (!d || typeof d !== 'object' || bundle?.app !== 'coco') return false;
    const ppl = d.people ?? {};
    set({
      expenses: d.expenses ?? [],
      savings: d.savings ?? [],
      recurring: d.recurring ?? [],
      lists: d.lists ?? [],
      notes: d.notes ?? [],
      noteLists: d.noteLists ?? [],
      tagPages: d.tagPages ?? [],
      people: ppl.people ?? [],
      preferences: ppl.preferences ?? [],
      gifts: ppl.gifts ?? [],
      conversations: ppl.conversations ?? [],
      promises: ppl.promises ?? [],
      meetIdeas: ppl.meetIdeas ?? [],
      personRelations: ppl.relations ?? [],
      personNoteLinks: ppl.noteLinks ?? [],
      calculatorHistory: d.calculator?.history ?? [],
      calculatorPrefs: { ...DEFAULT_CALCULATOR_PREFS, ...(d.calculator?.prefs ?? {}) },
      wardrobe: d.wardrobe ?? [],
      outfits: d.outfits ?? [],
      collections: d.collections ?? [],
      inspiration: d.inspiration ?? [],
      fitting: d.fitting ?? [],
      wishlist: d.wishlist ?? [],
      sizes: d.sizes ?? [],
      reminderPrefs: { ...DEFAULT_REMINDER_PREFS, ...(d.reminderPrefs ?? {}) },
    });
    const st = get();
    persistExpenses(st.expenses);
    persistSavings(st.savings);
    persistRecurring(st.recurring);
    persistLists(st.lists);
    persistNotes(st.notes, st.noteLists, st.tagPages);
    persistPeople(peopleSnapshot(st));
    persistCalculator(st.calculatorHistory, st.calculatorPrefs);
    persistWardrobe(st.wardrobe);
    persistOutfits(st.outfits);
    persistCollections(st.collections);
    persistInspiration(st.inspiration);
    persistFitting(st.fitting);
    persistWishlist(st.wishlist);
    persistSizes(st.sizes);
    persistReminderPrefs(st.reminderPrefs);
    return true;
  },

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
    // Detach the item from any outfit / collection that referenced it.
    const outfits = get().outfits.map((o) =>
      o.itemIds.includes(id) ? { ...o, itemIds: o.itemIds.filter((x) => x !== id) } : o,
    );
    const collections = get().collections.map((c) =>
      c.itemIds.includes(id) ? { ...c, itemIds: c.itemIds.filter((x) => x !== id) } : c,
    );
    const fitting = get().fitting.filter((x) => x !== id);
    set({ wardrobe, outfits, collections, fitting });
    persistWardrobe(wardrobe);
    persistOutfits(outfits);
    persistCollections(collections);
    persistFitting(fitting);
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
    // Detach any wishlist items that pointed at this outfit.
    const wishlist = get().wishlist.map((w) => (w.outfitId === id ? { ...w, outfitId: undefined } : w));
    set({ outfits, wishlist });
    persistOutfits(outfits);
    persistWishlist(wishlist);
  },

  getOutfit: (id) => get().outfits.find((o) => o.id === id),

  addCollection: (draft) => {
    const now = Date.now();
    const collection: Collection = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const collections = [collection, ...get().collections];
    set({ collections });
    persistCollections(collections);
    return collection;
  },

  updateCollection: (id, patch) => {
    const collections = get().collections.map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c,
    );
    set({ collections });
    persistCollections(collections);
  },

  removeCollection: (id) => {
    const collections = get().collections.filter((c) => c.id !== id);
    set({ collections });
    persistCollections(collections);
  },

  getCollection: (id) => get().collections.find((c) => c.id === id),

  toggleFitting: (id) => {
    const has = get().fitting.includes(id);
    const fitting = has ? get().fitting.filter((x) => x !== id) : [...get().fitting, id];
    set({ fitting });
    persistFitting(fitting);
  },

  setFitting: (ids) => {
    const valid = get().wardrobe.map((w) => w.id);
    const fitting = [...new Set(ids.filter((id) => valid.includes(id)))];
    set({ fitting });
    persistFitting(fitting);
  },

  clearFitting: () => {
    set({ fitting: [] });
    persistFitting([]);
  },

  addInspiration: (photos) => {
    const now = Date.now();
    const fresh: InspirationImage[] = photos.map((photo, i) => ({
      id: genId(),
      photo,
      createdAt: now + i,
    }));
    const inspiration = [...fresh.reverse(), ...get().inspiration];
    set({ inspiration });
    persistInspiration(inspiration);
  },

  removeInspiration: (id) => {
    const inspiration = get().inspiration.filter((i) => i.id !== id);
    set({ inspiration });
    persistInspiration(inspiration);
  },

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
