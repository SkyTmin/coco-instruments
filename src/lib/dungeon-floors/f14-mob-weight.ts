// Этаж 14 — «Гиря» (анимации мобов 14).
//
// Чугунный цилиндр часовой гири: латунные обручи, колпак, ушко-кольцо,
// клеймо-циферблат; висит на цепи под лебёдкой. Мозг (`f14-brains.ts`,
// `WEIGHT`): `f14_hang` — тень ползёт за героем (гиря неуязвима) →
// `f14_lock` 0,45 (замах: лебёдка дёргает гирю вверх двумя щелчками
// трещотки, гиря дрожит на пике) → `f14_fall` 0,18 (падение с ускорением) —
// урон в конце падения: **кадр контакта — первый кадр `f14_down`** (гиря
// сплющилась о пол, ударная волна, пыль, трещины, искры) → `f14_down` 2,4
// (лежит, открыта: обручи тлеют янтарём — мозг даёт урон ×1,2; цепь легла
// кольцами на крышку; под конец цепь выбирает слабину, гиря качается) →
// `f14_up` 0,8 (рывок, лебёдка поднимает гирю, та крутится на цепи) → висит.
//
// Висит живо: качается на цепи, отставая от хода тени (пружина по времени
// мира), и крутится туда-обратно (кручение цепи) — клеймо и швы отливки
// уходят за бок. Сторон нет — гиря круглая.
//
// Кадр = слои на своём холсте моба (как пружина кукушки): тень (растёт и
// темнеет с падением), пол (трещины, пыль — свой кеш), цепь (полоса из
// четырёх готовых фаз звеньев, наклон — сдвигом), тело гири (кеш), искры.
// Высота и качание меняются каждый кадр — в кеше только тело и пол.
//
// Смерть 0,85 с (`linger`): трещина по клейму, цепь рвётся и уходит вверх,
// гиря раскалывается на две половины, обручи спадают на пол, половины
// осыпаются ржавой крошкой (`scatter` из `f14-art.ts`).

import { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { scatter } from './f14-art';
import { WEIGHT } from './f14-brains';
import {
  INK,
  PI,
  TAU,
  WARM_POSE,
  alpha,
  clamp,
  clamp01,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  hurtAge,
  hx,
  kindOf,
  lerp,
  mixc,
  sstep,
  tf,
  tn,
  visOf,
  warmAll,
  wnow,
} from './f14-mobkit';
import type { Pic, RGBA, Tones } from './f14-mobkit';

const IRON = tn('#16161c', '#2e2e38', '#4e4e5a', '#8a8a98');
const BRASS = tn('#3a2410', '#7a5220', '#b8862e', '#f0c860');
const FRACT = tn('#2a2624', '#4a4440', '#6e6660', '#948a82');
const RUST = hx('#4a2a18');
const DIAL = hx('#e8dcc0');
const DIAL_D = hx('#a89a80');
const AMBER = hx('#ffb040');
const HOT = hx('#ffe0a8');
const SPARK = hx('#fff4d0');
const SPARK2 = hx('#ffc860');
const DUST: RGBA[] = [hx('#6a5a48'), hx('#8a7a64'), hx('#4a3e32')];
const DUST_HI = hx('#b8a890');
const CRACK = hx('#0a0806');
const LINE = hx('#d8dce8');

const tone = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];
const wrap = (a: number) => {
  let d = a % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
};

// ---------------------------------------------------------------------------
// Тело: цилиндр в 3/4 (торец — эллипс), свет сверху-слева.
// ---------------------------------------------------------------------------

/** Радиус, px; высота стенки (мир), на экране ×0,8; торец сжат ×0,6. */
const R = 6.5;
const HZ = 13;
const CE = 0.8;
const SE = 0.6;
/** Висит над тенью, px; рывок трещотки в замахе; верх цепи над землёй. */
const HANG = 24;
const LIFT = 4;
const TOP = HANG + LIFT;
const CH = 86;
/** Поворот «лицом»: клеймо чуть левее середины. Кадров поворота на оборот. */
const TW0 = 0.35;
const TWN = 32;

interface CylO {
  tw: number;
  /** Стенка ×: < 1 — сплющена ударом, > 1 — вытянута падением. */
  sq: number;
  /** Обручи и колпак тлеют (лежит — открыта), 0…1. */
  glow: number;
  /** Трещина по клейму сверху вниз 0…1 и её накал 0…1. */
  crack: number;
  hot: number;
  /** Половина: −1 левая, 1 правая, 0 — вся. */
  half: number;
  /** Слабина цепи кольцами на крышке, 0…1. */
  coil: number;
}
const C0: CylO = { tw: TW0, sq: 1, glow: 0, crack: 0, hot: 0, half: 0, coil: 0 };

/** Верх ушка над точкой земли тела (сюда цепляется цепь), px. */
const ringTop = (sq: number) => -(HZ * CE * sq + 5.9);

const BAND = (z: number) => (z > HZ - 2.5 && z < HZ - 0.6) || (z > 0.6 && z < 2.5);

