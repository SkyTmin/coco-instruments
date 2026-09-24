// «Лесоповал» — вторая «шахта» каторги. Правила здесь, страница только
// показывает и ловит пальцы.
//
// Шахта — «держи и веди» сверху; лес — «ритм и реакция» сбоку. Перед тобой
// одно высокое дерево: ствол из брёвен, на стволе сучья то слева, то справа.
// Тап по левой или правой стороне рубит нижнее бревно с этой стороны, ствол
// оседает. Сучок, опустившийся на твою сторону, бьёт по лбу — запал гаснет,
// топор на миг встаёт. Последнее бревно — «Бойся!», крона падает, выезжает
// следующее дерево. Если бы лес был той же сеткой сверху, через десять минут
// стало бы ясно, что это та же игра в другой краске.
//
// Деньги, токены, ключи-слёзы, посылки, руны и питомцы — общие с шахтой.
// Своё у леса — топоры, штабель, разряды лесоруба и план в кубометрах: на
// лесоповале нормы исторически и мерили кубами.

import {
  bonusOf,
  handleRate,
  HANDLES,
  liveEvent,
  modsOf,
  nice,
  NO_PERKS,
  pickLevelOf,
  PROP_BOARDS,
  rng32,
  rollTier,
  STREAK_TIERS,
} from './prison';
import type { CaseTier, PrisonState } from './prison';

// ---------------------------------------------------------------------------
// Породы — по делянкам, как породы камня по шахтам. Кольский лес: от ивы у
// ручья до карельской берёзы, самой дорогой берёзы на свете (узорчатая).
// ---------------------------------------------------------------------------

export interface Species {
  id: string;
  name: string;
  /** Род в «План: 12 м³ …» — родительный падеж. */
  gen: string;
  /** Хвойная — крона ёлочкой; лиственная — шапкой. */
  conifer: boolean;
  /** Кора: основа, тень, светлые штрихи. */
  bark: string;
  dark: string;
  light: string;
  /** Крона. */
  leaf: string;
  /** Цвет щепы — срез древесины. */
  wood: string;
  /** Прочность бревна и цена за бревно. */
  hp: number;
  value: number;
}

type SpeciesDef = Omit<Species, 'hp' | 'value'>;

const SPECIES_DEFS: SpeciesDef[] = [
  {
    id: 'willow',
    name: 'Ива',
    gen: 'ивы',
    conifer: false,
    bark: '#6f6a58',
    dark: '#4c4838',
    light: '#8f8a74',
    leaf: '#8fb85a',
    wood: '#e8dcb8',
  },
  {
    id: 'alder',
    name: 'Ольха',
    gen: 'ольхи',
    conifer: false,
    bark: '#5e5f5a',
    dark: '#3f403c',
    light: '#858680',
    leaf: '#4f8a3a',
    wood: '#e8a86a',
  },
  {
    id: 'aspen',
    name: 'Осина',
    gen: 'осины',
    conifer: false,
    bark: '#8a9480',
    dark: '#5e6858',
    light: '#b0baa4',
    leaf: '#c8b43a',
    wood: '#f2ead0',
  },
  {
    id: 'birch',
    name: 'Берёза',
    gen: 'берёзы',
    conifer: false,
    bark: '#e8e6de',
    dark: '#2a2826',
    light: '#ffffff',
    leaf: '#9ccc4a',
    wood: '#f4e8c8',
  },
  {
    id: 'rowan',
    name: 'Рябина',
    gen: 'рябины',
    conifer: false,
    bark: '#7a6a5e',
    dark: '#54463c',
    light: '#a08e80',
    leaf: '#5a9a3a',
    wood: '#e2c49a',
  },
  {
    id: 'pine',
    name: 'Сосна',
    gen: 'сосны',
    conifer: true,
    bark: '#a0603a',
    dark: '#6a3a20',
    light: '#d08a5a',
    leaf: '#2e6a3a',
    wood: '#f0d49a',
  },
  {
    id: 'spruce',
    name: 'Ель',
    gen: 'ели',
    conifer: true,
    bark: '#5a4a3e',
    dark: '#3a2e26',
    light: '#7e6a5a',
    leaf: '#1e4a32',
    wood: '#f4e4c0',
  },
  {
    id: 'larch',
    name: 'Лиственница',
    gen: 'лиственницы',
    conifer: true,
    bark: '#8a4a32',
    dark: '#5a2c1c',
    light: '#b8704e',
    leaf: '#8aa83a',
    wood: '#d88a5a',
  },
  {
    id: 'juniper',
    name: 'Можжевельник',
    gen: 'можжевельника',
    conifer: true,
    bark: '#7a5a48',
    dark: '#4e382c',
    light: '#a88470',
    leaf: '#3a6a5a',
    wood: '#e8b890',
  },
  {
    id: 'karelian',
    name: 'Карельская берёза',
    gen: 'карельской берёзы',
    conifer: false,
    bark: '#dedad0',
    dark: '#3a3028',
    light: '#fffaf0',
    leaf: '#b8d85a',
    wood: '#d8a060',
  },
];

export const SPECIES: Species[] = SPECIES_DEFS.map((d, i) => ({
  ...d,
  hp: Math.round(3 * Math.pow(1.31, i)),
  value: Math.round(4 * Math.pow(1.42, i)),
}));

/** Делянок и разрядов столько же, сколько пород. */
export const PLOTS = SPECIES.length;
export const LAST_PLOT = PLOTS - 1;

