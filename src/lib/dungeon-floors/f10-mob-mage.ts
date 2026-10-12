// Архидемон-маг (анимации мобов 10): рогатый капюшон, лица нет — только
// глаза, длинная ряса с золотой каймой, посох с фиолетовой сферой. Ходит
// туда, куда идёт, 8 сторон; подол и рукава отстают.
//
// Метроном — `f10-brains.ts` (`f10_mage`, `MAGE`, `mageCast`):
// - каст `cast` 1,05 с: до 0,35 — посох вверх, сфера наливается, маг
//   приподнимается над полом; в 0,35 метки (вспышка сферы); дальше — жест
//   своего заклинания (`m.data.spell`, уже прибавлен): «три молнии» — посох
//   к небу, «цепь» — посох наперевес к герою, «печать» — ладонь вперёд с
//   руной; 0,9–1,05 — задержка на пике с дрожью;
// - после каста (`recover`): молнии бьют в 1,40 с от начала (кадр 8
//   отдыха — вспышка и отдача), цепь катится 1,31…1,86 (сфера трещит),
//   печать — 1,70 (ладонь сжимается в кулак);
// - вспышка `blink` 0,55: кутается, сжимается в точку с вихрем искр;
//   появление (`recover` после неё) — разворачивается из точки;
// - смерть 0,9 с: посох падает, тело уходит в рясу, пустая ряса оседает,
//   глаза гаснут, фиолетовый дым.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  alpha,
  arm,
  camSide,
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
  litOn,
  moving,
  spark2,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  vlerp,
  vmul,
  vnorm,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, RGBA, RigOut, V3 } from './f10-mobs';
import type { Mat } from './f15-rig';

const ROBE = tn('#0e0814', '#1e1228', '#34204a', '#523672');
const GOLD = tn('#5e3a10', '#9a6a1c', '#d8a23a', '#ffe28a');
const ORB = tn('#5a2aa0', '#9a5aff', '#d4b0ff', '#ffffff');
const EYE = hx('#c890ff');
const STAFF = tn('#0e0a0e', '#221a24', '#3a2e3e', '#5a4a60');
const HORN = tn('#1a1018', '#3a2a34', '#5e4a56', '#8a7482');
const HAND = tn('#140c16', '#2a1a2e', '#44304a', '#664a6e');
const VOID = tn('#050308', '#050308', '#0a0610', '#120a1a');
const ZAP: RGBA[] = [hx('#ffffff'), hx('#d4b0ff'), hx('#9a5aff')];
const SMOKE: RGBA[] = [hx('#34204a'), hx('#523672'), hx('#2a1a3a'), hx('#9a5aff')];

const SK = 1.3;
const STAFF_L = 24;

interface MageO {
  fwd: number;
  up: number;
  lean: number;
  twist: number;
  head: number;
  hturn: number;
  /** Кисти в рамке корпуса. */
  hR: V3;
  hL: V3;
  /** Посох: курс и подъём в рамке корпуса, где правая рука (от комля). */
  sy: number;
  sp: number;
  grip: number;
  /** Левая ладонь раскрыта вперёд (печать) 0…1. */
  palm: number;
  /** Сфера: яркость 0…1,6; треск молний 0…1. */
  orb: number;
  zap: number;
  /** Подол: отстаёт, раздувается. */
  hem: number;
  flare: number;
  /** Смерть: тело ушло в рясу 0…1, посох упал 0…1, глаза гаснут 0…1. */
  sink: number;
  drop: number;
  dim: number;
  /** Вспышка: масштаб 1…0, оборот. */
  shrink: number;
  spin: number;
}

const IDLE_R: V3 = [1.8, 3.0, 3.2];
const IDLE_L: V3 = [1.0, -2.8, 2.4];

const M0: MageO = {
  fwd: 0,
  up: 0,
  lean: 0.04,
  twist: 0,
  head: 0,
  hturn: 0,
  hR: IDLE_R,
  hL: IDLE_L,
  sy: 0.15,
  sp: 1.42,
  grip: 12,
  palm: 0,
  orb: 0.35,
  zap: 0,
  hem: 0,
  flare: 0,
  sink: 0,
  drop: 0,
  dim: 0,
  shrink: 1,
  spin: 0,
};

