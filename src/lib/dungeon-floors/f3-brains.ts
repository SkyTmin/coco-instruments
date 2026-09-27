// Этаж 3 «Затопленная бездна» — ИИ монстров, сценарий Алой пасти и правила
// этажа (проклятие подъёма, омуты, зов пересмешника).
//
// Движок импортировать значениями нельзя (круг модулей): только типы и `api`.
// Коды клеток «глубина» и «пол» берём из самого мира — по клеткам со своими
// марками (`F3_MARK`), а не из `Tile`.
//
// Честность боя (библия, §4): всё, что бьёт, сперва видно — линия пике и
// разгона, круг хвата у кромки, круг приземления, конус волны, облако с
// задержкой. У каждого есть окно: пересмешник после пике сидит, шар-копьё
// застревает иглой в стене, омутник висит над водой, краб держит клешню в
// земле, Алая пасть лежит на берегу.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Sim, Zone } from '../dungeon-sim';
import { F3_MARK } from './f3';

// ---------------------------------------------------------------------------
// Общее.
// ---------------------------------------------------------------------------

/** Зона с данными для рисовальщика (`f3-art.ts`): доля, клетки отмели. */
export interface F3Zone extends ZoneIn {
  /** Доля: тяга проклятия 0…1. */
  k?: number;
  /** Клетки (индексы мира) — отмель, которую заливает прилив. */
  cells?: number[];
  /** Ширина мира — чтобы из индекса получить клетку. */
  ww?: number;
}

const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Всё, что этаж помнит о симуляции (сложное — не в `floorData`). */
interface F3State {
  deep: number;
  floor: number;
  liftY: number;
  pools: { x: number; y: number; body: number[] }[];
  springs: { x: number; y: number }[];
  curse: Zone | null;
  lure: { zone: Zone; x: number; y: number; mob: number; pool: number; until: number } | null;
  nextLure: number;
  poolT: number;
  tide: { cells: number[]; done: Uint8Array; n: number } | null;
  lake: { ver: number; cells: number[] } | null;
}

const STATE = new WeakMap<Sim, F3State>();

/** Состояние этажа: собирается один раз на симуляцию, лениво. */
function stateOf(sim: Sim): F3State {
  let st = STATE.get(sim);
  if (st) return st;
  const w = sim.world;
  let deep = -1;
  let floor = -1;
  for (let i = 0; i < w.w * w.h; i++) {
    const mk = w.mark[i];
    if (deep < 0 && (mk === F3_MARK.lake || mk === F3_MARK.water || mk === F3_MARK.pool))
      deep = w.tiles[i];
    if (floor < 0 && (mk === F3_MARK.tide || mk === F3_MARK.bridgeV || mk === F3_MARK.glow))
      floor = w.tiles[i];
    if (deep >= 0 && floor >= 0) break;
  }
  const lift = w.objs.find(
    (o) => o.kind === 'lift' && o.area === w.bands[w.bands.length - 1].def.id,
  );
  const pools: F3State['pools'] = [];
  const springs: F3State['springs'] = [];
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const mk = w.mark[y * w.w + x];
      if (mk === F3_MARK.pool) pools.push({ x: x + 0.5, y: y + 0.5, body: waterBody(sim, x, y) });
      if (mk === F3_MARK.spring) springs.push({ x: x + 0.5, y: y + 0.5 });
    }
  st = {
    deep,
    floor,
    liftY: lift ? lift.y + 0.5 : w.h,
    pools,
    springs,
    curse: null,
    lure: null,
    nextLure: 20,
    poolT: 0,
    tide: null,
    lake: null,
  };
  STATE.set(sim, st);
  return st;
}

