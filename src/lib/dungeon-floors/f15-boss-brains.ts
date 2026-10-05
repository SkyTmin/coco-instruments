// Этаж 15 «Сердце подземелья» — сценарий финального босса всей игры
// «Хозяин подземелья», ИИ его отголосков, истинного сердца и сгустков.
//
// Пять фаз (засечки полосы — `bar`/`notches`):
//   0 ОТГОЛОСКИ — кокон неуязвим (`ghost`). По очереди встают эхо пяти
//     прошлых боссов — у каждого свой простой ИИ с КОРОННЫМ приёмом:
//     Крысиный король катится клубком с отскоками; Минотавр целится и
//     таранит, в стену — оглушён; Красный змей встаёт и дышит полосами
//     пламени с просветами; гидра — тело неуязвимо, три головы плюются
//     огнём (лужа там, где лёг навес), льдом веером и ядовитым облаком;
//     Король демонов — гроза клетками, взмах конусом, рубка с застрявшим
//     мечом. Павшее эхо — трещина в коконе и толчок от него.
//   1 ПРОБУЖДЕНИЕ — камера уходит к кокону, он лопается кольцами ударной
//     волны; лев: когти конусом, прыжок льва (метка приземления, осколки
//     кольцом, потом окно), каменные шипы бегут по полу к герою.
//   2 ПОДЗЕМЕЛЬЕ ПОМНИТ — четверти арены по очереди (с меткой) становятся
//     прошлыми этажами: СЗ — лава с коркой (жжёт, извержения), СВ — вода
//     бездны с мелководьем (вязнет, водоворот тянет к краю, гейзер), ЮЗ —
//     зеркала (столбы-стены, лучи от зеркала к герою), ЮВ — круги гидры
//     (парные телепорты со вспышкой, топь, головы из кругов). Лев рыком
//     будит четверть, в которой стоит герой.
//   3 КРЫЛЬЯ — взлёт (недосягаем), перья веером сверху, пике по линии
//     через весь зал (линия видна заранее, за ним — перья-мины), тяжёлая
//     посадка (окно), порыв крыльями — сносит в опасную четверть.
//   4 СЕРДЦЕ — лев вырывает сердце и каменеет. Память гаснет (четверти
//     выгорают), сердце висит в центре: каждый удар — стены вспухают,
//     сильный удар — три кольца волной, артерии хлещут линиями, со свода
//     капают сгустки; раз в четыре удара стены СЖИМАЮТСЯ на кольцо
//     (метка за 1,7 с; тропа сердце — ворота не сжимается, карманов не
//     бывает). Раскрылось (после удара, золотой ореол) — бей: ×1,45,
//     сжато — ×0,35. Последний удар — замедление и `{t:'boss', what:'finale'}`.
//
// Честность: у каждого удара метка на полу или линия прицела и окно после
// (оглушение, застрявший меч, посадка, окно сердца). Движок сюда не
// импортируется значениями — только `api`.

import { registerBoss, registerBrain } from '../dungeon-ai';
import type { BrainCtx, SimApi, StrikeIn, ZoneIn } from '../dungeon-ai';
import type { ShotSpec } from '../dungeon';
import type { BossFight, Mob, Sim, Zone } from '../dungeon-sim';
import type { HazardSpec } from './types';
import { F15B_HAZ, F15B_MARK } from './f15-boss';

const TAU = Math.PI * 2;
const hypot = Math.hypot;
const MK = F15B_MARK;

// Клетки мира (копия `Tile`: значениями движок не импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;
const T_HAZARD = 12;

const HAZ_CRUST = F15B_HAZ.crust as HazardSpec;
const HAZ_SHALLOW = F15B_HAZ.shallow as HazardSpec;
const HAZ_BOG = F15B_HAZ.bog as HazardSpec;

// ---------------------------------------------------------------------------
// Числа боя — видны тестам и рисовальщику.
// ---------------------------------------------------------------------------

export const ECHO = {
  rise: 1.5,
  /** Пауза после трещины до следующего эха, с. */
  gap: 2.3,
  order: [
    'f15b_echo_king',
    'f15b_echo_mino',
    'f15b_echo_serpent',
    'f15b_echo_hydra',
    'f15b_echo_demon',
  ],
  names: ['КРЫСИНЫЙ КОРОЛЬ', 'МИНОТАВР', 'КРАСНЫЙ ЗМЕЙ', 'ГИДРА', 'КОРОЛЬ ДЕМОНОВ'],
  hints: [
    'катится клубком — уходи с линии вбок',
    'целится рогами — в стену он себя оглушит',
    'встаёт и дышит полосами — стой в просвете',
    'тело не достать — руби головы',
    'гроза клетками и меч — после рубки он застрял',
  ],
  /** Где встаёт эхо — от сердца (K), клеток. */
  spots: [
    [-5, 4],
    [5, 4],
    [0, 6],
    [0, -6],
    [0, 5],
  ] as [number, number][],
};

export const KING_E = { rollAim: 0.85, rollSpeed: 10.5, rollMax: 2.4, bounces: 2, dizzy: 1.6, rollCd: 4.2 };
export const MINO_E = { axeWarn: 0.85, axeR: 1.5, axeAhead: 1.25, aim: 0.95, speed: 12.5, goreMax: 1.4, dizzy: 1.9, cd: 4.2 };
export const SERP_E = { biteR: 2.5, biteArc: 1.3, biteWarn: 0.62, rear: 1.05, sweep: 1.0, gap: 2.3, laneW: 0.5, cd: 5.6 };
export const HYDRA_E = { cast: 0.75, every: 4.2, biteR: 1.15, biteWarn: 0.62, heads: [[-1.9, -0.2], [0, -1.35], [1.9, -0.2]] as [number, number][] };
export const DEMON_E = {
  slashR: 3.1,
  slashArc: 2.3,
  slashWarn: 0.85,
  cleaveR: 6.2,
  cleaveW: 0.72,
  cleaveWarn: 0.95,
  stuck: 1.35,
  storm: 1.3,
  stormWarn: 1.2,
  stormCd: 7,
};

export const LION = {
  /** Засечки: «ПОДЗЕМЕЛЬЕ ПОМНИТ», «КРЫЛЬЯ», «СЕРДЦЕ». */
  hp: [0.72, 0.45, 0.2],
  wake: 3.6,
  memory: 2.6,
  unfurl: 2.1,
  rip: 3.1,
  clawR: 3.1,
  clawArc: 1.8,
  clawWarn: 0.9,
  crouch: 0.72,
  leap: 0.55,
  pounceR: 1.9,
  shardR: 3.2,
  landed: 1.15,
  stomp: 1.25,
  spikes: 8,
  spikeGap: 1.05,
  call: 1.1,
  callCd: 10,
  takeoff: 0.7,
  fly: 2.5,
  swoopAim: 1.0,
  swoop: 0.4,
  airLanded: 1.5,
  gustR: 5.6,
  gustArc: 1.5,
  gustWarn: 0.85,
  fan: 1.35,
};

export const HEART = {
  rise: 1.4,
  /** Период удара: при полном здоровье сердца и при последнем. */
  period: [1.1, 0.72] as [number, number],
  strongEvery: 3,
  rings: [2.6, 5.2, 7.8],
  whipEvery: 4.6,
  clotEvery: 5.2,
  clotMax: 3,
  /** Сжатие стен: раз в столько ударов, метка за столько секунд, колец всего. */
  squeezeEvery: 4,
  squeezeWarn: 1.7,
  squeezeMax: 4,
  open: 1.45,
  shut: 0.35,
  /** Сжато первые столько долей удара. */
  shutK: 0.3,
};

export const MEMORY = { warn: 1.35, first: 1.2, stagger: 0.95 };

/** Четверти памяти: СЗ, СВ, ЮЗ, ЮВ. */
export const QUADS = ['lava', 'abyss', 'mirror', 'hydra'] as const;
export type QuadKind = (typeof QUADS)[number];

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';
const canHurt = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};

const walkT = (t: number) => t === T_FLOOR || t === T_HAZARD || (t >= 3 && t <= 5) || t === 10;

/** Сколько клеток до стены (глубина — не преграда: над ней летят). */
function wallDist(sim: Sim, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2) {
    const t = tileAt(sim, Math.floor(x + ux * d), Math.floor(y + uy * d));
    if (t !== T_DEEP && !walkT(t)) return d;
  }
  return max;
}

/** Сколько клеток до преграды (стена или глубина). */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max;
}

/** Сглаженный шум 0…1 по клеткам — пятна лавы и воды. */
function vnoise(x: number, y: number, seed: number): number {
  const r = (a: number, b: number) => {
    let h = (a * 374761393 + b * 668265263 + seed * 1274126177) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) & 0xffff) / 65535;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

/** Зона с привязкой к мобу (туман под эхом, тело змея). */
type TagZone = Zone & { mob?: number; q?: number; cells?: number[]; path?: number[] };

function tagZone(sim: Sim, api: SimApi, z: ZoneIn & Record<string, unknown>): TagZone {
  api.zone(sim, z);
  const out = sim.zones[sim.zones.length - 1] as TagZone;
  for (const [k, v] of Object.entries(z)) (out as unknown as Record<string, unknown>)[k] = v;
  return out;
}

function recoverStep(m: Mob, api: SimApi, T: number, next = 'chase'): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.t > T) api.setMode(m, next);
}

// ---------------------------------------------------------------------------
// Состояние боя одной вылазки.
// ---------------------------------------------------------------------------

interface Quad {
  kind: QuadKind;
  q: number;
  /** Что станет с клетками: клетка → [плитка, метка, опасность]. */
  to: Map<number, [number, number, HazardSpec | null]>;
  /** Все клетки четверти (для метки и рисовальщика). */
  area: number[];
  mirrors: number[];
  circles: [number, number][];
  pools: number[];
  on: boolean;
  at: number;
  next: number;
}

export interface F15BState {
  api: SimApi;
  /** Клетки, сменённые боем: вернуть на сбросе и после победы. */
  changed: Map<number, { tile: number; mark: number; haz: number }>;
  lights: Set<string>;
  /** Сколько эх пало (= трещин в коконе). */
  echo: number;
  echoAt: number;
  wakeAt: number;
  said: boolean;
  /** Сердцебиение: когда был удар, период, счёт. */
  beatAt: number;
  beatNext: number;
  period: number;
  beats: number;
  quads: Quad[];
  tp: { to: number; at: number } | null;
  tpCd: number;
  swirl: { x: number; y: number; at: number; px: number; py: number } | null;
  /** Фаза 4. */
  heart: number;
  husk: number;
  rings: number[][];
  squeeze: number;
  pending: number[];
  pendingAt: number;
  whipAt: number;
  whipA: number;
  clotAt: number;
  clots: Set<number>;
  /** Вены на полу арены: клетка и расстояние от сердца — рисунку пульса. */
  veins: number[];
  finale: boolean;
  told: Set<string>;
  /** Змей-эхо: путь головы для тела. */
  trail: number[];
}

const STATES = new WeakMap<Sim, F15BState>();

function stateOf(sim: Sim, api: SimApi): F15BState {
  let st = STATES.get(sim);
  if (!st) {
    st = {
      api,
      changed: new Map(),
      lights: new Set(),
      echo: 0,
      echoAt: 0,
      wakeAt: 0,
      said: false,
      beatAt: 0,
      beatNext: 0,
      period: 1.5,
      beats: 0,
      quads: [],
      tp: null,
      tpCd: 0,
      swirl: null,
      heart: 0,
      husk: 0,
      rings: [],
      squeeze: 0,
      pending: [],
      pendingAt: 0,
      whipAt: 0,
      whipA: 0,
      clotAt: 0,
      clots: new Set(),
      veins: [],
      finale: false,
      told: new Set(),
      trail: [],
    };
    STATES.set(sim, st);
  }
  st.api = api;
  return st;
}

/** Состояние боя для рисовальщика (через `paintSim()`); вне боя — null. */
export const f15bView = (sim: Sim | null): Readonly<F15BState> | null =>
  (sim && STATES.get(sim)) ?? null;