/** Посох в мире: комель, верх, направление. */
function staffOf(B: F3, T: F3, o: MageO): { butt: V3; top: V3; d: V3 } {
  const cp = Math.cos(o.sp);
  let d = T.v(cp * Math.cos(o.sy), cp * Math.sin(o.sy), Math.sin(o.sp));
  d = vnorm(d);
  const h = T.p(o.hR[0], o.hR[1], o.hR[2]);
  let butt = vadd(h, vmul(d, -o.grip * SK));
  if (o.drop > 0) {
    // Падает: ложится на пол вперёд-вправо.
    const lb = B.p(1.5, 3.5, 0.6);
    const ld = vnorm(B.v(0.85, 0.5, 0.02));
    const k = easeIn(o.drop);
    butt = vlerp(butt, lb, k);
    d = vnorm(vlerp(d, ld, k));
  }
  return { butt, top: vadd(butt, vmul(d, STAFF_L * SK)), d };
}

function mageRig(o: MageO, yaw: number): KRig {
  const k = o.shrink;
  const r = new KRig(SK * k);
  const B = F3.yaw(yaw + o.spin, [0, 0, 9 * SK * (1 - k)]).scale(SK * k);
  const cs = camSide(yaw);
  const sk = o.sink;
  const robe: Mat = { T: ROBE };
  const robeD: Mat = { T: ROBE, bias: -0.12 };
  const gold: Mat = { T: GOLD, spec: true };
  // Подол: колокол, отстаёт и раздувается.
  const Hm = B.at(o.fwd - o.hem * 0.8, 0, o.up * 0.5).pitch(-o.hem * 0.08);
  const fl = 1 + o.flare * 0.25 + sk * 0.35;
  r.ell(Hm, [0, 0, 4.4 * (1 - 0.7 * sk)], [2.9 * fl, 3.3 * fl, 4.8 * (1 - 0.72 * sk)], robe);
  r.ell(Hm, [0, 0, 1.2 * (1 - 0.5 * sk)], [3.5 * fl, 3.9 * fl, 1.4 * (1 - 0.4 * sk)], robeD);
  r.ell(Hm, [0, 0, 0.5], [3.6 * fl, 4.0 * fl, 0.45], gold);
  // Корпус.
  const bodyZ = 9 + o.up - sk * 6.8;
  const T = B.at(o.fwd, 0, bodyZ)
    .turn(o.twist)
    .pitch(o.lean + sk * 0.5);
  r.ell(T, [0, 0, 3.4], [2.2, 2.8, 3.6], robe);
  r.ell(T, [0.1, 0, 0.5], [2.3, 2.9, 0.55], gold);
  r.ell(T, [0, 0, 6.3], [2.5, 3.5, 1.6], robeD);
  r.dot(T.p(2.2, 0, 4.6), GOLD[3], 0, 1, 0.7);
  // Капюшон: шар, острый хвост назад, пустота лица, глаза, рога, камень.
  const Hd = T.at(0.3, 0, 9.2).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0, 0, 0), 2.9, robe);
  r.cap(Hd.p(-1.2, 0, 1.4), Hd.p(-3.6, 0, 2.2), 1.5, 0.3, robe);
  r.ell(Hd, [1.7, 0, -0.4], [1.3, 1.9, 1.9], { T: VOID, flat: 0 });
  r.cap(Hd.p(1.9, -2.0, 0.6), Hd.p(2.4, 0, 2.1), 0.35, 0.35, gold);
  r.cap(Hd.p(2.4, 0, 2.1), Hd.p(1.9, 2.0, 0.6), 0.35, 0.35, gold);
  for (const sd of [-1, 1]) {
    const h0 = Hd.p(0.2, sd * 2.0, 1.8);
    const h1 = vadd(h0, Hd.v(-0.8, sd * 1.4, 2.2));
    const h2 = vadd(h1, Hd.v(1.2, sd * 0.6, 2.0));
    r.cap(h0, h1, 0.75, 0.5, { T: HORN });
    r.cap(h1, h2, 0.5, 0.15, { T: HORN });
    if (o.dim < 0.9) r.dot(Hd.p(2.6, sd * 0.8, -0.1), alpha(EYE, 1 - o.dim), 1 - o.dim, 1, 0.7);
  }
  r.eye = o.dim < 0.5 ? Hd.p(2.6, cs * 0.8, -0.1) : null;
  // Руки в широких рукавах.
  const shR = T.p(0, 3.0, 6.4);
  const shL = T.p(0, -3.0, 6.4);
  const hR = T.p(o.hR[0], o.hR[1], o.hR[2]);
  const hL = T.p(o.hL[0], o.hL[1], o.hL[2]);
  arm(r, shR, hR, 4.0 * SK * k, 4.0 * SK * k, T.v(-1, 0.5, -0.3), [1.1, 1.3, 1.5], robe);
  arm(r, shL, hL, 4.0 * SK * k, 4.0 * SK * k, T.v(-1, -0.5, -0.3), [1.1, 1.3, 1.5], robe);
  r.ball(hR, 0.85, { T: HAND });
  if (o.palm > 0.3) {
    // Раскрытая ладонь: пальцы веером вперёд.
    const pf = T.v(1, 0, 0.1);
    for (const s of [-1, 0, 1])
      r.cap(hL, vadd(hL, vadd(vmul(pf, 1.3 * SK), T.v(0, s * 0.5, s * 0.3 + 0.2))), 0.35, 0.2, {
        T: HAND,
      });
  }
  r.ball(hL, 0.85, { T: HAND });
  // Посох: древко, когти вокруг сферы, сфера светится.
  const st = staffOf(B, T, o);
  r.cap(st.butt, st.top, 0.55, 0.45, { T: STAFF });
  const side = vnorm([-st.d[1], st.d[0], 0.01]);
  for (const a of [0, (2 * PI) / 3, (4 * PI) / 3]) {
    const off = vadd(vmul(side, Math.cos(a)), vmul(vnorm([0, 0, 1]), Math.sin(a) * 0.6));
    const b0 = vadd(st.top, vmul(st.d, -0.8 * SK));
    r.cap(b0, vadd(vadd(b0, vmul(off, 1.5 * SK)), vmul(st.d, 2.2 * SK)), 0.35, 0.12, { T: STAFF });
  }
  const orbC = vadd(st.top, vmul(st.d, 1.3 * SK));
  const og = clamp01(o.orb);
  r.ball(orbC, 1.5 + 0.35 * Math.max(0, o.orb - 1), {
    T: ORB,
    glow: 0.35 + 0.6 * og * (1 - o.drop),
    bias: 0.15 + 0.4 * Math.max(0, o.orb - 1),
  });
  return r;
}