/** Связная вода вокруг омута: по ней плавает его омутник. */
function waterBody(sim: Sim, sx: number, sy: number): number[] {
  const w = sim.world;
  const water = (i: number) => {
    const mk = w.mark[i];
    return mk === F3_MARK.water || mk === F3_MARK.pool;
  };
  const out: number[] = [];
  const seen = new Set<number>([sy * w.w + sx]);
  const q = [sy * w.w + sx];
  while (q.length && out.length < 600) {
    const i = q.shift()!;
    out.push(i);
    const x = i % w.w;
    for (const j of [i + 1, i - 1, i + w.w, i - w.w]) {
      if (j < 0 || j >= w.w * w.h || seen.has(j)) continue;
      if (Math.abs((j % w.w) - x) > 1) continue;
      if (!water(j)) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return out;
}

/** Вода ли клетка сейчас (прилив её меняет). */
function isDeep(sim: Sim, x: number, y: number): boolean {
  const w = sim.world;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= w.w || cy >= w.h) return false;
  return sim.tiles[cy * w.w + cx] === stateOf(sim).deep;
}

/** Ближайшая клетка списка к точке (центр клетки). */
function nearestCell(sim: Sim, cells: number[], x: number, y: number): [number, number] | null {
  const w = sim.world.w;
  let best = -1;
  let bd = 1e9;
  for (const i of cells) {
    const cx = (i % w) + 0.5;
    const cy = Math.floor(i / w) + 0.5;
    const d = (cx - x) * (cx - x) + (cy - y) * (cy - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return null;
  return [(best % w) + 0.5, Math.floor(best / w) + 0.5];
}

const heroDown = (sim: Sim) => sim.hero.mode === 'dying' || sim.hero.mode === 'dead';

/** Рывок и неуязвимость — удар мимо (как у короля). */
const heroOpen = (sim: Sim) => sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !heroDown(sim);

// ---------------------------------------------------------------------------
// Пересмешник: кружит над водой и пропастью, пикирует по линии. Зов — в
// правилах этажа: пересмешник «кричит» чужим голосом у омута, где ждёт
// омутник, и ждёт в темноте за ложным огоньком.
// ---------------------------------------------------------------------------

const MOCK_DIVE = 12;

registerBrain('f3_mocker', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    if (m.mode !== 'dive') m.bounce = false;
    switch (m.mode) {
      case 'chase': {
        // Кружит на своём расстоянии: сторона и радиус — свои у каждого.
        const want = m.data.orbit || (m.data.orbit = 2.6 + sim.rng() * 1.4);
        const spin = m.id % 2 ? 1 : -1;
        const around = Math.atan2(m.y - h.y, m.x - h.x) + spin * 0.7;
        let tx = h.x + Math.cos(around) * want;
        let ty = h.y + Math.sin(around) * want;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (!see || dist > 8) {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          tx = m.x + cx;
          ty = m.y + cy;
        }
        const l = Math.hypot(tx - m.x, ty - m.y) || 1;
        api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, m.speed * (l < 0.4 ? 0.3 : 1), dt);
        if (see && dist < 5.8 && dist > 1.2 && m.cd <= 0 && m.t > 0.4) {
          api.setMode(m, 'aim');
          m.dir = Math.atan2(dy, dx);
          m.data.quick = 0;
        }
        return;
      }
      case 'call': {
        // Зовёт: висит в темноте за ложным огоньком, дальше от героя.
        const lx = m.data.lx;
        const ly = m.data.ly;
        const ax = lx - h.x;
        const ay = ly - h.y;
        const al = Math.hypot(ax, ay) || 1;
        const tx = lx + (ax / al) * 2.4;
        const ty = ly + (ay / al) * 2.4;
        const l = Math.hypot(tx - m.x, ty - m.y);
        if (l > 0.3) api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, m.speed * 0.9, dt);
        else {
          m.vx *= 0.8;
          m.vy *= 0.8;
        }
        m.face = Math.atan2(h.y - m.y, h.x - m.x);
        // Подошёл к самой птице — нападает и без огонька.
        if (dist < 2.6 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          api.setMode(m, 'aim');
          m.dir = Math.atan2(dy, dx);
          m.data.quick = 1;
        }
        if (m.t > 11) api.setMode(m, 'chase');
        return;
      }
      case 'aim': {
        // Замирает в воздухе, линия пике наливается; последние 0,4 с — не
        // доводит прицел: видно, куда ударит.
        const wind = m.data.quick ? 0.42 : def.windup;
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t < wind - 0.25) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = clamp(dist + 1.4, 2.5, 7);
        m.data.len = len;
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: clamp(m.t / wind, 0, 1) };
        if (m.t > wind - 0.25) m.danger = 3.2;
        if (m.t >= wind) {
          m.tele = null;
          m.bounce = true;
          m.data.hit = 0;
          api.setMode(m, 'dive');
        }
        return;
      }
      case 'dive': {
        m.vx = Math.cos(m.dir) * MOCK_DIVE;
        m.vy = Math.sin(m.dir) * MOCK_DIVE;
        m.face = m.dir;
        m.danger = m.r + h.r + 0.9;
        if (!m.data.hit && dist < m.r + h.r + 0.12 && heroOpen(sim)) {
          api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          m.data.hit = 1;
        }
        if (m.t * MOCK_DIVE >= (m.data.len || 5)) {
          m.bounce = false;
          m.danger = 0;
          api.setMode(m, 'perch');
          m.cd = def.rest * (0.8 + sim.rng() * 0.5);
        }
        return;
      }
      case 'perch':
        // Выдохся после пике: сел и тяжело дышит — окно для ответа.
        m.vx *= 0.75;
        m.vy *= 0.75;
        if (m.t > 0.95) api.setMode(m, 'chase');
        return;
      case 'dizzy':
        // Врезался в стену.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 1.4) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'dive') return;
    m.bounce = false;
    m.danger = 0;
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'dizzy');
    m.cd = 1.2;
  },
});

// ---------------------------------------------------------------------------
// Шар-копьё: держит дистанцию, сворачивается (линия растёт — нарастание),
// катится с разгоном и проносится сквозь героя, не останавливаясь. В стену
// или в воду — застревает иглой: оглушён, удар по нему полуторный.
// ---------------------------------------------------------------------------

const SPEAR_MAX = 14;

registerBrain('f3_spear', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        m.bounce = false;
        m.data.stuck = 0;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && dist < 7.5 && dist > 1.6 && m.cd <= 0) {
          api.setMode(m, 'curl');
          m.dir = Math.atan2(dy, dx);
          return;
        }
        // Вплотную — отбегает: ему нужен разбег.
        if (dist < 2.6 && see) {
          const away = api.flowDir(sim, m.x, m.y, true) ?? [-dx / (dist || 1), -dy / (dist || 1)];
          api.steer(sim, m, away[0], away[1], m.speed, dt);
        } else {
          const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
          api.steer(sim, m, cx, cy, m.speed, dt);
        }
        return;
      }
      case 'curl': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < def.windup - 0.35) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const k = clamp(m.t / def.windup, 0, 1);
        // Линия растёт с набором: чем дольше крутится, тем дальше пронесётся.
        m.tele = { shape: 'line', r: 2.5 + 7 * k, w: m.r + 0.1, ang: m.dir, k };
        if (m.t > def.windup - 0.25) m.danger = 4.5;
        if (m.t >= def.windup) {
          m.tele = null;
          m.bounce = true;
          m.data.v = 3;
          m.data.hit = 0;
          api.setMode(m, 'roll');
        }
        return;
      }
      case 'roll': {
        const v = Math.min(SPEAR_MAX, (m.data.v || 3) + 20 * dt);
        m.data.v = v;
        m.vx = Math.cos(m.dir) * v;
        m.vy = Math.sin(m.dir) * v;
        m.face = m.dir;
        m.danger = m.r + h.r + 1.1;
        // Пробивает насквозь: задел — отбрасывает вбок и катится дальше.
        if (!m.data.hit && dist < m.r + h.r + 0.12 && heroOpen(sim)) {
          const px = -Math.sin(m.dir);
          const py = Math.cos(m.dir);
          const side = px * dx + py * dy >= 0 ? 1 : -1;
          api.hurtHero(
            sim,
            m.dmg * (0.6 + (0.7 * v) / SPEAR_MAX),
            h.x - px * side,
            h.y - py * side,
            9,
            m.kind,
          );
          m.data.hit = 1;
        }
        if (m.t > 2.6) {
          m.bounce = false;
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
        return;
      }
      case 'dizzy':
        // Игла в стене: дёргается, не может вырвать.
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t > 1.8) {
          m.data.stuck = 0;
          api.setMode(m, 'chase');
          m.cd = def.rest * 1.4;
        }
        return;
      case 'recover':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > 0.6) api.setMode(m, 'chase');
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'roll') return;
    m.bounce = false;
    m.danger = 0;
    m.data.stuck = 1;
    sim.hitstop = Math.max(sim.hitstop, 0.06);
    sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
    api.setMode(m, 'dizzy');
  },
});

