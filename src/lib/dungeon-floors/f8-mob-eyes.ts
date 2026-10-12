// Этаж 8 — Глазастые сёдзи (анимации мобов 8). Прежний облик: красные
// глаза на бумаге сёдзи, длинные серо-лиловые руки с белыми когтями.
// Сторон нет — моб прибит к стене; глаза следят за героем (взгляд в ключе
// кадра, 9 положений зрачка), руки бьют туда, куда легла линия мозга (угол
// удара квантован на NB румбов нижней полуплоскости).
//
// Метроном мозга (`f8-brains.ts`, `f8_eyes`): `f8_hide` — его нет (кадр
// пуст; сразу после `f8_open` — руки втягиваются в дыры 0,2 с). `f8_peek`
// 0,75 с — глаза открываются по одному, бегают и сходятся на герое, за
// бумагой темнеют ладони (давят изнутри). `f8_thrust` 0,55 с — бумага
// лопается, руки вырываются, поднимаются над полом (замах) и бьют вдоль
// линии: кадр контакта — первый кадр `f8_open` (урон в конце 0,55).
// `f8_open` 1,1 с — когти в полу, скребут назад, пальцы дёргаются, руки
// поднимаются. Удар героя — глаза жмурятся, руки дёргаются; оглушение —
// зрачки кружат. Смерть — руки отдёргивает, глаза плачут тушью и
// закрываются по одному, бумага рвётся полосами и падает.
//
// Геометрия: якорь кадра — моб (у стены, на 0,35 клетки ниже основания
// стены); лицо стены — 16×16 над основанием (как у рисовальщика стены
// `shojiFace`: решётка через 5 по x и ряды 3/7/11 по y).

import type { Mob } from '../dungeon-sim';
import { Px } from '../dungeon-art';
import { paintSim, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  carry,
  clamp,
  draw,
  easeIn,
  easeOut,
  emptyFrame,
  F3,
  fi,
  frameOf,
  hash,
  hurtF,
  hx,
  INK,
  kindOf,
  lerp,
  mod,
  PI,
  Rig,
  sampleKeys,
  SE,
  seg2,
  smooth,
  sstep,
  TAU,
  tn,
  vadd,
  visOf,
  vmul,
  vnorm,
  vsub,
  warmAll,
  WHITE,
  type Mat,
  type PKey,
  type Pic,
  type PoseO,
  type V3,
} from './f8-mobkit';

// ---- Вид, геометрия ----------------------------------------------------------------------------

const K = kindOf('f8_eyes', 132, 96, 66, 34, 1100);

/** Основание стены — экранный y от якоря (мозг: удар из y − 0,35). */
const WALL_Y = -0.35 * 16;
/** Плоскость стены в осях рига (y рига = экранный y / SE на полу). */
const WY = WALL_Y / SE;
/** Левый верхний угол лица стены от якоря. */
const FX0 = -8;
const FY0 = -22;
/** Досягаемость когтей от основания стены, px (мозг: r = EYES.len + 0,35). */
const REACH = (3.2 + 0.35) * 16;

/** Румбы удара: угол линии мозга лежит в [0,25; π]. */
const NB = 12;
const A0 = 0.25;
const A1 = PI;
const angOf = (b: number) => A0 + (b / (NB - 1)) * (A1 - A0);
const binOf = (dir: number) => clamp(Math.round(((dir - A0) / (A1 - A0)) * (NB - 1)), 0, NB - 1);
/** Взгляд: 0 — прямо, 1…8 — восемь сторон. */
const lookOfAng = (a: number) => 1 + (((Math.round((a / TAU) * 8) % 8) + 8) % 8);
const lookVec = (l: number): [number, number] =>
  l <= 0 ? [0, 0] : [Math.cos(((l - 1) / 8) * TAU), Math.sin(((l - 1) / 8) * TAU)];

// ---- Палитра -----------------------------------------------------------------------------------

const PAPER = tn('#b09c70', '#d8c690', '#f0e2b0', '#fff6d8');
const SKIN = { T: tn('#2e2029', '#54404c', '#7e6272', '#a88a98') } as Mat;
const KNUCK = { T: tn('#3a2a34', '#644c5a', '#8e7282', '#b89aa8') } as Mat;
const CLAW = { T: tn('#6a6052', '#b8b0a0', '#ece4d4', '#ffffff'), spec: true } as Mat;
const LID = hx('#2a0c0a');
const SCLERA = hx('#f4ece0');
const SCLERA2 = hx('#d8ccc0');
const IRIS = hx('#c81a1a');
const IRIS2 = hx('#7a0c0c');
const VEIN = hx('#e05a5a');
const HOLE = hx('#0a0606');
const HOLE2 = hx('#24140f');
const SHADE = hx('#3a2228');
const GLOW = hx('#ff4a30');
const INKT = hx('#1a0c10');

