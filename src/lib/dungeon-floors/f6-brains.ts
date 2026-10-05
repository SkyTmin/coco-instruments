// Этаж 6 «Огненный разлом» — ИИ монстров, сценарий Красного змея и
// правила этажа.
//
// Правила этажа (`registerFloor(6)`):
//   • ГЕЙЗЕРНОЕ ПОЛЕ (Пепельные галереи). Жерла лежат рядами; ряд за рядом
//     под полом копится пар (трещина от жерла к жерлу наливается светом
//     0,9 с) и бьёт столбом. Волна идёт с юга на север и обратно: проходи
//     ряд сразу за его ударом. Из жерла изредка выходит огненный дух;
//   • МОСТ РУШИТСЯ ЗА СПИНОЙ (Лавовые озёра). Перешёл середину большого
//     моста — плиты позади трескаются (видно за 0,7 с) и уходят в лаву,
//     догоняя героя. Под ногами плита не падает никогда. Через полминуты
//     после того, как ушёл, лава застывает мостом снова;
//   • ИЗВЕРЖЕНИЕ (Гнездо змея). Встал посреди круглого зала — лава
//     поднимается от краёв кольцами (кольцо светится трещинами 1,4 с,
//     потом заливается), из лавы лезут духи и саламандры, через двадцать
//     секунд лава отступает и застывает, в середине — награда;
//   • ЖИВАЯ РУДА лежит самородком на своих местах; ЧЕРВИ живут в омутах;
//   • ЗАСТЫВАЮЩАЯ ЛАВА (клетки, залитые на ходу и ещё не остывшие) жжёт,
//     как корка.
//
// Честность: всё, что бьёт, видно заранее — линии рывков, круги нырков и
// пике, полосы волны пламени, конусы, кольца подъёма лавы, место падения
// плевка червя. Под ногами героя клетка в лаву не превращается.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, StrikeIn, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Sim } from '../dungeon-sim';
import type { Light } from '../dungeon-world';
import { F6_GALLERY, F6_LAKES, F6_MARK, F6_NEST, HOT_CRUST } from './f6';

// Клетки мира (`Tile` в `dungeon-world.ts`): значения движка сюда не
// импортируются, поэтому номера — здесь, с той же нумерацией.
const T_FLOOR = 2;
const T_DEEP = 11;

const TAU = Math.PI * 2;
const hypot = Math.hypot;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';
const heroOpen = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

const idx = (sim: Sim, x: number, y: number) => Math.floor(y) * sim.world.w + Math.floor(x);
const inb = (sim: Sim, x: number, y: number) =>
  x >= 0 && y >= 0 && x < sim.world.w && y < sim.world.h;

const markAt = (sim: Sim, x: number, y: number): number =>
  inb(sim, x, y) ? sim.world.mark[idx(sim, x, y)] : 0;

/** Лава: «глубина» со знаком лавы (и та, что залило на ходу). */
export const isLava = (sim: Sim, x: number, y: number): boolean => {
  if (!inb(sim, x, y)) return false;
  const i = idx(sim, x, y);
  return sim.tiles[i] === T_DEEP && sim.world.mark[i] === F6_MARK.lava;
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

/** Задевает ли линия (из точки по углу, длина, полуширина) круг героя. */
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

/** Сколько клеток от точки до стены по направлению (центр тела). */
function wallDist(sim: Sim, api: SimApi, x: number, y: number, ang: number, max: number): number {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let d = 0.2; d <= max; d += 0.2)
    if (api.solidTile(sim, Math.floor(x + ux * d), Math.floor(y + uy * d))) return d;
  return max + 1;
}

/** Укус: замах `windup` рисует движок, здесь — удар и отскок. */
function biteStep(
  sim: Sim,
  m: Mob,
  c: BrainCtx,
  api: SimApi,
  status?: { kind: 'burn' | 'slow'; dur: number },
  push = 2.5,
): void {
  const h = sim.hero;
  const def = c.def;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t > def.windup - 0.22) m.danger = def.reach + m.r + h.r + 0.4;
  if (m.t < def.windup) return;
  const reach = def.reach + m.r + h.r + 0.18;
  if (c.dist < reach && heroOpen(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, push, m.kind, status);
  m.vx += Math.cos(m.face) * 3;
  m.vy += Math.sin(m.face) * 3;
  api.setMode(m, 'recover');
  m.data.bcd = def.rest * (0.8 + sim.rng() * 0.4);
}

/**
 * Ближайшая клетка лавы по оценке `score` в квадрате радиуса `r` вокруг
 * точки (меньше — лучше). Центр клетки.
 */
function lavaNear(
  sim: Sim,
  x: number,
  y: number,
  r: number,
  score: (cx: number, cy: number) => number,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bs = Infinity;
  const x0 = Math.floor(x - r);
  const y0 = Math.floor(y - r);
  for (let yy = y0; yy <= y0 + r * 2; yy++)
    for (let xx = x0; xx <= x0 + r * 2; xx++) {
      if (!isLava(sim, xx, yy)) continue;
      const s = score(xx + 0.5, yy + 0.5);
      if (s < bs) {
        bs = s;
        best = [xx + 0.5, yy + 0.5];
      }
    }
  return best;
}

/** Плыть только по лаве: шаг, уводящий на сушу, гасится по оси. */
function swimTo(sim: Sim, m: Mob, tx: number, ty: number, speed: number, dt: number, api: SimApi) {
  const l = hypot(tx - m.x, ty - m.y);
  if (l < 0.12) {
    m.vx *= 0.7;
    m.vy *= 0.7;
    return;
  }
  api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, speed * Math.min(1, l * 1.6), dt);
  const ahead = 0.14 + m.r * 0.8;
  const sx = Math.sign(m.vx) * ahead;
  const sy = Math.sign(m.vy) * ahead;
  if (m.vx && !isLava(sim, m.x + sx, m.y)) m.vx = 0;
  if (m.vy && !isLava(sim, m.x, m.y + sy)) m.vy = 0;
}

/** Вытолкнуло из лавы на берег (толкотня, отброс) — назад в лаву. */
function backToLava(sim: Sim, m: Mob): boolean {
  if (isLava(sim, m.x, m.y)) return false;
  const back = lavaNear(sim, m.x, m.y, 3, (cx, cy) => hypot(cx - m.x, cy - m.y));
  if (!back) return false;
  const l = hypot(back[0] - m.x, back[1] - m.y) || 1;
  m.vx = ((back[0] - m.x) / l) * 3;
  m.vy = ((back[1] - m.y) / l) * 3;
  return true;
}

const say = (sim: Sim, what: string, text: string, sub?: string) =>
  sim.events.push({ t: 'boss', what, text, sub });

/** Удар по площади — короче: общий вид и урон в долях урона моба. */
function strikeAt(sim: Sim, api: SimApi, s: StrikeIn): void {
  api.strike(sim, s);
}

// ---------------------------------------------------------------------------
// Состояние этажа: озёра, жерла, мост, зал извержения, руда, свет.
// ---------------------------------------------------------------------------

interface Lake {
  id: number;
  cells: number[];
  cx: number;
  cy: number;
  area: string;
  /** Когда снова можно пустить червя (время симуляции). */
  ready: number;
}

interface VentRow {
  y: number;
  x0: number;
  x1: number;
  vents: number[];
}

interface Field {
  rows: VentRow[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Часы волны и её номер: чётная — с юга, нечётная — с севера. */
  t: number;
  wave: number;
  on: boolean;
  said: boolean;
  spirits: number;
}

interface Bridge {
  /** Плиты по рядам с юга на север: клетки ряда. */
  rows: number[][];
  ys: number[];
  /** Ряд середины: перешёл его к северу — пошло. */
  mid: number;
  state: 'idle' | 'fall' | 'gone';
  /** Следующий ряд, который треснет, и когда. */
  next: number;
  nextAt: number;
  /** Треснувшие ряды: когда упадут. */
  cracked: Map<number, number>;
  /** Герой был на южной половине — значит, идёт на север. */
  armed: boolean;
  goneAt: number;
  cx: number;
  cy: number;
}

interface Eruption {
  rings: number[][];
  cx: number;
  cy: number;
  state: 'idle' | 'rise' | 'hold' | 'fall';
  t: number;
  stage: number;
  /** Клетки, которые ждут, пока с них сойдёт герой. */
  pending: number[];
  ready: number;
  paid: boolean;
  spawned: number;
  /** Когда залить начатое кольцо и когда выпустить подмогу. */
  floodAt: number;
  spawnAt: number;
}

interface OreSpot {
  x: number;
  y: number;
  ready: number;
  v: number;
}

/** Клетка, сменённая на ходу: что было, чтобы вернуть. */
interface Retile {
  i: number;
  tile: number;
  mark: number;
}

interface F6State {
  lakeOf: Int16Array;
  lakes: Lake[];
  field: Field | null;
  bridge: Bridge | null;
  erupt: Eruption | null;
  ores: OreSpot[];
  /** Застывающая лава: клетка → до какого времени жжёт. */
  hot: Map<number, number>;
  /** Сменённое сценарием босса — вернуть при сбросе. */
  arena: Retile[];
  lights0: Light[];
  /** Часы проверки омутов (черви). */
  worm: number;
}

const STATE = new WeakMap<Sim, F6State>();

function scan(sim: Sim): F6State {
  const w = sim.world;
  const W = w.w;
  const lakeOf = new Int16Array(W * w.h);
  const lakes: Lake[] = [];
  // Озёра — связные куски лавы.
  for (let i = 0; i < W * w.h; i++) {
    if (lakeOf[i] || w.tiles[i] !== T_DEEP || w.mark[i] !== F6_MARK.lava) continue;
    const id = lakes.length + 1;
    const cells: number[] = [];
    const q = [i];
    lakeOf[i] = id;
    while (q.length) {
      const j = q.pop()!;
      cells.push(j);
      for (const d of [1, -1, W, -W]) {
        const k = j + d;
        if (k < 0 || k >= W * w.h || lakeOf[k]) continue;
        if (w.tiles[k] !== T_DEEP || w.mark[k] !== F6_MARK.lava) continue;
        lakeOf[k] = id;
        q.push(k);
      }
    }
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      sx += c % W;
      sy += Math.floor(c / W);
    }
    lakes.push({
      id,
      cells,
      cx: sx / cells.length + 0.5,
      cy: sy / cells.length + 0.5,
      area: w.rowArea[Math.floor(cells[0] / W)],
      ready: 0,
    });
  }