// ---------------------------------------------------------------------------
// Омутник: живёт в воде своего омута, пока под водой — недосягаем
// (`ghost`). Подплывает к кромке, где стоит герой, и выныривает хватом: круг
// на месте героя наливается, потом хват тянет к воде и вяжет. Вынырнул —
// висит над водой, его можно бить с берега.
// ---------------------------------------------------------------------------

const GRASP_R = 0.95;

function graspBody(sim: Sim, m: Mob): number[] {
  const st = stateOf(sim);
  const p = st.pools[(m.data.pool || 1) - 1];
  return p ? p.body : [];
}

/** Плыть только по воде: шаг, уводящий на сушу, гасится по оси. */
function swimTo(sim: Sim, m: Mob, tx: number, ty: number, speed: number, dt: number, api: SimApi) {
  const l = Math.hypot(tx - m.x, ty - m.y);
  if (l < 0.15) {
    m.vx *= 0.7;
    m.vy *= 0.7;
    return;
  }
  api.steer(sim, m, (tx - m.x) / l, (ty - m.y) / l, speed * Math.min(1, l * 1.5), dt);
  const ahead = 0.18 + m.r;
  const sx = Math.sign(m.vx) * ahead;
  const sy = Math.sign(m.vy) * ahead;
  if (m.vx && !isDeep(sim, m.x + sx, m.y)) m.vx = 0;
  if (m.vy && !isDeep(sim, m.x, m.y + sy)) m.vy = 0;
}

registerBrain('f3_grasp', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dist, def } = c;
    m.tele = null;
    m.danger = 0;
    // Вытолкнуло на сушу (толкотня, отброс) — назад в воду.
    if (!isDeep(sim, m.x, m.y) && m.mode !== 'dying') {
      const body = graspBody(sim, m);
      const back = nearestCell(sim, body, m.x, m.y);
      if (back) {
        const l = Math.hypot(back[0] - m.x, back[1] - m.y) || 1;
        m.vx = ((back[0] - m.x) / l) * 3;
        m.vy = ((back[1] - m.y) / l) * 3;
      }
    }
    switch (m.mode) {
      case 'chase':
      case 'lurk': {
        if (m.mode === 'chase') m.mode = 'lurk';
        m.data.ghost = 1;
        const body = graspBody(sim, m);
        m.data.re = (m.data.re || 0) - dt;
        if (m.data.re <= 0) {
          m.data.re = 0.3;
          const near = heroDown(sim) ? null : nearestCell(sim, body, h.x, h.y);
          const home = st2(sim, m);
          const t = near && Math.hypot(near[0] - h.x, near[1] - h.y) < 9 ? near : home;
          m.data.tx = t[0];
          m.data.ty = t[1];
        }
        swimTo(sim, m, m.data.tx, m.data.ty, m.speed, dt, api);
        if (
          !heroDown(sim) &&
          m.cd <= 0 &&
          dist < def.reach + m.r + h.r + 0.8 &&
          !isDeep(sim, h.x, h.y)
        ) {
          api.setMode(m, 'rise');
          m.data.gx = h.x;
          m.data.gy = h.y;
        }
        return;
      }
      case 'rise': {
        // Выныривает: первые 0,3 с круг следует за героем, потом замирает.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.3) {
          m.data.gx = h.x;
          m.data.gy = h.y;
        }
        m.data.ghost = m.t < 0.35 ? 1 : 0;
        m.face = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
        const k = clamp(m.t / def.windup, 0, 1);
        m.tele = { shape: 'circle', r: GRASP_R, k, x: m.data.gx, y: m.data.gy };
        const inCircle = Math.hypot(h.x - m.data.gx, h.y - m.data.gy) < GRASP_R + h.r;
        if (m.t > def.windup - 0.25 && inCircle) m.danger = dist + 0.5;
        if (m.t >= def.windup) {
          m.tele = null;
          if (inCircle && heroOpen(sim)) {
            // Хват тянет к воде: «отброс» — от точки за героем к омутнику.
            const fx = h.x + (h.x - m.x);
            const fy = h.y + (h.y - m.y);
            api.hurtHero(sim, m.dmg, fx, fy, 5, m.kind, { kind: 'slow', dur: 1.6 });
          }
          sim.events.push({ t: 'strike', x: m.data.gx, y: m.data.gy, art: 'f3_grab' });
          api.setMode(m, 'hold');
        }
        return;
      }
      case 'hold':
        // Висит над водой — его видно и его бьют.
        m.data.ghost = 0;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = Math.atan2(h.y - m.y, h.x - m.x);
        if (m.t > 1.6) api.setMode(m, 'sink');
        return;
      case 'sink':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.data.ghost = m.t > 0.3 ? 1 : 0;
        if (m.t > 0.45) {
          api.setMode(m, 'lurk');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      default:
        api.setMode(m, 'lurk');
    }
  },
  onDeath(sim, m) {
    const p = m.data.pool;
    if (p) sim.floorData[`pcd${p}`] = sim.time + 150;
  },
});

/** Дом омутника — центр его омута. */
function st2(sim: Sim, m: Mob): [number, number] {
  const p = stateOf(sim).pools[(m.data.pool || 1) - 1];
  return p ? [p.x, p.y] : [m.hx, m.hy];
}

// ---------------------------------------------------------------------------
// Друзовый краб: панцирь-друза спереди держит удар (`ghost`, пока герой в
// секторе перед ним: удар звякает искрами). Разворачивается медленно — зайди
// сбоку. Клешня бьёт конусом и застревает в земле — тогда он открыт.
// ---------------------------------------------------------------------------

const CRAB_TURN = 1.9;
const CRAB_GUARD = 1.05;

