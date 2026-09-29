// Этаж 8 «Бесконечный замок» — ИИ монстров, сценарий Демона семи лун и
// правила этажа.
//
// Правила этажа (`registerFloor(8)`):
//   • ДВЕРИ. Демоны выходят из раздвижных фусума в стенах: дверь сперва
//     отъезжает, в темноте загораются глаза — и через миг выходит монстр.
//     Нор нет: замок не роет, он открывает двери;
//   • ПЕРЕГОРОДКИ. В «Сдвигающихся залах» стены-перегородки ездят по пазам
//     целыми блоками. Два крыла — два бивы-струнника: пока играет своя бива,
//     её перегородки сдвигаются раз в 11–14 с. Перед сдвигом звенит струна,
//     паз светится, пол дрожит полторы секунды; кого застало в клетке,
//     ставшей стеной, — выталкивает на ближний пол. Убит бива — крыло замерло;
//   • БАРАБАННАЯ. Удар барабанщика в брюхо поворачивает вертушку стен
//     комнаты на четверть оборота (с тем же предупреждением);
//   • ПЕРЕВЁРНУТАЯ КОМНАТА (зал-событие Нижних покоев). Вошёл — комната
//     переворачивается: пол становится потолком (другие стены, другой
//     пол, лампы стоят «на полу»), с «потолка» падают демоны, а в стене,
//     бывшей «полом», открывается ниша с тайником;
//   • ЗАЛ СТРУНЫ (зал-событие Залов). Подошёл к помосту — бива играет
//     трижды подряд, перегородки зала ездят, со свода падает стража;
//   • ПАДАЮЩИЙ МОСТ (зал-событие Зала луны). Ступил на мост — за спиной
//     начинают рушиться доски (каждая сперва дрожит), из пропасти
//     поднимаются фонарные духи. Не успел — сорвался: урон и возврат на
//     край (место видно вспышкой). Доски всплывают обратно;
//   • спящие стаи (`r`), засады со свода (`A`), глазастые сёдзи (`e`).
//
// Честность: всё, что бьёт, видно заранее — линии выпадов, конусы, нити,
// когти сквозь бумагу, дуги полумесяцев, дрожь пола перед сдвигом стен.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, StrikeIn, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Prop, Sim } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F8_HALLS, F8_LOWER, F8_MARK, F8_MOON } from './f8';

const TAU = Math.PI * 2;
const hypot = Math.hypot;
const M = F8_MARK;

/** Клетки мира (`Tile` из `dungeon-world.ts` — значениями его сюда не взять). */
export const T8 = { Wall: 1, Floor: 2, Deep: 11, Hazard: 12 } as const;

// ---------------------------------------------------------------------------
// Постоянные.
// ---------------------------------------------------------------------------

/** Предупреждение перед сдвигом перегородок и поворотом Барабанной, с. */
export const SHIFT_WARN = 1.5;
/** Пауза между сдвигами крыла, пока играет бива, с. */
export const SHIFT_EVERY: [number, number] = [11, 14];
/** Перевёрнутая комната: сколько стоять внутри до начала и сколько дрожит. */
export const FLIP_ARM = 0.7;
export const FLIP_WARN = 2.1;
/** Падающий мост: дрожь доски и шаг обрушения по рядам, с. */
export const PLANK_WARN = 0.9;
export const PLANK_STEP = 0.42;
/** Доски всплывают обратно через столько после последней. */
export const PLANK_BACK = 3.2;
/** Сорвался с моста: доля здоровья. */
export const FALL_HURT = 0.18;

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T8.Wall;
  return sim.tiles[y * w.w + x];
};

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

/** Задевает ли линия (из точки по углу, длина, полуширина) круг. */
export function lineHits(
  x: number,
  y: number,
  ang: number,
  len: number,
  w: number,
  hx: number,
  hy: number,
  hr: number,
): boolean {
  const dx = hx - x;
  const dy = hy - y;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const along = dx * ux + dy * uy;
  const across = Math.abs(-dx * uy + dy * ux);
  return along > -hr && along < len + hr && across < w + hr;
}

/** Сколько клеток от точки до стены по направлению. */
function wallDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

const canHit = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

// ---------------------------------------------------------------------------
// Вытолкнуть из клеток, ставших стеной: героя, мобов, добычу.
// ---------------------------------------------------------------------------

/** Ближайший центр проходимой клетки (обход в ширину от клетки точки). */
function nearestOpen(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  bad: Set<number>,
): [number, number] | null {
  const W = sim.world.w;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const seen = new Set<number>([sy * W + sx]);
  const q: [number, number][] = [[sx, sy]];
  let best: [number, number] | null = null;
  let bestD = 1e9;
  for (let head = 0; head < q.length && head < 400; head++) {
    const [cx, cy] = q[head];
    const i = cy * W + cx;
    if (!bad.has(i) && !api.solidTile(sim, cx, cy)) {
      const d = hypot(cx + 0.5 - x, cy + 0.5 - y);
      if (d < bestD) {
        bestD = d;
        best = [cx + 0.5, cy + 0.5];
      }
      // Найден пол на этом кольце — дальше кольцо не расширяем.
      if (bestD < 1.2) break;
    }
    if (best && hypot(cx - sx, cy - sy) > bestD + 1.5) break;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      const j = ny * W + nx;
      if (seen.has(j) || nx < 0 || ny < 0 || nx >= W || ny >= sim.world.h) continue;
      if (Math.abs(nx - sx) > 7 || Math.abs(ny - sy) > 7) continue;
      seen.add(j);
      q.push([nx, ny]);
    }
  }
  return best;
}

/** Касается ли круг клетки (x, y). */
const circleInCell = (ex: number, ey: number, r: number, cx: number, cy: number) => {
  const nx = Math.max(cx, Math.min(cx + 1, ex));
  const ny = Math.max(cy, Math.min(cy + 1, ey));
  return hypot(ex - nx, ey - ny) < r - 0.02;
};

/**
 * Клетки `cells` стали стенами: всех, кого задевает, — на ближний пол.
 * Возвращает, кого вытолкнуло (для тестов и звука).
 */
export function evictFrom(sim: Sim, api: SimApi, cells: number[]): number {
  if (!cells.length) return 0;
  const W = sim.world.w;
  const bad = new Set(cells);
  let moved = 0;
  const hits = (x: number, y: number, r: number) => {
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const y0 = Math.floor(y - r);
    const y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        if (bad.has(cy * W + cx) && circleInCell(x, y, r, cx, cy)) return true;
    return false;
  };
  const h = sim.hero;
  if (!heroDown(sim) && hits(h.x, h.y, h.r)) {
    const p = nearestOpen(sim, api, h.x, h.y, bad);
    if (p) {
      h.x = p[0];
      h.y = p[1];
      h.vx = 0;
      h.vy = 0;
      if (h.mode === 'dash') {
        h.mode = 'free';
        h.t = 0;
      }
      sim.flowT = 0;
      moved += 1;
    }
  }
  for (const m of sim.mobs) {
    if (m.mode === 'dying') continue;
    if (!hits(m.x, m.y, Math.min(m.r, 0.45))) continue;
    const p = nearestOpen(sim, api, m.x, m.y, bad);
    if (!p) continue;
    m.x = p[0];
    m.y = p[1];
    m.vx = 0;
    m.vy = 0;
    moved += 1;
  }
  for (const d of sim.drops) {
    if (!bad.has(Math.floor(d.y) * W + Math.floor(d.x))) continue;
    const p = nearestOpen(sim, api, d.x, d.y, bad);
    if (p) {
      d.x = p[0];
      d.y = p[1];
    }
  }
  return moved;
}

// ---------------------------------------------------------------------------
// Состояние этажа.
// ---------------------------------------------------------------------------

interface Door {
  x: number;
  y: number;
  /** Клетка пола перед дверью. */
  ox: number;
  oy: number;
  prop: Prop | null;
  obj: WorldObj | null;
  ready: number;
  area: string;
}

/** Открытая дверь: кто выйдет и когда. */
interface Opening {
  door: Door;
  t: number;
  kinds: string[];
  elite: boolean;
  /** Бес-казначей, нырнувший в эту дверь (id), или 0. */
  mob: number;
  closeAt: number;
}

interface ShiftCell {
  i: number;
  x: number;
  y: number;
  /** Стена в исходном положении (A). */
  wallA: boolean;
}

interface Block {
  cells: ShiftCell[];
  cx: number;
  cy: number;
}

export interface ShiftGroup {
  id: 0 | 1;
  area: string;
  seat: { x: number; y: number; obj: WorldObj } | null;
  blocks: Block[];
  /** 0 — как на карте, 1 — сдвинуто. */
  state: 0 | 1;
  /** Когда следующий сдвиг (время симуляции). */
  next: number;
  /** Идёт предупреждение: когда сдвинется, или 0. */
  at: number;
  biwa: number;
  spawned: boolean;
  frozen: boolean;
  /** Сколько раз сдвигалось (для тестов). */
  shifts: number;
}

export interface DrumRoom {
  cx: number;
  cy: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Все клетки вертушки (все повороты). */
  all: number[];
  /** Стены сейчас: смещения от центра. */
  arms: [number, number][];
  turns: number;
  at: number;
  seat: { x: number; y: number } | null;
  mob: number;
  spawned: boolean;
  /** Когда последний раз били в барабан — для рисунка тайко. */
  beat: number;
}

interface FlipCell {
  i: number;
  x: number;
  y: number;
  kind: 'floor' | 'wall' | 'beam';
}

export interface FlipRoom {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cells: FlipCell[];
  state: 'idle' | 'arm' | 'warn' | 'done';
  t: number;
}

interface BridgeRow {
  y: number;
  xs: number[];
  /** Состояние доски: 0 — цела, 1 — дрожит, 2 — рухнула. */
  s: number;
  t: number;
}

export interface FallBridge {
  rows: BridgeRow[];
  state: 'idle' | 'run' | 'back' | 'rest';
  /** Откуда рушится: +1 — с юга (ряды сверху вниз по индексу), −1 — с севера. */
  dir: number;
  next: number;
  k: number;
  t: number;
  /** Куда вернёт сорвавшегося: край, с которого ступил. */
  land: [number, number];
  falls: number;
}

interface Spot {
  x: number;
  y: number;
  used: boolean;
  area: string;
}

interface EyeWall {
  x: number;
  y: number;
  ox: number;
  oy: number;
  mob: number;
  ready: number;
  area: string;
}

interface F8State {
  doors: Door[];
  openings: Opening[];
  spawnT: number;
  goldT: number;
  groups: ShiftGroup[];
  drum: DrumRoom | null;
  flip: FlipRoom | null;
  bridge: FallBridge | null;
  sleepers: Spot[];
  ambushes: Spot[];
  eyes: EyeWall[];
  /** Зал струны: сыграно ли событие. */
  hallDone: boolean;
  hallQueue: number[];
  /** Духи из пропасти в Зале луны. */
  riseT: number;
  said: Record<string, number>;
  /** Картинки помостов поставлены. */
  decals?: boolean;
}

const STATE = new WeakMap<Sim, F8State>();

