// Ветряной дух (анимации мобов 11): белая маска в бирюзовом капюшоне над
// воронкой вихря; вокруг воронки по спирали бегут три ленты, рукава-ленты
// вьются по бокам, кончик капюшона и хвост воронки отстают от хода.
// Мини-3D (`f15-rig.ts`), 8 сторон честно (у вихря есть направление вращения —
// зеркало перевернуло бы его); техники — 24 к/с от `pose.t`.
//
// Метроном — `f11-brains.ts` (`f11_spirit`, `SPIRIT`):
// - `chase`: дух — призрак (`data.ghost`, его не достать) — рисуем его
//   полупрозрачным; летит по кругу у героя, маской по ходу, хвост воронки и
//   кончик капюшона тянутся сзади, корпус клонится в полёт;
// - `cast` 1,05 с: собрался (сжался, поднялся, рукава вверх, голова назад) →
//   развёл рукава вперёд, между ними из пыли закручивается маленький смерч →
//   замок (последние 0,2 с — глаза белые, дрожь, смерч светится); дух плотный —
//   теперь его можно бить;
// - контакт — первый кадр `recover`: толчок вперёд, рукава выброшены, смерч
//   ушёл (дальше его рисует зона `f11_tornado` — она же здесь, с рождением);
//   отдача назад; `recover` 1,35 с — выдохся: вихрь вращается медленно,
//   распущен, голова поникла, глаза прикрыты, опустился ниже; к концу собрался;
// - удар героя — 6 кадров: вихрь сбит, ленты разлетелись, голова откинута;
// - смерть 0,9 с: судорога, вихрь распускается лентами вширь и тает, маска
//   падает, стукается о пол и раскалывается надвое.

import { registerMobPainter, registerMobWarm, registerZonePainter } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob, Zone } from '../dungeon-sim';
import { SPIRIT } from './f11-brains';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  WHITE,
  alpha,
  clamp,
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
  moving,
  put,
  spray,
  sstep,
  tn,
  vadd,
  visOf,
  vlerp,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RGBA, RigOut, Tones, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const tna = (a: string, b: string, c: string, d: string, al: number): Tones => [
  hx(a, al),
  hx(b, al),
  hx(c, al),
  hx(d, al),
];
const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

/** Воронка — полупрозрачная (под ней видна земля), капюшон — плотнее. */
const FUN = tna('#1f5068', '#33809e', '#5fb2cc', '#a6e0ee', 180);
const HOOD = tna('#173f58', '#2a6c8c', '#4a9cba', '#86cce2', 236);
const SLEEVE = tna('#2a6c8c', '#4a9cba', '#86cce2', '#d4f2fa', 222);
const MASK_T: Tones = tn('#a8a498', '#d8d4c8', '#f2f0e8', '#ffffff');
const RIB = hx('#f4fdff', 196);
const RIB_DIM = hx('#9ad8ec', 170);
/** Лента за воронкой — тусклая: спереди белая, сзади бирюзовая — читается объём. */
const RIB_BACK = hx('#4a9cba', 150);
const MOUTH = hx('#c83a4a');
const MARK = hx('#2c8088');
const CYAN = hx('#7af6ff');
const SHUT = hx('#6a665c');
const EDGE = hx('#14283c');
const DUST: RGBA[] = [hx('#8c7050'), hx('#6a9a40'), hx('#b89a70'), hx('#dfe8d0')];
const PUFF: RGBA[] = [hx('#ffffff', 200), hx('#d8f4ff', 180), hx('#a0e0f0', 150)];

const MASK: Mat = { T: MASK_T };
const HOODM: Mat = { T: HOOD };
const SLEEVEM: Mat = { T: SLEEVE };

/** Воронка со спиральными полосами; `k0…k1` — доля высоты куска (полосы непрерывны). */
const funMat = (spin: number, k0: number, k1: number): Mat => ({
  T: FUN,
  pat: (q, l) => {
    const th = Math.asin(clamp(q[1], -1, 1));
    const s = Math.sin(3 * (th + spin) + (k0 + (k1 - k0) * q[0]) * 6.5);
    if (s > 0.7) return band(FUN, l + 0.4);
    if (s < -0.85) return band(FUN, l - 0.4);
    return null;
  },
});

// ---- Поза ------------------------------------------------------------------------

