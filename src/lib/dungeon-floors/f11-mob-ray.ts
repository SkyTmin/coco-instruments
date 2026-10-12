// Небесный скат (анимации мобов 11): манта — синяя спина в светлых горошинах,
// бледное брюхо и кромки крыльев, головные плавники-«рога», глаза по бокам
// головы, хвост-хлыст. Мини-3D (`f15-rig.ts`), 8 сторон честно (свет сверху-
// слева), летит туда, куда смотрит; техники — 24 к/с от `pose.t`.
//
// Крыло — цепочка из четырёх звеньев по размаху: корень машет, конец гнётся с
// запаздыванием (бегущая волна, как у манты), задняя кромка отстаёт от
// передней. Видно брюхо, когда крыло завернулось к зрителю. В вираже скат
// кренится внутрь поворота (уровень крена — в ключе кадра).
//
// Метроном — `f11-brains.ts` (`f11_ray`, `RAY`):
// - `aim` 0,8 с: встаёт на дыбы, набирает высоту, крылья вверх-вперёд и
//   держит, рога разворачиваются, хвост загибается; замок (последние 0,3 с) —
//   дрожь концов крыльев, глаза белые; в конце — первый взмах вниз и клевок;
// - `f11_swoop` (до 1,2 с, удар касанием): мощный взмах вниз, крылья сложены
//   назад стрелой, хвост вытянут, шлейф и полосы ветра, высота у пола;
// - `recover` 1,1 с: торможение — крылья распахиваются вверх, нос задран,
//   набирает высоту, дальше — медленное парение (окно);
// - удар героя — вздрог 5 кадров; смерть 0,9 с: судорога, переворачивается
//   брюхом вверх, падает, шлёпает крыльями о пол, гаснет.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { RAY } from './f11-brains';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  WHITE,
  alpha,
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
  moving,
  put,
  spark2,
  sstep,
  tn,
  trk,
  vadd,
  vlerp,
  vsub,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RigOut, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const BLUE = tn('#1c3c66', '#2b5b92', '#4583be', '#7ab4e2');
const BELLY = tn('#9ab0c8', '#c8d8e8', '#e8f0f8', '#ffffff');
const DARK = tn('#122848', '#1c3c66', '#2b5b92', '#4583be');
const EYE = hx('#7af6ff');
const SPOT = alpha(hx('#e8f0f8'), 200);
const MOUTH = hx('#0e1a2e');
const AIRL = hx('#eaf6ff');

/** Камера кадра смотрит из (0, CE, SE) — к ней обращена видимая сторона грани. */
const VIEW: V3 = [0, 0.8, 0.6];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

interface RaO {
  z: number;
  fwd: number;
  /** Нос вниз (+), крен (+ — правое крыло вниз), рад. */
  pitch: number;
  roll: number;
  /** Взмах: фаза, размах корня и изгиба, рад; постоянный подъём и изгиб. */
  ph: number;
  ab: number;
  ag: number;
  base: number;
  bend: number;
  /** Крылья сложены назад стрелой (пике) 0…1. */
  fold: number;
  /** Хвост: волна (размах, фаза), подъём. */
  tw: number;
  tph: number;
  tup: number;
  /** Рога развёрнуты вперёд 0…1. */
  horn: number;
  /** Глаза: 0 спокойны, 1 белые (прицел), 2 зажмурены, 3 погасли. */
  eye: number;
}

const R0: RaO = {
  z: 0,
  fwd: 0,
  pitch: 0,
  roll: 0,
  ph: 0,
  ab: 0,
  ag: 0,
  base: 0.05,
  bend: 0,
  fold: 0,
  tw: 0.2,
  tph: 0,
  tup: 0,
  horn: 0.3,
  eye: 0,
};

/**
 * Корпус. В профиль спина доворачивается к зрителю (крен до 0,4 рад): камера
 * смотрит под 37°, и ближнее крыло на взмахе встаёт к ней ребром — скат
 * читался бы «парусом» из одного дальнего крыла.
 */
function bodyF(o: RaO, yaw: number): F3 {
  return F3.yaw(yaw)
    .at(o.fwd, 0, o.z)
    .pitch(o.pitch)
    .roll(o.roll + 0.4 * Math.cos(yaw));
}

const SPAN = 13.2;
const NSEG = 4;

