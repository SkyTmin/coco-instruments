// Этаж 7 «Зеркальный лабиринт» — ИИ монстров, правила этажа и сценарий
// Отражения героя. Движок не импортируется значениями (круг модулей): всё,
// что нужно, приходит в `api`; номера клеток `Tile` повторены ниже (тест
// сверяет их с движком).
//
// Правила этажа (`registerFloor(7)`):
//   • ЗЕРКАЛА РОЖАЮТ. В зеркале на стене сперва видно фигуру, которая идёт
//     к стеклу изнутри (метка `f7_birth`, 1,1 с), потом она выходит на пол и
//     полсекунды недосягаема. Из зеркал выходят отражения и копии, в
//     хрустале — ещё и призмы;
//   • ЛОЖНЫЕ ПРОХОДЫ. Зеркало в конце тупика отражает коридор — выглядит
//     проходом. Упёрся — зеркало трескается со звоном, иногда из трещины
//     выходит отражение. Иллюзия наоборот (`illusion`) — пол, нарисованный
//     зеркалом: сквозь неё проходят, за ней тайник;
//   • ЗЕРКАЛА-ПЕРЕХОДЫ. Пара рам одного цвета: постоял в раме — вспышка в
//     парной раме, и герой там (`moveHero`);
//   • ПУСТЫЕ РАМЫ. Подошёл — рама дрожит, из неё выходит тень. Тень держится
//     рамы: ушёл далеко — вернулась в раму. Разбил раму — тень умерла;
//   • НИТИ. Осколочные пауки натягивают стеклянные нити поперёк узких
//     проходов: задел — режет, нить лопается, пауки падают сверху;
//   • КОКОНЫ. У кокона вылупляются зеркальные бабочки;
//   • СОБЫТИЯ: Зал большого зеркала (разбил — за ним тайник, из осколков
//     лезут отражения), Зал призм (хрусталь запирает выходы, пока призмы
//     целы), Коридор отражений (твоё отражение отстаёт и выходит к тебе);
//   • СТЕКОЛЬЩИК-ВОРИШКА с мешком монет выходит из зеркала раз в несколько
//     минут и удирает сквозь зеркала.
//
// Честность: всё, что бьёт, видно заранее — метки ударов и копий, круг
// вспышки, метка прыжка паука, ломаная луча призмы, линии осколков арены.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { HeroState, Mob, Prop, Sim } from '../dungeon-sim';
import type { Light } from '../dungeon-world';
import { F7_CRYSTAL, F7_GALLERY, F7_HALL, F7_MARK } from './f7';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

/** Клетки движка (`Tile` из `dungeon-world.ts`), повторены: импорт значением замкнул бы модули. */
export const T = { Wall: 1, Floor: 2, Deep: 11, Hazard: 12 } as const;

/** Задержка отражения: столько оно отстаёт от героя, с. */
export const ECHO_LAG = 0.4;
/** Метка рождения из зеркала, с. */
export const BIRTH_WARN = 1.1;
/** Сколько выходящий из зеркала недосягаем, с. */
export const STEP_T = 0.5;
/** Постоять в раме перехода, чтобы она сработала, с. */
export const WARP_DWELL = 0.45;
/** Вспышка бабочки: радиус и замах. */
export const FLASH_R = 2.6;
export const FLASH_T = 0.8;
/** Половина угла «смотрит на» для копий и вспышек. */
export const GAZE = (58 * Math.PI) / 180;

export function angDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

export const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T.Wall;
  return sim.tiles[y * w.w + x];
};

const isMirrorMark = (k: number) =>
  k === F7_MARK.mirror || k === F7_MARK.arena || k === F7_MARK.fake;

/** Смотрит ли герой на точку (конус взгляда). */
export function heroSees(sim: Sim, x: number, y: number, half = GAZE): boolean {
  const h = sim.hero;
  const dx = x - h.x;
  const dy = y - h.y;
  if (hypot(dx, dy) < 0.4) return true;
  return Math.abs(angDiff(Math.atan2(dy, dx), h.face)) < half;
}

/** Задевает ли линия (из точки по углу, длина, полуширина) круг героя. */
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

/** Попадает ли конус из точки в героя. */
function coneHits(
  x: number,
  y: number,
  ang: number,
  r: number,
  arc: number,
  h: HeroState,
): boolean {
  const dx = h.x - x;
  const dy = h.y - y;
  const d = hypot(dx, dy);
  if (d > r + h.r) return false;
  const off = Math.abs(angDiff(Math.atan2(dy, dx), ang));
  return off < arc / 2 + (d > 0.01 ? Math.atan(h.r / d) : Math.PI);
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

/** Герой не под ударом: в рывке неуязвим. */
const heroOpen = (h: HeroState) => h.inv <= 0 && h.mode !== 'dash';

/**
 * Пути к герою нет в поле расстояний (соседний коридор лабиринта: обход
 * длиннее поля) и героя не видно — не давить в хрустальную стену, а
 * побрести домой и ждать. Иначе стая стоит, упёршись в стену, и это видно.
 */
function lost(sim: Sim, m: Mob, api: SimApi, dt: number, dist: number): boolean {
  if (dist < 1.5) return false;
  const f = sim.flow[Math.floor(m.y) * sim.world.w + Math.floor(m.x)];
  if (f >= 0) return false;
  if (api.lineOfSight(sim, m.x, m.y, sim.hero.x, sim.hero.y)) return false;
  const hx = m.hx - m.x;
  const hy = m.hy - m.y;
  const d = hypot(hx, hy);
  if (d > 0.8) {
    const [cx, cy] = api.chaseDir(sim, m, m.hx, m.hy);
    api.steer(sim, m, cx, cy, m.speed * 0.45, dt);
  } else {
    m.vx *= 0.8;
    m.vy *= 0.8;
  }
  return true;
}

/** Выход из зеркала: недосягаем, стоит, потом в бой. */
function stepOut(m: Mob, api: SimApi, next = 'chase'): boolean {
  if (m.mode !== 'f7_step') return false;
  m.data.ghost = 1;
  m.vx *= 0.6;
  m.vy *= 0.6;
  m.tele = null;
  m.danger = 0;
  if (m.t >= STEP_T) {
    m.data.ghost = 0;
    api.setMode(m, next);
    m.cd = 0.4;
  }
  return true;
}

/** Укус с замахом движка (конус рисует движок): общий для простых ударов. */
function biteStep(sim: Sim, m: Mob, c: BrainCtx, api: SimApi, k = 1, push = 2.5): void {
  const h = sim.hero;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t < c.def.windup) return;
  const reach = c.def.reach + m.r + h.r + 0.18;
  if (c.dist < reach && heroOpen(h)) api.hurtHero(sim, m.dmg * k, m.x, m.y, push, m.kind);
  m.vx += Math.cos(m.face) * 3;
  m.vy += Math.sin(m.face) * 3;
  api.setMode(m, 'recover');
  m.cd = c.def.rest * (0.8 + sim.rng() * 0.4);
}

// ---------------------------------------------------------------------------
// Общее вью-состояние для рисовальщиков (`f7-art.ts`): предметам этажа не
// видно симуляции, а большое зеркало, рамы и отстающее отражение обязаны
// знать, что с ними.
// ---------------------------------------------------------------------------

export const F7_VIEW = {
  /** Большое зеркало: сколько ударов принято (0…6), разбито ли. */
  bigHits: 0,
  bigBroken: false,
  /** Рамы: id предмета (`obj.id`) → 0 пуста, 1 дрожит, 2 тень снаружи, 3 остывает. */
  frames: new Map<string, number>(),
  /** Коконы: id → когда вылупились в последний раз (время симуляции). */
  cocoons: new Map<string, number>(),
  /** Переходы: пара (1…4) → заряд 0…1 (для свечения рамы). */
  warp: [0, 0, 0, 0, 0],
  /** Отставшее отражение: мировая x, где оно замерло, и сколько стоит. */
  lagX: -1,
  lagY: -1,
  lagT: 0,
  /** Бой с отражением: фаза (−1 — боя нет). */
  bossPhase: -1,
  /** Время симуляции (для живых предметов, которым нужно «сейчас»). */
  time: 0,
};

// ---------------------------------------------------------------------------
// Состояние этажа.
// ---------------------------------------------------------------------------

interface MirrorSpot {
  x: number;
  y: number;
  /** Клетка пола под зеркалом, куда выходят. */
  ox: number;
  oy: number;
  ready: number;
  area: string;
}

interface Birth {
  t: number;
  kind: string;
  spot: MirrorSpot;
  elite: boolean;
  /** Кого перенести (воришка ныряет), 0 — новый. */
  mob: number;
}

interface FrameSt {
  prop: Prop;
  state: 'armed' | 'stir' | 'out' | 'cool';
  t: number;
  mob: number;
}

interface Thread {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  broken: boolean;
  at: number;
  zone: number;
  cx: number;
  cy: number;
}

interface PortalEnd {
  pair: number;
  x: number;
  y: number;
}

interface HistPt {
  t: number;
  x: number;
  y: number;
  face: number;
}

interface Pending {
  t: number;
  x: number;
  y: number;
  n: number;
  dmg: number;
  kind: string;
}

interface F7State {
  mirrors: MirrorSpot[];
  births: Birth[];
  birthT: number;
  hist: HistPt[];
  frames: FrameSt[];
  threads: Thread[];
  cocoons: Prop[];
  portals: PortalEnd[];
  warpT: number;
  warpFrom: number;
  warpLock: number;
  big: Prop | null;
  bigState: 'intact' | 'broken' | 'waves' | 'done';
  bigT: number;
  bigWave: number;
  bigMobs: number[];
  hall: { cx: number; cy: number; seams: number[]; stands: Prop[] } | null;
  hallState: 'idle' | 'warn' | 'closed' | 'done';
  hallT: number;
  hallMobs: number[];
  corridor: { y0: number; y1: number; face: number; x0: number; x1: number } | null;
  corridorDone: boolean;
  thiefT: number;
  bursts: Pending[];
  zones: Map<string, number>;
  zoneT: number;
  cracked: Set<number>;
  illusionSaid: boolean;
  lights: Light[];
  arenaLights: { i: number; r: number; tint: Light['tint'] }[];
  arenaCenter: number;
  arena: { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } | null;
  arenaMirrors: number[];
  scars: number[];
  lightPhase: number;
}

const STATE = new WeakMap<Sim, F7State>();

/** Полы комнат этажа — для букв движка, у которых своей метки нет. */
const ROOM_MARKS: ReadonlySet<number> = new Set<number>([
  F7_MARK.checker,
  F7_MARK.carpet,
  F7_MARK.glass,
  F7_MARK.mosaic,
  F7_MARK.herring,
  F7_MARK.obsidian,
  F7_MARK.hex,
  F7_MARK.rough,
  F7_MARK.plank,
  F7_MARK.under,
]);

/**
 * Буквы движка (логово, таблички, тайники, засады, лестница) лежат на полу
 * без метки, и рисовальщик района до них не доходит: посреди паркета или
 * мозаики вставала клетка серого пола. Даём им метку «пол под предметом» —
 * узор возьмётся у соседей. Метки живут в мире вылазки, карта не меняется.
 */
function fillLetterFloors(sim: Sim): void {
  const w = sim.world;
  for (let y = 1; y < w.h - 1; y++)
    for (let x = 1; x < w.w - 1; x++) {
      const i = y * w.w + x;
      if (w.mark[i] || tileAt(sim, x, y) !== T.Floor) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if ((dx || dy) && ROOM_MARKS.has(w.mark[i + dy * w.w + dx])) n++;
      if (n >= 5) w.mark[i] = F7_MARK.under;
    }
}

