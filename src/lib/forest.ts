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
// Деньги, токены, ключи-слёзы, передачки, руны и питомцы — общие с шахтой.
// Своё у леса — топоры, штабель, разряды лесоруба и план в кубометрах: на
// лесоповале нормы исторически и мерили кубами.

import { bonusOf, modsOf, nice, NO_PERKS, rng32, rollTier, STREAK_TIERS } from './prison';
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
export const PLAN_SHARE = 0.85;
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
// Множители. Лес берёт у персонажа то, что «на нём»: руны, питомца, перки,
// престиж и коллекцию. Чары кирки топору не передаются — у топора в
// «Лесопилке» будут свои.
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
}

export function forestMods(p: PrisonState): ForestMods {
  const m = modsOf(p);
  const b = bonusOf(p);
  const k = p.perks ?? NO_PERKS;
  return {
    dmg: 1 + b.dmg,
    rate: (1 + 0.08 * k.grip) * (1 + b.rate),
    sell: m.sell,
    loot: b.loot,
    tokenChance: m.tokenChance,
    keyChance: m.keyChance,
    parcelChance: m.parcelChance,
  };
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
}

export const newTreeSeed = (): number => Math.floor(Math.random() * 2 ** 31);

export const FOREST_START: ForestState = {
  rank: 0,
  axe: 0,
  sharp: 0,
  pileLevel: 0,
  truck: false,
  pile: { n: 0, value: 0 },
  plan: 0,
  tree: { seed: 1, cut: 0 },
  felled: 0,
  logs: 0,
  earned: 0,
  seids: 0,
};

const int = (v: unknown, lo: number, hi: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;

export function normalizeForest(raw: Partial<ForestState> | null | undefined): ForestState {
  if (!raw || typeof raw !== 'object')
    return { ...FOREST_START, tree: { seed: newTreeSeed(), cut: 0 } };
  const rank = int(raw.rank, 0, LAST_PLOT, 0);
  const seed = int(raw.tree?.seed, 0, 2 ** 31, newTreeSeed());
  const n = buildTree(rank, seed).logs.length;
  return {
    rank,
    axe: int(raw.axe, 0, AXES.length - 1, 0),
    sharp: int(raw.sharp, 0, AXE_SHARP_MAX, 0),
    pileLevel: int(raw.pileLevel, 0, PILE_MAX, 0),
    truck: raw.truck === true,
    pile: { n: int(raw.pile?.n, 0, 1e9, 0), value: int(raw.pile?.value, 0, 1e15, 0) },
    plan: int(raw.plan, 0, 1e9, 0),
    tree: { seed, cut: int(raw.tree?.cut, 0, n - 1, 0) },
    felled: int(raw.felled, 0, 1e9, 0),
    logs: int(raw.logs, 0, 1e12, 0),
    earned: int(raw.earned, 0, 1e15, 0),
    seids: int(raw.seids, 0, 1e9, 0),
  };
}

/** С какого ранга шахты пускают на лесоповал: сначала — шахта. */
export const FOREST_UNLOCK_RANK = 2;

/** Ступень запала по числу брёвен подряд — те же ступени, что в шахте. */
export { STREAK_TIERS };