  // Жерла гейзерного поля: ряды.
  const byRow = new Map<number, number[]>();
  const ores: OreSpot[] = [];
  const bridgeCells: number[] = [];
  const rings: number[][] = [[], [], []];
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = w.mark[i];
      if (k === F6_MARK.vent) {
        const r = byRow.get(y) ?? [];
        r.push(i);
        byRow.set(y, r);
      } else if (k === F6_MARK.orespot)
        ores.push({ x: x + 0.5, y: y + 0.5, ready: 0, v: (x * 7 + y * 3) % 2 ? 11 : 10 });
      else if (k === F6_MARK.bridge && w.rowArea[y] === F6_LAKES) bridgeCells.push(i);
      else if (k === F6_MARK.rim1) rings[0].push(i);
      else if (k === F6_MARK.rim2) rings[1].push(i);
      else if (k === F6_MARK.rim3) rings[2].push(i);
    }
  let field: Field | null = null;
  if (byRow.size) {
    const rows: VentRow[] = [];
    let x0 = W;
    let x1 = 0;
    for (const [y, vs] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
      const xs = vs.map((i) => i % W);
      // Ряд — от стены до стены поля: трещина пара тянется через весь зал.
      let a = Math.min(...xs);
      let b = Math.max(...xs);
      while (a > 0 && w.tiles[y * W + a - 1] !== 1) a--;
      while (b < W - 1 && w.tiles[y * W + b + 1] !== 1) b++;
      x0 = Math.min(x0, a);
      x1 = Math.max(x1, b);
      rows.push({ y, x0: a, x1: b, vents: vs });
    }
    field = {
      rows,
      x0,
      x1,
      y0: rows[0].y,
      y1: rows[rows.length - 1].y,
      t: 0,
      wave: 0,
      on: false,
      said: false,
      spirits: 0,
    };
  }

  // Мост: плиты над лавой (хоть один сосед — лава), по рядам.
  let bridge: Bridge | null = null;
  const over = bridgeCells.filter((i) =>
    [1, -1, W, -W].some((d) => w.tiles[i + d] === T_DEEP && w.mark[i + d] === F6_MARK.lava),
  );
  // Главный мост — два самых населённых столбца (ветка к островку — нет).
  const cols = new Map<number, number>();
  for (const i of over) cols.set(i % W, (cols.get(i % W) ?? 0) + 1);
  const main = [...cols.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map((e) => e[0]);
  const mainCells = over.filter((i) => main.includes(i % W));
  if (mainCells.length) {
    const ys = [...new Set(mainCells.map((i) => Math.floor(i / W)))].sort((a, b) => b - a);
    const rows = ys.map((y) => mainCells.filter((i) => Math.floor(i / W) === y));
    const cx = main.reduce((s, x) => s + x, 0) / main.length + 0.5;
    bridge = {
      rows,
      ys,
      mid: ys[Math.floor(ys.length / 2)],
      state: 'idle',
      next: 0,
      nextAt: 0,
      cracked: new Map(),
      armed: false,
      goneAt: 0,
      cx,
      cy: (ys[0] + ys[ys.length - 1]) / 2 + 0.5,
    };
  }

  let erupt: Eruption | null = null;
  if (rings[2].length) {
    let sx = 0;
    let sy = 0;
    for (const i of rings[2]) {
      sx += i % W;
      sy += Math.floor(i / W);
    }
    erupt = {
      rings,
      cx: sx / rings[2].length + 0.5,
      cy: sy / rings[2].length + 0.5,
      state: 'idle',
      t: 0,
      stage: 0,
      pending: [],
      ready: 0,
      paid: false,
      spawned: 0,
      floodAt: 0,
      spawnAt: -1,
    };
  }

  return {
    lakeOf,
    lakes,
    field,
    bridge,
    erupt,
    ores,
    hot: new Map(),
    arena: [],
    lights0: w.lights,
    worm: 0,
  };
}

function stateOf(sim: Sim): F6State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

/** Для тестов и рисунка. */
export const f6State = (sim: Sim) => stateOf(sim);

/**
 * Сменить клетку и запомнить, что было (чтобы вернуть). Под героем клетку в
 * лаву не превращаем: она ждёт, пока он сойдёт, а пока жжёт.
 */
/** Кому лава — дом: пловцы и летуны. */
const LAVA_OK = new Set(['f6_salamander', 'f6_worm', 'f6_wisp', 'f6_ashbat']);

function retile(
  sim: Sim,
  api: SimApi,
  i: number,
  tile: number,
  mark: number,
  log: Retile[] | null,
): boolean {
  const W = sim.world.w;
  const x = i % W;
  const y = Math.floor(i / W);
  if (tile === T_DEEP) {
    const h = sim.hero;
    if (
      !heroDown(sim) &&
      Math.abs(h.x - x - 0.5) < 0.5 + h.r &&
      Math.abs(h.y - y - 0.5) < 0.5 + h.r
    )
      return false;
    // Под ходячим монстром тоже не заливаем: залитый по пояс, он терял
    // опору и проходил сквозь стены (столкновение изнутри стены не держит).
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || LAVA_OK.has(m.kind)) continue;
      if (Math.abs(m.x - x - 0.5) < 0.5 + m.r && Math.abs(m.y - y - 0.5) < 0.5 + m.r) return false;
    }
  }
  if (log && !log.some((r) => r.i === i))
    log.push({ i, tile: sim.tiles[i], mark: sim.world.mark[i] });
  api.setTile(sim, x, y, tile, mark);
  return true;
}

/** Залить клетку лавой: свет — у каждой четвёртой (свет не бесплатный). */
function flood(sim: Sim, api: SimApi, i: number, log: Retile[] | null): boolean {
  if (!retile(sim, api, i, T_DEEP, F6_MARK.lava, log)) {
    // Под героем (или ходячим монстром) — пока корка: жжёт, пусть уходит.
    const st = stateOf(sim);
    st.hot.set(i, sim.time + 1.5);
    if (sim.world.mark[i] !== F6_MARK.hotcrust) {
      if (log && !log.some((r) => r.i === i))
        log.push({ i, tile: sim.tiles[i], mark: sim.world.mark[i] });
      api.setTile(sim, i % sim.world.w, Math.floor(i / sim.world.w), T_FLOOR, F6_MARK.hotcrust);
    }
    return false;
  }
  const W = sim.world.w;
  if ((i % W) % 3 === 0 && Math.floor(i / W) % 3 === 0) {
    sim.world.lights = [
      ...sim.world.lights,
      { x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, r: 3, tint: 'red' },
    ];
  }
  return true;
}

/** Вернуть клетки как было (сброс боя) — со светом. */
function restore(sim: Sim, api: SimApi, log: Retile[]): void {
  const W = sim.world.w;
  for (const r of log) api.setTile(sim, r.i % W, Math.floor(r.i / W), r.tile, r.mark);
  log.length = 0;
}

/** Застыть: лава, залитая на ходу, становится остывшим обсидианом. */
function cool(sim: Sim, api: SimApi, log: Retile[]): void {
  const W = sim.world.w;
  for (const r of log) api.setTile(sim, r.i % W, Math.floor(r.i / W), T_FLOOR, F6_MARK.cooled);
  log.length = 0;
}

// ---------------------------------------------------------------------------
// Саламандра: на суше кусает и прыгает; у озера ныряет в лаву и выныривает
// у героя (на полу горит круг, куда выпрыгнет).
// ---------------------------------------------------------------------------

export const SAL = {
  lunge: 3.2,
  lungeSpeed: 9,
  rise: 0.72,
  riseR: 0.95,
  diveCd: 5,
};