function scan(sim: Sim, api: SimApi): F7State {
  const w = sim.world;
  fillLetterFloors(sim);
  const mirrors: MirrorSpot[] = [];
  for (let y = 1; y < w.h - 1; y++)
    for (let x = 1; x < w.w - 1; x++) {
      const k = w.mark[y * w.w + x];
      if (k !== F7_MARK.mirror) continue;
      if (tileAt(sim, x, y) !== T.Wall) continue;
      // Выход — на пол под лицом зеркала.
      if (api.solidTile(sim, x, y + 1)) continue;
      mirrors.push({ x, y, ox: x, oy: y + 1, ready: 0, area: w.rowArea[y] });
    }
  const frames: FrameSt[] = [];
  const cocoons: Prop[] = [];
  const portals: PortalEnd[] = [];
  let big: Prop | null = null;
  const stands: Prop[] = [];
  for (const p of sim.props) {
    const ref = p.obj.ref ?? '';
    if (ref === 'f7_frame') frames.push({ prop: p, state: 'armed', t: 0, mob: 0 });
    else if (ref === 'f7_cocoon') cocoons.push(p);
    else if (ref === 'f7_bigmirror') big = p;
    else if (ref === 'f7_prismstand') stands.push(p);
    else if (ref.startsWith('f7_portal'))
      // Встают на знак перед рамой — клеткой ниже самой рамы.
      portals.push({ pair: Number(ref.slice(9)), x: p.x, y: p.y + 1 });
  }
  // Нити: у каждого узла — поперёк узкого прохода, от стены до стены.
  const threads: Thread[] = [];
  for (const p of sim.props) {
    if (p.obj.ref !== 'f7_web') continue;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    const span = (dx: number, dy: number): number => {
      for (let d = 1; d < 6; d++) if (api.solidTile(sim, cx + dx * d, cy + dy * d)) return d;
      return 99;
    };
    const l = span(-1, 0);
    const r = span(1, 0);
    const u = span(0, -1);
    const d = span(0, 1);
    let t: Thread;
    if (l + r <= u + d)
      t = {
        x0: cx - l + 1,
        y0: cy + 0.5,
        x1: cx + r,
        y1: cy + 0.5,
        broken: false,
        at: 0,
        zone: 0,
        cx,
        cy,
      };
    else
      t = {
        x0: cx + 0.5,
        y0: cy - u + 1,
        x1: cx + 0.5,
        y1: cy + d,
        broken: false,
        at: 0,
        zone: 0,
        cx,
        cy,
      };
    threads.push(t);
  }
  // Зал призм: швы у выходов и подставки внутри.
  let hall: F7State['hall'] = null;
  const seams: number[] = [];
  for (let i = 0; i < w.w * w.h; i++) if (w.mark[i] === F7_MARK.seam) seams.push(i);
  if (seams.length && stands.length) {
    let sx = 0;
    let sy = 0;
    for (const p of stands) {
      sx += p.x;
      sy += p.y;
    }
    hall = { cx: sx / stands.length, cy: sy / stands.length, seams, stands };
  }
  // Коридор отражений: самый длинный ряд зеркал в районе Зала Двойника.
  let corridor: F7State['corridor'] = null;
  let best = 0;
  for (let y = 1; y < w.h - 1; y++) {
    if (w.rowArea[y] !== F7_HALL) continue;
    let n = 0;
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w.w; x++)
      if (w.mark[y * w.w + x] === F7_MARK.mirror && !api.solidTile(sim, x, y + 1)) {
        n++;
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    if (n > best && n > 20) {
      best = n;
      corridor = { y0: y + 1, y1: y + 5, face: y, x0, x1 };
    }
  }
  // Свет — своя копия на вылазку: арена гасит и перекрашивает свои лампы.
  const lights = sim.world.lights.map((l) => ({ ...l }));
  sim.world.lights = lights;
  const b = sim.boss;
  const arenaLights: F7State['arenaLights'] = [];
  let arenaCenter = -1;
  let arena: F7State['arena'] = null;
  const arenaMirrors: number[] = [];
  if (b) {
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1;
    let y1 = -1;
    for (const c of b.cells) {
      const x = c % w.w;
      const y = Math.floor(c / w.w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    arena = { x0, y0, x1, y1, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2 };
    lights.forEach((l, i) => {
      const c = Math.floor(l.y) * w.w + Math.floor(l.x);
      if (!b.cells.has(c)) return;
      arenaLights.push({ i, r: l.r, tint: l.tint });
      if (arenaCenter < 0 || l.r > lights[arenaCenter].r) arenaCenter = i;
    });
    for (let y = y0 - 1; y <= y1 + 1; y++)
      for (let x = x0 - 1; x <= x1 + 1; x++)
        if (markAt(sim, x, y) === F7_MARK.arena) arenaMirrors.push(y * w.w + x);
  }
  return {
    mirrors,
    births: [],
    birthT: 5,
    hist: [],
    frames,
    threads,
    cocoons,
    portals,
    warpT: 0,
    warpFrom: -1,
    warpLock: -1,
    big,
    bigState: 'intact',
    bigT: 0,
    bigWave: 0,
    bigMobs: [],
    hall,
    hallState: 'idle',
    hallT: 0,
    hallMobs: [],
    corridor,
    corridorDone: false,
    thiefT: 150 + sim.rng() * 150,
    bursts: [],
    zones: new Map(),
    zoneT: 0,
    cracked: new Set(),
    illusionSaid: false,
    lights,
    arenaLights,
    arenaCenter,
    arena,
    arenaMirrors,
    scars: [],
    lightPhase: -1,
  };
}

function stateOf(sim: Sim, api: SimApi): F7State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim, api);
    STATE.set(sim, st);
  }
  return st;
}

/** Для тестов и рисовальщиков. */
export const f7State = (sim: Sim): F7State | undefined => STATE.get(sim);

// ---------------------------------------------------------------------------
// Рождение из зеркала.
// ---------------------------------------------------------------------------

/** Кто выходит из зеркала в районе. */
function mirrorKind(sim: Sim, area: string): string {
  const list: [string, number][] =
    area === F7_CRYSTAL
      ? [
          ['f7_echo', 45],
          ['f7_prism', 35],
          ['f7_phantom', 20],
        ]
      : area === F7_HALL
        ? [
            ['f7_echo', 55],
            ['f7_phantom', 45],
          ]
        : [
            ['f7_echo', 62],
            ['f7_phantom', 38],
          ];
  let total = 0;
  for (const [, wgt] of list) total += wgt;
  let r = sim.rng() * total;
  for (const [k, wgt] of list) {
    r -= wgt;
    if (r <= 0) return k;
  }
  return list[0][0];
}

/** Зеркало рядом с героем: `minD…maxD` клеток, выход достижим. */
function pickMirror(
  sim: Sim,
  api: SimApi,
  minD: number,
  maxD: number,
  from?: { x: number; y: number },
): MirrorSpot | null {
  const st = stateOf(sim, api);
  const h = from ?? sim.hero;
  let total = 0;
  const cand: [MirrorSpot, number][] = [];
  for (const s of st.mirrors) {
    if (s.ready > sim.time) continue;
    if (markAt(sim, s.x, s.y) !== F7_MARK.mirror) continue;
    const d = hypot(s.ox + 0.5 - h.x, s.oy + 0.5 - h.y);
    if (d < minD || d > maxD) continue;
    if (api.inArena(sim, s.ox + 0.5, s.oy + 0.5)) continue;
    if (sim.safe.some((q) => hypot(q.x - s.ox, q.y - s.oy) < 10)) continue;
    const fl = sim.flow[s.oy * sim.world.w + s.ox];
    if (fl < 0 || fl > maxD * 1.8) continue;
    const wgt = api.lineOfSight(sim, sim.hero.x, sim.hero.y, s.ox + 0.5, s.oy + 0.5) ? 3 : 1;
    cand.push([s, wgt]);
    total += wgt;
  }
  if (!cand.length) return null;
  let r = sim.rng() * total;
  for (const [s, wgt] of cand) {
    r -= wgt;
    if (r <= 0) return s;
  }
  return cand[cand.length - 1][0];
}

/** Фигура в зеркале: через `BIRTH_WARN` она выйдет на пол. */
function startBirth(
  sim: Sim,
  api: SimApi,
  spot: MirrorSpot,
  kind: string,
  opts: { elite?: boolean; mob?: number; warn?: number } = {},
): void {
  const st = stateOf(sim, api);
  const warn = opts.warn ?? BIRTH_WARN;
  spot.ready = sim.time + 18;
  st.births.push({ t: warn, kind, spot, elite: !!opts.elite, mob: opts.mob ?? 0 });
  const z: ZoneIn & { kind: string; mx: number; my: number } = {
    x: spot.x + 0.5,
    y: spot.y + 0.5,
    r: 0.5,
    life: warn + 0.4,
    art: kind === 'f7_thief' && opts.mob ? 'f7_ripple' : 'f7_birth',
    kind,
    mx: spot.x,
    my: spot.y,
  };
  api.zone(sim, z);
}

/** Выход из зеркала (в миг, когда метка догорела). */
function finishBirth(sim: Sim, api: SimApi, b: Birth): Mob | null {
  const { spot } = b;
  let m: Mob | undefined;
  if (b.mob) {
    m = sim.mobs.find((x) => x.id === b.mob && x.mode !== 'dying');
    if (m) {
      m.x = spot.ox + 0.5;
      m.y = spot.oy + 0.5;
      m.vx = 0;
      m.vy = 1.5;
      api.setMode(m, 'f7_step');
    }
  } else
    m = api.spawnMob(sim, b.kind, spot.ox + 0.5, spot.oy + 0.35, {
      mode: 'f7_step',
      elite: b.elite,
    });
  if (!m) return null;
  // Шагает из стекла на пол.
  const ex = spot.ox - spot.x;
  const ey = spot.oy - spot.y;
  const el = hypot(ex, ey) || 1;
  m.face = el > 0.1 ? Math.atan2(ey, ex) : Math.PI / 2;
  m.vx = (ex / el) * 1.4;
  m.vy = (ey / el) * 1.4 || 1.4;
  m.data.ghost = 1;
  m.data.mx = spot.x;
  m.data.my = spot.y;
  sim.events.push({ t: 'emerge', x: spot.ox + 0.5, y: spot.oy + 0.5 });
  return m;
}

// ---------------------------------------------------------------------------
// Отражение: зеркально повторяет движения героя через невидимую плоскость,
// с задержкой. Взмах героя повторяет тоже — метка сразу, удар через миг.
// ---------------------------------------------------------------------------

/** Где был герой `lag` секунд назад (история этажа). */
function heroThen(sim: Sim, api: SimApi, lag: number): HistPt {
  const st = stateOf(sim, api);
  const t = sim.time - lag;
  const hs = st.hist;
  for (let i = hs.length - 1; i >= 0; i--) if (hs[i].t <= t) return hs[i];
  return hs[0] ?? { t: sim.time, x: sim.hero.x, y: sim.hero.y, face: sim.hero.face };
}

/** Поставить плоскость зеркала между отражением и героем. */
function setAxis(sim: Sim, m: Mob): void {
  const h = sim.hero;
  const dx = m.x - h.x;
  const dy = m.y - h.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    m.data.axis = 0;
    m.data.a = (m.y + h.y) / 2;
  } else {
    m.data.axis = 1;
    m.data.a = (m.x + h.x) / 2;
  }
  m.data.stuck = 0;
  m.data.lx = m.x;
  m.data.ly = m.y;
}

/** Точка героя, отражённая через плоскость отражения. */
function mirrorOf(m: Mob, p: { x: number; y: number }): [number, number] {
  return m.data.axis === 0 ? [p.x, 2 * m.data.a - p.y] : [2 * m.data.a - p.x, p.y];
}

/** Угол, отражённый через плоскость. */
const mirrorAng = (m: Mob, a: number) => (m.data.axis === 0 ? -a : Math.PI - a);

/** Копия взмаха героя: метка на полу, удар через `ECHO_LAG`. */
function copySwing(m: Mob, ang: number, arc: number, reach: number, heavy: boolean): void {
  m.data.cAng = ang;
  m.data.cArc = arc;
  m.data.cReach = reach;
  m.data.cHeavy = heavy ? 1 : 0;
}

registerBrain('f7_echo', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api, 'mirror')) {
      if (m.mode === 'mirror') setAxis(sim, m);
      return;
    }
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        if (lost(sim, m, api, dt, dist)) return;
        // Потерял плоскость — идёт напрямую, потом ставит новую.
        if (m.t > 1.6 && dist < 9) {
          setAxis(sim, m);
          api.setMode(m, 'mirror');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'mirror': {
        if (m.data.axis === undefined) setAxis(sim, m);
        if (lost(sim, m, api, dt, dist)) return;
        // Плоскость сама подползает к герою: отражение подходит ближе.
        const side =
          m.data.axis === 0 ? Math.sign(h.y - m.data.a) || 1 : Math.sign(h.x - m.data.a) || 1;
        m.data.a += side * 0.55 * dt;
        const p = heroThen(sim, api, ECHO_LAG);
        const [tx, ty] = mirrorOf(m, p);
        const ex = tx - m.x;
        const ey = ty - m.y;
        const ed = hypot(ex, ey);
        const sp = Math.min(m.speed * 1.25, ed * 5);
        if (ed > 0.05) api.steer(sim, m, ex / ed, ey / ed, sp, dt);
        else {
          m.vx *= 0.7;
          m.vy *= 0.7;
        }
        m.face = mirrorAng(m, p.face);
        // Застрял (цель за стеной) или ушёл далеко — погоня напрямую.
        if (m.t > 1.2) {
          const moved = hypot(m.x - m.data.lx, m.y - m.data.ly);
          m.data.stuck = moved < 0.25 && ed > 1.2 ? (m.data.stuck ?? 0) + 1 : 0;
          m.data.lx = m.x;
          m.data.ly = m.y;
          m.t = 0.001;
          if (m.data.stuck >= 2 || dist > 11) {
            api.setMode(m, 'chase');
            return;
          }
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Взмах героя — повторить (зеркально) через миг.
        if (m.data.cAng !== undefined && dist < 7) {
          m.dir = m.data.cAng;
          api.setMode(m, 'copy');
        }
        return;
      }
      case 'copy': {
        // Стоит и повторяет взмах: метка горит сразу.
        m.vx *= 0.7;
        m.vy *= 0.7;
        const reach = (m.data.cReach ?? 1.35) + 0.25;
        const arc = m.data.cArc ?? 1.9;
        m.face = m.dir;
        m.tele = { shape: 'cone', r: reach, arc, ang: m.dir, k: Math.min(1, m.t / ECHO_LAG) };
        if (m.t > ECHO_LAG - 0.22) m.danger = reach + 0.4;
        if (m.t >= ECHO_LAG) {
          if (heroOpen(h) && coneHits(m.x, m.y, m.dir, reach, arc, h))
            api.hurtHero(sim, m.dmg * (m.data.cHeavy ? 1.5 : 1.05), m.x, m.y, 3.5, m.kind);
          sim.events.push({ t: 'boss', what: 'whip' });
          delete m.data.cAng;
          m.vx += Math.cos(m.dir) * 2.5;
          m.vy += Math.sin(m.dir) * 2.5;
          api.setMode(m, 'recover');
          m.data.bcd = 0.5;
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.5) {
          api.setMode(m, 'mirror');
          setAxis(sim, m);
        }
        return;
      default:
        setAxis(sim, m);
        api.setMode(m, 'mirror');
    }
  },
  onDeath(sim, m) {
    sim.events.push({ t: 'break', x: m.x, y: m.y, kind: 'f7_glass' });
  },
});

// ---------------------------------------------------------------------------
// Стеклянный голем: удар обеими руками по метке, броня трескается от
// ударов — на каждой трещине осколки веером, умирая, лопается.
// ---------------------------------------------------------------------------

const SHARD = { speed: 6.2, r: 0.2, life: 0.95, dmg: 0.5, art: 'f7_shard' };
/** Пороги трещин голема: доля здоровья. */
export const GOLEM_CRACKS = [0.66, 0.33];

