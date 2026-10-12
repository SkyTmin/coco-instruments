// Дрон-разведчик (анимации мобов 11): латунный шар-турель с поясом
// заклёпок, линзой-глазом и стволом под ней, мачта с винтом сверху, два
// плавника-стабилизатора снизу-сзади, красный ходовой огонь на корме.
// Мини-3D (`f15-rig.ts`), 8 сторон честно (свет сверху-слева); техники — 24 к/с
// от `pose.t`.
//
// Глаз дрона всегда на герое — так велит мозг (`m.face` к герою и в облёте):
// дрон не идёт, а висит и обходит цель по кругу, разглядывая её, — это и есть
// его работа (исключение из «боком не ходят»: у шара нет корпуса поперёк хода).
// Ход читается креном: винт тянет туда, куда летит, — шар кренится вбок по
// облёту и клюёт носом при сближении (уровни крена — в ключе кадра, меняются
// не чаще раза в 0,07 с). Покачивание — смещением `dy`, без новых кадров.
//
// Метроном — `f11-brains.ts` (`f11_drone`, `DRONE`):
// - `aim` 0,6 с: встал, присел назад (замах), винт на форсаж, ствол выдвинулся,
//   глаз — оранжевый → красный, у дула копится заряд; последние 0,2 с — замок:
//   дрожь и мигание глаза белым;
// - выстрел 1 — первый кадр `f11_burst` (вспышка, отдача, нос вверх), за 0,16 с
//   заряд второго; выстрел 2 — первый кадр `recover` после `f11_burst`;
// - `recover` 0,8 с: отдача, нос качнулся и успокоился, ствол убрался, глаз
//   остывает (красный → оранжевый → бирюзовый), из дула дымок;
// - удар героя — вздрог 5 кадров, искры, глаз гаснет на миг;
// - смерть 0,9 с: искры, глаз гаснет, винт встаёт, падает, крутясь, удар об
//   пол, искрит — хлопок, мачта, ствол и плавники разлетаются, дым.
// Снаряд `f11_dart` (трассер на высоте ствола, 16 сторон) и его контакт —
// искры поверх темноты (`registerImpactPainter`) — тоже здесь.

