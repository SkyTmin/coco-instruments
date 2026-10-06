// Этаж 12 «Полярная ночь» — ИИ монстров, правила этажа и сценарий босса.
//
// Глагол — ЛЁД И МОРОЗ (подробно — шапка `f12.ts`):
//   • СКОЛЬЖЕНИЕ: на льду герой и монстры идут по инерции. Движок ведёт
//     героя как обычно, а правило этажа после его шага пересчитывает
//     скорость с «ледяным» разгоном и торможением и досдвигает героя
//     (`api.collide` — сквозь стену не проскочит). Монстров — обёртка мозга:
//     перемена скорости за шаг урезается, отброс гаснет втрое медленнее;
//     сбитый к полынье моб уходит под лёд (`api.fall`).
//   • ТОНКИЙ ЛЁД: нагрузка клетки копится под героем (стоит — быстрее, рывок
//     и тяжёлый удар — сразу +1) и под тяжёлыми мобами; три стадии трещин
//     рисует слой пола, на четвёртой клетка — полынья (`setTile` → глубина).
//     Через ~22 с полынья замерзает обратно тонким льдом.
//   • МОРОЗ: три доли, копятся вне тепла (на Озере и в Чертоге) и от
//     ледяных ударов (статус `chill`). Три доли — заморозка на 1 с; удар по
//     замёрзшему разбивает лёд (урон больше, зато свободен). Тепло —
//     жаровни, костры, факелы, лампы, тёплый источник — снимает иней.
//   • ДЕЙСТВИЯ: жаровня «Зажечь», затвор «Разбить», гонг «Ударить в гонг»,
//     лебёдка «Крутить».
//   • ЗАЛЫ-СОБЫТИЯ: «Сияние» (Купол), «Оттепель» (Зал вмёрзших), «Ледолом»
//     (Стремнина), «Ледоход» (Протока), «Вьюга» (Снежное поле), «Безмолвие»
//     (Зал гонга).
//
// Честность: всё, что бьёт, видно заранее — тень сосульки, линия тюленя и
// ежа, точка прыжка песца, конус воина и духа, кольцо голема, занавес
// хранителя, линия набега мамонта, снежные валы с проёмом, трещины льда.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { Brain, BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Sim, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F12_GEO, F12_GROTTO, F12_LAKE, F12_MARK, F12_SHRINE } from './f12';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: значениями движок не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;
const T_HAZARD = 12;

const MK = F12_MARK;

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

/** Сколько клеток до преграды (стена или провал) по направлению. */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

/** Прямая от точки до точки идёт только по полу. */
function clearLine(sim: Sim, api: SimApi, ax: number, ay: number, bx: number, by: number): boolean {
  const d = hypot(bx - ax, by - ay);
  const n = Math.ceil(d * 3);
  for (let i = 1; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n;
    const y = ay + ((by - ay) * i) / n;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return false;
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

/** Точка пола рядом с (x, y) на расстоянии `r0…r1`, по оценке `score`. */
function spotNear(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r0: number,
  r1: number,
  score: (px: number, py: number) => number,
  line = true,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bs = -1e9;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + sim.rng() * 0.2;
    const r = r0 + sim.rng() * (r1 - r0);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    const cx = Math.floor(px);
    const cy = Math.floor(py);
    if (!standable(sim, cx, cy)) continue;
    if (
      !standable(sim, cx + 1, cy) ||
      !standable(sim, cx - 1, cy) ||
      !standable(sim, cx, cy + 1) ||
      !standable(sim, cx, cy - 1)
    )
      continue;
    if (line && !clearLine(sim, api, x, y, cx + 0.5, cy + 0.5)) continue;
    const s = score(cx + 0.5, cy + 0.5) + sim.rng() * 0.3;
    if (s > bs) {
      bs = s;
      best = [cx + 0.5, cy + 0.5];
    }
  }
  return best;
}

/** Район по мировому ряду (без импорта движка). */
function areaAt(sim: Sim, y: number): string {
  const w = sim.world;
  return w.rowArea[clamp(Math.floor(y), 0, w.h - 1)] ?? '';
}

/** Первый мировой ряд района. */
function topOf(sim: Sim, area: string): number {
  return sim.world.bands.find((b) => b.def.id === area)?.top ?? 0;
}

/**
 * Убить моба окружением (полынья, обвал): удар по своим без урона герою —
 * движок засчитает убийство и бросит добычу.
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
    art: 'f12_none',
  });
}

/** Урон окружения по мобу: лёгкий — сразу, смертельный — ударом движка. */
function envHurt(sim: Sim, api: SimApi, m: Mob, frac: number): void {
  const d = m.maxHp * frac;
  if (m.hp - d <= 0) envKill(sim, api, m);
  else {
    m.hp -= d;
    m.flash = Math.max(m.flash, 0.12);
  }
}

/** Картинка без урона (v2.85): `api.vfx`, номер положительный не нужен. */
function fx(sim: Sim, api: SimApi, z: ZoneIn): void {
  api.vfx(sim, z);
}

const idx = (sim: Sim, x: number, y: number) => y * sim.world.w + x;
const markAt = (sim: Sim, x: number, y: number) => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};
const tileAt = (sim: Sim, x: number, y: number) => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};

/** Скользко: лёд, тонкий, полированный, лёд арены, ледник. */
export const slippery = (mk: number) =>
  mk === MK.ice ||
  mk === MK.thin ||
  mk === MK.polish ||
  mk === MK.arena ||
  mk === MK.postWar ||
  mk === MK.glacier;

/** На клетке можно стоять (и это не вода протоки). */
function standable(sim: Sim, x: number, y: number): boolean {
  const t = tileAt(sim, x, y);
  if (t !== T_FLOOR && t !== T_HAZARD) return false;
  return markAt(sim, x, y) !== MK.current;
}

// ---------------------------------------------------------------------------
// Числа правил (их читают тесты и рисовальщик).
// ---------------------------------------------------------------------------

/** Скольжение: разгон и торможение героя на льду (доля за секунду). */
export const ICE = {
  acc: 3.2,
  brake: 1.5,
  /** Отброс монстров на льду гаснет так (движок — 9). */
  knockDecay: 3,
  /** Монстр на льду: разгон по массе — `mob / sqrt(масса)`. */
  mob: 3.4,
  /** Сбитый быстрее этого к полынье — уходит под лёд. */
  dunk: 3,
};

/** Тонкий лёд: нагрузка в секунду и рубежи стадий (3 — пролом). */
export const THIN = {
  stand: 0.85,
  walk: 0.42,
  dash: 1,
  heavy: 1,
  /** Тяжёлый моб (масса ≥ 3) — за единицу массы сверх двух. */
  mob: 0.3,
  decay: 0.03,
  /** Пролом передаёт соседям. */
  chain: 0.55,
  refreeze: 22,
  slush: 12,
};

/** Мороз: доли, скорость копления, тепло, заморозка. */
export const FROST = {
  max: 3,
  /** Доля в секунду вне тепла по районам. */
  rate: { [F12_GROTTO]: 0, [F12_LAKE]: 1 / 42, [F12_SHRINE]: 1 / 34 } as Record<string, number>,
  /** Тепло снимает в секунду. */
  thaw: 0.6,
  /** Ледяной удар (`chill`) добавляет. */
  hit: 0.4,
  freeze: 1,
  /** Урон, когда разбили лёд на замёрзшем, — доля здоровья. */
  shatter: 0.05,
  /** Замедление за долю. */
  slow: 0.07,
};

export const FALL = { dmg: 0.08, inv: 1 };

// ---------------------------------------------------------------------------
// Состояние этажа.
// ---------------------------------------------------------------------------

interface Post {
  id: number;
  kind: string;
  x: number;
  y: number;
  mob: number;
  dead: boolean;
  area: string;
  /** Отрастает (сосулька): когда можно поставить снова. */
  regrow: number;
}

export interface Floe {
  id: number;
  x: number;
  y: number;
  /** Полуоси, клеток. */
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  ph: number;
  lamp: boolean;
  /** Качка: наклон рисунка. */
  tilt: number;
}

interface Dome {
  state: 'idle' | 'on' | 'done';
  t: number;
  wave: number;
  waveT: number;
  mobs: Set<number>;
  cx: number;
  cy: number;
  r: number;
  /** Ленты сияния: углы и фазы — свет на ходу. */
  bands: { x: number; y: number }[];
}

interface Thaw {
  state: 'idle' | 'on' | 'melt' | 'done';
  t: number;
  box: [number, number, number, number];
  wall: number[];
}

interface Rapids {
  state: 'idle' | 'on' | 'frozen' | 'done';
  t: number;
  front: number;
  box: [number, number, number, number];
  stop: number;
  fell: boolean;
}

interface Drift {
  on: boolean;
  told: boolean;
  floes: Floe[];
  spawnT: number;
  surgeT: number;
  box: [number, number, number, number];
  nextId: number;
  seen: boolean;
}

interface Storm {
  state: 'idle' | 'on' | 'done';
  t: number;
  k: number;
  gustT: number;
  gust: { ang: number; t: number; warn: number } | null;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

interface Hush {
  state: 'idle' | 'on' | 'done';
  t: number;
  box: [number, number, number, number];
  mobs: Set<number>;
  torches: string[];
}

export interface F12State {
  /** Последнее твёрдое место героя (не тонкий лёд, не вода, не у края). */
  safe: [number, number];
  /** Скорость героя, которую выставило правило льда в прошлый шаг. */
  u: [number, number];
  invSeen: number;
  onIce: boolean;
  slide: number;
  glideCd: number;
  frost: number;
  frozenT: number;
  frozenHp: number;
  freezes: number;
  shatters: number;
  chillSeen: number;
  falls: number;
  /** Клетка, по которой рывок уже ударил (−1 — не в рывке). */
  dashAt: number;
  /** Нагрузка тонкого льда по клеткам (0…3). */
  thin: Map<number, number>;
  /** Полыньи, которые замерзают обратно. */
  holes: { i: number; t: number }[];
  /** Битый лёд Ледолома: клетка → время с пролома (меньше нуля — трещит). */
  broken: Map<number, number>;
  lit: Set<string>;
  braziers: WorldObj[];
  torches: WorldObj[];
  torchOn: Set<string>;
  /** Постоянное тепло по клеткам (костры, факелы, лампы, источник). */
  warm: Uint8Array;
  gates: Map<string, number>;
  winch: { obj: WorldObj | null; step: number; cd: number };
  gong: { obj: WorldObj | null; cd: number };
  /** Вспышка гонга/сияния: невидимки видны, с. */
  reveal: number;
  posts: Post[];
  dome: Dome;
  thaw: Thaw;
  rapids: Rapids;
  drift: Drift;
  storm: Storm;
  hush: Hush;
  /** Слой пола и слой неба — зоны-картинки, едут за героем. */
  floorFx: Zone | null;
  skyFx: Zone | null;
  told: Set<string>;
}

const STATE = new WeakMap<Sim, F12State>();

/** Состояние этажа — для рисовальщика, тестов и стенда. */
export const f12State = (sim: Sim | null) => (sim ? (STATE.get(sim) ?? null) : null);

function scan(sim: Sim): F12State {
  const w = sim.world;
  const posts: Post[] = [];
  let pid = 1;
  const braziers: WorldObj[] = [];
  const torches: WorldObj[] = [];
  const warm = new Uint8Array(w.w * w.h);
  const heat = (x: number, y: number, r: number) => {
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue;
        if (hypot(xx + 0.5 - x, yy + 0.5 - y) <= r) warm[yy * w.w + xx] = 1;
      }
  };
  let winch: WorldObj | null = null;
  let gong: WorldObj | null = null;
  for (const o of w.objs) {
    if (o.ref === 'f12_brazier') braziers.push(o);
    else if (o.ref === 'f12_torch') torches.push(o);
    else if (o.ref === 'f12_hearth') heat(o.x + 0.5, o.y + 0.5, 3.4);
    else if (o.ref === 'f12_winch') winch = o;
    else if (o.ref === 'f12_gong') gong = o;
    else if (o.kind === 'lamp') heat(o.x + 0.5, o.y + 1.4, 2.4);
  }
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const mk = w.mark[y * w.w + x];
      if (mk === MK.spring || mk === MK.warm) heat(x + 0.5, y + 0.5, 1.3);
      const area = w.rowArea[y];
      const p = (kind: string) =>
        posts.push({
          id: pid++,
          kind,
          x: x + 0.5,
          y: y + 0.5,
          mob: 0,
          dead: false,
          area,
          regrow: 0,
        });
      if (mk === MK.postIce) p('f12_icicle');
      else if (mk === MK.postWar) p('f12_warrior');
      else if (mk === MK.foxDrift) p('f12_fox');
      else if (mk === MK.sealHole) p('f12_seal');
    }
  const g = (a: string) => topOf(sim, a);
  const dg = F12_GEO.dome;
  const fz = F12_GEO.frozen;
  const rp = F12_GEO.rapids;
  const ch = F12_GEO.channel;
  const fl = F12_GEO.field;
  const gh = F12_GEO.gongHall;
  const gt = g(F12_GROTTO);
  const lt = g(F12_LAKE);
  const stp = g(F12_SHRINE);
  const wall: number[] = [];
  for (let x = fz.wallX[0]; x <= fz.wallX[1]; x++) wall.push(idx(sim, x, gt + fz.wallY));
  const domeBands = [0, 1, 2].map(() => ({ x: dg.x, y: gt + dg.y }));
  return {
    safe: [sim.hero.x, sim.hero.y],
    u: [0, 0],
    invSeen: sim.hero.inv,
    onIce: false,
    slide: 0,
    glideCd: 0,
    frost: 0,
    frozenT: 0,
    frozenHp: 0,
    freezes: 0,
    shatters: 0,
    chillSeen: 0,
    falls: 0,
    dashAt: -1,
    thin: new Map(),
    holes: [],
    broken: new Map(),
    lit: new Set(),
    braziers,
    torches,
    torchOn: new Set(torches.map((o) => o.id)),
    warm,
    gates: new Map(),
    winch: { obj: winch, step: 0, cd: 0 },
    gong: { obj: gong, cd: 0 },
    reveal: 0,
    posts,
    dome: {
      state: 'idle',
      t: 0,
      wave: 0,
      waveT: 0,
      mobs: new Set(),
      cx: dg.x,
      cy: gt + dg.y,
      r: dg.r,
      bands: domeBands,
    },
    thaw: { state: 'idle', t: 0, box: [fz.x0, gt + fz.y0, fz.x1, gt + fz.y1], wall },
    rapids: {
      state: 'idle',
      t: 0,
      front: lt + rp.y1 + 2,
      box: [rp.x0, lt + rp.y0, rp.x1, lt + rp.y1],
      stop: lt + rp.y0 + 3,
      fell: false,
    },
    drift: {
      on: false,
      told: false,
      floes: [],
      spawnT: 0,
      surgeT: 4,
      box: [ch.x0, lt + ch.y0, ch.x1, lt + ch.y1],
      nextId: 1,
      seen: false,
    },
    storm: {
      state: 'idle',
      t: 0,
      k: 0,
      gustT: 3,
      gust: null,
      cx: fl.x,
      cy: stp + fl.y,
      rx: fl.rx,
      ry: fl.ry,
    },
    hush: {
      state: 'idle',
      t: 0,
      box: [gh.x0, stp + gh.y0, gh.x1, stp + gh.y1],
      mobs: new Set(),
      torches: [],
    },
    floorFx: null,
    skyFx: null,
    told: new Set(),
  };
}

function stateOf(sim: Sim): F12State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

/** Подсказка один раз за вылазку: текст события и строка под ним. */
function say(sim: Sim, st: F12State, what: string, text: string, sub?: string, key = what): void {
  const first = !st.told.has(key);
  st.told.add(key);
  sim.events.push({ t: 'boss', what, text, sub: first ? sub : undefined });
}

// ---------------------------------------------------------------------------
// Тепло и свет.
// ---------------------------------------------------------------------------

/** Горит ли жаровня (для рисовальщика). */
export const f12Lit = (sim: Sim | null, id: string) => !!sim && !!STATE.get(sim)?.lit.has(id);
/** Горит ли факел (дух гасит, «Безмолвие» гасит). */
export const f12Torch = (sim: Sim | null, id: string) =>
  !sim || !STATE.get(sim) || STATE.get(sim)!.torchOn.has(id);

function lightBrazier(sim: Sim, st: F12State, api: SimApi, o: WorldObj, melt = true): void {
  if (st.lit.has(o.id)) return;
  st.lit.add(o.id);
  api.light(sim, `f12b:${o.id}`, { x: o.x + 0.5, y: o.y + 0.3, r: 5.4, tint: 'warm' });
  sim.events.push({ t: 'boss', what: 'f12_light' });
  fx(sim, api, { x: o.x + 0.5, y: o.y + 0.5, r: 2.6, life: 0.9, art: 'f12_ignite' });
  if (!melt) return;
  // Вокруг тает лёд: лёд → мокрый камень (без арены — там лёд нужен бою).
  if (api.inArena(sim, o.x + 0.5, o.y + 0.5)) return;
  for (let y = o.y - 3; y <= o.y + 3; y++)
    for (let x = o.x - 3; x <= o.x + 3; x++) {
      if (hypot(x - o.x, y - o.y) > 2.3) continue;
      const mk = markAt(sim, x, y);
      if (tileAt(sim, x, y) !== T_FLOOR) continue;
      if (mk === MK.ice || mk === MK.thin || mk === MK.polish) {
        st.thin.delete(idx(sim, x, y));
        api.setTile(sim, x, y, T_FLOOR, MK.melt);
      }
    }
}

