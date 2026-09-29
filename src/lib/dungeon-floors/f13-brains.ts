// Этаж 13 «Город за стенами» — ИИ исполинов и их свиты, сценарий Колосса,
// правила этажа и действия этажа (крюк, пушка, валун, набат).
//
// ГЛАГОЛ — ИСПОЛИНЫ И КРЮКИ.
//   • Исполин поворачивается медленно и ходит только вперёд. Удар по нему
//     решает УГОЛ: в затылок (герой за спиной) — втрое, в бок — вполсилы, в
//     лоб — десятая доля (`giantHit`). Когда герой за спиной, затылок
//     светится (`m.data.back`, рисует `f13-art.ts`). Два удара в затылок —
//     исполин разворачивается с размаху (удар по кругу за спиной) — вовремя
//     отойди. Пушка валит исполина, лёжа он открыт со всех сторон.
//   • Крюк — действие у столба-якоря (`FloorScript.onUse`): столб выносит к
//     своему кольцу за провал или на Стену, столб у исполинов — за спину
//     ближнему исполину. В полёте героя не достать. Над провалом и Стеной
//     трос несёт героя своим полётом (`api.pullHero` упирается в край
//     глубины как в стену — см. отчёт этажа), по земле — `api.pullHero` с
//     поворотом цели по дуге.
//
// Правила этажа (`registerFloor(13)`):
//   • ПОСТЫ: исполины стоят на своих местах (метки 1…6) и встают, когда
//     герой подходит; убитый не встаёт до конца вылазки;
//   • ДЕЙСТВИЯ: крюк, пушка (линия по полосе, валит исполинов, мелочь
//     насмерть), валун (заваливает Пролом), набат (волна глушит мелочь);
//   • ЗАЛЫ-СОБЫТИЯ: «Пожар» и «Шествие» (Внешний район), «Пролом» и
//     «Батарея» (Стена), «Колокол тревоги» и «Разлом» (Площадь колокола);
//   • ИСПАРЕНИЕ: убитый исполин парит остовом, вороны слетаются;
//   • ПОДСКАЗКИ: первый удар в лоб и первый удар в затылок — надписью.
//
// Честность: всё, что бьёт, видно заранее — конус ладони, кольцо топота,
// тень хвата, дуга разворота, линия тарана и броска, метка прыжка, кольцо
// осколков, метки обломков и пушки.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { BRAINS, registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';

/**
 * Зона-картинка со своими полями для рисовальщика: трос (куда), след
 * полёта, линия пушки, чей удар. Движок копирует лишние поля как есть.
 */
export type ZX = ZoneIn & {
  tx?: number;
  ty?: number;
  mob?: number;
  ang?: number;
  len?: number;
  k?: number;
  seed?: number;
};
import type { BossFight, Mob, Sim } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F13_BELL, F13_GIANTS, F13_MARK, F13_OUTER, F13_POSTS, F13_WALL } from './f13';
import { F13_HOOKS } from './f13-map';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: значениями движок не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_RUBBLE = 9;
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

/** Урон, который после брони героя станет долей его здоровья. */
const rawShare = (sim: Sim, share: number) =>
  (sim.stats.maxHp * share * (100 + Math.max(0, sim.stats.armor))) / 100;

/** Попал ли удар вплотную: рывок, крюк и неуязвимость спасают. */
const canHurt = (sim: Sim) =>
  sim.hero.inv <= 0 && sim.hero.mode !== 'dash' && !sim.hero.pull && !heroDown(sim);

const tileAt = (sim: Sim, x: number, y: number): number => {
  const w = sim.world;
  if (x < 0 || y < 0 || x >= w.w || y >= w.h) return T_WALL;
  return sim.tiles[y * w.w + x];
};


const walkable = (t: number) => t === T_FLOOR || t === T_HAZARD || (t >= 3 && t <= 5) || t === 10;

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

/** Сколько клеток до преграды по направлению (стена или глубина). */
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

/** Круг тела встаёт в точку: клетка и её соседи — пол. */
function roomFor(sim: Sim, api: SimApi, x: number, y: number, r: number): boolean {
  const pts = [
    [x, y],
    [x + r, y],
    [x - r, y],
    [x, y + r],
    [x, y - r],
  ];
  return pts.every(([px, py]) => !api.solidTile(sim, Math.floor(px), Math.floor(py)));
}

/** Отдых после удара: гасит скорость, потом снова в погоню. */
function recoverStep(m: Mob, api: SimApi, T: number, next = 'stalk'): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.t > T) api.setMode(m, next);
}

/** Одна зона-картинка (без действия) — вспышка, пар, пыль. */
function puff(api: SimApi, sim: Sim, art: string, x: number, y: number, r: number, life: number, above = false): void {
  api.zone(sim, { x, y, r, life, art, above });
}

/** Черновик визуала этажа: общий на кадр (рисовальщик читает). */
export const F13_FX = {
  /** Время последнего залпа пушки (performance, с) — дым над Стеной. */
  cannon: -9,
};

// ---------------------------------------------------------------------------
// Исполины: затылок, поворот, ход вперёд, удары.
// ---------------------------------------------------------------------------

/** Числа исполинов: поворот (рад/с), множители удара по углу. */
export interface GiantSpec {
  turn: number;
  back: number;
  side: number;
  front: number;
  /** Лёжа (пушка, набат) — со всех сторон. */
  down: number;
  /** Сколько ударов в затылок до разворота с размаху. */
  naps: number;
}

export const GIANT: Record<string, GiantSpec> = {
  f13_walker: { turn: 1.5, back: 3, side: 0.5, front: 0.1, down: 2.2, naps: 2 },
  f13_climber: { turn: 2, back: 3, side: 0.55, front: 0.12, down: 2.2, naps: 2 },
  f13_thrower: { turn: 1.4, back: 3, side: 0.5, front: 0.1, down: 2.2, naps: 2 },
  f13_armored: { turn: 1.2, back: 2.3, side: 0.25, front: 0, down: 2.6, naps: 3 },
  f13_abnormal: { turn: 3.4, back: 3, side: 0.6, front: 0.1, down: 2.2, naps: 2 },
  f13_crystal: { turn: 2.8, back: 3, side: 0.5, front: 0.12, down: 2.2, naps: 1 },
  f13_crawler: { turn: 4, back: 2.5, side: 1, front: 0.25, down: 2, naps: 3 },
};

/** Откуда пришёл удар по мобу: 'back' — герой за спиной. */
export function napeSide(m: Mob, ang: number): 'back' | 'side' | 'front' {
  const off = Math.abs(angDiff(ang, m.face));
  return off < 1.05 ? 'back' : off > 2.1 ? 'front' : 'side';
}

/** Где герой относительно взгляда моба: 0 — прямо перед ним, π — за спиной. */
const heroRel = (sim: Sim, m: Mob) =>
  Math.abs(angDiff(Math.atan2(sim.hero.y - m.y, sim.hero.x - m.x), m.face));

function turnTo(m: Mob, a: number, rate: number, dt: number): void {
  const d = angDiff(a, m.face);
  const s = rate * dt;
  m.face += clamp(d, -s, s);
}

/** Шаг вперёд — туда, куда смотрит; боком и задом исполин не ходит. */
function stride(m: Mob, want: number, speed: number, turn: number, dt: number): void {
  turnTo(m, want, turn, dt);
  const al = Math.cos(angDiff(want, m.face));
  const v = speed * Math.max(0.1, al);
  const k = Math.min(1, dt * 6);
  m.vx += (Math.cos(m.face) * v - m.vx) * k;
  m.vy += (Math.sin(m.face) * v - m.vy) * k;
}

/** Исполин — стена из мяса: героя выталкивает (рывком — между ног). */
function shoulder(sim: Sim, m: Mob): void {
  const h = sim.hero;
  if (h.mode === 'dash' || h.pull || heroDown(sim) || h.r < 0.05) return;
  const dx = h.x - m.x;
  const dy = h.y - m.y;
  const d = hypot(dx, dy);
  const min = m.r * 0.9 + h.r;
  if (d < min && d > 1e-4) {
    h.x = m.x + (dx / d) * min;
    h.y = m.y + (dy / d) * min;
  }
}

/** Удар клинка по исполину: угол решает (и свечение, и подсказки). */
function giantHit(sim: Sim, m: Mob, ang: number): number {
  const g = GIANT[m.kind] ?? GIANT.f13_walker;
  if (m.mode === 'down' || m.mode === 'getup') {
    m.data.cut = 0.3;
    return g.down;
  }
  const side = napeSide(m, ang);
  if (side === 'back') {
    m.data.cut = 0.3;
    m.data.naped = (m.data.naped ?? 0) + 1;
    hint(sim, 'nape');
    return g.back;
  }
  if (side === 'front') hint(sim, 'front');
  return side === 'side' ? g.side : g.front;
}

/** Один раз за вылазку — подсказка надписью (лоб не берёт / затылок). */
function hint(sim: Sim, what: 'front' | 'nape'): void {
  const key = what === 'front' ? 'hintFront' : 'hintNape';
  if (sim.floorData[key]) return;
  sim.floorData[key] = 1;
  if (what === 'front')
    sim.events.push({
      t: 'boss',
      what: 'f13_hint',
      text: 'ЛОБ НЕ БЕРЁТ',
      sub: 'зайди за спину — бей в затылок',
    });
  else
    sim.events.push({ t: 'boss', what: 'f13_nape', text: 'В ЗАТЫЛОК!', sub: 'втрое сильнее' });
}

/** Общий черновик исполина на кадр: затылок, счётчики. */
function giantTick(sim: Sim, m: Mob, dt: number): void {
  const h = sim.hero;
  m.data.cut = Math.max(0, (m.data.cut ?? 0) - dt);
  const d = hypot(h.x - m.x, h.y - m.y);
  // Затылок светится, когда герой за спиной и близко: видно, куда бить.
  m.data.back = !heroDown(sim) && d < 5.5 && heroRel(sim, m) > 2.0 ? 1 : 0;
  m.data.gCd = (m.data.gCd ?? 0) - dt;
  m.data.spinCd = (m.data.spinCd ?? 0) - dt;
  if (m.data.back && d < 3.2) m.data.behind = (m.data.behind ?? 0) + dt;
  else m.data.behind = Math.max(0, (m.data.behind ?? 0) - dt * 2);
}

export const SWIPE = { r: 3, arc: 1.8, warn: 0.85, dmg: 1.3 };
export const STOMP = { r: 1.7, w: 0.75, warn: 0.8, dmg: 1.1 };
export const GRAB = { r: 0.95, warn: 1, dmg: 1.5 };
export const SPIN = { r: 3, arc: 2.4, warn: 0.6, dmg: 1.2 };

/** Хлопок ладонью: конус перед собой. */
function swipeStep(sim: Sim, m: Mob, api: SimApi, scale = 1): boolean {
  m.vx *= 0.7;
  m.vy *= 0.7;
  const T = SWIPE.warn * scale;
  if (!m.data.lit) {
    m.data.lit = 1;
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: SWIPE.r * (m.r / 0.8) ** 0.5,
      ang: m.face,
      arc: SWIPE.arc,
      warn: T,
      dmg: m.dmg * SWIPE.dmg,
      knock: 7,
      art: 'f13_palm',
      from: m.id,
    });
  }
  if (m.t > T - 0.25) m.danger = SWIPE.r + 0.6;
  if (m.t >= T) {
    m.data.lit = 0;
    sim.events.push({ t: 'shake', k: 0.18 });
    return true;
  }
  return false;
}

/** Топот: кольцо вокруг ног (вплотную к ногам и снаружи — чисто). */
function stompStep(sim: Sim, m: Mob, api: SimApi, scale = 1): boolean {
  m.vx *= 0.7;
  m.vy *= 0.7;
  const T = STOMP.warn * scale;
  const k = m.r / 0.8;
  if (!m.data.lit) {
    m.data.lit = 1;
    api.strike(sim, {
      shape: 'ring',
      x: m.x,
      y: m.y,
      r: STOMP.r * k,
      w: STOMP.w * k,
      warn: T,
      dmg: m.dmg * STOMP.dmg,
      knock: 6,
      art: 'f13_stomp',
      from: m.id,
    });
  }
  if (m.t > T - 0.25) m.danger = (STOMP.r + STOMP.w) * k + 0.4;
  if (m.t >= T) {
    m.data.lit = 0;
    sim.events.push({ t: 'shake', k: 0.3 });
    puff(api, sim, 'f13_dust', m.x, m.y, 2.4 * k, 0.7);
    return true;
  }
  return false;
}

/** Хват: тень ладони на герое, потом рука падает. */
function grabStep(sim: Sim, m: Mob, api: SimApi): boolean {
  m.vx *= 0.7;
  m.vy *= 0.7;
  const h = sim.hero;
  if (!m.data.lit) {
    m.data.lit = 1;
    m.data.gx = h.x;
    m.data.gy = h.y;
    api.strike(sim, {
      shape: 'circle',
      x: h.x,
      y: h.y,
      r: GRAB.r,
      warn: GRAB.warn,
      dmg: m.dmg * GRAB.dmg,
      knock: 2,
      status: 'stun',
      dur: 0.6,
      art: 'f13_grab',
      from: m.id,
    });
  }
  m.face = Math.atan2(m.data.gy - m.y, m.data.gx - m.x);
  if (m.t > GRAB.warn - 0.25)
    m.danger = hypot(m.data.gx - m.x, m.data.gy - m.y) + GRAB.r + 0.3;
  if (m.t >= GRAB.warn) {
    m.data.lit = 0;
    return true;
  }
  return false;
}

/** Разворот с размаху: дуга за спиной, потом лицом к герою. */
function spinStep(sim: Sim, m: Mob, api: SimApi): boolean {
  m.vx *= 0.7;
  m.vy *= 0.7;
  const k = (m.r / 0.8) ** 0.5;
  if (!m.data.lit) {
    m.data.lit = 1;
    m.data.sa = m.face + Math.PI;
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: SPIN.r * k,
      ang: m.data.sa,
      arc: SPIN.arc,
      warn: SPIN.warn,
      dmg: m.dmg * SPIN.dmg,
      knock: 8,
      art: 'f13_backhand',
      from: m.id,
    });
  }
  if (m.t > SPIN.warn - 0.25) m.danger = SPIN.r * k + 0.5;
  if (m.t >= SPIN.warn) {
    // Развернулся: теперь смотрит туда, где был затылок.
    const f = m.data.sa;
    m.face += angDiff(f, m.face) * Math.min(1, (m.t - SPIN.warn) / 0.35);
    if (m.t >= SPIN.warn + 0.35) {
      m.face = f;
      m.data.lit = 0;
      m.data.naped = 0;
      m.data.behind = 0;
      return true;
    }
  }
  return false;
}

