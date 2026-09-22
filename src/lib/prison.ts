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
export const RANK_GROWTH = 1.36;
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

/** Цена рюкзака. `mult` — множитель продажи (престиж, перки, коллекция). */
export function bagValue(bag: Bag, mult = 1): number {
  let v = 0;
  for (const k in bag) v += (bag[k] || 0) * (ROCKS[Number(k)]?.value ?? 0);
  return Math.round(v * mult);
}

/**
 * Разложить добычу по рюкзаку. Места нет — вагонетка (если куплена) продаёт
 * рюкзак и укладка продолжается; без вагонетки остаток пропадает в шахте.
 */
export function stash(
  bag: Bag,
  units: number[],
  cap: number,
  cart: boolean,
  mult: number,
): { bag: Bag; taken: number; lost: number; sold: number } {
  const out: Bag = { ...bag };
  let count = bagCount(out);
  let taken = 0;
  let lost = 0;
  let sold = 0;
  for (const rock of units) {
    if (count >= cap) {
      if (!cart) {
        lost += 1;
        continue;
      }
      sold += bagValue(out, mult);
      for (const k in out) delete out[k];
      count = 0;
    }
    out[rock] = (out[rock] ?? 0) + 1;
    count += 1;
    taken += 1;
  }
  return { bag: out, taken, lost, sold };
}

// ---------------------------------------------------------------------------
// Токены и зачарования — как в X-Prison. Токены падают с блоков, на них
// качаются зачарования кирки. Цена уровня — база плюс шаг за каждый уже
// взятый уровень; сброс возвращает половину потраченного.
//
// Зачарования — главная кривая силы присона: к концу кирка ломает не блок,
// а полшахты за удар. Поэтому их цены не «на глаз»: тест темпа покупает их
// так же, как кирку, и следит, чтобы первый круг A→Z не схлопнулся.
// ---------------------------------------------------------------------------

export type EnchantId =
  | 'power'
  | 'fortune'
  | 'vein'
  | 'blast'
  | 'hammer'
  | 'token'
  | 'key'
  | 'frenzy';

export interface Enchant {
  id: EnchantId;
  name: string;
  /** Что даёт один уровень — подпись в мастерской. */
  per: string;
  max: number;
  base: number;
  inc: number;
  glyph: string;
}

export const ENCHANTS: Enchant[] = [
  { id: 'power', name: 'Сила', per: '+10% урона', max: 30, base: 50, inc: 30, glyph: '⚒' },
  {
    id: 'fortune',
    name: 'Удача',
    per: '+6% к шансу лишнего блока',
    max: 30,
    base: 80,
    inc: 50,
    glyph: '☘',
  },
  {
    id: 'vein',
    name: 'Жилокоп',
    per: '+2,5% выломать жилу целиком',
    max: 20,
    base: 65,
    inc: 40,
    glyph: '⚡',
  },
  { id: 'blast', name: 'Взрыв', per: '+1% снести 3×3', max: 20, base: 95, inc: 65, glyph: '✸' },
  {
    id: 'hammer',
    name: 'Отбойник',
    per: '+0,2% снести весь ярус',
    max: 15,
    base: 240,
    inc: 130,
    glyph: '≋',
  },
  { id: 'token', name: 'Токенист', per: '+15% токенов', max: 20, base: 40, inc: 25, glyph: '✦' },
  {
    id: 'key',
    name: 'Ключник',
    per: '+0,05% найти ключ',
    max: 20,
    base: 65,
    inc: 40,
    glyph: '⚿',
  },
  {
    id: 'frenzy',
    name: 'Кураж',
    per: '+0,08% впасть в кураж',
    max: 15,
    base: 130,
    inc: 80,
    glyph: '✺',
  },
];

export const enchantOf = (id: EnchantId): Enchant => ENCHANTS.find((e) => e.id === id)!;

export type Enchants = Record<EnchantId, number>;

export const NO_ENCHANTS: Enchants = {
  power: 0,
  fortune: 0,
  vein: 0,
  blast: 0,
  hammer: 0,
  token: 0,
  key: 0,
  frenzy: 0,
};

