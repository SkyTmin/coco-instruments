// Питомцы v2.72 — состав, роли, яйца, гнёзда, золотые и радужные, отряд.
//
// Владелец: «нарисуем новые, дадим им больше механик — в шахте, в подземелье
// и во дворе… чтобы питомцы были милые и хотелось всех, особенно
// легендарных». Прежние шесть (кольская фауна) переезжают в новых зверей с
// тем же опытом (`LEGACY_PET`).
//
// Образцы: Pet Simulator 99 (яйца, золотые и радужные из одинаковых),
// Hypixel SkyBlock (питомец растёт от работы, у редкого больше силы),
// яйца с ярусами редкости присон-серверов. Правило приложения «денег из
// ничего нет» соблюдено: яйцо греется работой, а не часами.
//
// Модуль чистый и ничего не знает о шахте: `prison.ts` импортирует отсюда,
// а не наоборот.

/** Что усиливает питомец. `luck` — ключи, находки и посылки. */
export type PetStat = 'loot' | 'sell' | 'dmg' | 'token' | 'luck' | 'rate';

export type PetId =
  | 'mole'
  | 'hamster'
  | 'hedgehog'
  | 'mouse'
  | 'corgi'
  | 'kitten'
  | 'owlet'
  | 'raccoon'
  | 'panda'
  | 'penguin'
  | 'otter'
  | 'crystalhog'
  | 'snowcat'
  | 'firefox'
  | 'dragon'
  | 'phoenix'
  | 'kitsune'
  | 'whale';

/**
 * Манера движения — у каждого вида своя (`components/PetArt`). Портрет один,
 * лапами не пошевелить, поэтому движется фигура целиком: кто скачет, кто
 * переваливается, кто парит.
 */
export type PetMotion =
  | 'dig'
  | 'puff'
  | 'roll'
  | 'sniff'
  | 'hop'
  | 'stretch'
  | 'look'
  | 'rub'
  | 'stand'
  | 'waddle'
  | 'float'
  | 'glint'
  | 'pounce'
  | 'flicker'
  | 'hover'
  | 'blaze'
  | 'drift'
  | 'swim';

/** Частицы вокруг питомца — рисует код, а не картинка. */
export type PetFx = 'fire' | 'frost' | 'sparks' | 'foxfire' | 'stars' | null;

export interface PetDef {
  id: PetId;
  name: string;
  /** 0 — Обычный … 5 — Мифический (цвета — `rarity.ts`). */
  rarity: number;
  stats: PetStat[];
  motion: PetMotion;
  fx: PetFx;
  lore: string;
  /** Заглушка, пока нет портрета: иконка game-icons и её цвет. */
  icon: string;
  tint: string;
}

export const PET_RARITY_NAME = [
  'Обычный',
  'Необычный',
  'Редкий',
  'Эпический',
  'Легендарный',
  'Мифический',
];

export const ROLE: Record<PetStat, { name: string; text: string }> = {
  loot: { name: 'Добытчик', text: 'к добыче' },
  sell: { name: 'Торгаш', text: 'к продаже' },
  dmg: { name: 'Силач', text: 'к скорости копки' },
  token: { name: 'Токенщик', text: 'к токенам' },
  luck: { name: 'Счастливчик', text: 'к ключам, находкам и посылкам' },
  rate: { name: 'Непоседа', text: 'к частоте ударов' },
};

export const ALL_STATS: PetStat[] = ['loot', 'sell', 'dmg', 'token', 'luck', 'rate'];

