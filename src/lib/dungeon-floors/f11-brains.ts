// Этаж 11 «Небесный архипелаг» — ветер, ИИ монстров, сценарий Древнего
// стража и события районов.
//
// ВЕТЕР (правила этажа, `registerFloor(11)`):
//   • поле ветра по клеткам: постоянные потоки из слоя `WIND_F11_*` (карта),
//     потоки групп (ветряки, заслонки, башня — их крутит сценарий), порывы
//     района (сильнее там, где вокруг небо), поле арены (вихрь, тяга к краю)
//     и короткие удары ветра (крыло гарпии, струя садовника, заслонка);
//   • ветер двигает героя (идёшь по ветру — быстрее, против — медленнее),
//     мобов (лёгких сильнее, тяжёлых — едва), снаряды (прямые сносит,
//     навесные сносит вместе с меткой приземления) и добычу на полу;
//   • КРАЙ: ветер прижимает к краю острова — под ногами наливается круг;
//     налился — «СДУЛО»: 12% здоровья и возврат на последнее твёрдое место.
//     Отойти от края или идти против ветра — круг сходит. Ходячих мобов,
//     прижатых к краю, сдувает в небо (`api.fall`, в зачёт);
//   • ПОРЫВ: за секунду до удара фронт ветра идёт по экрану, вокруг героя
//     стрелки, трава ложится, вертушки раскручиваются. Порыв бьёт только по
//     открытому месту (у края, на мосту) — в саду за изгородью тихо.
//
// Честность: всё, что бьёт, видно заранее — линии прицела (скат, лазер,
// крюк, струя), конус порыва гарпии, кольцо медузы, метка прыжка мха (её
// сносит ветром — метка честно едет вместе с ним), метки молний и ракет.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Sim } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F11_AQUA, F11_CASTLE, F11_GARDEN, F11_MARK } from './f11';
import { WIND_F11_AQUA, WIND_F11_CASTLE, WIND_F11_GARDEN } from './f11-map';

const TAU = Math.PI * 2;
const PI = Math.PI;
const hypot = Math.hypot;
const MK = F11_MARK;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: значениями движок не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_LIFT = 10;
const T_DEEP = 11;
const T_HAZ = 12;

const WIND_LAYER: Record<string, string[]> = {
  [F11_GARDEN]: WIND_F11_GARDEN,
  [F11_AQUA]: WIND_F11_AQUA,
  [F11_CASTLE]: WIND_F11_CASTLE,
};

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > PI) d -= TAU;
  while (d < -PI) d += TAU;
  return d;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Урон, который после брони героя станет долей его здоровья. */
export const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const walkable = (t: number) => t === T_FLOOR || t === T_HAZ || t === T_LIFT || (t >= 3 && t <= 5);

const isDeep = (sim: Sim, x: number, y: number) => tileAt(sim, Math.floor(x), Math.floor(y)) === T_DEEP;

/** Можно ли встать: проходимо и не глубина (пол, вода, лифт). */
const standable = (sim: Sim, x: number, y: number) => walkable(tileAt(sim, Math.floor(x), Math.floor(y)));

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

/** Сколько клеток до стены по направлению (глубина лучу не преграда). */
function wallDist(sim: Sim, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.25; d <= max; d += 0.25) {
    const t = tileAt(sim, Math.floor(x + ux * d), Math.floor(y + uy * d));
    if (t !== T_DEEP && !walkable(t)) return d;
  }
  return max;
}

/** Прямая только по полу (без стен и неба). */
function floorLine(sim: Sim, ax: number, ay: number, bx: number, by: number): boolean {
  const d = hypot(bx - ax, by - ay);
  const n = Math.ceil(d * 3);
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const y = ay + ((by - ay) * i) / n;
    if (!standable(sim, x, y)) return false;
  }
  return true;
}

/** Попал ли удар вплотную: рывок и неуязвимость спасают. */
const canHurt = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

/** Отдых после удара: гасит скорость, потом снова в погоню. */
function recoverStep(m: Mob, api: SimApi, T: number, next = 'chase'): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.t > T) api.setMode(m, next);
}

/** Точка пола рядом с (x, y), на расстоянии r0…r1, ближняя к `want`. */
function spotNear(
  sim: Sim,
  x: number,
  y: number,
  r0: number,
  r1: number,
  want: (px: number, py: number) => number,
  fly = false,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bs = Infinity;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU + sim.rng() * 0.2;
    const r = r0 + sim.rng() * (r1 - r0);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const t = tileAt(sim, Math.floor(px), Math.floor(py));
    if (fly ? t !== T_DEEP && !walkable(t) : !walkable(t)) continue;
    const s = want(px, py) + sim.rng() * 0.4;
    if (s < bs) {
      bs = s;
      best = [Math.floor(px) + 0.5, Math.floor(py) + 0.5];
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Ветер: состояние вылазки.
// ---------------------------------------------------------------------------

/** Направления слоя ветра — как на цифровой клавиатуре (y растёт вниз). */
const DIR: Record<string, number> = {
  '8': -PI / 2,
  '6': 0,
  '2': PI / 2,
  '4': PI,
  '9': -PI / 4,
  '3': PI / 4,
  '1': (3 * PI) / 4,
  '7': (-3 * PI) / 4,
  N: -PI / 2,
  E: 0,
  S: PI / 2,
  W: PI,
};

/** Сила потоков, клеток в секунду: обычный, сильный. */
export const WIND = {
  stream: 2.4,
  strong: 5,
  /** Сила группы по умолчанию (мельничные мосты — поспорить нельзя). */
  mill: 6.4,
  /** С какой силы ветер прижимает к краю. */
  slipMin: 2.8,
  /** Сколько наливается круг: (сила − 1,4) / 2,2 в секунду. */
  slipDiv: 2.2,
};

/** Порывы по районам: пауза, сила, предупреждение, длительность. */
const GUST: Record<string, { every: [number, number]; k: number; warn: number; blow: number }> = {
  [F11_GARDEN]: { every: [13, 17], k: 5, warn: 1.15, blow: 1.4 },
  [F11_AQUA]: { every: [10, 13], k: 5.6, warn: 1.05, blow: 1.5 },
  [F11_CASTLE]: { every: [8.5, 11], k: 6, warn: 1, blow: 1.6 },
};

export interface WindGroup {
  /** Куда дует, рад. */
  dir: number;
  /** Сила сейчас. */
  k: number;
  /** Сила, к которой идёт (включили — плавно разгоняется). */
  to: number;
}

export interface Blast {
  x: number;
  y: number;
  ang: number;
  /** Конус: раствор; линия: 0 и полуширина `w`. */
  arc: number;
  w: number;
  r: number;
  k: number;
  t: number;
  life: number;
}

export interface Tornado {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  from: number;
  tick: number;
  zone: ZoneIn & { id?: number };
}

interface Post {
  id: number;
  x: number;
  y: number;
  kind: 'guard' | 'gardener' | 'moss' | 'sentry' | 'harpy';
  area: string;
  mob: number;
  dead: boolean;
  /** Сад / галерея — событие, к которому относится пост. */
  hall: 'garden' | 'gallery' | 'storm' | 'tower' | null;
}

interface Mill {
  obj: WorldObj;
  /** Какие группы крутит и куда: +1 — по часовой, −1 — против. */
  turns: [number, number][];
  cd: number;
  /** Анимация поворота — для рисовальщика. */
  at: number;
}

export interface F11State {
  w: number;
  h: number;
  /** Постоянный поток клетки. */
  bx: Float32Array;
  by: Float32Array;
  /** Группа клетки, −1 — нет. */
  grp: Int8Array;
  groups: WindGroup[];
  /** Открытость клетки небу, 0…1: по ней бьёт порыв. */
  expo: Float32Array;
  gust: {
    phase: 0 | 1 | 2;
    t: number;
    dir: number;
    k: number;
    warn: number;
    blow: number;
    next: number;
    count: number;
    area: string;
    /** Порыв идёт сам по себе, без района (буря, арена). */
    forced: boolean;
  };
  blasts: Blast[];
  tornados: Tornado[];
  slip: number;
  safe: [number, number];
  safeT: number;
  blown: number;
  /** Порыв уже учил на первом мосту. */
  taught: boolean;
  posts: Post[];
  mills: Mill[];
  arriveT: number;
  /** Сколько сейчас «пустое» время — для порывов без открытого места. */
  zonesOn: boolean;
  zSky: ZoneIn | null;
  zWind: ZoneIn | null;
  zAir: ZoneIn | null;
  hooks: Hook[];
  // События.
  garden: HallState;
  bridge: BridgeState;
  tower: HallState & { dirT: number; turn: number; nests: number[] };
  storm: HallState & { boltT: number; turnT: number };
  gallery: HallState & { valveT: number[] };
  winch: { state: 'down' | 'up' | 'sink'; t: number; cells: number[] };
  saved: Map<number, { tile: number; mark: number }>;
  arena: ArenaState;
  /** Отложенные дела (удар молнии, струя форсунки). */
  later: { t: number; f: () => void }[];
}

interface HallState {
  state: 'idle' | 'on' | 'done';
  t: number;
  paid: boolean;
  cx: number;
  cy: number;
  r: number;
  wave: number;
  mobs: number[];
}

interface BridgeState {
  cells: number[][];
  lipS: number;
  lipN: number;
  x0: number;
  x1: number;
  t: number;
  run: boolean;
  from: 1 | -1;
  announced: boolean;
  harpies: boolean;
  /** Плита k: 0 — внизу, 1 — встаёт, 2 — стоит, 3 — трещит. */
  up: number[];
}

export interface ArenaState {
  /** 0 — нет боя; 1 — лёгкий кружащий ветер; 2 — вихрь; 3 — тишина; 4 — к краю. */
  mode: number;
  cx: number;
  cy: number;
  k: number;
  crumble: number;
  crumbleT: number;
  ring: number[];
  broken: number[];
  /** Порыв к краю (фаза падения): 0 — нет, 1 — идёт фронт, 2 — бьёт. */
  gust: number;
  gustT: number;
  /** Фаза боя — для рисовальщика (пар, красный свет, трещины). */
  phase: number;
}

interface Hook {
  id: number;
  from: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  back: boolean;
  zone: ZoneIn;
}

const STATE = new WeakMap<Sim, F11State>();

/** Состояние этажа вылазки (для рисовальщика — `paintSim()`). */
export const f11State = (sim: Sim | null): F11State | null => (sim ? (STATE.get(sim) ?? null) : null);

/** Свет, вспышки и прочий общий визуал кадра (не состояние мира). */
export const F11_FX = {
  /** Время последней молнии (секунды `performance`). */
  bolt: 0,
};

function hall(cx: number, cy: number, r: number): HallState {
  return { state: 'idle', t: 0, paid: false, cx, cy, r, wave: 0, mobs: [] };
}

/** Собрать поле ветра, посты и события из карты. */
function scan(sim: Sim): F11State {
  const wd = sim.world;
  const W = wd.w;
  const H = wd.h;
  const bx = new Float32Array(W * H);
  const by = new Float32Array(W * H);
  const grp = new Int8Array(W * H).fill(-1);
  const expo = new Float32Array(W * H);
  const groups: WindGroup[] = [];
  for (let i = 0; i < 10; i++) groups.push({ dir: 0, k: 0, to: 0 });
  // Мельничные мосты: сильные потоки, поперёк — не пройти.
  groups[0] = { dir: 0, k: WIND.mill, to: WIND.mill };
  groups[1] = { dir: PI, k: WIND.mill, to: WIND.mill };
  groups[2] = { dir: -PI / 2, k: WIND.mill, to: WIND.mill };
  // Площадь башни: тихо кружит, пока не началось.
  groups[3] = { dir: 0, k: 1.3, to: 1.3 };
  // Заслонки галереи: выключены.
  groups[4] = { dir: PI, k: 0, to: 0 };
  groups[5] = { dir: PI, k: 0, to: 0 };
  for (const b of wd.bands) {
    const rows = WIND_LAYER[b.def.id];
    if (!rows) continue;
    for (let ly = 0; ly < b.h; ly++) {
      const row = rows[ly] ?? '';
      for (let x = 0; x < W; x++) {
        const c = row[x] ?? '.';
        if (c === '.') continue;
        const i = (b.top + ly) * W + x;
        if (c >= 'a' && c <= 'j') {
          grp[i] = c.charCodeAt(0) - 97;
          continue;
        }
        const a = DIR[c];
        if (a === undefined) continue;
        const k = c >= 'A' && c <= 'Z' ? WIND.strong : WIND.stream;
        bx[i] = Math.cos(a) * k;
        by[i] = Math.sin(a) * k;
      }
    }
  }
  // Открытость: сколько неба вокруг, минус заслон стен.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = sim.tiles[i];
      if (t === T_DEEP) {
        expo[i] = 1;
        continue;
      }
      if (!walkable(t)) continue;
      let deep = 0;
      let wall = 0;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const d = dx * dx + dy * dy;
          if (d > 9) continue;
          const v = tileAt(sim, x + dx, y + dy);
          if (v === T_DEEP) deep += d <= 2 ? 1.4 : 1;
          else if (!walkable(v) && d <= 4) wall += 1;
        }
      expo[i] = clamp(deep / 8 - wall * 0.09, 0, 1);
    }
  const lift = wd.objs.find((o) => o.kind === 'lift');
  const st: F11State = {
    w: W,
    h: H,
    bx,
    by,
    grp,
    groups,
    expo,
    gust: {
      phase: 0,
      t: 0,
      dir: 0,
      k: 0,
      warn: 1,
      blow: 1.4,
      next: 9,
      count: 0,
      area: F11_GARDEN,
      forced: false,
    },
    blasts: [],
    tornados: [],
    slip: 0,
    safe: [sim.hero.x, sim.hero.y],
    safeT: 0,
    blown: 0,
    taught: false,
    posts: [],
    mills: [],
    arriveT: 20,
    zonesOn: false,
    zSky: null,
    zWind: null,
    zAir: null,
    hooks: [],
    garden: hall(0, 0, 0),
    bridge: {
      cells: [],
      lipS: 0,
      lipN: 0,
      x0: 0,
      x1: 0,
      t: 0,
      run: false,
      from: 1,
      announced: false,
      harpies: false,
      up: [],
    },
    tower: { ...hall(0, 0, 0), dirT: 0, turn: 0, nests: [] },
    storm: { ...hall(0, 0, 0), boltT: 0, turnT: 0 },
    gallery: { ...hall(0, 0, 0), valveT: [0, 0] },
    winch: { state: 'down', t: 0, cells: [] },
    saved: new Map(),
    arena: {
      mode: 0,
      cx: 0,
      cy: 0,
      k: 0,
      crumble: 0,
      crumbleT: 0,
      ring: [],
      broken: [],
      gust: 0,
      gustT: 0,
      phase: 0,
    },
    later: [],
  };
  if (lift) st.safe = [lift.x + 0.5, lift.y + 1.5];
  scanPosts(sim, st);
  scanHalls(sim, st);
  postHalls(st);
  return st;
}

/** Состояние этажа; нет — собрать (вылазка могла начаться до правил). */
function stateOf(sim: Sim): F11State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

// ---------------------------------------------------------------------------
// Поле ветра.
// ---------------------------------------------------------------------------

const out2: [number, number] = [0, 0];

/** Огибающая порыва: разгон 0,2 с, держит, стихает за 0,35 с. */
function gustEnv(g: F11State['gust']): number {
  if (g.phase !== 2) return 0;
  const t = g.t;
  if (t < 0.2) return t / 0.2;
  if (t > g.blow - 0.35) return Math.max(0, (g.blow - t) / 0.35);
  return 1;
}