registerBrain('f7_golem', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    const cracks = m.data.cracks ?? 0;
    // Трещина: здоровье ниже порога — осколки веером.
    if (
      m.mode !== 'rupture' &&
      cracks < GOLEM_CRACKS.length &&
      m.hp < m.maxHp * GOLEM_CRACKS[cracks]
    ) {
      api.setMode(m, 'rupture');
      return;
    }
    switch (m.mode) {
      case 'chase': {
        if (lost(sim, m, api, dt, dist)) return;
        if (dist < 2.1 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          m.face = m.dir;
          const x = m.x + Math.cos(m.dir) * 1.05;
          const y = m.y + Math.sin(m.dir) * 1.05;
          api.strike(sim, {
            shape: 'circle',
            x,
            y,
            r: 1.3,
            warn: 0.85,
            dmg: m.dmg * 1.5,
            knock: 7,
            art: 'f7_slam',
            from: m.id,
          });
          api.setMode(m, 'slam');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'slam':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (m.t > 0.6) m.danger = 2.6;
        if (m.t >= 0.85) {
          sim.events.push({ t: 'boom', x: m.x + Math.cos(m.dir), y: m.y + Math.sin(m.dir), r: 0 });
          api.setMode(m, 'recover');
          m.cd = c.def.rest * (0.9 + sim.rng() * 0.3);
        }
        return;
      case 'rupture': {
        // Сверкает (кольцо на полу), потом осколки веером во все стороны.
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.tele = { shape: 'ring', r: 1.6, w: 0.2, k: Math.min(1, m.t / 0.55) };
        if (m.t > 0.35) m.danger = 2;
        if (m.t >= 0.55) {
          m.data.cracks = (m.data.cracks ?? 0) + 1;
          const off = sim.rng() * TAU;
          for (let i = 0; i < 8; i++) api.shoot(sim, m, off + (i / 8) * TAU, SHARD);
          sim.events.push({ t: 'break', x: m.x, y: m.y, kind: 'f7_glass' });
          api.setMode(m, 'recover');
          m.cd = 0.6;
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.9) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit) {
    // Цельное стекло держит удар; треснувшее — хрупкое. Тяжёлый — колет.
    const cr = m.data.cracks ?? 0;
    let k = cr === 0 ? 0.55 : cr === 1 ? 1 : 1.35;
    if (hit.heavy) k *= 1.3;
    void sim;
    return k;
  },
  onDeath(sim, m, _mode, api) {
    // Лопается: кольцо на полу, через миг осколки во все стороны.
    const st = STATE.get(sim);
    sim.events.push({ t: 'break', x: m.x, y: m.y, kind: 'f7_glass' });
    if (!st) return;
    st.bursts.push({ t: 0.4, x: m.x, y: m.y, n: 10, dmg: m.dmg, kind: m.kind });
    api.zone(sim, { x: m.x, y: m.y, r: 1.6, life: 0.45, art: 'f7_ring' });
  },
});

// ---------------------------------------------------------------------------
// Призрачная копия: видна и досягаема, только пока на неё смотрят.
// Отвернулся — становится недосягаемой и заходит за спину. Бьёт всегда
// видимой (замах снимает недосягаемость), касание — «очарован».
// ---------------------------------------------------------------------------

registerBrain('f7_phantom', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    const seen = dist < 10 && heroSees(sim, m.x, m.y);
    switch (m.mode) {
      case 'chase': {
        m.data.ghost = seen ? 0 : 1;
        m.data.seen = seen ? 1 : 0;
        if (lost(sim, m, api, dt, dist)) return;
        const reach = def.reach + m.r + h.r;
        if (dist < reach + 0.1 && m.cd <= 0) {
          m.data.ghost = 0;
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
          return;
        }
        // На виду — тянется медленно; не видят — обходит за спину.
        let tx = h.x;
        let ty = h.y;
        if (!seen && dist > 1.2) {
          tx = h.x - Math.cos(h.face) * 1.3;
          ty = h.y - Math.sin(h.face) * 1.3;
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed * (seen ? 0.42 : 1.2), dt);
        return;
      }
      case 'windup': {
        m.data.ghost = 0;
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t < def.windup) return;
        const reach = def.reach + m.r + h.r + 0.18;
        if (dist < reach && heroOpen(h))
          api.hurtHero(sim, m.dmg, m.x, m.y, 2, m.kind, { kind: 'charm', dur: 0.9 });
        api.setMode(m, 'recover');
        m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        return;
      }
      case 'recover':
        m.data.ghost = 0;
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
// Тень из рамы: выходит из пустой рамы, хватает и тянет к ней. Держится
// рамы: герой ушёл — вернулась. Раму разбили — рассеялась.
// ---------------------------------------------------------------------------

export const TETHER = 7.5;
const GRAB_LEN = 3.2;

registerBrain('f7_shadow', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    const fx = m.data.fx ?? m.hx;
    const fy = m.data.fy ?? m.hy;
    const far = hypot(h.x - fx, h.y - fy) > TETHER;
    switch (m.mode) {
      case 'chase': {
        if (far || heroDown(sim) || lost(sim, m, api, dt, dist)) {
          api.setMode(m, 'f7_back');
          return;
        }
        const reach = def.reach + m.r + h.r;
        if (dist < reach && m.cd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (
          dist > 1.6 &&
          dist < GRAB_LEN &&
          m.cd <= 0 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'grab');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'grab': {
        // Длинная рука: линия к герою, в конце — хватает и тянет к раме.
        const Tm = 0.62;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < 0.36) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: GRAB_LEN, w: 0.3, ang: m.dir, k: Math.min(1, m.t / Tm) };
        if (m.t > Tm - 0.24) m.danger = GRAB_LEN + 0.4;
        if (m.t >= Tm) {
          if (heroOpen(h) && lineHits(m.x, m.y, m.dir, GRAB_LEN, 0.3, h.x, h.y, h.r)) {
            // Тянет к себе (отрицательный отброс) и вяжет.
            api.hurtHero(sim, m.dmg * 0.9, m.x, m.y, -13, m.kind, { kind: 'slow', dur: 1 });
          }
          const z: ZoneIn & { ang: number; len: number } = {
            x: m.x,
            y: m.y,
            r: 0.3,
            life: 0.32,
            art: 'f7_grab',
            ang: m.dir,
            len: Math.min(GRAB_LEN, dist),
          };
          api.zone(sim, z);
          api.setMode(m, 'recover');
          m.cd = 1.4;
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api, 1.1, 3);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.55) api.setMode(m, 'chase');
        return;
      case 'f7_back': {
        // Уходит в раму и исчезает (движок уберёт «ушедшего»).
        const ex = fx - m.x;
        const ey = fy - m.y;
        const d = hypot(ex, ey);
        m.data.ghost = 1;
        if (d < 0.5 || m.t > 3) {
          api.setMode(m, 'escape');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, fx, fy);
        api.steer(sim, m, cx, cy, m.speed * 1.3, dt);
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Зеркальная бабочка: порхает вокруг, копит вспышку (круг на полу). Кто
// смотрит на неё в миг вспышки — ослеплён (холод). Отвернулся — цел.
// ---------------------------------------------------------------------------

registerBrain('f7_moth', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api)) return;
    const h = sim.hero;
    const { dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        if (lost(sim, m, api, dt, dist)) return;
        // Кружит на расстоянии вспышки, дёргано.
        const ang = Math.atan2(m.y - h.y, m.x - h.x) + (m.id % 2 ? 0.9 : -0.9) * dt * 2;
        const R = 2.2 + Math.sin(sim.time * 1.7 + m.id) * 0.5;
        const tx = h.x + Math.cos(ang) * R;
        const ty = h.y + Math.sin(ang) * R;
        let [cx, cy] = api.chaseDir(sim, m, tx, ty);
        const j = Math.sin(sim.time * 11 + m.id * 3.1) * 0.9;
        cx += -cy * j;
        cy += cx * j;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * (dist > 5 ? 1.2 : 0.8), dt);
        // Одна вспышка на округу за раз.
        const busy = sim.mobs.some(
          (o) =>
            o !== m &&
            o.kind === 'f7_moth' &&
            o.mode === 'flash' &&
            hypot(o.x - m.x, o.y - m.y) < 6,
        );
        if (dist < FLASH_R - 0.2 && m.cd <= 0 && !busy) api.setMode(m, 'flash');
        return;
      }
      case 'flash': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = { shape: 'circle', r: FLASH_R, k: Math.min(1, m.t / FLASH_T) };
        if (m.t > FLASH_T - 0.25) m.danger = FLASH_R + 0.3;
        if (m.t >= FLASH_T) {
          const inside = dist < FLASH_R + h.r;
          if (inside && heroOpen(h) && heroSees(sim, m.x, m.y, 1.2))
            api.hurtHero(sim, m.dmg * 0.8, m.x, m.y, 1, m.kind, { kind: 'chill', dur: 1.6 });
          const z: ZoneIn = { x: m.x, y: m.y, r: FLASH_R, life: 0.3, art: 'f7_flash' };
          api.zone(sim, z);
          api.setMode(m, 'recover');
          m.cd = c.def.rest * (0.9 + sim.rng() * 0.5);
        }
        return;
      }
      case 'recover':
        m.vx *= 0.9;
        m.vy *= 0.9;
        if (m.t > 0.6) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Осколочный паук: бегает зигзагом, прыгает на героя по метке на полу
// (в воздухе недосягаем), после приземления открыт.
// ---------------------------------------------------------------------------

export const LEAP_R = 0.85;

registerBrain('f7_spider', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        if (lost(sim, m, api, dt, dist)) return;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist > 1.6 && dist < 4.2 && m.cd <= 0) {
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 9 + m.id) * 0.8;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed, dt);
        return;
      }
      case 'aim': {
        const Tm = 0.5;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < 0.3) {
          // Упреждение: куда герой будет через миг, не дальше прыжка.
          let tx = h.x + h.vx * 0.2;
          let ty = h.y + h.vy * 0.2;
          const d = hypot(tx - m.x, ty - m.y);
          if (d > 3.8) {
            tx = m.x + ((tx - m.x) / d) * 3.8;
            ty = m.y + ((ty - m.y) / d) * 3.8;
          }
          if (api.solidTile(sim, Math.floor(tx), Math.floor(ty))) {
            tx = h.x;
            ty = h.y;
          }
          m.data.tx = tx;
          m.data.ty = ty;
          m.data.sx = m.x;
          m.data.sy = m.y;
        }
        m.face = Math.atan2(m.data.ty - m.y, m.data.tx - m.x);
        m.tele = {
          shape: 'circle',
          r: LEAP_R,
          k: Math.min(1, m.t / Tm),
          x: m.data.tx,
          y: m.data.ty,
        };
        if (m.t > Tm - 0.2) m.danger = 5;
        if (m.t >= Tm) {
          m.data.sx = m.x;
          m.data.sy = m.y;
          api.setMode(m, 'leap');
        }
        return;
      }
      case 'leap': {
        const Tm = 0.36;
        m.data.ghost = 1;
        const k = Math.min(1, m.t / Tm);
        m.x = m.data.sx + (m.data.tx - m.data.sx) * k;
        m.y = m.data.sy + (m.data.ty - m.data.sy) * k;
        m.vx = 0;
        m.vy = 0;
        m.tele = { shape: 'circle', r: LEAP_R, k: 1, x: m.data.tx, y: m.data.ty };
        m.danger = 3;
        if (k >= 1) {
          m.data.ghost = 0;
          api.collide(sim, m);
          if (heroOpen(h) && hypot(h.x - m.x, h.y - m.y) < LEAP_R + h.r)
            api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 3, m.kind);
          sim.events.push({ t: 'clank', x: m.x, y: m.y });
          api.setMode(m, 'recover');
          m.cd = 2 + sim.rng();
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
        m.data.ghost = 0;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.7) api.setMode(m, 'chase');
        return;
      default:
        m.data.ghost = 0;
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Призма: держит дистанцию, бьёт лучом, который отражается от зеркал.
// Сперва ведёт прицел (линия), потом ломаная замирает и наливается.
// ---------------------------------------------------------------------------

export interface Seg {
  x: number;
  y: number;
  ang: number;
  len: number;
}

/** Путь луча: отражается от зеркал (не больше `bounces` раз), над пропастью летит. */
export function beamPath(
  sim: Sim,
  x: number,
  y: number,
  ang: number,
  maxLen: number,
  bounces: number,
): Seg[] {
  const segs: Seg[] = [];
  let cx = x;
  let cy = y;
  let dx = Math.cos(ang);
  let dy = Math.sin(ang);
  let left = maxLen;
  for (let b = 0; b <= bounces && left > 0.3; b++) {
    const step = 0.06;
    let px = cx;
    let py = cy;
    let len = 0;
    let reflect = false;
    const a0 = Math.atan2(dy, dx);
    while (len < left) {
      const nx = px + dx * step;
      const ny = py + dy * step;
      const ix = Math.floor(nx);
      const iy = Math.floor(ny);
      const t = tileAt(sim, ix, iy);
      // Пол, рельсы, лужи, лифт, опасный пол и пропасть — луч летит дальше.
      const pass = (t >= 2 && t <= 5) || t === 10 || t === T.Deep || t === T.Hazard;
      if (!pass) {
        const k = markAt(sim, ix, iy);
        if (isMirrorMark(k) && b < bounces) {
          const ox = Math.floor(px);
          const oy = Math.floor(py);
          if (ix !== ox && iy === oy) dx = -dx;
          else if (iy !== oy && ix === ox) dy = -dy;
          else {
            dx = -dx;
            dy = -dy;
          }
          reflect = true;
        }
        break;
      }
      px = nx;
      py = ny;
      len += step;
    }
    segs.push({ x: cx, y: cy, ang: a0, len });
    left -= len;
    cx = px;
    cy = py;
    if (!reflect) break;
  }
  return segs;
}