// ---- Треки ----------------------------------------------------------------

const CAST_T = 1.05;
const MARK_T = 0.35;

/** Подготовка (общая для всех трёх заклинаний) — до меток. */
function castPre(T: number): MageO {
  const k = clamp01(T / MARK_T);
  const o: MageO = { ...M0 };
  o.hR = vlerp(IDLE_R, [1.6, 3.0, 7.6], easeOut(k));
  o.hL = vlerp(IDLE_L, [1.4, -3.0, 6.0], easeOut(k));
  o.grip = 12 - 3 * easeOut(k);
  o.sp = 1.42 + 0.1 * k;
  o.orb = 0.35 + 0.75 * k;
  o.up = 1.2 * easeOut(k);
  o.lean = 0.04 - 0.16 * k;
  o.head = -0.2 * k;
  o.flare = k;
  o.palm = k;
  o.hem = -0.3 * k;
  return o;
}

/** Жест заклинания `K` с меток до конца отдыха; T — от начала каста. */
function castK(K: number, T: number): MageO {
  const o = castPre(MARK_T);
  // Вспышка сферы в миг меток (кадры 8–9).
  const flash = T < MARK_T + 0.08 ? 1.6 - (T - MARK_T) * 5 : 0;
  const into = sstep(MARK_T, MARK_T + 0.3, T);
  const out = sstep(CAST_T + 0.55, CAST_T + 0.9, T);
  const hold = T > 0.9 && T < CAST_T;
  let to: Partial<MageO>;
  if (K === 0) {
    // Три молнии: посох к небу, левая ладонь вверх.
    to = { hR: [1.0, 2.2, 11.2], hL: [1.2, -2.6, 9.2], grip: 7, sp: 1.5, sy: 0.05, up: 1.8 };
  } else if (K === 1) {
    // Цепь: посох наперевес, остриём к герою.
    to = {
      hR: [3.6, 2.0, 5.4],
      hL: [3.6, -0.3, 6.0],
      grip: 9,
      sp: 0.18,
      sy: -0.12,
      up: 1.0,
      lean: 0.18,
    };
  } else {
    // Печать: посох стоит в правой, левая ладонь вперёд.
    to = {
      hR: [1.8, 3.0, 5.6],
      hL: [5.2, -1.0, 6.6],
      grip: 10,
      sp: 1.48,
      sy: 0.15,
      up: 1.4,
      palm: 1,
    };
  }
  const lerpN = (a: number, b: number | undefined, k: number) =>
    b === undefined ? a : a + (b - a) * k;
  const pk = into * (1 - out);
  o.hR = vlerp(vlerp(o.hR, to.hR ?? o.hR, into), IDLE_R, out);
  o.hL = vlerp(vlerp(o.hL, to.hL ?? o.hL, into), IDLE_L, out);
  o.grip = lerpN(lerpN(o.grip, to.grip, into), 12, out);
  o.sp = lerpN(lerpN(o.sp, to.sp, into), M0.sp, out);
  o.sy = lerpN(lerpN(o.sy, to.sy, into), M0.sy, out);
  o.up = lerpN(lerpN(o.up, to.up, into), 0, out);
  o.lean = lerpN(lerpN(o.lean, to.lean ?? -0.12, into), M0.lean, out);
  o.palm = K === 2 ? pk : o.palm * (1 - into);
  o.flare = pk + (1 - into) * o.flare;
  o.head = K === 0 ? -0.35 * pk : -0.05 * pk;
  o.hem = -0.3 * pk;
  o.orb = Math.max(flash, (1.1 + 0.3 * sstep(0.6, 0.95, T)) * (1 - out) + 0.35 * out);
  o.zap = (K === 1 ? 1 : 0.6) * sstep(0.5, 0.9, T) * (1 - out);
  if (hold) {
    // Задержка на пике: дрожь и сфера на пределе.
    const j = Math.floor(T * FPS) % 2 ? 0.22 : -0.22;
    o.fwd += j;
    o.orb = 1.5;
    o.zap = 1;
  }
  const R = T - CAST_T;
  if (K === 0 && R >= 0) {
    // Молнии бьют в 0,35 отдыха: вспышка и отдача в такт.
    const hit = R >= 0.33 && R < 0.46;
    if (hit) o.orb = 1.6;
    o.up -= hit ? 0.5 : 0;
    o.zap = R < 0.46 ? 1 : o.zap;
  }
  if (K === 1 && R >= 0 && R < 0.85) {
    // Цепь катится: сфера мигает в такт каждой молнии (через 0,11 с).
    o.orb = 1.2 + 0.4 * (Math.floor((R - 0.26) / 0.11) % 2 ? 0 : 1) * (R > 0.24 ? 1 : 0);
    o.zap = 1;
  }
  if (K === 2 && R >= 0) {
    // Печать бьёт ≈0,65 отдыха — ладонь сжимается в кулак.
    const snap = sstep(0.58, 0.66, R);
    o.palm = (1 - snap) * (1 - out);
    o.hL = vadd(o.hL, [0.8 * snap * (1 - out), 0, 0]);
  }
  return o;
}

