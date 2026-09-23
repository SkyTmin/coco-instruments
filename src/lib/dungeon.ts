// «Подземелье» — PvE каторги: вид сверху-сбоку, ручной бой, длинный цельный
// мир под лагерем. Здесь ПРАВИЛА: снаряжение и его прокачка, герой, мобы,
// добыча, сидор, деньги, таймеры боссов и шахт. Мир — `dungeon-world.ts`,
// бой — `dungeon-sim.ts`, картинки — `dungeon-art.ts`.
//
// ДЕНЬГИ СЧИТАЮТСЯ В «МИНУТАХ ШАХТЫ». Кошелёк общий с шахтой и автоматами,
// а шахта на ранге F и на ранге Z платит в сотни раз разное. Цена мяса,
// руды и сбора за заточку — доля того, что шахта игрока даёт за минуту
// (`econ`), поэтому подземелье весит одинаково на любом ранге и платит
// примерно 65% шахты — не больше: иначе шахта умрёт (так решено в плане).
//
// МОНЕТЫ ПРОГРЕСС ЗДЕСЬ НЕ ПОКУПАЮТ. Один занос в автомате — это сотни
// тысяч; если бы ступени снаряжения открывались деньгами, он проскакивал бы
// десятки часов. Ступени открывают убийства, пройденный путь, выходы живым,
// руда подземных шахт и трофеи боссов. Монеты — только сбор и расходники.

import { bonusOf, incomeRate, LAST_RANK, modsOf, rng32, ROCKS } from './prison';
import type { Bonus, PrisonState, Rock } from './prison';

// ---------------------------------------------------------------------------
// Районы. Названия и порядок — на всё подземелье сразу: мир строится снизу
// вверх, каждый следующий район глубже. Построены пока первые два, остальные
// — в следующих этапах (флаг `built`).
// ---------------------------------------------------------------------------

export type AreaId =
  | 'mouth'
  | 'haul'
  | 'old'
  | 'flood'
  | 'barrack'
  | 'ice'
  | 'dark'
  | 'fungus'
  | 'gas'
  | 'geode'
  | 'river'
  | 'seid'
  | 'saivo';

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
}

export const AREAS: AreaDef[] = [
  {
    id: 'mouth',
    name: 'Устье',
    tier: 1,
    level: 0,
    ambient: 0.62,
    lead: 'Вход в старые выработки. Лампы ещё горят.',
    built: true,
  },
  {
    id: 'haul',
    name: 'Откатка',
    tier: 2,
    level: 1,
    ambient: 0.4,
    lead: 'Рельсы, вагонетки и крысиные гнёзда в них.',
    built: true,
  },
  { id: 'old', name: 'Старые выработки', tier: 3, level: 2, ambient: 0.3, lead: '', built: false },
  {
    id: 'flood',
    name: 'Затопленный горизонт',
    tier: 4,
    level: 3,
    ambient: 0.3,
    lead: '',
    built: false,
  },
  { id: 'barrack', name: 'Барак', tier: 4, level: 4, ambient: 0.28, lead: '', built: false },
  { id: 'ice', name: 'Ледяной штрек', tier: 5, level: 5, ambient: 0.34, lead: '', built: false },
  { id: 'dark', name: 'Тёмный горизонт', tier: 5, level: 6, ambient: 0.06, lead: '', built: false },
  { id: 'fungus', name: 'Грибной грот', tier: 6, level: 6, ambient: 0.2, lead: '', built: false },
  { id: 'gas', name: 'Газовый забой', tier: 6, level: 7, ambient: 0.22, lead: '', built: false },
  {
    id: 'geode',
    name: 'Кристальная жеода',
    tier: 7,
    level: 8,
    ambient: 0.3,
    lead: '',
    built: false,
  },
  { id: 'river', name: 'Подземная река', tier: 7, level: 8, ambient: 0.2, lead: '', built: false },
  { id: 'seid', name: 'Сейд-ход', tier: 7, level: 9, ambient: 0.18, lead: '', built: false },
  { id: 'saivo', name: 'Сайво', tier: 8, level: 10, ambient: 0.3, lead: '', built: false },
];