import {
  frameLRU,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerShotPainter,
} from '../dungeon-paint';
import type { MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { DRONE } from './f11-brains';
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
  fill2,
  frameOf,
  hash,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  lin,
  mixc,
  put,
  spark2,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  vmul,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RGBA, RigOut, Tones, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const BRASS = tn('#5a4a2e', '#8a7244', '#b8985c', '#e0c486');
const IRON = tn('#26282e', '#3c4048', '#585e6a', '#7c8290');
const SOOT = tn('#1e1a16', '#2e2820', '#463c2c', '#5e5038');
const CALM = hx('#6ff4e6');
const COOL = hx('#ffaa40');
const ANGRY = hx('#ff5a3a');
const OFF = hx('#3a4048');
const ZAP = hx('#fff27a');
const FIRE = hx('#ffb040');
const SMOKE: RGBA[] = [hx('#8a8c90'), hx('#6a6c72'), hx('#a8aab0')];
const SPARKS: RGBA[] = [hx('#fff27a'), hx('#ffffff'), hx('#ffb040'), hx('#ffd060')];

const band = (T: Tones, l: number): RGBA =>
  l > 0.78 ? T[3] : l > 0.38 ? T[2] : l > -0.02 ? T[1] : T[0];

/** Тона стекла по цвету: тень, полутень, цвет, блик. */
const glass = (c: RGBA): Tones => [
  mixc(c, hx('#150f0b'), 0.55),
  mixc(c, hx('#150f0b'), 0.25),
  c,
  mixc(c, WHITE, 0.55),
];
const LENS: Tones[] = [glass(CALM), glass(COOL), glass(ANGRY), glass(WHITE), glass(OFF)];

/** Корпус: латунь, пояс железа с заклёпками, кольцо люка сверху. */
const hullMat = (T: Tones, I: Tones): Mat => ({
  T,
  spec: true,
  pat: (q, l) => {
    const z = q[2];
    if (Math.abs(z + 0.08) < 0.17) {
      const a = Math.atan2(q[1], q[0]) / (PI / 4);
      const fr = a - Math.floor(a);
      return band(I, l + (fr < 0.12 || fr > 0.88 ? 0.55 : 0));
    }
    if (z > 0.78 && z < 0.88) return band(T, l - 0.55);
    return null;
  },
});
const HULL = hullMat(BRASS, IRON);
const HULL_B = hullMat(SOOT, IRON);

/** Высота середины шара над полом (в кадре; движок поднимает ещё на `lift`). */
const Z0 = 9;
const R = 4.7;
const HUB: V3 = [-0.3, 0, 6.9];
const ROTOR_R = 6.3;

interface DrO {
  z: number;
  fwd: number;
  side: number;
  /** Нос вниз (+) / вверх (−), крен (+ — верх вправо), разворот, рад. */
  pitch: number;
  roll: number;
  spin: number;
  /** Сплющен по высоте (удар о пол). */
  sq: number;
  /** Ствол выдвинут 0…1, заряд у дула 0…1. */
  bar: number;
  glow: number;
  /** Глаз: 0 спокоен, 1 остывает, 2 злой, 3 белый, 4 погас. */
  lens: number;
  /** Винт: 0 стоит, 1 крутится, 2 форсаж; угол лопасти. */
  rotor: number;
  blade: number;
  /** Плавники разведены (тормозит, целится). */
  fin: number;
  /** Копоть (смерть) 0…1, разлёт деталей 0…1. */
  burnt: number;
  boom: number;
  /** Вспышка у дула: 0 нет, 1 малая, 2 выстрел. Возраст дыма двух выстрелов, с. */
  flash: number;
  smoke: number[];
}

const D0: DrO = {
  z: Z0,
  fwd: 0,
  side: 0,
  pitch: 0,
  roll: 0,
  spin: 0,
  sq: 1,
  bar: 0,
  glow: 0,
  lens: 0,
  rotor: 1,
  blade: 0,
  fin: 0,
  burnt: 0,
  boom: 0,
  flash: 0,
  smoke: [],
};

/** Рамка корпуса: курс, смещения, наклоны. */
function body(o: DrO, yaw: number): F3 {
  return F3.yaw(yaw).at(o.fwd, o.side, o.z).pitch(o.pitch).roll(o.roll).turn(o.spin);
}

/** Дуло (мир) — для вспышки, заряда и дыма. */
const muzzle = (B: F3, o: DrO): V3 => B.p(5.7 + 1.8 * o.bar, 0, -2.0);

function droneRig(o: DrO, yaw: number): Rig {
  const r = new Rig();
  const B = body(o, yaw);
  const iron: Mat = { T: IRON, spec: true };
  r.ell(B, [0, 0, 0], [R, R, (R - 0.3) * o.sq], o.burnt > 0.5 ? HULL_B : HULL);
  // Глаз: железная оправа и стекло (светится).
  r.ball(B.p(4.0, 0, 0.9), 1.9, iron);
  r.ell(B, [5.25, 0, 0.9], [0.8, 1.3, 1.3], {
    T: LENS[o.lens],
    glow: o.lens === 4 ? 0 : 0.85,
    spec: o.lens !== 4,
  });
  // Дальше — то, что разлетается при смерти.
  const cut = r.size;
  // Ствол под глазом.
  const tip = muzzle(B, o);
  r.cap(B.p(2.6, 0, -2.0), tip, 0.95, 0.75, iron);
  r.ball(tip, 0.85, { T: IRON, bias: -0.25 });
  if (o.glow > 0.05) {
    const c = o.glow > 0.7 ? WHITE : o.glow > 0.35 ? ZAP : FIRE;
    r.dot(vadd(tip, B.v(0.7, 0, 0)), c, 1, o.glow > 0.7 ? 2 : 1, 0.9);
  }
  // Мачта и ступица винта.
  r.cap(B.p(-0.3, 0, R - 0.9), B.p(HUB[0], HUB[1], HUB[2] - 0.3), 0.6, 0.45, iron);
  r.ball(B.p(HUB[0], HUB[1], HUB[2]), 1.0, iron);
  // Хвост: V-образные кили назад-вверх и киль снизу — видно, где корма.
  const fin: Mat = { T: BRASS, bias: -0.06 };
  const edge: Mat = { T: BRASS, bias: 0.12 };
  for (const sd of [-1, 1]) {
    const a = B.p(-3.3, sd * 0.9, 1.4);
    const b = B.p(-4.4, sd * 0.6, -0.8);
    const c = B.p(-6.6 - 0.5 * o.fin, sd * (2.6 + 0.8 * o.fin), 3.0 + 0.3 * o.fin);
    r.poly([a, b, c], fin);
    r.cap(a, c, 0.45, 0.3, edge);
  }
  const ka = B.p(-2.8, 0, -3.2);
  const kc = B.p(-5.6 - 0.4 * o.fin, 0, -4.8);
  r.poly([ka, B.p(-4.5, 0, -1.2), kc], fin);
  r.cap(ka, kc, 0.45, 0.3, edge);
  if (o.boom > 0) r.explode(o.boom, B.p(0, 0, 0), 5, 8, 22, cut, 0.3);
  const eyeP = B.p(5.6, 0, 0.9);
  r.eye = o.lens !== 4 && Math.sin(yaw) > -0.35 ? eyeP : null;
  return r;
}

// ---- 2D поверх рига ----------------------------------------------------------

/** Точки (каждый пиксель — один раз, иначе полупрозрачное густеет). */
function plot(p: RigOut['p'], pts: [number, number][], c: RGBA): void {
  const seen = new Set<number>();
  for (const [x, y] of pts) {
    const k = Math.round(y) * 4096 + Math.round(x);
    if (seen.has(k)) continue;
    seen.add(k);
    p.set(x, y, c);
  }
}
function seg(out: [number, number][], a: [number, number], b: [number, number]): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
  for (let i = 0; i <= n; i++)
    out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
}

