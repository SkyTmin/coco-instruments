// Этаж 7 — Тень из рамы (анимации мобов 7). Высокая сутулая фигура из
// фиолетового мрака: ног нет — к полу стекают дымные подтёки, руки
// длинные, до пола, с когтями; глаза — две белые точки; на плечах щепки
// позолоты от рамы. Риг мини-3D (`f15-rig.ts`), 8 сторон честно, ход —
// скольжение: подтёки и руки отстают по пути, от плеч поднимается дым.
//   • когти (`windup` 0,55 с): встаёт, руки над головой, когти врозь —
//     держит — рубит вниз; контакт — первый кадр `recover` (урон), следы
//     когтей поверх темноты;
//   • хватка `grab` (0,62 с): правая рука заведена назад, глаза
//     разгораются, дрожь — бросок; контакт — первый кадр `recover`: рука
//     вытянута, дальше её тянет зона `f7_grab`, потом убирает;
//   • выход из рамы `f7_step`: дым стягивается в фигуру, глаза последними;
//   • назад в раму `f7_back`: полупрозрачна; `escape` — тонет в полу;
//   • смерть: расплывается дымом вверх, глаза гаснут последними.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vadd, vlerp, vnorm, vsub } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
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

const SHD = tn('#0e0a1a', '#261c44', '#43346e', '#6c5aa8');
const CLAW = tn('#3a2c6c', '#6a58b4', '#8c7ad8', '#d8ccff');
const GILT = tn('#4a3216', '#86602a', '#c29a48', '#f2dc98');
const VIO_L = hx('#b49cff');

const W = 46;
const H = 46;
const AX = 23;
const AY = 36;

interface SP {
  lean: number;
  roll: number;
  twist: number;
  head: number;
  z: number;
  /** Кисти в осях курса (вперёд, вправо, высота). */
  lH: V3;
  rH: V3;
  /** Фаза подтёков и дыма; насколько подтёки тянутся назад. */
  ph: number;
  drag: number;
  eyes: number;
  /** Следы когтей: от точки над головой к кистям (0 — нет). */
  rake: number;
  claws: number;
}
const REST: SP = {
  lean: 0.14,
  roll: 0,
  twist: 0,
  head: 0.1,
  z: 0,
  lH: [1.6, -3.9, 3.2],
  rH: [1.6, 3.9, 3.2],
  ph: 0,
  drag: 0.3,
  eyes: 0.8,
  rake: 0,
  claws: 0.3,
};

function ik(a: V3, b: V3, L1: number, L2: number, pole: V3): [V3, V3] {
  const d = vsub(b, a);
  const dl = Math.max(1e-6, Math.hypot(d[0], d[1], d[2]));
  const len = Math.min(dl, (L1 + L2) * 0.999);
  const u: V3 = [d[0] / dl, d[1] / dl, d[2] / dl];
  const x = (L1 * L1 - L2 * L2 + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, L1 * L1 - x * x));
  const pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2];
  const pn = vnorm([pole[0] - u[0] * pd, pole[1] - u[1] * pd, pole[2] - u[2] * pd]);
  return [
    vadd(vadd(a, [u[0] * x, u[1] * x, u[2] * x]), [pn[0] * h, pn[1] * h, pn[2] * h]),
    vadd(a, [u[0] * len, u[1] * len, u[2] * len]),
  ];
}

const BODY: Mat = { T: SHD, bias: 0.05 };
const SMOKE: Mat = { T: SHD, bias: -0.12, soft: true };
const CLAWM: Mat = { T: CLAW, spec: true, bias: 0.2 };

