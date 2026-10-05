// Этаж 12 «Проклятая станция» — правила этажа, ИИ монстров и сценарий
// Двуликого короля проклятий.
//
// ПОЕЗДА (`registerFloor(12)`):
//   • каждый путь с тоннелем в темноту на конце — живая линия со своим
//     расписанием. Семафор (столб `7`, сигнал `}` на стене) зелёный → жёлтый
//     за 6 с → красный за 2,6 с: рельсы наливаются красным, свет фар встаёт
//     из тоннеля, гудок, пол дрожит — и состав проходит линию целиком;
//   • кого застал на путях — сбит: герой — тяжёлый удар и отброс с путей
//     (рывок вдоль не спасает: состав идёт дольше неуязвимости рывка),
//     монстры — насмерть и в зачёт (удар по своим, `mobDmg`). Стаю можно
//     заманить на рельсы под поезд; Двуликого короля — тоже;
//   • в тоннелях поезд занимает и щебень по краям: спасение — ниши в стене;
//   • колокол дежурной (действие) зовёт состав на ближний путь сейчас;
//     стрелочный рычаг узловой (действие) уводит поезда на 15 с;
//     путевой обходчик машет фонарём — зовёт поезд на путь, где ты стоишь.
// ЭСКАЛАТОРЫ — ленты: несут героя и монстров, в событиях разгоняются и
//   идут вспять.
// ТЕРРИТОРИИ — круг со своими правилами: внутри метка «верного удара» ходит
//   за героем, наливается и бьёт — мимо брони; рывок не спасает (метка ждёт,
//   пока рывок кончится). Выход — за край круга или разбить три столба.
// СОБЫТИЯ (по два на район): «Час пик» и «Бегущая лестница» (Вестибюль),
//   «Сбой света» и «Встречный» (Платформы), «Малая территория» и «Последний
//   поезд» (Святилище).
//
// Честность: у всего, что бьёт, есть метка и время на ответ — у поезда
// семафор, красные рельсы и свет фар; у метки территории — кольцо, которое
// наливается; у разрезов храма — сетка и загорающиеся обереги.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, StrikeIn, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Sim, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F12_HALL, F12_MARK, F12_PLAT, F12_SHRINE } from './f12';

const TAU = Math.PI * 2;
const hypot = Math.hypot;
const MK = F12_MARK;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: значениями движок не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
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

/** Задевает ли линия (из точки по углу, длина, полуширина) круг. */
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

/** Сколько клеток до стены по направлению. */
function clearDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

/** Точка пола вокруг (x, y) на расстоянии r0…r1, дальняя от героя. */
function spotAway(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r0: number,
  r1: number,
): [number, number] | null {
  const h = sim.hero;
  let best: [number, number] | null = null;
  let bs = -1e9;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU + sim.rng() * 0.3;
    const r = r0 + sim.rng() * (r1 - r0);
    const cx = Math.floor(x + Math.cos(a) * r);
    const cy = Math.floor(y + Math.sin(a) * r);
    if (api.solidTile(sim, cx, cy) || onTrack(sim, cx + 0.5, cy + 0.5)) continue;
    const s = hypot(cx + 0.5 - h.x, cy + 0.5 - h.y) + sim.rng();
    if (s > bs) {
      bs = s;
      best = [cx + 0.5, cy + 0.5];
    }
  }
  return best;
}

/** Сказать один раз за `gap` секунд. */
function sayOnce(
  sim: Sim,
  key: string,
  gap: number,
  e: { what: string; text?: string; sub?: string },
): void {
  const st = stateOf(sim);
  if (sim.time - (st.said[key] ?? -1e9) < gap) return;
  st.said[key] = sim.time;
  sim.events.push({ t: 'boss', ...e });
}

// ---------------------------------------------------------------------------
// Общий черновик для рисовальщиков (один мир на экране).
// ---------------------------------------------------------------------------

/** Сигнал семафора: 0 — зелёный, 1 — жёлтый, 2 — красный, 3 — идёт, 4 — стрелка увела. */
export type SigState = 0 | 1 | 2 | 3 | 4;

/** Путь для рисовальщика рельсов (зона `f12_rails`). */
export interface TrackView {
  y: number;
  x0: number;
  x1: number;
  pad: number;
  dir: 1 | -1;
  sig: SigState;
  /** Сколько осталось до поезда, с (для пульса рельсов). */
  left: number;
  /** Где сейчас голова поезда (мир, x) — NaN, если поезда нет. */
  front: number;
  ghost: boolean;
}

/** Лента эскалатора (зона `f12_esc`). */
export interface EscView {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** −1 — на север, 1 — на юг, 0 — стоит. */
  dir: number;
  speed: number;
}

/** Территория (зона `f12_domain`) и метка на герое (`f12_mark`). */
export interface TerrView {
  r: number;
  age: number;
  /** Налилась метка, 0…1. */
  charge: number;
  /** Метка ждёт (герой в рывке). */
  hold: boolean;
  /** Разбита — трещит и гаснет. */
  broken: number;
  kind: 'doll' | 'hall';
}

/** Сетка разрезов храма (зона `f12_grid`). */
export interface GridView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  off: number;
  step: number;
  /** Когда режет (время мира) и сколько. */
  at: number;
  cut: number;
}

export const F12_FX = {
  /** Семафоры: «x,y» клетки → сигнал. */
  sig: new Map<string, SigState>(),
  /** Сбой света в прямоугольнике [x0, y0, x1, y1] (мир) — неон и лампы гаснут. */
  dark: null as null | [number, number, number, number],
  /** Храм развёрнут: 0…1 (рисовальщики стен и босса). */
  domain: 0,
  /** Рычаг узловой повёрнут до этого времени мира. */
  lever: 0,
  /** Время мира — для анимации в рисовальщиках предметов. */
  time: 0,
};

// ---------------------------------------------------------------------------
// Состояние вылазки.
// ---------------------------------------------------------------------------

interface TrackCfg {
  period: number;
  first: number;
  dir: 1 | -1;
  cars: number;
  speed: number;
  kind: 'normal' | 'ghost' | 'arena';
}

/** Расписание путей: район и местный ряд северного рельса. */
const TRACK_CFG: Record<string, TrackCfg> = {
  // Вестибюль: служебная ветка — первый поезд в первые секунды.
  [`${F12_HALL}:81`]: { period: 17, first: 7.5, dir: 1, cars: 3, speed: 17, kind: 'normal' },
  // Платформы: станция на две линии.
  [`${F12_PLAT}:94`]: { period: 21, first: 6, dir: 1, cars: 4, speed: 16, kind: 'normal' },
  [`${F12_PLAT}:85`]: { period: 23, first: 16, dir: -1, cars: 4, speed: 16, kind: 'normal' },
  // Перегоны: поезд занимает тоннель целиком — в ниши.
  [`${F12_PLAT}:62`]: { period: 24, first: 12, dir: -1, cars: 3, speed: 15, kind: 'normal' },
  [`${F12_PLAT}:38`]: { period: 22, first: 9, dir: 1, cars: 3, speed: 15, kind: 'normal' },
  // Узловая: четыре пути, часто.
  [`${F12_PLAT}:24`]: { period: 12, first: 4, dir: 1, cars: 2, speed: 18, kind: 'normal' },
  [`${F12_PLAT}:19`]: { period: 13, first: 8, dir: -1, cars: 2, speed: 18, kind: 'normal' },
  [`${F12_PLAT}:14`]: { period: 11, first: 2, dir: 1, cars: 2, speed: 19, kind: 'normal' },
  [`${F12_PLAT}:9`]: { period: 14, first: 10, dir: -1, cars: 2, speed: 18, kind: 'normal' },
  // Святилище: старый перегон — поезд-призрак (после события), и арена.
  [`${F12_SHRINE}:54`]: { period: 30, first: 1e9, dir: -1, cars: 3, speed: 13, kind: 'ghost' },
  [`${F12_SHRINE}:16`]: { period: 16, first: 9, dir: 1, cars: 3, speed: 17, kind: 'arena' },
};

/** Длина вагона, клеток (рисовальщик рисует столько же). */
export const CAR_LEN = 5;
const CAR_GAP = 0.25;
/** За сколько до поезда семафор жёлтый и красный, с. */
export const SIG_YELLOW = 6;
export const SIG_RED = 2.6;
const HORN = 1.6;
/** Доля здоровья, которую снимает поезд (после брони). */
export const TRAIN_HIT = 0.3;

interface Train {
  /** Время мира, когда голова была в точке старта. */
  t0: number;
  x0: number;
  speed: number;
  cars: number;
  dir: 1 | -1;
  ghost: boolean;
  /** Мобы-вагоны (может не быть: далеко от героя). */
  pieces: (Mob | null)[];
  /** Кого уже сбили (id). */
  hit: Set<number>;
  horn: boolean;
  shakeT: number;
  /** Поезд-призрак стоит у платформы до этого времени. */
  stopAt: number;
  stopUntil: number;
  stopped: boolean;
  bossHit: boolean;
  express: boolean;
}

interface Track {
  id: number;
  area: string;
  /** Мировой ряд северного рельса. */
  y: number;
  /** Весь путь поезда (с тоннелями) и проходимая часть. */
  x0: number;
  x1: number;
  wx0: number;
  wx1: number;
  /** Смертельных рядов по краям (в тоннеле — щебень). */
  pad: number;
  cfg: TrackCfg;
  dir: 1 | -1;
  /** Когда голова войдёт в проходимую часть (время мира). */
  next: number;
  train: Train | null;
  /** Поезда уведены стрелкой до этого времени. */
  hold: number;
  view: TrackView;
  zone: Zone | null;
  /** Следующий поезд — экспресс (короткое предупреждение). */
  express: boolean;
  off: boolean;
  /** Направление, к которому путь вернётся после встречного. */
  restore: 1 | -1 | 0;
  /** Свет фар на полу (зона `f12_beam`). */
  beam: Zone | null;
}

interface Lane {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  base: number;
  view: EscView;
  zone: Zone | null;
}

interface Territory {
  id: number;
  x: number;
  y: number;
  r: number;
  kind: 'doll' | 'hall';
  owner: number;
  pillars: number[];
  born: number;
  life: number;
  /** Сколько наливается метка до удара, с; доля урона. */
  chargeT: number;
  hitK: number;
  charge: number;
  view: TerrView;
  zone: Zone | null;
  mark: Zone | null;
  broken: number;
  cutT: number;
}

interface Post {
  id: number;
  kind: string;
  x: number;
  y: number;
  /** Моб, если стоит; −2 — убит в этой вылазке. */
  mob: number;
  /** Для длиннорукого — клетка стены (куда тянет). */
  wx?: number;
  wy?: number;
}

type EvState = 'idle' | 'on' | 'done';

interface F12State {
  tracks: Track[];
  lanes: Lane[];
  terrs: Territory[];
  posts: Post[];
  said: Record<string, number>;
  nextTerr: number;
  /** Час пик: клетки барьера и щиты, волны. */
  rush: {
    st: EvState;
    t: number;
    wave: number;
    cells: number[];
    row: number;
    x0: number;
    x1: number;
  };
  /** Бегущая лестница. */
  stairs: { st: EvState; t: number; wave: number };
  /** Сбой света: прямоугольник станции, погашенный свет, аварийки. */
  dark: {
    st: EvState;
    t: number;
    rect: [number, number, number, number];
    saved: Map<number, number>;
    emerg: [number, number][];
  };
  /** Встречный в перегоне T1. */
  meet: { st: EvState; t: number };
  /** Малая территория в зале святилища. */
  hall: { st: EvState; t: number; terr: Territory | null; wave: number; cx: number; cy: number };
  /** Последний поезд. */
  ghost: { st: EvState; t: number; spawned: boolean };
  /** Кулдауны действий: id предмета → время мира. */
  useCd: Record<string, number>;
  /** Семафоры: клетка → путь. */
  sigTrack: Map<string, Track>;
  scanned: boolean;
}

const STATE = new WeakMap<Sim, F12State>();

function stateOf(sim: Sim): F12State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

/** Для тестов и бота: пути, ленты, территории, события. */
export const f12State = (sim: Sim) => stateOf(sim);

const isRailN = (k: number) => k === MK.railN || k === MK.crossN || k === MK.tunnelN;
const isRailS = (k: number) => k === MK.railS || k === MK.crossS || k === MK.tunnelS;

