// Этаж 7 — Стеклянный голем (анимации мобов 7). Тяжёлая фигура из граней
// голубого стекла: острая макушка, щит-осколок на левом предплечье,
// фиолетовая сердцевина в груди. Риг мини-3D (`f15-rig.ts`), 8 сторон
// честно, шаг по пройденному пути (вес переносится с ноги на ногу, руки
// ходят навстречу ногам). Трещины (`data.cracks`) — линиями на гранях груди
// (спереди или со спины — какая сторона видна), светятся изнутри.
//   • удар `slam` (0,85 с): руки вверх, держит, дрожь, сердцевина
//     разгорается — обрушивает кулаки; кадр контакта — первый кадр
//     `recover` (ровно урон и `boom`), пыль у кулаков, контакт на полу —
//     `f7_slam` (звезда трещин, осколки, кольцо пыли); застрял, медленно
//     выпрямляется;
//   • разрыв `rupture` (0,55 с): сжимается, трясётся, светится сквозь
//     трещины — на контакте руки в стороны, вспышка, искры (осколки
//     летят снарядами мозга);
//   • смерть: шатается, трещины расползаются, вспышка к 0,4 с (в такт
//     осколкам мозга) — разлетается кусками, они ложатся на пол и тают.

import {
  frameLRU,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
} from '../dungeon-paint';
import type { ImpactRec, MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { CE, F3, Rig, SE, vadd, vcross, vdot, vlen, vlerp, vmul, vnorm, vsub } from './f15-rig';
import type { Mat, RGBA, Tones, V3 } from './f15-rig';
import { Px } from '../dungeon-art';
import {
  PI,
  TAU,
  WHITE,
  alpha,
  clamp01,
  dir8,
  dither,
  dress,
  eIn,
  eOut,
  eOut3,
  fi,
  frameOf,
  hash,
  headOf,
  hurtFx,
  hx,
  kindOf,
  lerp,
  litOf,
  mixc,
  mod,
  moving,
  phaseOf,
  rigPic,
  smooth,
  sstep,
  tn,
  visOf,
  warmSteps,
  yawOfDir,
} from './f7-mobkit';
import type { Look, Pic } from './f7-mobkit';

const GL = tn('#1a2c54', '#3a68a6', '#7db6e6', '#e4f7ff');
const VIO = tn('#2a1650', '#5a2f9e', '#9a6ae0', '#e2d0ff');
const VIO_HOT = hx('#f0e4ff');
const CYAN_HOT = hx('#e0fbff');
const CRACK_D = hx('#0a0e1a');
const CRACK_L = hx('#e8faff');
const DUST = hx('#b8c8dc');
const SLEEP = hx('#2a3242');

const W = 58;
const H = 64;
const AX = 29;
const AY = 50;
/** Рост: риг строится в осях ×SC (радиусы капсул и шипов — тоже ×SC). */
const SC = 1.36;

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];
/** Грани: тон соседних граней чередуется — стекло «колется» на плоскости. */
const facet = (q: V3, l: number): RGBA => {
  if (l > 0.95) return WHITE;
  const a = Math.atan2(q[1], q[0]);
  const k = Math.floor((a + PI) / (PI / 3)) + (q[2] > 0.3 ? 1 : 0) + (q[2] < -0.45 ? 1 : 0);
  return band(GL, l + (k % 2 ? 0.17 : -0.1));
};
const CRY: Mat = { T: GL, pat: facet };
const LIMB: Mat = { T: GL, bias: -0.04 };

// ---- Поза --------------------------------------------------------------------------------