function scan(sim: Sim, api: SimApi): F8State {
  const w = sim.world;
  const W = w.w;
  const doors: Door[] = [];
  const eyes: EyeWall[] = [];
  const sleepers: Spot[] = [];
  const ambushes: Spot[] = [];
  const shift: [number, number, number][] = [];
  const drumCells: [number, number, number][] = [];
  const flipCells: [number, number, number][] = [];
  const bridge = new Map<number, number[]>();
  const open = (x: number, y: number) => !api.solidTile(sim, x, y);
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < W; x++) {
      const k = w.mark[y * W + x];
      if (!k) continue;
      if (k === M.door && open(x, y + 1)) {
        const obj = w.objs.find((o) => o.x === x && o.y === y && o.kind === 'deco') ?? null;
        const prop = obj ? (sim.props.find((p) => p.obj === obj) ?? null) : null;
        doors.push({ x, y, ox: x, oy: y + 1, prop, obj, ready: 0, area: w.rowArea[y] });
      } else if (k === M.eyes && open(x, y + 1))
        eyes.push({ x, y, ox: x, oy: y + 1, mob: 0, ready: 0, area: w.rowArea[y] });
      else if (k === M.group) sleepers.push({ x, y, used: false, area: w.rowArea[y] });
      else if (k === M.ambush) ambushes.push({ x, y, used: false, area: w.rowArea[y] });
      else if (k === M.shift0 || k === M.track0) shift.push([x, y, 0]);
      else if (k === M.shift1 || k === M.track1) shift.push([x, y, 1]);
      else if (k === M.drumWall || k === M.drumFloor) drumCells.push([x, y, k]);
      else if (k === M.flip || k === M.flipBeam || k === M.flipWall) flipCells.push([x, y, k]);
      else if (k === M.bridgeFall) {
        const row = bridge.get(y) ?? [];
        row.push(x);
        bridge.set(y, row);
      }
    }

  // Перегородки: связные куски (8-соседство) внутри своей группы.
  const groups: ShiftGroup[] = [];
  const seats = w.objs.filter((o) => o.ref === 'f8_stage' || o.ref === 'f8_stage2');
  for (const gid of [0, 1] as const) {
    const cells = shift.filter((c) => c[2] === gid);
    if (!cells.length) continue;
    const set = new Map(cells.map(([x, y]) => [y * W + x, [x, y] as [number, number]]));
    const seen = new Set<number>();
    const blocks: Block[] = [];
    for (const [i0] of set) {
      if (seen.has(i0)) continue;
      const comp: ShiftCell[] = [];
      const q = [i0];
      seen.add(i0);
      while (q.length) {
        const i = q.pop()!;
        const [x, y] = set.get(i)!;
        comp.push({ i, x, y, wallA: sim.tiles[i] === T8.Wall });
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * W + x + dx;
            if (set.has(j) && !seen.has(j)) {
              seen.add(j);
              q.push(j);
            }
          }
      }
      let sx = 0;
      let sy = 0;
      for (const c of comp) {
        sx += c.x;
        sy += c.y;
      }
      blocks.push({ cells: comp, cx: sx / comp.length + 0.5, cy: sy / comp.length + 0.5 });
    }
    const seatObj = seats.find((o) => o.ref === (gid === 0 ? 'f8_stage' : 'f8_stage2'));
    groups.push({
      id: gid,
      area: w.rowArea[cells[0][1]],
      seat: seatObj ? { x: seatObj.x + 0.5, y: seatObj.y + 0.5, obj: seatObj } : null,
      blocks,
      state: 0,
      next: 6 + gid * 4,
      at: 0,
      biwa: 0,
      spawned: false,
      frozen: false,
      shifts: 0,
    });
  }

  // Барабанная: вертушка — стены сейчас и места поворотов.
  let drum: DrumRoom | null = null;
  if (drumCells.length) {
    const xs = drumCells.map((c) => c[0]);
    const ys = drumCells.map((c) => c[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const seat = w.objs.find((o) => o.ref === 'f8_drumseat');
    // Комната — рамка вертушки с полями в две клетки (до стен).
    drum = {
      cx,
      cy,
      x0: Math.min(...xs) - 2,
      y0: Math.min(...ys) - 2,
      x1: Math.max(...xs) + 2,
      y1: Math.max(...ys) + 2,
      all: drumCells.map(([x, y]) => y * W + x),
      arms: drumCells.filter((c) => c[2] === M.drumWall).map(([x, y]) => [x - cx, y - cy]),
      turns: 0,
      at: 0,
      seat: seat ? { x: seat.x + 0.5, y: seat.y + 0.5 } : null,
      mob: 0,
      spawned: false,
      beat: -9,
    };
  }

  // Перевёрнутая комната: рамка по её клеткам.
  let flip: FlipRoom | null = null;
  if (flipCells.length) {
    const xs = flipCells.map((c) => c[0]);
    const ys = flipCells.map((c) => c[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    const cells: FlipCell[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = w.mark[y * W + x];
        const t = sim.tiles[y * W + x];
        if (k === M.flipWall) cells.push({ i: y * W + x, x, y, kind: 'wall' });
        else if (k === M.flipBeam) cells.push({ i: y * W + x, x, y, kind: 'beam' });
        else if (t !== T8.Wall && (k === M.flip || k === M.inherit || k === M.tatami))
          cells.push({ i: y * W + x, x, y, kind: 'floor' });
      }
    flip = { x0, y0, x1, y1, cells, state: 'idle', t: 0 };
  }

  // Падающий мост: ряды по порядку.
  let fall: FallBridge | null = null;
  if (bridge.size) {
    const rows = [...bridge.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([y, xs]) => ({ y, xs: xs.sort((a, b) => a - b), s: 0, t: 0 }));
    fall = { rows, state: 'idle', dir: 1, next: 0, k: 0, t: 0, land: [0, 0], falls: 0 };
  }

  return {
    doors,
    openings: [],
    spawnT: 4,
    goldT: 240 + sim.rng() * 240,
    groups,
    drum,
    flip,
    bridge: fall,
    sleepers,
    ambushes,
    eyes,
    hallDone: false,
    hallQueue: [],
    riseT: 6,
    said: {},
  };
}

function stateOf(sim: Sim, api: SimApi): F8State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim, api);
    STATE.set(sim, st);
  }
  return st;
}

/** Для тестов и рисунка. */
export const f8State = (sim: Sim): F8State | undefined => STATE.get(sim);
export const f8Groups = (sim: Sim): readonly ShiftGroup[] => STATE.get(sim)?.groups ?? [];
export const f8Drum = (sim: Sim): DrumRoom | null => STATE.get(sim)?.drum ?? null;
export const f8Flip = (sim: Sim): FlipRoom | null => STATE.get(sim)?.flip ?? null;
export const f8Bridge = (sim: Sim): FallBridge | null => STATE.get(sim)?.bridge ?? null;

/** Сказать не чаще раза в `gap` секунд. */
function say(sim: Sim, st: F8State, what: string, text: string, sub: string, gap = 40): void {
  if (sim.time - (st.said[what] ?? -999) < gap) return;
  st.said[what] = sim.time;
  sim.events.push({ t: 'boss', what, text, sub });
}

// ---------------------------------------------------------------------------
// Двери: откуда выходят демоны.
// ---------------------------------------------------------------------------

/** Время, когда дверь в последний раз открылась, — для рисунка створок. */
const DOOR_OPEN = new WeakMap<WorldObj, { at: number; until: number; gold: boolean }>();
/** Рисунку: открыта ли дверь сейчас и насколько (0…1). */
export function doorOpen(obj: WorldObj, now: number): { k: number; gold: boolean } {
  const d = DOOR_OPEN.get(obj);
  if (!d || now > d.until + 0.3) return { k: 0, gold: false };
  const open = Math.min(1, (now - d.at) / 0.25);
  const close = now > d.until ? 1 - (now - d.until) / 0.3 : 1;
  return { k: Math.max(0, Math.min(open, close)), gold: d.gold };
}

/** Часы рисунка дверей — время симуляции той вылазки, что на экране. */
export const F8_CLOCK = { now: 0, beat: -9 };

function openDoor(sim: Sim, st: F8State, door: Door, kinds: string[], o: Partial<Opening> = {}) {
  const warn = 0.85;
  door.ready = sim.time + 14;
  st.openings.push({
    door,
    t: warn,
    kinds,
    elite: o.elite ?? false,
    mob: o.mob ?? 0,
    closeAt: warn + 0.4 * kinds.length + 0.9,
  });
  if (door.obj)
    DOOR_OPEN.set(door.obj, {
      at: sim.time,
      until: sim.time + warn + 0.4 * kinds.length + 0.9,
      gold: kinds.includes('f8_miser'),
    });
  sim.events.push({ t: 'clank', x: door.x + 0.5, y: door.y + 1 });
}

/** Дверь рядом с героем: `minD…maxD`, выход достижим, не у лифта. */
function pickDoor(
  sim: Sim,
  api: SimApi,
  st: F8State,
  minD: number,
  maxD: number,
  area?: string,
): Door | null {
  const h = sim.hero;
  let total = 0;
  const cand: [Door, number][] = [];
  for (const d of st.doors) {
    if (d.ready > sim.time) continue;
    if (area && d.area !== area) continue;
    const dist = hypot(d.ox + 0.5 - h.x, d.oy + 0.5 - h.y);
    if (dist < minD || dist > maxD) continue;
    if (api.inArena(sim, d.ox + 0.5, d.oy + 0.5)) continue;
    if (sim.safe.some((s) => hypot(s.x - d.ox, s.y - d.oy) < 9)) continue;
    if (api.solidTile(sim, d.ox, d.oy)) continue;
    const fl = sim.flow[d.oy * sim.world.w + d.ox];
    if (fl < 0 || fl > maxD * 1.8) continue;
    const wgt = api.lineOfSight(sim, h.x, h.y, d.ox + 0.5, d.oy + 0.5) ? 3 : 1;
    cand.push([d, wgt]);
    total += wgt;
  }
  if (!cand.length) return null;
  let r = sim.rng() * total;
  for (const [d, wgt] of cand) {
    r -= wgt;
    if (r <= 0) return d;
  }
  return cand[cand.length - 1][0];
}

const liveMobs = (sim: Sim) =>
  sim.mobs.filter((m) => m.mode !== 'dying' && m.kind !== 'f8boss' && m.kind !== 'f8_moon').length;

const nearMobs = (sim: Sim, r: number) =>
  sim.mobs.filter(
    (m) =>
      m.mode !== 'dying' && m.kind !== 'f8_moon' && hypot(m.x - sim.hero.x, m.y - sim.hero.y) < r,
  ).length;

// ---------------------------------------------------------------------------
// Общие шаги мобов.
// ---------------------------------------------------------------------------

/** Выход из двери: полсекунды недосягаем, шагает на пол. */
function outStep(m: Mob, api: SimApi): boolean {
  if (m.mode !== 'f8_out') return false;
  m.data.ghost = m.t < 0.35 ? 1 : 0;
  m.tele = null;
  m.danger = 0;
  m.vx = 0;
  m.vy = 2.2;
  if (m.t >= 0.5) {
    m.data.ghost = 0;
    api.setMode(m, 'chase');
    m.cd = 0.3;
  }
  return true;
}

/** Укус/тычок вплотную: замах `windup` рисует движок. */
function biteStep(sim: Sim, m: Mob, c: BrainCtx, api: SimApi, push = 2.5, mult = 1): void {
  const h = sim.hero;
  const def = c.def;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t < def.windup) return;
  const reach = def.reach + m.r + h.r + 0.18;
  if (c.dist < reach && canHit(sim)) api.hurtHero(sim, m.dmg * mult, m.x, m.y, push, m.kind);
  m.vx += Math.cos(m.face) * 3;
  m.vy += Math.sin(m.face) * 3;
  api.setMode(m, 'recover');
  m.data.bcd = def.rest * (0.8 + sim.rng() * 0.4);
}

// ---------------------------------------------------------------------------
// Бес-прислужник: стайка, прыжок-укус по короткой линии.
// ---------------------------------------------------------------------------

const IMP_LEAP = 2.6;

registerBrain('f8_imp', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = m.mode === 'leap';
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = dist < 6 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < IMP_LEAP + 0.3 && dist > 1.1 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Стайкой — обходят с боков, на подходе петляют.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const side = m.id % 2 ? 1 : -1;
        const z = dist > 1.6 ? Math.sin(sim.time * 6 + m.id) * 0.55 + side * 0.35 : 0;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed, dt);
        return;
      }
      case 'aim': {
        const T = def.windup;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.5) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: IMP_LEAP, w: 0.24, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.2) m.danger = IMP_LEAP + 0.5;
        if (m.t >= T) {
          m.data.hit = 0;
          api.setMode(m, 'leap');
        }
        return;
      }
      case 'leap': {
        const s = 9;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.1 && canHit(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 3.5, m.kind);
        }
        if (m.t > IMP_LEAP / s) {
          api.setMode(m, 'recover');
          m.cd = 1.6 + sim.rng() * 0.8;
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.55) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(_sim, m, _nx, _ny, api) {
    if (m.mode !== 'leap') return;
    m.vx = 0;
    m.vy = 0;
    api.setMode(m, 'recover');
  },
});