function shadowRig(o: SP, yaw: number): { r: Rig; B: F3; T: F3; Hd: F3 } {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const T = B.at(0, 0, 9 + o.z)
    .turn(o.twist)
    .pitch(o.lean)
    .roll(o.roll);
  // Дымные подтёки к полу: отстают по ходу и волнуются.
  for (let i = 0; i < 4; i++) {
    const s0 = [-1.5, -0.5, 0.5, 1.5][i];
    const w1 = Math.sin(o.ph + i * 1.7) * 0.9;
    const w2 = Math.sin(o.ph + i * 1.7 - 1.3) * 1.3;
    const a = T.p(0, s0 * 1.1, 0.6);
    const b = B.p(-0.6 - 1.2 * o.drag + w1 * 0.4, s0 * 1.25 + w1, 4.2 + o.z * 0.5);
    const c = B.p(-1.0 - 2.4 * o.drag + w2 * 0.4, s0 * 1.5 + w2, 0.2);
    r.cap(a, b, 1.6, 1.1, SMOKE);
    r.cap(b, c, 1.1, 0.5, SMOKE);
  }
  // Туловище и плечи.
  r.cap(T.p(0, 0, 0), T.p(0.4, 0, 7.6), 2.8, 3.4, BODY);
  r.ell(T, [0.3, 0, 8.4], [2.3, 4.2, 1.9], BODY);
  // Голова — маленькая, вперёд; глаза — белые точки.
  const Hd = T.at(1.9 + o.head * 2, 0, 11.0 - o.head).pitch(o.head);
  r.ell(Hd, [0, 0, 0], [2.2, 2.0, 2.2], BODY);
  for (const sd of [-1, 1])
    r.dot(Hd.p(2.0, sd * 0.85, 0.3), alpha(WHITE, 0.4 + 0.6 * o.eyes), o.eyes, 1, 1);
  r.eye = Hd.p(2.0, 0, 0.3);
  // Позолота рамы на плечах.
  r.dot(T.p(0.6, -3.4, 9.6), GILT[2], 0, 1, 0.8);
  r.dot(T.p(0.2, -2.6, 10.0), GILT[1], 0, 1, 0.8);
  r.dot(T.p(0.4, 3.0, 9.8), GILT[2], 0, 1, 0.8);
  // Руки: длинные, локоть назад-наружу, на кисти — три когтя.
  for (const sd of [-1, 1]) {
    const sh = T.p(0.3, sd * 4.2, 8.4);
    const Hn = sd < 0 ? o.lH : o.rH;
    const [el, hd] = ik(
      sh,
      B.p(Hn[0], Hn[1], Hn[2]),
      7.2,
      7.6,
      vadd(T.v(-1, sd * 0.45, 0), [0, 0, -0.3]),
    );
    r.cap(sh, el, 1.35, 1.1, BODY);
    r.cap(el, hd, 1.1, 0.85, BODY);
    const dirv = vnorm(vsub(hd, el));
    for (let k = -1; k <= 1; k++) {
      const side = T.v(0, sd, 0);
      const d = vnorm(
        vadd(dirv, [side[0] * k * o.claws, side[1] * k * o.claws, k * 0.25 * o.claws]),
      );
      r.spike(hd, d, 2.4, 0.45, CLAWM, 3);
    }
  }
  return { r, B, T, Hd };
}

function shadowPic(o: SP, d: number): Pic {
  const { r, B, T } = shadowRig(o, yawOfDir(d));
  return rigPic(r, W, H, AX, AY, { outline: alpha(hx('#05030c'), 0.9), inner: 2.4 }, (out, P) => {
    // Дым от плеч: точки поднимаются и тают (фаза — от кадра).
    for (let i = 0; i < 6; i++) {
      const u = mod(o.ph / TAU + i / 6, 1);
      const sd = i % 2 ? 1 : -1;
      const [x, y] = P(T.p(-0.4 - u * 1.5, sd * (2.4 + hash(i, 3) * 1.6), 9.5 + u * 7));
      const c = u < 0.5 ? SHD[2] : SHD[1];
      out.p.set(x, y, alpha(c, 0.75 * (1 - u)));
    }
    // Следы когтей: по три дуги на кисть — путь когтей вокруг плеча от
    // точки над головой вниз-вперёд, к кисти ярче (поверх темноты).
    if (o.rake > 0) {
      const L = litOf(out);
      for (const Hn of [o.lH, o.rH]) {
        const sy = Hn[1] * 0.9;
        const r0 = 9.5;
        for (let c = -1; c <= 1; c++)
          for (let k = 0; k <= 16; k++) {
            const u = k / 16;
            const a = lerp(1.75, -0.55, u);
            const q: V3 = B.p(0.4 + Math.cos(a) * r0, sy + c * 1.1, 16 + Math.sin(a) * r0);
            const [x, y] = P(vlerp(q, B.p(Hn[0], Hn[1] + c, Hn[2] + 1), sstep(0.8, 1, u)));
            const col = c === 0 ? WHITE : VIO_L;
            L.set(x, y, alpha(col, (0.2 + 0.8 * u * u) * o.rake));
          }
      }
    }
  });
}

