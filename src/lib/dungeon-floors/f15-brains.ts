// Этаж 15 «Ядро подземелья», половина «Мир» — ИИ монстров и правила этажа.
//
// Глагол — ГРАВИТАЦИЯ (задумка — шапка `f15.ts`):
//   • КОЛОДЦЫ (места `well` карты, временные — от звездочёта, звездопада и
//     сверхновой): цикл «тихо → предупреждение 1 с → тянет ~3 с». Тянут
//     героя (сдвиг с выталкиванием из стен), монстров (по массе), добычу и
//     снаряды — снаряд не замедляется, а ЗАВОРАЧИВАЕТ к ядру по дуге.
//     Сердцевина жжёт героя (6%, отброс наружу) и сминает монстров. Рычаг
//     колодца переключает «тянет / толкает»;
//   • КЛИНОК ОТБИВАЕТ СНАРЯДЫ: удар героя в первые 0,16 с ловит снаряд в
//     дуге — тот летит по взмаху, гнётся у колодцев и бьёт монстров;
//   • НЕВЕСОМОСТЬ (пол `f`, шторм): торможения нет — скорость героя
//     меняется медленно, рывок уносит дальше; у края пустоты — «СОРВАЛСЯ»
//     (8% и возврат на твёрдое со вспышкой); отбитые монстры летят в пустоту;
//   • ТЯЖЕСТЬ (пол `y`, кулак стража, шторм): медленнее, но удар ×1,4,
//     щит гравитонного стража пробивается только из тяжести;
//   • ОРБИТЫ: острова едут по кругу по такту (клетки меняются раз в такт,
//     рисунок едет плавно), везут героя, монстров и добычу; кто остался на
//     клетке, ставшей пустотой, — сорвался. Якорь дёргает героя тросом на
//     ближний остров. Малые орбиты стоят у причалов, Парад выстраивает три
//     кольца в мост;
//   • СВЕТ: кристальные лампы зажигаются действием и гаснут от пожирателя
//     света; затмение гасит планетарий, большой телескоп возвращает солнце;
//     звёзды звездопада летят со светом; кристаллы памяти вспыхивают.
//
// Залы-события: «Пробуждение осколка», «Галерея памяти» (Корни),
// «Звездопад», «Затмение» (Обсерватория), «Парад планет», «Гравитационный
// шторм» (Пояс орбит). В районе «Сердца» и в бою с боссом правила молчат.
//
// Честность: всё, что бьёт, видно заранее — линии, круги, конусы, дуги
// кометы, кольцо колодца за секунду до тяги; `m.danger` — в конце замаха.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBrain, registerFloor } from '../dungeon-ai';
import type { Brain, BrainCtx, SimApi } from '../dungeon-ai';
import type { Mob, Shot, Sim, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import type { StatusKind } from './types';
import { F15_MARK, F15_OBS, F15_ORBIT, F15_ROOTS, F15_SPOT_LIST, spotNum } from './f15';

const TAU = Math.PI * 2;
const hypot = Math.hypot;
const MK = F15_MARK;

// Клетки мира (копия `Tile` из `dungeon-world.ts`).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;
const walkable = (t: number) => t === 2 || t === 3 || t === 4 || t === 5 || t === 10 || t === 12;

const HEART = 'f15heart';

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ease = (k: number) => k * k * (3 - 2 * k);

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

/** Попал ли удар вплотную: рывок и неуязвимость спасают. */
const canHurt = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

const tileAt = (sim: Sim, x: number, y: number) => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};
const markAt = (sim: Sim, x: number, y: number) => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

/** Сколько клеток до преграды (стена или провал) по направлению. */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max;
}

/** Район по мировому ряду (без импорта движка). */
function areaAt(sim: Sim, y: number): string {
  const w = sim.world;
  return w.rowArea[clamp(Math.floor(y), 0, w.h - 1)] ?? '';
}

function bandTop(sim: Sim, area: string): number {
  return sim.world.bands.find((b) => b.def.id === area)?.top ?? 0;
}

/** Отдых после удара: гасит скорость, потом снова в погоню. */
function recoverStep(m: Mob, api: SimApi, T: number, next = 'chase'): void {
  m.vx *= 0.82;
  m.vy *= 0.82;
  if (m.t > T) api.setMode(m, next);
}

/**
 * Убить моба окружением (ядро колодца, отбитый снаряд, пустота): удар по
 * своим без урона герою — движок засчитает убийство и бросит добычу.
 */
function envKill(sim: Sim, api: SimApi, m: Mob): void {
  api.strike(sim, {
    shape: 'circle',
    x: m.x,
    y: m.y,
    r: 0.01,
    warn: 0,
    dmg: 0,
    mobDmg: Infinity,
    art: 'f15_none',
  });
}

/** Урон окружения по мобу: лёгкий — сразу, смертельный — ударом движка. */
function envHurt(sim: Sim, api: SimApi, m: Mob, amount: number): void {
  if (m.hp - amount <= 0) {
    // Удар движка в точке моба задел бы и героя вплотную — тогда ждём.
    if (hypot(sim.hero.x - m.x, sim.hero.y - m.y) > 0.36) envKill(sim, api, m);
    else m.hp = Math.max(1, m.hp - amount);
  } else {
    m.hp -= amount;
    m.flash = Math.max(m.flash, 0.12);
  }
}

const isBossKind = (k: string) => k.startsWith('f15boss') || k.startsWith('f15b_');
const alive = (m: Mob) => m.mode !== 'dying' && m.hp > 0;

function say(sim: Sim, what: string, text?: string, sub?: string): void {
  sim.events.push({ t: 'boss', what, text, sub });
}

/** Свободная клетка пола рядом с точкой (для появления, возврата). */
function openNear(sim: Sim, x: number, y: number, R = 4): [number, number] | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let r = 0; r <= R; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t = tileAt(sim, cx + dx, cy + dy);
        if (t === T_FLOOR && markAt(sim, cx + dx, cy + dy) !== MK.island) return [cx + dx + 0.5, cy + dy + 0.5];
      }
  return null;
}

// ---------------------------------------------------------------------------
// Числа механик (тесты и отчёт читают их отсюда).
// ---------------------------------------------------------------------------

export const WELL = {
  /** Предупреждение перед тягой, с. */
  warn: 1,
  /** Сколько тянет, с. */
  on: 3.2,
  /** Тяга героя у края и у ядра, клеток/с (бег — около 4,6). */
  heroEdge: 0.9,
  heroCore: 2.7,
  /** Тяга монстров (делится на корень массы). */
  mobPull: 3.4,
  /** Добыча плывёт к ядру. */
  dropPull: 1.4,
  /** Поворот снаряда у ядра, рад/с. */
  shotTurn: 4.2,
  /** Ожог сердцевины: доля здоровья и пауза между ожогами. */
  burnFrac: 0.06,
  burnCd: 0.7,
  /** Отброс героя из сердцевины, клеток/с. */
  kick: 6.5,
  /** Сминание монстра в сердцевине: доля здоровья в секунду. */
  crush: 0.55,
};

export const PARRY = {
  /** Окно после начала удара, с. */
  window: 0.16,
  /** Запас к досягаемости клинка, клеток. */
  extra: 0.4,
  speedK: 1.3,
  /** Урон отбитого снаряда — от урона героя. */
  dmgK: 1.5,
  life: 2.6,
};

export const FLOAT = {
  /** Разгон в невесомости, клеток/с² (на полу — почти мгновенно). */
  acc: 4.4,
  /** Предел скорости — от скорости бега. */
  maxK: 1.75,
  /** Слабое торможение без ввода, доля в секунду. */
  drag: 0.1,
  /** Сорвался в пустоту: доля здоровья. */
  fall: 0.08,
  /** Скорость к краю, с которой срываются. */
  slip: 1.6,
};

export const HEAVY = {
  /** Удар героя из тяжести. */
  hitK: 1.4,
  /** Монстры в тяжести. */
  mobK: 0.62,
  /** Зона кулака гравитонного стража. */
  zoneR: 1.7,
  zoneLife: 3.2,
  zoneSlow: 0.6,
};

export const ORBIT = {
  /** Стоянка малых орбит у причала, с. */
  dock: 3.2,
  /** Парад: скорость сборки, рад/с; сколько держится мост; пауза. */
  rush: 1.25,
  hold: 9,
  cd: 12,
  /** Якорь: дальность троса и скорость, клеток/с. */
  anchorR: 7.5,
  anchorV: 15,
};

// ---------------------------------------------------------------------------
// Состояние вылазки.
// ---------------------------------------------------------------------------

export interface Well {
  id: number;
  area: string;
  x: number;
  y: number;
  r: number;
  burn: number;
  period: number;
  phase: number;
  /** 1 — тянет, −1 — толкает. */
  mode: number;
  /** Сила (1 — обычный). */
  k: number;
  /** Временный: когда родился и сколько тянет (иначе — по циклу). */
  temp: boolean;
  born: number;
  warnT: number;
  onT: number;
  /** Сейчас: 0 — тихо, 1 — предупреждает, 2 — тянет; доля фазы 0…1. */
  state: number;
  f: number;
  /** Ожог: когда можно снова. */
  burnAt: number;
  /** Картинка-якорь. */
  zone: Zone | null;
  /** Ведёт событие (Пробуждение) — цикл задаёт оно. */
  forced: number;
  kind: 'map' | 'astro' | 'star' | 'nova' | 'shard' | 'core';
}

export interface FShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  life: number;
  dmg: number;
  art: string;
  zone: Zone | null;
}

export interface RingCell {
  x: number;
  y: number;
  a: number;
  i: number;
}

export interface Ring {
  name: string;
  area: string;
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  n: number;
  speed: number;
  width: number;
  half: number;
  step: number;
  cells: RingCell[];
  /** Поворот: откуда и куда в этом такте (кратно шагу), доля такта. */
  from: number;
  to: number;
  beatT: number;
  beat: number;
  /** Поворот на картинке сейчас и его прирост за кадр. */
  vis: number;
  dvis: number;
  dockLeft: number;
  /** Сейчас пол (остров) у клетки кольца. */
  floor: Uint8Array;
  zone: Zone | null;
  /** Парад: 0 — нет, 1 — сборка, 2 — мост держится. */
  parade: number;
}

export interface Mem {
  x: number;
  y: number;
  area: string;
  motif: number;
  used: boolean;
  /** Свечение 0…1 и когда выпустит. */
  glow: number;
  at: number;
  gallery: boolean;
}

export interface Lamp {
  obj: WorldObj;
  x: number;
  y: number;
  lit: boolean;
  /** Вспышка при зажигании/гашении для рисунка. */
  t: number;
}

export interface Chart {
  area: string;
  cx: number;
  cy: number;
  r: number;
  nodes: [number, number][];
  state: 'sleep' | 'awake' | 'done';
  lashAt: number;
  ids: number[];
  zone: Zone | null;
}

export interface Hall {
  name: string;
  area: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  state: 'idle' | 'run' | 'done';
  t: number;
  n: number;
  next: number;
  ids: number[];
  data: Record<string, number>;
  /** Печать на выходах: пары «клетка, прежняя метка». */
  seal: number[];
}

export interface Star {
  x: number;
  y: number;
  at: number;
  key: string;
}

/** Дуга рывка кометы вокруг колодца: радиус R → R1, угол a0 → a1. */
export interface Arc {
  id: number;
  cx: number;
  cy: number;
  R: number;
  R1: number;
  a0: number;
  a1: number;
  /** С начала замаха; замах `aim`, весь путь — `T`. */
  t: number;
  aim: number;
  T: number;
  zone: Zone | null;
}

export interface F15State {
  wells: Well[];
  rings: Ring[];
  fshots: FShot[];
  mems: Mem[];
  lamps: Lamp[];
  charts: Chart[];
  halls: Hall[];
  posts: { x: number; y: number; kind: string; done: boolean }[];
  stars: Star[];
  doors: { area: string; x0: number; x1: number; y: number; open: boolean; at: number }[];
  scopes: { obj: WorldObj | null; x: number; y: number; what: string }[];
  /** Дуги комет для рисунка: моб → дуга. */
  arcs: Map<number, Arc>;
  zmap: Map<Zone, Well | Ring | FShot | Chart | Arc>;
  swing: { t: number; x: number; y: number; ang: number; arc: number; reach: number } | null;
  /** Скорость героя в невесомости после прошлого шага. */
  hv: [number, number];
  floating: boolean;
  /** Последнее твёрдое место героя (возврат после срыва). */
  safe: [number, number];
  safeT: number;
  /** Отброс героя из сердцевины (свой, гаснет). */
  kick: [number, number];
  /** Трос якоря. */
  tether: { x0: number; y0: number; x1: number; y1: number; ax: number; ay: number; t: number; T: number; ring: Ring | null } | null;
  /** Затмение 0…1 и куда идёт. */
  dark: number;
  darkTo: number;
  darkZone: Zone | null;
  /** Шторм: 0 — нет, 1 — тяжесть, 2 — невесомость; и предупреждение. */
  storm: number;
  stormWarn: number;
  nextId: number;
  slips: number;
  parries: number;
  crushed: number;
}

const STATE = new WeakMap<Sim, F15State>();

/** Видимое рисовальщику: состояние вылазки на экране и часы. */
export const F15_FX = {
  clock: 0,
  st: null as F15State | null,
  sim: null as Sim | null,
};

export function f15State(sim: Sim): F15State | undefined {
  return STATE.get(sim);
}

/** Мировая точка места карты. */
function spotXY(sim: Sim, area: string, x: number, y: number): [number, number] {
  return [x, bandTop(sim, area) + y];
}

// ---------------------------------------------------------------------------
// Картинки-якоря: зона без действия (`api.vfx`), которую мы держим и двигаем.
// ---------------------------------------------------------------------------

function anchorZone(sim: Sim, api: SimApi, x: number, y: number, r: number, art: string, above = false): Zone {
  api.vfx(sim, { x, y, r, life: 1e9, art, above });
  return sim.zones[sim.zones.length - 1];
}

