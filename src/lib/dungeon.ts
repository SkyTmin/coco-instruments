// «Подземелье» — PvE каторги: вид сверху-сбоку, ручной бой, длинный цельный
// мир под лагерем. Здесь ПРАВИЛА: снаряжение и его прокачка, герой, мобы,
// добыча, сидор, деньги, таймеры боссов и шахт. Мир — `dungeon-world.ts`,
// бой — `dungeon-sim.ts`, картинки — `dungeon-art.ts`.
//
// ЦЕНЫ ПОСТОЯННЫЕ (v2.66). Раньше всё здесь считалось в «минутах шахты»
// игрока, и мясо дорожало вместе с киркой. Владелец: «цены на товар не
// должны меняться — мясо крыс, руды». Теперь кусок мяса, шкурка, сбор за
// заточку, лифт и карман — одно число навсегда; дороже только глубже.
//
// МОНЕТЫ ПРОГРЕСС ЗДЕСЬ НЕ ПОКУПАЮТ. Один занос в автомате — это сотни
// тысяч; если бы ступени снаряжения открывались деньгами, он проскакивал бы
// десятки часов. Ступени открывают убийства, пройденный путь, выходы живым,
// руда подземных шахт и трофеи боссов. Монеты — только сбор и расходники.

import { BLOCK_PRICE, ORE_PRICE } from './economy';
import { bonusOf, LAST_RANK, rng32, ROCKS } from './prison';
import type { Bonus, PrisonState, Rock } from './prison';
import { FLOORS } from './dungeon-floors';
import { DEEP_BASE, DEEP_PYRITE, DEEP_WALLROCK } from './dungeon-floors/types';
import type {
  AreaSpec,
  BossLoot,
  BossSpec,
  FloorDef,
  MineSpec,
  StatusKind,
} from './dungeon-floors/types';

export { DEEP_BASE };
export type { BossLoot, FloorDef, StatusKind };

// ---------------------------------------------------------------------------
// Этажи и районы (v2.81). Подземелье — пять этажей, этаж — стопка районов со
// своими картами (`lib/dungeon-floors/fN.ts`). Чтобы спуститься ниже, надо
// победить босса этажа: за ареной — запечатанный проход к лестнице.
// ---------------------------------------------------------------------------

export type AreaId = string;

export interface AreaDef {
  id: AreaId;
  name: string;
  /** Ступень снаряжения, под которую район задуман. */
  tier: number;
  /** Уровень района: множит силу мобов и цену добычи. */
  level: number;
  /** Сколько света без ламп и фонаря, 0…1. */
  ambient: number;
  /** Подпись под названием при входе. */
  lead: string;
  built: boolean;
  /** Этаж, к которому относится район. */
  floor: number;
  spec: AreaSpec;
}

export const AREAS: AreaDef[] = FLOORS.flatMap((f) =>
  f.areas.map((a) => ({
    id: a.id,
    name: a.name,
    tier: a.tier,
    level: a.level,
    ambient: a.ambient,
    lead: a.lead,
    built: true,
    floor: f.id,
    spec: a,
  })),
);

const AREA_BY = new Map(AREAS.map((a) => [a.id, a]));
export const areaOf = (id: AreaId): AreaDef => AREA_BY.get(id) ?? AREAS[0];

export const FLOOR_COUNT = FLOORS.length;
/**
 * Этажи, которые видит игрок: готовые ПОДРЯД с первого. Заготовки
 * (`draft`) спрятаны, пока их делают, и готовый этаж за заготовкой тоже
 * ждёт — спуститься к нему всё равно нельзя.
 */
export const OPEN_FLOORS: FloorDef[] = [];
for (const f of FLOORS) {
  if (f.draft) break;
  OPEN_FLOORS.push(f);
}
/** Все готовые этажи, и за заготовками тоже: их видит креатив владельца. */
export const READY_FLOORS = FLOORS.filter((f) => !f.draft);
/** Готов ли этаж (есть и не заготовка). */
export const floorReady = (id: number): boolean =>
  FLOORS.some((f) => f.id === id && !f.draft);
export const floorOf = (id: number): FloorDef => FLOORS.find((f) => f.id === id) ?? FLOORS[0];
/** Этаж, к которому относится район. */
export const floorOfArea = (area: AreaId): number => areaOf(area).floor;
/** Район-вход этажа: там его лифт. */
export const entryArea = (floor: number): AreaId => floorOf(floor).areas[0].id;

// ---------------------------------------------------------------------------
// Снаряжение. Четыре слота, у каждого своя работа кроме защиты: каска светит,
// роба держит здоровье, сапоги дают скорость и рывок, оружие — урон и форму
// взмаха. Восемь комплектов, и у комплекта ОДНА внешность на все слоты:
// палитра и узор задаются здесь, рисунок — в `dungeon-art.ts`.
// ---------------------------------------------------------------------------

export type Slot = 'helm' | 'robe' | 'boots' | 'weapon';
export const SLOTS: Slot[] = ['weapon', 'helm', 'robe', 'boots'];

export const SLOT_NAMES: Record<Slot, string> = {
  weapon: 'Оружие',
  helm: 'Каска',
  robe: 'Роба',
  boots: 'Сапоги',
};

/** Узор комплекта — одинаков на всех вещах набора. */
export type SetMotif =
  | 'quilt'
  | 'canvas'
  | 'rivets'
  | 'chased'
  | 'glass'
  | 'sheen'
  | 'stars'
  | 'aurora';

export interface GearSet {
  tier: number;
  name: string;
  /** Как называются вещи набора. */
  items: Record<Slot, string>;
  /** Основа, тень, свет, отделка, камень/свечение. */
  base: string;
  dark: string;
  light: string;
  trim: string;
  glow: string;
  motif: SetMotif;
  /** Бонус за все четыре вещи этого комплекта. */
  bonus: string;
}

export const SETS: GearSet[] = [
  {
    tier: 1,
    name: 'Простой',
    items: { weapon: 'Тесак из рессоры', helm: 'Ушанка', robe: 'Ватник', boots: 'Кирзачи' },
    base: '#5b5a55',
    dark: '#34332f',
    light: '#7d7b73',
    trim: '#8a6a44',
    glow: '#c9b27a',
    motif: 'quilt',
    bonus: '+10% здоровья',
  },
  {
    tier: 2,
    name: 'Шахтёрский',
    items: {
      weapon: 'Палаш забойщика',
      helm: 'Каска с фонарём',
      robe: 'Брезентовая роба',
      boots: 'Резиновые сапоги',
    },
    base: '#c07a2a',
    dark: '#7a4516',
    light: '#e3a24e',
    trim: '#dfe6ea',
    glow: '#fff1a8',
    motif: 'canvas',
    bonus: '+1 клетка света',
  },
  {
    tier: 3,
    name: 'Кованый',
    items: {
      weapon: 'Кованый меч',
      helm: 'Кованый шлем',
      robe: 'Кольчужная роба',
      boots: 'Кованые сапоги',
    },
    base: '#8a949e',
    dark: '#4e565e',
    light: '#c3cbd2',
    trim: '#5a4630',
    glow: '#e8f2ff',
    motif: 'rivets',
    bonus: '+15% брони',
  },
  {
    tier: 4,
    name: 'Горный мастер',
    items: {
      weapon: 'Меч мастера',
      helm: 'Шлем мастера',
      robe: 'Бронзовый нагрудник',
      boots: 'Сапоги мастера',
    },
    base: '#a8703a',
    dark: '#5e3a1a',
    light: '#dca060',
    trim: '#f2d27a',
    glow: '#ffe7a0',
    motif: 'chased',
    bonus: '+10% урона',
  },
  {
    tier: 5,
    name: 'Нефелиновый',
    items: {
      weapon: 'Нефелиновый клинок',
      helm: 'Нефелиновый шлем',
      robe: 'Нефелиновые латы',
      boots: 'Нефелиновые сапоги',
    },
    base: '#7f9a8e',
    dark: '#46584f',
    light: '#c6dccf',
    trim: '#dde8e2',
    glow: '#e9fff4',
    motif: 'glass',
    bonus: 'здоровье вне боя',
  },
  {
    tier: 6,
    name: 'Лопаритовый',
    items: {
      weapon: 'Лопаритовый клинок',
      helm: 'Лопаритовый шлем',
      robe: 'Лопаритовые латы',
      boots: 'Лопаритовые сапоги',
    },
    base: '#2e2c33',
    dark: '#141318',
    light: '#6a6878',
    trim: '#b7a36a',
    glow: '#d9ccff',
    motif: 'sheen',
    bonus: '+20% к рывку',
  },
  {
    tier: 7,
    name: 'Астрофиллитовый',
    items: {
      weapon: 'Звёздный клинок',
      helm: 'Звёздный шлем',
      robe: 'Звёздные латы',
      boots: 'Звёздные сапоги',
    },
    base: '#4a3222',
    dark: '#26170e',
    light: '#7a5638',
    trim: '#f2c14a',
    glow: '#ffe28a',
    motif: 'stars',
    bonus: '+15% крита',
  },
  {
    tier: 8,
    name: 'Сполох',
    items: {
      weapon: 'Сполох',
      helm: 'Венец сполоха',
      robe: 'Латы сполоха',
      boots: 'Сапоги сполоха',
    },
    base: '#1f3a4a',
    dark: '#0e1c26',
    light: '#3f6f86',
    trim: '#7cf2c6',
    glow: '#c9a6ff',
    motif: 'aurora',
    bonus: 'всё понемногу',
  },
];