function blinkO(T: number, back: boolean): MageO {
  const o: MageO = { ...M0 };
  if (!back) {
    // Кутается (0–0,15), сжимается в точку с оборотом (0,15–0,5).
    const w = sstep(0, 0.15, T);
    o.hR = vlerp(IDLE_R, [1.6, 1.4, 4.4], w);
    o.hL = vlerp(IDLE_L, [1.6, -1.2, 4.6], w);
    o.grip = 12 - 4 * w;
    o.sp = 1.5;
    o.orb = 0.35 + 0.8 * w;
    const s = sstep(0.15, 0.5, T);
    o.shrink = 1 - 0.95 * easeIn(s);
    o.spin = 5 * easeIn(s);
    o.flare = 1 - w;
    o.hem = -0.6 * w;
    return o;
  }
  // Появление (0–0,35): разворачивается из точки.
  const s = sstep(0, 0.3, T);
  o.shrink = 0.05 + 0.95 * easeOut(s);
  o.spin = -4 * (1 - easeOut(s));
  o.orb = 1.2 - 0.85 * s;
  o.flare = 1 - s;
  o.up = 0.8 * (1 - s);
  return o;
}

function magePose(anim: string, f: number): MageO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'idle': {
      const a = (f / 8) * TAU;
      return {
        ...M0,
        orb: 0.35 + 0.15 * Math.sin(a),
        hem: 0.12 * Math.sin(a - 1),
        hR: vadd(IDLE_R, [0, 0, 0.2 * Math.sin(a - 0.5)]),
        hL: vadd(IDLE_L, [0, 0, 0.25 * Math.sin(a - 1.2)]),
        head: 0.05 * Math.sin(a),
      };
    }
    case 'walk': {
      // Посох-трость: выносит вперёд на каждом втором шаге, подол качается.
      const a = (f / 8) * TAU;
      return {
        ...M0,
        lean: 0.12,
        up: 0.3 * Math.abs(Math.sin(a)),
        hR: [1.8 + 1.4 * Math.sin(a), 3.0, 3.4 + 0.4 * Math.cos(a)],
        hL: [1.0 - 1.0 * Math.sin(a), -2.8, 2.6],
        sp: 1.32 + 0.12 * Math.cos(a),
        hem: 0.5 + 0.25 * Math.sin(a * 2),
        twist: 0.08 * Math.sin(a),
      };
    }
    case 'cast':
      return castPre(t);
    case 'cast0':
    case 'cast1':
    case 'cast2':
      return castK(+anim[4], MARK_T + t - 0.5 / FPS + 0.002);
    case 'rel0':
    case 'rel1':
    case 'rel2':
      return castK(+anim[3], CAST_T + t - 0.5 / FPS + 0.01);
    case 'blink':
      return blinkO(t, false);
    case 'unblink':
      return blinkO(t, true);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      return {
        ...M0,
        lean: -0.3 * b,
        head: -0.35 * b,
        fwd: -1.2 * b,
        orb: 0.35 + 0.8 * b,
        hem: 0.6 * b,
        hR: vadd(IDLE_R, [-0.6 * b, 0.3 * b, 1.4 * b]),
        hL: vadd(IDLE_L, [-0.4 * b, -0.5 * b, 2.2 * b]),
      };
    }
    case 'die': {
      // 22 кадра (0,9 с): отшатнулся, глаза вспыхнули (0–3); посох падает
      // (3–9); тело уходит в рясу (5–14); пустая ряса оседает, дым (12–21).
      const o: MageO = { ...M0 };
      o.lean = trk(t, [
        [0, -0.35, easeOut],
        [0.15, -0.3],
        [0.5, 0.3],
      ]);
      o.head = trk(t, [
        [0, -0.5],
        [0.2, -0.4],
        [0.55, 0.6],
      ]);
      o.drop = sstep(0.12, 0.4, t);
      o.sink = trk(t, [
        [0.2, 0],
        [0.58, 1, easeIn],
        [0.64, 0.93],
        [0.7, 1],
      ]);
      o.hR = vlerp(vadd(IDLE_R, [-0.5, 0.4, 1.4]), [0.6, 3.0, 0.4], sstep(0.12, 0.5, t));
      o.hL = vlerp(vadd(IDLE_L, [-0.4, -0.4, 1.8]), [0.6, -3.0, 0.4], sstep(0.15, 0.5, t));
      o.orb = trk(t, [
        [0, 1.4],
        [0.3, 0.6],
        [0.6, 0],
      ]);
      o.dim = trk(t, [
        [0, 0],
        [0.1, 0],
        [0.6, 1],
      ]);
      o.flare = trk(t, [
        [0.3, 0],
        [0.6, 1],
      ]);
      return o;
    }
  }
  return { ...M0 };
}