/** Глаза на бумаге: [u, v, полуширина, полувысота, когда открывается (с)]. */
const EYES: [number, number, number, number, number][] = [
  [7.5, 5.2, 3.3, 1.9, 0.04],
  [2.4, 4.8, 1.8, 1.25, 0.14],
  [12.8, 4.6, 1.9, 1.3, 0.2],
  [1.9, 9.6, 1.4, 1.05, 0.28],
  [14.0, 9.8, 1.35, 1.0, 0.33],
];
/** Дыры рук (u, v) — по бокам нижнего ряда. */
const HOLES: [number, number][] = [
  [4.6, 9.6],
  [11.4, 9.6],
];
/** Куда глаза смотрят до того, как сойдутся на герое (бегают). */
const ROAM: [number, number][][] = [
  [
    [-1, 0],
    [0.7, -0.7],
  ],
  [
    [1, 0.3],
    [-0.6, 0.8],
  ],
  [
    [-0.8, -0.5],
    [1, 0],
  ],
  [
    [0.4, -1],
    [-1, 0.2],
  ],
  [
    [-1, 0.6],
    [0.5, 0.9],
  ],
];

const lattice = (u: number, v: number) =>
  u % 5 === 0 || v === 3 || v === 7 || v === 11 || v < 3 || v > 11;

// ---- Лицо стены: глаза, тени ладоней, дыры ------------------------------------------------------

interface Face {
  /** Раскрытие каждого глаза 0…1,3 (0 — щель). */
  open: number[];
  /** Взгляд каждого глаза. */
  look: [number, number][];
  /** Налитые кровью (жилки). */
  blood: number;
  /** Свет радужек поверх темноты. */
  glow: number;
  /** Тень ладоней за бумагой: сила и размер. */
  palm: number;
  palmK: number;
  /** Дыры: 0 — целая бумага, 1 — прорвана, больше — рвётся дальше. */
  hole: number;
  /** Тушь слёз: длина подтёков. */
  cry: number;
  /** Смерть: доля упавших полос бумаги. */
  fall: number;
  /** Зерно лоскутов. */
  seed: number;
}

const FACE0 = (): Face => ({
  open: EYES.map(() => 1),
  look: EYES.map(() => [0, 0] as [number, number]),
  blood: 0,
  glow: 1,
  palm: 0,
  palmK: 1,
  hole: 0,
  cry: 0,
  fall: 0,
  seed: 0,
});

const X = (u: number) => K.ax + FX0 + u;
const Y = (v: number) => K.ay + FY0 + v;

function eyeAt(
  p: Px,
  lit: (() => Px) | null,
  cx: number,
  cy: number,
  rw: number,
  rh: number,
  o: number,
  lk: [number, number],
  blood: number,
): void {
  if (o <= 0.02) return;
  const h = rh * Math.min(1.3, o);
  if (h < 0.6) {
    // Щель: веко сомкнуто.
    seg2(p, cx - rw + 0.3, cy, cx + rw - 0.7, cy, LID);
    return;
  }
  const ir = Math.max(0.85, rw * 0.42);
  const irh = Math.max(0.85, Math.min(h * 0.9, rh * 0.8));
  const ix = cx + lk[0] * Math.max(0.5, rw - ir) * 0.95;
  const iy = cy + lk[1] * Math.max(0.3, h - irh) * 0.9;
  const x0 = Math.floor(cx - rw - 1);
  const x1 = Math.ceil(cx + rw + 1);
  const y0 = Math.floor(cy - h - 1);
  const y1 = Math.ceil(cy + h + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rw;
      const dy = (y + 0.5 - cy) / h;
      const d = dx * dx + dy * dy;
      if (d > 1) {
        const ex = (x + 0.5 - cx) / (rw + 0.75);
        const ey = (y + 0.5 - cy) / (h + 0.75);
        if (ex * ex + ey * ey <= 1) p.set(x, y, LID);
        continue;
      }
      const qx = (x + 0.5 - ix) / ir;
      const qy = (y + 0.5 - iy) / irh;
      const q = qx * qx + qy * qy;
      if (q <= 1) {
        p.set(x, y, q > 0.55 ? IRIS2 : IRIS);
        if (lit) lit().set(x, y, alphaC(GLOW, q > 0.55 ? 0.55 : 0.9));
      } else p.set(x, y, dy < -0.35 ? SCLERA2 : SCLERA);
    }
  // Жилки — у уголков белка.
  if (blood > 0.3) {
    p.set(cx - rw + 0.6, cy, VEIN);
    p.set(cx + rw - 1.2, cy + (h > 1.2 ? 0.6 : 0), VEIN);
  }
  p.set(Math.floor(ix), Math.floor(iy), INK);
  if (ir >= 1.4) p.set(Math.floor(ix) - 1, Math.floor(iy) - 1, WHITE);
}

