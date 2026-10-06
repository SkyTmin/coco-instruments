// Этаж 2 — мобы грота (анимации мобов 2, по эталону 12–15): гриб-топотун,
// грибёнок, сводовая слизь, мандрагора, сундучный рак, хваталка, монетный
// жук. Облик прежний (`f2-art.ts` до этого выпуска), поменялось ДВИЖЕНИЕ:
//   • каждое действие — трек 24 к/с от `pose.t`, кадр контакта = миг урона
//     мозга (замах занимает весь windup: подготовка → пик → удар → проводка
//     → отдача → возврат), на замахе кадр `still`;
//   • ход — по пройденному пути (частота шага растёт со скоростью, ноги не
//     скользят), 8 сторон: рисуются пять (восток, юго-восток, юг,
//     северо-восток, север), остальные три — зеркалом (`sx < 0`, вторая копия
//     в кеш не ложится); корпус всегда смотрит туда, куда идёт;
//   • реакция на удар героя — отброс по отдаче, вжатие, возврат (5 кадров
//     полями движка, без новых рисунков), белая вспышка — `pose.flash`;
//   • вторичное движение (шляпка, листья, капли, монеты) — те же ключи со
//     сдвигом фазы; покой живой, фаза — от `m.id`;
//   • смерть у каждого своя, долгая — через `linger`;
//   • кадры — `frameLRU` на вид (предел), прогрев `registerMobWarm`.
// Рисунок — «плоский 3D»: тело — овалы со светом сверху-слева, детали
// (лицо, ступни, пятна шляпки, лапы) ставятся проекцией из координат тела
// (вперёд, вбок, вверх), поэтому поворачиваются вместе с ним и не «кипят».
// Состояние рисунка (путь, курс, миг удара) — в `WeakMap` по мобу: в
// `m.data` рисунок не пишет. Случайность — только хеш от `m.id`.

import { x72 } from '../dungeon-tiles';
import { hex, mix, Px, TS } from '../dungeon-art';
import {
  frameLRU,
  paintSim,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
} from '../dungeon-paint';
import type { FrameLRU, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import type { X72Name } from '../dungeon-x72-frames';

type RGBA = [number, number, number, number];
type Look = MobPose['look'];

const INK = hex('#150f0b');
const WHITE: RGBA = [255, 255, 255, 255];
const BLACK: RGBA = [0, 0, 0, 255];
const GOLD = hex('#ffcc40');
const PALE = hex('#f4ece4');
const TAU = Math.PI * 2;
const PI = Math.PI;
const ACID = hex('#b6f24a');
const ACID_L = hex('#eaffb0');

const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a * 255)];

// ---------------------------------------------------------------------------
// Палитры (их же берут иконки и зоны в `f2-art.ts`).
// ---------------------------------------------------------------------------

export const SHR = {
  cap: [hex('#4a2620'), hex('#7a3a2c'), hex('#a8563a'), hex('#d88a5a')],
  spot: hex('#eadcc0'),
  spotD: hex('#b8a88a'),
  gill: hex('#5a3a30'),
  gillD: hex('#3a2420'),
  stalk: [hex('#7a6a58'), hex('#b8aa90'), hex('#dcd0b6'), hex('#f0e8d4')],
  foot: hex('#9a8a72'),
  footD: hex('#6e604e'),
  eye: hex('#1a1210'),
  eyeHi: hex('#f4ff9a'),
  mouth: hex('#3a2018'),
  spore: hex('#d4ff7a'),
};

export const SPR = {
  cap: [hex('#2e1e46'), hex('#5a3a86'), hex('#8a62c0'), hex('#c8a4ff')],
  glow: hex('#f0e4ff'),
  stalk: [hex('#8a8298'), hex('#c4bcd0'), hex('#e4def0'), hex('#ffffff')],
  eye: hex('#1a1220'),
};

export const SLM = {
  body: [hex('#2a5a22'), hex('#4a9a36'), hex('#78c850'), hex('#b8ec80')],
  rim: hex('#123012'),
  core: hex('#1c4418'),
  coreL: hex('#8adc5a'),
  bone: hex('#e8dfc8'),
  bubble: hex('#d8ffa8'),
  hi: hex('#f4ffe0'),
};

export const MDR = {
  leaf: hex('#2f5a2a'),
  leafM: hex('#4f8a3a'),
  leafL: hex('#7cbc4e'),
  vein: hex('#a8dc70'),
  body: [hex('#6a4a3a'), hex('#a8785a'), hex('#d0a07a'), hex('#eac4a0')],
  root: hex('#8a5a44'),
  soil: hex('#3a2a20'),
  soilL: hex('#5a4030'),
  mouth: hex('#3a0a10'),
  tongue: hex('#b83a44'),
  eye: hex('#ff5a3a'),
  eyeD: hex('#2a1010'),
  flower: hex('#e86a8a'),
};

export const MIM = {
  chit: [hex('#3a1614'), hex('#6a2a22'), hex('#9a4430'), hex('#c8704a')],
  tip: hex('#e8a070'),
  eye: hex('#ffb04a'),
  stalk: hex('#5a2420'),
};

export const SNP = {
  vine: hex('#2a4a22'),
  vineM: hex('#3f6e30'),
  vineL: hex('#5f9a44'),
  pod: [hex('#3a1a2a'), hex('#6a2a40'), hex('#9a4a5a'), hex('#c87a84')],
  jaw: [hex('#2a4a22'), hex('#3f6e30'), hex('#6aa84a'), hex('#9fd06a')],
  mouth: hex('#8a1a2a'),
  mouthL: hex('#d84a5a'),
  tooth: hex('#efe6d0'),
  lure: hex('#ff4a6a'),
  leaf: hex('#2f5a2a'),
  leafL: hex('#4f8a3a'),
};

export const BUG = {
  leg: hex('#2a1a10'),
  head: [hex('#1a120a'), hex('#3a2a1a'), hex('#5a4228'), hex('#7a5a38')],
  gold: [hex('#6a4a10'), hex('#b8841e'), hex('#e2b442'), hex('#fff0a0')],
  ruby: hex('#e0344a'),
  sapph: hex('#3a78e8'),
  emer: hex('#3ad878'),
};

// ---------------------------------------------------------------------------
// Свет и формы (как у крыс: овалы со светом сверху-слева по нормали).
// ---------------------------------------------------------------------------

const LX = -0.45;
const LY = -0.75;
const LZ = 0.5;

interface Ell {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

const inE = (e: Ell, x: number, y: number) => {
  const dx = (x + 0.5 - e.x) / e.rx;
  const dy = (y + 0.5 - e.y) / e.ry;
  return dx * dx + dy * dy <= 1;
};

/** Ступень палитры по нормали овала: [тень, тело, свет, блик]. */
function tone(pal: RGBA[], e: Ell, x: number, y: number, bias = 0): RGBA {
  const dx = (x + 0.5 - e.x) / e.rx;
  const dy = (y + 0.5 - e.y) / e.ry;
  const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  const k = dx * LX + dy * LY + nz * LZ + bias;
  if (k > 0.8) return pal[3];
  if (k > 0.45) return pal[2];
  if (k > 0.05) return pal[1];
  return pal[0];
}

/** Залить овал со светотенью; `keep` — какие пиксели оставить (срез). */
function ball(
  px: Px,
  e: Ell,
  pal: RGBA[],
  keep?: (x: number, y: number) => boolean,
  bias = 0,
): void {
  for (let y = Math.floor(e.y - e.ry - 1); y <= Math.ceil(e.y + e.ry + 1); y++)
    for (let x = Math.floor(e.x - e.rx - 1); x <= Math.ceil(e.x + e.rx + 1); x++) {
      if (!inE(e, x, y) || (keep && !keep(x, y))) continue;
      px.set(x, y, tone(pal, e, x, y, bias));
    }
}

/** Лист / лепесток: от основания по углу, ширина — дугой. */
function leaf(
  px: Px,
  bx: number,
  by: number,
  ang: number,
  len: number,
  wid: number,
  c: RGBA,
  mid?: RGBA,
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const R = Math.ceil(len + wid + 1);
  for (let y = Math.floor(by - R); y <= Math.ceil(by + R); y++)
    for (let x = Math.floor(bx - R); x <= Math.ceil(bx + R); x++) {
      const dx = x + 0.5 - bx;
      const dy = y + 0.5 - by;
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      if (u < 0 || u > len) continue;
      const w = wid * Math.sin((Math.PI * u) / len);
      if (Math.abs(v) > w) continue;
      px.set(x, y, mid && Math.abs(v) < 0.5 && u > len * 0.15 ? mid : c);
    }
}

/** Толстая линия (кругляшами). */
function thick(px: Px, x0: number, y0: number, x1: number, y1: number, r: number, c: RGBA): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (r <= 0.6) px.set(x, y, c);
    else px.ell(x, y, r, r, c);
  }
}

/** Мягкое пятно света на слое поверх темноты. */
function glowAt(p: Px, cx: number, cy: number, r: number, c: RGBA, k = 1): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * k;
      if (a > 0.04) p.set(x, y, alpha(c, Math.min(1, a)));
    }
}

// ---------------------------------------------------------------------------
// Кривые и время.
// ---------------------------------------------------------------------------

const FPS = 24;
/** Сжатие земли: вид сверху под углом (как у рига 15-го). */
const SE = 0.6;
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eIn = (k: number) => k * k;
const eOut = (k: number) => 1 - (1 - k) * (1 - k);
const eOut3 = (k: number) => 1 - (1 - k) ** 3;
const eIO = (k: number) => k * k * (3 - 2 * k);
/** Затухающая пружина 0 → 1 с перелётом. */
const spring = (k: number, w = 9) => (k >= 1.6 ? 1 : 1 - Math.exp(-5 * k) * Math.cos(k * w));
/** Затухающее колебание около нуля. */
const wob = (k: number, n = 1.5) =>
  k <= 0 || k >= 1.4 ? 0 : Math.exp(-4 * k) * Math.sin(k * Math.PI * 2 * n);
/** Кадр трека 24 к/с от времени режима (не больше `max`). */
const fi = (t: number, max: number) => Math.max(0, Math.min(max, Math.floor(t * FPS)));
const mod = (n: number, m: number) => ((n % m) + m) % m;
/** Хеш для рисунка (бой не трогает: `sim.rng` рисунок не зовёт). */
function hash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const angD = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};

// ---------------------------------------------------------------------------
// Стороны, ход, реакция на удар.
// ---------------------------------------------------------------------------

/** Нарисованные стороны: восток, юго-восток, юг, северо-восток, север. */
const SIDE_YAW = [0, PI / 4, PI / 2, -PI / 4, -PI / 2];
const SIDE_OF = [0, 1, 2, 1, 0, 3, 4, 3];
const FLIP_OF = [false, false, false, true, true, true, false, false];

/**
 * Игровой угол → сторона рисунка. Мир — вид сверху 1:1, рисунок — земля
 * сжата до `SE`: курс поправлен, чтобы морда на экране смотрела туда же.
 */
function side8(a: number): { d: number; flip: boolean } {
  const y = Math.atan2(Math.sin(a), SE * Math.cos(a));
  const b = mod(Math.round(y / (PI / 4)), 8);
  return { d: SIDE_OF[b], flip: FLIP_OF[b] };
}

/** Точка тела на кадре: f — вперёд (к морде), s — вправо от морды, z — вверх. */
function prj(yaw: number, f: number, s: number, z: number): [number, number, number] {
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  const gy = f * n + s * c;
  return [f * c - s * n, gy * SE - z, gy];
}

interface Vis {
  now: number;
  x: number;
  y: number;
  /** Пройденный путь, клетки. */
  dist: number;
  /** Курс рисунка (игровой угол, с пределом поворота). */
  yaw: number;
  flash: number;
  /** Когда ударил герой (время рендера). */
  hitAt: number;
  mode: string;
  prev: string;
}
const VIS = new WeakMap<Mob, Vis>();

const spd = (m: Mob) => Math.hypot(m.vx ?? 0, m.vy ?? 0);
/** Курс по ходу: идёт — по скорости, стоит — куда смотрит. */
const headOf = (m: Mob, thr = 0.4) =>
  spd(m) > thr ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);

/**
 * Ход моба для рисунка. Лист кадров (`anim-sheet.mjs`) рисует каждый кадр
 * новым мобом: путь тогда — скорость × время режима, а удар — с начала ряда.
 */
function visOf(m: Mob, pose: MobPose, want: number, turn = 11): Vis {
  let v = VIS.get(m);
  const fl = m.flash ?? 0;
  if (!v) {
    const knocked = fl > 0 || Math.hypot(m.kx ?? 0, m.ky ?? 0) > 0.3;
    v = {
      now: pose.now,
      x: m.x ?? 0,
      y: m.y ?? 0,
      dist: spd(m) * pose.t,
      yaw: want,
      flash: fl,
      hitAt: knocked ? 0 : -9,
      mode: pose.mode,
      prev: '',
    };
    VIS.set(m, v);
    return v;
  }
  const dt = clamp(pose.now - v.now, 0, 0.1);
  if (dt > 0) {
    v.dist += Math.min(Math.hypot((m.x ?? 0) - v.x, (m.y ?? 0) - v.y), 1);
    v.x = m.x ?? 0;
    v.y = m.y ?? 0;
    v.now = pose.now;
    const mx = turn * dt;
    v.yaw += clamp(angD(want, v.yaw), -mx, mx);
  }
  if (fl > v.flash + 0.02) v.hitAt = pose.now;
  v.flash = fl;
  if (pose.mode !== v.mode) {
    v.prev = v.mode;
    v.mode = pose.mode;
  }
  return v;
}

const HURT_T = 0.21;
const HURT_OFF = [2.2, 1.8, 0.9, -0.4, 0];
const HURT_SQ = [0.16, 0.08, -0.05, 0.02, 0];
const HURT_ROT = [0.16, 0.12, 0.04, -0.03, 0];

/**
 * Реакция на удар героя: корпус отброшен по отдаче (`kx/ky` — от героя),
 * вжат, возвращается с лёгким перелётом — 5 кадров 24 к/с полями движка.
 * `f` — кадр реакции (0…4), `wince` — первые три: лицо «ойкает».
 */
function hurtOf(
  m: Mob,
  pose: MobPose,
  v: Vis,
  k = 1,
): { f: number; wince: boolean; ex: Partial<MobFrame> } | null {
  const ht = pose.now - v.hitAt;
  if (ht < 0 || ht >= HURT_T) return null;
  const f = Math.min(4, Math.floor(ht * FPS));
  let ux = m.kx ?? 0;
  let uy = m.ky ?? 0;
  let l = Math.hypot(ux, uy);
  if (l < 0.05) {
    ux = -Math.cos(m.face ?? 0);
    uy = -Math.sin(m.face ?? 0);
    l = 1;
  }
  ux /= l;
  uy /= l;
  const off = HURT_OFF[f] * k;
  const sq = HURT_SQ[f] * k;
  return {
    f,
    wince: f < 3,
    ex: {
      dx: ux * off,
      dy: uy * off * 0.6,
      sx: 1 + sq * 0.8,
      sy: 1 - sq,
      rot: ux * HURT_ROT[f] * k,
    },
  };
}

/** Сложить поля движка: сдвиги — суммой, сжатие — произведением, зеркало — знаком `sx`. */
function merge(
  flip: boolean,
  ...parts: (Partial<MobFrame> | null | undefined)[]
): Partial<MobFrame> {
  const o: Partial<MobFrame> = {};
  let sx = 1;
  let sy = 1;
  let dx = 0;
  let dy = 0;
  let rot = 0;
  for (const p of parts) {
    if (!p) continue;
    dx += p.dx ?? 0;
    dy += p.dy ?? 0;
    sx *= p.sx ?? 1;
    sy *= p.sy ?? 1;
    rot += p.rot ?? 0;
    for (const k of ['still', 'shadow', 'lift', 'ghost', 'alpha', 'linger'] as const)
      if (p[k] !== undefined) (o as Record<string, unknown>)[k] = p[k];
  }
  if (flip) sx = -sx;
  if (dx) o.dx = dx;
  if (dy) o.dy = dy;
  if (sx !== 1) o.sx = sx;
  if (sy !== 1) o.sy = sy;
  if (rot) o.rot = rot;
  return o;
}

/** Фаза покоя: своя у каждого (от `m.id`) — стая не дышит в такт. */
const idlePh = (m: Mob, now: number, per: number) => mod(now / per + hash(m.id ?? 0, 7), 1);

/** Сжатие на контакте: `t` — с мига удара, `k` — сила, `d` — длительность. */
function squash(t: number, k: number, d = 0.14): Partial<MobFrame> | null {
  if (t < 0 || t >= d) return null;
  const q = 1 - t / d;
  const w = Math.cos((t / d) * PI * 1.5) * q;
  return { sx: 1 + k * 0.8 * w, sy: 1 - k * w };
}

