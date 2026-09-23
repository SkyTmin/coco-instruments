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

// ---------------------------------------------------------------------------
// Сейд-камень — священный камень саамов, самая редкая вещь в шахте. На поле
// их 0, 1 или 2, и лежат они только в глубине: сверху не видно, находит лупа
// или случай. Бьётся не уроном, а УДАРАМИ — сколько бы ни била кирка, нужно
// несколько попаданий (крит считается за два). Взрывы, жилы и отбойник его не
// берут: иначе редкость уходила бы сама, мимо рук. Платит токенами — их на
// каторге добывать тяжелее всего — и монетами в общий кошелёк.
// ---------------------------------------------------------------------------

export const SEID_HITS = 4;
/** Сколько сейдов на поле: 0 — в 70% шахт, 1 — в 25%, 2 — в 5%. */
const SEID_ODDS = [0.7, 0.95];

export interface Seid {
  cell: number;
  depth: number;
}

/** Где лежат сейды шахты: из того же зерна, что и порода. */
export function seidsOf(mine: number, seed: number): Seid[] {
  const rnd = rng32(seed * 131 + mine * 17 + 7);
  const x = rnd();
  const n = x < SEID_ODDS[0] ? 0 : x < SEID_ODDS[1] ? 1 : 2;
  const out: Seid[] = [];
  while (out.length < n) {
    const cell = Math.floor(rnd() * MINE_CELLS);
    const depth = 1 + Math.floor(rnd() * (DEPTH - 1));
    if (!out.some((s) => s.cell === cell)) out.push({ cell, depth });
  }
  return out;
}

/** Сверху клетки сейчас сейд. */
export function seidTop(seids: Seid[], cell: number, dug: number): boolean {
  return seids.some((s) => s.cell === cell && s.depth === dug);
}

/** Награда за сейд: токены растут с рангом, монеты — доля цены ранга. */
export function seidReward(rank: number, prestige: number): { tokens: number; coins: number } {
  return {
    tokens: 30 + 6 * rank,
    coins: nice(rankCost(Math.min(rank, LAST_RANK - 1), prestige) * 0.05),
  };
}