interface GP {
  zH: number;
  lean: number;
  roll: number;
  twist: number;
  head: number;
  /** Ступни и кисти в осях курса (вперёд, вправо, высота над полом). */
  lF: V3;
  rF: V3;
  lH: V3;
  rH: V3;
  /** Сердцевина 0…1, свечение тела сквозь трещины 0…1. */
  core: number;
  hot: number;
  /** Пыль у кулаков, искры разрыва (фаза 0…1, 0 — нет). */
  dust: number;
  spray: number;
}
const REST: GP = {
  zH: 12,
  lean: 0.06,
  roll: 0,
  twist: 0,
  head: 0,
  lF: [0, -2.8, 0],
  rF: [0, 2.8, 0],
  lH: [1.4, -6.8, 10.8],
  rH: [1.4, 6.8, 10.8],
  core: 0.35,
  hot: 0,
  dust: 0,
  spray: 0,
};
const lv = (a: V3, b: V3, k: number): V3 => vlerp(a, b, k);
function mixPose(a: GP, b: GP, k: number): GP {
  return {
    zH: lerp(a.zH, b.zH, k),
    lean: lerp(a.lean, b.lean, k),
    roll: lerp(a.roll, b.roll, k),
    twist: lerp(a.twist, b.twist, k),
    head: lerp(a.head, b.head, k),
    lF: lv(a.lF, b.lF, k),
    rF: lv(a.rF, b.rF, k),
    lH: lv(a.lH, b.lH, k),
    rH: lv(a.rH, b.rH, k),
    core: lerp(a.core, b.core, k),
    hot: lerp(a.hot, b.hot, k),
    dust: k < 0.5 ? a.dust : b.dust,
    spray: k < 0.5 ? a.spray : b.spray,
  };
}

/** Два звена: сустав от `a` к `b` (длины L1, L2), сгиб — в сторону `pole`. */
function ik(a: V3, b: V3, L1: number, L2: number, pole: V3): [V3, V3] {
  const d = vsub(b, a);
  const dl = Math.max(1e-6, vlen(d));
  const len = Math.min(dl, (L1 + L2) * 0.999);
  const u = vmul(d, 1 / dl);
  const end = vadd(a, vmul(u, len));
  const x = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const pp = vsub(pole, vmul(u, vdot(pole, u)));
  const pl = vlen(pp);
  const pn: V3 = pl > 1e-6 ? vmul(pp, 1 / pl) : [0, 0, 1];
  return [vadd(vadd(a, vmul(u, x)), vmul(pn, h)), end];
}

// ---- Трещины: ломаные на гранях груди (вправо, вверх) по уровням ---------------------

const CRACKS: [number, [number, number][]][] = [
  [
    1,
    [
      [-1.2, 11.6],
      [-0.5, 10.2],
      [-1.4, 8.9],
      [-0.6, 7.4],
      [-1.5, 5.9],
    ],
  ],
  [
    1,
    [
      [-0.5, 10.2],
      [1.0, 10.9],
    ],
  ],
  [
    2,
    [
      [2.4, 11.4],
      [1.6, 9.8],
      [2.9, 8.2],
      [2.1, 6.2],
    ],
  ],
  [
    2,
    [
      [-3.8, 9.4],
      [-2.4, 8.6],
      [-2.9, 7.2],
    ],
  ],
  [
    2,
    [
      [1.6, 9.8],
      [0.5, 9.2],
    ],
  ],
  [
    3,
    [
      [-0.6, 7.4],
      [0.8, 6.4],
      [0.3, 5.0],
    ],
  ],
  [
    3,
    [
      [2.9, 8.2],
      [4.1, 7.5],
    ],
  ],
  [
    3,
    [
      [-2.4, 8.6],
      [-1.3, 9.6],
      [-2.0, 11.4],
    ],
  ],
];
const CH_C: V3 = [0.3, 0, 8.4];
const CH_R: V3 = [3.3, 5.0, 3.9];
const chestF = (s: number, u: number, back: boolean) => {
  const k = Math.sqrt(Math.max(0, 1 - (s / CH_R[1]) ** 2 - ((u - CH_C[2]) / CH_R[2]) ** 2));
  return back ? CH_C[0] - CH_R[0] * k - 0.15 : CH_C[0] + CH_R[0] * k + 0.15;
};

interface GPic extends Pic {
  /** Трещины в точках кадра: уровень и ломаная. */
  cr: [number, [number, number][]][];
}

