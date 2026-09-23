// Бой подземелья без экрана: шаг мира `stepSim(sim, dt, input)`. Страница
// крутит его в цикле кадров и рисует то, что получилось; тесты крутят тот же
// шаг без экрана — поэтому «проходим ли район в своём комплекте» и «сколько
// длится король» проверяются тестом, а не на глаз.
//
// Единицы: клетка = 1, время — секунды. `y` растёт вниз.
//
// Что здесь есть:
//   • герой — движение с разгоном, серия из трёх ударов, тяжёлый удар с
//     зажима, рывок с неуязвимостью, уклон в последний миг, умение, еда;
//   • крысы — стая обходит с флангов и не слипается, всё, что бьёт, сперва
//     замахивается; подрывник ставит шашку, её можно отбить ударом;
//   • режиссёр (как в Left 4 Dead) — нарастание, пик, передышка; норы,
//     гнёзда, засады, спящие стаи, крысиный поток, золотая крыса,
//     сорвавшаяся вагонетка; запах мяса в сидоре зовёт крыс;
//   • ящики, бочки, порох, гнёзда, вагонетки на рельсах;
//   • Крысиный король: катится, хлещет хвостами, зовёт стаю, на половине
//     здоровья распадается на трёх малых.

import {
  AREAS,
  armorCut,
  beastBonus,
  BOSSES,
  CRIT_X,
  goldBag,
  kingLoot,
  levelOf,
  mobStats,
  MOBS,
  sackCap,
  sackCount,
  smellOf,
  ALBINO_CHANCE,
} from './dungeon';
import type {
  Affix,
  AreaId,
  BossId,
  DungeonState,
  Hero,
  MatId,
  MeatId,
  MobId,
  Sack,
  StatId,
} from './dungeon';
import { STREAK_TIERS } from './prison';
import {
  arenaCells,
  bandAt,
  bandOf,
  fogDecode,
  fogSet,
  railAt,
  Tile,
  tileAt,
  toLocal,
  walkableTile,
} from './dungeon-world';
import type { Rail, World, WorldObj } from './dungeon-world';

// ---------------------------------------------------------------------------
// Входы и события.
// ---------------------------------------------------------------------------

export interface SimInput {
  /** Джойстик, длина до 1. */
  mx: number;
  my: number;
  /** Нажали удар в этот шаг. */
  attack: boolean;
  /** Палец всё ещё на кнопке удара. */
  attackHeld: boolean;
  /** Свайп: удар ровно в эту сторону. */
  aim: { x: number; y: number } | null;
  dash: boolean;
  skill: boolean;
  eat: boolean;
  /** Взять цель тапом. */
  lock: number | null;
}

export const NO_INPUT: SimInput = {
  mx: 0,
  my: 0,
  attack: false,
  attackHeld: false,
  aim: null,
  dash: false,
  skill: false,
  eat: false,
  lock: null,
};

export type DropKind =
  | 'meat'
  | 'fatmeat'
  | 'skin'
  | 'tail'
  | 'pyrite'
  | 'crown'
  | 'coin'
  | 'token'
  | 'key';

export type SimEvent =
  | {
      t: 'swing';
      x: number;
      y: number;
      ang: number;
      arc: number;
      reach: number;
      heavy: boolean;
      step: number;
    }
  | { t: 'hit'; x: number; y: number; dmg: number; crit: boolean; kill: boolean; boss: boolean }
  | { t: 'hurt'; x: number; y: number; dmg: number }
  | { t: 'die' }
  | { t: 'kill'; x: number; y: number; mob: MobId; elite: boolean; albino: boolean }
  | { t: 'pick'; x: number; y: number; what: DropKind; n: number }
  | { t: 'full' }
  | { t: 'dash'; x: number; y: number }
  | { t: 'dodge'; x: number; y: number }
  | { t: 'boom'; x: number; y: number; r: number }
  | { t: 'emerge'; x: number; y: number }
  | { t: 'squeak'; x: number; y: number }
  | { t: 'break'; x: number; y: number; kind: string }
  | { t: 'cart'; x: number; y: number; v: number }
  | { t: 'clank'; x: number; y: number }
  | { t: 'level'; level: number }
  | { t: 'eat'; heal: number }
  | { t: 'rumble'; x: number; y: number; what: 'horde' | 'cart' }
  | { t: 'area'; area: AreaId }
  | { t: 'boss'; what: 'wake' | 'split' | 'dead' | 'reset' | 'roll' | 'whip' | 'summon' }
  | { t: 'combo'; n: number }
  | { t: 'streak'; tier: number }
  | { t: 'skill'; x: number; y: number }
  | { t: 'gold'; x: number; y: number }
  | { t: 'fuse'; x: number; y: number }
  | { t: 'charge' };

// ---------------------------------------------------------------------------
// Состояние.
// ---------------------------------------------------------------------------

export type HeroMode =
  | 'free'
  | 'attack'
  | 'charge'
  | 'heavy'
  | 'dash'
  | 'skill'
  | 'eat'
  | 'dying'
  | 'dead';

export interface HeroState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Куда смотрит (угол). */
  face: number;
  hp: number;
  mode: HeroMode;
  /** Время внутри режима. */
  t: number;
  /** Номер удара серии 0…2 и отметка «следующий заказан». */
  step: number;
  queued: boolean;
  /** Когда кончился последний удар — для продолжения серии. */
  lastSwingEnd: number;
  /** Направление текущего удара. */
  aim: number;
  /** Кого уже задел этот удар. */
  hitSet: Set<number>;
  /** Сколько держат кнопку удара и сколько набрано на тяжёлый. */
  held: number;
  charge: number;
  dashCd: number;
  dashDir: number;
  inv: number;
  /** Следующий удар — гарантированный крит (после уклона). */
  sure: boolean;
  /** Умение: 0…1. */
  skill: number;
  eatCd: number;
  lock: number | null;
  /** Подсветка удара по герою, с. */
  flash: number;
  walk: number;
}

export type MobMode =
  | 'emerge'
  | 'drop'
  | 'sleep'
  | 'alert'
  | 'chase'
  | 'windup'
  | 'recover'
  | 'stun'
  | 'flee'
  | 'plant'
  | 'dying'
  | 'roar'
  | 'rollAim'
  | 'roll'
  | 'dizzy'
  | 'whipAim'
  | 'summon'
  | 'escape';

export interface Mob {
  id: number;
  kind: MobId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Отдача от удара — гаснет отдельно от шага. */
  kx: number;
  ky: number;
  r: number;
  hp: number;
  maxHp: number;
  dmg: number;
  speed: number;
  xp: number;
  loot: number;
  mode: MobMode;
  t: number;
  /** Отдых между укусами. */
  cd: number;
  face: number;
  elite: boolean;
  albino: boolean;
  affixes: Affix[];
  /** Откуда пришёл — дальше привязи не уйдёт. */
  hx: number;
  hy: number;
  /** Нора выхода — для эффекта и возврата. */
  burrow: number;
  /** Гнездо, которое его родило. */
  nest: number;
  flash: number;
  /** Поток бежит напролом, без флангов. */
  rush: boolean;
  /** Для короля: направление качения, отскоки, счётчики. */
  dir: number;
  bounces: number;
  summonCd: number;
  /** Появился в этой вылазке из режиссёра (а не стая, не босс). */
  area: AreaId;
  level: number;
}

export type PropKind =
  | 'crate'
  | 'barrel'
  | 'powder'
  | 'nest'
  | 'cartnest'
  | 'cart'
  | 'pillar'
  | 'lantern'
  | 'unlit'
  | 'plaque'
  | 'secret';

export interface Prop {
  id: number;
  kind: PropKind;
  obj: WorldObj;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Вагонетка: скорость вдоль рельсов и сами рельсы. */
  v: number;
  rail: Rail | null;
  /** Кто толкнул последним: сорвавшаяся бьёт героя. */
  wild: boolean;
  /** Гнездо: таймер следующей крысы. */
  spawnT: number;
  /** Порох: фитиль после удара. */
  fuse: number;
  flash: number;
  /** Фонарь зажжён / тайник открыт. */
  on: boolean;
}

export interface Drop {
  id: number;
  kind: DropKind;
  n: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  area: AreaId;
}

export interface Bomb {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
  r: number;
  dmg: number;
}

export interface Burrow {
  obj: WorldObj;
  cd: number;
  sealed: boolean;
}

export interface Director {
  intensity: number;
  phase: 'build' | 'peak' | 'relax';
  phaseT: number;
  spawnT: number;
  hordeT: number;
  hordeWarn: number;
  hordeFrom: number;
  hordeLeft: number;
  goldT: number;
  cartT: number;
  cartWarn: number;
  cartId: number;
  relaxX: number;
  relaxY: number;
  calm: { x: number; y: number; until: number }[];
}

export interface BossFight {
  id: BossId;
  obj: WorldObj;
  cells: Set<number>;
  /** Состояние боя: ждёт героя, идёт, выигран в этой вылазке, отдыхает. */
  state: 'idle' | 'fight' | 'won' | 'rest';
  /** Когда проснётся (время часов, мс). */
  readyAt: number;
  gates: number[];
  split: boolean;
  t: number;
}

/** То, что вылазка добавила к сохранению — сбрасывается страницей в стор. */
export interface SimDelta {
  kills: Partial<Record<MobId, number>>;
  stats: Partial<Record<StatId, number>>;
  xp: number;
  lamps: string[];
  opened: string[];
  secrets: string[];
  bosses: { id: BossId; at: number }[];
}

export interface Sim {
  world: World;
  tiles: Uint8Array;
  time: number;
  rng: () => number;
  now: () => number;
  econ: number;
  stats: Hero;
  hero: HeroState;
  mobs: Mob[];
  props: Prop[];
  drops: Drop[];
  bombs: Bomb[];
  burrows: Burrow[];
  ambushes: { obj: WorldObj; used: boolean }[];
  groups: { obj: WorldObj; used: boolean }[];
  director: Director;
  boss: BossFight | null;
  sack: Sack;
  sackCap: number;
  /** Сколько убито всего — для прибавок бестиария. */
  beast: Partial<Record<MobId, number>>;
  xp: number;
  level: number;
  delta: SimDelta;
  events: SimEvent[];
  nextId: number;
  area: AreaId;
  /** Стоп-кадр и замедление времени — рисует их страница, считает шаг. */
  hitstop: number;
  slowmo: number;
  /** Серия убийств без паузы. */
  streak: number;
  streakAt: number;
  /** Разведка по районам и признак, что её пора сохранить. */
  fog: Partial<Record<AreaId, Uint8Array>>;
  fogDirty: boolean;
  fogT: number;
  /** Поле расстояний до героя — ведёт крыс в обход стен. */
  flow: Int16Array;
  flowT: number;
  /** Сколько убито в этой вылазке. */
  killed: number;
  meters: number;
  fullWarn: number;
  /** Приглушённые клетки — лифт и его окрестность (крысы не выходят). */
  safe: { x: number; y: number }[];
  /** Зажжённые фонари. */
  lit: Set<string>;
  /** Сколько раз били в треснувшую стену. */
  cracks: Map<string, number>;
}

export interface SimOptions {
  world: World;
  dungeon: DungeonState;
  stats: Hero;
  econ: number;
  /** Где появиться: мировые координаты. */
  x: number;
  y: number;
  hp?: number;
  sack?: Sack;
  seed?: number;
  now?: () => number;
  /** Сколько крепи в запасе каторги — ей заколачивают норы. */
  props?: number;
}

// ---------------------------------------------------------------------------
// Постоянные боя.
// ---------------------------------------------------------------------------

export const SWORD = {
  reach: 1.35,
  arc: (110 * Math.PI) / 180,
  /** Удары серии: длительность, начало и конец задевающей фазы, множитель. */
  steps: [
    { dur: 0.27, from: 0.05, to: 0.12, mult: 1, knock: 3.2, arc: 1 },
    { dur: 0.27, from: 0.05, to: 0.12, mult: 1.05, knock: 3.2, arc: 1 },
    { dur: 0.4, from: 0.1, to: 0.18, mult: 1.6, knock: 6, arc: 1.35 },
  ],
  /** Сколько после удара ещё можно продолжить серию. */
  grace: 0.38,
  /** Держать дольше — начинается набор тяжёлого. */
  holdAt: 0.3,
  chargeFull: 0.55,
  heavy: {
    dur: 0.46,
    from: 0.07,
    to: 0.16,
    mult: 2.4,
    knock: 9,
    arc: (220 * Math.PI) / 180,
    reach: 1.62,
  },
};

