// «Рыбалка» (v2.65) — третий промысел каторги. Правила здесь, страница
// только показывает и ловит пальцы.
//
// Шахта — «держи и веди» сверху, лес — «ритм лево/право» сбоку, рыбалка —
// «угадай момент и держи натяжение». Три глагола: ЗАБРОС (держишь — полоса
// силы ходит туда-сюда, отпустил — поплавок улетел; дальше — крупнее, но
// дольше ждать), ПОДСЕЧКА (поплавок дёргается вхолостую, потом уходит под
// воду — тап вовремя; поторопился — спугнул) и ВЫВАЖИВАНИЕ (держишь —
// подматываешь, натяжение растёт; отпускаешь — рыба тянет леску. Красная
// зона — леска лопнет, провисла надолго — крючок выскочит).
//
// Своё у рыбалки: мастерство (открывает места), удочки, садок и клёв у
// каждого места — он падает от каждой рыбы и отрастает сам, поэтому стоять
// на одном месте невыгодно. Общее с каторгой: кошелёк, токены (за первую
// рыбу каждого вида), питомец (его можно кормить уловом), сундучок (в
// шкатулке) и жемчуг — он поднимает цену продажи везде.

// ---------------------------------------------------------------------------
// Места и рыбы.
// ---------------------------------------------------------------------------

export type Rarity = 'common' | 'rare' | 'epic' | 'legend';

export interface FishDef {
  id: string;
  name: string;
  spot: number;
  /** Вес вероятности клюнуть. */
  w: number;
  /** Вес рыбы, кг: от и до. Мелкие попадаются чаще крупных. */
  kg: [number, number];
  /** Во сколько раз дороже рыбы «по месту». */
  mult: number;
  /** Сила на крючке: сравнивается с силой удочки. */
  power: number;
  rarity: Rarity;
}

export interface Spot {
  id: string;
  name: string;
  /** С какого уровня мастерства. */
  skill: number;
  /** Цена средней рыбы места, монет. */
  base: number;
  /** Водится ли ракушка (жемчуг). */
  mussels: boolean;
}

export const SPOTS: Spot[] = [
  { id: 'pond', name: 'Пруд', skill: 1, base: 120, mussels: true },
  { id: 'river', name: 'Река', skill: 5, base: 340, mussels: false },
  { id: 'lake', name: 'Озеро', skill: 10, base: 900, mussels: true },
  { id: 'mount', name: 'Горное озеро', skill: 16, base: 1900, mussels: false },
  { id: 'sea', name: 'Море', skill: 22, base: 3700, mussels: true },
];

