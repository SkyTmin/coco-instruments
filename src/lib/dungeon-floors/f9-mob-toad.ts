// Этаж 9 — ядовитая жаба (анимации мобов 9). Приземистая, бородавчатая,
// оливковая с рыжими пятнами яда; 8 сторон честно (риг).
//
// Прыжки — по той же фазе, что у мозга: скорость в погоне умножается на
// `0,3 + 1,3·max(0, sin(m.t·7 + id))`, поэтому «в воздухе» жаба ровно тогда,
// когда мозг её несёт: толчок (лапы распрямились) → полёт (лапы назад,
// передние вперёд) → приземление на передние → присед (сплющило) → сидит →
// подобралась к новому толчку. Подъём — сдвигом кадра, тень остаётся на полу.
// Плевок: горловой мешок раздувается весь прицел, на пике дрожит; выстрел —
// голова вперёд, пасть настежь, мешок опадает. Укус — язык хлёстом в кадр
// урона. Смерть: подбросило, перевернулась на спину, лапы дёргаются.
// Снаряд `f9_spit` — комок со шлейфом капель; контакт — лужа на полу
// (зона мозга) и брызги поверх темноты (`registerImpactPainter`).

import { Px } from '../dungeon-art';
import {
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerShotPainter,
} from '../dungeon-paint';
import type { MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot } from '../dungeon-sim';
import { F3, Rig } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  INK,
  PI,
  TAU,
  alpha,
  camSide,
  clamp01,
  dirN,
  drawRig,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFields,
  hx,
  ik2,
  kindOf,
  lerp,
  mixc,
  mod,
  out,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  vlerp,
  warmAll,
  yawN,
} from './f9-mobkit';
import type { Pic, RGBA } from './f9-mobkit';

// ---- Палитра (прежняя) ----

const SKIN = tn('#26300e', '#4a5a1c', '#6e8028', '#9aac44');
const BELLY = tn('#6a5a2a', '#a8904a', '#cebc72', '#ece0a4');
const SAC = tn('#6a5a14', '#b8a02a', '#e8d65a', '#fff6a8');
const GLAND = tn('#6a3010', '#b0561a', '#e0781e', '#ffc04a');
const MOUTH = tn('#2a0a08', '#4a1a14', '#7a2a20', '#a84a3a');
const TONGUE = tn('#6a1a2a', '#b03a50', '#e0687a', '#ffa8b8');
const SPOT = hx('#e0781e');
const SPOT_HI = hx('#ffc04a');
const WART = hx('#3a4614');
const EYE = hx('#ff9a2a');
const SLIME = hx('#b8f050');

/** Бородавки и рыжие пятна — узор в координатах тела, не кипит при шаге. */
const SKIN_M: Mat = {
  T: SKIN,
  pat: (q, l) => {
    const gx = Math.floor(q[0] * 3.2 + 9);
    const gy = Math.floor(q[1] * 3.2 + 9);
    const h = hash(gx, gy, Math.floor(q[2] * 2 + 5));
    if (q[2] > -0.1 && h > 0.89) return l > 0.55 ? SPOT_HI : SPOT;
    if (h < 0.14) return l > 0.6 ? SKIN[1] : WART;
    return null;
  },
};
const SKIN_PLAIN: Mat = { T: SKIN };
const SKIN_FAR: Mat = { T: SKIN, bias: -0.15 };
const BELLY_M: Mat = { T: BELLY };
const SAC_M: Mat = { T: SAC, spec: true, bias: 0.1 };
const GLAND_M: Mat = { T: GLAND };
const MOUTH_M: Mat = { T: MOUTH, soft: true };
const TONGUE_M: Mat = { T: TONGUE };

interface ToadO {
  /** Высота центра тела, наклон (− нос вверх), сдвиг назад, приплюснутость. */
  h: number;
  pitch: number;
  back: number;
  squish: number;
  puff: number;
  /** Задние лапы: 0 сложены, 1 распрямлены назад. */
  ext: number;
  /** Передние: вынос вперёд и подъём кистей. */
  fore: number;
  lift: number;
  /** Голова: кивок (+ вниз), пасть, язык, мешок. */
  head: number;
  jaw: number;
  tongue: number;
  sac: number;
  shut: number;
  /** На спине (рад) и дёрганье лап. */
  roll: number;
  kick: number;
  /** Брызги у пасти (плевок). */
  spray: number;
}

