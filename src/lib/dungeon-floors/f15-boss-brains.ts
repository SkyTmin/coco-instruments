// Этаж 15 «Ядро подземелья» — сценарий финального босса всей игры
// «Хозяин подземелья» (астральный владыка), ИИ его отголосков и стражи
// района «Ядро» (осколки звезды, хранители памяти).
//
// Шесть фаз (засечки полосы — `bar`/`notches`, задумка — шапка `f15-boss.ts`):
//   0 ОТГОЛОСКИ — владыка спит над звездой, завёрнутый в плащ (`ghost`). Из
//     складок плаща по очереди выходят созвездия пяти прошлых боссов, у
//     каждого свой ИИ с коронным приёмом. Павшее эхо зажигает звезду на
//     плаще (`st.echo`), плащ вздрагивает толчком.
//   1 ПРОБУЖДЕНИЕ — плащ распахивается кольцами; ладонь сверху (круг),
//     взмах наотмашь (конус), волна отталкивания (кольца друг за другом).
//   2 ГРАВИТАЦИЯ — кулак: колодец тянет героя и снаряды и схлопывается;
//     взмах: пять планет короны бьют дугами и лежат, пока их нет — лицо
//     открыто (×1,6); звездопад кольцом с проходом.
//   3 ПОДЗЕМЕЛЬЕ ПОМНИТ — четверти арены становятся прошлыми этажами
//     (лава, бездна, зеркала, круги гидры); владыка дирижирует памятью.
//   4 ЗАТМЕНИЕ — свет гаснет (слой тьмы поверх всего, `above`), видны глаза
//     и звёзды плаща; удары из тьмы, звёзды вспыхивают там, куда придёт
//     удар. Окно — распахнутый плащ (×1,6), запахнутый — ×0,15.
//   5 СВЕРХНОВАЯ — владыка сливается со звездой: вращающиеся лучи,
//     кольца с проходом, выдох (×1,5). Последний удар — `finale`.
//
// Честность: у каждого удара метка на полу (или вспышка звёзд в тьме) и
// окно после. Кадр урона совпадает с кадром контакта: метка ставится в
// начале замаха с `warn` = длина замаха. Здоровье героя — только через
// `api.hurtHero`/`api.hurtEnv`; положение — через `api.collide` (тяга
// колодца, как ветер 11-го).

import { registerBoss, registerBrain } from '../dungeon-ai';
import type { BrainCtx, SimApi, StrikeIn, ZoneIn } from '../dungeon-ai';
import type { ShotSpec } from '../dungeon';
import type { BossFight, Mob, Sim, Zone } from '../dungeon-sim';
import type { HazardSpec } from './types';
import { F15B_GEO, F15B_HAZ, F15B_MARK } from './f15-boss';

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
  /** Пауза после павшего эха до следующего, с. */
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
  /** Где встаёт эхо — от звезды, клеток. */
  spots: [
    [-5, 4],
    [5, 4],
    [0, 6],
    [0, -6],
    [0, 5],
  ] as [number, number][],
};

export const KING_E = {
  rollAim: 0.85,
  rollSpeed: 10.5,
  rollMax: 2.4,
  bounces: 2,
  dizzy: 1.6,
  rollCd: 4.2,
};
export const MINO_E = {
  axeWarn: 0.85,
  axeR: 1.5,
  axeAhead: 1.25,
  aim: 0.95,
  speed: 12.5,
  goreMax: 1.4,
  dizzy: 1.9,
  cd: 4.2,
};
export const SERP_E = {
  biteR: 2.5,
  biteArc: 1.3,
  biteWarn: 0.62,
  rear: 1.05,
  sweep: 1.0,
  gap: 2.3,
  laneW: 0.5,
  cd: 5.6,
};
export const HYDRA_E = {
  cast: 0.75,
  every: 4.2,
  biteR: 1.15,
  biteWarn: 0.62,
  heads: [
    [-1.9, -0.2],
    [0, -1.35],
    [1.9, -0.2],
  ] as [number, number][],
};
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

/** Владыка: тайминги и радиусы приёмов, множители урона по нему. */
export const LORD = {
  /** Засечки: ГРАВИТАЦИЯ, ПОДЗЕМЕЛЬЕ ПОМНИТ, ЗАТМЕНИЕ, СВЕРХНОВАЯ. */
  hp: [0.78, 0.56, 0.36, 0.15],
  /** Разворот тела, рад/с, и скорость полёта (клеток/с). */
  turn: 3.2,
  glide: 3.1,
  /** Сцены: пробуждение, сбор планет, память, запахнуть плащ, сверхновая. */
  wake: 3.4,
  gather: 2.2,
  memory: 2.4,
  wrap: 1.8,
  nova: 3.6,
  /** Ладонь сверху: замах, радиус, на сколько клеток перед ним. */
  palmWarn: 0.85,
  palmR: 1.7,
  palmAhead: 1.9,
  /** Окно после ладони, с. */
  palmOpen: 1.1,
  sweepWarn: 0.7,
  sweepR: 3.3,
  sweepArc: 1.9,
  repelWarn: 0.95,
  repelRings: [2.2, 4.0, 5.8],
  repelStep: 0.3,
  repelW: 0.55,
  repelCd: 7,
  /** Колодец: сжать кулак, жизнь, радиус тяги, сила тяги у центра, схлопывание. */
  wellWarn: 0.9,
  wellLife: 3.4,
  wellR: 4.4,
  wellPull: 3.6,
  wellBoom: 1.6,
  wellCd: 8,
  /** Планеты: взмах, полёт, лежат, возврат, радиус удара. */
  orbitWarn: 0.7,
  orbitFly: 0.85,
  orbitStay: 1.7,
  orbitBack: 0.9,
  orbitR: 1.15,
  orbitCd: 10,
  /** Звездопад: поднять руку, метеоров в кольце, радиус кольца. */
  meteorWarn: 0.9,
  meteorN: 9,
  meteorRing: 2.7,
  meteorR: 1.0,
  meteorCd: 11,
  /** Дирижёр памяти (фаза 3). */
  conduct: 1.5,
  conductCd: 9,
  /** Затмение: скорость во тьме, метка удара из тьмы, ударов до окна, окно. */
  darkSpeed: 6.5,
  darkWarn: 1.05,
  darkStrikes: 3,
  cloakOpen: 2.6,
  /** Сверхновая: лучи (ширина, вращение), тёплый ход лучей, кольца, выдох. */
  beamW: 0.5,
  beamSpin: 0.55,
  beamWarm: 1.4,
  beamHot: 5.5,
  pulseRings: [3.2, 6.4, 9.6],
  pulseWarn: 1.3,
  pulseStep: 0.3,
  pulseGap: 1.3,
  exhale: 2.8,
  shardEvery: 7,
  shardMax: 2,
  /** Множители урона по владыке. */
  mult: {
    window: 1.4,
    crown: 0.75,
    face: 1.6,
    wrapped: 0.15,
    open: 1.6,
    blaze: 0.7,
    exhale: 1.5,
    scene: 0.3,
  },
} as const;

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

/** Зона-картинка с привязкой к мобу (туман под эхом, тело змея). */
type TagZone = Zone & { mob?: number; q?: number; cells?: number[]; path?: number[] };

function tagZone(sim: Sim, api: SimApi, z: ZoneIn & Record<string, unknown>): TagZone {
  api.vfx(sim, z);
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
  /** Сколько лучей дали зеркала (по очереди). */
  shots: number;
}

/** Колодец тяготения. */
export interface Well {
  x: number;
  y: number;
  /** Когда родился и когда схлопнется (время мира). */
  at: number;
  end: number;
  r: number;
}

/** Планета короны: 0 — на орбите, 1 — летит, 2 — лежит, 3 — возвращается. */
export interface Planet {
  stage: 0 | 1 | 2 | 3;
  x: number;
  y: number;
  /** Дуга полёта: откуда, куда, контрольная точка; когда началась стадия. */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  cx: number;
  cy: number;
  at: number;
}

/** Сверхновая: стадия цикла, лучи, кольца, выдох. */
export interface Nova {
  stage: 'beams' | 'pulse' | 'exhale';
  at: number;
  /** Угол первого луча, скорость вращения (знак — направление), число лучей. */
  a: number;
  spin: number;
  n: number;
  /** Проход в кольцах — угол. */
  gap: number;
  hitCd: number;
  shardAt: number;
  cycle: number;
}

export interface F15BState {
  api: SimApi;
  /** Клетки, сменённые боем: вернуть на сбросе и после победы. */
  changed: Map<number, { tile: number; mark: number; haz: number }>;
  lights: Set<string>;
  /** Центр звезды в мире и радиус арены. */
  cx: number;
  cy: number;
  r: number;
  /** Сколько эх пало (= звёзд, зажжённых на плаще). */
  echo: number;
  echoAt: number;
  wakeAt: number;
  said: boolean;
  told: Set<string>;
  /** Змей-эхо: путь головы для тела. */
  trail: number[];
  /** Когда сменилась фаза (рисунку сцен). */
  phaseAt: number;
  wells: Well[];
  planets: Planet[];
  /** Затмение 0…1 и куда оно идёт (рисунку). */
  dark: number;
  darkTo: number;
  /** Ударов из тьмы в этом круге. */
  darkHits: number;
  nova: Nova | null;
  quads: Quad[];
  tp: { to: number; at: number } | null;
  tpCd: number;
  swirl: { x: number; y: number; at: number; px: number; py: number } | null;
  /** Свои мобы боя (осколки звезды): убрать на сбросе и в финале. */
  minions: Set<number>;
  finale: boolean;
}

const STATES = new WeakMap<Sim, F15BState>();

