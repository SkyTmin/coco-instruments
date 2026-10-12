// Этаж 7 — Осколочный паук (анимации мобов 7). Стеклянное брюшко с розовым
// сердцем, шипы-осколки на спине, тёмная головогрудь с гроздью розовых
// глаз, восемь ног коленями выше спины. Риг мини-3D (`f15-rig.ts`), 8
// сторон честно, ноги переставляются «четвёрками» по пройденному пути.
//   • прицел `aim` (0,5 с): приседает, встаёт на дыбы передними лапами,
//     последние 0,2 с дрожит;
//   • прыжок `leap` (0,36 с): ноги поджаты, дуга сдвигом кадра со шлейфом,
//     к концу передние лапы вперёд; кадр контакта — первый кадр
//     `recover` (урон приземления): расплющен, лапы врозь, пыль, блик шипов;
//   • укус (`windup` 0,45 с): дыбы, хелицеры раскрыты — бросок; контакт —
//     первый кадр `recover`;
//   • со свода `drop`: висит на нити, лапы поджаты; приземление — `stun`;
//   • смерть: лапы поджимаются, брюшко лопается розовой вспышкой, тает.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vadd } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  PI,
  TAU,
  WHITE,
  alpha,
  clamp01,
  dir8,
  dither,
  dress,
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

const SPG = tn('#2c4a60', '#5a8aa6', '#9cd0e4', '#e6faff');
const SPD = tn('#1c2c3c', '#34506a', '#5a86a6', '#a8d4ec');
const PINK = hx('#ff6a98');
const PINK_HOT = hx('#ffc0d6');
const DUST = hx('#b8c8dc');
const SILK = hx('#dceaf4');

const W = 36;
const H = 36;
const AX = 18;
const AY = 25;

/** Брюшко: стекло, сверху сквозь него видно розовое сердце (оно и светится). */
const ABD: Mat = {
  T: SPG,
  spec: true,
  pat: (q, l) =>
    q[2] > 0.15 && Math.hypot(q[0] + 0.05, q[1]) < 0.42 ? (l > 0.55 ? PINK_HOT : PINK) : null,
  gpat: (q) => (q[2] > 0.15 && Math.hypot(q[0] + 0.05, q[1]) < 0.42 ? 0.55 : 0),
};
const SHARD: Mat = { T: SPG, spec: true, bias: 0.1 };
const CEPH: Mat = { T: SPD, bias: 0.05 };
const LEG: Mat = { T: SPG, bias: -0.05 };

// ---- Поза --------------------------------------------------------------------------------

interface SP {
  z: number;
  pitch: number;
  roll: number;
  /** Ступни: 0…3 — левые (от головы к хвосту), 4…7 — правые; оси курса. */
  feet: V3[];
  chel: number;
  heart: number;
  glint: number;
  dust: number;
  /** Нить сверху (висит со свода). */
  silk: boolean;
}

const ANG = [0.72, 1.2, 1.85, 2.45];
const RAD = [8.2, 7.6, 7.6, 8.2];
/** Ступня в покое: `sp` — разлёт ног, `fz` — высота стопы. */
function restFoot(sd: number, i: number, sp = 1, fz = 0): V3 {
  const R = RAD[i] * sp;
  return [0.6 + Math.cos(ANG[i]) * R, sd * Math.sin(ANG[i]) * R, fz];
}
function restFeet(sp = 1, fz = 0): V3[] {
  const out: V3[] = [];
  for (const sd of [-1, 1]) for (let i = 0; i < 4; i++) out.push(restFoot(sd, i, sp, fz));
  return out;
}
const REST: SP = {
  z: 3.2,
  pitch: 0,
  roll: 0,
  feet: restFeet(),
  chel: 0,
  heart: 0.5,
  glint: 0,
  dust: 0,
  silk: false,
};

/** Два звена: колено от бедра `a` к стопе `b`, сгиб — в сторону `pole`. */
function knee(a: V3, b: V3, L1: number, L2: number, pole: V3): [V3, V3] {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const dl = Math.max(1e-6, Math.hypot(d[0], d[1], d[2]));
  const len = Math.min(dl, (L1 + L2) * 0.999);
  const u: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
  const end: V3 = [a[0] + u[0] * len, a[1] + u[1] * len, a[2] + u[2] * len];
  const x = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2];
  const pp: V3 = [pole[0] - u[0] * pd, pole[1] - u[1] * pd, pole[2] - u[2] * pd];
  const pl = Math.max(1e-6, Math.hypot(pp[0], pp[1], pp[2]));
  return [
    [
      a[0] + u[0] * x + (pp[0] / pl) * h,
      a[1] + u[1] * x + (pp[1] / pl) * h,
      a[2] + u[2] * x + (pp[2] / pl) * h,
    ],
    end,
  ];
}

