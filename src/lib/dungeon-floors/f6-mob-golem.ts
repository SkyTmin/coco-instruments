// Этаж 6 — Лавовый голем (анимации мобов 6). Сутулая глыба: жидкое нутро под
// четырьмя плитами базальта, между плитами тлеют швы, кулаки до земли.
// Мини-3D (риг 15-го, ×1,45), 8 сторон честно.
//
// Плиты — по `data.plates` (4…0), каждая — своя область корки: грудь
// отваливается первой (герой бьёт спереди), потом плечи, спина. Удар героя по
// корке — плита отлетает кувырком, швы вспыхивают; без плит голем жидкий:
// течёт, капает, светится — видно, что уязвим. Шаг тяжёлый (по пройденному
// пути): тело проседает на опорной ноге, пыль из-под ступни, кулаки
// волочатся. Удар двумя кулаками: замах над головой на весь `warn` (0,8 /
// жидкий 0,6), швы белеют, кулаки в землю ровно в `warn`; дальше застрял —
// рвётся наружу, выдёргивает кулаки к `warn + 1,05`. Отмокает 1,4 с: присел,
// пар, плиты нарастают по одной раскалёнными и остывают, лязг. Смерть 0,9 с:
// корка — швы добела, плиты разлетаются, нутро растекается лужей и стынет;
// жидкий — оплывает лужей.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { GOLEM } from './f6-brains';
import { F3, Rig, vadd, vlerp } from './f15-rig';
import type { Mat, RigOut, V3 } from './f15-rig';
import {
  alpha,
  angD,
  clamp,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  FIRE,
  fi,
  FPS,
  frameOf,
  hash,
  headOf,
  hurtFx,
  hx,
  kf,
  kindOf,
  litOn,
  mixc,
  mod,
  moving,
  PI,
  sstep,
  TAU,
  tn,
  trk,
  visOf,
  warmAll,
  yawN,
} from './f6-mobkit';
import type { Pic, Proj2, RGBA, Tones } from './f6-mobkit';

const ROCK = tn('#141012', '#2a2226', '#463a3c', '#6c5c58');
const CORE = tn('#5a1406', '#b8380e', '#ff7a1e', '#ffd25a');
const HOTROCK = tn('#4a1008', '#8a2410', '#d0501a', '#ff9a3a');
const EYE = hx('#ffe070');
const DUST = hx('#6e625c');
const SC = 1.45;
const Z0 = 11;

/** Порядок потери плит: грудь, левое плечо, правое плечо, спина. */
const ORDER = [3, 0, 1, 2];

interface GolO {
  fwd: number;
  z: number;
  pitch: number;
  roll: number;
  twist: number;
  head: number;
  hyaw: number;
  /** Кулаки и ступни в рамке тела-на-земле (f, s, u). */
  fist: [V3, V3];
  foot: [V3, V3];
  /** Плиты: есть 0/1 и жар 0…1 (нарастает раскалённой); слетает плита. */
  pres: number[];
  hot: number[];
  flyI: number;
  flyK: number;
  /** Швы светятся 0…1, жидкий (без корки), оплыл 0…1, разлёт корки, стынет. */
  heat: number;
  molten: boolean;
  melt: number;
  burst: number;
  dark: number;
  /** Пыль из-под ступни (0/1 — какая), пар, капли, удар (кольцо). */
  dust: number;
  steam: number;
  drip: number;
  slam: number;
  /** Мазок кулаков (кадр взмаха вниз). */
  smear: V3 | null;
}

const G0 = (): GolO => ({
  fwd: 0,
  z: Z0,
  pitch: 0.3,
  roll: 0,
  twist: 0,
  head: 0,
  hyaw: 0,
  fist: [
    [1.6, -6.2, 3.4],
    [1.6, 6.2, 3.4],
  ],
  foot: [
    [0.4, -2.8, 0],
    [0.4, 2.8, 0],
  ],
  pres: [1, 1, 1, 1],
  hot: [0, 0, 0, 0],
  flyI: -1,
  flyK: 0,
  heat: 0.4,
  molten: false,
  melt: 0,
  burst: 0,
  dark: 0,
  dust: -1,
  steam: 0,
  drip: 0,
  slam: -1,
  smear: null,
});