/** Лежит (пушка, набат): открыт со всех сторон, встаёт через `T`. */
function downStep(sim: Sim, m: Mob, api: SimApi): void {
  m.vx *= 0.8;
  m.vy *= 0.8;
  m.tele = null;
  m.danger = 0;
  if (m.mode === 'down' && m.t > (m.data.downT ?? 2.8)) api.setMode(m, 'getup');
  else if (m.mode === 'getup' && m.t > 0.6) api.setMode(m, 'stalk');
  void sim;
}

/** Уложить исполина (пушка): полежит и встанет. */
export function knockDown(sim: Sim, m: Mob, api: SimApi, T = 2.8): void {
  if (!F13_GIANTS.has(m.kind) || m.mode === 'dying' || m.kind === 'f13boss') return;
  api.setMode(m, 'down');
  m.data.downT = T;
  m.data.lit = 0;
  m.tele = null;
  m.danger = 0;
  sim.events.push({ t: 'shake', k: 0.35 });
  puff(api, sim, 'f13_dust', m.x, m.y + 0.3, 2.2, 0.9);
}

/** Дом исполина — его пост: дальше `leash` клеток не уходит. */
function homeOf(m: Mob): [number, number] {
  return [m.data.px ?? m.hx, m.data.py ?? m.hy];
}

/**
 * Общий ход исполина: бродит у поста, видит — идёт, выбирает удар.
 * `pick` — свой выбор удара вида (вернуть режим или null).
 */
function giantStalk(
  sim: Sim,
  m: Mob,
  dt: number,
  c: BrainCtx,
  api: SimApi,
  pick: (rel: number) => string | null,
): void {
  const h = sim.hero;
  const g = GIANT[m.kind] ?? GIANT.f13_walker;
  const [hx, hy] = homeOf(m);
  const fromHome = hypot(m.x - hx, m.y - hy);
  const see = c.dist < 11 && api.lineOfSight(sim, m.x, m.y, h.x, h.y);
  const leash = m.data.leash ?? 16;
  if (m.mode === 'wander') {
    if (see && c.dist < 8.5) {
      api.setMode(m, 'stalk');
      sim.events.push({ t: 'boss', what: 'f13_notice' });
      return;
    }
    // Бродит у поста: цель — точка в пяти клетках, меняется раз в 4–7 с.
    if (!m.data.wx || m.t > (m.data.wt ?? 5)) {
      const a = sim.rng() * TAU;
      const r = 1 + sim.rng() * 4;
      const tx = hx + Math.cos(a) * r;
      const ty = hy + Math.sin(a) * r;
      if (roomFor(sim, api, tx, ty, m.r)) {
        m.data.wx = tx;
        m.data.wy = ty;
      } else {
        m.data.wx = hx;
        m.data.wy = hy;
      }
      m.data.wt = 4 + sim.rng() * 3;
      m.t = 0;
    }
    const dx = m.data.wx - m.x;
    const dy = m.data.wy - m.y;
    if (hypot(dx, dy) > 0.6) stride(m, Math.atan2(dy, dx), m.speed * 0.45, g.turn * 0.6, dt);
    else {
      m.vx *= 0.8;
      m.vy *= 0.8;
    }
    return;
  }
  if (m.mode === 'home') {
    const dx = hx - m.x;
    const dy = hy - m.y;
    if (hypot(dx, dy) < 1.5) {
      api.setMode(m, 'wander');
      return;
    }
    if (see && c.dist < 5) {
      api.setMode(m, 'stalk');
      return;
    }
    const [cx, cy] = clearLine(sim, api, m.x, m.y, hx, hy)
      ? [dx / (hypot(dx, dy) || 1), dy / (hypot(dx, dy) || 1)]
      : [dx / (hypot(dx, dy) || 1), dy / (hypot(dx, dy) || 1)];
    stride(m, Math.atan2(cy, cx), m.speed * 0.7, g.turn, dt);
    return;
  }
  // stalk: к герою, лицом к нему.
  if (fromHome > leash && c.dist > 6) {
    api.setMode(m, 'home');
    return;
  }
  if (!see && c.dist > 14) {
    api.setMode(m, 'home');
    return;
  }
  const rel = heroRel(sim, m);
  // Долго за спиной или два удара в затылок — разворот с размаху.
  if (
    m.data.spinCd <= 0 &&
    ((m.data.naped ?? 0) >= g.naps || (m.data.behind ?? 0) > 2.2) &&
    c.dist < 3.6
  ) {
    api.setMode(m, 'spin');
    m.data.spinCd = 3;
    return;
  }
  if (m.cd <= 0 && see) {
    const next = pick(rel);
    if (next) {
      api.setMode(m, next);
      m.data.lit = 0;
      return;
    }
  }
  const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
  const near = c.dist < m.r + 1.2;
  stride(m, Math.atan2(cy, cx), near ? 0 : m.speed, g.turn, dt);
}

/** Общий выбор удара шагающего исполина. */
function walkerPick(sim: Sim, m: Mob, c: BrainCtx, rel: number): string | null {
  const k = m.r / 0.8;
  if (rel < 0.9 && c.dist < 3 * k + 0.2) return 'swipe';
  if (rel >= 0.9 && c.dist < (STOMP.r + STOMP.w) * k + 0.1) return 'stomp';
  if (rel < 0.8 && c.dist > 3.2 && c.dist < 5.4 && m.data.gCd <= 0) {
    m.data.gCd = 6 + sim.rng() * 3;
    return 'grab';
  }
  return null;
}

/** Общий шаг ударов исполина (режимы swipe, stomp, grab, spin, down). */
function giantMoves(sim: Sim, m: Mob, api: SimApi, rest: number): boolean {
  switch (m.mode) {
    case 'swipe':
      if (swipeStep(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = rest;
      }
      return true;
    case 'stomp':
      if (stompStep(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = rest * 0.9;
      }
      return true;
    case 'grab':
      if (grabStep(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = rest * 1.1;
      }
      return true;
    case 'spin':
      if (spinStep(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = rest * 0.6;
      }
      return true;
    case 'recover':
      recoverStep(m, api, 0.75);
      return true;
    case 'down':
    case 'getup':
      downStep(sim, m, api);
      return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Бродячий исполин: ладонь, топот, хват, разворот. Шествие — строем.
// ---------------------------------------------------------------------------

registerBrain('f13_walker', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    shoulder(sim, m);
    m.tele = null;
    m.danger = 0;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    if (m.mode === 'march') {
      marchStep(sim, m, dt, c, api);
      return;
    }
    if (giantMoves(sim, m, api, 1.2)) return;
    if (m.mode === 'chase' || m.mode === 'alert' || m.mode === 'stun') api.setMode(m, 'stalk');
    if (m.mode !== 'wander' && m.mode !== 'stalk' && m.mode !== 'home') api.setMode(m, 'stalk');
    giantStalk(sim, m, dt, c, api, (rel) => walkerPick(sim, m, c, rel));
  },
  onHit(sim, m, hit) {
    return giantHit(sim, m, hit.ang);
  },
  onDeath(sim, m, _mode, api) {
    giantDeath(sim, m, api);
  },
});

/** Шествие: идёт строем на юг проспекта, топает, вплотную — ладонь. */
function marchStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const g = GIANT.f13_walker;
  const tx = m.data.mx ?? m.x;
  const ty = m.data.my ?? m.y + 20;
  const dx = tx - m.x;
  const dy = ty - m.y;
  m.data.st = (m.data.st ?? 1) - dt;
  if (hypot(dx, dy) < 1.2) {
    // Дошёл до конца проспекта — теперь охотится.
    api.setMode(m, 'stalk');
    m.data.leash = 22;
    return;
  }
  const rel = heroRel(sim, m);
  if (rel < 0.8 && c.dist < 3 && m.cd <= 0) {
    api.setMode(m, 'swipe');
    m.data.lit = 0;
    return;
  }
  if (m.data.st <= 0) {
    m.data.st = 2.4;
    // Топот на ходу: кольцо, в нишах не достаёт.
    api.strike(sim, {
      shape: 'ring',
      x: m.x,
      y: m.y,
      r: 2,
      w: 0.8,
      warn: 0.75,
      dmg: m.dmg * 0.9,
      knock: 5,
      art: 'f13_stomp',
      from: m.id,
    });
  }
  stride(m, Math.atan2(dy, dx), m.speed * 0.8, g.turn, dt);
}

/** Исполин пал: остов парит, вороны слетаются. */
function giantDeath(sim: Sim, m: Mob, api: SimApi): void {
  const big = m.kind === 'f13boss';
  api.zone(sim, {
    x: m.x,
    y: m.y,
    r: big ? 3.4 : 1.6 * (m.r / 0.8),
    life: big ? 9 : 4.5,
    art: big ? 'f13_evapbig' : 'f13_evap',
  });
  sim.events.push({ t: 'boss', what: 'f13_evap' });
  const st = STATE.get(sim);
  if (st) st.kills += 1;
}

// ---------------------------------------------------------------------------
// Стенолаз: лезет через зубцы Стены (руки на камне — видно заранее), дальше
// — как бродячий, только проворнее.
// ---------------------------------------------------------------------------

export const CLIMB = { hands: 1.8 };

registerBrain('f13_climber', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    m.tele = null;
    m.danger = 0;
    if (m.mode === 'climb') {
      // Висит на зубцах: только руки над камнем, достать нельзя.
      m.data.ghost = 1;
      m.vx = 0;
      m.vy = 0;
      m.face = -Math.PI / 2;
      if (m.t > CLIMB.hands) {
        m.data.ghost = 0;
        m.y -= 1.3;
        api.collide(sim, m);
        api.setMode(m, 'stalk');
        sim.events.push({ t: 'shake', k: 0.2 });
        puff(api, sim, 'f13_dust', m.x, m.y + 0.4, 1.4, 0.6);
      }
      return;
    }
    shoulder(sim, m);
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    if (giantMoves(sim, m, api, 1)) return;
    if (m.mode !== 'wander' && m.mode !== 'stalk' && m.mode !== 'home') api.setMode(m, 'stalk');
    giantStalk(sim, m, dt, c, api, (rel) => walkerPick(sim, m, c, rel));
  },
  onHit(sim, m, hit) {
    return giantHit(sim, m, hit.ang);
  },
  onDeath(sim, m, _mode, api) {
    giantDeath(sim, m, api);
  },
});

// ---------------------------------------------------------------------------
// Метатель: держит дистанцию и бросает глыбы навесом (метка падения, щебень
// замедляет). Раз в три броска — горсть камней веером. Вплотную — топот.
// ---------------------------------------------------------------------------

export const THROW = { windup: 1.1, keep: [5, 10] as const, volley: 3 };

registerBrain('f13_thrower', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    shoulder(sim, m);
    m.tele = null;
    m.danger = 0;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    const h = sim.hero;
    if (m.mode === 'throw') {
      m.vx *= 0.7;
      m.vy *= 0.7;
      turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), 2, dt);
      if (m.t >= THROW.windup) {
        const n = (m.data.thr = (m.data.thr ?? 0) + 1);
        const volley = n % THROW.volley === 0;
        // Упреждение: туда, куда герой идёт.
        const tx = h.x + h.vx * 0.35;
        const ty = h.y + h.vy * 0.35;
        const a = Math.atan2(ty - m.y, tx - m.x);
        if (volley) {
          for (let i = -1; i <= 1; i++) {
            const aa = a + i * 0.32;
            const d = hypot(tx - m.x, ty - m.y);
            api.shoot(
              sim,
              m,
              aa,
              {
                speed: 7.5,
                r: 0.55,
                life: 3,
                dmg: 0.7,
                art: 'f13_pebble',
                lob: true,
                onLand: { r: 0.8, life: 2.2, slow: 0.7, art: 'f13_rubble' },
              },
              m.x + Math.cos(aa) * d,
              m.y + Math.sin(aa) * d,
            );
          }
        } else
          api.shoot(
            sim,
            m,
            a,
            {
              speed: 7,
              r: 0.85,
              life: 3,
              dmg: 1.15,
              art: 'f13_rock',
              lob: true,
              onLand: { r: 1.2, life: 3, slow: 0.6, art: 'f13_rubble' },
            },
            tx,
            ty,
          );
        api.setMode(m, 'recover');
        m.cd = 1.6 + sim.rng() * 0.8;
      }
      return;
    }
    if (giantMoves(sim, m, api, 1.3)) return;
    if (m.mode !== 'wander' && m.mode !== 'stalk' && m.mode !== 'home') api.setMode(m, 'stalk');
    if (m.mode === 'stalk') {
      // Держит дистанцию: близко — пятится лицом к герою.
      const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y) || c.dist > 4;
      if (c.dist < 2.6 && m.cd <= 0) {
        api.setMode(m, 'stomp');
        m.data.lit = 0;
        return;
      }
      if (m.cd <= 0 && c.dist < 13 && c.dist > 3.2 && see) {
        api.setMode(m, 'throw');
        return;
      }
      if (c.dist < THROW.keep[0]) {
        turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), GIANT.f13_thrower.turn, dt);
        const a = Math.atan2(m.y - h.y, m.x - h.x);
        m.vx += (Math.cos(a) * m.speed * 0.5 - m.vx) * Math.min(1, dt * 5);
        m.vy += (Math.sin(a) * m.speed * 0.5 - m.vy) * Math.min(1, dt * 5);
        return;
      }
    }
    giantStalk(sim, m, dt, c, api, () => null);
  },
  onHit(sim, m, hit) {
    return giantHit(sim, m, hit.ang);
  },
  onDeath(sim, m, _mode, api) {
    giantDeath(sim, m, api);
  },
});

// ---------------------------------------------------------------------------
// Бронированный: спереди броня (удар отбит), с боков — царапина, затылок —
// щель в латах. Таран по линии; о стену — оглушён, латы треснули: открыт.
// ---------------------------------------------------------------------------

export const ARMOR = { aim: 0.95, speed: 9, max: 11, dizzy: 2.2 };

