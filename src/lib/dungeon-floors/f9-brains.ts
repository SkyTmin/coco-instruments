// Этаж 9 «Лабиринт гидры» — ИИ монстров, сценарий гидры и правила этажа.
//
// Правила этажа (`registerFloor(9)`):
//   • КРУГИ-ТЕЛЕПОРТЫ. Встал в круг — он наливается светом, в точке выхода
//     вспыхивает пара, через полсекунды — перенос (`api.moveHero`). Сошёл
//     с круга раньше — перенос отменён. Пара видна по цвету и руне. Красные
//     круги с треснувшей руной — ловушки: переносят в зал засады. Круг «3»
//     спит, пока не наступишь на его пару в логове (будит дорогу назад);
//   • КОРНЕВАЯ ЧАСОВНЯ (руины): вошёл — корни заперли двери, из пола бьют
//     рядами (между рядами безопасно), из трясины лезут хваталки. Выстоял —
//     корни уходят и открывают прямой ход к лифту;
//   • КРУГОВОРОТ (лабиринт): круги зала раз в несколько секунд разом меняют
//     пары — цвета перемешиваются. Вперёд ведёт золотой (руна того же цвета
//     горит над решёткой); красный — в засаду, белый — на островок-тайник;
//   • ПРИЛИВ (логово): ступил на гать — вода поднимается за спиной: залитые
//     доски тянут вниз и топят, из воды прыгают пиявки;
//   • трясина прячет корневых хваталок, вода — пиявок, над водой висят
//     болотные огни.
//
// Гидра — тело в озере и головы на шеях (части босса, у каждой стихия).
// Срубленная голова оставляет обрубок: не прижжёшь огнём — отрастут две.
// Огонь — у жаровен по краям арены (подошёл — «огонь в руке») или рядом с
// тлеющей лужей, что оставляет огненная голова. Фазы: три головы → гроза
// и свет (озеро разливается) → ядовитый туман (две жаровни падают) →
// скрытая голова (озеро уходит, тело не взять, пока она жива).
//
// Честность: всё, что бьёт, видно заранее — линия копья, конус взгляда,
// круг руны и корней, метка прыжка кобольда, плевок навесом с кругом на
// полу, у гидры — конус, линия молнии, круги укусов и водоворотов.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Prop, Sim, Zone } from '../dungeon-sim';
import type { Light } from '../dungeon-world';
import {
  F9_LAIR,
  F9_MARK,
  F9_MAZE,
  F9_RUINS,
  isBogMark,
  isRingMark,
  isWaterMark,
} from './f9';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Клетки мира (числа, как `Tile` в `dungeon-world.ts`: значения движка
// сюда не импортируются).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;
const T_HAZARD = 12;

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const cellOf = (sim: Sim, x: number, y: number) => Math.floor(y) * sim.world.w + Math.floor(x);

const tileAtI = (sim: Sim, i: number) => sim.tiles[i];

const walkable = (t: number) => t === T_FLOOR || t === T_HAZARD || (t >= 3 && t <= 5) || t === 10;

function lineHits(
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

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

const canHit = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

/** Зона с доп. полями для рисовальщика (угол, длина, цвет, чей). */
type ZoneX = ZoneIn & Record<string, number | string | undefined>;

function zoneId(sim: Sim, api: SimApi, z: ZoneX): number {
  api.zone(sim, z);
  return sim.zones[sim.zones.length - 1]?.id ?? 0;
}

const zoneById = (sim: Sim, id: number): Zone | undefined =>
  id ? sim.zones.find((z) => z.id === id) : undefined;

function killZone(sim: Sim, id: number): void {
  const z = zoneById(sim, id);
  if (z) {
    z.life = 0;
    z.t = 1e9;
  }
}

/** Укус вплотную: общий (замах `windup` рисует движок конусом). */
function biteStep(sim: Sim, m: Mob, c: BrainCtx, api: SimApi, push = 2.5): void {
  const h = sim.hero;
  const def = c.def;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t < def.windup) return;
  const reach = def.reach + m.r + h.r + 0.18;
  if (c.dist < reach && canHit(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, push, m.kind);
  m.vx += Math.cos(m.face) * 3;
  m.vy += Math.sin(m.face) * 3;
  api.setMode(m, 'recover');
  m.data.bcd = def.rest * (0.8 + sim.rng() * 0.4);
}

/** Точка пола рядом (сама или ближайшая по кольцам). */
function floorNear(sim: Sim, api: SimApi, x: number, y: number, r = 2): [number, number] | null {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  if (!api.solidTile(sim, fx, fy)) return [x, y];
  for (let k = 1; k <= r; k++)
    for (let dy = -k; dy <= k; dy++)
      for (let dx = -k; dx <= k; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== k) continue;
        if (!api.solidTile(sim, fx + dx, fy + dy)) return [fx + dx + 0.5, fy + dy + 0.5];
      }
  return null;
}

const bogAt = (sim: Sim, x: number, y: number) =>
  isBogMark(markAt(sim, Math.floor(x), Math.floor(y))) &&
  tileAtI(sim, cellOf(sim, x, y)) === T_HAZARD;

// ---------------------------------------------------------------------------
// Вид для рисовальщиков (`f9-art.ts`): предметам и зонам не видно
// симуляции, а кругу нужно знать свой цвет, жаровне — горит ли она.
// Рисуется одна вылазка за раз, поэтому вид общий.
// ---------------------------------------------------------------------------

/** Цвета кругов: 0 серый (спит/точка выхода) … 7 алый (ловушка). */
export const RING_COLORS = 11;
export const RING_OF_PAIR = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0];

/** Состояние круга для рисунка. */
export const RS = { on: 0, off: 1, dormant: 2, spin: 3, charge: 4, trap: 5, exit: 6 } as const;

export interface NeckView {
  /** Мировые координаты основания (у тела) и конца (голова или обрубок). */
  ax: number;
  ay: number;
  hx: number;
  hy: number;
  el: number;
  /** Номер моба (для качания летуна), 0 — обрубок на земле. */
  id: number;
  /** 0 — голова, 1 — обрубок кровит, 2 — прижжён. */
  cut: number;
  /** Толщина: у скрытой головы — толще. */
  big: number;
}

export const F9_VIEW = {
  ringColor: new Map<string, number>(),
  ringState: new Map<string, number>(),
  /** Круговорот: когда началось вращение (время рендера — своё, поэтому доля). */
  spin: 0,
  necks: [] as NeckView[],
  /** Горят ли жаровни арены (id предмета). */
  braziers: new Map<string, boolean>(),
  /** Огонь в руке героя, 0…1. */
  fire: 0,
  /** Фаза боя с гидрой, −1 — боя нет. */
  phase: -1,
  /** Часовня: 0 тихо, 1 корни держат, 2 отступили. */
  chapel: 0,
};

// ---------------------------------------------------------------------------
// Состояние этажа.
// ---------------------------------------------------------------------------

type RingKind = 'pair' | 'slot' | 'dest' | 'trap' | 'back' | 'exit';

interface Ring {
  i: number;
  x: number;
  y: number;
  /** Номер пары (1…9), 0 — ловушка и выход из засады. */
  k: number;
  kind: RingKind;
  area: string;
  id: string;
  /** Куда ведёт сейчас (индекс круга), −1 — никуда. */
  to: number;
}

interface Pocket {
  cells: number[];
  cx: number;
  cy: number;
  at: number;
  id: number;
}

interface Hall {
  slots: number[];
  dests: number[];
  /** slot → dest: перестановка. */
  perm: number[];
  next: number;
  spinUntil: number;
  on: boolean;
  said: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Ambush extends Box {
  /** 0 ждёт, 1 бой, 2 отбились. */
  state: number;
  t: number;
  ids: number[];
}

interface Chapel extends Box {
  cells: Set<number>;
  doors: number[];
  doorMarks: number[];
  shortcut: number[];
  state: number;
  t: number;
  wave: number;
  next: number;
  ids: number[];
  bog: number[];
  totem: [number, number];
}

interface Tide {
  /** Клетки гати по пути: индекс — шаг от южного берега. */
  step: Map<number, number>;
  max: number;
  state: number;
  t: number;
  front: number;
  zones: Map<number, number>;
  leechT: number;
}

interface ArenaState {
  cx: number;
  cy: number;
  pool: number[];
  shore: number[];
  braziers: Prop[];
  changed: { i: number; tile: number; mark: number; haz: number }[];
  added: number[];
  lights: Light[];
  out: Set<number>;
}

interface F9State {
  rings: Ring[];
  ringAt: Map<number, number>;
  lock: number;
  charge: { ring: number; t: number; zin: number; zout: number } | null;
  awake3: boolean;
  hall: Hall | null;
  amb: Ambush | null;
  chapel: Chapel | null;
  tide: Tide | null;
  pockets: Pocket[];
  shore: number[];
  leechT: number;
  wispT: number;
  koboldT: number;
  arena: ArenaState | null;
  fire: number;
  fireSaid: number;
  fireZone: number;
  fireLight: Light | null;
  baseLights: Light[];
  baseHaz: Uint8Array;
  bogHaz: number;
  said: Record<string, number>;
}

const STATE = new WeakMap<Sim, F9State>();

/** Прямоугольник клеток с видом `mk` в районе `area`. */
function boxOf(sim: Sim, mk: number, area: string): Box | null {
  const w = sim.world;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < w.h; y++) {
    if (w.rowArea[y] !== area) continue;
    for (let x = 0; x < w.w; x++)
      if (w.mark[y * w.w + x] === mk) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const inBox = (b: Box, x: number, y: number, pad = 0) =>
  x >= b.x0 - pad && x < b.x1 + 1 + pad && y >= b.y0 - pad && y < b.y1 + 1 + pad;

function scan(sim: Sim): F9State {
  const w = sim.world;
  const W = w.w;
  const rings: Ring[] = [];
  const ringAt = new Map<number, number>();
  const bog: number[] = [];
  const shore: number[] = [];
  let bogHaz = 0;
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const mk = w.mark[i];
      if (isRingMark(mk)) {
        const k = mk === F9_MARK.trap || mk === F9_MARK.back ? 0 : mk - F9_MARK.ring;
        const kind: RingKind =
          mk === F9_MARK.trap ? 'trap' : mk === F9_MARK.back ? 'back' : k === 9 ? 'exit' : 'pair';
        ringAt.set(i, rings.length);
        rings.push({
          i,
          x,
          y,
          k,
          kind,
          area: w.rowArea[y],
          id: `${w.rowArea[y]}:${x}:${y - (w.bands.find((b) => b.def.id === w.rowArea[y])?.top ?? 0)}`,
          to: -1,
        });
      } else if (isBogMark(mk) && sim.tiles[i] === T_HAZARD) {
        bog.push(i);
        if (!bogHaz && mk === F9_MARK.bog) bogHaz = w.haz[i];
      }
      // Берег: пол у воды топи — отсюда прыгают пиявки.
      if (walkable(sim.tiles[i]) && !isRingMark(mk)) {
        for (const d of [1, -1, W, -W]) {
          const j = i + d;
          if (j >= 0 && j < w.mark.length && isWaterMark(w.mark[j]) && sim.tiles[j] === T_DEEP) {
            shore.push(i);
            break;
          }
        }
      }
    }
  // Пары: одинаковые номера (кроме Круговорота и ловушек) ведут друг в друга.
  const hallBox = boxOf(sim, F9_MARK.hall, F9_MAZE);
  let hall: Hall | null = null;
  const slots: number[] = [];
  const dests: number[] = [];
  for (const r of rings) {
    if (r.k >= 5 && r.k <= 8) {
      const inHall = !!hallBox && r.area === F9_MAZE && inBox(hallBox, r.x, r.y);
      r.kind = inHall ? 'slot' : 'dest';
      (inHall ? slots : dests).push(r.i);
    }
  }
  for (const r of rings) {
    if (r.kind !== 'pair') continue;
    const mate = rings.find((o) => o !== r && o.kind === 'pair' && o.k === r.k);
    r.to = mate ? rings.indexOf(mate) : -1;
  }
  const back = rings.findIndex((r) => r.kind === 'back');
  const exit = rings.findIndex((r) => r.kind === 'exit');
  for (const r of rings) {
    if (r.kind === 'trap') r.to = back;
    if (r.kind === 'back') r.to = exit;
  }
  if (hallBox && slots.length === 4) {
    const byK = (list: number[]) =>
      list
        .map((i) => ringAt.get(i)!)
        .sort((a, b) => rings[a].k - rings[b].k || rings[a].y - rings[b].y || rings[a].x - rings[b].x);
    const s = byK(slots);
    const d = byK(dests);
    hall = {
      slots: s,
      dests: d,
      perm: [0, 1, 2, 3],
      next: 0,
      spinUntil: 0,
      on: false,
      said: false,
      ...hallBox,
    };
    for (let j = 0; j < 4; j++) {
      rings[s[j]].to = d[j];
      rings[d[j]].to = s[j];
    }
  }
  // Засада.
  const ab = boxOf(sim, F9_MARK.ambush, F9_MAZE);
  const amb: Ambush | null = ab ? { ...ab, state: 0, t: 0, ids: [] } : null;
  // Часовня: пол, двери (пол снаружи, касается пола часовни), корни хода.
  let chapel: Chapel | null = null;
  const cb = boxOf(sim, F9_MARK.chapel, F9_RUINS);
  if (cb) {
    const cells = new Set<number>();
    for (let y = cb.y0; y <= cb.y1; y++)
      for (let x = cb.x0; x <= cb.x1; x++) if (walkable(sim.tiles[y * W + x])) cells.add(y * W + x);
    const doors: number[] = [];
    for (const i of cells)
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        if (!cells.has(j) && walkable(sim.tiles[j]) && !doors.includes(j)) doors.push(j);
      }
    const shortcut: number[] = [];
    const cbog: number[] = [];
    let totem: [number, number] = [(cb.x0 + cb.x1) / 2 + 0.5, (cb.y0 + cb.y1) / 2 + 0.5];
    for (let y = 0; y < w.h; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (w.rowArea[y] !== F9_RUINS) continue;
        if (w.mark[i] === F9_MARK.rootwall) shortcut.push(i);
      }
    for (const i of cells) if (isBogMark(w.mark[i])) cbog.push(i);
    const t = w.objs.find(
      (o) => o.ref === 'f9_totem' && o.area === F9_RUINS && inBox(cb, o.x, o.y),
    );
    if (t) totem = [t.x + 0.5, t.y + 1.2];
    chapel = {
      ...cb,
      cells,
      doors,
      doorMarks: doors.map((i) => w.mark[i]),
      shortcut,
      state: 0,
      t: 0,
      wave: 0,
      next: 0,
      ids: [],
      bog: cbog,
      totem,
    };
  }
  // Гать: клетки по шагам от южного берега.
  let tide: Tide | null = null;
  const cw: number[] = [];
  for (let i = 0; i < w.mark.length; i++) if (w.mark[i] === F9_MARK.causeway) cw.push(i);
  if (cw.length) {
    const set = new Set(cw);
    const bottom = Math.max(...cw.map((i) => Math.floor(i / W)));
    const step = new Map<number, number>();
    const q: number[] = cw.filter((i) => Math.floor(i / W) === bottom);
    for (const i of q) step.set(i, 0);
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        if (set.has(j) && !step.has(j)) {
          step.set(j, step.get(i)! + 1);
          q.push(j);
        }
      }
    }
    let max = 0;
    for (const v of step.values()) max = Math.max(max, v);
    tide = { step, max, state: 0, t: 0, front: 0, zones: new Map(), leechT: 0 };
  }
  // Трясина — связные куски (в них прячутся корни).
  const set = new Set(bog);
  const seen = new Set<number>();
  const pockets: Pocket[] = [];
  for (const g of bog) {
    if (seen.has(g)) continue;
    const cells: number[] = [];
    const q = [g];
    seen.add(g);
    while (q.length) {
      const i = q.pop()!;
      cells.push(i);
      for (const d of [1, -1, W, -W]) {
        const j = i + d;
        if (set.has(j) && !seen.has(j)) {
          seen.add(j);
          q.push(j);
        }
      }
    }
    if (cells.length < 5) continue;
    let sx = 0;
    let sy = 0;
    for (const i of cells) {
      sx += i % W;
      sy += Math.floor(i / W);
    }
    pockets.push({
      cells,
      cx: sx / cells.length + 0.5,
      cy: sy / cells.length + 0.5,
      at: -999,
      id: pockets.length + 1,
    });
  }
  return {
    rings,
    ringAt,
    lock: -1,
    charge: null,
    awake3: false,
    hall,
    amb,
    chapel,
    tide,
    pockets,
    shore,
    leechT: 8,
    wispT: 6,
    koboldT: 10,
    arena: null,
    fire: 0,
    fireSaid: -99,
    fireZone: 0,
    fireLight: null,
    baseLights: sim.world.lights,
    baseHaz: sim.world.haz,
    bogHaz,
    said: {},
  };
}