export const DASH = { dur: 0.18, inv: 0.27, cd: 1.0 };
/** Окно «уклона в последний миг»: удар врага придёт не позже, чем через это. */
export const DODGE_WINDOW = 0.2;
export const SLOWMO = { dur: 0.45, scale: 0.35 };
export const HURT_INV = 0.5;
export const MAGNET = 1.9;
export const PICK_R = 0.4;
export const SAFE_R = 7;
export const MOB_CAP = 24;
export const NEAR_CAP = 14;
export const DESPAWN_R = 34;
export const LEASH = 26;
export const AGGRO = 7.5;
export const STREAK_GRACE = 5;
export const SKILL = { dur: 0.5, reach: 1.9, mult: 1.5, perHit: 0.08 };

/** Кого сколько весит — от этого отдача. */
const MASS: Record<MobId, number> = {
  rat: 1,
  fatrat: 2.6,
  bomber: 1,
  goldrat: 1,
  king: 9,
  kinglet: 4,
};

/** Ступени серии убийств: названия — как у запала шахты, счёт — убийствами. */
export const KILL_STREAK = [5, 15, 35, 70, 120];
export const streakName = (tier: number) =>
  STREAK_TIERS[Math.min(tier, STREAK_TIERS.length - 1)].name;
/** Прибавка серии: к добыче и немного к урону. */
export const STREAK_LOOT = [0.05, 0.1, 0.18, 0.28, 0.4];
export const STREAK_DMG = [0.02, 0.04, 0.07, 0.1, 0.15];

export function streakTierOf(n: number): number {
  let t = -1;
  for (let i = 0; i < KILL_STREAK.length; i++) if (n >= KILL_STREAK[i]) t = i;
  return t;
}

/** Что водится в районе и с каким весом. */
const AREA_MOBS: Partial<Record<AreaId, [MobId, number][]>> = {
  mouth: [
    ['rat', 80],
    ['fatrat', 14],
    ['bomber', 6],
  ],
  haul: [
    ['rat', 55],
    ['fatrat', 26],
    ['bomber', 19],
  ],
};

/** Плотность появления по району. */
const DENSITY: Partial<Record<AreaId, number>> = { mouth: 1, haul: 1.25 };

// ---------------------------------------------------------------------------
// Создание.
// ---------------------------------------------------------------------------

function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PROP_OF: Partial<Record<string, PropKind>> = {
  crate: 'crate',
  barrel: 'barrel',
  powder: 'powder',
  nest: 'nest',
  cartnest: 'cartnest',
  cart: 'cart',
  pillar: 'pillar',
  lantern: 'lantern',
  unlit: 'unlit',
  plaque: 'plaque',
  secret: 'secret',
};

const PROP_R: Record<PropKind, number> = {
  crate: 0.42,
  barrel: 0.36,
  powder: 0.36,
  nest: 0.36,
  cartnest: 0.46,
  cart: 0.44,
  pillar: 0.34,
  lantern: 0.18,
  unlit: 0.18,
  plaque: 0.2,
  secret: 0.34,
};

export function createSim(o: SimOptions): Sim {
  const w = o.world;
  const tiles = w.tiles.slice();
  const d = o.dungeon;
  // Постоянные перемены мира: открытые решётки, найденные тайники.
  for (const obj of w.objs) {
    if (obj.kind === 'grate' && d.opened.includes(obj.id)) tiles[obj.y * w.w + obj.x] = Tile.Floor;
    if (obj.kind === 'crack' && d.opened.includes(obj.id)) tiles[obj.y * w.w + obj.x] = Tile.Floor;
  }
  const lvl = levelOf(d.xp).level;
  const sim: Sim = {
    world: w,
    tiles,
    time: 0,
    rng: lcg(o.seed ?? Date.now() & 0x7fffffff),
    now: o.now ?? (() => Date.now()),
    econ: o.econ,
    stats: o.stats,
    hero: {
      x: o.x,
      y: o.y,
      vx: 0,
      vy: 0,
      r: 0.3,
      face: -Math.PI / 2,
      hp: Math.min(o.stats.maxHp, o.hp ?? o.stats.maxHp),
      mode: 'free',
      t: 0,
      step: -1,
      queued: false,
      lastSwingEnd: -9,
      aim: 0,
      hitSet: new Set(),
      held: 0,
      charge: 0,
      dashCd: 0,
      dashDir: 0,
      inv: 1,
      sure: false,
      skill: 0,
      eatCd: 0,
      lock: null,
      flash: 0,
      walk: 0,
    },
    mobs: [],
    props: [],
    drops: [],
    bombs: [],
    burrows: [],
    ambushes: [],
    groups: [],
    director: {
      intensity: 0,
      phase: 'build',
      phaseT: 0,
      spawnT: 2,
      hordeT: 240 + Math.random() * 180,
      hordeWarn: 0,
      hordeFrom: -1,
      hordeLeft: 0,
      goldT: 300 + Math.random() * 420,
      cartT: 150 + Math.random() * 120,
      cartWarn: 0,
      cartId: -1,
      relaxX: 0,
      relaxY: 0,
      calm: [],
    },
    boss: null,
    sack: o.sack
      ? {
          ...o.sack,
          meat: { ...o.sack.meat },
          mats: { ...o.sack.mats },
          meatBy: { ...o.sack.meatBy },
        }
      : { meat: {}, mats: {}, tokens: 0, keys: 0, coins: 0, meatBy: {} },
    sackCap: sackCap(d.sackLevel),
    beast: { ...d.kills },
    xp: d.xp,
    level: lvl,
    delta: { kills: {}, stats: {}, xp: 0, lamps: [], opened: [], secrets: [], bosses: [] },
    events: [],
    nextId: 1,
    area: bandAt(w, o.y).def.id,
    hitstop: 0,
    slowmo: 0,
    streak: 0,
    streakAt: -99,
    fog: {},
    fogDirty: false,
    fogT: 0,
    flow: new Int16Array(w.w * w.h).fill(-1),
    flowT: 0,
    killed: 0,
    meters: 0,
    fullWarn: -9,
    safe: [],
    lit: new Set(d.lamps),
    cracks: new Map(),
  };
  sim.director.hordeT = 240 + sim.rng() * 180;
  sim.director.goldT = 300 + sim.rng() * 420;
  sim.director.cartT = 150 + sim.rng() * 120;

  for (const b of w.bands) sim.fog[b.def.id] = fogDecode(d.fog[b.def.id], b, w.w);

  for (const obj of w.objs) {
    const kind = PROP_OF[obj.kind];
    if (kind) {
      const hpBase: Partial<Record<PropKind, number>> = {
        crate: 2,
        barrel: 3,
        powder: 1,
        nest: 40,
        cartnest: 60,
      };
      const lvlA = bandAt(w, obj.y).def.level;
      const scale = kind === 'nest' || kind === 'cartnest' ? Math.pow(1.8, lvlA) : 1;
      const hp = (hpBase[kind] ?? 0) * scale;
      const p: Prop = {
        id: sim.nextId++,
        kind,
        obj,
        x: obj.x + 0.5,
        y: obj.y + 0.5,
        r: PROP_R[kind],
        hp,
        maxHp: hp,
        alive: true,
        v: 0,
        rail: kind === 'cart' ? railAt(w, obj.x, obj.y, obj.axis ?? 'v') : null,
        wild: false,
        spawnT: 2 + sim.rng() * 3,
        fuse: 0,
        flash: 0,
        on:
          kind === 'lantern' ||
          (kind === 'unlit' && d.lamps.includes(obj.id)) ||
          (kind === 'secret' && d.secrets.includes(obj.id)),
      };
      sim.props.push(p);
    }
    if (obj.kind === 'burrow' && obj.out) sim.burrows.push({ obj, cd: 0, sealed: false });
    if (obj.kind === 'ambush') sim.ambushes.push({ obj, used: false });
    if (obj.kind === 'group') sim.groups.push({ obj, used: false });
    if (obj.kind === 'lift') sim.safe.push({ x: obj.x + 0.5, y: obj.y + 0.5 });
  }
  // Никакой стаи прямо у точки спуска: иначе вход встречает дракой.
  for (const g of sim.groups) if (Math.hypot(g.obj.x - o.x, g.obj.y - o.y) < 10) g.used = true;

  // Арена короля.
  const bossObj = w.objs.find((x) => x.kind === 'boss');
  if (bossObj) {
    const def = BOSSES[(bossObj.ref as BossId) ?? 'king'];
    const cells = arenaCells(w, bossObj);
    const gates = w.objs.filter((x) => x.kind === 'gate').map((x) => x.y * w.w + x.x);
    const readyAt = (d.bosses[def.id]?.at ?? 0) + def.restMs;
    const resting = readyAt > sim.now();
    sim.boss = {
      id: def.id,
      obj: bossObj,
      cells,
      state: resting ? 'rest' : 'idle',
      readyAt,
      gates,
      split: false,
      t: 0,
    };
  }
  updateGates(sim);
  markFog(sim);
  return sim;
}

// ---------------------------------------------------------------------------
// Клетки и столкновения.
// ---------------------------------------------------------------------------

export function solidTile(sim: Sim, x: number, y: number): boolean {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return true;
  const t = sim.tiles[y * w.w + x];
  return !walkableTile(t);
}

/** Круг против клеток: вытолкнуть наружу, скользя вдоль стены. */
function collideTiles(sim: Sim, e: { x: number; y: number; r: number }): boolean {
  let hit = false;
  const x0 = Math.floor(e.x - e.r) - 1;
  const x1 = Math.floor(e.x + e.r) + 1;
  const y0 = Math.floor(e.y - e.r) - 1;
  const y1 = Math.floor(e.y + e.r) + 1;
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!solidTile(sim, tx, ty)) continue;
      const cx = Math.max(tx, Math.min(e.x, tx + 1));
      const cy = Math.max(ty, Math.min(e.y, ty + 1));
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= e.r * e.r) continue;
      hit = true;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        const push = e.r - d;
        e.x += (dx / d) * push;
        e.y += (dy / d) * push;
      } else {
        // Центр внутри клетки — выталкиваем к ближайшей грани.
        const l = e.x - tx;
        const r = tx + 1 - e.x;
        const t = e.y - ty;
        const b = ty + 1 - e.y;
        const m = Math.min(l, r, t, b);
        if (m === l) e.x = tx - e.r;
        else if (m === r) e.x = tx + 1 + e.r;
        else if (m === t) e.y = ty - e.r;
        else e.y = ty + 1 + e.r;
      }
    }
  }
  return hit;
}

const SOLID_PROPS: PropKind[] = [
  'crate',
  'barrel',
  'powder',
  'nest',
  'cartnest',
  'cart',
  'pillar',
  'lantern',
  'unlit',
  'plaque',
  'secret',
];

function collideProps(sim: Sim, e: { x: number; y: number; r: number }, share = 1): Prop | null {
  let touched: Prop | null = null;
  for (const p of sim.props) {
    if (!p.alive || !SOLID_PROPS.includes(p.kind)) continue;
    const dx = e.x - p.x;
    const dy = e.y - p.y;
    const min = e.r + p.r;
    if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
    const d = Math.hypot(dx, dy);
    if (d >= min || d < 1e-6) continue;
    const push = (min - d) * share;
    e.x += (dx / d) * push;
    e.y += (dy / d) * push;
    touched = p;
  }
  return touched;
}

/** Видно ли по прямой: проход по клеткам без стен. */
export function lineOfSight(sim: Sim, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2);
  for (let i = 1; i < n; i++) {
    const x = Math.floor(ax + (dx * i) / n);
    const y = Math.floor(ay + (dy * i) / n);
    if (solidTile(sim, x, y)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Поле расстояний до героя: крысы идут по нему, если героя не видно.
// ---------------------------------------------------------------------------

const FLOW_R = 26;

function rebuildFlow(sim: Sim): void {
  const w = sim.world;
  const f = sim.flow;
  f.fill(-1);
  const hx = Math.floor(sim.hero.x);
  const hy = Math.floor(sim.hero.y);
  if (solidTile(sim, hx, hy)) return;
  const q = new Int32Array(w.w * (FLOW_R * 2 + 2) * 2);
  let head = 0;
  let tail = 0;
  const start = hy * w.w + hx;
  f[start] = 0;
  q[tail++] = start;
  while (head < tail) {
    const i = q[head++];
    const x = i % w.w;
    const y = (i - x) / w.w;
    const dNow = f[i];
    if (dNow >= FLOW_R * 2) continue;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (Math.abs(ny - hy) > FLOW_R) continue;
      if (solidTile(sim, nx, ny)) continue;
      const j = ny * w.w + nx;
      if (f[j] >= 0) continue;
      f[j] = dNow + 1;
      if (tail < q.length) q[tail++] = j;
    }
  }
}

/** Направление по полю: к соседу с меньшим расстоянием. */
function flowDir(sim: Sim, x: number, y: number, away = false): [number, number] | null {
  const w = sim.world;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const here = sim.flow[cy * w.w + cx];
  if (here < 0) return null;
  let best = here;
  let bx = 0;
  let by = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
      const v = sim.flow[ny * w.w + nx];
      if (v < 0) continue;
      // По диагонали — только если оба боковых свободны: не срезаем угол.
      if (dx && dy && (solidTile(sim, cx + dx, cy) || solidTile(sim, cx, cy + dy))) continue;
      if (away ? v > best : v < best) {
        best = v;
        bx = dx;
        by = dy;
      }
    }
  if (!bx && !by) return null;
  // Цель — центр соседней клетки, а не угол.
  const tx = cx + bx + 0.5 - x;
  const ty = cy + by + 0.5 - y;
  const l = Math.hypot(tx, ty) || 1;
  return [tx / l, ty / l];
}