function stateOf(sim: Sim, api: SimApi): F15BState {
  let st = STATES.get(sim);
  if (!st) {
    const [cx, cy] = starOf(sim);
    st = {
      api,
      changed: new Map(),
      lights: new Set(),
      cx,
      cy,
      r: F15B_GEO.r,
      echo: 0,
      echoAt: 0,
      wakeAt: 0,
      said: false,
      told: new Set(),
      trail: [],
      phaseAt: 0,
      wells: [],
      planets: [],
      dark: 0,
      darkTo: 0,
      darkHits: 0,
      nova: null,
      quads: [],
      tp: null,
      tpCd: 0,
      swirl: null,
      minions: new Set(),
      finale: false,
    };
    STATES.set(sim, st);
  }
  st.api = api;
  return st;
}

/** Состояние боя для рисовальщика (через `paintSim()`); вне боя — null. */
export const f15bView = (sim: Sim | null): Readonly<F15BState> | null =>
  (sim && STATES.get(sim)) ?? null;

/**
 * Центр упавшей звезды в мире: по предмету `f15b_star`, иначе — по
 * геометрии карты и сдвигу района (верхний район начинается с ряда 0).
 */
export function starOf(sim: Sim): [number, number] {
  const o = sim.world.objs.find((x) => x.ref === 'f15b_star');
  if (o) return [o.x + 0.5, o.y + 0.5];
  const k = sim.world.objs.find((x) => x.kind === 'boss' && x.ref === 'f15boss');
  const oy = k ? k.y - k.ly : 0;
  return [F15B_GEO.cx, F15B_GEO.cy + oy];
}

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

type Tint = 'warm' | 'cold' | 'teal' | 'red' | 'violet' | 'green';
function light(
  sim: Sim,
  st: F15BState,
  key: string,
  x: number,
  y: number,
  r: number,
  tint: Tint,
): void {
  st.api.light(sim, key, { x, y, r, tint });
  st.lights.add(key);
}
function unlight(sim: Sim, st: F15BState, key: string): void {
  if (!st.lights.has(key)) return;
  st.api.light(sim, key, null);
  st.lights.delete(key);
}

function say(
  sim: Sim,
  st: F15BState,
  key: string,
  what: string,
  text?: string,
  sub?: string,
): void {
  if (key && st.told.has(key)) {
    sim.events.push({ t: 'boss', what });
    return;
  }
  if (key) st.told.add(key);
  sim.events.push({ t: 'boss', what, text, sub });
}

const lordOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f15boss' && x.mode !== 'dying');

