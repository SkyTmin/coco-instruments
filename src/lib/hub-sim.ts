// Площадь каторги (v2.80) — мир, по которому ходит герой: карта из
// `hub-maps.ts`, тело героя, двери, жители, путь по тапу. Чистый модуль без
// DOM: его гоняют тесты, а страница только подаёт джойстик и тапы и
// отвечает на события (дверь, разговор, кнопка).
//
// Ходьба — те же формулы, что в подземелье (`lib/walk.ts`): герой один и тот
// же, и скользить вдоль стены он обязан одинаково. Отличие одно: сетка
// столкновений площади — в ПОЛОВИНКИ плитки (её рисует `scripts/hub`), поэтому
// `cell` = 0,5, а координаты по-прежнему в плитках.

import { HUB_MAPS, HUB_SPRITES } from './hub-maps';
import type { HubDoorData, HubMapData, HubNpcData } from './hub-maps';
import { collideGrid, moveBody, overlapsGrid, steerVelocity, STRIDE } from './walk';
import type { Grid } from './walk';

/** Радиус тела героя, плитки: в проход шириной в плитку проходит с запасом. */
export const HERO_R = 0.3;
/** Скорость шага, плиток в секунду. */
export const HERO_SPEED = 5;
/**
 * С какого расстояния до жителя можно заговорить (от его ног). Житель стоит
 * за своей вещью — наковальней, прилавком, столом, — и игрок встаёт по ту
 * сторону: крупье за столом в полторы плитки глубиной — это 2,4 плитки от
 * ног до ног, продавщица ларька за прилавком с витриной — 2,55. Меньше — к ним
 * пришлось бы обходить за прилавок (тест «до каждого жителя дойти» это ловит).
 */
export const TALK_R = 2.8;
/** Ближе — житель поворачивается к герою. */
export const TURN_R = 3;
/** Насколько решительно надо идти В дверь, чтобы она сработала (плиток/с). */
const DOOR_PUSH = 0.8;
/** Запас зоны двери со стороны подхода сверх радиуса героя. */
const DOOR_PAD = 0.12;

/** Сторона взгляда — столбец листа Ninja Adventure. */
export type Face = 0 | 1 | 2 | 3;
export const FACE_DOWN: Face = 0;
export const FACE_UP: Face = 1;
export const FACE_LEFT: Face = 2;
export const FACE_RIGHT: Face = 3;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface HubDoor extends HubDoorData {
  i: number;
  /** Куда идти, чтобы войти: единичный вектор с подхода внутрь двери. */
  nx: number;
  ny: number;
  /** Где должен оказаться центр героя, чтобы дверь сработала. */
  zone: Rect;
  /** Точка перед дверью, откуда входят (и куда ставят вернувшегося). */
  ax: number;
  ay: number;
  /** Дверь игры (`@prison`, `@dungeon`…), а не переход на другую карту. */
  action: boolean;
  /** Куда можно ткнуть пальцем, чтобы пойти в дверь: сама дверь и её фасад. */
  tap: Rect;
}

export interface HubMap {
  id: string;
  data: HubMapData;
  /** Размер в плитках. */
  w: number;
  h: number;
  /** Сетка половинок: 1 — занято. */
  solid: Uint8Array;
  grid: Grid;
  doors: HubDoor[];
}

export interface HubNpc {
  id: string;
  data: HubNpcData;
  x: number;
  y: number;
  face: Face;
  /** Бьёт молотом (anim 'work'), пока не отвлёкся на героя. */
  working: boolean;
  /** Путь ног — для шага у тех, кто ходит (anim 'pace'). */
  walk: number;
  moving: boolean;
  paceDir: number;
  paceWait: number;
}

export interface HubHero {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  face: Face;
  walk: number;
  moving: boolean;
}

export type HubTarget =
  | { kind: 'point'; x: number; y: number }
  | { kind: 'door'; i: number }
  | { kind: 'npc'; id: string };

export type HubEvent =
  | { t: 'door'; door: HubDoor }
  | { t: 'use'; door: HubDoor }
  | { t: 'talk'; npc: string }
  | { t: 'step' };

export interface HubInput {
  mx: number;
  my: number;
}

