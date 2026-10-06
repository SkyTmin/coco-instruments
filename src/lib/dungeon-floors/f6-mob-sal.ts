// Этаж 6 — Саламандра (анимации мобов 6). Ящерица лавы прежнего облика:
// тёмно-красная чешуя, жёлтое брюхо, тлеющие пятна на спине, гребень из
// язычков огня, жёлтые глаза. Мини-3D риг (`f15-rig.ts`), 8 сторон честно.
//
// Ход — по пути: лапы диагональными парами, хребет изгибается волной, голова
// держит курс, хвост доигрывает волну с опозданием. Укус (0,45 с — весь
// замах): пятится, задирает голову, пасть настежь, дрожит на пике, бросок —
// кадр контакта = первый кадр `recover` (миг урона `biteStep`), пасть
// смыкается со вспышкой, трёпка, отдача. Бросок по линии: сжимается
// пружиной 0,55 с (гребень вздыбливается), летит вытянутой стрелой со
// шлейфом, тормозит лапами. Нырок: носом в лаву, уходит под плоскость лавы
// (невидимая плоскость рига срезает тело); плывёт — над лавой голова и
// гребень, за ней — расходящиеся круги; выныривает (лава вспучивается,
// показывается голова, приседает) и прыгает дугой, приземление — шлепок.
// Смерть: дёрнулась, завалилась на бок, гребень гаснет дымом, тело остывает
// в серый камень с гаснущими трещинами и осыпается (0,9 с, `linger`).
// Эхо 15-го (`f15_echo`, мотив 2) зовёт этот же рисовальщик со своими режимами.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vadd, vlerp } from './f15-rig';
import type { Mat, RigOut } from './f15-rig';
import {
  alpha,
  CLIP,
  clamp01,
  draw,
  easeIn,
  easeOut,
  FIRE,
  fi,
  frameOf,
  FPS,
  hash,
  headOf,
  hurtFx,
  hx,
  kf,
  kindOf,
  litOn,
  mixT,
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
  dirN,
  camSide,
} from './f6-mobkit';
import type { Pic, Proj2, V3 } from './f6-mobkit';

const SKIN = tn('#2e0a0a', '#6a1812', '#a8301c', '#e0603a');
const BELLY = tn('#7a3a10', '#c0702a', '#e8a040', '#ffd880');
const LEG = tn('#260808', '#561410', '#8a2818', '#c4502e');
const SPOT = hx('#ffb030');
const SPOT_HI = hx('#ffe080');
const EYE = hx('#ffe24a');
const MAW = tn('#3a0806', '#7a1408', '#e0601a', '#ffc050');
const CLAW = hx('#1a0606');
const TONGUE = hx('#ff4a6a');
const STONE = hx('#4a4440');
const SMOKE = hx('#6e625c');
const LAVA_HI = hx('#ffc440');
const LAVA_MID = hx('#ff8a1e');
const LAVA_DK = hx('#a8240a');

/** Поза рига саламандры. */
interface SalO {
  /** Корпус вперёд (выпад), вверх, нос вниз (+), крен (+ — правым боком вниз). */
  fwd: number;
  lift: number;
  pitch: number;
  roll: number;
  /** Изгиб хребта: грудь повёрнута вправо (+) относительно таза. */
  bend: number;
  /** Голова: нос вниз (+), поворот вправо (+); пасть 0…1. */
  head: number;
  hyaw: number;
  jaw: number;
  /** Хвост: фаза и размах волны, подъём кончика, завиток (сон). */
  tw: number;
  ta: number;
  tl: number;
  curl: number;
  /** Шаг: фаза 0…1 и доля; присед (корпус ниже, лапы шире); лапы назад (полёт). */
  ph: number;
  step: number;
  crouch: number;
  back: number;
  /** Корпус длиннее (вытянулся в броске). */
  stretch: number;
  /** Гребень: высота 0…2, наклон назад 0…1, такт пламени. */
  crest: number;
  sweep: number;
  flick: number;
  /** Пятна ярче (злится). */
  heat: number;
  /** Глаза 0 — закрыты; язык 0…1. */
  eyes: number;
  tongue: number;
  /** Остывание (смерть) 0…1; распад 0…1. */
  cool: number;
  crumble: number;
  /** Погружение под лаву, пиксели (0 — на суше). */
  sink: number;
  /** Вспышка смыкания пасти 0…1. */
  snap: number;
}

const S0: SalO = {
  fwd: 0,
  lift: 0,
  pitch: 0,
  roll: 0,
  bend: 0,
  head: 0,
  hyaw: 0,
  jaw: 0,
  tw: 0,
  ta: 0.15,
  tl: 0,
  curl: 0,
  ph: 0,
  step: 0,
  crouch: 0,
  back: 0,
  stretch: 1,
  crest: 1,
  sweep: 0,
  flick: 0,
  heat: 0,
  eyes: 1,
  tongue: 0,
  cool: 0,
  crumble: 0,
  sink: 0,
  snap: 0,
};