registerBrain('f6_salamander', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    m.data.diveCd = (m.data.diveCd ?? 1) - dt;
    const wet = isLava(sim, m.x, m.y);
    // В лаве, но не нырнул (вытолкнуло, прыгнул мимо) — ныряет.
    if (wet && ['chase', 'recover', 'windup', 'aim'].includes(m.mode)) {
      api.setMode(m, 'f6_swim');
      m.data.ghost = 1;
    }
    switch (m.mode) {
      case 'chase': {
        m.data.ghost = 0;
        // Лава рядом, и повод есть (ранена или герой далеко) — нырнуть.
        if (m.data.diveCd <= 0 && (m.hp < m.maxHp * 0.65 || dist > 3.6)) {
          const lv = lavaNear(sim, m.x, m.y, 2, (cx, cy) => hypot(cx - m.x, cy - m.y));
          if (lv && hypot(lv[0] - m.x, lv[1] - m.y) < 1.7) {
            m.data.tx = lv[0];
            m.data.ty = lv[1];
            api.setMode(m, 'f6_slide');
            return;
          }
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist > 1.8 && dist < SAL.lunge + 0.8 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        // Ящерица: бежит рывками и виляет хвостом.
        const z = Math.sin(sim.time * 7 + m.id) * 0.35;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        const gait = 0.75 + 0.45 * Math.max(0, Math.sin(sim.time * 11 + m.id));
        api.steer(sim, m, cx / l, cy / l, m.speed * gait, dt);
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api, { kind: 'burn', dur: 1 });
        return;
      case 'aim': {
        const T = 0.55;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(SAL.lunge, wallDist(sim, api, m.x, m.y, m.dir, SAL.lunge));
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.22) m.danger = SAL.lunge + 0.4;
        if (m.t >= T) {
          m.data.hit = 0;
          m.data.len = len;
          api.setMode(m, 'f6_lunge');
        }
        return;
      }
      case 'f6_lunge': {
        const s = SAL.lungeSpeed;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.8;
        if (!m.data.hit && dist < m.r + h.r + 0.15 && heroOpen(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 5, m.kind, { kind: 'burn', dur: 1.2 });
        }
        if (m.t > (m.data.len ?? SAL.lunge) / s) {
          api.setMode(m, 'recover');
          m.cd = def.rest * 2.2;
        }
        return;
      }
      case 'f6_slide': {
        // Скользит в лаву — ещё видна и бьётся, последние доли — уходит.
        const tx = m.data.tx - m.x;
        const ty = m.data.ty - m.y;
        const l = hypot(tx, ty);
        api.steer(sim, m, tx / (l || 1), ty / (l || 1), m.speed * 1.4, dt);
        if (m.t > 0.25) m.data.ghost = 1;
        if (m.t > 0.4 || l < 0.2) {
          api.setMode(m, 'f6_swim');
          m.data.ghost = 1;
          sim.events.push({ t: 'boss', what: 'f6_dive' });
        }
        return;
      }
      case 'f6_swim': {
        m.data.ghost = 1;
        if (backToLava(sim, m)) return;
        m.data.re = (m.data.re ?? 0) - dt;
        if (m.data.re <= 0) {
          m.data.re = 0.3;
          // Куда плыть: клетка лавы у героя, но не дальше девяти клеток.
          const t = heroDown(sim)
            ? null
            : lavaNear(
                sim,
                m.x,
                m.y,
                7,
                (cx, cy) => hypot(cx - h.x, cy - h.y) + hypot(cx - m.x, cy - m.y) * 0.15,
              );
          m.data.tx = t ? t[0] : m.x;
          m.data.ty = t ? t[1] : m.y;
          m.data.far = t ? hypot(t[0] - h.x, t[1] - h.y) : 99;
        }
        swimTo(sim, m, m.data.tx, m.data.ty, m.speed * 1.15, dt, api);
        const at = hypot(m.data.tx - m.x, m.data.ty - m.y) < 0.9;
        if (!heroDown(sim) && at && m.data.far < 2.4 && m.cd <= 0 && m.t > 0.8) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          api.setMode(m, 'f6_rise');
          return;
        }
        // Героя у лавы нет — выходит на берег к нему и бежит по суше.
        if (m.t > 4 && m.data.far > 5 && !heroDown(sim)) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          m.data.walk = 1;
          api.setMode(m, 'f6_rise');
        }
        return;
      }
      case 'f6_rise': {
        // Выныривает: круг на полу у героя. Первые 0,3 с следует за ним.
        m.vx *= 0.6;
        m.vy *= 0.6;
        const T = SAL.rise;
        if (m.t < 0.3 && !m.data.walk) {
          m.data.gx = h.x;
          m.data.gy = h.y;
        }
        m.data.ghost = m.t < T - 0.12 ? 1 : 0;
        m.face = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
        if (!m.data.walk) {
          m.tele = {
            shape: 'circle',
            r: SAL.riseR,
            k: clamp(m.t / T, 0, 1),
            x: m.data.gx,
            y: m.data.gy,
          };
          const inCircle = hypot(h.x - m.data.gx, h.y - m.data.gy) < SAL.riseR + h.r;
          if (m.t > T - 0.25 && inCircle) m.danger = dist + 0.6;
        }
        if (m.t >= T) {
          api.setMode(m, 'f6_leap');
          m.data.ghost = 0;
          m.data.hit = 0;
          // Прыжок — до края круга, не дальше трёх клеток.
          const a = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
          const d = Math.min(3, hypot(m.data.gx - m.x, m.data.gy - m.y));
          m.dir = a;
          m.data.len = d;
          sim.events.push({ t: 'boss', what: 'f6_splash' });
          api.zone(sim, { x: m.x, y: m.y, r: 0.7, life: 0.5, art: 'f6_splash' });
        }
        return;
      }
      case 'f6_leap': {
        const T = 0.24;
        const s = (m.data.len ?? 1) / T;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = 1.2;
        if (m.t >= T) {
          m.vx *= 0.2;
          m.vy *= 0.2;
          if (
            !m.data.walk &&
            hypot(h.x - m.data.gx, h.y - m.data.gy) < SAL.riseR + h.r &&
            heroOpen(sim)
          )
            api.hurtHero(sim, m.dmg * 1.3, m.x, m.y, 4, m.kind, { kind: 'burn', dur: 1.6 });
          m.data.walk = 0;
          m.data.diveCd = SAL.diveCd;
          m.cd = def.rest * 1.6;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        m.data.ghost = 0;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.8) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Огненный дух: подплывает и раздувается. Не добил за две секунды — взрыв
// кругом (круг на полу наливается); добил — гаснет без вреда.
// ---------------------------------------------------------------------------

export const WISP = { swell: 2.0, r: 1.9, trigger: 2.1 };

function wispBlast(sim: Sim, m: Mob, api: SimApi): void {
  const h = sim.hero;
  if (hypot(h.x - m.x, h.y - m.y) < WISP.r + h.r * 0.5 && heroOpen(sim))
    api.hurtHero(sim, m.dmg * 2.2, m.x, m.y, 7, m.kind, { kind: 'burn', dur: 2 });
  sim.events.push({ t: 'boom', x: m.x, y: m.y, r: WISP.r });
  sim.hitstop = Math.max(sim.hitstop, 0.06);
  api.zone(sim, { x: m.x, y: m.y, r: WISP.r, life: 0.45, art: 'f6_blast' });
  // Земля под взрывом ещё горит.
  api.zone(sim, {
    x: m.x,
    y: m.y,
    r: 1.1,
    life: 2.4,
    dps: 0.015,
    status: 'burn',
    dur: 0.8,
    art: 'f6_firepool',
  });
  // Сам дух сгорел: без добычи и опыта — это не победа героя.
  m.hp = 0;
  m.data.ghost = 1;
  api.setMode(m, 'dying');
}

registerBrain('f6_wisp', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'f6_rise':
        // Поднимается из лавы или жерла: полсекунды недосягаем.
        m.data.ghost = 1;
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t > 0.6) {
          m.data.ghost = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        m.data.ghost = 0;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < WISP.trigger && m.cd <= 0) {
          api.setMode(m, 'f6_swell');
          sim.events.push({ t: 'fuse', x: m.x, y: m.y });
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        // Плывёт волной: огонь не ходит по прямой.
        const z = Math.sin(sim.time * 3.2 + m.id * 1.3) * 0.7;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed, dt);
        return;
      }
      case 'f6_swell': {
        // Раздувается на месте, чуть подтягиваясь к герою.
        const k = clamp(m.t / WISP.swell, 0, 1);
        const l = dist || 1;
        api.steer(sim, m, dx / l, dy / l, dist > 1 ? 0.7 : 0, dt);
        m.tele = { shape: 'circle', r: WISP.r, k };
        if (m.t > WISP.swell - 0.25) m.danger = WISP.r + 0.5;
        if (m.t >= WISP.swell) wispBlast(sim, m, api);
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, mode, api) {
    // Добил раздутого — искры без вреда: видно, что успел.
    if (mode === 'f6_swell') api.zone(sim, { x: m.x, y: m.y, r: 0.9, life: 0.4, art: 'f6_snuff' });
  },
});

// ---------------------------------------------------------------------------
// Лавовый голем: корка из четырёх плит держит удар; каждый удар колет
// плиту (тяжёлый и крит — две). Раскололась — жидкое нутро, урон ×1,5,
// голем злее и оставляет горящие следы. У лавы отмокает и твердеет снова.
// ---------------------------------------------------------------------------

export const GOLEM = {
  plates: 4,
  armor: 0.15,
  molten: 1.5,
  moltenT: 10,
  slamR: 1.45,
  slamWarn: 0.8,
  bathe: 1.4,
};

registerBrain('f6_golem', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    if (m.data.plates === undefined) m.data.plates = GOLEM.plates;
    const molten = m.data.plates <= 0;
    m.data.stepT = (m.data.stepT ?? 0) - dt;
    // Жидкий — оставляет горящие следы.
    if (molten && m.data.stepT <= 0 && hypot(m.vx, m.vy) > 0.4) {
      m.data.stepT = 0.55;
      api.zone(sim, {
        x: m.x,
        y: m.y + 0.2,
        r: 0.45,
        life: 2.2,
        dps: 0.012,
        status: 'burn',
        dur: 0.6,
        art: 'f6_footprint',
      });
    }
    switch (m.mode) {
      case 'chase': {
        // Корка расколота давно — к лаве, отмокать.
        if (molten && sim.time > (m.data.molten ?? 0)) {
          const lv = lavaNear(sim, m.x, m.y, 7, (cx, cy) => hypot(cx - m.x, cy - m.y));
          if (lv) {
            m.data.tx = lv[0];
            m.data.ty = lv[1];
            api.setMode(m, 'f6_bathe');
            return;
          }
          // Лавы нет — корка нарастает сама, но тоньше.
          m.data.plates = 2;
          m.data.harden = 1;
          api.setMode(m, 'f6_harden');
          return;
        }
        if (dist < GOLEM.slamR + 0.9 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          m.face = m.dir;
          const warn = molten ? GOLEM.slamWarn * 0.75 : GOLEM.slamWarn;
          const x = m.x + Math.cos(m.dir) * 0.8;
          const y = m.y + Math.sin(m.dir) * 0.8;
          m.data.sx = x;
          m.data.sy = y;
          m.data.warn = warn;
          strikeAt(sim, api, {
            shape: 'circle',
            x,
            y,
            r: GOLEM.slamR,
            warn,
            dmg: m.dmg * 1.6,
            knock: 7,
            art: 'f6_slam',
            from: m.id,
          });
          api.setMode(m, 'f6_slam');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (molten ? 1.3 : 1), dt);
        return;
      }
      case 'f6_slam': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const warn = m.data.warn ?? GOLEM.slamWarn;
        if (m.t > warn - 0.25) m.danger = GOLEM.slamR + 1;
        if (m.t >= warn && !m.data.done) {
          m.data.done = 1;
          sim.events.push({ t: 'boom', x: m.data.sx, y: m.data.sy, r: 0 });
          if (molten)
            api.zone(sim, {
              x: m.data.sx,
              y: m.data.sy,
              r: 1,
              life: 3,
              dps: 0.02,
              status: 'burn',
              dur: 0.8,
              warn: 0.1,
              art: 'f6_firepool',
            });
        }
        if (m.t >= warn + 1.05) {
          m.data.done = 0;
          m.cd = def.rest;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'f6_bathe': {
        const tx = m.data.tx - m.x;
        const ty = m.data.ty - m.y;
        const l = hypot(tx, ty);
        // Дошёл до берега (лава в шаге) — садится отмокать.
        if (l < 1.3 || m.t > 6) {
          api.setMode(m, 'f6_harden');
          m.data.harden = 0;
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, m.data.tx, m.data.ty);
        api.steer(sim, m, cx, cy, m.speed * 1.1, dt);
        if (dist < GOLEM.slamR + 0.6 && m.cd <= 0) api.setMode(m, 'chase');
        return;
      }
      case 'f6_harden':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t >= GOLEM.bathe) {
          m.data.plates = m.data.harden ? 2 : GOLEM.plates;
          m.data.harden = 0;
          sim.events.push({ t: 'clank', x: m.x, y: m.y });
          api.setMode(m, 'chase');
        }
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit) {
    if (m.data.plates === undefined) m.data.plates = GOLEM.plates;
    if (m.data.plates > 0) {
      m.data.plates -= hit.heavy || hit.crit ? 2 : 1;
      m.data.crackAt = sim.time;
      if (m.data.plates <= 0) {
        m.data.plates = 0;
        m.data.molten = sim.time + GOLEM.moltenT;
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        sim.events.push({ t: 'break', x: m.x, y: m.y, kind: 'crate' });
      }
      return GOLEM.armor;
    }
    return GOLEM.molten;
  },
});

// ---------------------------------------------------------------------------
// Пепельный летун: кружит (над лавой — недосягаем для клинка), пикирует
// линией, оставляет облако пепла (вязнет). После пике садится на камень —
// открыт; над лавой — сразу взлетает.
// ---------------------------------------------------------------------------

export const BAT = { aim: 0.6, len: 5.2, speed: 9.5, perch: 1.1 };

registerBrain('f6_ashbat', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist > 2 && dist < BAT.len - 0.6 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Кружит вокруг героя на трёх с половиной клетках.
        const side = m.id % 2 ? 1 : -1;
        const a0 = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.8;
        const R = dist > 7 ? 0 : 3.4;
        const [cx, cy] = api.chaseDir(sim, m, h.x + Math.cos(a0) * R, h.y + Math.sin(a0) * R);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < BAT.aim * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: BAT.len, w: 0.3, ang: m.dir, k: Math.min(1, m.t / BAT.aim) };
        if (m.t > BAT.aim - 0.22) m.danger = BAT.len;
        if (m.t >= BAT.aim) {
          m.data.hit = 0;
          m.data.ash = 0;
          api.setMode(m, 'f6_swoop');
        }
        return;
      }
      case 'f6_swoop': {
        m.vx = Math.cos(m.dir) * BAT.speed;
        m.vy = Math.sin(m.dir) * BAT.speed;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.8;
        m.data.ash = (m.data.ash ?? 0) - dt;
        if (m.data.ash <= 0 && m.t > 0.05) {
          m.data.ash = 0.11;
          api.zone(sim, {
            x: m.x,
            y: m.y,
            r: 0.6,
            life: 2.2,
            slow: 0.55,
            art: 'f6_ashcloud',
          });
        }
        if (!m.data.hit && dist < m.r + h.r + 0.2 && heroOpen(sim)) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 4, m.kind);
        }
        if (m.t > BAT.len / BAT.speed) {
          m.vx *= 0.2;
          m.vy *= 0.2;
          // Над лавой не сесть — сразу вверх.
          if (isLava(sim, m.x, m.y)) {
            api.setMode(m, 'chase');
            m.cd = 2.2;
          } else api.setMode(m, 'f6_perch');
        }
        return;
      }
      case 'f6_perch':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > BAT.perch) {
          api.setMode(m, 'chase');
          m.cd = 2.2 + sim.rng();
        }
        return;
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 0.5) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Жук-огнёвка: стаей и зигзагом; убитый лопается угольками (не бей в упор).
// ---------------------------------------------------------------------------