/** Узлы крыла (в мире): передняя и задняя кромки от корня к концу. */
function wingNodes(B: F3, sd: number, o: RaO): { lead: V3[]; trail: V3[] } {
  const L = (SPAN / NSEG) * (1 - 0.38 * o.fold);
  const chain = (ph: number, fOf: (x: number) => number): V3[] => {
    const out: V3[] = [];
    let s = 2.6;
    let u = 0;
    for (let i = 0; i <= NSEG; i++) {
      const x = i / NSEG;
      out.push(B.p(fOf(x), sd * s, u));
      const a = o.base + o.ab * Math.sin(ph) + (i + 1) * (o.bend + o.ag * Math.sin(ph - 1.0)) * 0.5;
      s += L * Math.cos(a);
      u += L * Math.sin(a);
    }
    return out;
  };
  const back = (x: number) => 5.5 * o.fold * x ** 1.2;
  return {
    lead: chain(o.ph, (x) => 4.5 - 7.5 * x ** 1.8 - back(x)),
    trail: chain(o.ph - 0.5, (x) => -5.5 + 2.6 * x - back(x)),
  };
}

/** Горошины на крыле: доля размаха и доля от передней кромки к задней. */
const SPOTS: [number, number][] = [
  [0.22, 0.35],
  [0.4, 0.65],
  [0.55, 0.3],
  [0.7, 0.55],
  [0.3, 0.8],
];

function wing(r: Rig, B: F3, sd: number, o: RaO): void {
  const { lead, trail } = wingNodes(B, sd, o);
  const top: Mat = { T: BLUE, bias: 0.05 };
  const under: Mat = { T: BELLY, bias: -0.05 };
  for (let i = 0; i < NSEG; i++) {
    const q = [lead[i], lead[i + 1], trail[i + 1], trail[i]];
    let n = cross3(vsub(q[1], q[0]), vsub(q[3], q[0]));
    if (dot3(n, B.u) < 0) n = [-n[0], -n[1], -n[2]];
    const up = dot3(n, VIEW) >= 0;
    r.poly(q, up ? top : under);
    if (up)
      for (const [a, b] of SPOTS) {
        const x = a * NSEG - i;
        if (x < 0 || x >= 1) continue;
        const pl = vlerp(lead[i], lead[i + 1], x);
        const pt = vlerp(trail[i], trail[i + 1], x);
        r.dot(vlerp(pl, pt, b), SPOT, 0, 1, 0.8);
      }
  }
  // Светлая передняя кромка — брюхо, видное снизу.
  for (let i = 0; i < NSEG; i++) r.cap(lead[i], lead[i + 1], 0.5, 0.35, { T: BELLY, bias: 0.1 });
}

function rayRig(o: RaO, yaw: number): Rig {
  const r = new Rig();
  const B = bodyF(o, yaw);
  wing(r, B, 1, o);
  wing(r, B, -1, o);
  // Тело: спина-бугор и голова.
  const back: Mat = {
    T: BLUE,
    pat: (q, l) => {
      if (q[2] > 0.55 && Math.abs(q[1]) < 0.18) return DARK[l > 0.5 ? 2 : 1];
      if (q[2] < -0.35) return BELLY[l > 0.3 ? 2 : 1];
      const h = hash(Math.floor(q[0] * 4 + 9), Math.floor(q[1] * 4 + 9), 5);
      return h > 0.86 && q[2] > 0 ? SPOT : null;
    },
  };
  r.ell(B, [-0.3, 0, 0], [6.2, 3.3, 1.7], back);
  r.ell(B, [4.3, 0, 0.1], [2.4, 2.9, 1.3], { T: BLUE, bias: 0.05 });
  // Рога: свёрнуты к пасти, на прицеле развёрнуты вперёд.
  for (const sd of [-1, 1]) {
    const a = B.p(5.6, sd * 2.1, -0.1);
    const b = B.p(7.6 + 0.9 * o.horn, sd * (2.0 + 0.7 * o.horn), -0.5 + 0.4 * o.horn);
    const c = vadd(b, B.v(0.4 + 0.9 * o.horn, -sd * (1.1 - 0.8 * o.horn), -0.6 + 0.5 * o.horn));
    r.cap(a, b, 0.85, 0.6, { T: BLUE, bias: 0.1 });
    r.cap(b, c, 0.6, 0.4, { T: BELLY, bias: 0 });
    const lit = o.eye === 0 || o.eye === 1;
    r.dot(
      B.p(5.0, sd * 2.75, 0.75),
      o.eye === 1 ? WHITE : lit ? EYE : DARK[0],
      lit ? (o.eye === 1 ? 1 : 0.6) : 0,
      1,
      0.8,
    );
  }
  r.dot(B.p(7.0, 0, -0.5), MOUTH, 0, 1, 0.6);
  // Хвост-хлыст: волна по длине, конец светлый.
  let p: V3 = B.p(-6.2, 0, 0.1);
  for (let k = 0; k < 6; k++) {
    const a = PI + o.tw * Math.sin(o.tph - 0.9 * k) * ((k + 1) / 6);
    const up = o.tup * (1 - k * 0.12) - 0.05 * k;
    const n = vadd(p, B.v(Math.cos(a) * 2.3, Math.sin(a) * 2.3, Math.sin(up) * 2.3));
    r.cap(p, n, Math.max(0.5, 0.75 - k * 0.06), Math.max(0.5, 0.69 - k * 0.06), {
      T: k < 4 ? BLUE : BELLY,
      bias: 0.05,
    });
    p = n;
  }
  // Спинной плавничок у корня хвоста.
  r.poly([B.p(-5.0, 0, 1.0), B.p(-6.6, 0, 0.6), B.p(-6.4, 0, 2.2)], { T: BLUE, bias: 0.1 });
  const cs = Math.cos(yaw) >= 0 ? 1 : -1;
  r.eye = o.eye <= 1 ? B.p(5.0, cs * 2.75, 0.75) : null;
  return r;
}

