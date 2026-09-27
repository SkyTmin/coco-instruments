// Этаж 5 «Лабиринт» — ИИ монстров, сценарий Минотавра и правила этажа.
//
// Правила этажа (`registerFloor(5)`):
//   • ЖИВЫЕ СТЕНЫ. Прожилка в кладке (буква `w`) наливается светом, стена
//     трескается — и из неё выходит монстр. Трещина видна за секунду до
//     выхода (зона `f5_birth`), новорождённый ещё полсекунды недосягаем
//     (режим `f5_born`). Норы-муравейники (`o`) работают как обычно;
//   • ТРАВА. В зарослях сидят кролики-рогачи: подходишь — прыгают рогом
//     вперёд, промахнулись — скачут обратно в траву и прячутся снова;
//   • ФЕРОМОН. Укус муравья метит героя на 8 с: муравьи этажа бегут на
//     запах, а из живых стен рядом лезут новые (не больше трёх на метку);
//   • ПЛИТЫ С ШИПАМИ. Наступил — через 0,42 с шипы из плиты и её соседей.
//
// Честность: всё, что бьёт, видно заранее — линия рывка, конус огня и
// секиры, круг рёва, трещина живой стены, плита шипов.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { Mob, Prop, Sim } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F5_ARENA, F5_MARK } from './f5';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

/** Сколько длится выход из стены (недосягаем), с. */
export const BORN_T = 0.8;
/** Трещина живой стены горит столько, прежде чем выйдет монстр, с. */
export const BIRTH_WARN = 1.1;
/** Метка феромона, с. */
export const PHER_T = 8;
/** Рывок Минотавра: сколько клеток бежит, если стены нет. */
export const CHARGE_MAX = 9;

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

const markAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return 0;
  return w.mark[y * w.w + x];
};

const isGrass = (sim: Sim, x: number, y: number) =>
  markAt(sim, Math.floor(x), Math.floor(y)) === F5_MARK.grass;

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

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

/** Выход из стены: недосягаем, стоит, потом в погоню. */
function bornStep(m: Mob, api: SimApi): boolean {
  if (m.mode !== 'f5_born') return false;
  m.data.ghost = 1;
  m.vx *= 0.5;
  m.vy *= 0.5;
  m.tele = null;
  m.danger = 0;
  if (m.t >= BORN_T) {
    m.data.ghost = 0;
    api.setMode(m, 'chase');
    m.cd = 0.35;
  }
  return true;
}

/** Укус: общий для гончей, муравья, жабы (замах `windup` рисует движок). */
function biteStep(
  sim: Sim,
  m: Mob,
  c: BrainCtx,
  api: SimApi,
  onHit?: () => void,
  push = 2.5,
): void {
  const h = sim.hero;
  const def = c.def;
  m.vx *= 0.75;
  m.vy *= 0.75;
  if (m.t < def.windup) return;
  const reach = def.reach + m.r + h.r + 0.18;
  if (c.dist < reach && h.inv <= 0 && h.mode !== 'dash') {
    api.hurtHero(sim, m.dmg, m.x, m.y, push, m.kind);
    onHit?.();
  }
  m.vx += Math.cos(m.face) * 3;
  m.vy += Math.sin(m.face) * 3;
  api.setMode(m, 'recover');
  m.data.bcd = def.rest * (0.8 + sim.rng() * 0.4);
}

// ---------------------------------------------------------------------------
// Состояние этажа: живые стены, заросли, плиты, отложенные рождения.
// ---------------------------------------------------------------------------

interface LivingWall {
  x: number;
  y: number;
  /** Клетка пола, куда выходит монстр. */
  ox: number;
  oy: number;
  /** Когда стена снова может родить (время симуляции). */
  ready: number;
  area: string;
}

interface Pocket {
  cells: number[];
  cx: number;
  cy: number;
  /** Когда засеяли в последний раз. */
  at: number;
  id: number;
}

interface Birth {
  t: number;
  kind: string;
  wx: number;
  wy: number;
  ox: number;
  oy: number;
  /** Тень, которая возвращается из стены (id моба), или 0 — новый. */
  mob: number;
}

interface F5State {
  walls: LivingWall[];
  pockets: Pocket[];
  spikes: Set<number>;
  spikeCd: Map<number, number>;
  births: Birth[];
  birthT: number;
  pherZone: number;
  pherCall: number;
  pherAnts: number;
  pherSaid: number;
}

const STATE = new WeakMap<Sim, F5State>();