// ---- Кадр -----------------------------------------------------------------

const MAGE = kindOf('mage', 74, 84, 37, 72, 1700);

/** Молния в 2D: ломаная от (x0, y0) к (x1, y1), в кадр и поверх темноты. */
function zap2(o: RigOut, x0: number, y0: number, x1: number, y1: number, seed: number): void {
  const lit = litOn(o);
  const n = 5;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const j = i === n ? 0 : (hash(seed, i) - 0.5) * 4;
    const qx = x0 + (x1 - x0) * k + j;
    const qy = y0 + (y1 - y0) * k + (hash(seed, i, 2) - 0.5) * 3;
    const steps = Math.max(1, Math.ceil(Math.hypot(qx - px, qy - py)));
    for (let s = 0; s <= steps; s++) {
      const x = px + ((qx - px) * s) / steps;
      const y = py + ((qy - py) * s) / steps;
      const c = ZAP[i === 1 ? 0 : (i + s) % 3];
      o.p.set(x, y, c);
      lit.set(x, y, alpha(c, 0.9));
    }
    px = qx;
    py = qy;
  }
}

/** Руна печати: кольцо с засечками у ладони (в `lit`). */
function sigil2(o: RigOut, x: number, y: number, R: number, k: number, rot: number): void {
  const lit = litOn(o);
  const n = Math.max(10, Math.round(R * 6));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rot;
    const px = x + Math.cos(a) * R;
    const py = y + Math.sin(a) * R * 0.9;
    const c = i % 3 ? ZAP[1] : ZAP[0];
    o.p.set(px, py, alpha(c, 0.9 * k));
    lit.set(px, py, alpha(c, k));
  }
  for (let i = 0; i < 3; i++) {
    const a = rot * 1.7 + (i / 3) * TAU;
    spark2(o, x + Math.cos(a) * R * 0.45, y + Math.sin(a) * R * 0.45, ZAP[0], k);
  }
}

