// «Каторга» — присон с видом сверху. Здесь все правила; страница только
// показывает и ловит пальцы.
//
// ДЕНЬГИ ОБЩИЕ С АВТОМАТАМИ (`slotsBalance`) — в этом весь смысл: шахта
// кормит автоматы, а крупный занос в автомате покупает ранг. Отсюда масштаб
// чисел. На серверах цены уходят в миллиарды; у нас ставка 10–500 монет, и
// ранг Z стоит примерно столько же, сколько мега-выигрыш на максимальной
// ставке. Сделать шахту в миллиардах — и автоматы станут мелочью, которую
// незачем крутить; сделать её в копейках — и ранги покупались бы стартовой
// тысячей. Темп подобран тестом-симуляцией (`prison.test.ts`), не на глаз.
//
// Как устроено поле. Шахта — яма, а не плоскость: 7×9 клеток, в каждой пять
// ярусов. Сломал верхний блок — под ним следующий. Чем глубже, тем богаче
// порода, а на дне изредка попадается порода СЛЕДУЮЩЕЙ шахты — подсказка,
// за чем идти. Поле собирается из зерна (`seed`): сохранять нужно только
// зерно и глубину раскопа по клеткам, а не триста пятнадцать блоков.

export const MINE_COLS = 7;
export const MINE_ROWS = 9;
export const MINE_CELLS = MINE_COLS * MINE_ROWS;
/** Ярусов в клетке. Глубина `DEPTH` — выработано до дна. */
export const DEPTH = 5;
/** Доля выработки, после которой шахта обновляется: последние блоки не ищут. */
export const MINE_RESET_AT = 0.85;

// ---------------------------------------------------------------------------
// Породы. Настоящие минералы, в том числе кольские (апатит, эвдиалит — это
// Хибины). Индекс породы = буква шахты, в которой она впервые появляется.
// ---------------------------------------------------------------------------

/** Материал — от него звук удара и характер крошки. */
export type RockKind = 'soil' | 'stone' | 'metal' | 'crystal' | 'star';

/** Узор процедурной текстуры. */
export type RockPattern = 'grain' | 'bands' | 'specks' | 'veins' | 'crystal' | 'flakes' | 'stars';

export interface Rock {
  id: string;
  name: string;
  kind: RockKind;
  pattern: RockPattern;
  /** Основа, тень, вкрапления, блик — палитра текстуры. */
  base: string;
  dark: string;
  fleck: string;
  shine: string;
  /** Прочность: сколько урона выдержит блок. */
  hp: number;
  /** Цена продажи одного блока, монет. */
  value: number;
}

type RockDef = Omit<Rock, 'hp' | 'value'>;