// ---- Позы во времени ---------------------------------------------------------------------

const CYCLE = 1.2;
const WALK_N = 8;
function walkPose(i: number): SP {
  const ph = (i / WALK_N) * TAU;
  const c = Math.cos(ph);
  return {
    ...REST,
    lean: 0.24,
    head: 0.2,
    roll: 0.05 * Math.sin(ph),
    z: 0.4 * Math.sin(2 * ph),
    lH: [1.0 + 1.8 * c, -3.9, 3.4 + 0.5 * Math.max(0, c)],
    rH: [1.0 - 1.8 * c, 3.9, 3.4 + 0.5 * Math.max(0, -c)],
    ph,
    drag: 1,
  };
}
const IDLE_N = 8;
function idlePose(i: number): SP {
  const ph = (i / IDLE_N) * TAU;
  const b = Math.sin(ph);
  return {
    ...REST,
    z: 0.3 * b,
    head: 0.1 + 0.06 * b,
    lH: [1.6, -3.9, 3.2 + 0.4 * b],
    rH: [1.6, 3.9, 3.2 - 0.4 * b],
    ph,
  };
}

const WIND_N = 14;
function windPose(f: number): SP {
  const t = (f + 0.5) / 24;
  const k = eOut3(clamp01(t / 0.3));
  const go = f === WIND_N - 1 ? 1 : 0;
  const tr = t > 0.32 && !go ? (f % 2 ? 0.3 : -0.3) : 0;
  return {
    ...REST,
    lean: lerp(REST.lean, -0.14, k) + go * 0.4,
    head: lerp(0.1, -0.2, k),
    z: 1.5 * k,
    lH: go ? [5, -3, 14] : [lerp(1.6, -0.8, k), lerp(-3.9, -4.2, k), lerp(3.2, 26, k) + tr],
    rH: go ? [5, 3, 14] : [lerp(1.6, -0.8, k), lerp(3.9, 4.2, k), lerp(3.2, 26, k) - tr],
    ph: t * 9,
    eyes: 0.8 + 0.2 * k,
    claws: lerp(0.3, 1, k),
  };
}
const REC_N = 11;
const recF = (t: number) => {
  const f = fi(t, 13);
  return f < 8 ? f : 8 + ((f - 8) >> 1);
};
const recT = (f: number) => (f < 8 ? (f + 0.5) / 24 : (8 + 2 * (f - 8) + 1) / 24);
function windRec(f: number): SP {
  const t = recT(f);
  const k = smooth(clamp01((t - 0.1) / 0.45));
  const hit: SP = {
    ...REST,
    lean: 0.5,
    head: 0.3,
    lH: [7.6, -2.4, 2.4],
    rH: [7.6, 2.4, 2.4],
    claws: 1,
    rake: 1,
    ph: 4,
  };
  const o = mix(hit, REST, k);
  o.rake = f === 0 ? 1 : Math.max(0, 1 - t / 0.2);
  return o;
}

const GRAB_N = 15;
function grabPose(f: number): SP {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.25));
  const tr = t > 0.36 ? (f % 2 ? 0.35 : -0.35) : 0;
  const go = f === GRAB_N - 1;
  return {
    ...REST,
    lean: go ? 0.4 : lerp(REST.lean, 0.0, k),
    twist: go ? 0.25 : -0.45 * k,
    head: 0.15,
    lH: [lerp(1.6, 3.2, k), lerp(-3.9, -3.2, k), lerp(3.2, 9, k)],
    rH: go ? [7, 2.6, 12] : [lerp(1.6, -4.2, k), lerp(3.9, 5.4, k), lerp(3.2, 14, k) + tr],
    ph: t * 8,
    eyes: 0.8 + 0.2 * sstep(0.1, 0.5, t),
    claws: 1,
  };
}
function grabRec(f: number): SP {
  const t = recT(f);
  const reach: SP = {
    ...REST,
    lean: 0.5,
    twist: 0.3,
    head: 0.2,
    lH: [3.2, -3.2, 9],
    rH: [10.5, 1.4, 12],
    claws: f < 3 ? 0.2 : 1,
    ph: 3,
  };
  // Держит рукой, пока тянет зона (0,32 с), потом убирает.
  return mix(reach, REST, smooth(clamp01((t - 0.25) / 0.3)));
}