/** Область корки по точке единичной сферы: 0/1 — плечи, 2 — спина, 3 — грудь. */
function reg(q: V3): number {
  if (q[0] > 0.25 && q[2] < 0.45) return 3;
  if (q[0] < -0.3) return 2;
  return q[1] < 0 ? 0 : 1;
}
/** Шов: рядом другая область. */
function seam(q: V3, w: number): boolean {
  const r = reg(q);
  return (
    reg([q[0] + w, q[1], q[2]]) !== r ||
    reg([q[0] - w, q[1], q[2]]) !== r ||
    reg([q[0], q[1] + w, q[2]]) !== r ||
    reg([q[0], q[1] - w, q[2]]) !== r ||
    reg([q[0], q[1], q[2] + w]) !== r
  );
}
/** Трещины базальта: тонкие линии по сфере. */
const crackLine = (q: V3) =>
  Math.abs(Math.sin(q[0] * 7.3 + q[1] * 3.1) * Math.sin(q[2] * 6.1 - q[1] * 4.7)) < 0.07;

function golRig(o: GolO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw).scale(SC);
  const C = B.at(o.fwd, 0, o.z).pitch(o.pitch).roll(o.roll).turn(o.twist);
  const heat = clamp01(o.heat);
  const dk = o.dark;
  const melt = o.melt;
  const coreM: Mat = {
    T: CORE,
    glow: (0.3 + heat * 0.25) * (1 - dk),
    bias: -0.05 + heat * 0.15 - dk * 1.2,
    gpat: (q) => (1 - dk) * (0.3 + 0.5 * Math.max(0, Math.sin(q[0] * 5 + q[2] * 4 + q[1] * 3))),
  };
  const rockM: Mat = { T: ROCK, bias: -dk * 0.4, pat: (q) => (crackLine(q) ? ROCK[0] : null) };
  const limbM = o.molten ? coreM : rockM;
  // Нутро и корка.
  const meltK = 1 - melt * 0.85;
  const coreF = melt > 0 ? B.at(o.fwd, 0, o.z * meltK + melt * 1.2) : C;
  r.ell(coreF, [0, 0, 0], [4.1 * (1 + melt * 0.8), 5.0 * (1 + melt * 0.7), 4.5 * meltK], coreM);
  const from = r.size;
  // Ноги.
  for (let i = 0; i < 2 && (melt < 0.5 || o.burst > 0); i++) {
    const sd = i ? 1 : -1;
    const hip = C.p(-1.2, sd * 2.6, -3.6);
    const ft = B.p(o.foot[i][0] + o.fwd, o.foot[i][1], o.foot[i][2] + 1.0);
    const knee = vadd(vlerp(hip, ft, 0.5), B.v(1.0, sd * 0.4, 0.3));
    r.cap(hip, knee, 2.0 * SC, 1.7 * SC, limbM);
    r.cap(knee, ft, 1.7 * SC, 1.5 * SC, limbM);
    r.ell(
      B.at(o.foot[i][0] + o.fwd, o.foot[i][1], o.foot[i][2] + 0.9),
      [0.5, 0, 0],
      [2.0, 1.5, 1.0],
      limbM,
    );
  }
  if (!o.molten && (melt < 0.3 || o.burst > 0)) {
    const hotT = (i: number): Tones => (o.hot[i] > 0 ? mixT2(ROCK, HOTROCK, o.hot[i]) : ROCK);
    const crustM: Mat = {
      T: ROCK,
      bias: -dk * 0.4,
      pat: (q) => {
        const i = reg(q);
        if (o.hot[i] > 0) return hotT(i)[crackLine(q) ? 0 : 2];
        // Кромка плит тлеет — к удару раскаляется добела.
        if (seam(q, 0.26))
          return heat > 0.8 ? FIRE[4] : heat > 0.6 ? FIRE[3] : heat > 0.4 ? FIRE[2] : HOTROCK[1];
        return crackLine(q) ? ROCK[0] : null;
      },
      gpat: (q) => {
        const i = reg(q);
        if (o.hot[i] > 0) return o.hot[i] * 0.7;
        return seam(q, 0.26) ? (0.3 + heat * 0.7) * (1 - dk) : 0;
      },
    };
    r.ell(C, [0, 0, 0.1], [4.5, 5.5, 4.9], crustM, (q) => !o.pres[reg(q)] || seam(q, 0.12));
  }
  // Слетающая плита: своя рамка, кувырком.
  if (o.flyI >= 0 && o.flyK > 0) {
    const k = o.flyK;
    const i = o.flyI;
    const out: V3 =
      i === 3 ? [1, 0, 0] : i === 2 ? [-1, 0, 0] : i === 0 ? [0, -1, 0.3] : [0, 1, 0.3];
    const P = C.at(out[0] * k * 7, out[1] * k * 7, out[2] * k * 7 + k * 6 - k * k * 14)
      .roll(k * 2.4)
      .pitch(k * 1.6);
    r.ell(
      P,
      [0, 0, 0.1],
      [4.5, 5.5, 4.9],
      { T: ROCK, pat: (q) => (crackLine(q) ? ROCK[0] : null) },
      (q) => reg(q) !== i,
    );
  }
  // Голова — низко между плеч, глаза-щели.
  const H = C.at(3.4, 0, 2.6).turn(o.hyaw).pitch(o.head);
  if (melt < 0.5 || o.burst > 0) {
    r.ell(H, [0, 0, 0], [2.0, 2.2, 1.8], o.molten ? coreM : rockM);
    for (const sd of [-1, 1]) r.dot(H.p(1.75, sd * 0.85, 0.2), EYE, 0.9 * (1 - dk), 1, 2.2);
    r.line(H.p(1.6, -1.3, 0.7), H.p(1.7, 1.3, 0.7), ROCK[0], 0, 1.2);
  }
  r.eye = H.p(1.75, (Math.cos(yaw) >= 0 ? 1 : -1) * 0.85, 0.2);
  // Руки: плечо → локоть → кулак.
  if (melt < 0.5 || o.burst > 0)
    for (let i = 0; i < 2; i++) {
      const sd = i ? 1 : -1;
      const S = C.p(0.6, sd * 5.0, 2.0);
      const F = B.p(o.fist[i][0] + o.fwd, o.fist[i][1], o.fist[i][2]);
      const el = vadd(vlerp(S, F, 0.5), B.v(-1.2, sd * 1.8, 0.4));
      r.cap(S, el, 1.9 * SC, 1.6 * SC, limbM);
      r.cap(el, F, 1.6 * SC, 1.5 * SC, limbM);
      r.ell(
        B.at(o.fist[i][0] + o.fwd, o.fist[i][1], o.fist[i][2]),
        [0, 0, 0],
        [2.2, 2.0, 2.0],
        limbM,
      );
    }
  if (o.burst > 0) r.explode(o.burst, C.p(0, 0, -1), 7, 7, 18, from, 0.4);
  return r;
}

