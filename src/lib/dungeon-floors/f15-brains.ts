// Этаж 15 «Сердце подземелья», половина «Мир» — ИИ монстров и правила
// этажа. Глагол — ЖИВОЙ ЭТАЖ: организм дышит, бьётся и переваривает, а
// героя метит как чужака.
//
// Правила этажа (`registerFloor(15)`; район «Сердце» и арена — не наши, их
// правила не трогают):
//   • ПУЛЬС. Одно сердце на весь этаж: удар раз в 1,6 с в Горле, 1,35 — в
//     Чреве, 1,1 — в Сосудах, и чаще, когда растёт метка «чужак». На ударе
//     вены вспыхивают (свет на ходу), складки Чрева и русла Сосудов толкают
//     того, кто на них стоит (тяга героя), створки клапанов сердца
//     распахиваются;
//   • ДЫХАНИЕ Горла. Кромки Трахеи на вдохе сходятся (коридор 7 → 3),
//     сфинктеры закрываются; кто стоял в кромке — вытолкнуло и помяло
//     (мобов — давит). Кромки и клапаны — «живые стенки»: предметы, у
//     которых на вдохе появляется тело (без перерисовки карты);
//   • МЕТКА «ЧУЖАК» 0…100 — растёт от убийств, взгляда смотрителя, сигнала
//     нерва, прилипших антител; гаснет в слизи и от железы. 30 — патрули
//     антител из пор, 60 — тревога (пульс и дыхание чаще), 100 — иммунный
//     ответ: волна, после неё метка падает до 55;
//   • ЗАЛЫ-СОБЫТИЯ: «Кашель» и «Миндалины» (Горло), «Переваривание» и
//     «Выводок» (Чрево), «Тромб» и «Клапаны сердца» (Сосуды);
//   • ДЕЙСТВИЯ: железа (слизь — метка в ноль, антитела теряют след), нерв
//     (сфинктеры Горла расслаблены), вентиль (дверь Лимфоузла).
//
// Честность: всё, что бьёт, видно заранее — кромка набухает до вдоха,
// клапан сжимается с метки, кольца сока бурлят до подъёма, тромб
// набухает, конус смотрителя виден, у каждого удара монстра метка на полу.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, StrikeIn, ZoneIn } from '../dungeon-ai';
import type { Burrow, Mob, Prop, Sim, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F15_FLOW, F15_GUT, F15_HAZ, F15_MARK, F15_SPOT_LIST, F15_THROAT, F15_VEINS } from './f15';
import type { HazardSpec } from './types';

const TAU = Math.PI * 2;
const hypot = Math.hypot;
const M = F15_MARK;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: движок значениями не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_DEEP = 11;
const T_HAZARD = 12;

/** Район «Сердце» — чужой: правила «Мира» его не трогают. */
const HEART_AREA = 'f15heart';
const OUR = new Set<string>([F15_THROAT, F15_GUT, F15_VEINS]);

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};

const areaAt = (sim: Sim, y: number): string => {
  const w = sim.world;
  const yy = Math.max(0, Math.min(w.h - 1, Math.floor(y)));
  return w.rowArea[yy];
};

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
};

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

/** Попал ли удар вплотную: рывок и неуязвимость спасают. */
const canHurt = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

/** Сколько клеток до преграды по направлению. */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

/** Прямая от точки до точки идёт только по полу (без стен и глубины). */
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

/** Отдых после удара: гасит скорость, потом снова в погоню. */
function recoverStep(m: Mob, api: SimApi, T: number, next = 'chase'): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.t > T) api.setMode(m, next);
}

/** Клетка пола рядом с (x, y) на расстоянии r0…r1 (тело встаёт). */
function spotNear(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r0: number,
  r1: number,
  far?: { x: number; y: number },
): [number, number] | null {
  let best: [number, number] | null = null;
  let bs = -1e9;
  for (let i = 0; i < 20; i++) {
    const a = sim.rng() * TAU;
    const r = r0 + sim.rng() * (r1 - r0);
    const cx = Math.floor(x + Math.cos(a) * r);
    const cy = Math.floor(y + Math.sin(a) * r);
    if (api.solidTile(sim, cx, cy)) continue;
    if (
      api.solidTile(sim, cx + 1, cy) ||
      api.solidTile(sim, cx - 1, cy) ||
      api.solidTile(sim, cx, cy + 1) ||
      api.solidTile(sim, cx, cy - 1)
    )
      continue;
    const s = far ? hypot(cx + 0.5 - far.x, cy + 0.5 - far.y) : sim.rng();
    if (s > bs) {
      bs = s;
      best = [cx + 0.5, cy + 0.5];
    }
  }
  return best;
}

/**
 * Ранить моба средой (сжатие стен, сок): без взрыва и без героя. Добил —
 * удар по площади с уроном по своим (движок сам засчитает убийство).
 */
function hurtMob(sim: Sim, api: SimApi, m: Mob, dmg: number): void {
  if (m.mode === 'dying' || api.def(m.kind).boss) return;
  m.flash = 0.15;
  if (m.hp - dmg > 0) {
    m.hp -= dmg;
    return;
  }
  // Добить — ударом по своим; герой в метку не попадёт (круг крошечный).
  const h = sim.hero;
  if (hypot(h.x - m.x, h.y - m.y) < 0.2 + h.r + 0.05) {
    m.hp = Math.max(1, m.hp - dmg);
    return;
  }
  api.strike(sim, { shape: 'circle', x: m.x, y: m.y, r: 0.15, warn: 0, dmg: 0, mobDmg: 1e9, art: 'f15_crush' });
}

// ---------------------------------------------------------------------------
// Живые стенки: кромки Трахеи, сфинктеры, двери Кривизны, створки сердца,
// дверь Лимфоузла. Это предметы (`deco`) на клетке пола: открыты — тела нет
// (`r` = 0), сомкнулись — круг в полклетки держит, как стена. Карта не
// перерисовывается: вид — у рисовальщика по состоянию (`f15View`).
// ---------------------------------------------------------------------------

export type LiveKind = 'band' | 'valve' | 'door' | 'leaflet' | 'lymph';

export interface Live {
  p: Prop;
  kind: LiveKind;
  area: string;
  cx: number;
  cy: number;
  /** Сомкнута ли сейчас. */
  closed: boolean;
  /** Когда сменилось (время мира), для кадров сжатия. */
  at: number;
  /** Куда выталкивать стоящего (к середине хода). */
  dx: number;
  dy: number;
  /** Номер группы (связные клетки одного клапана). */
  group: number;
}

interface Post {
  id: number;
  kind: string;
  mob: string;
  mode: string;
  x: number;
  y: number;
  area: string;
  live: number;
  dead: boolean;
  /** Орган (стоит на месте): появляется и на глазах. */
  organ: boolean;
}

interface Box {
  name: string;
  area: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Node {
  x: number;
  y: number;
  key: string;
  area: string;
  /** Нерв рядом убит — вена погасла до конца вылазки. */
  dim: boolean;
  tint: 'red' | 'violet' | 'warm';
}

interface Saved {
  tile: number;
  mark: number;
  haz: HazardSpec | null;
}

type EvState = 'idle' | 'on' | 'rest' | 'done';

export interface F15State {
  lives: Live[];
  byObj: Map<string, Live>;
  posts: Post[];
  boxes: Record<string, Box>;
  nodes: Node[];
  /** Сердце: сколько прошло с удара и сам период. */
  beatT: number;
  period: number;
  beats: number;
  lastBeat: number;
  /** Дыхание Горла (фаза 0…1) и цикл клапанов Чрева. */
  breath: number;
  breathP: number;
  digestP: number;
  gutCycle: number;
  /** Метка «чужак». */
  alien: number;
  stage: number;
  /** До этого времени антитела не видят героя (слизь железы). */
  hidden: number;
  patrolT: number;
  alienZone: Zone | null;
  /** Сфинктеры Горла расслаблены нервом до этого времени. */
  relaxed: number;
  /** Кашель: фаза и фронт волны (ряд мира). */
  cough: { state: EvState; t: number; front: number; hit: boolean; cd: number; done: boolean };
  tonsils: { state: EvState };
  digest: { state: EvState; t: number; stage: number; paid: boolean; cells: number[][] };
  brood: { state: EvState; t: number };
  clot: { state: EvState; t: number; wave: number; cells: number[]; paid: boolean };
  valves: { state: EvState; top: boolean };
  /** Смены клеток на ходу — вернуть при сбросе. */
  saved: Map<number, Saved>;
  /** Железы: до какого времени пусты. */
  glands: Map<string, number>;
  lymphOpen: boolean;
  /** Первый раз помяло кромкой — надпись один раз; когда мяло последний. */
  squeezed: boolean;
  squeezeAt: number;
  /** Шум героя (удары, рывки): мешки набухают от него. */
  noise: number;
}

const STATE = new WeakMap<Sim, F15State>();
let postSeq = 1;

/** Ближайшая клетка пола (не стена, не глубина, не живая стенка) к точке. */
function openNear(sim: Sim, x: number, y: number, R = 4): [number, number] | null {
  const w = sim.world;
  const ok = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) return false;
    const t = sim.tiles[cy * w.w + cx];
    if (t !== T_FLOOR && t !== T_HAZARD) return false;
    const k = w.mark[cy * w.w + cx];
    return k !== M.band && k !== M.valve && k !== M.door && k !== M.leaflet && k !== M.lymphDoor;
  };
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  if (ok(fx, fy)) return [x, y];
  let best: [number, number] | null = null;
  let bd = 1e9;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (!ok(fx + dx, fy + dy)) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = [fx + dx + 0.5, fy + dy + 0.5];
      }
    }
  return best;
}

/**
 * Страховка: монстр, которого вдавило в стену (сомкнувшейся кромкой,
 * толкотнёй у живой стенки, рождением у стены), выходит на ближний пол.
 */
function unstick(sim: Sim, api: SimApi): void {
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge' || m.t < 0 || (m.data.ghost ?? 0) > 0) continue;
    const def = api.def(m.kind);
    if (def.boss || def.fly || def.speed === 0) continue;
    const t = sim.tiles[Math.floor(m.y) * sim.world.w + Math.floor(m.x)];
    if (t !== T_WALL && t !== T_DEEP) continue;
    const p = openNear(sim, m.x, m.y, 3);
    if (!p) continue;
    m.x = p[0];
    m.y = p[1];
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
  }
}

/** Состояние этажа — для рисовальщика (`paintSim()`), тестов и стенда. */
export const f15View = (sim: Sim | null): F15State | null => (sim ? (STATE.get(sim) ?? null) : null);

/** Метка «чужак» 0…100 — для агента «Сердце» и тестов. */
export const f15Alien = (sim: Sim): number => STATE.get(sim)?.alien ?? 0;

// ---------------------------------------------------------------------------
// Разбор мира: живые стенки, посты, рамки, узлы вен.
// ---------------------------------------------------------------------------

const LIVE_REF: Record<string, LiveKind> = {
  f15_band: 'band',
  f15_valve: 'valve',
  f15_door: 'door',
  f15_leaflet: 'leaflet',
  f15_lymphdoor: 'lymph',
};

const POST_MOB: Record<string, [string, string, boolean]> = {
  nerve: ['f15_nerve', 'f15_idle', true],
  sac: ['f15_sac', 'f15_idle', true],
  tonsil: ['f15_tonsil', 'f15_idle', true],
  watcher: ['f15_watcher', 'f15_scan', true],
  matron: ['f15_matron', 'f15_idle', true],
  knight: ['f15_mknight', 'f15_guard', false],
  macro: ['f15_macro', 'chase', false],
};