function douseBrazier(sim: Sim, st: F12State, api: SimApi, o: WorldObj): void {
  if (!st.lit.delete(o.id)) return;
  api.light(sim, `f12b:${o.id}`, null);
  sim.events.push({ t: 'boss', what: 'f12_blowout' });
  fx(sim, api, { x: o.x + 0.5, y: o.y + 0.3, r: 1.6, life: 1.2, art: 'f12_smoke' });
}

function setTorch(sim: Sim, st: F12State, api: SimApi, o: WorldObj, on: boolean): void {
  if (on === st.torchOn.has(o.id)) return;
  if (on) {
    st.torchOn.add(o.id);
    api.light(sim, `f12t:${o.id}`, { x: o.x + 0.5, y: o.y + 0.1, r: 4, tint: 'warm' });
  } else {
    st.torchOn.delete(o.id);
    api.light(sim, `f12t:${o.id}`, null);
    fx(sim, api, { x: o.x + 0.5, y: o.y - 0.2, r: 1, life: 1, art: 'f12_smoke' });
  }
}

/** Тепло в точке: костры, факелы, лампы, источник, горящие жаровни. */
export function warmAt(sim: Sim, x: number, y: number): boolean {
  const st = STATE.get(sim);
  if (!st) return false;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const w = sim.world;
  if (cx >= 0 && cy >= 0 && cx < w.w && cy < w.h && st.warm[cy * w.w + cx]) return true;
  for (const o of st.braziers)
    if (st.lit.has(o.id) && hypot(o.x + 0.5 - x, o.y + 0.5 - y) < 3.1) return true;
  for (const o of st.torches)
    if (st.torchOn.has(o.id) && hypot(o.x + 0.5 - x, o.y + 0.5 - y) < 2.3) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Падение в воду: герой — урон, мороз и на твёрдое; моб — под лёд.
// ---------------------------------------------------------------------------

function fallIn(sim: Sim, st: F12State, api: SimApi, why: string): void {
  const h = sim.hero;
  if (heroDown(sim)) return;
  const fromX = h.x;
  const fromY = h.y;
  fx(sim, api, { x: fromX, y: fromY, r: 1.4, life: 1.1, art: 'f12_splash' });
  api.hurtEnv(sim, FALL.dmg);
  addFrost(sim, st, 1);
  let [sx, sy] = st.safe;
  // Твёрдое — не битый лёд Ледолома и не тонкий: иначе герой падал снова
  // каждый кадр (в Ледоломе — 300 «провалов» за пять секунд).
  const firm = (px: number, py: number) =>
    standable(sim, Math.floor(px), Math.floor(py)) &&
    !brokenAt(st, sim, px, py) &&
    markAt(sim, Math.floor(px), Math.floor(py)) !== MK.thin;
  if (!firm(sx, sy)) {
    const score = (px: number, py: number) =>
      (firm(px, py) ? 0 : -1000) - hypot(px - h.x, py - h.y);
    let near = spotNear(sim, api, h.x, h.y, 1, 8, score, false);
    if (!near || !firm(near[0], near[1]))
      near = spotNear(sim, api, h.x, h.y, 8, 20, score, false) ?? near;
    if (near) [sx, sy] = near;
  }
  api.moveHero(sim, sx, sy);
  st.u = [0, 0];
  h.inv = Math.max(h.inv, FALL.inv);
  st.invSeen = h.inv;
  st.falls += 1;
  sim.events.push({ t: 'shake', k: 0.35 });
  sim.events.push({ t: 'flash', color: '#bfe8ff', k: 0.5 });
  say(sim, st, 'f12_splash', why, 'вода не держит — обходи трещины и тёмные пятна', 'fall');
}

function mobFalls(sim: Sim, api: SimApi, m: Mob): void {
  if (m.mode === 'dying' || m.fell) return;
  sim.events.push({ t: 'boss', what: 'f12_dunk' });
  api.vfx(sim, { x: m.x, y: m.y, r: 1.2, life: 1, art: 'f12_splash' });
  api.fall(sim, m);
}

/** Битый лёд Ледолома под точкой (после трещин — вода). */
function brokenAt(st: F12State, sim: Sim, x: number, y: number): boolean {
  const v = st.broken.get(idx(sim, Math.floor(x), Math.floor(y)));
  return v !== undefined && v >= 0;
}

// ---------------------------------------------------------------------------
// Мороз.
// ---------------------------------------------------------------------------

function addFrost(sim: Sim, st: F12State, n: number): void {
  if (heroDown(sim) || st.frozenT > 0) return;
  st.frost = Math.min(FROST.max, st.frost + n);
}

function stepFrost(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const h = sim.hero;
  if (heroDown(sim)) {
    st.frost = 0;
    st.frozenT = 0;
    return;
  }
  // Ледяной удар (статус `chill` от снаряда, дыхания, занавеса) — иней.
  const ch = h.status.chill?.t ?? 0;
  if (ch > st.chillSeen + 0.05) addFrost(sim, st, FROST.hit);
  st.chillSeen = ch;

  if (st.frozenT > 0) {
    st.frozenT -= dt;
    // Удар по замёрзшему разбивает лёд: урон больше, но ты свободен.
    if (h.hp < st.frozenHp - 0.5) {
      st.frozenT = 0;
      delete h.status.stun;
      api.hurtEnv(sim, FROST.shatter);
      st.shatters += 1;
      api.vfx(sim, { x: h.x, y: h.y, r: 1.3, life: 0.8, art: 'f12_shatter' });
      sim.events.push({ t: 'boss', what: 'f12_shatter' });
      sim.events.push({ t: 'shake', k: 0.25 });
    }
    st.frozenHp = Math.max(0, Math.min(st.frozenHp, h.hp));
    return;
  }
  const area = areaAt(sim, h.y);
  const warmHere = warmAt(sim, h.x, h.y);
  if (warmHere) st.frost = Math.max(0, st.frost - FROST.thaw * dt);
  else {
    let rate = FROST.rate[area] ?? 0;
    if (st.storm.state === 'on' && st.storm.k > 0.3 && !inDrift(sim, h.x, h.y)) rate *= 3;
    const b = sim.boss;
    if (b?.state === 'fight' && b.phase === 2) rate = 1 / 12;
    else if (b?.state === 'fight' && b.phase >= 1) rate = Math.max(rate, 1 / 30);
    st.frost = Math.min(FROST.max, st.frost + rate * dt);
  }
  const shares = Math.floor(st.frost + 1e-6);
  if (shares >= 1) api.heroStatus(sim, 'slow', 0.25, FROST.slow * shares);
  if (st.frost >= FROST.max - 1e-6) {
    st.frost = 0;
    st.frozenT = FROST.freeze;
    st.frozenHp = h.hp;
    st.freezes += 1;
    api.heroStatus(sim, 'stun', FROST.freeze);
    api.vfx(sim, { x: h.x, y: h.y, r: 1, life: FROST.freeze, art: 'f12_iceblock' });
    say(
      sim,
      st,
      'f12_freeze',
      'ЗАМЁРЗ',
      'тепло снимает иней: жаровни, костры, факелы, тёплый источник',
    );
  }
}

const inDrift = (sim: Sim, x: number, y: number) => {
  const mk = markAt(sim, Math.floor(x), Math.floor(y));
  return mk === MK.drift || mk === MK.foxDrift;
};

/** Доли мороза героя 0…3 и заморожен ли (для рисовальщика). */
export function f12Frost(sim: Sim | null): { frost: number; frozen: number } {
  const st = sim ? STATE.get(sim) : null;
  return { frost: st?.frost ?? 0, frozen: st?.frozenT ?? 0 };
}

// ---------------------------------------------------------------------------
// Скольжение героя.
// ---------------------------------------------------------------------------

function onFloe(st: F12State, x: number, y: number): Floe | null {
  for (const f of st.drift.floes) {
    const dx = (x - f.x) / (f.rx + 0.05);
    const dy = (y - f.y) / (f.ry + 0.05);
    if (dx * dx + dy * dy <= 1) return f;
  }
  return null;
}

function stepIce(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  const mk = markAt(sim, cx, cy);
  // Ударили в прошлом шаге (неуязвимость выросла) — отброс оставляем движку.
  const hit = h.inv > st.invSeen + 1e-6;
  const ice =
    slippery(mk) &&
    tileAt(sim, cx, cy) === T_FLOOR &&
    h.mode !== 'dash' &&
    !h.pull &&
    !heroDown(sim) &&
    !hit &&
    dt > 0;
  st.glideCd -= dt;
  if (!ice) {
    st.u = [h.vx, h.vy];
    st.onIce = false;
    st.slide = 0;
    st.invSeen = h.inv;
    return;
  }
  // Движок в этом шаге: v = u + (T − u)·a. Отсюда желаемое T − u.
  const a = Math.min(1, dt * 14);
  const [ux, uy] = st.onIce ? st.u : [h.vx, h.vy];
  const ex = (h.vx - ux) / a;
  const ey = (h.vy - uy) / a;
  const tx = ux + ex;
  const ty = uy + ey;
  const want = hypot(tx, ty) > 0.4;
  const k = Math.min(1, dt * (want ? ICE.acc : ICE.brake));
  let vx = ux + ex * k;
  let vy = uy + ey * k;
  // Досдвиг: движок уже сдвинул на v·dt, разница — наша.
  h.x += (vx - h.vx) * dt;
  h.y += (vy - h.vy) * dt;
  api.collide(sim, h);
  // В стену — скорость гаснет (лёгкий отскок).
  const r = h.r + 0.06;
  if (
    Math.abs(vx) > 0.01 &&
    api.solidTile(sim, Math.floor(h.x + Math.sign(vx) * r), Math.floor(h.y))
  )
    vx = Math.abs(vx) > 3 ? -vx * 0.2 : 0;
  if (
    Math.abs(vy) > 0.01 &&
    api.solidTile(sim, Math.floor(h.x), Math.floor(h.y + Math.sign(vy) * r))
  )
    vy = Math.abs(vy) > 3 ? -vy * 0.2 : 0;
  h.vx = vx;
  h.vy = vy;
  st.u = [vx, vy];
  st.onIce = true;
  st.invSeen = h.inv;
  // Юз: скорость есть, а желания нет (или против хода) — шорох конька.
  const sp = hypot(vx, vy);
  const skid = sp > 1.8 && (!want || (tx * vx + ty * vy) / (hypot(tx, ty) * sp + 1e-6) < 0.3);
  st.slide = skid ? Math.min(1, st.slide + dt * 4) : Math.max(0, st.slide - dt * 3);
  if (skid && st.glideCd <= 0) {
    st.glideCd = 1.1;
    sim.events.push({ t: 'boss', what: 'f12_glide' });
  }
}

/** Скорость героя на льду и юз 0…1 (для рисовальщика: отражение, искры). */
export function f12Ice(sim: Sim | null): { on: boolean; slide: number } {
  const st = sim ? STATE.get(sim) : null;
  return { on: !!st?.onIce, slide: st?.slide ?? 0 };
}

/** Последнее твёрдое место: не тонкий лёд, не вода, не край полыньи. */
function stepSafe(sim: Sim, st: F12State): void {
  const h = sim.hero;
  if (heroDown(sim) || h.mode === 'dash') return;
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  const mk = markAt(sim, cx, cy);
  if (!standable(sim, cx, cy) || mk === MK.thin || brokenAt(st, sim, h.x, h.y)) return;
  if (onFloe(st, h.x, h.y)) return;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const t = tileAt(sim, cx + dx, cy + dy);
      const m2 = markAt(sim, cx + dx, cy + dy);
      if (t === T_DEEP || m2 === MK.current || m2 === MK.thin) return;
      if (st.broken.has(idx(sim, cx + dx, cy + dy))) return;
    }
  st.safe = [h.x, h.y];
}

// ---------------------------------------------------------------------------
// Тонкий лёд.
// ---------------------------------------------------------------------------

/** Стадия трещин клетки 0…2 (для рисовальщика). */
export function f12Thin(sim: Sim | null): Map<number, number> | null {
  return sim ? (STATE.get(sim)?.thin ?? null) : null;
}

function loadThin(sim: Sim, st: F12State, api: SimApi, x: number, y: number, n: number): void {
  if (markAt(sim, x, y) !== MK.thin || tileAt(sim, x, y) !== T_FLOOR) return;
  const i = idx(sim, x, y);
  const was = st.thin.get(i) ?? 0;
  const now = was + n;
  if (Math.floor(now) > Math.floor(was) && now < 3) {
    sim.events.push({ t: 'boss', what: 'f12_crack' });
  }
  if (now >= 3) breakThin(sim, st, api, x, y);
  else st.thin.set(i, now);
}

function breakThin(sim: Sim, st: F12State, api: SimApi, x: number, y: number): void {
  const i = idx(sim, x, y);
  st.thin.delete(i);
  api.setTile(sim, x, y, T_DEEP, MK.holeNew);
  st.holes.push({ i, t: 0 });
  sim.events.push({ t: 'boss', what: 'f12_break' });
  api.vfx(sim, { x: x + 0.5, y: y + 0.5, r: 1.1, life: 1, art: 'f12_splash' });
  const h = sim.hero;
  if (Math.floor(h.x) === x && Math.floor(h.y) === y) fallIn(sim, st, api, 'ПРОВАЛИЛСЯ ПОД ЛЁД');
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || api.def(m.kind).fly || api.def(m.kind).boss) continue;
    if (Math.floor(m.x) === x && Math.floor(m.y) === y) mobFalls(sim, api, m);
  }
  // Трещина бежит к соседям.
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (markAt(sim, nx, ny) === MK.thin && tileAt(sim, nx, ny) === T_FLOOR) {
      const j = idx(sim, nx, ny);
      const v = (st.thin.get(j) ?? 0) + THIN.chain;
      if (v < 3) st.thin.set(j, v);
    }
  }
}

function stepThin(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  if (!heroDown(sim) && markAt(sim, cx, cy) === MK.thin && !h.pull) {
    const sp = hypot(h.vx, h.vy);
    let n = (sp < 1.5 ? THIN.stand : THIN.walk) * dt;
    const i = idx(sim, cx, cy);
    // Рывок бьёт по каждой клетке пути один раз.
    if (h.mode === 'dash' && st.dashAt !== i) {
      st.dashAt = i;
      n += THIN.dash;
    }
    if (h.mode === 'heavy' && h.t < dt * 1.5) n += THIN.heavy;
    loadThin(sim, st, api, cx, cy, n);
  }
  if (h.mode !== 'dash') st.dashAt = -1;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.t < 0) continue;
    const def = api.def(m.kind);
    if (def.fly || (def.mass ?? 1) < 3) continue;
    const mx = Math.floor(m.x);
    const my = Math.floor(m.y);
    if (markAt(sim, mx, my) !== MK.thin) continue;
    if (def.boss) continue;
    loadThin(sim, st, api, mx, my, THIN.mob * ((def.mass ?? 3) - 1.5) * dt);
  }
  // Трещины медленно смерзаются.
  for (const [i, v] of st.thin) {
    const nv = v - THIN.decay * dt;
    if (nv <= 0) st.thin.delete(i);
    else st.thin.set(i, nv);
  }
  // Полыньи замерзают обратно тонким льдом.
  for (let k = st.holes.length - 1; k >= 0; k--) {
    const hl = st.holes[k];
    hl.t += dt;
    if (hl.t < THIN.refreeze) continue;
    const x = hl.i % sim.world.w;
    const y = Math.floor(hl.i / sim.world.w);
    const busy =
      (Math.floor(h.x) === x && Math.floor(h.y) === y) ||
      sim.mobs.some((m) => Math.floor(m.x) === x && Math.floor(m.y) === y);
    if (busy) continue;
    api.setTile(sim, x, y, T_FLOOR, MK.thin);
    st.thin.set(hl.i, 1.2);
    st.holes.splice(k, 1);
  }
}

/** Полыньи, что замерзают (для рисовальщика шуги). */
export function f12Holes(sim: Sim | null): readonly { i: number; t: number }[] {
  return (sim && STATE.get(sim)?.holes) || [];
}

// ---------------------------------------------------------------------------
// Посты: сосульки на сводах, вмёрзшие воины, песцы в сугробах, тюлени у
// лунок — ставятся, когда герой подходит.
// ---------------------------------------------------------------------------

/** Режим, в котором пост ждёт героя. */
const POST_MODE: Record<string, string> = {
  f12_icicle: 'f12_hang',
  f12_warrior: 'f12_frozen',
  f12_fox: 'f12_hide',
  f12_seal: 'f12_under',
};

function postDead(sim: Sim, m: Mob): void {
  const st = STATE.get(sim);
  const p = st?.posts.find((x) => x.id === m.data.post);
  if (!p) return;
  p.mob = 0;
  // Сосулька отрастает на своде, остальные — насовсем.
  if (p.kind === 'f12_icicle') p.regrow = sim.time + 28;
  else p.dead = true;
}

