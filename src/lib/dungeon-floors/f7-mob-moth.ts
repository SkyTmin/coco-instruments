// Этаж 7 — Зеркальная бабочка (анимации мобов 7). Четыре крыла-зеркальца
// в тонкой оправе, фиолетовое тельце, усики с бледными огоньками. Риг
// мини-3D (`f15-rig.ts`), 8 сторон; крылья — плоские грани на шарнире
// вдоль тела, поэтому свет по ним бежит сам: на взмахе зеркальце
// вспыхивает, когда встаёт к свету, по стеклу ходит косой блик.
//   • полёт: 6 кадров взмаха (12 к/с), тело качается против крыльев;
//   • вспышка `flash` (0,8 с): крылья раскрываются и замирают плашмя,
//     стекло накаляется добела, слой поверх темноты растёт, последние
//     0,15 с дрожит; кадр контакта — первый кадр `recover` (ослепление
//     и зона `f7_flash`): всё белое; крылья остывают, взмах возвращается;
//   • выход из кокона: смятые крылья расправляются;
//   • смерть: крылья лопаются осколками и падают, тельце оседает.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig } from './f15-rig';
import type { Mat, RGBA, Tones, V3 } from './f15-rig';
import {
  TAU,
  WHITE,
  alpha,
  clamp01,
  dir8,
  dither,
  dress,
  eOut,
  fi,
  frameOf,
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

const MW = tn('#3a4a6c', '#6c86ae', '#b0c8e4', '#eef6ff');
const MH = tn('#a8c8ec', '#dcecff', '#f6fbff', '#ffffff');
const VIO = tn('#2a1650', '#5a2f9e', '#9a6ae0', '#e2d0ff');
const RIM = hx('#6c86ae');
const CYAN_HOT = hx('#e0fbff');
const TIP = hx('#fff4b8');

const W = 34;
const H = 30;
const AX = 17;
const AY = 22;

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];
const toneMix = (h: number): Tones =>
  [0, 1, 2, 3].map((i) => mixc(MW[i], MH[i], h)) as unknown as Tones;

/** Зеркальце крыла: тон по свету плоскости, косой блик бежит по стеклу. */
function wingMat(h: number, ph: number): Mat {
  const T = toneMix(h);
  return {
    T,
    bias: 0.1 + 0.4 * h,
    pat: (q, l) => {
      const s = q[0] * 0.55 - q[1] * 0.35 + q[2] * 0.8 + ph;
      const m = ((s % 7) + 7) % 7;
      if (m < 0.9) return l > 0.2 ? WHITE : T[3];
      return band(T, l + (m < 1.8 ? 0.25 : 0));
    },
  };
}

// ---- Поза --------------------------------------------------------------------------------

interface MP {
  z: number;
  pitch: number;
  roll: number;
  /** Подъём крыльев (рад): 0 — плашмя, + вверх. Передние и задние — со сдвигом. */
  fw: number;
  hw: number;
  /** Раскрытие (1 — во всю ширину, меньше — сложены/смяты). */
  open: number;
  /** Накал стекла 0…1 и фаза блика. */
  hot: number;
  ph: number;
}
const REST: MP = { z: 6, pitch: 0.1, roll: 0, fw: 0.4, hw: 0.3, open: 1, hot: 0, ph: 0 };

const FORE: [number, number][] = [
  [1.4, 0],
  [3.4, 4.4],
  [1.2, 8.8],
  [-1.2, 7.6],
  [-0.6, 0.4],
];
const HIND: [number, number][] = [
  [-0.4, 0.3],
  [-0.4, 5.6],
  [-3.4, 6.2],
  [-3.8, 2.6],
  [-1.6, 0.2],
];

/** Наклон к зрителю: поворот вокруг оси x мира (верх уходит к камере). */
const TILT = 0.7;
const tiltV = (v: V3): V3 => [
  v[0],
  v[1] * Math.cos(TILT) + v[2] * Math.sin(TILT),
  -v[1] * Math.sin(TILT) + v[2] * Math.cos(TILT),
];