// ---------------------------------------------------------------------------
// Демон-мечник: серия выпадов по линиям, потом открыт.
// ---------------------------------------------------------------------------

const LUNGE = 3.4;
const LUNGE_SPEED = 12;

registerBrain('f8_blade', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = m.mode === 'lunge';
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = dist < 7 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < def.reach + m.r + h.r + 0.1 && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (see && dist < LUNGE + 0.4 && dist > 1.2 && m.cd <= 0) {
          m.data.series = m.elite ? 4 : 2 + (sim.rng() < 0.4 ? 1 : 0);
          m.data.next = 0;
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Держит дистанцию выпада: подходит до трёх клеток, не ближе.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        let k = 1;
        if (see && dist < 2.4) k = -0.4;
        else if (see && dist < 3.4) {
          // Кружит — выбирает угол.
          const side = m.id % 2 ? 1 : -1;
          const ox = -cy * side;
          const oy = cx * side;
          cx = ox;
          cy = oy;
          k = 0.55;
        }
        api.steer(sim, m, cx * k, cy * k, m.speed, dt);
        if (k < 0) m.face = Math.atan2(dy, dx);
        return;
      }
      case 'aim': {
        // Первый выпад — видно дольше, следующие в серии — короче.
        const T = m.data.next ? 0.36 : 0.62;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(LUNGE, wallDist(sim, api, m.x, m.y, m.dir, LUNGE) - 0.2);
        m.data.len = len;
        m.tele = { shape: 'line', r: len + 0.3, w: 0.32, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.22) m.danger = len + 0.8;
        if (m.t >= T) {
          m.data.hit = 0;
          api.setMode(m, 'lunge');
        }
        return;
      }
      case 'lunge': {
        m.vx = Math.cos(m.dir) * LUNGE_SPEED;
        m.vy = Math.sin(m.dir) * LUNGE_SPEED;
        m.face = m.dir;
        m.danger = m.r + h.r + 1;
        if (!m.data.hit && dist < m.r + h.r + 0.25 && canHit(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.15, m.x, m.y, 4.5, m.kind);
        }
        if (m.t > Math.max(0.08, (m.data.len ?? LUNGE) / LUNGE_SPEED)) endLunge(sim, m, api);
        return;
      }
      case 'windup': {
        // Рубит наотмашь: конус рисует движок.
        biteStep(sim, m, c, api, 3, 1);
        return;
      }
      case 'recover':
        m.vx *= 0.82;
        m.vy *= 0.82;
        if (m.t > (m.data.long ? 1.15 : 0.55)) {
          m.data.long = 0;
          api.setMode(m, 'chase');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'lunge') return;
    m.vx = 0;
    m.vy = 0;
    endLunge(sim, m, api);
  },
});

function endLunge(sim: Sim, m: Mob, api: SimApi): void {
  m.bounce = false;
  m.data.series = (m.data.series ?? 1) - 1;
  if (m.data.series > 0) {
    m.data.next = 1;
    m.dir = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
    api.setMode(m, 'aim');
    return;
  }
  // Серия кончилась — стоит, отдышавшись: главное окно.
  m.data.long = 1;
  m.cd = 2.2 + sim.rng() * 0.8;
  api.setMode(m, 'recover');
}

// ---------------------------------------------------------------------------
// Многорукий: «звезда» ударов во все стороны с просветами, хватка.
// ---------------------------------------------------------------------------

export const STAR = { r: 2.7, arc: 0.52, n: 5, warn: 0.95 };

registerBrain('f8_arms', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        const see = dist < 7 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < STAR.r + 0.2 && m.cd <= 0) {
          // Звезда: пять рук разом, одна — точно на героя; щели между
          // ними шире шага — встань в щель или отойди.
          m.dir = Math.atan2(dy, dx);
          const offset = (sim.rng() - 0.5) * 0.3;
          for (let i = 0; i < STAR.n; i++) {
            api.strike(sim, {
              shape: 'cone',
              x: m.x,
              y: m.y,
              r: STAR.r,
              ang: m.dir + offset + (i / STAR.n) * TAU,
              arc: STAR.arc,
              warn: STAR.warn,
              dmg: m.dmg * 1.2,
              knock: 5,
              art: 'f8_palm',
              from: m.id,
            });
          }
          api.setMode(m, 'star');
          return;
        }
        if (see && dist > 2.6 && dist < 4.6 && m.cd <= 0 && (m.data.grabCd ?? 0) <= 0) {
          m.dir = Math.atan2(dy, dx);
          const len = Math.min(4.4, wallDist(sim, api, m.x, m.y, m.dir, 4.4));
          const s: StrikeIn = {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: 0.45,
            ang: m.dir,
            warn: 0.75,
            dmg: m.dmg * 0.9,
            // Хватка тянет к себе: отброс со знаком минус.
            knock: -14,
            status: 'slow',
            dur: 1.1,
            art: 'f8_grab',
            from: m.id,
          };
          api.strike(sim, s);
          m.data.grabCd = 6;
          api.setMode(m, 'grab');
          return;
        }
        m.data.grabCd = (m.data.grabCd ?? 0) - dt;
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'star': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (m.t > STAR.warn - 0.25) m.danger = STAR.r + 0.4;
        if (m.t >= STAR.warn) {
          sim.events.push({ t: 'boss', what: 'whip' });
          api.setMode(m, 'recover');
          m.cd = 2.4 + sim.rng();
          m.data.long = 1;
        }
        return;
      }
      case 'grab': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (m.t > 0.55) m.danger = 4.6;
        if (m.t >= 0.75) {
          api.setMode(m, 'recover');
          m.cd = 1.2;
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > (m.data.long ? 1.3 : 0.7)) {
          m.data.long = 0;
          api.setMode(m, 'chase');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Демон-паук: нить ложится на пол (вязнет), потом натягивается и режет.
// ---------------------------------------------------------------------------

export const THREAD = { len: 6.2, aim: 0.62, pull: 1.1, cut: 0.55 };

registerBrain('f8_spider', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = dist < 8 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist > 2 && dist < THREAD.len - 0.5 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Держится на расстоянии нити, бегает боком.
        let dir: [number, number];
        if (see && dist < 3)
          dir = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        else if (see && dist < 5) {
          const side = m.id % 2 ? 1 : -1;
          dir = [(-dy / (dist || 1)) * side, (dx / (dist || 1)) * side];
        } else dir = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dir[0], dir[1], m.speed, dt);
        return;
      }
      case 'aim': {
        const T = THREAD.aim;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(THREAD.len, wallDist(sim, api, m.x, m.y, m.dir, THREAD.len));
        m.tele = { shape: 'line', r: len, w: 0.16, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t >= T) {
          spinThread(sim, api, m, len);
          api.setMode(m, 'recover');
          m.cd = 3 + sim.rng() * 1.2;
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api, 2, 1);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.7) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

/**
 * Нить: ряд липких точек по линии (вязнут), а через `THREAD.pull` — метка
 * натяга по всей нити и удар по линии.
 */
function spinThread(sim: Sim, api: SimApi, m: Mob, len: number): void {
  const ux = Math.cos(m.dir);
  const uy = Math.sin(m.dir);
  const life = THREAD.pull + THREAD.cut + 0.35;
  for (let d = 0.6; d <= len; d += 0.7) {
    const z: ZoneIn & { ang: number; seg: number } = {
      x: m.x + ux * d,
      y: m.y + uy * d,
      r: 0.36,
      life,
      slow: 0.45,
      art: 'f8_thread',
      ang: m.dir,
      seg: 0.7,
    };
    api.zone(sim, z);
  }
  // Натяг: метка горит с момента натяга, удар — по всей нити.
  const pending = PENDING.get(sim) ?? [];
  pending.push({
    at: sim.time + THREAD.pull,
    s: {
      shape: 'line',
      x: m.x,
      y: m.y,
      r: len,
      w: 0.3,
      ang: m.dir,
      warn: THREAD.cut,
      dmg: m.dmg * 1.3,
      knock: 3,
      art: 'f8_cut',
    },
  });
  PENDING.set(sim, pending);
  sim.events.push({ t: 'shot', x: m.x, y: m.y, art: 'f8_thread' });
}

/** Отложенные удары (натяг нитей): не привязаны к мобу — паук мог умереть. */
const PENDING = new WeakMap<Sim, { at: number; s: StrikeIn }[]>();

// ---------------------------------------------------------------------------
// Фонарный дух: парит над пропастью, плюётся огоньками, выдыхается.
// ---------------------------------------------------------------------------

registerBrain('f8_lantern', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    if (m.mode === 'f8_rise') {
      // Поднимается из пропасти: недосягаем, пока не поднялся.
      m.data.ghost = m.t < 0.7 ? 1 : 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.9) {
        m.data.ghost = 0;
        api.setMode(m, 'chase');
        m.cd = 0.8;
      }
      return;
    }
    switch (m.mode) {
      case 'chase': {
        const see = dist < 8 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < 6.2 && dist > 1.6 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Держится на 3–5 клетках, над пропастью — охотнее: там не достать.
        const want = 4.2;
        let tx = h.x - (dx / (dist || 1)) * want;
        let ty = h.y - (dy / (dist || 1)) * want;
        const side = m.id % 2 ? 1 : -1;
        const a = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.5 * dt;
        tx = h.x + Math.cos(a) * want;
        ty = h.y + Math.sin(a) * want;
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        const d2 = hypot(tx - m.x, ty - m.y);
        api.steer(sim, m, cx, cy, m.speed * Math.min(1, d2 / 1.5), dt);
        return;
      }
      case 'aim': {
        const T = c.def.windup;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < T * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: 3.4, arc: 0.7, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t >= T) {
          api.shoot(sim, m, m.dir);
          api.setMode(m, 'gutter');
          m.cd = 3.2 + sim.rng();
        }
        return;
      }
      case 'gutter': {
        // Выдохся: пламя низко, опускается к герою — бей.
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, dist > 1.3 ? m.speed * 0.8 : 0, dt);
        if (m.t > 1.5) api.setMode(m, 'chase');
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    // Лопнул — масло горит на полу (если под ним пол).
    if (api.solidTile(sim, Math.floor(m.x), Math.floor(m.y))) return;
    api.zone(sim, {
      x: m.x,
      y: m.y,
      r: 0.8,
      life: 2.4,
      dps: 0.025,
      status: 'burn',
      dur: 0.8,
      warn: 0.25,
      art: 'f8_oil',
    });
  },
});

// ---------------------------------------------------------------------------
// Демон-барабанщик: боковые барабаны — когти по полу, брюхо — поворот.
// ---------------------------------------------------------------------------

export const CLAW = { len: 5.5, gap: 0.95, warn: 0.75 };

function inDrumRoom(d: DrumRoom | null, x: number, y: number): boolean {
  return !!d && x >= d.x0 && x <= d.x1 + 1 && y >= d.y0 && y <= d.y1 + 1;
}