function cyl(p: Px, lit: Px, cx: number, by: number, o: CylO): void {
  const k = 1 / Math.sqrt(o.sq);
  const Rr = R * k;
  const ry = Rr * SE;
  const Hs = HZ * CE * o.sq;
  const Rb = Rr + 0.75;
  const zk = CE * o.sq;
  const side = (dx: number) => (o.half < 0 && dx > 0.01) || (o.half > 0 && dx < -0.01);
  for (let x = Math.floor(cx - Rb - 1); x <= Math.ceil(cx + Rb + 1); x++) {
    const dx = x + 0.5 - cx;
    if (side(dx) || Math.abs(dx) > Rb) continue;
    const inner = Math.abs(dx) <= Rr;
    const u = clamp(dx / Rr, -1, 1);
    const c = Math.sqrt(Math.max(0, 1 - (dx / (inner ? Rr : Rb)) ** 2));
    const yb = by + ry * c;
    const yt = yb - Hs;
    const th = Math.asin(u);
    const phi = wrap(th - o.tw);
    for (let y = Math.ceil(yt - 0.5); y <= Math.floor(yb - 0.5); y++) {
      const z = (yb - (y + 0.5)) / zk;
      const band = BAND(z);
      if (!inner && !band) continue;
      let l = 0.3 - 0.72 * u + (Math.abs(u + 0.46) < 0.15 ? 0.42 : 0) - (u > 0.78 ? 0.2 : 0);
      let col: RGBA;
      if (band) {
        const edge = Math.abs(z - (HZ - 2.5)) < 0.55 || Math.abs(z - 2.5) < 0.55;
        col = tone(BRASS, l + 0.12 - (edge ? 0.3 : 0) - (inner ? 0 : 0.25));
        if (o.glow > 0) {
          col = mixc(col, AMBER, 0.4 * o.glow);
          lit.set(x, y, alpha(AMBER, 0.55 * o.glow));
        }
      } else {
        // Клеймо-циферблат спереди и сзади; швы отливки по бокам; ржа.
        const e = Math.abs(phi) < PI / 2 ? phi : wrap(phi - PI);
        const s = e * Rr;
        const ez = z - 6.7;
        const d = Math.hypot(s, ez);
        const seam =
          Math.abs(wrap(phi - PI / 2)) * Rr < 0.5 || Math.abs(wrap(phi + PI / 2)) * Rr < 0.5;
        if (d < 2.6) {
          if (d >= 1.55) col = tone(BRASS, l + 0.2);
          else if (
            (Math.abs(s) < 0.55 && ez > -0.3 && ez < 1.5) ||
            (Math.abs(ez) < 0.55 && s > -0.3 && s < 1.3)
          )
            col = INK;
          else col = l < 0.05 ? DIAL_D : DIAL;
        } else {
          if (seam) l -= 0.45;
          col = tone(IRON, l);
          const cl = hash(Math.floor(((phi + PI) * Rr) / 2.2), Math.floor(z / 2.2), 77);
          if (cl < 0.09) col = mixc(col, RUST, 0.55);
        }
      }
      // Излом у половины — светлый зернистый чугун.
      if (o.half && Math.abs(dx) < 1) col = tone(FRACT, 0.5 - z * 0.03 + hash(x, y, 9) * 0.4);
      p.set(x, y, col);
    }
  }
  // Торец: светлее к верхнему-левому краю.
  const tcy = by - Hs;
  p.ell(cx, tcy, Rr, ry, (x, y) => {
    const nx = (x + 0.5 - cx) / Rr;
    const ny = (y + 0.5 - tcy) / ry;
    if (side(x + 0.5 - cx)) return [0, 0, 0, 0];
    const rim = nx * nx + ny * ny > 0.62;
    return tone(IRON, 0.62 - 0.32 * nx - 0.3 * ny + (rim && nx + ny < 0 ? 0.18 : 0));
  });
  // Колпак латунный и ушко.
  const kx = 3.1 * k;
  const ky = 1.9 * k;
  for (const [yy, b] of [
    [tcy, -0.35],
    [tcy - 0.9, 0],
  ] as [number, number][])
    p.ell(cx, yy, kx, ky, (x, y) => {
      if (side(x + 0.5 - cx)) return [0, 0, 0, 0];
      const nx = (x + 0.5 - cx) / kx;
      const ny = (y + 0.5 - yy) / ky;
      const c = tone(BRASS, 0.55 - 0.5 * nx - 0.4 * ny + b);
      if (o.glow > 0) {
        lit.set(x, y, alpha(AMBER, 0.45 * o.glow));
        return mixc(c, AMBER, 0.35 * o.glow);
      }
      return c;
    });
  const rcy = tcy - 3.6;
  const rx = 0.7 + 1.75 * Math.abs(Math.cos(o.tw));
  for (let y = Math.floor(rcy - 3); y <= Math.ceil(rcy + 3); y++)
    for (let x = Math.floor(cx - 3); x <= Math.ceil(cx + 3); x++) {
      const dx = x + 0.5 - cx;
      if (side(dx)) continue;
      const q = (dx / rx) ** 2 + ((y + 0.5 - rcy) / 2.35) ** 2;
      const qi = rx > 1.3 ? (dx / (rx - 1.05)) ** 2 + ((y + 0.5 - rcy) / 1.25) ** 2 : 9;
      if (q <= 1 && qi > 1) p.set(x, y, dx < 0 ? IRON[3] : y + 0.5 < rcy ? IRON[2] : IRON[1]);
    }
  // Слабина цепи кольцами на крышке.
  const n = Math.round(o.coil * 7);
  for (let i = 0; i < n; i++) {
    const a = 0.6 + i * 1.05;
    const rr = 1.1 + i * 0.32;
    const x = Math.round(cx + 1.6 + Math.cos(a) * rr);
    const y = Math.round(tcy - 0.4 + Math.sin(a) * rr * 0.55);
    if (side(x + 0.5 - cx)) continue;
    p.set(x, y, i % 2 ? IRON[3] : IRON[2]);
  }
  // Трещина по клейму: зигзаг сверху вниз.
  if (o.crack > 0)
    for (let y = Math.floor(tcy); y <= Math.ceil(by + ry); y++) {
      const z = (by + ry - (y + 0.5)) / zk;
      if (z < HZ * (1 - o.crack) - 1) continue;
      const x = Math.round(cx - 0.5 + Math.round(Math.sin(y * 1.9) * 0.8));
      if (side(x + 0.5 - cx)) continue;
      if (!p.solid(x, y)) continue;
      p.set(x, y, o.hot > 0 ? mixc(CRACK, HOT, o.hot) : CRACK);
      if (o.hot > 0) lit.set(x, y, alpha(HOT, 0.9 * o.hot));
    }
}

