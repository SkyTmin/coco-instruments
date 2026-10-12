// Этаж 7 — Стекольщик-воришка (анимации мобов 7). Ушастый гоблин со
// стеклянной кожей, в кожаном фартуке и очках-зеркальцах; мешок с золотом
// закинут за правое плечо и держится правой рукой. Не бьёт — удирает и
// ныряет в зеркала. Риг мини-3D (`f15-rig.ts`), 8 сторон честно (мешок и
// рука несимметричны).
//   • бег — по пройденному пути, 8 фаз: ноги не скользят, свободная рука
//     машет навстречу ноге, мешок подпрыгивает с запаздыванием; раз в
//     полторы-две секунды оглядывается через левое плечо (фаза — от id);
//   • покой — переминается и косится по сторонам;
//   • нырок в зеркало `f7_dive`: присел — прыжок «рыбкой» к стеклу —
//     растворяется в стекле голубой каймой; дальше пусто, пока мир держит
//     его в зеркале (сторона прыжка — `m.data.vDive` из мозга);
//   • выход из зеркала `f7_step`: вылетает из стекла, приземляется с
//     вжатием, оглядывается налево-направо — и дальше бежать;
//   • `escape` — подпрыгивает и рассыпается бликами (после нырка — пусто);
//   • удар героя — отброс, мешок подлетает, из него выскакивает монета;
//   • смерть — мешок слетает, монеты веером, стеклянное тело разлетается
//     осколками, `linger` 0,8 с.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, SE, vadd, vnorm, vsub } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  GOLD,
  INK,
  PI,
  TAU,
  WHITE,
  alpha,
  clamp01,
  dir8,
  dither,
  dress,
  eOut,
  emptyFrame,
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
  rimOf,
  sstep,
  tn,
  visOf,
  warmSteps,
  yawOfDir,
} from './f7-mobkit';
import type { Look, Pic } from './f7-mobkit';

const SKIN = tn('#28395a', '#4a78a2', '#88badc', '#e2f6ff');
const LEATHER = tn('#2e2018', '#5a4430', '#7a6044', '#9a7c5a');
const APRON = tn('#3e2a18', '#6a4a2c', '#8a6a42', '#a88a5c');
const SACK = tn('#4a3418', '#86683a', '#b89a5c', '#e0c890');
const SILV = tn('#394252', '#667588', '#a9b8cb', '#eef4fc');
const CYAN_HOT = hx('#e0fbff');
const CYAN = hx('#7ae0ff');
const GOLD_HI = hx('#fff0a0');

const SC = 1.3;
const W = 40;
const H = 40;
const AX = 20;
const AY = 32;

