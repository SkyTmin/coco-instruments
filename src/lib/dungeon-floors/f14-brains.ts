// Этаж 14 «Часовая башня» — ИИ монстров, правила этажа и сценарий
// Повелителя часа.
//
// ВРЕМЯ — глагол этажа. Его держат три вещи:
//   • ОСТАНОВКА МИРА — `api.timeScale` (Движок 3). Колокол «ЧАС» (раз в
//     минуту: в Механизме реже, на Циферблате чаще) — мир стоит, ходит
//     только герой; удары по замершим ложатся, а отдача копится и
//     срывается разом, когда время пошло. Повелитель часа — стоят все,
//     и сам герой, кроме Повелителя: он ставит ножи;
//   • СФЕРЫ ВРЕМЕНИ — своё время по месту: внутри голубой сферы монстры,
//     их снаряды и метки ударов идут медленнее, в янтарной — быстрее, и
//     герой в них шагает иначе (зона со `slow`). Считает обёртка ИИ
//     этажа (`timed`) и шаг времени (`stepTime`);
//   • ИСТОРИЯ — этаж помнит, где был герой 8 с (двойник идёт по следу и
//     повторяет удары), отмотчик — где был он сам и сколько было
//     здоровья, Повелитель — своё здоровье (отмотка).
//
// Правила этажа (`registerFloor(14)`):
//   • КОЛОКОЛ «ЧАС»: за 3 с — «бьёт час», потом мир стоит 2 с;
//   • МАЯТНИКИ поперёк Галереи: лезвие ходит по такту, бьёт и отбрасывает
//     (и героя, и солдатиков), в «ЧАС» замирает;
//   • ЗАЛ ШЕСТЕРЁН (зал-событие Механизма): два кольца латунных зубьев
//     вращаются навстречу — тик-так, по зубу, проёмы не совпадают; из люков
//     лезут жуки; стопор (действие) держит кольца восемь секунд;
//   • ЗАВОД (зал-событие Механизма): вошёл — огромный ключ поворачивается,
//     и строй солдатиков оживает шеренга за шеренгой; стопор (действие) за
//     строем держит ключ — остальные так и стоят (разбирай на пружины);
//   • ПЕРЕВЁРНУТЫЕ ЧАСЫ (зал-событие Песочных часов): вошёл в верхнюю
//     колбу — часы переворачиваются, песок поднимается от горловины к
//     выходу; в песке вязнешь и задыхаешься, из него встают призраки;
//     малые часы (действие) держат песок;
//   • ОТМОТКА (зал-событие Песочных часов): решётка падает, Великие часы
//     сыплются; перевернулись — все павшие за круг встают из песка там,
//     где пали, пока целы три якоря;
//   • СТОП-КАДР (зал-событие Циферблата): битва замерла на полувзмахе,
//     ножи висят; дошёл до середины (или толкнул маятник — действие) —
//     три секунды, и время идёт: ножи летят по своим линиям;
//   • ПОЛДЕНЬ (зал-событие Циферблата): две стрелки метут площадь, в
//     полдень бьёт колокол; ступица — единственное место, где стрелки не
//     достают; кончик минутной — свет на ходу;
//   • КОЛОКОЛ Колокольни (действие): «ЧАС» по желанию — раз в 40 с;
//   • ПОСТЫ: гири под лебёдками, кукушки в часах, солдатики в строю.
//
// Честность: всё, что бьёт, видно заранее — линия штыка и клюва, конусы
// косы, круг гири (тень), линии стрелок, метка возврата отмотчика, линии
// ножей; лезвие маятника и стрелки площади видны сами и ходят ровно.
//
// Движок сюда не импортируется значениями (круг модулей) — только `api`.

import { registerBoss, registerBrain, registerFloor } from '../dungeon-ai';
import type { Brain, BrainCtx, SimApi, ZoneIn } from '../dungeon-ai';
import type { BossFight, Mob, Prop, Shot, Sim, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F14_DIAL, F14_GEO, F14_MARK, F14_MECH, F14_SAND } from './f14';

const TAU = Math.PI * 2;
const hypot = Math.hypot;

// Клетки мира (копия `Tile` из `dungeon-world.ts`: значениями движок не
// импортируется).
const T_WALL = 1;
const T_FLOOR = 2;
const T_HAZARD = 12;

const MK = F14_MARK;

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
    if (api.solidTile(sim, cx, cy)) continue;
    if (
      api.solidTile(sim, cx + 1, cy) ||
      api.solidTile(sim, cx - 1, cy) ||
      api.solidTile(sim, cx, cy + 1) ||
      api.solidTile(sim, cx, cy - 1)
    )
      continue;
    if (!clearLine(sim, api, x, y, cx + 0.5, cy + 0.5)) continue;
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

/** Мировые координаты точки района из `F14_GEO`. */
function geoWorld(sim: Sim, g: { area: string; x: number; y: number }): [number, number] {
  const b = sim.world.bands.find((x) => x.def.id === g.area);
  return [g.x, (b?.top ?? 0) + g.y];
}

/**
 * Убить моба окружением (маятник, гиря, стрелка): удар по своим без урона
 * герою — движок засчитает убийство и бросит добычу.
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
    art: 'f14_none',
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

// ---------------------------------------------------------------------------
// Видимое для рисовальщика: кадр — одна вылазка на экране.
// ---------------------------------------------------------------------------

export const F14_FX = {
  /** До удара колокола, с (для настенных часов: стрелка к двенадцати). */
  bellIn: 60,
  /** Период колокола в этом районе, с. */
  bellP: 60,
  /** Смещение лезвия маятника (клетки) и его скорость — по id предмета. */
  pend: new Map<string, { off: number; v: number }>(),
  /** Зубья шестерён: id предмета → угол и место. */
  teeth: new Map<string, { ang: number; x: number; y: number }>(),
  /** Угол колец шестерён (для ступицы). */
  gearAng: 0,
  /** Стрелки: площадь и арена — углы (0 — XII, по часовой). */
  hands: {
    plaza: { m: 0, h: 0, on: 0 },
    arena: { m: 0, h: 0, on: 0 },
  },
  /** Песок верхней колбы: ряд фронта (мировой), 0 — нет. */
  flood: { front: 0, bottom: 0, top: 0, cx: 0, cy: 0, rx: 0, ry: 0, paused: 0 },
  /** Великие часы Зала отмотки: сколько песка сверху 0…1, разбиты ли. */
  bigGlass: { k: 1, broken: 0, flip: 0, on: 0 },
  /** Завод: крутится ли ключ, остановлен ли. */
  key: { spin: 0, stopped: 0 },
  /** Стопоры: id предмета → опущен ли. */
  levers: new Map<string, number>(),
  /** Кукушкины часы: id предмета → 0 закрыты, 1 открыты, 2 сломаны. */
  cuckoo: new Map<string, number>(),
  /** Малые часы: id → 0 целы, 1 перевёрнуты. */
  glasses: new Map<string, number>(),
  /** Колокол: когда бил (часы сцены) — качается. */
  bell: -9,
  /** Маятник Стоп-кадра: 0 стоит, 1 идёт. */
  frame: 0,
  /** Полночь: сколько ламп погасло (0…12). */
  midnight: 0,
  /** Фаза Повелителя (для вида арены и его рисунка). */
  bossPhase: 0,
  /** Часы сцены: растут с миром, в «ЧАС» стоят. */
  clock: 0,
};

// ---------------------------------------------------------------------------
// Время этажа.
// ---------------------------------------------------------------------------

interface Sphere {
  x: number;
  y: number;
  r: number;
  /** Множитель времени внутри для монстров и снарядов. */
  k: number;
  /** Когда исчезнет (время симуляции), Infinity — навсегда. */
  until: number;
  zone: number;
}

interface HistPt {
  t: number;
  x: number;
  y: number;
}

interface TimeState {
  /** Кто остановил мир последним и на сколько. */
  by: 'bell' | 'boss' | null;
  dur: number;
  was: boolean;
  spheres: Sphere[];
  /** Какой множитель уже применён к снаряду. */
  shotK: Map<number, number>;
  /** История героя (8 с). */
  hist: HistPt[];
  histT: number;
  /** Удары героя с местом и углом — двойник их повторит. */
  swings: { t: number; x: number; y: number; ang: number; heavy: boolean }[];
  /** Колокол. */
  bellT: number;
  bellWarn: boolean;
  /** «Вдох» перед остановкой (за 2 с — под звук `timeStop`). */
  bellWind: boolean;
  bells: number;
}

const TIME = new WeakMap<Sim, TimeState>();

function timeOf(sim: Sim): TimeState {
  let t = TIME.get(sim);
  if (!t) {
    t = {
      by: null,
      dur: 0,
      was: false,
      spheres: [],
      shotK: new Map(),
      hist: [],
      histT: 0,
      swings: [],
      // Первый удар — почти сразу: глагол этажа видно в первые секунды.
      bellT: 9,
      bellWarn: false,
      bellWind: false,
      bells: 0,
    };
    TIME.set(sim, t);
  }
  return t;
}

/** Мир стоит (колокол или Повелитель). */
export const worldStopped = (sim: Sim) => sim.scaleT > 0 && sim.worldScale < 0.01;

/** Сколько настоящих секунд идёт остановка. */
const stopElapsed = (sim: Sim) => {
  const T = TIME.get(sim);
  return T ? T.dur - sim.scaleT : 0;
};

/** Сферы и песок: множитель времени в точке для монстров и снарядов. */
function localK(sim: Sim, x: number, y: number, kind?: string): number {
  const T = TIME.get(sim);
  if (!T) return 1;
  let k = 1;
  for (const s of T.spheres) if (hypot(s.x - x, s.y - y) < s.r) k *= s.k;
  // Песок верхней колбы: вязнут все, кроме песочных призраков.
  const fl = FLOOD.get(sim);
  if (fl && fl.state !== 'idle' && kind !== 'f14_sand' && inFlood(fl, x, y)) k *= 0.55;
  return k;
}

/** Поставить сферу времени (зона — картинка и шаг героя). */
function addSphere(
  sim: Sim,
  api: SimApi,
  x: number,
  y: number,
  r: number,
  k: number,
  life: number,
): void {
  const T = timeOf(sim);
  // Героя сфера замедляет мягче, чем монстров: это инструмент, а не ловушка.
  const hero = k < 1 ? 0.62 : 1.28;
  const z: ZoneIn & { f14k: number } = {
    x,
    y,
    r,
    life,
    slow: hero,
    art: k < 1 ? 'f14_slow' : 'f14_fast',
    f14k: k,
  };
  api.zone(sim, z);
  const zone = sim.zones[sim.zones.length - 1];
  T.spheres.push({ x, y, r, k, until: life > 1e8 ? Infinity : sim.time + life, zone: zone.id });
}

/**
 * Остановить мир. Колокол — стоят все, кроме героя; Повелитель — стоит и
 * герой (а сценарий Повелителя считает настоящие секунды сам).
 */
function stopWorld(sim: Sim, api: SimApi, dur: number, by: 'bell' | 'boss'): void {
  const T = timeOf(sim);
  T.by = by;
  T.dur = dur;
  api.timeScale(sim, 0, by === 'boss' ? 0 : 1, dur);
  sim.events.push({ t: 'flash', color: by === 'boss' ? '#fff0c0' : '#d8e4ff', k: 0.9 });
  sim.events.push({ t: 'shake', k: by === 'boss' ? 0.35 : 0.2 });
}

/** Шаг времени этажа ДО снарядов, меток и мобов: сферы и история. */
function stepTime(sim: Sim, api: SimApi, dt: number): void {
  const T = timeOf(sim);
  const h = sim.hero;
  const stopped = worldStopped(sim);
  if (T.was && !stopped) {
    T.was = false;
    sim.events.push({ t: 'boss', what: 'f14_resume' });
  }
  if (stopped) T.was = true;
  // История героя: 10 раз в секунду (время мира — в «ЧАС» не пишется).
  T.histT -= dt;
  if (T.histT <= 0) {
    T.histT = 0.1;
    T.hist.push({ t: sim.time, x: h.x, y: h.y });
    while (T.hist.length && T.hist[0].t < sim.time - 8.5) T.hist.shift();
  }
  while (T.swings.length && T.swings[0].t < sim.time - 8) T.swings.shift();
  if (T.spheres.length)
    T.spheres = T.spheres.filter(
      (s) => s.until > sim.time && sim.zones.some((z) => z.id === s.zone),
    );
  if (stopped) return;
  // Сферы: снаряды и метки внутри живут медленнее (или быстрее).
  const fl = FLOOD.get(sim);
  if (T.spheres.length || (fl && fl.state !== 'idle')) {
    for (const s of sim.shots) {
      if (KNIFE_ANG.has(s.id) && s.vx === 0 && s.vy === 0) continue;
      const k = localK(sim, s.x, s.y, s.kind);
      const was = T.shotK.get(s.id) ?? 1;
      if (Math.abs(k - was) > 1e-3) {
        s.vx *= k / was;
        s.vy *= k / was;
        T.shotK.set(s.id, k);
      }
      if (k !== 1) s.age -= dt * (1 - k);
    }
    for (const st of sim.strikes) {
      const k = localK(sim, st.x, st.y);
      if (k !== 1) st.t -= dt * (1 - k);
    }
  }
  if (T.shotK.size > 200) {
    const live = new Set(sim.shots.map((s) => s.id));
    for (const id of T.shotK.keys()) if (!live.has(id)) T.shotK.delete(id);
  }
  void api;
}

/**
 * Обёртка ИИ этажа: мир стоит — не шагает (режимы не меняются); в сфере —
 * шагает медленнее (часы режима и отдыха тоже), скорость — по той же доле.
 */
function timed(b: Brain): Brain {
  return {
    ...b,
    step(sim, m, dt, c, api) {
      if (worldStopped(sim)) {
        m.danger = 0;
        return;
      }
      // Замер в Стоп-кадре (или стопор Завода): стоит, пока время не пошло.
      if (m.mode === 'f14_frozen' && m.kind !== 'f14_soldier') {
        m.vx = 0;
        m.vy = 0;
        m.tele = null;
        m.danger = 0;
        return;
      }
      if (m.data.tvx !== undefined) {
        m.vx = m.data.tvx;
        m.vy = m.data.tvy ?? 0;
        delete m.data.tvx;
        delete m.data.tvy;
      }
      const k = localK(sim, m.x, m.y, m.kind);
      if (k !== 1) {
        m.t -= dt * (1 - k);
        m.cd += dt * (1 - k);
      }
      b.step(sim, m, dt * k, c, api);
      if (k !== 1) {
        m.data.tvx = m.vx;
        m.data.tvy = m.vy;
        m.vx *= k;
        m.vy *= k;
      }
    },
  };
}

const brain = (id: string, b: Brain) => registerBrain(id, timed(b));

// ---------------------------------------------------------------------------
// Заводной солдатик: марширует по осям, штык по линии. Ключ в спине
// крутится и кончается; удар сзади — по ключу — сразу стоп.
// ---------------------------------------------------------------------------

export const SOLDIER = {
  aim: 0.7,
  len: 2.3,
  /** Сколько завода тратит секунда шага. */
  drain: 0.075,
  unwound: 2.8,
  rewind: 1.2,
};