interface Built {
  r: Rig;
  T: F3;
  wings: number;
}
function mothRig(o: MP, yaw: number): Built {
  const r = new Rig();
  // Спиной к зрителю: летящую бабочку видно сверху, иначе крылья — полоска.
  const Y = F3.yaw(yaw);
  const T = new F3([0, 0, o.z], tiltV(Y.f), tiltV(Y.s), tiltV(Y.u)).pitch(o.pitch).roll(o.roll);
  const body: Mat = { T: VIO, bias: 0.15 };
  // Тельце: грудь, брюшко кольцами, голова, усики с огоньками.
  r.ell(T, [0.6, 0, 0], [1.5, 1.15, 1.15], body);
  r.cap(T.p(-0.3, 0, 0), T.p(-3.6, 0, -0.5), 1.15, 0.5, {
    T: VIO,
    bias: 0.1,
    pat: (q, l) => (Math.floor(q[0] * 4) % 2 ? null : band(VIO, l - 0.25)),
  });
  r.ball(T.p(2.1, 0, 0.3), 0.95, body);
  for (const sd of [-1, 1]) {
    const tip = T.p(3.9, sd * 1.8, 2.6);
    r.line(T.p(2.4, sd * 0.4, 0.9), tip, VIO[2], 0, 0.5);
    r.dot(tip, TIP, 0.7, 1, 1);
  }
  r.eye = T.p(2.6, 0, 0.5);
  // Крылья: грани на шарнире у тела, кант-оправа по краю.
  const wings = r.size;
  const mat = wingMat(o.hot, o.ph);
  const rim = o.hot > 0.5 ? CYAN_HOT : RIM;
  for (const sd of [-1, 1])
    for (const [shape, ang, sc] of [
      [FORE, o.fw, 1],
      [HIND, o.hw, 0.95],
    ] as [[number, number][], number, number][]) {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const pts: V3[] = shape.map(([a, sp]) => {
        const w = sp * sc * o.open;
        return T.p(a * (0.6 + 0.4 * o.open), sd * (0.8 + w * c), w * s);
      });
      r.poly(pts, mat);
      for (let i = 0; i < pts.length; i++)
        r.line(pts[i], pts[(i + 1) % pts.length], rim, o.hot * 0.6, 0.4);
    }
  return { r, T, wings };
}

function mothPic(o: MP, d: number): Pic {
  const { r } = mothRig(o, yawOfDir(d));
  return rigPic(r, W, H, AX, AY, { outline: alpha(hx('#10101a'), 0.85), inner: 2 }, (out) => {
    if (o.hot <= 0.05) return;
    // Накал: стекло светит поверх темноты.
    const L = litOf(out);
    for (let y = 0; y < out.p.h; y++)
      for (let x = 0; x < out.p.w; x++) {
        const c = out.p.get(x, y);
        if (c[3] > 0 && c[0] + c[1] + c[2] > 480)
          L.set(x, y, alpha(o.hot > 0.9 ? WHITE : CYAN_HOT, 0.2 + 0.75 * o.hot));
      }
  });
}

// ---- Позы во времени ---------------------------------------------------------------------

const FLY_N = 6;
function flyPose(i: number, fast: number): MP {
  const a = (i / FLY_N) * TAU;
  const fw = 0.35 + 0.85 * Math.cos(a);
  return {
    ...REST,
    z: 6 - 0.5 * Math.cos(a),
    pitch: fast ? 0.28 : 0.1,
    fw,
    hw: 0.35 + 0.8 * Math.cos(a - 0.5),
    ph: i * 1.2,
  };
}

const FLASH_N = 20;
function flashPose(f: number): MP {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.3));
  const tr = t > 0.65 ? (f % 2 ? 0.06 : -0.06) : 0;
  return {
    ...REST,
    z: 6 + 2 * k,
    pitch: lerp(0.1, -0.15, k),
    fw: lerp(0.4, 0.08, k) + tr,
    hw: lerp(0.3, 0.02, k) - tr,
    hot: 0.85 * sstep(0.1, 0.78, t),
    ph: t * 18,
  };
}
const REC_N = 11;
const recF = (t: number) => {
  const f = fi(t, 14);
  return f < 6 ? f : 6 + ((f - 6) >> 1);
};
const recT = (f: number) => (f < 6 ? (f + 0.5) / 24 : (6 + 2 * (f - 6) + 1) / 24);
function recPose(f: number): MP {
  const t = recT(f);
  if (f === 0) return { ...REST, z: 8, pitch: -0.15, fw: 0.05, hw: 0, hot: 1, ph: 14 };
  const k = smooth(clamp01(t / 0.45));
  const a = t * 14;
  return {
    ...REST,
    z: lerp(8, 6, k),
    pitch: lerp(-0.15, 0.1, k),
    fw: lerp(0.05, 0.35 + 0.85 * Math.cos(a), k),
    hw: lerp(0, 0.35 + 0.8 * Math.cos(a - 0.5), k),
    hot: 1 - sstep(0, 0.3, t),
    ph: 14 + t * 10,
  };
}

const STEP_N = 12;
function stepPic(d: number, f: number): Pic {
  const k = (f + 1) / STEP_N;
  const e = eOut(k);
  const o: MP = {
    ...REST,
    z: lerp(1.5, 6, e),
    fw: lerp(-1.1, 0.6, e) + (f % 2 ? 0.1 : 0),
    hw: lerp(-1.2, 0.4, e),
    open: lerp(0.45, 1, e),
    ph: f,
  };
  const pc = mothPic(o, d);
  return { ...pc, p: dither(pc.p, 0.25 + 0.75 * sstep(0, 0.45, k), f) };
}