/** Породы, на которых растёт чага (берёзовый гриб). */
const CHAGA_SPECIES = new Set([3, 9]);

// ---------------------------------------------------------------------------
// Дерево. Собирается из зерна: в сохранении только зерно и сколько брёвен
// срублено. Первые два бревна без сучьев — дать размахнуться.
// ---------------------------------------------------------------------------

export type LogKind = 'plain' | 'figured' | 'burl' | 'hollow' | 'chaga';
export type Side = 'L' | 'R';

export interface Log {
  kind: LogKind;
  /** Сучок с этой стороны на высоте бревна (null — без сучка). */
  branch: Side | null;
}

export interface Tree {
  species: number;
  /** Сейд-сосна — священное дерево саамов. */
  seid: boolean;
  logs: Log[];
}

/** Доля деревьев своей породы на делянке; остальные — порода прошлой. */
export const PLOT_OWN = 0.65;
/** Изредка на делянке растёт порода следующей — подсказка, за чем идти. */
export const NEXT_TREE_CHANCE = 0.03;
export const SEID_TREE_CHANCE = 1 / 30;
export const BRANCH_CHANCE = 0.45;
export const FIGURED_CHANCE = 0.05;
/** Капокорень — нарост на комле: только нижнее бревно, у 8% деревьев. */
export const BURL_CHANCE = 0.08;
export const HOLLOW_CHANCE = 0.02;
export const CHAGA_CHANCE = 0.04;

export const KIND_VALUE: Record<LogKind, number> = {
  plain: 1,
  figured: 3,
  burl: 10,
  hollow: 1,
  chaga: 1,
};

export function buildTree(plot: number, seed: number): Tree {
  const rnd = rng32(seed * 53 + plot * 977 + 3);
  let species = plot;
  const x = rnd();
  if (plot > 0 && x > PLOT_OWN) species = plot - 1;
  if (plot < LAST_PLOT && rnd() < NEXT_TREE_CHANCE) species = plot + 1;
  const seid = rnd() < SEID_TREE_CHANCE;
  let n = 8 + Math.floor(rnd() * 5) + Math.floor(plot * 0.7);
  if (seid) n = Math.round(n * 1.6);
  const logs: Log[] = [];
  let last: Side | null = null;
  for (let i = 0; i < n; i++) {
    let kind: LogKind = 'plain';
    if (i === 0 && rnd() < BURL_CHANCE) kind = 'burl';
    else if (rnd() < FIGURED_CHANCE) kind = 'figured';
    else if (rnd() < HOLLOW_CHANCE) kind = 'hollow';
    else if (CHAGA_SPECIES.has(species) && rnd() < CHAGA_CHANCE) kind = 'chaga';
    let branch: Side | null = null;
    if (i >= 2 && rnd() < BRANCH_CHANCE) {
      // Сучья чаще чередуются, чем идут подряд с одной стороны: так рубка
      // читается как ритм, а не как случайный шум.
      branch = last && rnd() < 0.6 ? (last === 'L' ? 'R' : 'L') : rnd() < 0.5 ? 'L' : 'R';
      // Но НИКОГДА сразу за сучком с другой стороны: у нижнего сучок справа —
      // стоишь слева; срубил — и сучок следующего падает тебе на голову.
      // Увернуться нельзя, это не ритм, а подстава. Между сменой стороны
      // всегда бревно без сучка — как в Timberman.
      const below = logs[i - 1]?.branch;
      if (below && branch !== below) branch = null;
      if (branch) last = branch;
    }
    logs.push({ kind, branch });
  }
  return { species, seid, logs };
}

/** Прочность бревна: комель толще, капокорень вдвое крепче. */
export function logHp(tree: Tree, i: number): number {
  const base = SPECIES[tree.species].hp;
  const log = tree.logs[i];
  return base * (i === 0 ? 1.4 : 1) * (log?.kind === 'burl' ? 2 : 1);
}

/** Цена бревна до множителей продажи. */
export function logValue(tree: Tree, i: number): number {
  const log = tree.logs[i];
  return SPECIES[tree.species].value * KIND_VALUE[log?.kind ?? 'plain'] * (tree.seid ? 2 : 1);
}

/**
 * Сучок бьёт по лбу в двух случаях: встал на сторону, где сучок у нижнего
 * бревна (`standHit`), или срубил бревно, и на твою сторону опустился
 * сучок следующего (`dropHit`). Правило то же, что в Timberman, и оно
 * всегда решаемо: у бревна один сучок, другая сторона свободна.
 */
export function standHit(tree: Tree, cut: number, side: Side): boolean {
  return tree.logs[cut]?.branch === side;
}

export function dropHit(tree: Tree, cut: number, side: Side): boolean {
  return tree.logs[cut + 1]?.branch === side;
}

// ---------------------------------------------------------------------------
// Топоры и пилы. Лестница кончается советскими бензопилами «Дружба» и
// «Урал» — у пил и звук свой.
// ---------------------------------------------------------------------------

export interface Axe {
  id: string;
  name: string;
  dmg: number;
  rate: number;
  price: number;
  /** Пила, а не топор: звук и иконка другие. */
  saw: boolean;
  /** Цвет лезвия на иконке. */
  head: string;
}