// ---- Дорожки ------------------------------------------------------------------

const AIM_T = RAY.aim;
const LOCK_T = RAY.lock;

/** Полёт (цикл `n` кадров): взмах корня, волна к концу, тело — на взмахе вниз вверх. */
function flyO(f: number, n: number, bank: number, slow: boolean): RaO {
  const ph = (f / n) * TAU;
  return {
    ...R0,
    ph,
    ab: slow ? 0.26 : 0.36,
    ag: slow ? 0.22 : 0.3,
    z: -(slow ? 0.6 : 0.9) * Math.sin(ph),
    pitch: slow ? 0 : 0.06,
    roll: bank * 0.3,
    tw: 0.28,
    tph: ph,
  };
}

function aimO(T: number): RaO {
  const o: RaO = { ...R0 };
  const C = AIM_T;
  // Встаёт на дыбы брюхом к цели, крылья раскрыты чашей; в конце — удар вниз.
  o.base = trk(T, [
    [0, 0.05],
    [0.16, 0.35, easeOut],
    [C - 0.14, 0.42],
    [C - 0.02, -0.2, easeIn],
  ]);
  o.bend = trk(T, [
    [0, 0],
    [0.2, -0.26],
    [C - 0.14, -0.32],
    [C - 0.02, 0.25, easeIn],
  ]);
  o.pitch = trk(T, [
    [0, 0],
    [0.2, -0.85, easeOut],
    [C - 0.14, -0.8],
    [C - 0.02, 0.3, easeIn],
  ]);
  o.fwd = trk(T, [
    [0, 0],
    [0.2, -2.2],
    [C - 0.12, -2.5],
    [C, 0],
  ]);
  // Присел и взмыл: подъём в кадре (и ещё немного — высотой полёта).
  o.z = trk(T, [
    [0, 0],
    [0.06, -1],
    [0.3, 2.6, easeOut],
    [C - 0.14, 3],
    [C, 0.6, easeIn],
  ]);
  o.tup = trk(T, [
    [0, 0],
    [0.25, 0.85],
    [C - 0.1, 0.9],
    [C, 0.1],
  ]);
  o.tw = 0.18;
  o.tph = T * 9;
  o.horn = trk(T, [
    [0.06, 0.3],
    [0.3, 1, easeOut],
  ]);
  o.eye = T >= LOCK_T ? 1 : 0;
  if (T >= LOCK_T && T < C - 0.12) {
    // Замок: концы крыльев дрожат, хвост хлещет.
    const k = Math.floor(T * FPS);
    o.ag = 0.09;
    o.ph = k % 2 ? 1.6 : -1.6;
    o.tw = 0.35;
    o.tph = k * 1.7;
  }
  return o;
}

/** Пике: вход — взмах вниз и складывание (`T` < 0,17), дальше — стрела. */
function swoopO(f: number): RaO {
  const o: RaO = { ...R0, horn: 1, eye: 1, tw: 0.08 };
  if (f < 4) {
    const k = (f + 0.5) / 4;
    o.base = -0.15 - 0.3 * easeOut(k);
    o.bend = 0.25 - 0.35 * k;
    o.fold = easeOut(k);
    o.pitch = 0.22 - 0.1 * k;
    o.tph = f * 1.4;
    return o;
  }
  const ph = ((f - 4) / 4) * TAU;
  o.fold = 1;
  o.base = -0.28;
  o.bend = -0.1;
  o.ph = ph;
  o.ag = 0.07;
  o.pitch = 0.1;
  o.tph = ph;
  o.tw = 0.1;
  return o;
}

