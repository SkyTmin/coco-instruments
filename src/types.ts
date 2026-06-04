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
  /** Which lead-days to remind on, e.g. [0,1] = on the day + a day before. */
  notifyLeads?: number[];
  /** Time of day to remind, "HH:MM" local. */
  notifyTime?: string;

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
  /** Which lead-days to remind on, e.g. [0,1] = on the day + a day before. */
  notifyLeads?: number[];
  /** Time of day to remind, "HH:MM" local. */
  notifyTime?: string;
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
  /** Which lead-days to remind on by default; 0 = on the due date. */
  leads: number[];
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

/** A stored photo/file: a served `url` once uploaded, else an inline `dataUrl`. */
export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  url?: string;
  dataUrl?: string;
  createdAt: number;
}
/** Notes historically called it NoteAttachment — keep the alias. */
export type NoteAttachment = Attachment;

export interface NotesBlob {
  version: 1;
  items: Note[];
}

// ---- People: personal relationship base ----------------------------------

export type PersonCategory = 'family' | 'friend' | 'work' | 'relationship' | 'other';
export type PersonCloseness = 1 | 2 | 3 | 4 | 5;
export type PreferenceType =
  | 'food'
  | 'drink'
  | 'music'
  | 'movies'
  | 'places'
  | 'colors'
  | 'style'
  | 'hobbies'
  | 'dislikes'
  | 'other';
export type GiftStatus = 'idea' | 'bought' | 'given';
export type ConversationImportance = 'low' | 'normal' | 'high';
export type ConversationMood = 'warm' | 'neutral' | 'hard' | 'happy';
export type PersonPromiseStatus = 'open' | 'done' | 'cancelled';
export type MeetIdeaStatus = 'idea' | 'planned' | 'done';
export type PersonRelationType = 'friend' | 'relative' | 'colleague' | 'acquaintance' | 'couple' | 'other';

/** A person in the private relationship base, not a phonebook contact. */
export interface Person {
  id: string;
  name: string;
  avatar?: Attachment;
  /** Primary category kept for older saved data and simple filtering. */
  category: PersonCategory;
  /** Multi-category profile, e.g. friend + work. */
  categories?: PersonCategory[];
  closeness: PersonCloseness;
  birthday?: string;
  phone?: string;
  socials?: string;
  city?: string;
  /** "Кто это для меня?" */
  description?: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Preference {
  id: string;
  personId: string;
  type: PreferenceType;
  value: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Gift {
  id: string;
  personId: string;
  title: string;
  status: GiftStatus;
  price?: number;
  date?: string;
  reaction?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  personId: string;
  date: string;
  title: string;
  note?: string;
  importance: ConversationImportance;
  mood?: ConversationMood;
  createdAt: number;
  updatedAt: number;
}

export interface PersonPromise {
  id: string;
  personId: string;
  title: string;
  dueDate?: string;
  reminderDate?: string;
  status: PersonPromiseStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface MeetIdea {
  id: string;
  personId: string;
  title: string;
  status: MeetIdeaStatus;
  date?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersonRelation {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  relationType: PersonRelationType;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PersonNoteLink {
  id: string;
  personId: string;
  noteId: string;
  createdAt: number;
}

export interface PeopleBlob {
  version: 1;
  people: Person[];
  preferences: Preference[];
  gifts: Gift[];
  conversations: Conversation[];
  promises: PersonPromise[];
  meetIdeas: MeetIdea[];
  relations: PersonRelation[];
  noteLinks: PersonNoteLink[];
}

// ---- Clothing: wardrobe items, outfits, sizes, wishlist -------------------

export type ClothingCategory = 'top' | 'bottom' | 'outerwear' | 'shoes' | 'accessory' | 'other';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn' | 'all';

/** A single garment, photographed so you remember you own it. */
export interface WardrobeItem {
  id: string;
  name: string;
  category: ClothingCategory;
  photo?: Attachment;
  color?: string;
  season?: Season;
  brand?: string;
  size?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
export interface WardrobeItemsBlob {
  version: 1;
  items: WardrobeItem[];
}

/** A themed group of wardrobe items (e.g. "Для работы", "Чёрное", "Лето"). */
export interface Collection {
  id: string;
  name: string;
  emoji?: string;
  itemIds: string[];
  createdAt: number;
  updatedAt: number;
}
export interface WardrobeCollectionsBlob {
  version: 1;
  items: Collection[];
}

/** A saved inspiration image (screenshot / reference / idea). */
export interface InspirationImage {
  id: string;
  photo: Attachment;
  note?: string;
  createdAt: number;
}
export interface WardrobeInspirationBlob {
  version: 1;
  items: InspirationImage[];
}

/** Placement of one item-sticker on the outfit collage board (fractions 0..1). */
export interface OutfitLayoutItem {
  itemId: string;
  x: number;
  y: number;
  scale: number;
  rot: number; // degrees
  z: number;
}

/** A saved look: a collage/cover + the wardrobe items it's made of. */
export interface Outfit {
  id: string;
  name: string;
  cover?: Attachment;
  itemIds: string[];
  layout?: OutfitLayoutItem[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}
export interface WardrobeOutfitsBlob {
  version: 1;
  items: Outfit[];
}

/** Something you'd like to buy. */
export interface WishItem {
  id: string;
  name: string;
  photo?: Attachment;
  price?: number;
  link?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}
export interface WardrobeWishlistBlob {
  version: 1;
  items: WishItem[];
}

/** One row of the "my sizes" record, e.g. { label: "Футболка", value: "M" }. */
export interface SizeEntry {
  id: string;
  label: string;
  value: string;
}
export interface WardrobeSizesBlob {
  version: 1;
  items: SizeEntry[];
}