function scan(sim: Sim): F12State {
  const w = sim.world;
  const tracks: Track[] = [];
  let tid = 0;
  for (let y = 0; y < w.h - 1; y++) {
    let x = 0;
    while (x < w.w) {
      if (!(isRailN(markAt(sim, x, y)) && isRailS(markAt(sim, x, y + 1)))) {
        x++;
        continue;
      }
      let xb = x;
      while (xb + 1 < w.w && isRailN(markAt(sim, xb + 1, y)) && isRailS(markAt(sim, xb + 1, y + 1)))
        xb++;
      let tunnel = false;
      let wx0 = 1e9;
      let wx1 = -1;
      for (let k = x; k <= xb; k++) {
        if (markAt(sim, k, y) === MK.tunnelN) tunnel = true;
        else {
          wx0 = Math.min(wx0, k);
          wx1 = Math.max(wx1, k);
        }
      }
      const band = w.bands.find((b) => y >= b.top && y < b.top + b.h);
      const area = band?.def.id ?? '';
      const cfg = TRACK_CFG[`${area}:${y - (band?.top ?? 0)}`];
      if (tunnel && wx1 >= wx0 && cfg) {
        const edge = markAt(sim, Math.floor((wx0 + wx1) / 2), y - 1);
        const pad = edge === MK.ballast ? 1 : 0;
        const view: TrackView = {
          y,
          x0: wx0,
          x1: wx1 + 1,
          pad,
          dir: cfg.dir,
          sig: 0,
          left: 99,
          front: NaN,
          ghost: cfg.kind === 'ghost',
        };
        tracks.push({
          id: tid++,
          area,
          y,
          x0: x,
          x1: xb + 1,
          wx0,
          wx1: wx1 + 1,
          pad,
          cfg,
          dir: cfg.dir,
          next: cfg.first,
          train: null,
          hold: 0,
          view,
          zone: null,
          express: false,
          off: false,
          restore: 0,
          beam: null,
        });
      }
      x = xb + 1;
    }
  }
  // Ленты эскалаторов: столбцы одной метки подряд.
  const lanes: Lane[] = [];
  const used = new Set<number>();
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const k = markAt(sim, x, y);
      if ((k !== MK.escN && k !== MK.escS && k !== MK.esc0) || used.has(y * w.w + x)) continue;
      let x1 = x;
      while (markAt(sim, x1 + 1, y) === k) x1++;
      let y1 = y;
      while (markAt(sim, x, y1 + 1) === k) y1++;
      for (let yy = y; yy <= y1; yy++) for (let xx = x; xx <= x1; xx++) used.add(yy * w.w + xx);
      const base = k === MK.escN ? -1 : k === MK.escS ? 1 : 0;
      lanes.push({
        x0: x,
        x1: x1 + 1,
        y0: y,
        y1: y1 + 1,
        base,
        view: { x0: x, x1: x1 + 1, y0: y, y1: y1 + 1, dir: base, speed: ESC_SPEED },
        zone: null,
      });
    }
  // Посты жителей станции.
  const posts: Post[] = [];
  let pid = 0;
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const k = markAt(sim, x, y);
      const kind =
        k === MK.sleepPost
          ? 'f12_sleeper'
          : k === MK.eyePost
            ? 'f12_eye'
            : k === MK.linePost
              ? 'f12_lineman'
              : k === MK.dollPost
                ? 'f12_doll'
                : k === MK.guardPost
                  ? 'f12_turnstile'
                  : '';
      if (kind) posts.push({ id: pid++, kind, x: x + 0.5, y: y + 0.5, mob: -1 });
      // Трещина длиннорукого — в стене; сам он у стены, на полу рядом.
      if (k === MK.wArm) {
        const dirs: [number, number][] = [
          [0, 1],
          [1, 0],
          [-1, 0],
          [0, -1],
        ];
        for (const [dx, dy] of dirs) {
          if (sim.tiles[(y + dy) * w.w + x + dx] !== T_FLOOR) continue;
          posts.push({
            id: pid++,
            kind: 'f12_longarm',
            x: x + dx + 0.5,
            y: y + dy + 0.5,
            mob: -1,
            wx: x + 0.5,
            wy: y + 0.5,
          });
          break;
        }
      }
      // Плакат на стене — дом ожившего плаката (не каждый).
      if (k === MK.wPoster && sim.tiles[(y + 1) * w.w + x] === T_FLOOR && (x * 7 + y * 3) % 4 === 0)
        posts.push({
          id: pid++,
          kind: 'f12_poster',
          x: x + 0.5,
          y: y + 1.5,
          mob: -1,
          wx: x + 0.5,
          wy: y + 0.5,
        });
    }
  // Семафоры и сигналы — к ближнему пути своего района.
  const sigTrack = new Map<string, Track>();
  for (const o of w.objs) {
    if (o.ref !== 'f12_semaphore' && o.ref !== 'f12_signal') continue;
    let best: Track | null = null;
    let bd = 9;
    for (const t of tracks) {
      const d = Math.abs(o.y + 0.5 - (t.y + 1));
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) sigTrack.set(`${o.x},${o.y}`, best);
  }
  // Барьер турникетов Вестибюля: ряд, где стоят створки.
  const hallBand = w.bands.find((b) => b.def.id === F12_HALL);
  let row = -1;
  let bx0 = 99;
  let bx1 = -1;
  const cells: number[] = [];
  if (hallBand)
    for (const o of w.objs) {
      if (o.ref !== 'f12_turnstile' || o.area !== F12_HALL) continue;
      row = o.y;
      bx0 = Math.min(bx0, o.x);
      bx1 = Math.max(bx1, o.x);
    }
  if (row >= 0) {
    for (let x = 1; x < w.w - 1; x++) {
      const i = row * w.w + x;
      if (sim.tiles[i] !== T_FLOOR) continue;
      if (w.objs.some((o) => o.x === x && o.y === row && o.ref === 'f12_turnstile')) continue;
      cells.push(i);
    }
    // Двери платной зоны (запад) и низ эскалаторов — тоже на замок.
    for (let y = row - 9; y < row; y++)
      for (const x of [7])
        if (sim.tiles[y * w.w + x] === T_FLOOR && markAt(sim, x, y) === MK.tile)
          cells.push(y * w.w + x);
    for (let y = row - 16; y < row - 9; y++)
      for (let x = 1; x < w.w - 1; x++)
        if (
          markAt(sim, x, y) === MK.comb &&
          markAt(sim, x, y - 1) !== MK.comb &&
          sim.tiles[(y - 1) * w.w + x] === T_FLOOR &&
          markAt(sim, x, y - 1) !== MK.tile
        )
          cells.push(y * w.w + x);
  }
  // Станция Платформ: прямоугольник для сбоя света.
  const plat = w.bands.find((b) => b.def.id === F12_PLAT);
  const rect: [number, number, number, number] = plat
    ? [3, plat.top + 74, 61, plat.top + 104]
    : [0, 0, 0, 0];
  const emerg: [number, number][] = [];
  if (plat)
    for (const x of [8, 20, 32, 44, 56])
      emerg.push([x + 0.5, plat.top + 76.5], [x + 0.5, plat.top + 102.5]);
  const shrine = w.bands.find((b) => b.def.id === F12_SHRINE);
  return {
    tracks,
    lanes,
    terrs: [],
    posts,
    said: {},
    nextTerr: 1,
    rush: { st: 'idle', t: 0, wave: 0, cells, row, x0: bx0, x1: bx1 },
    stairs: { st: 'idle', t: 0, wave: 0 },
    dark: { st: 'idle', t: 0, rect, saved: new Map(), emerg },
    meet: { st: 'idle', t: 0 },
    hall: {
      st: 'idle',
      t: 0,
      terr: null,
      wave: 0,
      cx: 17.5,
      cy: (shrine?.top ?? 0) + 56.5,
    },
    ghost: { st: 'idle', t: 0, spawned: false },
    useCd: {},
    sigTrack,
    scanned: true,
  };
}

/** Держать свою «вечную» зону рисунка (сброс боя чистит все зоны). */
function keepZone(sim: Sim, api: SimApi, cur: Zone | null, make: () => ZoneIn): Zone {
  if (cur && sim.zones.includes(cur)) return cur;
  api.zone(sim, make());
  return sim.zones[sim.zones.length - 1];
}

// ---------------------------------------------------------------------------
// Поезда.
// ---------------------------------------------------------------------------

/** Стоит ли точка на смертельной полосе какого-нибудь пути (для ИИ и бота). */
export function onTrack(sim: Sim, x: number, y: number): Track | null {
  const st = STATE.get(sim);
  if (!st) return null;
  for (const t of st.tracks) {
    if (t.off) continue;
    if (x < t.wx0 - 0.3 || x > t.wx1 + 0.3) continue;
    if (y >= t.y - t.pad && y <= t.y + 2 + t.pad) return t;
  }
  return null;
}

/**
 * Опасность пути для бота и ИИ: секунд до того, как в точке пройдёт поезд
 * (0 — идёт прямо сейчас), Infinity — безопасно.
 */
export function trackDanger(sim: Sim, x: number, y: number, r = 0.3): number {
  const st = STATE.get(sim);
  if (!st) return Infinity;
  let best = Infinity;
  for (const t of st.tracks) {
    if (t.off) continue;
    if (x < t.wx0 - r || x > t.wx1 + r) continue;
    if (y < t.y - t.pad - r || y > t.y + 2 + t.pad + r) continue;
    const tr = t.train;
    if (tr) {
      const [a, b] = trainSpan(sim, tr);
      if (x > a - 3 && x < b + 3) return 0;
      // Голова ещё не дошла: сколько ей ехать.
      const f = tr.dir > 0 ? b : a;
      const d = (x - f) * tr.dir;
      if (d > 0) best = Math.min(best, d / tr.speed);
      continue;
    }
    if (t.hold > sim.time) continue;
    best = Math.min(best, Math.max(0, t.next - sim.time));
  }
  return best;
}

/** Где голова поезда сейчас. */
function frontOf(sim: Sim, tr: Train): number {
  const dtRun = sim.time - tr.t0;
  if (tr.ghost && tr.stopAt > 0) {
    // Призрак: доезжает до платформы, стоит, уезжает.
    const tStop = (tr.stopAt - tr.x0) / (tr.speed * tr.dir);
    if (dtRun < tStop) return tr.x0 + tr.dir * tr.speed * dtRun;
    const wait = tr.stopUntil - tr.t0 - tStop;
    if (dtRun < tStop + wait) return tr.stopAt;
    return tr.stopAt + tr.dir * tr.speed * (dtRun - tStop - wait);
  }
  return tr.x0 + tr.dir * tr.speed * dtRun;
}

const trainLen = (cars: number) => cars * CAR_LEN + (cars - 1) * CAR_GAP;

/** Пролёт поезда [слева, справа] по x. */
function trainSpan(sim: Sim, tr: Train): [number, number] {
  const f = frontOf(sim, tr);
  const L = trainLen(tr.cars);
  return tr.dir > 0 ? [f - L, f] : [f, f + L];
}

/** Выпустить поезд на путь. */
function launch(sim: Sim, t: Track): void {
  const cfg = t.cfg;
  const speed = t.express ? cfg.speed * 1.35 : cfg.speed;
  const x0 = t.dir > 0 ? t.x0 - 3 : t.x1 + 3;
  // Голова дойдёт до проходимой части ровно к `next`.
  const edge = t.dir > 0 ? t.wx0 : t.wx1;
  const t0 = t.next - Math.abs(edge - x0) / speed;
  const ghost = cfg.kind === 'ghost';
  const tr: Train = {
    t0,
    x0,
    speed,
    cars: cfg.cars,
    dir: t.dir,
    ghost,
    pieces: [],
    hit: new Set(),
    horn: false,
    shakeT: 0,
    stopAt: 0,
    stopUntil: 0,
    stopped: false,
    bossHit: false,
    express: t.express,
  };
  if (ghost && stateOf(sim).ghost.st === 'on' && !stateOf(sim).ghost.spawned) {
    // Последний поезд: встаёт у платформы (середина пути), стоит 10 с.
    const L = trainLen(cfg.cars);
    const mid = (t.wx0 + t.wx1) / 2;
    tr.stopAt = t.dir > 0 ? mid + L / 2 : mid - L / 2;
    const tStop = Math.abs(tr.stopAt - x0) / speed;
    tr.stopUntil = t0 + tStop + 10;
    stateOf(sim).ghost.spawned = true;
  }
  t.train = tr;
  t.express = false;
}

/** Вагоны — мобы только рядом с героем (дальше их всё равно не видно). */
function placePieces(sim: Sim, api: SimApi, t: Track, tr: Train): void {
  const f = frontOf(sim, tr);
  const h = sim.hero;
  const yb = t.y + 1.95;
  for (let i = 0; i < tr.cars; i++) {
    const back = i * (CAR_LEN + CAR_GAP) + CAR_LEN / 2;
    const cx = f - tr.dir * back;
    const near = Math.abs(cx - h.x) < 26 && Math.abs(yb - h.y) < 22;
    let m = tr.pieces[i] ?? null;
    if (m && (!sim.mobs.includes(m) || m.mode === 'dying')) m = null;
    if (!near) {
      if (m) sim.mobs = sim.mobs.filter((x) => x !== m);
      tr.pieces[i] = null;
      continue;
    }
    if (!m) {
      m = api.spawnMob(sim, 'f12_train', cx, yb, { mode: 'drop' });
      m.t = 1;
      m.data.ghost = 1;
      tr.pieces[i] = m;
    }
    m.x = cx;
    m.y = yb;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.face = tr.dir > 0 ? 0 : Math.PI;
    m.data.car = i;
    m.data.cars = tr.cars;
    m.data.dir = tr.dir;
    m.data.spirit = tr.ghost ? 1 : 0;
    m.data.stop = tr.stopped ? 1 : 0;
    m.data.track = t.id;
    // Уклон в последний миг: рывок прочь с путей перед самой головой.
    m.danger = 0;
    if (i === 0 && !tr.stopped) {
      const d = (h.x - f) * tr.dir;
      if (d > -0.5 && d < 2.6 && onTrack(sim, h.x, h.y) === t) m.danger = 3;
    }
  }
}

function clearPieces(sim: Sim, tr: Train): void {
  const set = new Set(tr.pieces.filter(Boolean) as Mob[]);
  if (set.size) sim.mobs = sim.mobs.filter((m) => !set.has(m));
  tr.pieces = [];
}

/** Кого накрыл состав: герой — удар и отброс, монстры — насмерть. */
function trainHits(sim: Sim, api: SimApi, t: Track, tr: Train): void {
  if (tr.stopped) return;
  const [a, b] = trainSpan(sim, tr);
  const y0 = t.y - t.pad;
  const y1 = t.y + 2 + t.pad;
  const h = sim.hero;
  const cy = t.y + 1;
  if (
    !heroDown(sim) &&
    h.x > a - h.r &&
    h.x < b + h.r &&
    h.y > y0 - h.r * 0.5 &&
    h.y < y1 + h.r * 0.5
  ) {
    if (h.inv <= 0) {
      // Отброс — к ближнему краю путей и по ходу поезда.
      const fy = h.y < cy ? h.y + 1 : h.y - 1;
      const fx = h.x - tr.dir * 0.8;
      api.hurtHero(
        sim,
        rawShare(sim, tr.ghost ? TRAIN_HIT * 0.8 : TRAIN_HIT),
        fx,
        fy,
        13,
        'f12_train',
      );
      sim.events.push({ t: 'shake', k: 0.7 });
      sayOnce(sim, 'train-hit', 6, {
        what: 'f12_train_hit',
        text: 'ПОД ПОЕЗДОМ',
        sub: 'на путях не стоят',
      });
    }
  }
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || tr.hit.has(m.id)) continue;
    if (m.kind === 'f12_train' || m.kind === 'f12_eye') continue;
    if (m.x < a - m.r || m.x > b + m.r || m.y < y0 - m.r || m.y > y1 + m.r) continue;
    if (m.kind === 'f12boss') {
      if (tr.bossHit || (m.data.ghost ?? 0) > 0) continue;
      tr.bossHit = true;
      bossTrainHit(sim, api, m);
      continue;
    }
    if ((m.data.ghost ?? 0) > 0 || m.mode === 'emerge') continue;
    tr.hit.add(m.id);
    // Удар по своим (Движок 3): насмерть и в зачёт; героя этот круг не задевает.
    api.strike(sim, {
      shape: 'circle',
      x: m.x,
      y: m.y,
      r: Math.max(0.08, m.r * 0.4),
      warn: 0,
      dmg: 0,
      mobDmg: Infinity,
      art: 'f12_trainhit',
    });
  }
}

function stepTracks(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const now = sim.time;
  for (const t of st.tracks) {
    const v = t.view;
    // Арена в храме: путь переписан — поездов нет.
    if (t.off) {
      if (t.train) {
        clearPieces(sim, t.train);
        t.train = null;
      }
      v.sig = 0;
      v.front = NaN;
      continue;
    }
    const near = Math.abs(h.y - (t.y + 1)) < 30;
    // Рисунок рельсов (метка беды) — вечная зона на пути.
    if (near)
      t.zone = keepZone(sim, api, t.zone, () => {
        const z: ZoneIn & { f12?: TrackView } = {
          x: t.wx0,
          y: t.y,
          r: 0.1,
          life: 1e9,
          art: 'f12_rails',
          f12: v,
        };
        return z;
      });
    if (t.train) {
      const tr = t.train;
      const [a, b] = trainSpan(sim, tr);
      const f = tr.dir > 0 ? b : a;
      v.front = f;
      v.sig = tr.stopped ? 1 : 3;
      v.left = 0;
      if (tr.ghost && tr.stopAt > 0) {
        const was = tr.stopped;
        tr.stopped = Math.abs(f - tr.stopAt) < 0.01 && now < tr.stopUntil;
        if (tr.stopped && !was) ghostStop(sim, api, t, tr);
        if (!tr.stopped && was)
          sayOnce(sim, 'ghost-go', 5, {
            what: 'f12_ghost_call',
            text: 'ДВЕРИ ЗАКРЫВАЮТСЯ',
            sub: 'уходи с путей',
          });
      }
      placePieces(sim, api, t, tr);
      trainHits(sim, api, t, tr);
      // Свет фар — впереди головы, и сноп света по рельсам поверх темноты.
      if (near && !tr.stopped) {
        api.light(sim, `f12_train${t.id}`, {
          x: f + tr.dir * 1.6,
          y: t.y + 1,
          r: tr.ghost ? 4.2 : 5.4,
          tint: tr.ghost ? 'green' : 'warm',
        });
        t.beam = keepZone(sim, api, t.beam, () => {
          const z: ZoneIn & { f12?: { dir: number; ghost: boolean } } = {
            x: f,
            y: t.y + 1,
            r: 0.1,
            life: 1e9,
            art: 'f12_beam',
            above: true,
            f12: { dir: tr.dir, ghost: tr.ghost },
          };
          return z;
        });
        t.beam.x = f;
        t.beam.y = t.y + 1;
      } else {
        api.light(sim, `f12_train${t.id}`, null);
        if (t.beam) {
          sim.zones = sim.zones.filter((z) => z !== t.beam);
          t.beam = null;
        }
      }
      // Пол дрожит, пока состав рядом.
      tr.shakeT -= dt;
      const dx = h.x < a ? a - h.x : h.x > b ? h.x - b : 0;
      const dy = Math.abs(h.y - (t.y + 1));
      if (!tr.stopped && tr.shakeT <= 0 && dx < 7 && dy < 7) {
        tr.shakeT = 0.22;
        sim.events.push({ t: 'shake', k: 0.22 * (1 - Math.max(dx, dy) / 8) });
      }
      // Ушёл за край — поезда нет; следующий по расписанию.
      const gone = tr.dir > 0 ? a > t.x1 + 3 : b < t.x0 - 3;
      if (gone) {
        clearPieces(sim, tr);
        api.light(sim, `f12_train${t.id}`, null);
        sim.zones = sim.zones.filter((z) => z !== t.beam);
        t.beam = null;
        t.train = null;
        v.front = NaN;
        if (t.restore) {
          t.dir = t.restore;
          v.dir = t.restore;
          t.restore = 0;
        }
        const per = t.cfg.period * (0.85 + sim.rng() * 0.3);
        t.next = Math.max(now + 4, t.hold) + per;
        if (t.cfg.kind === 'ghost' && st.ghost.st !== 'done') t.next = 1e9;
      }
      continue;
    }
    v.front = NaN;
    if (t.hold > now) {
      v.sig = 4;
      v.left = 99;
      if (t.next < t.hold + 3) t.next = t.hold + 3;
      continue;
    }
    const left = t.next - now;
    v.left = left;
    v.sig = left > SIG_YELLOW ? 0 : left > SIG_RED ? 1 : 2;
    // Гудок и гул — пока поезд ещё в тоннеле.
    if (left < HORN && left > HORN - dt * 1.5 && near) {
      // Гудок из тоннеля (звук — `trainHorn`); призрак гудит иначе.
      sim.events.push({ t: 'boss', what: t.cfg.kind === 'ghost' ? 'f12_ghost_horn' : 'f12_horn' });
      // Спящие рядом с путями просыпаются от гудка.
      wakeSleepers(sim, api, (t.wx0 + t.wx1) / 2, t.y + 1, 99, 4.2);
    }
    // Голова выходит из-за края мира заранее: свет встаёт из темноты.
    const edge = t.dir > 0 ? t.wx0 : t.wx1;
    const x0 = t.dir > 0 ? t.x0 - 3 : t.x1 + 3;
    const speed = t.express ? t.cfg.speed * 1.35 : t.cfg.speed;
    if (left <= Math.abs(edge - x0) / speed) {
      launch(sim, t);
      // Гул состава с Доплером (`trainPass`) — только рядом с героем.
      if (near) sim.events.push({ t: 'boss', what: 'f12_pass' });
    }
  }
  // Семафоры для рисовальщика.
  for (const [key, t] of st.sigTrack) F12_FX.sig.set(key, t.view.sig);
}