const T0: ToadO = {
  h: 3.2,
  pitch: -0.12,
  back: 0,
  squish: 1,
  puff: 1,
  ext: 0,
  fore: 0,
  lift: 0,
  head: 0,
  jaw: 0,
  tongue: 0,
  sac: 0.12,
  shut: 0,
  roll: 0,
  kick: 0,
  spray: 0,
};

function toadRig(o: ToadO, yaw: number): Rig {
  const r = new Rig();
  const cs = camSide(yaw);
  let C = F3.yaw(yaw).at(o.back, 0, o.h);
  if (o.roll) C = C.roll(o.roll);
  C = C.pitch(o.pitch);
  const k = o.puff;
  const up = !o.roll;
  // Ноги — в осях тела; стоя на полу — не ниже пола.
  const ground = (p: V3): V3 => (up && p[2] < 0.25 ? [p[0], p[1], 0.25] : p);
  const fz = -o.h; // пол в осях тела (без наклона)

  for (const sd of [-1, 1]) {
    const m = sd === cs ? SKIN_M : SKIN_FAR;
    const kk = o.kick * (sd > 0 ? 1 : -0.7);
    // Задняя: бедро → колено → пятка → стопа (сложена «гармошкой»).
    const hip = C.p(-2.6, sd * 3.0, -0.6);
    const fold = [
      C.p(0.6, sd * 5.4, fz + 2.4),
      C.p(-3.4, sd * 5.0, fz + 0.9),
      C.p(-0.6, sd * 5.8, fz + 0.25),
    ];
    const ext = [
      C.p(-6.2, sd * 3.9, -1.2 + kk * 2),
      C.p(-9.6, sd * 3.5, -1.8 + kk * 3),
      C.p(-12.0, sd * 3.3, -1.2 + kk * 3.5),
    ];
    const kn = ground(vlerp(fold[0], ext[0], o.ext));
    const an = ground(vlerp(fold[1], ext[1], o.ext));
    const to = ground(vlerp(fold[2], ext[2], o.ext));
    r.cap(hip, kn, 1.8, 1.2, m);
    r.cap(kn, an, 1.15, 0.8, m);
    r.cap(an, to, 0.8, 0.55, m);
    for (const s2 of [-0.9, 0, 0.9]) r.dot(vadd(to, C.v(0.9, s2, 0)), SKIN[2], 0, 1, 0.3);
    // Передняя: плечо → локоть → кисть.
    const sh = C.p(2.6, sd * 2.9, -1.6);
    const hand = ground(
      C.p(4.4 + o.fore * 2.6, sd * (3.5 + o.fore * 0.3), fz + 0.25 + o.lift + kk * 2.5),
    );
    const el = ik2(sh, hand, 2.4, 2.4, C.v(-1, sd * 1.2, 0.3));
    r.cap(sh, el, 1.05, 0.85, m);
    r.cap(el, hand, 0.85, 0.6, m);
    for (const s2 of [-0.7, 0, 0.7]) r.dot(vadd(hand, C.v(0.7, s2, 0)), SKIN[2], 0, 1, 0.3);
  }

  // Тело, брюхо, железы за глазами.
  r.ell(C, [0, 0, 0], [5.0 * k, 4.4 * k, 3.2 * o.squish * k], SKIN_M);
  r.ell(C, [0.9, 0, -1.1 * o.squish], [4.1 * k, 3.7 * k, 2.1 * o.squish * k], BELLY_M);
  for (const sd of [-1, 1]) r.ell(C, [1.4, sd * 2.0, 2.4 * o.squish * k], [1.7, 0.9, 0.7], GLAND_M);

  // Голова: широкая, плоская; пасть — тёмная черта по краю.
  // Пасть открывается двумя челюстями: верх с глазами вверх, низ вниз.
  const H = C.at(3.7 * k, 0, 0.5).pitch(o.head - o.jaw * 0.3);
  r.ell(H, [0, 0, 0.2], [2.9, 3.9, 1.9], SKIN_PLAIN);
  if (o.jaw > 0.12) {
    const J = C.at(3.7 * k, 0, -0.4).pitch(o.head + o.jaw * 0.6);
    r.ell(J, [1.0, 0, -0.5], [2.5, 3.5, 0.9], BELLY_M);
    r.ell(H, [2.0, 0, -1.0 - o.jaw * 0.4], [1.7, 3.0, 0.35 + o.jaw * 0.6], MOUTH_M);
  } else {
    r.line(H.p(1.8, -3.0, -0.7), H.p(2.9, 0, -0.5), MOUTH[1], 0, 0.1);
    r.line(H.p(1.8, 3.0, -0.7), H.p(2.9, 0, -0.5), MOUTH[1], 0, 0.1);
  }
  if (o.tongue > 0.05) {
    const a = H.p(2.0, 0, -0.9);
    const b = H.p(2.0 + o.tongue * 9, 0, -0.9 - o.tongue * 1.2);
    r.cap(a, b, 0.6, 0.55, TONGUE_M);
    r.ball(b, 1.05, TONGUE_M);
  }
  // Горловой мешок: блестящий пузырь под подбородком.
  if (o.sac > 0.06) {
    const R = 0.5 + o.sac * 2.7;
    r.ell(H, [1.6 + o.sac * 0.4, 0, -1.7 - o.sac * 0.9], [R, R * 1.1, R * 0.85], SAC_M);
  }
  // Глаза на макушке: бугор, оранжевая радужка.
  for (const sd of [-1, 1]) {
    r.ball(H.p(0.4, sd * 2.1, 1.7), 1.35, SKIN_PLAIN);
    if (o.shut > 0.5) r.line(H.p(0.9, sd * 2.0, 2.2), H.p(0.9, sd * 2.8, 2.1), INK, 0, 1);
    else r.dot(H.p(1.2, sd * 2.4, 2.3), EYE, 0, 1, 1.2);
  }
  r.eye = o.shut > 0.5 ? null : H.p(1.2, cs * 2.4, 2.3);
  // Брызги яда изо рта в миг плевка.
  for (let i = 0; i < 4 && o.spray > 0; i++) {
    const d = 3.2 + i * 1.6 * o.spray;
    r.dot(H.p(d, (i % 2 ? 1 : -1) * i * 0.5, -0.6 + i * 0.4), SLIME, 0.7, 1, 1);
  }
  return r;
}