registerBrain('f8_drum', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) return;
    const h = sim.hero;
    const st = stateOf(sim, api);
    const drum = st.drum;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    const home = drum && m.data.home ? drum : null;
    switch (m.mode) {
      case 'chase': {
        const see = dist < 8 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        const heroIn = inDrumRoom(home, h.x, h.y);
        // Брюхо: в своей комнате — поворот; вне — волна.
        if (see && m.cd <= 0 && (m.data.turnCd ?? 0) <= 0 && (heroIn || dist < 2.6)) {
          api.setMode(m, 'belly');
          m.data.turnCd = 7;
          if (heroIn && home) startDrumTurn(sim, api, st);
          else
            api.strike(sim, {
              shape: 'ring',
              x: m.x,
              y: m.y,
              r: 2.1,
              w: 0.55,
              warn: 1.05,
              dmg: m.dmg * 1.1,
              knock: 8,
              art: 'f8_boom',
              from: m.id,
            });
          return;
        }
        m.data.turnCd = (m.data.turnCd ?? 0) - dt;
        if (see && dist > 2 && dist < CLAW.len && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'side');
          const ux = Math.cos(m.dir);
          const uy = Math.sin(m.dir);
          for (const k of [-1, 0, 1]) {
            api.strike(sim, {
              shape: 'line',
              x: m.x - uy * k * CLAW.gap,
              y: m.y + ux * k * CLAW.gap,
              r: CLAW.len,
              w: 0.26,
              ang: m.dir,
              warn: CLAW.warn + Math.abs(k) * 0.12,
              dmg: m.dmg,
              knock: 3,
              art: 'f8_claw',
              from: m.id,
            });
          }
          m.data.left = m.data.left ? 0 : 1;
          return;
        }
        // Держит дистанцию, в своей комнате — у середины.
        let tx = h.x;
        let ty = h.y;
        if (home) {
          tx = home.cx + 0.5 + (h.x - home.cx - 0.5) * 0.35;
          ty = home.cy + 0.5 + (h.y - home.cy - 0.5) * 0.35;
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        const d2 = hypot(tx - m.x, ty - m.y);
        const k = !home && dist < 2.4 ? -0.5 : d2 < 0.8 ? 0 : 1;
        api.steer(sim, m, cx * k, cy * k, m.speed, dt);
        if (k <= 0) m.face = Math.atan2(dy, dx);
        return;
      }
      case 'side':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (m.t > CLAW.warn - 0.22) m.danger = CLAW.len;
        if (m.t >= CLAW.warn + 0.1) {
          if (drum) drum.beat = sim.time;
          F8_CLOCK.beat = sim.time;
          api.setMode(m, 'recover');
          m.cd = 1.8 + sim.rng() * 0.8;
          m.data.long = 1;
        }
        return;
      case 'belly':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.8) m.danger = 2.8;
        if (m.t >= SHIFT_WARN) {
          if (drum) drum.beat = sim.time;
          F8_CLOCK.beat = sim.time;
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
          api.setMode(m, 'recover');
          m.cd = 1.2;
          m.data.long = 1;
        }
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > (m.data.long ? 1.2 : 0.6)) {
          m.data.long = 0;
          api.setMode(m, 'chase');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

/** Поворот вертушки Барабанной: предупреждение, потом клетки. */
function startDrumTurn(sim: Sim, api: SimApi, st: F8State): void {
  const d = st.drum;
  if (!d || d.at) return;
  d.at = sim.time + SHIFT_WARN;
  const next = d.arms.map(([x, y]) => [-y, x] as [number, number]);
  const W = sim.world.w;
  const toWall: number[] = [];
  const toFloor: number[] = [];
  const now = new Set(d.arms.map(([x, y]) => (d.cy + y) * W + d.cx + x));
  const after = new Set(next.map(([x, y]) => (d.cy + y) * W + d.cx + x));
  for (const i of after) if (!now.has(i)) toWall.push(i);
  for (const i of now) if (!after.has(i)) toFloor.push(i);
  const z: ZoneIn & { cells: number[]; open: number[]; w: number } = {
    x: d.cx + 0.5,
    y: d.cy + 0.5,
    r: 7,
    life: SHIFT_WARN,
    art: 'f8_shift',
    cells: toWall,
    open: toFloor,
    w: W,
  };
  api.zone(sim, z);
  sim.events.push({ t: 'boss', what: 'f8_drum_call' });
}

function applyDrumTurn(sim: Sim, api: SimApi, st: F8State): void {
  const d = st.drum;
  if (!d) return;
  d.at = 0;
  const W = sim.world.w;
  const next = d.arms.map(([x, y]) => [-y, x] as [number, number]);
  const now = new Set(d.arms.map(([x, y]) => (d.cy + y) * W + d.cx + x));
  const after = new Set(next.map(([x, y]) => (d.cy + y) * W + d.cx + x));
  for (const i of now)
    if (!after.has(i)) api.setTile(sim, i % W, Math.floor(i / W), T8.Floor, M.drumFloor);
  const walls: number[] = [];
  for (const i of after)
    if (!now.has(i)) {
      api.setTile(sim, i % W, Math.floor(i / W), T8.Wall, M.drumWall);
      walls.push(i);
    }
  d.arms = next;
  d.turns += 1;
  evictFrom(sim, api, walls);
  sim.hitstop = Math.max(sim.hitstop, 0.08);
  sim.events.push({ t: 'boss', what: 'f8_turn_wall' });
  const s = STATE.get(sim)!;
  say(sim, s, 'f8_turn', 'КОМНАТА ПОВЕРНУЛАСЬ', 'удар в барабан — стены сменили место', 90);
}

// ---------------------------------------------------------------------------
// Бива-струнник: играет — перегородки его крыла ездят. Подошёл — исчез.
// ---------------------------------------------------------------------------

registerBrain('f8_biwa', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.vx *= 0.7;
    m.vy *= 0.7;
    m.face = Math.atan2(dy, dx);
    switch (m.mode) {
      case 'chase':
      case 'f8_play': {
        if (m.mode === 'chase') api.setMode(m, 'f8_play');
        // Подошёл вплотную — рвёт струну и исчезает (не чаще раза в 5 с).
        if (dist < 3.2 && m.cd <= 0 && (m.data.vanish ?? 0) < 3) {
          api.setMode(m, 'f8_vanish');
          m.tele = { shape: 'ring', r: 1.2, w: 0.2, k: 0 };
          return;
        }
        return;
      }
      case 'f8_strum':
        if (m.t > 0.7) api.setMode(m, 'f8_play');
        return;
      case 'f8_vanish': {
        m.tele = { shape: 'ring', r: 1.2, w: 0.2, k: Math.min(1, m.t / 0.5) };
        if (m.t > 0.35) m.danger = 1.8;
        if (m.t >= 0.5) {
          // Волна от струны — отталкивает, бьёт слабо.
          if (dist < 1.8 && canHit(sim))
            api.hurtHero(sim, m.dmg + rawShare(sim, 0.04), m.x, m.y, 7);
          const spot = biwaSpot(sim, api, m);
          m.data.ghost = 1;
          if (spot) {
            m.data.tx = spot[0];
            m.data.ty = spot[1];
            api.zone(sim, { x: spot[0], y: spot[1], r: 0.7, life: 0.7, art: 'f8_note' });
          }
          api.setMode(m, 'f8_gone');
          sim.events.push({ t: 'boss', what: 'f8_string_call' });
        }
        return;
      }
      case 'f8_gone':
        m.data.ghost = 1;
        if (m.t >= 0.7) {
          if (m.data.tx !== undefined) {
            m.x = m.data.tx;
            m.y = m.data.ty;
          }
          m.data.ghost = 0;
          m.data.vanish = (m.data.vanish ?? 0) + 1;
          m.cd = 5;
          api.setMode(m, 'f8_play');
        }
        return;
      case 'stun':
        if (m.t > 0.25) api.setMode(m, 'f8_play');
        return;
      default:
        api.setMode(m, 'f8_play');
    }
    void h;
    void dt;
  },
  onDeath(sim, m, _mode, api) {
    const st = stateOf(sim, api);
    for (const g of st.groups)
      if (g.biwa === m.id) {
        g.frozen = true;
        g.at = 0;
        sim.events.push({
          t: 'boss',
          what: 'f8_string_call',
          text: 'СТРУНА ОБОРВАЛАСЬ',
          sub: g.id === 0 ? 'Зал струны замер' : 'крыло замерло — стены стоят',
        });
      }
  },
});

/** Куда перенесётся бива: пол в 6–12 клетках от помоста, подальше от героя. */
function biwaSpot(sim: Sim, api: SimApi, m: Mob): [number, number] | null {
  const h = sim.hero;
  const ox = m.data.sx ?? m.x;
  const oy = m.data.sy ?? m.y;
  let best: [number, number] | null = null;
  let bs = -1e9;
  for (let k = 0; k < 40; k++) {
    const a = sim.rng() * TAU;
    const r = 2 + sim.rng() * 8;
    const x = Math.floor(ox + Math.cos(a) * r);
    const y = Math.floor(oy + Math.sin(a) * r);
    if (api.solidTile(sim, x, y) || api.inArena(sim, x + 0.5, y + 0.5)) continue;
    if (sim.flow[y * sim.world.w + x] < 0) continue;
    const d = hypot(x + 0.5 - h.x, y + 0.5 - h.y);
    if (d < 5) continue;
    const s = Math.min(d, 9) - hypot(x - ox, y - oy) * 0.3;
    if (s > bs) {
      bs = s;
      best = [x + 0.5, y + 0.5];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Глазастые сёдзи: глаза открываются, когти сквозь бумагу, потом открыты.
// ---------------------------------------------------------------------------

export const EYES = { peek: 0.75, warn: 0.55, len: 3.2, open: 1.1 };

registerBrain('f8_eyes', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    // Прибит к стене: не сдвинуть и не столкнуть.
    m.x = m.data.ax ?? m.x;
    m.y = m.data.ay ?? m.y;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    switch (m.mode) {
      case 'chase':
      case 'f8_hide': {
        if (m.mode === 'chase') api.setMode(m, 'f8_hide');
        m.data.ghost = 1;
        // Смотрит, когда рядом: вниз, от стены.
        const see = dist < 4.2 && dy > -0.3 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f8_peek');
        }
        return;
      }
      case 'f8_peek': {
        // Глаза открыты: видно, что сейчас ударит. Прицел доводится.
        m.data.ghost = 1;
        m.dir = Math.atan2(dy, dx);
        // Когти идут вниз, от стены: не вверх, в бумагу.
        if (m.dir < 0.25) m.dir = dx >= 0 ? 0.25 : Math.PI - 0.25;
        if (m.t >= EYES.peek) {
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y - 0.35,
            r: EYES.len + 0.35,
            w: 0.4,
            ang: m.dir,
            warn: EYES.warn,
            dmg: m.dmg * 1.2,
            knock: 4,
            art: 'f8_claws',
            from: m.id,
          });
          api.setMode(m, 'f8_thrust');
        }
        return;
      }
      case 'f8_thrust':
        m.data.ghost = 0;
        if (m.t > EYES.warn - 0.22) m.danger = EYES.len + 0.6;
        if (m.t >= EYES.warn) api.setMode(m, 'f8_open');
        return;
      case 'f8_open':
        // Руки снаружи — открыт.
        m.data.ghost = 0;
        if (m.t >= EYES.open) {
          api.setMode(m, 'f8_hide');
          m.data.ghost = 1;
          m.cd = 1.8 + sim.rng();
        }
        return;
      case 'stun':
        m.data.ghost = 0;
        if (m.t > 0.2) api.setMode(m, 'f8_open');
        return;
      default:
        api.setMode(m, 'f8_hide');
    }
    void dt;
  },
});

// ---------------------------------------------------------------------------
// Бес-казначей: удирает, ныряет в дверь и выходит из другой.
// ---------------------------------------------------------------------------