function scan(sim: Sim): F15State {
  const w = sim.world;
  const W = w.w;
  const bandTop = (id: string) => w.bands.find((b) => b.def.id === id)?.top ?? 0;
  const lives: Live[] = [];
  const byObj = new Map<string, Live>();
  for (const p of sim.props) {
    const kind = p.kind === 'deco' ? LIVE_REF[p.obj.ref ?? ''] : undefined;
    if (!kind) continue;
    const x = p.obj.x;
    const y = p.obj.y;
    const open = (dx: number, dy: number) => {
      const t = tileAt(sim, x + dx, y + dy);
      return t === T_FLOOR || t === T_HAZARD;
    };
    const liveAt = (dx: number, dy: number) => {
      const k = markAt(sim, x + dx, y + dy);
      return k === M.band || k === M.valve || k === M.door || k === M.leaflet;
    };
    let dx = 0;
    let dy = 0;
    if (kind === 'band') {
      // К середине хода: в сторону, где нет стены.
      // Середина хода — там, где вена или кольцо: к ним и толкает.
      const mid = (d: number) => {
        for (let i = 1; i <= 5; i++) {
          const k = markAt(sim, x + d * i, y);
          if (k === M.vein || k === M.ring || k === M.node) return i;
          if (!open(d * i, 0)) return 99;
        }
        return 99;
      };
      const ml = mid(-1);
      const mr = mid(1);
      const wl = !open(-1, 0);
      const wr = !open(1, 0);
      if (ml < 99 || mr < 99) dx = mr <= ml ? 1 : -1;
      else if (wl && !wr) dx = 1;
      else if (wr && !wl) dx = -1;
      else dx = liveAt(1, 0) && !liveAt(-1, 0) ? 1 : liveAt(-1, 0) && !liveAt(1, 0) ? -1 : 1;
    }
    const l: Live = {
      p,
      kind,
      area: w.rowArea[y],
      cx: x + 0.5,
      cy: y + 0.5,
      closed: false,
      at: -9,
      dx,
      dy,
      group: 0,
    };
    // Дверь Лимфоузла закрыта с начала: откроет вентиль.
    if (kind === 'lymph') {
      l.closed = true;
      p.r = 0.52;
    } else p.r = 0;
    lives.push(l);
    byObj.set(p.obj.id, l);
  }
  // Группы: связные клетки одного вида.
  let g = 0;
  const byCell = new Map<number, Live>();
  for (const l of lives) byCell.set(Math.floor(l.cy) * W + Math.floor(l.cx), l);
  for (const l of lives) {
    if (l.group) continue;
    g += 1;
    const q = [l];
    l.group = g;
    while (q.length) {
      const c = q.pop()!;
      const i = Math.floor(c.cy) * W + Math.floor(c.cx);
      for (const d of [1, -1, W, -W]) {
        const n = byCell.get(i + d);
        if (n && !n.group && n.kind === c.kind) {
          n.group = g;
          q.push(n);
        }
      }
    }
  }
  const posts: Post[] = [];
  const boxes: Record<string, Box> = {};
  for (const s of F15_SPOT_LIST) {
    const top = bandTop(s.area);
    if (s.kind === 'box') {
      boxes[s.name!] = { name: s.name!, area: s.area, x0: s.x, y0: top + s.y, x1: s.x1!, y1: top + s.y1! };
      continue;
    }
    const pm = s.kind === 'group' ? null : POST_MOB[s.kind];
    // Пост на карте мог уехать в стену или в русло — на ближний пол.
    const snap = openNear(sim, s.x + 0.5, top + s.y + 0.5, 5) ?? [s.x + 0.5, top + s.y + 0.5];
    posts.push({
      id: postSeq++,
      kind: s.kind,
      mob: pm ? pm[0] : '',
      mode: pm ? pm[1] : 'sleep',
      x: snap[0],
      y: snap[1],
      area: s.area,
      live: 0,
      dead: false,
      organ: pm ? pm[2] : false,
    });
  }
  const nodes: Node[] = [];
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < W; x++)
      if (w.mark[y * W + x] === M.node) {
        const area = w.rowArea[y];
        nodes.push({
          x: x + 0.5,
          y: y + 0.5,
          key: `f15n${x}:${y}`,
          area,
          dim: false,
          tint: area === F15_THROAT ? 'violet' : 'red',
        });
      }
  const cells = (mk: number) => {
    const out: number[] = [];
    const box = boxes.digest;
    if (!box) return out;
    for (let y = box.y0; y <= box.y1; y++)
      for (let x = box.x0; x <= box.x1; x++) if (w.mark[y * W + x] === mk) out.push(y * W + x);
    return out;
  };
  const clotCells: number[] = [];
  const ab = boxes.aorta;
  if (ab)
    for (let y = ab.y0; y <= ab.y1; y++)
      for (let x = ab.x0; x <= ab.x1; x++) if (w.mark[y * W + x] === M.clot) clotCells.push(y * W + x);
  return {
    lives,
    byObj,
    posts,
    boxes,
    nodes,
    beatT: 0,
    period: 1.6,
    beats: 0,
    lastBeat: -9,
    breath: 0.1,
    breathP: 4.6,
    digestP: 0,
    gutCycle: 3.8,
    alien: 0,
    stage: 0,
    hidden: -9,
    patrolT: 6,
    alienZone: null,
    relaxed: -9,
    cough: { state: 'idle', t: 0, front: -1, hit: false, cd: 0, done: false },
    tonsils: { state: 'idle' },
    digest: { state: 'idle', t: 0, stage: 0, paid: false, cells: [cells(M.ring1), cells(M.ring2), cells(M.ring3)] },
    brood: { state: 'idle', t: 0 },
    clot: { state: 'idle', t: 0, wave: 0, cells: clotCells, paid: false },
    valves: { state: 'idle', top: false },
    saved: new Map(),
    glands: new Map(),
    lymphOpen: false,
    squeezed: false,
    squeezeAt: -9,
    noise: 0,
  };
}

function stateOf(sim: Sim): F15State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

const inBox = (b: Box | undefined, x: number, y: number, pad = 0) =>
  !!b && x >= b.x0 - pad && x < b.x1 + 1 + pad && y >= b.y0 - pad && y < b.y1 + 1 + pad;

function saveTile(sim: Sim, st: F15State, api: SimApi, i: number, tile: number, mark: number, haz?: HazardSpec | null): void {
  const w = sim.world;
  if (!st.saved.has(i)) {
    const k = w.haz[i];
    st.saved.set(i, { tile: sim.tiles[i], mark: w.mark[i], haz: k ? w.hazards[k - 1] : null });
  }
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark, haz);
}

function restoreTile(sim: Sim, st: F15State, api: SimApi, i: number): void {
  const v = st.saved.get(i);
  if (!v) return;
  const w = sim.world;
  api.setTile(sim, i % w.w, Math.floor(i / w.w), v.tile, v.mark, v.haz);
  st.saved.delete(i);
}

/** Поставить зону и вернуть её (чтобы двигать и менять на ходу). */
function addZone(sim: Sim, api: SimApi, z: ZoneIn & Record<string, unknown>): Zone {
  api.zone(sim, z);
  return sim.zones[sim.zones.length - 1];
}

const say = (sim: Sim, what: string, text?: string, sub?: string) =>
  sim.events.push({ t: 'boss', what, text, sub });

/** Прибавить к метке «чужак» (из ИИ монстров). */
export function addAlien(sim: Sim, n: number): void {
  const st = STATE.get(sim);
  if (!st || !OUR.has(sim.area) || sim.boss?.state === 'fight') return;
  st.alien = Math.max(0, Math.min(100, st.alien + n));
}

/** Слизь железы: антитела не видят героя. */
export const f15Hidden = (sim: Sim): boolean => (STATE.get(sim)?.hidden ?? -9) > sim.time;

// ---------------------------------------------------------------------------
// Пульс и дыхание.
// ---------------------------------------------------------------------------

/** Сердце: период удара по районам; тревога («чужак») ускоряет до −30%. */
export const PULSE = { throat: 1.6, gut: 1.35, veins: 1.1, alarm: 0.3 };
/**
 * Дыхание Горла: период 4,6 с; кромки смыкаются на вдохе (фаза ≥ 0,5),
 * набухают с 0,38 — это предупреждение; сфинктеры открыты 0,08…0,44.
 */
export const BREATH = { period: 4.6, warnAt: 0.36, closeAt: 0.5, valveOpen: 0.08, valveClose: 0.44 };
/** Клапаны Чрева (Кардия, Привратник): цикл 3,8 с, открыты 55%. */
export const GUT_VALVE = { period: 3.8, open: 0.55 };
/** Толчок течения на удар сердца, клеток; створки сердца открыты долю периода. */
export const SURGE = { veins: 1.7, gut: 1.15, speed: 9 };
export const LEAFLET = { open: 0.52 };

/** Течение клетки мира: складки, русла, кровь Аорты. */
function flowAt(sim: Sim, x: number, y: number): [number, number] | undefined {
  const k = markAt(sim, Math.floor(x), Math.floor(y));
  if (k === M.blood && areaAt(sim, y) === F15_VEINS) return [0, -1];
  return F15_FLOW[k];
}

function beat(sim: Sim, st: F15State, api: SimApi): void {
  st.beats += 1;
  st.lastBeat = sim.time;
  const h = sim.hero;
  const here = sim.area;
  if (!OUR.has(here)) return;
  // Толчок: складки Чрева и русла Сосудов несут того, кто на них стоит.
  if (!heroDown(sim) && !h.pull && h.mode !== 'dash') {
    const f = flowAt(sim, h.x, h.y);
    if (f) {
      const L = here === F15_GUT ? SURGE.gut : SURGE.veins;
      api.pullHero(sim, h.x + f[0] * L, h.y + f[1] * L, { speed: SURGE.speed, max: L / SURGE.speed + 0.05 });
    }
  }
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
    const d = api.def(m.kind);
    if (d.boss || d.speed === 0) continue;
    const f = flowAt(sim, m.x, m.y);
    if (!f) continue;
    const k = 7 / Math.max(0.6, d.mass ?? 1);
    m.kx += f[0] * k;
    m.ky += f[1] * k;
  }
  // Звук сердца — ближе к нему и на тревоге (для агента «Звук»).
  if (here === F15_VEINS || st.alien >= 60) sim.events.push({ t: 'boss', what: 'f15_beat' });
  if (here === F15_VEINS && (st.valves.state === 'on' || st.alien >= 60))
    sim.events.push({ t: 'shake', k: 0.08 });
}

function stepPulse(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const here = OUR.has(sim.area) ? sim.area : F15_VEINS;
  const base = here === F15_THROAT ? PULSE.throat : here === F15_GUT ? PULSE.gut : PULSE.veins;
  st.period = base * (1 - (PULSE.alarm * st.alien) / 100);
  st.beatT += dt;
  if (st.beatT >= st.period) {
    st.beatT -= st.period;
    if (st.beatT > st.period) st.beatT = 0;
    beat(sim, st, api);
  }
  st.breathP = BREATH.period * (1 - (0.28 * st.alien) / 100);
  st.breath = (st.breath + dt / st.breathP) % 1;
  st.digestP = (st.digestP + dt / GUT_VALVE.period) % 1;
  // Вены вспыхивают на ударе и гаснут за четверть секунды.
  const k = Math.exp(-st.beatT / 0.22);
  const h = sim.hero;
  for (const n of st.nodes) {
    if (Math.abs(n.y - h.y) > 26) continue;
    const r = n.dim ? 0.45 : 1.2 + 1.7 * k;
    api.light(sim, n.key, { x: n.x, y: n.y, r, tint: n.tint });
  }
}

/** Горло сейчас на вдохе (кромки сомкнуты). */
function throatClosed(sim: Sim, st: F15State): boolean {
  if (st.relaxed > sim.time || st.cough.state === 'on') return false;
  return st.breath >= BREATH.closeAt;
}

function throatValveShut(sim: Sim, st: F15State): boolean {
  if (st.relaxed > sim.time || st.cough.state === 'on') return false;
  return st.breath < BREATH.valveOpen || st.breath >= BREATH.valveClose;
}

/** Что сказать, когда живая стенка впервые помяла героя. */
const SQUEEZE_TEXT: Record<LiveKind, [string, string]> = {
  band: ['СТЕНЫ СЖАЛИСЬ', 'на вдохе кромка сходится — держись середины'],
  valve: ['СФИНКТЕР СЖАЛСЯ', 'кольцо смыкается в такт — проходи, пока открыто'],
  door: ['ПРИВРАТНИК ЗАКРЫТ', 'идёт переваривание — жди у стены, пока не кончится'],
  leaflet: ['СТВОРКИ СОМКНУЛИСЬ', 'створки бьют в такт сердца — проходи сразу после удара'],
  lymph: ['ЛИМФОУЗЕЛ', 'дверь не пускает — сожми вену рядом'],
};

/** Живая стенка сомкнулась или разошлась. Сомкнулась на ком-то — вытолкнуть. */
function setLive(sim: Sim, st: F15State, api: SimApi, l: Live, closed: boolean): void {
  l.closed = closed;
  l.at = sim.time;
  l.p.r = closed ? 0.5 : 0;
  if (!closed) return;
  const h = sim.hero;
  const d = hypot(h.x - l.cx, h.y - l.cy);
  if (!heroDown(sim) && d < 0.5 + h.r) {
    let dx = l.dx;
    let dy = l.dy;
    if (l.kind === 'door') {
      const b = st.boxes.digest;
      const cx = b ? (b.x0 + b.x1 + 1) / 2 : l.cx;
      const cy = b ? (b.y0 + b.y1 + 1) / 2 : l.cy;
      const a = Math.atan2(cy - l.cy, cx - l.cx);
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else if (l.kind !== 'band') {
      dx = 0;
      dy = h.y >= l.cy ? 1 : -1;
    }
    if (!h.pull) api.pullHero(sim, l.cx + dx * 1.3, h.y + dy * 1.3 + (dy ? l.cy - h.y : 0), { speed: 11, max: 0.3 });
    if (sim.time - st.squeezeAt > 0.6) {
      st.squeezeAt = sim.time;
      api.hurtEnv(sim, 0.045);
      // Надпись — один раз на каждый вид живой стенки.
      const flag = `f15sq_${l.kind}`;
      if (!sim.floorData[flag]) {
        sim.floorData[flag] = 1;
        st.squeezed = true;
        const [t, sub] = SQUEEZE_TEXT[l.kind];
        say(sim, 'f15_squeeze_trap', t, sub);
      }
    }
  }
  // Мобов, стоящих в кромке, давит: мясо стен сильнее мяса монстров.
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.mode === 'emerge') continue;
    const def = api.def(m.kind);
    if (def.boss || def.speed === 0) continue;
    if (hypot(m.x - l.cx, m.y - l.cy) > 0.5 + m.r * 0.7) continue;
    m.kx += (l.dx || 0) * 6;
    m.ky += (l.dy || (m.y >= l.cy ? 1 : -1)) * (l.dx ? 0 : 6);
    if ((m.data.crushAt ?? -9) < sim.time - 0.8) {
      m.data.crushAt = sim.time;
      hurtMob(sim, api, m, m.maxHp * 0.22);
    }
  }
}

function stepLives(sim: Sim, st: F15State, api: SimApi): void {
  const h = sim.hero;
  const tClosed = throatClosed(sim, st);
  const tShut = throatValveShut(sim, st);
  const gShut = st.digestP >= GUT_VALVE.open;
  const leafShut = !(st.beatT < LEAFLET.open * st.period);
  const doorShut = st.digest.state === 'on';
  for (const l of st.lives) {
    // Далёкие стенки не трогаем: до них ещё дойдём.
    if (Math.abs(l.cy - h.y) > 30 && !(l.kind === 'door' && l.closed !== doorShut)) continue;
    let want = l.closed;
    switch (l.kind) {
      case 'band':
        want = tClosed;
        break;
      case 'valve':
        want = l.area === F15_THROAT ? tShut : gShut;
        break;
      case 'door':
        want = doorShut;
        break;
      case 'leaflet':
        want = leafShut;
        break;
      case 'lymph':
        want = !st.lymphOpen;
        break;
    }
    if (want !== l.closed) setLive(sim, st, api, l, want);
  }
}

// ---------------------------------------------------------------------------
// Метка «чужак».
// ---------------------------------------------------------------------------