const ROCK_DEFS: RockDef[] = [
  {
    id: 'clay',
    name: 'Глина',
    kind: 'soil',
    pattern: 'grain',
    base: '#9c6b4a',
    dark: '#74492f',
    fleck: '#b98464',
    shine: '#d2a582',
  },
  {
    id: 'sandstone',
    name: 'Песчаник',
    kind: 'stone',
    pattern: 'bands',
    base: '#d6b27a',
    dark: '#b08a55',
    fleck: '#e6c992',
    shine: '#f3e0b6',
  },
  {
    id: 'limestone',
    name: 'Известняк',
    kind: 'stone',
    pattern: 'specks',
    base: '#c9c4b3',
    dark: '#9f9985',
    fleck: '#e8e4d6',
    shine: '#f7f4ea',
  },
  {
    id: 'granite',
    name: 'Гранит',
    kind: 'stone',
    pattern: 'specks',
    base: '#8f8987',
    dark: '#5f5957',
    fleck: '#d49a8a',
    shine: '#ececec',
  },
  {
    id: 'coal',
    name: 'Уголь',
    kind: 'stone',
    pattern: 'specks',
    base: '#76746f',
    dark: '#52504c',
    fleck: '#18181c',
    shine: '#5c5d6a',
  },
  {
    id: 'copper',
    name: 'Медь',
    kind: 'metal',
    pattern: 'specks',
    base: '#80796f',
    dark: '#58524a',
    fleck: '#e0864a',
    shine: '#7fd6b8',
  },
  {
    id: 'ironstone',
    name: 'Железняк',
    kind: 'metal',
    pattern: 'veins',
    base: '#85736a',
    dark: '#5a4a43',
    fleck: '#b8583a',
    shine: '#e2a58c',
  },
  {
    id: 'nickel',
    name: 'Никель',
    kind: 'metal',
    pattern: 'specks',
    base: '#747c76',
    dark: '#4e5550',
    fleck: '#cfd8c6',
    shine: '#f2f7ea',
  },
  {
    id: 'apatite',
    name: 'Апатит',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#6c7a7a',
    dark: '#475454',
    fleck: '#3fc4ad',
    shine: '#b8f4e6',
  },
  {
    id: 'mica',
    name: 'Слюда',
    kind: 'stone',
    pattern: 'flakes',
    base: '#7c7262',
    dark: '#554d40',
    fleck: '#dcc99a',
    shine: '#fff6d6',
  },
  {
    id: 'quartz',
    name: 'Кварц',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#cfd6dd',
    dark: '#a2adb9',
    fleck: '#f4f7fa',
    shine: '#ffffff',
  },
  {
    id: 'silver',
    name: 'Серебро',
    kind: 'metal',
    pattern: 'veins',
    base: '#696d77',
    dark: '#464a53',
    fleck: '#e2e7ef',
    shine: '#ffffff',
  },
  {
    id: 'fluorite',
    name: 'Флюорит',
    kind: 'crystal',
    pattern: 'bands',
    base: '#6b5a90',
    dark: '#463a66',
    fleck: '#7fdcb4',
    shine: '#dccbff',
  },
  {
    id: 'malachite',
    name: 'Малахит',
    kind: 'stone',
    pattern: 'bands',
    base: '#1f8d5c',
    dark: '#11603d',
    fleck: '#52d192',
    shine: '#a2f2c8',
  },
  {
    id: 'gold',
    name: 'Золото',
    kind: 'metal',
    pattern: 'veins',
    base: '#6f665a',
    dark: '#4a4339',
    fleck: '#ffc93a',
    shine: '#fff3a8',
  },
  {
    id: 'amethyst',
    name: 'Аметист',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#5d4a7a',
    dark: '#3d2f54',
    fleck: '#b682ec',
    shine: '#f0dcff',
  },
  {
    id: 'lapis',
    name: 'Лазурит',
    kind: 'stone',
    pattern: 'specks',
    base: '#2344a0',
    dark: '#162d70',
    fleck: '#e0bc4c',
    shine: '#7898ee',
  },
  {
    id: 'jade',
    name: 'Нефрит',
    kind: 'stone',
    pattern: 'grain',
    base: '#3f9c6c',
    dark: '#2a704c',
    fleck: '#80d8a2',
    shine: '#cbf6dc',
  },
  {
    id: 'garnet',
    name: 'Гранат',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#5c4b4b',
    dark: '#3a2e2e',
    fleck: '#c4531f',
    shine: '#ffa070',
  },
  {
    id: 'eudialyte',
    name: 'Эвдиалит',
    kind: 'crystal',
    pattern: 'specks',
    base: '#6f6a66',
    dark: '#494542',
    fleck: '#e0448f',
    shine: '#ffc2e2',
  },
  {
    id: 'sapphire',
    name: 'Сапфир',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#4a5272',
    dark: '#2d3350',
    fleck: '#2e6aff',
    shine: '#b0caff',
  },
  {
    id: 'emerald',
    name: 'Изумруд',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#4c5a50',
    dark: '#2e3a32',
    fleck: '#1fd47c',
    shine: '#b4ffda',
  },
  {
    id: 'ruby',
    name: 'Рубин',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#5b4d53',
    dark: '#3a2f35',
    fleck: '#ff2a4c',
    shine: '#ffb6c2',
  },
  {
    id: 'diamond',
    name: 'Алмаз',
    kind: 'crystal',
    pattern: 'crystal',
    base: '#3f4652',
    dark: '#262b34',
    fleck: '#c2f6ff',
    shine: '#ffffff',
  },
  {
    id: 'meteorite',
    name: 'Метеорит',
    kind: 'metal',
    pattern: 'veins',
    base: '#3b3735',
    dark: '#1f1c1b',
    fleck: '#a3acb6',
    shine: '#ff9a48',
  },
  {
    id: 'starstone',
    name: 'Звёздный кристалл',
    kind: 'star',
    pattern: 'stars',
    base: '#1d1646',
    dark: '#0e0a2a',
    fleck: '#a6d6ff',
    shine: '#ffffff',
  },
];

