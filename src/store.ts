import { create } from 'zustand';
import type {
  Attachment,
  CalculatorBlob,
  CameraBlob,
  CameraScript,
  CameraShotItem,
  CameraSketch,
  CalculatorHistoryEntry,
  CalculatorPrefs,
  ExpenseList,
  FinanceExpensesBlob,
  FinanceListsBlob,
  FinanceRecurringBlob,
  FinanceRemindersBlob,
  FinanceSavingsBlob,
  FinanceTransactionsBlob,
  FinanceIncomeBlob,
  FinanceSalaryTemplatesBlob,
  IncomeSource,
  SalaryConfig,
  SalaryTemplate,
  Transaction,
  Collection,
  InspirationImage,
  Note,
  NoteAttachment,
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
  PrompterPrefs,
  RecurringPayment,
  ReminderPrefs,
  SavingsGoal,
  SizeEntry,
  SlotSpin,
  ScatterFsState,
  SlotsBlob,
  SlotsMissions,
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

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: true,
  leads: [0],
  hour: 9,
  minute: 0,
};
export const DEFAULT_PROMPTER_PREFS: PrompterPrefs = {
  speed: 40,
  fontSize: 24,
};
export const DEFAULT_CALCULATOR_PREFS: CalculatorPrefs = {
  angleMode: 'DEG',
  memory: 0,
  lastAns: 0,
  onboardingDone: false,
  scientific: false,
};
import { getStorage, STORAGE_KEYS } from '@/lib/storage';
import { deleteAttachmentFile } from '@/lib/images';
import type { SkinId } from '@/lib/skins';
import {
  BETS,
  clampBet,
  MIN_BET,
  JACKPOT_BASE,
  JACKPOT_RATE,
  RESCUE_COOLDOWN_MS,
  RESCUE_SPINS,
  resolveSpin,
  START_BALANCE,
} from '@/lib/slots';
import type { SpinOutcome } from '@/lib/slots';
import { ANTE_COST, BUY_BONUS_COST, FREE_SPINS, resolveScatter } from '@/lib/scatter';
import type { ScatterRound } from '@/lib/scatter';
import {
  BIG_BET,
  EMPTY_COUNTERS,
  WHEEL,
  WHEEL_COOLDOWN_MS,
  dailyMissions,
  dailyStatus,
  dayKey,
  levelFromXp,
  levelReward,
  missionDone,
  spinWheel,
  xpForSpin,
} from '@/lib/slots-meta';
import type { MissionCounters } from '@/lib/slots-meta';
import { advance, SESSION_GAP_MS, worthShowing } from '@/lib/session';
import type { Session, SpinRecord } from '@/lib/session';
import { genId } from '@/lib/id';
import {
  bagCapacity,
  bagCost,
  bagCount,
  bagValue,
  BAG_MAX,
  CART_PRICE,
  CREW_MAX,
  crewCost,
  crewYield,
  DEPTH,
  enchantCost,
  enchantRefund,
  ENERGY_MS,
  freshMine,
  FIND_DUP_TOKENS,
  FRENZY_MS,
  itemOf,
  NO_PERKS,
  perkPointsFree,
  PERKS,
  PRESTIGE_KEYS,
  RANK_KEYS,
  rollCase,
  LENS_MS,
  HANDLES,
  PROP_BOARDS,
  PROP_MS,
  PROP_REFORGE,
  liveEvent,
  PICK_LEVEL_MAX,
  PICK_STARS_MAX,
  crewShiftOf,
  crewFeedCost,
  CREW_FEED_WINDOW_MIN,
  SCOUT_KEYS_PER_H,
  SCOUT_PARCELS_PER_H,
  rollTier,
  STAR_KEYS,
  STAR_TOKENS,
  ZONE_BONUS_MS,
  ZONE_IDLE_MS,
  ZONE_MAX_MS,
  ZONE_MS,
  ZONE_QUOTA,
  zoneLeft,
  zoneMineId,
  zoneTier,
  zoneToday,
  zoneTokens,
  modsOf,
  rollDrops,
  stash,
  LAST_RANK,
  normalizePrison,
  PICKS,
  prestigeCost,
  PRESTIGE_XP,
  PRISON_START,
  rankCost,
  rankXp,
  sharpCost,
  SHARP_MAX,
  enchantCap,
  ENCHANT_TOGGLE,
  GUIDE,
  guideReady,
  pickLevelOf,
  pickLevelReward,
  quotaBuyout,
  quotaDone,
  rankQuota,
  STREAK_TIERS,
  streakLoot,
  applyReward,
  fusePlan,
  MILES,
  mileReady,
  PARCEL_NEED,
  PARCEL_OVERFLOW,
  PARCEL_SLOTS,
  petLevelOf,
  rollParcel,
  rollRune,
  RUNE_SHATTER,
  socketsOpen,
  seidReward,
  seidsOf,
  seidTop,
} from '@/lib/prison';
import {
  buildTree,
  dropHit,
  fellBonus,
  FOREST_START,
  forestMods,
  forestRankCost,
  LAST_PLOT,
  newTreeSeed,
  normalizeForest,
  pileCapacity,
  pileCost,
  PILE_MAX,
  planBuyout,
  forestPlan as forestPlanNeed,
  AXES,
  AXE_SHARP_MAX,
  axeSharpCost,
  rollChop,
  TRUCK_PRICE,
  axeEnchCap,
  axeEnchCost,
  axeLevelOf,
  boardsForSale,
  boardsReserve,
  boardsValue,
  freshForest,
  emptyPile as emptyPileOf,
  millCost,
  millFeedOne,
  millLoad,
  MILL_MAX,
  benchCan,
  benchOrder,
  benchOrders,
  BENCH_COOLDOWN_MS,
  sumRow,
  millTick,
  planCut,
  sumChops,
  takeBoards,
} from '@/lib/forest';
import {
  barygaBought,
  barygaLots,
  barygaWindow,
  BEAR_TAKES,
  eventDue,
  eventGap,
  eventPrize,
  spawnEvent,
} from '@/lib/yard';
import type { Lot, YardPrize } from '@/lib/yard';
import {
  applyDelta,
  canPay,
  conditionsMet,
  dieRun,
  DUNGEON_START,
  econOf,
  extractRun,
  liftCost,
  nextStep,
  normalizeDungeon,
  payFromBoth,
  payMats,
  SACK_MAX,
  sackCost,
} from '@/lib/dungeon';
import type {
  AreaId,
  DeepMineId,
  DeepMineState,
  DeltaIn,
  DungeonState,
  Haul,
  MatId,
  Sack,
  Slot,
} from '@/lib/dungeon';
import type {
  AxeEnchId,
  Chop,
  CutPlan,
  ForestState,
  HollowPrize,
  Pile,
  Side,
  Tree,
} from '@/lib/forest';
import type {
  CaseRoll,
  CaseTier,
  CrewShift,
  CrewYield,
  EnchantId,
  EventId,
  FindId,
  GuideReward,
  ItemId,
  Mile,
  PerkId,
  PetId,
  PrisonState,
  Reward,
  Rune,
  YardEvent,
} from '@/lib/prison';

/** Сколько прошлых заходов держим: хватает на «лучший за месяц». */
const SESSION_KEEP = 20;

/** Результат спина «Каскада» + то, что страница показывает сверху. */
export interface ScatterSpinOutcome extends ScatterRound {
  /** Спин не списал ставку: бонусное вращение или билет из наград. */
  freeSpin: boolean;
  levelUps: number[];
  /** Состояние бонуса после спина (null — бонуса нет). */
  fs: ScatterFsState | null;
  /** Этим спином бонус только что начался. */
  fsStarted: boolean;
}

/** Результат спина + всё, что странице нужно показать сверху. */
export interface SlotsSpinOutcome extends SpinOutcome {
  /** Сколько сорвано из копилки джекпота. */
  jackpotWin: number;
  /** Спин был бесплатным — ставка не списывалась. */
  freeSpin: boolean;
  /** Уровни, взятые этим спином (награды уже начислены). */
  levelUps: number[];
}
import { normalizeNoteTitle } from '@/lib/notes-graph';
import { deriveFromMessages, makeMessage, materializeMessages } from '@/lib/notes-messages';
import type { MessageExtra } from '@/lib/notes-messages';
import { deriveStatus, paidSoFar, resolve } from '@/lib/finance-calc';

export type ObligationDraft = Omit<
  Obligation,
  'id' | 'status' | 'createdAt' | 'updatedAt' | 'payments'
> & { payments?: Payment[] };

export type SavingsDraft = Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>;

export type RecurringDraft = Omit<RecurringPayment, 'id' | 'createdAt' | 'updatedAt'>;

export type TransactionDraft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;

export type IncomeSourceDraft = Omit<IncomeSource, 'id' | 'createdAt' | 'updatedAt'>;

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