/** Тень ладони за бумагой — только по бумаге, решётка остаётся спереди. */
function palmShadow(p: Px, hu: number, hv: number, s: number, a: number): void {
  const c = alphaC(SHADE, a);
  const marks = new Set<number>();
  const mark = (u: number, v: number) => {
    const iu = Math.round(u);
    const iv = Math.round(v);
    if (iu < 0 || iu > 15 || iv < 0 || iv > 15 || lattice(iu, iv)) return;
    marks.add(iv * 16 + iu);
  };
  for (let v = -3; v <= 3; v += 0.5)
    for (let u = -3; u <= 3; u += 0.5) {
      const ex = u / (1.7 * s);
      const ey = (v - 0.4) / (1.4 * s);
      if (ex * ex + ey * ey <= 1) mark(hu + u, hv + v);
    }
  // Пальцы веером вверх и в стороны, большой — вбок.
  for (let i = 0; i < 5; i++) {
    const ang = i < 4 ? -PI / 2 + (i - 1.5) * 0.42 : hu < 8 ? 0.2 : PI - 0.2;
    const L = (i < 4 ? 3.1 : 2.2) * s;
    for (let k = 0.4; k <= L; k += 0.5)
      mark(hu + Math.cos(ang) * (1.2 * s + k), hv + Math.sin(ang) * (1 * s + k));
  }
  for (const m of marks) p.set(X(m % 16), Y(Math.floor(m / 16)), c);
}

/** Дыра: тёмная середина, рваный край, лоскуты бумаги отогнуты наружу. */
function holeAt(p: Px, hu: number, hv: number, size: number, seed: number): void {
  const R = 2.1 * size;
  for (let v = -4; v <= 4; v++)
    for (let u = -4; u <= 4; u++) {
      const a = Math.atan2(v, u);
      const rr = R * (0.82 + 0.3 * hash(Math.round(a * 3) + 9, seed + 3));
      const d = Math.hypot(u, v * 1.15);
      if (d <= rr) p.set(X(hu + u), Y(hv + v), d < rr - 1 ? HOLE : HOLE2);
    }
  // Лоскуты: светлые клинья наружу и к зрителю (вниз на экране).
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + hash(i, seed + 7) * 0.8;
    const r0 = R + 0.3;
    const L = 1 + hash(i, seed + 11) * 1.4 * size;
    for (let k = 0; k <= L; k += 0.5) {
      const x = hu + Math.cos(a) * (r0 + k);
      const y = hv + Math.sin(a) * (r0 + k) * 0.8 + k * 0.45;
      p.set(X(x), Y(y), k < L - 0.6 ? PAPER[3] : PAPER[1]);
    }
  }
}

function paintFace(p: Px, lit: (() => Px) | null, F: Face): void {
  if (F.palm > 0.02) for (const [hu, hv] of HOLES) palmShadow(p, hu, hv, F.palmK, F.palm);
  if (F.hole > 0) {
    for (let i = 0; i < HOLES.length; i++)
      holeAt(p, HOLES[i][0], HOLES[i][1], F.hole, F.seed + i * 5);
  }
  // Смерть: бумага рвётся полосами вниз — тёмные прорехи по панелям.
  if (F.fall > 0) {
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < 2; row++) {
        const k = clamp(F.fall * 1.6 - hash(col, row + 3) * 0.6, 0, 1);
        if (k <= 0) continue;
        const u0 = col * 5 + 1;
        const v0 = row * 4 + 4;
        const n = Math.round(k * 3);
        for (let v = v0; v < v0 + n; v++)
          for (let u = u0; u < u0 + 4; u++) p.set(X(u), Y(v), HOLE2);
      }
  }
  for (let i = 0; i < EYES.length; i++) {
    const [u, v, rw, rh] = EYES[i];
    eyeAt(p, F.glow > 0 ? lit : null, X(u), Y(v), rw, rh, F.open[i], F.look[i], F.blood);
    // Слёзы тушью — подтёки из нижнего века.
    if (F.cry > 0) {
      const L = F.cry * (2 + hash(i, 5) * 4);
      const sx = X(u) + (hash(i, 9) - 0.5) * rw;
      for (let k = 0; k < L; k++)
        p.set(sx, Y(v + rh + 0.5 + k), alphaC(INKT, 0.9 - (k / (L + 1)) * 0.5));
    }
  }
}