function golemRig(o: GP, yaw: number): { r: Rig; T: F3; B: F3 } {
  const r = new Rig();
  const B = F3.yaw(yaw).scale(SC);
  const T = B.at(0, 0, o.zH).turn(o.twist).pitch(o.lean).roll(o.roll);
  // Ноги: бедро — колено (вперёд) — ступня-плита.
  for (const sd of [-1, 1]) {
    const F = sd < 0 ? o.lF : o.rF;
    const hip = B.p(0, sd * 2.4, o.zH - 0.6);
    const [knee, ank] = ik(
      hip,
      B.p(F[0], F[1], F[2] + 1.8),
      6.2 * SC,
      5.8 * SC,
      B.v(1, sd * 0.25, 0),
    );
    r.cap(hip, knee, 2.3 * SC, 1.9 * SC, LIMB);
    r.cap(knee, ank, 1.9 * SC, 2.1 * SC, LIMB);
    r.spike(knee, B.v(1, sd * 0.3, 0.35), 1.7 * SC, 1.0 * SC, CRY, 4);
    r.ell(new F3(vadd(ank, [0, 0, -0.9 * SC]), B.f, B.s, B.u), [0.9, 0, 0], [2.8, 2.0, 1.1], CRY);
  }
  // Таз, пояс, грудь-кристалл, наплечники с шипами.
  r.ell(T, [0, 0, 0.4], [2.3, 3.4, 1.9], LIMB);
  r.cap(T.p(0, 0, 1.2), T.p(0.3, 0, 5.2), 2.3 * SC, 2.9 * SC, LIMB);
  r.ell(T, CH_C, CH_R, CRY);
  for (const sd of [-1, 1]) {
    r.ell(T, [0.1, sd * 5.0, 10.6], [2.3, 2.1, 1.8], CRY);
    r.spike(T.p(0, sd * 5.2, 11.4), T.v(-0.15, sd * 0.45, 1), 3.6 * SC, 1.6 * SC, CRY, 4, PI / 4);
  }
  // Сердцевина: свет изнутри груди.
  const coreM: Mat = { T: VIO, glow: 0.35 + 0.65 * o.core, bias: 0.25 + 0.3 * o.core, soft: true };
  r.ball(T.p(3.0, 0, 8.7), 1.35 * SC, coreM);
  r.dot(T.p(3.7, 0, 8.9), alpha(VIO_HOT, 0.5 + 0.5 * o.core), o.core, 1, 1);
  // Голова: шар и острая макушка, глаз-щель.
  const Hd = T.at(0.7, 0, 12.9).pitch(o.head);
  r.ell(Hd, [0, 0, 0], [2.3, 2.4, 2.5], CRY);
  r.spike(Hd.p(-0.3, 0, 1.3), Hd.v(-0.2, 0, 1), 4.2 * SC, 2.0 * SC, CRY, 4, PI / 4);
  const eye = Hd.p(2.0, 0, 0.3);
  r.dot(eye, CYAN_HOT, 1, 1, 1);
  r.eye = eye;
  // Руки: плечо — локоть (назад и вниз) — кулак; на левой — щит-осколок.
  for (const sd of [-1, 1]) {
    const sh = T.p(0.2, sd * 5.4, 9.8);
    const Hn = sd < 0 ? o.lH : o.rH;
    const [el, hd] = ik(
      sh,
      B.p(Hn[0], Hn[1], Hn[2]),
      6.2 * SC,
      6.4 * SC,
      vadd(T.v(-1, sd * 0.5, 0), [0, 0, -0.4]),
    );
    r.cap(sh, el, 1.9 * SC, 1.6 * SC, LIMB);
    r.cap(el, hd, 1.7 * SC, 2.0 * SC, LIMB);
    r.ball(hd, (sd < 0 ? 2.0 : 2.3) * SC, CRY);
    if (sd < 0) {
      const f = vnorm(vsub(hd, el));
      let side = vcross([0, 0, 1], f);
      side = vlen(side) > 0.1 ? vnorm(side) : B.s;
      const up = vcross(f, side);
      const c = vadd(vlerp(el, hd, 0.45), vmul(side, -1.7 * SC));
      r.ell(new F3(c, f, side, up), [0, 0, 0], [4.3 * SC, 1.1 * SC, 3.2 * SC], {
        T: GL,
        pat: facet,
        bias: 0.08,
      });
    }
  }
  return { r, T, B };
}

