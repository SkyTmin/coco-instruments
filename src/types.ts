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

// ---- Cashflow: day-to-day transactions (spending + income) ----------------

/** Direction of a money movement. */
export type TxDirection = 'expense' | 'income';

/**
 * A single recorded movement of money — a purchase, a salary payout, a refund.
 * Unlike an Obligation (a debt paid off over a schedule), a Transaction is a
 * one-off fact: "on this date, this much money moved, in this category".
 */
export interface Transaction {
  id: string;
  direction: TxDirection;
  /** Always positive, in RUB. `direction` carries the sign. */
  amount: number;
  /** ISO 'YYYY-MM-DD'. */
  date: string;
  /** Category id from the catalog (see src/lib/categories.ts). */
  category: string;
  note?: string;
  /** Optional grouping list (reuses ExpenseList, e.g. "Свадьба"). */
  listId?: string;
  /** Set when this row was generated from an income source's payout. */
  incomeSourceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FinanceTransactionsBlob {
  version: 1;
  items: Transaction[];
}

// ---- Salary constructor (универсальный расчёт зарплаты вахтовика) ---------

/** How the base pay is measured. */
export type RateMode = 'hourly' | 'daily' | 'monthly';

/** How a supplement is expressed. */
export type BonusMode = 'percent' | 'fixed';

/** Manual mark for one calendar day (overrides the auto on/off cycle). */
export type WorkDayKind = 'work' | 'off' | 'holiday';
export interface WorkDayMark {
  kind: WorkDayKind;
  /** Night shift (paid night-hours bonus). */
  night?: boolean;
  /** Extra hours beyond the shift, paid at the overtime multiplier. */
  overtimeHours?: number;
}

/**
 * Full pay model for the salary calculator. Every supplement can be switched
 * on/off independently; the pure math lives in src/lib/salary.ts.
 */
export interface SalaryConfig {
  rateMode: RateMode;
  /** hourly — ₽/час. */
  hourRate?: number;
  /** daily — ₽/смена(день). */
  dayRate?: number;
  /** monthly — оклад ₽/мес. */
  monthlyBase?: number;
  /** Hours per shift (used by hourly mode and night/overtime math). */
  shiftHours?: number;

  premiumEnabled?: boolean;
  premiumMode?: BonusMode;
  premiumValue?: number;

  districtEnabled?: boolean;
  /** Районный коэффициент, e.g. 1.7 (multiplies the earnings body). */
  districtCoeff?: number;

  northEnabled?: boolean;
  /** Северная надбавка, % of the body. */
  northPercent?: number;

  specialEnabled?: boolean;
  specialMode?: BonusMode;
  /** Надбавка за особые условия (вредность и т.п.). */
  specialValue?: number;

  vahtaEnabled?: boolean;
  /** Вахтовая надбавка, ₽ за каждый рабочий календарный день (не облагается). */
  vahtaAllowancePerDay?: number;

  holidayEnabled?: boolean;
  /** Множитель оплаты праздничной смены (ТК: не менее 2). */
  holidayMultiplier?: number;

  nightEnabled?: boolean;
  /** Доплата за ночные часы, % от часовой ставки (ТК: не менее 20). */
  nightPercent?: number;
  /** Ночных часов в ночной смене (обычно 8: 22:00–06:00). */
  nightHoursPerShift?: number;

  overtimeEnabled?: boolean;
  /** Множитель сверхурочных (упрощённо один: обычно 2). */
  overtimeMultiplier?: number;

  /** true → показываем «на руки» (минус НДФЛ), false → «грязными». */
  ndflEnabled?: boolean;
  ndflPercent?: number;
}

/** A saved employer preset: apply once, never re-enter the numbers. */
export interface SalaryTemplate {
  id: string;
  name: string;
  config: SalaryConfig;
  createdAt: number;
}

export interface FinanceSalaryTemplatesBlob {
  version: 1;
  items: SalaryTemplate[];
}

// ---- Income sources (Russian pay schemes: оклад, вахта, смены) ------------

/**
 * How an income source pays out.
 * - salary:    monthly оклад split into аванс + окончательный расчёт (ТК ст.136).
 * - vahta:     rotational work (вахта) — on/off day cycle + вахтовая надбавка
 *              + районный коэффициент / северная надбавка.
 * - shift:     shift schedules (2/2, 3/3, сутки-трое) — rate × shifts, +ночные.
 * - recurring: a fixed periodic income (аренда, пенсия) — like RecurringPayment.
 * - oneoff:    a single expected payout (фриланс, продажа, подарок).
 */
export type IncomeScheme = 'salary' | 'vahta' | 'shift' | 'recurring' | 'oneoff';

export interface IncomeSource {
  id: string;
  name: string;
  scheme: IncomeScheme;

  // salary — оклад «на руки» за месяц + распределение по двум датам
  /** Net monthly pay, RUB. */
  monthlyNet?: number;
  /** Day of month the аванс lands (1..31). */
  advanceDay?: number;
  /** Day of month the окончательный расчёт lands (1..31, usually next month). */
  salaryDay?: number;
  /** Share of monthly pay paid as аванс, 0..100 (default ~45%). */
  advancePercent?: number;