registerBrain('f7_prism', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f7_rise':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (m.t > 0.9) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
          m.cd = 0.8;
        }
        return;
      case 'chase': {
        if (lost(sim, m, api, dt, dist)) return;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < 8 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Держит дистанцию: близко — отлетает, далеко — подлетает.
        let dir: [number, number];
        if (dist < 3.8 && see)
          dir = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        else dir = api.chaseDir(sim, m, h.x, h.y);
        const k = dist < 6.5 && dist > 3.8 ? 0.35 : 1;
        const bob = Math.sin(sim.time * 2 + m.id);
        api.steer(sim, m, dir[0] + bob * 0.2, dir[1], m.speed * k, dt);
        return;
      }
      case 'aim': {
        // Прицел ведёт 0,45 с, потом ломаная луча замирает и наливается.
        m.vx *= 0.7;
        m.vy *= 0.7;
        const lock = 0.45;
        if (m.t < lock) {
          m.dir = Math.atan2(dy, dx);
          m.face = m.dir;
          const segs = beamPath(sim, m.x, m.y, m.dir, 11, 0);
          m.tele = { shape: 'line', r: segs[0]?.len ?? 1, w: 0.12, ang: m.dir, k: m.t / lock };
          return;
        }
        if (!m.data.fired) {
          m.data.fired = 1;
          for (const s of beamPath(sim, m.x, m.y, m.dir, 13, 2)) {
            api.strike(sim, {
              shape: 'line',
              x: s.x,
              y: s.y,
              r: s.len,
              w: 0.32,
              ang: s.ang,
              warn: 0.5,
              dmg: m.dmg * 1.2,
              knock: 3,
              art: 'f7_beam',
              from: m.id,
            });
          }
        }
        m.danger = m.t > 0.72 ? 6 : 0;
        if (m.t >= lock + 0.5) {
          m.data.fired = 0;
          api.setMode(m, 'recover');
          m.cd = c.def.rest * (0.9 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 0.9) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Стекольщик-воришка: удирает; у зеркала ныряет в стекло и выходит из
// другого (рябь в зеркале выхода видна заранее). Через минуту уходит насовсем.
// ---------------------------------------------------------------------------

registerBrain('f7_thief', {
  step(sim, m, dt, c, api) {
    if (stepOut(m, api, 'flee')) return;
    const h = sim.hero;
    const { dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.life = (m.data.life ?? 0) + dt;
    switch (m.mode) {
      case 'f7_dive':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (m.t > 5) api.setMode(m, 'escape');
        return;
      case 'flee':
      case 'chase': {
        m.data.ghost = 0;
        if (m.data.life > 60 && dist > 4) {
          api.setMode(m, 'escape');
          return;
        }
        // Зеркало под боком и герой близко — нырнуть.
        m.data.dcd = (m.data.dcd ?? 1.5) - dt;
        if (m.data.dcd <= 0 && dist < 5.5) {
          const st = stateOf(sim, api);
          const here = st.mirrors.find(
            (s) =>
              hypot(s.ox + 0.5 - m.x, s.oy + 0.5 - m.y) < 1.3 &&
              markAt(sim, s.x, s.y) === F7_MARK.mirror,
          );
          if (here) {
            const out = pickMirror(sim, api, 7, 13);
            if (out) {
              m.data.dcd = 3.2;
              api.setMode(m, 'f7_dive');
              const z: ZoneIn & { mx: number; my: number } = {
                x: here.x + 0.5,
                y: here.y + 0.5,
                r: 0.5,
                life: 0.5,
                art: 'f7_ripple',
                mx: here.x,
                my: here.y,
              };
              api.zone(sim, z);
              startBirth(sim, api, out, m.kind, { mob: m.id, warn: 0.5 });
              return;
            }
          }
        }
        // Бежит прочь, но жмётся к зеркалам.
        const away = api.flowDir(sim, m.x, m.y, true);
        const [ax, ay] = away ?? [m.x - h.x, m.y - h.y];
        const l = hypot(ax, ay) || 1;
        const j = Math.sin(sim.time * 6 + m.id) * 0.35;
        api.steer(
          sim,
          m,
          ax / l - (ay / l) * j,
          ay / l + (ax / l) * j,
          m.speed * (dist < 6 ? 1.15 : 0.7),
          dt,
        );
        return;
      }
      default:
        api.setMode(m, 'flee');
    }
  },
});

// ---------------------------------------------------------------------------
// Отражение героя (босс) и его копии.
//
// Удары — удары героя: серия из трёх взмахов, рывок-выпад, тяжёлый с
// набором. Фазы (засечки на полосе — 75%, 45%, 20%):
//   0 ДУЭЛЬ — серии, выпад, тяжёлый; стойка «зеркальная защита»: ударишь в
//     неё — звон и ответный удар (стойка видна: клинок поперёк, блеск);
//   1 ФАЗА ТЕНЕЙ — свет гаснет, кроме люстры посреди арены; отражение
//     расходится на 3–5 копий. Настоящее — то, что отбрасывает тень (от
//     люстры, длинная). Удар по копии — звон, копия рассыпается. Раз в
//     13 с все меняются местами. Разбил все копии — через миг новые;
//   2 ОТРАЖЁННЫЙ СВЕТ — уходит в зеркало арены и вылетает из
//     противоположного выпадом через весь зал (линии метками, три подряд),
//     зеркальный взгляд — конус: попал — очарован (джойстик наоборот);
//   3 РАЗБИТОЕ ЗЕРКАЛО — бьёт зеркала арены: осколки летят по линиям через
//     зал (метки, между ними просветы), зеркала трескаются, на полу осколки.
// ---------------------------------------------------------------------------

export const BOSS = {
  combo: [0.46, 0.34, 0.5],
  comboArc: [1.95, 1.95, 2.6],
  comboR: [2.0, 2.0, 2.3],
  heavy: 1.0,
  heavyR: 2.7,
  heavyArc: 3.8,
  dashAim: 0.55,
  dashLen: 5,
  dashSpeed: 14,
  guard: 0.95,
  riposte: 0.32,
  gaze: 0.8,
  gazeR: 6,
  gazeArc: 0.9,
  mirrorAim: 0.75,
  volley: 5.4,
  volleyWarn: 1.0,
  shuffle: 13,
};

/** Засечки фаз на полосе. */
export const F7_NOTCHES = [0.75, 0.45, 0.2];

const isBossKind = (k: string) => k === 'f7boss' || k === 'f7boss_copy';

function haste(sim: Sim, m: Mob): number {
  const p = sim.boss?.phase ?? 0;
  const base = p >= 3 ? 1.22 : p >= 2 ? 1.12 : 1;
  return m.kind === 'f7boss_copy' ? base * 0.82 : base;
}

/** Удар отражения (копия бьёт слабее). */
const bossDmg = (m: Mob, k: number) => m.dmg * k * (m.kind === 'f7boss_copy' ? 0.45 : 1);

function startCombo(m: Mob, api: SimApi): void {
  m.data.k = 0;
  api.setMode(m, 'combo');
}

// v2.86 — только рисунок: зоны-картинки Отражения (`api.vfx`: без урона и
// статусов, номер мимо `nextId`) — рисует `f7-boss-fx.ts`. Своих `f7_fx*`
// разом не больше 44, следов движения — не больше 18. `lit` — вторая зона
// того же вида поверх темноты (`<вид>_lit`): свет, искры, трещины в воздухе.
function vfx(
  sim: Sim,
  api: SimApi,
  art: string,
  x: number,
  y: number,
  life: number,
  o: Record<string, number> = {},
  lit = 0,
  move = false,
): void {
  let n = 0;
  for (const z of sim.zones) if (z.art?.startsWith('f7_fx')) n++;
  if (n >= (move ? 18 : 44)) return;
  api.vfx(sim, { x, y, r: 0, life, art, ...o } as ZoneIn);
  if (lit > 0) api.vfx(sim, { x, y, r: 0, life: lit, art: art + '_lit', above: true, ...o } as ZoneIn);
}
// v2.86 — только рисунок: метка удара (пол и свет) — зона, которая следит за
// мобом и его `m.tele`; своя у каждого замаха (`vTz`), `vT` — длина замаха.
function vTele(sim: Sim, m: Mob, api: SimApi, dt: number, Tw: number): void {
  if (m.t > dt + 1e-6) return;
  const z = { x: m.x, y: m.y, r: 0, life: Tw - m.t + 0.15, vm: m.id, vT: Tw };
  api.vfx(sim, { ...z, art: 'f7_fxtele' } as ZoneIn);
  m.data.vTz = sim.zones[sim.zones.length - 1].id;
  api.vfx(sim, { ...z, art: 'f7_fxtele_lit', above: true } as ZoneIn);
}
// v2.86 — только рисунок: тряска по силе удара; вдали от героя — вполсилы.
const vShake = (sim: Sim, x: number, y: number, k: number) =>
  sim.events.push({ t: 'shake', k: hypot(sim.hero.x - x, sim.hero.y - y) < 7 ? k : k * 0.5 });
// v2.86 — только рисунок: контакт взмаха (0–2 — серия, 3 — ответ из стойки).
function vCut(sim: Sim, m: Mob, api: SimApi, k: number, R: number, arc: number): void {
  const o = { vA: m.dir, vR: R, vArc: arc, vK: k };
  vfx(sim, api, 'f7_fxcut', m.x, m.y, 1.2, o, 0.7);
  vShake(sim, m.x, m.y, k === 2 ? 0.2 : k === 3 ? 0.16 : 0.1);
}
// v2.86 — только рисунок: стеклянные следы на зеркальном полу, шаг — полклетки.
function vSteps(sim: Sim, m: Mob, api: SimApi, dt: number): void {
  const v = hypot(m.vx, m.vy);
  m.data.vStep = v < 0.8 ? 0 : (m.data.vStep ?? 0) + v * dt;
  if (m.data.vStep < 0.55) return;
  m.data.vStep = 0;
  m.data.vFoot = m.data.vFoot ? 0 : 1;
  vfx(sim, api, 'f7_fxstep', m.x, m.y, 1.1, { vA: Math.atan2(m.vy, m.vx), vS: m.data.vFoot }, 0, true);
}
// v2.86 — только рисунок: выпад (рывок, бег сквозь зал) — толчок, искры, попадание.
function vLunge(sim: Sim, m: Mob, api: SimApi, dt: number, big: number): void {
  if (m.t <= dt + 1e-6) {
    vfx(sim, api, 'f7_fxkick', m.x, m.y, 0.9, { vA: m.dir, vK: big }, 0.5);
    if (big) vfx(sim, api, 'f7_fxrun', m.x, m.y, 2.6, { vA: m.dir, vm: m.id }, 2.6);
  }
  m.data.vSt = (m.data.vSt ?? 0) + dt;
  if (m.data.vSt < 0.07) return;
  m.data.vSt = 0;
  vfx(sim, api, 'f7_fxstreak', m.x, m.y, 0.35, { vA: m.dir, vK: big }, 0, true);
}
function vPierce(sim: Sim, m: Mob, api: SimApi, big: number): void {
  const h = sim.hero;
  vfx(sim, api, 'f7_fxpierce', h.x, h.y, 1.1, { vA: m.dir, vK: big }, 0.6);
  vShake(sim, h.x, h.y, big ? 0.22 : 0.16);
}

function bossDecide(sim: Sim, m: Mob, c: BrainCtx, api: SimApi): boolean {
  const h = sim.hero;
  const { dx, dy, dist } = c;
  const phase = sim.boss?.phase ?? 0;
  const copy = m.kind === 'f7boss_copy';
  const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
  if (!copy && phase === 2 && (m.data.mdCd ?? 0) <= 0 && see) {
    m.data.series = 2;
    m.data.mdCd = 99;
    api.setMode(m, 'mdive');
    return true;
  }
  if (!copy && phase === 2 && (m.data.gazeCd ?? 0) <= 0 && dist < BOSS.gazeR - 0.5 && see) {
    m.dir = Math.atan2(dy, dx);
    m.data.gazeCd = 7;
    api.setMode(m, 'gaze');
    return true;
  }
  if (dist < 2.4) {
    const r = sim.rng();
    if (!copy && (phase === 0 || phase === 3) && r < 0.18 && (m.data.guardCd ?? 0) <= 0) {
      m.data.guardCd = 6;
      api.setMode(m, 'guard');
      return true;
    }
    if (r < 0.7) startCombo(m, api);
    else {
      m.dir = Math.atan2(dy, dx);
      api.setMode(m, 'heavy');
    }
    return true;
  }
  if (see && dist > 3 && dist < 7 && (m.data.dashCd ?? 0) <= 0) {
    m.dir = Math.atan2(dy, dx);
    m.data.dashCd = copy ? 4 : 3;
    api.setMode(m, 'dashAim');
    return true;
  }
  return false;
}

/** Выход из зеркала арены: противоположное зеркало по линии через героя. */
function mirrorExit(
  sim: Sim,
  api: SimApi,
  m: Mob,
): { x: number; y: number; ang: number; len: number } | null {
  const st = STATE.get(sim);
  const h = sim.hero;
  if (!st?.arena) return null;
  // Направление через героя: из случайного угла, линия проходит сквозь него.
  for (let tries = 0; tries < 12; tries++) {
    const a = sim.rng() * TAU;
    // Точка у стены по обратному направлению от героя.
    const back = wallDist(sim, api, h.x, h.y, a + Math.PI, 20);
    const sx = h.x + Math.cos(a + Math.PI) * (back - 0.7);
    const sy = h.y + Math.sin(a + Math.PI) * (back - 0.7);
    if (!api.inArena(sim, sx, sy)) continue;
    const len = wallDist(sim, api, sx, sy, a, 30) - 0.6;
    if (len < 6) continue;
    void m;
    return { x: sx, y: sy, ang: a, len };
  }
  return null;
}

/** Выпад сквозь зал кончился: следующий из серии или окно (запутался в отражении). */
function endMirrorRun(m: Mob, api: SimApi): void {
  m.data.series = (m.data.series ?? 1) - 1;
  if (m.data.series > 0) {
    api.setMode(m, 'mdive');
    return;
  }
  api.setMode(m, 'daze');
  m.data.mdCd = 11;
}

function duelStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const { dx, dy, dist } = c;
  const hs = haste(sim, m);
  const copy = m.kind === 'f7boss_copy';
  m.tele = null;
  m.danger = 0;
  m.bounce = false;
  m.data.vNoTele = 1; // v2.86 — только рисунок: метки ударов рисует f7-boss-fx
  for (const k of ['dashCd', 'guardCd', 'gazeCd', 'mdCd'] as const)
    m.data[k] = (m.data[k] ?? 0) - dt;
  if (heroDown(sim)) {
    m.vx *= 0.85;
    m.vy *= 0.85;
    if (m.mode !== 'idle') api.setMode(m, 'idle');
    return;
  }
  switch (m.mode) {
    case 'roar':
    case 'intro':
      // Выходит из зеркала: стоит и повторяет стойку героя.
      m.data.ghost = m.t < 0.5 ? 1 : 0;
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.face = Math.atan2(dy, dx);
      // После шага сквозь зеркало — все одинаково (иначе настоящее выдаёт себя).
      if (m.t > (m.data.quick ? 1.2 : copy ? 0.8 : 1.4)) {
        m.data.quick = 0;
        api.setMode(m, 'chase');
      }
      return;
    case 'idle':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.5) api.setMode(m, 'chase');
      return;
    case 'chase': {
      m.data.ghost = 0;
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, cx, cy, m.speed * hs * (dist < 1.7 ? 0.2 : 1), dt);
      vSteps(sim, m, api, dt); // v2.86 — только рисунок
      if (m.t < 0.35 / hs) return;
      if (bossDecide(sim, m, c, api)) return;
      return;
    }
    case 'combo': {
      const k = m.data.k ?? 0;
      const Tw = (BOSS.combo[k] / hs) * (copy ? 1.15 : 1);
      const R = BOSS.comboR[k];
      const arc = BOSS.comboArc[k];
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < Tw * 0.55) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      m.tele = { shape: 'cone', r: R, arc, ang: m.dir, k: Math.min(1, m.t / Tw) };
      vTele(sim, m, api, dt, Tw); // v2.86 — только рисунок
      if (m.t > Tw - 0.24) m.danger = R + 0.5;
      if (m.t >= Tw) {
        if (heroOpen(h) && coneHits(m.x, m.y, m.dir, R, arc, h))
          api.hurtHero(sim, bossDmg(m, k === 2 ? 1.5 : 1), m.x, m.y, k === 2 ? 6 : 3, m.kind);
        vCut(sim, m, api, k, R, arc); // v2.86 — только рисунок
        sim.events.push({ t: 'boss', what: 'whip' });
        m.vx += Math.cos(m.dir) * 4.5;
        m.vy += Math.sin(m.dir) * 4.5;
        m.data.k = k + 1;
        m.data.swing = k + 1;
        if (k >= 2) {
          api.setMode(m, 'recover');
          m.data.rec = 0.95;
        } else {
          m.mode = 'combo';
          m.t = -0.1 / hs;
        }
      }
      return;
    }
    case 'heavy': {
      const Tw = (BOSS.heavy / hs) * (copy ? 1.15 : 1);
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < Tw * 0.5) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      m.tele = {
        shape: 'cone',
        r: BOSS.heavyR,
        arc: BOSS.heavyArc,
        ang: m.dir,
        k: Math.min(1, m.t / Tw),
      };
      vTele(sim, m, api, dt, Tw); // v2.86 — только рисунок
      if (m.t > Tw - 0.26) m.danger = BOSS.heavyR + 0.6;
      if (m.t >= Tw) {
        if (heroOpen(h) && coneHits(m.x, m.y, m.dir, BOSS.heavyR, BOSS.heavyArc, h))
          api.hurtHero(sim, bossDmg(m, 2), m.x, m.y, 9, m.kind);
        // v2.86 — только рисунок: клинок в пол — раскол зеркального пола, волна, осколки.
        vfx(sim, api, 'f7_fxheavy', m.x, m.y, 1.8, { vA: m.dir, vR: BOSS.heavyR, vArc: BOSS.heavyArc }, 0.9);
        vShake(sim, m.x, m.y, 0.42); // v2.86 — только рисунок
        if (dist < 7) sim.events.push({ t: 'flash', k: 0.28, color: '#d8ecff' }); // v2.86 — только рисунок
        sim.events.push({ t: 'boom', x: m.x + Math.cos(m.dir), y: m.y + Math.sin(m.dir), r: 0 });
        sim.events.push({ t: 'boss', what: 'whip' });
        api.setMode(m, 'recover');
        m.data.rec = 1.15;
      }
      return;
    }
    case 'dashAim': {
      const Tw = (BOSS.dashAim / hs) * (copy ? 1.15 : 1);
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < Tw * 0.6) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      const len = Math.min(
        BOSS.dashLen,
        wallDist(sim, api, m.x, m.y, m.dir, BOSS.dashLen + 1) - 0.4,
      );
      m.data.len = Math.max(0.5, len);
      m.tele = { shape: 'line', r: m.data.len, w: 0.55, ang: m.dir, k: Math.min(1, m.t / Tw) };
      vTele(sim, m, api, dt, Tw); // v2.86 — только рисунок
      if (m.t > Tw - 0.24) m.danger = m.data.len + 1;
      if (m.t >= Tw) {
        m.data.run = 0;
        m.data.hit = 0;
        api.setMode(m, 'dash');
      }
      return;
    }
    case 'dash': {
      const s = BOSS.dashSpeed;
      m.vx = Math.cos(m.dir) * s;
      m.vy = Math.sin(m.dir) * s;
      m.face = m.dir;
      m.bounce = true;
      m.data.run = (m.data.run ?? 0) + s * dt;
      m.danger = m.r + h.r + 1;
      vLunge(sim, m, api, dt, 0); // v2.86 — только рисунок
      if (!m.data.hit && dist < m.r + h.r + 0.15 && heroOpen(h)) {
        m.data.hit = 1;
        api.hurtHero(sim, bossDmg(m, 1.3), m.x, m.y, 7, m.kind);
        vPierce(sim, m, api, 0); // v2.86 — только рисунок
      }
      if (m.data.run >= m.data.len || m.t > 0.6) {
        m.bounce = false;
        api.setMode(m, 'recover');
        m.data.rec = 0.6;
      }
      return;
    }
    case 'guard': {
      // Стойка: клинок поперёк. Ударишь — звон и ответ; переждал — серия.
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = Math.atan2(dy, dx);
      if (m.t >= BOSS.guard) startCombo(m, api);
      return;
    }
    case 'riposte': {
      const Tw = BOSS.riposte;
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < 0.12) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      m.tele = { shape: 'cone', r: 2.1, arc: 2.2, ang: m.dir, k: Math.min(1, m.t / Tw) };
      vTele(sim, m, api, dt, Tw); // v2.86 — только рисунок
      if (m.t > Tw - 0.2) m.danger = 2.6;
      if (m.t >= Tw) {
        if (heroOpen(h) && coneHits(m.x, m.y, m.dir, 2.1, 2.2, h))
          api.hurtHero(sim, bossDmg(m, 1.4), m.x, m.y, 5, m.kind);
        vCut(sim, m, api, 3, 2.1, 2.2); // v2.86 — только рисунок
        sim.events.push({ t: 'boss', what: 'whip' });
        api.setMode(m, 'recover');
        m.data.rec = 0.8;
      }
      return;
    }
    case 'gaze': {
      // Зеркальный взгляд: конус; кто в нём — очарован.
      const Tw = BOSS.gaze / hs;
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < Tw * 0.5) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      m.tele = {
        shape: 'cone',
        r: BOSS.gazeR,
        arc: BOSS.gazeArc,
        ang: m.dir,
        k: Math.min(1, m.t / Tw),
      };
      vTele(sim, m, api, dt, Tw); // v2.86 — только рисунок
      if (m.t > Tw - 0.24) m.danger = BOSS.gazeR;
      if (m.t >= Tw) {
        if (heroOpen(h) && coneHits(m.x, m.y, m.dir, BOSS.gazeR, BOSS.gazeArc, h))
          api.hurtHero(sim, bossDmg(m, 0.5), m.x, m.y, 1, m.kind, { kind: 'charm', dur: 1.2 });
        // v2.86 — только рисунок: волна взгляда поверх темноты, лиловая вспышка.
        vfx(sim, api, 'f7_fxgaze', m.x, m.y, 0.7, { vA: m.dir, vR: BOSS.gazeR, vArc: BOSS.gazeArc }, 1.4);
        vShake(sim, m.x, m.y, 0.12); // v2.86 — только рисунок
        if (dist < 7) sim.events.push({ t: 'flash', k: 0.22, color: '#b58cff' }); // v2.86 — только рисунок
        const z: ZoneIn & { ang: number } = {
          x: m.x,
          y: m.y,
          r: BOSS.gazeR,
          life: 0.35,
          art: 'f7_gazeflash',
          ang: m.dir,
        };
        api.zone(sim, z);
        api.setMode(m, 'recover');
        m.data.rec = 0.7;
      }
      return;
    }
    case 'mdive': {
      // Уходит в зеркало: растворяется (недосягаем), потом выход через зал.
      m.data.ghost = 1;
      m.vx *= 0.5;
      m.vy *= 0.5;
      if (m.t <= dt + 1e-6) vfx(sim, api, 'f7_fxdive', m.x, m.y, 0.9, {}, 0.7); // v2.86 — только рисунок
      if (m.t >= 0.45) {
        const ex = mirrorExit(sim, api, m);
        if (!ex) {
          m.data.ghost = 0;
          api.setMode(m, 'recover');
          m.data.rec = 0.6;
          return;
        }
        m.x = ex.x;
        m.y = ex.y;
        m.dir = ex.ang;
        m.data.len = ex.len;
        api.setMode(m, 'maim');
      }
      return;
    }
    case 'maim': {
      // Метка выпада через весь зал (из зеркала — до противоположного).
      const Tw = BOSS.mirrorAim / hs;
      m.data.ghost = m.t < Tw * 0.5 ? 1 : 0;
      m.vx = 0;
      m.vy = 0;
      m.face = m.dir;
      m.tele = { shape: 'line', r: m.data.len, w: 0.6, ang: m.dir, k: Math.min(1, m.t / Tw) };
      vTele(sim, m, api, dt, Tw); // v2.86 — только рисунок
      if (m.t <= dt + 1e-6) vfx(sim, api, 'f7_fxemerge', m.x, m.y, 1.1, { vA: m.dir }, 1.0); // v2.86 — только рисунок
      if (m.t > Tw - 0.24) m.danger = m.data.len + 1;
      if (m.t >= Tw) {
        m.data.ghost = 0;
        m.data.run = 0;
        m.data.hit = 0;
        api.setMode(m, 'mrun');
      }
      return;
    }
    case 'mrun': {
      const s = 17;
      m.vx = Math.cos(m.dir) * s;
      m.vy = Math.sin(m.dir) * s;
      m.face = m.dir;
      m.bounce = true;
      m.data.run = (m.data.run ?? 0) + s * dt;
      m.danger = m.r + h.r + 1;
      vLunge(sim, m, api, dt, 1); // v2.86 — только рисунок
      if (!m.data.hit && dist < m.r + h.r + 0.2 && heroOpen(h)) {
        m.data.hit = 1;
        api.hurtHero(sim, bossDmg(m, 1.4), m.x, m.y, 8, m.kind);
        vPierce(sim, m, api, 1); // v2.86 — только рисунок
      }
      if (m.data.run >= m.data.len || m.t > 1.6) {
        m.bounce = false;
        endMirrorRun(m, api);
      }
      return;
    }
    case 'shift': {
      // Шаг сквозь зеркало: исчез и возник в новом месте (фаза теней).
      m.data.ghost = 1;
      m.vx = 0;
      m.vy = 0;
      if (m.t <= dt + 1e-6) vfx(sim, api, 'f7_fxdive', m.x, m.y, 1.0, { vK: 1 }, 0.8); // v2.86 — только рисунок
      if (m.t >= 0.7) {
        m.x = m.data.nx ?? m.x;
        m.y = m.data.ny ?? m.y;
        vfx(sim, api, 'f7_fxemerge', m.x, m.y, 1.1, { vA: Math.PI / 2 }, 1.0); // v2.86 — только рисунок
        m.data.quick = 1;
        api.setMode(m, 'intro');
        m.t = 0.5;
      }
      return;
    }
    case 'daze':
      // После выпадов сквозь зал: запутался в отражениях — большое окно.
      m.data.ghost = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 2.1 / hs) api.setMode(m, 'chase');
      return;
    case 'recover':
      // Окно: отражение переводит дух.
      m.data.ghost = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > (m.data.rec ?? 0.8) / hs) api.setMode(m, 'chase');
      return;
    default:
      api.setMode(m, 'chase');
  }
}