/** Перенос рисунка с поворотом `a` вокруг (px, py) и сдвигом (ближайший). */
function stamp(dst: Px, src: Px, a = 0, px = 0, py = 0, ox = 0, oy = 0): void {
  if (!a) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const i = (y * src.w + x) * 4;
        if (!src.data[i + 3]) continue;
        dst.set(x + ox, y + oy, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
      }
    return;
  }
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let y = 0; y < dst.h; y++)
    for (let x = 0; x < dst.w; x++) {
      const qx = x + 0.5 - ox - px;
      const qy = y + 0.5 - oy - py;
      const sx = Math.floor(px + c * qx + s * qy);
      const sy = Math.floor(py - s * qx + c * qy);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      const i = (sy * src.w + sx) * 4;
      if (!src.data[i + 3]) continue;
      dst.set(x, y, [src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]]);
    }
}

const KB = { w: 60, h: 52, ax: 30, ay: 42 };
const KG = { w: 60, h: 32, ax: 30, ay: 16 };

/** Тело в рамке (обведено), с поворотом вокруг точки на земле. */
function body(p: Px, lit: Px, o: CylO, a = 0, pvx = 0, pvy = 0): void {
  const b = new Px(KB.w, KB.h);
  const bl = new Px(KB.w, KB.h);
  cyl(b, bl, KB.ax, KB.ay, o);
  b.outline(INK);
  stamp(p, b, a, KB.ax + pvx, KB.ay + pvy);
  stamp(lit, bl, a, KB.ax + pvx, KB.ay + pvy);
}

/** Пучок искр: `n` точек от (x, y) в сторону `dir` с разлётом `spread`. */
function sparks(
  p: Px,
  lit: Px,
  x: number,
  y: number,
  n: number,
  d: number,
  dir: number,
  spread: number,
  seed: number,
): void {
  for (let i = 0; i < n; i++) {
    const a = dir + (hash(seed, i, 1) - 0.5) * spread;
    const r = d * (0.5 + 0.5 * hash(seed, i, 2));
    const sx = Math.round(x + Math.cos(a) * r);
    const sy = Math.round(y + Math.sin(a) * r * 0.7);
    const c = i % 2 ? SPARK2 : SPARK;
    p.set(sx, sy, c);
    lit.set(sx, sy, alpha(c, 0.9));
  }
}

// ---- Дорожки тела ------------------------------------------------------------

const LAND_N = 15;
const LAND_SQ = [0.78, 0.86, 1.07, 1.03];
/** Отскок гири после удара, px (кадры `land`). */
const LAND_HOP = [0, 0, 1, 1, 0];
const REST_N = 12;
const TIGHT_N = 9;
const TIGHT_A = [0, 0, 0, 0.08, 0.12, 0.06, -0.05, -0.02, 0];
const DIE_T = 0.85;
const DIE_N = 21;
const FALL_SQ = [1, 1.12, 1.2, 1.22];

function restGlow(f: number): number {
  return 0.45 + 0.2 * Math.sin((f / REST_N) * TAU);
}

/** Где ушко (верх) у кадра тела: от точки земли, px. */
function ringOf(anim: string, f: number): [number, number] {
  if (anim === 'fall') return [0, ringTop(FALL_SQ[f] ?? 1)];
  if (anim === 'land') return [0, ringTop(LAND_SQ[f] ?? 1) - (LAND_HOP[f] ?? 0)];
  if (anim === 'tight') {
    const a = TIGHT_A[f] ?? 0;
    const pv = a > 0 ? R * 0.9 : -R * 0.9;
    const y = ringTop(1);
    // Поворот точки (0, y) вокруг (pv, 1).
    const qx = -pv;
    const qy = y - 1;
    return [pv + qx * Math.cos(a) - qy * Math.sin(a), 1 + qx * Math.sin(a) + qy * Math.cos(a)];
  }
  return [0, ringTop(1)];
}