export const FISH: FishDef[] = [
  // Пруд
  {
    id: 'crucian',
    name: 'Карась',
    spot: 0,
    w: 45,
    kg: [0.2, 0.9],
    mult: 0.8,
    power: 0.7,
    rarity: 'common',
  },
  {
    id: 'roach',
    name: 'Плотва',
    spot: 0,
    w: 35,
    kg: [0.1, 0.5],
    mult: 0.7,
    power: 0.6,
    rarity: 'common',
  },
  {
    id: 'perch',
    name: 'Окунь',
    spot: 0,
    w: 15,
    kg: [0.2, 1.2],
    mult: 1.3,
    power: 1.0,
    rarity: 'common',
  },
  {
    id: 'tench',
    name: 'Линь',
    spot: 0,
    w: 4.5,
    kg: [0.5, 2.5],
    mult: 2.6,
    power: 1.4,
    rarity: 'rare',
  },
  {
    id: 'goldfish',
    name: 'Золотая рыбка',
    spot: 0,
    w: 0.5,
    kg: [0.05, 0.2],
    mult: 12,
    power: 0.8,
    rarity: 'legend',
  },
  // Река
  {
    id: 'chub',
    name: 'Голавль',
    spot: 1,
    w: 40,
    kg: [0.4, 2],
    mult: 0.8,
    power: 1.4,
    rarity: 'common',
  },
  {
    id: 'ide',
    name: 'Язь',
    spot: 1,
    w: 30,
    kg: [0.5, 2.5],
    mult: 0.9,
    power: 1.6,
    rarity: 'common',
  },
  { id: 'pike', name: 'Щука', spot: 1, w: 18, kg: [1, 8], mult: 1.5, power: 2.2, rarity: 'rare' },
  {
    id: 'zander',
    name: 'Судак',
    spot: 1,
    w: 10,
    kg: [1, 6],
    mult: 2.2,
    power: 2.4,
    rarity: 'rare',
  },
  { id: 'catfish', name: 'Сом', spot: 1, w: 2, kg: [5, 40], mult: 6, power: 3.4, rarity: 'epic' },
  // Озеро
  {
    id: 'bream',
    name: 'Лещ',
    spot: 2,
    w: 42,
    kg: [0.5, 4],
    mult: 0.8,
    power: 2.0,
    rarity: 'common',
  },
  { id: 'carp', name: 'Карп', spot: 2, w: 30, kg: [2, 12], mult: 1, power: 2.8, rarity: 'common' },
  {
    id: 'burbot',
    name: 'Налим',
    spot: 2,
    w: 15,
    kg: [1, 6],
    mult: 1.6,
    power: 2.6,
    rarity: 'rare',
  },
  { id: 'eel', name: 'Угорь', spot: 2, w: 10, kg: [0.5, 3], mult: 2.5, power: 3.0, rarity: 'rare' },
  {
    id: 'amur',
    name: 'Белый амур',
    spot: 2,
    w: 3,
    kg: [5, 25],
    mult: 4,
    power: 3.8,
    rarity: 'epic',
  },
  // Горное озеро
  {
    id: 'grayling',
    name: 'Хариус',
    spot: 3,
    w: 40,
    kg: [0.3, 2],
    mult: 0.8,
    power: 2.8,
    rarity: 'common',
  },
  {
    id: 'trout',
    name: 'Форель',
    spot: 3,
    w: 32,
    kg: [0.5, 5],
    mult: 1,
    power: 3.2,
    rarity: 'common',
  },
  { id: 'char', name: 'Голец', spot: 3, w: 18, kg: [1, 6], mult: 1.5, power: 3.6, rarity: 'rare' },
  { id: 'lenok', name: 'Ленок', spot: 3, w: 8, kg: [1, 7], mult: 2.3, power: 4.2, rarity: 'rare' },
  {
    id: 'taimen',
    name: 'Таймень',
    spot: 3,
    w: 2,
    kg: [8, 50],
    mult: 6,
    power: 5.6,
    rarity: 'epic',
  },
  // Море
  {
    id: 'mackerel',
    name: 'Скумбрия',
    spot: 4,
    w: 40,
    kg: [0.3, 1.5],
    mult: 0.7,
    power: 3.6,
    rarity: 'common',
  },
  {
    id: 'flounder',
    name: 'Камбала',
    spot: 4,
    w: 30,
    kg: [0.5, 4],
    mult: 1,
    power: 4.0,
    rarity: 'common',
  },
  { id: 'cod', name: 'Треска', spot: 4, w: 18, kg: [2, 15], mult: 1.4, power: 5.0, rarity: 'rare' },
  {
    id: 'halibut',
    name: 'Палтус',
    spot: 4,
    w: 9,
    kg: [5, 60],
    mult: 2.4,
    power: 6.4,
    rarity: 'rare',
  },
  {
    id: 'tuna',
    name: 'Тунец',
    spot: 4,
    w: 2.5,
    kg: [20, 200],
    mult: 6,
    power: 8.2,
    rarity: 'epic',
  },
  {
    id: 'sturgeon',
    name: 'Осётр',
    spot: 4,
    w: 0.5,
    kg: [10, 80],
    mult: 15,
    power: 7.5,
    rarity: 'legend',
  },
];