function stateOf(sim: Sim): F9State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

/** Для тестов и бота: круги, часовня, Круговорот, засада, гать, арена. */
export const f9State = (sim: Sim) => stateOf(sim);

/** Сказать один раз за `gap` секунд. */
function sayOnce(sim: Sim, key: string, gap: number, e: { what: string; text: string; sub?: string }) {
  const st = stateOf(sim);
  if (sim.time - (st.said[key] ?? -1e9) < gap) return;
  st.said[key] = sim.time;
  sim.events.push({ t: 'boss', ...e });
}

// ---------------------------------------------------------------------------
// Круги-телепорты.
// ---------------------------------------------------------------------------

/** Сколько круг наливается до переноса, с. */
export const WARP_T = 0.55;
/** Радиус круга: встал — считается, что в круге. */
const RING_R = 0.5;

const ringCenter = (r: Ring): [number, number] => [r.x + 0.5, r.y + 0.5];

/** Работает ли круг сейчас. */
function ringActive(sim: Sim, st: F9State, ri: number): boolean {
  const r = st.rings[ri];
  if (r.to < 0) return false;
  if (r.kind === 'exit') return false;
  if (r.k === 3 && !st.awake3 && r.area !== F9_LAIR) return false;
  const h = st.hall;
  if (h && (r.kind === 'slot' || r.kind === 'dest') && sim.time < h.spinUntil) return false;
  const a = st.amb;
  if (a && a.state === 1 && inBox(a, r.x, r.y)) return false;
  if (r.kind === 'back' && (!a || a.state !== 2)) return false;
  return true;
}

/** Цвет круга сейчас: у слота Круговорота — цвет его пары. */
function ringColorOf(st: F9State, ri: number): number {
  const r = st.rings[ri];
  if (r.kind === 'trap') return 7;
  if (r.kind === 'back') return 9;
  if (r.kind === 'exit') return 0;
  if (r.kind === 'slot' && r.to >= 0) return RING_OF_PAIR[st.rings[r.to].k];
  return RING_OF_PAIR[r.k] ?? 0;
}

function updateRingView(sim: Sim, st: F9State): void {
  const spin = !!st.hall && sim.time < st.hall.spinUntil;
  for (let ri = 0; ri < st.rings.length; ri++) {
    const r = st.rings[ri];
    F9_VIEW.ringColor.set(r.id, ringColorOf(st, ri));
    let s: number = RS.on;
    if (r.kind === 'exit') s = RS.exit;
    else if (r.kind === 'trap') s = RS.trap;
    else if (spin && (r.kind === 'slot' || r.kind === 'dest') && inBox(st.hall!, r.x, r.y)) s = RS.spin;
    else if (r.k === 3 && !st.awake3 && r.area !== F9_LAIR) s = RS.dormant;
    else if (!ringActive(sim, st, ri)) s = RS.off;
    if (st.charge && (st.charge.ring === ri || st.rings[st.charge.ring].to === ri)) s = RS.charge;
    F9_VIEW.ringState.set(r.id, s);
  }
  F9_VIEW.spin = spin ? (st.hall!.spinUntil - sim.time) / SPIN_T : 0;
}

/** Перенести моба кругом (кобольды ходят кругами, как герой). */
function warpMob(sim: Sim, api: SimApi, m: Mob, st: F9State, ri: number): boolean {
  if (!ringActive(sim, st, ri)) return false;
  const to = st.rings[st.rings[ri].to];
  const [x, y] = ringCenter(to);
  api.zone(sim, { x: m.x, y: m.y, r: 0.7, life: 0.45, art: 'f9_warp_arrive' });
  m.x = x + (sim.rng() - 0.5) * 0.3;
  m.y = y + 0.35;
  m.vx = 0;
  m.vy = 0;
  m.data.warpCd = sim.time + 3;
  api.zone(sim, { x, y, r: 0.7, life: 0.45, art: 'f9_warp_arrive' });
  return true;
}