// ---------------------------------------------------------------------------
// Появление мобов.
// ---------------------------------------------------------------------------

const AFFIX_LIST: Affix[] = ['fast', 'tough', 'leader', 'regen', 'boom'];

export function spawnMob(
  sim: Sim,
  kind: MobId,
  x: number,
  y: number,
  opts: {
    mode?: MobMode;
    elite?: boolean;
    burrow?: number;
    nest?: number;
    rush?: boolean;
    level?: number;
  } = {},
): Mob {
  const band = bandAt(sim.world, y);
  const level = opts.level ?? band.def.level;
  const albino =
    kind !== 'king' && kind !== 'kinglet' && kind !== 'goldrat' && sim.rng() < ALBINO_CHANCE;
  const affixes: Affix[] = opts.elite
    ? [AFFIX_LIST[Math.floor(sim.rng() * AFFIX_LIST.length)]]
    : [];
  const st = mobStats(kind, level, { elite: opts.elite, albino, affixes });
  const m: Mob = {
    id: sim.nextId++,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    kx: 0,
    ky: 0,
    r: MOBS[kind].radius * (opts.elite ? 1.15 : 1),
    hp: st.hp,
    maxHp: st.hp,
    dmg: st.dmg,
    speed: st.speed * (0.92 + sim.rng() * 0.16),
    xp: st.xp,
    loot: st.loot,
    mode: opts.mode ?? 'chase',
    t: 0,
    cd: 0.4 + sim.rng() * 0.5,
    face: 0,
    elite: !!opts.elite,
    albino,
    affixes,
    hx: x,
    hy: y,
    burrow: opts.burrow ?? -1,
    nest: opts.nest ?? -1,
    flash: 0,
    rush: !!opts.rush,
    dir: 0,
    bounces: 0,
    summonCd: 6,
    area: band.def.id,
    level,
  };
  sim.mobs.push(m);
  return m;
}

function pickKind(sim: Sim, area: AreaId): MobId {
  const list = AREA_MOBS[area] ?? AREA_MOBS.mouth!;
  let total = 0;
  for (const [, w] of list) total += w;
  let r = sim.rng() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[0][0];
}

function nearSafe(sim: Sim, x: number, y: number, r = SAFE_R): boolean {
  return sim.safe.some((s) => Math.hypot(s.x - x, s.y - y) < r);
}

function inArena(sim: Sim, x: number, y: number): boolean {
  const b = sim.boss;
  if (!b) return false;
  return b.cells.has(Math.floor(y) * sim.world.w + Math.floor(x));
}

/** Выпустить крысу из норы: она вылезает из стены на пол. */
function fromBurrow(
  sim: Sim,
  b: Burrow,
  kind: MobId,
  opts: { elite?: boolean; rush?: boolean } = {},
): Mob {
  const [ox, oy] = b.obj.out!;
  const m = spawnMob(sim, kind, b.obj.x + 0.5, b.obj.y + 0.5, {
    mode: 'emerge',
    burrow: sim.burrows.indexOf(b),
    elite: opts.elite,
    rush: opts.rush,
  });
  m.hx = ox + 0.5;
  m.hy = oy + 0.5;
  b.cd = 3 + sim.rng() * 3;
  sim.events.push({ t: 'emerge', x: ox + 0.5, y: oy + 0.5 });
  return m;
}

/** Нора для режиссёра: не у клети, не на виду вплотную, с запасом впереди по ходу. */
function pickBurrow(sim: Sim, minD: number, maxD: number): Burrow | null {
  const h = sim.hero;
  const hv = Math.hypot(h.vx, h.vy);
  let total = 0;
  const cand: [Burrow, number][] = [];
  for (const b of sim.burrows) {
    if (b.sealed || b.cd > 0 || !b.obj.out) continue;
    const [ox, oy] = b.obj.out;
    const d = Math.hypot(ox + 0.5 - h.x, oy + 0.5 - h.y);
    if (d < minD || d > maxD) continue;
    if (nearSafe(sim, ox, oy)) continue;
    if (inArena(sim, ox + 0.5, oy + 0.5) && sim.boss?.state !== 'fight') continue;
    // Нора должна вести к герою: по полю расстояний, а не сквозь стену.
    const fl = sim.flow[oy * sim.world.w + ox];
    if (fl < 0 || fl > maxD * 1.6) continue;
    let wgt = 1;
    if (hv > 0.5) {
      const dot = ((ox - h.x) * h.vx + (oy - h.y) * h.vy) / (d * hv);
      if (dot > 0.3) wgt *= 2.2;
    }
    if (sim.director.calm.some((c) => Math.hypot(c.x - ox, c.y - oy) < 10)) wgt *= 0.3;
    cand.push([b, wgt]);
    total += wgt;
  }
  if (!cand.length) return null;
  let r = sim.rng() * total;
  for (const [b, wgt] of cand) {
    r -= wgt;
    if (r <= 0) return b;
  }
  return cand[cand.length - 1][0];
}

function liveMobs(sim: Sim): number {
  let n = 0;
  for (const m of sim.mobs)
    if (m.mode !== 'dying' && m.kind !== 'king' && m.kind !== 'kinglet') n++;
  return n;
}

function nearMobs(sim: Sim, r: number): number {
  let n = 0;
  for (const m of sim.mobs)
    if (m.mode !== 'dying' && Math.hypot(m.x - sim.hero.x, m.y - sim.hero.y) < r) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Режиссёр.
// ---------------------------------------------------------------------------

function stepDirector(sim: Sim, dt: number): void {
  const d = sim.director;
  const h = sim.hero;
  if (h.mode === 'dying' || h.mode === 'dead') return;
  const bossOn = sim.boss?.state === 'fight';
  d.intensity = Math.max(0, d.intensity - 0.06 * dt);
  d.phaseT += dt;
  d.calm = d.calm.filter((c) => c.until > sim.time);
  if (d.phase === 'build' && d.intensity >= 0.85) {
    d.phase = 'peak';
    d.phaseT = 0;
  } else if (d.phase === 'peak' && d.phaseT > 4) {
    d.phase = 'relax';
    d.phaseT = 0;
    d.relaxX = h.x;
    d.relaxY = h.y;
    d.calm.push({ x: h.x, y: h.y, until: sim.time + 180 });
  } else if (d.phase === 'relax') {
    const span = 30 + (d.relaxX % 1) * 15;
    const moved = Math.hypot(h.x - d.relaxX, h.y - d.relaxY);
    if (d.phaseT > span || moved > 18 || (d.phaseT > span * 0.6 && nearMobs(sim, 10) === 0)) {
      d.phase = 'build';
      d.phaseT = 0;
      d.intensity = 0.2;
    }
  }

  const area = sim.area;
  const smell = smellOf(sim.sack);
  const safeNow = nearSafe(sim, h.x, h.y, SAFE_R + 2);

  // Спящие стаи — появляются, когда подходишь.
  for (const g of sim.groups) {
    if (g.used) continue;
    if (Math.hypot(g.obj.x + 0.5 - h.x, g.obj.y + 0.5 - h.y) > 16) continue;
    g.used = true;
    const band = bandAt(sim.world, g.obj.y);
    const n = 3 + Math.floor(sim.rng() * 3);
    const lead = sim.rng() < 0.18;
    for (let i = 0; i < n; i++) {
      const kind =
        band.def.id === 'haul' && i % 2 === 0
          ? 'fatrat'
          : i === 0 && sim.rng() < 0.3
            ? 'bomber'
            : 'rat';
      const a = (i / n) * Math.PI * 2;
      const m = spawnMob(
        sim,
        kind,
        g.obj.x + 0.5 + Math.cos(a) * 0.9,
        g.obj.y + 0.5 + Math.sin(a) * 0.7,
        {
          mode: 'sleep',
          elite: lead && i === 0,
        },
      );
      collideTiles(sim, m);
    }
  }

  // Засады: трещины в своде над проходом.
  for (const a of sim.ambushes) {
    if (a.used || bossOn) continue;
    if (Math.hypot(a.obj.x + 0.5 - h.x, a.obj.y + 0.5 - h.y) > 2.4) continue;
    a.used = true;
    const n = 3 + Math.floor(sim.rng() * 3);
    for (let i = 0; i < n; i++) {
      const ang = sim.rng() * Math.PI * 2;
      const dist = 2 + sim.rng() * 1.6;
      let x = h.x + Math.cos(ang) * dist;
      let y = h.y + Math.sin(ang) * dist;
      if (solidTile(sim, Math.floor(x), Math.floor(y))) {
        x = h.x + Math.cos(ang + Math.PI) * dist;
        y = h.y + Math.sin(ang + Math.PI) * dist;
      }
      if (solidTile(sim, Math.floor(x), Math.floor(y))) continue;
      const m = spawnMob(sim, pickKind(sim, area), x, y, { mode: 'drop' });
      m.t = -i * 0.12;
    }
    sim.events.push({ t: 'squeak', x: h.x, y: h.y });
  }

  // Крысиный поток.
  if (!bossOn && !safeNow) {
    if (d.hordeLeft > 0) {
      d.hordeWarn -= dt;
      if (d.hordeWarn <= 0) {
        const b = sim.burrows[d.hordeFrom];
        if (b && liveMobs(sim) < MOB_CAP + 10) {
          fromBurrow(sim, b, sim.rng() < 0.85 ? 'rat' : 'fatrat', {
            rush: true,
            elite: d.hordeLeft === 1 && sim.rng() < 0.3,
          });
          b.cd = 0;
        }
        d.hordeLeft -= 1;
        d.hordeWarn = 0.16;
      }
    } else {
      d.hordeT -= dt;
      if (d.hordeT <= 0 && d.phase === 'build') {
        const b = pickBurrow(sim, 13, 24);
        if (b) {
          d.hordeFrom = sim.burrows.indexOf(b);
          d.hordeLeft = 12 + Math.floor(sim.rng() * 7);
          d.hordeWarn = 3.5;
          sim.events.push({ t: 'rumble', x: b.obj.x + 0.5, y: b.obj.y + 0.5, what: 'horde' });
        }
        d.hordeT = 360 + sim.rng() * 240;
      }
    }
  }

  // Золотая крыса.
  d.goldT -= dt;
  if (d.goldT <= 0 && !bossOn) {
    const b = pickBurrow(sim, 8, 15);
    if (b) {
      const m = fromBurrow(sim, b, 'goldrat');
      m.mode = 'emerge';
      sim.events.push({ t: 'gold', x: m.x, y: m.y });
    }
    d.goldT = 900 + sim.rng() * 900;
  }

  // Сорвавшаяся вагонетка — в Откатке, если стоишь на её рельсах.
  if (area === 'haul' && !bossOn) {
    if (d.cartId >= 0) {
      d.cartWarn -= dt;
      const cart = sim.props.find((p) => p.id === d.cartId);
      if (cart && d.cartWarn <= 0) {
        const dir = cart.rail!.axis === 'v' ? Math.sign(h.y - cart.y) : Math.sign(h.x - cart.x);
        cart.v = dir * 9;
        cart.wild = true;
        sim.events.push({ t: 'cart', x: cart.x, y: cart.y, v: 9 });
        d.cartId = -1;
      }
    } else {
      d.cartT -= dt;
      if (d.cartT <= 0) {
        for (const p of sim.props) {
          if (p.kind !== 'cart' || !p.alive || !p.rail || Math.abs(p.v) > 0.5) continue;
          const r = p.rail;
          const onLine =
            r.axis === 'v'
              ? Math.abs(h.x - (r.at + 0.5)) < 1.2 && h.y >= r.from && h.y <= r.to + 1
              : Math.abs(h.y - (r.at + 0.5)) < 1.2 && h.x >= r.from && h.x <= r.to + 1;
          const dist = Math.hypot(p.x - h.x, p.y - h.y);
          if (onLine && dist > 7 && dist < 18) {
            d.cartId = p.id;
            d.cartWarn = 1.8;
            sim.events.push({ t: 'rumble', x: p.x, y: p.y, what: 'cart' });
            break;
          }
        }
        d.cartT = 200 + sim.rng() * 160;
      }
    }
  }

  // Обычное появление из нор — только на нарастании.
  if (d.phase !== 'build' || bossOn || safeNow) return;
  d.spawnT -= dt * (DENSITY[area] ?? 1) * (1 + smell);
  if (d.spawnT > 0) return;
  d.spawnT = 2.2 + sim.rng() * 1.2;
  if (liveMobs(sim) >= MOB_CAP || nearMobs(sim, 12) >= NEAR_CAP) return;
  const b = pickBurrow(sim, 6, 16);
  if (!b) return;
  const n = 2 + Math.floor(sim.rng() * (area === 'mouth' ? 2 : 3));
  const kind = pickKind(sim, area);
  const elite = sim.rng() < 0.05;
  for (let i = 0; i < n; i++) {
    const m = fromBurrow(sim, b, i === 0 ? kind : 'rat', { elite: elite && i === 0 });
    m.t = -i * 0.35;
  }
}

// ---------------------------------------------------------------------------
// Герой.
// ---------------------------------------------------------------------------

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Кого бить: захваченная цель, иначе ближняя в конусе взгляда, иначе ближняя вообще. */
function autoAim(sim: Sim, reach: number): number {
  const h = sim.hero;
  const lock = h.lock != null ? sim.mobs.find((m) => m.id === h.lock && m.mode !== 'dying') : null;
  if (lock && Math.hypot(lock.x - h.x, lock.y - h.y) < reach + 2.5)
    return Math.atan2(lock.y - h.y, lock.x - h.x);
  let best: Mob | null = null;
  let bestD = 1e9;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape') continue;
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (d > reach + 0.8 + m.r) continue;
    const a = Math.atan2(m.y - h.y, m.x - h.x);
    const off = Math.abs(angDiff(a, h.face));
    const score = d + off * 0.9;
    if (off < (70 * Math.PI) / 180 || d < reach * 0.8) {
      if (score < bestD) {
        bestD = score;
        best = m;
      }
    }
  }
  if (best) return Math.atan2(best.y - h.y, best.x - h.x);
  // Бьём и по предметам: ящик под рукой — тоже цель.
  let bp: Prop | null = null;
  bestD = 1e9;
  for (const p of sim.props) {
    if (!p.alive || !isBreakable(p)) continue;
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    if (d > reach + p.r) continue;
    const off = Math.abs(angDiff(Math.atan2(p.y - h.y, p.x - h.x), h.face));
    if (off > Math.PI / 2) continue;
    if (d < bestD) {
      bestD = d;
      bp = p;
    }
  }
  if (bp) return Math.atan2(bp.y - h.y, bp.x - h.x);
  return h.face;
}