const AIR = hx('#e4f2ff');
const BLADE = hx('#b8c0cc');

/** Винт: мутный диск с кромкой в плоскости корпуса и лопасть (стоит — чёткая). */
function rotor(o: RigOut, P2: (v: V3) => [number, number], B: F3, d: DrO): void {
  const hub = B.p(HUB[0], HUB[1], HUB[2] + 0.4);
  const at = (a: number, L: number) =>
    P2(vadd(hub, vadd(vmul(B.f, Math.cos(a) * L), vmul(B.s, Math.sin(a) * L))));
  if (d.rotor > 0) {
    const ring: [number, number][] = [];
    for (let i = 0; i < 24; i++) ring.push(at((i / 24) * TAU, ROTOR_R));
    fill2(o.p, ring, () => alpha(AIR, d.rotor === 2 ? 0.12 : 0.07));
    const rim: [number, number][] = [];
    for (let i = 0; i < 24; i++) seg(rim, ring[i], ring[(i + 1) % 24]);
    plot(o.p, rim, alpha(AIR, d.rotor === 2 ? 0.4 : 0.26));
  }
  const L = d.rotor > 0 ? ROTOR_R - 0.3 : ROTOR_R - 0.8;
  const bl: [number, number][] = [];
  seg(bl, at(d.blade, -L), at(d.blade, L));
  plot(o.p, bl, d.rotor > 0 ? alpha(BLADE, 0.9) : IRON[1]);
  if (d.rotor > 0) {
    // Смаз лопасти — бледная тень на полшага позади.
    const gh: [number, number][] = [];
    seg(gh, at(d.blade - 0.5, -L), at(d.blade - 0.5, L));
    plot(o.p, gh, alpha(BLADE, 0.32));
  }
}