const VIEW: V3 = [0, CE, SE];

function golemPic(o: GP, d: number): GPic {
  const { r, T, B } = golemRig(o, yawOfDir(d));
  const cr: GPic['cr'] = [];
  const pc = rigPic(r, W, H, AX, AY, { outline: INK_G, inner: 2.6 }, (out, P) => {
    // Трещины видимой стороны груди — в точки кадра.
    const back = vdot(T.f, VIEW) < -0.05;
    for (const [lvl, pts] of CRACKS)
      cr.push([lvl, pts.map(([s, u]) => P(T.p(chestF(s, u, back), back ? -s : s, u)))]);
    const L = o.hot > 0 || o.dust > 0 || o.spray > 0 ? litOf(out) : null;
    // Свечение тела (разрыв, смерть): точки силуэта поверх темноты.
    if (L && o.hot > 0)
      for (let y = 0; y < out.p.h; y++)
        for (let x = 0; x < out.p.w; x++)
          if (out.p.solid(x, y))
            L.set(x, y, alpha(o.hot > 0.85 ? WHITE : CYAN_HOT, 0.12 + 0.7 * o.hot));
    // Пыль у кулаков: кольцо точек по полу, растёт и редеет.
    if (o.dust > 0)
      for (const Hn of [o.lH, o.rH]) {
        const [cx, cy] = P(B.p(Hn[0], Hn[1], 0.3));
        const R = (2 + 7 * eOut(o.dust)) * SC;
        const n = 9;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + Hn[1] * 0.3;
          if (hash(i, d, 7) < o.dust * 0.7) continue;
          out.p.set(
            cx + Math.cos(a) * R,
            cy + Math.sin(a) * R * 0.55,
            alpha(DUST, 0.9 - 0.6 * o.dust),
          );
        }
      }
    // Искры разрыва: брызги от сердцевины во все стороны (поверх темноты).
    if (L && o.spray > 0) {
      const [cx, cy] = P(T.p(3, 0, 8.7));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU + hash(i, d, 3) * 0.4;
        const R = 3 + 16 * eOut(o.spray) * (0.7 + 0.5 * hash(i, d, 4));
        const x = cx + Math.cos(a) * R;
        const y = cy + Math.sin(a) * R * 0.8;
        L.set(x, y, alpha(i % 3 ? CYAN_HOT : VIO_HOT, 1 - o.spray * 0.8));
      }
    }
  });
  return { ...pc, cr };
}
const INK_G = alpha(hx('#0b1430'), 0.95);

/** Трещины уровня ≤ `n` (у смерти — и третий, длиной `grow`), свет изнутри `glow`. */
function crackify(b: GPic, n: number, glow: number, grow = 1): Pic {
  if (n <= 0 && grow <= 0) return b;
  const p = new Px(b.p.w, b.p.h);
  p.data.set(b.p.data);
  let lit = b.lit;
  const gl = Math.min(1, (n >= 2 ? 0.5 : 0.32) + glow);
  if (gl > 0) {
    lit = new Px(b.p.w, b.p.h);
    if (b.lit) lit.data.set(b.lit.data);
  }
  for (const [lvl, pts] of b.cr) {
    if (lvl > n && !(lvl === 3 && grow > 0)) continue;
    // Третий уровень (смерть) растёт по длине.
    const upto = lvl === 3 ? grow * (pts.length - 1) : pts.length - 1;
    for (let i = 0; i < upto; i++) {
      const k = Math.min(1, upto - i);
      const [x0, y0] = pts[i];
      const x1 = lerp(x0, pts[i + 1][0], k);
      const y1 = lerp(y0, pts[i + 1][1], k);
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(lerp(x0, x1, s / steps));
        const y = Math.round(lerp(y0, y1, s / steps));
        if (!b.p.solid(x, y)) continue;
        p.set(x, y, CRACK_D);
        if (b.p.solid(x - 1, y - 1)) p.set(x - 1, y - 1, mixc(b.p.get(x - 1, y - 1), CRACK_L, 0.7));
        if (lit) lit.set(x, y, alpha(VIO_HOT, gl));
      }
    }
  }
  return { p, lit, ax: b.ax, ay: b.ay, eye: b.eye };
}