// Только рисунок: зона-картинка (`api.vfx`: без урона и статусов, номер мимо
// `nextId`). Своих `f15b_fx*` разом не больше 40, мелочи — не больше 24.
type VfxIn = {
  ang?: number;
  n?: number;
  q?: number;
  mob?: number;
  cells?: number[];
  above?: boolean;
  tx?: number;
  ty?: number;
  k?: number;
};
function vfx(
  sim: Sim,
  api: SimApi,
  art: string,
  x: number,
  y: number,
  life: number,
  o: VfxIn = {},
  small = false,
): void {
  let n = 0;
  for (const z of sim.zones) if (z.art?.startsWith('f15b_fx')) n++;
  if (n < (small ? 24 : 40)) api.vfx(sim, { x, y, r: 0.5, life, art, ...o } as ZoneIn & VfxIn);
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
    tagZone(sim, api, {
      x: m.x,
      y: m.y,
      r: Math.max(0.9, m.r * 1.3),
      life: 1e9,
      art: 'f15b_mist',
      mob: m.id,
    });
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
function meleeWindup(
  sim: Sim,
  m: Mob,
  c: BrainCtx,
  api: SimApi,
  mult: number,
  knock: number,
): void {
  m.vx *= 0.7;
  m.vy *= 0.7;
  if (m.t >= c.def.windup) {
    const h = sim.hero;
    const a = Math.atan2(h.y - m.y, h.x - m.x);
    if (
      c.dist < c.def.reach + m.r + h.r + 0.2 &&
      Math.abs(angDiff(a, m.face)) < 0.75 &&
      canHurt(sim)
    )
      api.hurtHero(sim, m.dmg * mult, m.x, m.y, knock, m.kind);
    api.setMode(m, 'recover');
  }
}

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
        m.tele = {
          shape: 'line',
          r: len,
          w: m.r,
          ang: m.dir,
          k: Math.min(1, m.t / KING_E.rollAim),
        };
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
        } else if (
          m.data.cd <= 0 &&
          c.dist > 3 &&
          c.dist < 13 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
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
          say(
            sim,
            stateOf(sim, api),
            'lanes',
            'f15b_flame_trap',
            'ПОЛОСЫ ПЛАМЕНИ',
            'стой в просвете между ними',
          );
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
const ICE_FAN: ShotSpec = {
  speed: 8.5,
  r: 0.35,
  life: 2.2,
  dmg: 0.7,
  art: 'f15b_ice',
  status: 'chill',
  dur: 1.6,
  n: 3,
  spread: 0.55,
};

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
        above: false, // v2.87 — только рисунок: метка лежит на полу, тела закрывают её по силуэту
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
        } else if (
          c.dist < DEMON_E.cleaveR - 0.4 &&
          m.t > 1.2 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
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
          say(
            sim,
            stateOf(sim, api),
            'storm',
            'f15b_storm_trap',
            'ГРОЗА',
            'молнии бьют клетками — встань между',
          );
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
// Хозяин подземелья — астральный владыка.
// ---------------------------------------------------------------------------

/** Сказать один раз за бой (подсказка приёма). */
function tell(sim: Sim, st: F15BState, key: string, what: string, text: string, sub: string): void {
  if (st.told.has(key)) return;
  st.told.add(key);
  sim.events.push({ t: 'boss', what, text, sub });
}

/** Затухание скорости, не зависящее от длины шага. */
function brake(m: Mob, dt: number, k = 0.86): void {
  const f = Math.pow(k, dt * 60);
  m.vx *= f;
  m.vy *= f;
}

/** Повернуть тело к углу не быстрее `rate` рад/с; вернёт, сколько осталось. */
function turnTo(m: Mob, want: number, dt: number, rate: number = LORD.turn): number {
  const d = angDiff(want, m.face);
  const step = Math.max(-rate * dt, Math.min(rate * dt, d));
  let f = m.face + step;
  if (f > Math.PI) f -= TAU;
  else if (f < -Math.PI) f += TAU;
  m.face = f;
  m.dir = f;
  // Скорость разворота — плащу (отстаёт инерцией).
  m.data.turnV = dt > 0 ? step / dt : 0;
  return Math.abs(d - step);
}

/** Плыть телом вперёд: сперва развернуться, потом скользить. */
function glide(
  m: Mob,
  dt: number,
  tx: number,
  ty: number,
  speed: number,
  rate: number = LORD.turn,
): number {
  const want = Math.atan2(ty - m.y, tx - m.x);
  const off = turnTo(m, want, dt, rate);
  const k = off > 0.9 ? 0 : Math.cos(off);
  const sp = speed * Math.max(0, k);
  const a = Math.min(1, dt * 3.2);
  m.vx += (Math.cos(m.face) * sp - m.vx) * a;
  m.vy += (Math.sin(m.face) * sp - m.vy) * a;
  return off;
}

/** Держать над точкой (сон над звездой, сверхновая). */
function holdAt(m: Mob, x: number, y: number, dt: number): void {
  const a = Math.min(1, dt * 4);
  m.vx = ((x - m.x) * a) / Math.max(dt, 1e-3);
  m.vy = ((y - m.y) * a) / Math.max(dt, 1e-3);
  const v = hypot(m.vx, m.vy);
  if (v > 4) {
    m.vx *= 4 / v;
    m.vy *= 4 / v;
  }
}

/** Где на орбите короны планета `i` (мир; «над головой» — сдвиг вверх). */
export function crownSpot(m: { x: number; y: number }, i: number, time: number): [number, number] {
  const a = time * 1.3 + (i * TAU) / 5;
  return [m.x + Math.cos(a) * 0.95, m.y - 4.1 + Math.sin(a) * 0.32];
}

const crownAway = (st: F15BState | undefined) => !!st && st.planets.some((p) => p.stage !== 0);

const SCENES = new Set(['f15l_wake', 'f15l_gather', 'f15l_memory', 'f15l_wrap', 'f15l_nova']);
const calm = (m: Mob) =>
  m.mode === 'chase' ||
  m.mode === 'recover' ||
  m.mode === 'f15l_dark' ||
  m.mode === 'f15l_open' ||
  m.mode === 'f15l_core';

const hasteOf = (sim: Sim) => ((sim.boss?.phase ?? 0) >= 3 ? 1.12 : 1);

/** Точка внутри арены: не ближе `pad` к краю круга. */
function inside(st: F15BState, x: number, y: number, pad: number): [number, number] {
  const dx = x - st.cx;
  const dy = y - st.cy;
  const d = hypot(dx, dy);
  const max = st.r - pad;
  if (d <= max) return [x, y];
  return [st.cx + (dx / d) * max, st.cy + (dy / d) * max];
}

function startPalm(sim: Sim, m: Mob, api: SimApi): void {
  const a = m.face;
  const x = m.x + Math.cos(a) * LORD.palmAhead;
  const y = m.y + Math.sin(a) * LORD.palmAhead;
  api.strike(sim, {
    shape: 'circle',
    x,
    y,
    r: LORD.palmR,
    warn: LORD.palmWarn,
    dmg: m.dmg * 1.15,
    knock: 7,
    art: 'f15b_palm',
    above: true, // анимации 15 — только рисунок: метка светится поверх темноты
    from: m.id,
  });
  m.data.ang = a;
  api.setMode(m, 'f15l_palm');
}

function startSweep(sim: Sim, m: Mob, api: SimApi): void {
  const a = m.face;
  api.strike(sim, {
    shape: 'cone',
    x: m.x,
    y: m.y,
    r: LORD.sweepR,
    arc: LORD.sweepArc,
    ang: a,
    warn: LORD.sweepWarn,
    dmg: m.dmg,
    knock: 6,
    art: 'f15b_sweep',
    above: true, // анимации 15 — только рисунок: метка светится поверх темноты
    from: m.id,
  });
  m.data.ang = a;
  api.setMode(m, 'f15l_sweep');
}

function startRepel(sim: Sim, m: Mob, st: F15BState, api: SimApi): void {
  LORD.repelRings.forEach((r, i) =>
    api.strike(sim, {
      shape: i === 0 ? 'circle' : 'ring',
      x: m.x,
      y: m.y,
      r,
      w: LORD.repelW,
      warn: LORD.repelWarn + i * LORD.repelStep,
      dmg: m.dmg * 0.8,
      knock: 11,
      art: 'f15b_repel',
      above: true, // анимации 15 — только рисунок: метка светится поверх темноты
      from: m.id,
    }),
  );
  m.data.cdRepel = LORD.repelCd;
  api.setMode(m, 'f15l_repel');
  tell(
    sim,
    st,
    'repel',
    'f15b_repel_call',
    'ВОЛНА',
    'ладони врозь — отойди на шаг и стой между волнами или проскочи рывком',
  );
}

function startWell(sim: Sim, m: Mob, st: F15BState, api: SimApi): void {
  const h = sim.hero;
  // Колодец ложится туда, куда герой бежит (упреждение 0,6 с).
  const [x, y] = inside(st, h.x + h.vx * 0.6, h.y + h.vy * 0.6, 1.2);
  m.data.tx = x;
  m.data.ty = y;
  api.strike(sim, {
    shape: 'circle',
    x,
    y,
    r: LORD.wellBoom,
    warn: LORD.wellWarn + LORD.wellLife,
    dmg: m.dmg * 1.3,
    knock: 9,
    art: 'f15b_well',
    above: true, // анимации 15 — только рисунок: метка светится поверх темноты
    from: m.id,
  });
  m.data.cdWell = LORD.wellCd * (b2(sim) === 3 ? 1.4 : 1);
  api.setMode(m, 'f15l_well');
  tell(
    sim,
    st,
    'well',
    'f15b_well_call',
    'КОЛОДЕЦ',
    'кулак сжат — тянет к центру; иди против тяги, пока не схлопнулся',
  );
}

const b2 = (sim: Sim) => sim.boss?.phase ?? 0;

function startOrbit(sim: Sim, m: Mob, st: F15BState, api: SimApi): void {
  const h = sim.hero;
  const rot = sim.rng() * TAU;
  const spots: [number, number][] = [[h.x, h.y]];
  for (let k = 0; k < 4; k++) {
    const a = rot + (k * TAU) / 4;
    spots.push(inside(st, h.x + Math.cos(a) * 2.25, h.y + Math.sin(a) * 2.25, 0.8));
  }
  spots.forEach(([x, y], i) => {
    const p = st.planets[i];
    if (!p) return;
    p.tx = x;
    p.ty = y;
    api.strike(sim, {
      shape: 'circle',
      x,
      y,
      r: LORD.orbitR,
      warn: LORD.orbitWarn + LORD.orbitFly + i * 0.05,
      dmg: m.dmg,
      knock: 6,
      art: 'f15b_planet',
      above: true, // анимации 15 — только рисунок: метка светится поверх темноты
      from: m.id,
    });
  });
  m.data.cdOrbit = LORD.orbitCd * (b2(sim) === 3 ? 1.3 : 1);
  m.data.side = sim.rng() < 0.5 ? -1 : 1;
  api.setMode(m, 'f15l_orbit');
  tell(
    sim,
    st,
    'orbit',
    'f15b_orbit_call',
    'ПЛАНЕТЫ',
    'взмах — корона бьёт дугами; пока её нет, лицо открыто',
  );
}

/** Планеты сорвались с орбит: дуги от короны к меткам. */
function launchPlanets(sim: Sim, m: Mob, st: F15BState): void {
  st.planets.forEach((p, i) => {
    const [sx, sy] = crownSpot(m, i, sim.time);
    p.stage = 1;
    p.at = sim.time + i * 0.05;
    p.sx = sx;
    p.sy = sy;
    // Дуга: середина пути, отнесённая вбок (по очереди в разные стороны) и вверх.
    const mx = (sx + p.tx) / 2;
    const my = (sy + p.ty) / 2;
    const dx = p.tx - sx;
    const dy = p.ty - sy;
    const d = hypot(dx, dy) || 1;
    const side = (i % 2 ? 1 : -1) * (m.data.side ?? 1) * (1.6 + i * 0.35);
    p.cx = mx + (-dy / d) * side;
    p.cy = my + (dx / d) * side - 1.6;
    p.x = sx;
    p.y = sy;
  });
}

function startMeteor(sim: Sim, m: Mob, st: F15BState, api: SimApi): void {
  const h = sim.hero;
  const [cx, cy] = inside(st, h.x, h.y, 1.0);
  const n = LORD.meteorN;
  // Проход — со стороны от владыки (уйти можно только прочь от него) ± слот.
  const away = Math.atan2(cy - m.y, cx - m.x);
  const gap =
    Math.round((away / TAU) * n + (sim.rng() < 0.5 ? -1 : 1) * (sim.rng() < 0.5 ? 0 : 1) + n) % n;
  for (let k = 0; k < n; k++) {
    if (k === gap) continue;
    const a = (k * TAU) / n;
    const x = cx + Math.cos(a) * LORD.meteorRing;
    const y = cy + Math.sin(a) * LORD.meteorRing;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    api.strike(sim, {
      shape: 'circle',
      x,
      y,
      r: LORD.meteorR,
      warn: LORD.meteorWarn + 0.35 + k * 0.04,
      dmg: m.dmg * 0.9,
      knock: 5,
      art: 'f15b_meteor',
      from: m.id,
      above: true,
    });
  }
  api.strike(sim, {
    shape: 'circle',
    x: cx,
    y: cy,
    r: 1.3,
    warn: LORD.meteorWarn + 0.95,
    dmg: m.dmg * 1.1,
    knock: 7,
    art: 'f15b_meteor',
    from: m.id,
    above: true,
  });
  m.data.cdMeteor = LORD.meteorCd * (b2(sim) === 3 ? 1.3 : 1);
  api.setMode(m, 'f15l_meteor');
  say(
    sim,
    st,
    'meteor',
    'f15b_storm_trap',
    'ЗВЕЗДОПАД',
    'кольцо метеоров — выходи в проход, пока не упал центр',
  );
}

/** Ход владыки к герою и выбор приёма. */
function lordChase(sim: Sim, m: Mob, dt: number, c: BrainCtx, st: F15BState, api: SimApi): void {
  const h = sim.hero;
  const ph = b2(sim);
  if (heroDown(sim)) {
    brake(m, dt);
    return;
  }
  const d = c.dist;
  const toHero = Math.atan2(c.dy, c.dx);
  const speed = m.speed * hasteOf(sim);
  if (d > 2.3) glide(m, dt, h.x, h.y, speed);
  else {
    brake(m, dt);
    turnTo(m, toHero, dt);
  }
  if (m.cd > 0) return;
  if (Math.abs(angDiff(toHero, m.face)) > 0.35) return;
  const r = sim.rng();
  const ready = (k: string) => (m.data[k] ?? 0) <= 0;
  // Приёмы фазы (колодец, планеты, звездопад, дирижёр) — и вблизи, и издали.
  const opts: (() => void)[] = [];
  if (ph >= 2 && ph <= 3) {
    if (ph === 2 && ready('cdWell') && d < 9) opts.push(() => startWell(sim, m, st, api));
    if (ready('cdOrbit') && !crownAway(st) && d < 10) opts.push(() => startOrbit(sim, m, st, api));
    if (ready('cdMeteor') && d < 10) opts.push(() => startMeteor(sim, m, st, api));
    if (ph === 3 && ready('cdConduct') && quadAt(sim, st, h.x, h.y)?.on)
      opts.push(() => {
        m.data.cdConduct = LORD.conductCd;
        m.data.flared = 0;
        api.setMode(m, 'f15l_conduct');
      });
  }
  if (opts.length && (d >= 3.1 || r < 0.4)) {
    opts[Math.floor(sim.rng() * opts.length)]();
    return;
  }
  if (d < 3.1) {
    if (ready('cdRepel') && r < 0.5) startRepel(sim, m, st, api);
    else if (r < 0.75) startPalm(sim, m, api);
    else startSweep(sim, m, api);
    return;
  }
  if (ready('cdRepel') && d < 4.6) startRepel(sim, m, st, api);
}

/** Затмение: скользит во тьме к месту у героя и бьёт оттуда. */
function lordDark(sim: Sim, m: Mob, dt: number, st: F15BState, api: SimApi): void {
  const h = sim.hero;
  if (!m.data.spot) {
    m.data.spot = 1;
    m.data.spotA = sim.rng() * TAU;
  }
  const [sx, sy] = inside(
    st,
    h.x + Math.cos(m.data.spotA) * 2.7,
    h.y + Math.sin(m.data.spotA) * 2.7,
    1.4,
  );
  const far = hypot(sx - m.x, sy - m.y);
  if (far > 0.6 && m.t < 2.6) {
    glide(m, dt, sx, sy, LORD.darkSpeed, 5.5);
    return;
  }
  brake(m, dt);
  const toHero = Math.atan2(h.y - m.y, h.x - m.x);
  if (turnTo(m, toHero, dt, 5) > 0.3 || heroDown(sim) || m.t < 1.0) return;
  m.data.spot = 0;
  const kind = st.darkHits % 2;
  m.data.kind = kind;
  if (kind === 0) {
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: 3.8,
      arc: 1.6,
      ang: toHero,
      warn: LORD.darkWarn,
      dmg: m.dmg * 1.2,
      knock: 8,
      art: 'f15b_nightclaw',
      from: m.id,
      above: true,
    });
    m.data.ang = toHero;
  } else {
    const rot = sim.rng() * TAU;
    const pts: [number, number][] = [[h.x, h.y]];
    for (let k = 0; k < 4; k++)
      pts.push([
        h.x + Math.cos(rot + (k * TAU) / 4) * 2.3,
        h.y + Math.sin(rot + (k * TAU) / 4) * 2.3,
      ]);
    pts.forEach(([x, y], k) =>
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 0.95,
        warn: LORD.darkWarn + k * 0.08,
        dmg: m.dmg * 0.85,
        knock: 5,
        art: 'f15b_starfall',
        from: m.id,
        above: true,
      }),
    );
  }
  sim.events.push({ t: 'boss', what: 'f15b_glint_call' });
  api.setMode(m, 'f15l_dstrike');
}