interface Built {
  r: Rig;
  B: F3;
  T: F3;
  /** С какого примитива начинается брюшко (лопается в смерти). */
  abd: number;
}
function spiderRig(o: SP, yaw: number): Built {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const T = B.at(0, 0, o.z).pitch(o.pitch).roll(o.roll);
  // Ноги: бедро на головогруди, колено выше спины, стопа на полу.
  for (let j = 0; j < 8; j++) {
    const sd = j < 4 ? -1 : 1;
    const i = j % 4;
    const hip = T.p(2.4 - i * 0.8, sd * 1.5, 0.2);
    const ft = B.p(o.feet[j][0], o.feet[j][1], o.feet[j][2] + 0.4);
    const [kn, en] = knee(hip, ft, 5.4, 6.6, vadd(B.v(0, sd * 0.35, 0), [0, 0, 1]));
    r.cap(hip, kn, 0.8, 0.65, LEG);
    r.cap(kn, en, 0.65, 0.45, LEG);
    r.dot(en, SPG[3], 0, 1, 0.2);
  }
  // Головогрудь, хелицеры, глаза гроздью.
  r.ell(T, [2.2, 0, 0.3], [2.6, 2.2, 1.7], CEPH);
  for (const sd of [-1, 1]) {
    const a = T.p(4.2, sd * 0.6, -0.2);
    const b = T.p(5.3 + 0.6 * o.chel, sd * (0.5 + 0.9 * o.chel), -1.5 + 0.4 * o.chel);
    r.cap(a, b, 0.6, 0.4, o.glint > 0.5 ? { T: SPG, flat: 3 } : CEPH);
  }
  for (const [f, s, u] of [
    [4.4, -0.6, 1.1],
    [4.4, 0.6, 1.1],
    [3.9, -1.1, 1.6],
    [3.9, 1.1, 1.6],
  ] as V3[])
    r.dot(T.p(f, s, u), PINK, 0.5, 1, 1);
  r.eye = T.p(4.5, 0, 1.2);
  // Брюшко и шипы-осколки — последними: в смерти лопаются только они.
  const abd = r.size;
  r.ell(T, [-3.2, 0, 1.3], [3.8, 3.2, 2.8], {
    ...ABD,
    gpat: (q) => (ABD.gpat?.(q) ?? 0) * (0.4 + 0.6 * o.heart),
  });
  r.spike(T.p(-2.4, -0.9, 3.4), T.v(-0.2, -0.3, 1), 3.6, 1.0, SHARD, 4, 0.3);
  r.spike(T.p(-4.4, 0.9, 3.0), T.v(-0.5, 0.35, 1), 3.0, 0.9, SHARD, 4, 0.9);
  r.spike(T.p(-1.0, 1.1, 3.2), T.v(0.1, 0.5, 1), 2.2, 0.7, SHARD, 3, 0.2);
  return { r, B, T, abd };
}

function spiderPic(o: SP, d: number, w = W, h = H, ay = AY): Pic {
  const { r, T } = spiderRig(o, yawOfDir(d));
  return rigPic(r, w, h, AX, ay, { outline: alpha(hx('#10101a'), 0.9), inner: 2.2 }, (out, P) => {
    const L = o.glint > 0 || o.dust > 0 ? litOf(out) : null;
    if (o.silk) {
      // Нить от брюшка вверх, до края холста.
      const [sx, sy] = P(T.p(-3.0, 0, 4.0));
      for (let y = Math.round(sy) - 1; y >= 0; y--) out.p.set(Math.round(sx), y, alpha(SILK, 0.75));
    }
    if (L && o.glint > 0)
      // Блик по шипам: самые светлые точки — белым поверх темноты.
      for (let y = 0; y < out.p.h; y++)
        for (let x = 0; x < out.p.w; x++) {
          const c = out.p.get(x, y);
          if (c[3] > 0 && c[0] + c[1] + c[2] > 600) L.set(x, y, alpha(WHITE, 0.8 * o.glint));
        }
    if (o.dust > 0) {
      const [cx, cy] = P([0, 0, 0]);
      const R = 4 + 8 * eOut(o.dust);
      for (let i = 0; i < 12; i++) {
        if (hash(i, d, 5) < o.dust * 0.7) continue;
        const a = (i / 12) * TAU;
        out.p.set(
          cx + Math.cos(a) * R,
          cy + Math.sin(a) * R * 0.6,
          alpha(DUST, 0.85 - 0.5 * o.dust),
        );
      }
    }
  });
}