export const setOf = (tier: number): GearSet =>
  SETS[Math.max(0, Math.min(SETS.length - 1, tier - 1))];

/** Какие ступени уже есть в игре. Остальные придут со своими районами. */
export const TIER_OPEN = 2;
/** Заточка без риска — до +5; закалка +6…+10 — со следующим этапом. */
export const PLUS_SAFE = 5;

export interface GearPiece {
  tier: number;
  plus: number;
}

export type Gear = Record<Slot, GearPiece>;

export const START_GEAR: Gear = {
  weapon: { tier: 1, plus: 0 },
  helm: { tier: 1, plus: 0 },
  robe: { tier: 1, plus: 0 },
  boots: { tier: 1, plus: 0 },
};

/** Рост силы от ступени к ступени и от заточки. */
export const TIER_GROWTH = 1.7;
export const PLUS_STEP = 0.12;

const tierMul = (t: number) => Math.pow(TIER_GROWTH, t - 1);
const plusMul = (p: number) => 1 + PLUS_STEP * p;

/** Что даёт вещь: одна строка на слот, для листа снаряжения. */
export function pieceStats(slot: Slot, g: GearPiece): Record<string, number> {
  const k = tierMul(g.tier) * plusMul(g.plus);
  if (slot === 'weapon') return { dmg: 10 * k };
  if (slot === 'helm') return { armor: 6 * k, light: 2.6 + 0.55 * (g.tier - 1) + 0.08 * g.plus };
  if (slot === 'robe') return { armor: 10 * k, hp: 25 * k };
  return {
    speed: 4.4 * (1 + 0.04 * (g.tier - 1) + 0.008 * g.plus),
    dash: 2.5 + 0.25 * (g.tier - 1) + 0.04 * g.plus,
  };
}

// ---------------------------------------------------------------------------
// Уровень героя — от опыта за убийства. Кривая долгая нарочно: сотый уровень
// — это сотни часов, а не вечер. Уровень прибавляет понемногу здоровья и
// урона и копит очки талантов (сами таланты — следующий этап).
// ---------------------------------------------------------------------------

export const LEVEL_MAX = 100;

export function xpFor(level: number): number {
  return Math.round(30 * Math.pow(level, 1.7));
}

export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let left = Math.max(0, xp);
  while (level < LEVEL_MAX && left >= xpFor(level)) {
    left -= xpFor(level);
    level += 1;
  }
  return { level, into: left, need: level >= LEVEL_MAX ? 0 : xpFor(level) };
}

// ---------------------------------------------------------------------------
// Мобы. Сила растёт с уровнем района быстрее, чем с одной заточкой, — поэтому
// следующий район требует следующего комплекта, а не терпения.
// ---------------------------------------------------------------------------

export type MobId = string;

export type MeatId = string;
export type MatId = string;

/**
 * Как нарисован моб: крыса (`dungeon-rats.ts`), кадры атласа 0x72
 * (`<name>_idle_anim_f0…3`, `_run_anim_f0…3`) или свой рисовальщик этажа
 * (`registerMobPainter(id)` в `dungeon-paint.ts`).
 */
export type MobArt =
  | { kind: 'rat' }
  | { kind: 'x72'; name: string; scale?: number; tint?: string; k?: number }
  | { kind: 'paint'; id: string };

/** Снаряд: плевок, камень, стрела, огонь. Рисует `registerShotPainter(art)`. */
export interface ShotSpec {
  /** Клеток в секунду. */
  speed: number;
  /** Радиус попадания, клеток. */
  r: number;
  /** Сколько летит, с. */
  life: number;
  /** Урон — доля урона моба. */
  dmg: number;
  art: string;
  status?: StatusKind;
  dur?: number;
  /** Навесом: летит над стенами и падает в точку прицела (камень из пращи). */
  lob?: boolean;
  /** Сколько сразу и разлёт веером, рад. */
  n?: number;
  spread?: number;
}

export interface MobDef {
  id: MobId;
  name: string;
  /** Для бестиария: во множественном числе. */
  many: string;
  hp: number;
  dmg: number;
  /** Клеток в секунду. */
  speed: number;
  /** Радиус тела, клеток. */
  radius: number;
  /** Замах перед укусом, с — всё, что бьёт, сперва предупреждает. */
  windup: number;
  /** Досягаемость удара от края тела, клеток. */
  reach: number;
  /** Пауза после удара, с. */
  rest: number;
  xp: number;
  /** Мясо: вид, шанс, сколько кусков. */
  meat: [MeatId, number, number] | null;
  /** Материалы: вид и шанс. */
  mats: [MatId, number][];
  /** Считается ли в бестиарии (у короля свой счёт). */
  beast: boolean;
  /** ИИ: библиотека `dungeon-brains.ts` или свой (`registerBrain`). */
  brain: string;
  art: MobArt;
  /** Вес: от него отдача. 1 — серая крыса. */
  mass?: number;
  /**
   * Доля обычных ударов, сбивающих замах (тяжёлый и крит сбивают всегда,
   * босса — ничто). Серая крыса 0,35, жирная 0, подрывник 1.
   */
  flinch?: number;
  /** Сколько стоит оглушённым, с (0,2). */
  stunT?: number;
  /** Часть боя с боссом: полоса здоровья, победа, никаких альбиносов. */
  boss?: boolean;
  /** Не бывает альбиносом. */
  noAlbino?: boolean;
  /** Мешок монет при смерти (золотая крыса). */
  coins?: number;
  /** Зигзаг на подходе (серая крыса). */
  zigzag?: boolean;
  /** Удар: статус и отброс героя (2; жирная крыса — 5). */
  hit?: { status?: StatusKind; dur?: number; push?: number };
  shot?: ShotSpec;
  /** Летает: над «глубиной» (вода, пропасть) проходит. */
  fly?: boolean;
  /** Цвет глаз в темноте. */
  eye?: string;
  /** Светится сам: радиус света, клеток (кристальные, огненные). */
  light?: number;
  /** Цвета брызг при смерти (у крыс — шерсть и кровь). */
  gore?: string[];
  /** Куда уходит после оглушения и выхода из норы (беглец — `flee`). */
  resume?: 'chase' | 'flee';
}

/** Все монстры всех этажей: один реестр на игру. */
export const MOBS: Record<MobId, MobDef> = Object.fromEntries(
  FLOORS.flatMap((f) => f.mobs).map((m) => [m.id, m]),
);