function dropZone(sim: Sim, z: Zone | null): void {
  if (!z) return;
  z.life = 0;
  const i = sim.zones.indexOf(z);
  if (i >= 0) sim.zones.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Колодцы.
// ---------------------------------------------------------------------------

function addWell(
  sim: Sim,
  st: F15State,
  api: SimApi,
  w: Partial<Well> & { x: number; y: number; r: number; kind: Well['kind'] },
): Well {
  const well: Well = {
    id: st.nextId++,
    area: areaAt(sim, w.y),
    burn: 1.4,
    period: 8,
    phase: 0,
    mode: 1,
    k: 1,
    temp: false,
    born: sim.time,
    warnT: WELL.warn,
    onT: WELL.on,
    state: 0,
    f: 0,
    burnAt: 0,
    zone: null,
    forced: 0,
    ...w,
  };
  well.zone = anchorZone(sim, api, well.x, well.y, well.r, 'f15_well');
  st.zmap.set(well.zone, well);
  st.wells.push(well);
  return well;
}

/** Временный колодец: предупреждение `warn`, тяга `on`, потом исчезает. */
function tempWell(
  sim: Sim,
  st: F15State,
  api: SimApi,
  x: number,
  y: number,
  r: number,
  warn: number,
  on: number,
  kind: Well['kind'],
  extra: Partial<Well> = {},
): Well {
  return addWell(sim, st, api, {
    x,
    y,
    r,
    kind,
    temp: true,
    born: sim.time,
    warnT: warn,
    onT: on,
    burn: 0.9,
    ...extra,
  });
}

function wellPhase(sim: Sim, w: Well): void {
  if (w.forced) {
    // Ведёт событие: `forced` — 1 предупреждение, 2 тянет, 3 тихо.
    w.state = w.forced === 3 ? 0 : w.forced;
    return;
  }
  if (w.temp) {
    const t = sim.time - w.born;
    if (t < w.warnT) {
      w.state = 1;
      w.f = t / Math.max(0.01, w.warnT);
    } else {
      w.state = 2;
      w.f = (t - w.warnT) / w.onT;
    }
    return;
  }
  const P = w.period;
  const tau = (((sim.time + w.phase) % P) + P) % P;
  const off = P - w.warnT - w.onT;
  if (tau < off) {
    w.state = 0;
    w.f = tau / off;
  } else if (tau < off + w.warnT) {
    w.state = 1;
    w.f = (tau - off) / w.warnT;
  } else {
    w.state = 2;
    w.f = (tau - off - w.warnT) / w.onT;
  }
}

/** Тянет ли сейчас хоть один колодец в этой точке (для ИИ комет и жуков). */
export function wellNear(sim: Sim, x: number, y: number, R = 0, active = false): Well | null {
  const st = STATE.get(sim);
  if (!st) return null;
  let best: Well | null = null;
  let bd = 1e9;
  for (const w of st.wells) {
    if (active && w.state === 0) continue;
    const d = hypot(w.x - x, w.y - y) - w.r - R;
    if (d < 0 && d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

/** Повернуть скорость снаряда к ядру (или прочь, если толкает). */
function bendShot(s: { x: number; y: number; vx: number; vy: number }, w: Well, dt: number): void {
  const dx = w.x - s.x;
  const dy = w.y - s.y;
  const d = hypot(dx, dy);
  if (d > w.r || d < 1e-3) return;
  const v = hypot(s.vx, s.vy);
  if (v < 1e-3) return;
  const a = Math.atan2(s.vy, s.vx);
  const target = w.mode > 0 ? Math.atan2(dy, dx) : Math.atan2(-dy, -dx);
  const turn = WELL.shotTurn * w.k * (0.25 + 0.75 * (1 - d / w.r)) * dt;
  const na = a + clamp(angDiff(target, a), -turn, turn);
  s.vx = Math.cos(na) * v;
  s.vy = Math.sin(na) * v;
}

function stepWells(sim: Sim, st: F15State, api: SimApi, dt: number, quiet: boolean): void {
  const h = sim.hero;
  for (let i = st.wells.length - 1; i >= 0; i--) {
    const w = st.wells[i];
    if (w.temp && sim.time - w.born > w.warnT + w.onT) {
      dropZone(sim, w.zone);
      if (w.zone) st.zmap.delete(w.zone);
      st.wells.splice(i, 1);
      continue;
    }
    wellPhase(sim, w);
    if (w.zone) {
      w.zone.x = w.x;
      w.zone.y = w.y;
      w.zone.r = w.r;
    }
    if (w.state !== 2 || quiet) continue;
    const k = w.k * (w.temp ? Math.min(1, (1 - w.f) * 6) : 1);
    // Герой: сдвиг к ядру (или прочь), стены выталкивают.
    const hx = w.x - h.x;
    const hy = w.y - h.y;
    const hd = hypot(hx, hy);
    if (hd < w.r && hd > 1e-3 && !heroDown(sim) && !st.tether) {
      const v = (WELL.heroEdge + (WELL.heroCore - WELL.heroEdge) * (1 - hd / w.r)) * k * w.mode;
      h.x += (hx / hd) * v * dt;
      h.y += (hy / hd) * v * dt;
      api.collide(sim, h);
      if (hd < w.burn + h.r && sim.time >= w.burnAt && h.inv <= 0) {
        w.burnAt = sim.time + WELL.burnCd;
        api.hurtEnv(sim, WELL.burnFrac);
        st.kick = [(-hx / hd) * WELL.kick, (-hy / hd) * WELL.kick];
        sim.events.push({ t: 'flash', color: '#9ff0ff', k: 0.45 });
        say(sim, 'f15_burn');
      }
    }
    // Монстры: по массе; в сердцевине их сминает.
    for (const m of sim.mobs) {
      if (!alive(m) || isBossKind(m.kind) || m.mode === 'emerge') continue;
      const dx = w.x - m.x;
      const dy = w.y - m.y;
      const d = hypot(dx, dy);
      if (d > w.r || d < 1e-3) continue;
      const mass = Math.max(0.5, api.def(m.kind).mass ?? 1);
      const v = (WELL.mobPull * k * w.mode * (0.4 + 0.6 * (1 - d / w.r))) / Math.sqrt(mass);
      m.x += (dx / d) * v * dt;
      m.y += (dy / d) * v * dt;
      api.collide(sim, m);
      if (w.mode > 0 && d < w.burn + m.r * 0.6) {
        const was = m.hp;
        envHurt(sim, api, m, m.maxHp * WELL.crush * k * dt);
        if (was > 0 && m.hp - m.maxHp * WELL.crush * k * dt <= 0) {
          st.crushed++;
          say(sim, 'f15_crush');
        }
      }
    }
    // Добыча плывёт к ядру, но в сердцевину не падает.
    for (const p of sim.drops) {
      const dx = w.x - p.x;
      const dy = w.y - p.y;
      const d = hypot(dx, dy);
      if (d > w.r || d < w.burn + 0.4) continue;
      p.x += (dx / d) * WELL.dropPull * w.mode * dt;
      p.y += (dy / d) * WELL.dropPull * w.mode * dt;
    }
    // Снаряды: гнутся, в ядре гаснут.
    for (let j = sim.shots.length - 1; j >= 0; j--) {
      const s = sim.shots[j];
      if (s.lob) continue;
      bendShot(s, w, dt * k);
      if (w.mode > 0 && hypot(w.x - s.x, w.y - s.y) < 0.55) {
        sim.shots.splice(j, 1);
        api.vfx(sim, { x: w.x, y: w.y, r: 0.8, life: 0.35, art: 'f15_spark' });
      }
    }
    for (const s of st.fshots) bendShot(s, w, dt * k);
  }
}

// ---------------------------------------------------------------------------
// Невесомость и тяжесть.
// ---------------------------------------------------------------------------

function inHall(sim: Sim, st: F15State, name: string, x: number, y: number): boolean {
  const hall = st.halls.find((h) => h.name === name);
  return !!hall && x >= hall.x0 && x <= hall.x1 + 1 && y >= hall.y0 && y <= hall.y1 + 1;
}

/** Герой (или точка) в невесомости. */
export function floatAt(sim: Sim, x: number, y: number): boolean {
  if (markAt(sim, Math.floor(x), Math.floor(y)) === MK.float) return true;
  const st = STATE.get(sim);
  return !!st && st.storm === 2 && inHall(sim, st, 'storm', x, y);
}

/** Точка в тяжести: пол `y`, кулак стража, шторм. */
export function heavyAt(sim: Sim, x: number, y: number): boolean {
  if (markAt(sim, Math.floor(x), Math.floor(y)) === MK.heavy) return true;
  for (const z of sim.zones)
    if ((z.art === 'f15_heavy' || z.art === 'f15_heavyall') && z.t >= (z.warn ?? 0) && hypot(z.x - x, z.y - y) < z.r)
      return true;
  return false;
}

function fallHero(sim: Sim, st: F15State, api: SimApi, why: string): void {
  st.slips++;
  st.hv = [0, 0];
  st.kick = [0, 0];
  st.tether = null;
  api.hurtEnv(sim, FLOAT.fall);
  const [sx, sy] = st.safe;
  const p = openNear(sim, sx, sy, 3) ?? [sx, sy];
  api.moveHero(sim, p[0], p[1]);
  sim.hero.inv = Math.max(sim.hero.inv, 0.8);
  sim.events.push({ t: 'flash', color: '#b8a0ff', k: 0.7 });
  say(sim, 'f15_slip_trap', 'СОРВАЛСЯ', why);
}

function stepHeroGravity(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const h = sim.hero;
  if (heroDown(sim) || dt <= 0) return;
  // Отброс из сердцевины.
  if (st.kick[0] || st.kick[1]) {
    h.x += st.kick[0] * dt;
    h.y += st.kick[1] * dt;
    api.collide(sim, h);
    const f = Math.exp(-7 * dt);
    st.kick = [st.kick[0] * f, st.kick[1] * f];
    if (hypot(st.kick[0], st.kick[1]) < 0.2) st.kick = [0, 0];
  }
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  // Твёрдое место — для возврата после срыва.
  st.safeT -= dt;
  if (st.safeT <= 0) {
    st.safeT = 0.25;
    let ok = tileAt(sim, cx, cy) === T_FLOOR && markAt(sim, cx, cy) !== MK.island && markAt(sim, cx, cy) !== MK.float;
    for (let dy = -1; dy <= 1 && ok; dy++)
      for (let dx = -1; dx <= 1 && ok; dx++) if (tileAt(sim, cx + dx, cy + dy) === T_DEEP) ok = false;
    if (ok) st.safe = [h.x, h.y];
  }
  // Под ногами пустота (остров уехал) — сорвался.
  if (tileAt(sim, cx, cy) === T_DEEP && !st.tether) {
    fallHero(sim, st, api, 'остров ушёл из-под ног — 8%');
    return;
  }
  const fl = floatAt(sim, h.x, h.y) && !h.pull && !st.tether;
  if (!fl) {
    st.floating = false;
    return;
  }
  const spd = sim.stats.speed;
  const vNew: [number, number] = [h.vx, h.vy];
  let vW: [number, number];
  if (h.mode === 'dash' || !st.floating) {
    vW = vNew;
  } else {
    const a = Math.min(1, dt * 14);
    const [ox, oy] = st.hv;
    const tx = ox + (vNew[0] - ox) / a;
    const ty = oy + (vNew[1] - oy) / a;
    if (hypot(tx, ty) < 0.05) {
      const f = 1 - FLOAT.drag * dt;
      vW = [ox * f, oy * f];
    } else {
      let ax = tx - ox;
      let ay = ty - oy;
      const al = hypot(ax, ay);
      const lim = FLOAT.acc * dt;
      if (al > lim) {
        ax = (ax / al) * lim;
        ay = (ay / al) * lim;
      }
      vW = [ox + ax, oy + ay];
    }
  }
  const vl = hypot(vW[0], vW[1]);
  const cap = spd * FLOAT.maxK;
  if (vl > cap) vW = [(vW[0] / vl) * cap, (vW[1] / vl) * cap];
  if (h.mode !== 'dash') {
    h.x += (vW[0] - vNew[0]) * dt;
    h.y += (vW[1] - vNew[1]) * dt;
    api.collide(sim, h);
    h.vx = vW[0];
    h.vy = vW[1];
  }
  st.hv = [h.vx, h.vy];
  st.floating = true;
  // Край пустоты: дрейф В НЕЁ (а не вдоль кромки) — сорвался.
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const gx = cx + dx;
      const gy = cy + dy;
      if (tileAt(sim, gx, gy) !== T_DEEP) continue;
      const mk = markAt(sim, gx, gy);
      if (mk !== MK.void && mk !== MK.lane && mk !== MK.vortex) continue;
      // Ближняя точка клетки пустоты и скорость к ней.
      const nx = clamp(h.x, gx, gx + 1) - h.x;
      const ny = clamp(h.y, gy, gy + 1) - h.y;
      const d = hypot(nx, ny);
      if (d > h.r + 0.1 || d < 1e-4) continue;
      if ((h.vx * nx + h.vy * ny) / d > FLOAT.slip) {
        fallHero(sim, st, api, 'в невесомости не затормозить — 8%');
        return;
      }
    }
}

/** Монстры в невесомости: отдача не гаснет, отбитые улетают в пустоту. */
function stepMobGravity(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  for (const m of sim.mobs) {
    if (!alive(m) || isBossKind(m.kind) || api.def(m.kind).fly) continue;
    if (!floatAt(sim, m.x, m.y)) continue;
    const k = hypot(m.kx, m.ky);
    if (k < 0.3) continue;
    // Движок гасит отдачу как exp(−9·dt); здесь её почти не гасит ничто.
    const keep = Math.exp(7.6 * dt);
    m.kx = clamp(m.kx * keep, -12, 12);
    m.ky = clamp(m.ky * keep, -12, 12);
    if (k > 2.2) {
      const px = m.x + (m.kx / k) * (m.r + 0.2);
      const py = m.y + (m.ky / k) * (m.r + 0.2);
      if (tileAt(sim, Math.floor(px), Math.floor(py)) === T_DEEP) {
        api.fall(sim, m);
        say(sim, 'f15_drift_fall');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Клинок отбивает снаряды; отбитые летят сами.
// ---------------------------------------------------------------------------

function stepParry(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  for (const e of sim.events)
    if (e.t === 'swing') st.swing = { t: sim.time, x: e.x, y: e.y, ang: e.ang, arc: e.arc, reach: e.reach };
  const sw = st.swing;
  if (sw && sim.time - sw.t <= PARRY.window && !heroDown(sim)) {
    const h = sim.hero;
    for (let j = sim.shots.length - 1; j >= 0; j--) {
      const s: Shot = sim.shots[j];
      if (s.lob) continue;
      const dx = s.x - h.x;
      const dy = s.y - h.y;
      const d = hypot(dx, dy);
      if (d > sw.reach + PARRY.extra) continue;
      if (Math.abs(angDiff(Math.atan2(dy, dx), sw.ang)) > sw.arc / 2 + 0.25) continue;
      sim.shots.splice(j, 1);
      const v = Math.max(6, hypot(s.vx, s.vy)) * PARRY.speedK;
      const fs: FShot = {
        x: s.x,
        y: s.y,
        vx: Math.cos(sw.ang) * v,
        vy: Math.sin(sw.ang) * v,
        r: Math.max(0.18, s.r),
        age: 0,
        life: PARRY.life,
        dmg: sim.stats.dmg * PARRY.dmgK,
        art: s.art,
        zone: null,
      };
      fs.zone = anchorZone(sim, api, fs.x, fs.y, 0.4, 'f15_fshot');
      st.zmap.set(fs.zone, fs);
      st.fshots.push(fs);
      st.parries++;
      sim.events.push({ t: 'clank', x: s.x, y: s.y });
      say(sim, 'f15_parry');
    }
  }
  // Полёт отбитых: стены гасят, монстров бьют.
  for (let i = st.fshots.length - 1; i >= 0; i--) {
    const s = st.fshots[i];
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    let dead = s.age >= s.life;
    const t = tileAt(sim, Math.floor(s.x), Math.floor(s.y));
    if (!walkable(t) && t !== T_DEEP) dead = true;
    if (!dead)
      for (const m of sim.mobs) {
        if (!alive(m) || isBossKind(m.kind) || m.mode === 'emerge') continue;
        if (hypot(m.x - s.x, m.y - s.y) > m.r + s.r) continue;
        envHurt(sim, api, m, s.dmg);
        m.kx += (s.vx / Math.max(1, hypot(s.vx, s.vy))) * 3;
        m.ky += (s.vy / Math.max(1, hypot(s.vx, s.vy))) * 3;
        sim.events.push({ t: 'hit', x: m.x, y: m.y, dmg: Math.round(s.dmg), crit: false, kill: m.hp <= 0, boss: false });
        dead = true;
        break;
      }
    if (s.zone) {
      s.zone.x = s.x;
      s.zone.y = s.y;
    }
    if (dead) {
      api.vfx(sim, { x: s.x, y: s.y, r: 0.7, life: 0.3, art: 'f15_spark' });
      if (s.zone) st.zmap.delete(s.zone);
      dropZone(sim, s.zone);
      st.fshots.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Орбиты: острова едут по кругу по такту.
// ---------------------------------------------------------------------------

function islandAt(r: Ring, a: number, rot: number): boolean {
  for (let k = 0; k < r.n; k++) {
    const c = Math.PI / 2 + (k * TAU) / r.n + rot;
    if (Math.abs(angDiff(a, c)) <= r.half) return true;
  }
  return false;
}

/** Клетки кольца — как в `scripts/dungeon/f15.py` (`ring_cells`). */
function ringCells(cx: number, cy: number, r0: number, r1: number): RingCell[] {
  const out: RingCell[] = [];
  for (let y = Math.floor(cy - r1) - 1; y < Math.floor(cy + r1) + 2; y++)
    for (let x = Math.floor(cx - r1) - 1; x < Math.floor(cx + r1) + 2; x++) {
      const d = hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r0 && d < r1) out.push({ x, y, a: Math.atan2(y + 0.5 - cy, x + 0.5 - cx), i: 0 });
    }
  out.sort((p, q) => p.a - q.a);
  out.forEach((c, i) => (c.i = i));
  return out;
}

function retileRing(sim: Sim, r: Ring, api: SimApi): void {
  for (const c of r.cells) {
    const want = islandAt(r, c.a, r.from) || islandAt(r, c.a, r.to) ? 1 : 0;
    if (want === r.floor[c.i]) continue;
    r.floor[c.i] = want;
    api.setTile(sim, c.x, c.y, want ? T_FLOOR : T_DEEP, want ? MK.island : MK.lane);
  }
}

/** Повернуть точку вокруг центра кольца, если она на острове этого кольца. */
function carry(sim: Sim, r: Ring, p: { x: number; y: number }, da: number): boolean {
  const dx = p.x - r.cx;
  const dy = p.y - r.cy;
  const d = hypot(dx, dy);
  if (d < r.r0 - 0.15 || d > r.r1 + 0.15) return false;
  if (markAt(sim, Math.floor(p.x), Math.floor(p.y)) !== MK.island) return false;
  if (tileAt(sim, Math.floor(p.x), Math.floor(p.y)) !== T_FLOOR) return false;
  const a = Math.atan2(dy, dx) + da;
  p.x = r.cx + Math.cos(a) * d;
  p.y = r.cy + Math.sin(a) * d;
  return true;
}

const atHalfTurn = (a: number) => {
  const m = a / Math.PI;
  return Math.abs(m - Math.round(m)) < 1e-6;
};

function stepRing(sim: Sim, st: F15State, r: Ring, api: SimApi, dt: number): void {
  r.dvis = 0;
  if (r.from !== r.to) {
    r.beatT += dt;
    const k = Math.min(1, r.beatT / r.beat);
    const vis = r.from + (r.to - r.from) * ease(k);
    r.dvis = vis - r.vis;
    r.vis = vis;
    if (k >= 1) {
      r.from = r.to;
      r.vis = r.to;
    }
  }
  if (r.from === r.to) {
    const dir = Math.sign(r.speed) || 1;
    let go = false;
    let beat = r.step / Math.abs(r.speed);
    if (r.parade === 1) {
      // Сборка моста: к ближайшему «острова на севере и юге» по ходу.
      if (atHalfTurn(r.from)) r.parade = 2;
      else {
        go = true;
        beat = r.step / ORBIT.rush;
      }
    } else if (r.parade === 2) {
      go = false;
    } else if (r.name === 'small') {
      if (atHalfTurn(r.from) && r.dockLeft > 0) r.dockLeft -= dt;
      else go = true;
    } else go = true;
    if (go) {
      // Шаг считаем целым числом шагов: на причале угол ровно кратен π.
      const n = Math.round(r.from / r.step) + dir;
      r.to = n * r.step;
      r.beatT = 0;
      r.beat = beat;
      if (r.name === 'small' && atHalfTurn(r.to)) r.dockLeft = ORBIT.dock;
    }
    retileRing(sim, r, api);
  }
  if (r.zone) r.zone.r = r.r1;
  if (!r.dvis) return;
  const h = sim.hero;
  if (!st.tether) carry(sim, r, h, r.dvis);
  for (const m of sim.mobs) if (alive(m) && !api.def(m.kind).fly) carry(sim, r, m, r.dvis);
  for (const p of sim.drops) carry(sim, r, p, r.dvis);
  if (st.tether?.ring === r) {
    const t = st.tether;
    const dx = t.x1 - r.cx;
    const dy = t.y1 - r.cy;
    const a = Math.atan2(dy, dx) + r.dvis;
    const d = hypot(dx, dy);
    t.x1 = r.cx + Math.cos(a) * d;
    t.y1 = r.cy + Math.sin(a) * d;
  }
}

function stepRings(sim: Sim, st: F15State, api: SimApi, dt: number, quiet: boolean): void {
  for (const r of st.rings) stepRing(sim, st, r, api, dt);
  // Кто стоит на клетке, ставшей пустотой, — сорвался.
  for (const m of sim.mobs) {
    if (!alive(m) || isBossKind(m.kind) || api.def(m.kind).fly || m.mode === 'emerge') continue;
    const cx = Math.floor(m.x);
    const cy = Math.floor(m.y);
    if (tileAt(sim, cx, cy) === T_DEEP && markAt(sim, cx, cy) === MK.lane) {
      api.fall(sim, m);
      say(sim, 'f15_ring_fall');
    }
  }
  if (quiet) return;
  // Парад планет: пока герой в зале — кольца собираются в мост и держат.
  const pr = st.rings.filter((r) => r.name.startsWith('p'));
  const hall = st.halls.find((x) => x.name === 'parade');
  if (!pr.length || !hall) return;
  const h = sim.hero;
  const inside = h.x >= hall.x0 - 1 && h.x <= hall.x1 + 2 && h.y >= hall.y0 - 3 && h.y <= hall.y1 + 6;
  const d = hall.data;
  const state = d.state ?? 0;
  if (state === 0 && inside && sim.time >= (d.cdAt ?? 0)) {
    d.state = 1;
    for (const r of pr) r.parade = 1;
    const first = hall.n === 0;
    say(sim, first ? 'f15_parade_trap' : 'f15_parade_call', 'ПАРАД ПЛАНЕТ', 'кольца выстраиваются в мост');
    if (first) {
      hall.n = 1;
      for (let i = 0; i < 2; i++) {
        const a = -Math.PI / 2 + (i - 0.5) * 1.6;
        const m = api.spawnMob(sim, 'f15_moon', pr[0].cx + Math.cos(a) * 9, pr[0].cy + Math.sin(a) * 9, {
          mode: 'chase',
        });
        hall.ids.push(m.id);
      }
    }
  } else if (state === 1 && pr.every((r) => r.parade === 2)) {
    d.state = 2;
    d.until = sim.time + ORBIT.hold;
    say(sim, 'f15_bridge');
  } else if (state === 2 && sim.time >= (d.until ?? 0)) {
    d.state = 0;
    d.cdAt = sim.time + ORBIT.cd;
    for (const r of pr) r.parade = 0;
    say(sim, 'f15_parade_end');
  }
}

/** Ближний остров для троса якоря. */
function anchorTarget(st: F15State, obj: WorldObj): { x: number; y: number; ring: Ring } | null {
  const ax = obj.x + 0.5;
  const ay = obj.y + 0.5;
  let best: { x: number; y: number; ring: Ring } | null = null;
  let bd = ORBIT.anchorR;
  for (const r of st.rings) {
    if (hypot(r.cx - ax, r.cy - ay) > r.r1 + ORBIT.anchorR) continue;
    const mid = (r.r0 + r.r1) / 2;
    for (const c of r.cells) {
      if (!r.floor[c.i]) continue;
      // Середина острова по толщине, а не край.
      const d = hypot(c.x + 0.5 - ax, c.y + 0.5 - ay);
      const rr = hypot(c.x + 0.5 - r.cx, c.y + 0.5 - r.cy);
      const s = d + (Math.abs(rr - mid) < 0.9 ? 0 : 0.8);
      if (d > 1.4 && s < bd) {
        bd = s;
        best = { x: c.x + 0.5, y: c.y + 0.5, ring: r };
      }
    }
  }
  return best;
}

function stepTether(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const t = st.tether;
  if (!t) return;
  const h = sim.hero;
  t.t += dt;
  const k = Math.min(1, t.t / t.T);
  const e = ease(k);
  h.x = t.x0 + (t.x1 - t.x0) * e;
  h.y = t.y0 + (t.y1 - t.y0) * e;
  h.vx = 0;
  h.vy = 0;
  h.inv = Math.max(h.inv, 0.15);
  st.hv = [0, 0];
  if (k >= 1) {
    st.tether = null;
    if (tileAt(sim, Math.floor(h.x), Math.floor(h.y)) === T_DEEP) fallHero(sim, st, api, 'трос не достал — 8%');
  }
}

// ---------------------------------------------------------------------------
// Свет: лампы, кристаллы памяти; звёздная дверь, телескопы, рычаги.
// ---------------------------------------------------------------------------

export const LAMP = { r: 3.8, safe: 3.4 };

function setLamp(sim: Sim, l: Lamp, api: SimApi, lit: boolean): void {
  l.lit = lit;
  l.t = sim.time;
  api.light(sim, `f15_lamp:${l.obj.id}`, lit ? { x: l.x, y: l.y, r: LAMP.r, tint: 'cold' } : null);
}

/** Точка в свете зажжённой лампы. */
export function nearLit(sim: Sim, x: number, y: number, R = LAMP.safe): boolean {
  const st = STATE.get(sim);
  if (!st) return false;
  for (const l of st.lamps) if (l.lit && hypot(l.x - x, l.y - y) < R) return true;
  return false;
}

/** Во тьме: затмение, и рядом нет зажжённой лампы. */
export function inDark(sim: Sim, x: number, y: number): boolean {
  const st = STATE.get(sim);
  return !!st && st.dark > 0.5 && !nearLit(sim, x, y);
}

function openDoor(sim: Sim, api: SimApi, d: F15State['doors'][number]): void {
  if (d.open) return;
  d.open = true;
  const top = bandTop(sim, d.area);
  for (let x = d.x0; x <= d.x1; x++) api.setTile(sim, x, top + d.y, T_FLOOR, MK.doorOpen);
  sim.events.push({ t: 'flash', color: '#fff4c0', k: 0.6 });
  say(sim, 'f15_door', 'ЗВЁЗДНАЯ ДВЕРЬ', 'луч звезды растопил печать');
}

export const MOTIFS = ['rat', 'shroom', 'lava', 'mirror', 'sky', 'clock'];

function releaseEcho(sim: Sim, api: SimApi, mem: Mem, n = 1): number[] {
  const ids: number[] = [];
  const p = openNear(sim, mem.x + 0.5, mem.y + 1.6, 3);
  if (!p) return ids;
  for (let i = 0; i < n; i++) {
    const m = api.spawnMob(sim, 'f15_echo', p[0] + (i - (n - 1) / 2) * 0.6, p[1] + 0.2, { mode: 'f15_born' });
    m.data.motif = mem.motif;
    ids.push(m.id);
  }
  api.vfx(sim, { x: mem.x + 0.5, y: mem.y + 1, r: 1.6, life: 0.6, art: 'f15_memflash' });
  sim.events.push({ t: 'flash', color: '#d0b8ff', k: 0.35 });
  say(sim, 'f15_echo_call');
  return ids;
}

function stepMems(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const h = sim.hero;
  st.mems.forEach((mem, i) => {
    if (!mem.used && !mem.gallery && !mem.at && hypot(mem.x + 0.5 - h.x, mem.y + 1 - h.y) < 2.6)
      mem.at = sim.time + 0.8;
    if (mem.at && !mem.used) {
      mem.glow = Math.min(1, mem.glow + dt * 1.6);
      if (sim.time >= mem.at) {
        mem.used = true;
        // В Галерее каждый третий кристалл помнит двоих.
        const gal = mem.gallery ? st.halls.find((x) => x.name === 'gallery') : undefined;
        const ids = releaseEcho(sim, api, mem, gal && gal.n % 4 === 0 ? 2 : 1);
        if (gal) gal.ids.push(...ids);
      }
    } else mem.glow = Math.max(0, mem.glow - dt * 0.6);
    const key = `f15_mem:${i}`;
    if (mem.glow > 0.04)
      api.light(sim, key, { x: mem.x + 0.5, y: mem.y + 1, r: 2 + mem.glow * 3, tint: 'violet' });
    else if (sim.lightKeys.has(key)) api.light(sim, key, null);
  });
}

function stepPosts(sim: Sim, st: F15State, api: SimApi): void {
  const h = sim.hero;
  for (const p of st.posts) {
    if (p.done || hypot(p.x - h.x, p.y - h.y) > 16) continue;
    p.done = true;
    const o = openNear(sim, p.x, p.y, 2);
    if (o) api.spawnMob(sim, p.kind, o[0], o[1], { mode: 'chase' });
  }
}

// ---------------------------------------------------------------------------
// Звёздные карты: созвездие встаёт, когда ступишь на карту.
// ---------------------------------------------------------------------------

export const CONSTEL = { lashWarn: 0.9, lashW: 0.3, every: 4.6, wake: 1.2 };

function stepCharts(sim: Sim, st: F15State, api: SimApi): void {
  const h = sim.hero;
  st.charts.forEach((c, gi) => {
    if (c.state === 'sleep') {
      if (hypot(c.cx - h.x, c.cy - h.y) < c.r - 0.3) {
        c.state = 'awake';
        c.lashAt = sim.time + CONSTEL.wake + 2.2;
        c.ids = c.nodes.map(([x, y], i) => {
          const m = api.spawnMob(sim, 'f15_constel', x, y, { mode: 'f15_rise' });
          m.hx = x;
          m.hy = y;
          m.data.grp = gi;
          m.data.node = i;
          return m.id;
        });
        say(sim, 'f15_constel_trap', 'СТРАЖ СОЗВЕЗДИЯ', 'бей звёзды — линии неуязвимы');
      }
      return;
    }
    if (c.state !== 'awake') return;
    const nodes = c.ids
      .map((id) => sim.mobs.find((m) => m.id === id))
      .filter((m): m is Mob => !!m && alive(m));
    if (!nodes.length) {
      c.state = 'done';
      api.dropAt(sim, 'f15_dust', 2, c.cx, c.cy);
      api.dropAt(sim, 'f15_lens', 1, c.cx + 0.6, c.cy);
      say(sim, 'f15_constel_end', 'Созвездие погасло');
      return;
    }
    if (sim.time < c.lashAt || nodes.length < 2 || hypot(c.cx - h.x, c.cy - h.y) > c.r + 4) return;
    c.lashAt = sim.time + CONSTEL.every + sim.rng() * 1.6;
    const n = nodes.length === 2 ? 1 : nodes.length;
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      const b = nodes[(i + 1) % nodes.length];
      const len = hypot(b.x - a.x, b.y - a.y);
      if (len < 0.4) continue;
      api.strike(sim, {
        shape: 'line',
        x: a.x,
        y: a.y,
        r: len,
        w: CONSTEL.lashW,
        ang: Math.atan2(b.y - a.y, b.x - a.x),
        warn: CONSTEL.lashWarn,
        dmg: a.dmg,
        art: 'f15_lash',
        from: a.id,
      });
    }
    say(sim, 'f15_lash');
  });
}

// ---------------------------------------------------------------------------
// Залы-события.
// ---------------------------------------------------------------------------

export const EVENT = {
  awaken: { waves: 5, warn: 1.2, on: 3, off: 2.6, r: 8.5, burn: 2.6, k: 1.15, timeout: 80 },
  gallery: { every: 2.2, glow: 0.9, maxAlive: 4, timeout: 90 },
  starfall: { dur: 20, every: 0.75, warn: 1.1, r: 1.3, share: 0.12, wellR: 3, wellOn: 1.3 },
  eclipse: { max: 80, fade: 1.2 },
  storm: { cycles: 4, phase: 5, warn: 1.2, slow: 0.6 },
  hallMax: 150,
};

function hallAlive(sim: Sim, hall: Hall): number {
  let n = 0;
  for (const id of hall.ids) {
    const m = sim.mobs.find((x) => x.id === id);
    if (m && alive(m)) n++;
  }
  return n;
}

function inRect(hall: Hall, x: number, y: number, pad = 0): boolean {
  return x >= hall.x0 - pad && x <= hall.x1 + 1 + pad && y >= hall.y0 - pad && y <= hall.y1 + 1 + pad;
}

/** Моб события: из норы зала, иначе — из пола рядом с серединой. */
function hallSpawn(sim: Sim, api: SimApi, hall: Hall, kind: string, near?: [number, number]): Mob | null {
  const h = sim.hero;
  const bs = sim.burrows.filter(
    (b) => !b.sealed && inRect(hall, b.obj.x, b.obj.y, 1) && hypot(b.obj.x - h.x, b.obj.y - h.y) > 3,
  );
  let m: Mob | null = null;
  if (bs.length && !near) m = api.fromBurrow(sim, bs[Math.floor(sim.rng() * bs.length)], kind);
  else {
    const cx = near ? near[0] : (hall.x0 + hall.x1) / 2 + (sim.rng() - 0.5) * (hall.x1 - hall.x0) * 0.6;
    const cy = near ? near[1] : (hall.y0 + hall.y1) / 2 + (sim.rng() - 0.5) * (hall.y1 - hall.y0) * 0.6;
    const p = openNear(sim, cx, cy, 4);
    if (p) m = api.spawnMob(sim, kind, p[0], p[1], { mode: 'chase' });
  }
  if (m) hall.ids.push(m.id);
  return m;
}

/**
 * Кристальная печать: клетки рамки зала, через которые есть выход наружу,
 * на время события становятся стеной. Снимается в конце (или по таймауту
 * события — у каждого он есть).
 */
function sealHall(sim: Sim, hall: Hall, api: SimApi, on: boolean): void {
  const W = sim.world.w;
  if (!on) {
    for (let k = 0; k < hall.seal.length; k += 2) {
      const i = hall.seal[k];
      api.setTile(sim, i % W, Math.floor(i / W), T_FLOOR, hall.seal[k + 1]);
    }
    if (hall.seal.length) say(sim, 'f15_unseal');
    hall.seal = [];
    return;
  }
  hall.seal = [];
  const inside = (x: number, y: number) => x >= hall.x0 && x <= hall.x1 && y >= hall.y0 && y <= hall.y1;
  for (let y = hall.y0; y <= hall.y1; y++)
    for (let x = hall.x0; x <= hall.x1; x++) {
      if (x !== hall.x0 && x !== hall.x1 && y !== hall.y0 && y !== hall.y1) continue;
      if (tileAt(sim, x, y) !== T_FLOOR) continue;
      const out = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([ax, ay]) => !inside(ax, ay) && walkable(tileAt(sim, ax, ay)));
      if (out) hall.seal.push(y * W + x, markAt(sim, x, y));
    }
  for (let k = 0; k < hall.seal.length; k += 2) {
    const i = hall.seal[k];
    api.setTile(sim, i % W, Math.floor(i / W), T_WALL, MK.seal);
  }
}

function hallEnd(sim: Sim, hall: Hall, api: SimApi, drops: [string, number][], what: string, text: string): void {
  hall.state = 'done';
  sealHall(sim, hall, api, false);
  const cx = (hall.x0 + hall.x1 + 1) / 2;
  const cy = (hall.y0 + hall.y1 + 1) / 2;
  const h = sim.hero;
  // Награда — у героя, если он в зале, иначе посередине.
  const at = inRect(hall, h.x, h.y) ? openNear(sim, h.x, h.y, 3) : openNear(sim, cx, cy, 5);
  drops.forEach(([id, n], i) => {
    if (at) api.dropAt(sim, id, n, at[0] + (i - 0.5) * 0.5, at[1]);
  });
  say(sim, what, text);
}

function startHall(sim: Sim, st: F15State, hall: Hall, api: SimApi): void {
  hall.state = 'run';
  hall.t = 0;
  hall.n = 0;
  sealHall(sim, hall, api, true);
  const cx = (hall.x0 + hall.x1 + 1) / 2;
  const cy = (hall.y0 + hall.y1 + 1) / 2;
  switch (hall.name) {
    case 'awaken': {
      // Спящий большой осколок — посередине зала (клетка `d`).
      let bx = cx;
      let by = cy;
      for (const o of sim.world.objs)
        if (o.ref === 'f15_bigshard' && inRect(hall, o.x, o.y)) {
          bx = o.x + 0.5;
          by = o.y + 0.5;
        }
      const w = addWell(sim, st, api, {
        x: bx,
        y: by,
        r: EVENT.awaken.r,
        burn: EVENT.awaken.burn,
        k: EVENT.awaken.k,
        kind: 'shard',
        forced: 3,
      });
      hall.data.well = w.id;
      hall.data.ph = 0;
      hall.next = sim.time + 1.4;
      say(sim, 'f15_awaken_trap', 'ПРОБУЖДЕНИЕ ОСКОЛКА', 'осколок тянет волнами — заманивай жуков в ядро');
      break;
    }
    case 'gallery':
      hall.next = sim.time + 1.2;
      say(sim, 'f15_gallery_trap', 'ГАЛЕРЕЯ ПАМЯТИ', 'кристаллы помнят всё, что было выше');
      break;
    case 'starfall':
      hall.data.end = sim.time + EVENT.starfall.dur;
      hall.next = sim.time + 0.8;
      hallSpawn(sim, api, hall, 'f15_comet');
      hallSpawn(sim, api, hall, 'f15_comet');
      sim.events.push({ t: 'flash', color: '#c8b8ff', k: 0.5 });
      say(sim, 'f15_starfall_trap', 'ЗВЕЗДОПАД', 'купол раскрылся — звёзды падают по меткам');
      break;
    case 'eclipse':
      st.darkTo = 1;
      hall.next = sim.time + 0.6;
      if (!st.darkZone) st.darkZone = anchorZone(sim, api, cx, cy, 30, 'f15_dark', true);
      say(sim, 'f15_eclipse_trap', 'ЗАТМЕНИЕ', 'зажигай кристаллы — во тьме пожиратели неуязвимы');
      break;
    case 'storm':
      hall.next = sim.time + 1.6;
      hall.data.ph = 0;
      hall.data.cyc = 0;
      hallSpawn(sim, api, hall, 'f15_graviton');
      hallSpawn(sim, api, hall, 'f15_meteor');
      say(sim, 'f15_storm_trap', 'ГРАВИТАЦИОННЫЙ ШТОРМ', 'в тяжести бей, в невесомости сталкивай в пустоту');
      break;
  }
}

function stepAwaken(sim: Sim, st: F15State, hall: Hall, api: SimApi): void {
  const E = EVENT.awaken;
  const w = st.wells.find((x) => x.id === hall.data.well);
  if (!w) return;
  const left = hallAlive(sim, hall);
  if (hall.n >= E.waves && hall.data.ph === 0) {
    if (left === 0 || hall.t > E.timeout) {
      dropZone(sim, w.zone);
      if (w.zone) st.zmap.delete(w.zone);
      st.wells.splice(st.wells.indexOf(w), 1);
      api.light(sim, 'f15_awaken', null);
      hallEnd(sim, hall, api, [['f15_shard', 4], ['f15_memory', 1]], 'f15_awaken_end', 'Осколок уснул');
    }
    return;
  }
  api.light(sim, 'f15_awaken', { x: w.x, y: w.y, r: 4.6 + (w.state === 2 ? 3 : w.state === 1 ? 1.5 : 0), tint: 'teal' });
  if (sim.time < hall.next) return;
  if (hall.data.ph === 0) {
    hall.data.ph = 1;
    w.forced = 1;
    hall.next = sim.time + E.warn;
    // Волна: жуки лезут из стен, на третьей — сверхновая из осколка.
    const n = hall.n;
    hallSpawn(sim, api, hall, 'f15_meteor');
    if (n !== 2) hallSpawn(sim, api, hall, 'f15_meteor');
    if (n === 1) hallSpawn(sim, api, hall, 'f15_urchin');
    if (n === 3) hallSpawn(sim, api, hall, 'f15_comet');
    if (n === 2) {
      const m = hallSpawn(sim, api, hall, 'f15_nova', [w.x, w.y + 3.2]);
      if (m) api.vfx(sim, { x: m.x, y: m.y, r: 2, life: 0.8, art: 'f15_memflash' });
    }
    say(sim, 'f15_wave_call');
  } else if (hall.data.ph === 1) {
    hall.data.ph = 2;
    w.forced = 2;
    hall.next = sim.time + E.on;
    sim.events.push({ t: 'shake', k: 0.25 });
    say(sim, 'f15_pulse');
  } else {
    hall.data.ph = 0;
    w.forced = 3;
    hall.n += 1;
    hall.next = sim.time + E.off;
  }
}

function stepGallery(sim: Sim, st: F15State, hall: Hall, api: SimApi): void {
  const E = EVENT.gallery;
  const mems = st.mems.filter((m) => m.gallery);
  if (hall.n < mems.length) {
    if (sim.time >= hall.next && hallAlive(sim, hall) < E.maxAlive) {
      const mem = mems[hall.n];
      mem.at = sim.time + E.glow;
      mem.glow = Math.max(mem.glow, 0.2);
      hall.n += 1;
      hall.next = sim.time + E.every;
    }
    return;
  }
  if (mems.every((m) => m.used) && (hallAlive(sim, hall) === 0 || hall.t > E.timeout))
    hallEnd(sim, hall, api, [['f15_memory', 2], ['f15_shard', 2]], 'f15_gallery_end', 'Память улеглась');
}

function stepStarfall(sim: Sim, st: F15State, hall: Hall, api: SimApi): void {
  const E = EVENT.starfall;
  const h = sim.hero;
  if (sim.time < (hall.data.end ?? 0)) {
    if (sim.time >= hall.next) {
      hall.next = sim.time + E.every * (0.8 + sim.rng() * 0.4);
      const cx = (hall.x0 + hall.x1 + 1) / 2;
      const cy = (hall.y0 + hall.y1 + 1) / 2;
      let p: [number, number] | null = null;
      for (let i = 0; i < 6 && !p; i++) {
        const nearHero = sim.rng() < 0.55 && inRect(hall, h.x, h.y);
        const a = sim.rng() * TAU;
        const r = nearHero ? sim.rng() * 2.4 : sim.rng() * 11;
        const x = (nearHero ? h.x : cx) + Math.cos(a) * r;
        const y = (nearHero ? h.y : cy) + Math.sin(a) * r;
        if (tileAt(sim, Math.floor(x), Math.floor(y)) === T_FLOOR) p = [x, y];
      }
      if (p) {
        api.strike(sim, {
          shape: 'circle',
          x: p[0],
          y: p[1],
          r: E.r,
          warn: E.warn,
          dmg: rawShare(sim, E.share),
          knock: 4,
          art: 'f15_star',
          mobDmg: 0,
        });
        st.stars.push({ x: p[0], y: p[1], at: sim.time + E.warn, key: `f15_star:${st.nextId++}` });
      }
    }
    if (hall.t > 8 && !hall.data.astro) {
      hall.data.astro = 1;
      hallSpawn(sim, api, hall, 'f15_astro');
      hallSpawn(sim, api, hall, 'f15_astro');
    }
    return;
  }
  if (!st.stars.length && (hallAlive(sim, hall) === 0 || hall.t > E.dur + 30))
    hallEnd(sim, hall, api, [['f15_dust', 3], ['f15_shard', 2]], 'f15_starfall_end', 'Небо закрылось');
}

/** Падающие звёзды: свет летит с ними, упавшая на миг становится колодцем. */
function stepStars(sim: Sim, st: F15State, api: SimApi): void {
  const W = EVENT.starfall.warn;
  for (let i = st.stars.length - 1; i >= 0; i--) {
    const s = st.stars[i];
    const k = clamp(1 - (s.at - sim.time) / W, 0, 1);
    if (sim.time < s.at) {
      api.light(sim, s.key, { x: s.x - (1 - k) * 2, y: s.y - (1 - k) * 7, r: 1.6 + k * 1.4, tint: 'warm' });
      continue;
    }
    api.light(sim, s.key, null);
    tempWell(sim, st, api, s.x, s.y, EVENT.starfall.wellR, 0.05, EVENT.starfall.wellOn, 'star', { burn: 0.6 });
    api.vfx(sim, { x: s.x, y: s.y, r: 1.8, life: 0.5, art: 'f15_starland' });
    sim.events.push({ t: 'shake', k: 0.12 });
    st.stars.splice(i, 1);
  }
}

function endEclipse(sim: Sim, st: F15State, hall: Hall, api: SimApi, sun: boolean): void {
  st.darkTo = 0;
  if (sun) {
    sim.events.push({ t: 'flash', color: '#fff4d0', k: 0.9 });
    api.light(sim, 'f15_sun', { x: (hall.x0 + hall.x1) / 2, y: (hall.y0 + hall.y1) / 2, r: 14, tint: 'warm' });
    hall.data.sunOff = sim.time + 2.5;
  }
  hallEnd(
    sim,
    hall,
    api,
    [['f15_void', 2], ['f15_lens', 1]],
    'f15_eclipse_end',
    sun ? 'Солнце вернулось' : 'Затмение прошло',
  );
}

function stepEclipse(sim: Sim, st: F15State, hall: Hall, api: SimApi): void {
  if (hall.t > EVENT.eclipse.max) {
    endEclipse(sim, st, hall, api, false);
    return;
  }
  const n = hall.data.spawned ?? 0;
  const at = [0.6, 4.5, 9.5, 6, 6.2];
  if (n < at.length && hall.t >= at[n]) {
    hall.data.spawned = n + 1;
    hallSpawn(sim, api, hall, n < 3 ? 'f15_devourer' : 'f15_comet');
  }
}

function stepStorm(sim: Sim, st: F15State, hall: Hall, api: SimApi): void {
  const E = EVENT.storm;
  const cx = (hall.x0 + hall.x1 + 1) / 2;
  const cy = (hall.y0 + hall.y1 + 1) / 2;
  const ph = hall.data.ph ?? 0;
  if ((hall.data.cyc ?? 0) >= E.cycles) {
    st.storm = 0;
    st.stormWarn = 0;
    if (hallAlive(sim, hall) === 0 || hall.t > E.cycles * E.phase * 2 + 30)
      hallEnd(sim, hall, api, [['f15_void', 2], ['f15_meteorite', 2]], 'f15_storm_end', 'Ядро стихло');
    return;
  }
  if (sim.time < hall.next) return;
  // 0 → предупредить о тяжести → 1 тяжесть → 2 предупредить о невесомости → 3 невесомость.
  if (ph === 0) {
    hall.data.ph = 1;
    st.stormWarn = 1;
    hall.next = sim.time + E.warn;
    api.vfx(sim, { x: cx, y: cy, r: 26, life: E.warn, art: 'f15_stormwarn' });
    say(sim, 'f15_heavy_call', 'ТЯЖЕСТЬ', 'медленнее, но удар тяжелее');
  } else if (ph === 1) {
    hall.data.ph = 2;
    st.storm = 1;
    st.stormWarn = 0;
    hall.next = sim.time + E.phase;
    api.zone(sim, { x: cx, y: cy, r: 27, life: E.phase, slow: E.slow, art: 'f15_heavyall' });
  } else if (ph === 2) {
    hall.data.ph = 3;
    st.storm = 0;
    st.stormWarn = 2;
    hall.next = sim.time + E.warn;
    api.vfx(sim, { x: cx, y: cy, r: 26, life: E.warn, art: 'f15_stormwarn' });
    say(sim, 'f15_float_call', 'НЕВЕСОМОСТЬ', 'не затормозить — сталкивай врагов в пустоту');
  } else {
    hall.data.ph = 0;
    st.storm = 2;
    st.stormWarn = 0;
    hall.next = sim.time + E.phase;
    const c = (hall.data.cyc ?? 0) + 1;
    hall.data.cyc = c;
    if (c === 1) {
      hallSpawn(sim, api, hall, 'f15_meteor');
      hallSpawn(sim, api, hall, 'f15_meteor');
    } else if (c === 2) {
      hallSpawn(sim, api, hall, 'f15_comet');
      hallSpawn(sim, api, hall, 'f15_graviton');
    }
    // Последняя невесомость кончится — шторм стих.
    if (c >= E.cycles) hall.next = sim.time + E.phase;
  }
}

function stepHalls(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const h = sim.hero;
  for (const hall of st.halls) {
    if (hall.state === 'idle') {
      if (hall.name !== 'parade' && inRect(hall, h.x, h.y, -1) && !heroDown(sim)) startHall(sim, st, hall, api);
      continue;
    }
    if (hall.state !== 'run') {
      if (hall.data.sunOff && sim.time >= hall.data.sunOff) {
        hall.data.sunOff = 0;
        api.light(sim, 'f15_sun', null);
      }
      continue;
    }
    hall.t += dt;
    // Страховка: печать не держит дольше двух с половиной минут.
    if (hall.t > EVENT.hallMax) {
      if (hall.name === 'eclipse') endEclipse(sim, st, hall, api, false);
      else {
        if (hall.name === 'storm') st.storm = st.stormWarn = 0;
        hallEnd(sim, hall, api, [['f15_shard', 2]], `f15_${hall.name}_end`, 'Печать спала');
      }
      continue;
    }
    if (hall.name === 'awaken') stepAwaken(sim, st, hall, api);
    else if (hall.name === 'gallery') stepGallery(sim, st, hall, api);
    else if (hall.name === 'starfall') stepStarfall(sim, st, hall, api);
    else if (hall.name === 'eclipse') stepEclipse(sim, st, hall, api);
    else if (hall.name === 'storm') stepStorm(sim, st, hall, api);
  }
  // Затмение наплывает и уходит.
  const k = dt / EVENT.eclipse.fade;
  st.dark = st.darkTo > st.dark ? Math.min(st.darkTo, st.dark + k) : Math.max(st.darkTo, st.dark - k);
  if (st.dark <= 0 && st.darkZone) {
    dropZone(sim, st.darkZone);
    st.darkZone = null;
  }
}

// ---------------------------------------------------------------------------
// Сбор состояния вылазки из карты и мест.
// ---------------------------------------------------------------------------

function scan(sim: Sim, api: SimApi): F15State {
  const st: F15State = {
    wells: [],
    rings: [],
    fshots: [],
    mems: [],
    lamps: [],
    charts: [],
    halls: [],
    posts: [],
    stars: [],
    doors: [],
    scopes: [],
    arcs: new Map(),
    zmap: new Map(),
    swing: null,
    hv: [0, 0],
    floating: false,
    safe: [sim.hero.x, sim.hero.y],
    safeT: 0,
    kick: [0, 0],
    tether: null,
    dark: 0,
    darkTo: 0,
    darkZone: null,
    storm: 0,
    stormWarn: 0,
    nextId: 1,
    slips: 0,
    parries: 0,
    crushed: 0,
  };
  STATE.set(sim, st);
  const w = sim.world;
  const has = (area: string) => w.bands.some((b) => b.def.id === area);
  for (const s of F15_SPOT_LIST) {
    if (!has(s.area)) continue;
    const top = bandTop(sim, s.area);
    const n = (i: number) => spotNum(s, i);
    switch (s.kind) {
      case 'well':
        addWell(sim, st, api, {
          x: n(0) + 0.5,
          y: top + n(1) + 0.5,
          r: n(2),
          burn: n(3),
          period: n(4),
          phase: n(5),
          kind: 'map',
        });
        break;
      case 'ring': {
        const cx = n(0);
        const cy = top + n(1);
        const r0 = n(2);
        const r1 = n(3);
        const rm = (r0 + r1) / 2;
        const K = Math.max(4, Math.round(Math.PI * rm));
        const ring: Ring = {
          name: s.args[7],
          area: s.area,
          cx,
          cy,
          r0,
          r1,
          n: n(4),
          speed: n(5),
          width: n(6),
          half: n(6) / 2 / rm,
          step: Math.PI / K,
          cells: ringCells(cx, cy, r0, r1),
          from: 0,
          to: 0,
          beatT: 0,
          beat: 1,
          vis: 0,
          dvis: 0,
          dockLeft: ORBIT.dock,
          floor: new Uint8Array(0),
          zone: null,
          parade: 0,
        };
        ring.floor = new Uint8Array(ring.cells.length);
        for (const c of ring.cells) ring.floor[c.i] = sim.tiles[c.y * w.w + c.x] === T_FLOOR ? 1 : 0;
        // Парад на старте разобран: мост сложится, когда придёшь.
        if (ring.name.startsWith('p')) {
          const off = Math.round(K * (0.3 + 0.2 * st.rings.length));
          ring.from = ring.to = ring.vis = off * ring.step * Math.sign(ring.speed);
        }
        retileRing(sim, ring, api);
        ring.zone = anchorZone(sim, api, cx, cy, r1, 'f15_ring');
        st.zmap.set(ring.zone, ring);
        st.rings.push(ring);
        break;
      }
      case 'hall':
        st.halls.push({
          name: s.args[4],
          area: s.area,
          x0: n(0),
          y0: top + n(1),
          x1: n(2),
          y1: top + n(3),
          state: 'idle',
          t: 0,
          n: 0,
          next: 0,
          ids: [],
          data: {},
          seal: [],
        });
        break;
      case 'mem':
        st.mems.push({
          x: n(0),
          y: top + n(1),
          area: s.area,
          motif: Math.max(0, MOTIFS.indexOf(s.args[2])),
          used: false,
          glow: 0,
          at: 0,
          gallery: false,
        });
        break;
      case 'post': {
        const [px, py] = spotXY(sim, s.area, n(0), n(1));
        st.posts.push({ x: px + 0.5, y: py + 0.5, kind: s.args[2], done: false });
        break;
      }
      case 'chart': {
        const cx = n(0) + 0.5;
        const cy = top + n(1) + 0.5;
        const r = n(2);
        const nodes: [number, number][] = [];
        for (let y = Math.floor(cy - r); y <= cy + r; y++)
          for (let x = Math.floor(cx - r); x <= cx + r; x++)
            if (markAt(sim, x, y) === MK.node) nodes.push([x + 0.5, y + 0.5]);
        // Узлы — по кругу: линии фигуры идут от соседа к соседу.
        nodes.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
        const chart: Chart = { area: s.area, cx, cy, r, nodes, state: 'sleep', lashAt: 0, ids: [], zone: null };
        chart.zone = anchorZone(sim, api, cx, cy, r, 'f15_figure');
        st.zmap.set(chart.zone, chart);
        st.charts.push(chart);
        break;
      }
      case 'door':
        st.doors.push({ area: s.area, x0: n(0), y: n(1), x1: n(2), open: false, at: 0 });
        break;
      case 'scope': {
        const x = n(0);
        const y = top + n(1);
        const obj = w.objs.find((o) => o.ref === 'f15_telescope' && o.x === x && o.y === y) ?? null;
        st.scopes.push({ obj, x: x + 0.5, y: y + 0.5, what: s.args[2] });
        break;
      }
    }
  }
  const gal = st.halls.find((x) => x.name === 'gallery');
  if (gal) for (const m of st.mems) if (inRect(gal, m.x, m.y, 1)) m.gallery = true;
  for (const o of w.objs)
    if (o.ref === 'f15_lamp') st.lamps.push({ obj: o, x: o.x + 0.5, y: o.y + 0.5, lit: false, t: -9 });
  // Звёздные двери закрыты, пока телескоп не наведён.
  for (const d of st.doors) {
    const top = bandTop(sim, d.area);
    for (let x = d.x0; x <= d.x1; x++) api.setTile(sim, x, top + d.y, T_WALL, MK.door);
  }
  return st;
}

// ---------------------------------------------------------------------------
// Действия этажа: лампа, рычаг, телескоп, якорь.
// ---------------------------------------------------------------------------

function labelOf(sim: Sim, obj: WorldObj): string | null {
  const st = STATE.get(sim);
  if (!st) return null;
  switch (obj.ref) {
    case 'f15_lamp': {
      const l = st.lamps.find((x) => x.obj === obj);
      return l && !l.lit ? 'Зажечь кристалл' : null;
    }
    case 'f15_lever': {
      const w = leverWells(st, obj)[0];
      if (!w) return null;
      return w.mode > 0 ? 'Колодцы: толкать' : 'Колодцы: тянуть';
    }
    case 'f15_telescope': {
      const s = st.scopes.find((x) => x.obj === obj);
      if (!s) return null;
      if (s.what === 'door') return st.doors.some((d) => !d.open && !d.at) ? 'Навести телескоп' : null;
      const ec = st.halls.find((x) => x.name === 'eclipse');
      return ec?.state === 'run' ? 'Вернуть солнце' : null;
    }
    case 'f15_anchor':
      return !st.tether && anchorTarget(st, obj) ? 'Зацепиться' : null;
  }
  return obj.use?.label ?? null;
}

function leverWells(st: F15State, obj: WorldObj): Well[] {
  return st.wells
    .filter((w) => w.kind === 'map' && hypot(w.x - obj.x - 0.5, w.y - obj.y - 0.5) < 22)
    .sort((a, b) => hypot(a.x - obj.x, a.y - obj.y) - hypot(b.x - obj.x, b.y - obj.y));
}

function onUse(sim: Sim, obj: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim, api);
  if (!labelOf(sim, obj)) return false;
  const h = sim.hero;
  switch (obj.ref) {
    case 'f15_lamp': {
      const l = st.lamps.find((x) => x.obj === obj);
      if (!l) return false;
      setLamp(sim, l, api, true);
      api.vfx(sim, { x: l.x, y: l.y, r: 1.4, life: 0.5, art: 'f15_spark' });
      say(sim, 'f15_lamp');
      return true;
    }
    case 'f15_lever': {
      const ws = leverWells(st, obj);
      const to = ws[0].mode > 0 ? -1 : 1;
      for (const w of ws) w.mode = to;
      say(sim, 'f15_lever', to > 0 ? 'КОЛОДЦЫ ТЯНУТ' : 'КОЛОДЦЫ ТОЛКАЮТ', to > 0 ? 'ядро зовёт к себе' : 'снаряды врагов отводит прочь');
      return true;
    }
    case 'f15_telescope': {
      const s = st.scopes.find((x) => x.obj === obj);
      if (!s) return false;
      if (s.what === 'door') {
        const d = st.doors.find((x) => !x.open && !x.at);
        if (!d) return false;
        d.at = sim.time + 1.1;
        const dx = (d.x0 + d.x1 + 1) / 2;
        const dy = bandTop(sim, d.area) + d.y + 0.5;
        api.vfx(sim, { x: dx, y: dy, r: 2.2, life: 1.4, art: 'f15_beam', above: true });
        api.camera(sim, dx, dy, 1.8);
        say(sim, 'f15_scope', 'СОЗВЕЗДИЕ КЛЮЧА', 'звёздный луч упал на дверь');
        return true;
      }
      const ec = st.halls.find((x) => x.name === 'eclipse');
      if (ec?.state !== 'run') return false;
      api.vfx(sim, { x: h.x, y: h.y - 2, r: 3, life: 1.2, art: 'f15_beam', above: true });
      say(sim, 'f15_sun');
      endEclipse(sim, st, ec, api, true);
      return true;
    }
    case 'f15_anchor': {
      const t = anchorTarget(st, obj);
      if (!t) return false;
      const d = hypot(t.x - h.x, t.y - h.y);
      st.tether = {
        x0: h.x,
        y0: h.y,
        x1: t.x,
        y1: t.y,
        ax: obj.x + 0.5,
        ay: obj.y + 0.5,
        t: 0,
        T: Math.max(0.25, d / ORBIT.anchorV),
        ring: t.ring,
      };
      // Картинка троса (только рисунок, номер зоны отрицательный).
      api.vfx(sim, { x: obj.x + 0.5, y: obj.y + 0.5, r: d + 1, life: st.tether.T + 0.05, art: 'f15_tether' });
      say(sim, 'f15_anchor');
      return true;
    }
  }
  return false;
}

function stepDoors(sim: Sim, st: F15State, api: SimApi): void {
  for (const d of st.doors) if (!d.open && d.at && sim.time >= d.at) openDoor(sim, api, d);
}

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

let API_REF: SimApi | null = null;

function stateOf(sim: Sim, api?: SimApi): F15State {
  const st = STATE.get(sim);
  if (st) return st;
  return scan(sim, (api ?? API_REF)!);
}

registerFloor(15, {
  start(sim, api) {
    API_REF = api;
    STATE.delete(sim);
    scan(sim, api);
  },
  step(sim, dt, api) {
    API_REF = api;
    const st = stateOf(sim, api);
    F15_FX.clock += dt;
    F15_FX.st = st;
    F15_FX.sim = sim;
    // В районе «Сердца» и в бою с боссом этаж молчит: колодцы не тянут,
    // события не начинаются (острова и отбитые снаряды доживают своё).
    const quiet = sim.area === HEART || sim.boss?.state === 'fight';
    stepWells(sim, st, api, dt, quiet);
    stepRings(sim, st, api, dt, quiet);
    stepTether(sim, st, api, dt);
    stepParry(sim, st, api, dt);
    if (!quiet) {
      stepHeroGravity(sim, st, api, dt);
      stepMobGravity(sim, st, api, dt);
    }
    stepStars(sim, st, api);
    stepMems(sim, st, api, dt);
    stepDoors(sim, st, api);
    // Дуги комет живут, пока комета в рывке.
    for (const [id, a] of st.arcs) {
      a.t += dt;
      if (a.t > a.T + 0.6) {
        dropZone(sim, a.zone);
        if (a.zone) st.zmap.delete(a.zone);
        st.arcs.delete(id);
      }
    }
    if (heroDown(sim) || quiet) return;
    stepPosts(sim, st, api);
    stepCharts(sim, st, api);
    stepHalls(sim, st, api, dt);
  },
  onUse,
  useLabel: labelOf,
});

// ---------------------------------------------------------------------------
// ИИ монстров. Общее: обёртка тяжести, погоня с фланга, укус конусом,
// удар на бегу.
// ---------------------------------------------------------------------------

/** Тяжесть замедляет моба (не летуна); удар героя из тяжести — ×1,4. */
function grav(b: Brain): Brain {
  return {
    ...b,
    step(sim, m, dt, c, api) {
      if (m.data.tvx !== undefined) {
        m.vx = m.data.tvx;
        m.vy = m.data.tvy ?? 0;
        delete m.data.tvx;
        delete m.data.tvy;
      }
      m.tele = null;
      m.danger = 0;
      b.step(sim, m, dt, c, api);
      if (!c.def.fly && heavyAt(sim, m.x, m.y)) {
        m.data.tvx = m.vx;
        m.data.tvy = m.vy;
        m.vx *= HEAVY.mobK;
        m.vy *= HEAVY.mobK;
      }
    },
    onHit(sim, m, hit, api) {
      let k = b.onHit ? (b.onHit(sim, m, hit, api) ?? 1) : 1;
      if (k > 0 && heavyAt(sim, sim.hero.x, sim.hero.y)) k *= HEAVY.hitK;
      return k;
    },
  };
}

const brain = (id: string, b: Brain) => registerBrain(id, grav(b));

function chase(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi, k = 1): void {
  const h = sim.hero;
  let tx = h.x;
  let ty = h.y;
  if (!m.rush && c.dist > 1.6) {
    const side = ((m.id * 2.399) % TAU) - Math.PI;
    const r = Math.min(1.4, c.dist * 0.35);
    tx += Math.cos(side) * r;
    ty += Math.sin(side) * r;
  }
  const [cx, cy] = api.chaseDir(sim, m, tx, ty);
  api.steer(sim, m, cx, cy, m.speed * k * (c.dist < 1.4 ? 0.6 : 1), dt);
  m.face = Math.atan2(c.dy, c.dx);
}

interface BiteOpts {
  T: number;
  arc?: number;
  reach?: number;
  dmg?: number;
  push?: number;
  status?: { kind: StatusKind; dur: number };
  next?: string;
}

/**
 * Замах и укус конусом: метка растёт весь замах (направление ловит героя
 * первую треть), опасность — последние 0,24 с. `true` — в миг удара.
 */
function bite(sim: Sim, m: Mob, c: BrainCtx, api: SimApi, o: BiteOpts): boolean {
  const h = sim.hero;
  const arc = o.arc ?? 1.3;
  const R = (o.reach ?? c.def.reach) + m.r;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t < o.T * 0.35) m.face = Math.atan2(c.dy, c.dx);
  m.tele = { shape: 'cone', r: R + 0.3, ang: m.face, arc, k: clamp(m.t / o.T, 0, 1) };
  if (m.t > o.T - 0.24) m.danger = R + h.r + 0.2;
  if (m.t < o.T) return false;
  const off = Math.abs(angDiff(Math.atan2(c.dy, c.dx), m.face));
  if (c.dist < R + h.r + 0.15 && off < arc / 2 + 0.25 && canHurt(sim))
    api.hurtHero(sim, o.dmg ?? m.dmg, m.x, m.y, o.push ?? c.def.hit?.push ?? 2, m.kind, o.status);
  m.vx += Math.cos(m.face) * 3;
  m.vy += Math.sin(m.face) * 3;
  m.cd = c.def.rest * (0.8 + sim.rng() * 0.4);
  api.setMode(m, o.next ?? 'recover');
  return true;
}

/** Удар на бегу (таран, качение, пике) — один раз за рывок. */
function contact(sim: Sim, m: Mob, api: SimApi, dmg: number, push: number): void {
  const h = sim.hero;
  m.danger = m.r + h.r + 0.5;
  if (m.data.hit) return;
  if (hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.12 && canHurt(sim)) {
    m.data.hit = 1;
    api.hurtHero(sim, dmg, m.x - m.vx * 0.05, m.y - m.vy * 0.05, push, m.kind);
  }
}

/** Колодец, который сейчас тянет над этой точкой. */
function pullingWell(sim: Sim, x: number, y: number): Well | null {
  const w = wellNear(sim, x, y, 0, true);
  return w && w.state === 2 ? w : null;
}

const seeHero = (sim: Sim, m: Mob, api: SimApi) => api.lineOfSight(sim, m.x, m.y, sim.hero.x, sim.hero.y);

// ---------------------------------------------------------------------------
// Кристальный ёж: сворачивается (линия), катится 8 кл/с с отскоком от стен,
// у колодца путь гнётся; о две стены — оглушён; раскрывшись — веер игл.
// ---------------------------------------------------------------------------

export const URCHIN = { curl: 0.6, roll: 8, rollT: 1.5, open: 0.55, dizzy: 1.1, see: 6.5, rollK: 0.75 };

brain('f15_urchin', {
  step(sim, m, dt, c, api) {
    m.bounce = m.mode === 'f15_roll';
    switch (m.mode) {
      case 'chase':
        if (c.dist < URCHIN.see && c.dist > 1.3 && m.cd <= 0 && seeHero(sim, m, api)) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f15_curl');
          return;
        }
        if (c.dist < c.def.reach + m.r + sim.hero.r + 0.2 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        chase(sim, m, dt, c, api);
        return;
      case 'windup':
        bite(sim, m, c, api, { T: c.def.windup, arc: 1.4 });
        return;
      case 'f15_curl': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < URCHIN.curl * 0.5) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        const len = clearDist(sim, api, m.x, m.y, m.dir, 7);
        m.tele = { shape: 'line', r: len, w: 0.45, ang: m.dir, k: clamp(m.t / URCHIN.curl, 0, 1) };
        if (m.t > URCHIN.curl - 0.24) m.danger = 1.3;
        if (m.t >= URCHIN.curl) {
          m.data.hit = 0;
          m.bounces = 0;
          m.vx = Math.cos(m.dir) * URCHIN.roll;
          m.vy = Math.sin(m.dir) * URCHIN.roll;
          api.setMode(m, 'f15_roll');
        }
        return;
      }
      case 'f15_roll': {
        const w = pullingWell(sim, m.x, m.y);
        if (w) bendShot(m, w, dt);
        const sp = hypot(m.vx, m.vy) || 1;
        m.vx = (m.vx / sp) * URCHIN.roll;
        m.vy = (m.vy / sp) * URCHIN.roll;
        m.dir = Math.atan2(m.vy, m.vx);
        m.face = m.dir;
        contact(sim, m, api, m.dmg * URCHIN.rollK, 3);
        if (m.t > URCHIN.rollT) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f15_open');
        }
        return;
      }
      case 'f15_dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > URCHIN.dizzy) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f15_open');
        }
        return;
      case 'f15_open': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < URCHIN.open * 0.5) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: 4.5, ang: m.dir, arc: 1.1, k: clamp(m.t / URCHIN.open, 0, 1) };
        if (m.t >= URCHIN.open) {
          api.shoot(sim, m, m.dir);
          m.cd = c.def.rest * 2.2;
          api.setMode(m, 'recover');
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
  onWall(sim, m, nx, ny, api) {
    if (m.mode !== 'f15_roll') return;
    const l = hypot(nx, ny) || 1;
    const ux = nx / l;
    const uy = ny / l;
    const d = m.vx * ux + m.vy * uy;
    if (d < 0) {
      m.vx -= 2 * d * ux;
      m.vy -= 2 * d * uy;
    }
    m.bounces += 1;
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    if (m.bounces >= 2) {
      m.vx *= 0.2;
      m.vy *= 0.2;
      api.setMode(m, 'f15_dizzy');
    }
  },
  onHit(_sim, m) {
    return m.mode === 'f15_roll' ? 0.5 : m.mode === 'f15_dizzy' ? 1.5 : 1;
  },
});

// ---------------------------------------------------------------------------
// Метеор-жук: прицел линией, таран; у тянущего колодца таран заворачивает.
// О стену — оглушён и открыт (×1,6).
// ---------------------------------------------------------------------------

export const METEOR = { aim: 0.8, speed: 9.5, maxT: 1.3, dizzy: 1.4, see: 7 };

brain('f15_meteor', {
  step(sim, m, dt, c, api) {
    m.bounce = m.mode === 'f15_charge';
    switch (m.mode) {
      case 'chase':
        if (c.dist < METEOR.see && c.dist > 1.5 && m.cd <= 0 && seeHero(sim, m, api)) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'aim');
          return;
        }
        if (c.dist < c.def.reach + m.r + sim.hero.r + 0.2 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        chase(sim, m, dt, c, api);
        return;
      case 'windup':
        bite(sim, m, c, api, { T: c.def.windup, arc: 1.5 });
        return;
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < METEOR.aim * 0.55) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        const len = clearDist(sim, api, m.x, m.y, m.dir, 10);
        m.tele = { shape: 'line', r: len, w: 0.85, ang: m.dir, k: clamp(m.t / METEOR.aim, 0, 1) };
        if (m.t > METEOR.aim - 0.24) m.danger = 1.6;
        if (m.t >= METEOR.aim) {
          m.data.hit = 0;
          api.setMode(m, 'f15_charge');
        }
        return;
      }
      case 'f15_charge': {
        const w = pullingWell(sim, m.x, m.y);
        if (w) {
          const s = { x: m.x, y: m.y, vx: Math.cos(m.dir), vy: Math.sin(m.dir) };
          bendShot(s, w, dt);
          m.dir = Math.atan2(s.vy, s.vx);
        }
        m.vx = Math.cos(m.dir) * METEOR.speed;
        m.vy = Math.sin(m.dir) * METEOR.speed;
        m.face = m.dir;
        contact(sim, m, api, m.dmg, c.def.hit?.push ?? 5);
        if (m.t > METEOR.maxT) {
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f15_dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > METEOR.dizzy) {
          m.cd = c.def.rest;
          api.setMode(m, 'chase');
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.7);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'f15_charge') return;
    m.vx = 0;
    m.vy = 0;
    sim.events.push({ t: 'shake', k: 0.18 });
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    say(sim, 'f15_bonk');
    api.setMode(m, 'f15_dizzy');
  },
  onHit(_sim, m) {
    return m.mode === 'f15_dizzy' ? 1.6 : 1;
  },
});