registerBrain('f13_armored', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    shoulder(sim, m);
    m.tele = null;
    m.danger = 0;
    m.bounce = m.mode === 'charge';
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    const h = sim.hero;
    switch (m.mode) {
      case 'aim': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < ARMOR.aim * 0.55) turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), 2.4, dt);
        const len = Math.min(ARMOR.max, clearDist(sim, api, m.x, m.y, m.face, ARMOR.max));
        m.tele = { shape: 'line', r: len, w: m.r, ang: m.face, k: Math.min(1, m.t / ARMOR.aim) };
        if (m.t > ARMOR.aim - 0.25) m.danger = len;
        if (m.t >= ARMOR.aim) {
          api.setMode(m, 'charge');
          m.data.cx = m.x;
          m.data.cy = m.y;
          m.data.hit = 0;
          sim.events.push({ t: 'boss', what: 'f13_charge' });
        }
        return;
      }
      case 'charge': {
        m.vx = Math.cos(m.face) * ARMOR.speed;
        m.vy = Math.sin(m.face) * ARMOR.speed;
        if (!m.data.hit && canHurt(sim) && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.2) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.6, m.x, m.y, 9, m.kind);
        }
        if (hypot(m.x - m.data.cx, m.y - m.data.cy) > ARMOR.max || m.t > 1.6) {
          api.setMode(m, 'recover');
          m.cd = 1.4;
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t > ARMOR.dizzy) {
          api.setMode(m, 'stalk');
          m.cd = 0.6;
        }
        return;
    }
    if (giantMoves(sim, m, api, 1.4)) return;
    if (m.mode !== 'wander' && m.mode !== 'stalk' && m.mode !== 'home') api.setMode(m, 'stalk');
    giantStalk(sim, m, dt, c, api, (rel) => {
      if (rel < 0.6 && c.dist > 3.4 && c.dist < 10 && clearLine(sim, api, m.x, m.y, h.x, h.y))
        return 'aim';
      return walkerPick(sim, m, c, rel);
    });
  },
  onWall(sim, m, _nx, _ny, api) {
    if (m.mode !== 'charge') return;
    api.setMode(m, 'dizzy');
    m.vx = -Math.cos(m.face) * 2;
    m.vy = -Math.sin(m.face) * 2;
    sim.events.push({
      t: 'boss',
      what: 'f13_armor_wall',
      text: 'ЛАТЫ ТРЕСНУЛИ',
      sub: 'бей — он открыт со всех сторон',
    });
    sim.events.push({ t: 'shake', k: 0.45 });
    puff(api, sim, 'f13_dust', m.x, m.y, 2, 0.8);
  },
  onHit(sim, m, hit) {
    if (m.mode === 'dizzy') {
      m.data.cut = 0.3;
      return 2.5;
    }
    return giantHit(sim, m, hit.ang);
  },
  onDeath(sim, m, _mode, api) {
    giantDeath(sim, m, api);
  },
});

// ---------------------------------------------------------------------------
// Аномальный: бежит зигзагом, прыгает с меткой приземления, иногда застывает
// спиной (окно). Чует крюк: прыгает туда, куда тебя несёт трос.
// ---------------------------------------------------------------------------

export const ABNORMAL = { leapAim: 0.75, air: 0.55, twitch: 1.5, kickWarn: 0.55 };

/** Прыгнуть к точке: метка приземления, в воздухе недосягаем. */
export function abnormalLeap(sim: Sim, m: Mob, api: SimApi, tx: number, ty: number, aim = ABNORMAL.leapAim): void {
  if (m.mode === 'dying') return;
  api.setMode(m, 'leapAim');
  m.data.lx = tx;
  m.data.ly = ty;
  m.data.la = aim;
  m.data.lit = 0;
  m.face = Math.atan2(ty - m.y, tx - m.x);
}

registerBrain('f13_abnormal', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    m.danger = 0;
    if (m.mode !== 'leapAim') m.tele = null;
    if (m.mode !== 'air') shoulder(sim, m);
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      m.data.ghost = 0;
      return;
    }
    const h = sim.hero;
    m.data.leapCd = (m.data.leapCd ?? 2) - dt;
    switch (m.mode) {
      case 'leapAim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        const T = m.data.la ?? ABNORMAL.leapAim;
        if (!m.data.lit) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'circle',
            x: m.data.lx,
            y: m.data.ly,
            r: 1.35,
            warn: T + ABNORMAL.air,
            dmg: m.dmg * 1.4,
            knock: 8,
            art: 'f13_land',
            from: m.id,
          });
        }
        if (m.t >= T) {
          api.setMode(m, 'air');
          m.data.sx = m.x;
          m.data.sy = m.y;
          m.data.ghost = 1;
        }
        return;
      }
      case 'air': {
        const k = Math.min(1, m.t / ABNORMAL.air);
        m.x = m.data.sx + (m.data.lx - m.data.sx) * k;
        m.y = m.data.sy + (m.data.ly - m.data.sy) * k;
        m.vx = 0;
        m.vy = 0;
        m.data.z = Math.sin(k * Math.PI);
        if (k >= 1) {
          m.data.ghost = 0;
          m.data.z = 0;
          api.collide(sim, m);
          sim.events.push({ t: 'shake', k: 0.35 });
          puff(api, sim, 'f13_dust', m.x, m.y + 0.2, 1.8, 0.7);
          // Приземлился — иногда застывает спиной: окно для затылка.
          if (sim.rng() < 0.45) {
            api.setMode(m, 'twitch');
            m.data.tf = Math.atan2(h.y - m.y, h.x - m.x) + Math.PI + (sim.rng() - 0.5) * 1.2;
          } else {
            api.setMode(m, 'recover');
            m.cd = 0.7;
          }
          m.data.leapCd = 3 + sim.rng() * 2;
        }
        return;
      }
      case 'twitch':
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face += angDiff(m.data.tf, m.face) * Math.min(1, dt * 8);
        if (m.t > ABNORMAL.twitch) {
          api.setMode(m, 'stalk');
          m.cd = 0.3;
        }
        return;
      case 'kick': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (!m.data.lit) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: 3.2,
            w: 0.55,
            ang: m.face,
            warn: ABNORMAL.kickWarn,
            dmg: m.dmg * 1.25,
            knock: 7,
            art: 'f13_kick',
            from: m.id,
          });
        }
        if (m.t > ABNORMAL.kickWarn - 0.22) m.danger = 3.6;
        if (m.t >= ABNORMAL.kickWarn) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
          m.cd = 1;
        }
        return;
      }
    }
    if (giantMoves(sim, m, api, 1)) return;
    if (m.mode !== 'wander' && m.mode !== 'stalk' && m.mode !== 'home') api.setMode(m, 'stalk');
    if (m.mode === 'stalk' && m.cd <= 0 && m.data.leapCd <= 0 && c.dist > 3 && c.dist < 8.5) {
      if (roomFor(sim, api, h.x, h.y, m.r * 0.8) && clearLine(sim, api, m.x, m.y, h.x, h.y)) {
        abnormalLeap(sim, m, api, h.x, h.y);
        return;
      }
    }
    if (m.mode === 'stalk' && c.dist > 2.5) {
      // Бег зигзагом, рывками.
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      const z = Math.sin(sim.time * 3.1 + m.id) * 0.9;
      const a = Math.atan2(cy, cx) + z;
      stride(m, a, m.speed, GIANT.f13_abnormal.turn, dt);
      return;
    }
    giantStalk(sim, m, dt, c, api, (rel) => {
      if (rel < 0.7 && c.dist < 3.6) return 'kick';
      return walkerPick(sim, m, c, rel);
    });
  },
  onHit(sim, m, hit) {
    if (m.mode === 'air') return 0;
    return giantHit(sim, m, hit.ang);
  },
  onDeath(sim, m, _mode, api) {
    m.data.ghost = 0;
    giantDeath(sim, m, api);
  },
});

// ---------------------------------------------------------------------------
// Кристальная особь: быстрая, пинок линией и мах конусом. Зашёл за спину —
// затвердевает кристаллом (удар отбит), кристалл лопается кольцом осколков,
// и особь на миг голая — вот тогда бей. В своём дворе твердеет чаще.
// ---------------------------------------------------------------------------

export const CRYSTAL = { harden: 1.3, shatterWarn: 0.5, bare: 1.4, cd: 6, cdHome: 3.5 };

registerBrain('f13_crystal', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    shoulder(sim, m);
    m.tele = null;
    m.danger = 0;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    const h = sim.hero;
    m.data.hardCd = (m.data.hardCd ?? 0) - dt;
    const home = hypot(m.x - (m.data.px ?? m.hx), m.y - (m.data.py ?? m.hy)) < 7;
    switch (m.mode) {
      case 'harden':
        m.vx *= 0.6;
        m.vy *= 0.6;
        // Во дворе с кристаллами затягивается.
        if (home) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.015 * dt);
        m.tele = { shape: 'ring', r: 1.9, w: 0.7, k: Math.min(1, m.t / CRYSTAL.harden) };
        if (m.t >= CRYSTAL.harden) {
          api.setMode(m, 'shatter');
          api.strike(sim, {
            shape: 'ring',
            x: m.x,
            y: m.y,
            r: 1.9,
            w: 0.7,
            warn: CRYSTAL.shatterWarn,
            dmg: m.dmg * 1.1,
            knock: 7,
            art: 'f13_shards',
            from: m.id,
          });
        }
        return;
      case 'shatter':
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t > CRYSTAL.shatterWarn - 0.22) m.danger = 2.8;
        if (m.t >= CRYSTAL.shatterWarn) {
          api.setMode(m, 'bare');
          sim.events.push({ t: 'boss', what: 'f13_crystal_stone' });
          sim.events.push({ t: 'flash', color: '#bff4ff', k: 0.3 });
        }
        return;
      case 'bare':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > CRYSTAL.bare) {
          api.setMode(m, 'stalk');
          m.cd = 0.4;
        }
        return;
      case 'kick': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (!m.data.lit) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: 3,
            w: 0.5,
            ang: m.face,
            warn: 0.55,
            dmg: m.dmg * 1.3,
            knock: 7,
            art: 'f13_kick',
            from: m.id,
          });
        }
        if (m.t > 0.33) m.danger = 3.4;
        if (m.t >= 0.55) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
          m.cd = 0.8;
        }
        return;
      }
    }
    // Зашёл за спину — затвердеть (раз в несколько секунд).
    if (
      m.mode !== 'wander' &&
      m.mode !== 'home' &&
      m.data.hardCd <= 0 &&
      ((m.data.behind ?? 0) > 0.45 || (m.data.naped ?? 0) >= 1) &&
      c.dist < 3.2
    ) {
      api.setMode(m, 'harden');
      m.data.hardCd = home ? CRYSTAL.cdHome : CRYSTAL.cd;
      m.data.naped = 0;
      sim.events.push({ t: 'boss', what: 'f13_crystal_stone' });
      return;
    }
    if (giantMoves(sim, m, api, 1.1)) return;
    if (m.mode !== 'wander' && m.mode !== 'stalk' && m.mode !== 'home') api.setMode(m, 'stalk');
    giantStalk(sim, m, dt, c, api, (rel) => {
      if (rel < 0.5 && c.dist > 1.6 && c.dist < 3.2) return 'kick';
      if (rel < 0.9 && c.dist < 2.6) return 'swipe';
      if (rel >= 0.9 && c.dist < 2.3) return 'stomp';
      return null;
    });
    void h;
  },
  onHit(sim, m, hit) {
    if (m.mode === 'harden' || m.mode === 'shatter') return 0;
    if (m.mode === 'bare') {
      m.data.cut = 0.3;
      return 3.5;
    }
    return giantHit(sim, m, hit.ang);
  },
  onDeath(sim, m, _mode, api) {
    giantDeath(sim, m, api);
  },
});

// ---------------------------------------------------------------------------
// Ползун: низкий, на четвереньках, живёт в подвалах, где исполину тесно.
// Рывок линией с укусом; после рывка лежит — окно. Лоб — в броне из черепа.
// ---------------------------------------------------------------------------

export const CRAWL = { aim: 0.55, speed: 8, dur: 0.45 };

registerBrain('f13_crawler', {
  step(sim, m, dt, c, api) {
    giantTick(sim, m, dt);
    m.tele = null;
    m.danger = 0;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    const h = sim.hero;
    switch (m.mode) {
      case 'lungeAim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < CRAWL.aim * 0.6) turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), 5, dt);
        const len = Math.min(CRAWL.speed * CRAWL.dur, clearDist(sim, api, m.x, m.y, m.face, 4));
        m.tele = { shape: 'line', r: len, w: 0.5, ang: m.face, k: Math.min(1, m.t / CRAWL.aim) };
        if (m.t > CRAWL.aim - 0.22) m.danger = len + 0.3;
        if (m.t >= CRAWL.aim) {
          api.setMode(m, 'lunge');
          m.data.hit = 0;
        }
        return;
      }
      case 'lunge':
        m.vx = Math.cos(m.face) * CRAWL.speed;
        m.vy = Math.sin(m.face) * CRAWL.speed;
        if (!m.data.hit && canHurt(sim) && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.15) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg * 1.3, m.x, m.y, 5, m.kind);
        }
        if (m.t >= CRAWL.dur) {
          api.setMode(m, 'recover');
          m.cd = 0.9 + sim.rng() * 0.4;
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.9, 'stalk');
        return;
      case 'down':
      case 'getup':
        downStep(sim, m, api);
        return;
    }
    if (m.mode !== 'stalk') api.setMode(m, 'stalk');
    if (m.cd <= 0 && c.dist < 3.4 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
      api.setMode(m, 'lungeAim');
      m.face = Math.atan2(h.y - m.y, h.x - m.x);
      return;
    }
    const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
    stride(m, Math.atan2(cy, cx), c.dist < 1.2 ? 0 : m.speed, GIANT.f13_crawler.turn, dt);
  },
  onHit(sim, m, hit) {
    if (m.mode === 'recover') {
      m.data.cut = 0.3;
      return 1.6;
    }
    return giantHit(sim, m, hit.ang);
  },
});

// ---------------------------------------------------------------------------
// Ухмылка: мелкий исполин стаей. Кусает, как крыса (библиотека `melee`),
// но удар в лоб его тоже почти не берёт — привыкай к затылку с малых.
// ---------------------------------------------------------------------------

registerBrain('f13_grin', {
  step(sim, m, dt, c, api) {
    BRAINS.get('melee')?.step(sim, m, dt, c, api);
  },
  onHit(_sim, m, hit) {
    const side = napeSide(m, hit.ang);
    if (side === 'back') {
      m.data.cut = 0.25;
      return 1.6;
    }
    return side === 'front' ? 0.75 : 1;
  },
});

// ---------------------------------------------------------------------------
// Ворона: кружит над героем, пикирует по линии (метка), летает над
// провалами. Спит на насесте, пока не подойдёшь.
// ---------------------------------------------------------------------------

export const CROW = { orbit: 2.6, aim: 0.45, swoop: 9, dur: 0.55 };