export const fishOf = (id: string): FishDef | undefined => FISH.find((f) => f.id === id);
export const FISH_IDS = FISH.map((f) => f.id);

/** Средний вес: веса скошены к мелким (r^1.8), среднее — треть размаха. */
export function avgKg(f: FishDef): number {
  return f.kg[0] + (f.kg[1] - f.kg[0]) / 2.8;
}

// ---------------------------------------------------------------------------
// Удочки и садок — за общие монеты.
// ---------------------------------------------------------------------------

export interface Rod {
  name: string;
  /** Сила: рыба сильнее удочки — рвёт леску. */
  power: number;
  /** Скорость катушки. */
  reel: number;
  price: number;
}

export const RODS: Rod[] = [
  { name: 'Самоделка', power: 1, reel: 1, price: 0 },
  { name: 'Бамбуковая', power: 1.5, reel: 1.15, price: 1_500 },
  { name: 'Телескоп', power: 2.3, reel: 1.3, price: 8_000 },
  { name: 'Карбон', power: 3.4, reel: 1.5, price: 30_000 },
  { name: 'Морская', power: 5, reel: 1.75, price: 90_000 },
  { name: 'Золотая', power: 7.2, reel: 2, price: 200_000 },
];

export const NET_MAX = 8;
export const netCapacity = (level: number): number => 20 + 8 * level;
/** Садок: цена следующего уровня — постоянная таблица (v2.66). */
export const NET_PRICE = [500, 900, 1_600, 2_900, 5_200, 9_400, 17_000, 31_000];
export const netCost = (level: number): number =>
  NET_PRICE[Math.max(0, Math.min(NET_PRICE.length - 1, level))];
/** Садок, который продаёт сам, когда полон: одна цена автопродажи везде. */
export { AUTOSELL_TOKENS as NET_AUTO_TOKENS } from './economy';

// ---------------------------------------------------------------------------
// Мастерство: опыт — от каждой рыбы, больше за редкую. Открывает места и
// поднимает цену улова.
// ---------------------------------------------------------------------------

export const SKILL_MAX = 30;
export const SKILL_PRICE = 0.01;
export const RARITY_XP: Record<Rarity, number> = { common: 2, rare: 4, epic: 10, legend: 25 };

export function skillXpFor(level: number): number {
  return Math.round(12 * Math.pow(1.13, level - 1));
}

export function skillOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp || 0));
  for (;;) {
    if (level >= SKILL_MAX) return { level, into: 0, need: 0 };
    const need = skillXpFor(level);
    if (rest < need) return { level, into: rest, need };
    rest -= need;
    level += 1;
  }
}

/**
 * С какого ранга шахты открывается место (v2.66): пруд D, река H, озеро L,
 * горное озеро P, море U. Хребет игры — шахта; мастерство — второе условие.
 */
export const SPOT_GATE = [3, 7, 11, 15, 20];

const spotSkillOk = (spot: number, skill: number): boolean =>
  spot >= 0 && spot < SPOTS.length && skill >= SPOTS[spot].skill;

export const spotOpen = (spot: number, skill: number, mineRank: number, prestige = 0): boolean =>
  spotSkillOk(spot, skill) && (prestige > 0 || mineRank >= (SPOT_GATE[spot] ?? 99));

/** С какого ранга шахты открыта рыбалка: сначала шахта и лес. */
export const FISH_UNLOCK_RANK = 3;

// ---------------------------------------------------------------------------
// Клёв: у каждого места своя полоса. Каждая рыба её проедает, сама она
// отрастает. Стоять на одном месте — ждать дольше и ловить мельче.
// ---------------------------------------------------------------------------

export const BITE_DRAIN = 0.06;
export const BITE_REGEN_PER_MIN = 0.12;
export const BITE_MIN = 0.15;