registerBrain('f3_crab', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    const toHero = Math.atan2(dy, dx);
    if (m.data.sh === undefined) m.data.sh = toHero;
    const turn = (rate: number) => {
      const d = angDiff(toHero, m.data.sh);
      m.data.sh += clamp(d, -rate * dt, rate * dt);
    };
    const front = Math.abs(angDiff(toHero, m.data.sh)) < CRAB_GUARD;
    switch (m.mode) {
      case 'chase': {
        turn(CRAB_TURN);
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, dist < 1.1 ? 0 : m.speed, dt);
        m.face = m.data.sh;
        m.data.ghost = front ? 1 : 0;
        // Удар в панцирь: звякает и сыплет искрами — видно, что не прошёл.
        if (front && (h.mode === 'attack' || h.mode === 'heavy') && dist < 2 && h.t < 0.2) {
          const aimed = Math.abs(angDiff(h.aim, Math.atan2(m.y - h.y, m.x - h.x))) < 1.1;
          if (aimed && sim.time - (m.data.clk || -9) > 0.22) {
            m.data.clk = sim.time;
            sim.events.push({
              t: 'clank',
              x: m.x + Math.cos(toHero) * 0.3,
              y: m.y + Math.sin(toHero) * 0.3 - 0.2,
            });
          }
        }
        if (
          dist < def.reach + m.r + h.r + 0.1 &&
          m.cd <= 0 &&
          Math.abs(angDiff(toHero, m.data.sh)) < 0.5
        ) {
          api.setMode(m, 'windup');
          m.face = m.data.sh;
        }
        return;
      }
      case 'windup':
        // Клешни вверх — панцирь раскрыт: можно ударить и в лоб.
        m.data.ghost = 0;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.data.sh;
        if (m.t >= def.windup) {
          const off = Math.abs(angDiff(toHero, m.data.sh));
          if (dist < def.reach + m.r + h.r + 0.2 && off < 0.75 && heroOpen(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          sim.events.push({ t: 'boom', x: m.x + Math.cos(m.face) * 0.5, y: m.y, r: 0 });
          api.setMode(m, 'recover');
          m.cd = def.rest * (0.8 + sim.rng() * 0.4);
        }
        return;
      case 'recover':
        // Клешня в земле: открыт спереди.
        m.data.ghost = 0;
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.data.sh;
        if (m.t > 1.05) api.setMode(m, 'chase');
        return;
      default:
        m.data.ghost = 0;
        api.setMode(m, 'chase');
    }
  },
});

// ---------------------------------------------------------------------------
// Туманка: плывёт по воздуху к герою, оставляет ледяные облака (видно за
// полсекунды), жалит вплотную холодом. Лопнула — облако побольше.
// ---------------------------------------------------------------------------

registerBrain('f3_jelly', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.cloud = (m.data.cloud || 2 + sim.rng() * 2) - dt;
    switch (m.mode) {
      case 'chase': {
        const a = Math.atan2(dy, dx) + Math.sin(sim.time * 1.3 + m.id) * 0.7;
        api.steer(sim, m, Math.cos(a), Math.sin(a), dist > 0.9 ? m.speed : 0.3, dt);
        if (m.data.cloud <= 0 && dist < 7) {
          api.zone(sim, {
            x: m.x,
            y: m.y,
            r: 1.15,
            life: 4.5,
            warn: 0.6,
            status: 'chill',
            dur: 1.6,
            art: 'f3_mist',
          });
          m.data.cloud = 4 + sim.rng() * 1.6;
        }
        if (dist < def.reach + m.r + h.r + 0.05 && m.cd <= 0) {
          api.setMode(m, 'windup');
          m.face = Math.atan2(dy, dx);
        }
        return;
      }
      case 'windup':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t >= def.windup) {
          if (dist < def.reach + m.r + h.r + 0.25 && heroOpen(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 2, m.kind, { kind: 'chill', dur: 1.6 });
          api.setMode(m, 'recover');
          m.cd = def.rest;
        }
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
    api.zone(sim, {
      x: m.x,
      y: m.y,
      r: 1.7,
      life: 3.2,
      warn: 0.35,
      status: 'chill',
      dur: 1.8,
      art: 'f3_mist',
    });
  },
});

// ---------------------------------------------------------------------------
// Алая пасть — босс арены-озера.
//   Фаза 0 «Под водой»: кружит в озере (недосягаема: видны плавник и рябь),
//     прыгает на героя — круг приземления наливается всё время полёта, после
//     прыжка лежит на берегу (окно), потом ползёт назад в воду. Далеко от
//     воды — плюётся навесом.
//   Фаза 1 «Прилив» (с 62%): вода поднимается — отмели вокруг озера уходят
//     под воду (клетки становятся глубиной; под героем — ждут, пока уйдёт),
//     бьёт хвостом волной (конус, вяжет), вынырнув у кромки.
//   Фаза 2 «Голод» (с 30%): прыжки сериями по три, короткий отдых между.
// ---------------------------------------------------------------------------

const MAW_JUMP = 9;
const MAW_SPLASH = 1.45;

const SPIT = {
  speed: 9,
  r: 0.8,
  life: 3,
  dmg: 0.7,
  art: 'f3_spit',
  status: 'slow' as const,
  dur: 2.2,
  lob: true,
};

/** Вода арены сейчас (с приливом): по ней плавает пасть. */
function lakeCells(sim: Sim, b: BossFight): number[] {
  const st = stateOf(sim);
  const ver = st.tide?.n ?? 0;
  if (st.lake && st.lake.ver === ver) return st.lake.cells;
  const w = sim.world;
  let x0 = w.w;
  let x1 = 0;
  let y0 = w.h;
  let y1 = 0;
  for (const i of b.cells) {
    const x = i % w.w;
    const y = Math.floor(i / w.w);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const cells: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w.w + x;
      if (sim.tiles[i] === st.deep) cells.push(i);
    }
  st.lake = { ver, cells };
  return cells;
}

/** Отмель арены: клетки по близости к воде — сперва кромка, потом дальше. */
function tideOf(sim: Sim, b: BossFight): NonNullable<F3State['tide']> {
  const st = stateOf(sim);
  if (st.tide) return st.tide;
  const w = sim.world;
  const lake = lakeCells(sim, b);
  const cells = [...b.cells].filter((i) => w.mark[i] === F3_MARK.tide);
  const dist = (i: number) => {
    const p = nearestCell(sim, lake, (i % w.w) + 0.5, Math.floor(i / w.w) + 0.5);
    return p ? Math.hypot(p[0] - (i % w.w) - 0.5, p[1] - Math.floor(i / w.w) - 0.5) : 0;
  };
  const d = new Map(cells.map((i) => [i, dist(i)]));
  cells.sort((a, c) => d.get(a)! - d.get(c)!);
  st.tide = { cells, done: new Uint8Array(cells.length), n: 0 };
  return st.tide;
}

/** Вода уходит: отмели снова суша (победа, смерть героя, отдых). */
function ebb(sim: Sim): void {
  const st = STATE.get(sim);
  if (!st?.tide || !st.tide.n) return;
  const t = st.tide;
  for (let k = 0; k < t.cells.length; k++)
    if (t.done[k]) {
      sim.tiles[t.cells[k]] = st.floor;
      t.done[k] = 0;
    }
  t.n = 0;
}