export const PETS: PetDef[] = [
  {
    id: 'mole',
    name: 'Кротёнок',
    rarity: 0,
    stats: ['loot'],
    motion: 'dig',
    fx: null,
    lore: 'Копает быстрее, чем видит',
    icon: 'pet-mole',
    tint: '#8a6a58',
  },
  {
    id: 'hamster',
    name: 'Хомячок',
    rarity: 0,
    stats: ['sell'],
    motion: 'puff',
    fx: null,
    lore: 'Всё своё носит за щекой',
    icon: 'pet-hamster',
    tint: '#e0a060',
  },
  {
    id: 'hedgehog',
    name: 'Ёжик',
    rarity: 0,
    stats: ['dmg'],
    motion: 'roll',
    fx: null,
    lore: 'Маленький, колючий и упрямый',
    icon: 'pet-hedgehog',
    tint: '#9a7a5a',
  },
  {
    id: 'mouse',
    name: 'Мышонок',
    rarity: 0,
    stats: ['luck'],
    motion: 'sniff',
    fx: null,
    lore: 'Найдёт крошку в любой темноте',
    icon: 'pet-mouse',
    tint: '#b8b0b8',
  },
  {
    id: 'corgi',
    name: 'Щенок',
    rarity: 1,
    stats: ['rate'],
    motion: 'hop',
    fx: null,
    lore: 'Шагом ходить не умеет',
    icon: 'pet-corgi',
    tint: '#e8a050',
  },
  {
    id: 'kitten',
    name: 'Котёнок',
    rarity: 1,
    stats: ['token'],
    motion: 'stretch',
    fx: null,
    lore: 'Приносит всё, что блестит',
    icon: 'pet-kitten',
    tint: '#f09a48',
  },
  {
    id: 'owlet',
    name: 'Совёнок',
    rarity: 1,
    stats: ['luck'],
    motion: 'look',
    fx: null,
    lore: 'Не спит, пока не найдёт',
    icon: 'pet-owlet',
    tint: '#c8a878',
  },
  {
    id: 'raccoon',
    name: 'Енотик',
    rarity: 1,
    stats: ['sell'],
    motion: 'rub',
    fx: null,
    lore: 'Моет каждую монетку',
    icon: 'pet-raccoon',
    tint: '#9098a8',
  },
  {
    id: 'panda',
    name: 'Красная панда',
    rarity: 2,
    stats: ['dmg'],
    motion: 'stand',
    fx: null,
    lore: 'Сильнее, чем кажется',
    icon: 'pet-panda',
    tint: '#d0602e',
  },
  {
    id: 'penguin',
    name: 'Пингвинёнок',
    rarity: 2,
    stats: ['rate'],
    motion: 'waddle',
    fx: null,
    lore: 'Бегает вперевалку, но быстро',
    icon: 'pet-penguin',
    tint: '#9aa8bc',
  },
  {
    id: 'otter',
    name: 'Выдра',
    rarity: 2,
    stats: ['loot'],
    motion: 'float',
    fx: null,
    lore: 'Каждый камешек — сокровище',
    icon: 'pet-otter',
    tint: '#9a6a48',
  },
  {
    id: 'crystalhog',
    name: 'Кристальный ёж',
    rarity: 3,
    stats: ['token'],
    motion: 'glint',
    fx: 'sparks',
    lore: 'Иголки звенят, как хрусталь',
    icon: 'pet-hedgehog',
    tint: '#8fd8ff',
  },
  {
    id: 'snowcat',
    name: 'Снежный барс',
    rarity: 3,
    stats: ['dmg'],
    motion: 'pounce',
    fx: 'frost',
    lore: 'Прыгает на руду из засады',
    icon: 'pet-snowcat',
    tint: '#dfe6ee',
  },
  {
    id: 'firefox',
    name: 'Лисёнок-огонёк',
    rarity: 3,
    stats: ['sell'],
    motion: 'flicker',
    fx: 'fire',
    lore: 'Хвост греет лучше костра',
    icon: 'pet-fox',
    tint: '#ff8a3a',
  },
  {
    id: 'dragon',
    name: 'Дракончик',
    rarity: 4,
    stats: ['loot', 'dmg'],
    motion: 'hover',
    fx: 'fire',
    lore: 'Дышит огнём на твёрдую руду',
    icon: 'pet-dragon',
    tint: '#3fc07a',
  },
  {
    id: 'phoenix',
    name: 'Феникс',
    rarity: 4,
    stats: ['luck', 'token'],
    motion: 'blaze',
    fx: 'fire',
    lore: 'Где пролетел — там удача',
    icon: 'pet-phoenix',
    tint: '#ff5a3a',
  },
  {
    id: 'kitsune',
    name: 'Девятихвостая лиса',
    rarity: 4,
    stats: ['sell', 'rate'],
    motion: 'drift',
    fx: 'foxfire',
    lore: 'Девять хвостов — девять хитростей',
    icon: 'pet-kitsune',
    tint: '#f2f4ff',
  },
  {
    id: 'whale',
    name: 'Звёздный кит',
    rarity: 5,
    stats: ALL_STATS,
    motion: 'swim',
    fx: 'stars',
    lore: 'Плывёт по воздуху среди звёзд',
    icon: 'pet-whale',
    tint: '#3a5aa8',
  },
];