function stepPosts(sim: Sim, st: F12State, api: SimApi): void {
  const h = sim.hero;
  for (const p of st.posts) {
    if (p.dead) continue;
    if (p.mob) {
      // Убран без смерти (сброс боя, привязь) — встанет снова.
      if (!sim.mobs.some((m) => m.id === p.mob)) p.mob = 0;
      continue;
    }
    if (p.regrow > sim.time) continue;
    const d = hypot(p.x - h.x, p.y - h.y);
    if (d > 17 || d < 2.5) continue;
    let x = p.x;
    let y = p.y;
    if (p.kind === 'f12_seal') {
      // Тюлень ждёт подо льдом: встаёт на кромку у лунки.
      const edge = spotNear(
        sim,
        api,
        p.x,
        p.y,
        1.5,
        2.6,
        (px, py) => -hypot(px - p.x, py - p.y),
        false,
      );
      if (!edge) continue;
      [x, y] = edge;
    }
    const m = api.spawnMob(sim, p.kind, x, y, { mode: POST_MODE[p.kind] });
    m.data.post = p.id;
    m.data.hx = p.x;
    m.data.hy = p.y;
    m.hx = x;
    m.hy = y;
    m.face = Math.PI / 2;
    m.data.hide = p.kind === 'f12_warrior' ? 0 : 1;
    m.data.ghost = m.data.hide;
    m.data.vNoTele = 1;
    p.mob = m.id;
  }
}

// ---------------------------------------------------------------------------
// Монстры на льду: обёртка мозга (инерция, слепота от гонга, невидимость в
// «Безмолвии»); отброс и полыньи — в шаге этажа.
// ---------------------------------------------------------------------------

/** Режимы, в которых невидимка «Безмолвия» остаётся невидимой. */
const HUSH_HIDE = new Set(['chase', 'f12_perch', 'f12_hover', 'f12_drift']);

function iced(b: Brain): Brain {
  return {
    ...b,
    step(sim, m, dt, c, api) {
      const st = STATE.get(sim);
      // Метки замаха рисует этаж (ледяные, `f12-boss-fx.ts`) — у всех
      // мобов этажа одинаково, и у тех, что вышли из засады. Только рисунок.
      m.data.vNoTele = 1;
      // Ослеплён вспышкой гонга: стоит, щурится.
      if ((m.data.blind ?? 0) > 0) {
        m.data.blind -= dt;
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        m.danger = 0;
        m.data.ghost = 0;
        m.data.dark = 0;
        return;
      }
      const pvx = m.vx;
      const pvy = m.vy;
      b.step(sim, m, dt, c, api);
      // Невидимка «Безмолвия»: видны только глаза, пока не нападёт.
      const dark = (m.data.hush ?? 0) > 0 && (st?.reveal ?? 0) <= 0 && HUSH_HIDE.has(m.mode);
      m.data.dark = dark ? 1 : 0;
      m.data.ghost = (m.data.hide ?? 0) > 0 || dark ? 1 : 0;
      if (c.def.fly || dt <= 0 || (m.data.noIce ?? 0) > 0) return;
      const mk = markAt(sim, Math.floor(m.x), Math.floor(m.y));
      if (!slippery(mk)) return;
      const rate = clamp(ICE.mob / Math.sqrt(c.def.mass ?? 1), 1.1, 5);
      const k = Math.min(1, dt * rate) / Math.min(1, dt * 10);
      m.vx = pvx + (m.vx - pvx) * k;
      m.vy = pvy + (m.vy - pvy) * k;
    },
    onDeath(sim, m, mode, api) {
      if (m.data.post) postDead(sim, m);
      b.onDeath?.(sim, m, mode, api);
    },
    // Замах этажа зовётся `f12_wind`, а не `windup`: движок рисовал бы под
    // нашей меткой свой конус. Сбить его ударом — как движок сбивает `windup`.
    onHit(sim, m, hit, api) {
      const k = b.onHit?.(sim, m, hit, api);
      if (m.mode === 'f12_wind' && (k ?? 1) > 0) {
        const fl = api.def(m.kind).flinch ?? 0.35;
        if (hit.heavy || hit.crit || fl >= 1 || (fl > 0 && sim.rng() < fl)) {
          m.mode = 'stun';
          m.t = 0;
          m.tele = null;
          m.danger = 0;
        }
      }
      return k;
    },
  };
}

const brain = (id: string, b: Brain) => registerBrain(id, iced(b));

function stepMobsIce(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const grow = Math.exp((9 - ICE.knockDecay) * dt);
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.t < 0 || m.fell) continue;
    const def = api.def(m.kind);
    if (def.fly || def.boss || (m.data.hide ?? 0) > 0) continue;
    const cx = Math.floor(m.x);
    const cy = Math.floor(m.y);
    const mk = markAt(sim, cx, cy);
    if ((mk === MK.current && !onFloe(st, m.x, m.y)) || brokenAt(st, sim, m.x, m.y)) {
      mobFalls(sim, api, m);
      continue;
    }
    if (!slippery(mk)) continue;
    // Отброс на льду гаснет втрое медленнее: сбитый едет.
    m.kx *= grow;
    m.ky *= grow;
    const k = hypot(m.kx, m.ky);
    if (k > ICE.dunk) {
      const ux = m.kx / k;
      const uy = m.ky / k;
      const ax = Math.floor(m.x + ux * (m.r + 0.3));
      const ay = Math.floor(m.y + uy * (m.r + 0.3));
      if (tileAt(sim, ax, ay) === T_DEEP || markAt(sim, ax, ay) === MK.current)
        mobFalls(sim, api, m);
    }
  }
}

// ---------------------------------------------------------------------------
// Ледоход: льдины по протоке. Клетки не меняются — вода проходима, но без
// льдины под ногами проваливаешься; льдины рисует слой пола.
// ---------------------------------------------------------------------------

export const FLOES = {
  gap: [2, 2.9] as [number, number],
  vy: [-1.05, -1.5] as [number, number],
  surge: [5.5, 7.5] as [number, number],
  surgeWarn: 0.9,
};

function newFloe(sim: Sim, dr: Drift, y: number): Floe {
  const [x0, , x1] = dr.box;
  const rx = 1.45 + sim.rng() * 0.7;
  const ry = 1.15 + sim.rng() * 0.4;
  return {
    id: dr.nextId++,
    x: x0 + 0.5 + rx + sim.rng() * Math.max(0.1, x1 - x0 + 1 - 2 * rx),
    y,
    rx,
    ry,
    vx: 0,
    vy: FLOES.vy[0] + (FLOES.vy[1] - FLOES.vy[0]) * sim.rng(),
    ph: sim.rng() * TAU,
    lamp: sim.rng() < 0.3,
    tilt: 0,
  };
}

/** Льдины протоки (для рисовальщика). */
export const f12Floes = (sim: Sim | null): readonly Floe[] =>
  (sim && STATE.get(sim)?.drift.floes) || [];

function stepFloes(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const dr = st.drift;
  const h = sim.hero;
  const [x0, y0, x1, y1] = dr.box;
  const near = h.x > x0 - 12 && h.x < x1 + 12 && h.y > y0 - 12 && h.y < y1 + 12;
  if (!near) {
    if (dr.on) {
      dr.on = false;
      for (const f of dr.floes) if (f.lamp) api.light(sim, `f12f:${f.id}`, null);
      dr.floes.length = 0;
    }
    return;
  }
  if (!dr.on) {
    dr.on = true;
    dr.spawnT = 0;
    // Протока уже идёт: льдины по всей длине.
    for (let y = y1 - 0.5; y > y0 + 1; y -= 3.1) dr.floes.push(newFloe(sim, dr, y));
  }
  if (!dr.seen && h.y < y1 + 5 && h.y > y0 - 5 && h.x > x0 - 3 && h.x < x1 + 4) {
    dr.seen = true;
    say(
      sim,
      st,
      'f12_drift_call',
      'ЛЕДОХОД',
      'вода не держит — прыгай по льдинам, рывок перелетает',
    );
  }
  dr.spawnT -= dt;
  if (dr.spawnT <= 0) {
    dr.spawnT = FLOES.gap[0] + sim.rng() * (FLOES.gap[1] - FLOES.gap[0]);
    dr.floes.push(newFloe(sim, dr, y1 + 1.6));
  }
  const ride = onFloe(st, h.x, h.y);
  for (let k = dr.floes.length - 1; k >= 0; k--) {
    const f = dr.floes[k];
    f.ph += dt;
    f.vx = 0.4 * Math.sin(f.ph * 0.8);
    f.tilt = 0.06 * Math.sin(f.ph * 1.3);
    f.x = clamp(f.x + f.vx * dt, x0 + 0.5 + f.rx * 0.8, x1 + 0.5 - f.rx * 0.8);
    f.y += f.vy * dt;
    if (f.lamp) api.light(sim, `f12f:${f.id}`, { x: f.x, y: f.y - 0.4, r: 3.2, tint: 'warm' });
    if (f.y + f.ry < y0 - 0.2) {
      if (f.lamp) api.light(sim, `f12f:${f.id}`, null);
      dr.floes.splice(k, 1);
    }
  }
  // Герой на льдине едет вместе с ней.
  if (ride && !heroDown(sim) && h.mode !== 'dash') {
    h.x += ride.vx * dt;
    h.y += ride.vy * dt;
    api.collide(sim, h);
  }
  // Тюлень из-под воды толкает с льдины: пузыри — потом толчок.
  if (ride) {
    dr.surgeT -= dt;
    if (dr.surgeT <= 0) {
      dr.surgeT = FLOES.surge[0] + sim.rng() * (FLOES.surge[1] - FLOES.surge[0]);
      const side = sim.rng() < 0.5 ? -1 : 1;
      api.strike(sim, {
        shape: 'circle',
        x: h.x + side * (ride.rx * 0.6),
        y: h.y,
        r: 1.25,
        warn: FLOES.surgeWarn,
        dmg: 8,
        knock: 7,
        art: 'f12_surge',
      });
    }
  } else dr.surgeT = Math.max(dr.surgeT, 2.5);
}

// ---------------------------------------------------------------------------
// Ледолом: шагнул на середину Стремнины — лёд за спиной трещит и рушится
// волной с юга на север. Островки и берег — твёрдые.
// ---------------------------------------------------------------------------

export const RAPIDS = { speed: 2.3, crack: 0.75, hold: 16, refreeze: 3.6 };

function stepRapids(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const rp = st.rapids;
  const h = sim.hero;
  const [x0, y0, x1, y1] = rp.box;
  if (rp.state === 'idle') {
    if (h.x >= x0 && h.x <= x1 + 1 && h.y < y1 - 8 && h.y > y0 + 4 && !heroDown(sim)) {
      rp.state = 'on';
      rp.t = 0;
      rp.front = y1 + 1;
      sim.events.push({ t: 'shake', k: 0.4 });
      say(
        sim,
        st,
        'f12_rapids_trap',
        'ЛЕДОЛОМ',
        'лёд рушится за спиной — беги на север или на островок',
      );
    }
    return;
  }
  for (const [i, v] of st.broken) st.broken.set(i, v + dt);
  if (rp.state === 'on') {
    rp.t += dt;
    const was = rp.front;
    rp.front = Math.max(rp.stop, rp.front - RAPIDS.speed * dt);
    for (let y = Math.floor(rp.front); y < Math.floor(was); y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(sim, x, y);
        if (st.broken.has(i) || tileAt(sim, x, y) !== T_FLOOR) continue;
        const mk = markAt(sim, x, y);
        if (mk !== MK.ice && mk !== MK.thin && mk !== MK.grit) continue;
        st.broken.set(i, -RAPIDS.crack - sim.rng() * 0.35);
      }
    }
    if (Math.floor(rp.t / 0.45) !== Math.floor((rp.t - dt) / 0.45))
      sim.events.push({ t: 'boss', what: 'f12_crack' });
    if (rp.front <= rp.stop) {
      rp.state = 'frozen';
      rp.t = 0;
      if (!rp.fell) {
        say(sim, st, 'f12_rapids_call', 'ЛЕДОЛОМ ПРОЙДЕН');
        api.dropAt(sim, 'f12mat', 1, h.x, h.y);
        api.dropAt(sim, 'coin', 700, h.x, h.y);
      }
    }
  } else if (rp.state === 'frozen') {
    rp.t += dt;
    if (rp.t > RAPIDS.hold) {
      // Смерзается рядами с юга.
      const row = y1 + 1 - Math.floor((rp.t - RAPIDS.hold) * RAPIDS.refreeze);
      for (const [i] of st.broken) if (Math.floor(i / sim.world.w) >= row) st.broken.delete(i);
      if (st.broken.size === 0) rp.state = 'done';
    }
  }
}

/** Битый лёд Ледолома (для рисовальщика): клетка → время с пролома. */
export const f12Broken = (sim: Sim | null): Map<number, number> | null =>
  sim ? (STATE.get(sim)?.broken ?? null) : null;

// ---------------------------------------------------------------------------
// Сияние: Купол. Над тонким сводом вспыхивает сияние, ленты света ползут по
// залу (свет на ходу); совы пикируют на того, кто стоит в свете.
// ---------------------------------------------------------------------------

export const DOME = { waves: 3, waveT: 15, bandR: 3.4 };

function domeWindows(sim: Sim, d: Dome): [number, number][] {
  const out: [number, number][] = [];
  for (let y = Math.floor(d.cy - d.r - 2); y <= d.cy + d.r + 2; y++)
    for (let x = Math.max(1, Math.floor(d.cx - d.r - 2)); x <= d.cx + d.r + 2; x++) {
      if (markAt(sim, x, y) !== MK.window) continue;
      if (standable(sim, x, y + 1)) out.push([x + 0.5, y + 1.6]);
    }
  return out;
}

/** Ленты сияния Купола (для рисовальщика). */
export function f12Aurora(sim: Sim | null): { x: number; y: number; k: number }[] {
  const st = sim ? STATE.get(sim) : null;
  if (!st || st.dome.state !== 'on') return [];
  const k = clamp(st.dome.t / 1.5, 0, 1);
  return st.dome.bands.map((b) => ({ x: b.x, y: b.y, k }));
}

/** Стоит ли точка в ленте сияния Купола (совы видят добычу). */
export function inAurora(sim: Sim, x: number, y: number): boolean {
  const st = STATE.get(sim);
  if (!st || st.dome.state !== 'on') return false;
  return st.dome.bands.some((b) => hypot(b.x - x, b.y - y) < DOME.bandR);
}

function stepDome(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const d = st.dome;
  const h = sim.hero;
  if (d.state === 'idle') {
    if (hypot(h.x - d.cx, h.y - d.cy) < d.r - 1.5 && !heroDown(sim)) {
      d.state = 'on';
      d.t = 0;
      d.wave = 0;
      d.waveT = 1.5;
      say(
        sim,
        st,
        'f12_dome_call',
        'СИЯНИЕ',
        'совы пикируют на того, кто в свете: встань в ленту и лови их',
      );
    }
    return;
  }
  if (d.state !== 'on') return;
  d.t += dt;
  d.bands.forEach((b, k) => {
    b.x = d.cx + (d.r - 3) * Math.sin(d.t * 0.42 + k * 2.1);
    b.y = d.cy + (d.r - 3.4) * Math.sin(d.t * 0.31 + k * 1.37 + 0.6);
    api.light(sim, `f12a:${k}`, { x: b.x, y: b.y, r: 4.4, tint: k % 2 ? 'teal' : 'green' });
  });
  for (const id of [...d.mobs])
    if (!sim.mobs.some((m) => m.id === id && m.mode !== 'dying')) d.mobs.delete(id);
  d.waveT -= dt;
  const cleared = d.mobs.size === 0 && d.wave > 0 && d.waveT < DOME.waveT - 4;
  if (d.wave < DOME.waves && (d.waveT <= 0 || cleared)) {
    d.wave += 1;
    d.waveT = DOME.waveT;
    const wins = domeWindows(sim, d);
    const kinds =
      d.wave === 1
        ? ['f12_owl', 'f12_owl', 'f12_spirit']
        : d.wave === 2
          ? ['f12_owl', 'f12_owl', 'f12_owl']
          : ['f12_owl', 'f12_owl', 'f12_spirit', 'f12_spirit'];
    kinds.forEach((kind, i) => {
      const [wx, wy] = wins.length ? wins[(i * 3 + d.wave) % wins.length] : [d.cx, d.cy - d.r + 2];
      const m = api.spawnMob(sim, kind, wx, wy, {
        mode: kind === 'f12_owl' ? 'f12_perch' : 'chase',
      });
      m.data.dome = 1;
      m.hx = d.cx;
      m.hy = d.cy;
      d.mobs.add(m.id);
    });
    sim.events.push({ t: 'boss', what: 'f12_dome_wave' });
  }
  if (d.wave >= DOME.waves && d.mobs.size === 0) {
    d.state = 'done';
    for (let k = 0; k < d.bands.length; k++) api.light(sim, `f12a:${k}`, null);
    say(sim, st, 'f12_dome_end', 'СИЯНИЕ ГАСНЕТ');
    api.dropAt(sim, 'f12_crystal', 2, d.cx, d.cy);
    api.dropAt(sim, 'f12mat', 1, d.cx, d.cy);
    api.dropAt(sim, 'token', 3, d.cx, d.cy);
  }
}