// ---------------------------------------------------------------------------
// Комета-гончая: у колодца рывок по дуге вокруг него — заходит сбоку; дуга
// видна весь замах. Без колодца — прямой выпад по линии.
// ---------------------------------------------------------------------------

export const COMET = { aim: 0.55, dash: 12, range: 6, lunge: 4.8, over: 1.25 };

function arcPoint(a: Arc, s: number): [number, number] {
  const r = a.R + (a.R1 - a.R) * Math.min(1, s);
  const ang = a.a0 + angDiff(a.a1, a.a0) * s;
  return [a.cx + Math.cos(ang) * r, a.cy + Math.sin(ang) * r];
}

brain('f15_comet', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const st = stateOf(sim, api);
    switch (m.mode) {
      case 'chase': {
        if (c.dist < COMET.range && c.dist > 1.4 && m.cd <= 0 && seeHero(sim, m, api)) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.data.arc = 0;
          const w = wellNear(sim, m.x, m.y, 4);
          if (w) {
            const R0 = hypot(m.x - w.x, m.y - w.y);
            const R1 = hypot(h.x - w.x, h.y - w.y);
            const a0 = Math.atan2(m.y - w.y, m.x - w.x);
            const a1 = Math.atan2(h.y - w.y, h.x - w.x);
            if (Math.abs(angDiff(a1, a0)) > 0.45 && R0 > 1.2 && R1 > 1.2) {
              const arc: Arc = { id: m.id, cx: w.x, cy: w.y, R: R0, R1, a0, a1, t: 0, aim: COMET.aim, T: 0, zone: null };
              const len = Math.abs(angDiff(a1, a0)) * (R0 + R1) * 0.5 * COMET.over + Math.abs(R1 - R0);
              arc.T = COMET.aim + len / COMET.dash;
              arc.zone = anchorZone(sim, api, w.x, w.y, Math.max(R0, R1) + 1, 'f15_arc');
              st.zmap.set(arc.zone, arc);
              const old = st.arcs.get(m.id);
              if (old) {
                dropZone(sim, old.zone);
                if (old.zone) st.zmap.delete(old.zone);
              }
              st.arcs.set(m.id, arc);
              m.data.arc = 1;
            }
          }
          api.setMode(m, 'aim');
          return;
        }
        chase(sim, m, dt, c, api);
        return;
      }
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const k = clamp(m.t / COMET.aim, 0, 1);
        if (m.data.arc) {
          m.tele = { shape: 'circle', r: 0.55, k };
          m.face = Math.atan2(c.dy, c.dx);
        } else {
          if (m.t < COMET.aim * 0.5) m.dir = Math.atan2(c.dy, c.dx);
          m.face = m.dir;
          const len = Math.min(COMET.lunge, clearDist(sim, api, m.x, m.y, m.dir, COMET.lunge));
          m.tele = { shape: 'line', r: len, w: 0.5, ang: m.dir, k };
        }
        if (m.t > COMET.aim - 0.24) m.danger = 1.2;
        if (m.t >= COMET.aim) {
          m.data.hit = 0;
          api.setMode(m, 'f15_dash');
        }
        return;
      }
      case 'f15_dash': {
        const a = m.data.arc ? st.arcs.get(m.id) : undefined;
        if (a) {
          const dur = a.T - a.aim;
          const s = (m.t / dur) * COMET.over;
          const [px, py] = arcPoint(a, s);
          const vx = (px - m.x) / Math.max(dt, 1e-3);
          const vy = (py - m.y) / Math.max(dt, 1e-3);
          const v = hypot(vx, vy);
          const cap = COMET.dash * 1.6;
          m.vx = v > cap ? (vx / v) * cap : vx;
          m.vy = v > cap ? (vy / v) * cap : vy;
          m.face = Math.atan2(m.vy, m.vx);
          contact(sim, m, api, m.dmg, 3);
          if (s >= COMET.over || hypot(px - m.x, py - m.y) > 2) {
            m.cd = c.def.rest;
            api.setMode(m, 'recover');
          }
        } else {
          m.vx = Math.cos(m.dir) * COMET.dash;
          m.vy = Math.sin(m.dir) * COMET.dash;
          m.face = m.dir;
          contact(sim, m, api, m.dmg, 3);
          if (m.t > COMET.lunge / COMET.dash) {
            m.cd = c.def.rest;
            api.setMode(m, 'recover');
          }
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.45);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Гравитонный страж: щит спереди (×0,15, из тяжести — полный удар), спина
// ×1,35; поворачивается медленно. Кулак — круг перед собой, оставляет пятно
// тяжести: встань в него — и щит пробивается.
// ---------------------------------------------------------------------------

export const GRAVITON = { turn: 2.1, punchR: 1.45, punchAt: 1.15, shield: 0.15, back: 1.35, front: 1.1 };

brain('f15_graviton', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const turn = (to: number, k = 1) => {
      m.face += clamp(angDiff(to, m.face), -GRAVITON.turn * k * dt, GRAVITON.turn * k * dt);
    };
    switch (m.mode) {
      case 'chase': {
        turn(Math.atan2(c.dy, c.dx));
        if (c.dist < GRAVITON.punchAt + GRAVITON.punchR && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (c.dist < 1.6 ? 0.4 : 1), dt);
        return;
      }
      case 'windup': {
        const T = c.def.windup;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.5) turn(Math.atan2(c.dy, c.dx), 0.8);
        const px = m.x + Math.cos(m.face) * GRAVITON.punchAt;
        const py = m.y + Math.sin(m.face) * GRAVITON.punchAt;
        m.tele = { shape: 'circle', x: px, y: py, r: GRAVITON.punchR, k: clamp(m.t / T, 0, 1) };
        if (m.t > T - 0.24) m.danger = GRAVITON.punchAt + GRAVITON.punchR + 0.3;
        if (m.t >= T) {
          if (hypot(h.x - px, h.y - py) < GRAVITON.punchR + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, c.def.hit?.push ?? 4, m.kind);
          api.zone(sim, {
            x: px,
            y: py,
            r: HEAVY.zoneR,
            life: HEAVY.zoneLife,
            slow: HEAVY.zoneSlow,
            art: 'f15_heavy',
          });
          sim.events.push({ t: 'shake', k: 0.22 });
          say(sim, 'f15_slam');
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.9);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit) {
    if (m.mode === 'dying') return 1;
    const off = Math.abs(angDiff(hit.ang + Math.PI, m.face));
    if (off < GRAVITON.front) return heavyAt(sim, sim.hero.x, sim.hero.y) ? 1 : GRAVITON.shield;
    return off > 2.2 ? GRAVITON.back : 1;
  },
});