/** Сменить клетку, запомнив, какой она была. */
function retile(
  sim: Sim,
  st: F15BState,
  i: number,
  tile: number,
  mark: number,
  haz: HazardSpec | null = null,
): void {
  const w = sim.world;
  if (!st.changed.has(i)) st.changed.set(i, { tile: sim.tiles[i], mark: w.mark[i], haz: w.haz[i] });
  st.api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark, haz);
}

/** Вернуть все сменённые клетки и погасить свет боя. */
function restoreArena(sim: Sim, st: F15BState, api: SimApi): void {
  const W = sim.world.w;
  for (const [i, v] of st.changed) {
    // Исходные клетки арены опасности не имеют: снять.
    api.setTile(sim, i % W, Math.floor(i / W), v.tile, v.mark, v.haz ? undefined : null);
  }
  st.changed.clear();
  for (const k of st.lights) api.light(sim, k, null);
  st.lights.clear();
}

function light(sim: Sim, st: F15BState, key: string, x: number, y: number, r: number, tint: 'warm' | 'cold' | 'teal' | 'red' | 'violet' | 'green'): void {
  st.api.light(sim, key, { x, y, r, tint });
  st.lights.add(key);
}

function say(sim: Sim, st: F15BState, key: string, what: string, text?: string, sub?: string): void {
  if (key && st.told.has(key)) {
    sim.events.push({ t: 'boss', what });
    return;
  }
  if (key) st.told.add(key);
  sim.events.push({ t: 'boss', what, text, sub });
}

const lionOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f15boss' && x.mode !== 'dying');
const heartOf = (sim: Sim) =>
  sim.mobs.find((x) => x.kind === 'f15boss_heart' && x.mode !== 'dying');
const centerOf = (b: BossFight): [number, number] => [b.obj.x + 0.5, b.obj.y + 0.5];

// v2.87 — только рисунок: зона-картинка (`api.vfx`: без урона и статусов, номер
// мимо `nextId`) — шаги, взмахи, посадки, рёв рисует `f15-boss-fx.ts`. Своих
// `f15b_fx*` разом не больше 30, пыли шагов и взмахов — не больше 20.
type VfxIn = { ang?: number; n?: number; q?: number; mob?: number; cells?: number[]; above?: boolean };
function vfx(sim: Sim, api: SimApi, art: string, x: number, y: number, life: number, o: VfxIn = {}, move = false): void {
  let n = 0;
  for (const z of sim.zones) if (z.art?.startsWith('f15b_fx')) n++;
  if (n < (move ? 20 : 30)) api.vfx(sim, { x, y, r: 0.5, life, art, ...o } as ZoneIn & VfxIn);
}

// ---------------------------------------------------------------------------
// Отголоски: общее.
// ---------------------------------------------------------------------------

/** Эхо встаёт из пола: неуязвимо, туман под ним. true — шаг занят подъёмом. */
function echoRise(sim: Sim, m: Mob, api: SimApi): boolean {
  const mist = sim.zones.find((z) => (z as TagZone).mob === m.id && z.art === 'f15b_mist');
  if (mist) {
    mist.x = m.x;
    mist.y = m.y + 0.15;
  } else if (m.mode !== 'dying')
    tagZone(sim, api, { x: m.x, y: m.y, r: Math.max(0.9, m.r * 1.3), life: 1e9, art: 'f15b_mist', mob: m.id });
  if (m.mode !== 'f15e_rise') return false;
  m.data.ghost = 1;
  m.vx = 0;
  m.vy = 0;
  m.tele = null;
  if (m.t >= ECHO.rise) {
    m.data.ghost = 0;
    api.setMode(m, 'chase');
    m.cd = 0.6;
  }
  return true;
}

function echoGone(sim: Sim, m: Mob): void {
  for (const z of sim.zones) if ((z as TagZone).mob === m.id) z.life = 0;
}

/** Удар вплотную конусом (режим `windup` — движок рисует конус и засчитывает уклон). */
function meleeWindup(sim: Sim, m: Mob, c: BrainCtx, api: SimApi, mult: number, knock: number): void {
  m.vx *= 0.7;
  m.vy *= 0.7;
  if (m.t >= c.def.windup) {
    const h = sim.hero;
    const a = Math.atan2(h.y - m.y, h.x - m.x);
    if (c.dist < c.def.reach + m.r + h.r + 0.2 && Math.abs(angDiff(a, m.face)) < 0.75 && canHurt(sim))
      api.hurtHero(sim, m.dmg * mult, m.x, m.y, knock, m.kind);
    api.setMode(m, 'recover');
  }
}

// --- Эхо Крысиного короля: клубок с отскоками.
registerBrain('f15b_echo_king', {
  raw: true,
  step(sim, m, dt, c, api) {
    if (echoRise(sim, m, api)) return;
    const h = sim.hero;
    m.data.rollCd = (m.data.rollCd ?? 2.4) - dt;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        m.bounce = false;
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed * (c.dist < 1.6 ? 0.3 : 1), dt);
        if (c.dist < 2.1 && m.t > 0.4) {
          m.face = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'windup');
        } else if (
          m.data.rollCd <= 0 &&
          c.dist > 2.6 &&
          c.dist < 11 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'rollAim');
        }
        return;
      }
      case 'windup':
        meleeWindup(sim, m, c, api, 1.1, 6);
        return;
      case 'recover':
        recoverStep(m, api, 0.55);
        return;
      case 'rollAim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < KING_E.rollAim * 0.6) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        const len = clearDist(sim, api, m.x, m.y, m.dir, 12);
        m.tele = { shape: 'line', r: len, w: m.r, ang: m.dir, k: Math.min(1, m.t / KING_E.rollAim) };
        m.danger = KING_E.rollAim - m.t < 0.25 ? 2.2 : 0;
        if (m.t >= KING_E.rollAim) {
          m.tele = null;
          m.bounces = 0;
          m.bounce = true;
          m.data.hitDone = 0;
          api.setMode(m, 'roll');
          sim.events.push({ t: 'boss', what: 'roll' });
        }
        return;
      }
      case 'roll': {
        m.vx = Math.cos(m.dir) * KING_E.rollSpeed;
        m.vy = Math.sin(m.dir) * KING_E.rollSpeed;
        m.danger = 1.4;
        if (!m.data.hitDone && c.dist < m.r + h.r + 0.15 && canHurt(sim)) {
          m.data.hitDone = 1;
          api.hurtHero(sim, m.dmg * 1.6, m.x, m.y, 9, m.kind);
        }
        if (m.t >= KING_E.rollMax) {
          m.bounce = false;
          api.setMode(m, 'dizzy');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.danger = 0;
        m.bounce = false;
        if (m.t >= KING_E.dizzy) {
          m.data.rollCd = KING_E.rollCd;
          api.setMode(m, 'chase');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, nx, ny) {
    if (m.mode !== 'roll') return;
    m.bounces += 1;
    if (Math.abs(nx) > Math.abs(ny)) m.dir = Math.PI - m.dir;
    else m.dir = -m.dir;
    m.data.hitDone = 0;
    sim.events.push({ t: 'boss', what: 'f15b_bump_wall' });
    if (m.bounces > KING_E.bounces) {
      m.bounce = false;
      m.vx = 0;
      m.vy = 0;
      m.mode = 'dizzy';
      m.t = 0;
    }
  },
  onHit: (_s, m) => (m.mode === 'dizzy' ? 1.45 : 1),
  onDeath: (sim, m) => echoGone(sim, m),
});

// --- Эхо Минотавра: прицел рогами и таран, о стену — оглушён.
registerBrain('f15b_echo_mino', {
  raw: true,
  step(sim, m, dt, c, api) {
    if (echoRise(sim, m, api)) return;
    const h = sim.hero;
    m.data.cd = (m.data.cd ?? 1.8) - dt;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        m.bounce = false;
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed * (c.dist < 2 ? 0.3 : 1), dt);
        if (c.dist < 2.5 && m.t > 0.45) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'axe');
        } else if (m.data.cd <= 0 && c.dist > 3 && c.dist < 13 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'aim');
        }
        return;
      }
      case 'axe': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.12) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'circle',
            x: m.x + Math.cos(m.dir) * MINO_E.axeAhead,
            y: m.y + Math.sin(m.dir) * MINO_E.axeAhead,
            r: MINO_E.axeR,
            warn: MINO_E.axeWarn - 0.12,
            dmg: m.dmg * 1.35,
            knock: 7,
            art: 'f15b_axe',
            from: m.id,
          });
        }
        if (m.t >= MINO_E.axeWarn) {
          m.data.lit = 0;
          m.data.chopped = 1;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        if (m.t > 0.35) m.data.chopped = 0;
        recoverStep(m, api, 0.6);
        return;
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < MINO_E.aim * 0.65) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        const len = clearDist(sim, api, m.x, m.y, m.dir, 13);
        m.tele = { shape: 'line', r: len, w: m.r, ang: m.dir, k: Math.min(1, m.t / MINO_E.aim) };
        m.danger = MINO_E.aim - m.t < 0.25 ? 2.4 : 0;
        if (m.t >= MINO_E.aim) {
          m.tele = null;
          m.bounce = true;
          m.data.hitDone = 0;
          api.setMode(m, 'gore');
        }
        return;
      }
      case 'gore': {
        m.vx = Math.cos(m.dir) * MINO_E.speed;
        m.vy = Math.sin(m.dir) * MINO_E.speed;
        m.danger = 1.5;
        if (!m.data.hitDone && c.dist < m.r + h.r + 0.2 && canHurt(sim)) {
          m.data.hitDone = 1;
          api.hurtHero(sim, m.dmg * 1.9, m.x, m.y, 11, m.kind);
        }
        if (m.t >= MINO_E.goreMax) {
          m.bounce = false;
          m.data.cd = MINO_E.cd;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.danger = 0;
        if (m.t >= MINO_E.dizzy) {
          m.data.cd = MINO_E.cd;
          api.setMode(m, 'chase');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m) {
    if (m.mode !== 'gore') return;
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    m.mode = 'dizzy';
    m.t = 0;
    sim.hitstop = Math.max(sim.hitstop, 0.06);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    sim.events.push({ t: 'boss', what: 'f15b_gore_wall' });
  },
  onHit: (_s, m) => (m.mode === 'dizzy' ? 1.5 : 1),
  onDeath: (sim, m) => echoGone(sim, m),
});

// --- Эхо Красного змея: полосы пламени с просветами, укус.

/** Путь головы змея для тела-призрака (x, y по очереди, голова — в начале). */
function serpentTrail(st: F15BState, m: Mob): void {
  const t = st.trail;
  if (!t.length || hypot(t[0] - m.x, t[1] - m.y) > 0.18) {
    t.unshift(m.x, m.y);
    if (t.length > 60) t.length = 60;
  }
}

function flameLanes(sim: Sim, m: Mob, api: SimApi, offs: number[], warn: number): void {
  const a = m.dir;
  const nx = -Math.sin(a);
  const ny = Math.cos(a);
  for (const o of offs) {
    const x = m.x + nx * o * SERP_E.gap;
    const y = m.y + ny * o * SERP_E.gap;
    const len = wallDist(sim, x, y, a, 14);
    api.strike(sim, {
      shape: 'line',
      x,
      y,
      r: len,
      w: SERP_E.laneW,
      ang: a,
      warn,
      dmg: m.dmg * 1.2,
      knock: 4,
      status: 'burn',
      dur: 1,
      art: 'f15b_flame',
      from: m.id,
    });
  }
}