export const petOf = (id: PetId): PetDef => PETS.find((x) => x.id === id)!;
export const isPetId = (id: unknown): id is PetId => PETS.some((x) => x.id === id);

// ---------------------------------------------------------------------------
// Сила. Прибавка вида за уровень (`STAT_PER`); редкость множит её, у двух
// ролей (легендарные) каждая слабее одной, у кита шесть ролей понемногу.
// Золотой и радужный — ещё множитель. Всё складывается в `bonusOf` под общий
// потолок `BONUS_CAP` (prison.ts).
//
// Числа вдвое меньше прежних (v2.49): тогда питомец был один и приходил
// редко, из посылки. С яйцами в Питомнике и отрядом из двух-трёх прежняя
// сила срезала круг A→Z на 10% (тест темпа, игрок, скупающий яйца).
// ---------------------------------------------------------------------------

export const STAT_PER: Record<PetStat, number> = {
  loot: 0.006,
  sell: 0.005,
  dmg: 0.01,
  token: 0.015,
  luck: 0.015,
  rate: 0.004,
};

export const RARITY_POWER = [1, 1.2, 1.45, 1.75, 2.1, 2.5];
/** Доля силы на роль: одна роль — вся, две — по 0,75, шесть — по 0,3. */
export function roleShare(n: number): number {
  return n <= 1 ? 1 : n === 2 ? 0.75 : 0.3;
}

/** Обычный, Золотой, Радужный. */
export const VARIANT_NAME = ['', 'Золотой', 'Радужный'];
export const VARIANT_POWER = [1, 1.5, 2.5];
/**
 * Сколько копий нужно для следующего вида: пять одинаковых — золотой (свой
 * и ещё четыре), пять золотых — радужный (ещё двадцать).
 */
export const MERGE_NEED = [4, 20];

export const PET_LEVEL_MAX = 25;
/** Лакомство — опыт первому в отряде. Копия радужного — тоже лакомство. */
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

/** Приручённый питомец: опыт, лишние копии, вид (0/1/2), когда гладили. */
export interface PetRec {
  xp: number;
  dup: number;
  v: number;
  pat: number;
}

export type Pets = Partial<Record<PetId, PetRec>>;

export const newPetRec = (): PetRec => ({ xp: 0, dup: 0, v: 0, pat: 0 });

/** Прибавки питомца по видам. */
export function petBonus(
  id: PetId,
  rec: Pick<PetRec, 'xp' | 'v'>,
): Partial<Record<PetStat, number>> {
  const def = petOf(id);
  const level = petLevelOf(rec.xp).level;
  const k =
    RARITY_POWER[def.rarity] * roleShare(def.stats.length) * VARIANT_POWER[rec.v ?? 0] * level;
  const out: Partial<Record<PetStat, number>> = {};
  for (const s of def.stats) out[s] = STAT_PER[s] * k;
  return out;
}

/** Сумма прибавок одного питомца — для сортировки «кто сильнее». */
export function petScore(id: PetId, rec: Pick<PetRec, 'xp' | 'v'>): number {
  const b = petBonus(id, rec);
  return Object.entries(b).reduce((s, [k, v]) => s + (v ?? 0) / STAT_PER[k as PetStat], 0);
}

// ---------------------------------------------------------------------------
// Отряд: с собой до трёх. Второе место — с ранга J, третье — после престижа.
// ---------------------------------------------------------------------------

export const SQUAD_MAX = 3;
export const SQUAD_RANK2 = 9;

