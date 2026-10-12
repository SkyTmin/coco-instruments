// Этаж 7 — Призма (анимации мобов 7). Парящая трёхгранная призма из
// фиолетового стекла с остриями сверху и снизу; по граням бежит косая
// радуга (преломление), блик — на ребре к свету. Риг мини-3D
// (`f15-rig.ts`): призма вращается вокруг своей оси (12 кадров на треть
// оборота), сторон у неё нет — в прицеле она останавливается гранью к цели.
//   • прицел `aim`: до 0,45 с вращение разгоняется и стекло накаляется
//     (четыре ступени), в 0,45 замирает гранью к цели (луч мозга уже лёг),
//     налив и дрожь до 0,95; кадр контакта — первый кадр `recover` (урон
//     лучей): белая вспышка, отдача вверх, лучи радуги; остывает и снова
//     вращается;
//   • подъём из подставки `f7_rise` (0,9 с): растёт из света, крутится;
//   • смерть: трещит, вспыхивает, разлетается гранями с радужными искрами.

import { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig } from './f15-rig';
import type { Mat, RGBA, Tones, V3 } from './f15-rig';
import {
  PI,
  TAU,
  WHITE,
  alpha,
  clamp01,
  dither,
  dress,
  eOut,
  fi,
  frameOf,
  hurtFx,
  hx,
  kindOf,
  lerp,
  litOf,
  mixc,
  mod,
  phaseOf,
  rigPic,
  rigYaw,
  sstep,
  tn,
  visOf,
  warmSteps,
} from './f7-mobkit';
import type { Look, Pic } from './f7-mobkit';

const PRT = tn('#3c2a70', '#6a58b4', '#a8a0ec', '#eee8ff');
const RAINBOW = ['#ff5a7a', '#ffb050', '#fff080', '#80f0a0', '#70c8ff', '#b890ff'].map((c) =>
  hx(c),
);

const W = 30;
const H = 40;
const AX = 15;
const AY = 34;

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

const SPIN_N = 12;
const SECTOR = TAU / 3;

interface PP {
  /** Поворот вокруг оси (рад), подъём, крен (удар героя), масштаб (подъём из подставки). */
  spin: number;
  z: number;
  roll: number;
  scale: number;
  /** Накал 0…1 и ширина радуги. */
  hot: number;
  /** Вспышка выстрела 0…1 (лучи радуги поверх темноты). */
  burst: number;
}
const REST: PP = { spin: 0, z: 0, roll: 0, scale: 1, hot: 0, burst: 0 };

function prismRig(o: PP): { r: Rig; P: F3 } {
  const r = new Rig();
  const P = F3.yaw(o.spin, [0, 0, 2 + o.z])
    .roll(o.roll)
    .scale(o.scale);
  const R = 5;
  const z0 = 5;
  const z1 = 17;
  const wide = 0.16 + 0.16 * o.hot;
  // Радуга преломления: косая полоса по граням, бежит с поворотом.
  const glass: Mat = {
    T:
      o.hot > 0.6 ? (PRT.map((c, i) => mixc(c, WHITE, 0.15 * i * o.hot)) as unknown as Tones) : PRT,
    pat: (q, l) => {
      if (l > 0.93) return WHITE;
      const a = Math.atan2(q[1], q[0]) - o.spin;
      const v = mod((a / TAU + q[2] / 26) * 1000 + o.spin * 160, 1000) / 1000;
      if (v < wide) return RAINBOW[Math.min(5, Math.floor((v / wide) * 6))];
      return band(PRT, l + 0.25 * o.hot);
    },
    gpat: (q) => {
      const a = Math.atan2(q[1], q[0]) - o.spin;
      const v = mod((a / TAU + q[2] / 26) * 1000 + o.spin * 160, 1000) / 1000;
      return v < wide ? 0.35 + 0.6 * o.hot : 0.35 * o.hot;
    },
  };
  const e = (i: number, z: number): V3 =>
    P.p(R * Math.cos(i * SECTOR), R * Math.sin(i * SECTOR), z);
  const top = P.p(0, 0, z1 + 7);
  const bot = P.p(0, 0, z0 - 6);
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    r.poly([e(i, z0), e(j, z0), e(j, z1), e(i, z1)], glass);
    r.poly([e(i, z1), e(j, z1), top], { ...glass, bias: 0.15 });
    r.poly([e(i, z0), e(j, z0), bot], { ...glass, bias: -0.2 });
    r.line(e(i, z0), e(i, z1), PRT[3], 0.3 * o.hot, 0.4);
  }
  r.eye = P.p(0, 0, 11);
  return { r, P };
}