/** Пятна на спине: точки на единичной сфере корпуса. */
const SPOTS: V3[] = [
  [0.55, -0.35, 0.72],
  [0.1, 0.42, 0.85],
  [-0.4, -0.3, 0.84],
  [-0.75, 0.3, 0.55],
  [0.35, 0.05, 0.93],
];
const spotAt = (q: V3) => {
  for (const s of SPOTS) {
    const d = (q[0] - s[0]) ** 2 + (q[1] - s[1]) ** 2 + (q[2] - s[2]) ** 2;
    if (d < 0.032) return d < 0.012 ? 2 : 1;
  }
  return 0;
};
/** Трещины остывающего тела (по точке единичной сферы). */
const crackAt = (q: V3) =>
  Math.abs(Math.sin(q[0] * 7.3 + q[1] * 3.1) + Math.sin(q[1] * 5.7 - q[2] * 4.3)) < 0.16;

function salRig(o: SalO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw, [0, 0, -o.sink]);
  const zc = 3.2 + o.lift - o.crouch * 0.9;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const cool = o.cool;
  const skin = cool > 0 ? mixT(SKIN, STONE, cool) : SKIN;
  const belly = cool > 0 ? mixT(BELLY, STONE, cool * 0.9) : BELLY;
  const leg = cool > 0 ? mixT(LEG, STONE, cool) : LEG;
  const glowK = (0.55 + o.heat * 0.45) * (1 - cool);
  const spotC = o.heat > 0.5 ? SPOT_HI : SPOT;
  const body: Mat = {
    T: skin,
    bias: -0.12,
    pat: (q, l) => {
      if (q[2] < -0.38) return l > 0.3 ? belly[2] : belly[1];
      if (cool > 0.25 && cool < 0.95 && crackAt(q)) return alpha(LAVA_MID, 1);
      if (cool < 0.6 && spotAt(q)) return spotC;
      return null;
    },
    gpat: (q) => {
      if (cool > 0.25 && cool < 0.95 && crackAt(q)) return 0.9 * (1 - (cool - 0.25) / 0.7);
      return q[2] >= -0.38 && spotAt(q) ? glowK : 0;
    },
  };
  const bellyM: Mat = { T: belly };
  const legM: Mat = { T: leg };
  const sl = o.stretch;
  // Таз, корпус, грудь: грудь повёрнута изгибом хребта.
  const Hp = C.at(-3.2 * sl, 0, -0.1).turn(-o.bend * 0.6);
  const Ch = C.at(3.0 * sl, 0, 0.2).turn(o.bend);
  r.ell(Hp, [0, 0, 0], [2.6 * sl, 2.35, 1.95], body);
  r.ell(C, [0, 0, 0], [3.4 * sl, 2.65, 2.2], body);
  r.ell(Ch, [0, 0, 0], [2.6 * sl, 2.45, 2.1], body);
  // Голова: шея от груди, череп, верхняя челюсть, нижняя — опускается.
  const H = Ch.at(3.6, 0, 0.9)
    .turn(o.hyaw)
    .pitch(o.head - o.jaw * 0.22);
  r.cap(Ch.p(1.2, 0, 0.3), H.p(0.2, 0, -0.1), 2.0, 1.75, body);
  r.ell(H, [1.1, 0, 0.3], [2.5, 2.05, 1.7], body);
  r.ell(H, [3.3, 0, 0.05], [2.0, 1.4, 0.95], body);
  const J = H.at(0.9, 0, -0.55).pitch(o.jaw * 0.85);
  r.ell(J, [2.0, 0, -0.15], [2.1, 1.1, 0.42], bellyM);
  if (o.jaw > 0.18) {
    // Пасть: в глубине — жар (светится).
    r.ball(H.p(2.3, 0, -0.55 - o.jaw * 0.35), 0.75 + o.jaw * 0.35, {
      T: MAW,
      glow: 0.8 * (1 - cool),
    });
  }
  const cs = camSide(yaw);
  if (o.eyes > 0)
    for (const sd of [-1, 1]) {
      r.dot(H.p(1.6, sd * 1.55, 1.25), EYE, cool > 0.5 ? 0 : 0.9, 1, 2.2);
    }
  else for (const sd of [-1, 1]) r.dot(H.p(1.6, sd * 1.55, 1.25), CLAW, 0, 1, 2.2);
  if (o.eyes > 0 && cool < 0.5) r.eye = H.p(1.6, cs * 1.55, 1.25);
  // Язык: раздвоенный, из-под морды.
  if (o.tongue > 0) {
    const t0 = H.p(4.6, 0, -0.35);
    const t1 = H.p(4.6 + o.tongue * 2.4, 0, -0.5);
    r.line(t0, t1, TONGUE, 0, 0.8);
    r.line(t1, H.p(5.2 + o.tongue * 2.6, 0.7, -0.6), TONGUE, 0, 0.8);
    r.line(t1, H.p(5.2 + o.tongue * 2.6, -0.7, -0.6), TONGUE, 0, 0.8);
  }
  if (o.snap > 0) r.dot(H.p(4.6, 0, -0.3), alpha(hx('#fff4c0'), o.snap), 1, 2, 1);
  // Хвост: цепь от таза назад, волна идёт к кончику с опозданием.
  {
    let p0 = Hp.p(-2.2, 0, -0.1);
    let z = p0[2];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      const a =
        o.ta * Math.sin(o.tw - i * 0.85) * (0.35 + k * 0.9) +
        o.curl * (0.25 + i * 0.32) -
        o.bend * 0.5;
      const L = 1.6 * (1 - o.crumble * 0.2);
      const dir = B.v(-Math.cos(a), Math.sin(a), 0);
      const zN = Math.max(0.55 - o.sink, z - 0.75) + o.tl * k * 0.9;
      const p1: V3 = [p0[0] + dir[0] * L, p0[1] + dir[1] * L, zN];
      const r0 = 1.9 * (1 - k * 0.82) + 0.25;
      const r1 = 1.9 * (1 - Math.min(1, (i + 1) / (n - 1)) * 0.82) + 0.22;
      r.cap(p0, p1, r0, r1, i === 0 ? body : { T: skin });
      p0 = p1;
      z = zN;
    }
  }
  // Лапы: диагональными парами; опора стоит на полу, пока корпус едет.
  for (const front of [true, false])
    for (const sd of [-1, 1]) {
      const F = front ? Ch : Hp;
      const hip = F.p(front ? 0.6 : -0.2, sd * 1.65, -0.9);
      const grp = (front ? 0 : 1) ^ (sd > 0 ? 1 : 0);
      const ps = mod((o.ph + grp * 0.5) * 1000, 1000) / 1000;
      const L = 4.2 * o.step;
      let off = 0;
      let rise = 0;
      if (ps < 0.5) off = L / 2 - L * (ps / 0.5);
      else {
        off = -L / 2 + L * ((ps - 0.5) / 0.5);
        rise = Math.sin(PI * ((ps - 0.5) / 0.5)) * 1.6 * o.step;
      }
      const fx = (front ? 3.6 : -3.4) * sl;
      let foot = B.p(fx + o.fwd + off, sd * (4.3 + o.crouch * 0.9), rise);
      if (o.back > 0) foot = vlerp(foot, F.p(front ? -1.8 : -3.4, sd * 2.9, -0.6), clamp01(o.back));
      const mid = vlerp(hip, foot, 0.5);
      const knee = vadd(vadd(mid, B.v(0, sd * (1.1 + o.crouch * 0.4), 0)), [
        0,
        0,
        1.5 - o.back * 0.9,
      ]);
      r.cap(hip, knee, 1.15, 0.85, legM);
      r.cap(knee, foot, 0.85, 0.6, legM);
      r.dot(vadd(foot, B.v(0.9, sd * 0.3, 0)), CLAW, 0, 1, 0.4);
    }
  if (o.crumble > 0) r.explode(o.crumble, C.p(0, 0, -1), 5, 7, 18, 0, 0.45);
  // Плоскость лавы: всё, что ниже, не видно (нырок, плаванье, выход).
  if (o.sink > 0.01)
    r.poly(
      [
        [-40, -40, 0],
        [40, -40, 0],
        [40, 40, 0],
        [-40, 40, 0],
      ],
      { T: CLIP, flat: 0, soft: true },
    );
  return r;
}