function mixT2(a: Tones, b: Tones, k: number): Tones {
  return [mixc(a[0], b[0], k), mixc(a[1], b[1], k), mixc(a[2], b[2], k), mixc(a[3], b[3], k)];
}

// ---- Позы ----------------------------------------------------------------------------

/** Ход: фаза 0…1, ступни по шагу, проседание, кулаки качаются. */
function walk(o: GolO, ph: number, molten: boolean): void {
  const L = 3.4;
  let low = 0;
  for (let i = 0; i < 2; i++) {
    const ps = mod((ph + i * 0.5) * 1000, 1000) / 1000;
    let f = 0;
    let u = 0;
    if (ps < 0.5) f = L - 2 * L * (ps / 0.5);
    else {
      const k = (ps - 0.5) / 0.5;
      f = -L + 2 * L * k;
      u = Math.sin(PI * k) * 1.8;
    }
    o.foot[i] = [f, i ? 2.8 : -2.8, u];
    if (ps < 0.1) {
      o.dust = i;
      low = 1 - ps / 0.1;
    }
    // Кулак — против ноги своей стороны.
    o.fist[i] = [1.6 - f * 0.5, i ? 6.3 : -6.3, 3.4 + Math.max(0, -f) * 0.25];
  }
  o.z = Z0 - 0.4 - 0.7 * low + 0.4 * Math.abs(Math.sin(ph * TAU));
  o.roll = 0.06 * Math.cos(ph * TAU);
  o.twist = 0.08 * Math.sin(ph * TAU);
  o.pitch = molten ? 0.45 : 0.38;
  o.head = -0.1;
  if (molten) o.drip = 1;
}