registerBrain('f13_crow', {
  step(sim, m, dt, c, api) {
    m.tele = null;
    m.danger = 0;
    const h = sim.hero;
    if (heroDown(sim)) {
      m.vx *= 0.9;
      m.vy *= 0.9;
      return;
    }
    switch (m.mode) {
      case 'swoopAim': {
        m.vx *= 0.8;
        m.vy *= 0.8;
        if (m.t < CROW.aim * 0.6) m.face = Math.atan2(h.y - m.y, h.x - m.x);
        const len = CROW.swoop * CROW.dur;
        m.tele = { shape: 'line', r: len, w: 0.3, ang: m.face, k: Math.min(1, m.t / CROW.aim) };
        if (m.t > CROW.aim - 0.2) m.danger = len;
        if (m.t >= CROW.aim) {
          api.setMode(m, 'swoop');
          m.data.hit = 0;
        }
        return;
      }
      case 'swoop':
        m.vx = Math.cos(m.face) * CROW.swoop;
        m.vy = Math.sin(m.face) * CROW.swoop;
        if (!m.data.hit && canHurt(sim) && hypot(h.x - m.x, h.y - m.y) < m.r + h.r + 0.1) {
          m.data.hit = 1;
          api.hurtHero(sim, m.dmg, m.x, m.y, 2, m.kind);
        }
        if (m.t >= CROW.dur) {
          api.setMode(m, 'circle');
          m.cd = 1.4 + sim.rng() * 1.4;
        }
        return;
      case 'flee': {
        // Набат спугнул — улетает прочь и возвращается.
        const a = Math.atan2(m.y - h.y, m.x - h.x);
        api.steer(sim, m, Math.cos(a), Math.sin(a), m.speed, dt);
        if (m.t > 2.5) api.setMode(m, 'circle');
        return;
      }
    }
    if (m.mode !== 'circle') api.setMode(m, 'circle');
    // Кружит: своя сторона орбиты у каждой вороны.
    const phase = sim.time * (0.9 + (m.id % 3) * 0.15) + m.id;
    const r = CROW.orbit + Math.sin(phase * 1.7) * 0.5;
    const tx = h.x + Math.cos(phase) * r;
    const ty = h.y + Math.sin(phase) * r * 0.8;
    const dx = tx - m.x;
    const dy = ty - m.y;
    const d = hypot(dx, dy) || 1;
    api.steer(sim, m, dx / d, dy / d, m.speed * Math.min(1, d / 1.5), dt);
    if (m.cd <= 0 && c.dist < 4.5) {
      api.setMode(m, 'swoopAim');
      m.face = Math.atan2(h.y - m.y, h.x - m.x);
    }
  },
});

// ---------------------------------------------------------------------------
// Контрабандист: удирает с мешком, бросает дымовую шашку и уходит СВОИМ
// крюкомётом через провал к кольцу столба. От ударов сыплет монеты.
// ---------------------------------------------------------------------------

export const SMUG = { smokeCd: 4, zip: 0.35 };

registerBrain('f13_smuggler', {
  step(sim, m, dt, c, api) {
    m.tele = null;
    m.danger = 0;
    const h = sim.hero;
    m.data.smoke = (m.data.smoke ?? 1) - dt;
    if (m.mode === 'zip') {
      // Летит на тросе к кольцу — через провал, недосягаем.
      const k = Math.min(1, m.t / SMUG.zip);
      m.data.ghost = 1;
      m.x = m.data.sx + (m.data.tx - m.data.sx) * k;
      m.y = m.data.sy + (m.data.ty - m.data.sy) * k;
      m.vx = 0;
      m.vy = 0;
      if (k >= 1) {
        m.data.ghost = 0;
        api.setMode(m, 'flee');
        m.data.zipCd = 6;
      }
      return;
    }
    m.data.zipCd = (m.data.zipCd ?? 0) - dt;
    if (m.mode !== 'flee') api.setMode(m, 'flee');
    if (c.dist < 2.4 && m.data.smoke <= 0) {
      m.data.smoke = SMUG.smokeCd;
      api.zone(sim, { x: m.x, y: m.y, r: 1.7, life: 3, slow: 0.55, art: 'f13_smoke' });
      sim.events.push({ t: 'boss', what: 'f13_smoke' });
    }
    // Столб рядом, а герой на хвосте — уйти тросом.
    const st = STATE.get(sim);
    if (st && m.data.zipCd <= 0 && c.dist < 7) {
      for (const hk of st.hooks) {
        if (hk.combat) continue;
        const d = hypot(hk.x - m.x, hk.y - m.y);
        if (d > 1.4) continue;
        if (hypot(hk.tx - h.x, hk.ty - h.y) < 3) continue;
        api.setMode(m, 'zip');
        m.data.sx = m.x;
        m.data.sy = m.y;
        m.data.tx = hk.tx;
        m.data.ty = hk.ty;
        const rope: ZX = {
          x: hk.x,
          y: hk.y,
          r: 0.5,
          life: SMUG.zip + 0.15,
          art: 'f13_rope',
          above: true,
          tx: hk.tx,
          ty: hk.ty,
          mob: m.id,
        };
        api.zone(sim, rope);
        sim.events.push({ t: 'boss', what: 'f13_zip' });
        return;
      }
    }
    // Бежит прочь; в тупике — к ближнему столбу.
    let dir = api.flowDir(sim, m.x, m.y, true);
    if (st && (!dir || c.dist < 3)) {
      let best: HookRec | null = null;
      let bd = 12;
      for (const hk of st.hooks) {
        if (hk.combat) continue;
        const d = hypot(hk.x - m.x, hk.y - m.y);
        if (d < bd && hypot(hk.x - h.x, hk.y - h.y) > d) {
          bd = d;
          best = hk;
        }
      }
      if (best) {
        const [cx, cy] = [best.x - m.x, best.y - m.y];
        const l = hypot(cx, cy) || 1;
        dir = [cx / l, cy / l];
      }
    }
    const [fx, fy] = dir ?? [-(h.x - m.x) / (c.dist || 1), -(h.y - m.y) / (c.dist || 1)];
    api.steer(sim, m, fx, fy, m.speed * (c.dist < 6 ? 1 : 0.5), dt);
  },
  onHit(sim, m, _hit, api) {
    // Мешок рвётся — монеты на мостовую.
    api.dropAt(sim, 'coin', 90, m.x, m.y);
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Колосс (4×4). Нога — дуга кольца, рука — конус. Четыре фазы:
//   0 «КОЛОСС»    — ладонь, топот, разворот; столбы по краям — за спину;
//   1 «ПАР»       — окутан паром: затылок закрыт, пар жжёт вплотную, из
//                   решёток бьют струи. Крюк за спину срывает пар на 2,6 с;
//   2 «ТОПОТ»     — топот обваливает Стену: обломки дождём, площадь
//                   трескается по линиям разлома (крюк через трещину),
//                   издали швыряет глыбы; пушки по краям валят на колени;
//   3 «ИСПАРЕНИЕ» — тает: жар вокруг, кольца пара расходятся волнами,
//                   площадь чернеет под его шагами.
// ---------------------------------------------------------------------------

export const COL = {
  hp: [0.75, 0.5, 0.25],
  rise: 2.6,
  roar: 1.3,
  turn: [0.8, 0.8, 0.85, 1.1],
  walk: [1.15, 1.1, 1.15, 1.4],
  swipe: { r: 5.2, arc: 1.5, warn: 1, dmg: 1.3 },
  stomp: { r: 2.9, w: 0.8, arc: 2.4, warn: 0.9, dmg: 1.05, cd: 3.2 },
  back: { r: 3.9, arc: 2.2, warn: 0.8, dmg: 1.1 },
  /** Разворот не чаще — окно для затылка между наказаниями. */
  spin: 4.4,
  naps: 3,
  vent: { r: 3.4, warn: 0.8, life: 2.2, dps: 0.05, cd: 7 },
  cloak: { r: 2.4, dps: 0.02 },
  bare: 2.6,
  quake: { warn: 1.15, r: 3.3, w: 1.1, cd: 9, debris: 12, crack: 1.6 },
  throw: { windup: 1.1, cd: 5 },
  rings: { cd: 8, warn: 0.75, gap: 0.32, radii: [2.6, 4.6, 6.6, 8.6] },
  heat: { r: 2.3, dps: 0.03 },
  kneel: 3.4,
  /** Пушка по Колоссу: доля здоровья и множитель удара, пока он на коленях. */
  cannonHit: 0.05,
  kneelMul: 1.5,
};

interface ColState {
  /** Клетки, сменённые боем (вернуть на сброс). */
  changed: Map<number, { tile: number; mark: number }>;
  /** Линии разлома: клетки, ещё не раскрытые. */
  faults: number[][];
  /** Трескающиеся клетки: когда станут пропастью. */
  cracking: Map<number, number>;
  /** Плащ пара / жар (зона, что ходит за ним). */
  aura: number;
  vents: number[];
  ventT: number;
  ventPar: number;
  scorchT: number;
}

const COLST = new WeakMap<Sim, ColState>();

function colState(sim: Sim): ColState {
  let st = COLST.get(sim);
  if (!st) {
    st = {
      changed: new Map(),
      faults: [],
      cracking: new Map(),
      aura: 0,
      vents: [],
      ventT: 0,
      ventPar: 0,
      scorchT: 0,
    };
    COLST.set(sim, st);
  }
  return st;
}

const colossusOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f13boss' && x.mode !== 'dying');

/** Сменить клетку арены, запомнив прежнюю (для сброса боя). */
function retile(sim: Sim, api: SimApi, i: number, tile: number, mark: number): void {
  const st = colState(sim);
  const w = sim.world;
  if (!st.changed.has(i)) st.changed.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark);
}

/** Вернуть арену: плиты, трещины, копоть, свет. */
function restoreArena(sim: Sim, api: SimApi): void {
  const st = COLST.get(sim);
  if (st) {
    const W = sim.world.w;
    for (const [i, v] of st.changed) api.setTile(sim, i % W, Math.floor(i / W), v.tile, v.mark);
    const au = sim.zones.find((z) => z.id === st.aura);
    if (au) au.life = 0;
  }
  COLST.delete(sim);
  for (const k of ['colA', 'colB', 'colC', 'colD', 'colE']) api.light(sim, k, null);
}

/** Зона, которая ходит за Колоссом (плащ пара, жар). */
function auraOf(sim: Sim, st: ColState) {
  return st.aura ? sim.zones.find((z) => z.id === st.aura) : undefined;
}

function setAura(sim: Sim, api: SimApi, st: ColState, m: Mob, art: string | null, r = 0, dps = 0): void {
  const z = auraOf(sim, st);
  if (z) z.life = 0;
  st.aura = 0;
  if (!art) return;
  // Плащ пара — поверх Колосса (его окутывает), жар — по земле.
  api.zone(sim, { x: m.x, y: m.y, r, life: 1e6, dps, status: 'burn', dur: 0.8, art, above: art === 'f13_cloak' });
  st.aura = sim.zones[sim.zones.length - 1]?.id ?? 0;
}

const hasteOf = (sim: Sim) => ((sim.boss?.phase ?? 0) >= 3 ? 1.2 : 1);

/** Рука: конус перед собой. */
function colSwipe(sim: Sim, m: Mob, api: SimApi): boolean {
  const S = COL.swipe;
  const T = S.warn / hasteOf(sim);
  m.vx *= 0.7;
  m.vy *= 0.7;
  if (!m.data.lit) {
    m.data.lit = 1;
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: S.r,
      ang: m.face,
      arc: S.arc,
      warn: T,
      dmg: m.dmg * S.dmg,
      knock: 9,
      art: 'f13_palm',
      from: m.id,
    });
  }
  if (m.t > T - 0.25) m.danger = S.r + 0.6;
  if (m.t >= T) {
    m.data.lit = 0;
    sim.events.push({ t: 'shake', k: 0.35 });
    return true;
  }
  return false;
}

/** Нога: дуга кольца на стороне героя — уйди вбок, внутрь или наружу. */
function colStomp(sim: Sim, m: Mob, api: SimApi): boolean {
  const S = COL.stomp;
  const T = S.warn / hasteOf(sim);
  const h = sim.hero;
  m.vx *= 0.7;
  m.vy *= 0.7;
  if (!m.data.lit) {
    m.data.lit = 1;
    m.data.sa = Math.atan2(h.y - m.y, h.x - m.x);
    api.strike(sim, {
      shape: 'ring',
      x: m.x,
      y: m.y,
      r: S.r,
      w: S.w,
      ang: m.data.sa,
      arc: S.arc,
      warn: T,
      dmg: m.dmg * S.dmg,
      knock: 7,
      art: 'f13_foot',
      from: m.id,
    });
  }
  if (m.t > T - 0.25) m.danger = S.r + S.w + 0.4;
  if (m.t >= T) {
    m.data.lit = 0;
    sim.events.push({ t: 'shake', k: 0.5 });
    sim.events.push({ t: 'boss', what: 'f13_stomp_wall' });
    puff(api, sim, 'f13_dust', m.x + Math.cos(m.data.sa) * S.r, m.y + Math.sin(m.data.sa) * S.r, 1.6, 0.8);
    return true;
  }
  return false;
}

/** Разворот: дуга за спиной, потом лицом туда. */
function colBack(sim: Sim, m: Mob, api: SimApi): boolean {
  const S = COL.back;
  m.vx *= 0.7;
  m.vy *= 0.7;
  if (!m.data.lit) {
    m.data.lit = 1;
    m.data.sa = m.face + Math.PI;
    api.strike(sim, {
      shape: 'cone',
      x: m.x,
      y: m.y,
      r: S.r,
      ang: m.data.sa,
      arc: S.arc,
      warn: S.warn,
      dmg: m.dmg * S.dmg,
      knock: 9,
      art: 'f13_backhand',
      from: m.id,
    });
  }
  if (m.t > S.warn - 0.25) m.danger = S.r + 0.5;
  if (m.t >= S.warn) {
    const k = Math.min(1, (m.t - S.warn) / 0.5);
    m.face += angDiff(m.data.sa, m.face) * k;
    if (k >= 1) {
      m.face = m.data.sa;
      m.data.lit = 0;
      m.data.naped = 0;
      m.data.behind = 0;
      return true;
    }
  }
  return false;
}

