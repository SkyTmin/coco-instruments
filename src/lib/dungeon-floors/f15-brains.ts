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
}

export interface Star {
  x: number;
  y: number;
  at: number;
  key: string;
}

export interface Arc {
  id: number;
  cx: number;
  cy: number;
  R: number;
  a0: number;
  a1: number;
  t: number;
  T: number;
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
  // Край пустоты: дрейф к ней — сорвался.
  const v = hypot(h.vx, h.vy);
  if (v > FLOAT.slip) {
    const px = h.x + (h.vx / v) * (h.r + 0.12);
    const py = h.y + (h.vy / v) * (h.r + 0.12);
    if (tileAt(sim, Math.floor(px), Math.floor(py)) === T_DEEP) {
      const mk = markAt(sim, Math.floor(px), Math.floor(py));
      if (mk === MK.void || mk === MK.lane || mk === MK.vortex) fallHero(sim, st, api, 'в невесомости не затормозить — 8%');
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
        const ids = releaseEcho(sim, api, mem, gal && gal.n % 3 === 0 ? 2 : 1);
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
  gallery: { every: 2.2, glow: 0.9, maxAlive: 6, timeout: 90 },
  starfall: { dur: 20, every: 0.75, warn: 1.1, r: 1.3, share: 0.12, wellR: 3, wellOn: 1.3 },
  eclipse: { max: 80, fade: 1.2 },
  storm: { cycles: 4, phase: 5, warn: 1.2, slow: 0.6 },
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

function hallEnd(sim: Sim, hall: Hall, api: SimApi, drops: [string, number][], what: string, text: string): void {
  hall.state = 'done';
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
      if (a.t > a.T + 0.6) st.arcs.delete(id);
    }
    if (heroDown(sim) || quiet) return;
    stepPosts(sim, st, api);
    stepCharts(sim, st, api);
    stepHalls(sim, st, api, dt);
  },
  onUse,
  useLabel: labelOf,
});