registerBrain('f7_boss', {
  raw: true,
  step(sim, m, dt, c, api) {
    duelStep(sim, m, dt, c, api);
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode === 'dash' || m.mode === 'mrun') {
      // v2.86 — только рисунок: стекло о стену — звезда, осколки назад в зал.
      vfx(sim, api, 'f7_fxwall', m.x, m.y, 1.0, { vA: m.dir }, 0.6);
      vShake(sim, m.x, m.y, 0.2); // v2.86 — только рисунок
      m.bounce = false;
      m.vx = 0;
      m.vy = 0;
      if (m.mode === 'mrun') endMirrorRun(m, api);
      else {
        api.setMode(m, 'recover');
        m.data.rec = 0.7;
      }
      sim.events.push({ t: 'boss', what: 'f7_glass_wall' });
    }
  },
  onHit(sim, m, hit, api) {
    // Зеркальная защита: удар в стойку — звон и ответный выпад.
    if (m.mode === 'guard') {
      m.dir = hit.ang + Math.PI;
      api.setMode(m, 'riposte');
      // v2.86 — только рисунок: удар в зеркальную стойку — блик и звон отражённого удара.
      vfx(sim, api, 'f7_fxparry', m.x - Math.cos(hit.ang) * 0.55, m.y - Math.sin(hit.ang) * 0.55, 0.5, { vA: hit.ang + Math.PI }, 0.6);
      vShake(sim, m.x, m.y, 0.18); // v2.86 — только рисунок
      return 0;
    }
    void sim;
    return 1;
  },
  onDeath(sim, m, _mode, api) {
    const st = STATE.get(sim);
    if (st) st.bursts.push({ t: 0.05, x: m.x, y: m.y, n: 0, dmg: 0, kind: m.kind });
    sim.events.push({ t: 'break', x: m.x, y: m.y, kind: 'f7_glass' });
    vfx(sim, api, 'f7_fxdeath', m.x, m.y, 3.2, {}, 1.6); // v2.86 — только рисунок
  },
});

registerBrain('f7_copy', {
  raw: true,
  step(sim, m, dt, c, api) {
    if (sim.boss?.state !== 'fight') {
      api.setMode(m, 'dying');
      return;
    }
    duelStep(sim, m, dt, c, api);
  },
  onWall(_sim, m, _nx, _ny, api) {
    if (m.mode === 'dash') {
      // v2.86 — только рисунок: как у настоящего — иначе копию выдал бы удар о стену.
      vfx(_sim, api, 'f7_fxwall', m.x, m.y, 1.0, { vA: m.dir }, 0.6);
      vShake(_sim, m.x, m.y, 0.2); // v2.86 — только рисунок
      m.bounce = false;
      api.setMode(m, 'recover');
      m.data.rec = 0.7;
    }
  },
  onHit(sim, m, _hit, api) {
    // Копия: удар — звон, и она рассыпается осколками (они режут, если стоять).
    shatterCopy(sim, api, m);
    return 0;
  },
});