/** Вспышка выстрела у дула: звезда по стволу, свет поверх темноты. */
function muzzleFx(o: RigOut, P2: (v: V3) => [number, number], B: F3, d: DrO): void {
  const m = muzzle(B, d);
  const [x, y] = P2(vadd(m, B.v(1.0, 0, 0)));
  const [fx, fy] = P2(vadd(m, B.v(3.0, 0, 0)));
  let ux = fx - x;
  let uy = fy - y;
  const l = Math.hypot(ux, uy) || 1;
  ux /= l;
  uy /= l;
  if (d.flash === 2) {
    for (let k = -1; k <= 4; k++)
      spark2(o, x + ux * k, y + uy * k, k <= 1 ? WHITE : k <= 3 ? ZAP : alpha(FIRE, 0.8), 1);
    for (const s of [-1, 1]) {
      spark2(o, x - uy * s, y + ux * s, ZAP, 1);
      spark2(o, x - uy * s * 2 + ux, y + ux * s * 2 + uy, alpha(FIRE, 0.75), 0.8);
    }
  } else if (d.flash === 1) {
    spark2(o, x, y, ZAP, 0.9);
    for (const s of [-1, 1]) {
      spark2(o, x + ux * 2 * s, y + uy * 2 * s, alpha(FIRE, 0.6), 0.5);
      spark2(o, x - uy * 2 * s, y + ux * 2 * s, alpha(FIRE, 0.6), 0.5);
    }
  }
}

/** Дымок из дула: клубы поднимаются и тают (возраст `age`, с). */
function smokeFx(o: RigOut, x: number, y: number, age: number, behind: boolean, seed: number) {
  for (let i = 0; i < 3; i++) {
    const a = age - i * 0.07;
    if (a <= 0.04 || a > 0.62) continue;
    const k = a / 0.62;
    const cx = x + (hash(seed, i, 3) - 0.3) * 4 * k;
    const cy = y - 1 - 9 * easeOut(k);
    const rr = 0.6 + 1.3 * k;
    const c = alpha(SMOKE[i % 3], 0.55 * (1 - k));
    for (let yy = Math.floor(cy - rr); yy <= Math.ceil(cy + rr); yy++)
      for (let xx = Math.floor(cx - rr); xx <= Math.ceil(cx + rr); xx++) {
        if ((xx - cx) ** 2 + (yy - cy) ** 2 > rr * rr) continue;
        if (behind && o.p.solid(xx, yy) && o.p.get(xx, yy)[3] > 200) continue;
        o.p.set(xx, yy, c);
      }
  }
}

// ---- Дорожки ------------------------------------------------------------------

const AIM_T = DRONE.aim;
const GAP_T = DRONE.gap;

/** Отдача выстрела: `tau` — время после него. */
function recoil(o: DrO, tau: number): void {
  o.fwd = trk(tau, [
    [0, -2.0],
    [0.05, -1.6],
    [0.16, -0.3],
    [0.3, 0.3],
    [0.45, 0],
  ]);
  o.pitch = trk(tau, [
    [0, -0.32],
    [0.06, -0.26],
    [0.18, 0.12],
    [0.32, -0.05],
    [0.5, 0],
  ]);
  o.z =
    Z0 +
    trk(tau, [
      [0, 0.5],
      [0.1, 0.2],
      [0.3, -0.3],
      [0.5, 0],
    ]);
  o.flash = tau < 1 / FPS ? 2 : tau < 2 / FPS ? 1 : 0;
}