export const AXES: Axe[] = [
  { id: 'rusty', name: 'Ржавый топор', dmg: 1, rate: 3, price: 0, saw: false, head: '#9a6a4a' },
  {
    id: 'carpenter',
    name: 'Плотницкий топор',
    dmg: 2,
    rate: 3.3,
    price: 1_500,
    saw: false,
    head: '#b8c2cc',
  },
  {
    id: 'feller',
    name: 'Лесорубный топор',
    dmg: 4,
    rate: 3.6,
    price: 9_000,
    saw: false,
    head: '#8fa8c0',
  },
  { id: 'cleaver', name: 'Колун', dmg: 7, rate: 3.9, price: 40_000, saw: false, head: '#5b6470' },
  {
    id: 'bowsaw',
    name: 'Лучковая пила',
    dmg: 12,
    rate: 4.3,
    price: 55_000,
    saw: true,
    head: '#c8ccd0',
  },
  {
    id: 'druzhba',
    name: 'Бензопила «Дружба»',
    dmg: 20,
    rate: 5,
    price: 180_000,
    saw: true,
    head: '#d8402a',
  },
  {
    id: 'ural',
    name: 'Бензопила «Урал»',
    dmg: 32,
    rate: 5.6,
    price: 500_000,
    saw: true,
    head: '#e8a020',
  },
];

export const AXE_SHARP_STEP = 0.12;
export const AXE_SHARP_MAX = 15;
export function axeSharpCost(level: number): number {
  return nice(180 * Math.pow(1.62, level));
}

export function axeDamage(axe: number, sharp: number): number {
  const a = AXES[Math.max(0, Math.min(AXES.length - 1, axe))];
  return a.dmg * (1 + AXE_SHARP_STEP * sharp);
}

/** Крит топора: как у кирки — редкий удар втрое. */
export const AXE_CRIT_CHANCE = 0.07;
export const AXE_CRIT_MULT = 3;
/** Оглушение сучком. */
export const BRANCH_STUN_MS = 700;

// ---------------------------------------------------------------------------
// Штабель и лесовоз — рюкзак и вагонетка леса.
// ---------------------------------------------------------------------------

export const PILE_MAX = 10;
export function pileCapacity(level: number): number {
  return Math.round(60 * Math.pow(1.35, level));
}
export function pileCost(level: number): number {
  return nice(250 * Math.pow(2, level));
}
export const TRUCK_PRICE = 3_000;

export interface Pile {
  /** Брёвен в штабеле. */
  n: number;
  /** Их цена до множителей продажи. */
  value: number;
  /**
   * Брёвен каждой породы (v2.53): пилораме нужно знать, что пилить. Особые
   * брёвна и дрова с кроны сидят в `value` сверх «голой» цены пород — эту
   * надбавку платят сразу, когда штабель уходит в пилораму.
   */
  sp: number[];
}

export const emptyPile = (): Pile => ({ n: 0, value: 0, sp: new Array<number>(PLOTS).fill(0) });

/** «Голая» цена брёвен штабеля: только породы, без свили и кроны. */
export function pileBase(pile: Pile): number {
  return pile.sp.reduce((sum, k, i) => sum + k * SPECIES[i].value, 0);
}

// ---------------------------------------------------------------------------
// Разряды лесоруба и план в кубометрах. Разряд — это делянка: новый разряд
// открывает следующую породу. Как и в шахте, одних денег мало — нужно
// сдать план своей породы; недобор можно откупить общими деньгами.
// ---------------------------------------------------------------------------

export const FOREST_BASE = 500;
export const FOREST_GROWTH = 1.8;
/** Кубометров в бревне. */
export const LOG_M3 = 0.1;
/** План — такая доля брёвен, которые нужно продать на цену разряда. */
export const PLAN_SHARE = 0.75;
export const PLAN_BUYOUT = 0.6;

export function forestRankCost(rank: number): number {
  return nice(FOREST_BASE * Math.pow(FOREST_GROWTH, rank));
}

/** Средняя цена бревна делянки — по составу и особым брёвнам. */
export function avgLogValue(plot: number): number {
  const own = SPECIES[plot].value;
  const prev = plot > 0 ? SPECIES[plot - 1].value : own;
  const mix = plot > 0 ? PLOT_OWN * own + (1 - PLOT_OWN) * prev : own;
  // Свиль ×3 у 5% брёвен, капокорень ×10 у одного бревна из ~12 у 8% деревьев.
  const special = 1 + FIGURED_CHANCE * 2 + (BURL_CHANCE * 9) / 12;
  return mix * special;
}

/** Средняя прочность бревна делянки. */
export function avgLogHp(plot: number): number {
  const own = SPECIES[plot].hp;
  const prev = plot > 0 ? SPECIES[plot - 1].hp : own;
  return plot > 0 ? PLOT_OWN * own + (1 - PLOT_OWN) * prev : own;
}

/** План разряда: сколько брёвен своей породы сдать (в сохранении — брёвна). */
export function forestPlan(rank: number): number {
  const logs = (forestRankCost(rank) / avgLogValue(rank)) * PLAN_SHARE * PLOT_OWN;
  return Math.max(20, nice(logs));
}

/** Кубы для подписи: 12,4 м³. */
export function toM3(logs: number): string {
  return (Math.round(logs * LOG_M3 * 10) / 10).toLocaleString('ru-RU');
}

