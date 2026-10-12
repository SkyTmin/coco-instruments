// Этаж 8 — Фонарный дух, тётин-обакэ (анимации мобов 8). Прежний облик:
// бумажный фонарь-бочонок с рёбрами, чёрный лак шапки и донца, петля
// сверху, один глаз, рот-прореха и длинный розовый язык. Светится изнутри
// (бумага отдаёт свет в слой поверх темноты). Мини-3D, 8 сторон — лицо
// честно поворачивается по бочонку.
//
// Метроном мозга (`f8-brains.ts`, `f8_lantern`, летун): из пропасти
// `f8_rise` 0,9 с (недосягаем до 0,7) — всплывает и загорается. Кружит на 4,2
// клетки. Плевок `aim` 0,6 с: весь — подготовка: раздувается, язык втянут,
// пламя внутри ярчает, прищур, дрожь; в 0,6 — плевок тремя огоньками
// (первый кадр `gutter`: отдача назад, пасть настежь, вспышка). Выдохся
// `gutter` 1,5 с (окно): пламя чадит, бумага тускнеет, опускается к герою,
// язык висит; в конце снова разгорается. Смерть — бумага горит и опадает,
// остов падает, масло на полу рисует зона `f8_oil`.

import type { Mob } from '../dungeon-sim';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  carry,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  F3,
  fi,
  frameOf,
  FPS,
  hash,
  hurtF,
  hurtFx,
  hx,
  kindOf,
  lerp,
  mod,
  moving,
  Rig,
  sampleKeys,
  sstep,
  tn,
  TAU,
  vadd,
  visOf,
  warmAll,
  yawN,
  type PKey,
  type Pic,
  type PoseO,
  type RGBA,
  type V3,
} from './f8-mobkit';

const PAPER = tn('#b09460', '#e0c890', '#f8e8b8', '#fff8e0');
const PAPER_DIM = tn('#6a5a40', '#8e7a58', '#ad9670', '#c8b088');
const CHAR = tn('#140c08', '#2a1a10', '#3e2818', '#5a3a20');
const LACQ = { T: tn('#0c0808', '#1e1414', '#342424', '#4e3636'), spec: true };
const TONGUE = { T: tn('#6a1a2a', '#b83a52', '#e8607a', '#ffa0b0') };
const SCLERA = { T: tn('#a89c88', '#e0d8c8', '#f8f4ec', '#ffffff') };
const FIRE = { T: tn('#a02808', '#e86018', '#ffb030', '#fff0a0'), glow: 1, soft: true };

/** Поза фонаря — числа. */
interface LnO extends PoseO {
  /** Наклон вперёд (рад), крен вбок, раздутие 0…1. */
  tilt: number;
  sw: number;
  sc: number;
  /** Пасть 0…1, веко 0 (открыт)…1, пламя внутри 0…1. */
  mo: number;
  lid: number;
  glow: number;
  /** Язык: длина 0…1, мах вбок, снос назад, загиб вверх. */
  tl: number;
  tsw: number;
  tb: number;
  tup: number;
  /** Смерть: прогорело 0…1, сплющился 0…1. */
  burn: number;
  crush: number;
}

const B0: LnO = {
  tilt: 0,
  sw: 0,
  sc: 0,
  mo: 0.25,
  lid: 0,
  glow: 0.75,
  tl: 1,
  tsw: 0,
  tb: 0,
  tup: 0,
  burn: 0,
  crush: 0,
};