brain('f14_soldier', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    if (m.data.wind === undefined) m.data.wind = 0.6 + sim.rng() * 0.4;
    switch (m.mode) {
      case 'f14_statue':
      case 'f14_frozen':
        // Стоит в строю: ждёт ключа (или стопор его остановил).
        m.vx *= 0.5;
        m.vy *= 0.5;
        m.data.ghost = m.mode === 'f14_statue' ? 1 : 0;
        if (!m.data.frame) m.face = Math.PI / 2;
        return;
      case 'f14_waking':
        m.data.ghost = 0;
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t > 0.8) {
          m.data.wind = 1;
          api.setMode(m, 'chase');
        }
        return;
      case 'f14_unwound':
        // Завод кончился: стоит, ключ не крутится — открыт.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > SOLDIER.unwound) api.setMode(m, 'f14_rewind');
        return;
      case 'f14_rewind':
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > SOLDIER.rewind) {
          m.data.wind = 1;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        m.data.ghost = 0;
        m.data.wind -= dt * SOLDIER.drain;
        if (m.data.wind <= 0) {
          m.data.wind = 0;
          api.setMode(m, 'f14_unwound');
          sim.events.push({ t: 'clank', x: m.x, y: m.y });
          return;
        }
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        // Штык — по оси: солдатик колет прямо, как оловянный.
        const ax = Math.abs(dx) > Math.abs(dy);
        const along = ax ? Math.abs(dx) : Math.abs(dy);
        const off = ax ? Math.abs(dy) : Math.abs(dx);
        if (
          see &&
          m.cd <= 0 &&
          along < SOLDIER.len + 0.4 &&
          off < 0.9 &&
          dist < SOLDIER.len + 0.8
        ) {
          m.dir = ax ? (dx > 0 ? 0 : Math.PI) : dy > 0 ? Math.PI / 2 : -Math.PI / 2;
          api.setMode(m, 'aim');
          return;
        }
        // Марш по осям: к герою по большей оси, у цели — выравнивается.
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        let mx = cx;
        let my = cy;
        if (see && dist < 7) {
          if (off > 0.35 && along < SOLDIER.len + 1) {
            mx = ax ? 0 : Math.sign(dx);
            my = ax ? Math.sign(dy) : 0;
          } else {
            mx = ax ? Math.sign(dx) : 0;
            my = ax ? 0 : Math.sign(dy);
          }
        }
        api.steer(sim, m, mx, my, m.speed, dt);
        return;
      }
      case 'aim': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        const len = Math.min(SOLDIER.len, clearDist(sim, api, m.x, m.y, m.dir, SOLDIER.len));
        m.tele = { shape: 'line', r: len, w: 0.32, ang: m.dir, k: clamp(m.t / SOLDIER.aim, 0, 1) };
        if (m.t > SOLDIER.aim - 0.24) m.danger = len + 0.4;
        if (m.t >= SOLDIER.aim) {
          // Выпад: штык по линии.
          const ux = Math.cos(m.dir);
          const uy = Math.sin(m.dir);
          const hx = h.x - m.x;
          const hy = h.y - m.y;
          const al = hx * ux + hy * uy;
          const ac = Math.abs(-hx * uy + hy * ux);
          if (al > -0.2 && al < len + h.r && ac < 0.32 + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 5, m.kind);
          m.vx = ux * 7;
          m.vy = uy * 7;
          api.setMode(m, 'recover');
          m.cd = 0.9 + sim.rng() * 0.5;
          m.data.wind -= 0.08;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.75);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, hit) {
    if (m.mode === 'f14_statue') return 0;
    if (m.mode === 'f14_frozen') return 2;
    if (m.mode === 'f14_unwound' || m.mode === 'f14_rewind') return 1.6;
    // Сзади — по ключу: завод слетает, солдатик встаёт.
    const behind = Math.abs(angDiff(hit.ang, m.face)) < 0.95;
    if (behind && m.mode !== 'f14_waking') {
      m.data.wind = 0;
      m.mode = 'f14_unwound';
      m.t = 0;
      m.tele = null;
      m.danger = 0;
      sim.events.push({ t: 'clank', x: m.x, y: m.y });
      return 1.5;
    }
    return 1;
  },
  onDeath(sim, m) {
    postDead(sim, m);
  },
});

// ---------------------------------------------------------------------------
// Кукушка: живёт в часах на стене; дверцы, клюв на пружине по линии;
// вылетела — открыта, пока пружина не втянула.
// ---------------------------------------------------------------------------

export const CUCKOO = {
  see: 6.2,
  call: 0.45,
  aim: 0.75,
  peck: 0.14,
  out: 1.4,
  back: 0.3,
  len: 3.6,
};

/** Номера часов с кукушкой: индекс в `m.data.clock` → id предмета. */
const CLOCK_IDS: string[] = [];

brain('f14_cuckoo', {
  step(sim, m, _dt, _c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    m.vx = 0;
    m.vy = 0;
    m.kx = 0;
    m.ky = 0;
    const nx = m.data.nx ?? m.x;
    const ny = m.data.ny ?? m.y;
    const clock = m.data.clock;
    const setDoor = (v: number) => {
      if (clock !== undefined) F14_FX.cuckoo.set(CLOCK_IDS[clock] ?? '', v);
    };
    switch (m.mode) {
      case 'chase':
      case 'f14_nest': {
        if (m.mode !== 'f14_nest') api.setMode(m, 'f14_nest');
        m.data.ghost = 1;
        m.x = nx;
        m.y = ny;
        setDoor(0);
        const hd = hypot(h.x - nx, h.y - ny);
        if (
          hd < CUCKOO.see &&
          m.cd <= 0 &&
          h.y > ny - 0.6 &&
          api.lineOfSight(sim, nx, ny, h.x, h.y)
        ) {
          api.setMode(m, 'f14_call');
          sim.events.push({ t: 'boss', what: 'f14_cuckoo' });
        }
        return;
      }
      case 'f14_call':
        setDoor(1);
        m.face = Math.atan2(h.y - ny, h.x - nx);
        if (m.t > CUCKOO.call) {
          m.dir = Math.atan2(h.y - ny, h.x - nx);
          // Пружина не бьёт вверх, в стену.
          if (Math.sin(m.dir) < 0.2) m.dir = Math.atan2(0.2, Math.cos(m.dir) || 0.01);
          m.data.len = Math.max(
            1,
            Math.min(CUCKOO.len, clearDist(sim, api, nx, ny, m.dir, CUCKOO.len) - 0.2),
          );
          api.setMode(m, 'aim');
        }
        return;
      case 'aim': {
        setDoor(1);
        m.face = m.dir;
        const len = m.data.len ?? CUCKOO.len;
        m.tele = {
          shape: 'line',
          r: len,
          w: 0.3,
          ang: m.dir,
          k: clamp(m.t / CUCKOO.aim, 0, 1),
          x: nx,
          y: ny,
        };
        if (m.t > CUCKOO.aim - 0.25) m.danger = len + 0.6;
        if (m.t >= CUCKOO.aim) {
          const ux = Math.cos(m.dir);
          const uy = Math.sin(m.dir);
          const hx = h.x - nx;
          const hy = h.y - ny;
          const al = hx * ux + hy * uy;
          const ac = Math.abs(-hx * uy + hy * ux);
          if (al > -0.2 && al < len + h.r && ac < 0.3 + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg, nx, ny, 5, m.kind);
          api.setMode(m, 'f14_peck');
        }
        return;
      }
      case 'f14_peck': {
        // Пружина выстреливает: птица в конце линии.
        setDoor(1);
        const len = m.data.len ?? CUCKOO.len;
        const k = clamp(m.t / CUCKOO.peck, 0, 1);
        m.x = nx + Math.cos(m.dir) * len * k;
        m.y = ny + Math.sin(m.dir) * len * k;
        m.data.ghost = 0;
        if (k >= 1) api.setMode(m, 'f14_out');
        return;
      }
      case 'f14_out': {
        setDoor(1);
        const len = m.data.len ?? CUCKOO.len;
        const bob = Math.sin(m.t * 12) * 0.12 * (1 - m.t / CUCKOO.out);
        m.x = nx + Math.cos(m.dir) * (len + bob);
        m.y = ny + Math.sin(m.dir) * (len + bob);
        m.data.ghost = 0;
        if (m.t > CUCKOO.out) api.setMode(m, 'f14_back');
        return;
      }
      case 'f14_back': {
        setDoor(1);
        const len = m.data.len ?? CUCKOO.len;
        const k = 1 - clamp(m.t / CUCKOO.back, 0, 1);
        m.x = nx + Math.cos(m.dir) * len * k;
        m.y = ny + Math.sin(m.dir) * len * k;
        if (k <= 0.3) m.data.ghost = 1;
        if (k <= 0) {
          m.cd = 1.4 + sim.rng() * 0.8;
          api.setMode(m, 'f14_nest');
        }
        return;
      }
      case 'stun':
        return;
      default:
        api.setMode(m, 'f14_nest');
    }
  },
  onHit(_sim, m) {
    if ((m.data.ghost ?? 0) > 0) return 0;
    return m.mode === 'f14_out' ? 1.3 : 1;
  },
  onDeath(sim, m) {
    const clock = m.data.clock;
    if (clock !== undefined) F14_FX.cuckoo.set(CLOCK_IDS[clock] ?? '', 2);
    postDead(sim, m);
  },
});

// ---------------------------------------------------------------------------
// Песочный призрак: когти вблизи, песок в глаза конусом; от удара
// рассыпается и собирается рядом, выходя из песка ударом снизу.
// ---------------------------------------------------------------------------

export const SAND = {
  blastR: 2.6,
  blastArc: 1.2,
  blastWarn: 0.75,
  under: 1.1,
  rise: 0.5,
  riseR: 1.05,
};