const magePic = (anim: string, f: number, d: number): Pic => {
  const o0 = magePose(anim, f);
  const yaw = yawN(d);
  return draw(MAGE, mageRig(o0, yaw), (o, P) => {
    const k = o0.shrink;
    const B = F3.yaw(yaw + o0.spin, [0, 0, 9 * SK * (1 - k)]).scale(SK * k);
    const T = B.at(o0.fwd, 0, 9 + o0.up - o0.sink * 6.8)
      .turn(o0.twist)
      .pitch(o0.lean + o0.sink * 0.5);
    const st = staffOf(B, T, o0);
    const [ox, oy] = P(vadd(st.top, vmul(st.d, 1.3 * SK)));
    if (o0.zap > 0 && o0.drop === 0) {
      // Треск у сферы: 1–3 молнии, у «цепи» — вперёд по ходу посоха.
      const nz = o0.zap > 0.7 ? 3 : o0.zap > 0.3 ? 2 : 1;
      for (let i = 0; i < nz; i++) {
        const a = hash(f, i, d) * TAU;
        const L = 4 + 5 * o0.zap * hash(i, f, 7);
        zap2(o, ox, oy, ox + Math.cos(a) * L, oy + Math.sin(a) * L * 0.8, f * 7 + i);
      }
    }
    if (o0.orb > 1.3) {
      // Вспышка сферы: лучи-крест поверх темноты.
      for (let i = -4; i <= 4; i++) {
        spark2(o, ox + i, oy, ZAP[Math.abs(i) > 2 ? 1 : 0], 1 - Math.abs(i) / 6);
        spark2(o, ox, oy + i, ZAP[Math.abs(i) > 2 ? 1 : 0], 1 - Math.abs(i) / 6);
      }
    }
    if (o0.palm > 0.3 && (anim === 'cast2' || anim === 'rel2')) {
      const [x, y] = P(vadd(T.p(o0.hL[0], o0.hL[1], o0.hL[2]), T.v(2.0 * SK, 0, 0)));
      sigil2(o, x, y, 2 + 3 * o0.palm, o0.palm, f * 0.35);
    }
    if (anim === 'blink' || anim === 'unblink') {
      // Вихрь искр к точке (и из неё).
      const [cx, cy] = P([0, 0, 9 * SK]);
      const s = anim === 'blink' ? 1 - k : k;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + f * 0.6 * (anim === 'blink' ? 1 : -1);
        const R =
          (anim === 'blink' ? 14 * (1 - s) + 2 : 3 + 14 * (1 - s)) * (0.6 + 0.4 * hash(i, 5));
        spark2(o, cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.6, ZAP[i % 3], 0.9);
      }
      if (k < 0.2) {
        spark2(o, cx, cy, ZAP[0], 1);
        spark2(o, cx + 1, cy, ZAP[1], 1);
        spark2(o, cx - 1, cy, ZAP[1], 1);
        spark2(o, cx, cy - 1, ZAP[1], 1);
        spark2(o, cx, cy + 1, ZAP[1], 1);
      }
    }
    if (anim === 'die' && f >= 12) {
      const [x, y] = P([0, 0, 3 * SK]);
      spray(o.p, x, y, 10, 8, (f - 11) / 10, 77, SMOKE, -3, 9);
    }
  });
};