// ---------------------------------------------------------------------------
// Кадр: облик, вспышка, кеш по виду.
// ---------------------------------------------------------------------------

interface Pic {
  p: Px;
  ax: number;
  ay: number;
  eye: [number, number] | null;
  lit?: Px | null;
}

/** Предел кадров на вид: ход и покой во всех сторонах + приёмы + смерть. */
const LRU: Record<string, FrameLRU<MobFrame>> = {
  shr: frameLRU<MobFrame>(720),
  spr: frameLRU<MobFrame>(520),
  slm: frameLRU<MobFrame>(380),
  mdr: frameLRU<MobFrame>(420),
  mim: frameLRU<MobFrame>(560),
  snp: frameLRU<MobFrame>(520),
  bug: frameLRU<MobFrame>(300),
};

/** Замер для стенда: сколько новых кадров мобов нарисовано и за сколько. */
export const F2_MOB_STAT = {
  n: 0,
  ms: 0,
  max: 0,
  maxKey: '',
  /** Последние 4000 замеров (мс) — p50/p90 считает стенд. */
  samples: [] as number[],
  by: {} as Record<string, number>,
  size: () => Object.values(LRU).reduce((a, l) => a + l.size, 0),
};

function finishPic(b: Pic, look: Look, flash: boolean): MobFrame {
  let p = b.p;
  let lit = b.lit ?? null;
  let { ax, ay, eye } = b;
  if (look === 'albino') p = p.tint(PALE, 0.55);
  if (look === 'elite') {
    const q2 = new Px(p.w + 2, p.h + 2);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) q2.set(x + 1, y + 1, p.get(x, y));
    q2.outline(GOLD);
    p = q2;
    if (lit) {
      const l2 = new Px(lit.w + 2, lit.h + 2);
      for (let y = 0; y < lit.h; y++)
        for (let x = 0; x < lit.w; x++) l2.set(x + 1, y + 1, lit.get(x, y));
      lit = l2;
    }
    ax += 1;
    ay += 1;
    if (eye) eye = [eye[0] + 1, eye[1] + 1];
  }
  if (flash) p = p.tint(WHITE, 0.85);
  return { img: p.canvas(), ax, ay, eye, lit: lit ? lit.canvas() : null };
}

/** Кадр из кеша вида: ключ — поза (кадр трека, сторона), вспышка, облик. */
function frame(
  kind: string,
  key: string,
  pose: { flash: boolean; look: Look },
  build: () => Pic,
  extra?: Partial<MobFrame> | null,
): MobFrame {
  const lru = LRU[kind];
  const k = `${key}|${pose.flash ? 1 : 0}${pose.look[0]}`;
  let fr = lru.get(k);
  if (!fr) {
    const t0 = performance.now();
    fr = lru.set(k, finishPic(build(), pose.look, pose.flash));
    const ms = performance.now() - t0;
    const st = F2_MOB_STAT;
    st.n++;
    st.ms += ms;
    if (st.samples.length >= 4000) st.samples.shift();
    st.samples.push(ms);
    if (ms > st.max) {
      st.max = ms;
      st.maxKey = `${kind}|${k}`;
    }
    const bk = `${kind}|${key.replace(/[\d.-]+/g, '')}`;
    st.by[bk] = (st.by[bk] ?? 0) + 1;
  }
  return extra ? { ...fr, ...extra } : fr;
}

/** Где герой (для тех, кто поворачивается к нему, не двигаясь): только чтение. */
function heroAng(m: Mob): number | null {
  const s = paintSim();
  if (!s || m.x === undefined) return null;
  const dx = s.hero.x - m.x;
  const dy = s.hero.y - m.y;
  return Math.hypot(dx, dy) < 12 ? Math.atan2(dy, dx) : null;
}

// ---------------------------------------------------------------------------
// Гриб-топотун. Ножка-тумба с лицом, шляпка в пятнах, две ступни.
// Топот (0,62 с): нога вверх и корпус назад → задержка на пике с дрожью →
// удар вниз со шлейфом; кадр контакта — первый кадр `recover` (мозг бьёт в
// конце замаха и тут же ставит `recover`): ступня в пол, тело вжато, шляпка
// догоняет и подпрыгивает. Удар героя выбивает чих спорами (`squish`).
// Смерть — раздувается и лопается облаком спор, шляпка разлетается кусками.
// ---------------------------------------------------------------------------

const SH_W = 30;
const SH_H = 34;
const SH_GY = 29;
const SH_CX = 15;
/** Замах топота и отдых — из мозга (`f2-brains.ts`: `def.windup`, recover 0,55). */
const STOMP_T = 0.62;
const STOMP_F = 15;
const STOMP_REC = 0.55;

type ShEyes = 'open' | 'shut' | 'x' | 'angry' | 'wide' | 'wince';
type ShMouth = 'frown' | 'open' | 'none' | 'grit' | 'o';

interface ShO {
  d: number;
  /** Тело: − тянется вверх, + приплюснуто (px). */
  bob: number;
  /** Верх тела вперёд по ходу (+) или назад (−), px. */
  lean: number;
  /** Шляпка: + ниже своего места, px. */
  capY: number;
  /** Шляпка вперёд (+) по ходу — инерция, px. */
  capF: number;
  capW: number;
  capH: number;
  /** Ступни [вперёд, вверх], px: правая и левая. */
  fR: [number, number];
  fL: [number, number];
  eyes: ShEyes;
  mouth: ShMouth;
  /** Чих спорами, 0 — нет, иначе 0…1 фаза. */
  puff: number;
}

const SH0: ShO = {
  d: 0,
  bob: 0,
  lean: 0,
  capY: 0,
  capF: 0,
  capW: 1,
  capH: 1,
  fR: [0.7, 0],
  fL: [-0.7, 0],
  eyes: 'open',
  mouth: 'frown',
  puff: 0,
};

/** Пятна шляпки в координатах тела: [доля радиуса, азимут от морды, размер]. */
const SH_SPOTS: [number, number, number][] = [
  [0.5, -2.3, 1.6],
  [0.66, 0.35, 1.35],
  [0.18, 1.6, 1.1],
  [0.86, 2.5, 1.0],
  [0.82, -0.95, 1.15],
  [0.7, 1.45, 1.0],
];

/** Глаза на ножке по стороне (смещение от середины ножки), рот — середина. */
const SH_FACE: { eyes: number[]; mouth: number | null }[] = [
  { eyes: [1, 3], mouth: 2 },
  { eyes: [-1, 2], mouth: 0.5 },
  { eyes: [-2, 2], mouth: 0 },
  { eyes: [3], mouth: null },
  { eyes: [], mouth: null },
];

function shEye(p: Px, x: number, y: number, e: ShEyes, outer: number): void {
  const c = SHR.eye;
  switch (e) {
    case 'open':
      p.rect(x, y, x, y + 1, c);
      break;
    case 'angry':
      p.rect(x, y, x, y + 1, c);
      p.set(x + outer, y - 1, c);
      break;
    case 'wide':
      p.rect(x, y - 1, x, y + 1, c);
      break;
    case 'shut':
      p.set(x, y + 1, c);
      break;
    case 'wince':
      p.set(x - outer, y, c);
      p.set(x, y + 1, c);
      break;
    case 'x':
      p.set(x - 1, y - 1, c);
      p.set(x + 1, y - 1, c);
      p.set(x, y, c);
      p.set(x - 1, y + 1, c);
      p.set(x + 1, y + 1, c);
      break;
  }
}

/** Гриб на холсте 30×34, точка ног — (15, 29). */
function shroomPic(o: ShO): Pic {
  const p = new Px(SH_W, SH_H);
  const yaw = SIDE_YAW[o.d];
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  const GY = SH_GY;
  const CX = SH_CX;
  // Ступни: дальняя — до ножки и темнее.
  const feet = (
    [
      [1, o.fR],
      [-1, o.fL],
    ] as [number, [number, number]][]
  )
    .map(([s, [f, z]]) => {
      const [x, y, dp] = prj(yaw, f, s * 2.6, z);
      return { x: CX + 0.5 + x, y: GY - 1 + y, dp };
    })
    .sort((a, b) => a.dp - b.dp);
  const frx = lerp(1.8, 2.4, Math.abs(c));
  const foot = (ft: { x: number; y: number }, far: boolean) => {
    p.ell(Math.round(ft.x * 2) / 2, Math.round(ft.y), frx, 1.45, far ? SHR.footD : SHR.foot);
    if (!far) p.set(Math.round(ft.x - 1), Math.round(ft.y - 1), SHR.stalk[2]);
  };
  foot(feet[0], true);
  // Ножка: низ стоит на земле, высота — от `bob`.
  const h = 10.6 - o.bob;
  const ry = h / 2;
  const rx = 4.4 * Math.sqrt(10.6 / h);
  const lean = Math.round(o.lean * 0.45);
  const scx = CX + 0.5 + Math.round(c * lean);
  const scy = GY - 0.6 - ry + Math.round(n * lean * SE);
  ball(p, { x: scx, y: scy, rx, ry }, SHR.stalk);
  foot(feet[1], false);
  // Лицо.
  const face = SH_FACE[o.d];
  const ex0 = Math.round(scx - 0.5);
  const ey = Math.round(scy - 1);
  let eye: [number, number] | null = null;
  face.eyes.forEach((dx, i) => {
    const outer = face.eyes.length > 1 ? (i ? 1 : -1) : 1;
    shEye(p, ex0 + dx, ey, o.eyes, outer);
    if (
      i === face.eyes.length - 1 &&
      (o.eyes === 'open' || o.eyes === 'angry' || o.eyes === 'wide')
    )
      eye = [ex0 + dx, ey];
  });
  if (face.mouth !== null) {
    const mx = Math.round(ex0 + face.mouth);
    const my = ey + 3;
    const mc = SHR.mouth;
    if (o.mouth === 'frown') {
      p.set(mx - 1, my + 1, mc);
      p.set(mx, my, mc);
      p.set(mx + 1, my + 1, mc);
    } else if (o.mouth === 'open') p.rect(mx - 1, my, mx + 1, my + 1, mc);
    else if (o.mouth === 'grit') {
      p.rect(mx - 1, my, mx + 1, my, mc);
      p.set(mx, my, SHR.stalk[3]);
    } else if (o.mouth === 'o') p.rect(mx, my, mx, my + 1, mc);
  }
  // Шляпка: купол со срезанным низом, под ним — пластинки.
  const cf = Math.round(o.lean + o.capF);
  const ccx = CX + 0.5 + Math.round(c * cf);
  const ccy = Math.round(scy - ry + 0.6 + o.capY + n * cf * SE);
  const crx = 9.2 * o.capW;
  const cry = 6.4 * o.capH;
  p.ell(ccx, ccy + 1.6, crx - 0.8, 2.1, SHR.gill);
  for (let x = Math.round(ccx - crx + 2); x <= Math.round(ccx + crx - 2); x += 2)
    p.set(x, ccy + 2, SHR.gillD);
  const cap: Ell = { x: ccx, y: ccy, rx: crx, ry: cry };
  ball(p, cap, SHR.cap, (_x, y) => y <= ccy + 1);
  for (let x = Math.round(ccx - crx + 1); x <= Math.round(ccx + crx - 1); x++)
    if (p.solid(x, ccy + 1)) p.set(x, ccy + 1, SHR.cap[1]);
  // Пятна поворачиваются вместе с телом.
  for (const [r, a, sz] of SH_SPOTS) {
    const th = a + yaw;
    const sx = ccx + crx * 0.88 * r * Math.cos(th);
    const sy = ccy - cry * 0.42 * (1 - r * r) + cry * 0.5 * r * Math.sin(th);
    if (sy > ccy - 0.2 || !inE(cap, Math.round(sx), Math.round(sy))) continue;
    p.ell(sx, sy, sz, sz * 0.8, SHR.spot);
    p.set(Math.round(sx + sz * 0.5), Math.round(sy + sz * 0.5), SHR.spotD);
  }
  p.outline(INK);
  if (eye) p.set(eye[0], eye[1], SHR.eyeHi);
  let lit: Px | null = null;
  if (o.puff > 0) {
    // Чих: облачко спор вырывается из-под шляпки и поднимается.
    lit = new Px(SH_W, SH_H);
    const k = o.puff;
    for (let i = 0; i < 9; i++) {
      const a = -PI / 2 + (i - 4) * 0.36 + hash(i, 3) * 0.2;
      const r = 3 + k * (6 + hash(i, 5) * 4);
      const x = ccx + Math.cos(a) * r * 1.2;
      const y = ccy - cry * 0.6 + Math.sin(a) * r * 0.8 - k * 3;
      const al = (1 - k) * (0.9 - (i % 3) * 0.15);
      if (al <= 0.05) continue;
      p.set(Math.round(x), Math.round(y), alpha(i % 2 ? SHR.spore : ACID, al));
      lit.set(Math.round(x), Math.round(y), alpha(ACID_L, al * 0.8));
    }
    glowAt(lit, ccx, ccy - cry * 0.7 - k * 3, 4 + k * 4, ACID, 0.35 * (1 - k));
  }
  return { p, ax: SH_CX, ay: GY, eye, lit };
}

/** Покой: ножка дышит, шляпка отстаёт на кадр; моргнуть — раз в несколько вдохов. */
function shIdle(d: number, i: number, blink: boolean): ShO {
  const b = Math.round(Math.sin((i / 8) * TAU) * 0.7);
  const cy = Math.round(Math.sin(((i - 1.3) / 8) * TAU) * 0.9) - b;
  return { ...SH0, d, bob: b, capY: cy, eyes: blink && (i === 5 || i === 6) ? 'shut' : 'open' };
}

/** Шаг: 8 кадров на два шага, ступни по пути, тело подпрыгивает, шляпка — с запаздыванием. */
function shWalk(d: number, i: number): ShO {
  const ph = i / 8;
  const leg = (q: number): [number, number] => [
    -Math.cos(q * TAU) * 2.1,
    Math.round(Math.max(0, Math.sin(q * TAU)) * 2.4),
  ];
  const up = Math.abs(Math.sin(ph * TAU));
  const upLag = Math.abs(Math.sin((ph - 0.14) * TAU));
  return {
    ...SH0,
    d,
    bob: -Math.round(up),
    capY: Math.round(-upLag * 1.4 + up),
    lean: 1.6,
    capF: -0.6,
    fR: leg(ph),
    fL: leg(ph + 0.5),
  };
}

/**
 * Топот: 0–0,3 нога вверх, корпус назад, шляпка поднимается (подготовка);
 * 0,3–0,5 задержка на пике (шляпка дрожит); 0,5–0,62 нога вниз со шлейфом.
 */
function shStomp(d: number, f: number): ShO {
  const t = (f + 0.5) / FPS;
  const up = eOut(seg(t, 0, 0.3));
  const slam = eIn(seg(t, 0.5, STOMP_T));
  const lift = up * (1 - slam);
  const quiver = t > 0.3 && t < 0.5 ? (f % 2 ? 0.5 : -0.5) : 0;
  return {
    ...SH0,
    d,
    bob: -2 * lift + 1.2 * slam,
    lean: -2.2 * lift + 2.6 * slam,
    capY: -2.2 * lift + quiver + slam * -1.5,
    capF: -0.8 * lift + quiver - 1.6 * slam,
    capH: 1 + 0.06 * lift,
    fR: [lerp(0.7, 2.6, lift) + slam * 1.6, Math.round(6.5 * lift)],
    fL: [-0.9, 0],
    eyes: 'angry',
    mouth: t < 0.22 ? 'frown' : 'grit',
  };
}

/** После топота: контакт (вжат, шляпка бьёт вниз и подскакивает), проводка, возврат. */
function shRecover(d: number, f: number): ShO {
  const t = f / FPS;
  const cap = wob(t / 0.45, 1.6);
  const back = eIO(seg(t, 0.12, 0.5));
  return {
    ...SH0,
    d,
    bob: lerp(1.5, 0, eOut(seg(t, 0, 0.2))),
    lean: lerp(1.2, 0, back),
    capY: Math.round(0.9 * cap),
    capF: lerp(-0.4, 0, back),
    capW: 1 + 0.1 * Math.max(0, cap),
    capH: 1 - 0.08 * Math.max(0, cap),
    fR: [lerp(4.2, 0.7, back), 0],
    fL: [-0.9, 0],
    eyes: t < 0.3 ? 'angry' : 'open',
    mouth: t < 0.1 ? 'open' : t < 0.3 ? 'grit' : 'frown',
  };
}

