// «Каскад» — вторая игра, собранная по образцу Gates of Olympus.
//
// Поле 6×5, выплата за восемь одинаковых символов ГДЕ УГОДНО (scatter pays),
// без линий. Сыгравшие символы исчезают, верхние падают на их места, поле
// считается заново — и так, пока выпадают выигрыши (tumble).
//
// Поверх этого работают четыре механики Олимпа:
//   • сферы-множители — падают вместе с символами, КОПЯТСЯ до конца цепочки
//     и в самом конце складываются, разом умножая весь её выигрыш;
//   • скаттер («Зевс» темы) — 4/5/6 штук платят и запускают фриспины;
//   • фриспины — общий множитель копится всю сессию и не сбрасывается;
//   • ставка Ante — +25% к ставке за удвоенный шанс скаттеров.
//
// Про сферы важно знать вот что. СФЕРА — ЭТО СОДЕРЖИМОЕ КЛЕТКИ, ровно такое
// же, как символ или скаттер: `ScatterCell` может быть `orb:25`, и рождается
// такая клетка там же, где все остальные, — в `cell()`, когда собирается поле.
// Отдельного слоя сфер в движке нет и быть не должно.
//
// Так было не всегда, и обе прошлые попытки читались как наклейка поверх поля.
// Сначала сферы умножали одно звено и выбрасывались, если оно не сыграло, —
// их будто не существовало: половина спинов не выигрывает. Потом они стали
// копиться, но по-прежнему ДОСЫПАЛИСЬ поверх готового поля отдельной функцией
// `spawnOrbs` и держались за свои координаты, пока вокруг ссыпались символы.
// Теперь сфера выпадает на барабане вместе со всеми, едет в ленте, встаёт в
// клетку, съезжает вниз при каскаде — потому что она и есть клетка.
//
// Цена того, что сферы видны и копятся, — втрое меньшая таблица выплат
// (см. SCATTER_PAYS): средний множитель вырос почти в двадцать раз, и старые
// выплаты давали отдачу за 250%.
//
// Честность: всё случайное берётся одним взвешенным ГСЧ, множители сфер
// написаны на них самих, ничего не подкручивается. Отдача сведена к ~92%
// таблицей выплат — см. scatter.test.ts.

import type { SlotSymbolId } from '@/types';
import { roundWin } from './slots';

export const SCATTER_COLS = 6;
export const SCATTER_ROWS = 5;
/** Сколько одинаковых символов нужно, чтобы поле сыграло. */
export const CLUSTER_MIN = 8;

type Rng = () => number;

/**
 * Клетка со сферой. Номинал записан в саму клетку — отдельной таблицы сфер
 * нет, и «сфера на поле» означает ровно одно: на поле есть такая клетка.
 */
export type OrbCell = `orb:${number}`;
/** Клетка поля: символ, скаттер или сфера-множитель. */
export type ScatterCell = SlotSymbolId | 'scatter' | OrbCell;
export type ScatterGrid = ScatterCell[][];

export const mkOrb = (value: number): OrbCell => `orb:${value}`;
export const isOrb = (id: ScatterCell): id is OrbCell => id.startsWith('orb:');
/** Номинал сферы в клетке; 0 — клетка не сфера. */
export const orbOf = (id: ScatterCell): number => (isOrb(id) ? Number(id.slice(4)) : 0);

/**
 * Веса символов. Ровнее, чем у классических слотов: на 30 клетках
 * перекошенные веса давали бы вишню почти каждый спин.
 */
export const SCATTER_WEIGHTS: Record<SlotSymbolId, number> = {
  cherry: 20,
  lemon: 18,
  grape: 16,
  bell: 14,
  star: 12,
  diamond: 11,
  seven: 9,
};

/** Выплаты — множители ВСЕЙ ставки. Ступени: 8–9, 10–11, 12+. */
export interface ScatterPay {
  id: SlotSymbolId;
  tiers: [number, number, number];
}

/**
 * Таблица заметно ниже прежней, и это следствие механики, а не жадности.
 * Раньше сфера умножала одно звено и пропадала, если оно не сыграло; теперь
 * она копится и умножает ВСЮ последовательность — средний множитель вырос
 * почти в двадцать раз. При старой таблице отдача улетала за 250%, так что
 * выплаты пришлось поделить примерно на три.
 *
 * Отсюда же и смена ощущения: выигрыш без сфер теперь скромный, а настоящие
 * деньги приносит множитель. Ровно так устроен Олимп — там база тоже почти
 * ничего не платит, а событием является сфера.
 */