/** Позвать поезд на путь сейчас (колокол, обходчик, событие). */
function callTrain(sim: Sim, t: Track, lead: number, express = true): boolean {
  if (t.off || t.train || t.hold > sim.time) return false;
  if (t.next - sim.time < lead) return false;
  t.next = sim.time + lead;
  t.express = express;
  return true;
}

/** Ближний путь к точке (по ряду), если ближе `maxDy`. */
function trackNear(st: F12State, x: number, y: number, maxDy: number): Track | null {
  let best: Track | null = null;
  let bd = maxDy;
  for (const t of st.tracks) {
    if (t.off || x < t.wx0 - 2 || x > t.wx1 + 2) continue;
    const d = Math.abs(y - (t.y + 1));
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Эскалаторы.
// ---------------------------------------------------------------------------

/** Скорость ленты, клеток в секунду. */
export const ESC_SPEED = 2.9;

function laneAt(st: F12State, x: number, y: number): Lane | null {
  for (const l of st.lanes) if (x >= l.x0 && x < l.x1 && y >= l.y0 && y < l.y1) return l;
  return null;
}

function stepLanes(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const h = sim.hero;
  for (const l of st.lanes) {
    if (Math.abs(h.y - (l.y0 + l.y1) / 2) < 40)
      l.zone = keepZone(sim, api, l.zone, () => {
        const z: ZoneIn & { f12?: EscView } = {
          x: l.x0,
          y: l.y0,
          r: 0.1,
          life: 1e9,
          art: 'f12_esc',
          f12: l.view,
        };
        return z;
      });
  }
  // Лента несёт героя (не в рывке, не на крюке).
  if (!heroDown(sim) && !h.pull) {
    const l = laneAt(st, h.x, h.y);
    if (l && l.view.dir) {
      h.y += l.view.dir * l.view.speed * dt * (h.mode === 'dash' ? 0.4 : 1);
      api.collide(sim, h);
    }
  }
  // И монстров — кроме летающих и сидящих в стене.
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || m.mode === 'drop' || m.mode === 'emerge') continue;
    const def = api.def(m.kind);
    if (def.fly || def.boss || def.speed <= 0) continue;
    const l = laneAt(st, m.x, m.y);
    if (!l || !l.view.dir) continue;
    m.y += l.view.dir * l.view.speed * dt;
    api.collide(sim, m);
  }
}

// ---------------------------------------------------------------------------
// Территории.
// ---------------------------------------------------------------------------

/** Метка налилась — удар «верный»: мимо брони, но рывок переждёт. */
function terrHit(sim: Sim, api: SimApi, tr: Territory): void {
  const h = sim.hero;
  api.hurtEnv(sim, tr.hitK);
  sim.events.push({ t: 'flash', color: '#ff2a6a', k: 0.55 });
  sim.events.push({ t: 'shake', k: 0.35 });
  sim.events.push({ t: 'strike', x: h.x, y: h.y, art: 'f12_markcut', big: false });
}

/** Поставить территорию: круг, три столба по краю. */
function openTerritory(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r: number,
  kind: 'doll' | 'hall',
  owner: number,
): Territory {
  const st = stateOf(sim);
  const view: TerrView = { r, age: 0, charge: 0, hold: false, broken: 0, kind };
  const tr: Territory = {
    id: st.nextTerr++,
    x,
    y,
    r,
    kind,
    owner,
    pillars: [],
    born: sim.time,
    life: kind === 'hall' ? 1e9 : 15,
    chargeT: kind === 'hall' ? 1.25 : 1.45,
    hitK: kind === 'hall' ? 0.085 : 0.1,
    charge: 0,
    view,
    zone: null,
    mark: null,
    broken: 0,
    cutT: 0,
  };
  const rot = sim.rng() * TAU;
  const pr = r - 0.7;
  for (let i = 0; i < 3; i++) {
    const a = rot + (i / 3) * TAU;
    let px = x + Math.cos(a) * pr;
    let py = y + Math.sin(a) * pr;
    // Столб — на пол: ищем ближе к центру, если попал в стену.
    for (
      let k = 0;
      k < 8 && (api.solidTile(sim, Math.floor(px), Math.floor(py)) || onTrack(sim, px, py));
      k++
    ) {
      px = x + Math.cos(a) * pr * (1 - (k + 1) * 0.11);
      py = y + Math.sin(a) * pr * (1 - (k + 1) * 0.11);
    }
    const p = api.spawnMob(sim, 'f12_pillar', Math.floor(px) + 0.5, Math.floor(py) + 0.5, {
      mode: 'f12_rise',
    });
    p.data.terr = tr.id;
    tr.pillars.push(p.id);
  }
  st.terrs.push(tr);
  return tr;
}

function closeTerritory(sim: Sim, tr: Territory, broken: boolean): void {
  if (tr.broken) return;
  tr.broken = sim.time;
  tr.view.broken = 1;
  if (broken) {
    sim.events.push({ t: 'flash', color: '#ffffff', k: 0.5 });
    sim.events.push({ t: 'shake', k: 0.5 });
    sim.events.push({
      t: 'boss',
      what: 'f12_domain_trap',
      text: 'ТЕРРИТОРИЯ РАЗБИТА',
      sub: 'столбы пали — круг рассыпался',
    });
  }
  // Столбы — в пыль.
  for (const m of sim.mobs)
    if (m.kind === 'f12_pillar' && m.data.terr === tr.id && m.mode !== 'dying') {
      m.hp = 0;
      m.mode = 'escape';
      m.t = 0;
    }
}

function stepTerritories(sim: Sim, st: F12State, api: SimApi, dt: number): void {
  const h = sim.hero;
  const keep: Territory[] = [];
  for (const tr of st.terrs) {
    tr.view.age = sim.time - tr.born;
    if (tr.broken) {
      tr.view.broken = Math.min(1, (sim.time - tr.broken) / 0.8);
      if (sim.time - tr.broken < 0.9) {
        tr.zone = keepZone(sim, api, tr.zone, () => domainZone(tr));
        keep.push(tr);
      } else {
        sim.zones = sim.zones.filter((z) => z !== tr.zone && z !== tr.mark);
      }
      continue;
    }
    tr.zone = keepZone(sim, api, tr.zone, () => domainZone(tr));
    // Столбы пали — круг рассыпается.
    const alive = sim.mobs.filter(
      (m) => tr.pillars.includes(m.id) && m.mode !== 'dying' && m.mode !== 'escape',
    );
    const owner =
      tr.owner >= 0 ? sim.mobs.find((m) => m.id === tr.owner && m.mode !== 'dying') : null;
    if (!alive.length) {
      closeTerritory(sim, tr, true);
      // Хозяин круга оглушён отдачей.
      if (owner) api.setMode(owner, 'f12_dazed');
      if (tr.kind === 'hall') hallWon(sim, st, api, tr);
      keep.push(tr);
      continue;
    }
    if ((tr.owner >= 0 && !owner) || sim.time - tr.born > tr.life) {
      closeTerritory(sim, tr, false);
      keep.push(tr);
      continue;
    }
    // Метка «верного удара»: ходит за героем внутри круга.
    const inside = hypot(h.x - tr.x, h.y - tr.y) < tr.r && !heroDown(sim);
    if (inside) {
      tr.mark = keepZone(sim, api, tr.mark, () => {
        const z: ZoneIn & { f12?: TerrView } = {
          x: h.x,
          y: h.y,
          r: 0.7,
          life: 1e9,
          art: 'f12_mark',
          above: true,
          f12: tr.view,
        };
        return z;
      });
      tr.mark.x = h.x;
      tr.mark.y = h.y;
      if (tr.cutT > 0) {
        tr.cutT -= dt;
        tr.charge = 0;
      } else tr.charge = Math.min(1, tr.charge + dt / tr.chargeT);
      tr.view.charge = tr.charge;
      // Налилась: рывок и неуязвимость не спасают — метка ждёт.
      const busy = h.mode === 'dash' || h.inv > 0;
      tr.view.hold = tr.charge >= 1 && busy;
      if (tr.charge >= 1 && !busy) {
        terrHit(sim, api, tr);
        tr.charge = 0;
        tr.cutT = 0.35;
      }
      sayOnce(sim, `terr-in-${tr.kind}`, 40, {
        what: 'f12_domain_call',
        text: 'ПРОКЛЯТАЯ ТЕРРИТОРИЯ',
        sub: 'метка не промахнётся — за край круга или разбей три столба',
      });
    } else {
      tr.charge = Math.max(0, tr.charge - dt * 2.5);
      tr.view.charge = tr.charge;
      tr.view.hold = false;
      if (tr.mark) {
        sim.zones = sim.zones.filter((z) => z !== tr.mark);
        tr.mark = null;
      }
    }
    keep.push(tr);
  }
  st.terrs = keep;
}

function domainZone(tr: Territory): ZoneIn {
  const z: ZoneIn & { f12?: TerrView } = {
    x: tr.x,
    y: tr.y,
    r: tr.r,
    life: 1e9,
    art: 'f12_domain',
    f12: tr.view,
  };
  return z;
}

// ---------------------------------------------------------------------------
// Посты: жители станции встают на свои места, когда герой рядом.
// ---------------------------------------------------------------------------

const POST_R: Record<string, number> = {
  f12_sleeper: 13,
  f12_eye: 12,
  f12_lineman: 16,
  f12_doll: 12,
  f12_turnstile: 14,
  f12_longarm: 11,
  f12_poster: 11,
};

function stepPosts(sim: Sim, st: F12State, api: SimApi): void {
  const h = sim.hero;
  const b = sim.boss;
  for (const p of st.posts) {
    if (p.mob === -2) continue;
    const d = hypot(p.x - h.x, p.y - h.y);
    if (p.mob >= 0) {
      const m = sim.mobs.find((x) => x.id === p.mob);
      if (!m) {
        // Ушёл (далеко) — встанет снова; убит — нет.
        p.mob = -1;
        continue;
      }
      if (m.mode === 'dying') p.mob = -2;
      continue;
    }
    if (d > (POST_R[p.kind] ?? 12) || d < 3) continue;
    if (b && b.state === 'fight' && api.inArena(sim, p.x, p.y)) continue;
    const mode =
      p.kind === 'f12_sleeper'
        ? 'f12_doze'
        : p.kind === 'f12_eye'
          ? 'f12_shut'
          : p.kind === 'f12_lineman'
            ? 'f12_patrol'
            : p.kind === 'f12_turnstile'
              ? 'f12_post'
              : p.kind === 'f12_longarm'
                ? 'f12_hide'
                : p.kind === 'f12_poster'
                  ? 'f12_flat'
                  : 'chase';
    const m = api.spawnMob(sim, p.kind, p.x, p.y, { mode });
    m.hx = p.x;
    m.hy = p.y;
    m.data.post = p.id;
    if (p.wx !== undefined) {
      m.data.wx = p.wx;
      m.data.wy = p.wy ?? p.y;
    }
    if (p.kind === 'f12_longarm' || p.kind === 'f12_poster' || p.kind === 'f12_eye')
      m.data.ghost = 1;
    if (p.kind === 'f12_turnstile') m.face = Math.PI / 2;
    p.mob = m.id;
  }
}

// ---------------------------------------------------------------------------
// События районов.
// ---------------------------------------------------------------------------

/** Спящие рядом с точкой просыпаются. */
function wakeSleepers(sim: Sim, api: SimApi, x: number, y: number, rx: number, ry: number): void {
  for (const m of sim.mobs)
    if (
      m.kind === 'f12_sleeper' &&
      m.mode === 'f12_doze' &&
      Math.abs(m.x - x) < rx &&
      Math.abs(m.y - y) < ry
    )
      api.setMode(m, 'f12_wake');
}

/** Выпустить монстра «из ниоткуда» рядом с точкой: падает со свода. */
function dropNear(
  sim: Sim,
  api: SimApi,
  kind: string,
  x: number,
  y: number,
  r0: number,
  r1: number,
  delay = 0,
): Mob | null {
  for (let k = 0; k < 12; k++) {
    const a = sim.rng() * TAU;
    const r = r0 + sim.rng() * (r1 - r0);
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (api.solidTile(sim, Math.floor(px), Math.floor(py)) || onTrack(sim, px, py)) continue;
    const m = api.spawnMob(sim, kind, Math.floor(px) + 0.5, Math.floor(py) + 0.5, { mode: 'drop' });
    m.t = -delay;
    return m;
  }
  return null;
}