const isBreakable = (p: Prop) =>
  p.kind === 'crate' ||
  p.kind === 'barrel' ||
  p.kind === 'powder' ||
  p.kind === 'nest' ||
  p.kind === 'cartnest' ||
  p.kind === 'cart';

function startSwing(sim: Sim, step: number, aim: { x: number; y: number } | null): void {
  const h = sim.hero;
  h.mode = 'attack';
  h.t = 0;
  h.step = step;
  h.queued = false;
  h.hitSet = new Set();
  h.aim = aim ? Math.atan2(aim.y, aim.x) : autoAim(sim, SWORD.reach);
  h.face = h.aim;
  const s = SWORD.steps[step];
  sim.events.push({
    t: 'swing',
    x: h.x,
    y: h.y,
    ang: h.aim,
    arc: SWORD.arc * s.arc,
    reach: SWORD.reach,
    heavy: false,
    step,
  });
}

function startHeavy(sim: Sim, power: number): void {
  const h = sim.hero;
  h.mode = 'heavy';
  h.t = 0;
  h.hitSet = new Set();
  h.aim = autoAim(sim, SWORD.heavy.reach);
  h.face = h.aim;
  h.charge = power;
  sim.events.push({
    t: 'swing',
    x: h.x,
    y: h.y,
    ang: h.aim,
    arc: SWORD.heavy.arc,
    reach: SWORD.heavy.reach,
    heavy: true,
    step: 3,
  });
}

/** Задеть всё в секторе: мобов, предметы, шашки. */
function sweep(
  sim: Sim,
  reach: number,
  arc: number,
  mult: number,
  knock: number,
  heavy: boolean,
): void {
  const h = sim.hero;
  let kills = 0;
  for (const m of sim.mobs) {
    if (h.hitSet.has(m.id) || m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape')
      continue;
    const dx = m.x - h.x;
    const dy = m.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d > reach + m.r) continue;
    const off = Math.abs(angDiff(Math.atan2(dy, dx), h.aim));
    // Край тела тоже считается: большая крыса ловится краем дуги.
    const slack = d > 0.01 ? Math.atan(m.r / d) : Math.PI;
    if (off > arc / 2 + slack) continue;
    h.hitSet.add(m.id);
    if (hitMob(sim, m, mult, knock, heavy)) kills += 1;
  }
  for (const p of sim.props) {
    if (!p.alive || !isBreakable(p) || h.hitSet.has(-p.id)) continue;
    const dx = p.x - h.x;
    const dy = p.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d > reach + p.r) continue;
    const off = Math.abs(angDiff(Math.atan2(dy, dx), h.aim));
    if (off > arc / 2 + Math.atan(p.r / Math.max(0.1, d))) continue;
    h.hitSet.add(-p.id);
    hitProp(sim, p, mult, heavy, h.aim);
  }
  for (const b of sim.bombs) {
    if (h.hitSet.has(-100000 - b.id)) continue;
    const d = Math.hypot(b.x - h.x, b.y - h.y);
    if (d > reach + 0.2) continue;
    h.hitSet.add(-100000 - b.id);
    // Отбить шашку: она улетает по ходу удара.
    b.vx = Math.cos(h.aim) * 8;
    b.vy = Math.sin(h.aim) * 8;
    sim.events.push({ t: 'clank', x: b.x, y: b.y });
  }
  // Треснувшая стена: три удара — и она осыпается навсегда.
  for (const o of sim.world.objs) {
    if (o.kind !== 'crack' || h.hitSet.has(-200000 - o.x * 1000 - o.y)) continue;
    if (sim.tiles[o.y * sim.world.w + o.x] !== Tile.Crack) continue;
    const dx = o.x + 0.5 - h.x;
    const dy = o.y + 0.5 - h.y;
    if (Math.hypot(dx, dy) > reach + 0.6) continue;
    if (Math.abs(angDiff(Math.atan2(dy, dx), h.aim)) > arc / 2 + 0.5) continue;
    h.hitSet.add(-200000 - o.x * 1000 - o.y);
    const n = (sim.cracks.get(o.id) ?? 0) + (heavy ? 3 : 1);
    sim.cracks.set(o.id, n);
    sim.hitstop = Math.max(sim.hitstop, 0.04);
    sim.events.push({
      t: 'hit',
      x: o.x + 0.5,
      y: o.y + 0.5,
      dmg: 0,
      crit: false,
      kill: n >= 3,
      boss: false,
    });
    if (n >= 3) {
      sim.tiles[o.y * sim.world.w + o.x] = Tile.Floor;
      sim.delta.opened.push(o.id);
      sim.events.push({ t: 'break', x: o.x + 0.5, y: o.y + 0.5, kind: 'crack' });
    }
  }
  if (kills >= 2) sim.events.push({ t: 'combo', n: kills });
}

function heroDamage(sim: Sim, m: Mob, mult: number): { dmg: number; crit: boolean } {
  const h = sim.hero;
  const beast = beastBonus(sim.beast[m.kind] ?? 0);
  const st = streakTierOf(sim.streak);
  let crit = sim.rng() < sim.stats.crit;
  if (h.sure) {
    crit = true;
    h.sure = false;
  }
  let dmg = sim.stats.dmg * mult * (1 + beast.dmg) * (1 + (st >= 0 ? STREAK_DMG[st] : 0));
  if (crit) dmg *= CRIT_X;
  if (m.mode === 'dizzy') dmg *= 1.5;
  dmg *= 0.9 + sim.rng() * 0.2;
  return { dmg, crit };
}

/** Удар по мобу. Возвращает, убит ли. */
function hitMob(sim: Sim, m: Mob, mult: number, knock: number, heavy: boolean): boolean {
  const h = sim.hero;
  const { dmg, crit } = heroDamage(sim, m, mult);
  m.hp -= dmg;
  m.flash = 0.12;
  h.skill = Math.min(1, h.skill + SKILL.perHit);
  const ang = Math.atan2(m.y - h.y, m.x - h.x);
  const k = (knock * (heavy ? 1.3 : 1)) / MASS[m.kind];
  m.kx += Math.cos(ang) * k;
  m.ky += Math.sin(ang) * k;
  const boss = m.kind === 'king' || m.kind === 'kinglet';
  // Сбить замах можно не всяким ударом, иначе серия ударов держит стаю в
  // вечном оглушении и крысы не кусают вовсе (так было на первом замере:
  // ноль смертей в любом комплекте). Пасюка сбивает крит, тяжёлый удар и
  // треть обычных; жирную — только тяжёлый или крит; короля — ничто.
  const flinch =
    !boss &&
    (heavy ||
      crit ||
      m.kind === 'bomber' ||
      m.kind === 'goldrat' ||
      (m.kind === 'rat' && sim.rng() < 0.35));
  if (flinch && m.mode !== 'sleep') {
    if (m.mode === 'windup' || m.mode === 'chase' || m.mode === 'recover' || m.mode === 'alert') {
      m.mode = 'stun';
      m.t = 0;
    }
  }
  if (m.mode === 'sleep') {
    m.mode = 'alert';
    m.t = 0;
  }
  const kill = m.hp <= 0;
  sim.hitstop = Math.max(
    sim.hitstop,
    kill ? 0.065 : crit ? 0.075 : heavy ? 0.08 : boss ? 0.05 : 0.04,
  );
  sim.events.push({ t: 'hit', x: m.x, y: m.y, dmg: Math.round(dmg), crit, kill, boss });
  if (kill) killMob(sim, m);
  return kill;
}

function hitProp(sim: Sim, p: Prop, mult: number, heavy: boolean, aim: number): void {
  p.flash = 0.12;
  if (p.kind === 'cart') {
    if (!p.rail) return;
    const along = p.rail.axis === 'v' ? Math.sin(aim) : Math.cos(aim);
    if (Math.abs(along) < 0.25) return;
    p.v = Math.sign(along) * (heavy ? 11 : 7.5);
    p.wild = false;
    sim.events.push({ t: 'cart', x: p.x, y: p.y, v: Math.abs(p.v) });
    return;
  }
  if (p.kind === 'nest' || p.kind === 'cartnest') {
    p.hp -= sim.stats.dmg * mult * (heavy ? 1.3 : 1);
    sim.hitstop = Math.max(sim.hitstop, 0.035);
    sim.events.push({
      t: 'hit',
      x: p.x,
      y: p.y,
      dmg: Math.round(sim.stats.dmg * mult),
      crit: false,
      kill: p.hp <= 0,
      boss: false,
    });
    if (p.hp <= 0) breakProp(sim, p);
    return;
  }
  p.hp -= heavy ? 99 : 1;
  sim.hitstop = Math.max(sim.hitstop, 0.03);
  if (p.hp <= 0) {
    if (p.kind === 'powder') {
      p.fuse = 0.35;
      sim.events.push({ t: 'fuse', x: p.x, y: p.y });
    } else breakProp(sim, p);
  }
}

function dropAt(sim: Sim, kind: DropKind, n: number, x: number, y: number): void {
  const a = sim.rng() * Math.PI * 2;
  const s = 1.2 + sim.rng() * 1.6;
  sim.drops.push({
    id: sim.nextId++,
    kind,
    n,
    x,
    y,
    z: 0.2,
    vx: Math.cos(a) * s,
    vy: Math.sin(a) * s,
    vz: 3.2 + sim.rng() * 1.4,
    age: 0,
    area: bandAt(sim.world, y).def.id,
  });
}

function breakProp(sim: Sim, p: Prop): void {
  p.alive = false;
  sim.events.push({ t: 'break', x: p.x, y: p.y, kind: p.kind });
  const e = sim.econ;
  if (p.kind === 'crate' || p.kind === 'barrel') {
    if (sim.rng() < 0.55)
      dropAt(sim, 'coin', Math.max(1, Math.round(e * 0.02 * (0.6 + sim.rng()))), p.x, p.y);
    if (sim.rng() < 0.16) dropAt(sim, 'skin', 1, p.x, p.y);
    if (sim.rng() < 0.07) dropAt(sim, 'token', 1 + Math.floor(sim.rng() * 2), p.x, p.y);
  }
  if (p.kind === 'nest' || p.kind === 'cartnest') {
    dropAt(sim, 'skin', 1, p.x, p.y);
    dropAt(sim, 'skin', 1, p.x, p.y);
    if (sim.rng() < 0.3) dropAt(sim, 'token', 2 + Math.floor(sim.rng() * 3), p.x, p.y);
    gainXp(sim, 12 * Math.pow(1.5, bandAt(sim.world, p.y).def.level));
  }
}