/** Плевок 0,6: раздувается, язык втянут, пламя ярчает, прищур; конец — дрожь. */
const AIM: PKey<LnO>[] = carry<LnO>([
  [0, {}],
  [0.18, { tilt: -0.22, sc: 0.35, mo: 0.05, tl: 0.35, tup: 0.6, lid: 0.3, glow: 0.9 }, easeOut],
  [0.5, { tilt: -0.3, sc: 0.75, mo: 0.15, tl: 0.15, tup: 1, lid: 0.55, glow: 1 }],
  [0.6, { tilt: -0.34, sc: 0.85, mo: 0.2 }],
]);
/** Выдох: отдача назад, пасть настежь, язык хлещет вперёд, потом обмякает. */
const SPIT: PKey<LnO>[] = carry<LnO>([
  [0, { tilt: 0.45, sc: -0.15, mo: 1, tl: 1.2, tup: -0.4, tb: -1, lid: 0, glow: 1 }],
  [0.08, { tilt: -0.25, sc: -0.2, mo: 0.8, tl: 1.1, tb: 0.6, glow: 0.6 }, easeOut],
  [0.25, { tilt: 0.1, sc: -0.12, mo: 0.45, tl: 1.25, tb: 0, tup: 0, lid: 0.55, glow: 0.25 }],
]);
const GUT: LnO = { ...B0, tilt: 0.12, sc: -0.12, mo: 0.45, tl: 1.25, lid: 0.6, glow: 0.2 };
const FLINCH: PKey<LnO>[] = [
  [0, {}],
  [0.05, { tilt: -0.5, sw: 0.25, mo: 0.8, lid: 0, tb: 1, glow: 1 }, easeOut],
  [0.2, {}],
];
/** Смерть 0,8: шок, бумага вспыхивает снизу, сплющивается, остов чадит. */
const DIE: PKey<LnO>[] = carry<LnO>([
  [0, { sc: 0.3, mo: 1, lid: 0, glow: 1, tilt: -0.3 }],
  [0.1, { sc: 0.4, burn: 0.15, tl: 0.8 }],
  [
    0.42,
    { burn: 0.75, crush: 0.45, sc: 0, tilt: 0.35, sw: 0.3, tl: 0.5, glow: 0.6, mo: 0.6 },
    easeIn,
  ],
  [0.6, { burn: 1, crush: 0.62, tilt: 0.6, sw: 0.45, tl: 0.3, glow: 0.2 }],
  [0.8, { crush: 0.68, glow: 0 }],
]);

// ---- Поза по кадру ---------------------------------------------------------------------

const IDLE_N = 12;
const MOVE_N = 8;
/** Выдох: плевок 6 кадров, чад кольцом 8, разгорается 7. */
const GUT_N = 21;

function poseAt(anim: string, f: number): [LnO, LnO] {
  const t = (f + 0.5) / FPS;
  const lagT = t - 3 / FPS;
  const at = (keys: PKey<LnO>[], T: number) => sampleKeys(B0, keys, Math.max(0, T));
  switch (anim) {
    case 'idle':
    case 'move': {
      const mv = anim === 'move';
      const N = mv ? MOVE_N : IDLE_N;
      const mk = (q: number): LnO => ({
        ...B0,
        tilt: mv ? 0.16 + Math.sin(q * 2) * 0.03 : Math.sin(q) * 0.05,
        sw: Math.sin(q) * (mv ? 0.06 : 0.1),
        tsw: Math.sin(q - 0.6) * 0.8,
        tb: mv ? 1 : Math.sin(q * 0.5) * 0.2,
        mo: 0.25 + Math.max(0, Math.sin(q * 2)) * 0.12,
        // Моргание раз в цикл покоя.
        lid: !mv && f === 7 ? 1 : !mv && (f === 6 || f === 8) ? 0.5 : 0,
        glow: 0.7 + Math.sin(q * 3) * 0.08,
      });
      const q = (f / N) * TAU;
      return [mk(q), mk(q - 0.9)];
    }
    case 'aim': {
      const o = at(AIM, t);
      if (t > 0.48) o.sc += f % 2 ? 0.06 : -0.03;
      return [o, at(AIM, lagT)];
    }
    case 'gut': {
      if (f < 6) return [at(SPIT, t), at(SPIT, lagT)];
      if (f < 14) {
        // Чадит: пламя мерцает низко, язык качается висом.
        const q = ((f - 6) / 8) * TAU;
        const mk = (p: number): LnO => ({
          ...GUT,
          sw: Math.sin(p) * 0.06,
          tsw: Math.sin(p - 0.5) * 0.5,
          glow: 0.16 + (hash(f, 3) > 0.6 ? 0.12 : 0),
        });
        return [mk(q), mk(q - 0.8)];
      }
      const k = easeOut((f - 13) / 7);
      const o = sampleKeys(
        GUT,
        [
          [0, {}],
          [1, { ...B0 }],
        ],
        k,
      );
      return [o, o];
    }
    case 'flinch':
      return [at(FLINCH, t), at(FLINCH, lagT)];
    case 'stun': {
      const q = (f / 6) * TAU;
      const o: LnO = {
        ...B0,
        sw: Math.sin(q) * 0.25,
        tilt: Math.cos(q) * 0.15,
        lid: 0.5,
        mo: 0.6,
        tsw: Math.sin(q - 1) * 1.2,
        glow: 0.5,
      };
      return [o, { ...o, sw: Math.sin(q - 1) * 0.25 }];
    }
    case 'die': {
      const o = at(DIE, t);
      return [o, at(DIE, lagT)];
    }
    case 'rise': {
      // Всплывает тёмным, к концу загорается и открывает глаз.
      const k = clamp01(t / 0.9);
      const o: LnO = {
        ...B0,
        glow: 0.05 + 0.9 * sstep(0.45, 0.85, k),
        lid: 1 - sstep(0.6, 0.85, k),
        tb: -0.8 * (1 - k),
        tl: 0.7 + 0.3 * k,
        mo: 0.1,
      };
      return [o, { ...o, tb: -1 }];
    }
  }
  return [B0, B0];
}