function golPose(anim: string, f: number, plates: number, T = 0.8): GolO {
  const o = G0();
  const molten = plates <= 0;
  o.molten = molten;
  for (let i = 0; i < 4; i++) o.pres[ORDER[i]] = i < plates ? 1 : 0;
  o.heat = molten ? 1 : 0.35 + (4 - plates) * 0.12;
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: дышит — плечи вверх, швы светятся в такт.
      const a = (f / 8) * TAU;
      o.z = Z0 + 0.35 * Math.sin(a);
      o.heat += 0.15 * Math.sin(a);
      o.hyaw = 0.15 * Math.sin(a * 0.5);
      o.fist[0][2] += 0.3 * Math.sin(a);
      o.fist[1][2] += 0.3 * Math.sin(a);
      if (molten) o.drip = 1;
      o.steam = molten ? 1 : 0;
      break;
    }
    case 'walk':
      walk(o, f / 10, molten);
      break;
    case 'wind': {
      // Замах на весь `warn`: подъём (до 0,55), держит, дрожь, швы белеют
      // (до 0,88), удар двумя кулаками (до 1 — в землю ровно в `warn`).
      const k = kf(f, T);
      const up = trk(k, [
        [0, 3.4],
        [0.55, 23, easeOut],
        [0.88, 23.5],
        [0.94, 18],
        [1, 1.8, easeIn],
      ]);
      const fw = trk(k, [
        [0, 1.6],
        [0.55, 0.2, easeOut],
        [0.88, -0.2],
        [0.94, 6],
        [1, 8.8, easeIn],
      ]);
      const sp = trk(k, [
        [0, 6.2],
        [0.55, 1.6, easeOut],
        [0.88, 1.5],
        [1, 1.8],
      ]);
      const shake = k > 0.55 && k < 0.88 ? (f % 2 ? 0.25 : -0.25) : 0;
      o.fist = [
        [fw, -sp, up + shake],
        [fw, sp, up - shake],
      ];
      o.pitch = trk(k, [
        [0, 0.3],
        [0.55, -0.3, easeOut],
        [0.88, -0.32],
        [1, 0.6, easeIn],
      ]);
      o.z =
        Z0 +
        trk(k, [
          [0, 0],
          [0.55, 1.6, easeOut],
          [0.88, 1.8],
          [1, -1.6, easeIn],
        ]);
      o.roll = shake * 0.12;
      o.head = trk(k, [
        [0, 0],
        [0.55, -0.35],
        [0.88, -0.4],
        [1, 0.3],
      ]);
      o.heat = Math.max(o.heat, 0.4 + 0.6 * sstep(0.3, 0.85, k));
      if (k > 0.89 && k < 0.99) o.smear = [fw - 3, 0, up + 6];
      break;
    }
    case 'slamf': {
      // После удара 1,05 с: кулаки в земле (до 0,17), застрял — рвётся (до
      // 0,6), выдёргивает и выпрямляется (до 1,05).
      const t = f < 4 ? f / FPS : f < 8 ? 0.167 + (f - 4) * 0.108 : 0.6 + (f - 8) * 0.056;
      const out = sstep(0.6, 1.05, t);
      const up = 1.8 + (3.4 - 1.8) * out + (t > 0.6 ? Math.sin(PI * out) * 3 : 0);
      const fw = 8.8 + (1.6 - 8.8) * easeOut(out);
      const sp = 1.8 + (6.2 - 1.8) * out;
      const heave = t > 0.17 && t < 0.6 ? Math.sin((t - 0.17) * 22) : 0;
      o.fist = [
        [fw, -sp, up],
        [fw, sp, up],
      ];
      o.pitch = 0.6 - 0.3 * out + heave * 0.05;
      o.z = Z0 - 1.6 + (t < 0.08 ? -0.6 * Math.sin(PI * (t / 0.08)) : 0) + 1.6 * out + heave * 0.4;
      o.roll = heave * 0.06;
      o.head = 0.3 - 0.3 * out + heave * 0.1;
      o.heat = Math.max(o.heat, 1 - 0.6 * sstep(0, 0.5, t));
      o.slam = t < 0.3 ? t / 0.3 : -1;
      break;
    }
    case 'crack': {
      // Плита отлетела (0,33 с, 8 кадров): отпрянул, швы вспыхнули.
      const k = f / 7;
      o.flyI = ORDER[plates] ?? -1;
      o.flyK = k;
      o.pitch = 0.3 - 0.25 * Math.sin(PI * k);
      o.z = Z0 + 0.4 * Math.sin(PI * k);
      o.heat = Math.max(o.heat, 1 - 0.6 * k);
      o.head = -0.2 * Math.sin(PI * k);
      break;
    }
    case 'harden': {
      // 1,4 с (34 кадра): присел у лавы, пар; плиты нарастают по одной
      // раскалёнными и стынут; в конце — выпрямился с лязгом.
      const t = f / FPS;
      const target = plates;
      o.molten = false;
      const dn = sstep(0, 0.25, t) * (1 - sstep(1.22, 1.4, t));
      o.z = Z0 - 2.4 * dn;
      o.pitch = 0.3 + 0.25 * dn;
      o.fist = [
        [3.2, -5.6, 3.4 - 1.6 * dn],
        [3.2, 5.6, 3.4 - 1.6 * dn],
      ];
      o.foot = [
        [1.2 * dn, -3.2, 0],
        [-0.6 * dn, 3.2, 0],
      ];
      for (let i = 0; i < 4; i++) {
        const t0 = 0.3 + i * 0.22;
        const on = i < target && t >= t0;
        o.pres[ORDER[i]] = on ? 1 : 0;
        o.hot[ORDER[i]] = on ? 1 - sstep(t0, t0 + 0.45, t) : 0;
      }
      o.heat = 1 - 0.6 * sstep(0.3, 1.3, t);
      o.steam = 1 - sstep(1.1, 1.4, t);
      o.head = 0.2 * dn;
      break;
    }
    case 'alert': {
      const k = f / 8;
      const up = Math.sin(PI * Math.min(1, k * 1.3));
      o.pitch = 0.3 - 0.35 * up;
      o.z = Z0 + 0.8 * up;
      o.head = -0.35 * up;
      o.heat = 0.4 + 0.5 * up;
      o.fist[0][2] += 1.5 * up;
      o.fist[1][2] += 1.5 * up;
      break;
    }
    case 'sleep': {
      o.z = Z0 - 1.6 + (f % 2) * 0.2;
      o.pitch = 0.55;
      o.head = 0.35;
      o.heat = 0.15 + (f % 2) * 0.05;
      o.fist = [
        [3.6, -5.2, 1.9],
        [3.6, 5.2, 1.9],
      ];
      break;
    }
    case 'die': {
      // 0,9 с (22 кадра). Корка: швы добела, дрожь (до 0,25), плиты
      // разлетаются, нутро растекается (до 0,55) и стынет. Жидкий —
      // оплывает лужей сразу.
      const t = f / FPS;
      if (!molten) {
        o.heat = 0.6 + 0.4 * sstep(0, 0.2, t);
        o.roll = t < 0.25 ? (f % 2 ? 0.06 : -0.06) : 0;
        o.z = Z0 + (t < 0.25 ? 0.6 * (t / 0.25) : 0);
        o.burst = sstep(0.24, 0.6, t);
        o.melt = sstep(0.25, 0.6, t);
      } else {
        o.melt = sstep(0, 0.5, t);
        o.z = Z0 - 5 * o.melt;
        o.drip = 1 - o.melt;
      }
      o.dark = sstep(0.45, 0.85, t);
      o.pitch = 0.3 + 0.3 * o.melt;
      o.fist[0][2] -= 1.4 * o.melt;
      o.fist[1][2] -= 1.4 * o.melt;
      break;
    }
  }
  return o;
}