registerBrain('f8_miser', {
  step(sim, m, dt, c, api) {
    if (outStep(m, api)) {
      if (m.mode === 'chase') api.setMode(m, 'flee');
      return;
    }
    const h = sim.hero;
    const { dist } = c;
    m.tele = null;
    m.danger = 0;
    const st = stateOf(sim, api);
    switch (m.mode) {
      case 'chase':
      case 'flee': {
        if (m.mode === 'chase') api.setMode(m, 'flee');
        // Дверь рядом и герой близко — нырнуть (до трёх раз).
        if (dist < 5 && (m.data.dives ?? 0) < 3 && m.cd <= 0) {
          const door = st.doors.find(
            (d) => hypot(d.ox + 0.5 - m.x, d.oy + 0.5 - m.y) < 1.4 && d.ready <= sim.time,
          );
          if (door) {
            m.data.dx = door.ox + 0.5;
            m.data.dy = door.oy + 0.2;
            api.setMode(m, 'f8_dive');
            if (door.obj)
              DOOR_OPEN.set(door.obj, { at: sim.time, until: sim.time + 0.7, gold: true });
            return;
          }
        }
        const away = api.flowDir(sim, m.x, m.y, true);
        let [ax, ay] = away ?? [m.x - h.x, m.y - h.y];
        // К ближней двери, если она не в сторону героя.
        const door = st.doors
          .filter((d) => d.ready <= sim.time)
          .map((d) => ({ d, k: hypot(d.ox + 0.5 - m.x, d.oy + 0.5 - m.y) }))
          .filter((o) => o.k < 6)
          .sort((a, b) => a.k - b.k)[0];
        if (door && dist < 6) {
          const tx = door.d.ox + 0.5 - m.x;
          const ty = door.d.oy + 0.5 - m.y;
          const toHero =
            (tx * (h.x - m.x) + ty * (h.y - m.y)) / ((hypot(tx, ty) || 1) * (dist || 1));
          if (toHero < 0.3) {
            const [cx, cy] = api.chaseDir(sim, m, door.d.ox + 0.5, door.d.oy + 0.5);
            ax = cx;
            ay = cy;
          }
        }
        const l = hypot(ax, ay) || 1;
        api.steer(sim, m, ax / l, ay / l, m.speed * (dist < 3 ? 1.2 : 0.9), dt);
        return;
      }
      case 'f8_dive': {
        m.data.ghost = 1;
        m.vx = (m.data.dx - m.x) * 6;
        m.vy = (m.data.dy - m.y) * 6;
        if (m.t > 0.35) {
          // Выйдет из другой двери, подальше.
          const far = pickDoor(sim, api, st, 9, 18);
          m.data.dives = (m.data.dives ?? 0) + 1;
          if (far) {
            openDoor(sim, st, far, [], { mob: m.id });
            api.setMode(m, 'f8_hidden');
          } else {
            m.data.ghost = 0;
            api.setMode(m, 'flee');
          }
          m.cd = 3;
        }
        return;
      }
      case 'f8_hidden':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        // Двери не нашлось — выходит там же.
        if (m.t > 4) {
          m.data.ghost = 0;
          api.setMode(m, 'flee');
        }
        return;
      default:
        api.setMode(m, 'flee');
    }
  },
});

// ---------------------------------------------------------------------------
// Луна финала: светит, кружит, пускает полумесяц через арену.
// ---------------------------------------------------------------------------

registerBrain('f8_moon', {
  raw: true,
  step(sim, m, dt, _c, api) {
    m.data.ghost = 1;
    m.tele = null;
    m.danger = 0;
    const b = sim.boss;
    if (!b || b.state !== 'fight' || b.phase < 3) {
      m.hp = 0;
      m.mode = 'dying';
      m.t = 0;
      return;
    }
    const cx = b.data.acx ?? m.x;
    const cy = b.data.acy ?? m.y;
    m.data.ang = (m.data.ang ?? 0) + dt * 0.22;
    const R = m.data.rad ?? 7;
    const tx = cx + Math.cos(m.data.ang) * R;
    const ty = cy + Math.sin(m.data.ang) * R * 0.85;
    m.vx = (tx - m.x) * 3;
    m.vy = (ty - m.y) * 3;
    m.x += m.vx * dt;
    m.y += m.vy * dt;
    m.vx = 0;
    m.vy = 0;
    m.face = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
    // Луч — когда сценарий скажет (по очереди, не больше одного разом).
    if (m.data.fire && !heroDown(sim)) {
      m.data.fire = 0;
      const a = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
      m.data.vFire = m.t; // v2.86 — только рисунок
      m.data.vRay = a; // v2.86 — только рисунок
      api.strike(sim, {
        shape: 'line',
        x: m.x,
        y: m.y,
        r: 16,
        w: 0.42,
        ang: a,
        warn: 1.15,
        dmg: m.dmg * 1.1,
        knock: 4,
        art: 'f8_moonray',
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Демон семи лун. Ведёт все режимы сам.
//   chase   — идёт на героя, выбирает: веер, выпад, рез вплотную,
//             отложенные метки (фаза 1+), залп серпов (2+), кольца дуг (3);
//   fan     — веер полумесяцев: конусы разной длины с просветами;
//   aim/dash — выпад по линии, за ним — след серпа;
//   sweep   — рез вплотную (широкий конус);
//   eyes    — «шесть глаз»: три метки на месте героя, бьют позже;
//   volley  — летящие серпы веером (стены ширм их держат);
//   rings   — дуги по всей арене с узким окном;
//   phase   — смена фазы (недосягаем, арена меняется);
//   recover — окно.
// ---------------------------------------------------------------------------

export const BOSS8 = {
  /** Длина меча по фазам: растёт. */
  blade: [1, 1.1, 1.35, 1.65],
  fanWarn: 0.8,
  fanArc: 0.24,
  fanGap: 0.36,
  sweepR: 2.3,
  sweepWarn: 0.62,
  dashLen: 6,
  dashAim: 0.72,
  dashSpeed: 13,
  eyesWarn: [1.5, 1.85, 2.2],
  ringWarn: [1.05, 1.45, 1.85],
  ringR: [2.4, 4.7, 7],
  phaseT: 2.2,
};

const hasteOf = (sim: Sim) => {
  const p = sim.boss?.phase ?? 0;
  return p >= 3 ? 1.18 : p >= 2 ? 1.1 : p >= 1 ? 1.05 : 1;
};

/** Веер полумесяцев: `n` конусов разной длины, средний — на героя. */
function crescentFan(sim: Sim, api: SimApi, m: Mob, n: number, warn: number, turn = 0): void {
  const phase = sim.boss?.phase ?? 0;
  const L = BOSS8.blade[phase];
  const step = BOSS8.fanArc + BOSS8.fanGap;
  const lens = [3.4, 5.4, 4.2, 6.2, 3.8, 5.8, 4.6];
  const shift = (sim.rng() - 0.5) * 0.12 + turn;
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: lens[(i + (m.data.fans ?? 0)) % lens.length] * L,
      ang: m.dir + shift + k * step,
      arc: BOSS8.fanArc,
      warn,
      dmg: m.dmg * 1.2,
      knock: 6,
      art: 'f8_crescent',
      from: m.id,
    });
  }
  m.data.fans = (m.data.fans ?? 0) + 1;
}

/** Кольцо дуг с окном: круги по окружности, кроме окна в две-три клетки. */
function ringOfArcs(
  sim: Sim,
  api: SimApi,
  m: Mob,
  R: number,
  warn: number,
  win: number,
  winW: number,
): void {
  const n = Math.max(8, Math.round((TAU * R) / 0.95));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    if (Math.abs(angDiff(a, win)) < winW / R / 2) continue;
    const x = m.x + Math.cos(a) * R;
    const y = m.y + Math.sin(a) * R;
    const s: StrikeIn & { ang0: number; R: number; cx: number; cy: number } = {
      shape: 'circle',
      x,
      y,
      r: 0.62,
      warn,
      dmg: m.dmg * 1.3,
      knock: 5,
      art: 'f8_arc',
      from: m.id,
      ang0: a,
      R,
      cx: m.x,
      cy: m.y,
    };
    api.strike(sim, s);
  }
}

function startDash(sim: Sim, m: Mob, api: SimApi): void {
  m.dir = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
  api.setMode(m, 'aim');
}

registerBrain('f8boss', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const b = sim.boss;
    const { dx, dy, dist } = c;
    const phase = b?.phase ?? 0;
    const haste = hasteOf(sim);
    const L = BOSS8.blade[phase];
    m.tele = null;
    m.danger = 0;
    m.data.blade = L;
    m.data.phase = phase;
    m.data.eyesCd = (m.data.eyesCd ?? 4) - dt;
    m.data.volleyCd = (m.data.volleyCd ?? 3) - dt;
    m.data.ringCd = (m.data.ringCd ?? 3) - dt;
    if (heroDown(sim)) {
      m.vx *= 0.85;
      m.vy *= 0.85;
      m.bounce = false;
      if (m.mode !== 'roar') api.setMode(m, 'roar');
      return;
    }
    switch (m.mode) {
      case 'roar':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.face = Math.atan2(dy, dx);
        if (m.t > 1.6) api.setMode(m, 'chase');
        return;
      case 'phase':
        // Смена фазы: недосягаем, пока меняется арена.
        m.data.ghost = 1;
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.face = Math.atan2(dy, dx);
        if (m.t > BOSS8.phaseT) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
          m.cd = 0.4;
        }
        return;
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const close = dist < 2.6;
        api.steer(sim, m, cx, cy, m.speed * haste * (close ? 0.3 : 1), dt);
        if (m.t < 0.55 / haste || m.cd > 0) return;
        if (dist < BOSS8.sweepR * L * 0.8) {
          m.dir = Math.atan2(dy, dx);
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: BOSS8.sweepR * L,
            ang: m.dir,
            arc: 2.5,
            warn: BOSS8.sweepWarn / haste,
            dmg: m.dmg * 1.6,
            knock: 8,
            art: 'f8_sweep',
            from: m.id,
          });
          api.setMode(m, 'sweep');
          return;
        }
        // Финал: кольца дуг через всю арену.
        if (phase >= 3 && m.data.ringCd <= 0 && see) {
          api.setMode(m, 'rings');
          m.data.ringCd = 9;
          m.data.rings = 0;
          return;
        }
        // Шесть глаз: отложенные метки.
        if (phase >= 1 && m.data.eyesCd <= 0 && dist < 9) {
          api.setMode(m, 'eyes');
          m.data.eyesCd = phase >= 2 ? 8 : 6.5;
          m.data.marks = 0;
          return;
        }
        // Лунный серп: залп летящих серпов.
        if (phase >= 2 && m.data.volleyCd <= 0 && see && dist > 3) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'volley');
          m.data.volleyCd = 7.5;
          m.data.shots = 0;
          return;
        }
        if (see && dist < 5.2 * L) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'fan');
          crescentFan(sim, api, m, phase >= 2 ? 7 : 5, BOSS8.fanWarn / haste);
          return;
        }
        if (see && dist > 4) {
          startDash(sim, m, api);
          return;
        }
        return;
      }
      case 'fan': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        const T = BOSS8.fanWarn / haste;
        if (m.t > T - 0.25) m.danger = 6 * L;
        // Эхо в «шести глазах»: второй веер, повёрнутый, чуть позже.
        if (phase >= 2 && !m.data.echo && m.t >= T * 0.55) {
          m.data.echo = 1;
          crescentFan(sim, api, m, 4, T * 1.05, (BOSS8.fanArc + BOSS8.fanGap) / 2);
        }
        if (m.t >= T + (m.data.echo ? T * 0.45 : 0)) {
          m.data.echo = 0;
          sim.events.push({ t: 'boss', what: 'whip' });
          api.setMode(m, 'recover');
          m.data.rec = 1.05;
        }
        return;
      }
      case 'sweep': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        const T = BOSS8.sweepWarn / haste;
        if (m.t > T - 0.22) m.danger = BOSS8.sweepR * L + 0.5;
        if (m.t >= T) {
          sim.events.push({ t: 'boss', what: 'whip' });
          api.setMode(m, 'recover');
          m.data.rec = 0.75;
        }
        return;
      }
      case 'aim': {
        const T = BOSS8.dashAim / haste;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(
          BOSS8.dashLen,
          wallDist(sim, api, m.x, m.y, m.dir, BOSS8.dashLen) - 0.6,
        );
        m.data.len = Math.max(1, len);
        m.tele = {
          shape: 'line',
          r: m.data.len + m.r,
          w: m.r * 0.9,
          ang: m.dir,
          k: Math.min(1, m.t / T),
        };
        if (m.t > T - 0.25) m.danger = 3.5;
        if (m.t >= T) {
          m.data.hit = 0;
          m.data.x0 = m.x;
          m.data.y0 = m.y;
          m.bounce = true;
          api.setMode(m, 'dash');
          sim.events.push({ t: 'boss', what: 'roll' });
        }
        return;
      }
      case 'dash': {
        const s = BOSS8.dashSpeed * haste;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = m.r + h.r + 1;
        if (!m.data.hit && dist < m.r + h.r + 0.2 && canHit(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.6, m.x, m.y, 9, m.kind);
        }
        if (m.t >= m.data.len / s) endBossDash(sim, m, api);
        return;
      }
      case 'eyes': {
        // Три взмаха по воздуху: каждый оставляет метку там, где герой
        // сейчас, — и она бьёт позже. Метки держатся дольше обычного.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        const at = [0.15, 0.55, 0.95];
        const k = m.data.marks ?? 0;
        if (k < 3 && m.t >= at[k] / haste) {
          m.data.marks = k + 1;
          const a = sim.rng() * Math.PI;
          const s: StrikeIn & { eye: number } = {
            shape: 'line',
            x: h.x - Math.cos(a) * 3.6 * L,
            y: h.y - Math.sin(a) * 3.6 * L,
            r: 7.2 * L,
            w: 0.48,
            ang: a,
            warn: BOSS8.eyesWarn[k],
            dmg: m.dmg * 1.35,
            knock: 5,
            art: 'f8_eyeslash',
            from: m.id,
            eye: k,
          };
          api.strike(sim, s);
          sim.events.push({ t: 'boss', what: 'whip' });
        }
        if (m.t >= 1.3 / haste) {
          api.setMode(m, 'recover');
          m.data.rec = 0.7;
        }
        return;
      }
      case 'volley': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < 0.45) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const T = 0.85 / haste;
        m.tele = { shape: 'cone', r: 4.5, arc: 1.3, ang: m.dir, k: Math.min(1, m.t / T) };
        const shots = m.data.shots ?? 0;
        const due = [T, T + 0.75];
        if (shots < 2 && m.t >= due[shots]) {
          api.shoot(sim, m, m.dir + (shots ? 0.13 : 0), {
            speed: 5.6,
            r: 0.34,
            life: 3.4,
            dmg: 0.95,
            art: 'f8_serp',
            n: 5,
            spread: 1.5,
          });
          m.data.shots = shots + 1;
          sim.events.push({ t: 'boss', what: 'whip' });
        }
        if (m.t >= T + 1.2) {
          api.setMode(m, 'recover');
          m.data.rec = 0.9;
        }
        return;
      }
      case 'rings': {
        // Меч вверх — три кольца дуг, каждое со своим окном.
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.face = Math.atan2(dy, dx);
        const k = m.data.rings ?? 0;
        if (k === 0 && m.t >= 0.15) {
          m.data.rings = 1;
          const toHero = Math.atan2(dy, dx);
          for (let i = 0; i < 3; i++) {
            // Окно не там, где стоит герой: придётся бежать к нему.
            const win = toHero + (i % 2 ? 1 : -1) * (0.9 + sim.rng() * 1.6);
            ringOfArcs(sim, api, m, BOSS8.ringR[i], BOSS8.ringWarn[i] / haste, win, 2.4);
          }
          sim.events.push({ t: 'boss', what: 'f8_rings_call' });
        }
        if (m.t > 0.6) m.danger = 8;
        if (m.t >= BOSS8.ringWarn[2] / haste + 0.1) {
          api.setMode(m, 'recover');
          m.data.rec = 1.1;
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > (m.data.rec ?? 0.8) / haste) {
          m.data.rec = 0;
          api.setMode(m, 'chase');
          m.cd = 0.25;
        }
        return;
      default:
        m.bounce = false;
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'dash') return;
    endBossDash(sim, m, api);
  },
});