function explode(sim: Sim, x: number, y: number, r: number, dmg: number, heroShare: number): void {
  sim.events.push({ t: 'boom', x, y, r });
  sim.hitstop = Math.max(sim.hitstop, 0.09);
  for (const m of sim.mobs) {
    if (m.mode === 'dying') continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d > r + m.r) continue;
    const k = 1 - d / (r + m.r);
    m.hp -= dmg * (0.5 + 0.5 * k);
    m.flash = 0.15;
    const a = Math.atan2(m.y - y, m.x - x);
    m.kx += (Math.cos(a) * 9) / MASS[m.kind];
    m.ky += (Math.sin(a) * 9) / MASS[m.kind];
    if (m.hp <= 0) killMob(sim, m);
    else if (m.kind !== 'king' && m.kind !== 'kinglet') {
      m.mode = 'stun';
      m.t = 0;
    }
  }
  for (const p of sim.props) {
    if (!p.alive || !isBreakable(p) || p.kind === 'cart') continue;
    if (Math.hypot(p.x - x, p.y - y) > r + p.r) continue;
    if (p.kind === 'powder') {
      if (p.fuse <= 0) p.fuse = 0.18;
    } else if (p.kind === 'nest' || p.kind === 'cartnest') {
      p.hp -= dmg * 0.8;
      if (p.hp <= 0) breakProp(sim, p);
    } else breakProp(sim, p);
  }
  const h = sim.hero;
  const hd = Math.hypot(h.x - x, h.y - y);
  if (hd < r + h.r)
    hurtHero(sim, sim.stats.maxHp * heroShare * (1 - (hd / (r + h.r)) * 0.4), x, y, 7);
}

function hurtHero(
  sim: Sim,
  raw: number,
  fx: number,
  fy: number,
  knock: number,
  kind?: MobId,
): void {
  const h = sim.hero;
  if (h.inv > 0 || h.mode === 'dying' || h.mode === 'dead') return;
  const guard = kind ? beastBonus(sim.beast[kind] ?? 0).guard : 0;
  const dmg = raw * armorCut(sim.stats.armor) * (1 - guard);
  h.hp -= dmg;
  h.inv = HURT_INV;
  h.flash = 0.2;
  const a = Math.atan2(h.y - fy, h.x - fx);
  h.vx += Math.cos(a) * knock;
  h.vy += Math.sin(a) * knock;
  sim.hitstop = Math.max(sim.hitstop, 0.07);
  sim.director.intensity += (dmg / sim.stats.maxHp) * 1.3;
  sim.events.push({ t: 'hurt', x: h.x, y: h.y, dmg: Math.round(dmg) });
  // Удар сбивает замах и еду.
  if (h.mode === 'charge' || h.mode === 'eat') {
    h.mode = 'free';
    h.t = 0;
  }
  if (h.hp <= 0) {
    h.hp = 0;
    h.mode = 'dying';
    h.t = 0;
    if (sim.boss?.state === 'fight') resetBoss(sim);
  }
}

function gainXp(sim: Sim, xp: number): void {
  sim.xp += xp;
  sim.delta.xp += xp;
  const lv = levelOf(sim.xp).level;
  if (lv > sim.level) {
    sim.level = lv;
    sim.events.push({ t: 'level', level: lv });
    // Новый уровень лечит: награда должна ощущаться прямо в бою.
    sim.hero.hp = Math.min(sim.stats.maxHp, sim.hero.hp + sim.stats.maxHp * 0.3);
  }
}

function bump(sim: Sim, id: StatId, n: number): void {
  sim.delta.stats[id] = (sim.delta.stats[id] ?? 0) + n;
}

function killMob(sim: Sim, m: Mob): void {
  const planting = m.mode === 'plant';
  m.mode = 'dying';
  m.t = 0;
  m.hp = 0;
  const h = sim.hero;
  sim.killed += 1;
  sim.beast[m.kind] = (sim.beast[m.kind] ?? 0) + 1;
  sim.delta.kills[m.kind] = (sim.delta.kills[m.kind] ?? 0) + 1;
  sim.events.push({ t: 'kill', x: m.x, y: m.y, mob: m.kind, elite: m.elite, albino: m.albino });
  if (Math.hypot(m.x - h.x, m.y - h.y) < 5) sim.director.intensity += 0.035;
  // Серия.
  const prev = streakTierOf(sim.streak);
  sim.streak = sim.time - sim.streakAt > STREAK_GRACE ? 1 : sim.streak + 1;
  sim.streakAt = sim.time;
  const now = streakTierOf(sim.streak);
  if (now > prev) sim.events.push({ t: 'streak', tier: now });
  gainXp(sim, m.xp);
  if (m.affixes.includes('boom')) explode(sim, m.x, m.y, 1.6, m.dmg * 1.5, 0.12);

  // Добыча.
  const def = MOBS[m.kind];
  const beast = beastBonus(sim.beast[m.kind] ?? 0);
  const st = streakTierOf(sim.streak);
  const lootK = sim.stats.loot * (1 + beast.loot) * (1 + (st >= 0 ? STREAK_LOOT[st] : 0));
  const rolls = Math.max(1, Math.round(m.loot));
  for (let i = 0; i < rolls; i++) {
    if (def.meat && sim.rng() < def.meat[1] * lootK)
      dropAt(sim, def.meat[0], def.meat[2], m.x, m.y);
    for (const [mat, ch] of def.mats) if (sim.rng() < ch * lootK) dropAt(sim, mat, 1, m.x, m.y);
    if (sim.rng() < sim.stats.token * (m.elite ? 20 : 1))
      dropAt(sim, 'token', 1 + Math.floor(sim.rng() * 2), m.x, m.y);
  }
  if (m.elite && sim.rng() < 0.08) dropAt(sim, 'key', 1, m.x, m.y);
  if (m.kind === 'goldrat') {
    const bag = goldBag(sim.econ);
    for (let i = 0; i < 6; i++) dropAt(sim, 'coin', Math.round(bag / 6), m.x, m.y);
  }
  if (m.kind === 'bomber' && planting) {
    // Убит с шашкой в зубах — шашка падает горящей.
    sim.bombs.push({
      id: sim.nextId++,
      x: m.x,
      y: m.y,
      vx: 0,
      vy: 0,
      fuse: 1.1,
      r: 1.8,
      dmg: m.dmg,
    });
  }
  if (m.kind === 'king' || m.kind === 'kinglet') onBossPartDown(sim, m);
}

// ---------------------------------------------------------------------------
// Король.
// ---------------------------------------------------------------------------

function updateGates(sim: Sim): void {
  const b = sim.boss;
  if (!b) return;
  const h = sim.hero;
  const heroIn = inArena(sim, h.x, h.y);
  const closed = b.state === 'fight' || (b.state === 'rest' && !heroIn);
  for (const g of b.gates) sim.tiles[g] = closed ? Tile.Gate : Tile.Floor;
}

function startBoss(sim: Sim): void {
  const b = sim.boss!;
  b.state = 'fight';
  b.split = false;
  b.t = 0;
  const k = spawnMob(sim, 'king', b.obj.x + 0.5, b.obj.y + 0.5, { mode: 'roar' });
  k.summonCd = 8;
  sim.events.push({ t: 'boss', what: 'wake' });
  // Стаи и чужие крысы из арены убираются: бой один на один с королём.
  sim.mobs = sim.mobs.filter((m) => m === k || !inArena(sim, m.x, m.y));
  updateGates(sim);
}

function resetBoss(sim: Sim): void {
  const b = sim.boss;
  if (!b) return;
  sim.mobs = sim.mobs.filter((m) => m.kind !== 'king' && m.kind !== 'kinglet');
  b.state = 'idle';
  b.split = false;
  sim.events.push({ t: 'boss', what: 'reset' });
  updateGates(sim);
}

function onBossPartDown(sim: Sim, m: Mob): void {
  const b = sim.boss;
  if (!b) return;
  if (m.kind === 'king' && !b.split) {
    // Убит до распада (например, взрывом) — распад всё равно играем.
    splitKing(sim, m);
    return;
  }
  const left = sim.mobs.filter(
    (x) => (x.kind === 'kinglet' || x.kind === 'king') && x.mode !== 'dying',
  );
  if (left.length) return;
  b.state = 'won';
  sim.delta.bosses.push({ id: b.id, at: sim.now() });
  sim.events.push({ t: 'boss', what: 'dead' });
  sim.slowmo = Math.max(sim.slowmo, 0.6);
  const loot = kingLoot(sim.econ, sim.rng);
  const cx = b.obj.x + 0.5;
  const cy = b.obj.y + 0.5;
  for (let i = 0; i < 8; i++) dropAt(sim, 'coin', Math.round(loot.coins / 8), cx, cy);
  for (let i = 0; i < Math.min(12, loot.tokens); i++)
    dropAt(sim, 'token', Math.ceil(loot.tokens / Math.min(12, loot.tokens)), cx, cy);
  if (loot.keys) dropAt(sim, 'key', loot.keys, cx, cy);
  for (const [mat, n] of Object.entries(loot.mats) as [MatId, number][])
    for (let i = 0; i < n; i++) dropAt(sim, mat as DropKind, 1, cx, cy);
  updateGates(sim);
}

function splitKing(sim: Sim, k: Mob): void {
  const b = sim.boss!;
  b.split = true;
  k.mode = 'dying';
  k.t = 0;
  sim.events.push({ t: 'boss', what: 'split' });
  sim.hitstop = Math.max(sim.hitstop, 0.12);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const m = spawnMob(sim, 'kinglet', k.x + Math.cos(a) * 1.2, k.y + Math.sin(a) * 1.2, {
      mode: 'stun',
      level: k.level,
    });
    m.hp = m.maxHp = k.maxHp * 0.18;
    m.kx = Math.cos(a) * 6;
    m.ky = Math.sin(a) * 6;
    collideTiles(sim, m);
  }
}

function stepBossMob(sim: Sim, m: Mob, dt: number): void {
  const h = sim.hero;
  const b = sim.boss!;
  const dx = h.x - m.x;
  const dy = h.y - m.y;
  const dist = Math.hypot(dx, dy);
  const enraged = b.t > 180;
  const haste = enraged ? 1.3 : 1;
  const small = m.kind === 'kinglet';
  m.summonCd -= dt;
  switch (m.mode) {
    case 'roar':
      if (m.t > 1.2) setMode(m, 'chase');
      return;
    case 'chase': {
      const s = m.speed * haste;
      steer(sim, m, dx / (dist || 1), dy / (dist || 1), s, dt);
      if (m.t > (small ? 0.9 : 1.4) / haste) {
        const r = sim.rng();
        if (!small && m.summonCd <= 0 && r < 0.3) {
          setMode(m, 'summon');
          sim.events.push({ t: 'boss', what: 'summon' });
        } else if (dist > 2.6 || r < 0.45) {
          setMode(m, 'rollAim');
          m.dir = Math.atan2(dy, dx);
        } else {
          setMode(m, 'whipAim');
        }
      }
      return;
    }
    case 'rollAim':
      m.vx *= 0.8;
      m.vy *= 0.8;
      // Прицел доводится первые полсекунды, потом замирает — видно, куда покатится.
      if (m.t < 0.45) m.dir = Math.atan2(dy, dx);
      if (m.t > 0.8 / haste) {
        setMode(m, 'roll');
        m.bounces = 0;
        sim.events.push({ t: 'boss', what: 'roll' });
      }
      return;
    case 'roll': {
      const s = (small ? 10 : 9) * haste;
      m.vx = Math.cos(m.dir) * s;
      m.vy = Math.sin(m.dir) * s;
      // Качение бьёт один раз: попал — король и сам оглушён ударом, это
      // окно для ответа. Иначе он катался бы по арене, задевая снова и снова.
      if (dist < m.r + h.r + 0.1 && h.inv <= 0 && h.mode !== 'dash') {
        hurtHero(sim, m.dmg * 1.4, m.x, m.y, 9, m.kind);
        setMode(m, 'dizzy');
        return;
      }
      if (m.t > 2.2) setMode(m, 'dizzy');
      return;
    }
    case 'dizzy':
      m.vx *= 0.85;
      m.vy *= 0.85;
      if (m.t > (small ? 0.8 : 1.3)) setMode(m, 'chase');
      return;
    case 'whipAim':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 0.7 / haste) {
        const r = small ? 1.7 : 2.1;
        if (dist < r + h.r) hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
        sim.events.push({ t: 'boss', what: 'whip' });
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        setMode(m, 'recover');
      }
      return;
    case 'summon':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 1) {
        const holes = sim.burrows.filter((x) =>
          inArena(sim, x.obj.out![0] + 0.5, x.obj.out![1] + 0.5),
        );
        const n = 3 + Math.floor(sim.rng() * 2);
        for (let i = 0; i < n && holes.length; i++) {
          const hb = holes[i % holes.length];
          hb.cd = 0;
          const mm = fromBurrow(sim, hb, 'rat', { elite: i === 0 && sim.rng() < 0.2 });
          mm.t = -i * 0.2;
        }
        m.summonCd = 12;
        setMode(m, 'chase');
      }
      return;
    case 'recover':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.6) setMode(m, 'chase');
      return;
    case 'stun':
      if (m.t > 0.4) setMode(m, 'chase');
      return;
    default:
      if (m.mode !== 'dying') setMode(m, 'chase');
  }
}