function aimO(T: number): DrO {
  const o: DrO = { ...D0, smoke: [] };
  o.rotor = T < 0.08 ? 1 : 2;
  o.pitch = trk(T, [
    [0, 0],
    [0.1, -0.26, easeOut],
    [0.3, 0.08],
    [0.42, 0.03],
  ]);
  o.fwd = trk(T, [
    [0, 0],
    [0.1, -1.0, easeOut],
    [0.3, 0.4],
    [0.42, 0.1],
  ]);
  o.z =
    Z0 +
    trk(T, [
      [0, 0],
      [0.1, 0.8, easeOut],
      [0.32, -0.2],
      [0.6, -0.3],
    ]);
  o.bar = trk(T, [
    [0.06, 0],
    [0.3, 1, easeOut],
  ]);
  o.glow = trk(T, [
    [0.14, 0],
    [0.4, 0.6],
    [0.58, 1],
  ]);
  o.fin = trk(T, [
    [0, 0],
    [0.25, 1],
  ]);
  o.lens = T < 0.06 ? 0 : T < 0.14 ? 1 : 2;
  if (T >= AIM_T - 0.2) {
    // Замок: дрожит, глаз мигает белым.
    const k = Math.floor(T * FPS);
    o.side = k % 2 ? 0.55 : -0.55;
    o.lens = k % 2 ? 3 : 2;
  }
  return o;
}

function burstO(T: number): DrO {
  const o: DrO = { ...D0, smoke: [T] };
  recoil(o, T);
  o.rotor = 2;
  o.bar = 1;
  o.fin = 1;
  o.glow = sstep(0.05, GAP_T, T);
  o.lens = T < 1 / FPS ? 3 : 2;
  return o;
}

function recO(T: number): DrO {
  const o: DrO = { ...D0, smoke: [T + GAP_T, T] };
  recoil(o, T);
  o.rotor = T < 0.35 ? 2 : 1;
  o.bar = 1 - sstep(0.2, 0.5, T);
  o.fin = 1 - sstep(0.2, 0.6, T);
  o.lens = T < 1 / FPS ? 3 : T < 0.3 ? 2 : T < 0.55 ? 1 : 0;
  return o;
}

function flinchO(f: number): DrO {
  const k = f / 4;
  const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
  return {
    ...D0,
    smoke: [],
    pitch: -0.45 * b,
    roll: 0.3 * b,
    z: Z0 + 0.8 * b,
    fwd: -0.8 * b,
    fin: 0.6 * b,
    lens: f <= 1 ? 4 : f === 2 ? 2 : 0,
  };
}

/** Смерть, 22 кадра (0,9 с): `t` — время от начала. */
function dieO(t: number): DrO {
  const o: DrO = { ...D0, smoke: [] };
  o.lens = t < 0.05 ? 3 : 4;
  o.pitch = trk(t, [
    [0, -0.45, easeOut],
    [0.1, -0.3],
    [0.42, 0.5, easeIn],
    [0.5, 0.32],
    [0.6, 0.42],
  ]);
  o.roll = trk(t, [
    [0.05, 0],
    [0.42, 0.55, easeIn],
    [0.5, 0.38],
    [0.6, 0.5],
  ]);
  o.spin = trk(t, [
    [0.06, 0],
    [0.42, 2.6, lin],
    [0.5, 2.75],
  ]);
  o.z = trk(t, [
    [0, Z0 + 0.6],
    [0.08, Z0 + 0.9],
    [0.42, R - 0.3, easeIn],
    [0.48, R + 0.8, easeOut],
    [0.55, R - 0.3, easeIn],
  ]);
  o.sq = t >= 0.42 && t < 0.47 ? 0.8 : t >= 0.55 && t < 0.59 ? 0.9 : 1;
  o.rotor = t < 0.2 ? 1 : 0;
  o.blade = t < 0.42 ? Math.floor(t * FPS) * (t < 0.2 ? 1.05 : 0.45) : 0.9;
  o.fin = 0.4;
  o.burnt = t >= 0.62 ? 1 : 0;
  o.boom = clamp01((t - 0.62) / 0.28);
  return o;
}