/** Номер приёма для рисунка позы «отдыха» после него (`m.data.act`). */
export const LORD_ACT: Record<string, number> = {
  f15l_palm: 1,
  f15l_sweep: 2,
  f15l_repel: 3,
  f15l_well: 4,
  f15l_orbit: 5,
  f15l_meteor: 6,
  f15l_conduct: 7,
  f15l_dstrike: 8,
  f15l_open: 9,
  f15l_wrap: 10,
};

function lordStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const b = sim.boss;
  const st = stateOf(sim, api);
  m.data.vNoTele = 1;
  m.tele = null;
  // Тяжёлый: отдача от ударов героя почти не сдвигает.
  m.kx *= 0.5;
  m.ky *= 0.5;
  if (!b || b.state !== 'fight') {
    brake(m, dt, 0.8);
    return;
  }
  for (const k of ['cdRepel', 'cdWell', 'cdOrbit', 'cdMeteor', 'cdConduct'])
    m.data[k] = (m.data[k] ?? 1.5) - dt;
  const h = sim.hero;
  const T = m.t;
  m.danger = 0;
  // Только рисунок: какой приём доигрывает «отдых» (поза после удара).
  const act = LORD_ACT[m.mode];
  if (act) m.data.act = act;
  switch (m.mode) {
    case 'f15l_sleep':
    case 'f15l_stir':
      m.data.ghost = 1;
      holdAt(m, st.cx, st.cy + 0.15, dt);
      turnTo(m, Math.PI / 2, dt, 1);
      if (m.mode === 'f15l_stir' && T > 0.9) api.setMode(m, 'f15l_sleep');
      return;
    case 'f15l_wake':
      holdAt(m, st.cx, st.cy + 0.15, dt);
      if (T > 1.7) turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), dt, 1.4);
      if (T >= LORD.wake) {
        m.data.ghost = 0;
        api.setMode(m, 'chase');
        m.cd = 0.5;
      }
      return;
    case 'f15l_gather':
    case 'f15l_memory':
    case 'f15l_wrap':
      brake(m, dt);
      turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), dt, 1.2);
      if (
        T >=
        (m.mode === 'f15l_gather'
          ? LORD.gather
          : m.mode === 'f15l_memory'
            ? LORD.memory
            : LORD.wrap)
      ) {
        api.setMode(m, m.mode === 'f15l_wrap' ? 'f15l_dark' : 'chase');
        m.cd = 0.6;
        st.darkHits = 0;
        m.data.spot = 0;
      }
      return;
    case 'f15l_nova':
      // Плывёт к звезде и сливается с ней.
      if (hypot(st.cx - m.x, st.cy + 0.15 - m.y) > 0.4) glide(m, dt, st.cx, st.cy + 0.15, 3.6, 4);
      else {
        holdAt(m, st.cx, st.cy + 0.15, dt);
        turnTo(m, Math.PI / 2, dt, 2);
      }
      if (T >= LORD.nova) {
        api.setMode(m, 'f15l_core');
        st.nova = {
          stage: 'beams',
          at: sim.time,
          a: sim.rng() * TAU,
          spin: LORD.beamSpin,
          n: 3,
          gap: 0,
          hitCd: 0,
          shardAt: sim.time + 3,
          cycle: 0,
        };
        sim.events.push({ t: 'boss', what: 'f15b_beam_call' });
      }
      return;
    case 'f15l_core':
      holdAt(m, st.cx, st.cy + 0.15, dt);
      turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), dt, 0.8);
      return;
    case 'chase':
      lordChase(sim, m, dt, c, st, api);
      return;
    case 'f15l_palm':
      brake(m, dt, 0.8);
      if (T > LORD.palmWarn - 0.2) m.danger = 2.6;
      if (T >= LORD.palmWarn) {
        api.setMode(m, 'recover');
        m.data.open = 1;
        m.data.rest = LORD.palmOpen;
        sim.events.push({ t: 'shake', k: 0.35 });
      }
      return;
    case 'f15l_sweep':
      brake(m, dt, 0.8);
      if (T > LORD.sweepWarn - 0.2) m.danger = 3.3;
      if (T >= LORD.sweepWarn) {
        api.setMode(m, 'recover');
        m.data.open = 0;
        m.data.rest = 0.75;
      }
      return;
    case 'f15l_repel':
      brake(m, dt, 0.8);
      if (T > LORD.repelWarn - 0.2 && T < LORD.repelWarn + 0.1) m.danger = 2.4;
      if (T >= LORD.repelWarn + 0.65) {
        api.setMode(m, 'recover');
        m.data.open = 0;
        m.data.rest = 0.5;
      }
      return;
    case 'f15l_well':
      brake(m, dt, 0.8);
      if (T >= LORD.wellWarn) {
        st.wells.push({
          x: m.data.tx,
          y: m.data.ty,
          at: sim.time,
          end: sim.time + LORD.wellLife,
          r: LORD.wellR,
        });
        api.setMode(m, 'recover');
        m.data.open = 0;
        m.data.rest = 0.55;
      }
      return;
    case 'f15l_orbit':
      brake(m, dt, 0.8);
      if (T >= LORD.orbitWarn) {
        launchPlanets(sim, m, st);
        api.setMode(m, 'recover');
        m.data.open = 0;
        m.data.rest = 0.6;
      }
      return;
    case 'f15l_meteor':
      brake(m, dt, 0.8);
      if (T >= LORD.meteorWarn + 0.3) {
        api.setMode(m, 'recover');
        m.data.open = 0;
        m.data.rest = 0.5;
      }
      return;
    case 'f15l_conduct':
      brake(m, dt, 0.8);
      if (T >= 0.9 && !m.data.flared) {
        m.data.flared = 1;
        flareQuad(sim, st, api, 2);
      }
      if (T >= LORD.conduct) {
        api.setMode(m, 'recover');
        m.data.rest = 0.4;
      }
      return;
    case 'f15l_dark':
      lordDark(sim, m, dt, st, api);
      return;
    case 'f15l_dstrike':
      brake(m, dt, 0.8);
      if (T >= LORD.darkWarn + 0.25) {
        st.darkHits += 1;
        if (st.darkHits >= LORD.darkStrikes) {
          api.setMode(m, 'f15l_open');
          sim.events.push({ t: 'boss', what: 'f15b_open_call' });
          tell(sim, st, 'open', 'f15b_open_call', 'ПЛАЩ РАСПАХНУТ', 'свет изнутри — бей сейчас');
        } else api.setMode(m, 'f15l_dark');
      }
      return;
    case 'f15l_open':
      brake(m, dt, 0.8);
      turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), dt, 1.2);
      if (T >= LORD.cloakOpen) {
        st.darkHits = 0;
        m.data.spot = 0;
        api.setMode(m, 'f15l_dark');
        sim.events.push({ t: 'boss', what: 'f15b_swoop_trap' });
      }
      return;
    case 'recover':
      brake(m, dt, 0.8);
      if (T >= (m.data.rest ?? 0.8)) {
        m.data.open = 0;
        api.setMode(m, 'chase');
        m.cd = [1.3, 1.3, 1.1, 1.0, 1.0, 1.0][b.phase] ?? 1;
      }
      return;
    default:
      api.setMode(m, 'chase');
  }
}

/** Сколько урона пропускает владыка (`onHit`). */
function lordGuard(sim: Sim, m: Mob, dmg: number): number {
  const b = sim.boss;
  if (!b || (m.data.ghost ?? 0) > 0) return 0;
  const ph = b.phase;
  const st = STATES.get(sim);
  let k = 1;
  if (m.mode === 'f15l_nova') k = 0;
  else if (SCENES.has(m.mode)) k = LORD.mult.scene;
  else if (ph === 4) k = m.mode === 'f15l_open' ? LORD.mult.open : LORD.mult.wrapped;
  else if (ph === 5) k = st?.nova?.stage === 'exhale' ? LORD.mult.exhale : LORD.mult.blaze;
  else if (ph >= 2) k = crownAway(st) ? LORD.mult.face : LORD.mult.crown;
  if (m.mode === 'recover' && m.data.open && ph <= 3) k *= LORD.mult.window;
  // Засечка фазы: ниже неё — только когда сменится фаза.
  if (ph >= 1 && ph <= 4 && k > 0) {
    const floor = LORD.hp[ph - 1] * m.maxHp - 1;
    if (m.hp - dmg * k < floor) k = Math.max(0.02, (m.hp - floor) / Math.max(1, dmg));
  }
  if (k > 0 && k < 0.5) m.data.ping = sim.time;
  return k;
}

registerBrain('f15boss', {
  raw: true,
  step: lordStep,
  onHit: (sim, m, hit) => lordGuard(sim, m, hit.dmg),
});

// ---------------------------------------------------------------------------
// Колодцы, планеты, сверхновая — шаг сценария.
// ---------------------------------------------------------------------------