// Сведение (v2.83.1): на карте с настоящим «Сердцем» бот доходил до ворот в
// 2 из 6 прогонов — этаж душил числом. Причина — петля: убийство поднимало
// метку (1,6), метка звала волну, волну убивали. Убийство теперь весит втрое
// меньше, патрули реже (было 16/10 с) и не больше четырёх антител разом.
export const ALIEN = { passive: 0.12, kill: 0.5, killAb: 0.15, mucus: 24, patrol: [24, 16], response: 25, cap: 4 };

function stepAlien(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const ours = OUR.has(sim.area) && sim.boss?.state !== 'fight';
  // Кольцо метки у ног героя.
  if (!st.alienZone || !sim.zones.includes(st.alienZone))
    st.alienZone = addZone(sim, api, { x: h.x, y: h.y, r: 0.2, life: 1e9, art: 'f15_alien' });
  st.alienZone.x = h.x;
  st.alienZone.y = h.y;
  (st.alienZone as Zone & { k?: number; on?: number }).k = st.alien;
  (st.alienZone as Zone & { on?: number }).on = ours ? 1 : 0;
  if (!ours || heroDown(sim)) return;
  let d = ALIEN.passive * dt;
  for (const e of sim.events) {
    if (e.t === 'kill') d += e.mob === 'f15_mob' || e.mob === 'f15_larva' ? ALIEN.killAb : ALIEN.kill;
    if (e.t === 'swing') st.noise += e.heavy ? 1.4 : 0.6;
    if (e.t === 'dash') st.noise += 0.5;
    if (e.t === 'kill') st.noise += 1.2;
  }
  st.noise = Math.max(0, st.noise - dt * 1.5);
  if (markAt(sim, Math.floor(h.x), Math.floor(h.y)) === M.mucus) d -= ALIEN.mucus * dt;
  if (st.hidden > sim.time) d = Math.min(d, 0);
  st.alien = Math.max(0, Math.min(100, st.alien + d));
  const stage = st.alien >= 100 ? 3 : st.alien >= 60 ? 2 : st.alien >= 30 ? 1 : 0;
  if (stage > st.stage) {
    if (stage === 1) say(sim, 'f15_mark_call', 'ТЫ ЧУЖОЙ', 'иммунитет почуял — прячься в слизи');
    if (stage === 2) {
      say(sim, 'f15_alarm_trap', 'ТРЕВОГА', 'организм ускорился: пульс и дыхание чаще');
      sim.events.push({ t: 'flash', color: '#ff2a4a', k: 0.5 });
    }
  }
  st.stage = stage;
  if (stage >= 3) {
    immuneResponse(sim, st, api);
    st.alien = ALIEN.response;
    st.stage = 1;
  }
  // Патрули антител из пор.
  if (stage >= 1 && st.hidden < sim.time) {
    st.patrolT -= dt;
    if (st.patrolT <= 0) {
      st.patrolT = stage >= 2 ? ALIEN.patrol[1] : ALIEN.patrol[0];
      const n = sim.mobs.filter((m) => m.kind === 'f15_mob' && m.mode !== 'dying').length;
      const b = n < ALIEN.cap ? api.pickBurrow(sim, 6, 15) : null;
      if (b) {
        const k = stage >= 2 ? 2 : 1;
        for (let i = 0; i < k; i++) {
          const m = api.fromBurrow(sim, b, 'f15_mob');
          m.t = -i * 0.3;
        }
      }
    }
  }
}

/** Иммунный ответ (метка 100): волна антител и своё у каждого района. */
function immuneResponse(sim: Sim, st: F15State, api: SimApi): void {
  say(sim, 'f15_immune_trap', 'ИММУННЫЙ ОТВЕТ', 'организм бросил на чужака всё, что есть');
  sim.events.push({ t: 'flash', color: '#ff2a4a', k: 0.8 });
  sim.events.push({ t: 'shake', k: 0.4 });
  const extra = sim.area === F15_GUT ? 'f15_parasite' : sim.area === F15_VEINS ? 'f15_drone' : 'f15_mhound';
  for (let w = 0; w < 1; w++) {
    const b = api.pickBurrow(sim, 5, 14);
    if (!b) continue;
    for (let i = 0; i < 3; i++) {
      const m = api.fromBurrow(sim, b, i === 2 && w === 0 ? extra : 'f15_mob');
      m.t = -i * 0.3;
    }
  }
  // Горло кашляет, если чужак в Трахее.
  const cb = st.boxes.cough;
  if (sim.area === F15_THROAT && inBox(cb, sim.hero.x, sim.hero.y) && st.cough.state !== 'on') {
    st.cough.cd = 0;
    startCough(sim, st, api);
  }
}

// ---------------------------------------------------------------------------
// Посты: органы (нервы, мешки, миндалины, смотрители, матка) и стражи.
// ---------------------------------------------------------------------------

function postDead(sim: Sim, id: number | undefined): void {
  if (id === undefined) return;
  const p = STATE.get(sim)?.posts.find((x) => x.id === id);
  if (p) {
    p.dead = true;
    p.live = 0;
  }
}

function spawnGroup(sim: Sim, api: SimApi, p: Post): void {
  const spec = sim.world.bands.find((b) => b.def.id === p.area)?.def;
  void spec;
  const kinds =
    p.area === F15_THROAT
      ? ['f15_mhound', 'f15_mhound', 'f15_mob', 'f15_mob']
      : p.area === F15_GUT
        ? ['f15_parasite', 'f15_mhound', 'f15_mob', 'f15_mob']
        : ['f15_drone', 'f15_drone', 'f15_mknight', 'f15_mob'];
  const n = 3 + Math.floor(sim.rng() * 2);
  const lead = sim.rng() < 0.2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.3;
    let x = p.x + Math.cos(a) * 0.9;
    let y = p.y + Math.sin(a) * 0.8;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) {
      x = p.x;
      y = p.y;
    }
    const m = api.spawnMob(sim, kinds[i % kinds.length], x, y, { mode: 'sleep', elite: lead && i === 0 });
    api.collide(sim, m);
  }
}

function stepPosts(sim: Sim, st: F15State, api: SimApi): void {
  const h = sim.hero;
  const fight = sim.boss?.state === 'fight';
  for (const p of st.posts) {
    if (p.dead) continue;
    if (p.live) {
      const m = sim.mobs.find((x) => x.id === p.live);
      if (m && m.mode !== 'dying' && m.mode !== 'escape') continue;
      if (m) {
        p.dead = true;
        p.live = 0;
        continue;
      }
      // Ушёл за край (снят движком) — встанет снова, когда вернёшься.
      p.live = 0;
    }
    if (fight) continue;
    const d = hypot(p.x - h.x, p.y - h.y);
    if (p.kind === 'group') {
      if (d < 14 && !(sim.safe.some((z) => hypot(z.x - p.x, z.y - p.y) < 9))) {
        p.dead = true;
        spawnGroup(sim, api, p);
      }
      continue;
    }
    if (d > 18 || (!p.organ && d < 6)) continue;
    if (p.kind === 'tonsil' && st.tonsils.state === 'done') continue;
    if (p.kind === 'matron' && st.brood.state === 'done') continue;
    const m = api.spawnMob(sim, p.mob, p.x, p.y, { mode: p.mode });
    m.data.post = p.id;
    m.hx = p.x;
    m.hy = p.y;
    m.face = Math.PI / 2;
    p.live = m.id;
  }
}

// ---------------------------------------------------------------------------
// Зал-событие Горла: «Кашель». Трахея выталкивает чужака: вдох (кромки и
// клапан раскрыты, воздух тянет вверх), потом сверху вниз идёт волна
// выдоха и комья мокроты. Кто в Трахее — отброшен вниз и помят; в
// альвеолах (карманы по бокам) — пересидел. Рывок сквозь фронт — тоже ответ.
// ---------------------------------------------------------------------------

export const COUGH = { inhale: 1.6, speed: 19, dmg: 0.08, push: 4.5, rest: 40 };

function startCough(sim: Sim, st: F15State, api: SimApi): void {
  const b = st.boxes.cough;
  if (!b) return;
  const c = st.cough;
  c.state = 'on';
  c.t = 0;
  c.front = b.y0 - 1;
  c.hit = false;
  say(sim, 'f15_cough_trap', 'КАШЕЛЬ', 'горло выталкивает чужака — в альвеолу, в карман сбоку!');
  const dur = COUGH.inhale + (b.y1 - b.y0 + 3) / COUGH.speed + 0.2;
  addZone(sim, api, {
    x: (b.x0 + b.x1 + 1) / 2,
    y: (b.y0 + b.y1 + 1) / 2,
    r: 0.1,
    life: dur,
    art: 'f15_gust',
    x0: b.x0,
    x1: b.x1 + 1,
    y0: b.y0,
    y1: b.y1 + 1,
    inhale: COUGH.inhale,
    speed: COUGH.speed,
  });
  for (const m of sim.mobs) m.data.cough = 0;
}

function stepCough(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const b = st.boxes.cough;
  if (!b) return;
  const c = st.cough;
  const h = sim.hero;
  c.cd -= dt;
  const inCore = inBox(b, h.x, h.y);
  if (c.state !== 'on') {
    if (!inCore || c.cd > 0) return;
    const mid = (b.y0 + b.y1) / 2;
    // Первый раз — как только прошёл середину Трахеи; дальше — на тревоге.
    if ((!c.done && h.y < mid) || (c.done && st.alien >= 85)) startCough(sim, st, api);
    return;
  }
  c.t += dt;
  if (c.t < COUGH.inhale) {
    // Вдох: воздух тянет вверх — чужака чуть подсасывает.
    if (inCore && !h.pull && h.mode !== 'dash') h.vy -= 5 * dt;
    return;
  }
  const prev = c.front;
  c.front = b.y0 + (c.t - COUGH.inhale) * COUGH.speed;
  // Комья мокроты — впереди фронта, с меткой.
  const k0 = Math.floor((prev - b.y0) / 6);
  const k1 = Math.floor((c.front - b.y0) / 6);
  if (k1 > k0) {
    const y = Math.min(b.y1, c.front + 5 + sim.rng() * 3);
    const x = b.x0 + 1 + sim.rng() * (b.x1 - b.x0 - 1);
    api.strike(sim, {
      shape: 'circle',
      x,
      y,
      r: 0.8,
      warn: 0.55,
      dmg: rawShare(sim, 0.05),
      knock: 3,
      status: 'slow',
      dur: 1.5,
      art: 'f15_phlegm',
    });
  }
  // Фронт прошёл ряд героя: в Трахее — отброс вниз и удар; рывок спасает.
  const inX = h.x >= b.x0 && h.x < b.x1 + 1;
  if (!c.hit && inX && h.y >= prev - 0.2 && h.y < c.front + 0.2 && h.y <= b.y1 + 1) {
    c.hit = true;
    if (canHurt(sim)) {
      api.hurtHero(sim, rawShare(sim, COUGH.dmg), h.x, h.y - 1.5, 0);
      api.pullHero(sim, h.x, Math.min(b.y1 + 0.5, h.y + COUGH.push), { speed: 15, max: 0.45 });
    }
  }
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.data.cough || api.def(m.kind).speed === 0) continue;
    if (m.x < b.x0 || m.x >= b.x1 + 1 || m.y < prev - 0.2 || m.y >= c.front + 0.2) continue;
    m.data.cough = 1;
    m.ky += 11 / Math.max(0.6, api.def(m.kind).mass ?? 1);
    hurtMob(sim, api, m, m.maxHp * 0.3);
  }
  if (c.front > b.y1 + 2) {
    c.state = 'rest';
    c.cd = COUGH.rest;
    c.done = true;
  }
}

// ---------------------------------------------------------------------------
// Зал-событие Горла: «Миндалины». Две железы-миндалины рожают антитела и
// плюются слизью, пока их не срежешь. Обе пали — добыча в зале.
// ---------------------------------------------------------------------------

function stepTonsils(sim: Sim, st: F15State, api: SimApi): void {
  const b = st.boxes.tonsils;
  if (!b) return;
  const t = st.tonsils;
  const h = sim.hero;
  const posts = st.posts.filter((p) => p.kind === 'tonsil');
  if (t.state === 'idle') {
    if (!inBox(b, h.x, h.y)) return;
    if (posts.every((p) => p.dead)) {
      t.state = 'done';
      return;
    }
    t.state = 'on';
    say(sim, 'f15_tonsil_trap', 'МИНДАЛИНЫ', 'рожают антитела, пока живы — срежь обе');
    return;
  }
  if (t.state !== 'on') return;
  if (!posts.every((p) => p.dead)) return;
  t.state = 'done';
  const cx = (b.x0 + b.x1 + 1) / 2;
  const cy = (b.y0 + b.y1 + 1) / 2;
  for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 160, cx, cy);
  for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2, cx, cy);
  api.dropAt(sim, 'f15_lymph', 1, cx, cy);
  api.dropAt(sim, 'f15_lymph', 1, cx, cy);
  if (sim.rng() < 0.35) api.dropAt(sim, 'key', 1, cx, cy);
  say(sim, 'f15_tonsil_call', 'МИНДАЛИНЫ СРЕЗАНЫ', 'горло больше не рожает антител здесь');
}

// ---------------------------------------------------------------------------
// Зал-событие Чрева: «Переваривание». Двери-сфинктеры закрыты, сок встаёт
// кольцами от краёв к середине (каждое кольцо сперва бурлит), из сока
// выходят подражатели и пузыри. Кто из монстров стоит в соке — растворился.
// Через 36 с сок уходит, двери открыты, в середине — переваренное.
// ---------------------------------------------------------------------------

export const DIGEST = { rise: [3.6, 13, 22.5], warn: 1.5, end: 36, spawns: [5, 10, 15, 19, 24, 29] };

function digestStart(sim: Sim, st: F15State): void {
  const d = st.digest;
  d.state = 'on';
  d.t = 0;
  d.stage = 0;
  say(sim, 'f15_digest_trap', 'ПЕРЕВАРИВАНИЕ', 'сфинктеры сомкнулись, сок встаёт от краёв — к середине!');
  sim.events.push({ t: 'shake', k: 0.35 });
}