function scan(sim: Sim, api: SimApi): F5State {
  const w = sim.world;
  const walls: LivingWall[] = [];
  const spikes = new Set<number>();
  const grass: number[] = [];
  const open = (x: number, y: number) => !api.solidTile(sim, x, y);
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const k = w.mark[y * w.w + x];
      if (k === F5_MARK.living) {
        // Выход — на пол под лицом стены, иначе сбоку.
        for (const [dx, dy] of [
          [0, 1],
          [1, 0],
          [-1, 0],
          [0, -1],
        ]) {
          if (open(x + dx, y + dy)) {
            walls.push({
              x,
              y,
              ox: x + dx,
              oy: y + dy,
              ready: 0,
              area: w.rowArea[y],
            });
            break;
          }
        }
      } else if (k === F5_MARK.spike) spikes.add(y * w.w + x);
      else if (k === F5_MARK.grass) grass.push(y * w.w + x);
    }
  // Заросли — связные куски травы.
  const seen = new Set<number>();
  const set = new Set(grass);
  const pockets: Pocket[] = [];
  for (const g of grass) {
    if (seen.has(g)) continue;
    const cells: number[] = [];
    const q = [g];
    seen.add(g);
    while (q.length) {
      const i = q.pop()!;
      cells.push(i);
      for (const d of [1, -1, w.w, -w.w]) {
        const j = i + d;
        if (set.has(j) && !seen.has(j)) {
          seen.add(j);
          q.push(j);
        }
      }
    }
    if (cells.length < 4) continue;
    let sx = 0;
    let sy = 0;
    for (const i of cells) {
      sx += i % w.w;
      sy += Math.floor(i / w.w);
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
    walls,
    pockets,
    spikes,
    spikeCd: new Map(),
    births: [],
    birthT: 6,
    pherZone: 0,
    pherCall: 0,
    pherAnts: 0,
    pherSaid: -999,
  };
}

/** Состояние этажа (собирается в `start`, но переживёт и мир без него). */
function stateOf(sim: Sim, api: SimApi): F5State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim, api);
    STATE.set(sim, st);
  }
  return st;
}

/** Живые стены этажа — для тестов. */
export const f5Walls = (sim: Sim): readonly LivingWall[] => STATE.get(sim)?.walls ?? [];
/** Заросли этажа — для тестов. */
export const f5Pockets = (sim: Sim): readonly Pocket[] => STATE.get(sim)?.pockets ?? [];
/** Ждущие рождения — для тестов. */
export const f5Births = (sim: Sim): readonly Birth[] => STATE.get(sim)?.births ?? [];

/** Трещина в живой стене: через `BIRTH_WARN` из неё выйдет `kind`. */
function startBirth(sim: Sim, api: SimApi, wall: LivingWall, kind: string, mob = 0): void {
  const st = stateOf(sim, api);
  wall.ready = sim.time + 22;
  st.births.push({
    t: BIRTH_WARN,
    kind,
    wx: wall.x,
    wy: wall.y,
    ox: wall.ox,
    oy: wall.oy,
    mob,
  });
  const z: ZoneIn & { wx: number; wy: number; ang: number } = {
    x: wall.x + 0.5,
    y: wall.y + 0.5,
    r: 0.5,
    life: BIRTH_WARN + 0.45,
    art: 'f5_birth',
    wx: wall.x,
    wy: wall.y,
    ang: Math.atan2(wall.oy - wall.y, wall.ox - wall.x),
  };
  api.zone(sim, z);
}

/** Живая стена рядом с героем: `minD…maxD` клеток, выход достижим. */
function pickWall(sim: Sim, api: SimApi, minD: number, maxD: number): LivingWall | null {
  const st = stateOf(sim, api);
  const h = sim.hero;
  let total = 0;
  const cand: [LivingWall, number][] = [];
  for (const wl of st.walls) {
    if (wl.ready > sim.time) continue;
    const d = hypot(wl.ox + 0.5 - h.x, wl.oy + 0.5 - h.y);
    if (d < minD || d > maxD) continue;
    if (api.inArena(sim, wl.ox + 0.5, wl.oy + 0.5)) continue;
    if (sim.safe.some((s) => hypot(s.x - wl.ox, s.y - wl.oy) < 10)) continue;
    const fl = sim.flow[wl.oy * sim.world.w + wl.ox];
    if (fl < 0 || fl > maxD * 1.8) continue;
    // Видно — чаще: рождение из стены должно быть на глазах.
    const wgt = api.lineOfSight(sim, h.x, h.y, wl.ox + 0.5, wl.oy + 0.5) ? 3 : 1;
    cand.push([wl, wgt]);
    total += wgt;
  }
  if (!cand.length) return null;
  let r = sim.rng() * total;
  for (const [wl, wgt] of cand) {
    r -= wgt;
    if (r <= 0) return wl;
  }
  return cand[cand.length - 1][0];
}

/** Кто выходит из стены в районе. */
function wallKind(sim: Sim, area: string): string {
  const list: [string, number][] =
    area === F5_ARENA
      ? [
          ['f5_shade', 40],
          ['f5_hound', 35],
          ['f5_ant', 25],
        ]
      : [
          ['f5_shade', 45],
          ['f5_ant', 20],
          ['f5_hound', 20],
          ['f5_frog', 15],
        ];
  let total = 0;
  for (const [, w] of list) total += w;
  let r = sim.rng() * total;
  for (const [k, w] of list) {
    r -= w;
    if (r <= 0) return k;
  }
  return list[0][0];
}

const liveMobs = (sim: Sim) =>
  sim.mobs.filter((m) => m.mode !== 'dying' && !m.kind.endsWith('minotaur')).length;