export function biteNow(level: number, at: number, now: number): number {
  const t = Math.max(0, now - at) / 60_000;
  return Math.max(BITE_MIN, Math.min(1, level + t * BITE_REGEN_PER_MIN));
}

/** Сколько ждать поклёвки, мс. Дальний заброс и слабый клёв — дольше. */
export function biteWait(bite: number, dist: number, rnd: () => number): number {
  const base = 2200 + rnd() * 3800;
  return Math.round((base * (1 + 0.35 * dist)) / (0.4 + 0.6 * bite));
}

/** Холостые подёргивания перед настоящей поклёвкой: 0…3. */
export function nibbles(rnd: () => number): number {
  const x = rnd();
  return x < 0.3 ? 0 : x < 0.65 ? 1 : x < 0.9 ? 2 : 3;
}

/** Окно подсечки, мс: сильная рыба срывается быстрее. */
export function hookWindow(f: FishDef | null): number {
  if (!f) return 900;
  return Math.max(420, 880 - f.power * 45);
}

// ---------------------------------------------------------------------------
// Что клюнуло.
// ---------------------------------------------------------------------------

export type Bite =
  | { kind: 'fish'; fish: FishDef; kg: number }
  | { kind: 'box' }
  | { kind: 'mussel' };

export const BOX_CHANCE = 0.025;
export const MUSSEL_CHANCE = 0.04;
export const PEARL_CHANCE = 0.14;
// Жемчуг: +0,5% к продаже везде за каждую, не больше десяти. Живёт в
// каторге (`prison.pearls`): его читает `modsOf`, а prison.ts рыбалку не знает.
export { PEARL_MAX, PEARL_SELL } from './prison';

/**
 * Кто клюнул на месте `spot`. Сильный клёв и дальний заброс поднимают шанс
 * редких, слабый клёв — прижимает к мелочи.
 */
export function rollBite(spot: number, bite: number, dist: number, rnd: () => number): Bite {
  const s = SPOTS[spot];
  const x = rnd();
  if (x < BOX_CHANCE) return { kind: 'box' };
  if (s.mussels && x < BOX_CHANCE + MUSSEL_CHANCE) return { kind: 'mussel' };
  const pool = FISH.filter((f) => f.spot === spot);
  const rareBoost = (0.6 + 0.6 * bite) * (1 + 0.5 * dist);
  const weights = pool.map((f) => (f.rarity === 'common' ? f.w : f.w * rareBoost));
  const sum = weights.reduce((a, b) => a + b, 0);
  let y = rnd() * sum;
  let fish = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    y -= weights[i];
    if (y < 0) {
      fish = pool[i];
      break;
    }
  }
  const kg = fish.kg[0] + (fish.kg[1] - fish.kg[0]) * Math.pow(rnd(), 1.8);
  return { kind: 'fish', fish, kg: Math.round(kg * 100) / 100 };
}

/** Цена рыбы: по месту, по виду и по весу; мастерство — сверху. */
export function fishValue(f: FishDef, kg: number, skill: number): number {
  const v = SPOTS[f.spot].base * f.mult * (kg / avgKg(f)) * (1 + SKILL_PRICE * (skill - 1));
  return Math.max(1, Math.round(v));
}

/** Токены за первую рыбу вида: по месту и по редкости. */
export function firstCatchTokens(f: FishDef): number {
  const r = { common: 1, rare: 2, epic: 4, legend: 10 }[f.rarity];
  return (10 + 8 * f.spot) * r;
}

/** Опыт питомцу за рыбу из садка: крупная кормит лучше. */
export const PET_FISH_XP = 22;

// ---------------------------------------------------------------------------
// Вываживание. Чистая функция шага — её гоняет страница каждый кадр и бот
// в тестах. Всё в «попугаях»: дистанция в метрах, натяжение 0…1+ (выше
// единицы — леска трещит), силы рыбы 0…1.
// ---------------------------------------------------------------------------