function bodyPic(anim: string, f: number): Pic {
  const p = new Px(KB.w, KB.h);
  const lit = new Px(KB.w, KB.h);
  const T = tf(f);
  switch (anim) {
    case 'tw':
      body(p, lit, { ...C0, tw: TW0 + (f / TWN) * TAU });
      break;
    case 'fall': {
      const sq = FALL_SQ[f];
      body(p, lit, { ...C0, sq });
      if (f === 0) sparks(p, lit, KB.ax, KB.ay + ringTop(1) - 1, 4, 3, -PI / 2, 2.4, 3);
      else {
        // Полосы скорости над гирей.
        const top = KB.ay + ringTop(sq);
        const len = [0, 7, 11, 14][f];
        for (const [x, l0] of [
          [KB.ax - 5, 0.8],
          [KB.ax - 1, 1],
          [KB.ax + 3, 0.7],
          [KB.ax + 6, 0.5],
        ] as [number, number][])
          for (let i = 0; i < len * l0; i++)
            if (!p.solid(x, top + 6 - i))
              p.set(x, top + 6 - i, alpha(LINE, 0.55 * (1 - i / (len * l0))));
      }
      break;
    }
    case 'land': {
      const hop = LAND_HOP[f] ?? 0;
      body(
        p,
        lit,
        {
          ...C0,
          sq: LAND_SQ[f] ?? 1,
          coil: clamp01((f - 3) / 5),
          glow: 0.45 * clamp01((f - 6) / 8),
        },
        0,
        0,
        0,
      );
      if (hop) {
        // Подскок: всё тело на точку выше.
        const q = new Px(KB.w, KB.h);
        const ql = new Px(KB.w, KB.h);
        stamp(q, p, 0, 0, 0, 0, -hop);
        stamp(ql, lit, 0, 0, 0, 0, -hop);
        return { p: q, lit: ql, ax: KB.ax, ay: KB.ay, eye: null };
      }
      break;
    }
    case 'rest':
      body(p, lit, { ...C0, coil: 1, glow: restGlow(f) });
      break;
    case 'tight': {
      const a = TIGHT_A[f] ?? 0;
      body(
        p,
        lit,
        { ...C0, coil: 1 - clamp01(f / 3), glow: 0.45 * (1 - f / (TIGHT_N - 1)) },
        a,
        a > 0 ? R * 0.9 : -R * 0.9,
        1,
      );
      break;
    }
    case 'die':
      dieBody(p, lit, f, T);
      break;
  }
  return { p, lit, ax: KB.ax, ay: KB.ay, eye: null };
}

/** Куски раскола: затравка (от точки земли), куда ложится, поворот, подскок. */
const CHUNKS: { s: [number, number]; to: [number, number]; rot: number; hop: number }[] = [
  { s: [-3, -4], to: [-5, 1], rot: -0.35, hop: 1 },
  { s: [3, -3], to: [5, 1], rot: 0.3, hop: 1 },
  { s: [-3, -12], to: [-10, 8], rot: -1.15, hop: 4 },
  { s: [3, -13], to: [10, 9], rot: 1.3, hop: 3 },
];

/** Смерть: трещина накалом, раскол на четыре куска, ржавая крошка. */
function dieBody(p: Px, lit: Px, f: number, T: number): void {
  const crack = clamp01((f + 1) / 3);
  const hot = 1 - sstep(0.06, 0.3, T);
  if (T < 0.14) {
    body(p, lit, { ...C0, crack, hot, sq: f === 0 ? 0.95 : 1 });
    return;
  }
  const b = new Px(KB.w, KB.h);
  cyl(b, new Px(KB.w, KB.h), KB.ax, KB.ay, { ...C0, crack: 1, hot });
  // Кому принадлежит точка: ближайшая затравка с шумом (рваный край).
  const id = new Int8Array(b.w * b.h).fill(-1);
  const cen = CHUNKS.map(() => [0, 0, 0]);
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++) {
      if (!b.solid(x, y)) continue;
      let best = 0;
      let bd = 1e9;
      CHUNKS.forEach((c, i) => {
        const d =
          Math.hypot(x + 0.5 - KB.ax - c.s[0], (y + 0.5 - KB.ay - c.s[1]) * 1.15) +
          (hash(x, y, 31 + i) - 0.5) * 2.2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      id[y * b.w + x] = best;
      cen[best][0] += x;
      cen[best][1] += y;
      cen[best][2]++;
    }
  const k = clamp01((T - 0.14) / 0.24);
  CHUNKS.forEach((c, i) => {
    const n = cen[i][2];
    if (!n) return;
    const q = new Px(b.w, b.h);
    for (let y = 0; y < b.h; y++)
      for (let x = 0; x < b.w; x++) {
        if (id[y * b.w + x] !== i) continue;
        // Излом — светлый зернистый чугун на краю куска.
        const edge = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([ex, ey]) => {
          const j = id[(y + ey) * b.w + x + ex];
          return j !== undefined && j >= 0 && j !== i;
        });
        q.set(x, y, edge ? tone(FRACT, 0.3 + hash(x, y, 9) * 0.6) : b.get(x, y));
      }
    q.outline(INK);
    const px = cen[i][0] / n;
    const py = cen[i][1] / n;
    const ox = Math.round(c.to[0] * easeOut(k));
    const oy = Math.round(c.to[1] * easeIn(k) - c.hop * Math.sin(PI * k));
    stamp(p, q, c.rot * easeOut(k), px, py, ox, oy);
  });
  // Куски осыпаются ржавой крошкой.
  if (T > 0.56) {
    const kk = clamp01((T - 0.56) / 0.29) * 1.15;
    const q = scatter(p, kk, 41, [IRON[1], RUST, BRASS[2], IRON[2]]);
    p.data.set(q.data);
  }
}

// ---- Пол: трещины, пыль, осколки ----------------------------------------------

const CRACKS = 5;
/** Трещины в плитке вокруг гири — от края, не из-под неё (иначе читаются ногами). */
function floorCracks(p: Px, k: number, fade: number): void {
  for (let i = 0; i < CRACKS; i++) {
    const a = (i / CRACKS) * TAU + hash(i, 5, 2) * 0.9;
    const r0 = R + 1.5 + hash(i, 5, 5) * 1.5;
    const L = (3 + hash(i, 5, 3) * 5) * k;
    let x = KG.ax + Math.cos(a) * r0;
    let y = KG.ay + Math.sin(a) * r0 * 0.5;
    let b = a;
    for (let s = 0; s < L; s++) {
      b += (hash(i, s, 4) - 0.5) * 1.1;
      x += Math.cos(b);
      y += Math.sin(b) * 0.5;
      p.set(x, y, alpha(CRACK, 0.6 * fade));
      if (s === 2) p.set(x + Math.sin(b) * 1.5, y - Math.cos(b) * 0.6, alpha(CRACK, 0.45 * fade));
    }
  }
}