function mix(a: SP, b: SP, k: number): SP {
  const v = (p: V3, q: V3) => vlerp(p, q, k);
  return {
    lean: lerp(a.lean, b.lean, k),
    roll: lerp(a.roll, b.roll, k),
    twist: lerp(a.twist, b.twist, k),
    head: lerp(a.head, b.head, k),
    z: lerp(a.z, b.z, k),
    lH: v(a.lH, b.lH),
    rH: v(a.rH, b.rH),
    ph: lerp(a.ph, b.ph, k),
    drag: lerp(a.drag, b.drag, k),
    eyes: lerp(a.eyes, b.eyes, k),
    rake: lerp(a.rake, b.rake, k),
    claws: lerp(a.claws, b.claws, k),
  };
}

function stunPose(f: number): SP {
  const k = [1, 0.8, 0.55, 0.3, 0.1][Math.min(4, f)];
  return {
    ...REST,
    lean: REST.lean - 0.45 * k,
    head: -0.3 * k,
    roll: 0.12 * k,
    lH: [lerp(1.6, -1.5, k), -5.0, lerp(3.2, 9, k)],
    rH: [lerp(1.6, -1, k), 5.2, lerp(3.2, 7, k)],
    ph: f,
    drag: -0.3 * k,
  };
}

// ---- Сцены: выход, уход, смерть ----------------------------------------------------------------

const STEP_N = 12;
function stepPic(d: number, f: number): Pic {
  const k = (f + 1) / STEP_N;
  const o = { ...idlePose(0), eyes: sstep(0.6, 1, k), z: -2 * (1 - k) };
  const pc = shadowPic(o, d);
  return {
    ...pc,
    p: dither(pc.p, 0.1 + 0.9 * eOut(k), f),
    lit: null,
    eye: k > 0.6 ? pc.eye : null,
  };
}

const SINK_N = 10;
function sinkPic(d: number, f: number): Pic {
  const k = (f + 0.5) / SINK_N;
  const pc = shadowPic({ ...idlePose(0), z: -6 * eIn(k), lean: 0.5, eyes: 1 - k }, d);
  return { ...pc, p: dither(pc.p, 1 - eIn(k), f), lit: null, eye: null };
}

const DIE_N = 20;
const DIE_T = 0.85;
function deathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / 24;
  const o = stunPose(0);
  o.eyes = t < 0.6 ? 1 : 1 - sstep(0.6, DIE_T, t);
  const { r, Hd } = shadowRig(o, yawOfDir(d));
  const k = sstep(0.08, DIE_T, t);
  // Глаза — последние два примитива перед позолотой: держим их отдельно.
  if (k > 0) r.explode(k, [0, 0, 10], 13 + d, 6, -10, 0, 0.8);
  const pc = rigPic(r, W, H, AX, AY, { outline: null, inner: 1.6 }, (out, P) => {
    // Глаза гаснут последними — поверх дыма, на прежнем месте.
    if (o.eyes > 0.05)
      for (const sd of [-1, 1]) {
        const [x, y] = P(Hd.p(2.0, sd * 0.85, 0.3 + t * 2));
        out.p.set(x, y, alpha(WHITE, o.eyes));
        litOf(out).set(x, y, alpha(WHITE, o.eyes));
      }
  });
  const fade = 1 - sstep(0.25, DIE_T, t);
  return { ...pc, p: dither(pc.p, 0.15 + 0.85 * fade, f), eye: null };
}

// ---- Рисовальщик ---------------------------------------------------------------------------

const K = kindOf('f7_shadow', 1000);
const key = (k: string, look: Look, build: () => Pic): MobFrame =>
  frameOf(K, k, false, look, build);