/** Спит на полу (выключен) и просыпается (`alert` 0,35 с). */
function offO(): DrO {
  return { ...D0, smoke: [], z: R - 0.3, rotor: 0, blade: 0.7, lens: 4, pitch: 0.15, roll: 0.1 };
}
function bootO(T: number): DrO {
  const o = offO();
  const k = sstep(0.08, 0.33, T);
  const f = Math.floor(T * FPS);
  o.z = R - 0.3 + (Z0 - R + 0.3) * k;
  o.lens = f === 1 ? 4 : f < 3 ? 1 : 0;
  o.rotor = f < 2 ? 0 : 1;
  o.blade = 0.7 + f * 0.9;
  o.pitch = trk(T, [
    [0, 0.15],
    [0.2, -0.12],
    [0.35, 0],
  ]);
  o.roll = 0.1 * (1 - k);
  return o;
}

/** Висит: уровень крена вбок `lat` (−2…2) и клевка `pit` (−1…1), лопасть `f`. */
function hoverO(lat: number, pit: number, f: number): DrO {
  return { ...D0, smoke: [], roll: lat * 0.14, pitch: pit * 0.18, blade: f * (PI / 3) };
}

function dronePose(anim: string, f: number): DrO {
  const t = (f + 0.5) / FPS;
  if (anim[0] === 'h') return hoverO(+anim[1] - 2, +anim[2] - 1, f);
  let o: DrO;
  switch (anim) {
    case 'aim':
      o = aimO(Math.min(t, AIM_T - 0.005));
      break;
    case 'burst':
      o = burstO(t - 0.5 / FPS + 0.004);
      break;
    case 'rec':
      o = recO(t - 0.5 / FPS + 0.004);
      break;
    case 'flinch':
      o = flinchO(f);
      break;
    case 'die':
      o = dieO(t);
      break;
    case 'off':
      return offO();
    case 'boot':
      return bootO(t);
    default:
      return hoverO(0, 0, f);
  }
  if (anim !== 'die') o.blade = (f % 3) * (PI / 3);
  return o;
}

// ---- Кадр ----------------------------------------------------------------------

const DR = kindOf('drone', 36, 34, 18, 26, 1400);

const dronePic = (anim: string, f: number, d: number): Pic => {
  const o0 = dronePose(anim, f);
  const yaw = yawN(d);
  return draw(DR, droneRig(o0, yaw), (o: RigOut, P2) => {
    const B = body(o0, yaw);
    if (o0.boom <= 0) rotor(o, P2, B, o0);
    const away = Math.sin(yaw) < -0.3;
    if (o0.flash) muzzleFx(o, P2, B, o0);
    const [mx, my] = P2(vadd(muzzle(B, o0), B.v(0.8, 0, 0)));
    o0.smoke.forEach((a, i) => smokeFx(o, mx, my, a, away, 11 + i));
    if (anim === 'flinch' && f <= 2) {
      const [x, y] = P2(B.p(0, 0, 1));
      spray(o.p, x, y, 6, 7, (f + 1) / 3, 31 + f, SPARKS, 3, 2);
      spark2(o, x + 2 - f, y - 2 - f, WHITE, 1);
    }
    if (anim === 'die') {
      const t = (f + 0.5) / FPS;
      const [x, y] = P2(B.p(0, 0, 0));
      if (t < 0.12) {
        spray(o.p, x, y, 8, 9, Math.min(1, (t + 0.04) / 0.12), 41, SPARKS, 4, 3);
        spark2(o, x + 3, y - 3, WHITE, 1);
      }
      if (t > 0.42 && t < 0.52) {
        // Удар о пол: пыль в стороны.
        const [gx, gy] = P2([0, 0, 0.5]);
        spray(o.p, gx, gy, 8, 9, (t - 0.42) / 0.1, 57, SMOKE, 0, 1);
      }
      if (t > 0.5 && t < 0.62 && f % 2) spark2(o, x - 1 + (f % 4), y - 3, ZAP, 1);
      if (t >= 0.62 && t < 0.74) {
        // Хлопок: кольцо вспышки и искры.
        const k = (t - 0.62) / 0.12;
        const rr = 2 + 6 * k;
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          spark2(o, x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.6, alpha(ZAP, 1 - k), 1 - k);
        }
        spray(o.p, x, y, 10, 13, Math.min(1, k * 1.3), 73, SPARKS, 6, 4);
        if (k < 0.5) spark2(o, x, y, WHITE, 1);
      }
      if (t > 0.45) smokeFx(o, x, y - 2, (t - 0.45) * 1.2, false, 91);
      if (t > 0.62) smokeFx(o, x + 2, y - 1, (t - 0.62) * 1.5, false, 97);
    }
  });
};