/**
 * Ветер в точке, клеток в секунду. Пишет в `out` (или в общий кортеж) и
 * возвращает его: поле читают десятки раз за шаг — без мусора.
 */
export function windAt(
  st: F11State,
  x: number,
  y: number,
  out: [number, number] = out2,
  noGust = false,
): [number, number] {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let wx = 0;
  let wy = 0;
  if (cx >= 0 && cy >= 0 && cx < st.w && cy < st.h) {
    const i = cy * st.w + cx;
    wx = st.bx[i];
    wy = st.by[i];
    const gi = st.grp[i];
    if (gi >= 0) {
      const g = st.groups[gi];
      wx += Math.cos(g.dir) * g.k;
      wy += Math.sin(g.dir) * g.k;
    }
    if (!noGust && st.gust.phase === 2) {
      const k = st.gust.k * gustEnv(st.gust) * (st.gust.forced ? Math.max(0.55, st.expo[i]) : st.expo[i]);
      wx += Math.cos(st.gust.dir) * k;
      wy += Math.sin(st.gust.dir) * k;
    }
  }
  // Арена: вихрь или тяга к краю.
  const a = st.arena;
  if (a.mode && a.k > 0) {
    const dx = x - a.cx;
    const dy = y - a.cy;
    const d = hypot(dx, dy) || 1;
    if (a.mode === 1 || a.mode === 2) {
      // Против часовой стрелки: касательная (−dy, dx) / d.
      const f = a.k * clamp((d - 1.8) / 2.5, 0, 1);
      wx += (dy / d) * f;
      wy += (-dx / d) * f;
    } else if (a.mode === 4) {
      const f = a.k * clamp((d - 1.5) / 3, 0, 1);
      wx += (dx / d) * f;
      wy += (dy / d) * f;
    }
  }
  // Удары ветра: крыло гарпии, струя, заслонка.
  for (const b of st.blasts) {
    const dx = x - b.x;
    const dy = y - b.y;
    const d = hypot(dx, dy);
    if (d > b.r) continue;
    const env = b.t < 0.08 ? b.t / 0.08 : Math.max(0, 1 - (b.t - 0.08) / (b.life - 0.08));
    if (b.arc > 0) {
      if (Math.abs(angDiff(Math.atan2(dy, dx), b.ang)) > b.arc / 2) continue;
    } else if (!lineHits(b.x, b.y, b.ang, b.r, b.w, x, y, 0)) continue;
    wx += Math.cos(b.ang) * b.k * env;
    wy += Math.sin(b.ang) * b.k * env;
  }
  out[0] = wx;
  out[1] = wy;
  return out;
}

/** Открытость точки (0…1). */
export function expoAt(st: F11State, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= st.w || cy >= st.h) return 0;
  return st.expo[cy * st.w + cx];
}

/** Порыв: подготовка (фронт идёт) — 0…1, 0 — нет. Для рисовальщика. */
export function gustWarn(st: F11State): number {
  return st.gust.phase === 1 ? clamp(st.gust.t / st.gust.warn, 0, 1) : 0;
}

/** Порыв бьёт — 0…1 (огибающая). */
export function gustBlow(st: F11State): number {
  return gustEnv(st.gust);
}

// ---------------------------------------------------------------------------
// Посты и залы: кто где ждёт, где события.
// ---------------------------------------------------------------------------

const POST_OF: Partial<Record<number, Post['kind']>> = {
  [MK.guardPost]: 'guard',
  [MK.gardenerPost]: 'gardener',
  [MK.mossPost]: 'moss',
  [MK.sentryPost]: 'sentry',
  [MK.harpyPost]: 'harpy',
};

function objsOf(sim: Sim, ref: string): WorldObj[] {
  return sim.world.objs.filter((o) => o.ref === ref);
}

function centroid(list: WorldObj[]): [number, number] {
  let x = 0;
  let y = 0;
  for (const o of list) {
    x += o.x + 0.5;
    y += o.y + 0.5;
  }
  return list.length ? [x / list.length, y / list.length] : [0, 0];
}

function scanHalls(sim: Sim, st: F11State): void {
  const W = sim.world.w;
  // Сад Пробуждения — вокруг пульта.
  const con = objsOf(sim, 'f11_console')[0];
  if (con) st.garden = hall(con.x + 0.5, con.y + 0.5, 11);
  // Площадь башни — посередине гнёзд.
  const nests = objsOf(sim, 'f11_nest');
  if (nests.length) {
    const [cx, cy] = centroid(nests);
    st.tower = { ...hall(cx, cy, 8.5), dirT: 0, turn: 0, nests: [] };
  }
  // Внешний двор — статуя стража посреди мозаики.
  const statue = objsOf(sim, 'f11_statue').find((o) => o.area === F11_CASTLE);
  if (statue) st.storm = { ...hall(statue.x + 0.5, statue.y + 0.5, 8), boltT: 0, turnT: 0 };
  // Галерея — между заслонками и стражами.
  const valves = objsOf(sim, 'f11_valve');
  if (valves.length) {
    const [vx, vy] = centroid(valves);
    st.gallery = { ...hall(vx - 7, vy, 6.5), valveT: valves.map(() => 0) };
  }
  // Мельницы: нижняя (больший y) крутит a и b по часовой; средняя — b и c
  // против; у тайника — только c против (иначе с островка не уйти).
  const mills = objsOf(sim, 'f11_windmill').sort((a, b) => b.y - a.y);
  if (mills.length >= 3) {
    const [low, ...rest] = mills;
    rest.sort((a, b) => a.x - b.x);
    st.mills = [
      { obj: low, turns: [[0, 1], [1, 1]], cd: 0, at: -9 },
      { obj: rest[0], turns: [[1, -1], [2, -1]], cd: 0, at: -9 },
      { obj: rest[1], turns: [[2, -1]], cd: 0, at: -9 },
    ];
  }
  // Плиты: у лебёдки — её причал, остальные — «Бегущий мост».
  const winch = objsOf(sim, 'f11_winch')[0];
  const bridge: number[] = [];
  for (let i = 0; i < sim.tiles.length; i++) {
    if (sim.world.mark[i] !== MK.plate) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    if (winch && hypot(x - winch.x, y - winch.y) < 10) st.winch.cells.push(i);
    else bridge.push(i);
  }
  if (bridge.length) {
    let y0 = Infinity;
    let y1 = -Infinity;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const i of bridge) {
      const x = i % W;
      const y = Math.floor(i / W);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
    // Пролёты по три ряда, с юга на север.
    const cells: number[][] = [];
    for (let y = y1; y >= y0; y -= 3) {
      const span: number[] = [];
      for (let yy = y; yy > y - 3 && yy >= y0; yy--)
        for (let x = x0; x <= x1; x++) if (sim.world.mark[yy * W + x] === MK.plate) span.push(yy * W + x);
      cells.push(span);
    }
    st.bridge = {
      cells,
      lipS: y1 + 1,
      lipN: y0 - 1,
      x0,
      x1,
      t: 0,
      run: false,
      from: 1,
      announced: false,
      harpies: false,
      up: cells.map(() => 0),
    };
  }
}

function scanPosts(sim: Sim, st: F11State): void {
  const w = sim.world;
  for (let i = 0; i < sim.tiles.length; i++) {
    const kind = POST_OF[w.mark[i]];
    if (!kind) continue;
    const x = (i % w.w) + 0.5;
    const y = Math.floor(i / w.w) + 0.5;
    const area = w.rowArea[Math.floor(i / w.w)];
    st.posts.push({ id: i, x, y, kind, area, mob: 0, dead: false, hall: null });
  }
}

/** Приписать посты к залам — после того, как залы найдены. */
function postHalls(st: F11State): void {
  for (const p of st.posts) {
    const g = st.garden;
    if ((p.kind === 'gardener' || p.kind === 'moss') && g.r && hypot(p.x - g.cx, p.y - g.cy) < g.r + 2)
      p.hall = 'garden';
    if (p.kind === 'sentry') p.hall = 'gallery';
    if (p.kind === 'guard' && st.storm.r && hypot(p.x - st.storm.cx, p.y - st.storm.cy) < 16)
      p.hall = 'storm';
    if (p.kind === 'harpy' && st.tower.r && hypot(p.x - st.tower.cx, p.y - st.tower.cy) < 10)
      p.hall = 'tower';
  }
}

const POST_MOB: Record<Post['kind'], [string, string]> = {
  guard: ['f11_guard', 'f11_post'],
  gardener: ['f11_gardener', 'f11_tend'],
  moss: ['f11_moss', 'f11_hide'],
  sentry: ['f11_guard', 'f11_dormant'],
  harpy: ['f11_harpy', 'f11_perch'],
};

/** Посты: подошёл — на месте стоит свой монстр; убит — до конца вылазки. */
function stepPosts(sim: Sim, st: F11State, api: SimApi): void {
  const h = sim.hero;
  for (const p of st.posts) {
    if (p.dead) continue;
    const m = p.mob ? sim.mobs.find((x) => x.id === p.mob) : undefined;
    if (m) {
      if (m.mode === 'dying') p.dead = true;
      continue;
    }
    p.mob = 0;
    if (Math.abs(p.x - h.x) > 16 || Math.abs(p.y - h.y) > 18) continue;
    const [kind, mode] = POST_MOB[p.kind];
    const mob = api.spawnMob(sim, kind, p.x, p.y, { mode });
    mob.hx = p.x;
    mob.hy = p.y;
    mob.data.post = p.id;
    if (p.kind === 'moss') mob.data.ghost = 1;
    if (p.kind === 'sentry') mob.data.sentry = 1;
    if (p.kind === 'gardener') mob.face = sim.rng() * TAU;
    else mob.face = PI / 2;
    // Проснувшийся зал будит и новых.
    const hallOn =
      (p.hall === 'garden' && st.garden.state === 'on') ||
      (p.hall === 'gallery' && st.gallery.state === 'on') ||
      (p.hall === 'storm' && st.storm.state === 'on');
    if (hallOn) wake(sim, mob, api);
    p.mob = mob.id;
  }
}

/** Разбудить монстра поста: садовник злится, мох выскакивает, страж встаёт. */
function wake(sim: Sim, m: Mob, api: SimApi): void {
  if (m.mode === 'dying') return;
  switch (m.kind) {
    case 'f11_gardener':
      if (m.mode === 'f11_tend') {
        m.data.angry = 1;
        api.setMode(m, 'f11_rage');
      }
      return;
    case 'f11_moss':
      if (m.mode === 'f11_hide') api.setMode(m, 'f11_pop');
      return;
    case 'f11_guard':
      if (m.mode === 'f11_dormant' || m.mode === 'f11_post') api.setMode(m, 'f11_rise');
      return;
    case 'f11_harpy':
      if (m.mode === 'f11_perch') api.setMode(m, 'chase');
      return;
  }
  void sim;
}

// ---------------------------------------------------------------------------
// Порывы и край.
// ---------------------------------------------------------------------------

const rnd = (sim: Sim, a: number, b: number) => a + sim.rng() * (b - a);

/** Первый мост Садов: доски с постоянным потоком. */
function onTutorBridge(sim: Sim, st: F11State): boolean {
  const h = sim.hero;
  if (sim.area !== F11_GARDEN) return false;
  const x = Math.floor(h.x);
  const y = Math.floor(h.y);
  const i = y * st.w + x;
  return markAt(sim, x, y) === MK.plank && (st.bx[i] !== 0 || st.by[i] !== 0);
}

function startGust(
  sim: Sim,
  st: F11State,
  dir: number,
  k: number,
  warn: number,
  blow: number,
  forced = false,
): void {
  const g = st.gust;
  g.phase = 1;
  g.t = 0;
  g.dir = dir;
  g.k = k;
  g.warn = warn;
  g.blow = blow;
  g.forced = forced;
  g.count += 1;
  sim.events.push({ t: 'boss', what: 'f11_gust' });
}

function stepGust(sim: Sim, st: F11State, dt: number): void {
  const g = st.gust;
  const h = sim.hero;
  if (g.phase === 1) {
    g.t += dt;
    if (g.t >= g.warn) {
      g.phase = 2;
      g.t = 0;
      sim.events.push({ t: 'boss', what: 'f11_gust_blow' });
      sim.events.push({ t: 'shake', k: 0.18 });
    }
    return;
  }
  if (g.phase === 2) {
    g.t += dt;
    if (g.t >= g.blow) {
      g.phase = 0;
      g.forced = false;
      const cfg = GUST[g.area] ?? GUST[F11_GARDEN];
      g.next = rnd(sim, cfg.every[0], cfg.every[1]);
    }
    return;
  }
  // Бой и события ведут свой ветер.
  if (sim.boss?.state === 'fight' || st.storm.state === 'on') return;
  const cfg = GUST[sim.area];
  if (!cfg) return;
  g.area = sim.area;
  // Урок: первый порыв — на первом мосту, мягкий и с надписью.
  if (!st.taught) {
    if (!onTutorBridge(sim, st)) return;
    st.taught = true;
    startGust(sim, st, 0, 3.4, 1.5, 1.3);
    sim.events.push({
      t: 'boss',
      what: 'f11_gust_call',
      text: 'ПОРЫВ',
      sub: 'иди против ветра — край сдувает',
    });
    return;
  }
  g.next -= dt;
  if (g.next > 0) return;
  // Порыв ждёт открытого места: в саду за изгородью его не слышно.
  if (expoAt(st, h.x, h.y) < 0.22) {
    g.next = 0.6;
    return;
  }
  let dir: number;
  if (sim.area === F11_GARDEN) dir = (sim.rng() < 0.7 ? 0 : PI) + (sim.rng() - 0.5) * 0.8;
  else if (sim.area === F11_AQUA) dir = (g.count % 2 ? PI : 0) + (sim.rng() - 0.5) * 0.6;
  else dir = sim.rng() * TAU;
  const k = sim.area === F11_GARDEN ? 4.4 : cfg.k;
  startGust(sim, st, dir, k, cfg.warn, cfg.blow);
}

/** Сдуло или сорвался: 12% здоровья и возврат на последнее твёрдое место. */
function blowOff(sim: Sim, st: F11State, api: SimApi, text: string, sub?: string): void {
  const h = sim.hero;
  const fromX = h.x;
  const fromY = h.y;
  api.hurtEnv(sim, 0.12);
  let [sx, sy] = st.safe;
  if (!standable(sim, sx, sy)) {
    const lift = sim.world.objs.find((o) => o.kind === 'lift');
    if (lift) [sx, sy] = [lift.x + 0.5, lift.y + 1.5];
  }
  api.moveHero(sim, sx, sy);
  h.inv = Math.max(h.inv, 0.9);
  st.slip = 0;
  st.blown += 1;
  sim.events.push({ t: 'flash', color: '#e6f6ff', k: 0.7 });
  sim.events.push({ t: 'shake', k: 0.35 });
  sim.events.push({
    t: 'boss',
    what: 'f11_blow_trap',
    text,
    sub: st.blown <= 2 ? sub : undefined,
  });
  api.zone(sim, { x: fromX, y: fromY, r: 1.2, life: 0.9, art: 'f11_whisk' });
  api.zone(sim, { x: sx, y: sy, r: 1.2, life: 0.9, art: 'f11_landing' });
}