export const SCATTER_PAYS: ScatterPay[] = [
  { id: 'cherry', tiers: [0.035, 0.08, 0.22] },
  { id: 'lemon', tiers: [0.05, 0.12, 0.29] },
  { id: 'grape', tiers: [0.08, 0.17, 0.41] },
  { id: 'bell', tiers: [0.12, 0.26, 0.64] },
  { id: 'star', tiers: [0.19, 0.44, 1.34] },
  { id: 'diamond', tiers: [0.33, 0.79, 2.45] },
  { id: 'seven', tiers: [0.64, 1.7, 5.7] },
];

const PAY_BY_ID = new Map(SCATTER_PAYS.map((p) => [p.id, p]));
const IDS = Object.keys(SCATTER_WEIGHTS) as SlotSymbolId[];
const TOTAL_WEIGHT = IDS.reduce((sum, id) => sum + SCATTER_WEIGHTS[id], 0);

// ---------------------------------------------------------------------------
// Скаттер и фриспины
// ---------------------------------------------------------------------------

/** Шанс, что клетка окажется скаттером (со ставкой Ante — вдвое выше). */
export const SCATTER_CHANCE = 0.026;
/**
 * Ante: ставка дороже на четверть за более частый бонус. Шанс клетки поднимаем
 * лишь в 1,095 раза: бонусу нужно ЧЕТЫРЕ скаттера, и хвост биномиального
 * распределения растёт примерно как четвёртая степень шанса. Удвоение шанса
 * дало бы бонус в девять раз чаще и отдачу выше 300%; такой коэффициент
 * подобран так, чтобы Ante был честным выбором стиля, а не бесплатным плюсом.
 */
export const ANTE_COST = 1.25;
export const ANTE_SCATTER_FACTOR = 1.095;
/** Сколько скаттеров нужно для бонуса. */
export const SCATTER_TRIGGER = 4;
/** Выплата за скаттеры (множители ставки) по их количеству: 4, 5, 6. */
export const SCATTER_PAYOUTS: Record<number, number> = { 4: 3, 5: 5, 6: 100 };
/** Сколько фриспинов даёт бонус и сколько добавляют 3+ скаттера внутри него. */
export const FREE_SPINS = 15;
export const FREE_SPINS_RETRIGGER = 5;
export const RETRIGGER_MIN = 3;
/** Покупка бонуса: сразу фриспины за сто ставок. */
export const BUY_BONUS_COST = 100;

/**
 * Предел выигрыша за один спин, в ставках. Так устроены все игры этого
 * семейства (у самого Олимпа — 5000×), и дело не в жадности: без предела
 * сфера ×500, помноженная на накопленный множитель бонуса, даёт выплату,
 * которую нельзя ни посчитать, ни измерить — отдача перестаёт сходиться
 * даже на сотнях тысяч прогонов, потому что её определяет один случай на
 * миллион. Предел делает игру предсказуемой для настройки и не трогает
 * ничего, кроме самого хвоста.
 */
export const MAX_WIN = 5000;

// ---------------------------------------------------------------------------
// Сферы-множители
// ---------------------------------------------------------------------------

export interface Orb {
  col: number;
  row: number;
  value: number;
}

/**
 * Номиналы сфер и их веса: мелкие часто, ×500 — событие на всю жизнь.
 * Экспортируется, чтобы orb-rarity.test.ts считал проценты редкости по
 * настоящей таблице, а не по её копии.
 */
export const ORB_TABLE: [value: number, weight: number][] = [
  [2, 300],
  [3, 220],
  [4, 140],
  [5, 100],
  [6, 70],
  [8, 50],
  [10, 40],
  [12, 30],
  [15, 20],
  [20, 14],
  [25, 8],
  [50, 4],
  [100, 2],
  [250, 1],
  [500, 1],
];
const ORB_TOTAL = ORB_TABLE.reduce((s, [, w]) => s + w, 0);