/** Конец выпада: за спиной — след серпа по пройденной линии. */
function endBossDash(sim: Sim, m: Mob, api: SimApi): void {
  m.bounce = false;
  m.vx = 0;
  m.vy = 0;
  const x0 = m.data.x0 ?? m.x;
  const y0 = m.data.y0 ?? m.y;
  const len = hypot(m.x - x0, m.y - y0);
  if (len > 0.8)
    api.strike(sim, {
      shape: 'line',
      x: x0,
      y: y0,
      r: len,
      w: 0.55,
      ang: Math.atan2(m.y - y0, m.x - x0),
      warn: 0.42,
      dmg: m.dmg * 1.2,
      knock: 4,
      art: 'f8_trail',
      from: m.id,
    });
  api.setMode(m, 'recover');
  m.data.rec = 1.05;
}

// ---------------------------------------------------------------------------
// Сценарий боя: фазы, засечки, арена.
// ---------------------------------------------------------------------------

export const NOTCHES8 = [0.75, 0.5, 0.25];

interface ArenaCell {
  i: number;
  x: number;
  y: number;
  mark: number;
}

const ARENA = new WeakMap<Sim, { pits: ArenaCell[]; screens: ArenaCell[] }>();

function arenaOf(sim: Sim, b: BossFight): { pits: ArenaCell[]; screens: ArenaCell[] } {
  let a = ARENA.get(sim);
  if (!a) {
    const W = sim.world.w;
    const pits: ArenaCell[] = [];
    const screens: ArenaCell[] = [];
    for (const i of b.cells) {
      const k = sim.world.mark[i];
      const c = { i, x: i % W, y: Math.floor(i / W), mark: k };
      if (k === M.moonPit) pits.push(c);
      else if (k === M.moonScreen) screens.push(c);
    }
    a = { pits, screens };
    ARENA.set(sim, a);
  }
  return a;
}

/** Предупреждение на клетках арены: дрожит, потом меняется. */
function warnCells(
  sim: Sim,
  api: SimApi,
  cells: ArenaCell[],
  kind: 'wall' | 'pit' | 'open',
  warn: number,
): void {
  if (!cells.length) return;
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    sx += c.x;
    sy += c.y;
  }
  const z: ZoneIn & { cells: number[]; open: number[]; pit: number; w: number } = {
    x: sx / cells.length + 0.5,
    y: sy / cells.length + 0.5,
    r: 12,
    life: warn,
    art: 'f8_shift',
    cells: kind === 'open' ? [] : cells.map((c) => c.i),
    open: kind === 'open' ? cells.map((c) => c.i) : [],
    pit: kind === 'pit' ? 1 : 0,
    w: sim.world.w,
  };
  api.zone(sim, z);
}

function spawnMoons(sim: Sim, api: SimApi, b: BossFight): void {
  const cx = b.data.acx;
  const cy = b.data.acy;
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const mm = api.spawnMob(sim, 'f8_moon', cx + Math.cos(a) * 7, cy + Math.sin(a) * 6, {
      mode: 'orbit',
    });
    mm.data.ghost = 1;
    mm.data.ang = a;
    mm.data.rad = 7.2;
    mm.data.n = i;
    mm.cd = 0;
  }
  b.data.moonTurn = 0;
  b.data.moonNext = sim.time + 3.2;
}

registerBoss('f8boss', {
  start(sim, b, lead, api) {
    b.phase = 0;
    lead.face = Math.PI / 2;
    lead.data.eyesCd = 5;
    lead.data.volleyCd = 3;
    lead.data.ringCd = 2;
    // Середина арены — для лун и кругов.
    let sx = 0;
    let sy = 0;
    const W = sim.world.w;
    for (const i of b.cells) {
      sx += i % W;
      sy += Math.floor(i / W);
    }
    b.data.acx = sx / b.cells.size + 0.5;
    b.data.acy = sy / b.cells.size + 0.5;
    b.data.intro = 0;
    b.data.at = 0;
    arenaOf(sim, b);
    void api;
  },
  step(sim, b, _dt, api) {
    const lead = sim.mobs.find((m) => m.kind === 'f8boss' && m.mode !== 'dying');
    if (!lead) return;
    const a = arenaOf(sim, b);
    // Вход: имя уже сказано движком — через миг первая луна.
    if (!b.data.intro && b.t > 2.4) {
      b.data.intro = 1;
      sim.events.push({
        t: 'boss',
        what: 'f8_moon_call',
        text: 'ПЕРВАЯ ЛУНА',
        sub: 'веер полумесяцев — встань в просвет',
      });
    }
    const k = lead.hp / lead.maxHp;
    const next = (p: number, text: string, sub: string) => {
      b.phase = p;
      b.data.at = sim.time + BOSS8.phaseT * 0.75;
      api.setMode(lead, 'phase');
      lead.data.ghost = 1;
      sim.strikes = sim.strikes.filter((s) => s.from !== lead.id);
      sim.events.push({ t: 'boss', what: 'phase', text, sub });
    };
    if (b.phase === 0 && k < NOTCHES8[0]) {
      next(1, 'ШЕСТЬ ГЛАЗ', 'удары запаздывают — следи за метками');
      warnCells(sim, api, a.pits, 'pit', BOSS8.phaseT * 0.75);
      b.data.todo = 1;
    }
    if (b.phase === 1 && k < NOTCHES8[1]) {
      next(2, 'ЛУННЫЙ СЕРП', 'меч вырос — прячься за ширмы');
      warnCells(sim, api, a.screens, 'wall', BOSS8.phaseT * 0.75);
      b.data.todo = 2;
    }
    if (b.phase === 2 && k < NOTCHES8[2]) {
      next(3, 'СЕМЬ ЛУН', 'дуги по всей арене — ищи окно');
      warnCells(sim, api, a.screens, 'open', BOSS8.phaseT * 0.75);
      b.data.todo = 3;
    }
    // Перемена арены — по концу предупреждения.
    if (b.data.todo && sim.time >= b.data.at) {
      const todo = b.data.todo;
      b.data.todo = 0;
      if (todo === 1) {
        for (const c of a.pits) api.setTile(sim, c.x, c.y, T8.Deep, M.abyssMoon);
        evictFrom(
          sim,
          api,
          a.pits.map((c) => c.i),
        );
        sim.events.push({ t: 'boss', what: 'f8_pit_wall' });
        // Шесть глаз на полу арены — картинка, смотрят.
        for (let i = 0; i < 6; i++) {
          const ang = (i / 6) * TAU + 0.3;
          api.zone(sim, {
            x: b.data.acx + Math.cos(ang) * 6.5,
            y: b.data.acy + Math.sin(ang) * 7.5,
            r: 0.8,
            life: 1e6,
            art: 'f8_floor_eye',
          });
        }
      }
      if (todo === 2) {
        for (const c of a.screens) api.setTile(sim, c.x, c.y, T8.Wall, M.shift0);
        evictFrom(
          sim,
          api,
          a.screens.map((c) => c.i),
        );
        sim.events.push({ t: 'boss', what: 'f8_screen_wall' });
      }
      if (todo === 3) {
        for (const c of a.screens) api.setTile(sim, c.x, c.y, T8.Floor, M.moonScreen);
        spawnMoons(sim, api, b);
        sim.events.push({ t: 'boss', what: 'f8_moons_call' });
      }
    }
    // Лучи лун: одна за другой, раз в 2,6 с (не во время смены фазы).
    if (b.phase >= 3 && !b.data.todo && sim.time >= (b.data.moonNext ?? 0)) {
      const turn = b.data.moonTurn ?? 0;
      const moon = sim.mobs.find(
        (m) => m.kind === 'f8_moon' && m.data.n === turn && m.mode !== 'dying',
      );
      if (moon) moon.data.fire = 1;
      b.data.moonTurn = (turn + 1) % 7;
      b.data.moonNext = sim.time + 2.6;
    }
  },
  notches: () => NOTCHES8,
  reset(sim, b) {
    // Арена — как до боя: пол на месте, ширм нет, лун нет.
    const a = ARENA.get(sim);
    if (a) {
      for (const c of a.pits) {
        sim.tiles[c.i] = T8.Floor;
        sim.world.mark[c.i] = M.moonPit;
        sim.retiled.push(c.i);
      }
      for (const c of a.screens) {
        sim.tiles[c.i] = T8.Floor;
        sim.world.mark[c.i] = M.moonScreen;
        sim.retiled.push(c.i);
      }
    }
    sim.mobs = sim.mobs.filter((m) => m.kind !== 'f8_moon');
    b.data.todo = 0;
  },
});

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