// ---- Крен облёта ---------------------------------------------------------------

interface Tilt {
  lat: number;
  pit: number;
  at: number;
}
const TILT = new WeakMap<Mob, Tilt>();

/** Уровни крена по скорости относительно глаза: с запасом и не чаще 0,07 с. */
function tiltOf(m: Mob, yaw: number, now: number): Tilt {
  const vx = m.vx ?? 0;
  const vy = m.vy ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lt = (-vx * s + vy * c) / 1.5;
  const fw = (vx * c + vy * s) / 2.2;
  let st = TILT.get(m);
  if (!st) {
    st = { lat: clamp(Math.round(lt), -2, 2), pit: clamp(Math.round(fw), -1, 1), at: now };
    TILT.set(m, st);
    return st;
  }
  if (now - st.at >= 0.07 || now < st.at) {
    let ch = false;
    if (lt > st.lat + 0.7 && st.lat < 2) {
      st.lat++;
      ch = true;
    } else if (lt < st.lat - 0.7 && st.lat > -2) {
      st.lat--;
      ch = true;
    }
    if (fw > st.pit + 0.7 && st.pit < 1) {
      st.pit++;
      ch = true;
    } else if (fw < st.pit - 0.7 && st.pit > -1) {
      st.pit--;
      ch = true;
    }
    if (ch) st.at = now;
  }
  return st;
}

registerMobPainter('f11_drone', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 10);
  const d = dirN(v.yaw);
  const ph = hash(id, 7);
  const ex: Partial<MobFrame> = { shadow: 3.5, lift: 6, still: true };
  let anim = 'h21';
  let f = Math.floor(now * FPS + ph * 3) % 3;
  let dark = 0;
  // Покачивание висящего — смещением; перед выстрелом дрон замирает.
  let bob = 1;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    bob = 0;
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.74, 0.9, t);
    ex.lift = 6 * (1 - easeIn(clamp01((t - 0.08) / 0.34)));
    ex.shadow = 3.5 + 1.5 * sstep(0.1, 0.42, t);
  } else if (md === 'aim') {
    f = fi(t, 14);
    anim = 'aim';
    bob = 1 - sstep(0, 0.25, t);
  } else if (md === 'f11_burst') {
    f = fi(t, 3);
    anim = 'burst';
    bob = 0;
  } else if (md === 'recover' && (v.prev === 'f11_burst' || v.prev === '') && t < 0.8) {
    f = fi(t, 19);
    anim = 'rec';
    bob = sstep(0.3, 0.8, t);
  } else if (md === 'sleep') {
    anim = 'off';
    f = 0;
    bob = 0;
    ex.lift = 0;
    ex.shadow = 4;
  } else if (md === 'alert') {
    f = fi(t, 8);
    anim = 'boot';
    bob = sstep(0.1, 0.35, t);
    ex.lift = 6 * sstep(0.08, 0.33, t);
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else {
    const tl = tiltOf(m, v.yaw, now);
    anim = `h${tl.lat + 2}${tl.pit + 1}`;
    if (md === 'emerge') dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
  }
  if (bob > 0) ex.dy = -bob * Math.sin(now * 8.2 + ph * TAU);
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return put(
    frameOf(DR, anim, f, d, pose, (dd) => dronePic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_drone', function* () {
  const hov: [string, number][] = [];
  for (let a = 0; a < 5; a++) for (let b = 0; b < 3; b++) hov.push([`h${a}${b}`, 3]);
  yield* warmAll(
    DR,
    [
      ['h21', 3],
      ['aim', 15],
      ['burst', 4],
      ['rec', 20],
      ['flinch', 5],
      ['die', 22],
      ...hov.filter(([a]) => a !== 'h21'),
      ['boot', 9],
      ['off', 1],
    ],
    dronePic,
  );
});

// ---- Снаряд и его контакт --------------------------------------------------------

/** Трассер летит на высоте ствола: рисуем выше точки снаряда (тень — движок). */
const DART_UP = 9;
const DARTS = frameLRU<Sprite>(40);

function dartSprite(q: number, f: number): Sprite {
  const key = q * 2 + f;
  const got = DARTS.get(String(key));
  if (got) return got;
  const W = 17;
  const H = 17 + DART_UP;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const a = (q / 16) * TAU;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const m = 8;
  const px = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(Math.round(m + x), Math.round(m + y), 1, 1);
  };
  // След: от тусклого оранжевого к жёлтому, голова белая с ореолом.
  for (let k = -7; k <= -1; k++) {
    const s = (k + 8) / 7;
    px(
      dx * k,
      dy * k,
      `rgba(255,${Math.round(140 + 90 * s)},64,${(0.12 + 0.6 * s * s).toFixed(2)})`,
    );
  }
  px(dx * -1, dy * -1, 'rgba(255,224,128,0.95)');
  for (const [ox, oy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ])
    px(ox, oy, `rgba(255,242,122,${f ? 0.75 : 0.45})`);
  px(0, 0, '#ffffff');
  px(dx, dy, '#ffffff');
  if (f) px(dx * 2, dy * 2, 'rgba(255,255,255,0.6)');
  return DARTS.set(String(key), { img: c, ax: m, ay: m + DART_UP });
}