/**
 * Шанс, что отдельная КЛЕТКА окажется сферой. Именно клетка, а не «поле»:
 * сфера выпадает на барабане наравне с вишней и скаттером, поэтому у неё
 * такой же вид вероятности, как у них.
 *
 * На поле 6×5 это около 0,57 сферы на первое поле и ещё понемногу с каждым
 * падением: сфера видна примерно в половине вращений, цветная — каждое
 * двенадцатое, ×50 и выше — раз в полторы сотни. Меньше нельзя: сфера должна
 * быть привычным гостем, иначе вся лестница редкости — украшение, которого
 * никто не видит.
 *
 * Величина подобрана измерением, а не на глаз: отдача почти линейна по ней
 * (≈3 процентных пункта на каждую тысячную), и 0,019 даёт ~92% на 300 тысячах
 * сессий. Правите — перемеряйте.
 */
export const ORB_CHANCE = 0.019;

function pickWeighted(table: [number, number][], total: number, rng: Rng): number {
  let roll = rng() * total;
  for (const [value, weight] of table) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return table[table.length - 1][0];
}

export function orbValue(rng: Rng = Math.random): number {
  return pickWeighted(ORB_TABLE, ORB_TOTAL, rng);
}

/**
 * Сферы, лежащие на поле прямо сейчас, — просто перечень клеток-сфер.
 * Отдельного списка сфер нигде не хранится: поле само и есть список.
 */
export function gridOrbs(grid: ScatterGrid): Orb[] {
  const orbs: Orb[] = [];
  grid.forEach((column, col) =>
    column.forEach((id, row) => {
      const value = orbOf(id);
      if (value) orbs.push({ col, row, value });
    }),
  );
  return orbs;
}

/**
 * Какие сферы этого поля — новые по сравнению с прошлым звеном. Сравниваем
 * по номиналам, а не по координатам: сфера съезжает вниз вместе с колонкой,
 * так что её место меняется, а она сама — нет.
 */
function newcomers(now: Orb[], before: Orb[]): Orb[] {
  const left = before.map((o) => o.value);
  const fresh: Orb[] = [];
  for (const orb of now) {
    const i = left.indexOf(orb.value);
    if (i >= 0) left.splice(i, 1);
    else fresh.push(orb);
  }
  return fresh;
}

// ---------------------------------------------------------------------------
// Поле
// ---------------------------------------------------------------------------

/** Множитель ставки за `count` символов данного вида. */
export function payFor(id: SlotSymbolId, count: number): number {
  if (count < CLUSTER_MIN) return 0;
  const pay = PAY_BY_ID.get(id);
  if (!pay) return 0;
  const tier = count >= 12 ? 2 : count >= 10 ? 1 : 0;
  return pay.tiers[tier];
}

/** Страховка от бесконечной цепочки. */
export const SCATTER_MAX_CASCADES = 14;

export function scatterSymbol(rng: Rng = Math.random): SlotSymbolId {
  let roll = rng() * TOTAL_WEIGHT;
  for (const id of IDS) {
    roll -= SCATTER_WEIGHTS[id];
    if (roll < 0) return id;
  }
  return IDS[IDS.length - 1];
}

/**
 * Одна клетка барабана: обычно символ, иногда скаттер, иногда сфера. Всё
 * содержимое поля рождается ЗДЕСЬ — другого места, где на поле что-то
 * появляется, в движке нет.
 */
function cell(rng: Rng, scatterChance: number, orbChance: number): ScatterCell {
  const roll = rng();
  if (roll < scatterChance) return 'scatter';
  if (roll < scatterChance + orbChance) return mkOrb(orbValue(rng));
  return scatterSymbol(rng);
}

export function scatterGrid(rng: Rng = Math.random, scatterChance = 0, orbChance = 0): ScatterGrid {
  return Array.from({ length: SCATTER_COLS }, () =>
    Array.from({ length: SCATTER_ROWS }, () => cell(rng, scatterChance, orbChance)),
  );
}

/** Лента вращения: те же клетки, что и на поле, — и сферы в ней тоже есть. */
export function fillerCell(rng: Rng = Math.random): ScatterCell {
  return rng() < ORB_CHANCE * 3 ? mkOrb(orbValue(rng)) : scatterSymbol(rng);
}

export function countScatters(grid: ScatterGrid): number {
  return grid.flat().filter((id) => id === 'scatter').length;
}