export const areaOf = (id: AreaId): AreaDef => AREAS.find((a) => a.id === id) ?? AREAS[0];

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
    name: 'Лагерный',
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
    name: 'Забойный',
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

export type MobId = 'rat' | 'fatrat' | 'bomber' | 'goldrat' | 'king' | 'kinglet';

export type MeatId = 'meat' | 'fatmeat';
export type MatId = 'skin' | 'tail' | 'pyrite' | 'crown';

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
}

export const MOBS: Record<MobId, MobDef> = {
  rat: {
    id: 'rat',
    name: 'Пасюк',
    many: 'пасюков',
    hp: 14,
    dmg: 9,
    speed: 3.7,
    radius: 0.26,
    windup: 0.26,
    reach: 0.34,
    rest: 0.55,
    xp: 3,
    meat: ['meat', 0.7, 1],
    mats: [['skin', 0.22]],
    beast: true,
  },
  fatrat: {
    id: 'fatrat',
    name: 'Жирная крыса',
    many: 'жирных крыс',
    hp: 46,
    dmg: 18,
    speed: 2.1,
    radius: 0.36,
    windup: 0.5,
    reach: 0.42,
    rest: 1,
    xp: 9,
    meat: ['fatmeat', 1, 2],
    mats: [['skin', 0.6]],
    beast: true,
  },
  bomber: {
    id: 'bomber',
    name: 'Подрывник',
    many: 'подрывников',
    hp: 16,
    dmg: 30,
    speed: 3.2,
    radius: 0.26,
    windup: 1.5,
    reach: 1.4,
    rest: 2,
    xp: 7,
    meat: ['meat', 0.6, 1],
    mats: [
      ['tail', 0.5],
      ['skin', 0.2],
    ],
    beast: true,
  },
  goldrat: {
    id: 'goldrat',
    name: 'Золотая крыса',
    many: 'золотых крыс',
    hp: 40,
    dmg: 0,
    speed: 5.2,
    radius: 0.27,
    windup: 0,
    reach: 0,
    rest: 0,
    xp: 25,
    meat: null,
    mats: [['skin', 1]],
    beast: true,
  },
  king: {
    id: 'king',
    name: 'Крысиный король',
    many: 'крысиных королей',
    hp: 1750,
    dmg: 16,
    speed: 2.4,
    radius: 0.95,
    windup: 0.8,
    reach: 0.6,
    rest: 1.2,
    xp: 450,
    meat: ['fatmeat', 1, 12],
    mats: [['crown', 1]],
    beast: true,
  },
  kinglet: {
    id: 'kinglet',
    name: 'Малый король',
    many: 'малых королей',
    hp: 260,
    dmg: 16,
    speed: 3.2,
    radius: 0.55,
    windup: 0.6,
    reach: 0.4,
    rest: 1,
    xp: 60,
    meat: ['fatmeat', 1, 3],
    mats: [['skin', 1]],
    beast: false,
  },
};

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
// Деньги. `econ` — сколько монет шахта игрока даёт за минуту: от неё цены.
// ---------------------------------------------------------------------------

/** Монет в минуту шахты — якорь всех цен подземелья. */
export function econOf(p: PrisonState): number {
  const mine = Math.min(p.rank, LAST_RANK);
  const perSec = incomeRate(mine, p.pick, p.sharp, modsOf(p));
  // Пол: на ржавой кирке шахта даёт копейки, а мясо всё равно должно стоить.
  return Math.max(120, Math.round(perSec * 60));
}

/** Цена куска мяса — доля минуты шахты, дороже с глубиной. */
export const MEAT_SHARE: Record<MeatId, number> = { meat: 0.03, fatmeat: 0.05 };
export const MEAT_NAMES: Record<MeatId, string> = {
  meat: 'Крысятина',
  fatmeat: 'Жирная крысятина',
};
export const AREA_PAY = 1.3;

/**
 * Рынок насыщается: первые куски за час Барыга берёт по полной цене, дальше
 * — за полцены. Так фармить одно Устье вечно невыгодно — выгоднее вглубь.
 */
export const MARKET_FULL = 400;
export const MARKET_CUT = 0.5;