export function squadSlots(rank: number, prestige: number): number {
  return 1 + (rank >= SQUAD_RANK2 || prestige > 0 ? 1 : 0) + (prestige > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Коллекция: каждый вид — +1% к продаже, весь зоопарк — ещё +10%. Как
// находки, только живые.
// ---------------------------------------------------------------------------

export const ZOO_EACH = 0.01;
export const ZOO_ALL = 0.1;

export function zooMult(pets: Pets | undefined): number {
  const n = pets ? Object.keys(pets).filter(isPetId).length : 0;
  return 1 + ZOO_EACH * n + (n >= PETS.length ? ZOO_ALL : 0);
}

// ---------------------------------------------------------------------------
// Ласка: тап по питомцу — сердечки всегда, опыт — раз в десять минут.
// ---------------------------------------------------------------------------

export const PAT_MS = 10 * 60_000;
export const PAT_XP = 40;

export function canPat(rec: PetRec | undefined, now: number): boolean {
  return !!rec && now - (rec.pat || 0) >= PAT_MS;
}

// ---------------------------------------------------------------------------
// Яйца. Четыре вида, у каждого своя лестница редкостей. Яйцо лежит в
// корзине, пока не освободится гнездо; в гнезде греется РАБОТОЙ — блоками,
// брёвнами, рыбой, — а не часами, и вылупляется по тапу.
//
// Пропускную способность держат гнёзда, а не цена: цена постоянная, и к
// поздним рангам любое яйцо по карману. Мшистое — около получаса копания,
// каменное — час с лишним. С высиживанием в 400 блоков тест темпа скупал
// сотню яиц за круг и собирал золотых к середине.
// ---------------------------------------------------------------------------

export type EggId = 'moss' | 'stone' | 'crystal' | 'dragon';

export interface EggDef {
  id: EggId;
  name: string;
  /** Веса редкостей 0…5. */
  odds: number[];
  /** Сколько работы (блоков) нужно, чтобы вылупился. */
  need: number;
  /** Цена в Питомнике, монет; 0 — не продаётся. */
  price: number;
  /** С какого ранга продаётся (0 — A). */
  from: number;
  /** Разбилось в полной корзине — столько токенов. */
  overflow: number;
}

export const EGGS: EggDef[] = [
  {
    id: 'moss',
    name: 'Мшистое яйцо',
    odds: [70, 25, 5, 0, 0, 0],
    need: 4_000,
    price: 8_000,
    from: 2,
    overflow: 20,
  },
  {
    id: 'stone',
    name: 'Каменное яйцо',
    odds: [0, 55, 33, 12, 0, 0],
    need: 10_000,
    price: 60_000,
    from: 9,
    overflow: 60,
  },
  {
    id: 'crystal',
    name: 'Кристальное яйцо',
    odds: [0, 0, 60, 32, 8, 0],
    need: 12_000,
    price: 300_000,
    from: 15,
    overflow: 150,
  },
  {
    id: 'dragon',
    name: 'Драконье яйцо',
    odds: [0, 0, 0, 70, 29.5, 0.5],
    need: 15_000,
    price: 0,
    from: 99,
    overflow: 400,
  },
];

export const EGG_IDS: EggId[] = EGGS.map((e) => e.id);
export const eggOf = (id: EggId): EggDef => EGGS.find((e) => e.id === id)!;
export const isEggId = (id: unknown): id is EggId => EGG_IDS.includes(id as EggId);

export const NEST_SLOTS = 2;
/** Корзина яиц: больше — лишнее разбивается на токены. */
export const EGG_BASKET = 12;
/** Двадцать пятое яйцо без эпического — эпический или выше наверняка. */
export const EGG_PITY = 25;
/** Рыба греет яйцо, как столько блоков. */
export const FISH_WARMTH = 15;

export interface Nest {
  egg: EggId;
  left: number;
}

export type Eggs = Record<EggId, number>;
export const NO_EGGS: Eggs = { moss: 0, stone: 0, crystal: 0, dragon: 0 };

export const eggCount = (eggs: Eggs): number => EGG_IDS.reduce((s, id) => s + (eggs[id] ?? 0), 0);

/** Вероятность каждой редкости из яйца, в долях. */
export function eggChances(id: EggId): number[] {
  const w = eggOf(id).odds;
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

function pickIndex(w: number[], rnd: () => number): number {
  const sum = w.reduce((a, b) => a + b, 0);
  let x = rnd() * sum;
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= 0) continue;
    x -= w[i];
    if (x <= 0) return i;
  }
  for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;
  return 0;
}

export interface Hatch {
  id: PetId;
  rarity: number;
  /** Счётчик гарантии после этого яйца. */
  pity: number;
  /** Сработала гарантия. */
  forced: boolean;
}

/** Кто вылупится. Вид внутри редкости — поровну. */
export function hatchRoll(egg: EggId, pity: number, rnd: () => number): Hatch {
  let rarity = pickIndex(eggOf(egg).odds, rnd);
  let forced = false;
  if (rarity < 3 && pity + 1 >= EGG_PITY) {
    rarity = 3;
    forced = true;
  }
  const pool = PETS.filter((p) => p.rarity === rarity);
  const id = pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))].id;
  return { id, rarity, pity: rarity >= 3 ? 0 : pity + 1, forced };
}