registerBrain('f15b_echo_serpent', {
  raw: true,
  step(sim, m, dt, c, api) {
    const b = sim.boss;
    if (b) {
      const st = stateOf(sim, api);
      serpentTrail(st, m);
      if (!sim.zones.some((z) => z.art === 'f15b_echobody' && (z as TagZone).mob === m.id))
        tagZone(sim, api, { x: m.x, y: m.y, r: 0.1, life: 1e9, art: 'f15b_echobody', mob: m.id });
      for (const z of sim.zones)
        if (z.art === 'f15b_echobody' && (z as TagZone).mob === m.id) {
          z.x = m.x;
          z.y = m.y;
        }
    }
    if (echoRise(sim, m, api)) return;
    const h = sim.hero;
    m.data.cd = (m.data.cd ?? 2.2) - dt;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed * (c.dist < 2.2 ? 0.25 : 1), dt);
        if (c.dist < 2.7 && m.t > 0.5) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f6_bite');
        } else if (m.data.cd <= 0 && c.dist < 12) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f6_wave');
        }
        return;
      }
      case 'f6_bite': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.05) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: SERP_E.biteR,
            ang: m.dir,
            arc: SERP_E.biteArc,
            warn: SERP_E.biteWarn,
            dmg: m.dmg * 1.2,
            knock: 6,
            art: 'f15b_bite',
            from: m.id,
          });
        }
        if (m.t >= SERP_E.biteWarn + 0.2) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f6_wave':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.05) {
          m.data.lit = 1;
          flameLanes(sim, m, api, [-2, -1, 0, 1, 2], SERP_E.rear - 0.05);
          say(sim, stateOf(sim, api), 'lanes', 'f15b_flame_trap', 'ПОЛОСЫ ПЛАМЕНИ', 'стой в просвете между ними');
        }
        if (m.t >= SERP_E.rear + 0.3) {
          m.data.lit = 0;
          api.setMode(m, 'f6_sweep');
        }
        return;
      case 'f6_sweep':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.05) {
          m.data.lit = 1;
          flameLanes(sim, m, api, [-1.5, -0.5, 0.5, 1.5], SERP_E.sweep - 0.05);
        }
        if (m.t >= SERP_E.sweep + 0.4) {
          m.data.lit = 0;
          m.data.cd = SERP_E.cd;
          api.setMode(m, 'dizzy');
        }
        return;
      case 'dizzy':
        // Выдохся после двух волн: окно.
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t >= 1.1) api.setMode(m, 'chase');
        return;
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit: (_s, m) => (m.mode === 'dizzy' ? 1.4 : 1),
  onDeath: (sim, m) => echoGone(sim, m),
});

// --- Эхо гидры: тело неуязвимо, три головы стихий.

const FIRE_LOB: ShotSpec = {
  speed: 7.5,
  r: 0.6,
  life: 3,
  dmg: 1.1,
  art: 'f15b_fireball',
  lob: true,
  status: 'burn',
  dur: 1,
  onLand: { r: 1.05, life: 2, dps: 0.02, art: 'f15b_flames', above: true }, // v2.87 — только рисунок: above
};
const ICE_FAN: ShotSpec = { speed: 8.5, r: 0.35, life: 2.2, dmg: 0.7, art: 'f15b_ice', status: 'chill', dur: 1.6, n: 3, spread: 0.55 };

registerBrain('f15b_echo_hydra', {
  raw: true,
  step(sim, m, _dt, _c, api) {
    const rising = echoRise(sim, m, api);
    m.data.ghost = 1;
    m.data.risen = 1;
    m.vx = 0;
    m.vy = 0;
    m.x = m.hx;
    m.y = m.hy;
    if (rising || m.data.heads) return;
    m.data.heads = 1;
    // Три головы на шеях — огонь, лёд, яд.
    HYDRA_E.heads.forEach(([ox, oy], i) => {
      const hd = api.spawnMob(sim, 'f15b_echo_head', m.x + ox, m.y + oy, { mode: 'f15e_rise' });
      hd.data.el = i;
      hd.data.ox = ox;
      hd.data.oy = oy;
      hd.data.body = m.id;
      hd.data.castCd = 0.9 + i * 1.15;
      hd.t = -i * 0.25;
    });
    sim.events.push({ t: 'boss', what: 'summon' });
  },
  onDeath: (sim, m) => echoGone(sim, m),
});

registerBrain('f15b_echo_head', {
  raw: true,
  step(sim, m, dt, c, api) {
    const body = sim.mobs.find((x) => x.id === m.data.body);
    const bx = body ? body.hx : m.hx;
    const by = body ? body.hy : m.hy;
    const bob = Math.sin(sim.time * 2.6 + (m.data.el ?? 0) * 2.1) * 0.12;
    m.x = bx + (m.data.ox ?? 0);
    m.y = by + (m.data.oy ?? 0) + bob;
    m.vx = 0;
    m.vy = 0;
    if (m.t < 0) return;
    if (echoRise(sim, m, api)) return;
    const h = sim.hero;
    m.face = Math.atan2(c.dy, c.dx);
    m.data.castCd = (m.data.castCd ?? 1) - dt;
    m.data.biteCd = (m.data.biteCd ?? 0.5) - dt;
    if (heroDown(sim)) return;
    switch (m.mode) {
      case 'chase':
        m.tele = null;
        if (c.dist < 2.4 && m.data.biteCd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'bite');
        } else if (m.data.castCd <= 0 && c.dist < 13) api.setMode(m, 'cast');
        return;
      case 'bite':
        if (!m.data.lit) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'circle',
            x: m.x + Math.cos(m.dir) * 1,
            y: m.y + Math.sin(m.dir) * 1,
            r: HYDRA_E.biteR,
            warn: HYDRA_E.biteWarn,
            dmg: m.dmg * 1.3,
            knock: 5,
            art: 'f15b_bite',
            from: m.id,
          });
        }
        if (m.t >= HYDRA_E.biteWarn + 0.15) {
          m.data.lit = 0;
          m.data.biteCd = 2.2;
          api.setMode(m, 'recover');
        }
        return;
      case 'cast': {
        // Пасть светится стихией, потом — выстрел.
        if (m.t >= HYDRA_E.cast) {
          const a = Math.atan2(h.y - m.y, h.x - m.x);
          const el = m.data.el ?? 0;
          if (el === 0) api.shoot(sim, m, a, FIRE_LOB, h.x + h.vx * 0.4, h.y + h.vy * 0.4);
          else if (el === 1) api.shoot(sim, m, a, ICE_FAN);
          else
            api.zone(sim, {
              x: h.x,
              y: h.y,
              r: 1.35,
              life: 3,
              warn: 0.9,
              dps: 0.014,
              status: 'poison',
              dur: 2,
              art: 'f15b_miasma',
            });
          m.data.castCd = HYDRA_E.every;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        m.tele = null;
        if (m.t > 0.55) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath: (sim, m) => echoGone(sim, m),
});

// --- Эхо Короля демонов: гроза клетками, взмах, рубка с застрявшим мечом.

function demonStorm(sim: Sim, b: BossFight, m: Mob, api: SimApi): void {
  const W = sim.world.w;
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  for (const i of b.cells) {
    const x = i % W;
    const y = Math.floor(i / W);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const par = (m.data.storms ?? 0) % 2;
  m.data.storms = (m.data.storms ?? 0) + 1;
  for (let y = y0; y <= y1; y += 3)
    for (let x = x0; x <= x1; x += 3) {
      if ((Math.floor((x - x0) / 3) + Math.floor((y - y0) / 3) + par) % 2) continue;
      const cx = x + 1.5;
      const cy = y + 1.5;
      if (!b.cells.has(Math.floor(cy) * W + Math.floor(cx))) continue;
      api.strike(sim, {
        shape: 'circle',
        x: cx,
        y: cy,
        r: 1.45,
        warn: DEMON_E.stormWarn,
        dmg: m.dmg * 1.1,
        knock: 3,
        art: 'f15b_bolt',
        from: m.id,
        above: true,
      });
    }
}

registerBrain('f15b_echo_demon', {
  raw: true,
  step(sim, m, dt, c, api) {
    m.data.phase = 1;
    if (echoRise(sim, m, api)) return;
    const h = sim.hero;
    m.data.stormCd = (m.data.stormCd ?? 3) - dt;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed * (c.dist < 2.4 ? 0.35 : 1), dt);
        if (m.t < 0.6) return;
        if (m.data.stormCd <= 0) {
          api.setMode(m, 'f10_storm');
          return;
        }
        if (c.dist < DEMON_E.slashR - 0.3) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'slash');
        } else if (c.dist < DEMON_E.cleaveR - 0.4 && m.t > 1.2 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'cleave');
        }
        return;
      }
      case 'slash':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.25) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.25) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: DEMON_E.slashR,
            ang: m.dir,
            arc: DEMON_E.slashArc,
            warn: DEMON_E.slashWarn - 0.25,
            dmg: m.dmg * 1.4,
            knock: 8,
            art: 'f15b_slash',
            from: m.id,
          });
        }
        if (m.t >= DEMON_E.slashWarn) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
        }
        return;
      case 'cleave': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.3) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.3) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: clearDist(sim, api, m.x, m.y, m.dir, DEMON_E.cleaveR),
            w: DEMON_E.cleaveW,
            ang: m.dir,
            warn: DEMON_E.cleaveWarn - 0.3,
            dmg: m.dmg * 1.9,
            knock: 8,
            art: 'f15b_cleave',
            from: m.id,
          });
        }
        if (m.t >= DEMON_E.cleaveWarn) {
          m.data.lit = 0;
          sim.hitstop = Math.max(sim.hitstop, 0.05);
          api.setMode(m, 'stuck');
        }
        return;
      }
      case 'stuck':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t >= DEMON_E.stuck) api.setMode(m, 'recover');
        return;
      case 'f10_storm': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.PI / 2;
        const b = sim.boss;
        if (!m.data.lit && m.t >= 0.3 && b) {
          m.data.lit = 1;
          demonStorm(sim, b, m, api);
          say(sim, stateOf(sim, api), 'storm', 'f15b_storm_trap', 'ГРОЗА', 'молнии бьют клетками — встань между');
        }
        if (m.data.lit === 1 && m.t >= 0.3 + DEMON_E.stormWarn) {
          m.data.lit = 2;
          sim.events.push({ t: 'flash', color: '#c8b8ff', k: 0.55 });
          sim.events.push({ t: 'shake', k: 0.3 });
        }
        if (m.t >= DEMON_E.storm + 0.35) {
          m.data.lit = 0;
          m.data.stormCd = DEMON_E.stormCd;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit: (_s, m) => (m.mode === 'stuck' ? 1.45 : 1),
  onDeath: (sim, m) => echoGone(sim, m),
});

// ---------------------------------------------------------------------------
// Хозяин подземелья — химера: крылатый лев из плоти и камня.
// ---------------------------------------------------------------------------

/** Лев в воздухе или в прыжке: стены и лава не держат (тело не касается пола). */
function airborne(m: Mob, on: boolean): void {
  if (on) {
    if (m.data.r0 === undefined) m.data.r0 = m.r;
    m.r = 0;
  } else if (m.data.r0 !== undefined) {
    m.r = m.data.r0;
    delete m.data.r0;
  }
}

/** Ближняя к точке клетка арены, где можно встать (не стена и не глубина). */
function landSpot(sim: Sim, b: BossFight, x: number, y: number): [number, number] {
  const W = sim.world.w;
  const ok = (cx: number, cy: number) => {
    if (!b.cells.has(cy * W + cx)) return false;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (!walkT(tileAt(sim, cx + dx, cy + dy))) return false;
    return true;
  };
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (ok(x0, y0)) return [x0 + 0.5, y0 + 0.5];
  for (let r = 1; r < 9; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(x0 + dx, y0 + dy)) return [x0 + dx + 0.5, y0 + dy + 0.5];
      }
  return centerOf(b);
}

const hasteOf = (sim: Sim) => ((sim.boss?.phase ?? 0) >= 3 ? 1.15 : 1);

/** Мода, которую можно прервать сменой фазы. */
const calm = (m: Mob) =>
  m.mode === 'chase' || m.mode === 'f15_recover' || m.mode === 'f15_landed';

function lionStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const b = sim.boss;
  const phase = b?.phase ?? 0;
  const haste = hasteOf(sim);
  m.tele = null;
  m.danger = 0;
  m.data.phase = phase;
  for (const k of ['clawCd', 'pounceCd', 'stompCd', 'callCd', 'flyCd', 'gustCd', 'fanCd'])
    m.data[k] = (m.data[k] ?? 0) - dt;
  if (heroDown(sim) && m.mode !== 'f15_cocoon') {
    m.vx *= 0.85;
    m.vy *= 0.85;
    return;
  }
  const pin = () => {
    m.x = m.data.kx ?? m.x;
    m.y = m.data.ky ?? m.y;
    m.vx = 0;
    m.vy = 0;
  };
  switch (m.mode) {
    // --- Кокон.
    case 'f15_cocoon':
    case 'f15_crack':
      pin();
      m.data.ghost = 1;
      m.face = Math.PI / 2;
      if (m.mode === 'f15_crack' && m.t >= 0.9) api.setMode(m, 'f15_cocoon');
      return;
    case 'f15_wake': {
      pin();
      m.data.ghost = m.t < LION.wake - 0.35 ? 1 : 0;
      m.face = Math.PI / 2;
      if (!m.data.waved && m.t >= 1.35) {
        m.data.waved = 1;
        // Кокон лопается: ударная волна кольцами.
        for (const [r, w] of [
          [2.6, 0.45],
          [4.6, 0.55],
        ])
          api.strike(sim, { shape: 'ring', x: m.x, y: m.y, r, w, warn: 0.45 + r * 0.06, dmg: m.dmg * 0.7, knock: 12, art: 'f15b_shock', from: m.id });
        sim.events.push({ t: 'shake', k: 0.8 });
        sim.events.push({ t: 'flash', color: '#ff7050', k: 0.7 });
        vfx(sim, api, 'f15b_fxburst', m.x, m.y, 1.6, { above: true }); // v2.87 — только рисунок
      }
      // v2.87 — только рисунок: вышел из кокона — рёв.
      if (!m.data.vRoar && m.t >= 2.0) {
        m.data.vRoar = 1;
        vfx(sim, api, 'f15b_fxroar', m.x, m.y, LION.wake - 2.0);
      }
      if (m.t >= LION.wake) {
        m.data.ghost = 0;
        m.data.waved = 0;
        m.data.vRoar = 0; // v2.87 — только рисунок
        m.data.clawCd = 1;
        m.data.pounceCd = 2.5;
        m.data.stompCd = 4;
        m.y += 0.9;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f15_memory':
    case 'f15_unfurl':
    case 'f15_call': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      const T = m.mode === 'f15_memory' ? LION.memory : m.mode === 'f15_unfurl' ? LION.unfurl : LION.call;
      m.data.ghost = m.mode !== 'f15_call' && m.t < T - 0.3 ? 1 : 0;
      // v2.87 — только рисунок: память и зов — рёв.
      if (!m.data.vRoar && m.mode !== 'f15_unfurl') {
        m.data.vRoar = 1;
        vfx(sim, api, 'f15b_fxroar', m.x, m.y, T);
      }
      if (m.mode === 'f15_call' && !m.data.lit && m.t >= 0.55 && b) {
        m.data.lit = 1;
        flareQuad(sim, b, stateOf(sim, api), api, 2);
      }
      if (m.mode === 'f15_unfurl' && !m.data.lit && m.t >= 1.2) {
        m.data.lit = 1;
        sim.events.push({ t: 'shake', k: 0.6 });
        api.strike(sim, { shape: 'ring', x: m.x, y: m.y, r: 3, w: 0.6, warn: 0.4, dmg: m.dmg * 0.6, knock: 13, art: 'f15b_shock', from: m.id });
      }
      if (m.t >= T) {
        m.data.ghost = 0;
        m.data.lit = 0;
        m.data.vRoar = 0; // v2.87 — только рисунок
        if (m.mode === 'f15_call') m.data.callCd = LION.callCd;
        if (m.mode === 'f15_unfurl') m.data.flyCd = 1.5;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'chase': {
      m.data.ghost = 0;
      m.data.z = 0;
      airborne(m, false);
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, cx, cy, m.speed * haste * (c.dist < 2.6 ? 0.3 : 1), dt);
      // v2.87 — только рисунок: тяжёлые шаги — пыль из-под лап.
      m.data.vWalk = (m.data.vWalk ?? 0) + hypot(m.vx, m.vy) * dt;
      if (m.data.vWalk > 0.85) {
        m.data.vWalk = 0;
        m.data.vFoot = 1 - (m.data.vFoot ?? 0);
        vfx(sim, api, 'f15b_fxstep', m.x, m.y, 0.8, { ang: Math.atan2(m.vy, m.vx), n: m.data.vFoot }, true);
      }
      if (m.t < 0.45 / haste) return;
      const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
      if (c.dist < LION.clawR - 0.3 && m.data.clawCd <= 0) {
        m.dir = Math.atan2(c.dy, c.dx);
        api.setMode(m, 'f15_claw');
        return;
      }
      if (phase >= 3 && m.data.flyCd <= 0) {
        api.setMode(m, 'f15_takeoff');
        return;
      }
      if (phase >= 2 && m.data.callCd <= 0 && b && quadAt(sim, b, h.x, h.y)?.on) {
        api.setMode(m, 'f15_call');
        return;
      }
      if (m.data.pounceCd <= 0 && c.dist > 3.4 && c.dist < 10.5 && see) {
        api.setMode(m, 'f15_crouch');
        return;
      }
      if (m.data.stompCd <= 0 && c.dist > 3 && c.dist < 11 && see) {
        m.dir = Math.atan2(c.dy, c.dx);
        api.setMode(m, 'f15_stomp');
        return;
      }
      if (phase >= 3 && m.data.gustCd <= 0 && c.dist < 5.5) {
        m.dir = Math.atan2(c.dy, c.dx);
        api.setMode(m, 'f15_gust');
        return;
      }
      if (phase >= 3 && m.data.fanCd <= 0 && c.dist > 3.5 && c.dist < 12) {
        m.dir = Math.atan2(c.dy, c.dx);
        api.setMode(m, 'f15_fan');
      }
      return;
    }
    case 'f15_claw': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < 0.2) m.dir = Math.atan2(c.dy, c.dx);
      m.face = m.dir;
      const W = LION.clawWarn / haste;
      if (!m.data.lit && m.t >= 0.2) {
        m.data.lit = 1;
        api.strike(sim, {
          shape: 'cone',
          x: m.x,
          y: m.y,
          r: LION.clawR,
          ang: m.dir,
          arc: LION.clawArc,
          warn: W - 0.2,
          dmg: m.dmg * 1.05,
          knock: 9,
          art: 'f15b_claw',
          from: m.id,
        });
      }
      if (m.t >= W) {
        m.data.lit = 0;
        // Со второй фазы — бывает вторая лапа следом.
        if (phase >= 3 && !m.data.combo && sim.rng() < 0.35) {
          m.data.combo = 1;
          m.t = 0.05;
          m.dir = Math.atan2(c.dy, c.dx);
          return;
        }
        m.data.combo = 0;
        m.data.clawCd = 2.1 / haste;
        api.setMode(m, 'f15_recover');
      }
      return;
    }
    case 'f15_crouch': {
      // Прыжок льва: припал к земле, метка приземления уже горит.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (!m.data.lit && b) {
        m.data.lit = 1;
        const [tx, ty] = landSpot(sim, b, h.x + h.vx * 0.35, h.y + h.vy * 0.35);
        m.data.tx = tx;
        m.data.ty = ty;
        m.data.sx = m.x;
        m.data.sy = m.y;
        m.dir = Math.atan2(ty - m.y, tx - m.x);
        api.strike(sim, {
          shape: 'circle',
          x: tx,
          y: ty,
          r: LION.pounceR,
          warn: LION.crouch + LION.leap,
          dmg: m.dmg * 2,
          knock: 11,
          art: 'f15b_pounce',
          from: m.id,
        });
      }
      m.face = m.dir;
      if (m.t >= LION.crouch) {
        m.data.lit = 0;
        vfx(sim, api, 'f15b_fxleap', m.x, m.y, 0.9, { ang: m.dir }); // v2.87 — только рисунок
        airborne(m, true);
        api.setMode(m, 'f15_leap');
      }
      return;
    }
    case 'f15_leap': {
      const k = Math.min(1, m.t / LION.leap);
      m.x = m.data.sx + (m.data.tx - m.data.sx) * k;
      m.y = m.data.sy + (m.data.ty - m.data.sy) * k;
      m.vx = 0;
      m.vy = 0;
      m.data.z = Math.sin(k * Math.PI) * 2.2;
      m.data.ghost = 1;
      if (k >= 1) {
        m.data.z = 0;
        m.data.ghost = 0;
        airborne(m, false);
        api.strike(sim, { shape: 'ring', x: m.x, y: m.y, r: LION.shardR, w: 0.55, warn: 0.35, dmg: m.dmg * 0.8, knock: 7, art: 'f15b_shards', from: m.id });
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        sim.events.push({ t: 'boss', what: 'f15b_land_wall' });
        m.data.pounceCd = 5.5 / haste;
        api.setMode(m, 'f15_landed');
      }
      return;
    }
    case 'f15_landed':
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.data.ghost = 0;
      m.data.z = 0;
      airborne(m, false);
      if (m.t >= (m.data.air ? LION.airLanded : LION.landed)) {
        m.data.air = 0;
        api.setMode(m, 'chase');
      }
      return;
    case 'f15_stomp': {
      // Встал на дыбы — удар лапами: шипы бегут по полу к герою.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < 0.35) m.dir = Math.atan2(c.dy, c.dx);
      m.face = m.dir;
      if (!m.data.lit && m.t >= 0.5) {
        m.data.lit = 1;
        const len = clearDist(sim, api, m.x, m.y, m.dir, 13);
        for (let i = 0; i < LION.spikes; i++) {
          const d = 1.7 + i * LION.spikeGap;
          if (d > len) break;
          api.strike(sim, {
            shape: 'circle',
            x: m.x + Math.cos(m.dir) * d,
            y: m.y + Math.sin(m.dir) * d,
            r: 0.85,
            warn: 0.45 + i * 0.085,
            dmg: m.dmg * 1.25,
            knock: 6,
            art: 'f15b_spike',
            from: m.id,
          });
        }
        sim.events.push({ t: 'shake', k: 0.35 });
      }
      if (m.t >= LION.stomp) {
        m.data.lit = 0;
        m.data.stompCd = 6 / haste;
        api.setMode(m, 'f15_recover');
      }
      return;
    }
    case 'f15_recover':
      recoverStep(m, api, 0.7 / haste);
      return;
    // --- Крылья.
    case 'f15_takeoff':
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.data.z = Math.min(1, m.t / LION.takeoff) * 3;
      m.data.ghost = m.t > 0.25 ? 1 : 0;
      if (m.t > 0.25) airborne(m, true);
      // v2.87 — только рисунок: оторвался от пола — удар крыльями.
      if (m.t > 0.25 && !m.data.vUp) {
        m.data.vUp = 1;
        vfx(sim, api, 'f15b_fxtakeoff', m.x, m.y, 1.0);
      }
      if (m.t >= LION.takeoff) {
        m.data.vUp = 0; // v2.87 — только рисунок
        m.data.ghost = 1;
        m.data.fanT = 0.5;
        api.setMode(m, 'f15_fly');
      }
      return;
    case 'f15_fly': {
      // Кружит над ареной у сердца, веером роняет перья.
      m.data.ghost = 1;
      airborne(m, true);
      m.data.z = 3 + Math.sin(m.t * 5) * 0.3;
      const [kx, ky] = b ? centerOf(b) : [m.x, m.y];
      const a = (m.data.orb ?? Math.atan2(m.y - ky, m.x - kx)) + dt * 1.2;
      m.data.orb = a;
      const tx = kx + Math.cos(a) * 5.5;
      const ty = ky + Math.sin(a) * 4.5;
      m.x += (tx - m.x) * Math.min(1, dt * 3);
      m.y += (ty - m.y) * Math.min(1, dt * 3);
      m.face = Math.atan2(ty - m.y, tx - m.x);
      // v2.87 — только рисунок: взмахи над полом — пыль разбегается.
      if (sim.time >= (m.data.vFlap ?? 0)) {
        m.data.vFlap = sim.time + 0.44;
        vfx(sim, api, 'f15b_fxflap', m.x, m.y, 0.6, {}, true);
      }
      m.data.fanT = (m.data.fanT ?? 0.5) - dt;
      if (m.data.fanT <= 0) {
        m.data.fanT = 1.15;
        const aim = Math.atan2(h.y - m.y, h.x - m.x);
        api.shoot(sim, m, aim, { speed: 7, r: 0.3, life: 2.4, dmg: 0.5, art: 'f15b_feather', n: 5, spread: 1.15 });
      }
      if (m.t >= LION.fly) {
        delete m.data.orb;
        api.setMode(m, 'f15_swoopAim');
        say(sim, stateOf(sim, api), 'swoop', 'f15b_swoop_trap', 'ПИКЕ', 'линия через весь зал — сойди с неё');
      }
      return;
    }
    case 'f15_swoopAim': {
      m.data.ghost = 1;
      airborne(m, true);
      m.data.z = 3;
      m.vx = 0;
      m.vy = 0;
      if (!m.data.lit) {
        m.data.lit = 1;
        const a = Math.atan2(h.y - m.y, h.x - m.x);
        const len = wallDist(sim, m.x, m.y, a, 30) - 0.8;
        m.dir = a;
        m.data.len = len;
        m.data.sx = m.x;
        m.data.sy = m.y;
        api.strike(sim, {
          shape: 'line',
          x: m.x,
          y: m.y,
          r: len,
          w: 1.05,
          ang: a,
          warn: LION.swoopAim,
          dmg: m.dmg * 2,
          knock: 10,
          art: 'f15b_swoop',
          from: m.id,
          above: true,
        });
      }
      m.face = m.dir;
      // v2.87 — только рисунок: висит на взмахах — пыль под ним.
      if (sim.time >= (m.data.vFlap ?? 0)) {
        m.data.vFlap = sim.time + 0.44;
        vfx(sim, api, 'f15b_fxflap', m.x, m.y, 0.6, {}, true);
      }
      m.danger = LION.swoopAim - m.t < 0.25 ? 99 : 0;
      if (m.t >= LION.swoopAim) {
        m.data.lit = 0;
        api.setMode(m, 'f15_swoop');
      }
      return;
    }
    case 'f15_swoop': {
      const k = Math.min(1, m.t / LION.swoop);
      const len = m.data.len ?? 6;
      m.x = m.data.sx + Math.cos(m.dir) * len * k;
      m.y = m.data.sy + Math.sin(m.dir) * len * k;
      m.vx = 0;
      m.vy = 0;
      m.data.z = 3 - 2.4 * k;
      m.data.ghost = 1;
      // Перья-мины по следу: чуть позже рвутся.
      const n = Math.floor(k * 6);
      while ((m.data.quills ?? 0) < n) {
        const i = m.data.quills ?? 0;
        m.data.quills = i + 1;
        const d = (len * (i + 0.5)) / 6;
        api.strike(sim, {
          shape: 'circle',
          x: m.data.sx + Math.cos(m.dir) * d + Math.cos(m.dir + Math.PI / 2) * (i % 2 ? 0.9 : -0.9),
          y: m.data.sy + Math.sin(m.dir) * d + Math.sin(m.dir + Math.PI / 2) * (i % 2 ? 0.9 : -0.9),
          r: 0.75,
          warn: 0.85,
          dmg: m.dmg * 0.9,
          knock: 4,
          art: 'f15b_quill',
          from: m.id,
        });
      }
      if (k >= 1 && b) {
        m.data.quills = 0;
        const [lx, ly] = landSpot(sim, b, m.x, m.y);
        m.x = lx;
        m.y = ly;
        m.data.z = 0;
        m.data.ghost = 0;
        airborne(m, false);
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        sim.events.push({ t: 'boss', what: 'f15b_land_wall' });
        sim.events.push({ t: 'shake', k: 0.5 });
        vfx(sim, api, 'f15b_fxland', m.x, m.y, 1.3, { ang: m.dir }); // v2.87 — только рисунок
        m.data.flyCd = 9 / haste;
        m.data.air = 1;
        api.setMode(m, 'f15_landed');
      }
      return;
    }
    case 'f15_gust': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = m.dir;
      if (!m.data.lit && m.t >= 0.1) {
        m.data.lit = 1;
        api.strike(sim, {
          shape: 'cone',
          x: m.x,
          y: m.y,
          r: LION.gustR,
          ang: m.dir,
          arc: LION.gustArc,
          warn: LION.gustWarn - 0.1,
          dmg: m.dmg * 0.55,
          knock: 17,
          art: 'f15b_gust',
          from: m.id,
        });
      }
      if (m.t >= LION.gustWarn + 0.35) {
        m.data.lit = 0;
        m.data.gustCd = 7;
        api.setMode(m, 'f15_recover');
      }
      return;
    }
    case 'f15_fan': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = m.dir;
      const shots = [0.45, 0.8, 1.15];
      const i = m.data.fans ?? 0;
      if (i < shots.length && m.t >= shots[i]) {
        m.data.fans = i + 1;
        vfx(sim, api, 'f15b_fxflap', m.x, m.y, 0.6, {}, true); // v2.87 — только рисунок
        const aim = Math.atan2(h.y - m.y, h.x - m.x) + (i % 2 ? 0.09 : -0.09);
        api.shoot(sim, m, aim, { speed: 8, r: 0.3, life: 2.2, dmg: 0.55, art: 'f15b_feather', n: 5, spread: 1 });
      }
      if (m.t >= LION.fan) {
        m.data.fans = 0;
        m.data.fanCd = 6.5;
        api.setMode(m, 'f15_recover');
      }
      return;
    }
    // --- Сердце.
    case 'f15_rip':
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.data.ghost = 1;
      m.face = Math.PI / 2;
      if (!m.data.lit && m.t >= 1.7 && b) {
        m.data.lit = 1;
        const st = stateOf(sim, api);
        const hd = api.spawnMob(sim, 'f15boss_heart', m.x, m.y - 0.9, { mode: 'f15h_rise' });
        hd.data.sx = hd.x;
        hd.data.sy = hd.y;
        st.heart = hd.id;
        vfx(sim, api, 'f15b_fxrip', hd.x, hd.y, 1.6, { above: true }); // v2.87 — только рисунок
        sim.events.push({ t: 'flash', color: '#ff3040', k: 0.8 });
        sim.events.push({ t: 'shake', k: 0.7 });
        api.camera(sim, centerOf(b)[0], centerOf(b)[1] - 0.5, 2.4);
      }
      if (m.t >= LION.rip) {
        m.data.lit = 0;
        api.setMode(m, 'f15_husk');
      }
      return;
    case 'f15_husk':
      m.vx = 0;
      m.vy = 0;
      m.data.ghost = 1;
      return;
    default:
      api.setMode(m, 'chase');
  }
}

