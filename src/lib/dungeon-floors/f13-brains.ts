// Этаж 13 «Театр марионеток» — правила этажа, монстры и Кукловод.
//
// Правила этажа (`registerFloor(13)`):
//  * НИТИ. У кукол (рыцарь, щелкунчик, барабанщик, скрипач, балерина) в
//    `m.data` число нитей `sn` и маска перерезанных `cut`. Нить на полу —
//    отрезок от плеч куклы на север (вверх по экрану) к балке. Режут её
//    взмах меча (сектор удара задел точку нити), рывок поперёк, нота
//    скрипача и мешок противовеса. Нити целы — кукла бьёт ×1,25 и
//    отдёргивается от удара; срезана нить — шатается 0,6 с; все — лёгкая
//    падает и рассыпается, тяжёлая ползёт (скорость ×0,45, урон ×0,7, по
//    ней ×1,5). Паук вяжет нити обратно.
//  * СВЕТ И ТЕНЬ (Зал и Колосники). Софиты ходят по дорожкам в такт
//    (такт 0,75 с, сдвиг на сильную долю). В луче тебя видят все в 12
//    клетках, удары по тебе ×1,2. В тени (не в луче и не у люстры) мобы
//    дальше 4,5 клетки теряют тебя (`f13_lost`), удар по потерявшему —
//    «из тени», ×2. Тени-актёры живут только в луче.
//  * ЛЮКИ сцены, ямы и поворотного круга открываются по очереди
//    (предупреждение 1,2 с, открыт 2 с): мобы падают (`api.fall`), героя
//    люк роняет на край (`hurtEnv` 7%).
//  * События: «Гардероб оживает», «Антракт» (Фойе); «Премьера»,
//    «Увертюра» (Зал); «Третий звонок», «Пожарный занавес» (Колосники).
//  * Действия: противовес, софит, занавес, люки, палочка, звонок, стопор.
//
// Кукловод — `registerBoss('f13boss')`, четыре акта (внизу файла).

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { Brain, BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Sim } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import {
  F13_FLIES,
  F13_FOYER,
  F13_GEO,
  F13_HALL,
  F13_MARK,
  F13_POSTS,
  F13_ROWS,
  F13_TOP,
} from './f13';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Номера клеток движка (`Tile` в `dungeon-world.ts`, значением не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;
const T_HAZARD = 12;

const MK = F13_MARK;

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
const smooth = (k: number) => k * k * (3 - 2 * k);

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

/** Попал ли удар вплотную: рывок и неуязвимость спасают. */
const canHurt = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

const isGhost = (m: Mob) =>
  m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'escape' || (m.data.ghost ?? 0) > 0;

/** Сколько клеток до стены по направлению. */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

/** Отдых после удара: гасит скорость, потом снова в погоню. */
function recoverStep(m: Mob, api: SimApi, T: number, next = 'chase'): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.t > T) api.setMode(m, next);
}

/** Район по мировому ряду. */
function areaAt(sim: Sim, y: number): string {
  const w = sim.world;
  return w.rowArea[clamp(Math.floor(y), 0, w.h - 1)] ?? '';
}

/** Мировая точка из местных координат района (`F13_GEO`). */
const gw = (area: string, x: number, y: number): [number, number] => [x, y + (F13_TOP[area] ?? 0)];

/** Рамка района в мировых координатах: [x0, y0, x1, y1] включительно. */
function boxW(area: string, b: readonly number[]): [number, number, number, number] {
  const t = F13_TOP[area] ?? 0;
  return [b[0], b[1] + t, b[2], b[3] + t];
}

const inBox = (b: readonly number[], x: number, y: number) =>
  x >= b[0] && x < b[2] + 1 && y >= b[1] && y < b[3] + 1;

/** Расстояние от точки до отрезка. */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy || 1e-9;
  const k = clamp(((px - ax) * vx + (py - ay) * vy) / L, 0, 1);
  return hypot(px - ax - vx * k, py - ay - vy * k);
}

/** Пересекаются ли отрезки AB и CD. */
function segCross(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Убить моба окружением (люк, мешок, обвал декорации): удар по своим без
 * урона герою — движок засчитает убийство и бросит добычу.
 */
function envKill(sim: Sim, api: SimApi, m: Mob): void {
  m.data.ghost = 0;
  api.strike(sim, {
    shape: 'circle',
    x: m.x,
    y: m.y,
    r: 0.01,
    warn: 0,
    dmg: 0,
    mobDmg: Infinity,
    art: 'f13_none',
  });
}

/** Урон окружения по мобу: лёгкий — сразу, смертельный — ударом движка. */
function envHurt(sim: Sim, api: SimApi, m: Mob, frac: number): void {
  const d = m.maxHp * frac;
  if (m.hp - d <= 0) envKill(sim, api, m);
  else {
    m.hp -= d;
    m.flash = 0.15;
  }
}

/** Вспышка-картинка (только рисунок, номер из своего счётчика). */
function fx(sim: Sim, api: SimApi, art: string, x: number, y: number, r: number, life: number, extra: Record<string, number> = {}, above = false): void {
  api.vfx(sim, { x, y, r, life, art, above, ...extra } as ZoneIn);
}

// ---------------------------------------------------------------------------
// Числа этажа (тесты и рисовальщики читают их отсюда).
// ---------------------------------------------------------------------------

export const STR = {
  /** Длина нити по полу (на север), клеток. */
  len: 2.4,
  /** Срезанная нить — кукла шатается, с. */
  reel: 0.6,
  /** Нити целы — удар куклы сильнее. */
  intact: 1.25,
  crawlSpeed: 0.45,
  crawlDmg: 0.7,
  crawlHit: 1.5,
  /** Нити отдёргивают от удара: множитель урона и перезарядка. */
  yank: 0.4,
  yankCd: 3.5,
  /** Мешок противовеса режет нити в этом радиусе. */
  bagR: 1.6,
};

/** Сколько нитей у вида. */
export const STRINGS: Record<string, number> = {
  f13_knight: 2,
  f13_nutcracker: 3,
  f13_drummer: 2,
  f13_fiddler: 1,
  f13_ballerina: 1,
};
/** Лёгкие куклы без нитей падают и рассыпаются. */
const LIGHT_PUPPET = new Set(['f13_fiddler', 'f13_ballerina']);

export const SPOT = { beat: 0.75, fastBeat: 0.5, r: 2.2, light: 3.4, turn: 14, see: 12 };
export const SHADOW = { lose: 4.5, find: 3.6, chand: 3.6, back: 2 };
export const TRAP = { period: 6, warn: 1.2, open: 2, near: 16, hurt: 0.07, leverCd: 10 };
export const IRON = { gap: 6, step: 0.9, warn: 1, hold: 2.4, share: 0.16, jam: 14 };
export const SCENE = { warn: 2, hold: 14, changes: 3, crushHero: 0.08, crushMob: 0.4 };
export const ACT_CD = { weight: 14, winch: 25, hold: 14, baton: 20, hush: 8, bell: 8, stopper: 16 };

// ---------------------------------------------------------------------------
// Видимое для рисовальщиков: кадр — одна вылазка на экране.
// ---------------------------------------------------------------------------

export interface SpotFx {
  x: number;
  y: number;
  /** Где стоит фонарь (луч тянется от него). */
  lx: number;
  ly: number;
  on: boolean;
  /** Повёрнут на вторую дорожку. */
  turned: boolean;
}

export const F13_FX = {
  /** Мобы текущей вылазки — нити рисует одна зона поверх темноты. */
  mobs: [] as Mob[],
  time: 0,
  spots: [] as SpotFx[],
  beat: 0,
  beatLen: SPOT.beat,
  /** Сцена Кукловода: акт, переход, окно. */
  act: 0,
  trans: 0,
  open: 0,
  vaga: { x: 0, y: 0 },
  waves: [] as { y: number; dir: number; gaps: number[]; gapW: number; t: number }[],
  stars: [] as { px: number; py: number; x: number; y: number; cut: number; L: number }[],
  moon: { x: 0, y: 0, r: 0 },
};

// ---------------------------------------------------------------------------
// Нити.
// ---------------------------------------------------------------------------

export interface StringSeg {
  i: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cut: boolean;
}

/** Где крестовина Кукловода (концы нитей исполина) — ставит сценарий. */
const VAGA = new WeakMap<Mob, { x: number; y: number }>();

/** Нити моба: от плеч на север к балке (у исполина — к ваге Кукловода). */
export function stringsOf(m: Mob): StringSeg[] {
  const n = m.data.sn ?? 0;
  if (n <= 0) return [];
  const cut = m.data.cut ?? 0;
  const out: StringSeg[] = [];
  const giant = m.kind === 'f13_giant';
  const spider = m.kind === 'f13_spider';
  const W = giant ? 1.3 : n >= 3 ? 0.56 : 0.46;
  const vg = giant ? VAGA.get(m) : undefined;
  for (let i = 0; i < n; i++) {
    const ox = n === 1 ? 0 : (i / (n - 1) - 0.5) * W;
    const ax = m.x + ox;
    const ay = m.y - (giant ? 0.55 : 0.18);
    let bx = m.x + ox * 1.6;
    let by = m.y - (spider ? 3 : STR.len);
    if (vg) {
      bx = vg.x + ox * 0.5;
      by = vg.y + 0.25;
    }
    out.push({ i, ax, ay, bx, by, cut: (cut & (1 << i)) !== 0 });
  }
  return out;
}

const stringsLeft = (m: Mob) => {
  const n = m.data.sn ?? 0;
  let k = 0;
  for (let i = 0; i < n; i++) if (!((m.data.cut ?? 0) & (1 << i))) k++;
  return k;
};

/** Кукла ещё на нитях (хотя бы одна цела). */
const hung = (m: Mob) => (m.data.sn ?? 0) > 0 && stringsLeft(m) > 0;

/** Можно ли сейчас резать нити этого моба. */
function cuttable(m: Mob): boolean {
  if (m.mode === 'dying' || !hung(m)) return false;
  if (m.kind === 'f13_ballerina' && m.mode === 'f13_spin') return false;
  if (m.kind === 'f13_spider') return m.mode === 'f13_hang';
  if (m.kind === 'f13_giant') return m.mode !== 'f13_rebuild' && m.mode !== 'f13_slump';
  return !isGhost(m);
}

/** Слушатели среза для сценария босса (исполин). */
const CUT_HOOK: { giant: ((sim: Sim, m: Mob, api: SimApi) => void) | null } = { giant: null };

function cutString(sim: Sim, m: Mob, i: number, api: SimApi): void {
  const segs = stringsOf(m);
  const s = segs[i];
  if (!s || s.cut) return;
  m.data.cut = (m.data.cut ?? 0) | (1 << i);
  m.data.cutAt = sim.time;
  fx(sim, api, 'f13_snap', s.ax, s.ay, 0.6, 0.5, { bx: s.bx, by: s.by }, true);
  sim.events.push({ t: 'boss', what: 'f13_snap_fall' });
  if (m.kind === 'f13_giant') {
    CUT_HOOK.giant?.(sim, m, api);
    return;
  }
  if (m.kind === 'f13_spider') {
    m.data.sn = 0;
    m.data.ghost = 0;
    api.setMode(m, 'f13_fallen');
    return;
  }
  if (stringsLeft(m) > 0) {
    if (m.mode !== 'f13_spin') {
      m.tele = null;
      m.danger = 0;
      api.setMode(m, 'f13_reel');
    }
    return;
  }
  // Все нити: лёгкая падает, тяжёлая ползёт.
  if (LIGHT_PUPPET.has(m.kind)) {
    fx(sim, api, 'f13_collapse', m.x, m.y, 0.8, 0.9, { k: m.kind === 'f13_ballerina' ? 1 : 0 });
    envKill(sim, api, m);
    return;
  }
  if (!m.data.crawl) {
    m.data.crawl = 1;
    m.speed *= STR.crawlSpeed;
  }
  m.tele = null;
  m.danger = 0;
  api.setMode(m, 'f13_reel');
}

/** Паук связал нить обратно. */
function retie(m: Mob): void {
  const cut = m.data.cut ?? 0;
  if (!cut) return;
  for (let i = 0; i < (m.data.sn ?? 0); i++)
    if (cut & (1 << i)) {
      m.data.cut = cut & ~(1 << i);
      break;
    }
  if (m.data.crawl) {
    m.data.crawl = 0;
    m.speed /= STR.crawlSpeed;
  }
  m.data.tieAt = 1;
}

function initStrings(m: Mob): void {
  if (m.data.sn !== undefined) return;
  m.data.sn = STRINGS[m.kind] ?? 0;
  m.data.cut = 0;
}

// ---------------------------------------------------------------------------
// Состояние этажа.
// ---------------------------------------------------------------------------

interface Post {
  id: number;
  kind: string;
  mode: string;
  x: number;
  y: number;
  mob: number;
  dead: boolean;
}

interface TrapG {
  cells: number[];
  cx: number;
  cy: number;
  room: 'stage' | 'pit' | 'turn';
  /** 0 закрыт, 1 горит, 2 открыт. */
  state: number;
  left: number;
  wait: number;
}

interface Spot {
  lx: number;
  ly: number;
  room: 'stage' | 'parterre' | 'boxes';
  a: [number, number][];
  b: [number, number][];
  x: number;
  y: number;
  on: boolean;
  turnUntil: number;
}

interface Chand {
  key: string;
  x: number;
  y: number;
  on: boolean;
  area: string;
}

interface IronRow {
  y: number;
  cells: number[];
  /** Когда упадёт (время мира), 0 — не назначено. */
  fallAt: number;
  liftAt: number;
  jamUntil: number;
  /** Когда загорится метка ряда (волна идёт с севера). */
  startAt: number;
}

interface F13State {
  posts: Post[];
  traps: TrapG[];
  spots: Spot[];
  chands: Chand[];
  beatT: number;
  beatN: number;
  onBeat: boolean;
  beatLen: number;
  lit: boolean;
  dark: boolean;
  litScan: number;
  hpx: number;
  hpy: number;
  bags: { x: number; y: number; t: number }[];
  saved: Map<number, { tile: number; mark: number }>;
  cds: Map<string, number>;
  doors: { cells: number[]; until: number }[];
  hushUntil: number;
  // события
  cloak: { state: number; t: number; wave: number; ids: number[] };
  inter: { state: number; t: number; rushed: boolean; ids: number[] };
  prem: { state: number; t: number; ids: number[] };
  over: { state: number; t: number; ids: number[] };
  turn: { state: number; t: number; lay: number; next: number; ids: number[]; warned: number };
  iron: { state: number; waveAt: number; rows: IronRow[] };
}

const STATE = new WeakMap<Sim, F13State>();
let postSeq = 1;

const cellI = (sim: Sim, x: number, y: number) => y * sim.world.w + x;

function scan(sim: Sim, api: SimApi): F13State {
  const w = sim.world;
  const posts: Post[] = [];
  for (const area of [F13_FOYER, F13_HALL, F13_FLIES]) {
    const rows = F13_ROWS[area];
    const top = F13_TOP[area];
    for (let y = 0; y < rows.length; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const kind = F13_POSTS[rows[y][x]];
        if (!kind) continue;
        const mode =
          kind === 'f13_spider'
            ? 'f13_up'
            : kind === 'f13_prompter'
              ? 'f13_hide'
              : kind === 'f13_shade'
                ? 'chase'
                : 'sleep';
        posts.push({ id: postSeq++, kind, mode, x: x + 0.5, y: top + y + 0.5, mob: 0, dead: false });
      }
  }
  // Люки.
  const traps: TrapG[] = [];
  const addTraps = (area: string, groups: readonly (readonly (readonly number[])[])[], room: TrapG['room']) =>
    groups.forEach((g, gi) => {
      const cells = g.map(([x, y]) => {
        const [wx, wy] = gw(area, x, y);
        return cellI(sim, wx, wy);
      });
      const cx = g.reduce((s, p) => s + p[0], 0) / g.length + 0.5;
      const cy = g.reduce((s, p) => s + p[1], 0) / g.length + 0.5 + (F13_TOP[area] ?? 0);
      traps.push({ cells, cx, cy, room, state: 0, left: 0, wait: 1.5 + gi * 1.4 });
    });
  addTraps(F13_HALL, F13_GEO.f13wall.stageTraps, 'stage');
  addTraps(F13_HALL, F13_GEO.f13wall.pitTraps, 'pit');
  addTraps(F13_FLIES, F13_GEO.f13bell.turnTraps, 'turn');
  // Софиты: фонарь и две дорожки луча (местные клетки Зала).
  const H = F13_TOP[F13_HALL];
  const P = (pts: number[][]): [number, number][] => pts.map(([x, y]) => [x + 0.5, y + H + 0.5]);
  const spots: Spot[] = [];
  const addSpot = (room: Spot['room'], lamp: readonly number[], a: number[][], b: number[][]) => {
    const pa = P(a);
    spots.push({
      lx: lamp[0] + 0.5,
      ly: lamp[1] + H + 0.5,
      room,
      a: pa,
      b: P(b),
      x: pa[0][0],
      y: pa[0][1],
      on: room !== 'parterre',
      turnUntil: 0,
    });
  };
  const gz = F13_GEO.f13wall;
  addSpot('stage', gz.stageZ[0], [[20, 37], [27, 31], [19, 26], [26, 24]], [[35, 25], [42, 31], [35, 37], [30, 32]]);
  addSpot('stage', gz.stageZ[1], [[43, 37], [36, 31], [44, 26], [37, 24]], [[28, 25], [21, 31], [28, 37], [33, 32]]);
  addSpot('parterre', gz.parterreZ[0], [[12, 88], [22, 82], [14, 74], [24, 66]], [[31, 90], [31, 78], [31, 66], [20, 72]]);
  addSpot('parterre', gz.parterreZ[1], [[51, 88], [41, 82], [49, 74], [39, 66]], [[32, 84], [32, 72], [43, 70], [44, 86]]);
  addSpot('parterre', gz.parterreZ[2], [[46, 62], [36, 62], [26, 62], [16, 62]], [[20, 70], [31, 74], [42, 70], [31, 62]]);
  addSpot('boxes', gz.boxesZ[0], [[59, 26], [59, 32], [59, 38], [59, 32]], [[56, 24], [59, 28], [59, 36], [59, 40]]);
  addSpot('boxes', gz.boxesZ[1], [[59, 44], [59, 50], [59, 56], [59, 50]], [[59, 42], [59, 60], [57, 60], [59, 52]]);
  // Люстры: свой свет, чтобы гасить его на «Премьере».
  const chands: Chand[] = [];
  let ci = 0;
  for (const o of w.objs)
    if (o.ref === 'f13_chandelier') {
      const c: Chand = { key: `f13ch${ci++}`, x: o.x + 0.5, y: o.y + 0.5, on: true, area: o.area };
      chands.push(c);
      api.light(sim, c.key, { x: c.x, y: c.y - 0.6, r: 4.6, tint: 'warm' });
    }
  // Пожарный занавес: ряды желобов галереи.
  const gal = boxW(F13_FLIES, F13_GEO.f13bell.gallery);
  const rows: IronRow[] = [];
  for (const ly of F13_GEO.f13bell.ironRows) {
    const y = ly + F13_TOP[F13_FLIES];
    const cells: number[] = [];
    for (let x = gal[0]; x <= gal[2]; x++) {
      const i = cellI(sim, x, y);
      if (w.mark[i] === MK.groove) cells.push(i);
    }
    rows.push({ y, cells, fallAt: 0, liftAt: 0, jamUntil: 0, startAt: 0 });
  }
  return {
    posts,
    traps,
    spots,
    chands,
    beatT: 0,
    beatN: 0,
    onBeat: false,
    beatLen: SPOT.beat,
    lit: false,
    dark: false,
    litScan: 0,
    hpx: sim.hero.x,
    hpy: sim.hero.y,
    bags: [],
    saved: new Map(),
    cds: new Map(),
    doors: [],
    hushUntil: 0,
    cloak: { state: 0, t: 0, wave: 0, ids: [] },
    inter: { state: 0, t: 0, rushed: false, ids: [] },
    prem: { state: 0, t: 0, ids: [] },
    over: { state: 0, t: 0, ids: [] },
    turn: { state: 0, t: 0, lay: -1, next: 0, ids: [], warned: -1 },
    iron: { state: 0, waveAt: 0, rows },
  };
}

const API_REF: { api: SimApi | null } = { api: null };

function stateOf(sim: Sim): F13State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim, API_REF.api!);
    STATE.set(sim, st);
  }
  return st;
}