/** Рост силы мобов от района к району. */
export const AREA_HP = 1.8;
export const AREA_DMG = 1.7;
/** Элита: золотая кайма, в разы крепче и богаче. */
export const ELITE_HP = 4;
export const ELITE_DMG = 1.5;
export const ELITE_LOOT = 5;
/** Альбинос — один на 500: белый, втрое крепче, лута вдесятеро. */
export const ALBINO_CHANCE = 1 / 500;
export const ALBINO_HP = 3;
export const ALBINO_LOOT = 10;

export type Affix = 'fast' | 'tough' | 'leader' | 'regen' | 'boom';

export const AFFIXES: Record<Affix, string> = {
  fast: 'Бешеный',
  tough: 'Живучий',
  leader: 'Вожак',
  regen: 'Заживает',
  boom: 'Взрывной',
};

export interface MobStats {
  hp: number;
  dmg: number;
  speed: number;
  xp: number;
  loot: number;
}

export function mobStats(
  id: MobId,
  level: number,
  opts: { elite?: boolean; albino?: boolean; affixes?: Affix[] } = {},
): MobStats {
  const d = MOBS[id];
  let hp = d.hp * Math.pow(AREA_HP, level);
  let dmg = d.dmg * Math.pow(AREA_DMG, level);
  let speed = d.speed;
  let xp = d.xp * Math.pow(1.5, level);
  let loot = 1;
  if (opts.elite) {
    hp *= ELITE_HP;
    dmg *= ELITE_DMG;
    xp *= 4;
    loot *= ELITE_LOOT;
  }
  if (opts.albino) {
    hp *= ALBINO_HP;
    xp *= 3;
    loot *= ALBINO_LOOT;
  }
  for (const a of opts.affixes ?? []) {
    if (a === 'fast') speed *= 1.35;
    if (a === 'tough') hp *= 1.6;
  }
  return { hp, dmg, speed, xp, loot };
}

// ---------------------------------------------------------------------------
// Бестиарий: вехи по убийствам каждого вида, как знамёна Terraria и
// бестиарий Hypixel. Прибавка — ПРОТИВ ЭТОГО ВИДА: крысобой, выбивший тысячу
// пасюков, режет их заметно легче, но жирную крысу — как все.
// ---------------------------------------------------------------------------

export interface BeastStep {
  at: number;
  what: string;
}

export const BEAST_STEPS: BeastStep[] = [
  { at: 50, what: '+10% урона по ним' },
  { at: 250, what: '+10% к добыче с них' },
  { at: 1000, what: '−15% урона от них' },
  { at: 5000, what: '+25% урона по ним, золотая рамка' },
];

export function beastStep(kills: number): number {
  let s = 0;
  for (const b of BEAST_STEPS) if (kills >= b.at) s += 1;
  return s;
}

export function beastBonus(kills: number): { dmg: number; loot: number; guard: number } {
  const s = beastStep(kills);
  return {
    dmg: (s >= 1 ? 0.1 : 0) + (s >= 4 ? 0.25 : 0),
    loot: s >= 2 ? 0.1 : 0,
    guard: s >= 3 ? 0.15 : 0,
  };
}

// ---------------------------------------------------------------------------
// Герой: всё, что берётся из снаряжения, уровня, рун и питомца, — в одном
// месте. Бой (`dungeon-sim.ts`) читает только это.
// ---------------------------------------------------------------------------

export interface Hero {
  maxHp: number;
  armor: number;
  dmg: number;
  /** Множитель скорости взмаха. */
  haste: number;
  speed: number;
  dash: number;
  /** Радиус света фонаря, клеток. */
  light: number;
  crit: number;
  /** Множитель шансов добычи. */
  loot: number;
  /** Шанс токена с моба. */
  token: number;
  level: number;
}

export const HERO_HP = 100;
export const HERO_CRIT = 0.08;
export const CRIT_X = 2.2;

/** Бонус полного комплекта — если все четыре вещи одной ступени. */
export function fullSet(gear: Gear): number {
  const t = gear.weapon.tier;
  return SLOTS.every((s) => gear[s].tier === t) ? t : 0;
}

export function heroOf(d: Pick<DungeonState, 'gear' | 'xp'>, p?: Partial<PrisonState>): Hero {
  const g = d.gear;
  const w = pieceStats('weapon', g.weapon);
  const h = pieceStats('helm', g.helm);
  const r = pieceStats('robe', g.robe);
  const b = pieceStats('boots', g.boots);
  const { level } = levelOf(d.xp);
  const bon: Bonus = p ? bonusOf(p) : bonusOf({});
  const set = fullSet(g);
  let maxHp = (HERO_HP + r.hp) * (1 + 0.02 * (level - 1));
  let armor = h.armor + r.armor;
  let dmg = w.dmg * (1 + 0.01 * (level - 1)) * (1 + bon.dmg);
  let light = h.light;
  let dash = b.dash;
  let crit = HERO_CRIT + bon.proc * 0.25;
  if (set === 1) maxHp *= 1.1;
  if (set === 2) light += 1;
  if (set === 3) armor *= 1.15;
  if (set === 4) dmg *= 1.1;
  if (set === 6) dash *= 1.2;
  if (set === 7) crit += 0.15 * HERO_CRIT * 5;
  return {
    maxHp: Math.round(maxHp),
    armor,
    dmg,
    haste: 1 + bon.rate,
    speed: b.speed,
    dash,
    light,
    crit: Math.min(0.5, crit),
    loot: 1 + bon.loot,
    token: 0.012 * (1 + bon.token),
    level,
  };
}

/** Сколько урона дойдёт через броню. */
export const armorCut = (armor: number) => 100 / (100 + Math.max(0, armor));

// ---------------------------------------------------------------------------
// Деньги: постоянные цены. Глубже — дороже, больше ничего цену не двигает.
// ---------------------------------------------------------------------------

/** Мясо и еда всех этажей: цена куска во Входе в шахты, глубже — дороже. */
export const MEATS = Object.fromEntries(FLOORS.flatMap((f) => f.meats).map((m) => [m.id, m]));
export const MEAT_BASE: Record<MeatId, number> = Object.fromEntries(
  Object.values(MEATS).map((m) => [m.id, m.price]),
);
export const MEAT_NAMES: Record<MeatId, string> = Object.fromEntries(
  Object.values(MEATS).map((m) => [m.id, m.name]),
);
export const isMeat = (id: string): boolean => id in MEATS;
/** Во сколько раз мясо района дороже входного, по уровню района. */
export const AREA_MEAT = [1, 2.2, 3.6, 5.5, 8, 11, 15, 20, 26];
export const areaMeat = (level: number) =>
  AREA_MEAT[Math.max(0, Math.min(AREA_MEAT.length - 1, level))];
/** Цена куска мяса вида `id` из района уровня `level`. */
export const meatPrice = (id: MeatId, level: number) =>
  Math.round((MEAT_BASE[id] ?? 0) * areaMeat(level));

export interface MatDef {
  id: MatId;
  name: string;
  /** Цена штуки у торговца, монет. */
  price: number;
  lead: string;
  /** Сколько в одной ячейке рюкзака. */
  stack: number;
}

/**
 * Руда и цельные блоки из шахт подземелья — вещи с id `ore:<порода>` и
 * `block:<порода>` (номер `ROCKS` каторги): так их узнают и рюкзак, и склад,
 * и инвентарь. Цены — те же, что у каторги (`ORE_PRICE`, `BLOCK_PRICE`).
 */
export const oreItem = (rock: number): MatId => `ore:${rock}`;
export const blockItem = (rock: number): MatId => `block:${rock}`;
export function itemRock(id: MatId): { kind: 'ore' | 'block'; rock: number } | null {
  const m = /^(ore|block):(\d+)$/.exec(id);
  if (!m) return null;
  const rock = Number(m[2]);
  return ROCKS[rock] ? { kind: m[1] as 'ore' | 'block', rock } : null;
}