/** Яйцо — в свободное гнездо, иначе в корзину, иначе разбилось на токены. */
export function putEgg(
  nest: Nest[],
  eggs: Eggs,
  egg: EggId,
  /** Яйцо уже тёплое: столько блоков осталось (подарок заданий). */
  warm?: number,
): { nest: Nest[]; eggs: Eggs; tokens: number; where: 'nest' | 'basket' | 'broken' } {
  if (nest.length < NEST_SLOTS) {
    const left = Math.min(eggOf(egg).need, warm ?? eggOf(egg).need);
    return { nest: [...nest, { egg, left }], eggs, tokens: 0, where: 'nest' };
  }
  if (eggCount(eggs) < EGG_BASKET)
    return { nest, eggs: { ...eggs, [egg]: eggs[egg] + 1 }, tokens: 0, where: 'basket' };
  return { nest, eggs, tokens: eggOf(egg).overflow, where: 'broken' };
}

/** Из корзины в освободившиеся гнёзда — сперва старшие яйца. */
export function refillNest(nest: Nest[], eggs: Eggs): { nest: Nest[]; eggs: Eggs } {
  const out = [...nest];
  const left = { ...eggs };
  for (const id of [...EGG_IDS].reverse()) {
    while (out.length < NEST_SLOTS && left[id] > 0) {
      left[id] -= 1;
      out.push({ egg: id, left: eggOf(id).need });
    }
  }
  return { nest: out, eggs: left };
}

/** Работа греет все яйца в гнёздах. `ready` — сколько созрело этим шагом. */
export function warmNest(nest: Nest[], n: number): { nest: Nest[]; ready: number } {
  if (n <= 0 || !nest.length) return { nest, ready: 0 };
  let ready = 0;
  const out = nest.map((x) => {
    const left = Math.max(0, x.left - n);
    if (x.left > 0 && left === 0) ready += 1;
    return left === x.left ? x : { ...x, left };
  });
  return { nest: out, ready };
}

/** Новый питомец, копия к золотому или (у радужного) лакомство. */
export function addPet(pets: Pets, id: PetId): { pets: Pets; kind: 'new' | 'dup' | 'treat' } {
  const rec = pets[id];
  if (!rec) return { pets: { ...pets, [id]: newPetRec() }, kind: 'new' };
  if (rec.v < MERGE_NEED.length)
    return { pets: { ...pets, [id]: { ...rec, dup: rec.dup + 1 } }, kind: 'dup' };
  return { pets: { ...pets, [id]: { ...rec, xp: rec.xp + PET_TREAT_XP } }, kind: 'treat' };
}

/** Хватает копий на следующий вид. */
export function canMerge(rec: PetRec | undefined): boolean {
  return !!rec && rec.v < MERGE_NEED.length && rec.dup >= MERGE_NEED[rec.v];
}

export function mergePet(pets: Pets, id: PetId): Pets | null {
  const rec = pets[id];
  if (!rec || !canMerge(rec)) return null;
  return { ...pets, [id]: { ...rec, v: rec.v + 1, dup: rec.dup - MERGE_NEED[rec.v] } };
}