function stepWells(sim: Sim, st: F15BState, api: SimApi, dt: number): void {
  if (!st.wells.length) return;
  st.wells = st.wells.filter((w) => sim.time < w.end);
  const h = sim.hero;
  for (const w of st.wells) {
    const k = Math.min(1, (sim.time - w.at) / 0.4);
    if (!heroDown(sim) && !h.pull) {
      const dx = w.x - h.x;
      const dy = w.y - h.y;
      const d = hypot(dx, dy);
      if (d < w.r && d > 0.12) {
        const f = LORD.wellPull * k * (0.35 + 0.65 * (1 - d / w.r)) * (h.mode === 'dash' ? 0.3 : 1);
        h.x += (dx / d) * f * dt;
        h.y += (dy / d) * f * dt;
        api.collide(sim, h);
      }
    }
    // Снаряды гнутся к центру.
    for (const s of sim.shots) {
      const dx = w.x - s.x;
      const dy = w.y - s.y;
      const d = hypot(dx, dy);
      if (d < w.r && d > 0.1) {
        s.vx += (dx / d) * 9 * k * dt;
        s.vy += (dy / d) * 9 * k * dt;
      }
    }
    // Мелочь тоже тянет (осколки звезды).
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || api.def(m.kind).boss) continue;
      const dx = w.x - m.x;
      const dy = w.y - m.y;
      const d = hypot(dx, dy);
      if (d < w.r && d > 0.12) {
        m.x += (dx / d) * LORD.wellPull * 0.6 * k * dt;
        m.y += (dy / d) * LORD.wellPull * 0.6 * k * dt;
        api.collide(sim, m);
      }
    }
  }
}

const bez = (a: number, c: number, b: number, u: number) =>
  (1 - u) * (1 - u) * a + 2 * (1 - u) * u * c + u * u * b;

function stepPlanets(sim: Sim, st: F15BState, lord: Mob): void {
  st.planets.forEach((p, i) => {
    const t = sim.time - p.at;
    if (p.stage === 1) {
      const u = Math.max(0, Math.min(1, t / LORD.orbitFly));
      const e = u * u * (3 - 2 * u) * 0.35 + u * u * 0.65;
      p.x = bez(p.sx, p.cx, p.tx, e);
      p.y = bez(p.sy, p.cy, p.ty, e);
      if (u >= 1) {
        p.stage = 2;
        p.at = sim.time;
        p.x = p.tx;
        p.y = p.ty;
      }
    } else if (p.stage === 2) {
      if (t >= LORD.orbitStay) {
        p.stage = 3;
        p.at = sim.time;
        p.sx = p.x;
        p.sy = p.y;
      }
    } else if (p.stage === 3) {
      const [hx, hy] = crownSpot(lord, i, sim.time);
      const u = Math.max(0, Math.min(1, t / LORD.orbitBack));
      const e = u * u * (3 - 2 * u);
      const cx = (p.sx + hx) / 2;
      const cy = Math.min(p.sy, hy) - 1.8;
      p.x = bez(p.sx, cx, hx, e);
      p.y = bez(p.sy, cy, hy, e);
      if (u >= 1) p.stage = 0;
    } else {
      const [x, y] = crownSpot(lord, i, sim.time);
      p.x = x;
      p.y = y;
    }
  });
}

function spawnShard(sim: Sim, st: F15BState, api: SimApi): void {
  const a = sim.rng() * TAU;
  const s = api.spawnMob(sim, 'f15b_shard', st.cx + Math.cos(a) * 1.2, st.cy + Math.sin(a) * 1.2, {
    mode: 'f15s_eject',
  });
  s.vx = Math.cos(a) * 7;
  s.vy = Math.sin(a) * 7;
  s.face = a;
  st.minions.add(s.id);
}

function stepNova(sim: Sim, st: F15BState, api: SimApi, lord: Mob, dt: number): void {
  const nv = st.nova;
  if (!nv || lord.mode !== 'f15l_core') return;
  const t = sim.time - nv.at;
  const h = sim.hero;
  nv.hitCd -= dt;
  if (nv.stage === 'beams') {
    nv.a += nv.spin * dt * (t < LORD.beamWarm ? 0.35 : 1);
    if (t >= LORD.beamWarm && nv.hitCd <= 0 && canHurt(sim)) {
      const dx = h.x - st.cx;
      const dy = h.y - st.cy;
      for (let i = 0; i < nv.n; i++) {
        const a = nv.a + (i * TAU) / nv.n;
        const ux = Math.cos(a);
        const uy = Math.sin(a);
        const along = dx * ux + dy * uy;
        const across = Math.abs(-dx * uy + dy * ux);
        if (along > 0.7 && along < st.r + 1 && across < LORD.beamW + h.r) {
          api.hurtHero(sim, lord.dmg * 0.6, st.cx + ux * along, st.cy + uy * along, 7, 'f15boss', {
            kind: 'burn',
            dur: 0.6,
          });
          vfx(sim, api, 'f15b_fxsear', h.x, h.y, 0.45, { ang: a }, true);
          nv.hitCd = 1.1;
          break;
        }
      }
    }
    const alive = [...st.minions].filter((id) =>
      sim.mobs.some((x) => x.id === id && x.mode !== 'dying'),
    ).length;
    if (sim.time >= nv.shardAt) {
      nv.shardAt = sim.time + LORD.shardEvery;
      if (alive < LORD.shardMax) spawnShard(sim, st, api);
    }
    if (t >= LORD.beamWarm + LORD.beamHot) {
      nv.stage = 'pulse';
      nv.at = sim.time;
      nv.gap = sim.rng() * TAU;
      LORD.pulseRings.forEach((r, i) =>
        api.strike(sim, {
          shape: 'ring',
          x: st.cx,
          y: st.cy,
          r,
          w: 0.6,
          ang: nv.gap + Math.PI,
          arc: TAU - LORD.pulseGap,
          warn: LORD.pulseWarn + i * LORD.pulseStep,
          dmg: lord.dmg * 0.8,
          knock: 10,
          art: 'f15b_pulse',
          from: lord.id,
          above: true,
        }),
      );
      sim.events.push({ t: 'boss', what: 'f15b_pulse_wall' });
      tell(
        sim,
        st,
        'pulse',
        'f15b_pulse_call',
        'ВСПЫШКА',
        'кольца света — встань в проход, после них звезда выдохнет',
      );
    }
  } else if (nv.stage === 'pulse') {
    if (t >= LORD.pulseWarn + LORD.pulseRings.length * LORD.pulseStep + 0.15) {
      nv.stage = 'exhale';
      nv.at = sim.time;
      tell(sim, st, 'exhale', 'f15b_exhale_call', 'ВЫДОХ', 'звезда тускнеет — бей');
    }
  } else if (t >= LORD.exhale) {
    nv.stage = 'beams';
    nv.at = sim.time;
    nv.cycle += 1;
    nv.spin = -Math.sign(nv.spin) * LORD.beamSpin * (1 + Math.min(0.3, nv.cycle * 0.08));
    nv.n = lord.hp / lord.maxHp < 0.08 ? 4 : 3;
    nv.a = sim.rng() * TAU;
    sim.events.push({ t: 'boss', what: 'f15b_beam_call' });
  }
}

// ---------------------------------------------------------------------------
// Стража района: осколок звезды и хранитель памяти.
// ---------------------------------------------------------------------------