const BASE_MATS: Record<MatId, MatDef> = Object.fromEntries(
  FLOORS.flatMap((f) => f.mats).map((m) => [
    m.id,
    { id: m.id, name: m.name, price: m.price, lead: m.lead, stack: m.stack ?? 32 },
  ]),
);

/** Описание вещи рюкзака: материалы этажей, руда и блоки шахт. */
export function matDef(id: MatId): MatDef {
  const own = BASE_MATS[id];
  if (own) return own;
  const r = itemRock(id);
  if (r) {
    const rock = ROCKS[r.rock];
    return r.kind === 'ore'
      ? {
          id,
          name: rock.name,
          price: ORE_PRICE[r.rock] ?? 1,
          lead: 'Руда из шахты подземелья.',
          stack: 64,
        }
      : {
          id,
          name: rock.blockName,
          price: BLOCK_PRICE[r.rock] ?? 1,
          lead: 'Цельный блок руды — на снаряжение.',
          stack: 16,
        };
  }
  return { id, name: id, price: 0, lead: '', stack: 32 };
}

/** Материалы по id — для старого кода (`MATS[id].name`). */
export const MATS: Record<MatId, MatDef> = new Proxy(BASE_MATS, {
  get: (t, k: string) => (typeof k === 'string' ? (t[k] ?? matDef(k)) : undefined),
});

// ---------------------------------------------------------------------------
// Сидор — всё, что взял внизу. Умер — пропал целиком.
// ---------------------------------------------------------------------------

export interface Sack {
  meat: Partial<Record<MeatId, number>>;
  mats: Partial<Record<MatId, number>>;
  tokens: number;
  keys: number;
  coins: number;
  /** Сколько кусков мяса в каждом районе — от района цена. */
  meatBy: Partial<Record<AreaId, number>>;
}

export const EMPTY_SACK: Sack = { meat: {}, mats: {}, tokens: 0, keys: 0, coins: 0, meatBy: {} };

/**
 * Сидор устроен как инвентарь Майнкрафта: ячейки, в ячейке — стопка одного
 * вида. Владелец: «16 мяса забирать — бред… инвентарь, как в Майнкрафте».
 * Ряд — девять ячеек; сидор без карманов — один ряд, карманы добавляют ряды
 * до четырёх (36 ячеек, как основной инвентарь игры). Монеты, токены и ключи
 * ячеек не занимают — они в кошельке на поясе.
 */
export type ItemId = MeatId | MatId;

/** Сколько штук вида в одной ячейке. */
export const stackOf = (id: ItemId): number => (isMeat(id) ? 32 : matDef(id).stack);

/** Порядок видов в ячейках: мясо, материалы этажей, руда, блоки, трофеи последними. */
function itemRank(id: ItemId): number {
  if (isMeat(id)) return Object.keys(MEATS).indexOf(id);
  const r = itemRock(id);
  if (r) return (r.kind === 'ore' ? 3 : 4) * 1000 + r.rock;
  return stackOf(id) === 1 ? 9000 : 1000 + Object.keys(BASE_MATS).indexOf(id);
}

/** Виды в сидоре по порядку ячеек. */
export function itemsIn(s: Sack): ItemId[] {
  const ids = [...Object.keys(s.meat), ...Object.keys(s.mats)].filter((id) => itemCount(s, id) > 0);
  return ids.sort((a, b) => itemRank(a) - itemRank(b));
}

export const SACK_ROW = 9;
/** Карманы: 0…3 — от одного ряда до четырёх. */
export const SACK_MAX = 3;

export const sackSlots = (level: number) => SACK_ROW * (1 + Math.max(0, Math.min(SACK_MAX, level)));

/** Сколько штук вида лежит в сидоре. */
export function itemCount(s: Sack, id: ItemId): number {
  return (isMeat(id) ? s.meat[id] : s.mats[id]) ?? 0;
}

/** Занятые ячейки: каждый вид — своими стопками. */
export function slotsUsed(s: Sack, extra?: { id: ItemId; n: number }): number {
  let n = 0;
  const ids = itemsIn(s);
  if (extra && !ids.includes(extra.id)) ids.push(extra.id);
  for (const id of ids) {
    const k = itemCount(s, id) + (extra?.id === id ? extra.n : 0);
    if (k > 0) n += Math.ceil(k / stackOf(id));
  }
  return n;
}

/** Влезет ли ещё `n` штук: в неполную стопку или в свободную ячейку. */
export function canTake(s: Sack, id: ItemId, n: number, level: number): boolean {
  return slotsUsed(s, { id, n }) <= sackSlots(level);
}

/** Ячейки по порядку — для сетки инвентаря. */
export function sackStacks(s: Sack): { id: ItemId; n: number }[] {
  const out: { id: ItemId; n: number }[] = [];
  for (const id of itemsIn(s)) {
    let left = itemCount(s, id);
    while (left > 0) {
      const n = Math.min(stackOf(id), left);
      out.push({ id, n });
      left -= n;
    }
  }
  return out;
}

/** Положить в сидор: мясо — к мясу, прочее — к материалам. */
export function sackAdd(s: Sack, id: ItemId, n: number): void {
  if (isMeat(id)) s.meat[id] = (s.meat[id] ?? 0) + n;
  else s.mats[id] = (s.mats[id] ?? 0) + n;
}

export function sackCount(s: Sack): number {
  let n = 0;
  for (const v of Object.values(s.meat)) n += v ?? 0;
  for (const v of Object.values(s.mats)) n += v ?? 0;
  return n;
}

export function meatCount(s: Sack): number {
  let n = 0;
  for (const v of Object.values(s.meat)) n += v ?? 0;
  return n;
}

/**
 * Запах мяса: каждые 10 кусков — +10% к появлению крыс, до +100% со ста.
 * Сидор в ячейках держит сотни кусков, и это и есть размен: несёшь много —
 * идёт вдвое больше крыс, а смерть заберёт всё.
 */
export function smellOf(s: Sack): number {
  return Math.min(1, Math.floor(meatCount(s) / 10) * 0.1);
}

/**
 * Цена мяса в сидоре. Средний район мяса берётся из `meatBy`: глубокая
 * крысятина дороже входной. Рынок не насыщается — цена всегда одна.
 */
export function meatValue(s: Sack, sell = 1): { value: number; pieces: number } {
  const pieces = meatCount(s);
  if (!pieces) return { value: 0, pieces: 0 };
  let areaK = 0;
  let n = 0;
  for (const [id, k] of Object.entries(s.meatBy)) {
    areaK += (k ?? 0) * areaMeat(areaOf(id as AreaId).level);
    n += k ?? 0;
  }
  const areaMul = n > 0 ? areaK / n : 1;
  let value = 0;
  for (const [id, k] of Object.entries(s.meat) as [MeatId, number][])
    value += (k ?? 0) * Math.round((MEAT_BASE[id] ?? 0) * areaMul);
  return { value: Math.round(value * sell), pieces };
}

// ---------------------------------------------------------------------------
// Прокачка. Заточка внутри комплекта: монеты + шкурки (+ пирит со второй
// ступени), гарантированно. Перековка — только когда выполнены УСЛОВИЯ
// слота (как меч на VimeWorld: «300 крыс»), и ещё руда и монеты.
// ---------------------------------------------------------------------------

export interface Cost {
  coins: number;
  mats: Partial<Record<MatId, number>>;
}

/** Сбор за заточку +1…+5, монет на первой ступени; дальше — × ступень. */
export const PLUS_FEE = [700, 1_100, 1_500, 1_900, 2_200];
/** Перековка на следующую ступень — × ступень. */
export const REFORGE_FEE = 6_000;

/** Сбор за заточку до `plus` на ступени `tier`. */
export function plusCost(slot: Slot, tier: number, plus: number): Cost {
  const k = Math.pow(1.6, tier - 1);
  const coins = PLUS_FEE[Math.max(0, Math.min(PLUS_FEE.length - 1, plus - 1))] * tier;
  const skins = Math.round([0, 3, 5, 8, 12, 18][plus] * k);
  const mats: Partial<Record<MatId, number>> = { skin: skins };
  if (tier >= 2)
    mats.pyrite = Math.round((slot === 'helm' ? 3 : 2) * plus * Math.pow(1.5, tier - 2));
  if (slot === 'weapon' && tier >= 2 && plus >= 3) mats.tail = plus * 2;
  return { coins, mats };
}