function stepRings(sim: Sim, st: F9State, dt: number, api: SimApi): void {
  const h = sim.hero;
  // Сошёл с круга, на который пришёл, — круг снова работает.
  if (st.lock >= 0) {
    const [lx, ly] = ringCenter(st.rings[st.lock]);
    if (hypot(h.x - lx, h.y - ly) > 0.85) st.lock = -1;
  }
  if (st.charge) {
    const c = st.charge;
    const r = st.rings[c.ring];
    const [rx, ry] = ringCenter(r);
    const zin = zoneById(sim, c.zin);
    if (hypot(h.x - rx, h.y - ry) > RING_R + 0.18 || !ringActive(sim, st, c.ring) || heroDown(sim)) {
      // Сошёл — перенос отменён, вспышки гаснут.
      killZone(sim, c.zin);
      killZone(sim, c.zout);
      st.charge = null;
      return;
    }
    if (zin) zin.life = 1;
    c.t += dt;
    if (c.t < WARP_T) return;
    const to = st.rings[r.to];
    const [tx, ty] = ringCenter(to);
    killZone(sim, c.zin);
    // Ловушка: перенос в зал засады — предупредить сразу по прибытии.
    api.moveHero(sim, tx, ty);
    st.lock = r.to;
    st.charge = null;
    api.zone(sim, { x: tx, y: ty, r: 0.9, life: 0.5, art: 'f9_warp_arrive' });
    sim.events.push({ t: 'boss', what: 'f9_warp_call' });
    if (r.k === 3 && r.area === F9_LAIR && !st.awake3) st.awake3 = true;
    // Кобольды рядом с кругом отхода — прыгают следом.
    for (const m of sim.mobs) {
      if (m.kind !== 'f9_kobold' || m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
      if (hypot(m.x - rx, m.y - ry) < 3.2 && (m.data.warpCd ?? 0) < sim.time && sim.rng() < 0.6)
        warpMob(sim, api, m, st, c.ring);
    }
    return;
  }
  if (heroDown(sim)) return;
  const i = cellOf(sim, h.x, h.y);
  const ri = st.ringAt.get(i);
  if (ri === undefined || ri === st.lock) return;
  const r = st.rings[ri];
  // Спящий круг «3» в логове будит пару.
  if (r.k === 3 && r.area === F9_LAIR && !st.awake3) {
    st.awake3 = true;
    sayOnce(sim, 'awake3', 999, {
      what: 'f9_awake_call',
      text: 'КРУГ ПРОСНУЛСЯ',
      sub: 'его пара у входа в лабиринт — дорога назад',
    });
  }
  if (!ringActive(sim, st, ri)) {
    if (r.k === 3 && !st.awake3)
      sayOnce(sim, 'dormant3', 30, {
        what: 'f9_dormant_call',
        text: 'КРУГ СПИТ',
        sub: 'его разбудят с той стороны',
      });
    return;
  }
  const [rx, ry] = ringCenter(r);
  if (hypot(h.x - rx, h.y - ry) > RING_R) return;
  const to = st.rings[r.to];
  const [tx, ty] = ringCenter(to);
  const zin = zoneId(sim, api, {
    x: rx,
    y: ry,
    r: 0.8,
    life: WARP_T + 0.3,
    art: 'f9_warp_in',
    col: ringColorOf(st, ri),
  });
  // Вспышка в точке выхода — ещё до переноса.
  const zout = zoneId(sim, api, {
    x: tx,
    y: ty,
    r: 0.8,
    life: WARP_T + 0.6,
    art: 'f9_warp_out',
    col: ringColorOf(st, ri),
  });
  st.charge = { ring: ri, t: 0, zin, zout };
}

// ---------------------------------------------------------------------------
// Круговорот (лабиринт): круги зала разом меняют пары.
// ---------------------------------------------------------------------------

/** Вращение перед сменой пар (круги спят), с. */
export const SPIN_T = 1.3;
/** Сколько держатся пары, с. */
export const HALL_HOLD = 6.5;

function shuffleHall(sim: Sim, st: F9State): void {
  const h = st.hall!;
  // Новая перестановка: ни один слот не остаётся со старой парой.
  const old = h.perm.slice();
  let p = old;
  for (let k = 0; k < 20; k++) {
    p = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(sim.rng() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    if (p.every((v, i) => v !== old[i])) break;
  }
  h.perm = p;
  for (let j = 0; j < 4; j++) {
    st.rings[h.slots[j]].to = h.dests[p[j]];
    st.rings[h.dests[p[j]]].to = h.slots[j];
  }
}

function stepHall(sim: Sim, st: F9State, api: SimApi): void {
  const h = st.hall;
  if (!h) return;
  const hero = sim.hero;
  const inside = inBox(h, hero.x, hero.y);
  if (inside && !h.on) {
    h.on = true;
    h.next = sim.time + 2.5;
    if (!h.said) {
      h.said = true;
      sim.events.push({
        t: 'boss',
        what: 'f9_hall_call',
        text: 'КРУГОВОРОТ',
        sub: 'круги меняют пары — вперёд ведёт цвет руны над решёткой',
      });
    }
  }
  if (!h.on) return;
  // Ушёл далеко — зал затихает (пары остаются, как были).
  const far = !inBox(h, hero.x, hero.y, 8);
  if (far && sim.time >= h.spinUntil) {
    h.on = false;
    return;
  }
  if (sim.time >= h.next && sim.time >= h.spinUntil) {
    h.spinUntil = sim.time + SPIN_T;
    h.next = sim.time + SPIN_T + HALL_HOLD;
    shuffleHall(sim, st);
    // Герой стоит на круге и наливает его — вращение сбивает.
    if (st.charge && st.rings[st.charge.ring].kind === 'slot') {
      killZone(sim, st.charge.zin);
      killZone(sim, st.charge.zout);
      st.charge = null;
    }
    sim.events.push({ t: 'boss', what: 'f9_spin_call' });
    // Из вращающихся кругов выходят кобольды — не больше трёх на зал.
    const own = sim.mobs.filter((m) => m.data.hall === 1 && m.mode !== 'dying').length;
    if (inside && own < 3) {
      const n = Math.min(3 - own, 1 + (sim.rng() < 0.4 ? 1 : 0));
      const order = h.slots.slice().sort(() => sim.rng() - 0.5);
      for (let k = 0; k < n; k++) {
        const r = st.rings[order[k]];
        const [x, y] = ringCenter(r);
        if (hypot(x - hero.x, y - hero.y) < 2.2) continue;
        const m = api.spawnMob(sim, 'f9_kobold', x, y + 0.2, { mode: 'f9_appear' });
        m.data.hall = 1;
        m.data.ghost = 1;
        api.zone(sim, { x, y, r: 0.8, life: 0.5, art: 'f9_warp_arrive' });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Засада (лабиринт): красный круг переносит в замкнутый зал.
// ---------------------------------------------------------------------------

function stepAmbush(sim: Sim, st: F9State, api: SimApi): void {
  const a = st.amb;
  if (!a) return;
  const h = sim.hero;
  const inside = inBox(a, h.x, h.y);
  if (a.state === 0 && inside && !heroDown(sim)) {
    a.state = 1;
    a.t = sim.time;
    a.ids = [];
    sim.events.push({
      t: 'boss',
      what: 'f9_ambush_trap',
      text: 'ЗАСАДА',
      sub: 'круг выхода откроется, когда отобьёшься',
    });
    const kinds = ['f9_lizard', 'f9_lizard', 'f9_kobold', 'f9_kobold', 'f9_priest', 'f9_serpent'];
    const cx = (a.x0 + a.x1 + 1) / 2;
    const cy = (a.y0 + a.y1 + 1) / 2;
    kinds.forEach((kind, k) => {
      const ang = (k / kinds.length) * TAU + sim.rng() * 0.4;
      const R = Math.min(a.x1 - a.x0, a.y1 - a.y0) * 0.38;
      let x = cx + Math.cos(ang) * R;
      let y = cy + Math.sin(ang) * R;
      if (hypot(x - h.x, y - h.y) < 2.5) {
        x = cx - Math.cos(ang) * R;
        y = cy - Math.sin(ang) * R;
      }
      const m = api.spawnMob(sim, kind, x, y, { mode: 'drop', elite: k === 0 && sim.rng() < 0.4 });
      m.t = -k * 0.18;
      a.ids.push(m.id);
    });
    return;
  }
  if (a.state === 1) {
    const alive = sim.mobs.some((m) => a.ids.includes(m.id) && m.mode !== 'dying');
    if (heroDown(sim)) {
      a.state = 0;
      return;
    }
    if (!alive || sim.time - a.t > 40) {
      a.state = 2;
      sim.events.push({
        t: 'boss',
        what: 'f9_ambush_call',
        text: 'КРУГ ВЫХОДА ОТКРЫТ',
        sub: 'бирюзовый круг — к преддверию рун',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Корневая часовня (руины): двери зарастают, корни бьют рядами.
// ---------------------------------------------------------------------------

/** Сколько держат корни, с. */
export const CHAPEL_T = 24;

function sealChapel(sim: Sim, c: Chapel, api: SimApi, closed: boolean): void {
  c.doors.forEach((i, k) => {
    const x = i % sim.world.w;
    const y = Math.floor(i / sim.world.w);
    if (closed) api.setTile(sim, x, y, T_WALL, F9_MARK.rootwall);
    else api.setTile(sim, x, y, T_FLOOR, c.doorMarks[k]);
  });
}

function stepChapel(sim: Sim, st: F9State, dt: number, api: SimApi): void {
  const c = st.chapel;
  if (!c) return;
  const h = sim.hero;
  F9_VIEW.chapel = c.state;
  if (c.state === 0) {
    if (heroDown(sim)) return;
    // Вошёл глубже двух клеток от дверей — корни захлопывают часовню.
    const i = cellOf(sim, h.x, h.y);
    if (!c.cells.has(i)) return;
    const W = sim.world.w;
    const nearDoor = c.doors.some((d) => hypot((d % W) + 0.5 - h.x, Math.floor(d / W) + 0.5 - h.y) < 2.6);
    if (nearDoor) return;
    c.state = 1;
    c.t = sim.time;
    c.wave = 0;
    c.next = sim.time + 1.4;
    c.ids = [];
    // Чужие мобы за дверью остаются за дверью; внутри — те, кто зашёл.
    sealChapel(sim, c, api, true);
    for (const m of sim.mobs)
      if (c.doors.some((d) => cellOf(sim, m.x, m.y) === d)) {
        const f = floorNear(sim, api, m.x, m.y, 3);
        if (f) {
          m.x = f[0];
          m.y = f[1];
        }
      }
    sim.events.push({
      t: 'boss',
      what: 'f9_chapel_trap',
      text: 'КОРНИ ЗАПЕРЛИ ЧАСОВНЮ',
      sub: 'бьют рядами — стой между рядами',
    });
    // Из трясины часовни — хваталки.
    const pool = c.bog.slice().sort(() => sim.rng() - 0.5);
    for (let k = 0; k < Math.min(2, pool.length); k++) {
      const j = pool[k];
      const m = api.spawnMob(sim, 'f9_root', (j % W) + 0.5, Math.floor(j / W) + 0.5, {
        mode: 'f9_sub',
      });
      m.data.ghost = 1;
      m.data.chapel = 1;
      c.ids.push(m.id);
    }
    return;
  }
  if (c.state !== 1) return;
  if (heroDown(sim)) {
    // Упал — корни отпускают (новая вылазка начнёт заново).
    c.state = 0;
    sealChapel(sim, c, api, false);
    return;
  }
  const el = sim.time - c.t;
  if (sim.time >= c.next && el < CHAPEL_T - 1.5) {
    c.wave += 1;
    c.next = sim.time + (el > CHAPEL_T * 0.55 ? 2.0 : 2.5);
    // Ряды корней поперёк часовни через три клетки; ряд сдвигается —
    // безопасная полоса каждый раз в новом месте.
    const vertical = c.wave % 2 === 0;
    const off = (c.wave * 7) % 3;
    const len = vertical ? c.y1 - c.y0 + 1 : c.x1 - c.x0 + 1;
    const from = vertical ? c.x0 : c.y0;
    const to = vertical ? c.x1 : c.y1;
    for (let v = from + off; v <= to; v += 3) {
      api.strike(sim, {
        shape: 'line',
        x: vertical ? v + 0.5 : c.x0,
        y: vertical ? c.y0 : v + 0.5,
        r: len,
        w: 0.42,
        ang: vertical ? Math.PI / 2 : 0,
        warn: 0.95,
        dmg: rawShare(sim, 0.09),
        knock: 2,
        status: 'slow',
        dur: 1.2,
        art: 'f9_rootline',
      });
    }
    // На третьей волне — ещё хваталка.
    if (c.wave === 3 || c.wave === 6) {
      const j = c.bog[Math.floor(sim.rng() * c.bog.length)];
      if (j !== undefined) {
        const W = sim.world.w;
        const m = api.spawnMob(sim, 'f9_root', (j % W) + 0.5, Math.floor(j / W) + 0.5, {
          mode: 'f9_sub',
        });
        m.data.ghost = 1;
        m.data.chapel = 1;
        c.ids.push(m.id);
      }
    }
  }
  const rootsLeft = sim.mobs.some((m) => c.ids.includes(m.id) && m.mode !== 'dying');
  if (el >= CHAPEL_T || (el > CHAPEL_T * 0.6 && !rootsLeft)) {
    c.state = 2;
    sealChapel(sim, c, api, false);
    const W = sim.world.w;
    for (const i of c.shortcut) api.setTile(sim, i % W, Math.floor(i / W), T_FLOOR, F9_MARK.roots);
    sim.events.push({
      t: 'boss',
      what: 'f9_chapel_call',
      text: 'КОРНИ ОТСТУПИЛИ',
      sub: 'открыт прямой ход к лифту',
    });
    const [tx, ty] = c.totem;
    for (let k = 0; k < 4; k++) api.dropAt(sim, 'coin', 180, tx, ty);
    for (let k = 0; k < 3; k++) api.dropAt(sim, 'token', 2, tx, ty);
    api.dropAt(sim, 'f9_root', 1, tx, ty);
  }
}

// ---------------------------------------------------------------------------
// Прилив на гати (логово): вода встаёт за спиной.
// ---------------------------------------------------------------------------

/** Сколько клеток гати за героем держится сухими. */
const TIDE_GAP = 4;
/** Урон воды прилива: доля здоровья в секунду. */
const TIDE_DPS = 0.05;

function stepTide(sim: Sim, st: F9State, dt: number, api: SimApi): void {
  const t = st.tide;
  if (!t) return;
  const h = sim.hero;
  const here = t.step.get(cellOf(sim, h.x, h.y));
  const W = sim.world.w;
  if (t.state === 0) {
    if (here === undefined || here < 6 || heroDown(sim)) return;
    t.state = 1;
    t.t = sim.time;
    t.front = -1;
    t.leechT = 1.5;
    sim.events.push({
      t: 'boss',
      what: 'f9_tide_splash',
      text: 'ПРИЛИВ',
      sub: 'гать уходит под воду — беги к берегу',
    });
  }
  if (t.state === 1) {
    if (heroDown(sim)) {
      recede(sim, t);
      return;
    }
    // Вода догоняет: фронт — не ближе TIDE_GAP шагов за героем, и сам
    // ползёт вперёд, если стоишь.
    const target = here === undefined ? t.front + 0.9 * dt * 3 : Math.max(t.front, here - TIDE_GAP);
    const creep = t.front + dt * 1.3;
    const nf = Math.min(t.max + 1, Math.max(target, creep));
    if (Math.floor(nf) > Math.floor(t.front)) {
      for (const [i, s] of t.step) {
        if (s > Math.floor(nf) || s <= Math.floor(t.front) || t.zones.has(i)) continue;
        const id = zoneId(sim, api, {
          x: (i % W) + 0.5,
          y: Math.floor(i / W) + 0.5,
          // Клетка воды — ровно клетка: соседние зоны не складываются ни
          // замедлением (движок множит их), ни уроном (урон считает сам
          // прилив — по клетке под героем, один раз).
          r: 0.55,
          life: 1e9,
          warn: 0.8,
          slow: 0.5,
          art: 'f9_tidewater',
          step: s,
        });
        t.zones.set(i, id);
      }
    }
    t.front = nf;
    // Стоишь в воде — она тянет силы: одна доля за секунду, сколько бы
    // клеток ни ушло под воду вокруг.
    if (heroOnSunk(sim, t)) {
      h.hp -= sim.stats.maxHp * TIDE_DPS * dt;
      if (h.hp <= 0) {
        h.hp = 0;
        h.mode = 'dying';
        h.t = 0;
      }
    }
    // Пиявки прыгают из воды у гати.
    t.leechT -= dt;
    if (t.leechT <= 0 && here !== undefined) {
      t.leechT = 2.6 + sim.rng() * 1.6;
      leap(sim, st, api, 1 + (sim.rng() < 0.4 ? 1 : 0), 4);
    }
    // Дошёл до берега (ушёл с гати вперёд) — вода успокаивается.
    const ahead = here === undefined && t.front > 4 && !heroOnSunk(sim, t);
    if (ahead || t.front >= t.max + 1) {
      t.state = 2;
      t.t = sim.time;
    }
  } else if (t.state === 2 && sim.time - t.t > 9) {
    recede(sim, t);
    sim.events.push({ t: 'boss', what: 'f9_tide_call', text: 'ГАТЬ ПОДНЯЛАСЬ', sub: '' });
  }
}

function heroOnSunk(sim: Sim, t: Tide): boolean {
  const i = cellOf(sim, sim.hero.x, sim.hero.y);
  const id = t.zones.get(i);
  if (id === undefined) return false;
  const z = zoneById(sim, id);
  return !!z && z.t >= (z.warn ?? 0);
}

function recede(sim: Sim, t: Tide): void {
  for (const id of t.zones.values()) killZone(sim, id);
  t.zones.clear();
  t.state = 0;
  t.front = 0;
}

// ---------------------------------------------------------------------------
// Жизнь болота: хваталки в трясине, пиявки из воды, огни над водой.
// ---------------------------------------------------------------------------

const liveCount = (sim: Sim) =>
  sim.mobs.filter((m) => m.mode !== 'dying' && !m.kind.startsWith('f9_head') && m.kind !== 'f9boss')
    .length;

/** Пиявки прыгают из воды на берег рядом с героем. */
function leap(sim: Sim, st: F9State, api: SimApi, n: number, maxD: number): number {
  const h = sim.hero;
  const W = sim.world.w;
  const cand = st.shore.filter((i) => {
    const d = hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y);
    return d > 1.6 && d < maxD && walkable(sim.tiles[i]);
  });
  let made = 0;
  for (let k = 0; k < n && cand.length; k++) {
    const j = cand.splice(Math.floor(sim.rng() * cand.length), 1)[0];
    const x = (j % W) + 0.5;
    const y = Math.floor(j / W) + 0.5;
    // Откуда выпрыгнула: соседняя клетка воды.
    let wx = x;
    let wy = y;
    for (const d of [1, -1, W, -W]) {
      const q = j + d;
      if (isWaterMark(sim.world.mark[q]) && sim.tiles[q] === T_DEEP) {
        wx = (q % W) + 0.5;
        wy = Math.floor(q / W) + 0.5;
        break;
      }
    }
    const m = api.spawnMob(sim, 'f9_leech', x, y, { mode: 'f9_leap' });
    // Прыжок начинается у кромки воды — в своей клетке берега.
    m.data.fx = x + (wx - x) * 0.42;
    m.data.fy = y + (wy - y) * 0.42;
    m.data.ghost = 1;
    m.face = Math.atan2(y - wy, x - wx);
    api.zone(sim, { x: wx, y: wy, r: 0.6, life: 0.6, art: 'f9_splash' });
    made += 1;
  }
  if (made) sim.events.push({ t: 'squeak', x: h.x, y: h.y });
  return made;
}

function stepSwamp(sim: Sim, st: F9State, dt: number, api: SimApi): void {
  const h = sim.hero;
  if (heroDown(sim) || sim.boss?.state === 'fight') return;
  const nearLift = sim.safe.some((s) => hypot(s.x - h.x, s.y - h.y) < 12);
  const W = sim.world.w;
  // Хваталки: подходишь к трясине — в ней уже кто-то есть.
  if (!nearLift)
    for (const p of st.pockets) {
      if (hypot(p.cx - h.x, p.cy - h.y) > 10) continue;
      if (sim.time - p.at < 80) continue;
      if (st.chapel && st.chapel.cells.has(p.cells[0])) continue;
      if (sim.mobs.some((m) => m.data.pocket === p.id && m.mode !== 'dying')) continue;
      p.at = sim.time;
      const n = Math.min(2, Math.floor(p.cells.length / 9) + (sim.rng() < 0.5 ? 1 : 0));
      const free = p.cells.filter(
        (i) => hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y) > 3.2,
      );
      for (let k = 0; k < n && free.length; k++) {
        const i = free.splice(Math.floor(sim.rng() * free.length), 1)[0];
        const m = api.spawnMob(sim, 'f9_root', (i % W) + 0.5, Math.floor(i / W) + 0.5, {
          mode: 'f9_sub',
        });
        m.data.ghost = 1;
        m.data.pocket = p.id;
      }
    }
  const live = liveCount(sim);
  // Пиявки — если идёшь вдоль воды.
  st.leechT -= dt;
  if (st.leechT <= 0) {
    st.leechT = 7 + sim.rng() * 5;
    const wet = st.shore.some((i) => hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y) < 2.4);
    if (wet && !nearLift && live < 16) leap(sim, st, api, 1 + Math.floor(sim.rng() * 2), 5);
  }
  // Болотный огонь — над водой, где темно.
  st.wispT -= dt;
  if (st.wispT <= 0) {
    st.wispT = 14 + sim.rng() * 10;
    const wisps = sim.mobs.filter((m) => m.kind === 'f9_wisp' && m.mode !== 'dying').length;
    if (wisps < 2 && !nearLift && live < 16) {
      const cand = st.shore.filter((i) => {
        const d = hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y);
        return d > 5 && d < 9;
      });
      if (cand.length) {
        const i = cand[Math.floor(sim.rng() * cand.length)];
        const m = api.spawnMob(sim, 'f9_wisp', (i % W) + 0.5, Math.floor(i / W) + 0.5, {
          mode: 'f9_fadein',
        });
        m.data.ghost = 1;
      }
    }
  }
  // Кобольды выходят из кругов лабиринта, когда рядом герой.
  st.koboldT -= dt;
  if (st.koboldT <= 0) {
    st.koboldT = 16 + sim.rng() * 10;
    if (sim.area === F9_MAZE && !nearLift && live < 14) {
      const rs = st.rings.filter((r) => {
        const d = hypot(r.x + 0.5 - h.x, r.y + 0.5 - h.y);
        return r.area === F9_MAZE && r.kind !== 'exit' && d > 3.5 && d < 9;
      });
      if (rs.length) {
        const r = rs[Math.floor(sim.rng() * rs.length)];
        const m = api.spawnMob(sim, 'f9_kobold', r.x + 0.5, r.y + 0.7, { mode: 'f9_appear' });
        m.data.ghost = 1;
        api.zone(sim, { x: r.x + 0.5, y: r.y + 0.5, r: 0.8, life: 0.5, art: 'f9_warp_arrive' });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ящеролюд-копейщик: держит дистанцию копья, выпад по линии.
// ---------------------------------------------------------------------------

/** Длина выпада копьём, клеток. */
export const LUNGE = 3.4;

registerBrain('f9_lizard', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = m.mode === 'lunge';
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    // В трясине ящер как дома: не вязнет и бежит быстрее.
    const bog = bogAt(sim, m.x, m.y);
    const sp = m.speed * (bog ? 1.3 : 1);
    switch (m.mode) {
      case 'chase': {
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        const busy = sim.mobs.some(
          (o) =>
            o !== m && o.kind === 'f9_lizard' && (o.mode === 'aim' || o.mode === 'lunge') && hypot(o.x - m.x, o.y - m.y) < 7,
        );
        if (see && dist > 1.5 && dist < LUNGE - 0.2 && m.cd <= 0 && !busy) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Держит дистанцию копья и обходит с боку.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        if (dist < 2.6 && see) {
          const side = m.id % 2 ? 1 : -1;
          const a = Math.atan2(dy, dx) + side * 1.35;
          cx = Math.cos(a) * 0.8 - (dx / (dist || 1)) * 0.4;
          cy = Math.sin(a) * 0.8 - (dy / (dist || 1)) * 0.4;
          const l = hypot(cx, cy) || 1;
          cx /= l;
          cy /= l;
        }
        api.steer(sim, m, cx, cy, sp * (dist < 3 ? 0.7 : 1), dt);
        return;
      }
      case 'aim': {
        const T = bog ? 0.5 : 0.62;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(LUNGE + 0.4, wallDist(sim, api, m.x, m.y, m.dir, LUNGE + 0.4));
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.25) m.danger = LUNGE + 0.6;
        if (m.t >= T) {
          m.data.hit = 0;
          api.setMode(m, 'lunge');
        }
        return;
      }
      case 'lunge': {
        const s = 10;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.45 && canHit(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.3, m.x, m.y, 5, m.kind);
        }
        if (m.t > LUNGE / s) {
          api.setMode(m, 'recover');
          m.cd = 1.6 + sim.rng() * 0.6;
        }
        return;
      }
      case 'stuck':
        // Копьё ушло в кладку — вытаскивает: главное окно.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 1.1) {
          api.setMode(m, 'recover');
          m.cd = 1.2;
        }
        return;
      case 'windup':
        biteStep(sim, m, c, api, 3);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.6) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'lunge') return;
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    api.setMode(m, 'stuck');
  },
});

// ---------------------------------------------------------------------------
// Ядовитая жаба: плевок навесом, на месте падения — лужа яда.
// ---------------------------------------------------------------------------

/** Лужа яда на месте плевка. */
function venomPool(sim: Sim, api: SimApi, x: number, y: number, warn: number, r = 0.85): void {
  if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return;
  api.zone(sim, {
    x,
    y,
    r,
    life: 4.5,
    warn,
    dps: 0.012,
    status: 'poison',
    dur: 1.6,
    art: 'f9_venom',
  });
}

registerBrain('f9_toad', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    const home = markAt(sim, Math.floor(m.x), Math.floor(m.y)) === F9_MARK.venom;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (see && dist > 2.2 && dist < 7.5 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Держит дистанцию плевка: близко — отпрыгивает.
        let dir: [number, number];
        if (dist < 2.8 && see) dir = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        else dir = api.chaseDir(sim, m, h.x, h.y);
        const hop = 0.3 + 1.3 * Math.max(0, Math.sin(m.t * 7 + m.id));
        const k = dist < 5.5 && dist > 2.8 ? 0.25 : 1;
        api.steer(sim, m, dir[0], dir[1], m.speed * hop * k, dt);
        return;
      }
      case 'aim': {
        // Раздувает горло: чем дольше, тем больше пузырь.
        const T = home ? 0.5 : 0.62;
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        if (m.t >= T) {
          // В ядовитой топи — очередью: три плевка веером.
          const n = home ? 3 : 1;
          for (let k = 0; k < n; k++) {
            const off = n > 1 ? (k - 1) * 1.1 : 0;
            const a = m.dir + Math.PI / 2;
            const tx = h.x + Math.cos(a) * off + h.vx * 0.25;
            const ty = h.y + Math.sin(a) * off + h.vy * 0.25;
            const T2 = Math.max(0.35, hypot(tx - m.x, ty - m.y) / 6);
            api.shoot(sim, m, Math.atan2(ty - m.y, tx - m.x), undefined, tx, ty);
            venomPool(sim, api, tx, ty, T2, 0.8);
          }
          api.setMode(m, 'recover');
          m.cd = home ? 3.2 : 2.6 + sim.rng();
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
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
  onHit(sim, m) {
    // Ударили вплотную — жаба отскакивает назад (но удар прошёл).
    if (m.mode === 'chase' || m.mode === 'recover') {
      const a = Math.atan2(m.y - sim.hero.y, m.x - sim.hero.x);
      m.vx += Math.cos(a) * 4;
      m.vy += Math.sin(a) * 4;
    }
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Телепорт-кобольд: прыжок за спину (метка на полу), удар, прыжок прочь.
// ---------------------------------------------------------------------------

/** Сколько горит метка прыжка кобольда до переноса, с. */
export const BLINK_T = 0.42;

/** Точка за спиной героя (или рядом), куда можно встать. */
function behindHero(sim: Sim, api: SimApi, m: Mob, d: number): [number, number] | null {
  const h = sim.hero;
  const a0 = Math.atan2(h.y - m.y, h.x - m.x);
  for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
    const a = a0 + off;
    const x = h.x + Math.cos(a) * d;
    const y = h.y + Math.sin(a) * d;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    if (!api.lineOfSight(sim, h.x, h.y, x, y)) continue;
    return [x, y];
  }
  return null;
}

/** Точка прочь от героя на d клеток. */
function awayPoint(sim: Sim, api: SimApi, m: Mob, d: number): [number, number] | null {
  const h = sim.hero;
  const a0 = Math.atan2(m.y - h.y, m.x - h.x);
  for (const off of [0, 0.6, -0.6, 1.2, -1.2, 2, -2, 3]) {
    const a = a0 + off;
    const x = m.x + Math.cos(a) * d;
    const y = m.y + Math.sin(a) * d;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    if (!api.lineOfSight(sim, m.x, m.y, x, y)) continue;
    return [x, y];
  }
  return null;
}

function startBlink(sim: Sim, api: SimApi, m: Mob, x: number, y: number, then: number): void {
  m.data.tx = x;
  m.data.ty = y;
  m.data.then = then;
  api.zone(sim, { x, y, r: 0.55, life: BLINK_T + 0.25, art: 'f9_blink' });
  api.setMode(m, 'f9_mark');
}

/** Прыжок кобольда: метка → исчез → появился (общий со скупщиком). */
function blinkStep(sim: Sim, m: Mob, api: SimApi): boolean {
  if (m.mode === 'f9_mark') {
    m.vx *= 0.5;
    m.vy *= 0.5;
    if (m.t >= BLINK_T) {
      api.zone(sim, { x: m.x, y: m.y, r: 0.6, life: 0.35, art: 'f9_puff' });
      m.x = m.data.tx;
      m.y = m.data.ty;
      m.vx = 0;
      m.vy = 0;
      m.data.ghost = 1;
      api.setMode(m, 'f9_appear');
      sim.events.push({ t: 'boss', what: 'f9_blink' });
    }
    return true;
  }
  if (m.mode === 'f9_appear') {
    m.data.ghost = 1;
    m.vx = 0;
    m.vy = 0;
    if (m.t >= 0.22) {
      m.data.ghost = 0;
      const then = m.data.then ?? 0;
      m.data.then = 0;
      m.face = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
      api.setMode(m, then === 1 ? 'windup' : 'chase');
    }
    return true;
  }
  return false;
}

registerBrain('f9_kobold', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    if (blinkStep(sim, m, api)) return;
    switch (m.mode) {
      case 'chase': {
        const st = stateOf(sim);
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Прыжок за спину.
        if (see && dist < 4.4 && dist > 1.2 && m.cd <= 0) {
          const p = behindHero(sim, api, m, 1.05);
          if (p) {
            startBlink(sim, api, m, p[0], p[1], 1);
            m.cd = 3.4 + sim.rng();
            return;
          }
        }
        // Круг под ногами ведёт ближе к герою — шагнуть в него.
        const ri = st.ringAt.get(cellOf(sim, m.x, m.y));
        if (ri !== undefined && (m.data.warpCd ?? 0) < sim.time && st.rings[ri].to >= 0) {
          const to = st.rings[st.rings[ri].to];
          if (hypot(to.x + 0.5 - h.x, to.y + 0.5 - h.y) + 4 < dist && ringActive(sim, st, ri))
            if (warpMob(sim, api, m, st, ri)) return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'windup': {
        // Удар кинжалом: короткий замах, метку рисует движок.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < def.windup) return;
        const reach = def.reach + m.r + h.r + 0.25;
        if (dist < reach && canHit(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 2.5, m.kind);
        api.setMode(m, 'recover');
        m.data.bcd = def.rest;
        m.data.flee = 1;
        return;
      }
      case 'recover': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t < 0.55) return;
        // Ударил — прыжок прочь.
        if (m.data.flee) {
          m.data.flee = 0;
          const p = awayPoint(sim, api, m, 4.2);
          if (p) {
            startBlink(sim, api, m, p[0], p[1], 0);
            return;
          }
        }
        api.setMode(m, 'chase');
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Каменный змей: взгляд конусом — замедление; дважды подряд — камень.
// ---------------------------------------------------------------------------

export const GAZE_R = 4.6;
/** Сколько «камень в ногах» ждёт второго взгляда, с. */
export const STONE_T = 4.2;
export const GAZE_ARC = 0.95;
const GAZE_T = 0.9;

registerBrain('f9_serpent', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (see && dist < GAZE_R - 0.4 && dist > 1.4 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'gaze');
          return;
        }
        // Ползёт волной, держится в трёх клетках.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 3 + m.id) * 0.6;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        const k = dist < 2.8 && see ? 0.35 : 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * k, dt);
        return;
      }
      case 'gaze': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        // Голову доводит до героя, потом взгляд застывает.
        if (m.t < GAZE_T * 0.5) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: GAZE_R, arc: GAZE_ARC, ang: m.dir, k: Math.min(1, m.t / GAZE_T) };
        if (m.t > GAZE_T - 0.25) m.danger = GAZE_R + 0.3;
        if (m.t >= GAZE_T) {
          const off = Math.abs(angDiff(Math.atan2(dy, dx), m.dir));
          const inCone = dist < GAZE_R + h.r && off < GAZE_ARC / 2 + Math.atan(h.r / Math.max(0.3, dist));
          // За стеной не достанет: взгляд идёт по прямой.
          const seen = inCone && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
          const hitNow = seen && canHit(sim);
          if (hitNow) {
            const stone = (sim.floorData.stone ?? 0) > sim.time;
            if (stone) {
              api.hurtHero(sim, m.dmg * 0.8, m.x, m.y, 0, m.kind, { kind: 'stun', dur: 0.9 });
              sayOnce(sim, 'stone', 25, {
                what: 'f9_stone',
                text: 'ОКАМЕНЕЛ',
                sub: 'второй взгляд подряд — уходи за угол',
              });
              sim.floorData.stone = 0;
            } else {
              api.hurtHero(sim, m.dmg * 0.6, m.x, m.y, 0, m.kind, { kind: 'slow', dur: 2.2 });
              sim.floorData.stone = sim.time + STONE_T;
            }
          }
          const z: ZoneX = { x: m.x, y: m.y, r: GAZE_R, life: 0.35, art: 'f9_gaze', ang: m.dir };
          api.zone(sim, z);
          api.setMode(m, 'recover');
          // Попал — второй взгляд скоро: не ушёл из вида — окаменеешь.
          m.cd = hitNow ? 2.2 : 3.4 + sim.rng() * 1.2;
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api, 3);
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

// ---------------------------------------------------------------------------
// Болотный огонь: заманивает к воде, вспыхивает холодом.
// ---------------------------------------------------------------------------

const FLARE_R = 1.8;

/** Ближняя вода топи от точки (в шести клетках). */
function waterNear(sim: Sim, x: number, y: number, R = 6): [number, number] | null {
  const W = sim.world.w;
  let best: [number, number] | null = null;
  let bd = 1e9;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let yy = cy - R; yy <= cy + R; yy++)
    for (let xx = cx - R; xx <= cx + R; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= sim.world.h) continue;
      const i = yy * W + xx;
      if (!isWaterMark(sim.world.mark[i]) || sim.tiles[i] !== T_DEEP) continue;
      const d = hypot(xx + 0.5 - x, yy + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = [xx + 0.5, yy + 0.5];
      }
    }
  return best;
}

registerBrain('f9_wisp', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f9_fadein':
        m.data.ghost = 1;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.7) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        // Манит: держится в 4–6 клетках, уходит к воде, но не отпускает.
        if (dist < 2.4 && m.cd <= 0) {
          api.setMode(m, 'flare');
          return;
        }
        let tx = h.x;
        let ty = h.y;
        const wtr = waterNear(sim, m.x, m.y, 5);
        if (dist < 5 && wtr) {
          tx = wtr[0] + (wtr[0] - h.x) * 0.3;
          ty = wtr[1] + (wtr[1] - h.y) * 0.3;
        } else if (dist < 4.2) {
          tx = m.x - dx;
          ty = m.y - dy;
        }
        const ddx = tx - m.x;
        const ddy = ty - m.y;
        const l = hypot(ddx, ddy) || 1;
        const bob = Math.sin(sim.time * 2.3 + m.id) * 0.5;
        const sp = dist > 7 ? m.speed : m.speed * 0.6;
        api.steer(sim, m, ddx / l + -ddy / l * bob, ddy / l + (ddx / l) * bob, sp, dt);
        if (dist > 6.5) m.cd = Math.min(m.cd, 0.5);
        return;
      }
      case 'flare': {
        // Вспышка: кольцо холода вокруг себя.
        const T = 0.7;
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = { shape: 'circle', r: FLARE_R, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.25) m.danger = FLARE_R + 0.3;
        if (m.t >= T) {
          if (dist < FLARE_R + h.r && canHit(sim))
            api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 4, m.kind, { kind: 'chill', dur: 1.8 });
          api.zone(sim, { x: m.x, y: m.y, r: FLARE_R, life: 0.35, art: 'f9_flare' });
          api.setMode(m, 'fade');
          m.cd = 3.5 + sim.rng();
        }
        return;
      }
      case 'fade': {
        // Гаснет и загорается в другом месте, над водой.
        m.data.ghost = 1;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 0.6) {
          const w = waterNear(sim, h.x, h.y, 7);
          if (w && hypot(w[0] - h.x, w[1] - h.y) > 3) {
            m.x = w[0];
            m.y = w[1];
          } else {
            const a = sim.rng() * TAU;
            const x = h.x + Math.cos(a) * 5;
            const y = h.y + Math.sin(a) * 5;
            if (!api.solidTile(sim, Math.floor(x), Math.floor(y))) {
              m.x = x;
              m.y = y;
            }
          }
          api.setMode(m, 'f9_fadein');
        }
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, _hit, api) {
    // Ударили — вспыхивает раньше (но не мгновенно: метка горит).
    if (m.mode === 'chase' && m.cd > 0.3) m.cd = 0.3;
    void api;
    void sim;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Корневая хваталка: живёт в трясине; круг корней держит, потом открыта.
// ---------------------------------------------------------------------------

const GRAB_R = 0.95;
const GRAB_T = 0.62;

/** Клетка трясины ближе всего к точке (своя лужа). */
function bogToward(sim: Sim, m: Mob, x: number, y: number): [number, number] | null {
  const W = sim.world.w;
  const cx = Math.floor(m.x);
  const cy = Math.floor(m.y);
  let best: [number, number] | null = null;
  let bd = 1e9;
  for (let yy = cy - 5; yy <= cy + 5; yy++)
    for (let xx = cx - 5; xx <= cx + 5; xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= sim.world.h) continue;
      const i = yy * W + xx;
      if (!isBogMark(sim.world.mark[i]) || sim.tiles[i] !== T_HAZARD) continue;
      const d = hypot(xx + 0.5 - x, yy + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = [xx + 0.5, yy + 0.5];
      }
    }
  return best;
}

registerBrain('f9_root', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f9_sub': {
        // Под трясиной: невидим, ползёт по своей луже к герою.
        m.data.ghost = 1;
        const b = bogToward(sim, m, h.x, h.y);
        if (b) {
          const tx = b[0] - m.x;
          const ty = b[1] - m.y;
          const d = hypot(tx, ty);
          if (d > 0.2) api.steer(sim, m, tx / d, ty / d, m.speed * 0.8, dt);
          else {
            m.vx *= 0.7;
            m.vy *= 0.7;
          }
        }
        // Не даём сойти с трясины.
        if (!bogAt(sim, m.x + m.vx * dt * 3, m.y + m.vy * dt * 3)) {
          m.vx *= 0.2;
          m.vy *= 0.2;
        }
        if (dist < 2.9 && m.cd <= 0 && !heroDown(sim)) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          api.setMode(m, 'grab');
        }
        return;
      }
      case 'grab': {
        // Круг корней под героем наливается, потом корни держат.
        m.data.ghost = 1;
        m.vx *= 0.5;
        m.vy *= 0.5;
        // Первые доли секунды круг следует за героем, потом застывает.
        if (m.t < GRAB_T * 0.4) {
          m.data.gx = h.x;
          m.data.gy = h.y;
        }
        m.tele = { shape: 'circle', r: GRAB_R, k: Math.min(1, m.t / GRAB_T), x: m.data.gx, y: m.data.gy };
        if (m.t > GRAB_T - 0.25) m.danger = 9;
        if (m.t >= GRAB_T) {
          const hit = hypot(h.x - m.data.gx, h.y - m.data.gy) < GRAB_R + h.r;
          if (hit && canHit(sim)) {
            api.hurtHero(sim, m.dmg * 0.8, m.data.gx, m.data.gy, 0, m.kind, { kind: 'slow', dur: 1.5 });
            api.heroStatus(sim, 'slow', 1.5, 0.7);
          }
          api.zone(sim, { x: m.data.gx, y: m.data.gy, r: GRAB_R, life: 0.9, art: 'f9_grab' });
          m.data.ghost = 0;
          api.setMode(m, 'up');
        }
        return;
      }
      case 'up': {
        // Вынырнул — открыт, хлещет, кто рядом.
        m.data.ghost = 0;
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        if (m.t > 2.8) {
          api.setMode(m, 'dive');
          return;
        }
        if (dist < def.reach + m.r + h.r + 0.6 && (m.data.bcd ?? 0) <= 0 && m.t > 0.5) {
          api.setMode(m, 'windup');
        }
        m.data.bcd = (m.data.bcd ?? 0) - dt;
        return;
      }
      case 'windup': {
        m.data.ghost = 0;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < def.windup) return;
        const reach = def.reach + m.r + h.r + 0.6;
        if (dist < reach && canHit(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
        m.data.bcd = def.rest;
        api.setMode(m, 'up');
        m.t = 1.2;
        return;
      }
      case 'dive':
        m.data.ghost = 1;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t > 0.45) {
          m.cd = 2.2 + sim.rng();
          api.setMode(m, 'f9_sub');
        }
        return;
      case 'stun':
      case 'recover':
      case 'chase':
        m.data.ghost = 0;
        if (m.t > 0.3) api.setMode(m, 'up');
        return;
      default:
        api.setMode(m, 'f9_sub');
    }
  },
});