function stepDigest(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const b = st.boxes.digest;
  if (!b) return;
  const d = st.digest;
  const h = sim.hero;
  const W = sim.world.w;
  if (d.state === 'idle') {
    if (!inBox(b, h.x, h.y)) return;
    const k = markAt(sim, Math.floor(h.x), Math.floor(h.y));
    if (k === M.ring3 || k === M.fold) digestStart(sim, st);
    return;
  }
  if (d.state !== 'on') return;
  const t0 = d.t;
  d.t += dt;
  const t1 = d.t;
  const cross = (t: number) => t0 < t && t1 >= t;
  for (let s = 0; s < 3; s++) {
    const cells = d.cells[s];
    // Бурлит — предупреждение: зона-картинка на всё кольцо.
    if (cross(DIGEST.rise[s] - DIGEST.warn)) {
      addZone(sim, api, { x: h.x, y: h.y, r: 0.1, life: DIGEST.warn, art: 'f15_boil', ring: s });
      sim.events.push({ t: 'boss', what: 'f15_boil' });
    }
    if (cross(DIGEST.rise[s])) {
      d.stage = s + 1;
      for (const i of cells) saveTile(sim, st, api, i, T_HAZARD, M.acidRise, F15_HAZ.acid);
      // Кто из монстров стоит в соке — растворился (кроме тех, кто в нём живёт).
      const set = new Set(cells);
      for (const m of sim.mobs) {
        if (m.mode === 'dying' || m.kind === 'f15_msala' || m.kind === 'f15_acid') continue;
        if (api.def(m.kind).boss || (m.data.ghost ?? 0) > 0) continue;
        if (set.has(Math.floor(m.y) * W + Math.floor(m.x))) api.fall(sim, m);
      }
      sim.events.push({ t: 'shake', k: 0.25 });
      sim.events.push({ t: 'boss', what: 'f15_acid_splash' });
    }
  }
  // Растворяет и тех, кто забрёл в сок потом (не своих).
  if (d.stage > 0 && Math.floor(t1 * 4) !== Math.floor(t0 * 4))
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || m.kind === 'f15_msala' || m.kind === 'f15_acid' || (m.data.ghost ?? 0) > 0) continue;
      if (api.def(m.kind).boss || api.def(m.kind).fly) continue;
      if (markAt(sim, Math.floor(m.x), Math.floor(m.y)) === M.acidRise) hurtMob(sim, api, m, m.maxHp * 0.12);
    }
  // Из сока выходят подражатели-саламандры и пузыри.
  for (const ts of DIGEST.spawns)
    if (cross(ts) && d.stage > 0) {
      const pool = d.cells.slice(0, d.stage).flat();
      for (let n = 0; n < 2; n++) {
        let best = -1;
        let bd = -1;
        for (let k = 0; k < 14; k++) {
          const i = pool[Math.floor(sim.rng() * pool.length)];
          const dd = hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y);
          if (dd > 4 && dd < 12 && dd > bd) {
            bd = dd;
            best = i;
          }
        }
        if (best < 0) continue;
        const kind = n === 0 && ts % 2 ? 'f15_acid' : 'f15_msala';
        const m = api.spawnMob(sim, kind, (best % W) + 0.5, Math.floor(best / W) + 0.5, {
          mode: kind === 'f15_msala' ? 'f15_rise' : 'f15_drift',
        });
        m.data.gx = h.x;
        m.data.gy = h.y;
        m.data.walk = 1;
        sim.events.push({ t: 'emerge', x: m.x, y: m.y });
      }
    }
  if (d.t >= DIGEST.end) {
    for (const cells of d.cells) for (const i of cells) restoreTile(sim, st, api, i);
    d.state = 'done';
    const cx = (b.x0 + b.x1 + 1) / 2;
    const cy = (b.y0 + b.y1 + 1) / 2;
    if (!d.paid) {
      d.paid = true;
      for (let i = 0; i < 8; i++) api.dropAt(sim, 'coin', 180, cx, cy);
      for (let i = 0; i < 4; i++) api.dropAt(sim, 'token', 2, cx, cy);
      api.dropAt(sim, 'f15_bile', 1, cx, cy);
      api.dropAt(sim, 'f15_bile', 1, cx, cy);
      api.dropAt(sim, 'f15_mold', 1, cx, cy);
      if (sim.rng() < 0.4) api.dropAt(sim, 'key', 1, cx, cy);
    }
    say(sim, 'f15_digest_call', 'СОК УШЁЛ', 'сфинктеры разжались — переваренное в середине');
  }
}

/** Сброс «Переваривания» (герой пал): сок уходит, двери открыты. */
function digestReset(sim: Sim, st: F15State, api: SimApi): void {
  const d = st.digest;
  if (d.state !== 'on') return;
  for (const cells of d.cells) for (const i of cells) restoreTile(sim, st, api, i);
  d.state = 'idle';
  d.stage = 0;
}

// ---------------------------------------------------------------------------
// Зал-событие Чрева: «Выводок». Мешки на стенах слушают шум (удары, рывки,
// убийства) и набухают; набух — лопается личинками. Матка в середине
// откладывает новые мешки. Убил матку — выводок завял.
// ---------------------------------------------------------------------------

function stepBrood(sim: Sim, st: F15State, api: SimApi): void {
  const b = st.boxes.brood;
  if (!b) return;
  const br = st.brood;
  const h = sim.hero;
  if (br.state === 'idle') {
    if (!inBox(b, h.x, h.y)) return;
    br.state = 'on';
    br.t = sim.time;
    say(sim, 'f15_brood_trap', 'ВЫВОДОК', 'мешки слышат шум — бей их первым, до того как лопнут');
    return;
  }
  if (br.state !== 'on') return;
  const matron = st.posts.find((p) => p.kind === 'matron');
  if (!matron?.dead) return;
  br.state = 'done';
  // Выводок завял: мешки зала сохнут без личинок.
  for (const m of sim.mobs)
    if (m.kind === 'f15_sac' && m.mode !== 'dying' && inBox(b, m.x, m.y)) {
      m.data.wither = 1;
      hurtMob(sim, api, m, m.maxHp * 2);
    }
  const cx = matron.x;
  const cy = matron.y;
  for (let i = 0; i < 6; i++) api.dropAt(sim, 'coin', 180, cx, cy);
  for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2, cx, cy);
  api.dropAt(sim, 'f15_mold', 1, cx, cy);
  if (sim.rng() < 0.4) api.dropAt(sim, 'key', 1, cx, cy);
  say(sim, 'f15_brood_call', 'ВЫВОДОК ЗАТИХ', 'матка мертва — мешки высохли');
}

/** Выводок идёт: мешки набухают от шума героя (для ИИ мешка). */
export const f15BroodOn = (sim: Sim): boolean => STATE.get(sim)?.brood.state === 'on';

// ---------------------------------------------------------------------------
// Зал-событие Сосудов: «Тромб». Прошёл середину Аорты — сосуд закупорен
// сгустками спереди и сзади (набухают с метки), из сгустков лезут
// антитела и дроны волнами. Отбился — тромб рассосался.
// ---------------------------------------------------------------------------

export const CLOT = { warn: 1.3, waves: [2.6, 10.5, 18.5], end: 60 };

function stepClot(sim: Sim, st: F15State, api: SimApi, dt: number): void {
  const b = st.boxes.aorta;
  const c = st.clot;
  if (!b || !c.cells.length) return;
  const h = sim.hero;
  const W = sim.world.w;
  const ys = [...new Set(c.cells.map((i) => Math.floor(i / W)))].sort((a, z) => a - z);
  const top = ys[0];
  const bot = ys[ys.length - 1];
  if (c.state === 'idle') {
    if (!inBox(b, h.x, h.y) || h.y < top + 7 || h.y > bot - 7) return;
    c.state = 'on';
    c.t = 0;
    c.wave = 0;
    say(sim, 'f15_clot_trap', 'ТРОМБ', 'сосуд закупорен спереди и сзади — иммунитет идёт за тобой');
    for (const y of ys) {
      const xs = c.cells.filter((i) => Math.floor(i / W) === y).map((i) => i % W);
      addZone(sim, api, {
        x: (Math.min(...xs) + Math.max(...xs) + 1) / 2,
        y: y + 0.5,
        r: 0.1,
        life: CLOT.warn,
        art: 'f15_clotwarn',
        x0: Math.min(...xs),
        x1: Math.max(...xs) + 1,
      });
    }
    return;
  }
  if (c.state !== 'on') return;
  const t0 = c.t;
  c.t += dt;
  if (t0 < CLOT.warn && c.t >= CLOT.warn) {
    for (const i of c.cells) saveTile(sim, st, api, i, T_WALL, M.clotWall, null);
    sim.events.push({ t: 'shake', k: 0.3 });
    sim.events.push({ t: 'boss', what: 'f15_clot_wall' });
  }
  for (let k = 0; k < CLOT.waves.length; k++) {
    if (!(t0 < CLOT.waves[k] && c.t >= CLOT.waves[k])) continue;
    c.wave = k + 1;
    const kinds =
      k === 0
        ? ['f15_mob', 'f15_mob', 'f15_mob', 'f15_drone', 'f15_mob']
        : k === 1
          ? ['f15_mob', 'f15_mob', 'f15_macro', 'f15_mob', 'f15_mob']
          : ['f15_drone', 'f15_mob', 'f15_drone', 'f15_mob', 'f15_drone'];
    kinds.forEach((kind, n) => {
      // Из сгустка: у его грани, с той стороны, где герой дальше.
      const y = Math.abs(h.y - top) > Math.abs(h.y - bot) ? top + 1.5 : bot - 0.5;
      const xs = c.cells.filter((i) => Math.floor(i / W) === (y < h.y ? top : bot)).map((i) => i % W);
      const x = xs.length ? xs[(n * 3 + k) % xs.length] + 0.5 : h.x;
      if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return;
      const m = api.spawnMob(sim, kind, x, y, { mode: 'stun' });
      m.t = -n * 0.25;
      sim.events.push({ t: 'emerge', x, y });
    });
  }
  const alive = sim.mobs.filter((m) => m.mode !== 'dying' && inBox(b, m.x, m.y) && !api.def(m.kind).boss).length;
  if ((c.wave >= CLOT.waves.length && c.t > CLOT.waves[CLOT.waves.length - 1] + 3 && alive <= 2) || c.t > CLOT.end) {
    for (const i of c.cells) restoreTile(sim, st, api, i);
    c.state = 'done';
    if (!c.paid) {
      c.paid = true;
      const cx = (b.x0 + b.x1 + 1) / 2;
      const cy = (top + bot) / 2;
      for (let i = 0; i < 7; i++) api.dropAt(sim, 'coin', 200, h.x, h.y);
      for (let i = 0; i < 4; i++) api.dropAt(sim, 'token', 2, h.x, h.y);
      api.dropAt(sim, 'f15_plasma', 1, h.x, h.y);
      api.dropAt(sim, 'f15_plasma', 1, h.x, h.y);
      if (sim.rng() < 0.4) api.dropAt(sim, 'key', 1, cx, cy);
    }
    say(sim, 'f15_clot_call', 'ТРОМБ РАССОСАЛСЯ', 'кровь снова течёт к сердцу');
  }
}

function clotReset(sim: Sim, st: F15State, api: SimApi): void {
  const c = st.clot;
  if (c.state !== 'on') return;
  for (const i of c.cells) restoreTile(sim, st, api, i);
  c.state = 'idle';
}

// ---------------------------------------------------------------------------
// Зал-событие Сосудов: «Клапаны сердца». Три ряда створок распахиваются
// только на удар сердца, течение посередине несёт к сердцу. Прошёл все —
// камера уходит к Сердцу: там Хозяин подземелья.
// ---------------------------------------------------------------------------

function stepValves(sim: Sim, st: F15State, api: SimApi): void {
  const b = st.boxes.valves;
  if (!b) return;
  const v = st.valves;
  const h = sim.hero;
  if (v.state === 'idle' && inBox(b, h.x, h.y)) {
    v.state = 'on';
    say(sim, 'f15_valves_trap', 'КЛАПАНЫ СЕРДЦА', 'створки открываются на удар — иди в ритм');
  }
  if (v.state === 'on' && !v.top && h.y < b.y0 + 2.5 && inBox(b, h.x, h.y, 1)) {
    v.top = true;
    v.state = 'done';
    const band = sim.world.bands.find((x) => x.def.id === F15_VEINS);
    const gy = (band?.top ?? 0) - 7;
    api.camera(sim, 32, gy, 2.6);
    sim.events.push({ t: 'flash', color: '#ff2040', k: 0.5 });
    sim.events.push({ t: 'shake', k: 0.3 });
    say(sim, 'f15_heart_call', 'СЕРДЦЕ СЛЫШИТ ТЕБЯ', 'наверху — Хозяин подземелья');
  }
}

// ---------------------------------------------------------------------------
// Действия этажа: железа (слизь), нерв (сфинктеры Горла), вентиль (Лимфоузел).
// ---------------------------------------------------------------------------

export const GLAND = { hide: 9, cd: 40 };
export const NERVE = { relax: 12, cd: 40, alien: 18 };