/** Откуп недобора плана. 0 — план сдан. */
export function planBuyout(rank: number, have: number): number {
  const need = forestPlan(rank);
  const left = Math.max(0, 1 - have / need);
  if (left <= 0) return 0;
  return Math.max(10, nice(forestRankCost(rank) * PLAN_BUYOUT * left));
}

// ---------------------------------------------------------------------------
// Чары топора (v2.53). Свои, не кирочные: у рубки другой бой — ритм, сучья,
// дерево целиком. Платятся ОБЩИМИ токенами: шахта и лес тянут из одного
// кармана, и в этом выбор, куда вложить. Уровень топора растёт от брёвен,
// как уровень кирки от блоков, и так же открывает чары по веткам.
// ---------------------------------------------------------------------------

export type AxeEnchId = 'chips' | 'resin' | 'sense' | 'swing' | 'fell' | 'storm';

export interface AxeEnch {
  id: AxeEnchId;
  name: string;
  per: string;
  max: number;
  base: number;
  inc: number;
  glyph: string;
  /** С какого уровня топора открывается. */
  unlock: number;
}

export const AXE_ENCHANTS: AxeEnch[] = [
  {
    id: 'chips',
    name: 'Щепа',
    per: '+4% к шансу лишнего бревна',
    max: 20,
    base: 60,
    inc: 35,
    glyph: '⟡',
    unlock: 1,
  },
  {
    id: 'resin',
    name: 'Живица',
    per: '+20% токенов с брёвен',
    max: 15,
    base: 50,
    inc: 30,
    glyph: '✦',
    unlock: 1,
  },
  {
    id: 'sense',
    name: 'Чутьё',
    per: '+8% увернуться от сучка, опасный сучок подсвечен',
    max: 10,
    base: 70,
    inc: 45,
    glyph: '◉',
    unlock: 3,
  },
  {
    id: 'swing',
    name: 'Замах',
    per: '+2% срубить два бревна разом',
    max: 20,
    base: 90,
    inc: 55,
    glyph: '⇶',
    unlock: 6,
  },
  {
    id: 'fell',
    name: 'Валка',
    per: '+0,4% повалить дерево с одного удара',
    max: 15,
    base: 120,
    inc: 80,
    glyph: '⤓',
    unlock: 12,
  },
  {
    id: 'storm',
    name: 'Бурелом',
    per: '+2% падающее дерево валит соседнее',
    max: 15,
    base: 140,
    inc: 90,
    glyph: '≋',
    unlock: 18,
  },
];

export const axeEnchOf = (id: AxeEnchId): AxeEnch => AXE_ENCHANTS.find((e) => e.id === id)!;

export type AxeEnchants = Record<AxeEnchId, number>;

export const NO_AXE_ENCH: AxeEnchants = {
  chips: 0,
  resin: 0,
  sense: 0,
  swing: 0,
  fell: 0,
  storm: 0,
};

export function axeEnchCost(id: AxeEnchId, level: number): number {
  const e = axeEnchOf(id);
  return e.base + e.inc * level;
}

/**
 * Опыт топора — срубленные брёвна, по три за штуку: бревно рубится дольше
 * блока, и без множителя топор к концу лестницы едва дорос бы до середины.
 */
export const AXE_XP_PER_LOG = 3;

export function axeLevelOf(logs: number): { level: number; into: number; need: number } {
  const l = pickLevelOf(logs * AXE_XP_PER_LOG);
  return {
    level: l.level,
    into: Math.floor(l.into / AXE_XP_PER_LOG),
    need: Math.ceil(l.need / AXE_XP_PER_LOG),
  };
}

/** Потолок чары топора: как у кирки — к 40-му уровню открыт весь. */
export function axeEnchCap(id: AxeEnchId, axeLevel: number): number {
  const e = axeEnchOf(id);
  if (axeLevel < e.unlock) return 0;
  return Math.min(e.max, 3 + Math.floor((axeLevel * e.max) / 40));
}

// ---------------------------------------------------------------------------
// Множители. Лес берёт у персонажа то, что «на нём»: руны, питомца, перки,
// престиж, коллекцию и рукоять. Чары кирки топору не передаются — у топора
// свои (выше).
// ---------------------------------------------------------------------------

export interface ForestMods {
  dmg: number;
  rate: number;
  sell: number;
  /** Ожидаемые лишние брёвна с одного срубленного. */
  loot: number;
  tokenChance: number;
  keyChance: number;
  parcelChance: number;
  /** Чутьё: шанс, что сучок пролетит мимо. */
  dodge: number;
  /** Замах: шанс срубить два бревна одним ударом. */
  swing: number;
  /** Валка: шанс, что дерево падает целиком. */
  fell: number;
  /** Бурелом: шанс, что поваленное дерево валит следующее. */
  storm: number;
}

export function forestMods(p: PrisonState, f?: { ench?: AxeEnchants }): ForestMods {
  const m = modsOf(p);
  const b = bonusOf(p);
  const k = p.perks ?? NO_PERKS;
  const e = f?.ench ?? NO_AXE_ENCH;
  return {
    dmg: 1 + b.dmg,
    rate: (1 + 0.08 * k.grip) * (1 + b.rate) * (1 + handleRate(p.handle)),
    sell: m.sell,
    loot: b.loot + 0.04 * e.chips,
    tokenChance: m.tokenChance * (1 + 0.2 * e.resin),
    keyChance: m.keyChance,
    parcelChance: m.parcelChance,
    dodge: Math.min(0.8, 0.08 * e.sense),
    // Совило множит шансы чар и топора, не только кирки: оберег один.
    swing: 0.02 * e.swing * (1 + b.proc),
    fell: 0.004 * e.fell * (1 + b.proc),
    // Буря во дворе: каждое поваленное дерево тянет соседнее.
    storm: liveEvent(p)?.id === 'blizzard' ? 1 : 0.02 * e.storm * (1 + b.proc),
  };
}