/** Ветер двигает героя; прижало к краю — круг. */
function pushHero(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const h = sim.hero;
  if (heroDown(sim) || h.pull) {
    st.slip = Math.max(0, st.slip - dt * 2);
    return;
  }
  const [wx, wy] = windAt(st, h.x, h.y);
  const w = hypot(wx, wy);
  if (w < 0.05) {
    st.slip = Math.max(0, st.slip - dt * 1.8);
    return;
  }
  const k = h.mode === 'dash' ? 0.35 : 1;
  h.x += wx * k * dt;
  h.y += wy * k * dt;
  api.collide(sim, h);
  const ux = wx / w;
  const uy = wy / w;
  const pressed =
    w >= WIND.slipMin &&
    h.mode !== 'dash' &&
    isDeep(sim, h.x + ux * (h.r + 0.16), h.y + uy * (h.r + 0.16));
  if (pressed && h.inv < 0.5) {
    // Идёт против ветра — держится дольше.
    const against = h.vx * ux + h.vy * uy < -1.5 ? 0.3 : 1;
    st.slip += (dt * against * (w - 1.4)) / WIND.slipDiv;
    if (st.slip >= 1) blowOff(sim, st, api, 'СДУЛО', 'край по ветру опасен — круг налился');
  } else st.slip = Math.max(0, st.slip - dt * 1.8);
}

/** Ветер двигает мобов: лёгких сильнее; ходячих прижало к краю — в небо. */
function pushMobs(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.mode === 'drop' || m.mode === 'escape') continue;
    if (m.t < 0 || (m.data.ghost ?? 0) > 0 || m.data.nowind) continue;
    const def = api.def(m.kind);
    if (def.boss || m.kind === 'f11_pylon') continue;
    const f = (def.fly ? 2 : 1.5) / ((def.mass ?? 1) + 0.6);
    const [wx, wy] = windAt(st, m.x, m.y);
    const w0 = hypot(wx, wy);
    const w = w0 * f;
    if (w < 0.05) continue;
    m.x += wx * f * dt;
    m.y += wy * f * dt;
    api.collide(sim, m);
    if (def.fly) continue;
    const ux = wx / w0;
    const uy = wy / w0;
    if (w >= 2 && isDeep(sim, m.x + ux * (m.r + 0.14), m.y + uy * (m.r + 0.14))) {
      m.data.slip = (m.data.slip ?? 0) + dt;
      if (m.data.slip > 0.35) {
        api.fall(sim, m);
        const loud = st.gallery.state === 'on' || m.kind === 'f11_guard' || m.kind === 'f11_gardener';
        sim.events.push({
          t: 'boss',
          what: 'f11_sky_fall',
          text: loud ? 'СДУЛО В НЕБО' : undefined,
          sub: loud ? 'ветер работает и на тебя' : undefined,
        });
      }
    } else m.data.slip = Math.max(0, (m.data.slip ?? 0) - dt * 2);
  }
}

/** Снаряды: прямые сносит, навесные — вместе с меткой приземления. */
function pushShots(sim: Sim, st: F11State, dt: number): void {
  for (const s of sim.shots) {
    const [wx, wy] = windAt(st, s.x, s.y);
    if (s.lob) {
      const dx = wx * 0.55 * dt;
      const dy = wy * 0.55 * dt;
      s.x += dx;
      s.y += dy;
      s.lob.x1 += dx;
      s.lob.y1 += dy;
    } else {
      s.vx += wx * 1.3 * dt;
      s.vy += wy * 1.3 * dt;
    }
  }
}

/** Добыча на полу катится по ветру (с острова не падает — край держит). */
function pushDrops(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  for (const d of sim.drops) {
    if (d.age < 0.2) continue;
    const [wx, wy] = windAt(st, d.x, d.y, out2, true);
    if (Math.abs(wx) + Math.abs(wy) < 0.2) continue;
    const e = { x: d.x + wx * 0.28 * dt, y: d.y + wy * 0.28 * dt, r: 0.12 };
    api.collide(sim, e);
    d.x = e.x;
    d.y = e.y;
  }
}

/** Последнее твёрдое место: вокруг нет неба, не плита, не трещит. */
function trackSafe(sim: Sim, st: F11State, dt: number): void {
  st.safeT += dt;
  if (st.safeT < 0.2) return;
  st.safeT = 0;
  const h = sim.hero;
  if (heroDown(sim) || h.pull) return;
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  if (!walkable(tileAt(sim, cx, cy))) return;
  const mk = markAt(sim, cx, cy);
  if (mk === MK.plate || mk === MK.cracking) return;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (tileAt(sim, cx + dx, cy + dy) === T_DEEP) return;
  st.safe = [cx + 0.5, cy + 0.5];
}

function stepBlasts(st: F11State, dt: number): void {
  if (!st.blasts.length) return;
  for (const b of st.blasts) b.t += dt;
  st.blasts = st.blasts.filter((b) => b.t < b.life);
}

/** Удар ветра конусом (крыло гарпии) или линией (струя, заслонка). */
export function blast(sim: Sim, b: Omit<Blast, 't'>): void {
  const st = STATE.get(sim);
  if (st) st.blasts.push({ ...b, t: 0 });
}

/** Сделать через `t` секунд (молния бьёт, струя вырывается). */
function after(st: F11State, t: number, f: () => void): void {
  st.later.push({ t, f });
}

function stepLater(st: F11State, dt: number): void {
  if (!st.later.length) return;
  const due: (() => void)[] = [];
  for (const l of st.later) {
    l.t -= dt;
    if (l.t <= 0) due.push(l.f);
  }
  st.later = st.later.filter((l) => l.t > 0);
  for (const f of due) f();
}

// ---------------------------------------------------------------------------
// Клетки на ходу: плиты, край арены. Всё сменённое помнится — для сброса.
// ---------------------------------------------------------------------------

function setCell(sim: Sim, st: F11State, api: SimApi, i: number, tile: number, mark: number): void {
  if (!st.saved.has(i)) st.saved.set(i, { tile: sim.tiles[i], mark: sim.world.mark[i] });
  api.setTile(sim, i % st.w, Math.floor(i / st.w), tile, mark);
}

function restoreCell(sim: Sim, st: F11State, api: SimApi, i: number): void {
  const s = st.saved.get(i);
  if (!s) return;
  api.setTile(sim, i % st.w, Math.floor(i / st.w), s.tile, s.mark);
  st.saved.delete(i);
}

/**
 * Клетка уходит в небо: кто на ней стоял — сорвался (мобы — в зачёт,
 * герой — урон и возврат на твёрдое).
 */
function sinkCell(sim: Sim, st: F11State, api: SimApi, i: number, mark: number, api2 = api): void {
  const x = i % st.w;
  const y = Math.floor(i / st.w);
  setCell(sim, st, api, i, T_DEEP, mark);
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || api2.def(m.kind).fly || api2.def(m.kind).boss) continue;
    if (Math.floor(m.x) === x && Math.floor(m.y) === y) api2.fall(sim, m);
  }
  const h = sim.hero;
  if (!heroDown(sim) && Math.floor(h.x) === x && Math.floor(h.y) === y)
    blowOff(sim, st, api, 'СОРВАЛСЯ', 'плита ушла из-под ног');
}

// ---------------------------------------------------------------------------
// Мельничные острова: ветряк поворачивает потоки на мостах.
// ---------------------------------------------------------------------------

function turnMill(sim: Sim, st: F11State, mill: Mill): boolean {
  if (mill.cd > 0) return false;
  for (const [g, s] of mill.turns) {
    const gr = st.groups[g];
    gr.dir = Math.round((gr.dir + (s * PI) / 2) / (PI / 2)) * (PI / 2);
    if (gr.dir > PI + 0.01) gr.dir -= TAU;
    if (gr.dir < -PI + 0.01) gr.dir += TAU;
  }
  mill.cd = 0.9;
  mill.at = sim.time;
  const first = !st.mills.some((m) => m !== mill && m.at > 0);
  sim.events.push({
    t: 'boss',
    what: 'f11_mill_call',
    text: first ? 'ВЕТЕР ПОВЕРНУЛ' : undefined,
    sub: first ? 'ленты на мостах смотрят в новую сторону' : undefined,
  });
  return true;
}

/** Куда дует поток мельницы (для рисовальщика ветряка). */
export function millDir(st: F11State, obj: WorldObj): { dir: number; at: number } | null {
  const m = st.mills.find((x) => x.obj === obj || (x.obj.x === obj.x && x.obj.y === obj.y));
  if (!m) return null;
  return { dir: st.groups[m.turns[0][0]].dir, at: m.at };
}

// ---------------------------------------------------------------------------
// Событие Садов: «Пробуждение сада».
// ---------------------------------------------------------------------------

function gardenPosts(st: F11State): Post[] {
  return st.posts.filter((p) => p.hall === 'garden');
}

function startGarden(sim: Sim, st: F11State, api: SimApi): void {
  const g = st.garden;
  if (g.state !== 'idle') return;
  g.state = 'on';
  g.t = 0;
  g.wave = 0;
  for (const p of gardenPosts(st)) {
    const m = sim.mobs.find((x) => x.id === p.mob);
    if (m) wake(sim, m, api);
  }
  sim.events.push({
    t: 'boss',
    what: 'f11_garden_trap',
    text: 'САД ПРОБУДИЛСЯ',
    sub: 'садовники вышли из грядок — форсунки бьют струями',
  });
  sim.events.push({ t: 'shake', k: 0.3 });
}

function stepGarden(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const g = st.garden;
  if (!g.r) return;
  const h = sim.hero;
  const d = hypot(h.x - g.cx, h.y - g.cy);
  if (g.state === 'idle') {
    if (d < 3.4) startGarden(sim, st, api);
    // Разозлил садовника в саду — сад просыпается весь.
    for (const p of gardenPosts(st)) {
      const m = sim.mobs.find((x) => x.id === p.mob);
      if (m && m.kind === 'f11_gardener' && m.data.angry) {
        startGarden(sim, st, api);
        break;
      }
    }
    return;
  }
  if (g.state !== 'on') return;
  if (d > 26) return;
  g.t += dt;
  // Форсунки: три грядки разом, метка, потом столб воды и ветра вверх.
  if (g.t > 2.3) {
    g.t = 0;
    g.wave += 1;
    const vents: number[] = [];
    for (let y = Math.floor(g.cy - g.r); y <= g.cy + g.r; y++)
      for (let x = Math.floor(g.cx - g.r - 2); x <= g.cx + g.r + 2; x++)
        if (markAt(sim, x, y) === MK.vent) vents.push(y * st.w + x);
    // Одна из трёх — ближняя к герою: стоять у грядки нельзя.
    vents.sort((a, b) => {
      const da = hypot((a % st.w) + 0.5 - h.x, Math.floor(a / st.w) + 0.5 - h.y);
      const db = hypot((b % st.w) + 0.5 - h.x, Math.floor(b / st.w) + 0.5 - h.y);
      return da - db;
    });
    const pick = [vents[0], ...vents.slice(1).sort(() => sim.rng() - 0.5).slice(0, 2)].filter(
      (v) => v !== undefined,
    );
    for (const v of pick) {
      const x = (v % st.w) + 0.5;
      const y = Math.floor(v / st.w) + 0.5;
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 1.25,
        warn: 0.95,
        dmg: rawShare(sim, 0.08),
        knock: 9,
        art: 'f11_geyser',
      });
      after(st, 0.95, () => {
        // Струя вверх и порыв во все стороны от форсунки.
        for (let k = 0; k < 4; k++)
          blast(sim, { x, y, ang: (k * PI) / 2 + PI / 4, arc: PI / 2 + 0.1, w: 0, r: 2.6, k: 5, life: 0.45 });
        api.zone(sim, { x, y, r: 1.2, life: 0.7, art: 'f11_spray' });
      });
    }
  }
  const posts = gardenPosts(st).filter((p) => p.kind === 'gardener');
  if (posts.length && posts.every((p) => p.dead)) {
    g.state = 'done';
    if (!g.paid) {
      g.paid = true;
      for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 160, g.cx, g.cy + 1);
      for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2, g.cx, g.cy + 1);
      api.dropAt(sim, 'f11_gear', 1, g.cx, g.cy + 1);
      api.dropAt(sim, 'f11_fruit', 2, g.cx, g.cy + 1);
    }
    sim.events.push({ t: 'boss', what: 'f11_calm_call', text: 'САД УСНУЛ', sub: 'у пульта — награда садовников' });
  }
}

// ---------------------------------------------------------------------------
// Событие Акведука: «Бегущий мост» — плиты всплывают волной.
// ---------------------------------------------------------------------------

const RUN = { period: 6.4, first: 0.6, step: 0.55, up: 2.7, crack: 0.55, warn: 0.5 };

function plateState(br: BridgeState, k: number, t: number): number {
  const rise = RUN.first + k * RUN.step;
  if (t < rise - RUN.warn) return 0;
  if (t < rise) return 1;
  if (t < rise + RUN.up) return 2;
  if (t < rise + RUN.up + RUN.crack) return 3;
  void br;
  return 0;
}

function stepBridge(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const br = st.bridge;
  if (!br.cells.length) return;
  const h = sim.hero;
  const near =
    h.x > br.x0 - 3 && h.x < br.x1 + 4 && h.y > br.lipN - 5 && h.y < br.lipS + 6 && !heroDown(sim);
  if (!br.run) {
    if (!near) return;
    br.run = true;
    br.t = 0;
    br.from = h.y > (br.lipN + br.lipS) / 2 ? 1 : -1;
    if (!br.announced) {
      br.announced = true;
      sim.events.push({
        t: 'boss',
        what: 'f11_bridge_call',
        text: 'БЕГУЩИЙ МОСТ',
        sub: 'плиты всплывают волной — беги за ней',
      });
    }
    // Гарпии слетаются на первую волну — раз за вылазку.
    if (!br.harpies) {
      br.harpies = true;
      for (let i = 0; i < 2; i++) {
        const x = i ? br.x1 + 7 : br.x0 - 7;
        const y = (br.lipN + br.lipS) / 2 + (i ? -2 : 2);
        const m = api.spawnMob(sim, 'f11_harpy', x, y, { mode: 'chase' });
        m.cd = 1.5 + i;
      }
    }
  }
  br.t += dt;
  const n = br.cells.length;
  for (let k = 0; k < n; k++) {
    const idx = br.from === 1 ? k : n - 1 - k;
    const want = plateState(br, k, br.t);
    if (want === br.up[idx]) continue;
    br.up[idx] = want;
    for (const i of br.cells[idx]) {
      if (want === 2) setCell(sim, st, api, i, T_FLOOR, MK.plate);
      else if (want === 3) setCell(sim, st, api, i, T_FLOOR, MK.cracking);
      else if (want === 1) setCell(sim, st, api, i, T_DEEP, MK.rising);
      else sinkCell(sim, st, api, i, MK.fallen);
    }
  }
  if (br.t >= RUN.period) {
    br.t = 0;
    // Следующая волна — от того берега, где герой.
    br.from = h.y > (br.lipN + br.lipS) / 2 ? 1 : -1;
    if (!near) br.run = false;
  }
}

// ---------------------------------------------------------------------------
// Событие Акведука: «Гнездо гарпий» — башня крутит ветер, гарпии волнами.
// ---------------------------------------------------------------------------

const TOWER = { waves: 3, turn: 4, warn: 1 };

