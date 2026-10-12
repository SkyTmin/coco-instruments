// Облачная медуза (анимации мобов 11): полупрозрачный купол с облачками
// внутри и фестонами по краю, глазки спереди, три ротовые лопасти и семь
// нитей-щупалец с бирюзовыми огоньками на концах. Мини-3D (`f15-rig.ts`),
// 8 сторон честно; техники — 24 к/с от `pose.t`.
//
// Плывёт толчками: купол сжимается (выталкивает воду — тут воздух) и
// подскакивает, потом медленно раскрывается; щупальца отстают от купола на
// два-три кадра — тянутся при толчке и расходятся юбкой при раскрытии.
// Плывёт куполом вперёд (наклон по ходу), щупальца — шлейфом сзади. Фаза толчков
// — от `m.id`: стая не дышит в лад. Ветер её носит — купол от этого не
// гребёт чаще (толчки идут по времени).
//
// Метроном — `f11-brains.ts` (`f11_jelly`, `JELLY`):
// - `f11_zap` 0,95 с: сжалась, подобрала щупальца (замах) → раскрылась
//   парашютом, щупальца разошлись кольцом в стороны, внутри купола копится
//   гроза (жёлтые молнии, искры бегут по нитям к концам) → замок (последние
//   0,25 с — в мозге `danger`): концы нитей белые, купол дрожит и светится;
// - контакт — первый кадр `recover`: разряд — купол белый, нити выброшены,
//   с концов бьют молнии; кольцо разряда по земле и над темнотой — контакт
//   `f11_zapring` (здесь же); затем купол схлопнулся и подпрыгнул, нити
//   опали; `recover` 1,0 с — разряжена: серая, обмякла, опустилась ниже,
//   глаза прикрыты; к концу цвет и высота возвращаются;
// - удар героя — 6 кадров: купол вмят и колышется, нити разметало;
// - смерть 0,9 с: раздулась → лопнула (белые брызги), нити и лопасти падают
//   на пол и тают; облачко на месте — зона мозга `f11_puff` (здесь же).

import {
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerZonePainter,
} from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob, Zone } from '../dungeon-sim';
import { JELLY } from './f11-brains';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  WHITE,
  alpha,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  lerp,
  mixc,
  moving,
  put,
  spark2,
  spray,
  sstep,
  tn,
  vadd,
  visOf,
  vmul,
  vnorm,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RGBA, RigOut, Tones, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const withA = (T: Tones, a: number): Tones => [
  alpha(T[0], a / 255),
  alpha(T[1], a / 255),
  alpha(T[2], a / 255),
  alpha(T[3], a / 255),
];
const mixT = (A: Tones, B: Tones, k: number): Tones => [
  mixc(A[0], B[0], k),
  mixc(A[1], B[1], k),
  mixc(A[2], B[2], k),
  mixc(A[3], B[3], k),
];
const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

const BELL = tn('#6a80b0', '#98b0dc', '#c4d6f2', '#eef4ff');
const BELL_DRAIN = tn('#56607a', '#7e889e', '#a2acbe', '#c8d0dc');
const BELL_STORM = tn('#9a9a70', '#d8d49a', '#f4f0c0', '#ffffff');
const ORAL = withA(tn('#7a7eb8', '#a8acdc', '#d4d6f4', '#f4f4ff'), 186);
const ZAP = hx('#fff27a');
const CYAN = hx('#7af6ff');
const NIT_A = hx('#7c9ccc');
const NIT_B = hx('#9ab8e4');
const EDGE = hx('#44557a');
const EYE = hx('#150f0b', 225);
const DROPS: RGBA[] = [
  hx('#ffffff', 230),
  hx('#dce6f6', 210),
  hx('#a0d0ff', 190),
  hx('#e0f8ff', 220),
];

/** Облачка внутри купола — точки на единичной сфере купола и их «радиус» (cos). */
const CLOUDS: [V3, number][] = [
  [vnorm([0.62, -0.42, 0.35]), 0.935],
  [vnorm([0.3, 0.38, 0.72]), 0.94],
  [vnorm([0.72, 0.36, 0.05]), 0.95],
  [vnorm([-0.3, -0.5, 0.6]), 0.94],
];

// ---- Поза ------------------------------------------------------------------------

