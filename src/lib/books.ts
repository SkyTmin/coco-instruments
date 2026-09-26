// Книги зачарований (v2.70). Владелец: «чары — как книги, а не просто
// покупать за токены». План — docs/plan-kuznica-2026-09.md, п. 6.
//
// Как в Майнкрафте и на присон-серверах (VimeWorld, CosmicPE):
// - книгу покупают у Чародея «вслепую» — ярус известен, чара нет;
// - вписывают в кирку С ШАНСОМ; не вписалась — сгорает книга, не кирка;
// - ненужные книги разбирают в пыль, пыль поднимает шанс;
// - две одинаковые книги на наковальне — одна уровнем выше.
// Сколько чар держит кирка, решает её редкость: обычная — одну,
// божественная — семь.
//
// Модуль чистый: состояние игрока трогает стор, ГСЧ передаёт вызвавший.

import type { EnchantId } from './prison';

/** Уровни книги: I…X. Эффект уровня — доля предела чары (`enchantMax`). */
export const BOOK_LEVELS = 10;
/**
 * Доля предела по уровню: (ур/10)^BOOK_CURVE. Сейчас линейно — «V — половина
 * предела» понятнее любой кривой. Пробовал 1,3 (старшие уровни сильнее
 * младших): со случайными книгами в симуляции это возвращало темп, но
 * после перехода симуляции на «среднюю удачу» (prison.test.ts) линейная
 * шкала сама даёт нужный круг — кривую держим на случай подгонки.
 */
export const BOOK_CURVE = 1;

/** Доля предела чары у книги уровня `lvl`. */
export function bookShare(lvl: number): number {
  return Math.pow(Math.max(0, Math.min(BOOK_LEVELS, lvl)) / BOOK_LEVELS, BOOK_CURVE);
}

/** Наименьший уровень, дающий не меньше доли `share` (перенос старых чар). */
export function levelForShare(share: number): number {
  for (let l = 1; l <= BOOK_LEVELS; l++) if (bookShare(l) >= share - 1e-9) return l;
  return BOOK_LEVELS;
}
export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
/** Полка: больше книг не держит, лишнюю Чародей не продаст. */
export const SHELF_MAX = 30;
/** Книга из блока этажа (блок попадается раз в минуту копания). */
export const BLOCK_BOOK_CHANCE = 0.06;

export interface Book {
  id: EnchantId;
  /** Уровень 1…10. */
  lvl: number;
  /** Шанс вписаться, % (5…100). */
  chance: number;
}

export type BookTier = 'simple' | 'rare' | 'epic' | 'legend';

/**
 * Ярусы Чародея. Цены подобраны тестом темпа (prison.test.ts, BOOKP=…):
 * круг A→Z 4,7 ч у идеального игрока; за первый круг он берёт ~16 простых,
 * ~20 редких и одну-две эпических, легендарная — после престижа (зона
 * платит токенами) или из сундука. Шанс вписать тем ниже, чем выше ярус.
 */
export interface BookTierDef {
  id: BookTier;
  name: string;
  /** Уровни книги этого яруса (включительно). */
  lvl: [number, number];
  /** Шанс вписаться, % (включительно, шаг 5). */
  chance: [number, number];
  /** Цена у Чародея, токены. */
  price: number;
}

export const BOOK_TIERS: BookTierDef[] = [
  { id: 'simple', name: 'Простая', lvl: [1, 2], chance: [50, 100], price: 140 },
  { id: 'rare', name: 'Редкая', lvl: [2, 4], chance: [40, 95], price: 450 },
  { id: 'epic', name: 'Эпическая', lvl: [4, 7], chance: [35, 90], price: 1_350 },
  { id: 'legend', name: 'Легендарная', lvl: [7, 10], chance: [30, 85], price: 4_500 },
];

export const bookTierOf = (id: BookTier): BookTierDef => BOOK_TIERS.find((t) => t.id === id)!;

/**
 * Какие чары бывают в книгах. Отбойник сносит весь ярус — он только в
 * легендарной: иначе к середине круга поле пустело бы от простых книг.
 */