function onUse(sim: Sim, obj: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim);
  const h = sim.hero;
  switch (obj.ref) {
    case 'f15_gland': {
      if ((st.glands.get(obj.id) ?? -9) > sim.time) return false;
      st.glands.set(obj.id, sim.time + GLAND.cd);
      st.alien = 0;
      st.stage = 0;
      st.hidden = sim.time + GLAND.hide;
      addZone(sim, api, { x: h.x, y: h.y, r: 0.1, life: GLAND.hide, art: 'f15_coat', follow: 1 });
      // Антитела, что гнались, теряют след.
      for (const m of sim.mobs) if (m.kind === 'f15_mob' && m.mode === 'chase') m.data.lost = 1;
      say(sim, 'f15_gland_call', 'ТЫ — СВОЙ', 'слизь скрыла запах: антитела теряют след');
      return true;
    }
    case 'f15_nervecord': {
      if ((st.glands.get(obj.id) ?? -9) > sim.time) return false;
      st.glands.set(obj.id, sim.time + NERVE.cd);
      st.relaxed = sim.time + NERVE.relax;
      st.alien = Math.min(99, st.alien + NERVE.alien);
      sim.events.push({ t: 'flash', color: '#c890ff', k: 0.4 });
      say(sim, 'f15_nerve_call', 'НЕРВ ДЁРНУТ', 'сфинктеры Горла разжались на 12 секунд — организм это почуял');
      return true;
    }
    case 'f15_wheel': {
      if (st.lymphOpen) return false;
      st.lymphOpen = true;
      const door = st.lives.find((l) => l.kind === 'lymph');
      if (door) api.camera(sim, door.cx, door.cy, 1.6);
      say(sim, 'f15_wheel_call', 'ВЕНА СЖАТА', 'сфинктер Лимфоузла разжался');
      return true;
    }
  }
  return false;
}

function useLabel(sim: Sim, obj: WorldObj): string | null {
  const st = stateOf(sim);
  switch (obj.ref) {
    case 'f15_gland':
      return (st.glands.get(obj.id) ?? -9) > sim.time ? null : (obj.use?.label ?? 'Выдавить слизь');
    case 'f15_nervecord':
      return (st.glands.get(obj.id) ?? -9) > sim.time ? null : (obj.use?.label ?? 'Дёрнуть нерв');
    case 'f15_wheel':
      return st.lymphOpen ? null : (obj.use?.label ?? 'Сжать вену');
  }
  return obj.use?.label ?? null;
}

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

/** Свет над кислотными озёрами: светится сам сок. */
function lakeLights(sim: Sim, api: SimApi): void {
  const w = sim.world;
  const W = w.w;
  for (let y = 0; y < w.h; y += 3)
    for (let x = 1; x < W - 1; x += 4) {
      const k = w.mark[y * W + x];
      if (k !== M.acid) continue;
      api.light(sim, `f15a${x}:${y}`, { x: x + 0.5, y: y + 0.5, r: 2.8, tint: 'green' });
    }
}

registerFloor(15, {
  start(sim, api) {
    STATE.set(sim, scan(sim));
    lakeLights(sim, api);
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    if (heroDown(sim)) {
      digestReset(sim, st, api);
      clotReset(sim, st, api);
      return;
    }
    stepPulse(sim, st, api, dt);
    stepLives(sim, st, api);
    if (Math.floor(sim.time * 4) !== Math.floor((sim.time - dt) * 4)) unstick(sim, api);
    stepAlien(sim, st, api, dt);
    stepPosts(sim, st, api);
    if (sim.area === HEART_AREA) return;
    stepCough(sim, st, api, dt);
    stepTonsils(sim, st, api);
    stepDigest(sim, st, api, dt);
    stepBrood(sim, st, api);
    stepClot(sim, st, api, dt);
    stepValves(sim, st, api);
    // Слизь железы и мокрота — картинки, что следуют за героем.
    for (const z of sim.zones) {
      const zz = z as Zone & { follow?: number };
      if (zz.follow) {
        z.x = sim.hero.x;
        z.y = sim.hero.y;
      }
    }
  },
  onUse,
  useLabel,
});

/** Состояние событий — для тестов и стенда. */
export const f15Events = (sim: Sim) => {
  const st = STATE.get(sim);
  return st
    ? {
        cough: st.cough.state,
        tonsils: st.tonsils.state,
        digest: st.digest.state,
        brood: st.brood.state,
        clot: st.clot.state,
        valves: st.valves.state,
        alien: st.alien,
        stage: st.stage,
      }
    : null;
};

// ===========================================================================
// Монстры.
// ===========================================================================

/** Сколько на герое висит прилипших (антител и паразитов). */
const latched = (sim: Sim) =>
  sim.mobs.filter((m) => m.mode === 'f15_latch' && m.kind !== 'f15_macro').length;

/** Прилипнуть к герою: встать на его край и держаться (без толкотни). */
function latchOn(sim: Sim, m: Mob, api: SimApi): void {
  const h = sim.hero;
  m.data.la = Math.atan2(m.y - h.y, m.x - h.x) + (sim.rng() - 0.5) * 0.6;
  m.data.bite = 0.6;
  api.setMode(m, 'f15_latch');
}

/** Держится на герое; рывок стряхивает. Вернуть true — стряхнули. */
function latchStep(sim: Sim, m: Mob, dt: number, api: SimApi, maxT: number): boolean {
  const h = sim.hero;
  if (heroDown(sim) || m.t > maxT) {
    api.setMode(m, 'recover');
    return true;
  }
  // Рывок стряхивает всех: разлетаются и оглушены.
  if (h.mode === 'dash' || h.pull) {
    const a = m.data.la ?? 0;
    m.kx = Math.cos(a) * 9;
    m.ky = Math.sin(a) * 9;
    api.setMode(m, 'f15_fling');
    m.cd = 1.2;
    return true;
  }
  // На краю тела героя: 0,6 клетки — ни толкотни, ни наезда.
  let a = (m.data.la ?? 0) + Math.sin(sim.time * 3 + m.id) * 0.15;
  const R = m.r + h.r + 0.04;
  // Не в стену: сдвинуться по кругу героя, а негде — отвалиться.
  const solidAt = (q: number) => api.solidTile(sim, Math.floor(h.x + Math.cos(q) * R), Math.floor(h.y + Math.sin(q) * R));
  if (solidAt(a)) {
    let found = false;
    for (let k = 1; k <= 8 && !found; k++)
      for (const sg of [1, -1])
        if (!solidAt(a + sg * k * 0.4)) {
          a += sg * k * 0.4;
          m.data.la = a;
          found = true;
          break;
        }
    if (!found) {
      api.setMode(m, 'recover');
      return true;
    }
  }
  m.x = h.x + Math.cos(a) * R;
  m.y = h.y + Math.sin(a) * R;
  api.collide(sim, m);
  m.vx = 0;
  m.vy = 0;
  m.kx = 0;
  m.ky = 0;
  m.face = Math.atan2(h.y - m.y, h.x - m.x);
  return false;
}

// ---------------------------------------------------------------------------
// Антитело: стая, прыжок-хват. Прилипло — вяжет ноги (чем больше, тем
// медленнее) и метит «чужака». Рывок стряхивает всех разом.
// ---------------------------------------------------------------------------

export const ANTIBODY = { maxLatch: 4, hold: 5, slowPer: 0.13, slowMax: 0.55, bite: 1.1, alien: 1.2 };

registerBrain('f15_antibody', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f15_latch': {
        if (latchStep(sim, m, dt, api, ANTIBODY.hold)) return;
        const n = latched(sim);
        api.heroStatus(sim, 'slow', 0.35, Math.min(ANTIBODY.slowMax, ANTIBODY.slowPer * n));
        addAlien(sim, ANTIBODY.alien * dt);
        m.data.bite -= dt;
        if (m.data.bite <= 0) {
          m.data.bite = ANTIBODY.bite;
          if (canHurt(sim)) api.hurtHero(sim, m.dmg * 0.4, m.x, m.y, 0, m.kind);
        }
        return;
      }
      case 'f15_fling':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 0.8) api.setMode(m, 'chase');
        return;
      case 'chase': {
        // Слизь железы: антитело теряет след и бродит у дома.
        if (f15Hidden(sim) && !m.data.angry) {
          const tx = m.hx - m.x;
          const ty = m.hy - m.y;
          const l = hypot(tx, ty);
          if (l > 1.5) api.steer(sim, m, tx / l, ty / l, m.speed * 0.4, dt);
          else {
            m.vx *= 0.8;
            m.vy *= 0.8;
          }
          return;
        }
        m.data.lost = 0;
        if (dist < def.reach + m.r + h.r + 0.3 && m.cd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Стая обтекает: у каждого своя сторона.
        const side = m.id % 2 ? 1 : -1;
        const a0 = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.5;
        const R = dist > 5 ? 0 : 1.1;
        const [cx, cy] = api.chaseDir(sim, m, h.x + Math.cos(a0) * R, h.y + Math.sin(a0) * R);
        const wob = Math.sin(sim.time * 9 + m.id) * 0.3;
        api.steer(sim, m, cx - cy * wob, cy + cx * wob, m.speed, dt);
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > def.windup - 0.2) m.danger = def.reach + m.r + h.r + 0.4;
        if (m.t < def.windup) return;
        m.vx += Math.cos(m.face) * 5;
        m.vy += Math.sin(m.face) * 5;
        if (dist < def.reach + m.r + h.r + 0.2 && canHurt(sim)) {
          if (latched(sim) < ANTIBODY.maxLatch) {
            latchOn(sim, m, api);
            api.hurtHero(sim, m.dmg * 0.6, m.x, m.y, 0, m.kind);
            return;
          }
          api.hurtHero(sim, m.dmg, m.x, m.y, 2, m.kind);
        }
        api.setMode(m, 'recover');
        m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.5);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m) {
    m.data.angry = 1;
    return m.mode === 'f15_latch' ? 1.35 : 1;
  },
});

// ---------------------------------------------------------------------------
// Макрофаг: амёба. Круг на полу наливается — поглощает, кто в нём. Внутри
// бьют вдвое, рывок вырывает наружу. Ест добычу с пола и личинок.
// ---------------------------------------------------------------------------

export const MACRO = { r: 1.35, hold: 2.4, tick: 0.5, inside: 2.2 };
const EATEN = new WeakMap<Mob, { kind: string; n: number }[]>();

registerBrain('f15_macro', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    // Ест с пола: добычу — прячет в себя (отдаст, когда убьют), личинок — лечится.
    if (m.mode !== 'f15_engulf') {
      for (const d of sim.drops) {
        if (d.age < 0.6 || hypot(d.x - m.x, d.y - m.y) > m.r + 0.35) continue;
        const bag = EATEN.get(m) ?? [];
        bag.push({ kind: d.kind, n: d.n });
        EATEN.set(m, bag);
        d.age = -99;
        d.x = -99;
        d.y = -99;
      }
      sim.drops = sim.drops.filter((d) => d.x > -50);
      for (const o of sim.mobs)
        if (o.kind === 'f15_larva' && o.mode !== 'dying' && hypot(o.x - m.x, o.y - m.y) < m.r + 0.3) {
          o.hp = 0;
          api.setMode(o, 'escape');
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.12);
        }
    }
    switch (m.mode) {
      case 'chase': {
        if (dist < MACRO.r + 0.35 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        // Амёба переливается: ход толчками.
        const gait = 0.55 + 0.45 * Math.max(0, Math.sin(sim.time * 4 + m.id));
        api.steer(sim, m, cx, cy, m.speed * gait, dt);
        return;
      }
      case 'windup': {
        m.vx *= 0.75;
        m.vy *= 0.75;
        m.face = Math.atan2(dy, dx);
        const T = def.windup;
        m.tele = { shape: 'circle', r: MACRO.r, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.25) m.danger = MACRO.r + 0.2;
        if (m.t < T) return;
        if (dist < MACRO.r + h.r * 0.5 && canHurt(sim) && !h.pull) {
          api.setMode(m, 'f15_engulf');
          m.data.tick = MACRO.tick * 0.5;
          if (!sim.floorData.f15eng) {
            sim.floorData.f15eng = 1;
            say(sim, 'f15_engulf_trap', 'ПОГЛОЩЁН', 'изнутри бей — вдвое больнее; рывок — наружу');
          } else sim.events.push({ t: 'boss', what: 'f15_engulf' });
          return;
        }
        api.setMode(m, 'recover');
        m.cd = def.rest;
        return;
      }
      case 'f15_engulf': {
        m.vx = 0;
        m.vy = 0;
        // Рывок вырывает; держит не дольше 2,4 с — и выплёвывает.
        if (h.mode === 'dash' || m.t > MACRO.hold || heroDown(sim)) {
          const a = h.mode === 'dash' ? h.dashDir : m.face;
          api.setMode(m, 'f15_spit');
          m.cd = def.rest * 1.5;
          if (!heroDown(sim) && h.mode !== 'dash')
            api.pullHero(sim, m.x + Math.cos(a) * 2.2, m.y + Math.sin(a) * 2.2, { speed: 12, max: 0.4 });
          return;
        }
        // Герой — в середине амёбы: ровно в её точке (толкотни нет).
        h.x = m.x;
        h.y = m.y;
        h.vx = 0;
        h.vy = 0;
        m.data.tick -= dt;
        if (m.data.tick <= 0) {
          m.data.tick = MACRO.tick;
          if (canHurt(sim))
            api.hurtHero(sim, m.dmg * 0.34, m.x, m.y, 0, m.kind, { kind: 'poison', dur: 1.2 });
        }
        return;
      }
      case 'f15_spit':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 1.1) api.setMode(m, 'chase');
        return;
      case 'recover':
        recoverStep(m, api, 0.9);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m) {
    if (m.mode === 'f15_engulf') return MACRO.inside;
    if (m.mode === 'f15_spit' || m.mode === 'recover') return 1.35;
    return 1;
  },
  onDeath(sim, m, mode, api) {
    for (const e of EATEN.get(m) ?? []) api.dropAt(sim, e.kind, e.n, m.x, m.y);
    EATEN.delete(m);
    postDead(sim, m.data.post);
    void mode;
  },
});

// ---------------------------------------------------------------------------
// Нервный узел: сидит на узле вен. Увидел — наливается, потом сигнал:
// разряды по полу веером (поверх темноты, стены режут), метка «чужак» и
// антитела из пор. Убит — вены вокруг гаснут, метка падает.
// ---------------------------------------------------------------------------

export const NERVE_NODE = { see: 9.5, charge: 1.1, warn: 0.6, fan: 0.34, alien: 14, calm: 25 };