export const HUB_NO_INPUT: HubInput = { mx: 0, my: 0 };

interface Path {
  pts: { x: number; y: number }[];
  i: number;
  target: HubTarget;
  /** Сколько секунд герой почти не сдвинулся — упёрся. */
  stuck: number;
  /** Дожим в дверь после подхода, секунды. */
  push: number;
}

export interface HubSim {
  map: HubMap;
  hero: HubHero;
  npcs: HubNpc[];
  path: Path | null;
  /** Двери, из зоны которых герой ещё не выходил, не срабатывают. */
  armed: boolean[];
  events: HubEvent[];
  time: number;
  /** С кем сейчас разговор: житель стоит к герою лицом и не работает. */
  talking: string | null;
  lastStep: number;
}

// ---------------------------------------------------------------------------
// Карта.
// ---------------------------------------------------------------------------

function b64bytes(s: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, 'base64'));
}

/** Сетка половинок из строки выгрузки: бит на клетку, по строкам, старший бит первым. */
export function decodeSolid(b64: string, cw: number, ch: number): Uint8Array {
  const bytes = b64bytes(b64);
  const out = new Uint8Array(cw * ch);
  for (let i = 0; i < out.length; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

const maps = new Map<string, HubMap>();

export function hubMapIds(): string[] {
  return Object.keys(HUB_MAPS);
}

export function loadMap(id: string): HubMap {
  const hit = maps.get(id);
  if (hit) return hit;
  const data = HUB_MAPS[id];
  if (!data) throw new Error(`hub: no map ${id}`);
  const cw = data.w * 2;
  const ch = data.h * 2;
  const solid = decodeSolid(data.solid, cw, ch);
  const grid: Grid = {
    w: cw,
    h: ch,
    cell: 0.5,
    solid: (x, y) => x < 0 || y < 0 || x >= cw || y >= ch || solid[y * cw + x] === 1,
  };
  const m: HubMap = { id, data, w: data.w, h: data.h, solid, grid, doors: [] };
  m.doors = data.doors.map((d, i) => doorInfo(m, d, i));
  maps.set(id, m);
  return m;
}

/** Свободна ли половинка, где лежит точка. */
function freeAt(m: HubMap, x: number, y: number): boolean {
  return !m.grid.solid(Math.floor(x * 2), Math.floor(y * 2));
}

/**
 * Дверь: с какой стороны к ней подходят и где её зона. Прямоугольник двери
 * бывает и в проёме (настоящий фасад: проём свободен), и в стене (заглушка:
 * проём закрыт), поэтому зона — прямоугольник, раздутый на радиус героя со
 * стороны подхода: и в проёме, и упёршись в стену герой в неё попадает.
 */
function doorInfo(m: HubMap, d: HubDoorData, i: number): HubDoor {
  const horiz = d.w >= d.h;
  let nx = 0;
  let ny = 0;
  const count = (xs: number[], ys: number[]) => {
    let n = 0;
    for (const x of xs) for (const y of ys) if (freeAt(m, x, y)) n++;
    return n;
  };
  const along = (a: number, len: number) => {
    const out: number[] = [];
    for (let t = a + 0.25; t < a + len; t += 0.5) out.push(t);
    if (!out.length) out.push(a + len / 2);
    return out;
  };
  if (horiz) {
    const xs = along(d.x, d.w);
    const above = count(xs, [d.y - 0.25, d.y - 0.75]);
    const below = count(xs, [d.y + d.h + 0.25, d.y + d.h + 0.75]);
    ny = above >= below ? 1 : -1;
  } else {
    const ys = along(d.y, d.h);
    const left = count([d.x - 0.25, d.x - 0.75], ys);
    const right = count([d.x + d.w + 0.25, d.x + d.w + 0.75], ys);
    nx = left >= right ? 1 : -1;
  }
  const reach = HERO_R + DOOR_PAD;
  const zone: Rect = {
    x0: d.x - DOOR_PAD - (nx > 0 ? reach : 0),
    x1: d.x + d.w + DOOR_PAD + (nx < 0 ? reach : 0),
    y0: d.y - DOOR_PAD - (ny > 0 ? reach : 0),
    y1: d.y + d.h + DOOR_PAD + (ny < 0 ? reach : 0),
  };
  // Точка подхода: середина кромки со стороны подхода, на шаг наружу.
  const cx = d.x + d.w / 2;
  const cy = d.y + d.h / 2;
  // Снаружи зоны: вернувшийся из шахты встаёт сюда, и дверь должна быть
  // взведена — шагнул обратно, и она сработала.
  const out = HERO_R + DOOR_PAD + 0.4;
  let ax = nx > 0 ? d.x - out : nx < 0 ? d.x + d.w + out : cx;
  let ay = ny > 0 ? d.y - out : ny < 0 ? d.y + d.h + out : cy;
  const v = nearestStand(m, ax, ay, 2.5, (x, y) => !inRect(zone, x, y));
  if (v) {
    ax = v.x;
    ay = v.y;
  }
  return { ...d, i, nx, ny, zone, ax, ay, action: d.to.startsWith('@'), tap: tapArea(m, d, ny) };
}

/**
 * Тап по зданию ведёт в его дверь. Фасад — это спрайт, который стоит
 * основанием на нижней кромке двери и закрывает её по ширине; такой ищется
 * среди предметов карты. Нет фасада (дверь-коврик в интерьере) — дверь с
 * запасом в полплитки.
 */
function tapArea(m: HubMap, d: HubDoorData, ny: number): Rect {
  const r: Rect = { x0: d.x - 0.5, y0: d.y - 0.5, x1: d.x + d.w + 0.5, y1: d.y + d.h + 0.5 };
  if (d.kind !== 'enter' || ny >= 0) return r;
  const cx = (d.x + d.w / 2) * 16;
  const bottom = (d.y + d.h) * 16;
  for (const o of m.data.objs) {
    const sp = HUB_SPRITES[o[0]];
    if (!sp || o[4]) continue;
    if (cx < o[1] || cx > o[1] + sp[2] || Math.abs(o[3] - bottom) > 20) continue;
    r.x0 = Math.min(r.x0, o[1] / 16);
    r.x1 = Math.max(r.x1, (o[1] + sp[2]) / 16);
    r.y0 = Math.min(r.y0, o[2] / 16);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Где можно стоять: узлы пути — углы половинок.
// ---------------------------------------------------------------------------

/**
 * Узлы пути — УГЛЫ половинок, а не их центры. Центр половинки в проходе
 * шириной в плитку от стены в 0,25 — тело радиусом 0,3 туда не встанет, и
 * путь не нашёлся бы вовсе. Угол, вокруг которого свободны все четыре
 * половинки, держит тело с запасом 0,2 во все стороны.
 */
export function standVertex(m: HubMap, i: number, j: number): boolean {
  const g = m.grid;
  return !g.solid(i - 1, j - 1) && !g.solid(i, j - 1) && !g.solid(i - 1, j) && !g.solid(i, j);
}

/** Может ли тело героя стоять в точке (не задевая стен). */
export function canStand(m: HubMap, x: number, y: number, r = HERO_R): boolean {
  return !overlapsGrid(m.grid, x, y, r - 1e-6);
}

/** Ближайший к точке угол, где можно стоять, в радиусе `maxR` плиток. */
export function nearestStand(
  m: HubMap,
  x: number,
  y: number,
  maxR = 2,
  ok?: (x: number, y: number) => boolean,
): { x: number; y: number; i: number; j: number } | null {
  const ci = Math.round(x * 2);
  const cj = Math.round(y * 2);
  const R = Math.ceil(maxR * 2);
  let best: { x: number; y: number; i: number; j: number } | null = null;
  let bd = Infinity;
  for (let j = cj - R; j <= cj + R; j++)
    for (let i = ci - R; i <= ci + R; i++) {
      if (i < 1 || j < 1 || i >= m.w * 2 || j >= m.h * 2) continue;
      if (!standVertex(m, i, j) || (ok && !ok(i / 2, j / 2))) continue;
      const d = Math.hypot(i / 2 - x, j / 2 - y);
      if (d < bd && d <= maxR) {
        bd = d;
        best = { x: i / 2, y: j / 2, i, j };
      }
    }
  return best;
}

// ---------------------------------------------------------------------------
// A* по углам половинок.
// ---------------------------------------------------------------------------

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const a = i * 2 + 1;
        const b = a + 1;
        let s = i;
        if (a < k.length && k[a] < k[s]) s = a;
        if (b < k.length && k[b] < k[s]) s = b;
        if (s === i) break;
        [k[s], k[i]] = [k[i], k[s]];
        [v[s], v[i]] = [v[i], v[s]];
        i = s;
      }
    }
    return top;
  }
}