registerBrain('f15b_shard', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.data.vNoTele = 1;
    switch (m.mode) {
      case 'f15s_eject':
        brake(m, dt, 0.93);
        if (m.t > 0.6) {
          api.setMode(m, 'chase');
          m.cd = 0.8;
        }
        return;
      case 'chase': {
        if (heroDown(sim)) {
          brake(m, dt);
          return;
        }
        const d = c.dist || 1;
        const want = d > 3.8 ? 1 : d < 2.6 ? -0.8 : 0;
        const side = m.id & 1 ? 1 : -1;
        const ux = c.dx / d;
        const uy = c.dy / d;
        const mx = ux * want - uy * side * 0.7;
        const my = uy * want + ux * side * 0.7;
        const n = hypot(mx, my) || 1;
        api.steer(sim, m, mx / n, my / n, m.speed, dt);
        m.face = Math.atan2(c.dy, c.dx);
        if (m.cd <= 0 && d < 7.5 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          m.data.ang = m.face;
          api.setMode(m, 'f15s_aim');
          tagZone(sim, api, {
            x: m.x,
            y: m.y,
            r: 0.1,
            life: 0.72,
            art: 'f15b_fxaim',
            mob: m.id,
            ang: m.face,
            n: 6,
          });
        }
        return;
      }
      case 'f15s_aim': {
        brake(m, dt, 0.8);
        if (m.t < 0.45) m.data.ang = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.data.ang;
        const z = sim.zones.find((x) => (x as TagZone).mob === m.id && x.art === 'f15b_fxaim') as
          | (TagZone & { ang?: number; n?: number; k?: number })
          | undefined;
        if (z) {
          z.x = m.x;
          z.y = m.y;
          z.ang = m.data.ang;
          z.n = Math.min(7.5, clearDist(sim, api, m.x, m.y, m.data.ang, 7.5));
          z.k = m.t >= 0.45 ? 1 : 0;
        }
        if (m.t >= 0.7) {
          api.setMode(m, 'f15s_ram');
          m.bounce = true;
          m.data.hit = 0;
        }
        return;
      }
      case 'f15s_ram': {
        const a = m.data.ang;
        m.vx = Math.cos(a) * 11;
        m.vy = Math.sin(a) * 11;
        m.danger = 0.9;
        if (!m.data.hit && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.15 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
        }
        if (m.t > 0.5) {
          m.bounce = false;
          m.danger = 0;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'dizzy':
        brake(m, dt, 0.7);
        if (m.t > 1.2) {
          api.setMode(m, 'chase');
          m.cd = 1.6;
        }
        return;
      case 'recover':
        brake(m, dt, 0.85);
        m.danger = 0;
        if (m.t > 0.9) {
          api.setMode(m, 'chase');
          m.cd = 2 + sim.rng() * 1.2;
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'f15s_ram') return;
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    m.danger = 0;
    api.setMode(m, 'dizzy');
    sim.events.push({ t: 'boss', what: 'f15b_ping_stone' });
  },
  onDeath(sim, m) {
    echoGone(sim, m);
  },
});

registerBrain('f15b_keeper', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.data.vNoTele = 1;
    m.data.lanceCd = (m.data.lanceCd ?? 2) - dt;
    switch (m.mode) {
      case 'chase': {
        if (heroDown(sim)) {
          brake(m, dt);
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        if (c.dist > 1.6) api.steer(sim, m, dx, dy, m.speed, dt);
        else brake(m, dt);
        m.face = Math.atan2(c.dy, c.dx);
        if (m.cd > 0) return;
        if (c.dist < 2.3) {
          api.strike(sim, {
            shape: 'circle',
            x: m.x,
            y: m.y,
            r: 2.1,
            warn: 1.0,
            dmg: m.dmg * 1.1,
            knock: 8,
            art: 'f15b_kslam',
            from: m.id,
          });
          api.setMode(m, 'f15k_slam');
        } else if (
          c.dist < 6.5 &&
          m.data.lanceCd <= 0 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          const a = Math.atan2(c.dy, c.dx);
          m.data.ang = a;
          m.data.lanceCd = 5;
          api.strike(sim, {
            shape: 'line',
            x: m.x + Math.cos(a) * 0.5,
            y: m.y + Math.sin(a) * 0.5,
            r: Math.min(6.5, clearDist(sim, api, m.x, m.y, a, 6.5)),
            w: 0.45,
            ang: a,
            warn: 0.9,
            dmg: m.dmg,
            knock: 5,
            art: 'f15b_klance',
            from: m.id,
          });
          api.setMode(m, 'f15k_lance');
        }
        return;
      }
      case 'f15k_slam':
        brake(m, dt, 0.7);
        if (m.t > 0.8) m.danger = 2.1;
        if (m.t >= 1.0) {
          m.danger = 0;
          api.setMode(m, 'recover');
          sim.events.push({ t: 'shake', k: 0.2 });
        }
        return;
      case 'f15k_lance':
        brake(m, dt, 0.7);
        if (m.t >= 0.9) api.setMode(m, 'recover');
        return;
      case 'recover':
        brake(m, dt, 0.8);
        m.danger = 0;
        if (m.t > 1.1) {
          api.setMode(m, 'chase');
          m.cd = 1.4;
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m) {
    sim.events.push({ t: 'boss', what: 'f15b_keeper_stone' });
    void m;
  },
});

// ---------------------------------------------------------------------------
// Фаза «ПОДЗЕМЕЛЬЕ ПОМНИТ»: четверти арены — прошлые этажи в кристалле.
// ---------------------------------------------------------------------------

function landSpot(sim: Sim, b: BossFight, st: F15BState, x: number, y: number): [number, number] {
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
  return [st.cx, st.cy + 2];
}

function quadAt(sim: Sim, st: F15BState, x: number, y: number): Quad | null {
  if (!st.quads.length) return null;
  const dx = x - st.cx;
  const dy = y - st.cy;
  if (Math.abs(dx) < 1.6 || Math.abs(dy) < 1.6) return null;
  return st.quads[(dy < 0 ? 0 : 2) + (dx < 0 ? 0 : 1)] ?? null;
}

function planQuads(sim: Sim, b: BossFight, st: F15BState): Quad[] {
  const W = sim.world.w;
  const kx = st.cx;
  const ky = st.cy;
  const solidProp = new Set<number>();
  for (const p of sim.props)
    if (p.alive && p.r > 0) solidProp.add(Math.floor(p.y) * W + Math.floor(p.x));
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
    shots: 0,
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
    // Тропа к воротам и к печати остаётся твёрдой.
    if (Math.abs(dy) > 7.5 && Math.abs(dx) < 3.6) continue;
    quads[q].area.push(i);
    if (solidProp.has(i)) continue;
    // У самой стены — тропа: пятна не липнут к стене.
    let edge = false;
    for (const d of [1, -1, W, -W]) if (!b.cells.has(i + d)) edge = true;
    if (edge) continue;
    cand[q].push(i);
  }
  const blob = (
    qd: Quad,
    list: number[],
    seed: number,
    cut: number,
    deep: [number, number],
    rim: [number, number, HazardSpec],
  ) => {
    const set = new Set<number>();
    for (const i of list)
      if (vnoise((i % W) * 0.42, Math.floor(i / W) * 0.42, seed) > cut) set.add(i);
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
  // Зеркала: кристальные столбы-стены, не ближе 3,2 друг к другу.
  const mir = quads[2];
  const byHash = (i: number) => ((i * 2654435761) >>> 0) % 997;
  for (const i of [...cand[2]].sort((a, b2x) => byHash(a) - byHash(b2x))) {
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
      if (
        mir.mirrors.some(
          (j) => Math.max(Math.abs((j % W) - x), Math.abs(Math.floor(j / W) - y)) <= 1,
        )
      )
        mir.to.set(i, [T_FLOOR, MK.mirrorFloor, null]);
    }
  // Гидра: топь звёздной пыли пятнами и две пары кругов-телепортов.
  const hyd = quads[3];
  for (const i of cand[3])
    if (vnoise((i % W) * 0.5, Math.floor(i / W) * 0.5, 83) > 0.64)
      hyd.to.set(i, [T_HAZARD, MK.bog, HAZ_BOG]);
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
      if (
        d < bd &&
        pick.every((j) => hypot((j % W) - (i % W), Math.floor(j / W) - Math.floor(i / W)) > 3)
      ) {
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
  // Связность: от звезды обязано быть можно дойти до каждой клетки пола.
  for (let pass = 0; pass < 24; pass++) {
    const block = new Set<number>();
    for (const qd of quads)
      for (const [i, [t]] of qd.to) if (t === T_DEEP || t === T_WALL) block.add(i);
    const start = Math.floor(ky + 2) * W + Math.floor(kx);
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
    const [sx, sy] = landSpot(sim, b, st, h.x, h.y);
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
  // Свет памяти: лава в трещинах, бездна без звёзд, зеркала холодны, круги зелены.
  const tint = (['red', 'teal', 'cold', 'green'] as const)[qd.q];
  // Одна лампа на четверть, в её середине: каждая лампа — два больших слоя
  // света в кадре, а клетки памяти и так светлые (кадр фазы был самым дорогим
  // в бою: в кадре 20 ламп, из них 8 — память).
  const all =
    qd.kind === 'mirror'
      ? qd.mirrors
      : qd.kind === 'hydra'
        ? qd.circles.flat()
        : qd.pools.filter((_, k) => k % 7 === 0);
  const pts = all.length ? [all[Math.floor(all.length / 2)]] : [];
  pts.forEach((i, n) =>
    light(
      sim,
      st,
      `f15b_q${qd.q}_${n}`,
      (i % W) + 0.5,
      Math.floor(i / W) + 0.5,
      qd.kind === 'lava' ? 3.4 : 2.8,
      tint,
    ),
  );
  const names = { lava: 'ЛАВА', abyss: 'БЕЗДНА', mirror: 'ЗЕРКАЛА', hydra: 'КРУГИ ГИДРЫ' } as const;
  const hints = {
    lava: 'кристалл треснул — корка жжёт, из трещин бьёт огонь',
    abyss: 'без звёзд — мелководье вязнет, омут тянет',
    mirror: 'столбы-зеркала бьют лучом — прячься за другим',
    hydra: 'встал в круг — через миг ты у его пары',
  } as const;
  sim.events.push({
    t: 'boss',
    what: qd.kind === 'hydra' ? 'f15b_warp_call' : `f15b_${qd.kind}_trap`,
    text: names[qd.kind],
    sub: hints[qd.kind],
  });
  sim.events.push({ t: 'shake', k: 0.25 });
  vfx(sim, api, 'f15b_fxqwake', st.cx, st.cy, 1.0, { q: qd.q, above: true });
}

/** Беда четверти: извержение, омут, луч зеркала, голова из круга. */
function quadHazard(sim: Sim, st: F15BState, api: SimApi, qd: Quad, power = 1): void {
  const b = sim.boss;
  if (!b) return;
  const W = sim.world.w;
  const h = sim.hero;
  const lord = lordOf(sim);
  const dmg = (lord?.dmg ?? api.def('f15boss').dmg) * 1.1;
  const near = (i: number) => hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y);
  /** Точка на краю клетки зеркала `i` по лучу к (tx, ty) и угол луча. */
  const mirrorEdge = (i: number, tx: number, ty: number): [number, number, number] => {
    const cx = (i % W) + 0.5;
    const cy = Math.floor(i / W) + 0.5;
    const a = Math.atan2(ty - cy, tx - cx);
    const e = 0.5 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))) + 0.02;
    return [cx + Math.cos(a) * e, cy + Math.sin(a) * e, a];
  };
  switch (qd.kind) {
    case 'lava': {
      const spots = qd.area.filter((i) => walkT(sim.tiles[i]) && near(i) < 4.5);
      for (let n = 0; n < 2 * power && spots.length; n++) {
        const i = spots[Math.floor(sim.rng() * spots.length)];
        api.strike(sim, {
          shape: 'circle',
          x: (i % W) + 0.5,
          y: Math.floor(i / W) + 0.5,
          r: 1.15,
          warn: 1,
          dmg,
          knock: 5,
          status: 'burn',
          dur: 1.5,
          art: 'f15b_erupt',
        });
      }
      return;
    }
    case 'abyss': {
      // Омут у ближней бездны: сперва видно, потом тянет к краю, и у края
      // бьёт гейзер — уйти рывком, пока не потянуло.
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
      const [ex, ey] = landSpot(sim, b, st, px + Math.cos(a) * 1.3, py + Math.sin(a) * 1.3);
      st.swirl = { x: ex, y: ey, at: sim.time + 0.95, px, py };
      vfx(sim, api, 'f15b_fxswirl', px, py, 1.9, { above: false });
      api.strike(sim, {
        shape: 'circle',
        x: ex,
        y: ey,
        r: 1.3,
        warn: 1.95,
        dmg: dmg * 1.05,
        knock: 12,
        status: 'chill',
        dur: 1.6,
        art: 'f15b_geyser',
      });
      return;
    }
    case 'mirror': {
      for (let n = 0; n < power; n++) {
        // Зеркало — клетка-стена: и видимость, и луч считаются от края его
        // клетки к герою. От середины `lineOfSight` первым шагом попадал в
        // само зеркало — беда четверти почти никогда не стреляла (до v2.95).
        const seen = qd.mirrors.filter((i) => {
          if (near(i) >= 11) return false;
          const [ex, ey] = mirrorEdge(i, h.x, h.y);
          return api.lineOfSight(sim, ex, ey, h.x, h.y);
        });
        if (!seen.length) return;
        qd.shots += 1;
        const i = seen[(qd.shots + n) % seen.length];
        const [x, y, a] = mirrorEdge(i, h.x, h.y);
        api.strike(sim, {
          shape: 'line',
          x,
          y,
          r: wallDist(sim, x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.05, a, 14),
          w: 0.38,
          ang: a,
          warn: 0.9,
          dmg,
          knock: 4,
          art: 'f15b_mbeam',
          los: true,
          above: true,
        });
      }
      return;
    }
    case 'hydra': {
      const cs = qd.circles.flat().filter((i) => near(i) < 7);
      cs.sort((a2, b3) => near(a2) - near(b3));
      for (let n = 0; n < Math.min(power, cs.length); n++) {
        const i = cs[n];
        api.strike(sim, {
          shape: 'circle',
          x: (i % W) + 0.5,
          y: Math.floor(i / W) + 0.5,
          r: 1.45,
          warn: 0.85,
          dmg,
          knock: 6,
          status: 'poison',
          dur: 1.5,
          art: 'f15b_hbite',
        });
      }
    }
  }
}