/** Топот фазы 2: кольцо у ног, обломки дождём, трещина по линии разлома. */
function colQuake(sim: Sim, m: Mob, api: SimApi, b: BossFight): boolean {
  const Q = COL.quake;
  m.vx *= 0.6;
  m.vy *= 0.6;
  if (!m.data.lit) {
    m.data.lit = 1;
    api.strike(sim, {
      shape: 'ring',
      x: m.x,
      y: m.y,
      r: Q.r,
      w: Q.w,
      warn: Q.warn,
      dmg: m.dmg * 1.2,
      knock: 8,
      art: 'f13_stomp',
      from: m.id,
    });
    // Обломки Стены — по всей площади, с метками.
    const cells = [...b.cells];
    for (let i = 0; i < Q.debris; i++) {
      const cell = cells[Math.floor(sim.rng() * cells.length)];
      const x = (cell % sim.world.w) + 0.5;
      const y = Math.floor(cell / sim.world.w) + 0.5;
      if (hypot(x - m.x, y - m.y) < 2.4) continue;
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 0.95,
        warn: Q.warn + 0.2 + sim.rng() * 0.7,
        dmg: m.dmg * 0.8,
        knock: 3,
        art: 'f13_debris',
        from: m.id,
      });
    }
    // И обязательно — одна у героя: стоять на месте нельзя.
    api.strike(sim, {
      shape: 'circle',
      x: sim.hero.x,
      y: sim.hero.y,
      r: 1,
      warn: Q.warn + 0.5,
      dmg: m.dmg * 0.8,
      knock: 3,
      art: 'f13_debris',
      from: m.id,
    });
  }
  if (m.t > Q.warn - 0.25) m.danger = Q.r + Q.w + 0.4;
  if (m.t >= Q.warn) {
    m.data.lit = 0;
    sim.events.push({ t: 'shake', k: 0.85 });
    sim.events.push({ t: 'boss', what: 'f13_quake_wall' });
    puff(api, sim, 'f13_dust', m.x, m.y, 4, 1.1);
    // Площадь трескается по очередной линии разлома.
    const st = colState(sim);
    const line = st.faults.shift();
    if (line) {
      for (const i of line) {
        if (sim.tiles[i] === T_DEEP) continue;
        retile(sim, api, i, T_FLOOR, MK.cracking);
        st.cracking.set(i, sim.time + Q.crack);
      }
      sim.events.push({
        t: 'boss',
        what: 'f13_crack_trap',
        text: 'ПЛОЩАДЬ ТРЕСКАЕТСЯ',
        sub: 'сойди с трещины — через разлом крюком',
      });
    }
    return true;
  }
  return false;
}

/** Бросок глыбы из обломков, когда до героя не дойти. */
function colThrow(sim: Sim, m: Mob, api: SimApi, dt: number): boolean {
  const h = sim.hero;
  m.vx *= 0.6;
  m.vy *= 0.6;
  turnTo(m, Math.atan2(h.y - m.y, h.x - m.x), 1.6, dt);
  if (m.t >= COL.throw.windup) {
    const tx = h.x + h.vx * 0.3;
    const ty = h.y + h.vy * 0.3;
    api.shoot(
      sim,
      m,
      Math.atan2(ty - m.y, tx - m.x),
      {
        speed: 8,
        r: 1.1,
        life: 3,
        dmg: 1.1,
        art: 'f13_boulder',
        lob: true,
        onLand: { r: 1.4, life: 3, slow: 0.6, art: 'f13_rubble' },
      },
      tx,
      ty,
    );
    return true;
  }
  return false;
}

/** Испарение: кольца пара расходятся от него волнами. */
function colRings(sim: Sim, m: Mob, api: SimApi): boolean {
  const R = COL.rings;
  m.vx *= 0.6;
  m.vy *= 0.6;
  if (!m.data.lit) {
    m.data.lit = 1;
    R.radii.forEach((r, i) =>
      api.strike(sim, {
        shape: 'ring',
        x: m.x,
        y: m.y,
        r,
        w: 0.7,
        warn: R.warn + i * R.gap,
        dmg: m.dmg * 0.9,
        knock: 5,
        status: 'burn',
        dur: 1.5,
        art: 'f13_steamring',
        from: m.id,
      }),
    );
    sim.events.push({ t: 'boss', what: 'f13_evap_call' });
  }
  if (m.t > R.warn - 0.25) m.danger = 3.4;
  if (m.t >= R.warn + R.gap * (R.radii.length - 1)) {
    m.data.lit = 0;
    return true;
  }
  return false;
}

function colStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const h = sim.hero;
  const b = sim.boss;
  const phase = b?.phase ?? 0;
  giantTick(sim, m, dt);
  m.tele = null;
  m.danger = 0;
  m.data.phase = phase;
  for (const k of ['ventCd', 'quakeCd', 'ringCd', 'throwCd', 'stompCd']) m.data[k] = (m.data[k] ?? 3) - dt;
  m.data.bareT = (m.data.bareT ?? 0) - dt;
  if (m.mode !== 'rise' && m.mode !== 'roar') shoulder(sim, m);
  if (heroDown(sim)) {
    m.vx *= 0.85;
    m.vy *= 0.85;
    return;
  }
  const st = colState(sim);
  // Аура ходит за ним: плащ пара (фаза 1) или жар (фаза 3).
  const au = auraOf(sim, st);
  if (au) {
    au.x = m.x;
    au.y = m.y;
    // Пар сорван крюком — плащ не жжёт.
    if (phase === 1) au.dps = m.data.bareT > 0 ? 0 : COL.cloak.dps;
  }
  switch (m.mode) {
    case 'rise':
      m.data.ghost = 1;
      m.vx = 0;
      m.vy = 0;
      m.face = Math.PI / 2;
      if (m.t >= COL.rise) {
        m.data.ghost = 0;
        api.setMode(m, 'stalk');
        m.cd = 1;
      }
      return;
    case 'roar':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t >= COL.roar) {
        api.setMode(m, 'stalk');
        m.cd = 0.6;
      }
      return;
    case 'swipe':
      if (colSwipe(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = 1;
      }
      return;
    case 'stomp':
      if (colStomp(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = 0.9;
      }
      return;
    case 'back':
      if (colBack(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = 0.6;
      }
      return;
    case 'vent': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      const V = COL.vent;
      if (!m.data.lit) {
        m.data.lit = 1;
        api.zone(sim, {
          x: m.x,
          y: m.y,
          r: V.r,
          life: V.life,
          warn: V.warn,
          dps: V.dps,
          status: 'burn',
          dur: 1.2,
          art: 'f13_ventburst',
        });
        sim.events.push({ t: 'boss', what: 'f13_steam_call' });
      }
      if (m.t > V.warn - 0.22) m.danger = V.r + 0.4;
      if (m.t >= V.warn) {
        m.data.lit = 0;
        api.setMode(m, 'recover');
        m.cd = 0.8;
      }
      return;
    }
    case 'quake':
      if (b && colQuake(sim, m, api, b)) {
        api.setMode(m, 'recover');
        m.cd = 1.2;
      }
      return;
    case 'throw':
      if (colThrow(sim, m, api, dt)) {
        api.setMode(m, 'recover');
        m.cd = 1;
      }
      return;
    case 'rings':
      if (colRings(sim, m, api)) {
        api.setMode(m, 'recover');
        m.cd = 0.7;
      }
      return;
    case 'kneel':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t >= COL.kneel) {
        api.setMode(m, 'stalk');
        m.cd = 0.5;
      }
      return;
    case 'recover':
      recoverStep(m, api, 0.85 / hasteOf(sim));
      return;
  }
  if (m.mode !== 'stalk') api.setMode(m, 'stalk');
  const rel = heroRel(sim, m);
  const dist = c.dist;
  const reach = clearLine(sim, api, m.x, m.y, h.x, h.y);
  // Приёмы фаз — по своим часам.
  if (m.data.spinCd <= 0 && ((m.data.naped ?? 0) >= COL.naps || (m.data.behind ?? 0) > 2.4) && dist < 5) {
    api.setMode(m, 'back');
    m.data.spinCd = COL.spin;
    m.data.lit = 0;
    return;
  }
  if (phase === 1 && m.data.ventCd <= 0 && dist < 5) {
    api.setMode(m, 'vent');
    m.data.ventCd = COL.vent.cd;
    m.data.lit = 0;
    return;
  }
  if (phase === 2 && m.data.quakeCd <= 0) {
    api.setMode(m, 'quake');
    m.data.quakeCd = COL.quake.cd;
    m.data.lit = 0;
    return;
  }
  if (phase === 3 && m.data.ringCd <= 0) {
    api.setMode(m, 'rings');
    m.data.ringCd = COL.rings.cd;
    m.data.lit = 0;
    return;
  }
  if (m.cd <= 0) {
    if (rel < 0.75 && dist < COL.swipe.r + 0.2) {
      api.setMode(m, 'swipe');
      m.data.lit = 0;
      return;
    }
    // Нога — не чаще раза в `stompCd`: между топотами за спиной есть окно
    // для затылка (иначе топот шёл бы без продыху и затылок не бился).
    if (rel >= 0.75 && dist < COL.stomp.r + COL.stomp.w && m.data.stompCd <= 0) {
      api.setMode(m, 'stomp');
      m.data.stompCd = COL.stomp.cd;
      m.data.lit = 0;
      return;
    }
    if (phase >= 2 && m.data.throwCd <= 0 && (dist > 7.5 || !reach)) {
      api.setMode(m, 'throw');
      m.data.throwCd = COL.throw.cd;
      return;
    }
  }
  const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
  const near = dist < m.r + 1.4;
  stride(m, Math.atan2(cy, cx), near ? 0 : m.speed * COL.walk[phase], COL.turn[phase], dt);
}

registerBrain('f13boss', {
  raw: true,
  step: colStep,
  onHit(sim, m, hit) {
    if (m.mode === 'rise' || m.mode === 'roar') return 0;
    if (m.mode === 'kneel') {
      m.data.cut = 0.3;
      return COL.kneelMul;
    }
    const side = napeSide(m, hit.ang);
    const phase = sim.boss?.phase ?? 0;
    // Пар закрыл затылок: пока крюк его не сорвёт — почти впустую.
    if (phase === 1 && !((m.data.bareT ?? 0) > 0)) return side === 'back' ? 0.06 : 0.04;
    if (side === 'back') {
      m.data.cut = 0.3;
      m.data.naped = (m.data.naped ?? 0) + 1;
      hint(sim, 'nape');
      return 1;
    }
    if (side === 'front') hint(sim, 'front');
    return side === 'side' ? 0.22 : 0.07;
  },
  onDeath(sim, m, _mode, api) {
    giantDeath(sim, m, api);
    api.slowmo(sim, 1.4, 0.3);
    sim.events.push({ t: 'shake', k: 1 });
    sim.events.push({ t: 'flash', color: '#fff4e0', k: 0.9 });
    const st = COLST.get(sim);
    if (st) setAura(sim, api, st, m, null);
  },
});