interface JeO {
  /** Ширина и высота купола (1 — обычные), подъём (пикс рига), наклон по ходу (рад). */
  w: number;
  h: number;
  dz: number;
  tilt: number;
  /** Волна по нитям: фаза 0…1, размах (пикс); шлейф назад; разлёт в стороны 0…1; длина. */
  ph: number;
  wave: number;
  trail: number;
  spread: number;
  len: number;
  /** Гроза внутри 0…1, разряжена 0…1, купол белый 0…1. */
  charge: number;
  drain: number;
  white: number;
  /** Глаза: 0 — открыты, −1 — прикрыты, 2 — горят. */
  eyes: number;
  /** Искры бегут по нитям 0…1; огоньки на концах: 0 — бирюза, 1 — жёлтые, 2 — белые. */
  sparks: number;
  tips: number;
  /** Молнии с концов (разряд) 0…1. */
  bolts: number;
  /** Дрожь: сдвиг всего тела (пикс). */
  shake: number;
  /** Смерть: купол раздут (1 — норм), лопнул, нити упали 0…1. */
  pop: boolean;
  fall: number;
  /** Кадр — для мелькания молний. */
  f: number;
}

const base = (): JeO => ({
  w: 1,
  h: 1,
  dz: 0,
  tilt: 0,
  ph: 0,
  wave: 1,
  trail: 0.6,
  spread: 0.2,
  len: 1,
  charge: 0,
  drain: 0,
  white: 0,
  eyes: 0,
  sparks: 0,
  tips: 0,
  bolts: 0,
  shake: 0,
  pop: false,
  fall: 0,
  f: 0,
});

/** Толчок купола по фазе цикла 0…1: быстрое сжатие, медленное раскрытие. */
const stroke = (p: number) => {
  const x = ((p % 1) + 1) % 1;
  return x < 0.22 ? easeOut(x / 0.22) : 1 - sstep(0.22, 1, x);
};

const LOOP = 16;
function swimO(f: number, move: boolean): JeO {
  const o = base();
  const p = f / LOOP;
  const c = stroke(p);
  const c2 = stroke(p - 0.14);
  o.w = 1 - 0.15 * c;
  o.h = 1 + 0.1 * c;
  o.dz = 1.1 * c;
  o.len = 1 - 0.1 * c2;
  o.spread = 0.12 + 0.2 * (1 - c2);
  o.ph = p;
  o.trail = move ? 3.8 + 2 * c2 : 0.6;
  o.tilt = move ? 0.26 : 0;
  o.f = f;
  return o;
}

const ZAP_T = JELLY.zap;

function zapO(t: number, f: number): JeO {
  const o = base();
  const A = sstep(0, 0.2, t) * (1 - sstep(0.22, 0.42, t));
  const E = sstep(0.22, 0.6, t);
  const L = sstep(ZAP_T - 0.27, ZAP_T - 0.19, t);
  o.w = 1 - 0.2 * A + 0.14 * E;
  o.h = 1 + 0.13 * A - 0.13 * E;
  o.dz = -0.8 * A + 1.4 * E;
  o.len = 1 - 0.38 * A + 0.08 * E;
  o.spread = 0.15 + 0.85 * E;
  o.trail = 0;
  o.charge = sstep(0.15, ZAP_T - 0.22, t);
  o.white = 0.5 * sstep(ZAP_T - 0.1, ZAP_T - 0.02, t);
  o.sparks = sstep(0.28, 0.5, t);
  o.tips = L > 0.5 ? 2 : E > 0.5 ? 1 : 0;
  o.eyes = A > 0.5 ? -1 : L > 0.5 ? 2 : 0;
  o.ph = t * 2.2;
  o.wave = 0.6 * (1 - E) + 0.5 * L;
  o.shake = L * (f % 2 ? 0.55 : -0.55);
  o.f = f;
  return o;
}

function recO(t: number, f: number): JeO {
  const o = base();
  const D = t < 0.06 ? 1 : 1 - sstep(0.06, 0.2, t);
  const S = sstep(0.08, 0.3, t) * (1 - sstep(0.62, 0.98, t));
  const snap = sstep(0.04, 0.22, t);
  o.w = 1 - 0.2 * D + 0.06 * S;
  o.h = 1 + 0.13 * D - 0.08 * S;
  o.dz = 1.6 * D * (1 - D) * 4 - 1.2 * S;
  o.spread = lerp(1, 0.06, snap) + 0.14 * sstep(0.62, 0.98, t);
  o.len = 1 + 0.08 * S;
  o.wave = lerp(1, 0.3, S);
  o.trail = 0;
  o.ph = 0.3 + t * 0.8;
  o.charge = D;
  o.white = t < 0.05 ? 1 : 0;
  o.drain = S;
  o.tips = t < 0.05 ? 2 : 0;
  o.bolts = t < 0.09 ? 1 - t / 0.09 : 0;
  o.eyes = S > 0.4 ? -1 : 0;
  o.f = f;
  return o;
}