// ---------------------------------------------------------------------------
// Пиявка: прыжок из воды, присасывается — пьёт кровь; рывок стряхивает.
// ---------------------------------------------------------------------------

registerBrain('f9_leech', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f9_leap': {
        // Дугой из воды на берег: недосягаема, пока в воздухе.
        m.data.ghost = 1;
        const k = Math.min(1, m.t / 0.4);
        const tx = m.hx;
        const ty = m.hy;
        m.x = m.data.fx + (tx - m.data.fx) * k;
        m.y = m.data.fy + (ty - m.data.fy) * k;
        m.vx = 0;
        m.vy = 0;
        if (k >= 1) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
          m.cd = 0.2;
        }
        return;
      }
      case 'chase': {
        if (dist < m.r + h.r + 0.25 && m.cd <= 0 && canHit(sim)) {
          m.data.la = Math.atan2(m.y - h.y, m.x - h.x);
          api.setMode(m, 'latch');
          sayOnce(sim, 'leech', 60, {
            what: 'f9_leech',
            text: 'ПИЯВКА',
            sub: 'пьёт кровь — стряхни рывком или бей',
          });
          return;
        }
        // Извивается к герою.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 9 + m.id) * 0.5;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed, dt);
        return;
      }
      case 'latch': {
        // Держится за бок: сосёт, пока не стряхнут рывком.
        const a = m.data.la ?? 0;
        m.x = h.x + Math.cos(a) * 0.52;
        m.y = h.y + Math.sin(a) * 0.52;
        m.vx = 0;
        m.vy = 0;
        m.face = a + Math.PI;
        if (h.mode === 'dash' || heroDown(sim)) {
          // Стряхнули — летит прочь и лежит оглушённая.
          m.vx = Math.cos(a) * 6;
          m.vy = Math.sin(a) * 6;
          api.setMode(m, 'dizzy');
          return;
        }
        const n = sim.mobs.filter((o) => o.kind === 'f9_leech' && o.mode === 'latch').length;
        api.heroStatus(sim, 'poison', 0.3, 0.011 * n);
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 1.1) {
          api.setMode(m, 'chase');
          m.cd = 1.2;
        }
        return;
      case 'stun':
        if (m.t > 0.2) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
    void dy;
    void dx;
  },
});