/** Точки гребня (мир) — для язычков, которые дорисовываются поверх. */
function crestPts(o: SalO, yaw: number): V3[] {
  const B = F3.yaw(yaw, [0, 0, -o.sink]);
  const zc = 3.2 + o.lift - o.crouch * 0.9;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const sl = o.stretch;
  const Ch = C.at(3.0 * sl, 0, 0.2).turn(o.bend);
  const Hp = C.at(-3.2 * sl, 0, -0.1).turn(-o.bend * 0.6);
  return [
    Ch.p(1.6, 0, 1.95),
    Ch.p(-0.4, 0, 2.05),
    C.p(0.2, 0, 2.15),
    C.p(-2.0, 0, 2.1),
    Hp.p(-0.8, 0, 1.85),
  ];
}

/**
 * Язычок пламени без контура (светится сам, кладётся и в `lit`): основание
 * (x, y) на экране, высота h, наклон назад dx на вершине.
 */
function flameAt(o: RigOut, x: number, y: number, h: number, w: number, dx: number): void {
  if (h < 0.6) return;
  const lit = litOn(o);
  const n = Math.max(1, Math.round(h));
  for (let i = 0; i < n; i++) {
    const k = i / n;
    const ww = (1 - k) * w + 0.3;
    const cx = x + dx * k;
    for (let ox = -Math.ceil(ww); ox <= Math.ceil(ww); ox++) {
      if (Math.abs(ox) > ww) continue;
      const core = Math.abs(ox) / (ww + 0.01);
      const c = k > 0.7 ? FIRE[1] : core < 0.4 && k < 0.45 ? FIRE[3] : FIRE[2];
      const X = Math.round(cx + ox);
      const Y = Math.round(y - i);
      o.p.set(X, Y, c);
      lit.set(X, Y, c);
    }
  }
}