/** Условие перековки: что считать и сколько нужно. */
export interface Condition {
  label: string;
  have: (d: DungeonState) => number;
  need: number;
}

export type StatId =
  | 'ore'
  | 'meters'
  | 'dodges'
  | 'extracts'
  | 'fullExtracts'
  | 'deaths'
  | 'mines'
  | 'runs'
  | 'secrets'
  | 'lamps';

const kills = (id: MobId) => (d: DungeonState) => d.kills[id] ?? 0;
const stat = (id: StatId) => (d: DungeonState) => d.stats[id] ?? 0;

const bossKills = (id: BossId) => (d: DungeonState) => d.bosses[id]?.kills ?? 0;

/**
 * Условия перековки со ступени `tier` на следующую — у каждого слота свои.
 * Только убийства и добыча: владелец отверг «выйти живым» как условие —
 * прокачку должна давать работа клинком и киркой, а не удачный подъём.
 */
export function reforgeConditions(slot: Slot, tier: number): Condition[] {
  if (tier === 1) {
    if (slot === 'weapon') return [{ label: 'Убить серых крыс', have: kills('rat'), need: 300 }];
    if (slot === 'helm')
      return [{ label: 'Добыть пирита в шахтах подземелья', have: stat('ore'), need: 60 }];
    if (slot === 'robe') return [{ label: 'Убить жирных крыс', have: kills('fatrat'), need: 60 }];
    return [{ label: 'Убить подрывников', have: kills('bomber'), need: 30 }];
  }
  if (tier === 2) {
    if (slot === 'weapon')
      return [
        { label: 'Убить серых крыс', have: kills('rat'), need: 900 },
        { label: 'Убить жирных крыс', have: kills('fatrat'), need: 200 },
      ];
    if (slot === 'helm')
      return [
        { label: 'Добыть пирита в шахтах подземелья', have: stat('ore'), need: 250 },
        { label: 'Поймать золотых крыс', have: kills('goldrat'), need: 5 },
      ];
    if (slot === 'robe')
      return [
        { label: 'Убить жирных крыс', have: kills('fatrat'), need: 250 },
        { label: 'Убить Крысиного короля', have: bossKills('king'), need: 3 },
      ];
    return [
      { label: 'Убить подрывников', have: kills('bomber'), need: 120 },
      { label: 'Убить серых крыс', have: kills('rat'), need: 600 },
    ];
  }
  return [];
}

export function reforgeCost(slot: Slot, tier: number): Cost {
  const k = Math.pow(1.6, tier - 1);
  const mats: Partial<Record<MatId, number>> = {
    skin: Math.round(20 * k),
    pyrite: Math.round((slot === 'helm' ? 20 : 10) * k),
  };
  if (tier >= 2) mats.crown = 1;
  return { coins: REFORGE_FEE * tier, mats };
}

export function conditionsMet(d: DungeonState, slot: Slot, tier: number): boolean {
  return reforgeConditions(slot, tier).every((c) => c.have(d) >= c.need);
}

export function canPay(d: DungeonState, cost: Cost, coins: number): boolean {
  if (coins < cost.coins) return false;
  for (const [id, n] of Object.entries(cost.mats) as [MatId, number][])
    if ((d.stash[id] ?? 0) < n) return false;
  return true;
}

/** Следующий шаг прокачки слота: заточка, перековка или потолок. */
export function nextStep(
  d: DungeonState,
  slot: Slot,
):
  | { kind: 'plus'; cost: Cost }
  | { kind: 'reforge'; cost: Cost }
  | { kind: 'max' }
  | { kind: 'soon' } {
  const g = d.gear[slot];
  if (g.plus < PLUS_SAFE) return { kind: 'plus', cost: plusCost(slot, g.tier, g.plus + 1) };
  if (g.tier >= TIER_OPEN) return g.tier >= SETS.length ? { kind: 'max' } : { kind: 'soon' };
  return { kind: 'reforge', cost: reforgeCost(slot, g.tier) };
}

/**
 * Слоты, которые можно улучшить прямо сейчас: хватает монет, материалов
 * (склад плюс рюкзак) и, для перековки, выполнены условия. По этому списку
 * горит «!» на кнопке рюкзака и на снаряжении — без него улучшение находили
 * только тыканьем наугад.
 */
export function upgradable(
  d: DungeonState,
  coins: number,
  sack: Partial<Record<MatId, number>> = {},
): Slot[] {
  return SLOTS.filter((slot) => {
    const step = nextStep(d, slot);
    if (step.kind !== 'plus' && step.kind !== 'reforge') return false;
    if (step.kind === 'reforge' && !conditionsMet(d, slot, d.gear[slot].tier)) return false;
    if (coins < step.cost.coins) return false;
    return payFromBoth(d, step.cost, sack) !== null;
  });
}

// ---------------------------------------------------------------------------
// Таймеры. Боссы и подземные шахты живут по часам: окна считаются от времени,
// сервер не нужен. Босс отдыхает от СВОЕЙ смерти; шахта — по окну часов.
// ---------------------------------------------------------------------------

export type BossId = string;

export type BossDef = BossSpec & { floor: number };

/** Боссы всех этажей: по одному на этаж, арена — `K` на карте района. */
export const BOSSES: Record<BossId, BossDef> = Object.fromEntries(
  FLOORS.map((f) => [f.boss.id, { ...f.boss, floor: f.id }]),
);

/** Босс этажа. */
export const bossOfFloor = (floor: number): BossDef => BOSSES[floorOf(floor).boss.id];

export function bossReadyAt(d: DungeonState, id: BossId): number {
  const b = d.bosses[id];
  const def = BOSSES[id];
  return b && def ? b.at + def.restMs : 0;
}

export type DeepMineId = string;

export type DeepMineDef = MineSpec & { floor: number };

/** Шахты всех этажей. */
export const DEEP_MINES: Record<DeepMineId, DeepMineDef> = Object.fromEntries(
  FLOORS.flatMap((f) => f.mines.map((m) => [m.id, { ...m, floor: f.id }])),
);

// ---------------------------------------------------------------------------
// Подземная порода. Пустая порода и пирит — свои (их нет в шахте каторги);
// руды этажей — номера `ROCKS` каторги со своими текстурами и блоками.
// Номера подземных начинаются с `DEEP_BASE`: одна нумерация на обе шахты.
// ---------------------------------------------------------------------------

export interface DeepRock extends Rock {
  /** Куда идёт в сидор: вещь или пустая порода. */
  mat: MatId | null;
}

export const DEEP_ROCKS: DeepRock[] = [
  {
    id: 'wallrock',
    name: 'Пустая порода',
    kind: 'stone',
    pattern: 'grain',
    base: '#5a5550',
    dark: '#34302c',
    fleck: '#76706a',
    shine: '#9a948c',
    hp: 6,
    value: 0,
    block: 0,
    blockName: '',
    mat: null,
  },
  {
    id: 'pyrite',
    name: 'Пирит',
    kind: 'metal',
    pattern: 'crystal',
    base: '#6a6258',
    dark: '#3a342c',
    fleck: '#d8b44a',
    shine: '#fff0a8',
    hp: 14,
    value: 0,
    block: 0,
    blockName: '',
    mat: 'pyrite',
  },
];

/** Порода шахты подземелья: своя (≥ DEEP_BASE) или руда каторги (её номер). */
export function deepRock(r: number): DeepRock {
  if (r >= DEEP_BASE) return DEEP_ROCKS[r - DEEP_BASE] ?? DEEP_ROCKS[0];
  const rock = ROCKS[r];
  if (!rock) return DEEP_ROCKS[0];
  // Руда этажа держит чуть больше пустой породы: копать её — работа.
  return { ...rock, hp: 10, mat: oreItem(r) };
}