  // vahta / shift — ставки и график
  /** Дневная ставка, RUB (vahta). */
  dayRate?: number;
  /** Часовая ставка, RUB (shift). */
  hourRate?: number;
  /** Рабочих дней в цикле (напр. 15, 30, 2, 3). */
  onDays?: number;
  /** Дней отдыха/межвахты в цикле (напр. 15, 30, 2, 3). */
  offDays?: number;
  /** Длина смены в часах (12, 24…). */
  shiftHours?: number;
  /** Вахтовая надбавка, RUB за календарный день (необлагаемая до 700 ₽/день, РФ). */
  vahtaAllowancePerDay?: number;
  /** Районный коэффициент (напр. 1.15, 1.7) — множитель на «тело», не на надбавку. */
  districtCoeff?: number;
  /** Северная надбавка, % (0..100). */
  northPercent?: number;
  /** Доплата за ночные часы, % (по умолчанию 20). */
  nightBonusPercent?: number;

  // recurring — интервал как у RecurringPayment
  intervalCount?: number;
  intervalUnit?: IntervalUnit;

  /** Универсальный зарплатный конструктор (vahta/shift/salary). Когда задан,
   *  расчёт идёт через src/lib/salary.ts, а legacy-поля выше игнорируются. */
  salary?: SalaryConfig;
  /** Ручная разметка календаря: ISO-дата → отметка дня (поверх авто-цикла). */
  calendar?: Record<string, WorkDayMark>;

  // общие
  /** Anchor date — start of the cycle / date of a one-off payout. */
  startDate: string;
  /** Temporarily excluded from forecasts & totals. */
  paused?: boolean;
  note?: string;
  /** Notify before/at each payout (default off). */
  notify?: boolean;
  notifyLeads?: number[];
  notifyTime?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FinanceIncomeBlob {
  version: 1;
  items: IncomeSource[];
}

// ---- Notes ----------------------------------------------------------------

/** A markdown-like note with Obsidian-style [[wiki links]]. */
export interface Note {
  id: string;
  title: string;
  /** Combined text of all messages — kept in sync, used for tag/link parsing. */
  body: string;
  attachments?: NoteAttachment[];
  /** Chat messages. Legacy notes have only `body`/`attachments` and migrate lazily. */
  messages?: NoteMessage[];
  /** Optional notebook/list this note belongs to. */
  listId?: string;
  /** Pinned to the top of the notes list. */
  pinned?: boolean;
  /** Graph: hide this note's dependency closure (collapsed via long-press). */
  depsHidden?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A notebook: a named group of notes with its own graph. */
export interface NoteList {
  id: string;
  name: string;
  emoji?: string;
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

/** One side of a flip-card: a photo, a text, or both (text over the photo). */
export interface NoteCardSide {
  text?: string;
  photo?: NoteAttachment;
}

/** A two-sided flip-card message: tap flips front ⇄ back. */
export interface NoteCard {
  front: NoteCardSide;
  back: NoteCardSide;
}

/** One message in a note/tag "chat": text and/or photos, sent at a time. */
export interface NoteMessage {
  id: string;
  text: string;
  attachments?: NoteAttachment[];
  createdAt: number;
  editedAt?: number;
  /** Pinned to the top bar of the chat (like Telegram). */
  pinned?: boolean;
  /** Replied-to message id (quote shown above the bubble). */
  replyToId?: string;
  /** When present the message renders as a flip-card instead of a bubble. */
  card?: NoteCard;
}

/** A tag's own page: a chat of messages (with a legacy text body kept in sync
 *  for tag/link parsing). Keyed by the normalised tag path, e.g. "здоровье/горло". */
export interface TagPage {
  tag: string;
  body: string;
  attachments?: NoteAttachment[];
  messages?: NoteMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface NotesBlob {
  version: 1;
  items: Note[];
  lists?: NoteList[];
  tagPages?: TagPage[];
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
export type PersonRelationType =
  | 'friend'
  | 'relative'
  | 'colleague'
  | 'acquaintance'
  | 'couple'
  | 'other';

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

// ---- Calculator: swipe-first scientific calculator ------------------------

export type CalculatorAngleMode = 'DEG' | 'RAD';

export interface CalculatorHistoryEntry {
  id: string;
  expression: string;
  result: string;
  value: number;
  createdAt: number;
}

export interface CalculatorPrefs {
  angleMode: CalculatorAngleMode;
  memory: number;
  lastAns: number;
  /** Whether the gesture onboarding has been completed (don't auto-show again). */
  onboardingDone?: boolean;
  /** Full-size (scientific) keypad with trig / log / constants visible. */
  scientific?: boolean;
}

export interface CalculatorBlob {
  version: 1;
  history: CalculatorHistoryEntry[];
  prefs: CalculatorPrefs;
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
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface WardrobeItemsBlob {
  version: 1;
  items: WardrobeItem[];
}

/** The "fitting room" — a temporary set of items being assembled into a look. */
export interface WardrobeFittingBlob {
  version: 1;
  itemIds: string[];
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
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface WardrobeOutfitsBlob {
  version: 1;
  items: Outfit[];
}

/** Where a wished item is in the buying journey. */
export type WishStatus = 'want' | 'searching' | 'bought';

/** Something you'd like to buy. */
export interface WishItem {
  id: string;
  name: string;
  photo?: Attachment;
  price?: number;
  link?: string;
  note?: string;
  /** Buying stage: хочу / ищу / куплено. */
  status?: WishStatus;
  /** Optional link to the outfit this item is missing for. */
  outfitId?: string;
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