// ---------------------------------------------------------------------------
// Оттепель: Зал вмёрзших. Три жаровни — тает стена ниши, но каждая жаровня
// оживляет двух ближних воинов.
// ---------------------------------------------------------------------------

function inBox(b: [number, number, number, number], x: number, y: number, pad = 0): boolean {
  return x >= b[0] - pad && x <= b[2] + 1 + pad && y >= b[1] - pad && y <= b[3] + 1 + pad;
}

function thawNear(sim: Sim, api: SimApi, x: number, y: number, n: number, r: number): void {
  const frozen = sim.mobs
    .filter((m) => m.kind === 'f12_warrior' && m.mode === 'f12_frozen')
    .map((m) => ({ m, d: hypot(m.x - x, m.y - y) }))
    .filter((e) => e.d < r)
    .sort((a, b) => a.d - b.d)
    .slice(0, n);
  for (const { m } of frozen) api.setMode(m, 'f12_thaw');
}

function stepThaw(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const th = st.thaw;
  const h = sim.hero;
  if (th.state === 'idle') {
    if (inBox(th.box, h.x, h.y, -1) && !heroDown(sim)) {
      th.state = 'on';
      say(
        sim,
        st,
        'f12_thaw_call',
        'ОТТЕПЕЛЬ',
        'зажги три жаровни — лёд растает, но вмёрзшие оживут',
      );
    }
    return;
  }
  if (th.state === 'on') {
    const mine = st.braziers.filter((o) => inBox(th.box, o.x + 0.5, o.y + 0.5));
    if (mine.length && mine.every((o) => st.lit.has(o.id))) {
      th.state = 'melt';
      th.t = 0;
      sim.events.push({ t: 'boss', what: 'f12_thaw_wall' });
    }
    return;
  }
  if (th.state === 'melt') {
    th.t += dt;
    const n = Math.min(th.wall.length, Math.floor(th.t / 0.45));
    for (let k = 0; k < n; k++) {
      const i = th.wall[k];
      const x = i % sim.world.w;
      const y = Math.floor(i / sim.world.w);
      if (tileAt(sim, x, y) === T_WALL) {
        api.setTile(sim, x, y, T_FLOOR, MK.melt);
        fx(sim, api, { x: x + 0.5, y: y + 0.5, r: 1, life: 1.2, art: 'f12_steampuff' });
      }
    }
    if (n >= th.wall.length) {
      th.state = 'done';
      say(sim, st, 'f12_thaw_end', 'ЛЁД РАСТАЯЛ', 'ниша открыта');
    }
  }
}

// ---------------------------------------------------------------------------
// Вьюга: Снежное поле. Порывы с предупреждением толкают (по льду — юзом),
// видимость падает, мороз копится втрое; в сугробе тихо.
// ---------------------------------------------------------------------------

export const STORM = {
  dur: 40,
  ramp: 3,
  gap: [3.6, 5.2] as [number, number],
  warn: 1,
  push: 0.6,
  force: 5.5,
};

/** Вьюга: сила 0…1 и порыв (для рисовальщика). */
export function f12Storm(sim: Sim | null): {
  k: number;
  gust: { ang: number; t: number; warn: number } | null;
} {
  const st = sim ? STATE.get(sim) : null;
  return { k: st?.storm.k ?? 0, gust: st?.storm.gust ?? null };
}

function stepStorm(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const s = st.storm;
  const h = sim.hero;
  const nx = (h.x - s.cx) / s.rx;
  const ny = (h.y - s.cy) / s.ry;
  const e = nx * nx + ny * ny;
  // Вьюга мамонта (вторая фаза) — та же, только на арене.
  const boss = sim.boss?.state === 'fight' && sim.boss.phase === 1;
  if (s.state === 'idle' && e < 0.7 && !heroDown(sim)) {
    s.state = 'on';
    s.t = 0;
    say(
      sim,
      st,
      'f12_storm_call',
      'ВЬЮГА',
      'порывы толкают по льду; в сугробе не дует и не морозит',
    );
  }
  const active = (s.state === 'on' && e < 1.2) || boss;
  if (s.state === 'on') {
    s.t += dt;
    if (s.t > STORM.dur) {
      s.state = 'done';
      say(sim, st, 'f12_storm_end', 'ВЬЮГА СТИХЛА');
      api.dropAt(sim, 'f12_fur', 1, h.x, h.y);
      api.dropAt(sim, 'coin', 600, h.x, h.y);
    }
  }
  const goal = active ? 1 : 0;
  s.k += (goal - s.k) * Math.min(1, (dt / STORM.ramp) * 2);
  if (!active && s.k < 0.05) {
    s.gust = null;
    return;
  }
  // Порыв: предупреждение (стрелы позёмки по полу) — потом толчок.
  if (s.gust) {
    const g = s.gust;
    g.t += dt;
    if (g.t > g.warn && g.t < g.warn + STORM.push && !heroDown(sim) && h.mode !== 'dash') {
      const ux = Math.cos(g.ang);
      const uy = Math.sin(g.ang);
      if (!inDrift(sim, h.x, h.y)) {
        if (st.onIce) {
          st.u = [st.u[0] + ux * STORM.force * dt * 2.2, st.u[1] + uy * STORM.force * dt * 2.2];
          h.vx = st.u[0];
          h.vy = st.u[1];
        } else {
          h.x += ux * STORM.force * 0.45 * dt;
          h.y += uy * STORM.force * 0.45 * dt;
          api.collide(sim, h);
        }
      }
      for (const m of sim.mobs) {
        if (m.mode === 'dying' || api.def(m.kind).boss) continue;
        if (hypot(m.x - h.x, m.y - h.y) > 12) continue;
        m.kx += ux * 3 * dt;
        m.ky += uy * 3 * dt;
      }
    }
    if (g.t > g.warn + STORM.push) s.gust = null;
  } else if (active) {
    s.gustT -= dt;
    if (s.gustT <= 0) {
      s.gustT = STORM.gap[0] + sim.rng() * (STORM.gap[1] - STORM.gap[0]);
      // Ветер с севера, косой — то с запада, то с востока.
      const ang = Math.PI / 2 + (sim.rng() - 0.5) * 1.8;
      s.gust = { ang, t: 0, warn: STORM.warn };
      sim.events.push({ t: 'boss', what: 'f12_gust' });
    }
  }
}

// ---------------------------------------------------------------------------
// Безмолвие: Зал гонга. Огни гаснут, видны только глаза; гонг — вспышка
// сияния: все видны, ближние ослеплены.
// ---------------------------------------------------------------------------

export const GONG = { reveal: 6, cd: 11, blind: 1.7, r: 11 };

function strikeGong(sim: Sim, st: F12State, api: SimApi, o: WorldObj): void {
  st.gong.cd = GONG.cd;
  st.reveal = GONG.reveal;
  const x = o.x + 0.5;
  const y = o.y + 0.5;
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || api.def(m.kind).boss) continue;
    if (hypot(m.x - x, m.y - y) > GONG.r) continue;
    m.data.blind = GONG.blind;
    if (m.mode === 'f12_perch' || m.mode === 'f12_hide') {
      m.data.hide = 0;
      api.setMode(m, 'chase');
    }
  }
  api.light(sim, 'f12gong', { x, y, r: 10, tint: 'teal' });
  fx(sim, api, { x, y, r: GONG.r, life: 1.4, art: 'f12_gongwave', above: true });
  sim.events.push({ t: 'boss', what: 'f12_gong' });
  sim.events.push({ t: 'flash', color: '#7affd8', k: 0.55 });
  sim.events.push({ t: 'shake', k: 0.3 });
}

function stepHush(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const hs = st.hush;
  const h = sim.hero;
  if (hs.state === 'idle') {
    if (!inBox(hs.box, h.x, h.y, -2) || heroDown(sim)) return;
    hs.state = 'on';
    hs.t = 0;
    for (const o of st.torches)
      if (inBox(hs.box, o.x + 0.5, o.y + 0.5, 1)) {
        hs.torches.push(o.id);
        setTorch(sim, st, api, o, false);
      }
    const [x0, y0, x1, y1] = hs.box;
    const mx = (x0 + x1) / 2 + 0.5;
    const spots: [string, number, number][] = [
      ['f12_owl', x0 + 3.5, y0 + 2.5],
      ['f12_owl', x1 - 2.5, y0 + 2.5],
      ['f12_spirit', x0 + 3.5, y1 - 1.5],
      ['f12_spirit', x1 - 2.5, y1 - 1.5],
      ['f12_spirit', mx + 6, y0 + 3.5],
      ['f12_keeper', mx - 6, y0 + 3.5],
    ];
    for (const [kind, x, y] of spots) {
      const p = standable(sim, Math.floor(x), Math.floor(y))
        ? [x, y]
        : (spotNear(sim, api, x, y, 0.5, 3, () => 0, false) ?? [mx, (y0 + y1) / 2]);
      const m = api.spawnMob(sim, kind, p[0], p[1], {
        mode: kind === 'f12_owl' ? 'f12_perch' : 'chase',
      });
      m.data.hush = 1;
      m.hx = p[0];
      m.hy = p[1];
      hs.mobs.add(m.id);
    }
    sim.events.push({ t: 'shake', k: 0.2 });
    say(
      sim,
      st,
      'f12_hush_trap',
      'БЕЗМОЛВИЕ',
      'огни погасли — бей в гонг: вспышка покажет невидимок',
    );
    return;
  }
  if (hs.state !== 'on') return;
  hs.t += dt;
  for (const id of [...hs.mobs])
    if (!sim.mobs.some((m) => m.id === id && m.mode !== 'dying')) hs.mobs.delete(id);
  if (hs.mobs.size === 0 && hs.t > 2) {
    hs.state = 'done';
    for (const o of st.torches) if (hs.torches.includes(o.id)) setTorch(sim, st, api, o, true);
    say(sim, st, 'f12_hush_end', 'БЕЗМОЛВИЕ ОТСТУПИЛО');
    const [x0, y0, x1, y1] = hs.box;
    const cx = (x0 + x1) / 2 + 0.5;
    const cy = (y0 + y1) / 2 + 2.5;
    api.dropAt(sim, 'f12_crystal', 1, cx, cy);
    api.dropAt(sim, 'token', 3, cx, cy);
  }
}

// ---------------------------------------------------------------------------
// Действия этажа: жаровня, ледяной затвор, гонг, лебёдка.
// ---------------------------------------------------------------------------

export const GATE_HITS = 3;
export const WINCH_STEPS = 3;

/** Затвор бьют только с северной стороны: короткий путь открывают «сверху». */
const gateSide = (sim: Sim, o: WorldObj) => sim.hero.y < o.y + 0.3;

function onUse(sim: Sim, o: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim);
  switch (o.ref) {
    case 'f12_brazier': {
      if (st.lit.has(o.id)) return false;
      lightBrazier(sim, st, api, o);
      // Тепло будит вмёрзших рядом (двух ближних).
      thawNear(sim, api, o.x + 0.5, o.y + 0.5, 2, 9);
      return true;
    }
    case 'f12_icegate': {
      if (!gateSide(sim, o)) return false;
      const n = (st.gates.get(o.id) ?? 0) + 1;
      st.gates.set(o.id, n);
      fx(sim, api, { x: o.x + 0.5, y: o.y + 0.6, r: 1.4, life: 0.7, art: 'f12_gatehit' });
      sim.events.push({ t: 'shake', k: 0.25 });
      if (n < GATE_HITS) {
        sim.events.push({ t: 'boss', what: 'f12_gate_hit' });
        return true;
      }
      for (let dx = -2; dx <= 2; dx++) {
        const x = o.x + dx;
        const mk = markAt(sim, x, o.y);
        if (mk === MK.iceGate || mk === MK.gateSide) {
          api.setTile(sim, x, o.y, T_FLOOR, MK.ice);
          fx(sim, api, { x: x + 0.5, y: o.y + 0.5, r: 1.2, life: 1, art: 'f12_shatter' });
        }
      }
      say(sim, st, 'f12_gate_wall', 'ЗАТВОР РАЗБИТ', 'короткий путь открыт');
      return true;
    }
    case 'f12_gong': {
      if (st.gong.cd > 0) return false;
      strikeGong(sim, st, api, o);
      return true;
    }
    case 'f12_winch': {
      if (st.winch.step >= WINCH_STEPS || st.winch.cd > 0) return false;
      st.winch.step += 1;
      st.winch.cd = 1.1;
      const sg = F12_GEO.strait;
      const y = topOf(sim, F12_LAKE) + sg.y1 - (st.winch.step - 1);
      for (let x = sg.bx0; x <= sg.bx1; x++) {
        api.setTile(sim, x, y, T_FLOOR, MK.bridge);
        fx(sim, api, { x: x + 0.5, y: y + 0.5, r: 0.9, life: 0.8, art: 'f12_splash' });
      }
      sim.events.push({ t: 'boss', what: 'f12_winch' });
      if (st.winch.step >= WINCH_STEPS) say(sim, st, 'f12_bridge_call', 'МОСТ ОПУЩЕН');
      return true;
    }
  }
  return false;
}

function useLabel(sim: Sim, o: WorldObj): string | null {
  const st = stateOf(sim);
  switch (o.ref) {
    case 'f12_brazier':
      return st.lit.has(o.id) ? null : 'Зажечь';
    case 'f12_icegate': {
      if (!gateSide(sim, o)) return null;
      const n = st.gates.get(o.id) ?? 0;
      return n ? `Разбить (${n}/${GATE_HITS})` : 'Разбить';
    }
    case 'f12_gong':
      return st.gong.cd > 0 ? null : 'Ударить в гонг';
    case 'f12_winch':
      return st.winch.step >= WINCH_STEPS ? null : st.winch.cd > 0 ? 'Крутится…' : 'Крутить';
  }
  return o.use?.label ?? null;
}

/** Лебёдка: сколько досок моста опущено (для рисовальщика). */
export const f12Winch = (sim: Sim | null) => (sim ? (STATE.get(sim)?.winch.step ?? 0) : 0);
/** Удары по затвору (для рисовальщика трещин). */
export const f12Gate = (sim: Sim | null, id: string) =>
  sim ? (STATE.get(sim)?.gates.get(id) ?? 0) : 0;

// ---------------------------------------------------------------------------
// Правило этажа.
// ---------------------------------------------------------------------------

/** Слои пола и неба — две зоны-картинки, едут за героем. */
function ensureFx(sim: Sim, st: F12State, api: SimApi): void {
  const h = sim.hero;
  if (!st.floorFx || !sim.zones.includes(st.floorFx)) {
    fx(sim, api, { x: h.x, y: h.y, r: 14, life: 1e9, art: 'f12_floor' });
    st.floorFx = sim.zones[sim.zones.length - 1];
  }
  if (!st.skyFx || !sim.zones.includes(st.skyFx)) {
    fx(sim, api, { x: h.x, y: h.y, r: 14, life: 1e9, art: 'f12_sky', above: true });
    st.skyFx = sim.zones[sim.zones.length - 1];
  }
  for (const z of [st.floorFx, st.skyFx]) {
    z.x = h.x;
    z.y = h.y;
    z.t = 0;
  }
}

registerFloor(12, {
  start(sim, api) {
    const st = stateOf(sim);
    for (const o of st.torches)
      api.light(sim, `f12t:${o.id}`, { x: o.x + 0.5, y: o.y + 0.1, r: 4, tint: 'warm' });
    ensureFx(sim, st, api);
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    const h = sim.hero;
    ensureFx(sim, st, api);
    stepIce(sim, st, api, dt);
    stepFloes(sim, st, api, dt);
    stepRapids(sim, st, api, dt);
    // Вода без льдины и битый лёд — провалился (рывок перелетает).
    if (!heroDown(sim) && h.mode !== 'dash' && !h.pull) {
      const mk = markAt(sim, Math.floor(h.x), Math.floor(h.y));
      if (mk === MK.current && !onFloe(st, h.x, h.y)) fallIn(sim, st, api, 'В ВОДУ');
      else if (brokenAt(st, sim, h.x, h.y)) {
        st.rapids.fell = true;
        fallIn(sim, st, api, 'ЛЁД ПРОЛОМИЛСЯ');
      }
    }
    stepSafe(sim, st);
    stepThin(sim, st, api, dt);
    stepMobsIce(sim, st, api, dt);
    stepFrost(sim, st, api, dt);
    stepDome(sim, st, api, dt);
    stepThaw(sim, st, api, dt);
    stepStorm(sim, st, api, dt);
    stepHush(sim, st, api, dt);
    stepPosts(sim, st, api);
    st.reveal = Math.max(0, st.reveal - dt);
    st.gong.cd = Math.max(0, st.gong.cd - dt);
    st.winch.cd = Math.max(0, st.winch.cd - dt);
    if (st.reveal <= 0) api.light(sim, 'f12gong', null);
  },
  onUse,
  useLabel,
});

// ---------------------------------------------------------------------------
// Монстры. Кадр контакта = кадр урона: рисовальщик берёт фазу из режима и
// `m.t`, урон приходит ровно в конце замаха.
// ---------------------------------------------------------------------------