/** Час пик: барьер на замок, волны толпы, страж. */
function stepRush(sim: Sim, st: F12State, api: SimApi): void {
  const ev = st.rush;
  const h = sim.hero;
  const w = sim.world;
  if (ev.row < 0 || ev.st === 'done') return;
  if (ev.st === 'idle') {
    // Перешёл барьер на север — в платную зону.
    if (
      sim.area === F12_HALL &&
      h.y < ev.row - 1.2 &&
      h.y > ev.row - 9 &&
      h.x > ev.x0 &&
      h.x < ev.x1 + 1
    ) {
      ev.st = 'on';
      ev.t = sim.time;
      ev.wave = 0;
      for (const i of ev.cells) {
        const x = i % w.w;
        const y = Math.floor(i / w.w);
        api.setTile(sim, x, y, T_WALL, MK.locked);
      }
      sim.events.push({ t: 'shake', k: 0.4 });
      sim.events.push({
        t: 'boss',
        what: 'f12_rush_trap',
        text: 'ЧАС ПИК',
        sub: 'турникеты заперло — продержись или свали стража',
      });
    }
    return;
  }
  const t = sim.time - ev.t;
  // Ушёл из вестибюля (лифтом, смертью) — час пик кончился без награды.
  if (sim.area !== F12_HALL) {
    ev.st = 'done';
    for (const i of ev.cells) api.setTile(sim, i % w.w, Math.floor(i / w.w), T_FLOOR, MK.tile);
    return;
  }
  const guard = st.posts.find((p) => p.kind === 'f12_turnstile');
  const guardDead = !guard || guard.mob === -2;
  // Волны толпы: мухи, пассажиры, многоликий.
  const waves = [1.2, 8, 15, 22];
  if (ev.wave < waves.length && t > waves[ev.wave]) {
    const kinds =
      ev.wave === 0
        ? ['f12_flies', 'f12_flies', 'f12_flies', 'f12_flies']
        : ev.wave === 1
          ? ['f12_sleeper', 'f12_flies', 'f12_flies', 'f12_sleeper']
          : ev.wave === 2
            ? ['f12_manyface', 'f12_flies', 'f12_flies']
            : ['f12_sleeper', 'f12_poster', 'f12_flies', 'f12_flies'];
    for (let i = 0; i < kinds.length; i++) {
      const m = dropNear(sim, api, kinds[i], h.x, h.y, 2.5, 5, i * 0.15);
      if (m && kinds[i] === 'f12_sleeper') m.data.woke = 1;
    }
    ev.wave += 1;
    if (ev.wave > 1)
      sayOnce(sim, `rush${ev.wave}`, 3, {
        what: 'f12_rush_call',
        text: 'ТОЛПА',
        sub: `волна ${ev.wave} из ${waves.length}`,
      });
  }
  const clear =
    ev.wave >= waves.length &&
    !sim.mobs.some(
      (m) =>
        m.mode !== 'dying' &&
        (m.kind === 'f12_flies' || m.kind === 'f12_sleeper') &&
        hypot(m.x - h.x, m.y - h.y) < 9,
    );
  if (guardDead || (t > 30 && clear) || t > 45 || heroDown(sim)) {
    ev.st = heroDown(sim) ? 'idle' : 'done';
    for (const i of ev.cells) {
      const x = i % w.w;
      const y = Math.floor(i / w.w);
      api.setTile(sim, x, y, T_FLOOR, MK.tile);
    }
    if (!heroDown(sim)) {
      sim.events.push({
        t: 'boss',
        what: 'f12_rush_call',
        text: 'ТУРНИКЕТЫ ОТКРЫТЫ',
        sub: guardDead ? 'страж пал' : 'час пик схлынул',
      });
      for (let i = 0; i < 4; i++) api.dropAt(sim, 'coin', 180, h.x, h.y);
      api.dropAt(sim, 'f12mat', 2, h.x, h.y);
      api.dropAt(sim, 'token', 3, h.x, h.y);
    }
  }
}

/** Бегущая лестница: ленты идут вспять и вдвое быстрее, со свода — мухи. */
function stepStairs(sim: Sim, st: F12State, api: SimApi): void {
  const ev = st.stairs;
  const h = sim.hero;
  if (ev.st === 'done' || !st.lanes.length) return;
  const on = laneAt(st, h.x, h.y);
  if (ev.st === 'idle') {
    if (on && h.y < on.y1 - 8 && h.y > on.y0 + 6) {
      ev.st = 'on';
      ev.t = sim.time;
      ev.wave = 0;
      for (const l of st.lanes) {
        l.view.dir = l.base === 0 ? 0 : 1;
        l.view.speed = ESC_SPEED * 2.1;
      }
      sim.events.push({ t: 'shake', k: 0.35 });
      sim.events.push({
        t: 'boss',
        what: 'f12_stairs_trap',
        text: 'БЕГУЩАЯ ЛЕСТНИЦА',
        sub: 'ленты пошли вспять — держись стоячей',
      });
      wakeSleepers(sim, api, h.x, h.y, 10, 16);
    }
    return;
  }
  const t = sim.time - ev.t;
  if (ev.wave < 3 && t > 1 + ev.wave * 5 && sim.area === F12_HALL) {
    for (let i = 0; i < 3 + ev.wave; i++)
      dropNear(sim, api, 'f12_flies', h.x, h.y - 2, 1.5, 4, i * 0.12);
    ev.wave += 1;
  }
  if (t > 18 || heroDown(sim)) {
    for (const l of st.lanes) {
      l.view.dir = l.base;
      l.view.speed = ESC_SPEED;
    }
    ev.st = heroDown(sim) ? 'idle' : 'done';
    if (ev.st === 'done')
      sim.events.push({
        t: 'boss',
        what: 'f12_stairs_call',
        text: 'ЛЕНТЫ ВСТАЛИ',
        sub: 'эскалатор снова в своём ходу',
      });
  }
}

/** Сбой света на станции: свет гаснет, аварийки мигают, спящие встают. */
function stepDark(sim: Sim, st: F12State, api: SimApi): void {
  const ev = st.dark;
  const h = sim.hero;
  const [x0, y0, x1, y1] = ev.rect;
  if (ev.st === 'done' || x1 <= x0) return;
  if (ev.st === 'idle') {
    // Вступил на островную платформу.
    const plat = sim.world.bands.find((b) => b.def.id === F12_PLAT);
    if (!plat) return;
    const ly = h.y - plat.top;
    if (ly > 87.5 && ly < 93 && h.x > 6 && h.x < 58) darkOn(sim, st, api);
    return;
  }
  const t = sim.time - ev.t;
  // Аварийные лампы мигают красным.
  const on = Math.floor(t * 2.2) % 2 === 0;
  ev.emerg.forEach(([x, y], i) =>
    api.light(sim, `f12_emerg${i}`, { x, y, r: on ? 2.6 : 1.2, tint: 'red' }),
  );
  if (t > 34 || heroDown(sim)) darkOff(sim, st, api, heroDown(sim));
}

function darkOn(sim: Sim, st: F12State, api: SimApi): void {
  const ev = st.dark;
  const [x0, y0, x1, y1] = ev.rect;
  ev.st = 'on';
  ev.t = sim.time;
  const lights = sim.world.lights;
  // Свет у вылазки свой (копия): гасим станцию, не трогая мир страницы.
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    if (l.x < x0 || l.x > x1 || l.y < y0 || l.y > y1) continue;
    if ([...sim.lightKeys.values()].includes(l)) continue;
    ev.saved.set(i, l.r);
    lights[i] = { ...l, r: 0 };
  }
  F12_FX.dark = [x0, y0, x1, y1];
  wakeSleepers(sim, api, (x0 + x1) / 2, (y0 + y1) / 2, 40, 20);
  sim.events.push({ t: 'flash', color: '#000000', k: 0.8 });
  sim.events.push({
    t: 'boss',
    what: 'f12_dark_trap',
    text: 'СБОЙ СВЕТА',
    sub: 'щиток — на северной стене, у края платформы',
  });
  // Поезд в темноте — сейчас.
  const tr = trackNear(st, sim.hero.x, sim.hero.y, 6);
  if (tr) callTrain(sim, tr, 4.5, false);
}

function darkOff(sim: Sim, st: F12State, api: SimApi, reset = false): void {
  const ev = st.dark;
  const lights = sim.world.lights;
  for (const [i, r] of ev.saved) if (lights[i]) lights[i] = { ...lights[i], r };
  ev.saved.clear();
  ev.emerg.forEach((_, i) => api.light(sim, `f12_emerg${i}`, null));
  F12_FX.dark = null;
  ev.st = reset ? 'idle' : 'done';
  if (!reset)
    sim.events.push({
      t: 'boss',
      what: 'f12_dark_call',
      text: 'СВЕТ ДАН',
      sub: 'станция снова видна',
    });
}

/** Встречный: в перегоне T1 экспресс навстречу — к нишам. */
function stepMeet(sim: Sim, st: F12State): void {
  const ev = st.meet;
  if (ev.st !== 'idle') return;
  const h = sim.hero;
  const t = st.tracks.find((k) => k.area === F12_PLAT && k.pad > 0 && k.dir < 0);
  if (!t) return;
  if (h.y < t.y - 1.5 || h.y > t.y + 3.5 || h.x > 44 || h.x < 26) return;
  if (t.train) return;
  ev.st = 'done';
  ev.t = sim.time;
  // Экспресс с запада, навстречу идущему от лестницы; потом линия снова в
  // своём ходу (см. `stepTracks`: поезд ушёл — направление вернулось).
  t.restore = t.dir;
  t.dir = 1;
  t.view.dir = 1;
  t.next = sim.time + 3.4;
  t.express = true;
  sim.events.push({ t: 'shake', k: 0.3 });
  sim.events.push({
    t: 'boss',
    what: 'f12_meet_trap',
    text: 'ВСТРЕЧНЫЙ',
    sub: 'фары из тоннеля — в нишу!',
  });
}

/** Малая территория в зале святилища. */
function stepHall(sim: Sim, st: F12State, api: SimApi): void {
  const ev = st.hall;
  const h = sim.hero;
  if (ev.st === 'done') return;
  if (ev.st === 'idle') {
    if (hypot(h.x - ev.cx, h.y - ev.cy) < 3.2) {
      ev.st = 'on';
      ev.t = sim.time;
      ev.wave = 0;
      ev.terr = openTerritory(sim, api, ev.cx, ev.cy, 7.4, 'hall', -1);
      sim.events.push({ t: 'flash', color: '#b0206a', k: 0.7 });
      sim.events.push({ t: 'shake', k: 0.5 });
      sim.events.push({
        t: 'boss',
        what: 'f12_hall_trap',
        text: 'МАЛАЯ ТЕРРИТОРИЯ',
        sub: 'метка ходит за тобой — разбей три столба',
      });
    }
    return;
  }
  const t = sim.time - ev.t;
  if (ev.wave < 3 && t > 2 + ev.wave * 7) {
    const kinds =
      ev.wave === 1
        ? ['f12_doll', 'f12_flies', 'f12_flies']
        : ['f12_flies', 'f12_flies', 'f12_manyface'];
    for (let i = 0; i < kinds.length; i++)
      dropNear(sim, api, kinds[i], ev.cx, ev.cy, 2.5, 5.5, i * 0.2);
    ev.wave += 1;
  }
  if (heroDown(sim) && ev.terr) {
    closeTerritory(sim, ev.terr, false);
    ev.terr = null;
    ev.st = 'idle';
  }
}

function hallWon(sim: Sim, st: F12State, api: SimApi, tr: Territory): void {
  const ev = st.hall;
  if (ev.terr !== tr) return;
  ev.st = 'done';
  ev.terr = null;
  for (let i = 0; i < 5; i++) api.dropAt(sim, 'coin', 260, tr.x, tr.y);
  api.dropAt(sim, 'f12_talisman', 2, tr.x, tr.y);
  api.dropAt(sim, 'token', 4, tr.x, tr.y);
  if (sim.rng() < 0.35) api.dropAt(sim, 'f12_finger', 1, tr.x, tr.y);
}

/** Последний поезд: призрак встаёт у платформы и выпускает пассажиров. */
function stepGhost(sim: Sim, st: F12State): void {
  const ev = st.ghost;
  if (ev.st !== 'idle') return;
  const h = sim.hero;
  const t = st.tracks.find((k) => k.cfg.kind === 'ghost');
  if (!t) return;
  if (h.y < t.y - 9 || h.y > t.y + 12 || h.x < t.wx0 || h.x > t.wx1) return;
  ev.st = 'on';
  ev.t = sim.time;
  t.next = sim.time + 5.5;
  sim.events.push({
    t: 'boss',
    what: 'f12_ghost_call',
    text: 'ПОСЛЕДНИЙ ПОЕЗД',
    sub: 'с того света без машиниста — отойди от края',
  });
}

function ghostStop(sim: Sim, api: SimApi, t: Track, tr: Train): void {
  const st = stateOf(sim);
  sim.events.push({
    t: 'boss',
    what: 'f12_ghost_trap',
    text: 'ДВЕРИ ОТКРЫВАЮТСЯ',
    sub: 'пассажиры выходят',
  });
  const [a, b] = trainSpan(sim, tr);
  const kinds = [
    'f12_sleeper',
    'f12_sleeper',
    'f12_manyface',
    'f12_sleeper',
    'f12_flies',
    'f12_flies',
  ];
  // Выходят на платформу к северу от путей.
  kinds.forEach((k, i) => {
    const x = a + ((i + 0.5) / kinds.length) * (b - a);
    const y = t.y - 1.5;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return;
    const m = api.spawnMob(sim, k, x, y, { mode: k === 'f12_sleeper' ? 'f12_wake' : 'stun' });
    m.t = -i * 0.25;
    m.data.woke = 1;
  });
  st.ghost.st = 'done';
  st.ghost.t = sim.time;
}

// ---------------------------------------------------------------------------
// Действия этажа: рычаг, щиток, колокол.
// ---------------------------------------------------------------------------

const LEVER_HOLD = 15;
const LEVER_CD = 32;
const BELL_CD = 18;

function labelOf(sim: Sim, o: WorldObj): string | null {
  const st = stateOf(sim);
  const cd = st.useCd[o.id] ?? 0;
  if (o.ref === 'f12_lever') return sim.time < cd ? null : 'Перевести стрелку';
  if (o.ref === 'f12_breaker') return st.dark.st === 'on' ? 'Дать свет' : null;
  if (o.ref === 'f12_bell') return sim.time < cd ? null : 'Вызвать поезд';
  return null;
}