/** Состояние этажа — для тестов и стенда. */
export const f13State = (sim: Sim) => STATE.get(sim) ?? null;

function saveTile(sim: Sim, st: F13State, api: SimApi, i: number, tile: number, mark: number, haz?: { slow: number } | null): void {
  const w = sim.world;
  if (!st.saved.has(i)) st.saved.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark, haz);
}

function restoreTile(sim: Sim, st: F13State, api: SimApi, i: number): void {
  const v = st.saved.get(i);
  if (!v) return;
  const w = sim.world;
  api.setTile(sim, i % w.w, Math.floor(i / w.w), v.tile, v.mark, null);
  st.saved.delete(i);
}

// ---------------------------------------------------------------------------
// Посты: куклы на своих местах с начала вылазки.
// ---------------------------------------------------------------------------

function postDead(sim: Sim, m: Mob): void {
  const st = STATE.get(sim);
  const p = st?.posts.find((x) => x.id === m.data.post);
  if (p) {
    p.dead = true;
    p.mob = 0;
  }
}

function stepPosts(sim: Sim, st: F13State, api: SimApi): void {
  const h = sim.hero;
  for (const p of st.posts) {
    if (p.dead) continue;
    if (p.mob) {
      const m = sim.mobs.find((x) => x.id === p.mob);
      if (m && m.mode !== 'dying' && m.mode !== 'escape') continue;
      if (m) {
        p.dead = true;
        p.mob = 0;
        continue;
      }
      p.mob = 0;
    }
    if (hypot(p.x - h.x, p.y - h.y) > 17) continue;
    if (sim.boss?.state === 'fight' && api.inArena(sim, p.x, p.y)) continue;
    const m = api.spawnMob(sim, p.kind, p.x, p.y, { mode: p.mode });
    m.data.post = p.id;
    m.face = Math.PI / 2;
    p.mob = m.id;
  }
}

// ---------------------------------------------------------------------------
// Такт, софиты, свет и тень.
// ---------------------------------------------------------------------------

function stepBeat(sim: Sim, st: F13State, dt: number): void {
  st.beatLen = st.over.state === 1 ? SPOT.fastBeat : SPOT.beat;
  st.beatT += dt;
  st.onBeat = false;
  if (st.beatT >= st.beatLen) {
    st.beatT -= st.beatLen;
    st.beatN += 1;
    st.onBeat = true;
  }
  F13_FX.beat = st.beatN + st.beatT / st.beatLen;
  F13_FX.beatLen = st.beatLen;
}

/** Где луч сейчас: на сильную долю едет к следующей точке, три доли стоит. */
function spotAt(st: F13State, s: Spot, now: number): [number, number] {
  const path = now < s.turnUntil ? s.b : s.a;
  const bar = Math.floor(st.beatN / 4);
  const inBar = (st.beatN % 4) + st.beatT / st.beatLen;
  const i = bar % path.length;
  const j = (i + 1) % path.length;
  const k = smooth(clamp(inBar, 0, 1));
  return [path[i][0] + (path[j][0] - path[i][0]) * k, path[i][1] + (path[j][1] - path[i][1]) * k];
}

function stepSpots(sim: Sim, st: F13State, api: SimApi): void {
  const h = sim.hero;
  F13_FX.spots.length = 0;
  st.spots.forEach((s, i) => {
    s.on = s.room !== 'parterre' || st.prem.state === 1;
    const near = hypot(s.lx - h.x, s.ly - h.y) < 40;
    if (near) {
      const [x, y] = spotAt(st, s, sim.time);
      s.x = x;
      s.y = y;
    }
    api.light(sim, `f13spot${i}`, s.on && near ? { x: s.x, y: s.y, r: SPOT.light, tint: 'warm' } : null);
    F13_FX.spots.push({ x: s.x, y: s.y, lx: s.lx, ly: s.ly, on: s.on, turned: sim.time < s.turnUntil });
  });
}

/** Точка в луче какого-нибудь софита. */
export function inBeam(sim: Sim, x: number, y: number, pad = 0): number {
  const st = STATE.get(sim);
  if (!st) return -1;
  for (let i = 0; i < st.spots.length; i++) {
    const s = st.spots[i];
    if (s.on && hypot(s.x - x, s.y - y) < SPOT.r + pad) return i;
  }
  return -1;
}

function stepLight(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const area = areaAt(sim, h.y);
  const fight = sim.boss?.state === 'fight' && api.inArena(sim, h.x, h.y);
  const wasLit = st.lit;
  st.lit = !fight && area !== F13_FOYER && inBeam(sim, h.x, h.y) >= 0;
  const nearCh = st.chands.some((c) => c.on && hypot(c.x - h.x, c.y - h.y) < SHADOW.chand);
  st.dark = !fight && area !== F13_FOYER && !st.lit && !nearCh;
  // В луче тебя видят все вокруг.
  st.litScan -= dt;
  if (st.lit && (st.litScan <= 0 || !wasLit)) {
    st.litScan = 0.4;
    for (const m of sim.mobs) {
      if (m.mode !== 'sleep' && m.mode !== 'f13_lost') continue;
      if (hypot(m.x - h.x, m.y - h.y) > SPOT.see) continue;
      if (!api.lineOfSight(sim, m.x, m.y, h.x, h.y)) continue;
      api.setMode(m, 'alert');
    }
  }
}

/** Герой ушёл в тень дальше 4,5 клетки — моб его теряет. */
function lostCheck(sim: Sim, m: Mob, c: BrainCtx, api: SimApi): boolean {
  const st = STATE.get(sim);
  if (!st || !st.dark || c.dist <= SHADOW.lose) return false;
  m.data.lx = sim.hero.x + (sim.rng() - 0.5) * 3;
  m.data.ly = sim.hero.y + (sim.rng() - 0.5) * 3;
  m.tele = null;
  m.danger = 0;
  api.setMode(m, 'f13_lost');
  return true;
}

function lostStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const st = STATE.get(sim);
  m.tele = null;
  m.danger = 0;
  if (!st || !st.dark || c.dist < SHADOW.find) {
    api.setMode(m, 'alert');
    return;
  }
  if (m.t > 12) {
    m.data.lx = m.hx;
    m.data.ly = m.hy;
  }
  const tx = (m.data.lx ?? m.x) + Math.cos(m.t * 0.6 + m.id) * 1.2;
  const ty = (m.data.ly ?? m.y) + Math.sin(m.t * 0.6 + m.id) * 1.2;
  const d = hypot(tx - m.x, ty - m.y);
  if (d > 0.5 && api.lineOfSight(sim, m.x, m.y, tx, ty))
    api.steer(sim, m, (tx - m.x) / d, (ty - m.y) / d, m.speed * 0.4, dt);
  else {
    m.vx *= 0.85;
    m.vy *= 0.85;
  }
}

// ---------------------------------------------------------------------------
// Люки.
// ---------------------------------------------------------------------------

function trapOpen(sim: Sim, st: F13State, g: TrapG, api: SimApi): void {
  const w = sim.world;
  for (const i of g.cells) api.setTile(sim, i % w.w, Math.floor(i / w.w), T_DEEP, MK.trapOpen);
  sim.events.push({ t: 'clank', x: g.cx, y: g.cy });
  const onTrap = (x: number, y: number) => g.cells.includes(cellI(sim, Math.floor(x), Math.floor(y)));
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || isGhost(m)) continue;
    const d = api.def(m.kind);
    if (d.fly || d.boss) continue;
    if (onTrap(m.x, m.y)) api.fall(sim, m);
  }
  const h = sim.hero;
  if (!heroDown(sim) && h.mode !== 'dash' && onTrap(h.x, h.y)) {
    api.hurtEnv(sim, TRAP.hurt);
    // На край люка: ближайшая клетка пола вне люка.
    let best: [number, number] | null = null;
    let bd = 1e9;
    const hx = Math.floor(h.x);
    const hy = Math.floor(h.y);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = hx + dx;
        const y = hy + dy;
        if (api.solidTile(sim, x, y) || g.cells.includes(cellI(sim, x, y))) continue;
        const d = hypot(x + 0.5 - h.x, y + 0.5 - h.y);
        if (d < bd) {
          bd = d;
          best = [x + 0.5, y + 0.5];
        }
      }
    if (best) api.moveHero(sim, best[0], best[1]);
    fx(sim, api, 'f13_dust', h.x, h.y, 0.8, 0.6);
  }
  void st;
}

function trapClose(sim: Sim, g: TrapG, api: SimApi): void {
  const w = sim.world;
  for (const i of g.cells) api.setTile(sim, i % w.w, Math.floor(i / w.w), T_FLOOR, MK.trap);
}

function trapWarn(sim: Sim, g: TrapG, api: SimApi, warn: number): void {
  g.state = 1;
  g.left = warn;
  fx(sim, api, 'f13_trapwarn', g.cx, g.cy, 1.2, warn);
}

function stepTraps(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const fight = sim.boss?.state === 'fight';
  for (const g of st.traps) {
    const near = hypot(g.cx - h.x, g.cy - h.y) < TRAP.near;
    const live = near && !fight && (g.room !== 'pit' || st.over.state === 1);
    if (g.state === 0) {
      if (!live) continue;
      g.wait -= dt;
      if (g.wait <= 0) trapWarn(sim, g, api, TRAP.warn);
      continue;
    }
    g.left -= dt;
    if (g.left > 0) continue;
    if (g.state === 1) {
      g.state = 2;
      g.left = TRAP.open;
      trapOpen(sim, st, g, api);
    } else {
      g.state = 0;
      g.wait = TRAP.period - TRAP.warn - TRAP.open + (g.room === 'pit' ? -1.5 : 0);
      trapClose(sim, g, api);
    }
  }
}