// ---- Риг -------------------------------------------------------------------------------

const RX = 5.4;
const RZ = 7.0;
const CZ = 10;

interface LnJ {
  C: F3;
  mouth: V3;
  eye: V3;
  top: V3;
}

const IRIS_T = tn('#a03000', '#ff6a10', '#ffa030', '#ffe080');

/**
 * Бумага: рёбра, прогар — и лицо узором прямо на бумаге (глаз и пасть не
 * тонут в бочонке и видны с любой стороны, где видна передняя сторона).
 */
function paperMat(o: LnO, dead: boolean) {
  const T = o.glow < 0.35 ? PAPER_DIM : PAPER;
  const open = 1 - o.lid;
  // Лицо: азимут от «вперёд» и высота на единичной сфере.
  const face = (q: V3): number => {
    if (q[0] < 0.2) return 0;
    const az = Math.atan2(q[1], q[0]);
    const z = q[2];
    // Глаз чуть правее середины.
    const ex = (az - 0.16) / 0.66;
    const ez = (z - 0.3) / (0.08 + 0.26 * open);
    if (o.burn < 0.6) {
      if (open > 0.15) {
        const ix = (az - 0.22) / 0.3;
        const iz = (z - 0.28) / (0.07 + 0.13 * open);
        if (ix * ix + iz * iz < 1) return dead ? 5 : 3;
        if (ex * ex + ez * ez < 1) return 2;
      } else if (Math.abs(ex) < 1 && Math.abs(z - 0.3) < 0.05) return 5;
    }
    // Пасть-прореха: тёмная, внутри огонь.
    if (o.mo > 0.12) {
      const mx = (az + 0.02) / 0.78;
      const mz = (z + 0.32) / (0.06 + 0.24 * o.mo);
      const m2 = mx * mx + mz * mz;
      if (m2 < 0.45 && o.mo > 0.3) return 4;
      if (m2 < 1) return 5;
    }
    return 0;
  };
  return {
    T,
    glow: 0.15 + 0.5 * o.glow,
    pat: (q: V3, l: number): RGBA | null => {
      const fc = face(q);
      if (fc === 2) return l > 0.45 ? SCLERA.T[3] : SCLERA.T[2];
      if (fc === 3) return l > 0.4 ? IRIS_T[2] : IRIS_T[1];
      if (fc === 4) return FIRE.T[2];
      if (fc === 5) return CHAR[0];
      // Прогорело: снизу вверх неровным краем — уголь, край тлеет.
      if (o.burn > 0) {
        const edge =
          -1 +
          o.burn * 2.4 +
          (hash(Math.floor(q[0] * 5 + 9), Math.floor(q[1] * 5 + 9)) - 0.5) * 0.5;
        if (q[2] < edge - 0.25) return CHAR[1];
        if (q[2] < edge) return hx('#ff7a20');
      }
      // Рёбра: тёмные кольца бочонка.
      const b = (q[2] + 1) * 4.5;
      if (b - Math.floor(b) < 0.16) return T[0];
      return null;
    },
    gpat: (q: V3) => {
      const fc = face(q);
      if (fc === 3 || fc === 4) return 1;
      if (o.burn > 0) {
        const edge = -1 + o.burn * 2.4;
        return q[2] < edge && q[2] > edge - 0.3 ? 1 : 0;
      }
      return 0;
    },
  };
}