registerBrain('f15_nerve', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.x = m.hx;
    m.y = m.hy;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f15_idle':
      case 'chase': {
        m.face = Math.atan2(dy, dx);
        if (dist < NERVE_NODE.see && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y))
          api.setMode(m, 'f15_charge');
        return;
      }
      case 'f15_charge': {
        m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'circle', r: 0.95, k: Math.min(1, m.t / NERVE_NODE.charge) };
        if (m.t < NERVE_NODE.charge) return;
        addAlien(sim, NERVE_NODE.alien);
        const a0 = Math.atan2(dy, dx);
        const len = Math.max(3, Math.min(9, dist + 2.5));
        for (const da of [-NERVE_NODE.fan, 0, NERVE_NODE.fan]) {
          const a = a0 + da;
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: Math.min(len, clearDist(sim, api, m.x, m.y, a, len)),
            w: 0.36,
            ang: a,
            warn: NERVE_NODE.warn,
            dmg: m.dmg,
            knock: 2,
            status: 'slow',
            dur: 1,
            art: 'f15_zap',
            above: true,
            los: true,
            from: m.id,
          });
        }
        // Зовёт антитела из ближней поры.
        const n = sim.mobs.filter((x) => x.kind === 'f15_mob' && x.mode !== 'dying').length;
        const b = n < 12 ? api.pickBurrow(sim, 3, 14) : null;
        if (b)
          for (let i = 0; i < 2; i++) {
            const k = api.fromBurrow(sim, b, 'f15_mob');
            k.t = -i * 0.3;
          }
        sim.events.push({ t: 'boss', what: 'f15_signal' });
        api.setMode(m, 'recover');
        m.cd = def.rest;
        return;
      }
      case 'recover':
        if (m.t > 0.8) api.setMode(m, 'f15_idle');
        return;
      default:
        api.setMode(m, 'f15_idle');
    }
  },
  onDeath(sim, m) {
    const st = STATE.get(sim);
    if (st) {
      st.alien = Math.max(0, st.alien - NERVE_NODE.calm);
      for (const n of st.nodes) if (hypot(n.x - m.x, n.y - m.y) < 12) n.dim = true;
    }
    postDead(sim, m.data.post);
    say(sim, 'f15_numb_call', 'УЗЕЛ ОНЕМЕЛ', 'вены вокруг погасли — здесь тебя не слышат');
  },
});

// ---------------------------------------------------------------------------
// Паразит: пиявка под слизистой. Бугор ползёт к герою (не достать),
// выныривает с меткой-линией и прыгает. Попал — присосался (яд, лечится),
// рывок срывает. Промахнулся — лежит открытый.
// ---------------------------------------------------------------------------

export const PARASITE = { aim: 0.55, leap: 3.2, speed: 10, exposed: 1.3, hold: 5, bite: 0.9 };

registerBrain('f15_parasite', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase':
      case 'f15_burrow': {
        if (m.mode === 'chase') {
          api.setMode(m, 'f15_burrow');
          return;
        }
        m.data.ghost = 1;
        if (
          dist < 2.9 &&
          dist > 1 &&
          m.cd <= 0 &&
          m.t > 0.8 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y) &&
          clearLine(sim, api, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(dy, dx);
          m.data.ghost = 0;
          api.setMode(m, 'f15_rise');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 4 ? 0.7 : 1), dt);
        return;
      }
      case 'f15_rise': {
        m.data.ghost = 0;
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t < PARASITE.aim * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(PARASITE.leap, clearDist(sim, api, m.x, m.y, m.dir, PARASITE.leap));
        m.data.len = len;
        m.tele = { shape: 'line', r: len, w: 0.3, ang: m.dir, k: Math.min(1, m.t / PARASITE.aim) };
        if (m.t > PARASITE.aim - 0.22) m.danger = len + 0.5;
        if (m.t >= PARASITE.aim) {
          m.data.hit = 0;
          m.data.run = 0;
          api.setMode(m, 'f15_leap');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        }
        return;
      }
      case 'f15_leap': {
        const s = PARASITE.speed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 0.6;
        if (dist < m.r + h.r + 0.15 && canHurt(sim)) {
          if (latched(sim) < ANTIBODY.maxLatch + 1) {
            latchOn(sim, m, api);
            api.hurtHero(sim, m.dmg * 0.7, m.x, m.y, 0, m.kind, { kind: 'poison', dur: 1.2 });
            return;
          }
          api.hurtHero(sim, m.dmg, m.x, m.y, 3, m.kind);
          api.setMode(m, 'f15_exposed');
          return;
        }
        if (m.data.run >= (m.data.len ?? PARASITE.leap) || m.t > 0.5) api.setMode(m, 'f15_exposed');
        return;
      }
      case 'f15_latch': {
        if (latchStep(sim, m, dt, api, PARASITE.hold)) {
          if ((m.mode as string) !== 'f15_fling') api.setMode(m, 'f15_exposed');
          return;
        }
        addAlien(sim, 4 * dt);
        m.data.bite -= dt;
        if (m.data.bite <= 0) {
          m.data.bite = PARASITE.bite;
          if (canHurt(sim)) {
            api.hurtHero(sim, m.dmg * 0.45, m.x, m.y, 0, m.kind, { kind: 'poison', dur: 1.5 });
            m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05);
          }
        }
        return;
      }
      case 'f15_fling':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 0.6) api.setMode(m, 'f15_exposed');
        return;
      case 'f15_exposed':
        m.data.ghost = 0;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > PARASITE.exposed) {
          m.cd = 1.4;
          api.setMode(m, 'f15_burrow');
        }
        return;
      default:
        api.setMode(m, 'f15_burrow');
    }
  },
  onHit(sim, m) {
    if (m.mode === 'f15_exposed') return 1.6;
    if (m.mode === 'f15_latch') return 1.3;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Кислотный пузырь: плывёт (над соком тоже), раздувается у героя и лопается
// лужей. Ударь раньше — отлетит и лопнет там, куда отбил, — хоть во врагов.
// ---------------------------------------------------------------------------

export const BUBBLE = { r: 1.6, swell: 0.85, knock: 0.45, pool: 2.8 };

function pop(sim: Sim, m: Mob, api: SimApi, byHero: boolean): void {
  if (m.data.popped) return;
  m.data.popped = 1;
  api.zone(sim, {
    x: m.x,
    y: m.y,
    r: BUBBLE.r,
    life: BUBBLE.pool,
    dps: 0.02,
    status: 'poison',
    dur: 1.4,
    slow: 0.72,
    art: 'f15_acidpool',
  });
  const h = sim.hero;
  if (hypot(h.x - m.x, h.y - m.y) < BUBBLE.r + h.r && canHurt(sim))
    api.hurtHero(sim, m.dmg * (byHero ? 0.6 : 1), m.x, m.y, 4, m.kind, { kind: 'poison', dur: 2 });
  for (const o of sim.mobs) {
    if (o === m || o.mode === 'dying' || o.kind === 'f15_acid' || o.kind === 'f15_msala') continue;
    if (api.def(o.kind).boss || hypot(o.x - m.x, o.y - m.y) > BUBBLE.r + o.r) continue;
    hurtMob(sim, api, o, o.maxHp * 0.35);
  }
  sim.events.push({ t: 'boss', what: 'f15_pop' });
}

registerBrain('f15_acid', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase':
      case 'f15_drift': {
        if (m.mode === 'chase') api.setMode(m, 'f15_drift');
        if (dist < 1.8 && m.cd <= 0) {
          api.setMode(m, 'f15_swell');
          return;
        }
        if (dist < 12) {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          const bob = Math.sin(sim.time * 2 + m.id) * 0.4;
          api.steer(sim, m, cx - cy * bob, cy + cx * bob, m.speed, dt);
        } else {
          m.vx *= 0.9;
          m.vy *= 0.9;
        }
        return;
      }
      case 'f15_swell': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = { shape: 'circle', r: BUBBLE.r, k: Math.min(1, m.t / def.windup) };
        if (m.t > def.windup - 0.25) m.danger = BUBBLE.r + 0.3;
        if (m.t < def.windup) return;
        pop(sim, m, api, false);
        hurtMob(sim, api, m, m.maxHp * 10);
        return;
      }
      case 'f15_knock': {
        // Отбили: летит и лопается там, где остановится.
        m.tele = { shape: 'circle', r: BUBBLE.r * 0.8, k: Math.min(1, m.t / BUBBLE.knock) };
        if (m.t < BUBBLE.knock) return;
        pop(sim, m, api, true);
        hurtMob(sim, api, m, m.maxHp * 10);
        return;
      }
      default:
        api.setMode(m, 'f15_drift');
    }
  },
  onHit(sim, m) {
    if (m.mode !== 'f15_knock' && !m.data.popped) {
      m.mode = 'f15_knock';
      m.t = 0;
    }
    return 1;
  },
  onDeath(sim, m, mode, api) {
    // Убит, не успев лопнуть, — всё равно лопается.
    pop(sim, m, api, true);
    void mode;
  },
});

// ---------------------------------------------------------------------------
// Кровяной дрон: эритроцит-таран. Кружит тройкой, прицел линией — таран.
// О стену — оглушён и открыт. На русле удар сердца несёт и его.
// ---------------------------------------------------------------------------

export const DRONE = { aim: 0.6, speed: 11, max: 7, dizzy: 1.2, orbit: 3.6 };

registerBrain('f15_drone', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = m.mode === 'f15_ram';
    switch (m.mode) {
      case 'chase': {
        const busy = sim.mobs.some(
          (o) => o !== m && o.kind === 'f15_drone' && (o.mode === 'f15_aim' || o.mode === 'f15_ram') && hypot(o.x - m.x, o.y - m.y) < 6,
        );
        if (dist < DRONE.max && dist > 1.4 && m.cd <= 0 && !busy && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f15_aim');
          return;
        }
        // Кружит на своём месте кольца.
        const a = Math.atan2(m.y - h.y, m.x - h.x) + 0.9 * dt * (m.id % 2 ? 1 : -1) * 3;
        const tx = h.x + Math.cos(a) * DRONE.orbit;
        const ty = h.y + Math.sin(a) * DRONE.orbit;
        const [cx, cy] = dist > 8 ? api.chaseDir(sim, m, h.x, h.y) : api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'f15_aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < DRONE.aim * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(DRONE.max, clearDist(sim, api, m.x, m.y, m.dir, DRONE.max));
        m.data.len = len;
        m.tele = { shape: 'line', r: len, w: 0.36, ang: m.dir, k: Math.min(1, m.t / DRONE.aim) };
        if (m.t > DRONE.aim - 0.22) m.danger = len + 0.5;
        if (m.t >= DRONE.aim) {
          m.data.hit = 0;
          m.data.run = 0;
          api.setMode(m, 'f15_ram');
        }
        return;
      }
      case 'f15_ram': {
        const s = DRONE.speed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 0.6;
        if (!m.data.hit && dist < m.r + h.r + 0.12 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
        }
        if (m.data.run >= (m.data.len ?? DRONE.max) + 0.8 || m.t > 1) {
          api.setMode(m, 'recover');
          m.cd = def.rest * (1 + sim.rng());
        }
        return;
      }
      case 'f15_dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > DRONE.dizzy) api.setMode(m, 'chase');
        return;
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, nx, ny, api) {
    if (m.mode !== 'f15_ram') return;
    m.vx = 0;
    m.vy = 0;
    m.bounce = false;
    api.setMode(m, 'f15_dizzy');
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    void nx;
    void ny;
  },
  onHit(sim, m) {
    return m.mode === 'f15_dizzy' ? 1.5 : 1;
  },
});

// ---------------------------------------------------------------------------
// Личинка: быстрая мелочь из мешков. Не добил за 14 с — окукливается (3 с,
// бьётся легче) и выходит подражателем.
// ---------------------------------------------------------------------------

export const LARVA = { life: 14, cocoon: 3, mimics: 6 };

/** Подражатель по месту: у сока — саламандра, в Сосудах — латник, иначе гончая. */
function mimicFor(sim: Sim, x: number, y: number): string {
  const w = sim.world;
  for (let dy = -7; dy <= 7; dy += 1)
    for (let dx = -7; dx <= 7; dx += 1) {
      const cx = Math.floor(x) + dx;
      const cy = Math.floor(y) + dy;
      if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) continue;
      if (w.mark[cy * w.w + cx] === M.acid) return 'f15_msala';
    }
  return areaAt(sim, y) === F15_VEINS ? 'f15_mknight' : 'f15_mhound';
}

registerBrain('f15_larva', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.born = m.data.born ?? sim.time;
    if (m.mode !== 'f15_cocoon' && m.mode !== 'windup' && sim.time - m.data.born > LARVA.life) {
      const mimics = sim.mobs.filter((o) => o.data.fromLarva && o.mode !== 'dying').length;
      if (mimics < LARVA.mimics) {
        api.setMode(m, 'f15_cocoon');
        return;
      }
    }
    switch (m.mode) {
      case 'chase': {
        if (dist < def.reach + m.r + h.r + 0.2 && m.cd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 12 + m.id) * 0.5;
        api.steer(sim, m, cx - cy * z, cy + cx * z, m.speed, dt);
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > def.windup - 0.18) m.danger = def.reach + m.r + h.r + 0.3;
        if (m.t < def.windup) return;
        if (dist < def.reach + m.r + h.r + 0.15 && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 1.5, m.kind);
        m.vx += Math.cos(m.face) * 3;
        m.vy += Math.sin(m.face) * 3;
        api.setMode(m, 'recover');
        m.cd = def.rest;
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.4);
        return;
      case 'f15_cocoon': {
        m.vx = 0;
        m.vy = 0;
        m.tele = { shape: 'circle', r: 0.55, k: Math.min(1, m.t / LARVA.cocoon) };
        if (m.t < LARVA.cocoon) return;
        const kind = mimicFor(sim, m.x, m.y);
        const o = api.spawnMob(sim, kind, m.x, m.y, { mode: kind === 'f15_msala' ? 'chase' : 'stun' });
        o.data.fromLarva = 1;
        api.collide(sim, o);
        sim.events.push({ t: 'emerge', x: m.x, y: m.y });
        sim.events.push({ t: 'boss', what: 'f15_hatch' });
        m.hp = 0;
        api.setMode(m, 'escape');
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m) {
    return m.mode === 'f15_cocoon' ? 1.6 : 1;
  },
});

