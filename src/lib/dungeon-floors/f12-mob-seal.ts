// Этаж 12 — Тюлень-толкач (анимации мобов 12). Мозг `f12_seal`
// (`f12-brains.ts`): `f12_under` — ждёт подо льдом у лунки (`data.hx/hy`),
// герой ближе 5,5 → `f12_rise` 0,55 с (всплеск на лунке, первые 0,15 с
// спрятан) → `chase`: переваливается, скорость пульсирует |sin(t·5)|.
// Видит героя дальше 1,6 → `f12_wind` 0,65 с (прицел до 0,39) →
// `f12_slide` 1,1 с (на льду ×1,5): v 7,5·(1 − (t/T)²), урон при касании
// один раз (`data.bit` = 1) → `recover` 0,8. Вплотную → `f12_flip` 0,5 с:
// конус r 1,9 впереди, урон в 0,5 → `recover` 0,8.
//
// Кадры (24 к/с от `pose.t`, 8 честных сторон): покой 8 (4 к/с, фаза от id:
// дышит, нюхает воздух, оглядывается, хвост дёргается), перевал 8 по фазе
// пульса скорости мозга (собрался — бросок грудью — шлёпнулся), выход из
// лунки 14 (голова из воды, прыжок дугой на кромку, шлепок брюхом, лай на
// героя), замах 16 (встаёт на ласты, откидывается, лает, бросается на
// брюхо), скольжение 4+4 (бурун снега у груди; быстро / тормозит), тычок
// 4 (кадр 0 — урон при касании), подъём после скольжения 18 (тормозит
// ластами, встаёт, отряхивается), удар ластом 12 + проводка 17 (кадр 0
// отхода — урон: ласт прошёл конус, туша шлёпнулась), вздрог 9, смерть 19
// (крик, переваливается на бок, ласты обмякли, `linger`). Подо льдом —
// тень и пузыри в лунке (отдельный вид в одну сторону).

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { hash, hx, ICE, ramp, SNOW, TAU, WATER, WHITE } from './f12-rig';
import {
  clamp01,
  dirOf,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  paintMob,
  pitchParts,
  PI,
  puff,
  rollParts,
  smooth,
  speedOf,
  sstep,
  stars,
  tf,
  trk,
  visOf,
  warmAll,
  yawParts,
} from './f12-mobkit';
import type { Build, Key, Part, Pt, RGBA, Scr, V3 } from './f12-mobkit';

const S_BODY = ramp('#141c28', '#263244', '#3e4c60', '#5e6e84', '#8a9aae');
const S_BELLY = ramp('#3a4450', '#5a6674', '#7e8a98', '#a6b0bc', '#d0d8e0');
const S_FLIP = ramp('#0a1018', '#18202c', '#2a3646', '#445264', '#647488');
const SPOT: RGBA = [16, 22, 34, 150];
const EYE = hx('#05080c');
const GLINT = hx('#a8c4e0');
const MAW = hx('#4a1820');
const WHISK: RGBA = [236, 244, 255, 210];
const SPRAY: RGBA[] = [WHITE, SNOW[4], SNOW[3], ICE[4]];
const DROPS: RGBA[] = [hx('#d8f0ff'), ICE[4], WATER[4], WHITE];
const SHADE: RGBA = [0, 0, 0, 80];

const K = kindOf('f12_seal', { w: 56, h: 54, ox: 28, oy: 38 }, 1200);
/** Подо льдом: пузыри и тень в лунке — одна сторона. */
const KU = kindOf('f12_seal_u', { w: 28, h: 20, ox: 14, oy: 12 }, 24, 1);

// ---------------------------------------------------------------------------
// Поза и модель.
// ---------------------------------------------------------------------------

/** Поза тюленя: отклонения от лёжки на брюхе. */
interface SealO {
  /** Перед (грудь и голова) поднят вокруг середины, рад. */
  lift: number;
  /** Горб середины (перевал), px. */
  hump: number;
  /** Зад подтянут вперёд (+) или вытянут назад (−), px. */
  gather: number;
  /** Прижат брюхом ко льду 0…1 (скольжение). */
  flat: number;
  /** Высота всей туши (прыжок из лунки), px. */
  z: number;
  /** Наклон всей туши носом вверх (полёт), рад. */
  pitch: number;
  /** Голова: кивок (+ вверх) и поворот. */
  nod: number;
  hyaw: number;
  /** Пасть 0…1. */
  mouth: number;
  /** Закрутка переда относительно зада (+ — правое плечо назад), рад. */
  twist: number;
  /** Крен всей туши (+ — на правый бок), рад. */
  roll: number;
  /** Сплющен 0…1 (шлепок), −0,15 — вытянут. */
  sq: number;
  /** Передние ласты: [мах вперёд, рад; подъём кончика, px]. */
  fL: [number, number];
  fR: [number, number];
  /** Правый ласт крупнее (замах удара ластом) 0…1. */
  big?: number;
  /** Задние ласты: подъём (рад) и развал 0…1. */
  tail: number;
  spread: number;
  /** Под водой лунки, px (выше кромки — видно). */
  sink: number;
  /** Бурун у груди (фаза 0…1) и сила 0…1. */
  spray?: [number, number];
  /** Брызги из лунки 0…1. */
  splash?: number;
  /** Снег из-под груди 0…1. */
  puff?: number;
  /** Отряхивается: снег с головы 0…1. */
  shake?: number;
  /** Снег из-под ласта (удар) 0…1. */
  slap?: number;
  /** Снег от тычка грудью 0…1. */
  bonk?: number;
  /** Звёзды оглушения (фаза). */
  stars?: number;
  /** Глаза закрыты. */
  shut?: boolean;
}