// ---- Позы ----

/** Прыжок: 12 кадров на цикл фазы мозга, 0–5 в воздухе, 6–11 на земле. */
function hopPose(o: ToadO, f: number): void {
  const u = f / 12;
  if (u < 0.5) {
    const a = u * 2; // 0 толчок … 1 касание
    o.ext = trk(a, [
      [0, 0.55],
      [0.2, 1, easeOut],
      [0.55, 0.85],
      [1, 0.15],
    ]);
    o.pitch = trk(a, [
      [0, -0.4],
      [0.25, -0.3],
      [0.6, 0.05],
      [1, 0.25],
    ]);
    o.fore = trk(a, [
      [0, 0],
      [0.3, 0.4],
      [0.8, 1],
      [1, 0.9],
    ]);
    o.lift = trk(a, [
      [0, 0.6],
      [0.4, 1.8],
      [0.9, 0.6],
      [1, 0],
    ]);
    o.h = 3.6;
    o.squish = trk(a, [
      [0, 0.95],
      [0.3, 1.1],
      [1, 1],
    ]);
    o.sac = 0.05;
    o.head = trk(a, [
      [0, -0.15],
      [1, 0.1],
    ]);
  } else {
    const a = (u - 0.5) * 2; // 0 приземлился … 1 перед толчком
    o.h = trk(a, [
      [0, 2.3],
      [0.25, 3.1, easeOut],
      [0.7, 3.2],
      [1, 2.6],
    ]);
    o.squish = trk(a, [
      [0, 0.72],
      [0.25, 1.0, easeOut],
      [0.7, 1],
      [1, 0.88],
    ]);
    o.pitch = trk(a, [
      [0, 0.2],
      [0.3, -0.1],
      [0.75, -0.12],
      [1, 0.08],
    ]);
    o.fore = trk(a, [
      [0, 0.7],
      [0.35, 0],
    ]);
    o.ext = trk(a, [
      [0, 0.1],
      [0.2, 0],
      [0.85, 0],
      [1, 0.2],
    ]);
    o.sac = 0.12 + 0.1 * Math.sin(a * PI);
    o.head = trk(a, [
      [0, 0.15],
      [0.35, 0],
      [1, 0.05],
    ]);
  }
}