function shatterCopy(sim: Sim, api: SimApi, m: Mob): void {
  if (m.mode === 'dying') return;
  api.setMode(m, 'dying');
  m.tele = null;
  m.danger = 0;
  m.data.ghost = 1;
  sim.events.push({ t: 'break', x: m.x, y: m.y, kind: 'f7_glass' });
  api.strike(sim, {
    shape: 'circle',
    x: m.x,
    y: m.y,
    r: 1.25,
    warn: 0.4,
    dmg: m.dmg * 0.35,
    knock: 4,
    art: 'f7_copyburst',
  });
  // v2.86 — только рисунок: осколки копии ложатся на пол, когда она лопнет.
  vfx(sim, api, 'f7_fxburst', m.x, m.y, 3, { warn: 0.4 });
}

/** Места у люстры посреди арены: кольцо, куда встают копии. */
function ringSlots(sim: Sim, api: SimApi, n: number, r: number): [number, number][] {
  const st = STATE.get(sim);
  const cx = st?.arena?.cx ?? sim.hero.x;
  const cy = (st?.arena?.cy ?? sim.hero.y) - 1;
  const out: [number, number][] = [];
  const off = sim.rng() * TAU;
  for (let i = 0; i < n; i++) {
    let x = cx + Math.cos(off + (i / n) * TAU) * r;
    let y = cy + Math.sin(off + (i / n) * TAU) * r * 0.85;
    for (
      let k = 0;
      k < 8 && (api.solidTile(sim, Math.floor(x), Math.floor(y)) || !api.inArena(sim, x, y));
      k++
    ) {
      x = cx + (x - cx) * 0.8;
      y = cy + (y - cy) * 0.8;
    }
    out.push([x, y]);
  }
  return out;
}

/** Разделиться: настоящее и копии встают на кольцо (все — сквозь зеркала). */
function split(sim: Sim, api: SimApi, lead: Mob, copies: number): void {
  const slots = ringSlots(sim, api, copies + 1, 4.6);
  // Настоящее — на случайное место кольца.
  const mine = Math.floor(sim.rng() * slots.length);
  lead.data.nx = slots[mine][0];
  lead.data.ny = slots[mine][1];
  api.setMode(lead, 'shift');
  let n = 0;
  slots.forEach(([x, y], i) => {
    if (i === mine) return;
    const c = api.spawnMob(sim, 'f7boss_copy', lead.x, lead.y, {
      mode: 'shift',
      level: lead.level,
    });
    c.hp = c.maxHp = lead.maxHp;
    c.dmg = lead.dmg;
    c.data.nx = x;
    c.data.ny = y;
    c.data.slot = n++;
    c.data.ghost = 1;
    c.face = lead.face;
  });
  sim.events.push({
    t: 'boss',
    what: 'split',
    text: 'ОТРАЖЕНИЯ',
    sub: 'настоящее отбрасывает тень',
  });
}

/** Все меняются местами: сквозь зеркала, одним шагом. */
function shuffle(sim: Sim, api: SimApi): void {
  const all = sim.mobs.filter((m) => isBossKind(m.kind) && m.mode !== 'dying');
  const slots = ringSlots(sim, api, all.length, 4.2 + sim.rng());
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(sim.rng() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  all.forEach((m, i) => {
    m.data.nx = slots[i][0];
    m.data.ny = slots[i][1];
    m.tele = null;
    api.setMode(m, 'shift');
  });
  sim.events.push({ t: 'boss', what: 'f7_shuffle_call' });
}

/** Залп осколков из зеркал арены: линии через зал с просветами. */
function volley(sim: Sim, api: SimApi, st: F7State): void {
  const w = sim.world;
  const h = sim.hero;
  const pool = st.arenaMirrors.filter(
    (i) => markAt(sim, i % w.w, Math.floor(i / w.w)) === F7_MARK.arena,
  );
  const src = pool.length > 6 ? pool : st.arenaMirrors;
  // Одна линия — точно через героя, остальные — вразброс, не соседние.
  const picks: number[] = [];
  const n = 5 + Math.floor(sim.rng() * 3);
  let guard = 0;
  while (picks.length < n && guard++ < 200) {
    const i = src[Math.floor(sim.rng() * src.length)];
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    if (picks.some((j) => Math.abs((j % w.w) - x) + Math.abs(Math.floor(j / w.w) - y) < 4))
      continue;
    picks.push(i);
  }
  const cx = st.arena?.cx ?? h.x;
  const cy = st.arena?.cy ?? h.y;
  picks.forEach((i, k) => {
    const x = (i % w.w) + 0.5;
    const y = Math.floor(i / w.w) + 0.5;
    // Первая линия — на героя; остальные — к середине зала с разбросом.
    const ang =
      k === 0 ? Math.atan2(h.y - y, h.x - x) : Math.atan2(cy - y, cx - x) + (sim.rng() - 0.5) * 0.7;
    // Начало — на полу у зеркала.
    let sx = x;
    let sy = y;
    for (let d = 0; d < 2 && api.solidTile(sim, Math.floor(sx), Math.floor(sy)); d += 0.1) {
      sx += Math.cos(ang) * 0.1;
      sy += Math.sin(ang) * 0.1;
    }
    const len = wallDist(sim, api, sx, sy, ang, 34) - 0.3;
    const z: ZoneIn & { mi: number } = {
      x: sx,
      y: sy,
      r: 0.5,
      life: BOSS.volleyWarn,
      art: 'f7_mirrorglow',
      mi: i,
    };
    api.zone(sim, z);
    api.strike(sim, {
      shape: 'line',
      x: sx,
      y: sy,
      r: Math.max(1, len),
      w: 0.42,
      ang,
      warn: BOSS.volleyWarn,
      dmg: rawShare(sim, 0.17),
      knock: 4,
      art: 'f7_shardline',
    });
    // v2.86 — только рисунок: осколки залпа ложатся вдоль линии.
    vfx(sim, api, 'f7_fxvolley', sx, sy, 4, { warn: BOSS.volleyWarn, vA: ang, vL: Math.max(1, len) });
    // Зеркало трескается — навсегда до конца боя.
    st.cracked.add(i);
    st.bursts.push({ t: BOSS.volleyWarn, x: sx, y: sy, n: -1, dmg: i, kind: 'crack' });
  });
  sim.events.push({ t: 'boss', what: 'f7_volley_call' });
}

registerBoss('f7boss', {
  start(sim, b, lead, api) {
    b.phase = 0;
    b.data = { said: 0, t: 0, shuf: 0, resplit: 0, volley: 2 };
    lead.face = Math.PI / 2;
    api.setMode(lead, 'intro');
    lead.data.ghost = 1;
    F7_VIEW.bossPhase = 0;
    const st = stateOf(sim, api);
    setArenaLight(sim, st, 0);
    vfx(sim, api, 'f7_fxemerge', lead.x, lead.y, 1.6, { vA: Math.PI / 2, vK: 1 }, 1.4); // v2.86 — только рисунок
  },
  step(sim, b, dt, api) {
    const st = stateOf(sim, api);
    const lead = sim.mobs.find((m) => m.kind === 'f7boss' && m.mode !== 'dying');
    if (!lead) return;
    b.data.t = (b.data.t ?? 0) + dt;
    if (!b.data.said && b.t > 1.3) {
      b.data.said = 1;
      sim.events.push({
        t: 'boss',
        what: 'f7_duel',
        text: 'ДУЭЛЬ',
        sub: 'оно повторяет твои удары — бей после серии',
      });
    }
    const k = lead.hp / lead.maxHp;
    const copies = sim.mobs.filter((m) => m.kind === 'f7boss_copy' && m.mode !== 'dying');
    // Фаза 1 — тени.
    if (b.phase === 0 && k < F7_NOTCHES[0]) {
      b.phase = 1;
      F7_VIEW.bossPhase = 1;
      setArenaLight(sim, st, 1);
      vfx(sim, api, 'f7_fxphase', lead.x, lead.y, 2.2, { vP: 1 }, 1.4); // v2.86 — только рисунок
      split(sim, api, lead, 3);
      b.data.shuf = BOSS.shuffle;
      b.data.resplit = 0;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ФАЗА ТЕНЕЙ',
        sub: 'свет погас — настоящее отбрасывает тень',
      });
      return;
    }
    if (b.phase === 1) {
      b.data.shuf -= dt;
      if (b.data.shuf <= 0 && copies.length) {
        b.data.shuf = BOSS.shuffle;
        shuffle(sim, api);
      }
      if (!copies.length) {
        b.data.resplit = (b.data.resplit ?? 0) + dt;
        if (b.data.resplit > 3.5 && lead.mode !== 'shift') {
          b.data.resplit = 0;
          b.data.shuf = BOSS.shuffle;
          split(sim, api, lead, 4);
        }
      } else b.data.resplit = 0;
    }
    // Фаза 2 — отражённый свет: копии сливаются обратно.
    if (b.phase === 1 && k < F7_NOTCHES[1]) {
      b.phase = 2;
      F7_VIEW.bossPhase = 2;
      for (const c of copies) shatterCopy(sim, api, c);
      setArenaLight(sim, st, 2);
      vfx(sim, api, 'f7_fxphase', lead.x, lead.y, 2.2, { vP: 2 }, 1.4); // v2.86 — только рисунок
      lead.data.mdCd = 1.5;
      lead.data.gazeCd = 4;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ОТРАЖЁННЫЙ СВЕТ',
        sub: 'уходит в зеркала и бьёт насквозь; не стой в его взгляде',
      });
      return;
    }
    // Фаза 3 — разбитое зеркало.
    if (b.phase === 2 && k < F7_NOTCHES[2]) {
      b.phase = 3;
      F7_VIEW.bossPhase = 3;
      setArenaLight(sim, st, 3);
      vfx(sim, api, 'f7_fxphase', lead.x, lead.y, 2.2, { vP: 3 }, 1.4); // v2.86 — только рисунок
      b.data.volley = 1.4;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'РАЗБИТОЕ ЗЕРКАЛО',
        sub: 'осколки летят по линиям — ищи просвет',
      });
      return;
    }
    if (b.phase === 3) {
      b.data.volley -= dt;
      if (b.data.volley <= 0) {
        b.data.volley = BOSS.volley;
        volley(sim, api, st);
      }
    }
  },
  notches() {
    return F7_NOTCHES;
  },
  reset(sim, b) {
    // Арена как до боя: зеркала целы, свет прежний, копий нет.
    const st = STATE.get(sim);
    sim.mobs = sim.mobs.filter((m) => m.kind !== 'f7boss_copy');
    F7_VIEW.bossPhase = -1;
    b.data = {};
    if (!st) return;
    restoreArena(sim, st);
    setArenaLight(sim, st, -1);
  },
});

function restoreArena(sim: Sim, st: F7State): void {
  const w = sim.world;
  for (const i of st.cracked) {
    sim.tiles[i] = T.Wall;
    w.mark[i] = F7_MARK.arena;
    sim.retiled.push(i);
  }
  st.cracked.clear();
  for (const i of st.scars) {
    w.mark[i] = F7_MARK.mosaic;
    sim.retiled.push(i);
  }
  st.scars = [];
  st.bursts = st.bursts.filter((p) => p.kind !== 'crack');
}

/** Свет арены по фазе: −1 — как до боя. */
function setArenaLight(sim: Sim, st: F7State, phase: number): void {
  if (st.lightPhase === phase) return;
  st.lightPhase = phase;
  for (const a of st.arenaLights) {
    const l = st.lights[a.i];
    if (!l) continue;
    const center = a.i === st.arenaCenter;
    if (phase <= 0) {
      l.r = a.r;
      l.tint = a.tint;
    } else if (phase === 1) {
      // Тени: светит только люстра.
      l.r = center ? a.r + 1.6 : 0;
      l.tint = 'cold';
    } else if (phase === 2) {
      l.r = center ? a.r * 0.8 : a.r + 1;
      l.tint = 'violet';
    } else {
      l.r = center ? a.r : a.r + 0.6;
      l.tint = center ? 'violet' : 'red';
    }
  }
}

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

/** Постоянные зоны-картинки (нити, отражения, тень босса): вернуть, если их сбросили. */
function keepZone(sim: Sim, api: SimApi, st: F7State, key: string, make: () => ZoneIn): number {
  const id = st.zones.get(key) ?? 0;
  if (id && sim.zones.some((z) => z.id === id)) return id;
  api.zone(sim, make());
  const nid = sim.zones[sim.zones.length - 1]?.id ?? 0;
  st.zones.set(key, nid);
  return nid;
}

function dropZone(sim: Sim, st: F7State, key: string): void {
  const id = st.zones.get(key);
  if (!id) return;
  const z = sim.zones.find((q) => q.id === id);
  if (z) {
    z.life = 0;
    z.t = 1e9;
  }
  st.zones.delete(key);
}

function stepBirths(sim: Sim, api: SimApi, st: F7State, dt: number): void {
  const keep: Birth[] = [];
  for (const b of st.births) {
    b.t -= dt;
    if (b.t > 0) {
      keep.push(b);
      continue;
    }
    const m = finishBirth(sim, api, b);
    if (m && m.kind === 'f7_echo') setAxis(sim, m);
    if (m && st.bigState === 'waves' && !b.mob) st.bigMobs.push(m.id);
  }
  st.births = keep;
}

function stepHistory(sim: Sim, st: F7State): void {
  const h = sim.hero;
  st.hist.push({ t: sim.time, x: h.x, y: h.y, face: h.face });
  while (st.hist.length > 2 && st.hist[0].t < sim.time - 2) st.hist.shift();
  // Взмах героя — отражения рядом повторят его зеркально.
  for (const e of sim.events) {
    if (e.t !== 'swing') continue;
    for (const m of sim.mobs) {
      if (m.kind !== 'f7_echo' || m.mode !== 'mirror') continue;
      if (hypot(m.x - h.x, m.y - h.y) > 7) continue;
      copySwing(m, mirrorAng(m, e.ang), e.arc, e.reach, e.heavy);
    }
  }
}