// ---------------------------------------------------------------------------
// Ящер-жрец: руна под героем — не вышел, перенесён к жрецу.
// ---------------------------------------------------------------------------

const RUNE_R = 1;
const RUNE_T = 1.15;

registerBrain('f9_priest', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (see && dist > 3 && dist < 8.5 && m.cd <= 0) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          m.data.rz = zoneId(sim, api, {
            x: h.x,
            y: h.y,
            r: RUNE_R,
            life: RUNE_T + 0.2,
            art: 'f9_rune',
          });
          // Точка выхода — у ног жреца, вспышка видна сразу.
          const p = floorNear(sim, api, m.x + Math.cos(Math.atan2(dy, dx)) * 1.1, m.y + Math.sin(Math.atan2(dy, dx)) * 1.1, 2);
          m.data.px = p ? p[0] : m.x;
          m.data.py = p ? p[1] : m.y;
          m.data.oz = zoneId(sim, api, {
            x: m.data.px,
            y: m.data.py,
            r: 0.7,
            life: RUNE_T + 0.3,
            art: 'f9_warp_out',
            col: 3,
          });
          api.setMode(m, 'cast');
          return;
        }
        // Держится подальше: подходит на 5–7, близко — отступает.
        let dir: [number, number];
        if (dist < 4 && see) dir = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        else dir = api.chaseDir(sim, m, h.x, h.y);
        const k = dist < 7 && dist > 4 ? 0.2 : 1;
        api.steer(sim, m, dir[0], dir[1], m.speed * k, dt);
        return;
      }
      case 'cast': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'ring', r: RUNE_R, w: 0.14, k: Math.min(1, m.t / RUNE_T), x: m.data.gx, y: m.data.gy };
        if (m.t > RUNE_T - 0.25 && hypot(h.x - m.data.gx, h.y - m.data.gy) < RUNE_R + 0.3) m.danger = 99;
        if (m.t >= RUNE_T) {
          const inside = hypot(h.x - m.data.gx, h.y - m.data.gy) < RUNE_R + h.r * 0.3;
          if (inside && canHit(sim)) {
            api.moveHero(sim, m.data.px, m.data.py);
            api.zone(sim, { x: m.data.px, y: m.data.py, r: 0.9, life: 0.5, art: 'f9_warp_arrive' });
            sim.events.push({ t: 'boss', what: 'f9_warp_call' });
            sayOnce(sim, 'pull', 40, {
              what: 'f9_pull',
              text: 'РУНА ЖРЕЦА',
              sub: 'выходи из круга, пока не налился',
            });
          }
          api.setMode(m, 'recover');
          m.cd = 7 + sim.rng() * 2;
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
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
  onDeath(sim, m) {
    // Жрец пал — руна гаснет.
    killZone(sim, m.data.rz ?? 0);
    killZone(sim, m.data.oz ?? 0);
  },
});

// ---------------------------------------------------------------------------
// Кобольд-скупщик: убегает прыжками и кругами, мешок звенит.
// ---------------------------------------------------------------------------

registerBrain('f9_hoarder', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist } = c;
    m.tele = null;
    m.danger = 0;
    if (blinkStep(sim, m, api)) {
      if (m.mode === 'windup') api.setMode(m, 'flee');
      return;
    }
    switch (m.mode) {
      case 'chase':
      case 'flee': {
        const st = stateOf(sim);
        if (dist < 2.6 && m.cd <= 0) {
          const p = awayPoint(sim, api, m, 5);
          if (p) {
            startBlink(sim, api, m, p[0], p[1], 0);
            m.cd = 2.8;
            return;
          }
        }
        const ri = st.ringAt.get(cellOf(sim, m.x, m.y));
        if (ri !== undefined && (m.data.warpCd ?? 0) < sim.time && dist < 6) {
          if (warpMob(sim, api, m, st, ri)) return;
        }
        const dir = api.flowDir(sim, m.x, m.y, true);
        const [fx, fy] = dir ?? [-(h.x - m.x) / (dist || 1), -(h.y - m.y) / (dist || 1)];
        const z = Math.sin(sim.time * 4 + m.id) * 0.4;
        api.steer(sim, m, fx - fy * z, fy + fx * z, m.speed * (dist > 9 ? 0.5 : 1), dt);
        // Мешок звенит — видно, куда убежал.
        if (Math.floor(sim.time * 1.5) !== Math.floor((sim.time - dt) * 1.5))
          sim.events.push({ t: 'gold', x: m.x, y: m.y, mob: m.kind });
        return;
      }
      default:
        api.setMode(m, 'flee');
    }
  },
});