/** Чих спорами от удара (0,35 с): шляпку сжало — и выдох облаком. */
function shPuff(d: number, f: number): ShO {
  const k = (f + 0.5) / 8;
  const sq = Math.sin(clamp01(k * 1.6) * PI);
  return {
    ...SH0,
    d,
    bob: Math.round(sq * 1.2),
    capY: Math.round(sq * 1.5),
    capW: 1 + 0.1 * sq,
    capH: 1 - 0.14 * sq,
    eyes: k < 0.5 ? 'wince' : 'open',
    mouth: 'o',
    puff: k,
  };
}

/** Смерть 0,9 с: раздулся (0–0,12) → лопнул (0,125) → куски шляпки летят и падают → лежит. */
const SH_DIE = 0.9;
const SH_DIE_F = 21;
const SH_SHARDS: { vx: number; vy: number; a: number; w: number }[] = [
  { vx: -42, vy: -70, a: -2.4, w: 4.4 },
  { vx: 38, vy: -82, a: 0.5, w: 4.0 },
  { vx: 6, vy: -105, a: 1.6, w: 3.4 },
  { vx: -16, vy: -48, a: 2.6, w: 2.8 },
];

function shroomDeathPic(d: number, f: number): Pic {
  if (f < 3) {
    // Раздувается: шляпка пухнет, ножка тянется, глаза крестом.
    const k = (f + 1) / 3;
    const pic = shroomPic({
      ...SH0,
      d,
      bob: -1.6 * k,
      capY: -1.2 * k,
      capW: 1 + 0.18 * k,
      capH: 1 + 0.2 * k,
      eyes: 'x',
      mouth: 'o',
    });
    pic.eye = null;
    return pic;
  }
  const p = new Px(SH_W + 16, SH_H + 6);
  const lit = new Px(p.w, p.h);
  const CX = SH_CX + 8;
  const GY = SH_GY + 4;
  const t = (f - 3) / FPS;
  // Ножка: оседает и заваливается набок.
  const fall = eIO(seg(t, 0.05, 0.35));
  const st: Ell = {
    x: CX + 0.5 + fall * 2,
    y: GY - 0.6 - lerp(4.6, 2.2, fall),
    rx: lerp(4.6, 5.6, fall),
    ry: lerp(4.6, 2.2, fall),
  };
  ball(p, st, SHR.stalk);
  p.ell(CX - 2.5, GY - 1, 2.2, 1.3, SHR.footD);
  p.ell(CX + 3, GY - 1, 2.2, 1.3, SHR.foot);
  // Куски шляпки: летят дугой и ложатся на пол.
  const g = 260;
  for (const sh of SH_SHARDS) {
    const tl = Math.min(t, 0.62);
    let x = CX + 0.5 + sh.vx * tl * 0.6;
    let y = GY - 12 + sh.vy * tl + 0.5 * g * tl * tl;
    const land = y >= GY - 2;
    if (land) y = GY - 2;
    x = Math.round(x);
    y = Math.round(y);
    const e: Ell = { x, y, rx: sh.w, ry: sh.w * 0.62 };
    ball(p, e, SHR.cap, (_x, yy) => yy <= y + (land ? 1 : 0));
    p.set(Math.round(x + Math.cos(sh.a) * sh.w * 0.3), Math.round(y - 1), SHR.spot);
    if (land) p.rect(Math.round(x - sh.w + 1), y + 1, Math.round(x + sh.w - 1), y + 1, SHR.gill);
  }
  p.outline(INK);
  // Облако спор: вспышка лопнувшей шляпки, расходится и тает.
  const k = clamp01(t / 0.55);
  if (k < 1) {
    glowAt(lit, CX + 0.5, GY - 13 - k * 4, 7 + k * 8, ACID, 0.75 * (1 - k));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU + hash(i, 11) * 0.5;
      const r = 3 + eOut(k) * (9 + hash(i, 13) * 7);
      const x = CX + 0.5 + Math.cos(a) * r;
      const y = GY - 13 + Math.sin(a) * r * 0.7 - k * 4;
      const al = (1 - k) * (i % 3 ? 0.8 : 1);
      p.set(Math.round(x), Math.round(y), alpha(i % 2 ? SHR.spore : ACID, al * 0.85));
      lit.set(Math.round(x), Math.round(y), alpha(ACID_L, al));
    }
  }
  return { p, ax: CX, ay: GY, eye: null, lit };
}

/** Режим гриба → ключ кадра, поза и поля движка. */
function shroomFrame(m: Mob, pose: MobPose): MobFrame {
  const md = pose.mode;
  const t = pose.t;
  const tech = md === 'stomp' || md === 'windup';
  const v = visOf(m, pose, tech || md === 'recover' ? (m.face ?? 0) : headOf(m), 11);
  const { d, flip } = side8(v.yaw);
  if (md === 'dying') {
    const f = fi(t, SH_DIE_F);
    const key = f < 3 ? `die${f}d${d}` : `die${f}`;
    return frame('shr', key, pose, () => shroomDeathPic(d, f), {
      ...merge(flip && f < 3, squash(t - 0.125, -0.12, 0.12)),
      linger: SH_DIE,
      alpha: 1 - seg(t, 0.68, SH_DIE),
      shadow: f < 4 ? 7 : 0,
      still: true,
    });
  }
  const hurt = hurtOf(m, pose, v);
  if (tech) {
    // Эхо 15-го зовёт гриба с `windup` до 0,7 с — поза держит последний кадр.
    const f = fi(t, STOMP_F - 1);
    const ghost =
      f >= STOMP_F - 2 ? { every: 0.03, life: 0.14, tint: '255,236,200', alpha: 0.3 } : null;
    return frame('shr', `st${f}d${d}`, pose, () => shroomPic(shStomp(d, f)), {
      ...merge(flip, hurt?.ex),
      still: true,
      shadow: 7,
      ghost,
    });
  }
  if (md === 'recover') {
    const f = fi(t, Math.round(STOMP_REC * FPS));
    return frame('shr', `rc${f}d${d}`, pose, () => shroomPic(shRecover(d, f)), {
      ...merge(flip, squash(t, 0.1, 0.16), hurt?.ex),
      still: t < 0.2,
      shadow: 7,
    });
  }
  if (md === 'sleep') {
    const i = Math.floor(idlePh(m, pose.now, 3.2) * 4);
    const b = [1, 2, 2, 1][i];
    return frame(
      'shr',
      `sl${i}d${d}`,
      pose,
      () => shroomPic({ ...SH0, d, bob: b, capY: b - 1, eyes: 'shut', mouth: 'none' }),
      { ...merge(flip), shadow: 7 },
    );
  }
  if (md === 'alert') {
    // Проснулся: подскок, глаза круглые, шляпка подпрыгивает с запаздыванием.
    const f = fi(t, 8);
    const k = f / 8;
    const o: ShO = {
      ...SH0,
      d,
      bob: Math.round(-2 * Math.sin(seg(k, 0, 0.6) * PI)),
      capY: Math.round(-2.4 * wob(k * 1.2, 1)),
      eyes: 'wide',
      mouth: 'o',
    };
    return frame('shr', `al${f}d${d}`, pose, () => shroomPic(o), { ...merge(flip), shadow: 7 });
  }
  if (md === 'drop') {
    // Падает со свода: ступни болтаются, шляпку задрало.
    const o: ShO = {
      ...SH0,
      d,
      bob: -1,
      capY: -2,
      capH: 1.08,
      fR: [1, 2],
      fL: [-1, 1],
      eyes: 'wide',
      mouth: 'o',
    };
    return frame('shr', `dr${d}`, pose, () => shroomPic(o), { ...merge(flip), shadow: 0 });
  }
  if (md === 'stun') {
    // Сбит: «ойкнул», шляпка качается; после падения — ещё и вжат в пол.
    const f = fi(t, 5);
    const o: ShO = {
      ...SH0,
      d,
      bob: 1,
      capY: Math.round(1.5 * wob((f + 1) / 6, 1)),
      capF: -1,
      eyes: 'wince',
      mouth: 'open',
    };
    const land = v.prev === 'drop' ? squash(t, 0.2, 0.2) : null;
    return frame('shr', `sn${f}d${d}`, pose, () => shroomPic(o), {
      ...merge(flip, land, hurt?.ex),
      shadow: 7,
    });
  }
  const squish = m.data?.squish ?? 0;
  if (squish > 0) {
    const f = Math.min(7, Math.floor((1 - squish / 0.35) * 8));
    return frame('shr', `pf${f}d${d}`, pose, () => shroomPic(shPuff(d, f)), {
      ...merge(flip, hurt?.ex),
      shadow: 7,
    });
  }
  if (hurt?.wince) {
    const o: ShO = { ...SH0, d, bob: 1, capY: 1, capF: -1, eyes: 'wince', mouth: 'open' };
    return frame('shr', `hu${d}`, pose, () => shroomPic(o), { ...merge(flip, hurt.ex), shadow: 7 });
  }
  const sp = spd(m);
  if (sp > 0.4) {
    // Шаг по пройденному пути: 2 шага на 1,1 клетки.
    const i = Math.floor(mod((v.dist / 1.1) * 8, 8));
    return frame('shr', `w${i}d${d}`, pose, () => shroomPic(shWalk(d, i)), {
      ...merge(flip, hurt?.ex),
      shadow: 7,
    });
  }
  const ph = idlePh(m, pose.now, 1.7);
  const i = Math.floor(ph * 8);
  const blink = hash(m.id ?? 0, Math.floor(pose.now / 1.7 + hash(m.id ?? 0, 7))) < 0.35;
  return frame('shr', `i${i}${blink ? 'b' : ''}d${d}`, pose, () => shroomPic(shIdle(d, i, blink)), {
    ...merge(flip, hurt?.ex),
    shadow: 7,
  });
}

registerMobPainter('f2_shroom', shroomFrame);

registerMobWarm('f2_shroom', function* () {
  const P = { flash: false, look: 'normal' as Look };
  for (let d = 0; d < 5; d++) {
    for (let i = 0; i < 8; i++) {
      frame('shr', `i${i}d${d}`, P, () => shroomPic(shIdle(d, i, false)));
      yield 0;
      frame('shr', `w${i}d${d}`, P, () => shroomPic(shWalk(d, i)));
      yield 0;
    }
  }
  for (let d = 0; d < 5; d++) {
    for (let f = 0; f < STOMP_F; f++) {
      frame('shr', `st${f}d${d}`, P, () => shroomPic(shStomp(d, f)));
      yield 0;
    }
    for (let f = 0; f <= Math.round(STOMP_REC * FPS); f++) {
      frame('shr', `rc${f}d${d}`, P, () => shroomPic(shRecover(d, f)));
      yield 0;
    }
  }
  for (let d = 0; d < 5; d++)
    for (let f = 0; f < 3; f++) {
      frame('shr', `die${f}d${d}`, P, () => shroomDeathPic(d, f));
      yield 0;
    }
  for (let f = 3; f <= SH_DIE_F; f++) {
    frame('shr', `die${f}`, P, () => shroomDeathPic(0, f));
    yield 0;
  }
});

// ---------------------------------------------------------------------------
// Грибёнок. Кругленький, светится пятнами шляпки, бежит вприпрыжку стайкой.
// Укус-боднуть (0,3 с): присел и откинулся (0–0,17) → дрожит на пружине
// (0,17–0,25) → бросок вперёд (0,25–0,3); кадр контакта — первый кадр
// `recover` (мозг бьёт в конце замаха и толкает вперёд): шляпка бьёт
// вниз-вперёд, искра света; дальше отскок и шаг назад по пути.
// Из грибницы вылезает сценой: шляпка пробивает землю, комья, прыжок.
// Смерть — гаснет и сдувается, споры уходят светом вверх.
// ---------------------------------------------------------------------------

const SP_W = 24;
const SP_H = 26;
const SP_GY = 21;
const SP_CX = 12;
/** Замах и отдых — из мозга `melee` (`def.windup` 0,3, recover 0,35). */
const BITE_T = 0.3;
const BITE_F = 7;
const BITE_REC = 0.35;
const SP_EMERGE = 0.45;
const SP_DIE = 0.6;
const SP_DIE_F = 14;

type SpEyes = 'open' | 'shut' | 'wince' | 'wide' | 'x' | 'angry';

interface SpO {
  d: number;
  /** Тело: + приплюснуто, − вытянуто (px). */
  bob: number;
  /** Верх тела вперёд по ходу, px. */
  lean: number;
  /** Шляпка: + ниже своего места, px. */
  capY: number;
  /** Шляпка вперёд по ходу (инерция), px. */
  capF: number;
  capW: number;
  capH: number;
  /** Ступни [вперёд, вверх]: правая, левая. */
  fR: [number, number];
  fL: [number, number];
  eyes: SpEyes;
  /** Свечение пятен 0…1. */
  glow: number;
  /** Сколько пикселей ещё под землёй (вылезает из грибницы). */
  sink: number;
}

const SP0: SpO = {
  d: 0,
  bob: 0,
  lean: 0,
  capY: 0,
  capF: 0,
  capW: 1,
  capH: 1,
  fR: [0.6, 0],
  fL: [-0.6, 0],
  eyes: 'open',
  glow: 0.6,
  sink: 0,
};

/** Пятна шляпки: [азимут от морды, доля радиуса, крупное]. */
const SP_SPOTS: [number, number, boolean][] = [
  [-2.5, 0.58, true],
  [0.45, 0.62, true],
  [2.1, 0.5, false],
  [3.05, 0.22, false],
  [-1.1, 0.25, false],
];

function sproutPic(o: SpO, lit: Px | null = null): Pic {
  const p = new Px(SP_W, SP_H);
  const yaw = SIDE_YAW[o.d];
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  const GY = SP_GY + o.sink;
  const CX = SP_CX;
  const feet = (
    [
      [1, o.fR],
      [-1, o.fL],
    ] as [number, [number, number]][]
  )
    .map(([s, [f, z]]) => {
      const [x, y, dp] = prj(yaw, f, s * 1.6, z);
      return { x: CX + 0.5 + x, y: GY - 0.5 + y, dp };
    })
    .sort((a, b) => a.dp - b.dp);
  const foot = (ft: { x: number; y: number }, far: boolean) =>
    p.rect(
      Math.round(ft.x - 1),
      Math.round(ft.y),
      Math.round(ft.x),
      Math.round(ft.y),
      far ? SPR.stalk[0] : SPR.stalk[1],
    );
  foot(feet[0], true);
  // Тельце: низ стоит на земле, высота — от `bob`.
  const h = 5.4 - o.bob;
  const ry = h / 2;
  const rx = 2.8 * Math.sqrt(5.4 / Math.max(2.6, h));
  const lean = Math.round(o.lean * 0.5);
  const scx = CX + 0.5 + Math.round(c * lean);
  const scy = GY - 0.8 - ry + Math.round(n * lean * SE);
  ball(p, { x: scx, y: scy, rx, ry }, SPR.stalk);
  foot(feet[1], false);
  // Глаза-бусинки: точки тельца на азимуте морда ± 0,5, видны, если смотрят к нам.
  let eye: [number, number] | null = null;
  const ey = Math.round(scy - 0.7);
  for (const da of [-0.5, 0.5]) {
    const a = yaw + da;
    if (Math.sin(a) < -0.3) continue;
    const x = Math.round(scx - 0.5 + Math.cos(a) * (rx - 0.6));
    const e = o.eyes;
    const col = SPR.eye;
    if (e === 'open' || e === 'angry') p.rect(x, ey, x, ey + 1, col);
    else if (e === 'wide') p.rect(x, ey - 1, x, ey + 1, col);
    else if (e === 'shut') p.set(x, ey + 1, col);
    else if (e === 'wince') {
      p.set(x, ey, col);
      p.set(x + (da < 0 ? -1 : 1), ey + 1, col);
    } else if (e === 'x') {
      p.set(x - 1, ey, col);
      p.set(x, ey + 1, col);
      p.set(x - 1, ey + 2, col);
      p.set(x + 1, ey, col);
      p.set(x + 1, ey + 2, col);
    }
    if (e === 'angry') p.set(x + (da < 0 ? -1 : 1), ey - 1, col);
    if (e === 'open' || e === 'angry' || e === 'wide') eye = [x, ey];
  }
  // Шляпка: купол со срезанным низом, под ним — тёмная кайма.
  const cf = o.lean + o.capF;
  const ccx = CX + 0.5 + Math.round(c * cf);
  const ccy = Math.round(scy - ry - 0.6 + o.capY + n * cf * SE);
  const crx = 5.2 * o.capW;
  const cry = 4 * o.capH;
  p.ell(ccx, ccy + 1, crx - 0.9, 1.3, SPR.cap[0]);
  const cap: Ell = { x: ccx, y: ccy, rx: crx, ry: cry };
  ball(p, cap, SPR.cap, (_x, y) => y <= ccy + 1);
  // Пятна в координатах шляпки — поворачиваются вместе с ней.
  const g = mix(SPR.cap[3], SPR.glow, clamp01(o.glow));
  for (const [az, r, big] of SP_SPOTS) {
    const a = yaw + az;
    const x = Math.round(ccx - 0.5 + Math.cos(a) * r * crx * 0.85);
    const y = Math.round(ccy - cry * 0.42 + Math.sin(a) * r * cry * 0.5);
    if (!inE(cap, x, y) || y > ccy) continue;
    p.set(x, y, g);
    if (big) p.set(x + 1, y, g);
    if (lit && o.glow > 0.7) lit.set(x, y, alpha(SPR.glow, (o.glow - 0.6) * 1.6));
  }
  p.outline(INK);
  if (o.sink > 0) {
    // Ниже земли — пусто: тело ещё в грибнице.
    for (let y = SP_GY + 1; y < SP_H; y++)
      for (let x = 0; x < SP_W; x++) p.data[(y * SP_W + x) * 4 + 3] = 0;
    if (eye && eye[1] > SP_GY) eye = null;
  }
  return { p, ax: SP_CX, ay: SP_GY, eye, lit };
}