export const mineWindow = (id: DeepMineId, now: number) =>
  Math.floor(now / (DEEP_MINES[id]?.windowMs ?? 3_600_000));

export const mineNextAt = (id: DeepMineId, now: number) =>
  (mineWindow(id, now) + 1) * (DEEP_MINES[id]?.windowMs ?? 3_600_000);

/** Выработано до этой доли — шахта закрыта до следующего окна. */
export const DEEP_DONE_AT = 0.85;
/**
 * Каждые столько блоков у входа собирается стая, но не больше `DEEP_NOISE_MAX`
 * стай за один заход. Было 20 блоков и без потолка: владелец вышел из шахты в
 * толпу («их было очень много») — шум должен пугать, а не хоронить.
 */
export const DEEP_NOISE_BLOCKS = 35;
export const DEEP_NOISE_MAX = 3;

const mineSeed = (id: DeepMineId, window: number) => {
  let h = window * 7919 + id.length * 104729;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
};

/**
 * Поле подземной шахты в окне: те же 7×9×5, что у каторги. Зерно — от
 * шахты и окна, поэтому поле одинаково при каждом входе в этот час. Руда —
 * две породы этажа поровну, пирит — своей долей среди руды; жилы
 * растекаются к соседу справа и снизу — сверху видно прожилки.
 */
export function deepField(id: DeepMineId, window: number, cells: number, depth: number): number[] {
  const def = DEEP_MINES[id];
  const out = new Array<number>(cells * depth).fill(DEEP_WALLROCK);
  if (!def) return out;
  const rnd = rng32(mineSeed(id, window));
  const pick = () => {
    if (def.pyrite > 0 && rnd() < def.pyrite) return DEEP_PYRITE;
    return def.ores[rnd() < 0.5 ? 0 : 1];
  };
  for (let d = 0; d < depth; d++) {
    for (let c = 0; c < cells; c++) {
      out[d * cells + c] = rnd() < def.share[d] ? pick() : DEEP_WALLROCK;
    }
    for (let c = 0; c < cells; c++) {
      const r = out[d * cells + c];
      if (r === DEEP_WALLROCK || rnd() > 0.45) continue;
      const n = c + (rnd() < 0.5 ? 1 : 7);
      if (n < cells) out[d * cells + n] = r;
    }
  }
  return out;
}

/** Цельный блок в поле шахты: клетка, ярус и чья руда. */
export interface DeepBlock {
  cell: number;
  depth: number;
  rock: number;
}

/** Сколько ударов держит цельный блок (крит — за два), как у каторги. */
export const DEEP_BLOCK_HITS = 3;

/**
 * Цельные блоки шахты в окне: редкие клетки из того же зерна, чаще глубже.
 * Руда блока — одна из двух руд этажа.
 */
export function deepBlocks(
  id: DeepMineId,
  window: number,
  cells: number,
  depth: number,
): DeepBlock[] {
  const def = DEEP_MINES[id];
  if (!def || def.blocks <= 0) return [];
  const rnd = rng32(mineSeed(id, window) ^ 0x5bd1e995);
  const mean = def.blocks;
  const n = Math.floor(mean) + (rnd() < mean - Math.floor(mean) ? 1 : 0);
  const out: DeepBlock[] = [];
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const cell = Math.floor(rnd() * cells);
    // Глубже — вероятнее: вес яруса d — d + 1.
    let x = rnd() * ((depth * (depth + 1)) / 2);
    let dd = depth - 1;
    for (let k = 0; k < depth; k++) {
      x -= k + 1;
      if (x <= 0) {
        dd = k;
        break;
      }
    }
    if (out.some((b) => b.cell === cell)) continue;
    out.push({ cell, depth: dd, rock: def.ores[rnd() < 0.5 ? 0 : 1] });
  }
  return out;
}

/** Сверху клетки сейчас цельный блок. */
export function deepBlockTop(blocks: DeepBlock[], cell: number, dug: number): DeepBlock | null {
  return blocks.find((b) => b.cell === cell && b.depth === dug) ?? null;
}

// ---------------------------------------------------------------------------
// Сохранение.
// ---------------------------------------------------------------------------

export interface RunState {
  /** Откуда спустился — там и выход по умолчанию. */
  lift: string;
  /** Этаж вылазки. */
  floor: number;
  area: AreaId;
  /** Место внутри района, клетки. */
  x: number;
  y: number;
  hp: number;
  sack: Sack;
  started: number;
  /** Сколько убито за эту вылазку — для итога. */
  killed: number;
}

export interface DeepMineState {
  window: number;
  dug: number[];
}

export interface DungeonState {
  gear: Gear;
  xp: number;
  kills: Partial<Record<MobId, number>>;
  stats: Partial<Record<StatId, number>>;
  /** Материалы наверху, на складе. */
  stash: Partial<Record<MatId, number>>;
  /** Починенные клети — точки спуска. */
  lifts: string[];
  /** Открытые короткие пути и зажжённые лампы, найденные тайники. */
  opened: string[];
  lamps: string[];
  secrets: string[];
  /** Разведанное: по району — битовая строка клеток (base64). */
  fog: Partial<Record<AreaId, string>>;
  /** Когда убит босс и сколько раз. */
  bosses: Partial<Record<BossId, { at: number; kills: number }>>;
  /** Раскоп подземных шахт в текущем окне. */
  mines: Partial<Record<DeepMineId, DeepMineState>>;
  /** Уровень сидора. */
  sackLevel: number;
  run: RunState | null;
  /** Видел ли вступление. */
  intro: boolean;
  /** Самый глубокий открытый этаж: босс этажа выше побеждён. */
  reached: number;
  /**
   * Для какой планировки КАЖДОГО этажа записаны разведка, фонари и место
   * вылазки (`FloorDef.mapVer`). Сменилась карта этажа — сбрасывается только
   * его привязанное к клеткам.
   */
  mapVers: Partial<Record<string, number>>;
}

/**
 * Версия планировки до этажей (v2.61–v2.80): мир 64×410 из двух районов.
 * Старое сохранение с этим номером — это первый этаж той же карты.
 */
export const MAP_VERSION = 2;

export const DUNGEON_START: DungeonState = {
  gear: START_GEAR,
  xp: 0,
  kills: {},
  stats: {},
  stash: {},
  lifts: [entryArea(1)],
  opened: [],
  lamps: [],
  secrets: [],
  fog: {},
  bosses: {},
  mines: {},
  sackLevel: 0,
  run: null,
  intro: false,
  reached: 1,
  mapVers: Object.fromEntries(FLOORS.map((f) => [String(f.id), f.mapVer])),
};

/** Подземелье открывается с этого ранга шахты (или после престижа). */
export const DUNGEON_UNLOCK_RANK = 5;

export const dungeonOpen = (p: Pick<PrisonState, 'rank' | 'prestige'>) =>
  p.rank >= DUNGEON_UNLOCK_RANK || p.prestige > 0;

/** Побеждён ли босс этажа хоть раз — открыт ли проход к лестнице вниз. */
export const floorBeaten = (d: Pick<DungeonState, 'reached'>, floor: number) => d.reached > floor;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

function normPiece(v: unknown): GearPiece {
  const o = (v ?? {}) as Partial<GearPiece>;
  const tier = Math.max(1, Math.min(SETS.length, Math.round(num(o.tier, 1))));
  const plus = Math.max(0, Math.min(10, Math.round(num(o.plus, 0))));
  return { tier, plus };
}

function normCounts<K extends string>(v: unknown): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    const x = num(n, 0);
    if (x > 0) out[k as K] = Math.floor(x);
  }
  return out;
}

export function normalizeSack(v: unknown): Sack {
  const o = (v ?? {}) as Partial<Sack>;
  return {
    meat: normCounts<MeatId>(o.meat),
    mats: normCounts<MatId>(o.mats),
    tokens: Math.max(0, Math.floor(num(o.tokens))),
    keys: Math.max(0, Math.floor(num(o.keys))),
    coins: Math.max(0, Math.floor(num(o.coins))),
    meatBy: normCounts<AreaId>(o.meatBy),
  };
}