/** Осколки плитки: разлетаются дугой и ложатся (`k` 0…1). */
function chips(p: Px, k: number, fade: number): void {
  for (let i = 0; i < 6; i++) {
    const a = hash(i, 8, 1) * TAU;
    const d = 6 + hash(i, 8, 2) * 9;
    const kk = clamp01(k);
    const x = KG.ax + Math.cos(a) * d * easeOut(kk);
    const y =
      KG.ay +
      Math.sin(a) * d * SE * easeOut(kk) -
      7 * Math.sin(PI * kk) * (0.6 + hash(i, 8, 3) * 0.4);
    p.set(x, y, alpha(i % 2 ? DUST[1] : DUST_HI, fade));
    if (i < 3) p.set(x + 1, y, alpha(DUST[2], fade));
  }
}

/** Кольцо пыли: волна от гири (`k` 0…1 — фаза, `thin` — сколько осталось). */
function dustRing(
  p: Px,
  k: number,
  thin: number,
  r0: number,
  r1: number,
  up: number,
  seed: number,
): void {
  for (let i = 0; i < 30; i++) {
    if (hash(seed, i, 7) > thin) continue;
    const a = (i / 30) * TAU + hash(seed, i, 1) * 0.3;
    const s = 0.7 + 0.3 * hash(seed, i, 2);
    const r = lerp(r0, r1 * s, easeOut(k));
    const x = KG.ax + Math.cos(a) * r;
    const y = KG.ay + Math.sin(a) * r * 0.5 - up * Math.sin(PI * clamp01(k * 1.3)) * s;
    const c = DUST[i % 3];
    p.set(x, y, c);
    if (k < 0.5 && i % 3 === 0) p.set(x + 1, y, c);
  }
}

function gndPic(anim: string, f: number): Pic {
  const p = new Px(KG.w, KG.h);
  const lit = new Px(KG.w, KG.h);
  const T = tf(f);
  if (anim === 'gl') {
    floorCracks(p, [0.6, 0.9][f] ?? 1, 1);
    chips(p, f / 8, 1);
    dustRing(p, (f + 1) / 12, 1 - clamp01((f - 5) / 10), 5, 18, 3, 11);
    if (f < 3) {
      // Ударная волна: тонкое светлое кольцо.
      const r = [9, 13, 16][f];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU;
        p.set(
          KG.ax + Math.cos(a) * r,
          KG.ay + Math.sin(a) * r * 0.5,
          alpha(DUST_HI, [0.85, 0.55, 0.25][f]),
        );
      }
      sparks(p, lit, KG.ax - R, KG.ay + 1, 3, 2 + f * 2.5, PI, 1.4, 5 + f);
      sparks(p, lit, KG.ax + R, KG.ay + 1, 3, 2 + f * 2.5, 0, 1.4, 6 + f);
    }
  } else if (anim === 'gr') {
    floorCracks(p, 1, 1);
    chips(p, 1, 1);
    dustRing(p, 1, 0.25, 5, 13, 0, 13);
    // Пылинки поднимаются и гаснут.
    for (let i = 0; i < 2; i++) {
      const k = (f / REST_N + i * 0.5) % 1;
      const x = KG.ax + (i ? 5 : -6) + Math.round(Math.sin(k * 5) * 0.6);
      p.set(x, KG.ay + 1 - k * 9, alpha(DUST_HI, 0.7 * (1 - k)));
    }
  } else if (anim === 'gu') {
    const fade = 1 - clamp01((f - 2) / 4);
    floorCracks(p, 1, fade);
    chips(p, 1, fade);
    if (f < 4) dustRing(p, (f + 1) / 4, 0.8, 5, 10, 4, 17);
  } else if (anim === 'gd') {
    floorCracks(p, 1, 1 - sstep(0.5, 0.85, T));
    chips(p, 1, 1 - sstep(0.4, 0.8, T));
    // Половины легли — пыль у краёв.
    if (T > 0.36 && T < 0.75) {
      const k = (T - 0.36) / 0.39;
      for (const sd of [-1, 1]) {
        for (let i = 0; i < 9; i++) {
          if (hash(sd, i, 3) < k * 0.8) continue;
          const a = hash(sd, i, 1) * TAU;
          const r = 2 + 6 * easeOut(k) * hash(sd, i, 2);
          p.set(
            KG.ax + sd * 12 + Math.cos(a) * r,
            KG.ay + Math.sin(a) * r * 0.5 - 3 * k,
            DUST[i % 3],
          );
        }
      }
    }
  }
  return { p, lit, ax: KG.ax, ay: KG.ay, eye: null };
}

const KBK = kindOf('weight', KB.w, KB.h, KB.ax, KB.ay, 180);
const KGK = kindOf('weightg', KG.w, KG.h, KG.ax, KG.ay, 90);

// ---------------------------------------------------------------------------
// Слои на холсте моба: тень, пол, цепь, тело, искры.
// ---------------------------------------------------------------------------