function arenaBox(sim: Sim, b: BossFight): [number, number, number, number] {
  const W = sim.world.w;
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  for (const i of b.cells) {
    const x = i % W;
    const y = Math.floor(i / W);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Колосс в бою (для крюка «за спину», пушек, теста). */
export const f13Colossus = colossusOf;

registerBoss('f13boss', {
  start(sim, b, lead, api) {
    restoreArena(sim, api);
    const st = colState(sim);
    b.phase = 0;
    // Линии разлома: две — западная и восточная.
    const W = sim.world.w;
    const west: number[] = [];
    const east: number[] = [];
    for (const i of b.cells)
      if (sim.world.mark[i] === MK.fault) (i % W < b.obj.x ? west : east).push(i);
    st.faults = [west, east];
    for (const i of b.cells) if (sim.world.mark[i] === MK.vent) st.vents.push(i);
    lead.face = Math.PI / 2;
    api.setMode(lead, 'rise');
    // Вход камерой: встаёт из пара у колокольни.
    api.camera(sim, lead.x, lead.y - 1.5, COL.rise + 0.4);
    puff(api, sim, 'f13_ventburst', lead.x, lead.y, 4.5, COL.rise);
    sim.events.push({ t: 'shake', k: 0.9 });
    sim.events.push({
      t: 'boss',
      what: 'f13_rise_call',
      text: 'КОЛОСС',
      sub: 'бей в затылок — крюки по краям площади',
    });
    const [x0, y0, x1] = arenaBox(sim, b);
    api.light(sim, 'colA', { x: (x0 + x1) / 2 + 0.5, y: y0 + 3, r: 7, tint: 'warm' });
  },
  step(sim, b, dt, api) {
    const m = colossusOf(sim);
    if (!m) return;
    const st = colState(sim);
    const k = m.hp / m.maxHp;
    const W = sim.world.w;
    const [x0, y0, x1, y1] = arenaBox(sim, b);
    const cx = (x0 + x1) / 2 + 0.5;
    const cy = (y0 + y1) / 2 + 0.5;
    const busy = m.mode === 'rise' || m.mode === 'roar' || m.mode === 'back';
    if (b.phase === 0 && k <= COL.hp[0] && !busy) {
      b.phase = 1;
      api.setMode(m, 'roar');
      setAura(sim, api, st, m, 'f13_cloak', COL.cloak.r, COL.cloak.dps);
      sim.events.push({ t: 'boss', what: 'phase', text: 'ПАР', sub: 'затылок в пару — крюком за спину' });
      sim.events.push({ t: 'flash', color: '#e8f0f0', k: 0.6 });
      api.light(sim, 'colB', { x: cx, y: cy, r: 9, tint: 'cold' });
    }
    if (b.phase === 1 && k <= COL.hp[1] && !busy) {
      b.phase = 2;
      api.setMode(m, 'roar');
      setAura(sim, api, st, m, null);
      m.data.quakeCd = 1.6;
      sim.events.push({ t: 'boss', what: 'phase', text: 'ТОПОТ', sub: 'Стена сыплется — пушка валит его на колени' });
      api.light(sim, 'colB', null);
      api.light(sim, 'colC', { x: cx, y: y1 - 2, r: 8, tint: 'warm' });
    }
    if (b.phase === 2 && k <= COL.hp[2] && !busy) {
      b.phase = 3;
      api.setMode(m, 'roar');
      setAura(sim, api, st, m, 'f13_heat', COL.heat.r, COL.heat.dps);
      m.data.ringCd = 1.5;
      sim.events.push({ t: 'boss', what: 'phase', text: 'ИСПАРЕНИЕ', sub: 'он тает — затылок открыт, вокруг жар' });
      sim.events.push({ t: 'flash', color: '#ff8a50', k: 0.6 });
      api.light(sim, 'colD', { x: x0 + 3, y: cy, r: 8, tint: 'red' });
      api.light(sim, 'colE', { x: x1 - 2, y: cy, r: 8, tint: 'red' });
    }
    // ПАР: струи из решёток — чётные и нечётные по очереди.
    if (b.phase === 1 && st.vents.length) {
      st.ventT -= dt;
      if (st.ventT <= 0) {
        st.ventT = 2.3;
        st.ventPar ^= 1;
        st.vents.forEach((i, n) => {
          if (n % 2 !== st.ventPar) return;
          api.zone(sim, {
            x: (i % W) + 0.5,
            y: Math.floor(i / W) + 0.5,
            r: 1,
            life: 1.2,
            warn: 0.75,
            dps: 0.06,
            status: 'burn',
            dur: 1,
            art: 'f13_jet',
          });
        });
      }
    }
    // Трещины раскрываются в пропасть.
    if (st.cracking.size) {
      const h = sim.hero;
      const hi = Math.floor(h.y) * W + Math.floor(h.x);
      for (const [i, at] of st.cracking) {
        if (sim.time < at) continue;
        st.cracking.delete(i);
        const onIt = i === hi && !h.pull && h.r > 0.05;
        retile(sim, api, i, T_DEEP, MK.rift);
        if (onIt && !heroDown(sim)) {
          const to = safeCell(sim, hi);
          if (to !== null) {
            api.hurtEnv(sim, 0.1);
            api.moveHero(sim, (to % W) + 0.5, Math.floor(to / W) + 0.5);
            sim.events.push({ t: 'boss', what: 'f13_edge_trap', text: 'СОРВАЛСЯ', sub: 'край ушёл из-под ног' });
          }
        }
      }
    }
    // ИСПАРЕНИЕ: площадь чернеет под его шагами.
    if (b.phase === 3) {
      st.scorchT -= dt;
      if (st.scorchT <= 0) {
        st.scorchT = 0.45;
        const i = Math.floor(m.y + 0.6) * W + Math.floor(m.x + (sim.rng() - 0.5) * 2);
        const mk = sim.world.mark[i];
        if (b.cells.has(i) && sim.tiles[i] === T_FLOOR && (mk === MK.mosaic || mk === 0))
          retile(sim, api, i, T_FLOOR, MK.scorch);
      }
    }
    void y0;
  },
  notches: () => COL.hp,
  reset(sim, _b, api) {
    restoreArena(sim, api);
  },
});

/** Ближняя целая клетка пола — туда сносит сорвавшегося. */
function safeCell(sim: Sim, from: number): number | null {
  const W = sim.world.w;
  const st = COLST.get(sim);
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const i = q.shift()!;
    if (i !== from && walkable(sim.tiles[i]) && !st?.cracking.has(i)) return i;
    for (const d of [1, -1, W, -W]) {
      const j = i + d;
      if (seen.has(j) || j < 0 || j >= sim.tiles.length || sim.tiles[j] === T_WALL) continue;
      seen.add(j);
      if (seen.size > 400) return null;
      q.push(j);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Правила этажа: посты, крюки, пушки, валун, набат, залы-события.
// ---------------------------------------------------------------------------

/** Столб-якорь: где стоит и куда выносит (у столба исполинов — за спину). */
export interface HookRec {
  obj: WorldObj;
  x: number;
  y: number;
  tx: number;
  ty: number;
  combat: boolean;
  area: string;
  cd: number;
}

interface Cannon {
  obj: WorldObj;
  x: number;
  y: number;
  ang: number;
  len: number;
  reload: number;
  area: string;
}

interface Post {
  kind: string;
  x: number;
  y: number;
  mob: number;
  dead: boolean;
  area: string;
}

/** Полёт на тросе. `own` — своим ходом над провалом и Стеной. */
interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  t: number;
  T: number;
  r0: number;
  lift: number;
  target: number;
  own: boolean;
}

interface Timer {
  at: number;
  fn: (api: SimApi) => void;
}

type Ev = 'idle' | 'on' | 'done';

export interface F13State {
  tops: Record<string, number>;
  posts: Post[];
  hooks: HookRec[];
  cannons: Cannon[];
  boulder: { obj: WorldObj; x: number; y: number; used: boolean } | null;
  breach: number[];
  bell: { obj: WorldObj; x: number; y: number; cd: number } | null;
  roosts: { x: number; y: number; done: boolean }[];
  flight: Flight | null;
  /** Тень героя на земле, пока он летит на тросе (рисовальщик). */
  shadow: [number, number] | null;
  timers: Timer[];
  kills: number;
  fire: { st: Ev; t: number; row: number; beam: number; lights: number };
  march: { st: Ev; mobs: number[] };
  breachEv: { st: Ev; t: number; wave: number; sealed: boolean; paid: boolean };
  battery: { st: Ev; wave: number; t: number; mobs: number[]; gap: number };
  alarm: { st: Ev; wave: number; t: number; mobs: number[]; tolls: number };
  rift: { st: Ev; t: number; tick: number; crows: boolean };
}

const STATE = new WeakMap<Sim, F13State>();

/** Состояние этажа вылазки (для тестов и стенда). */
export const f13State = (sim: Sim): F13State | undefined => STATE.get(sim);

export const HOOK = { speed: 15, range: 12, cd: 1.2, lift: 0.9 };
export const CANNON = { warn: 0.45, reload: 7, battery: 2.5, arena: 12, w: 0.9 };
export const BELL = { r: 7.5, cd: 7, stun: 1.3 };


function areaAt(sim: Sim, y: number): string {
  const yy = Math.floor(y);
  for (const b of sim.world.bands) if (yy >= b.top && yy < b.top + b.h) return b.def.id;
  return sim.world.bands[sim.world.bands.length - 1].def.id;
}

/** Герой в прямоугольнике района (местные координаты). */
function heroIn(sim: Sim, st: F13State, area: string, x0: number, y0: number, x1: number, y1: number): boolean {
  const h = sim.hero;
  const ly = h.y - st.tops[area];
  return h.x >= x0 && h.x <= x1 + 1 && ly >= y0 && ly <= y1 + 1 && areaAt(sim, h.y) === area;
}

function later(sim: Sim, st: F13State, dt: number, fn: (api: SimApi) => void): void {
  st.timers.push({ at: sim.time + dt, fn });
}

function spawnAt(
  sim: Sim,
  st: F13State,
  api: SimApi,
  kind: string,
  area: string,
  lx: number,
  ly: number,
  mode = 'stalk',
  elite = false,
): Mob {
  const m = api.spawnMob(sim, kind, lx + 0.5, st.tops[area] + ly + 0.5, { mode, elite });
  m.data.px = m.x;
  m.data.py = m.y;
  api.collide(sim, m);
  return m;
}

function reward(sim: Sim, api: SimApi, x: number, y: number, coins: number, tokens: number, mats: [string, number][]): void {
  for (let i = 0; i < 5; i++) api.dropAt(sim, 'coin', Math.round(coins / 5), x, y);
  for (let i = 0; i < Math.min(8, tokens); i++) api.dropAt(sim, 'token', Math.ceil(tokens / 8), x, y);
  for (const [id, n] of mats) for (let i = 0; i < n; i++) api.dropAt(sim, id, 1, x, y);
}

function scan(sim: Sim, api: SimApi): F13State {
  const w = sim.world;
  const W = w.w;
  const tops: Record<string, number> = {};
  for (const b of w.bands) tops[b.def.id] = b.top;
  const st: F13State = {
    tops,
    posts: [],
    hooks: [],
    cannons: [],
    boulder: null,
    breach: [],
    bell: null,
    roosts: [],
    flight: null,
    shadow: null,
    timers: [],
    kills: 0,
    fire: { st: 'idle', t: 0, row: 0, beam: 0, lights: 0 },
    march: { st: 'idle', mobs: [] },
    breachEv: { st: 'idle', t: 0, wave: 0, sealed: false, paid: false },
    battery: { st: 'idle', wave: 0, t: 0, mobs: [], gap: 0 },
    alarm: { st: 'idle', wave: 0, t: 0, mobs: [], tolls: 0 },
    rift: { st: 'idle', t: 0, tick: 0, crows: false },
  };
  for (let i = 0; i < w.mark.length; i++) {
    const kind = F13_POSTS[w.mark[i]];
    if (!kind) continue;
    const x = i % W;
    const y = Math.floor(i / W);
    st.posts.push({ kind, x: x + 0.5, y: y + 0.5, mob: 0, dead: false, area: areaAt(sim, y) });
  }
  const objAt = (x: number, y: number, ref: string) =>
    w.objs.find((o) => o.x === x && o.y === y && o.ref === ref);
  for (const [area, list] of Object.entries(F13_HOOKS)) {
    const top = tops[area];
    if (top === undefined) continue;
    for (const [x, ly, tx, tly] of list) {
      const obj = objAt(x, top + ly, 'f13_hook');
      if (!obj) continue;
      st.hooks.push({
        obj,
        x: x + 0.5,
        y: top + ly + 0.5,
        tx: tx + 0.5,
        ty: top + tly + 0.5,
        combat: false,
        area,
        cd: 0,
      });
    }
  }
  for (const o of w.objs) {
    if (o.ref === 'f13_hookc')
      st.hooks.push({ obj: o, x: o.x + 0.5, y: o.y + 0.5, tx: 0, ty: 0, combat: true, area: o.area, cd: 0 });
    if (o.ref === 'f13_cannon') {
      // Пушка на Стене бьёт через зубцы; на площади — вдоль самого длинного
      // прохода.
      let ang = Math.PI / 2;
      let len = 30;
      if (w.mark[(o.y + 1) * W + o.x] !== MK.parapet) {
        let best = -1;
        for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const d = clearDist(sim, api, o.x + 0.5, o.y + 0.5, a, 40);
          if (d > best) {
            best = d;
            ang = a;
          }
        }
        len = best;
      }
      st.cannons.push({ obj: o, x: o.x + 0.5, y: o.y + 0.5, ang, len, reload: 0, area: o.area });
    }
    if (o.ref === 'f13_boulder') st.boulder = { obj: o, x: o.x + 0.5, y: o.y + 0.5, used: false };
    if (o.ref === 'f13_bell') st.bell = { obj: o, x: o.x + 0.5, y: o.y + 0.5, cd: 0 };
    if (o.ref === 'f13_roost') st.roosts.push({ x: o.x + 0.5, y: o.y + 0.5, done: false });
  }
  // Устье Пролома — его заваливает валун (ряды 54…57 района Стены).
  const wt = tops[F13_WALL];
  if (wt !== undefined)
    for (let ly = 54; ly <= 57; ly++)
      for (let x = 0; x < W; x++) if (w.mark[(wt + ly) * W + x] === MK.breach) st.breach.push((wt + ly) * W + x);
  return st;
}

function stateOf(sim: Sim, api: SimApi): F13State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim, api);
    STATE.set(sim, st);
  }
  return st;
}

// ---- Посты -------------------------------------------------------------------

function stepPosts(sim: Sim, st: F13State, api: SimApi): void {
  const h = sim.hero;
  for (const p of st.posts) {
    if (p.dead) continue;
    if (p.mob) {
      const m = sim.mobs.find((x) => x.id === p.mob);
      if (!m || m.mode === 'dying') {
        // Пропал (далеко ушёл герой — движок убрал) — встанет снова; убит — нет.
        if (m?.mode === 'dying' || !m) p.dead = !!m || p.dead;
        if (!m && !p.dead) p.mob = 0;
        if (m?.mode === 'dying') p.mob = 0;
      }
      continue;
    }
    const d = hypot(p.x - h.x, p.y - h.y);
    if (d > 18 || d < 5) continue;
    if (sim.boss?.state === 'fight' && api.inArena(sim, p.x, p.y)) continue;
    const m = api.spawnMob(sim, p.kind, p.x, p.y, {
      mode: p.kind === 'f13_crawler' ? 'stalk' : 'wander',
      elite: sim.rng() < 0.14,
    });
    m.data.px = p.x;
    m.data.py = p.y;
    m.face = sim.rng() * TAU;
    p.mob = m.id;
  }
  // Насесты: вороны спят, пока не подойдёшь.
  for (const r of st.roosts) {
    if (r.done || hypot(r.x - h.x, r.y - h.y) > 14) continue;
    r.done = true;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      const m = api.spawnMob(sim, 'f13_crow', r.x + Math.cos(a) * 0.5, r.y + Math.sin(a) * 0.4, {
        mode: 'sleep',
      });
      m.data.perch = 1;
    }
  }
}

// ---- Крюк ------------------------------------------------------------------