function lnRig(r: Rig, o: LnO, lag: LnO, yaw: number, dead: boolean): LnJ {
  const B = F3.yaw(yaw);
  const zc = CZ * (1 - o.crush * 0.55);
  const C = B.at(0, 0, zc).pitch(o.tilt).roll(o.sw);
  const sx = RX * (1 + o.sc * 0.22);
  const sz = RZ * (1 + o.sc * 0.08) * (1 - o.crush);
  // Бумага, шапка, донце, петля.
  r.ell(C, [0, 0, 0], [sx, sx, sz], paperMat(o, dead));
  r.ell(C, [0, 0, sz * 0.97], [3.0, 3.0, 0.8], LACQ);
  r.ell(C, [0, 0, -sz * 0.97], [2.9, 2.9, 0.75], LACQ);
  const top = C.p(0, 0, sz + 1.4);
  if (!dead || o.crush < 0.5) {
    r.cap(C.p(0, -1.6, sz + 0.6), C.p(0, -1.2, sz + 2.4), 0.35, 0.35, LACQ);
    r.cap(C.p(0, 1.6, sz + 0.6), C.p(0, 1.2, sz + 2.4), 0.35, 0.35, LACQ);
    r.cap(C.p(0, -1.2, sz + 2.4), C.p(0, 1.2, sz + 2.4), 0.35, 0.35, LACQ);
  }
  // Лицо — узором бумаги (`paperMat`); здесь только точки глаза и пасти.
  const eyeP = C.p(sx * 0.95, sx * 0.16, sz * 0.32);
  const open = 1 - o.lid;
  const mz = -sz * 0.3;
  const mouth = C.p(sx * 1.0, 0, mz);
  // Язык: четыре звена из пасти — висит, отстаёт по позе в прошлом, загибается.
  if (o.tl > 0.05) {
    let pt = C.p(sx * 0.98, 0, mz - 0.3 * o.mo);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const sw = lerp(o.tsw, lag.tsw, k);
      const tb = lerp(o.tb, lag.tb, k);
      const up = o.tup * k * 2.2;
      const L = 1.7 * o.tl;
      const dir = B.v(0.35 - tb * 0.9 * k + (up > 0 ? 0.3 * up : 0), sw * 0.7 * k, -1 + up);
      const ln = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const nx: V3 = vadd(pt, [(dir[0] / ln) * L, (dir[1] / ln) * L, (dir[2] / ln) * L]);
      r.cap(pt, nx, 0.85 - i * 0.1, 0.75 - i * 0.12, TONGUE);
      pt = nx;
    }
  }
  r.eye = dead || open < 0.3 ? null : eyeP;
  return { C, mouth, eye: eyeP, top };
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_lantern', 44, 52, 22, 38, 1300);