function stepTower(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const tw = st.tower;
  if (!tw.r) return;
  const h = sim.hero;
  const g = st.groups[3];
  const d = hypot(h.x - tw.cx, h.y - tw.cy);
  // Тихий ветер башни всегда медленно кружит.
  if (tw.state !== 'on') {
    g.dir += dt * 0.25;
    g.to = 1.3;
  }
  g.k += (g.to - g.k) * Math.min(1, dt * 2);
  if (tw.state === 'idle') {
    if (d > tw.r) return;
    tw.state = 'on';
    tw.wave = 0;
    tw.t = 99;
    tw.dirT = TOWER.turn;
    tw.turn = 0;
    g.dir = Math.round(g.dir / (PI / 2)) * (PI / 2);
    g.to = 3.6;
    sim.events.push({
      t: 'boss',
      what: 'f11_tower_trap',
      text: 'ГНЕЗДО ГАРПИЙ',
      sub: 'башня крутит ветер — гарпии налетают',
    });
    return;
  }
  if (tw.state !== 'on') return;
  // Поворот ветра по часовой — с предупреждением за секунду.
  tw.dirT -= dt;
  if (tw.dirT <= TOWER.warn && tw.turn === 0) {
    tw.turn = 1;
    sim.events.push({ t: 'boss', what: 'f11_tower_turn' });
  }
  if (tw.dirT <= 0) {
    g.dir += PI / 2;
    if (g.dir > PI + 0.01) g.dir -= TAU;
    tw.dirT = TOWER.turn;
    tw.turn = 0;
    sim.events.push({ t: 'shake', k: 0.15 });
  }
  // Волны: гарпии из неба; целые гнёзда дают ещё по одной.
  const alive = tw.mobs.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));
  tw.mobs = alive;
  tw.t += dt;
  if (!alive.length || tw.t > 26) {
    if (tw.wave >= TOWER.waves) {
      tw.state = 'done';
      g.to = 1.3;
      if (!tw.paid) {
        tw.paid = true;
        for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 170, tw.cx, tw.cy + 3);
        for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2, tw.cx, tw.cy + 3);
        api.dropAt(sim, 'f11_feather', 2, tw.cx, tw.cy + 3);
      }
      sim.events.push({ t: 'boss', what: 'f11_calm_call', text: 'БАШНЯ СТИХЛА', sub: 'гнёзда пусты' });
      return;
    }
    const nests = sim.props.filter((p) => p.alive && p.obj.ref === 'f11_nest').length;
    const n = 2 + tw.wave + nests;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + sim.rng() * 0.5;
      const p = spotNear(sim, tw.cx, tw.cy, 11, 14, () => 0, true);
      const x = p ? p[0] : tw.cx + Math.cos(a) * 12;
      const y = p ? p[1] : tw.cy + Math.sin(a) * 12;
      const m = api.spawnMob(sim, 'f11_harpy', x, y, { mode: 'chase', elite: tw.wave === 2 && i === 0 });
      m.cd = 1 + i * 0.4;
      tw.mobs.push(m.id);
    }
    tw.wave += 1;
    tw.t = 0;
    sim.events.push({ t: 'boss', what: 'summon' });
  }
}

/** Поворот башни скоро (для рисовальщика: стрелки мигают). */
export function towerTurn(st: F11State): number {
  const tw = st.tower;
  return tw.state === 'on' && tw.turn ? clamp(1 - tw.dirT / TOWER.warn, 0, 1) : 0;
}

// ---------------------------------------------------------------------------
// Событие Замка: «Буря» во Внешнем дворе.
// ---------------------------------------------------------------------------

const STORM = { dur: 30, gust: 3.7, bolt: 1.15, warn: 1 };

function stepStorm(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const s = st.storm;
  if (!s.r) return;
  const h = sim.hero;
  const d = hypot(h.x - s.cx, h.y - s.cy);
  if (s.state === 'idle') {
    if (s.t > 0) {
      s.t -= dt;
      return;
    }
    if (d > 6) return;
    s.state = 'on';
    s.t = 0;
    s.boltT = 1.2;
    s.turnT = 0.4;
    s.wave = 0;
    for (const p of st.posts) {
      if (p.hall !== 'storm') continue;
      const m = sim.mobs.find((x) => x.id === p.mob);
      if (m) wake(sim, m, api);
    }
    sim.events.push({
      t: 'boss',
      what: 'f11_storm_trap',
      text: 'БУРЯ',
      sub: 'ветер крутит — молнии бьют по меткам',
    });
    return;
  }
  if (s.state !== 'on') return;
  if (d > 20 || heroDown(sim)) {
    // Ушёл — буря стихает и ждёт следующего раза.
    s.state = 'idle';
    s.t = 40;
    return;
  }
  s.t += dt;
  // Ветер крутится: порыв за порывом, каждый — с нового направления.
  s.turnT -= dt;
  if (s.turnT <= 0 && st.gust.phase === 0) {
    s.wave += 1;
    const dir = st.gust.dir + (PI / 2) * (sim.rng() < 0.5 ? 1 : 1.5) * (s.wave % 2 ? 1 : -1);
    startGust(sim, st, dir, 5.6, 0.95, 1.5, true);
    s.turnT = STORM.gust;
  }
  // Молнии: одна рядом с героем, остальные по двору.
  s.boltT -= dt;
  if (s.boltT <= 0) {
    s.boltT = STORM.bolt;
    const pts: [number, number][] = [];
    const near = spotNear(sim, h.x, h.y, 0.4, 2.2, () => 0);
    if (near) pts.push(near);
    for (let i = 0; i < 2; i++) {
      const p = spotNear(sim, s.cx, s.cy, 1, 11, (x, y) => -hypot(x - h.x, y - h.y) * 0.1);
      if (p) pts.push(p);
    }
    for (const [x, y] of pts) {
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 1.1,
        warn: STORM.warn,
        dmg: rawShare(sim, 0.13),
        knock: 4,
        art: 'f11_bolt',
        above: true,
        mobDmg: 0,
      });
      after(st, STORM.warn, () => {
        const key = `f11bolt${Math.round(x * 7 + y * 131)}`;
        api.light(sim, key, { x, y, r: 6, tint: 'cold' });
        after(st, 0.16, () => api.light(sim, key, null));
      });
    }
    after(st, STORM.warn, () => {
      F11_FX.bolt = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
      sim.events.push({ t: 'flash', color: '#e8f0ff', k: 0.45 });
      sim.events.push({ t: 'shake', k: 0.22 });
      sim.events.push({ t: 'boss', what: 'f11_thunder' });
    });
  }
  if (s.t >= STORM.dur) {
    s.state = 'done';
    if (!s.paid) {
      s.paid = true;
      for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 180, s.cx, s.cy + 1);
      for (let i = 0; i < 4; i++) api.dropAt(sim, 'token', 2, s.cx, s.cy + 1);
      api.dropAt(sim, 'f11mat', 2, s.cx, s.cy + 1);
    }
    sim.events.push({ t: 'boss', what: 'f11_calm_call', text: 'БУРЯ УШЛА', sub: 'у статуи — то, что принёс ветер' });
  }
}

/** Идёт ли буря (для рисовальщика: дождь, темнота). */
export const stormOn = (st: F11State) => st.storm.state === 'on';

// ---------------------------------------------------------------------------
// Событие Замка: «Караул» в Галерее стражей, заслонки.
// ---------------------------------------------------------------------------

const VALVE = { warn: 0.9, on: 4.2, cd: 7, k: 8.5 };

function valveIndex(sim: Sim, obj: WorldObj): number {
  const list = objsOf(sim, 'f11_valve').sort((a, b) => a.y - b.y);
  return list.findIndex((o) => o.x === obj.x && o.y === obj.y);
}

function openValve(sim: Sim, st: F11State, api: SimApi, k: number): boolean {
  const gl = st.gallery;
  if (gl.valveT[k] > 0) return false;
  gl.valveT[k] = VALVE.cd;
  const g = st.groups[4 + k];
  if (!g) return false;
  sim.events.push({ t: 'boss', what: 'f11_valve_call' });
  after(st, VALVE.warn, () => {
    g.to = VALVE.k;
    sim.events.push({ t: 'boss', what: 'f11_valve_blow' });
    sim.events.push({ t: 'shake', k: 0.25 });
  });
  after(st, VALVE.warn + VALVE.on, () => {
    g.to = 0;
  });
  void api;
  return true;
}

/** Заслонка: 0 — готова, иначе сколько до готовности (для подписи). */
export function valveWait(st: F11State, k: number): number {
  return st.gallery.valveT[k] ?? 0;
}

function stepGallery(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const gl = st.gallery;
  if (!gl.r) return;
  for (let k = 0; k < gl.valveT.length; k++) gl.valveT[k] = Math.max(0, gl.valveT[k] - dt);
  for (const g of [st.groups[4], st.groups[5]]) g.k += (g.to - g.k) * Math.min(1, dt * 5);
  const h = sim.hero;
  const sentries = st.posts.filter((p) => p.hall === 'gallery');
  if (gl.state === 'idle') {
    if (hypot(h.x - gl.cx, h.y - gl.cy) > 4.5) {
      // Разбудил стража ударом — просыпается весь караул.
      if (!sentries.some((p) => sim.mobs.find((m) => m.id === p.mob && m.mode !== 'f11_dormant' && m.mode !== 'dying')))
        return;
    }
    gl.state = 'on';
    gl.t = 0;
    gl.wave = 0;
    sim.events.push({
      t: 'boss',
      what: 'f11_gallery_trap',
      text: 'КАРАУЛ',
      sub: 'стражи проснулись — заслонки выпустят бурю поперёк',
    });
    return;
  }
  if (gl.state !== 'on') return;
  gl.t += dt;
  // Стражи встают парами.
  if (gl.t > 1.2 * gl.wave && gl.wave < 4) {
    gl.wave += 1;
    const left = sentries
      .map((p) => sim.mobs.find((m) => m.id === p.mob))
      .filter((m): m is Mob => !!m && m.mode === 'f11_dormant')
      .sort((a, b) => hypot(a.x - h.x, a.y - h.y) - hypot(b.x - h.x, b.y - h.y))
      .slice(0, 2);
    for (const m of left) wake(sim, m, api);
  }
  if (sentries.length && sentries.every((p) => p.dead)) {
    gl.state = 'done';
    if (!gl.paid) {
      gl.paid = true;
      for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 190, gl.cx, gl.cy);
      for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 3, gl.cx, gl.cy);
      api.dropAt(sim, 'f11_gear', 2, gl.cx, gl.cy);
    }
    sim.events.push({ t: 'boss', what: 'f11_calm_call', text: 'КАРАУЛ СНЯТ', sub: 'галерея твоя' });
  }
}

// ---------------------------------------------------------------------------
// Лебёдка причала: плиты тянутся к плавучему островку.
// ---------------------------------------------------------------------------

const WINCH = { up: 40, crack: 1.3 };

function stepWinch(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  const w = st.winch;
  if (!w.cells.length) return;
  if (w.state === 'up') {
    w.t -= dt;
    if (w.t <= 0) {
      w.state = 'sink';
      w.t = WINCH.crack;
      for (const i of w.cells) setCell(sim, st, api, i, T_FLOOR, MK.cracking);
      sim.events.push({ t: 'boss', what: 'f11_winch_trap', text: 'ЦЕПЬ ОСЛАБЛА', sub: 'плиты уходят вниз' });
    }
  } else if (w.state === 'sink') {
    w.t -= dt;
    if (w.t <= 0) {
      w.state = 'down';
      for (const i of w.cells) sinkCell(sim, st, api, i, MK.fallen);
    }
  }
}

function pullWinch(sim: Sim, st: F11State, api: SimApi): boolean {
  const w = st.winch;
  if (w.state !== 'down') return false;
  w.state = 'up';
  w.t = WINCH.up;
  // Плиты встают по одной — от площади к островку.
  const cells = [...w.cells].sort((a, b) => (a % st.w) - (b % st.w));
  cells.forEach((i, n) => {
    setCell(sim, st, api, i, T_DEEP, MK.rising);
    after(st, 0.08 * Math.floor(n / 3) + 0.25, () => setCell(sim, st, api, i, T_FLOOR, MK.plate));
  });
  sim.events.push({ t: 'boss', what: 'f11_winch_call', text: 'ЛЕБЁДКА', sub: 'плиты держатся сорок секунд' });
  return true;
}

// ---------------------------------------------------------------------------
// Прилёты из неба: абордажник на планере, скаты и гарпии.
// ---------------------------------------------------------------------------

const ARRIVE: Record<string, [string, number][]> = {
  [F11_GARDEN]: [
    ['f11_boarder', 45],
    ['f11_ray', 35],
    ['f11_harpy', 20],
  ],
  [F11_AQUA]: [
    ['f11_harpy', 45],
    ['f11_boarder', 30],
    ['f11_ray', 25],
  ],
  [F11_CASTLE]: [
    ['f11_boarder', 40],
    ['f11_drone', 35],
    ['f11_ray', 25],
  ],
};

function pickArrive(sim: Sim, area: string): string {
  const list = ARRIVE[area] ?? ARRIVE[F11_GARDEN];
  let total = 0;
  for (const [, w] of list) total += w;
  let r = sim.rng() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[0][0];
}

function stepArrivals(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  if (sim.boss?.state === 'fight' || heroDown(sim)) return;
  st.arriveT -= dt;
  if (st.arriveT > 0) return;
  st.arriveT = rnd(sim, 15, 24);
  const h = sim.hero;
  if (expoAt(st, h.x, h.y) < 0.15) {
    st.arriveT = 4;
    return;
  }
  let near = 0;
  for (const m of sim.mobs) if (m.mode !== 'dying' && hypot(m.x - h.x, m.y - h.y) < 12) near += 1;
  if (near >= 6) return;
  // У лифта не нападают.
  if (sim.world.objs.some((o) => o.kind === 'lift' && hypot(o.x - h.x, o.y - h.y) < 8)) return;
  const kind = pickArrive(sim, sim.area);
  if (kind === 'f11_boarder') {
    // Край острова в 3,5…7 клетках, рядом небо: оттуда и подлетит.
    let best: [number, number, number] | null = null;
    let bs = Infinity;
    for (let i = 0; i < 40; i++) {
      const a = sim.rng() * TAU;
      const r = 3.5 + sim.rng() * 3.5;
      const x = Math.floor(h.x + Math.cos(a) * r);
      const y = Math.floor(h.y + Math.sin(a) * r);
      if (!walkable(tileAt(sim, x, y))) continue;
      let sky: number | null = null;
      for (let k = 0; k < 4; k++) {
        const dx = [1, -1, 0, 0][k];
        const dy = [0, 0, 1, -1][k];
        if (tileAt(sim, x + dx, y + dy) === T_DEEP) sky = Math.atan2(dy, dx);
      }
      if (sky === null) continue;
      if (!api.lineOfSight(sim, x + 0.5, y + 0.5, h.x, h.y)) continue;
      const s = Math.abs(r - 5) + sim.rng();
      if (s < bs) {
        bs = s;
        best = [x + 0.5, y + 0.5, sky];
      }
    }
    if (!best) return;
    const [x, y, sky] = best;
    const m = api.spawnMob(sim, 'f11_boarder', x, y, { mode: 'f11_land' });
    m.data.ghost = 1;
    m.data.from = sky;
    m.face = sky + PI;
    const z: ZoneIn & { mob?: number; ang?: number } = {
      x,
      y,
      r: 0.9,
      life: 1,
      art: 'f11_glider',
      above: true,
    };
    z.mob = m.id;
    z.ang = sky;
    api.zone(sim, z);
    sim.events.push({ t: 'boss', what: 'f11_glide_call' });
    return;
  }
  // Летуны — из неба за краем кадра.
  const p = spotNear(sim, h.x, h.y, 9, 12, () => 0, true);
  if (!p || !isDeep(sim, p[0], p[1])) return;
  const n = kind === 'f11_ray' ? 1 + (sim.rng() < 0.4 ? 1 : 0) : kind === 'f11_harpy' ? 2 : 2;
  for (let i = 0; i < n; i++) {
    const m = api.spawnMob(sim, kind, p[0] + i * 0.8, p[1] + i * 0.5, { mode: 'chase' });
    m.cd = 1 + i * 0.6;
  }
}

// ---------------------------------------------------------------------------
// Смерчи ветряного духа и крюки абордажников — тоже «ветер» этажа.
// ---------------------------------------------------------------------------