interface TP {
  /** Высота таза над полом (подскок, присед). */
  z: number;
  lean: number;
  roll: number;
  twist: number;
  /** Поворот головы: − — через левое плечо назад. */
  look: number;
  nod: number;
  /** Ступни и свободная (левая) кисть — в осях курса. */
  lF: V3;
  rF: V3;
  lH: V3;
  /** Мешок: сдвиг от покоя в осях корпуса (запаздывание). */
  sack: V3;
}
const ZH = 5.2;
const REST: TP = {
  z: 0,
  lean: 0.18,
  roll: 0,
  twist: 0,
  look: 0,
  nod: 0,
  lF: [0.2, -1.5, 0.6],
  rF: [0.2, 1.5, 0.6],
  lH: [1.2, -3.0, 3.2],
  sack: [0, 0, 0],
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

const SKM: Mat = { T: SKIN, bias: 0.05 };
const EARM: Mat = { T: SKIN, bias: 0.12 };
const LEM: Mat = { T: LEATHER };
const APM: Mat = { T: APRON, bias: 0.05 };
const SAM: Mat = { T: SACK, bias: 0.08 };
const GOG: Mat = { T: SILV, spec: true, bias: 0.3 };

/** Риг гоблина. */
function thiefRig(o: TP, yaw: number): { r: Rig; B: F3; T: F3; Hd: F3; sackC: V3 } {
  const r = new Rig();
  const B = F3.yaw(yaw).scale(SC);
  const zH = ZH + o.z;
  const T = B.at(0, 0, zH).turn(o.twist).pitch(o.lean).roll(o.roll);
  // Ноги: бедро — колено (вперёд) — сапог.
  for (const sd of [-1, 1]) {
    const F = sd < 0 ? o.lF : o.rF;
    const hip = B.p(0, sd * 1.25, zH - 0.4);
    const foot = B.p(F[0], F[1], F[2]);
    const [knee, ank] = ik(hip, foot, 3.0 * SC, 2.9 * SC, B.v(1, sd * 0.2, 0.1));
    r.cap(hip, knee, 1.05 * SC, 0.9 * SC, LEM);
    r.cap(knee, ank, 0.9 * SC, 0.8 * SC, LEM);
    r.ell(new F3(ank, B.f, B.s, B.u), [0.6, 0, -0.35], [1.45, 0.85, 0.65], LEM);
  }
  // Таз и грудь (стекло), фартук спереди.
  r.ell(T, [0, 0, 0.3], [1.7, 2.0, 1.3], APM);
  r.cap(T.p(0, 0, 0.8), T.p(0.15, 0, 3.6), 1.9 * SC, 2.2 * SC, SKM);
  r.ell(T, [1.05, 0, 1.6], [1.1, 1.8, 2.3], APM);
  // Мешок за спиной: висит на правом плече, запаздывает за корпусом.
  const sackC = T.p(-2.5 + o.sack[0], 0.5 + o.sack[1], 4.0 + o.sack[2]);
  r.ell(new F3(sackC, T.f, T.s, T.u), [0, 0, 0], [2.2, 2.5, 2.6], SAM);
  const neck = T.p(-1.4 + o.sack[0] * 0.5, 1.2, 6.4 + o.sack[2] * 0.5);
  r.cap(vadd(sackC, T.v(0.3, 0.2, 1.8)), neck, 0.8 * SC, 0.5 * SC, SAM);
  r.dot(vadd(sackC, T.v(-0.6, -0.8, 2.3)), GOLD, 0.35, 1, 0.9);
  // Голова: шар, уши-лопухи назад-вверх, нос, очки-зеркальца.
  const Hd = T.at(0.55, 0, 6.6).turn(o.look).pitch(o.nod);
  r.ell(Hd, [0, 0, 0], [2.4, 2.6, 2.2], SKM);
  for (const sd of [-1, 1]) {
    r.spike(Hd.p(-0.4, sd * 2.1, 0.7), Hd.v(-0.55, sd * 1, 0.75), 3.0 * SC, 0.95 * SC, EARM, 3);
    r.ell(Hd, [2.0, sd * 0.95, 0.45], [0.45, 0.8, 0.8], GOG);
  }
  r.spike(Hd.p(2.2, 0, -0.3), Hd.v(1, 0, -0.5), 0.85 * SC, 0.6 * SC, SKM, 3);
  r.line(Hd.p(2.0, -0.8, -1.05), Hd.p(2.0, 0.8, -1.05), INK, 0, 0.3);
  r.eye = Hd.p(2.35, 0, 0.5);
  // Правая рука держит горловину мешка над плечом.
  {
    const sh = T.p(0.1, 2.1, 3.5);
    const [el, hd] = ik(sh, neck, 2.3 * SC, 2.2 * SC, T.v(0.4, 1, -0.6));
    r.cap(sh, el, 0.75 * SC, 0.65 * SC, SKM);
    r.cap(el, hd, 0.65 * SC, 0.6 * SC, SKM);
    r.ball(hd, 0.8 * SC, SKM);
  }
  // Левая — свободная: машет на бегу.
  {
    const sh = T.p(0.1, -2.1, 3.5);
    const [el, hd] = ik(
      sh,
      B.p(o.lH[0], o.lH[1], o.lH[2]),
      2.3 * SC,
      2.2 * SC,
      T.v(-1, -0.5, -0.2),
    );
    r.cap(sh, el, 0.75 * SC, 0.65 * SC, SKM);
    r.cap(el, hd, 0.65 * SC, 0.6 * SC, SKM);
    r.ball(hd, 0.8 * SC, SKM);
  }
  return { r, B, T, Hd, sackC };
}

/** Блики на стекле очков — поверх темноты, по кадру. */
function thiefPic(o: TP, d: number, glint: number): Pic {
  const { r, Hd } = thiefRig(o, yawOfDir(d));
  return rigPic(r, W, H, AX, AY, {}, (out, P) => {
    if (glint < 0) return;
    const L = litOf(out);
    for (const sd of [-1, 1]) {
      const q = Hd.p(2.45, sd * 0.95 - 0.25, 0.85);
      // Только если очки смотрят на зрителя хоть немного.
      if (Hd.f[1] < -0.35) continue;
      const [x, y] = P(q);
      const c = glint === sd + 1 ? WHITE : CYAN_HOT;
      out.p.set(x, y, c);
      L.set(x, y, alpha(c, 0.7));
    }
  });
}

// ---- Позы во времени ----------------------------------------------------------------------

const CYCLE = 1.35;
const RUN_N = 8;
/** Бег: фаза 0…7, `lk` — 0 вперёд, 1 полуоборот, 2 оглянулся. */
function runPose(i: number, lk: number): TP {
  const ph = (i / RUN_N) * TAU;
  const c = Math.cos(ph);
  const s = Math.sin(ph);
  const foot = (p: number, sd: number): V3 => [
    2.3 * Math.cos(p) + 0.3,
    sd * 1.35,
    0.6 + 1.9 * Math.max(0, -Math.sin(p)),
  ];
  return {
    ...REST,
    z: 0.45 * Math.cos(2 * ph) - 0.15,
    lean: 0.42 - (lk ? 0.12 : 0),
    roll: 0.06 * s,
    twist: 0.14 * c - lk * 0.12,
    look: [0, -0.9, -1.75][lk],
    nod: lk === 2 ? -0.15 : 0.05,
    lF: foot(ph, -1),
    rF: foot(ph + PI, 1),
    lH: [0.6 - 2.1 * c, -2.9, 4.6 + 0.9 * Math.max(0, -c)],
    // Мешок отстаёт от подскока на ~70°.
    sack: [-0.35 * Math.cos(ph - 1.2), 0, 0.7 * Math.cos(2 * ph - 1.2)],
  };
}

const IDLE_N = 8;
function idlePose(i: number): TP {
  const ph = (i / IDLE_N) * TAU;
  const s = Math.sin(ph);
  // Переминается: вес с ноги на ногу, косится то влево, то вправо.
  return {
    ...REST,
    z: -0.2 - 0.2 * Math.abs(s),
    roll: 0.07 * s,
    look: 0.55 * Math.sin(ph - 0.6),
    lF: [0.2, -1.5, 0.6 + 0.6 * Math.max(0, -s)],
    rF: [0.2, 1.5, 0.6 + 0.6 * Math.max(0, s)],
    lH: [1.4 + 0.4 * s, -2.8, 3.4 + 0.3 * Math.cos(ph)],
    sack: [0, 0, 0.25 * Math.sin(ph - 1)],
  };
}

const HURT_N = 5;
function hurtPose(f: number): TP {
  const k = [1, 0.85, 0.6, 0.35, 0.12][Math.min(4, f)];
  return {
    ...REST,
    z: -0.4 * k,
    lean: REST.lean - 0.55 * k,
    roll: 0.15 * k,
    look: 0.3 * k,
    nod: -0.3 * k,
    lF: [0.9 * k + 0.2, -1.6, 0.6],
    rF: [-0.6 * k + 0.2, 1.5, 0.6],
    lH: [lerp(1.2, -0.5, k), -3.6, lerp(3.2, 8.5, k)],
    sack: [-0.6 * k, 0, 1.6 * k],
  };
}

// ---- Нырок, выход, уход, смерть ----------------------------------------------------------

/** Прыжок «рыбкой»: k 0 — присел, 1 — вытянут к стеклу. */
function divePose(k: number): TP {
  const c = 1 - k;
  return {
    ...REST,
    z: lerp(-1.6, 1.4, k),
    lean: lerp(0.75, 1.25, k),
    look: 0,
    nod: lerp(0.2, -0.5, k),
    lF: [lerp(-0.6, -3.4, k), -1.2, lerp(0.6, 3.6, k)],
    rF: [lerp(-0.2, -3.8, k), 1.2, lerp(0.6, 4.2, k)],
    lH: [lerp(-1.6, 5.2, k), -1.6, lerp(2.4, 7.2, k)],
    sack: [-0.4 * c, 0, 0.6 * c + 0.8 * k],
  };
}
const DIVE_N = 9;
/** Кадр нырка: 0–1 присед, 2–5 прыжок, 5–8 растворяется в стекле. */
function divePic(d: number, f: number): Pic {
  const k = f < 2 ? 0 : eOut(clamp01((f - 1) / 4));
  const pc = thiefPic(divePose(k), d, -1);
  if (f < 5) return pc;
  const g = (f - 4) / (DIVE_N - 4);
  const rim = rimOf(pc.p, CYAN_HOT, f, 2);
  const body = dither(pc.p, 1 - g, f);
  // Тело уходит в стекло: остаётся голубая кайма, по ней бегут блики.
  for (let i = 0; i < rim.data.length; i += 4)
    if (rim.data[i + 3] && !body.data[i + 3]) {
      body.data[i] = CYAN[0];
      body.data[i + 1] = CYAN[1];
      body.data[i + 2] = CYAN[2];
      body.data[i + 3] = Math.round(255 * (1 - g * 0.7));
    }
  return { ...pc, p: body, lit: rim, eye: null };
}

const STEP_N = 12;
/** Выход: вылетает из стекла (0–3), приземляется (4–5), оглядывается (6–11). */
function stepPose(f: number): TP {
  if (f < 4) return divePose(1 - f / 6);
  if (f < 6) {
    const k = f === 4 ? 1 : 0.6;
    return {
      ...REST,
      z: -1.5 * k,
      lean: 0.55,
      lF: [0.9, -1.7, 0.6],
      rF: [-0.5, 1.7, 0.6],
      lH: [2.2, -3.4, 2.0],
      sack: [0, 0, -1.0 * k],
    };
  }
  const u = (f - 6) / 5;
  return {
    ...REST,
    z: -0.6 * (1 - u),
    lean: 0.3,
    look: f < 9 ? -0.8 : 0.7,
    nod: 0.1,
    lH: [1.6, -3.2, 3.0],
    sack: [0, 0, 0.3 * Math.sin(u * PI)],
  };
}
function stepPic(d: number, f: number): Pic {
  const pc = thiefPic(stepPose(f), d, f >= 6 ? (f >> 1) % 3 : -1);
  if (f >= 4) return pc;
  const k = (f + 1) / 5;
  const body = dither(pc.p, 0.2 + 0.8 * k, f);
  return { ...pc, p: body, lit: rimOf(pc.p, CYAN_HOT, f, 2), eye: null };
}

const ESC_N = 10;
/** Уход насовсем: присел — подскок — рассыпался бликами. */
function escPic(d: number, f: number): Pic {
  const k = f < 3 ? 0 : clamp01((f - 2) / 3);
  const o = f < 3 ? { ...divePose(0), lean: 0.5 } : { ...divePose(0.25), z: 2 + 2 * k, lean: 0.2 };
  const { r, Hd } = thiefRig(o, yawOfDir(d));
  const g = clamp01((f - 4) / (ESC_N - 5));
  const pc = rigPic(r, W, H, AX, AY, {}, (out, P) => {
    if (f < 4) return;
    const L = litOf(out);
    for (let i = 0; i < 9; i++) {
      const a = hash(i, 5, 7) * TAU;
      const rr = 2 + g * (4 + hash(i, 6, 7) * 6);
      const q = vadd(Hd.p(-1.5, 0, -2.5), [Math.cos(a) * rr, Math.sin(a) * rr, g * 4]);
      const [x, y] = P(q);
      const c = i % 3 ? CYAN_HOT : GOLD_HI;
      L.set(x, y, alpha(c, 1 - g * 0.8));
      out.p.set(x, y, alpha(c, 1 - g * 0.8));
    }
  });
  if (f < 4) return pc;
  return { ...pc, p: dither(pc.p, 1 - g, f), eye: null };
}

const DIE_N = 19;
const DIE_T = 0.8;
/** Монеты из мешка: веер вверх и в стороны, падают на пол. */
const COINS = 8;
function deathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / 24;
  const k0 = clamp01(t / 0.12);
  const o = hurtPose(0);
  o.z = -0.6 - 2.6 * sstep(0.1, 0.4, t);
  o.lean = lerp(REST.lean - 0.55, -0.9, sstep(0.08, 0.35, t));
  o.sack = [
    -1.6 * k0 - 3 * eOut(clamp01((t - 0.06) / 0.3)),
    0,
    2.2 * k0 + 1.5 * Math.sin(clamp01(t / 0.35) * PI),
  ];
  const { r, sackC } = thiefRig(o, yawOfDir(d));
  const k = sstep(0.18, DIE_T, t);
  if (k > 0) r.explode(k, [0, 0, 5], 31 + d, 7, 22, 0, 0.7);
  const pc = rigPic(r, W, H, AX, AY, { inner: 1.6 }, (out, P) => {
    const L = litOf(out);
    for (let i = 0; i < COINS; i++) {
      const t0 = 0.05 + hash(i, 2, 9) * 0.12;
      const tt = t - t0;
      if (tt <= 0) continue;
      const a = (i / COINS) * TAU + hash(i, 3, 9);
      const sp = 4 + hash(i, 4, 9) * 5;
      const vz = 9 + hash(i, 5, 9) * 6;
      let z = vz * tt - 26 * tt * tt;
      const land = z < -sackC[2];
      if (land) z = -sackC[2];
      const q: V3 = vadd(sackC, [
        Math.cos(a) * sp * Math.min(tt, 0.55),
        Math.sin(a) * sp * Math.min(tt, 0.55),
        z,
      ]);
      const [x, y] = P(q);
      const spin = (f + i) % 3;
      out.p.set(x, y, spin === 0 ? GOLD_HI : GOLD);
      if (spin !== 2) out.p.set(x + 1, y, GOLD);
      L.set(x, y, alpha(GOLD_HI, land ? 0.35 : 0.8));
    }
  });
  const fade = 1 - sstep(0.45, DIE_T, t);
  return { ...pc, p: dither(pc.p, 0.2 + 0.8 * fade, f), eye: t < 0.15 ? pc.eye : null };
}