// ---- Позы во времени ---------------------------------------------------------------------

const CYCLE = 0.8;
const RUN_N = 8;
function runPose(i: number): SP {
  const ph = (i / RUN_N) * TAU;
  const feet = restFeet();
  for (let j = 0; j < 8; j++) {
    const grp = (j % 4) + (j < 4 ? 0 : 1);
    const p = ph + (grp % 2) * PI;
    feet[j] = [feet[j][0] - 2.2 * Math.cos(p), feet[j][1], 1.5 * Math.max(0, Math.sin(p))];
  }
  return { ...REST, z: 3.2 + 0.25 * Math.cos(2 * ph), roll: 0.04 * Math.sin(ph), feet };
}

const IDLE_N = 6;
function idlePose(i: number): SP {
  const feet = restFeet();
  // Передние лапы постукивают по очереди.
  if (i === 1 || i === 2) feet[0] = vadd(feet[0], [0.6, 0, i === 1 ? 1.4 : 0.6]);
  if (i === 4 || i === 5) feet[4] = vadd(feet[4], [0.6, 0, i === 4 ? 1.4 : 0.6]);
  return { ...REST, z: 3.2 + 0.15 * Math.sin((i / IDLE_N) * TAU), feet, heart: 0.4 + 0.1 * i };
}

const AIM_N = 12;
function aimPose(f: number): SP {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.25));
  const feet = restFeet(lerp(1, 1.15, k));
  for (const j of [0, 4]) {
    const sd = j ? 1 : -1;
    feet[j] = [lerp(feet[j][0], 6.2, k), lerp(feet[j][1], sd * 3.8, k), 5 * k];
  }
  const tr = t > 0.3 ? (f % 2 ? 0.25 : -0.25) : 0;
  return {
    ...REST,
    z: lerp(3.2, 2.4, k) + tr,
    pitch: -0.3 * k,
    feet,
    heart: 0.5 + 0.5 * sstep(0.2, 0.5, t),
  };
}

const LEAP_N = 9;
function leapPose(f: number): SP {
  const k = (f + 0.5) / LEAP_N;
  const feet = restFeet(0.55, 1.6);
  if (k > 0.6) {
    const e = smooth((k - 0.6) / 0.4);
    for (const j of [0, 1, 4, 5]) {
      const sd = j < 4 ? -1 : 1;
      feet[j] = [
        lerp(feet[j][0], 7.5 - (j % 4) * 2, e),
        lerp(feet[j][1], sd * 3.2, e),
        lerp(1.6, 0.2, e),
      ];
    }
  }
  return { ...REST, pitch: lerp(-0.2, 0.15, k), feet, heart: 1 };
}

/** Отдых 0,7 с: 8 кадров 24 к/с, дальше по два. */
const REC_N = 13;
const recF = (t: number) => {
  const f = fi(t, 16);
  return f < 8 ? f : 8 + ((f - 8) >> 1);
};
const recT = (f: number) => (f < 8 ? (f + 0.5) / 24 : (8 + 2 * (f - 8) + 1) / 24);

const SPLAT: SP = { ...REST, z: 2.0, feet: restFeet(1.25), glint: 1, dust: 0.1, heart: 1 };
function landPose(f: number): SP {
  const t = recT(f);
  if (f === 0) return SPLAT;
  const k = smooth(clamp01(t / 0.35));
  return {
    ...REST,
    z: lerp(2.0, 3.2, k),
    feet: restFeet(lerp(1.25, 1, k)),
    glint: Math.max(0, 1 - t / 0.12),
    dust: t < 0.4 ? 0.1 + 0.9 * (t / 0.4) : 0,
    heart: lerp(1, 0.5, k),
  };
}