// ---- Руки ---------------------------------------------------------------------------------------

interface ArmO extends PoseO {
  /** Доля досягаемости (1 — когти на конце линии мозга). */
  k: number;
  /** Высота кисти над полом. */
  hz: number;
  /** Выгиб руки вверх. */
  ar: number;
  /** Выгиб руки наружу (локти в стороны, S-образно). */
  bw: number;
  /** Кисть отведена в сторону от линии, px. */
  wd: number;
  /** Разведены пальцы. */
  sp: number;
  /** Согнуты пальцы (1 — кулак / когти в полу). */
  cu: number;
  /** Кисть легла вдоль пола. */
  fl: number;
}
const ARM0: ArmO = { k: 0, hz: 8.5, ar: 2, bw: 0, wd: 0, sp: 0.3, cu: 0.6, fl: 0 };

// Удар 0,55 с: прорыв → руки расходятся в стороны и вверх, когти
// растопырены → замах (держит) → бросок вдоль линии; контакт — первый кадр
// `f8_open`.
const THRUST: PKey<ArmO>[] = carry<ArmO>([
  [0, { k: 0.02, hz: 8.5, ar: 1, bw: 0, wd: 0, sp: 0, cu: 1, fl: 0 }],
  [0.07, { k: 0.18, hz: 12, ar: 3, bw: 2, wd: 3, sp: 0.2, cu: 0.8 }, easeOut],
  [0.2, { k: 0.2, hz: 17, ar: 6, bw: 5, wd: 9, sp: 1, cu: 0.1 }, easeOut],
  [0.33, { k: 0.12, hz: 22, ar: 8, bw: 6, wd: 12, sp: 1.15, cu: 0.3 }, smooth],
  [0.42, { k: 0.1, hz: 23, ar: 8.5, bw: 6.5, wd: 12.5, sp: 1.2, cu: 0.35 }],
  [0.55, { k: 1, hz: 1, ar: 3, bw: 4.5, wd: 0, sp: 0.9, cu: 0.5, fl: 1 }, easeIn],
]);
// Открыт 1,1 с: отскок от удара, когти в полу, скребёт назад, дёргается,
// руки поднимаются.
const OPEN: PKey<ArmO>[] = carry<ArmO>([
  [0, { k: 1, hz: 1, ar: 3, bw: 4.5, wd: 0, sp: 0.9, cu: 0.5, fl: 1 }],
  [0.06, { k: 1.02, hz: 2.4, cu: 0.3 }, easeOut],
  [0.14, { k: 1, hz: 0.6, cu: 0.85, bw: 6 }, easeIn],
  [0.55, { k: 0.87, hz: 0.6, cu: 1, ar: 4, bw: 7 }, smooth],
  [0.9, { k: 0.85, hz: 1, cu: 0.75 }],
  [1.1, { k: 0.76, hz: 4, cu: 0.4, ar: 6, bw: 6, wd: 2, fl: 0.6 }, easeIn],
]);
// Втягивает руки в дыры (начало `f8_hide` после `f8_open`).
const BACK: PKey<ArmO>[] = carry<ArmO>([
  [0, { k: 0.76, hz: 4, ar: 6, bw: 6, wd: 2, sp: 0.4, cu: 0.4, fl: 0.6 }],
  [0.2, { k: 0.02, hz: 8.5, ar: 2, bw: 0, wd: 0, sp: 0, cu: 1, fl: 0 }, easeIn],
]);
// Смерть: руки отдёргивает судорогой в стороны и всасывает в стену.
const DIEARM: PKey<ArmO>[] = carry<ArmO>([
  [0, { k: 0.9, hz: 1.5, ar: 4, bw: 6.5, wd: 0, sp: 0.8, cu: 0.6, fl: 0.9 }],
  [0.08, { k: 0.6, hz: 9, ar: 8, bw: 7, wd: 9, sp: 1.35, cu: 0, fl: 0.4 }, easeOut],
  [0.27, { k: 0.02, hz: 8.5, ar: 2, bw: 0, wd: 0, sp: 0.2, cu: 1, fl: 0 }, easeIn],
]);