/** Прилив: по несколько клеток за шаг, не под героем и не под ходячими. */
function flood(sim: Sim, b: BossFight, count: number): void {
  const st = stateOf(sim);
  const t = tideOf(sim, b);
  const w = sim.world.w;
  let left = count;
  for (let k = 0; k < t.cells.length && left > 0; k++) {
    if (t.done[k]) continue;
    const i = t.cells[k];
    const cx = (i % w) + 0.5;
    const cy = Math.floor(i / w) + 0.5;
    // Клетка под героем ждёт: вода не выталкивает его из-под ног.
    if (
      Math.abs(sim.hero.x - cx) < 0.5 + sim.hero.r + 0.1 &&
      Math.abs(sim.hero.y - cy) < 0.5 + sim.hero.r + 0.1
    )
      continue;
    let busy = false;
    for (const m of sim.mobs) {
      if (m.mode === 'dying') continue;
      if (m.kind === 'f3_maw' || m.kind === 'f3_jelly' || m.kind === 'f3_mocker') continue;
      if (Math.abs(m.x - cx) < 0.5 + m.r && Math.abs(m.y - cy) < 0.5 + m.r) busy = true;
    }
    if (busy) continue;
    // Предметы на отмели (столбы) остаются сушей.
    if (sim.props.some((p) => p.alive && Math.floor(p.x) + Math.floor(p.y) * w === i)) continue;
    sim.tiles[i] = st.deep;
    t.done[k] = 1;
    t.n += 1;
    left -= 1;
  }
}

/** Куда прыгать: к герою с упреждением, не дальше прыжка, на сушу. */
function landingFor(sim: Sim, m: Mob, api: SimApi): [number, number] {
  const h = sim.hero;
  let lx = h.x + h.vx * 0.22;
  let ly = h.y + h.vy * 0.22;
  if (api.solidTile(sim, Math.floor(lx), Math.floor(ly))) {
    lx = h.x;
    ly = h.y;
  }
  const d = Math.hypot(lx - m.x, ly - m.y);
  if (d > MAW_JUMP) {
    // Не допрыгнуть: падает на сушу по пути (ближайшая точка на линии).
    for (let k = MAW_JUMP; k > 1; k -= 0.5) {
      const x = m.x + ((lx - m.x) / d) * k;
      const y = m.y + ((ly - m.y) / d) * k;
      if (!api.solidTile(sim, Math.floor(x), Math.floor(y))) return [x, y];
    }
  }
  return [lx, ly];
}

function startLeap(sim: Sim, m: Mob, api: SimApi, lx: number, ly: number, strike: boolean): void {
  const d = Math.hypot(lx - m.x, ly - m.y);
  const hungry = (sim.boss?.phase ?? 0) >= 2;
  const T = hungry ? 0.66 + d / 18 : 0.74 + d / 16;
  m.data.sx = m.x;
  m.data.sy = m.y;
  m.data.lx = lx;
  m.data.ly = ly;
  m.data.T = T;
  m.data.hop = 2.2 + d * 0.22;
  m.data.ghost = 1;
  m.data.thr = 0;
  m.face = Math.atan2(ly - m.y, lx - m.x);
  if (strike)
    api.strike(sim, {
      shape: 'circle',
      x: lx,
      y: ly,
      r: MAW_SPLASH,
      warn: T,
      dmg: m.dmg * 1.5,
      knock: 9,
      art: 'f3_splash',
      from: m.id,
    });
  sim.events.push({ t: 'boss', what: 'roll' });
  api.setMode(m, 'leap');
}

function mawStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const b = sim.boss;
  if (!b) return;
  const { dx, dy, dist } = c;
  const ph = b.phase;
  const haste = b.t > 200 ? 1.25 : 1;
  m.tele = null;
  m.danger = 0;
  m.bounce = false;
  const lake = lakeCells(sim, b);
  const wet = isDeep(sim, m.x, m.y);
  switch (m.mode) {
    case 'roar':
      // Встаёт на берегу у ворот и ревёт — потом уходит в воду.
      m.data.ghost = 0;
      m.vx *= 0.8;
      m.vy *= 0.8;
      m.face = Math.atan2(dy, dx);
      if (m.t > 1.3) {
        api.setMode(m, 'crawl');
        const w = nearestCell(sim, lake, m.x, m.y);
        if (w) {
          m.data.wx = w[0];
          m.data.wy = w[1];
        }
      }
      return;
    case 'swim': {
      m.data.ghost = 1;
      m.data.z = 0;
      m.data.re = (m.data.re || 0) - dt;
      if (m.data.re <= 0) {
        // Под героем, со стороны озера, с покачиванием вдоль берега.
        m.data.re = 0.35;
        const wob = Math.sin(sim.time * 0.9 + m.id) * 2.2;
        const cx = h.x + Math.cos(Math.atan2(dy, dx) + Math.PI / 2) * wob;
        const cy = h.y + Math.sin(Math.atan2(dy, dx) + Math.PI / 2) * wob;
        const t = nearestCell(sim, lake, cx, cy);
        if (t) {
          m.data.tx = t[0];
          m.data.ty = t[1];
        }
      }
      const sp = (ph >= 1 ? 5.6 : 4.6) * haste;
      const l = Math.hypot(m.data.tx - m.x, m.data.ty - m.y);
      if (l > 0.3) api.steer(sim, m, (m.data.tx - m.x) / l, (m.data.ty - m.y) / l, sp, dt);
      else {
        m.vx *= 0.85;
        m.vy *= 0.85;
      }
      // Держится воды: шаг на сушу гасится.
      if (!isDeep(sim, m.x + Math.sign(m.vx) * 0.5, m.y)) m.vx *= 0.3;
      if (!isDeep(sim, m.x, m.y + Math.sign(m.vy) * 0.5)) m.vy *= 0.3;
      const wait = (ph === 0 ? 2.1 : ph === 1 ? 1.8 : 1.3) / haste;
      if (m.t > wait && !heroDown(sim)) {
        const r = sim.rng();
        if (dist > MAW_JUMP + 1.5) {
          api.setMode(m, 'spit');
        } else if (ph >= 1 && r < 0.38) {
          api.setMode(m, 'tail');
        } else {
          m.data.series = ph >= 2 ? 3 : 1;
          api.setMode(m, 'rise');
        }
      }
      return;
    }
    case 'rise': {
      // Пузыри и тень у поверхности: сейчас прыгнет.
      m.data.ghost = wet ? 1 : 0;
      m.vx *= 0.7;
      m.vy *= 0.7;
      m.face = Math.atan2(dy, dx);
      const wind = (ph >= 2 ? 0.34 : 0.5) / haste;
      if (m.t >= wind) {
        const [lx, ly] = landingFor(sim, m, api);
        startLeap(sim, m, api, lx, ly, true);
      }
      return;
    }
    case 'leap': {
      // Полёт: недосягаема, круг приземления наливается всё время полёта.
      const T = m.data.T || 1;
      const k = clamp(m.t / T, 0, 1);
      m.data.ghost = 1;
      m.x = m.data.sx + (m.data.lx - m.data.sx) * k;
      m.y = m.data.sy + (m.data.ly - m.data.sy) * k;
      m.vx = 0;
      m.vy = 0;
      m.data.z = Math.sin(k * Math.PI) * (m.data.hop || 2.5);
      if (k >= 1) {
        m.data.z = 0;
        sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0 });
        sim.hitstop = Math.max(sim.hitstop, 0.05);
        if (isDeep(sim, m.x, m.y)) {
          // Нырок назад (прыжок в воду после выползания).
          api.setMode(m, 'swim');
          return;
        }
        m.data.series = Math.max(0, (m.data.series || 1) - 1);
        api.setMode(m, 'beached');
      }
      return;
    }
    case 'beached': {
      // Лежит на берегу, бьёт хвостом по земле — окно.
      m.data.ghost = 0;
      m.data.z = 0;
      m.vx *= 0.6;
      m.vy *= 0.6;
      const rest = m.data.series ? 0.45 : ph === 0 ? 2.6 : ph === 1 ? 2.2 : 2;
      // С прилива на берегу бьётся: хвост метёт кругом — жадных наказывает.
      if (ph >= 1 && !m.data.series && !m.data.thr && m.t > 0.75) {
        m.data.thr = 1;
        api.strike(sim, {
          shape: 'circle',
          x: m.x,
          y: m.y,
          r: 2,
          warn: 0.55,
          dmg: m.dmg * 0.9,
          knock: 7,
          art: 'f3_thrash',
          from: m.id,
        });
      }
      if (m.t > rest / haste) {
        if (m.data.series > 0 && !heroDown(sim)) {
          api.setMode(m, 'rise');
          return;
        }
        api.setMode(m, 'crawl');
        const w = nearestCell(sim, lake, m.x, m.y);
        if (w) {
          m.data.wx = w[0];
          m.data.wy = w[1];
        }
      }
      return;
    }
    case 'crawl': {
      // Ползёт к воде — всё ещё открыта.
      m.data.ghost = 0;
      if (m.t < dt * 1.5 || !(m.data.wx > 0)) {
        const w = nearestCell(sim, lake, m.x, m.y);
        if (w) {
          m.data.wx = w[0];
          m.data.wy = w[1];
        }
      }
      if (wet) {
        sim.events.push({ t: 'boss', what: 'f3_dive' });
        api.setMode(m, 'swim');
        return;
      }
      const l = Math.hypot(m.data.wx - m.x, m.data.wy - m.y);
      if (l > 0.1) api.steer(sim, m, (m.data.wx - m.x) / l, (m.data.wy - m.y) / l, 2.6 * haste, dt);
      // Застряла (столб, край) — прыгает в воду.
      if (m.t > 3.2) {
        const w = nearestCell(sim, lake, m.x, m.y);
        if (w) startLeap(sim, m, api, w[0], w[1], false);
      }
      return;
    }
    case 'tail': {
      // К кромке у героя — и хвостом волной.
      m.data.ghost = 1;
      const t = nearestCell(sim, lake, h.x, h.y);
      if (t && m.t < 1.4) {
        const l = Math.hypot(t[0] - m.x, t[1] - m.y);
        if (l > 0.4) {
          api.steer(sim, m, (t[0] - m.x) / l, (t[1] - m.y) / l, 7 * haste, dt);
          return;
        }
      }
      m.vx *= 0.5;
      m.vy *= 0.5;
      api.setMode(m, 'surface');
      m.data.ang = Math.atan2(h.y - m.y, h.x - m.x);
      api.strike(sim, {
        shape: 'cone',
        x: m.x,
        y: m.y,
        r: 6.5,
        ang: m.data.ang,
        arc: 1.1,
        warn: 0.85 / haste,
        dmg: m.dmg * 1.15,
        knock: 10,
        status: 'slow',
        dur: 2.2,
        art: 'f3_wave',
        from: m.id,
      });
      return;
    }
    case 'surface':
      // Вынырнула у кромки: замах хвостом, потом удар волной. Открыта.
      m.data.ghost = 0;
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = m.data.ang;
      if (m.t > 1.55 / haste) api.setMode(m, 'swim');
      return;
    case 'spit': {
      // Далеко от воды не отсидеться: плевки навесом, вяжут.
      m.data.ghost = 0;
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = Math.atan2(dy, dx);
      const wind = 0.6 / haste;
      if (m.t >= wind && !m.data.spat) {
        m.data.spat = 1;
        const n = ph >= 2 ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const a = sim.rng() * Math.PI * 2;
          const off = i === 0 ? 0 : 1.6;
          api.shoot(
            sim,
            m,
            Math.atan2(dy, dx),
            SPIT,
            h.x + Math.cos(a) * off,
            h.y + Math.sin(a) * off,
          );
        }
      }
      if (m.t > wind + 0.5) {
        m.data.spat = 0;
        api.setMode(m, 'swim');
      }
      return;
    }
    default:
      if (m.mode !== 'dying') api.setMode(m, wet ? 'swim' : 'crawl');
  }
}

registerBrain('f3_maw', { raw: true, step: mawStep });