// ---- Позы во времени ---------------------------------------------------------------------

const CYCLE = 1.2;
const WALK_N = 8;
function walkPose(i: number): GP {
  const ph = (i / WALK_N) * TAU;
  const c = Math.cos(ph);
  const s = Math.sin(ph);
  return {
    ...REST,
    zH: 12 - 0.8 * ((1 + Math.cos(2 * ph)) / 2),
    lean: 0.12,
    roll: 0.06 * s,
    twist: 0.1 * c,
    lF: [-3.2 * c, -2.8, 2.0 * Math.max(0, s)],
    rF: [3.2 * c, 2.8, 2.0 * Math.max(0, -s)],
    lH: [1.4 + 2.4 * c, -6.8, 10.8 + 0.6 * Math.max(0, c)],
    rH: [1.4 - 2.4 * c, 6.8, 10.8 + 0.6 * Math.max(0, -c)],
  };
}

const IDLE_N = 8;
function idlePose(i: number): GP {
  const b = Math.sin((i / IDLE_N) * TAU);
  return {
    ...REST,
    zH: 12 + 0.25 * b,
    lean: 0.05 + 0.02 * b,
    head: 0.04 * b,
    lH: [1.4, -6.8, 10.8 + 0.35 * b],
    rH: [1.4, 6.8, 10.8 + 0.35 * b],
    core: 0.3 + 0.18 * (b + 1),
  };
}

const UP: GP = {
  ...REST,
  zH: 12.6,
  lean: -0.22,
  head: -0.22,
  lF: [-0.8, -3.0, 0],
  rF: [1.8, 3.0, 0],
  lH: [-1.4, -2.2, 33],
  rH: [-1.4, 2.2, 33],
  core: 1,
};
const HIT: GP = {
  ...UP,
  zH: 8.6,
  lean: 0.66,
  head: 0.3,
  lH: [11, -1.8, 3.2],
  rH: [11, 1.8, 3.2],
  hot: 0.5,
  dust: 0.12,
};

const SLAM_N = 21;
/** Удар: `windup` мозга — режим `slam` 0…0,85 с (кадры 0…20). */
function slamPose(f: number): GP {
  const t = (f + 0.5) / 24;
  const k1 = eOut3(clamp01(t / 0.38));
  const o = mixPose(REST, UP, k1);
  o.core = lerp(0.35, 1, sstep(0.1, 0.72, t));
  if (t > 0.38 && t < 0.72) {
    const tr = (f % 2 ? 1 : -1) * 0.4 * sstep(0.38, 0.7, t);
    o.lH = vadd(o.lH, [0, 0, tr]);
    o.rH = vadd(o.rH, [0, 0, -tr]);
    o.roll = tr * 0.04;
  }
  if (t > 0.72) {
    // Обрушение дугой через перёд (кривая Безье): кулаки идут по кругу.
    const k = eIn(clamp01((t - 0.72) / 0.13));
    const arc = (a: V3, b: V3, cc: V3): V3 =>
      vadd(vadd(vmul(a, (1 - k) ** 2), vmul(cc, 2 * k * (1 - k))), vmul(b, k * k));
    const m = mixPose(UP, HIT, k);
    m.lH = arc(UP.lH, HIT.lH, [12, -2, 31]);
    m.rH = arc(UP.rH, HIT.rH, [12, 2, 31]);
    m.hot = 0;
    m.dust = 0;
    return m;
  }
  return o;
}