// ---------------------------------------------------------------------------
// Звездочёт: держит дистанцию 5–7; малый колодец под ноги (круг 0,9 с) и
// три звёздные стрелы (линия 0,75 с) — стрелы гнутся у колодцев и
// отбиваются клинком. Три камня на орбите гасят удары по одному (тяжёлый
// сбивает все).
// ---------------------------------------------------------------------------

export const ASTRO = { near: 4.6, far: 7.2, castWell: 0.9, castBolt: 0.75, wellR: 2.8, wellOn: 2, stones: 3, regen: 5 };

brain('f15_astro', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const st = stateOf(sim, api);
    if (m.data.stones === undefined) m.data.stones = ASTRO.stones;
    if (m.data.stones < ASTRO.stones) {
      m.data.regen = (m.data.regen ?? 0) + dt;
      if (m.data.regen > ASTRO.regen) {
        m.data.regen = 0;
        m.data.stones += 1;
      }
    }
    switch (m.mode) {
      case 'chase': {
        m.face = Math.atan2(c.dy, c.dx);
        const see = seeHero(sim, m, api);
        if (see && m.cd <= 0 && c.dist < 9) {
          const well = (m.data.cast ?? 0) % 2 === 0;
          m.data.cast = (m.data.cast ?? 0) + 1;
          m.data.px = h.x;
          m.data.py = h.y;
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, well ? 'f15_cast_well' : 'f15_cast_bolt');
          return;
        }
        if (!see || c.dist > ASTRO.far) {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, cx, cy, m.speed, dt);
        } else if (c.dist < ASTRO.near) {
          const away = api.flowDir(sim, m.x, m.y, true) ?? [-c.dx / (c.dist || 1), -c.dy / (c.dist || 1)];
          api.steer(sim, m, away[0], away[1], m.speed, dt);
        } else {
          const s = m.id % 2 ? 1 : -1;
          api.steer(sim, m, (-c.dy / c.dist) * s, (c.dx / c.dist) * s, m.speed * 0.6, dt);
        }
        return;
      }
      case 'f15_cast_well': {
        const T = ASTRO.castWell;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.45) {
          m.data.px = h.x;
          m.data.py = h.y;
        }
        m.tele = { shape: 'circle', x: m.data.px, y: m.data.py, r: ASTRO.wellR, k: clamp(m.t / T, 0, 1) };
        if (m.t >= T) {
          tempWell(sim, st, api, m.data.px, m.data.py, ASTRO.wellR, 0.05, ASTRO.wellOn, 'astro', { burn: 0.7 });
          say(sim, 'f15_cast');
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f15_cast_bolt': {
        const T = ASTRO.castBolt;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.5) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: 7, w: 0.35, ang: m.dir, k: clamp(m.t / T, 0, 1) };
        if (m.t >= T) {
          const spec = c.def.shot;
          if (spec) api.shoot(sim, m, m.dir, { ...spec, n: 3, spread: 0.34 });
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.4);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit, api) {
    const s = m.data.stones ?? ASTRO.stones;
    if (s <= 0 || m.mode === 'dying') return 1;
    m.data.regen = 0;
    api.vfx(sim, { x: m.x, y: m.y - 0.4, r: 0.9, life: 0.3, art: 'f15_spark' });
    if (hit.heavy) {
      m.data.stones = 0;
      return 0.6;
    }
    m.data.stones = s - 1;
    return 0;
  },
});