/** Средний выход сейдов на один блок шахты — для теста темпа. */
export function seidPerBlock(): number {
  const mean = 1 * (SEID_ODDS[1] - SEID_ODDS[0]) + 2 * (1 - SEID_ODDS[1]);
  return mean / (MINE_CELLS * DEPTH * MINE_RESET_AT);
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
export const RANK_GROWTH = 1.37;
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
  | 'frenzy'
  | 'crack'
  | 'beam'
  | 'reforge'
  | 'rockfall'
  | 'echo';

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
  // Пять чар v2.49 — с серверов (X-Prison, Cosmic), под нашу сетку 7×9.
  {
    id: 'crack',
    name: 'Трещина',
    per: '+2% ударить и по соседям',
    max: 20,
    base: 60,
    inc: 35,
    glyph: '╳',
  },
  {
    id: 'beam',
    name: 'Луч',
    per: '+0,6% снести весь ряд',
    max: 15,
    base: 110,
    inc: 70,
    glyph: '═',
  },
  {
    id: 'reforge',
    name: 'Перековка',
    per: '+1,5% блоку стать породой выше',
    max: 20,
    base: 90,
    inc: 60,
    glyph: '⚙',
  },
  {
    id: 'rockfall',
    name: 'Камнепад',
    per: '+0,15% обрушить град взрывов',
    max: 15,
    base: 260,
    inc: 140,
    glyph: '☄',
  },
  {
    id: 'echo',
    name: 'Эхо',
    per: '+5% к шансам чар поля',
    max: 20,
    base: 200,
    inc: 120,
    glyph: '◎',
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
  crack: 0,
  beam: 0,
  reforge: 0,
  rockfall: 0,
  echo: 0,
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
/** Луч — ряд из семи клеток; камнепад — четыре взрыва 3×3 внахлёст. */
export const BEAM_EXTRA = 5;
export const ROCKFALL_EXTRA = 24;
/** Трещина бьёт четырёх соседей одним ударом: ломается в среднем один. */
export const CRACK_EXTRA = 1.2;
/** Камнепад: сколько взрывов и через сколько мс друг за другом. */
export const ROCKFALL_HITS = 4;

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
  crack: number;
  beam: number;
  rockfall: number;
  /** Шанс, что сломанный блок засчитается породой выше (Перековка). */
  reforge: number;
  tokenChance: number;
  keyChance: number;
  findChance: number;
  parcelChance: number;
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
  crack: 0,
  beam: 0,
  rockfall: 0,
  reforge: 0,
  tokenChance: TOKEN_CHANCE,
  keyChance: KEY_CHANCE,
  findChance: 0,
  parcelChance: 0,
};

/** Что нужно `modsOf` из состояния: всё необязательное — для тестов и темпа. */
export interface ModsSource {
  ench: Enchants;
  prestige: number;
  perks?: Perks;
  finds?: Finds;
  pickXp?: number;
  off?: EnchantId[];
  runes?: Rune[];
  sockets?: number[];
  pet?: PetId | null;
  pets?: Pets;
  miles?: string[];
}

export function modsOf(p: ModsSource): Mods {
  // Отключённая чара (игрок выключил её в мастерской) не срабатывает, но и
  // не теряет уровни: включил — и она снова в деле.
  const off = p.off ?? [];
  const lv = (id: EnchantId) => (off.includes(id) ? 0 : (p.ench[id] ?? 0));
  const k = p.perks ?? NO_PERKS;
  const nose = 1 + 0.2 * k.nose;
  const level = pickLevelOf(p.pickXp ?? 0).level;
  // Руны и питомец — прибавки v2.49. Складываются между собой и упираются
  // в потолок (`BONUS_CAP`): иначе к концу игры шахта печатала бы деньги, и
  // ставка в автоматах стала бы мелочью, ради которой незачем крутить.
  const b = bonusOf(p);
  // Эхо и руна Совило множат шансы чар поля: жилы, взрыва, отбойника, луча,
  // камнепада и трещины. Перековку не трогают — она про цену, а не про поле.
  const proc = (1 + 0.05 * lv('echo')) * (1 + b.proc);
  return {
    // Сноровка: каждый уровень кирки — ещё полпроцента к урону.
    dmg: (1 + 0.1 * lv('power')) * (1 + PICK_LEVEL_DMG * (level - 1)) * (1 + b.dmg),
    rate: (1 + 0.08 * k.grip) * (1 + b.rate),
    sell: sellMult(p.prestige) * (1 + 0.06 * k.dealer) * findsMult(p.finds ?? {}) * (1 + b.sell),
    fortune: 0.06 * lv('fortune') + b.loot,
    vein: 0.025 * lv('vein') * proc,
    veinMax: 3 + Math.floor(lv('vein') / 4),
    blast: 0.01 * lv('blast') * proc,
    hammer: 0.002 * lv('hammer') * proc,
    frenzy: 0.0008 * lv('frenzy'),
    crack: 0.02 * lv('crack') * proc,
    beam: 0.006 * lv('beam') * proc,
    rockfall: 0.0015 * lv('rockfall') * proc,
    reforge: 0.015 * lv('reforge'),
    tokenChance: TOKEN_CHANCE * (1 + 0.15 * lv('token')) * (1 + 0.1 * k.lucky) * (1 + b.token),
    keyChance: (KEY_CHANCE + 0.0005 * lv('key')) * nose * (1 + b.luck),
    findChance: FIND_CHANCE * nose * (1 + b.luck),
    parcelChance: PARCEL_CHANCE * nose * (1 + b.luck),
  };
}

/** Целое число с вероятностным остатком: 2,3 → 2 или 3 (с шансом 30%). */
function rollCount(x: number, rnd: () => number): number {
  const whole = Math.floor(x);
  return whole + (rnd() < x - whole ? 1 : 0);
}

export interface Drops {
  /** Порода каждой единицы добычи (с учётом Удачи и Куража). */
  units: number[];
  /** Порода каждого сломанного блока ПОСЛЕ перековки — она идёт в норму. */
  rocks: number[];
  /** Индексы блоков (в порядке `rocks`), которые перековались. */
  reforged: number[];
  tokens: number;
  keys: number;
  finds: FindId[];
  /** Выпавшие передачки — по редкости. */
  parcels: CaseTier[];
}

/** Бросок добычи за сломанные блоки. Чистая функция: `rnd` передаёт вызвавший. */
export function rollDrops(
  rocks: number[],
  m: Mods,
  rnd: () => number,
  opts: { frenzy?: boolean; mine?: number; streak?: number } = {},
): Drops {
  const units: number[] = [];
  const out: number[] = [];
  const reforged: number[] = [];
  let tokens = 0;
  let keys = 0;
  const finds: FindId[] = [];
  const parcels: CaseTier[] = [];
  const whole = Math.floor(m.fortune);
  const frac = m.fortune - whole;
  const streak = Math.max(0, opts.streak ?? 0);
  for (let i = 0; i < rocks.length; i++) {
    let rock = rocks[i];
    // Перековка: блок засчитывается породой выше — и в цене, и в норме.
    if (m.reforge > 0 && rock < LAST_RANK && rnd() < m.reforge) {
      rock += 1;
      reforged.push(i);
    }
    out.push(rock);
    let n = 1 + whole + (rnd() < frac ? 1 : 0);
    // Запал множит уже посчитанную Удачу: серия и чара складываются как
    // множители, а не как проценты.
    if (streak > 0) n = rollCount(n * (1 + streak), rnd);
    if (opts.frenzy) n *= FRENZY_LOOT;
    for (let i = 0; i < n; i++) units.push(rock);
    if (rnd() < m.tokenChance)
      tokens += TOKEN_MIN + Math.floor(rnd() * (TOKEN_MAX - TOKEN_MIN + 1));
    if (rnd() < m.keyChance) keys += 1;
    if (m.findChance > 0 && rnd() < m.findChance) {
      const f = rollFind(opts.mine ?? LAST_RANK, rnd);
      if (f) finds.push(f);
    }
    if (m.parcelChance > 0 && rnd() < m.parcelChance) parcels.push(rollTier(rnd));
  }
  return { units, rocks: out, reforged, tokens, keys, finds, parcels };
}

// ---------------------------------------------------------------------------
// Запал — серия копания, как Momentum на присон-серверах. Каждый сломанный
// блок подбрасывает счётчик, ступени дают прибавку к добыче. Перестал бить —
// через несколько секунд запал гаснет по ступени. Хранится только в странице:
// это награда за то, что ты копаешь СЕЙЧАС, её не накопить впрок.
//
// Ступени названы по-шахтёрски, и четвёртая не случайно «Стахановец»: норма
// выработки — главная механика рангов, а Стаханов вошёл в историю тем, что
// перекрыл её в четырнадцать раз.
// ---------------------------------------------------------------------------

export interface StreakTier {
  name: string;
  /** С какого счёта серии открывается ступень. */
  at: number;
  /** Прибавка к добыче: 0,25 — четверть блоков сверху. */
  loot: number;
}

export const STREAK_TIERS: StreakTier[] = [
  { name: 'Разогрев', at: 40, loot: 0.04 },
  { name: 'Раж', at: 150, loot: 0.1 },
  { name: 'В ударе', at: 400, loot: 0.18 },
  { name: 'Стахановец', at: 1000, loot: 0.28 },
  { name: 'Легенда забоя', at: 2500, loot: 0.4 },
];

/** Пауза, после которой запал начинает гаснуть, и шаг угасания. */
export const STREAK_GRACE_MS = 4000;
export const STREAK_DECAY_MS = 2500;

/** Номер ступени (−1 — запала нет). */
export function streakTier(streak: number): number {
  let t = -1;
  for (let i = 0; i < STREAK_TIERS.length; i++) if (streak >= STREAK_TIERS[i].at) t = i;
  return t;
}

export function streakLoot(streak: number): number {
  const t = streakTier(streak);
  return t < 0 ? 0 : STREAK_TIERS[t].loot;
}

/**
 * Серия после простоя `idleMs`. Первые STREAK_GRACE_MS ничего не теряется
 * (продать рюкзак и вернуться — не повод гасить), дальше каждые
 * STREAK_DECAY_MS — минус ступень, и счёт встаёт на её нижнюю границу.
 */
export function decayStreak(streak: number, idleMs: number): number {
  if (idleMs <= STREAK_GRACE_MS || streak <= 0) return streak;
  const steps = Math.floor((idleMs - STREAK_GRACE_MS) / STREAK_DECAY_MS) + 1;
  const t = streakTier(streak) - steps;
  return t >= 0 ? STREAK_TIERS[t].at : 0;
}

// ---------------------------------------------------------------------------
// Уровень кирки. Опыт — сломанные блоки (любые: удар, жила, взрыв). Уровень
// открывает чары по веткам (Отбойник не купишь с новенькой киркой) и
// поднимает их потолок; каждый уровень — ещё процент к урону. Так у каждого
// удара появляется смысл: даже мелкий блок двигает полоску.
// ---------------------------------------------------------------------------

export const PICK_LEVEL_MAX = 50;
export const PICK_LEVEL_DMG = 0.005;

/** Опыта, чтобы уйти с уровня `level` на следующий. */
export function pickXpFor(level: number): number {
  return Math.round(100 * Math.pow(1.13, level - 1));
}

export function pickLevelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  for (;;) {
    const need = pickXpFor(level);
    if (level >= PICK_LEVEL_MAX) return { level, into: 0, need: 0 };
    if (rest < need) return { level, into: rest, need };
    rest -= need;
    level += 1;
  }
}