registerBrain('f6_beetle', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = dist > 1.2 ? Math.sin(sim.time * 9 + m.id * 2.1) * 0.8 : 0;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * (m.rush ? 1.2 : 1), dt);
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.4) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    api.zone(sim, {
      x: m.x,
      y: m.y,
      r: 0.5,
      life: 1.2,
      dps: 0.012,
      status: 'burn',
      dur: 0.5,
      warn: 0.18,
      art: 'f6_embers',
    });
  },
});

// ---------------------------------------------------------------------------
// Живая руда: лежит самородком, пока не подойдёшь; выпрыгивает с укусом,
// раненая убегает и зарывается снова. Убитая роняет руду этажа.
// ---------------------------------------------------------------------------

export const ORE = { wake: 1.7, jump: 0.5 };

registerBrain('f6_ore', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'f6_hide':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        if (dist < ORE.wake && !heroDown(sim)) {
          api.setMode(m, 'f6_wake');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        }
        return;
      case 'f6_wake': {
        // Самородок встаёт на ноги: кольцо — куда укусит.
        m.data.ghost = m.t < 0.15 ? 1 : 0;
        m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'circle', r: 1.05, k: clamp(m.t / ORE.jump, 0, 1) };
        if (m.t > ORE.jump - 0.22) m.danger = 1.6;
        if (m.t >= ORE.jump) {
          if (dist < 1.05 + h.r && heroOpen(sim)) api.hurtHero(sim, m.dmg, m.x, m.y, 3, m.kind);
          m.data.bcd = def.rest;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'chase': {
        m.data.ghost = 0;
        if (m.hp < m.maxHp * 0.35 && !m.data.fled) {
          m.data.fled = 1;
          api.setMode(m, 'f6_flee');
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
      case 'f6_flee': {
        const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        api.steer(sim, m, away[0], away[1], m.speed * 1.35, dt);
        if (m.t > 1.4 && dist > 4.2) api.setMode(m, 'f6_dig');
        if (m.t > 6) api.setMode(m, 'chase');
        return;
      }
      case 'f6_dig':
        // Зарывается: полсекунды ещё видна и бьётся.
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t > 0.6) {
          m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.2);
          m.data.fled = 0;
          api.setMode(m, 'f6_hide');
        }
        return;
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.5) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onDeath(sim, m, _mode, api) {
    const v = m.data.v === 11 ? 11 : 10;
    const n = 1 + Math.floor(sim.rng() * 2) + (m.elite ? 2 : 0);
    for (let i = 0; i < n; i++) api.dropAt(sim, `ore:${v}`, 1, m.x, m.y);
    if (sim.rng() < (m.elite ? 0.4 : 0.06)) api.dropAt(sim, `block:${v}`, 1, m.x, m.y);
  },
});

// ---------------------------------------------------------------------------
// Магмовый червь: живёт в омуте. Всплывает, целится (на полу у героя
// загорается круг) и плюётся лавой навесом — там, где упало, лужа горит.
// Потом висит над лавой — с берега его можно достать.
// ---------------------------------------------------------------------------

export const WORM = { aim: 0.8, linger: 1.4, range: 7.5 };

function wormLake(sim: Sim, m: Mob): Lake | null {
  const st = stateOf(sim);
  return st.lakes[(m.data.lake || 1) - 1] ?? null;
}

registerBrain('f6_worm', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    if (m.mode !== 'dying' && backToLava(sim, m)) return;
    switch (m.mode) {
      case 'chase':
      case 'f6_under': {
        if (m.mode === 'chase') api.setMode(m, 'f6_under');
        m.data.ghost = 1;
        m.data.re = (m.data.re ?? 0) - dt;
        if (m.data.re <= 0) {
          m.data.re = 0.4;
          // Подплыть к краю омута, ближнему к герою.
          const t = lavaNear(
            sim,
            m.x,
            m.y,
            6,
            (cx, cy) => Math.abs(hypot(cx - h.x, cy - h.y) - 4) + hypot(cx - m.x, cy - m.y) * 0.1,
          );
          m.data.tx = t ? t[0] : m.x;
          m.data.ty = t ? t[1] : m.y;
        }
        swimTo(sim, m, m.data.tx, m.data.ty, m.speed, dt, api);
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (!heroDown(sim) && see && dist < WORM.range && m.cd <= 0 && m.t > 1) {
          api.setMode(m, 'f6_surface');
          sim.events.push({ t: 'boss', what: 'f6_splash' });
        }
        return;
      }
      case 'f6_surface':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.data.ghost = m.t < 0.2 ? 1 : 0;
        m.face = Math.atan2(dy, dx);
        if (m.t > 0.45) {
          m.data.shots = m.hp < m.maxHp * 0.5 ? 2 : 1;
          api.setMode(m, 'aim');
        }
        return;
      case 'aim': {
        m.data.ghost = 0;
        m.vx *= 0.6;
        m.vy *= 0.6;
        // Прицел ведёт героя и замирает — видно, куда упадёт.
        if (m.t < WORM.aim * 0.6) {
          m.data.gx = h.x;
          m.data.gy = h.y;
        }
        m.face = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
        m.tele = {
          shape: 'circle',
          r: 0.8,
          k: clamp(m.t / WORM.aim, 0, 1),
          x: m.data.gx,
          y: m.data.gy,
        };
        if (dist < def.reach + m.r + h.r) {
          api.setMode(m, 'windup');
          return;
        }
        if (m.t >= WORM.aim) {
          const tx = m.data.gx;
          const ty = m.data.gy;
          const ang = Math.atan2(ty - m.y, tx - m.x);
          const sp = def.shot!;
          const x0 = m.x + Math.cos(ang) * (m.r + 0.1);
          const y0 = m.y + Math.sin(ang) * (m.r + 0.1);
          const T = Math.max(0.35, hypot(tx - x0, ty - y0) / sp.speed);
          api.shoot(sim, m, ang, sp, tx, ty);
          // Лужа ложится ровно тогда, когда долетел плевок.
          api.zone(sim, {
            x: tx,
            y: ty,
            r: 0.85,
            life: 3.2,
            dps: 0.02,
            status: 'burn',
            dur: 0.8,
            warn: T,
            art: 'f6_lavapool',
          });
          m.data.shots -= 1;
          if (m.data.shots > 0) {
            api.setMode(m, 'aim');
            m.t = WORM.aim * 0.35;
          } else api.setMode(m, 'f6_linger');
        }
        return;
      }
      case 'f6_linger':
        m.data.ghost = 0;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (dist < def.reach + m.r + h.r && m.cd <= 0) {
          api.setMode(m, 'windup');
          return;
        }
        if (m.t > WORM.linger) {
          api.setMode(m, 'f6_sink');
        }
        return;
      case 'f6_sink':
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.data.ghost = m.t > 0.2 ? 1 : 0;
        if (m.t > 0.4) {
          api.setMode(m, 'f6_under');
          m.cd = 2.4 + sim.rng() * 1.2;
        }
        return;
      case 'windup':
        m.data.ghost = 0;
        biteStep(sim, m, c, api, { kind: 'burn', dur: 1 });
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.5) api.setMode(m, 'f6_sink');
        return;
      default:
        api.setMode(m, 'f6_under');
    }
  },
  onDeath(sim, m) {
    const l = wormLake(sim, m);
    if (l) l.ready = sim.time + 70;
  },
});

// ---------------------------------------------------------------------------
// Бесёнок-старьёвщик: удирает с мешком, бросает за спину петарды (круг на
// полу горит 0,7 с). Через полминуты ныряет в нору — не догнал, ушёл.
// ---------------------------------------------------------------------------

registerBrain('f6_imp', {
  step(sim, m, dt, c, api) {
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    if (m.mode !== 'flee') {
      api.setMode(m, 'flee');
      return;
    }
    const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
    api.steer(sim, m, away[0], away[1], m.speed, dt);
    m.data.bang = (m.data.bang ?? 1.2) - dt;
    if (m.data.bang <= 0 && dist < 7) {
      m.data.bang = 1.6 + sim.rng() * 0.6;
      strikeAt(sim, api, {
        shape: 'circle',
        x: m.x,
        y: m.y,
        r: 0.85,
        warn: 0.75,
        dmg: m.dmg,
        knock: 4,
        status: 'burn',
        dur: 0.8,
        art: 'f6_cracker',
      });
    }
    if (m.t > 18 && dist > 6) {
      api.setMode(m, 'escape');
      m.hp = 0;
    }
  },
});

// ---------------------------------------------------------------------------
// Красный змей. Ведёт все режимы сам (босс).
//   chase    — ползёт к герою волной; решает, чем бить;
//   f6_bite  — бросок головой по линии (метка 0,55 с);
//   f6_tail  — хвост вкруговую (круг 0,75 с);
//   f6_wave  — встаёт на дыбы, ВОЛНА ПЛАМЕНИ: полосы через всю арену с
//              просветами, фронт идёт от змея — стой в просвете;
//   f6_sweep — (с фазы 3) пламя веером: сектор за сектором, за спиной у
//              змея — безопасно;
//   f6_takeoff → f6_fly → f6_mark → f6_dive — (с фазы 2) взлёт: недосягаем,
//              сверху сыплет угли; круг на полу ходит за героем, замирает —
//              пике; от удара — горящие лужи; головой в камень — dizzy;
//   f6_summon — (с фазы 3) из лавы поднимаются духи;
//   f6_quake  — (фаза 4) арена трескается, края уходят в лаву;
//   dizzy, recover, roar.
// ---------------------------------------------------------------------------

export const SERP = {
  biteLen: 2.6,
  biteWarn: 0.6,
  tailR: 2.4,
  tailWarn: 0.8,
  waveWarn: 1.05,
  waveStep: 0.22,
  waveGap: 2.5,
  waveW: 0.62,
  waveN: 6,
  flyT: 2.8,
  markFollow: 1.1,
  markLock: 0.55,
  diveR: 1.9,
  stuck: 2.1,
  sweepR: 7,
  sweepArc: 0.55,
  sweepN: 6,
};

/** Где стоит арена: логово и её клетки. */
function arenaOf(sim: Sim): { x: number; y: number } {
  const o = sim.boss?.obj;
  return o ? { x: o.x + 0.5, y: o.y + 1.5 } : { x: sim.hero.x, y: sim.hero.y };
}