function stepTornados(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  if (!st.tornados.length) return;
  const h = sim.hero;
  const keep: Tornado[] = [];
  for (const tn of st.tornados) {
    tn.t += dt;
    const z = tn.zone;
    if (tn.t > tn.life) {
      z.life = 0;
      continue;
    }
    keep.push(tn);
    // Идёт к герою, его несёт ветер.
    const dx = h.x - tn.x;
    const dy = h.y - tn.y;
    const d = hypot(dx, dy) || 1;
    const [wx, wy] = windAt(st, tn.x, tn.y);
    tn.vx += ((dx / d) * 2.3 - tn.vx) * Math.min(1, dt * 1.6);
    tn.vy += ((dy / d) * 2.3 - tn.vy) * Math.min(1, dt * 1.6);
    tn.x += (tn.vx + wx * 0.6) * dt;
    tn.y += (tn.vy + wy * 0.6) * dt;
    const e = { x: tn.x, y: tn.y, r: 0.4 };
    // Над небом смерч идёт, стены его гасят.
    const t = tileAt(sim, Math.floor(tn.x), Math.floor(tn.y));
    if (t !== T_DEEP && !walkable(t)) tn.t = tn.life;
    void e;
    z.x = tn.x;
    z.y = tn.y;
    // Затягивает героя: ближе — сильнее; в сердцевине — бьёт.
    if (!heroDown(sim) && !h.pull && d < 2.4 && h.mode !== 'dash') {
      const pull = 2.6 * (1 - d / 2.4);
      h.x -= (dx / d) * pull * dt;
      h.y -= (dy / d) * pull * dt;
      api.collide(sim, h);
      tn.tick -= dt;
      if (d < 0.75 && tn.tick <= 0) {
        tn.tick = 0.6;
        const from = sim.mobs.find((m) => m.id === tn.from);
        api.hurtHero(sim, (from?.dmg ?? rawShare(sim, 0.08)) * 0.6, tn.x, tn.y, 2, 'f11_spirit');
      }
    }
    // Лёгких мобов тоже тянет.
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || m.kind === 'f11_spirit' || api.def(m.kind).boss) continue;
      const mx = tn.x - m.x;
      const my = tn.y - m.y;
      const md = hypot(mx, my);
      if (md > 2 || md < 0.01) continue;
      const f = (1.8 * (1 - md / 2)) / ((api.def(m.kind).mass ?? 1) + 0.6);
      m.x += (mx / md) * f * dt;
      m.y += (my / md) * f * dt;
    }
  }
  st.tornados = keep;
}

/** Смерч духа: идёт к герою и затягивает. */
function spawnTornado(sim: Sim, st: F11State, api: SimApi, m: Mob, ang: number): void {
  const x = m.x + Math.cos(ang) * 0.8;
  const y = m.y + Math.sin(ang) * 0.8;
  const zone: ZoneIn = { x, y, r: 1.2, life: 999, art: 'f11_tornado' };
  api.zone(sim, zone);
  const z = sim.zones[sim.zones.length - 1] as ZoneIn & { id: number };
  st.tornados.push({
    id: z.id,
    x,
    y,
    vx: Math.cos(ang) * 2,
    vy: Math.sin(ang) * 2,
    t: 0,
    life: 4.4,
    from: m.id,
    tick: 0.2,
    zone: z,
  });
}

const HOOK = { speed: 13, len: 6.5, pull: 12 };

function stepHooks(sim: Sim, st: F11State, api: SimApi, dt: number): void {
  if (!st.hooks.length) return;
  const h = sim.hero;
  const keep: Hook[] = [];
  for (const hk of st.hooks) {
    hk.t += dt;
    const m = sim.mobs.find((x) => x.id === hk.from && x.mode !== 'dying');
    if (!m) {
      hk.zone.life = 0;
      continue;
    }
    if (hk.back) {
      // Крюк возвращается к хозяину.
      const dx = m.x - hk.x;
      const dy = m.y - hk.y;
      const d = hypot(dx, dy);
      if (d < 0.4 || hk.t > 1.4) {
        hk.zone.life = 0;
        m.data.hook = 0;
        continue;
      }
      hk.x += (dx / d) * HOOK.speed * dt;
      hk.y += (dy / d) * HOOK.speed * dt;
    } else {
      hk.x += hk.vx * dt;
      hk.y += hk.vy * dt;
      const t = tileAt(sim, Math.floor(hk.x), Math.floor(hk.y));
      const far = hypot(hk.x - m.x, hk.y - m.y) > HOOK.len;
      if (far || (t !== T_DEEP && !walkable(t))) hk.back = true;
      else if (!heroDown(sim) && hypot(h.x - hk.x, h.y - hk.y) < h.r + 0.28) {
        if (canHurt(sim)) {
          // Попал: тянет к хозяину, а тот уже замахнулся.
          const a = Math.atan2(h.y - m.y, h.x - m.x);
          api.hurtHero(sim, m.dmg * 0.4, hk.x, hk.y, 0, m.kind);
          api.pullHero(sim, m.x + Math.cos(a) * (m.r + h.r + 0.25), m.y + Math.sin(a) * (m.r + h.r + 0.25), {
            speed: HOOK.pull,
            max: 0.9,
          });
          sim.events.push({ t: 'boss', what: 'f11_hook_call', text: 'КРЮК', sub: m.data.warned ? undefined : 'рывок в сторону — и мимо' });
          m.data.warned = 1;
          api.setMode(m, 'f11_reel');
          m.data.hooked = 1;
        }
        hk.back = true;
      }
    }
    hk.zone.x = hk.x;
    hk.zone.y = hk.y;
    (hk.zone as ZoneIn & { mx?: number; my?: number }).mx = m.x;
    (hk.zone as ZoneIn & { mx?: number; my?: number }).my = m.y;
    keep.push(hk);
  }
  st.hooks = keep;
}

function throwHook(sim: Sim, st: F11State, api: SimApi, m: Mob, ang: number): void {
  const zone: ZoneIn = { x: m.x, y: m.y, r: 0.3, life: 999, art: 'f11_hook' };
  api.zone(sim, zone);
  const z = sim.zones[sim.zones.length - 1];
  st.hooks.push({
    id: m.id,
    from: m.id,
    x: m.x,
    y: m.y,
    vx: Math.cos(ang) * HOOK.speed,
    vy: Math.sin(ang) * HOOK.speed,
    t: 0,
    back: false,
    zone: z,
  });
  m.data.hook = 1;
}

// ---------------------------------------------------------------------------
// Постоянные слои картинки: небо с параллаксом, ленты ветра на полу, воздух.
// ---------------------------------------------------------------------------

function keepZones(sim: Sim, st: F11State, api: SimApi): void {
  const h = sim.hero;
  const has = (z: ZoneIn | null) => !!z && sim.zones.includes(z as (typeof sim.zones)[number]);
  if (!has(st.zSky)) {
    api.zone(sim, { x: h.x, y: h.y, r: 0.01, life: 1e9, art: 'f11_sky' });
    st.zSky = sim.zones[sim.zones.length - 1];
  }
  if (!has(st.zWind)) {
    api.zone(sim, { x: h.x, y: h.y, r: 0.01, life: 1e9, art: 'f11_wind' });
    st.zWind = sim.zones[sim.zones.length - 1];
  }
  if (!has(st.zAir)) {
    api.zone(sim, { x: h.x, y: h.y, r: 0.01, life: 1e9, art: 'f11_air', above: true });
    st.zAir = sim.zones[sim.zones.length - 1];
  }
  for (const z of [st.zSky, st.zWind, st.zAir]) {
    if (!z) continue;
    z.x = h.x;
    z.y = h.y;
  }
  // Смерчи и крюки после сброса боя пропали вместе с зонами.
  st.tornados = st.tornados.filter((t) => sim.zones.includes(t.zone as (typeof sim.zones)[number]));
  st.hooks = st.hooks.filter((k) => sim.zones.includes(k.zone as (typeof sim.zones)[number]));
}

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

registerFloor(11, {
  start(sim, api) {
    const st = scan(sim);
    STATE.set(sim, st);
    // Плиты «Бегущего моста» и причала — внизу, пока их не поднимут.
    for (const span of st.bridge.cells) for (const i of span) setCell(sim, st, api, i, T_DEEP, MK.fallen);
    for (const i of st.winch.cells) setCell(sim, st, api, i, T_DEEP, MK.fallen);
    keepZones(sim, st, api);
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    keepZones(sim, st, api);
    stepLater(st, dt);
    stepBlasts(st, dt);
    for (const mill of st.mills) mill.cd = Math.max(0, mill.cd - dt);
    stepGust(sim, st, dt);
    stepTornados(sim, st, api, dt);
    stepHooks(sim, st, api, dt);
    pushHero(sim, st, api, dt);
    pushMobs(sim, st, api, dt);
    pushShots(sim, st, dt);
    pushDrops(sim, st, api, dt);
    trackSafe(sim, st, dt);
    stepBridge(sim, st, api, dt);
    stepWinch(sim, st, api, dt);
    stepTower(sim, st, api, dt);
    stepGallery(sim, st, api, dt);
    if (heroDown(sim)) return;
    stepPosts(sim, st, api);
    stepGarden(sim, st, api, dt);
    stepStorm(sim, st, api, dt);
    stepArrivals(sim, st, api, dt);
  },
  onUse(sim, obj, api) {
    const st = stateOf(sim);
    switch (obj.ref) {
      case 'f11_windmill': {
        const mill = st.mills.find((m) => m.obj.x === obj.x && m.obj.y === obj.y);
        return mill ? turnMill(sim, st, mill) : false;
      }
      case 'f11_winch':
        return pullWinch(sim, st, api);
      case 'f11_valve': {
        const k = valveIndex(sim, obj);
        return k >= 0 ? openValve(sim, st, api, k) : false;
      }
      case 'f11_console':
        if (st.garden.state !== 'idle') return false;
        startGarden(sim, st, api);
        return true;
    }
    return false;
  },
  useLabel(sim, obj) {
    const st = STATE.get(sim);
    if (!st) return obj.use?.label ?? null;
    switch (obj.ref) {
      case 'f11_windmill': {
        const mill = st.mills.find((m) => m.obj.x === obj.x && m.obj.y === obj.y);
        return mill && mill.cd <= 0 ? 'Повернуть' : null;
      }
      case 'f11_winch':
        return st.winch.state === 'down' ? 'Тянуть' : null;
      case 'f11_valve': {
        const k = valveIndex(sim, obj);
        return k >= 0 && st.gallery.valveT[k] <= 0 ? 'Открыть' : null;
      }
      case 'f11_console':
        return st.garden.state === 'idle' ? 'Разбудить сад' : null;
    }
    return obj.use?.label ?? null;
  },
});

/** Для тестов и стенда: поле, посты, события. */
export const F11_DEBUG = { stateOf, windAt, turnMill, pullWinch, openValve, blowOff, startGarden };

// ---------------------------------------------------------------------------
// Монстры: общее.
// ---------------------------------------------------------------------------

/** Повернуться к углу не быстрее `rate` рад/с. */
function turnTo(m: Mob, ang: number, rate: number, dt: number): void {
  const d = angDiff(ang, m.face);
  const s = rate * dt;
  m.face += Math.abs(d) < s ? d : Math.sign(d) * s;
}

/** Линия прицела на полу — от моба по углу. */
function lineTele(m: Mob, ang: number, len: number, w: number, k: number): void {
  m.tele = { shape: 'line', r: len, w, ang, k: clamp(k, 0, 1) };
}

/** Удар конусом вплотную: попал ли герой (рывок и неуязвимость спасают). */
function coneHit(sim: Sim, m: Mob, r: number, arc: number): boolean {
  const h = sim.hero;
  const dx = h.x - m.x;
  const dy = h.y - m.y;
  const d = hypot(dx, dy);
  if (d > r + h.r) return false;
  return Math.abs(angDiff(Math.atan2(dy, dx), m.face)) < arc / 2 + Math.atan(h.r / Math.max(0.2, d));
}

/** Лететь к точке напрямую (летуны: над небом можно). */
function flyTo(sim: Sim, m: Mob, api: SimApi, tx: number, ty: number, speed: number, dt: number): void {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = hypot(dx, dy);
  if (d < 0.15) {
    m.vx *= 0.85;
    m.vy *= 0.85;
    return;
  }
  api.steer(sim, m, dx / d, dy / d, speed * Math.min(1, d / 1.2 + 0.3), dt);
}

