// Живность шахты (v2.64): летучая мышь, сорока, сундучок «одна из трёх» и
// риск-игра на картах. Правила здесь, страница только показывает.
//
// Мышь и сорока нужны не ради дохода, а ради внимания: пока держишь палец на
// породе, поле живёт само и требует реакции. Поэтому награды умеренные и
// проходят через тест темпа (`prison.test.ts`), а появляются они от РАБОТЫ —
// как события двора: по часам мышь летала бы, пока телефон в кармане.
//
// Риск — классическая «удвойка» старых автоматов: открыта карта сдающего,
// рубашкой вверх лежат четыре, выбираешь одну. Старше — ставка вдвое,
// младше — сгорела, равная — ещё раз. Шанс выиграть и проиграть одинаков,
// поэтому риск ничего не отнимает у экономики в среднем — только разброс.
// Карту сдающего видно ДО выбора, и отказаться после неё нельзя: иначе
// рисковали бы только на двойке, и удвойка стала бы бесплатными деньгами.

import { ITEMS, LAST_RANK, nice, rankCost, rollRune, RUNE_ROMAN, runeOf } from './prison';
import type { ItemId, PrisonState, Reward, Treasure, TreasureFrom } from './prison';

export { RISK_STEPS, normalizeTreasure } from './prison';
export type { Treasure, TreasureFrom } from './prison';

// ---------------------------------------------------------------------------
// Летучая мышь.
// ---------------------------------------------------------------------------

/** Шанс, что сломанный блок вспугнёт мышь. */
export const BAT_PER_BLOCK = 1 / 550;
/** Не чаще, чем раз в столько: мышь каждую минуту — уже шум, а не встреча. */
export const BAT_GAP_MS = 100_000;
/** Сколько мышь летит через поле. */
export const BAT_FLIGHT_MS = 3600;
/** Доля синих: быстрее и с сундучком щедрее. */
export const BAT_RARE = 0.12;
/** Во сколько раз щедрее сундучок синей мыши. */
export const BAT_RARE_MULT = 2.5;
/**
 * Монеты сундучка — доля цены ранга, токены — от ранга. Подобрано тестом
 * темпа: мышь стоит круга A→Z не больше пары процентов (с 5% и 10+3·ранг
 * она съедала 7% — внимание превращалось в доход).
 */
export const BAT_COINS = 0.04;
export const batTokens = (r: number, mult = 1): number => Math.round((5 + 1.5 * r) * mult);

/** Вспугнётся ли мышь этим ударом (`blocks` — сколько блоков он сломал). */
export function batRoll(blocks: number, sinceMs: number, rnd: () => number): boolean {
  if (blocks <= 0 || sinceMs < BAT_GAP_MS) return false;
  return rnd() < 1 - Math.pow(1 - BAT_PER_BLOCK, blocks);
}

/** Путь через поле в долях его ширины и высоты. */
export interface BatPath {
  /** Влетает слева (1) или справа (−1). */
  dir: 1 | -1;
  y0: number;
  y1: number;
  /** Размах волны и сколько волн за пролёт. */
  amp: number;
  waves: number;
  phase: number;
  ms: number;
  rare: boolean;
}

export function batPath(rnd: () => number, rare: boolean): BatPath {
  return {
    dir: rnd() < 0.5 ? 1 : -1,
    y0: 0.18 + rnd() * 0.64,
    y1: 0.18 + rnd() * 0.64,
    amp: 0.05 + rnd() * 0.07,
    waves: 1.5 + rnd() * 1.5,
    phase: rnd() * Math.PI * 2,
    ms: rare ? BAT_FLIGHT_MS * 0.8 : BAT_FLIGHT_MS,
    rare,
  };
}

/**
 * Где мышь в момент `t` (0…1 пролёта). Скорость неровная — рывками, как
 * летают мыши: ровный пролёт читается как спрайт на рельсе.
 */
export function batAt(p: BatPath, t: number): { x: number; y: number } {
  const k = Math.max(0, Math.min(1, t + 0.05 * Math.sin(t * Math.PI * 2 * 1.7)));
  const x = -0.14 + 1.28 * k;
  const yLine = p.y0 + (p.y1 - p.y0) * k;
  const y = yLine + p.amp * Math.sin(k * Math.PI * 2 * p.waves + p.phase);
  return { x: p.dir === 1 ? x : 1 - x, y: Math.max(0.06, Math.min(0.94, y)) };
}

// ---------------------------------------------------------------------------
// Сундучок: три карты, взять одну. Карты — РАЗНОГО рода, и каждая стоит
// примерно одинаково (ключ ≈ сундук ≈ 5% цены ранга ≈ токены по рангу), чтобы
// выбор зависел от того, чего не хватает прямо сейчас, а не от арифметики.
// ---------------------------------------------------------------------------

const priceBase = (p: Pick<PrisonState, 'rank' | 'prestige'>) =>
  rankCost(Math.min(p.rank, LAST_RANK - 1), p.prestige);

type OfferKind = 'coins' | 'tokens' | 'keys' | 'item' | 'rune';
const OFFER_KINDS: OfferKind[] = ['coins', 'tokens', 'keys', 'item', 'rune'];
const OFFER_ITEMS: [ItemId, number][] = [
  ['bomb3', 1],
  ['energy', 1],
  ['lens', 2],
];