// ---------------------------------------------------------------------------
// Мобы.
// ---------------------------------------------------------------------------

function setMode(m: Mob, mode: MobMode): void {
  m.mode = mode;
  m.t = 0;
}

/** Разогнать к скорости по направлению — плавно, как лапы по камню. */
function steer(sim: Sim, m: Mob, dx: number, dy: number, speed: number, dt: number): void {
  const k = Math.min(1, dt * 10);
  m.vx += (dx * speed - m.vx) * k;
  m.vy += (dy * speed - m.vy) * k;
  if (Math.abs(dx) + Math.abs(dy) > 0.1) m.face = Math.atan2(dy, dx);
  void sim;
}

/** Куда идти к герою: напрямую, если видно, иначе по полю расстояний. */
function chaseDir(sim: Sim, m: Mob, tx: number, ty: number): [number, number] {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx, dy) || 1;
  if (d < 6 && lineOfSight(sim, m.x, m.y, tx, ty)) return [dx / d, dy / d];
  return flowDir(sim, m.x, m.y) ?? [dx / d, dy / d];
}

function stepMob(sim: Sim, m: Mob, dt: number): void {
  m.t += dt;
  m.flash = Math.max(0, m.flash - dt);
  m.cd -= dt;
  if (m.t < 0) return;
  const h = sim.hero;
  const heroDown = h.mode === 'dying' || h.mode === 'dead';
  const dx = h.x - m.x;
  const dy = h.y - m.y;
  const dist = Math.hypot(dx, dy);
  const def = MOBS[m.kind];
  const smell = smellOf(sim.sack);
  if (m.affixes.includes('regen') && m.mode !== 'dying')
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.03 * dt);

  if (m.kind === 'king' || m.kind === 'kinglet') {
    if (m.mode !== 'dying') stepBossMob(sim, m, dt);
    return;
  }

  switch (m.mode) {
    case 'emerge': {
      // Из стены на пол: полсекунды выползает.
      const k = Math.min(1, m.t / 0.45);
      const b = sim.burrows[m.burrow];
      if (b) {
        m.x = b.obj.x + 0.5 + (m.hx - b.obj.x - 0.5) * k;
        m.y = b.obj.y + 0.5 + (m.hy - b.obj.y - 0.5) * k;
      }
      if (k >= 1) {
        m.x = m.hx;
        m.y = m.hy;
        setMode(m, m.kind === 'goldrat' ? 'flee' : 'chase');
      }
      return;
    }
    case 'drop':
      // Падает со свода: тень растёт полсекунды, потом шлепок.
      if (m.t > 0.55) {
        setMode(m, 'stun');
        sim.events.push({ t: 'squeak', x: m.x, y: m.y });
      }
      return;
    case 'sleep':
      if (!heroDown && dist < 5.5 + smell * 4) {
        setMode(m, 'alert');
        sim.events.push({ t: 'squeak', x: m.x, y: m.y });
      }
      return;
    case 'alert':
      m.face = Math.atan2(dy, dx);
      if (m.t > 0.35) setMode(m, 'chase');
      return;
    case 'stun': {
      if (m.t > (m.kind === 'fatrat' ? 0.14 : 0.2))
        setMode(m, m.kind === 'goldrat' ? 'flee' : 'chase');
      return;
    }
    case 'dying':
      return;
    case 'escape':
      m.vx *= 0.8;
      m.vy *= 0.8;
      return;
  }

  if (heroDown) {
    m.vx *= 0.9;
    m.vy *= 0.9;
    return;
  }

  // Привязь: далеко от дома и героя не видно — домой.
  if (Math.hypot(m.x - m.hx, m.y - m.hy) > LEASH && dist > 8 && m.mode === 'chase') {
    const back = Math.atan2(m.hy - m.y, m.hx - m.x);
    steer(sim, m, Math.cos(back), Math.sin(back), m.speed, dt);
    return;
  }

  if (m.kind === 'goldrat') {
    // Удирает: по полю расстояний прочь, к норе.
    const away = flowDir(sim, m.x, m.y, true);
    const d = away ?? [-dx / (dist || 1), -dy / (dist || 1)];
    steer(sim, m, d[0], d[1], m.speed, dt);
    if (m.t > 14 && dist > 5) {
      setMode(m, 'escape');
      m.hp = 0;
    }
    return;
  }

  if (m.kind === 'bomber') {
    if (m.mode === 'chase') {
      const [cx, cy] = chaseDir(sim, m, h.x, h.y);
      steer(sim, m, cx, cy, m.speed, dt);
      if (dist < 2.7 && m.cd <= 0 && lineOfSight(sim, m.x, m.y, h.x, h.y)) setMode(m, 'plant');
      return;
    }
    if (m.mode === 'plant') {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > 0.5) {
        sim.bombs.push({
          id: sim.nextId++,
          x: m.x,
          y: m.y,
          vx: 0,
          vy: 0,
          fuse: 1.6,
          r: 1.8,
          dmg: m.dmg,
        });
        sim.events.push({ t: 'fuse', x: m.x, y: m.y });
        setMode(m, 'flee');
        m.cd = 4.5;
      }
      return;
    }
    if (m.mode === 'flee') {
      steer(sim, m, -dx / (dist || 1), -dy / (dist || 1), m.speed * 1.1, dt);
      if (m.t > 1.3) setMode(m, 'chase');
      return;
    }
  }

  switch (m.mode) {
    case 'chase': {
      const reach = def.reach + m.r + h.r;
      if (dist < reach && m.cd <= 0) {
        setMode(m, 'windup');
        m.face = Math.atan2(dy, dx);
        return;
      }
      // Стая обходит с флангов: у каждой крысы своя сторона.
      let tx = h.x;
      let ty = h.y;
      if (!m.rush && dist > 1.6) {
        const side = ((m.id * 2.399) % (Math.PI * 2)) - Math.PI;
        const r = Math.min(1.4, dist * 0.35);
        tx += Math.cos(side) * r;
        ty += Math.sin(side) * r;
      }
      let [cx, cy] = chaseDir(sim, m, tx, ty);
      // Зигзаг пасюка — только издали.
      if (m.kind === 'rat' && dist > 2.2) {
        const z = Math.sin(sim.time * 9 + m.id) * 0.55;
        const px = -cy;
        const py = cx;
        cx += px * z;
        cy += py * z;
        const l = Math.hypot(cx, cy) || 1;
        cx /= l;
        cy /= l;
      }
      const s = m.speed * (m.rush ? 1.15 : 1) * (dist < 1.4 ? 0.6 : 1);
      steer(sim, m, cx, cy, s, dt);
      return;
    }
    case 'windup':
      m.vx *= 0.75;
      m.vy *= 0.75;
      if (m.t >= def.windup) {
        const reach = def.reach + m.r + h.r + 0.18;
        if (dist < reach) {
          const push = m.kind === 'fatrat' ? 5 : 2;
          hurtHero(sim, m.dmg, m.x, m.y, push, m.kind);
        }
        // Рывок вперёд на укусе.
        m.vx += Math.cos(m.face) * 3;
        m.vy += Math.sin(m.face) * 3;
        setMode(m, 'recover');
        m.cd = def.rest * (0.8 + sim.rng() * 0.4);
      }
      return;
    case 'recover':
      steer(sim, m, -dx / (dist || 1), -dy / (dist || 1), m.speed * 0.35, dt);
      if (m.t > 0.35) {
        // Раненая крыса иногда бежит в нору — догонять или отпустить.
        if (m.hp < m.maxHp * 0.3 && sim.rng() < 0.35 && m.burrow >= 0) setMode(m, 'flee');
        else setMode(m, 'chase');
      }
      return;
    case 'flee': {
      const b = sim.burrows[m.burrow];
      if (!b) {
        setMode(m, 'chase');
        return;
      }
      const [ox, oy] = b.obj.out!;
      const tx = ox + 0.5 - m.x;
      const ty = oy + 0.5 - m.y;
      const d = Math.hypot(tx, ty);
      steer(sim, m, tx / (d || 1), ty / (d || 1), m.speed * 1.1, dt);
      if (d < 0.4) {
        setMode(m, 'escape');
        m.hp = 0;
      }
      if (m.t > 4) setMode(m, 'chase');
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Шаг мира.
// ---------------------------------------------------------------------------

export function stepSim(sim: Sim, dtReal: number, input: SimInput): void {
  sim.events.length = 0;
  let dt = Math.min(0.05, dtReal);
  // Стоп-кадр: мир стоит, копится только сам стоп-кадр.
  if (sim.hitstop > 0) {
    sim.hitstop = Math.max(0, sim.hitstop - dt);
    // Нажатия во время стоп-кадра не теряются: удар заказывается.
    if (input.attack && sim.hero.mode === 'attack') sim.hero.queued = true;
    return;
  }
  if (sim.slowmo > 0) {
    sim.slowmo = Math.max(0, sim.slowmo - dt);
    dt *= SLOWMO.scale;
  }
  sim.time += dt;
  stepHero(sim, dt, input);
  stepWorld(sim, dt);
}

function stepHero(sim: Sim, dt: number, input: SimInput): void {
  const h = sim.hero;
  const st = sim.stats;
  h.t += dt;
  h.inv = Math.max(0, h.inv - dt);
  h.flash = Math.max(0, h.flash - dt);
  h.dashCd = Math.max(0, h.dashCd - dt);
  h.eatCd = Math.max(0, h.eatCd - dt);
  if (input.lock !== null) h.lock = input.lock;

  if (h.mode === 'dying') {
    h.vx *= 0.85;
    h.vy *= 0.85;
    if (h.t > 1.3) {
      h.mode = 'dead';
      sim.events.push({ t: 'die' });
    }
    moveHero(sim, dt);
    return;
  }
  if (h.mode === 'dead') return;

  // Джойстик.
  let mx = input.mx;
  let my = input.my;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  const moving = ml > 0.12;

  // Рывок — главный ответ на замах. Отменяет удар, но не смерть.
  if (input.dash && h.dashCd <= 0 && h.mode !== 'skill') {
    h.mode = 'dash';
    h.t = 0;
    h.dashDir = moving ? Math.atan2(my, mx) : h.face;
    h.inv = Math.max(h.inv, DASH.inv);
    h.dashCd = DASH.cd;
    h.face = h.dashDir;
    sim.events.push({ t: 'dash', x: h.x, y: h.y });
    if (perfectDodge(sim)) {
      h.sure = true;
      sim.slowmo = SLOWMO.dur;
      bump(sim, 'dodges', 1);
      sim.events.push({ t: 'dodge', x: h.x, y: h.y });
    }
  }

  // Умение: вихрь.
  if (input.skill && h.skill >= 1 && h.mode !== 'dash') {
    h.mode = 'skill';
    h.t = 0;
    h.skill = 0;
    h.hitSet = new Set();
    sim.events.push({ t: 'skill', x: h.x, y: h.y });
  }

  // Еда из сидора.
  if (input.eat && h.mode === 'free' && h.eatCd <= 0) {
    const fat = (sim.sack.meat.fatmeat ?? 0) > 0;
    const plain = (sim.sack.meat.meat ?? 0) > 0;
    if ((fat || plain) && h.hp < st.maxHp) {
      h.mode = 'eat';
      h.t = 0;
    }
  }

  const haste = st.haste;
  let speedK = 1;
  switch (h.mode) {
    case 'free': {
      if (input.attack) {
        const again = sim.time - h.lastSwingEnd < SWORD.grace && h.step < 2;
        startSwing(sim, again ? h.step + 1 : 0, input.aim);
        h.held = 0;
      } else if (input.attackHeld) {
        h.held += dt;
        if (h.held > SWORD.holdAt) {
          h.mode = 'charge';
          h.t = 0;
          h.charge = 0;
          sim.events.push({ t: 'charge' });
        }
      } else h.held = 0;
      break;
    }
    case 'attack': {
      const s = SWORD.steps[h.step];
      const t = h.t * haste;
      speedK = 0.35;
      if (input.attack) h.queued = true;
      if (input.attackHeld) h.held += dt;
      else h.held = 0;
      if (t >= s.from && t <= s.to + 0.02) {
        sweep(sim, SWORD.reach, SWORD.arc * s.arc, s.mult, s.knock, false);
        // Шаг вперёд на ударе — если цель не вплотную.
        if (t < s.to) {
          h.vx += Math.cos(h.aim) * 6 * dt * 4;
          h.vy += Math.sin(h.aim) * 6 * dt * 4;
        }
      }
      if (t >= s.dur) {
        h.lastSwingEnd = sim.time;
        if (h.queued && h.step < 2) startSwing(sim, h.step + 1, input.aim);
        else if (input.attackHeld && h.held > SWORD.holdAt) {
          h.mode = 'charge';
          h.t = 0;
          h.charge = 0;
          sim.events.push({ t: 'charge' });
        } else {
          if (h.step >= 2) h.lastSwingEnd = -9;
          h.mode = 'free';
          h.t = 0;
        }
      }
      break;
    }
    case 'charge': {
      speedK = 0.5;
      h.charge = Math.min(1, h.t / SWORD.chargeFull);
      if (!input.attackHeld) startHeavy(sim, h.charge);
      break;
    }
    case 'heavy': {
      const s = SWORD.heavy;
      speedK = 0.2;
      const t = h.t * haste;
      if (t >= s.from && t <= s.to + 0.02)
        sweep(sim, s.reach, s.arc, s.mult * (0.55 + 0.45 * h.charge), s.knock, true);
      if (t >= s.dur) {
        h.mode = 'free';
        h.t = 0;
        h.lastSwingEnd = -9;
      }
      break;
    }
    case 'dash': {
      const v = st.dash / DASH.dur;
      h.vx = Math.cos(h.dashDir) * v;
      h.vy = Math.sin(h.dashDir) * v;
      if (h.t >= DASH.dur) {
        h.mode = 'free';
        h.t = 0;
        h.vx *= 0.3;
        h.vy *= 0.3;
      }
      moveHero(sim, dt);
      return;
    }
    case 'skill': {
      speedK = 0.6;
      // Два оборота за полсекунды: второй оборот бьёт заново.
      const half = SKILL.dur / 2;
      if (h.t >= half && !h.hitSet.has(-999999)) {
        h.hitSet = new Set([-999999]);
      }
      h.aim += dt * ((Math.PI * 4) / SKILL.dur);
      sweep(sim, SKILL.reach, Math.PI * 2, SKILL.mult, 4, false);
      if (h.t >= SKILL.dur) {
        h.mode = 'free';
        h.t = 0;
      }
      break;
    }
    case 'eat': {
      speedK = 0.5;
      if (h.t >= 0.5) {
        const fat = (sim.sack.meat.fatmeat ?? 0) > 0;
        const id: MeatId = fat ? 'fatmeat' : 'meat';
        if ((sim.sack.meat[id] ?? 0) > 0) {
          sim.sack.meat[id] = (sim.sack.meat[id] ?? 0) - 1;
          // Из какого района кусок — всё равно: списываем с самого мелкого.
          const by = Object.entries(sim.sack.meatBy).sort(
            (a, b) => AREAS.findIndex((x) => x.id === a[0]) - AREAS.findIndex((x) => x.id === b[0]),
          )[0];
          if (by) sim.sack.meatBy[by[0] as AreaId] = Math.max(0, (by[1] ?? 0) - 1);
          const heal = st.maxHp * (fat ? 0.25 : 0.15);
          h.hp = Math.min(st.maxHp, h.hp + heal);
          sim.events.push({ t: 'eat', heal: Math.round(heal) });
        }
        h.eatCd = 1;
        h.mode = 'free';
        h.t = 0;
      }
      break;
    }
  }

  // Ход.
  const target = st.speed * speedK;
  const acc = Math.min(1, dt * 14);
  h.vx += (mx * target - h.vx) * acc;
  h.vy += (my * target - h.vy) * acc;
  if (moving && h.mode === 'free') h.face = Math.atan2(my, mx);
  moveHero(sim, dt);
}

/** Уклон в последний миг: рывок пришёлся под уже летящий удар. */
function perfectDodge(sim: Sim): boolean {
  const h = sim.hero;
  for (const m of sim.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.mode === 'windup') {
      const left = MOBS[m.kind].windup - m.t;
      if (left <= DODGE_WINDOW && d < MOBS[m.kind].reach + m.r + h.r + 0.3) return true;
    }
    if (m.mode === 'rollAim' && m.t > 0.6 && d < 4) return true;
    if (m.mode === 'roll' && d < m.r + h.r + 1.4) return true;
    if (m.mode === 'whipAim' && m.t > 0.5 && d < 2.6) return true;
  }
  for (const b of sim.bombs)
    if (b.fuse < 0.3 && Math.hypot(b.x - h.x, b.y - h.y) < b.r + 0.3) return true;
  return false;
}

function moveHero(sim: Sim, dt: number): void {
  const h = sim.hero;
  const ox = h.x;
  const oy = h.y;
  const n = Math.max(1, Math.ceil((Math.hypot(h.vx, h.vy) * dt) / 0.2));
  for (let i = 0; i < n; i++) {
    h.x += (h.vx * dt) / n;
    h.y += (h.vy * dt) / n;
    collideTiles(sim, h);
    const cart = collideProps(sim, h);
    if (cart?.kind === 'cart' && cart.rail && Math.abs(cart.v) < 1) {
      // Упёрся в вагонетку вдоль рельсов — она медленно подаётся.
      const along = cart.rail.axis === 'v' ? h.vy : h.vx;
      if (Math.abs(along) > 1) cart.v = Math.sign(along) * 1.6;
    }
  }
  const moved = Math.hypot(h.x - ox, h.y - oy);
  sim.meters += moved;
  if (moved > 0.001) h.walk += moved;
  if (sim.meters >= 1) {
    const whole = Math.floor(sim.meters);
    bump(sim, 'meters', whole);
    sim.meters -= whole;
  }
}

function stepWorld(sim: Sim, dt: number): void {
  const h = sim.hero;
  // Район под ногами.
  const band = bandAt(sim.world, h.y);
  if (band.def.id !== sim.area) {
    sim.area = band.def.id;
    sim.events.push({ t: 'area', area: sim.area });
  }

  // Поле расстояний — пять раз в секунду хватает.
  sim.flowT -= dt;
  if (sim.flowT <= 0) {
    rebuildFlow(sim);
    sim.flowT = 0.2;
  }

  // Разведка.
  sim.fogT -= dt;
  if (sim.fogT <= 0) {
    markFog(sim);
    sim.fogT = 0.25;
  }

  // Арена: вошёл — король просыпается, ворота за спиной.
  const b = sim.boss;
  if (b) {
    if (b.state === 'fight') b.t += dt;
    const inside = inArena(sim, h.x, h.y);
    // Отдохнул — ворота открываются; выиграл и вышел — ворота за спиной.
    if (b.state === 'rest' && sim.now() >= b.readyAt) b.state = 'idle';
    if (b.state === 'won' && !inside) {
      b.state = 'rest';
      b.readyAt = sim.now() + BOSSES[b.id].restMs;
    }
    if (b.state === 'idle' && inside && h.mode !== 'dying' && h.mode !== 'dead') startBoss(sim);
    updateGates(sim);
  }

  // Мобы.
  for (const m of sim.mobs) stepMob(sim, m, dt);
  moveMobs(sim, dt);
  sim.mobs = sim.mobs.filter((m) => {
    if (m.mode === 'dying') return m.t < 0.7;
    if (m.mode === 'escape') return m.t < 0.4;
    if (m.kind !== 'king' && m.kind !== 'kinglet' && m.mode !== 'sleep')
      return Math.hypot(m.x - h.x, m.y - h.y) < DESPAWN_R;
    return true;
  });

  // Норы отдыхают.
  for (const bw of sim.burrows) bw.cd = Math.max(0, bw.cd - dt);

  // Гнёзда рожают, пока ты рядом.
  for (const p of sim.props) {
    if (!p.alive) continue;
    p.flash = Math.max(0, p.flash - dt);
    if ((p.kind === 'nest' || p.kind === 'cartnest') && h.mode !== 'dead') {
      const d = Math.hypot(p.x - h.x, p.y - h.y);
      if (d < 9 && d > 2.5 && !nearSafe(sim, p.x, p.y) && sim.boss?.state !== 'fight') {
        p.spawnT -= dt;
        if (p.spawnT <= 0) {
          p.spawnT = 6 + sim.rng() * 2;
          const mine = sim.mobs.filter((m) => m.nest === p.id && m.mode !== 'dying').length;
          if (mine < 2 && liveMobs(sim) < MOB_CAP) {
            const kind: MobId = p.kind === 'cartnest' && sim.rng() < 0.3 ? 'fatrat' : 'rat';
            const m = spawnMob(sim, kind, p.x + (sim.rng() - 0.5) * 0.6, p.y + 0.5, {
              nest: p.id,
              mode: 'stun',
            });
            collideTiles(sim, m);
            sim.events.push({ t: 'emerge', x: m.x, y: m.y });
          }
        }
      }
    }
    if (p.kind === 'powder' && p.fuse > 0) {
      p.fuse -= dt;
      if (p.fuse <= 0) {
        p.alive = false;
        const lvl = bandAt(sim.world, p.y).def.level;
        explode(sim, p.x, p.y, 2.4, 60 * Math.pow(1.8, lvl), 0.25);
      }
    }
    if (p.kind === 'cart') stepCart(sim, p, dt);
  }

  // Шашки: катятся, если отбиты, и рвутся.
  for (const bm of sim.bombs) {
    bm.fuse -= dt;
    if (Math.abs(bm.vx) + Math.abs(bm.vy) > 0.05) {
      bm.x += bm.vx * dt;
      bm.y += bm.vy * dt;
      const e = { x: bm.x, y: bm.y, r: 0.12 };
      if (collideTiles(sim, e)) {
        bm.vx *= -0.4;
        bm.vy *= -0.4;
      }
      bm.x = e.x;
      bm.y = e.y;
      bm.vx *= Math.exp(-3 * dt);
      bm.vy *= Math.exp(-3 * dt);
    }
  }
  const blown = sim.bombs.filter((bm) => bm.fuse <= 0);
  sim.bombs = sim.bombs.filter((bm) => bm.fuse > 0);
  for (const bm of blown) explode(sim, bm.x, bm.y, bm.r, bm.dmg * 2.2, 0.22);

  // Добыча: подлетает, падает, тянется к герою.
  stepDrops(sim, dt);

  // Серия гаснет.
  if (sim.streak > 0 && sim.time - sim.streakAt > STREAK_GRACE) sim.streak = 0;

  stepDirector(sim, dt);
}

function moveMobs(sim: Sim, dt: number): void {
  const h = sim.hero;
  for (const m of sim.mobs) {
    if (m.mode === 'emerge' || m.mode === 'drop' || m.t < 0) continue;
    const decay = Math.exp(-9 * dt);
    const vx = m.vx + m.kx;
    const vy = m.vy + m.ky;
    m.kx *= decay;
    m.ky *= decay;
    if (m.mode === 'dying' || m.mode === 'sleep') {
      m.vx *= 0.8;
      m.vy *= 0.8;
    }
    const steps = Math.max(1, Math.ceil((Math.hypot(vx, vy) * dt) / 0.2));
    let bounced = false;
    for (let i = 0; i < steps; i++) {
      m.x += (vx * dt) / steps;
      m.y += (vy * dt) / steps;
      const px = m.x;
      const py = m.y;
      if (collideTiles(sim, m) && m.mode === 'roll' && !bounced) {
        // Король отскакивает от стены: зеркалим направление по нормали.
        const nx = m.x - px;
        const ny = m.y - py;
        if (Math.abs(nx) > Math.abs(ny)) m.dir = Math.PI - m.dir;
        else m.dir = -m.dir;
        m.bounces += 1;
        bounced = true;
        sim.hitstop = Math.max(sim.hitstop, 0.05);
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        if (m.bounces > 1) setMode(m, 'dizzy');
      }
      if (m.mode !== 'dying') collideProps(sim, m);
    }
  }
  // Крысы не слипаются и не проходят сквозь героя.
  const live = sim.mobs.filter(
    (m) => m.mode !== 'dying' && m.mode !== 'emerge' && m.mode !== 'drop' && m.t >= 0,
  );
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r;
      if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 1e-6) continue;
      const push = (min - d) / 2;
      const wa = MASS[b.kind] / (MASS[a.kind] + MASS[b.kind]);
      a.x -= (dx / d) * push * 2 * wa;
      a.y -= (dy / d) * push * 2 * wa;
      b.x += (dx / d) * push * 2 * (1 - wa);
      b.y += (dy / d) * push * 2 * (1 - wa);
    }
    if (h.mode === 'dead') continue;
    const dx = a.x - h.x;
    const dy = a.y - h.y;
    const min = a.r + h.r;
    const d = Math.hypot(dx, dy);
    if (d < min && d > 1e-6 && h.mode !== 'dash') {
      const push = min - d;
      a.x += (dx / d) * push * 0.85;
      a.y += (dy / d) * push * 0.85;
      h.x -= (dx / d) * push * 0.15;
      h.y -= (dy / d) * push * 0.15;
    }
  }
  for (const m of live) collideTiles(sim, m);
  collideTiles(sim, h);
}