const BITE_N = 11;
function bitePose(f: number): SP {
  const t = (f + 0.5) / 24;
  const k = eOut3(clamp01(t / 0.25));
  const feet = restFeet();
  const go = f === BITE_N - 1;
  for (const j of [0, 4]) {
    const sd = j ? 1 : -1;
    feet[j] = go
      ? [8.5, sd * 3, 1.5]
      : [lerp(feet[j][0], 4.6, k), lerp(feet[j][1], sd * 5.2, k), 6.5 * k];
  }
  return {
    ...REST,
    z: 3.2 + 0.8 * k,
    pitch: go ? 0.15 : -0.4 * k,
    feet,
    chel: go ? 0.4 : k,
    heart: 0.5 + 0.5 * k,
  };
}
function biteRec(f: number): SP {
  const t = recT(f);
  const feet = restFeet();
  const pin = 1 - smooth(clamp01((t - 0.08) / 0.35));
  for (const j of [0, 4]) {
    const sd = j ? 1 : -1;
    feet[j] = vadd(feet[j], [(8.6 - feet[j][0]) * pin, (sd * 2.6 - feet[j][1]) * pin, 0.5 * pin]);
  }
  return {
    ...REST,
    pitch: 0.3 * pin,
    z: 3.2 - 0.4 * pin,
    feet,
    chel: 0,
    glint: f === 0 ? 1 : 0,
    heart: 0.5 + 0.5 * pin,
  };
}

const HANG: SP = {
  ...REST,
  z: 3.6,
  pitch: 0.25,
  feet: restFeet(0.45, 3.4),
  silk: true,
  heart: 0.6,
};

/** Удар героя: отпрянул, лапы поджал (5 кадров). */
function stunPose(f: number): SP {
  const k = [1, 0.8, 0.55, 0.3, 0.1][Math.min(4, f)];
  return {
    ...REST,
    z: 3.2 + 0.6 * k,
    pitch: -0.25 * k,
    roll: 0.15 * k,
    feet: restFeet(1 - 0.3 * k, 1.2 * k),
  };
}

const DIE_N = 20;
const DIE_T = 0.85;
function deathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.3));
  const o: SP = {
    ...REST,
    z: lerp(3.2, 1.8, k),
    roll: 0.35 * k,
    feet: restFeet(lerp(1, 0.35, k), lerp(0, 3.5, k)),
    heart: f % 2 ? 1 : 0.3,
  };
  const { r, T, abd } = spiderRig(o, yawOfDir(d));
  const ex = clamp01((t - 0.3) / 0.4);
  if (ex > 0) r.explode(eOut(ex), T.p(-3.2, 0, 1.3), 5 + d, 9, 30, abd, 0.5);
  const pc = rigPic(
    r,
    W,
    H,
    AX,
    AY,
    { outline: alpha(hx('#10101a'), 0.9), inner: 2.2 },
    (out, P) => {
      if (ex > 0 && ex < 0.35) {
        // Розовая вспышка лопнувшего сердца.
        const L = litOf(out);
        const [cx, cy] = P(T.p(-3.2, 0, 1.6));
        const R = 2 + 6 * ex;
        for (let y = -R; y <= R; y++)
          for (let x = -R; x <= R; x++)
            if (x * x + y * y <= R * R)
              L.set(cx + x, cy + y, alpha(PINK_HOT, 0.7 * (1 - ex / 0.35)));
      }
    },
  );
  const fade = 1 - sstep(0.45, DIE_T, t);
  return { ...pc, p: dither(pc.p, fade, f), eye: t > 0.3 ? null : pc.eye };
}

const STEP_N = 12;
function stepPic(d: number, f: number): Pic {
  const b = spiderPic(idlePose(0), d);
  return { ...b, p: dither(b.p, 0.12 + 0.88 * smooth((f + 1) / STEP_N), f), lit: null };
}

// ---- Рисовальщик ---------------------------------------------------------------------------

const K = kindOf('f7_spider', 1000);
const key = (k: string, look: Look, build: () => Pic): MobFrame =>
  frameOf(K, k, false, look, build);