/** Куда от героя ближе всего небо (направление) — или null. */
function edgeDir(sim: Sim, x: number, y: number, R = 5): number | null {
  let best: number | null = null;
  let bd = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    for (let r = 0.8; r <= R; r += 0.5) {
      if (tileAt(sim, Math.floor(x + Math.cos(a) * r), Math.floor(y + Math.sin(a) * r)) === T_DEEP) {
        if (r < bd) {
          bd = r;
          best = a;
        }
        break;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Небесный скат: кружит над небом, пике по линии сквозь героя.
// ---------------------------------------------------------------------------

export const RAY = { orbit: 4.6, aim: 0.8, lock: 0.5, speed: 11.5, len: 8.5, cd: 2.3 };

registerBrain('f11_ray', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        const sgn = m.id % 2 ? 1 : -1;
        const a = Math.atan2(m.y - h.y, m.x - h.x) + 0.75 * sgn;
        // Круг над краем: точка круга, что дальше от острова, — лучше.
        flyTo(sim, m, api, h.x + Math.cos(a) * RAY.orbit, h.y + Math.sin(a) * RAY.orbit, m.speed, dt);
        if (m.cd <= 0 && dist > 2.2 && dist < 7.2 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'aim');
          m.dir = Math.atan2(dy, dx);
        }
        return;
      }
      case 'aim': {
        m.vx *= 0.88;
        m.vy *= 0.88;
        if (m.t < RAY.lock) {
          const want = Math.atan2(h.y + h.vy * 0.25 - m.y, h.x + h.vx * 0.25 - m.x);
          const d = angDiff(want, m.dir);
          m.dir += clamp(d, -3 * dt, 3 * dt);
        }
        m.face = m.dir;
        lineTele(m, m.dir, RAY.len, 0.5, m.t / RAY.aim);
        if (m.t > RAY.aim - 0.25) m.danger = 2.2;
        if (m.t >= RAY.aim) {
          api.setMode(m, 'f11_swoop');
          m.data.hit = 0;
          m.data.sx = m.x;
          m.data.sy = m.y;
          sim.events.push({ t: 'boss', what: 'f11_ray_dive' });
        }
        return;
      }
      case 'f11_swoop': {
        m.tele = null;
        m.vx = Math.cos(m.dir) * RAY.speed;
        m.vy = Math.sin(m.dir) * RAY.speed;
        m.face = m.dir;
        if (!m.data.hit && dist < m.r + h.r + 0.2 && canHurt(sim)) {
          api.hurtHero(sim, m.dmg, m.x - Math.cos(m.dir), m.y - Math.sin(m.dir), 7, m.kind);
          m.data.hit = 1;
        }
        const went = hypot(m.x - m.data.sx, m.y - m.data.sy);
        if (went > RAY.len + 1 || m.t > 1.2) {
          api.setMode(m, 'recover');
          m.cd = RAY.cd * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        // Выходит из пике по дуге — медленно: это окно.
        m.vx *= 0.93;
        m.vy *= 0.93;
        m.tele = null;
        if (m.t > 1.1) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Робот-садовник: стрижёт кусты, пока не разозлишь. Ножницы и поливалка.
// ---------------------------------------------------------------------------

export const GARDENER = { snip: 0.8, hose: 1, hoseLock: 0.6, hoseLen: 5.5 };

/** Разозлить садовника и соседей по саду (сеть роботов). */
function angerGardener(sim: Sim, m: Mob, api: SimApi): void {
  for (const o of sim.mobs) {
    if (o.kind !== 'f11_gardener' || o.mode !== 'f11_tend') continue;
    if (o !== m && hypot(o.x - m.x, o.y - m.y) > 5.5) continue;
    o.data.angry = 1;
    api.setMode(o, 'f11_rage');
  }
}

registerBrain('f11_gardener', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.danger = 0;
    switch (m.mode) {
      case 'f11_tend': {
        m.tele = null;
        // Ходит по грядке кругами, стрижёт, на героя не смотрит.
        m.data.tt = (m.data.tt ?? sim.rng() * 3) - dt;
        if (m.data.tt <= 0) {
          m.data.tt = 2.2 + sim.rng() * 2;
          m.data.trim = m.data.trim ? 0 : 1;
          m.data.ta = sim.rng() * TAU;
        }
        if (m.data.trim) {
          m.vx *= 0.8;
          m.vy *= 0.8;
        } else {
          const tx = m.hx + Math.cos(m.data.ta ?? 0) * 1.3;
          const ty = m.hy + Math.sin(m.data.ta ?? 0) * 1.1;
          const ex = tx - m.x;
          const ey = ty - m.y;
          const ed = hypot(ex, ey);
          if (ed > 0.2) api.steer(sim, m, ex / ed, ey / ed, m.speed * 0.4, dt);
          else m.data.trim = 1;
        }
        return;
      }
      case 'f11_rage':
        // Глаз краснеет, робот трясётся — полсекунды.
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.6) api.setMode(m, 'chase');
        return;
      case 'chase': {
        m.tele = null;
        if (m.cd <= 0 && dist < def.reach + m.r + h.r + 0.4) {
          api.setMode(m, 'f11_snip');
          m.face = Math.atan2(dy, dx);
          return;
        }
        if (m.cd <= 0 && dist > 2.4 && dist < 5.4 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'f11_hose');
          m.face = Math.atan2(dy, dx);
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'f11_snip': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const r = def.reach + m.r + 0.35;
        m.tele = { shape: 'cone', r, arc: 1.7, ang: m.face, k: m.t / GARDENER.snip };
        if (m.t > GARDENER.snip - 0.25) m.danger = r + 0.5;
        if (m.t >= GARDENER.snip) {
          if (coneHit(sim, m, r, 1.7) && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
          sim.events.push({ t: 'boss', what: 'f11_snip' });
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'f11_hose': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < GARDENER.hoseLock) turnTo(m, Math.atan2(dy, dx), 1.6, dt);
        const len = Math.min(GARDENER.hoseLen, wallDist(sim, m.x, m.y, m.face, GARDENER.hoseLen));
        lineTele(m, m.face, len, 0.55, m.t / GARDENER.hose);
        if (m.t > GARDENER.hose - 0.25) m.danger = len + 0.6;
        if (m.t >= GARDENER.hose) {
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: 0.55,
            ang: m.face,
            warn: 0,
            dmg: m.dmg * 0.55,
            knock: 10,
            status: 'chill',
            dur: 1.2,
            art: 'f11_jet',
            from: m.id,
          });
          blast(sim, { x: m.x, y: m.y, ang: m.face, arc: 0, w: 0.9, r: len + 1, k: 6.5, life: 0.55 });
          api.zone(sim, { x: m.x, y: m.y, r: len, life: 0.45, art: 'f11_jetfx', above: true, ...{ ang: m.face } } as ZoneIn);
          api.setMode(m, 'recover');
          m.cd = def.rest * 1.3;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.8);
        return;
      default:
        api.setMode(m, m.data.angry ? 'chase' : 'f11_tend');
    }
  },
  onHit(sim, m, _hit, api) {
    if (m.mode === 'f11_tend') angerGardener(sim, m, api);
    m.data.angry = 1;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Робот-страж: щит спереди, лазер по линии; после залпа остывает — открыт.
// ---------------------------------------------------------------------------

export const GUARD = { track: 0.75, lock: 0.38, len: 11, vent: 1.3, bash: 0.6, turn: 2.2 };

registerBrain('f11_guard', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.danger = 0;
    const toHero = Math.atan2(dy, dx);
    switch (m.mode) {
      case 'f11_dormant':
        // Спит статуей в нише: ждёт караула (или удара).
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        return;
      case 'f11_post': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        // Караульный: поворачивает голову, заметил — встаёт.
        m.face = PI / 2 + Math.sin(sim.time * 0.7 + m.id) * 0.9;
        if (dist < 6 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) api.setMode(m, 'f11_rise');
        return;
      }
      case 'f11_rise':
        m.vx = 0;
        m.vy = 0;
        turnTo(m, toHero, GUARD.turn, dt);
        if (m.t > 0.8) {
          api.setMode(m, 'chase');
          m.cd = 0.6;
        }
        return;
      case 'chase': {
        m.tele = null;
        turnTo(m, toHero, GUARD.turn, dt);
        if (m.cd <= 0 && dist < 1.8) {
          api.setMode(m, 'f11_bash');
          return;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (m.cd <= 0 && dist < 8.5 && see) {
          api.setMode(m, 'f11_aim');
          return;
        }
        // Держит дистанцию 3,5: ближе — пятится щитом вперёд.
        const want = dist > 4.5 ? 1 : dist < 2.6 ? -0.6 : 0;
        if (want) {
          const [cx, cy] = want > 0 ? api.chaseDir(sim, m, h.x, h.y) : [-dx / (dist || 1), -dy / (dist || 1)];
          api.steer(sim, m, cx, cy, m.speed * Math.abs(want), dt);
        } else {
          m.vx *= 0.85;
          m.vy *= 0.85;
        }
        return;
      }
      case 'f11_aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < GUARD.track) turnTo(m, toHero, GUARD.turn * 1.1, dt);
        const len = wallDist(sim, m.x, m.y, m.face, GUARD.len);
        lineTele(m, m.face, len, 0.42, m.t / (GUARD.track + GUARD.lock));
        if (m.t > GUARD.track) m.danger = len + 0.8;
        if (m.t >= GUARD.track + GUARD.lock) {
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: 0.42,
            ang: m.face,
            warn: 0,
            dmg: m.dmg * 1.1,
            knock: 3,
            status: 'burn',
            dur: 1.4,
            art: 'f11_laser',
            above: true,
            los: true,
            from: m.id,
          });
          const z = { x: m.x, y: m.y, r: len, life: 0.3, art: 'f11_laserfx', above: true, ang: m.face };
          api.zone(sim, z as ZoneIn);
          sim.events.push({ t: 'boss', what: 'f11_laser' });
          api.setMode(m, 'f11_vent');
          m.cd = 1.6 + sim.rng() * 0.6;
        }
        return;
      }
      case 'f11_vent':
        // Перегрелся: щит опущен, пар из спины — бей с любой стороны.
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        if (m.t > GUARD.vent) api.setMode(m, 'chase');
        return;
      case 'f11_bash': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        turnTo(m, toHero, 1.2, dt);
        m.tele = { shape: 'cone', r: 1.8, arc: 1.9, ang: m.face, k: m.t / GUARD.bash };
        if (m.t > GUARD.bash - 0.22) m.danger = 2.3;
        if (m.t >= GUARD.bash) {
          if (coneHit(sim, m, 1.8, 1.9) && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 7, m.kind);
          api.setMode(m, 'recover');
          m.cd = 1.2;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.7);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit, api) {
    if (m.mode === 'f11_dormant' || m.mode === 'f11_post') {
      api.setMode(m, 'f11_rise');
      return 1;
    }
    if (m.mode === 'f11_vent') return 1.6;
    // Щит спереди: удар в лицо — почти ничего; с боку и в спину — больше.
    const front = Math.abs(angDiff(hit.ang + PI, m.face)) < 1.15;
    if (front) return hit.heavy ? 0.3 : 0.1;
    void sim;
    return 1.3;
  },
});

// ---------------------------------------------------------------------------
// Гарпия: висит между героем и серединой острова, порыв конусом — к краю.
// ---------------------------------------------------------------------------

export const HARPY = { flap: 0.85, lock: 0.5, r: 4.6, arc: 1.1, claw: 0.5 };

registerBrain('f11_harpy', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.danger = 0;
    switch (m.mode) {
      case 'f11_perch':
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        m.face = Math.atan2(dy, dx);
        if (dist < 6.5) {
          api.setMode(m, 'chase');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        }
        return;
      case 'chase': {
        m.tele = null;
        // Встать так, чтобы порыв гнал героя к ближнему краю.
        const e = edgeDir(sim, h.x, h.y, 5);
        let tx: number;
        let ty: number;
        if (e !== null) {
          tx = h.x - Math.cos(e) * 3.2;
          ty = h.y - Math.sin(e) * 3.2;
        } else {
          const a = Math.atan2(m.y - h.y, m.x - h.x) + 0.5;
          tx = h.x + Math.cos(a) * 3.4;
          ty = h.y + Math.sin(a) * 3.4;
        }
        flyTo(sim, m, api, tx, ty, m.speed, dt);
        m.face = Math.atan2(dy, dx);
        if (m.cd <= 0 && dist < 1.7) {
          api.setMode(m, 'f11_claw');
          m.dir = Math.atan2(dy, dx);
          return;
        }
        if (m.cd <= 0 && dist > 1.8 && dist < HARPY.r && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'f11_flap');
          m.dir = Math.atan2(dy, dx);
        }
        return;
      }
      case 'f11_flap': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t < HARPY.lock) m.dir += clamp(angDiff(Math.atan2(dy, dx), m.dir), -2.4 * dt, 2.4 * dt);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: HARPY.r, arc: HARPY.arc, ang: m.dir, k: m.t / HARPY.flap };
        if (m.t > HARPY.flap - 0.25) m.danger = HARPY.r + 0.4;
        if (m.t >= HARPY.flap) {
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: HARPY.r,
            ang: m.dir,
            arc: HARPY.arc,
            warn: 0,
            dmg: m.dmg * 0.35,
            knock: 9,
            art: 'f11_gustcone',
            from: m.id,
          });
          blast(sim, { x: m.x, y: m.y, ang: m.dir, arc: HARPY.arc, w: 0, r: HARPY.r + 0.8, k: 7.5, life: 0.65 });
          api.zone(sim, { x: m.x, y: m.y, r: HARPY.r, life: 0.5, art: 'f11_flapfx', above: true, ...{ ang: m.dir } } as ZoneIn);
          sim.events.push({ t: 'boss', what: 'f11_flap' });
          api.setMode(m, 'recover');
          m.cd = def.rest * 1.6;
        }
        return;
      }
      case 'f11_claw': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        lineTele(m, m.dir, 2.4, 0.45, m.t / HARPY.claw);
        if (m.t > HARPY.claw - 0.2) m.danger = 2.6;
        if (m.t >= HARPY.claw) {
          api.setMode(m, 'f11_lunge');
          m.data.hit = 0;
        }
        return;
      }
      case 'f11_lunge':
        m.tele = null;
        m.vx = Math.cos(m.dir) * 9;
        m.vy = Math.sin(m.dir) * 9;
        if (!m.data.hit && dist < m.r + h.r + 0.25 && canHurt(sim)) {
          api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          m.data.hit = 1;
        }
        if (m.t > 0.26) {
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      case 'recover':
        m.tele = null;
        // Отлетает назад — это окно.
        api.steer(sim, m, -dx / (dist || 1), -dy / (dist || 1), m.speed * 0.5, dt);
        if (m.t > 1.1) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Облачная медуза: плывёт по ветру, жалит кольцом (холод).
// ---------------------------------------------------------------------------

export const JELLY = { zap: 0.95, r: 1.45, w: 0.55 };

registerBrain('f11_jelly', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        // Медленно к герою; остальное делает ветер.
        const bob = Math.sin(sim.time * 2 + m.id) * 0.3;
        api.steer(sim, m, dx / (dist || 1), dy / (dist || 1) + bob, m.speed, dt);
        if (m.cd <= 0 && dist < JELLY.r + 0.55) api.setMode(m, 'f11_zap');
        return;
      }
      case 'f11_zap':
        m.vx *= 0.85;
        m.vy *= 0.85;
        m.tele = { shape: 'ring', r: JELLY.r, w: JELLY.w, k: m.t / JELLY.zap };
        if (m.t > JELLY.zap - 0.25) m.danger = JELLY.r + JELLY.w + 0.4;
        if (m.t >= JELLY.zap) {
          api.strike(sim, {
            shape: 'ring',
            x: m.x,
            y: m.y,
            r: JELLY.r,
            w: JELLY.w,
            warn: 0,
            dmg: m.dmg,
            knock: 3,
            status: 'chill',
            dur: 1.6,
            art: 'f11_zapring',
            from: m.id,
          });
          sim.events.push({ t: 'boss', what: 'f11_zap' });
          api.setMode(m, 'recover');
          m.cd = def.rest * 1.4;
        }
        return;
      case 'recover':
        recoverStep(m, api, 1);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    // Лопнула — облачко: вязнешь и мёрзнешь.
    api.zone(sim, { x: m.x, y: m.y, r: 1.3, life: 2.6, slow: 0.6, art: 'f11_puff' });
    void sim;
  },
});

// ---------------------------------------------------------------------------
// Абордажник: прилетает на планере, крюк тянет к себе, сабля вплотную.
// ---------------------------------------------------------------------------

export const BOARDER = { land: 0.95, aim: 0.75, lock: 0.45, slash: 0.55, reel: 0.45 };