/** Ближний исполин у точки (живой, не в воздухе). */
function giantNear(sim: Sim, x: number, y: number, r: number): Mob | null {
  let best: Mob | null = null;
  let bd = r;
  for (const m of sim.mobs) {
    if (!F13_GIANTS.has(m.kind) || m.mode === 'dying' || (m.data.ghost ?? 0) > 0) continue;
    const d = hypot(m.x - x, m.y - y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** Точка за спиной исполина, куда встать. */
function behindOf(sim: Sim, api: SimApi, g: Mob): [number, number] | null {
  for (const da of [0, 0.45, -0.45, 0.9, -0.9]) {
    for (const extra of [1.05, 1.5, 0.8]) {
      const a = g.face + Math.PI + da;
      const d = g.r + extra;
      const x = g.x + Math.cos(a) * d;
      const y = g.y + Math.sin(a) * d;
      if (roomFor(sim, api, x, y, 0.3)) return [x, y];
    }
  }
  return null;
}

/** Куда вынесет столб прямо сейчас (null — некуда). */
function hookTarget(
  sim: Sim,
  st: F13State,
  api: SimApi,
  hk: HookRec,
): { x: number; y: number; target: number } | null {
  if (!hk.combat) return { x: hk.tx, y: hk.ty, target: 0 };
  const g = giantNear(sim, hk.x, hk.y, HOOK.range);
  if (g) {
    const p = behindOf(sim, api, g);
    if (p) return { x: p[0], y: p[1], target: g.id };
  }
  // Исполина рядом нет — к другому столбу через площадь.
  let best: HookRec | null = null;
  let bd = 0;
  for (const o of st.hooks) {
    if (!o.combat || o === hk || o.area !== hk.area) continue;
    const d = hypot(o.x - hk.x, o.y - hk.y);
    if (d < 6 || d > 20) continue;
    if (!best || d < bd) {
      best = o;
      bd = d;
    }
  }
  if (!best) return null;
  const a = Math.atan2(hk.y - best.y, hk.x - best.x);
  return { x: best.x + Math.cos(a) * 0.8, y: best.y + Math.sin(a) * 0.8, target: 0 };
}

/** Точка на дуге полёта (квадратичная кривая + подъём над землёй). */
function flightAt(f: Flight, k: number): [number, number] {
  const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
  const u = 1 - e;
  const x = u * u * f.x0 + 2 * u * e * f.cx + e * e * f.x1;
  const y = u * u * f.y0 + 2 * u * e * f.cy + e * e * f.y1 - Math.sin(Math.PI * k) * f.lift;
  return [x, y];
}

function fireHook(sim: Sim, st: F13State, api: SimApi, hk: HookRec): boolean {
  const h = sim.hero;
  if (st.flight || h.pull || heroDown(sim) || hk.cd > 0) return false;
  const tg = hookTarget(sim, st, api, hk);
  if (!tg) return false;
  hk.cd = HOOK.cd;
  const x0 = h.x;
  const y0 = h.y;
  const dist = hypot(tg.x - x0, tg.y - y0);
  // Дуга: у исполина — в обход его бока, над провалом — вверх.
  let cx = (x0 + tg.x) / 2;
  let cy = (y0 + tg.y) / 2;
  const g = tg.target ? sim.mobs.find((m) => m.id === tg.target) : null;
  if (g) {
    const px = -(tg.y - y0) / (dist || 1);
    const py = (tg.x - x0) / (dist || 1);
    const s = (g.x - cx) * px + (g.y - cy) * py > 0 ? -1 : 1;
    const off = Math.min(3, g.r + 1.2);
    cx += px * off * s;
    cy += py * off * s;
  }
  // Над провалом и Стеной — своим полётом: у движка трос упирается в край.
  const own = !clearLine(sim, api, x0, y0, tg.x, tg.y);
  const T = Math.max(0.35, (dist * (g ? 1.25 : 1)) / HOOK.speed);
  const f: Flight = {
    x0,
    y0,
    x1: tg.x,
    y1: tg.y,
    cx,
    cy,
    t: 0,
    T,
    r0: h.r,
    lift: own ? Math.min(1.6, HOOK.lift + dist * 0.06) : 0.25,
    target: tg.target,
    own,
  };
  st.flight = f;
  if (own) {
    h.r = 0;
    h.vx = 0;
    h.vy = 0;
    if (h.mode === 'dash') h.mode = 'free';
    sim.events.push({ t: 'pull', x: h.x, y: h.y, end: false });
  } else {
    const [px, py] = flightAt(f, 0.2);
    api.pullHero(sim, px, py, { speed: HOOK.speed, inv: true, max: T + 0.8 });
  }
  // Трос: от кольца к герою, поверх темноты.
  const rope: ZX = {
    x: tg.x,
    y: tg.y,
    r: 0.4,
    life: T + 0.12,
    art: 'f13_rope',
    above: true,
    mob: -1,
    tx: hk.x,
    ty: hk.y,
  };
  api.zone(sim, rope);
  sim.events.push({ t: 'boss', what: 'f13_hook_call' });
  // Аномальный чует трос: прыгает туда, куда несёт героя.
  for (const m of sim.mobs) {
    if (m.kind !== 'f13_abnormal' || m.mode === 'dying') continue;
    if (m.mode !== 'stalk' && m.mode !== 'recover' && m.mode !== 'wander') continue;
    if (hypot(m.x - tg.x, m.y - tg.y) > HOOK.range || (m.data.leapCd ?? 0) > 0.6) continue;
    abnormalLeap(sim, m, api, tg.x, tg.y, Math.max(0.35, T - 0.1));
    m.data.leapCd = 4;
    break;
  }
  return true;
}

function stepFlight(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const f = st.flight;
  if (!f) return;
  const h = sim.hero;
  f.t += dt;
  const k = Math.min(1, f.t / f.T);
  if (heroDown(sim)) {
    h.r = f.r0;
    st.flight = null;
    return;
  }
  if (f.own) {
    const [x, y] = flightAt(f, k);
    h.face = Math.atan2(y - h.y, x - h.x) || h.face;
    h.x = x;
    h.y = y;
    h.vx = 0;
    h.vy = 0;
    // Неуязвим весь полёт; выше 0,5 рендер героя не мигает (мигание —
    // знак «укусили», а тут герой летит).
    h.inv = Math.max(h.inv, 0.6);
    // Тень на земле — там, куда он опустится.
    if (k < 1) {
      const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
      const gx = f.x0 + (f.x1 - f.x0) * e;
      const gy = f.y0 + (f.y1 - f.y0) * e;
      st.shadow = [gx, gy];
    }
    if (k >= 1) {
      h.r = f.r0;
      h.x = f.x1;
      h.y = f.y1;
      api.collide(sim, h);
      sim.events.push({ t: 'pull', x: h.x, y: h.y, end: true });
      land(sim, st, api, f);
    }
    return;
  }
  // По земле — движковый трос; цель ведём по дуге.
  if (!h.pull) {
    land(sim, st, api, f);
    return;
  }
  const [x, y] = flightAt(f, Math.min(1, k + 0.22));
  h.pull.tx = k > 0.78 ? f.x1 : x;
  h.pull.ty = k > 0.78 ? f.y1 : y;
}

/** Приземлился: пыль, лицом к исполину; Колоссу в паре — пар сорван. */
function land(sim: Sim, st: F13State, api: SimApi, f: Flight): void {
  const h = sim.hero;
  st.flight = null;
  st.shadow = null;
  // Сел — неуязвимость полёта кончилась без мигания.
  if (h.inv > 0.5) h.inv = 0.08;
  puff(api, sim, 'f13_dust', h.x, h.y + 0.2, 1, 0.45);
  const g = f.target ? sim.mobs.find((m) => m.id === f.target && m.mode !== 'dying') : null;
  if (!g) return;
  h.face = Math.atan2(g.y - h.y, g.x - h.x);
  if (g.kind === 'f13boss' && (sim.boss?.phase ?? 0) === 1) {
    g.data.bareT = COL.bare;
    sim.events.push({
      t: 'boss',
      what: 'f13_steam_off',
      text: sim.floorData.bared ? undefined : 'ПАР СОРВАН',
      sub: sim.floorData.bared ? undefined : 'бей в затылок, пока не затянуло',
    });
    sim.floorData.bared = 1;
  }
}

// ---- Пушка -------------------------------------------------------------------

function fireCannon(sim: Sim, st: F13State, api: SimApi, c: Cannon): boolean {
  if (c.reload > 0) return false;
  const arena = !!sim.boss && api.inArena(sim, c.x, c.y);
  c.reload = st.battery.st === 'on' ? CANNON.battery : arena ? CANNON.arena : CANNON.reload;
  const ux = Math.cos(c.ang);
  const uy = Math.sin(c.ang);
  const x0 = c.x + ux * 1.1;
  const y0 = c.y + uy * 1.1;
  const lvl = sim.world.bands[0].def.level;
  const mobDmg = 24 * Math.pow(1.8, lvl);
  api.strike(sim, {
    shape: 'line',
    x: x0,
    y: y0,
    r: c.len,
    w: CANNON.w,
    ang: c.ang,
    warn: CANNON.warn,
    dmg: rawShare(sim, 0.12),
    knock: 7,
    art: 'f13_lane',
    mobDmg,
  });
  const ball: ZX = {
    x: x0,
    y: y0,
    r: 0.4,
    life: CANNON.warn + 0.4,
    art: 'f13_ball',
    above: true,
    ang: c.ang,
    len: c.len,
    k: CANNON.warn,
  };
  api.zone(sim, ball);
  puff(api, sim, 'f13_muzzle', x0, y0, 1.3, 0.9, true);
  sim.events.push({ t: 'boss', what: 'f13_cannon_wall' });
  sim.events.push({ t: 'flash', color: '#ffc070', k: 0.35 });
  sim.events.push({ t: 'shake', k: 0.45 });
  const key = `cn${c.obj.id}`;
  api.light(sim, key, { x: x0, y: y0, r: 5, tint: 'warm' });
  F13_FX.cannon = sim.time;
  later(sim, st, 0.25, (a) => a.light(sim, key, null));
  // Попадание: исполины валятся, Колосс — на колени.
  later(sim, st, CANNON.warn, (a) => {
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || !F13_GIANTS.has(m.kind)) continue;
      if (!lineHits(x0, y0, c.ang, c.len, CANNON.w, m.x, m.y, m.r)) continue;
      if (m.kind === 'f13boss') {
        if (m.mode === 'rise' || m.mode === 'roar') continue;
        m.hp = Math.max(1, m.hp - m.maxHp * COL.cannonHit);
        m.flash = 0.2;
        a.setMode(m, 'kneel');
        m.data.lit = 0;
        sim.events.push({ t: 'boss', what: 'f13_kneel', text: 'НА КОЛЕНИ', sub: 'затылок открыт со всех сторон' });
        sim.events.push({ t: 'hit', x: m.x, y: m.y, dmg: Math.round(m.maxHp * COL.cannonHit), crit: true, kill: false, boss: true });
      } else knockDown(sim, m, a);
    }
  });
  return true;
}

// ---- Валун ---------------------------------------------------------------------

function dropBoulder(sim: Sim, st: F13State, api: SimApi): boolean {
  const b = st.boulder;
  if (!b || b.used || st.breachEv.sealed || !st.breach.length) return false;
  b.used = true;
  const W = sim.world.w;
  let bx = 0;
  let by = 0;
  for (const i of st.breach) {
    bx += (i % W) + 0.5;
    by += Math.floor(i / W) + 0.5;
  }
  bx /= st.breach.length;
  by /= st.breach.length;
  const roll: ZX = { x: b.x, y: b.y, r: 1, life: 0.95, art: 'f13_roll', above: true, tx: bx, ty: by };
  api.zone(sim, roll);
  sim.events.push({ t: 'boss', what: 'f13_roll_wall' });
  later(sim, st, 0.9, (a) => {
    a.strike(sim, { shape: 'circle', x: bx, y: by, r: 2.6, warn: 0, dmg: 0, art: 'f13_crush', mobDmg: Infinity });
    for (const i of st.breach) a.setTile(sim, i % W, Math.floor(i / W), T_RUBBLE, MK.sealed);
    st.breachEv.sealed = true;
    sim.events.push({ t: 'shake', k: 0.8 });
    puff(a, sim, 'f13_dust', bx, by + 1, 3, 1.2);
    sim.events.push({
      t: 'boss',
      what: 'f13_seal_wall',
      text: 'ПРОЛОМ ЗАВАЛЕН',
      sub: 'назад в поле — калиткой на западе',
    });
    if (!st.breachEv.paid) {
      st.breachEv.paid = true;
      reward(sim, a, b.x, b.y + 1.2, 1600, 16, [
        ['f13mat', 2],
        ['f13_plate', 1],
      ]);
    }
  });
  return true;
}

// ---- Набат -------------------------------------------------------------------

function ringBell(sim: Sim, st: F13State, api: SimApi, free = false): boolean {
  const b = st.bell;
  if (!b || (!free && b.cd > 0)) return false;
  if (!free) b.cd = BELL.cd;
  const wave: ZX = { x: b.x, y: b.y, r: BELL.r, life: 0.9, art: 'f13_bellwave', above: true };
  api.zone(sim, wave);
  sim.events.push({ t: 'boss', what: 'f13_bell_call' });
  sim.events.push({ t: 'flash', color: '#ffe8a0', k: 0.25 });
  api.light(sim, 'bell', { x: b.x, y: b.y, r: 6, tint: 'warm' });
  later(sim, st, 0.4, (a) => a.light(sim, 'bell', null));
  if (free) return true;
  // Волна глушит мелочь и спугивает ворон; исполинов шатает.
  for (const m of sim.mobs) {
    if (m.mode === 'dying' || api.def(m.kind).boss) continue;
    const d = hypot(m.x - b.x, m.y - b.y);
    if (d > BELL.r) continue;
    if (m.kind === 'f13_crow') {
      api.setMode(m, 'flee');
      continue;
    }
    const a = Math.atan2(m.y - b.y, m.x - b.x);
    const mass = api.def(m.kind).mass ?? 1;
    m.kx += (Math.cos(a) * 7) / Math.max(1, mass * 0.4);
    m.ky += (Math.sin(a) * 7) / Math.max(1, mass * 0.4);
    m.hp = Math.max(1, m.hp - m.maxHp * 0.08);
    m.flash = 0.15;
    if (F13_GIANTS.has(m.kind) && m.kind !== 'f13_crawler') knockDown(sim, m, api, 1.4);
    else {
      api.setMode(m, 'stun');
      m.t = -BELL.stun;
    }
  }
  return true;
}

// ---- Залы-события ------------------------------------------------------------

/** «Пожар квартала» (Внешний район): огонь идёт за спиной, балки падают. */
function stepFire(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const F = st.fire;
  const top = st.tops[F13_OUTER];
  if (F.st === 'idle') {
    if (!heroIn(sim, st, F13_OUTER, 11, 66, 16, 82)) return;
    F.st = 'on';
    F.t = 0;
    F.row = 84;
    F.beam = 1.2;
    sim.events.push({ t: 'boss', what: 'f13_fire_trap', text: 'КВАРТАЛ ГОРИТ', sub: 'огонь за спиной — на север!' });
    for (let i = 0; i < 3; i++) {
      const b = api.pickBurrow(sim, 3, 12);
      if (b) api.fromBurrow(sim, b, 'f13_grin');
    }
    return;
  }
  if (F.st !== 'on') return;
  F.t += dt;
  const h = sim.hero;
  const hly = h.y - top;
  // Фронт огня ползёт на север по улице.
  const rowT = 0.55;
  while (F.t > (84 - F.row + 1) * rowT && F.row > 47) {
    F.row -= 1;
    const y = top + F.row + 0.5;
    for (let x = 12; x <= 15; x++)
      api.zone(sim, { x: x + 0.5, y, r: 0.62, life: 7, warn: 0.35, dps: 0.07, status: 'burn', dur: 1.4, art: 'f13_fire' });
    if (F.row % 5 === 0) {
      const key = `fire${F.row}`;
      api.light(sim, key, { x: 14, y, r: 3.4, tint: 'warm' });
      later(sim, st, 7.5, (a) => a.light(sim, key, null));
    }
  }
  // Балки с горящих крыш — впереди героя, с метками.
  F.beam -= dt;
  if (F.beam <= 0 && hly > 48 && h.x < 17) {
    F.beam = 1.25;
    const ly = Math.max(48, Math.floor(hly - 2 - sim.rng() * 4));
    const x = 12 + Math.floor(sim.rng() * 4);
    api.strike(sim, {
      shape: 'circle',
      x: x + 0.5,
      y: top + ly + 0.5,
      r: 0.95,
      warn: 0.9,
      dmg: rawShare(sim, 0.12),
      knock: 4,
      status: 'burn',
      dur: 1.2,
      art: 'f13_beam',
    });
  }
  if (F.t > 8 && F.t - dt <= 8)
    for (let i = 0; i < 2; i++) {
      const b = api.pickBurrow(sim, 3, 10);
      if (b) api.fromBurrow(sim, b, 'f13_grin');
    }
  // Добежал до выхода — квартал пройден.
  if (hly < 49.5 && h.x >= 11 && h.x <= 17) {
    F.st = 'done';
    sim.events.push({ t: 'boss', what: 'f13_fire_call', text: 'ВЫБРАЛСЯ', sub: 'квартал догорает за спиной' });
    reward(sim, api, 13.5, top + 47.5, 1200, 12, [['f13mat', 2]]);
  } else if (F.t > 60 || hly < 40 || h.x > 24) F.st = 'done';
}

/** «Шествие» (Большой проспект): колонна исполинов идёт на юг. */
function stepMarch(sim: Sim, st: F13State, api: SimApi): void {
  const M = st.march;
  const top = st.tops[F13_OUTER];
  if (M.st === 'idle') {
    if (!heroIn(sim, st, F13_OUTER, 24, 30, 39, 46)) return;
    M.st = 'on';
    for (const [x, y] of [
      [29, 2],
      [31, 5],
      [33, 2],
    ]) {
      const m = spawnAt(sim, st, api, 'f13_walker', F13_OUTER, x, y, 'march', x === 31);
      m.data.mx = x + 0.5;
      m.data.my = top + 43.5;
      m.face = Math.PI / 2;
      M.mobs.push(m.id);
    }
    sim.events.push({ t: 'boss', what: 'f13_march_trap', text: 'ШЕСТВИЕ', sub: 'в ниши! бей в спину, когда пройдут' });
    sim.events.push({ t: 'shake', k: 0.4 });
    return;
  }
  if (M.st !== 'on') return;
  const alive = M.mobs.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));
  if (!alive.length) {
    M.st = 'done';
    sim.events.push({ t: 'boss', what: 'f13_march_call', text: 'ШЕСТВИЕ ОСТАНОВЛЕНО', sub: 'у статуи — добыча' });
    reward(sim, api, 31.5, top + 28.5, 2000, 18, [
      ['f13_tooth', 2],
      ['f13mat', 2],
    ]);
  }
}