interface SpO {
  /** Фаза вращения вихря, рад. */
  spin: number;
  /** Наклон корпуса вперёд, рад; голова кивает вниз (+). */
  lean: number;
  hp: number;
  /** Хвост воронки отстаёт назад (пикс) и качается вбок (размах, фаза). */
  bendF: number;
  swayA: number;
  sway: number;
  /** Высота воронки (1 — обычная), ширина, подъём головы (пикс). */
  sq: number;
  wide: number;
  hz: number;
  /** Кисти рукавов (вперёд, вправо, вверх) — левая и правая. */
  hl: V3;
  hr: V3;
  /** Смерч в руках 0…1, замок 0…1, пыль к смерчу 0…1. */
  whirl: number;
  lock: number;
  debris: number;
  /** Глаза: 0 — тёмные, 1 — бирюзовые, 2 — белые, −1 — прикрыты. */
  eyes: number;
  /** Ленты: прибавка радиуса, доля длины 0…1. */
  rib: number;
  ribA: number;
  /** Тело (воронка и капюшон) 0…1 — тает в смерти. */
  body: number;
  /** Сорванная маска (смерть): высота, поворот, раскол. */
  mask: { z: number; rot: number; up: number; split: number } | null;
  /** Сдвиг всего тела вперёд (пикс), выдох из рук 0…1. */
  thrust: number;
  puff: number;
}

const HAND_IDLE = (a: number, fly: boolean): [V3, V3] => [
  [fly ? -3.4 : -1, -6.2, 14.2 + 1.3 * Math.sin(a + 1)],
  [fly ? -3.4 : -1, 6.2, 14.2 + 1.3 * Math.sin(a + 1 + PI)],
];

function base(a: number, spin: number, fly: boolean): SpO {
  const [hl, hr] = HAND_IDLE(a, fly);
  return {
    spin,
    lean: fly ? 0.2 : 0.04,
    hp: 0.05 * Math.sin(a + 1.2),
    bendF: fly ? 3.6 : 0.5,
    swayA: fly ? 0.9 : 1.4,
    sway: a,
    sq: 1 + 0.03 * Math.sin(a),
    wide: 1,
    hz: 0.5 * Math.sin(a + 0.6),
    hl,
    hr,
    whirl: 0,
    lock: 0,
    debris: 0,
    eyes: 0,
    rib: 0,
    ribA: 1,
    body: 1,
    mask: null,
    thrust: 0,
    puff: 0,
  };
}

/** Цикл полёта и покоя: 16 кадров = 2/3 оборота (у трёх лент период 1/3) — шов не виден. */
const LOOP = 16;
const loopO = (f: number, fly: boolean) => base((f / LOOP) * TAU, (f / FPS) * TAU, fly);

/** Фаза вихря при меняющейся скорости `rps(t)` (об/с): интеграл по времени. */
function spinAt(t: number, rps: (t: number) => number): number {
  let s = 0;
  const n = Math.max(1, Math.ceil(t * 96));
  const dt = t / n;
  for (let i = 0; i < n; i++) s += rps((i + 0.5) * dt) * dt;
  return s * TAU;
}

const CAST_T = SPIRIT.cast;
const REST_T = SPIRIT.rest;

function castO(t: number): SpO {
  const G = sstep(0, 0.28, t);
  const O = sstep(0.24, 0.55, t);
  const W = sstep(0.3, 0.85, t);
  const L = sstep(CAST_T - 0.22, CAST_T - 0.12, t);
  const o = base(
    0,
    spinAt(t, (x) => 1 + 2.2 * sstep(0, 0.75, x)),
    false,
  );
  o.sq = 1 - 0.1 * G + 0.1 * O;
  o.wide = 1 - 0.16 * G + 0.06 * W;
  o.hz = 1.4 * G - 0.4 * O;
  o.lean = -0.16 * G + 0.24 * O - 0.12 * L;
  o.hp = -0.2 * G + 0.12 * O;
  o.bendF = 0.5 + 1.2 * G;
  o.swayA = 1.4 - 0.8 * G;
  const up: [V3, V3] = [
    [0.5, -3.4, 25.5],
    [0.5, 3.4, 25.5],
  ];
  const fwd: [V3, V3] = [
    [6.6, -5.6, 19.5],
    [6.6, 5.6, 19.5],
  ];
  const lk: [V3, V3] = [
    [7.4, -4.4, 18.6],
    [7.4, 4.4, 18.6],
  ];
  const [il, ir] = HAND_IDLE(0, false);
  const hand = (i: 0 | 1, idle: V3) =>
    vlerp(vlerp(vlerp(idle, up[i], G), fwd[i], O), lk[i], sstep(0.7, 0.95, t));
  o.hl = hand(0, il);
  o.hr = hand(1, ir);
  o.whirl = W;
  o.lock = L;
  o.debris = sstep(0.3, 0.55, t) * (1 - 0.6 * L);
  o.eyes = L > 0.5 ? 2 : t > 0.2 ? 1 : 0;
  // Замок: дрожь в пиксель (через кадр).
  const f = Math.floor(t * FPS);
  o.thrust = (f % 2 ? 0.45 : -0.45) * L - 0.6 * L;
  return o;
}