/**
 * Сколько брёвен уходит этим ударом. Валка проверяется первой: она редкая
 * и перекрывает замах. На двух последних брёвнах валке валить нечего.
 * Бурелом — только когда дерево упало, как бы оно ни упало.
 */
export interface CutPlan {
  take: number;
  how: 'one' | 'swing' | 'fell';
  storm: boolean;
}

export function planCut(tree: Tree, index: number, fm: ForestMods, rnd: () => number): CutPlan {
  const left = tree.logs.length - index;
  let take = 1;
  let how: CutPlan['how'] = 'one';
  if (left > 2 && rnd() < fm.fell) {
    take = left;
    how = 'fell';
  } else if (left > 1 && rnd() < fm.swing) {
    take = 2;
    how = 'swing';
  }
  const storm = index + take >= tree.logs.length && rnd() < fm.storm;
  return { take, how, storm };
}

// ---------------------------------------------------------------------------
// Что даёт срубленное бревно.
// ---------------------------------------------------------------------------

export type HollowPrize =
  | { kind: 'keys'; amount: number }
  | { kind: 'parcel'; tier: CaseTier }
  | { kind: 'tokens'; amount: number };

export interface Chop {
  /** Брёвен в штабель (с лишними от добычи и запала). */
  units: number;
  /** Их цена до множителей продажи. */
  value: number;
  tokens: number;
  keys: number;
  parcels: CaseTier[];
  /** Что лежало в дупле. */
  hollow: HollowPrize | null;
  /** Токены за чагу. */
  chaga: number;
}

export const SEID_LOG_TOKENS: [number, number] = [2, 4];

export function rollChop(
  tree: Tree,
  i: number,
  fm: ForestMods,
  rnd: () => number,
  streak = 0,
): Chop {
  const log = tree.logs[i];
  let n = 1;
  const extra = fm.loot + (1 + fm.loot) * streak;
  n += Math.floor(extra) + (rnd() < extra - Math.floor(extra) ? 1 : 0);
  const out: Chop = {
    units: n,
    value: logValue(tree, i) * n,
    tokens: 0,
    keys: 0,
    parcels: [],
    hollow: null,
    chaga: 0,
  };
  if (rnd() < fm.tokenChance) out.tokens += 1 + Math.floor(rnd() * 3);
  if (tree.seid) {
    const [lo, hi] = SEID_LOG_TOKENS;
    out.tokens += lo + Math.floor(rnd() * (hi - lo + 1));
  }
  if (rnd() < fm.keyChance) out.keys += 1;
  if (rnd() < fm.parcelChance) out.parcels.push(rollTier(rnd));
  if (log?.kind === 'hollow') {
    const x = rnd();
    out.hollow =
      x < 0.35
        ? { kind: 'keys', amount: 1 }
        : x < 0.65
          ? { kind: 'parcel', tier: rollTier(rnd) }
          : { kind: 'tokens', amount: 15 + Math.floor(rnd() * 26) };
  }
  if (log?.kind === 'chaga') out.chaga = 10 + Math.floor(rnd() * 21);
  return out;
}

/**
 * Сложить брёвна одного удара (замах, валка, бурелом) в одно. Дупла идут
 * отдельным списком: у каждого свой приз, и страница показывает их все.
 */
export function sumChops(list: Chop[]): { chop: Chop; hollows: HollowPrize[] } {
  const chop: Chop = {
    units: 0,
    value: 0,
    tokens: 0,
    keys: 0,
    parcels: [],
    hollow: null,
    chaga: 0,
  };
  const hollows: HollowPrize[] = [];
  for (const c of list) {
    chop.units += c.units;
    chop.value += c.value;
    chop.tokens += c.tokens;
    chop.keys += c.keys;
    chop.parcels.push(...c.parcels);
    chop.chaga += c.chaga;
    if (c.hollow) {
      hollows.push(c.hollow);
      chop.hollow ??= c.hollow;
    }
  }
  return { chop, hollows };
}

/** Бонус за поваленное дерево: дрова с кроны. Сейд-сосна — ещё и токены. */
export function fellBonus(tree: Tree, plot: number): { value: number; tokens: number } {
  return {
    value: SPECIES[tree.species].value * 3 * (tree.seid ? 2 : 1),
    tokens: tree.seid ? 40 + 8 * plot : 0,
  };
}

// ---------------------------------------------------------------------------
// Темп — та же модель, что в тесте.
// ---------------------------------------------------------------------------

/** Ожидаемое число ударов на бревно. */
export function hitsPerLog(hp: number, dmg: number): number {
  const mean = dmg * (1 + AXE_CRIT_CHANCE * (AXE_CRIT_MULT - 1));
  return Math.max(1, Math.ceil(hp / mean - 1e-9));
}