/** Цена следующего уровня (с уровня `level` на `level + 1`). */
export function enchantCost(id: EnchantId, level: number): number {
  const e = enchantOf(id);
  return e.base + e.inc * level;
}

/** Сколько вернёт сброс: половина всего, что ушло на уровни. */
export function enchantRefund(id: EnchantId, level: number): number {
  let sum = 0;
  for (let i = 0; i < level; i++) sum += enchantCost(id, i);
  return Math.floor(sum / 2);
}

/** Базовые шансы с одного блока — до зачарований и перков. */
export const TOKEN_CHANCE = 0.05;
export const TOKEN_MIN = 1;
export const TOKEN_MAX = 3;
export const KEY_CHANCE = 0.0012;
/** Кураж: столько длится и во сколько раз больше добычи и быстрее удар. */
export const FRENZY_MS = 15_000;
export const FRENZY_LOOT = 2;
export const FRENZY_RATE = 1.5;
/** Энергетик — вдвое быстрее кирка; лупа — видно ярус ниже. */
export const ENERGY_MS = 60_000;
export const ENERGY_RATE = 2;
export const LENS_MS = 90_000;

/** Сколько лишних блоков в среднем даёт срабатывание (для темпа). */
export const VEIN_EXTRA = 1.3;
export const BLAST_EXTRA = 7;
export const HAMMER_EXTRA = 55;

/** Всё, что меняют зачарования, престиж, перки и коллекция, — в одном месте. */
export interface Mods {
  dmg: number;
  rate: number;
  sell: number;
  /** Ожидаемые лишние блоки добычи с одного сломанного. */
  fortune: number;
  vein: number;
  /** Сколько блоков жилы максимум уйдёт вместе с первым. */
  veinMax: number;
  blast: number;
  hammer: number;
  frenzy: number;
  tokenChance: number;
  keyChance: number;
  findChance: number;
}

export const BASE_MODS: Mods = {
  dmg: 1,
  rate: 1,
  sell: 1,
  fortune: 0,
  vein: 0,
  veinMax: 0,
  blast: 0,
  hammer: 0,
  frenzy: 0,
  tokenChance: TOKEN_CHANCE,
  keyChance: KEY_CHANCE,
  findChance: 0,
};

export function modsOf(p: {
  ench: Enchants;
  prestige: number;
  perks?: Perks;
  finds?: Finds;
}): Mods {
  const e = p.ench;
  const k = p.perks ?? NO_PERKS;
  const nose = 1 + 0.2 * k.nose;
  return {
    dmg: 1 + 0.1 * e.power,
    rate: 1 + 0.08 * k.grip,
    sell: sellMult(p.prestige) * (1 + 0.06 * k.dealer) * findsMult(p.finds ?? {}),
    fortune: 0.06 * e.fortune,
    vein: 0.025 * e.vein,
    veinMax: 3 + Math.floor(e.vein / 4),
    blast: 0.01 * e.blast,
    hammer: 0.002 * e.hammer,
    frenzy: 0.0008 * e.frenzy,
    tokenChance: TOKEN_CHANCE * (1 + 0.15 * e.token) * (1 + 0.1 * k.lucky),
    keyChance: (KEY_CHANCE + 0.0005 * e.key) * nose,
    findChance: FIND_CHANCE * nose,
  };
}

export interface Drops {
  /** Порода каждой единицы добычи (с учётом Удачи и Куража). */
  units: number[];
  tokens: number;
  keys: number;
  finds: FindId[];
}