registerBrain('f15boss', {
  raw: true,
  step: lionStep,
  onHit(_sim, m, hit) {
    let k = 1;
    if (m.mode === 'f15_landed') k = 1.3;
    // До засечки «СЕРДЦЕ» лев не падает: сердце вырывается раньше.
    const room = m.hp - m.maxHp * LION.hp[2] - 1;
    if (hit.dmg * k > room) k = Math.max(0, room / Math.max(1, hit.dmg));
    return k;
  },
});

// ---------------------------------------------------------------------------
// Истинное сердце.
// ---------------------------------------------------------------------------

/** Доля текущего удара 0…1 (0 — только что сжалось). */
export function beatK(st: Readonly<F15BState>, time: number): number {
  return Math.max(0, Math.min(1, (time - st.beatAt) / Math.max(0.2, st.period)));
}

registerBrain('f15boss_heart', {
  raw: true,
  step(sim, m, _dt, _c, api) {
    const b = sim.boss;
    if (!b) return;
    const [kx, ky] = centerOf(b);
    m.vx = 0;
    m.vy = 0;
    if (m.mode === 'f15h_rise') {
      const k = Math.min(1, m.t / HEART.rise);
      const e = k * k * (3 - 2 * k);
      m.x = m.data.sx + (kx - m.data.sx) * e;
      m.y = m.data.sy + (ky - 0.2 - m.data.sy) * e;
      m.data.z = Math.sin(k * Math.PI) * 1.2 + k * 0.6;
      m.data.ghost = 1;
      if (k >= 1) {
        m.data.ghost = 0;
        api.setMode(m, 'f15h_beat');
      }
      return;
    }
    m.x = kx;
    m.y = ky - 0.2;
    m.data.z = 0.6;
    m.data.ghost = 0;
    void api;
  },
  onHit(sim, m, hit) {
    const st = STATES.get(sim);
    if (!st) return 1;
    const open = beatK(st, sim.time) > HEART.shutK;
    const k = open ? HEART.open : HEART.shut;
    // Последний удар — замедление: финал играется медленно.
    if (hit.dmg * k >= m.hp && !st.finale) st.api.slowmo(sim, 2.4, 0.22);
    return k;
  },
});

// ---------------------------------------------------------------------------
// Кровяной сгусток: катится к герою, раздувается и лопается.
// ---------------------------------------------------------------------------

registerBrain('f15b_clot', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        const wob = Math.sin(sim.time * 7 + m.id) * 0.35;
        api.steer(sim, m, dx - dy * wob, dy + dx * wob, m.speed, dt);
        if (c.dist < 1.45) api.setMode(m, 'f15c_swell');
        return;
      }
      case 'f15c_swell': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const T = c.def.windup;
        m.tele = { shape: 'circle', r: 1.25, k: Math.min(1, m.t / T) };
        m.danger = T - m.t < 0.25 ? 1.6 : 0;
        // v2.87 — только рисунок: метку раздувания рисует этаж (идёт за сгустком).
        if (!m.data.vSwell) {
          m.data.vSwell = 1;
          m.data.vNoTele = 1;
          vfx(sim, api, 'f15b_fxclot', m.x, m.y, T + 0.1, { mob: m.id });
        }
        if (m.t >= T) {
          vfx(sim, api, 'f15b_fxpop', m.x, m.y, 0.9); // v2.87 — только рисунок
          if (c.dist < 1.25 + h.r && canHurt(sim)) api.hurtHero(sim, m.dmg * 1.6, m.x, m.y, 6, m.kind);
          api.zone(sim, { x: m.x, y: m.y, r: 1.15, life: 3, slow: 0.62, art: 'f15b_pool' });
          sim.events.push({ t: 'kill', x: m.x, y: m.y, mob: m.kind, elite: false, albino: false });
          m.hp = 0;
          m.tele = null;
          m.danger = 0;
          api.setMode(m, 'dying');
        }
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    api.zone(sim, { x: m.x, y: m.y, r: 0.8, life: 2, slow: 0.75, art: 'f15b_pool' });
  },
});

// ---------------------------------------------------------------------------
// Четверти памяти.
// ---------------------------------------------------------------------------

/** Четверть арены по точке (или null — перекрёсток и кольцо сердца). */
function quadAt(sim: Sim, b: BossFight, x: number, y: number): Quad | null {
  const st = STATES.get(sim);
  if (!st || !st.quads.length) return null;
  const [kx, ky] = centerOf(b);
  const dx = x - kx;
  const dy = y - ky;
  if (Math.abs(dx) < 1.6 || Math.abs(dy) < 1.6) return null;
  return st.quads[(dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1)] ?? null;
}