/** С какого уровня кирки открывается чара. */
export const ENCHANT_UNLOCK: Record<EnchantId, number> = {
  power: 1,
  fortune: 1,
  token: 1,
  vein: 3,
  key: 5,
  crack: 6,
  blast: 8,
  beam: 10,
  frenzy: 12,
  reforge: 14,
  hammer: 18,
  rockfall: 22,
  echo: 26,
};

/** Потолок уровня чары при данном уровне кирки: к 40-му открыт весь. */
export function enchantCap(id: EnchantId, pickLevel: number): number {
  const e = enchantOf(id);
  if (pickLevel < ENCHANT_UNLOCK[id]) return 0;
  return Math.min(e.max, 3 + Math.floor((pickLevel * e.max) / 40));
}

/**
 * Чары, которые можно выключить, не сбрасывая: те, что меняют САМО копание
 * (ломают соседей, ускоряют кирку). Иногда нужен точный удар — например,
 * добрать норму в одном месте, не сметя всё вокруг.
 */
export const ENCHANT_TOGGLE: EnchantId[] = [
  'vein',
  'blast',
  'hammer',
  'frenzy',
  'crack',
  'beam',
  'rockfall',
];

/** Награда за новый уровень кирки: токены, а каждый пятый — ещё ключ. */
export function pickLevelReward(level: number): { tokens: number; keys: number } {
  return { tokens: 10 * level, keys: level % 5 === 0 ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// Норма выработки — как на русских присонах (VimeWorld, Mineland): для ранга
// мало денег, нужно ещё добыть определённые породы. Норма берёт самую новую,
// редкую породу шахты и ту, что перед ней. Из-за этого деньгами одними не
// обойтись: занос в автомате даёт монеты, а редкую породу надо выкопать —
// искать её на глубине, водить лупой.
//
// Но деньги общие, и в этом прикол игры — поэтому норму можно ОТКУПИТЬ.
// Цена откупа пропорциональна недобору: почти выполненная норма стоит
// копейки, нетронутая — больше половины цены ранга.
//
// Размер нормы не на глаз: тест темпа гоняет игрока, который копает
// вслепую, и проверяет, что к моменту, когда накоплены деньги, редкая
// порода у него добрана на две трети–полностью. Кто ищет её прицельно —
// успевает раньше.
// ---------------------------------------------------------------------------

export interface Quota {
  rock: number;
  n: number;
}

/** Доля породы `rock` среди всех блоков шахты `mine`, по всем ярусам. */
export function rockShare(mine: number, rock: number): number {
  let share = 0;
  for (let d = 0; d < DEPTH; d++) {
    for (const s of mineMix(mine)) {
      const up = s.rock < mine ? DEPTH_BOOST[d] : 0;
      if (s.rock === rock) share += (s.share * (1 - up)) / DEPTH;
      if (s.rock + 1 === rock && up > 0) share += (s.share * up) / DEPTH;
    }
  }
  return share;
}

/**
 * «Объём работы» ранга в блоках — сколько блоков нужно продать, чтобы
 * набрать его цену. Норма берёт долю от этого объёма. Удача и запал
 * множат ДОБЫЧУ, а норма считает БЛОКИ: деньги они ускоряют, норму — нет.
 * Так норма ощутима на любом ранге, а не только в начале.
 */
export const QUOTA_WORK = 1;
/**
 * Чары и запал множат добычу с блока, поэтому к концу круга на ранг нужно
 * всё меньше БЛОКОВ. Норма стареет с той же скоростью — иначе к рангу X
 * она тянула бы вдвое дольше денег, и слепое копание превращалось в стену.
 */
export const QUOTA_FADE = 1.021;
/** Норма на редкую породу чуть выше того, что даёт копание вслепую. */
export const QUOTA_NEW = 1.1;
export const QUOTA_OLD = 0.8;
/** Откуп всей нормы целиком — такая доля цены ранга. */
export const QUOTA_BUYOUT = 0.6;

/** Норма для перехода с ранга `rank` на следующий. */
export function rankQuota(rank: number, prestige = 0): Quota[] {
  const blocks =
    ((rankCost(rank, prestige) / avgValue(rank)) * QUOTA_WORK) / Math.pow(QUOTA_FADE, rank);
  if (rank === 0) return [{ rock: 0, n: nice(blocks * 0.5) }];
  return [
    { rock: rank, n: Math.max(5, nice(blocks * rockShare(rank, rank) * QUOTA_NEW)) },
    { rock: rank - 1, n: Math.max(10, nice(blocks * rockShare(rank, rank - 1) * QUOTA_OLD)) },
  ];
}

/** Сколько нормы выполнено, доля от 0 до 1 (среднее по строкам). */
export function quotaProgress(q: Quota[], counts: Record<number, number>): number {
  if (!q.length) return 1;
  return q.reduce((s, x) => s + Math.min(1, (counts[x.rock] ?? 0) / x.n), 0) / q.length;
}

export function quotaDone(q: Quota[], counts: Record<number, number>): boolean {
  return q.every((x) => (counts[x.rock] ?? 0) >= x.n);
}

/** Цена откупа оставшейся нормы. 0 — норма уже выполнена. */
export function quotaBuyout(
  rank: number,
  prestige: number,
  counts: Record<number, number>,
): number {
  const q = rankQuota(rank, prestige);
  const left = 1 - quotaProgress(q, counts);
  if (left <= 0) return 0;
  return Math.max(10, nice(rankCost(rank, prestige) * QUOTA_BUYOUT * left));
}

// ---------------------------------------------------------------------------
// Руны — как кристаллы Cosmic и руны VimeWorld. Три гнезда на кирке (четвёртое
// — за десятый престиж), шесть видов. Сила выпадает ВНУТРИ полосы ступени,
// поэтому две руны одной ступени не равны — есть что искать. Три руны одной
// ступени сплавляются в руну ступенью выше; вид берётся у той, которую
// сплавляешь, а сила не ниже средней из трёх: хорошие руны не пропадают.
//
// Руны названы по-настоящему (старший футарк), и смысл знака совпадает с
// действием: Феху — богатство, Уруз — сила, Райдо — дорога, Йера — урожай,
// Гебо — дар, Совило — солнце.
// ---------------------------------------------------------------------------

export type RuneKind = 'sell' | 'dmg' | 'rate' | 'loot' | 'token' | 'proc';

export interface RuneDef {
  id: RuneKind;
  name: string;
  /** Что даёт: «+4% к продаже». */
  text: string;
  /** Сколько даёт одна «единица» силы. */
  unit: number;
}

export const RUNES: RuneDef[] = [
  { id: 'sell', name: 'Феху', text: 'к продаже', unit: 0.016 },
  { id: 'dmg', name: 'Уруз', text: 'к урону', unit: 0.024 },
  { id: 'rate', name: 'Райдо', text: 'к скорости кирки', unit: 0.01 },
  { id: 'loot', name: 'Йера', text: 'к добыче', unit: 0.016 },
  { id: 'token', name: 'Гебо', text: 'к токенам', unit: 0.032 },
  { id: 'proc', name: 'Совило', text: 'к шансам чар поля', unit: 0.024 },
];

export const runeOf = (kind: RuneKind): RuneDef => RUNES.find((r) => r.id === kind)!;

export const RUNE_TIERS = 5;
/** Полоса силы каждой ступени, в единицах руны. */
export const RUNE_BAND: [number, number][] = [
  [1, 2],
  [2, 3.5],
  [3.5, 5.5],
  [5.5, 8],
  [8, 11],
];
/** Римские цифры ступеней — так руны подписаны на кирке. */
export const RUNE_ROMAN = ['I', 'II', 'III', 'IV', 'V'];
/** Сколько токенов даёт разбитая руна. */
export const RUNE_SHATTER = [8, 25, 70, 200, 600];
/** Мешочек для рун: лишние разбиваются сами. */
export const RUNE_BAG = 40;
/** С какого уровня кирки открывается гнездо. Четвёртое — веха «Престиж 10». */
export const SOCKET_UNLOCK = [5, 15, 30];
export const SOCKETS_MAX = 4;

export interface Rune {
  id: number;
  kind: RuneKind;
  /** Ступень 1…5. */
  tier: number;
  /** Где внутри полосы ступени: 0…100. */
  roll: number;
}

/** Сколько даёт руна: доля, 0,05 — пять процентов. */
export function runePower(r: { kind: RuneKind; tier: number; roll: number }): number {
  const [lo, hi] = RUNE_BAND[Math.max(1, Math.min(RUNE_TIERS, r.tier)) - 1];
  return runeOf(r.kind).unit * (lo + ((hi - lo) * r.roll) / 100);
}

/** Новая руна: вид случайный (если не задан), сила — внутри полосы. */
export function rollRune(
  tier: number,
  rnd: () => number,
  kind?: RuneKind,
  floor = 0,
): Omit<Rune, 'id'> {
  return {
    kind: kind ?? RUNES[Math.floor(rnd() * RUNES.length)].id,
    tier: Math.max(1, Math.min(RUNE_TIERS, tier)),
    roll: Math.max(Math.round(floor), Math.floor(rnd() * 101)),
  };
}

/** Сколько гнёзд открыто: по уровню кирки плюс веха «Престиж 10». */
export function socketsOpen(p: { pickXp: number; miles?: string[] }): number {
  const level = pickLevelOf(p.pickXp).level;
  return SOCKET_UNLOCK.filter((l) => level >= l).length + (p.miles?.includes('p10') ? 1 : 0);
}

/**
 * Сплавить руну `baseId` с двумя другими той же ступени. Берутся самые
 * слабые свободные (не в гнезде) — чтобы сплав не съел то, что носишь.
 */
export function fusePlan(
  runes: Rune[],
  sockets: number[],
  baseId: number,
): { base: Rune; with: Rune[] } | null {
  const base = runes.find((r) => r.id === baseId);
  if (!base || base.tier >= RUNE_TIERS) return null;
  const others = runes
    .filter((r) => r.id !== baseId && r.tier === base.tier && !sockets.includes(r.id))
    .sort((a, b) => runePower(a) - runePower(b));
  if (others.length < 2) return null;
  return { base, with: others.slice(0, 2) };
}

// ---------------------------------------------------------------------------
// Питомцы — кольская фауна. Растут, пока копаешь (опыт — сломанные блоки),
// с собой водишь одного. Каждый даёт одну прибавку, растущую с уровнем.
// Приходят из передачек; второй такой же — лакомство, опыт текущему.
// ---------------------------------------------------------------------------

export type PetId = 'lemming' | 'fox' | 'wolverine' | 'raven' | 'owl' | 'calf';

/** Что умеет питомец. `luck` — ключи, находки и передачки. */
export type PetStat = 'loot' | 'sell' | 'dmg' | 'token' | 'luck' | 'rate';

export interface PetDef {
  id: PetId;
  name: string;
  stat: PetStat;
  /** Прибавка за уровень. */
  per: number;
  text: string;
  lore: string;
}

export const PETS: PetDef[] = [
  {
    id: 'lemming',
    name: 'Лемминг',
    stat: 'loot',
    per: 0.012,
    text: 'к добыче',
    lore: 'Их в тундре тысячи, и все копают',
  },
  {
    id: 'fox',
    name: 'Песец',
    stat: 'sell',
    per: 0.01,
    text: 'к продаже',
    lore: 'Торгуется за каждый камешек',
  },
  {
    id: 'wolverine',
    name: 'Росомаха',
    stat: 'dmg',
    per: 0.02,
    text: 'к урону',
    lore: 'Грызёт мёрзлый гранит',
  },
  {
    id: 'raven',
    name: 'Ворон',
    stat: 'token',
    per: 0.03,
    text: 'к токенам',
    lore: 'Тащит всё, что блестит',
  },
  {
    id: 'owl',
    name: 'Полярная сова',
    stat: 'luck',
    per: 0.03,
    text: 'к ключам, находкам и передачкам',
    lore: 'Видит сквозь пургу',
  },
  {
    id: 'calf',
    name: 'Оленёнок',
    stat: 'rate',
    per: 0.008,
    text: 'к скорости кирки',
    lore: 'Тянет волокушу с рудой',
  },
];

export const petOf = (id: PetId): PetDef => PETS.find((x) => x.id === id)!;

/** Опыт каждого приручённого питомца. Нет ключа — не приручён. */
export type Pets = Partial<Record<PetId, number>>;

export const PET_LEVEL_MAX = 25;
/** Лакомство (второй такой же питомец) — опыт текущему. */
export const PET_TREAT_XP = 400;

export function petXpFor(level: number): number {
  return Math.round(150 * Math.pow(1.2, level - 1));
}

export function petLevelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  for (;;) {
    if (level >= PET_LEVEL_MAX) return { level, into: 0, need: 0 };
    const need = petXpFor(level);
    if (rest < need) return { level, into: rest, need };
    rest -= need;
    level += 1;
  }
}

/** Прибавка питомца на уровне `level`. */
export function petPower(id: PetId, level: number): number {
  return petOf(id).per * level;
}

// ---------------------------------------------------------------------------
// Потолок прибавок. Руны и питомец складываются по виду и упираются в
// потолок: общий кошелёк не переживёт шахту, которая к престижу печатает
// миллионы, — ставка 500 в автоматах перестала бы что-то значить.
// ---------------------------------------------------------------------------

export interface Bonus {
  sell: number;
  dmg: number;
  rate: number;
  loot: number;
  token: number;
  proc: number;
  luck: number;
}

export const NO_BONUS: Bonus = { sell: 0, dmg: 0, rate: 0, loot: 0, token: 0, proc: 0, luck: 0 };

export const BONUS_CAP: Bonus = {
  sell: 1,
  dmg: 1,
  rate: 0.5,
  loot: 1,
  token: 1.5,
  proc: 1,
  luck: 1,
};

/** Прибавки рун в гнёздах и питомца — уже с потолком. */
export function bonusOf(p: {
  runes?: Rune[];
  sockets?: number[];
  pet?: PetId | null;
  pets?: Pets;
}): Bonus {
  const b: Bonus = { ...NO_BONUS };
  const runes = p.runes ?? [];
  for (const id of p.sockets ?? []) {
    if (!id) continue;
    const r = runes.find((x) => x.id === id);
    if (r) b[r.kind] += runePower(r);
  }
  if (p.pet && p.pets && p.pets[p.pet] !== undefined) {
    const def = petOf(p.pet);
    b[def.stat] += petPower(p.pet, petLevelOf(p.pets[p.pet] ?? 0).level);
  }
  for (const k of Object.keys(b) as (keyof Bonus)[]) b[k] = Math.min(BONUS_CAP[k], b[k]);
  return b;
}

// ---------------------------------------------------------------------------
// Передачки — Lucky Blocks присон-серверов, по-нашему «передачка с воли».
// Падает с блока, ложится в одно из трёх мест и вскрывается, когда ты добудешь
// ещё N блоков: чем реже передачка, тем дольше ждать. Копятся все сразу.
// Главный источник рун и питомцев.
// ---------------------------------------------------------------------------

export interface Parcel {
  tier: CaseTier;
  /** Сколько блоков ещё добыть до вскрытия. */
  left: number;
}

export const PARCEL_SLOTS = 3;
/** Шанс передачки с блока: примерно одна на полторы тысячи. */
export const PARCEL_CHANCE = 0.0012;
export const PARCEL_NEED: Record<CaseTier, number> = {
  common: 150,
  rare: 400,
  epic: 900,
  legend: 2000,
};
/** Мест нет — передачку сдают за токены. */
export const PARCEL_OVERFLOW: Record<CaseTier, number> = {
  common: 10,
  rare: 25,
  epic: 60,
  legend: 150,
};

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
  return (
    m.vein * VEIN_EXTRA +
    m.blast * BLAST_EXTRA +
    m.hammer * HAMMER_EXTRA +
    m.beam * BEAM_EXTRA +
    m.rockfall * ROCKFALL_EXTRA +
    m.crack * CRACK_EXTRA
  );
}