function hit(
  sim: Sim,
  api: SimApi,
  m: Mob,
  dmg: number,
  knock: number,
  status?: { kind: 'chill' | 'slow' | 'stun'; dur: number },
): boolean {
  if (!canHurt(sim)) return false;
  api.hurtHero(sim, dmg, m.x, m.y, knock, m.kind, status);
  return true;
}

function inCone(sim: Sim, x: number, y: number, ang: number, r: number, arc: number): boolean {
  const h = sim.hero;
  const d = hypot(h.x - x, h.y - y);
  if (d > r + h.r) return false;
  if (d < 0.6) return true;
  return Math.abs(angDiff(Math.atan2(h.y - y, h.x - x), ang)) <= arc / 2 + h.r / Math.max(1, d);
}

function inLine(sim: Sim, x: number, y: number, ang: number, len: number, w: number): boolean {
  const h = sim.hero;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const hx = h.x - x;
  const hy = h.y - y;
  const al = hx * ux + hy * uy;
  const ac = Math.abs(-hx * uy + hy * ux);
  return al > -0.3 && al < len + h.r && ac < w / 2 + h.r;
}

/** Ближайшая клетка с меткой из набора в радиусе (центр клетки). */
function nearestMark(
  sim: Sim,
  x: number,
  y: number,
  r: number,
  ok: (mk: number, t: number) => boolean,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = r;
  for (let yy = Math.floor(y - r); yy <= y + r; yy++)
    for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if (!ok(markAt(sim, xx, yy), tileAt(sim, xx, yy))) continue;
      const d = hypot(xx + 0.5 - x, yy + 0.5 - y);
      if (d < bd) {
        bd = d;
        best = [xx + 0.5, yy + 0.5];
      }
    }
  return best;
}

// --- Лемминг: стайка, зигзаг, прыжок-укус ---------------------------------

export const LEMMING = { aim: 0.32, hop: 0.16, hopV: 8, rest: 0.55 };

brain('f12_lemming', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        if (c.dist < 1.25 + m.r && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.face = m.dir;
          api.setMode(m, 'f12_wind');
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        // Зигзаг: бок по синусу, у каждого свой такт.
        const w = Math.sin(sim.time * 7 + m.id * 1.7) * (c.dist > 2 ? 0.75 : 0.2);
        api.steer(sim, m, dx - dy * w, dy + dx * w, m.speed, dt);
        return;
      }
      case 'f12_wind':
        // Присел перед прыжком.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.tele = { shape: 'line', r: 1.3, w: 0.4, ang: m.dir, k: clamp(m.t / LEMMING.aim, 0, 1) };
        if (m.t > LEMMING.aim - 0.15) m.danger = 1.4;
        if (m.t >= LEMMING.aim) api.setMode(m, 'f12_hop');
        return;
      case 'f12_hop':
        m.vx = Math.cos(m.dir) * LEMMING.hopV;
        m.vy = Math.sin(m.dir) * LEMMING.hopV;
        if (!m.data.bit && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.25) {
          m.data.bit = 1;
          hit(sim, api, m, m.dmg, 2.5);
        }
        if (m.t >= LEMMING.hop) {
          m.data.bit = 0;
          m.cd = LEMMING.rest + sim.rng() * 0.4;
          api.setMode(m, 'recover');
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.4);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// --- Ёж-ледышка: сворачивается и катится, иглы с инеем ---------------------

export const URCHIN = {
  curl: 0.7,
  roll: 8,
  rollT: 1.7,
  bounces: 3,
  dizzy: 1.3,
  quills: 0.6,
  needles: 10,
  see: 7.5,
};

brain('f12_urchin', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        const see = c.dist < URCHIN.see && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.face = m.dir;
          api.setMode(m, c.dist < 2.4 ? 'f12_bristle' : 'f12_curl');
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed, dt);
        return;
      }
      case 'f12_curl': {
        // Сворачивается, прицел дрожит за героем до последней четверти.
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t < URCHIN.curl * 0.7) m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        const len = Math.min(9, clearDist(sim, api, m.x, m.y, m.dir, 9));
        m.tele = { shape: 'line', r: len, w: 0.9, ang: m.dir, k: clamp(m.t / URCHIN.curl, 0, 1) };
        if (m.t > URCHIN.curl - 0.2) m.danger = 1.5;
        if (m.t >= URCHIN.curl) {
          m.bounce = true;
          m.bounces = 0;
          m.data.bit = 0;
          api.setMode(m, 'f12_roll');
          sim.events.push({ t: 'boss', what: 'f12_roll' });
        }
        return;
      }
      case 'f12_roll': {
        m.vx = Math.cos(m.dir) * URCHIN.roll;
        m.vy = Math.sin(m.dir) * URCHIN.roll;
        m.danger = 1;
        if (!m.data.bit && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.1) {
          if (hit(sim, api, m, m.dmg, 6)) m.data.bit = 1;
        }
        if (m.t > URCHIN.rollT || m.bounces >= URCHIN.bounces) {
          m.bounce = false;
          api.setMode(m, 'dizzy');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > URCHIN.dizzy) {
          m.cd = 1 + sim.rng() * 0.8;
          api.setMode(m, 'chase');
        }
        return;
      case 'f12_bristle':
        // Иглы дыбом — потом кольцо игл с инеем.
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.tele = { shape: 'ring', r: 3, w: 0.5, k: clamp(m.t / URCHIN.quills, 0, 1) };
        if (m.t > URCHIN.quills - 0.2) m.danger = 3;
        if (m.t >= URCHIN.quills) {
          const n = URCHIN.needles;
          const a0 = sim.rng() * TAU;
          for (let k = 0; k < n; k++)
            api.shoot(sim, m, a0 + (k / n) * TAU, {
              speed: 7.5,
              r: 0.2,
              life: 0.55,
              // Доля урона моба (`ShotSpec.dmg`), не сам урон.
              dmg: 0.6,
              art: 'f12_quill',
              status: 'chill',
              dur: 1.2,
            });
          m.cd = 1.6 + sim.rng() * 0.8;
          api.setMode(m, 'recover');
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, nx, ny) {
    if (m.mode !== 'f12_roll') return;
    // Отскок от стены — зеркально.
    const vx = Math.cos(m.dir);
    const vy = Math.sin(m.dir);
    const d = vx * nx + vy * ny;
    m.dir = Math.atan2(vy - 2 * d * ny, vx - 2 * d * nx);
    m.bounces += 1;
    sim.events.push({ t: 'shake', k: 0.12 });
  },
  onHit(_sim, m) {
    // Свёрнутый — шар игл: удар скользит.
    if (m.mode === 'f12_roll' || m.mode === 'f12_curl') return 0.35;
    return 1;
  },
});

// --- Тюлень: ждёт у лунки, выныривает, скользит на брюхе -------------------

export const SEAL = { wake: 5.5, rise: 0.55, aim: 0.65, slide: 7.5, slideT: 1.1, see: 9 };

brain('f12_seal', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f12_under':
        m.vx = 0;
        m.vy = 0;
        m.data.hide = 1;
        if (c.dist < SEAL.wake && !heroDown(sim)) {
          api.setMode(m, 'f12_rise');
          sim.events.push({ t: 'boss', what: 'f12_seal_splash' });
          fx(sim, api, {
            x: m.data.hx ?? m.x,
            y: m.data.hy ?? m.y,
            r: 1.3,
            life: 0.9,
            art: 'f12_splash',
          });
        }
        return;
      case 'f12_rise':
        m.data.hide = m.t < 0.15 ? 1 : 0;
        m.face = Math.atan2(c.dy, c.dx);
        if (m.t >= SEAL.rise) {
          m.cd = 0.3;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        m.data.hide = 0;
        const see = c.dist < SEAL.see && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0 && c.dist > 1.6) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f12_wind');
          return;
        }
        if (c.dist < 1.6 && m.cd <= 0) {
          // Вплотную — удар ластом-боком.
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f12_flip');
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        // Переваливается: скорость пульсирует.
        const k = 0.55 + 0.45 * Math.abs(Math.sin(m.t * 5));
        api.steer(sim, m, dx, dy, m.speed * k, dt);
        return;
      }
      case 'f12_wind': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < SEAL.aim * 0.6) m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        const len = Math.min(8, clearDist(sim, api, m.x, m.y, m.dir, 8));
        m.tele = { shape: 'line', r: len, w: 1.2, ang: m.dir, k: clamp(m.t / SEAL.aim, 0, 1) };
        if (m.t > SEAL.aim - 0.2) m.danger = 1.6;
        if (m.t >= SEAL.aim) {
          m.data.bit = 0;
          api.setMode(m, 'f12_slide');
          sim.events.push({ t: 'boss', what: 'f12_glide' });
        }
        return;
      }
      case 'f12_slide': {
        // На брюхе: разгон сразу, к концу тормозит (на льду — дольше).
        const ice = slippery(markAt(sim, Math.floor(m.x), Math.floor(m.y)));
        const T = SEAL.slideT * (ice ? 1.5 : 1);
        const v = SEAL.slide * (1 - (m.t / T) ** 2);
        m.vx = Math.cos(m.dir) * v;
        m.vy = Math.sin(m.dir) * v;
        m.danger = 1.2;
        if (!m.data.bit && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.15) {
          if (hit(sim, api, m, m.dmg, 9)) m.data.bit = 1;
        }
        if (m.t >= T) {
          m.cd = 1.4 + sim.rng() * 0.8;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f12_flip': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        m.tele = { shape: 'cone', r: 1.9, arc: 1.7, ang: m.dir, k: clamp(m.t / 0.5, 0, 1) };
        if (m.t > 0.3) m.danger = 1.9;
        if (m.t >= 0.5) {
          if (inCone(sim, m.x, m.y, m.dir, 1.9, 1.7)) hit(sim, api, m, m.dmg * 0.8, 6);
          m.cd = 1 + sim.rng() * 0.5;
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
  onHit(_sim, m) {
    if (m.mode === 'f12_under') return 0;
    // Жир на спине: в лоб слабо, в скольжении — бока открыты.
    if (m.mode === 'f12_slide') return 1.3;
    return 1;
  },
});

// --- Сосулька: висит на своде, трещит, падает, торчит ----------------------

export const ICICLE = { trig: 1.7, crack: 0.8, stuck: 3, regrow: 25, r: 1.05 };

function icicleRegrow(sim: Sim, m: Mob): void {
  const st = STATE.get(sim);
  const p = st?.posts.find((x) => x.id === m.data.post);
  if (p) p.regrow = sim.time + ICICLE.regrow;
}

brain('f12_icicle', {
  step(sim, m, _dt, _c, api) {
    const h = sim.hero;
    m.vx = 0;
    m.vy = 0;
    m.tele = null;
    m.danger = 0;
    m.data.noIce = 1;
    switch (m.mode) {
      case 'f12_hang':
        m.data.hide = 1;
        // Герой под ней (или моб тяжёлый) — треск.
        if (!heroDown(sim) && hypot(h.x - m.x, h.y - m.y) < ICICLE.trig) {
          api.setMode(m, 'f12_crack');
          sim.events.push({ t: 'boss', what: 'f12_crack' });
          api.strike(sim, {
            shape: 'circle',
            x: m.x,
            y: m.y,
            r: ICICLE.r,
            warn: ICICLE.crack,
            dmg: m.dmg,
            knock: 3,
            status: 'chill',
            dur: 1.4,
            art: 'f12_iciclefall',
            from: m.id,
            mobDmg: 40,
          });
        }
        return;
      case 'f12_crack':
        m.data.hide = 1;
        if (m.t >= ICICLE.crack) {
          api.setMode(m, 'f12_stuck');
          sim.events.push({ t: 'boss', what: 'f12_shatter' });
          sim.events.push({ t: 'shake', k: 0.22 });
        }
        return;
      case 'f12_stuck':
        // Воткнулась — бей, пока торчит (за неё дают осколок).
        m.data.hide = 0;
        if (m.t >= ICICLE.stuck) {
          icicleRegrow(sim, m);
          m.data.post = 0;
          fx(sim, api, { x: m.x, y: m.y, r: 1, life: 0.8, art: 'f12_shatter' });
          api.setMode(m, 'escape');
        }
        return;
      default:
        api.setMode(m, 'f12_hang');
    }
  },
  onHit(_sim, m) {
    return m.mode === 'f12_stuck' ? 1.5 : 0;
  },
});

// --- Полярная сова: сидит в нише, видит того, кто в свете, пикирует --------

export const OWL = {
  spot: 0.7,
  dive: 10.5,
  ground: 1.1,
  rise: 0.55,
  hover: [1.8, 3] as [number, number],
};

brain('f12_owl', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    const dome = (m.data.dome ?? 0) > 0;
    // В Куполе совы видят только того, кто стоит в ленте сияния.
    const prey = !heroDown(sim) && (dome ? inAurora(sim, h.x, h.y) : c.dist < 8.5);
    switch (m.mode) {
      case 'f12_perch':
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.data.hide = 1;
        if (prey && c.dist < 13 && m.cd <= 0) api.setMode(m, 'f12_spot');
        else if (dome && m.t > 2.5) api.setMode(m, 'f12_hover');
        return;
      case 'f12_hover': {
        // Кружит под сводом: недосягаема, ждёт, когда встанешь в свет.
        m.data.hide = 1;
        const a = sim.time * 0.9 + m.id;
        const r = 4.5;
        const tx = (dome ? m.hx : h.x) + Math.cos(a) * r;
        const ty = (dome ? m.hy : h.y) + Math.sin(a) * r * 0.7;
        api.steer(sim, m, tx - m.x, ty - m.y, m.speed, dt);
        m.face = Math.atan2(m.vy, m.vx);
        if (prey && m.cd <= 0 && m.t > (m.data.hov ?? 1.5)) api.setMode(m, 'f12_spot');
        return;
      }
      case 'f12_spot': {
        // Глаза вспыхнули: метка ведёт героя до последней трети.
        m.data.hide = 0;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < OWL.spot * 0.66) m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        const len = Math.min(12, hypot(h.x - m.x, h.y - m.y) + 1.5);
        m.data.len = len;
        m.tele = { shape: 'line', r: len, w: 0.8, ang: m.dir, k: clamp(m.t / OWL.spot, 0, 1) };
        if (m.t > OWL.spot - 0.2) m.danger = 1.4;
        if (m.t >= OWL.spot) {
          m.data.bit = 0;
          api.setMode(m, 'f12_dive');
          sim.events.push({ t: 'boss', what: 'f12_owl_dive' });
        }
        return;
      }
      case 'f12_dive': {
        m.data.hide = 0;
        m.vx = Math.cos(m.dir) * OWL.dive;
        m.vy = Math.sin(m.dir) * OWL.dive;
        m.danger = 1;
        if (!m.data.bit && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.2) {
          if (hit(sim, api, m, m.dmg, 4)) m.data.bit = 1;
        }
        if (m.t * OWL.dive >= (m.data.len ?? 8)) api.setMode(m, 'f12_ground');
        return;
      }
      case 'f12_ground':
        // Промахнулась — сидит на земле, крылья врастопырку: бей.
        m.data.hide = 0;
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t >= OWL.ground) api.setMode(m, 'f12_rise');
        return;
      case 'f12_rise':
        m.data.hide = 0;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t >= OWL.rise) {
          m.cd = 0.6;
          m.data.hov = OWL.hover[0] + sim.rng() * (OWL.hover[1] - OWL.hover[0]);
          api.setMode(m, 'f12_hover');
        }
        return;
      case 'chase':
        // Из «Безмолвия» или после гонга — сразу в небо.
        api.setMode(m, 'f12_hover');
        return;
      default:
        api.setMode(m, 'f12_hover');
    }
  },
  onHit(_sim, m) {
    if (m.mode === 'f12_ground') return 1.6;
    return 1;
  },
});

// --- Вмёрзший воин: глыба льда, оживает от тепла или трёх ударов ----------

export const WARRIOR = {
  near: 1.5,
  nearT: 1.2,
  thaw: 1.1,
  wind: 0.75,
  slam: 0.95,
  rest: 0.8,
  hits: 3,
};