/** Покой: тельце дышит, шляпка отстаёт, пятна мерцают. */
function spIdle(d: number, i: number, blink: boolean): SpO {
  const b = Math.round(Math.sin((i / 8) * TAU) * 0.6);
  const cy = Math.round(Math.sin(((i - 1.4) / 8) * TAU) * 0.8) - b;
  return {
    ...SP0,
    d,
    bob: b,
    capY: cy,
    glow: 0.5 + 0.3 * Math.sin((i / 8) * TAU + 1),
    eyes: blink && (i === 4 || i === 5) ? 'shut' : 'open',
  };
}

/** Бег вприпрыжку: 6 кадров на два скока (1 клетка пути). */
function spWalk(d: number, i: number, back = false): SpO {
  const ph = i / 6;
  const up = Math.abs(Math.sin(ph * TAU));
  const lag = Math.abs(Math.sin((ph - 0.17) * TAU));
  const leg = (q: number): [number, number] => [
    -Math.cos(q * TAU) * 1.4 * (back ? -1 : 1),
    Math.round(Math.max(0, Math.sin(q * TAU)) * 1.6),
  ];
  return {
    ...SP0,
    d,
    bob: -Math.round(up * 1.4),
    capY: Math.round(-lag * 1.6 + up * 1.4),
    lean: back ? -0.8 : 1.4,
    capF: back ? 0.4 : -0.5,
    fR: leg(ph),
    fL: leg(ph + 0.5),
    glow: 0.65,
  };
}

/** Замах (0,3 с): присел-откинулся → дрожь на пружине → бросок вперёд. */
function spBite(d: number, f: number): SpO {
  const t = (f + 0.5) / FPS;
  const crouch = eOut(seg(t, 0, 0.17));
  const go = eIn(seg(t, 0.25, BITE_T));
  const quiver = t > 0.17 && t < 0.25 ? (f % 2 ? 0.5 : -0.5) : 0;
  return {
    ...SP0,
    d,
    bob: 1.6 * crouch * (1 - go) - 1.4 * go,
    lean: -1.6 * crouch * (1 - go) + 2.6 * go,
    capY: Math.round(0.6 * crouch * (1 - go) - 0.8 * go) + quiver,
    capF: -0.8 * crouch * (1 - go) + quiver - 0.6 * go,
    capW: 1 + 0.06 * crouch * (1 - go),
    capH: 1 - 0.06 * crouch * (1 - go) + 0.05 * go,
    fR: [lerp(0.6, -0.4, crouch) - 1.4 * go, 0],
    fL: [lerp(-0.6, -1.2, crouch) - 1.2 * go, 0],
    eyes: 'angry',
    glow: 0.6 + 0.4 * crouch,
  };
}

/** После укуса: контакт (шляпка бьёт вниз-вперёд) → отскок → назад. */
function spRecover(d: number, f: number): SpO {
  const t = f / FPS;
  const back = eIO(seg(t, 0.06, 0.3));
  const cap = wob(t / 0.3, 1.4);
  return {
    ...SP0,
    d,
    bob: lerp(1, 0, eOut(seg(t, 0, 0.12))),
    lean: lerp(2.6, -0.5, back),
    capY: Math.round(1.6 * cap),
    capF: lerp(0.8, 0, back),
    capW: 1 + 0.12 * Math.max(0, cap),
    capH: 1 - 0.1 * Math.max(0, cap),
    fR: [lerp(1.4, 0.6, back), 0],
    fL: [lerp(-0.4, -0.6, back), 0],
    eyes: t < 0.15 ? 'angry' : 'open',
    glow: lerp(1, 0.6, seg(t, 0, 0.2)),
  };
}

/** Искра контакта: свет у края шляпки по ходу. */
function spSpark(pic: Pic, d: number, f: number): Pic {
  const lit = pic.lit ?? new Px(SP_W, SP_H);
  const yaw = SIDE_YAW[d];
  const k = f / 3;
  const x = SP_CX + 0.5 + Math.cos(yaw) * 6.5;
  const y = SP_GY - 6 + Math.sin(yaw) * 6.5 * SE;
  glowAt(lit, x, y, 3 + k * 3, SPR.glow, 0.9 * (1 - k));
  for (let i = 0; i < 5; i++) {
    const a = yaw + (i - 2) * 0.55;
    const r = 2.5 + k * 4;
    lit.set(
      Math.round(x + Math.cos(a) * r),
      Math.round(y + Math.sin(a) * r * 0.7),
      alpha(WHITE, 1 - k),
    );
  }
  pic.lit = lit;
  return pic;
}

/** Вылезает из грибницы (0,45 с): шляпка пробивает землю → прыжок → встряхнулся. */
function spEmerge(d: number, f: number): Pic {
  const t = (f + 0.5) / FPS;
  const out = eOut(seg(t, 0.04, 0.26));
  const hop = Math.sin(seg(t, 0.2, 0.34) * PI);
  const land = seg(t, 0.32, 0.45);
  const shake = land > 0 ? wob(land, 1.5) : 0;
  const o: SpO = {
    ...SP0,
    d,
    sink: Math.round(lerp(11, 0, out)),
    bob: -1.4 * hop + (land > 0 && land < 0.4 ? 1.2 : 0),
    capY: Math.round(1.6 * hop - shake * 1.2),
    capF: shake * 2,
    eyes: t < 0.2 ? 'shut' : 'wide',
    glow: 1,
    fR: [0.6, Math.round(hop * 1.5)],
    fL: [-0.6, Math.round(hop * 1.5)],
  };
  const lit = new Px(SP_W, SP_H);
  const pic = sproutPic(o, lit);
  const p = pic.p;
  // Холмик и комья земли грибницы.
  const k = seg(t, 0, 0.4);
  const mound = Math.round(lerp(3, 1, k));
  for (let x = -6; x <= 6; x++) {
    const hh = Math.round(mound * (1 - (x / 6.5) ** 2));
    for (let y = 0; y < hh; y++) p.set(SP_CX + x, SP_GY - y, y === hh - 1 ? MDR.soilL : MDR.soil);
  }
  for (let i = 0; i < 6; i++) {
    const a = PI + (i / 5) * PI + hash(i, 3) * 0.3;
    const v = 16 + hash(i, 5) * 10;
    const tt = clamp(t - 0.03, 0, 0.42);
    const x = SP_CX + 0.5 + Math.cos(a) * v * tt * 1.4;
    const y = SP_GY - 2 + Math.sin(a) * v * tt + 90 * tt * tt;
    if (y <= SP_GY + 1)
      p.set(Math.round(x), Math.round(Math.min(y, SP_GY)), i % 2 ? MDR.soilL : MDR.soil);
  }
  // Свет грибницы: тает к концу.
  glowAt(lit, SP_CX + 0.5, SP_GY - 1, 7, SPR.glow, 0.55 * (1 - k));
  return pic;
}

/** Смерть 0,6 с: дёрнулся → гаснет и сдувается → лежит шляпкой, споры уходят светом. */
function sproutDeathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / FPS;
  const jerk = seg(t, 0, 0.12);
  const sag = eIO(seg(t, 0.1, 0.4));
  const o: SpO = {
    ...SP0,
    d,
    bob: -1.2 * Math.sin(jerk * PI) + 3.2 * sag,
    capY: Math.round(-1.4 * Math.sin(jerk * PI) + 2.2 * sag),
    capW: 1 + 0.28 * sag,
    capH: 1 - 0.42 * sag,
    capF: -0.6 * sag,
    eyes: 'x',
    glow: 1 - seg(t, 0.08, 0.4),
    fR: [0.6 + sag * 0.8, 0],
    fL: [-0.6 - sag * 0.8, 0],
  };
  const lit = new Px(SP_W, SP_H);
  const pic = sproutPic(o, lit);
  pic.eye = null;
  // Споры уходят вверх, свет тает.
  const k = seg(t, 0.12, SP_DIE);
  if (k > 0 && k < 1)
    for (let i = 0; i < 7; i++) {
      const x = SP_CX + 0.5 + (hash(i, 21) - 0.5) * 9 + Math.sin(k * 5 + i) * 1.2;
      const y = SP_GY - 7 - k * (8 + hash(i, 23) * 6);
      const al = (1 - k) * (0.6 + 0.4 * hash(i, 25));
      pic.p.set(Math.round(x), Math.round(y), alpha(SPR.cap[3], al));
      lit.set(Math.round(x), Math.round(y), alpha(SPR.glow, al));
    }
  return pic;
}

/** Режим грибёнка → кадр. */
function sproutFrame(m: Mob, pose: MobPose): MobFrame {
  const md = pose.mode;
  const t = pose.t;
  const prev = VIS.get(m);
  const want =
    md === 'windup'
      ? (m.face ?? 0)
      : md === 'recover'
        ? (heroAng(m) ?? prev?.yaw ?? m.face ?? 0)
        : headOf(m);
  const v = visOf(m, pose, want, 14);
  const { d, flip } = side8(v.yaw);
  const sh = { shadow: 4 };
  if (md === 'dying') {
    const f = fi(t, SP_DIE_F - 1);
    return frame('spr', `die${f}d${d}`, pose, () => sproutDeathPic(d, f), {
      ...merge(flip, squash(t, -0.14, 0.1)),
      alpha: 1 - seg(t, 0.45, SP_DIE),
      shadow: f < 8 ? 4 : 0,
      still: true,
    });
  }
  if (md === 'emerge') {
    const f = fi(t, Math.round(SP_EMERGE * FPS) - 1);
    return frame('spr', `em${f}d${d}`, pose, () => spEmerge(d, f), {
      ...merge(flip),
      shadow: f < 4 ? 0 : 4,
      still: true,
    });
  }
  const hurt = hurtOf(m, pose, v, 1.3);
  if (md === 'windup') {
    const f = fi(t, BITE_F);
    return frame('spr', `wu${f}d${d}`, pose, () => sproutPic(spBite(d, f)), {
      ...merge(flip, hurt?.ex),
      ...sh,
      still: true,
      ghost: f >= BITE_F - 1 ? { every: 0.03, life: 0.12, tint: '230,210,255', alpha: 0.3 } : null,
    });
  }
  if (md === 'recover') {
    const f = fi(t, Math.round(BITE_REC * FPS));
    if (f >= 4 && spd(m) > 0.4) {
      // Пятится: шаги назад по пути, лицом к герою.
      const i = Math.floor(mod((-v.dist / 1) * 6, 6));
      return frame('spr', `rb${i}d${d}`, pose, () => sproutPic(spWalk(d, i, true)), {
        ...merge(flip, hurt?.ex),
        ...sh,
      });
    }
    const build = () => {
      const pic = sproutPic(spRecover(d, f));
      return f < 3 ? spSpark(pic, d, f) : pic;
    };
    return frame('spr', `rc${f}d${d}`, pose, build, {
      ...merge(flip, squash(t, 0.14, 0.14), hurt?.ex),
      ...sh,
      still: t < 0.12,
    });
  }
  if (md === 'sleep') {
    const i = Math.floor(idlePh(m, pose.now, 3) * 4);
    const b = [1, 2, 2, 1][i];
    const o: SpO = { ...SP0, d, bob: b, capY: b - 1, eyes: 'shut', glow: [0.3, 0.5, 0.7, 0.5][i] };
    return frame('spr', `sl${i}d${d}`, pose, () => sproutPic(o), { ...merge(flip), ...sh });
  }
  if (md === 'alert') {
    const f = fi(t, 8);
    const k = f / 8;
    const o: SpO = {
      ...SP0,
      d,
      bob: Math.round(-1.8 * Math.sin(seg(k, 0, 0.6) * PI)),
      capY: Math.round(-2 * wob(k * 1.2, 1)),
      eyes: 'wide',
      glow: 1 - k * 0.4,
      fR: [0.6, Math.round(Math.sin(seg(k, 0, 0.6) * PI))],
      fL: [-0.6, Math.round(Math.sin(seg(k, 0, 0.6) * PI))],
    };
    return frame('spr', `al${f}d${d}`, pose, () => sproutPic(o), { ...merge(flip), ...sh });
  }
  if (md === 'drop') {
    const o: SpO = {
      ...SP0,
      d,
      bob: -1,
      capY: -1.6,
      capH: 1.1,
      fR: [0.8, 1],
      fL: [-0.8, 2],
      eyes: 'wide',
      glow: 0.9,
    };
    return frame('spr', `dr${d}`, pose, () => sproutPic(o), { ...merge(flip), shadow: 0 });
  }
  if (md === 'stun') {
    const f = fi(t, 4);
    const o: SpO = {
      ...SP0,
      d,
      bob: 1,
      lean: -1,
      capY: Math.round(1.4 * wob((f + 1) / 5, 1)),
      capF: -1,
      eyes: 'wince',
      glow: 0.4,
    };
    const land = v.prev === 'drop' ? squash(t, 0.22, 0.18) : null;
    return frame('spr', `sn${f}d${d}`, pose, () => sproutPic(o), {
      ...merge(flip, land, hurt?.ex),
      ...sh,
    });
  }
  if (hurt?.wince) {
    const o: SpO = { ...SP0, d, bob: 1, lean: -1, capY: 1, capF: -1, eyes: 'wince', glow: 0.9 };
    return frame('spr', `hu${d}`, pose, () => sproutPic(o), { ...merge(flip, hurt.ex), ...sh });
  }
  if (spd(m) > 0.4) {
    const i = Math.floor(mod(v.dist * 6, 6));
    return frame('spr', `w${i}d${d}`, pose, () => sproutPic(spWalk(d, i)), {
      ...merge(flip, hurt?.ex),
      ...sh,
    });
  }
  const ph = idlePh(m, pose.now, 1.5);
  const i = Math.floor(ph * 8);
  const blink = hash(m.id ?? 0, Math.floor(pose.now / 1.5 + hash(m.id ?? 0, 9))) < 0.3;
  return frame('spr', `i${i}${blink ? 'b' : ''}d${d}`, pose, () => sproutPic(spIdle(d, i, blink)), {
    ...merge(flip, hurt?.ex),
    ...sh,
  });
}

registerMobPainter('f2_sprout', sproutFrame);

registerMobWarm('f2_sprout', function* () {
  const P = { flash: false, look: 'normal' as Look };
  for (let d = 0; d < 5; d++) {
    for (let i = 0; i < 8; i++) {
      frame('spr', `i${i}d${d}`, P, () => sproutPic(spIdle(d, i, false)));
      yield 0;
    }
    for (let i = 0; i < 6; i++) {
      frame('spr', `w${i}d${d}`, P, () => sproutPic(spWalk(d, i)));
      yield 0;
    }
  }
  for (let d = 0; d < 5; d++) {
    for (let f = 0; f <= BITE_F; f++) {
      frame('spr', `wu${f}d${d}`, P, () => sproutPic(spBite(d, f)));
      yield 0;
    }
    for (let f = 0; f <= Math.round(BITE_REC * FPS); f++) {
      frame('spr', `rc${f}d${d}`, P, () => {
        const pic = sproutPic(spRecover(d, f));
        return f < 3 ? spSpark(pic, d, f) : pic;
      });
      yield 0;
    }
  }
  for (let d = 0; d < 5; d++)
    for (let f = 0; f < SP_DIE_F; f++) {
      frame('spr', `die${f}d${d}`, P, () => sproutDeathPic(d, f));
      yield 0;
    }
});

// ---------------------------------------------------------------------------
// Сводовая слизь. Бесформенная — сторон нет, есть ход массы: ползёт толчками
// (мозг меняет скорость пульсом), и тело следует за скоростью: на рывке
// растекается вперёд, на паузе собирается горбом. Прыжок: собралась
// (0,6 с, вся подготовка) → оторвалась вытянутой → летит каплей (дуга —
// сдвигом кадра, тень на месте) → шлёп (контакт = первый кадр `recover`):
// блин и брызги, потом желе дрожит затухая. Удар режет надвое — половинки
// разлетаются рваными и собираются. Смерть — растекается лужей, ядро гаснет.
// ---------------------------------------------------------------------------