registerBoss('f3_maw', {
  start(sim, b, lead) {
    b.data.floodAt = -1;
    lead.data.ghost = 0;
    ebb(sim);
    stateOf(sim);
  },
  step(sim, b, _dt, api) {
    const lead = sim.mobs.find((m) => m.kind === 'f3_maw' && m.mode !== 'dying');
    if (!lead) return;
    const k = lead.hp / lead.maxHp;
    if (b.phase === 0 && k < 0.62) {
      b.phase = 1;
      b.data.floodAt = b.t + 1.8;
      b.data.floodT = 0;
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ПРИЛИВ',
        sub: 'вода поднимается — уходи с отмели',
      });
      // Отмель, которую зальёт, видна заранее.
      const tide = tideOf(sim, b);
      const cx = lead.x;
      const cy = lead.y;
      const z: F3Zone = {
        x: cx,
        y: cy,
        r: 0.1,
        life: 2.6,
        art: 'f3_tide',
        cells: tide.cells,
        ww: sim.world.w,
      };
      api.zone(sim, z);
    }
    if (b.phase === 1 && k < 0.3) {
      b.phase = 2;
      sim.events.push({ t: 'boss', what: 'phase', text: 'ГОЛОД', sub: 'прыгает без передышки' });
    }
    if (b.phase >= 1 && b.data.floodAt >= 0 && b.t >= b.data.floodAt) {
      b.data.floodT = (b.data.floodT || 0) - _dt;
      if (b.data.floodT <= 0) {
        b.data.floodT = 0.09;
        flood(sim, b, 3);
      }
    }
  },
  onPartDown(sim) {
    ebb(sim);
    return false;
  },
  reset(sim) {
    ebb(sim);
  },
});

// ---------------------------------------------------------------------------
// Правила этажа.
//   • Проклятие подъёма («тяга бездны»): кто поднимается к лифту — на юг
//     карты, — копит тягу; чем глубже и чем тяжелее рюкзак, тем быстрее.
//     Колебания туда-сюда в бою не считаются (полоса в 3 клетки). Тяга
//     видна кольцом у ног; с 40% — вязнут ноги, с 75% — холод, полная —
//     приступ (оглушение и немного здоровья, но не смерть). Спадает, когда
//     стоишь или идёшь вглубь, у родника — втрое быстрее.
//   • Омуты: у каждого свой омутник; появляется, когда подходишь, убитый
//     возвращается через 2,5 минуты.
//   • Зов: пересмешник кричит чужим голосом и зажигает ложный огонёк у
//     омута, где ждёт омутник (или просто в стороне) — и ждёт за ним.
// ---------------------------------------------------------------------------

/** Тяга на клетку подъёма при полном рюкзаке на глубине «один слой». */
export const CURSE_RATE = 0.02;
/** Сколько клеток у лифта проклятие не действует. */
export const CURSE_SAFE = 18;
/** Колебания в бою: столько клеток к лифту — бесплатно. */
const CURSE_BAND = 3;
/** Слой бездны — столько клеток глубины. */
const CURSE_LAYER = 90;

/** Насколько полон рюкзак, 0…1: ячейки стопками. */
export function sackFill(sim: Sim): number {
  const s = sim.sack;
  let stacks = 0;
  for (const n of Object.values(s.meat)) if (n) stacks += Math.ceil(n / 32);
  for (const [id, n] of Object.entries(s.mats)) {
    if (!n) continue;
    const per = id.startsWith('ore:') ? 64 : id.startsWith('block:') ? 16 : 32;
    stacks += Math.ceil(n / per);
  }
  const slots = 9 * (1 + clamp(sim.sackLevel, 0, 3));
  return clamp(stacks / slots, 0, 1);
}

/** Глубина героя в слоях бездны (0 — у лифта). */
export function curseLayer(sim: Sim): number {
  const st = stateOf(sim);
  const depth = st.liftY - sim.hero.y;
  return clamp((depth - CURSE_SAFE) / CURSE_LAYER, 0, 2.2);
}

function stepCurse(sim: Sim, st: F3State, dt: number, api: SimApi): void {
  const h = sim.hero;
  const fd = sim.floorData;
  if (fd.lo === undefined) fd.lo = h.y + CURSE_BAND;
  let strain = fd.strain || 0;
  const fight = sim.boss?.state === 'fight';
  let ascent = 0;
  if (h.y > fd.lo) {
    ascent = h.y - fd.lo;
    fd.lo = h.y;
  } else fd.lo = Math.min(fd.lo, h.y + CURSE_BAND);
  if (heroDown(sim) || fight) ascent = 0;
  const layer = curseLayer(sim);
  if (ascent > 0 && layer > 0) {
    const load = sackFill(sim);
    strain += ascent * CURSE_RATE * (0.3 + 0.7 * load) * layer;
  } else {
    const spring = st.springs.some((s) => Math.hypot(s.x - h.x, s.y - h.y) < 1.8);
    const still = Math.hypot(h.vx, h.vy) < 0.4;
    strain -= dt * (spring ? 0.6 : still ? 0.14 : 0.05);
  }
  strain = clamp(strain, 0, 1);
  if (!heroDown(sim)) {
    if (strain > 0.4) api.heroStatus(sim, 'slow', 0.35, 0.22);
    if (strain > 0.75) api.heroStatus(sim, 'chill', 0.35, 0.28);
    if (strain > 0.35 && !fd.warned) {
      fd.warned = 1;
      sim.events.push({
        t: 'boss',
        what: 'f3_curse',
        text: 'ТЯГА БЕЗДНЫ',
        sub: 'подъём с грузом тяжелеет — передохни, у родника быстрее',
      });
    }
    if (strain >= 1) {
      // Приступ: ноги подкосились. Больно, но не насмерть.
      strain = 0.55;
      api.heroStatus(sim, 'stun', 0.7);
      const dmg = Math.min(h.hp - 1, sim.stats.maxHp * 0.06);
      if (dmg > 0) {
        h.hp -= dmg;
        h.flash = 0.2;
        sim.events.push({ t: 'hurt', x: h.x, y: h.y, dmg: Math.round(dmg) });
      }
      if (sim.time - (fd.fitAt || -99) > 8)
        sim.events.push({
          t: 'boss',
          what: 'f3_curse',
          text: 'ПРИСТУП',
          sub: 'бездна не отпускает — постой, отдышись',
        });
      fd.fitAt = sim.time;
    }
  }
  fd.strain = strain;
  // Кольцо тяги у ног героя — зона без действия, рисует `f3-art`.
  let z = st.curse;
  if (!z || !sim.zones.includes(z)) {
    const zin: F3Zone = { x: h.x, y: h.y, r: 0.1, life: 1e9, art: 'f3_curse', k: strain };
    api.zone(sim, zin);
    z = sim.zones[sim.zones.length - 1];
    st.curse = z;
  }
  z.x = h.x;
  z.y = h.y;
  (z as F3Zone).k = strain;
}

