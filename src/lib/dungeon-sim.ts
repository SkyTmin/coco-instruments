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
//   • боссы этажей — сценарии в `dungeon-floors/fN-brains.ts` (v2.81);
//   • снаряды, удары по площади с меткой на полу, лужи и облака, статусы
//     героя (яд, ожог, холод, замедление, оглушение), опасные клетки.
//
// Монстры — данными (`MobDef`), их ИИ — в реестре `dungeon-ai.ts`: общая
// библиотека `dungeon-brains.ts` и своё у каждого этажа.

import {
  AREAS,
  areaOf,
  armorCut,
  beastBonus,
  BOSSES,
  bossLoot,
  CRIT_X,
  CRATE_COINS,
  SECRET_COINS,
  levelOf,
  mobStats,
  MOBS,
  MEATS,
  canTake,
  DEEP_NOISE_MAX,
  isMeat,
  sackAdd,
  smellOf,
  ALBINO_CHANCE,
  floorBeaten,
  floorOf,
} from './dungeon';
import type {
  Affix,
  AreaId,
  BossDef,
  BossId,
  DungeonState,
  Hero,
  MatId,
  MeatId,
  MobDef,
  MobId,
  ItemId,
  Sack,
  ShotSpec,
  StatId,
  StatusKind,
} from './dungeon';
import { STREAK_TIERS } from './prison';
import {
  arenaCells,
  bandAt,
  bandOf,
  fogDecode,
  fogSet,
  hazardAt,
  railAt,
  Tile,
  tileAt,
  toLocal,
  walkableTile,
} from './dungeon-world';
import { BOSS_SCRIPTS, BRAINS, FLOOR_SCRIPTS } from './dungeon-ai';
import type { BrainCtx, SimApi, SpawnOpts, StrikeIn, Tele, ZoneIn } from './dungeon-ai';
// ИИ общей библиотеки и этажей регистрируются при загрузке.
import './dungeon-brains';
import './dungeon-floors/brains';
import type { Rail, World, WorldObj } from './dungeon-world';
import { collideGrid, moveBody, steerVelocity } from './walk';
import type { Grid } from './walk';

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

/** Что лежит на полу: вещь рюкзака (мясо, материал, руда) или монеты, токены, ключ. */
export type DropKind = ItemId | 'coin' | 'token' | 'key';

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
  | {
      t: 'boss';
      /** wake, split, dead, reset, roll, whip, summon, phase — или своё слово сценария. */
      what: string;
      /** Надпись на табло (для `phase` и своих). */
      text?: string;
      sub?: string;
    }
  | { t: 'shot'; x: number; y: number; art: string }
  | { t: 'strike'; x: number; y: number; art: string; big?: boolean }
  | { t: 'status'; kind: StatusKind }
  | { t: 'combo'; n: number }
  | { t: 'streak'; tier: number }
  | { t: 'skill'; x: number; y: number }
  | { t: 'gold'; x: number; y: number; mob: MobId }
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
  /** Статусы: сколько секунд осталось и сила (урон в секунду, доля замедления). */
  status: Partial<Record<StatusKind, { t: number; p: number }>>;
}

/**
 * Режим моба. Общие ведёт движок: `emerge` (из норы), `drop` (со свода),
 * `sleep`, `alert`, `stun`, `dying`, `escape`. Остальные — ИИ вида:
 * `chase`, `windup`, `recover`, `flee`, `plant`, `aim`, `charge`, `dizzy`,
 * `roar`… (ИИ этажа вправе завести свои).
 */
export type MobMode = string;

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
  /** Черновик ИИ: свои счётчики вида. */
  data: Record<string, number>;
  /** Метка на полу — куда придётся удар (рисует движок). */
  tele: Tele | null;
  /**
   * Опасен прямо сейчас в этом радиусе: рывок под такой удар — уклон в
   * последний миг (замедление и верный крит).
   */
  danger: number;
  /** Отскакивает от стен (катится, таранит): удар о стену зовёт `onWall`. */
  bounce: boolean;
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
  | 'secret'
  | 'deco'
  | 'breakable';

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
  def: BossDef;
  obj: WorldObj;
  cells: Set<number>;
  /** Состояние боя: ждёт героя, идёт, выигран в этой вылазке, отдыхает. */
  state: 'idle' | 'fight' | 'won' | 'rest';
  /** Когда проснётся (время часов, мс). */
  readyAt: number;
  gates: number[];
  split: boolean;
  t: number;
  /** Победитель уходит: ворота держатся открытыми, пока он не отошёл. */
  exiting?: boolean;
  /** Фаза боя для сценария (0 — начало). */
  phase: number;
  /** Черновик сценария. */
  data: Record<string, number>;
}

/** Снаряд в полёте. */
export interface Shot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  age: number;
  dmg: number;
  art: string;
  status?: StatusKind;
  dur?: number;
  /** Навесом: откуда, куда и сколько лететь; высота для рисунка. */
  lob?: { x0: number; y0: number; x1: number; y1: number; T: number };
  z: number;
  /** Чей: для бестиария и защиты. */
  kind: MobId;
}

/** Удар по площади: метка горит `warn`, потом бьёт один раз. */
export interface Strike extends StrikeIn {
  id: number;
  t: number;
}

/** Лужа, облако, огонь. */
export interface Zone extends ZoneIn {
  id: number;
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
  /** Этаж мира. */
  floor: number;
  /** Босс этажа хоть раз побеждён: печати открыты, лестница вниз работает. */
  beaten: boolean;
  /** Черновик сценария этажа (`registerFloor`). */
  floorData: Record<string, number>;
  tiles: Uint8Array;
  /** Клетки, сменённые на ходу (`api.setTile`): рендер перерисует их куски. */
  retiled: number[];
  /** Счётчик переносов героя (`api.moveHero`): рендер ставит камеру сразу. */
  warps: number;
  time: number;
  rng: () => number;
  now: () => number;
  stats: Hero;
  hero: HeroState;
  mobs: Mob[];
  props: Prop[];
  drops: Drop[];
  bombs: Bomb[];
  shots: Shot[];
  strikes: Strike[];
  zones: Zone[];
  burrows: Burrow[];
  ambushes: { obj: WorldObj; used: boolean }[];
  groups: { obj: WorldObj; used: boolean }[];
  director: Director;
  boss: BossFight | null;
  sack: Sack;
  /** Карманы сидора: сколько рядов ячеек. */
  sackLevel: number;
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

/**
 * Рывок — выпад, а не телепорт. Был 3 клетки за 0,18 с (17 клеток в
 * секунду), и владелец описал его «как будто телепортируюсь». Теперь 0,3 с
 * с торможением: старт втрое быстрее бега, к концу — скорость бега, и шаг
 * продолжается без рывка на остановке. Неуязвимость — почти весь выпад:
 * последние 30 мс уязвим, иначе короля на слабом снаряжении било бы легко
 * (это держит тест «король на Лагерном без заточки»).
 */
export const DASH = { dur: 0.3, inv: 0.27, cd: 1.0, end: 0.3 };
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
const massOf = (kind: MobId) => MOBS[kind]?.mass ?? 1;
/** Описание вида (незнакомый — как серая крыса, чтобы битое сохранение не падало). */
const defOf = (kind: MobId): MobDef => MOBS[kind] ?? MOBS.rat ?? Object.values(MOBS)[0];

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

/** Кто и как появляется в районе (`AreaSpec.spawn`). */
const spawnOf = (area: AreaId) => areaOf(area).spec.spawn;

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
  deco: 'deco',
  breakable: 'breakable',
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
  deco: 0.34,
  breakable: 0.38,
};