registerBrain('f11_boarder', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const st = stateOf(sim);
    m.danger = 0;
    switch (m.mode) {
      case 'f11_land':
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        if (m.t >= BOARDER.land) {
          m.data.ghost = 0;
          api.setMode(m, 'recover');
          m.cd = 0.6;
          sim.events.push({ t: 'emerge', x: m.x, y: m.y });
        }
        return;
      case 'chase': {
        m.tele = null;
        if (m.cd <= 0 && dist < 1.7) {
          api.setMode(m, 'f11_slash');
          m.face = Math.atan2(dy, dx);
          return;
        }
        if (m.cd <= 0 && !m.data.hook && dist > 2.4 && dist < 6.2 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'f11_aimhook');
          m.face = Math.atan2(dy, dx);
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 3 ? 0.7 : 1), dt);
        return;
      }
      case 'f11_aimhook': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < BOARDER.lock) turnTo(m, Math.atan2(dy, dx), 3.2, dt);
        lineTele(m, m.face, 6.5, 0.32, m.t / BOARDER.aim);
        if (m.t > BOARDER.aim - 0.25) m.danger = 6.8;
        if (m.t >= BOARDER.aim) {
          throwHook(sim, st, api, m, m.face);
          sim.events.push({ t: 'boss', what: 'f11_hook_throw' });
          api.setMode(m, 'f11_throw');
        }
        return;
      }
      case 'f11_throw':
        // Крюк летит; не попал — наматывает (окно), попал — сабля.
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.tele = null;
        if (!m.data.hook || m.t > 1.8) {
          api.setMode(m, 'recover');
          m.cd = def.rest * 1.2;
        }
        return;
      case 'f11_reel': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'cone', r: 1.7, arc: 1.8, ang: m.face, k: m.t / BOARDER.reel };
        if (m.t > BOARDER.reel - 0.2) m.danger = 2.2;
        if (m.t >= BOARDER.reel) {
          if (coneHit(sim, m, 1.7, 1.8) && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
          sim.events.push({ t: 'boss', what: 'whip' });
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'f11_slash': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.tele = { shape: 'cone', r: 1.6, arc: 1.7, ang: m.face, k: m.t / BOARDER.slash };
        if (m.t > BOARDER.slash - 0.22) m.danger = 2.1;
        if (m.t >= BOARDER.slash) {
          if (coneHit(sim, m, 1.6, 1.7) && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.7);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Мох-пружина: прячется в мху, прыгает навесом; в прыжке его сносит ветер —
// и метка приземления едет вместе с ним.
// ---------------------------------------------------------------------------

export const MOSS = { crouch: 0.4, air: 0.8, r: 1.35, hops: 3, tired: 1.5 };

registerBrain('f11_moss', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const st = stateOf(sim);
    m.danger = 0;
    switch (m.mode) {
      case 'f11_hide':
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        m.data.ghost = 1;
        if (dist < 2.8 && !heroDown(sim)) api.setMode(m, 'f11_pop');
        return;
      case 'f11_pop':
        m.data.ghost = 0;
        m.vx = 0;
        m.vy = 0;
        if (m.t === dt) sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        if (m.t > 0.45) {
          api.setMode(m, 'chase');
          m.data.hops = 0;
          m.cd = 0.2;
        }
        return;
      case 'chase': {
        m.tele = null;
        if (m.cd <= 0 && dist > 1 && dist < 5.6) {
          // Цель — где герой будет, но только по полу и без неба на пути.
          let tx = h.x + h.vx * 0.3;
          let ty = h.y + h.vy * 0.3;
          for (let k = 0; k < 6 && !(standable(sim, tx, ty) && floorLine(sim, m.x, m.y, tx, ty)); k++) {
            tx = m.x + (tx - m.x) * 0.7;
            ty = m.y + (ty - m.y) * 0.7;
          }
          if (standable(sim, tx, ty) && floorLine(sim, m.x, m.y, tx, ty)) {
            m.data.tx = tx;
            m.data.ty = ty;
            api.setMode(m, 'f11_crouch');
            return;
          }
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'f11_crouch':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = { shape: 'circle', r: MOSS.r, x: m.data.tx, y: m.data.ty, k: (m.t / (MOSS.crouch + MOSS.air)) * 0.9 };
        if (m.t >= MOSS.crouch) {
          api.setMode(m, 'f11_jump');
          m.data.sx = m.x;
          m.data.sy = m.y;
          m.data.ghost = 1;
          m.data.nowind = 1;
          sim.events.push({ t: 'boss', what: 'f11_boing' });
        }
        return;
      case 'f11_jump': {
        const k = Math.min(1, m.t / MOSS.air);
        // Ветер сносит летящего — и метку с ним, но только по полу.
        const [wx, wy] = windAt(st, m.x, m.y);
        const nx = m.data.tx + wx * 0.7 * dt;
        const ny = m.data.ty + wy * 0.7 * dt;
        if (standable(sim, nx, ny)) {
          m.data.tx = nx;
          m.data.ty = ny;
        }
        m.x = m.data.sx + (m.data.tx - m.data.sx) * k;
        m.y = m.data.sy + (m.data.ty - m.data.sy) * k;
        m.vx = 0;
        m.vy = 0;
        m.data.z = Math.sin(k * PI) * 2.2;
        m.tele = { shape: 'circle', r: MOSS.r, x: m.data.tx, y: m.data.ty, k: 0.4 + 0.6 * k };
        if (k > 0.72) m.danger = hypot(m.data.tx - m.x, m.data.ty - m.y) + MOSS.r + 0.4;
        if (k >= 1) {
          m.data.ghost = 0;
          m.data.nowind = 0;
          m.data.z = 0;
          m.tele = null;
          if (hypot(h.x - m.x, h.y - m.y) < MOSS.r + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 8, m.kind);
          api.zone(sim, { x: m.x, y: m.y, r: MOSS.r, life: 0.4, art: 'f11_mossland' });
          sim.events.push({ t: 'boss', what: 'f11_moss_land' });
          m.data.hops = (m.data.hops ?? 0) + 1;
          if (m.data.hops >= MOSS.hops) api.setMode(m, 'f11_tired');
          else {
            api.setMode(m, 'chase');
            m.cd = 0.45;
          }
        }
        return;
      }
      case 'f11_tired':
        // Выдохся: сплющен, бей — окно.
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.tele = null;
        if (m.t > MOSS.tired) {
          api.setMode(m, 'chase');
          m.data.hops = 0;
          m.cd = 1;
        }
        return;
      default:
        m.data.ghost = 0;
        m.data.nowind = 0;
        api.setMode(m, 'chase');
    }
    void dx;
    void dy;
  },
  onHit(_sim, m) {
    return m.mode === 'f11_tired' ? 1.5 : 1;
  },
});

// ---------------------------------------------------------------------------
// Ветряной дух: прозрачный вихрь — не достать; бросает смерч и тогда открыт.
// ---------------------------------------------------------------------------

export const SPIRIT = { cast: 1.05, rest: 1.35, cd: 3.4 };

registerBrain('f11_spirit', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const st = stateOf(sim);
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.data.ghost = 1;
        const a = Math.atan2(m.y - h.y, m.x - h.x) + 0.4 * (m.id % 2 ? 1 : -1);
        flyTo(sim, m, api, h.x + Math.cos(a) * 4.6, h.y + Math.sin(a) * 4.6, m.speed, dt);
        m.face = Math.atan2(dy, dx);
        const mine = st.tornados.filter((t) => t.from === m.id).length;
        if (m.cd <= 0 && !mine && dist < 7.5 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'cast');
          m.data.ghost = 0;
          sim.events.push({ t: 'boss', what: 'f11_spirit_call' });
        }
        return;
      }
      case 'cast':
        // Собирается в плотный вихрь — сейчас его видно и можно бить.
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.data.ghost = 0;
        m.face = Math.atan2(dy, dx);
        lineTele(m, m.face, 3.4, 0.7, m.t / SPIRIT.cast);
        if (m.t >= SPIRIT.cast) {
          spawnTornado(sim, st, api, m, m.face);
          api.setMode(m, 'recover');
          m.cd = SPIRIT.cd;
        }
        return;
      case 'recover':
        m.data.ghost = 0;
        m.tele = null;
        m.vx *= 0.9;
        m.vy *= 0.9;
        if (m.t > SPIRIT.rest) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Дрон-разведчик: кружит, прицел линией, два выстрела — их сносит ветер.
// ---------------------------------------------------------------------------

export const DRONE = { aim: 0.6, orbit: 4.4, gap: 0.16 };

registerBrain('f11_drone', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        const a = Math.atan2(m.y - h.y, m.x - h.x) + 0.6 * (m.id % 2 ? 1 : -1);
        flyTo(sim, m, api, h.x + Math.cos(a) * DRONE.orbit, h.y + Math.sin(a) * DRONE.orbit, m.speed, dt);
        m.face = Math.atan2(dy, dx);
        if (m.cd <= 0 && dist < 7.5 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'aim');
          m.dir = Math.atan2(dy, dx);
        }
        return;
      }
      case 'aim':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t < DRONE.aim - 0.2) m.dir += clamp(angDiff(Math.atan2(dy, dx), m.dir), -3 * dt, 3 * dt);
        m.face = m.dir;
        lineTele(m, m.dir, 6, 0.24, m.t / DRONE.aim);
        if (m.t > DRONE.aim - 0.2) m.danger = 3;
        if (m.t >= DRONE.aim) {
          api.shoot(sim, m, m.dir);
          api.setMode(m, 'f11_burst');
        }
        return;
      case 'f11_burst':
        m.tele = null;
        if (m.t >= DRONE.gap) {
          api.shoot(sim, m, m.dir + (sim.rng() - 0.5) * 0.12);
          api.setMode(m, 'recover');
          m.cd = def.rest * 2 + sim.rng() * 0.6;
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.8);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Жук-копилка: удирает по ветру, от ударов сыплет монеты.
// ---------------------------------------------------------------------------

registerBrain('f11_beetle', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const st = stateOf(sim);
    m.danger = 0;
    m.tele = null;
    switch (m.mode) {
      case 'flee':
      case 'chase': {
        if (m.mode === 'chase') api.setMode(m, 'flee');
        let fx = -dx / (dist || 1);
        let fy = -dy / (dist || 1);
        const fl = api.flowDir(sim, m.x, m.y, true);
        if (fl) {
          fx = fx * 0.4 + fl[0] * 0.6;
          fy = fy * 0.4 + fl[1] * 0.6;
        }
        // По ветру — быстрее: ветер сам несёт его к краю острова.
        const [wx, wy] = windAt(st, m.x, m.y);
        fx += wx * 0.12;
        fy += wy * 0.12;
        const l = hypot(fx, fy) || 1;
        api.steer(sim, m, fx / l, fy / l, m.speed * (dist < 4 ? 1 : 0.6), dt);
        if (m.t > 20) {
          // Улетел: расправил крылья — и в небо.
          api.setMode(m, 'escape');
          m.hp = 0;
        }
        return;
      }
      default:
        api.setMode(m, 'flee');
    }
  },
  onHit(sim, m, _hit, api) {
    for (let i = 0; i < 2; i++) api.dropAt(sim, 'coin', 45, m.x, m.y);
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Щитовой пилон (Древний страж, «Защитный протокол»): стоит, держит купол.
// ---------------------------------------------------------------------------

registerBrain('f11_pylon', {
  raw: true,
  step(_sim, m) {
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.tele = null;
    if (m.mode !== 'f11_pylon' && m.mode !== 'dying') m.mode = 'f11_pylon';
  },
});

// ---------------------------------------------------------------------------
// Древний страж — робот в три клетки на арене «Сердце замка».
//   1. ВЗГЛЯД: глаз ведёт героя красной линией, замирает — луч. Кулак сверху
//      по метке. Ветер над ареной тихо кружит.
//   2. ЗАЩИТНЫЙ ПРОТОКОЛ (75%): купол держат три пилона по краю арены —
//      разбей их, купол падает, страж на колене (удар ×1,7). Ракеты навесом
//      (метки едут по ветру), вихрь по кругу арены.
//   3. ПЕРЕГРЕВ (50%): грудь открыта — ядро светится (спереди ×2, со спины
//      меньше); два луча по кругу (рывок сквозь — или держись ближе, но
//      тогда топот); из решёток пола бьёт пар.
//   4. ПАДЕНИЕ ОСТРОВА (25%): край арены трещит и уходит в небо кольцами,
//      ветер тянет к обрыву, порывы к краю с фронтом за секунду.
// ---------------------------------------------------------------------------

export const BOSS = {
  wake: 2.4,
  shift: 1.3,
  gazeTrack: 1.05,
  gazeLock: 0.38,
  gazeLen: 15,
  gazeW: 0.5,
  slamWarn: 0.9,
  slamR: 1.8,
  stompWarn: 0.65,
  stompR: 2.3,
  stompW: 1,
  rocketWind: 0.7,
  rockets: 5,
  spinCharge: 0.95,
  spinDur: 3.3,
  spinW: 1.2,
  beamR0: 1.7,
  beamLen: 13,
  stagger: 5.5,
  pylonBack: 16,
  notches: [0.75, 0.5, 0.25],
};

const ROCKET = {
  speed: 7.5,
  r: 0.95,
  life: 3,
  dmg: 1,
  art: 'f11_rocket',
  lob: true,
  onLand: { r: 0.9, life: 1.1, dps: 0.03, art: 'f11_scorch' },
};

const bossOf = (sim: Sim) => sim.mobs.find((m) => m.kind === 'f11boss' && m.mode !== 'dying');

registerBrain('f11boss', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const b = sim.boss;
    const ph = b?.phase ?? 1;
    const toHero = Math.atan2(dy, dx);
    m.danger = 0;
    m.kx *= 0.5;
    m.ky *= 0.5;
    switch (m.mode) {
      case 'roar':
      case 'f11_wake':
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        if (m.mode === 'roar') api.setMode(m, 'f11_wake');
        if (m.t >= BOSS.wake) {
          api.setMode(m, 'chase');
          m.cd = 0.6;
        }
        return;
      case 'f11_shift':
        // Смена протокола: встаёт, гудит, ядро перестраивается.
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        if (m.t >= BOSS.shift) {
          api.setMode(m, 'chase');
          m.cd = 0.5;
        }
        return;
      case 'f11_stagger':
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        if (m.t >= BOSS.stagger) {
          api.setMode(m, 'chase');
          m.cd = 0.4;
        }
        return;
      case 'chase': {
        m.tele = null;
        turnTo(m, toHero, 1.5, dt);
        if (dist > 3.4) {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, cx, cy, m.speed * (ph === 4 ? 1.15 : 1), dt);
        } else {
          m.vx *= 0.8;
          m.vy *= 0.8;
        }
        if (m.cd > 0 || heroDown(sim) || !b) return;
        const bd = b.data;
        if (ph === 3 && (bd.spinCd ?? 0) <= 0) {
          api.setMode(m, 'f11_spin');
          m.data.sa = m.face;
          m.data.sdir = sim.rng() < 0.5 ? 1 : -1;
          sim.events.push({ t: 'boss', what: 'f11_spin_call' });
          return;
        }
        if (dist < 2.9) {
          api.setMode(m, ph >= 3 ? 'f11_stomp' : 'f11_slam');
          m.data.tx = h.x;
          m.data.ty = h.y;
          return;
        }
        if ((ph === 2 || ph === 4) && (bd.rocketCd ?? 0) <= 0) {
          api.setMode(m, 'f11_rockets');
          m.data.fired = 0;
          return;
        }
        if (dist < 6 && sim.rng() < 0.4) {
          api.setMode(m, 'f11_slam');
          m.data.tx = h.x;
          m.data.ty = h.y;
          return;
        }
        api.setMode(m, 'f11_gaze');
        return;
      }
      case 'f11_gaze': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < BOSS.gazeTrack) turnTo(m, toHero, 2.3, dt);
        const len = wallDist(sim, m.x, m.y, m.face, BOSS.gazeLen);
        lineTele(m, m.face, len, BOSS.gazeW, m.t / (BOSS.gazeTrack + BOSS.gazeLock));
        if (m.t > BOSS.gazeTrack) m.danger = len + 1;
        if (m.t >= BOSS.gazeTrack + BOSS.gazeLock) {
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: BOSS.gazeW,
            ang: m.face,
            warn: 0,
            dmg: m.dmg * 1.25,
            knock: 4,
            status: 'burn',
            dur: 1.6,
            art: 'f11_beam',
            above: true,
            los: true,
            from: m.id,
          });
          api.zone(sim, { x: m.x, y: m.y, r: len, life: 0.35, art: 'f11_beamfx', above: true, ...{ ang: m.face } } as ZoneIn);
          sim.events.push({ t: 'boss', what: 'f11_beam' });
          sim.events.push({ t: 'shake', k: 0.2 });
          api.setMode(m, 'recover');
          m.cd = ph === 4 ? 0.9 : 1.2;
        }
        return;
      }
      case 'f11_slam': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        turnTo(m, Math.atan2(m.data.ty - m.y, m.data.tx - m.x), 2, dt);
        m.tele = { shape: 'circle', r: BOSS.slamR, x: m.data.tx, y: m.data.ty, k: m.t / BOSS.slamWarn };
        if (m.t > BOSS.slamWarn - 0.25) m.danger = hypot(m.data.tx - m.x, m.data.ty - m.y) + BOSS.slamR + 0.4;
        if (m.t >= BOSS.slamWarn) {
          api.strike(sim, {
            shape: 'circle',
            x: m.data.tx,
            y: m.data.ty,
            r: BOSS.slamR,
            warn: 0,
            dmg: m.dmg * 1.2,
            knock: 9,
            art: 'f11_slam',
            from: m.id,
          });
          sim.events.push({ t: 'shake', k: 0.45 });
          api.setMode(m, 'recover');
          m.cd = ph === 4 ? 0.8 : 1.1;
        }
        return;
      }
      case 'f11_stomp':
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.tele = { shape: 'ring', r: BOSS.stompR, w: BOSS.stompW, k: m.t / BOSS.stompWarn };
        if (m.t > BOSS.stompWarn - 0.22) m.danger = BOSS.stompR + BOSS.stompW + 0.4;
        if (m.t >= BOSS.stompWarn) {
          api.strike(sim, {
            shape: 'ring',
            x: m.x,
            y: m.y,
            r: BOSS.stompR,
            w: BOSS.stompW,
            warn: 0,
            dmg: m.dmg,
            knock: 10,
            art: 'f11_stomp',
            from: m.id,
          });
          sim.events.push({ t: 'shake', k: 0.4 });
          api.setMode(m, 'recover');
          m.cd = 1;
        }
        return;
      case 'f11_rockets': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = null;
        turnTo(m, toHero, 1.5, dt);
        const shotAt = BOSS.rocketWind + (m.data.fired ?? 0) * 0.13;
        if (m.t >= shotAt && (m.data.fired ?? 0) < BOSS.rockets) {
          const k = m.data.fired ?? 0;
          let tx = h.x + h.vx * 0.3;
          let ty = h.y + h.vy * 0.3;
          if (k > 0) {
            const a = sim.rng() * TAU;
            const r = 1.2 + sim.rng() * 1.6;
            const px = tx + Math.cos(a) * r;
            const py = ty + Math.sin(a) * r;
            if (standable(sim, px, py)) {
              tx = px;
              ty = py;
            }
          }
          api.shoot(sim, m, Math.atan2(ty - m.y, tx - m.x), ROCKET, tx, ty);
          m.data.fired = k + 1;
          if (k === 0) sim.events.push({ t: 'boss', what: 'f11_rockets' });
        }
        if ((m.data.fired ?? 0) >= BOSS.rockets && m.t > shotAt + 0.3) {
          if (b) b.data.rocketCd = ph === 4 ? 7 : 5.5;
          api.setMode(m, 'recover');
          m.cd = 0.8;
        }
        return;
      }
      case 'f11_spin': {
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        const live = m.t > BOSS.spinCharge;
        if (live) m.data.sa += m.data.sdir * BOSS.spinW * dt;
        m.face = m.data.sa;
        if (live && canHurt(sim))
          for (const a of [m.data.sa, m.data.sa + PI]) {
            const x0 = m.x + Math.cos(a) * BOSS.beamR0;
            const y0 = m.y + Math.sin(a) * BOSS.beamR0;
            const len = wallDist(sim, x0, y0, a, BOSS.beamLen);
            if (lineHits(x0, y0, a, len, 0.42, h.x, h.y, h.r)) {
              api.hurtHero(sim, m.dmg * 0.9, m.x, m.y, 5, m.kind, { kind: 'burn', dur: 1.2 });
              break;
            }
          }
        // Уклон: луч вот-вот накроет — рывок засчитается.
        if (live) {
          const ha = Math.atan2(h.y - m.y, h.x - m.x);
          for (const a of [m.data.sa, m.data.sa + PI]) {
            const ahead = angDiff(ha, a) * m.data.sdir;
            if (ahead > 0 && ahead < 0.3) m.danger = BOSS.beamLen;
          }
        }
        if (m.t >= BOSS.spinCharge + BOSS.spinDur) {
          if (b) b.data.spinCd = 7.5;
          api.setMode(m, 'recover');
          m.cd = 1;
        }
        return;
      }
      case 'recover':
        m.tele = null;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.55) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit) {
    const b = sim.boss;
    if (!b) return 1;
    if (b.data.shield) return 0;
    if (m.mode === 'f11_shift') return 0;
    if (m.mode === 'f11_stagger') return 1.7;
    if (b.phase === 3) {
      // Ядро на груди: спереди — вдвое, со спины — меньше.
      const front = Math.abs(angDiff(hit.ang + PI, m.face)) < 1.1;
      return front ? 2 : 0.8;
    }
    return 1;
  },
});