function prismPic(o: PP): Pic {
  const { r, P } = prismRig(o);
  return rigPic(r, W, H, AX, AY, { outline: alpha(hx('#10101a'), 0.85), inner: 2 }, (out, Pj) => {
    if (o.burst <= 0) return;
    // Выстрел: белое тело и лучи радуги во все стороны (поверх темноты).
    const L = litOf(out);
    for (let y = 0; y < out.p.h; y++)
      for (let x = 0; x < out.p.w; x++)
        if (out.p.solid(x, y)) L.set(x, y, alpha(WHITE, 0.9 * o.burst));
    const [cx, cy] = Pj(P.p(0, 0, 10));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      const n = Math.round(4 + 9 * o.burst);
      for (let s = 7; s < 7 + n; s++)
        L.set(cx + Math.cos(a) * s, cy + Math.sin(a) * s * 0.8, alpha(RAINBOW[i], o.burst));
    }
  });
}

// ---- Кадры ---------------------------------------------------------------------------------

const spinOf = (i: number) => (i / SPIN_N) * SECTOR;
/** Кадр вращения, при котором грань смотрит на курс `a` (игровой угол). */
function lockOf(a: number): number {
  const s = rigYaw(a) - PI / 3;
  return mod(Math.round((mod(s * 1000, SECTOR * 1000) / 1000 / SECTOR) * SPIN_N), SPIN_N);
}

const LOCK_N = 12;
const REC_N = 14;
const recF = (t: number) => {
  const f = fi(t, 21);
  return f < 8 ? f : 8 + ((f - 8) >> 1);
};
const recT = (f: number) => (f < 8 ? (f + 0.5) / 24 : (8 + 2 * (f - 8) + 1) / 24);

const RISE_N = 22;
function risePic(f: number): Pic {
  const t = (f + 0.5) / 24;
  const k = eOut(clamp01(t / 0.8));
  const pc = prismPic({
    ...REST,
    spin: spinOf(f),
    scale: lerp(0.25, 1, k),
    z: lerp(-2, 0, k),
    hot: 0.6 * (1 - k),
  });
  // Столб света из подставки гаснет к концу.
  const L = new Px(pc.p.w, pc.p.h);
  if (pc.lit) L.data.set(pc.lit.data);
  const g = 1 - sstep(0.4, 0.9, t);
  for (let y = 0; y < AY + 2; y++)
    for (let x = AX - 2; x <= AX + 2; x++) {
      const edge = Math.abs(x - AX) === 2;
      L.set(x, y, alpha(edge ? RAINBOW[(y >> 2) % 6] : WHITE, (edge ? 0.35 : 0.55) * g * (y / AY)));
    }
  return { ...pc, p: dither(pc.p, 0.3 + 0.7 * sstep(0, 0.4, t), f), lit: L };
}

const DIE_N = 20;
const DIE_T = 0.85;
function deathPic(f: number): Pic {
  const t = (f + 0.5) / 24;
  const o: PP = { ...REST, spin: spinOf(f % 2 ? 1 : 0), hot: t < 0.15 ? 1 : 0.3 };
  const { r, P } = prismRig(o);
  const ex = clamp01((t - 0.12) / 0.6);
  if (ex > 0) r.explode(eOut(ex), P.p(0, 0, 10), 21, 11, 22, 0, 0.45);
  const pc = rigPic(
    r,
    W,
    H,
    AX,
    AY,
    { outline: alpha(hx('#10101a'), 0.85), inner: 2 },
    (out, Pj) => {
      const L = litOf(out);
      if (t < 0.15)
        for (let y = 0; y < out.p.h; y++)
          for (let x = 0; x < out.p.w; x++) if (out.p.solid(x, y)) L.set(x, y, alpha(WHITE, 0.7));
      // Радужные искры разлетаются и гаснут.
      const [cx, cy] = Pj(P.p(0, 0, 10));
      if (ex > 0 && ex < 0.8)
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + 0.4;
          const R = 3 + 16 * eOut(ex) * (0.6 + 0.08 * (i % 5));
          L.set(
            cx + Math.cos(a) * R,
            cy + Math.sin(a) * R * 0.8 + ex * ex * 8,
            alpha(RAINBOW[i % 6], 1 - ex),
          );
        }
    },
  );
  const fade = 1 - sstep(0.45, DIE_T, t);
  return { ...pc, p: dither(pc.p, fade, f), eye: null };
}

function stunPose(f: number, i: number): PP {
  const k = [1, 0.7, 0.4, 0.15, 0][Math.min(4, f)];
  return { ...REST, spin: spinOf(i), roll: 0.35 * k * (f % 2 ? -1 : 1), z: 1.5 * k };
}