// ---------------------------------------------------------------------------
// Гидра. Тело стоит в озере; головы — части босса на шеях; обрубок шеи
// отрастает двумя головами, если его не прижечь огнём.
// ---------------------------------------------------------------------------

/** Стихии голов. */
export const EL = { fire: 0, ice: 1, venom: 2, bolt: 3, light: 4 } as const;
export const EL_NAME = ['огненная', 'ледяная', 'ядовитая', 'грозовая', 'белая'];

/** Длина шеи: дальше основания голова не уходит. */
export const NECK = 6.2;
/** Засечки фаз на полосе. */
export const HYDRA_NOTCH = [0.75, 0.5, 0.25];
/** Отсечённая голова — столько тела долой; прижжённая шея — ещё столько. */
export const SEVER = 0.05;
export const SEAR = 0.075;
/** Отросла — гидра берёт своё обратно. */
export const REGROW_HEAL = 0.03;
/** Через сколько отрастает обрубок по фазам, с. */
export const REGROW_T = [8.5, 7.5, 6];
/** Голов не больше. */
const HEAD_CAP = [5, 6, 6, 0];
/** Голов не меньше: меньше — гидра растит новую из тела через `SPROUT_T`. */
const HEAD_MIN = [2, 3, 3, 0];
export const SPROUT_T = 3.5;
/** Хвост из воды: раз в столько секунд по фазам. */
const TAIL_CD = [9, 8, 6.5];
/** Огонь в руке, с. */
export const FIRE_T = 10;

const bodyOf = (sim: Sim) => sim.mobs.find((m) => m.kind === 'f9boss' && m.mode !== 'dying');
const headsOf = (sim: Sim) => sim.mobs.filter((m) => m.kind === 'f9_head' && m.mode !== 'dying');
const crownOf = (sim: Sim) => sim.mobs.find((m) => m.kind === 'f9_crown' && m.mode !== 'dying');
const stumpsOf = (sim: Sim) => sim.mobs.filter((m) => m.kind === 'f9_stump' && m.mode !== 'dying');

/** Основание шеи на краю тела: головы веером вокруг. */
function anchorOf(body: Mob, slot: number): [number, number] {
  const angs = [Math.PI / 2, Math.PI / 2 - 1.05, Math.PI / 2 + 1.05, -Math.PI / 2, -0.4, Math.PI + 0.4, -Math.PI / 2 - 0.9, -Math.PI / 2 + 0.9];
  const a = angs[slot % angs.length];
  return [body.x + Math.cos(a) * 1.25, body.y + Math.sin(a) * 0.95];
}

/** Свободный номер шеи. */
function freeSlot(sim: Sim): number {
  const used = new Set<number>();
  for (const m of [...headsOf(sim), ...stumpsOf(sim)]) used.add(m.data.slot ?? -1);
  for (let s = 0; s < 8; s++) if (!used.has(s)) return s;
  return Math.floor(sim.rng() * 8);
}

function spawnHead(sim: Sim, api: SimApi, el: number, slot: number, x?: number, y?: number): Mob | null {
  const body = bodyOf(sim);
  if (!body) return null;
  const [ax, ay] = anchorOf(body, slot);
  const m = api.spawnMob(sim, 'f9_head', x ?? ax, y ?? ay, { mode: 'rise', level: body.level });
  m.data.el = el;
  m.data.slot = slot;
  m.data.ghost = 1;
  m.cd = 1.5 + sim.rng() * 1.5;
  m.face = Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x);
  return m;
}

/** Урон телу долей полосы (в обход брони: его рубят не клинком). */
function woundBody(sim: Sim, share: number): void {
  const b = bodyOf(sim);
  if (!b) return;
  b.hp = Math.max(b.maxHp * 0.02, Math.min(b.maxHp, b.hp - b.maxHp * share));
  b.flash = 0.2;
}

/** Есть ли огонь для прижигания: в руке или рядом тлеющая лужа. */
export function fireFor(sim: Sim, x: number, y: number): boolean {
  const st = stateOf(sim);
  if (st.fire > sim.time) return true;
  const h = sim.hero;
  for (const z of sim.zones) {
    if (z.art !== 'f9_embers' || z.t < (z.warn ?? 0)) continue;
    if (hypot(z.x - x, z.y - y) < z.r + 1.1 || hypot(z.x - h.x, z.y - h.y) < z.r + 0.9) return true;
  }
  return false;
}

/** Тлеющие лужи там, куда дохнул огонь. */
function embers(sim: Sim, api: SimApi, x: number, y: number, ang: number, warn: number): void {
  for (const d of [1.6, 2.8]) {
    const px = x + Math.cos(ang) * d;
    const py = y + Math.sin(ang) * d;
    if (api.solidTile(sim, Math.floor(px), Math.floor(py))) continue;
    api.zone(sim, {
      x: px,
      y: py,
      r: 0.7,
      life: 6,
      warn,
      dps: 0.02,
      status: 'burn',
      dur: 0.8,
      art: 'f9_embers',
    });
  }
}

/** Сколько голов может бить разом (кроме укусов). */
const busyCap = (phase: number) => (phase >= 1 ? 2 : 1);

function headBusy(sim: Sim, except: Mob): number {
  return sim.mobs.filter(
    (o) => o !== except && o.kind === 'f9_head' && (o.mode === 'cast' || o.mode === 'heal'),
  ).length;
}

/** Где голова хочет быть: к герою, но на длину шеи, веером по номеру. */
function headSpot(sim: Sim, m: Mob, ax: number, ay: number): [number, number] {
  const h = sim.hero;
  const a = Math.atan2(h.y - ay, h.x - ax) + ((m.data.slot ?? 0) % 3 - 1) * 0.35;
  const d = Math.min(NECK, Math.max(1.2, hypot(h.x - ax, h.y - ay) - 1.6));
  return [ax + Math.cos(a) * d, ay + Math.sin(a) * d];
}

registerBrain('f9_body', {
  raw: true,
  step(sim, m, dt) {
    // Тело не ходит и клинком не берётся (прицел его не ищет — иначе удары
    // уходили бы в чешую): стоит в озере и дышит. Всё делает сценарий.
    m.vx = 0;
    m.vy = 0;
    m.tele = null;
    m.danger = 0;
    m.data.ghost = 1;
    if (m.data.px !== undefined) {
      m.x = m.data.px;
      m.y = m.data.py;
    }
    m.face = Math.PI / 2;
    void dt;
    void sim;
  },
});

registerBrain('f9_head', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const body = bodyOf(sim);
    m.tele = null;
    m.danger = 0;
    if (!body) return;
    const phase = sim.boss?.phase ?? 0;
    const haste = phase >= 2 ? 1.2 : phase >= 1 ? 1.1 : 1;
    const [ax, ay] = anchorOf(body, m.data.slot ?? 0);
    m.data.ax = ax;
    m.data.ay = ay;
    const el = m.data.el ?? 0;
    // Шея держит: дальше длины не уйти.
    const nd = hypot(m.x - ax, m.y - ay);
    if (nd > NECK) {
      m.x = ax + ((m.x - ax) / nd) * NECK;
      m.y = ay + ((m.y - ay) / nd) * NECK;
    }
    if (heroDown(sim)) {
      m.vx *= 0.8;
      m.vy *= 0.8;
      return;
    }
    switch (m.mode) {
      case 'rise':
        // Голова вырастает из шеи: полсекунды недосягаема.
        m.data.ghost = 1;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.9) {
          m.data.ghost = 0;
          api.setMode(m, 'idle');
        }
        return;
      case 'idle': {
        m.data.ghost = 0;
        const [tx, ty] = headSpot(sim, m, ax, ay);
        const ddx = tx - m.x;
        const ddy = ty - m.y;
        const l = hypot(ddx, ddy);
        const sway = Math.sin(sim.time * 1.8 + m.id) * 0.6;
        if (l > 0.3) api.steer(sim, m, ddx / l - (ddy / l) * sway * 0.3, ddy / l + (ddx / l) * sway * 0.3, m.speed * haste, dt);
        else {
          m.vx *= 0.8;
          m.vy *= 0.8;
        }
        m.face = Math.atan2(dy, dx);
        if (m.cd > 0 || m.t < 0.4) return;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        // Укус — если герой под пастью; не два укуса разом.
        const biting = sim.mobs.some((o) => o !== m && o.kind === 'f9_head' && o.mode === 'bite');
        if (dist < 2.3 && !biting) {
          m.dir = Math.atan2(dy, dx);
          const bx = m.x + Math.cos(m.dir) * 1.15;
          const by = m.y + Math.sin(m.dir) * 1.15;
          api.strike(sim, {
            shape: 'circle',
            x: bx,
            y: by,
            r: 0.85,
            warn: 0.6 / haste,
            dmg: m.dmg * 1.15,
            knock: 5,
            art: 'f9_bite',
            from: m.id,
          });
          m.data.bx = bx;
          m.data.by = by;
          api.setMode(m, 'bite');
          return;
        }
        if (!see || dist > 8.6 || headBusy(sim, m) >= busyCap(phase)) return;
        if (el === EL.light) {
          // Белая голова лечит самую израненную.
          const hurt = headsOf(sim)
            .filter((o) => o !== m && o.hp < o.maxHp * 0.85 && o.mode !== 'rise')
            .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
          if (hurt) {
            m.data.target = hurt.id;
            api.setMode(m, 'heal');
            return;
          }
          if (dist > 3) return;
        }
        m.dir = Math.atan2(dy, dx);
        m.data.cast = 0;
        m.data.tx = h.x;
        m.data.ty = h.y;
        api.setMode(m, 'cast');
        return;
      }
      case 'bite': {
        const T = 0.6 / haste;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (m.t > T - 0.22) m.danger = 2.6;
        if (m.t >= T && !m.data.bit) {
          m.data.bit = 1;
          // Выпад пастью к метке.
          m.vx += Math.cos(m.dir) * 9;
          m.vy += Math.sin(m.dir) * 9;
          sim.events.push({ t: 'boss', what: 'whip' });
        }
        if (m.t >= T + 0.55) {
          m.data.bit = 0;
          m.cd = (1.4 + sim.rng() * 1.0) / haste;
          api.setMode(m, 'idle');
        }
        return;
      }
      case 'cast': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.2) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        if (!m.data.cast) {
          m.data.cast = 1;
          castElement(sim, api, m, el, haste);
        }
        const T = el === EL.bolt ? 0.75 : el === EL.fire ? 0.85 : 0.7;
        if (m.t >= T / haste + 0.35) {
          m.cd = (el === EL.light ? 2.4 : 2.8 + sim.rng() * 1.4) / haste;
          api.setMode(m, 'idle');
        }
        return;
      }
      case 'heal': {
        // Луч к раненой голове: полторы секунды, потом она цела.
        m.vx *= 0.7;
        m.vy *= 0.7;
        const tgt = sim.mobs.find((o) => o.id === m.data.target && o.mode !== 'dying');
        if (!tgt) {
          m.cd = 1.5;
          api.setMode(m, 'idle');
          return;
        }
        m.face = Math.atan2(tgt.y - m.y, tgt.x - m.x);
        m.tele = {
          shape: 'line',
          r: hypot(tgt.x - m.x, tgt.y - m.y),
          w: 0.18,
          ang: m.face,
          k: Math.min(1, m.t / 1.4),
        };
        if (m.t >= 1.4) {
          tgt.hp = Math.min(tgt.maxHp, tgt.hp + tgt.maxHp * 0.3);
          tgt.flash = 0.2;
          api.zone(sim, { x: tgt.x, y: tgt.y, r: 0.9, life: 0.6, art: 'f9_healed' });
          sayOnce(sim, 'heal', 20, {
            what: 'f9_heal',
            text: 'БЕЛАЯ ГОЛОВА ЛЕЧИТ',
            sub: 'руби её первой',
          });
          m.cd = 4 / haste;
          api.setMode(m, 'idle');
        }
        return;
      }
      default:
        api.setMode(m, 'idle');
    }
  },
});

/** Приём стихии: метка сразу, удар — по метке. */
function castElement(sim: Sim, api: SimApi, m: Mob, el: number, haste: number): void {
  const h = sim.hero;
  const ang = m.dir;
  if (el === EL.fire) {
    const warn = 0.85 / haste;
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: 4.2,
      ang,
      arc: 0.9,
      warn,
      dmg: m.dmg * 1.25,
      knock: 3,
      status: 'burn',
      dur: 1.6,
      art: 'f9_firecone',
      from: m.id,
    });
    const z: ZoneX = { x: m.x, y: m.y, r: 4.2, life: 0.5, warn, art: 'f9_flame', ang };
    api.zone(sim, z);
    embers(sim, api, m.x, m.y, ang, warn);
    sim.events.push({ t: 'shot', x: m.x, y: m.y, art: 'f9_fire' });
  } else if (el === EL.ice) {
    const tx = h.x + h.vx * 0.3;
    const ty = h.y + h.vy * 0.3;
    const T = Math.max(0.5, hypot(tx - m.x, ty - m.y) / 6.5);
    api.shoot(
      sim,
      m,
      Math.atan2(ty - m.y, tx - m.x),
      { speed: 6.5, r: 0.55, life: 2, dmg: 0.9, art: 'f9_iceball', status: 'chill', dur: 1.6, lob: true },
      tx,
      ty,
    );
    api.zone(sim, { x: tx, y: ty, r: 1.25, life: 5, warn: T, slow: 0.55, status: 'chill', dur: 1.2, art: 'f9_frost' });
  } else if (el === EL.venom) {
    for (let k = 0; k < 3; k++) {
      const a = ang + Math.PI / 2;
      const off = (k - 1) * 1.3;
      const tx = h.x + Math.cos(a) * off;
      const ty = h.y + Math.sin(a) * off;
      const T = Math.max(0.5, hypot(tx - m.x, ty - m.y) / 6);
      api.shoot(
        sim,
        m,
        Math.atan2(ty - m.y, tx - m.x),
        { speed: 6, r: 0.5, life: 2, dmg: 0.7, art: 'f9_venomglob', status: 'poison', dur: 2.2, lob: true },
        tx,
        ty,
      );
      venomPool(sim, api, tx, ty, T, 0.9);
    }
  } else if (el === EL.bolt) {
    api.strike(sim, {
      shape: 'line',
      x: m.x,
      y: m.y,
      r: 9,
      w: 0.42,
      ang,
      warn: 0.75 / haste,
      dmg: m.dmg * 1.3,
      knock: 4,
      status: 'stun',
      dur: 0.35,
      art: 'f9_bolt',
      from: m.id,
    });
  } else {
    // Белая — вспышка светом вокруг себя (когда лечить некого).
    api.strike(sim, {
      shape: 'circle',
      x: m.x,
      y: m.y,
      r: 2.2,
      warn: 0.7 / haste,
      dmg: m.dmg * 0.9,
      knock: 5,
      art: 'f9_glare',
      from: m.id,
    });
  }
}