export interface ScatterWin {
  symbol: SlotSymbolId;
  count: number;
  /** Множитель ставки до применения множителя сфер. */
  pay: number;
  cells: [number, number][];
}

/**
 * Что сыграло на поле прямо сейчас. Ни скаттеры, ни сферы в восьмёрки не
 * собираются: клетка занята ими, и символа в ней просто нет. Отсюда честный
 * размен — сфера платит, но загромождает поле и укорачивает цепочку.
 */
export function findWins(grid: ScatterGrid): ScatterWin[] {
  const cells = new Map<ScatterCell, [number, number][]>();
  grid.forEach((col, c) =>
    col.forEach((id, r) => {
      if (id === 'scatter' || isOrb(id)) return;
      const list = cells.get(id);
      if (list) list.push([c, r]);
      else cells.set(id, [[c, r]]);
    }),
  );
  const wins: ScatterWin[] = [];
  for (const [symbol, list] of cells) {
    const pay = payFor(symbol as SlotSymbolId, list.length);
    if (pay > 0)
      wins.push({ symbol: symbol as SlotSymbolId, count: list.length, pay, cells: list });
  }
  return wins.sort((a, b) => b.pay - a.pay);
}

/**
 * Схлопывание: сыгравшие клетки исчезают, верхние падают, сверху новые.
 * Скаттеры и сферы никогда не выигрывают, поэтому и не исчезают — они просто
 * съезжают вниз вместе с колонкой, как всё, что осталось. Так сферы и копятся
 * до конца последовательности: не потому, что их кто-то бережёт, а потому что
 * убирать их нечему.
 */
export function scatterCollapse(
  grid: ScatterGrid,
  wins: ScatterWin[],
  rng: Rng = Math.random,
  scatterChance = 0,
  orbChance = 0,
): ScatterGrid {
  const dead = new Set(wins.flatMap((w) => w.cells.map(([c, r]) => `${c}:${r}`)));
  return grid.map((column, col) => {
    const kept = column.filter((_, row) => !dead.has(`${col}:${row}`));
    const fresh = Array.from({ length: SCATTER_ROWS - kept.length }, () =>
      cell(rng, scatterChance, orbChance),
    );
    return [...fresh, ...kept];
  });
}

// ---------------------------------------------------------------------------
// Спин
// ---------------------------------------------------------------------------

export interface ScatterStep {
  grid: ScatterGrid;
  wins: ScatterWin[];
  /** Сферы, приехавшие на барабанах именно в этом звене, — им и звучать. */
  newOrbs: Orb[];
  /** Все сферы поля этого звена: прошлые съехали вниз, новые добавились. */
  orbs: Orb[];
  /** Выплата звена БЕЗ множителя. Множитель применяется один раз, в конце. */
  base: number;
  next: ScatterGrid;
}

export interface ScatterRound {
  /** Поле, на котором остановились барабаны. */
  grid: ScatterGrid;
  steps: ScatterStep[];
  /**
   * Сферы, оказавшиеся на поле за всю последовательность. Показываются даже
   * когда спин не сыграл: в Олимпе они падают всегда, просто не срабатывают.
   */
  orbs: Orb[];
  /** Сумма номиналов сфер последовательности (0 — сфер не было). */
  orbMult: number;
  /** Множитель, реально применённый к базе: в бонусе — накопленный за него. */
  applied: number;
  /** База всей последовательности в монетах, до множителя. */
  base: number;
  /** Сколько скаттеров на стартовом поле. */
  scatters: number;
  /** Выплата за скаттеры в монетах. */
  scatterPay: number;
  /** Сколько фриспинов начислено этим спином. */
  freeSpins: number;
  /** Выигрыш звеньев + скаттеры. */
  total: number;
  combo: number;
  /** Общий множитель бонуса после спина (вне бонуса — 0). */
  totalMult: number;
  multiplier: number;
  kind: 'none' | 'small' | 'big' | 'mega';
}

export interface RoundOptions {
  rng?: Rng;
  /** Ставка Ante: скаттеры выпадают вдвое чаще. */
  ante?: boolean;
  /** Спин внутри бонуса: множитель копится и не сбрасывается. */
  free?: boolean;
  /** Накопленный множитель бонуса на входе. */
  totalMult?: number;
}