// ---------------------------------------------------------------------------
// Трюки. Каждый в отряде раз в `TRICK_EVERY` блоков делает своё: добытчик
// выкапывает кусок руды, торгаш продаёт его на ходу дороже, токенщик находит
// токены. Силач, непоседа и счастливчик помогают руками на поле (страница).
// Трюк считается от РАБОТЫ, а не по часам: пока копаешь, питомец копает с
// тобой. Размер — несколько секунд дохода: заметно, но не второй доход.
// ---------------------------------------------------------------------------

export const TRICK_EVERY = 160;
/** Сколько единиц руды выкапывает добытчик. */
export function trickOre(id: PetId, v: number): number {
  return Math.max(1, Math.round(3 * RARITY_POWER[petOf(id).rarity] * VARIANT_POWER[v ?? 0]));
}
/** Торгаш продаёт свой кусок дороже на столько. */
export const TRICK_SELL = 1.5;
export function trickTokens(id: PetId, v: number): number {
  return Math.max(1, Math.round(2 * RARITY_POWER[petOf(id).rarity] * VARIANT_POWER[v ?? 0]));
}
/** Непоседа: столько миллисекунд кирка бьёт чаще. */
export const TRICK_RUSH_MS = 8_000;
export const TRICK_RUSH = 0.2;
/** Счастливчик: столько миллисекунд подсвечен блок этажа или сейд. */
export const TRICK_SENSE_MS = 5_000;

/** Роль, которую питомец играет в этот раз: у многоролевых — по очереди. */
export function trickRole(id: PetId, turn: number): PetStat {
  const s = petOf(id).stats;
  return s[Math.abs(turn) % s.length];
}

// ---------------------------------------------------------------------------
// Перенос сохранений v2.49–v2.71: шесть зверей кольской фауны → новые виды
// той же роли, опыт сохраняется.
// ---------------------------------------------------------------------------

export const LEGACY_PET: Record<string, PetId> = {
  lemming: 'mole',
  fox: 'hamster',
  wolverine: 'hedgehog',
  raven: 'kitten',
  owl: 'owlet',
  calf: 'corgi',
};

const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : dflt;

/** Питомцы из сохранения любой версии: число (старый опыт) или запись. */
export function normalizePets(raw: unknown): Pets {
  const out: Pets = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const id = isPetId(key) ? key : LEGACY_PET[key];
    if (!id) continue;
    if (typeof val === 'number') {
      const xp = num(val, 0, 1e12, 0);
      const had = out[id];
      out[id] = had ? { ...had, xp: Math.max(had.xp, xp) } : { ...newPetRec(), xp };
      continue;
    }
    if (!val || typeof val !== 'object') continue;
    const r = val as Partial<PetRec>;
    out[id] = {
      xp: num(r.xp, 0, 1e12, 0),
      dup: num(r.dup, 0, 1e6, 0),
      v: num(r.v, 0, MERGE_NEED.length, 0),
      pat: num(r.pat, 0, 1e15, 0),
    };
  }
  return out;
}

/** Отряд из сохранения: только приручённые, без повторов, в пределах мест. */
export function normalizeSquad(
  raw: unknown,
  legacyPet: unknown,
  pets: Pets,
  slots: number,
): PetId[] {
  const src = Array.isArray(raw) ? raw : legacyPet ? [legacyPet] : [];
  const out: PetId[] = [];
  for (const x of src) {
    const id = isPetId(x) ? x : typeof x === 'string' ? LEGACY_PET[x] : undefined;
    if (!id || !pets[id] || out.includes(id)) continue;
    if (out.length >= Math.min(SQUAD_MAX, slots)) break;
    out.push(id);
  }
  return out;
}

export function normalizeEggs(raw: unknown): Eggs {
  const out: Eggs = { ...NO_EGGS };
  if (raw && typeof raw === 'object')
    for (const id of EGG_IDS) out[id] = num((raw as Record<string, unknown>)[id], 0, 999, 0);
  return out;
}

export function normalizeNest(raw: unknown): Nest[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && isEggId(x.egg))
    .slice(0, NEST_SLOTS)
    .map((x) => ({
      egg: x.egg as EggId,
      left: num(x.left, 0, eggOf(x.egg).need, eggOf(x.egg).need),
    }));
}