function recO(t: number): SpO {
  const S = sstep(0.2, 0.55, t) * (1 - sstep(1.0, 1.3, t));
  const T = t < 0.05 ? 1 : 1 - sstep(0.05, 0.28, t);
  const o = base(
    sstep(0.9, REST_T, t) * PI,
    spinAt(t, (x) => 0.35 + 2.6 * (1 - sstep(0, 0.45, x)) + 0.65 * sstep(0.95, 1.3, x)),
    false,
  );
  o.thrust = 3.2 * T - 1.8 * sstep(0.04, 0.2, t) * (1 - sstep(0.24, 0.6, t));
  // Толчок — вперёд, а не вниз: высота замаха уходит за 0,2 с.
  o.sq = 1 - 0.07 * (t < 0.12 ? 1 - t / 0.12 : 0) - 0.06 * S;
  o.wide = 1 + 0.08 * (t < 0.12 ? 1 - t / 0.12 : 0) + 0.2 * S;
  o.hz = 1 - sstep(0, 0.22, t) - 1.6 * S;
  o.hp = -0.18 * T + 0.32 * S;
  o.lean = 0.3 * T - 0.18 * sstep(0.04, 0.2, t) * (1 - sstep(0.24, 0.5, t)) + 0.08 * S;
  o.swayA = 1.4 + 1.3 * S;
  o.bendF = 0.5 - 1.5 * T;
  o.rib = 1.2 * S;
  const thr: [V3, V3] = [
    [10, -3, 18],
    [10, 3, 18],
  ];
  const limp: [V3, V3] = [
    [-0.6, -5.4, 10.6],
    [-0.6, 5.4, 10.6],
  ];
  const k1 = sstep(0.05, 0.5, t);
  const k2 = sstep(1.0, 1.32, t);
  o.hl = vlerp(vlerp(thr[0], limp[0], k1), o.hl, k2);
  o.hr = vlerp(vlerp(thr[1], limp[1], k1), o.hr, k2);
  o.eyes = t < 0.12 ? 2 : S > 0.5 ? -1 : 0;
  o.puff = t < 0.25 ? t / 0.25 : 0;
  return o;
}

function flinchO(f: number): SpO {
  const k = [1, 0.85, 0.6, 0.35, 0.15, 0][f] ?? 0;
  const o = base(0, f * 0.35, false);
  o.hp = -0.38 * k;
  o.lean = -0.2 * k;
  o.rib = 2.6 * k;
  o.sq = 1 - 0.12 * k;
  o.wide = 1 + 0.15 * k;
  o.swayA = 1.4 + 2.2 * k;
  o.sway = 1.2 + f * 0.9;
  o.eyes = f < 3 ? -1 : 0;
  o.hl = vadd(o.hl, [-2 * k, -2 * k, 3 * k]);
  o.hr = vadd(o.hr, [-2 * k, 2 * k, 3 * k]);
  return o;
}

function dieO(t: number): SpO {
  const o = base(
    0,
    spinAt(t, (x) => 2.5 - 1.8 * sstep(0.1, 0.5, x)),
    false,
  );
  const sp = sstep(0, 0.1, t) * (1 - sstep(0.1, 0.2, t));
  const U = sstep(0.1, 0.5, t);
  o.sq = 1 - 0.14 * sp;
  o.wide = 1 - 0.1 * sp;
  o.eyes = t < 0.14 ? 2 : -1;
  o.body = 1 - easeIn(clamp01((t - 0.12) / 0.3));
  o.rib = 13 * easeOut(U);
  o.ribA = 1 - sstep(0.3, 0.62, t);
  o.hl = vadd(o.hl, [0, -3 * U, 4 * U]);
  o.hr = vadd(o.hr, [0, 3 * U, 4 * U]);
  o.swayA = 1.4 + 2 * U;
  // Маска: с 0,14 с сорвана — падает с поворотом, на полу раскалывается.
  if (t > 0.14) {
    const fall = easeIn(clamp01((t - 0.14) / 0.32));
    const bounce = t > 0.46 ? Math.sin(clamp01((t - 0.46) / 0.12) * PI) * 1.4 : 0;
    o.mask = {
      z: lerp(25, 1.6, fall) + bounce,
      rot: 1.4 * fall,
      up: sstep(0.3, 0.48, t),
      split: 2.2 * sstep(0.47, 0.6, t),
    };
  }
  return o;
}