/** Круги по лаве: эллипс у ватерлинии (кадр f — радиус), светится. */
function ringAt(o: RigOut, P: Proj2, c: V3, R: number, k: number): void {
  const lit = litOn(o);
  for (let a = 0; a < TAU; a += 0.1) {
    const [x, y] = P([c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, 0]);
    const X = Math.round(x);
    const Y = Math.round(y);
    const front = Math.sin(a) > 0;
    const col = front ? (k > 0.5 ? LAVA_HI : LAVA_MID) : LAVA_DK;
    o.p.set(X, Y, col);
    lit.set(X, Y, alpha(col, front ? 0.9 : 0.5));
  }
}

/** Брызги лавы: точки по дуге от центра (k — время 0…1). */
function dropsAt(o: RigOut, P: Proj2, c: V3, k: number, n: number, seed: number, up = 9): void {
  const lit = litOn(o);
  for (let i = 0; i < n; i++) {
    const a = hash(i, seed) * TAU;
    const v = 0.5 + hash(i, seed, 2) * 0.8;
    const d = 2 + k * 7 * v;
    const z = k * up * v * 1.4 - k * k * up * 1.6;
    if (z < -0.5) continue;
    const [x, y] = P([c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, Math.max(0, z)]);
    const col = i % 3 ? LAVA_MID : LAVA_HI;
    o.p.set(Math.round(x), Math.round(y), col);
    lit.set(Math.round(x), Math.round(y), col);
  }
}

/** Дым гаснущего гребня: клубы вверх (k — время 0…1). */
function smokeAt(o: RigOut, x: number, y: number, k: number, seed: number): void {
  for (let i = 0; i < 3; i++) {
    const tt = k - i * 0.18;
    if (tt <= 0 || tt > 1) continue;
    const X = x + Math.sin(tt * 6 + i * 2 + seed) * 2;
    const Y = y - 2 - tt * 12;
    const R = 0.8 + tt * 2.2;
    o.p.ell(X, Y, R, R * 0.8, alpha(SMOKE, 0.75 * (1 - tt)));
  }
}