/** Центр арены — середина её пола. */
function arenaCenter(sim: Sim, b: BossFight): [number, number] {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const i of b.cells) {
    const t = sim.tiles[i];
    if (!walkable(t)) continue;
    const mk = sim.world.mark[i];
    if (mk !== MK.arena && mk !== MK.mosaic && mk !== MK.vent) continue;
    x += (i % sim.world.w) + 0.5;
    y += Math.floor(i / sim.world.w) + 0.5;
    n += 1;
  }
  return n ? [x / n, y / n] : [b.obj.x + 0.5, b.obj.y + 1.5];
}

function raisePylons(sim: Sim, st: F11State, b: BossFight, api: SimApi): void {
  const a = st.arena;
  const ids: number[] = [];
  for (const deg of [-90, 30, 150]) {
    const r = (deg * PI) / 180;
    let x = a.cx + Math.cos(r) * 6.2;
    let y = a.cy + Math.sin(r) * 6.2;
    if (!standable(sim, x, y)) {
      const p = spotNear(sim, x, y, 0, 1.8, (px, py) => hypot(px - a.cx, py - a.cy));
      if (p) [x, y] = p;
    }
    const m = api.spawnMob(sim, 'f11_pylon', Math.floor(x) + 0.5, Math.floor(y) + 0.5, { mode: 'f11_pylon' });
    ids.push(m.id);
    const z = { x: m.x, y: m.y, r: 0.5, life: 1e9, art: 'f11_pylonbeam', above: true, pylon: m.id };
    api.zone(sim, z as ZoneIn);
  }
  b.data.shield = 1;
  b.data.p0 = ids[0];
  b.data.p1 = ids[1];
  b.data.p2 = ids[2];
  b.data.pylonT = 0;
}

function pylonsAlive(sim: Sim, b: BossFight): number {
  let n = 0;
  for (const k of ['p0', 'p1', 'p2'])
    if (sim.mobs.some((m) => m.id === b.data[k] && m.mode !== 'dying')) n += 1;
  return n;
}

function dropPylons(sim: Sim): void {
  for (const m of sim.mobs)
    if (m.kind === 'f11_pylon' && m.mode !== 'dying') {
      m.mode = 'escape';
      m.t = 0;
      m.hp = 0;
    }
  sim.zones = sim.zones.filter((z) => z.art !== 'f11_pylonbeam');
}

/** Клетки края арены дальше `r` от центра — кроме дорожки к воротам. */
function ringCells(sim: Sim, st: F11State, b: BossFight, r: number): number[] {
  const a = st.arena;
  const W = sim.world.w;
  const gx = b.gates.map((g) => (g % W) + 0.5);
  const gmin = Math.min(...gx) - 1.2;
  const gmax = Math.max(...gx) + 1.2;
  const out: number[] = [];
  for (const i of b.cells) {
    if (!walkable(sim.tiles[i])) continue;
    const x = (i % W) + 0.5;
    const y = Math.floor(i / W) + 0.5;
    const d = hypot(x - a.cx, y - a.cy);
    if (d <= r) continue;
    if (x > gmin && x < gmax && y > a.cy) continue;
    out.push(i);
  }
  return out;
}

function enterPhase(sim: Sim, st: F11State, b: BossFight, boss: Mob, api: SimApi, n: number): void {
  b.phase = n;
  st.arena.phase = n;
  api.setMode(boss, 'f11_shift');
  sim.events.push({ t: 'shake', k: 0.5 });
  if (n === 2) {
    raisePylons(sim, st, b, api);
    st.arena.mode = 2;
    st.arena.k = 3;
    b.data.rocketCd = 2.5;
    api.light(sim, 'f11core', { x: boss.x, y: boss.y, r: 3.6, tint: 'cold' });
    sim.events.push({
      t: 'boss',
      what: 'phase',
      text: 'ЗАЩИТНЫЙ ПРОТОКОЛ',
      sub: 'купол держат три пилона — разбей их',
    });
  } else if (n === 3) {
    dropPylons(sim);
    b.data.shield = 0;
    st.arena.mode = 3;
    st.arena.k = 0;
    b.data.spinCd = 1.8;
    b.data.ventT = 2;
    api.light(sim, 'f11core', { x: boss.x, y: boss.y, r: 4.6, tint: 'red' });
    sim.events.push({
      t: 'boss',
      what: 'phase',
      text: 'ПЕРЕГРЕВ',
      sub: 'ядро открыто — бей в грудь; лучи идут по кругу',
    });
  } else if (n === 4) {
    st.arena.mode = 4;
    st.arena.k = 2;
    st.arena.gust = 0;
    st.arena.gustT = 5;
    b.data.rocketCd = 3;
    b.data.ring = 0;
    b.data.crumbleT = 0.5;
    api.light(sim, 'f11core', { x: boss.x, y: boss.y, r: 4, tint: 'warm' });
    sim.events.push({
      t: 'boss',
      what: 'phase',
      text: 'ПАДЕНИЕ ОСТРОВА',
      sub: 'край уходит в небо — ветер тянет к обрыву',
    });
  }
}

/** Кольцо края: трещит 2 с, потом уходит в небо. */
function crumbleRing(sim: Sim, st: F11State, b: BossFight, api: SimApi, r: number): void {
  const cells = ringCells(sim, st, b, r);
  for (const i of cells) setCell(sim, st, api, i, T_FLOOR, MK.cracking);
  sim.events.push({ t: 'boss', what: 'f11_crumble_trap', text: 'КРАЙ ТРЕЩИТ', sub: 'отойди к середине' });
  after(st, 2, () => {
    if (sim.boss?.state !== 'fight' && sim.boss?.state !== 'won') return;
    for (const i of cells) if (sim.world.mark[i] === MK.cracking) sinkCell(sim, st, api, i, MK.fallen);
    sim.events.push({ t: 'shake', k: 0.6 });
    sim.events.push({ t: 'boss', what: 'f11_crumble_fall' });
  });
}

registerBoss('f11boss', {
  start(sim, b, lead, api) {
    const st = stateOf(sim);
    const [cx, cy] = arenaCenter(sim, b);
    b.phase = 1;
    b.data = { shield: 0, spinCd: 5, rocketCd: 2, ventT: 2, pylonT: 0, ring: 0, crumbleT: 0 };
    st.arena = { ...st.arena, mode: 1, cx, cy, k: 1.1, gust: 0, gustT: 0, phase: 1 };
    api.setMode(lead, 'f11_wake');
    lead.face = PI / 2;
    api.camera(sim, lead.x, lead.y + 0.5, 2.6);
    api.light(sim, 'f11core', { x: lead.x, y: lead.y, r: 3.2, tint: 'teal' });
    sim.events.push({
      t: 'boss',
      what: 'f11_wake_call',
      text: 'ДРЕВНИЙ СТРАЖ',
      sub: 'взгляд — красная линия на полу: уйди с неё',
    });
  },
  step(sim, b, dt, api) {
    const st = stateOf(sim);
    const boss = bossOf(sim);
    if (!boss) return;
    const frac = boss.hp / boss.maxHp;
    if (boss.mode !== 'f11_wake' && boss.mode !== 'roar' && boss.mode !== 'f11_shift') {
      if (b.phase === 1 && frac < BOSS.notches[0]) enterPhase(sim, st, b, boss, api, 2);
      else if (b.phase === 2 && frac < BOSS.notches[1]) enterPhase(sim, st, b, boss, api, 3);
      else if (b.phase === 3 && frac < BOSS.notches[2]) enterPhase(sim, st, b, boss, api, 4);
    }
    const bd = b.data;
    bd.spinCd = (bd.spinCd ?? 0) - dt;
    bd.rocketCd = (bd.rocketCd ?? 0) - dt;
    api.light(sim, 'f11core', {
      x: boss.x,
      y: boss.y - 0.6,
      r: b.phase === 3 ? 4.6 : 3.4,
      tint: b.phase === 3 ? 'red' : b.phase === 2 ? 'cold' : b.phase === 4 ? 'warm' : 'teal',
    });
    const a = st.arena;
    if (b.phase === 2) {
      // Купол: пилоны пали — страж на колене; через 16 с встают снова.
      if (bd.shield && !pylonsAlive(sim, b)) {
        bd.shield = 0;
        bd.pylonT = 0;
        api.setMode(boss, 'f11_stagger');
        sim.zones = sim.zones.filter((z) => z.art !== 'f11_pylonbeam');
        sim.events.push({ t: 'boss', what: 'f11_shield_trap', text: 'КУПОЛ ПАЛ', sub: 'страж на колене — бей!' });
        sim.events.push({ t: 'flash', color: '#bfe8ff', k: 0.6 });
      } else if (!bd.shield) {
        bd.pylonT = (bd.pylonT ?? 0) + dt;
        if (bd.pylonT > BOSS.pylonBack && boss.mode !== 'f11_stagger') {
          raisePylons(sim, st, b, api);
          sim.events.push({ t: 'boss', what: 'f11_shield_call', text: 'КУПОЛ СНОВА', sub: 'пилоны поднялись' });
        }
      }
      a.k = 3;
    } else if (b.phase === 3) {
      // Пар из решёток пола — метка, потом струя.
      bd.ventT = (bd.ventT ?? 0) - dt;
      if (bd.ventT <= 0) {
        bd.ventT = 2.5;
        const vents: number[] = [];
        for (const i of b.cells) if (sim.world.mark[i] === MK.vent && walkable(sim.tiles[i])) vents.push(i);
        const h = sim.hero;
        vents.sort(
          (p, q) =>
            hypot((p % st.w) + 0.5 - h.x, Math.floor(p / st.w) + 0.5 - h.y) -
            hypot((q % st.w) + 0.5 - h.x, Math.floor(q / st.w) + 0.5 - h.y),
        );
        for (const i of vents.slice(0, 4))
          api.zone(sim, {
            x: (i % st.w) + 0.5,
            y: Math.floor(i / st.w) + 0.5,
            r: 1.05,
            warn: 0.8,
            life: 1.3,
            dps: 0.06,
            status: 'burn',
            dur: 1,
            art: 'f11_steam',
          });
      }
    } else if (b.phase === 4) {
      // Край уходит кольцами.
      bd.crumbleT = (bd.crumbleT ?? 0) - dt;
      if (bd.crumbleT <= 0 && (bd.ring ?? 0) < 2) {
        crumbleRing(sim, st, b, api, bd.ring ? 6.1 : 7.5);
        bd.ring = (bd.ring ?? 0) + 1;
        bd.crumbleT = 13;
      }
      // Порыв к краю: фронт секунду, удар полторы.
      a.gustT -= dt;
      if (a.gust === 0 && a.gustT <= 1) {
        a.gust = 1;
        sim.events.push({ t: 'boss', what: 'f11_gust' });
      }
      if (a.gust === 1 && a.gustT <= 0) {
        a.gust = 2;
        a.gustT = 1.4;
        sim.events.push({ t: 'boss', what: 'f11_gust_blow' });
        sim.events.push({ t: 'shake', k: 0.25 });
      }
      if (a.gust === 2) {
        a.k = 5.6;
        if (a.gustT <= 0) {
          a.gust = 0;
          a.gustT = 6.5;
        }
      } else a.k = 2;
    }
  },
  onPartDown(sim, _b, m) {
    if (m.kind !== 'f11boss') return false;
    const st = stateOf(sim);
    dropPylons(sim);
    st.arena.mode = 0;
    st.arena.k = 0;
    st.arena.gust = 0;
    st.arena.phase = 0;
    return false;
  },
  notches() {
    return BOSS.notches;
  },
  reset(sim, b, api) {
    const st = stateOf(sim);
    dropPylons(sim);
    sim.mobs = sim.mobs.filter((m) => m.kind !== 'f11_pylon');
    for (const i of [...st.saved.keys()]) if (b.cells.has(i)) restoreCell(sim, st, api, i);
    st.arena.mode = 0;
    st.arena.k = 0;
    st.arena.gust = 0;
    st.arena.phase = 0;
    api.light(sim, 'f11core', null);
    st.tornados = [];
    st.hooks = [];
  },
});