/** Цепь: 4 фазы звеньев (ребро, ребро, плашмя, плашмя), верх гаснет во тьме. */
const LINK_FADE = 18;
let STRIPS: HTMLCanvasElement[] | null = null;
function strips(): HTMLCanvasElement[] {
  if (STRIPS) return STRIPS;
  STRIPS = [];
  const H = CH + 8;
  for (let ph = 0; ph < 4; ph++) {
    const p = new Px(5, H);
    for (let y = 0; y < H; y++) {
      const k = clamp01(y / LINK_FADE);
      const ph4 = (y + ph) % 4;
      const a = (c: RGBA, m = 1) => alpha(c, k * m);
      if (ph4 < 2) {
        p.set(2, y, a(ph4 ? IRON[3] : IRON[2]));
        p.set(1, y, a(INK, 0.45));
        p.set(3, y, a(INK, 0.55));
      } else {
        p.set(1, y, a(ph4 === 2 ? IRON[3] : IRON[2]));
        p.set(3, y, a(ph4 === 2 ? IRON[1] : IRON[0]));
        p.set(0, y, a(INK, 0.4));
        p.set(4, y, a(INK, 0.5));
      }
    }
    STRIPS.push(p.canvas());
  }
  return STRIPS;
}

interface Cmp {
  c: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  /** Слой поверх темноты (тлеющие обручи, накал трещины) — того же размера. */
  l: HTMLCanvasElement | null;
  lg: CanvasRenderingContext2D | null;
}
const CMP = new WeakMap<Mob, Cmp>();
function cmpOf(m: Mob, w: number, h: number): Cmp | null {
  let e = CMP.get(m);
  if (!e) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    if (!g) return null;
    e = { c, g, l: null, lg: null };
    CMP.set(m, e);
  } else if (e.c.width < w || e.c.height < h) {
    e.c.width = Math.max(e.c.width, w);
    e.c.height = Math.max(e.c.height, h);
  } else e.g.clearRect(0, 0, e.c.width, e.c.height);
  e.g.imageSmoothingEnabled = false;
  return e;
}

const SHADE = new Map<number, string>();
const shade = (a: number) => {
  const k = Math.round(a * 50);
  let s = SHADE.get(k);
  if (!s) SHADE.set(k, (s = `rgba(0,0,0,${(k / 50).toFixed(2)})`));
  return s;
};
const CSS = (c: RGBA) => `rgb(${c[0]},${c[1]},${c[2]})`;
const SPARK_S = [CSS(SPARK), CSS(SPARK2)];
const DUST_S = DUST.map(CSS);

interface Lay {
  /** Тело от якоря (точки земли), px. */
  bx: number;
  by: number;
  /** Цепь: верх (над якорем) и низ — ушко; null — без цепи. */
  top: number;
  chain: [number, number] | null;
  shadow: number;
  sa: number;
  /** Живые точки: [x, y, стиль] от якоря. */
  dots: [number, number, string][];
}