/** Поза по ключу действия и номеру кадра. */
function salPose(anim: string, f: number): SalO {
  const o: SalO = { ...S0, flick: f };
  switch (anim) {
    case 'idle': {
      // 12 кадров по 8 к/с: дышит, оглядывается, язык — на 7–8 кадре.
      const a = (f / 12) * TAU;
      o.lift = 0.12 * Math.sin(a);
      o.hyaw = 0.18 * Math.sin(a * 0.5 + 0.6);
      o.head = -0.05 * Math.sin(a + 1);
      o.tw = a;
      o.ta = 0.22;
      o.tongue = f === 7 ? 0.6 : f === 8 ? 1 : f === 9 ? 0.4 : 0;
      o.crest = 0.95 + 0.1 * Math.sin(a * 2);
      break;
    }
    case 'run': {
      // 8 кадров на цикл (0,7 клетки пути): лапы диагоналями, хребет волной.
      o.ph = f / 8;
      const a = o.ph * TAU;
      o.step = 1;
      o.bend = 0.2 * Math.sin(a);
      o.hyaw = -0.16 * Math.sin(a);
      o.lift = 0.25 * Math.abs(Math.sin(a));
      o.tw = a + 0.6;
      o.ta = 0.42;
      o.sweep = 0.45;
      o.crest = 1.05;
      break;
    }
    case 'bite': {
      // Замах 0,45 с (11 кадров): пятится, голова вверх, пасть настежь
      // (до 0,55), дрожит на пике (до 0,8), бросок вперёд (до 1).
      const k = kf(f, 0.45);
      o.fwd = trk(k, [
        [0, 0],
        [0.55, -1.8, easeOut],
        [0.8, -2.0],
        [1, 1.8, easeIn],
      ]);
      o.lift = trk(k, [
        [0, 0],
        [0.55, 0.7],
        [0.8, 0.8],
        [1, 0, easeIn],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.55, -0.55, easeOut],
        [0.8, -0.6],
        [1, 0.25, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.55, -0.12],
        [1, 0.08, easeIn],
      ]);
      o.jaw = trk(k, [
        [0, 0.05],
        [0.45, 1, easeOut],
        [1, 1],
      ]);
      if (k > 0.55 && k < 0.8) o.jaw -= f % 2 ? 0.1 : 0;
      o.crouch = trk(k, [
        [0, 0],
        [0.55, 0.6],
        [1, 0.2],
      ]);
      o.tw = 1.2 + k * 2;
      o.ta = 0.35;
      o.tl = trk(k, [
        [0, 0],
        [0.55, 0.8],
        [1, 0.3],
      ]);
      o.crest = 1 + 0.5 * sstep(0.2, 0.6, k);
      o.heat = sstep(0.1, 0.6, k);
      break;
    }
    case 'bitef': {
      // Отдых после укуса 0,8 с: контакт (сомкнул, вспышка), трёпка
      // головой, отдача назад, возврат; хвост догоняет с опозданием.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 2.2],
        [0.06, 2.6, easeOut],
        [0.3, -0.6],
        [0.55, 0],
      ]);
      o.head = trk(t, [
        [0, 0.3],
        [0.1, 0.35],
        [0.3, -0.1],
        [0.55, 0],
      ]);
      o.hyaw = t > 0.06 && t < 0.3 ? Math.sin((t - 0.06) * 40) * 0.3 * (1 - (t - 0.06) / 0.24) : 0;
      o.jaw = trk(t, [
        [0, 0.15],
        [0.04, 0],
        [0.32, 0],
        [0.42, 0.3],
        [0.6, 0],
      ]);
      o.pitch = trk(t, [
        [0, 0.08],
        [0.1, 0.1],
        [0.32, -0.05],
        [0.55, 0],
      ]);
      o.tw = 3.2 + t * 6;
      o.ta = trk(t - 0.08, [
        [0, 0.6],
        [0.5, 0.2],
      ]);
      o.snap = f === 0 ? 1 : f === 1 ? 0.5 : 0;
      o.heat = 1 - sstep(0.1, 0.6, t);
      o.crest = 1.4 - 0.4 * sstep(0, 0.5, t);
      break;
    }
    case 'aim': {
      // Пружина 0,55 с (13 кадров): присела, отпрянула, хвост завит в
      // сторону, гребень вздыблен и раскалён; последние кадры — дрожь.
      const k = kf(f, 0.55);
      const c = easeOut(k / 0.7);
      o.crouch = 1.1 * c;
      o.fwd = -2.0 * c;
      o.head = 0.15 * c;
      o.jaw = 0.35 * c;
      o.curl = 0.35 * c;
      o.tw = 1.6;
      o.ta = 0.25;
      o.crest = 1 + 0.9 * c;
      o.heat = c;
      o.sweep = -0.2 * c;
      if (k > 0.7) {
        o.fwd += f % 2 ? 0.3 : -0.2;
        o.lift = f % 2 ? 0.15 : 0;
      }
      break;
    }
    case 'lunge': {
      // Полёт стрелой: вытянута, лапы назад, гребень прижат, пасть вперёд.
      const k = clamp01(f / 4);
      o.stretch = 1 + 0.22 * easeOut(k);
      o.back = easeOut(Math.min(1, k * 1.6));
      o.lift = 1.2 * Math.sin(Math.min(1, f / 8) * PI);
      o.jaw = 0.8;
      o.head = 0.1;
      o.sweep = 1;
      o.crest = 1.2;
      o.heat = 1;
      o.tw = f * 0.9;
      o.ta = 0.12;
      o.pitch = 0.05;
      break;
    }
    case 'lungef': {
      // Торможение после броска 0,8 с: лапы вперёд упираются, пасть
      // щёлкает, корпус догоняет, гребень осыпается искрами и стихает.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 1.6],
        [0.12, 2.2, easeOut],
        [0.4, 0],
      ]);
      o.pitch = trk(t, [
        [0, -0.18],
        [0.12, 0.1],
        [0.4, 0],
      ]);
      o.crouch = trk(t, [
        [0, 0.6],
        [0.15, 0.2],
        [0.4, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0.8],
        [0.08, 0],
        [0.5, 0],
      ]);
      o.tw = 2 + t * 7;
      o.ta = trk(t, [
        [0, 0.7],
        [0.6, 0.2],
      ]);
      o.crest = 1.3 - 0.3 * sstep(0, 0.6, t);
      o.heat = 1 - sstep(0.1, 0.7, t);
      o.snap = f === 2 ? 0.8 : 0;
      break;
    }
    case 'slide': {
      // Нырок 0,4 с (10 кадров): носом в лаву, уходит под плоскость.
      const k = kf(f, 0.4);
      o.pitch = 0.35 * easeOut(k * 2);
      o.head = 0.3;
      o.sink = 7.5 * easeIn(k);
      o.ph = k * 1.2;
      o.step = 1 - k;
      o.back = k;
      o.tw = k * 5;
      o.ta = 0.4;
      o.tl = 1.2 * k;
      o.crest = 1.2;
      break;
    }
    case 'swim': {
      // Плывёт под лавой: над ней — темя, глаза и гребень (8 кадров).
      const a = (f / 8) * TAU;
      o.sink = 3.6 + 0.25 * Math.sin(a);
      o.bend = 0.22 * Math.sin(a);
      o.hyaw = -0.12 * Math.sin(a);
      o.head = -0.25;
      o.tw = a;
      o.ta = 0.5;
      o.ph = f / 8;
      o.step = 0.6;
      o.back = 0.6;
      o.crest = 1.1;
      break;
    }
    case 'rise': {
      // Выход 0,72 с (18 кадров): под лавой (вспучивается), голова над
      // лавой (с 0,35), присед перед прыжком (с 0,6), дрожь.
      const t = (f + 0.5) / FPS;
      o.sink = trk(t, [
        [0, 9],
        [0.33, 7.5],
        [0.5, 3.2, easeOut],
        [0.62, 2.6],
        [0.72, 1.6, easeIn],
      ]);
      o.head = trk(t, [
        [0.33, -0.5],
        [0.6, -0.3],
        [0.72, 0.1],
      ]);
      o.jaw = trk(t, [
        [0.45, 0],
        [0.65, 0.6],
      ]);
      o.crouch = trk(t, [
        [0.55, 0],
        [0.72, 0.9],
      ]);
      o.crest = 0.6 + 0.9 * sstep(0.35, 0.6, t);
      o.heat = sstep(0.4, 0.7, t);
      o.tw = t * 8;
      o.ta = 0.3;
      if (t > 0.62) o.fwd = f % 2 ? 0.25 : -0.15;
      break;
    }
    case 'leap': {
      // Прыжок 0,24 с (6 кадров): вытянута, лапы назад → вперёд к земле.
      const k = kf(f, 0.24);
      o.stretch = 1.15;
      o.back = 1 - easeIn(k);
      o.pitch = trk(k, [
        [0, -0.35],
        [0.5, 0],
        [1, 0.25],
      ]);
      o.jaw = 0.9;
      o.head = 0.15;
      o.sweep = 1;
      o.crest = 1.3;
      o.heat = 1;
      o.ta = 0.2;
      o.tl = 0.6 - k * 0.6;
      break;
    }
    case 'leapf': {
      // Приземление: шлепок (сжатие), лапы врозь, пасть смыкается, встаёт.
      const t = f / FPS;
      o.crouch = trk(t, [
        [0, 1.2],
        [0.08, 1.3],
        [0.35, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0.9],
        [0.06, 0],
      ]);
      o.pitch = trk(t, [
        [0, 0.2],
        [0.3, 0],
      ]);
      o.tw = t * 9;
      o.ta = trk(t, [
        [0, 0.8],
        [0.6, 0.2],
      ]);
      o.crest = 1.3 - 0.3 * sstep(0, 0.6, t);
      o.heat = 1 - sstep(0.1, 0.7, t);
      o.snap = f === 0 ? 0.9 : 0;
      break;
    }
    case 'flinch': {
      // Ушиб: вжалась, голову назад, пасть раскрылась — и обратно (5 кадров).
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.fwd = -1.2 * b;
      o.lift = -0.4 * b;
      o.head = -0.35 * b;
      o.hyaw = 0.25 * b;
      o.jaw = 0.6 * b;
      o.eyes = b > 0.5 ? 0 : 1;
      o.ta = 0.5 * b;
      o.tw = 1.5;
      o.crest = 1 - 0.4 * b;
      break;
    }
    case 'sleep': {
      // Спит: свернулась, хвост кольцом, глаза закрыты, гребень тлеет.
      o.crouch = 1.2;
      o.lift = -0.4 + (f ? 0.12 : 0);
      o.head = 0.3;
      o.hyaw = -0.5;
      o.bend = -0.25;
      o.curl = 0.75;
      o.ta = 0;
      o.eyes = 0;
      o.crest = 0.45 + (f ? 0.1 : 0);
      break;
    }
    case 'alert': {
      // Тревога 0,35 с (9 кадров): вскидывает голову, гребень дыбом.
      const k = kf(f, 0.35);
      const up = Math.sin(PI * Math.min(1, k * 1.4));
      o.head = -0.45 * up;
      o.lift = 0.6 * up;
      o.crest = 1 + 0.7 * easeOut(k);
      o.heat = easeOut(k);
      o.jaw = 0.3 * up;
      o.ta = 0.5;
      o.tw = k * 6;
      break;
    }
    case 'die': {
      // Смерть 0,9 с (22 кадра): дёрнулась, завалилась на бок, гребень
      // гаснет, тело остывает камнем, трещины гаснут, осыпается.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, -1.4, easeOut],
        [0.12, -1.6],
        [0.4, -1.2],
      ]);
      o.roll = trk(t, [
        [0.08, 0],
        [0.35, 1.25, easeIn],
        [0.42, 1.15],
      ]);
      o.lift = trk(t, [
        [0, 0.4],
        [0.1, 0.8],
        [0.35, -0.9, easeIn],
      ]);
      o.head = trk(t, [
        [0, -0.5],
        [0.3, 0.3],
        [0.5, 0.45],
      ]);
      o.jaw = trk(t, [
        [0, 1],
        [0.3, 0.6],
        [0.6, 0.3],
      ]);
      o.eyes = t < 0.35 ? 1 : 0;
      o.ta = 0.6 * (1 - sstep(0.1, 0.6, t));
      o.tw = t * 14;
      o.curl = 0.3 * sstep(0.2, 0.6, t);
      o.crest = 1.2 * (1 - sstep(0.05, 0.45, t));
      o.cool = sstep(0.15, 0.62, t);
      o.crumble = sstep(0.62, 0.9, t) * 0.8;
      o.step = 0.6 * (1 - sstep(0.2, 0.5, t));
      o.ph = t * 6;
      break;
    }
  }
  return o;
}