const O0: SealO = {
  lift: 0.12,
  hump: 0,
  gather: 0,
  flat: 0,
  z: 0,
  pitch: 0,
  nod: 0.25,
  hyaw: 0,
  mouth: 0,
  twist: 0,
  roll: 0,
  sq: 0,
  fL: [0.3, 0],
  fR: [0.3, 0],
  tail: 0.12,
  spread: 0.4,
  sink: 0,
};

/** Точка на поверхности эллипсоида части (пятно): u, v, w — направление. */
function onPart(p: Part, u: number, v: number, w: number): Pt {
  const l = Math.hypot(u, v, w) || 1;
  return { x: p.x + (p.rx * u) / l, y: p.y + (p.ry * v) / l, z: p.z + (p.rz * w) / l };
}

function sealBuild(o: SealO): Build {
  const parts: Part[] = [];
  const fl = o.flat;
  const sqz = 1 - 0.22 * o.sq;
  const sqy = 1 + 0.12 * o.sq;
  const R = { x: -5.4 + o.gather, z: (2.7 - fl * 0.9) * sqz };
  const M = { x: -1.4 + o.gather * 0.4, z: (3.9 + o.hump - fl * 1.6) * sqz };
  const C = { x: 2.8 + fl * 0.6, z: (4.3 - fl * 1.5) * sqz };
  // Зад, середина, брюхо.
  const rear: Part = {
    x: R.x,
    y: 0,
    z: R.z,
    rx: 3.9,
    ry: 3.4 * sqy,
    rz: 2.4 * sqz,
    ramp: S_BODY,
    fur: 0.04,
    id: 1,
  };
  const mid: Part = {
    x: M.x,
    y: 0,
    z: M.z,
    rx: 4.8,
    ry: 4.6 * sqy,
    rz: 3.4 * sqz,
    ramp: S_BODY,
    fur: 0.04,
    id: 2,
  };
  parts.push(rear, mid);
  // Хвостовой стебель — сужение к ластам.
  parts.push({
    x: R.x - 3.2,
    y: 0,
    z: Math.max(1.3, R.z - 0.7 + Math.sin(o.tail) * 0.8),
    rx: 2.3,
    ry: 2.1 * sqy,
    rz: 1.5 * sqz,
    ramp: S_BODY,
    id: 11,
  });
  parts.push({
    x: M.x + 2.2,
    y: 0,
    z: M.z - 1.7 * sqz,
    rx: 4.6,
    ry: 3.8 * sqy,
    rz: 2.3 * sqz,
    ramp: S_BELLY,
    id: 3,
  });
  // Задние ласты веером: подъём дугой от корня хвоста.
  for (const e of [-1, 1]) {
    const a = o.tail;
    const px = R.x - 4.6;
    const pz = Math.max(0.9, R.z - 1.1);
    parts.push({
      x: px - 2 * Math.cos(a),
      y: e * (0.9 + o.spread * 1.3),
      z: pz + 2 * Math.sin(a),
      rx: 2.4,
      ry: 1.4,
      rz: 0.45,
      yaw: PI - e * (0.15 + o.spread * 0.35),
      pitch: a,
      ramp: S_FLIP,
      id: 8 + e,
    });
  }
  // Пятна на спине (зад, середина).
  const spotsB: Pt[] = [];
  for (let i = 0; i < 7; i++) {
    const p = i < 3 ? rear : mid;
    spotsB.push(onPart(p, hash(i, 1, 61) * 1.6 - 0.8, hash(i, 2, 61) * 1.6 - 0.8, 0.9));
  }
  // Перед: грудь, голова, морда — поднимается и закручивается вокруг середины.
  const fg = parts.length;
  const chest: Part = {
    x: C.x,
    y: 0,
    z: C.z,
    rx: 3.6,
    ry: 4 * sqy,
    rz: 3.2 * sqz,
    ramp: S_BODY,
    fur: 0.04,
    id: 4,
  };
  parts.push(chest);
  parts.push({
    x: C.x + 0.8,
    y: 0,
    z: C.z - 1.6,
    rx: 3,
    ry: 3.4,
    rz: 2.2,
    ramp: S_BELLY,
    id: 5,
  });
  const spotsF: Pt[] = [];
  for (let i = 0; i < 3; i++)
    spotsF.push(onPart(chest, hash(i, 3, 61) * 1.2 - 0.9, hash(i, 4, 61) * 1.6 - 0.8, 0.9));
  const N = { x: C.x + 2, z: C.z + 1.4 };
  const H = { x: C.x + 3.4, z: C.z + 2.6 - fl * 1.2 };
  const hg = parts.length;
  parts.push({ x: H.x, y: 0, z: H.z, rx: 2.9, ry: 2.7, rz: 2.6, ramp: S_BODY, id: 6 });
  parts.push({ x: H.x + 2.3, y: 0, z: H.z - 0.6, rx: 1.7, ry: 1.8, rz: 1.3, ramp: S_BELLY, id: 7 });
  if (o.mouth > 0.05)
    parts.push({
      x: H.x + 2,
      y: 0,
      z: H.z - 1.5 - o.mouth * 0.9,
      rx: 1.6,
      ry: 1.5,
      rz: 0.75,
      pitch: -o.mouth * 0.5,
      ramp: S_BELLY,
      id: 10,
    });
  const eyePts: Pt[] = [
    { x: H.x + 1.9, y: -1.45, z: H.z + 0.8 },
    { x: H.x + 1.9, y: 1.45, z: H.z + 0.8 },
  ];
  const nose: Pt[] = [
    { x: H.x + 3.9, y: 0, z: H.z - 0.3 },
    { x: H.x + 3.5, y: 0, z: H.z - 1.3 - o.mouth * 0.7 },
    { x: H.x + 2.6, y: -1.9, z: H.z - 0.8 },
    { x: H.x + 2.6, y: 1.9, z: H.z - 0.8 },
  ];
  const head = [eyePts, nose];
  pitchParts(parts, o.nod, N.x, N.z, hg);
  yawParts(parts, o.hyaw, N.x, hg);
  for (const g of head) {
    pitchParts(g, o.nod, N.x, N.z);
    yawParts(g, o.hyaw, N.x);
  }
  // Корни передних ласт — на груди, едут с передом.
  const roots: Pt[] = [
    { x: C.x + 0.2, y: -3.3 * sqy, z: C.z - 2 },
    { x: C.x + 0.2, y: 3.3 * sqy, z: C.z - 2 },
  ];
  pitchParts(parts, o.lift, M.x, M.z, fg);
  yawParts(parts, o.twist, M.x, fg);
  for (const g of [...head, spotsF, roots]) {
    pitchParts(g, o.lift, M.x, M.z);
    yawParts(g, o.twist, M.x);
  }
  // Передние ласты: от корня к кончику — на льду, если не подняты.
  for (const [i, e] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const [a, up] = e > 0 ? o.fR : o.fL;
    const r = roots[i];
    const ang = e * (PI - 0.4 - a) + o.twist;
    const g = e > 0 ? 1 + 0.4 * (o.big ?? 0) : 1;
    const L = 3 * g;
    const tz = Math.max(0.7, Math.min(r.z + 1.5, 0.7 + up));
    const tip: V3 = [r.x + Math.cos(ang) * L, r.y + Math.sin(ang) * L, tz];
    parts.push({ x: r.x, y: r.y, z: r.z, rx: 1.2, ry: 1.2, rz: 1.2, ramp: S_BODY, id: 20 + e });
    parts.push({
      x: (r.x + tip[0]) / 2,
      y: (r.y + tip[1]) / 2,
      z: (r.z + tip[2]) / 2 + 0.3,
      rx: 0.9,
      ry: 0.9,
      rz: 0.9,
      ramp: S_FLIP,
      id: 22 + e,
    });
    parts.push({
      x: tip[0] - Math.cos(ang) * 0.5,
      y: tip[1] - Math.sin(ang) * 0.5,
      z: tip[2],
      rx: 1.8 * g,
      ry: 0.95 * g,
      rz: 0.45,
      yaw: ang,
      pitch: Math.atan2(tip[2] - r.z, L),
      ramp: S_FLIP,
      id: 24 + e,
    });
  }
  // Вся туша: крен, наклон полёта, высота, вода.
  const all = [eyePts, nose, spotsB, spotsF];
  rollParts(parts, o.roll, 2);
  pitchParts(parts, o.pitch, M.x, M.z);
  for (const g of all) {
    rollParts(g, o.roll, 2);
    pitchParts(g, o.pitch, M.x, M.z);
  }
  const dz = o.z - o.sink;
  if (dz) {
    for (const p of parts) p.z += dz;
    for (const g of all) for (const p of g) p.z += dz;
  }
  const extent: V3[] = [];
  if (o.z > 0.5) extent.push([M.x - 7, 0, 0], [M.x + 7, 0, 0], [M.x, 3, 0], [M.x, -3, 0]);
  if (o.spray) extent.push([C.x + 5, 8, 0], [C.x + 5, -8, 0], [-12, 9, 2], [-12, -9, 2]);
  if (o.puff !== undefined || o.slap !== undefined || o.bonk !== undefined)
    extent.push([10, 9, 0], [10, -9, 0], [-6, 9, 0], [-6, -9, 0]);
  if (o.splash !== undefined) extent.push([7, 7, 8], [-7, -7, 0], [7, -7, 0], [-7, 7, 8]);
  return {
    parts,
    eyes: o.shut ? [] : eyePts.map((e) => ({ x: e.x, y: e.y, z: e.z, c: EYE, r: 1 })),
    clip: o.sink > 0 ? 0.3 : undefined,
    extent,
    post: (p, scr, fx) => {
      const vis = (q: Pt, tol = 1.3): [number, number] | null => {
        const [x, y, d] = scr(q.x, q.y, q.z);
        const X = Math.floor(x);
        const Y = Math.floor(y);
        return Math.abs(fx.z(X, Y) - d) < tol ? [X, Y] : null;
      };
      // Пятна — только там, где поверхность и есть эта точка.
      for (const s of [...spotsB, ...spotsF]) {
        const q = vis(s, 1.1);
        if (q) p.set(q[0], q[1], SPOT);
      }
      // Блик в глазу (свет сверху слева).
      if (!o.shut)
        for (const e of eyePts) {
          const [x, y, d] = scr(e.x, e.y, e.z);
          const X = Math.floor(x);
          const Y = Math.floor(y);
          if (fx.z(X, Y) > d + 1.2) continue;
          p.set(X, Y, GLINT);
          break;
        }
      // Нос, усы, пасть.
      const nq = vis(nose[0], 2.2);
      if (nq) p.set(nq[0], nq[1], EYE);
      // Усы — по щекам морды, где щека видна: две точки наружу.
      for (const w of [nose[2], nose[3]]) {
        const q = vis(w, 2);
        if (!q) continue;
        const [cx] = scr(nose[0].x, nose[0].y, nose[0].z);
        const s = q[0] < cx - 0.5 ? -1 : q[0] > cx + 0.5 ? 1 : 0;
        p.set(q[0], q[1], WHISK);
        if (s) p.set(q[0] + s, q[1] + 1, WHISK);
      }
      if (o.mouth > 0.35) {
        const q = vis(nose[1], 2.4);
        if (q) {
          p.set(q[0], q[1], MAW);
          if (o.mouth > 0.7) p.set(q[0], q[1] - 1, MAW);
        }
      }
      if (o.z > 0.5) shadowOf(p, scr, M.x, o.z);
      if (o.spray) sprayOf(p, scr, C.x + 3, o.spray[0], o.spray[1]);
      if (o.splash !== undefined) splashOf(p, scr, o.splash);
      if (o.sink > 0) ringOf(p, scr, o.sink);
      if (o.puff !== undefined) puff(p, scr, C.x + 2, 0, o.puff, 10, 7, 71, SPRAY, 0, TAU);
      if (o.bonk !== undefined) puff(p, scr, C.x + 6, 0, o.bonk, 12, 8, 73, SPRAY, 0, PI * 1.3);
      if (o.slap !== undefined) puff(p, scr, C.x + 5, -2, o.slap, 12, 9, 75, SPRAY, -0.5, PI);
      if (o.shake !== undefined) shakeOf(p, scr, nose[0], o.shake);
      if (o.stars !== undefined) stars(p, scr, H.z + 6 + dz, o.stars, H.x - 1, 0, 3.5);
    },
  };
}