// ---------------------------------------------------------------------------
// Страж созвездия: встаёт из звёздной карты, держится у своего места
// (≤ 2,2 клетки), кусает вспышкой; линии фигуры хлещут (stepCharts).
// ---------------------------------------------------------------------------

export const CONSTEL_MOB = { leash: 2.2, pulse: 0.95 };

brain('f15_constel', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    switch (m.mode) {
      case 'f15_rise':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (m.t > CONSTEL.wake) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        m.face = Math.atan2(c.dy, c.dx);
        if (c.dist < CONSTEL_MOB.pulse + h.r + 0.1 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        let tx = h.x;
        let ty = h.y;
        const dh = hypot(tx - m.hx, ty - m.hy);
        if (dh > CONSTEL_MOB.leash) {
          tx = m.hx + ((tx - m.hx) / dh) * CONSTEL_MOB.leash;
          ty = m.hy + ((ty - m.hy) / dh) * CONSTEL_MOB.leash;
        }
        const d = hypot(tx - m.x, ty - m.y);
        if (d > 0.2) api.steer(sim, m, (tx - m.x) / d, (ty - m.y) / d, m.speed * Math.min(1, d), dt);
        else {
          m.vx *= 0.8;
          m.vy *= 0.8;
        }
        return;
      }
      case 'windup': {
        const T = c.def.windup;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.tele = { shape: 'circle', r: CONSTEL_MOB.pulse, k: clamp(m.t / T, 0, 1) };
        if (m.t > T - 0.24) m.danger = CONSTEL_MOB.pulse + h.r;
        if (m.t >= T) {
          if (c.dist < CONSTEL_MOB.pulse + h.r && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 2, m.kind);
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.5);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Пожиратель света: летит к зажжённой лампе и гасит её (замах 1 с, круг на
// лампе); хватает конусом. Во тьме затмения удары его не берут — тяни под
// лампу; в свете получает ×1,3.
// ---------------------------------------------------------------------------

export const DEVOURER = { snuff: 1, seek: 7, snuffCd: 8, lit: 1.3 };

brain('f15_devourer', {
  step(sim, m, dt, c, api) {
    const st = stateOf(sim, api);
    m.data.snuffCd = (m.data.snuffCd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        m.face = Math.atan2(c.dy, c.dx);
        if (m.data.snuffCd <= 0) {
          let best = -1;
          let bd = DEVOURER.seek;
          st.lamps.forEach((l, i) => {
            const d = hypot(l.x - m.x, l.y - m.y);
            if (l.lit && d < bd) {
              bd = d;
              best = i;
            }
          });
          if (best >= 0) {
            const l = st.lamps[best];
            if (bd < 1.3) {
              m.data.lamp = best;
              api.setMode(m, 'f15_snuff');
              return;
            }
            api.steer(sim, m, (l.x - m.x) / bd, (l.y - m.y) / bd, m.speed, dt);
            return;
          }
        }
        if (c.dist < c.def.reach + m.r + sim.hero.r + 0.2 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        chase(sim, m, dt, c, api);
        return;
      }
      case 'f15_snuff': {
        const l = st.lamps[m.data.lamp ?? -1];
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (!l || !l.lit) {
          api.setMode(m, 'chase');
          return;
        }
        m.face = Math.atan2(l.y - m.y, l.x - m.x);
        m.tele = { shape: 'circle', x: l.x, y: l.y, r: 0.8, k: clamp(m.t / DEVOURER.snuff, 0, 1) };
        if (m.t >= DEVOURER.snuff) {
          setLamp(sim, l, api, false);
          say(sim, 'f15_snuff');
          m.data.snuffCd = DEVOURER.snuffCd;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'windup':
        bite(sim, m, c, api, { T: c.def.windup, arc: 1.6, status: { kind: 'chill', dur: 1.5 } });
        return;
      case 'recover':
        recoverStep(m, api, 0.55);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m) {
    if (inDark(sim, m.x, m.y)) return 0;
    return nearLit(sim, m.x, m.y) ? DEVOURER.lit : 1;
  },
});

// ---------------------------------------------------------------------------
// Отражение: монстр прошлого этажа из памяти; общий укус и коронный приём
// своего мотива (крыса — выпад, гриб — споры, лава — огненный след, зеркало —
// шаг за спину, небо — порыв, часы — кольцо замедления).
// ---------------------------------------------------------------------------

export const ECHO = { born: 0.7, lunge: 0.5, spore: 0.7, gust: 0.7, tick: 0.9, blink: 0.45 };

brain('f15_echo', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const motif = m.data.motif ?? 0;
    m.data.sp = (m.data.sp ?? 1.5) - dt;
    switch (m.mode) {
      case 'f15_born':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (m.t > ECHO.born) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        const see = seeHero(sim, m, api);
        if (m.data.sp <= 0 && see) {
          if (motif === 0 && c.dist > 2 && c.dist < 4) {
            m.dir = Math.atan2(c.dy, c.dx);
            api.setMode(m, 'f15_lunge_aim');
            return;
          }
          if (motif === 1 && c.dist < 2.6) {
            api.setMode(m, 'f15_spore');
            return;
          }
          if (motif === 3 && c.dist > 1.4 && c.dist < 4) {
            const ux = c.dx / c.dist;
            const uy = c.dy / c.dist;
            const p = openNear(sim, h.x + ux * 1.4, h.y + uy * 1.4, 1);
            if (p) {
              m.data.bx = p[0];
              m.data.by = p[1];
              api.setMode(m, 'f15_blink');
              return;
            }
          }
          if (motif === 4 && c.dist < 3) {
            m.dir = Math.atan2(c.dy, c.dx);
            api.setMode(m, 'f15_gust');
            return;
          }
          if (motif === 5 && c.dist < 2.4) {
            api.setMode(m, 'f15_tick');
            return;
          }
        }
        if (motif === 2) {
          m.data.trail = (m.data.trail ?? 0) - dt;
          if (m.data.trail <= 0) {
            m.data.trail = 0.45;
            api.zone(sim, {
              x: m.x,
              y: m.y,
              r: 0.55,
              life: 2.4,
              warn: 0.45,
              dps: 0.03,
              status: 'burn',
              dur: 1.5,
              art: 'f15_ember',
            });
          }
        }
        if (c.dist < c.def.reach + m.r + h.r + 0.2 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        chase(sim, m, dt, c, api);
        return;
      }
      case 'windup':
        bite(sim, m, c, api, { T: c.def.windup });
        return;
      case 'f15_lunge_aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < ECHO.lunge * 0.5) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        const len = Math.min(3.6, clearDist(sim, api, m.x, m.y, m.dir, 3.6));
        m.tele = { shape: 'line', r: len, w: 0.5, ang: m.dir, k: clamp(m.t / ECHO.lunge, 0, 1) };
        if (m.t > ECHO.lunge - 0.24) m.danger = 1.2;
        if (m.t >= ECHO.lunge) {
          m.data.hit = 0;
          api.setMode(m, 'f15_lunge');
        }
        return;
      }
      case 'f15_lunge':
        m.vx = Math.cos(m.dir) * 11;
        m.vy = Math.sin(m.dir) * 11;
        contact(sim, m, api, m.dmg, 3);
        if (m.t > 0.32) {
          m.data.sp = 4;
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      case 'f15_spore': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = { shape: 'circle', r: 1.7, k: clamp(m.t / ECHO.spore, 0, 1) };
        if (m.t > ECHO.spore - 0.24) m.danger = 1.7 + h.r;
        if (m.t >= ECHO.spore) {
          api.zone(sim, { x: m.x, y: m.y, r: 1.7, life: 3, dps: 0.02, status: 'poison', dur: 2, art: 'f15_spore' });
          m.data.sp = 6;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f15_blink':
        m.data.ghost = m.t > 0.2 ? 1 : 0;
        m.vx = 0;
        m.vy = 0;
        m.tele = { shape: 'circle', x: m.data.bx, y: m.data.by, r: 0.5, k: clamp(m.t / ECHO.blink, 0, 1) };
        if (m.t >= ECHO.blink) {
          m.x = m.data.bx;
          m.y = m.data.by;
          m.data.ghost = 0;
          m.data.sp = 6;
          api.vfx(sim, { x: m.x, y: m.y, r: 1, life: 0.35, art: 'f15_memflash' });
          api.setMode(m, 'windup');
        }
        return;
      case 'f15_gust': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < ECHO.gust * 0.5) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: 3.2, ang: m.dir, arc: 1.1, k: clamp(m.t / ECHO.gust, 0, 1) };
        if (m.t > ECHO.gust - 0.24) m.danger = 3.2;
        if (m.t >= ECHO.gust) {
          const off = Math.abs(angDiff(Math.atan2(c.dy, c.dx), m.dir));
          if (c.dist < 3.2 + h.r && off < 0.65 && canHurt(sim)) api.hurtHero(sim, m.dmg * 0.5, m.x, m.y, 8, m.kind);
          m.data.sp = 5;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f15_tick': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = { shape: 'ring', r: 1.6, w: 0.8, k: clamp(m.t / ECHO.tick, 0, 1) };
        if (m.t > ECHO.tick - 0.24) m.danger = 2.4 + h.r;
        if (m.t >= ECHO.tick) {
          if (Math.abs(c.dist - 1.6) < 0.8 + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg * 0.7, m.x, m.y, 2, m.kind, { kind: 'slow', dur: 1.5 });
          m.data.sp = 6;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.5);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Спутник: кружит вокруг героя, сужая орбиту; на малой — прицел линией и
// пике.
// ---------------------------------------------------------------------------

export const MOON = { R: 3.8, rMin: 1.9, shrink: 0.4, w: 2.1, aim: 0.6, dive: 12, diveT: 0.34 };

brain('f15_moon', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    switch (m.mode) {
      case 'chase': {
        const R = Math.max(MOON.rMin, (m.data.R ?? MOON.R) - MOON.shrink * dt);
        m.data.R = R;
        const s = m.id % 2 ? 1 : -1;
        const th = (m.data.th ?? Math.atan2(m.y - h.y, m.x - h.x)) + s * MOON.w * dt;
        m.data.th = th;
        const tx = h.x + Math.cos(th) * R;
        const ty = h.y + Math.sin(th) * R;
        const d = hypot(tx - m.x, ty - m.y);
        if (d > 0.05) api.steer(sim, m, (tx - m.x) / d, (ty - m.y) / d, Math.min(m.speed * 1.4, d * 6), dt);
        m.face = Math.atan2(c.dy, c.dx);
        if (R <= MOON.rMin + 0.05 && m.cd <= 0 && c.dist < 3.2 && seeHero(sim, m, api)) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'aim');
        }
        return;
      }
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < MOON.aim * 0.5) m.dir = Math.atan2(c.dy, c.dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: MOON.dive * MOON.diveT, w: 0.45, ang: m.dir, k: clamp(m.t / MOON.aim, 0, 1) };
        if (m.t > MOON.aim - 0.24) m.danger = 1.2;
        if (m.t >= MOON.aim) {
          m.data.hit = 0;
          api.setMode(m, 'f15_dive');
        }
        return;
      }
      case 'f15_dive':
        m.vx = Math.cos(m.dir) * MOON.dive;
        m.vy = Math.sin(m.dir) * MOON.dive;
        contact(sim, m, api, m.dmg, 2.5);
        if (m.t > MOON.diveT) {
          m.data.R = MOON.R;
          m.data.th = Math.atan2(m.y - h.y, m.x - h.x);
          m.cd = c.def.rest;
          api.setMode(m, 'recover');
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.45);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Сверхновая: копит свет 1,4 с (кольцо 1,1…3,3 — вплотную безопасно) и
// вспыхивает; погибнув, схлопывается в колодец на 6 с.
// ---------------------------------------------------------------------------

export const NOVA = { gather: 1.4, ringR: 2.2, ringW: 1.1, at: 3, wellR: 4.5, warn: 0.4, on: 6, burn: 1.2, k: 1.3 };

brain('f15_nova', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const key = `f15_nova:${m.id}`;
    switch (m.mode) {
      case 'chase':
        if (c.dist < NOVA.at && m.cd <= 0) {
          api.setMode(m, 'f15_gather');
          return;
        }
        chase(sim, m, dt, c, api);
        return;
      case 'f15_gather': {
        const k = clamp(m.t / NOVA.gather, 0, 1);
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.tele = { shape: 'ring', r: NOVA.ringR, w: NOVA.ringW, k };
        api.light(sim, key, { x: m.x, y: m.y, r: 2 + k * 3.5, tint: 'warm' });
        if (m.t > NOVA.gather - 0.24) m.danger = NOVA.ringR + NOVA.ringW + h.r;
        if (m.t >= NOVA.gather) {
          if (Math.abs(c.dist - NOVA.ringR) < NOVA.ringW + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind, { kind: 'burn', dur: 2 });
          api.vfx(sim, { x: m.x, y: m.y, r: NOVA.ringR + NOVA.ringW, life: 0.5, art: 'f15_novaburst', above: true });
          api.light(sim, key, null);
          sim.events.push({ t: 'shake', k: 0.25 });
          sim.events.push({ t: 'flash', color: '#fff0b0', k: 0.35 });
          say(sim, 'f15_nova');
          m.cd = c.def.rest * 1.5;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.8);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    const st = stateOf(sim, api);
    api.light(sim, `f15_nova:${m.id}`, null);
    tempWell(sim, st, api, m.x, m.y, NOVA.wellR, NOVA.warn, NOVA.on, 'nova', { burn: NOVA.burn, k: NOVA.k });
    say(sim, 'f15_collapse', 'СВЕРХНОВАЯ СХЛОПНУЛАСЬ', 'колодец на шесть секунд — уводи туда врагов');
  },
});

// ---------------------------------------------------------------------------
// Золотой метеорит (редкий): удирает зигзагом, у колодцев закручивается по
// спирали; каждый удар сыплет монеты; через 14 с, оторвавшись, улетает.
// ---------------------------------------------------------------------------

export const GOLDBUG = { escape: 14, coinsPerHit: 40 };

brain('f15_goldbug', {
  step(sim, m, dt, c, api) {
    if (m.mode !== 'flee' && m.mode !== 'chase') api.setMode(m, 'flee');
    m.data.age = (m.data.age ?? 0) + dt;
    const w = wellNear(sim, m.x, m.y, 3);
    let ux: number;
    let uy: number;
    if (w && c.dist < 9) {
      const dx = m.x - w.x;
      const dy = m.y - w.y;
      const d = hypot(dx, dy) || 1;
      const s = m.id % 2 ? 1 : -1;
      const inward = d > w.r * 0.7 ? -0.35 : 0.35;
      ux = (-dy / d) * s + (dx / d) * inward;
      uy = (dx / d) * s + (dy / d) * inward;
    } else {
      const away = api.flowDir(sim, m.x, m.y, true) ?? [-c.dx / (c.dist || 1), -c.dy / (c.dist || 1)];
      const z = Math.sin(sim.time * 6 + m.id) * 0.45;
      ux = away[0] - away[1] * z;
      uy = away[1] + away[0] * z;
    }
    const l = hypot(ux, uy) || 1;
    api.steer(sim, m, ux / l, uy / l, m.speed, dt);
    m.face = Math.atan2(m.vy, m.vx);
    if (m.data.age > GOLDBUG.escape && c.dist > 6) {
      api.setMode(m, 'escape');
      m.hp = 0;
      say(sim, 'f15_gold_gone');
    }
  },
  onHit(sim, m, _hit, api) {
    api.dropAt(sim, 'coin', GOLDBUG.coinsPerHit, m.x, m.y);
    return 1;
  },
});