/** Прочность растёт медленнее цены: кирка обязана догонять породу. */
export const HP_BASE = 2;
export const HP_GROWTH = 1.165;
export const VALUE_BASE = 3;
export const VALUE_GROWTH = 1.19;

export const ROCKS: Rock[] = ROCK_DEFS.map((d, j) => ({
  ...d,
  hp: Math.max(2, Math.round(HP_BASE * Math.pow(HP_GROWTH, j))),
  value: Math.round(VALUE_BASE * Math.pow(VALUE_GROWTH, j)),
}));

/** Шахт и рангов столько же, сколько пород: A…Z. */
export const MINES = ROCKS.length;
export const LAST_RANK = MINES - 1;

/** Буква ранга или шахты. */
export const rankLetter = (r: number): string =>
  String.fromCharCode(65 + Math.max(0, Math.min(LAST_RANK, Math.round(r))));

// ---------------------------------------------------------------------------
// Состав шахты. Как лестница шахт в плагине Prison: каждая следующая шахта
// прибавляет новую породу понемногу и вытесняет самую дешёвую. В шахте пять
// пород; самая новая — редкая (5%), старые — основа.
// ---------------------------------------------------------------------------

/** Вес породы по её «возрасту» в шахте: 0 — самая новая. */
const AGE_WEIGHTS = [5, 12, 20, 28, 35];
/** Глубже — богаче: шанс, что блок сдвинется на породу новее. */
const DEPTH_BOOST = [0, 0.15, 0.3, 0.45, 0.6];
/** На дне изредка попадается порода следующей шахты. */
export const NEXT_ROCK_CHANCE = 0.03;

export interface MineShare {
  rock: number;
  share: number;
}

/** Состав шахты на верхнем ярусе: какие породы и в какой доле. */
export function mineMix(mine: number): MineShare[] {
  const out: MineShare[] = [];
  let total = 0;
  for (let age = 0; age < AGE_WEIGHTS.length; age++) {
    const rock = mine - age;
    if (rock < 0) break;
    out.push({ rock, share: AGE_WEIGHTS[age] });
    total += AGE_WEIGHTS[age];
  }
  return out.map((m) => ({ ...m, share: m.share / total })).sort((a, b) => a.rock - b.rock);
}