/** Номер кадра отдыха: первые 8 — 24 к/с, дальше — по два (12 к/с). */
const REC_N = 15;
const recF = (t: number) => {
  const f = fi(t, 21);
  return f < 8 ? f : 8 + ((f - 8) >> 1);
};
const recT = (f: number) => (f < 8 ? (f + 0.5) / 24 : (8 + 2 * (f - 8) + 1) / 24);

/** После удара: кадр 0 — контакт (кулаки в полу, пыль), застрял, выпрямляется. */
function slamRec(f: number): GP {
  const t = recT(f);
  if (t < 0.3) {
    const o = { ...HIT };
    o.zH = 8.6 + 0.35 * sstep(0, 0.3, t);
    o.dust = 0.12 + 0.88 * clamp01(t / 0.3);
    o.hot = 0.5 * (1 - clamp01(t / 0.15));
    o.core = lerp(1, 0.6, clamp01(t / 0.3));
    return o;
  }
  const o = mixPose(
    { ...HIT, zH: 8.95, hot: 0, dust: 0, core: 0.6 },
    REST,
    smooth((t - 0.3) / 0.6),
  );
  return o;
}

const RUP_N = 14;
function rupPose(f: number): GP {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.25));
  const o = mixPose(
    REST,
    { ...REST, zH: 11, lean: 0.24, head: 0.18, lH: [3.6, -3.0, 19], rH: [3.6, 3.0, 19] },
    k,
  );
  o.roll = (f % 2 ? 1 : -1) * 0.05 * sstep(0.1, 0.5, t);
  o.core = lerp(0.4, 1, t / 0.55);
  o.hot = 0.8 * sstep(0.2, 0.55, t);
  return o;
}
const BURST: GP = {
  ...REST,
  zH: 12.6,
  lean: -0.28,
  head: -0.35,
  lH: [1, -12, 21],
  rH: [1, 12, 21],
  core: 1,
  hot: 1,
  spray: 0.08,
};
function rupRec(f: number): GP {
  const t = recT(f);
  if (t < 0.25) return { ...BURST, spray: 0.08 + 0.92 * (t / 0.25), hot: clamp01(1 - t / 0.2) };
  return mixPose({ ...BURST, hot: 0, spray: 0 }, REST, smooth((t - 0.25) / 0.65));
}

const DIE_N = 22;
const DIE_T = 0.92;
function deathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.3));
  const o = mixPose(
    REST,
    { ...REST, zH: 10.6, lean: 0.2, head: 0.35, lH: [1, -7.4, 7], rH: [1.6, 7.2, 6] },
    k,
  );
  o.roll = 0.08 * k;
  o.core = f % 3 === 1 ? 0.05 : 1;
  o.hot = t < 0.38 ? 0.3 * sstep(0.1, 0.38, t) : t < 0.46 ? 1 : 0;
  const ex = clamp01((t - 0.42) / 0.5);
  const b = golemPic(o, d);
  let pc: Pic;
  if (ex <= 0) pc = crackify(b, 2, 0.2 + 0.6 * (t / 0.42), clamp01(t / 0.38));
  else {
    // Разлёт: части рига летят от груди и ложатся на пол.
    const { r, T } = golemRig({ ...o, hot: 0 }, yawOfDir(d));
    r.explode(eOut(ex), T.p(0, 0, 8), 3 + d, 13, 34, 0, 0.45);
    const cpc = rigPic(r, W, H, AX, AY, { outline: INK_G, inner: 2.6 });
    pc = { ...cpc, lit: ex < 0.15 ? cpc.lit : null };
    if (ex < 0.12) {
      const L = new Px(cpc.p.w, cpc.p.h);
      for (let y = 0; y < L.h; y++)
        for (let x = 0; x < L.w; x++) if (cpc.p.solid(x, y)) L.set(x, y, alpha(CYAN_HOT, 0.6));
      pc.lit = L;
    }
  }
  const fade = 1 - sstep(0.62, DIE_T, t);
  return { ...pc, p: dither(pc.p, fade, f), eye: ex > 0 ? null : pc.eye };
}