function compose(m: Mob, bf: MobFrame, gnd: MobFrame | null, L: Lay): MobFrame {
  const bi = bf.img as HTMLCanvasElement;
  let x0 = Math.min(-L.shadow - 1, L.bx - bf.ax, -3);
  let x1 = Math.max(L.shadow + 1, L.bx - bf.ax + bi.width, 3);
  let y0 = Math.min(L.by - bf.ay, L.chain ? L.top : 0);
  let y1 = Math.max(L.by - bf.ay + bi.height, 3);
  if (gnd) {
    const gi = gnd.img as HTMLCanvasElement;
    x0 = Math.min(x0, -gnd.ax);
    x1 = Math.max(x1, gi.width - gnd.ax);
    y0 = Math.min(y0, -gnd.ay);
    y1 = Math.max(y1, gi.height - gnd.ay);
  }
  for (const d of L.dots) {
    x0 = Math.min(x0, d[0]);
    x1 = Math.max(x1, d[0] + 1);
    y0 = Math.min(y0, d[1]);
    y1 = Math.max(y1, d[1] + 1);
  }
  x0 = Math.floor(x0) - 3;
  y0 = Math.floor(y0) - 1;
  const w = Math.ceil(x1) - x0 + 4;
  const h = Math.ceil(y1) - y0 + 2;
  const e = cmpOf(m, w, h);
  if (!e) return bf;
  const { c, g } = e;
  const ox = -x0;
  const oy = -y0;
  if (L.shadow > 0) {
    // Тень строками точек — края ровные, без размытия.
    g.fillStyle = shade(L.sa);
    const ry = Math.max(1.2, L.shadow * 0.3);
    for (let y = -Math.floor(ry); y <= Math.floor(ry); y++) {
      const hw = Math.round(L.shadow * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.5)) ** 2)));
      if (hw > 0) g.fillRect(ox - hw, oy + y, hw * 2, 1);
    }
  }
  if (gnd) g.drawImage(gnd.img, ox - gnd.ax, oy - gnd.ay);
  if (L.chain) {
    const [cx, cy] = L.chain;
    const len = Math.round(cy - L.top);
    if (len > 0) {
      const S = strips();
      const ph = (4 - (len % 4)) % 4;
      g.setTransform(1, 0, cx / len, 1, ox, oy + L.top);
      g.drawImage(S[ph], 0, 0, 5, len, -2, 0, 5, len);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  g.drawImage(bi, ox + L.bx - bf.ax, oy + L.by - bf.ay);
  let st = '';
  for (const [x, y, s] of L.dots) {
    if (s !== st) g.fillStyle = st = s;
    g.fillRect(ox + x, oy + y, 1, 1);
  }
  let lit: HTMLCanvasElement | null = null;
  if (bf.lit) {
    if (!e.l || !e.lg) {
      e.l = document.createElement('canvas');
      e.lg = e.l.getContext('2d');
    }
    if (e.l && e.lg) {
      if (e.l.width !== c.width || e.l.height !== c.height) {
        e.l.width = c.width;
        e.l.height = c.height;
      } else e.lg.clearRect(0, 0, e.l.width, e.l.height);
      e.lg.imageSmoothingEnabled = false;
      e.lg.drawImage(bf.lit, ox + L.bx - bf.ax, oy + L.by - bf.ay);
      lit = e.l;
    }
  }
  return { img: c, ax: ox, ay: oy, eye: null, lit };
}

// ---------------------------------------------------------------------------
// Ход гири: качание на цепи и кручение — по времени мира.
// ---------------------------------------------------------------------------

interface WS {
  t: number;
  mode: string;
  since: number;
  x: number;
  vx: number;
  y: number;
  vy: number;
  tw: number;
  tw0: number;
  h: number;
}
const WST = new WeakMap<Mob, WS>();
/** Высота в миг смерти: копия моба (`linger`) — другой объект, берём по номеру. */
const DEAD = new Map<number, { h: number; at: number }>();

const W_SW = (TAU / 1.15) ** 2;
const W_SW1 = TAU / 1.15;

function stateOf(m: Mob, pose: MobPose, wt: number): WS {
  const md = pose.mode;
  const t = pose.t || 0;
  let s = WST.get(m);
  if (!s) {
    s = { t: wt, mode: md, since: wt - t, x: 0, vx: 0, y: 0, vy: 0, tw: TW0, tw0: TW0, h: HANG };
    WST.set(m, s);
  }
  if (md !== s.mode) {
    if (md === 'f14_lock') s.tw0 = s.tw;
    if (md === 'dying') DEAD.set(m.id ?? 0, { h: s.h, at: wt });
    s.mode = md;
    s.since = wt - t;
  }
  const dt = clamp(wt - s.t, 0, 0.05);
  s.t = wt;
  if (md === 'f14_hang' || md === 'f14_lock' || md === 'chase') {
    const lock = md === 'f14_lock';
    const tx = lock ? 0 : clamp(-(m.vx ?? 0) * 1.7, -5, 5);
    const ty = lock ? 0 : clamp(-(m.vy ?? 0) * 1.0, -3, 3);
    const z = lock ? 0.75 : 0.16;
    const n = Math.ceil(dt / 0.008);
    const h = dt / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      s.vx += (W_SW * (tx - s.x) - 2 * z * W_SW1 * s.vx) * h;
      s.vy += (W_SW * (ty - s.y) - 2 * z * W_SW1 * s.vy) * h;
      s.x += s.vx * h;
      s.y += s.vy * h;
    }
  } else if (md !== 'f14_fall') {
    s.x = s.vx = s.y = s.vy = 0;
  }
  // Кручение: на цепи — туда-обратно; в замахе — к «лицу»; на подъёме — оборот.
  const id = m.id ?? 0;
  if (md === 'f14_lock') s.tw = lerp(s.tw0, TW0, easeOut(t / 0.1));
  else if (md === 'f14_up') s.tw = TW0 + TAU * sstep(0.12, 0.76, t);
  else if (md === 'f14_hang' || md === 'chase') {
    const th = wt - s.since;
    const A = 0.55 * (0.8 + 0.4 * hash(id, 3));
    const P = 2.6 + hash(id, 4) * 0.8;
    s.tw = TW0 + A * (1 - Math.exp(-th / 1.5)) * Math.sin((th / P) * TAU);
  } else s.tw = TW0;
  return s;
}

const twBucket = (tw: number) => ((Math.round(((tw - TW0) / TAU) * TWN) % TWN) + TWN) % TWN;

/** Живые искры/крошка в слой точек. */
function dotSparks(
  out: [number, number, string][],
  x: number,
  y: number,
  n: number,
  d: number,
  dir: number,
  spread: number,
  seed: number,
): void {
  for (let i = 0; i < n; i++) {
    const a = dir + (hash(seed, i, 1) - 0.5) * spread;
    const r = d * (0.5 + 0.5 * hash(seed, i, 2));
    out.push([
      Math.round(x + Math.cos(a) * r),
      Math.round(y + Math.sin(a) * r * 0.7),
      SPARK_S[i % 2],
    ]);
  }
}
function grit(out: [number, number, string][], x: number, y: number, H: number, k: number): void {
  for (let i = 0; i < 3; i++) {
    const ph = (k + i / 3) % 1;
    out.push([x + [-3, 1, 4][i], Math.round(y + 2 + ph * ph * Math.max(2, H - 2)), DUST_S[i]]);
  }
}

// ---------------------------------------------------------------------------
// Рисовальщик.
// ---------------------------------------------------------------------------

const FALL = WEIGHT.fall;
const LAND_T = LAND_N / 24;
const TIGHT_AT = WEIGHT.down - TIGHT_N / 24;
const PLAIN: MobPose = { ...WARM_POSE };