/** Брёвен в секунду на удержании у игрока, который не ловит сучья. */
export function logRate(plot: number, axe: number, sharp: number, fm: ForestMods): number {
  const dmg = axeDamage(axe, sharp) * fm.dmg;
  // Комель толще прочих — вклад одного бревна из ~12.
  const hits = hitsPerLog(avgLogHp(plot) * (1 + 0.4 / 12), dmg);
  return (AXES[axe].rate * fm.rate) / hits;
}

// ---------------------------------------------------------------------------
// Пилорама (v2.53). Брёвна из штабеля уходят в очередь и распиливаются в
// доски сами — и пока ты в шахте, и пока телефон в кармане. Доска дороже
// бревна (`BOARD_MULT`), но ждёт своего часа; из досок сбивают крепь для
// шахты и рукояти для кирки и топора. Пилит дорогие породы вперёд.
// ---------------------------------------------------------------------------

export const MILL_MAX = 6;
export const BOARD_MULT = 1.5;
/** Очередь — на два часа работы: пилит и без тебя, но не бесконечно. */
export const MILL_QUEUE_HOURS = 2;

export interface Mill {
  /** 0 — пилорамы нет. */
  level: number;
  /** Брёвен в очереди, по породам. */
  queue: number[];
  /** Готовых досок, по породам. */
  boards: number[];
  /** Когда очередь пересчитана (мс эпохи). */
  at: number;
  /** Дробная часть распила: бревно, распиленное наполовину. */
  part: number;
}

/**
 * Брёвен в минуту. Первая пилорама успевает за ржавым топором, шестая — за
 * «Уралом»: иначе она пилила бы долю того, что рубишь, и не окупалась.
 */
export function millRate(level: number): number {
  return level <= 0 ? 0 : 40 * Math.pow(1.45, level - 1);
}

/** Цена следующего уровня (0 → 1 — покупка самой пилорамы). */
export function millCost(level: number): number {
  return nice(1500 * Math.pow(2.3, level));
}

export function millQueueCap(level: number): number {
  return Math.round(millRate(level) * 60 * MILL_QUEUE_HOURS);
}

export const sumRow = (r: number[]): number => r.reduce((a, b) => a + b, 0);

/** Досчитать распил к моменту `now`. Чистая функция: стор и страница зовут одну. */
export function millTick(m: Mill, now: number): Mill {
  if (m.level <= 0 || !m.at) return { ...m, at: now };
  const elapsed = Math.max(0, Math.min(now - m.at, 7 * 86_400_000));
  let can = (millRate(m.level) / 60_000) * elapsed + m.part;
  const queue = [...m.queue];
  const boards = [...m.boards];
  for (let i = queue.length - 1; i >= 0 && can >= 1; i--) {
    const k = Math.min(queue[i], Math.floor(can));
    queue[i] -= k;
    boards[i] += k;
    can -= k;
  }
  return { ...m, queue, boards, at: now, part: sumRow(queue) > 0 ? can : 0 };
}

/**
 * Подать бревно в пилу рукой: одно, самое дорогое из очереди, — сразу в
 * доску. Пила и так режет сама; тап — чтобы у пилорамы было что делать
 * пальцем, а не только ждать. Больше, чем нарублено, не распилишь: выгода
 * от рук упирается в штабель, а не в скорость тапа.
 */
export function millFeedOne(m: Mill): { mill: Mill; species: number } | null {
  if (m.level <= 0) return null;
  for (let i = m.queue.length - 1; i >= 0; i--) {
    if (m.queue[i] <= 0) continue;
    const queue = [...m.queue];
    const boards = [...m.boards];
    queue[i] -= 1;
    boards[i] += 1;
    return {
      mill: { ...m, queue, boards, part: sumRow(queue) > 0 ? m.part : 0 },
      species: i,
    };
  }
  return null;
}

/** Цена досок до множителей продажи. */
export function boardsValue(boards: number[]): number {
  return boards.reduce((sum, k, i) => sum + k * SPECIES[i].value * BOARD_MULT, 0);
}

/**
 * Загрузить штабель в пилораму: сколько влезет в очередь, дорогие породы
 * вперёд. Надбавка за особые брёвна и дрова с кроны платится сразу — её
 * пилить не нужно, и в очереди она потерялась бы.
 */
export function millLoad(
  pile: Pile,
  mill: Mill,
): {
  pile: Pile;
  mill: Mill;
  loaded: number;
  premium: number;
} {
  const room = Math.max(0, millQueueCap(mill.level) - sumRow(mill.queue));
  if (mill.level <= 0 || room <= 0 || pile.n <= 0) return { pile, mill, loaded: 0, premium: 0 };
  const premium = Math.max(0, pile.value - pileBase(pile));
  const sp = [...pile.sp];
  const queue = [...mill.queue];
  let left = room;
  let loaded = 0;
  for (let i = sp.length - 1; i >= 0 && left > 0; i--) {
    const k = Math.min(sp[i], left);
    sp[i] -= k;
    queue[i] += k;
    left -= k;
    loaded += k;
  }
  const rest: Pile = { n: pile.n - loaded, value: 0, sp };
  rest.value = pileBase(rest);
  return { pile: rest, mill: { ...mill, queue }, loaded, premium };
}

/**
 * Сколько досок держать на следующую рукоять: продажа их не трогает, а
 * крепь берёт в последнюю очередь.
 */
export function boardsReserve(handle: number): number[] {
  const r = emptyRow();
  const next = HANDLES[handle];
  if (next) r[next.species] = next.boards;
  return r;
}