/** Полный спин: поле, скаттеры, каскады со сферами. */
export function resolveScatter(bet: number, opts: RoundOptions | Rng = {}): ScatterRound {
  const o: RoundOptions = typeof opts === 'function' ? { rng: opts } : opts;
  const rng = o.rng ?? Math.random;
  const free = !!o.free;
  // В бонусе скаттеры тоже падают — они добавляют вращения.
  const chance = SCATTER_CHANCE * (o.ante ? ANTE_SCATTER_FACTOR : 1);

  let grid = scatterGrid(rng, chance, ORB_CHANCE);
  const first = grid;
  const scatters = countScatters(grid);

  let scatterPay = 0;
  let freeSpins = 0;
  if (free) {
    if (scatters >= RETRIGGER_MIN) freeSpins = FREE_SPINS_RETRIGGER;
  } else if (scatters >= SCATTER_TRIGGER) {
    scatterPay = roundWin(bet * (SCATTER_PAYOUTS[Math.min(scatters, 6)] ?? 0));
    freeSpins = FREE_SPINS;
  }

  const steps: ScatterStep[] = [];
  let totalMult = free ? (o.totalMult ?? 0) : 0;

  // Сферы никуда не собираются отдельно: они лежат на поле, и «все сферы
  // последовательности» — это просто сферы того поля, на котором каскад
  // остановился. Множитель применяется ОДИН раз, в конце, ко всей базе сразу;
  // раньше он применялся к каждому звену по отдельности, и «сработал бонус»
  // было не разглядеть.
  let orbs: Orb[] = [];
  let base = 0;

  for (let i = 0; i < SCATTER_MAX_CASCADES; i++) {
    const now = gridOrbs(grid);
    const newOrbs = newcomers(now, orbs);
    orbs = now;

    const wins = findWins(grid);
    if (!wins.length) break;

    const stepBase = wins.reduce((sum, w) => sum + w.pay, 0) * bet;
    base += stepBase;

    const next = scatterCollapse(grid, wins, rng, chance, ORB_CHANCE);
    steps.push({ grid, wins, newOrbs, orbs: now, base: roundWin(stepBase), next });
    grid = next;
  }

  const orbSum = orbs.reduce((s, orb) => s + orb.value, 0);
  // В бонусе сферы копятся в общий множитель на всю сессию; в базовой игре
  // работают в пределах одной последовательности.
  //
  // Но копятся ТОЛЬКО если последовательность что-то выиграла. Сфера, рядом
  // с которой не собралось ни одной восьмёрки, просто гаснет — у Олимпа
  // так же: множитель влияет на выплату лишь того падения, которое сыграло.
  // Раньше она молча прибавлялась к бонусу, и это выглядело как ошибка счёта.
  if (free && orbSum && base > 0) totalMult += orbSum;
  const applied = base > 0 ? (free ? Math.max(1, totalMult) : Math.max(1, orbSum)) : 1;
  const total = Math.min(bet * MAX_WIN, scatterPay + (base > 0 ? roundWin(base * applied) : 0));

  const multiplier = bet > 0 ? total / bet : 0;
  return {
    grid: first,
    steps,
    orbs,
    orbMult: orbSum,
    applied,
    base: roundWin(base),
    scatters,
    scatterPay,
    freeSpins,
    total,
    combo: steps.length,
    totalMult,
    multiplier,
    kind: multiplier >= 25 ? 'mega' : multiplier >= 5 ? 'big' : total > 0 ? 'small' : 'none',
  };
}

/** Подпись результата для строки статуса. */
export function scatterLabel(out: ScatterRound): { text: string; symbol?: SlotSymbolId } {
  if (out.freeSpins && !out.steps.length) return { text: `${out.scatters} скаттера — бонус!` };
  if (out.kind === 'none') return { text: 'Мимо. Ещё разок?' };
  const best = out.steps.flatMap((s) => s.wins).sort((a, b) => b.pay - a.pay)[0];
  if (!best) return { text: 'Скаттеры сыграли!' };
  if (out.combo >= 2) return { text: `цепочка из ${out.combo} звеньев!`, symbol: best.symbol };
  return { text: `${best.count} символов!`, symbol: best.symbol };
}