const GK = kindOf('f6_golem', 64, 64, 32, 50, 3400);

/** Анимация с числом плит: `walk3`, `wind2_80`, `harden4`. */
function parse(anim: string): [string, number, number] {
  const m = /^([a-z]+)(\d)(?:_(\d+))?$/.exec(anim);
  if (!m) return [anim, 4, 0.8];
  return [m[1], Number(m[2]), m[3] ? Number(m[3]) / 100 : 0.8];
}

function golPic(anim: string, f: number, d: number): Pic {
  const [a, plates, T] = parse(anim);
  const o = golPose(a, f, plates, T);
  const yaw = yawN(d);
  return draw(GK, golRig(o, yaw), (out, P) => post(out, P, o, yaw, f, a));
}

function post(out: RigOut, P: Proj2, o: GolO, yaw: number, f: number, a: string): void {
  const B = F3.yaw(yaw).scale(SC);
  // Пыль из-под опорной ступни (жидкий — брызги).
  if (o.dust >= 0) {
    const ft = o.foot[o.dust];
    const [x, y] = P(B.p(ft[0] + o.fwd, ft[1], 0));
    for (let i = 0; i < 4; i++) {
      const sx = Math.round(x + (i - 1.5) * 2.4);
      const sy = Math.round(y - (i % 2));
      out.p.set(sx, sy, o.molten ? FIRE[2] : alpha(DUST, 0.85));
    }
  }
  // Капли нутра с рук.
  if (o.drip > 0)
    for (let i = 0; i < 2; i++) {
      const fs = o.fist[i];
      const k = mod(f * 0.17 + i * 0.5, 1);
      const [x, y] = P(B.p(fs[0] + o.fwd, fs[1], fs[2] - 1.5 - k * 3));
      out.p.set(Math.round(x), Math.round(y), FIRE[3]);
      litOn(out).set(Math.round(x), Math.round(y), FIRE[3]);
    }
  // Пар (отмокает / жидкий): клубы вверх.
  if (o.steam > 0)
    for (let i = 0; i < 3; i++) {
      const k = mod(f * 0.06 + i / 3, 1);
      const [x, y] = P(B.p(-1 + i, (i - 1) * 3, o.z + 6 + k * 9));
      const c = alpha(hx('#c8bcb4'), 0.55 * (1 - k) * o.steam);
      out.p.ell(x + Math.sin(k * 6 + i) * 1.5, y, 1.3 + k * 2, 1 + k * 1.5, c);
    }
  // Удар: кольцо пыли и осколки из-под кулаков.
  if (o.slam >= 0) {
    const [x, y] = P(B.p(8.8, 0, 0));
    const R = 4 + o.slam * 10;
    for (let i = 0; i < 14; i++) {
      const an = (i / 14) * TAU;
      out.p.set(
        Math.round(x + Math.cos(an) * R),
        Math.round(y + Math.sin(an) * R * 0.45),
        alpha(DUST, 0.9 * (1 - o.slam)),
      );
    }
    for (let i = 0; i < 6; i++) {
      const an = hash(i, 5) * TAU;
      const v = 0.6 + hash(i, 6) * 0.6;
      const k = o.slam;
      const px = x + Math.cos(an) * k * 12 * v;
      const py = y + Math.sin(an) * k * 5 * v - (k * 10 - k * k * 12) * v;
      out.p.set(Math.round(px), Math.round(py), i % 2 ? ROCK[3] : FIRE[2]);
    }
  }
  // Мазок кулаков на взмахе вниз.
  if (o.smear) {
    const s = o.smear;
    const to = o.fist[0];
    for (let i = 1; i <= 4; i++) {
      const k = i / 5;
      const [x, y] = P(B.p(s[0] + (to[0] - s[0]) * k, 0, s[2] + (to[2] - s[2]) * k));
      for (const sd of [-1, 1]) {
        const c: RGBA = alpha(FIRE[3], 0.35 + k * 0.4);
        out.p.set(Math.round(x + sd * 3), Math.round(y), c);
      }
    }
  }
  if (a === 'die') {
    // Лужа стынет: края темнеют, угли мигают.
    const t = f / FPS;
    if (o.melt > 0.3) {
      const lit = litOn(out);
      const [x, y] = P(B.p(0, 0, 0.6));
      for (let i = 0; i < 5; i++)
        if (hash(i, f, 3) < 1 - sstep(0.55, 0.9, t)) {
          const px = Math.round(x + (hash(i, 7) - 0.5) * 16);
          const py = Math.round(y + (hash(i, 8) - 0.5) * 5);
          out.p.set(px, py, FIRE[3]);
          lit.set(px, py, FIRE[3]);
        }
    }
  }
}