function toadPose(anim: string, f: number): ToadO {
  const o: ToadO = { ...T0 };
  const t = f / 24;
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: горло ходит, бока дышат, моргнула.
      const a = (f / 8) * TAU;
      o.sac = 0.14 + 0.16 * Math.max(0, Math.sin(a * 2));
      o.squish = 1 + 0.03 * Math.sin(a);
      o.h = 3.2 - 0.08 * Math.sin(a);
      o.shut = f === 6 ? 1 : 0;
      o.head = 0.04 * Math.sin(a + 1);
      break;
    }
    case 'hop':
      hopPose(o, f);
      break;
    case 'aim': {
      // Прицел 0,62 (в топи 0,5): к 0,46 мешок налился, тело раздулось,
      // голова откинута; дальше держит и дрожит (сдвигом кадра).
      const k = clamp01(t / 0.46);
      o.sac = lerp(0.15, 1.0, easeIn(k));
      o.puff = 1 + 0.08 * k;
      o.head = -0.3 * easeOut(k);
      o.pitch = -0.12 - 0.22 * easeOut(k);
      o.back = -0.8 * easeOut(k);
      o.h = 3.2 + 0.2 * k;
      o.fore = 0.3 * k;
      o.ext = 0.15 * k;
      o.shut = 0;
      break;
    }
    case 'spit': {
      // После плевка 0,7 с: выстрел (пасть настежь, голова вперёд, мешок
      // опал) → отдача назад → оседает, мешок ещё вздрагивает.
      o.jaw = trk(t, [
        [0, 1],
        [0.12, 0.8],
        [0.25, 0],
      ]);
      o.head = trk(t, [
        [0, -0.35],
        [0.08, -0.15],
        [0.3, 0],
      ]);
      o.spray = trk(t, [
        [0, 1],
        [0.1, 1.6],
        [0.12, 0],
      ]);
      o.sac = trk(t, [
        [0, 0.6],
        [0.08, 0.05, easeOut],
        [0.25, 0.25],
        [0.4, 0.08],
        [0.7, 0.14],
      ]);
      o.puff = trk(t, [
        [0, 1.0],
        [0.1, 0.94],
        [0.3, 1],
      ]);
      o.back = trk(t, [
        [0, 0.6],
        [0.12, -1.2, easeOut],
        [0.5, 0],
      ]);
      o.pitch = trk(t, [
        [0, 0.15],
        [0.12, -0.3],
        [0.5, -0.12],
      ]);
      o.h = trk(t, [
        [0, 3.0],
        [0.12, 3.4],
        [0.5, 3.2],
      ]);
      o.fore = trk(t, [
        [0, 0.4],
        [0.4, 0],
      ]);
      break;
    }
    case 'bite': {
      // Укус, windup 0,4 (10 кадров): подобралась назад (до 0,25), замерла,
      // бросок вперёд с открытой пастью, язык хлёстом — кадр урона 9-й.
      const k = clamp01((f + 1) / 10);
      o.back = trk(k, [
        [0, 0],
        [0.6, -1.4, easeOut],
        [0.85, -1.6],
        [1, 1.6, easeIn],
      ]);
      o.h = trk(k, [
        [0, 3.2],
        [0.6, 2.6],
        [0.85, 2.5],
        [1, 3.0],
      ]);
      o.squish = trk(k, [
        [0, 1],
        [0.6, 0.86],
        [1, 1.05],
      ]);
      o.pitch = trk(k, [
        [0, -0.12],
        [0.6, 0.1],
        [1, -0.05],
      ]);
      o.ext = trk(k, [
        [0.85, 0],
        [1, 0.8],
      ]);
      o.jaw = trk(k, [
        [0.75, 0],
        [0.9, 0.6],
        [1, 1],
      ]);
      o.tongue = trk(k, [
        [0.88, 0],
        [1, 1, easeOut],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.6, 0.15],
        [1, -0.1],
      ]);
      o.sac = 0.1;
      break;
    }
    case 'bitef': {
      // После укуса 0,7 с: язык с хлопком назад, лапы подтянулись, села.
      o.tongue = trk(t, [
        [0, 1],
        [0.04, 1.08],
        [0.16, 0, easeIn],
      ]);
      o.jaw = trk(t, [
        [0, 1],
        [0.18, 0.7],
        [0.26, 0],
      ]);
      o.back = trk(t, [
        [0, 1.6],
        [0.35, 0],
      ]);
      o.ext = trk(t, [
        [0, 0.8],
        [0.15, 0.6],
        [0.4, 0],
      ]);
      o.h = trk(t, [
        [0, 3.0],
        [0.2, 2.6],
        [0.45, 3.2],
      ]);
      o.squish = trk(t, [
        [0.1, 1.05],
        [0.2, 0.85],
        [0.45, 1],
      ]);
      o.sac = trk(t, [
        [0.2, 0.1],
        [0.35, 0.3],
        [0.6, 0.12],
      ]);
      break;
    }
    case 'flinch': {
      // Ушиб 0,2 с: отбросило, зажмурилась, лапы врозь.
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.pitch = -0.12 - 0.35 * b;
      o.back = -1.0 * b;
      o.squish = 1 - 0.15 * b;
      o.puff = 1 + 0.05 * b;
      o.shut = b > 0.3 ? 1 : 0;
      o.jaw = 0.5 * b;
      o.ext = 0.4 * b;
      o.fore = 0.5 * b;
      o.lift = 0.8 * b;
      o.sac = 0.4 * b;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: подбросило (до 0,3) — перевернулась на спину,
      // шлёпнулась → лапы дёргаются, мешок опадает.
      o.roll = trk(t, [
        [0.05, 0],
        [0.32, PI, easeIn],
        [0.36, PI * 0.94],
        [0.42, PI],
      ]);
      o.h = trk(t, [
        [0, 3.2],
        [0.15, 6.0, easeOut],
        [0.32, 2.9, easeIn],
        [0.38, 3.3],
        [0.44, 2.9],
      ]);
      o.squish = trk(t, [
        [0.3, 1],
        [0.34, 0.8],
        [0.44, 0.95],
      ]);
      o.ext = trk(t, [
        [0, 0],
        [0.15, 0.9],
        [0.4, 0.5],
      ]);
      o.fore = 0.6;
      o.lift = 1.4;
      o.kick = t > 0.4 ? Math.sin((t - 0.4) * 34) * (1 - clamp01((t - 0.4) / 0.4)) : 0;
      o.shut = t > 0.05 ? 1 : 0;
      o.jaw = trk(t, [
        [0, 0.6],
        [0.15, 1],
        [0.5, 0.4],
      ]);
      o.sac = trk(t, [
        [0, 0.5],
        [0.4, 0.4],
        [0.8, 0],
      ]);
      o.puff = trk(t, [
        [0.4, 1],
        [0.85, 0.9],
      ]);
      break;
    }
  }
  return o;
}