brain('f12_warrior', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f12_frozen':
        m.vx = 0;
        m.vy = 0;
        m.data.hide = 0;
        if (!heroDown(sim) && c.dist < WARRIOR.near) m.data.near = (m.data.near ?? 0) + dt;
        else m.data.near = Math.max(0, (m.data.near ?? 0) - dt);
        if ((m.data.near ?? 0) > WARRIOR.nearT || (m.data.hits ?? 0) >= WARRIOR.hits)
          api.setMode(m, 'f12_thaw');
        return;
      case 'f12_thaw':
        // Лёд трескается и слетает кусками.
        m.vx = 0;
        m.vy = 0;
        m.face = Math.atan2(c.dy, c.dx);
        if (m.t < dt * 1.5) {
          sim.events.push({ t: 'boss', what: 'f12_shatter' });
          fx(sim, api, { x: m.x, y: m.y, r: 1.5, life: 1, art: 'f12_shatter' });
        }
        if (m.t >= WARRIOR.thaw) {
          m.cd = 0.4;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        if (c.dist < m.r + h.r + 1.1 && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.face = m.dir;
          m.data.n = (m.data.n ?? 0) + 1;
          api.setMode(m, m.data.n % 3 === 0 ? 'f12_slam' : 'f12_wind');
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed, dt);
        return;
      }
      case 'f12_wind': {
        // Рубка топором: конус спереди.
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t < WARRIOR.wind * 0.5) m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: 2, arc: 1.7, ang: m.dir, k: clamp(m.t / WARRIOR.wind, 0, 1) };
        if (m.t > WARRIOR.wind - 0.22) m.danger = 2;
        if (m.t >= WARRIOR.wind) {
          if (inCone(sim, m.x, m.y, m.dir, 2, 1.7)) hit(sim, api, m, m.dmg, 5);
          m.vx = Math.cos(m.dir) * 3;
          m.vy = Math.sin(m.dir) * 3;
          m.cd = WARRIOR.rest + sim.rng() * 0.5;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f12_slam': {
        // Сверху вниз: круг впереди, иней.
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.face = m.dir;
        const x = m.x + Math.cos(m.dir) * 1.2;
        const y = m.y + Math.sin(m.dir) * 1.2;
        m.tele = { shape: 'circle', r: 1.35, x, y, k: clamp(m.t / WARRIOR.slam, 0, 1) };
        if (m.t > WARRIOR.slam - 0.22) m.danger = 2.5;
        if (m.t >= WARRIOR.slam) {
          if (hypot(h.x - x, h.y - y) < 1.35 + h.r)
            hit(sim, api, m, m.dmg * 1.15, 6, { kind: 'chill', dur: 1.5 });
          fx(sim, api, { x, y, r: 1.4, life: 0.7, art: 'f12_frostburst' });
          sim.events.push({ t: 'shake', k: 0.2 });
          m.cd = WARRIOR.rest + 0.4;
          api.setMode(m, 'recover');
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
  onHit(sim, m) {
    if (m.mode === 'f12_frozen') {
      // Лёд держит: трещит от ударов, после третьего — воин на свободе.
      m.data.hits = (m.data.hits ?? 0) + 1;
      sim.events.push({ t: 'boss', what: 'f12_crack' });
      return 0.3;
    }
    if (m.mode === 'f12_thaw') return 1.4;
    return 1;
  },
});

// --- Дух стужи: гасит огни, дышит инеем, боится жаровни -------------------

export const SPIRIT = { see: 9, keep: 2.8, wind: 0.6, cone: 2.8, arc: 1, douse: 0.85, hurt: 0.22 };