function stepPools(sim: Sim, st: F3State, dt: number, api: SimApi): void {
  st.poolT -= dt;
  if (st.poolT > 0) return;
  st.poolT = 0.5;
  const h = sim.hero;
  if (heroDown(sim) || sim.boss?.state === 'fight') return;
  st.pools.forEach((p, i) => {
    const id = i + 1;
    if ((sim.floorData[`pcd${id}`] ?? 0) > sim.time) return;
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    if (d > 15 || d < 3) return;
    if (sim.mobs.some((m) => m.kind === 'f3_grasp' && m.data.pool === id && m.mode !== 'dying'))
      return;
    const m = api.spawnMob(sim, 'f3_grasp', p.x, p.y, { mode: 'lurk' });
    m.data.pool = id;
    m.data.ghost = 1;
    m.hx = p.x;
    m.hy = p.y;
  });
}

const CALLS = ['«…помоги…»', '«…сюда!..»', '«…я здесь…»', '«…не уходи…»'];

function endLure(sim: Sim, st: F3State): void {
  const L = st.lure;
  if (!L) return;
  L.zone.life = -1;
  const m = sim.mobs.find((x) => x.id === L.mob);
  if (m && m.mode === 'call') m.mode = 'chase';
  st.lure = null;
}

function stepLure(sim: Sim, st: F3State, api: SimApi): void {
  const h = sim.hero;
  const L = st.lure;
  if (L) {
    const bird = sim.mobs.find((m) => m.id === L.mob && m.mode !== 'dying');
    if (!bird || bird.mode !== 'call' || sim.time > L.until || heroDown(sim)) {
      endLure(sim, st);
      return;
    }
    if (Math.hypot(h.x - L.x, h.y - L.y) < 1.7) {
      // Ловушка захлопнулась: огонёк гаснет, птица пикирует, омутник хватает.
      api.setMode(bird, 'aim');
      bird.dir = Math.atan2(h.y - bird.y, h.x - bird.x);
      bird.data.quick = 1;
      if (L.pool > 0) {
        const g = sim.mobs.find(
          (m) => m.kind === 'f3_grasp' && m.data.pool === L.pool && m.mode === 'lurk',
        );
        if (g && Math.hypot(g.x - h.x, g.y - h.y) < 3.6) {
          g.cd = 0;
          api.setMode(g, 'rise');
          g.data.gx = h.x;
          g.data.gy = h.y;
        }
      }
      sim.events.push({ t: 'boss', what: 'f3_trap', text: 'ЗАСАДА', sub: 'голос был чужой' });
      endLure(sim, st);
    }
    return;
  }
  if (sim.time < st.nextLure || heroDown(sim) || sim.boss?.state === 'fight') return;
  st.nextLure = sim.time + 1;
  const bird = sim.mobs.find(
    (m) =>
      m.kind === 'f3_mocker' &&
      m.mode === 'chase' &&
      m.cd <= 0 &&
      Math.hypot(m.x - h.x, m.y - h.y) > 3 &&
      Math.hypot(m.x - h.x, m.y - h.y) < 11,
  );
  if (!bird) return;
  // Где звать: у омута, где сидит омутник, — иначе в стороне, на полу.
  let spot: [number, number] | null = null;
  let pool = 0;
  st.pools.forEach((p, i) => {
    if (spot) return;
    if (Math.hypot(p.x - h.x, p.y - h.y) > 10) return;
    const g = sim.mobs.find(
      (m) => m.kind === 'f3_grasp' && m.data.pool === i + 1 && m.mode === 'lurk',
    );
    if (!g) return;
    // Суша у самой воды, ближе к герою.
    let best: [number, number] | null = null;
    let bd = 1e9;
    for (const c of p.body) {
      const x = c % sim.world.w;
      const y = Math.floor(c / sim.world.w);
      for (const [ddx, ddy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + ddx;
        const ny = y + ddy;
        if (api.solidTile(sim, nx, ny)) continue;
        const d = Math.hypot(nx + 0.5 - h.x, ny + 0.5 - h.y);
        // В круге фонаря героя: огонёк рисуется под темнотой (свою лампу
        // зоне движок не даёт), дальше фонаря его не видно.
        if (d > 2.5 && d < 5.5 && d < bd) {
          bd = d;
          best = [nx + 0.5, ny + 0.5];
        }
      }
    }
    if (best) {
      spot = best;
      pool = i + 1;
    }
  });
  if (!spot) {
    for (let k = 0; k < 16 && !spot; k++) {
      // Впереди-вверху: камера показывает над героем больше, чем под ним.
      const a = -Math.PI / 2 + (sim.rng() - 0.5) * 2.2;
      const r = 3.8 + sim.rng() * 1.5;
      const x = h.x + Math.cos(a) * r;
      const y = h.y + Math.sin(a) * r;
      if (api.solidTile(sim, Math.floor(x), Math.floor(y))) continue;
      const f = sim.flow[Math.floor(y) * sim.world.w + Math.floor(x)];
      if (f < 0 || f > 12) continue;
      spot = [Math.floor(x) + 0.5, Math.floor(y) + 0.5];
    }
  }
  if (!spot) return;
  const [x, y] = spot;
  api.zone(sim, { x, y, r: 0.6, life: 10, art: 'f3_lure' });
  const zone = sim.zones[sim.zones.length - 1];
  st.lure = { zone, x, y, mob: bird.id, pool, until: sim.time + 10 };
  api.setMode(bird, 'call');
  bird.data.lx = x;
  bird.data.ly = y;
  st.nextLure = sim.time + 26 + sim.rng() * 14;
  sim.events.push({
    t: 'boss',
    what: 'f3_call',
    text: CALLS[Math.floor(sim.rng() * CALLS.length)],
    sub: 'голос из темноты',
  });
}

registerFloor(3, {
  start(sim) {
    const st = stateOf(sim);
    sim.floorData.lo = sim.hero.y + CURSE_BAND;
    sim.floorData.strain = 0;
    st.nextLure = 18 + sim.rng() * 10;
  },
  step(sim, dt, api) {
    const st = stateOf(sim);
    stepCurse(sim, st, dt, api);
    stepPools(sim, st, dt, api);
    stepLure(sim, st, api);
    // Бой кончился (победа, отдых) — вода арены отступает.
    if (sim.boss && sim.boss.state !== 'fight' && st.tide?.n) ebb(sim);
  },
});