function offer(
  kind: OfferKind,
  p: Pick<PrisonState, 'rank' | 'prestige'>,
  mult: number,
  rnd: () => number,
): Reward {
  const r = p.rank + p.prestige;
  switch (kind) {
    case 'coins':
      return { kind: 'coins', amount: nice(priceBase(p) * BAT_COINS * mult) };
    case 'tokens':
      return { kind: 'tokens', amount: batTokens(r, mult) };
    case 'keys':
      return { kind: 'keys', amount: mult > 1 ? 2 : 1 };
    case 'item': {
      const [id, n] = OFFER_ITEMS[Math.floor(rnd() * OFFER_ITEMS.length)];
      return { kind: 'item', id, amount: Math.max(n, Math.round(n * mult)) };
    }
    case 'rune':
      return { kind: 'rune', rune: rollRune(mult > 1 ? 2 : 1, rnd) };
  }
}

/**
 * Три карты сундучка мыши: три РАЗНЫХ рода, и среди них всегда есть монеты
 * или токены — то, чем можно рискнуть.
 */
export function batOffers(
  p: Pick<PrisonState, 'rank' | 'prestige'>,
  rare: boolean,
  rnd: () => number,
): Reward[] {
  const pool = OFFER_KINDS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const kinds = pool.slice(0, 3);
  if (!kinds.includes('coins') && !kinds.includes('tokens'))
    kinds[Math.floor(rnd() * 3)] = rnd() < 0.5 ? 'coins' : 'tokens';
  const mult = rare ? BAT_RARE_MULT : 1;
  return kinds.map((k) => offer(k, p, mult, rnd));
}

/** Рискнуть можно только монетами и токенами. */
export const riskable = (r: Reward | undefined): boolean =>
  !!r && (r.kind === 'coins' || r.kind === 'tokens');

export function newTreasure(from: TreasureFrom, options: Reward[]): Treasure {
  const one = options.length === 1;
  const r = options[0];
  return {
    from,
    options,
    pick: one ? 0 : -1,
    stake: one && riskable(r) ? (r as { amount: number }).amount : 0,
    step: 0,
    dealer: -1,
  };
}

// ---------------------------------------------------------------------------
// Риск-игра.
// ---------------------------------------------------------------------------

/** Карта 0…51: достоинство 0…12 (двойка…туз), масть 0…3. */
export const cardRank = (c: number): number => c % 13;
export const cardSuit = (c: number): number => Math.floor(c / 13);

export const RANK_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т'];

export function riskDeal(rnd: () => number): number {
  return Math.floor(rnd() * 52);
}

export type RiskOutcome = 'win' | 'lose' | 'draw';

export interface RiskReveal {
  /** Четыре закрытые карты — все разные и не равны карте сдающего. */
  cards: number[];
  pick: number;
  outcome: RiskOutcome;
}

/** Открыть карту `pick` (0…3). Остальные три открываются для вида. */
export function riskReveal(dealer: number, pick: number, rnd: () => number): RiskReveal {
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) if (c !== dealer) deck.push(c);
  const cards: number[] = [];
  for (let i = 0; i < 4; i++) {
    const j = Math.floor(rnd() * deck.length);
    cards.push(deck[j]);
    deck.splice(j, 1);
  }
  const mine = cardRank(cards[pick]);
  const his = cardRank(dealer);
  return { cards, pick, outcome: mine > his ? 'win' : mine < his ? 'lose' : 'draw' };
}

// ---------------------------------------------------------------------------
// Сорока-воровка — событие двора: летит над полем и роняет краденое. Лежит
// блестяшка недолго; подбирается ударом по клетке — тапом, удержанием или
// ведением пальца. Монеты копятся в мешочке, в конце его можно рискнуть;
// токены и ключ — сразу.
// ---------------------------------------------------------------------------

export type ShinyKind = 'coin' | 'ring' | 'token' | 'key';

/** Как часто роняет и сколько лежит. */
export const MAGPIE_DROP_MS = 700;
export const SHINY_LIFE_MS = 3200;
/** Ключ — не больше одного за налёт. */
export const MAGPIE_KEYS = 1;

export function shinyRoll(rnd: () => number, keyLeft: boolean): ShinyKind {
  const x = rnd();
  if (keyLeft && x < 0.04) return 'key';
  if (x < 0.14) return 'ring';
  if (x < 0.3) return 'token';
  return 'coin';
}

/** Что стоит блестяшка: монеты — в мешочек, токены и ключ — сразу. */
export function shinyValue(
  kind: ShinyKind,
  p: Pick<PrisonState, 'rank' | 'prestige'>,
): { coins: number; tokens: number; keys: number } {
  const base = priceBase(p);
  const r = p.rank + p.prestige;
  if (kind === 'coin') return { coins: nice(base * 0.006), tokens: 0, keys: 0 };
  if (kind === 'ring') return { coins: nice(base * 0.025), tokens: 0, keys: 0 };
  if (kind === 'token') return { coins: 0, tokens: 3 + Math.round(r / 2), keys: 0 };
  return { coins: 0, tokens: 0, keys: 1 };
}

// ---------------------------------------------------------------------------
// Разметка награды одной строкой — для карт сундучка.
// ---------------------------------------------------------------------------

export function offerLabel(r: Reward): { title: string; amount: string } {
  switch (r.kind) {
    case 'coins':
      return { title: 'Монеты', amount: r.amount.toLocaleString('ru-RU') };
    case 'tokens':
      return { title: 'Токены', amount: r.amount.toLocaleString('ru-RU') };
    case 'keys':
      return { title: r.amount > 1 ? 'Ключи' : 'Ключ', amount: `×${r.amount}` };
    case 'item': {
      const it = ITEMS.find((i) => i.id === r.id)!;
      return { title: it.name, amount: `×${r.amount}` };
    }
    case 'rune': {
      const def = runeOf(r.rune.kind);
      return { title: `руна ${def.text}`, amount: `${def.name} ${RUNE_ROMAN[r.rune.tier - 1]}` };
    }
    default:
      return { title: '', amount: '' };
  }
}