registerBrain('f9_stump', {
  raw: true,
  step(sim, m, dt, c, api) {
    m.vx = 0;
    m.vy = 0;
    m.hp = m.maxHp;
    m.tele = null;
    m.danger = 0;
    if (m.data.px !== undefined) {
      m.x = m.data.px;
      m.y = m.data.py;
    }
    // Срез смотрит от тела: рисовальщик кладёт шею к телу.
    const body = bodyOf(sim);
    if (body) m.face = Math.atan2(body.y - m.y, body.x - m.x);
    if (m.mode === 'seared') {
      m.data.ghost = 1;
      return;
    }
    if (m.mode !== 'bleed') {
      api.setMode(m, 'bleed');
      return;
    }
    // Прижечь можно, пока есть огонь: иначе клинок обрубок не берёт.
    const can = fireFor(sim, m.x, m.y);
    m.data.ghost = can ? 0 : 1;
    m.data.can = can ? 1 : 0;
    const T = m.data.T ?? 8;
    const left = T - m.t;
    // Круг на полу сжимается — столько осталось до новых голов.
    m.tele = { shape: 'ring', r: 0.5 + 0.9 * Math.max(0, left / T), w: 0.1, k: Math.min(1, m.t / T) };
    if (left <= 0) regrow(sim, api, m);
    void dt;
    void c;
  },
  onHit(sim, m, _hit, api) {
    if (m.mode !== 'bleed' || !fireFor(sim, m.x, m.y)) return 0;
    sear(sim, api, m);
    return 0;
  },
});

/** Прижечь шею: голова не отрастёт, тело слабеет. */
function sear(sim: Sim, api: SimApi, m: Mob): void {
  const st = stateOf(sim);
  api.setMode(m, 'seared');
  m.data.ghost = 1;
  m.tele = null;
  woundBody(sim, SEAR);
  // Огонь в руке ушёл на шею.
  st.fire = 0;
  api.zone(sim, { x: m.x, y: m.y, r: 1, life: 0.8, art: 'f9_sear' });
  sim.events.push({
    t: 'boss',
    what: 'f9_sear',
    text: 'ШЕЯ ПРИЖЖЕНА',
    sub: 'эта голова не отрастёт',
  });
  sim.hitstop = Math.max(sim.hitstop, 0.09);
}

/** Обрубок не прижгли — две головы (одна, если голов под крышу). */
function regrow(sim: Sim, api: SimApi, m: Mob): void {
  const phase = sim.boss?.phase ?? 0;
  const el = m.data.el ?? 0;
  const slot = m.data.slot ?? 0;
  m.hp = 0;
  api.setMode(m, 'dying');
  const n = headsOf(sim).length;
  const room = HEAD_CAP[Math.min(3, phase)] - n;
  if (room <= 0) return;
  const pool = phase >= 1 ? [0, 1, 2, 3] : [0, 1, 2];
  const second = pool[Math.floor(sim.rng() * pool.length)];
  spawnHead(sim, api, el, slot, m.x, m.y);
  if (room >= 2) spawnHead(sim, api, second === el ? (el + 1) % pool.length : second, freeSlot(sim), m.x, m.y);
  woundBody(sim, -REGROW_HEAL);
  api.zone(sim, { x: m.x, y: m.y, r: 1.2, life: 0.7, art: 'f9_regrow' });
  sim.events.push({
    t: 'boss',
    what: 'f9_regrow',
    text: room >= 2 ? 'ОТРОСЛИ ДВЕ' : 'ОТРОСЛА',
    sub: 'шею надо прижечь огнём жаровни',
  });
}

// ---------------------------------------------------------------------------
// Скрытая голова: ныряет в ил, водоворот под героем, выныривает и кусает;
// потом залп всеми стихиями веером.
// ---------------------------------------------------------------------------

const WHIRL_T = 1.05;

registerBrain('f9_crown', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const body = bodyOf(sim);
    m.tele = null;
    m.danger = 0;
    if (heroDown(sim)) {
      m.vx *= 0.8;
      m.vy *= 0.8;
      return;
    }
    if (body) {
      const [ax, ay] = [body.x, body.y - 0.6];
      m.data.ax = ax;
      m.data.ay = ay;
    }
    switch (m.mode) {
      case 'rise':
        m.data.ghost = 1;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 1.4) {
          m.data.ghost = 0;
          api.setMode(m, 'up');
        }
        return;
      case 'up': {
        // Над илом: видна и открыта. Тянется к герою, кусает, дышит.
        m.data.ghost = 0;
        const ax = m.data.ax ?? m.x;
        const ay = m.data.ay ?? m.y;
        const a = Math.atan2(h.y - ay, h.x - ax);
        const d = Math.min(NECK + 1.5, Math.max(1.4, hypot(h.x - ax, h.y - ay) - 1.4));
        const tx = ax + Math.cos(a) * d;
        const ty = ay + Math.sin(a) * d;
        const l = hypot(tx - m.x, ty - m.y);
        if (l > 0.3) api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, m.speed, dt);
        m.face = Math.atan2(dy, dx);
        if (m.t < 0.6) return;
        if (dist < 2.4 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          const bx = m.x + Math.cos(m.dir) * 1.2;
          const by = m.y + Math.sin(m.dir) * 1.2;
          api.strike(sim, { shape: 'circle', x: bx, y: by, r: 1, warn: 0.62, dmg: m.dmg * 1.2, knock: 6, art: 'f9_bite', from: m.id });
          api.setMode(m, 'bite');
          return;
        }
        if (m.t > 3.2 && (m.data.prisms ?? 0) < 1) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'prism');
          return;
        }
        if (m.t > 3.8) api.setMode(m, 'dive');
        return;
      }
      case 'bite':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (m.t > 0.42) m.danger = 2.8;
        if (m.t >= 0.62 && !m.data.bit) {
          m.data.bit = 1;
          m.vx += Math.cos(m.dir) * 9;
          m.vy += Math.sin(m.dir) * 9;
          sim.events.push({ t: 'boss', what: 'whip' });
        }
        if (m.t > 1.2) {
          m.data.bit = 0;
          m.cd = 1.6;
          api.setMode(m, 'up');
          m.t = 1.5;
        }
        return;
      case 'prism': {
        // Залп веером: пять лучей стихий, между лучами — щели.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (!m.data.cast) {
          m.data.cast = 1;
          m.data.prisms = (m.data.prisms ?? 0) + 1;
          const kinds: [string, 'burn' | 'chill' | 'poison' | 'stun' | undefined][] = [
            ['f9_ray0', 'burn'],
            ['f9_ray1', 'chill'],
            ['f9_ray2', 'poison'],
            ['f9_ray3', 'stun'],
            ['f9_ray4', undefined],
          ];
          kinds.forEach(([art, status], k) => {
            api.strike(sim, {
              shape: 'line',
              x: m.x,
              y: m.y,
              r: 10,
              w: 0.4,
              ang: m.dir + (k - 2) * 0.42,
              warn: 0.95,
              dmg: m.dmg * 1.1,
              knock: 4,
              status,
              dur: status === 'stun' ? 0.3 : 1.4,
              art,
              from: m.id,
            });
          });
        }
        if (m.t > 1.5) {
          m.data.cast = 0;
          api.setMode(m, 'dive');
        }
        return;
      }
      case 'dive':
        // Уходит в ил: видно рябь, недосягаема.
        m.data.ghost = 1;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 0.55) {
          m.data.prisms = 0;
          api.setMode(m, 'hunt');
        }
        return;
      case 'hunt': {
        // Под илом ползёт к герою, потом водоворот под ногами.
        m.data.ghost = 1;
        const [cx, cy] = [h.x - m.x, h.y - m.y];
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * 1.4, dt);
        if (m.t > 1.1 || dist < 1.2) {
          m.data.wx = h.x;
          m.data.wy = h.y;
          api.strike(sim, { shape: 'circle', x: h.x, y: h.y, r: 1.35, warn: WHIRL_T, dmg: m.dmg * 1.35, knock: 7, art: 'f9_whirl', from: m.id });
          api.setMode(m, 'whirl');
        }
        return;
      }
      case 'whirl':
        // Водоворот: голова под ним, в конце — выныривает пастью вверх.
        m.data.ghost = 1;
        m.x += (m.data.wx - m.x) * Math.min(1, dt * 6);
        m.y += (m.data.wy - m.y) * Math.min(1, dt * 6);
        m.vx = 0;
        m.vy = 0;
        if (m.t > WHIRL_T - 0.25) m.danger = 2;
        if (m.t >= WHIRL_T) {
          m.data.ghost = 0;
          api.setMode(m, 'up');
          m.t = 0.3;
          m.cd = 1.4;
        }
        return;
      default:
        api.setMode(m, 'up');
    }
  },
});

// ---------------------------------------------------------------------------
// Арена и сценарий.
// ---------------------------------------------------------------------------

function arenaOf(sim: Sim, b: BossFight): ArenaState {
  const st = stateOf(sim);
  if (st.arena) return st.arena;
  const w = sim.world;
  const W = w.w;
  const pool: number[] = [];
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < w.mark.length; i++)
    if (w.mark[i] === F9_MARK.pool && sim.tiles[i] === T_DEEP) {
      pool.push(i);
      sx += i % W;
      sy += Math.floor(i / W);
    }
  const cx = pool.length ? sx / pool.length + 0.5 : b.obj.x + 0.5;
  const cy = pool.length ? sy / pool.length + 0.5 : b.obj.y - 4.5;
  // Берег озера: пол арены в полутора клетках от воды — его зальёт.
  const poolSet = new Set(pool);
  const shore: number[] = [];
  for (const i of b.cells) {
    if (!walkable(sim.tiles[i])) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++)
      for (let dx = -2; dx <= 2 && !near; dx++)
        if (poolSet.has((y + dy) * W + x + dx) && hypot(dx, dy) <= 2.1) near = true;
    if (near) shore.push(i);
  }
  const braziers = sim.props
    .filter((p) => p.obj.ref === 'f9_brazier' && b.cells.has(p.obj.y * W + p.obj.x))
    .sort((a, c) => a.y - c.y || a.x - c.x);
  st.arena = { cx, cy, pool, shore, braziers, changed: [], added: [], lights: [], out: new Set() };
  return st.arena;
}

/** Сменить клетку арены, запомнив, как было (сброс боя вернёт). */
function retile(sim: Sim, api: SimApi, A: ArenaState, i: number, tile: number, mark: number, haz: number): void {
  const W = sim.world.w;
  if (!A.changed.some((c) => c.i === i))
    A.changed.push({ i, tile: sim.tiles[i], mark: sim.world.mark[i], haz: sim.world.haz[i] });
  sim.world.haz[i] = haz;
  api.setTile(sim, i % W, Math.floor(i / W), tile, mark);
}

/** Фаза 1: озеро разливается — берег становится трясиной. */
function floodShore(sim: Sim, api: SimApi, A: ArenaState): void {
  const st = stateOf(sim);
  const h = sim.hero;
  for (const i of A.shore) {
    const W = sim.world.w;
    // Под героем клетку не трогаем — пол уйдёт из-под ног следующей.
    if (hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y) < 0.6) continue;
    retile(sim, api, A, i, T_HAZARD, F9_MARK.flood, st.bogHaz);
  }
}

/** Фаза 2: две жаровни падают в воду и гаснут. */
function toppleBraziers(sim: Sim, A: ArenaState): void {
  const st = stateOf(sim);
  const pick = A.braziers.filter((_, k) => k === 1 || k === 2);
  for (const p of pick) {
    A.out.add(p.id);
    p.obj = { ...p.obj, ref: 'f9_brazier_out' };
    p.flash = 0.3;
    F9_VIEW.braziers.set(p.obj.id, false);
    sim.events.push({ t: 'break', x: p.x, y: p.y, kind: 'crate' });
    sim.events.push({ t: 'boom', x: p.x, y: p.y, r: 0 });
    // Свет жаровни гаснет.
    sim.world.lights = sim.world.lights.filter(
      (l) => !(Math.abs(l.x - p.x) < 0.2 && Math.abs(l.y - p.y) < 0.2),
    );
  }
  void st;
}

/** Фаза 3: озеро уходит в ил — к телу можно подойти. */
function drainPool(sim: Sim, api: SimApi, A: ArenaState, b: BossFight): void {
  for (const i of A.pool) {
    retile(sim, api, A, i, T_FLOOR, F9_MARK.mud, 0);
    if (!b.cells.has(i)) {
      b.cells.add(i);
      A.added.push(i);
    }
  }
  // Из ила светится скрытая голова.
  const glow: Light = { x: A.cx, y: A.cy, r: 5.5, tint: 'violet' };
  A.lights.push(glow);
  sim.world.lights = [...sim.world.lights, glow];
}