const SL_W = 40;
const SL_H = 34;
const SL_GY = 28;
const SL_CX = 20;
/** Тайминги мозга (`f2-brains.ts`): HOP_AIM 0,6, HOP_T 0,32, recover 0,7, stunT 0,35. */
const SL_AIM = 0.6;
const SL_AIM_F = 14;
const SL_HOP = 0.32;
const SL_HOP_F = 7;
const SL_REC = 0.7;
const SL_DIE = 0.8;
const SL_DIE_F = 19;

interface SlO {
  big: boolean;
  /** Ширина и высота тела (доли покоя). */
  w: number;
  h: number;
  /** Масса вперёд: верх сдвинут по ходу на столько пикселей. */
  lean: number;
  /** В воздухе: низ круглый. */
  air: boolean;
  /** Хвост капли вверх, px (падает со свода). */
  tail: number;
  /** Пузыри внутри: фаза 0…1. */
  bub: number;
  /** Брызги шлепка: 0 — нет, иначе 0…1 разлёт. */
  splat: number;
  /** Рваный край (разрезали). */
  torn: number;
  /** Свечение ядра поверх темноты 0…1. */
  glow: number;
}

const SL0: SlO = {
  big: true,
  w: 1,
  h: 1,
  lean: 0,
  air: false,
  tail: 0,
  bub: 0,
  splat: 0,
  torn: 0,
  glow: 0,
};

function slimePic(o: SlO): Pic {
  const p = new Px(SL_W, SL_H);
  const lit = o.glow > 0 || o.splat > 0 ? new Px(SL_W, SL_H) : null;
  const R0 = o.big ? 7.8 : 5.4;
  const H0 = o.big ? 5.8 : 4.2;
  const rx = R0 * o.w;
  const ry = H0 * o.h;
  const GY = SL_GY;
  const cx = SL_CX + 0.5;
  const cy = o.air ? GY - ry - 1 : GY - ry * 0.8;
  const bot = o.air ? ry : ry * 0.8;
  const H = ry + bot;
  // Сдвиг массы: верх уходит по ходу, низ стоит.
  const sh = (y: number) => o.lean * clamp01((GY - y) / H);
  const inBody = (x: number, y: number) => {
    const dx = (x + 0.5 - cx - sh(y)) / rx;
    const yy = y + 0.5 - cy;
    let dy = yy > 0 ? yy / bot : yy / ry;
    if (o.torn > 0 && yy < 0) dy += o.torn * 0.18 * Math.abs(Math.sin(x * 1.7));
    return dx * dx + dy * dy <= 1;
  };
  const e: Ell = { x: cx, y: cy, rx, ry };
  for (let y = 0; y < SL_H; y++)
    for (let x = 0; x < SL_W; x++) {
      if (!inBody(x, y)) continue;
      let c = tone(SLM.body, { ...e, x: cx + sh(y) }, x, y);
      if (!o.air && y >= GY - 1) c = SLM.body[0];
      const edge = !inBody(x - 1, y) || !inBody(x + 1, y) || !inBody(x, y - 1);
      p.set(x, y, alpha(c, edge ? 0.72 : 0.94));
    }
  if (o.tail > 0)
    for (let i = 1; i <= o.tail; i++) {
      const w = Math.max(0, 1.4 - i * 0.25);
      p.rect(
        Math.round(cx - w),
        Math.round(cy - ry - i + 1),
        Math.round(cx + w - 0.5),
        Math.round(cy - ry - i + 1),
        alpha(SLM.body[i < 2 ? 2 : 1], 0.85),
      );
    }
  // Ядро, недоеденная косточка, пузыри — плывут вместе с массой.
  const kx = cx + rx * 0.15 + sh(cy) * 0.8;
  const ky = cy + ry * 0.15;
  p.ell(kx, ky, Math.max(1.2, rx * 0.34), Math.max(1, ry * 0.32), SLM.core);
  p.set(Math.round(kx - 0.5), Math.round(ky - 0.5), SLM.coreL);
  if (o.big) {
    const bx = cx - rx * 0.45 + sh(cy) * 0.6;
    p.line(
      Math.round(bx),
      Math.round(cy + ry * 0.15),
      Math.round(bx + rx * 0.3),
      Math.round(cy + ry * 0.32),
      SLM.bone,
    );
    p.set(Math.round(bx - 0.6), Math.round(cy + ry * 0.05), SLM.bone);
  }
  for (let i = 0; i < 3; i++) {
    const ph = mod(o.bub + i / 3, 1);
    const x = cx + [0.42, -0.12, 0.2][i] * rx + sh(cy) * 0.7 + Math.sin(ph * 6 + i) * 0.6;
    const y = cy + bot * 0.6 - ph * H * 0.85;
    if (inBody(Math.round(x), Math.round(y)) && inBody(Math.round(x), Math.round(y) - 1))
      p.set(Math.round(x), Math.round(y), SLM.bubble);
  }
  // Блик — дугой слева сверху: влажный глянец.
  for (let a = 3.5; a <= 4.6; a += 0.18) {
    const y = cy + Math.sin(a) * ry * 0.62;
    p.set(Math.round(cx + sh(y) + Math.cos(a) * rx * 0.62), Math.round(y), SLM.hi);
  }
  p.outline(SLM.rim);
  // Брызги шлепка: капли летят по кругу земли и падают.
  if (o.splat > 0) {
    const k = o.splat;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.3;
      const r = rx * 0.8 + eOut(k) * (5 + (i % 3) * 2.5);
      const x = cx + Math.cos(a) * r;
      const up = Math.sin(k * PI) * (3 + (i % 2) * 2);
      const y = GY - 1 + Math.sin(a) * r * SE - up;
      const c = i % 2 ? SLM.body[2] : SLM.body[3];
      p.set(Math.round(x), Math.round(y), alpha(c, 1 - k * 0.5));
      if (i % 3 === 0 && k < 0.6) p.set(Math.round(x), Math.round(y) + 1, alpha(SLM.body[1], 0.8));
    }
    if (lit) glowAt(lit, cx, GY - 2, rx + 4, SLM.bubble, 0.45 * (1 - k));
  }
  if (lit && o.glow > 0) glowAt(lit, kx, ky, 3.5, SLM.coreL, o.glow);
  return { p, ax: SL_CX, ay: SL_GY, eye: [Math.round(kx - 0.5), Math.round(ky - 0.5)], lit };
}

/** Ход массы по экрану: −1 влево, 0 — вверх/вниз, 1 вправо. */
const slLean = (a: number) => {
  const c = Math.cos(a);
  return c > 0.38 ? 1 : c < -0.38 ? -1 : 0;
};

/** Ползёт: `k` — рывок (0 собралась горбом … 4 растеклась вперёд). */
function slCrawl(big: boolean, k: number, L: number, b: number): SlO {
  const q = k / 4;
  return {
    ...SL0,
    big,
    w: lerp(0.9, 1.16, q),
    h: lerp(1.12, 0.86, q),
    lean: L * lerp(-0.6, 2.2, q),
    bub: b / 4,
  };
}

/** Собирается для прыжка (0,6 с): вжимается и ширится, дрожит, к концу тянется вверх. */
function slAim(big: boolean, f: number, L: number): SlO {
  const t = (f + 0.5) / FPS;
  const sq = eOut(seg(t, 0, 0.42));
  const up = eIn(seg(t, 0.5, SL_AIM));
  const quiver = t > 0.42 && t < 0.52 ? (f % 2 ? 0.03 : -0.03) : 0;
  return {
    ...SL0,
    big,
    w: 1 + 0.26 * sq * (1 - up) - 0.12 * up + quiver,
    h: 1 - 0.3 * sq * (1 - up) + 0.28 * up - quiver,
    lean: L * (-1.2 * sq * (1 - up) + 1.4 * up),
    bub: 0.1 + 0.2 * sq,
  };
}

/** Полёт (0,32 с): вытянута вверх → капля → вытянута к земле. */
function slHop(big: boolean, f: number, L: number): SlO {
  const k = (f + 0.5) / (SL_HOP_F + 1);
  const st = k < 0.25 ? 1 - k / 0.25 : k > 0.7 ? (k - 0.7) / 0.3 : 0;
  return {
    ...SL0,
    big,
    air: true,
    w: 1 - 0.2 * st,
    h: 1.02 + 0.26 * st,
    lean: L * (k < 0.5 ? 1.2 : -0.4),
    bub: 0.4 + k * 0.3,
  };
}

/** Шлепок (кадр контакта и три следом): блин, брызги, свет. */
function slSplat(big: boolean, f: number): SlO {
  const k = (f + 0.5) / 4;
  return {
    ...SL0,
    big,
    w: lerp(1.42, 1.15, eOut(k)),
    h: lerp(0.55, 0.85, eOut(k)),
    splat: k,
    bub: 0.7,
  };
}

/** Желе дрожит после шлепка: поля движка (кадр — покой). */
function slJelly(t: number, a = 0.16): Partial<MobFrame> {
  const w = Math.exp(-4.5 * t) * Math.cos(t * TAU * 3.2);
  return { sx: 1 + a * w, sy: 1 - a * 1.1 * w };
}

/** Смерть 0,8 с: дрожь → растекается лужей → ядро гаснет, лужа сохнет. */
function slimeDeathPic(big: boolean, f: number): Pic {
  const t = (f + 0.5) / FPS;
  if (t < 0.12) {
    const pic = slimePic({
      ...SL0,
      big,
      w: 1 + (f % 2 ? 0.06 : -0.04),
      h: 1,
      glow: 0.6,
      torn: 0.5,
    });
    pic.eye = null;
    return pic;
  }
  const p = new Px(SL_W, SL_H);
  const lit = new Px(SL_W, SL_H);
  const k = eOut(seg(t, 0.12, 0.5));
  const dry = seg(t, 0.5, SL_DIE);
  const R = (big ? 7.8 : 5.4) * lerp(1, 1.85, k) * (1 - 0.25 * dry);
  const hh = (big ? 5.8 : 4.2) * lerp(0.8, 0.22, k);
  const cx = SL_CX + 0.5;
  const cy = SL_GY - hh * 0.6;
  // Лужа: широкий плоский овал, края рябят.
  const e: Ell = { x: cx, y: cy, rx: R, ry: Math.max(1.6, hh + R * SE * 0.25 * k) };
  for (let y = 0; y < SL_H; y++)
    for (let x = 0; x < SL_W; x++) {
      const a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
      const wav = 1 + 0.08 * Math.sin(a * 5 + f * 0.7) * k;
      const dx = (x + 0.5 - cx) / (e.rx * wav);
      const dy = (y + 0.5 - cy) / e.ry;
      if (dx * dx + dy * dy > 1) continue;
      const c = tone(SLM.body, e, x, y, -0.2 * k);
      p.set(x, y, alpha(mix(c, BLACK, 0.25 * dry), lerp(0.9, 0.55, dry)));
    }
  // Косточка остаётся на дне лужи.
  if (big)
    p.line(
      Math.round(cx - 4),
      Math.round(SL_GY - 1),
      Math.round(cx - 1),
      Math.round(SL_GY),
      SLM.bone,
    );
  // Ядро: тонет и гаснет; пузыри лопаются.
  const ck = 1 - seg(t, 0.25, 0.6);
  if (ck > 0) {
    p.ell(cx + 1, cy, 1.6 * ck + 0.4, 1, SLM.core);
    glowAt(lit, cx + 1, cy, 4 * ck + 1, SLM.coreL, 0.7 * ck);
  }
  for (let i = 0; i < 4; i++) {
    const bt = seg(t, 0.15 + i * 0.09, 0.3 + i * 0.09);
    if (bt <= 0 || bt >= 1) continue;
    const x = cx + (hash(i, 31) - 0.5) * R * 1.4;
    const y = cy - 1 - bt * 2;
    p.set(Math.round(x), Math.round(y), alpha(SLM.bubble, 1 - bt));
    if (bt > 0.6) {
      p.set(Math.round(x) - 1, Math.round(y), alpha(SLM.hi, 0.7));
      p.set(Math.round(x) + 1, Math.round(y), alpha(SLM.hi, 0.7));
    }
  }
  p.outline(SLM.rim);
  return { p, ax: SL_CX, ay: SL_GY, eye: null, lit };
}

/** Режим слизи → кадр. */
function slimeFrame(m: Mob, pose: MobPose): MobFrame {
  const md = pose.mode;
  const t = pose.t;
  const big = !((m.data?.gen ?? 0) > 0 || (m.r ?? 0.36) < 0.3);
  const z = big ? 'b' : 's';
  const aimed = md === 'hopAim' || md === 'hop';
  const v = visOf(m, pose, aimed ? (m.face ?? 0) : headOf(m, 0.15), 8);
  const L = slLean(v.yaw);
  const Lk = 'lmr'[L + 1];
  const sh = { shadow: big ? 8 : 6 };
  if (md === 'dying') {
    const f = fi(t, SL_DIE_F);
    return frame('slm', `die${f}${z}`, pose, () => slimeDeathPic(big, f), {
      linger: SL_DIE,
      alpha: 1 - seg(t, 0.62, SL_DIE),
      shadow: 0,
      still: true,
    });
  }
  const hurt = hurtOf(m, pose, v, 0.8);
  if (md === 'hopAim') {
    const f = fi(t, SL_AIM_F);
    return frame('slm', `a${f}${Lk}${z}`, pose, () => slimePic(slAim(big, f, L)), {
      ...merge(false, hurt?.ex),
      ...sh,
      still: true,
    });
  }
  if (md === 'hop') {
    const f = fi(t, SL_HOP_F);
    const k = clamp01(t / SL_HOP);
    const hgt = (big ? 10 : 8) * Math.sin(k * PI);
    return frame('slm', `h${f}${Lk}${z}`, pose, () => slimePic(slHop(big, f, L)), {
      dy: -hgt,
      shadow: Math.round(sh.shadow * (1 - 0.35 * Math.sin(k * PI))),
      still: true,
      ghost: { every: 0.035, life: 0.12, tint: '200,255,150', alpha: 0.25 },
    });
  }
  // Шлепок: после прыжка (контакт) и после падения со свода.
  const landed = md === 'recover' || (md === 'stun' && v.prev === 'drop');
  if (landed && t < 4 / FPS) {
    const f = fi(t, 3);
    return frame('slm', `sp${f}${z}`, pose, () => slimePic(slSplat(big, f)), {
      ...merge(false, hurt?.ex),
      ...sh,
      still: true,
    });
  }
  if (md === 'drop') {
    // Падает каплей: хвост ещё тянется к своду, низ круглый.
    const f = Math.floor(mod(t * 10, 3));
    const o: SlO = { ...SL0, big, air: true, w: 0.74 + f * 0.03, h: 1.24 - f * 0.04, tail: 5 - f };
    return frame('slm', `dr${f}${z}`, pose, () => slimePic(o), { shadow: 0, still: true });
  }
  const base = (b: number) =>
    frame('slm', `i${b}${z}`, pose, () => slimePic({ ...SL0, big, bub: b / 8 }), null);
  if (landed) {
    const fr = base(Math.floor(mod(pose.now * 3, 1) * 8));
    return { ...fr, ...merge(false, slJelly(t - 4 / FPS), hurt?.ex), ...sh };
  }
  if (md === 'stun') {
    // Разрезали: половинки летят рваными и собираются в шар.
    const f = fi(t, 3);
    if (f < 3 && !big) {
      const o: SlO = { ...SL0, big, torn: 1 - f / 3, w: 1.1, h: 0.9, lean: 0, glow: 0 };
      return frame('slm', `tr${f}${z}`, pose, () => slimePic(o), {
        ...merge(false, { sx: 1.18 - f * 0.05, sy: 0.84 + f * 0.04 }, hurt?.ex),
        ...sh,
      });
    }
    const fr = base(0);
    return { ...fr, ...merge(false, slJelly(t - 3 / FPS, 0.14), hurt?.ex), ...sh };
  }
  if (md === 'sleep') {
    const fr = base(0);
    const b = Math.sin(idlePh(m, pose.now, 2.8) * TAU);
    return { ...fr, sx: 1 + 0.04 * b, sy: 0.9 - 0.05 * b, ...sh };
  }
  if (md === 'alert') {
    const fr = base(2);
    const k = clamp01(t / 0.35);
    return {
      ...fr,
      ...merge(false, { sy: 1 + 0.2 * Math.sin(k * PI), sx: 1 - 0.12 * Math.sin(k * PI) }),
      ...sh,
    };
  }
  const sp = spd(m);
  if (sp > 0.15) {
    // Толчки мозга: скорость — доля рывка; тело следует за ней.
    const r = sp / Math.max(0.5, m.speed ?? 1.5);
    const k = Math.round(clamp01((r - 0.45) / 0.55) * 4);
    const b = Math.floor(mod(v.dist * 3, 4));
    return frame('slm', `c${k}${Lk}${b}${z}`, pose, () => slimePic(slCrawl(big, k, L, b)), {
      ...merge(false, hurt?.ex),
      ...sh,
    });
  }
  const ph = idlePh(m, pose.now, 2.2);
  const fr = base(Math.floor(mod(pose.now * 0.5 + hash(m.id ?? 0, 5), 1) * 8));
  const b = Math.sin(ph * TAU);
  return { ...fr, ...merge(false, { sx: 1 + 0.05 * b, sy: 1 - 0.06 * b }, hurt?.ex), ...sh };
}