// ---- Риг -------------------------------------------------------------------------

/** Высота верха воронки и кончика, пикс рига (вверх). */
const Z_TOP = 21.5;
const Z_TIP = 3.2;
const funR = (k: number) => 4.3 * (1 - k) ** 1.25 + 0.5;

function eyeLines(r: Rig, Fm: F3, eyes: number, s = 1): void {
  if (eyes === -1) {
    for (const sd of [-1, 1])
      r.line(Fm.p(1.2, sd * 0.5, 0.5), Fm.p(1.2, sd * 1.7, 0.4), SHUT, 0, 0.4);
    return;
  }
  const c = eyes === 2 ? WHITE : eyes === 1 ? CYAN : hx('#150f0b');
  const g = eyes > 0 ? 1 : 0;
  for (const sd of [-1, 1])
    r.line(Fm.p(1.25, sd * 0.45 * s, 0.8), Fm.p(1.25, sd * 1.75 * s, 0.8), c, g, 0.4);
}

function spiritRig(o: SpO, yaw: number): Rig {
  const r = new Rig();
  const F = F3.yaw(yaw).at(o.thrust, 0, 0);
  const zTop = Z_TIP + (Z_TOP + o.hz - Z_TIP) * o.sq;
  const sp = (k: number): V3 =>
    F.p(
      -o.bendF * k ** 1.6 + o.lean * (1 - k) * 6,
      Math.sin(o.sway + k * 2.4) * o.swayA * k,
      Z_TIP + (zTop - Z_TIP) * (1 - k),
    );
  const R = (k: number) => funR(k) * o.wide * o.body;
  const top = sp(0);
  const head = F3.yaw(yaw, vadd(top, [0, 0, 3.4 * o.body])).pitch(o.hp + o.lean * 0.5);

  if (o.body > 0.04) {
    // Воронка — три куска, полосы бегут по спирали.
    const ks = [0, 0.3, 0.62, 1];
    for (let i = 0; i < 3; i++)
      r.cap(sp(ks[i]), sp(ks[i + 1]), R(ks[i]), R(ks[i + 1]), funMat(o.spin, ks[i], ks[i + 1]));
    // Капюшон и его кончик — отстаёт от хода, качается позже хвоста.
    const b = o.body;
    r.ell(head, [-0.5, 0, 0], [3.7 * b, 4 * b, 4.1 * b], HOODM);
    const tip = head.p(-5.6 - o.bendF * 0.7, Math.sin(o.sway - 1.1) * 1.2, 2.6 - o.bendF * 0.35);
    r.cap(head.p(-2.6 * b, 0, 2.2 * b), tip, 1.7 * b, 0.35, HOODM);
    // Рукава: от плеч к кистям, локоть провисает; с кисти — лента по ветру.
    for (const [sd, h] of [
      [-1, o.hl],
      [1, o.hr],
    ] as const) {
      const sh = F.p(0.3 + o.lean * 4, sd * 4 * o.wide * b, zTop - 1.2);
      const hand = F.p(h[0], h[1], h[2]);
      const el = vadd(vlerp(sh, hand, 0.5), [0, 0, -1.4]);
      r.cap(sh, el, 1.35 * b, 0.95 * b, SLEEVEM);
      r.cap(el, hand, 0.95 * b, 0.45 * b, SLEEVEM);
      r.line(hand, vadd(hand, F.v(-2.6, sd * 0.8, -0.8 + Math.sin(o.sway + sd) * 0.8)), RIB, 0);
    }
  }
  if (!o.mask && o.body > 0.04) {
    const Fm = head.at(3, 0, -0.6);
    r.ell(Fm, [0, 0, 0], [1.3, 3.4, 4.2], MASK);
    eyeLines(r, Fm, o.eyes);
    r.dot(Fm.p(1.15, 0, -2), MOUTH);
    r.dot(Fm.p(1.0, 0, 2.7), MARK);
    r.eye = Fm.p(1.2, 1.2, 0.8);
  }
  if (o.mask) {
    // Сорванная маска: падает, крутясь, ложится лицом вверх, раскалывается.
    const M = o.mask;
    const Fm0 = F3.yaw(yaw + M.rot, F.p(0, 0, M.z + 3.8 * (1 - M.up) + 1.2 * M.up)).pitch(
      -1.45 * M.up,
    );
    for (const sd of [-1, 1]) {
      const Fm = Fm0.at(0, sd * M.split, 0);
      r.ell(Fm, [0, 0, 0], [1.2, 3.1, 3.8], MASK, (q) => q[1] * sd < -0.05);
      r.line(Fm.p(1.25, sd * 0.45, 0.8), Fm.p(1.25, sd * 1.75, 0.8), hx('#150f0b'), 0, 0.4);
    }
  }
  // Ленты вихря: три спирали снизу вверх.
  if (o.ribA > 0.02) {
    const n = 11;
    const col = o.body < 0.5 ? RIB_DIM : RIB;
    for (let i = 0; i < 3; i++) {
      let prev: V3 | null = null;
      for (let j = 0; j <= n; j++) {
        const k = 1 - j / n;
        if (j / n > o.ribA + 0.001) break;
        const c = sp(k);
        const a = o.spin + (i * TAU) / 3 + (1 - k) * 1.5 * PI;
        const rr = funR(k) * o.wide * Math.max(o.body, 0.4) + 1.3 + o.rib * (0.45 + 0.55 * (1 - k));
        const p: V3 = [
          c[0] + Math.cos(a) * rr,
          c[1] + Math.sin(a) * rr,
          c[2] + o.rib * 0.5 * (1 - k),
        ];
        if (prev)
          r.line(prev, p, Math.sin(a) > 0.3 ? col : Math.sin(a) > -0.3 ? RIB_DIM : RIB_BACK, 0);
        prev = p;
      }
    }
  }
  // Смерч в руках: две ленты конусом и светлое ядро.
  if (o.whirl > 0.02) {
    const C = F.p(9.4, 0, 17);
    const H = 2 + 8 * o.whirl;
    const gl = 0.45 + 0.55 * o.lock;
    for (let i = 0; i < 2; i++) {
      let prev: V3 | null = null;
      for (let j = 0; j <= 9; j++) {
        const k = j / 9;
        const a = 2.2 * o.spin + i * PI + k * 3 * PI;
        const rr = 0.4 + 3 * o.whirl * k;
        const p: V3 = [C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr, C[2] - H * 0.45 + H * k];
        if (prev) r.line(prev, p, i ? alpha(CYAN, 220) : hx('#ffffff', 230), gl);
        prev = p;
      }
    }
    if (o.lock > 0.3) r.dot(vadd(C, [0, 0, 0.5]), WHITE, 1, 2);
  }
  // Пыль и листья тянутся к смерчу по спирали.
  if (o.debris > 0.02) {
    const C = F.p(9.4, 0, 15);
    for (let i = 0; i < 6; i++) {
      const u = (o.spin * 0.35 + i / 6) % 1;
      const rr = 10 * (1 - u) * o.debris + 1;
      const a = o.spin * 1.4 + i * 1.9 + u * 2.5;
      r.dot([C[0] + Math.cos(a) * rr, C[1] + Math.sin(a) * rr, C[2] - 9 * (1 - u)], DUST[i % 4]);
    }
  }
  // Выдох смерча из рук: кольцо ветра расходится вперёд.
  if (o.puff > 0) {
    const C = F.p(10.5 + 2 * o.puff, 0, 17 - 3 * o.puff);
    const rr = 1.5 + 5 * easeOut(o.puff);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      r.dot(vadd(C, F.v(0, Math.cos(a) * rr, Math.sin(a) * rr * 0.9)), PUFF[i % 3], 0.4);
    }
  }
  return r;
}