/** Вернуть клетку, как `api.setTile` (сброс боя зовётся без `api`). */
function putTile(sim: Sim, i: number, tile: number, mark: number): void {
  sim.tiles[i] = tile;
  sim.world.mark[i] = mark;
  sim.retiled.push(i);
}

function restoreArena(sim: Sim, b: BossFight): void {
  const st = stateOf(sim);
  const A = st.arena;
  if (!A) return;
  for (const c of A.changed) {
    sim.world.haz[c.i] = c.haz;
    putTile(sim, c.i, c.tile, c.mark);
  }
  A.changed = [];
  for (const i of A.added) b.cells.delete(i);
  A.added = [];
  for (const p of A.braziers) {
    p.obj = { ...p.obj, ref: 'f9_brazier' };
    p.alive = true;
    F9_VIEW.braziers.set(p.obj.id, true);
  }
  A.out.clear();
  A.lights = [];
  sim.world.lights = st.baseLights.slice();
}

/** Засечки и полоса: тело до скрытой головы, потом — скрытая голова. */
function hydraBar(sim: Sim, b: BossFight): number {
  const body = sim.mobs.find((m) => m.kind === 'f9boss');
  if (!body) return 0;
  if (b.phase >= 3) {
    const cr = sim.mobs.find((m) => m.kind === 'f9_crown');
    const k = cr ? Math.max(0, cr.hp) / cr.maxHp : 0;
    return HYDRA_NOTCH[2] * k;
  }
  return Math.max(0, body.hp) / body.maxHp;
}

registerBoss('f9boss', {
  start(sim, b, lead) {
    b.phase = 0;
    b.data.init = 0;
    lead.data.ghost = 1;
    // Прошлый бой этой вылазки мог осушить озеро — арена как до боя.
    restoreArena(sim, b);
    const A = arenaOf(sim, b);
    lead.data.px = A.cx;
    lead.data.py = A.cy - 0.3;
    lead.x = A.cx;
    lead.y = A.cy - 0.3;
    F9_VIEW.phase = 0;
  },
  step(sim, b, dt, api) {
    const st = stateOf(sim);
    const A = arenaOf(sim, b);
    const body = bodyOf(sim);
    if (!body) return;
    if (!b.data.init) {
      b.data.init = 1;
      b.data.geyser = 0;
      for (const e of sim.events)
        if (e.t === 'boss' && e.what === 'wake') {
          e.text = 'МНОГОГЛАВАЯ ГИДРА';
          e.sub = 'руби головы — и прижигай шеи огнём жаровен';
        }
      for (const p of A.braziers) F9_VIEW.braziers.set(p.obj.id, true);
      [EL.fire, EL.ice, EL.venom].forEach((el, k) => spawnHead(sim, api, el, k));
      // Вода озера кипит вокруг тела — картинка, без действия.
      api.zone(sim, { x: A.cx, y: A.cy, r: 12, life: 1e9, art: 'f9_necks' });
    }
    const bar = hydraBar(sim, b);
    // Фазы по полосе.
    if (b.phase === 0 && bar <= HYDRA_NOTCH[0]) {
      b.phase = 1;
      floodShore(sim, api, A);
      spawnHead(sim, api, EL.bolt, freeSlot(sim));
      spawnHead(sim, api, EL.light, freeSlot(sim));
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ГРОЗА И СВЕТ',
        sub: 'озеро разлилось; белая голова лечит — руби её первой',
      });
    } else if (b.phase === 1 && bar <= HYDRA_NOTCH[1]) {
      b.phase = 2;
      toppleBraziers(sim, A);
      b.data.geyser = sim.time + 2;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ЯДОВИТЫЙ ТУМАН',
        sub: 'две жаровни погасли — огонь только у двух',
      });
    } else if (b.phase === 2 && bar <= HYDRA_NOTCH[2]) {
      b.phase = 3;
      // Головы уходят в воду, обрубки — тоже; озеро уходит в ил.
      for (const m of sim.mobs)
        if (m.kind === 'f9_head' || m.kind === 'f9_stump') {
          api.zone(sim, { x: m.x, y: m.y, r: 1, life: 0.6, art: 'f9_splash' });
          m.hp = 0;
          m.mode = 'dying';
          m.t = 0.35;
        }
      drainPool(sim, api, A, b);
      body.data.risen = 1;
      const cr = api.spawnMob(sim, 'f9_crown', A.cx, A.cy + 1.4, { mode: 'rise', level: body.level });
      cr.data.ghost = 1;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'СКРЫТАЯ ГОЛОВА',
        sub: 'озеро ушло; тело не взять, пока она жива',
      });
    }
    F9_VIEW.phase = b.phase;
    // Ядовитые гейзеры в фазе 2.
    if (b.phase === 2 && sim.time >= b.data.geyser) {
      b.data.geyser = sim.time + 3.4;
      const cells = [...b.cells].filter((i) => walkable(sim.tiles[i]));
      const W = sim.world.w;
      for (let k = 0; k < 3; k++) {
        const i = cells[Math.floor(sim.rng() * cells.length)];
        const x = (i % W) + 0.5;
        const y = Math.floor(i / W) + 0.5;
        api.strike(sim, { shape: 'circle', x, y, r: 1.1, warn: 1.1, dmg: body.dmg * 0.8, knock: 3, status: 'poison', dur: 2, art: 'f9_geyser' });
        venomPool(sim, api, x, y, 1.1, 1);
      }
    }
    // Хвост из воды: широкий взмах в сторону героя (фазы 0–2).
    if (b.phase < 3 && !heroDown(sim)) {
      b.data.tail = (b.data.tail ?? 6) - dt;
      if (b.data.tail <= 0) {
        b.data.tail = TAIL_CD[b.phase] + sim.rng() * 2;
        const h = sim.hero;
        const ang = Math.atan2(h.y - body.y, h.x - body.x);
        api.strike(sim, {
          shape: 'cone',
          x: body.x,
          y: body.y,
          r: 8.5,
          ang,
          arc: 1.25,
          warn: 1.15,
          dmg: body.dmg * 1.4,
          knock: 8,
          art: 'f9_tail',
          from: body.id,
        });
        body.data.lash = sim.time;
        sim.events.push({ t: 'boss', what: 'roll' });
      }
    }
    // Голов мало — гидра отращивает новую прямо из тела.
    if (b.phase < 3) {
      const have = headsOf(sim).length + stumpsOf(sim).filter((m) => m.mode === 'bleed').length;
      if (have < HEAD_MIN[b.phase]) {
        b.data.sprout = (b.data.sprout ?? SPROUT_T) - dt;
        if (b.data.sprout <= 0) {
          b.data.sprout = SPROUT_T;
          const pool = b.phase >= 1 ? [0, 1, 2, 3, 4] : [0, 1, 2];
          const m = spawnHead(sim, api, pool[Math.floor(sim.rng() * pool.length)], freeSlot(sim));
          if (m) api.zone(sim, { x: m.x, y: m.y, r: 1.2, life: 0.7, art: 'f9_regrow' });
          sayOnce(sim, 'sprout', 30, {
            what: 'f9_sprout',
            text: 'НОВАЯ ГОЛОВА',
            sub: 'гидра растит их из тела — руби и прижигай',
          });
        }
      } else b.data.sprout = SPROUT_T;
    }
    // Обрубки: срок отрастания по фазе.
    for (const s of stumpsOf(sim)) if (s.data.T === undefined) s.data.T = REGROW_T[Math.min(2, b.phase)];
    // Огонь жаровен: подошёл — огонь в руке.
    stepFire(sim, st, A, api);
    // Шеи для рисовальщика. Шея выходит из тела В СТОРОНУ своей головы:
    // с постоянными гнёздами шеи, чьи головы разошлись, перекрещивались
    // и путались в клубок.
    const necks: NeckView[] = [];
    const rootOf = (hx: number, hy: number): [number, number] => {
      const a = Math.atan2(hy - body.y, hx - body.x);
      return [body.x + Math.cos(a) * 1.15, body.y + Math.sin(a) * 0.75];
    };
    for (const m of sim.mobs) {
      if (m.kind === 'f9_head' || m.kind === 'f9_crown') {
        if (m.mode === 'dying') continue;
        const sub = m.kind === 'f9_crown' && (m.data.ghost ?? 0) > 0;
        if (sub) continue;
        const [ax, ay] = rootOf(m.x, m.y);
        necks.push({ ax, ay, hx: m.x, hy: m.y, el: m.kind === 'f9_crown' ? 5 : (m.data.el ?? 0), id: m.id, cut: 0, big: m.kind === 'f9_crown' ? 1 : 0 });
      } else if (m.kind === 'f9_stump' && m.mode !== 'dying') {
        const [ax, ay] = rootOf(m.x, m.y);
        necks.push({ ax, ay, hx: m.x, hy: m.y, el: m.data.el ?? 0, id: 0, cut: m.mode === 'seared' ? 2 : 1, big: 0 });
      }
    }
    F9_VIEW.necks = necks;
    void dt;
  },
  onPartDown(sim, b, m, api) {
    if (m.kind === 'f9_head') {
      // Голова пала: обрубок на земле (на полу, куда дотянется клинок).
      woundBody(sim, SEVER);
      const f = floorNear(sim, api, m.x, m.y, 3) ?? [m.x, m.y];
      const s = api.spawnMob(sim, 'f9_stump', f[0], f[1], { mode: 'bleed', level: m.level });
      s.data.el = m.data.el ?? 0;
      s.data.slot = m.data.slot ?? 0;
      s.data.px = f[0];
      s.data.py = f[1];
      s.data.T = REGROW_T[Math.min(2, b.phase)];
      s.data.ghost = 1;
      sayOnce(sim, 'stump', 999, {
        what: 'f9_stump',
        text: 'ОБРУБОК',
        sub: 'не прижжёшь огнём — отрастут две',
      });
      return true;
    }
    if (m.kind === 'f9_crown') {
      // Скрытая голова пала — гидра мертва: тело оседает в ил.
      for (const o of sim.mobs)
        if (o !== m && (o.kind === 'f9boss' || o.kind === 'f9_head' || o.kind === 'f9_stump')) {
          o.hp = 0;
          o.mode = 'dying';
          o.t = 0;
        }
      F9_VIEW.necks = [];
      F9_VIEW.phase = -1;
      stateOf(sim).fire = 0;
      return false;
    }
    return false;
  },
  bar(sim, b) {
    return hydraBar(sim, b);
  },
  notches() {
    return HYDRA_NOTCH;
  },
  reset(sim, b) {
    const st = stateOf(sim);
    // Обрубки не часть босса — движок их не уберёт.
    sim.mobs = sim.mobs.filter((m) => m.kind !== 'f9_stump');
    restoreArena(sim, b);
    st.fire = 0;
    killZone(sim, st.fireZone);
    st.fireZone = 0;
    if (st.fireLight) {
      sim.world.lights = sim.world.lights.filter((l) => l !== st.fireLight);
      st.fireLight = null;
    }
    F9_VIEW.necks = [];
    F9_VIEW.phase = -1;
    F9_VIEW.fire = 0;
  },
});

function stepFire(sim: Sim, st: F9State, A: ArenaState, api: SimApi): void {
  const h = sim.hero;
  if (!heroDown(sim))
    for (const p of A.braziers) {
      if (A.out.has(p.id) || !p.alive) continue;
      if (hypot(p.x - h.x, p.y - h.y) > p.r + h.r + 0.45) continue;
      const fresh = st.fire <= sim.time;
      st.fire = sim.time + FIRE_T;
      if (fresh) {
        sim.events.push({ t: 'boss', what: 'f9_fire' });
        sayOnce(sim, 'fire', 45, {
          what: 'f9_fire',
          text: 'ОГОНЬ В РУКЕ',
          sub: 'ударь обрубок шеи, пока горит',
        });
      }
    }
  const on = st.fire > sim.time;
  F9_VIEW.fire = on ? (st.fire - sim.time) / FIRE_T : 0;
  const z = zoneById(sim, st.fireZone);
  if (on) {
    if (!z) st.fireZone = zoneId(sim, api, { x: h.x, y: h.y, r: 0.7, life: 1e9, art: 'f9_handfire' });
    else {
      z.x = h.x;
      z.y = h.y;
      z.life = 1e9;
    }
    // Огонь светит: свой свет на герое.
    if (!st.fireLight) {
      st.fireLight = { x: h.x, y: h.y - 0.4, r: 3.4, tint: 'warm' };
      sim.world.lights = [...sim.world.lights, st.fireLight];
    }
    st.fireLight.x = h.x;
    st.fireLight.y = h.y - 0.4;
  } else {
    if (z) killZone(sim, st.fireZone);
    st.fireZone = 0;
    if (st.fireLight) {
      sim.world.lights = sim.world.lights.filter((l) => l !== st.fireLight);
      st.fireLight = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

registerFloor(9, {
  start(sim) {
    // Своё у вылазки: свет и опасность клеток меняются по ходу боя и
    // событий — мир страницы общий, его не трогаем.
    sim.world.lights = sim.world.lights.slice();
    sim.world.haz = sim.world.haz.slice();
    const st = scan(sim);
    st.baseLights = sim.world.lights.slice();
    st.baseHaz = sim.world.haz;
    STATE.set(sim, st);
    F9_VIEW.phase = -1;
    F9_VIEW.necks = [];
    F9_VIEW.fire = 0;
    F9_VIEW.chapel = 0;
    updateRingView(sim, st);
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    stepHall(sim, st, api);
    stepAmbush(sim, st, api);
    stepRings(sim, st, dt, api);
    stepChapel(sim, st, dt, api);
    stepTide(sim, st, dt, api);
    stepSwamp(sim, st, dt, api);
    updateRingView(sim, st);
    if (sim.boss?.state !== 'fight' && F9_VIEW.phase !== -1) {
      F9_VIEW.phase = -1;
      F9_VIEW.necks = [];
    }
  },
});