/** Метка феромона на герое. */
function markHero(sim: Sim, api: SimApi): void {
  const st = stateOf(sim, api);
  const fresh = (sim.floorData.pher ?? 0) <= sim.time;
  sim.floorData.pher = sim.time + PHER_T;
  if (fresh) {
    st.pherAnts = 0;
    st.pherCall = 1.2;
  }
  if (sim.time - st.pherSaid > 45) {
    st.pherSaid = sim.time;
    sim.events.push({
      t: 'boss',
      what: 'f5_pher',
      text: 'МЕТКА',
      sub: 'муравьи идут на запах',
    });
  }
}

/** Феромон висит на герое. */
export const pherOn = (sim: Sim) => (sim.floorData.pher ?? 0) > sim.time;

// ---------------------------------------------------------------------------
// Кролик-рогач: засада в траве, рывок рогом, обратно в траву.
// ---------------------------------------------------------------------------

const RABBIT_RUN = 5.2;

/** Куда спрятаться: трава в пределах шести клеток, видно, подальше от героя. */
function grassSpot(sim: Sim, api: SimApi, m: Mob): [number, number] | null {
  const h = sim.hero;
  const cx = Math.floor(m.x);
  const cy = Math.floor(m.y);
  let best: [number, number] | null = null;
  let bs = -1e9;
  for (let y = cy - 6; y <= cy + 6; y++)
    for (let x = cx - 6; x <= cx + 6; x++) {
      if (markAt(sim, x, y) !== F5_MARK.grass) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      const dm = hypot(px - m.x, py - m.y);
      if (dm > 6.5) continue;
      if (sim.mobs.some((o) => o !== m && o.mode === 'f5_hide' && hypot(o.x - px, o.y - py) < 0.9))
        continue;
      if (!api.lineOfSight(sim, m.x, m.y, px, py)) continue;
      const s = hypot(px - h.x, py - h.y) - dm * 0.6;
      if (s > bs) {
        bs = s;
        best = [px, py];
      }
    }
  return best;
}

/** Прыжками: скорость ходит волной — толчок, полёт, приземление. */
const hopSpeed = (m: Mob, base: number) =>
  base * (0.35 + 1.25 * Math.max(0, Math.sin(m.t * 9 + m.id)));

registerBrain('f5_rabbit', {
  step(sim, m, dt, c, api) {
    if (bornStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.bounce = m.mode === 'charge';
    switch (m.mode) {
      case 'f5_hide': {
        m.data.ghost = 1;
        m.vx *= 0.6;
        m.vy *= 0.6;
        const see = dist < 4.6 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        // Наступил рядом — выскакивает сразу; увидел издали — ждёт отдыха.
        if ((see && m.cd <= 0) || dist < 1.4) {
          m.data.ghost = 0;
          m.data.quick = dist < 1.4 ? 1 : 0;
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          sim.events.push({ t: 'squeak', x: m.x, y: m.y });
        }
        return;
      }
      case 'aim': {
        const T = m.data.quick ? 0.34 : def.windup;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < T * 0.6) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'line', r: RABBIT_RUN, w: 0.3, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.22) m.danger = 3.6;
        if (m.t >= T) {
          m.data.hit = 0;
          api.setMode(m, 'charge');
        }
        return;
      }
      case 'charge': {
        const s = 11;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.danger = m.r + h.r + 1;
        if (!m.data.hit && dist < m.r + h.r + 0.12 && h.inv <= 0 && h.mode !== 'dash') {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.25, m.x, m.y, 6, m.kind);
          api.setMode(m, 'recover');
          m.cd = def.rest * 2;
          return;
        }
        if (m.t > RABBIT_RUN / s) {
          api.setMode(m, 'recover');
          m.cd = def.rest * 2;
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 1.1) api.setMode(m, 'hop');
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.55) {
          api.setMode(m, 'hop');
          m.data.tx = -1;
        }
        return;
      case 'hop': {
        if (m.t < dt * 1.5 || m.data.tx === undefined) {
          const spot = grassSpot(sim, api, m);
          m.data.tx = spot ? spot[0] : -1;
          m.data.ty = spot ? spot[1] : -1;
        }
        if (m.data.tx < 0) {
          api.setMode(m, 'chase');
          return;
        }
        const tx = m.data.tx - m.x;
        const ty = m.data.ty - m.y;
        const d = hypot(tx, ty);
        if (d < 0.35 || (d < 0.9 && isGrass(sim, m.x, m.y) && m.t > 0.6)) {
          api.setMode(m, 'f5_hide');
          m.cd = 1.8 + sim.rng() * 1.2;
          return;
        }
        api.steer(sim, m, tx / (d || 1), ty / (d || 1), hopSpeed(m, m.speed * 1.2), dt);
        if (m.t > 4) api.setMode(m, 'chase');
        return;
      }
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < 4.6 && m.cd <= 0) {
          m.data.quick = 0;
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        // Трава рядом и отдых ещё идёт — спрятаться.
        if (m.cd > 0.6 && isGrass(sim, m.x, m.y) && m.t > 0.5) {
          api.setMode(m, 'f5_hide');
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        // Петляет, а вблизи держит прыжок дистанции.
        const z = Math.sin(sim.time * 5 + m.id) * 0.7;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        const k = dist < 2.6 ? -0.6 : 1;
        api.steer(sim, m, (cx / l) * k, (cy / l) * k, hopSpeed(m, m.speed), dt);
        return;
      }
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'charge') return;
    // Врезался рогом в стену — застрял и оглушён: бей.
    m.bounce = false;
    m.vx = 0;
    m.vy = 0;
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'dizzy');
  },
});