export interface MatDef {
  id: MatId;
  name: string;
  /** Цена продажи лишнего — в минутах шахты. */
  share: number;
  lead: string;
}

export const MATS: Record<MatId, MatDef> = {
  skin: { id: 'skin', name: 'Крысиная шкурка', share: 0.02, lead: 'На заточку снаряжения.' },
  tail: { id: 'tail', name: 'Хвост подрывника', share: 0.03, lead: 'Фитиль в нём не догорел.' },
  pyrite: {
    id: 'pyrite',
    name: 'Пирит',
    share: 0.05,
    lead: '«Кошачье золото» из подземных шахт — для каски и перековки.',
  },
  crown: {
    id: 'crown',
    name: 'Корона Крысиного короля',
    share: 3,
    lead: 'Трофей. Понадобится для перековки в Кованый комплект.',
  },
};

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

/** Порядок ячеек в сидоре: мясо, потом материалы, трофей последним. */
export const ITEM_ORDER: ItemId[] = ['meat', 'fatmeat', 'skin', 'tail', 'pyrite', 'crown'];

/** Сколько штук в одной ячейке. Корона — трофей, одна на ячейку. */
export const STACK: Record<ItemId, number> = {
  meat: 32,
  fatmeat: 32,
  skin: 32,
  tail: 32,
  pyrite: 32,
  crown: 1,
};

export const SACK_ROW = 9;
/** Карманы: 0…3 — от одного ряда до четырёх. */
export const SACK_MAX = 3;

export const sackSlots = (level: number) => SACK_ROW * (1 + Math.max(0, Math.min(SACK_MAX, level)));

const isMeat = (id: ItemId): id is MeatId => id === 'meat' || id === 'fatmeat';

/** Сколько штук вида лежит в сидоре. */
export function itemCount(s: Sack, id: ItemId): number {
  return (isMeat(id) ? s.meat[id] : s.mats[id as MatId]) ?? 0;
}