function litNear(sim: Sim, st: F12State, x: number, y: number, r: number): WorldObj | null {
  let best: WorldObj | null = null;
  let bd = r;
  for (const o of st.torches) {
    if (!st.torchOn.has(o.id)) continue;
    const d = hypot(o.x + 0.5 - x, o.y + 0.5 - y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

brain('f12_spirit', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const st = stateOf(sim);
    m.tele = null;
    m.danger = 0;
    // У горящей жаровни дух тает.
    for (const o of st.braziers)
      if (st.lit.has(o.id) && hypot(o.x + 0.5 - m.x, o.y + 0.5 - m.y) < 2.4) {
        envHurt(sim, api, m, SPIRIT.hurt * dt);
        m.flash = Math.max(m.flash, 0.05);
        if (m.mode !== 'f12_flee') api.setMode(m, 'f12_flee');
      }
    switch (m.mode) {
      case 'chase': {
        // Огонь рядом — сперва гасить.
        const t = m.cd <= 0 && (m.data.douse ?? 0) <= 0 ? litNear(sim, st, m.x, m.y, 7) : null;
        if (t) {
          m.data.tx = t.x + 0.5;
          m.data.ty = t.y + 0.6;
          m.data.tid = st.torches.indexOf(t);
          api.setMode(m, 'f12_douse');
          return;
        }
        if (c.dist < SPIRIT.cone && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f12_wind');
          return;
        }
        // Держится на расстоянии дыхания, плывёт волной.
        const k = c.dist > SPIRIT.keep ? 1 : -0.4;
        const w = Math.sin(sim.time * 2.3 + m.id) * 0.6;
        const ux = c.dx / (c.dist || 1);
        const uy = c.dy / (c.dist || 1);
        api.steer(sim, m, ux * k - uy * w, uy * k + ux * w, m.speed, dt);
        m.face = Math.atan2(c.dy, c.dx);
        return;
      }
      case 'f12_douse': {
        const tx = m.data.tx;
        const ty = m.data.ty;
        const d = hypot(tx - m.x, ty - m.y);
        if (d > 1) {
          api.steer(sim, m, tx - m.x, ty - m.y, m.speed * 1.2, dt);
          m.face = Math.atan2(ty - m.y, tx - m.x);
          m.data.blow = 0;
          if (m.t > 5) api.setMode(m, 'chase');
          return;
        }
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.data.blow = (m.data.blow ?? 0) + dt;
        if (m.data.blow >= SPIRIT.douse) {
          const o = st.torches[m.data.tid];
          if (o) {
            setTorch(sim, st, api, o, false);
            sim.events.push({ t: 'boss', what: 'f12_blowout' });
            // Держит огонь в себе: убьёшь — факел вспыхнет снова.
            m.data.held = m.data.tid + 1;
          }
          m.data.douse = 1;
          m.cd = 0.6;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'f12_wind': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < SPIRIT.wind * 0.6) m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        m.tele = {
          shape: 'cone',
          r: SPIRIT.cone,
          arc: SPIRIT.arc,
          ang: m.dir,
          k: clamp(m.t / SPIRIT.wind, 0, 1),
        };
        if (m.t > SPIRIT.wind - 0.2) m.danger = SPIRIT.cone;
        if (m.t >= SPIRIT.wind) {
          if (inCone(sim, m.x, m.y, m.dir, SPIRIT.cone, SPIRIT.arc))
            hit(sim, api, m, m.dmg, 2, { kind: 'chill', dur: 1.8 });
          fx(sim, api, {
            x: m.x,
            y: m.y,
            r: SPIRIT.cone,
            life: 0.55,
            art: 'f12_breath',
            dur: m.dir,
          });
          m.cd = 1.3 + sim.rng() * 0.6;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f12_flee': {
        const away = Math.atan2(m.y - h.y, m.x - h.x);
        api.steer(sim, m, Math.cos(away), Math.sin(away), m.speed * 1.3, dt);
        if (m.t > 1.2) api.setMode(m, 'chase');
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    const st = STATE.get(sim);
    const o = st && m.data.held ? st.torches[m.data.held - 1] : null;
    if (!st || !o) return;
    // Факелы «Безмолвия» вспыхнут, только когда зал отступит.
    if (st.hush.state === 'on' && st.hush.torches.includes(o.id)) return;
    setTorch(sim, st, api, o, true);
  },
});

// --- Песец: ждёт в сугробе, прыгает, кусает сериями; ниже половины —
// встаёт оборотнем ---------------------------------------------------------

export const FOX = { wake: 4.2, leap: 0.6, land: 1.05, bite: 0.32, gap: 0.2, burrow: 1.4 };

brain('f12_fox', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    const were = m.hp < m.maxHp * 0.5;
    if (were && !m.data.were) {
      m.data.were = 1;
      m.speed *= 1.2;
      m.dmg *= 1.25;
      sim.events.push({ t: 'boss', what: 'f12_fox_howl' });
    }
    switch (m.mode) {
      case 'f12_hide':
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.data.hide = 1;
        if (!heroDown(sim) && c.dist < FOX.wake && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          m.data.lx = h.x;
          m.data.ly = h.y;
          m.data.ox = m.x;
          m.data.oy = m.y;
          api.setMode(m, 'f12_leap');
          fx(sim, api, { x: m.x, y: m.y, r: 1.3, life: 0.8, art: 'f12_snowburst' });
          sim.events.push({ t: 'boss', what: 'f12_fox_leap' });
        }
        return;
      case 'f12_leap': {
        // Дуга из сугроба на то место, где герой был при прыжке.
        m.data.hide = 0;
        const k = clamp(m.t / FOX.leap, 0, 1);
        const tx = m.data.lx;
        const ty = m.data.ly;
        m.tele = { shape: 'circle', r: FOX.land, x: tx, y: ty, k };
        m.danger = k > 0.7 ? 1.2 : 0;
        const nx = m.data.ox + (tx - m.data.ox) * k;
        const ny = m.data.oy + (ty - m.data.oy) * k;
        m.vx = (nx - m.x) / Math.max(dt, 1e-3);
        m.vy = (ny - m.y) / Math.max(dt, 1e-3);
        m.face = Math.atan2(ty - m.data.oy, tx - m.data.ox);
        if (k >= 1) {
          m.vx = 0;
          m.vy = 0;
          if (hypot(h.x - tx, h.y - ty) < FOX.land + h.r) hit(sim, api, m, m.dmg * 1.1, 4);
          fx(sim, api, { x: tx, y: ty, r: 1.2, life: 0.6, art: 'f12_snowburst' });
          m.data.combo = 0;
          m.cd = 0.25;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'chase': {
        m.data.hide = 0;
        // После двух серий — назад в сугроб (если рядом есть).
        if ((m.data.combo ?? 0) >= 2 && !m.data.were) {
          const d = nearestMark(
            sim,
            m.x,
            m.y,
            7,
            (mk, t) => (mk === MK.drift || mk === MK.foxDrift) && t !== T_WALL,
          );
          if (d) {
            m.data.bx = d[0];
            m.data.by = d[1];
            api.setMode(m, 'f12_burrow');
            return;
          }
          m.data.combo = 0;
        }
        if (c.dist < m.r + h.r + 0.9 && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.data.bites = 0;
          api.setMode(m, 'f12_wind');
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed, dt);
        return;
      }
      case 'f12_wind': {
        m.vx *= 0.55;
        m.vy *= 0.55;
        m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        const T = (m.data.bites ?? 0) === 0 ? FOX.bite : FOX.gap;
        m.tele = { shape: 'cone', r: 1.5, arc: 1.3, ang: m.dir, k: clamp(m.t / T, 0, 1) };
        if (m.t > T - 0.15) m.danger = 1.5;
        if (m.t >= T) {
          if (inCone(sim, m.x, m.y, m.dir, 1.5, 1.3)) hit(sim, api, m, m.dmg * 0.7, 2.5);
          m.vx = Math.cos(m.dir) * 3.5;
          m.vy = Math.sin(m.dir) * 3.5;
          m.data.bites = (m.data.bites ?? 0) + 1;
          if (m.data.bites < (m.data.were ? 3 : 2)) {
            m.t = 0;
            return;
          }
          m.data.combo = (m.data.combo ?? 0) + 1;
          m.cd = 0.8 + sim.rng() * 0.5;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f12_burrow': {
        const tx = m.data.bx;
        const ty = m.data.by;
        const d = hypot(tx - m.x, ty - m.y);
        if (d > 0.5 && m.t < 3) {
          api.steer(sim, m, tx - m.x, ty - m.y, m.speed * 1.3, dt);
          m.face = Math.atan2(m.vy, m.vx);
          m.data.dug = 0;
          return;
        }
        m.vx = 0;
        m.vy = 0;
        m.data.dug = (m.data.dug ?? 0) + dt;
        if (m.data.dug > 0.3) m.data.hide = 1;
        if (m.data.dug >= FOX.burrow) {
          m.data.combo = 0;
          api.setMode(m, 'f12_hide');
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

// --- Ледяной голем: кулак, каждый третий — топот кольцом, ломает лёд -------

export const GOLEM = { wind: 0.9, stomp: 1.15, ring: 2.7, rest: 1 };

brain('f12_golem', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        if (c.dist < m.r + h.r + 1.3 && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          m.face = m.dir;
          m.data.n = (m.data.n ?? 0) + 1;
          api.setMode(m, m.data.n % 3 === 0 ? 'f12_stomp' : 'f12_wind');
          return;
        }
        const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, dx, dy, m.speed, dt);
        m.face = Math.atan2(c.dy, c.dx);
        return;
      }
      case 'f12_wind': {
        m.vx *= 0.4;
        m.vy *= 0.4;
        if (m.t < GOLEM.wind * 0.5) m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        const x = m.x + Math.cos(m.dir) * 1.4;
        const y = m.y + Math.sin(m.dir) * 1.4;
        m.tele = { shape: 'circle', r: 1.25, x, y, k: clamp(m.t / GOLEM.wind, 0, 1) };
        if (m.t > GOLEM.wind - 0.22) m.danger = 2.6;
        if (m.t >= GOLEM.wind) {
          if (hypot(h.x - x, h.y - y) < 1.25 + h.r) hit(sim, api, m, m.dmg, 7);
          fx(sim, api, { x, y, r: 1.3, life: 0.6, art: 'f12_frostburst' });
          sim.events.push({ t: 'shake', k: 0.25 });
          m.cd = GOLEM.rest + sim.rng() * 0.5;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f12_stomp': {
        m.vx *= 0.3;
        m.vy *= 0.3;
        m.tele = { shape: 'circle', r: GOLEM.ring, k: clamp(m.t / GOLEM.stomp, 0, 1) };
        if (m.t > GOLEM.stomp - 0.25) m.danger = GOLEM.ring;
        if (m.t >= GOLEM.stomp) {
          if (hypot(h.x - m.x, h.y - m.y) < GOLEM.ring + h.r)
            hit(sim, api, m, m.dmg * 0.9, 8, { kind: 'chill', dur: 1.6 });
          fx(sim, api, { x: m.x, y: m.y, r: GOLEM.ring, life: 0.8, art: 'f12_stompring' });
          sim.events.push({ t: 'shake', k: 0.4 });
          sim.events.push({ t: 'boss', what: 'f12_stomp' });
          // Тонкий лёд вокруг трескается.
          const st = stateOf(sim);
          for (let y = Math.floor(m.y - 3); y <= m.y + 3; y++)
            for (let x = Math.floor(m.x - 3); x <= m.x + 3; x++)
              if (hypot(x + 0.5 - m.x, y + 0.5 - m.y) < GOLEM.ring)
                loadThin(sim, st, api, x, y, 1.2);
          m.cd = GOLEM.rest + 0.6;
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
  onHit(sim, m, hitIn) {
    // Ядро светится в спине: сзади ×1,5, в лоб лёд держит.
    const back = Math.abs(angDiff(hitIn.ang, m.face)) < 1.1;
    if (back) return 1.5;
    return m.mode === 'recover' ? 1 : 0.75;
  },
});

// --- Хранитель сияния: щит, занавес, зовёт духов ---------------------------

export const KEEPER = {
  keep: [4, 6.5] as [number, number],
  cast: 0.85,
  warn: 0.95,
  len: 9,
  w: 1.4,
  spent: 3,
  summonCd: 12,
  summon: 1,
  shield: 0.3,
};

brain('f12_keeper', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    if (m.data.sum === undefined) m.data.sum = 5;
    m.data.sum -= dt;
    m.data.spent = Math.max(0, (m.data.spent ?? 0) - dt);
    switch (m.mode) {
      case 'chase': {
        if (m.data.sum <= 0) {
          const kids = sim.mobs.filter((x) => x.kind === 'f12_spirit' && x.mode !== 'dying').length;
          if (kids < 4) {
            api.setMode(m, 'f12_summon');
            return;
          }
          m.data.sum = 4;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && c.dist < KEEPER.len && m.cd <= 0) {
          m.dir = Math.atan2(c.dy, c.dx);
          api.setMode(m, 'f12_wind');
          return;
        }
        // Держит дистанцию: подходит до 4, отходит, если ближе.
        const ux = c.dx / (c.dist || 1);
        const uy = c.dy / (c.dist || 1);
        let k = 0;
        if (c.dist > KEEPER.keep[1] || !see) {
          const [dx, dy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, dx, dy, m.speed, dt);
        } else {
          k = c.dist < KEEPER.keep[0] ? -1 : 0;
          const w = Math.sin(sim.time * 0.8 + m.id) * 0.8;
          api.steer(sim, m, ux * k - uy * w, uy * k + ux * w, m.speed * 0.8, dt);
        }
        m.face = Math.atan2(c.dy, c.dx);
        return;
      }
      case 'f12_wind':
        // Посох вверх — занавес сияния падает линией.
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.dir = Math.atan2(h.y - m.y, h.x - m.x);
        m.face = m.dir;
        if (m.t >= KEEPER.cast) {
          const len = Math.min(KEEPER.len, clearDist(sim, api, m.x, m.y, m.dir, KEEPER.len));
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: KEEPER.w,
            ang: m.dir,
            warn: KEEPER.warn,
            dmg: m.dmg,
            knock: 3,
            status: 'chill',
            dur: 1.8,
            art: 'f12_curtain',
            from: m.id,
          });
          m.data.spent = KEEPER.spent;
          m.cd = 2.6 + sim.rng() * 0.8;
          api.setMode(m, 'recover');
        }
        return;
      case 'f12_summon':
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t >= KEEPER.summon) {
          for (const s of [-1, 1]) {
            const a = m.face + (s * Math.PI) / 2;
            const x = m.x + Math.cos(a) * 1.6;
            const y = m.y + Math.sin(a) * 1.6;
            const kid = api.spawnMob(sim, 'f12_spirit', x, y, { mode: 'chase' });
            kid.data.hush = m.data.hush ?? 0;
            fx(sim, api, { x, y, r: 1, life: 0.8, art: 'f12_ignite' });
          }
          sim.events.push({ t: 'boss', what: 'f12_summon' });
          m.data.sum = KEEPER.summonCd;
          m.data.spent = KEEPER.spent;
          api.setMode(m, 'recover');
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.9);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m) {
    const st = STATE.get(sim);
    const warm = st?.braziers.some(
      (o) => st.lit.has(o.id) && hypot(o.x + 0.5 - m.x, o.y + 0.5 - m.y) < 3.2,
    );
    if (warm || (m.data.spent ?? 0) > 0 || m.mode === 'f12_wind' || m.mode === 'f12_summon')
      return 1;
    return KEEPER.shield;
  },
});

// --- Песец с мешком: удирает, роняет монеты -------------------------------

brain('f12_sackfox', {
  step(sim, m, dt, _c, api) {
    m.tele = null;
    m.danger = 0;
    m.data.life = (m.data.life ?? 0) + dt;
    if (m.data.life > 14) {
      fx(sim, api, { x: m.x, y: m.y, r: 1.2, life: 0.8, art: 'f12_snowburst' });
      api.setMode(m, 'escape');
      return;
    }
    const d = api.flowDir(sim, m.x, m.y, true);
    const w = Math.sin(sim.time * 6 + m.id) * 0.5;
    if (d) api.steer(sim, m, d[0] - d[1] * w, d[1] + d[0] * w, m.speed, dt);
    m.face = Math.atan2(m.vy, m.vx);
    if (m.mode !== 'flee') api.setMode(m, 'flee');
  },
  onHit(sim, m, _h, api) {
    // Звенит мешок: пара монет на каждый удар.
    api.dropAt(sim, 'coin', 120, m.x, m.y);
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Босс: Ледниковый мамонт и шаманка сияния у него на спине.
// Ходит «танком»: разворачивается медленно, боком не ходит. Набег в стену —
// оглушён, треснувший бивень светится (урон ×2).
// ---------------------------------------------------------------------------

export const MAMMOTH = {
  notches: [0.75, 0.5, 0.25],
  turn: 1.5,
  intro: 2.4,
  rear: 1.6,
  tusk: { hit: 0.85, end: 1.35, r: 2.9, arc: 2.0 },
  stomp: { hit: 1.0, end: 1.55, r: 2.7 },
  paw: 1.05,
  charge: { v: 11, acc: 9, steer: 0.15, max: 2.3, skid: 0.85 },
  stun: 2.4,
  drum: { beat: 0.35, end: 1.5, walls: 3 },
  spikes: { hit: 0.9, end: 1.4, len: 9.5, warn: 0.7 },
  blow: { hit: 0.9, end: 1.3 },
  cd: { charge: [7, 4.5], stomp: 5, drum: 9, spikes: 6, douse: 9 },
};

interface Mammoth {
  /** Ледник: клетка → прежние клетка и метка. */
  saved: Map<number, [number, number]>;
  layers: number[][];
  layer: number;
  layerT: number;
  chargeCd: number;
  stompCd: number;
  drumCd: number;
  spikesCd: number;
  douseCd: number;
  shaman: number;
  /** Сколько стен-валов вьюги ещё выпустить и когда. */
  walls: number;
  wallT: number;
}

const MAM = new WeakMap<Sim, Mammoth>();

function mamOf(sim: Sim): Mammoth {
  let s = MAM.get(sim);
  if (!s) {
    s = {
      saved: new Map(),
      layers: [],
      layer: 0,
      layerT: 0,
      chargeCd: 6,
      stompCd: 3,
      drumCd: 2,
      spikesCd: 2,
      douseCd: 4,
      shaman: 0,
      walls: 0,
      wallT: 0,
    };
    MAM.set(sim, s);
  }
  return s;
}

/** Мамонт для рисовальщика шаманки и для эффектов. */
export const f12Mammoth = (sim: Sim | null): Mob | null =>
  sim?.mobs.find((m) => m.kind === 'f12boss') ?? null;

/** Слои ледника и сколько уже поднято (для рисовальщика предупреждения). */
export const f12Glacier = (sim: Sim | null): { layers: number[][]; layer: number } => {
  const s = sim ? MAM.get(sim) : null;
  return { layers: s?.layers ?? [], layer: s?.layer ?? 0 };
};

/** Слои ледника арены: внешний обод и второй ряд, без жаровен. */
function glacierLayers(sim: Sim, b: BossFight): number[][] {
  const w = sim.world.w;
  const st = stateOf(sim);
  const keep = new Set<number>();
  for (const o of st.braziers)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) keep.add(idx(sim, o.x + dx, o.y + dy));
  const open = (i: number) => b.cells.has(i) && sim.tiles[i] === T_FLOOR;
  const rim = (i: number, inner: Set<number> | null) =>
    [1, -1, w, -w].some((d) => (inner ? inner.has(i + d) : !open(i + d)));
  const l1: number[] = [];
  for (const i of b.cells) if (open(i) && !keep.has(i) && rim(i, null)) l1.push(i);
  const s1 = new Set(l1);
  const l2: number[] = [];
  for (const i of b.cells) if (open(i) && !s1.has(i) && !keep.has(i) && rim(i, s1)) l2.push(i);
  return [l1, l2];
}

function raiseGlacier(sim: Sim, api: SimApi, cells: number[]): void {
  const s = mamOf(sim);
  const w = sim.world.w;
  for (const i of cells) {
    if (sim.tiles[i] !== T_FLOOR) continue;
    s.saved.set(i, [sim.tiles[i], sim.world.mark[i]]);
    api.setTile(sim, i % w, Math.floor(i / w), T_WALL, MK.glacier);
  }
  sim.events.push({ t: 'boss', what: 'f12_glacier' });
  sim.events.push({ t: 'shake', k: 0.45 });
}

function meltGlacier(sim: Sim, api: SimApi): void {
  const s = mamOf(sim);
  const w = sim.world.w;
  for (const [i, [t, mk]] of s.saved) api.setTile(sim, i % w, Math.floor(i / w), t, mk);
  s.saved.clear();
  s.layer = 0;
  s.layers = [];
}

// анимации 12 — только рисунок: комья снега из-под ног (набег, рытьё), не чаще `every`.
type KickFn = (sim: Sim, api: SimApi, m: Mob, dt: number, every: number, r: number) => void; // анимации 12 — только рисунок
const vKick: KickFn = function (sim, api, m, dt, every, r) /* анимации 12 — только рисунок */ {
  m.data.vKick = (m.data.vKick ?? 0) + dt; // анимации 12 — только рисунок
  if (m.data.vKick < every) return; // анимации 12 — только рисунок
  m.data.vKick = 0; // анимации 12 — только рисунок
  fx(sim, api, { x: m.x, y: m.y, r, life: 0.6, art: 'f12_kick', dur: m.face } as ZoneIn); // анимации 12 — только рисунок
}; // анимации 12 — только рисунок

/** Ход танком: разворот с ограничением, скорость — по косинусу. */
function tankStep(m: Mob, dt: number, tx: number, ty: number, v: number): void {
  const want = Math.atan2(ty - m.y, tx - m.x);
  const d = angDiff(want, m.face);
  const turn = MAMMOTH.turn * dt;
  const rot = clamp(d, -turn, turn);
  m.face += rot;
  const c = Math.max(0, Math.cos(d));
  const sp = v * c * c;
  m.vx = Math.cos(m.face) * sp;
  m.vy = Math.sin(m.face) * sp;
  // Шаг ног: путь плюс переступ на развороте (поворот на месте тоже шагает).
  m.data.walk = (m.data.walk ?? 0) + sp * dt + Math.abs(rot) * 1.6;
  m.data.turn = clamp(d, -1, 1);
}

/** Ближайшая горящая жаровня арены. */
function litBrazierNear(sim: Sim, m: Mob, api: SimApi): WorldObj | null {
  const st = stateOf(sim);
  let best: WorldObj | null = null;
  let bd = 1e9;
  for (const o of st.braziers) {
    if (!st.lit.has(o.id) || !api.inArena(sim, o.x + 0.5, o.y + 0.5)) continue;
    const d = hypot(o.x + 0.5 - m.x, o.y + 0.5 - m.y);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** Валы вьюги: линии поперёк арены с проёмом, одна за другой к герою. */
function snowWall(sim: Sim, api: SimApi, m: Mob, k: number): void {
  const h = sim.hero;
  const top = topOf(sim, F12_SHRINE);
  const ar = F12_GEO.arena;
  const x0 = ar.x - ar.rx - 0.5;
  const x1 = ar.x + ar.rx + 0.5;
  // Валы идут от мамонта к герою по рядам.
  const dir = Math.sign(h.y - m.y) || 1;
  const y = clamp(m.y + dir * (2.2 + k * 2.6), top + ar.y - ar.ry, top + ar.y + ar.ry);
  const gap = clamp(h.x + (sim.rng() - 0.5) * 6, x0 + 2.5, x1 - 2.5);
  const gw = 1.4;
  const warn = 1.15;
  const base = { shape: 'line' as const, y, w: 1.1, ang: 0, warn, dmg: m.dmg * 0.8, knock: 6 };
  const segs: [number, number][] = [
    [x0, gap - gw],
    [gap + gw, x1],
  ];
  for (const [a, bx] of segs)
    if (bx - a > 0.5)
      api.strike(sim, {
        ...base,
        x: a,
        r: bx - a,
        status: 'chill',
        dur: 1.6,
        art: 'f12_snowwall',
        from: m.id,
      });
}

function shamanStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const ar = F12_GEO.arena;
  const cx = ar.x;
  const cy = topOf(sim, F12_SHRINE) + ar.y;
  m.tele = null;
  m.danger = 0;
  m.data.vNoTele = 1;
  switch (m.mode) {
    case 'f12s_jump': {
      // Спрыгнула со спины мамонта и взмыла.
      m.data.hide = 1;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.9) api.setMode(m, 'f12s_high');
      return;
    }
    case 'f12s_high': {
      // Высоко под сводом, кругами: недосягаема.
      m.data.hide = 1;
      const a = sim.time * 0.55 + m.id;
      const tx = cx + Math.cos(a) * (ar.rx - 3);
      const ty = cy + Math.sin(a) * (ar.ry - 2);
      api.steer(sim, m, tx - m.x, ty - m.y, m.speed * 1.4, dt);
      m.face = Math.atan2(m.vy, m.vx);
      if (m.t > 0.6 && m.cd <= 0 && !heroDown(sim)) {
        const p = spotNear(
          sim,
          api,
          h.x,
          h.y,
          3.5,
          5,
          (px, py) => -hypot(px - m.x, py - m.y),
          false,
        );
        if (p) {
          m.data.lx = p[0];
          m.data.ly = p[1];
          api.setMode(m, 'f12s_dive');
        }
      }
      return;
    }
    case 'f12s_dive': {
      // Снижается к месту колдовства.
      m.data.hide = m.t < 0.25 ? 1 : 0;
      api.steer(sim, m, m.data.lx - m.x, m.data.ly - m.y, m.speed * 2.2, dt);
      m.face = Math.atan2(c.dy, c.dx);
      if (m.t > 0.45) api.setMode(m, 'f12s_cast');
      return;
    }
    case 'f12s_cast': {
      // Руки вверх: два занавеса сияния крест-накрест на героя.
      m.data.hide = 0;
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = Math.atan2(c.dy, c.dx);
      if (m.t < dt * 1.5) {
        const a = sim.rng() * Math.PI;
        for (const ang of [a, a + Math.PI / 2]) {
          const L = 15;
          api.strike(sim, {
            shape: 'line',
            x: h.x - Math.cos(ang) * (L / 2),
            y: h.y - Math.sin(ang) * (L / 2),
            r: L,
            w: 1.3,
            ang,
            warn: 1.1,
            dmg: m.dmg,
            knock: 3,
            status: 'chill',
            dur: 1.8,
            art: 'f12_curtain',
            from: m.id,
            above: true,
          });
        }
        sim.events.push({ t: 'boss', what: 'f12_aurora' });
      }
      if (m.t >= 1.1) api.setMode(m, 'f12s_low');
      return;
    }
    case 'f12s_low':
      // Устала после заклинания: низко, бей.
      m.data.hide = 0;
      m.vx *= 0.85;
      m.vy *= 0.85;
      if (m.t > 1.05) api.setMode(m, 'f12s_rise');
      return;
    case 'f12s_rise':
      m.data.hide = m.t > 0.3 ? 1 : 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.45) {
        m.cd = 0.4;
        api.setMode(m, 'f12s_high');
      }
      return;
    default:
      api.setMode(m, 'f12s_high');
  }
}

registerBrain('f12_shaman', {
  step(sim, m, dt, c, api) {
    shamanStep(sim, m, dt, c, api);
    m.data.ghost = (m.data.hide ?? 0) > 0 ? 1 : 0;
  },
  onHit(_sim, m) {
    return m.mode === 'f12s_low' ? 1.4 : 1;
  },
  onDeath(sim, m, _mode, api) {
    const boss = f12Mammoth(sim);
    fx(sim, api, { x: m.x, y: m.y, r: 2.2, life: 1.6, art: 'f12_auroraburst', above: true });
    if (boss && boss.mode !== 'dying') {
      api.setMode(boss, 'f12b_stunned');
      boss.data.stunT = 3;
      boss.tele = null;
    }
    sim.events.push({ t: 'flash', color: '#7affd8', k: 0.6 });
    sim.events.push({
      t: 'boss',
      what: 'f12_shaman_down',
      text: 'ШАМАНКА ПАЛА',
      sub: 'мамонт оглушён — бей',
    });
  },
});

function mammothStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const b = sim.boss;
  const s = mamOf(sim);
  m.data.vNoTele = 1;
  m.tele = null;
  m.danger = 0;
  const phase = b?.phase ?? 0;
  s.chargeCd -= dt;
  s.stompCd -= dt;
  s.drumCd -= dt;
  s.spikesCd -= dt;
  s.douseCd -= dt;
  m.data.phase = phase;
  m.data.rider = s.shaman || phase >= 3 ? 0 : 1;
  if (heroDown(sim)) {
    m.vx *= 0.8;
    m.vy *= 0.8;
    return;
  }
  const T = MAMMOTH;
  switch (m.mode) {
    case 'roar':
      // Вход: камера на мамонта, рёв, шаманка бьёт в бубен.
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      if (m.t >= T.intro) api.setMode(m, 'chase');
      return;
    case 'f12b_rear':
      // Смена фазы: встаёт на дыбы, кольцо снега отталкивает.
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t >= 0.9 && !m.data.reared) {
        m.data.reared = 1;
        fx(sim, api, { x: m.x, y: m.y, r: 3.6, life: 0.9, art: 'f12_stompring' });
        if (c.dist < 3.6 + h.r && canHurt(sim)) {
          const a = Math.atan2(h.y - m.y, h.x - m.x);
          h.vx += Math.cos(a) * 9;
          h.vy += Math.sin(a) * 9;
        }
        sim.events.push({ t: 'shake', k: 0.5 });
      }
      if (m.t >= T.rear) {
        m.data.reared = 0;
        api.setMode(m, 'chase');
      }
      return;
    case 'chase': {
      // Выбор приёма.
      const ahead = Math.abs(angDiff(Math.atan2(c.dy, c.dx), m.face));
      const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
      if (phase >= 2 && s.douseCd <= 0) {
        const o = litBrazierNear(sim, m, api);
        if (o) {
          m.data.bx = o.x + 0.5;
          m.data.by = o.y + 0.5;
          s.douseCd = T.cd.douse;
          api.setMode(m, 'f12b_douse');
          return;
        }
      }
      if (phase === 1 && s.drumCd <= 0 && m.data.rider) {
        s.drumCd = T.cd.drum;
        api.setMode(m, 'f12b_drum');
        return;
      }
      if (phase >= 2 && s.spikesCd <= 0 && c.dist < 9 && see && ahead < 0.9) {
        s.spikesCd = T.cd.spikes;
        m.dir = Math.atan2(c.dy, c.dx);
        api.setMode(m, 'f12b_spikes');
        return;
      }
      if (c.dist < m.r + h.r + 1.6 && ahead < 0.75 && m.cd <= 0) {
        api.setMode(m, 'f12b_tusk');
        return;
      }
      if (c.dist < m.r + h.r + 1.6 && ahead >= 0.75 && s.stompCd <= 0) {
        s.stompCd = T.cd.stomp;
        api.setMode(m, 'f12b_stomp');
        return;
      }
      if (c.dist > 5 && see && s.chargeCd <= 0) {
        s.chargeCd = phase >= 3 ? T.cd.charge[1] : T.cd.charge[0];
        api.setMode(m, 'f12b_paw');
        return;
      }
      tankStep(m, dt, h.x, h.y, m.speed * (phase >= 3 ? 1.15 : 1));
      return;
    }
    case 'f12b_tusk': {
      // Бивни снизу вверх: замах головой — удар конусом — проводка.
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < T.tusk.hit * 0.55) {
        const d = angDiff(Math.atan2(h.y - m.y, h.x - m.x), m.face);
        m.face += clamp(d, -T.turn * dt, T.turn * dt);
      }
      if (m.t > T.tusk.hit - 0.25 && m.t < T.tusk.hit) m.danger = T.tusk.r;
      if (m.t >= T.tusk.hit && !m.data.hit) {
        m.data.hit = 1;
        if (inCone(sim, m.x, m.y, m.face, T.tusk.r, T.tusk.arc)) hit(sim, api, m, m.dmg, 9);
        sim.events.push({ t: 'shake', k: 0.25 });
        const vTusk = { x: m.x, y: m.y, r: T.tusk.r, life: 0.5, art: 'f12_tuskhit', dur: m.face }; // анимации 12 — только рисунок
        fx(sim, api, vTusk); // анимации 12 — только рисунок
        sim.events.push({ t: 'boss', what: 'f12_tusk' }); // звук удара бивнями
      }
      if (m.t >= T.tusk.end) {
        m.data.hit = 0;
        m.cd = 0.7 + sim.rng() * 0.5;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f12b_stomp': {
      // Встаёт на дыбы — передние ноги в лёд: круг и сосульки со свода.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t > T.stomp.hit - 0.25 && m.t < T.stomp.hit) m.danger = T.stomp.r;
      if (m.t >= T.stomp.hit && !m.data.hit) {
        m.data.hit = 1;
        if (c.dist < T.stomp.r + h.r) hit(sim, api, m, m.dmg * 0.9, 8);
        fx(sim, api, { x: m.x, y: m.y, r: T.stomp.r, life: 0.9, art: 'f12_stompring' });
        sim.events.push({ t: 'shake', k: 0.5 });
        sim.events.push({ t: 'boss', what: 'f12_stomp' });
        const n = 3 + phase;
        for (let k = 0; k < n; k++) {
          const p = spotNear(sim, api, h.x, h.y, 0.5, 5, () => sim.rng(), false);
          if (!p) continue;
          // Сосулька летит со свода — только рисунок.
          fx(sim, api, {
            x: p[0],
            y: p[1],
            r: 0.95,
            life: 0.95 + k * 0.18,
            art: 'f12_icdrop',
            above: true,
          });
          api.strike(sim, {
            shape: 'circle',
            x: p[0],
            y: p[1],
            r: 0.95,
            warn: 0.95 + k * 0.18,
            dmg: m.dmg * 0.7,
            knock: 2,
            status: 'chill',
            dur: 1.2,
            art: 'f12_iciclefall',
            from: m.id,
          });
        }
      }
      if (m.t >= T.stomp.end) {
        m.data.hit = 0;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f12b_paw': {
      // Роет копытом: разворот к герою, линия набега.
      m.vx *= 0.6;
      m.vy *= 0.6;
      const d = angDiff(Math.atan2(h.y - m.y, h.x - m.x), m.face);
      m.face += clamp(d, -T.turn * 1.3 * dt, T.turn * 1.3 * dt);
      m.dir = m.face;
      const len = Math.min(14, clearDist(sim, api, m.x, m.y, m.face, 14));
      m.data.len = len;
      m.data.k = clamp(m.t / T.paw, 0, 1);
      vKick(sim, api, m, dt, 0.25, 0.6); // анимации 12 — только рисунок
      if (m.t > T.paw - 0.25) m.danger = 2;
      if (m.t >= T.paw) {
        m.bounce = true;
        m.data.hit = 0;
        m.data.v = 2;
        api.setMode(m, 'f12b_charge');
        sim.events.push({ t: 'boss', what: 'f12_charge' });
      }
      return;
    }
    case 'f12b_charge': {
      const d = angDiff(Math.atan2(h.y - m.y, h.x - m.x), m.face);
      m.face += clamp(d, -T.charge.steer * dt, T.charge.steer * dt);
      m.data.v = Math.min(T.charge.v, (m.data.v ?? 0) + T.charge.acc * dt);
      m.vx = Math.cos(m.face) * m.data.v;
      m.vy = Math.sin(m.face) * m.data.v;
      m.data.walk = (m.data.walk ?? 0) + m.data.v * dt;
      m.danger = 2;
      vKick(sim, api, m, dt, 0.1, 1); // анимации 12 — только рисунок
      if (!m.data.hit && c.dist < m.r + h.r + 0.3) {
        if (hit(sim, api, m, m.dmg * 1.3, 12)) {
          m.data.hit = 1;
          sim.events.push({ t: 'shake', k: 0.4 });
          fx(sim, api, { x: h.x, y: h.y, r: 1, life: 0.5, art: 'f12_ram', dur: m.face } as ZoneIn); // анимации 12 — только рисунок
        }
      }
      if (m.t >= T.charge.max) {
        m.bounce = false;
        api.setMode(m, 'f12b_skid');
        const skid = ((m.data.v ?? 0) * T.charge.skid) / 2; // анимации 12 — только рисунок
        const vSkid = { x: m.x, y: m.y, r: skid, life: 2.2, art: 'f12_skid', dur: m.face }; // анимации 12 — только рисунок
        fx(sim, api, vSkid); // анимации 12 — только рисунок
        sim.events.push({ t: 'boss', what: 'f12_skid' }); // звук юза
      }
      return;
    }
    case 'f12b_skid': {
      // Юзом по льду арены — тормозит.
      const v = (m.data.v ?? 0) * Math.max(0, 1 - m.t / T.charge.skid);
      m.vx = Math.cos(m.face) * v;
      m.vy = Math.sin(m.face) * v;
      if (m.t >= T.charge.skid) {
        m.cd = 0.5;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f12b_stunned': {
      // В стене: бивень треснул и светится.
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.bounce = false;
      const dur = m.data.stunT || T.stun;
      if (m.t >= dur) {
        m.data.stunT = 0;
        api.setMode(m, 'f12b_getup');
      }
      return;
    }
    case 'f12b_getup':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t >= 0.6) api.setMode(m, 'chase');
      return;
    case 'f12b_drum': {
      // Шаманка бьёт в бубен — валы вьюги идут к герою.
      m.vx *= 0.6;
      m.vy *= 0.6;
      const beat = Math.floor(m.t / T.drum.beat);
      if (beat > (m.data.beat ?? -1)) {
        m.data.beat = beat;
        if (beat >= 1 && beat <= T.drum.walls) {
          snowWall(sim, api, m, beat - 1);
          sim.events.push({ t: 'boss', what: 'f12_drum' });
        }
      }
      if (m.t >= T.drum.end) {
        m.data.beat = -1;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f12b_spikes': {
      // Хобот вверх — удар в лёд: шипы веером к герою.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < T.spikes.hit * 0.5) {
        const d = angDiff(Math.atan2(h.y - m.y, h.x - m.x), m.face);
        m.face += clamp(d, -T.turn * dt, T.turn * dt);
      }
      if (m.t >= T.spikes.hit && !m.data.hit) {
        m.data.hit = 1;
        for (const off of [-0.38, 0, 0.38]) {
          const ang = m.face + off;
          const x = m.x + Math.cos(ang) * (m.r + 0.4);
          const y = m.y + Math.sin(ang) * (m.r + 0.4);
          const len = Math.min(T.spikes.len, clearDist(sim, api, x, y, ang, T.spikes.len));
          api.strike(sim, {
            shape: 'line',
            x,
            y,
            r: len,
            w: 0.9,
            ang,
            warn: T.spikes.warn,
            dmg: m.dmg * 0.85,
            knock: 4,
            status: 'chill',
            dur: 1.4,
            art: 'f12_spikes',
            from: m.id,
          });
        }
        sim.events.push({ t: 'shake', k: 0.3 });
        fx(sim, api, { x: m.x, y: m.y, r: 1.5, life: 0.7, art: 'f12_slam' }); // анимации 12 — только рисунок
        sim.events.push({ t: 'boss', what: 'f12_spike' }); // звук шипов
      }
      if (m.t >= T.spikes.end) {
        m.data.hit = 0;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f12b_douse': {
      // Идёт к горящей жаровне — задуть её.
      const tx = m.data.bx;
      const ty = m.data.by;
      const st = stateOf(sim);
      const o = st.braziers.find((x) => x.x + 0.5 === tx && x.y + 0.5 === ty);
      if (!o || !st.lit.has(o.id) || m.t > 6) {
        api.setMode(m, 'chase');
        return;
      }
      if (hypot(tx - m.x, ty - m.y) < m.r + 1.4) {
        m.face = Math.atan2(ty - m.y, tx - m.x);
        api.setMode(m, 'f12b_blow');
        return;
      }
      // По пути не забывает про героя рядом.
      if (c.dist < m.r + h.r + 1.4 && m.cd <= 0) {
        api.setMode(m, 'f12b_tusk');
        return;
      }
      tankStep(m, dt, tx, ty, m.speed * 1.1);
      return;
    }
    case 'f12b_blow': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t >= T.blow.hit && !m.data.hit) {
        m.data.hit = 1;
        const st = stateOf(sim);
        const o = st.braziers.find((x) => x.x + 0.5 === m.data.bx && x.y + 0.5 === m.data.by);
        if (o) douseBrazier(sim, st, api, o);
        fx(sim, api, { x: m.data.bx, y: m.data.by, r: 1.8, life: 1, art: 'f12_frostburst' });
      }
      if (m.t >= T.blow.end) {
        m.data.hit = 0;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'f12b_drop':
      // Сияние: шаманка спрыгивает со спины.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t >= 0.7 && !s.shaman) {
        const sh = api.spawnMob(sim, 'f12_shaman', m.x, m.y - 0.6, { mode: 'f12s_jump' });
        sh.data.vNoTele = 1;
        sh.data.hide = 1;
        sh.cd = 1.2;
        s.shaman = sh.id;
        fx(sim, api, { x: m.x, y: m.y, r: 2.5, life: 1.2, art: 'f12_auroraburst', above: true });
        sim.events.push({ t: 'boss', what: 'f12_drop' }); // звук взлёта шаманки
      }
      if (m.t >= 1.2) api.setMode(m, 'chase');
      return;
    default:
      api.setMode(m, 'chase');
  }
}

registerBrain('f12boss', {
  raw: true,
  step: mammothStep,
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'f12b_charge') return;
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    m.data.stunT = MAMMOTH.stun;
    api.setMode(m, 'f12b_stunned');
    fx(sim, api, {
      x: m.x + Math.cos(m.face) * m.r,
      y: m.y + Math.sin(m.face) * m.r,
      r: 2.4,
      life: 1.2,
      art: 'f12_wallhit',
    });
    sim.events.push({ t: 'shake', k: 0.8 });
    sim.events.push({ t: 'flash', color: '#d6f2ff', k: 0.35 }); // анимации 12 — только рисунок
    const vw = { x: m.x + Math.cos(m.face) * m.r, y: m.y + Math.sin(m.face) * m.r }; // анимации 12 — только рисунок
    fx(sim, api, { ...vw, r: 2.4, life: 1.2, art: 'f12_wallburst', above: true }); // анимации 12 — только рисунок
    sim.events.push({
      t: 'boss',
      what: 'f12_wall_stun',
      text: 'БИВЕНЬ ТРЕСНУЛ',
      sub: 'оглушён — бей по трещине',
    });
  },
  onHit(_sim, m) {
    if (m.mode === 'f12b_stunned') return 2;
    if (m.mode === 'f12b_getup' || m.mode === 'f12b_skid') return 1.3;
    if (m.mode === 'roar' || m.mode === 'f12b_rear') return 0.5;
    return 1;
  },
});

const PHASES: { text: string; sub: string; color: string }[] = [
  { text: 'НАБЕГ', sub: 'не стой на линии набега — пусть врежется в стену', color: '#bfe8ff' },
  { text: 'ВЬЮГА', sub: 'бубен шаманки гонит валы снега — ищи проём', color: '#e8f4ff' },
  {
    text: 'ЛЕДНИКОВЫЙ ПЕРИОД',
    sub: 'лёд сжимает арену, мамонт гасит жаровни — держи огонь',
    color: '#7ac8ff',
  },
  { text: 'СИЯНИЕ', sub: 'шаманка в небе: бей, когда снизится колдовать', color: '#7affd8' },
];

function enterPhase(sim: Sim, b: BossFight, m: Mob, api: SimApi, p: number): void {
  b.phase = p;
  const s = mamOf(sim);
  const st = stateOf(sim);
  api.setMode(m, 'f12b_rear');
  sim.events.push({ t: 'boss', what: 'f12_rear' }); // звук рёва на дыбах
  m.tele = null;
  const ph = PHASES[p];
  sim.events.push({ t: 'flash', color: ph.color, k: 0.7 });
  sim.events.push({ t: 'boss', what: 'phase', text: ph.text, sub: ph.sub });
  fx(sim, api, {
    x: m.x,
    y: m.y,
    r: 12,
    life: 1.6,
    art: 'f12_phase',
    above: true,
    dur: p,
  } as ZoneIn);
  if (p === 1) {
    // Вьюга задувает жаровни арены.
    for (const o of st.braziers)
      if (api.inArena(sim, o.x + 0.5, o.y + 0.5)) douseBrazier(sim, st, api, o);
    s.drumCd = 2.2;
  }
  if (p === 2) {
    s.layers = glacierLayers(sim, b);
    s.layer = 0;
    s.layerT = 1.8;
    s.spikesCd = 2.5;
    s.douseCd = 5;
  }
  if (p === 3) {
    api.setMode(m, 'f12b_drop');
    s.chargeCd = Math.min(s.chargeCd, 3);
  }
}

registerBoss('f12boss', {
  start(sim, b, lead, api) {
    meltGlacier(sim, api);
    MAM.delete(sim);
    const st = stateOf(sim);
    b.phase = 0;
    lead.face = Math.PI / 2;
    lead.data.vNoTele = 1;
    lead.data.rider = 1;
    api.setMode(lead, 'roar');
    // Жаровни арены горят к началу боя: тепло есть, пока его не задуют.
    for (const o of st.braziers)
      if (api.inArena(sim, o.x + 0.5, o.y + 0.5)) lightBrazier(sim, st, api, o, false);
    api.camera(sim, lead.x, lead.y, 2.2);
    fx(sim, api, { x: lead.x, y: lead.y, r: 12, life: 2.6, art: 'f12_wake', above: true });
    sim.events.push({ t: 'shake', k: 0.35 });
    sim.events.push({
      t: 'boss',
      what: 'f12_wake_call',
      text: 'ЛЕДНИКОВЫЙ МАМОНТ',
      sub: 'боком не ходит — заходи сбоку; набег в стену оглушает',
    });
  },
  step(sim, b, dt, api) {
    const m = f12Mammoth(sim);
    if (!m || m.mode === 'dying') return;
    const s = mamOf(sim);
    const k = m.hp / m.maxHp;
    const free = m.mode === 'chase';
    if (free && b.phase < 3 && k <= MAMMOTH.notches[b.phase])
      enterPhase(sim, b, m, api, b.phase + 1);
    // Ледник растёт слоями: сперва иней по кромке, потом стена.
    if (b.phase >= 2 && s.layer < s.layers.length) {
      s.layerT -= dt;
      if (s.layerT <= 1.2 && !m.data[`warn${s.layer}`]) {
        m.data[`warn${s.layer}`] = 1;
        fx(sim, api, {
          x: m.x,
          y: m.y,
          r: 16,
          life: 1.25,
          art: 'f12_glacierwarn',
          dur: s.layer,
        } as ZoneIn);
        sim.events.push({ t: 'boss', what: 'f12_crack' });
      }
      if (s.layerT <= 0) {
        raiseGlacier(sim, api, s.layers[s.layer]);
        const vRise = { x: m.x, y: m.y, r: 16, life: 0.9, art: 'f12_glacierrise', dur: s.layer }; // анимации 12 — только рисунок
        fx(sim, api, vRise); // анимации 12 — только рисунок
        s.layer += 1;
        s.layerT = 9;
      }
    }
    if (s.shaman && !sim.mobs.some((x) => x.id === s.shaman)) s.shaman = -1;
  },
  onPartDown(sim, _b, m, api) {
    if (m.kind !== 'f12boss') return false;
    const s = mamOf(sim);
    // Шаманка улетает с сиянием: бой кончен.
    for (const x of sim.mobs)
      if (x.kind === 'f12_shaman' && x.mode !== 'dying') {
        fx(sim, api, { x: x.x, y: x.y, r: 2.4, life: 1.6, art: 'f12_auroraburst', above: true });
        api.setMode(x, 'escape');
      }
    fx(sim, api, { x: m.x, y: m.y, r: 3, life: 3, art: 'f12_mamdeath', dur: m.face } as ZoneIn);
    fx(sim, api, { x: m.x, y: m.y, r: 3, life: 3, art: 'f12_mamsoul', above: true }); // анимации 12 — только рисунок
    meltGlacier(sim, api);
    s.shaman = 0;
    sim.events.push({ t: 'shake', k: 0.9 });
    return false;
  },
  notches() {
    return MAMMOTH.notches;
  },
  reset(sim, _b, api) {
    meltGlacier(sim, api);
    sim.mobs = sim.mobs.filter((x) => x.kind !== 'f12_shaman');
    const st = stateOf(sim);
    for (const o of st.braziers)
      if (api.inArena(sim, o.x + 0.5, o.y + 0.5)) douseBrazier(sim, st, api, o);
    MAM.delete(sim);
  },
});