function uniqueCategories(
  categories: Person['category'][] | undefined,
  fallback: Person['category'],
): Person['category'][] {
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

function makePersister<T>(key: string, delay = 300) {
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
    timer = setTimeout(write, delay);
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
const writeTransactions = makePersister<FinanceTransactionsBlob>(STORAGE_KEYS.transactions);
const writeIncome = makePersister<FinanceIncomeBlob>(STORAGE_KEYS.income);
const writeSalaryTemplates = makePersister<FinanceSalaryTemplatesBlob>(
  STORAGE_KEYS.salaryTemplates,
);
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
const writeCamera = makePersister<CameraBlob>(STORAGE_KEYS.camera);
// Шахта трогает слоты на каждом блоке (миссии дня, тачка продаёт сама), и
// запись слотов с задержкой 300 мс превратилась бы в запрос на каждый удар.
// Ленивая запись берёт снимок В МОМЕНТ записи, а не в момент вызова, поэтому
// не затрёт более свежую запись спина. Флашер стоит раньше writeSlots: при
// сворачивании он кладёт снимок, а writeSlots следом его отправляет.
let slotsLazyTimer: ReturnType<typeof setTimeout> | undefined;
const flushSlotsLazy = () => {
  if (!slotsLazyTimer) return;
  clearTimeout(slotsLazyTimer);
  slotsLazyTimer = undefined;
  persistSlots(useFinanceStore.getState());
};
flushers.push(flushSlotsLazy);
const persistSlotsLazy = () => {
  if (!slotsLazyTimer) slotsLazyTimer = setTimeout(flushSlotsLazy, 2000);
};
const writeSlots = makePersister<SlotsBlob>(STORAGE_KEYS.slots);
// Шахта пишется реже: блок ломается раз в полсекунды, и запрос на сервер на
// каждый блок — это кликер, который долбит сервер. При сворачивании всё
// равно сбрасывается сразу (flushAll выше).
const writePrison = makePersister<PrisonBlob>(STORAGE_KEYS.prison, 2000);
const persistPrison = (p: PrisonState) => writePrison({ version: 1, ...p });
// Лес пишется так же редко, как шахта: бревно — это несколько ударов в
// секунду, а запрос на каждое — кликер, который долбит сервер.
const writeForest = makePersister<ForestBlob>(STORAGE_KEYS.forest, 2000);
const persistForest = (f: ForestState) => writeForest({ version: 1, ...f });
// Подземелье пишется ещё реже: в бою страница сбрасывает дельту раз в
// несколько секунд, а не на каждую крысу.
const writeDungeon = makePersister<DungeonBlob>(STORAGE_KEYS.dungeon, 3000);
const persistDungeon = (d: DungeonState) => writeDungeon({ version: 1, ...d });

/**
 * Посылки зреют от любой добычи — блоков шахты и брёвен леса. Новая
 * ложится на свободное место; мест нет — сдаётся за токены.
 */
function tickParcels(
  p: PrisonState,
  n: number,
  fresh: CaseTier[],
): { parcels: PrisonState['parcels']; ready: number; added: CaseTier[]; tokens: number } {
  let ready = 0;
  const parcels = p.parcels.map((x) => {
    const left = Math.max(0, x.left - n);
    if (x.left > 0 && left === 0) ready += 1;
    return { ...x, left };
  });
  let tokens = 0;
  const added: CaseTier[] = [];
  for (const tier of fresh) {
    if (parcels.length < PARCEL_SLOTS) {
      parcels.push({ tier, left: PARCEL_NEED[tier] });
      added.push(tier);
    } else tokens += PARCEL_OVERFLOW[tier];
  }
  return { parcels, ready, added, tokens };
}

/**
 * Событие двора кончилось по часам. Медведь, которого не отогнали, уносит
 * половину штабеля; метеорит остывает, Куйва уходит в скалу, конвой уезжает.
 */
function settleEvent(
  p: PrisonState,
  f: ForestState,
  now: number,
): { p: PrisonState; f: ForestState; end: YardEnd | null } {
  const ev = p.event;
  if (!ev || ev.until > now) return { p, f, end: null };
  let forest = f;
  let lost = 0;
  if (ev.id === 'bear' && ev.have < ev.need && f.pile.n > 0) {
    const sp = f.pile.sp.map((n) => Math.ceil(n * (1 - BEAR_TAKES)));
    const n = sp.reduce((a, b) => a + b, 0);
    lost = f.pile.n - n;
    forest = { ...f, pile: { n, value: (f.pile.value * n) / f.pile.n, sp } };
  }
  const failed = ['meteor', 'kuiva', 'convoy', 'bear'].includes(ev.id);
  return { p: { ...p, event: null }, f: forest, end: { id: ev.id, failed, lost } };
}

/** Пора — начать событие. Первое после установки — через обычную паузу. */
function maybeStart(
  p: PrisonState,
  place: 'mine' | 'forest',
  now: number,
): { p: PrisonState; started: YardEvent | null } {
  if (!p.eventNext) return { p: { ...p, eventNext: now + eventGap(Math.random) }, started: null };
  if (!eventDue(p, now)) return { p, started: null };
  const ev = spawnEvent(place, p, now, Math.random);
  return { p: { ...p, event: ev, eventNext: ev.until + eventGap(Math.random) }, started: ev };
}

/** Приз события — в состояние; монеты кладёт вызывающий, в кошелёк. */
function givePrize(p: PrisonState, x: YardPrize, now: number): PrisonState {
  const tick = tickParcels(p, 0, x.parcel ? [x.parcel] : []);
  return {
    ...p,
    event: null,
    eventNext: now + eventGap(Math.random),
    eventsDone: p.eventsDone + 1,
    tokens: p.tokens + x.tokens + tick.tokens,
    keys: p.keys + x.keys,
    parcels: tick.parcels,
    items: x.item ? { ...p.items, [x.item.id]: p.items[x.item.id] + x.item.n } : p.items,
  };
}

/**
 * Сдать смену бригады: деньги, токены, у разведки — ключи и посылки.
 * Новая смена начинается сразу, тем же нарядом, но голодной.
 */
function collectCrew(p: PrisonState, now: number): { prison: PrisonState; y: CrewCollect } | null {
  const y = crewYield(p, now);
  if (!y.blocks) return null;
  const sh = crewShiftOf(p.crewShift);
  const hours = y.minutes / 60;
  const roll = (mean: number) =>
    Math.floor(mean) + (Math.random() < mean - Math.floor(mean) ? 1 : 0);
  const keys = sh.scout ? roll(hours * SCOUT_KEYS_PER_H) : 0;
  const found: CaseTier[] = [];
  if (sh.scout)
    for (let k = roll(hours * SCOUT_PARCELS_PER_H); k > 0; k--) found.push(rollTier(Math.random));
  const tick = tickParcels(p, 0, found);
  const prison: PrisonState = {
    ...p,
    crewFrom: now,
    crewFed: false,
    tokens: p.tokens + y.tokens + tick.tokens,
    keys: p.keys + keys,
    parcels: tick.parcels,
    earned: p.earned + y.coins,
  };
  return {
    prison,
    y: { ...y, keys, parcels: tick.added, parcelTokens: tick.tokens, shift: sh.id },
  };
}

/** Питомец растёт от каждого блока и бревна, пока он с собой. */
function feedPet(p: PrisonState, n: number): { pets: PrisonState['pets']; up: number } {
  if (!p.pet || p.pets[p.pet] === undefined) return { pets: p.pets, up: 0 };
  const before = petLevelOf(p.pets[p.pet] ?? 0).level;
  const xp = (p.pets[p.pet] ?? 0) + n;
  const after = petLevelOf(xp).level;
  return { pets: { ...p.pets, [p.pet]: xp }, up: after > before ? after : 0 };
}

const persistExpenses = (items: Obligation[]) => writeExpenses({ version: 1, items });
const persistSavings = (items: SavingsGoal[]) => writeSavings({ version: 1, items });
const persistRecurring = (items: RecurringPayment[]) => writeRecurring({ version: 1, items });
const persistLists = (items: ExpenseList[]) => writeLists({ version: 1, items });
const persistTransactions = (items: Transaction[]) => writeTransactions({ version: 1, items });
const persistIncome = (items: IncomeSource[]) => writeIncome({ version: 1, items });
const persistSalaryTemplates = (items: SalaryTemplate[]) =>
  writeSalaryTemplates({ version: 1, items });
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
const persistCamera = (s: {
  cameraSketches: CameraSketch[];
  cameraShots: CameraShotItem[];
  cameraScripts: CameraScript[];
  prompterPrefs: PrompterPrefs;
}) =>
  writeCamera({
    version: 1,
    sketches: s.cameraSketches,
    shots: s.cameraShots,
    scripts: s.cameraScripts,
    prompter: s.prompterPrefs,
  });

/** Сохранение лесоповала — отдельным ключом, чтобы шахта не распухала. */
interface ForestBlob extends ForestState {
  version: 1;
}

/** Сохранение подземелья — своим ключом: снаряжение, счётчики, вылазка. */
interface DungeonBlob extends DungeonState {
  version: 1;
}

/** Итог выхода клетью — для экрана «Поднялся». */
export interface DungeonExit {
  haul: Haul;
  pay: number;
}

/** Снимок вылазки для записи — форма `RunSnap` симуляции. */
export interface DungeonSnap {
  area: AreaId;
  x: number;
  ly: number;
  hp: number;
  sack: Sack;
  killed: number;
}

/** Сохранение каторги: состояние шахты целиком, деньги — в кошельке слотов. */
interface PrisonBlob extends PrisonState {
  version: 1;
}

/** Что принёс удар (или пачка блоков). */
export interface PrisonLoot {
  broken: number;
  taken: number;
  lost: number;
  sold: number;
  tokens: number;
  keys: number;
  finds: { id: FindId; fresh: boolean }[];
  /** Новые уровни кирки этим ударом, с наградой за каждый. */
  pickUps: { level: number; tokens: number; keys: number }[];
  /** Этим ударом норма ранга выполнена целиком. */
  normDone: boolean;
  /** Сколько блоков каждой породы легло в норму. */
  normAdd: Record<number, number>;
  /** Перекованные блоки: клетка и порода, которой он засчитан. */
  reforged: { cell: number; rock: number }[];
  /** Новые посылки под полем; не влезли — сданы за столько токенов. */
  parcels: CaseTier[];
  parcelTokens: number;
  /** Сколько посылок дозрело этим ударом. */
  parcelsReady: number;
  /** Питомец дорос до этого уровня (0 — нет). */
  petUp: number;
  /** Двор: событие началось, выполнено этим ударом или кончилось по часам. */
  eventStarted: YardEvent | null;
  eventDone: YardPrize | null;
  eventEnded: YardEnd | null;
  /** Спецзона: токены за удар, норма зоны добавила время, время вышло. */
  zone: { tokens: number; bonus: boolean; ended: boolean } | null;
}

/** Событие кончилось по часам. `lost` — сколько брёвен унёс медведь. */
export interface YardEnd {
  id: EventId;
  failed: boolean;
  lost: number;
}

/** Что принёс удар топором: одно бревно, два (замах) или всё дерево. */
export interface ForestCut {
  /** Всё срубленное этим ударом, сложенное вместе. */
  chop: Chop;
  hollows: HollowPrize[];
  /** Дерево, с которого рубили, номер нижнего бревна и сколько ушло. */
  tree: Tree;
  index: number;
  take: number;
  how: CutPlan['how'];
  /** На твою сторону опустился сучок. */
  hit: boolean;
  /** Сучок падал на голову, но Чутьё увело. */
  dodged: boolean;
  /** Дерево повалено: бонус с кроны и токены сейд-сосны. */
  felled: { value: number; tokens: number } | null;
  /** Бурелом: следующее дерево легло следом, целиком. */
  storm: { tree: Tree; logs: number; tokens: number } | null;
  /** Лесовоз увёз штабель; без лесовоза лишнее осталось в снегу. */
  sold: number;
  lost: number;
  /** Сколько брёвен лесовоз отвёз на пилораму. */
  toMill: number;
  planDone: boolean;
  parcels: CaseTier[];
  parcelsReady: number;
  petUp: number;
  eventStarted: YardEvent | null;
  eventDone: YardPrize | null;
  eventEnded: YardEnd | null;
}

/** Принятая смена бригады: добыча и находки разведки. */
export interface CrewCollect extends CrewYield {
  keys: number;
  parcels: CaseTier[];
  parcelTokens: number;
  shift: CrewShift;
}

/** Сундуки, открытые разом. */
export interface CasesOpened {
  rolls: CaseRoll[];
  coins: number;
  /** Руны, разбитые на токены: мешочек был полон. */
  shattered: number;
  newPets: PetId[];
}

/** Вскрытая посылка — для сцены на странице. */
export interface ParcelOpen {
  tier: CaseTier;
  reward: Reward;
  /** Руна не влезла в мешочек — разбита на токены. */
  shattered: number;
  newPet: PetId | null;
}

/** Забранная веха: что пришло сверху токенов и ключей. */
export interface MileClaim {
  mile: Mile;
  parcel: ParcelOpen | null;
  rune: Rune | null;
}

/** Итог нового ранга: для сцены на странице. */
export interface PrisonRankUp {
  rank: number;
  cost: number;
  /** Сколько из цены ушло на откуп нормы. */
  buyout: number;
  levelUps: number[];
}

/** Всё, что относится к слотам, — один снимок состояния для записи и экспорта. */
interface SlotsSnapshot {
  slotsBalance: number;
  slotsBet: number;
  slotsSpins: number;
  slotsBest: number;
  slotsBonusAt?: number;
  slotsHistory: SlotSpin[];
  slotsJackpot: number;
  slotsSkin: SkinId;
  /** Лучший множитель за всё время, в ставках: он открывает «Реликвию». */
  slotsTopX: number;
  slotsSound: boolean;
  slotsHaptics: boolean;
  slotsTurbo: boolean;
  slotsXp: number;
  slotsRewardedLevel: number;
  slotsDailyAt?: string;
  slotsStreak: number;
  slotsMissions: SlotsMissions;
  slotsWheelAt?: number;
  slotsFreeSpins: number;
  scatterSpins: number;
  scatterBest: number;
  scatterAnte: boolean;
  scatterFs: ScatterFsState | null;
  sessionNow: Session | null;
  sessionPast: Session[];
}

const slotsBlob = (s: SlotsSnapshot): SlotsBlob => ({
  version: 1,
  balance: s.slotsBalance,
  bet: s.slotsBet,
  spins: s.slotsSpins,
  best: s.slotsBest,
  lastBonusAt: s.slotsBonusAt,
  history: s.slotsHistory,
  jackpot: s.slotsJackpot,
  skin: s.slotsSkin,
  topX: s.slotsTopX,
  sound: s.slotsSound,
  haptics: s.slotsHaptics,
  turbo: s.slotsTurbo,
  xp: s.slotsXp,
  rewardedLevel: s.slotsRewardedLevel,
  dailyAt: s.slotsDailyAt,
  dailyStreak: s.slotsStreak,
  missions: s.slotsMissions,
  wheelAt: s.slotsWheelAt,
  freeSpins: s.slotsFreeSpins,
  scatterSpins: s.scatterSpins,
  scatterBest: s.scatterBest,
  scatterAnte: s.scatterAnte,
  scatterFs: s.scatterFs,
  session: s.sessionNow,
  sessionPast: s.sessionPast,
});

const persistSlots = (s: SlotsSnapshot) => writeSlots(slotsBlob(s));

/** Пустой прогресс миссий на сегодня. */
const freshMissions = (day = dayKey()): SlotsMissions => ({
  day,
  counters: { ...EMPTY_COUNTERS },
  claimed: [],
});

/** Счётчики дня: если наступил новый день, начинаем с нуля. */
const missionsForToday = (m: SlotsMissions | undefined, day = dayKey()): SlotsMissions =>
  m && m.day === day ? m : freshMissions(day);

/** Читаем прогрессию из сохранённого блоба (со всеми умолчаниями). */
/** Ставка из сохранения могла выйти за границы — возвращаем в диапазон. */
const snapBet = (bet?: number): number => (typeof bet === 'number' ? clampBet(bet) : BETS[0]);

const slotsProgress = (blob?: Partial<SlotsBlob> | null) => ({
  slotsXp: blob?.xp ?? 0,
  slotsRewardedLevel: blob?.rewardedLevel ?? 1,
  slotsDailyAt: blob?.dailyAt,
  slotsStreak: blob?.dailyStreak ?? 0,
  slotsMissions: missionsForToday(blob?.missions),
  slotsWheelAt: blob?.wheelAt,
  slotsFreeSpins: blob?.freeSpins ?? 0,
  scatterSpins: blob?.scatterSpins ?? 0,
  scatterBest: blob?.scatterBest ?? 0,
  scatterAnte: blob?.scatterAnte ?? false,
  scatterFs: blob?.scatterFs ?? null,
  sessionNow: blob?.session ?? null,
  // Двадцати прошлых заходов хватает, чтобы сказать «лучший за месяц»,
  // и они не раздувают сохранение.
  sessionPast: (blob?.sessionPast ?? []).slice(0, SESSION_KEEP),
});

/**
 * Заход из сохранения, к которому давно не возвращались, считается
 * законченным: показываем его итог прямо на входе.
 *
 * Это не редкий случай, а ОСНОВНОЙ: мини-приложение в Telegram чаще всего
 * закрывают резко, а не «выходят из игры». Без этого заход почти всегда
 * утекал бы в никуда, и вспоминать было бы нечего.
 */
function staleSession(p: {
  sessionNow: Session | null;
  sessionPast: Session[];
}): Partial<{ sessionNow: Session | null; sessionPast: Session[]; sessionCard: Session | null }> {
  const now = p.sessionNow;
  if (!now || Date.now() - now.lastAt <= SESSION_GAP_MS) return {};
  if (!worthShowing(now)) return { sessionNow: null };
  return {
    sessionNow: null,
    sessionPast: [now, ...p.sessionPast].slice(0, SESSION_KEEP),
    sessionCard: now,
  };
}

// ---- Full data export / import (user-controlled backup) -------------------
interface ExportData {
  expenses?: Obligation[];
  savings?: SavingsGoal[];
  recurring?: RecurringPayment[];
  lists?: ExpenseList[];
  transactions?: Transaction[];
  income?: IncomeSource[];
  salaryTemplates?: SalaryTemplate[];
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
  cameraSketches?: CameraSketch[];
  cameraShots?: CameraShotItem[];
  cameraScripts?: CameraScript[];
  prompterPrefs?: Partial<PrompterPrefs>;
  slots?: Partial<Omit<SlotsBlob, 'version'>>;
  prison?: Partial<PrisonState>;
  forest?: Partial<ForestState>;
  dungeon?: Partial<DungeonState>;
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
  transactions: Transaction[];
  incomeSources: IncomeSource[];
  salaryTemplates: SalaryTemplate[];
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
  cameraSketches: CameraSketch[];
  cameraShots: CameraShotItem[];
  cameraScripts: CameraScript[];
  prompterPrefs: PrompterPrefs;
  slotsBalance: number;
  slotsBet: number;
  slotsSpins: number;
  slotsBest: number;
  slotsBonusAt?: number;
  slotsHistory: SlotSpin[];
  slotsJackpot: number;
  slotsSkin: SkinId;
  slotsTopX: number;
  slotsSound: boolean;
  slotsHaptics: boolean;
  slotsTurbo: boolean;
  slotsXp: number;
  slotsRewardedLevel: number;
  slotsDailyAt?: string;
  slotsStreak: number;
  slotsMissions: SlotsMissions;
  slotsWheelAt?: number;
  slotsFreeSpins: number;
  scatterSpins: number;
  scatterBest: number;
  scatterAnte: boolean;
  scatterFs: ScatterFsState | null;
  /** Текущий заход за играми и последние завершённые. */
  sessionNow: Session | null;
  sessionPast: Session[];
  /** Заход, по которому надо показать итог; null — показывать нечего. */
  sessionCard: Session | null;
  /** Каторга: ранг, кирка, рюкзак, шахта. Деньги — общие, в `slotsBalance`. */
  prison: PrisonState;
  forest: ForestState;
  /** Подземелье: снаряжение, счётчики, склад, текущая вылазка. */
  dungeon: DungeonState;
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

  addTransaction: (draft: TransactionDraft) => Transaction;
  updateTransaction: (id: string, patch: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  getTransaction: (id: string) => Transaction | undefined;

  addSalaryTemplate: (name: string, config: SalaryConfig) => SalaryTemplate;
  removeSalaryTemplate: (id: string) => void;

  addIncomeSource: (draft: IncomeSourceDraft) => IncomeSource;
  updateIncomeSource: (id: string, patch: Partial<IncomeSource>) => void;
  removeIncomeSource: (id: string) => void;
  getIncomeSource: (id: string) => IncomeSource | undefined;

  addList: (draft: ListDraft) => ExpenseList;
  updateList: (id: string, patch: Partial<ExpenseList>) => void;
  removeList: (id: string) => void;
  getList: (id: string) => ExpenseList | undefined;

  addNote: (draft: NoteDraft) => Note;
  addNoteMessage: (
    noteId: string,
    text: string,
    attachments: NoteAttachment[],
    extra?: MessageExtra,
  ) => void;
  updateNoteMessage: (
    noteId: string,
    messageId: string,
    text: string,
    attachments: NoteAttachment[],
    extra?: MessageExtra,
  ) => void;
  removeNoteMessage: (noteId: string, messageId: string) => void;
  removeNoteMessages: (noteId: string, messageIds: string[]) => void;
  setNoteMessagePinned: (noteId: string, messageId: string, pinned: boolean) => void;
  getTagPage: (tag: string) => TagPage | undefined;
  addTagMessage: (
    tag: string,
    text: string,
    attachments: NoteAttachment[],
    extra?: MessageExtra,
  ) => void;
  updateTagMessage: (
    tag: string,
    messageId: string,
    text: string,
    attachments: NoteAttachment[],
    extra?: MessageExtra,
  ) => void;
  removeTagMessage: (tag: string, messageId: string) => void;
  removeTagMessages: (tag: string, messageIds: string[]) => void;
  setTagMessagePinned: (tag: string, messageId: string, pinned: boolean) => void;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  setNotePinned: (id: string, pinned: boolean) => void;
  setNoteDepsHidden: (id: string, hidden: boolean) => void;
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

  addCameraSketch: (photo: Attachment) => CameraSketch;
  updateCameraSketch: (id: string, patch: Partial<CameraSketch>) => void;
  removeCameraSketch: (id: string) => void;
  addCameraShot: (photo: Attachment) => CameraShotItem;
  removeCameraShot: (id: string) => void;
  addCameraScript: (title: string, text: string) => CameraScript;
  updateCameraScript: (id: string, patch: Partial<Pick<CameraScript, 'title' | 'text'>>) => void;
  removeCameraScript: (id: string) => void;
  setPrompterPrefs: (patch: Partial<PrompterPrefs>) => void;

  setSlotsBet: (bet: number) => void;
  playSlots: () => SlotsSpinOutcome | null;
  /** Спин второй игры («Каскад»): кошелёк, опыт и цели общие со слотами. */
  playScatter: () => ScatterSpinOutcome | null;
  /** Купить бонус сразу за сто ставок. */
  buyScatterBonus: () => boolean;
  setScatterAnte: (on: boolean) => void;
  /** Записать спин в текущий заход (вызывается самими играми). */
  recordSpin: (rec: SpinRecord) => void;
  /** Закрыть заход и показать итог, если он того стоит. */
  closeSession: () => void;
  /** Убрать карточку итога. */
  dismissSession: () => void;
  /** Касса: закинуть себе монет. Монеты виртуальные и не продаются. */
  addSlotsCoins: (amount: number) => void;
  /** Спасательные вращения, когда монет не хватает даже на минимальную ставку. */
  claimSlotsRescue: () => number;
  /** Ежедневная лесенка: возвращает начисленное и новую длину серии. */
  claimSlotsDaily: () => { reward: number; streak: number } | null;
  /** Забрать награду за выполненную миссию дня. */
  claimSlotsMission: (id: string) => number;
  /** Крутнуть колесо: возвращает индекс сектора или null, если рано. */
  spinSlotsWheel: () => { index: number; coins: number; freeSpins: number } | null;
  setSlotsPrefs: (patch: {
    sound?: boolean;
    haptics?: boolean;
    turbo?: boolean;
    skin?: SkinId;
  }) => void;

  /**
   * Блоки сломаны (один ударом или пачкой — взрыв, жила, отбойник): клетки
   * стали на ярус глубже, добыча с Удачей и Куражом — в рюкзак, токены и
   * ключи — в карман. Места нет, а вагонетка куплена — она продаёт рюкзак
   * сама.
   */
  prisonBreak: (breaks: { cell: number; rock: number }[], opts?: { streak?: number }) => PrisonLoot;
  /** Запал дошёл до ступени `tier` (0…4): рекорд и миссия дня. */
  prisonStreak: (tier: number) => void;
  /** Вскрыть дозревшую посылку под номером `index`. */
  prisonParcelOpen: (index: number) => ParcelOpen | null;
  /** Руна в гнездо `slot` (0 — вынуть). */
  prisonRuneSocket: (slot: number, runeId: number) => void;
  prisonRuneFuse: (runeId: number) => Rune | null;
  prisonRuneShatter: (runeId: number) => number;
  prisonPetSet: (id: PetId | null) => void;
  /**
   * Лесоповал: срублено нижнее бревно текущего дерева со стороны `side`.
   * Урон по бревну живёт в странице, как урон по блоку в шахте.
   */
  forestCut: (side: Side, streak: number) => ForestCut;
  forestSell: () => number;
  forestBuy: (what: 'axe' | 'sharp' | 'pile' | 'truck') => boolean;
  /** Новый разряд лесоруба. Без плана — только с `buyout`, за доплату. */
  forestRankUp: (buyout?: boolean) => { rank: number; cost: number; buyout: number } | null;
  /** Чары топора за общие токены: до `count` уровней. */
  forestEnchant: (id: AxeEnchId, count?: number) => number;
  /** Пилорама: купить или поднять уровень за монеты. */
  forestMillUp: () => boolean;
  /** Штабель — в очередь пилорамы; надбавка за особые брёвна — сразу в кошелёк. */
  forestMillLoad: () => { loaded: number; premium: number };
  /** Продать доски (кроме запаса на следующую рукоять). */
  forestMillSell: () => number;
  /**
   * Подать бревно в пилу рукой. Очередь пуста — сперва ложится штабель.
   * Возвращает породу распиленного бревна (для картинки) и что загрузилось.
   */
  forestMillFeed: () => { species: number; loaded: number; premium: number } | null;
  /** Сбить крепь для шахты из досок. */
  forestCraftProp: () => boolean;
  /** Выточить следующую рукоять. */
  forestCraftHandle: () => boolean;
  /** Верстак: сдать заказ `i` — доски уходят, монеты и токены приходят. */
  forestOrderFill: (i: number) => { coins: number; tokens: number; item: string } | null;
  /** Двор: закрыть событие, чьё время вышло (медведь уносит штабель). */
  yardExpire: () => YardEnd | null;
  /** Разбит метеорит / повержен Куйва: забрать награду. */
  yardMeteor: () => YardPrize | null;
  yardKuiva: () => YardPrize | null;
  /** Барыга: купить лот `i` текущего окна за монеты. */
  barygaBuy: (i: number) => { lot: Lot; shattered: number; newPet: PetId | null } | null;
  /** Касса владельца: токены каторги пачкой. */
  prisonAddTokens: (amount: number) => void;
  /** Начать Каторгу заново. Кошелёк и уровень общие — остаются. */
  prisonReset: () => void;
  /**
   * Сбросить всё в зале игр: Каторгу, кошелёк, уровень, серию бонусов,
   * рекорды и историю. Звук, вибрация, турбо и скин остаются.
   */
  gamesReset: () => void;
  /** Спуститься клетью района. Недосиженная вылазка продолжается как есть. */
  dungeonEnter: (lift: AreaId, hp: number) => void;
  /** Запись вылазки на ходу: дельта прогресса и где стоишь. */
  dungeonSave: (snap: DungeonSnap, delta: DeltaIn, fog: Partial<Record<AreaId, string>>) => void;
  /** Поднялся клетью: мясо — Барыге, монеты — в кошелёк, токены и ключи — в каторгу. */
  dungeonExtract: (
    snap: DungeonSnap,
    delta: DeltaIn,
    fog: Partial<Record<AreaId, string>>,
  ) => DungeonExit | null;
  /** Погиб: сидор растащили, прогресс остался. */
  dungeonDie: (
    snap: DungeonSnap,
    delta: DeltaIn,
    fog: Partial<Record<AreaId, string>>,
  ) => Haul | null;
  /** Заточка или перековка слота — что вышло. */
  dungeonUpgrade: (slot: Slot) => 'plus' | 'reforge' | null;
  dungeonSackUp: () => boolean;
  /**
   * Заточка или перековка прямо в вылазке: материалы со склада, недостающее —
   * из сидора `sack`. Возвращает, что взять из сидора (его держит мир, а не стор).
   */
  dungeonUpgradeHere: (
    slot: Slot,
    sack: Partial<Record<MatId, number>>,
  ) => { kind: 'plus' | 'reforge'; fromSack: Partial<Record<MatId, number>> } | null;
  /** Нашить карман в вылазке — платёж так же, склад и сидор. */
  dungeonSackUpHere: (
    sack: Partial<Record<MatId, number>>,
  ) => { fromSack: Partial<Record<MatId, number>> } | null;
  dungeonLiftRepair: (area: AreaId) => boolean;
  /** Раскоп подземной шахты. `opened` — первый блок в этом окне, `ore` — руды в сидор. */
  dungeonMineSave: (id: DeepMineId, m: DeepMineState, opened: boolean, ore?: number) => void;
  dungeonIntroSeen: () => void;
  /** Заколотил нору: одна крепь из запаса каторги. */
  dungeonSpendProp: () => boolean;
  /** Разбит сейд-камень в клетке `cell`: токены и монеты. */
  prisonSeid: (cell: number) => { tokens: number; coins: number } | null;
  prisonMileClaim: (id: string) => MileClaim | null;
  /** Проводник: забрать награду за выполненный шаг. */
  prisonGuideClaim: () => GuideReward | null;
  prisonEnchantToggle: (id: EnchantId) => void;
  /** Зачарование: взять уровень за токены или сбросить с возвратом половины. */
  /** Купить до `count` уровней чары (сколько хватит токенов и потолка). */
  prisonEnchant: (id: EnchantId, count?: number) => number;
  prisonEnchantReset: (id: EnchantId) => number;
  /** Лавка: расходник за токены. */
  prisonBuyItem: (id: ItemId) => boolean;
  /** Потратить расходник. Энергетик и лупа включаются сразу. */
  prisonUseItem: (id: ItemId) => boolean;
  /** Кураж сработал на ударе. */
  prisonFrenzy: () => void;
  /** Открыть сундук: ключ уходит, награда начисляется сразу. */
  prisonOpenCase: () => CaseRoll | null;
  /**
   * Открыть до `count` сундуков разом. По одному, подряд: каждая находка
   * уже лежит в коллекции к следующему сундуку, поэтому не повторится.
   */
  prisonOpenCases: (count: number) => CasesOpened | null;
  /** Бригада: нанять или поднять уровень за монеты, забрать добычу. */
  prisonCrewUp: () => boolean;
  prisonCrewCollect: () => CrewCollect | null;
  /** Наряд на следующую смену. Накопленное по старому наряду сдаётся сразу. */
  prisonCrewShift: (shift: CrewShift) => CrewCollect | null;
  /** Пайка — только в первые минуты смены. */
  prisonCrewFeed: () => boolean;
  /** Перки престижа: взять уровень за очко или сбросить все. */
  prisonPerk: (id: PerkId) => boolean;
  prisonPerksReset: () => void;
  /** Спуститься в другую открытую шахту — или обновить эту. */
  prisonGoMine: (id: number) => void;
  /** Продать рюкзак в общий кошелёк. */
  prisonSell: () => number;
  /** Купить следующий ранг за общие монеты. */
  /** Новый ранг. Без выполненной нормы — только с `buyout`, за доплату. */
  prisonRankUp: (buyout?: boolean) => PrisonRankUp | null;
  prisonBuy: (what: 'pick' | 'sharp' | 'bag' | 'cart') => boolean;
  /** Престиж: ранг и шахта — на A, кирка остаётся, продажа дороже. */
  prisonPrestige: () => boolean;
  /** Спецзона: войти (после престижа, пока есть время сегодня) и выйти. */
  prisonZoneEnter: () => boolean;
  prisonZoneExit: () => void;
  /** Престиж кирки на 50-м уровне: опыт в ноль, звезда. */
  prisonPickStar: () => boolean;

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
  transactions: [],
  incomeSources: [],
  salaryTemplates: [],
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
  cameraSketches: [],
  cameraShots: [],
  cameraScripts: [],
  prompterPrefs: DEFAULT_PROMPTER_PREFS,
  slotsBalance: START_BALANCE,
  slotsBet: 25,
  slotsSpins: 0,
  slotsBest: 0,
  slotsHistory: [],
  slotsJackpot: JACKPOT_BASE,
  slotsSkin: 'classic',
  slotsTopX: 0,
  slotsSound: true,
  slotsHaptics: true,
  slotsTurbo: false,
  slotsXp: 0,
  slotsRewardedLevel: 1,
  slotsStreak: 0,
  slotsMissions: freshMissions(),
  slotsFreeSpins: 0,
  scatterSpins: 0,
  scatterBest: 0,
  scatterAnte: false,
  scatterFs: null,
  sessionNow: null,
  sessionPast: [],
  sessionCard: null,
  prison: PRISON_START,
  forest: FOREST_START,
  dungeon: DUNGEON_START,
  reminderPrefs: DEFAULT_REMINDER_PREFS,
  hydrated: false,

  hydrate: async () => {
    const storage = getStorage();
    const [
      exp,
      sav,
      rec,
      lists,
      txns,
      income,
      salaryTpl,
      notes,
      people,
      calc,
      rem,
      ward,
      outf,
      coll,
      insp,
      fit,
      wish,
      sizes,
      camera,
      slots,
      prison,
      forest,
      dungeon,
    ] = await Promise.all([
      storage.get<FinanceExpensesBlob>(STORAGE_KEYS.expenses),
      storage.get<FinanceSavingsBlob>(STORAGE_KEYS.savings),
      storage.get<FinanceRecurringBlob>(STORAGE_KEYS.recurring),
      storage.get<FinanceListsBlob>(STORAGE_KEYS.lists),
      storage.get<FinanceTransactionsBlob>(STORAGE_KEYS.transactions),
      storage.get<FinanceIncomeBlob>(STORAGE_KEYS.income),
      storage.get<FinanceSalaryTemplatesBlob>(STORAGE_KEYS.salaryTemplates),
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
      storage.get<CameraBlob>(STORAGE_KEYS.camera),
      storage.get<SlotsBlob>(STORAGE_KEYS.slots),
      storage.get<PrisonBlob>(STORAGE_KEYS.prison),
      storage.get<ForestBlob>(STORAGE_KEYS.forest),
      storage.get<DungeonBlob>(STORAGE_KEYS.dungeon),
    ]);
    set({
      expenses: exp?.items ?? [],
      savings: sav?.items ?? [],
      recurring: rec?.items ?? [],
      lists: lists?.items ?? [],
      transactions: txns?.items ?? [],
      incomeSources: income?.items ?? [],
      salaryTemplates: salaryTpl?.items ?? [],
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
      cameraSketches: camera?.sketches ?? [],
      cameraShots: camera?.shots ?? [],
      cameraScripts: camera?.scripts ?? [],
      prompterPrefs: { ...DEFAULT_PROMPTER_PREFS, ...(camera?.prompter ?? {}) },
      slotsBalance: slots?.balance ?? START_BALANCE,
      slotsBet: snapBet(slots?.bet),
      slotsSpins: slots?.spins ?? 0,
      slotsBest: slots?.best ?? 0,
      slotsBonusAt: slots?.lastBonusAt,
      slotsHistory: slots?.history ?? [],
      slotsJackpot: slots?.jackpot ?? JACKPOT_BASE,
      slotsSkin: (slots?.skin as SkinId) ?? 'classic',
      slotsTopX: slots?.topX ?? 0,
      slotsSound: slots?.sound ?? true,
      slotsHaptics: slots?.haptics ?? true,
      slotsTurbo: slots?.turbo ?? false,
      ...slotsProgress(slots),
      ...staleSession(slotsProgress(slots)),
      prison: normalizePrison(prison),
      forest: normalizeForest(forest),
      dungeon: normalizeDungeon(dungeon),
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

  addTransaction: (draft) => {
    const now = Date.now();
    const item: Transaction = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const transactions = [item, ...get().transactions];
    set({ transactions });
    persistTransactions(transactions);
    return item;
  },

  updateTransaction: (id, patch) => {
    const transactions = get().transactions.map((t) =>
      t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
    );
    set({ transactions });
    persistTransactions(transactions);
  },

  removeTransaction: (id) => {
    const transactions = get().transactions.filter((t) => t.id !== id);
    set({ transactions });
    persistTransactions(transactions);
  },

  getTransaction: (id) => get().transactions.find((t) => t.id === id),

  addIncomeSource: (draft) => {
    const now = Date.now();
    const item: IncomeSource = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const incomeSources = [item, ...get().incomeSources];
    set({ incomeSources });
    persistIncome(incomeSources);
    return item;
  },

  updateIncomeSource: (id, patch) => {
    const incomeSources = get().incomeSources.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s,
    );
    set({ incomeSources });
    persistIncome(incomeSources);
  },

  removeIncomeSource: (id) => {
    const incomeSources = get().incomeSources.filter((s) => s.id !== id);
    // Detach any transactions that were generated from this source.
    const transactions = get().transactions.map((t) =>
      t.incomeSourceId === id ? { ...t, incomeSourceId: undefined } : t,
    );
    set({ incomeSources, transactions });
    persistIncome(incomeSources);
    persistTransactions(transactions);
  },

  getIncomeSource: (id) => get().incomeSources.find((s) => s.id === id),

  addSalaryTemplate: (name, config) => {
    const tpl: SalaryTemplate = { id: genId(), name: name.trim(), config, createdAt: Date.now() };
    const salaryTemplates = [tpl, ...get().salaryTemplates];
    set({ salaryTemplates });
    persistSalaryTemplates(salaryTemplates);
    return tpl;
  },

  removeSalaryTemplate: (id) => {
    const salaryTemplates = get().salaryTemplates.filter((t) => t.id !== id);
    set({ salaryTemplates });
    persistSalaryTemplates(salaryTemplates);
  },

  addList: (draft) => {
    const now = Date.now();
    const list: ExpenseList = { ...draft, id: genId(), createdAt: now, updatedAt: now };
    const lists = [list, ...get().lists];
    set({ lists });
    persistLists(lists);
    return list;
  },

  updateList: (id, patch) => {
    const lists = get().lists.map((l) =>
      l.id === id ? { ...l, ...patch, updatedAt: Date.now() } : l,
    );
    set({ lists });
    persistLists(lists);
  },

  removeList: (id) => {
    const lists = get().lists.filter((l) => l.id !== id);
    // Keep the items, just detach them from the deleted list.
    const expenses = get().expenses.map((o) => (o.listId === id ? { ...o, listId: undefined } : o));
    const recurring = get().recurring.map((r) =>
      r.listId === id ? { ...r, listId: undefined } : r,
    );
    const transactions = get().transactions.map((t) =>
      t.listId === id ? { ...t, listId: undefined } : t,
    );
    set({ lists, expenses, recurring, transactions });
    persistLists(lists);
    persistExpenses(expenses);
    persistRecurring(recurring);
    persistTransactions(transactions);
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

  // ---- note chat messages (body/attachments stay in sync for the graph) ----
  addNoteMessage: (noteId, text, attachments, extra) => {
    const cur = get().notes.find((n) => n.id === noteId);
    if (!cur) return;
    const messages = [...materializeMessages(cur), makeMessage(text, attachments, extra)];
    const notes = get().notes.map((n) =>
      n.id === noteId
        ? { ...n, messages, ...deriveFromMessages(messages), updatedAt: Date.now() }
        : n,
    );
    set({ notes });
    persistNotes(notes, get().noteLists, get().tagPages);
  },
  updateNoteMessage: (noteId, messageId, text, attachments, extra) => {
    const cur = get().notes.find((n) => n.id === noteId);
    if (!cur) return;
    const messages = materializeMessages(cur).map((m) =>
      m.id === messageId
        ? {
            ...m,
            text: text.trim(),
            attachments,
            editedAt: Date.now(),
            ...(extra && 'card' in extra ? { card: extra.card } : {}),
          }
        : m,
    );
    const notes = get().notes.map((n) =>
      n.id === noteId
        ? { ...n, messages, ...deriveFromMessages(messages), updatedAt: Date.now() }
        : n,
    );
    set({ notes });
    persistNotes(notes, get().noteLists, get().tagPages);
  },
  removeNoteMessage: (noteId, messageId) => {
    get().removeNoteMessages(noteId, [messageId]);
  },
  removeNoteMessages: (noteId, messageIds) => {
    const cur = get().notes.find((n) => n.id === noteId);
    if (!cur) return;
    const drop = new Set(messageIds);
    const messages = materializeMessages(cur).filter((m) => !drop.has(m.id));
    const notes = get().notes.map((n) =>
      n.id === noteId
        ? { ...n, messages, ...deriveFromMessages(messages), updatedAt: Date.now() }
        : n,
    );
    set({ notes });
    persistNotes(notes, get().noteLists, get().tagPages);
  },
  setNoteMessagePinned: (noteId, messageId, pinned) => {
    const cur = get().notes.find((n) => n.id === noteId);
    if (!cur) return;
    const messages = materializeMessages(cur).map((m) =>
      m.id === messageId ? { ...m, pinned: pinned || undefined } : m,
    );
    const notes = get().notes.map((n) => (n.id === noteId ? { ...n, messages } : n));
    set({ notes });
    persistNotes(notes, get().noteLists, get().tagPages);
  },

  // A tag IS a page (a chat): its messages live on the tag itself, no note.
  getTagPage: (tag) => {
    const key = normalizeNoteTitle(tag);
    return get().tagPages.find((p) => p.tag === key);
  },
  addTagMessage: (tag, text, attachments, extra) => {
    const key = normalizeNoteTitle(tag);
    const now = Date.now();
    const existing = get().tagPages.find((p) => p.tag === key);
    const base: TagPage = existing ?? {
      tag: key,
      body: '',
      attachments: [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    const messages = [...materializeMessages(base), makeMessage(text, attachments, extra)];
    const next: TagPage = { ...base, messages, ...deriveFromMessages(messages), updatedAt: now };
    const tagPages = existing
      ? get().tagPages.map((p) => (p.tag === key ? next : p))
      : [next, ...get().tagPages];
    set({ tagPages });
    persistNotes(get().notes, get().noteLists, tagPages);
  },
  updateTagMessage: (tag, messageId, text, attachments, extra) => {
    const key = normalizeNoteTitle(tag);
    const existing = get().tagPages.find((p) => p.tag === key);
    if (!existing) return;
    const messages = materializeMessages(existing).map((m) =>
      m.id === messageId
        ? {
            ...m,
            text: text.trim(),
            attachments,
            editedAt: Date.now(),
            ...(extra && 'card' in extra ? { card: extra.card } : {}),
          }
        : m,
    );
    const next: TagPage = {
      ...existing,
      messages,
      ...deriveFromMessages(messages),
      updatedAt: Date.now(),
    };
    const tagPages = get().tagPages.map((p) => (p.tag === key ? next : p));
    set({ tagPages });
    persistNotes(get().notes, get().noteLists, tagPages);
  },
  removeTagMessage: (tag, messageId) => {
    get().removeTagMessages(tag, [messageId]);
  },
  removeTagMessages: (tag, messageIds) => {
    const key = normalizeNoteTitle(tag);
    const existing = get().tagPages.find((p) => p.tag === key);
    if (!existing) return;
    const drop = new Set(messageIds);
    const messages = materializeMessages(existing).filter((m) => !drop.has(m.id));
    const next: TagPage = {
      ...existing,
      messages,
      ...deriveFromMessages(messages),
      updatedAt: Date.now(),
    };
    const tagPages = get().tagPages.map((p) => (p.tag === key ? next : p));
    set({ tagPages });
    persistNotes(get().notes, get().noteLists, tagPages);
  },
  setTagMessagePinned: (tag, messageId, pinned) => {
    const key = normalizeNoteTitle(tag);
    const existing = get().tagPages.find((p) => p.tag === key);
    if (!existing) return;
    const messages = materializeMessages(existing).map((m) =>
      m.id === messageId ? { ...m, pinned: pinned || undefined } : m,
    );
    const next: TagPage = { ...existing, messages };
    const tagPages = get().tagPages.map((p) => (p.tag === key ? next : p));
    set({ tagPages });
    persistNotes(get().notes, get().noteLists, tagPages);
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

  // Pin/unpin — a position preference, so it doesn't bump updatedAt.
  setNotePinned: (id, pinned) => {
    const notes = get().notes.map((n) => (n.id === id ? { ...n, pinned } : n));
    set({ notes });
    persistNotes(notes, get().noteLists, get().tagPages);
  },

  // Graph view preference — toggled by long-press; doesn't bump updatedAt.
  setNoteDepsHidden: (id, hidden) => {
    const notes = get().notes.map((n) => (n.id === id ? { ...n, depsHidden: hidden } : n));
    set({ notes });
    persistNotes(notes, get().noteLists, get().tagPages);
  },

  getNote: (id) => get().notes.find((n) => n.id === id),

  addNoteList: (name, emoji) => {
    const now = Date.now();
    const list: NoteList = {
      id: genId(),
      name: name.trim() || 'Список',
      emoji,
      createdAt: now,
      updatedAt: now,
    };
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
              description:
                patch.description !== undefined
                  ? patch.description.trim() || undefined
                  : person.description,
              phone: patch.phone !== undefined ? patch.phone.trim() || undefined : person.phone,
              socials:
                patch.socials !== undefined ? patch.socials.trim() || undefined : person.socials,
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
    set({
      people,
      preferences,
      gifts,
      conversations,
      promises,
      meetIdeas,
      personRelations,
      personNoteLinks,
    });
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
    const exists = get().personNoteLinks.some(
      (link) => link.personId === personId && link.noteId === noteId,
    );
    if (exists) return;
    const personNoteLinks = [
      { id: genId(), personId, noteId, createdAt: Date.now() },
      ...get().personNoteLinks,
    ];
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
        transactions: s.transactions,
        income: s.incomeSources,
        salaryTemplates: s.salaryTemplates,
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
        cameraSketches: s.cameraSketches,
        cameraShots: s.cameraShots,
        cameraScripts: s.cameraScripts,
        prompterPrefs: s.prompterPrefs,
        slots: slotsBlob(s),
        prison: s.prison,
        forest: s.forest,
        dungeon: s.dungeon,
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
      transactions: d.transactions ?? [],
      incomeSources: d.income ?? [],
      salaryTemplates: d.salaryTemplates ?? [],
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
      cameraSketches: d.cameraSketches ?? [],
      cameraShots: d.cameraShots ?? [],
      cameraScripts: d.cameraScripts ?? [],
      prompterPrefs: { ...DEFAULT_PROMPTER_PREFS, ...(d.prompterPrefs ?? {}) },
      slotsBalance: d.slots?.balance ?? START_BALANCE,
      slotsBet: snapBet(d.slots?.bet),
      slotsSpins: d.slots?.spins ?? 0,
      slotsBest: d.slots?.best ?? 0,
      slotsBonusAt: d.slots?.lastBonusAt,
      slotsHistory: d.slots?.history ?? [],
      slotsJackpot: d.slots?.jackpot ?? JACKPOT_BASE,
      slotsSkin: (d.slots?.skin as SkinId) ?? 'classic',
      slotsTopX: d.slots?.topX ?? 0,
      slotsSound: d.slots?.sound ?? true,
      slotsHaptics: d.slots?.haptics ?? true,
      slotsTurbo: d.slots?.turbo ?? false,
      ...slotsProgress(d.slots),
      // Восстановление из копии — не повод показывать чей-то давний итог.
      sessionCard: null,
      prison: normalizePrison(d.prison),
      forest: normalizeForest(d.forest),
      dungeon: normalizeDungeon(d.dungeon),
      reminderPrefs: { ...DEFAULT_REMINDER_PREFS, ...(d.reminderPrefs ?? {}) },
    });
    const st = get();
    persistExpenses(st.expenses);
    persistSavings(st.savings);
    persistRecurring(st.recurring);
    persistLists(st.lists);
    persistTransactions(st.transactions);
    persistIncome(st.incomeSources);
    persistSalaryTemplates(st.salaryTemplates);
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
    persistCamera(st);
    persistSlots(st);
    persistPrison(st.prison);
    persistForest(st.forest);
    persistDungeon(st.dungeon);
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
    const wishlist = get().wishlist.map((w) =>
      w.outfitId === id ? { ...w, outfitId: undefined } : w,
    );
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

  addCameraSketch: (photo) => {
    const sketch: CameraSketch = { id: genId(), photo, filter: 'none', createdAt: Date.now() };
    const cameraSketches = [sketch, ...get().cameraSketches];
    set({ cameraSketches });
    persistCamera(get());
    return sketch;
  },

  updateCameraSketch: (id, patch) => {
    const cameraSketches = get().cameraSketches.map((s) =>
      s.id === id ? { ...s, ...patch, id: s.id } : s,
    );
    set({ cameraSketches });
    persistCamera(get());
  },

  removeCameraSketch: (id) => {
    const gone = get().cameraSketches.find((s) => s.id === id);
    const cameraSketches = get().cameraSketches.filter((s) => s.id !== id);
    set({ cameraSketches });
    persistCamera(get());
    if (gone) deleteAttachmentFile(gone.photo); // чистим файл на сервере
  },

  addCameraShot: (photo) => {
    const shot: CameraShotItem = { id: genId(), photo, createdAt: Date.now() };
    const cameraShots = [shot, ...get().cameraShots];
    set({ cameraShots });
    persistCamera(get());
    return shot;
  },

  removeCameraShot: (id) => {
    const gone = get().cameraShots.find((s) => s.id === id);
    const cameraShots = get().cameraShots.filter((s) => s.id !== id);
    set({ cameraShots });
    persistCamera(get());
    if (gone) deleteAttachmentFile(gone.photo); // чистим файл на сервере
  },

  addCameraScript: (title, text) => {
    const now = Date.now();
    const script: CameraScript = { id: genId(), title, text, createdAt: now, updatedAt: now };
    set({ cameraScripts: [script, ...get().cameraScripts] });
    persistCamera(get());
    return script;
  },

  updateCameraScript: (id, patch) => {
    const cameraScripts = get().cameraScripts.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: Date.now() } : s,
    );
    set({ cameraScripts });
    persistCamera(get());
  },

  removeCameraScript: (id) => {
    set({ cameraScripts: get().cameraScripts.filter((s) => s.id !== id) });
    persistCamera(get());
  },

  setPrompterPrefs: (patch) => {
    set({ prompterPrefs: { ...get().prompterPrefs, ...patch } });
    persistCamera(get());
  },

  setSlotsBet: (bet) => {
    set({ slotsBet: clampBet(bet) });
    persistSlots(get());
  },

  // Один спин: списываем ставку, крутим поле 3×3, начисляем выигрыш по линиям.
  // Вся математика живёт в lib/slots (и покрыта тестами) — стор ведёт счёт.
  // Здесь же капает опыт и двигаются счётчики дневных миссий: прогрессия ничего
  // не подкручивает, она просто считает то, что уже выпало.
  playSlots: () => {
    const s = get();
    const free = s.slotsFreeSpins > 0;
    if (!free && s.slotsBalance < s.slotsBet) return null;
    const result = resolveSpin(s.slotsBet);
    // Часть ставки уходит в копилку джекпота; три семёрки забирают её целиком.
    const grown = s.slotsJackpot + Math.round(s.slotsBet * JACKPOT_RATE);
    const jackpotWin = result.kind === 'jackpot' ? grown : 0;
    const total = result.total + jackpotWin;
    const entry: SlotSpin = {
      id: genId(),
      // В историю кладём центральную линию — она и рисуется на чипе.
      reels: result.grid.map((col) => col[1]),
      combo: result.combo,
      bet: s.slotsBet,
      payout: total,
      at: Date.now(),
    };

    // Миссии дня: счётчики живут ровно сутки и сбрасываются вместе с датой.
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.spins += 1;
    if (total > 0) counters.wins += 1;
    // Тройка в любом звене каскада засчитывается в цель дня.
    if (result.steps.some((step) => step.wins.some((w) => w.count === 3))) counters.triple += 1;
    counters.coins += total;
    if (s.slotsBet >= BIG_BET) counters.bigbet += 1;

    // Опыт и, если хватило, уровни. Награда за уровень выдаётся сразу.
    const before = levelFromXp(s.slotsXp).level;
    const xp = s.slotsXp + xpForSpin(total, s.slotsBet, result.kind);
    const after = levelFromXp(xp).level;
    const levelUps: number[] = [];
    let bonusCoins = 0;
    let bonusSpins = 0;
    for (let lvl = Math.max(before, s.slotsRewardedLevel) + 1; lvl <= after; lvl++) {
      const reward = levelReward(lvl);
      bonusCoins += reward.coins;
      bonusSpins += reward.freeSpins;
      levelUps.push(lvl);
    }

    set({
      slotsBalance: s.slotsBalance - (free ? 0 : s.slotsBet) + total + bonusCoins,
      slotsFreeSpins: Math.max(0, s.slotsFreeSpins - (free ? 1 : 0)) + bonusSpins,
      slotsSpins: s.slotsSpins + 1,
      slotsBest: Math.max(s.slotsBest, total),
      slotsTopX: Math.max(s.slotsTopX, s.slotsBet > 0 ? total / s.slotsBet : 0),
      slotsHistory: [entry, ...s.slotsHistory].slice(0, 12),
      slotsJackpot: jackpotWin ? JACKPOT_BASE : grown,
      slotsXp: xp,
      slotsRewardedLevel: Math.max(s.slotsRewardedLevel, after),
      slotsMissions: { ...missions, counters },
    });
    get().recordSpin({
      game: 'slots',
      at: entry.at,
      staked: free ? 0 : s.slotsBet,
      won: total,
      bet: s.slotsBet,
      chain: result.combo,
      // Сфер в «Слотах» нет, бонусной сессии тоже — джекпот приходит просто
      // очень крупным выигрышем и пиком станет именно как выигрыш.
      orb: 0,
      bonus: false,
      levels: levelUps,
    });
    persistSlots(get());
    return {
      ...result,
      total,
      multiplier: s.slotsBet > 0 ? total / s.slotsBet : 0,
      jackpotWin,
      freeSpin: free,
      levelUps,
    };
  },

  // Из игры нельзя выпасть: когда монет не хватает даже на минимальную ставку,
  // даём бесплатные вращения и опускаем ставку до минимума.
  // Спин «Каскада» по правилам Олимпа: скаттеры, сферы-множители и бонус
  // с накопительным множителем. Кошелёк, опыт и цели дня общие со слотами.
  playScatter: () => {
    const s = get();
    const inBonus = !!s.scatterFs && s.scatterFs.left > 0;
    // Бонусное вращение бесплатно; иначе тратим билет из наград или монеты.
    const ticket = !inBonus && s.slotsFreeSpins > 0;
    const stake = inBonus || ticket ? 0 : Math.round(s.slotsBet * (s.scatterAnte ? ANTE_COST : 1));
    if (stake > s.slotsBalance) return null;

    const result = resolveScatter(s.slotsBet, {
      ante: !inBonus && s.scatterAnte,
      free: inBonus,
      totalMult: s.scatterFs?.totalMult ?? 0,
    });

    // Состояние бонуса после спина.
    let fs: ScatterFsState | null = s.scatterFs;
    let fsStarted = false;
    if (inBonus && fs) {
      fs = {
        left: fs.left - 1 + result.freeSpins,
        totalMult: result.totalMult,
        won: fs.won + result.total,
        spins: fs.spins + 1,
      };
      if (fs.left <= 0) fs = { ...fs, left: 0 };
    } else if (result.freeSpins > 0) {
      fs = { left: result.freeSpins, totalMult: 0, won: result.total, spins: 0 };
      fsStarted = true;
    }

    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.spins += 1;
    if (result.total > 0) counters.wins += 1;
    if (result.steps.some((step) => step.wins.some((w) => w.count >= 12))) counters.triple += 1;
    counters.coins += result.total;
    if (stake >= BIG_BET) counters.bigbet += 1;

    const before = levelFromXp(s.slotsXp).level;
    const kind = result.kind === 'mega' ? 'jackpot' : result.kind;
    const xp = s.slotsXp + xpForSpin(result.total, s.slotsBet, kind);
    const after = levelFromXp(xp).level;
    const levelUps: number[] = [];
    let bonusCoins = 0;
    let bonusTickets = 0;
    for (let lvl = Math.max(before, s.slotsRewardedLevel) + 1; lvl <= after; lvl++) {
      const reward = levelReward(lvl);
      bonusCoins += reward.coins;
      bonusTickets += reward.freeSpins;
      levelUps.push(lvl);
    }

    set({
      slotsBalance: s.slotsBalance - stake + result.total + bonusCoins,
      slotsFreeSpins: Math.max(0, s.slotsFreeSpins - (ticket ? 1 : 0)) + bonusTickets,
      slotsXp: xp,
      slotsRewardedLevel: Math.max(s.slotsRewardedLevel, after),
      slotsMissions: { ...missions, counters },
      scatterSpins: s.scatterSpins + 1,
      scatterBest: Math.max(s.scatterBest, result.total),
      slotsTopX: Math.max(s.slotsTopX, result.multiplier),
      scatterFs: fs && fs.left > 0 ? fs : null,
    });
    get().recordSpin({
      game: 'scatter',
      at: Date.now(),
      staked: stake,
      won: result.total,
      bet: s.slotsBet,
      chain: result.combo,
      // Самая дорогая сфера спина — из неё потом получится пик захода.
      // Берём из общего списка: сферы теперь падают и на непобедивший спин.
      orb: result.orbs.reduce((best, o) => Math.max(best, o.value), 0),
      bonus: fsStarted,
      levels: levelUps,
    });
    persistSlots(get());
    return { ...result, freeSpin: stake === 0, levelUps, fs, fsStarted };
  },

  // Покупка бонуса: сто ставок сразу, без ожидания четырёх скаттеров.
  buyScatterBonus: () => {
    const s = get();
    const cost = Math.round(s.slotsBet * BUY_BONUS_COST);
    if (s.slotsBalance < cost || (s.scatterFs && s.scatterFs.left > 0)) return false;
    set({
      slotsBalance: s.slotsBalance - cost,
      scatterFs: { left: FREE_SPINS, totalMult: 0, won: 0, spins: 0 },
    });
    persistSlots(get());
    return true;
  },

  setScatterAnte: (on) => {
    set({ scatterAnte: on });
    persistSlots(get());
  },

  // --- Заход ---------------------------------------------------------------
  // Заход общий для обеих игр: это один присест за автоматами, а не за одним
  // из них. Запись не персистится отдельно — её подхватывает persistSlots,
  // который игры и так зовут в конце спина.
  recordSpin: (rec) => {
    const s = get();
    const { session, ended } = advance(s.sessionNow, rec);
    set({
      sessionNow: session,
      sessionPast: ended ? [ended, ...s.sessionPast].slice(0, SESSION_KEEP) : s.sessionPast,
      // Перерыв сам закрыл прошлый заход — значит, пора показать его итог.
      sessionCard: ended ?? s.sessionCard,
    });
  },

  closeSession: () => {
    const s = get();
    const now = s.sessionNow;
    if (!worthShowing(now)) {
      // Заглянул на пару вращений — закрываем молча, показывать нечего.
      if (now) {
        set({ sessionNow: null });
        persistSlots(get());
      }
      return;
    }
    set({
      sessionCard: now,
      sessionPast: [now, ...s.sessionPast].slice(0, SESSION_KEEP),
      sessionNow: null,
    });
    persistSlots(get());
  },

  dismissSession: () => set({ sessionCard: null }),

  addSlotsCoins: (amount) => {
    const add = Math.max(0, Math.round(amount));
    if (!add) return;
    set({ slotsBalance: get().slotsBalance + add });
    persistSlots(get());
  },

  claimSlotsRescue: () => {
    const s = get();
    const now = Date.now();
    // Тупик — это «не хватает даже на самую маленькую ставку», а не «меньше
    // быстрой ставки»: иначе с 8 монетами в кармане игрок застревал молча.
    if (s.slotsBalance >= MIN_BET || s.slotsFreeSpins > 0) return 0;
    if (s.slotsBonusAt && now - s.slotsBonusAt < RESCUE_COOLDOWN_MS) return 0;
    set({
      slotsFreeSpins: s.slotsFreeSpins + RESCUE_SPINS,
      slotsBet: BETS[0],
      slotsBonusAt: now,
    });
    persistSlots(get());
    return RESCUE_SPINS;
  },

  claimSlotsDaily: () => {
    const s = get();
    const today = dayKey();
    const status = dailyStatus({ streak: s.slotsStreak, lastClaim: s.slotsDailyAt }, today);
    if (!status.ready) return null;
    set({
      slotsBalance: s.slotsBalance + status.reward,
      slotsDailyAt: today,
      slotsStreak: status.nextStreak,
    });
    persistSlots(get());
    return { reward: status.reward, streak: status.nextStreak };
  },

  claimSlotsMission: (id) => {
    const s = get();
    const today = dayKey();
    const missions = missionsForToday(s.slotsMissions, today);
    const mission = dailyMissions(today).find((m) => m.id === id);
    if (!mission || missions.claimed.includes(id)) return 0;
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    if (!missionDone(mission, counters)) return 0;
    set({
      slotsBalance: s.slotsBalance + mission.reward,
      slotsMissions: { ...missions, counters, claimed: [...missions.claimed, id] },
    });
    persistSlots(get());
    return mission.reward;
  },

  spinSlotsWheel: () => {
    const s = get();
    const now = Date.now();
    if (s.slotsWheelAt && now - s.slotsWheelAt < WHEEL_COOLDOWN_MS) return null;
    const index = spinWheel();
    const sector = WHEEL[index];
    set({
      slotsBalance: s.slotsBalance + sector.coins,
      slotsFreeSpins: s.slotsFreeSpins + sector.freeSpins,
      slotsWheelAt: now,
    });
    persistSlots(get());
    return { index, coins: sector.coins, freeSpins: sector.freeSpins };
  },

  setSlotsPrefs: (patch) => {
    set({
      slotsSound: patch.sound ?? get().slotsSound,
      slotsHaptics: patch.haptics ?? get().slotsHaptics,
      slotsTurbo: patch.turbo ?? get().slotsTurbo,
      slotsSkin: patch.skin ?? get().slotsSkin,
    });
    persistSlots(get());
  },

  prisonBreak: (breaks, opts = {}) => {
    const s = get();
    const settled = settleEvent(s.prison, s.forest, Date.now());
    const p = settled.p;
    const dug = p.mine.dug.slice();
    const rocks: number[] = [];
    const cells: number[] = [];
    for (const b of breaks) {
      if (b.cell < 0 || b.cell >= dug.length || dug[b.cell] >= DEPTH || b.rock < 0) continue;
      dug[b.cell] += 1;
      rocks.push(b.rock);
      cells.push(b.cell);
    }
    if (!rocks.length)
      return {
        broken: 0,
        taken: 0,
        lost: 0,
        sold: 0,
        tokens: 0,
        keys: 0,
        finds: [],
        pickUps: [],
        normDone: false,
        normAdd: {},
        reforged: [],
        parcels: [],
        parcelTokens: 0,
        parcelsReady: 0,
        petUp: 0,
        eventStarted: null,
        eventDone: null,
        eventEnded: null,
        zone: null,
      };
    const now = Date.now();
    const m0 = modsOf(p);
    // Крепь: пока стоит, Перековка сильнее — лезешь в забой, куда без неё не пускают.
    const m = now < p.propUntil ? { ...m0, reforge: Math.min(0.9, m0.reforge + PROP_REFORGE) } : m0;
    const drops = rollDrops(rocks, m, Math.random, {
      frenzy: now < p.frenzyUntil,
      mine: p.mine.id,
      streak: streakLoot(opts.streak ?? 0),
    });
    // Спецзона платит токенами: добыча не в рюкзак, а сразу в токены.
    const inZone = p.zone.on;
    let zoneGot = 0;
    if (inZone)
      for (const rock of drops.units) {
        const t = zoneTokens(rock);
        zoneGot += Math.floor(t) + (Math.random() < t - Math.floor(t) ? 1 : 0);
      }
    const put = inZone
      ? { bag: p.bag, taken: 0, lost: 0, sold: 0 }
      : stash(p.bag, drops.units, bagCapacity(p.bagLevel), p.cart, m.sell);
    // Находка: новая идёт в коллекцию, дубликат сдаётся за токены.
    const finds = { ...p.finds };
    let dupTokens = 0;
    const found: { id: FindId; fresh: boolean }[] = [];
    for (const f of drops.finds) {
      const fresh = !(finds[f] ?? 0);
      finds[f] = (finds[f] ?? 0) + 1;
      if (!fresh) dupTokens += FIND_DUP_TOKENS;
      found.push({ id: f, fresh });
    }
    // Норма считает БЛОКИ, а не добычу: Удача и запал множат деньги, но
    // руду за тебя не выкопают.
    const quota = p.rank < LAST_RANK ? rankQuota(p.rank, p.prestige) : [];
    const wasDone = quotaDone(quota, p.norm);
    const norm = { ...p.norm };
    const normAdd: Record<number, number> = {};
    // В норму идёт порода ПОСЛЕ перековки: так Перековка помогает добрать
    // редкую породу, и в этом её смысл на русском присоне.
    for (const r of drops.rocks) {
      norm[r] = (norm[r] ?? 0) + 1;
      if (quota.some((q) => q.rock === r)) normAdd[r] = (normAdd[r] ?? 0) + 1;
    }
    const normDone = quota.length > 0 && !wasDone && quotaDone(quota, norm);
    // Опыт кирки — каждый сломанный блок; награда за каждый новый уровень.
    const pickXp = p.pickXp + rocks.length;
    const lvBefore = pickLevelOf(p.pickXp).level;
    const lvAfter = pickLevelOf(pickXp).level;
    const pickUps: PrisonLoot['pickUps'] = [];
    for (let l = lvBefore + 1; l <= lvAfter; l++) pickUps.push({ level: l, ...pickLevelReward(l) });
    const upTokens = pickUps.reduce((a, u) => a + u.tokens, 0);
    const upKeys = pickUps.reduce((a, u) => a + u.keys, 0);
    const tick = tickParcels(p, rocks.length, drops.parcels);
    const parcels = tick.parcels;
    const parcelsReady = tick.ready;
    const parcelTokens = tick.tokens;
    const parcelsNew = tick.added;
    const fed = feedPet(p, rocks.length);
    const pets = fed.pets;
    const petUp = fed.up;
    let prison: PrisonState = {
      ...p,
      mine: { ...p.mine, dug },
      bag: put.bag,
      mined: p.mined + rocks.length,
      earned: p.earned + put.sold,
      tokens: p.tokens + drops.tokens + dupTokens + upTokens + parcelTokens + zoneGot,
      keys: p.keys + drops.keys + upKeys,
      finds,
      norm,
      pickXp,
      parcels,
      pets,
    };
    // Спецзона: время идёт только за работой, норма добавляет десять минут.
    let zoneOut: PrisonLoot['zone'] = null;
    if (inZone) {
      const z0 = zoneToday(p.zone, now);
      const used = z0.used + Math.min(ZONE_IDLE_MS, Math.max(0, now - (z0.tick || now)));
      const have = z0.have + rocks.length;
      const reached = Math.floor(have / ZONE_QUOTA) > Math.floor(z0.have / ZONE_QUOTA);
      const extra = reached && ZONE_MS + z0.bonus < ZONE_MAX_MS;
      const zone = {
        ...z0,
        used,
        have,
        tick: now,
        bonus: extra ? z0.bonus + ZONE_BONUS_MS : z0.bonus,
      };
      const over = zoneLeft(zone, now) <= 0;
      prison = over
        ? {
            ...prison,
            zone: { ...zone, on: false, back: null },
            mine: zone.back ?? freshMine(prison.rank),
          }
        : { ...prison, zone };
      zoneOut = { tokens: zoneGot, bonus: extra, ended: over };
    }
    // Двор: конвой считает сданную породу (как сломана, до перековки).
    let eventDone: YardPrize | null = null;
    const live = liveEvent(prison, now);
    if (live?.id === 'convoy') {
      const have = live.have + rocks.filter((r) => r === live.rock).length;
      if (have >= live.need) {
        eventDone = eventPrize('convoy', prison, Math.random);
        prison = givePrize(prison, eventDone, now);
      } else prison = { ...prison, event: { ...live, have } };
    }
    const start = maybeStart(prison, 'mine', now);
    prison = start.p;
    // Миссии дня общие с автоматами: счётчик блоков и проданного — там же.
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.blocks += rocks.length;
    counters.ore += put.sold;
    const coins = put.sold + (eventDone?.coins ?? 0);
    set({
      prison,
      slotsMissions: { ...missions, counters },
      ...(coins ? { slotsBalance: s.slotsBalance + coins } : {}),
      ...(settled.f !== s.forest ? { forest: settled.f } : {}),
    });
    persistPrison(prison);
    if (settled.f !== s.forest) persistForest(settled.f);
    persistSlotsLazy();
    return {
      broken: rocks.length,
      taken: put.taken,
      lost: put.lost,
      sold: put.sold,
      tokens: drops.tokens + dupTokens,
      keys: drops.keys,
      finds: found,
      pickUps,
      normDone,
      normAdd,
      reforged: drops.reforged.map((i) => ({ cell: cells[i], rock: drops.rocks[i] })),
      parcels: parcelsNew,
      parcelTokens,
      parcelsReady,
      petUp,
      eventStarted: start.started,
      eventDone,
      eventEnded: settled.end,
      zone: zoneOut,
    };
  },

  prisonParcelOpen: (index) => {
    const s = get();
    const p = s.prison;
    const x = p.parcels[index];
    if (!x || x.left > 0) return null;
    const reward = rollParcel(p, x.tier, Math.random);
    const base = {
      ...p,
      parcels: p.parcels.filter((_, i) => i !== index),
      parcelsOpened: p.parcelsOpened + 1,
    };
    const a = applyReward(base, reward);
    set(a.coins ? { prison: a.p, slotsBalance: s.slotsBalance + a.coins } : { prison: a.p });
    persistPrison(a.p);
    if (a.coins) persistSlots(get());
    return { tier: x.tier, reward, shattered: a.shattered, newPet: a.newPet };
  },

  prisonRuneSocket: (slot, runeId) => {
    const p = get().prison;
    if (slot < 0 || slot >= socketsOpen(p, axeLevelOf(get().forest.logs).level)) return;
    if (runeId && !p.runes.some((r) => r.id === runeId)) return;
    // Руна носится в одном гнезде: переставил — старое место освободилось.
    const sockets = p.sockets.map((id, i) => (i === slot ? runeId : id === runeId ? 0 : id));
    const prison = { ...p, sockets };
    set({ prison });
    persistPrison(prison);
  },

  prisonRuneFuse: (runeId) => {
    const p = get().prison;
    const plan = fusePlan(p.runes, p.sockets, runeId);
    if (!plan) return null;
    // Сила не ниже средней из трёх — сплав хороших рун не проваливается.
    const floor = (plan.base.roll + plan.with[0].roll + plan.with[1].roll) / 3;
    const made = rollRune(plan.base.tier + 1, Math.random, plan.base.kind, floor);
    const rune: Rune = { ...made, id: p.runeSeq + 1 };
    const gone = new Set([plan.base.id, ...plan.with.map((r) => r.id)]);
    const prison: PrisonState = {
      ...p,
      runeSeq: rune.id,
      runes: [...p.runes.filter((r) => !gone.has(r.id)), rune],
      // Сплавленная из надетой руна остаётся в том же гнезде.
      sockets: p.sockets.map((id) => (id === plan.base.id ? rune.id : id)),
    };
    set({ prison });
    persistPrison(prison);
    return rune;
  },

  prisonRuneShatter: (runeId) => {
    const p = get().prison;
    const r = p.runes.find((x) => x.id === runeId);
    if (!r || p.sockets.includes(runeId)) return 0;
    const got = RUNE_SHATTER[r.tier - 1];
    const prison = { ...p, runes: p.runes.filter((x) => x.id !== runeId), tokens: p.tokens + got };
    set({ prison });
    persistPrison(prison);
    return got;
  },

  forestCut: (side, streak) => {
    const s = get();
    const now = Date.now();
    const settled = settleEvent(s.prison, s.forest, now);
    const f = settled.f;
    const p = settled.p;
    const tree = buildTree(f.rank, f.tree.seed);
    const index = Math.min(f.tree.cut, tree.logs.length - 1);
    const fm = forestMods(p, f);
    const loot = streakLoot(streak);
    // Брёвна этого удара: нижнее, при замахе — и следующее, при валке — все.
    const cut = planCut(tree, index, fm, Math.random);
    const chops: Chop[] = [];
    for (let k = 0; k < cut.take; k++) chops.push(rollChop(tree, index + k, fm, Math.random, loot));
    // Штабель: не влезло — лесовоз увозит на пилораму (пока там есть место)
    // или продаёт; без лесовоза лишнее остаётся в снегу.
    const cap = pileCapacity(f.pileLevel);
    let pile: Pile = { ...f.pile, sp: [...f.pile.sp] };
    let mill = f.mill;
    let sold = 0;
    let lost = 0;
    let toMill = 0;
    const stack = (c: Chop, species: number) => {
      const per = c.units ? c.value / c.units : 0;
      for (let k = 0; k < c.units; k++) {
        if (pile.n >= cap) {
          if (!f.truck) {
            lost += 1;
            continue;
          }
          const load = mill.level > 0 ? millLoad(pile, millTick(mill, Date.now())) : null;
          if (load && load.loaded > 0) {
            sold += Math.round(load.premium * fm.sell);
            toMill += load.loaded;
            mill = load.mill;
            pile = { ...load.pile, sp: [...load.pile.sp] };
          } else {
            sold += Math.round(pile.value * fm.sell);
            pile = emptyPileOf();
          }
        }
        pile.n += 1;
        pile.value += per;
        pile.sp[species] += 1;
      }
    };
    for (const c of chops) stack(c, tree.species);
    // План — брёвна СВОЕЙ породы делянки, срубленные топором (замах и валка
    // тоже топор), а не лишние от добычи.
    const need = forestPlanNeed(f.rank);
    let plan = f.plan + (tree.species === f.rank ? cut.take : 0);
    // Дерево: срубил последнее — повалено, выезжает следующее.
    let next = index + cut.take;
    let seed = f.tree.seed;
    let felled: ForestCut['felled'] = null;
    let storm: ForestCut['storm'] = null;
    let logs = cut.take;
    let trees = 0;
    let seids = 0;
    if (next >= tree.logs.length) {
      felled = fellBonus(tree, f.rank);
      pile.value += felled.value;
      trees += 1;
      if (tree.seid) seids += 1;
      next = 0;
      seed = newTreeSeed();
      // Бурелом: падающее дерево валит соседнее — целиком, со всеми брёвнами.
      if (cut.storm) {
        const t2 = buildTree(f.rank, seed);
        const extra: Chop[] = t2.logs.map((_, i) => rollChop(t2, i, fm, Math.random, loot));
        for (const c of extra) stack(c, t2.species);
        chops.push(...extra);
        const fb = fellBonus(t2, f.rank);
        pile.value += fb.value;
        if (t2.species === f.rank) plan += t2.logs.length;
        logs += t2.logs.length;
        trees += 1;
        if (t2.seid) seids += 1;
        storm = { tree: t2, logs: t2.logs.length, tokens: fb.tokens };
        seed = newTreeSeed();
      }
    }
    const planDone = f.plan < need && plan >= need;
    let hit = !felled && dropHit(tree, next - 1, side);
    let dodged = false;
    if (hit && Math.random() < fm.dodge) {
      hit = false;
      dodged = true;
    }
    const forest: ForestState = {
      ...f,
      pile,
      mill,
      plan,
      tree: { seed, cut: next },
      felled: f.felled + trees,
      seids: f.seids + seids,
      logs: f.logs + logs,
      earned: f.earned + sold,
    };
    // Общее с шахтой: токены, ключи, посылки, питомец.
    const { chop, hollows } = sumChops(chops);
    const fresh = [
      ...chop.parcels,
      ...hollows.flatMap((h) => (h.kind === 'parcel' ? [h.tier] : [])),
    ];
    const tick = tickParcels(p, logs, fresh);
    const fed = feedPet(p, logs);
    const hollowSum = (kind: 'tokens' | 'keys') =>
      hollows.reduce((a, h) => a + (h.kind === kind ? h.amount : 0), 0);
    let prison: PrisonState = {
      ...p,
      tokens:
        p.tokens +
        chop.tokens +
        chop.chaga +
        hollowSum('tokens') +
        (felled?.tokens ?? 0) +
        (storm?.tokens ?? 0) +
        tick.tokens,
      keys: p.keys + chop.keys + hollowSum('keys'),
      parcels: tick.parcels,
      pets: fed.pets,
    };
    // Двор: медведя отгоняет работа — каждое срубленное бревно.
    let eventDone: YardPrize | null = null;
    const live = liveEvent(prison, now);
    if (live?.id === 'bear') {
      const have = live.have + logs;
      if (have >= live.need) {
        eventDone = eventPrize('bear', prison, Math.random);
        prison = givePrize(prison, eventDone, now);
      } else prison = { ...prison, event: { ...live, have } };
    }
    const start = maybeStart(prison, 'forest', now);
    prison = start.p;
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.trees += trees;
    counters.ore += sold;
    const coins = sold + (eventDone?.coins ?? 0);
    set({
      forest,
      prison,
      slotsMissions: { ...missions, counters },
      ...(coins ? { slotsBalance: s.slotsBalance + coins } : {}),
    });
    persistForest(forest);
    persistPrison(prison);
    persistSlotsLazy();
    return {
      chop,
      hollows,
      tree,
      index,
      take: cut.take,
      how: cut.how,
      hit,
      dodged,
      felled,
      storm,
      sold,
      lost,
      toMill,
      planDone,
      parcels: tick.added,
      parcelsReady: tick.ready,
      petUp: fed.up,
      eventStarted: start.started,
      eventDone,
      eventEnded: settled.end,
    };
  },

  forestSell: () => {
    const s = get();
    const f = s.forest;
    if (!f.pile.n) return 0;
    const value = Math.round(f.pile.value * forestMods(s.prison).sell);
    const forest = { ...f, pile: emptyPileOf(), earned: f.earned + value };
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.ore += value;
    set({
      forest,
      slotsBalance: s.slotsBalance + value,
      slotsMissions: { ...missions, counters },
    });
    persistForest(forest);
    persistSlots(get());
    return value;
  },

  forestBuy: (what) => {
    const s = get();
    const f = s.forest;
    let price = 0;
    let next: ForestState = f;
    if (what === 'axe') {
      const axe = AXES[f.axe + 1];
      if (!axe) return false;
      price = axe.price;
      next = { ...f, axe: f.axe + 1 };
    } else if (what === 'sharp') {
      if (f.sharp >= AXE_SHARP_MAX) return false;
      price = axeSharpCost(f.sharp);
      next = { ...f, sharp: f.sharp + 1 };
    } else if (what === 'pile') {
      if (f.pileLevel >= PILE_MAX) return false;
      price = pileCost(f.pileLevel);
      next = { ...f, pileLevel: f.pileLevel + 1 };
    } else {
      if (f.truck) return false;
      price = TRUCK_PRICE;
      next = { ...f, truck: true };
    }
    if (s.slotsBalance < price) return false;
    set({ forest: next, slotsBalance: s.slotsBalance - price });
    persistForest(next);
    persistSlots(get());
    return true;
  },

  forestRankUp: (buyout = false) => {
    const s = get();
    const f = s.forest;
    if (f.rank >= LAST_PLOT) return null;
    const extra = planBuyout(f.rank, f.plan);
    if (extra > 0 && !buyout) return null;
    const cost = forestRankCost(f.rank) + extra;
    if (s.slotsBalance < cost) return null;
    const rank = f.rank + 1;
    // Опыт — в ОБЩИЙ уровень, как за ранг шахты.
    const before = levelFromXp(s.slotsXp).level;
    const xp = s.slotsXp + rankXp(rank * 2);
    const after = levelFromXp(xp).level;
    let bonusCoins = 0;
    let bonusTickets = 0;
    for (let lvl = Math.max(before, s.slotsRewardedLevel) + 1; lvl <= after; lvl++) {
      const reward = levelReward(lvl);
      bonusCoins += reward.coins;
      bonusTickets += reward.freeSpins;
    }
    const forest: ForestState = { ...f, rank, plan: 0, tree: { seed: newTreeSeed(), cut: 0 } };
    const prison = { ...s.prison, keys: s.prison.keys + RANK_KEYS };
    set({
      forest,
      prison,
      slotsBalance: s.slotsBalance - cost + bonusCoins,
      slotsFreeSpins: s.slotsFreeSpins + bonusTickets,
      slotsXp: xp,
      slotsRewardedLevel: Math.max(s.slotsRewardedLevel, after),
    });
    persistForest(forest);
    persistPrison(prison);
    persistSlots(get());
    return { rank, cost, buyout: extra };
  },

  forestEnchant: (id, count = 1) => {
    const s = get();
    const f = s.forest;
    const p = s.prison;
    const cap = axeEnchCap(id, axeLevelOf(f.logs).level);
    let l = f.ench[id];
    let tokens = p.tokens;
    let got = 0;
    while (got < count && l < cap) {
      const c = axeEnchCost(id, l);
      if (tokens < c) break;
      tokens -= c;
      l += 1;
      got += 1;
    }
    if (!got) return 0;
    const forest = { ...f, ench: { ...f.ench, [id]: l } };
    const prison = { ...p, tokens };
    set({ forest, prison });
    persistForest(forest);
    persistPrison(prison);
    return got;
  },

  forestMillUp: () => {
    const s = get();
    const f = s.forest;
    if (f.mill.level >= MILL_MAX) return false;
    const price = millCost(f.mill.level);
    if (s.slotsBalance < price) return false;
    // Сперва допилить по старой скорости, потом поднять уровень.
    const now = Date.now();
    const mill = { ...millTick(f.mill, now), level: f.mill.level + 1 };
    const forest = { ...f, mill };
    set({ forest, slotsBalance: s.slotsBalance - price });
    persistForest(forest);
    persistSlots(get());
    return true;
  },

  forestMillLoad: () => {
    const s = get();
    const f = s.forest;
    const res = millLoad(f.pile, millTick(f.mill, Date.now()));
    if (!res.loaded) return { loaded: 0, premium: 0 };
    const premium = Math.round(res.premium * forestMods(s.prison).sell);
    const forest = { ...f, pile: res.pile, mill: res.mill, earned: f.earned + premium };
    set({ forest, ...(premium ? { slotsBalance: s.slotsBalance + premium } : {}) });
    persistForest(forest);
    if (premium) persistSlots(get());
    return { loaded: res.loaded, premium };
  },

  forestMillSell: () => {
    const s = get();
    const f = s.forest;
    const mill = millTick(f.mill, Date.now());
    const sale = boardsForSale(mill.boards, boardsReserve(s.prison.handle));
    const value = Math.round(boardsValue(sale) * forestMods(s.prison).sell);
    if (!value) return 0;
    const boards = mill.boards.map((k, i) => k - sale[i]);
    const forest = { ...f, mill: { ...mill, boards }, earned: f.earned + value };
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.ore += value;
    set({
      forest,
      slotsBalance: s.slotsBalance + value,
      slotsMissions: { ...missions, counters },
    });
    persistForest(forest);
    persistSlots(get());
    return value;
  },

  forestMillFeed: () => {
    const s = get();
    const f = s.forest;
    if (f.mill.level <= 0) return null;
    let mill = millTick(f.mill, Date.now());
    let pile = f.pile;
    let loaded = 0;
    let premium = 0;
    if (sumRow(mill.queue) === 0) {
      const r = millLoad(pile, mill);
      if (!r.loaded) return null;
      mill = r.mill;
      pile = r.pile;
      loaded = r.loaded;
      premium = Math.round(r.premium * forestMods(s.prison).sell);
    }
    const cut = millFeedOne(mill);
    if (!cut) return null;
    const forest = { ...f, pile, mill: cut.mill, earned: f.earned + premium };
    set({ forest, ...(premium ? { slotsBalance: s.slotsBalance + premium } : {}) });
    persistForest(forest);
    if (premium) persistSlots(get());
    return { species: cut.species, loaded, premium };
  },

  forestCraftProp: () => {
    const s = get();
    const f = s.forest;
    const p = s.prison;
    const mill = millTick(f.mill, Date.now());
    const boards = takeBoards(mill.boards, PROP_BOARDS, boardsReserve(p.handle));
    if (!boards) return false;
    const forest = { ...f, mill: { ...mill, boards } };
    const prison = { ...p, items: { ...p.items, prop: p.items.prop + 1 } };
    set({ forest, prison });
    persistForest(forest);
    persistPrison(prison);
    return true;
  },

  forestOrderFill: (i) => {
    const s = get();
    const f = s.forest;
    const now = Date.now();
    const mill = millTick(f.mill, now);
    const { bench, orders } = benchOrders(f.bench, f.rank);
    const o = orders[i];
    if (!o || now < o.at) return null;
    const reserve = boardsReserve(s.prison.handle);
    if (!benchCan(mill.boards, o, reserve)) return null;
    let boards: number[] | null;
    if (o.species >= 0) {
      boards = [...mill.boards];
      boards[o.species] -= o.boards;
    } else boards = takeBoards(mill.boards, o.boards, reserve);
    if (!boards) return null;
    const coins = Math.round(o.coins * forestMods(s.prison).sell);
    const seq = bench.seq + 1;
    const fresh = { ...benchOrder(seq, f.rank), at: now + BENCH_COOLDOWN_MS };
    const forest: ForestState = {
      ...f,
      mill: { ...mill, boards },
      bench: { seq, orders: orders.map((x, k) => (k === i ? fresh : x)) },
      earned: f.earned + coins,
    };
    const prison = { ...s.prison, tokens: s.prison.tokens + o.tokens };
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.ore += coins;
    set({
      forest,
      prison,
      slotsBalance: s.slotsBalance + coins,
      slotsMissions: { ...missions, counters },
    });
    persistForest(forest);
    persistPrison(prison);
    persistSlots(get());
    return { coins, tokens: o.tokens, item: o.item };
  },

  forestCraftHandle: () => {
    const s = get();
    const f = s.forest;
    const p = s.prison;
    const h = HANDLES[p.handle];
    if (!h) return false;
    const mill = millTick(f.mill, Date.now());
    if (mill.boards[h.species] < h.boards) return false;
    const boards = [...mill.boards];
    boards[h.species] -= h.boards;
    const forest = { ...f, mill: { ...mill, boards } };
    const prison = { ...p, handle: p.handle + 1 };
    set({ forest, prison });
    persistForest(forest);
    persistPrison(prison);
    return true;
  },

  yardExpire: () => {
    const s = get();
    const r = settleEvent(s.prison, s.forest, Date.now());
    if (!r.end) return null;
    set({ prison: r.p, forest: r.f });
    persistPrison(r.p);
    if (r.f !== s.forest) persistForest(r.f);
    return r.end;
  },

  yardMeteor: () => {
    const s = get();
    const now = Date.now();
    if (liveEvent(s.prison, now)?.id !== 'meteor') return null;
    const x = eventPrize('meteor', s.prison, Math.random);
    const prison = givePrize(s.prison, x, now);
    set({ prison, slotsBalance: s.slotsBalance + x.coins });
    persistPrison(prison);
    persistSlots(get());
    return x;
  },

  yardKuiva: () => {
    const s = get();
    const now = Date.now();
    if (liveEvent(s.prison, now)?.id !== 'kuiva') return null;
    const x = eventPrize('kuiva', s.prison, Math.random);
    const prison = givePrize(s.prison, x, now);
    set({ prison, slotsBalance: s.slotsBalance + x.coins });
    persistPrison(prison);
    persistSlots(get());
    return x;
  },

  barygaBuy: (i) => {
    const s = get();
    const p = s.prison;
    const w = barygaWindow(Date.now());
    const lot = barygaLots(w, p)[i];
    if (!lot) return null;
    const bought = [...barygaBought(p, w)];
    if ((bought[i] ?? 0) >= lot.stock || s.slotsBalance < lot.price) return null;
    while (bought.length <= i) bought.push(0);
    bought[i] += 1;
    const a = applyReward(p, lot.reward);
    const prison = { ...a.p, baryga: { window: w, bought } };
    set({ prison, slotsBalance: s.slotsBalance - lot.price + a.coins });
    persistPrison(prison);
    persistSlots(get());
    return { lot, shattered: a.shattered, newPet: a.newPet };
  },

  prisonAddTokens: (amount) => {
    const add = Math.max(0, Math.round(amount));
    if (!add) return;
    const p = get().prison;
    const prison = { ...p, tokens: p.tokens + add };
    set({ prison });
    persistPrison(prison);
  },

  prisonReset: () => {
    const prison: PrisonState = { ...PRISON_START, mine: freshMine(0) };
    const forest = freshForest();
    const dungeon = { ...DUNGEON_START };
    set({ prison, forest, dungeon });
    persistPrison(prison);
    persistForest(forest);
    persistDungeon(dungeon);
  },

  gamesReset: () => {
    const prison: PrisonState = { ...PRISON_START, mine: freshMine(0) };
    const forest = freshForest();
    const dungeon = { ...DUNGEON_START };
    persistForest(forest);
    persistDungeon(dungeon);
    set({
      dungeon,
      forest,
      prison,
      slotsBalance: START_BALANCE,
      slotsBet: 25,
      slotsSpins: 0,
      slotsBest: 0,
      slotsBonusAt: undefined,
      slotsHistory: [],
      slotsJackpot: JACKPOT_BASE,
      slotsTopX: 0,
      slotsXp: 0,
      slotsRewardedLevel: 1,
      slotsDailyAt: undefined,
      slotsStreak: 0,
      slotsMissions: freshMissions(),
      slotsWheelAt: undefined,
      slotsFreeSpins: 0,
      scatterSpins: 0,
      scatterBest: 0,
      scatterAnte: false,
      scatterFs: null,
      sessionNow: null,
      sessionPast: [],
      sessionCard: null,
    });
    persistPrison(prison);
    persistSlots(get());
  },

  prisonSeid: (cell) => {
    const s = get();
    const p = s.prison;
    const dug0 = p.mine.dug[cell];
    if (dug0 === undefined || !seidTop(seidsOf(p.mine.id, p.mine.seed), cell, dug0)) return null;
    const dug = p.mine.dug.slice();
    dug[cell] += 1;
    const r = seidReward(p.rank, p.prestige);
    const prison: PrisonState = {
      ...p,
      mine: { ...p.mine, dug },
      tokens: p.tokens + r.tokens,
      earned: p.earned + r.coins,
      seids: p.seids + 1,
      mined: p.mined + 1,
      pickXp: p.pickXp + 1,
    };
    set({ prison, slotsBalance: s.slotsBalance + r.coins });
    persistPrison(prison);
    persistSlots(get());
    return r;
  },

  prisonPetSet: (id) => {
    const p = get().prison;
    if (id && p.pets[id] === undefined) return;
    const prison = { ...p, pet: id };
    set({ prison });
    persistPrison(prison);
  },

  prisonMileClaim: (id) => {
    const s = get();
    const mile = MILES.find((m) => m.id === id);
    if (!mile || !mileReady(s.prison, mile)) return null;
    const r = mile.reward;
    let p: PrisonState = {
      ...s.prison,
      miles: [...s.prison.miles, id],
      tokens: s.prison.tokens + (r.tokens ?? 0),
      keys: s.prison.keys + (r.keys ?? 0),
    };
    let coins = 0;
    let rune: Rune | null = null;
    if (r.rune) {
      const a = applyReward(p, { kind: 'rune', rune: rollRune(r.rune, Math.random) });
      p = a.p;
      rune = a.shattered ? null : p.runes[p.runes.length - 1];
    }
    let parcel: ParcelOpen | null = null;
    if (r.parcel) {
      const reward = rollParcel(p, r.parcel, Math.random);
      const a = applyReward({ ...p, parcelsOpened: p.parcelsOpened + 1 }, reward);
      p = a.p;
      coins += a.coins;
      parcel = { tier: r.parcel, reward, shattered: a.shattered, newPet: a.newPet };
    }
    set(coins ? { prison: p, slotsBalance: s.slotsBalance + coins } : { prison: p });
    persistPrison(p);
    if (coins) persistSlots(get());
    return { mile, parcel, rune };
  },

  prisonStreak: (tier) => {
    const s = get();
    const p = s.prison;
    const step = Math.max(0, Math.min(STREAK_TIERS.length - 1, Math.floor(tier))) + 1;
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    if (step <= p.bestStreak && step <= counters.streak) return;
    counters.streak = Math.max(counters.streak, step);
    const prison = { ...p, bestStreak: Math.max(p.bestStreak, step) };
    set({ prison, slotsMissions: { ...missions, counters } });
    persistPrison(prison);
    persistSlotsLazy();
  },

  prisonGuideClaim: () => {
    const s = get();
    const p = s.prison;
    if (!guideReady(p)) return null;
    const r = GUIDE[p.guide].reward;
    const items = { ...p.items };
    if (r.item) items[r.item[0]] += r.item[1];
    let prison: PrisonState = {
      ...p,
      guide: p.guide + 1,
      tokens: p.tokens + (r.tokens ?? 0),
      keys: p.keys + (r.keys ?? 0),
      items,
    };
    if (r.rune)
      prison = applyReward(prison, { kind: 'rune', rune: rollRune(r.rune, Math.random) }).p;
    if (r.pet) prison = applyReward(prison, { kind: 'pet', id: r.pet }).p;
    set(r.coins ? { prison, slotsBalance: s.slotsBalance + r.coins } : { prison });
    persistPrison(prison);
    if (r.coins) persistSlots(get());
    return r;
  },

  prisonEnchant: (id, count = 1) => {
    const p = get().prison;
    const cap = enchantCap(id, pickLevelOf(p.pickXp).level, p.pickStars);
    let level = p.ench[id];
    let tokens = p.tokens;
    let bought = 0;
    while (bought < count && level < cap) {
      const cost = enchantCost(id, level);
      if (tokens < cost) break;
      tokens -= cost;
      level += 1;
      bought += 1;
    }
    if (!bought) return 0;
    const prison = { ...p, tokens, ench: { ...p.ench, [id]: level } };
    set({ prison });
    persistPrison(prison);
    return bought;
  },

  prisonEnchantToggle: (id) => {
    const p = get().prison;
    if (!ENCHANT_TOGGLE.includes(id)) return;
    const off = p.off.includes(id) ? p.off.filter((x) => x !== id) : [...p.off, id];
    const prison = { ...p, off };
    set({ prison });
    persistPrison(prison);
  },

  prisonEnchantReset: (id) => {
    const p = get().prison;
    const level = p.ench[id];
    if (!level) return 0;
    const back = enchantRefund(id, level);
    const prison = { ...p, tokens: p.tokens + back, ench: { ...p.ench, [id]: 0 } };
    set({ prison });
    persistPrison(prison);
    return back;
  },

  prisonBuyItem: (id) => {
    const p = get().prison;
    const price = itemOf(id).price;
    if (p.tokens < price) return false;
    const prison = { ...p, tokens: p.tokens - price, items: { ...p.items, [id]: p.items[id] + 1 } };
    set({ prison });
    persistPrison(prison);
    return true;
  },

  prisonUseItem: (id) => {
    const p = get().prison;
    if (p.items[id] <= 0) return false;
    const now = Date.now();
    const prison: PrisonState = { ...p, items: { ...p.items, [id]: p.items[id] - 1 } };
    if (id === 'bomb3' || id === 'bomb5' || id === 'charge') prison.bombs = p.bombs + 1;
    // Второй энергетик подряд продлевает, а не сгорает впустую.
    if (id === 'energy') prison.energyUntil = Math.max(now, p.energyUntil) + ENERGY_MS;
    if (id === 'lens') prison.lensUntil = Math.max(now, p.lensUntil) + LENS_MS;
    if (id === 'prop') prison.propUntil = Math.max(now, p.propUntil) + PROP_MS;
    set({ prison });
    persistPrison(prison);
    return true;
  },

  prisonFrenzy: () => {
    const p = get().prison;
    const prison = { ...p, frenzyUntil: Math.max(Date.now(), p.frenzyUntil) + FRENZY_MS };
    set({ prison });
    persistPrison(prison);
  },

  prisonOpenCase: () => {
    const s = get();
    const p = s.prison;
    if (p.keys <= 0) return null;
    const roll = rollCase(p, Math.random);
    const a = applyReward({ ...p, keys: p.keys - 1, cases: p.cases + 1 }, roll.reward);
    const prison = a.p;
    const balance = s.slotsBalance + a.coins;
    set({ prison, slotsBalance: balance });
    persistPrison(prison);
    if (balance !== s.slotsBalance) persistSlots(get());
    return roll;
  },

  prisonOpenCases: (count) => {
    const s = get();
    let p = s.prison;
    const n = Math.min(Math.max(0, Math.floor(count)), p.keys, 500);
    if (n <= 0) return null;
    const rolls: CaseRoll[] = [];
    let coins = 0;
    let shattered = 0;
    const newPets: PetId[] = [];
    for (let i = 0; i < n; i++) {
      const roll = rollCase(p, Math.random);
      const a = applyReward({ ...p, keys: p.keys - 1, cases: p.cases + 1 }, roll.reward);
      p = a.p;
      coins += a.coins;
      shattered += a.shattered;
      if (a.newPet) newPets.push(a.newPet);
      rolls.push(roll);
    }
    set({ prison: p, slotsBalance: s.slotsBalance + coins });
    persistPrison(p);
    if (coins) persistSlots(get());
    return { rolls, coins, shattered, newPets };
  },

  prisonCrewUp: () => {
    const s = get();
    const p = s.prison;
    if (p.crew >= CREW_MAX) return false;
    const price = crewCost(p.crew);
    if (s.slotsBalance < price) return false;
    const now = Date.now();
    // Нанятая бригада начинает копить с этой минуты. Подъём уровня сперва
    // отдаёт накопленное по старой ставке — иначе новый уровень задним
    // числом переоценил бы прошлые часы.
    const y = crewYield(p, now);
    const prison: PrisonState = {
      ...p,
      crew: p.crew + 1,
      crewFrom: now,
      tokens: p.tokens + y.tokens,
      earned: p.earned + y.coins,
    };
    set({ prison, slotsBalance: s.slotsBalance - price + y.coins });
    persistPrison(prison);
    persistSlots(get());
    return true;
  },

  prisonCrewCollect: () => {
    const s = get();
    const now = Date.now();
    const got = collectCrew(s.prison, now);
    if (!got) return null;
    set({ prison: got.prison, slotsBalance: s.slotsBalance + got.y.coins });
    persistPrison(got.prison);
    persistSlots(get());
    return got.y;
  },

  prisonCrewShift: (shift) => {
    const s = get();
    const now = Date.now();
    const p = s.prison;
    if (!p.crew || p.crewShift === shift) return null;
    // Накопленное по старому наряду — сдаётся по старой ставке.
    const got = collectCrew(p, now);
    const base = got ? got.prison : p;
    const prison: PrisonState = { ...base, crewShift: shift, crewFrom: now, crewFed: false };
    set({ prison, ...(got ? { slotsBalance: s.slotsBalance + got.y.coins } : {}) });
    persistPrison(prison);
    if (got) persistSlots(get());
    return got?.y ?? null;
  },

  prisonCrewFeed: () => {
    const s = get();
    const p = s.prison;
    if (!p.crew || p.crewFed) return false;
    const y = crewYield(p, Date.now());
    if (y.minutes > CREW_FEED_WINDOW_MIN) return false;
    const price = crewFeedCost(p);
    if (s.slotsBalance < price) return false;
    const prison = { ...p, crewFed: true };
    set({ prison, slotsBalance: s.slotsBalance - price });
    persistPrison(prison);
    persistSlots(get());
    return true;
  },

  prisonPerk: (id) => {
    const p = get().prison;
    const perk = PERKS.find((k) => k.id === id);
    if (!perk || p.perks[id] >= perk.max || perkPointsFree(p) <= 0) return false;
    const prison = { ...p, perks: { ...p.perks, [id]: p.perks[id] + 1 } };
    set({ prison });
    persistPrison(prison);
    return true;
  },

  prisonPerksReset: () => {
    const p = get().prison;
    const prison = { ...p, perks: { ...NO_PERKS } };
    set({ prison });
    persistPrison(prison);
  },

  prisonGoMine: (id) => {
    const p = get().prison;
    // Шахта спецзоны выработана — новая шахта той же зоны, из неё не выкидывает.
    if (p.zone.on && id === p.mine.id && id > LAST_RANK) {
      const prison = { ...p, mine: freshMine(id) };
      set({ prison });
      persistPrison(prison);
      return;
    }
    if (id < 0 || id > p.rank) return;
    // Ушёл в другую шахту из спецзоны — зона закрыта, время сохранено.
    const prison = {
      ...p,
      mine: freshMine(id),
      zone: p.zone.on ? { ...p.zone, on: false, back: null } : p.zone,
    };
    set({ prison });
    persistPrison(prison);
  },

  prisonZoneEnter: () => {
    const p = get().prison;
    const now = Date.now();
    if (!zoneTier(p.prestige) || p.zone.on || zoneLeft(p.zone, now) <= 0) return false;
    const zone = { ...zoneToday(p.zone, now), on: true, tick: now, back: p.mine };
    const prison = { ...p, zone, mine: freshMine(zoneMineId(p.prestige)) };
    set({ prison });
    persistPrison(prison);
    return true;
  },

  prisonZoneExit: () => {
    const p = get().prison;
    if (!p.zone.on) return;
    const prison = {
      ...p,
      zone: { ...p.zone, on: false, back: null },
      mine: p.zone.back ?? freshMine(p.rank),
    };
    set({ prison });
    persistPrison(prison);
  },

  prisonPickStar: () => {
    const p = get().prison;
    if (p.pickStars >= PICK_STARS_MAX) return false;
    if (pickLevelOf(p.pickXp).level < PICK_LEVEL_MAX) return false;
    const prison = {
      ...p,
      pickXp: 0,
      pickStars: p.pickStars + 1,
      tokens: p.tokens + STAR_TOKENS * (p.pickStars + 1),
      keys: p.keys + STAR_KEYS,
    };
    set({ prison });
    persistPrison(prison);
    return true;
  },

  prisonSell: () => {
    const s = get();
    const p = s.prison;
    const value = bagValue(p.bag, modsOf(p).sell);
    if (!bagCount(p.bag)) return 0;
    const prison = { ...p, bag: {}, earned: p.earned + value, sells: p.sells + 1 };
    const missions = missionsForToday(s.slotsMissions);
    const counters: MissionCounters = { ...EMPTY_COUNTERS, ...missions.counters };
    counters.ore += value;
    set({
      prison,
      slotsBalance: s.slotsBalance + value,
      slotsMissions: { ...missions, counters },
    });
    persistPrison(prison);
    persistSlots(get());
    return value;
  },

  prisonRankUp: (buyout = false) => {
    const s = get();
    const p = s.prison;
    if (p.rank >= LAST_RANK) return null;
    // Норма выработки: без неё ранг только за доплату — деньги общие, и
    // занос в автомате вправе закрыть недобор. Но ровно на ту долю, что
    // не выкопана.
    const extra = quotaBuyout(p.rank, p.prestige, p.norm);
    if (extra > 0 && !buyout) return null;
    const cost = rankCost(p.rank, p.prestige) + extra;
    if (s.slotsBalance < cost) return null;
    const rank = p.rank + 1;
    // Опыт — в ОБЩИЙ уровень, с теми же наградами, что за спины.
    const before = levelFromXp(s.slotsXp).level;
    const xp = s.slotsXp + rankXp(rank);
    const after = levelFromXp(xp).level;
    const levelUps: number[] = [];
    let bonusCoins = 0;
    let bonusTickets = 0;
    for (let lvl = Math.max(before, s.slotsRewardedLevel) + 1; lvl <= after; lvl++) {
      const reward = levelReward(lvl);
      bonusCoins += reward.coins;
      bonusTickets += reward.freeSpins;
      levelUps.push(lvl);
    }
    // Новый ранг сразу ведёт в новую шахту: ради неё его и брали.
    const prison: PrisonState = {
      ...p,
      rank,
      mine: freshMine(rank),
      keys: p.keys + RANK_KEYS,
      norm: {},
      zone: { ...p.zone, on: false, back: null },
    };
    set({
      prison,
      slotsBalance: s.slotsBalance - cost + bonusCoins,
      slotsFreeSpins: s.slotsFreeSpins + bonusTickets,
      slotsXp: xp,
      slotsRewardedLevel: Math.max(s.slotsRewardedLevel, after),
    });
    persistPrison(prison);
    persistSlots(get());
    return { rank, cost, buyout: extra, levelUps };
  },

  prisonBuy: (what) => {
    const s = get();
    const p = s.prison;
    let price = 0;
    let next: PrisonState = p;
    if (what === 'pick') {
      const pick = PICKS[p.pick + 1];
      if (!pick) return false;
      price = pick.price;
      next = { ...p, pick: p.pick + 1 };
    } else if (what === 'sharp') {
      if (p.sharp >= SHARP_MAX) return false;
      price = sharpCost(p.sharp);
      next = { ...p, sharp: p.sharp + 1 };
    } else if (what === 'bag') {
      if (p.bagLevel >= BAG_MAX) return false;
      price = bagCost(p.bagLevel);
      next = { ...p, bagLevel: p.bagLevel + 1 };
    } else {
      if (p.cart) return false;
      price = CART_PRICE;
      next = { ...p, cart: true };
    }
    if (s.slotsBalance < price) return false;
    set({ prison: next, slotsBalance: s.slotsBalance - price });
    persistPrison(next);
    persistSlots(get());
    return true;
  },

  prisonPrestige: () => {
    const s = get();
    const p = s.prison;
    if (p.rank < LAST_RANK) return false;
    const cost = prestigeCost(p.prestige);
    if (s.slotsBalance < cost) return false;
    const before = levelFromXp(s.slotsXp).level;
    const xp = s.slotsXp + PRESTIGE_XP;
    const after = levelFromXp(xp).level;
    let bonusCoins = 0;
    let bonusTickets = 0;
    for (let lvl = Math.max(before, s.slotsRewardedLevel) + 1; lvl <= after; lvl++) {
      const reward = levelReward(lvl);
      bonusCoins += reward.coins;
      bonusTickets += reward.freeSpins;
    }
    // Блат: после престижа начинаешь не с A, а на пару рангов выше.
    const start = Math.min(LAST_RANK - 1, p.perks.blat);
    const prison: PrisonState = {
      ...p,
      rank: start,
      prestige: p.prestige + 1,
      mine: freshMine(start),
      keys: p.keys + PRESTIGE_KEYS,
      norm: {},
      zone: { ...p.zone, on: false, back: null },
    };
    set({
      prison,
      slotsBalance: s.slotsBalance - cost + bonusCoins,
      slotsFreeSpins: s.slotsFreeSpins + bonusTickets,
      slotsXp: xp,
      slotsRewardedLevel: Math.max(s.slotsRewardedLevel, after),
    });
    persistPrison(prison);
    persistSlots(get());
    return true;
  },

  dungeonEnter: (lift, hp) => {
    const d = get().dungeon;
    if (d.run || !d.lifts.includes(lift)) return;
    const dungeon: DungeonState = {
      ...d,
      run: {
        lift,
        area: lift,
        x: -1,
        y: -1,
        hp,
        sack: { meat: {}, mats: {}, tokens: 0, keys: 0, coins: 0, meatBy: {} },
        started: Date.now(),
        killed: 0,
      },
      stats: { ...d.stats, runs: (d.stats.runs ?? 0) + 1 },
    };
    set({ dungeon });
    persistDungeon(dungeon);
  },

  dungeonSave: (snap, delta, fog) => {
    const d = get().dungeon;
    if (!d.run) return;
    const next = applyDelta(d, delta, fog);
    const dungeon: DungeonState = {
      ...next,
      run: {
        ...d.run,
        area: snap.area,
        x: snap.x,
        y: snap.ly,
        hp: snap.hp,
        sack: snap.sack,
        killed: snap.killed,
      },
    };
    set({ dungeon });
    persistDungeon(dungeon);
  },

  dungeonExtract: (snap, delta, fog) => {
    const s = get();
    if (!s.dungeon.run) return null;
    const now = Date.now();
    const d0 = applyDelta(s.dungeon, delta, fog);
    const r = extractRun(d0, snap.sack, econOf(s.prison), now, snap.killed);
    const prison =
      snap.sack.tokens || snap.sack.keys
        ? {
            ...s.prison,
            tokens: s.prison.tokens + snap.sack.tokens,
            keys: s.prison.keys + snap.sack.keys,
          }
        : s.prison;
    set({ dungeon: r.d, prison, slotsBalance: s.slotsBalance + r.pay });
    persistDungeon(r.d);
    if (prison !== s.prison) persistPrison(prison);
    if (r.pay) persistSlots(get());
    return { haul: r.haul, pay: r.pay };
  },

  dungeonDie: (snap, delta, fog) => {
    const s = get();
    if (!s.dungeon.run) return null;
    const d0 = applyDelta(s.dungeon, delta, fog);
    const r = dieRun(d0, snap.sack, econOf(s.prison), Date.now(), snap.killed);
    set({ dungeon: r.d });
    persistDungeon(r.d);
    return r.lost;
  },

  dungeonUpgrade: (slot) => {
    const s = get();
    const d = s.dungeon;
    const econ = econOf(s.prison);
    const step = nextStep(d, slot, econ);
    if (step.kind !== 'plus' && step.kind !== 'reforge') return null;
    if (step.kind === 'reforge' && !conditionsMet(d, slot, d.gear[slot].tier)) return null;
    if (!canPay(d, step.cost, s.slotsBalance)) return null;
    const paid = payMats(d, step.cost);
    const g = d.gear[slot];
    const piece =
      step.kind === 'plus' ? { tier: g.tier, plus: g.plus + 1 } : { tier: g.tier + 1, plus: 0 };
    const dungeon: DungeonState = { ...paid, gear: { ...d.gear, [slot]: piece } };
    set({ dungeon, slotsBalance: s.slotsBalance - step.cost.coins });
    persistDungeon(dungeon);
    persistSlots(get());
    return step.kind;
  },

  dungeonSackUp: () => {
    const s = get();
    const d = s.dungeon;
    // Вылазка, ждущая внизу, возьмёт новый размер при возвращении: мир
    // собирается заново из стора.
    if (d.sackLevel >= SACK_MAX) return false;
    const cost = sackCost(d.sackLevel, econOf(s.prison));
    if (!canPay(d, cost, s.slotsBalance)) return false;
    const dungeon: DungeonState = { ...payMats(d, cost), sackLevel: d.sackLevel + 1 };
    set({ dungeon, slotsBalance: s.slotsBalance - cost.coins });
    persistDungeon(dungeon);
    persistSlots(get());
    return true;
  },

  dungeonUpgradeHere: (slot, sack) => {
    const s = get();
    const d = s.dungeon;
    const step = nextStep(d, slot, econOf(s.prison));
    if (step.kind !== 'plus' && step.kind !== 'reforge') return null;
    if (step.kind === 'reforge' && !conditionsMet(d, slot, d.gear[slot].tier)) return null;
    if (s.slotsBalance < step.cost.coins) return null;
    const paid = payFromBoth(d, step.cost, sack);
    if (!paid) return null;
    const g = d.gear[slot];
    const piece =
      step.kind === 'plus' ? { tier: g.tier, plus: g.plus + 1 } : { tier: g.tier + 1, plus: 0 };
    const dungeon: DungeonState = { ...paid.d, gear: { ...d.gear, [slot]: piece } };
    set({ dungeon, slotsBalance: s.slotsBalance - step.cost.coins });
    persistDungeon(dungeon);
    persistSlots(get());
    return { kind: step.kind, fromSack: paid.fromSack };
  },

  dungeonSackUpHere: (sack) => {
    const s = get();
    const d = s.dungeon;
    if (d.sackLevel >= SACK_MAX) return null;
    const cost = sackCost(d.sackLevel, econOf(s.prison));
    if (s.slotsBalance < cost.coins) return null;
    const paid = payFromBoth(d, cost, sack);
    if (!paid) return null;
    const dungeon: DungeonState = { ...paid.d, sackLevel: d.sackLevel + 1 };
    set({ dungeon, slotsBalance: s.slotsBalance - cost.coins });
    persistDungeon(dungeon);
    persistSlots(get());
    return { fromSack: paid.fromSack };
  },

  dungeonLiftRepair: (area) => {
    const s = get();
    const d = s.dungeon;
    if (d.lifts.includes(area)) return false;
    const cost = liftCost(area, econOf(s.prison));
    if (!canPay(d, cost, s.slotsBalance)) return false;
    const dungeon: DungeonState = { ...payMats(d, cost), lifts: [...d.lifts, area] };
    set({ dungeon, slotsBalance: s.slotsBalance - cost.coins });
    persistDungeon(dungeon);
    persistSlots(get());
    return true;
  },

  dungeonMineSave: (id, m, opened, ore = 0) => {
    const d = get().dungeon;
    const stats = { ...d.stats };
    if (opened) stats.mines = (stats.mines ?? 0) + 1;
    if (ore > 0) stats.ore = (stats.ore ?? 0) + ore;
    const dungeon: DungeonState = { ...d, mines: { ...d.mines, [id]: m }, stats };
    set({ dungeon });
    persistDungeon(dungeon);
  },

  dungeonSpendProp: () => {
    const p = get().prison;
    if (p.items.prop <= 0) return false;
    const prison = { ...p, items: { ...p.items, prop: p.items.prop - 1 } };
    set({ prison });
    persistPrison(prison);
    return true;
  },

  dungeonIntroSeen: () => {
    const d = get().dungeon;
    if (d.intro) return;
    const dungeon = { ...d, intro: true };
    set({ dungeon });
    persistDungeon(dungeon);
  },

  setReminderPrefs: (patch) => {
    const reminderPrefs = { ...get().reminderPrefs, ...patch };
    set({ reminderPrefs });
    persistReminderPrefs(reminderPrefs);
  },
}));