const SAL = kindOf('f6_salamander', 56, 44, 28, 30, 2600);

function salPic(anim: string, f: number, d: number): Pic {
  const o = salPose(anim, f);
  const yaw = yawN(d);
  return draw(SAL, salRig(o, yaw), (out, P) => {
    // Гребень — язычки поверх (без контура, светятся).
    if (o.crest > 0.05) {
      const pts = crestPts(o, yaw);
      const H = [1.3, 2.1, 0, 2.4, 1.5];
      // Наклон назад на экране: куда смотрит хвост.
      const back = P([-Math.cos(yaw) * 3, -Math.sin(yaw) * 3, 0]);
      const front = P([0, 0, 0]);
      const bx = (back[0] - front[0]) / 3;
      pts.forEach((q, i) => {
        if (o.sink > 0 && q[2] < 0.4) return;
        const [x, y] = P(q);
        const fl = 0.75 + 0.35 * Math.sin(((o.flick + i * 3) % 8) * (TAU / 8) + i);
        const h = H[i] * o.crest * fl;
        flameAt(out, x, y, h, 0.55, bx * (0.4 + o.sweep * 1.4) * (h / 2.5));
      });
    }
    if (anim === 'die' && o.crest < 0.4) {
      const pts = crestPts(o, yaw);
      const [x, y] = P(pts[2]);
      smokeAt(out, x, y, (f / FPS - 0.3) / 0.6, 1);
    }
    if (anim === 'swim' || (anim === 'slide' && f >= 4) || (anim === 'rise' && f >= 6)) {
      // Круги по лаве у ватерлинии и след за плывущей.
      const R = anim === 'rise' ? 3 + ((f - 6) / 12) * 5 : 5.5 + (f % 4) * 0.4;
      ringAt(out, P, [0, 0, 0], R, anim === 'rise' ? 1 : 0.4);
      if (anim === 'swim') {
        const lit = litOn(out);
        for (let i = 1; i <= 4; i++)
          for (const sd of [-1, 1]) {
            const k = (i + (f % 2) * 0.5) * 1.6;
            const [x, y] = P([
              -Math.cos(yaw) * (4 + k) - Math.sin(yaw) * sd * k * 0.55,
              -Math.sin(yaw) * (4 + k) + Math.cos(yaw) * sd * k * 0.55,
              0,
            ]);
            const col = i < 3 ? LAVA_MID : LAVA_DK;
            out.p.set(Math.round(x), Math.round(y), col);
            lit.set(Math.round(x), Math.round(y), alpha(col, 0.8 - i * 0.15));
          }
      }
    }
    if (anim === 'rise' && f < 9) {
      // Лава вспучивается куполом до появления головы.
      const k = (f + 1) / 9;
      const lit = litOn(out);
      const hgt = 1 + k * 2.2;
      for (let yy = 0; yy <= hgt; yy++) {
        const w = Math.round(Math.sqrt(1 - (yy / (hgt + 0.5)) ** 2) * (2 + k * 3));
        for (let xx = -w; xx <= w; xx++) {
          const [x, y] = P([xx, 0, yy / 0.8]);
          const c = yy === Math.round(hgt) || Math.abs(xx) === w ? LAVA_MID : LAVA_HI;
          out.p.set(Math.round(x), Math.round(y), c);
          lit.set(Math.round(x), Math.round(y), c);
        }
      }
    }
    if (anim === 'slide' && f >= 3) dropsAt(out, P, [2, 0, 0], (f - 3) / 7, 7, 11);
    if (anim === 'rise' && f >= 12) dropsAt(out, P, [0, 0, 0], (f - 12) / 6, 6, 13, 6);
    if (anim === 'leap' && f < 4) {
      // Лава стекает с брюха в прыжке.
      const lit = litOn(out);
      for (let i = 0; i < 3; i++) {
        const [x, y] = P([-2 + i * 2.5, 0, 1.6 - f * 0.3]);
        const Y = Math.round(y + f * 1.5 + i);
        out.p.set(Math.round(x), Y, LAVA_HI);
        lit.set(Math.round(x), Y, LAVA_HI);
      }
    }
  });
}