const hasteOf = (sim: Sim) => {
  const p = sim.boss?.phase ?? 0;
  return p >= 3 ? 1.25 : p >= 2 ? 1.15 : p >= 1 ? 1.05 : 1;
};

// v2.86 — только рисунок: зона-картинка техник змея (`api.vfx`: без урона и
// статусов, номер не из общего счётчика); `cap` — потолок таких зон разом.
function fx6(
  sim: Sim,
  api: SimApi,
  art: string,
  x: number,
  y: number,
  life: number,
  o: Record<string, unknown> = {},
  cap = 40,
): void {
  let n = 0;
  for (const z of sim.zones) if (z.art?.startsWith('f6_fx')) n++;
  if (n < cap) api.vfx(sim, { x, y, r: 0.5, life, art, ...o } as ZoneIn);
}

/** Хвост змея — точки пути головы (для рисунка тела). */
const TRAILS = new WeakMap<Mob, number[]>();
export const serpentTrail = (m: Mob): readonly number[] => TRAILS.get(m) ?? [];

/** Змей по номеру — рисовальщику тела (зона `f6_body` знает только номер). */
const SERPENTS = new Map<number, Mob>();

export interface SerpentView {
  trail: readonly number[];
  mode: string;
  t: number;
  x: number;
  y: number;
  face: number;
  hp: number;
}

export function serpentView(id: number): SerpentView | null {
  const m = SERPENTS.get(id);
  if (!m) return null;
  return {
    trail: TRAILS.get(m) ?? [],
    mode: m.mode,
    t: m.t,
    x: m.x,
    y: m.y,
    face: m.face,
    hp: m.hp / m.maxHp,
  };
}

function recordTrail(m: Mob): void {
  let t = TRAILS.get(m);
  if (!t) {
    t = [];
    // Тело сначала лежит за головой — к северной стене логова.
    for (let i = 1; i <= 24; i++) t.push(m.x + Math.sin(i * 0.5) * 0.25, m.y - 0.17 * i);
    TRAILS.set(m, t);
  }
  const lx = t[0];
  const ly = t[1];
  if (hypot(m.x - lx, m.y - ly) > 0.16) {
    t.unshift(m.x, m.y);
    if (t.length > 60) t.length = 60;
  }
}

/** Где полоса упирается в стены: от точки в обе стороны поперёк. */
function bandSpan(
  sim: Sim,
  api: SimApi,
  cx: number,
  cy: number,
  px: number,
  py: number,
  max: number,
): [number, number] {
  const wall = (x: number, y: number) =>
    api.solidTile(sim, Math.floor(x), Math.floor(y)) && !isLava(sim, x, y);
  let a = 0;
  let b = 0;
  while (a < max && !wall(cx - px * (a + 0.5), cy - py * (a + 0.5))) a += 0.5;
  while (b < max && !wall(cx + px * (b + 0.5), cy + py * (b + 0.5))) b += 0.5;
  return [a, b];
}

/** Волна пламени: полосы поперёк направления, с просветами. */
function fireWave(sim: Sim, m: Mob, api: SimApi, ang: number, delay: number): void {
  const haste = hasteOf(sim);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const px = -uy;
  const py = ux;
  for (let k = 0; k < SERP.waveN; k++) {
    const d = 1.8 + k * SERP.waveGap;
    const cx = m.x + ux * d;
    const cy = m.y + uy * d;
    // Полоса — от стены до стены арены, не дальше.
    const [a, b] = bandSpan(sim, api, cx, cy, px, py, 16);
    if (a + b < 0.6) continue;
    const warn = (SERP.waveWarn + k * SERP.waveStep) / haste + delay;
    const s: StrikeIn & { band: number } = {
      shape: 'line',
      x: cx - px * a,
      y: cy - py * a,
      r: a + b,
      w: SERP.waveW,
      ang: Math.atan2(py, px),
      warn,
      dmg: m.dmg * 1.3,
      knock: 3,
      status: 'burn',
      dur: 1.4,
      art: 'f6_wave',
      from: m.id,
      band: k,
    };
    api.strike(sim, s);
    // Стена огня в миг удара — картинка на полсекунды.
    const z: ZoneIn & { ang: number; len: number } = {
      x: cx + (px * (b - a)) / 2,
      y: cy + (py * (b - a)) / 2,
      r: 0.1,
      warn,
      life: 0.45,
      art: 'f6_waveflame',
      ang: Math.atan2(py, px),
      len: a + b,
    };
    api.zone(sim, z);
  }
}

/** Пламя веером: сектор за сектором от одного края к другому. */
function fireSweep(sim: Sim, m: Mob, api: SimApi, ang: number, dir: number): void {
  const haste = hasteOf(sim);
  const n = SERP.sweepN;
  const span = SERP.sweepArc * n;
  for (let k = 0; k < n; k++) {
    const a = ang - (dir * span) / 2 + dir * (k + 0.5) * SERP.sweepArc;
    const s: StrikeIn = {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: SERP.sweepR,
      ang: a,
      arc: SERP.sweepArc + 0.04,
      warn: (1 + k * 0.2) / haste,
      dmg: m.dmg * 1.3,
      knock: 3,
      status: 'burn',
      dur: 1.4,
      art: 'f6_sweep',
      from: m.id,
    };
    api.strike(sim, s);
  }
}

/** Угли с неба: мелкий круг у героя. */
function ember(sim: Sim, m: Mob, api: SimApi): void {
  const h = sim.hero;
  const a = sim.rng() * TAU;
  const d = sim.rng() * 2.4;
  const x = h.x + Math.cos(a) * d;
  const y = h.y + Math.sin(a) * d;
  if (api.solidTile(sim, Math.floor(x), Math.floor(y)) && !isLava(sim, x, y)) return;
  api.strike(sim, {
    shape: 'circle',
    x,
    y,
    r: 0.7,
    warn: 0.85,
    dmg: m.dmg * 0.7,
    knock: 2,
    status: 'burn',
    dur: 0.8,
    art: 'f6_ember',
    from: m.id,
  });
}

/** Огненные лужи вокруг места пике. */
function divePools(sim: Sim, api: SimApi, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + sim.rng() * 0.6;
    const d = 1.2 + sim.rng() * 0.8;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (api.solidTile(sim, Math.floor(px), Math.floor(py))) continue;
    api.zone(sim, {
      x: px,
      y: py,
      r: 0.85,
      life: 5.5,
      dps: 0.03,
      status: 'burn',
      dur: 0.9,
      warn: 0.15,
      art: 'f6_firepool',
    });
  }
}

function startWave(sim: Sim, m: Mob, api: SimApi): void {
  const h = sim.hero;
  m.dir = Math.atan2(h.y - m.y, h.x - m.x);
  m.face = m.dir;
  api.setMode(m, 'f6_wave');
  fx6(sim, api, 'f6_fxinhale', m.x, m.y, SERP.waveWarn / hasteOf(sim), { mob: m.id }); // v2.86 — только рисунок
  const phase = sim.boss?.phase ?? 0;
  fireWave(sim, m, api, m.dir, 0);
  // В разломе — вторая волна поперёк: безопасны только «клетки» сетки.
  if (phase >= 3) fireWave(sim, m, api, m.dir + Math.PI / 2, 0.55);
  sim.events.push({ t: 'boss', what: 'roar' });
}