// ---------------------------------------------------------------------------
// Адская гончая: стая обходит с боков, дышит огнём по очереди.
// ---------------------------------------------------------------------------

const FIRE_R = 3.4;
const FIRE_ARC = 0.95;
const FIRE_WARN = 0.62;

registerBrain('f5_hound', {
  step(sim, m, dt, c, api) {
    if (bornStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        // Пламя по очереди: пока дышит сосед, остальные кружат.
        const busy = sim.mobs.some(
          (o) =>
            o !== m &&
            o.kind === 'f5_hound' &&
            o.mode === 'breath' &&
            hypot(o.x - m.x, o.y - m.y) < 8,
        );
        if (see && dist < FIRE_R - 0.2 && dist > 1.1 && m.cd <= 0 && !busy) {
          m.dir = Math.atan2(dy, dx);
          m.data.lit = 0;
          api.setMode(m, 'breath');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Обход: точка на кольце вокруг героя, сдвинутая в свою сторону.
        const side = m.id % 2 ? 1 : -1;
        const a0 = Math.atan2(m.y - h.y, m.x - h.x) + side * 0.6;
        const R = dist > 6 ? 0 : 2.7;
        const [cx, cy] = api.chaseDir(sim, m, h.x + Math.cos(a0) * R, h.y + Math.sin(a0) * R);
        api.steer(sim, m, cx, cy, m.speed * (dist < 3.2 ? 0.75 : 1), dt);
        return;
      }
      case 'breath': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        // Первые доли секунды доводит голову, потом пламя уже не свернёт.
        if (m.t < 0.18) m.dir = Math.atan2(dy, dx);
        else if (!m.data.lit) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: FIRE_R,
            ang: m.dir,
            arc: FIRE_ARC,
            warn: FIRE_WARN,
            dmg: m.dmg * 1.2,
            knock: 3,
            status: 'burn',
            dur: 1.6,
            art: 'f5_fire',
            from: m.id,
          });
        }
        m.face = m.dir;
        if (m.t >= 0.18 + FIRE_WARN) {
          // Само пламя — картинка на полсекунды, удар уже нанесён меткой.
          const z: ZoneIn & { ang: number } = {
            x: m.x,
            y: m.y,
            r: FIRE_R,
            life: 0.45,
            art: 'f5_flame',
            ang: m.dir,
          };
          api.zone(sim, z);
          api.setMode(m, 'recover');
          m.cd = 3 + sim.rng() * 1.4;
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
});

// ---------------------------------------------------------------------------
// Муравей-убийца: панцирь, укус метит феромоном, раненый зовёт своих.
// ---------------------------------------------------------------------------