// ---- Рисовальщик ---------------------------------------------------------------------------

const K = kindOf('f7_prism', 520);
const key = (k: string, look: Look, build: () => Pic): MobFrame =>
  frameOf(K, k, false, look, build);

const aimPic = (i: number, hk: number) => prismPic({ ...REST, spin: spinOf(i), hot: hk / 4 });
const lockPic = (L: number, f: number) =>
  prismPic({
    ...REST,
    spin: spinOf(L) + (f % 2 ? 0.02 : -0.02),
    hot: 0.75 + 0.25 * (f / LOCK_N),
    z: 0.4 * (f % 2),
  });
function recPic(L: number, f: number): Pic {
  const t = recT(f);
  const cool = 1 - sstep(0, 0.5, t);
  // Остывает и снова набирает вращение (кадр поворота — от замка).
  const spin = spinOf(L) + Math.max(0, t - 0.25) ** 2 * 3;
  return prismPic({
    ...REST,
    spin,
    hot: 0.9 * cool,
    burst: f === 0 ? 1 : f < 4 ? 1 - f / 4 : 0,
    z: 2 * cool,
  });
}

registerMobPainter('f7_prism', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = Math.max(0, pose.t || 0);
  const now = pose.now || 0;
  const v = visOf(m, pose, m.face ?? 0, 20);
  const look = pose.look;
  const ph = phaseOf(m);
  const bob = Math.sin(now * 2 + ph * TAU);
  const ex: Partial<MobFrame> = { still: true, shadow: 4, lift: 6 + Math.round(bob) };
  const idle = mod(now * 10 + ph * SPIN_N, SPIN_N);
  let fr: MobFrame;
  if (mode === 'dying') {
    const f = fi(t, DIE_N - 1);
    fr = key(`x|${f}`, look, () => deathPic(f));
    ex.linger = DIE_T;
    ex.lift = 6;
  } else if (mode === 'aim' && t < 0.45) {
    // Разгон: угол вращения растёт быстрее с каждым мигом прицела.
    const i = mod(now * 10 + ph * SPIN_N + t * t * 60, SPIN_N);
    const hk = Math.min(3, Math.floor((t / 0.45) * 4));
    fr = key(`a|${i}|${hk}`, look, () => aimPic(i, hk));
    ex.lift = 6;
  } else if (mode === 'aim') {
    const L = lockOf(m.face ?? 0);
    const f = fi(t - 0.45, LOCK_N - 1);
    fr = key(`l|${L}|${f}`, look, () => lockPic(L, f));
    ex.lift = 6;
  } else if (mode === 'recover') {
    const L = lockOf(m.face ?? 0);
    const f = recF(t);
    fr = key(`r|${L}|${f}`, look, () => recPic(L, f));
    ex.lift = 6 + Math.round(2 * (1 - sstep(0, 0.5, t)));
    if (f === 0) {
      ex.sx = 1.1;
      ex.sy = 0.92;
    }
  } else if (mode === 'f7_rise') {
    const f = fi(t, RISE_N - 1);
    fr = key(`u|${f}`, look, () => risePic(f));
    ex.lift = Math.round(6 * eOut(clamp01(t / 0.8)));
  } else if (mode === 'stun') {
    const f = fi(t, 4);
    fr = key(`h|${f}|${idle}`, look, () => prismPic(stunPose(f, idle)));
  } else fr = key(`i|${idle}`, look, () => prismPic({ ...REST, spin: spinOf(idle) }));
  hurtFx(v, now, 1.5, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_prism', () => {
  const s: (() => unknown)[] = [];
  const lk: Look = 'normal';
  for (let i = 0; i < SPIN_N; i++) {
    s.push(() => key(`i|${i}`, lk, () => prismPic({ ...REST, spin: spinOf(i) })));
    for (let hk = 0; hk < 4; hk++) s.push(() => key(`a|${i}|${hk}`, lk, () => aimPic(i, hk)));
    for (let f = 0; f < LOCK_N; f++) s.push(() => key(`l|${i}|${f}`, lk, () => lockPic(i, f)));
    for (let f = 0; f < REC_N; f++) s.push(() => key(`r|${i}|${f}`, lk, () => recPic(i, f)));
  }
  for (let f = 0; f < RISE_N; f++) s.push(() => key(`u|${f}`, lk, () => risePic(f)));
  for (let f = 0; f < DIE_N; f++) s.push(() => key(`x|${f}`, lk, () => deathPic(f)));
  return warmSteps(s);
});