/** Занятые ячейки: каждый вид — своими стопками. */
export function slotsUsed(s: Sack, extra?: { id: ItemId; n: number }): number {
  let n = 0;
  for (const id of ITEM_ORDER) {
    const k = itemCount(s, id) + (extra?.id === id ? extra.n : 0);
    if (k > 0) n += Math.ceil(k / STACK[id]);
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
  for (const id of ITEM_ORDER) {
    let left = itemCount(s, id);
    while (left > 0) {
      const n = Math.min(STACK[id], left);
      out.push({ id, n });
      left -= n;
    }
  }
  return out;
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
 * Цена мяса в сидоре при продаже сейчас. Средний район мяса берётся из
 * `meatBy`: глубокая крысятина дороже устьевой.
 */
export function meatValue(
  s: Sack,
  econ: number,
  soldThisHour: number,
  sell = 1,
): { value: number; pieces: number } {
  const pieces = meatCount(s);
  if (!pieces) return { value: 0, pieces: 0 };
  let areaK = 0;
  let n = 0;
  for (const [id, k] of Object.entries(s.meatBy)) {
    areaK += (k ?? 0) * Math.pow(AREA_PAY, areaOf(id as AreaId).level);
    n += k ?? 0;
  }
  const areaMul = n > 0 ? areaK / n : 1;
  let value = 0;
  let sold = soldThisHour;
  for (const [id, k] of Object.entries(s.meat) as [MeatId, number][]) {
    for (let i = 0; i < (k ?? 0); i++) {
      const cut = sold >= MARKET_FULL ? MARKET_CUT : 1;
      value += econ * MEAT_SHARE[id] * areaMul * cut;
      sold += 1;
    }
  }
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

/** Сбор за заточку до `plus` на ступени `tier` — минуты шахты. */
export function plusCost(slot: Slot, tier: number, plus: number, econ: number): Cost {
  const k = Math.pow(1.6, tier - 1);
  const coins = Math.round(econ * 0.45 * k * (1 + 0.55 * (plus - 1)));
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
    if (slot === 'weapon') return [{ label: 'Убить пасюков', have: kills('rat'), need: 300 }];
    if (slot === 'helm')
      return [{ label: 'Добыть пирита в шахтах подземелья', have: stat('ore'), need: 60 }];
    if (slot === 'robe') return [{ label: 'Убить жирных крыс', have: kills('fatrat'), need: 60 }];
    return [{ label: 'Убить подрывников', have: kills('bomber'), need: 30 }];
  }
  if (tier === 2) {
    if (slot === 'weapon')
      return [
        { label: 'Убить пасюков', have: kills('rat'), need: 900 },
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
      { label: 'Убить пасюков', have: kills('rat'), need: 600 },
    ];
  }
  return [];
}

export function reforgeCost(slot: Slot, tier: number, econ: number): Cost {
  const k = Math.pow(1.6, tier - 1);
  const mats: Partial<Record<MatId, number>> = {
    skin: Math.round(20 * k),
    pyrite: Math.round((slot === 'helm' ? 20 : 10) * k),
  };
  if (tier >= 2) mats.crown = 1;
  return { coins: Math.round(econ * 4 * k), mats };
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
  econ: number,
):
  | { kind: 'plus'; cost: Cost }
  | { kind: 'reforge'; cost: Cost }
  | { kind: 'max' }
  | { kind: 'soon' } {
  const g = d.gear[slot];
  if (g.plus < PLUS_SAFE) return { kind: 'plus', cost: plusCost(slot, g.tier, g.plus + 1, econ) };
  if (g.tier >= TIER_OPEN) return g.tier >= SETS.length ? { kind: 'max' } : { kind: 'soon' };
  return { kind: 'reforge', cost: reforgeCost(slot, g.tier, econ) };
}

// ---------------------------------------------------------------------------
// Таймеры. Боссы и подземные шахты живут по часам: окна считаются от времени,
// сервер не нужен. Босс отдыхает от СВОЕЙ смерти; шахта — по окну часов.
// ---------------------------------------------------------------------------

export type BossId = 'king';

export interface BossDef {
  id: BossId;
  name: string;
  area: AreaId;
  restMs: number;
  mob: MobId;
}

export const BOSSES: Record<BossId, BossDef> = {
  king: { id: 'king', name: 'Крысиный король', area: 'haul', restMs: 20 * 60_000, mob: 'king' },
};

export function bossReadyAt(d: DungeonState, id: BossId): number {
  const b = d.bosses[id];
  return b ? b.at + BOSSES[id].restMs : 0;
}

export type DeepMineId = 'pyrite1' | 'pyrite2';

export interface DeepMineDef {
  id: DeepMineId;
  name: string;
  area: AreaId;
  /** Окно обновления, мс. */
  windowMs: number;
  /** Главная руда шахты и её доля по ярусам. */
  ore: number;
  share: number[];
}

// ---------------------------------------------------------------------------
// Подземная руда. Своя, которой нет в шахте каторги, — поэтому свои описания
// пород (тот же формат `Rock`, чтобы поле шахты рисовало их тем же кодом).
// Индексы начинаются после пород каторги: одна нумерация на обе шахты.
// ---------------------------------------------------------------------------

export const DEEP_BASE = 100;

export interface DeepRock extends Rock {
  /** Куда идёт в сидор: материал или пустая порода. */
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
    mat: 'pyrite',
  },
];

export const deepRock = (r: number): DeepRock => DEEP_ROCKS[r - DEEP_BASE] ?? DEEP_ROCKS[0];

export const DEEP_MINES: Record<DeepMineId, DeepMineDef> = {
  pyrite1: {
    id: 'pyrite1',
    name: 'Пиритовая штольня',
    area: 'mouth',
    windowMs: 60 * 60_000,
    ore: DEEP_BASE + 1,
    share: [0.14, 0.2, 0.26, 0.32, 0.4],
  },
  pyrite2: {
    id: 'pyrite2',
    name: 'Богатая пиритовая',
    area: 'haul',
    windowMs: 3 * 60 * 60_000,
    ore: DEEP_BASE + 1,
    share: [0.22, 0.3, 0.38, 0.46, 0.55],
  },
};

export const mineWindow = (id: DeepMineId, now: number) =>
  Math.floor(now / DEEP_MINES[id].windowMs);

export const mineNextAt = (id: DeepMineId, now: number) =>
  (mineWindow(id, now) + 1) * DEEP_MINES[id].windowMs;

/** Выработано до этой доли — шахта закрыта до следующего окна. */
export const DEEP_DONE_AT = 0.85;
/**
 * Каждые столько блоков у входа собирается стая, но не больше `DEEP_NOISE_MAX`
 * стай за один заход. Было 20 блоков и без потолка: владелец вышел из шахты в
 * толпу («их было очень много») — шум должен пугать, а не хоронить.
 */
export const DEEP_NOISE_BLOCKS = 35;
export const DEEP_NOISE_MAX = 3;

/**
 * Поле подземной шахты в окне: те же 7×9×5, что у каторги. Зерно — от
 * шахты и окна, поэтому поле одинаково при каждом входе в этот час.
 */
export function deepField(id: DeepMineId, window: number, cells: number, depth: number): number[] {
  const def = DEEP_MINES[id];
  const rnd = rng32(window * 7919 + id.length * 104729 + def.ore * 31);
  const out = new Array<number>(cells * depth);
  for (let d = 0; d < depth; d++) {
    for (let c = 0; c < cells; c++) {
      out[d * cells + c] = rnd() < def.share[d] ? def.ore : DEEP_BASE;
    }
    // Жилы: руда растекается к соседу справа и снизу — сверху видно прожилки.
    for (let c = 0; c < cells; c++) {
      if (out[d * cells + c] !== def.ore || rnd() > 0.45) continue;
      const n = c + (rnd() < 0.5 ? 1 : 7);
      if (n < cells) out[d * cells + n] = def.ore;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Сохранение.
// ---------------------------------------------------------------------------

export interface RunState {
  /** Откуда спустился — там и выход по умолчанию. */
  lift: string;
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
  /** Рынок мяса: час и сколько продано в этот час. */
  market: { hour: number; sold: number };
  /** Уровень сидора. */
  sackLevel: number;
  run: RunState | null;
  /** Видел ли вступление. */
  intro: boolean;
}

export const DUNGEON_START: DungeonState = {
  gear: START_GEAR,
  xp: 0,
  kills: {},
  stats: {},
  stash: {},
  lifts: ['mouth'],
  opened: [],
  lamps: [],
  secrets: [],
  fog: {},
  bosses: {},
  mines: {},
  market: { hour: 0, sold: 0 },
  sackLevel: 0,
  run: null,
  intro: false,
};

/** Подземелье открывается с этого ранга шахты (или после престижа). */
export const DUNGEON_UNLOCK_RANK = 5;

export const dungeonOpen = (p: Pick<PrisonState, 'rank' | 'prestige'>) =>
  p.rank >= DUNGEON_UNLOCK_RANK || p.prestige > 0;

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

export function normalizeDungeon(v: unknown): DungeonState {
  if (!v || typeof v !== 'object') return { ...DUNGEON_START };
  const o = v as Partial<DungeonState>;
  const g = (o.gear ?? {}) as Partial<Gear>;
  const run = o.run as Partial<RunState> | null | undefined;
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
    lifts: Array.from(new Set(['mouth', ...strs(o.lifts)])),
    opened: strs(o.opened),
    lamps: strs(o.lamps),
    secrets: strs(o.secrets),
    fog:
      o.fog && typeof o.fog === 'object'
        ? Object.fromEntries(Object.entries(o.fog).filter(([, s]) => typeof s === 'string'))
        : {},
    bosses:
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
        : {},
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
    market: {
      hour: num(o.market?.hour),
      sold: Math.max(0, num(o.market?.sold)),
    },
    sackLevel: Math.max(0, Math.min(SACK_MAX, Math.floor(num(o.sackLevel)))),
    run:
      run && typeof run === 'object' && typeof run.area === 'string'
        ? {
            lift: typeof run.lift === 'string' ? run.lift : 'mouth',
            area: (AREAS.some((a) => a.id === run.area) ? run.area : 'mouth') as AreaId,
            x: num(run.x),
            y: num(run.y),
            hp: num(run.hp, 1),
            sack: normalizeSack(run.sack),
            started: num(run.started),
            killed: Math.floor(num(run.killed)),
          }
        : null,
    intro: o.intro === true,
  };
}

// ---------------------------------------------------------------------------
// Сундук Крысиного короля и прочие награды — чистые броски.
// ---------------------------------------------------------------------------

export interface BossLoot {
  tokens: number;
  keys: number;
  coins: number;
  mats: Partial<Record<MatId, number>>;
}

export function kingLoot(econ: number, rnd: () => number): BossLoot {
  return {
    tokens: 20 + Math.floor(rnd() * 20),
    keys: rnd() < 0.4 ? 1 : 0,
    coins: Math.round(econ * (1.5 + rnd())),
    mats: { crown: 1, skin: 6 + Math.floor(rnd() * 6) },
  };
}

/** Мешок золотой крысы. */
export const goldBag = (econ: number) => Math.round(econ * 1.5);

/** Сколько ROCKS в каторге — для проверок, что подземные номера не пересекаются. */
export const PRISON_ROCKS = ROCKS.length;

// ---------------------------------------------------------------------------
// Вылазка: запись прогресса, выход живым, смерть. Прогресс (убийства,
// опыт, пройденное, открытое) остаётся ВСЕГДА — умер ты или вышел: это
// работа руками. Пропадает только сидор — так на присонах: умер в шахте
// PvP — лут у того, кто тебя убил, а здесь его растаскивают крысы.
// ---------------------------------------------------------------------------

export const hourOf = (now: number) => Math.floor(now / 3_600_000);

/** Сколько мяса Барыга уже взял в этот час. */
export const marketSold = (d: DungeonState, now: number) =>
  d.market.hour === hourOf(now) ? d.market.sold : 0;

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
  for (const b of x.bosses) {
    const prev = bosses[b.id];
    bosses[b.id] = { at: Math.max(prev?.at ?? 0, b.at), kills: (prev?.kills ?? 0) + 1 };
  }
  return {
    ...d,
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

function haulOf(d: DungeonState, sack: Sack, econ: number, now: number, killed: number): Haul {
  const mv = meatValue(sack, econ, marketSold(d, now));
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
 * Вышел клетью: мясо Барыге (рынок насыщается), монеты в общий кошелёк,
 * материалы на склад. Токены и ключи страница кладёт в каторгу — они общие.
 * `pay` — сколько монет всего прибавить в кошелёк.
 */
export function extractRun(
  d: DungeonState,
  sack: Sack,
  econ: number,
  now: number,
  killed: number,
): { d: DungeonState; haul: Haul; pay: number } {
  const haul = haulOf(d, sack, econ, now, killed);
  const hour = hourOf(now);
  const sold = marketSold(d, now) + haul.meat;
  const stats = { ...d.stats };
  stats.extracts = (stats.extracts ?? 0) + 1;
  if (haul.full) stats.fullExtracts = (stats.fullExtracts ?? 0) + 1;
  return {
    d: {
      ...d,
      stash: addCounts(d.stash, sack.mats),
      market: { hour, sold },
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
  econ: number,
  now: number,
  killed: number,
): { d: DungeonState; lost: Haul } {
  const lost = haulOf(d, sack, econ, now, killed);
  const stats = { ...d.stats, deaths: (d.stats.deaths ?? 0) + 1 };
  return { d: { ...d, stats, run: null }, lost };
}

/** Карман — целый ряд ячеек: уровней три, каждый — ощутимый шаг и сток шкурок. */
export function sackCost(level: number, econ: number): Cost {
  return {
    coins: Math.round(econ * 5 * Math.pow(2.4, level)),
    mats: { skin: Math.round(24 * Math.pow(1.9, level)) },
  };
}

/** Починить клеть района — новая точка спуска и выхода. */
export function liftCost(area: AreaId, econ: number): Cost {
  const lvl = areaOf(area).level;
  return {
    coins: Math.round(econ * 5 * Math.pow(1.8, lvl)),
    mats: { skin: Math.round(20 * Math.pow(1.6, lvl)) },
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