registerMobPainter('f7_shadow', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = Math.max(0, pose.t || 0);
  const now = pose.now || 0;
  const busy = mode === 'windup' || mode === 'grab' || mode === 'recover' || mode === 'stun';
  const v = visOf(m, pose, busy ? (m.face ?? 0) : headOf(m), busy ? 14 : 8);
  const d = dir8(v.yaw);
  const look = pose.look;
  const ex: Partial<MobFrame> = { still: true, shadow: 6 };
  let fr: MobFrame;
  if (mode === 'dying') {
    const f = fi(t, DIE_N - 1);
    fr = key(`x|${d}|${f}`, look, () => deathPic(d, f));
    ex.linger = DIE_T;
    ex.shadow = t < 0.3 ? 6 : 0;
  } else if (mode === 'escape') {
    const f = fi(t, SINK_N - 1);
    fr = key(`z|${d}|${f}`, look, () => sinkPic(d, f));
    ex.shadow = 0;
  } else if (mode === 'windup') {
    const f = fi(t, WIND_N - 1);
    fr = key(`b|${d}|${f}`, look, () => shadowPic(windPose(f), d));
  } else if (mode === 'grab') {
    const f = fi(t, GRAB_N - 1);
    fr = key(`g|${d}|${f}`, look, () => shadowPic(grabPose(f), d));
  } else if (mode === 'recover' && v.prev === 'grab') {
    const f = recF(t);
    fr = key(`q|${d}|${f}`, look, () => shadowPic(grabRec(f), d));
    if (f === 0) {
      ex.sx = 1.06;
      ex.sy = 0.95;
    }
  } else if (mode === 'recover') {
    const f = recF(t);
    fr = key(`r|${d}|${f}`, look, () => shadowPic(windRec(f), d));
    const out = 1 - smooth(clamp01((recT(f) - 0.1) / 0.45));
    ex.dx = Math.cos(v.yaw) * 2 * out;
    ex.dy = Math.sin(v.yaw) * 1.2 * out;
  } else if (mode === 'stun') {
    const f = fi(t, 4);
    fr = key(`h|${d}|${f}`, look, () => shadowPic(stunPose(f), d));
  } else if (mode === 'f7_step') {
    const f = fi(t, STEP_N - 1);
    fr = key(`e|${d}|${f}`, look, () => stepPic(d, f));
  } else if (moving(m, 0.5)) {
    const i = mod((v.dist / CYCLE) * WALK_N, WALK_N);
    fr = key(`w|${d}|${i}`, look, () => shadowPic(walkPose(i), d));
    if (mode === 'f7_back') ex.alpha = 0.55;
  } else {
    const i = mod(now * 5 + phaseOf(m) * IDLE_N, IDLE_N);
    fr = key(`i|${d}|${i}`, look, () => shadowPic(idlePose(i), d));
    if (mode === 'f7_back') ex.alpha = 0.55;
  }
  hurtFx(v, now, 2, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_shadow', () => {
  const s: (() => unknown)[] = [];
  const lk: Look = 'normal';
  for (let d = 0; d < 8; d++) {
    for (let i = 0; i < WALK_N; i++)
      s.push(() => key(`w|${d}|${i}`, lk, () => shadowPic(walkPose(i), d)));
    for (let i = 0; i < IDLE_N; i++)
      s.push(() => key(`i|${d}|${i}`, lk, () => shadowPic(idlePose(i), d)));
    for (let f = 0; f < WIND_N; f++)
      s.push(() => key(`b|${d}|${f}`, lk, () => shadowPic(windPose(f), d)));
    for (let f = 0; f < GRAB_N; f++)
      s.push(() => key(`g|${d}|${f}`, lk, () => shadowPic(grabPose(f), d)));
    for (let f = 0; f < REC_N; f++) {
      s.push(() => key(`q|${d}|${f}`, lk, () => shadowPic(grabRec(f), d)));
      s.push(() => key(`r|${d}|${f}`, lk, () => shadowPic(windRec(f), d)));
    }
    for (let f = 0; f < 5; f++)
      s.push(() => key(`h|${d}|${f}`, lk, () => shadowPic(stunPose(f), d)));
    for (let f = 0; f < STEP_N; f++) s.push(() => key(`e|${d}|${f}`, lk, () => stepPic(d, f)));
    for (let f = 0; f < SINK_N; f++) s.push(() => key(`z|${d}|${f}`, lk, () => sinkPic(d, f)));
    for (let f = 0; f < DIE_N; f++) s.push(() => key(`x|${d}|${f}`, lk, () => deathPic(d, f)));
  }
  return warmSteps(s);
});