/** Шлейф броска — огненные силуэты. */
const LUNGE_GHOST = { every: 0.035, life: 0.2, tint: '255,120,40', alpha: 0.45 };

registerMobPainter('f6_salamander', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const echo = m.kind !== 'f6_salamander';
  const tech =
    md === 'windup' ||
    md === 'aim' ||
    md === 'f6_lunge' ||
    md === 'f6_leap' ||
    md === 'f6_rise' ||
    md === 'alert';
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), tech ? 16 : 10);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6, lift: 0, still: true };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 21);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.78, 0.9, t);
    ex.shadow = 6 * (1 - sstep(0.6, 0.9, t));
  } else if (md === 'windup') {
    anim = 'bite';
    // Эхо держит замах дольше 0,45 с: пик с дрожью до самого конца.
    f = echo && t > 0.3 ? 7 + (Math.floor(t * FPS) % 2) : fi(t, 10);
  } else if (md === 'recover') {
    const pv = v.prev;
    if (pv === 'windup') {
      anim = 'bitef';
      f = fi(t, 19);
      if (f <= 1) {
        ex.sx = 1.1;
        ex.sy = 0.92;
      }
    } else if (pv === 'f6_lunge') {
      anim = 'lungef';
      f = fi(t, 19);
      if (f <= 2) {
        ex.sx = 1.08;
        ex.sy = 0.93;
      }
    } else if (pv === 'f6_leap') {
      anim = 'leapf';
      f = fi(t, 15);
      if (f <= 2) {
        ex.sx = 1.18 - f * 0.05;
        ex.sy = 0.82 + f * 0.05;
      }
    } else if (moving(m)) {
      anim = 'run';
      f = Math.floor((v.dist / 0.7) * 8) % 8;
    } else {
      anim = 'idle';
      f = Math.floor((now + hash(id, 7) * 3) * 8) % 12;
    }
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 12);
  } else if (md === 'f6_lunge') {
    anim = 'lunge';
    f = fi(t, 8);
    ex.ghost = LUNGE_GHOST;
  } else if (md === 'f6_slide') {
    anim = 'slide';
    f = fi(t, 9);
    ex.shadow = 6 * (1 - kf(f, 0.4));
  } else if (md === 'f6_swim') {
    anim = 'swim';
    f = Math.floor((now + hash(id, 5)) * 8) % 8;
    ex.shadow = 0;
  } else if (md === 'f6_rise') {
    anim = 'rise';
    f = fi(t, 17);
    ex.shadow = 0;
  } else if (md === 'f6_leap') {
    anim = 'leap';
    f = fi(t, 5);
    // Дуга прыжка: выше всего в середине.
    const k = clamp01(t / 0.24);
    ex.dy = -9 * Math.sin(PI * k);
    ex.shadow = 5;
    ex.ghost = LUNGE_GHOST;
  } else if (md === 'stun') {
    anim = 'flinch';
    f = fi(t, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(now * 1.1 + hash(id, 3) * 2) % 2;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else if (moving(m)) {
    anim = 'run';
    f = Math.floor((v.dist / 0.7) * 8) % 8;
  } else {
    anim = 'idle';
    f = Math.floor((now + hash(id, 7) * 3) * 8) % 12;
  }
  if (md !== 'dying') hurtFx(v, now, 1.5, ex);
  return { ...frameOf(SAL, anim, f, d, pose, () => salPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_salamander', function* () {
  yield* warmAll(
    SAL,
    [
      ['run', 8],
      ['idle', 12],
      ['bite', 11],
      ['bitef', 20],
      ['flinch', 5],
      ['die', 22],
      ['aim', 13],
      ['lunge', 9],
      ['lungef', 20],
      ['swim', 8],
      ['slide', 10],
      ['rise', 18],
      ['leap', 6],
      ['leapf', 16],
      ['alert', 9],
      ['sleep', 2],
    ],
    salPic,
  );
});