/** Сдвиг крыла: предупреждение (паз светится, пол дрожит), потом клетки. */
function warnShift(sim: Sim, api: SimApi, g: ShiftGroup): void {
  g.at = sim.time + SHIFT_WARN;
  const W = sim.world.w;
  for (const bl of g.blocks) {
    const toWall: number[] = [];
    const toFloor: number[] = [];
    for (const c of bl.cells) {
      const wallNow = sim.tiles[c.i] === T8.Wall;
      (wallNow ? toFloor : toWall).push(c.i);
    }
    const z: ZoneIn & { cells: number[]; open: number[]; w: number } = {
      x: bl.cx,
      y: bl.cy,
      r: 3,
      life: SHIFT_WARN,
      art: 'f8_shift',
      cells: toWall,
      open: toFloor,
      w: W,
    };
    api.zone(sim, z);
  }
  const biwa = sim.mobs.find((m) => m.id === g.biwa && m.mode !== 'dying');
  if (biwa && (biwa.mode === 'f8_play' || biwa.mode === 'chase')) api.setMode(biwa, 'f8_strum');
  sim.events.push({ t: 'boss', what: 'f8_string_call' });
}

function applyShift(sim: Sim, api: SimApi, g: ShiftGroup): void {
  g.at = 0;
  g.state = g.state ? 0 : 1;
  g.shifts += 1;
  const walls: number[] = [];
  const W = sim.world.w;
  for (const bl of g.blocks)
    for (const c of bl.cells) {
      // В положении 0 — как на карте, в 1 — наоборот.
      const wall = g.state === 0 ? c.wallA : !c.wallA;
      const x = c.i % W;
      const y = Math.floor(c.i / W);
      if (wall) {
        api.setTile(sim, x, y, T8.Wall, g.id === 0 ? M.shift0 : M.shift1);
        walls.push(c.i);
      } else api.setTile(sim, x, y, T8.Floor, g.id === 0 ? M.track0 : M.track1);
    }
  evictFrom(sim, api, walls);
  sim.hitstop = Math.max(sim.hitstop, 0.05);
  sim.events.push({ t: 'boss', what: 'f8_shift_wall' });
  const st = STATE.get(sim);
  if (st)
    say(sim, st, 'f8_shift', 'СТЕНЫ СДВИНУЛИСЬ', 'играет бива — найди её, и стены замрут', 120);
}

/** Спящие рядом с меткой: кто — по месту (паутина — пауки). */
function sleeperKinds(sim: Sim, s: Spot): string[] {
  let web = 0;
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++) if (markAt(sim, s.x + dx, s.y + dy) === M.web) web++;
  if (web > 4) return ['f8_spider', 'f8_spider', 'f8_spider', 'f8_imp'];
  if (s.area === F8_HALLS) return ['f8_arms', 'f8_blade', 'f8_blade', 'f8_imp'];
  if (s.area === F8_MOON) return ['f8_blade', 'f8_blade', 'f8_arms'];
  return ['f8_blade', 'f8_imp', 'f8_imp', 'f8_imp'];
}

function ambushKind(sim: Sim, s: Spot): string {
  const r = sim.rng();
  if (s.area === F8_MOON) return r < 0.5 ? 'f8_blade' : 'f8_spider';
  if (s.area === F8_HALLS) return r < 0.45 ? 'f8_blade' : r < 0.75 ? 'f8_imp' : 'f8_spider';
  return r < 0.35 ? 'f8_spider' : r < 0.6 ? 'f8_blade' : 'f8_imp';
}

/** Перевёрнутая комната: вошёл — дрожит — переворачивается. */
function stepFlip(sim: Sim, api: SimApi, st: F8State, dt: number): void {
  const f = st.flip;
  if (!f || f.state === 'done') return;
  const h = sim.hero;
  const inside = h.x >= f.x0 && h.x <= f.x1 + 1 && h.y >= f.y0 && h.y <= f.y1 + 1;
  if (f.state === 'idle') {
    f.t = inside ? f.t + dt : 0;
    if (f.t >= FLIP_ARM) {
      f.state = 'warn';
      f.t = 0;
      const z: ZoneIn & { x0: number; y0: number; x1: number; y1: number } = {
        x: (f.x0 + f.x1 + 1) / 2,
        y: (f.y0 + f.y1 + 1) / 2,
        r: 12,
        life: FLIP_WARN,
        art: 'f8_flipwarn',
        x0: f.x0,
        y0: f.y0,
        x1: f.x1,
        y1: f.y1,
      };
      api.zone(sim, z);
      sim.events.push({
        t: 'boss',
        what: 'f8_flip_trap',
        text: 'КОМНАТА ПЕРЕВОРАЧИВАЕТСЯ',
        sub: 'пол станет потолком — с потолка упадут',
      });
    }
    return;
  }
  if (f.state === 'warn') {
    const was = f.t;
    f.t += dt;
    // Дом ходит: два глухих толчка до переворота — камера дрожит.
    for (const at of [0.05, 1.05])
      if (was < at && f.t >= at) sim.events.push({ t: 'boom', x: h.x, y: h.y - 2, r: 0 });
    if (f.t < FLIP_WARN) return;
    f.state = 'done';
    const walls: number[] = [];
    for (const c of f.cells) {
      if (c.kind === 'beam') {
        api.setTile(sim, c.x, c.y, T8.Wall, M.beam);
        walls.push(c.i);
      } else api.setTile(sim, c.x, c.y, T8.Floor, M.ceil);
    }
    // Вещи «пола» упали на потолок, лампы потолка встали на пол.
    for (const p of sim.props) {
      if (p.x < f.x0 || p.x > f.x1 + 1 || p.y < f.y0 || p.y > f.y1 + 1) continue;
      if (p.obj.ref === 'f8_c_lamp') p.alive = true;
      else if (p.kind === 'deco' || p.kind === 'breakable') p.alive = false;
    }
    evictFrom(sim, api, walls);
    sim.hitstop = Math.max(sim.hitstop, 0.12);
    sim.events.push({ t: 'boss', what: 'f8_flip_wall' });
    // С потолка падают: подальше от героя, по полу комнаты.
    const floor = f.cells.filter(
      (c) => c.kind !== 'beam' && hypot(c.x + 0.5 - h.x, c.y + 0.5 - h.y) > 2.2,
    );
    const n = 5;
    for (let i = 0; i < n && floor.length; i++) {
      const j = Math.floor(sim.rng() * floor.length);
      const c = floor.splice(j, 1)[0];
      const kind =
        i === 0 ? 'f8_blade' : ambushKind(sim, { x: c.x, y: c.y, used: true, area: F8_LOWER });
      const m = api.spawnMob(sim, kind, c.x + 0.5, c.y + 0.5, {
        mode: 'drop',
        elite: i === 0 && sim.rng() < 0.3,
      });
      m.t = -0.2 - i * 0.22;
    }
  }
}

/** Падающий мост: ряды рушатся за спиной, потом всплывают. */
function stepBridge(sim: Sim, api: SimApi, st: F8State): void {
  const br = st.bridge;
  if (!br) return;
  const h = sim.hero;
  const W = sim.world.w;
  const n = br.rows.length;
  if (br.state === 'rest') {
    if (sim.time >= br.next) br.state = 'idle';
    return;
  }
  if (br.state === 'idle') {
    if (heroDown(sim)) return;
    const hx = Math.floor(h.x);
    const hy = Math.floor(h.y);
    if (markAt(sim, hx, hy) !== M.bridgeFall) return;
    // Ступил: рушится с той стороны, откуда пришёл.
    const mid = (br.rows[0].y + br.rows[n - 1].y) / 2;
    br.dir = h.y > mid ? -1 : 1;
    const endRow = br.dir < 0 ? br.rows[n - 1] : br.rows[0];
    const edgeY = endRow.y + (br.dir < 0 ? 2 : -2);
    br.land = [(endRow.xs[0] + endRow.xs[endRow.xs.length - 1]) / 2 + 0.5, edgeY + 0.5];
    br.state = 'run';
    br.k = 0;
    br.next = sim.time + 0.35;
    say(sim, st, 'f8_bridge', 'МОСТ РУШИТСЯ', 'доски падают за спиной — беги вперёд', 30);
    sim.events.push({ t: 'boss', what: 'f8_bridge_trap' });
    // Из пропасти поднимаются фонарные духи.
    for (let i = 0; i < 2; i++) {
      const ahead = h.y + (br.dir < 0 ? -1 : 1) * (4 + i * 3);
      const side = i % 2 ? 1 : -1;
      const x = h.x + side * (2.5 + sim.rng());
      if (tileAt(sim, Math.floor(x), Math.floor(ahead)) !== T8.Deep) continue;
      const m = api.spawnMob(sim, 'f8_lantern', x, ahead, { mode: 'f8_rise' });
      m.data.ghost = 1;
    }
    return;
  }
  // Идёт обрушение или возврат.
  const order = (k: number) => (br.dir < 0 ? n - 1 - k : k);
  if (br.state === 'run') {
    if (br.k < n && sim.time >= br.next) {
      const row = br.rows[order(br.k)];
      row.s = 1;
      row.t = sim.time;
      const z: ZoneIn & { xs: number[]; row: number } = {
        x: (row.xs[0] + row.xs[row.xs.length - 1]) / 2 + 0.5,
        y: row.y + 0.5,
        r: 1.5,
        life: PLANK_WARN,
        art: 'f8_plank',
        xs: row.xs,
        row: row.y,
      };
      api.zone(sim, z);
      br.k += 1;
      br.next = sim.time + PLANK_STEP;
    }
    let all = true;
    for (const row of br.rows) {
      if (row.s === 1 && sim.time - row.t >= PLANK_WARN) {
        row.s = 2;
        row.t = sim.time;
        for (const x of row.xs) api.setTile(sim, x, row.y, T8.Deep, M.bridgeFall);
        const z: ZoneIn & { xs: number[]; row: number } = {
          x: (row.xs[0] + row.xs[row.xs.length - 1]) / 2 + 0.5,
          y: row.y + 0.5,
          r: 1.5,
          life: 0.9,
          art: 'f8_planks_fall',
          xs: row.xs,
          row: row.y,
        };
        api.zone(sim, z);
        // Под героем — сорвался: урон и возврат на край.
        if (!heroDown(sim) && Math.floor(h.y) === row.y && row.xs.includes(Math.floor(h.x))) {
          heroFall(sim, api, st, br);
        }
        // Мобы на доске: летуны остаются, остальные падают.
        for (const m of sim.mobs) {
          if (m.mode === 'dying' || api.def(m.kind).fly || api.def(m.kind).boss) continue;
          // Сорвался — убийство в зачёт (Движок 3), добыча на краю.
          if (Math.floor(m.y) === row.y && row.xs.includes(Math.floor(m.x))) api.fall(sim, m);
        }
      }
      if (row.s !== 2) all = false;
    }
    if (all) {
      br.state = 'back';
      br.k = 0;
      br.next = sim.time + PLANK_BACK;
    }
    return;
  }
  if (br.state === 'back') {
    if (sim.time < br.next) return;
    // Всплывают с дальнего конца — к герою ближе всего последними.
    const row = br.rows[order(n - 1 - br.k)];
    for (const x of row.xs) api.setTile(sim, x, row.y, T8.Floor, M.bridgeFall);
    row.s = 0;
    const z: ZoneIn & { xs: number[]; row: number } = {
      x: (row.xs[0] + row.xs[row.xs.length - 1]) / 2 + 0.5,
      y: row.y + 0.5,
      r: 1.5,
      life: 0.6,
      art: 'f8_planks_rise',
      xs: row.xs,
      row: row.y,
    };
    api.zone(sim, z);
    br.k += 1;
    br.next = sim.time + 0.12;
    if (br.k >= n) {
      br.state = 'rest';
      br.next = sim.time + 35;
    }
  }
  void W;
}

function heroFall(sim: Sim, api: SimApi, st: F8State, br: FallBridge): void {
  const h = sim.hero;
  br.falls += 1;
  const [lx, ly] = br.land;
  // Место возврата видно вспышкой — телепорт без метки читался бы багом.
  api.zone(sim, { x: lx, y: ly, r: 0.9, life: 1.1, art: 'f8_land' });
  api.moveHero(sim, lx, ly);
  const hp0 = h.hp;
  h.inv = 0;
  api.hurtHero(sim, rawShare(sim, FALL_HURT), lx, ly - 1, 0);
  if (h.hp >= hp0) h.hp = Math.max(1, h.hp - sim.stats.maxHp * FALL_HURT);
  h.inv = 1;
  sim.events.push({
    t: 'boss',
    what: 'f8_fall_trap',
    text: 'СОРВАЛСЯ',
    sub: 'пропасть вернула на край',
  });
  void st;
}