function lanternPic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [o, lag] = poseAt(anim, f);
  const dead = anim === 'die' && f > 6;
  const r = new Rig();
  const J = lnRig(r, o, lag, yaw, dead);
  return draw(K, r, (p, lit, P) => {
    const L = () => lit();
    if (anim === 'aim' && f >= 6) {
      // Набор: искры стягиваются к пасти.
      const [mx, my] = P(J.mouth);
      const k = (f - 6) / 8;
      for (let i = 0; i < 5; i++) {
        const a = hash(i, 4) * TAU;
        const rr = (1 - k) * (6 + hash(i, 6) * 5) + 1;
        L().set(
          Math.floor(mx + Math.cos(a) * rr),
          Math.floor(my + Math.sin(a) * rr * 0.7),
          alphaC(hx('#ffd060'), 0.5 + k * 0.5),
        );
      }
    }
    if (anim === 'gut' && f <= 3) {
      // Вспышка плевка у пасти.
      const [mx, my] = P(J.mouth);
      const R = 3 + f * 1.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const x = Math.floor(mx + Math.cos(a) * R);
        const y = Math.floor(my + Math.sin(a) * R * 0.7);
        L().set(x, y, alphaC(hx(i % 2 ? '#ffb030' : '#fff0a0'), 1 - f * 0.22));
      }
    }
    if (anim === 'gut' && f >= 4 && f < 16) {
      // Чад: серые клубы от шапки вверх.
      const [tx, ty] = P(J.top);
      for (let i = 0; i < 3; i++) {
        const k = ((((f - 4) / 8 + i / 3) % 1) + 1) % 1;
        const x = Math.floor(tx + Math.sin(k * 5 + i) * 1.5);
        const y = Math.floor(ty - k * 8);
        p.set(x, y, alphaC(hx('#5a5058'), 0.6 * (1 - k)));
        p.set(x + 1, y, alphaC(hx('#5a5058'), 0.4 * (1 - k)));
      }
    }
    if (anim === 'stun') {
      const [tx, ty] = P(J.top);
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = Math.floor(tx + Math.cos(a) * 4.5);
        const y = Math.floor(ty - 1 + Math.sin(a) * 1.5);
        L().set(x, y, hx('#fff27a'));
        p.set(x, y, hx('#ffffff'));
      }
    }
    if (anim === 'die' && f >= 2 && f <= 16) {
      // Пламя охватывает бумагу: языки по краю прогорания, искры вверх.
      const k = (f - 2) / 14;
      const [cx, cy] = P(J.C.p(0, 0, 0));
      for (let i = 0; i < 10; i++) {
        const a = hash(i, 2) * TAU;
        const x = Math.floor(cx + Math.cos(a) * (3 + hash(i, 5) * 4));
        const y = Math.floor(cy + 4 - k * 10 - hash(i, 7) * 8 + (f % 2) * (i % 2));
        L().set(x, y, alphaC(hx(i % 3 ? '#ff8a20' : '#fff0a0'), 1 - k * 0.6));
      }
    }
  });
}

registerMobPainter('f8_lantern', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, md === 'aim' ? 14 : 6);
  const d = dirN(v.yaw);
  // Свой мерный подъём (движок не качает: `still`).
  const bob = Math.sin(now * 2.6 + id * 1.7) * 1.2;
  const ex: Partial<MobFrame> = { shadow: 4, still: true, lift: 7 + bob };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    // Остов падает на пол.
    ex.lift = 7 * (1 - easeIn(clamp01((t - 0.15) / 0.35)));
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 4 * (1 - sstep(0.5, 0.8, t));
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 14);
    ex.lift = 7 + bob * 0.3;
  } else if (md === 'gutter') {
    anim = 'gut';
    const k = t * FPS;
    f =
      t < 0.25
        ? Math.min(5, Math.floor(k))
        : t < 1.2
          ? 6 + mod(k - 6, 8)
          : 14 + Math.min(6, Math.floor((t - 1.2) * FPS * 0.9));
    // Опускается к герою (окно), в конце снова поднимается.
    ex.lift = lerp(7, 2.5, sstep(0.05, 0.5, t)) + lerp(0, 4.5, sstep(1.2, 1.5, t)) + bob * 0.4;
    if (f <= 1) ex.dx = -Math.cos(v.yaw) * (1.5 - f);
  } else if (md === 'f8_rise') {
    anim = 'rise';
    f = fi(t, 21);
    // Из пропасти: снизу, сквозной до 0,7.
    ex.lift = lerp(-16, 7, easeOut(clamp01(t / 0.8))) + bob * sstep(0.6, 0.9, t);
    ex.alpha = 0.3 + 0.7 * sstep(0.1, 0.7, t);
  } else if (md === 'stun') {
    anim = 'stun';
    f = mod(now * 16, 6);
  } else if (hurtF(v, now) >= 0 && !moving(m)) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'move';
    f = mod((now + hash(id, 7) * 3) * 10, MOVE_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 7, IDLE_N);
  }
  if (md === 'f8_out') ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(K, anim, f, d, pose, () => lanternPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_lantern', function* () {
  yield* warmAll(
    K,
    [
      ['move', MOVE_N],
      ['idle', IDLE_N],
      ['aim', 15],
      ['gut', GUT_N],
      ['rise', 22],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
    ],
    lanternPic,
  );
});