registerBrain('f6boss', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const haste = hasteOf(sim);
    const phase = sim.boss?.phase ?? 0;
    m.tele = null;
    m.danger = 0;
    m.data.haste = haste;
    // v2.86 — только рисунок: метки рисует этаж; слой огня поверх темноты;
    // смена фазы — жар кольцом и вспышка.
    m.data.vNoTele = 1;
    if (m.mode !== 'f6_mark') m.data.vShadow = 0;
    if (!sim.zones.some((z) => z.art === 'f6_fxsky'))
      api.vfx(sim, { x: m.x, y: m.y, r: 0.1, life: 1e9, art: 'f6_fxsky', above: true });
    if ((m.data.vPh ?? 0) < phase) {
      m.data.vPh = phase;
      fx6(sim, api, 'f6_fxphase', m.x, m.y, 1.8);
      sim.events.push({ t: 'flash', k: 0.3, color: '#ff8a2a' });
    }
    m.data.biteCd = (m.data.biteCd ?? 1) - dt;
    m.data.tailCd = (m.data.tailCd ?? 3) - dt;
    m.data.waveCd = (m.data.waveCd ?? 4) - dt;
    m.data.flyCd = (m.data.flyCd ?? 8) - dt;
    m.data.sweepCd = (m.data.sweepCd ?? 6) - dt;
    m.data.sumCd = (m.data.sumCd ?? 10) - dt;
    recordTrail(m);
    SERPENTS.set(m.id, m);
    if (SERPENTS.size > 8) SERPENTS.delete(SERPENTS.keys().next().value!);
    if (heroDown(sim)) {
      m.vx *= 0.85;
      m.vy *= 0.85;
      m.data.ghost = 0;
      if (m.mode !== 'roar') api.setMode(m, 'roar');
      return;
    }
    const flying = m.mode === 'f6_fly' || m.mode === 'f6_mark' || m.mode === 'f6_dive';
    if (!flying && m.mode !== 'f6_takeoff') m.data.ghost = 0;
    // В небе тело не толкается: на полу — только тень.
    m.r = m.data.ghost ? 0.12 : c.def.radius;
    switch (m.mode) {
      case 'roar':
        m.vx *= 0.8;
        m.vy *= 0.8;
        m.face = Math.atan2(dy, dx);
        if (m.t > 1.4) api.setMode(m, 'chase');
        return;
      case 'chase': {
        // Ползёт волной — змей, а не бык.
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 3.4) * 0.55;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed * haste * (dist < 2 ? 0.35 : 1), dt);
        // v2.86 — только рисунок: брюхо трёт пол — пыль и искры, 5 раз в секунду.
        m.data.vCrawl = (m.data.vCrawl ?? 0) - dt;
        if (m.data.vCrawl <= 0 && hypot(m.vx, m.vy) > 0.8) {
          m.data.vCrawl = 0.2;
          fx6(sim, api, 'f6_fxcrawl', m.x, m.y, 0.8, { ang: Math.atan2(m.vy, m.vx) }, 30);
        }
        if (m.t < 0.5 / haste) return;
        const a = Math.atan2(dy, dx);
        const behind = Math.abs(angDiff(a, m.face)) > 2.1;
        if (phase >= 1 && m.data.flyCd <= 0 && dist > 1.2) {
          api.setMode(m, 'f6_takeoff');
          sim.events.push({ t: 'boss', what: 'roar' });
          fx6(sim, api, 'f6_fxgust', m.x, m.y, 1.3, { mob: m.id }); // v2.86 — только рисунок
          return;
        }
        if (phase >= 2 && m.data.sumCd <= 0) {
          api.setMode(m, 'f6_summon');
          return;
        }
        if (dist < SERP.tailR + 0.5 && behind && m.data.tailCd <= 0) {
          api.setMode(m, 'f6_tail');
          api.strike(sim, {
            shape: 'circle',
            x: m.x,
            y: m.y,
            r: SERP.tailR,
            warn: SERP.tailWarn / haste,
            dmg: m.dmg * 1.4,
            knock: 8,
            art: 'f6_tail',
            from: m.id,
          });
          return;
        }
        if (dist < SERP.biteLen + 0.6 && m.data.biteCd <= 0 && !behind) {
          m.dir = a;
          m.face = a;
          api.setMode(m, 'f6_bite');
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: SERP.biteLen + m.r,
            w: 0.7,
            ang: a,
            warn: SERP.biteWarn / haste,
            dmg: m.dmg * 1.6,
            knock: 6,
            status: 'burn',
            dur: 1,
            art: 'f6_bite',
            from: m.id,
          });
          return;
        }
        if (phase >= 2 && m.data.sweepCd <= 0 && dist < SERP.sweepR - 1 && dist > 1.5) {
          m.dir = a;
          m.face = a;
          m.data.sdir = sim.rng() < 0.5 ? 1 : -1;
          api.setMode(m, 'f6_sweep');
          fireSweep(sim, m, api, a, m.data.sdir);
          fx6(sim, api, 'f6_fxinhale', m.x, m.y, 1 / haste, { mob: m.id }); // v2.86 — только рисунок
          sim.events.push({ t: 'boss', what: 'roar' });
          return;
        }
        if (m.data.waveCd <= 0 && dist > 2.2) {
          startWave(sim, m, api);
          return;
        }
        if (m.t > 4 / haste) startWave(sim, m, api);
        return;
      }
      case 'f6_bite': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const T = SERP.biteWarn / haste;
        if (m.t > T - 0.25) m.danger = SERP.biteLen + 1;
        // Бросок: голова выстреливает, тело за ней.
        if (m.t >= T && m.t < T + 0.18) {
          m.vx = Math.cos(m.dir) * 7;
          m.vy = Math.sin(m.dir) * 7;
        }
        if (m.t >= T + 0.18 + 0.75 / haste) {
          m.data.biteCd = 2.2 / haste;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f6_tail': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const T = SERP.tailWarn / haste;
        if (m.t > T - 0.25) m.danger = SERP.tailR + 0.6;
        if (m.t >= T && !m.data.swung) {
          m.data.swung = 1;
          sim.events.push({ t: 'boss', what: 'whip' });
        }
        if (m.t >= T + 0.7) {
          m.data.swung = 0;
          m.data.tailCd = 4;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f6_wave': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        const T = SERP.waveWarn / haste;
        if (m.t > T - 0.25 && m.t < T + 0.2) m.danger = 3;
        // Пламя изо рта — картинка на всё время волны.
        if (m.t >= T && !m.data.lit) {
          m.data.lit = 1;
          const z: ZoneIn & { ang: number } = {
            x: m.x,
            y: m.y,
            r: 3.2,
            life: 0.8,
            art: 'f6_breath',
            ang: m.dir,
          };
          api.zone(sim, z);
        }
        if (m.t >= T + SERP.waveN * SERP.waveStep + 0.9) {
          m.data.lit = 0;
          m.data.waveCd = (phase >= 3 ? 5.5 : 7) / haste;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f6_sweep': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const T = 1 / haste;
        const k = clamp((m.t - T) / ((SERP.sweepN * 0.2) / haste), 0, 1);
        m.face = m.dir + ((m.data.sdir ?? 1) * (k - 0.5) * SERP.sweepArc * SERP.sweepN) / 1;
        if (m.t >= T && !m.data.lit) {
          m.data.lit = 1;
          const z: ZoneIn & { ang: number; sweep: number } = {
            x: m.x,
            y: m.y,
            r: SERP.sweepR,
            life: (SERP.sweepN * 0.2) / haste + 0.3,
            art: 'f6_breath',
            ang: m.dir,
            sweep: m.data.sdir ?? 1,
          };
          api.zone(sim, z);
        }
        if (m.t >= T + (SERP.sweepN * 0.2) / haste + 0.9) {
          m.data.lit = 0;
          m.data.sweepCd = 9 / haste;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'f6_takeoff': {
        // Бьёт крыльями и поднимается: первые доли секунды ещё открыт.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 0.45) m.data.ghost = 1;
        if (m.t > 0.9) {
          m.data.dives = phase >= 2 ? 2 : 1;
          m.data.ember = 0.3;
          api.setMode(m, 'f6_fly');
        }
        return;
      }
      case 'f6_fly': {
        m.data.ghost = 1;
        // Кружит над ареной, сверху сыплются угли.
        const ar = arenaOf(sim);
        const a = Math.atan2(m.y - ar.y, m.x - ar.x) + 0.9;
        const tx = ar.x + Math.cos(a) * 4.5;
        const ty = ar.y + Math.sin(a) * 3.5;
        const l = hypot(tx - m.x, ty - m.y) || 1;
        api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, 4.6, dt);
        m.data.ember -= dt;
        if (m.data.ember <= 0) {
          m.data.ember = 0.5 / haste;
          ember(sim, m, api);
        }
        if (m.t > SERP.flyT / haste) {
          m.data.gx = h.x;
          m.data.gy = h.y;
          api.setMode(m, 'f6_mark');
        }
        return;
      }
      case 'f6_mark': {
        m.data.ghost = 1;
        const F = SERP.markFollow / haste;
        const L = SERP.markLock;
        // v2.86 — только рисунок: тень змея кружит над героем, пока круг ищет.
        if (!m.data.vShadow) {
          m.data.vShadow = 1;
          fx6(sim, api, 'f6_fxshadow', m.data.gx, m.data.gy, Math.max(0.1, F - m.t + 0.05), {
            mob: m.id,
          });
        }
        // Круг ходит за героем, потом замирает — тень змея над ним.
        if (m.t < F) {
          m.data.gx += (h.x - m.data.gx) * Math.min(1, dt * 6);
          m.data.gy += (h.y - m.data.gy) * Math.min(1, dt * 6);
        } else if (!m.data.locked) {
          m.data.locked = 1;
          api.strike(sim, {
            shape: 'circle',
            x: m.data.gx,
            y: m.data.gy,
            r: SERP.diveR,
            warn: L,
            dmg: m.dmg * 2,
            knock: 9,
            status: 'burn',
            dur: 1.4,
            art: 'f6_dive',
            from: m.id,
          });
        }
        const tl = hypot(m.data.gx - m.x, m.data.gy - m.y) || 1;
        api.steer(sim, m, (m.data.gx - m.x) / tl, (m.data.gy - m.y) / tl, Math.min(6, tl * 3), dt);
        m.tele = {
          shape: 'circle',
          r: SERP.diveR,
          k: clamp(m.t / (F + L), 0, 1),
          x: m.data.gx,
          y: m.data.gy,
        };
        const inCircle = hypot(h.x - m.data.gx, h.y - m.data.gy) < SERP.diveR + h.r;
        if (m.t > F + L - 0.25 && inCircle) m.danger = hypot(h.x - m.x, h.y - m.y) + 1;
        if (m.t >= F + L) {
          m.data.locked = 0;
          api.setMode(m, 'f6_dive');
        }
        return;
      }
      case 'f6_dive': {
        // Падает в точку: удар уже нанесён меткой.
        const T = 0.16;
        const tl = hypot(m.data.gx - m.x, m.data.gy - m.y);
        m.x += (m.data.gx - m.x) * Math.min(1, dt / Math.max(0.01, T - m.t));
        m.y += (m.data.gy - m.y) * Math.min(1, dt / Math.max(0.01, T - m.t));
        m.vx = 0;
        m.vy = 0;
        if (m.t >= T || tl < 0.05) {
          m.data.ghost = 0;
          sim.events.push({ t: 'boss', what: 'f6_wall' });
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: SERP.diveR });
          sim.hitstop = Math.max(sim.hitstop, 0.1);
          divePools(sim, api, m.x, m.y, phase >= 2 ? 4 : 3);
          api.zone(sim, { x: m.x, y: m.y, r: SERP.diveR, life: 0.5, art: 'f6_impact' });
          m.data.dives = (m.data.dives ?? 1) - 1;
          if (m.data.dives > 0) {
            // Второе пике — сразу: снова вверх и снова круг.
            m.data.ghost = 1;
            m.data.gx = h.x;
            m.data.gy = h.y;
            api.setMode(m, 'f6_mark');
            m.t = 0.35;
          } else {
            m.data.flyCd = (phase >= 3 ? 10 : 12) / haste;
            api.setMode(m, 'dizzy');
          }
        }
        return;
      }
      case 'dizzy':
        // Головой в камень: стоит, крылья обвисли — бей (урон ×1,5).
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > SERP.stuck / Math.max(1, haste * 0.95)) api.setMode(m, 'recover');
        return;
      case 'f6_summon': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t >= 0.9 && !m.data.called) {
          m.data.called = 1;
          summonSpirits(sim, api, phase >= 3 ? 3 : 2);
          sim.events.push({ t: 'boss', what: 'summon' });
          fx6(sim, api, 'f6_fxroar', m.x, m.y, 0.9, { mob: m.id }); // v2.86 — только рисунок
        }
        if (m.t >= 1.5) {
          m.data.called = 0;
          m.data.sumCd = 18;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.6 / haste) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

/** Духи поднимаются из лавы арены — там, где лава, в стороне от героя. */
function summonSpirits(sim: Sim, api: SimApi, n: number): void {
  const b = sim.boss;
  if (!b) return;
  const h = sim.hero;
  const W = sim.world.w;
  const live = sim.mobs.filter((m) => m.kind === 'f6_wisp' && m.mode !== 'dying').length;
  const cand: number[] = [];
  const ar = arenaOf(sim);
  for (let y = Math.floor(ar.y - 12); y <= ar.y + 12; y++)
    for (let x = Math.floor(ar.x - 15); x <= ar.x + 15; x++) {
      if (!isLava(sim, x, y)) continue;
      const d = hypot(x + 0.5 - h.x, y + 0.5 - h.y);
      if (d < 3.5 || d > 11) continue;
      // Лава у края арены (сосед — пол арены).
      if (![1, -1, W, -W].some((k) => b.cells.has(y * W + x + k))) continue;
      cand.push(y * W + x);
    }
  for (let k = 0; k < n && cand.length && live + k < 5; k++) {
    const j = Math.floor(sim.rng() * cand.length);
    const i = cand.splice(j, 1)[0];
    const m = api.spawnMob(sim, 'f6_wisp', (i % W) + 0.5, Math.floor(i / W) + 0.5, {
      mode: 'f6_rise',
    });
    m.data.ghost = 1;
    m.cd = 0.6;
    api.zone(sim, { x: m.x, y: m.y, r: 0.7, life: 0.6, art: 'f6_splash' });
  }
}

// ---------------------------------------------------------------------------
// Сценарий боя: фазы по засечкам и арена, которая меняется.
//   0 «Жар»          (100…75%) — укус, хвост, волна пламени;
//   1 «Взлёт»        (75…50%)  — + взлёт, угли с неба, пике с лужами;
//   2 «Огненная буря» (50…25%) — + пламя веером, духи из лавы, омуты арены
//                                выходят из берегов, пике по два;
//   3 «Разлом»       (25…0%)   — арена трескается и кольцами уходит в
//                                лаву, волны крестом, всё быстрее.
// ---------------------------------------------------------------------------