function stunPose(f: number): MP {
  const k = [1, 0.8, 0.55, 0.3, 0.1][Math.min(4, f)];
  return { ...REST, roll: 0.7 * k, pitch: -0.3 * k, fw: 0.4 + 0.6 * k, hw: 0.3 - 0.3 * k, ph: f };
}

const DIE_N = 20;
const DIE_T = 0.82;
function deathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / 24;
  const o: MP = { ...REST, roll: 0.5 * sstep(0, 0.3, t), fw: 0.2, hw: 0.1, ph: 3 };
  const { r, T, wings } = mothRig(o, yawOfDir(d));
  const ex = clamp01((t - 0.08) / 0.6);
  if (ex > 0) r.explode(eOut(ex), T.p(0, 0, 0), 9 + d, 8, 26, wings, 0.4);
  const pc = rigPic(
    r,
    W,
    H,
    AX,
    AY,
    { outline: alpha(hx('#10101a'), 0.85), inner: 2 },
    (out, P) => {
      if (t > 0.18) return;
      // Звон: белые искры у шарниров крыльев.
      const L = litOf(out);
      const [cx, cy] = P(T.p(0.3, 0, 0.5));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        L.set(
          cx + Math.cos(a) * (2 + t * 30),
          cy + Math.sin(a) * (2 + t * 30) * 0.7,
          alpha(WHITE, 0.9),
        );
      }
    },
  );
  const fade = 1 - sstep(0.4, DIE_T, t);
  return { ...pc, p: dither(pc.p, fade, f), eye: null };
}

// ---- Рисовальщик ---------------------------------------------------------------------------

const K = kindOf('f7_moth', 760);
const key = (k: string, look: Look, build: () => Pic): MobFrame =>
  frameOf(K, k, false, look, build);

registerMobPainter('f7_moth', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = Math.max(0, pose.t || 0);
  const now = pose.now || 0;
  const busy = mode === 'flash' || mode === 'recover' || mode === 'dying';
  const v = visOf(m, pose, busy ? (m.face ?? 0) : headOf(m), 9);
  const d = dir8(v.yaw);
  const look = pose.look;
  const bob = Math.sin(now * 3.1 + phaseOf(m) * TAU);
  const ex: Partial<MobFrame> = { still: true, shadow: 3, lift: 8 + Math.round(bob) };
  let fr: MobFrame;
  if (mode === 'dying') {
    const f = fi(t, DIE_N - 1);
    fr = key(`x|${d}|${f}`, look, () => deathPic(d, f));
    ex.linger = DIE_T;
    ex.lift = Math.max(0, Math.round(8 * (1 - eOut(clamp01(t / 0.45)))));
  } else if (mode === 'flash') {
    const f = fi(t, FLASH_N - 1);
    fr = key(`a|${d}|${f}`, look, () => mothPic(flashPose(f), d));
    ex.lift = 8;
  } else if (mode === 'recover') {
    const f = recF(t);
    fr = key(`r|${d}|${f}`, look, () => mothPic(recPose(f), d));
    ex.lift = 8;
  } else if (mode === 'f7_step') {
    const f = fi(t, STEP_N - 1);
    fr = key(`e|${d}|${f}`, look, () => stepPic(d, f));
    ex.lift = Math.round(8 * smooth(clamp01(t / 0.5)));
  } else if (mode === 'stun') {
    const f = fi(t, 4);
    fr = key(`h|${d}|${f}`, look, () => mothPic(stunPose(f), d));
  } else {
    const fast = moving(m, 2) ? 1 : 0;
    const i = mod(now * 12 + phaseOf(m) * FLY_N, FLY_N);
    fr = key(`f|${d}|${fast}|${i}`, look, () => mothPic(flyPose(i, fast), d));
  }
  hurtFx(v, now, 2, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_moth', () => {
  const s: (() => unknown)[] = [];
  const lk: Look = 'normal';
  for (let d = 0; d < 8; d++) {
    for (let fast = 0; fast < 2; fast++)
      for (let i = 0; i < FLY_N; i++)
        s.push(() => key(`f|${d}|${fast}|${i}`, lk, () => mothPic(flyPose(i, fast), d)));
    for (let f = 0; f < FLASH_N; f++)
      s.push(() => key(`a|${d}|${f}`, lk, () => mothPic(flashPose(f), d)));
    for (let f = 0; f < REC_N; f++)
      s.push(() => key(`r|${d}|${f}`, lk, () => mothPic(recPose(f), d)));
    for (let f = 0; f < STEP_N; f++) s.push(() => key(`e|${d}|${f}`, lk, () => stepPic(d, f)));
    for (let f = 0; f < 5; f++) s.push(() => key(`h|${d}|${f}`, lk, () => mothPic(stunPose(f), d)));
    for (let f = 0; f < DIE_N; f++) s.push(() => key(`x|${d}|${f}`, lk, () => deathPic(d, f)));
  }
  return warmSteps(s);
});