function stepFrames(sim: Sim, api: SimApi, st: F7State, dt: number, fight: boolean): void {
  const h = sim.hero;
  for (const f of st.frames) {
    const p = f.prop;
    const id = p.obj.id;
    if (!p.alive) {
      // Раму разбили — её тень рассеивается.
      if (f.mob) {
        const m = sim.mobs.find((x) => x.id === f.mob && x.mode !== 'dying');
        if (m) {
          api.setMode(m, 'dying');
          m.data.ghost = 1;
          sim.events.push({
            t: 'boss',
            what: 'f7_frame_call',
            text: 'РАМА РАЗБИТА',
            sub: 'тень рассеялась',
          });
        }
        f.mob = 0;
      }
      F7_VIEW.frames.set(id, 4);
      continue;
    }
    f.t -= dt;
    switch (f.state) {
      case 'armed': {
        const d = hypot(p.x - h.x, p.y - h.y);
        if (!fight && d < 4.4 && api.lineOfSight(sim, h.x, h.y, p.x, p.y) && !heroDown(sim)) {
          f.state = 'stir';
          f.t = 0.95;
          const z: ZoneIn = { x: p.x, y: p.y, r: 0.6, life: 0.95, art: 'f7_stir' };
          api.zone(sim, z);
          sim.events.push({ t: 'squeak', x: p.x, y: p.y });
        }
        break;
      }
      case 'stir':
        if (f.t <= 0) {
          const m = api.spawnMob(sim, 'f7_shadow', p.x, p.y + 0.5, { mode: 'f7_step' });
          m.data.ghost = 1;
          m.data.fx = p.x;
          m.data.fy = p.y + 0.5;
          m.data.frame = p.id;
          m.face = Math.atan2(h.y - m.y, h.x - m.x);
          api.collide(sim, m);
          f.mob = m.id;
          f.state = 'out';
          sim.events.push({ t: 'emerge', x: p.x, y: p.y + 0.5 });
        }
        break;
      case 'out': {
        const m = sim.mobs.find((x) => x.id === f.mob);
        if (!m || m.mode === 'dying' || m.mode === 'escape') {
          // Убита — рама остывает дольше; вернулась — быстро готова снова.
          f.state = 'cool';
          f.t = !m || m.mode === 'dying' ? 32 : 6;
          f.mob = 0;
        }
        break;
      }
      case 'cool':
        if (f.t <= 0 && hypot(p.x - h.x, p.y - h.y) > 6) f.state = 'armed';
        break;
    }
    F7_VIEW.frames.set(
      id,
      f.state === 'armed' ? 0 : f.state === 'stir' ? 1 : f.state === 'out' ? 2 : 3,
    );
  }
}

function stepThreads(sim: Sim, api: SimApi, st: F7State): void {
  const h = sim.hero;
  st.threads.forEach((t, i) => {
    const key = `thread:${i}`;
    if (t.broken) {
      if (sim.time - t.at > 28 && hypot(t.cx - h.x, t.cy - h.y) > 8) {
        t.broken = false;
      } else {
        dropZone(sim, st, key);
        return;
      }
    }
    keepZone(sim, api, st, key, () => {
      const z: ZoneIn & { x0: number; y0: number; x1: number; y1: number } = {
        x: (t.x0 + t.x1) / 2,
        y: (t.y0 + t.y1) / 2,
        r: 0.3,
        life: 1e9,
        art: 'f7_thread',
        x0: t.x0,
        y0: t.y0,
        x1: t.x1,
        y1: t.y1,
      };
      return z;
    });
    if (heroDown(sim)) return;
    // Задел нить — режет, лопается, пауки падают сверху.
    const dx = t.x1 - t.x0;
    const dy = t.y1 - t.y0;
    const L2 = dx * dx + dy * dy || 1;
    const k = Math.max(0, Math.min(1, ((h.x - t.x0) * dx + (h.y - t.y0) * dy) / L2));
    const px = t.x0 + dx * k;
    const py = t.y0 + dy * k;
    if (hypot(h.x - px, h.y - py) > h.r + 0.1) return;
    t.broken = true;
    t.at = sim.time;
    dropZone(sim, st, key);
    const z: ZoneIn & { x0: number; y0: number; x1: number; y1: number } = {
      x: px,
      y: py,
      r: 0.4,
      life: 0.45,
      art: 'f7_snap',
      x0: t.x0,
      y0: t.y0,
      x1: t.x1,
      y1: t.y1,
    };
    api.zone(sim, z);
    if (h.mode !== 'dash') {
      api.hurtHero(sim, rawShare(sim, 0.05), px, py, 1, undefined, { kind: 'slow', dur: 1.1 });
    }
    sim.events.push({ t: 'clank', x: px, y: py });
    const alive = sim.mobs.filter(
      (m) => m.kind === 'f7_spider' && m.mode !== 'dying' && hypot(m.x - px, m.y - py) < 8,
    ).length;
    const n = Math.max(0, Math.min(2, 3 - alive));
    for (let j = 0; j < n; j++) {
      const a = sim.rng() * TAU;
      let x = h.x + Math.cos(a) * 2.2;
      let y = h.y + Math.sin(a) * 2.2;
      if (api.solidTile(sim, Math.floor(x), Math.floor(y))) {
        x = h.x - Math.cos(a) * 2.2;
        y = h.y - Math.sin(a) * 2.2;
      }
      if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
      const m = api.spawnMob(sim, 'f7_spider', x, y, { mode: 'drop' });
      m.t = -j * 0.2;
    }
    sim.events.push({
      t: 'boss',
      what: 'f7_thread_trap',
      text: 'НИТЬ',
      sub: 'пауки падают сверху',
    });
  });
}

function stepCocoons(sim: Sim, api: SimApi, st: F7State, fight: boolean): void {
  const h = sim.hero;
  if (fight || heroDown(sim)) return;
  for (const p of st.cocoons) {
    const id = p.obj.id;
    const at = F7_VIEW.cocoons.get(id) ?? -999;
    if (sim.time - at < 75) continue;
    const d = hypot(p.x - h.x, p.y - h.y);
    if (d > 5 || d < 1.5) continue;
    if (!api.lineOfSight(sim, h.x, h.y, p.x, p.y)) continue;
    const moths = sim.mobs.filter(
      (m) => m.kind === 'f7_moth' && m.mode !== 'dying' && hypot(m.x - p.x, m.y - p.y) < 8,
    ).length;
    F7_VIEW.cocoons.set(id, sim.time);
    if (moths >= 3) continue;
    const z: ZoneIn = { x: p.x, y: p.y, r: 0.6, life: 0.6, art: 'f7_hatch' };
    api.zone(sim, z);
    const n = 1 + (sim.rng() < 0.5 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const m = api.spawnMob(sim, 'f7_moth', p.x + (j - 0.5) * 0.6, p.y - 0.2, { mode: 'f7_step' });
      m.data.ghost = 1;
      m.t = -j * 0.25;
      m.cd = 1.2;
    }
    sim.events.push({ t: 'squeak', x: p.x, y: p.y });
  }
}

function stepPortals(sim: Sim, api: SimApi, st: F7State, dt: number): void {
  const h = sim.hero;
  for (let i = 1; i <= 4; i++) F7_VIEW.warp[i] = Math.max(0, F7_VIEW.warp[i] - dt * 2);
  if (heroDown(sim) || !st.portals.length) return;
  // Вышел из рамы, куда перенесло, — рама снова работает.
  if (st.warpLock >= 0) {
    const e = st.portals[st.warpLock];
    if (!e || hypot(e.x - h.x, e.y - h.y) > 0.9) st.warpLock = -1;
  }
  let here = -1;
  st.portals.forEach((e, i) => {
    if (i !== st.warpLock && hypot(e.x - h.x, e.y - h.y) < 0.45) here = i;
  });
  if (here < 0 || h.mode === 'dash') {
    st.warpT = 0;
    st.warpFrom = -1;
    return;
  }
  if (st.warpFrom !== here) {
    st.warpFrom = here;
    st.warpT = 0;
  }
  st.warpT += dt;
  const from = st.portals[here];
  F7_VIEW.warp[from.pair] = Math.min(1, st.warpT / WARP_DWELL);
  const to = st.portals.findIndex((e, j) => j !== here && e.pair === from.pair);
  if (to < 0) return;
  const dest = st.portals[to];
  // За миг до переноса — вспышка в парной раме: видно, куда.
  if (st.warpT >= WARP_DWELL - 0.25 && !st.zones.has('warp')) {
    const z: ZoneIn & { pair: number } = {
      x: dest.x,
      y: dest.y,
      r: 0.7,
      life: 0.55,
      art: 'f7_warp',
      pair: dest.pair,
    };
    api.zone(sim, z);
    st.zones.set('warp', 1);
  }
  if (st.warpT >= WARP_DWELL) {
    const z: ZoneIn & { pair: number } = {
      x: from.x,
      y: from.y,
      r: 0.7,
      life: 0.4,
      art: 'f7_warp',
      pair: from.pair,
    };
    api.zone(sim, z);
    api.moveHero(sim, dest.x, dest.y + 0.1);
    st.warpLock = to;
    st.warpT = 0;
    st.warpFrom = -1;
    st.zones.delete('warp');
    F7_VIEW.warp[from.pair] = 1;
    sim.events.push({ t: 'boss', what: 'f7_warp_call' });
  }
}

/** Ложные проходы: упёрся в отражение коридора — зеркало треснуло. */
function stepFakes(sim: Sim, api: SimApi): void {
  const h = sim.hero;
  if (heroDown(sim)) return;
  const sp = hypot(h.vx, h.vy);
  const cx = Math.floor(h.x);
  const cy = Math.floor(h.y);
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    const x = cx + dx;
    const y = cy + dy;
    if (markAt(sim, x, y) !== F7_MARK.fake || tileAt(sim, x, y) !== T.Wall) continue;
    // Край клетки-зеркала рядом с телом, и герой жмёт в неё.
    const ex = dx === 0 ? h.x : dx > 0 ? x : x + 1;
    const ey = dy === 0 ? h.y : dy > 0 ? y : y + 1;
    if (hypot(h.x - ex, h.y - ey) > h.r + 0.12) continue;
    // Жмёт в него: идёт и смотрит в зеркало (просто стоять рядом — не считается).
    const into = Math.cos(h.face) * dx + Math.sin(h.face) * dy;
    if (!(sp > 0.4 && into > 0.55) && h.mode !== 'dash') continue;
    api.setTile(sim, x, y, T.Wall, F7_MARK.cracked);
    // Второй слой обманки (клетка за зеркалом) гаснет: хода там нет.
    if (markAt(sim, x + dx, y + dy) === F7_MARK.fake) api.setTile(sim, x + dx, y + dy, T.Wall, 0);
    sim.events.push({ t: 'clank', x: x + 0.5, y: y + 0.5 });
    sim.events.push({
      t: 'boss',
      what: 'f7_fake_call',
      text: 'ОТРАЖЕНИЕ',
      sub: 'это был не проход — зеркало',
    });
    // Из трещины иногда выходит отражение.
    if (sim.rng() < 0.45 && !api.solidTile(sim, x - dx, y - dy)) {
      const spot: MirrorSpot = {
        x,
        y,
        ox: x - dx,
        oy: y - dy,
        ready: 0,
        area: sim.world.rowArea[y],
      };
      startBirth(sim, api, spot, 'f7_echo', { warn: 0.7 });
    }
    return;
  }
}

/** Иллюзия: прошёл сквозь нарисованное зеркало — рябь. */
function stepIllusions(sim: Sim, api: SimApi, st: F7State): void {
  const h = sim.hero;
  const x = Math.floor(h.x);
  const y = Math.floor(h.y);
  if (markAt(sim, x, y) !== F7_MARK.illusion) return;
  const key = `ill:${x}:${y}`;
  if (st.zones.has(key)) return;
  st.zones.set(key, 1);
  const z: ZoneIn & { mx: number; my: number } = {
    x: x + 0.5,
    y: y + 0.5,
    r: 0.5,
    life: 0.7,
    art: 'f7_ripple',
    mx: x,
    my: y,
  };
  api.zone(sim, z);
  if (!st.illusionSaid) {
    st.illusionSaid = true;
    sim.events.push({
      t: 'boss',
      what: 'f7_illusion_call',
      text: 'СКВОЗЬ ЗЕРКАЛО',
      sub: 'это отражение — за ним ход',
    });
  }
}

/** Отложенные: осколки лопнувшего голема, треск зеркал арены. */
function stepBursts(sim: Sim, api: SimApi, st: F7State, dt: number): void {
  const keep: Pending[] = [];
  for (const p of st.bursts) {
    p.t -= dt;
    if (p.t > 0) {
      keep.push(p);
      continue;
    }
    if (p.kind === 'crack') {
      const i = p.dmg;
      const x = i % sim.world.w;
      const y = Math.floor(i / sim.world.w);
      if (sim.boss?.state === 'fight') {
        api.setTile(sim, x, y, T.Wall, F7_MARK.cracked);
        const z: ZoneIn = {
          x: p.x,
          y: p.y,
          r: 0.75,
          life: 14,
          slow: 0.72,
          dps: 0.012,
          art: 'f7_shardfloor',
        };
        api.zone(sim, z);
      }
      continue;
    }
    if (p.n > 0) {
      // Осколки веером из точки (голем лопнул).
      const fake = {
        id: -1,
        kind: p.kind,
        x: p.x,
        y: p.y,
        r: 0.3,
        dmg: p.dmg,
      } as unknown as Mob;
      const off = sim.rng() * TAU;
      for (let i = 0; i < p.n; i++) api.shoot(sim, fake, off + (i / p.n) * TAU, SHARD);
      sim.events.push({ t: 'break', x: p.x, y: p.y, kind: 'f7_glass' });
    }
    const z: ZoneIn = { x: p.x, y: p.y, r: 1.4, life: 0.5, art: 'f7_shatter' };
    api.zone(sim, z);
  }
  st.bursts = keep;
}