function stepCart(sim: Sim, p: Prop, dt: number): void {
  if (!p.rail || Math.abs(p.v) < 0.02) {
    p.v = 0;
    return;
  }
  const r = p.rail;
  if (r.axis === 'v') p.y += p.v * dt;
  else p.x += p.v * dt;
  // Упор на концах рельсов.
  const lo = r.from + 0.5;
  const hi = r.to + 0.5;
  const pos = r.axis === 'v' ? p.y : p.x;
  if (pos < lo || pos > hi) {
    const clamped = Math.max(lo, Math.min(hi, pos));
    if (r.axis === 'v') p.y = clamped;
    else p.x = clamped;
    if (Math.abs(p.v) > 2) sim.events.push({ t: 'clank', x: p.x, y: p.y });
    p.v = -p.v * 0.25;
    p.wild = false;
  }
  p.v *= Math.exp(-(p.wild ? 0.15 : 0.45) * dt);
  const speed = Math.abs(p.v);
  if (speed < 2) return;
  // Давит всех на пути.
  const lvl = bandAt(sim.world, p.y).def.level;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge') continue;
    if (Math.hypot(m.x - p.x, m.y - p.y) > p.r + m.r + 0.05) continue;
    const dmg = 30 * Math.pow(1.8, lvl) * (speed / 7);
    m.hp -= dmg;
    m.flash = 0.15;
    const side = r.axis === 'v' ? Math.sign(m.x - p.x) || 1 : Math.sign(m.y - p.y) || 1;
    if (r.axis === 'v') {
      m.kx += side * 6;
      m.ky += Math.sign(p.v) * 4;
    } else {
      m.ky += side * 6;
      m.kx += Math.sign(p.v) * 4;
    }
    sim.events.push({
      t: 'hit',
      x: m.x,
      y: m.y,
      dmg: Math.round(dmg),
      crit: false,
      kill: m.hp <= 0,
      boss: false,
    });
    if (m.hp <= 0) killMob(sim, m);
  }
  const h = sim.hero;
  if (p.wild && Math.hypot(h.x - p.x, h.y - p.y) < p.r + h.r + 0.05) {
    hurtHero(sim, sim.stats.maxHp * 0.22, p.x, p.y, 8);
    p.v *= 0.4;
  }
}