registerMobPainter('f2_slime', slimeFrame);

registerMobWarm('f2_slime', function* () {
  const P = { flash: false, look: 'normal' as Look };
  for (const big of [true, false]) {
    const z = big ? 'b' : 's';
    for (let b = 0; b < 8; b++) {
      frame('slm', `i${b}${z}`, P, () => slimePic({ ...SL0, big, bub: b / 8 }));
      yield 0;
    }
    for (let L = -1; L <= 1; L++)
      for (let k = 0; k <= 4; k++)
        for (let b = 0; b < 4; b++) {
          frame('slm', `c${k}${'lmr'[L + 1]}${b}${z}`, P, () => slimePic(slCrawl(big, k, L, b)));
          yield 0;
        }
    for (let f = 0; f < 4; f++) {
      frame('slm', `sp${f}${z}`, P, () => slimePic(slSplat(big, f)));
      yield 0;
    }
  }
  for (let L = -1; L <= 1; L++) {
    for (let f = 0; f <= SL_AIM_F; f++) {
      frame('slm', `a${f}${'lmr'[L + 1]}b`, P, () => slimePic(slAim(true, f, L)));
      yield 0;
    }
    for (let f = 0; f <= SL_HOP_F; f++) {
      frame('slm', `h${f}${'lmr'[L + 1]}b`, P, () => slimePic(slHop(true, f, L)));
      yield 0;
    }
  }
  for (let f = 0; f <= SL_DIE_F; f++) {
    frame('slm', `die${f}b`, P, () => slimeDeathPic(true, f));
    yield 0;
  }
});

/** Капли слизи на полу: шлепок прыжка/падения и разрез. */
function gooDrops(
  g: CanvasRenderingContext2D,
  px: number,
  py: number,
  seed: number,
  n: number,
  R: number,
  age: number,
  life: number,
): void {
  const fade = 1 - seg(age, life * 0.55, life);
  for (let i = 0; i < n; i++) {
    const a = hash(seed, i, 1) * TAU;
    const d = R * (0.45 + 0.75 * hash(seed, i, 2));
    const k = eOut(seg(age, 0, 0.16 + 0.1 * hash(seed, i, 3)));
    const x = px + Math.cos(a) * d * k;
    const y = py + Math.sin(a) * d * k * SE - Math.sin(k * PI) * 4;
    const s = 1 + (hash(seed, i, 4) > 0.6 ? 1 : 0);
    g.globalAlpha = 0.9 * fade;
    g.fillStyle = i % 3 ? CSS.slm2 : CSS.slm3;
    g.fillRect(Math.round(x), Math.round(y), s, s);
    if (k >= 1 && s > 1) {
      g.fillStyle = CSS.slm1;
      g.fillRect(Math.round(x), Math.round(y) + s, s, 1);
    }
  }
  g.globalAlpha = 1;
}

const css = (c: RGBA) => `rgb(${c[0]},${c[1]},${c[2]})`;
const CSS = {
  slm1: css(SLM.body[1]),
  slm2: css(SLM.body[2]),
  slm3: css(SLM.body[3]),
  hi: css(SLM.hi),
};

// Шлепок прыжка и падения со свода: волна слизи по полу и капли (на полу,
// под мобами; свет удара — в кадре слизи `lit`).
registerImpactPainter('f2_hop', {
  life: 0.7,
  shake: 0.1,
  paint(g, rec, px, py, _s, age) {
    const R = (rec.r ?? 0.75) * TS;
    const k = eOut(seg(age, 0, 0.18));
    const fade = 1 - seg(age, 0.25, 0.7);
    g.globalAlpha = 0.5 * fade;
    g.strokeStyle = CSS.slm2;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px, py, R * (0.5 + 0.6 * k), R * (0.5 + 0.6 * k) * SE, 0, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    gooDrops(g, px, py, rec.seed >>> 0, 12, R * 1.2, age, 0.7);
    return age < 0.7;
  },
});

// Разрез слизи надвое: брызги веером в обе стороны и белая черта среза.
registerImpactPainter('f2_split', {
  life: 0.6,
  shake: 0.08,
  paint(g, rec, px, py, _s, age) {
    const sd = rec.seed >>> 0;
    if (age < 0.08) {
      const a = hash(sd, 9) * PI;
      g.globalAlpha = 1 - age / 0.08;
      g.fillStyle = CSS.hi;
      for (let i = -7; i <= 7; i++)
        g.fillRect(
          Math.round(px + Math.cos(a) * i),
          Math.round(py - 4 + Math.sin(a) * i * SE),
          1,
          1,
        );
      g.globalAlpha = 1;
    }
    gooDrops(g, px, py - 2, sd, 10, 14, age, 0.6);
    return age < 0.6;
  },
});

// ---------------------------------------------------------------------------
// Мандрагора. Корень-человечек с розеткой листьев, сидит в земле и
// поворачивается к герою. Вылезает (0,4 с) рывком — корень выдирается из
// земли с комьями; крик (урон в 1,05): вдох с откидом → рот раскрывается,
// руки вверх, листья дыбом, дрожь растёт → пик в 1,05 (кадр контакта:
// вытянута, кольцо визга) → крик гаснет до 1,35; выдохлась — вянет и
// пыхтит; уходит в землю винтом. Смерть — сохнет, валится набок, крошится.
// ---------------------------------------------------------------------------

const MD_W = 34;
const MD_H = 38;
const MD_GY = 32;
const MD_CX = 17;
/** Тайминги мозга (`f2-brains.ts`): rise 0,4, SCREAM_T 1,05 (+0,3), sink 0,5. */
const MD_RISE = 0.4;
const MD_SCREAM = 1.05;
const MD_SCREAM_END = 1.35;
const MD_SINK = 0.5;
const MD_DIE = 0.85;
const MD_DIE_F = 20;

type MdEyes = 'open' | 'shut' | 'wide' | 'half' | 'wince' | 'x';

interface MdO {
  d: number;
  /** 0 — в земле (видна розетка), 1 — стоит; больше 1 — подпрыгнула. */
  out: number;
  /** Корпус: ширина и высота (доли), наклон вперёд (px), дрожь вбок (px). */
  bw: number;
  bh: number;
  lean: number;
  shake: number;
  /** Руки: −1 висят, 0 в стороны, 1 вверх. */
  arms: number;
  /** Рот 0…1. */
  mouth: number;
  eyes: MdEyes;
  /** Листья: подъём (рад), разлёт, длина, качание. */
  lEl: number;
  lSp: number;
  lLen: number;
  sway: number;
  /** Сохнет 0…1. */
  dry: number;
  /** Визг поверх темноты 0…1. */
  yell: number;
  /** Комья земли: фаза 0…1 (−1 — нет). */
  clods: number;
}

const MD0: MdO = {
  d: 2,
  out: 1,
  bw: 1,
  bh: 1,
  lean: 0,
  shake: 0,
  arms: -1,
  mouth: 0,
  eyes: 'open',
  lEl: 1.05,
  lSp: 0.6,
  lLen: 1,
  sway: 0,
  dry: 0,
  yell: 0,
  clods: -1,
};

const YELL = hex('#fff2a0');

function mandrakePic(o: MdO, withLit = false): Pic {
  const p = new Px(MD_W, MD_H);
  const lit = withLit || o.yell > 0 ? new Px(MD_W, MD_H) : null;
  const yaw = SIDE_YAW[o.d];
  const c = Math.cos(yaw);
  const n = Math.sin(yaw);
  const GY = MD_GY;
  const cx = MD_CX + 0.5 + o.shake;
  const pal = o.dry > 0 ? MDR.body.map((q) => mix(q, hex('#5a4a3a'), o.dry * 0.7)) : MDR.body;
  const leafC = (q: RGBA) => (o.dry > 0 ? mix(q, hex('#6a5a30'), o.dry) : q);
  // Ямка с холмиком.
  p.ell(cx - o.shake, GY, 7, 2.2, MDR.soil);
  p.ell(cx - o.shake - 1, GY - 0.5, 5.2, 1.3, MDR.soilL);
  const rx = 4.4 * o.bw;
  const ry = 5.8 * o.bh;
  const sink = (1 - Math.min(1, o.out)) * (ry * 2 + 1);
  const hop = Math.max(0, o.out - 1) * 10;
  const by = GY - ry - 0.5 + sink - hop;
  const lean = o.lean;
  const bx = cx + c * lean * 0.5;
  const bodyY = by + n * lean * 0.3 * SE;
  const body: Ell = { x: bx, y: bodyY, rx, ry };
  const top = bodyY - ry;
  // Корона листьев: направления в теле → экран; дальние — до тела.
  const crown = { x: bx + c * lean * 0.4, y: top + 1.5 };
  const leaves: { a: number; l: number; dp: number; i: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const phi = yaw + PI + (i - 2) * o.lSp + o.sway * (i % 2 ? 1 : -1);
    const el = o.lEl + (i === 2 ? 0.25 : 0);
    const f = Math.cos(el) * Math.cos(phi - yaw);
    const s = Math.cos(el) * Math.sin(phi - yaw);
    const [sx, sy, dp] = prj(yaw, f, s, Math.sin(el));
    const L = (i === 2 ? 8 : 6.6) * o.lLen;
    const m = Math.hypot(sx, sy);
    leaves.push({ a: Math.atan2(sy, sx), l: L * Math.max(0.45, m), dp, i });
  }
  const drawLeaf = (lf: (typeof leaves)[number]) =>
    leaf(
      p,
      crown.x,
      crown.y,
      lf.a,
      lf.l,
      1.7,
      leafC(lf.i % 2 ? MDR.leafM : MDR.leafL),
      leafC(MDR.vein),
    );
  for (const lf of leaves) if (lf.dp < 0) drawLeaf(lf);
  // Руки-корешки: плечи по бокам, дальняя — до тела.
  const arms = [-1, 1].map((sd) => {
    const [ox, oy, dp] = prj(yaw, 0, sd * rx * 0.85, 0);
    const up = o.arms;
    const [ex, ey] = prj(
      yaw,
      0.6 + 0.6 * Math.max(0, up),
      sd * (1.6 + 1.4 * (1 - Math.abs(up))),
      up * 5,
    );
    return {
      x0: bx + ox,
      y0: bodyY - ry * 0.05 + oy,
      x1: bx + ox + ex,
      y1: bodyY - ry * 0.05 + oy + ey,
      dp,
    };
  });
  const drawArm = (a: (typeof arms)[number]) => {
    thick(p, a.x0, a.y0, a.x1, a.y1, 0.5, MDR.root);
    p.set(
      Math.round(a.x1 + (a.x1 > a.x0 ? 1 : -1)),
      Math.round(a.y1 - (o.arms > 0.3 ? 1 : -1)),
      MDR.root,
    );
  };
  for (const a of arms) if (a.dp < 0) drawArm(a);
  if (o.out > 0.04) {
    ball(p, body, pal);
    // Бороздки корня — на теле, поворачиваются с ним.
    for (const [az, h] of [
      [-0.9, -0.35],
      [0.5, 0.15],
      [-0.3, 0.55],
      [1.3, -0.1],
    ] as [number, number][]) {
      const a = yaw + az;
      if (Math.sin(a) < -0.2) continue;
      const x = Math.round(bx + Math.cos(a) * rx * 0.75);
      const y = Math.round(bodyY + h * ry);
      p.rect(x - 1, y, x, y, pal[0]);
    }
    // Корешок-хвостик снизу (виден, когда выдралась).
    if (o.out > 0.9) thick(p, bx + 1, bodyY + ry - 0.5, bx + 2.5, bodyY + ry + 1.5, 0.4, MDR.root);
    // Лицо: глаза на азимуте ±0,45, рот — по морде.
    const ey = Math.round(bodyY - ry * 0.25);
    for (const da of [-0.48, 0.48]) {
      const a = yaw + da;
      if (Math.sin(a) < -0.25) continue;
      const x = Math.round(bx - 0.5 + Math.cos(a) * rx * 0.72);
      const col = MDR.eyeD;
      switch (o.eyes) {
        case 'open':
          p.rect(x, ey, x, ey + 1, col);
          break;
        case 'wide':
          p.rect(x, ey - 1, x, ey + 1, col);
          p.set(x + (da < 0 ? -1 : 1), ey - 2, col);
          break;
        case 'half':
          p.rect(x - 1, ey + 1, x, ey + 1, col);
          break;
        case 'shut':
          p.set(x, ey + 1, col);
          break;
        case 'wince':
          p.set(x, ey, col);
          p.set(x + (da < 0 ? -1 : 1), ey + 1, col);
          break;
        case 'x':
          p.set(x - 1, ey - 1, col);
          p.set(x + 1, ey - 1, col);
          p.set(x, ey, col);
          p.set(x - 1, ey + 1, col);
          p.set(x + 1, ey + 1, col);
          break;
      }
      if (o.yell > 0.2 && lit) lit.set(x, ey, alpha(MDR.eye, Math.min(1, o.yell * 1.4)));
    }
    if (Math.sin(yaw) > -0.25) {
      const mx = bx - 0.5 + Math.cos(yaw) * rx * 0.62;
      const my = bodyY + ry * 0.22;
      if (o.mouth > 0.08) {
        const mw = 0.8 + o.mouth * 1.5;
        const mh = 0.6 + o.mouth * 2.4;
        p.ell(mx + 0.5, my + mh * 0.3, mw, mh, MDR.mouth);
        if (o.mouth > 0.5) p.ell(mx + 0.5, my + mh * 0.75, mw * 0.55, 0.8, MDR.tongue);
        if (lit && o.yell > 0)
          glowAt(lit, mx + 0.5, my + mh * 0.3, 3 + o.yell * 2, YELL, 0.5 * o.yell);
      } else
        p.rect(Math.round(mx - 1), Math.round(my), Math.round(mx + 1), Math.round(my), MDR.mouth);
    }
  }
  for (const a of arms) if (a.dp >= 0) drawArm(a);
  for (const lf of leaves) if (lf.dp >= 0) drawLeaf(lf);
  // Цветок на макушке.
  if (o.dry < 0.5) {
    const fx = Math.round(crown.x - 0.5);
    const fy = Math.round(crown.y - 2 - o.lEl * 1.5);
    p.set(fx, fy, MDR.flower);
    p.set(fx + 1, fy, mix(MDR.flower, WHITE, 0.3));
  }
  // Ниже земли — пусто, спереди — край ямки.
  for (let y = GY + 1; y < MD_H; y++)
    for (let x = 0; x < MD_W; x++) p.data[(y * MD_W + x) * 4 + 3] = 0;
  if (o.out < 1) {
    p.ell(cx - o.shake, GY + 0.6, 6.4, 1.4, MDR.soil);
    p.rect(Math.round(cx - o.shake - 5), GY, Math.round(cx - o.shake + 5), GY, MDR.soilL);
  }
  // Комья: летят дугой из ямки.
  if (o.clods >= 0) {
    for (let i = 0; i < 7; i++) {
      const a = PI + (i / 6) * PI + (hash(i, 41) - 0.5) * 0.4;
      const v = 0.6 + hash(i, 43) * 0.6;
      const k = o.clods;
      const x = cx + Math.cos(a) * (3 + k * 12 * v);
      const y = GY - 1 + Math.sin(a) * (1 + k * 9 * v) + k * k * 14;
      if (y < GY + 1) p.set(Math.round(x), Math.round(y), i % 3 ? MDR.soil : MDR.soilL);
      if (i % 2 && y < GY) p.set(Math.round(x) + 1, Math.round(y), MDR.soil);
    }
  }
  p.outline(INK);
  // Визг: дуги-чёрточки у головы (поверх темноты и на кадре).
  if (o.yell > 0) {
    const hy = bodyY - ry * 0.2;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.2;
      const r = 7 + o.yell * 4 + (i % 2) * 1.5;
      const x = Math.round(bx + Math.cos(a) * r);
      const y = Math.round(hy + Math.sin(a) * r * 0.75);
      const x2 = Math.round(bx + Math.cos(a) * (r + 1.5));
      const y2 = Math.round(hy + Math.sin(a) * (r + 1.5) * 0.75);
      const col = alpha(YELL, Math.min(1, o.yell));
      p.set(x, y, col);
      p.set(x2, y2, col);
      lit?.set(x, y, col);
      lit?.set(x2, y2, col);
    }
  }
  const eye: [number, number] | null =
    o.out >= 0.8 && (o.eyes === 'open' || o.eyes === 'wide') && Math.sin(yaw) > -0.25
      ? [Math.round(bx - 0.5 + Math.cos(yaw + 0.48) * rx * 0.72), Math.round(bodyY - ry * 0.25)]
      : null;
  return { p, ax: MD_CX, ay: MD_GY, eye, lit };
}