export const BOOK_POOL: EnchantId[] = [
  'power',
  'fortune',
  'vein',
  'blast',
  'token',
  'key',
  'frenzy',
  'beam',
  'reforge',
];
export const LEGEND_POOL: EnchantId[] = [...BOOK_POOL, 'hammer'];

const pick = <T>(list: T[], rnd: () => number): T =>
  list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
const between = (lo: number, hi: number, rnd: () => number) =>
  lo + Math.min(hi - lo, Math.floor(rnd() * (hi - lo + 1)));

/** Книга яруса «вслепую»: чара, уровень и шанс — случай. */
export function rollBook(tier: BookTier, rnd: () => number): Book {
  const t = bookTierOf(tier);
  const id = pick(tier === 'legend' ? LEGEND_POOL : BOOK_POOL, rnd);
  const lvl = between(t.lvl[0], t.lvl[1], rnd);
  const chance = between(t.chance[0] / 5, t.chance[1] / 5, rnd) * 5;
  return { id, lvl, chance };
}

/** Сколько чар держит кирка редкости `rarity` (0 — обычная … 6 — божественная). */
export function bookSlots(rarity: number): number {
  return Math.max(1, Math.min(7, Math.floor(rarity) + 1));
}

/** Пыль за разобранную книгу: процент шанса на следующую. */
export function dustOf(b: Pick<Book, 'lvl'>): number {
  return b.lvl * 3;
}

/** Шанс вписать книгу с добавленной пылью. */
export function applyChance(b: Book, dust: number): number {
  return Math.max(0, Math.min(100, b.chance + Math.max(0, Math.floor(dust))));
}

/** Сколько пыли довести шанс книги до 100%. */
export function dustToFull(b: Book): number {
  return Math.max(0, 100 - b.chance);
}

export type ApplyCheck = 'ok' | 'lower' | 'full';

/**
 * Можно ли вписать книгу: `lower` — у кирки эта чара уже того же уровня или
 * выше (книга ничего не даст), `full` — все места заняты другими чарами.
 */
export function canApply(
  ench: Partial<Record<EnchantId, number>>,
  slots: number,
  b: Book,
): ApplyCheck {
  const cur = ench[b.id] ?? 0;
  if (cur >= b.lvl) return 'lower';
  if (cur > 0) return 'ok';
  const used = Object.values(ench).filter((v) => (v ?? 0) > 0).length;
  return used >= slots ? 'full' : 'ok';
}

/** Наковальня: две одинаковые книги → одна уровнем выше, шанс — средний. */
export function anvil(a: Book, b: Book): Book | null {
  if (a.id !== b.id || a.lvl !== b.lvl || a.lvl >= BOOK_LEVELS) return null;
  return { id: a.id, lvl: a.lvl + 1, chance: Math.round((a.chance + b.chance) / 10) * 5 };
}

/** Индекс пары для наковальни к книге `i` (−1 — пары нет). */
export function anvilMate(shelf: Book[], i: number): number {
  const a = shelf[i];
  if (!a || a.lvl >= BOOK_LEVELS) return -1;
  return shelf.findIndex((b, j) => j !== i && b.id === a.id && b.lvl === a.lvl);
}

/** Ярус книги по уровню — для цвета обложки. */
export function tierOfLevel(lvl: number): BookTier {
  if (lvl >= 7) return 'legend';
  if (lvl >= 4) return 'epic';
  if (lvl >= 2) return 'rare';
  return 'simple';
}

/** Книга из сохранения: всё, что не похоже на книгу, выбрасывается. */
export function normalizeBook(raw: unknown, ids: readonly string[]): Book | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Partial<Book>;
  if (typeof b.id !== 'string' || !ids.includes(b.id)) return null;
  const lvl = Math.round(Number(b.lvl));
  const chance = Math.round(Number(b.chance) / 5) * 5;
  if (!Number.isFinite(lvl) || !Number.isFinite(chance)) return null;
  return {
    id: b.id as EnchantId,
    lvl: Math.max(1, Math.min(BOOK_LEVELS, lvl)),
    chance: Math.max(5, Math.min(100, chance)),
  };
}