/** Детерминированный генератор: одно зерно — одно и то же поле везде. */
export function rng32(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Порода одного блока на ярусе `depth`, без учёта соседей. */
function rollRock(mine: number, depth: number, rnd: () => number): number {
  const mix = mineMix(mine);
  let x = rnd();
  let pick = mix[mix.length - 1].rock;
  for (const m of mix) {
    x -= m.share;
    if (x <= 0) {
      pick = m.rock;
      break;
    }
  }
  if (pick < mine && rnd() < DEPTH_BOOST[depth]) pick += 1;
  if (depth === DEPTH - 1 && mine < LAST_RANK && rnd() < NEXT_ROCK_CHANCE) pick = mine + 1;
  return pick;
}

/**
 * Поле шахты: `rocks[depth * MINE_CELLS + cell]`. Порода кладётся жилами, а
 * не солью с перцем: после броска каждая клетка с некоторым шансом берёт
 * породу соседа. Сверху это читается как настоящие прожилки руды.
 */
export function buildMine(mine: number, seed: number): number[] {
  const rnd = rng32(seed * 31 + mine * 7919 + 17);
  const rocks = new Array<number>(MINE_CELLS * DEPTH);
  for (let d = 0; d < DEPTH; d++) {
    const layer = Array.from({ length: MINE_CELLS }, () => rollRock(mine, d, rnd));
    // Жилы: редкая порода растекается к соседям, дешёвая не растекается —
    // иначе поле превратилось бы в пятна глины.
    const veins = layer.slice();
    for (let c = 0; c < MINE_CELLS; c++) {
      if (rnd() > 0.34) continue;
      const x = c % MINE_COLS;
      const y = Math.floor(c / MINE_COLS);
      const nb: number[] = [];
      if (x > 0) nb.push(c - 1);
      if (x < MINE_COLS - 1) nb.push(c + 1);
      if (y > 0) nb.push(c - MINE_COLS);
      if (y < MINE_ROWS - 1) nb.push(c + MINE_COLS);
      const from = layer[nb[Math.floor(rnd() * nb.length)]];
      if (from > veins[c]) veins[c] = from;
    }
    for (let c = 0; c < MINE_CELLS; c++) rocks[d * MINE_CELLS + c] = veins[c];
  }
  return rocks;
}

/** Порода верхнего блока клетки при раскопе `dug`; −1 — дно. */
export function rockAt(rocks: number[], cell: number, dug: number): number {
  if (dug >= DEPTH) return -1;
  return rocks[dug * MINE_CELLS + cell];
}

/** Доля выработанных блоков. */
export function minedShare(dug: number[]): number {
  let n = 0;
  for (const d of dug) n += Math.min(DEPTH, d);
  return n / (MINE_CELLS * DEPTH);
}

// ---------------------------------------------------------------------------
// Ранги и престиж.
// ---------------------------------------------------------------------------

export const RANK_BASE = 250;
export const RANK_GROWTH = 1.33;
/** Престиж: сброс на A с сохранением кирки и +25% к продаже за каждый. */
export const PRESTIGE_BASE = 400_000;
export const PRESTIGE_SELL = 0.25;
/** Ранги дорожают с каждым престижем — иначе второй круг был бы прогулкой. */
export const PRESTIGE_RANK_COST = 0.35;

/** Две значащие цифры: цена «1 800», а не «1 793». */
export function nice(x: number): number {
  if (x < 100) return Math.round(x);
  const p = Math.pow(10, Math.floor(Math.log10(x)) - 1);
  return Math.round(x / p) * p;
}

/** Цена перехода с ранга `rank` на следующий. */
export function rankCost(rank: number, prestige = 0): number {
  return nice(RANK_BASE * Math.pow(RANK_GROWTH, rank) * (1 + PRESTIGE_RANK_COST * prestige));
}

export function prestigeCost(prestige: number): number {
  return nice(PRESTIGE_BASE * (1 + prestige));
}

/** Множитель продажи от престижа. */
export function sellMult(prestige: number): number {
  return 1 + PRESTIGE_SELL * prestige;
}

/** Опыт в ОБЩИЙ уровень за новый ранг: как и деньги, уровень один на всё. */
export function rankXp(newRank: number): number {
  return 25 + 15 * newRank;
}
export const PRESTIGE_XP = 2500;

// ---------------------------------------------------------------------------
// Кузница: кирки, заточка, рюкзак, вагонетка.
// ---------------------------------------------------------------------------

export interface Pick {
  id: string;
  name: string;
  /** Урон за удар. */
  dmg: number;
  /** Ударов в секунду, пока палец держит клетку. */
  rate: number;
  price: number;
  /** Цвет головки кирки на иконке. */
  head: string;
}

export const PICKS: Pick[] = [
  { id: 'rusty', name: 'Ржавая', dmg: 1, rate: 3, price: 0, head: '#9a6a4a' },
  { id: 'steel', name: 'Стальная', dmg: 2, rate: 3.4, price: 900, head: '#b8c2cc' },
  { id: 'tempered', name: 'Закалённая', dmg: 4, rate: 3.8, price: 6_000, head: '#6f8fb0' },
  { id: 'carbide', name: 'Твёрдосплавная', dmg: 8, rate: 4.2, price: 30_000, head: '#5b6470' },
  { id: 'diamond', name: 'Алмазная', dmg: 15, rate: 4.6, price: 120_000, head: '#7fe6ff' },
  { id: 'meteor', name: 'Метеоритная', dmg: 28, rate: 5.2, price: 400_000, head: '#ff8a3a' },
];

/** Заточка: +12% урона за уровень. */
export const SHARP_STEP = 0.12;
export const SHARP_MAX = 15;
export function sharpCost(level: number): number {
  return nice(150 * Math.pow(1.62, level));
}

/** Крит: редкий удар втрое — ради него и держат палец. */
export const CRIT_CHANCE = 0.07;
export const CRIT_MULT = 3;

/** Рюкзак: сколько блоков влезает. */
export const BAG_MAX = 12;
export function bagCapacity(level: number): number {
  return Math.round(40 * Math.pow(1.35, level));
}
export function bagCost(level: number): number {
  return nice(200 * Math.pow(2, level));
}

/** Вагонетка: продаёт сама, когда рюкзак полон. */
export const CART_PRICE = 2_500;

/** Урон одного удара без крита. */
export function hitDamage(pick: number, sharp: number): number {
  const p = PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))];
  return p.dmg * (1 + SHARP_STEP * sharp);
}