function flinchO(f: number): JeO {
  const o = swimO(4, false);
  const k = [1, 0.8, 0.55, 0.3, 0.12, 0][f] ?? 0;
  const c = Math.cos(f * 1.9);
  o.w = 1 + 0.15 * k * c;
  o.h = 1 - 0.13 * k * c;
  o.dz = -1.2 * k;
  o.spread += 0.4 * k;
  o.wave = 1 + 1.6 * k;
  o.ph = 0.25 + f * 0.17;
  o.eyes = f < 3 ? -1 : 0;
  o.drain = 0.25 * k;
  o.f = f;
  return o;
}

function dieO(t: number, f: number): JeO {
  const o = swimO(4, false);
  const I = sstep(0, 0.12, t);
  o.w = 1 + 0.28 * I;
  o.h = 1 + 0.2 * I;
  o.eyes = 2;
  o.spread = 0.3 + 0.3 * I;
  o.wave = 1.6;
  o.ph = t * 3;
  o.pop = t >= 0.14;
  o.fall = easeIn(clamp01((t - 0.14) / 0.3));
  o.f = f;
  return o;
}

// ---- Риг -------------------------------------------------------------------------

const ZC = 20.5;
const RX = 7.8;
const RZ = 7.4;
/** Край купола — чуть ниже экватора, фестоны — 8 лопастей. */
const rimQ = (q: V3) => -0.12 + 0.1 * Math.abs(Math.sin(Math.atan2(q[1], q[0]) * 4));

function bellMat(o: JeO): Mat {
  let T = mixT(BELL, BELL_STORM, 0.55 * o.charge);
  T = mixT(T, BELL_DRAIN, o.drain);
  T = mixT(T, tn('#e8f0ff', '#f6f8ff', '#ffffff', '#ffffff'), o.white);
  const TT = withA(T, o.white > 0.5 ? 236 : 210);
  const cloud = alpha(
    mixc(mixc(WHITE, hx('#c0c8d4'), o.drain), ZAP, 0.35 * o.charge),
    o.drain > 0.5 ? 0.82 : 0.92,
  );
  const seed = o.f * 7 + 3;
  return {
    T: TT,
    glow: 0.4 * o.charge * (o.charge > 0.35 ? 1 : 0),
    pat: (q, l) => {
      // Молнии внутри: ломаная по кругу купола, мигает по кадрам.
      if (o.charge > 0.3) {
        const th = Math.atan2(q[1], q[0]);
        const seg = Math.floor(((th + PI) / TAU) * 9);
        const fr = ((th + PI) / TAU) * 9 - seg;
        const z0 = 0.05 + 0.4 * hash(seed, seg);
        const z1 = 0.05 + 0.4 * hash(seed, seg + 1);
        if (hash(seed, seg, 5) < o.charge * 0.9 && Math.abs(q[2] - lerp(z0, z1, fr)) < 0.075)
          return o.white > 0.5 ? WHITE : ZAP;
      }
      for (const [c, k] of CLOUDS) if (q[0] * c[0] + q[1] * c[1] + q[2] * c[2] > k) return cloud;
      return band(TT, l + 0.12);
    },
  };
}

interface JeRig {
  r: Rig;
  /** Концы нитей (мир) — для молний разряда. */
  tips: V3[];
  /** Середина купола (мир). */
  c: V3;
}