/** Тень на льду под прыгнувшим: тем меньше и светлее, чем выше. */
function shadowOf(p: Px, scr: Scr, x: number, z: number): void {
  const [cx, cy] = scr(x, 0, 0);
  const k = 1 - Math.min(0.5, z / 20);
  const rx = 7 * k;
  const ry = 2.4 * k;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let X = Math.floor(cx - rx); X <= Math.ceil(cx + rx); X++) {
      const u = (X + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      if (u * u + v * v <= 1 && !p.solid(X, y)) p.set(X, y, SHADE);
    }
}

/** Бурун у груди: снег отлетает назад вдоль боков. */
function sprayOf(p: Px, scr: Scr, x0: number, ph: number, k: number): void {
  const n = Math.round(6 + k * 8);
  for (let i = 0; i < n; i++) {
    const e = i % 2 ? 1 : -1;
    const q = (i / n + ph) % 1;
    const y = e * (3.4 + q * (3 + k * 3) + hash(i, 5, 81));
    const x = x0 + 1 - q * (8 + k * 6);
    const z = Math.sin(q * PI) * (1.5 + k * 3) + 0.3;
    const [sx, sy] = scr(x, y, z);
    const c = SPRAY[i % SPRAY.length];
    p.set(sx, sy, q > 0.65 ? [c[0], c[1], c[2], Math.round(255 * (1 - q) * 2.6)] : c);
  }
}