export function createSim(o: SimOptions): Sim {
  // Свой вид клеток у каждой вылазки: `api.setTile` меняет его на ходу, а
  // мир страницы общий для всех вылазок этажа.
  const w: World = { ...o.world, mark: o.world.mark.slice() };
  const tiles = w.tiles.slice();
  const d = o.dungeon;
  // Постоянные перемены мира: открытые решётки, найденные тайники.
  for (const obj of w.objs) {
    if (obj.kind === 'grate' && d.opened.includes(obj.id)) tiles[obj.y * w.w + obj.x] = Tile.Floor;
    if (obj.kind === 'crack' && d.opened.includes(obj.id)) tiles[obj.y * w.w + obj.x] = Tile.Floor;
  }
  const lvl = levelOf(d.xp).level;
  // Босс этажа побеждён — печати на пути к лестнице открыты навсегда.
  const beaten = floorBeaten(d, w.floor);
  if (beaten)
    for (const obj of w.objs) if (obj.kind === 'seal') tiles[obj.y * w.w + obj.x] = Tile.Floor;
  const sim: Sim = {
    world: w,
    floor: w.floor,
    beaten,
    floorData: {},
    tiles,
    retiled: [],
    warps: 0,
    time: 0,
    rng: lcg(o.seed ?? Date.now() & 0x7fffffff),
    now: o.now ?? (() => Date.now()),
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
      status: {},
    },
    mobs: [],
    props: [],
    drops: [],
    bombs: [],
    shots: [],
    strikes: [],
    zones: [],
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
    sackLevel: d.sackLevel,
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
      const hp = kind === 'breakable' ? (obj.hp ?? 2) : (hpBase[kind] ?? 0) * scale;
      const p: Prop = {
        id: sim.nextId++,
        kind,
        obj,
        x: obj.x + 0.5,
        y: obj.y + 0.5,
        r: kind === 'deco' || kind === 'breakable' ? (obj.solid ?? PROP_R[kind]) : PROP_R[kind],
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

  // Арена босса этажа (одна на этаж: все ворота мира — её).
  const bossObj = w.objs.find((x) => x.kind === 'boss');
  const def = bossObj ? BOSSES[bossObj.ref as BossId] : undefined;
  if (bossObj && def) {
    const cells = arenaCells(w, bossObj);
    const gates = w.objs.filter((x) => x.kind === 'gate').map((x) => x.y * w.w + x.x);
    const readyAt = (d.bosses[def.id]?.at ?? 0) + def.restMs;
    const resting = readyAt > sim.now();
    sim.boss = {
      id: def.id,
      def,
      obj: bossObj,
      cells,
      state: resting ? 'rest' : 'idle',
      readyAt,
      gates,
      split: false,
      t: 0,
      phase: 0,
      data: {},
    };
  }
  updateGates(sim);
  markFog(sim);
  FLOOR_SCRIPTS.get(sim.floor)?.start?.(sim, API);
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

/**
 * Сетка столкновений мира — клетка в целую плитку. Одна на симуляцию: удар
 * по крысе зовёт столкновения десятки раз за кадр, и новый объект на каждый
 * вызов был бы мусором. Клетки читаются живыми (`sim.tiles` меняется:
 * решётки, осыпавшиеся трещины, ворота арены).
 */
const grids = new WeakMap<Sim, Grid>();
const flyGrids = new WeakMap<Sim, Grid>();
function gridOf(sim: Sim): Grid {
  let g = grids.get(sim);
  if (!g) {
    g = {
      w: sim.world.w,
      h: sim.world.h,
      cell: 1,
      solid: (x, y) => solidTile(sim, x, y),
    };
    grids.set(sim, g);
  }
  return g;
}

/** Сетка летунов: «глубина» (вода, пропасть) им не преграда. */
function flyGridOf(sim: Sim): Grid {
  let g = flyGrids.get(sim);
  if (!g) {
    const w = sim.world;
    g = {
      w: w.w,
      h: w.h,
      cell: 1,
      solid: (x, y) =>
        x < 0 || y < 0 || x >= w.w || y >= w.h
          ? true
          : sim.tiles[y * w.w + x] === Tile.Deep
            ? false
            : solidTile(sim, x, y),
    };
    flyGrids.set(sim, g);
  }
  return g;
}

/** Круг против клеток: вытолкнуть наружу, скользя вдоль стены (`lib/walk.ts`). */
function collideTiles(sim: Sim, e: { x: number; y: number; r: number; kind?: MobId }): boolean {
  const fly = e.kind !== undefined && MOBS[e.kind]?.fly;
  return collideGrid(fly ? flyGridOf(sim) : gridOf(sim), e);
}

/** Клетка закрывает вид: стены, закрытые ворота и печати — но не вода. */
function opaque(sim: Sim, x: number, y: number): boolean {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return true;
  const t = sim.tiles[y * w.w + x];
  return !walkableTile(t) && t !== Tile.Deep;
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
  'deco',
  'breakable',
];

function collideProps(sim: Sim, e: { x: number; y: number; r: number }, share = 1): Prop | null {
  let touched: Prop | null = null;
  for (const p of sim.props) {
    if (!p.alive || p.r <= 0 || !SOLID_PROPS.includes(p.kind)) continue;
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
    if (opaque(sim, x, y)) return false;
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

export function spawnMob(sim: Sim, kind: MobId, x: number, y: number, opts: SpawnOpts = {}): Mob {
  const band = bandAt(sim.world, y);
  const level = opts.level ?? band.def.level;
  const def = defOf(kind);
  const albino = !def.boss && !def.noAlbino && sim.rng() < ALBINO_CHANCE;
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
    r: def.radius * (opts.elite ? 1.15 : 1),
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
    data: {},
    tele: null,
    danger: 0,
    bounce: false,
  };
  sim.mobs.push(m);
  return m;
}

function pickKind(sim: Sim, area: AreaId): MobId {
  const list = spawnOf(area).mobs;
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
  for (const m of sim.mobs) if (m.mode !== 'dying' && !defOf(m.kind).boss) n++;
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
  const spec = spawnOf(area);
  const smell = smellOf(sim.sack);
  const safeNow = nearSafe(sim, h.x, h.y, SAFE_R + 2);

  // Спящие стаи — появляются, когда подходишь.
  for (const g of sim.groups) {
    if (g.used) continue;
    if (Math.hypot(g.obj.x + 0.5 - h.x, g.obj.y + 0.5 - h.y) > 16) continue;
    g.used = true;
    const band = bandAt(sim.world, g.obj.y);
    const gs = spawnOf(band.def.id);
    const n = 3 + Math.floor(sim.rng() * 3);
    const lead = sim.rng() < 0.18;
    for (let i = 0; i < n; i++) {
      const kind = gs.group ? gs.group(i, n, sim.rng) : pickKind(sim, band.def.id);
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

  // Поток из норы (крысиная орда).
  if (!bossOn && !safeNow && spec.horde) {
    if (d.hordeLeft > 0) {
      d.hordeWarn -= dt;
      if (d.hordeWarn <= 0) {
        const b = sim.burrows[d.hordeFrom];
        if (b && liveMobs(sim) < MOB_CAP + 10) {
          fromBurrow(sim, b, spec.horde(sim.rng), {
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

  // Беглец с мешком монет (золотая крыса).
  d.goldT -= dt;
  if (d.goldT <= 0 && !bossOn) {
    const b = spec.treasure ? pickBurrow(sim, 8, 15) : null;
    if (b && spec.treasure) {
      const m = fromBurrow(sim, b, spec.treasure);
      m.mode = 'emerge';
      sim.events.push({ t: 'gold', x: m.x, y: m.y, mob: m.kind });
    }
    d.goldT = 900 + sim.rng() * 900;
  }

  // Сорвавшаяся вагонетка — там, где они водятся, если стоишь на её рельсах.
  if (spec.carts && !bossOn) {
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
  d.spawnT -= dt * spec.density * (1 + smell);
  if (d.spawnT > 0) return;
  d.spawnT = 2.2 + sim.rng() * 1.2;
  if (liveMobs(sim) >= MOB_CAP || nearMobs(sim, 12) >= NEAR_CAP) return;
  const b = pickBurrow(sim, 6, 16);
  if (!b) return;
  const n = spec.pack[0] + Math.floor(sim.rng() * spec.pack[1]);
  const kind = pickKind(sim, area);
  const elite = sim.rng() < 0.05;
  for (let i = 0; i < n; i++) {
    const m = fromBurrow(sim, b, i === 0 ? kind : spec.filler, { elite: elite && i === 0 });
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

/**
 * Недосягаем для героя: выползает, падает, умирает, ушёл в нору — или ИИ
 * сам спрятал его (`m.data.ghost` > 0: нырнул, окаменел, в панцире). Удары,
 * взрывы, вагонетки и прицел его не берут.
 */
const ghost = (m: Mob) =>
  m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape' || (m.data.ghost ?? 0) > 0;

/** Кого бить: захваченная цель, иначе ближняя в конусе взгляда, иначе ближняя вообще. */
function autoAim(sim: Sim, reach: number): number {
  const h = sim.hero;
  const lock = h.lock != null ? sim.mobs.find((m) => m.id === h.lock && !ghost(m)) : null;
  if (lock && Math.hypot(lock.x - h.x, lock.y - h.y) < reach + 2.5)
    return Math.atan2(lock.y - h.y, lock.x - h.x);
  let best: Mob | null = null;
  let bestD = 1e9;
  for (const m of sim.mobs) {
    if (ghost(m)) continue;
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
  p.kind === 'cart' ||
  p.kind === 'breakable';

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
    if (h.hitSet.has(m.id) || ghost(m)) continue;
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
  const hit = heroDamage(sim, m, mult);
  const { crit } = hit;
  let dmg = hit.dmg;
  const ang = Math.atan2(m.y - h.y, m.x - h.x);
  const def = defOf(m.kind);
  // Щит, броня спереди, уязвимое окно — решает ИИ моба (`Brain.onHit`).
  const guard = BRAINS.get(def.brain)?.onHit?.(sim, m, { dmg, crit, heavy, ang }, API);
  if (typeof guard === 'number') dmg *= Math.max(0, guard);
  if (dmg <= 0) {
    // Отбил: звон и искры, без урона и без отброса. Герой чуть отлетает —
    // удар пришёлся в железо.
    m.flash = 0.06;
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    sim.hitstop = Math.max(sim.hitstop, 0.05);
    h.vx -= Math.cos(ang) * 2.2;
    h.vy -= Math.sin(ang) * 2.2;
    return false;
  }
  m.hp -= dmg;
  m.flash = 0.12;
  h.skill = Math.min(1, h.skill + SKILL.perHit);
  const k = (knock * (heavy ? 1.3 : 1)) / massOf(m.kind);
  m.kx += Math.cos(ang) * k;
  m.ky += Math.sin(ang) * k;
  const boss = !!def.boss;
  // Сбить замах можно не всяким ударом, иначе серия ударов держит стаю в
  // вечном оглушении и крысы не кусают вовсе (так было на первом замере:
  // ноль смертей в любом комплекте). Пасюка сбивает крит, тяжёлый удар и
  // треть обычных; жирную — только тяжёлый или крит; босса — ничто
  // (`MobDef.flinch`).
  const fl = def.flinch ?? 0.35;
  const flinch = !boss && (heavy || crit || fl >= 1 || (fl > 0 && sim.rng() < fl));
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

/**
 * Ходовой материал этажа (на первом — крысиная шкурка): его роняют ящики,
 * гнёзда и тайники. Раньше везде стояла шкурка — и на пятом этаже из
 * разбитого горшка выпадали крысиные шкурки.
 */
function commonMat(sim: Sim): string {
  return floorOf(sim.floor).mats.find((m) => (m.stack ?? 32) > 1)?.id ?? 'skin';
}

function breakProp(sim: Sim, p: Prop): void {
  p.alive = false;
  sim.events.push({ t: 'break', x: p.x, y: p.y, kind: p.kind });
  if (p.kind === 'crate' || p.kind === 'barrel' || p.kind === 'breakable') {
    if (sim.rng() < 0.55)
      dropAt(sim, 'coin', Math.round(CRATE_COINS * (0.6 + sim.rng())), p.x, p.y);
    if (sim.rng() < 0.16) dropAt(sim, p.obj.loot ?? commonMat(sim), 1, p.x, p.y);
    if (sim.rng() < 0.07) dropAt(sim, 'token', 1 + Math.floor(sim.rng() * 2), p.x, p.y);
  }
  if (p.kind === 'nest' || p.kind === 'cartnest') {
    dropAt(sim, commonMat(sim), 1, p.x, p.y);
    dropAt(sim, commonMat(sim), 1, p.x, p.y);
    if (sim.rng() < 0.3) dropAt(sim, 'token', 2 + Math.floor(sim.rng() * 3), p.x, p.y);
    gainXp(sim, 12 * Math.pow(1.5, bandAt(sim.world, p.y).def.level));
  }
}

function explode(sim: Sim, x: number, y: number, r: number, dmg: number, heroShare: number): void {
  sim.events.push({ t: 'boom', x, y, r });
  sim.hitstop = Math.max(sim.hitstop, 0.09);
  for (const m of sim.mobs) {
    if (ghost(m)) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d > r + m.r) continue;
    const k = 1 - d / (r + m.r);
    m.hp -= dmg * (0.5 + 0.5 * k);
    m.flash = 0.15;
    const a = Math.atan2(m.y - y, m.x - x);
    m.kx += (Math.cos(a) * 9) / massOf(m.kind);
    m.ky += (Math.sin(a) * 9) / massOf(m.kind);
    if (m.hp <= 0) killMob(sim, m);
    else if (!defOf(m.kind).boss) {
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
  status?: { kind: StatusKind; dur: number },
): void {
  const h = sim.hero;
  if (h.inv > 0 || h.mode === 'dying' || h.mode === 'dead') return;
  if (status) heroStatus(sim, status.kind, status.dur);
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
  const was = m.mode;
  m.mode = 'dying';
  m.tele = null;
  m.danger = 0;
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
  const def = defOf(m.kind);
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
  if (def.coins) {
    const bag = def.coins;
    for (let i = 0; i < 6; i++) dropAt(sim, 'coin', Math.round(bag / 6), m.x, m.y);
  }
  // Своё у вида: подрывник, убитый с шашкой в зубах, роняет её горящей.
  BRAINS.get(def.brain)?.onDeath?.(sim, m, was, API);
  if (def.boss) onBossPartDown(sim, m);
}

// ---------------------------------------------------------------------------
// Король.
// ---------------------------------------------------------------------------

/**
 * Ворота логова. В бою закрыты. После победы — открыты, пока король
 * отдыхает, а герой внутри или РЯДОМ с воротами: клетка ворот сама не
 * входит в арену, и раньше ворота захлопывались, едва герой на неё
 * наступал; его выталкивало назад, они снова открывались — дверь мигала
 * невидимой стеной (владелец: «будто скрытая дверь»). Теперь закрываются,
 * только когда герой ушёл дальше `GATE_CLEAR` клеток от всех ворот.
 */
const GATE_CLEAR = 2.5;

function updateGates(sim: Sim): void {
  const b = sim.boss;
  if (!b) return;
  const h = sim.hero;
  const heroIn = inArena(sim, h.x, h.y);
  const w = sim.world.w;
  const near = b.gates.some(
    (g) => Math.hypot((g % w) + 0.5 - h.x, Math.floor(g / w) + 0.5 - h.y) < GATE_CLEAR,
  );
  if (b.state === 'won') b.exiting = true;
  if (b.exiting && !heroIn && !near) b.exiting = false;
  // Снаружи к отдыхающему королю ворота не пускают; выходящего не запирают.
  const closed = b.state === 'fight' || (b.state === 'rest' && !heroIn && !b.exiting);
  for (const g of b.gates) sim.tiles[g] = closed ? Tile.Gate : Tile.Floor;
}

function startBoss(sim: Sim): void {
  const b = sim.boss!;
  b.state = 'fight';
  b.split = false;
  b.t = 0;
  b.phase = 0;
  b.data = {};
  const lead = spawnMob(sim, b.def.mob, b.obj.x + 0.5, b.obj.y + 0.5, { mode: 'roar' });
  BOSS_SCRIPTS.get(b.def.script)?.start?.(sim, b, lead, API);
  sim.events.push({ t: 'boss', what: 'wake' });
  // Стаи и чужие мобы из арены убираются: бой один на один с боссом.
  sim.mobs = sim.mobs.filter((m) => m === lead || !inArena(sim, m.x, m.y));
  updateGates(sim);
}

function resetBoss(sim: Sim): void {
  const b = sim.boss;
  if (!b) return;
  BOSS_SCRIPTS.get(b.def.script)?.reset?.(sim, b);
  sim.mobs = sim.mobs.filter((m) => !defOf(m.kind).boss);
  sim.strikes = [];
  sim.zones = [];
  sim.shots = [];
  b.state = 'idle';
  b.split = false;
  sim.events.push({ t: 'boss', what: 'reset' });
  updateGates(sim);
}

function onBossPartDown(sim: Sim, m: Mob): void {
  const b = sim.boss;
  if (!b || b.state !== 'fight') return;
  // Сценарий решает, продолжается ли бой (король распадается на малых).
  if (BOSS_SCRIPTS.get(b.def.script)?.onPartDown?.(sim, b, m, API)) return;
  const left = sim.mobs.filter((x) => defOf(x.kind).boss && x.mode !== 'dying');
  if (left.length) return;
  b.state = 'won';
  sim.delta.bosses.push({ id: b.id, at: sim.now() });
  sim.events.push({ t: 'boss', what: 'dead' });
  sim.slowmo = Math.max(sim.slowmo, 0.6);
  sim.strikes = [];
  sim.shots = [];
  const loot = bossLoot(b.id, sim.rng);
  const cx = b.obj.x + 0.5;
  const cy = b.obj.y + 0.5;
  for (let i = 0; i < 8; i++) dropAt(sim, 'coin', Math.round(loot.coins / 8), cx, cy);
  for (let i = 0; i < Math.min(12, loot.tokens); i++)
    dropAt(sim, 'token', Math.ceil(loot.tokens / Math.min(12, loot.tokens)), cx, cy);
  if (loot.keys) dropAt(sim, 'key', loot.keys, cx, cy);
  for (const [mat, n] of Object.entries(loot.mats) as [MatId, number][])
    for (let i = 0; i < n; i++) dropAt(sim, mat, 1, cx, cy);
  // Первая победа открывает печати: дорога к лестнице вниз.
  if (!sim.beaten) {
    sim.beaten = true;
    for (const o of sim.world.objs)
      if (o.kind === 'seal') sim.tiles[o.y * sim.world.w + o.x] = Tile.Floor;
    sim.events.push({ t: 'boss', what: 'seal' });
  }
  updateGates(sim);
}

/** Засечки фаз на полосе босса (доли 0…1). */
export function bossNotches(sim: Sim): number[] {
  const b = sim.boss;
  if (!b || b.state !== 'fight') return [];
  return BOSS_SCRIPTS.get(b.def.script)?.notches?.(sim, b) ?? [];
}

/** Полоса здоровья боя 0…1, null — боя нет. */
export function bossBar(sim: Sim): number | null {
  const b = sim.boss;
  if (!b || b.state !== 'fight') return null;
  const own = BOSS_SCRIPTS.get(b.def.script)?.bar?.(sim, b);
  if (own !== undefined) return own;
  let hp = 0;
  let max = 0;
  for (const m of sim.mobs)
    if (defOf(m.kind).boss) {
      hp += Math.max(0, m.hp);
      max += m.maxHp;
    }
  return max > 0 ? hp / max : 0;
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
  const def = defOf(m.kind);
  const smell = smellOf(sim.sack);
  if (m.affixes.includes('regen') && m.mode !== 'dying')
    m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.03 * dt);
  const brain = BRAINS.get(def.brain) ?? BRAINS.get('melee')!;
  const ctx: BrainCtx = { dx, dy, dist, def, smell };

  // ИИ, ведущий все режимы сам (боссы).
  if (brain.raw) {
    if (m.mode !== 'dying') brain.step(sim, m, dt, ctx, API);
    return;
  }

  const resume = def.resume ?? 'chase';
  switch (m.mode) {
    case 'emerge': {
      // Из стены на пол: полсекунды выползает.
      // До своей очереди (t < 0) сидит в норе, а не выезжает назад в стену.
      const k = Math.max(0, Math.min(1, m.t / 0.45));
      const b = sim.burrows[m.burrow];
      if (b) {
        m.x = b.obj.x + 0.5 + (m.hx - b.obj.x - 0.5) * k;
        m.y = b.obj.y + 0.5 + (m.hy - b.obj.y - 0.5) * k;
      }
      if (k >= 1) {
        m.x = m.hx;
        m.y = m.hy;
        setMode(m, resume);
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
      m.tele = null;
      m.danger = 0;
      if (m.t > (def.stunT ?? 0.2)) setMode(m, resume);
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
    m.tele = null;
    return;
  }

  // Привязь: далеко от дома и героя не видно — домой.
  if (Math.hypot(m.x - m.hx, m.y - m.hy) > LEASH && dist > 8 && m.mode === 'chase') {
    const back = Math.atan2(m.hy - m.y, m.hx - m.x);
    steer(sim, m, Math.cos(back), Math.sin(back), m.speed, dt);
    return;
  }

  brain.step(sim, m, dt, ctx, API);
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

function stepHero(sim: Sim, dt: number, input0: SimInput): void {
  let input = input0;
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

  // Статусы: яд и ожог жгут здоровье, холод и замедление — ноги, оглушение —
  // всё сразу.
  tickStatus(sim, dt);
  const stunned = (h.status.stun?.t ?? 0) > 0;
  if (stunned) input = { ...NO_INPUT };
  // Очарован: джойстик и прицел наоборот. Рывок и удар работают — ответ есть.
  if ((h.status.charm?.t ?? 0) > 0)
    input = {
      ...input,
      mx: -input.mx,
      my: -input.my,
      aim: input.aim ? { x: -input.aim.x, y: -input.aim.y } : null,
    };

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
    if (bestFood(sim.sack) && h.hp < st.maxHp) {
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
      // Скорость падает линейно от v0 до v0·end: путь = v0·dur·(1+end)/2.
      const v0 = (2 * st.dash) / (DASH.dur * (1 + DASH.end));
      const k = Math.min(1, h.t / DASH.dur);
      const v = v0 * (1 - (1 - DASH.end) * k);
      h.vx = Math.cos(h.dashDir) * v;
      h.vy = Math.sin(h.dashDir) * v;
      if (h.t >= DASH.dur) {
        h.mode = 'free';
        h.t = 0;
        h.vx *= 0.6;
        h.vy *= 0.6;
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
        const id: MeatId | null = bestFood(sim.sack);
        if (id && (sim.sack.meat[id] ?? 0) > 0) {
          sim.sack.meat[id] = (sim.sack.meat[id] ?? 0) - 1;
          // Из какого района кусок — всё равно: списываем с самого мелкого.
          const by = Object.entries(sim.sack.meatBy).sort(
            (a, b) => AREAS.findIndex((x) => x.id === a[0]) - AREAS.findIndex((x) => x.id === b[0]),
          )[0];
          if (by) sim.sack.meatBy[by[0] as AreaId] = Math.max(0, (by[1] ?? 0) - 1);
          const heal = st.maxHp * (MEATS[id]?.heal ?? 0.15);
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
  steerVelocity(h, mx, my, st.speed * speedK * slowOf(sim), dt);
  if (moving && h.mode === 'free') h.face = Math.atan2(my, mx);
  moveHero(sim, dt);
}

/** Самая сытная еда в рюкзаке — её и съедят. */
function bestFood(s: Sack): MeatId | null {
  let best: MeatId | null = null;
  let heal = -1;
  for (const [id, n] of Object.entries(s.meat)) {
    const f = MEATS[id];
    if (!n || !f) continue;
    if (f.heal > heal) {
      heal = f.heal;
      best = id;
    }
  }
  return best;
}

/** Повесить статус на героя: дольше — продлевает, сильнее — усиливает. */
function heroStatus(sim: Sim, kind: StatusKind, dur: number, power?: number): void {
  const h = sim.hero;
  if (h.mode === 'dying' || h.mode === 'dead') return;
  const p =
    power ??
    (kind === 'poison'
      ? 0.03
      : kind === 'burn'
        ? 0.05
        : kind === 'slow'
          ? 0.4
          : kind === 'chill'
            ? 0.3
            : 1);
  const cur = h.status[kind];
  if (!cur) sim.events.push({ t: 'status', kind });
  h.status[kind] = { t: Math.max(cur?.t ?? 0, dur), p: Math.max(cur?.p ?? 0, p) };
}

/** Статусы тикают: яд и ожог жгут (броня не спасает, неуязвимость — тоже). */
function tickStatus(sim: Sim, dt: number): void {
  const h = sim.hero;
  for (const [k, v] of Object.entries(h.status) as [StatusKind, { t: number; p: number }][]) {
    if (!v) continue;
    if (k === 'poison' || k === 'burn') {
      h.hp -= sim.stats.maxHp * v.p * dt;
      if (h.hp <= 0) {
        h.hp = 0;
        h.mode = 'dying';
        h.t = 0;
        if (sim.boss?.state === 'fight') resetBoss(sim);
      }
    }
    v.t -= dt;
    if (v.t <= 0) delete h.status[k];
  }
}

/** Множитель скорости героя: статусы, опасная клетка, лужи и облака. */
function slowOf(sim: Sim): number {
  const h = sim.hero;
  let k = 1;
  if (h.status.slow) k *= 1 - h.status.slow.p;
  if (h.status.chill) k *= 1 - h.status.chill.p;
  const hz = hazardAt(sim.world, Math.floor(h.x), Math.floor(h.y));
  if (hz?.slow) k *= hz.slow;
  for (const z of sim.zones)
    if (z.slow && z.t >= (z.warn ?? 0) && Math.hypot(z.x - h.x, z.y - h.y) < z.r) k *= z.slow;
  return Math.max(0.2, k);
}

/** Уклон в последний миг: рывок пришёлся под уже летящий удар. */
function perfectDodge(sim: Sim): boolean {
  const h = sim.hero;
  for (const m of sim.mobs) {
    const d = Math.hypot(m.x - h.x, m.y - h.y);
    if (m.mode === 'windup') {
      const def = defOf(m.kind);
      const left = def.windup - m.t;
      if (left <= DODGE_WINDOW && d < def.reach + m.r + h.r + 0.3) return true;
    }
    if (m.danger > 0 && d < m.danger) return true;
  }
  for (const b of sim.bombs)
    if (b.fuse < 0.3 && Math.hypot(b.x - h.x, b.y - h.y) < b.r + 0.3) return true;
  for (const st of sim.strikes)
    if (st.warn - st.t < 0.3 && strikeHits(st, h.x, h.y, h.r)) return true;
  for (const sh of sim.shots)
    if (Math.hypot(sh.x - h.x, sh.y - h.y) < sh.r + h.r + 0.9) return true;
  return false;
}

function moveHero(sim: Sim, dt: number): void {
  const h = sim.hero;
  const moved = moveBody(gridOf(sim), h, dt, () => {
    const cart = collideProps(sim, h);
    if (cart?.kind === 'cart' && cart.rail && Math.abs(cart.v) < 1) {
      // Упёрся в вагонетку вдоль рельсов — она медленно подаётся.
      const along = cart.rail.axis === 'v' ? h.vy : h.vx;
      if (Math.abs(along) > 1) cart.v = Math.sign(along) * 1.6;
    }
  });
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
  // Правила этажа (проклятие подъёма, свет, события) — сценарий этажа.
  FLOOR_SCRIPTS.get(sim.floor)?.step?.(sim, dt, API);

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
      b.readyAt = sim.now() + b.def.restMs;
    }
    if (b.state === 'idle' && inside && h.mode !== 'dying' && h.mode !== 'dead') startBoss(sim);
    if (b.state === 'fight') BOSS_SCRIPTS.get(b.def.script)?.step?.(sim, b, dt, API);
    updateGates(sim);
  }

  // Опасная клетка под ногами: жжёт, травит, вязнет.
  if (h.mode !== 'dying' && h.mode !== 'dead') {
    const hz = hazardAt(sim.world, Math.floor(h.x), Math.floor(h.y));
    if (hz) {
      if (hz.status) heroStatus(sim, hz.status, hz.dur ?? 1.5);
      if (hz.dps) {
        h.hp -= sim.stats.maxHp * hz.dps * dt;
        if (h.hp <= 0) {
          h.hp = 0;
          h.mode = 'dying';
          h.t = 0;
          if (sim.boss?.state === 'fight') resetBoss(sim);
        }
      }
    }
  }
  stepShots(sim, dt);
  stepStrikes(sim, dt);
  stepZones(sim, dt);

  // Мобы.
  for (const m of sim.mobs) stepMob(sim, m, dt);
  moveMobs(sim, dt);
  sim.mobs = sim.mobs.filter((m) => {
    if (m.mode === 'dying') return m.t < 0.7;
    if (m.mode === 'escape') return m.t < 0.4;
    if (!defOf(m.kind).boss && m.mode !== 'sleep')
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
            const ns = spawnOf(bandAt(sim.world, p.y).def.id);
            const kind: MobId = ns.nest
              ? ns.nest(p.kind === 'cartnest', sim.rng)
              : pickKind(sim, bandAt(sim.world, p.y).def.id);
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
      if (collideTiles(sim, m) && m.bounce && !bounced) {
        // Катящийся и таранящий бьются о стену: что дальше — решает ИИ вида.
        bounced = true;
        BRAINS.get(defOf(m.kind).brain)?.onWall?.(sim, m, m.x - px, m.y - py, API);
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
      const wa = massOf(b.kind) / (massOf(a.kind) + massOf(b.kind));
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
    if (ghost(m)) continue;
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
    const room = !takesRoom || canTake(sim.sack, d.kind as ItemId, d.n, sim.sackLevel);
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
  if (d.kind === 'coin') s.coins += d.n;
  else if (d.kind === 'token') s.tokens += d.n;
  else if (d.kind === 'key') s.keys += d.n;
  else {
    sackAdd(s, d.kind, d.n);
    if (isMeat(d.kind)) s.meatBy[d.area] = (s.meatBy[d.area] ?? 0) + d.n;
  }
  sim.events.push({ t: 'pick', x: d.x, y: d.y, what: d.kind, n: d.n });
}

// ---------------------------------------------------------------------------
// Снаряды, удары по площади, лужи и облака.
// ---------------------------------------------------------------------------

/** Выстрел моба по направлению. Навесом — в точку прицела `tx, ty`. */
function shoot(sim: Sim, m: Mob, ang: number, spec?: ShotSpec, tx?: number, ty?: number): void {
  const sp = spec ?? defOf(m.kind).shot;
  if (!sp) return;
  const n = Math.max(1, sp.n ?? 1);
  for (let i = 0; i < n; i++) {
    const a = ang + (n > 1 ? (i / (n - 1) - 0.5) * (sp.spread ?? 0.5) : 0);
    const x0 = m.x + Math.cos(a) * (m.r + 0.1);
    const y0 = m.y + Math.sin(a) * (m.r + 0.1);
    let lob: Shot['lob'];
    let vx = Math.cos(a) * sp.speed;
    let vy = Math.sin(a) * sp.speed;
    if (sp.lob) {
      const x1 = tx ?? m.x + Math.cos(a) * 5;
      const y1 = ty ?? m.y + Math.sin(a) * 5;
      const T = Math.max(0.35, Math.hypot(x1 - x0, y1 - y0) / sp.speed);
      lob = { x0, y0, x1, y1, T };
      vx = (x1 - x0) / T;
      vy = (y1 - y0) / T;
    }
    sim.shots.push({
      id: sim.nextId++,
      x: x0,
      y: y0,
      vx,
      vy,
      r: sp.r,
      life: lob ? lob.T : sp.life,
      age: 0,
      dmg: m.dmg * sp.dmg,
      art: sp.art,
      status: sp.status,
      dur: sp.dur,
      lob,
      z: 0,
      kind: m.kind,
    });
  }
  sim.events.push({ t: 'shot', x: m.x, y: m.y, art: sp.art });
}

function stepShots(sim: Sim, dt: number): void {
  if (!sim.shots.length) return;
  const h = sim.hero;
  const keep: Shot[] = [];
  for (const s of sim.shots) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.lob) {
      const k = Math.min(1, s.age / s.lob.T);
      s.z = Math.sin(k * Math.PI) * Math.min(3, s.lob.T * 2.2);
      if (k >= 1) {
        // Долетел навесом — бьёт по месту падения.
        if (Math.hypot(h.x - s.x, h.y - s.y) < s.r + h.r)
          hurtHero(
            sim,
            s.dmg,
            s.x,
            s.y,
            3,
            s.kind,
            s.status ? { kind: s.status, dur: s.dur ?? 2 } : undefined,
          );
        sim.events.push({ t: 'strike', x: s.x, y: s.y, art: s.art });
        continue;
      }
      keep.push(s);
      continue;
    }
    if (s.age > s.life || opaque(sim, Math.floor(s.x), Math.floor(s.y))) {
      sim.events.push({ t: 'strike', x: s.x, y: s.y, art: s.art });
      continue;
    }
    if (h.mode !== 'dying' && h.mode !== 'dead' && Math.hypot(h.x - s.x, h.y - s.y) < s.r + h.r) {
      if (h.mode !== 'dash')
        hurtHero(
          sim,
          s.dmg,
          s.x,
          s.y,
          3,
          s.kind,
          s.status ? { kind: s.status, dur: s.dur ?? 2 } : undefined,
        );
      if (h.mode !== 'dash') {
        sim.events.push({ t: 'strike', x: s.x, y: s.y, art: s.art });
        continue;
      }
    }
    keep.push(s);
  }
  sim.shots = keep;
}

/** Задевает ли удар по площади круг (x, y, r). */
function strikeHits(st: StrikeIn, x: number, y: number, r: number): boolean {
  const dx = x - st.x;
  const dy = y - st.y;
  const d = Math.hypot(dx, dy);
  switch (st.shape) {
    case 'circle':
      return d < st.r + r;
    case 'ring':
      return Math.abs(d - st.r) < (st.w ?? 0.6) + r;
    case 'cone': {
      if (d > st.r + r) return false;
      const off = Math.abs(angDiff(Math.atan2(dy, dx), st.ang ?? 0));
      return off < (st.arc ?? 1) / 2 + (d > 0.01 ? Math.atan(r / d) : Math.PI);
    }
    case 'line': {
      const a = st.ang ?? 0;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const along = dx * ux + dy * uy;
      const across = Math.abs(-dx * uy + dy * ux);
      return along > -r && along < st.r + r && across < (st.w ?? 0.5) + r;
    }
  }
  return false;
}

function stepStrikes(sim: Sim, dt: number): void {
  if (!sim.strikes.length) return;
  const h = sim.hero;
  const keep: Strike[] = [];
  for (const st of sim.strikes) {
    st.t += dt;
    // Чей удар умер — метка гаснет.
    if (st.from !== undefined && !sim.mobs.some((m) => m.id === st.from && m.mode !== 'dying'))
      continue;
    if (st.t < st.warn) {
      keep.push(st);
      continue;
    }
    if (h.mode !== 'dying' && h.mode !== 'dead' && strikeHits(st, h.x, h.y, h.r))
      hurtHero(
        sim,
        st.dmg,
        st.x,
        st.y,
        st.knock ?? 5,
        undefined,
        st.status ? { kind: st.status, dur: st.dur ?? 2 } : undefined,
      );
    sim.hitstop = Math.max(sim.hitstop, 0.05);
    sim.events.push({ t: 'strike', x: st.x, y: st.y, art: st.art ?? 'slam', big: true });
  }
  sim.strikes = keep;
}

function stepZones(sim: Sim, dt: number): void {
  if (!sim.zones.length) return;
  const h = sim.hero;
  const alive = h.mode !== 'dying' && h.mode !== 'dead';
  const keep: Zone[] = [];
  for (const z of sim.zones) {
    z.t += dt;
    if (z.t > (z.warn ?? 0) + z.life) continue;
    keep.push(z);
    if (!alive || z.t < (z.warn ?? 0)) continue;
    if (Math.hypot(h.x - z.x, h.y - z.y) >= z.r + h.r * 0.5) continue;
    if (z.status) heroStatus(sim, z.status, z.dur ?? 1.2);
    if (z.dps) {
      h.hp -= sim.stats.maxHp * z.dps * dt;
      if (h.hp <= 0) {
        h.hp = 0;
        h.mode = 'dying';
        h.t = 0;
        if (sim.boss?.state === 'fight') resetBoss(sim);
      }
    }
  }
  sim.zones = keep;
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

export type UseKind =
  | 'lift'
  | 'mine'
  | 'light'
  | 'grate'
  | 'secret'
  | 'board'
  | 'seal'
  | 'plaque'
  | 'stairs';

export interface Usable {
  kind: UseKind;
  obj: WorldObj;
  label: string;
}

/** Что можно сделать рядом с героем — для контекстной кнопки. */
/**
 * Табличка у логова рассказывает про короля; остальные — указатели дороги
 * (их читает табло само, без нажатия).
 */
export function nearLair(sim: Sim, o: WorldObj): boolean {
  const b = sim.boss;
  return !!b && Math.hypot(b.obj.x - o.x, b.obj.y - o.y) < 14;
}

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
    if (o.kind === 'lift') consider({ kind: 'lift', obj: o, label: 'Лифт' }, d);
    else if (o.kind === 'stairs' && sim.beaten)
      consider({ kind: 'stairs', obj: o, label: 'Вниз' }, d);
    else if (o.kind === 'mine') consider({ kind: 'mine', obj: o, label: 'В шахту' }, d);
    else if (o.kind === 'board') consider({ kind: 'board', obj: o, label: 'Управление' }, d);
    else if (o.kind === 'plaque' && nearLair(sim, o))
      consider({ kind: 'plaque', obj: o, label: 'Логово' }, d + 0.3);
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
    for (let i = 0; i < 5; i++) dropAt(sim, 'coin', SECRET_COINS, p.x, p.y + 0.4);
    for (let i = 0; i < 6; i++) dropAt(sim, 'token', 2 + Math.floor(sim.rng() * 3), p.x, p.y + 0.4);
    dropAt(sim, 'key', 1, p.x, p.y + 0.4);
    for (let i = 0; i < 4; i++) dropAt(sim, commonMat(sim), 1, p.x, p.y + 0.4);
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
  packs = Math.min(packs, DEEP_NOISE_MAX);
  if (packs <= 0) return;
  const holes = sim.burrows
    .filter((b) => b.obj.out && Math.hypot(b.obj.x - mine.x, b.obj.y - mine.y) < 12)
    .sort(
      (a, b) =>
        Math.hypot(a.obj.x - mine.x, a.obj.y - mine.y) -
        Math.hypot(b.obj.x - mine.x, b.obj.y - mine.y),
    );
  for (let p = 0; p < packs; p++) {
    // Первая стая — пара, дальше по три: шум растёт, но не хоронит.
    const n = p === 0 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      if (holes.length) {
        const b = holes[(p + i) % holes.length];
        b.cd = 0;
        const m = fromBurrow(sim, b, pickKind(sim, bandAt(sim.world, mine.y).def.id));
        m.t = -(p * 0.4 + i * 0.25);
      } else {
        const a = sim.rng() * Math.PI * 2;
        const filler = spawnOf(bandAt(sim.world, mine.y).def.id).filler;
        spawnMob(sim, filler, mine.x + 0.5 + Math.cos(a) * 3, mine.y + 2 + Math.sin(a) * 2, {
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

/**
 * Выбросить из сидора: вещь ложится на пол у ног и первые две секунды не
 * тянется обратно — иначе магнит подобрал бы её в тот же миг. Место в
 * сидоре освобождается сразу: так выкидывают шкурки ради пирита.
 */
export function dropFromSack(sim: Sim, id: ItemId, n: number): number {
  const s = sim.sack;
  const meat = isMeat(id);
  const have = (meat ? s.meat[id as MeatId] : s.mats[id as MatId]) ?? 0;
  const k = Math.min(have, Math.max(0, Math.floor(n)));
  if (k <= 0) return 0;
  if (meat) {
    s.meat[id as MeatId] = have - k;
    if (!s.meat[id as MeatId]) delete s.meat[id as MeatId];
    // Район мяса — пропорционально: выброшенное уносит свою долю цены.
    const total = Object.values(s.meatBy).reduce<number>((a, b) => a + (b ?? 0), 0);
    if (total > 0) {
      let left = k;
      for (const [a, v] of Object.entries(s.meatBy) as [AreaId, number][]) {
        const cut = Math.min(v, Math.round((k * v) / total), left);
        s.meatBy[a] = v - cut;
        left -= cut;
        if (!s.meatBy[a]) delete s.meatBy[a];
      }
    }
  } else {
    s.mats[id as MatId] = have - k;
    if (!s.mats[id as MatId]) delete s.mats[id as MatId];
  }
  const h = sim.hero;
  const piles = Math.min(k, 6);
  for (let i = 0; i < piles; i++) {
    const n1 = Math.floor(k / piles) + (i < k % piles ? 1 : 0);
    const a = h.face + Math.PI + (i - piles / 2) * 0.35;
    sim.drops.push({
      id: sim.nextId++,
      kind: id,
      n: n1,
      x: h.x + Math.cos(a) * 0.5,
      y: h.y + Math.sin(a) * 0.5,
      z: 0.3,
      vx: Math.cos(a) * 1.4,
      vy: Math.sin(a) * 1.4,
      vz: 2.4,
      age: -1.6,
      area: sim.area,
    });
  }
  return k;
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

/** Функции движка для ИИ и сценариев (`dungeon-ai.ts`). */
export const API: SimApi = {
  setMode,
  steer,
  chaseDir,
  flowDir,
  lineOfSight,
  solidTile,
  hurtHero,
  heroStatus,
  spawnMob,
  fromBurrow,
  dropAt,
  explode,
  shoot,
  strike(sim: Sim, st: StrikeIn) {
    sim.strikes.push({ ...st, id: sim.nextId++, t: 0 });
  },
  zone(sim: Sim, z: ZoneIn) {
    sim.zones.push({ ...z, id: sim.nextId++, t: 0 });
  },
  inArena,
  collide: collideTiles,
  pickKind,
  pickBurrow,
  def: defOf,
  setTile(sim: Sim, x: number, y: number, tile: number, mark?: number) {
    const w = sim.world;
    if (x < 0 || y < 0 || x >= w.w || y >= w.h) return;
    const i = y * w.w + x;
    const was = mark !== undefined && w.mark[i] !== mark;
    if (sim.tiles[i] === tile && !was) return;
    sim.tiles[i] = tile;
    if (mark !== undefined) w.mark[i] = mark;
    sim.retiled.push(i);
  },
  moveHero(sim: Sim, x: number, y: number) {
    const h = sim.hero;
    h.x = x;
    h.y = y;
    h.vx = 0;
    h.vy = 0;
    if (h.mode === 'dash') {
      h.mode = 'free';
      h.t = 0;
    }
    collideTiles(sim, h);
    sim.warps += 1;
    sim.flowT = 0;
  },
};

export { tileAt, heroStatus, strikeHits };