// ---- Кадры ----

const TOAD = kindOf('f9_toad', 50, 35, 25, 23, 1100, 1.25);
const toadPic = (anim: string, f: number, d: number): Pic =>
  drawRig(TOAD, toadRig(toadPose(anim, f), yawN(d)));

registerMobPainter('f9_toad', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const tech = md === 'aim' || md === 'windup';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m, 0.3), 8);
  const ex: Partial<MobFrame> = { shadow: 5, still: true };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.7, 0.9, t);
    // Подлёт при перевороте — сдвигом (кадр рисует только позу).
    ex.dy = -Math.max(0, Math.sin(clamp01(t / 0.32) * PI)) * 4;
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 14);
    if (t > 0.46) ex.dx = (Math.floor(t * 36) % 2 ? 0.35 : -0.35) * Math.cos(v.yaw);
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 9);
  } else if (md === 'recover') {
    anim = v.prev === 'aim' ? 'spit' : 'bitef';
    f = fi(t, 16);
  } else if (hurtAge(v, now) >= 0 || md === 'stun') {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
  } else if (md === 'chase') {
    // Фаза прыжка — как у мозга (`sin(m.t·7 + id)`).
    const ph = mod(((t * 7 + id) / TAU) * 1200, 1200) / 1200;
    const u = ph;
    anim = 'hop';
    f = Math.floor(u * 12) % 12;
    if (u < 0.5) {
      const lift = Math.sin(u * 2 * PI) * 6;
      ex.dy = -lift;
      ex.shadow = 5 - lift * 0.25;
    } else if (u < 0.56) {
      ex.sx = 1.12;
      ex.sy = 0.88;
    }
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 3) * 5) * 6, 8);
  }
  if (md !== 'dying') hurtFields(v, now, ex);
  const d = dirN(v.yaw);
  return out(
    frameOf(TOAD, anim, f, d, pose.look, () => toadPic(anim, f, d)),
    ex,
    pose.flash,
  );
});

export const TOAD_WARM: [string, number][] = [
  ['hop', 12],
  ['idle', 8],
  ['aim', 15],
  ['spit', 17],
  ['bite', 10],
  ['bitef', 17],
  ['flinch', 5],
  ['die', 21],
];
registerMobWarm('f9_toad', function* () {
  yield* warmAll(TOAD, TOAD_WARM, toadPic);
});