/** Бросок добычи за сломанные блоки. Чистая функция: `rnd` передаёт вызвавший. */
export function rollDrops(
  rocks: number[],
  m: Mods,
  rnd: () => number,
  opts: { frenzy?: boolean; mine?: number } = {},
): Drops {
  const units: number[] = [];
  let tokens = 0;
  let keys = 0;
  const finds: FindId[] = [];
  const whole = Math.floor(m.fortune);
  const frac = m.fortune - whole;
  for (const rock of rocks) {
    let n = 1 + whole + (rnd() < frac ? 1 : 0);
    if (opts.frenzy) n *= FRENZY_LOOT;
    for (let i = 0; i < n; i++) units.push(rock);
    if (rnd() < m.tokenChance)
      tokens += TOKEN_MIN + Math.floor(rnd() * (TOKEN_MAX - TOKEN_MIN + 1));
    if (rnd() < m.keyChance) keys += 1;
    if (m.findChance > 0 && rnd() < m.findChance) {
      const f = rollFind(opts.mine ?? LAST_RANK, rnd);
      if (f) finds.push(f);
    }
  }
  return { units, tokens, keys, finds };
}

// ---------------------------------------------------------------------------
// Расходники: за токены в лавке, позже — из сундуков.
// ---------------------------------------------------------------------------

export type ItemId = 'bomb3' | 'bomb5' | 'charge' | 'energy' | 'lens';

export interface Item {
  id: ItemId;
  name: string;
  text: string;
  glyph: string;
  /** Цена в лавке, токенов. */
  price: number;
}

export const ITEMS: Item[] = [
  { id: 'bomb3', name: 'Бомба', text: 'Сносит 3×3 на ярус', glyph: '💣', price: 25 },
  { id: 'bomb5', name: 'Динамит', text: 'Сносит 5×5 на ярус', glyph: '🧨', price: 70 },
  { id: 'charge', name: 'Заряд', text: 'Снимает весь верхний ярус', glyph: '💥', price: 180 },
  { id: 'energy', name: 'Энергетик', text: 'Кирка вдвое быстрее минуту', glyph: '⚡', price: 40 },
  { id: 'lens', name: 'Лупа', text: 'Полторы минуты видно ярус ниже', glyph: '🔍', price: 20 },
];

export const itemOf = (id: ItemId): Item => ITEMS.find((i) => i.id === id)!;

export type Items = Record<ItemId, number>;

export const NO_ITEMS: Items = { bomb3: 0, bomb5: 0, charge: 0, energy: 0, lens: 0 };

/** Клетки, которые снесёт бомба радиуса `r` с центром в `cell`. */
export function blastCells(cell: number, r: number): number[] {
  const cx = cell % MINE_COLS;
  const cy = Math.floor(cell / MINE_COLS);
  const out: number[] = [];
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (x >= 0 && y >= 0 && x < MINE_COLS && y < MINE_ROWS) out.push(y * MINE_COLS + x);
  return out;
}

/**
 * Жила от клетки `cell`: соседи (по стороне), у которых СВЕРХУ та же
 * порода, — обход в ширину, не больше `max` клеток сверх первой.
 */