function jellyRig(o: JeO, yaw: number): JeRig {
  const r = new Rig();
  const F = F3.yaw(yaw).at(0, 0, 0);
  const sh: V3 = [o.shake, 0, 0];
  const c: V3 = vadd(F.p(0, 0, ZC + o.dz), sh);
  const Fb = F3.yaw(yaw, c).pitch(o.tilt);
  const rx = RX * o.w;
  const rz = RZ * o.h;
  const tips: V3[] = [];
  if (!o.pop) {
    r.ell(Fb, [0, 0, 0], [rx, rx, rz], bellMat(o), (q) => q[2] < rimQ(q));
    // Глазки на «лбу» купола.
    for (const sd of [-1, 1]) {
      const p = Fb.p(0.84 * rx, sd * 0.27 * rx, 0.3 * rz);
      if (o.eyes === -1) r.line(p, vadd(p, Fb.v(0, sd * 0.9, 0.1)), EYE, 0, 0.5);
      else r.dot(p, o.eyes === 2 ? WHITE : EYE, o.eyes === 2 ? 1 : 0, 1, 0.7);
    }
    r.eye = Fb.p(0.84 * rx, 0.27 * rx, 0.3 * rz);
  }
  // Ротовые лопасти — три коротких, под куполом.
  const down = (p: V3, dz: number): V3 => [p[0], p[1], Math.max(0.6, p[2] - dz)];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.6;
    const top = Fb.p(Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0.1 * rz);
    const sw = Math.sin(o.ph * TAU + i * 2.1) * 1.1 * o.wave;
    let mid = vadd(top, F.v(-o.trail * 0.25 + Math.cos(a) * 0.6, sw * 0.5, -4.2 * o.len));
    let end = vadd(top, F.v(-o.trail * 0.55 + Math.cos(a) * 1.1, sw, -7.6 * o.len));
    if (o.fall > 0) {
      mid = down(
        vadd(mid, [Math.cos(a) * 3 * o.fall, Math.sin(a) * 3 * o.fall, 0]),
        (mid[2] - 1) * o.fall,
      );
      end = down(
        vadd(end, [Math.cos(a) * 5 * o.fall, Math.sin(a) * 5 * o.fall, 0]),
        (end[2] - 0.8) * o.fall,
      );
    }
    const t0 = o.fall > 0 ? down(top, (top[2] - 1.2) * o.fall) : top;
    r.cap(t0, mid, 1.15, 0.8, { T: ORAL });
    r.cap(mid, end, 0.8, 0.35, { T: ORAL });
  }
  // Нити: от края купола вниз; шлейф назад, волна, юбка в стороны.
  const N = 7;
  const n = 8;
  const L = 17;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU + 0.25;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let prev = Fb.p(ca * rx * 0.93, sa * rx * 0.93, -0.06 * rz);
    if (o.fall > 0) prev = down(prev, (prev[2] - 1.5) * o.fall);
    const out = F.v(ca, sa, 0);
    const tan = F.v(-sa, ca, 0);
    const col = i % 2 ? NIT_A : NIT_B;
    const sparkAt = (o.f * 2 + i * 3) % n;
    for (let j = 1; j <= n; j++) {
      const u = j / n;
      const len = L * o.len * (0.92 + 0.16 * hash(i, 3));
      const wv = Math.sin(o.ph * TAU - j * 0.75 + i * 1.7) * o.wave * 1.3 * u;
      // Юбка: у купола нить уходит в сторону, к концу — свисает (дуга, не спица).
      const sj = o.spread * (1 - 0.5 * u);
      let p = vadd(
        prev,
        vadd(
          vadd(vmul(out, (sj * 0.85 + 0.06) * (len / n)), [0, 0, -(1 - sj * 0.62) * (len / n)]),
          vadd(vmul(F.v(-1, 0, 0), o.trail * (u ** 1.5 - (u - 1 / n) ** 1.5)), vmul(tan, wv / n)),
        ),
      );
      if (o.fall > 0) {
        p = vadd(p, vmul(out, 0.5 * o.fall));
        p = [p[0], p[1], Math.max(0.5, lerp(p[2], 0.5 + 0.15 * j, o.fall))];
      }
      const lit = o.sparks > 0 && j === sparkAt && hash(o.f, i, 9) < o.sparks;
      const a8 = Math.round(205 * (1 - u * 0.42));
      r.line(
        prev,
        p,
        lit ? ZAP : o.drain > 0.5 ? alpha(NIT_A, a8 / 300) : alpha(col, a8 / 255),
        lit ? 1 : 0,
      );
      prev = p;
    }
    tips.push(prev);
    const tc = o.tips === 2 ? WHITE : o.tips === 1 ? ZAP : alpha(CYAN, o.drain > 0.5 ? 0.5 : 0.92);
    if (o.fall < 0.9)
      r.dot(vadd(prev, [0, 0, -0.6]), tc, o.tips || o.drain < 0.5 ? 0.85 : 0, o.tips ? 2 : 1);
  }
  return { r, tips, c };
}

// ---- Кадр ------------------------------------------------------------------------