export const NOTCHES = [0.75, 0.5, 0.25];

interface Quake {
  /** Кольца арены по «эллиптической» удалённости: кто зальётся на шаге k. */
  rings: number[][];
  step: number;
  next: number;
  /** Трещины горят — когда зальются. */
  warnAt: number;
  pend: number[];
}

const QUAKES = new WeakMap<BossFight, Quake>();

function arenaRings(sim: Sim, b: BossFight): number[][] {
  const W = sim.world.w;
  const ar = arenaOf(sim);
  // Полуоси — по самой арене (крайние клетки).
  let rx = 1;
  let ry = 1;
  for (const i of b.cells) {
    rx = Math.max(rx, Math.abs((i % W) + 0.5 - ar.x));
    ry = Math.max(ry, Math.abs(Math.floor(i / W) + 0.5 - ar.y));
  }
  const cuts = [0.86, 0.74, 0.63];
  const rings: number[][] = cuts.map(() => []);
  for (const i of b.cells) {
    if (sim.tiles[i] === T_DEEP) continue;
    const e = hypot(((i % W) + 0.5 - ar.x) / rx, (Math.floor(i / W) + 0.5 - ar.y) / ry);
    for (let k = 0; k < cuts.length; k++)
      if (e > cuts[k]) {
        rings[k].push(i);
        break;
      }
  }
  return rings;
}

/** Омуты арены выходят из берегов: пол у лавы — в лаву (с меткой). */
function overflow(sim: Sim, api: SimApi, b: BossFight): void {
  const W = sim.world.w;
  const st = stateOf(sim);
  const cells: number[] = [];
  for (const i of b.cells) {
    if (sim.tiles[i] === T_DEEP) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    if ([1, -1, W, -W].some((k) => isLava(sim, (i + k) % W, Math.floor((i + k) / W)))) {
      // Не у логова: середина арены остаётся полем боя.
      if (hypot(x - b.obj.x, y - b.obj.y) < 5) continue;
      cells.push(i);
    }
  }
  for (const i of cells)
    api.zone(sim, {
      x: (i % W) + 0.5,
      y: Math.floor(i / W) + 0.5,
      r: 0.5,
      life: 0.1,
      warn: 1.4,
      art: 'f6_rise',
    });
  const q = QUAKES.get(b) ?? { rings: [], step: 0, next: 0, warnAt: 0, pend: [] };
  q.pend = cells;
  q.warnAt = sim.time + 1.4;
  QUAKES.set(b, q);
  void st;
}

registerBoss('f6boss', {
  start(sim, b, lead) {
    b.phase = 0;
    lead.data.biteCd = 1.2;
    lead.data.waveCd = 3;
    lead.data.flyCd = 6;
    lead.face = Math.PI / 2;
    TRAILS.delete(lead);
    QUAKES.set(b, { rings: arenaRings(sim, b), step: 0, next: 0, warnAt: 0, pend: [] });
    sim.events.push({
      t: 'boss',
      what: 'phase',
      text: 'КРАСНЫЙ ЗМЕЙ',
      sub: 'жар поднимается из разлома',
    });
  },
  step(sim, b, dt, api) {
    const lead = sim.mobs.find((m) => m.kind === 'f6boss' && m.mode !== 'dying');
    if (!lead) return;
    const st = stateOf(sim);
    const k = lead.hp / lead.maxHp;
    const q = QUAKES.get(b)!;
    if (b.phase === 0 && k < NOTCHES[0]) {
      b.phase = 1;
      lead.data.flyCd = 0.5;
      say(sim, 'phase', 'ВЗЛЁТ', 'в небе не достать — уходи из круга');
    }
    if (b.phase === 1 && k < NOTCHES[1]) {
      b.phase = 2;
      lead.data.sumCd = 1.5;
      lead.data.sweepCd = 4;
      overflow(sim, api, b);
      say(sim, 'phase', 'ОГНЕННАЯ БУРЯ', 'пламя веером, духи из лавы');
    }
    if (b.phase === 2 && k < NOTCHES[2]) {
      b.phase = 3;
      q.rings = arenaRings(sim, b);
      q.step = 0;
      q.next = sim.time + 1;
      say(sim, 'phase', 'РАЗЛОМ', 'арена уходит в лаву — держись середины');
    }
    // Отложенное: омуты вышли из берегов.
    if (q.pend.length && sim.time >= q.warnAt) {
      q.pend = q.pend.filter((i) => !flood(sim, api, i, st.arena));
      q.warnAt = sim.time + 0.4;
    }
    // Разлом: кольцо за кольцом, с трещинами-предупреждениями.
    if (b.phase >= 3 && q.step < q.rings.length && sim.time >= q.next && !q.pend.length) {
      const ring = q.rings[q.step];
      const W = sim.world.w;
      for (const i of ring)
        api.zone(sim, {
          x: (i % W) + 0.5,
          y: Math.floor(i / W) + 0.5,
          r: 0.5,
          life: 0.1,
          warn: 1.6,
          art: 'f6_crack',
        });
      q.pend = ring.slice();
      // v2.86 — только рисунок: лава выходит кольцом — брызги, языки, дым.
      fx6(sim, api, 'f6_fxquake', sim.hero.x, sim.hero.y, 1.4, {
        warn: 1.6,
        cells: ring.slice(),
        W,
      });
      q.warnAt = sim.time + 1.6;
      q.step += 1;
      q.next = sim.time + 9;
      sim.events.push({ t: 'boss', what: 'f6_wall' });
    }
    // Застывающая лава жжёт — правило этажа ведёт и это.
    void dt;
  },
  onPartDown(sim, _b, _m, api) {
    fx6(sim, api, 'f6_fxdeath', _m.x, _m.y, 3.2); // v2.86 — только рисунок
    // Змей пал — лава на арене застывает: выход открыт.
    const st = stateOf(sim);
    cool(sim, api, st.arena);
    return false;
  },
  notches() {
    return NOTCHES;
  },
  reset(sim, b) {
    const st = stateOf(sim);
    // Арена как была: лава уходит, свет — прежний.
    const W = sim.world.w;
    for (const r of st.arena) {
      sim.tiles[r.i] = r.tile;
      sim.world.mark[r.i] = r.mark;
      sim.retiled.push(r.i);
      void W;
    }
    st.arena.length = 0;
    sim.world.lights = st.lights0;
    QUAKES.delete(b);
    for (const m of sim.mobs) TRAILS.delete(m);
  },
});

// ---------------------------------------------------------------------------
// Правила этажа: застывающая лава, гейзерное поле, мост, извержение,
// живая руда, черви в омутах.
// ---------------------------------------------------------------------------

/** Гейзерное поле: волна рядов с юга на север и обратно. */
export const FIELD = { warn: 0.9, step: 0.55, pause: 1.7, r: 0.95 };

function stepField(sim: Sim, dt: number, api: SimApi, f: Field): void {
  const h = sim.hero;
  const inside =
    h.x > f.x0 - 1 && h.x < f.x1 + 2 && h.y > f.y0 - 4 && h.y < f.y1 + 4 && !heroDown(sim);
  if (!inside) {
    f.on = false;
    return;
  }
  if (!f.on) {
    f.on = true;
    f.t = 0;
    if (!f.said) {
      f.said = true;
      say(sim, 'f6_vents', 'ГЕЙЗЕРНОЕ ПОЛЕ', 'жерла бьют рядами — проходи сразу за ударом');
    }
  }
  const n = f.rows.length;
  const len = n * FIELD.step + FIELD.pause;
  const t0 = f.t;
  f.t += dt;
  const W = sim.world.w;
  for (let k = 0; k < n; k++) {
    // Чётная волна — с юга (снизу), нечётная — с севера.
    const at = k * FIELD.step;
    if (!(t0 <= at && f.t > at)) continue;
    const row = f.wave % 2 === 0 ? f.rows[n - 1 - k] : f.rows[k];
    const y = row.y + 0.5;
    api.strike(sim, {
      shape: 'line',
      x: row.x0,
      y,
      r: row.x1 - row.x0 + 1,
      w: 0.42,
      ang: 0,
      warn: FIELD.warn,
      dmg: rawShare(sim, 0.1),
      knock: 3,
      status: 'burn',
      dur: 1,
      art: 'f6_steam',
    });
    for (const i of row.vents) {
      const z: ZoneIn = {
        x: (i % W) + 0.5,
        y: Math.floor(i / W) + 0.5,
        r: FIELD.r,
        warn: FIELD.warn,
        life: 0.7,
        art: 'f6_geyser',
      };
      api.zone(sim, z);
    }
    // Из жерла изредка выходит дух (не больше трёх за проход).
    if (f.spirits < 3 && sim.rng() < 0.12) {
      const i = row.vents[Math.floor(sim.rng() * row.vents.length)];
      const vx = (i % W) + 0.5;
      const vy = Math.floor(i / W) + 0.5;
      if (hypot(vx - h.x, vy - h.y) > 3) {
        f.spirits += 1;
        const m = api.spawnMob(sim, 'f6_wisp', vx, vy, { mode: 'f6_rise' });
        m.data.ghost = 1;
        m.t = -FIELD.warn;
      }
    }
  }
  if (f.t > len) {
    f.t = 0;
    f.wave += 1;
    if (f.wave % 4 === 0) f.spirits = Math.max(0, f.spirits - 1);
  }
}

/** Мост: перешёл середину — рушится за спиной, догоняя. */
export const BRIDGE = { warn: 0.7, gap: 0.3, regrow: 30 };

function stepBridge(sim: Sim, api: SimApi, br: Bridge): void {
  const h = sim.hero;
  const W = sim.world.w;
  const hy = Math.floor(h.y);
  const onBridge =
    Math.abs(h.x - br.cx) < 2.2 && hy <= br.ys[0] + 1 && hy >= br.ys[br.ys.length - 1] - 1;
  if (br.state === 'idle') {
    if (onBridge && hy > br.mid) br.armed = true;
    if (!onBridge) br.armed = false;
    if (br.armed && onBridge && hy < br.mid - 1 && !heroDown(sim)) {
      br.state = 'fall';
      br.next = 0;
      br.nextAt = sim.time;
      say(sim, 'f6_trap', 'МОСТ РУШИТСЯ', 'беги вперёд — назад дороги нет');
    }
    return;
  }
  if (br.state === 'fall') {
    // Трещина идёт с юга, ряд за рядом, но не ближе полутора рядов к герою.
    if (br.next < br.rows.length && sim.time >= br.nextAt) {
      const y = br.ys[br.next];
      if (y > h.y + 1.4 || heroDown(sim)) {
        br.cracked.set(br.next, sim.time + BRIDGE.warn);
        for (const i of br.rows[br.next])
          api.zone(sim, {
            x: (i % W) + 0.5,
            y: Math.floor(i / W) + 0.5,
            r: 0.5,
            life: 0.15,
            warn: BRIDGE.warn,
            art: 'f6_crumble',
          });
        br.next += 1;
        br.nextAt = sim.time + BRIDGE.gap;
      }
    }
    for (const [k, at] of br.cracked) {
      if (sim.time < at) continue;
      let all = true;
      for (const i of br.rows[k]) {
        if (sim.tiles[i] === T_DEEP) continue;
        if (!retile(sim, api, i, T_DEEP, F6_MARK.lava, null)) all = false;
        else
          sim.events.push({
            t: 'break',
            x: (i % W) + 0.5,
            y: Math.floor(i / W) + 0.5,
            kind: 'crack',
          });
      }
      if (all) br.cracked.delete(k);
    }
    if (br.next >= br.rows.length && !br.cracked.size) {
      br.state = 'gone';
      br.goneAt = sim.time;
    }
    return;
  }
  // Рухнул: ушёл подальше — лава застывает мостом снова.
  const far = hypot(h.x - br.cx, h.y - br.cy) > 16;
  if (!far) br.goneAt = Math.max(br.goneAt, sim.time - BRIDGE.regrow + 6);
  if (far && sim.time - br.goneAt > BRIDGE.regrow) {
    for (const r of br.rows)
      for (const i of r) api.setTile(sim, i % W, Math.floor(i / W), T_FLOOR, F6_MARK.bridge);
    br.state = 'idle';
    br.armed = false;
  }
}