export interface Goal {
  i: number;
  j: number;
  /** Надбавка к цене этой цели (плитки): «встань перед ним, а не сбоку». */
  extra: number;
}

/**
 * Путь от точки до ближайшей из целей (по цене пути плюс надбавке цели).
 * null — не дойти. Путь — в плитках, от первого угла до цели.
 */
export function findPath(
  m: HubMap,
  fx: number,
  fy: number,
  goals: Goal[],
): { x: number; y: number }[] | null {
  if (!goals.length) return null;
  const start = nearestStand(m, fx, fy, 1.5);
  if (!start) return null;
  const W = m.w * 2 + 1;
  const H = m.h * 2 + 1;
  const goalExtra = new Map<number, number>();
  let cx = 0;
  let cy = 0;
  for (const g of goals) {
    const k = g.j * W + g.i;
    goalExtra.set(k, Math.min(goalExtra.get(k) ?? Infinity, g.extra * 2));
    cx += g.i;
    cy += g.j;
  }
  cx /= goals.length;
  cy /= goals.length;
  let spread = 0;
  for (const g of goals) spread = Math.max(spread, Math.hypot(g.i - cx, g.j - cy));
  // Эвристика — октильное расстояние до середины целей минус их разброс:
  // допустима (не переоценивает) для любой из целей.
  const heur = (i: number, j: number) => {
    const dx = Math.abs(i - cx);
    const dy = Math.abs(j - cy);
    return Math.max(0, Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy) - spread * 1.09);
  };
  const g = new Float64Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const s = start.j * W + start.i;
  g[s] = 0;
  const open = new Heap();
  open.push(heur(start.i, start.j), s);
  let best = -1;
  let bestCost = Infinity;
  const DIRS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, Math.SQRT2],
    [1, -1, Math.SQRT2],
    [-1, 1, Math.SQRT2],
    [-1, -1, Math.SQRT2],
  ];
  while (open.size) {
    const [f, k] = open.pop();
    if (f >= bestCost) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const extra = goalExtra.get(k);
    if (extra !== undefined && g[k] + extra < bestCost) {
      bestCost = g[k] + extra;
      best = k;
    }
    const i = k % W;
    const j = (k - i) / W;
    for (const [di, dj, c] of DIRS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 1 || nj < 1 || ni >= W - 1 || nj >= H - 1) continue;
      if (!standVertex(m, ni, nj)) continue;
      // По диагонали — только если свободны оба прямых соседа: иначе тело
      // срезало бы угол стены.
      if (di && dj && (!standVertex(m, i + di, j) || !standVertex(m, i, j + dj))) continue;
      const nk = nj * W + ni;
      const ng = g[k] + c;
      if (ng >= g[nk]) continue;
      g[nk] = ng;
      from[nk] = k;
      open.push(ng + heur(ni, nj), nk);
    }
  }
  if (best < 0) return null;
  const out: { x: number; y: number }[] = [];
  for (let k = best; k >= 0; k = from[k]) {
    const i = k % W;
    out.push({ x: i / 2, y: (k - i) / W / 2 });
    if (k === s) break;
  }
  out.reverse();
  return out;
}