function planQuads(sim: Sim, b: BossFight): Quad[] {
  const W = sim.world.w;
  const [kx, ky] = centerOf(b);
  const solidProp = new Set<number>();
  for (const p of sim.props) if (p.alive && p.r > 0) solidProp.add(Math.floor(p.y) * W + Math.floor(p.x));
  const quads: Quad[] = QUADS.map((kind, q) => ({
    kind,
    q,
    to: new Map(),
    area: [],
    mirrors: [],
    circles: [],
    pools: [],
    on: false,
    at: 0,
    next: 0,
  }));
  const cand: number[][] = [[], [], [], []];
  for (const i of b.cells) {
    if (sim.tiles[i] !== T_FLOOR) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    const dx = x + 0.5 - kx;
    const dy = y + 0.5 - ky;
    const q = (dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1);
    if (Math.abs(dx) < 1.6 || Math.abs(dy) < 1.6) continue;
    if (hypot(dx, dy) < 4.6) continue;
    if (dy > 7.5 && Math.abs(dx) < 3.6) continue;
    quads[q].area.push(i);
    if (solidProp.has(i)) continue;
    // У самой стены — тропа: пятна не липнут к стене.
    let edge = false;
    for (const d of [1, -1, W, -W]) if (!b.cells.has(i + d)) edge = true;
    if (edge) continue;
    cand[q].push(i);
  }
  const blob = (qd: Quad, list: number[], seed: number, cut: number, deep: [number, number], rim: [number, number, HazardSpec]) => {
    const set = new Set<number>();
    for (const i of list) if (vnoise((i % W) * 0.42, Math.floor(i / W) * 0.42, seed) > cut) set.add(i);
    for (const i of set) {
      qd.to.set(i, [deep[0], deep[1], null]);
      qd.pools.push(i);
    }
    for (const i of list) {
      if (set.has(i)) continue;
      let near = false;
      for (const d of [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1]) if (set.has(i + d)) near = true;
      if (near) qd.to.set(i, [T_HAZARD, rim[1], rim[2]]);
    }
  };
  blob(quads[0], cand[0], 31, 0.55, [T_DEEP, MK.lava], [T_HAZARD, MK.crust, HAZ_CRUST]);
  blob(quads[1], cand[1], 57, 0.55, [T_DEEP, MK.abyss], [T_HAZARD, MK.shallow, HAZ_SHALLOW]);
  // Зеркала: столбы-стены, не ближе 3,2 друг к другу.
  const mir = quads[2];
  const byHash = (i: number) => ((i * 2654435761) >>> 0) % 997;
  for (const i of [...cand[2]].sort((a, b2) => byHash(a) - byHash(b2))) {
    if (mir.mirrors.length >= 5) break;
    const x = i % W;
    const y = Math.floor(i / W);
    if (mir.mirrors.some((j) => hypot((j % W) - x, Math.floor(j / W) - y) < 3.2)) continue;
    mir.mirrors.push(i);
  }
  for (const i of mir.mirrors) mir.to.set(i, [T_WALL, MK.mirror, null]);
  for (const i of mir.area)
    if (!mir.to.has(i)) {
      const x = i % W;
      const y = Math.floor(i / W);
      if (mir.mirrors.some((j) => Math.max(Math.abs((j % W) - x), Math.abs(Math.floor(j / W) - y)) <= 1))
        mir.to.set(i, [T_FLOOR, MK.mirrorFloor, null]);
    }
  // Гидра: топь пятнами и две пары кругов-телепортов.
  const hyd = quads[3];
  for (const i of cand[3])
    if (vnoise((i % W) * 0.5, Math.floor(i / W) * 0.5, 83) > 0.64) hyd.to.set(i, [T_HAZARD, MK.bog, HAZ_BOG]);
  const free = cand[3].filter((i) => !hyd.to.has(i));
  const pick: number[] = [];
  const hx0 = kx + 6;
  const hy0 = ky + 4.5;
  // Четыре круга по углам четверти: пары — накрест.
  for (const [ox, oy] of [
    [-3.5, -2.5],
    [3.5, 2.5],
    [3.5, -2.5],
    [-3.5, 2.5],
  ]) {
    let best = -1;
    let bd = 1e9;
    for (const i of free) {
      if (pick.includes(i)) continue;
      const d = hypot((i % W) + 0.5 - (hx0 + ox), Math.floor(i / W) + 0.5 - (hy0 + oy));
      if (d < bd && pick.every((j) => hypot((j % W) - (i % W), Math.floor(j / W) - Math.floor(i / W)) > 3)) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) pick.push(best);
  }
  if (pick.length === 4) {
    hyd.circles = [
      [pick[0], pick[1]],
      [pick[2], pick[3]],
    ];
    hyd.to.set(pick[0], [T_FLOOR, MK.circleA, null]);
    hyd.to.set(pick[1], [T_FLOOR, MK.circleA, null]);
    hyd.to.set(pick[2], [T_FLOOR, MK.circleB, null]);
    hyd.to.set(pick[3], [T_FLOOR, MK.circleB, null]);
  }
  // Связность: от сердца обязано быть можно дойти до каждой клетки пола.
  for (let pass = 0; pass < 24; pass++) {
    const block = new Set<number>();
    for (const qd of quads) for (const [i, [t]] of qd.to) if (t === T_DEEP || t === T_WALL) block.add(i);
    const start = Math.floor(ky) * W + Math.floor(kx);
    const seen = new Set<number>([start]);
    const q = [start];
    while (q.length) {
      const i = q.pop()!;
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        if (seen.has(j) || !b.cells.has(j) || block.has(j) || !walkT(sim.tiles[j])) continue;
        seen.add(j);
        q.push(j);
      }
    }
    let fixed = false;
    for (const i of b.cells) {
      if (seen.has(i) || block.has(i) || !walkT(sim.tiles[i])) continue;
      // Отрезанная клетка: снять преграды вокруг неё.
      for (const d of [1, -1, W, -W])
        for (const qd of quads) {
          const v = qd.to.get(i + d);
          if (v && (v[0] === T_DEEP || v[0] === T_WALL)) {
            qd.to.delete(i + d);
            qd.mirrors = qd.mirrors.filter((j) => j !== i + d);
            qd.pools = qd.pools.filter((j) => j !== i + d);
            fixed = true;
          }
        }
    }
    if (!fixed) break;
  }
  return quads;
}

/** Четверть просыпается: клетки меняются, свет, опасности. */
function wakeQuad(sim: Sim, b: BossFight, st: F15BState, api: SimApi, qd: Quad): void {
  const W = sim.world.w;
  const h = sim.hero;
  const hi = Math.floor(h.y) * W + Math.floor(h.x);
  // Герой на клетке, что станет глубиной, — сносит на твёрдое.
  const deepNow = new Set<number>();
  for (const [i, [t]] of qd.to) if (t === T_DEEP) deepNow.add(i);
  if (deepNow.has(hi) && !heroDown(sim)) {
    const [sx, sy] = landSpot(sim, b, h.x, h.y);
    api.moveHero(sim, sx, sy);
    api.hurtEnv(sim, 0.05);
  }
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || api.def(m.kind).boss) continue;
    if (deepNow.has(Math.floor(m.y) * W + Math.floor(m.x))) api.fall(sim, m);
  }
  for (const [i, [t, mk, hz]] of qd.to) retile(sim, st, i, t, mk, hz);
  qd.on = true;
  qd.next = sim.time + 2.2 + qd.q * 0.4;
  // Свет памяти: лава горит, бездна мерцает, зеркала холодны, круги зелены.
  const tint = (['red', 'teal', 'cold', 'green'] as const)[qd.q];
  const pts = qd.kind === 'mirror' ? qd.mirrors : qd.kind === 'hydra' ? qd.circles.flat() : qd.pools.filter((_, k) => k % 7 === 0).slice(0, 4);
  pts.forEach((i, n) => light(sim, st, `f15b_q${qd.q}_${n}`, (i % W) + 0.5, Math.floor(i / W) + 0.5, qd.kind === 'lava' ? 3.6 : 2.4, tint));
  sim.events.push({ t: 'boss', what: `f15b_${qd.kind}_trap` });
  sim.events.push({ t: 'shake', k: 0.25 });
  vfx(sim, api, 'f15b_fxqwake', centerOf(b)[0], centerOf(b)[1], 1.0, { q: qd.q, above: true }); // v2.87 — только рисунок
}

/** Беда четверти: извержение, водоворот, луч зеркала, голова из круга. */
function quadHazard(sim: Sim, b: BossFight, st: F15BState, api: SimApi, qd: Quad, power = 1): void {
  const W = sim.world.w;
  const h = sim.hero;
  const lion = lionOf(sim);
  const dmg = (lion?.dmg ?? api.def('f15boss').dmg) * 1.15;
  const near = (i: number) => hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y);
  switch (qd.kind) {
    case 'lava': {
      const spots = qd.area.filter((i) => walkT(sim.tiles[i]) && near(i) < 4.5);
      for (let n = 0; n < 2 * power && spots.length; n++) {
        const i = spots[Math.floor(sim.rng() * spots.length)];
        api.strike(sim, { shape: 'circle', x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, r: 1.15, warn: 1, dmg, knock: 5, status: 'burn', dur: 1.5, art: 'f15b_erupt' });
      }
      return;
    }
    case 'abyss': {
      // Водоворот у ближнего омута: сперва видно, потом тянет к краю, и
      // у края бьёт гейзер — уйти рывком, пока не потянуло.
      let best = -1;
      let bd = 5.5;
      for (const i of qd.pools) {
        const d = near(i);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best < 0 || st.swirl) return;
      const px = (best % W) + 0.5;
      const py = Math.floor(best / W) + 0.5;
      const a = Math.atan2(h.y - py, h.x - px);
      const [ex, ey] = landSpot(sim, b, px + Math.cos(a) * 1.3, py + Math.sin(a) * 1.3);
      st.swirl = { x: ex, y: ey, at: sim.time + 0.95, px, py };
      api.zone(sim, { x: px, y: py, r: 2.6, life: 1.9, art: 'f15b_swirl' });
      api.strike(sim, { shape: 'circle', x: ex, y: ey, r: 1.3, warn: 1.95, dmg: dmg * 1.05, knock: 12, status: 'chill', dur: 1.6, art: 'f15b_geyser' });
      return;
    }
    case 'mirror': {
      for (let n = 0; n < power; n++) {
        const seen = qd.mirrors.filter((i) => near(i) < 11 && api.lineOfSight(sim, (i % W) + 0.5, Math.floor(i / W) + 0.5, h.x, h.y));
        if (!seen.length) return;
        const i = seen[(st.beats + n) % seen.length];
        const x = (i % W) + 0.5;
        const y = Math.floor(i / W) + 0.5;
        const a = Math.atan2(h.y - y, h.x - x);
        api.strike(sim, {
          shape: 'line',
          x: x + Math.cos(a) * 0.55,
          y: y + Math.sin(a) * 0.55,
          r: wallDist(sim, x + Math.cos(a) * 0.6, y + Math.sin(a) * 0.6, a, 14),
          w: 0.38,
          ang: a,
          warn: 0.9,
          dmg,
          knock: 4,
          art: 'f15b_beam',
          los: true,
          above: true,
        });
      }
      return;
    }
    case 'hydra': {
      const cs = qd.circles.flat().filter((i) => near(i) < 7);
      cs.sort((a2, b2) => near(a2) - near(b2));
      for (let n = 0; n < Math.min(power, cs.length); n++) {
        const i = cs[n];
        api.strike(sim, { shape: 'circle', x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, r: 1.45, warn: 0.85, dmg, knock: 6, status: 'poison', dur: 1.5, art: 'f15b_hbite' });
      }
    }
  }
}

/** Лев будит четверть, в которой стоит герой. */
function flareQuad(sim: Sim, b: BossFight, st: F15BState, api: SimApi, power: number): void {
  const qd = quadAt(sim, b, sim.hero.x, sim.hero.y);
  if (!qd || !qd.on) return;
  quadHazard(sim, b, st, api, qd, power);
  qd.next = sim.time + 3.2;
  sim.events.push({ t: 'boss', what: 'roar' });
}