/** В земле: розетка листьев лежит, качается; изредка вздрагивает. */
function mdBuried(d: number, i: number, shiver: boolean): MdO {
  const s = Math.sin((i / 8) * TAU);
  return {
    ...MD0,
    d,
    out: 0.12,
    lEl: 0.35,
    lSp: 1.2,
    lLen: 0.95,
    sway: s * 0.12 + (shiver ? (i % 2 ? 0.1 : -0.1) : 0),
    eyes: 'shut',
  };
}

/** Вылезает (0,4 с): листья тянет вниз, земля вспучилась → рывок вверх с комьями → встала. */
function mdRise(d: number, f: number): MdO {
  const t = (f + 0.5) / FPS;
  const pre = eOut(seg(t, 0, 0.12));
  const pop = seg(t, 0.12, 0.3);
  const land = seg(t, 0.3, MD_RISE);
  const out =
    t < 0.12 ? 0.12 - 0.06 * pre : t < 0.3 ? lerp(0.06, 1.25, eOut(pop)) : lerp(1.25, 1, eIn(land));
  return {
    ...MD0,
    d,
    out,
    bw: t < 0.3 ? 0.92 : 1 + 0.08 * Math.sin(land * PI),
    bh: t < 0.3 ? 1.08 : 1 - 0.1 * Math.sin(land * PI),
    shake: t < 0.12 ? (f % 2 ? 0.6 : -0.6) : 0,
    arms: t < 0.3 ? 0.8 : lerp(0.8, -0.4, land),
    lEl: t < 0.12 ? 0.2 : lerp(1.4, 1.05, land),
    lSp: t < 0.12 ? 1.3 : 0.5,
    eyes: t < 0.12 ? 'shut' : 'wide',
    mouth: t < 0.3 ? 0.2 : 0,
    clods: t > 0.1 ? seg(t, 0.1, MD_RISE) : -1,
  };
}

/** Крик (1,35 с): вдох → раскрытие → дрожь растёт → пик в 1,05 → гаснет. */
function mdScream(d: number, f: number): MdO {
  const t = (f + 0.5) / FPS;
  const inhale = eOut(seg(t, 0, 0.25));
  const open = eIO(seg(t, 0.2, 0.75));
  const build = eIn(seg(t, 0.7, MD_SCREAM));
  const after = seg(t, MD_SCREAM, MD_SCREAM_END);
  const peak = t >= MD_SCREAM - 1 / FPS / 2 ? 1 - eOut(after) * 0.6 : build;
  const amp = (0.3 + 0.7 * peak) * (t > 0.3 ? 1 : 0) * (1 - after * 0.5);
  return {
    ...MD0,
    d,
    lean: -1.6 * inhale * (1 - open) + 0.6 * peak,
    bw: 1 + 0.1 * inhale * (1 - open) - 0.06 * peak,
    bh: 1 - 0.05 * inhale * (1 - open) + 0.12 * peak,
    shake: f % 2 ? amp : -amp,
    arms: lerp(-1, 1, eOut(seg(t, 0.1, 0.6))) - after * 0.6,
    mouth: Math.min(1, 0.25 * inhale + 0.55 * open + 0.3 * peak),
    eyes: t < 0.25 ? 'shut' : 'wide',
    lEl: lerp(1.05, 1.3, open) + 0.12 * peak,
    lSp: lerp(0.6, 0.72, open) + 0.1 * peak,
    lLen: 1 + 0.08 * open + 0.1 * peak,
    yell: t < 0.75 ? 0 : clamp01(0.35 + peak * 0.8 - after * 0.9),
  };
}

/** Выдохлась: листья поникли, пыхтит (8 кадров на 1,1 с). */
function mdTired(d: number, i: number): MdO {
  const b = Math.sin((i / 8) * TAU);
  return {
    ...MD0,
    d,
    out: 0.86,
    bw: 1 + 0.05 * b,
    bh: 0.94 - 0.04 * b,
    lean: 1.2,
    arms: -1,
    mouth: 0.25 + 0.15 * b,
    eyes: 'half',
    lEl: -0.25 + 0.08 * b,
    lSp: 0.95,
    lLen: 0.95,
  };
}

/** Уходит в землю (0,5 с): присела, крутится винтом вниз, листья — последними. */
function mdSink(d: number, f: number): MdO {
  const t = (f + 0.5) / FPS;
  const k = eIn(seg(t, 0.06, 0.42));
  return {
    ...MD0,
    d,
    out: lerp(0.86, 0.1, k),
    shake: f % 2 ? 0.6 : -0.6,
    arms: 0.4 * k,
    eyes: 'shut',
    lEl: lerp(-0.2, 0.3, k),
    lSp: lerp(0.95, 1.2, k),
    sway: (f % 3) * 0.12,
    clods: t > 0.08 ? seg(t, 0.08, MD_SINK) * 0.6 : -1,
  };
}

/** Смерть 0,85 с: беззвучный крик → сохнет → валится набок → крошится. */
function mandrakeDeathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / FPS;
  if (t < 0.3) {
    const k = seg(t, 0, 0.3);
    const pic = mandrakePic({
      ...MD0,
      d,
      mouth: 0.8 - k * 0.3,
      eyes: 'x',
      arms: lerp(0.6, -1, k),
      bw: 1 - 0.12 * k,
      bh: 1 - 0.08 * k,
      lEl: lerp(0.6, -0.3, k),
      lSp: 0.9,
      dry: k * 0.6,
      shake: f % 2 ? 0.5 : -0.5,
    });
    pic.eye = null;
    return pic;
  }
  // Лежит набок и крошится в землю.
  const p = new Px(MD_W, MD_H);
  const GY = MD_GY;
  const cx = MD_CX + 0.5;
  const k = eOut(seg(t, 0.3, 0.5));
  const crumble = seg(t, 0.5, MD_DIE);
  p.ell(cx, GY, 7, 2.2, MDR.soil);
  p.ell(cx - 1, GY - 0.5, 5.2, 1.3, MDR.soilL);
  const dryPal = MDR.body.map((q) => mix(q, hex('#5a4a3a'), 0.7));
  const e: Ell = {
    x: cx + k * 3,
    y: lerp(GY - 6.3, GY - 2.4, k),
    rx: lerp(4, 6, k),
    ry: lerp(5.4, 2.6, k),
  };
  ball(p, e, dryPal, (x, y) => hash(x, y, 51) > crumble * 0.85);
  for (let i = 0; i < 4; i++)
    leaf(
      p,
      e.x - e.rx + 0.5,
      e.y - 0.5,
      PI + 0.5 - i * 0.28 + k * 0.3,
      5.5 * (1 - crumble * 0.5),
      1.2,
      mix(MDR.leafM, hex('#6a5a30'), 0.85),
    );
  p.set(Math.round(e.x + 2), Math.round(e.y - 1), MDR.eyeD);
  // Крошки сыплются на землю.
  for (let i = 0; i < 8 * crumble; i++) {
    const x = e.x - e.rx + hash(i, 53) * e.rx * 2;
    const y = Math.min(GY, e.y + hash(i, 55) * 3 + crumble * 3);
    p.set(Math.round(x), Math.round(y), i % 2 ? dryPal[1] : MDR.soilL);
  }
  p.outline(INK);
  return { p, ax: MD_CX, ay: MD_GY, eye: null, lit: null };
}

/** Режим мандрагоры → кадр. */
function mandrakeFrame(m: Mob, pose: MobPose): MobFrame {
  const md = pose.mode;
  const t = pose.t;
  const awake = md === 'rise' || md === 'scream' || md === 'tired' || md === 'stun';
  const want = awake ? (heroAng(m) ?? m.face ?? PI / 2) : (VIS.get(m)?.yaw ?? m.face ?? PI / 2);
  const v = visOf(m, pose, want, md === 'scream' ? 3 : 6);
  const { d, flip } = side8(v.yaw);
  const sh = { shadow: 6 };
  if (md === 'dying') {
    const f = fi(t, MD_DIE_F);
    const key = t < 0.3 ? `die${f}d${d}` : `die${f}`;
    return frame('mdr', key, pose, () => mandrakeDeathPic(d, f), {
      ...merge(flip && t < 0.3),
      linger: MD_DIE,
      alpha: 1 - seg(t, 0.7, MD_DIE),
      shadow: 0,
      still: true,
    });
  }
  const hurt = hurtOf(m, pose, v, 0.6);
  if (md === 'rise') {
    const f = fi(t, Math.round(MD_RISE * FPS) - 1);
    return frame('mdr', `r${f}d${d}`, pose, () => mandrakePic(mdRise(d, f)), {
      ...merge(flip, hurt?.ex),
      ...sh,
      still: true,
    });
  }
  if (md === 'scream') {
    const f = fi(t, Math.round(MD_SCREAM_END * FPS) - 1);
    return frame('mdr', `s${f}d${d}`, pose, () => mandrakePic(mdScream(d, f)), {
      ...merge(flip, hurt?.ex),
      ...sh,
      still: true,
    });
  }
  if (md === 'sink') {
    const f = fi(t, Math.round(MD_SINK * FPS) - 1);
    return frame('mdr', `k${f}d${d}`, pose, () => mandrakePic(mdSink(d, f)), {
      ...merge(flip, hurt?.ex),
      ...sh,
      still: true,
    });
  }
  if (md === 'tired' || md === 'stun') {
    if (hurt?.wince) {
      const o: MdO = { ...mdTired(d, 0), eyes: 'wince', mouth: 0.5, lean: -1 };
      return frame('mdr', `tw${d}`, pose, () => mandrakePic(o), { ...merge(flip, hurt.ex), ...sh });
    }
    const i = Math.floor(idlePh(m, pose.now, 1.1) * 8);
    return frame('mdr', `t${i}d${d}`, pose, () => mandrakePic(mdTired(d, i)), {
      ...merge(flip, hurt?.ex),
      ...sh,
    });
  }
  if (md !== 'emerge') {
    // Портрет бестиария и незнакомые режимы: стоит, листья качаются.
    const i = Math.floor(idlePh(m, pose.now, 1.8) * 8);
    const o: MdO = {
      ...MD0,
      d,
      sway: Math.sin((i / 8) * TAU) * 0.1,
      bh: 1 + 0.03 * Math.sin((i / 8) * TAU),
    };
    return frame('mdr', `i${i}d${d}`, pose, () => mandrakePic(o), {
      ...merge(flip, hurt?.ex),
      ...sh,
    });
  }
  // В земле: розетка качается, изредка вздрагивает.
  const ph = idlePh(m, pose.now, 2.4);
  const i = Math.floor(ph * 8);
  const shiver = hash(m.id ?? 0, Math.floor(pose.now / 2.4 + hash(m.id ?? 0, 3))) < 0.25;
  return frame(
    'mdr',
    `b${i}${shiver ? 'v' : ''}d${d}`,
    pose,
    () => mandrakePic(mdBuried(d, i, shiver)),
    { ...merge(flip, hurt?.ex), shadow: 0 },
  );
}

registerMobPainter('f2_mandrake', mandrakeFrame);

registerMobWarm('f2_mandrake', function* () {
  const P = { flash: false, look: 'normal' as Look };
  for (let d = 0; d < 5; d++) {
    for (let i = 0; i < 8; i++) {
      frame('mdr', `b${i}d${d}`, P, () => mandrakePic(mdBuried(d, i, false)));
      yield 0;
    }
  }
  for (const d of [2, 1, 0, 3, 4]) {
    for (let f = 0; f < Math.round(MD_RISE * FPS); f++) {
      frame('mdr', `r${f}d${d}`, P, () => mandrakePic(mdRise(d, f)));
      yield 0;
    }
    for (let f = 0; f < Math.round(MD_SCREAM_END * FPS); f++) {
      frame('mdr', `s${f}d${d}`, P, () => mandrakePic(mdScream(d, f)));
      yield 0;
    }
  }
});

// Визг мандрагоры: кольцо ударной волны по полу до края круга, пыль
// вскинута по радиусам, трава прижата. На полу; свет визга — в кадре (`lit`).
registerImpactPainter('f2_scream', {
  life: 0.75,
  shake: 0.28,
  flash: 0.25,
  flashRgb: '255,240,170',
  paint(g, rec, px, py, _s, age) {
    const R = (rec.r ?? 3) * TS;
    const sd = rec.seed >>> 0;
    const k = eOut(seg(age, 0, 0.3));
    const fade = 1 - seg(age, 0.3, 0.75);
    for (let ring = 0; ring < 3; ring++) {
      const kr = clamp01(k - ring * 0.12);
      if (kr <= 0) continue;
      g.globalAlpha = 0.55 * fade * (1 - ring * 0.25);
      g.strokeStyle = ring ? 'rgb(255,242,160)' : 'rgb(255,255,235)';
      g.lineWidth = ring ? 1 : 2;
      g.beginPath();
      g.ellipse(px, py, R * kr, R * kr * SE, 0, 0, TAU);
      g.stroke();
    }
    // Пыль по радиусам: чёрточки у фронта волны.
    g.fillStyle = 'rgb(122,96,70)';
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + hash(sd, i, 1) * 0.3;
      const r = R * k * (0.85 + 0.15 * hash(sd, i, 2));
      g.globalAlpha = 0.7 * fade;
      for (let j = 0; j < 3; j++)
        g.fillRect(
          Math.round(px + Math.cos(a) * (r - j * 2)),
          Math.round(py + Math.sin(a) * (r - j * 2) * SE),
          1,
          1,
        );
    }
    g.globalAlpha = 1;
    return age < 0.75;
  },
});

// ---------------------------------------------------------------------------
// ВРЕМЕННО: прежние рисовальщики — заменяются по одному.
// ---------------------------------------------------------------------------

const q = (n: number, steps: number) => Math.max(0, Math.min(steps - 1, Math.floor(n * steps)));
// ---------------------------------------------------------------------------
// Кадр: облик, вспышка, зеркало, кеш.
// ---------------------------------------------------------------------------

const legacyFrames = new Map<string, MobFrame | null>();

function cachedFrame(key: string, make: () => MobFrame | null): MobFrame | null {
  const hit = legacyFrames.get(key);
  if (hit !== undefined) return hit;
  const f = make();
  legacyFrames.set(key, f);
  return f;
}

/**
 * Готовый рисунок (смотрит вправо) → кадр: альбинос белёсый, элита в
 * золотом канте, удар белым, влево — зеркало.
 */
function finish(
  src: Px,
  ax: number,
  ay: number,
  eye: [number, number] | null,
  o: { left: boolean; flash: boolean; look: MobPose['look'] },
): MobFrame {
  let p = src;
  if (o.look === 'albino') p = p.tint(PALE, 0.55);
  if (o.look === 'elite') {
    const q2 = new Px(p.w + 2, p.h + 2);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) q2.set(x + 1, y + 1, p.get(x, y));
    q2.outline(GOLD);
    p = q2;
    ax += 1;
    ay += 1;
    if (eye) eye = [eye[0] + 1, eye[1] + 1];
  }
  if (o.flash) p = p.tint(WHITE, 0.85);
  if (o.left) {
    p = p.flipX();
    ax = p.w - ax;
    if (eye) eye = [p.w - 1 - eye[0], eye[1]];
  }
  return { img: p.canvas(), ax, ay, eye };
}

const lookKey = (pose: MobPose) => `${pose.left ? 1 : 0}${pose.flash ? 1 : 0}${pose.look[0]}`;

// ---------------------------------------------------------------------------
// Сундучный рак (мимик). Сундук — тот же кадр атласа, что у настоящих
// тайников: пока он спит, отличить нельзя. Проснулся — лапы, стебельки глаз,
// клешня и зубастая пасть (кадры мимика из того же атласа).
// ---------------------------------------------------------------------------

/** Сундук кодом — пока не пришёл атлас. */
function chestFallback(open: number): Px {
  const p = new Px(16, 16);
  const wood = hex('#8a4a22');
  const woodD = hex('#5a2a14');
  const band = hex('#d8a83a');
  p.rect(1, 7, 14, 15, wood);
  p.rect(1, 3 - open, 14, 7 - open, mix(wood, WHITE, 0.15));
  p.rect(1, 11, 14, 11, woodD);
  p.rect(3, 3 - open, 3, 15, band);
  p.rect(12, 3 - open, 12, 15, band);
  p.rect(7, 8, 8, 10, band);
  if (open) p.rect(2, 7 - open, 13, 7, hex('#1a0a08'));
  p.outline(INK);
  return p;
}