registerMobPainter('f7_spider', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const busy = mode !== 'chase' && mode !== 'idle' && mode !== 'alert' && mode !== 'sleep';
  const v = visOf(m, pose, busy ? (m.face ?? 0) : headOf(m), busy ? 14 : 9);
  const d = dir8(v.yaw);
  const look = pose.look;
  const ex: Partial<MobFrame> = { still: true, shadow: 5 };
  let fr: MobFrame;
  if (mode === 'dying') {
    const f = fi(t, DIE_N - 1);
    fr = key(`x|${d}|${f}`, look, () => deathPic(d, f));
    ex.linger = DIE_T;
  } else if (mode === 'aim') {
    const f = fi(t, AIM_N - 1);
    fr = key(`a|${d}|${f}`, look, () => spiderPic(aimPose(f), d));
  } else if (mode === 'leap') {
    const f = fi(t, LEAP_N - 1);
    fr = key(`l|${d}|${f}`, look, () => spiderPic(leapPose(f), d));
    const sx = m.data?.sx;
    const tx = m.data?.tx;
    const dist =
      sx !== undefined && tx !== undefined
        ? Math.hypot(tx - sx, (m.data?.ty ?? 0) - (m.data?.sy ?? 0))
        : 3;
    ex.dy = -Math.sin(PI * clamp01(t / 0.36)) * (4 + 2.2 * dist);
    ex.ghost = { every: 0.04, life: 0.16, tint: '#9cd0e4', alpha: 0.45 };
    ex.shadow = 4;
  } else if (mode === 'recover' || (mode === 'stun' && v.prev === 'drop')) {
    const f = mode === 'stun' ? Math.min(4, fi(t, 4)) : recF(t);
    const land = mode === 'stun' || v.prev === 'leap';
    fr = land
      ? key(`r|${d}|${f}`, look, () => spiderPic(landPose(f), d))
      : key(`q|${d}|${f}`, look, () => spiderPic(biteRec(f), d));
    if (f === 0 && land) {
      ex.sx = 1.12;
      ex.sy = 0.86;
    }
    if (!land) {
      const pin = 1 - smooth(clamp01((recT(f) - 0.08) / 0.35));
      ex.dx = Math.cos(v.yaw) * 2 * pin;
      ex.dy = Math.sin(v.yaw) * 1.2 * pin;
    }
  } else if (mode === 'windup') {
    const f = fi(t, BITE_N - 1);
    fr = key(`b|${d}|${f}`, look, () => spiderPic(bitePose(f), d));
  } else if (mode === 'drop') {
    fr = key(`d|${d}`, look, () => spiderPic(HANG, d, W, 72, 62));
    ex.dx = Math.round(Math.sin(now * 3 + phaseOf(m) * TAU) * 0.8);
  } else if (mode === 'stun') {
    const f = fi(t, 4);
    fr = key(`h|${d}|${f}`, look, () => spiderPic(stunPose(f), d));
  } else if (mode === 'f7_step') {
    const f = fi(t, STEP_N - 1);
    fr = key(`e|${d}|${f}`, look, () => stepPic(d, f));
  } else if (moving(m, 0.5)) {
    const i = mod((v.dist / CYCLE) * RUN_N, RUN_N);
    fr = key(`w|${d}|${i}`, look, () => spiderPic(runPose(i), d));
  } else {
    const i = mod(now * 4 + phaseOf(m) * IDLE_N, IDLE_N);
    fr = key(`i|${d}|${i}`, look, () => spiderPic(idlePose(i), d));
  }
  hurtFx(v, now, 1.6, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_spider', () => {
  const s: (() => unknown)[] = [];
  const lk: Look = 'normal';
  for (let d = 0; d < 8; d++) {
    for (let i = 0; i < RUN_N; i++)
      s.push(() => key(`w|${d}|${i}`, lk, () => spiderPic(runPose(i), d)));
    for (let i = 0; i < IDLE_N; i++)
      s.push(() => key(`i|${d}|${i}`, lk, () => spiderPic(idlePose(i), d)));
    for (let f = 0; f < AIM_N; f++)
      s.push(() => key(`a|${d}|${f}`, lk, () => spiderPic(aimPose(f), d)));
    for (let f = 0; f < LEAP_N; f++)
      s.push(() => key(`l|${d}|${f}`, lk, () => spiderPic(leapPose(f), d)));
    for (let f = 0; f < REC_N; f++) {
      s.push(() => key(`r|${d}|${f}`, lk, () => spiderPic(landPose(f), d)));
      s.push(() => key(`q|${d}|${f}`, lk, () => spiderPic(biteRec(f), d)));
    }
    for (let f = 0; f < BITE_N; f++)
      s.push(() => key(`b|${d}|${f}`, lk, () => spiderPic(bitePose(f), d)));
    for (let f = 0; f < 5; f++)
      s.push(() => key(`h|${d}|${f}`, lk, () => spiderPic(stunPose(f), d)));
    s.push(() => key(`d|${d}`, lk, () => spiderPic(HANG, d, W, 72, 62)));
    for (let f = 0; f < DIE_N; f++) s.push(() => key(`x|${d}|${f}`, lk, () => deathPic(d, f)));
  }
  return warmSteps(s);
});