registerBrain('f5_ant', {
  step(sim, m, dt, c, api) {
    const pher = pherOn(sim);
    m.rush = pher;
    if (bornStep(m, api)) return;
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
        // Ранен наполовину — щёлкает жвалами, зовёт своих из стен.
        if (
          !m.data.called &&
          m.hp < m.maxHp * 0.55 &&
          dist < 7 &&
          api.lineOfSight(sim, m.x, m.y, h.x, h.y)
        ) {
          api.setMode(m, 'call');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (pher ? 1.35 : 1), dt);
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api, () => markHero(sim, api), 1.5);
        return;
      case 'call': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        m.tele = { shape: 'ring', r: 1, w: 0.12, k: Math.min(1, m.t / 1) };
        if (m.t >= 1) {
          m.data.called = 1;
          const wl = pickWall(sim, api, 2.5, 10);
          if (wl) startBirth(sim, api, wl, 'f5_ant');
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.45) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Тень лабиринта: два удара когтями; раненая уходит в стену и выходит из
// другой живой стены рядом с героем.
// ---------------------------------------------------------------------------

registerBrain('f5_shade', {
  step(sim, m, dt, c, api) {
    if (bornStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    const reach = def.reach + m.r + h.r;
    switch (m.mode) {
      case 'chase': {
        if (!m.data.melted && m.hp < m.maxHp * 0.5) {
          m.data.melted = 1;
          api.setMode(m, 'melt');
          return;
        }
        if (dist < reach && m.cd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        let [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        // Колышется на подходе — тень, а не человек.
        const z = dist > 2 ? Math.sin(sim.time * 4 + m.id * 1.7) * 0.45 : 0;
        cx += -cy * z;
        cy += cx * z;
        const l = hypot(cx, cy) || 1;
        api.steer(sim, m, cx / l, cy / l, m.speed, dt);
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < def.windup) return;
        if (dist < reach + 0.2 && h.inv <= 0 && h.mode !== 'dash')
          api.hurtHero(sim, m.dmg, m.x, m.y, 2.5, m.kind);
        m.vx += Math.cos(m.face) * 2.5;
        m.vy += Math.sin(m.face) * 2.5;
        m.dir = Math.atan2(dy, dx);
        api.setMode(m, 'slash2');
        return;
      }
      case 'slash2': {
        // Второй удар — наотмашь, шире; метка конусом.
        const T = 0.34;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.15) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        m.tele = { shape: 'cone', r: reach + 0.35, arc: 1.9, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.2) m.danger = reach + 0.6;
        if (m.t >= T) {
          const a = Math.atan2(dy, dx);
          let off = Math.abs(a - m.dir);
          if (off > Math.PI) off = TAU - off;
          if (dist < reach + 0.4 && off < 1.1 && h.inv <= 0 && h.mode !== 'dash')
            api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 4, m.kind);
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      }
      case 'melt':
        // Растекается по полу и уходит в кладку.
        m.data.ghost = 1;
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t >= 0.55) {
          api.setMode(m, 'f5_gone');
          const wl = pickWall(sim, api, 2.5, 8);
          if (wl) startBirth(sim, api, wl, m.kind, m.id);
          else m.data.back = 1;
        }
        return;
      case 'f5_gone':
        m.data.ghost = 1;
        m.vx = 0;
        m.vy = 0;
        // Стены рядом не нашлось — выходит из пола там же.
        if (m.data.back && m.t > 1.2) api.setMode(m, 'f5_born');
        if (m.t > 6) api.setMode(m, 'f5_born');
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
});

// ---------------------------------------------------------------------------
// Жаба-арканщица: язык по линии, притягивает; вплотную кусает.
// ---------------------------------------------------------------------------

const TONGUE = 5.6;

registerBrain('f5_frog', {
  step(sim, m, dt, c, api) {
    if (bornStep(m, api)) return;
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bcd = (m.data.bcd ?? 0) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist > 1.8 && dist < TONGUE - 0.3 && m.cd <= 0) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'aim');
          return;
        }
        if (dist < def.reach + m.r + h.r && m.data.bcd <= 0) {
          m.face = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        // Держит дистанцию языка: близко — отпрыгивает, далеко — подходит.
        let dir: [number, number];
        if (dist < 2.6 && see)
          dir = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
        else dir = api.chaseDir(sim, m, h.x, h.y);
        const k = dist < 4.2 && dist > 2.6 ? 0.3 : 1;
        api.steer(sim, m, dir[0], dir[1], hopSpeed(m, m.speed) * k, dt);
        return;
      }
      case 'aim': {
        const T = 0.7;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < 0.42) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(TONGUE, wallDist(sim, api, m.x, m.y, m.dir, TONGUE));
        m.tele = { shape: 'line', r: len, w: 0.26, ang: m.dir, k: Math.min(1, m.t / T) };
        if (m.t > T - 0.24) m.danger = TONGUE + 0.4;
        if (m.t >= T) {
          const hit =
            h.inv <= 0 && h.mode !== 'dash' && lineHits(m.x, m.y, m.dir, len, 0.26, h.x, h.y, h.r);
          if (hit) {
            // Аркан: удар и рывок к жабе.
            api.hurtHero(sim, m.dmg, m.x, m.y, -22, m.kind, { kind: 'slow', dur: 0.9 });
          }
          const z: ZoneIn & { ang: number; len: number } = {
            x: m.x,
            y: m.y,
            r: 0.3,
            life: 0.3,
            art: 'f5_tongue',
            ang: m.dir,
            len: hit ? Math.min(len, dist) : len,
          };
          api.zone(sim, z);
          api.setMode(m, 'recover');
          m.cd = 2.6 + sim.rng();
        }
        return;
      }
      case 'windup':
        biteStep(sim, m, c, api);
        return;
      case 'recover':
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
// Минотавр. Ведёт все режимы сам (босс).
//   chase  — идёт на героя; решает: секира, рёв или рывок;
//   aim    — роет копытом, линия до стены (или на CHARGE_MAX клеток);
//   gore   — рывок; упёрся в стену или колонну — `dizzy` (главное окно);
//            стены не достал — `skid` (занесло, короткое окно);
//   axe    — секира конусом; с фазы 2 оставляет трещины с огнём;
//   whirl  — в ярости: секира вкруговую;
//   bellow — рёв: круг оглушения, за ним сразу рывок;
//   dizzy, skid, recover, roar (вход).
// ---------------------------------------------------------------------------

const MINO = {
  speed: 11,
  aim: 0.95,
  aimNext: 0.62,
  axeWarn: 0.85,
  axeR: 3.0,
  axeArc: 2.3,
  whirlR: 3.1,
  roarR: 4.6,
  roarWarn: 1.05,
  dizzy: 2.3,
  pillarDizzy: 3.0,
};

const hasteOf = (sim: Sim) => {
  const p = sim.boss?.phase ?? 0;
  return p >= 2 ? 1.3 : p >= 1 ? 1.12 : 1;
};

/** Рифты с огнём там, куда ударила секира. */
function rifts(sim: Sim, api: SimApi, m: Mob, around: boolean): void {
  const angs = around
    ? [0, 1, 2, 3, 4, 5].map((i) => m.dir + (i / 6) * TAU)
    : [m.dir - 0.7, m.dir, m.dir + 0.7];
  const rage = (sim.boss?.phase ?? 0) >= 2;
  for (const a of angs) {
    const d = around ? 2.3 : 2.2;
    const x = m.x + Math.cos(a) * d;
    const y = m.y + Math.sin(a) * d;
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
    const z: ZoneIn & { ang: number } = {
      x,
      y,
      r: 0.62,
      life: rage ? 7 : 5.5,
      dps: 0.03,
      status: 'burn',
      dur: 0.8,
      warn: 0.25,
      art: 'f5_rift',
      ang: a,
    };
    api.zone(sim, z);
  }
}

/** Колонна на пути рывка: разбить её, а самому встать оглушённым. */
const PILLAR_OBJ = new WeakMap<Prop, WorldObj>();

function smashPillar(sim: Sim, m: Mob): boolean {
  const ux = Math.cos(m.dir);
  const uy = Math.sin(m.dir);
  for (const p of sim.props) {
    if (!p.alive || p.kind !== 'deco' || p.obj.ref !== 'f5_pillar') continue;
    const dx = p.x - m.x;
    const dy = p.y - m.y;
    const d = hypot(dx, dy);
    if (d > m.r + p.r + 0.2 || d < 1e-6) continue;
    if ((dx * ux + dy * uy) / d < 0.3) continue;
    PILLAR_OBJ.set(p, p.obj);
    p.obj = { ...p.obj, ref: 'f5_pillar_broken' };
    p.r = 0;
    p.flash = 0.2;
    sim.events.push({ t: 'break', x: p.x, y: p.y, kind: 'crate' });
    sim.events.push({ t: 'boom', x: p.x, y: p.y, r: 0 });
    return true;
  }
  return false;
}

function minoStun(sim: Sim, m: Mob, api: SimApi, long: boolean): void {
  m.bounce = false;
  m.vx = 0;
  m.vy = 0;
  m.danger = 0;
  m.data.series = 0;
  m.data.long = long ? 1 : 0;
  sim.hitstop = Math.max(sim.hitstop, long ? 0.12 : 0.09);
  sim.events.push({
    t: 'boom',
    x: m.x + Math.cos(m.dir) * m.r,
    y: m.y + Math.sin(m.dir) * m.r,
    r: 0,
  });
  sim.events.push({ t: 'boss', what: 'f5_wall' });
  api.setMode(m, 'dizzy');
}

function startAim(sim: Sim, m: Mob, api: SimApi, next: boolean): void {
  const h = sim.hero;
  m.dir = Math.atan2(h.y - m.y, h.x - m.x);
  m.data.next = next ? 1 : 0;
  api.setMode(m, 'aim');
}

registerBrain('f5_minotaur', {
  raw: true,
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    const haste = hasteOf(sim);
    const phase = sim.boss?.phase ?? 0;
    m.tele = null;
    m.danger = 0;
    // Темп фазы — и рисовальщику: замах секиры короче в ярости.
    m.data.haste = haste;
    m.data.axeCd = (m.data.axeCd ?? 1.5) - dt;
    m.data.roarCd = (m.data.roarCd ?? 6) - dt;
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
        if (m.t > 1.5) api.setMode(m, 'chase');
        return;
      case 'chase': {
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * haste * (dist < 2.2 ? 0.4 : 1), dt);
        if (m.t < 0.85 / haste) return;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (dist < 3.3 && m.data.axeCd <= 0) {
          m.dir = Math.atan2(dy, dx);
          m.face = m.dir;
          const whirl = phase >= 2 && (m.data.whirls ?? 0) % 2 === 1;
          m.data.whirls = (m.data.whirls ?? 0) + 1;
          if (whirl) {
            api.setMode(m, 'whirl');
            api.strike(sim, {
              shape: 'circle',
              x: m.x,
              y: m.y,
              r: MINO.whirlR,
              warn: 0.9 / haste,
              dmg: m.dmg * 2,
              knock: 9,
              art: 'f5_whirl',
              from: m.id,
            });
          } else {
            api.setMode(m, 'axe');
            api.strike(sim, {
              shape: 'cone',
              x: m.x,
              y: m.y,
              r: MINO.axeR,
              ang: m.dir,
              arc: MINO.axeArc,
              warn: MINO.axeWarn / haste,
              dmg: m.dmg * 2.2,
              knock: 9,
              art: 'f5_axe',
              from: m.id,
            });
          }
          return;
        }
        if (phase >= 1 && m.data.roarCd <= 0 && dist < 5.5) {
          api.setMode(m, 'bellow');
          api.strike(sim, {
            shape: 'circle',
            x: m.x,
            y: m.y,
            r: MINO.roarR,
            warn: MINO.roarWarn / haste,
            dmg: m.dmg * 0.6,
            knock: 5,
            status: 'stun',
            dur: 1.1,
            art: 'f5_roar',
            from: m.id,
          });
          return;
        }
        if (see && dist > 1.8) {
          m.data.series = phase >= 2 ? 3 : phase >= 1 ? 2 : 1;
          startAim(sim, m, api, false);
          return;
        }
        if (m.t > 3.5 && see) {
          m.data.series = 1;
          startAim(sim, m, api, false);
        }
        return;
      }
      case 'aim': {
        const T = (m.data.next ? MINO.aimNext : MINO.aim) / haste;
        m.vx *= 0.7;
        m.vy *= 0.7;
        // Доводит рога до героя, потом замирает: видно, куда побежит.
        if (m.t < T * 0.55) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const wd = wallDist(sim, api, m.x, m.y, m.dir, CHARGE_MAX + 2);
        const len = Math.min(CHARGE_MAX, wd);
        m.data.len = len;
        m.data.wall = wd <= CHARGE_MAX ? 1 : 0;
        m.tele = {
          shape: 'line',
          r: len + m.r * 0.5,
          w: m.r * 0.9,
          ang: m.dir,
          k: Math.min(1, m.t / T),
        };
        if (m.t > T - 0.28) m.danger = 4.4;
        if (m.t >= T) {
          m.data.run = 0;
          m.data.hit = 0;
          m.bounce = true;
          api.setMode(m, 'gore');
          sim.events.push({ t: 'boss', what: 'roll' });
        }
        return;
      }
      case 'gore': {
        const s = MINO.speed * haste;
        m.vx = Math.cos(m.dir) * s;
        m.vy = Math.sin(m.dir) * s;
        m.face = m.dir;
        m.data.run += s * dt;
        m.danger = m.r + h.r + 1.3;
        if (!m.data.hit && dist < m.r + h.r + 0.1 && h.inv <= 0 && h.mode !== 'dash') {
          // Сшиб — и бежит дальше: остановит его только стена.
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 2, m.x, m.y, 12, m.kind);
        }
        if (smashPillar(sim, m)) {
          minoStun(sim, m, api, true);
          return;
        }
        if (m.data.run >= CHARGE_MAX || m.t > 2.2) {
          m.bounce = false;
          api.setMode(m, 'skid');
        }
        return;
      }
      case 'skid':
        // Стены не достал — занесло: короткое окно.
        m.vx *= 0.86;
        m.vy *= 0.86;
        if (m.t > 0.5 / haste) {
          m.data.series = (m.data.series ?? 1) - 1;
          m.data.chopped = 0;
          if (m.data.series > 0) startAim(sim, m, api, true);
          else api.setMode(m, 'recover');
        }
        return;
      case 'dizzy': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        const T = m.data.long ? MINO.pillarDizzy : phase >= 2 ? MINO.dizzy * 0.8 : MINO.dizzy;
        if (m.t > T) {
          m.data.axeCd = 0;
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'axe':
      case 'whirl': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        const T = (m.mode === 'axe' ? MINO.axeWarn : 0.9) / haste;
        if (m.t >= T && !m.data.swung) {
          m.data.swung = 1;
          if (phase >= 1) rifts(sim, api, m, m.mode === 'whirl');
          sim.events.push({ t: 'boss', what: 'whip' });
        }
        if (m.t >= T + 0.75 / haste) {
          m.data.swung = 0;
          m.data.chopped = 1;
          m.data.axeCd = 2.4 / haste;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'bellow':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(dy, dx);
        if (m.t >= MINO.roarWarn / haste) {
          m.data.roarCd = 10;
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
          // За рёвом — сразу рывок: оглушённому не увернуться.
          m.data.series = phase >= 2 ? 2 : 1;
          startAim(sim, m, api, true);
        }
        return;
      case 'recover':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > 0.65 / haste) api.setMode(m, 'chase');
        return;
      default:
        m.bounce = false;
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'gore') return;
    minoStun(sim, m, api, false);
  },
});