// ---- Плевок: комок яда со шлейфом капель ----

const SPIT_CORE = tn('#2a4a0a', '#5a8a14', '#a8d83a', '#e8ff9a');
const SPITS = new Map<string, Sprite>();

function spitSprite(d: number, f: number): Sprite {
  const key = `${d}|${f}`;
  let sp = SPITS.get(key);
  if (sp) return sp;
  const p = new Px(22, 22);
  const cx = 11;
  const cy = 11;
  const a = (d / 16) * TAU;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  // Шлейф: капли позади, мельче и прозрачнее.
  const drops: [number, number, number][] = [
    [3.6, 1.5, 0.85],
    [6.0, 1.1, 0.6],
    [8.2, 0.7, 0.4],
  ];
  for (const [dd, rr, al] of drops) {
    const wob = (f ? 0.6 : -0.6) * (dd / 8);
    const x = cx - ux * dd - uy * wob;
    const y = cy - uy * dd + ux * wob;
    for (let yy = -2; yy <= 2; yy++)
      for (let xx = -2; xx <= 2; xx++)
        if (xx * xx + yy * yy <= rr * rr + 0.3)
          p.set(x + xx, y + yy, alpha(mixc(SPIT_CORE[2], SLIME, 0.4), al));
  }
  // Комок: вытянут по ходу, свет сверху-слева.
  const R = 2.8;
  for (let yy = -4; yy <= 4; yy++)
    for (let xx = -4; xx <= 4; xx++) {
      const along = xx * ux + yy * uy;
      const across = -xx * uy + yy * ux;
      const q = (along / (R * (f ? 1.15 : 1.05))) ** 2 + (across / (R * (f ? 0.9 : 0.95))) ** 2;
      if (q > 1) continue;
      const l = 0.55 - xx * 0.12 - yy * 0.14 + (1 - q) * 0.3;
      const c: RGBA = SPIT_CORE[l > 0.85 ? 3 : l > 0.55 ? 2 : l > 0.3 ? 1 : 0];
      p.set(cx + xx, cy + yy, c);
    }
  p.outline(alpha(INK, 0.85));
  p.set(cx - 1, cy - 1, hx('#ffffff'));
  sp = { img: p.canvas(), ax: cx, ay: cy + 2 };
  SPITS.set(key, sp);
  return sp;
}

registerShotPainter('f9_spit', (s: Shot, time: number): Sprite => {
  // Направление на экране: ход по полу и подъём дуги (z растёт — вверх).
  const T = s.lob?.T ?? 1;
  const k = clamp01(s.age / T);
  const A = Math.min(3, T * 2.2);
  const vz = s.lob ? (Math.cos(k * PI) * PI * A) / T : 0;
  const a = Math.atan2(s.vy * 0.6 - vz * 0.8, s.vx);
  const d = mod(Math.round((a / TAU) * 16), 16);
  return spitSprite(d, mod(time * 12 + s.id, 2));
});

// Контакт: брызги яда поверх темноты (лужу кладёт мозг зоной `f9_venom`).
registerImpactPainter('f9_spit', {
  life: 0.36,
  above: true,
  paint: (g, rec, px, py, _s, age) => {
    const k = clamp01(age / 0.36);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + hash(i, Math.round(rec.x * 7), Math.round(rec.y * 7)) * 0.6;
      const sp = 0.7 + hash(i, 3, Math.round(rec.x * 13)) * 0.6;
      const r = (2 + 11 * easeOut(k)) * sp;
      const x = Math.round(px + Math.cos(a) * r);
      const y = Math.round(py + Math.sin(a) * r * 0.6 - Math.sin(k * PI) * 4 * sp);
      g.globalAlpha = 1 - k;
      g.fillStyle = i % 3 ? '#a8d83a' : '#e8ff9a';
      const w = k < 0.5 ? 2 : 1;
      g.fillRect(x, y, w, w);
    }
    // Шлепок: светлое пятно, гаснет за треть жизни.
    if (k < 0.35) {
      g.globalAlpha = (1 - k / 0.35) * 0.8;
      g.fillStyle = '#c8f04a';
      const R = Math.round(3 + 6 * k);
      g.fillRect(Math.round(px - R), Math.round(py - 1), R * 2, 2);
      g.fillRect(Math.round(px - R / 2), Math.round(py - 2), R, 4);
    }
    return true;
  },
});