/** Снять `n` досок: сперва дешёвые сверх запаса, потом — из запаса. */
export function takeBoards(boards: number[], n: number, reserve: number[]): number[] | null {
  if (sumRow(boards) < n) return null;
  const out = [...boards];
  let left = n;
  for (const useReserve of [false, true]) {
    for (let i = 0; i < out.length && left > 0; i++) {
      const free = useReserve ? out[i] : Math.max(0, out[i] - reserve[i]);
      const k = Math.min(free, left);
      out[i] -= k;
      left -= k;
    }
  }
  return out;
}

/** Доски на продажу — всё, кроме запаса на рукоять. */
export function boardsForSale(boards: number[], reserve: number[]): number[] {
  return boards.map((k, i) => Math.max(0, k - reserve[i]));
}

export { PROP_BOARDS };

// ---------------------------------------------------------------------------
// Верстак (v2.57). Из досок собирают три рода вещей, и у каждой видно, КУДА
// она уходит: крепь — в ряд расходников шахты, рукоять — на кирку и топор,
// заказ — заказчику за деньги. Владелец спросил «а потом что с ними? они
// продаются? почему не видно?» — поэтому заказы и есть «продажа вещей», а
// собирают всё молотком, ударами по верстаку.
// ---------------------------------------------------------------------------

export interface BenchItem {
  id: string;
  name: string;
  /** Кому и зачем — одна строка на заказе. */
  who: string;
  boards: [number, number];
  /** Сколько ударов молотком. */
  strikes: number;
}

export const BENCH_ITEMS: BenchItem[] = [
  { id: 'box', name: 'Ящик', who: 'для рыбзавода', boards: [6, 10], strikes: 4 },
  { id: 'stool', name: 'Табурет', who: 'в барак', boards: [5, 8], strikes: 4 },
  { id: 'skis', name: 'Лыжи', who: 'охотнику-промысловику', boards: [8, 12], strikes: 5 },
  { id: 'barrel', name: 'Бочка', who: 'под засол трески', boards: [12, 18], strikes: 6 },
  { id: 'frame', name: 'Оконная рама', who: 'в новый дом', boards: [10, 16], strikes: 5 },
  { id: 'sled', name: 'Сани-волокуши', who: 'оленеводу', boards: [16, 24], strikes: 6 },
  { id: 'boat', name: 'Карбас', who: 'поморам на Белое море', boards: [30, 44], strikes: 8 },
];

export const benchItemOf = (id: string): BenchItem =>
  BENCH_ITEMS.find((b) => b.id === id) ?? BENCH_ITEMS[0];

export interface BenchOrder {
  item: string;
  /** Порода досок; −1 — любые. */
  species: number;
  boards: number;
  coins: number;
  tokens: number;
  /** С какого момента заказ можно сдать (после прошлого — пауза). */
  at: number;
}

export const BENCH_SLOTS = 3;
/** Новый заказ после сданного — через десять минут. */
export const BENCH_COOLDOWN_MS = 10 * 60_000;
/** Заказ платит больше продажи тех же досок: работа стоит денег. */
export const BENCH_MULT = 1.6;

/** Ударов молотком на крепь и рукоять. */
export const PROP_STRIKES = 4;
export const HANDLE_STRIKES = 8;

/**
 * Заказ номер `seq`: из зерна, поэтому одинаков при каждом открытии. Порода —
 * чаще своя делянка, иногда «любые доски», иногда прошлая порода (у кого
 * запасы). Большие вещи (карбас) — только с пятого разряда.
 */
export function benchOrder(seq: number, forestRank: number): Omit<BenchOrder, 'at'> {
  const rnd = rng32(seq * 7919 + 29);
  const pool = BENCH_ITEMS.filter((b) => b.id !== 'boat' || forestRank >= 4);
  const item = pool[Math.floor(rnd() * pool.length)];
  const x = rnd();
  const species =
    x < 0.5 ? forestRank : x < 0.8 ? -1 : Math.max(0, forestRank - 1 - Math.floor(rnd() * 2));
  const [lo, hi] = item.boards;
  const boards = lo + Math.floor(rnd() * (hi - lo + 1));
  const unit = SPECIES[species < 0 ? Math.max(0, forestRank - 1) : species].value * BOARD_MULT;
  return {
    item: item.id,
    species,
    boards,
    coins: nice(boards * unit * BENCH_MULT),
    tokens: 2 + Math.floor(boards / 4),
  };
}

/** Заказы на верстаке, дозаполненные до трёх. */
export function benchOrders(
  bench: Bench,
  forestRank: number,
): { bench: Bench; orders: BenchOrder[] } {
  if (bench.orders.length >= BENCH_SLOTS) return { bench, orders: bench.orders };
  let seq = bench.seq;
  const orders = [...bench.orders];
  while (orders.length < BENCH_SLOTS) {
    seq += 1;
    orders.push({ ...benchOrder(seq, forestRank), at: 0 });
  }
  const next = { seq, orders };
  return { bench: next, orders };
}

/** Хватает ли досок на заказ (любые — с учётом запаса на рукоять). */
export function benchCan(boards: number[], o: BenchOrder, reserve: number[]): boolean {
  if (o.species >= 0) return boards[o.species] >= o.boards;
  return sumRow(boardsForSale(boards, reserve)) >= o.boards;
}

export interface Bench {
  seq: number;
  orders: BenchOrder[];
}