function onUse(sim: Sim, o: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim);
  if (labelOf(sim, o) === null) return false;
  if (o.ref === 'f12_lever') {
    // Стрелка уводит поезда узловой на обход: пути свободны 15 с.
    const band = sim.world.bands.find((b) => o.y >= b.top && o.y < b.top + b.h);
    for (const t of st.tracks) {
      if (t.area !== band?.def.id || t.y > o.y || o.y - t.y > 22) continue;
      t.hold = sim.time + LEVER_HOLD;
    }
    F12_FX.lever = sim.time + LEVER_HOLD;
    st.useCd[o.id] = sim.time + LEVER_CD;
    sim.events.push({ t: 'clank', x: o.x + 0.5, y: o.y + 0.5 });
    sim.events.push({
      t: 'boss',
      what: 'f12_lever_call',
      text: 'СТРЕЛКА ПЕРЕВЕДЕНА',
      sub: 'поезда ушли на обход — 15 секунд',
    });
    return true;
  }
  if (o.ref === 'f12_breaker') {
    darkOff(sim, st, api);
    sim.events.push({ t: 'clank', x: o.x + 0.5, y: o.y + 1 });
    return true;
  }
  if (o.ref === 'f12_bell') {
    const t = trackNear(st, o.x + 0.5, o.y + 0.5, 7);
    if (!t || !callTrain(sim, t, 3.2, false)) {
      sayOnce(sim, 'bell-no', 3, {
        what: 'f12_bell_call',
        text: 'ПУТЬ ЗАНЯТ',
        sub: 'поезд и так идёт',
      });
      return false;
    }
    st.useCd[o.id] = sim.time + BELL_CD;
    sim.events.push({
      t: 'boss',
      what: 'f12_bell_call',
      text: 'ПОЕЗД ВЫЗВАН',
      sub: 'через три секунды — заманивай на рельсы',
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Правила этажа.
// ---------------------------------------------------------------------------

registerFloor(12, {
  start(sim, api) {
    STATE.delete(sim);
    const st = stateOf(sim);
    // Вылазка начинается: у лифта первый поезд — через несколько секунд
    // (глагол этажа виден сразу), остальные — по расписанию.
    for (const t of st.tracks) t.next = sim.time + t.cfg.first;
    F12_FX.dark = null;
    F12_FX.domain = 0;
    F12_FX.lever = 0;
    void api;
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    F12_FX.time = sim.time;
    stepPosts(sim, st, api);
    stepTracks(sim, st, api, dt);
    stepLanes(sim, st, api, dt);
    stepTerritories(sim, st, api, dt);
    stepRush(sim, st, api);
    stepStairs(sim, st, api);
    stepDark(sim, st, api);
    stepMeet(sim, st);
    stepHall(sim, st, api);
    stepGhost(sim, st);
    // Король пал, пока храм сворачивался: сценарий босса больше не ходит —
    // зал и путь арены возвращаем здесь, разом.
    if (sim.boss && sim.boss.state !== 'fight' && KSTATE.has(sim)) restoreArena(sim, api);
  },
  onUse,
  useLabel: labelOf,
});

// ---------------------------------------------------------------------------
// Поезд (вагоны и фары): двигает правило этажа, ИИ ничего не делает.
// ---------------------------------------------------------------------------

registerBrain('f12_train', {
  raw: true,
  step(_sim, m) {
    m.vx = 0;
    m.vy = 0;
  },
  onHit: () => 0,
});

// ---------------------------------------------------------------------------
// Рой мух: облако, зигзаг, укус с ядом. Летает — и над тоннелями.
// ---------------------------------------------------------------------------

export const FLIES = { bite: 0.36 };

registerBrain('f12_flies', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        if (dist < def.reach + m.r + h.r + 0.1 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 11 + m.id * 1.7) * 0.8;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * (dist < 1.3 ? 0.55 : 1), dt);
        return;
      }
      case 'windup':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > def.windup - 0.22) m.danger = 1.2;
        if (m.t >= def.windup) {
          if (dist < def.reach + m.r + h.r + 0.2)
            api.hurtHero(sim, m.dmg, m.x, m.y, 1, m.kind, { kind: 'poison', dur: 1.6 });
          m.vx += Math.cos(m.face) * 4;
          m.vy += Math.sin(m.face) * 4;
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.5);
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
// Многоликий: удар сверху конусом и КРИК — три кольца волной.
// ---------------------------------------------------------------------------

export const FACES = {
  slamR: 1.7,
  slamArc: 1.7,
  screamCharge: 1.05,
  rings: [1.5, 2.8, 4.1],
  ringW: 0.5,
  ringStep: 0.28,
};

registerBrain('f12_manyface', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.data.scd = (m.data.scd ?? 3 + sim.rng() * 3) - dt;
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        if (dist < def.reach + m.r + h.r + 0.2 && m.cd <= 0) {
          api.setMode(m, 'f12_slam');
          m.face = Math.atan2(dy, dx);
          return;
        }
        if (dist > 2 && dist < 5.5 && m.data.scd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'f12_scream');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'f12_slam': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const k = Math.min(1, m.t / def.windup);
        m.tele = { shape: 'cone', r: FACES.slamR, ang: m.face, arc: FACES.slamArc, k };
        if (m.t > def.windup - 0.25) m.danger = FACES.slamR + 0.4;
        if (m.t >= def.windup) {
          const off = Math.abs(angDiff(Math.atan2(h.y - m.y, h.x - m.x), m.face));
          if (dist < FACES.slamR + h.r && off < FACES.slamArc / 2 + 0.25 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          sim.events.push({
            t: 'strike',
            x: m.x + Math.cos(m.face),
            y: m.y + Math.sin(m.face),
            art: 'f12_slam',
          });
          m.tele = null;
          m.danger = 0;
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.9 + sim.rng() * 0.3);
        }
        return;
      }
      case 'f12_scream': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const k = Math.min(1, m.t / FACES.screamCharge);
        m.tele = { shape: 'ring', r: FACES.rings[0], w: 0.25, k };
        if (m.t >= FACES.screamCharge) {
          m.tele = null;
          // Волна: кольцо за кольцом — рывком сквозь или вне досягаемости.
          FACES.rings.forEach((r, i) =>
            api.strike(sim, {
              shape: 'ring',
              x: m.x,
              y: m.y,
              r,
              w: FACES.ringW,
              warn: 0.3 + i * FACES.ringStep,
              dmg: m.dmg * 0.55,
              knock: 3,
              status: 'stun',
              dur: 0.45,
              art: 'f12_scream',
              from: m.id,
            }),
          );
          sim.events.push({ t: 'boss', what: 'f12_scream_call' });
          api.setMode(m, 'f12_after');
          m.data.scd = 7 + sim.rng() * 3;
        }
        return;
      }
      case 'f12_after':
        // Кричал — открыт: рты хватают воздух.
        recoverStep(m, api, 1.3);
        return;
      case 'recover':
        recoverStep(m, api, 0.7);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(_sim, m) {
    return m.mode === 'f12_after' ? 1.4 : 1;
  },
});

// ---------------------------------------------------------------------------
// Длиннорукий: живёт в треснувшей стене. Рука линией через проход — хватает
// и тянет к стене, пасть в трещине кусает. Пока рука снаружи — открыт.
// ---------------------------------------------------------------------------

export const ARM = {
  aim: 0.75,
  lock: 0.3,
  reach: 4.6,
  w: 0.42,
  pull: 9,
  maul: 0.55,
  out: 1.7,
  hide: 2.4,
};

registerBrain('f12_longarm', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist } = c;
    const wx = m.data.wx ?? m.x;
    const wy = m.data.wy ?? m.y;
    m.vx = 0;
    m.vy = 0;
    m.x = m.hx;
    m.y = m.hy;
    const toHero = Math.atan2(h.y - wy, h.x - wx);
    const out = Math.atan2(m.hy - wy, m.hx - wx);
    switch (m.mode) {
      case 'dying':
        return;
      case 'f12_hide':
      case 'stun': {
        m.data.ghost = 1;
        m.tele = null;
        m.danger = 0;
        if (heroDown(sim)) return;
        // Герой в досягаемости и перед трещиной (не за стеной).
        const d = hypot(h.x - wx, h.y - wy);
        if (
          m.t > (m.data.cool ?? 0) &&
          d < ARM.reach &&
          Math.abs(angDiff(toHero, out)) < 1.25 &&
          api.lineOfSight(sim, m.hx, m.hy, h.x, h.y)
        ) {
          api.setMode(m, 'aim');
          m.data.ang = toHero;
          m.face = toHero;
        }
        return;
      }
      case 'aim': {
        m.data.ghost = 1;
        // Целится до `lock`, потом рука замирает — окно отойти с линии.
        if (m.t < ARM.aim - ARM.lock) m.data.ang = Math.atan2(h.y - wy, h.x - wx);
        m.face = m.data.ang;
        const k = Math.min(1, m.t / ARM.aim);
        m.tele = { shape: 'line', r: ARM.reach, w: ARM.w, ang: m.data.ang, k, x: wx, y: wy };
        if (m.t > ARM.aim - 0.24) m.danger = 1.6;
        if (m.t >= ARM.aim) {
          m.tele = null;
          m.danger = 0;
          const hit = lineHits(wx, wy, m.data.ang, ARM.reach, ARM.w, h.x, h.y, h.r) && canHurt(sim);
          if (hit) {
            api.hurtHero(sim, m.dmg * 0.6, wx, wy, 0, m.kind);
            // Тянет к стене, к пасти в трещине.
            api.pullHero(sim, m.hx, m.hy, { speed: ARM.pull, max: 0.7 });
            sim.events.push({
              t: 'boss',
              what: 'f12_grab_call',
              text: 'СХВАТИЛ',
              sub: 'бей руку — она открыта',
            });
            api.setMode(m, 'f12_maul');
          } else api.setMode(m, 'f12_reach');
          m.data.ghost = 0;
        }
        return;
      }
      case 'f12_maul': {
        m.data.ghost = 0;
        const k = Math.min(1, m.t / ARM.maul);
        m.tele = { shape: 'circle', r: 1.1, k, x: m.hx, y: m.hy };
        if (m.t > ARM.maul - 0.22) m.danger = 1.5;
        if (m.t >= ARM.maul) {
          if (dist < 1.1 + h.r && canHurt(sim)) api.hurtHero(sim, m.dmg, wx, wy, 6, m.kind);
          m.tele = null;
          m.danger = 0;
          api.setMode(m, 'f12_reach');
        }
        return;
      }
      case 'f12_reach':
        // Рука лежит на полу — открыт.
        m.data.ghost = 0;
        m.tele = null;
        if (m.t >= ARM.out) {
          api.setMode(m, 'f12_hide');
          m.data.cool = ARM.hide;
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.1);
        }
        return;
      default:
        api.setMode(m, 'f12_hide');
    }
  },
  onHit(_sim, m) {
    if ((m.data.ghost ?? 0) > 0) return 0;
    return m.mode === 'f12_reach' ? 1.3 : 1;
  },
});

// ---------------------------------------------------------------------------
// Спящий пассажир: дремлет; разбудил — пасть раскрывается, рывок по линии.
// ---------------------------------------------------------------------------

export const SLEEP = { aim: 0.6, lunge: 11, max: 3.2, wake: 0.7, back: 12 };

registerBrain('f12_sleeper', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    switch (m.mode) {
      case 'f12_doze': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.tele = null;
        // Бегом рядом — просыпается; тихо мимо — спит.
        const run = hypot(h.vx, h.vy);
        m.data.near = dist < 1.4 ? (m.data.near ?? 0) + dt : 0;
        if ((dist < 2.4 && run > 4.4) || m.data.near > 1.6) api.setMode(m, 'f12_wake');
        return;
      }
      case 'f12_wake':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t >= SLEEP.wake) {
          m.data.woke = 1;
          m.data.lost = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        if (dist > 9) {
          m.data.lost = (m.data.lost ?? 0) + dt;
          if (m.data.lost > SLEEP.back) {
            api.setMode(m, 'f12_doze');
            return;
          }
        } else m.data.lost = 0;
        if (dist < SLEEP.max && dist > 1 && m.cd <= 0 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'aim');
          m.data.ang = Math.atan2(dy, dx);
          return;
        }
        if (dist <= 1 && m.cd <= 0) {
          api.setMode(m, 'aim');
          m.data.ang = Math.atan2(dy, dx);
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < SLEEP.aim - 0.2) m.data.ang = Math.atan2(dy, dx);
        m.face = m.data.ang;
        const k = Math.min(1, m.t / SLEEP.aim);
        m.tele = { shape: 'line', r: SLEEP.max, w: 0.4, ang: m.data.ang, k };
        if (m.t > SLEEP.aim - 0.24) m.danger = SLEEP.max;
        if (m.t >= SLEEP.aim) {
          m.tele = null;
          m.danger = 0;
          m.data.hitDone = 0;
          m.data.sx = m.x;
          m.data.sy = m.y;
          api.setMode(m, 'f12_lunge');
        }
        return;
      }
      case 'f12_lunge': {
        const a = m.data.ang;
        m.vx = Math.cos(a) * SLEEP.lunge;
        m.vy = Math.sin(a) * SLEEP.lunge;
        if (!m.data.hitDone && dist < m.r + h.r + 0.35 && canHurt(sim)) {
          m.data.hitDone = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
        }
        if (m.t > SLEEP.max / SLEEP.lunge || hypot(m.x - m.data.sx, m.y - m.data.sy) > SLEEP.max) {
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.9 + sim.rng() * 0.4);
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.9);
        return;
      default:
        api.setMode(m, m.data.woke ? 'chase' : 'f12_doze');
    }
  },
  onHit(sim, m, _hit, api) {
    // Удар будит — но первый удар по спящему вдвое сильнее.
    if (m.mode === 'f12_doze') {
      api.setMode(m, 'f12_wake');
      return 2;
    }
    void sim;
    return m.mode === 'recover' ? 1.3 : 1;
  },
});

// ---------------------------------------------------------------------------
// Глаз на своде: прожектор взгляда; заметил — слеза навесом и мухи; потом
// моргает — открыт.
// ---------------------------------------------------------------------------

export const EYE = { wake: 9, sweep: 0.55, arc: 0.72, r: 6.2, spot: 0.7, blink: 1.6, shut: 2.2 };

registerBrain('f12_eye', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist, def } = c;
    m.x = m.hx;
    m.y = m.hy;
    m.vx = 0;
    m.vy = 0;
    const toHero = Math.atan2(h.y - m.y, h.x - m.x);
    switch (m.mode) {
      case 'dying':
        return;
      case 'f12_shut':
      case 'stun':
        m.data.ghost = 1;
        m.tele = null;
        m.danger = 0;
        if (!heroDown(sim) && dist < EYE.wake && m.t > (m.data.cool ?? 0.6)) {
          api.setMode(m, 'f12_look');
          m.data.base = toHero;
          m.data.seen = 0;
        }
        return;
      case 'f12_look': {
        m.data.ghost = 0;
        // Взгляд обводит зал конусом — медленно, туда-сюда.
        const a = (m.data.base ?? 0) + Math.sin(m.t * EYE.sweep * 2) * 1.1;
        m.face = a;
        m.tele = { shape: 'cone', r: EYE.r, ang: a, arc: EYE.arc, k: 0.35 };
        const inCone =
          dist < EYE.r &&
          Math.abs(angDiff(toHero, a)) < EYE.arc / 2 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        m.data.seen = inCone ? (m.data.seen ?? 0) + dt : Math.max(0, (m.data.seen ?? 0) - dt * 2);
        if (m.data.seen > EYE.spot && !heroDown(sim)) {
          api.setMode(m, 'f12_spot');
          m.data.shots = 0;
          sim.events.push({
            t: 'boss',
            what: 'f12_eye_call',
            text: 'ЗАМЕЧЕН',
            sub: 'глаз на своде — уходи из-под взгляда',
          });
        }
        if (m.t > 9 || dist > EYE.wake + 3) {
          api.setMode(m, 'f12_shut');
          m.data.cool = 1.2;
        }
        return;
      }
      case 'f12_spot': {
        m.data.ghost = 0;
        m.face = toHero;
        m.tele = { shape: 'cone', r: EYE.r, ang: toHero, arc: EYE.arc * 0.7, k: 1 };
        // Две слезы навесом по месту героя, и мухи с потолка.
        if (m.data.shots < 2 && m.t > 0.35 + m.data.shots * 0.55) {
          m.data.shots += 1;
          const def2 = def.shot!;
          api.shoot(
            sim,
            m,
            toHero,
            { ...def2, onLand: { r: 0.9, life: 3, slow: 0.55, art: 'f12_tearpool' } },
            h.x,
            h.y,
          );
          if (m.data.shots === 1)
            for (let i = 0; i < 2; i++) dropNear(sim, api, 'f12_flies', h.x, h.y, 2, 3.5, i * 0.2);
        }
        if (m.t > 1.5) {
          m.tele = null;
          api.setMode(m, 'f12_blink');
        }
        return;
      }
      case 'f12_blink':
        // Слезится и моргает — открыт.
        m.data.ghost = 0;
        m.tele = null;
        if (m.t > EYE.blink) {
          api.setMode(m, 'f12_shut');
          m.data.cool = EYE.shut;
        }
        return;
      default:
        api.setMode(m, 'f12_shut');
    }
  },
  onHit(_sim, m) {
    if ((m.data.ghost ?? 0) > 0) return 0;
    return m.mode === 'f12_blink' ? 1.5 : 1;
  },
});

// ---------------------------------------------------------------------------
// Кукла-заклинатель: держится за спинами, иглы веером, МАЛАЯ ТЕРРИТОРИЯ.
// ---------------------------------------------------------------------------

export const DOLL = { keep: [3.6, 6.2], aim: 0.85, cast: 1.3, terrR: 3.4, terrCd: 17 };