/** Дирижёр: будит беду четверти, в которой стоит герой. */
function flareQuad(sim: Sim, st: F15BState, api: SimApi, power: number): void {
  const qd = quadAt(sim, st, sim.hero.x, sim.hero.y);
  if (!qd || !qd.on) return;
  quadHazard(sim, st, api, qd, power);
  qd.next = sim.time + 3.2;
  vfx(sim, api, 'f15b_fxconduct', st.cx, st.cy, 1.2, { q: qd.q, above: true });
}

function stepQuads(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  const W = sim.world.w;
  const h = sim.hero;
  for (const qd of st.quads) {
    if (!qd.on && qd.at > 0 && sim.time >= qd.at) {
      wakeQuad(sim, b, st, api, qd);
      qd.at = 0;
    }
    if (!qd.on) continue;
    const mine = quadAt(sim, st, h.x, h.y) === qd;
    if (sim.time >= qd.next) {
      qd.next =
        sim.time +
        (qd.kind === 'lava' ? 3.2 : qd.kind === 'abyss' ? 4.2 : qd.kind === 'mirror' ? 2.9 : 3.8) /
          hasteOf(sim);
      if (mine && !heroDown(sim)) quadHazard(sim, st, api, qd);
    }
  }
  // Омут тянет к краю бездны.
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
      sim.events.push({ t: 'flash', color: '#9affd0', k: 0.35 });
    } else if (!st.tp && sim.time >= st.tpCd)
      for (const [a, c] of hyd.circles) {
        const to = hi === a ? c : hi === c ? a : -1;
        if (to < 0) continue;
        st.tp = { to, at: sim.time + 0.55 };
        for (const i of [hi, to])
          vfx(sim, api, 'f15b_fxwarp', (i % W) + 0.5, Math.floor(i / W) + 0.5, 0.6, {
            above: true,
          });
        break;
      }
  }
}

/** Память гаснет: четверти выгорают обратно в звёздную карту. */
function drainQuads(sim: Sim, st: F15BState, api: SimApi): void {
  const W = sim.world.w;
  // Лава оставляет выжженное золото, остальное — пол как был.
  for (const [i, was] of [...st.changed]) {
    const lava = sim.world.mark[i] === MK.lava || sim.world.mark[i] === MK.crust;
    api.setTile(sim, i % W, Math.floor(i / W), was.tile, lava ? MK.scorch : was.mark, null);
    if (!lava) st.changed.delete(i);
  }
  for (const qd of st.quads) {
    qd.on = false;
    qd.at = 0;
  }
  for (const k of [...st.lights])
    if (k.startsWith('f15b_q')) {
      api.light(sim, k, null);
      st.lights.delete(k);
    }
  st.tp = null;
  st.swirl = null;
}

// ---------------------------------------------------------------------------
// Сценарий боя.
// ---------------------------------------------------------------------------

function spawnEcho(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  const n = st.echo;
  const kind = ECHO.order[n];
  const [ox, oy] = ECHO.spots[n];
  const [x, y] = landSpot(sim, b, st, st.cx + ox, st.cy + oy);
  const m = api.spawnMob(sim, kind, x, y, { mode: 'f15e_rise' });
  m.face = Math.atan2(sim.hero.y - y, sim.hero.x - x);
  if (kind === 'f15b_echo_serpent') st.trail = [];
  // Созвездие выходит из складок плаща: звёзды текут от владыки к месту.
  vfx(sim, api, 'f15b_fxfold', st.cx, st.cy - 1.4, ECHO.rise + 0.3, {
    tx: x,
    ty: y,
    n,
    above: true,
  });
  sim.events.push({
    t: 'boss',
    what: 'f15b_echo_call',
    text: `ЭХО · ${ECHO.names[n]}`,
    sub: ECHO.hints[n],
  });
  sim.events.push({ t: 'flash', color: '#a8c8ff', k: 0.3 });
}

function echoDown(sim: Sim, b: BossFight, st: F15BState, api: SimApi, at: Mob): void {
  st.echo += 1;
  const lord = lordOf(sim);
  if (lord) {
    api.setMode(lord, 'f15l_stir');
    // Плащ вздрагивает: толчок от него (метка кольцом).
    api.strike(sim, {
      shape: 'ring',
      x: lord.x,
      y: lord.y,
      r: 2.4,
      w: 0.55,
      warn: 0.5,
      dmg: lord.dmg * 0.4,
      knock: 9,
      art: 'f15b_shock',
      from: lord.id,
    });
  }
  // Звёзды павшего эха возвращаются на плащ — одна загорается.
  vfx(sim, api, 'f15b_fxkindle', at.x, at.y, 1.1, {
    tx: st.cx,
    ty: st.cy - 1.6,
    n: st.echo - 1,
    above: true,
  });
  sim.events.push({
    t: 'boss',
    what: 'f15b_kindle_call',
    text: st.echo < 5 ? `ЗВЕЗДА НА ПЛАЩЕ · ${st.echo} из 5` : 'ПЯТЬ ЗВЁЗД ГОРЯТ',
    sub: st.echo < 5 ? 'из складок выходит следующее эхо' : 'он просыпается',
  });
  sim.events.push({ t: 'shake', k: 0.35 });
  if (st.echo < ECHO.order.length) st.echoAt = sim.time + ECHO.gap;
  else st.wakeAt = sim.time + 1.8;
  void b;
}

const PHASE_TEXT: [string, string][] = [
  ['ОТГОЛОСКИ', 'он спит — его стерегут пять прошлых владык'],
  ['ХОЗЯИН ПОДЗЕМЕЛЬЯ', 'он проснулся — смотри на его руки'],
  ['ГРАВИТАЦИЯ', 'кулак — колодец, взмах — планеты; без короны лицо открыто'],
  ['ПОДЗЕМЕЛЬЕ ПОМНИТ', 'лава, бездна, зеркала, круги — у каждой четверти своя беда'],
  ['ЗАТМЕНИЕ', 'звёзды вспыхивают там, куда придёт удар; бей, когда плащ распахнут'],
  ['СВЕРХНОВАЯ', 'держись между лучами — бей, когда звезда выдохнет'],
];