const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Точки руки `s` (−1 левая, +1 правая) в осях рига: S-образная кривая из дыры к кисти. */
function armPts(ang: number, o: ArmO, s: number) {
  const H: V3 = [s * 3.4, WY + 0.6, 8.5];
  const dist = clamp(o.k, 0, 1.1) * (REACH - 6);
  // Наружу от линии удара (экран): у правой руки — вправо от курса.
  const lx = s * Math.sin(ang);
  const ly = -s * Math.cos(ang);
  const off = 3 * Math.min(1, o.k * 3) + o.wd;
  const tx = Math.cos(ang) * dist + lx * off;
  const ty = WALL_Y + Math.sin(ang) * dist + ly * off + 2;
  const W: V3 = [tx, ty / SE, o.hz];
  const lat: V3 = [lx, ly / SE, 0];
  const C1 = vadd(vadd(H, vmul(vsub(W, H), 0.33)), vadd(vmul(lat, o.bw), [0, 1.5, o.ar]));
  const C2 = vadd(
    vadd(H, vmul(vsub(W, H), 0.66)),
    vadd(vmul(lat, -o.bw * 0.45), [0, 1, o.ar * 0.7]),
  );
  const bz = (t: number): V3 => {
    const a = (1 - t) ** 3;
    const b = 3 * (1 - t) ** 2 * t;
    const c = 3 * (1 - t) * t * t;
    const d = t ** 3;
    return [0, 1, 2].map((i) => a * H[i] + b * C1[i] + c * C2[i] + d * W[i]) as V3;
  };
  return { H, J1: bz(0.33), J2: bz(0.67), W };
}

function arm(r: Rig, ang: number, o: ArmO, s: number): V3 {
  const { H, J1, J2, W } = armPts(ang, o, s);
  r.cap(H, J1, 1.15, 1.0, SKIN);
  r.cap(J1, J2, 1.0, 0.9, SKIN);
  r.cap(J2, W, 0.9, 0.85, SKIN);
  r.ball(J1, 1.3, KNUCK);
  r.ball(J2, 1.05, KNUCK);
  // Кисть: вперёд — по руке, на полу — вдоль линии удара.
  const fwArm = vnorm(vsub(W, J2));
  const fl: V3 = vnorm([Math.cos(ang), Math.sin(ang) / SE, -0.15]);
  const fw = vnorm([
    lerp(fwArm[0], fl[0], o.fl),
    lerp(fwArm[1], fl[1], o.fl),
    lerp(fwArm[2], fl[2], o.fl),
  ]);
  const up0: V3 = [0, 0, 1];
  const sd = vnorm(cross(up0, fw));
  const up = cross(fw, sd);
  const P = new F3(W, fw, sd, up);
  r.ell(P, [1.2, 0, 0], [1.8, 1.7, 0.8], SKIN);
  for (let i = 0; i < 5; i++) {
    const th = i === 4;
    const side = th ? s * 1.9 : (i - 1.5) * 0.95;
    const spread = th ? s * (0.9 + o.sp * 0.4) : (i - 1.5) * 0.3 * o.sp;
    const base = P.p(th ? 0.6 : 2.6, side, 0);
    const c1 = o.cu * 0.75;
    const c2 = o.cu * 1.3;
    const d1: V3 = vnorm(P.v(Math.cos(spread) * Math.cos(c1), Math.sin(spread), -Math.sin(c1)));
    const L1 = th ? 1.6 : 2.2;
    const k1 = vadd(base, vmul(d1, L1));
    const d2: V3 = vnorm(P.v(Math.cos(spread) * Math.cos(c2), Math.sin(spread), -Math.sin(c2)));
    const k2 = vadd(k1, vmul(d2, th ? 1.2 : 1.8));
    r.cap(base, k1, 0.5, 0.45, SKIN);
    r.cap(k1, k2, 0.45, 0.4, SKIN);
    const c3 = o.cu * 1.7 + 0.25;
    const d3: V3 = vnorm(P.v(Math.cos(spread) * Math.cos(c3), Math.sin(spread), -Math.sin(c3)));
    r.spike(k2, d3, th ? 1.6 : 2.6, 0.5, CLAW, 3);
  }
  return W;
}