/** Выход из пике (`recover`, 0,42 с): крылья вверх — тормоз, нос задран. */
function pullO(T: number): RaO {
  const o: RaO = { ...R0 };
  o.base = trk(T, [
    [0, -0.28],
    [0.12, 0.7, easeOut],
    [0.26, 0.25],
    [0.42, 0.08],
  ]);
  o.bend = trk(T, [
    [0, -0.1],
    [0.1, -0.4],
    [0.24, 0.2],
    [0.42, 0],
  ]);
  o.fold = 1 - sstep(0, 0.12, T);
  o.pitch = trk(T, [
    [0, 0.1],
    [0.12, -0.36, easeOut],
    [0.42, 0],
  ]);
  o.z = trk(T, [
    [0, 0],
    [0.15, 1.2],
    [0.42, 0],
  ]);
  o.horn = 1 - 0.7 * sstep(0.1, 0.4, T);
  o.eye = T < 0.25 ? 1 : 0;
  o.tw = 0.4;
  o.tph = T * 14;
  o.ph = T * 9;
  o.ab = 0.08;
  return o;
}

function flinchO(f: number): RaO {
  const k = f / 4;
  const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
  return {
    ...R0,
    base: 0.05 + 0.5 * b,
    bend: -0.35 * b,
    roll: 0.22 * b,
    pitch: -0.22 * b,
    fwd: -1.2 * b,
    z: 0.8 * b,
    eye: b > 0.45 ? 2 : 0,
    tw: 0.5 * b,
    tph: f * 1.8,
    tup: 0.4 * b,
  };
}

/** Смерть, 22 кадра (0,9 с). */
function dieO(t: number): RaO {
  const o: RaO = { ...R0 };
  o.base = trk(t, [
    [0, 0.7, easeOut],
    [0.12, 0.55],
    [0.42, -0.2],
    [0.47, -0.42, easeIn],
    [0.55, 0.12],
    [0.62, -0.12],
    [0.7, 0],
  ]);
  o.bend = trk(t, [
    [0, -0.5],
    [0.14, -0.3],
    [0.45, 0.2],
    [0.5, -0.25],
    [0.6, 0.05],
  ]);
  o.roll = trk(t, [
    [0.1, 0],
    [0.44, 2.6, easeIn],
    [0.5, 2.85],
    [0.58, 2.75],
  ]);
  o.pitch = trk(t, [
    [0, -0.32, easeOut],
    [0.14, -0.2],
    [0.44, 0.2],
    [0.52, 0.05],
  ]);
  o.horn = 0.3 - 0.3 * sstep(0.3, 0.6, t);
  o.eye = t < 0.08 ? 2 : 3;
  o.tw = trk(t, [
    [0, 0.6],
    [0.4, 0.3],
    [0.66, 0.35],
    [0.75, 0],
  ]);
  o.tph = t * 16;
  o.tup = trk(t, [
    [0, 0.5],
    [0.3, -0.2],
  ]);
  return o;
}

/** Лежит на полу (сон): крылья плашмя, кромка чуть дышит; взлёт (`alert`). */
function restO(f: number): RaO {
  return { ...R0, base: -0.06, bend: 0.04, ph: f * PI, ag: 0.05, tw: 0.15, tph: f, horn: 0 };
}
function takeoffO(T: number): RaO {
  const k = T / 0.35;
  return {
    ...R0,
    ph: k * 1.5 * TAU,
    ab: 0.55 * sstep(0, 0.2, k),
    ag: 0.4,
    pitch: -0.18 * Math.sin(PI * k),
    tw: 0.35,
    tph: k * 8,
    horn: 0.3 * k,
  };
}

function rayPose(anim: string, f: number): RaO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'fly0':
    case 'fly1':
    case 'fly2':
      return flyO(f, 16, +anim[3] - 1, false);
    case 'glide':
      return flyO(f, 20, 0, true);
    case 'aim':
      return aimO(Math.min(t, AIM_T - 0.005));
    case 'swoop':
      return swoopO(f);
    case 'pull':
      return pullO(t - 0.5 / FPS + 0.004);
    case 'flinch':
      return flinchO(f);
    case 'die':
      return dieO(t);
    case 'rest':
      return restO(f);
    case 'takeoff':
      return takeoffO(Math.min(t, 0.35));
  }
  return { ...R0 };
}

// ---- Кадр ----------------------------------------------------------------------

const RA = kindOf('ray', 50, 44, 25, 26, 1600);