const JE = kindOf('jelly', 48, 50, 24, 42, 1200);

function jellyPose(anim: string, f: number): JeO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'sw1':
      return swimO(f, true);
    case 'zap':
      return zapO(Math.min(t, ZAP_T - 0.005), f);
    case 'rec':
      return recO(t - 0.5 / FPS + 0.004, f);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(t, f);
    default:
      return swimO(f, false);
  }
}

/** Ломаная молния в 2D: от (x0, y0) к (x1, y1), изломы по зерну. */
function bolt2(o: RigOut, x0: number, y0: number, x1: number, y1: number, seed: number, c: RGBA) {
  const n = 4;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const j = i < n ? (hash(seed, i) - 0.5) * 3 : 0;
    const nx = lerp(x0, x1, k) + j * -(y1 - y0) * 0.12;
    const ny = lerp(y0, y1, k) + j * (x1 - x0) * 0.12;
    const m = Math.ceil(Math.max(Math.abs(nx - px), Math.abs(ny - py)));
    for (let s = 0; s <= m; s++)
      spark2(o, lerp(px, nx, s / (m || 1)), lerp(py, ny, s / (m || 1)), c, 1);
    px = nx;
    py = ny;
  }
}

const jellyPic = (anim: string, f: number, d: number): Pic => {
  const o = jellyPose(anim, f);
  const yaw = yawN(d);
  const J = jellyRig(o, yaw);
  return draw(
    JE,
    J.r,
    (out: RigOut, P2) => {
      if (o.bolts > 0) {
        // Разряд: с концов нитей — молнии наружу.
        const [cx, cy] = P2(J.c);
        J.tips.forEach((p, i) => {
          const [x, y] = P2(p);
          const dx = x - cx;
          const dy = y - cy;
          const l = Math.hypot(dx, dy) || 1;
          bolt2(
            out,
            x,
            y,
            x + (dx / l) * 7 * o.bolts,
            y + (dy / l) * 5 * o.bolts + 1,
            31 + i,
            i % 2 ? ZAP : WHITE,
          );
        });
      }
      if (anim === 'die') {
        const t = (f + 0.5) / FPS;
        if (t >= 0.14 && t < 0.36) {
          // Лопнула: брызги и клочья облака во все стороны.
          const [x, y] = P2(J.c);
          const k = (t - 0.14) / 0.22;
          spray(out.p, x, y, 16, 15, easeOut(k), 71, DROPS, 6, 3);
          if (k < 0.3) spark2(out, x, y, WHITE, 1);
          if (k < 0.5)
            for (let i = 0; i < 10; i++) {
              const a = (i / 10) * TAU;
              out.p.set(
                x + Math.cos(a) * (3 + 9 * k),
                y + Math.sin(a) * (2 + 6 * k),
                alpha(WHITE, 0.8 - k),
              );
            }
        }
      }
    },
    2.2,
    EDGE,
  );
};

registerMobPainter('f11_jelly', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const ph = hash(id, 7);
  const move = md === 'chase' && moving(m, 0.35);
  const v = visOf(m, pose, move ? headOf(m, 0.35) : (m.face ?? 0), 3.2);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5, lift: 6, still: true };
  let anim = move ? 'sw1' : 'sw0';
  // Толчки по времени, фаза от номера — стая не в лад.
  let f = Math.floor(now * FPS + ph * LOOP) % LOOP;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.7, 0.9, t);
    ex.lift = 6 * (1 - easeIn(clamp01((t - 0.14) / 0.3)));
  } else if (md === 'f11_zap') {
    f = fi(t, 22);
    anim = 'zap';
    ex.lift = 6 + 2 * sstep(0.22, 0.6, t);
  } else if (md === 'recover' && (v.prev === 'f11_zap' || v.prev === '') && t < 1) {
    f = fi(t, 23);
    anim = 'rec';
    ex.lift = 8 - 4.5 * sstep(0.02, 0.3, t) + 2.5 * sstep(0.62, 0.98, t);
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
    anim = 'flinch';
  } else if (md === 'emerge') dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
  if (md !== 'dying') hurtFx(v, now, 1.5, ex);
  return put(
    frameOf(JE, anim, f, d, pose, (dd) => jellyPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_jelly', function* () {
  yield* warmAll(
    JE,
    [
      ['sw1', LOOP],
      ['zap', 23],
      ['rec', 24],
      ['flinch', 6],
      ['die', 22],
      ['sw0', LOOP],
    ],
    jellyPic,
  );
});