// ---- Рисовальщик ---------------------------------------------------------------------------

const K = kindOf('f7_thief', 900);
const key = (k: string, look: Look, build: () => Pic): MobFrame =>
  frameOf(K, k, false, look, build);
const run = (d: number, i: number, lk: number, look: Look) =>
  key(`w|${d}|${i}|${lk}`, look, () => thiefPic(runPose(i, lk), d, -1));
const idle = (d: number, i: number, look: Look) =>
  key(`i|${d}|${i}`, look, () => thiefPic(idlePose(i), d, i % 4 === 0 ? i >> 2 : -1));
const hurt = (d: number, f: number, look: Look) =>
  key(`h|${d}|${f}`, look, () => thiefPic(hurtPose(f), d, -1));
const dive = (d: number, f: number, look: Look) => key(`v|${d}|${f}`, look, () => divePic(d, f));
const step = (d: number, f: number, look: Look) => key(`e|${d}|${f}`, look, () => stepPic(d, f));
const esc = (d: number, f: number, look: Look) => key(`z|${d}|${f}`, look, () => escPic(d, f));
const die = (d: number, f: number, look: Look) => key(`x|${d}|${f}`, look, () => deathPic(d, f));

/** Оглядывается раз в ~1,7 с (своя фаза у каждого): 0 — вперёд, 2 — назад. */
function lookBack(m: Mob, now: number): number {
  const c = mod((now * 0.6 + phaseOf(m)) * 1000, 1000) / 1000;
  if (c > 0.56 && c < 0.8) return 2;
  if (c > 0.51 && c < 0.85) return 1;
  return 0;
}