function stepQuads(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  const W = sim.world.w;
  const h = sim.hero;
  for (const qd of st.quads) {
    if (!qd.on && qd.at > 0 && sim.time >= qd.at) wakeQuad(sim, b, st, api, qd);
    if (!qd.on) continue;
    const mine = quadAt(sim, b, h.x, h.y) === qd;
    if (sim.time >= qd.next) {
      qd.next = sim.time + (qd.kind === 'lava' ? 3.2 : qd.kind === 'abyss' ? 4.2 : qd.kind === 'mirror' ? 2.9 : 3.8) / hasteOf(sim);
      if (mine && !heroDown(sim)) quadHazard(sim, b, st, api, qd);
    }
  }
  // Водоворот тянет к краю омута.
  if (st.swirl && sim.time >= st.swirl.at) {
    const s = st.swirl;
    st.swirl = null;
    if (!heroDown(sim) && hypot(h.x - s.px, h.y - s.py) < 2.9 && h.mode !== 'dash')
      api.pullHero(sim, s.x, s.y, { speed: 5.5, max: 0.6 });
  }
  // Круги гидры: встал — вспышка, через миг ты у пары.
  const hyd = st.quads[3];
  if (hyd?.on && !heroDown(sim)) {
    const hi = Math.floor(h.y) * W + Math.floor(h.x);
    if (st.tp && sim.time >= st.tp.at) {
      const to = st.tp.to;
      st.tp = null;
      st.tpCd = sim.time + 1.8;
      api.moveHero(sim, (to % W) + 0.5, Math.floor(to / W) + 0.5);
      sim.events.push({ t: 'boss', what: 'f15b_warp_call' });
      sim.events.push({ t: 'flash', color: '#80ffb0', k: 0.35 });
    } else if (!st.tp && sim.time >= st.tpCd)
      for (const [a, c] of hyd.circles) {
        const to = hi === a ? c : hi === c ? a : -1;
        if (to < 0) continue;
        st.tp = { to, at: sim.time + 0.55 };
        for (const i of [hi, to])
          api.zone(sim, { x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, r: 0.9, life: 0.6, art: 'f15b_warp', above: true }); // v2.87 — только рисунок: above
        break;
      }
  }
}

/** Память гаснет: четверти выгорают обратно в плоть (фаза «СЕРДЦЕ»). */
function drainQuads(sim: Sim, st: F15BState, api: SimApi): void {
  const W = sim.world.w;
  // Всё, что меняли четверти: лава оставляет копоть, прочее — плоть как была.
  for (const [i, was] of [...st.changed]) {
    const lava = sim.world.mark[i] === MK.lava || sim.world.mark[i] === MK.crust;
    api.setTile(sim, i % W, Math.floor(i / W), was.tile, lava ? MK.scorch : was.mark, null);
    if (!lava) st.changed.delete(i);
  }
  for (const qd of st.quads) {
    qd.on = false;
    qd.at = 0;
  }
  for (const k of [...st.lights]) if (k.startsWith('f15b_q')) {
    api.light(sim, k, null);
    st.lights.delete(k);
  }
  st.tp = null;
  st.swirl = null;
}

// ---------------------------------------------------------------------------
// Фаза «СЕРДЦЕ»: удары, кольца, артерии, сгустки, сжатие стен.
// ---------------------------------------------------------------------------

/** Кольца арены от стены внутрь (0 — у стены); у ворот и у сердца — нет. */
function buildRings(sim: Sim, b: BossFight, husk: Mob | undefined): number[][] {
  const W = sim.world.w;
  const [kx, ky] = centerOf(b);
  const dist = new Map<number, number>();
  const q: number[] = [];
  for (const i of b.cells) {
    for (const d of [1, -1, W, -W])
      if (!b.cells.has(i + d)) {
        dist.set(i, 0);
        q.push(i);
        break;
      }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (!b.cells.has(j) || dist.has(j)) continue;
      dist.set(j, dist.get(i)! + 1);
      q.push(j);
    }
  }
  const rings: number[][] = Array.from({ length: HEART.squeezeMax }, () => []);
  for (const [i, d] of dist) {
    if (d >= HEART.squeezeMax) continue;
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    // Тропа от сердца к воротам и само сердце не сжимаются.
    if (y - ky > 3 && Math.abs(x - kx) < 3.6) continue;
    if (hypot(x - kx, y - ky) < 6.5) continue;
    if (husk && hypot(x - husk.x, y - husk.y) < 2.6) continue;
    if (sim.props.some((p) => p.alive && p.r > 0 && Math.floor(p.x) === i % W && Math.floor(p.y) === Math.floor(i / W))) continue;
    rings[d].push(i);
  }
  // Карманов не бывает: после каждого кольца любая открытая клетка арены
  // достижима от сердца, иначе стену рядом с карманом не ставим.
  const start = Math.floor(ky) * W + Math.floor(kx);
  for (let s = 0; s < rings.length; s++) {
    for (let pass = 0; pass < 40; pass++) {
      const shut = new Set<number>();
      for (let k = 0; k <= s; k++) for (const i of rings[k]) shut.add(i);
      const seen = new Set<number>([start]);
      const q2 = [start];
      while (q2.length) {
        const i = q2.pop()!;
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
          if (seen.has(j) || !b.cells.has(j) || shut.has(j) || !walkT(sim.tiles[j])) continue;
          seen.add(j);
          q2.push(j);
        }
      }
      let fixed = false;
      for (const i of b.cells) {
        if (seen.has(i) || shut.has(i) || !walkT(sim.tiles[i])) continue;
        for (const d of [1, -1, W, -W])
          for (let k = 0; k <= s; k++) {
            const at = rings[k].indexOf(i + d);
            if (at >= 0) {
              rings[k].splice(at, 1);
              fixed = true;
            }
          }
      }
      if (!fixed) break;
    }
  }
  return rings;
}

function heartBeat(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  const heart = heartOf(sim);
  if (!heart || heart.mode !== 'f15h_beat' || heroDown(sim)) return;
  const [kx, ky] = centerOf(b);
  const W = sim.world.w;
  const hk = heart.hp / heart.maxHp;
  // Сильный удар: три кольца волной от сердца.
  if (st.beats % HEART.strongEvery === 0) {
    HEART.rings.forEach((r, n) =>
      api.strike(sim, {
        shape: 'ring',
        x: kx,
        y: ky,
        r,
        w: 0.55,
        warn: 0.55 + n * 0.25,
        dmg: heart.dmg * 0.75,
        knock: 7,
        art: 'f15b_pulse',
        from: heart.id,
        above: true,
      }),
    );
    sim.events.push({ t: 'shake', k: 0.22 });
  }
  // Сжатие стен: метка кольца, через удар-другой — стена.
  if (st.pending.length && sim.time >= st.pendingAt) {
    const h = sim.hero;
    const hi = Math.floor(h.y) * W + Math.floor(h.x);
    const crushed = st.pending.includes(hi);
    for (const i of st.pending) if (walkT(sim.tiles[i]) || sim.tiles[i] === T_DEEP) retile(sim, st, i, T_WALL, MK.swell, null);
    // v2.87 — только рисунок: стена сомкнулась — плоть шлёпает по всему кольцу.
    vfx(sim, api, 'f15b_fxsqueeze', kx, ky, 0.9, { cells: st.pending });
    sim.events.push({ t: 'shake', k: 0.3 });
    st.pending = [];
    if (crushed) {
      api.hurtEnv(sim, 0.08);
      say(sim, st, '', 'f15b_squeeze_trap', 'СТЕНА ДАВИТ', 'держись ближе к сердцу');
    }
    say(sim, st, 'squeeze', 'f15b_squeeze_wall', 'СТЕНЫ СЖИМАЮТСЯ', 'каждые четыре удара — на шаг ближе');
    for (const m of sim.mobs)
      if (st.clots.has(m.id) && m.mode !== 'dying' && !walkT(tileAt(sim, Math.floor(m.x), Math.floor(m.y)))) api.fall(sim, m);
  } else if (
    !st.pending.length &&
    st.squeeze < HEART.squeezeMax &&
    st.beats % HEART.squeezeEvery === 1 &&
    hk < 0.97
  ) {
    const ring = st.rings[st.squeeze] ?? [];
    st.squeeze += 1;
    if (ring.length) {
      st.pending = ring;
      st.pendingAt = sim.time + HEART.squeezeWarn;
      tagZone(sim, api, { x: kx, y: ky, r: 0.1, life: HEART.squeezeWarn + 0.2, art: 'f15b_swellwarn', cells: ring });
      // v2.87 — только рисунок: метка держится до настоящего сжатия (на ударе после 1,7 с).
      vfx(sim, api, 'f15b_fxswell', kx, ky, HEART.squeezeWarn + 1.6, { cells: ring });
    }
  }
}