registerFloor(8, {
  start(sim, api) {
    STATE.set(sim, scan(sim, api));
    // Лампы Перевёрнутой комнаты — «на потолке»: до переворота их не видно.
    for (const p of sim.props) if (p.obj.ref === 'f8_c_lamp') p.alive = false;
  },
  step(sim, dt, api) {
    const st = stateOf(sim, api);
    const h = sim.hero;
    const fight = sim.boss?.state === 'fight';
    F8_CLOCK.now = sim.time;

    // Отложенные удары (натяг нитей).
    const pend = PENDING.get(sim);
    if (pend?.length) {
      const keep: typeof pend = [];
      for (const p of pend)
        if (sim.time >= p.at) {
          api.strike(sim, p.s);
          sim.events.push({ t: 'clank', x: p.s.x, y: p.s.y });
        } else keep.push(p);
      PENDING.set(sim, keep);
    }

    // Двери: кто открыт — выпускает.
    const keepO: Opening[] = [];
    for (const o of st.openings) {
      o.t -= dt;
      if (o.t <= 0 && (o.kinds.length || o.mob)) {
        const d = o.door;
        if (o.mob) {
          const m = sim.mobs.find((x) => x.id === o.mob && x.mode !== 'dying');
          if (m) {
            m.x = d.ox + 0.5;
            m.y = d.oy + 0.3;
            m.data.ghost = 1;
            api.setMode(m, 'f8_out');
          }
          o.mob = 0;
        } else {
          const kind = o.kinds.shift()!;
          const m = api.spawnMob(sim, kind, d.ox + 0.5, d.oy + 0.3, {
            mode: 'f8_out',
            elite: o.elite,
          });
          m.data.ghost = 1;
          m.face = Math.PI / 2;
          o.elite = false;
          sim.events.push({ t: 'emerge', x: d.ox + 0.5, y: d.oy + 0.5 });
          if (kind === 'f8_miser') sim.events.push({ t: 'gold', x: m.x, y: m.y, mob: kind });
          o.t = 0.42;
        }
      }
      o.closeAt -= dt;
      if (o.closeAt > 0 || o.kinds.length) keepO.push(o);
    }
    st.openings = keepO;

    // Сдвиги перегородок: доигрываем начатое даже без героя.
    for (const g of st.groups) if (g.at && sim.time >= g.at) applyShift(sim, api, g);
    if (st.drum?.at && sim.time >= st.drum.at) applyDrumTurn(sim, api, st);

    // Падающий мост.
    stepBridge(sim, api, st);

    // Лунный пол под логовом: мозаика (картинка, без действия).
    const lair = sim.boss?.obj;
    if (lair && !sim.zones.some((z) => z.art === 'f8_moonfloor'))
      api.zone(sim, { x: lair.x + 0.5, y: lair.y + 0.5, r: 2.6, life: 1e9, art: 'f8_moonfloor' });
    // Помосты бив и знак Барабанной — картинки на полу (сброс босса их
    // снимает вместе со всеми метками — ставим заново).
    if (!st.decals || !sim.zones.some((z) => z.art === 'f8_dais')) {
      st.decals = true;
      for (const g of st.groups)
        if (g.seat)
          api.zone(sim, {
            x: g.seat.x,
            y: g.seat.y,
            r: g.id === 0 ? 4 : 3,
            life: 1e9,
            art: 'f8_dais',
          });
      if (st.drum?.seat)
        api.zone(sim, { x: st.drum.seat.x, y: st.drum.seat.y, r: 1.4, life: 1e9, art: 'f8_tomoe' });
    }

    if (heroDown(sim)) return;

    // Перевёрнутая комната.
    stepFlip(sim, api, st, dt);

    // Бивы: садятся на помосты, когда герой подходит; играют — стены едут.
    for (const g of st.groups) {
      if (!g.seat || g.frozen) continue;
      const d = hypot(g.seat.x - h.x, g.seat.y - h.y);
      if (!g.spawned && d < 30) {
        g.spawned = true;
        const m = api.spawnMob(sim, 'f8_biwa', g.seat.x, g.seat.y, { mode: 'f8_play' });
        m.data.sx = g.seat.x;
        m.data.sy = g.seat.y;
        g.biwa = m.id;
      }
      const biwa = sim.mobs.find((m) => m.id === g.biwa && m.mode !== 'dying');
      if (g.spawned && !biwa && !g.frozen) {
        // Ушёл за край привязи (далеко) — бива возвращается на помост.
        if (d > 34) g.spawned = false;
        continue;
      }
      if (!g.at && biwa && sim.time >= g.next && d < 36 && !fight) {
        warnShift(sim, api, g);
        g.next = sim.time + SHIFT_EVERY[0] + sim.rng() * (SHIFT_EVERY[1] - SHIFT_EVERY[0]);
      }
    }

    // Зал струны: подошёл к помосту ядра — три сдвига подряд и стража.
    const core = st.groups.find((g) => g.id === 0);
    if (core?.seat && !st.hallDone && !core.frozen) {
      const d = hypot(core.seat.x - h.x, core.seat.y - h.y);
      if (d < 10 && api.lineOfSight(sim, h.x, h.y, core.seat.x, core.seat.y)) {
        st.hallDone = true;
        st.hallQueue = [sim.time + 0.4, sim.time + 3.4, sim.time + 6.4];
        sim.events.push({
          t: 'boss',
          what: 'f8_hall_call',
          text: 'ЗАЛ СТРУНЫ',
          sub: 'бива играет — стены ходят ходуном',
        });
        const spots = [
          [-4, 3],
          [4, 3],
          [0, 6],
        ];
        spots.forEach(([dx, dy], i) => {
          const x = core.seat!.x + dx;
          const y = core.seat!.y + dy;
          if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return;
          const m = api.spawnMob(sim, i === 2 ? 'f8_arms' : 'f8_blade', x, y, { mode: 'drop' });
          m.t = -0.6 - i * 0.3;
        });
      }
    }
    if (st.hallQueue.length && core && !core.frozen && sim.time >= st.hallQueue[0]) {
      st.hallQueue.shift();
      if (!core.at) {
        warnShift(sim, api, core);
        core.next = sim.time + SHIFT_EVERY[1];
      }
    }

    // Барабанщик: садится в Барабанную, когда подходишь.
    const drum = st.drum;
    if (drum?.seat && !drum.spawned && hypot(drum.seat.x - h.x, drum.seat.y - h.y) < 20) {
      drum.spawned = true;
      const m = api.spawnMob(sim, 'f8_drum', drum.seat.x, drum.seat.y + 0.2, { mode: 'chase' });
      m.data.home = 1;
      m.hx = drum.seat.x;
      m.hy = drum.seat.y;
      drum.mob = m.id;
    }

    // Глазастые сёдзи: просыпаются, когда рядом.
    for (const e of st.eyes) {
      if (e.mob) {
        if (!sim.mobs.some((m) => m.id === e.mob && m.mode !== 'dying')) {
          e.mob = 0;
          e.ready = sim.time + 50;
        }
        continue;
      }
      if (e.ready > sim.time || fight) continue;
      if (hypot(e.ox + 0.5 - h.x, e.oy + 0.5 - h.y) > 11) continue;
      const m = api.spawnMob(sim, 'f8_eyes', e.ox + 0.5, e.oy + 0.35, { mode: 'f8_hide' });
      m.data.ax = m.x;
      m.data.ay = m.y;
      m.data.ghost = 1;
      m.data.wx = e.x;
      m.data.wy = e.y;
      m.cd = 1 + sim.rng();
      e.mob = m.id;
    }

    // Спящие стаи.
    for (const s of st.sleepers) {
      if (s.used || fight) continue;
      if (hypot(s.x + 0.5 - h.x, s.y + 0.5 - h.y) > 14) continue;
      s.used = true;
      if (sim.safe.some((z) => hypot(z.x - s.x, z.y - s.y) < 10)) continue;
      const kinds = sleeperKinds(sim, s);
      const lead = sim.rng() < 0.2;
      kinds.forEach((kind, i) => {
        const a = (i / kinds.length) * TAU + 0.4;
        let x = s.x + 0.5 + Math.cos(a) * 0.9;
        let y = s.y + 0.5 + Math.sin(a) * 0.8;
        if (api.solidTile(sim, Math.floor(x), Math.floor(y))) {
          x = s.x + 0.5;
          y = s.y + 0.5;
        }
        const m = api.spawnMob(sim, kind, x, y, { mode: 'sleep', elite: lead && i === 0 });
        api.collide(sim, m);
      });
    }

    // Засады со свода.
    for (const s of st.ambushes) {
      if (s.used || fight) continue;
      if (hypot(s.x + 0.5 - h.x, s.y + 0.5 - h.y) > 2.3) continue;
      s.used = true;
      const n = 3 + Math.floor(sim.rng() * 2);
      for (let i = 0; i < n; i++) {
        const a = sim.rng() * TAU;
        const r = 1.8 + sim.rng() * 1.4;
        let x = h.x + Math.cos(a) * r;
        let y = h.y + Math.sin(a) * r;
        if (api.solidTile(sim, Math.floor(x), Math.floor(y))) {
          x = h.x - Math.cos(a) * r;
          y = h.y - Math.sin(a) * r;
        }
        if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
        const m = api.spawnMob(sim, ambushKind(sim, s), x, y, { mode: 'drop' });
        m.t = -i * 0.14;
      }
      sim.events.push({ t: 'squeak', x: h.x, y: h.y });
    }

    // Фонарные духи поднимаются из пропасти Зала луны.
    if (sim.area === F8_MOON && !fight) {
      st.riseT -= dt;
      if (st.riseT <= 0) {
        st.riseT = 9 + sim.rng() * 6;
        const lanterns = sim.mobs.filter((m) => m.kind === 'f8_lantern' && m.mode !== 'dying');
        if (lanterns.length < 3 && liveMobs(sim) < 16) {
          for (let k = 0; k < 16; k++) {
            const a = sim.rng() * TAU;
            const r = 4.5 + sim.rng() * 4;
            const x = h.x + Math.cos(a) * r;
            const y = h.y + Math.sin(a) * r;
            if (tileAt(sim, Math.floor(x), Math.floor(y)) !== T8.Deep) continue;
            if (api.inArena(sim, x, y)) continue;
            const m = api.spawnMob(sim, 'f8_lantern', x, y, { mode: 'f8_rise' });
            m.data.ghost = 1;
            break;
          }
        }
      }
    }

    // Двери: демоны выходят, пока нарастает напряжение.
    const d = sim.director;
    const safeNow = sim.safe.some((s) => hypot(s.x - h.x, s.y - h.y) < 9);
    if (!fight && !safeNow && d.phase === 'build') {
      const spec = (area: string) => api.pickKind(sim, area);
      st.spawnT -= dt * (sim.area === F8_MOON ? 0.7 : 1);
      if (st.spawnT <= 0) {
        st.spawnT = 5.5 + sim.rng() * 3.5;
        if (liveMobs(sim) < 18 && nearMobs(sim, 12) < 8) {
          const door = pickDoor(sim, api, st, 5, 13);
          if (door) {
            const first = spec(door.area);
            const n = 1 + (sim.rng() < 0.55 ? 1 : 0);
            const kinds = [first];
            for (let i = 1; i < n; i++)
              kinds.push(first === 'f8_arms' ? 'f8_imp' : spec(door.area));
            openDoor(sim, st, door, kinds, { elite: sim.rng() < 0.05 });
          }
        }
      }
    }

    // Бес-казначей — редко, из двери подальше.
    st.goldT -= dt;
    if (st.goldT <= 0 && !fight) {
      st.goldT = 420 + sim.rng() * 360;
      if (sim.area !== F8_MOON) {
        const door = pickDoor(sim, api, st, 8, 16);
        if (door) openDoor(sim, st, door, ['f8_miser']);
      }
    }
  },
});