/** Тени рук на полу — в нижний слой (до рига). */
function armShadow(p: Px, ang: number, o: ArmO, s: number): void {
  const { H, J1, J2, W } = armPts(ang, o, s);
  const c = alphaC(INKT, 0.32);
  const fl = (v: V3): [number, number] => [K.ax + v[0], K.ay + v[1] * SE];
  const pts = [H, J1, J2, W].map(fl);
  for (let i = 1; i < pts.length; i++) {
    seg2(p, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c);
    seg2(p, pts[i - 1][0], pts[i - 1][1] + 1, pts[i][0], pts[i][1] + 1, c);
  }
}

// ---- Позы по кадрам -------------------------------------------------------------------------------

interface Shot {
  face: Face;
  arms: [ArmO, ArmO] | null;
  /** Шлейф броска: прошлые позы правой и левой руки. */
  trail: [ArmO, ArmO][];
  /** Лоскуты прорыва: возраст (с). */
  shreds: number;
  /** Борозды когтей на полу: доля. */
  scrape: number;
}

const tAt = (f: number) => (f + 0.5) / 24;

function lookFace(F: Face, l: number): void {
  const v = lookVec(l);
  for (let i = 0; i < EYES.length; i++) F.look[i] = v;
}

function shot(anim: string, f: number, d: number): Shot {
  const F = FACE0();
  const t = tAt(f);
  const out: Shot = { face: F, arms: null, trail: [], shreds: -1, scrape: 0 };
  const ang = angOf(d);
  const both = (keys: PKey<ArmO>[], tt: number, lag = 1 / 24): [ArmO, ArmO] => [
    sampleKeys(ARM0, keys, tt),
    sampleKeys(ARM0, keys, Math.max(0, tt - lag)),
  ];
  if (anim === 'peek') {
    // d — взгляд на героя (0…8). Глаза открываются по одному, бегают,
    // в 0,3 с сходятся на герое; с 0,45 — ладони давят изнутри, глаза щурятся.
    const v = lookVec(d);
    for (let i = 0; i < EYES.length; i++) {
      const o0 = easeOut((t - EYES[i][4]) / 0.1);
      const over = Math.sin(PI * clamp((t - EYES[i][4]) / 0.16, 0, 1)) * 0.25;
      const sq = sstep(0.5, 0.72, t) * 0.35;
      F.open[i] = t < EYES[i][4] ? 0.3 : o0 + over - sq;
      const r = ROAM[i][t < 0.18 ? 0 : 1];
      const lock = sstep(0.24, 0.32, t);
      F.look[i] = [lerp(r[0], v[0], lock), lerp(r[1], v[1], lock)];
    }
    F.palm = sstep(0.42, 0.72, t) * 0.62;
    F.palmK = 0.75 + sstep(0.42, 0.75, t) * 0.35;
    F.blood = sstep(0.4, 0.7, t);
    return out;
  }
  const L = lookOfAng(ang);
  if (anim === 'thrust') {
    lookFace(F, L);
    F.open = EYES.map(() => (t < 0.1 ? 1.25 : t < 0.42 ? 0.8 : 1.15));
    F.blood = 1;
    F.hole = 1 + easeOut(t / 0.08) * 0.15;
    F.seed = 1;
    out.arms = both(THRUST, t);
    out.shreds = t;
    if (t > 0.42) for (const lag of [0.03, 0.06]) out.trail.push(both(THRUST, t - lag));
    return out;
  }
  if (anim === 'open') {
    lookFace(F, L);
    F.open = EYES.map((_, i) => (t < 0.12 ? 1.3 : 1.05 + 0.08 * Math.sin(t * 9 + i)));
    F.blood = 1;
    F.hole = 1.15;
    F.seed = 1;
    const tw = sstep(0.5, 0.6, t) * (1 - sstep(0.85, 0.95, t));
    const [a, b] = both(OPEN, t, 1 / 24);
    a.cu += 0.18 * tw * Math.sin(t * TAU * 3.5);
    b.cu += 0.18 * tw * Math.sin(t * TAU * 3.5 + 2);
    out.arms = [a, b];
    out.scrape = sstep(0.14, 0.55, t);
    if (t < 0.08) out.shreds = 0.3 + t;
    return out;
  }
  if (anim === 'back') {
    lookFace(F, L);
    F.open = EYES.map(() => 1 - sstep(0.05, 0.2, t) * 0.7);
    F.hole = 1.15 - sstep(0.12, 0.2, t) * 0.4;
    F.seed = 1;
    F.glow = 0.5;
    out.arms = both(BACK, t, 1 / 48);
    return out;
  }
  if (anim === 'flinch') {
    // Удар героя: глаза жмурятся, руки подбрасывает.
    lookFace(F, L);
    const j = Math.sin(PI * clamp(t / 0.2, 0, 1));
    F.open = EYES.map(() => 1.05 - j * 0.95);
    F.blood = 1;
    F.hole = 1.15;
    F.seed = 1;
    const a = sampleKeys(ARM0, OPEN, 0.7);
    const b = { ...a };
    a.hz += j * 5;
    a.k -= j * 0.05;
    a.cu = 1 - j * 0.8;
    a.sp += j * 0.4;
    b.hz += j * 3.5;
    b.cu = 1 - j * 0.6;
    out.arms = [a, b];
    return out;
  }
  if (anim === 'stun') {
    // Оглушён: зрачки кружат вразнобой, пальцы обмякли.
    for (let i = 0; i < EYES.length; i++) {
      const a = (f / 6) * TAU + i * 1.3;
      F.look[i] = [Math.cos(a), Math.sin(a)];
    }
    F.open = EYES.map((_, i) => 0.75 + 0.2 * Math.sin(f + i));
    F.hole = 1.15;
    F.seed = 1;
    F.glow = 0.6;
    const a = { ...ARM0, k: 0.92, hz: 0.4, ar: 2.5, bw: 6.5, sp: 0.4, cu: 0.15, fl: 1 };
    out.arms = [a, { ...a, k: 0.9 }];
    return out;
  }
  if (anim === 'die') {
    // Руки всасывает (кадры 0…6, по румбу), глаза плачут тушью и закрываются
    // по одному, бумага рвётся полосами и падает.
    lookFace(F, L);
    F.seed = 1;
    F.hole = 1.15 + sstep(0.2, 0.6, t) * 0.5;
    F.blood = 1;
    F.glow = 1 - sstep(0.2, 0.5, t);
    F.open = EYES.map((_, i) => {
      const c0 = 0.18 + i * 0.07;
      return t < 0.1 ? 1.3 : 1.3 * (1 - sstep(c0, c0 + 0.1, t));
    });
    F.cry = sstep(0.12, 0.55, t);
    F.fall = sstep(0.35, 0.8, t);
    if (f < 7) out.arms = both(DIEARM, t, 1 / 48);
    return out;
  }
  // Бестиарий и прочее: открыт, руки на полу.
  lookFace(F, 0);
  F.hole = 1.15;
  F.seed = 1;
  out.arms = both(OPEN, 0.4);
  return out;
}