brain('f14_sand', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.bCd = (m.data.bCd ?? 1.5 + sim.rng() * 2) - dt;
    m.data.sCd = (m.data.sCd ?? 0) - dt;
    if (m.data.sinkNext) {
      m.data.sinkNext = 0;
      if (m.mode !== 'f14_sink' && m.mode !== 'f14_under' && m.mode !== 'f14_rise') {
        api.setMode(m, 'f14_sink');
        sim.events.push({ t: 'boss', what: 'f14_sandpuff' });
      }
    }
    switch (m.mode) {
      case 'f14_sink':
        m.data.ghost = 1;
        m.vx *= 0.5;
        m.vy *= 0.5;
        if (m.t > 0.35) {
          const to = spotNear(
            sim,
            api,
            h.x,
            h.y,
            1.6,
            2.6,
            (px, py) => -hypot(px - m.x, py - m.y) * 0.2,
          );
          m.data.tx = to ? to[0] : m.x;
          m.data.ty = to ? to[1] : m.y;
          api.setMode(m, 'f14_under');
        }
        return;
      case 'f14_under': {
        // Бугор песка ползёт к месту, откуда встанет.
        m.data.ghost = 1;
        const ex = (m.data.tx ?? m.x) - m.x;
        const ey = (m.data.ty ?? m.y) - m.y;
        const el = hypot(ex, ey);
        if (el > 0.2 && m.t < SAND.under) api.steer(sim, m, ex / el, ey / el, 5.5, dt);
        else {
          m.vx = 0;
          m.vy = 0;
          api.strike(sim, {
            shape: 'circle',
            x: m.x,
            y: m.y,
            r: SAND.riseR,
            warn: SAND.rise,
            dmg: m.dmg * 1.1,
            knock: 5,
            art: 'f14_sandrise',
            from: m.id,
          });
          api.setMode(m, 'f14_rise');
        }
        return;
      }
      case 'f14_rise':
        m.data.ghost = m.t < SAND.rise - 0.1 ? 1 : 0;
        m.vx = 0;
        m.vy = 0;
        if (m.t > SAND.rise - 0.2) m.danger = SAND.riseR + 0.3;
        if (m.t > SAND.rise + 0.15) {
          m.data.ghost = 0;
          api.setMode(m, 'recover');
        }
        return;
      case 'chase': {
        m.data.ghost = 0;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0 && dist < def.reach + m.r + h.r + 0.25) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (see && m.data.bCd <= 0 && dist > 1.4 && dist < SAND.blastR) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f14_blast');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 3 + m.id) * 0.35;
        api.steer(sim, m, cx - cy * z, cy + cx * z, m.speed, dt);
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (m.t > def.windup - 0.22) m.danger = def.reach + m.r + 0.6;
        if (m.t >= def.windup) {
          if (dist < def.reach + m.r + h.r + 0.15 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
          api.setMode(m, 'recover');
          m.cd = 0.9 + sim.rng() * 0.5;
        }
        return;
      }
      case 'f14_blast': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        m.face = m.dir;
        if (!m.data.lit) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: SAND.blastR,
            ang: m.dir,
            arc: SAND.blastArc,
            warn: SAND.blastWarn,
            dmg: m.dmg * 0.7,
            knock: 2,
            status: 'slow',
            dur: 1.8,
            art: 'f14_sandblast',
            from: m.id,
          });
        }
        if (m.t > SAND.blastWarn - 0.25) m.danger = SAND.blastR + 0.3;
        if (m.t >= SAND.blastWarn) {
          m.data.lit = 0;
          m.data.bCd = 5 + sim.rng() * 3;
          api.setMode(m, 'recover');
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m) {
    if ((m.data.ghost ?? 0) > 0) return 0;
    // Рассыпается от удара — не всегда и не чаще раза в 3 с (урон ложится).
    if (
      (m.data.sCd ?? 0) <= 0 &&
      m.mode !== 'windup' &&
      m.mode !== 'f14_blast' &&
      sim.rng() < 0.4
    ) {
      m.data.sCd = 3;
      m.data.sinkNext = 1;
    }
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Отмотчик: помнит 3 с своего прошлого. Ранен — через полсекунды
// отматывается туда со здоровьем. Метка якоря горит на полу; встал на
// неё — отмотка сорвана, он оглушён и открыт.
// ---------------------------------------------------------------------------

export const REWIND = { back: 3, window: 0.55, fly: 0.45, cd: 5.5, anchorR: 0.9 };

interface RwPt {
  t: number;
  x: number;
  y: number;
  hp: number;
}
const RW_HIST = new WeakMap<Mob, RwPt[]>();

/** Точка прошлого отмотчика (за `back` секунд). */
export function rewindAnchor(sim: Sim, m: Mob): RwPt | null {
  const hs = RW_HIST.get(m);
  if (!hs || !hs.length) return null;
  const t = sim.time - REWIND.back;
  let best = hs[0];
  for (const p of hs) if (p.t <= t) best = p;
  return best;
}

/** След прошлого (для рисунка): точки от якоря до сейчас. */
export const rewindTrail = (m: Mob): readonly RwPt[] => RW_HIST.get(m) ?? [];

brain('f14_rewinder', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    m.data.rwCd = (m.data.rwCd ?? 0) - dt;
    let hs = RW_HIST.get(m);
    if (!hs) RW_HIST.set(m, (hs = []));
    m.data.recT = (m.data.recT ?? 0) - dt;
    if (m.data.recT <= 0 && m.mode !== 'f14_rewind') {
      m.data.recT = 0.1;
      hs.push({ t: sim.time, x: m.x, y: m.y, hp: m.hp });
      while (hs.length && hs[0].t < sim.time - REWIND.back - 0.5) hs.shift();
    }
    if (m.mode === 'stun') return;
    // Ранен: окно перед отмоткой.
    if (m.data.rwAt !== undefined && m.mode !== 'f14_rewind') {
      if (sim.time >= m.data.rwAt) {
        delete m.data.rwAt;
        const ax = m.data.ax ?? m.x;
        const ay = m.data.ay ?? m.y;
        if (hypot(h.x - ax, h.y - ay) < REWIND.anchorR + h.r && !heroDown(sim)) {
          // Якорь занят героем: отмотка сорвана.
          api.setMode(m, 'f14_dazed');
          m.data.broken = 1;
          m.data.rwCd = REWIND.cd;
          sim.events.push({
            t: 'boss',
            what: 'f14_anchor_stone',
            text: 'ЯКОРЬ ЗАНЯТ',
            sub: 'отмотка сорвана — бей',
          });
          return;
        }
        const a = rewindAnchor(sim, m);
        m.data.fromX = m.x;
        m.data.fromY = m.y;
        m.data.hp0 = m.hp;
        m.data.hp1 = Math.max(m.hp, a?.hp ?? m.hp);
        api.setMode(m, 'f14_rewind');
        sim.events.push({ t: 'boss', what: 'f14_rewind' });
        return;
      }
    }
    switch (m.mode) {
      case 'f14_rewind': {
        // Летит назад по следу; здоровье течёт обратно.
        m.data.ghost = 1;
        const k = clamp(m.t / REWIND.fly, 0, 1);
        const e = k * k * (3 - 2 * k);
        const tx = m.data.ax ?? m.x;
        const ty = m.data.ay ?? m.y;
        m.x = (m.data.fromX ?? m.x) + (tx - (m.data.fromX ?? m.x)) * e;
        m.y = (m.data.fromY ?? m.y) + (ty - (m.data.fromY ?? m.y)) * e;
        m.vx = 0;
        m.vy = 0;
        m.hp = (m.data.hp0 ?? m.hp) + ((m.data.hp1 ?? m.hp) - (m.data.hp0 ?? m.hp)) * e;
        if (k >= 1) {
          m.data.ghost = 0;
          m.data.rwCd = REWIND.cd;
          RW_HIST.set(m, []);
          api.setMode(m, 'chase');
        }
        return;
      }
      case 'f14_dazed':
        // Сорвали отмотку: стоит, стрелки внутри сломаны — открыт.
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t > 1.6) {
          m.data.broken = 0;
          api.setMode(m, 'chase');
        }
        return;
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0 && dist < def.reach + m.r + h.r + 0.3) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (m.t > def.windup - 0.22) m.danger = def.reach + m.r + 0.6;
        if (m.t >= def.windup) {
          if (dist < def.reach + m.r + h.r + 0.2 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 4, m.kind);
          m.vx = Math.cos(m.dir) * 3;
          m.vy = Math.sin(m.dir) * 3;
          api.setMode(m, 'recover');
          m.cd = 0.8 + sim.rng() * 0.5;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 0.6);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(sim, m, _hit, api) {
    if (m.mode === 'f14_rewind') return 0;
    if (m.mode === 'f14_dazed') return 1.5;
    if ((m.data.rwCd ?? 0) <= 0 && m.data.rwAt === undefined) {
      m.data.rwAt = sim.time + REWIND.window;
      const a = rewindAnchor(sim, m);
      m.data.ax = a ? a.x : m.x;
      m.data.ay = a ? a.y : m.y;
      // Якорь виден: куда его унесёт и откуда тянется след.
      api.zone(sim, {
        x: m.data.ax,
        y: m.data.ay,
        r: REWIND.anchorR,
        life: REWIND.window + REWIND.fly,
        art: 'f14_anchor',
        mob: m.id,
      } as ZoneIn);
    }
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Маятниковый жнец: коса ходит, как маятник — взмах вправо, взмах влево,
// по такту. Окно — за спиной и после серии.
// ---------------------------------------------------------------------------

export const REAPER = { r: 2.2, arc: 1.5, warn: 0.55, beat: 0.72, swings: 4, side: 0.62 };

brain('f14_reaper', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0 && dist < REAPER.r + 0.2) {
          m.dir = Math.atan2(dy, dx);
          m.data.n = 0;
          m.data.side = sim.rng() < 0.5 ? -1 : 1;
          api.setMode(m, 'f14_swing');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed, dt);
        return;
      }
      case 'f14_swing': {
        // Метроном: каждый такт — конус в свою сторону.
        m.vx *= 0.8;
        m.vy *= 0.8;
        // Поворачивается к герою медленно — сзади можно зайти.
        const want = Math.atan2(dy, dx);
        m.dir += clamp(angDiff(want, m.dir), -dt * 1.4, dt * 1.4);
        m.face = m.dir;
        const beat = Math.floor(m.t / REAPER.beat);
        const n = m.data.n ?? 0;
        if (beat === n && n < REAPER.swings) {
          const side = (m.data.side ?? 1) * (n % 2 ? -1 : 1);
          api.strike(sim, {
            shape: 'cone',
            x: m.x,
            y: m.y,
            r: REAPER.r,
            ang: m.dir + side * REAPER.side,
            arc: REAPER.arc,
            warn: REAPER.warn,
            dmg: m.dmg,
            knock: 5,
            art: 'f14_scythe',
            from: m.id,
          });
          m.data.swSide = side;
          m.data.swAt = m.t;
          m.data.n = n + 1;
        }
        const inBeat = m.t - beat * REAPER.beat;
        if (inBeat > REAPER.warn - 0.22 && inBeat < REAPER.warn) m.danger = REAPER.r + 0.4;
        if (m.t >= REAPER.beat * REAPER.swings) {
          api.setMode(m, 'recover');
          m.cd = 1.2 + sim.rng() * 0.6;
        }
        return;
      }
      case 'recover':
        recoverStep(m, api, 1.3);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(_sim, m, hit) {
    // После серии и со спины — открыт.
    if (m.mode === 'recover') return 1.4;
    if (Math.abs(angDiff(hit.ang, m.face)) < 0.9) return 1.3;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Шестерёнчатый жук: сворачивается в шестерню и катится по линии,
// отскакивая от стен; докатился — голова кругом.
// ---------------------------------------------------------------------------

export const BEETLE = { curl: 0.55, speed: 9, roll: 1.5, bounces: 2, dizzy: 0.9 };

brain('f14_beetle', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist, def } = c;
    m.tele = null;
    m.danger = 0;
    switch (m.mode) {
      case 'chase': {
        m.bounce = false;
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.cd <= 0 && dist < def.reach + m.r + h.r + 0.2) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'windup');
          return;
        }
        if (
          see &&
          m.cd <= 0 &&
          dist > 2.2 &&
          dist < 6.5 &&
          clearLine(sim, api, m.x, m.y, h.x, h.y)
        ) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f14_curl');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        const z = Math.sin(sim.time * 9 + m.id) * 0.25;
        api.steer(sim, m, cx - cy * z, cy + cx * z, m.speed, dt);
        return;
      }
      case 'f14_curl': {
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t < 0.25) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        const len = Math.min(7, clearDist(sim, api, m.x, m.y, m.dir, 7));
        m.tele = { shape: 'line', r: len, w: 0.3, ang: m.dir, k: clamp(m.t / BEETLE.curl, 0, 1) };
        if (m.t > BEETLE.curl - 0.22) m.danger = 1.2;
        if (m.t >= BEETLE.curl) {
          m.bounces = 0;
          m.bounce = true;
          api.setMode(m, 'f14_roll');
        }
        return;
      }
      case 'f14_roll': {
        m.vx = Math.cos(m.dir) * BEETLE.speed;
        m.vy = Math.sin(m.dir) * BEETLE.speed;
        m.danger = 1;
        if (dist < m.r + h.r + 0.12 && canHurt(sim)) {
          api.hurtHero(sim, m.dmg, m.x, m.y, 6, m.kind);
          m.bounce = false;
          api.setMode(m, 'dizzy');
          return;
        }
        if (m.t > BEETLE.roll) {
          m.bounce = false;
          api.setMode(m, 'dizzy');
        }
        return;
      }
      case 'dizzy':
        m.vx *= 0.85;
        m.vy *= 0.85;
        if (m.t > BEETLE.dizzy) {
          m.cd = 1 + sim.rng();
          api.setMode(m, 'chase');
        }
        return;
      case 'windup': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir;
        if (m.t > def.windup - 0.2) m.danger = def.reach + m.r + 0.6;
        if (m.t >= def.windup) {
          if (dist < def.reach + m.r + h.r + 0.2 && canHurt(sim))
            api.hurtHero(sim, m.dmg, m.x, m.y, 3, m.kind);
          api.setMode(m, 'recover');
          m.cd = 0.7 + sim.rng() * 0.4;
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
  onWall(sim, m, nx, ny) {
    if (m.mode !== 'f14_roll') return;
    // Отскок: зеркально от стены.
    const l = hypot(nx, ny) || 1;
    const ux = nx / l;
    const uy = ny / l;
    const vx = Math.cos(m.dir);
    const vy = Math.sin(m.dir);
    const d = vx * ux + vy * uy;
    m.dir = Math.atan2(vy - 2 * d * uy, vx - 2 * d * ux);
    m.bounces += 1;
    sim.events.push({ t: 'clank', x: m.x, y: m.y });
    if (m.bounces > BEETLE.bounces) {
      m.bounce = false;
      m.mode = 'dizzy';
      m.t = 0;
    }
  },
  onHit(_sim, m) {
    if (m.mode === 'f14_roll') return 0.4;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Хранитель стрелок: часовая — удар кругом перед собой, минутная —
// выметает дугу (три линии подряд). Переводит часы: сфера ускорения
// вокруг себя — можно зайти в неё и самому.
// ---------------------------------------------------------------------------

export const KEEPER = {
  hourR: 1.35,
  hourWarn: 0.8,
  minLen: 3.8,
  minWarn: 0.6,
  minStep: 0.18,
  haste: 12,
};

brain('f14_keeper', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.hCd = (m.data.hCd ?? 4 + sim.rng() * 4) - dt;
    switch (m.mode) {
      case 'chase': {
        const see = api.lineOfSight(sim, m.x, m.y, h.x, h.y);
        if (see && m.data.hCd <= 0 && dist < 7) {
          api.setMode(m, 'f14_haste');
          return;
        }
        if (see && m.cd <= 0 && dist < 2.3) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f14_hour');
          return;
        }
        if (see && m.cd <= 0 && dist < KEEPER.minLen) {
          m.dir = Math.atan2(dy, dx) - 0.55;
          api.setMode(m, 'f14_minute');
          return;
        }
        const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
        api.steer(sim, m, cx, cy, m.speed * (dist < 1.8 ? 0.4 : 1), dt);
        return;
      }
      case 'f14_hour': {
        m.vx *= 0.7;
        m.vy *= 0.7;
        if (m.t < 0.2) m.dir = Math.atan2(dy, dx);
        m.face = m.dir;
        if (!m.data.lit && m.t >= 0.2) {
          m.data.lit = 1;
          api.strike(sim, {
            shape: 'circle',
            x: m.x + Math.cos(m.dir) * 1.2,
            y: m.y + Math.sin(m.dir) * 1.2,
            r: KEEPER.hourR,
            warn: KEEPER.hourWarn - 0.2,
            dmg: m.dmg * 1.25,
            knock: 6,
            art: 'f14_hourhand',
            from: m.id,
          });
        }
        if (m.t > KEEPER.hourWarn - 0.26) m.danger = 2.6;
        if (m.t >= KEEPER.hourWarn) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
          m.cd = 1.1 + sim.rng() * 0.5;
        }
        return;
      }
      case 'f14_minute': {
        // Минутная стрелка выметает дугу: три линии одна за другой.
        m.vx *= 0.7;
        m.vy *= 0.7;
        m.face = m.dir + 0.55;
        const n = Math.floor(m.t / KEEPER.minStep);
        if (n < 3 && n >= (m.data.lit ?? 0)) {
          m.data.lit = n + 1;
          const a = m.dir + n * 0.55;
          const len = Math.min(KEEPER.minLen, clearDist(sim, api, m.x, m.y, a, KEEPER.minLen));
          api.strike(sim, {
            shape: 'line',
            x: m.x,
            y: m.y,
            r: len,
            w: 0.4,
            ang: a,
            warn: KEEPER.minWarn,
            dmg: m.dmg,
            knock: 5,
            art: 'f14_minutehand',
            from: m.id,
          });
        }
        if (m.t > KEEPER.minWarn - 0.24) m.danger = KEEPER.minLen + 0.4;
        if (m.t >= KEEPER.minWarn + KEEPER.minStep * 2 + 0.05) {
          m.data.lit = 0;
          api.setMode(m, 'recover');
          m.cd = 1.2 + sim.rng() * 0.5;
        }
        return;
      }
      case 'f14_haste':
        // Переводит часы: стрелки на груди крутятся, вокруг — ускорение.
        m.vx *= 0.6;
        m.vy *= 0.6;
        if (m.t >= 0.7) {
          addSphere(sim, api, m.x, m.y, 2.3, 1.6, 6);
          sim.events.push({ t: 'boss', what: 'f14_haste' });
          m.data.hCd = KEEPER.haste;
          api.setMode(m, 'chase');
        }
        return;
      case 'recover':
        recoverStep(m, api, 0.8);
        return;
      default:
        api.setMode(m, 'chase');
    }
  },
  onHit(_sim, m) {
    if (m.mode === 'recover') return 1.3;
    if (m.mode === 'f14_frozen') return 2;
    return 1;
  },
});

// ---------------------------------------------------------------------------
// Двойник из прошлого: идёт по следу героя на 5 с позади и повторяет его
// удары там, где они были. Догнал стоящего — топает.
// ---------------------------------------------------------------------------

export const DOUBLE = { lag: 5, warn: 0.6, stomp: 2.6, stompR: 1.1 };