// ---- Кадр ------------------------------------------------------------------------

const SP = kindOf('spirit', 48, 56, 24, 46, 1300);

function spiritPose(anim: string, f: number): SpO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'fly':
      return loopO(f, true);
    case 'cast':
      return castO(Math.min(t, CAST_T - 0.005));
    case 'rec':
      return recO(t - 0.5 / FPS + 0.004);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(t);
    default:
      return loopO(f, false);
  }
}

const spiritPic = (anim: string, f: number, d: number): Pic => {
  const o = spiritPose(anim, f);
  const yaw = yawN(d);
  return draw(
    SP,
    spiritRig(o, yaw),
    (out: RigOut, P2) => {
      if (anim !== 'die') return;
      const t = (f + 0.5) / FPS;
      // Маска стукнулась о пол — пыль в стороны.
      if (t > 0.45 && t < 0.62) {
        const [x, y] = P2([0, 0, 0.5]);
        spray(out.p, x, y, 8, 8, (t - 0.45) / 0.17, 61, DUST, 0, 1);
      }
    },
    2.2,
    EDGE,
  );
};

registerMobPainter('f11_spirit', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const ph = hash(id, 7);
  const tech = md === 'cast' || md === 'recover';
  const fly = md === 'chase' && moving(m, 0.8);
  const v = visOf(m, pose, tech || !fly ? (m.face ?? 0) : headOf(m, 0.8), md === 'cast' ? 14 : 8);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 3, lift: 6, still: true };
  let anim = fly ? 'fly' : 'hov';
  let f = Math.floor(now * FPS + ph * LOOP) % LOOP;
  let bob = 1;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    bob = 0;
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.72, 0.9, t);
    ex.lift = 6 * (1 - easeIn(clamp01((t - 0.12) / 0.34)));
    ex.shadow = 3 + 1.5 * sstep(0.3, 0.46, t);
  } else if (md === 'cast') {
    f = fi(t, 25);
    anim = 'cast';
    bob = 1 - sstep(0, 0.3, t);
    // Из призрака — в плотный вихрь.
    ex.alpha = lerp(0.55, 1, sstep(0, 0.16, t));
    ex.lift = 6 + 1.2 * sstep(0, 0.3, t);
  } else if (md === 'recover' && (v.prev === 'cast' || v.prev === '') && t < REST_T) {
    f = fi(t, 32);
    anim = 'rec';
    bob = sstep(1.0, 1.35, t);
    ex.lift = 7.2 - 4.2 * sstep(0.2, 0.6, t) + 3 * sstep(1.0, 1.32, t);
  } else if (md === 'stun' || hurtAge(v, now) < 0.25) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 5);
    anim = 'flinch';
  } else {
    if (md === 'emerge') dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
    // Призрак (`data.ghost`) — полупрозрачен; из отдыха тает за 0,3 с.
    if (m.data?.ghost) ex.alpha = md === 'chase' ? lerp(1, 0.55, sstep(0, 0.3, t)) : 0.55;
  }
  if (bob > 0) ex.dy = -bob * 1.3 * Math.sin(now * 3.1 + ph * TAU);
  if (md !== 'dying') hurtFx(v, now, 1.3, ex);
  return put(
    frameOf(SP, anim, f, d, pose, (dd) => spiritPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_spirit', function* () {
  yield* warmAll(
    SP,
    [
      ['fly', LOOP],
      ['cast', 26],
      ['rec', 33],
      ['flinch', 6],
      ['die', 22],
      ['hov', LOOP],
    ],
    spiritPic,
  );
});