registerMobPainter('f6_golem', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const plates = clamp(Math.round(m.data?.plates ?? GOLEM.plates), 0, 4);
  const tech = md === 'f6_slam' || md === 'alert';
  const want = tech ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, tech ? 6 : 3.2);
  const d = dirN(v.yaw);
  // Плита отвалилась: число плит уменьшилось — запомнить, когда.
  const was = v.n.plates ?? plates;
  if (plates < was && md !== 'f6_harden') v.n.crack = now;
  v.n.plates = plates;
  const ex: Partial<MobFrame> = { shadow: 11, still: true };
  let anim = `idle${plates}`;
  let f = 0;
  if (md === 'dying') {
    anim = `die${plates > 0 ? 1 : 0}`;
    f = fi(t, 21);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.78, 0.9, t);
    ex.shadow = 11 * (1 - sstep(0.3, 0.7, t));
  } else if (md === 'f6_slam') {
    const warn = m.data?.warn ?? GOLEM.slamWarn;
    if (t < warn) {
      const n = Math.max(1, Math.round(warn * FPS));
      anim = `wind${plates}_${Math.round(warn * 100)}`;
      f = fi(t, n - 1);
    } else {
      const s = t - warn;
      anim = `slamf${plates}`;
      f =
        s < 0.167
          ? Math.floor(s * FPS)
          : s < 0.6
            ? 4 + Math.floor((s - 0.167) / 0.108)
            : 8 + Math.floor((s - 0.6) / 0.056);
      f = clamp(f, 0, 15);
      if (f === 0) {
        ex.sx = 1.08;
        ex.sy = 0.92;
      }
    }
  } else if (md === 'f6_harden') {
    anim = `harden${m.data?.harden ? 2 : 4}`;
    f = fi(t, 33);
  } else if (md === 'sleep') {
    anim = `sleep${plates}`;
    f = Math.floor(now * 0.9 + hash(id, 3) * 2) % 2;
  } else if (md === 'alert') {
    anim = `alert${plates}`;
    f = fi(t, 8);
  } else if (moving(m, 0.3)) {
    anim = `walk${plates}`;
    f = Math.floor((v.dist / 1.2) * 10) % 10;
    const turn = angD(want, v.yaw);
    ex.rot = clamp(turn * 0.05, -0.05, 0.05);
  } else {
    anim = `idle${plates}`;
    f = Math.floor((now + hash(id, 7) * 3) * 6) % 8;
  }
  if (md !== 'dying') {
    const ca = now - (v.n.crack ?? -9);
    if (ca >= 0 && ca < 0.33 && md !== 'f6_slam' && md !== 'f6_harden') {
      anim = `crack${plates}`;
      f = Math.min(7, Math.floor(ca * FPS));
    }
    const age = hurtFx(v, now, plates > 0 ? 0.5 : 1.0, ex);
    // Жидкий от удара колышется.
    if (age >= 0 && plates === 0) {
      const w = Math.sin(age * 40) * (1 - age / 0.25) * 0.08;
      ex.sx = (ex.sx ?? 1) * (1 + w);
      ex.sy = (ex.sy ?? 1) * (1 - w);
    }
  }
  if (md === 'stun') ex.dx = (ex.dx ?? 0) + (Math.floor(now * 40) % 2 ? 0.6 : -0.6);
  return { ...frameOf(GK, anim, f, d, pose, () => golPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_golem', function* () {
  for (const p of [4, 0]) {
    yield* warmAll(
      GK,
      [
        [`walk${p}`, 10],
        [`idle${p}`, 8],
        [`wind${p}_${p ? 80 : 60}`, p ? 19 : 14],
        [`slamf${p}`, 16],
        [`die${p ? 1 : 0}`, 22],
      ],
      golPic,
    );
  }
  yield* warmAll(
    GK,
    [
      ['crack3', 8],
      ['crack0', 8],
      ['harden4', 34],
      ['alert4', 9],
      ['sleep4', 2],
    ],
    golPic,
  );
  // Треснувшая корка (1–3 плиты): под ударами героя голем проходит её каждый
  // круг — без прогрева это ~40 новых кадров за 8 с толпы.
  for (const p of [3, 2, 1]) {
    yield* warmAll(
      GK,
      [
        [`walk${p}`, 10],
        [`idle${p}`, 8],
        [`wind${p}_80`, 19],
        [`slamf${p}`, 16],
        ...(p < 3 ? ([[`crack${p}`, 8]] as [string, number][]) : []),
      ],
      golPic,
    );
  }
});