registerBrain('f12_doll', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const st = stateOf(sim);
    m.data.tcd = (m.data.tcd ?? 3 + sim.rng() * 3) - dt;
    const mine = st.terrs.find((t) => t.owner === m.id && !t.broken);
    switch (m.mode) {
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (!mine && m.data.tcd <= 0 && dist < 6.5 && see) {
          api.setMode(m, 'cast');
          m.data.cx = h.x;
          m.data.cy = h.y;
          return;
        }
        if (see && dist < def.reach && dist > 2 && m.cd <= 0) {
          api.setMode(m, 'aim');
          m.data.ang = Math.atan2(dy, dx);
          return;
        }
        // Держит дистанцию, прячась за своих.
        let tx = h.x;
        let ty = h.y;
        const [k0, k1] = DOLL.keep;
        if (dist < k0) {
          tx = m.x - dx;
          ty = m.y - dy;
        } else if (dist < k1) {
          tx = m.x + (-dy / (dist || 1)) * 2 * (m.id % 2 ? 1 : -1);
          ty = m.y + (dx / (dist || 1)) * 2 * (m.id % 2 ? 1 : -1);
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < DOLL.aim - 0.25) m.data.ang = Math.atan2(dy, dx);
        m.face = m.data.ang;
        const k = Math.min(1, m.t / DOLL.aim);
        m.tele = { shape: 'cone', r: 5, ang: m.data.ang, arc: 0.55, k };
        if (m.t >= DOLL.aim) {
          m.tele = null;
          api.shoot(sim, m, m.data.ang);
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.9 + sim.rng() * 0.4);
        }
        return;
      }
      case 'cast': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        // Круг встаёт вокруг героя — видно, где он ляжет.
        m.data.cx += (h.x - m.data.cx) * Math.min(1, dt * 3);
        m.data.cy += (h.y - m.data.cy) * Math.min(1, dt * 3);
        const k = Math.min(1, m.t / DOLL.cast);
        m.tele = { shape: 'ring', r: DOLL.terrR, w: 0.18, k, x: m.data.cx, y: m.data.cy };
        if (m.t >= DOLL.cast) {
          m.tele = null;
          openTerritory(sim, api, m.data.cx, m.data.cy, DOLL.terrR, 'doll', m.id);
          sim.events.push({ t: 'flash', color: '#8a2060', k: 0.4 });
          sim.events.push({
            t: 'boss',
            what: 'f12_doll_call',
            text: 'МАЛАЯ ТЕРРИТОРИЯ',
            sub: 'кукла замкнула круг — за край или по столбам',
          });
          m.data.tcd = DOLL.terrCd;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f12_dazed':
        // Круг разбит — отдача: кукла обмякла и открыта.
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        if (m.t > 2) api.setMode(m, 'chase');
        return;
      case 'recover':
        recoverStep(m, api, 0.8);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(_sim, m) {
    // Колдует или обмякла — открыта: отдача рвёт нити.
    return m.mode === 'cast' || m.mode === 'f12_dazed' ? 1.5 : 1;
  },
});

// ---------------------------------------------------------------------------
// Оживший плакат: плоский на стене (недосягаем); отлипает — три бумажных
// пореза; смят — открыт; потом обратно на стену.
// ---------------------------------------------------------------------------

export const POSTER = {
  wake: 4.2,
  peel: 0.55,
  cuts: 3,
  cutWarn: 0.36,
  cutGap: 0.24,
  cutR: 1.35,
  cutArc: 1.5,
  crumple: 1.5,
};

registerBrain('f12_poster', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    switch (m.mode) {
      case 'dying':
        return;
      case 'f12_flat':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        if (!heroDown(sim) && dist < POSTER.wake && m.t > 0.8) api.setMode(m, 'f12_peel');
        return;
      case 'f12_peel':
        m.data.ghost = 1;
        m.face = Math.atan2(dy, dx);
        if (m.t >= POSTER.peel) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'stun':
        m.tele = null;
        m.danger = 0;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.3) api.setMode(m, 'chase');
        return;
      case 'chase': {
        m.data.ghost = 0;
        m.tele = null;
        m.danger = 0;
        if (heroDown(sim)) return;
        if (dist < def.reach + m.r + h.r + 0.4 && m.cd <= 0) {
          api.setMode(m, 'f12_cuts');
          m.data.n = 0;
          return;
        }
        // Порхает: мелкая волна поперёк хода.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 7 + m.id) * 0.45;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed, dt);
        return;
      }
      case 'f12_cuts': {
        m.vx *= 0.75;
        m.vy *= 0.75;
        m.face = Math.atan2(dy, dx);
        // Три пореза веером: каждый — своя метка и свой миг.
        if (m.data.n < POSTER.cuts && m.t > m.data.n * POSTER.cutGap) {
          const a = m.face + (m.data.n - 1) * 0.35;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: POSTER.cutR,
            ang: a,
            arc: POSTER.cutArc,
            warn: POSTER.cutWarn,
            dmg: m.dmg * 0.55,
            knock: 2,
            art: 'f12_papercut',
            from: m.id,
          });
          m.data.n += 1;
          // Порез тянет плакат за собой.
          m.vx += Math.cos(a) * 3;
          m.vy += Math.sin(a) * 3;
        }
        if (m.t > POSTER.cutGap * POSTER.cuts + POSTER.cutWarn + 0.05) {
          api.setMode(m, 'f12_crumple');
          m.cd = def.rest;
        }
        return;
      }
      case 'f12_crumple':
        // Смят и лежит — открыт.
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > POSTER.crumple)
          api.setMode(m, m.hp < m.maxHp * 0.5 && m.data.wx !== undefined ? 'f12_return' : 'chase');
        return;
      case 'f12_return': {
        // Обратно на свою стену — там заклеится и подлечится.
        const tx = m.hx;
        const ty = m.hy;
        const d = hypot(tx - m.x, ty - m.y);
        if (d < 0.3 || m.t > 5) {
          m.x = tx;
          m.y = ty;
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.3);
          api.setMode(m, 'f12_flat');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, tx, ty);
        api.steer(sim, m, cx, cy, m.speed * 1.2, dt);
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(_sim, m) {
    if ((m.data.ghost ?? 0) > 0) return 0;
    return m.mode === 'f12_crumple' ? 1.5 : 1;
  },
});

// ---------------------------------------------------------------------------
// Турникетный страж: щит спереди, створки махом, таран по линии.
// ---------------------------------------------------------------------------

export const GATE = {
  wake: 6.5,
  turn: 2.2,
  barR: 2.1,
  barArc: 2.2,
  aim: 0.85,
  speed: 9.5,
  max: 1.1,
  dizzy: 1.8,
  front: 1.2,
};