function stepHeartPhase(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  const heart = heartOf(sim);
  if (!heart || heart.mode !== 'f15h_beat' || heroDown(sim)) return;
  const [kx, ky] = centerOf(b);
  const hk = heart.hp / heart.maxHp;
  // Артерии хлещут: линии от сердца, веер поворачивается.
  if (sim.time >= st.whipAt) {
    st.whipAt = sim.time + HEART.whipEvery * (0.75 + hk * 0.25);
    const n = hk > 0.5 ? 4 : 6;
    st.whipA += 0.42;
    for (let k = 0; k < n; k++) {
      const a = st.whipA + (k / n) * TAU;
      api.strike(sim, {
        shape: 'line',
        x: kx + Math.cos(a) * 1.1,
        y: ky + Math.sin(a) * 1.1,
        r: wallDist(sim, kx, ky, a, 16) - 1.1,
        w: 0.5,
        ang: a,
        warn: 1.05,
        dmg: heart.dmg * 1.0,
        knock: 7,
        art: 'f15b_artery',
        from: heart.id,
        above: true,
      });
    }
  }
  // Сгустки капают со свода.
  if (sim.time >= st.clotAt) {
    st.clotAt = sim.time + HEART.clotEvery;
    for (const id of [...st.clots]) if (!sim.mobs.some((m) => m.id === id && m.mode !== 'dying')) st.clots.delete(id);
    const W = sim.world.w;
    const h = sim.hero;
    const spots = [...b.cells].filter((i) => {
      if (!walkT(sim.tiles[i])) return false;
      const d = hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y);
      return d > 4 && d < 9;
    });
    for (let n = 0; n < 2 && st.clots.size < HEART.clotMax && spots.length; n++) {
      const i = spots[Math.floor(sim.rng() * spots.length)];
      const c = api.spawnMob(sim, 'f15b_clot', (i % W) + 0.5, Math.floor(i / W) + 0.5, { mode: 'drop' });
      c.t = -n * 0.3;
      st.clots.add(c.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Сценарий.
// ---------------------------------------------------------------------------

function spawnEcho(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  const n = st.echo;
  const kind = ECHO.order[n];
  const [kx, ky] = centerOf(b);
  const [ox, oy] = ECHO.spots[n];
  const [x, y] = landSpot(sim, b, kx + ox, ky + oy);
  const m = api.spawnMob(sim, kind, x, y, { mode: 'f15e_rise' });
  m.face = Math.atan2(sim.hero.y - y, sim.hero.x - x);
  if (kind === 'f15b_echo_serpent') st.trail = [];
  sim.events.push({
    t: 'boss',
    what: 'f15b_echo_call',
    text: `ЭХО · ${ECHO.names[n]}`,
    sub: ECHO.hints[n],
  });
  sim.events.push({ t: 'flash', color: '#a8e0ff', k: 0.3 });
}

function echoDown(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  st.echo += 1;
  const lion = lionOf(sim);
  if (lion) {
    api.setMode(lion, 'f15_crack');
    // Кокон вздрагивает: толчок от него (метка кольцом).
    api.strike(sim, { shape: 'ring', x: lion.x, y: lion.y, r: 2.4, w: 0.55, warn: 0.5, dmg: lion.dmg * 0.4, knock: 9, art: 'f15b_shock', from: lion.id });
  }
  sim.events.push({
    t: 'boss',
    what: 'f15b_crack_stone',
    text: st.echo < 5 ? `КОКОН ТРЕСНУЛ · ${st.echo} из 5` : 'КОКОН РАСКОЛОТ',
    sub: st.echo < 5 ? 'встаёт следующее эхо' : 'сейчас он выйдет',
  });
  sim.events.push({ t: 'shake', k: 0.45 });
  if (st.echo < ECHO.order.length) st.echoAt = sim.time + ECHO.gap;
  else st.wakeAt = sim.time + 1.8;
}

function toPhase(sim: Sim, b: BossFight, st: F15BState, api: SimApi, lion: Mob, p: number): void {
  b.phase = p;
  lion.tele = null;
  airborne(lion, false);
  lion.data.z = 0;
  const [kx, ky] = centerOf(b);
  if (p === 1) {
    api.setMode(lion, 'f15_wake');
    api.camera(sim, lion.x, lion.y - 1, 3.2);
    sim.events.push({ t: 'boss', what: 'phase', text: 'ХОЗЯИН ПОДЗЕМЕЛЬЯ', sub: 'кокон лопнул — он проснулся' });
  } else if (p === 2) {
    api.setMode(lion, 'f15_memory');
    st.quads = planQuads(sim, b);
    st.quads.forEach((qd) => {
      qd.at = sim.time + MEMORY.first + qd.q * MEMORY.stagger + MEMORY.warn;
      tagZone(sim, api, { x: kx, y: ky, r: 0.1, life: MEMORY.first + qd.q * MEMORY.stagger + MEMORY.warn + 0.2, art: 'f15b_qwarn', q: qd.q, cells: qd.area });
    });
    api.camera(sim, kx, ky - 1, 3.4);
    sim.events.push({ t: 'boss', what: 'phase', text: 'ПОДЗЕМЕЛЬЕ ПОМНИТ', sub: 'лава, бездна, зеркала, круги — у каждой четверти своя беда' });
  } else if (p === 3) {
    api.setMode(lion, 'f15_unfurl');
    sim.events.push({ t: 'boss', what: 'phase', text: 'КРЫЛЬЯ', sub: 'взлетает — смотри на линию пике' });
  } else if (p === 4) {
    api.setMode(lion, 'f15_rip');
    drainQuads(sim, st, api);
    st.husk = lion.id;
    sim.events.push({ t: 'boss', what: 'phase', text: 'СЕРДЦЕ', sub: 'бей, когда оно раскрылось — стены сжимаются' });
  }
}

function finale(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  if (st.finale) return;
  st.finale = true;
  const lion = sim.mobs.find((x) => x.kind === 'f15boss' && x.mode !== 'dying');
  if (lion) {
    lion.hp = 0;
    lion.tele = null;
    api.setMode(lion, 'dying');
  }
  for (const m of sim.mobs)
    if (st.clots.has(m.id) && m.mode !== 'dying') {
      m.hp = 0;
      api.setMode(m, 'dying');
    }
  sim.strikes = [];
  sim.zones = sim.zones.filter((z) => !z.art?.startsWith('f15b_'));
  vfx(sim, api, 'f15b_fxfinale', centerOf(b)[0], centerOf(b)[1] - 0.2, 2.0, { above: true }); // v2.87 — только рисунок
  restoreArena(sim, st, api);
  api.slowmo(sim, 2.4, 0.22);
  sim.events.push({ t: 'flash', color: '#ffe0c0', k: 1 });
  sim.events.push({ t: 'shake', k: 1 });
  sim.events.push({ t: 'boss', what: 'finale' });
}

/**
 * Перейти сразу в фазу `p` идущего боя — для тестов и стенда (кадры фаз без
 * пяти минут боя). Эхо убираются, лев получает здоровье ровно на пороге.
 */
export function f15bForce(sim: Sim, api: SimApi, p: number): boolean {
  const b = sim.boss;
  const lion = lionOf(sim);
  if (!b || b.state !== 'fight' || !lion || p <= b.phase || p > 4) return false;
  const st = stateOf(sim, api);
  sim.mobs = sim.mobs.filter((m) => !m.kind.startsWith('f15b_echo_'));
  sim.strikes = [];
  sim.zones = sim.zones.filter((z) => !z.art?.startsWith('f15b_') || z.art === 'f15b_qwarn' || z.art === 'f15b_veins');
  st.echo = ECHO.order.length;
  st.echoAt = 0;
  st.wakeAt = 0;
  lion.data.ghost = 0;
  const from = b.phase;
  if (from === 0) toPhase(sim, b, st, api, lion, 1);
  if (p >= 2 && from < 2) {
    lion.hp = lion.maxHp * LION.hp[0] - 1;
    toPhase(sim, b, st, api, lion, 2);
  }
  if (p >= 3 && from < 3) {
    lion.hp = lion.maxHp * LION.hp[1] - 1;
    toPhase(sim, b, st, api, lion, 3);
  }
  if (p >= 4) {
    lion.hp = lion.maxHp * LION.hp[2];
    st.rings = buildRings(sim, b, lion);
    toPhase(sim, b, st, api, lion, 4);
    st.whipAt = sim.time + LION.rip + HEART.rise + 1.5;
    st.clotAt = sim.time + LION.rip + HEART.rise + 3;
  }
  return true;
}

registerBoss('f15boss', {
  start(sim, b, lead, api) {
    const st = stateOf(sim, api);
    // Прошлый бой (победа) мог оставить следы — перед новым арена цела.
    restoreArena(sim, st, api);
    STATES.delete(sim);
    const fresh = stateOf(sim, api);
    b.phase = 0;
    const cocoon = sim.props.find((p) => p.kind === 'deco' && p.obj.ref === 'f15b_cocoon');
    if (cocoon) cocoon.r = 0;
    lead.data.kx = lead.x;
    lead.data.ky = lead.y + 0.4;
    lead.data.ghost = 1;
    lead.face = Math.PI / 2;
    api.setMode(lead, 'f15_cocoon');
    fresh.echoAt = sim.time + 2.4;
    fresh.beatNext = sim.time + 0.3;
    // Вены арены — рисунку пульса: клетка и расстояние от сердца.
    const W = sim.world.w;
    const [kx, ky] = centerOf(b);
    for (const i of b.cells)
      if (sim.world.mark[i] === MK.vein || sim.world.mark[i] === MK.root)
        fresh.veins.push(i, Math.round(hypot((i % W) + 0.5 - kx, Math.floor(i / W) + 0.5 - ky) * 10));
    light(sim, fresh, 'f15b_core', kx, ky, 5.5, 'red');
    // Пульс по венам арены — рисунок (зона без вреда, живёт весь бой).
    api.zone(sim, { x: kx, y: ky, r: 0.1, life: 1e6, art: 'f15b_veins' });
  },
  step(sim, b, dt, api) {
    const st = stateOf(sim, api);
    const lion = lionOf(sim);
    // Сердцебиение: у спящего — медленное, у бьющегося — чаще с ранами.
    if (sim.time >= st.beatNext) {
      const heart = heartOf(sim);
      const hk = heart ? heart.hp / heart.maxHp : 1;
      st.period =
        b.phase === 0 ? 1.5 : b.phase < 4 ? 1.15 : HEART.period[1] + (HEART.period[0] - HEART.period[1]) * hk;
      st.beatAt = sim.time;
      st.beatNext = sim.time + st.period;
      st.beats += 1;
      // Удар сердца — звук (в фазе «СЕРДЦЕ» — чаще и громче).
      sim.events.push({ t: 'boss', what: b.phase === 4 ? 'f15b_beat_fast' : 'f15b_beat' });
      if (b.phase === 4) heartBeat(sim, b, st, api);
    }
    if (!st.said && b.t > 1.3) {
      st.said = true;
      sim.events.push({ t: 'boss', what: 'f15b_intro_call', text: 'ОТГОЛОСКИ', sub: 'кокон спит — его стерегут пять прошлых владык' });
    }
    if (!lion) return;
    if (b.phase === 0) {
      if (st.echoAt > 0 && sim.time >= st.echoAt) {
        st.echoAt = 0;
        spawnEcho(sim, b, st, api);
      }
      if (st.wakeAt > 0 && sim.time >= st.wakeAt) {
        st.wakeAt = 0;
        toPhase(sim, b, st, api, lion, 1);
      }
      return;
    }
    const k = lion.hp / lion.maxHp;
    if (b.phase === 1 && k <= LION.hp[0] && calm(lion)) toPhase(sim, b, st, api, lion, 2);
    else if (b.phase === 2 && k <= LION.hp[1] && calm(lion)) toPhase(sim, b, st, api, lion, 3);
    else if (b.phase === 3 && k <= LION.hp[2] + 0.0005 && calm(lion)) {
      st.rings = buildRings(sim, b, lion);
      toPhase(sim, b, st, api, lion, 4);
      st.whipAt = sim.time + LION.rip + HEART.rise + 1.5;
      st.clotAt = sim.time + LION.rip + HEART.rise + 3;
    }
    if (b.phase >= 2 && b.phase < 4) stepQuads(sim, b, st, api);
    if (b.phase === 4) stepHeartPhase(sim, b, st, api);
    // Свет сердца: в фазе «СЕРДЦЕ» — с ним в центре, раньше — в груди льва.
    const heart = heartOf(sim);
    const src = heart ?? lion;
    light(sim, st, 'f15b_core', src.x, src.y - 0.3, b.phase === 4 ? 6.5 : b.phase === 0 ? 5.5 : 3.2, 'red');
    void dt;
  },
  onPartDown(sim, b, m, api) {
    const st = stateOf(sim, api);
    if (m.kind === 'f15b_echo_head') {
      if (sim.mobs.some((x) => x.kind === 'f15b_echo_head' && x.mode !== 'dying')) return true;
      for (const x of sim.mobs)
        if (x.kind === 'f15b_echo_hydra' && x.mode !== 'dying') {
          x.hp = 0;
          echoGone(sim, x);
          api.setMode(x, 'dying');
        }
      echoDown(sim, b, st, api);
      return true;
    }
    if (m.kind.startsWith('f15b_echo_')) {
      echoDown(sim, b, st, api);
      return true;
    }
    if (m.kind === 'f15boss_heart') {
      finale(sim, b, st, api);
      return false;
    }
    if (m.kind === 'f15boss') {
      // Страховка: лев пал раньше сердца (урон мимо щита) — сердце вырывается само.
      const heart = api.spawnMob(sim, 'f15boss_heart', m.x, m.y - 0.9, { mode: 'f15h_rise' });
      heart.data.sx = heart.x;
      heart.data.sy = heart.y;
      st.heart = heart.id;
      b.phase = 4;
      drainQuads(sim, st, api);
      st.rings = buildRings(sim, b, undefined);
      return true;
    }
    return true;
  },
  bar(sim, b) {
    const st = STATES.get(sim);
    if (b.phase === 0) {
      const done = st?.echo ?? 0;
      let cur = 1;
      const parts = sim.mobs.filter((x) => x.kind.startsWith('f15b_echo_') && x.kind !== 'f15b_echo_hydra' && x.mode !== 'dying');
      if (parts.length) {
        let hp = 0;
        let max = 0;
        for (const x of parts) {
          hp += Math.max(0, x.hp);
          max += x.maxHp;
        }
        // У гидры — все три головы разом.
        if (parts[0].kind === 'f15b_echo_head') max = 3 * parts[0].maxHp;
        cur = max > 0 ? hp / max : 1;
      }
      return Math.max(0, (ECHO.order.length - done - 1 + cur) / ECHO.order.length);
    }
    if (b.phase === 4) {
      const heart = heartOf(sim);
      return heart ? (LION.hp[2] * Math.max(0, heart.hp)) / heart.maxHp : 0;
    }
    const lion = lionOf(sim);
    return lion ? Math.max(LION.hp[2], lion.hp / lion.maxHp) : 0;
  },
  notches: (_sim, b) => (b.phase === 0 ? [0.8, 0.6, 0.4, 0.2] : LION.hp),
  reset(sim, b, api) {
    const st = STATES.get(sim);
    if (st) {
      restoreArena(sim, st, api);
      sim.mobs = sim.mobs.filter((m) => !st.clots.has(m.id));
    }
    STATES.delete(sim);
    const cocoon = sim.props.find((p) => p.kind === 'deco' && p.obj.ref === 'f15b_cocoon');
    if (cocoon) cocoon.r = cocoon.obj.solid ?? 1.1;
    void b;
  },
});

export type { StrikeIn };