/** Брызги из лунки: капли дугой во все стороны. */
function splashOf(p: Px, scr: Scr, k: number): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < 12; i++) {
    const a = hash(i, 7, 83) * TAU;
    const v = 0.5 + hash(i, 8, 83) * 0.5;
    const r = 7 * k * v;
    const z = Math.sin(k * PI) * (4 + 5 * v);
    const [sx, sy] = scr(Math.cos(a) * r, Math.sin(a) * r, z);
    const c = DROPS[i % DROPS.length];
    p.set(sx, sy, k > 0.7 ? [c[0], c[1], c[2], Math.round(255 * (1 - k) * 3.3)] : c);
  }
}

/** Кромка воды вокруг тела, что выходит из лунки. */
function ringOf(p: Px, scr: Scr, sink: number): void {
  const r = 4.5 + Math.min(3, sink * 0.3);
  for (let a = 0; a < 22; a++) {
    const t = (a / 22) * TAU;
    const [wx, wy] = scr(Math.cos(t) * r, Math.sin(t) * r * 0.9, 0.3);
    if (!p.solid(Math.round(wx), Math.round(wy)))
      p.set(wx, wy, a % 3 ? [ICE[4][0], ICE[4][1], ICE[4][2], 200] : WHITE);
  }
}

/** Отряхивается: крупинки снега разлетаются от головы. */
function shakeOf(p: Px, scr: Scr, n: Pt, k: number): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < 8; i++) {
    const e = i % 2 ? 1 : -1;
    const q = clamp01(k * 1.4 - (i >> 1) * 0.12);
    if (q <= 0 || q >= 1) continue;
    const [sx, sy] = scr(n.x - 3 - q * 2, n.y + e * (2 + q * 6), n.z + 1 + Math.sin(q * PI) * 3);
    p.set(sx, sy, SPRAY[i % 3]);
  }
}