const TECH = new Set(['cast', 'blink', 'recover']);

registerMobPainter('f10_mage', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const v = visOf(m, pose, TECH.has(md) ? (m.face ?? 0) : headOf(m), 7);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 7 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  const K = ((((m.data?.spell ?? 1) - 1) % 3) + 3) % 3;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.95;
    ex.alpha = 1 - sstep(0.78, 0.95, t);
    ex.still = true;
  } else if (md === 'cast') {
    ex.still = true;
    if (t < MARK_T) {
      f = fi(t, 8);
      anim = 'cast';
    } else {
      f = Math.min(16, fi(t, 25) - 8);
      anim = `cast${K}`;
    }
  } else if (md === 'recover' && v.prev === 'cast' && t < 0.9) {
    f = fi(t, 21);
    anim = `rel${K}`;
    ex.still = true;
  } else if (md === 'blink') {
    f = fi(t, 13);
    anim = 'blink';
    ex.still = true;
    ex.shadow = 7 * (1 - sstep(0.2, 0.5, t));
  } else if (md === 'recover' && v.prev === 'blink' && t < 0.375) {
    f = fi(t, 8);
    anim = 'unblink';
    ex.still = true;
    ex.shadow = 7 * sstep(0, 0.3, t);
  } else if (md === 'emerge') {
    const k = clamp01(t / 0.45);
    f = Math.floor(now * 6) % 8;
    dark = 3 - Math.min(3, Math.floor(k * 4));
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.4)) {
    f = Math.floor((v.dist / 1.1) * 8) % 8;
    anim = 'walk';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 5) % 8;
    anim = 'idle';
  }
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(MAGE, anim, f, d, pose, () => magePic(anim, f, d), dark), ...ex };
});

registerMobWarm('f10_mage', function* () {
  yield* warmAll(
    MAGE,
    [
      ['idle', 8],
      ['walk', 8],
      ['cast', 9],
      ['cast0', 17],
      ['cast1', 17],
      ['cast2', 17],
      ['rel0', 22],
      ['rel1', 22],
      ['rel2', 22],
      ['blink', 14],
      ['unblink', 9],
      ['flinch', 5],
      ['die', 22],
    ],
    magePic,
  );
});