/** Люк под точкой (для арлекина): ближайшая группа в радиусе. */
function trapNear(sim: Sim, x: number, y: number, r: number): TrapG | null {
  const st = STATE.get(sim);
  if (!st) return null;
  let best: TrapG | null = null;
  let bd = r;
  for (const g of st.traps) {
    const d = hypot(g.cx - x, g.cy - y);
    if (d < bd) {
      bd = d;
      best = g;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Резка нитей: взмах, рывок, ноты, мешки.
// ---------------------------------------------------------------------------

function stepCuts(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const h = sim.hero;
  // Взмахи этого шага.
  for (const e of sim.events) {
    if (e.t !== 'swing') continue;
    const reach = e.reach + 0.15;
    for (const m of sim.mobs) {
      if (!cuttable(m)) continue;
      if (hypot(m.x - e.x, m.y - e.y) > reach + 4.5) continue;
      let budget = e.heavy ? 2 : 1;
      for (const s of stringsOf(m)) {
        if (s.cut || budget <= 0) continue;
        let hit = false;
        // Нить над головой куклы: удар в саму куклу снизу её не берёт.
        for (let k = m.kind === 'f13_giant' ? 0.08 : 0.24; k <= 1.001 && !hit; k += 0.08) {
          const px = s.ax + (s.bx - s.ax) * k;
          const py = s.ay + (s.by - s.ay) * k;
          const d = hypot(px - e.x, py - e.y);
          if (d > reach) continue;
          if (Math.abs(angDiff(Math.atan2(py - e.y, px - e.x), e.ang)) <= e.arc / 2 + 0.1) hit = true;
        }
        if (hit) {
          cutString(sim, m, s.i, api);
          budget--;
        }
      }
    }
  }
  // Рывок поперёк нити.
  if (h.mode === 'dash') {
    for (const m of sim.mobs) {
      if (!cuttable(m) || hypot(m.x - h.x, m.y - h.y) > 5) continue;
      for (const s of stringsOf(m))
        if (!s.cut && segCross(st.hpx, st.hpy, h.x, h.y, s.ax, s.ay, s.bx, s.by))
          cutString(sim, m, s.i, api);
    }
  }
  // Ноты скрипача режут чужие нити и летят дугой.
  for (const s of sim.shots) {
    if (s.art !== 'f13_note') continue;
    const turn = (s.id % 2 ? 1 : -1) * 0.9 * dt;
    const c = Math.cos(turn);
    const n = Math.sin(turn);
    const vx = s.vx * c - s.vy * n;
    s.vy = s.vx * n + s.vy * c;
    s.vx = vx;
    if (s.age < 0.25) continue;
    for (const m of sim.mobs) {
      if (!cuttable(m) || m.kind === 'f13_giant' || hypot(m.x - s.x, m.y - s.y) > 3.2) continue;
      for (const g of stringsOf(m))
        if (!g.cut && segDist(s.x, s.y, g.ax, g.ay, g.bx, g.by) < 0.28) {
          cutString(sim, m, g.i, api);
          s.life = s.age;
          break;
        }
    }
  }
  // Мешки противовеса легли.
  st.bags = st.bags.filter((b) => {
    if (sim.time < b.t) return true;
    for (const m of sim.mobs) {
      if (!cuttable(m) || m.kind === 'f13_giant') continue;
      for (const s of stringsOf(m))
        if (!s.cut && (hypot(s.ax - b.x, s.ay - b.y) < STR.bagR || segDist(b.x, b.y, s.ax, s.ay, s.bx, s.by) < STR.bagR * 0.7))
          cutString(sim, m, s.i, api);
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// События.
// ---------------------------------------------------------------------------

const BOX = {
  cloak: boxW(F13_FOYER, F13_GEO.f13.cloak),
  buffet: boxW(F13_FOYER, F13_GEO.f13.buffet),
  lobbyW: boxW(F13_FOYER, F13_GEO.f13.lobbyW),
  lobbyE: boxW(F13_FOYER, F13_GEO.f13.lobbyE),
  parterre: boxW(F13_HALL, F13_GEO.f13wall.parterre),
  pit: boxW(F13_HALL, F13_GEO.f13wall.pit),
  gallery: boxW(F13_FLIES, F13_GEO.f13bell.gallery),
  arena: boxW(F13_FLIES, F13_GEO.f13bell.arena),
};

const TURN = (() => {
  const [cx, cy, R] = F13_GEO.f13bell.turn;
  return { cx, cy: cy + F13_TOP[F13_FLIES], R };
})();

/**
 * Декорации поворотного круга: лес (купы картонных деревьев), замок
 * (зубчатое кольцо с четырьмя воротами), море (полосы волн — вязко).
 * Клетки — мировые, только пол круга (`q`), не ступица и не люки.
 */
export const F13_SCENERY: { name: string; kind: 'wall' | 'sea'; mark: number; cells: [number, number][] }[] =
  (() => {
    const rows = F13_ROWS[F13_FLIES];
    const top = F13_TOP[F13_FLIES];
    const ok = (x: number, y: number) => {
      const ly = y - top;
      if (ly < 0 || ly >= rows.length || rows[ly][x] !== 'q') return false;
      const d = hypot(x + 0.5 - TURN.cx, y + 0.5 - TURN.cy);
      return d > 2.4 && d < TURN.R - 0.7;
    };
    const uniq = (cells: [number, number][]) => {
      const seen = new Set<number>();
      return cells.filter(([x, y]) => {
        const k = y * 64 + x;
        if (seen.has(k) || !ok(x, y)) return false;
        seen.add(k);
        return true;
      });
    };
    const forest: [number, number][] = [];
    const clump = (a: number, r: number) => {
      const x = Math.floor(TURN.cx + Math.cos(a) * r - 0.5);
      const y = Math.floor(TURN.cy + Math.sin(a) * r - 0.5);
      forest.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]);
    };
    for (let k = 0; k < 6; k++) clump((k * Math.PI) / 3 + 0.26, 6.2);
    for (let k = 0; k < 4; k++) clump((k * Math.PI) / 2 + Math.PI / 4, 10.2);
    const castle: [number, number][] = [];
    const sea: [number, number][] = [];
    for (let y = Math.floor(TURN.cy - TURN.R); y <= TURN.cy + TURN.R; y++)
      for (let x = Math.floor(TURN.cx - TURN.R); x <= TURN.cx + TURN.R; x++) {
        const dx = x + 0.5 - TURN.cx;
        const dy = y + 0.5 - TURN.cy;
        const d = hypot(dx, dy);
        if (Math.abs(d - 7.5) < 0.55) {
          const a = Math.atan2(dy, dx);
          const gate = [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((g) => Math.abs(angDiff(a, g)) < 0.26);
          if (!gate) castle.push([x, y]);
        }
        const ry = Math.round(dy);
        if ((ry === -6 || ry === -2 || ry === 2 || ry === 6) && Math.abs(dy - ry) < 0.5) sea.push([x, y]);
      }
    return [
      { name: 'лес', kind: 'wall' as const, mark: MK.setTree, cells: uniq(forest) },
      { name: 'замок', kind: 'wall' as const, mark: MK.setCastle, cells: uniq(castle) },
      { name: 'море', kind: 'sea' as const, mark: MK.setSea, cells: uniq(sea) },
    ];
  })();

const SEA_HAZ = { slow: 0.55 };

const aliveIds = (sim: Sim, ids: number[]) =>
  ids.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));

/** Точка пола в рамке рядом с (x, y) на расстоянии r0…r1. */
function floorNear(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r0: number,
  r1: number,
  box?: readonly number[],
): [number, number] | null {
  for (let i = 0; i < 30; i++) {
    const a = sim.rng() * TAU;
    const r = r0 + sim.rng() * (r1 - r0);
    const px = Math.floor(x + Math.cos(a) * r);
    const py = Math.floor(y + Math.sin(a) * r);
    if (box && !inBox(box, px + 0.5, py + 0.5)) continue;
    if (api.solidTile(sim, px, py)) continue;
    if (api.solidTile(sim, px + 1, py) || api.solidTile(sim, px - 1, py)) continue;
    return [px + 0.5, py + 0.5];
  }
  return null;
}

/** «Аплодисменты»: публика бросает на сцену монеты, нити и конфеты. */
function applause(sim: Sim, api: SimApi, x: number, y: number, big: number): void {
  sim.events.push({
    t: 'boss',
    what: 'f13_applause_fall',
    text: 'АПЛОДИСМЕНТЫ',
    sub: 'публика бросает на сцену монеты и цветы',
  });
  for (let i = 0; i < 3 + big; i++) api.dropAt(sim, 'coin', 600, x, y);
  api.dropAt(sim, 'f13mat', 1 + big, x, y);
  api.dropAt(sim, 'f13_candy', 1, x, y);
  if (big > 1) api.dropAt(sim, 'token', 2, x, y);
  fx(sim, api, 'f13_flowers', x, y, 2.4, 2.2);
}

const call = (sim: Sim, what: string, text: string, sub: string) =>
  sim.events.push({ t: 'boss', what, text, sub });

// ---- Фойе: «Гардероб оживает» ---------------------------------------------

const CLOAK_WAVES = [
  ['f13_knight', 'f13_knight', 'f13_ballerina'],
  ['f13_harlequin', 'f13_knight', 'f13_ballerina'],
  ['f13_nutcracker', 'f13_knight', 'f13_fiddler'],
];

function stepCloak(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const ev = st.cloak;
  const h = sim.hero;
  const inside = inBox(BOX.cloak, h.x, h.y);
  if (ev.state === 0) {
    if (!inside || heroDown(sim)) return;
    ev.state = 1;
    ev.t = 0;
    ev.wave = 0;
    call(sim, 'f13_bell_call', 'ГАРДЕРОБ ОЖИВАЕТ', 'костюмы падают с вешалок — режь нити');
    return;
  }
  if (ev.state !== 1) return;
  ev.t += dt;
  ev.ids = aliveIds(sim, ev.ids);
  if (!inside) return;
  const due = ev.wave === 0 ? ev.t > 1.2 : ev.ids.length === 0 || ev.t > 10;
  if (due && ev.wave < CLOAK_WAVES.length) {
    const racks = F13_GEO.f13.cloakRacks;
    const kinds = CLOAK_WAVES[ev.wave];
    const used = new Set<number>();
    kinds.forEach((kind) => {
      let k = Math.floor(sim.rng() * racks.length);
      for (let n = 0; n < racks.length && used.has(k); n++) k = (k + 1) % racks.length;
      used.add(k);
      const [wx, wy] = gw(F13_FOYER, racks[k][0], racks[k][1] + 1);
      const m = api.spawnMob(sim, kind, wx + 0.5, wy + 0.5, { mode: 'drop', elite: kind === 'f13_nutcracker' });
      ev.ids.push(m.id);
      fx(sim, api, 'f13_dust', wx + 0.5, wy + 0.5, 0.8, 0.7);
    });
    ev.wave += 1;
    ev.t = 0;
    return;
  }
  if (ev.wave >= CLOAK_WAVES.length && ev.ids.length === 0) {
    ev.state = 2;
    applause(sim, api, h.x, h.y, 1);
  }
}

// ---- Фойе: «Антракт» -------------------------------------------------------

const INTER_KINDS = ['f13_knight', 'f13_harlequin', 'f13_ballerina', 'f13_knight', 'f13_fiddler', 'f13_comedy'];

function stepInter(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const ev = st.inter;
  const h = sim.hero;
  if (ev.state === 0) {
    if (!inBox(BOX.buffet, h.x, h.y) || heroDown(sim)) return;
    ev.state = 1;
    ev.t = 0;
    call(sim, 'f13_bell_call', 'АНТРАКТ', 'первый звонок — публика вышла в кулуары');
    INTER_KINDS.forEach((kind, i) => {
      const box = i % 2 ? BOX.lobbyE : BOX.lobbyW;
      const p = floorNear(sim, api, (box[0] + box[2]) / 2 + 0.5, (box[1] + box[3]) / 2 + 0.5, 0, 6, box);
      if (!p) return;
      const m = api.spawnMob(sim, kind, p[0], p[1], { mode: 'f13_wait' });
      m.face = sim.rng() * TAU;
      ev.ids.push(m.id);
    });
    return;
  }
  if (ev.state !== 1) return;
  ev.t += dt;
  ev.ids = aliveIds(sim, ev.ids);
  // Кукол-зрителей стало больше: маска приводит пару.
  for (const m of sim.mobs)
    if (m.kind === 'f13_tragedy' && ev.ids.includes(m.data.pair ?? -1) && !ev.ids.includes(m.id)) ev.ids.push(m.id);
  const peek = inBox(BOX.lobbyW, h.x, h.y) || inBox(BOX.lobbyE, h.x, h.y);
  if (!ev.rushed && (ev.t > 12 || peek)) {
    ev.rushed = true;
    call(sim, 'f13_alarm_trap', 'ТРЕТИЙ ЗВОНОК', 'публика возвращается — опусти занавес у дверей');
    for (const m of sim.mobs) if (ev.ids.includes(m.id) && m.mode === 'f13_wait') api.setMode(m, 'alert');
  }
  if (ev.rushed && ev.ids.length === 0) {
    ev.state = 2;
    applause(sim, api, h.x, h.y, 1);
  }
}

// ---- Зал: «Премьера» -------------------------------------------------------

function stepPremiere(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const ev = st.prem;
  const h = sim.hero;
  if (ev.state === 0) {
    if (!inBox(BOX.parterre, h.x, h.y) || heroDown(sim)) return;
    ev.state = 1;
    ev.t = 0;
    call(sim, 'f13_alarm_call', 'ПРЕМЬЕРА', 'свет гаснет, занавес поднимается — в лучах встают тени');
    sim.events.push({ t: 'flash', color: '#1a0410', k: 0.6 });
    // Люстры зала гаснут.
    for (const c of st.chands)
      if (c.area === F13_HALL && inBox(BOX.parterre, c.x, c.y)) {
        c.on = false;
        api.light(sim, c.key, null);
      }
    // Занавес поднимается — навсегда: из ямы на сцену можно пройти.
    for (const [x, y] of F13_GEO.f13wall.curtain) {
      const [wx, wy] = gw(F13_HALL, x, y);
      api.setTile(sim, wx, wy, T_FLOOR, MK.curtainUp);
    }
    // Тени в лучах партера, куклы — в проходах.
    st.spots.forEach((s, i) => {
      if (s.room !== 'parterre') return;
      const [x, y] = spotAt(st, s, sim.time);
      s.x = x;
      s.y = y;
      const m = api.spawnMob(sim, 'f13_shade', x, y, { mode: 'chase' });
      m.data.beam = i;
      ev.ids.push(m.id);
    });
    for (const kind of ['f13_knight', 'f13_knight', 'f13_comedy']) {
      const p = floorNear(sim, api, h.x, h.y, 4, 8, BOX.parterre);
      if (!p) continue;
      const m = api.spawnMob(sim, kind, p[0], p[1], { mode: 'drop' });
      ev.ids.push(m.id);
    }
    return;
  }
  if (ev.state !== 1) return;
  ev.t += dt;
  ev.ids = aliveIds(sim, ev.ids);
  if (ev.t > 50 || (ev.t > 6 && ev.ids.length === 0)) {
    ev.state = 2;
    for (const c of st.chands)
      if (!c.on) {
        c.on = true;
        api.light(sim, c.key, { x: c.x, y: c.y - 0.6, r: 4.6, tint: 'warm' });
      }
    // Свет зажёгся — тени партера тают.
    for (const m of sim.mobs)
      if (m.kind === 'f13_shade' && m.mode !== 'dying' && st.spots[m.data.beam ?? -1]?.room === 'parterre') {
        fx(sim, api, 'f13_fade', m.x, m.y, 0.8, 0.8);
        envKill(sim, api, m);
      }
    applause(sim, api, h.x, h.y, 2);
  }
}

// ---- Зал: «Увертюра» -------------------------------------------------------

const MUSIC = new Set(['f13_drummer', 'f13_fiddler']);

function stepOverture(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const ev = st.over;
  const h = sim.hero;
  if (ev.state === 0) {
    if (!inBox(BOX.pit, h.x, h.y) || heroDown(sim)) return;
    ev.state = 1;
    ev.t = 0;
    call(sim, 'f13_bell_call', 'УВЕРТЮРА', 'оркестр играет быстрее — люки ямы в такт; палочка дирижёра у пульта');
    for (const m of sim.mobs)
      if (MUSIC.has(m.kind) && m.mode !== 'dying' && inBox(BOX.pit, m.x, m.y)) {
        if (m.mode === 'sleep') api.setMode(m, 'alert');
        ev.ids.push(m.id);
      }
    for (let i = 0; i < 2; i++) {
      const p = floorNear(sim, api, h.x, h.y, 3, 6, BOX.pit);
      if (!p) continue;
      ev.ids.push(api.spawnMob(sim, 'f13_harlequin', p[0], p[1], { mode: 'drop' }).id);
    }
    return;
  }
  if (ev.state !== 1) return;
  ev.t += dt;
  ev.ids = aliveIds(sim, ev.ids);
  if (ev.t > 60 || ev.ids.length === 0) {
    ev.state = 2;
    if (ev.ids.length === 0) applause(sim, api, h.x, h.y, 1);
  }
}

// ---- Колосники: «Третий звонок» на поворотном круге ------------------------

function layoutCells(sim: Sim, lay: number): number[] {
  const L = F13_SCENERY[lay];
  return L ? L.cells.map(([x, y]) => cellI(sim, x, y)) : [];
}

function clearLayout(sim: Sim, st: F13State, api: SimApi, lay: number): void {
  for (const i of layoutCells(sim, lay)) restoreTile(sim, st, api, i);
}

function applyLayout(sim: Sim, st: F13State, api: SimApi, lay: number): void {
  const L = F13_SCENERY[lay];
  if (!L) return;
  const cells = layoutCells(sim, lay);
  const set = new Set(cells);
  const w = sim.world.w;
  const at = (x: number, y: number) => set.has(Math.floor(y) * w + Math.floor(x));
  if (L.kind === 'wall') {
    // Кого придавит картоном — получает своё (видно было две секунды).
    if (!heroDown(sim) && at(sim.hero.x, sim.hero.y) && sim.hero.mode !== 'dash') api.hurtEnv(sim, SCENE.crushHero);
    for (const m of sim.mobs)
      if (m.mode !== 'dying' && !isGhost(m) && !api.def(m.kind).boss && at(m.x, m.y)) envHurt(sim, api, m, SCENE.crushMob);
  }
  for (const i of cells)
    if (L.kind === 'wall') saveTile(sim, st, api, i, T_WALL, L.mark);
    else saveTile(sim, st, api, i, T_HAZARD, L.mark, SEA_HAZ);
}

function stepTurn(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const ev = st.turn;
  const h = sim.hero;
  const inDisc = hypot(h.x - TURN.cx, h.y - TURN.cy) < TURN.R - 1;
  if (ev.state === 0) {
    if (!inDisc || heroDown(sim)) return;
    startTurn(sim, st, api);
    return;
  }
  if (ev.state !== 1) return;
  ev.t += dt;
  ev.ids = aliveIds(sim, ev.ids);
  const k = ev.lay + 1;
  // Звонок и линии на полу за две секунды до смены.
  if (k <= SCENE.changes && ev.t >= ev.next - SCENE.warn && ev.warned !== k) {
    ev.warned = k;
    if (k < SCENE.changes) {
      fx(sim, api, 'f13_setwarn', TURN.cx, TURN.cy, TURN.R, SCENE.warn, { lay: k });
      call(sim, 'f13_alarm_trap', 'ТРЕТИЙ ЗВОНОК', `декорации: ${F13_SCENERY[k].name} — сойди с линий`);
    }
  }
  if (ev.t < ev.next) return;
  if (ev.lay >= 0) clearLayout(sim, st, api, ev.lay);
  if (k >= SCENE.changes) {
    ev.state = 2;
    ev.lay = -1;
    applause(sim, api, h.x, h.y, 2);
    return;
  }
  applyLayout(sim, st, api, k);
  ev.lay = k;
  ev.next = ev.t + SCENE.hold;
  sim.events.push({ t: 'boss', what: 'f13_scene_wall' });
  sim.events.push({ t: 'shake', k: 0.35 });
  const kinds = k === 1 ? ['f13_knight', 'f13_nutcracker'] : ['f13_harlequin', 'f13_knight'];
  for (const kind of kinds) {
    const p = floorNear(sim, api, h.x, h.y, 3, 7);
    if (!p || hypot(p[0] - TURN.cx, p[1] - TURN.cy) > TURN.R - 1) continue;
    ev.ids.push(api.spawnMob(sim, kind, p[0], p[1], { mode: 'drop' }).id);
  }
}

function startTurn(sim: Sim, st: F13State, api: SimApi): void {
  const ev = st.turn;
  ev.state = 1;
  ev.t = 0;
  ev.lay = -1;
  ev.next = SCENE.warn + 0.4;
  ev.warned = -1;
  call(sim, 'f13_bell_call', 'СМЕНА ДЕКОРАЦИЙ', 'круг поворачивается — линии на полу покажут, где встанет картон');
  void api;
}

// ---- Колосники: «Пожарный занавес» -----------------------------------------

function stepIron(sim: Sim, st: F13State, api: SimApi): void {
  const ev = st.iron;
  const h = sim.hero;
  const inside = inBox(BOX.gallery, h.x, h.y);
  if (ev.state === 0 && inside && !heroDown(sim)) {
    ev.state = 1;
    ev.waveAt = sim.time + 1.2;
    call(sim, 'f13_bell_call', 'ПОЖАРНЫЙ ЗАНАВЕС', 'железо падает волной — проходи между секциями; стопор клинит одну');
  }
  if (ev.state === 1 && !inside && h.y < BOX.gallery[1]) ev.state = 2;
  if (ev.state === 1 && inside && sim.time >= ev.waveAt) {
    ev.waveAt = sim.time + IRON.gap;
    ev.rows.forEach((r, k) => {
      if (!r.fallAt && !r.liftAt) r.startAt = sim.time + k * IRON.step;
    });
  }
  const gal = BOX.gallery;
  ev.rows.forEach((r, k) => {
    if (r.startAt && sim.time >= r.startAt) {
      r.startAt = 0;
      if (sim.time < r.jamUntil || ev.state !== 1) return;
      api.strike(sim, {
        shape: 'line',
        x: gal[0],
        y: r.y + 0.5,
        r: gal[2] - gal[0] + 1,
        w: 0.5,
        ang: 0,
        warn: IRON.warn,
        dmg: rawShare(sim, IRON.share),
        knock: 4,
        mobDmg: Infinity,
        art: 'f13_iron',
      });
      r.fallAt = sim.time + IRON.warn;
    }
    if (r.fallAt && sim.time >= r.fallAt) {
      r.fallAt = 0;
      r.liftAt = sim.time + IRON.hold;
      for (const i of r.cells) saveTile(sim, st, api, i, T_WALL, MK.iron);
      if (k === 0) sim.events.push({ t: 'boss', what: 'f13_iron_wall' });
    }
    if (r.liftAt && sim.time >= r.liftAt) {
      r.liftAt = 0;
      for (const i of r.cells) restoreTile(sim, st, api, i);
    }
  });
}

// ---------------------------------------------------------------------------
// Действия этажа.
// ---------------------------------------------------------------------------

function ready(sim: Sim, st: F13State, obj: WorldObj): boolean {
  return (st.cds.get(obj.id) ?? 0) <= sim.time;
}

function spotOf(st: F13State, obj: WorldObj): Spot | null {
  let best: Spot | null = null;
  let bd = 2;
  for (const s of st.spots) {
    const d = hypot(s.lx - obj.x - 0.5, s.ly - obj.y - 0.5);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

function doorOf(obj: WorldObj): readonly (readonly number[])[] {
  return obj.x < 32 ? F13_GEO.f13.buffetDoorW : F13_GEO.f13.buffetDoorE;
}

function onUse(sim: Sim, obj: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim);
  if (!ready(sim, st, obj)) return false;
  const ox = obj.x + 0.5;
  const oy = obj.y + 0.5;
  switch (obj.ref) {
    case 'f13_weight': {
      // Мешок с песком — на ближнего врага: давит и режет нити.
      let best: Mob | null = null;
      let bd = 7.5;
      for (const m of sim.mobs) {
        if (m.mode === 'dying' || isGhost(m) || api.def(m.kind).boss) continue;
        const d = hypot(m.x - ox, m.y - oy) - (hung(m) ? 1.5 : 0);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (!best) return false;
      api.strike(sim, {
        shape: 'circle',
        x: best.x,
        y: best.y,
        r: 1.3,
        warn: 0.6,
        dmg: rawShare(sim, 0.05),
        knock: 3,
        mobDmg: best.maxHp * 0.45,
        art: 'f13_sandbag',
      });
      st.bags.push({ x: best.x, y: best.y, t: sim.time + 0.6 });
      st.cds.set(obj.id, sim.time + ACT_CD.weight);
      sim.events.push({ t: 'boss', what: 'f13_hook_call' });
      return true;
    }
    case 'f13_spot': {
      const s = spotOf(st, obj);
      if (!s) return false;
      s.turnUntil = sim.time < s.turnUntil ? 0 : sim.time + SPOT.turn;
      st.cds.set(obj.id, sim.time + 1);
      sim.events.push({ t: 'clank', x: ox, y: oy });
      return true;
    }
    case 'f13_winch': {
      const cells = doorOf(obj).map(([x, y]) => {
        const [wx, wy] = gw(F13_FOYER, x, y);
        return cellI(sim, wx, wy);
      });
      for (const i of cells) saveTile(sim, st, api, i, T_WALL, MK.curtainDown);
      st.doors.push({ cells, until: sim.time + ACT_CD.hold });
      st.cds.set(obj.id, sim.time + ACT_CD.winch);
      sim.events.push({ t: 'boss', what: 'f13_hook_call' });
      return true;
    }
    case 'f13_lever': {
      let n = 0;
      for (const g of st.traps)
        if (g.state === 0 && hypot(g.cx - ox, g.cy - oy) < 14) {
          trapWarn(sim, g, api, 0.5);
          n++;
        }
      if (!n) return false;
      st.cds.set(obj.id, sim.time + TRAP.leverCd);
      sim.events.push({ t: 'clank', x: ox, y: oy });
      return true;
    }
    case 'f13_podium': {
      st.hushUntil = sim.time + ACT_CD.hush;
      st.cds.set(obj.id, sim.time + ACT_CD.baton);
      fx(sim, api, 'f13_hush', ox, oy, 8, 1.2);
      call(sim, 'f13_baton_call', 'ПАУЗА', 'палочка дирижёра — оркестр молчит 8 секунд');
      return true;
    }
    case 'f13_bell': {
      const ev = st.turn;
      if (ev.state === 0) startTurn(sim, st, api);
      else if (ev.state === 1) ev.next = Math.min(ev.next, ev.t + SCENE.warn);
      else return false;
      st.cds.set(obj.id, sim.time + ACT_CD.bell);
      return true;
    }
    case 'f13_stopper': {
      let best: IronRow | null = null;
      let bd = 1e9;
      for (const r of st.iron.rows) {
        const d = Math.abs(r.y + 0.5 - oy);
        if (d < bd) {
          bd = d;
          best = r;
        }
      }
      if (!best) return false;
      best.jamUntil = sim.time + IRON.jam;
      st.cds.set(obj.id, sim.time + ACT_CD.stopper);
      fx(sim, api, 'f13_jam', (BOX.gallery[0] + BOX.gallery[2] + 1) / 2, best.y + 0.5, 6, IRON.jam);
      sim.events.push({ t: 'clank', x: ox, y: oy });
      return true;
    }
  }
  return false;
}

function useLabel(sim: Sim, obj: WorldObj): string | null {
  const st = stateOf(sim);
  if (!ready(sim, st, obj)) return null;
  if (obj.ref === 'f13_spot') {
    const s = spotOf(st, obj);
    return s && sim.time < s.turnUntil ? 'Вернуть софит' : 'Повернуть софит';
  }
  if (obj.ref === 'f13_bell' && st.turn.state === 2) return null;
  return obj.use?.label ?? null;
}

// ---------------------------------------------------------------------------
// Правило этажа.
// ---------------------------------------------------------------------------

function stringsZone(sim: Sim, api: SimApi): void {
  const h = sim.hero;
  const z = sim.zones.find((q) => q.art === 'f13_strings');
  if (z) {
    z.x = h.x;
    z.y = h.y;
  } else api.vfx(sim, { x: h.x, y: h.y, r: 1, life: 1e9, art: 'f13_strings', above: true });
}

registerFloor(13, {
  start(sim, api) {
    API_REF.api = api;
    STATE.delete(sim);
    stateOf(sim);
  },
  step(sim, dt, api) {
    API_REF.api = api;
    const st = stateOf(sim);
    F13_FX.mobs = sim.mobs;
    F13_FX.time = sim.time;
    stringsZone(sim, api);
    stepBeat(sim, st, dt);
    stepPosts(sim, st, api);
    stepSpots(sim, st, api);
    stepLight(sim, st, api, dt);
    stepTraps(sim, st, api, dt);
    stepCuts(sim, st, api, dt);
    stepCloak(sim, st, api, dt);
    stepInter(sim, st, api, dt);
    stepPremiere(sim, st, api, dt);
    stepOverture(sim, st, api, dt);
    stepTurn(sim, st, api, dt);
    stepIron(sim, st, api);
    st.doors = st.doors.filter((d) => {
      if (sim.time < d.until) return true;
      for (const i of d.cells) restoreTile(sim, st, api, i);
      return false;
    });
    st.hpx = sim.hero.x;
    st.hpy = sim.hero.y;
  },
  onUse,
  useLabel,
});

// ---------------------------------------------------------------------------
// Монстры: общее для кукол.
// ---------------------------------------------------------------------------

/** Множитель удара куклы: нити, свет софита, шёпот суфлёра. */
export function dmgK(sim: Sim, m: Mob): number {
  let k = 1;
  const n = m.data.sn ?? 0;
  if (n > 0) k *= stringsLeft(m) === n ? STR.intact : m.data.crawl ? STR.crawlDmg : 1;
  else if (m.data.crawl) k *= STR.crawlDmg;
  if (STATE.get(sim)?.lit) k *= 1.2;
  if ((m.data.buff ?? 0) > sim.time) k *= 1.3;
  return k;
}

function hitHero(sim: Sim, m: Mob, api: SimApi, mult = 1, knock = 4): void {
  api.hurtHero(sim, m.dmg * dmgK(sim, m) * mult, m.x, m.y, knock, m.kind);
}

/** Режимы, общие для кукол: шатается, потерял героя, ждёт звонка, молчит. */
function pre(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): boolean {
  initStrings(m);
  if (m.data.yank) m.data.yank = Math.max(0, m.data.yank - dt);
  const st = STATE.get(sim);
  switch (m.mode) {
    case 'f13_reel':
      m.tele = null;
      m.danger = 0;
      m.vx *= 0.82;
      m.vy *= 0.82;
      if (m.t > STR.reel) api.setMode(m, 'chase');
      return true;
    case 'f13_lost':
      lostStep(sim, m, dt, c, api);
      return true;
    case 'f13_wait':
      // Антракт: курит в кулуарах, пока не прозвенит третий звонок.
      m.tele = null;
      m.danger = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (c.dist < 2.6) api.setMode(m, 'alert');
      return true;
    case 'f13_hush':
      m.tele = null;
      m.danger = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (!st || sim.time >= st.hushUntil) api.setMode(m, 'chase');
      return true;
  }
  if (st && sim.time < st.hushUntil && MUSIC.has(m.kind) && inBox(BOX.pit, m.x, m.y)) {
    m.tele = null;
    m.danger = 0;
    api.setMode(m, 'f13_hush');
    return true;
  }
  return false;
}

/** Удар героя по кукле: из тени ×2, ползущая ×1,5, нити отдёргивают. */
function puppetHit(sim: Sim, m: Mob, hit: { heavy: boolean; ang: number }, api: SimApi): number {
  let k = 1;
  if (m.mode === 'f13_lost' || m.mode === 'sleep' || m.mode === 'f13_wait') {
    k *= 2;
    fx(sim, api, 'f13_backstab', m.x, m.y, 0.9, 0.5);
    if (m.mode !== 'sleep') api.setMode(m, 'alert');
  }
  if (m.data.crawl) k *= STR.crawlHit;
  if (m.mode === 'f13_hush') k *= 1.3;
  if (k <= 1 && !hit.heavy && hung(m) && (m.data.yank ?? 0) <= 0 && m.mode !== 'f13_reel') {
    // Нити дёргают куклу из-под удара.
    m.data.yank = STR.yankCd;
    const mass = api.def(m.kind).mass ?? 1;
    m.kx += (Math.cos(hit.ang) * 5) / Math.sqrt(mass);
    m.ky += (Math.sin(hit.ang) * 5) / Math.sqrt(mass) - 1.5;
    fx(sim, api, 'f13_yank', m.x, m.y, 0.6, 0.35);
    return STR.yank;
  }
  return k;
}

/** Ближний бой: конус движка (`windup`), выпад, отдых. */
function melee(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi, speedK = 1, chase = true): void {
  const def = c.def;
  const h = sim.hero;
  const reach = def.reach + m.r + 0.2;
  switch (m.mode) {
    case 'chase': {
      m.tele = null;
      m.danger = 0;
      if (lostCheck(sim, m, c, api)) return;
      if (c.dist < reach + 0.35 && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
        m.face = Math.atan2(c.dy, c.dx);
        api.setMode(m, 'windup');
        return;
      }
      if (!chase) {
        m.vx *= 0.8;
        m.vy *= 0.8;
        return;
      }
      const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, dx, dy, m.speed * speedK, dt);
      return;
    }
    case 'windup': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      const W = def.windup;
      const to = Math.atan2(c.dy, c.dx);
      if (m.t < W * 0.55) m.face += clamp(angDiff(to, m.face), -3 * dt, 3 * dt);
      if (m.t > W - 0.22) m.danger = reach;
      if (m.t >= W) {
        const off = Math.abs(angDiff(to, m.face));
        if (canHurt(sim) && c.dist < reach + h.r && off < 0.6 + Math.atan(h.r / Math.max(0.1, c.dist)))
          hitHero(sim, m, api);
        m.vx += Math.cos(m.face) * 2.5;
        m.vy += Math.sin(m.face) * 2.5;
        m.danger = 0;
        m.cd = def.rest + sim.rng() * 0.4;
        api.setMode(m, 'recover');
      }
      return;
    }
    case 'recover':
      recoverStep(m, api, 0.45);
      return;
    default:
      api.setMode(m, 'chase');
  }
}

const brain = (id: string, b: Brain) => registerBrain(id, b);

// ---- Рыцарь-марионетка -----------------------------------------------------

brain('f13_knight', {
  step(sim, m, dt, c, api) {
    if (pre(sim, m, dt, c, api)) return;
    melee(sim, m, dt, c, api);
  },
  onHit: (sim, m, hit, api) => puppetHit(sim, m, hit, api),
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Щелкунчик-гвардеец: челюсти и марш-таран -----------------------------

export const NUT = { aim: 1.0, len: 7, speed: 9, run: 0.75, w: 0.55, cd: 6, dizzy: 1.3 };

brain('f13_nutcracker', {
  step(sim, m, dt, c, api) {
    if (pre(sim, m, dt, c, api)) return;
    const h = sim.hero;
    m.data.chargeCd = (m.data.chargeCd ?? 2) - dt;
    switch (m.mode) {
      case 'chase':
        if (
          !m.data.crawl &&
          m.data.chargeCd <= 0 &&
          c.dist > 3 &&
          c.dist < NUT.len &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.face = m.dir;
          api.setMode(m, 'aim');
          return;
        }
        melee(sim, m, dt, c, api);
        return;
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < NUT.aim * 0.5) m.dir += clamp(angDiff(Math.atan2(c.dy, c.dx), m.dir), -1.5 * dt, 1.5 * dt);
        m.face = m.dir;
        const len = Math.min(NUT.len, clearDist(sim, api, m.x, m.y, m.dir, NUT.len));
        m.tele = { shape: 'line', r: len, w: NUT.w, ang: m.dir, k: clamp(m.t / NUT.aim, 0, 1) };
        if (m.t > NUT.aim - 0.24) m.danger = 1.2;
        if (m.t >= NUT.aim) {
          m.tele = null;
          m.data.hitDone = 0;
          m.bounce = true;
          api.setMode(m, 'f13_charge');
        }
        return;
      }
      case 'f13_charge': {
        m.vx = Math.cos(m.dir) * NUT.speed;
        m.vy = Math.sin(m.dir) * NUT.speed;
        m.danger = 1.2;
        if (!m.data.hitDone && c.dist < m.r + h.r + 0.25 && canHurt(sim)) {
          m.data.hitDone = 1;
          hitHero(sim, m, api, 1.3, 7);
        }
        if (m.t >= NUT.run) {
          m.bounce = false;
          m.danger = 0;
          m.data.chargeCd = NUT.cd;
          m.cd = 0.6;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        m.danger = 0;
        if (m.t > NUT.dizzy) api.setMode(m, 'chase');
        return;
      default:
        melee(sim, m, dt, c, api);
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'f13_charge') return;
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    m.data.chargeCd = NUT.cd;
    sim.events.push({ t: 'shake', k: 0.25 });
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    api.setMode(m, 'dizzy');
  },
  onHit: (sim, m, hit, api) => puppetHit(sim, m, hit, api),
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Барабанщик: кольцо на сильную долю -------------------------------------

export const DRUM = { near: 2.5, far: 4.5, w: 0.6, see: 6.5, home: 7 };

brain('f13_drummer', {
  step(sim, m, dt, c, api) {
    if (pre(sim, m, dt, c, api)) return;
    const st = STATE.get(sim);
    if (m.mode === 'f13_drum') {
      m.vx *= 0.7;
      m.vy *= 0.7;
      const T = m.data.drumLen ?? 0.75;
      if (m.t > T - 0.2) m.danger = (m.data.drumR ?? 2.5) + DRUM.w;
      if (m.t >= T) {
        m.danger = 0;
        m.cd = 0.5;
        api.setMode(m, 'recover');
      }
      return;
    }
    if (
      st &&
      m.mode === 'chase' &&
      st.onBeat &&
      st.beatN % 4 === 3 &&
      c.dist < DRUM.see &&
      !m.data.crawl &&
      !heroDown(sim)
    ) {
      const r = m.data.alt ? DRUM.far : DRUM.near;
      m.data.alt = m.data.alt ? 0 : 1;
      api.strike(sim, {
        shape: 'ring',
        x: m.x,
        y: m.y,
        r,
        w: DRUM.w,
        warn: st.beatLen,
        dmg: m.dmg * dmgK(sim, m),
        knock: 4,
        art: 'f13_drum',
        from: m.id,
      });
      m.data.drumLen = st.beatLen;
      m.data.drumR = r;
      api.setMode(m, 'f13_drum');
      return;
    }
    // Далеко от ямы не уходит.
    if (m.mode === 'chase' && hypot(m.x - m.hx, m.y - m.hy) > DRUM.home && c.dist > 2) {
      const d = hypot(m.hx - m.x, m.hy - m.y) || 1;
      api.steer(sim, m, (m.hx - m.x) / d, (m.hy - m.y) / d, m.speed, dt);
      return;
    }
    melee(sim, m, dt, c, api);
  },
  onHit: (sim, m, hit, api) => puppetHit(sim, m, hit, api),
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Скрипач: ноты дугой (режут и чужие нити) -------------------------------

export const FIDDLE = { aim: 0.7, keep: [3.6, 6.2], cd: 2.6, n: 3, spread: 0.32 };

function rangedStep(
  sim: Sim,
  m: Mob,
  dt: number,
  c: BrainCtx,
  api: SimApi,
  o: { aim: number; keep: number[]; cd: number; n: number; spread: number; line: number },
): boolean {
  const h = sim.hero;
  m.data.shotCd = (m.data.shotCd ?? 1 + sim.rng()) - dt;
  if (m.mode === 'aim') {
    m.vx *= 0.6;
    m.vy *= 0.6;
    const ang = Math.atan2(c.dy, c.dx);
    m.face = ang;
    m.tele = { shape: 'line', r: o.line, w: 0.22, ang, k: clamp(m.t / o.aim, 0, 1) };
    if (m.t >= o.aim) {
      m.tele = null;
      const spec = c.def.shot!;
      api.shoot(sim, m, ang, { ...spec, n: o.n, spread: o.spread, dmg: spec.dmg * dmgK(sim, m) });
      m.data.shotCd = o.cd + sim.rng() * 0.6;
      api.setMode(m, 'recover');
    }
    return true;
  }
  if (m.mode !== 'chase') return false;
  m.tele = null;
  m.danger = 0;
  if (lostCheck(sim, m, c, api)) return true;
  if (c.dist < 1.4 && m.cd <= 0) return false;
  const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
  if (see && m.data.shotCd <= 0 && c.dist < 9) {
    api.setMode(m, 'aim');
    return true;
  }
  if (c.dist < o.keep[0]) {
    const away = api.flowDir(sim, m.x, m.y, true) ?? [-c.dx / (c.dist || 1), -c.dy / (c.dist || 1)];
    api.steer(sim, m, away[0], away[1], m.speed, dt);
  } else if (c.dist > o.keep[1] || !see) {
    const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
    api.steer(sim, m, dx, dy, m.speed, dt);
  } else {
    const s = m.id % 2 ? 1 : -1;
    api.steer(sim, m, (-c.dy / c.dist) * s, (c.dx / c.dist) * s, m.speed * 0.5, dt);
  }
  return true;
}

brain('f13_fiddler', {
  step(sim, m, dt, c, api) {
    if (pre(sim, m, dt, c, api)) return;
    if (rangedStep(sim, m, dt, c, api, { ...FIDDLE, line: 6 })) return;
    melee(sim, m, dt, c, api);
  },
  onHit: (sim, m, hit, api) => puppetHit(sim, m, hit, api),
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Балерина-волчок -------------------------------------------------------

export const SPIN = { plie: 0.6, dur: 2.5, r: 1.3, tick: 0.45, speed: 3.6, dizzy: 1.8, mult: 0.75 };

brain('f13_ballerina', {
  step(sim, m, dt, c, api) {
    if (pre(sim, m, dt, c, api)) return;
    const h = sim.hero;
    switch (m.mode) {
      case 'chase':
        if (lostCheck(sim, m, c, api)) return;
        if (c.dist < 2.4 && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'f13_plie');
          return;
        }
        melee(sim, m, dt, c, api, 1, true);
        return;
      case 'f13_plie':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = { shape: 'circle', r: SPIN.r, k: clamp(m.t / SPIN.plie, 0, 1) };
        if (m.t > SPIN.plie - 0.22) m.danger = SPIN.r;
        if (m.t >= SPIN.plie) {
          m.data.tick = 0;
          api.setMode(m, 'f13_spin');
        }
        return;
      case 'f13_spin': {
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, SPIN.speed, dt);
        m.face += 14 * dt;
        m.tele = { shape: 'circle', r: SPIN.r, k: 1 };
        m.danger = SPIN.r;
        m.data.tick = (m.data.tick ?? 0) - dt;
        if (m.data.tick <= 0 && c.dist < SPIN.r + h.r && canHurt(sim)) {
          hitHero(sim, m, api, SPIN.mult, 3);
          m.data.tick = SPIN.tick;
        }
        if (m.t >= SPIN.dur) {
          m.tele = null;
          m.danger = 0;
          api.setMode(m, 'dizzy');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        m.danger = 0;
        if (m.t > SPIN.dizzy) {
          m.cd = 1.2;
          api.setMode(m, 'chase');
        }
        return;
      default:
        melee(sim, m, dt, c, api);
    }
  },
  onHit(sim, m, hit, api) {
    if (m.mode === 'f13_spin') return 0;
    return puppetHit(sim, m, hit, api);
  },
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Арлекин: ныряет в люк и выскакивает за спиной -------------------------

export const HARL = { dive: 0.45, pop: 0.75, r: 1.1, cd: 4.5, see: 6, mult: 1.1 };

brain('f13_harlequin', {
  step(sim, m, dt, c, api) {
    if (pre(sim, m, dt, c, api)) return;
    const h = sim.hero;
    m.data.diveCd = (m.data.diveCd ?? 1.5) - dt;
    switch (m.mode) {
      case 'chase':
        if (lostCheck(sim, m, c, api)) return;
        if (
          c.dist > 1.6 &&
          c.dist < HARL.see &&
          m.data.diveCd <= 0 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          // Ныряет в ближний люк, если он рядом, иначе — в свой лючок.
          const g = trapNear(sim, m.x, m.y, 3);
          if (g && g.state !== 2) {
            m.data.hx2 = g.cx;
            m.data.hy2 = g.cy;
          } else {
            m.data.hx2 = m.x;
            m.data.hy2 = m.y;
          }
          fx(sim, api, 'f13_hatch', m.data.hx2, m.data.hy2, 0.7, 0.8);
          api.setMode(m, 'f13_dive');
          return;
        }
        melee(sim, m, dt, c, api);
        return;
      case 'f13_dive': {
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t > 0.25) m.data.ghost = 1;
        if (m.t >= HARL.dive) {
          // За спиной героя: против того, куда он смотрит.
          const back = h.face + Math.PI;
          let tx = h.x + Math.cos(back) * 1.3;
          let ty = h.y + Math.sin(back) * 1.3;
          if (api.solidTile(sim, Math.floor(tx), Math.floor(ty)) || !api.lineOfSight(sim, h.x, h.y, tx, ty)) {
            const p = floorNear(sim, api, h.x, h.y, 1, 1.6);
            if (p) [tx, ty] = p;
            else [tx, ty] = [m.x, m.y];
          }
          m.x = tx;
          m.y = ty;
          m.vx = 0;
          m.vy = 0;
          m.face = Math.atan2(h.y - ty, h.x - tx);
          api.strike(sim, {
            shape: 'circle',
            x: tx,
            y: ty,
            r: HARL.r,
            warn: HARL.pop,
            dmg: m.dmg * dmgK(sim, m) * HARL.mult,
            knock: 5,
            art: 'f13_pop',
            from: m.id,
          });
          fx(sim, api, 'f13_hatch', tx, ty, 0.7, HARL.pop + 0.3);
          api.setMode(m, 'f13_pop');
        }
        return;
      }
      case 'f13_pop':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (m.t > HARL.pop - 0.22) m.danger = HARL.r + 0.1;
        if (m.t >= HARL.pop) {
          m.data.ghost = 0;
          m.danger = 0;
          m.data.diveCd = HARL.cd;
          m.cd = 0.5;
          api.setMode(m, 'recover');
        }
        return;
      default:
        melee(sim, m, dt, c, api);
    }
  },
  onHit: (sim, m, hit, api) => puppetHit(sim, m, hit, api),
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Суфлёр: будка, шёпот соседям, листки роли ------------------------------

export const PROMPT = { near: 3.2, buffR: 6, buffCd: 3, buff: 3.4, aim: 0.55, cd: 2.2, peekMax: 3 };

brain('f13_prompter', {
  step(sim, m, dt, c, api) {
    initStrings(m);
    const h = sim.hero;
    m.vx = 0;
    m.vy = 0;
    m.x = m.hx;
    m.y = m.hy;
    m.danger = 0;
    if (m.mode === 'f13_hide') {
      m.data.ghost = 1;
      m.tele = null;
      if ((c.dist > PROMPT.near && m.t > 0.8) || m.t > PROMPT.peekMax) api.setMode(m, 'f13_peek');
      return;
    }
    m.data.ghost = 0;
    m.face = Math.atan2(c.dy, c.dx);
    if (m.mode === 'aim') {
      m.tele = { shape: 'line', r: 6, w: 0.2, ang: m.face, k: clamp(m.t / PROMPT.aim, 0, 1) };
      if (m.t >= PROMPT.aim) {
        m.tele = null;
        const spec = c.def.shot!;
        api.shoot(sim, m, m.face, { ...spec, dmg: spec.dmg * dmgK(sim, m) });
        m.data.shotCd = PROMPT.cd;
        api.setMode(m, 'f13_peek');
      }
      return;
    }
    if (m.mode !== 'f13_peek') {
      api.setMode(m, 'f13_peek');
      return;
    }
    m.tele = null;
    if (c.dist < PROMPT.near && m.t > 1.6) {
      fx(sim, api, 'f13_hatch', m.x, m.y, 0.5, 0.5);
      api.setMode(m, 'f13_hide');
      return;
    }
    m.data.buffCd = (m.data.buffCd ?? 0.5) - dt;
    if (m.data.buffCd <= 0) {
      m.data.buffCd = PROMPT.buffCd;
      for (const o of sim.mobs) {
        if (o === m || o.mode === 'dying' || api.def(o.kind).boss) continue;
        if (hypot(o.x - m.x, o.y - m.y) > PROMPT.buffR) continue;
        o.data.buff = sim.time + PROMPT.buff;
        fx(sim, api, 'f13_whisper', m.x, m.y, 0.5, 1.1, { tx: o.x, ty: o.y });
      }
    }
    m.data.shotCd = (m.data.shotCd ?? 1) - dt;
    if (m.data.shotCd <= 0 && c.dist < 9 && !heroDown(sim) && api.lineOfSight(sim, m.x, m.y, h.x, h.y))
      api.setMode(m, 'aim');
  },
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Маски Комедии и Трагедии ----------------------------------------------

export const MASK = { heal: 0.25, healAt: 0.6, healCd: 5, broken: 4, revive: 0.5, keep: [3.4, 5.4] };

function partner(sim: Sim, m: Mob): Mob | null {
  const id = m.data.pair;
  if (id === undefined || id < 0) return null;
  return sim.mobs.find((x) => x.id === id && x.mode !== 'dying') ?? null;
}

function maskPre(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): boolean {
  if (pre(sim, m, dt, c, api)) return true;
  const p = partner(sim, m);
  if (m.mode === 'f13_broken') {
    m.data.ghost = 1;
    m.tele = null;
    m.danger = 0;
    m.vx *= 0.85;
    m.vy *= 0.85;
    if (!p || p.mode === 'f13_broken') {
      fx(sim, api, 'f13_shatter', m.x, m.y, 0.9, 0.9);
      sim.events.push({ t: 'boss', what: 'f13_crystal_stone' });
      envKill(sim, api, m);
      return true;
    }
    if (m.t > MASK.broken) {
      m.data.ghost = 0;
      m.hp = m.maxHp * MASK.revive;
      fx(sim, api, 'f13_mend', m.x, m.y, 0.9, 0.8);
      api.setMode(m, 'chase');
    }
    return true;
  }
  if (m.mode === 'f13_heal') {
    m.vx *= 0.7;
    m.vy *= 0.7;
    m.tele = null;
    if (m.t >= 1) {
      if (p && p.mode !== 'f13_broken') p.hp = Math.min(p.maxHp, p.hp + p.maxHp * MASK.heal);
      api.setMode(m, 'chase');
    }
    return true;
  }
  m.data.healCd = (m.data.healCd ?? 2) - dt;
  if (
    p &&
    m.mode === 'chase' &&
    p.mode !== 'f13_broken' &&
    p.hp < p.maxHp * MASK.healAt &&
    m.data.healCd <= 0 &&
    hypot(p.x - m.x, p.y - m.y) < 7
  ) {
    m.data.healCd = MASK.healCd;
    api.setMode(m, 'f13_heal');
    fx(sim, api, 'f13_healbeam', m.x, m.y, 0.6, 1, { to: p.id, from: m.id });
    return true;
  }
  return false;
}

function maskHit(sim: Sim, m: Mob, hit: { dmg: number; heavy: boolean; ang: number }, api: SimApi): number {
  const k = puppetHit(sim, m, hit, api);
  const p = partner(sim, m);
  if (p && p.mode !== 'f13_broken' && hit.dmg * k >= m.hp) {
    // Пара цела: маска трескается и падает, а не умирает.
    m.tele = null;
    m.danger = 0;
    api.setMode(m, 'f13_broken');
    sim.events.push({ t: 'boss', what: 'f13_crystal_stone' });
    return Math.max(0.0001, (m.hp - 1) / hit.dmg);
  }
  return k;
}

brain('f13_comedy', {
  step(sim, m, dt, c, api) {
    if (m.data.pair === undefined) {
      const t = api.spawnMob(sim, 'f13_tragedy', m.x + 0.9, m.y + 0.2, {
        mode: m.mode === 'sleep' || m.mode === 'f13_wait' ? m.mode : 'chase',
      });
      t.data.pair = m.id;
      m.data.pair = t.id;
    }
    if (maskPre(sim, m, dt, c, api)) return;
    melee(sim, m, dt, c, api);
  },
  onHit: (sim, m, hit, api) => maskHit(sim, m, hit, api),
  onDeath: (sim, m) => postDead(sim, m),
});

brain('f13_tragedy', {
  step(sim, m, dt, c, api) {
    if (m.data.pair === undefined) m.data.pair = -1;
    if (maskPre(sim, m, dt, c, api)) return;
    if (rangedStep(sim, m, dt, c, api, { aim: 0.6, keep: MASK.keep, cd: 2.4, n: 1, spread: 0, line: 6 })) return;
    melee(sim, m, dt, c, api);
  },
  onHit: (sim, m, hit, api) => maskHit(sim, m, hit, api),
});

// ---- Тень-актёр: только в луче софита ---------------------------------------

brain('f13_shade', {
  step(sim, m, dt, c, api) {
    initStrings(m);
    const st = STATE.get(sim);
    const h = sim.hero;
    if (m.data.beam === undefined && st) {
      let bi = -1;
      let bd = 1e9;
      st.spots.forEach((s, i) => {
        const d = hypot(s.x - m.x, s.y - m.y);
        if (d < bd) {
          bd = d;
          bi = i;
        }
      });
      m.data.beam = bi;
    }
    const sp = st?.spots[m.data.beam ?? -1];
    if (!sp || !sp.on) {
      m.data.ghost = 1;
      m.data.vis = 0;
      m.tele = null;
      m.danger = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.mode !== 'chase') api.setMode(m, 'chase');
      return;
    }
    const inB = hypot(m.x - sp.x, m.y - sp.y) < SPOT.r + 0.3;
    m.data.ghost = inB ? 0 : 1;
    m.data.vis = inB ? 1 : 0.25;
    if (m.mode === 'windup' && !inB) {
      m.tele = null;
      m.danger = 0;
      api.setMode(m, 'chase');
      return;
    }
    if (m.mode === 'windup' || m.mode === 'recover') {
      melee(sim, m, dt, c, api);
      return;
    }
    if (m.mode !== 'chase') {
      api.setMode(m, 'chase');
      return;
    }
    m.tele = null;
    m.danger = 0;
    const dh = hypot(h.x - sp.x, h.y - sp.y);
    let tx = dh < SPOT.r + 1.2 && !heroDown(sim) ? h.x : sp.x;
    let ty = dh < SPOT.r + 1.2 && !heroDown(sim) ? h.y : sp.y;
    const dd = hypot(tx - sp.x, ty - sp.y);
    if (dd > SPOT.r - 0.2) {
      tx = sp.x + ((tx - sp.x) / dd) * (SPOT.r - 0.2);
      ty = sp.y + ((ty - sp.y) / dd) * (SPOT.r - 0.2);
    }
    const reach = c.def.reach + m.r + 0.2;
    if (inB && c.dist < reach + 0.35 && m.cd <= 0 && dh < SPOT.r + 1.2 && canHurt(sim)) {
      m.face = Math.atan2(c.dy, c.dx);
      api.setMode(m, 'windup');
      return;
    }
    const d = hypot(tx - m.x, ty - m.y);
    if (d > 0.3) api.steer(sim, m, (tx - m.x) / d, (ty - m.y) / d, m.speed, dt);
    else {
      m.vx *= 0.8;
      m.vy *= 0.8;
    }
  },
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Паук-кукловод: спускается на нити, вяжет нити куклам ------------------

export const SPIDER = { drop: 0.9, r: 0.95, hang: 3.5, climb: 0.6, dropCd: 2.8, retieCd: 9, tie: 1.2, see: 7 };

brain('f13_spider', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    if (m.data.sn === undefined) {
      m.data.sn = 0;
      m.data.cut = 0;
    }
    m.data.dropCd = (m.data.dropCd ?? 1) - dt;
    m.data.retieCd = (m.data.retieCd ?? 4) - dt;
    switch (m.mode) {
      case 'f13_up': {
        m.data.ghost = 1;
        m.data.sn = 0;
        m.tele = null;
        m.danger = 0;
        if (m.data.retieCd <= 0) {
          let best: Mob | null = null;
          let bd = 8;
          for (const o of sim.mobs) {
            if (o === m || o.mode === 'dying' || !(o.data.cut ?? 0) || !STRINGS[o.kind]) continue;
            const d = hypot(o.x - m.x, o.y - m.y);
            if (d < bd) {
              bd = d;
              best = o;
            }
          }
          if (best) {
            const d = hypot(best.x - m.x, best.y - m.y);
            if (d < 0.7) {
              m.data.tie = best.id;
              api.setMode(m, 'f13_retie');
              return;
            }
            api.steer(sim, m, (best.x - m.x) / d, (best.y - m.y) / d, m.speed * 1.2, dt);
            return;
          }
        }
        if (!heroDown(sim) && c.dist < SPIDER.see && m.data.dropCd <= 0) {
          const tx = h.x + h.vx * 0.3;
          const ty = h.y + h.vy * 0.3;
          if (!api.solidTile(sim, Math.floor(tx), Math.floor(ty))) {
            m.data.tx = tx;
            m.data.ty = ty;
            api.setMode(m, 'f13_drop');
            return;
          }
        }
        const tx = c.dist < 12 ? h.x : m.hx;
        const ty = c.dist < 12 ? h.y - 1.5 : m.hy;
        const d = hypot(tx - m.x, ty - m.y);
        if (d > 0.5) api.steer(sim, m, (tx - m.x) / d, (ty - m.y) / d, m.speed, dt);
        return;
      }
      case 'f13_drop': {
        m.data.ghost = 1;
        const tx = m.data.tx;
        const ty = m.data.ty;
        const k = Math.min(1, dt * 8);
        m.x += (tx - m.x) * k;
        m.y += (ty - m.y) * k;
        m.vx = 0;
        m.vy = 0;
        m.tele = { shape: 'circle', r: SPIDER.r, k: clamp(m.t / SPIDER.drop, 0, 1), x: tx, y: ty };
        if (m.t > SPIDER.drop - 0.22) m.danger = SPIDER.r;
        if (m.t >= SPIDER.drop) {
          m.x = tx;
          m.y = ty;
          m.tele = null;
          m.danger = 0;
          m.data.ghost = 0;
          if (canHurt(sim) && hypot(h.x - tx, h.y - ty) < SPIDER.r + h.r) hitHero(sim, m, api, 1, 3);
          m.data.sn = 1;
          m.data.cut = 0;
          m.data.hangT = 0;
          fx(sim, api, 'f13_dust', tx, ty, 0.8, 0.5);
          api.setMode(m, 'f13_hang');
        }
        return;
      }
      case 'f13_retie': {
        m.data.ghost = 1;
        m.vx *= 0.7;
        m.vy *= 0.7;
        const o = sim.mobs.find((x) => x.id === m.data.tie && x.mode !== 'dying');
        if (o) {
          m.x += (o.x - m.x) * Math.min(1, dt * 6);
          m.y += (o.y - 0.3 - m.y) * Math.min(1, dt * 6);
        }
        if (m.t >= SPIDER.tie) {
          if (o) {
            retie(o);
            fx(sim, api, 'f13_retie', o.x, o.y, 0.8, 0.8);
          }
          m.data.retieCd = SPIDER.retieCd;
          api.setMode(m, 'f13_up');
        }
        return;
      }
      case 'f13_climb':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = null;
        m.danger = 0;
        if (m.t > 0.25) {
          m.data.ghost = 1;
          m.data.sn = 0;
        }
        if (m.t >= SPIDER.climb) {
          m.data.dropCd = SPIDER.dropCd;
          api.setMode(m, 'f13_up');
        }
        return;
      case 'f13_fallen':
        m.data.ghost = 0;
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        m.danger = 0;
        if (m.t > 1) {
          m.data.fallen = 1;
          m.data.crawl = 1;
          api.setMode(m, 'chase');
        }
        return;
      case 'f13_hang':
      case 'chase':
      case 'windup':
      case 'recover': {
        if (m.data.fallen) {
          melee(sim, m, dt, c, api, 0.8);
          return;
        }
        if ((m.data.sn ?? 0) !== 1) {
          api.setMode(m, 'f13_up');
          return;
        }
        m.data.ghost = 0;
        m.data.hangT = (m.data.hangT ?? 0) + dt;
        if (m.mode === 'windup' || m.mode === 'recover') {
          melee(sim, m, dt, c, api, 0, false);
          return;
        }
        if (m.mode === 'chase') {
          api.setMode(m, 'f13_hang');
          return;
        }
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(c.dy, c.dx);
        if (m.data.hangT > SPIDER.hang) {
          api.setMode(m, 'f13_climb');
          return;
        }
        const reach = c.def.reach + m.r + 0.2;
        if (c.dist < reach + 0.35 && m.cd <= 0 && !heroDown(sim)) api.setMode(m, 'windup');
        return;
      }
      default:
        if (m.data.fallen) melee(sim, m, dt, c, api, 0.8);
        else api.setMode(m, 'f13_up');
    }
  },
  onHit(sim, m, hit, api) {
    if (m.data.fallen) return STR.crawlHit * (m.mode === 'f13_lost' ? 2 : 1);
    void sim;
    void hit;
    void api;
    return 1;
  },
  onDeath: (sim, m) => postDead(sim, m),
});

// ---- Кассир: удирает с выручкой --------------------------------------------

brain('f13_cashier', {
  step(sim, m, dt, c, api) {
    m.tele = null;
    m.danger = 0;
    const away = api.flowDir(sim, m.x, m.y, true);
    const d = away ?? [-c.dx / (c.dist || 1), -c.dy / (c.dist || 1)];
    api.steer(sim, m, d[0], d[1], m.speed, dt);
    m.data.run = (m.data.run ?? 0) + dt;
    if (m.data.run > 25 && c.dist > 5) {
      api.setMode(m, 'escape');
      m.hp = 0;
    }
  },
});

// ---------------------------------------------------------------------------
// Кукловод: спектакль в четыре акта.
//  I   «Рыцарский роман» — исполин на четырёх нитях к ваге; зубцы замка
//      держат копьё; все нити срезаны — вага горит 6 с.
//  II  «Буря» — волны рядами (проём, тень корабля или рывок сквозь гребень),
//      молнии; Кукловод спускается к кораблю — окно 4,5 с.
//  III «Звёздная ночь» — звёзды-маятники, луна-софит: в луне иглы, вне —
//      удары «по памяти»; две нити звёзд — он оступается, окно 6 с.
//  IV  «Оборванные нити» — ходит сам: вага (конус + выпад), аркан, сетка
//      нитей по арене; после сетки окно ×1,6, в остальное время ×0,35.
// Между актами падает занавес (камера к сцене), звонок, арена
// переписывается `setTile`.
// ---------------------------------------------------------------------------

export const BOSS = {
  notches: [0.75, 0.5, 0.25],
  trans: 3.2,
  swap: 1.3,
  wake: 2.4,
  // I
  hangUp: 2.6,
  dip: 2,
  dipK: 1.2,
  open: 6,
  openK: 1.5,
  rebuild: 2.5,
  lance: { aim: 1.0, len: 8, w: 0.6 },
  shield: { aim: 0.8, r: 2.7, arc: 1.75 },
  charge: { aim: 1.0, speed: 8, run: 0.8, w: 0.8 },
  knightEvery: 20,
  // II
  wave: { every: 5.5, swell: 1.2, speed: 5, gapW: 4, share: 0.14, band: 0.45 },
  bolt: { every: 3.4, warn: 1.0, r: 1.2, share: 0.1 },
  lower: { every: 12, open: 4.5, k: 1.4 },
  // III
  star: { L: 9.5, amp: 0.95, period: 4.6, r: 0.9, share: 0.1, need: 2 },
  moon: { r: 2.6 },
  needle: { every: 1.6, aim: 0.45, dmg: 0.6 },
  memory: { every: 2.6, warn: 1.1, r: 1.5, share: 0.11, lag: 1 },
  // IV
  cone: { warn: 0.7, r: 2.2, arc: 2.1 },
  thrust: { warn: 0.6, r: 4, w: 0.5 },
  grid: { every: 13, cast: 1.2, warn: 1.2, w: 0.35, share: 0.16, window: 3.2, k: 1.6 },
  snare: { cd: 9, aim: 0.8, len: 7, w: 0.4 },
  outK: 0.35,
  walk: 2.6,
  turn: 4,
};

const ACT_NAMES = [
  ['АКТ I — «РЫЦАРСКИЙ РОМАН»', 'режь нити исполина — вага загорится'],
  ['АКТ II — «БУРЯ»', 'волны рядами: проём, тень корабля или рывок сквозь гребень'],
  ['АКТ III — «ЗВЁЗДНАЯ НОЧЬ»', 'в луне он видит тебя; срежь две нити звёзд'],
  ['АКТ IV — «ОБОРВАННЫЕ НИТИ»', 'он спустился сам; после сетки нитей вага горит'],
];

interface Wave {
  y: number;
  dir: number;
  gaps: number[];
  t: number;
  hit: boolean;
}

interface Star {
  px: number;
  py: number;
  L: number;
  phase: number;
  cut: number;
  x: number;
  y: number;
  hitCd: number;
}

interface BState {
  act: number;
  trans: number;
  swapped: boolean;
  next: number;
  giant: number;
  openFrom: number;
  openUntil: number;
  openK: number;
  dipUntil: number;
  knightT: number;
  waveT: number;
  waveDir: number;
  boltT: number;
  lowerT: number;
  /** Нос или корма корабля, куда спускается Кукловод во «Буре». */
  lowX: number;
  waves: Wave[];
  stars: Star[];
  starsBack: number;
  moonT: number;
  needleT: number;
  memT: number;
  hist: [number, number, number][];
  gridT: number;
  snareCd: number;
  atkCd: number;
  saved: Map<number, { tile: number; mark: number }>;
}

const BSTATE = new WeakMap<Sim, BState>();

function newBState(): BState {
  return {
    act: 0,
    trans: 0,
    swapped: true,
    next: 0,
    giant: 0,
    openFrom: 0,
    openUntil: 0,
    openK: 1,
    dipUntil: 0,
    knightT: 12,
    waveT: 2,
    waveDir: 1,
    boltT: 3,
    lowerT: 7,
    lowX: ACX,
    waves: [],
    stars: [],
    starsBack: 0,
    moonT: 0,
    needleT: 2,
    memT: 2,
    hist: [],
    gridT: 6,
    snareCd: 4,
    atkCd: 1,
    saved: new Map(),
  };
}

function bstate(sim: Sim): BState {
  let s = BSTATE.get(sim);
  if (!s) {
    s = newBState();
    BSTATE.set(sim, s);
  }
  return s;
}

/** Сцена Кукловода — для тестов и стенда. */
export const f13Boss = (sim: Sim) => BSTATE.get(sim) ?? null;

const ARENA = BOX.arena;
const ACX = (ARENA[0] + ARENA[2] + 1) / 2;
const ACY = (ARENA[1] + ARENA[3]) / 2;
/** Ряды арены, которые переписывают акты (без рампы). */
const AY0 = ARENA[1];
const AY1 = ARENA[3] - 1;

const ACT_FLOOR = [MK.actCastle, MK.actSea, MK.actNight, MK.actGrid];

/** Стены акта: картонные зубцы замка, корпус корабля. */
function actWalls(act: number): Set<number> {
  const s = new Set<number>();
  const add = (x0: number, x1: number, y: number) => {
    for (let x = x0; x <= x1; x++) s.add(y * 64 + x);
  };
  if (act === 0) {
    for (const y of [7, 17]) {
      add(16, 18, y);
      add(24, 26, y);
      add(37, 39, y);
      add(45, 47, y);
    }
    add(19, 20, 12);
    add(43, 44, 12);
  } else if (act === 1) {
    add(27, 36, 10);
    add(26, 37, 11);
  }
  return s;
}

/** Борт корабля «Бури»: ряды 10–11, x 26–37. Нос и корма — точки спуска. */
const SHIP = { west: 24.6, east: 39.4, y: 10.6 };

const ACT_WALL_MARK = [MK.setCastle, MK.actShip, MK.actCloud, MK.actGrid];

function arenaLook(sim: Sim, s: BState, api: SimApi, act: number): void {
  const walls = actWalls(act);
  const w = sim.world.w;
  for (let y = AY0; y <= AY1; y++)
    for (let x = ARENA[0]; x <= ARENA[2]; x++) {
      const i = y * w + x;
      if (!s.saved.has(i)) s.saved.set(i, { tile: sim.tiles[i], mark: sim.world.mark[i] });
      if (walls.has(y * 64 + x)) api.setTile(sim, x, y, T_WALL, ACT_WALL_MARK[act]);
      else api.setTile(sim, x, y, T_FLOOR, ACT_FLOOR[act]);
    }
}

function restoreArena(sim: Sim, s: BState | undefined, api: SimApi): void {
  if (!s) return;
  const w = sim.world.w;
  for (const [i, v] of s.saved) api.setTile(sim, i % w, Math.floor(i / w), v.tile, v.mark, null);
  s.saved.clear();
}

const lordOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f13boss' && x.mode !== 'dying') ?? null;
const giantOf = (sim: Sim, s: BState) => sim.mobs.find((x) => x.id === s.giant && x.mode !== 'dying') ?? null;

const clampArena = (x: number, y: number): [number, number] => [
  clamp(x, ARENA[0] + 1.5, ARENA[2] - 0.5),
  clamp(y, ARENA[1] + 1.5, ARENA[3] - 1.5),
];

/** Сменить акт: убрать прошлое, переписать арену, расставить своё. */
function enterAct(sim: Sim, s: BState, api: SimApi, lead: Mob, act: number): void {
  // Куклы прошлого акта уходят со сцены.
  for (const m of sim.mobs) {
    if (m === lead || m.mode === 'dying') continue;
    if (!api.inArena(sim, m.x, m.y)) continue;
    if (m.kind === 'f13_giant') m.hp = 0;
    else if (!api.def(m.kind).boss) envKill(sim, api, m);
  }
  sim.mobs = sim.mobs.filter((m) => !(m.kind === 'f13_giant' && m.hp <= 0));
  s.waves = [];
  s.stars = [];
  api.light(sim, 'f13moon', null);
  s.act = act;
  s.openUntil = 0;
  s.openFrom = 0;
  s.dipUntil = 0;
  arenaLook(sim, s, api, act);
  lead.data.act = act;
  if (act === 0) {
    // Исполина ставит шаг сценария: движок при начале боя убирает с арены
    // всех, кроме самого босса.
    s.giant = 0;
    lead.x = ACX;
    lead.y = ACY + 3.5 - BOSS.hangUp;
    s.knightT = 12;
  } else if (act === 1) {
    s.waveT = 2.5;
    s.boltT = 3.5;
    s.lowerT = 7;
    lead.x = ACX;
    lead.y = 9;
  } else if (act === 2) {
    const py = ARENA[1] + 0.3;
    s.stars = [ACX - 12, ACX, ACX + 12].map((px, i) => ({
      px,
      py,
      L: BOSS.star.L,
      phase: (i * TAU) / 3,
      cut: 0,
      x: px,
      y: py + BOSS.star.L,
      hitCd: 0,
    }));
    s.moonT = 0;
    s.needleT = 2.5;
    s.memT = 2;
    lead.x = ACX;
    lead.y = ACY - 4;
  } else {
    s.gridT = 6;
    s.snareCd = 4;
    s.atkCd = 1;
    lead.x = ACX;
    lead.y = ACY - 3;
    api.setMode(lead, 'chase');
  }
}

function startTrans(sim: Sim, s: BState, api: SimApi, lead: Mob, next: number): void {
  s.trans = BOSS.trans;
  s.swapped = false;
  s.next = next;
  sim.strikes = [];
  sim.shots = [];
  lead.tele = null;
  lead.danger = 0;
  lead.data.ghost = 1;
  api.setMode(lead, 'f13_trans');
  const g = giantOf(sim, s);
  if (g) {
    g.tele = null;
    g.danger = 0;
  }
  api.camera(sim, ACX, ACY, BOSS.trans);
  fx(sim, api, 'f13_curtainfall', ACX, ACY, 21, BOSS.trans, { act: next }, true);
  sim.events.push({ t: 'boss', what: 'f13_bell_call', text: ACT_NAMES[next][0], sub: ACT_NAMES[next][1] });
}

/** Открыто ли окно (вага горит). */
const isOpen = (sim: Sim, s: BState) => sim.time >= s.openFrom && sim.time < s.openUntil;

// ---- Исполин ----------------------------------------------------------------

CUT_HOOK.giant = (sim, g, api) => {
  const s = bstate(sim);
  if (stringsLeft(g) === 0) {
    s.openFrom = sim.time;
    s.openUntil = sim.time + BOSS.open;
    s.openK = BOSS.openK;
    g.tele = null;
    g.danger = 0;
    api.setMode(g, 'f13_slump');
    sim.events.push({ t: 'shake', k: 0.4 });
    sim.events.push({
      t: 'boss',
      what: 'f13_slump_wall',
      text: 'ВАГА ГОРИТ',
      sub: 'исполин рухнул — бей Кукловода',
    });
  } else s.dipUntil = Math.max(s.dipUntil, sim.time + BOSS.dip);
};

function giantStep(sim: Sim, g: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const s = bstate(sim);
  const h = sim.hero;
  g.tele = null;
  if (s.trans > 0 || s.act !== 0 || heroDown(sim)) {
    g.vx *= 0.8;
    g.vy *= 0.8;
    g.danger = 0;
    return;
  }
  s.atkCd -= dt;
  switch (g.mode) {
    case 'f13_stand':
      g.vx *= 0.8;
      g.vy *= 0.8;
      if (g.t > 1.2) api.setMode(g, 'chase');
      return;
    case 'chase': {
      g.danger = 0;
      const [dx, dy] = api.chaseDir(sim, g, h.x, h.y);
      if (c.dist > 1.8) api.steer(sim, g, dx, dy, g.speed, dt);
      else {
        g.vx *= 0.8;
        g.vy *= 0.8;
      }
      g.face += clamp(angDiff(Math.atan2(c.dy, c.dx), g.face), -2.5 * dt, 2.5 * dt);
      if (s.atkCd > 0) return;
      const see = api.lineOfSight(sim, g.x, g.y, h.x, h.y);
      if (c.dist < BOSS.shield.r + 0.4) api.setMode(g, 'f13_shield');
      else if (see && c.dist < BOSS.lance.len) {
        g.dir = Math.atan2(c.dy, c.dx);
        api.setMode(g, c.dist > 3.5 && sim.rng() < 0.4 ? 'f13_charge_aim' : 'f13_lance');
      }
      return;
    }
    case 'f13_lance': {
      g.vx *= 0.6;
      g.vy *= 0.6;
      if (g.t < BOSS.lance.aim * 0.5) g.dir += clamp(angDiff(Math.atan2(c.dy, c.dx), g.dir), -1.2 * dt, 1.2 * dt);
      g.face = g.dir;
      const len = Math.min(BOSS.lance.len, clearDist(sim, api, g.x, g.y, g.dir, BOSS.lance.len));
      g.tele = { shape: 'line', r: len, w: BOSS.lance.w, ang: g.dir, k: clamp(g.t / BOSS.lance.aim, 0, 1) };
      if (g.t > BOSS.lance.aim - 0.24) g.danger = 1.5;
      if (g.t >= BOSS.lance.aim) {
        const ux = Math.cos(g.dir);
        const uy = Math.sin(g.dir);
        const al = (h.x - g.x) * ux + (h.y - g.y) * uy;
        const ac = Math.abs(-(h.x - g.x) * uy + (h.y - g.y) * ux);
        if (canHurt(sim) && al > -0.3 && al < len + h.r && ac < BOSS.lance.w + h.r)
          api.hurtHero(sim, g.dmg, g.x, g.y, 6, g.kind);
        fx(sim, api, 'f13_lancehit', g.x + ux * len, g.y + uy * len, 0.8, 0.4, { ang: g.dir, len });
        g.danger = 0;
        s.atkCd = 1.5;
        api.setMode(g, 'recover');
      }
      return;
    }
    case 'f13_shield': {
      g.vx *= 0.6;
      g.vy *= 0.6;
      const to = Math.atan2(c.dy, c.dx);
      if (g.t < BOSS.shield.aim * 0.5) g.face += clamp(angDiff(to, g.face), -2 * dt, 2 * dt);
      g.tele = { shape: 'cone', r: BOSS.shield.r, arc: BOSS.shield.arc, ang: g.face, k: clamp(g.t / BOSS.shield.aim, 0, 1) };
      if (g.t > BOSS.shield.aim - 0.24) g.danger = BOSS.shield.r;
      if (g.t >= BOSS.shield.aim) {
        const off = Math.abs(angDiff(to, g.face));
        if (canHurt(sim) && c.dist < BOSS.shield.r + h.r && off < BOSS.shield.arc / 2 + 0.2)
          api.hurtHero(sim, g.dmg * 0.9, g.x, g.y, 8, g.kind);
        g.danger = 0;
        s.atkCd = 1.3;
        api.setMode(g, 'recover');
      }
      return;
    }
    case 'f13_charge_aim': {
      g.vx *= 0.6;
      g.vy *= 0.6;
      if (g.t < BOSS.charge.aim * 0.5) g.dir += clamp(angDiff(Math.atan2(c.dy, c.dx), g.dir), -1.2 * dt, 1.2 * dt);
      g.face = g.dir;
      const len = Math.min(BOSS.charge.speed * BOSS.charge.run, clearDist(sim, api, g.x, g.y, g.dir, 7));
      g.tele = { shape: 'line', r: len, w: BOSS.charge.w, ang: g.dir, k: clamp(g.t / BOSS.charge.aim, 0, 1) };
      if (g.t > BOSS.charge.aim - 0.24) g.danger = 1.6;
      if (g.t >= BOSS.charge.aim) {
        g.data.hitDone = 0;
        api.setMode(g, 'f13_charge');
      }
      return;
    }
    case 'f13_charge': {
      g.vx = Math.cos(g.dir) * BOSS.charge.speed;
      g.vy = Math.sin(g.dir) * BOSS.charge.speed;
      g.danger = 1.6;
      if (!g.data.hitDone && c.dist < g.r + h.r + 0.2 && canHurt(sim)) {
        g.data.hitDone = 1;
        api.hurtHero(sim, g.dmg * 1.1, g.x, g.y, 9, g.kind);
      }
      if (g.t >= BOSS.charge.run || api.solidTile(sim, Math.floor(g.x + Math.cos(g.dir) * (g.r + 0.3)), Math.floor(g.y + Math.sin(g.dir) * (g.r + 0.3)))) {
        g.vx = 0;
        g.vy = 0;
        g.danger = 0;
        s.atkCd = 1.6;
        sim.events.push({ t: 'shake', k: 0.25 });
        api.setMode(g, 'recover');
      }
      return;
    }
    case 'f13_slump':
      g.vx *= 0.8;
      g.vy *= 0.8;
      g.danger = 0;
      if (sim.time >= s.openUntil) api.setMode(g, 'f13_rebuild');
      return;
    case 'f13_rebuild':
      g.vx *= 0.8;
      g.vy *= 0.8;
      if (g.t >= BOSS.rebuild) {
        g.data.cut = 0;
        g.data.cutAt = 0;
        s.atkCd = 1.2;
        api.setMode(g, 'chase');
      }
      return;
    case 'recover':
      g.vx *= 0.8;
      g.vy *= 0.8;
      g.danger = 0;
      if (g.t > 0.8) api.setMode(g, 'chase');
      return;
    default:
      api.setMode(g, 'chase');
  }
}

registerBrain('f13_giant', {
  raw: true,
  step: giantStep,
  onHit: () => 0,
});

// ---- Сам Кукловод -----------------------------------------------------------

/** Плавно к точке (висит над сценой — без стен). */
function glide(m: Mob, tx: number, ty: number, dt: number, speed: number): void {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = hypot(dx, dy);
  if (d < 0.05) {
    m.vx = 0;
    m.vy = 0;
    return;
  }
  const v = Math.min(speed, d * 3);
  m.vx = (dx / d) * v;
  m.vy = (dy / d) * v;
}

function lordStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const s = bstate(sim);
  const h = sim.hero;
  m.data.vNoTele = 1;
  m.data.open = isOpen(sim, s) ? 1 : 0;
  F13_FX.vaga.x = m.x;
  F13_FX.vaga.y = m.y;
  if (m.mode === 'roar') {
    m.data.ghost = 1;
    m.data.lift = 1;
    m.vx = 0;
    m.vy = 0;
    if (m.t >= BOSS.wake) api.setMode(m, 'f13_hang');
    return;
  }
  if (s.trans > 0 || m.mode === 'f13_trans') {
    m.data.ghost = 1;
    m.tele = null;
    m.danger = 0;
    m.vx *= 0.8;
    m.vy *= 0.8;
    m.data.lift = Math.min(1, (m.data.lift ?? 0) + dt);
    if (s.trans <= 0) api.setMode(m, s.act === 3 ? 'chase' : 'f13_hang');
    return;
  }
  const open = isOpen(sim, s);
  const liftTo = (v: number) => {
    m.data.lift = (m.data.lift ?? 1) + clamp(v - (m.data.lift ?? 1), -dt * 2.5, dt * 2.5);
  };
  if (s.act === 0) {
    const g = giantOf(sim, s);
    const dip = sim.time < s.dipUntil;
    if (g) {
      const [tx, ty] = clampArena(g.x, g.y - BOSS.hangUp);
      if (!open) glide(m, tx, ty, dt, 3);
      else {
        m.vx *= 0.8;
        m.vy *= 0.8;
      }
      VAGA.set(g, { x: m.x, y: m.y });
    }
    m.face = Math.PI / 2;
    m.data.ghost = open || dip ? 0 : 1;
    liftTo(open ? 0 : dip ? 0.45 : 1);
    s.knightT -= dt;
    if (s.knightT <= 0 && !open) {
      s.knightT = BOSS.knightEvery;
      const n = sim.mobs.filter((x) => x.kind === 'f13_knight' && x.mode !== 'dying' && api.inArena(sim, x.x, x.y)).length;
      const p = n < 2 ? floorNear(sim, api, h.x, h.y, 3, 6, ARENA) : null;
      if (p) {
        api.spawnMob(sim, 'f13_knight', p[0], p[1], { mode: 'drop' });
        fx(sim, api, 'f13_retie', p[0], p[1], 0.8, 0.8);
      }
    }
    return;
  }
  if (s.act === 1) {
    // Висит над кораблём; раз в 12 с спускается к нему — окно.
    s.lowerT -= dt;
    if (s.lowerT <= 0 && !open) {
      s.openFrom = sim.time + 0.8;
      s.openUntil = s.openFrom + BOSS.lower.open;
      s.openK = BOSS.lower.k;
      s.lowerT = BOSS.lower.every + BOSS.lower.open;
      // К носу или корме — ближе к герою: сквозь борт он не пройдёт.
      s.lowX = h.x < ACX ? SHIP.west : SHIP.east;
      sim.events.push({ t: 'boss', what: 'f13_lower_call', text: 'КУКЛОВОД НА ПАЛУБЕ', sub: 'он спустился к кораблю — бей' });
    }
    const low = sim.time < s.openUntil;
    if (low) glide(m, s.lowX, SHIP.y, dt, 6);
    else glide(m, ACX + Math.sin(sim.time * 0.5) * 3, 8.6, dt, 3);
    m.face = Math.PI / 2;
    m.data.ghost = open ? 0 : 1;
    liftTo(open ? 0 : low ? 0.3 : 1);
    return;
  }
  if (s.act === 2) {
    if (!open) {
      const [tx, ty] = clampArena(h.x, h.y - 4);
      glide(m, tx, Math.max(ty, ARENA[1] + 2.5), dt, 2.2);
    } else {
      m.vx *= 0.8;
      m.vy *= 0.8;
    }
    m.data.ghost = open ? 0 : 1;
    liftTo(open ? 0 : 1);
    if (m.mode === 'f13_needle') {
      const ang = Math.atan2(h.y - m.y, h.x - m.x);
      m.face = ang;
      m.tele = { shape: 'line', r: 9, w: 0.2, ang, k: clamp(m.t / BOSS.needle.aim, 0, 1) };
      if (m.t >= BOSS.needle.aim) {
        m.tele = null;
        api.shoot(sim, m, ang, { speed: 8, r: 0.2, life: 2.6, dmg: BOSS.needle.dmg, art: 'f13_needle', n: 3, spread: 0.24 });
        api.setMode(m, 'f13_hang');
      }
      return;
    }
    m.face = Math.PI / 2;
    return;
  }
  // IV — ходит сам.
  m.data.ghost = 0;
  liftTo(0);
  stepFinale(sim, s, m, dt, c, api);
}

function faceTo(m: Mob, ang: number, dt: number, rate = BOSS.turn): void {
  m.face += clamp(angDiff(ang, m.face), -rate * dt, rate * dt);
}

function stepFinale(sim: Sim, s: BState, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const to = Math.atan2(c.dy, c.dx);
  s.atkCd -= dt;
  s.snareCd -= dt;
  s.gridT -= dt;
  switch (m.mode) {
    case 'chase': {
      m.tele = null;
      m.danger = 0;
      if (heroDown(sim)) {
        m.vx *= 0.8;
        m.vy *= 0.8;
        return;
      }
      if (s.gridT <= 0 && c.dist < 16) {
        api.setMode(m, 'f13_grid');
        return;
      }
      if (c.dist < BOSS.cone.r + 0.6 && s.atkCd <= 0) {
        m.dir = to;
        api.setMode(m, 'f13_cut1');
        return;
      }
      if (s.snareCd <= 0 && c.dist > 3 && c.dist < BOSS.snare.len && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
        m.dir = to;
        api.setMode(m, 'f13_snare');
        return;
      }
      // Идёт лицом по ходу, поворачивает плавно.
      const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
      const want = Math.atan2(dy, dx);
      faceTo(m, want, dt);
      const along = Math.max(0.2, Math.cos(angDiff(want, m.face)));
      const sp = c.dist > 1.6 ? BOSS.walk * along : 0;
      m.vx += (Math.cos(m.face) * sp - m.vx) * Math.min(1, dt * 6);
      m.vy += (Math.sin(m.face) * sp - m.vy) * Math.min(1, dt * 6);
      return;
    }
    case 'f13_cut1': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < BOSS.cone.warn * 0.5) faceTo(m, to, dt, 3);
      m.dir = m.face;
      m.tele = { shape: 'cone', r: BOSS.cone.r, arc: BOSS.cone.arc, ang: m.face, k: clamp(m.t / BOSS.cone.warn, 0, 1) };
      if (m.t > BOSS.cone.warn - 0.24) m.danger = BOSS.cone.r;
      if (m.t >= BOSS.cone.warn) {
        if (canHurt(sim) && c.dist < BOSS.cone.r + h.r && Math.abs(angDiff(to, m.face)) < BOSS.cone.arc / 2 + 0.15)
          api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
        m.danger = 0;
        api.setMode(m, 'f13_cut2');
      }
      return;
    }
    case 'f13_cut2': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < 0.25) faceTo(m, to, dt, 4);
      const len = Math.min(BOSS.thrust.r, clearDist(sim, api, m.x, m.y, m.face, BOSS.thrust.r));
      m.tele = { shape: 'line', r: len, w: BOSS.thrust.w, ang: m.face, k: clamp(m.t / BOSS.thrust.warn, 0, 1) };
      if (m.t > BOSS.thrust.warn - 0.24) m.danger = 1.4;
      if (m.t >= BOSS.thrust.warn) {
        const ux = Math.cos(m.face);
        const uy = Math.sin(m.face);
        const al = (h.x - m.x) * ux + (h.y - m.y) * uy;
        const ac = Math.abs(-(h.x - m.x) * uy + (h.y - m.y) * ux);
        if (canHurt(sim) && al > -0.3 && al < len + h.r && ac < BOSS.thrust.w + h.r)
          api.hurtHero(sim, m.dmg * 1.1, m.x, m.y, 7, m.kind);
        m.vx = ux * 5;
        m.vy = uy * 5;
        m.tele = null;
        m.danger = 0;
        s.atkCd = 1.6;
        api.setMode(m, 'recover');
      }
      return;
    }
    case 'f13_snare': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < BOSS.snare.aim * 0.5) faceTo(m, to, dt, 2.5);
      const len = Math.min(BOSS.snare.len, clearDist(sim, api, m.x, m.y, m.face, BOSS.snare.len));
      m.tele = { shape: 'line', r: len, w: BOSS.snare.w, ang: m.face, k: clamp(m.t / BOSS.snare.aim, 0, 1) };
      if (m.t > BOSS.snare.aim - 0.24) m.danger = 1;
      if (m.t >= BOSS.snare.aim) {
        const ux = Math.cos(m.face);
        const uy = Math.sin(m.face);
        const al = (h.x - m.x) * ux + (h.y - m.y) * uy;
        const ac = Math.abs(-(h.x - m.x) * uy + (h.y - m.y) * ux);
        m.tele = null;
        m.danger = 0;
        s.snareCd = BOSS.snare.cd;
        if (canHurt(sim) && al > 0 && al < len + h.r && ac < BOSS.snare.w + h.r) {
          api.hurtHero(sim, rawShare(sim, 0.04), m.x, m.y, 0, m.kind);
          api.pullHero(sim, m.x + ux * 1.3, m.y + uy * 1.3, { speed: 11, max: 1 });
          fx(sim, api, 'f13_snareline', m.x, m.y, 0.5, 0.6, { tx: h.x, ty: h.y }, true);
          sim.events.push({ t: 'boss', what: 'f13_hook_call' });
          s.atkCd = 0;
        }
        api.setMode(m, 'recover');
      }
      return;
    }
    case 'f13_grid': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.tele = null;
      m.danger = 0;
      if (m.t >= BOSS.grid.cast && !m.data.gridOut) {
        m.data.gridOut = 1;
        castGrid(sim, s, api);
      }
      if (m.t >= BOSS.grid.cast + BOSS.grid.warn) {
        m.data.gridOut = 0;
        s.gridT = BOSS.grid.every;
        api.setMode(m, 'f13_spent');
      }
      return;
    }
    case 'f13_spent':
      m.vx *= 0.8;
      m.vy *= 0.8;
      m.tele = null;
      m.danger = 0;
      if (sim.time >= s.openUntil) {
        s.atkCd = 0.6;
        api.setMode(m, 'chase');
      }
      return;
    case 'recover':
      m.vx *= 0.8;
      m.vy *= 0.8;
      m.tele = null;
      m.danger = 0;
      if (m.t > 0.7) api.setMode(m, 'chase');
      return;
    default:
      api.setMode(m, 'chase');
  }
}

/** Сетка нитей: четыре ряда и четыре столбца с проёмами. */
function castGrid(sim: Sim, s: BState, api: SimApi): void {
  const G = BOSS.grid;
  const dmg = rawShare(sim, G.share);
  const x0 = ARENA[0];
  const x1 = ARENA[2] + 1;
  const y0 = ARENA[1];
  const y1 = ARENA[3];
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const len = hypot(bx - ax, by - ay);
    if (len < 0.5) return;
    api.strike(sim, {
      shape: 'line',
      x: ax,
      y: ay,
      r: len,
      w: G.w,
      ang: Math.atan2(by - ay, bx - ax),
      warn: G.warn,
      dmg,
      knock: 3,
      art: 'f13_gridline',
      above: true,
    });
  };
  for (const y of [y0 + 3.5, y0 + 7.5, y0 + 12.5, y0 + 16.5]) {
    const gx = x0 + 4 + sim.rng() * (x1 - x0 - 8);
    line(x0, y, gx - 1.6, y);
    line(gx + 1.6, y, x1, y);
  }
  for (const x of [x0 + 5.5, x0 + 13.5, x1 - 13.5, x1 - 5.5]) {
    const gy = y0 + 3 + sim.rng() * (y1 - y0 - 6);
    line(x, y0, x, gy - 1.6);
    line(x, gy + 1.6, x, y1);
  }
  s.openFrom = sim.time + G.warn;
  s.openUntil = s.openFrom + G.window;
  s.openK = G.k;
  sim.events.push({ t: 'boss', what: 'f13_grid_call', text: 'СЕТКА НИТЕЙ', sub: 'встань в клетку — потом вага горит' });
}

// ---- Сценарий боя: волны, звёзды, луна, переходы ---------------------------

function shipShelter(sim: Sim, x: number, y: number, dir: number): boolean {
  for (let k = 1; k <= 3; k++) {
    const cy = Math.floor(y - dir * k);
    if (sim.tiles[cy * sim.world.w + Math.floor(x)] === T_WALL) return true;
  }
  return false;
}

function stepStorm(sim: Sim, s: BState, dt: number, api: SimApi): void {
  const h = sim.hero;
  const W = BOSS.wave;
  s.waveT -= dt;
  if (s.waveT <= 0) {
    s.waveT = W.every;
    const dir = s.waveDir;
    s.waveDir = -dir;
    const g0 = ARENA[0] + 3 + sim.rng() * 14;
    const g1 = g0 + 10 + sim.rng() * 10;
    const w: Wave = { y: dir > 0 ? ARENA[1] : ARENA[3] + 1, dir, gaps: [g0, Math.min(ARENA[2] - 2, g1)], t: 0, hit: false };
    s.waves.push(w);
    sim.events.push({ t: 'boss', what: 'f13_wave_call' });
  }
  F13_FX.waves.length = 0;
  s.waves = s.waves.filter((w) => {
    w.t += dt;
    const run = w.t - W.swell;
    const y = (w.dir > 0 ? ARENA[1] : ARENA[3] + 1) + w.dir * Math.max(0, run) * W.speed;
    w.y = y;
    F13_FX.waves.push({ y, dir: w.dir, gaps: w.gaps, gapW: W.gapW, t: w.t });
    if (run < 0) return true;
    if (!w.hit && Math.abs(y - h.y) < W.band + h.r) {
      w.hit = true;
      const inGap = w.gaps.some((gx) => Math.abs(h.x - gx) < W.gapW / 2);
      if (!inGap && !shipShelter(sim, h.x, h.y, w.dir) && canHurt(sim)) {
        api.hurtHero(sim, rawShare(sim, W.share), h.x, h.y - w.dir, 6);
        fx(sim, api, 'f13_splash', h.x, h.y, 1.2, 0.6);
      }
    }
    return y > ARENA[1] - 1 && y < ARENA[3] + 2;
  });
  s.boltT -= dt;
  if (s.boltT <= 0 && !heroDown(sim)) {
    s.boltT = BOSS.bolt.every;
    api.strike(sim, {
      shape: 'circle',
      x: h.x + h.vx * 0.3,
      y: h.y + h.vy * 0.3,
      r: BOSS.bolt.r,
      warn: BOSS.bolt.warn,
      dmg: rawShare(sim, BOSS.bolt.share),
      knock: 3,
      art: 'f13_bolt',
      above: true,
    });
  }
}

function stepNight(sim: Sim, s: BState, dt: number, api: SimApi, lead: Mob): void {
  const h = sim.hero;
  const S = BOSS.star;
  const w = (TAU / S.period) * sim.time;
  // Звёзды-маятники.
  F13_FX.stars.length = 0;
  for (const st of s.stars) {
    const th = S.amp * Math.sin(w + st.phase);
    st.x = st.px + Math.sin(th) * st.L;
    st.y = st.py + Math.cos(th) * st.L;
    st.hitCd = Math.max(0, st.hitCd - dt);
    F13_FX.stars.push({ px: st.px, py: st.py, x: st.x, y: st.y, cut: st.cut, L: st.L });
    if (st.cut) continue;
    if (st.hitCd <= 0 && hypot(h.x - st.x, h.y - st.y) < S.r + h.r && canHurt(sim)) {
      st.hitCd = 0.9;
      api.hurtHero(sim, rawShare(sim, S.share), st.x, st.y, 5);
    }
  }
  // Нити звёзд режут тем же взмахом и рывком.
  const st = STATE.get(sim);
  const cutStar = (k: number) => {
    const t = s.stars[k];
    if (t.cut) return;
    t.cut = 1;
    fx(sim, api, 'f13_snap', t.x, t.y, 0.6, 0.5, { bx: t.px, by: t.py }, true);
    fx(sim, api, 'f13_starfall', t.x, t.y, 1, 1.2);
    sim.events.push({ t: 'boss', what: 'f13_snap_fall' });
  };
  for (const e of sim.events) {
    if (e.t !== 'swing') continue;
    s.stars.forEach((t, k) => {
      if (t.cut) return;
      for (let q = 0.3; q <= 1.001; q += 0.05) {
        const px = t.px + (t.x - t.px) * q;
        const py = t.py + (t.y - t.py) * q;
        if (hypot(px - e.x, py - e.y) > e.reach + 0.15) continue;
        if (Math.abs(angDiff(Math.atan2(py - e.y, px - e.x), e.ang)) <= e.arc / 2 + 0.1) {
          cutStar(k);
          return;
        }
      }
    });
  }
  if (h.mode === 'dash' && st)
    s.stars.forEach((t, k) => {
      if (!t.cut && segCross(st.hpx, st.hpy, h.x, h.y, t.px, t.py, t.x, t.y)) cutStar(k);
    });
  const cut = s.stars.filter((t) => t.cut).length;
  if (cut >= S.need && !isOpen(sim, s) && sim.time >= s.openUntil) {
    s.openFrom = sim.time;
    s.openUntil = sim.time + BOSS.open;
    s.openK = BOSS.openK;
    s.starsBack = s.openUntil;
    sim.events.push({ t: 'shake', k: 0.4 });
    sim.events.push({ t: 'boss', what: 'f13_trip_wall', text: 'КУКЛОВОД ОСТУПИЛСЯ', sub: 'звёзды упали — вага горит' });
  }
  if (s.starsBack && sim.time >= s.starsBack) {
    s.starsBack = 0;
    for (const t of s.stars) t.cut = 0;
  }
  // Луна-софит.
  const mx = ACX + Math.sin(sim.time * 0.23) * 14;
  const my = ACY + Math.sin(sim.time * 0.31 + 1) * 6;
  F13_FX.moon.x = mx;
  F13_FX.moon.y = my;
  F13_FX.moon.r = BOSS.moon.r;
  api.light(sim, 'f13moon', { x: mx, y: my, r: BOSS.moon.r + 1, tint: 'cold' });
  s.hist.push([sim.time, h.x, h.y]);
  while (s.hist.length > 2 && s.hist[1][0] < sim.time - BOSS.memory.lag) s.hist.shift();
  if (isOpen(sim, s) || heroDown(sim)) return;
  const inMoon = hypot(h.x - mx, h.y - my) < BOSS.moon.r;
  if (inMoon) {
    s.needleT -= dt;
    if (s.needleT <= 0 && lead.mode !== 'f13_needle') {
      s.needleT = BOSS.needle.every;
      api.setMode(lead, 'f13_needle');
    }
  } else {
    s.memT -= dt;
    if (s.memT <= 0) {
      s.memT = BOSS.memory.every;
      const [, px, py] = s.hist[0] ?? [0, h.x, h.y];
      api.strike(sim, {
        shape: 'circle',
        x: px,
        y: py,
        r: BOSS.memory.r,
        warn: BOSS.memory.warn,
        dmg: rawShare(sim, BOSS.memory.share),
        knock: 3,
        art: 'f13_memory',
      });
    }
  }
}

registerBrain('f13boss', {
  raw: true,
  step: lordStep,
  onHit(sim, m, hit) {
    const s = bstate(sim);
    if (s.trans > 0) return 0.0001;
    let k = 1;
    if (s.act === 3) k = isOpen(sim, s) ? s.openK : BOSS.outK;
    else if (isOpen(sim, s)) k = s.openK;
    else if (sim.time < s.dipUntil) k = BOSS.dipK;
    if (s.act < 3) {
      const floorHp = BOSS.notches[s.act] * m.maxHp;
      if (m.hp - hit.dmg * k < floorHp) k = Math.max(0.0001, (m.hp - floorHp) / hit.dmg);
    }
    return k;
  },
});

registerBoss('f13boss', {
  start(sim, b, lead, api) {
    API_REF.api = api;
    const old = BSTATE.get(sim);
    restoreArena(sim, old, api);
    const s = newBState();
    BSTATE.set(sim, s);
    b.phase = 0;
    lead.data.vNoTele = 1;
    lead.data.ghost = 1;
    lead.data.lift = 1;
    lead.face = Math.PI / 2;
    enterAct(sim, s, api, lead, 0);
    F13_FX.act = 0;
    api.camera(sim, ACX, ACY, BOSS.wake);
    fx(sim, api, 'f13_curtainrise', ACX, ACY, 21, BOSS.wake, {}, true);
    sim.events.push({ t: 'boss', what: 'f13_bell_call', text: ACT_NAMES[0][0], sub: ACT_NAMES[0][1] });
  },
  step(sim, b, dt, api) {
    API_REF.api = api;
    const lead = lordOf(sim);
    if (!lead) return;
    const s = bstate(sim);
    F13_FX.act = s.act;
    F13_FX.trans = s.trans;
    F13_FX.open = isOpen(sim, s) ? 1 : 0;
    if (s.trans > 0) {
      s.trans -= dt;
      if (!s.swapped && s.trans <= BOSS.trans - BOSS.swap) {
        s.swapped = true;
        enterAct(sim, s, api, lead, s.next);
        b.phase = s.next;
        sim.events.push({ t: 'boss', what: 'f13_scene_wall' });
      }
      if (s.trans <= 0) s.trans = 0;
      return;
    }
    if (s.act < 3 && lead.hp <= BOSS.notches[s.act] * lead.maxHp + 0.5) {
      startTrans(sim, s, api, lead, s.act + 1);
      return;
    }
    if (s.act === 0 && !giantOf(sim, s)) {
      const g = api.spawnMob(sim, 'f13_giant', ACX, ACY + 3.5, { mode: 'f13_stand' });
      g.data.sn = 4;
      g.data.cut = 0;
      g.face = Math.PI / 2;
      s.giant = g.id;
      VAGA.set(g, { x: lead.x, y: lead.y });
    }
    if (s.act === 1) stepStorm(sim, s, dt, api);
    else if (s.act === 2) stepNight(sim, s, dt, api, lead);
  },
  onPartDown(sim, _b, m, api) {
    if (m.kind !== 'f13boss') return true;
    const s = bstate(sim);
    // Нити лопаются, исполин и куклы уходят со сцены.
    sim.mobs = sim.mobs.filter((x) => x.kind !== 'f13_giant');
    for (const x of sim.mobs)
      if (x !== m && x.mode !== 'dying' && api.inArena(sim, x.x, x.y) && !api.def(x.kind).boss) envKill(sim, api, x);
    s.waves = [];
    s.stars = [];
    F13_FX.waves.length = 0;
    F13_FX.stars.length = 0;
    api.light(sim, 'f13moon', null);
    fx(sim, api, 'f13_bow', m.x, m.y, 21, 6.5, { cx: ACX, cy: ACY }, true);
    api.camera(sim, m.x, m.y, 3.5);
    sim.events.push({ t: 'boss', what: 'f13_bow_call', text: 'ПОКЛОН', sub: 'нити лопнули — занавес' });
    return false;
  },
  bar(sim) {
    const lead = lordOf(sim);
    return lead ? Math.max(0, lead.hp) / lead.maxHp : 0;
  },
  notches: () => [...BOSS.notches],
  reset(sim, _b, api) {
    restoreArena(sim, BSTATE.get(sim), api);
    BSTATE.delete(sim);
    api.light(sim, 'f13moon', null);
    F13_FX.waves.length = 0;
    F13_FX.stars.length = 0;
    F13_FX.act = 0;
    F13_FX.trans = 0;
  },
});