// ---------------------------------------------------------------------------
// Сохранение.
// ---------------------------------------------------------------------------

export interface ForestState {
  /** Разряд лесоруба = делянка (0…LAST_PLOT). */
  rank: number;
  axe: number;
  sharp: number;
  pileLevel: number;
  truck: boolean;
  pile: Pile;
  /** План: сколько брёвен своей породы сдано на этом разряде. */
  plan: number;
  /** Текущее дерево: зерно и сколько брёвен срублено. */
  tree: { seed: number; cut: number };
  felled: number;
  logs: number;
  earned: number;
  /** Сейд-сосен повалено. */
  seids: number;
  /** Чары топора (v2.53). */
  ench: AxeEnchants;
  /** Пилорама (v2.53). */
  mill: Mill;
  /** Верстак: заказы (v2.57). */
  bench: Bench;
}

export const newTreeSeed = (): number => Math.floor(Math.random() * 2 ** 31);

export const FOREST_START: ForestState = {
  rank: 0,
  axe: 0,
  sharp: 0,
  pileLevel: 0,
  truck: false,
  pile: { n: 0, value: 0, sp: new Array<number>(PLOTS).fill(0) },
  plan: 0,
  tree: { seed: 1, cut: 0 },
  felled: 0,
  logs: 0,
  earned: 0,
  seids: 0,
  ench: NO_AXE_ENCH,
  mill: {
    level: 0,
    queue: new Array<number>(PLOTS).fill(0),
    boards: new Array<number>(PLOTS).fill(0),
    at: 0,
    part: 0,
  },
  bench: { seq: 0, orders: [] },
};

/** Новый лес с нуля: своё зерно дерева, пустые массивы (не общие со стартом). */
export function freshForest(): ForestState {
  return {
    ...FOREST_START,
    pile: emptyPile(),
    mill: { ...FOREST_START.mill, queue: emptyRow(), boards: emptyRow() },
    bench: { seq: Math.floor(Math.random() * 1e6), orders: [] },
    tree: { seed: newTreeSeed(), cut: 0 },
  };
}

const int = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;

const emptyRow = () => new Array<number>(PLOTS).fill(0);

const row = (v: unknown, hi: number): number[] =>
  Array.from({ length: PLOTS }, (_, i) => int(Array.isArray(v) ? v[i] : 0, 0, hi, 0));

export function normalizeForest(raw: Partial<ForestState> | null | undefined): ForestState {
  if (!raw || typeof raw !== 'object') return freshForest();
  const rank = int(raw.rank, 0, LAST_PLOT, 0);
  const seed = int(raw.tree?.seed, 0, 2 ** 31, newTreeSeed());
  const n = buildTree(rank, seed).logs.length;
  const pileN = int(raw.pile?.n, 0, 1e9, 0);
  let sp = row(raw.pile?.sp, 1e9);
  // Штабель из v2.52 не знает пород — считаем его породой своей делянки.
  if (sp.reduce((a, b) => a + b, 0) !== pileN) {
    sp = emptyRow();
    sp[rank] = pileN;
  }
  const m = raw.mill;
  return {
    rank,
    axe: int(raw.axe, 0, AXES.length - 1, 0),
    sharp: int(raw.sharp, 0, AXE_SHARP_MAX, 0),
    pileLevel: int(raw.pileLevel, 0, PILE_MAX, 0),
    truck: raw.truck === true,
    pile: { n: pileN, value: int(raw.pile?.value, 0, 1e15, 0), sp },
    plan: int(raw.plan, 0, 1e9, 0),
    tree: { seed, cut: int(raw.tree?.cut, 0, n - 1, 0) },
    felled: int(raw.felled, 0, 1e9, 0),
    logs: int(raw.logs, 0, 1e12, 0),
    earned: int(raw.earned, 0, 1e15, 0),
    seids: int(raw.seids, 0, 1e9, 0),
    ench: Object.fromEntries(
      AXE_ENCHANTS.map((e) => [e.id, int(raw.ench?.[e.id], 0, e.max, 0)]),
    ) as AxeEnchants,
    mill: {
      level: int(m?.level, 0, MILL_MAX, 0),
      queue: row(m?.queue, 1e9),
      boards: row(m?.boards, 1e9),
      at: int(m?.at, 0, 1e14, 0),
      part: typeof m?.part === 'number' && m.part >= 0 && m.part < 1 ? m.part : 0,
    },
    bench: normalizeBench(raw.bench),
  };
}

function normalizeBench(raw: unknown): Bench {
  const b = raw as Partial<Bench> | null | undefined;
  const orders = (Array.isArray(b?.orders) ? b.orders : [])
    .filter((o) => o && BENCH_ITEMS.some((i) => i.id === o.item))
    .slice(0, BENCH_SLOTS)
    .map((o) => ({
      item: o.item,
      species: int(o.species, -1, LAST_PLOT, -1),
      boards: int(o.boards, 1, 999, 10),
      coins: int(o.coins, 0, 1e12, 0),
      tokens: int(o.tokens, 0, 1e6, 0),
      at: int(o.at, 0, 1e14, 0),
    }));
  return { seq: int(b?.seq, 0, 1e12, 0), orders };
}

/** С какого ранга шахты пускают на лесоповал: сначала — шахта. */
export const FOREST_UNLOCK_RANK = 2;

/** Ступень запала по числу брёвен подряд — те же ступени, что в шахте. */
export { STREAK_TIERS };