/** Подо льдом: тень кружит в лунке, пузыри всплывают и лопаются. */
function underBuild(f: number): Build {
  const ph = f / 12;
  return {
    parts: [],
    extent: [
      [-8, -6, 0],
      [8, 6, 0],
      [0, 0, 5],
    ],
    post: (p, scr) => {
      // Тень тюленя под водой: кружит у кромки.
      const a = ph * TAU;
      const [cx, cy] = scr(Math.cos(a) * 2.2, Math.sin(a) * 2.2, 0);
      const ta = a + PI / 2;
      const ca = Math.cos(ta);
      const sa = Math.sin(ta) * 0.77;
      for (let y = -4; y <= 4; y++)
        for (let x = -6; x <= 6; x++) {
          const u = (x * ca + y * sa) / 5.5;
          const v = (-x * sa + y * ca) / 2.2;
          if (u * u + v * v <= 1) p.set(cx + x, cy + y, [4, 10, 22, 120]);
        }
      // Пузыри: три по своему кругу, растут, лопаются кольцом.
      for (let i = 0; i < 3; i++) {
        const q = (ph * 2 + i / 3) % 1;
        const [bx, by] = scr(
          (hash(i, 1, 91) - 0.5) * 7,
          (hash(i, 2, 91) - 0.5) * 6,
          q < 0.75 ? q * 2 : 1.5,
        );
        if (q < 0.75) {
          p.set(bx, by, DROPS[0]);
          if (q > 0.35) p.set(bx + 1, by, DROPS[1]);
          if (q > 0.55) p.set(bx, by - 1, DROPS[1]);
        } else {
          const r = 1 + (q - 0.75) * 8;
          for (let k = 0; k < 6; k++) {
            const t = (k / 6) * TAU;
            p.set(bx + Math.cos(t) * r, by + Math.sin(t) * r * 0.6, [216, 240, 255, 150]);
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Дорожки.
// ---------------------------------------------------------------------------

const two = (keys: Key[], up: Key[], k: number): [number, number] => [trk(k, keys), trk(k, up)];

/** Перевал по фазе пульса скорости мозга: 0 — собрался, 0,5 — бросок. */
function walkPose(f: number): SealO {
  const u = f / 8;
  const fl = two(
    [
      [0, 0.15],
      [0.25, 0.9],
      [0.5, 1.25],
      [0.75, 0.5],
      [1, 0.15],
    ],
    [
      [0, 0],
      [0.25, 1.4],
      [0.5, 0.8],
      [0.7, 0],
      [1, 0],
    ],
    u,
  );
  return {
    ...O0,
    hump: trk(u, [
      [0, 1.5],
      [0.25, 0.7],
      [0.5, -0.3],
      [0.75, 0.1],
      [1, 1.5],
    ]),
    gather: trk(u, [
      [0, 1.8],
      [0.25, 0.6],
      [0.5, -1.3],
      [0.75, -0.5],
      [1, 1.8],
    ]),
    lift: trk(u, [
      [0, 0.04],
      [0.25, 0.3],
      [0.5, 0.22],
      [0.75, -0.04],
      [1, 0.04],
    ]),
    nod: trk(u, [
      [0, 0.12],
      [0.25, 0.4],
      [0.5, 0.28],
      [0.75, 0],
      [1, 0.12],
    ]),
    sq: trk(u, [
      [0, 0],
      [0.5, -0.1],
      [0.75, 0.35],
      [0.87, 0.1],
      [1, 0],
    ]),
    fL: fl,
    fR: fl,
    tail: trk(u, [
      [0, 0.08],
      [0.25, 0.2],
      [0.5, 0.6],
      [0.75, 0.35],
      [1, 0.08],
    ]),
    roll: Math.sin(u * TAU) * 0.04,
    puff: f === 6 ? 0.3 : f === 7 ? 0.6 : undefined,
  };
}

/** Скольжение: `q` — фаза буруна, `fast` — летит (иначе тормозит). */
function slidePose(q: number, fast: boolean): SealO {
  return {
    ...O0,
    flat: 1,
    lift: fast ? 0 : 0.12,
    nod: fast ? 0.3 : 0.35,
    gather: -2.6,
    hump: -0.6,
    fL: fast ? [-0.25, 0.6] : [0.55, 0],
    fR: fast ? [-0.25, 0.6] : [0.55, 0],
    tail: fast ? 0.85 : 0.55,
    spread: 0.15,
    sq: -0.1,
    mouth: fast ? 0.4 : 0,
    roll: (q % 2 ? 1 : -1) * (fast ? 0.06 : 0.03),
    spray: [q / 4, fast ? 1 : 0.4],
  };
}

function pose(anim: string, f: number): SealO {
  switch (anim) {
    case 'idle': {
      // 8 кадров по 4 к/с: дышит, нюхает воздух, оглядывается, дёргает хвостом.
      const ph = (f / 8) * TAU;
      return {
        ...O0,
        hump: 0.3 * Math.sin(ph),
        sq: 0.06 * Math.sin(ph + 1),
        nod: 0.25 + [0, 0, 0.25, 0.35, 0.1, 0, 0, 0][f],
        mouth: f === 3 ? 0.3 : 0,
        hyaw: [0, 0, 0, 0, 0, 0.45, 0.5, 0.15][f],
        tail: 0.12 + [0, 0, 0, 0, 0.5, 0.25, 0, 0][f],
        fR: [0.3 + (f === 1 ? 0.3 : 0), f === 1 ? 1 : 0],
        shut: f === 7,
      };
    }
    case 'walk':
      return walkPose(f);
    case 'rise': {
      // 0,55 с: голова из воды (0–0,15, спрятан), прыжок дугой на кромку,
      // шлепок брюхом (0,4), встаёт и лает на героя.
      const t = tf(f);
      const air = clamp01((t - 0.15) / 0.25);
      const flying = t >= 0.15 && t < 0.4;
      const landed = t >= 0.4;
      const o: SealO = {
        ...O0,
        sink: t < 0.15 ? lerp(10, 5, easeOut(t / 0.15)) : lerp(5, 0, sstep(0, 0.4, air)),
        z: flying ? Math.sin(air * PI) * 9 : 0,
        pitch: t < 0.15 ? 0 : flying ? lerp(0.55, -0.45, air) : 0,
        lift:
          t < 0.15
            ? 0.6
            : flying
              ? 0.15
              : trk(t, [
                  [0.4, -0.05],
                  [0.46, 0.2],
                  [0.52, 0.55],
                ]),
        nod:
          t < 0.15
            ? 0.5
            : flying
              ? 0.2
              : trk(t, [
                  [0.4, 0],
                  [0.52, 0.6],
                ]),
        gather: flying
          ? -1.4
          : landed
            ? trk(t, [
                [0.4, -1],
                [0.5, 0.3],
              ])
            : 0,
        fL: flying ? [-0.3, 2] : t < 0.15 ? [0.9, 1.5] : [0.6, 0],
        fR: flying ? [-0.3, 2] : t < 0.15 ? [0.9, 1.5] : [0.6, 0],
        tail: flying ? 0.95 : 0.5,
        spread: flying ? 0.1 : 0.4,
        sq: landed
          ? trk(t, [
              [0.4, 0.5],
              [0.46, 0.05],
              [0.5, 0],
            ])
          : flying
            ? -0.12
            : 0,
        mouth: t >= 0.46 ? 1 : 0,
        splash: t < 0.32 ? t / 0.32 : undefined,
        puff: landed && t < 0.55 ? (t - 0.4) / 0.2 : undefined,
      };
      return o;
    }
    case 'wind': {
      // 0,65 с: встаёт на ласты, откидывается, лает дважды (держит), бросается
      // вперёд на брюхо — последний кадр уже стартовый для скольжения.
      const k = tf(f) / 0.65;
      const fl = two(
        [
          [0, 0.3],
          [0.3, 0.95],
          [0.8, 0.95],
          [1, -0.2],
        ],
        [
          [0, 0],
          [0.8, 0],
          [0.9, 1.5],
          [1, 0.6],
        ],
        k,
      );
      return {
        ...O0,
        lift: trk(k, [
          [0, 0.12],
          [0.3, 0.75, easeOut],
          [0.55, 0.85],
          [0.77, 0.9],
          [0.9, 0.3, easeIn],
          [1, -0.08, easeIn],
        ]),
        gather: trk(k, [
          [0, 0],
          [0.3, 1.4],
          [0.77, 1.6],
          [1, -1.4, easeIn],
        ]),
        hump: trk(k, [
          [0, 0],
          [0.3, 0.8],
          [0.77, 0.9],
          [1, -0.4],
        ]),
        nod: trk(k, [
          [0, 0.25],
          [0.3, 0.6],
          [0.55, 0.75],
          [0.77, 0.6],
          [0.9, 0.2],
          [1, 0.35],
        ]),
        mouth: trk(k, [
          [0.35, 0],
          [0.43, 1],
          [0.52, 0.25],
          [0.6, 1],
          [0.7, 0.2],
          [0.8, 0],
          [1, 0.4],
        ]),
        fL: fl,
        fR: fl,
        tail: trk(k, [
          [0, 0.35],
          [0.3, 0.9],
          [0.77, 1],
          [1, 0.8],
        ]),
        flat: trk(k, [
          [0.85, 0],
          [1, 0.8],
        ]),
        sq: trk(k, [
          [0.92, 0],
          [1, -0.15],
        ]),
      };
    }
    case 'slide':
      return slidePose(f % 4, f < 4);
    case 'bonk': {
      // Тычок грудью в героя: кадр 0 — урон; туша сжалась, голова откинулась.
      const a = [1, 0.7, 0.4, 0.15][f];
      return {
        ...slidePose(f % 4, true),
        sq: 0.1 + 0.35 * a,
        gather: -1.6 + 1.6 * a,
        nod: 0.5 + 0.45 * a,
        lift: 0.12 + 0.25 * a,
        mouth: 1,
        bonk: 0.15 + f * 0.22,
      };
    }
    case 'srec': {
      // 0,8 с: тормозит ластами, встаёт, отряхивается, ложится.
      const t = tf(f);
      const fl = two(
        [
          [0, -0.25],
          [0.08, 1],
          [0.3, 0.6],
          [0.8, 0.3],
        ],
        [
          [0, 0.6],
          [0.08, 0],
        ],
        t,
      );
      const sk = clamp01((t - 0.3) / 0.25);
      return {
        ...O0,
        flat: trk(t, [
          [0, 1],
          [0.12, 0.5],
          [0.3, 0],
        ]),
        lift: trk(t, [
          [0, 0.15],
          [0.12, 0.45],
          [0.3, 0.42],
          [0.55, 0.35],
          [0.8, 0.12],
        ]),
        gather: trk(t, [
          [0, -1.6],
          [0.3, 0.6],
          [0.55, 0.2],
          [0.8, 0],
        ]),
        hump: trk(t, [
          [0, -0.4],
          [0.3, 0.5],
          [0.55, 0.2],
          [0.8, 0],
        ]),
        nod: trk(t, [
          [0, 0.45],
          [0.12, 0.3],
          [0.3, 0.5],
          [0.55, 0.4],
          [0.8, 0.25],
        ]),
        hyaw: sk > 0 && sk < 1 ? 0.55 * Math.sin(sk * 3 * PI) * (1 - sk * 0.5) : 0,
        fL: fl,
        fR: fl,
        tail: trk(t, [
          [0, 0.8],
          [0.3, 0.4],
          [0.8, 0.35],
        ]),
        puff: t < 0.2 ? t / 0.2 : undefined,
        shake: t >= 0.3 && t < 0.62 ? (t - 0.3) / 0.32 : undefined,
      };
    }
    case 'flip':
    case 'frec': {
      // Удар ластом-боком: встаёт, закручивает перед вправо и заносит правый
      // ласт (держит, скалится), хлёст через весь конус — урон в 0,5 (кадр 0
      // отхода): ласт впереди-слева, туша шлёпнулась; проводка, возврат.
      const t = anim === 'flip' ? tf(f) : 0.5 + tf(f);
      const k = t / 0.5;
      const swing: Key[] = [
        [0, 0.3],
        [0.35, -0.3, easeOut],
        [0.8, -0.35],
        [1, 1.5, easeIn],
        [1.2, 1.7],
        [1.8, 0.3],
      ];
      const up: Key[] = [
        [0, 0],
        [0.35, 6.5, easeOut],
        [0.8, 7],
        [1, 1.2, easeIn],
        [1.1, 0],
      ];
      const tremble = k > 0.4 && k < 0.8 ? (f % 2 ? 0.04 : -0.04) : 0;
      return {
        ...O0,
        lift: trk(k, [
          [0, 0.12],
          [0.35, 0.6, easeOut],
          [0.8, 0.7],
          [0.92, 0.45, easeIn],
          [1, -0.05, easeIn],
          [1.1, 0.05],
          [1.2, -0.02],
          [1.7, 0.12],
        ]),
        twist:
          trk(k, [
            [0, 0],
            [0.35, 0.7, easeOut],
            [0.8, 0.8],
            [1, -0.6, easeIn],
            [1.12, -0.8],
            [1.7, 0],
          ]) + tremble,
        roll: trk(k, [
          [0, 0],
          [0.35, -0.12],
          [0.8, -0.15],
          [1, 0.12],
          [1.2, 0.05],
          [1.6, 0],
        ]),
        hump: trk(k, [
          [0, 0],
          [0.35, 0.7],
          [0.8, 0.7],
          [1, 0],
          [1.6, 0],
        ]),
        nod: trk(k, [
          [0, 0.25],
          [0.35, 0.5],
          [0.8, 0.55],
          [1, 0.05],
          [1.6, 0.25],
        ]),
        mouth: trk(k, [
          [0.3, 0],
          [0.45, 0.8],
          [0.8, 0.8],
          [1, 0.4],
          [1.3, 0],
        ]),
        fR: [trk(k, swing), trk(k, up)],
        big: trk(k, [
          [0, 0],
          [0.3, 1],
          [1.2, 1],
          [1.6, 0],
        ]),
        fL: [
          trk(k, [
            [0, 0.3],
            [0.35, 0.6],
            [1, 0.5],
            [1.6, 0.3],
          ]),
          0,
        ],
        tail: trk(k, [
          [0, 0.35],
          [0.35, 0.8],
          [1, 0.6],
          [1.6, 0.35],
        ]),
        sq: trk(k, [
          [0.95, 0],
          [1, 0.45],
          [1.06, 0.05],
          [1.12, 0.15],
          [1.25, 0],
        ]),
        slap: k >= 1 && k < 1.5 ? 0.12 + (k - 1) * 1.7 : undefined,
      };
    }
    case 'stun': {
      // Вздрог 0,35 с: голову откинуло, ласты вскинуты, сплющился — и назад.
      const a = [0, 1, 0.85, 0.6, 0.4, 0.25, 0.12, 0.05, 0][f];
      return {
        ...O0,
        lift: 0.12 + 0.4 * a,
        nod: 0.25 + 0.6 * a,
        mouth: 0.8 * a,
        fL: [0.3 + 0.6 * a, 2.5 * a],
        fR: [0.3 + 0.7 * a, 2.8 * a],
        tail: 0.35 + 0.5 * a,
        sq: f === 1 ? 0.3 : f === 2 ? 0.1 : 0,
        shut: f >= 1 && f <= 3,
        stars: f >= 2 ? f / 8 : undefined,
      };
    }
    case 'die': {
      // Крик, валится на бок (отскок), ласты обмякли, хвост дёрнулся.
      const t = tf(f);
      return {
        ...O0,
        roll: trk(t, [
          [0.15, 0],
          [0.45, 1.35, easeIn],
          [0.52, 1.18],
          [0.6, 1.3],
        ]),
        lift: trk(t, [
          [0, 0.12],
          [0.08, 0.55],
          [0.3, 0.3],
          [0.5, 0],
        ]),
        nod: trk(t, [
          [0, 0.25],
          [0.08, 0.9],
          [0.3, 0.4],
          [0.55, -0.15],
        ]),
        mouth: trk(t, [
          [0, 0],
          [0.06, 1],
          [0.3, 0.6],
          [0.55, 0.2],
        ]),
        fL: [
          trk(t, [
            [0, 0.3],
            [0.3, 1],
            [0.6, 0.7],
          ]),
          trk(t, [
            [0, 0],
            [0.3, 3],
            [0.6, 1],
          ]),
        ],
        fR: [
          trk(t, [
            [0, 0.3],
            [0.3, 1.1],
            [0.6, 0.6],
          ]),
          trk(t, [
            [0, 0],
            [0.3, 2.5],
            [0.6, 0.6],
          ]),
        ],
        tail: trk(t, [
          [0.5, 0.9],
          [0.58, 0.3],
          [0.64, 0.7],
          [0.72, 0.3],
        ]),
        sq: t > 0.45 && t < 0.52 ? 0.25 : 0,
        shut: t > 0.3,
        puff: t >= 0.45 && t < 0.68 ? (t - 0.45) / 0.23 : undefined,
      };
    }
  }
  return O0;
}

// ---------------------------------------------------------------------------
// Кадры и рисовальщик.
// ---------------------------------------------------------------------------

const span = (a: number, b: number, step = 1) => {
  const out: number[] = [];
  for (let i = a; i <= b; i += step) out.push(i);
  return out;
};
/** Кадры позы на дорожке техники: номер кадра 24 к/с, с которого поза. */
const KEYS: Record<string, number[]> = {
  idle: span(0, 7),
  walk: span(0, 7),
  rise: span(0, 13),
  wind: span(0, 15),
  slide: span(0, 7),
  bonk: span(0, 3),
  srec: [...span(0, 15), 17, 19],
  flip: span(0, 11),
  frec: [...span(0, 13), 15, 17, 19],
  stun: span(0, 8),
  die: [...span(0, 16), 18, 20],
};
const LAST: Record<string, number> = {
  rise: 13,
  wind: 15,
  srec: 19,
  flip: 11,
  frec: 19,
  stun: 8,
  die: 20,
};
function keyOf(anim: string, f: number): number {
  const ks = KEYS[anim];
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1] <= f) i++;
  return i;
}
const build = (anim: string, i: number) => sealBuild(pose(anim, KEYS[anim][i]));
const N = Object.fromEntries(Object.entries(KEYS).map(([a, ks]) => [a, ks.length]));

const TS = 16;
const DIE = 0.85;
/** Тычок в скольжении: миг, когда `data.bit` стал 1 (урон при касании). */
const BIT = new WeakMap<Mob, { bit: number; at: number }>();

/** Лунка относительно моба, клетки (без данных поста — позади на 1,8). */
function holeOf(m: Mob): [number, number] {
  const d = m.data ?? {};
  if (d.hx !== undefined && d.hy !== undefined) return [d.hx - (m.x ?? 0), d.hy - (m.y ?? 0)];
  const f = m.face ?? 0;
  return [-Math.cos(f) * 1.8, -Math.sin(f) * 1.8];
}

paintMob('f12_seal', (m: Mob, p: MobPose): MobFrame => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  if (mode === 'f12_under') {
    const f = idlePh(m, now, 8, 12);
    const fr = frameOf(KU, 'under', f, 0, p, () => underBuild(f));
    const [hx2, hy2] = holeOf(m);
    return { ...fr, dx: hx2 * TS, dy: hy2 * TS, still: true, shadow: 0 };
  }
  const sp = speedOf(m);
  const mv = sp > 0.3;
  let want = mv && mode === 'chase' ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  let hole: [number, number] | null = null;
  if (mode === 'f12_rise') {
    hole = holeOf(m);
    if (t < 0.42 && Math.hypot(hole[0], hole[1]) > 0.2) want = Math.atan2(-hole[1], -hole[0]);
  }
  const v = visOf(m, p, want, mode === 'f12_rise' ? 16 : mode === 'chase' ? 7 : 12);
  const fc = v.yaw;
  const cf = Math.cos(fc);
  const sf = Math.sin(fc) * 0.77;
  const ex: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, LAST.die);
    ex.linger = DIE;
    ex.alpha = 1 - sstep(0.62, DIE, t);
    ex.still = true;
  } else if (mode === 'f12_rise' && hole) {
    anim = 'rise';
    f = fi(t, LAST.rise);
    ex.still = true;
    // Из лунки — дугой на кромку: кадр едет от лунки к месту моба.
    const s = 1 - smooth((t - 0.15) / 0.25);
    ex.dx = hole[0] * TS * s;
    ex.dy = hole[1] * TS * s;
    ex.shadow = t >= 0.4 ? 8 : 0;
  } else if (mode === 'f12_wind') {
    anim = 'wind';
    f = fi(t, LAST.wind);
    ex.still = true;
    // Откинулся на зад — и бросок вперёд.
    const go = -0.9 * sstep(0.1, 0.45, t / 0.65) + 2.2 * sstep(0.85, 1, t / 0.65);
    ex.dx = cf * go;
    ex.dy = sf * go;
  } else if (mode === 'f12_slide') {
    let b = BIT.get(m);
    if (!b) BIT.set(m, (b = { bit: m.data?.bit ?? 0, at: -9 }));
    const bit = m.data?.bit ?? 0;
    if (bit === 1 && b.bit !== 1) b.at = now;
    b.bit = bit;
    const age = now - b.at;
    ex.still = true;
    if (age >= 0 && age < 4 / 24) {
      anim = 'bonk';
      f = Math.min(3, Math.floor(age * 24));
    } else {
      anim = 'slide';
      f = (sp > 3.6 ? 0 : 4) + (fi(t, 1e9) % 4);
    }
    if (sp > 3.6) ex.ghost = { every: 0.05, life: 0.2, tint: '#bfe8ff', alpha: 0.3 };
  } else if (mode === 'f12_flip') {
    anim = 'flip';
    f = fi(t, LAST.flip);
    ex.still = true;
    if (f >= 10) ex.ghost = { every: 0.02, life: 0.12, tint: '#bfe8ff', alpha: 0.35 };
  } else if (mode === 'recover') {
    // После скольжения — встаёт; после удара ластом — проводка.
    const d = m.data ?? {};
    const slid = v.prev
      ? v.prev === 'f12_slide'
      : m.cd !== undefined
        ? m.cd + t > 1.45
        : d.bit !== undefined;
    anim = slid ? 'srec' : 'frec';
    f = fi(t, LAST[anim]);
    ex.still = f < 12;
    if (!slid && f < 2) ex.ghost = { every: 0.02, life: 0.12, tint: '#bfe8ff', alpha: 0.3 };
    if (!slid && f === 0) {
      ex.sx = 1.08;
      ex.sy = 0.92;
    }
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, LAST.stun);
    const a = [0, 1, 0.8, 0.5, 0.3, 0.15, 0.05, 0, 0][f];
    ex.dx = -cf * a * 1.4;
    ex.dy = -sf * a * 1.4;
  } else if (mv) {
    // Перевал в такт пульсу скорости мозга (|sin(t·5)|): бросок — на пике.
    anim = 'walk';
    const ph = ((((t * 5) / PI) % 1) + 1) % 1;
    f = Math.floor(ph * 8) % 8;
  } else {
    f = idlePh(m, now, 4, 8);
  }
  const i = keyOf(anim, f);
  const fr = frameOf(K, anim, i, dirOf(fc), p, () => build(anim, i));
  if (mode !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_seal', function* () {
  yield* warmAll(KU, [['under', 12]], (_a, f) => underBuild(f));
  yield* warmAll(K, Object.entries(N) as [string, number][], build);
});