function toPhase(sim: Sim, b: BossFight, st: F15BState, api: SimApi, lord: Mob, p: number): void {
  b.phase = p;
  st.phaseAt = sim.time;
  lord.tele = null;
  lord.danger = 0;
  // Неначатые удары прошлой фазы гаснут: сцена честная.
  sim.strikes = sim.strikes.filter((s) => s.from !== lord.id);
  st.wells = [];
  const [text, sub] = PHASE_TEXT[p];
  sim.events.push({ t: 'boss', what: 'phase', text, sub });
  if (p === 1) {
    api.setMode(lord, 'f15l_wake');
    api.camera(sim, lord.x, lord.y - 1.5, 3.2);
    api.strike(sim, {
      shape: 'ring',
      x: lord.x,
      y: lord.y,
      r: 2.6,
      w: 0.6,
      warn: 1.7,
      dmg: lord.dmg * 0.5,
      knock: 10,
      art: 'f15b_shock',
      from: lord.id,
    });
    api.strike(sim, {
      shape: 'ring',
      x: lord.x,
      y: lord.y,
      r: 5.2,
      w: 0.6,
      warn: 2.0,
      dmg: lord.dmg * 0.5,
      knock: 10,
      art: 'f15b_shock',
      from: lord.id,
    });
  } else if (p === 2) {
    api.setMode(lord, 'f15l_gather');
    api.camera(sim, lord.x, lord.y - 2, 2.2);
    lord.data.cdWell = 1.2;
    lord.data.cdOrbit = 3;
    lord.data.cdMeteor = 6;
  } else if (p === 3) {
    api.setMode(lord, 'f15l_memory');
    st.quads = planQuads(sim, b, st);
    st.quads.forEach((qd) => {
      qd.at = sim.time + MEMORY.first + qd.q * MEMORY.stagger + MEMORY.warn;
      tagZone(sim, api, {
        x: st.cx,
        y: st.cy,
        r: 0.1,
        life: MEMORY.first + qd.q * MEMORY.stagger + MEMORY.warn + 0.2,
        art: 'f15b_qwarn',
        q: qd.q,
        cells: qd.area,
      });
    });
    api.camera(sim, st.cx, st.cy - 1, 3.4);
    lord.data.cdConduct = 4;
  } else if (p === 4) {
    api.setMode(lord, 'f15l_wrap');
    drainQuads(sim, st, api);
    for (const pl of st.planets) pl.stage = 0;
    st.darkTo = 1;
    st.darkHits = 0;
    vfx(sim, api, 'f15b_fxeclipse', st.cx, st.cy, 1e9, { above: true });
    api.camera(sim, lord.x, lord.y - 1.5, 2.0);
    sim.events.push({ t: 'boss', what: 'f15b_swoop_trap' });
  } else if (p === 5) {
    api.setMode(lord, 'f15l_nova');
    for (const pl of st.planets) pl.stage = 0;
    st.darkTo = 0;
    unlight(sim, st, 'f15b_lord');
    api.camera(sim, st.cx, st.cy - 1.5, 3.4);
    api.strike(sim, {
      shape: 'ring',
      x: st.cx,
      y: st.cy,
      r: 3.2,
      w: 0.7,
      warn: LORD.nova - 0.6,
      dmg: lord.dmg * 0.6,
      knock: 12,
      art: 'f15b_shock',
      from: lord.id,
      above: true,
    });
    api.strike(sim, {
      shape: 'ring',
      x: st.cx,
      y: st.cy,
      r: 6.4,
      w: 0.7,
      warn: LORD.nova - 0.3,
      dmg: lord.dmg * 0.6,
      knock: 12,
      art: 'f15b_shock',
      from: lord.id,
      above: true,
    });
    vfx(sim, api, 'f15b_fxnova', st.cx, st.cy, LORD.nova + 0.6, { above: true });
    sim.events.push({ t: 'boss', what: 'f15b_land_wall' });
  }
}

function finale(sim: Sim, b: BossFight, st: F15BState, api: SimApi): void {
  if (st.finale) return;
  st.finale = true;
  for (const m of sim.mobs)
    if (st.minions.has(m.id) && m.mode !== 'dying') {
      m.hp = 0;
      api.setMode(m, 'dying');
    }
  sim.strikes = [];
  st.wells = [];
  st.nova = null;
  st.darkTo = 0;
  st.dark = 0;
  sim.zones = sim.zones.filter((z) => !z.art?.startsWith('f15b_'));
  vfx(sim, api, 'f15b_fxfinale', st.cx, st.cy, 3.2, { above: true });
  restoreArena(sim, st, api);
  // Страница открывает церемонию через 1,5 с и ставит мир на паузу: при
  // прежних 2,6 с × 0,2 мир успевал пройти 0,3 с, и смерть владыки не была
  // видна вовсе (кадр стоял выбеленным вспышкой). Короткое замедление —
  // удар, потом сцена идёт почти в реальном времени.
  api.slowmo(sim, 0.6, 0.4);
  sim.events.push({ t: 'flash', color: '#fff2c0', k: 0.6 });
  sim.events.push({ t: 'shake', k: 1 });
  sim.events.push({ t: 'boss', what: 'finale' });
  void b;
}

/**
 * Перейти сразу в фазу `p` идущего боя — для тестов и стенда (кадры фаз без
 * пяти минут боя). Эхо убираются, владыка получает здоровье ровно на пороге.
 */
export function f15bForce(sim: Sim, api: SimApi, p: number): boolean {
  const b = sim.boss;
  const lord = lordOf(sim);
  if (!b || b.state !== 'fight' || !lord || p <= b.phase || p > 5) return false;
  const st = stateOf(sim, api);
  sim.mobs = sim.mobs.filter((m) => !m.kind.startsWith('f15b_echo_'));
  sim.strikes = [];
  sim.zones = sim.zones.filter(
    (z) => !z.art?.startsWith('f15b_') || z.art === 'f15b_fxsky' || z.art === 'f15b_fxplanets',
  );
  st.echo = ECHO.order.length;
  st.echoAt = 0;
  st.wakeAt = 0;
  lord.data.ghost = 0;
  for (let q = b.phase + 1; q <= p; q++) {
    if (q >= 2) lord.hp = lord.maxHp * LORD.hp[q - 2] - 1;
    toPhase(sim, b, st, api, lord, q);
  }
  return true;
}

registerBoss('f15boss', {
  start(sim, b, lead, api) {
    const old = STATES.get(sim);
    // Прошлый бой (победа) мог оставить следы — перед новым арена цела.
    if (old) restoreArena(sim, old, api);
    STATES.delete(sim);
    const st = stateOf(sim, api);
    b.phase = 0;
    lead.x = st.cx;
    lead.y = st.cy + 0.15;
    lead.hx = lead.x;
    lead.hy = lead.y;
    lead.data.ghost = 1;
    lead.data.vNoTele = 1;
    lead.face = Math.PI / 2;
    api.setMode(lead, 'f15l_sleep');
    st.planets = Array.from({ length: 5 }, () => ({
      stage: 0 as const,
      x: lead.x,
      y: lead.y - 4,
      sx: 0,
      sy: 0,
      tx: 0,
      ty: 0,
      cx: 0,
      cy: 0,
      at: 0,
    }));
    st.echoAt = sim.time + 2.4;
    // Ядро звезды светит лампой легенды (r 4,2); свой свет боя — только в
    // затмении и сверхновой (две лампы в одной точке стоили кадру).
    // Небо арены (сетка, кольца, колодцы) и планеты в полёте — рисунок.
    vfx(sim, api, 'f15b_fxsky', st.cx, st.cy, 1e9);
    vfx(sim, api, 'f15b_fxplanets', st.cx, st.cy, 1e9, { above: true });
  },
  step(sim, b, dt, api) {
    const st = stateOf(sim, api);
    const lord = lordOf(sim);
    st.dark += (st.darkTo - st.dark) * Math.min(1, dt * 1.6);
    if (!st.said && b.t > 1.3) {
      st.said = true;
      sim.events.push({
        t: 'boss',
        what: 'f15b_dream_call',
        text: PHASE_TEXT[0][0],
        sub: PHASE_TEXT[0][1],
      });
    }
    stepWells(sim, st, api, dt);
    if (!lord) return;
    stepPlanets(sim, st, lord);
    if (b.phase === 0) {
      if (st.echoAt > 0 && sim.time >= st.echoAt) {
        st.echoAt = 0;
        spawnEcho(sim, b, st, api);
      }
      if (st.wakeAt > 0 && sim.time >= st.wakeAt) {
        st.wakeAt = 0;
        toPhase(sim, b, st, api, lord, 1);
      }
      return;
    }
    const k = lord.hp / lord.maxHp;
    if (b.phase <= 4 && k <= LORD.hp[b.phase - 1] + 0.0005 && calm(lord))
      toPhase(sim, b, st, api, lord, b.phase + 1);
    if (b.phase === 3) stepQuads(sim, b, st, api);
    if (b.phase === 5) stepNova(sim, st, api, lord, dt);
    // Свет: звезда — по фазе; во тьме — только распахнутый плащ.
    // В той же точке горит лампа звезды из легенды (r 4,2): своё ядро — только
    // в затмении (фиолетовый огонёк) и в сверхновой. Цена ореола растёт с
    // квадратом радиуса, вторая лампа в одной точке ничего не добавляла.
    const glow = [0, 0, 0, 0, 1.6, 7.5][b.phase] ?? 0;
    if (glow > 0)
      light(sim, st, 'f15b_core', st.cx, st.cy, glow, b.phase === 4 ? 'violet' : 'warm');
    else unlight(sim, st, 'f15b_core');
    if (b.phase === 4 && lord.mode === 'f15l_open')
      light(sim, st, 'f15b_lord', lord.x, lord.y - 1, 4.8, 'warm');
    else if (b.phase === 5) unlight(sim, st, 'f15b_lord');
    else if (b.phase === 4) unlight(sim, st, 'f15b_lord');
    else light(sim, st, 'f15b_lord', lord.x, lord.y - 1.2, 2.6, 'cold');
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
      echoDown(sim, b, st, api, m);
      return true;
    }
    if (m.kind.startsWith('f15b_echo_')) {
      echoDown(sim, b, st, api, m);
      return true;
    }
    if (m.kind === 'f15boss') {
      finale(sim, b, st, api);
      return false;
    }
    return true;
  },
  bar(sim, b) {
    const st = STATES.get(sim);
    if (b.phase === 0) {
      const done = st?.echo ?? 0;
      let cur = 1;
      const parts = sim.mobs.filter(
        (x) =>
          x.kind.startsWith('f15b_echo_') && x.kind !== 'f15b_echo_hydra' && x.mode !== 'dying',
      );
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
    const lord = lordOf(sim);
    return lord ? Math.max(0, lord.hp / lord.maxHp) : 0;
  },
  notches: (_sim, b) => (b.phase === 0 ? [0.8, 0.6, 0.4, 0.2] : [...LORD.hp]),
  reset(sim, b, api) {
    const st = STATES.get(sim);
    if (st) {
      restoreArena(sim, st, api);
      sim.mobs = sim.mobs.filter((m) => !st.minions.has(m.id));
    }
    sim.zones = sim.zones.filter((z) => !z.art?.startsWith('f15b_'));
    STATES.delete(sim);
    void b;
  },
});

export type { StrikeIn, ShotSpec };