/**
 * Средний доход шахты, монет в секунду, на удержании. Считает и зачарования:
 * урон от Силы, лишние блоки от жил и взрывов, лишнюю добычу от Удачи.
 */
export function incomeRate(mine: number, pick: number, sharp: number, m: Mods = BASE_MODS): number {
  // Перековка поднимает блок на породу выше — в среднем на шаг цены породы.
  const reforge = 1 + m.reforge * (VALUE_GROWTH - 1);
  return blockRate(mine, pick, sharp, m) * (1 + m.fortune) * avgValue(mine) * m.sell * reforge;
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
  | { kind: 'find'; id: FindId }
  | { kind: 'keys'; amount: number }
  | { kind: 'rune'; rune: Omit<Rune, 'id'> }
  | { kind: 'pet'; id: PetId }
  | { kind: 'treat'; amount: number };

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
/** Руна ступени `lo`, с шансом `pHi` — ступени `hi`. */
const rune = (lo: number, hi: number, pHi: number) => (rnd: () => number) =>
  ({ kind: 'rune', rune: rollRune(rnd() < pHi ? hi : lo, rnd) }) as Reward;
const keysOf = (amount: number) => () => ({ kind: 'keys', amount }) as Reward;
/** Место под питомца: кто именно — решается по тому, кого ещё нет. */
const PET_SLOT = () => ({ kind: 'pet', id: 'lemming' }) as Reward;

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
    { w: 12, make: rune(1, 2, 0.3) },
  ],
  epic: [
    { w: 30, make: coins(0.3, 0.45) },
    { w: 25, make: tokens(150, 300) },
    { w: 15, make: item('charge', 1) },
    { w: 10, make: item('bomb5', 2) },
    { w: 20, make: FIND_SLOT },
    { w: 15, make: rune(2, 3, 0.3) },
  ],
  legend: [
    { w: 35, make: coins(0.9, 1.3) },
    { w: 25, make: tokens(500, 800) },
    { w: 15, make: item('charge', 2) },
    { w: 25, make: FIND_SLOT },
    { w: 15, make: rune(3, 4, 0.3) },
  ],
};