/**
 * Минимальный промежуток между ударами ТАПОМ, мс. Тапать можно быстрее, чем
 * бьёт кирка на удержании (это награда за усилие), но не бесконечно: иначе
 * выигрывает не кирка, а автокликер.
 */
export function tapGapMs(pick: number): number {
  return 1000 / (PICKS[Math.max(0, Math.min(PICKS.length - 1, pick))].rate * 1.8);
}

// ---------------------------------------------------------------------------
// Рюкзак и продажа.
// ---------------------------------------------------------------------------

/** Содержимое рюкзака: сколько блоков каждой породы (по индексу породы). */
export type Bag = Record<number, number>;

export function bagCount(bag: Bag): number {
  let n = 0;
  for (const k in bag) n += bag[k] || 0;
  return n;
}

export function bagValue(bag: Bag, prestige = 0): number {
  let v = 0;
  for (const k in bag) v += (bag[k] || 0) * (ROCKS[Number(k)]?.value ?? 0);
  return Math.round(v * sellMult(prestige));
}

// ---------------------------------------------------------------------------
// Темп. Та же модель, что в тесте: сколько монет в секунду даёт шахта при
// ударах на удержании. Страница ею не пользуется — она для баланса.
// ---------------------------------------------------------------------------

/** Ожидаемое число ударов на блок породы `rock`. */
export function hitsFor(rock: number, dmg: number): number {
  const hp = ROCKS[rock].hp;
  // Крит — это шанс снести блок на удар раньше. Честный расчёт по цепочке
  // ударов тут не нужен: для темпа хватает среднего урона.
  const mean = dmg * (1 + CRIT_CHANCE * (CRIT_MULT - 1));
  return Math.max(1, Math.ceil(hp / mean - 1e-9));
}