/** Район записи: `area:x:y` — по нему видно, к какому этажу она привязана. */
const areaOfId = (id: string) => id.slice(0, id.indexOf(':'));

export function normalizeDungeon(v: unknown): DungeonState {
  if (!v || typeof v !== 'object') return { ...DUNGEON_START };
  const o = v as Partial<DungeonState> & { mapVer?: number };
  const g = (o.gear ?? {}) as Partial<Gear>;
  const run = o.run as Partial<RunState> | null | undefined;
  // Версии карт по этажам. Сохранение до этажей (одно число `mapVer`) — это
  // карта первого этажа того номера.
  const saved: Partial<Record<string, number>> =
    o.mapVers && typeof o.mapVers === 'object'
      ? (o.mapVers as Partial<Record<string, number>>)
      : { '1': num(o.mapVer, 1) };
  const stale = new Set(
    FLOORS.filter((f) => num(saved[String(f.id)], -1) !== f.mapVer).map((f) => f.id),
  );
  const known = (area: string) => AREAS.some((a) => a.id === area);
  // Запись привязана к клеткам: на другой карте её этажа — с нуля.
  const keep = (id: string) => {
    const area = areaOfId(id);
    return known(area) && !stale.has(floorOfArea(area));
  };
  const bosses: DungeonState['bosses'] =
    o.bosses && typeof o.bosses === 'object'
      ? Object.fromEntries(
          Object.entries(o.bosses)
            .filter(([id]) => id in BOSSES)
            .map(([id, b]) => [
              id,
              {
                at: num((b as { at?: number })?.at),
                kills: Math.floor(num((b as { kills?: number })?.kills)),
              },
            ]),
        )
      : {};
  // Самый глубокий открытый этаж: сохранённый, а у старого — по победам.
  let reached = Math.floor(num(o.reached, 1));
  for (const f of FLOORS)
    if ((bosses[f.boss.id]?.kills ?? 0) > 0) reached = Math.max(reached, f.id + 1);
  reached = Math.max(1, Math.min(FLOORS.length, reached));
  const lifts = new Set(strs(o.lifts).filter(known));
  for (const f of FLOORS) if (f.id <= reached) lifts.add(entryArea(f.id));
  const runFloor =
    run && typeof run.area === 'string' && known(run.area) ? floorOfArea(run.area) : 1;
  const runFresh = !run || !known(String(run.area)) || stale.has(runFloor);
  return {
    gear: {
      weapon: normPiece(g.weapon),
      helm: normPiece(g.helm),
      robe: normPiece(g.robe),
      boots: normPiece(g.boots),
    },
    xp: Math.max(0, num(o.xp)),
    kills: normCounts<MobId>(o.kills),
    stats: normCounts<StatId>(o.stats),
    stash: normCounts<MatId>(o.stash),
    lifts: [...lifts],
    opened: strs(o.opened).filter(keep),
    lamps: strs(o.lamps).filter(keep),
    secrets: strs(o.secrets).filter(keep),
    fog:
      o.fog && typeof o.fog === 'object'
        ? (Object.fromEntries(
            Object.entries(o.fog).filter(
              ([area, s]) => typeof s === 'string' && known(area) && !stale.has(floorOfArea(area)),
            ),
          ) as Partial<Record<AreaId, string>>)
        : {},
    bosses,
    mines:
      o.mines && typeof o.mines === 'object'
        ? Object.fromEntries(
            Object.entries(o.mines)
              .filter(([id, m]) => id in DEEP_MINES && Array.isArray((m as DeepMineState)?.dug))
              .map(([id, m]) => [
                id,
                {
                  window: num((m as DeepMineState).window),
                  dug: (m as DeepMineState).dug.map((x) => Math.max(0, Math.min(5, num(x)))),
                },
              ]),
          )
        : {},
    sackLevel: Math.max(0, Math.min(SACK_MAX, Math.floor(num(o.sackLevel)))),
    run:
      run && typeof run === 'object' && typeof run.area === 'string'
        ? {
            lift: typeof run.lift === 'string' && known(run.lift) ? run.lift : entryArea(runFloor),
            floor: runFloor,
            area: runFresh ? entryArea(runFloor) : run.area,
            // x < 0 — «у клети спуска»: так мир ставит героя на новой карте.
            x: runFresh ? -1 : num(run.x),
            y: runFresh ? 0 : num(run.y),
            hp: num(run.hp, 1),
            sack: normalizeSack(run.sack),
            started: num(run.started),
            killed: Math.floor(num(run.killed)),
          }
        : null,
    intro: o.intro === true,
    reached,
    mapVers: Object.fromEntries(FLOORS.map((f) => [String(f.id), f.mapVer])),
  };
}

// ---------------------------------------------------------------------------
// Сундук Крысиного короля и прочие награды — чистые броски.
// ---------------------------------------------------------------------------

/** Король платит постоянно: 8 000 монет, корона, шкурки (сундук — в `f1.ts`). */
export const KING_COINS = 8_000;
/** Мешок золотой крысы. */
export const GOLD_BAG = 1_500;
/** Ящик и бочка — горсть монет; тайник — пять горстей побольше. */
export const CRATE_COINS = 30;
export const SECRET_COINS = 400;

/** Сундук босса этажа. */
export function bossLoot(id: BossId, rnd: () => number): BossLoot {
  const def = BOSSES[id];
  return def ? def.loot(rnd) : { tokens: 0, keys: 0, coins: 0, mats: {} };
}

/** Сундук Крысиного короля — для старых мест и тестов. */
export const kingLoot = (rnd: () => number): BossLoot => bossLoot('king', rnd);

/** Сколько ROCKS в каторге — для проверок, что подземные номера не пересекаются. */
export const PRISON_ROCKS = ROCKS.length;

// ---------------------------------------------------------------------------
// Вылазка: запись прогресса, выход живым, смерть. Прогресс (убийства,
// опыт, пройденное, открытое) остаётся ВСЕГДА — умер ты или вышел: это
// работа руками. Пропадает только сидор — так на присонах: умер в шахте
// PvP — лут у того, кто тебя убил, а здесь его растаскивают крысы.
// ---------------------------------------------------------------------------

/** То, что вылазка добавила к сохранению (форма `SimDelta`). */
export interface DeltaIn {
  kills: Partial<Record<MobId, number>>;
  stats: Partial<Record<StatId, number>>;
  xp: number;
  lamps: string[];
  opened: string[];
  secrets: string[];
  bosses: { id: BossId; at: number }[];
}

const addCounts = <K extends string>(
  a: Partial<Record<K, number>>,
  b: Partial<Record<K, number>>,
): Partial<Record<K, number>> => {
  const out = { ...a };
  for (const [k, n] of Object.entries(b) as [K, number][]) if (n) out[k] = (out[k] ?? 0) + n;
  return out;
};

const union = (a: string[], b: string[]) => (b.length ? Array.from(new Set([...a, ...b])) : a);

/** Сложить дельту вылазки с сохранением. Разведка — строками по районам. */
export function applyDelta(
  d: DungeonState,
  x: DeltaIn,
  fog?: Partial<Record<AreaId, string>>,
): DungeonState {
  const bosses = { ...d.bosses };
  let reached = d.reached;
  const lifts = new Set(d.lifts);
  for (const b of x.bosses) {
    const prev = bosses[b.id];
    bosses[b.id] = { at: Math.max(prev?.at ?? 0, b.at), kills: (prev?.kills ?? 0) + 1 };
    // Победа над боссом открывает этаж ниже навсегда — и его лифт.
    const f = BOSSES[b.id]?.floor;
    if (f && f < FLOORS.length && f + 1 > reached) {
      reached = f + 1;
      lifts.add(entryArea(reached));
    }
  }
  return {
    ...d,
    reached,
    lifts: lifts.size === d.lifts.length ? d.lifts : [...lifts],
    kills: addCounts(d.kills, x.kills),
    stats: addCounts(d.stats, x.stats),
    xp: d.xp + x.xp,
    lamps: union(d.lamps, x.lamps),
    opened: union(d.opened, x.opened),
    secrets: union(d.secrets, x.secrets),
    bosses,
    fog: fog ? { ...d.fog, ...fog } : d.fog,
  };
}