// ---- Кадр ---------------------------------------------------------------------------------------

function eyesPic(anim: string, f: number, d: number): Pic {
  const S = shot(anim, f, d);
  const ang = angOf(d);
  const under = new Px(K.w, K.h);
  let litPx: Px | null = null;
  const lit = () => (litPx ??= new Px(K.w, K.h));
  if (S.arms) for (let i = 0; i < 2; i++) armShadow(under, ang, S.arms[i], i ? 1 : -1);
  // Борозды когтей: от места удара назад к стене.
  if (S.scrape > 0 && S.arms) {
    const ux = Math.cos(ang);
    const uy = Math.sin(ang);
    for (let s = -1; s <= 1; s += 2)
      for (let c = -1; c <= 1; c++) {
        const tip = REACH - 1;
        const back = tip - S.scrape * 0.13 * REACH;
        const ox = s * 3 * Math.sin(ang) + c * 1.2 * -uy;
        const oy = -s * 3 * Math.cos(ang) + c * 1.2 * ux;
        seg2(
          under,
          K.ax + ux * back + ox,
          K.ay + WALL_Y + uy * back + oy + 2,
          K.ax + ux * tip + ox,
          K.ay + WALL_Y + uy * tip + oy + 2,
          alphaC(INKT, 0.55),
        );
      }
  }
  paintFace(under, lit, S.face);
  let pic: Pic;
  if (S.arms) {
    const r = new Rig();
    for (let i = 0; i < 2; i++) arm(r, ang, S.arms[i], i ? 1 : -1);
    pic = draw(K, r, (p, _lit, P) => {
      // Шлейф броска: путь кистей за 2 кадра.
      for (const tr of S.trail)
        for (let i = 0; i < 2; i++) {
          const a = armPts(ang, tr[i], i ? 1 : -1).W;
          const b = armPts(ang, S.arms![i], i ? 1 : -1).W;
          const [x0, y0] = P(a);
          const [x1, y1] = P(b);
          seg2(p, x0, y0, x1, y1, alphaC(hx('#d8c8e0'), 0.45));
        }
      // Лоскуты прорыва летят наружу и падают.
      if (S.shreds >= 0 && S.shreds < 0.4) {
        const age = S.shreds;
        for (let i = 0; i < 10; i++) {
          const [hu, hv] = HOLES[i & 1];
          const a = PI * 0.15 + hash(i, 21) * PI * 0.7 + (i & 1 ? -0.4 : 0.4);
          const v = 30 + hash(i, 23) * 40;
          const x = X(hu) + Math.cos(a) * v * age * (i & 1 ? 1 : -1) * 0.6;
          const y = Y(hv) + Math.sin(a) * v * age * 0.5 + 60 * age * age;
          const c = age > 0.3 ? alphaC(PAPER[2], 1 - (age - 0.3) / 0.1) : PAPER[i % 2 ? 3 : 2];
          p.set(x, y, c);
          if (i % 3 === 0) p.set(x + 1, y, alphaC(c, 0.7));
        }
      }
    });
    const P0 = pic.p.data;
    const U = under.data;
    if (litPx) {
      // Свет радужек, закрытый руками, гасим.
      const L0 = (litPx as Px).data;
      for (let i = 0; i < L0.length; i += 4) if (P0[i + 3] && L0[i + 3]) L0[i + 3] = 0;
      pic.lit = pic.lit ?? litPx;
    }
    // Лицо стены — под ригом.
    for (let i = 0; i < P0.length; i += 4) {
      if (P0[i + 3]) continue;
      P0[i] = U[i];
      P0[i + 1] = U[i + 1];
      P0[i + 2] = U[i + 2];
      P0[i + 3] = U[i + 3];
    }
  } else {
    pic = { p: under, lit: litPx, ax: K.ax, ay: K.ay, eye: null };
  }
  const open = S.face.open[0];
  pic.eye = S.face.glow > 0.5 && open > 0.6 ? [X(EYES[0][0]), Y(EYES[0][1])] : null;
  return pic;
}