// ---------------------------------------------------------------------------
// Смотритель: глаз на стебле. Водит конусом взгляда (виден на полу);
// увидел — наводится (линия), метит «чужака» и бьёт лучом. После выстрела
// моргает — тогда открыт; с открытым глазом удар по хрусталику слаб.
// ---------------------------------------------------------------------------

export const WATCHER = { see: 8.5, half: 0.5, lock: 0.85, warn: 0.42, blink: 1.6, len: 9.5, sweep: 0.75 };

const GAZE = new WeakMap<Mob, Zone>();

registerBrain('f15_watcher', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.x = m.hx;
    m.y = m.hy;
    m.tele = null;
    m.danger = 0;
    // Куда смотрит «в покое»: в сторону, где больше всего простора.
    if (m.data.base === undefined) {
      let best = 0;
      let bd = -1;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * TAU;
        const d = clearDist(sim, api, m.x, m.y, a, 10);
        if (d > bd) {
          bd = d;
          best = a;
        }
      }
      m.data.base = best;
    }
    let gz = GAZE.get(m);
    if (!gz || !sim.zones.includes(gz)) {
      gz = addZone(sim, api, { x: m.x, y: m.y, r: 0.1, life: 1e9, art: 'f15_gaze', mob: m.id });
      GAZE.set(m, gz);
    }
    const g = gz as Zone & { ang?: number; arc?: number; len?: number; k?: number; lock?: number };
    const toHero = Math.atan2(dy, dx);
    const sees = (a: number) =>
      dist < WATCHER.see &&
      Math.abs(angDiff(toHero, a)) < WATCHER.half &&
      !heroDown(sim) &&
      api.lineOfSight(sim, m.x, m.y, h.x, h.y);
    switch (m.mode) {
      case 'f15_scan':
      case 'chase': {
        const a = m.data.base + Math.sin(sim.time * WATCHER.sweep + m.id) * 0.8;
        m.face = a;
        g.ang = a;
        g.arc = WATCHER.half * 2;
        g.len = WATCHER.see;
        g.k = 0.3;
        g.lock = 0;
        if (m.cd <= 0 && sees(a)) {
          api.setMode(m, 'f15_lock');
          if (!sim.floorData.f15seen) {
            sim.floorData.f15seen = 1;
            say(sim, 'f15_seen_call', 'СМОТРИТЕЛЬ ВИДИТ', 'уйди из его взгляда — за колонну');
          }
        }
        return;
      }
      case 'f15_lock': {
        m.face = toHero;
        g.ang = toHero;
        g.lock = 1;
        g.k = 0.6 + 0.4 * Math.min(1, m.t / WATCHER.lock);
        addAlien(sim, 30 * dt);
        m.tele = {
          shape: 'line',
          r: Math.min(WATCHER.len, dist + 1),
          w: 0.2,
          ang: toHero,
          k: Math.min(1, m.t / WATCHER.lock) * 0.6,
        };
        // Потерял из вида — снова водит взглядом.
        if (!api.lineOfSight(sim, m.x, m.y, h.x, h.y) || dist > WATCHER.see + 1.5) {
          api.setMode(m, 'f15_scan');
          m.cd = 0.8;
          return;
        }
        if (m.t < WATCHER.lock) return;
        api.strike(sim, {
          shape: 'line',
          x: m.x,
          y: m.y,
          r: Math.min(WATCHER.len, clearDist(sim, api, m.x, m.y, toHero, WATCHER.len)),
          w: 0.42,
          ang: toHero,
          warn: WATCHER.warn,
          dmg: m.dmg,
          knock: 3,
          status: 'burn',
          dur: 1,
          art: 'f15_beam',
          above: true,
          los: true,
          from: m.id,
        });
        api.setMode(m, 'f15_fire');
        return;
      }
      case 'f15_fire':
        g.k = 1;
        if (m.t > WATCHER.warn + 0.15) api.setMode(m, 'f15_blink');
        return;
      case 'f15_blink':
        g.k = 0;
        g.lock = 0;
        if (m.t > WATCHER.blink) {
          m.cd = 0.5;
          api.setMode(m, 'f15_scan');
        }
        return;
      default:
        api.setMode(m, 'f15_scan');
    }
  },
  onHit(sim, m) {
    return m.mode === 'f15_blink' ? 2 : 0.45;
  },
  onDeath(sim, m) {
    const gz = GAZE.get(m);
    if (gz) gz.life = 0;
    postDead(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Подражатель: гончая. Прыжок по линии оставляет лужу желчи; промахнулся —
// тут же прицел заново и второй прыжок («копия помнит движение дважды»).
// ---------------------------------------------------------------------------

export const MHOUND = { aim: 0.45, echo: 0.32, speed: 10, max: 3.6 };

registerBrain('f15_mhound', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const busy = sim.mobs.some(
          (o) => o !== m && o.kind === 'f15_mhound' && (o.mode === 'aim' || o.mode === 'pounce') && hypot(o.x - m.x, o.y - m.y) < 7,
        );
        if (
          dist > 1.5 &&
          dist < MHOUND.max &&
          m.cd <= 0 &&
          !busy &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y) &&
          clearLine(sim, api, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(dy, dx);
          m.data.echo = 0;
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const side = m.id % 2 ? 1 : -1;
        const a0 = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.7;
        const R = dist > 7 ? 0 : 2.6;
        const [cx, cy] = api.chaseDir(sim, m, h.x + Math.cos(a0) * R, h.y + Math.sin(a0) * R);
        api.steer(sim, m, cx, cy, m.speed * (dist < 2.6 ? 0.7 : 1), dt);
        return;
      }
      case 'aim': {
        const T = m.data.echo ? MHOUND.echo : MHOUND.aim;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(MHOUND.max + 0.6, clearDist(sim, api, m.x, m.y, m.dir, MHOUND.max + 0.6));
        m.data.len2 = len;
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.2) m.danger = len + 0.6;
        if (m.t >= T) {
          m.data.hit = 0;
          m.data.run = 0;
          api.setMode(m, 'pounce');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        }
        return;
      }
      case 'pounce': {
        const s = MHOUND.speed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.18 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 3.5, m.kind, { kind: 'poison', dur: 1 });
        }
        if (m.data.run >= (m.data.len2 ?? MHOUND.max) || m.t > 0.6) {
          // Лужа желчи там, где приземлилась.
          api.zone(sim, {
            x: m.x,
            y: m.y,
            r: 0.75,
            life: 3,
            warn: 0.15,
            dps: 0.015,
            status: 'poison',
            dur: 1,
            art: 'f15_bilepool',
          });
          if (!m.data.hit && !m.data.echo && !heroDown(sim)) {
            m.data.echo = 1;
            m.dir = Math.atan2(h.y - m.y, h.x - m.x);
            api.setMode(m, 'aim');
            return;
          }
          api.setMode(m, 'recover');
          m.cd = 2.2 + sim.rng() * 1.2;
        }
        return;
      }
      case 'windup': {
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t > def.windup - 0.2) m.danger = def.reach + m.r + h.r + 0.4;
        if (m.t < def.windup) return;
        if (dist < def.reach + m.r + h.r + 0.18 && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 2.2, m.kind);
        m.vx += Math.cos(m.face) * 3;
        m.vy += Math.sin(m.face) * 3;
        api.setMode(m, 'recover');
        m.data.bcd = def.rest * (0.8 + sim.rng() * 0.4);
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.55);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Подражатель: саламандра. У сока ныряет (недосягаема), выныривает у
// берега рядом с героем — круг, куда выпрыгнет, — и прыгает. Вдали от
// сока плюётся желчью навесом (лужа там, где лёг плевок).
// ---------------------------------------------------------------------------

export const MSALA = { rise: 0.72, riseR: 0.95, lunge: 3.2, lungeSpeed: 9, spit: 0.7, diveCd: 4.5, swims: 2 };

const isAcid = (sim: Sim, x: number, y: number) => markAt(sim, Math.floor(x), Math.floor(y)) === M.acid;

function acidNear(sim: Sim, x: number, y: number, r: number, score: (cx: number, cy: number) => number): [number, number] | null {
  let best: [number, number] | null = null;
  let bs = Infinity;
  for (let yy = Math.floor(y - r); yy <= Math.floor(y + r); yy++)
    for (let xx = Math.floor(x - r); xx <= Math.floor(x + r); xx++) {
      if (!isAcid(sim, xx, yy)) continue;
      const s = score(xx + 0.5, yy + 0.5);
      if (s < bs) {
        bs = s;
        best = [xx + 0.5, yy + 0.5];
      }
    }
  return best;
}

function swimTo(sim: Sim, m: Mob, tx: number, ty: number, speed: number, dt: number, api: SimApi): void {
  const l = hypot(tx - m.x, ty - m.y);
  if (l < 0.12) {
    m.vx *= 0.7;
    m.vy *= 0.7;
    return;
  }
  api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, speed * Math.min(1, l * 1.6), dt);
  const ahead = 0.14 + m.r * 0.8;
  if (m.vx && !isAcid(sim, m.x + Math.sign(m.vx) * ahead, m.y)) m.vx = 0;
  if (m.vy && !isAcid(sim, m.x, m.y + Math.sign(m.vy) * ahead)) m.vy = 0;
}