registerShotPainter('f11_dart', (s, time) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = ((Math.round((a / TAU) * 16) % 16) + 16) % 16;
  const f = (((Math.floor(time * 20) + (s.id ?? 0)) % 2) + 2) % 2;
  return dartSprite(q, f);
});

/** Ряд чисел 0…1 из зерна записи (без `sim.rng`). */
function seeded(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39) >>> 0;
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

const IMPACT_LIFE = 0.28;
registerImpactPainter('f11_dart', {
  life: IMPACT_LIFE,
  shake: 0.04,
  above: true,
  paint(g, rec, px, py, scale, age) {
    const s = scale / 16;
    const k = age / IMPACT_LIFE;
    const y0 = py - DART_UP * s;
    const sp = Math.hypot(rec.vx ?? 0, rec.vy ?? 0) || 1;
    const ux = (rec.vx ?? 1) / sp;
    const uy = (rec.vy ?? 0) / sp;
    const dot = (x: number, y: number, w: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
    };
    // Вспышка: белое ядро и жёлтый крест — первые кадры.
    if (k < 0.35) {
      const a = 1 - k / 0.35;
      dot(px, y0, 2 * s, `rgba(255,255,255,${a.toFixed(2)})`);
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        dot(px + ox * 2 * s, y0 + oy * 2 * s, s, `rgba(255,242,122,${a.toFixed(2)})`);
    }
    // Искры: отскакивают назад и вбок от удара, падают.
    const e = easeOut(Math.min(1, k * 1.4));
    for (let i = 0; i < 7; i++) {
      const th = Math.atan2(-uy, -ux) + (seeded(rec.seed, i) - 0.5) * 2.6;
      const r = (2.5 + 6 * seeded(rec.seed, i + 9)) * e * s;
      const x = px + Math.cos(th) * r;
      const y = y0 + Math.sin(th) * r * 0.7 + 7 * k * k * s;
      const col =
        i % 3
          ? `rgba(255,${Math.round(240 - 100 * k)},90,${(1 - k).toFixed(2)})`
          : `rgba(255,255,255,${(1 - k).toFixed(2)})`;
      dot(x, y, s, col);
    }
    return true;
  },
});