// ---- Рисовальщик --------------------------------------------------------------------------------

const PEEK_N = 18;
const THRUST_N = 14;
const OPEN_N = 27;
const BACK_N = 5;
const DIE_N = 20;

/** Взгляд на героя из точки глаз (моб на 0,9 клетки ниже середины лица). */
function lookAt(m: Mob): number {
  const sim = paintSim();
  const h = sim?.hero;
  if (h && Number.isFinite(h.x) && Number.isFinite(h.y)) {
    const dx = h.x - m.x;
    const dy = h.y - (m.y - 0.9);
    if (Math.hypot(dx, dy) < 0.6) return 0;
    return lookOfAng(Math.atan2(dy, dx));
  }
  return lookOfAng(m.dir ?? PI / 2);
}

registerMobPainter('f8_eyes', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const v = visOf(m, pose, PI / 2, 99);
  const bin = binOf(m.dir ?? PI / 2);
  const ex: Partial<MobFrame> = { shadow: 0, still: true };
  let anim: string;
  let f: number;
  let d = bin;
  if (md === 'f8_hide') {
    if (v.prev !== 'f8_open' || t >= BACK_N / 24) return emptyFrame();
    anim = 'back';
    f = fi(t, BACK_N - 1);
  } else if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    if (f >= 7) d = 0;
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
  } else if (md === 'f8_peek') {
    anim = 'peek';
    f = fi(t, PEEK_N - 1);
    d = lookAt(m);
  } else if (md === 'f8_thrust') {
    anim = 'thrust';
    f = fi(t, THRUST_N - 1);
  } else if (md === 'f8_open') {
    const hf = hurtF(v, now);
    if (hf >= 0 && t > 0.15) {
      anim = 'flinch';
      f = hf;
    } else {
      anim = 'open';
      f = fi(t, OPEN_N - 1);
    }
  } else if (md === 'stun') {
    anim = 'stun';
    f = mod(now * 24, 6);
  } else {
    anim = 'show';
    f = 0;
    d = binOf(PI / 2);
  }
  return { ...frameOf(K, anim, f, d, pose, () => eyesPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_eyes', function* () {
  const bins = Array.from({ length: NB }, (_, i) => i);
  yield* warmAll(K, [['peek', PEEK_N]], eyesPic, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  yield* warmAll(
    K,
    [
      ['thrust', THRUST_N],
      ['open', OPEN_N],
      ['back', BACK_N],
      ['flinch', 5],
      ['stun', 6],
      ['die', 7],
    ],
    eyesPic,
    bins,
  );
  yield* warmAll(K, [['die', DIE_N]], eyesPic, [0]);
});