/**
 * Спуск по лестнице за ареной: вылазка переезжает на этаж ниже, к его лифту,
 * рюкзак и здоровье — с собой. Только если этаж открыт (босс повержен).
 */
export function descendRun(d: DungeonState): DungeonState | null {
  const run = d.run;
  if (!run) return null;
  const next = run.floor + 1;
  if (!floorReady(next) || !floorBeaten(d, run.floor)) return null;
  const area = entryArea(next);
  return {
    ...d,
    lifts: d.lifts.includes(area) ? d.lifts : [...d.lifts, area],
    run: { ...run, floor: next, area, x: -1, y: 0 },
  };
}

export interface Haul {
  meat: number;
  meatValue: number;
  coins: number;
  tokens: number;
  keys: number;
  mats: Partial<Record<MatId, number>>;
  killed: number;
  ms: number;
  /** Сидор был почти полон — засчитывается в условия робы. */
  full: boolean;
}

function haulOf(d: DungeonState, sack: Sack, now: number, killed: number): Haul {
  const mv = meatValue(sack);
  return {
    meat: mv.pieces,
    meatValue: mv.value,
    coins: sack.coins,
    tokens: sack.tokens,
    keys: sack.keys,
    mats: { ...sack.mats },
    killed,
    ms: d.run ? Math.max(0, now - d.run.started) : 0,
    full: slotsUsed(sack) >= sackSlots(d.sackLevel),
  };
}

/**
 * Вышел клетью: мясо торговцу, монеты в общий кошелёк,
 * материалы на склад. Токены и ключи страница кладёт в каторгу — они общие.
 * `pay` — сколько монет всего прибавить в кошелёк.
 */
export function extractRun(
  d: DungeonState,
  sack: Sack,
  now: number,
  killed: number,
): { d: DungeonState; haul: Haul; pay: number } {
  const haul = haulOf(d, sack, now, killed);
  const stats = { ...d.stats };
  stats.extracts = (stats.extracts ?? 0) + 1;
  if (haul.full) stats.fullExtracts = (stats.fullExtracts ?? 0) + 1;
  return {
    d: {
      ...d,
      stash: addCounts(d.stash, sack.mats),
      stats,
      run: null,
    },
    haul,
    pay: haul.meatValue + haul.coins,
  };
}

/** Умер: сидор пропал целиком. Что было в нём — для экрана «Растащили». */
export function dieRun(
  d: DungeonState,
  sack: Sack,
  now: number,
  killed: number,
): { d: DungeonState; lost: Haul } {
  const lost = haulOf(d, sack, now, killed);
  const stats = { ...d.stats, deaths: (d.stats.deaths ?? 0) + 1 };
  return { d: { ...d, stats, run: null }, lost };
}

/** Карман — целый ряд ячеек: уровней три, каждый — ощутимый шаг и сток шкурок. */
export const SACK_PRICE = [5_000, 12_000, 30_000];
export function sackCost(level: number): Cost {
  return {
    coins: SACK_PRICE[Math.max(0, Math.min(SACK_PRICE.length - 1, level))],
    mats: { skin: Math.round(24 * Math.pow(1.9, level)) },
  };
}

/** Починить клеть района — новая точка спуска и выхода. */
/** Лифт Рельсовых туннелей — 8 000; каждый следующий район вдвое дороже. */
export const LIFT_PRICE = 8_000;
/**
 * Починка лифта района. Монеты растут с уровнем РОВНО (было ×2 за уровень —
 * на девятом уровне это два миллиона, а миллионов в игре нет), материал —
 * ходовой материал ЭТОГО этажа (на первом — шкурки, как раньше), и его
 * число считается от входа этажа: иначе на пятом этаже просили бы
 * тысячи крысиных шкурок.
 */
export function liftCost(area: AreaId): Cost {
  const a = areaOf(area);
  const lvl = a.level;
  const floor = floorOf(a.floor);
  const base = floor.areas[0]?.level ?? 0;
  const mat = floor.mats.find((m) => (m.stack ?? 32) > 1)?.id ?? 'skin';
  return {
    coins: Math.round(LIFT_PRICE * (1 + Math.max(0, lvl - 1))),
    mats: { [mat]: Math.round(20 * Math.pow(1.6, Math.max(0, lvl - base))) },
  };
}

/** Списать со склада то, что стоит `cost` (монеты — не здесь). */
export function payMats(d: DungeonState, cost: Cost): DungeonState {
  const stash = { ...d.stash };
  for (const [id, n] of Object.entries(cost.mats) as [MatId, number][]) {
    const left = (stash[id] ?? 0) - n;
    if (left > 0) stash[id] = left;
    else delete stash[id];
  }
  return { ...d, stash };
}

/**
 * Платёж внизу, прямо в вылазке (владелец: «качать вещи можно прям в
 * подземелье»): сперва склад лагеря, недостающее — из сидора. Сидором платить
 * честно: вещь, вложенную в заточку, крысы уже не растащат, но и Барыге её не
 * продашь. null — не хватает даже вместе. Монеты — отдельно, общий кошелёк.
 */
export function payFromBoth(
  d: DungeonState,
  cost: Cost,
  sack: Partial<Record<MatId, number>>,
): { d: DungeonState; fromSack: Partial<Record<MatId, number>> } | null {
  const stash = { ...d.stash };
  const fromSack: Partial<Record<MatId, number>> = {};
  for (const [id, n] of Object.entries(cost.mats) as [MatId, number][]) {
    if (!n) continue;
    const have = stash[id] ?? 0;
    const take = Math.min(have, n);
    const rest = n - take;
    if (rest > (sack[id] ?? 0)) return null;
    if (have - take > 0) stash[id] = have - take;
    else delete stash[id];
    if (rest > 0) fromSack[id] = rest;
  }
  return { d: { ...d, stash }, fromSack };
}

/** Материалы после вычета (сидор после платежа). */
export function minusMats(
  a: Partial<Record<MatId, number>>,
  b: Partial<Record<MatId, number>>,
): Partial<Record<MatId, number>> {
  const out = { ...a };
  for (const [id, n] of Object.entries(b) as [MatId, number][]) {
    const left = (out[id] ?? 0) - n;
    if (left > 0) out[id] = left;
    else delete out[id];
  }
  return out;
}

/**
 * Прочность подземной руды — от породы шахты игрока: кирка каторги бьёт
 * здесь с тем же уроном, и блок пирита держит столько же ударов, сколько
 * хорошая порода его ранга. Иначе на алмазной кирке шахта подземелья
 * сдувалась бы за секунды, а на ржавой — не копалась бы вовсе.
 */
export function deepHp(rock: number, p: Pick<PrisonState, 'rank'>): number {
  const base = ROCKS[Math.min(Math.max(0, p.rank), LAST_RANK)]?.hp ?? 4;
  return Math.max(1, Math.round((base * deepRock(rock).hp) / 10));
}

/** Раскоп шахты в ТЕКУЩЕМ окне: старое окно — нетронутое поле. */
export function deepMineNow(
  d: DungeonState,
  id: DeepMineId,
  now: number,
  cells: number,
): DeepMineState {
  const w = mineWindow(id, now);
  const m = d.mines[id];
  if (m && m.window === w && m.dug.length === cells) return m;
  return { window: w, dug: new Array<number>(cells).fill(0) };
}

/** Доля выработки: сколько блоков из всех сломано. */
export function deepShare(m: DeepMineState, depth: number): number {
  if (!m.dug.length) return 0;
  return m.dug.reduce((a, b) => a + b, 0) / (m.dug.length * depth);
}