const rayPic = (anim: string, f: number, d: number): Pic => {
  const o0 = rayPose(anim, f);
  const yaw = yawN(d);
  return draw(RA, rayRig(o0, yaw), (o: RigOut, P2) => {
    if (anim === 'swoop' || (anim === 'pull' && f <= 2)) {
      // Полосы ветра за концами крыльев и вдоль хвоста.
      const B = bodyF(o0, yaw);
      const n = anim === 'pull' ? 3 - f : 5;
      for (const sd of [-1, 1]) {
        const { lead } = wingNodes(B, sd, o0);
        const tip = lead[NSEG];
        for (let j = 0; j < n; j++) {
          const q = P2(vadd(tip, B.v(-1.5 - j * 1.3, 0, 0)));
          spark2(o, q[0], q[1], alpha(AIRL, 0.75 * (1 - j / n)), 0.3);
        }
      }
      for (let j = 0; j < n + 1; j++) {
        const q = P2(B.p(-8 - j * 1.4, (f % 2) - 0.5, 1.6));
        spark2(o, q[0], q[1], alpha(AIRL, 0.55 * (1 - j / (n + 1))), 0.2);
      }
    }
  });
};

/** Крен в вираже: уровень −1…1 по скорости поворота курса, с запасом. */
const BANK = new WeakMap<Mob, { b: number; at: number }>();
function bankLvl(m: Mob, spin: number, now: number): number {
  let st = BANK.get(m);
  const want = spin > 0.55 ? 1 : spin < -0.55 ? -1 : Math.abs(spin) < 0.3 ? 0 : null;
  if (!st) {
    st = { b: want ?? 0, at: now };
    BANK.set(m, st);
    return st.b;
  }
  if (want !== null && want !== st.b && (now - st.at >= 0.12 || now < st.at)) {
    st.b += Math.sign(want - st.b);
    st.at = now;
  }
  return st.b;
}

registerMobPainter('f11_ray', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const tech = md === 'aim' || md === 'f11_swoop';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m, 0.5), md === 'f11_swoop' ? 30 : 4);
  const d = dirN(v.yaw);
  const ph = hash(id, 7);
  const ex: Partial<MobFrame> = { shadow: 6, lift: 6, still: true };
  let anim = 'glide';
  let f = Math.floor(now * FPS + ph * 20) % 20;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.74, 0.9, t);
    ex.lift = 6 * (1 - easeIn(clamp01((t - 0.12) / 0.32)));
    ex.shadow = 6 + 2 * sstep(0.2, 0.44, t);
  } else if (md === 'aim') {
    f = fi(t, 19);
    anim = 'aim';
    // Набирает высоту перед пике и чуть клюёт вниз в конце.
    ex.lift = 6 + 1.5 * sstep(0, 0.35, t);
    ex.shadow = 6 - 1 * sstep(0, 0.35, t);
  } else if (md === 'f11_swoop') {
    f = t < 4 / FPS ? fi(t, 3) : 4 + (Math.floor(t * FPS) % 4);
    anim = 'swoop';
    ex.lift = 7.5 - 4.5 * sstep(0, 0.16, t);
    ex.shadow = 7;
    ex.ghost = { every: 0.03, life: 0.18, tint: '#7ab4e2', alpha: 0.32 };
  } else if (md === 'recover' && t < 0.42 && (v.prev === 'f11_swoop' || v.prev === '')) {
    f = fi(t, 9);
    anim = 'pull';
    ex.lift = 3 + 3 * sstep(0, 0.6, t);
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.5 + ph * 2) % 2;
    anim = 'rest';
    ex.lift = 0.5;
    ex.shadow = 7;
  } else if (md === 'alert') {
    f = fi(t, 8);
    anim = 'takeoff';
    ex.lift = 0.5 + 5.5 * sstep(0.05, 0.33, t);
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else {
    if (md === 'recover') ex.lift = 3 + 3 * sstep(0, 0.6, t);
    if (md === 'emerge') dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
    if (moving(m, 1.2) && md !== 'recover') {
      f = Math.floor(now * FPS + ph * 16) % 16;
      anim = `fly${bankLvl(m, v.spin, now) + 1}`;
    }
  }
  if (md !== 'dying') hurtFx(v, now, 1.4, ex);
  return put(
    frameOf(RA, anim, f, d, pose, (dd) => rayPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_ray', function* () {
  yield* warmAll(
    RA,
    [
      ['fly1', 16],
      ['fly2', 16],
      ['fly0', 16],
      ['aim', 20],
      ['swoop', 8],
      ['pull', 10],
      ['glide', 20],
      ['flinch', 5],
      ['die', 22],
      ['takeoff', 9],
      ['rest', 2],
    ],
    rayPic,
  );
});