export interface Fight {
  /** До берега, м. Ноль — рыба у ног. */
  dist: number;
  tension: number;
  /** Силы рыбы: тает, пока она тянет против натянутой лески. */
  stamina: number;
  /** Сколько уже в красном и сколько провисло, с. */
  red: number;
  slack: number;
  /** Рывок: сколько ещё длится, когда следующий (с) и его сила. */
  burst: number;
  nextBurst: number;
  burstK: number;
  t: number;
}

export type FightEnd = 'caught' | 'snap' | 'escape' | null;

/** Относительная сила рыбы против удочки: >1 — рыба сильнее. */
export function pullOf(f: FishDef, kg: number, rod: number): number {
  const size = Math.pow(kg / avgKg(f), 0.35);
  return (f.power * size) / RODS[rod].power;
}

/**
 * До какого места удочка по силе: обычная и редкая рыба места среднего веса
 * не сильнее её в 1,6 раза. Эпическую и легенду это не обещает — их тянут
 * руками. Так удочка N ровно под место N, а золотая — под сома и тунца.
 */
export function rodReach(rod: number): number {
  let reach = 0;
  SPOTS.forEach((_, s) => {
    const fish = FISH.filter((f) => f.spot === s && (f.rarity === 'common' || f.rarity === 'rare'));
    if (fish.every((f) => pullOf(f, avgKg(f), rod) <= 1.6)) reach = s;
  });
  return reach;
}

export const RED_AT = 1;
export const RED_SNAP_S = 0.5;
export const SLACK_AT = 0.08;
export const SLACK_ESCAPE_S = 2;
export const FIGHT_FAR = 32;

export function startFight(dist01: number, rnd: () => number): Fight {
  return {
    dist: 8 + 12 * dist01,
    tension: 0.2,
    stamina: 1,
    red: 0,
    slack: 0,
    burst: 0,
    nextBurst: 1 + rnd() * 1.5,
    burstK: 1,
    t: 0,
  };
}

/**
 * Шаг боя на `dt` секунд. `hold` — палец держит: катушка крутится. Рывки
 * рыбы — случайные, раз в полторы-три с половиной секунды.
 */
export function stepFight(
  f0: Fight,
  dt: number,
  hold: boolean,
  pull: number,
  reel: number,
  rnd: () => number,
): { f: Fight; end: FightEnd } {
  const f = { ...f0, t: f0.t + dt };
  // Рывки.
  f.nextBurst -= dt;
  if (f.burst > 0) f.burst = Math.max(0, f.burst - dt);
  if (f.nextBurst <= 0) {
    f.burst = 0.45 + rnd() * 0.45;
    f.nextBurst = 1.5 + rnd() * 2;
    // Рывки разные: слабый можно пересидеть, сильный — только отпустить.
    // От этого риск растёт с силой рыбы плавно, а не обрывом.
    f.burstK = 0.35 + 1.5 * Math.pow(rnd(), 1.5);
  }
  const bursting = f.burst > 0;
  const might = pull * (0.45 + 0.55 * f.stamina);
  // Куда тянется натяжение.
  const kick = bursting ? f.burstK * pull : 0;
  const target = hold ? 0.25 + 0.34 * might + 0.36 * kick : 0.04 + 0.1 * might + 0.2 * kick;
  // Рывок натягивает леску резко — отпускать надо сразу, это и есть
  // навык; ослабевает она медленнее.
  const rate = target > f.tension ? (bursting ? 6 : 4.5) : 5;
  f.tension += (target - f.tension) * Math.min(1, rate * dt);
  // Дистанция: катушка тянет к берегу, рыба — от берега.
  const reelIn = hold ? 3.2 * reel * Math.max(0.2, 1 - 0.4 * Math.min(1.5, might)) : 0;
  // Натянутая леска рыбу держит; уходит она рывком или когда леску отпустили.
  const away = bursting ? 1.6 * might * f.burstK : hold ? 0 : 0.3 * might;
  f.dist = Math.max(0, f.dist + (away - reelIn) * dt);
  // Силы тают, пока леска натянута: без этого сильную рыбу не вытащить.
  f.stamina = Math.max(
    0,
    f.stamina - (dt * (0.03 + 0.17 * f.tension)) / Math.sqrt(Math.max(0.5, pull)),
  );
  f.red = f.tension >= RED_AT ? f.red + dt : 0;
  f.slack = f.tension < SLACK_AT ? f.slack + dt : 0;
  if (f.red >= RED_SNAP_S) return { f, end: 'snap' };
  if (f.slack >= SLACK_ESCAPE_S || f.dist > FIGHT_FAR) return { f, end: 'escape' };
  if (f.dist <= 0) return { f, end: 'caught' };
  return { f, end: null };
}