// ---- Разряд по кольцу (удар мозга `f11_zapring`) --------------------------------

/** Ряд чисел 0…1 из зерна записи (без `sim.rng`). */
function seeded(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const RING_LIFE = 0.34;
registerImpactPainter('f11_zapring', {
  life: RING_LIFE,
  shake: 0.06,
  flash: 0.12,
  flashRgb: '255,242,122',
  above: true,
  paint(g, rec, px, py, scale, age, time) {
    const s = scale / 16;
    const k = age / RING_LIFE;
    const R = (rec.r ?? 1.45) * scale;
    const W = (rec.w ?? 0.55) * scale;
    // Мигает по 1/30 с — у молнии своя дрожь, излом тоже меняется.
    const tick = Math.floor(time * 30);
    const dot = (x: number, y: number) =>
      g.fillRect(
        Math.round(x - s / 2),
        Math.round(y - s / 2),
        Math.max(1, Math.round(s)),
        Math.max(1, Math.round(s)),
      );
    const line = (x0: number, y0: number, x1: number, y1: number, col: string) => {
      g.fillStyle = col;
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, s));
      for (let i = 0; i <= n; i++) dot(lerp(x0, x1, i / n), lerp(y0, y1, i / n));
    };
    const a0 = seeded(rec.seed, 0) * TAU;
    // Кольцо: ломаная по окружности, белое → жёлтое → гаснет.
    if (k < 0.85) {
      const n = 22;
      const col =
        k < 0.25
          ? `rgba(255,255,255,${(1 - k).toFixed(2)})`
          : `rgba(255,242,122,${(1 - k / 0.85).toFixed(2)})`;
      let x0 = 0;
      let y0 = 0;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * TAU;
        const j = (seeded(rec.seed + tick, i % n) - 0.5) * W;
        const x = px + Math.cos(a) * (R + j);
        const y = py + Math.sin(a) * (R + j);
        if (i) line(x0, y0, x, y, col);
        x0 = x;
        y0 = y;
      }
    }
    // Молнии из медузы (она висит над точкой) к кольцу — первые кадры.
    if (k < 0.4 && tick % 2 === 0) {
      const cx = px;
      const cy = py - 16 * s;
      for (let b = 0; b < 6; b++) {
        const a = a0 + (b / 6) * TAU + 0.3;
        let x0 = cx;
        let y0 = cy;
        for (let i = 1; i <= 4; i++) {
          const q = i / 4;
          const j = i < 4 ? (seeded(rec.seed + tick * 7, b * 5 + i) - 0.5) * 6 * s : 0;
          const x = lerp(cx, px + Math.cos(a) * R, q) + j;
          const y = lerp(cy, py + Math.sin(a) * R, q) + j * 0.5;
          line(x0, y0, x, y, i < 2 ? 'rgba(255,255,255,0.95)' : 'rgba(255,242,122,0.9)');
          x0 = x;
          y0 = y;
        }
      }
    }
    // Искры по кольцу: подскакивают и падают.
    g.fillStyle = `rgba(255,248,170,${(1 - k).toFixed(2)})`;
    for (let i = 0; i < 12; i++) {
      const a = a0 + seeded(rec.seed, i + 30) * TAU;
      const rr = R + (seeded(rec.seed, i + 50) - 0.3) * W * 1.6 * easeOut(Math.min(1, k * 2));
      const up = 10 * s * Math.sin(PI * Math.min(1, k * 1.4)) * seeded(rec.seed, i + 70);
      dot(px + Math.cos(a) * rr, py + Math.sin(a) * rr - up);
    }
    return true;
  },
});

// ---- Облачко лопнувшей медузы (зона мозга `f11_puff`) ----------------------------

/** Облачко: клубы вращаются и тают; первые 0,25 с — раздуваются из хлопка. */
registerZonePainter('f11_puff', (g, z, px, py, _s, time) => {
  const k = Math.min(1, z.t / (z as Zone).life);
  const b = 0.55 + 0.45 * easeOut(clamp01(z.t / 0.25));
  g.globalAlpha = 0.55 * (1 - k);
  g.fillStyle = '#e8f4ff';
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9 + time * 0.6;
    const r = z.r * 16 * 0.55 * b;
    g.beginPath();
    g.arc(px + Math.cos(a) * r * 0.6, py - 4 + Math.sin(a) * r * 0.35, r * 0.55, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return true;
});