registerBrain('f15_msala', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    m.data.diveCd = (m.data.diveCd ?? 1.5) - dt;
    const wet = isAcid(sim, m.x, m.y);
    // Нырков за жизнь — не больше MSALA.swims (сведение v2.83.1): иначе цикл
    // «вынырнула — укусила — нырнула» делал её неуязвимой навсегда, и бот
    // на Т8+5 гиб в Чреве, убив три саламандры из десятков.
    const swims = m.data.swims ?? 0;
    if (wet && swims < MSALA.swims && ['chase', 'recover', 'windup', 'aim', 'f15_spit'].includes(m.mode)) {
      api.setMode(m, 'f15_swim');
      m.data.swims = swims + 1;
      m.data.ghost = 1;
    }
    switch (m.mode) {
      case 'chase': {
        m.data.ghost = 0;
        if ((m.data.swims ?? 0) < MSALA.swims && m.data.diveCd <= 0 && (m.hp < m.maxHp * 0.7 || dist > 3.6)) {
          const lv = acidNear(sim, m.x, m.y, 2, (cx, cy) => hypot(cx - m.x, cy - m.y));
          if (lv && hypot(lv[0] - m.x, lv[1] - m.y) < 1.8) {
            m.data.tx = lv[0];
            m.data.ty = lv[1];
            api.setMode(m, 'f15_slide');
            return;
          }
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist > 1.8 && dist < MSALA.lunge + 0.8 && m.cd <= 0 && clearLine(sim, api, m.x, m.y, h.x, h.y)) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Далеко — плевок желчью навесом.
        if (see && dist > 4 && dist < 8 && m.cd <= 0) {
          api.setMode(m, 'f15_spit');
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 7 + m.id) * 0.35;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * (0.75 + 0.45 * Math.max(0, Math.sin(sim.time * 11 + m.id))), dt);
        return;
      }
      case 'f15_spit': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        if (m.t < MSALA.spit) return;
        api.shoot(sim, m, Math.atan2(dy, dx), undefined, h.x, h.y);
        api.setMode(m, 'recover');
        m.cd = def.rest * 2.4;
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > def.windup - 0.2) m.danger = def.reach + m.r + h.r + 0.4;
        if (m.t < def.windup) return;
        if (dist < def.reach + m.r + h.r + 0.2 && canHurt(sim))
          api.hurtHero(sim, m.dmg, m.x, m.y, 2.5, m.kind, { kind: 'poison', dur: 1 });
        api.setMode(m, 'recover');
        m.data.bcd = def.rest;
        return;
      }
      case 'aim': {
        const T = 0.55;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(MSALA.lunge, clearDist(sim, api, m.x, m.y, m.dir, MSALA.lunge));
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.22) m.danger = MSALA.lunge + 0.4;
        if (m.t >= T) {
          m.data.hit = 0;
          m.data.len = len;
          api.setMode(m, 'f15_lunge');
        }
        return;
      }
      case 'f15_lunge': {
        const s = MSALA.lungeSpeed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.15 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 5, m.kind, { kind: 'poison', dur: 1.2 });
        }
        if (m.t > (m.data.len ?? MSALA.lunge) / s) {
          api.setMode(m, 'recover');
          m.cd = def.rest * 2.2;
        }
        return;
      }
      case 'f15_slide': {
        const tx = m.data.tx - m.x;
        const ty = m.data.ty - m.y;
        const l = hypot(tx, ty);
        api.steer(sim, m, tx / (l || 1), ty / (l || 1), m.speed * 1.4, dt);
        if (m.t > 0.25) m.data.ghost = 1;
        if (m.t > 0.4 || l < 0.2) {
          api.setMode(m, 'f15_swim');
          m.data.swims = (m.data.swims ?? 0) + 1;
          m.data.ghost = 1;
          sim.events.push({ t: 'boss', what: 'f15_dive' });
        }
        return;
      }
      case 'f15_swim': {
        m.data.ghost = 1;
        if (!isAcid(sim, m.x, m.y)) {
          const back = acidNear(sim, m.x, m.y, 3, (cx, cy) => hypot(cx - m.x, cy - m.y));
          if (back) {
            const l = hypot(back[0] - m.x, back[1] - m.y) || 1;
            m.vx = ((back[0] - m.x) / l) * 3;
            m.vy = ((back[1] - m.y) / l) * 3;
            return;
          }
          // Сока нет — выходит на берег.
          m.data.ghost = 0;
          api.setMode(m, 'chase');
          return;
        }
        m.data.re = (m.data.re ?? 0) - dt;
        if (m.data.re <= 0) {
          m.data.re = 0.3;
          const t = heroDown(sim)
            ? null
            : acidNear(sim, m.x, m.y, 7, (cx, cy) => hypot(cx - h.x, cy - h.y) + hypot(cx - m.x, cy - m.y) * 0.15);
          m.data.tx = t ? t[0] : m.x;
          m.data.ty = t ? t[1] : m.y;
          m.data.far = t ? hypot(t[0] - h.x, t[1] - h.y) : 99;
        }
        swimTo(sim, m, m.data.tx, m.data.ty, m.speed * 1.15, dt, api);
        const at = hypot(m.data.tx - m.x, m.data.ty - m.y) < 0.9;
        if (!heroDown(sim) && at && m.data.far < 2.6 && m.cd <= 0 && m.t > 0.8) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          m.data.walk = 0;
          api.setMode(m, 'f15_rise');
          return;
        }
        if (m.t > 4 && m.data.far > 5 && !heroDown(sim)) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          m.data.walk = 1;
          api.setMode(m, 'f15_rise');
        }
        return;
      }
      case 'f15_rise': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const T = MSALA.rise;
        if (m.t < 0.3 && !m.data.walk) {
          m.data.gx = h.x;
          m.data.gy = h.y;
        }
        m.data.ghost = m.t < T - 0.12 ? 1 : 0;
        m.face = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
        if (!m.data.walk) {
          m.tele = { shape: 'circle', r: MSALA.riseR, k: Math.min(1, m.t / T), x: m.data.gx, y: m.data.gy };
          if (m.t > T - 0.25 && hypot(h.x - m.data.gx, h.y - m.data.gy) < MSALA.riseR + h.r) m.danger = dist + 0.6;
        }
        if (m.t >= T) {
          m.data.ghost = 0;
          m.data.hit = 0;
          const a = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
          m.dir = a;
          m.data.len = Math.min(3, hypot(m.data.gx - m.x, m.data.gy - m.y));
          api.setMode(m, m.data.walk ? 'chase' : 'f15_leap');
          m.data.diveCd = MSALA.diveCd;
          sim.events.push({ t: 'boss', what: 'f15_splash' });
        }
        return;
      }
      case 'f15_leap': {
        const T = 0.26;
        const s = (m.data.len ?? 2) / T;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.2 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 4, m.kind, { kind: 'poison', dur: 1.5 });
        }
        if (m.t >= T) {
          api.setMode(m, 'recover');
          m.cd = def.rest * 1.8;
        }
        return;
      }
      case 'recover':
        m.data.ghost = 0;
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Подражатель: латник. Костяной щит спереди (удар отбит; тяжёлый — щит
// трескается, два — сломан на 10 с). Таран щитом по линии, после тарана
// стоит открытым — бей в спину.
// ---------------------------------------------------------------------------

export const MKNIGHT = { aim: 0.62, bash: 3.4, speed: 8, open: 1.25, shield: 2, regrow: 10, front: 1.15 };

registerBrain('f15_mknight', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    // Щит отрастает.
    if (m.data.broken && sim.time > (m.data.regrow ?? 0)) {
      m.data.broken = 0;
      m.data.cracks = 0;
    }
    switch (m.mode) {
      case 'f15_guard': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.face = Math.atan2(dy, dx);
        if (dist < 8 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) api.setMode(m, 'chase');
        return;
      }
      case 'chase': {
        // Щитом к герою: поворачивается медленно.
        const want = Math.atan2(dy, dx);
        m.face += Math.max(-dt * 3, Math.min(dt * 3, angDiff(want, m.face)));
        if (dist > 2 && dist < MKNIGHT.bash + 0.8 && m.cd <= 0 && clearLine(sim, api, m.x, m.y, h.x, h.y)) {
          m.dir = want;
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r + 0.1 && m.data.bcd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const v = m.speed;
        m.vx += (cx * v - m.vx) * Math.min(1, dt * 8);
        m.vy += (cy * v - m.vy) * Math.min(1, dt * 8);
        return;
      }
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < MKNIGHT.aim * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(MKNIGHT.bash, clearDist(sim, api, m.x, m.y, m.dir, MKNIGHT.bash));
        m.data.len = len;
        m.tele = { shape: 'line', r: len, w: 0.45, ang: m.dir, k: Math.min(1, m.t / MKNIGHT.aim) };
        if (m.t > MKNIGHT.aim - 0.22) m.danger = len + 0.5;
        if (m.t >= MKNIGHT.aim) {
          m.data.hit = 0;
          m.data.run = 0;
          api.setMode(m, 'f15_bash');
        }
        return;
      }
      case 'f15_bash': {
        const s = MKNIGHT.speed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 0.6;
        if (!m.data.hit && dist < m.r + h.r + 0.2 && canHurt(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.1, m.x, m.y, 6, m.kind, { kind: 'stun', dur: 0.3 });
        }
        if (m.data.run >= (m.data.len ?? MKNIGHT.bash) || m.t > 0.6) {
          api.setMode(m, 'f15_open');
          m.cd = def.rest * 2.4;
        }
        return;
      }
      case 'f15_open':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > MKNIGHT.open) api.setMode(m, 'chase');
        return;
      case 'windup': {
        m.vx *= 0.75;
        m.vy *= 0.75;
        m.face = Math.atan2(dy, dx);
        if (m.t > def.windup - 0.2) m.danger = def.reach + m.r + h.r + 0.4;
        if (m.t < def.windup) return;
        if (dist < def.reach + m.r + h.r + 0.2 && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 3, m.kind);
        api.setMode(m, 'recover');
        m.data.bcd = def.rest;
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit) {
    if (m.mode === 'f15_open') return 1.6;
    // Щит — спереди: герой стоит там, куда моб смотрит.
    const front = Math.abs(angDiff(hit.ang + Math.PI, m.face)) < MKNIGHT.front;
    if (!front) return 1.3;
    if (m.data.broken) return 1;
    if (hit.heavy) {
      m.data.cracks = (m.data.cracks ?? 0) + 1;
      if (m.data.cracks >= MKNIGHT.shield) {
        m.data.broken = 1;
        m.data.regrow = sim.time + MKNIGHT.regrow;
        sim.events.push({ t: 'boss', what: 'f15_shield_stone', text: 'ЩИТ ТРЕСНУЛ' });
        return 0.5;
      }
      return 0.15;
    }
    return 0;
  },
  onDeath(sim, m) {
    postDead(sim, m.data.post);
  },
});

// ---------------------------------------------------------------------------
// Златожил (редкий): удирает по венам, от ударов сыплет монеты. Не догнал
// за 14 с — ушёл в стену.
// ---------------------------------------------------------------------------

registerBrain('f15_gold', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.age = (m.data.age ?? 0) + dt;
    if (m.data.age > 14 || heroDown(sim)) {
      if (m.mode !== 'escape') {
        m.hp = 0;
        api.setMode(m, 'escape');
        sim.events.push({ t: 'boss', what: 'f15_gold_call', text: 'ЗЛАТОЖИЛ УШЁЛ В СТЕНУ' });
      }
      return;
    }
    const away = api.flowDir(sim, m.x, m.y, true);
    let [cx, cy] = away ?? [m.x - h.x, m.y - h.y];
    const l = hypot(cx, cy) || 1;
    cx /= l;
    cy /= l;
    const z = Math.sin(sim.time * 10 + m.id) * 0.4;
    api.steer(sim, m, cx - cy * z, cy + cx * z, m.speed * (dist < 5 ? 1 : 0.6), dt);
  },
  onHit(sim, m, hit, api) {
    api.dropAt(sim, 'coin', 90, m.x, m.y);
    void hit;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Органы: мешок-рождение, миндалина, матка выводка.
// ---------------------------------------------------------------------------

export const SAC = { near: 3.6, noise: 0.07, base: 0.035, brood: 0.05, burst: 0.7, larvae: 3 };

registerBrain('f15_sac', {
  step(sim, m, dt, c, api) {
    const { dist } = c;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.x = m.hx;
    m.y = m.hy;
    m.tele = null;
    m.danger = 0;
    const st = STATE.get(sim);
    if (m.mode === 'f15_burst') {
      m.tele = { shape: 'circle', r: 1.2, k: Math.min(1, m.t / SAC.burst) };
      if (m.t < SAC.burst) return;
      m.data.burst = 1;
      const n = SAC.larvae + (m.elite ? 2 : 0);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + sim.rng();
        const q = openNear(sim, m.x + Math.cos(a) * 0.6, m.y + Math.sin(a) * 0.6) ?? [m.x, m.y];
        const o = api.spawnMob(sim, 'f15_larva', q[0], q[1], { mode: 'stun' });
        api.collide(sim, o);
      }
      if (sim.rng() < 0.25) {
        const q = openNear(sim, m.x, m.y + 0.5) ?? [m.x, m.y + 0.5];
        const o = api.spawnMob(sim, mimicFor(sim, m.x, m.y), q[0], q[1], { mode: 'stun' });
        api.collide(sim, o);
      }
      sim.events.push({ t: 'boss', what: 'f15_burst' });
      sim.events.push({ t: 'emerge', x: m.x, y: m.y });
      hurtMob(sim, api, m, m.maxHp * 10);
      return;
    }
    // Набухает: от шума героя рядом, от близости, в Выводке — само.
    let s = m.data.s ?? 0;
    const near = dist < SAC.near ? 1 : 0;
    const loud = st && dist < 7 ? st.noise * SAC.noise : 0;
    s += dt * (near * 0.12 + loud + (f15BroodOn(sim) && dist < 14 ? SAC.brood : 0));
    if (dist > 16) s = Math.max(0, s - dt * 0.05);
    m.data.s = s;
    if (s >= 1) api.setMode(m, 'f15_burst');
  },
  onHit(sim, m) {
    addAlien(sim, 3);
    // Удар будит — мешок набухает быстрее.
    m.data.s = (m.data.s ?? 0) + 0.12;
    return 1;
  },
  onDeath(sim, m, mode, api) {
    // Не успел лопнуть, но почти — одна личинка вырвалась.
    if (!m.data.burst && !m.data.wither && (m.data.s ?? 0) > 0.55) {
      const q = openNear(sim, m.x, m.y + 0.3) ?? [m.x, m.y + 0.3];
      const o = api.spawnMob(sim, 'f15_larva', q[0], q[1], { mode: 'stun' });
      api.collide(sim, o);
    }
    postDead(sim, m.data.post);
    void mode;
  },
});

export const TONSIL = { kids: 4, every: 4.6, spit: 3.4, aim: 0.7 };

registerBrain('f15_tonsil', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.x = m.hx;
    m.y = m.hy;
    m.tele = null;
    m.danger = 0;
    const st = STATE.get(sim);
    if (!st || st.tonsils.state !== 'on') return;
    m.face = Math.atan2(dy, dx);
    // Рожает антитела.
    m.data.kidT = (m.data.kidT ?? 1.5) - dt;
    if (m.data.kidT <= 0) {
      m.data.kidT = TONSIL.every;
      const kids = sim.mobs.filter((o) => o.data.tonsil === m.id && o.mode !== 'dying').length;
      if (kids < TONSIL.kids) {
        const sp = spotNear(sim, api, m.x, m.y, 1, 1.8, h);
        if (sp) {
          const o = api.spawnMob(sim, 'f15_mob', sp[0], sp[1], { mode: 'stun' });
          o.data.tonsil = m.id;
          sim.events.push({ t: 'emerge', x: sp[0], y: sp[1] });
        }
      }
    }
    // Плюётся слизью навесом (замедляет).
    switch (m.mode) {
      case 'f15_spit':
        if (m.t < TONSIL.aim) return;
        api.shoot(sim, m, Math.atan2(dy, dx), undefined, h.x, h.y);
        api.setMode(m, 'f15_idle');
        m.cd = TONSIL.spit;
        return;
      default:
        if (m.cd <= 0 && dist < 8 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) api.setMode(m, 'f15_spit');
    }
  },
  onDeath(sim, m) {
    postDead(sim, m.data.post);
    for (const o of sim.mobs) if (o.data.tonsil === m.id) o.data.tonsil = 0;
  },
});

export const MATRON = { lay: 7, sacs: 9, slamR: 2.2, slamWarn: 1 };

registerBrain('f15_matron', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist } = c;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.x = m.hx;
    m.y = m.hy;
    m.tele = null;
    m.danger = 0;
    if (!f15BroodOn(sim)) return;
    // Откладывает мешки вокруг себя.
    m.data.lay = (m.data.lay ?? 3) - dt;
    if (m.data.lay <= 0) {
      m.data.lay = MATRON.lay;
      const sacs = sim.mobs.filter((o) => o.kind === 'f15_sac' && o.mode !== 'dying' && hypot(o.x - m.x, o.y - m.y) < 14).length;
      if (sacs < MATRON.sacs) {
        const sp = spotNear(sim, api, m.x, m.y, 2, 4.5, h);
        if (sp) {
          const o = api.spawnMob(sim, 'f15_sac', sp[0], sp[1], { mode: 'f15_idle' });
          o.data.s = 0.25;
          sim.events.push({ t: 'emerge', x: sp[0], y: sp[1] });
          sim.events.push({ t: 'boss', what: 'f15_lay' });
        }
      }
    }
    // Хлещет щупальцами кольцом, если подошли вплотную.
    switch (m.mode) {
      case 'f15_slam':
        m.tele = { shape: 'circle', r: MATRON.slamR, k: Math.min(1, m.t / MATRON.slamWarn) };
        if (m.t > MATRON.slamWarn - 0.25) m.danger = MATRON.slamR + 0.3;
        if (m.t < MATRON.slamWarn) return;
        if (dist < MATRON.slamR + h.r && canHurt(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 7, m.kind);
        api.setMode(m, 'f15_idle');
        m.cd = 2.2;
        return;
      default:
        if (m.cd <= 0 && dist < MATRON.slamR + 0.6) api.setMode(m, 'f15_slam');
    }
  },
  onHit(sim, m) {
    return m.mode === 'f15_slam' ? 1 : 1.15;
  },
  onDeath(sim, m) {
    postDead(sim, m.data.post);
  },
});