registerBoss('f5_minotaur', {
  start(_sim, b, lead) {
    b.phase = 0;
    lead.data.axeCd = 2;
    lead.data.roarCd = 6;
    lead.face = Math.PI / 2;
  },
  step(sim, b) {
    const lead = sim.mobs.find((m) => m.kind === 'f5_minotaur' && m.mode !== 'dying');
    if (!lead) return;
    const k = lead.hp / lead.maxHp;
    if (b.phase === 0 && k < 0.5) {
      b.phase = 1;
      lead.data.roarCd = 0.5;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'РЁВ ЛАБИРИНТА',
        sub: 'уйди из круга — оглушит; рывки сериями',
      });
    }
    if (b.phase === 1 && k < 0.25) {
      b.phase = 2;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'КРОВАВАЯ ЯРОСТЬ',
        sub: 'секира вкруговую, огонь в трещинах',
      });
    }
  },
  reset(sim) {
    // Колонны встают на место: арена та же, что была до боя.
    for (const p of sim.props) {
      const o = PILLAR_OBJ.get(p);
      if (!o) continue;
      p.obj = o;
      p.r = o.solid ?? 0.46;
      p.alive = true;
      PILLAR_OBJ.delete(p);
    }
  },
});

// ---------------------------------------------------------------------------
// Правила этажа: живые стены, заросли, феромон, плиты с шипами.
// ---------------------------------------------------------------------------