// ---- Смерч духа (зона мозга `f11_tornado`) ---------------------------------------

/**
 * Смерч: закрученные витки и мусор по спирали. Рождается из рук духа —
 * за 0,3 с вырастает из маленького вихря на высоте рук до полного.
 */
registerZonePainter('f11_tornado', (g, z, px, py, _s, time) => {
  const age = (z as Zone).t ?? 1;
  const b = easeOut(clamp01(age / 0.3));
  const H = 26 * (0.45 + 0.55 * b);
  const y0 = py - 11 * (1 - b);
  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const r = (3 + k * 8) * (0.35 + 0.65 * b);
    const a = time * 9 + i * 0.7;
    g.strokeStyle = `rgba(230,245,255,${0.35 + 0.35 * (1 - k)})`;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px, y0 - k * H, r, r * 0.35, 0, a, a + 3.6);
    g.stroke();
  }
  g.fillStyle = 'rgba(140,110,80,0.9)';
  for (let i = 0; i < 5; i++) {
    const a = time * 7 + i * 1.3;
    const k = (time * 0.6 + i * 0.21) % 1;
    g.fillRect(Math.round(px + Math.cos(a) * (3 + k * 7) * b), Math.round(y0 - k * H), 1, 1);
  }
  g.fillStyle = `rgba(0,0,0,${(0.18 * b).toFixed(3)})`;
  g.beginPath();
  g.ellipse(px, py + 1, 8 * b + 1, 3 * b + 0.5, 0, 0, TAU);
  g.fill();
  return true;
});