/** Передачка: руны и питомцы — её главное, монеты и токены — подкладка. */
const PARCEL_TABLE: Record<CaseTier, Slot[]> = {
  common: [
    { w: 30, make: coins(0.03, 0.06) },
    { w: 30, make: tokens(15, 40) },
    { w: 25, make: rune(1, 1, 0) },
    { w: 5, make: item('bomb3', 1) },
    { w: 5, make: item('energy', 1) },
    { w: 5, make: item('lens', 1) },
  ],
  rare: [
    { w: 22, make: coins(0.08, 0.15) },
    { w: 22, make: tokens(50, 120) },
    { w: 32, make: rune(1, 2, 0.4) },
    { w: 12, make: keysOf(1) },
    { w: 12, make: PET_SLOT },
  ],
  epic: [
    { w: 18, make: coins(0.25, 0.4) },
    { w: 18, make: tokens(150, 300) },
    { w: 36, make: rune(2, 3, 0.4) },
    { w: 12, make: keysOf(2) },
    { w: 16, make: PET_SLOT },
  ],
  legend: [
    { w: 18, make: coins(0.8, 1.2) },
    { w: 14, make: tokens(400, 700) },
    { w: 40, make: rune(3, 4, 0.35) },
    { w: 28, make: PET_SLOT },
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
/** Редкость сундука или передачки. */
export function rollTier(rnd: () => number): CaseTier {
  return pickWeighted(
    CASE_TIERS.map((t) => ({ ...t, w: t.weight })),
    rnd,
  ).id;
}

/** Питомец из передачки: тот, кого ещё нет; все есть — лакомство текущему. */
function resolvePet(pets: Pets, tier: CaseTier, rnd: () => number): Reward {
  const missing = PETS.filter((x) => pets[x.id] === undefined);
  if (missing.length) return { kind: 'pet', id: missing[Math.floor(rnd() * missing.length)].id };
  const k = tier === 'legend' ? 3 : tier === 'epic' ? 2 : 1;
  return { kind: 'treat', amount: PET_TREAT_XP * k };
}

/** Что лежит в передачке редкости `tier`. */
export function rollParcel(
  p: { rank: number; prestige: number; pets: Pets },
  tier: CaseTier,
  rnd: () => number,
): Reward {
  const r = pickWeighted(PARCEL_TABLE[tier], rnd).make(rnd, p.rank, p.prestige);
  return r.kind === 'pet' ? resolvePet(p.pets, tier, rnd) : r;
}

export function rollCase(
  p: { rank: number; prestige: number; finds: Finds },
  rnd: () => number,
): CaseRoll {
  const tier = rollTier(rnd);
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
// Награда в состояние. Одна функция на сундук, передачку, веху и проводника:
// раньше каждая раздавала награды сама, и руна из сундука легла бы мимо
// мешочка. Монеты возвращаются отдельно — они идут в ОБЩИЙ кошелёк.
// ---------------------------------------------------------------------------

export interface Applied {
  p: PrisonState;
  coins: number;
  /** Руна не влезла в мешочек и разбилась на столько токенов. */
  shattered: number;
  /** Новый питомец пришёл (а не лакомство). */
  newPet: PetId | null;
}

export function applyReward(p: PrisonState, r: Reward): Applied {
  const out: Applied = { p, coins: 0, shattered: 0, newPet: null };
  switch (r.kind) {
    case 'coins':
      out.coins = r.amount;
      break;
    case 'tokens':
      out.p = { ...p, tokens: p.tokens + r.amount };
      break;
    case 'keys':
      out.p = { ...p, keys: p.keys + r.amount };
      break;
    case 'item':
      out.p = { ...p, items: { ...p.items, [r.id]: p.items[r.id] + r.amount } };
      break;
    case 'find':
      out.p = { ...p, finds: { ...p.finds, [r.id]: (p.finds[r.id] ?? 0) + 1 } };
      break;
    case 'rune':
      if (p.runes.length >= RUNE_BAG) {
        out.shattered = RUNE_SHATTER[r.rune.tier - 1];
        out.p = { ...p, tokens: p.tokens + out.shattered };
      } else {
        const id = p.runeSeq + 1;
        out.p = { ...p, runeSeq: id, runes: [...p.runes, { ...r.rune, id }] };
      }
      break;
    case 'pet':
      if (p.pets[r.id] !== undefined)
        return applyReward(p, { kind: 'treat', amount: PET_TREAT_XP });
      out.newPet = r.id;
      out.p = { ...p, pets: { ...p.pets, [r.id]: 0 }, pet: p.pet ?? r.id };
      break;
    case 'treat':
      out.p = p.pet
        ? { ...p, pets: { ...p.pets, [p.pet]: (p.pets[p.pet] ?? 0) + r.amount } }
        : { ...p, tokens: p.tokens + 50 };
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Вехи — разовые награды за большое: тысячи блоков, первый Z, престижи.
// На Mineland престиж без бонусов был неинтересен 99,9% игроков — поэтому
// 1-й, 5-й, 10-й и 20-й престиж дают весомое, а десятый — четвёртое гнездо
// для руны: такое не купишь ничем.
// ---------------------------------------------------------------------------

export interface MileReward {
  tokens?: number;
  keys?: number;
  /** Передачка вскрывается сразу — места под полем она не ждёт. */
  parcel?: CaseTier;
  /** Руна этой ступени, вид случайный. */
  rune?: number;
  /** Четвёртое гнездо для руны. */
  socket?: boolean;
}

export interface Mile {
  id: string;
  title: string;
  text: string;
  progress: (p: PrisonState) => [number, number];
  reward: MileReward;
}

const upToM = (v: number, goal: number): [number, number] => [Math.min(v, goal), goal];

export const MILES: Mile[] = [
  {
    id: 'b1k',
    title: 'Тысяча блоков',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e3),
    reward: { tokens: 50, parcel: 'common' },
  },
  {
    id: 'b10k',
    title: 'Десять тысяч',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e4),
    reward: { tokens: 200, keys: 2, parcel: 'rare' },
  },
  {
    id: 'b100k',
    title: 'Сто тысяч',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e5),
    reward: { tokens: 800, keys: 5, parcel: 'epic' },
  },
  {
    id: 'b1m',
    title: 'Миллион',
    text: 'Сломать своими руками',
    progress: (p) => upToM(p.mined, 1e6),
    reward: { tokens: 3000, keys: 10, parcel: 'legend', rune: 5 },
  },
  {
    id: 'z',
    title: 'Первый Z',
    text: 'Дойти до последнего ранга',
    progress: (p) => upToM(p.prestige > 0 ? LAST_RANK : p.rank, LAST_RANK),
    reward: { keys: 5, parcel: 'legend' },
  },
  {
    id: 'p1',
    title: 'Престиж 1',
    text: 'Начать второй срок',
    progress: (p) => upToM(p.prestige, 1),
    reward: { keys: 10, parcel: 'legend', rune: 3 },
  },
  {
    id: 'p5',
    title: 'Престиж 5',
    text: 'Пятый срок',
    progress: (p) => upToM(p.prestige, 5),
    reward: { keys: 15, rune: 4, tokens: 2000 },
  },
  {
    id: 'p10',
    title: 'Престиж 10',
    text: 'Четвёртое гнездо для руны',
    progress: (p) => upToM(p.prestige, 10),
    reward: { keys: 20, socket: true, rune: 4 },
  },
  {
    id: 'p20',
    title: 'Престиж 20',
    text: 'Двадцать сроков',
    progress: (p) => upToM(p.prestige, 20),
    reward: { keys: 30, rune: 5, tokens: 10000 },
  },
  {
    id: 'legend',
    title: 'Легенда забоя',
    text: `Разжечь запал до «${STREAK_TIERS[STREAK_TIERS.length - 1].name}»`,
    progress: (p) => upToM(p.bestStreak, STREAK_TIERS.length),
    reward: { keys: 3, parcel: 'epic' },
  },
  {
    id: 'zoo',
    title: 'Кольская фауна',
    text: 'Приручить всех шестерых',
    progress: (p) => upToM(Object.keys(p.pets).length, PETS.length),
    reward: { tokens: 1000, rune: 4 },
  },
  {
    id: 'cases',
    title: 'Сто сундуков',
    text: 'Открыть ключами',
    progress: (p) => upToM(p.cases, 100),
    reward: { rune: 3, tokens: 500 },
  },
  {
    id: 'seid',
    title: 'Хранитель сейдов',
    text: 'Разбить десять сейд-камней',
    progress: (p) => upToM(p.seids, 10),
    reward: { tokens: 600, rune: 3 },
  },
  {
    id: 'parcels',
    title: 'Сто передачек',
    text: 'Вскрыть',
    progress: (p) => upToM(p.parcelsOpened, 100),
    reward: { rune: 4, keys: 5 },
  },
];

export function mileReady(p: PrisonState, m: Mile): boolean {
  if (p.miles.includes(m.id)) return false;
  const [v, goal] = m.progress(p);
  return v >= goal;
}

export function milesReady(p: PrisonState): number {
  return MILES.filter((m) => mileReady(p, m)).length;
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
  /** Опыт кирки — сломанные блоки (v2.48). */
  pickXp: number;
  /** Норма: сколько блоков каждой породы добыто на текущем ранге. */
  norm: Record<number, number>;
  /** Шаг проводника; GUIDE.length — пройден. */
  guide: number;
  /** Сколько раз продавал рюкзак, сколько бомб взорвал. */
  sells: number;
  bombs: number;
  /** Лучшая ступень запала за всё время: 0 — не было, 1…5 — ступень. */
  bestStreak: number;
  /** Чары, выключенные игроком: не срабатывают, уровни целы. */
  off: EnchantId[];
  /** Передачки под полем (v2.49) и сколько вскрыто за всё время. */
  parcels: Parcel[];
  parcelsOpened: number;
  /** Мешочек рун, счётчик их номеров и гнёзда кирки (0 — пусто). */
  runes: Rune[];
  runeSeq: number;
  sockets: number[];
  /** Приручённые питомцы (опыт каждого) и тот, что с собой. */
  pets: Pets;
  pet: PetId | null;
  /** Забранные вехи. */
  miles: string[];
  /** Сколько сейд-камней разбито за всё время. */
  seids: number;
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
  pickXp: 0,
  norm: {},
  guide: 0,
  sells: 0,
  bombs: 0,
  bestStreak: 0,
  off: [],
  parcels: [],
  parcelsOpened: 0,
  runes: [],
  runeSeq: 0,
  sockets: [0, 0, 0, 0],
  pets: {},
  pet: null,
  miles: [],
  seids: 0,
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
    // Кирка из прошлых версий не начинает с нуля: весь её опыт — это уже
    // сломанные блоки.
    pickXp: int(raw.pickXp, 0, 1e12, int(raw.mined, 0, 1e12, 0)),
    norm: Object.fromEntries(
      Object.entries(raw.norm ?? {})
        .map(([k, v]) => [Number(k), int(v, 0, 1e9, 0)] as const)
        .filter(([k, v]) => Number.isInteger(k) && k >= 0 && k < MINES && v > 0),
    ),
    guide: int(raw.guide, 0, GUIDE.length, 0),
    sells: int(raw.sells, 0, 1e9, (raw.earned ?? 0) > 0 ? 1 : 0),
    bombs: int(raw.bombs, 0, 1e9, 0),
    bestStreak: int(raw.bestStreak, 0, STREAK_TIERS.length, 0),
    off: Array.isArray(raw.off)
      ? (raw.off.filter((id) => ENCHANTS.some((e) => e.id === id)) as EnchantId[])
      : [],
    ...normalizeLoot(raw),
    seids: int(raw.seids, 0, 1e9, 0),
  };
}

const TIER_IDS: CaseTier[] = ['common', 'rare', 'epic', 'legend'];

/** Передачки, руны, питомцы и вехи (v2.49) — отдельно, чтобы не раздувать. */
interface LootState {
  parcels: Parcel[];
  parcelsOpened: number;
  runes: Rune[];
  runeSeq: number;
  sockets: number[];
  pets: Pets;
  pet: PetId | null;
  miles: string[];
}

function normalizeLoot(raw: Partial<PrisonState>): LootState {
  const parcels = (Array.isArray(raw.parcels) ? raw.parcels : [])
    .filter((x) => x && TIER_IDS.includes(x.tier))
    .slice(0, PARCEL_SLOTS)
    .map((x) => ({ tier: x.tier, left: int(x.left, 0, PARCEL_NEED[x.tier], PARCEL_NEED[x.tier]) }));
  const seen = new Set<number>();
  const runes: Rune[] = [];
  for (const r of Array.isArray(raw.runes) ? raw.runes : []) {
    if (!r || !RUNES.some((d) => d.id === r.kind)) continue;
    const id = int(r.id, 1, 1e9, 0);
    if (!id || seen.has(id) || runes.length >= RUNE_BAG) continue;
    seen.add(id);
    runes.push({
      id,
      kind: r.kind,
      tier: int(r.tier, 1, RUNE_TIERS, 1),
      roll: int(r.roll, 0, 100, 0),
    });
  }
  const maxId = runes.reduce((m, r) => Math.max(m, r.id), 0);
  const used = new Set<number>();
  const sockets = Array.from({ length: SOCKETS_MAX }, (_, i) => {
    const id = int(raw.sockets?.[i], 0, 1e9, 0);
    if (!id || !seen.has(id) || used.has(id)) return 0;
    used.add(id);
    return id;
  });
  const pets: Pets = {};
  for (const d of PETS) {
    const xp = raw.pets?.[d.id];
    if (typeof xp === 'number') pets[d.id] = int(xp, 0, 1e12, 0);
  }
  const pet = raw.pet && pets[raw.pet] !== undefined ? raw.pet : null;
  return {
    parcels,
    parcelsOpened: int(raw.parcelsOpened, 0, 1e9, 0),
    runes,
    runeSeq: Math.max(maxId, int(raw.runeSeq, 0, 1e9, 0)),
    sockets,
    pets,
    pet,
    miles: Array.isArray(raw.miles) ? raw.miles.filter((id) => MILES.some((m) => m.id === id)) : [],
  };
}

// ---------------------------------------------------------------------------
// Проводник — как квесты проводника на VimeWorld: первые шаги цепочкой
// заданий, каждое учит одной механике и платит за неё. Условия читаются из
// состояния, поэтому игрок из прошлых версий просто забирает то, что уже
// сделал, и идёт дальше.
// ---------------------------------------------------------------------------

export interface GuideReward {
  coins?: number;
  tokens?: number;
  keys?: number;
  item?: [ItemId, number];
  /** Руна этой ступени (вид случайный). */
  rune?: number;
  pet?: PetId;
}

export interface GuideStep {
  id: string;
  title: string;
  hint: string;
  progress: (p: PrisonState) => [number, number];
  reward: GuideReward;
}

const upTo = (v: number, goal: number): [number, number] => [Math.min(v, goal), goal];
const enchSum = (p: PrisonState) => ENCHANTS.reduce((s, e) => s + p.ench[e.id], 0);

export const GUIDE: GuideStep[] = [
  {
    id: 'mine',
    title: 'Сломай 20 блоков',
    hint: 'Тапай по блоку или держи палец — кирка бьёт сама',
    progress: (p) => upTo(p.mined, 20),
    reward: { coins: 40 },
  },
  {
    id: 'sell',
    title: 'Продай добычу',
    hint: 'Кнопка с рюкзаком под полем',
    progress: (p) => upTo(p.sells, 1),
    reward: { coins: 60 },
  },
  {
    id: 'rankB',
    title: 'Выполни норму и возьми ранг B',
    hint: 'Одних денег мало: норма — это блоки, которые надо добыть. Жми на ранг',
    progress: (p) => upTo(p.rank, 1),
    reward: { keys: 1 },
  },
  {
    id: 'case',
    title: 'Открой сундук',
    hint: 'Лагерь → Сундуки. Ключ дали за ранг',
    progress: (p) => upTo(p.cases, 1),
    reward: { tokens: 25 },
  },
  {
    id: 'steel',
    title: 'Купи стальную кирку',
    hint: 'Лагерь → Кузница',
    progress: (p) => upTo(p.pick, 1),
    reward: { coins: 150 },
  },
  {
    id: 'enchant',
    title: 'Возьми первую чару',
    hint: 'Лагерь → Чары, платишь токенами',
    progress: (p) => upTo(enchSum(p), 1),
    reward: { tokens: 30 },
  },
  {
    id: 'streak',
    title: `Разожги запал до «${STREAK_TIERS[1].name}»`,
    hint: `${STREAK_TIERS[1].at} блоков без перерыва — полоска над полем`,
    progress: (p) => upTo(p.bestStreak, 2),
    reward: { item: ['bomb3', 1] },
  },
  {
    id: 'bomb',
    title: 'Взорви бомбу',
    hint: 'Кнопка 💣 под полем, потом тап по клетке',
    progress: (p) => upTo(p.bombs, 1),
    reward: { tokens: 40 },
  },
  {
    id: 'level',
    title: 'Доведи кирку до 5 уровня',
    hint: 'Опыт кирки — каждый сломанный блок',
    progress: (p) => upTo(pickLevelOf(p.pickXp).level, 5),
    reward: { item: ['energy', 1] },
  },
  {
    id: 'rankE',
    title: 'Возьми ранг E',
    hint: 'Редкая порода чаще на глубине, лупа показывает её под верхним блоком',
    progress: (p) => upTo(p.rank, 4),
    reward: { keys: 2 },
  },
  {
    id: 'bag',
    title: 'Прокачай рюкзак',
    hint: 'Лагерь → Кузница',
    progress: (p) => upTo(p.bagLevel, 1),
    reward: { item: ['lens', 1] },
  },
  {
    id: 'rankH',
    title: 'Возьми ранг H',
    hint: 'Дальше — сам: ранги до Z и престиж',
    progress: (p) => upTo(p.rank, 7),
    reward: { keys: 3, tokens: 150 },
  },
  // v2.49: добыча. Игрок, прошедший первые двенадцать, увидит проводник
  // снова — ровно ради этих трёх шагов.
  {
    id: 'parcel',
    title: 'Вскрой передачку',
    hint: 'Передачки падают с блоков и зреют под полем, пока копаешь',
    progress: (p) => upTo(p.parcelsOpened, 1),
    reward: { rune: 2 },
  },
  {
    id: 'rune',
    title: 'Вставь руну в кирку',
    hint: 'Лагерь → Руны. Первое гнездо открывается на 5 уровне кирки',
    progress: (p) => upTo(p.sockets.filter(Boolean).length, 1),
    reward: { pet: 'lemming' },
  },
  {
    id: 'pet',
    title: 'Дорасти питомца до 3 уровня',
    hint: 'Питомец растёт, пока ты копаешь',
    progress: (p) => upTo(p.pet ? petLevelOf(p.pets[p.pet] ?? 0).level : 0, 3),
    reward: { keys: 2, tokens: 100 },
  },
];

export function guideStep(p: PrisonState): GuideStep | null {
  return GUIDE[p.guide] ?? null;
}

export function guideReady(p: PrisonState): boolean {
  const step = guideStep(p);
  if (!step) return false;
  const [v, goal] = step.progress(p);
  return v >= goal;
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