registerMobPainter('f7_thief', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = Math.max(0, pose.t || 0);
  const now = pose.now || 0;
  const diveA = m.data?.vDive;
  const want =
    mode === 'f7_dive' && typeof diveA === 'number'
      ? diveA
      : mode === 'f7_step' || mode === 'stun' || mode === 'dying'
        ? (m.face ?? 0)
        : headOf(m, 0.5);
  const v = visOf(m, pose, want, mode === 'f7_dive' || mode === 'f7_step' ? 40 : 10);
  const d = dir8(v.yaw);
  const look = pose.look;
  const ex: Partial<MobFrame> = { still: true, shadow: 4 };
  let fr: MobFrame;
  if (mode === 'dying') {
    fr = die(d, fi(t, DIE_N - 1), look);
    ex.linger = DIE_T;
    ex.shadow = t < 0.3 ? 4 : 0;
  } else if (mode === 'f7_dive') {
    const f = fi(t, DIVE_N);
    if (f >= DIVE_N) return emptyFrame();
    fr = dive(d, f, look);
    // Прыжок к стеклу: вперёд по стороне нырка и дугой вверх.
    const u = f < 2 ? 0 : eOut(clamp01((f - 1) / 6));
    const a = (d * PI) / 4;
    ex.dx = Math.cos(a) * 9 * u;
    ex.dy = Math.sin(a) * 9 * SE * u - 5 * Math.sin(u * PI);
    ex.shadow = f < 5 ? 4 : 0;
  } else if (mode === 'escape') {
    if (v.prev === 'f7_dive') return emptyFrame();
    const f = fi(t, ESC_N - 1);
    fr = esc(d, f, look);
    ex.shadow = f < 6 ? 4 : 0;
  } else if (mode === 'f7_step') {
    const f = fi(t, STEP_N - 1);
    fr = step(d, f, look);
    if (f < 4) {
      // Летит из стекла: сзади (со стороны зеркала) — к месту приземления.
      const u = (f + 1) / 4;
      const a = (d * PI) / 4;
      ex.dx = -Math.cos(a) * 7 * (1 - u);
      ex.dy = -Math.sin(a) * 7 * SE * (1 - u) - 4 * Math.sin(u * PI * 0.9);
    } else if (f === 4) {
      ex.sx = 1.14;
      ex.sy = 0.86;
    } else if (f === 5) {
      ex.sx = 1.06;
      ex.sy = 0.95;
    }
  } else if (mode === 'stun') {
    fr = hurt(d, fi(t, HURT_N - 1), look);
  } else if (moving(m, 0.5)) {
    const i = mod((v.dist / CYCLE) * RUN_N, RUN_N);
    fr = run(d, i, lookBack(m, now), look);
  } else {
    const i = mod(now * 7 + phaseOf(m) * IDLE_N, IDLE_N);
    fr = idle(d, i, look);
  }
  hurtFx(v, now, 2, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_thief', () => {
  const s: (() => unknown)[] = [];
  const lk: Look = 'normal';
  for (let d = 0; d < 8; d++) {
    for (let i = 0; i < RUN_N; i++) for (let b = 0; b < 3; b++) s.push(() => run(d, i, b, lk));
    for (let i = 0; i < IDLE_N; i++) s.push(() => idle(d, i, lk));
    for (let f = 0; f < HURT_N; f++) s.push(() => hurt(d, f, lk));
    for (let f = 0; f < DIVE_N; f++) s.push(() => dive(d, f, lk));
    for (let f = 0; f < STEP_N; f++) s.push(() => step(d, f, lk));
    for (let f = 0; f < ESC_N; f++) s.push(() => esc(d, f, lk));
    for (let f = 0; f < DIE_N; f++) s.push(() => die(d, f, lk));
  }
  return warmSteps(s);
});