/** Проходит ли тело по прямой (проверка точками через 0,1 плитки). */
export function clearLine(m: HubMap, ax: number, ay: number, bx: number, by: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (overlapsGrid(m.grid, ax + (bx - ax) * t, ay + (by - ay) * t, HERO_R - 0.02)) return false;
  }
  return true;
}

/** Натянуть нить: выкинуть углы, мимо которых можно пройти по прямой. */
function smooth(m: HubMap, x: number, y: number, pts: { x: number; y: number }[]) {
  const out: { x: number; y: number }[] = [];
  let ax = x;
  let ay = y;
  let i = 0;
  while (i < pts.length) {
    let k = pts.length - 1;
    while (k > i && !clearLine(m, ax, ay, pts[k].x, pts[k].y)) k--;
    out.push(pts[k]);
    ax = pts[k].x;
    ay = pts[k].y;
    i = k + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Цели пути.
// ---------------------------------------------------------------------------

const FACE_VEC: Record<Face, [number, number]> = {
  0: [0, 1],
  1: [0, -1],
  2: [-1, 0],
  3: [1, 0],
};

/** Куда встать, чтобы заговорить: перед жителем, а не сбоку и не за спиной. */
export function talkGoals(m: HubMap, n: HubNpcData): Goal[] {
  const out: Goal[] = [];
  const R = Math.ceil(TALK_R * 2);
  const ci = Math.round(n.x * 2);
  const cj = Math.round(n.y * 2);
  const [fx, fy] = FACE_VEC[(n.face & 3) as Face];
  for (let j = cj - R; j <= cj + R; j++)
    for (let i = ci - R; i <= ci + R; i++) {
      if (i < 1 || j < 1 || i >= m.w * 2 || j >= m.h * 2) continue;
      const x = i / 2;
      const y = j / 2;
      const d = Math.hypot(x - n.x, y - n.y);
      if (d > TALK_R - 0.1 || d < 0.5) continue;
      if (!standVertex(m, i, j)) continue;
      const dot = ((x - n.x) * fx + (y - n.y) * fy) / d;
      // Надбавки: сбоку и за спиной — дороже, чем перед ним; и чем дальше от
      // него, тем дороже — иначе герой вставал бы за полплитки от прилавка,
      // потому что туда от двери на шаг ближе.
      out.push({ i, j, extra: (1 - dot) * 1.5 + Math.max(0, d - 1.2) * 1.5 });
    }
  return out;
}

export function doorGoals(m: HubMap, d: HubDoor): Goal[] {
  const v = nearestStand(m, d.ax, d.ay, 1);
  return v ? [{ i: v.i, j: v.j, extra: 0 }] : [];
}

// ---------------------------------------------------------------------------
// Симуляция.
// ---------------------------------------------------------------------------

function inRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Сторона на четыре с запасом: по диагонали герой не мигает бок/спина. */
function face4(prev: Face, dx: number, dy: number): Face {
  const side = Math.abs(dx) > Math.abs(dy);
  const prevSide = prev === FACE_LEFT || prev === FACE_RIGHT;
  const keepAxis =
    side === prevSide || Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.18 * Math.hypot(dx, dy);
  const useSide = keepAxis ? prevSide : side;
  return useSide ? (dx < 0 ? FACE_LEFT : FACE_RIGHT) : dy < 0 ? FACE_UP : FACE_DOWN;
}

/** Сторона на четыре без запаса — для жителей и разворота к собеседнику. */
export function faceTo(dx: number, dy: number): Face {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? FACE_LEFT : FACE_RIGHT;
  return dy < 0 ? FACE_UP : FACE_DOWN;
}

export interface HubPlace {
  map: string;
  x: number;
  y: number;
  face: number;
}

/** Где встать на карте: точка появления по имени, иначе первая, иначе середина. */
export function spawnOf(m: HubMap, at: string): HubPlace {
  const s = m.data.spawns[at] ?? Object.values(m.data.spawns)[0];
  if (s) return { map: m.id, x: s[0], y: s[1], face: s[2] };
  const v = nearestStand(m, m.w / 2, m.h / 2, Math.max(m.w, m.h)) ?? { x: m.w / 2, y: m.h / 2 };
  return { map: m.id, x: v.x, y: v.y, face: 0 };
}

export function createHubSim(place: HubPlace | { map: string; at: string }): HubSim {
  const m = loadMap(place.map);
  const sim: HubSim = {
    map: m,
    hero: { x: 0, y: 0, r: HERO_R, vx: 0, vy: 0, face: FACE_DOWN, walk: 0, moving: false },
    npcs: [],
    path: null,
    armed: [],
    events: [],
    time: 0,
    talking: null,
    lastStep: 0,
  };
  placeHero(sim, m, 'at' in place ? spawnOf(m, place.at) : place);
  return sim;
}

/** Перейти на карту: к точке появления `at` или в сохранённое место. */
export function enterMap(sim: HubSim, mapId: string, at: string | HubPlace): void {
  const m = loadMap(mapId);
  placeHero(sim, m, typeof at === 'string' ? spawnOf(m, at) : at);
}

function placeHero(sim: HubSim, m: HubMap, p: HubPlace): void {
  sim.map = m;
  let { x, y } = p;
  // Сохранение из старой планировки или битое место — к ближайшему, где можно стоять.
  if (!canStand(m, x, y)) {
    const v = nearestStand(m, x, y, 4) ?? spawnOf(m, 'in');
    x = v.x;
    y = v.y;
  }
  const h = sim.hero;
  h.x = x;
  h.y = y;
  h.vx = 0;
  h.vy = 0;
  h.face = (p.face & 3) as Face;
  h.moving = false;
  sim.path = null;
  sim.talking = null;
  sim.npcs = m.data.npcs.map((n) => ({
    id: n.id,
    data: n,
    x: n.x,
    y: n.y,
    face: (n.face & 3) as Face,
    working: n.anim === 'work',
    walk: 0,
    moving: false,
    paceDir: 1,
    paceWait: 0,
  }));
  // Дверь, в зоне которой герой появился, взводится, только когда он из
  // неё выйдет: иначе появление у двери тут же уводило бы обратно.
  sim.armed = m.doors.map((d) => !inRect(d.zone, x, y));
}

/** Где сейчас герой — для сохранения. */
export function placeOf(sim: HubSim): HubPlace {
  return { map: sim.map.id, x: sim.hero.x, y: sim.hero.y, face: sim.hero.face };
}

/** Место перед дверью лицом ОТ неё — туда встаёт вернувшийся из шахты. */
export function placeAtDoor(m: HubMap, d: HubDoor): HubPlace {
  return { map: m.id, x: d.ax, y: d.ay, face: faceTo(-d.nx, -d.ny) };
}

/**
 * Пойти к цели по тапу. false — не дойти (стена, закрытый двор): страница
 * может показать это, а герой остаётся стоять.
 */
export function walkTo(sim: HubSim, target: HubTarget): boolean {
  const m = sim.map;
  const h = sim.hero;
  let goals: Goal[];
  if (target.kind === 'npc') {
    const n = sim.npcs.find((x) => x.id === target.id);
    if (!n) return false;
    // Уже рядом — сразу к разговору.
    if (Math.hypot(n.x - h.x, n.y - h.y) <= TALK_R) {
      sim.path = null;
      startTalk(sim, n);
      return true;
    }
    goals = talkGoals(m, n.data);
  } else if (target.kind === 'door') {
    const d = m.doors[target.i];
    if (!d) return false;
    goals = doorGoals(m, d);
  } else {
    const v = nearestStand(m, target.x, target.y, 1.5);
    if (!v) return false;
    goals = [{ i: v.i, j: v.j, extra: 0 }];
  }
  const raw = findPath(m, h.x, h.y, goals);
  if (!raw) return false;
  const pts = smooth(m, h.x, h.y, raw);
  sim.path = { pts, i: 0, target, stuck: 0, push: 0 };
  return true;
}

export function stopWalk(sim: HubSim): void {
  sim.path = null;
}

function startTalk(sim: HubSim, n: HubNpc): void {
  const h = sim.hero;
  h.face = faceTo(n.x - h.x, n.y - h.y);
  h.vx = 0;
  h.vy = 0;
  sim.talking = n.id;
  sim.events.push({ t: 'talk', npc: n.id });
}

/** Разговор кончился — житель возвращается к делу. */
export function endTalk(sim: HubSim): void {
  sim.talking = null;
}

export type HubUsable =
  | { kind: 'npc'; id: string; label: string }
  | { kind: 'door'; door: HubDoor; label: string };

/** Что можно сделать рядом с героем — для контекстной кнопки. */
export function nearestUsable(sim: HubSim): HubUsable | null {
  const h = sim.hero;
  let best: HubUsable | null = null;
  let bd = Infinity;
  for (const n of sim.npcs) {
    const d = Math.hypot(n.x - h.x, n.y - h.y);
    if (d <= TALK_R && d < bd) {
      bd = d;
      best = { kind: 'npc', id: n.id, label: 'Говорить' };
    }
  }
  for (const d of sim.map.doors) {
    if (d.kind !== 'use') continue;
    const z = d.zone;
    const pad = 0.7;
    if (!inRect({ x0: z.x0 - pad, y0: z.y0 - pad, x1: z.x1 + pad, y1: z.y1 + pad }, h.x, h.y))
      continue;
    const dist = Math.hypot(d.x + d.w / 2 - h.x, d.y + d.h / 2 - h.y);
    if (dist < bd) {
      bd = dist;
      best = { kind: 'door', door: d, label: d.label || 'Открыть' };
    }
  }
  return best;
}

/** Нажали контекстную кнопку (или E на клавиатуре). */
export function interactNear(sim: HubSim): HubUsable | null {
  const u = nearestUsable(sim);
  if (!u) return null;
  sim.path = null;
  if (u.kind === 'npc') {
    const n = sim.npcs.find((x) => x.id === u.id);
    if (n) startTalk(sim, n);
  } else {
    const h = sim.hero;
    h.face = faceTo(u.door.x + u.door.w / 2 - h.x, u.door.y + u.door.h / 2 - h.y);
    sim.events.push({ t: 'use', door: u.door });
  }
  return u;
}

/**
 * Что под пальцем: житель (по его фигуре — она выше ног), дверь (с запасом —
 * по двери фасада попадают неточно) или просто точка пола.
 */
export function hitTest(sim: HubSim, x: number, y: number): HubTarget {
  let best: HubTarget | null = null;
  let bd = Infinity;
  for (const n of sim.npcs) {
    // Фигура 16×16 стоит ногами в (x, y): от макушки до ступней.
    if (Math.abs(x - n.x) > 0.6 || y < n.y - 1 || y > n.y + 0.3) continue;
    const d = Math.hypot(x - n.x, y - (n.y - 0.4));
    if (d < bd) {
      bd = d;
      best = { kind: 'npc', id: n.id };
    }
  }
  if (best) return best;
  for (const d of sim.map.doors) {
    if (!inRect(d.tap, x, y)) continue;
    const dist = Math.hypot(x - (d.x + d.w / 2), y - (d.y + d.h / 2));
    if (dist < bd) {
      bd = dist;
      best = { kind: 'door', i: d.i };
    }
  }
  return best ?? { kind: 'point', x, y };
}

/** Шаг мира. Джойстик сбивает путь по тапу: человек взял управление. */
export function stepHub(sim: HubSim, dt: number, input: HubInput): void {
  sim.time += dt;
  const h = sim.hero;
  const m = sim.map;
  let mx = input.mx;
  let my = input.my;
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  const manual = ml > 0.12;
  if (manual) {
    sim.path = null;
    sim.talking = null;
  }
  let arrived = false;
  const p = sim.path;
  if (!manual && p) {
    if (p.i < p.pts.length) {
      const t = p.pts[p.i];
      const dx = t.x - h.x;
      const dy = t.y - h.y;
      const d = Math.hypot(dx, dy);
      const last = p.i === p.pts.length - 1;
      if (d < (last ? 0.06 : 0.18)) {
        p.i++;
        if (p.i >= p.pts.length) arrived = true;
      } else {
        // У последней точки — тормозим, чтобы не проскочить её.
        const k = last ? Math.min(1, d / 0.45) : 1;
        mx = (dx / d) * k;
        my = (dy / d) * k;
      }
    } else if (p.target.kind === 'door') {
      // Дожим: шагнуть в дверь, пока она не сработает.
      const d = m.doors[p.target.i];
      p.push += dt;
      if (d && p.push < 0.6) {
        mx = d.nx;
        my = d.ny;
      } else sim.path = null;
    }
  }

  steerVelocity(h, mx, my, HERO_SPEED, dt);
  const ox = h.x;
  const oy = h.y;
  const moved = moveBody(m.grid, h, dt, () => pushFromNpcs(sim));
  if (moved > 0.001) h.walk += moved;
  const speed = Math.hypot(h.vx, h.vy);
  h.moving = speed > 0.6 && moved / Math.max(dt, 1e-6) > 0.3;
  if (Math.hypot(mx, my) > 0.12 && speed > 0.3) h.face = face4(h.face, h.vx, h.vy);
  if (Math.floor(h.walk / (STRIDE * 2)) !== sim.lastStep) {
    sim.lastStep = Math.floor(h.walk / (STRIDE * 2));
    if (h.moving) sim.events.push({ t: 'step' });
  }

  // Упёрся по пути (житель шагнул навстречу, дверь закрыта) — встаём.
  if (sim.path && !arrived) {
    const want = Math.hypot(mx, my) * HERO_SPEED * dt;
    const got = Math.hypot(h.x - ox, h.y - oy);
    const pushing = sim.path.i >= sim.path.pts.length;
    if (!pushing && want > 0.02 && got < want * 0.25) sim.path.stuck += dt;
    else sim.path.stuck = 0;
    if (sim.path.stuck > 0.6) sim.path = null;
  }
  if (arrived && sim.path) {
    const t = sim.path.target;
    if (t.kind === 'npc') {
      sim.path = null;
      const n = sim.npcs.find((x) => x.id === t.id);
      if (n) startTalk(sim, n);
    } else if (t.kind === 'door') {
      const d = m.doors[t.i];
      if (d?.kind === 'use') {
        sim.path = null;
        h.face = faceTo(d.x + d.w / 2 - h.x, d.y + d.h / 2 - h.y);
        sim.events.push({ t: 'use', door: d });
      }
      // enter/exit — дальше дожим (путь остаётся с i за концом).
    } else sim.path = null;
  }

  // Двери.
  for (const d of m.doors) {
    const inside = inRect(d.zone, h.x, h.y);
    if (!inside) {
      sim.armed[d.i] = true;
      continue;
    }
    if (d.kind === 'use' || !sim.armed[d.i]) continue;
    if (h.vx * d.nx + h.vy * d.ny < DOOR_PUSH) continue;
    // Сработала — до выхода из зоны больше не сработает (закрытая дверь не
    // пишет «закрыто» шестьдесят раз в секунду).
    sim.armed[d.i] = false;
    sim.path = null;
    sim.events.push({ t: 'door', door: d });
  }

  stepNpcs(sim, dt);
}

function pushFromNpcs(sim: HubSim): void {
  const h = sim.hero;
  for (const n of sim.npcs) {
    if (n.data.anim !== 'pace') continue;
    const dx = h.x - n.x;
    const dy = h.y - n.y;
    const min = h.r + 0.3;
    const d = Math.hypot(dx, dy);
    if (d >= min || d < 1e-6) continue;
    h.x += (dx / d) * (min - d);
    h.y += (dy / d) * (min - d);
  }
  collideGrid(sim.map.grid, h);
}

function stepNpcs(sim: HubSim, dt: number): void {
  const h = sim.hero;
  for (const n of sim.npcs) {
    const dx = h.x - n.x;
    const dy = h.y - n.y;
    const near = Math.hypot(dx, dy) < TURN_R;
    const home = (n.data.face & 3) as Face;
    n.moving = false;
    if (sim.talking === n.id || near) {
      n.face = faceTo(dx, dy);
    } else if (n.data.anim === 'pace') {
      // Ходит у своего места туда-сюда, с передышкой на концах.
      if (n.paceWait > 0) n.paceWait -= dt;
      else {
        const step = n.paceDir * 0.9 * dt;
        const nx = n.x + step;
        if (Math.abs(nx - n.data.x) > 1.1 || !canStand(sim.map, nx, n.y, 0.25)) {
          n.paceDir = -n.paceDir;
          n.paceWait = 1.4;
        } else {
          n.x = nx;
          n.walk += Math.abs(step);
          n.moving = true;
          n.face = n.paceDir > 0 ? FACE_RIGHT : FACE_LEFT;
        }
      }
    } else n.face = home;
    // Молот стучит, только пока житель смотрит в свою работу и не говорит.
    n.working = n.data.anim === 'work' && sim.talking !== n.id && n.face === home;
  }
}