/** Где был герой `ago` секунд назад. */
export function heroPast(sim: Sim, ago: number): { x: number; y: number } | null {
  const T = TIME.get(sim);
  if (!T || !T.hist.length) return null;
  const t = sim.time - ago;
  const hs = T.hist;
  if (t <= hs[0].t) return hs[0];
  for (let i = hs.length - 1; i > 0; i--) {
    if (hs[i - 1].t <= t) {
      const a = hs[i - 1];
      const b = hs[i];
      const k = clamp((t - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return hs[hs.length - 1];
}

brain('f14_double', {
  step(sim, m, dt, _c, api) {
    const T = timeOf(sim);
    m.tele = null;
    m.danger = 0;
    if (m.mode === 'f14_frozen') {
      m.vx = 0;
      m.vy = 0;
      return;
    }
    if (m.mode !== 'chase') api.setMode(m, 'chase');
    const p = heroPast(sim, DOUBLE.lag);
    if (p) {
      const ex = p.x - m.x;
      const ey = p.y - m.y;
      const el = hypot(ex, ey);
      const sp = clamp(el * 8, 0, 9);
      if (el > 0.02) {
        m.vx = (ex / el) * sp;
        m.vy = (ey / el) * sp;
        m.face = Math.atan2(ey, ex);
      } else {
        m.vx = 0;
        m.vy = 0;
      }
    }
    // Повтор ударов: удар героя пять секунд назад — здесь, сейчас.
    for (const s of T.swings) {
      const due = s.t + DOUBLE.lag - DOUBLE.warn;
      if (due <= sim.time && due > sim.time - dt - 1e-6 && s.t > (m.data.born ?? -1e9)) {
        api.strike(sim, {
          shape: 'cone',
          x: s.x,
          y: s.y,
          r: s.heavy ? 1.7 : 1.45,
          ang: s.ang,
          arc: s.heavy ? 3.4 : 1.9,
          warn: DOUBLE.warn,
          dmg: m.dmg * (s.heavy ? 1.3 : 0.8),
          knock: 4,
          art: 'f14_echo',
          from: m.id,
        });
        m.face = s.ang;
        m.data.swing = sim.time;
      }
    }
    // Топот: раз в 2,6 с — где стоит, там и бьёт (догнал — берегись).
    m.data.sCd = (m.data.sCd ?? DOUBLE.stomp) - dt;
    if (m.data.sCd <= 0) {
      m.data.sCd = DOUBLE.stomp;
      api.strike(sim, {
        shape: 'circle',
        x: m.x,
        y: m.y,
        r: DOUBLE.stompR,
        warn: 0.8,
        dmg: m.dmg,
        knock: 5,
        art: 'f14_echostomp',
        from: m.id,
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Гиря: висит под лебёдкой, тень ползёт за героем, замирает — и гиря
// падает. Лежит — открыта; лебёдка поднимает её обратно.
// ---------------------------------------------------------------------------

export const WEIGHT = {
  reach: 3.4,
  see: 5.8,
  track: 1.5,
  lock: 0.45,
  fall: 0.18,
  down: 2.4,
  up: 0.8,
  r: 0.95,
};

brain('f14_weight', {
  step(sim, m, dt, _c, api) {
    const h = sim.hero;
    m.tele = null;
    m.danger = 0;
    m.kx = 0;
    m.ky = 0;
    const hx0 = m.data.hx ?? m.x;
    const hy0 = m.data.hy ?? m.y;
    switch (m.mode) {
      case 'chase':
      case 'f14_hang': {
        if (m.mode !== 'f14_hang') api.setMode(m, 'f14_hang');
        m.data.ghost = 1;
        m.r = 0.05;
        // Тень ползёт к герою, но не дальше рельса лебёдки.
        const hd = hypot(h.x - hx0, h.y - hy0);
        let tx = hx0;
        let ty = hy0;
        if (hd < WEIGHT.see && !heroDown(sim)) {
          const k = Math.min(1, WEIGHT.reach / Math.max(0.01, hd));
          tx = hx0 + (h.x - hx0) * k;
          ty = hy0 + (h.y - hy0) * k;
          // Не вплотную к герою — рядом: тень толкала бы его.
          const ox = tx - h.x;
          const oy = ty - h.y;
          const ol = hypot(ox, oy);
          if (ol < 0.36) {
            const a = ol > 0.01 ? Math.atan2(oy, ox) : Math.atan2(hy0 - h.y, hx0 - h.x);
            tx = h.x + Math.cos(a) * 0.36;
            ty = h.y + Math.sin(a) * 0.36;
          }
        }
        const ex = tx - m.x;
        const ey = ty - m.y;
        const el = hypot(ex, ey);
        const sp = Math.min(3.4, el * 6);
        m.vx = el > 0.02 ? (ex / el) * sp : 0;
        m.vy = el > 0.02 ? (ey / el) * sp : 0;
        m.tele = { shape: 'circle', r: WEIGHT.r, k: 0.15 };
        if (hd < WEIGHT.see && m.cd <= 0 && hypot(h.x - m.x, h.y - m.y) < 1.2) {
          m.data.track = (m.data.track ?? 0) + dt;
          if (m.data.track > WEIGHT.track) {
            m.data.track = 0;
            api.setMode(m, 'f14_lock');
          }
        } else m.data.track = Math.max(0, (m.data.track ?? 0) - dt);
        return;
      }
      case 'f14_lock':
        m.vx = 0;
        m.vy = 0;
        m.data.ghost = 1;
        m.tele = { shape: 'circle', r: WEIGHT.r, k: 0.3 + 0.7 * clamp(m.t / WEIGHT.lock, 0, 1) };
        if (m.t > WEIGHT.lock - 0.22) m.danger = WEIGHT.r + 0.35;
        if (m.t >= WEIGHT.lock) api.setMode(m, 'f14_fall');
        return;
      case 'f14_fall':
        m.data.ghost = 1;
        m.tele = { shape: 'circle', r: WEIGHT.r, k: 1 };
        m.danger = WEIGHT.r + 0.35;
        if (m.t >= WEIGHT.fall) {
          if (hypot(h.x - m.x, h.y - m.y) < WEIGHT.r + h.r && canHurt(sim))
            api.hurtHero(sim, m.dmg * 1.2, m.x, m.y, 7, m.kind);
          // Солдатиков и жуков под гирей — давит.
          for (const o of sim.mobs)
            if (
              o !== m &&
              o.mode !== 'dying' &&
              (o.data.ghost ?? 0) <= 0 &&
              hypot(o.x - m.x, o.y - m.y) < WEIGHT.r + o.r &&
              !o.kind.endsWith('boss') &&
              o.kind !== 'f14_weight'
            ) {
              o.kx += (o.x - m.x) * 6;
              o.ky += (o.y - m.y) * 6;
              envHurt(sim, api, o, 0.6);
            }
          sim.events.push({ t: 'boom', x: m.x, y: m.y, r: 0.8 });
          sim.events.push({ t: 'shake', k: 0.25 });
          sim.events.push({ t: 'boss', what: 'f14_thud' });
          m.r = 0.46;
          m.data.ghost = 0;
          api.setMode(m, 'f14_down');
        }
        return;
      case 'f14_down':
        // Лежит: открыта.
        m.vx = 0;
        m.vy = 0;
        m.data.ghost = 0;
        m.r = 0.46;
        if (m.t >= WEIGHT.down) api.setMode(m, 'f14_up');
        return;
      case 'f14_up':
        m.vx = 0;
        m.vy = 0;
        m.data.ghost = m.t > 0.25 ? 1 : 0;
        m.r = 0.05;
        if (m.t >= WEIGHT.up) {
          m.cd = 1.2;
          api.setMode(m, 'f14_hang');
        }
        return;
      default:
        api.setMode(m, 'f14_hang');
    }
  },
  onHit(_sim, m) {
    if (m.mode !== 'f14_down' && m.mode !== 'f14_up') return 0;
    return 1.2;
  },
  onDeath(sim, m) {
    postDead(sim, m);
  },
});

// ---------------------------------------------------------------------------
// Часовщик (редкий): удирает с мешком; бьёшь — сыплет монеты; прижали —
// переводит свои часы вперёд и оказывается поодаль (метка — куда).
// ---------------------------------------------------------------------------

brain('f14_smith', {
  step(sim, m, dt, c, api) {
    const h = sim.hero;
    const { dx, dy, dist } = c;
    m.tele = null;
    m.danger = 0;
    m.data.pCd = (m.data.pCd ?? 0) - dt;
    if (m.mode === 'f14_blink') {
      m.data.ghost = m.t > 0.25 ? 1 : 0;
      m.vx = 0;
      m.vy = 0;
      if (m.t >= 0.4) {
        m.x = m.data.bx ?? m.x;
        m.y = m.data.by ?? m.y;
        m.data.ghost = 0;
        sim.events.push({ t: 'emerge', x: m.x, y: m.y });
        api.setMode(m, 'flee');
      }
      return;
    }
    if (m.mode !== 'flee' && m.mode !== 'chase') api.setMode(m, 'flee');
    if (dist < 1.6 && m.data.pCd <= 0) {
      const to = spotNear(sim, api, m.x, m.y, 4, 6.5, (px, py) => hypot(px - h.x, py - h.y));
      if (to) {
        m.data.bx = to[0];
        m.data.by = to[1];
        m.data.pCd = 3.2;
        api.zone(sim, { x: to[0], y: to[1], r: 0.6, life: 0.55, art: 'f14_blink' });
        api.setMode(m, 'f14_blink');
        sim.events.push({ t: 'boss', what: 'f14_blink' });
        return;
      }
    }
    const away = api.flowDir(sim, m.x, m.y, true);
    const d = away ?? [-dx / (dist || 1), -dy / (dist || 1)];
    const z = Math.sin(sim.time * 6 + m.id) * 0.45;
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
// Правила этажа: посты, колокол, маятники, шестерни, завод, песок,
// отмотка, стоп-кадр, полдень, действия.
// ---------------------------------------------------------------------------

interface Post {
  id: number;
  kind: string;
  mode: string;
  x: number;
  y: number;
  mob: number;
  dead: boolean;
  /** Часы кукушки — номер в `CLOCK_IDS`. */
  clock?: number;
  /** Строй Завода. */
  rank?: number;
  area: string;
}

interface Pend {
  obj: WorldObj;
  x: number;
  y: number;
  ph: number;
  amp: number;
  period: number;
  off: number;
  v: number;
  hitCd: number;
}

interface Tooth {
  prop: Prop;
  ring: 0 | 1;
  slot: number;
}

interface GearHall {
  cx: number;
  cy: number;
  teeth: Tooth[];
  /** Поворот колец в местах и куда они идут. */
  rot: [number, number];
  goal: [number, number];
  tick: number;
  beat: number;
  state: 'idle' | 'waves' | 'done';
  wave: number;
  waveT: number;
  spawned: Set<number>;
  lever: Prop | null;
  stopUntil: number;
  leverCd: number;
  holes: number[];
}

interface Factory {
  box: [number, number, number, number];
  lever: Prop | null;
  key: WorldObj | null;
  state: 'idle' | 'wind' | 'stopped' | 'done';
  t: number;
  rank: number;
  ranks: number;
  paid: boolean;
}

interface Flood {
  state: 'idle' | 'rise' | 'full' | 'drain';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  bottom: number;
  top: number;
  front: number;
  t: number;
  pause: number;
  cool: number;
  spawnT: number;
  used: Set<string>;
}

interface RewindHall {
  box: [number, number, number, number];
  glass: Prop | null;
  anchors: Prop[];
  bars: number[];
  state: 'idle' | 'on' | 'done';
  cycle: number;
  t: number;
  dead: { kind: string; x: number; y: number }[];
  mobs: Set<number>;
  rising: { kind: string; x: number; y: number; at: number }[];
  flips: number;
}

interface FrameHall {
  box: [number, number, number, number];
  state: 'idle' | 'still' | 'count' | 'fight' | 'done';
  t: number;
  knives: { id: number; ang: number }[];
  mobs: Set<number>;
  spots: [number, number][];
  kspots: [number, number][];
  mid: number;
}

interface Plaza {
  cx: number;
  cy: number;
  r: number;
  min: number;
  hour: number;
  hitM: number;
  hitH: number;
  noon: boolean;
  /** «Вдох» перед полуденным ударом уже прозвучал. */
  wind: boolean;
  on: boolean;
}

interface F14State {
  posts: Post[];
  pends: Pend[];
  gear: GearHall | null;
  factory: Factory | null;
  rewind: RewindHall | null;
  frame: FrameHall | null;
  plaza: Plaza | null;
  bell: Prop | null;
  bellCd: number;
  saved: Map<number, { tile: number; mark: number }>;
  spheresMade: boolean;
  /** Часовые лампы арены: ключ света и место. */
  lamps: { key: string; x: number; y: number; hour: number }[];
}

const STATE = new WeakMap<Sim, F14State>();
const FLOOD = new WeakMap<Sim, Flood>();
let postSeq = 1;

function postDead(sim: Sim, m: Mob): void {
  const st = STATE.get(sim);
  const p = st?.posts.find((x) => x.id === m.data.post);
  if (p) {
    p.dead = true;
    p.mob = 0;
  }
}

function inFlood(fl: Flood, x: number, y: number): boolean {
  if (fl.state === 'idle') return false;
  if (y < fl.front || y > fl.bottom + 1) return false;
  const dx = (x - fl.cx) / fl.rx;
  const dy = (y - fl.cy) / fl.ry;
  return dx * dx + dy * dy <= 1.05 || (Math.abs(x - fl.cx) < 3 && y > fl.cy);
}

function scan(sim: Sim): F14State {
  const w = sim.world;
  const W = w.w;
  const posts: Post[] = [];
  const add = (kind: string, mode: string, x: number, y: number, extra: Partial<Post> = {}) =>
    posts.push({
      id: postSeq++,
      kind,
      mode,
      x,
      y,
      mob: 0,
      dead: false,
      area: w.rowArea[Math.floor(y)],
      ...extra,
    });
  const bandTop = (id: string) => w.bands.find((b) => b.def.id === id)?.top ?? 0;
  const mechTop = bandTop(F14_MECH);
  const dialTop = bandTop(F14_DIAL);
  const sandTop = bandTop(F14_SAND);
  const inBox = (b: [number, number, number, number], x: number, y: number) =>
    x >= b[0] && x <= b[2] + 0.99 && y >= b[1] && y <= b[3] + 0.99;
  // Завод: рамка зала (местные x 3…16, ряды 78…106).
  const fbox: [number, number, number, number] = [3, mechTop + 78, 16, mechTop + 106];
  const ranks: number[] = [];
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < W; x++) {
      const k = w.mark[y * W + x];
      if (k === MK.wspot) add('f14_weight', 'f14_hang', x + 0.5, y + 0.5);
      else if (k === MK.cuckoo) {
        const o = w.objs.find((q) => q.x === x && q.y === y && q.ref === 'f14_cuckooclock');
        if (o) {
          let n = CLOCK_IDS.indexOf(o.id);
          if (n < 0) {
            CLOCK_IDS.push(o.id);
            n = CLOCK_IDS.length - 1;
          }
          add('f14_cuckoo', 'f14_nest', x + 0.5, y + 1.2, { clock: n });
        }
      } else if (k === MK.rank) {
        if (!ranks.includes(y)) ranks.push(y);
        add('f14_soldier', 'f14_statue', x + 0.5, y + 0.5, { rank: y });
      }
    }
  ranks.sort((a, b) => a - b);
  for (const p of posts) if (p.rank !== undefined) p.rank = ranks.indexOf(p.rank);
  // Маятники: соседние качаются вразнобой.
  const pends: Pend[] = [];
  let pi = 0;
  for (const p of sim.props)
    if (p.kind === 'deco' && p.obj.ref === 'f14_pendulum') {
      pends.push({
        obj: p.obj,
        x: p.x,
        y: p.y,
        ph: 0,
        amp: 2.25,
        period: 2.5,
        off: (pi * 0.37) % 1,
        v: 0,
        hitCd: 0,
      });
      pi++;
    }
  // Зал шестерён.
  const g = F14_GEO.gear;
  const gcx = g.x;
  const gcy = mechTop + g.y;
  const teeth: Tooth[] = [];
  const byRing: Prop[][] = [[], []];
  for (const p of sim.props)
    if (p.kind === 'deco' && p.obj.ref === 'f14_tooth') {
      const d = hypot(p.x - gcx, p.y - gcy);
      byRing[Math.abs(d - g.r[0]) < Math.abs(d - g.r[1]) ? 0 : 1].push(p);
    }
  for (const ring of [0, 1] as const) {
    const list = byRing[ring];
    const slots = g.slots[ring];
    const per = slots / g.gaps[ring];
    const free: number[] = [];
    // Проёмы — ровно по кругу; у внешнего кольца проём начинается на юге
    // (вход), у внутреннего — сдвинут: проёмы не совпадают.
    const shift = ring === 0 ? Math.round(slots * 0.25 - g.gapW[0] / 2) : Math.round(per / 2);
    for (let s = 0; s < slots; s++)
      if ((((s - shift) % per) + per) % per >= g.gapW[ring]) free.push(s);
    list.sort((a, b) => Math.atan2(a.y - gcy, a.x - gcx) - Math.atan2(b.y - gcy, b.x - gcx));
    for (let i = 0; i < list.length && i < free.length; i++) {
      list[i].r = 0.5;
      teeth.push({ prop: list[i], ring, slot: free[i] });
    }
    // Лишние зубья (карта дала больше, чем мест) — прячем.
    for (let i = free.length; i < list.length; i++) list[i].alive = false;
  }
  let gearLever: Prop | null = null;
  let facLever: Prop | null = null;
  for (const p of sim.props)
    if (p.kind === 'deco' && p.obj.ref === 'f14_lever') {
      if (hypot(p.x - gcx, p.y - gcy) < 12) gearLever = p;
      else if (inBox(fbox, p.x, p.y)) facLever = p;
    }
  const holes: number[] = [];
  sim.burrows.forEach((b, i) => {
    if (b.obj.out && hypot(b.obj.out[0] + 0.5 - gcx, b.obj.out[1] + 0.5 - gcy) < 12.5)
      holes.push(i);
  });
  const gear: GearHall | null = teeth.length
    ? {
        cx: gcx,
        cy: gcy,
        teeth,
        rot: [0, 0],
        goal: [0, 0],
        tick: GEAR.beat,
        beat: 0,
        state: 'idle',
        wave: 0,
        waveT: 0,
        spawned: new Set(),
        lever: gearLever,
        stopUntil: 0,
        leverCd: 0,
        holes,
      }
    : null;
  const key = w.objs.find((o) => o.ref === 'f14_key') ?? null;
  const factory: Factory = {
    box: fbox,
    lever: facLever,
    key,
    state: 'idle',
    t: 0,
    rank: 0,
    ranks: ranks.length,
    paid: false,
  };
  // Зал отмотки: местные x 50…61, ряды 68…98; решётка — в двери (x 49).
  const rbox: [number, number, number, number] = [50, sandTop + 68, 61, sandTop + 98];
  const glass = sim.props.find((p) => p.kind === 'deco' && p.obj.ref === 'f14_bigglass') ?? null;
  const anchors = sim.props.filter((p) => p.kind === 'breakable' && p.obj.ref === 'f14_anchor');
  const bars: number[] = [];
  for (let y = sandTop + 84; y <= sandTop + 86; y++) bars.push(y * W + 49);
  const rewind: RewindHall = {
    box: rbox,
    glass,
    anchors,
    bars,
    state: 'idle',
    cycle: RWH.cycle,
    t: 0,
    dead: [],
    mobs: new Set(),
    rising: [],
    flips: 0,
  };
  // Стоп-кадр: местные x 17…45, ряды 80…102.
  const frbox: [number, number, number, number] = [17, dialTop + 80, 45, dialTop + 102];
  const spots: [number, number][] = [];
  const kspots: [number, number][] = [];
  for (let y = frbox[1]; y <= frbox[3]; y++)
    for (let x = frbox[0]; x <= frbox[2]; x++) {
      const k = w.mark[y * W + x];
      if (k === MK.frozen) spots.push([x + 0.5, y + 0.5]);
      if (k === MK.knife) kspots.push([x + 0.5, y + 0.5]);
    }
  const frame: FrameHall = {
    box: frbox,
    state: 'idle',
    t: 0,
    knives: [],
    mobs: new Set(),
    spots,
    kspots,
    mid: dialTop + 91,
  };
  const pz = F14_GEO.plaza;
  const plaza: Plaza = {
    cx: pz.x,
    cy: dialTop + pz.y,
    r: pz.r,
    min: 0,
    hour: 0,
    hitM: 0,
    hitH: 0,
    noon: false,
    wind: false,
    on: false,
  };
  const bell = sim.props.find((p) => p.kind === 'deco' && p.obj.ref === 'f14_bell') ?? null;
  // Часовые лампы арены: час — по углу от ступицы.
  const ar = F14_GEO.arena;
  const lamps: F14State['lamps'] = [];
  for (const o of w.objs)
    if (o.ref === 'f14_hourlamp') {
      const a = Math.atan2(o.y + 0.5 - (dialTop + ar.y), o.x + 0.5 - ar.x);
      const hour = Math.round((((a + Math.PI / 2) / TAU) * 12 + 12 - 0.5) % 12);
      lamps.push({ key: `f14_hl${hour}`, x: o.x + 0.5, y: o.y + 0.5, hour });
    }
  lamps.sort((a, b) => a.hour - b.hour);
  // Песок верхней колбы.
  const up = F14_GEO.upper;
  FLOOD.set(sim, {
    state: 'idle',
    cx: up.x,
    cy: sandTop + up.y,
    rx: up.rx,
    ry: up.ry,
    bottom: sandTop + up.neck,
    top: sandTop + up.y - up.ry + 1,
    front: sandTop + up.neck,
    t: 0,
    pause: 0,
    cool: 0,
    spawnT: 0,
    used: new Set(),
  });
  return {
    posts,
    pends,
    gear,
    factory,
    rewind,
    frame,
    plaza,
    bell,
    bellCd: 0,
    saved: new Map(),
    spheresMade: false,
    lamps,
  };
}

function stateOf(sim: Sim): F14State {
  let st = STATE.get(sim);
  if (!st) {
    st = scan(sim);
    STATE.set(sim, st);
  }
  return st;
}

/** Состояние этажа — для тестов и стенда. */
export const f14State = (sim: Sim) => STATE.get(sim) ?? null;
export const f14Flood = (sim: Sim) => FLOOD.get(sim) ?? null;
export const f14Time = (sim: Sim) => TIME.get(sim) ?? null;

function saveTile(
  sim: Sim,
  st: F14State,
  api: SimApi,
  i: number,
  tile: number,
  mark: number,
): void {
  const w = sim.world;
  if (!st.saved.has(i)) st.saved.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
  api.setTile(sim, i % w.w, Math.floor(i / w.w), tile, mark);
}

function restoreTile(sim: Sim, st: F14State, api: SimApi, i: number): void {
  const v = st.saved.get(i);
  if (!v) return;
  const w = sim.world;
  api.setTile(sim, i % w.w, Math.floor(i / w.w), v.tile, v.mark);
  st.saved.delete(i);
}

/** Посты: гири, кукушки, строй — ставятся, когда герой подходит. */
function stepPosts(sim: Sim, st: F14State, api: SimApi): void {
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
    const d = hypot(p.x - h.x, p.y - h.y);
    if (d > 17) continue;
    if (sim.boss?.state === 'fight' && api.inArena(sim, p.x, p.y)) continue;
    const m = api.spawnMob(sim, p.kind, p.x, p.y, { mode: p.mode });
    m.data.post = p.id;
    m.data.hx = p.x;
    m.data.hy = p.y;
    m.data.nx = p.x;
    m.data.ny = p.y;
    m.hx = p.x;
    m.hy = p.y;
    m.face = Math.PI / 2;
    if (p.clock !== undefined) {
      m.data.clock = p.clock;
      m.data.ghost = 1;
    }
    if (p.kind === 'f14_weight') {
      m.data.ghost = 1;
      m.r = 0.05;
    }
    if (p.rank !== undefined) {
      m.data.rank = p.rank;
      m.data.ghost = 1;
      const fac = st.factory;
      if (fac && (fac.state === 'stopped' || fac.state === 'done')) api.setMode(m, 'f14_frozen');
    }
    p.mob = m.id;
  }
}

// ---- Колокол «ЧАС» --------------------------------------------------------

/** Период колокола по району: Механизм реже, Циферблат чаще. */
const bellPeriod = (area: string) => (area === F14_MECH ? 70 : area === F14_SAND ? 60 : 50);
export const BELL = { warn: 3, stop: 2 };

function stepBell(sim: Sim, dt: number, api: SimApi): void {
  const T = timeOf(sim);
  const area = areaAt(sim, sim.hero.y);
  F14_FX.bellP = bellPeriod(area);
  // В бою со временем правит Повелитель.
  if (sim.boss?.state === 'fight') {
    F14_FX.bellIn = F14_FX.bellP;
    return;
  }
  if (worldStopped(sim)) return;
  T.bellT -= dt;
  F14_FX.bellIn = Math.max(0, T.bellT);
  if (!T.bellWarn && T.bellT <= BELL.warn) {
    T.bellWarn = true;
    sim.events.push({
      t: 'boss',
      what: 'f14_bell_call',
      text: 'БЬЁТ ЧАС',
      sub: T.bells ? undefined : 'мир замрёт — ходишь только ты',
    });
  }
  // За две секунды до удара — «вдох»: звук остановки времени бьёт ровно
  // через 2 с после вызова, а мир должен встать под удар, а не после.
  if (!T.bellWind && T.bellT <= STOP_LEAD) {
    T.bellWind = true;
    sim.events.push({ t: 'boss', what: 'f14_bell_wind' });
  }
  if (T.bellT <= 0) ringBell(sim, api, BELL.stop + (area === F14_DIAL ? 0.4 : 0));
}

/** За сколько до остановки звать «вдох» (удар `timeStop` — через ~2 с). */
const STOP_LEAD = 2;

/** Удар колокола: мир стоит `dur` секунд. */
function ringBell(sim: Sim, api: SimApi, dur: number): void {
  const T = timeOf(sim);
  T.bells += 1;
  T.bellT = bellPeriod(areaAt(sim, sim.hero.y));
  T.bellWarn = false;
  T.bellWind = false;
  F14_FX.bell = F14_FX.clock;
  stopWorld(sim, api, dur, 'bell');
  sim.events.push({ t: 'boss', what: 'f14_bell', text: 'ЧАС' });
}

// ---- Маятники -------------------------------------------------------------

function stepPends(sim: Sim, st: F14State, api: SimApi, dt: number): void {
  const h = sim.hero;
  for (const p of st.pends) {
    p.ph += dt;
    const w = TAU / p.period;
    const a = w * p.ph + p.off * TAU;
    const off = p.amp * Math.sin(a);
    const v = dt > 0 ? p.amp * w * Math.cos(a) : 0;
    p.v = v;
    F14_FX.pend.set(p.obj.id, { off, v });
    p.hitCd = Math.max(0, p.hitCd - dt);
    if (dt <= 0 || Math.abs(p.y - h.y) > 12) continue;
    const bx = p.x + off;
    const by = p.y;
    // Лезвие — полоса 1×0,7 клетки; бьёт, пока идёт (у края почти стоит).
    if (Math.abs(v) < 1.6) continue;
    if (
      Math.abs(h.x - bx) < 0.5 + h.r &&
      Math.abs(h.y - by) < 0.34 + h.r &&
      p.hitCd <= 0 &&
      canHurt(sim)
    ) {
      p.hitCd = 0.6;
      api.hurtHero(sim, rawShare(sim, 0.15), bx - Math.sign(v), by, 7);
      sim.events.push({ t: 'boss', what: 'f14_pend' });
    }
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || (m.data.ghost ?? 0) > 0 || m.kind.endsWith('boss')) continue;
      if (
        Math.abs(m.x - bx) < 0.5 + m.r &&
        Math.abs(m.y - by) < 0.34 + m.r &&
        (m.data.pendT ?? 0) < sim.time
      ) {
        m.data.pendT = sim.time + 0.6;
        m.kx += Math.sign(v) * 9;
        envHurt(sim, api, m, 0.35);
        if (m.mode !== 'dying' && m.mode !== 'f14_statue' && m.kind !== 'f14_weight')
          api.setMode(m, 'stun');
      }
    }
  }
}

// ---- Зал шестерён ----------------------------------------------------------

const GEAR = { beat: 0.85, move: 0.2, waves: 3, waveGap: 9, stop: 8, leverCd: 16 };

function stepGear(sim: Sim, st: F14State, api: SimApi, dt: number): void {
  const gh = st.gear;
  if (!gh) return;
  const h = sim.hero;
  const d = hypot(h.x - gh.cx, h.y - gh.cy);
  const held = sim.time < gh.stopUntil;
  gh.leverCd = Math.max(0, gh.leverCd - dt);
  if (gh.lever) F14_FX.levers.set(gh.lever.obj.id, held ? 1 : 0);
  // Такт: внешнее кольцо — на «тик», внутреннее — на «так», по месту.
  if (d < 17 && !held && dt > 0) {
    gh.tick -= dt;
    if (gh.tick <= 0) {
      gh.tick += GEAR.beat;
      gh.beat += 1;
      if (gh.beat % 2) gh.goal[0] += 1;
      else gh.goal[1] -= 1;
      if (d < 12) sim.events.push({ t: 'boss', what: 'f14_tick' });
    }
  }
  const step = dt / GEAR.move;
  for (const r of [0, 1] as const) gh.rot[r] += clamp(gh.goal[r] - gh.rot[r], -step, step);
  F14_FX.gearAng = (gh.rot[0] / F14_GEO.gear.slots[0]) * TAU;
  const g = F14_GEO.gear;
  for (const t of gh.teeth) {
    const n = g.slots[t.ring];
    const ang = ((t.slot + gh.rot[t.ring]) / n) * TAU;
    const R = g.r[t.ring];
    const x = gh.cx + Math.cos(ang) * R;
    const y = gh.cy + Math.sin(ang) * R;
    t.prop.x = x;
    t.prop.y = y;
    F14_FX.teeth.set(t.prop.obj.id, { ang, x, y });
  }
  // Событие: вошёл в зал — механизм пошёл, из люков лезут жуки.
  if (gh.state === 'idle' && d < 9.5 && !heroDown(sim)) {
    gh.state = 'waves';
    gh.wave = 0;
    gh.waveT = 1.2;
    sim.events.push({
      t: 'boss',
      what: 'f14_gear_trap',
      text: 'ЗАЛ ШЕСТЕРЁН',
      sub: 'кольца идут — ищи проём, стопор у входа',
    });
  }
  // Ушёл из зала — волны ждут: зал нельзя «пройти», просто выйдя.
  if (gh.state === 'waves' && dt > 0 && d < 15) {
    gh.waveT -= dt;
    const live = sim.mobs.filter((m) => gh.spawned.has(m.id) && m.mode !== 'dying').length;
    if (gh.waveT <= 0 && gh.wave < GEAR.waves && live < 5) {
      const kinds = [
        ['f14_beetle', 'f14_beetle', 'f14_beetle'],
        ['f14_soldier', 'f14_beetle', 'f14_beetle', 'f14_soldier'],
        ['f14_reaper', 'f14_beetle', 'f14_beetle'],
      ][gh.wave];
      const holes = gh.holes.map((i) => sim.burrows[i]).filter(Boolean);
      kinds.forEach((kind, i) => {
        const b = holes[(gh.wave + i) % Math.max(1, holes.length)];
        let m: Mob;
        if (b) {
          b.cd = 0;
          m = api.fromBurrow(sim, b, kind);
        } else {
          const a = sim.rng() * TAU;
          m = api.spawnMob(sim, kind, gh.cx + Math.cos(a) * 8, gh.cy + Math.sin(a) * 8, {
            mode: 'drop',
          });
        }
        m.t = -i * 0.35;
        gh.spawned.add(m.id);
      });
      gh.wave += 1;
      gh.waveT = GEAR.waveGap;
    }
    if (gh.wave >= GEAR.waves && live === 0 && gh.waveT < GEAR.waveGap - 1) {
      gh.state = 'done';
      for (let i = 0; i < 4; i++)
        api.dropAt(sim, 'token', 2 + Math.floor(sim.rng() * 3), gh.cx, gh.cy);
      for (let i = 0; i < 2; i++) api.dropAt(sim, 'f14mat', 1, gh.cx, gh.cy);
      api.dropAt(sim, 'coin', 900, gh.cx, gh.cy);
      sim.events.push({
        t: 'boss',
        what: 'f14_gear_done',
        text: 'МЕХАНИЗМ СМАЗАН',
        sub: 'зал отдал своё',
      });
    }
  }
}

// ---- Завод ----------------------------------------------------------------

const FACTORY = { turn: 2.3 };

function factorySoldiers(sim: Sim, st: F14State): Mob[] {
  return st.posts
    .filter((p) => p.rank !== undefined)
    .map((p) => sim.mobs.find((m) => m.id === p.mob))
    .filter(Boolean) as Mob[];
}

function stepFactory(sim: Sim, st: F14State, api: SimApi, dt: number): void {
  const f = st.factory;
  if (!f) return;
  const h = sim.hero;
  const inside = h.x >= f.box[0] && h.x <= f.box[2] + 1 && h.y >= f.box[1] && h.y <= f.box[3] + 1;
  if (f.lever)
    F14_FX.levers.set(f.lever.obj.id, f.state === 'stopped' || f.state === 'done' ? 1 : 0);
  F14_FX.key.spin = f.state === 'wind' && dt > 0 ? 1 : 0;
  F14_FX.key.stopped = f.state === 'stopped' || f.state === 'done' ? 1 : 0;
  if (f.state === 'idle' && inside && h.y < f.box[3] - 3 && !heroDown(sim)) {
    f.state = 'wind';
    f.t = 0.8;
    f.rank = 0;
    if (f.key) api.camera(sim, f.key.x + 0.5, f.key.y + 3, 1.8);
    sim.events.push({
      t: 'boss',
      what: 'f14_key_trap',
      text: 'ЗАВОД',
      sub: 'ключ пошёл — стопор за строем',
    });
  }
  if (f.state === 'wind' && dt > 0) {
    f.t -= dt;
    if (f.t <= 0) {
      f.t = FACTORY.turn;
      // Ключ поворачивается — шеренга просыпается.
      let woke = 0;
      for (const m of factorySoldiers(sim, st))
        if (m.data.rank === f.rank && m.mode === 'f14_statue') {
          api.setMode(m, 'f14_waking');
          woke += 1;
        }
      if (woke) sim.events.push({ t: 'boss', what: 'f14_wind' });
      f.rank += 1;
      if (f.rank >= f.ranks) f.state = 'stopped';
    }
  }
  // Кончилось: все проснувшиеся пали — награда у ключа.
  if (f.state === 'stopped' && !f.paid) {
    const posts = st.posts.filter((p) => p.rank !== undefined);
    const awake = posts.some((p) => {
      if (p.dead) return false;
      const m = sim.mobs.find((x) => x.id === p.mob);
      return !!m && m.mode !== 'f14_statue' && m.mode !== 'f14_frozen';
    });
    if (!awake && posts.some((p) => p.dead)) {
      f.paid = true;
      f.state = 'done';
      const kx = f.key ? f.key.x + 0.5 : h.x;
      const ky = f.key ? f.key.y + 1.5 : h.y;
      for (let i = 0; i < 3; i++) api.dropAt(sim, 'token', 2 + Math.floor(sim.rng() * 3), kx, ky);
      api.dropAt(sim, 'f14_spring', 1, kx, ky);
      api.dropAt(sim, 'f14_spring', 1, kx, ky);
      api.dropAt(sim, 'coin', 700, kx, ky);
      sim.events.push({
        t: 'boss',
        what: 'f14_key_done',
        text: 'ЗАВОД ВСТАЛ',
        sub: 'пружины — твои',
      });
    }
  }
}

/** Стопор Завода: ключ встал, спящие остались статуями. */
function factoryStop(sim: Sim, st: F14State, api: SimApi): boolean {
  const f = st.factory;
  if (!f || (f.state !== 'wind' && f.state !== 'idle')) return false;
  f.state = 'stopped';
  for (const m of factorySoldiers(sim, st))
    if (m.mode === 'f14_statue') api.setMode(m, 'f14_frozen');
  sim.events.push({
    t: 'boss',
    what: 'f14_lever',
    text: 'СТОПОР',
    sub: 'ключ встал — строй не проснётся',
  });
  return true;
}

// ---- Перевёрнутые часы -----------------------------------------------------

const FLOODC = { row: 0.9, hold: 3, drain: 0.25, cool: 40, pause: 6 };

function stepFlood(sim: Sim, api: SimApi, dt: number): void {
  const fl = FLOOD.get(sim);
  if (!fl) return;
  const h = sim.hero;
  fl.cool = Math.max(0, fl.cool - dt);
  const dxh = (h.x - fl.cx) / fl.rx;
  const dyh = (h.y - fl.cy) / fl.ry;
  const inBowl = dxh * dxh + dyh * dyh <= 1 && h.y < fl.bottom - 2;
  const held = sim.time < fl.pause;
  F14_FX.flood.paused = held || dt <= 0 ? 1 : 0;
  for (const p of sim.props)
    if (p.kind === 'deco' && p.obj.ref === 'f14_glass')
      F14_FX.glasses.set(p.obj.id, fl.used.has(p.obj.id) ? 1 : 0);
  switch (fl.state) {
    case 'idle':
      fl.front = fl.bottom;
      if (inBowl && fl.cool <= 0 && !heroDown(sim)) {
        fl.state = 'rise';
        fl.t = 0;
        fl.spawnT = 1.5;
        fl.used.clear();
        api.camera(sim, fl.cx, fl.bottom - 1, 1.4);
        sim.events.push({ t: 'shake', k: 0.45 });
        sim.events.push({
          t: 'boss',
          what: 'f14_flip_trap',
          text: 'ЧАСЫ ПЕРЕВЕРНУЛИСЬ',
          sub: 'песок поднимается — к выходу! малые часы держат его',
        });
      }
      break;
    case 'rise':
      if (!held && dt > 0) {
        fl.front -= dt / FLOODC.row;
        fl.spawnT -= dt;
        if (fl.spawnT <= 0) {
          fl.spawnT = 4.5;
          // Из фронта встаёт призрак.
          const x = fl.cx + (sim.rng() - 0.5) * fl.rx * 1.2;
          const y = fl.front + 1.2;
          if (!api.solidTile(sim, Math.floor(x), Math.floor(y))) {
            const m = api.spawnMob(sim, 'f14_sand', x, y, { mode: 'f14_rise' });
            m.data.ghost = 1;
            api.strike(sim, {
              shape: 'circle',
              x,
              y,
              r: SAND.riseR,
              warn: SAND.rise,
              dmg: m.dmg,
              knock: 5,
              art: 'f14_sandrise',
              from: m.id,
            });
          }
        }
      }
      if (fl.front <= fl.top) {
        fl.front = fl.top;
        fl.state = 'full';
        fl.t = 0;
      }
      if (h.y < fl.top - 1) {
        fl.state = 'drain';
        fl.t = 0;
      }
      break;
    case 'full':
      fl.t += dt;
      if ((fl.t > FLOODC.hold && !inBowl) || fl.t > FLOODC.hold + 8) fl.state = 'drain';
      break;
    case 'drain':
      fl.front += dt / FLOODC.drain;
      if (fl.front >= fl.bottom) {
        fl.front = fl.bottom;
        fl.state = 'idle';
        fl.cool = FLOODC.cool;
      }
      break;
  }
  // Герой в песке: вязнет и задыхается, чем глубже, тем сильнее.
  if (fl.state !== 'idle' && inFlood(fl, h.x, h.y) && !heroDown(sim)) {
    const depth = clamp((h.y - fl.front) / 3, 0.2, 1);
    api.heroStatus(sim, 'slow', 0.2, 0.25 + 0.4 * depth);
    if (depth > 0.6 && dt > 0) api.hurtEnv(sim, 0.03 * dt);
  }
  // Свет на ходу: фронт песка светится тёплым.
  if (fl.state !== 'idle')
    api.light(sim, 'f14_flood', { x: fl.cx, y: fl.front + 0.5, r: 5.5, tint: 'warm' });
  else api.light(sim, 'f14_flood', null);
  const F = F14_FX.flood;
  F.front = fl.state === 'idle' ? 0 : fl.front;
  F.bottom = fl.bottom;
  F.top = fl.top;
  F.cx = fl.cx;
  F.cy = fl.cy;
  F.rx = fl.rx;
  F.ry = fl.ry;
  if (!sim.zones.some((z) => z.art === 'f14_flood'))
    api.zone(sim, { x: fl.cx, y: fl.cy, r: fl.ry + 1, life: 1e9, art: 'f14_flood' });
}

/** Малые часы: песок стоит шесть секунд. */
function floodHold(sim: Sim, obj: WorldObj, api: SimApi): boolean {
  const fl = FLOOD.get(sim);
  if (!fl || fl.state !== 'rise' || fl.used.has(obj.id)) return false;
  fl.used.add(obj.id);
  fl.pause = sim.time + FLOODC.pause;
  addSphere(sim, api, obj.x + 0.5, obj.y + 0.5, 2.4, 0.4, FLOODC.pause);
  sim.events.push({
    t: 'boss',
    what: 'f14_glass',
    text: 'ЧАСЫ ПЕРЕВЁРНУТЫ',
    sub: 'песок стоит шесть секунд',
  });
  return true;
}

// ---- Зал отмотки ----------------------------------------------------------

const RWH = { cycle: 16, warn: 1.2 };

function stepRewindHall(sim: Sim, st: F14State, api: SimApi, dt: number): void {
  const r = st.rewind;
  if (!r) return;
  const h = sim.hero;
  const inside =
    h.x >= r.box[0] + 0.8 && h.x <= r.box[2] + 1 && h.y >= r.box[1] && h.y <= r.box[3] + 1;
  const alive = r.anchors.filter((p) => p.alive).length;
  F14_FX.bigGlass.broken = alive === 0 && r.state !== 'idle' ? 1 : 0;
  F14_FX.bigGlass.on = r.state === 'on' ? 1 : 0;
  if (r.state === 'idle') {
    F14_FX.bigGlass.k = 1;
    if (inside && !heroDown(sim)) {
      r.state = 'on';
      r.t = r.cycle;
      r.flips = 0;
      r.dead = [];
      for (const i of r.bars) saveTile(sim, st, api, i, T_WALL, MK.bars);
      sim.events.push({
        t: 'boss',
        what: 'f14_rewind_trap',
        text: 'ОТМОТКА',
        sub: 'разбей три якоря — иначе павшие встанут',
      });
      spawnRewindWave(sim, r, api, ['f14_sand', 'f14_rewinder', 'f14_beetle', 'f14_beetle']);
    }
    return;
  }
  if (r.state === 'done') return;
  if (heroDown(sim)) {
    for (const i of r.bars) restoreTile(sim, st, api, i);
    r.state = 'idle';
    return;
  }
  r.t -= dt;
  F14_FX.bigGlass.k = clamp(r.t / r.cycle, 0, 1);
  for (let i = r.rising.length - 1; i >= 0; i--) {
    const q = r.rising[i];
    if (sim.time < q.at) continue;
    r.rising.splice(i, 1);
    const m = api.spawnMob(sim, q.kind, q.x, q.y, { mode: 'stun' });
    r.mobs.add(m.id);
  }
  if (r.t <= 0) {
    r.flips += 1;
    r.t = r.cycle;
    F14_FX.bigGlass.flip = F14_FX.clock;
    if (alive > 0) {
      // Часы перевернулись: павшие встают там, где пали.
      for (const d of r.dead) {
        r.rising.push({ ...d, at: sim.time + RWH.warn });
        api.zone(sim, { x: d.x, y: d.y, r: 0.6, life: RWH.warn, art: 'f14_risemark' });
      }
      if (r.dead.length)
        sim.events.push({
          t: 'boss',
          what: 'f14_flipback',
          text: 'ПАВШИЕ ВСТАЮТ',
          sub: `${r.dead.length} — из песка`,
        });
      r.dead = [];
      if (r.flips <= 3)
        spawnRewindWave(
          sim,
          r,
          api,
          r.flips === 3 ? ['f14_reaper', 'f14_sand'] : ['f14_rewinder', 'f14_sand'],
        );
    }
  }
  for (const m of sim.mobs)
    if (m.mode === 'dying' && r.mobs.has(m.id) && !m.data.rwCounted) {
      m.data.rwCounted = 1;
      r.dead.push({ kind: m.kind, x: m.x, y: m.y });
    }
  const live = sim.mobs.filter((m) => r.mobs.has(m.id) && m.mode !== 'dying').length;
  if (alive === 0 && live === 0 && !r.rising.length) {
    r.state = 'done';
    for (const i of r.bars) restoreTile(sim, st, api, i);
    const gx = r.glass ? r.glass.x : h.x;
    const gy = r.glass ? r.glass.y + 1.4 : h.y;
    for (let i = 0; i < 4; i++) api.dropAt(sim, 'token', 3 + Math.floor(sim.rng() * 3), gx, gy);
    for (let i = 0; i < 3; i++) api.dropAt(sim, 'f14_sand', 1, gx, gy);
    api.dropAt(sim, 'coin', 1200, gx, gy);
    if (sim.rng() < 0.35) api.dropAt(sim, 'key', 1, gx, gy);
    sim.events.push({
      t: 'boss',
      what: 'f14_rewind_done',
      text: 'ЧАСЫ РАЗБИТЫ',
      sub: 'время в зале пошло вперёд',
    });
  }
}

function spawnRewindWave(sim: Sim, r: RewindHall, api: SimApi, kinds: string[]): void {
  kinds.forEach((kind, i) => {
    const x = r.box[0] + 1.5 + sim.rng() * (r.box[2] - r.box[0] - 2);
    const y = r.box[1] + 2 + sim.rng() * (r.box[3] - r.box[1] - 4);
    if (api.solidTile(sim, Math.floor(x), Math.floor(y))) return;
    const m = api.spawnMob(sim, kind, x, y, { mode: 'drop' });
    m.t = -i * 0.3;
    r.mobs.add(m.id);
  });
}

// ---- Стоп-кадр ------------------------------------------------------------

const FRAME = {
  count: 3,
  speed: 10.5,
  kinds: ['f14_reaper', 'f14_soldier', 'f14_keeper', 'f14_sand', 'f14_rewinder', 'f14_soldier'],
};

/** Куда смотрит нож (для рисовальщика): id снаряда → угол. */
export const KNIFE_ANG = new Map<number, number>();

/** Нож: снаряд, который висит, пока его не пустят. */
function knife(sim: Sim, x: number, y: number, ang: number, dmg: number, kind: string): Shot {
  const s: Shot = {
    id: sim.nextId++,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 0.26,
    life: 3,
    age: -1e6,
    dmg,
    art: 'f14_knife',
    z: 0,
    kind,
  };
  sim.shots.push(s);
  KNIFE_ANG.set(s.id, ang);
  // Линия полёта видна, пока нож висит (рисует этаж, пока снаряд не пущен).
  sim.zones.push({
    id: sim.nextId++,
    t: 0,
    x,
    y,
    r: 0.2,
    life: 60,
    art: 'f14_knifeline',
    ang,
    shot: s.id,
  } as Zone);
  if (KNIFE_ANG.size > 400) {
    const live = new Set(sim.shots.map((q) => q.id));
    for (const id of KNIFE_ANG.keys()) if (!live.has(id)) KNIFE_ANG.delete(id);
  }
  return s;
}

/** Время в Стоп-кадре пошло: ножи летят, враги доделывают замах. */
function frameGo(sim: Sim, fr: FrameHall, api: SimApi): void {
  fr.state = 'fight';
  for (const k of fr.knives) {
    const s = sim.shots.find((x) => x.id === k.id);
    if (!s) continue;
    s.age = 0;
    s.life = 2.6;
    s.vx = Math.cos(k.ang) * FRAME.speed;
    s.vy = Math.sin(k.ang) * FRAME.speed;
  }
  for (const m of sim.mobs)
    if (fr.mobs.has(m.id) && m.mode === 'f14_frozen') {
      m.data.ghost = 0;
      api.setMode(m, 'chase');
      m.cd = 0.4;
    }
  F14_FX.frame = 1;
  sim.events.push({ t: 'flash', color: '#fff4d8', k: 0.7 });
  sim.events.push({ t: 'boss', what: 'f14_resume', text: 'ВРЕМЯ ПОШЛО' });
}

function stepFrame(sim: Sim, st: F14State, api: SimApi, dt: number): void {
  const fr = st.frame;
  if (!fr) return;
  const h = sim.hero;
  const cx = (fr.box[0] + fr.box[2] + 1) / 2;
  const cy = (fr.box[1] + fr.box[3] + 1) / 2;
  const d = hypot(h.x - cx, h.y - cy);
  // Ножи висят, пока время в зале стоит.
  const hold = () => {
    for (const k of fr.knives) {
      const s = sim.shots.find((x) => x.id === k.id);
      if (s) s.age = -1e6;
    }
  };
  switch (fr.state) {
    case 'idle': {
      if (d > 18) return;
      fr.state = 'still';
      F14_FX.frame = 0;
      fr.knives = [];
      fr.kspots.forEach(([x, y], i) => {
        const a = Math.atan2(cy - y, cx - x) + (i % 2 ? 0.35 : -0.35);
        const s = knife(sim, x, y, a, rawShare(sim, 0.13), 'f14_keeper');
        fr.knives.push({ id: s.id, ang: a });
      });
      fr.spots.forEach(([x, y], i) => {
        const m = api.spawnMob(sim, FRAME.kinds[i % FRAME.kinds.length], x, y, {
          mode: 'f14_frozen',
        });
        m.face = Math.atan2(cy - y, cx - x);
        m.dir = m.face;
        m.data.frame = 1;
        fr.mobs.add(m.id);
      });
      return;
    }
    case 'still': {
      hold();
      const hitOne = sim.mobs.some((m) => fr.mobs.has(m.id) && m.hp < m.maxHp);
      const inMid = h.y < fr.mid + 3 && h.x > fr.box[0] && h.x < fr.box[2] + 1 && h.y > fr.box[1];
      if (inMid || hitOne) {
        fr.state = 'count';
        fr.t = FRAME.count;
        sim.events.push({
          t: 'boss',
          what: 'f14_frame_call',
          text: 'СТОП-КАДР',
          sub: 'три секунды — уйди с линий ножей',
        });
      }
      return;
    }
    case 'count':
      hold();
      fr.t -= dt;
      if (fr.t <= 0) frameGo(sim, fr, api);
      return;
    case 'fight': {
      const live = sim.mobs.filter((m) => fr.mobs.has(m.id) && m.mode !== 'dying').length;
      if (live === 0) {
        fr.state = 'done';
        for (let i = 0; i < 4; i++) api.dropAt(sim, 'token', 3 + Math.floor(sim.rng() * 3), cx, cy);
        for (let i = 0; i < 2; i++) api.dropAt(sim, 'f14_glass', 1, cx, cy);
        api.dropAt(sim, 'coin', 1400, cx, cy);
        sim.events.push({
          t: 'boss',
          what: 'f14_frame_done',
          text: 'КАДР ДОСНЯТ',
          sub: 'время в зале снова идёт',
        });
      }
      return;
    }
  }
}

// ---- Полдень ---------------------------------------------------------------

/** Стрелки площади: минутная — круг за 7,2 с, часовая — в 12 раз медленнее. */
export const NOON = { minPeriod: 7.2, minLen: 11.3, hourLen: 7.2, hub: 2.1, w: 0.42 };

/** Задевает ли стрелка (отрезок от ступицы) круг. Угол 0 — XII, по часовой. */
export function handHits(
  cx: number,
  cy: number,
  ang: number,
  r0: number,
  r1: number,
  w: number,
  x: number,
  y: number,
  hr: number,
): boolean {
  const ux = Math.sin(ang);
  const uy = -Math.cos(ang);
  const dx = x - cx;
  const dy = y - cy;
  const al = dx * ux + dy * uy;
  const ac = Math.abs(-dx * uy + dy * ux);
  return al > r0 - hr && al < r1 + hr && ac < w + hr;
}

function stepPlaza(sim: Sim, st: F14State, api: SimApi, dt: number): void {
  const pz = st.plaza;
  if (!pz) return;
  const h = sim.hero;
  const d = hypot(h.x - pz.cx, h.y - pz.cy);
  if (d > pz.r + 6) {
    if (pz.on) {
      pz.on = false;
      api.light(sim, 'f14_noon', null);
    }
    F14_FX.hands.plaza.on = 0;
    return;
  }
  if (!pz.on) {
    // Пришёл на площадь — без пяти полдень: удар колокола случится при нём.
    pz.on = true;
    pz.min = 0;
    pz.hour = -(TAU / 12) * 0.32;
    pz.noon = false;
    pz.wind = false;
    sim.events.push({
      t: 'boss',
      what: 'f14_noon_call',
      text: 'ПОЛДЕНЬ',
      sub: 'стрелки метут площадь — ступица безопасна',
    });
  }
  const wm = TAU / NOON.minPeriod;
  pz.min += wm * dt;
  pz.hour += (wm / 12) * dt;
  pz.hitM = Math.max(0, pz.hitM - dt);
  pz.hitH = Math.max(0, pz.hitH - dt);
  const hourAt = ((pz.hour % TAU) + TAU) % TAU;
  // Часовая идёт ровно: за 2 с до полудня — «вдох» под звук остановки.
  if (!pz.wind && pz.hour < 0 && -pz.hour <= (wm / 12) * STOP_LEAD) {
    pz.wind = true;
    sim.events.push({ t: 'boss', what: 'f14_bell_wind' });
  }
  if (!pz.noon && hourAt < 0.1 && pz.hour >= 0) {
    pz.noon = true;
    ringBell(sim, api, 2.4);
  }
  F14_FX.hands.plaza = { m: pz.min, h: pz.hour, on: 1 };
  // Кончик минутной стрелки светит — видно, откуда она идёт.
  api.light(sim, 'f14_noon', {
    x: pz.cx + Math.sin(pz.min) * (NOON.minLen - 1.2),
    y: pz.cy - Math.cos(pz.min) * (NOON.minLen - 1.2),
    r: 3.2,
    tint: 'warm',
  });
  if (!sim.zones.some((z) => z.art === 'f14_hands' && (z as { which?: string }).which === 'plaza'))
    api.zone(sim, {
      x: pz.cx,
      y: pz.cy,
      r: pz.r,
      life: 1e9,
      art: 'f14_hands',
      which: 'plaza',
    } as ZoneIn);
  if (dt <= 0 || heroDown(sim)) return;
  sweepHands(sim, api, pz.cx, pz.cy, pz.min, pz.hour, NOON.minLen, NOON.hourLen, pz);
}

/** Стрелки бьют героя и расталкивают мобов. */
function sweepHands(
  sim: Sim,
  api: SimApi,
  cx: number,
  cy: number,
  min: number,
  hour: number,
  minLen: number,
  hourLen: number,
  cd: { hitM: number; hitH: number },
): void {
  const h = sim.hero;
  const hit = (ang: number, len: number, which: 'm' | 'h') => {
    if (handHits(cx, cy, ang, NOON.hub, len, NOON.w, h.x, h.y, h.r) && canHurt(sim)) {
      if (which === 'm' ? cd.hitM > 0 : cd.hitH > 0) return;
      if (which === 'm') cd.hitM = 0.9;
      else cd.hitH = 0.9;
      // Толчок — по ходу стрелки (по часовой).
      const tx = Math.cos(ang);
      const ty = Math.sin(ang);
      api.hurtHero(sim, rawShare(sim, which === 'm' ? 0.12 : 0.16), h.x - tx, h.y - ty, 6);
      sim.events.push({ t: 'boss', what: 'f14_handhit' });
    }
    for (const m of sim.mobs) {
      if (m.mode === 'dying' || m.kind.endsWith('boss') || (m.data.ghost ?? 0) > 0) continue;
      if (!handHits(cx, cy, ang, NOON.hub, len, NOON.w, m.x, m.y, m.r)) continue;
      if ((m.data.handT ?? 0) > sim.time) continue;
      m.data.handT = sim.time + 0.8;
      m.kx += Math.cos(ang) * 7;
      m.ky += Math.sin(ang) * 7;
      envHurt(sim, api, m, 0.2);
    }
  };
  hit(min, minLen, 'm');
  hit(hour, hourLen, 'h');
}

// ---- Сферы с карты, лампы арены -------------------------------------------

function makeMapSpheres(sim: Sim, st: F14State, api: SimApi): void {
  if (st.spheresMade) return;
  st.spheresMade = true;
  const w = sim.world;
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const k = w.mark[y * w.w + x];
      if (k === MK.slow) addSphere(sim, api, x + 0.5, y + 0.5, 2.3, 0.4, 1e9);
      else if (k === MK.fast) addSphere(sim, api, x + 0.5, y + 0.5, 2, 1.6, 1e9);
    }
}

/** Вернуть сферы с карты, если сброс боя смыл зоны. */
function keepSpheres(sim: Sim, st: F14State, api: SimApi): void {
  const T = timeOf(sim);
  if (!st.spheresMade || T.spheres.some((s) => s.until === Infinity)) return;
  st.spheresMade = false;
  makeMapSpheres(sim, st, api);
}

/** Часовые лампы арены: горят все, кроме погасших в полночь. */
function lightLamps(sim: Sim, st: F14State, api: SimApi, out: number): void {
  for (const l of st.lamps) {
    if (l.hour < out) api.light(sim, l.key, null);
    else api.light(sim, l.key, { x: l.x, y: l.y - 0.2, r: 2.6, tint: 'warm' });
  }
}

// ---- Действия этажа ----------------------------------------------------------

function labelOf(sim: Sim, obj: WorldObj): string | null {
  const st = STATE.get(sim);
  if (!st) return null;
  switch (obj.ref) {
    case 'f14_lever': {
      if (st.gear?.lever?.obj === obj) {
        if (sim.time < st.gear.stopUntil) return null;
        return st.gear.leverCd > 0 ? null : 'Стопор';
      }
      const f = st.factory;
      if (f?.lever?.obj === obj) return f.state === 'wind' || f.state === 'idle' ? 'Стопор' : null;
      return null;
    }
    case 'f14_glass': {
      const fl = FLOOD.get(sim);
      return fl && fl.state === 'rise' && !fl.used.has(obj.id) ? 'Перевернуть' : null;
    }
    case 'f14_bell':
      if (sim.boss?.state === 'fight' || worldStopped(sim)) return null;
      return st.bellCd > sim.time ? null : 'Ударить в колокол';
    case 'f14_bigpendulum':
      return st.frame && (st.frame.state === 'still' || st.frame.state === 'count')
        ? 'Толкнуть маятник'
        : null;
  }
  return obj.use?.label ?? null;
}

function onUse(sim: Sim, obj: WorldObj, api: SimApi): boolean {
  const st = stateOf(sim);
  if (!labelOf(sim, obj)) return false;
  switch (obj.ref) {
    case 'f14_lever':
      if (st.gear?.lever?.obj === obj) {
        st.gear.stopUntil = sim.time + GEAR.stop;
        st.gear.leverCd = GEAR.leverCd;
        sim.events.push({
          t: 'boss',
          what: 'f14_lever',
          text: 'СТОПОР',
          sub: 'кольца стоят восемь секунд',
        });
        return true;
      }
      return factoryStop(sim, st, api);
    case 'f14_glass':
      return floodHold(sim, obj, api);
    case 'f14_bell':
      st.bellCd = sim.time + 40;
      ringBell(sim, api, 2.6);
      return true;
    case 'f14_bigpendulum':
      if (st.frame) frameGo(sim, st.frame, api);
      return true;
  }
  return false;
}

registerFloor(14, {
  start(sim, api) {
    STATE.set(sim, scan(sim));
    TIME.delete(sim);
    timeOf(sim);
    const st = stateOf(sim);
    makeMapSpheres(sim, st, api);
    lightLamps(sim, st, api, 0);
    API_REF.api = api;
  },
  step(sim, dt, api) {
    API_REF.api = api;
    const st = stateOf(sim);
    F14_FX.clock += dt;
    stepTime(sim, api, dt);
    keepSpheres(sim, st, api);
    // Удары героя — в историю (двойник их повторит).
    const T = timeOf(sim);
    for (const e of sim.events)
      if (e.t === 'swing' && !heroDown(sim))
        T.swings.push({ t: sim.time, x: e.x, y: e.y, ang: e.ang, heavy: e.heavy });
    stepPends(sim, st, api, dt);
    stepGear(sim, st, api, dt);
    stepFlood(sim, api, dt);
    if (heroDown(sim)) return;
    stepBell(sim, dt, api);
    stepPosts(sim, st, api);
    stepFactory(sim, st, api, dt);
    stepRewindHall(sim, st, api, dt);
    stepFrame(sim, st, api, dt);
    stepPlaza(sim, st, api, dt);
  },
  onUse,
  useLabel: labelOf,
});

/** Сценарий босса получает `api` в `step`; для прочего — последний. */
const API_REF: { api: SimApi | null } = { api: null };

// ---------------------------------------------------------------------------
// Повелитель часа. Ведёт все режимы сам (босс).
//   chase        — идёт к герою, выбирает приём;
//   f14_hour     — часовая стрелка рубит конусом;
//   f14_minute   — минутная: прицел линией, выпад — стрелка застревает
//                  (f14_stuck — окно);
//   f14_spin     — обе стрелки кругом: кольцо (вплотную или далеко — мимо);
//   f14_clap     — хлопок: ОСТАНОВКА. Стоит мир и герой; Повелитель встаёт
//                  рядом, ставит ножи кольцом (проём — один), отходит;
//                  время пошло — ножи летят (f14_place);
//   f14_toHub, f14_ritual — ОТМОТКА: в ступице переворачивает часы; не
//                  снял порог (засечка на полосе) — здоровье вернётся;
//                  снял — f14_broken (оглушён, открыт);
//   ПОЛНОЧЬ      — бьёт час, гаснет лампа, стрелки арены метут пол;
//                  двенадцатый удар — вся арена, кроме ступицы;
//                  f14_tired — выдохся после полуночи (окно).
// ---------------------------------------------------------------------------

export const LORD = {
  hp: [0.75, 0.5, 0.25],
  hourR: 2.7,
  hourArc: 1.9,
  hourWarn: 0.8,
  minLen: 6.5,
  minW: 0.48,
  minWarn: 0.72,
  lunge: 0.2,
  stuck: 1,
  spinR: 2.1,
  spinW: 0.72,
  spinWarn: 0.9,
  /** Хлопок перед остановкой: столько же, сколько «вдох» звука. */
  clap: STOP_LEAD,
  stopDur: 2.2,
  knifeR: 3.3,
  /** Ножей в кольце (чётное: проём сквозной). */
  knives: 10,
  knifeSpeed: 10,
  knifeDelay: 0.35,
  stopEvery: 11,
  ritual: 5.5,
  need: 0.04,
  ritualEvery: 14,
  regain: 0.1,
  broken: 2.4,
  toll: 3,
  midnightWarn: 2,
  tired: 3,
};

interface LordState {
  /** История здоровья (для отмотки). */
  hp: { t: number; hp: number }[];
  hpT: number;
  /** Клетки, сменённые боем. */
  changed: Map<number, { tile: number; mark: number }>;
  /** Ножи последней остановки: id → угол; когда полетят. */
  knives: { id: number; ang: number }[];
  launchAt: number;
  /** Остановка — его: настоящие секунды считает сам. */
  own: boolean;
  placed: number;
  /** Отмотка: здоровье в начале ритуала, порог. */
  ritualHp: number;
  need: number;
  /** Полночь. */
  tolls: number;
  nextToll: number;
  min: number;
  hour: number;
  hitM: number;
  hitH: number;
  stopCd: number;
  ritualCd: number;
  stops: number;
}

const LSTATE = new WeakMap<Sim, LordState>();

function lordState(sim: Sim): LordState {
  let s = LSTATE.get(sim);
  if (!s) {
    s = {
      hp: [],
      hpT: 0,
      changed: new Map(),
      knives: [],
      launchAt: 0,
      own: false,
      placed: 0,
      ritualHp: 0,
      need: 0,
      tolls: 0,
      nextToll: 0,
      min: 0,
      hour: 0,
      hitM: 0,
      hitH: 0,
      stopCd: 6,
      ritualCd: 0,
      stops: 0,
    };
    LSTATE.set(sim, s);
  }
  return s;
}

const lordOf = (sim: Sim) => sim.mobs.find((x) => x.kind === 'f14boss' && x.mode !== 'dying');

/** Вид циферблата арены по фазе: эмаль, цифры, песок по краю. */
function arenaLook(sim: Sim, api: SimApi, b: BossFight, phase: number): void {
  const s = lordState(sim);
  const w = sim.world;
  const dialMark =
    phase === 1 ? MK.dialStop : phase === 2 ? MK.dialRewind : phase === 3 ? MK.dialNight : MK.dial;
  const numMark =
    phase === 1 ? MK.numStop : phase === 2 ? MK.numRewind : phase === 3 ? MK.numNight : MK.numeral;
  const [ax, ay] = geoWorld(sim, F14_GEO.arena);
  for (const i of b.cells) {
    const k = s.changed.get(i)?.mark ?? w.mark[i];
    const x = (i % w.w) + 0.5;
    const y = Math.floor(i / w.w) + 0.5;
    const r = hypot(x - ax, y - ay);
    if (!s.changed.has(i)) s.changed.set(i, { tile: sim.tiles[i], mark: w.mark[i] });
    if (k === MK.dial) {
      // Отмотка: по краю — песок, вязнет.
      if (phase === 2 && r > 8.4)
        api.setTile(sim, i % w.w, Math.floor(i / w.w), T_HAZARD, MK.rimSand, { slow: 0.55 });
      else api.setTile(sim, i % w.w, Math.floor(i / w.w), T_FLOOR, dialMark, null);
    } else if (k === MK.numeral)
      api.setTile(sim, i % w.w, Math.floor(i / w.w), T_FLOOR, numMark, null);
  }
}

function restoreArena(sim: Sim, api: SimApi): void {
  const s = LSTATE.get(sim);
  if (s) {
    const W = sim.world.w;
    for (const [i, v] of s.changed)
      api.setTile(sim, i % W, Math.floor(i / W), v.tile, v.mark, null);
  }
  LSTATE.delete(sim);
  F14_FX.midnight = 0;
  F14_FX.bossPhase = 0;
  F14_FX.hands.arena.on = 0;
  const st = STATE.get(sim);
  if (st) lightLamps(sim, st, api, 0);
}

/** Здоровье Повелителя `ago` секунд назад. */
function lordHpAgo(s: LordState, now: number, ago: number, cur: number): number {
  const t = now - ago;
  let v = cur;
  for (const p of s.hp) if (p.t <= t) v = p.hp;
  return v;
}

/**
 * Ножи кольцом вокруг героя: проём — туда уходить. Проём — СКВОЗНОЙ: пустое
 * место и напротив него. Иначе нож с дальней стороны летел бы через центр
 * ровно по проёму и бил в спину тому, кто в него ушёл.
 */
function knifeRing(sim: Sim, lead: Mob, n: number, lanes: number): void {
  const s = lordState(sim);
  const h = sim.hero;
  const total = n + 2 * lanes;
  const half = total / 2;
  const gap0 = Math.floor(sim.rng() * half);
  const skip = new Set<number>();
  for (let g = 0; g < lanes; g++) {
    const k = (gap0 + Math.round((g * half) / lanes)) % half;
    skip.add(k);
    skip.add(k + half);
  }
  s.knives = [];
  const W = sim.world.w;
  for (let i = 0; i < total; i++) {
    if (skip.has(i)) continue;
    const a = (i / total) * TAU + 0.2;
    const x = h.x + Math.cos(a) * LORD.knifeR;
    const y = h.y + Math.sin(a) * LORD.knifeR;
    const t = sim.tiles[Math.floor(y) * W + Math.floor(x)];
    if (t !== T_FLOOR && t !== T_HAZARD) continue;
    const k = knife(sim, x, y, a + Math.PI, lead.dmg * 1.05, 'f14boss');
    k.life = 1.2;
    s.knives.push({ id: k.id, ang: a + Math.PI });
  }
}

function launchKnives(sim: Sim): void {
  const s = lordState(sim);
  for (const k of s.knives) {
    const sh = sim.shots.find((x) => x.id === k.id);
    if (!sh) continue;
    sh.age = 0;
    sh.vx = Math.cos(k.ang) * LORD.knifeSpeed;
    sh.vy = Math.sin(k.ang) * LORD.knifeSpeed;
  }
  s.knives = [];
  s.launchAt = 0;
}

/** Пока мир стоит по его воле: подходит, ставит ножи, отходит. */
function lordPlace(sim: Sim, m: Mob, api: SimApi): void {
  const s = lordState(sim);
  const h = sim.hero;
  const ph = sim.boss?.phase ?? 0;
  const [ax, ay] = geoWorld(sim, F14_GEO.arena);
  const t = stopElapsed(sim);
  if (s.placed === 0 && t > 0.3) {
    s.placed = 1;
    const to = spotNear(sim, api, h.x, h.y, 1.6, 2.3, (px, py) => -hypot(px - m.x, py - m.y));
    if (to) {
      m.x = to[0];
      m.y = to[1];
      m.face = Math.atan2(h.y - m.y, h.x - m.x);
    }
    knifeRing(sim, m, ph >= 3 ? LORD.knives + 2 : LORD.knives, ph >= 3 ? 2 : 1);
    sim.events.push({ t: 'boss', what: 'f14_knives' });
  }
  if (s.placed === 1 && t > 1.1) {
    s.placed = 2;
    const to = spotNear(
      sim,
      api,
      ax,
      ay,
      4,
      7,
      (px, py) => -Math.abs(hypot(px - h.x, py - h.y) - 5),
    );
    if (to) {
      m.x = to[0];
      m.y = to[1];
    }
  }
}

function lordStep(sim: Sim, m: Mob, dt: number, c: BrainCtx, api: SimApi): void {
  const b = sim.boss;
  if (!b || b.state !== 'fight') {
    m.vx *= 0.8;
    m.vy *= 0.8;
    return;
  }
  const s = lordState(sim);
  const h = sim.hero;
  const { dx, dy, dist } = c;
  const [ax, ay] = geoWorld(sim, F14_GEO.arena);
  const ph = b.phase;
  const haste = ph >= 3 ? 1.25 : ph >= 2 ? 1.12 : 1;
  // Его остановка: мир стоит, он ставит ножи (настоящие секунды).
  if (worldStopped(sim)) {
    m.vx = 0;
    m.vy = 0;
    if (s.own) lordPlace(sim, m, api);
    return;
  }
  if (s.own) {
    s.own = false;
    s.launchAt = sim.time + LORD.knifeDelay;
    if (m.mode === 'f14_place') {
      api.setMode(m, 'recover');
      m.cd = 0.8;
    }
  }
  if (s.launchAt && sim.time >= s.launchAt) launchKnives(sim);
  m.tele = null;
  m.danger = 0;
  s.hpT -= dt;
  if (s.hpT <= 0) {
    s.hpT = 0.25;
    s.hp.push({ t: sim.time, hp: m.hp });
    while (s.hp.length && s.hp[0].t < sim.time - 16) s.hp.shift();
  }
  s.stopCd -= dt;
  s.ritualCd -= dt;
  const go = (x: number, y: number, sp: number) => {
    const ex = x - m.x;
    const ey = y - m.y;
    const el = hypot(ex, ey);
    if (el > 0.1) api.steer(sim, m, ex / el, ey / el, sp, dt);
  };
  switch (m.mode) {
    case 'roar':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 1.6) api.setMode(m, 'chase');
      return;
    case 'chase': {
      if (ph >= 1 && s.stopCd <= 0 && dist < 9 && !s.knives.length) {
        // Хлопок — замах остановки: стрелки вверх, лицо разгорается две
        // секунды (звук остановки бьёт как раз через две), и всё это время
        // он стоит — окно.
        api.setMode(m, 'f14_clap');
        sim.events.push({ t: 'boss', what: 'f14_clap' });
        return;
      }
      if (ph === 2 && s.ritualCd <= 0) {
        api.setMode(m, 'f14_toHub');
        return;
      }
      if (m.cd <= 0) {
        if (dist < LORD.spinR + 0.4 && sim.rng() < 0.35) {
          api.setMode(m, 'f14_spin');
          return;
        }
        if (dist < LORD.hourR - 0.2) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f14_hour');
          return;
        }
        if (dist < LORD.minLen - 0.3 && api.lineOfSight(sim, m.x, m.y, h.x, h.y)) {
          m.dir = Math.atan2(dy, dx);
          api.setMode(m, 'f14_minute');
          return;
        }
      }
      const [cx, cy] = api.chaseDir(sim, m, h.x, h.y);
      api.steer(sim, m, cx, cy, m.speed * haste * (dist < 2 ? 0.4 : 1), dt);
      return;
    }
    case 'f14_hour': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t < 0.22) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      const warn = LORD.hourWarn / haste;
      if (!m.data.lit && m.t >= 0.22) {
        m.data.lit = 1;
        api.strike(sim, {
          shape: 'cone',
          x: m.x,
          y: m.y,
          r: LORD.hourR,
          ang: m.dir,
          arc: LORD.hourArc,
          warn: warn - 0.22,
          dmg: m.dmg * 1.2,
          knock: 6,
          art: 'f14_lordhour',
          from: m.id,
        });
      }
      if (m.t > warn - 0.26) m.danger = LORD.hourR + 0.4;
      if (m.t >= warn) {
        m.data.lit = 0;
        api.setMode(m, 'recover');
        m.cd = 0.8 / haste + sim.rng() * 0.4;
      }
      return;
    }
    case 'f14_minute': {
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t < 0.25) m.dir = Math.atan2(dy, dx);
      m.face = m.dir;
      const warn = LORD.minWarn / haste;
      const len = Math.max(
        1.5,
        Math.min(LORD.minLen, clearDist(sim, api, m.x, m.y, m.dir, LORD.minLen) - 0.4),
      );
      m.data.len = len;
      m.tele = { shape: 'line', r: len, w: LORD.minW, ang: m.dir, k: clamp(m.t / warn, 0, 1) };
      if (m.t > warn - 0.26) m.danger = len + 0.6;
      if (m.t >= warn) {
        const ux = Math.cos(m.dir);
        const uy = Math.sin(m.dir);
        const hx = h.x - m.x;
        const hy = h.y - m.y;
        const al = hx * ux + hy * uy;
        const ac = Math.abs(-hx * uy + hy * ux);
        if (al > -0.3 && al < len + h.r && ac < LORD.minW + h.r && canHurt(sim))
          api.hurtHero(sim, m.dmg * 1.3, m.x, m.y, 7, m.kind);
        m.data.lx = m.x + ux * Math.max(0, len - 0.6);
        m.data.ly = m.y + uy * Math.max(0, len - 0.6);
        m.data.sx = m.x;
        m.data.sy = m.y;
        api.setMode(m, 'f14_lunge');
      }
      return;
    }
    case 'f14_lunge': {
      const k = clamp(m.t / LORD.lunge, 0, 1);
      m.x = (m.data.sx ?? m.x) + ((m.data.lx ?? m.x) - (m.data.sx ?? m.x)) * k;
      m.y = (m.data.sy ?? m.y) + ((m.data.ly ?? m.y) - (m.data.sy ?? m.y)) * k;
      m.vx = 0;
      m.vy = 0;
      if (k >= 1) {
        sim.events.push({ t: 'boss', what: 'f14_stuck_wall' });
        sim.events.push({ t: 'shake', k: 0.3 });
        api.setMode(m, 'f14_stuck');
      }
      return;
    }
    case 'f14_stuck':
      // Стрелка вошла в пол — окно.
      m.vx *= 0.6;
      m.vy *= 0.6;
      if (m.t > LORD.stuck) {
        api.setMode(m, 'recover');
        m.cd = 0.5;
      }
      return;
    case 'f14_spin': {
      m.vx *= 0.7;
      m.vy *= 0.7;
      const warn = LORD.spinWarn / haste;
      if (!m.data.lit) {
        m.data.lit = 1;
        api.strike(sim, {
          shape: 'ring',
          x: m.x,
          y: m.y,
          r: LORD.spinR,
          w: LORD.spinW,
          warn,
          dmg: m.dmg,
          knock: 7,
          art: 'f14_lordspin',
          from: m.id,
        });
      }
      if (m.t > warn - 0.25) m.danger = LORD.spinR + LORD.spinW + 0.3;
      if (m.t >= warn) {
        m.data.lit = 0;
        api.setMode(m, 'recover');
        m.cd = 0.9 / haste + sim.rng() * 0.4;
      }
      return;
    }
    case 'f14_clap':
      // Хлопок: стрелки вверх, лицо-циферблат разгорается.
      m.vx *= 0.6;
      m.vy *= 0.6;
      m.face = Math.atan2(dy, dx);
      if (m.t >= LORD.clap) {
        const dur = ph >= 3 ? 1.6 : LORD.stopDur;
        s.own = true;
        s.placed = 0;
        s.stops += 1;
        s.stopCd = LORD.stopEvery - (ph >= 3 ? 3 : 0);
        api.setMode(m, 'f14_place');
        stopWorld(sim, api, dur, 'boss');
        sim.events.push({
          t: 'boss',
          what: 'f14_stop',
          text: 'ОСТАНОВКА',
          sub: s.stops === 1 ? 'время пойдёт — уходи в проём или рывком сквозь ножи' : undefined,
        });
      }
      return;
    case 'f14_place':
      // Мир снова идёт — сюда попадаем, только если остановку сорвали.
      api.setMode(m, 'recover');
      return;
    case 'f14_toHub': {
      go(ax, ay, m.speed * 1.6);
      if (hypot(m.x - ax, m.y - ay) < 0.8 || m.t > 3.5) {
        m.x = ax;
        m.y = ay;
        s.ritualHp = m.hp;
        s.need = m.maxHp * LORD.need;
        api.setMode(m, 'f14_ritual');
        api.zone(sim, { x: ax, y: ay, r: 2.4, life: LORD.ritual, art: 'f14_glassring' });
        sim.events.push({
          t: 'boss',
          what: 'f14_rewind_call',
          text: 'ОТМОТКА',
          sub: 'сними порог на полосе, пока сыплется песок',
        });
        // Двое отмотчиков встают из песка у края.
        for (let i = 0; i < 2; i++) {
          const a = sim.rng() * TAU;
          const x = ax + Math.cos(a) * 7;
          const y = ay + Math.sin(a) * 7;
          if (!api.solidTile(sim, Math.floor(x), Math.floor(y)))
            api.spawnMob(sim, 'f14_rewinder', x, y, { mode: 'drop' });
        }
      }
      return;
    }
    case 'f14_ritual': {
      m.vx = 0;
      m.vy = 0;
      m.x = ax;
      m.y = ay;
      if (s.ritualHp - m.hp >= s.need) {
        api.setMode(m, 'f14_broken');
        s.ritualCd = LORD.ritualEvery;
        sim.zones = sim.zones.filter((z) => z.art !== 'f14_glassring');
        sim.events.push({ t: 'shake', k: 0.4 });
        sim.events.push({
          t: 'boss',
          what: 'f14_ritual_stone',
          text: 'ОТМОТКА СОРВАНА',
          sub: 'часы разбиты — бей',
        });
        return;
      }
      if (m.t >= LORD.ritual) {
        const back = lordHpAgo(s, sim.time, 12, m.hp);
        const gain = clamp(back - m.hp, 0, m.maxHp * LORD.regain);
        m.hp += gain;
        s.ritualCd = LORD.ritualEvery;
        sim.events.push({ t: 'flash', color: '#8fe8ff', k: 0.6 });
        sim.events.push({
          t: 'boss',
          what: 'f14_ritual',
          text: 'ОТМОТАЛ',
          sub: `+${Math.round((gain / m.maxHp) * 100)}% — не успел`,
        });
        api.setMode(m, 'recover');
      }
      return;
    }
    case 'f14_broken':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > LORD.broken) api.setMode(m, 'chase');
      return;
    case 'f14_tired':
      m.vx *= 0.7;
      m.vy *= 0.7;
      if (m.t > LORD.tired) api.setMode(m, 'chase');
      return;
    case 'recover':
      m.vx *= 0.8;
      m.vy *= 0.8;
      if (m.t > 0.55 / haste) api.setMode(m, 'chase');
      return;
    default:
      api.setMode(m, 'chase');
  }
}

registerBrain('f14boss', {
  raw: true,
  step: lordStep,
  onHit(_sim, m) {
    if (m.mode === 'f14_stuck') return 1.5;
    if (m.mode === 'f14_broken' || m.mode === 'f14_tired') return 1.6;
    if (m.mode === 'f14_ritual') return 1.2;
    return 1;
  },
});

registerBoss('f14boss', {
  start(sim, b, lead, api) {
    API_REF.api = api;
    b.phase = 0;
    restoreArena(sim, api);
    const s = lordState(sim);
    s.stopCd = 7;
    s.ritualCd = 0;
    lead.face = Math.PI / 2;
    F14_FX.bossPhase = 0;
    F14_FX.midnight = 0;
    api.setMode(lead, 'roar');
    api.camera(sim, lead.x, lead.y, 2.2);
    sim.events.push({ t: 'shake', k: 0.3 });
    sim.events.push({
      t: 'boss',
      what: 'f14_wake_call',
      text: 'ПОВЕЛИТЕЛЬ ЧАСА',
      sub: 'часовая рубит конусом, минутная — по линии',
    });
  },
  step(sim, b, dt, api) {
    API_REF.api = api;
    const lead = lordOf(sim);
    if (!lead) return;
    const s = lordState(sim);
    const st = stateOf(sim);
    const k = lead.hp / lead.maxHp;
    const busy = (m: Mob) =>
      m.mode === 'f14_place' ||
      m.mode === 'f14_lunge' ||
      m.mode === 'f14_ritual' ||
      m.mode === 'f14_toHub' ||
      m.mode === 'f14_clap';
    if (worldStopped(sim)) return;
    if (b.phase === 0 && k <= LORD.hp[0] && !busy(lead)) {
      b.phase = 1;
      F14_FX.bossPhase = 1;
      arenaLook(sim, api, b, 1);
      s.stopCd = 1.2;
      sim.events.push({ t: 'flash', color: '#e8ecf4', k: 0.8 });
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ОСТАНОВКА',
        sub: 'он останавливает время — и тебя',
      });
    }
    if (b.phase === 1 && k <= LORD.hp[1] && !busy(lead)) {
      b.phase = 2;
      F14_FX.bossPhase = 2;
      arenaLook(sim, api, b, 2);
      s.ritualCd = 1;
      sim.events.push({ t: 'flash', color: '#8fe8ff', k: 0.8 });
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ОТМОТКА',
        sub: 'он возвращает себе время — не дай',
      });
    }
    if (b.phase === 2 && k <= LORD.hp[2] && !busy(lead)) {
      b.phase = 3;
      F14_FX.bossPhase = 3;
      arenaLook(sim, api, b, 3);
      s.tolls = 0;
      s.nextToll = sim.time + 1.5;
      s.min = 0;
      s.hour = 0;
      sim.zones = sim.zones.filter((z) => z.art !== 'f14_glassring');
      sim.events.push({ t: 'flash', color: '#1a2448', k: 1 });
      sim.events.push({
        t: 'boss',
        what: 'phase',
        text: 'ПОЛНОЧЬ',
        sub: 'двенадцать ударов — на двенадцатом стой в ступице',
      });
    }
    // Полночь: стрелки арены метут пол, бьёт час, гаснут лампы.
    if (b.phase >= 3) {
      const [ax, ay] = geoWorld(sim, F14_GEO.arena);
      s.min += (TAU / 6.4) * dt;
      s.hour += (TAU / 38) * dt;
      s.hitM = Math.max(0, s.hitM - dt);
      s.hitH = Math.max(0, s.hitH - dt);
      F14_FX.hands.arena = { m: s.min, h: s.hour, on: 1 };
      if (
        !sim.zones.some((z) => z.art === 'f14_hands' && (z as { which?: string }).which === 'arena')
      )
        api.zone(sim, {
          x: ax,
          y: ay,
          r: 10.6,
          life: 1e9,
          art: 'f14_hands',
          which: 'arena',
          above: true,
        } as ZoneIn);
      if (!heroDown(sim)) sweepHands(sim, api, ax, ay, s.min, s.hour, 9.6, 6.2, s);
      if (sim.time >= s.nextToll && lead.mode !== 'f14_tired') {
        s.tolls += 1;
        F14_FX.midnight = Math.min(12, s.tolls);
        lightLamps(sim, st, api, Math.min(12, s.tolls));
        s.nextToll = sim.time + LORD.toll;
        sim.events.push({ t: 'boss', what: 'f14_toll' });
        if (s.tolls === 12) {
          // Двенадцатый удар: всё, кроме ступицы.
          api.strike(sim, {
            shape: 'ring',
            x: ax,
            y: ay,
            r: 6.6,
            w: 4.5,
            warn: LORD.midnightWarn,
            dmg: rawShare(sim, 0.45),
            knock: 4,
            art: 'f14_midnight',
            above: true,
          });
          sim.events.push({
            t: 'boss',
            what: 'f14_midnight_call',
            text: 'ПОЛНОЧЬ',
            sub: 'в ступицу — две секунды',
          });
          s.nextToll = sim.time + LORD.midnightWarn + 0.1;
        }
        if (s.tolls > 12) {
          // Пробило: выдохся, лампы снова горят.
          s.tolls = 0;
          F14_FX.midnight = 0;
          lightLamps(sim, st, api, 0);
          sim.events.push({ t: 'shake', k: 0.6 });
          s.nextToll = sim.time + LORD.tired + 1.5;
          if (!busy(lead)) api.setMode(lead, 'f14_tired');
        }
      }
    }
  },
  notches(sim) {
    const out: number[] = [...LORD.hp];
    const lead = lordOf(sim);
    if (lead && lead.mode === 'f14_ritual') {
      const s = lordState(sim);
      out.push(clamp((s.ritualHp - s.need) / lead.maxHp, 0, 1));
    }
    return out;
  },
  reset(sim, _b, api) {
    restoreArena(sim, api);
  },
});