function chestPx(name: X72Name, open: number): Px {
  return x72(name) ?? chestFallback(open);
}

interface MimicPose {
  frame: 0 | 1 | 2;
  /** Лапы: 0 — спрятаны, 1 — стоит. */
  legs: number;
  /** Фаза шага. */
  step: number;
  /** Сдвиг корпуса вперёд (укус). */
  lunge: number;
  /** Приподнять крышку на пиксель (выдаёт себя). */
  peek: boolean;
  claw: number;
  dead: boolean;
}

function mimicPx(s: MimicPose): { px: Px; eye: [number, number] | null } {
  const W = 28;
  const H = 26;
  const GY = 24;
  const px = new Px(W, H);
  const lift = Math.round(s.legs * 4);
  const ox = 6 + s.lunge;
  const oy = GY - 15 - lift;
  // Лапы — по три с каждой стороны, суставом вверх.
  if (s.legs > 0 && !s.dead) {
    for (let i = 0; i < 3; i++) {
      for (const far of [true, false]) {
        const ph = s.step + i * 2.1 + (far ? Math.PI : 0);
        const bx = ox + 3 + i * 4.5 + (far ? 1 : 0);
        const by = oy + 13;
        const kx = bx + (i - 1) * 1.8 + Math.cos(ph) * 1.2;
        const ky = by - 1 - s.legs * 1.2 - Math.max(0, Math.sin(ph)) * 1.5;
        const fx = bx + (i - 1) * 3.2 + Math.cos(ph) * 1.5;
        const fy = GY - Math.max(0, Math.sin(ph)) * 1.5;
        const c = far ? MIM.chit[0] : MIM.chit[2];
        thick(px, bx, by, kx, ky, 0.5, c);
        thick(px, kx, ky, fx, fy, 0.5, far ? MIM.chit[1] : MIM.chit[3]);
        px.set(Math.round(fx), Math.round(fy), far ? MIM.chit[1] : MIM.tip);
      }
    }
  }
  // Сундук.
  const names: X72Name[] = [
    'chest_mimic_open_anim_f0',
    'chest_mimic_open_anim_f1',
    'chest_mimic_open_anim_f2',
  ];
  const base =
    s.legs > 0 || s.frame > 0
      ? chestPx(names[s.frame], s.frame)
      : chestPx('chest_full_open_anim_f0', 0);
  for (let y = 0; y < base.h; y++)
    for (let x = 0; x < base.w; x++) {
      const c = base.get(x, y);
      if (!c[3]) continue;
      // Крышка (верх сундука) приподнята на пиксель — сундук «дышит».
      const dy = s.peek && y < 8 ? -1 : 0;
      px.set(ox + x, oy + y + dy, c);
    }
  let eye: [number, number] | null = null;
  if (s.dead) {
    // Лапы кверху, сундук пуст.
    for (let i = 0; i < 3; i++) {
      const bx = ox + 4 + i * 4;
      thick(px, bx, oy + 2, bx + (i - 1) * 2, oy - 3, 0.5, MIM.chit[1]);
      px.set(bx + (i - 1) * 2, oy - 4, MIM.tip);
    }
  } else if (s.legs > 0) {
    // Стебельки глаз над крышкой и клешня спереди.
    const sy = oy + 1 - Math.round(s.legs * 2);
    for (const ex of [ox + 9, ox + 13]) {
      thick(px, ex, oy + 2, ex + 0.5, sy + 1, 0.4, MIM.stalk);
      px.set(ex, sy, MIM.eye);
      px.set(ex + 1, sy, MIM.eye);
    }
    eye = [ox + 13, sy];
    const cx0 = ox + 15;
    const cy0 = oy + 11;
    const open = s.claw;
    thick(px, cx0, cy0, cx0 + 3, cy0 - 1, 0.7, MIM.chit[2]);
    leaf(px, cx0 + 3, cy0 - 1, -0.5 - open * 0.5, 4, 1.3, MIM.chit[3]);
    leaf(px, cx0 + 3, cy0 - 1, 0.35 + open * 0.5, 3.5, 1.1, MIM.chit[2]);
  }
  px.outline(INK);
  if (eye) {
    px.set(eye[0], eye[1], MIM.eye);
    px.set(eye[0] - 4, eye[1], MIM.eye);
  }
  return { px, eye };
}

registerMobPainter('f2_mimic', (m, pose) => {
  const t = pose.t;
  const f = pose.frame;
  const s: MimicPose = {
    frame: 0,
    legs: 1,
    step: 0,
    lunge: 0,
    peek: false,
    claw: 0,
    dead: false,
  };
  switch (pose.mode) {
    case 'sleep':
      s.legs = 0;
      s.peek = (m.data.tw ?? 1) < 0;
      break;
    case 'spring':
      s.frame = t < 0.1 ? 1 : 2;
      s.legs = q(t / 0.25, 3) / 2;
      s.claw = 1;
      break;
    case 'lunge':
      s.frame = 2;
      s.claw = 1;
      s.lunge = t < 0.4 ? -1 : 2;
      break;
    case 'windup':
      s.frame = 2;
      s.claw = 1;
      s.lunge = -1;
      break;
    case 'close':
      s.legs = 1 - q(t / 0.45, 3) / 2;
      break;
    case 'dying':
      s.dead = true;
      s.frame = 2;
      break;
    default:
      if (pose.mode === 'recover' && t < 0.18) {
        s.frame = 1;
        s.lunge = 2;
      } else if (pose.anim === 'run') {
        s.step = (mod(f, 6) / 6) * TAU;
        s.frame = f % 3 === 0 ? 1 : 0;
      } else if (pose.anim === 'hurt') {
        s.frame = 1;
        s.lunge = -1;
      } else s.step = mod(f, 4) * 0.4;
  }
  const key = `mim|${JSON.stringify(s)}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const { px, eye } = mimicPx(s);
    return finish(px, 14 + (s.lunge > 0 ? 0 : 0), 24, eye, pose);
  });
});

// ---------------------------------------------------------------------------
// Хваталка.
// ---------------------------------------------------------------------------

/** Голова-ловушка: две доли с зубами по кромке, `open` 0…1, смотрит по `ang`. */
function trapHead(px: Px, hx: number, hy: number, ang: number, open: number, R = 4): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const gap = open * 1.8;
  for (let y = Math.floor(hy - 7); y <= Math.ceil(hy + 7); y++)
    for (let x = Math.floor(hx - 7); x <= Math.ceil(hx + 7); x++) {
      const dx = x + 0.5 - hx;
      const dy = y + 0.5 - hy;
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      // Доли: верхняя и нижняя половины овала, раскрытые клином к морде.
      const opening = gap * Math.max(0, (u + R) / (2 * R));
      const vu = v + opening;
      const vl = v - opening;
      const inU = (u / R) ** 2 + (Math.min(0, vu) / (R * 0.65)) ** 2 <= 1 && vu <= 0.5;
      const inL = (u / R) ** 2 + (Math.max(0, vl) / (R * 0.65)) ** 2 <= 1 && vl >= -0.5;
      if (open > 0.1 && Math.abs(v) < opening && u > -R * 0.6 && (u / R) ** 2 < 1) {
        px.set(x, y, u > 1 ? SNP.mouthL : SNP.mouth);
        continue;
      }
      if (inU || inL) {
        const e: Ell = { x: hx, y: hy, rx: R, ry: R * 0.65 };
        px.set(x, y, tone(SNP.jaw, e, x, y));
      }
    }
  // Зубы по кромкам долей.
  if (open > 0.1)
    for (let i = -1; i <= 3; i++) {
      const u = i * 1.2;
      for (const s of [-1, 1]) {
        const v = s * (open * 1.8 * ((u + R) / (2 * R)) - 0.3);
        px.set(Math.round(hx + u * ux - v * uy), Math.round(hy + u * uy + v * ux), SNP.tooth);
      }
    }
  else {
    // Сомкнута: шов зубов посередине.
    for (let i = -2; i <= 3; i++)
      px.set(Math.round(hx + i * ux), Math.round(hy + i * uy), i % 2 ? SNP.tooth : SNP.jaw[0]);
  }
}

interface SnapPose {
  dir: number;
  /** Длина хлыста, клеток (0 — голова у корня). */
  reach: number;
  open: number;
  limp: boolean;
  sway: number;
  pull: number;
  dead: boolean;
}

function snapperPx(s: SnapPose): { px: Px; ax: number; ay: number; eye: [number, number] | null } {
  const reachPx = s.reach * TS;
  const R = Math.ceil(reachPx + 14);
  const W = R * 2;
  const H = R * 2;
  const px = new Px(W, H);
  const cx = R;
  const GY = R + 3;
  // Листья-розетка у корня (лежат на полу).
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.05 + i * 0.225) + (i % 2 ? 0.1 : 0);
    leaf(px, cx, GY - 1, Math.PI + a, 6, 1.5, i % 2 ? SNP.leaf : SNP.leafL);
  }
  // Луковица.
  ball(px, { x: cx, y: GY - 3, rx: 5, ry: 3.6 }, SNP.pod);
  px.set(cx - 2, GY - 5, SNP.pod[3]);
  // Куда голова.
  let hx: number;
  let hy: number;
  let ang = s.dir;
  if (s.dead) {
    hx = cx + 7;
    hy = GY - 1;
    ang = 0.3;
  } else if (s.reach > 0.05) {
    hx = cx + Math.cos(s.dir) * reachPx;
    hy = GY - 5 + Math.sin(s.dir) * reachPx + (s.limp ? 3 : 0);
  } else {
    // Покой: шея изогнута над луковицей, голова качается.
    hx = cx + 3 + s.sway - Math.cos(s.dir) * s.pull;
    hy = GY - 13 - Math.sin(s.dir) * s.pull * 0.6;
  }
  // Лоза: изогнутая кривая от луковицы к голове.
  const sx = cx;
  const sy = GY - 5;
  const mx = (sx + hx) / 2 + (s.reach > 0.05 ? -Math.sin(ang) * 3 : -4);
  const my = (sy + hy) / 2 + (s.reach > 0.05 ? Math.cos(ang) * 3 + (s.limp ? 3 : 0) : 2);
  const n = Math.max(8, Math.ceil(Math.hypot(hx - sx, hy - sy) * 1.5));
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    const x = (1 - tt) * (1 - tt) * sx + 2 * (1 - tt) * tt * mx + tt * tt * hx;
    const y = (1 - tt) * (1 - tt) * sy + 2 * (1 - tt) * tt * my + tt * tt * hy;
    const r = 1.8 - tt * 0.8;
    px.ell(x, y, r, r, SNP.vineM);
    px.set(Math.round(x - 0.5), Math.round(y - 1), SNP.vineL);
    // Шипы-листочки вдоль лозы.
    if (i % 6 === 3) px.set(Math.round(x + 1.5), Math.round(y - 1.5), SNP.leafL);
  }
  trapHead(px, hx, hy, ang, s.dead ? 0 : s.open, s.reach > 0.05 ? 5 : 4);
  px.outline(INK);
  // Приманка — светящаяся ягода на усике над головой.
  let eye: [number, number] | null = null;
  if (!s.dead) {
    const lx = Math.round(hx - Math.cos(ang) * 1 - 1);
    const ly = Math.round(hy - 4.5);
    px.set(lx, ly + 1, SNP.vine);
    px.set(lx, ly, SNP.lure);
    eye = [lx, ly];
  }
  return { px, ax: cx, ay: GY, eye };
}

/** Обрезать пустые поля кадра — большие кадры хлыста легче. */
function crop(px: Px, ax: number, ay: number, eye: [number, number] | null) {
  let x0 = px.w;
  let y0 = px.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++)
      if (px.solid(x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return { px, ax, ay, eye };
  y1 = Math.max(y1, Math.ceil(ay));
  const out = new Px(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) out.set(x - x0, y - y0, px.get(x, y));
  return {
    px: out,
    ax: ax - x0,
    ay: ay - y0,
    eye: eye ? ([eye[0] - x0, eye[1] - y0] as [number, number]) : null,
  };
}

registerMobPainter('f2_snapper', (m, pose) => {
  const t = pose.t;
  const f = pose.frame;
  const dir16 = Math.round((mod(m.dir, TAU) / TAU) * 16) % 16;
  const dir = (dir16 / 16) * TAU;
  const len = Math.round((m.data.len ?? 3.3) * 2) / 2;
  const s: SnapPose = {
    dir: pose.left ? Math.PI : 0,
    reach: 0,
    open: 0,
    limp: false,
    sway: [0, 1, 0, -1][mod(f, 4)],
    pull: 0,
    dead: false,
  };
  let free = false;
  switch (pose.mode) {
    case 'aim': {
      const k = q(t / 0.75, 4) / 3;
      s.dir = dir;
      s.open = k;
      s.pull = 2 + k * 2;
      free = true;
      break;
    }
    case 'snap':
      s.dir = dir;
      s.reach = len * (t < 0.08 ? 0.6 : 1);
      s.open = 0;
      free = true;
      break;
    case 'retract': {
      const ext = Math.max(0, 1 - t / 1.2);
      s.dir = dir;
      s.reach = Math.round(len * q(ext, 4) * 4) / 12;
      s.open = 0.5;
      s.limp = true;
      free = true;
      if (s.reach < 0.2) {
        s.reach = 0;
        s.limp = false;
      }
      break;
    }
    case 'dying':
      s.dead = true;
      break;
  }
  if (pose.anim === 'dead') s.dead = true;
  const leftKey = free ? 0 : pose.left ? 1 : 0;
  const key = `snp|${JSON.stringify(s)}|${pose.flash ? 1 : 0}|${pose.look[0]}|${leftKey}`;
  return cachedFrame(key, () => {
    const r = snapperPx(s);
    const c = crop(r.px, r.ax, r.ay, r.eye);
    // Хлыст в свободном направлении не зеркалим: он уже смотрит куда надо.
    return finish(c.px, c.ax, c.ay, c.eye, { ...pose, left: false });
  });
});

// ---------------------------------------------------------------------------
// Монетный жук.
// ---------------------------------------------------------------------------

function coinbugPx(step: number, bob: number, hurt: boolean, dead: boolean): Px {
  const px = new Px(20, 14);
  const GY = 12;
  const cx = 9;
  const cy = GY - 4.5 + bob;
  if (!dead)
    for (let i = 0; i < 3; i++) {
      const ph = step + i * 2.1;
      const bx = cx - 3.5 + i * 3.5;
      px.line(bx, cy + 2, bx + Math.cos(ph) * 1.5 - 0.5, GY - Math.max(0, Math.sin(ph)), BUG.leg);
    }
  // Голова с усами.
  ball(px, { x: cx + 6, y: cy + 1, rx: 2, ry: 1.8 }, BUG.head);
  px.line(cx + 7, cy - 0.5, cx + 9, cy - 3 + (hurt ? 1 : 0), BUG.leg);
  // Спина — горка монет.
  const shell: Ell = { x: cx, y: cy, rx: 6.2, ry: dead ? 2.4 : 4 };
  ball(px, shell, BUG.gold, (_x, y) => y <= cy + 2);
  const coins: [number, number][] = [
    [-3.5, -1],
    [0, -2.5],
    [3, -1],
    [-1, 0.8],
    [2.5, 1],
  ];
  for (const [dx, dy] of coins) {
    const x = Math.round(cx + dx);
    const y = Math.round(cy + dy);
    px.set(x, y, BUG.gold[3]);
    px.set(x + 1, y, BUG.gold[2]);
    px.set(x, y + 1, BUG.gold[0]);
  }
  px.set(Math.round(cx - 1), Math.round(cy - 1.5), BUG.ruby);
  px.set(Math.round(cx + 2), Math.round(cy - 2.8), BUG.sapph);
  px.set(Math.round(cx + 4), Math.round(cy + 0.5), BUG.emer);
  px.outline(INK);
  return px;
}

registerMobPainter('f2_coinbug', (_m, pose) => {
  const f = pose.frame;
  const run = pose.anim === 'run';
  const step = run ? (mod(f, 6) / 6) * TAU : 0;
  const bob = run ? -Math.round(Math.abs(Math.sin(step))) : 0;
  const hurt = pose.anim === 'hurt';
  const dead = pose.anim === 'dead';
  const key = `bug|${step.toFixed(2)}|${bob}|${hurt ? 1 : 0}|${dead ? 1 : 0}|${lookKey(pose)}`;
  return cachedFrame(key, () => finish(coinbugPx(step, bob, hurt, dead), 9, 12, [16, 7], pose));
});