/** Средний доход шахты, монет в секунду, на удержании. */
export function incomeRate(mine: number, pick: number, sharp: number, prestige = 0): number {
  const dmg = hitDamage(pick, sharp);
  const rate = PICKS[pick].rate;
  // Средний блок по всем ярусам — с учётом того, что глубже порода новее.
  let hits = 0;
  let value = 0;
  for (let d = 0; d < DEPTH; d++) {
    for (const m of mineMix(mine)) {
      const up = m.rock < mine ? DEPTH_BOOST[d] : 0;
      for (const [rock, p] of [
        [m.rock, 1 - up],
        [m.rock + 1, up],
      ] as const) {
        if (p <= 0) continue;
        hits += (m.share * p * hitsFor(rock, dmg)) / DEPTH;
        value += (m.share * p * ROCKS[rock].value) / DEPTH;
      }
    }
  }
  return (rate / hits) * value * sellMult(prestige);
}

// ---------------------------------------------------------------------------
// Сохранение.
// ---------------------------------------------------------------------------

export interface PrisonMine {
  /** Буква шахты (индекс). */
  id: number;
  seed: number;
  /** Глубина раскопа по клеткам, 0…DEPTH. */
  dug: number[];
}

export interface PrisonState {
  rank: number;
  prestige: number;
  pick: number;
  sharp: number;
  bagLevel: number;
  cart: boolean;
  bag: Bag;
  mine: PrisonMine;
  /** Сколько блоков сломано за всё время и сколько выручено продажей. */
  mined: number;
  earned: number;
}

export function freshMine(id: number, seed = Math.floor(Math.random() * 2 ** 31)): PrisonMine {
  return { id, seed, dug: new Array<number>(MINE_CELLS).fill(0) };
}

export const PRISON_START: PrisonState = {
  rank: 0,
  prestige: 0,
  pick: 0,
  sharp: 0,
  bagLevel: 0,
  cart: false,
  bag: {},
  mine: { id: 0, seed: 1, dug: new Array<number>(MINE_CELLS).fill(0) },
  mined: 0,
  earned: 0,
};

const int = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;

/** Сохранение могло прийти битым или от старой версии — чиним по полям. */
export function normalizePrison(raw: Partial<PrisonState> | null | undefined): PrisonState {
  if (!raw || typeof raw !== 'object') return { ...PRISON_START, mine: freshMine(0) };
  const rank = int(raw.rank, 0, LAST_RANK, 0);
  const bag: Bag = {};
  if (raw.bag && typeof raw.bag === 'object') {
    for (const [k, v] of Object.entries(raw.bag)) {
      const i = Number(k);
      const n = int(v, 0, 1e7, 0);
      if (Number.isInteger(i) && i >= 0 && i < MINES && n > 0) bag[i] = n;
    }
  }
  const m = raw.mine;
  const mineId = int(m?.id, 0, rank, rank);
  const dug =
    m && Array.isArray(m.dug) && m.dug.length === MINE_CELLS
      ? m.dug.map((d) => int(d, 0, DEPTH, 0))
      : null;
  return {
    rank,
    prestige: int(raw.prestige, 0, 999, 0),
    pick: int(raw.pick, 0, PICKS.length - 1, 0),
    sharp: int(raw.sharp, 0, SHARP_MAX, 0),
    bagLevel: int(raw.bagLevel, 0, BAG_MAX, 0),
    cart: raw.cart === true,
    bag,
    mine: dug ? { id: mineId, seed: int(m?.seed, 0, 2 ** 31, 1), dug } : freshMine(mineId),
    mined: int(raw.mined, 0, 1e12, 0),
    earned: int(raw.earned, 0, 1e15, 0),
  };
}

// ---------------------------------------------------------------------------
// Большие числа сокращениями: 1,2 тыс., 3,4 млн.
// ---------------------------------------------------------------------------

export function shortMoney(n: number): string {
  const a = Math.abs(n);
  const f = (x: number, u: string) =>
    `${(Math.round(x * 10) / 10).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${u}`;
  if (a >= 1e9) return f(n / 1e9, 'млрд');
  if (a >= 1e6) return f(n / 1e6, 'млн');
  if (a >= 1e4) return f(n / 1e3, 'тыс.');
  return Math.round(n).toLocaleString('ru-RU');
}