// ---- Кеш: картинка позы (без трещин) → вариант с трещинами → кадр ------------------------

const K = kindOf('f7_golem', 2000, 0.12);
const BASE = frameLRU<GPic>(640);
const base = (key: string, build: () => GPic): GPic => BASE.get(key) ?? BASE.set(key, build());
function gframe(key: string, n: number, look: Look, pose: () => GP, d: number, glow = 0): MobFrame {
  return frameOf(K, `${key}|c${n}`, false, look, () =>
    crackify(
      base(key, () => golemPic(pose(), d)),
      n,
      glow,
      0,
    ),
  );
}

registerMobPainter('f7_golem', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = Math.max(0, pose.t || 0);
  const now = pose.now || 0;
  const busy = mode === 'slam' || mode === 'rupture' || mode === 'recover' || mode === 'dying';
  const v = visOf(m, pose, busy ? (m.face ?? 0) : headOf(m), busy ? 6 : 3.2);
  const d = dir8(v.yaw);
  const n = Math.max(0, Math.min(2, m.data?.cracks ?? 0));
  const look = pose.look;
  const ex: Partial<MobFrame> = { still: true, shadow: 10 };
  let fr: MobFrame;
  if (mode === 'dying') {
    const f = fi(t, DIE_N - 1);
    fr = frameOf(K, `x|${d}|${f}`, false, look, () => deathPic(d, f));
    ex.linger = DIE_T;
    if (t > 0.45) ex.shadow = 0;
  } else if (mode === 'slam') {
    const f = fi(t, SLAM_N - 1);
    fr = gframe(`s|${d}|${f}`, n, look, () => slamPose(f), d);
  } else if (mode === 'recover' && v.prev === 'rupture') {
    const f = recF(t);
    fr = gframe(`q|${d}|${f}`, n, look, () => rupRec(f), d);
  } else if (mode === 'recover') {
    const f = recF(t);
    fr = gframe(`r|${d}|${f}`, n, look, () => slamRec(f), d);
    if (f === 0) {
      ex.sx = 1.05;
      ex.sy = 0.95;
    }
  } else if (mode === 'rupture') {
    const f = fi(t, RUP_N - 1);
    fr = gframe(`u|${d}|${f}`, n, look, () => rupPose(f), d, 0.5 * (f / RUP_N));
  } else if (mode === 'sleep') {
    fr = frameOf(K, `z|${d}|c${n}`, false, look, () => {
      const b = crackify(
        base(`i|${d}|0`, () => golemPic(idlePose(0), d)),
        n,
        0,
        0,
      );
      const p = new Px(b.p.w, b.p.h);
      for (let y = 0; y < p.h; y++)
        for (let x = 0; x < p.w; x++)
          if (b.p.solid(x, y)) p.set(x, y, mixc(b.p.get(x, y), SLEEP, 0.4));
      return { ...b, p, lit: null, eye: null };
    });
  } else if (mode === 'f7_step') {
    const f = fi(t, 11);
    fr = frameOf(K, `e|${d}|${f}`, false, look, () => {
      const b = base(`i|${d}|0`, () => golemPic(idlePose(0), d));
      return { ...b, p: dither(b.p, 0.12 + 0.88 * smooth((f + 1) / 12), f), lit: null };
    });
  } else if (moving(m, 0.3)) {
    const i = mod((v.dist / CYCLE) * WALK_N, WALK_N);
    fr = gframe(`w|${d}|${i}`, n, look, () => walkPose(i), d);
  } else {
    const i = mod(now * (IDLE_N / 2.4) + phaseOf(m) * IDLE_N, IDLE_N);
    fr = gframe(`i|${d}|${i}`, n, look, () => idlePose(i), d);
  }
  hurtFx(v, now, 1, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_golem', () => {
  const steps: (() => unknown)[] = [];
  const look: Look = 'normal';
  for (let d = 0; d < 8; d++)
    for (let n = 0; n < 3; n++) {
      for (let i = 0; i < WALK_N; i++)
        steps.push(() => gframe(`w|${d}|${i}`, n, look, () => walkPose(i), d));
      for (let i = 0; i < IDLE_N; i++)
        steps.push(() => gframe(`i|${d}|${i}`, n, look, () => idlePose(i), d));
      for (let f = 0; f < SLAM_N; f++)
        steps.push(() => gframe(`s|${d}|${f}`, n, look, () => slamPose(f), d));
      for (let f = 0; f < REC_N; f++)
        steps.push(() => gframe(`r|${d}|${f}`, n, look, () => slamRec(f), d));
      if (n < 2)
        for (let f = 0; f < RUP_N; f++)
          steps.push(() => gframe(`u|${d}|${f}`, n, look, () => rupPose(f), d, 0.5 * (f / RUP_N)));
      if (n > 0)
        for (let f = 0; f < REC_N; f++)
          steps.push(() => gframe(`q|${d}|${f}`, n, look, () => rupRec(f), d));
    }
  for (let d = 0; d < 8; d++)
    for (let f = 0; f < DIE_N; f++)
      steps.push(() => frameOf(K, `x|${d}|${f}`, false, look, () => deathPic(d, f)));
  return warmSteps(steps);
});