function stepDrops(sim: Sim, dt: number): void {
  const h = sim.hero;
  const keep: Drop[] = [];
  for (const d of sim.drops) {
    d.age += dt;
    // Первые полсекунды добыча летит дугой, потом её тянет к герою.
    if (d.z > 0 || d.vz > 0) {
      d.vz -= 16 * dt;
      d.z += d.vz * dt;
      if (d.z <= 0) {
        d.z = 0;
        d.vz = Math.abs(d.vz) > 1.2 ? -d.vz * 0.35 : 0;
        d.vx *= 0.5;
        d.vy *= 0.5;
      }
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= Math.exp(-4 * dt);
    d.vy *= Math.exp(-4 * dt);
    const e = { x: d.x, y: d.y, r: 0.1 };
    collideTiles(sim, e);
    d.x = e.x;
    d.y = e.y;
    const dist = Math.hypot(h.x - d.x, h.y - d.y);
    const alive = h.mode !== 'dying' && h.mode !== 'dead';
    const takesRoom = d.kind !== 'coin' && d.kind !== 'token' && d.kind !== 'key';
    const room = !takesRoom || sackCount(sim.sack) + d.n <= sim.sackCap;
    if (alive && d.age > 0.45 && dist < MAGNET && room) {
      const pull = 7 + (MAGNET - dist) * 10;
      d.vx += ((h.x - d.x) / (dist || 1)) * pull * dt * 6;
      d.vy += ((h.y - d.y) / (dist || 1)) * pull * dt * 6;
    }
    if (alive && d.age > 0.45 && dist < PICK_R) {
      if (!room) {
        if (sim.time - sim.fullWarn > 3) {
          sim.fullWarn = sim.time;
          sim.events.push({ t: 'full' });
        }
        keep.push(d);
        continue;
      }
      take(sim, d);
      continue;
    }
    // Лежит долго — пропадает: мир не должен копить хлам.
    if (d.age < 120) keep.push(d);
  }
  sim.drops = keep;
}

function take(sim: Sim, d: Drop): void {
  const s = sim.sack;
  switch (d.kind) {
    case 'meat':
    case 'fatmeat':
      s.meat[d.kind] = (s.meat[d.kind] ?? 0) + d.n;
      s.meatBy[d.area] = (s.meatBy[d.area] ?? 0) + d.n;
      break;
    case 'coin':
      s.coins += d.n;
      break;
    case 'token':
      s.tokens += d.n;
      break;
    case 'key':
      s.keys += d.n;
      break;
    default:
      s.mats[d.kind as MatId] = (s.mats[d.kind as MatId] ?? 0) + d.n;
  }
  sim.events.push({ t: 'pick', x: d.x, y: d.y, what: d.kind, n: d.n });
}

function markFog(sim: Sim): void {
  const h = sim.hero;
  const w = sim.world;
  const R = 5;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const x = Math.floor(h.x) + dx;
      const y = Math.floor(h.y) + dy;
      if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
      const band = bandAt(w, y);
      const bits = sim.fog[band.def.id];
      if (!bits) continue;
      const i = (y - band.top) * w.w + x;
      if ((bits[i >> 3] & (1 << (i & 7))) === 0) {
        fogSet(bits, x, y - band.top, w.w);
        sim.fogDirty = true;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Взаимодействие: клеть, шахта, фонарь, решётка, тайник, доска, нора.
// ---------------------------------------------------------------------------

export type UseKind = 'lift' | 'mine' | 'light' | 'grate' | 'secret' | 'board' | 'seal' | 'plaque';

export interface Usable {
  kind: UseKind;
  obj: WorldObj;
  label: string;
}

/** Что можно сделать рядом с героем — для контекстной кнопки. */
export function usableNear(sim: Sim, props = 0): Usable | null {
  const h = sim.hero;
  if (h.mode === 'dying' || h.mode === 'dead') return null;
  let best: Usable | null = null;
  let bestD = 1e9;
  const consider = (u: Usable, d: number) => {
    if (d < bestD) {
      bestD = d;
      best = u;
    }
  };
  for (const o of sim.world.objs) {
    const cx = o.x + 0.5;
    // Для настенного — до пола под ним.
    const onWall = o.kind === 'mine' || o.kind === 'board' || o.kind === 'burrow';
    const cy = onWall ? o.y + 1.3 : o.y + 0.5;
    const d = Math.hypot(cx - h.x, cy - h.y);
    if (d > 1.6) continue;
    if (o.kind === 'lift') consider({ kind: 'lift', obj: o, label: 'Клеть' }, d);
    else if (o.kind === 'mine') consider({ kind: 'mine', obj: o, label: 'В шахту' }, d);
    else if (o.kind === 'board') consider({ kind: 'board', obj: o, label: 'Доска' }, d);
    else if (o.kind === 'plaque') consider({ kind: 'plaque', obj: o, label: 'Табличка' }, d + 0.3);
    else if (o.kind === 'unlit' && !sim.lit.has(o.id))
      consider({ kind: 'light', obj: o, label: 'Зажечь' }, d);
    else if (o.kind === 'secret') {
      const p = sim.props.find((x) => x.obj === o);
      if (p && !p.on) consider({ kind: 'secret', obj: o, label: 'Тайник' }, d);
    } else if (o.kind === 'grate' && sim.tiles[o.y * sim.world.w + o.x] === Tile.Grate) {
      // Решётка открывается только изнутри ходка — с востока.
      if (h.x > o.x + 0.5) consider({ kind: 'grate', obj: o, label: 'Открыть решётку' }, d);
    } else if (o.kind === 'burrow' && props > 0) {
      const b = sim.burrows.find((x) => x.obj === o);
      if (b && !b.sealed && o.out) {
        const od = Math.hypot(o.out[0] + 0.5 - h.x, o.out[1] + 0.5 - h.y);
        if (od < 1.3) consider({ kind: 'seal', obj: o, label: 'Заколотить' }, od + 0.2);
      }
    }
  }
  return best;
}

/** Сделать то, что делается прямо в мире. Клеть и шахту решает страница. */
export function useObject(sim: Sim, u: Usable): boolean {
  const o = u.obj;
  if (u.kind === 'light') {
    if (sim.lit.has(o.id)) return false;
    sim.lit.add(o.id);
    sim.delta.lamps.push(o.id);
    bump(sim, 'lamps', 1);
    const p = sim.props.find((x) => x.obj === o);
    if (p) p.on = true;
    return true;
  }
  if (u.kind === 'grate') {
    sim.tiles[o.y * sim.world.w + o.x] = Tile.Floor;
    sim.delta.opened.push(o.id);
    return true;
  }
  if (u.kind === 'secret') {
    const p = sim.props.find((x) => x.obj === o);
    if (!p || p.on) return false;
    p.on = true;
    sim.delta.secrets.push(o.id);
    bump(sim, 'secrets', 1);
    const e = sim.econ;
    for (let i = 0; i < 5; i++) dropAt(sim, 'coin', Math.round(e * 0.25), p.x, p.y + 0.4);
    for (let i = 0; i < 6; i++) dropAt(sim, 'token', 2 + Math.floor(sim.rng() * 3), p.x, p.y + 0.4);
    dropAt(sim, 'key', 1, p.x, p.y + 0.4);
    for (let i = 0; i < 4; i++) dropAt(sim, 'skin', 1, p.x, p.y + 0.4);
    return true;
  }
  if (u.kind === 'seal') {
    const b = sim.burrows.find((x) => x.obj === o);
    if (!b || b.sealed) return false;
    b.sealed = true;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Снаружи: стая у входа в шахту, снимок для сохранения, сброс дельты.
// ---------------------------------------------------------------------------

/** Пока копал в шахте, у входа собрались крысы: `packs` стай по 2–3. */
export function packAtMine(sim: Sim, mine: WorldObj, packs: number): void {
  if (packs <= 0) return;
  const holes = sim.burrows
    .filter((b) => b.obj.out && Math.hypot(b.obj.x - mine.x, b.obj.y - mine.y) < 12)
    .sort(
      (a, b) =>
        Math.hypot(a.obj.x - mine.x, a.obj.y - mine.y) -
        Math.hypot(b.obj.x - mine.x, b.obj.y - mine.y),
    );
  for (let p = 0; p < packs; p++) {
    const n = 2 + Math.floor(sim.rng() * 2);
    for (let i = 0; i < n; i++) {
      if (holes.length) {
        const b = holes[(p + i) % holes.length];
        b.cd = 0;
        const m = fromBurrow(sim, b, pickKind(sim, bandAt(sim.world, mine.y).def.id));
        m.t = -(p * 0.4 + i * 0.25);
      } else {
        const a = sim.rng() * Math.PI * 2;
        spawnMob(sim, 'rat', mine.x + 0.5 + Math.cos(a) * 3, mine.y + 2 + Math.sin(a) * 2, {
          mode: 'drop',
        });
      }
    }
  }
}

export interface RunSnap {
  area: AreaId;
  x: number;
  ly: number;
  hp: number;
  sack: Sack;
  killed: number;
}

export function snapshot(sim: Sim): RunSnap {
  const l = toLocal(sim.world, sim.hero.x, sim.hero.y);
  return {
    area: l.area,
    x: sim.hero.x,
    ly: l.ly,
    hp: sim.hero.hp,
    sack: {
      ...sim.sack,
      meat: { ...sim.sack.meat },
      mats: { ...sim.sack.mats },
      meatBy: { ...sim.sack.meatBy },
    },
    killed: sim.killed,
  };
}

/** Забрать накопленное для стора и начать копить заново. */
export function takeDelta(sim: Sim): SimDelta {
  const d = sim.delta;
  sim.delta = { kills: {}, stats: {}, xp: 0, lamps: [], opened: [], secrets: [], bosses: [] };
  return d;
}

/** Разведка района в виде битов — для сохранения. */
export function fogOf(sim: Sim, area: AreaId): Uint8Array | null {
  return sim.fog[area] ?? null;
}

/** Мировые координаты точки по местным — для возврата в вылазку. */
export function worldPos(sim: Sim, area: AreaId, x: number, ly: number): { x: number; y: number } {
  const b = bandOf(sim.world, area);
  return { x, y: (b?.top ?? 0) + ly };
}

/** Клетка героя проходима — на случай битого сохранения. */
export function heroStuck(sim: Sim): boolean {
  return solidTile(sim, Math.floor(sim.hero.x), Math.floor(sim.hero.y));
}

export { tileAt };