/** «Пролом в воротах»: исполины лезут, пока валун не завалит проход. */
function stepBreach(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const B = st.breachEv;
  if (B.st === 'idle') {
    if (!heroIn(sim, st, F13_WALL, 38, 44, 50, 66)) return;
    B.st = 'on';
    B.t = 0;
    B.wave = 0;
    sim.events.push({ t: 'boss', what: 'f13_breach_trap', text: 'ПРОЛОМ!', sub: 'лебёдка у пролома — сбрось валун' });
    later(sim, st, 2.5, (a) => {
      if (B.sealed) return;
      const m = spawnAt(sim, st, a, 'f13_armored', F13_WALL, 43, 80, 'stalk');
      m.data.leash = 40;
    });
    return;
  }
  if (B.st !== 'on') return;
  B.t += dt;
  if (B.sealed || B.t > 80) {
    B.st = 'done';
    return;
  }
  if (B.t > B.wave * 6 + 1) {
    B.wave += 1;
    const n = 2 + (B.wave % 2);
    for (let i = 0; i < n; i++) {
      const m = spawnAt(sim, st, api, 'f13_grin', F13_WALL, 42 + i, 69, 'chase');
      m.rush = true;
      m.t = -i * 0.3;
    }
  }
}

/** «Батарея» (дорожка Стены): волны исполинов через поле, стенолазы. */
const BATTERY_WAVES: string[][] = [
  ['f13_walker', 'f13_walker', 'f13_thrower'],
  ['f13_armored', 'f13_walker', 'f13_abnormal'],
  ['f13_walker', 'f13_walker', 'f13_thrower', 'f13_armored'],
];
const CLIMBERS = [2, 2, 3];

function stepBattery(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const B = st.battery;
  const top = st.tops[F13_WALL];
  const h = sim.hero;
  if (B.st === 'idle') {
    const i = Math.floor(h.y) * sim.world.w + Math.floor(h.x);
    if (areaAt(sim, h.y) !== F13_WALL || sim.world.mark[i] !== MK.rampart) return;
    const ly = h.y - top;
    if (ly < 57.5 || ly > 61) return;
    B.st = 'on';
    B.wave = 0;
    B.gap = 1.5;
    sim.events.push({ t: 'boss', what: 'f13_battery_trap', text: 'БАТАРЕЯ, К БОЮ', sub: 'пушки заряжаются быстро — бей по полосам' });
    return;
  }
  if (B.st !== 'on') return;
  B.t += dt;
  const alive = B.mobs.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));
  B.mobs = alive;
  if (B.gap > 0) {
    B.gap -= dt;
    if (B.gap > 0) return;
    if (B.wave >= BATTERY_WAVES.length) {
      B.st = 'done';
      sim.events.push({ t: 'boss', what: 'f13_battery_call', text: 'СТЕНА ВЫСТОЯЛА', sub: 'добыча на Стене' });
      reward(sim, api, h.x, h.y - 0.5, 2400, 22, [
        ['f13_plate', 1],
        ['f13mat', 3],
      ]);
      return;
    }
    const list = BATTERY_WAVES[B.wave];
    list.forEach((kind, n) => {
      const x = 8 + Math.floor(((n + 0.5) / list.length) * 46 + (sim.rng() - 0.5) * 6);
      const m = spawnAt(sim, st, api, kind, F13_WALL, x, 90 + Math.floor(sim.rng() * 4), 'stalk');
      m.data.leash = 60;
      m.face = -Math.PI / 2;
      B.mobs.push(m.id);
    });
    for (let n = 0; n < CLIMBERS[B.wave]; n++) {
      // Стенолаз — рядом с героем по дорожке, руки на зубцах.
      const x = clamp(Math.floor(h.x + (n % 2 ? 1 : -1) * (3 + n * 2 + sim.rng() * 3)), 6, 58);
      const cell = (top + 60) * sim.world.w + x;
      if (sim.world.mark[cell] !== MK.rampart) continue;
      const m = spawnAt(sim, st, api, 'f13_climber', F13_WALL, x, 60, 'climb');
      m.t = -n * 0.8;
      m.data.leash = 30;
      B.mobs.push(m.id);
    }
    B.wave += 1;
    B.t = 0;
    sim.events.push({
      t: 'boss',
      what: 'f13_wave_call',
      text: `ВОЛНА ${B.wave} ИЗ ${BATTERY_WAVES.length}`,
      sub: B.wave === 1 ? 'руки на зубцах — стенолаз лезет' : undefined,
    });
    return;
  }
  if (!alive.length || B.t > 50) B.gap = 4;
}

/** «Колокол тревоги» (Сторожевая площадь): набат, волны, ответный набат. */
function stepAlarm(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const A = st.alarm;
  if (A.st === 'idle') {
    if (!heroIn(sim, st, F13_BELL, 12, 82, 51, 101)) return;
    A.st = 'on';
    A.t = 0;
    A.wave = 0;
    A.tolls = 0;
    sim.events.push({ t: 'boss', what: 'f13_alarm_trap', text: 'КОЛОКОЛ ТРЕВОГИ', sub: 'ударь в набат — волна глушит толпу' });
    return;
  }
  if (A.st !== 'on') return;
  // Ушёл с площади — тревога ждёт: волны лезут у набата, а не за героем.
  if (!heroIn(sim, st, F13_BELL, 2, 74, 61, 106)) return;
  A.t += dt;
  // Набат бьёт сам три раза — созывает.
  if (A.tolls < 3 && A.t > A.tolls * 1.1) {
    A.tolls += 1;
    ringBell(sim, st, api, true);
  }
  A.mobs = A.mobs.filter((id) => sim.mobs.some((m) => m.id === id && m.mode !== 'dying'));
  if (A.wave < 3 && A.t > 2 + A.wave * 13) {
    A.wave += 1;
    for (let i = 0; i < 4; i++) {
      const b = api.pickBurrow(sim, 4, 16);
      if (!b) continue;
      const m = api.fromBurrow(sim, b, 'f13_grin', { rush: true });
      m.t = -i * 0.3;
      A.mobs.push(m.id);
    }
    for (const r of st.roosts) {
      if (hypot(r.x - sim.hero.x, r.y - sim.hero.y) > 22) continue;
      const m = api.spawnMob(sim, 'f13_crow', r.x, r.y, { mode: 'circle' });
      A.mobs.push(m.id);
    }
    if (A.wave === 3) {
      const m = spawnAt(sim, st, api, 'f13_walker', F13_BELL, 10, 78, 'stalk');
      m.data.leash = 30;
      A.mobs.push(m.id);
    }
    sim.events.push({ t: 'boss', what: 'f13_alarm_call', text: `НАБАТ ${A.wave}/3` });
  }
  if (A.wave >= 3 && (!A.mobs.length || A.t > 70)) {
    A.st = 'done';
    sim.events.push({ t: 'boss', what: 'f13_alarm_call', text: 'ПЛОЩАДЬ ОТБИТА', sub: 'у набата — добыча' });
    if (st.bell) reward(sim, api, st.bell.x, st.bell.y + 1.2, 2200, 20, [['f13mat', 3]]);
  }
}

/** «Разлом» (восток Площади): земля дрожит, обломки, вороны над трещиной. */
function stepRift(sim: Sim, st: F13State, api: SimApi, dt: number): void {
  const R = st.rift;
  const top = st.tops[F13_BELL];
  const h = sim.hero;
  const hly = h.y - top;
  const inZone = areaAt(sim, h.y) === F13_BELL && h.x >= 34 && hly >= 53 && hly <= 71;
  if (R.st === 'idle') {
    if (!inZone) return;
    R.st = 'on';
    R.t = 0;
    R.tick = 0.4;
    sim.events.push({ t: 'boss', what: 'f13_rift_trap', text: 'РАЗЛОМ', sub: 'земля уходит — крюк за крюком' });
    return;
  }
  if (R.st !== 'on') return;
  R.t += dt;
  R.tick -= dt;
  // Осыпь — только над трещиной, а не за героем по всему этажу.
  if (R.tick <= 0 && inZone) {
    R.tick = 1.35;
    sim.events.push({ t: 'shake', k: 0.28 });
    for (let i = 0; i < 2; i++) {
      const a = sim.rng() * TAU;
      const d = 0.8 + sim.rng() * 2.4;
      const x = h.x + Math.cos(a) * d;
      const y = h.y + Math.sin(a) * d;
      if (!walkable(tileAt(sim, Math.floor(x), Math.floor(y)))) continue;
      api.strike(sim, {
        shape: 'circle',
        x,
        y,
        r: 0.9,
        warn: 1,
        dmg: rawShare(sim, 0.1),
        knock: 3,
        art: 'f13_debris',
      });
    }
  }
  if (!R.crows && R.t > 2) {
    R.crows = true;
    for (let i = 0; i < 3; i++) api.spawnMob(sim, 'f13_crow', 58.5 - i, top + 74.5, { mode: 'circle' });
  }
  if ((hly < 52.5 && h.x > 33) || R.t > 70 || (!inZone && R.t > 8 && hly > 72)) {
    R.st = 'done';
    if (hly < 52.5)
      sim.events.push({ t: 'boss', what: 'f13_rift_call', text: 'ПЕРЕБРАЛСЯ', sub: 'дальше — площадь Колосса' });
  }
}

// ---- Регистрация -------------------------------------------------------------

registerFloor(13, {
  start(sim, api) {
    STATE.set(sim, scan(sim, api));
  },
  step(sim, dt, api) {
    const st = stateOf(sim, api);
    // Часы действий.
    if (st.timers.length) {
      const due = st.timers.filter((t) => t.at <= sim.time);
      if (due.length) {
        st.timers = st.timers.filter((t) => t.at > sim.time);
        for (const t of due) t.fn(api);
      }
    }
    for (const hk of st.hooks) hk.cd = Math.max(0, hk.cd - dt);
    for (const c of st.cannons) c.reload = Math.max(0, c.reload - dt);
    if (st.bell) st.bell.cd = Math.max(0, st.bell.cd - dt);
    stepFlight(sim, st, api, dt);
    if (heroDown(sim)) return;
    stepPosts(sim, st, api);
    if (sim.boss?.state === 'fight') return;
    stepFire(sim, st, api, dt);
    stepMarch(sim, st, api);
    stepBreach(sim, st, api, dt);
    stepBattery(sim, st, api, dt);
    stepAlarm(sim, st, api, dt);
    stepRift(sim, st, api, dt);
  },
  onUse(sim, obj, api) {
    return f13Use(sim, obj, api);
  },
  useLabel(sim, obj) {
    const st = STATE.get(sim);
    if (!st) return obj.use?.label ?? null;
    switch (obj.ref) {
      case 'f13_hook':
      case 'f13_hookc': {
        if (st.flight || sim.hero.pull) return null;
        const hk = st.hooks.find((x) => x.obj === obj);
        if (!hk || hk.cd > 0) return null;
        if (!hk.combat) return 'Крюк';
        const g = giantNear(sim, hk.x, hk.y, HOOK.range);
        return g ? 'Крюк за спину' : 'Крюк';
      }
      case 'f13_cannon': {
        const c = st.cannons.find((x) => x.obj === obj);
        return c && c.reload > 0 ? 'Заряжается…' : 'Выстрел';
      }
      case 'f13_boulder':
        return st.boulder?.used || st.breachEv.sealed ? null : 'Сбросить валун';
      case 'f13_bell':
        return st.bell && st.bell.cd > 0 ? null : 'Набат';
    }
    return obj.use?.label ?? null;
  },
});

/** Нажать действие у предмета этажа (для тестов: как кнопка «Действие»). */
export function f13Use(sim: Sim, obj: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim, api);
  switch (obj.ref) {
    case 'f13_hook':
    case 'f13_hookc': {
      const hk = st.hooks.find((x) => x.obj === obj);
      return hk ? fireHook(sim, st, api, hk) : false;
    }
    case 'f13_cannon': {
      const c = st.cannons.find((x) => x.obj === obj);
      return c ? fireCannon(sim, st, api, c) : false;
    }
    case 'f13_boulder':
      return dropBoulder(sim, st, api);
    case 'f13_bell':
      return ringBell(sim, st, api);
  }
  return false;
}