/** Зал большого зеркала: разбил — перемычка открыта, из осколков лезут отражения. */
function stepBigMirror(sim: Sim, api: SimApi, st: F7State, dt: number): void {
  const p = st.big;
  if (!p) return;
  F7_VIEW.bigHits = Math.max(0, p.maxHp - p.hp);
  F7_VIEW.bigBroken = !p.alive;
  const h = sim.hero;
  if (st.bigState === 'intact') {
    if (p.alive) return;
    st.bigState = 'waves';
    st.bigT = 0.8;
    st.bigWave = 0;
    // Перемычка за зеркалом — пол: там тайник.
    const w = sim.world;
    for (let i = 0; i < w.w * w.h; i++)
      if (w.mark[i] === F7_MARK.behind)
        api.setTile(sim, i % w.w, Math.floor(i / w.w), T.Floor, F7_MARK.obsidian);
    // Осколки на полу перед зеркалом.
    for (let k = 0; k < 6; k++) {
      const a = Math.PI * (0.15 + 0.7 * (k / 5));
      const z: ZoneIn = {
        x: p.x + Math.cos(a) * (1.4 + (k % 2) * 1.2),
        y: p.y + Math.sin(a) * (1.2 + (k % 3) * 0.8),
        r: 0.7,
        life: 26,
        slow: 0.75,
        dps: 0.01,
        art: 'f7_shardfloor',
      };
      api.zone(sim, z);
    }
    sim.events.push({ t: 'boss', what: 'f7_mirror_wall' });
    sim.events.push({
      t: 'boss',
      what: 'f7_mirror_trap',
      text: 'ЗЕРКАЛО РАЗБИТО',
      sub: 'из осколков лезут отражения',
    });
    return;
  }
  if (st.bigState !== 'waves') return;
  st.bigT -= dt;
  const alive = st.bigMobs.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));
  st.bigMobs = alive;
  const waves: [string, boolean][][] = [
    [
      ['f7_echo', false],
      ['f7_echo', false],
      ['f7_echo', false],
    ],
    [
      ['f7_echo', false],
      ['f7_phantom', false],
      ['f7_echo', false],
    ],
    [
      ['f7_echo', true],
      ['f7_echo', false],
      ['f7_phantom', false],
    ],
  ];
  // Событие ждёт героя: ушёл из зала — волны не лезут, «тишина» не
  // объявляется где-то в другом районе (отражения далеко исчезают сами).
  const near = Math.hypot(h.x - p.x, h.y - p.y) < 13;
  if (st.bigWave < waves.length) {
    if (near && st.bigT <= 0 && (alive.length <= 1 || st.bigT < -9) && !heroDown(sim)) {
      const wave = waves[st.bigWave];
      wave.forEach(([kind, elite], k) => {
        // Из осколка на полу: отражение поднимается из стекла.
        const a = Math.PI * (0.2 + 0.6 * (k / Math.max(1, wave.length - 1)));
        const x = p.x + Math.cos(a) * 2.2;
        const y = p.y + Math.sin(a) * 1.8;
        if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return;
        const spot: MirrorSpot = {
          x: Math.floor(x),
          y: Math.floor(y),
          ox: Math.floor(x),
          oy: Math.floor(y),
          ready: 0,
          area: sim.world.rowArea[Math.floor(y)],
        };
        st.births.push({ t: 0.9 + k * 0.25, kind, spot, elite, mob: 0 });
        const z: ZoneIn = { x: x, y: y, r: 0.6, life: 1.1 + k * 0.25, art: 'f7_rise' };
        api.zone(sim, z);
      });
      st.bigWave += 1;
      st.bigT = 7;
    }
    return;
  }
  if (near && !alive.length && !st.births.length) {
    st.bigState = 'done';
    sim.events.push({
      t: 'boss',
      what: 'f7_clear_call',
      text: 'ТИШИНА',
      sub: 'за зеркалом — тайник',
    });
  }
}

/** Зал призм: хрусталь запирает выходы, пока призмы целы. */
function stepPrismHall(sim: Sim, api: SimApi, st: F7State, dt: number, fight: boolean): void {
  const hall = st.hall;
  if (!hall || st.hallState === 'done') return;
  const h = sim.hero;
  const w = sim.world;
  const open = () => {
    for (const i of hall.seams)
      api.setTile(sim, i % w.w, Math.floor(i / w.w), T.Floor, F7_MARK.seam);
  };
  if (st.hallState === 'idle') {
    if (fight || heroDown(sim)) return;
    if (hypot(h.x - hall.cx, h.y - hall.cy) > 5.5) return;
    st.hallState = 'warn';
    st.hallT = 1.1;
    for (const i of hall.seams) {
      const z: ZoneIn = {
        x: (i % w.w) + 0.5,
        y: Math.floor(i / w.w) + 0.5,
        r: 0.55,
        life: 1.1,
        art: 'f7_grow',
      };
      api.zone(sim, z);
    }
    sim.events.push({
      t: 'boss',
      what: 'f7_prisms_trap',
      text: 'ЗАЛ ПРИЗМ',
      sub: 'хрусталь запирает выходы — разбей призмы',
    });
    return;
  }
  if (st.hallState === 'warn') {
    st.hallT -= dt;
    if (st.hallT > 0) return;
    for (const i of hall.seams) {
      const x = i % w.w;
      const y = Math.floor(i / w.w);
      // Кто стоит в шве — выталкивается внутрь.
      if (Math.floor(h.x) === x && Math.floor(h.y) === y) {
        const a = Math.atan2(hall.cy - h.y, hall.cx - h.x);
        api.moveHero(sim, h.x + Math.cos(a) * 1.2, h.y + Math.sin(a) * 1.2);
      }
      api.setTile(sim, x, y, T.Wall, F7_MARK.crystal);
    }
    st.hallState = 'closed';
    st.hallMobs = [];
    // Призмы поднимаются с подставок, пауки падают со свода.
    const stands = hall.stands.slice(0, 4);
    stands.forEach((p, k) => {
      if (k > 2) return;
      const m = api.spawnMob(sim, 'f7_prism', p.x, p.y - 0.6, { mode: 'f7_rise' });
      m.data.ghost = 1;
      st.hallMobs.push(m.id);
    });
    for (let k = 0; k < 2; k++) {
      const a = sim.rng() * TAU;
      const m = api.spawnMob(
        sim,
        'f7_spider',
        hall.cx + Math.cos(a) * 3,
        hall.cy + Math.sin(a) * 3,
        {
          mode: 'drop',
        },
      );
      m.t = -0.3 * k;
    }
    return;
  }
  if (st.hallState === 'closed') {
    if (heroDown(sim)) {
      // Пал — хрусталь осыпается, зал ждёт следующего.
      open();
      st.hallState = 'idle';
      return;
    }
    const alive = st.hallMobs.filter((id) =>
      sim.mobs.some((m) => m.id === id && m.mode !== 'dying'),
    );
    if (alive.length) return;
    open();
    st.hallState = 'done';
    api.dropAt(sim, 'token', 3, hall.cx, hall.cy);
    api.dropAt(sim, 'coin', 900, hall.cx, hall.cy);
    api.dropAt(sim, 'f7_core', 1, hall.cx, hall.cy);
    api.dropAt(sim, 'f7mat', 2, hall.cx, hall.cy);
    sim.events.push({
      t: 'boss',
      what: 'f7_prisms_call',
      text: 'ХРУСТАЛЬ ОСЫПАЛСЯ',
      sub: 'выходы свободны',
    });
  }
}

/** Коридор отражений: твоё отражение отстаёт — и выходит к тебе. */
function stepCorridor(sim: Sim, api: SimApi, st: F7State, dt: number, fight: boolean): void {
  const c = st.corridor;
  if (!c) return;
  const h = sim.hero;
  if (F7_VIEW.lagX >= 0) {
    F7_VIEW.lagT += dt;
    if (F7_VIEW.lagT > 1.3) {
      const x = Math.floor(F7_VIEW.lagX);
      const spot: MirrorSpot = { x, y: c.face, ox: x, oy: c.face + 1, ready: 0, area: F7_HALL };
      const b: Birth = { t: 0, kind: 'f7_echo', spot, elite: true, mob: 0 };
      const m = finishBirth(sim, api, b);
      if (m) setAxis(sim, m);
      for (let k = 0; k < 2; k++) {
        const s = pickMirror(sim, api, 3, 9);
        if (s) startBirth(sim, api, s, 'f7_echo', { warn: 0.8 + k * 0.4 });
      }
      F7_VIEW.lagX = -1;
      F7_VIEW.lagT = 0;
    }
    return;
  }
  if (st.corridorDone || fight || heroDown(sim)) return;
  if (h.y < c.y0 || h.y > c.y1 + 1) return;
  // Середина коридора пройдена в любую сторону — отражение замирает.
  const mid = (c.x0 + c.x1) / 2;
  const span = (c.x1 - c.x0) / 2;
  if (Math.abs(h.x - mid) < span * 0.62) return;
  st.corridorDone = true;
  F7_VIEW.lagX = h.x - Math.sign(h.x - mid) * 2.5;
  F7_VIEW.lagY = c.face;
  F7_VIEW.lagT = 0;
  sim.events.push({
    t: 'boss',
    what: 'f7_lag_call',
    text: 'ОТРАЖЕНИЕ ОТСТАЛО',
    sub: 'оно больше не повторяет — оно идёт к тебе',
  });
}

/** Воришка: изредка выходит из зеркала поодаль. */
function stepThief(sim: Sim, api: SimApi, st: F7State, dt: number, fight: boolean): void {
  if (fight || heroDown(sim)) return;
  st.thiefT -= dt;
  if (st.thiefT > 0) return;
  st.thiefT = 260 + sim.rng() * 220;
  if (sim.mobs.some((m) => m.kind === 'f7_thief' && m.mode !== 'dying')) return;
  const s = pickMirror(sim, api, 8, 15);
  if (!s) {
    st.thiefT = 20;
    return;
  }
  startBirth(sim, api, s, 'f7_thief', { warn: 0.9 });
  sim.events.push({ t: 'gold', x: s.ox + 0.5, y: s.oy + 0.5, mob: 'f7_thief' });
}

registerFloor(7, {
  start(sim, api) {
    STATE.set(sim, scan(sim, api));
    F7_VIEW.bigHits = 0;
    F7_VIEW.bigBroken = false;
    F7_VIEW.frames.clear();
    F7_VIEW.cocoons.clear();
    F7_VIEW.lagX = -1;
    F7_VIEW.lagT = 0;
    F7_VIEW.bossPhase = -1;
  },
  step(sim, dt, api) {
    const st = stateOf(sim, api);
    const h = sim.hero;
    const fight = sim.boss?.state === 'fight';
    F7_VIEW.time = sim.time;
    stepHistory(sim, st);
    stepBirths(sim, api, st, dt);
    stepBursts(sim, api, st, dt);
    // Отражения героя в зеркалах — зона-картинка, живёт всегда.
    const rz = keepZone(sim, api, st, 'reflect', () => {
      const z: ZoneIn & { sim: Sim } = {
        x: h.x,
        y: h.y,
        r: 0.1,
        life: 1e9,
        art: 'f7_reflect',
        sim,
      };
      return z;
    });
    const reflect = sim.zones.find((z) => z.id === rz);
    if (reflect) {
      reflect.x = h.x;
      reflect.y = h.y;
    }
    // Тень настоящего отражения — в бою, от люстры.
    const lead = fight
      ? sim.mobs.find((m) => m.kind === 'f7boss' && m.mode !== 'dying')
      : undefined;
    if (lead && (sim.boss?.phase ?? 0) >= 1) {
      const sid = keepZone(sim, api, st, 'shadow', () => {
        const z: ZoneIn & { lx: number; ly: number; mob: number; sim: Sim } = {
          x: lead.x,
          y: lead.y,
          r: 0.1,
          life: 1e9,
          art: 'f7_trueshadow',
          lx: st.arena?.cx ?? lead.x,
          ly: (st.arena?.cy ?? lead.y) - 2,
          mob: lead.id,
          sim,
        };
        return z;
      });
      const z = sim.zones.find((q) => q.id === sid);
      if (z) {
        z.x = lead.x;
        z.y = lead.y;
      }
    } else if (st.zones.has('shadow')) dropZone(sim, st, 'shadow');
    // Бой кончился — копии рассыпаются, свет прежний.
    if (!fight) {
      if (sim.mobs.some((m) => m.kind === 'f7boss_copy'))
        for (const m of sim.mobs) if (m.kind === 'f7boss_copy') shatterCopy(sim, api, m);
      if (st.lightPhase !== -1) {
        setArenaLight(sim, st, -1);
        F7_VIEW.bossPhase = -1;
        if (sim.boss?.state === 'won' || sim.boss?.state === 'rest') restoreArena(sim, st);
      }
    }
    stepFrames(sim, api, st, dt, fight);
    stepThreads(sim, api, st);
    stepCocoons(sim, api, st, fight);
    stepPortals(sim, api, st, dt);
    stepFakes(sim, api);
    stepIllusions(sim, api, st);
    stepBigMirror(sim, api, st, dt);
    stepPrismHall(sim, api, st, dt, fight);
    stepCorridor(sim, api, st, dt, fight);
    stepThief(sim, api, st, dt, fight);
    if (heroDown(sim)) return;

    // Зеркала рожают, пока идёшь по этажу.
    st.birthT -= dt;
    if (st.birthT <= 0) {
      st.birthT = 8 + sim.rng() * 7;
      const nearLift = sim.safe.some((s) => hypot(s.x - h.x, s.y - h.y) < 11);
      const near = sim.mobs.filter(
        (m) => m.mode !== 'dying' && hypot(m.x - h.x, m.y - h.y) < 10,
      ).length;
      const live = sim.mobs.filter((m) => m.mode !== 'dying').length;
      if (!fight && !nearLift && live < 14 && near < 6) {
        const s = pickMirror(sim, api, 4, 11);
        if (s) startBirth(sim, api, s, mirrorKind(sim, s.area));
      }
    }
  },
});

// Названия районов — для тестов и рисовальщиков.
export { F7_CRYSTAL, F7_GALLERY, F7_HALL };
export type { F7State, MirrorSpot, Thread };