registerMobPainter('f14_weight', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const wt = wnow(pose);
  const v = visOf(m, pose, 0, 0);
  const s = stateOf(m, pose, wt);
  const ex: Partial<MobFrame> = { still: true, shadow: 0 };
  const dots: [number, number, string][] = [];
  let H = HANG;
  let anim = 'tw';
  let f = twBucket(s.tw);
  let ga = '';
  let gf = 0;
  let sway = 1;
  let dx = 0;
  let chainCut = 0;
  let top = -CH;
  if (md === 'f14_lock') {
    H =
      HANG +
      2 * easeOut(t / 0.035) +
      2 * easeOut((t - 0.07) / 0.035) +
      (t > 0.105 ? 0.6 * Math.sin((t - 0.105) * 40) * Math.exp(-(t - 0.105) * 12) : 0);
    if (t > 0.25) dx = fi(t, 99) % 2 ? 1 : -1;
  } else if (md === 'f14_fall') {
    const k = clamp01(t / FALL);
    H = TOP * (1 - k * k);
    sway = 1 - k;
    anim = 'fall';
    f = fi(t, 3);
  } else if (md === 'f14_down') {
    H = 0;
    if (t < LAND_T) {
      anim = 'land';
      f = fi(t, LAND_N - 1);
      ga = 'gl';
      gf = f;
    } else {
      ga = 'gr';
      gf = Math.floor((((t - LAND_T) / 1.2) % 1) * REST_N) % REST_N;
      if (t >= TIGHT_AT) {
        anim = 'tight';
        f = fi(t - TIGHT_AT, TIGHT_N - 1);
      } else {
        anim = 'rest';
        f = Math.floor((((t - LAND_T) / 1.6) % 1) * REST_N) % REST_N;
      }
    }
  } else if (md === 'f14_up') {
    H =
      t < 0.12
        ? 2 * easeOut(t / 0.12)
        : 2 + (HANG - 2) * sstep(0.12, 0.7, t) + 1.2 * Math.sin(clamp01((t - 0.7) / 0.1) * PI);
    ga = 'gu';
    gf = Math.min(5, Math.floor((t / WEIGHT.up) * 6));
    if (t > 0.12)
      dx = Math.round(
        1.6 *
          Math.sin((t - 0.12) * 9) *
          Math.exp(-(t - 0.12) * 3) *
          (hash(m.id ?? 0, 6) < 0.5 ? -1 : 1),
      );
  } else if (md === 'dying') {
    const d = DEAD.get(m.id ?? 0);
    H = (d ? d.h : 0) * (1 - clamp01(t / 0.08));
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ga = 'gd';
    gf = f;
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.66, DIE_T, t);
    // Цепь рвётся у ушка и уходит вверх.
    if (t > 0.12) chainCut = (t - 0.12) * 320;
    if (DEAD.size > 64) for (const [k, q] of DEAD) if (wt - q.at > 3) DEAD.delete(k);
  } else if (md === 'idle') {
    // Портрет бестиария: короткая цепь.
    top = -HANG - 34;
  }
  s.h = H;
  const age = hurtAge(v, now);
  // Звон удара: тело на точку прочь от героя, искры со стороны героя.
  let side = 0;
  if (age < 0.2 && md !== 'dying') {
    side = v.kx >= 0 ? -1 : 1;
    if (age < 0.07) dx += -side;
  }
  const bx = Math.round(s.x * sway) + dx;
  const by = Math.round(s.y * 0.6 * sway) - Math.round(H);
  const bodyF = frameOf(KBK, anim, f, 0, pose, () => bodyPic(anim, f));
  const gnd = ga ? frameOf(KGK, ga, gf, 0, PLAIN, () => gndPic(ga, gf)) : null;
  const [rx, ry] = ringOf(anim, f);
  const ringY = by + Math.round(ry);
  let chain: [number, number] | null = [bx + Math.round(rx), ringY];
  if (anim === 'die' && f > 9) chain = null;
  if (chain && chainCut > 0) {
    chain = [Math.round(chain[0] * Math.max(0, 1 - chainCut / 80)), Math.round(ringY - chainCut)];
    if (chain[1] <= top + 2) chain = null;
  }
  // Искры и крошка.
  if (md === 'f14_lock') {
    if ((t > 0.035 && t < 0.07) || (t > 0.105 && t < 0.14))
      dotSparks(dots, bx, ringY - 1, 3, 3, -PI / 2, 2.6, t < 0.07 ? 1 : 2);
    if (t > 0.23) grit(dots, bx, by, H, (t - 0.23) * 3.2);
  } else if (md === 'f14_up' && t < 0.4) grit(dots, bx, by, H, t * 2.6);
  else if (md === 'dying' && t > 0.12 && t < 0.2)
    dotSparks(dots, bx, by + Math.round(ringTop(1)), 4, 2 + (t - 0.12) * 60, -PI / 2, 3, 7);
  if (side)
    dotSparks(
      dots,
      bx + side * (R + 1),
      by - 6,
      5,
      1 + (age / 0.2) * 7,
      side > 0 ? 0 : PI,
      1.6,
      11,
    );
  const shK = clamp01(H / TOP);
  const lay: Lay = {
    bx,
    by,
    top,
    chain,
    shadow: md === 'idle' ? 0 : lerp(8.5, 4.4, shK),
    sa: lerp(0.42, 0.2, shK) * (md === 'dying' ? 1 - sstep(0.4, DIE_T, t) : 1),
    dots,
  };
  return { ...compose(m, bodyF, gnd, lay), ...ex };
});

// ---------------------------------------------------------------------------
// Прогрев: всё, что играет (сторона одна — гиря круглая).
// ---------------------------------------------------------------------------

const ONE = [0];
registerMobWarm('f14_weight', function* () {
  yield* warmAll(
    KBK,
    [
      ['tw', TWN, ONE],
      ['fall', 4, ONE],
      ['land', LAND_N, ONE],
      ['rest', REST_N, ONE],
      ['tight', TIGHT_N, ONE],
      ['die', DIE_N, ONE],
    ],
    bodyPic,
  );
  yield* warmAll(
    KGK,
    [
      ['gl', LAND_N, ONE],
      ['gr', REST_N, ONE],
      ['gu', 6, ONE],
      ['gd', DIE_N, ONE],
    ],
    gndPic,
  );
});