registerFloor(5, {
  start(sim, api) {
    STATE.set(sim, scan(sim, api));
  },
  step(sim, dt, api) {
    const st = stateOf(sim, api);
    const h = sim.hero;
    const fight = sim.boss?.state === 'fight';

    // Отложенные рождения — даже если герой упал: трещина доигрывает.
    const keep: Birth[] = [];
    for (const b of st.births) {
      b.t -= dt;
      if (b.t > 0) {
        keep.push(b);
        continue;
      }
      const face = Math.atan2(b.oy - b.wy, b.ox - b.wx);
      let m: Mob | undefined;
      if (b.mob) {
        m = sim.mobs.find((x) => x.id === b.mob && x.mode !== 'dying');
        if (m) {
          m.x = b.ox + 0.5;
          m.y = b.oy + 0.5;
          m.vx = 0;
          m.vy = 0;
          api.setMode(m, 'f5_born');
        }
      } else m = api.spawnMob(sim, b.kind, b.ox + 0.5, b.oy + 0.5, { mode: 'f5_born' });
      if (m) {
        m.face = face;
        m.data.ghost = 1;
        m.data.wx = b.wx;
        m.data.wy = b.wy;
        sim.events.push({ t: 'emerge', x: b.ox + 0.5, y: b.oy + 0.5 });
      }
    }
    st.births = keep;
    // Герб арены под логовом: мозаика в песке (зона-картинка, без действия).
    const lair = sim.boss?.obj;
    if (lair && !sim.zones.some((z) => z.art === 'f5_emblem'))
      api.zone(sim, { x: lair.x + 0.5, y: lair.y + 0.5, r: 1.6, life: 1e9, art: 'f5_emblem' });
    if (heroDown(sim)) return;

    // Феромон: муравьи бегут на запах, из стен лезут новые.
    const pher = pherOn(sim);
    const aura = st.pherZone ? sim.zones.find((z) => z.id === st.pherZone) : undefined;
    if (pher) {
      if (!aura) {
        api.zone(sim, { x: h.x, y: h.y, r: 0.9, life: 999, art: 'f5_pher' });
        st.pherZone = sim.zones[sim.zones.length - 1]?.id ?? 0;
      } else {
        aura.x = h.x;
        aura.y = h.y;
        aura.life = 999;
      }
      st.pherCall -= dt;
      if (st.pherCall <= 0 && st.pherAnts < 3 && !fight) {
        st.pherCall = 3.5;
        const wl = pickWall(sim, api, 3, 10);
        if (wl) {
          startBirth(sim, api, wl, 'f5_ant');
          st.pherAnts += 1;
        }
      }
    } else if (aura) {
      aura.life = 0;
      aura.t = 1e9;
      st.pherZone = 0;
    }

    // Живые стены рожают, пока идёшь по лабиринту.
    st.birthT -= dt;
    if (st.birthT <= 0) {
      st.birthT = 9 + sim.rng() * 7;
      const nearLift = sim.safe.some((s) => hypot(s.x - h.x, s.y - h.y) < 11);
      const near = sim.mobs.filter(
        (m) => m.mode !== 'dying' && hypot(m.x - h.x, m.y - h.y) < 10,
      ).length;
      if (!fight && !nearLift && liveMobs(sim) < 14 && near < 6) {
        const wl = pickWall(sim, api, 4.5, 11);
        if (wl) startBirth(sim, api, wl, wallKind(sim, wl.area));
      }
    }

    // Заросли: подходишь — в траве уже сидят кролики.
    if (!fight)
      for (const p of st.pockets) {
        if (hypot(p.cx - h.x, p.cy - h.y) > 12) continue;
        if (sim.time - p.at < 90) continue;
        // У лифта тихо: заросли в зале лифта остаются просто травой.
        if (sim.safe.some((s) => hypot(s.x - p.cx, s.y - p.cy) < 24)) continue;
        if (sim.mobs.some((m) => m.data.pocket === p.id && m.mode !== 'dying')) continue;
        p.at = sim.time;
        const n = Math.min(3, 1 + Math.floor(p.cells.length / 7));
        const cells = p.cells.filter((i) => {
          const x = (i % sim.world.w) + 0.5;
          const y = Math.floor(i / sim.world.w) + 0.5;
          return hypot(x - h.x, y - h.y) > 3;
        });
        for (let k = 0; k < n && cells.length; k++) {
          const j = Math.floor(sim.rng() * cells.length);
          const i = cells.splice(j, 1)[0];
          const m = api.spawnMob(
            sim,
            'f5_rabbit',
            (i % sim.world.w) + 0.5,
            Math.floor(i / sim.world.w) + 0.5,
            { mode: 'f5_hide' },
          );
          m.data.ghost = 1;
          m.data.pocket = p.id;
          m.cd = 0.4 + sim.rng();
        }
      }

    // Плиты с шипами: наступил — через миг шипы из плиты и соседних.
    const hx = Math.floor(h.x);
    const hy = Math.floor(h.y);
    const W = sim.world.w;
    const here = hy * W + hx;
    if (st.spikes.has(here) && (st.spikeCd.get(here) ?? 0) <= sim.time) {
      const raw = rawShare(sim, 0.1);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = (hy + dy) * W + hx + dx;
          if (!st.spikes.has(i) || (st.spikeCd.get(i) ?? 0) > sim.time) continue;
          st.spikeCd.set(i, sim.time + 1.8);
          const cx = hx + dx + 0.5;
          const cy = hy + dy + 0.5;
          api.strike(sim, {
            shape: 'circle',
            x: cx,
            y: cy,
            r: 0.5,
            warn: 0.42,
            dmg: raw,
            knock: 2,
            art: 'f5_spike',
          });
          api.zone(sim, { x: cx, y: cy, r: 0.5, warn: 0.42, life: 0.6, art: 'f5_spikes_up' });
        }
      sim.events.push({ t: 'clank', x: h.x, y: h.y });
    }
  },
});