// ---- Контакт удара на полу: звезда трещин, осколки, кольцо пыли --------------------------

const rnd = (s: number, i: number) => hash(s, i, 71);
function dot(g: CanvasRenderingContext2D, x: number, y: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), 1, 1);
}
registerImpactPainter('f7_slam', {
  life: 0.75,
  shake: 0.32,
  paint: (
    g: CanvasRenderingContext2D,
    rec: ImpactRec,
    px: number,
    py: number,
    S: number,
    age: number,
  ) => {
    const R = (rec.r ?? 1.3) * S;
    const sd = rec.seed >>> 0;
    const k = eOut(clamp01(age / 0.1));
    const fade = 1 - sstep(0.3, 0.75, age);
    g.globalAlpha = fade;
    // Звезда трещин: лучи с изломом, тёмная щель и светлая кромка.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + rnd(sd, i) * 0.6;
      const L = R * (0.5 + 0.4 * rnd(sd, i + 9)) * k;
      const kink = (rnd(sd, i + 20) - 0.5) * 0.7;
      for (let s = 2; s < L; s++) {
        const aa = a + (s > L * 0.5 ? kink : 0);
        const x = px + Math.cos(aa) * s;
        const y = py + Math.sin(aa) * s;
        dot(g, x, y, '#0b1426');
        if (s % 2 === 0) dot(g, x - Math.sin(aa), y + Math.cos(aa) * -1, '#bfe6ff');
      }
    }
    // Кольцо пыли: растёт и редеет.
    const rr = R * (0.35 + 0.75 * eOut(clamp01(age / 0.5)));
    g.globalAlpha = fade * (1 - clamp01(age / 0.6));
    for (let i = 0; i < 28; i++) {
      if (rnd(sd, i + 40) < age) continue;
      const a = (i / 28) * TAU;
      dot(g, px + Math.cos(a) * rr, py + Math.sin(a) * rr, '#b8c8dc');
    }
    // Осколки: подлетают и падают (высота — вверх по экрану).
    g.globalAlpha = fade;
    for (let i = 0; i < 10; i++) {
      const a = rnd(sd, i + 60) * TAU;
      const sp = R * (0.5 + 0.6 * rnd(sd, i + 70));
      const tt = Math.min(age, 0.5);
      const hgt = Math.max(0, 22 * tt - 70 * tt * tt) * (0.6 + 0.6 * rnd(sd, i + 80));
      const x = px + Math.cos(a) * sp * eOut(clamp01(age / 0.5));
      const y = py + Math.sin(a) * sp * eOut(clamp01(age / 0.5)) - hgt;
      dot(g, x, y, i % 3 ? '#cfefff' : '#ffffff');
      if (hgt > 1) dot(g, x, y + 1, '#5a86c0');
    }
    g.globalAlpha = 1;
    return true;
  },
});