// ---------------------------------------------------------------------------
// Состояние рыбалки — своим ключом сохранения, как у леса.
// ---------------------------------------------------------------------------

export interface FishingState {
  xp: number;
  rod: number;
  netLevel: number;
  /** Садок: сколько рыб, их вес и цена. */
  net: { n: number; kg: number; value: number };
  spot: number;
  /** Клёв по местам и когда он был таким. */
  bite: number[];
  biteAt: number[];
  /** Лучший вес каждого вида и сколько поймано. */
  records: Record<string, number>;
  caught: Record<string, number>;
  total: number;
  /** Садок продаёт сам, когда полон (куплено за токены). */
  auto: boolean;
}

export const FISHING_START: FishingState = {
  xp: 0,
  rod: 0,
  netLevel: 0,
  net: { n: 0, kg: 0, value: 0 },
  spot: 0,
  bite: SPOTS.map(() => 1),
  biteAt: SPOTS.map(() => 0),
  records: {},
  caught: {},
  total: 0,
  auto: false,
};

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
const int = (v: unknown, lo: number, hi: number, d: number) => Math.round(num(v, lo, hi, d));

export function normalizeFishing(raw: Partial<FishingState> | null | undefined): FishingState {
  if (!raw || typeof raw !== 'object')
    return { ...FISHING_START, bite: [...FISHING_START.bite], biteAt: [...FISHING_START.biteAt] };
  const xp = int(raw.xp, 0, 1e9, 0);
  const skill = skillOf(xp).level;
  const spot = int(raw.spot, 0, SPOTS.length - 1, 0);
  const pick = (o: unknown, lo: number, hi: number) =>
    Object.fromEntries(
      Object.entries(o && typeof o === 'object' ? (o as Record<string, unknown>) : {})
        .filter(([k]) => FISH_IDS.includes(k))
        .map(([k, v]) => [k, num(v, lo, hi, 0)])
        .filter(([, v]) => (v as number) > 0),
    ) as Record<string, number>;
  return {
    xp,
    rod: int(raw.rod, 0, RODS.length - 1, 0),
    netLevel: int(raw.netLevel, 0, NET_MAX, 0),
    net: {
      n: int(raw.net?.n, 0, 1e6, 0),
      kg: num(raw.net?.kg, 0, 1e9, 0),
      value: int(raw.net?.value, 0, 1e13, 0),
    },
    spot: spotSkillOk(spot, skill) ? spot : 0,
    bite: SPOTS.map((_, i) => num(raw.bite?.[i], BITE_MIN, 1, 1)),
    biteAt: SPOTS.map((_, i) => int(raw.biteAt?.[i], 0, 1e14, 0)),
    records: pick(raw.records, 0, 1e4),
    caught: Object.fromEntries(
      Object.entries(pick(raw.caught, 0, 1e9)).map(([k, v]) => [k, Math.round(v)]),
    ),
    total: int(raw.total, 0, 1e9, 0),
    auto: raw.auto === true,
  };
}