export function veinCells(
  rocks: number[],
  dug: number[],
  cell: number,
  rock: number,
  max: number,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>([cell]);
  const queue = [cell];
  while (queue.length && out.length < max) {
    const c = queue.shift()!;
    const x = c % MINE_COLS;
    const y = Math.floor(c / MINE_COLS);
    const nb = [
      x > 0 ? c - 1 : -1,
      x < MINE_COLS - 1 ? c + 1 : -1,
      y > 0 ? c - MINE_COLS : -1,
      y < MINE_ROWS - 1 ? c + MINE_COLS : -1,
    ];
    for (const n of nb) {
      if (n < 0 || seen.has(n)) continue;
      seen.add(n);
      if (rockAt(rocks, n, dug[n]) !== rock) continue;
      out.push(n);
      queue.push(n);
      if (out.length >= max) break;
    }
  }
  return out;
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

/** Сколько блоков в среднем ломается за удар, который сломал один. */
export function extraBlocks(m: Mods): number {
  return m.vein * VEIN_EXTRA + m.blast * BLAST_EXTRA + m.hammer * HAMMER_EXTRA;
}

/**
 * Средний доход шахты, монет в секунду, на удержании. Считает и зачарования:
 * урон от Силы, лишние блоки от жил и взрывов, лишнюю добычу от Удачи.
 */
export function incomeRate(mine: number, pick: number, sharp: number, m: Mods = BASE_MODS): number {
  return blockRate(mine, pick, sharp, m) * (1 + m.fortune) * avgValue(mine) * m.sell;
}

/** Средняя цена блока шахты по всем ярусам. */
export function avgValue(mine: number): number {
  let value = 0;
  for (let d = 0; d < DEPTH; d++) {
    for (const s of mineMix(mine)) {
      const up = s.rock < mine ? DEPTH_BOOST[d] : 0;
      value += (s.share * (1 - up) * ROCKS[s.rock].value) / DEPTH;
      if (up > 0) value += (s.share * up * ROCKS[s.rock + 1].value) / DEPTH;
    }
  }
  return value;
}

/** Сколько блоков в секунду ломает кирка на удержании. */
export function blockRate(mine: number, pick: number, sharp: number, m: Mods = BASE_MODS): number {
  const dmg = hitDamage(pick, sharp) * m.dmg;
  const rate = PICKS[pick].rate * m.rate;
  // Средний блок по всем ярусам — с учётом того, что глубже порода новее.
  let hits = 0;
  for (let d = 0; d < DEPTH; d++) {
    for (const s of mineMix(mine)) {
      const up = s.rock < mine ? DEPTH_BOOST[d] : 0;
      hits += (s.share * (1 - up) * hitsFor(s.rock, dmg)) / DEPTH;
      if (up > 0) hits += (s.share * up * hitsFor(s.rock + 1, dmg)) / DEPTH;
    }
  }
  return (rate / hits) * (1 + extraBlocks(m));
}

// ---------------------------------------------------------------------------
// Находки. Редкий дроп поверх породы, как коллекции на VimeWorld и
// DiamondWorld: каждая новая находка навсегда прибавляет 1% к продаже, полная
// коллекция — ещё 10%. Дубликат не пропадает: его сдают за токены. Находки
// открываются по мере спуска — в шахте A не найдёшь лампу забойщика.
// ---------------------------------------------------------------------------

export type FindId =
  | 'coin'
  | 'key'
  | 'fern'
  | 'ammonite'
  | 'trilobite'
  | 'nugget'
  | 'tooth'
  | 'geode'
  | 'amber'
  | 'medal'
  | 'core'
  | 'lamp';

export interface Find {
  id: FindId;
  name: string;
  /** С какой шахты попадается. */
  from: number;
  /** Вес среди доступных: ранние находки чаще. */
  weight: number;
  text: string;
}

export const FINDS: Find[] = [
  { id: 'coin', name: 'Старая монета', from: 0, weight: 10, text: 'Копейка 1799 года' },
  { id: 'key', name: 'Ключ от камеры', from: 2, weight: 9, text: 'Ржавый, но ещё поворачивается' },
  { id: 'fern', name: 'Отпечаток папоротника', from: 4, weight: 8, text: 'Каменноугольный период' },
  { id: 'ammonite', name: 'Аммонит', from: 6, weight: 7, text: 'Раковина, закрученная спиралью' },
  { id: 'trilobite', name: 'Трилобит', from: 8, weight: 6, text: 'Ему полмиллиарда лет' },
  { id: 'nugget', name: 'Самородок', from: 10, weight: 5, text: 'Золото без примесей' },
  { id: 'tooth', name: 'Зуб мамонта', from: 12, weight: 4, text: 'Вечная мерзлота сохранила' },
  { id: 'geode', name: 'Жеода', from: 14, weight: 3.5, text: 'Снаружи камень, внутри аметист' },
  {
    id: 'amber',
    name: 'Янтарь с мушкой',
    from: 16,
    weight: 3,
    text: 'Муха застыла сорок миллионов лет назад',
  },
  { id: 'medal', name: 'Царская медаль', from: 18, weight: 2.5, text: '«За усердие»' },
  {
    id: 'core',
    name: 'Керн Кольской сверхглубокой',
    from: 20,
    weight: 2,
    text: 'С глубины двенадцать километров',
  },
  { id: 'lamp', name: 'Лампа первого забойщика', from: 23, weight: 1.5, text: 'Горит до сих пор' },
];

export type Finds = Partial<Record<FindId, number>>;

/** Шанс находки с блока: одна на две с половиной тысячи. */
export const FIND_CHANCE = 0.0004;
/** Токены за дубликат. */
export const FIND_DUP_TOKENS = 40;

export const findOf = (id: FindId): Find => FINDS.find((f) => f.id === id)!;

/** Какая находка выпала в шахте `mine` (или null, если доступных нет). */
export function rollFind(mine: number, rnd: () => number): FindId | null {
  const pool = FINDS.filter((f) => f.from <= mine);
  if (!pool.length) return null;
  const total = pool.reduce((s, f) => s + f.weight, 0);
  let x = rnd() * total;
  for (const f of pool) {
    x -= f.weight;
    if (x <= 0) return f.id;
  }
  return pool[pool.length - 1].id;
}

export function findsFound(finds: Finds): number {
  return FINDS.filter((f) => (finds[f.id] ?? 0) > 0).length;
}

/** Бонус коллекции к продаже. */
export function findsMult(finds: Finds): number {
  const n = findsFound(finds);
  return 1 + 0.01 * n + (n === FINDS.length ? 0.1 : 0);
}

// ---------------------------------------------------------------------------
// Ключи и сундуки. Ключ падает с блока (Ключник поднимает шанс), даётся за
// каждый ранг и пачкой за престиж. Сундук крутит ленту наград: четыре
// ступени редкости, награда в монетах — доля цены текущего ранга, поэтому
// сундук одинаково приятен на ранге C и на ранге X.
// ---------------------------------------------------------------------------

export type CaseTier = 'common' | 'rare' | 'epic' | 'legend';

export interface CaseTierDef {
  id: CaseTier;
  name: string;
  weight: number;
  color: string;
  /** Вес события для звука и вспышки (как у выигрышей автоматов). */
  beats: number;
}

export const CASE_TIERS: CaseTierDef[] = [
  { id: 'common', name: 'Обычное', weight: 58, color: '#9aa7b4', beats: 0 },
  { id: 'rare', name: 'Редкое', weight: 30, color: '#4f8cff', beats: 1 },
  { id: 'epic', name: 'Эпическое', weight: 10, color: '#b36cff', beats: 2 },
  { id: 'legend', name: 'Легенда', weight: 2, color: '#ffb020', beats: 4 },
];

export type Reward =
  | { kind: 'coins'; amount: number }
  | { kind: 'tokens'; amount: number }
  | { kind: 'item'; id: ItemId; amount: number }
  | { kind: 'find'; id: FindId };

export interface CaseRoll {
  tier: CaseTier;
  reward: Reward;
}

type Slot = { w: number; make: (rnd: () => number, rank: number, prestige: number) => Reward };

const coins = (lo: number, hi: number) => (rnd: () => number, rank: number, prestige: number) =>
  ({
    kind: 'coins',
    amount: nice(rankCost(Math.min(rank, LAST_RANK - 1), prestige) * (lo + (hi - lo) * rnd())),
  }) as Reward;
const tokens = (lo: number, hi: number) => (rnd: () => number) =>
  ({ kind: 'tokens', amount: Math.round(lo + (hi - lo) * rnd()) }) as Reward;
const item = (id: ItemId, amount: number) => () => ({ kind: 'item', id, amount }) as Reward;
const FIND_SLOT = () => ({ kind: 'find', id: 'coin' }) as Reward;

const CASE_TABLE: Record<CaseTier, Slot[]> = {
  common: [
    { w: 35, make: coins(0.04, 0.08) },
    { w: 35, make: tokens(15, 40) },
    { w: 10, make: item('energy', 1) },
    { w: 10, make: item('lens', 1) },
    { w: 10, make: item('bomb3', 1) },
  ],
  rare: [
    { w: 30, make: coins(0.1, 0.18) },
    { w: 30, make: tokens(50, 120) },
    { w: 15, make: item('bomb3', 2) },
    { w: 10, make: item('energy', 2) },
    { w: 15, make: item('bomb5', 1) },
  ],
  epic: [
    { w: 30, make: coins(0.3, 0.45) },
    { w: 25, make: tokens(150, 300) },
    { w: 15, make: item('charge', 1) },
    { w: 10, make: item('bomb5', 2) },
    { w: 20, make: FIND_SLOT },
  ],
  legend: [
    { w: 35, make: coins(0.9, 1.3) },
    { w: 25, make: tokens(500, 800) },
    { w: 15, make: item('charge', 2) },
    { w: 25, make: FIND_SLOT },
  ],
};

function pickWeighted<T extends { w: number }>(list: T[], rnd: () => number): T {
  const total = list.reduce((s, x) => s + x.w, 0);
  let x = rnd() * total;
  for (const it of list) {
    x -= it.w;
    if (x <= 0) return it;
  }
  return list[list.length - 1];
}

/**
 * Что лежит в сундуке. Находка в сундуке — только НЕДОСТАЮЩАЯ из доступных
 * по шахте; если таких нет, вместо неё токены.
 */
export function rollCase(
  p: { rank: number; prestige: number; finds: Finds },
  rnd: () => number,
): CaseRoll {
  const tier = pickWeighted(
    CASE_TIERS.map((t) => ({ ...t, w: t.weight })),
    rnd,
  ).id;
  let reward = pickWeighted(CASE_TABLE[tier], rnd).make(rnd, p.rank, p.prestige);
  if (reward.kind === 'find') {
    const missing = FINDS.filter((f) => f.from <= p.rank && !(p.finds[f.id] ?? 0));
    reward = missing.length
      ? { kind: 'find', id: missing[Math.floor(rnd() * missing.length)].id }
      : { kind: 'tokens', amount: tier === 'legend' ? 600 : 250 };
  }
  return { tier, reward };
}

/** Средняя выплата монетами за сундук в долях цены ранга — для теста. */
export function caseCoinShare(): number {
  const total = CASE_TIERS.reduce((s, t) => s + t.weight, 0);
  const ranges: Record<CaseTier, [number, number, number]> = {
    common: [35, 0.04, 0.08],
    rare: [30, 0.1, 0.18],
    epic: [30, 0.3, 0.45],
    legend: [35, 0.9, 1.3],
  };
  let ev = 0;
  for (const t of CASE_TIERS) {
    const slots = CASE_TABLE[t.id].reduce((s, x) => s + x.w, 0);
    const [w, lo, hi] = ranges[t.id];
    ev += (t.weight / total) * (w / slots) * ((lo + hi) / 2);
  }
  return ev;
}

/** Ключей за новый ранг и за престиж. */
export const RANK_KEYS = 1;
export const PRESTIGE_KEYS = 5;

// ---------------------------------------------------------------------------
// Бригада — автошахтёр. Копает в лучшей открытой шахте, пока тебя нет, и
// копит добычу до потолка: восемь часов (перк — до двенадцати). Для вахты это
// главное: зашёл после смены — забрал. Считается при входе, сервер не нужен.
// Бригада берёт долю: отдаёт 60% цены добытого.
// ---------------------------------------------------------------------------

export const CREW_MAX = 6;
export const CREW_CAP_H = 8;
export const CREW_SHARE = 0.6;

/** Блоков в минуту у бригады уровня `level`. */
export function crewRate(level: number): number {
  return level > 0 ? 2 * Math.pow(level, 1.4) : 0;
}

/** Цена следующего уровня бригады (нанять — это уровень 1). */
export function crewCost(level: number): number {
  return nice(5000 * Math.pow(2.6, level));
}

export function crewCapHours(p: { perks: Perks }): number {
  return CREW_CAP_H + p.perks.shift;
}

export interface CrewYield {
  minutes: number;
  blocks: number;
  coins: number;
  tokens: number;
  /** Потолок уже достигнут — бригада стоит. */
  capped: boolean;
}

/** Что бригада накопила к моменту `now`. */
export function crewYield(p: PrisonState, now: number): CrewYield {
  if (!p.crew || !p.crewFrom) return { minutes: 0, blocks: 0, coins: 0, tokens: 0, capped: false };
  const cap = crewCapHours(p) * 60;
  const raw = Math.max(0, (now - p.crewFrom) / 60000);
  const minutes = Math.min(cap, raw);
  const blocks = Math.floor(crewRate(p.crew) * minutes);
  const m = modsOf(p);
  return {
    minutes,
    blocks,
    coins: Math.round(blocks * avgValue(p.rank) * CREW_SHARE * m.sell),
    tokens: Math.round(blocks * m.tokenChance),
    capped: raw >= cap,
  };
}

// ---------------------------------------------------------------------------
// Перки — дерево престижа. Очки: два за каждый престиж. Сброс бесплатный:
// перки — это выбор стиля игры, а не вложение, за которое страшно.
// ---------------------------------------------------------------------------

export type PerkId = 'dealer' | 'grip' | 'lucky' | 'shift' | 'blat' | 'nose';

export interface Perk {
  id: PerkId;
  name: string;
  per: string;
  max: number;
}

export const PERKS: Perk[] = [
  { id: 'dealer', name: 'Скупщик', per: '+6% к продаже', max: 5 },
  { id: 'grip', name: 'Хватка', per: '+8% к скорости кирки', max: 5 },
  { id: 'lucky', name: 'Везунчик', per: '+10% токенов', max: 5 },
  { id: 'nose', name: 'Нюх', per: '+20% ключей и находок', max: 5 },
  { id: 'shift', name: 'Длинная смена', per: '+1 час бригаде', max: 4 },
  { id: 'blat', name: 'Блат', per: 'после престижа — на ранг выше', max: 3 },
];

export type Perks = Record<PerkId, number>;

export const NO_PERKS: Perks = { dealer: 0, grip: 0, lucky: 0, nose: 0, shift: 0, blat: 0 };

export const PERK_POINTS_PER_PRESTIGE = 2;

export function perkPointsFree(p: { prestige: number; perks: Perks }): number {
  const spent = PERKS.reduce((s, k) => s + p.perks[k.id], 0);
  return p.prestige * PERK_POINTS_PER_PRESTIGE - spent;
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
  tokens: number;
  ench: Enchants;
  items: Items;
  /** До какого времени действуют энергетик, лупа и кураж (мс эпохи). */
  energyUntil: number;
  lensUntil: number;
  frenzyUntil: number;
  keys: number;
  /** Коллекция: сколько экземпляров каждой находки нашлось. */
  finds: Finds;
  /** Бригада: уровень и с какого момента она копит добычу. */
  crew: number;
  crewFrom: number;
  perks: Perks;
  /** Открыто сундуков — для статистики. */
  cases: number;
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
  tokens: 0,
  ench: NO_ENCHANTS,
  items: NO_ITEMS,
  energyUntil: 0,
  lensUntil: 0,
  frenzyUntil: 0,
  keys: 0,
  finds: {},
  crew: 0,
  crewFrom: 0,
  perks: NO_PERKS,
  cases: 0,
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
    tokens: int(raw.tokens, 0, 1e12, 0),
    ench: Object.fromEntries(
      ENCHANTS.map((e) => [e.id, int(raw.ench?.[e.id], 0, e.max, 0)]),
    ) as Enchants,
    items: Object.fromEntries(ITEMS.map((i) => [i.id, int(raw.items?.[i.id], 0, 1e6, 0)])) as Items,
    energyUntil: int(raw.energyUntil, 0, 1e14, 0),
    lensUntil: int(raw.lensUntil, 0, 1e14, 0),
    frenzyUntil: int(raw.frenzyUntil, 0, 1e14, 0),
    keys: int(raw.keys, 0, 1e7, 0),
    finds: Object.fromEntries(
      FINDS.map((f) => [f.id, int(raw.finds?.[f.id], 0, 1e6, 0)]).filter(([, n]) => n),
    ) as Finds,
    crew: int(raw.crew, 0, CREW_MAX, 0),
    crewFrom: int(raw.crewFrom, 0, 1e14, 0),
    perks: Object.fromEntries(
      PERKS.map((k) => [k.id, int(raw.perks?.[k.id], 0, k.max, 0)]),
    ) as Perks,
    cases: int(raw.cases, 0, 1e9, 0),
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