/** Извержение: лава поднимается кольцами от краёв зала и отступает. */
export const ERUPT = { warn: 1.4, gap: 2.6, hold: 9, cd: 240, trigger: 4.6 };

function stepEruption(sim: Sim, dt: number, api: SimApi, e: Eruption, log: Retile[]): void {
  const h = sim.hero;
  const W = sim.world.w;
  const d = hypot(h.x - e.cx, h.y - e.cy);
  if (e.state === 'idle') {
    if (d < ERUPT.trigger && sim.time >= e.ready && !heroDown(sim)) {
      e.state = 'rise';
      e.t = 0;
      e.stage = 0;
      e.spawned = 0;
      e.floodAt = 0;
      e.spawnAt = -1;
      say(sim, 'f6_trap', 'ИЗВЕРЖЕНИЕ', 'лава поднимается — держись середины');
      sim.events.push({ t: 'rumble', x: e.cx, y: e.cy, what: 'cart' });
    }
    return;
  }
  e.t += dt;
  if (e.state === 'rise') {
    // Кольцо за кольцом: трещины горят `warn`, потом заливает.
    const period = ERUPT.warn + ERUPT.gap;
    if (e.stage < e.rings.length && e.t >= e.stage * period) {
      for (const i of e.rings[e.stage])
        api.zone(sim, {
          x: (i % W) + 0.5,
          y: Math.floor(i / W) + 0.5,
          r: 0.5,
          life: 0.1,
          warn: ERUPT.warn,
          art: 'f6_rise',
        });
      e.pending.push(...e.rings[e.stage]);
      e.floodAt = e.t + ERUPT.warn;
      e.spawnAt = e.t + ERUPT.warn + 0.5;
      e.stage += 1;
    }
    if (e.pending.length && e.t >= e.floodAt)
      e.pending = e.pending.filter((i) => !flood(sim, api, i, log));
    // Из лавы лезут: духи и саламандры.
    if (e.spawnAt >= 0 && e.t >= e.spawnAt && e.spawned < 9) {
      e.spawnAt = -1;
      spawnFromLava(sim, api, e, e.stage >= 3 ? 3 : 2);
    }
    if (e.stage >= e.rings.length && !e.pending.length && e.t > e.floodAt + 0.5) {
      e.state = 'hold';
      e.t = 0;
    }
    return;
  }
  if (e.state === 'hold') {
    if (e.t >= ERUPT.hold) {
      e.state = 'idle';
      e.ready = sim.time + ERUPT.cd;
      cool(sim, api, log);
      say(sim, 'f6_cool', 'ЛАВА ОТСТУПИЛА', 'обсидиан ещё тёплый');
      if (!e.paid) {
        e.paid = true;
        // Награда: из застывшей лавы в середине.
        for (let i = 0; i < 4; i++) api.dropAt(sim, 'coin', 600, e.cx, e.cy);
        for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2, e.cx, e.cy);
        api.dropAt(sim, 'f6mat', 3, e.cx, e.cy);
        api.dropAt(sim, 'f6_core', 1, e.cx, e.cy);
      }
    }
    return;
  }
  e.state = 'idle';
}

function spawnFromLava(sim: Sim, api: SimApi, e: Eruption, n: number): void {
  const h = sim.hero;
  const W = sim.world.w;
  const lava = e.rings
    .flat()
    .filter(
      (i) =>
        sim.tiles[i] === T_DEEP && hypot((i % W) + 0.5 - h.x, Math.floor(i / W) + 0.5 - h.y) > 3,
    );
  for (let k = 0; k < n && lava.length; k++) {
    const j = Math.floor(sim.rng() * lava.length);
    const i = lava.splice(j, 1)[0];
    const kind = k === 0 && e.stage >= 2 ? 'f6_salamander' : 'f6_wisp';
    const m = api.spawnMob(sim, kind, (i % W) + 0.5, Math.floor(i / W) + 0.5, {
      mode: kind === 'f6_wisp' ? 'f6_rise' : 'f6_swim',
    });
    m.data.ghost = 1;
    m.cd = 0.8;
    e.spawned += 1;
    api.zone(sim, { x: m.x, y: m.y, r: 0.7, life: 0.6, art: 'f6_splash' });
  }
}

const liveMobs = (sim: Sim) =>
  sim.mobs.filter((m) => m.mode !== 'dying' && m.kind !== 'f6boss').length;

registerFloor(6, {
  start(sim) {
    STATE.set(sim, scan(sim));
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    const h = sim.hero;
    const W = sim.world.w;
    const fight = sim.boss?.state === 'fight';

    // Застывающая лава: клетка жжёт, пока не остынет (или пока под ней
    // стоит герой — тогда её не заливает, но и стоять там нельзя).
    const hi = idx(sim, h.x, h.y);
    if (!heroDown(sim) && sim.world.mark[hi] === F6_MARK.hotcrust)
      api.heroStatus(sim, HOT_CRUST.status, HOT_CRUST.dur);
    for (const [i, until] of st.hot) {
      if (sim.time < until) continue;
      st.hot.delete(i);
      if (sim.world.mark[i] === F6_MARK.hotcrust && sim.tiles[i] === T_FLOOR && i !== hi)
        api.setTile(sim, i % W, Math.floor(i / W), T_FLOOR, F6_MARK.cooled);
    }

    // Мозаика арены (картинка на полу, без действия) и тело змея.
    const lair = sim.boss?.obj;
    if (lair && !sim.zones.some((z) => z.art === 'f6_emblem'))
      api.zone(sim, { x: lair.x + 0.5, y: lair.y + 1.5, r: 2.4, life: 1e9, art: 'f6_emblem' });
    const serp = sim.mobs.find((m) => m.kind === 'f6boss' && m.mode !== 'dying');
    if (serp) {
      // v2.86 — только рисунок: тело, доигрывающее смерть (`vDie`), живому
      // змею не годится — новое заводится в тот же шаг, что и раньше.
      const body = sim.zones.find(
        (z) => z.art === 'f6_body' && (z as { vDie?: number }).vDie === undefined,
      );
      if (!body) {
        const z: ZoneIn & { mob: number } = {
          x: serp.x,
          y: serp.y,
          r: 0.1,
          life: 1e9,
          art: 'f6_body',
          mob: serp.id,
        };
        api.zone(sim, z);
      } else {
        body.x = serp.x;
        body.y = serp.y;
        (body as typeof body & { mob: number }).mob = serp.id;
        body.above = !!serp.data.ghost; // v2.86 — только рисунок: в небе тело над всем
      }
    } else {
      const body = sim.zones.find((z) => z.art === 'f6_body');
      const bd = body as (typeof body & { vDie?: number }) | undefined; // v2.86 — только рисунок
      if (bd && bd.vDie === undefined) [bd.vDie, bd.life, bd.above] = [bd.t, bd.t + 1.7, false]; // v2.86 — только рисунок: тело доигрывает смерть кольцами
    }

    if (heroDown(sim)) return;
    const area = sim.world.rowArea[Math.floor(h.y)] ?? '';

    if (area === F6_GALLERY && st.field && !fight) stepField(sim, dt, api, st.field);
    if (area === F6_LAKES && st.bridge) stepBridge(sim, api, st.bridge);
    else if (st.bridge && st.bridge.state !== 'idle') stepBridge(sim, api, st.bridge);
    if (st.erupt && (area === F6_NEST || st.erupt.state !== 'idle'))
      stepEruption(sim, dt, api, st.erupt, eruptLog(sim));

    if (fight) return;

    // Живая руда: лежит самородком на своих местах, пока ты рядом.
    for (const o of st.ores) {
      const d = hypot(o.x - h.x, o.y - h.y);
      if (d > 20 || d < 7 || sim.time < o.ready) continue;
      if (sim.safe.some((s) => hypot(s.x - o.x, s.y - o.y) < 9)) continue;
      o.ready = sim.time + 150;
      const m = api.spawnMob(sim, 'f6_ore', o.x, o.y, { mode: 'f6_hide' });
      m.data.ghost = 1;
      m.data.v = o.v;
    }

    // Черви в омутах: по одному на омут (в большом — два).
    st.worm -= dt;
    if (st.worm <= 0) {
      st.worm = 1.5;
      if (liveMobs(sim) < 22)
        for (const l of st.lakes) {
          if (l.cells.length < 14 || sim.time < l.ready) continue;
          if (hypot(l.cx - h.x, l.cy - h.y) > 16 + Math.sqrt(l.cells.length)) continue;
          const cap = l.cells.length > 120 ? 2 : 1;
          const have = sim.mobs.filter(
            (m) => m.kind === 'f6_worm' && m.mode !== 'dying' && m.data.lake === l.id,
          ).length;
          if (have >= cap) continue;
          // В лаве подальше от героя и не у самого берега.
          const cand = l.cells.filter((i) => {
            const x = (i % W) + 0.5;
            const y = Math.floor(i / W) + 0.5;
            const dh = hypot(x - h.x, y - h.y);
            return dh > 6 && dh < 18;
          });
          if (!cand.length) continue;
          const i = cand[Math.floor(sim.rng() * cand.length)];
          const m = api.spawnMob(sim, 'f6_worm', (i % W) + 0.5, Math.floor(i / W) + 0.5, {
            mode: 'f6_under',
          });
          m.data.ghost = 1;
          m.data.lake = l.id;
          m.cd = 2;
          l.ready = sim.time + 20;
        }
    }
  },
});

// Черновик этажа хранит лишь числа; журнал клеток извержения — отдельно.
const ERUPT_LOG = new WeakMap<Sim, Retile[]>();
function eruptLog(sim: Sim): Retile[] {
  let l = ERUPT_LOG.get(sim);
  if (!l) {
    l = [];
    ERUPT_LOG.set(sim, l);
  }
  return l;
}