registerBrain('f12_turnstile', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const want = Math.atan2(dy, dx);
    const turn = (to: number, k = 1) => {
      const d = angDiff(to, m.face);
      m.face += Math.max(-GATE.turn * k * dt, Math.min(GATE.turn * k * dt, d));
    };
    switch (m.mode) {
      case 'f12_post':
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        if (!heroDown(sim) && dist < GATE.wake) {
          api.setMode(m, 'chase');
          sim.events.push({
            t: 'boss',
            what: 'f12_gate_call',
            text: 'ПРОХОД ЗАКРЫТ',
            sub: 'щит спереди — заходи сбоку',
          });
        }
        return;
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        turn(want);
        if (dist < GATE.barR + h.r - 0.2 && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        if (
          dist > 3 &&
          dist < 8 &&
          m.cd <= 0 &&
          Math.abs(angDiff(want, m.face)) < 0.3 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          api.setMode(m, 'f12_aim');
          m.data.ang = want;
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        // Идёт лицом вперёд: боком медленнее.
        const k = 0.45 + 0.55 * Math.max(0, Math.cos(angDiff(Math.atan2(cy, cx), m.face)));
        m.vx += (cx * m.speed * k - m.vx) * Math.min(1, dt * 8);
        m.vy += (cy * m.speed * k - m.vy) * Math.min(1, dt * 8);
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        turn(want, 0.4);
        const k = Math.min(1, m.t / def.windup);
        m.tele = { shape: 'cone', r: GATE.barR, ang: m.face, arc: GATE.barArc, k };
        if (m.t > def.windup - 0.25) m.danger = GATE.barR + 0.3;
        if (m.t >= def.windup) {
          const off = Math.abs(angDiff(want, m.face));
          if (dist < GATE.barR + h.r && off < GATE.barArc / 2 + 0.2 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
          sim.events.push({ t: 'clank', x: m.x + Math.cos(m.face), y: m.y + Math.sin(m.face) });
          m.tele = null;
          m.danger = 0;
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'f12_aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < GATE.aim - 0.3) m.data.ang = Math.atan2(dy, dx);
        m.face = m.data.ang;
        const k = Math.min(1, m.t / GATE.aim);
        m.tele = { shape: 'line', r: 7.5, w: 0.6, ang: m.face, k };
        if (m.t > GATE.aim - 0.25) m.danger = 2.2;
        if (m.t >= GATE.aim) {
          m.tele = null;
          m.danger = 0;
          m.bounce = true;
          m.data.hitDone = 0;
          api.setMode(m, 'charge');
        }
        return;
      }
      case 'charge': {
        const a = m.data.ang;
        m.vx = Math.cos(a) * GATE.speed;
        m.vy = Math.sin(a) * GATE.speed;
        m.face = a;
        if (!m.data.hitDone && dist < m.r + h.r + 0.3 && canHurt(sim)) {
          m.data.hitDone = 1;
          api.hurtHero(sim, m.dmg * 1.1, m.x, m.y, 9, m.kind);
        }
        if (m.t > GATE.max) {
          m.bounce = false;
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.tele = null;
        if (m.t > GATE.dizzy) api.setMode(m, 'chase');
        return;
      case 'recover':
        recoverStep(m, api, 0.9);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'charge') return;
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    api.setMode(m, 'dizzy');
    sim.events.push({ t: 'boss', what: 'f12_gate_wall' });
  },
  onHit(_sim, m, hit) {
    if (m.mode === 'dizzy') return 1.6;
    // Щит — створки спереди.
    const from = hit.ang + Math.PI;
    const front = Math.abs(angDiff(from, m.face)) < GATE.front;
    if (front) return hit.heavy ? 0.35 : 0.12;
    return 1.35;
  },
});

// ---------------------------------------------------------------------------
// Путевой обходчик: красный фонарь; машет им — зовёт поезд на твой путь.
// ---------------------------------------------------------------------------

export const LINE = { see: 9, wave: 1.5, waveCd: 14, swing: 0.7, swingR: 1.3, swingArc: 1.6 };

registerBrain('f12_lineman', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    const st = stateOf(sim);
    m.data.wcd = (m.data.wcd ?? 2 + sim.rng() * 2) - dt;
    switch (m.mode) {
      case 'f12_patrol': {
        // Ходит вдоль путей, светит фонарём.
        const dir = m.data.pdir ?? (m.id % 2 ? 1 : -1);
        m.data.pdir = dir;
        api.steer(sim, m, dir, 0, m.speed * 0.45, dt);
        if (
          api.solidTile(sim, Math.floor(m.x + dir * 0.8), Math.floor(m.y)) ||
          Math.abs(m.x - m.hx) > 9
        )
          m.data.pdir = -dir;
        if (!heroDown(sim) && dist < LINE.see && api.lineOfSight(sim, m.x, m.y, h.x, h.y))
          api.setMode(m, 'chase');
        return;
      }
      case 'chase': {
        m.tele = null;
        m.danger = 0;
        const t = trackNear(st, h.x, h.y, 3.5);
        if (
          t &&
          m.data.wcd <= 0 &&
          dist > 2.2 &&
          dist < 10 &&
          !t.train &&
          t.next - sim.time > 4 &&
          onTrack(sim, h.x, h.y)
        ) {
          api.setMode(m, 'f12_wave');
          m.data.track = t.id;
          return;
        }
        if (dist < def.reach + m.r + h.r + 0.2 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'f12_wave': {
        // Машет фонарём: сбить — поезда не будет.
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = Math.atan2(dy, dx);
        if (m.t >= LINE.wave) {
          const t = st.tracks.find((k) => k.id === m.data.track);
          if (t && callTrain(sim, t, 2.8, true))
            sim.events.push({
              t: 'boss',
              what: 'f12_signal_trap',
              text: 'ОБХОДЧИК ВЫЗВАЛ ПОЕЗД',
              sub: 'экспресс — с путей!',
            });
          m.data.wcd = LINE.waveCd;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const k = Math.min(1, m.t / def.windup);
        m.tele = { shape: 'cone', r: LINE.swingR, ang: m.face, arc: LINE.swingArc, k };
        if (m.t > def.windup - 0.22) m.danger = LINE.swingR + 0.3;
        if (m.t >= def.windup) {
          const off = Math.abs(angDiff(Math.atan2(dy, dx), m.face));
          if (dist < LINE.swingR + h.r && off < LINE.swingArc / 2 + 0.2 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
          m.tele = null;
          m.danger = 0;
          api.setMode(m, 'recover');
          m.cd = def.rest;
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
  onHit(_sim, m, _hit, api) {
    // Сбил с замаха фонарём — поезда не будет.
    if (m.mode === 'f12_wave') {
      api.setMode(m, 'stun');
      m.data.wcd = LINE.waveCd * 0.6;
      return 1.3;
    }
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Безбилетник: удирает с мешком, от ударов сыплет монеты.
// ---------------------------------------------------------------------------

registerBrain('f12_dodger', {
  step(sim, m, dt, c, api) {
    const { dx, dy, dist } = c;
    const away = api.flowDir(sim, m.x, m.y, true);
    const d = away ?? [-dx / (dist || 1), -dy / (dist || 1)];
    const z = Math.sin(sim.time * 6 + m.id) * 0.4;
    api.steer(sim, m, d[0] - d[1] * z, d[1] + d[0] * z, m.speed, dt);
    m.data.age = (m.data.age ?? 0) + dt;
    if (m.data.age > 22 && dist > 6) {
      api.setMode(m, 'escape');
      m.hp = 0;
    }
  },
  onHit(sim, m, _hit, api) {
    api.dropAt(sim, 'coin', 60, m.x, m.y);
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Столб территории: стоит, держит круг. Встаёт из пола.
// ---------------------------------------------------------------------------

registerBrain('f12_pillar', {
  raw: true,
  step(_sim, m, _dt, _c, api) {
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    m.tele = null;
    if (m.mode === 'dying' || m.mode === 'escape') return;
    if (m.mode === 'f12_rise') {
      m.data.ghost = m.t < 0.5 ? 1 : 0;
      if (m.t > 0.6) api.setMode(m, 'f12_stand');
      return;
    }
    m.data.ghost = 0;
  },
});

// ---------------------------------------------------------------------------
// Двуликий король проклятий. Ведёт все режимы сам.
//   f12_intro   — сидит у храма, встаёт; недосягаем;
//   chase       — идёт к герою;
//   f12_cut     — «Рассечение»: три параллельных разреза к герою;
//   f12_cleave  — «Расщепление»: крест разрезов под героем и конус вплотную;
//   f12_bow     — «Огненная стрела» (с фазы 1): тетива, линия через арену,
//                 горящий след; пока натягивает — спина открыта;
//   f12_pyre    — столбы пламени у героя;
//   f12_cast    — «РАСШИРЕНИЕ ТЕРРИТОРИИ» (фаза 2): зал переписывается;
//   f12_domain  — сидит в храме (недосягаем): разрезы сеткой, обереги,
//                 три чаши держат храм;
//   f12_broken  — храм рухнул: оглушён и открыт вдвое;
//   f12_trainhit — сбит поездом: оглушён и открыт;
//   recover     — после удара открыт.
// ---------------------------------------------------------------------------

export const KING = {
  hp: [0.75, 0.5, 0.25],
  intro: 2.6,
  cutAim: 0.78,
  cutLen: 10,
  cutW: 0.36,
  cutGap: 1.35,
  cleaveWarn: 0.82,
  cleaveLen: 4.8,
  coneR: 2.3,
  coneArc: 1.9,
  bowDraw: 1.65,
  bowW: 1.05,
  pyreWarn: 0.95,
  cast: 2.6,
  gridEvery: 3.4,
  gridWarn: 1.35,
  gridCut: 0.45,
  gridStep: 3,
  wardR: 1.15,
  domainMax: 48,
  broken: 4.2,
  trainStun: 2.4,
  trainDmg: 0.08,
};

interface KingState {
  /** Клетки, сменённые боем: вернуть на сброс. */
  changed: Map<number, { tile: number; mark: number }>;
  /** Храм: волна переписи (клетки по удалённости от помоста). */
  wave: number[][];
  waveAt: number;
  waveBack: boolean;
  domainOn: boolean;
  domainT: number;
  /** Разрез сеткой: когда следующая метка, когда удар и до каких пор. */
  gridAt: number;
  cutAt: number;
  gridCutUntil: number;
  gridDone: boolean;
  cutHit: boolean;
  cutOn: boolean;
  wards: { x: number; y: number; z: Zone | null; lit: number }[];
  grid: Zone | null;
  bowls: number[];
  shrine: Zone | null;
  box: [number, number, number, number];
  dais: [number, number];
  fire: number;
  miniAt: number;
}

const KSTATE = new WeakMap<Sim, KingState>();

function kingState(sim: Sim): KingState {
  let st = KSTATE.get(sim);
  if (!st) {
    st = {
      changed: new Map(),
      wave: [],
      waveAt: 0,
      waveBack: false,
      domainOn: false,
      domainT: 0,
      gridAt: 1e9,
      cutAt: 0,
      gridCutUntil: 0,
      gridDone: true,
      cutHit: false,
      cutOn: false,
      wards: [],
      grid: null,
      bowls: [],
      shrine: null,
      box: [0, 0, 0, 0],
      dais: [0, 0],
      fire: 0,
      miniAt: 0,
    };
    KSTATE.set(sim, st);
  }
  return st;
}

/** Для тестов и бота: храм, обереги, чаши. */
export const f12King = (sim: Sim) => KSTATE.get(sim) ?? null;

const kingOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f12boss' && x.mode !== 'dying');

const hasteOf = (sim: Sim) => ((sim.boss?.phase ?? 0) >= 3 ? 1.3 : 1);
/** Зона-картинка: поля `v…` читает `f12-boss-fx.ts`. */ // v2.87 — только рисунок
const vfx = (sim: Sim, api: SimApi, z: ZoneIn & Record<string, number | string | boolean>) =>
  api.vfx(sim, z); // v2.87 — только рисунок

/** Сменить клетку, запомнив, какой она была (для сброса боя). */
function retile(sim: Sim, api: SimApi, i: number, tile: number, mark: number): void {
  const ks = kingState(sim);
  const w = sim.world;
  if (!ks.changed.has(i)) ks.changed.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark);
}

function restoreArena(sim: Sim, api: SimApi): void {
  const ks = KSTATE.get(sim);
  if (ks) {
    const W = sim.world.w;
    for (const [i, v] of ks.changed) api.setTile(sim, i % W, Math.floor(i / W), v.tile, v.mark);
    sim.zones = sim.zones.filter(
      (z) => z !== ks.grid && z !== ks.shrine && !ks.wards.some((w) => w.z === z),
    );
  }
  KSTATE.delete(sim);
  api.light(sim, 'f12_shrine', null);
  F12_FX.domain = 0;
  const st = STATE.get(sim);
  if (st) for (const t of st.tracks) if (t.cfg.kind === 'arena') t.off = false;
}

/** Путь арены. */
const arenaTrack = (sim: Sim) => STATE.get(sim)?.tracks.find((t) => t.cfg.kind === 'arena') ?? null;

/** Поезд сбил короля: тяжёлый урон, оглушение, открыт. */
function bossTrainHit(sim: Sim, api: SimApi, m: Mob): void {
  const dmg = m.maxHp * KING.trainDmg;
  m.hp = Math.max(m.maxHp * 0.01, m.hp - dmg);
  m.flash = 0.25;
  m.tele = null;
  m.danger = 0;
  sim.events.push({
    t: 'hit',
    x: m.x,
    y: m.y,
    dmg: Math.round(dmg),
    crit: true,
    kill: false,
    boss: true,
  });
  sim.events.push({ t: 'shake', k: 0.9 });
  sim.events.push({ t: 'flash', color: '#fff0c0', k: 0.6 });
  sim.events.push({
    t: 'boss',
    what: 'f12_train_wall',
    text: 'ПОД ПОЕЗД!',
    sub: 'король оглушён — бей',
  });
  api.setMode(m, 'f12_trainhit');
  // Сбит с путей — отлетает вбок.
  const t = arenaTrack(sim);
  const cy = t ? t.y + 1 : m.y;
  m.ky += m.y < cy ? -26 : 26;
  vfx(sim, api, {
    x: m.x,
    y: m.y,
    r: 1,
    life: 1.5,
    art: 'f12v_train',
    above: true,
    vFrom: m.id,
    vDir: m.y < cy ? -1 : 1,
  }); // v2.87 — только рисунок
  void api;
}

/** Прямоугольник арены и помост. */
function arenaBox(sim: Sim, b: BossFight): [number, number, number, number] {
  const w = sim.world;
  let x0 = 1e9;
  let x1 = -1;
  let y0 = 1e9;
  let y1 = -1;
  for (const i of b.cells) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

function daisOf(sim: Sim, b: BossFight): [number, number] {
  const w = sim.world;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const i of b.cells)
    if (w.mark[i] === MK.dais) {
      sx += (i % w.w) + 0.5;
      sy += Math.floor(i / w.w) + 0.5;
      n++;
    }
  return n ? [sx / n, sy / n] : [b.obj.x + 0.5, b.obj.y + 0.5];
}

/** Разрезы «Рассечения»: три параллельные линии к герою. */
function kingCuts(sim: Sim, api: SimApi, m: Mob, n = 3, warn = KING.cutAim): void {
  const h = sim.hero;
  const a = Math.atan2(h.y - m.y, h.x - m.x);
  const px = -Math.sin(a);
  const py = Math.cos(a);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * KING.cutGap;
    const sx = m.x + px * off - Math.cos(a) * 1.5;
    const sy = m.y + py * off - Math.sin(a) * 1.5;
    const s: StrikeIn = {
      shape: 'line',
      x: sx,
      y: sy,
      r: KING.cutLen,
      w: KING.cutW,
      ang: a,
      warn: (warn + i * 0.07) / hasteOf(sim),
      dmg: m.dmg * 0.9,
      knock: 4,
      art: 'f12_cut',
      from: m.id,
      above: true,
    };
    api.strike(sim, s);
  }
}

/** «Расщепление»: крест под героем и конус вплотную. */
function kingCleave(sim: Sim, api: SimApi, m: Mob): void {
  const h = sim.hero;
  const base = sim.rng() * Math.PI;
  for (const a of [base, base + Math.PI / 2]) {
    api.strike(sim, {
      shape: 'line',
      x: h.x - (Math.cos(a) * KING.cleaveLen) / 2,
      y: h.y - (Math.sin(a) * KING.cleaveLen) / 2,
      r: KING.cleaveLen,
      w: 0.42,
      ang: a,
      warn: KING.cleaveWarn / hasteOf(sim),
      dmg: m.dmg,
      knock: 4,
      art: 'f12_cut',
      from: m.id,
      above: true,
    });
  }
}

/** «Огненная стрела»: линия через всю арену и горящий след. */
function kingArrow(sim: Sim, api: SimApi, m: Mob, a: number): void {
  const ks = kingState(sim);
  const [x0, y0, x1, y1] = ks.box;
  const L = hypot(x1 - x0, y1 - y0) + 2;
  api.strike(sim, {
    shape: 'line',
    x: m.x,
    y: m.y,
    r: L,
    w: KING.bowW,
    ang: a,
    warn: 0.05,
    dmg: m.dmg * 1.3,
    knock: 7,
    status: 'burn',
    dur: 2.2,
    art: 'f12_arrow',
    from: m.id,
    above: true,
  });
  // Горящий след — по линии, пока в арене.
  for (let d = 1.6; d < L; d += 1.3) {
    const x = m.x + Math.cos(a) * d;
    const y = m.y + Math.sin(a) * d;
    if (x < x0 || x > x1 + 1 || y < y0 || y > y1 + 1) break;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    api.zone(sim, {
      x,
      y,
      r: 0.75,
      life: 4.5,
      dps: 0.045,
      status: 'burn',
      dur: 0.8,
      warn: 0.15,
      art: 'f12_fire',
      above: true,
    });
  }
  sim.events.push({ t: 'flash', color: '#ff8a20', k: 0.35 });
}

/** Столбы пламени у героя. */
function kingPyre(sim: Sim, api: SimApi, m: Mob, n = 3): void {
  const h = sim.hero;
  for (let i = 0; i < n; i++) {
    const a = sim.rng() * TAU;
    const r = i === 0 ? 0 : 1.6 + sim.rng() * 1.8;
    const x = h.x + Math.cos(a) * r;
    const y = h.y + Math.sin(a) * r;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    api.strike(sim, {
      shape: 'circle',
      x,
      y,
      r: 1.15,
      warn: KING.pyreWarn / hasteOf(sim) + i * 0.12,
      dmg: m.dmg * 0.95,
      knock: 3,
      status: 'burn',
      dur: 1.5,
      art: 'f12_pyre',
      from: m.id,
      above: true,
    });
  }
}

/** Храм: клетки арены по удалённости от помоста — перепись волной. */
function buildWave(sim: Sim, b: BossFight, dais: [number, number]): number[][] {
  const w = sim.world;
  const rings: number[][] = [];
  for (const i of b.cells) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    const d = Math.floor(hypot(x + 0.5 - dais[0], y + 0.5 - dais[1]) / 2.2);
    (rings[d] ??= []).push(i);
  }
  return rings.filter(Boolean);
}

/** Развернуть храм: зал переписывается волной, пути гаснут, три чаши. */
function openDomain(sim: Sim, b: BossFight, api: SimApi, m: Mob): void {
  const ks = kingState(sim);
  ks.domainOn = true;
  ks.domainT = sim.time;
  ks.wave = buildWave(sim, b, ks.dais);
  ks.waveAt = sim.time;
  ks.waveBack = false;
  vfx(sim, api, {
    x: ks.dais[0],
    y: ks.dais[1],
    r: ks.wave.length * 2.2 + 2.2,
    life: ks.wave.length * 0.09 + 0.9,
    art: 'f12v_wave',
    above: true,
    vBack: 0,
    vX0: ks.box[0],
    vY0: ks.box[1],
    vX1: ks.box[2] + 1,
    vY1: ks.box[3] + 1,
  }); // v2.87 — только рисунок
  ks.gridAt = sim.time + 2.4;
  ks.gridDone = true;
  const at = arenaTrack(sim);
  if (at) at.off = true;
  // Три чаши: слева, справа и у ворот — пока горят, храм стоит.
  const [x0, y0, x1, y1] = ks.box;
  const spots: [number, number][] = [
    [x0 + 3.5, (y0 + y1) / 2 - 3.5],
    [x1 - 2.5, (y0 + y1) / 2 - 3.5],
    [(x0 + x1 + 1) / 2, y1 - 1.5],
  ];
  ks.bowls = spots.map(([x, y]) => {
    const p = api.spawnMob(sim, 'f12_pillar', Math.floor(x) + 0.5, Math.floor(y) + 0.5, {
      mode: 'f12_rise',
    });
    p.data.bowl = 1;
    p.maxHp *= 1.1;
    p.hp = p.maxHp;
    return p.id;
  });
  ks.shrine = keepZone(sim, api, ks.shrine, () => ({
    x: ks.dais[0],
    y: ks.dais[1] - 1.2,
    r: 0.1,
    life: 1e9,
    art: 'f12_shrine',
  }));
  // Храм светится своим красным: иначе в тёмном зале его не видно.
  api.light(sim, 'f12_shrine', { x: ks.dais[0], y: ks.dais[1] - 1.5, r: 7, tint: 'red' });
  api.camera(sim, ks.dais[0], ks.dais[1] + 2, 2.4);
  api.slowmo(sim, 0.9, 0.35);
  sim.events.push({ t: 'flash', color: '#c01030', k: 0.9 });
  sim.events.push({ t: 'shake', k: 0.8 });
  sim.events.push({
    t: 'boss',
    what: 'phase',
    text: 'РАСШИРЕНИЕ ТЕРРИТОРИИ',
    sub: 'ЖЕРТВЕННЫЙ ХРАМ — встань в оберег, разбей три чаши',
  });
  void m;
}

function closeDomain(sim: Sim, api: SimApi, m: Mob, broken: boolean): void {
  const ks = kingState(sim);
  if (!ks.domainOn) return;
  ks.domainOn = false;
  ks.waveBack = true;
  ks.waveAt = sim.time;
  vfx(sim, api, {
    x: ks.dais[0],
    y: ks.dais[1],
    r: ks.wave.length * 2.2 + 2.2,
    life: ks.wave.length * 0.09 + 0.9,
    art: 'f12v_wave',
    above: true,
    vBack: 1,
    vX0: ks.box[0],
    vY0: ks.box[1],
    vX1: ks.box[2] + 1,
    vY1: ks.box[3] + 1,
  }); // v2.87 — только рисунок
  ks.gridCutUntil = 0;
  ks.gridDone = true;
  ks.gridAt = 1e9;
  sim.zones = sim.zones.filter((z) => z !== ks.grid && !ks.wards.some((w) => w.z === z));
  ks.grid = null;
  ks.wards = [];
  for (const mm of sim.mobs)
    if (ks.bowls.includes(mm.id) && mm.mode !== 'dying') {
      mm.hp = 0;
      mm.mode = 'escape';
      mm.t = 0;
    }
  ks.bowls = [];
  sim.events.push({ t: 'flash', color: '#ffffff', k: 0.8 });
  sim.events.push({ t: 'shake', k: 0.9 });
  sim.events.push({
    t: 'boss',
    what: 'phase',
    text: broken ? 'ХРАМ РУХНУЛ' : 'ХРАМ ИССЯК',
    sub: 'король оглушён — бей вдвое',
  });
  api.setMode(m, 'f12_broken');
  m.data.ghost = 0;
}

/** Обереги: 3–4 круга загораются у героя до разреза сеткой. */
function lightWards(sim: Sim, api: SimApi, n: number): void {
  const ks = kingState(sim);
  const h = sim.hero;
  sim.zones = sim.zones.filter((z) => !ks.wards.some((w) => w.z === z));
  ks.wards = [];
  const [x0, y0, x1, y1] = ks.box;
  let tries = 0;
  while (ks.wards.length < n && tries++ < 60) {
    const a = sim.rng() * TAU;
    const r = (ks.wards.length === 0 ? 2.2 : 3) + sim.rng() * 3.6;
    const x = Math.floor(h.x + Math.cos(a) * r) + 0.5;
    const y = Math.floor(h.y + Math.sin(a) * r) + 0.5;
    if (x < x0 + 1 || x > x1 || y < y0 + 1 || y > y1) continue;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    if (ks.wards.some((w) => hypot(w.x - x, w.y - y) < 3)) continue;
    const wd = { x, y, z: null as Zone | null, lit: sim.time };
    api.zone(sim, {
      x,
      y,
      r: KING.wardR,
      life: KING.gridWarn + KING.gridCut + 0.4,
      art: 'f12_ward',
      above: true,
    });
    wd.z = sim.zones[sim.zones.length - 1];
    ks.wards.push(wd);
  }
}

/** Безопасен ли герой от разреза сеткой (в горящем обереге). */
export function inWard(sim: Sim, x: number, y: number): boolean {
  const ks = KSTATE.get(sim);
  if (!ks) return false;
  return ks.wards.some((w) => hypot(w.x - x, w.y - y) < KING.wardR);
}

/** Разрез сеткой по храму: метка, потом «верный» удар мимо оберегов. */
function stepGrid(sim: Sim, api: SimApi, m: Mob, every: number, local = false): void {
  const ks = kingState(sim);
  const h = sim.hero;
  if (ks.gridDone && sim.time >= ks.gridAt) {
    ks.gridDone = false;
    ks.cutHit = false;
    ks.cutOn = false;
    lightWards(sim, api, local ? 2 : 3 + (sim.rng() < 0.4 ? 1 : 0));
    const [x0, y0, x1, y1] = ks.box;
    sim.zones = sim.zones.filter((z) => z !== ks.grid);
    ks.cutAt = sim.time + KING.gridWarn;
    ks.gridCutUntil = ks.cutAt + KING.gridCut;
    const z: ZoneIn & { f12?: GridView } = {
      x: (x0 + x1 + 1) / 2,
      y: (y0 + y1 + 1) / 2,
      r: 0.1,
      life: KING.gridWarn + KING.gridCut + 0.25,
      art: 'f12_grid',
      above: true,
      f12: {
        x0,
        y0,
        x1: x1 + 1,
        y1: y1 + 1,
        off: Math.floor(sim.rng() * KING.gridStep),
        step: KING.gridStep,
        at: ks.cutAt,
        cut: KING.gridCut,
      },
    };
    api.zone(sim, z);
    ks.grid = sim.zones[sim.zones.length - 1];
    sim.events.push({ t: 'boss', what: 'f12_grid_call' });
  }
  if (ks.gridDone || sim.time < ks.cutAt) return;
  // Разрез идёт `gridCut` секунд: рывок столько не держит — «верный».
  if (!ks.cutOn) {
    ks.cutOn = true;
    sim.events.push({ t: 'shake', k: 0.35 });
    sim.events.push({ t: 'strike', x: m.x, y: m.y, art: 'f12_gridcut', big: true });
  }
  if (
    !ks.cutHit &&
    !heroDown(sim) &&
    h.inv <= 0 &&
    h.mode !== 'dash' &&
    api.inArena(sim, h.x, h.y) &&
    !inWard(sim, h.x, h.y)
  ) {
    ks.cutHit = true;
    api.hurtEnv(sim, local ? 0.12 : 0.15);
    sim.events.push({ t: 'flash', color: '#ff3040', k: 0.5 });
  }
  if (sim.time >= ks.gridCutUntil) {
    ks.gridDone = true;
    ks.gridAt = sim.time + every - KING.gridWarn;
  }
}

function kingStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const { dx, dy, dist } = c;
  const b = sim.boss;
  const phase = b?.phase ?? 0;
  const haste = hasteOf(sim);
  const ks = kingState(sim);
  m.tele = null;
  m.danger = 0;
  m.data.vNoTele = 1; // v2.87 — только рисунок: прицел лука рисует f12-boss-fx
  m.data.phase = phase;
  m.data.cutCd = (m.data.cutCd ?? 1.5) - dt * haste;
  m.data.bowCd = (m.data.bowCd ?? 4) - dt * haste;
  m.data.pyreCd = (m.data.pyreCd ?? 6) - dt * haste;
  if (heroDown(sim)) {
    m.vx *= 0.85;
    m.vy *= 0.85;
    return;
  }
  const want = Math.atan2(dy, dx);
  const walk = (tx: number, ty: number, k = 1) => {
    const [cx, cy] = api.chaseDir(sim, m, tx, ty);
    api.steer(sim, m, cx, cy, m.speed * haste * k, dt);
  };
  // В последней фазе король видит поезд и уходит с путей (если не бьёт).
  const at = arenaTrack(sim);
  const dodgeTrain = () => {
    if (phase < 3 || !at || at.off) return false;
    if (!(at.view.sig >= 2)) return false;
    if (m.y < at.y - 1.2 || m.y > at.y + 3.2) return false;
    const ty = m.y < at.y + 1 ? at.y - 2.2 : at.y + 4.2;
    walk(m.x, ty, 1.2);
    return true;
  };
  switch (m.mode) {
    case 'f12_intro': {
      m.data.ghost = 1;
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      if (m.t >= KING.intro) {
        m.data.ghost = 0;
        api.setMode(m, 'chase');
      }
      return;
    }
    case 'chase': {
      m.data.ghost = 0;
      if (dodgeTrain()) return;
      if (dist < 2.6 && m.cd <= 0) {
        api.setMode(m, 'f12_cleave');
        m.face = want;
        kingCleave(sim, api, m);
        api.strike(sim, {
          shape: 'cone',
          x: m.x,
          y: m.y,
          r: KING.coneR,
          ang: want,
          arc: KING.coneArc,
          warn: 0.62 / haste,
          dmg: m.dmg,
          knock: 5,
          art: 'f12_claw',
          from: m.id,
          above: true,
        });
        return;
      }
      if (phase >= 1 && m.data.bowCd <= 0 && dist > 3 && dist < 16) {
        api.setMode(m, 'f12_bow');
        m.data.ang = want;
        vfx(sim, api, {
          x: m.x,
          y: m.y,
          r: hypot(ks.box[2] - ks.box[0], ks.box[3] - ks.box[1]) + 2,
          life: KING.bowDraw / haste + 0.1,
          art: 'f12v_bow',
          above: true,
          vFrom: m.id,
          vT: KING.bowDraw / haste,
          vAng: want,
          vW: KING.bowW,
        }); // v2.87 — только рисунок
        return;
      }
      if (phase >= 1 && m.data.pyreCd <= 0 && dist < 10) {
        api.setMode(m, 'f12_pyre');
        kingPyre(sim, api, m, phase >= 3 ? 4 : 3);
        m.data.pyreCd = 7.5;
        return;
      }
      if (m.data.cutCd <= 0 && dist < 9 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
        api.setMode(m, 'f12_cut');
        m.face = want;
        kingCuts(sim, api, m, phase >= 3 ? 5 : 3);
        return;
      }
      m.face = want;
      walk(h.x, h.y, dist < 2 ? 0.4 : 1);
      // v2.87 — только рисунок: шаг короля — пыль и угольки проклятия.
      if ((m.data.vStep = (m.data.vStep ?? 0) - dt) <= 0 && hypot(m.vx, m.vy) > 0.8) {
        m.data.vStep = 0.42;
        m.data.vFoot = 1 - (m.data.vFoot ?? 0);
        vfx(sim, api, {
          x: m.x,
          y: m.y,
          r: 0.4,
          life: 0.9,
          art: 'f12v_step',
          above: true,
          vKind: m.data.vFoot,
          vAng: Math.atan2(m.vy, m.vx),
        });
      } // v2.87 — только рисунок
      return;
    }
    case 'f12_cut':
      // Рука поднята — разрезы летят; потом открыт.
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > KING.cutAim / haste + 0.1) {
        api.setMode(m, 'recover');
        m.data.cutCd = 3.2;
      }
      return;
    case 'f12_cleave':
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t > 0.6 / haste) m.danger = KING.coneR + 0.3;
      if (m.t > KING.cleaveWarn / haste + 0.1) {
        api.setMode(m, 'recover');
        m.cd = 1.6;
      }
      return;
    case 'f12_bow': {
      m.vx *= 0.5;
      m.vy *= 0.5;
      // Тетива: целится, в конце замирает — окно уйти с линии.
      const T = KING.bowDraw / haste;
      if (m.t < T - 0.45) m.data.ang = want;
      m.face = m.data.ang;
      const [x0, y0, x1, y1] = ks.box;
      const L = hypot(x1 - x0, y1 - y0) + 2;
      m.tele = { shape: 'line', r: L, w: KING.bowW, ang: m.data.ang, k: Math.min(1, m.t / T) };
      if (m.t > T - 0.25) m.danger = 3;
      if (m.t >= T) {
        m.tele = null;
        kingArrow(sim, api, m, m.data.ang);
        api.setMode(m, 'recover');
        m.data.bowCd = phase >= 3 ? 6 : 8.5;
      }
      return;
    }
    case 'f12_pyre':
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t > 0.7) api.setMode(m, 'chase');
      return;
    case 'f12_cast': {
      // Идёт к помосту и складывает знак.
      m.data.ghost = 1;
      const d = hypot(m.x - ks.dais[0], m.y - ks.dais[1]);
      if (d > 0.4 && m.t < 1.2) {
        m.x += (ks.dais[0] - m.x) * Math.min(1, dt * 5);
        m.y += (ks.dais[1] - m.y) * Math.min(1, dt * 5);
      }
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      if (m.t >= KING.cast) {
        if (b) openDomain(sim, b, api, m);
        api.setMode(m, 'f12_domain');
      }
      return;
    }
    case 'f12_domain': {
      m.data.ghost = 1;
      m.vx = 0;
      m.vy = 0;
      m.x = ks.dais[0];
      m.y = ks.dais[1];
      m.face = Math.PI / 2;
      stepGrid(sim, api, m, KING.gridEvery);
      // Между сетками — разрезы с помоста.
      if (m.data.cutCd <= 0 && ks.gridDone && sim.time < ks.gridAt - 0.8) {
        kingCuts(sim, api, m, 3, 0.9);
        m.data.cutCd = 4.2;
      }
      const alive = sim.mobs.filter(
        (x) => ks.bowls.includes(x.id) && x.mode !== 'dying' && x.mode !== 'escape',
      );
      if (!alive.length) closeDomain(sim, api, m, true);
      else if (sim.time - ks.domainT > KING.domainMax) closeDomain(sim, api, m, false);
      return;
    }
    case 'f12_broken':
      m.data.ghost = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > KING.broken) api.setMode(m, 'chase');
      return;
    case 'f12_trainhit':
      m.vx *= 0.85;
      m.vy *= 0.85;
      if (m.t > KING.trainStun) api.setMode(m, 'chase');
      return;
    case 'recover':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (dodgeTrain()) return;
      if (m.t > 0.9 / haste) api.setMode(m, 'chase');
      return;
    default:
      api.setMode(m, 'chase');
  }
  // Последняя фаза: храм вспыхивает на миг — сетка с двумя оберегами.
  void ks;
}

registerBrain('f12boss', {
  raw: true,
  step(sim, m, dt, c, api) {
    kingStep(sim, m, dt, c, api);
  },
  onHit(sim, m, hit) {
    if ((m.data.ghost ?? 0) > 0) return 0;
    if (m.mode === 'f12_broken') return 2;
    if (m.mode === 'f12_trainhit') return 1.6;
    // Натягивает тетиву — спина открыта.
    if (m.mode === 'f12_bow') {
      const from = hit.ang + Math.PI;
      return Math.abs(angDiff(from, m.face)) > 1.9 ? 1.7 : 1;
    }
    if (m.mode === 'recover' || m.mode === 'f12_cut') return 1.15;
    void sim;
    return 1;
  },
});

registerBoss('f12boss', {
  start(sim, b, lead, api) {
    restoreArena(sim, api);
    const ks = kingState(sim);
    ks.box = arenaBox(sim, b);
    ks.dais = daisOf(sim, b);
    // Король ждёт у храма, на помосте.
    lead.x = ks.dais[0];
    lead.y = ks.dais[1];
    lead.face = Math.PI / 2;
    api.setMode(lead, 'f12_intro');
    lead.data.ghost = 1;
    vfx(sim, api, {
      x: ks.dais[0],
      y: ks.dais[1],
      r: 3,
      life: KING.intro + 1,
      art: 'f12v_intro',
      above: true,
      vFrom: lead.id,
    }); // v2.87 — только рисунок
    // Вход камерой: зал, король встаёт.
    api.camera(sim, ks.dais[0], ks.dais[1] + 1.5, 2.8);
    sim.events.push({ t: 'shake', k: 0.5 });
    sim.events.push({
      t: 'boss',
      what: 'f12_wake_call',
      text: 'ДВУЛИКИЙ КОРОЛЬ ПРОКЛЯТИЙ',
      sub: 'через храм идёт поезд — подставь под него короля',
    });
    const at = arenaTrack(sim);
    if (at) {
      at.off = false;
      at.next = Math.max(at.next, sim.time + 7);
    }
  },
  step(sim, b, dt, api) {
    const lead = kingOf(sim);
    if (!lead) return;
    const ks = kingState(sim);
    const k = lead.hp / lead.maxHp;
    F12_FX.domain = ks.domainOn
      ? Math.min(1, (sim.time - ks.domainT) / 1.2)
      : Math.max(0, F12_FX.domain - dt);
    // Перепись храма волной (и обратно).
    if (ks.wave.length && (ks.domainOn || ks.waveBack)) {
      const n = Math.floor((sim.time - ks.waveAt) / 0.09);
      const rings = ks.waveBack ? [...ks.wave].reverse() : ks.wave;
      for (let i = 0; i < Math.min(n, rings.length); i++) {
        for (const c of rings[i]) {
          if (ks.waveBack) {
            const v = ks.changed.get(c);
            if (v && sim.tiles[c] === T_FLOOR && sim.world.mark[c] === MK.domain)
              api.setTile(sim, c % sim.world.w, Math.floor(c / sim.world.w), v.tile, v.mark);
          } else if (sim.world.mark[c] !== MK.domain) retile(sim, api, c, T_FLOOR, MK.domain);
        }
      }
      if (n >= rings.length && ks.waveBack) {
        ks.waveBack = false;
        ks.wave = [];
        api.light(sim, 'f12_shrine', null);
        sim.zones = sim.zones.filter((z) => z !== ks.shrine);
        ks.shrine = null;
        const at = arenaTrack(sim);
        if (at) {
          at.off = false;
          at.next = sim.time + 6;
        }
      }
    }
    // Фазы по засечкам.
    if (b.phase === 0 && k <= KING.hp[0]) {
      b.phase = 1;
      lead.data.bowCd = 1.2;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ПЛАМЯ',
        sub: 'второе лицо открыло глаза — стрела через весь храм',
      });
      sim.events.push({ t: 'flash', color: '#ff6a10', k: 0.5 });
      vfx(sim, api, {
        x: lead.x,
        y: lead.y,
        r: 3,
        life: 1.3,
        art: 'f12v_phase',
        above: true,
        vFrom: lead.id,
        vKind: 1,
      }); // v2.87 — только рисунок
    }
    if (b.phase === 1 && k <= KING.hp[1] && lead.mode !== 'f12_bow') {
      b.phase = 2;
      api.setMode(lead, 'f12_cast');
      vfx(sim, api, {
        x: ks.dais[0],
        y: ks.dais[1],
        r: 2.4,
        life: KING.cast + 0.35,
        art: 'f12v_cast',
        above: true,
        vFrom: lead.id,
      }); // v2.87 — только рисунок
      sim.strikes = sim.strikes.filter((s) => s.from !== lead.id);
      sim.events.push({
        t: 'boss',
        what: 'f12_cast_call',
        text: 'ЗНАК',
        sub: 'король складывает руки…',
      });
    }
    if (b.phase === 2 && k <= KING.hp[2] && !ks.domainOn && lead.mode !== 'f12_cast') {
      b.phase = 3;
      ks.miniAt = sim.time + 6;
      const at = arenaTrack(sim);
      if (at) at.cfg = { ...at.cfg, period: 9 };
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ВСЁ СРАЗУ',
        sub: 'разрезы, пламя, храм на миг и поезд вдвое чаще',
      });
      vfx(sim, api, {
        x: lead.x,
        y: lead.y,
        r: 3,
        life: 1.3,
        art: 'f12v_phase',
        above: true,
        vFrom: lead.id,
        vKind: 3,
      }); // v2.87 — только рисунок
    }
    // Последняя фаза: храм вспыхивает на миг — сетка с двумя оберегами.
    if (b.phase >= 3 && !ks.domainOn) {
      if (
        sim.time >= ks.miniAt &&
        ks.gridDone &&
        lead.mode !== 'f12_trainhit' &&
        lead.mode !== 'f12_broken'
      ) {
        ks.gridAt = sim.time;
        ks.miniAt = sim.time + 13;
        sayOnce(sim, 'mini', 10, {
          what: 'f12_grid_trap',
          text: 'ХРАМ — НА МИГ',
          sub: 'в оберег!',
        });
      }
      stepGrid(sim, api, lead, 99, true);
    }
  },
  notches: () => KING.hp,
  reset(sim, _b, api) {
    restoreArena(sim, api);
    // Чаши и столбы — прочь.
    sim.mobs = sim.mobs.filter((m) => m.kind !== 'f12_pillar' || !api.inArena(sim, m.x, m.y));
  },
});
