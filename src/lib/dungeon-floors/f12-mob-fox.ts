// Этаж 12 — Песец-оборотень и Песец с мешком (анимации мобов 12). Один
// рисовальщик, два вида и три шкуры (песец, оборотень, рыжий с мешком).
//
// Мозг `f12_fox` (`f12-brains.ts`): `f12_hide` — в сугробе (видны уши и
// глаза); герой ближе 4,2 — `f12_leap` 0,6 с (дуга на место героя, урон в
// 0,6 при касании) → `chase` (кадр 0 приземления — урон); рядом —
// `f12_wind`: первый укус через 0,32 с, следующие через 0,2 (`m.t` с нуля,
// `data.bites` растёт), всего 2 (оборотень — 3) → `recover` 0,5; после двух
// серий — `f12_burrow` (бежит к сугробу, роет `data.dug` до 1,4 с) →
// `f12_hide`. Ниже половины здоровья — `data.were` (крупнее, тёмный, вой).
// Мозг `f12_sackfox`: `flee` зигзагом 14 с → `escape` 0,4 с (мир убирает).
//
// Кадры (24 к/с от `pose.t`, 8 честных сторон): покой 12 (8 к/с, фаза от id),
// галоп 8 по пройденному пути, засада 16 (8 к/с: уши дёргаются, моргает,
// парок из носа), прыжок 15 (рывок из снега, полёт струной, пасть в конце),
// приземление 8 (кадр 0 — урон: прижал лапами, хватка, трёпка), первый
// укус 8 (сжался, оскал, бросок), следующий 5 (кадр 0 — урон, рвёт,
// сжимается, бросок), отход 12 (кадр 0 — урон, трёпка, юз, облизнулся),
// рытьё 34 (по `data.dug`: гребёт, снег из-под задних, ушёл под снег,
// голова вынырнула), вздрог 5, смерть 19 (взвизг, на бок, лапы дёргаются,
// `linger`). Оборотень — те же позы своей шкурой; миг превращения —
// вздутие и тёмный след без новых кадров. Песец с мешком: галоп 8, покой 12,
// нырок в снег 10, смерть 19 (мешок слетает, монеты).

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { bez, hash, hx, ramp, SNOW, TAU, WHITE } from './f12-rig';
import {
  clamp01,
  dirOf,
  easeBack,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  limb,
  paintMob,
  pitchParts,
  PI,
  puff,
  rollParts,
  speedOf,
  sstep,
  stepPh,
  tf,
  trk,
  visOf,
  warmAll,
  yawParts,
} from './f12-mobkit';
import type { Build, Kind, Part, RGBA, Scr, V3 } from './f12-mobkit';

// ---------------------------------------------------------------------------
// Шкуры.
// ---------------------------------------------------------------------------

const FUR = ramp('#46567a', '#7686a4', '#a8b6cc', '#d2dce8', '#f2f6fc');
const FUR_T = ramp('#3c4a6a', '#647496', '#8e9ebe', '#bccade', '#e2eaf4');
const WERE = ramp('#1a2034', '#2e3a58', '#4a5a80', '#7486aa', '#a8b8d4');
const WERE_HI = ramp('#2a3450', '#44547a', '#6a7ca4', '#98aacc', '#c8d6ee');
const RED = ramp('#3a1408', '#6a2a10', '#a4461c', '#d0702e', '#f0a050');
const RED_LEG = ramp('#140804', '#26100a', '#3c1c10', '#58301a', '#784626');
const CREAM = ramp('#6a5a48', '#9a8a70', '#c8b898', '#e6dcc4', '#fff6e4');
const SACK = ramp('#3a2a18', '#5e4628', '#86683c', '#ac8c58', '#d0b47c');
const DARK = ramp('#05060a', '#0e1018', '#1a1c26', '#2a2c36', '#3c3e48');
const GOLD_A = hx('#ffe08a');
const GOLD_B = hx('#ffc23a');
const GOLD_C = hx('#c88a1a');
const MIST: RGBA[] = [hx('#e6f2ff', 200), hx('#cad8ee', 150), hx('#e6f2ff', 110)];

interface Coat {
  s: number;
  fur: RGBA[];
  leg: RGBA[];
  chest: RGBA[];
  tip: RGBA[];
  tail: RGBA[];
  eye: RGBA;
  were: boolean;
  sack: boolean;
}
const ARCTIC: Coat = {
  s: 1,
  fur: FUR,
  leg: FUR_T,
  chest: FUR,
  tip: FUR,
  tail: FUR_T,
  eye: hx('#ffb84a'),
  were: false,
  sack: false,
};
const WEREC: Coat = {
  s: 1.15,
  fur: WERE,
  leg: WERE,
  chest: WERE_HI,
  tip: WERE_HI,
  tail: WERE,
  eye: hx('#ff5a3a'),
  were: true,
  sack: false,
};
const REDC: Coat = {
  s: 1,
  fur: RED,
  leg: RED_LEG,
  chest: CREAM,
  tip: CREAM,
  tail: RED,
  eye: hx('#ffd060'),
  were: false,
  sack: true,
};

const KF = kindOf('f12_fox', { w: 44, h: 46, ox: 22, oy: 30 }, 2500);
const KS = kindOf('f12_sackfox', { w: 40, h: 44, ox: 20, oy: 30 }, 450);

// ---------------------------------------------------------------------------
// Поза и модель.
// ---------------------------------------------------------------------------

/** Поза песца: отклонения от стойки. */
interface FoxO {
  /** Высота корпуса (+ выше). */
  z: number;
  /** Хребет: −1 сжат … +1 вытянут. */
  st: number;
  /** Наклон всей модели носом вверх, рад; крен (π/2 — на боку). */
  pitch: number;
  roll: number;
  /** Голова: вперёд, вверх, поворот, кивок (+ вверх). */
  hx: number;
  hz: number;
  hyaw: number;
  hp: number;
  /** Пасть 0…1. */
  jaw: number;
  /** Уши: 0 торчком … 1 прижаты. */
  earL: number;
  earR: number;
  /** Хвост: вверх (−0,3 поджат … 1,2 трубой) и вбок. */
  tailUp: number;
  tailSide: number;
  /** Лапы: передняя левая, правая, задняя левая, правая — [вперёд, вверх]. */
  feet: [number, number][];
  /** Ушёл в снег, единиц модели (всё ниже кромки срезано). */
  sink: number;
  breath: number;
  shut?: boolean;
  /** Загривок оборотня дыбом 0…1. */
  hack?: number;
  /** Снег: [доля разлёта, x модели, куда (рад), разброс]. */
  snow?: [number, number, number, number];
  /** Парок из носа 0…1. */
  mist?: number;
  /** Мешок отстаёт: вверх-вниз и вперёд-назад. */
  sackZ?: number;
  sackX?: number;
  /** Мешок слетел (0…1) и монеты разлетелись (0…1). */
  sackOff?: number;
  coins?: number;
}

const FEET0: [number, number][] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
const O0: FoxO = {
  z: 0,
  st: 0,
  pitch: 0,
  roll: 0,
  hx: 0,
  hz: 0,
  hyaw: 0,
  hp: 0,
  jaw: 0,
  earL: 0,
  earR: 0,
  tailUp: 0.3,
  tailSide: 0,
  feet: FEET0,
  sink: 0,
  breath: 0,
};
const CLIP = 0.3;

function foxBuild(o: FoxO, c: Coat): Build {
  const s = c.s;
  const parts: Part[] = [];
  const Lz = (6 + o.z) * s - o.sink;
  const L = 4.4 * s * (1 + 0.2 * o.st);
  const br = 1 + 0.045 * o.breath;
  // Корпус и грудь (одна шерсть, без шва; у рыжего — светлая манишка).
  parts.push({
    x: -0.8 * s,
    y: 0,
    z: Lz,
    rx: L,
    ry: 2.4 * s * br,
    rz: 2.2 * s * (1 - 0.1 * o.st) * br,
    ramp: c.fur,
    fur: 0.14,
    id: 1,
  });
  const cx = L * 0.66;
  const cz = Lz + 0.6 * s;
  parts.push({
    x: cx,
    y: 0,
    z: cz,
    rx: 2.5 * s,
    ry: 2.4 * s * br,
    rz: 2.6 * s,
    ramp: c.chest,
    fur: 0.1,
    id: 1,
  });
  // Загривок оборотня — гребень прядей вдоль спины.
  if (c.were) {
    const hk = o.hack ?? 0;
    for (let k = 0; k < 5; k++)
      parts.push({
        x: cx - 0.6 * s - k * 1.6 * s,
        y: 0,
        z: Lz + (2.1 + hk * 0.5) * s - k * 0.12,
        rx: 0.7,
        ry: 0.55,
        rz: 1.2 + hk * 0.6 - k * 0.1,
        ramp: c.fur,
        pitch: -0.55 + hk * 0.35,
        id: 1,
      });
  }
  // Лапы: бедро у тела, стопа — от стойки. Локоть передних — назад,
  // скакательный сустав задних — назад и ниже.
  const fx = cx - 0.2 * s;
  const bx = -L * 0.72;
  for (let k = 0; k < 4; k++) {
    const front = k < 2;
    const y = (k % 2 ? 1.35 : -1.35) * s;
    const [dx, dz] = o.feet[k];
    const hip: V3 = [front ? fx : bx, y, front ? cz - 1.6 * s : Lz - 0.5 * s];
    const foot: V3 = [
      (front ? fx + 0.3 * s : bx + 0.3 * s) + dx * s,
      y * 1.05,
      0.65 * s - o.sink + dz * s,
    ];
    const knee: V3 = [
      (hip[0] + foot[0]) / 2 - (front ? 0.35 : 1.0) * s,
      y * 1.08,
      (hip[2] + foot[2]) / 2 - (front ? 0 : 0.3 * s),
    ];
    limb(parts, hip, knee, foot, 0.95 * s, 0.62 * s, c.leg, 20 + k, 2);
  }
  // Хвост — пушистая дуга назад, кончик своей краской.
  const t0: V3 = [-L - 0.2 * s, 0, Lz + 0.8 * s];
  const t1: V3 = [-L - 2.6 * s, o.tailSide * 0.7 * s, Lz + (1.6 + o.tailUp * 2) * s];
  const t2: V3 = [-L - 5.2 * s, o.tailSide * 1.7 * s, Lz + (0.2 + o.tailUp * 3.4) * s];
  const tl = bez(t0, t1, t2, 6);
  tl.forEach((pt, i) => {
    const k = i / (tl.length - 1);
    const r = (0.55 + Math.sin(k * PI * 0.85 + 0.15) * 1.6) * s;
    parts.push({
      x: pt[0],
      y: pt[1],
      z: pt[2],
      rx: r,
      ry: r,
      rz: r,
      ramp: i >= tl.length - 2 ? c.tip : c.tail,
      fur: 0.16,
      id: 30,
    });
  });
  // Мешок на спине: отстаёт от корпуса, перевязан горловиной вперёд.
  const sk = c.sack ? 1 - (o.sackOff ?? 0) : 0;
  const sackPt = { x: -0.9 + (o.sackX ?? 0), y: 0, z: Lz + 3.3 * s + (o.sackZ ?? 0) };
  if (sk > 0) {
    parts.push({
      x: sackPt.x,
      y: 0,
      z: sackPt.z,
      rx: 3.1,
      ry: 2.9,
      rz: 2.7,
      ramp: SACK,
      fur: 0.08,
      id: 40,
    });
    parts.push({
      x: sackPt.x + 1.9,
      y: 0,
      z: sackPt.z + 2.1,
      rx: 1.2,
      ry: 1.1,
      rz: 0.9,
      ramp: SACK,
      pitch: 0.4,
      id: 41,
    });
  }
  // Голова — своей группой (кивок и поворот у шеи).
  const h0 = parts.length;
  const hx2 = cx + 2.1 * s + o.hx;
  const hz2 = cz + 2.9 * s + o.hz;
  parts.push({
    x: hx2,
    y: 0,
    z: hz2,
    rx: 2.3 * s,
    ry: 2.25 * s,
    rz: 2.05 * s,
    ramp: c.fur,
    fur: 0.08,
    id: 50,
  });
  // Пушистые щёки.
  parts.push({
    x: hx2 - 0.5 * s,
    y: 0,
    z: hz2 - 0.9 * s,
    rx: 1.6 * s,
    ry: 2.6 * s,
    rz: 1.5 * s,
    ramp: c.chest,
    fur: 0.12,
    id: 50,
  });
  const j = o.jaw;
  parts.push({
    x: hx2 + 2.5 * s,
    y: 0,
    z: hz2 - 0.5 * s + j * 0.35,
    rx: 2.1 * s,
    ry: 0.95 * s,
    rz: 0.8 * s,
    ramp: c.fur,
    pitch: j * 0.3,
    id: 51,
  });
  parts.push({
    x: hx2 + 2.1 * s,
    y: 0,
    z: hz2 - 1.25 * s - j * 0.75,
    rx: 1.75 * s,
    ry: 0.8 * s,
    rz: 0.5 * s,
    ramp: c.chest,
    pitch: -j * 0.5,
    id: 52,
  });
  parts.push({
    x: hx2 + 4.4 * s,
    y: 0,
    z: hz2 - 0.35 * s + j * 0.55,
    rx: 0.55,
    ry: 0.6,
    rz: 0.5,
    ramp: DARK,
    id: 53,
  });
  for (const [e, ek] of [
    [-1, o.earL],
    [1, o.earR],
  ] as const)
    parts.push({
      x: hx2 - 0.5 * s - ek * 0.9,
      y: e * 1.25 * s,
      z: hz2 + 2.2 * s - ek * 0.9,
      rx: 0.85 * s,
      ry: 0.7 * s,
      rz: 2 * s * (1 - ek * 0.3),
      ramp: c.fur,
      pitch: -ek * 1.0,
      roll: e * 0.25,
      id: 54,
    });
  // Точки, что едут с головой: глаза, клыки сверху и снизу, нос.
  const pts = [
    { x: hx2 + 1.2 * s, y: -1.1 * s, z: hz2 + 0.6 * s },
    { x: hx2 + 1.2 * s, y: 1.1 * s, z: hz2 + 0.6 * s },
    { x: hx2 + 3.6 * s, y: 0, z: hz2 - 1.0 * s + j * 0.2 },
    { x: hx2 + 3.3 * s, y: 0, z: hz2 - 1.2 * s - j * 1.1 },
    { x: hx2 + 4.8 * s, y: 0, z: hz2 - 0.4 * s + j * 0.55 },
  ];
  pitchParts(parts, o.hp, hx2 - 1.4 * s, hz2 - 1 * s, h0);
  pitchParts(pts, o.hp, hx2 - 1.4 * s, hz2 - 1 * s);
  yawParts(parts, o.hyaw, hx2 - 1.6 * s, h0);
  yawParts(pts, o.hyaw, hx2 - 1.6 * s);
  pitchParts(parts, o.pitch, -0.6 * s, Lz);
  pitchParts(pts, o.pitch, -0.6 * s, Lz);
  pitchParts([sackPt], o.pitch, -0.6 * s, Lz);
  rollParts(parts, o.roll, Lz);
  rollParts(pts, o.roll, Lz);
  const clip = o.sink > 0 ? CLIP : undefined;
  const ec = o.shut ? c.fur[1] : c.eye;
  const eyes = [pts[0], pts[1]]
    .filter((e) => clip === undefined || e.z > clip + 0.2)
    .map((e) => ({ ...e, c: ec }));
  const fangT = pts[2];
  const fangL = pts[3];
  const nose = pts[4];
  const sn = o.snow;
  const mist = o.mist ?? -1;
  const coins = c.sack ? (o.coins ?? 0) : 0;
  return {
    parts,
    eyes,
    clip,
    post: (p, scr) => {
      const up = Math.abs(o.roll) < 1;
      if (up && (j > 0.3 || c.were) && (clip === undefined || fangT.z > clip)) {
        // Клыки: белый сверху, у оборотня — всегда; снизу — когда пасть открыта.
        const [x, y] = scr(fangT.x, fangT.y, fangT.z);
        p.set(x, y, WHITE);
        if (j > 0.45) {
          const [x2, y2] = scr(fangL.x, fangL.y, fangL.z);
          p.set(x2, y2, WHITE);
        }
      }
      if (sn) puff(p, scr, sn[1], 0, sn[0], 9, 6 * s, 11, SNOW, sn[2], sn[3]);
      if (mist >= 0) mistOf(p, scr, nose.x, nose.z, mist);
      if (sk >= 1) {
        // Монеты блестят из горловины.
        const [x, y] = scr(sackPt.x + 2.6, 0, sackPt.z + 2.6);
        p.set(x, y, GOLD_A);
        p.set(x + 1, y + 1, GOLD_B);
      }
      if (coins > 0) coinsOf(p, scr, coins, Lz);
    },
  };
}

/** Парок из носа: три светлые точки уходят вверх и тают. */
function mistOf(p: Px, scr: Scr, x: number, z: number, k: number): void {
  for (let i = 0; i < 3; i++) {
    const q = k - i * 0.18;
    if (q < 0 || q > 1) continue;
    const [sx, sy] = scr(x + 0.6 + q * 1.5, (i - 1) * 0.6, z + 0.6 + q * 3);
    p.set(sx, sy, MIST[i]);
  }
}

/** Монеты из слетевшего мешка: дугой в стороны, ложатся на лёд. */
function coinsOf(p: Px, scr: Scr, k: number, z0: number): void {
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + hash(i, 3, 77) * 0.6;
    const r = (2 + hash(i, 5, 77) * 5) * k;
    const h = Math.max(0, z0 + 2 + Math.sin(k * PI) * 5 - k * (z0 + 2));
    const [x, y] = scr(Math.cos(a) * r - 1, Math.sin(a) * r, h);
    p.set(x, y, i % 3 === 0 ? GOLD_A : i % 3 === 1 ? GOLD_B : GOLD_C);
  }
}

// ---------------------------------------------------------------------------
// Дорожки.
// ---------------------------------------------------------------------------

/**
 * Галоп (8 на шаг): [вперёд передних, вверх передних, вперёд задних,
 * вверх задних, хребет, высота, наклон]. Вытянут в полёте — передние
 * приземлились — под собой — толчок передними — сгруппирован — задние
 * приземлились — толчок задними — вытягивается.
 */
const RUN: number[][] = [
  [2.6, 1.0, -2.6, 0.8, 0.6, 0.8, 0],
  [1.8, 0.1, -1.8, 1.2, 0.35, 0.35, -0.08],
  [0.4, 0, -0.4, 1.4, -0.1, 0, -0.07],
  [-1.2, 0.1, 1.2, 0.8, -0.5, -0.2, -0.02],
  [-0.8, 1.2, 1.9, 0.2, -0.65, -0.05, 0.06],
  [0.4, 1.6, 0.8, 0, -0.35, 0.2, 0.12],
  [1.4, 1.5, -0.8, 0, 0.1, 0.45, 0.1],
  [2.2, 1.3, -2, 0.4, 0.45, 0.7, 0.04],
];
function runPose(f: number): FoxO {
  const a = RUN[f];
  const lag = RUN[(f + 7) % 8];
  // Правая пара отстаёт на треть кадра: галоп, а не «козлик».
  const r = (i: number) => lerp(a[i], lag[i], 0.35);
  return {
    ...O0,
    st: a[4],
    z: a[5],
    pitch: a[6],
    feet: [
      [a[0], a[1]],
      [r(0), r(1)],
      [a[2], a[3]],
      [r(2), r(3)],
    ],
    // Голова держит горизонт; уши и хвост — на кадр позже корпуса.
    hz: -(lag[5] - 0.3) * 0.45,
    hp: -a[6] * 0.7,
    earL: 0.35 + lag[5] * 0.15,
    earR: 0.35 + lag[5] * 0.15,
    tailUp: 0.35 - lag[5] * 0.35,
    tailSide: Math.sin((f / 8) * TAU) * 0.25,
    sackZ: -(lag[5] - 0.3) * 1.1,
    sackX: -lag[6] * 3,
  };
}

/** Кадр контакта укуса: вытянут, голова в цели, пасть сомкнута. */
const BITE: FoxO = {
  ...O0,
  st: 0.7,
  z: -0.1,
  pitch: -0.12,
  hx: 2.4,
  hz: -0.8,
  hp: -0.25,
  jaw: 0,
  earL: 1,
  earR: 1,
  tailUp: 0.7,
  feet: [
    [2, 0],
    [1.6, 0],
    [-1.6, 0],
    [-1.4, 0],
  ],
  hack: 1,
};

/** Покой стоя (12 кадров по 8 к/с). */
function idlePose(f: number): FoxO {
  const ph = (f / 12) * TAU;
  const sniff = f === 2 || f === 3 ? 0.35 : 0;
  return {
    ...O0,
    breath: Math.sin(ph),
    z: Math.sin(ph) * 0.1,
    hx: sniff,
    hz: -sniff * 0.4,
    hyaw: trk(f, [
      [0, 0],
      [5, 0],
      [6, 0.45],
      [8.5, 0.45],
      [10, 0],
    ]),
    earL: f === 3 ? 0.55 : f === 4 ? 0.15 : 0,
    earR: f === 9 ? 0.45 : 0,
    tailSide: Math.sin(ph + 1) * 0.7,
    tailUp: 0.25 + Math.sin(ph) * 0.1,
  };
}

const HIDE: FoxO = { ...O0, z: -1.5, hz: 1.2, hp: 0.1, sink: 8.8, tailUp: 0 };

function pose(anim: string, f: number): FoxO {
  switch (anim) {
    case 'idle':
      return idlePose(f);
    case 'run':
      return runPose(f);
    case 'hide': {
      // 16 кадров по 8 к/с: уши дёргаются, оглядывается, моргает, парок.
      const look = trk(f, [
        [0, 0],
        [7, 0],
        [8, 0.3],
        [10, 0.3],
        [11, 0],
      ]);
      return {
        ...HIDE,
        hyaw: look,
        earL: f === 4 ? 0.6 : f === 5 ? 0.2 : 0,
        earR: f === 11 ? 0.5 : f === 14 ? 0.3 : 0,
        shut: f === 6,
        mist: f >= 12 ? (f - 12 + 0.5) / 4 : undefined,
      };
    }
    case 'leap': {
      // 0,6 с: рывок из сугроба, полёт струной (передние вперёд, задние
      // назад, хвост рулём), к концу нос вниз и пасть настежь.
      const k = tf(f) / 0.6;
      const em = easeOut(clamp01((f + 0.5) / 3));
      return {
        ...O0,
        sink: (1 - em) * HIDE.sink,
        z: lerp(HIDE.z, 0, em),
        pitch: trk(k, [
          [0, 0.55],
          [0.2, 0.45],
          [0.5, 0],
          [0.8, -0.45],
          [1, -0.6],
        ]),
        st: trk(k, [
          [0, -0.3],
          [0.15, 0.6],
          [0.8, 0.8],
          [1, 0.5],
        ]),
        feet: [
          [
            trk(k, [
              [0, -0.5],
              [0.2, 2.6],
              [0.8, 2.8],
              [1, 2.2],
            ]),
            1.5,
          ],
          [
            trk(k, [
              [0, -0.6],
              [0.22, 2.4],
              [0.8, 2.6],
              [1, 2],
            ]),
            1.3,
          ],
          [
            trk(k, [
              [0, 0.6],
              [0.15, -2.6],
              [0.6, -2.4],
              [1, -1],
            ]),
            0.8,
          ],
          [
            trk(k, [
              [0, 0.5],
              [0.17, -2.4],
              [0.6, -2.2],
              [1, -0.9],
            ]),
            0.7,
          ],
        ],
        earL: trk(k, [
          [0, 0.2],
          [0.2, 1],
        ]),
        earR: trk(k, [
          [0, 0.2],
          [0.22, 1],
        ]),
        jaw: trk(k, [
          [0, 0],
          [0.6, 0],
          [0.8, 0.9],
          [1, 1],
        ]),
        hx: trk(k, [
          [0, 0],
          [0.6, 0.4],
          [1, 1.2],
        ]),
        hz: trk(k, [
          [0, HIDE.hz],
          [0.2, 0],
          [1, -0.8],
        ]),
        tailUp: trk(k, [
          [0, 0.8],
          [0.3, 0.4],
          [0.7, 0.2],
          [1, 0.9],
        ]),
        hack: 1,
        snow: f < 4 ? [(f + 0.5) / 4, 0, 0, TAU] : undefined,
      };
    }
    case 'land': {
      // Кадр 0 — урон: прижал лапами, морда в цели; трёпка, встаёт.
      const shake = [0, 0.35, -0.3, 0.15, 0, 0, 0, 0][f];
      const k = [1, 1, 0.9, 0.65, 0.4, 0.2, 0.08, 0][f];
      return {
        ...O0,
        st: -0.35 * k,
        z: -0.8 * k,
        pitch: -0.25 * k,
        hx: 1.6 * k,
        hz: -1.6 * k,
        hp: -0.4 * k,
        hyaw: shake,
        jaw: f < 3 ? 0 : f === 4 ? 0.25 : 0,
        earL: 0.8 * k,
        earR: 0.8 * k,
        tailUp: 0.3 + 0.9 * k,
        tailSide: -shake * 0.8,
        feet: [
          [2.4 * k, 0],
          [2.2 * k, 0],
          [-0.5 * k, 0],
          [-0.4 * k, 0],
        ],
        hack: k,
        snow: f < 3 ? [(f + 0.6) / 3.5, 3, 0, TAU] : undefined,
      };
    }
    case 'bite1': {
      // 0,32 с: сжался на задних, голова назад и вниз, уши прижаты, оскал
      // растёт; на пике держит; последние два кадра — бросок.
      const k = tf(f) / 0.32;
      const coil = trk(k, [
        [0, 0],
        [0.35, 1, easeOut],
        [0.72, 1.08],
        [0.86, 0.5],
        [1, -0.3],
      ]);
      const go = sstep(0.75, 1, k);
      return {
        ...O0,
        z: -0.7 * coil,
        st: -0.45 * coil + 0.7 * go,
        pitch: 0.06 * coil - 0.1 * go,
        hx: -1.1 * coil + 2 * go,
        hz: -0.5 * coil - 0.4 * go,
        hp: -0.15 * coil,
        jaw: trk(k, [
          [0, 0],
          [0.3, 0.25],
          [0.7, 0.55],
          [0.86, 1],
        ]),
        earL: clamp01(k * 3),
        earR: clamp01(k * 3 - 0.15),
        tailUp: 0.15 - 0.25 * coil + 0.6 * go,
        tailSide: [0, 0.35, -0.35, 0.25, -0.2, 0.1, 0, 0][f],
        feet: [
          [0.8 * coil + 1.2 * go, 0.5 * go],
          [0.7 * coil + 1 * go, 0.4 * go],
          [0.9 * coil - 1.2 * go, 0],
          [0.8 * coil - 1 * go, 0],
        ],
        hack: clamp01(k * 2),
      };
    }
    case 'biteN': {
      // 0,2 с: кадр 0 — урон, рвёт вбок, сжимается, бросок.
      const P: FoxO[] = [
        BITE,
        { ...BITE, hyaw: 0.35, hx: 2, jaw: 0.05, tailSide: -0.4 },
        {
          ...O0,
          hx: 0,
          hz: -0.4,
          jaw: 0.4,
          st: 0,
          z: -0.5,
          earL: 1,
          earR: 1,
          tailUp: 0.4,
          hack: 1,
          feet: [
            [1, 0],
            [0.8, 0],
            [0, 0],
            [0, 0],
          ],
        },
        {
          ...O0,
          hx: -0.8,
          hz: -0.5,
          jaw: 0.75,
          st: -0.35,
          z: -0.65,
          earL: 1,
          earR: 1,
          tailUp: 0.1,
          hack: 1,
          feet: [
            [1.1, 0],
            [0.9, 0],
            [0.7, 0],
            [0.6, 0],
          ],
        },
        {
          ...O0,
          hx: 1.6,
          hz: -0.5,
          jaw: 1,
          st: 0.45,
          z: -0.2,
          pitch: -0.08,
          earL: 1,
          earR: 1,
          tailUp: 0.5,
          hack: 1,
          feet: [
            [1.8, 0.5],
            [1.5, 0.4],
            [-1, 0],
            [-0.8, 0],
          ],
        },
      ];
      return P[f];
    }
    case 'rec': {
      // 0,5 с: кадр 0 — урон; трёпка, отпускает, юз по льду, встаёт,
      // облизнулся.
      if (f === 0) return BITE;
      if (f <= 3) {
        const sh = [0, -0.35, 0.25, -0.1][f];
        return { ...BITE, hyaw: sh, jaw: f === 3 ? 0.3 : 0.05, hx: 2.2 - f * 0.3, tailSide: -sh };
      }
      const k = sstep(3, 10, f);
      const back = Math.sin(clamp01((f - 3) / 4) * PI);
      return {
        ...O0,
        st: lerp(0.5, 0, k),
        z: -0.4 * (1 - k) - 0.2 * back,
        hx: lerp(1.3, 0, k) - 0.5 * back,
        hz: lerp(-0.4, 0, k) + 0.4 * back,
        hp: 0.2 * back,
        jaw: f === 8 ? 0.3 : f === 9 ? 0.15 : 0,
        earL: lerp(0.9, 0, k),
        earR: lerp(0.9, 0.1, k),
        tailUp: lerp(0.7, 0.3, k),
        tailSide: Math.sin(f * 1.4) * 0.4 * (1 - k),
        feet: [
          [lerp(1.8, 0, k), 0],
          [lerp(1.5, 0, k), 0],
          [lerp(-1.2, 0, k), 0],
          [lerp(-1, 0, k), 0],
        ],
        hack: 1 - k,
      };
    }
    case 'dig': {
      // По `data.dug` (с): нос в снег, передние гребут попеременно, снег
      // летит из-под задних; ушёл под снег; голова вынырнула — засада.
      const d = tf(f);
      if (d >= 1.15) {
        const k = sstep(1.15, 1.4, d);
        return { ...HIDE, sink: lerp(14, HIDE.sink, k), earL: 1 - k, earR: 1 - k };
      }
      const pf = (q: number): [number, number] => {
        const c = (((f + q) % 4) + 4) % 4;
        return (
          [
            [1.6, 1.2],
            [1.1, -0.2],
            [-0.6, 0],
            [0.3, 1.3],
          ] as [number, number][]
        )[c];
      };
      const into = sstep(0.15, 1.05, d);
      return {
        ...O0,
        pitch: -0.45 * sstep(0, 0.15, d),
        sink: into * 14,
        z: -0.2,
        hx: 0.4,
        hz: -0.6,
        hp: -0.3,
        earL: 0.5,
        earR: 0.5,
        tailUp: 0.9 + Math.sin(f * 1.6) * 0.3,
        tailSide: Math.sin(f * 1.3) * 0.6,
        feet: [pf(0), pf(2), [-0.3, 0], [-0.2, 0]],
        snow: d > 0.12 && d < 1.12 ? [((f % 3) + 0.5) / 3, -4, PI, 1.4] : undefined,
      };
    }
    case 'stun': {
      // 0,2 с: взвизг — голова назад, пасть, уши прижаты, хвост поджат.
      const P: Partial<FoxO>[] = [
        { z: -0.3, st: -0.3, hx: -0.8, hz: 0.6, hp: 0.4, jaw: 0.6 },
        { z: -0.3, st: -0.3, hx: -0.8, hz: 0.6, hp: 0.4, jaw: 0.4, hyaw: 0.2 },
        { z: -0.25, st: -0.25, hx: -0.6, hz: 0.5, hp: 0.3, jaw: 0.2, hyaw: -0.15 },
        { z: -0.15, st: -0.15, hx: -0.4, hz: 0.3, hp: 0.2 },
        { z: -0.05, hx: -0.2, hz: 0.1 },
      ];
      return {
        ...O0,
        ...P[f],
        earL: 1 - f * 0.15,
        earR: 1 - f * 0.18,
        tailUp: -0.3 + f * 0.1,
        shut: f < 3,
      };
    }
    case 'esc': {
      // Нырок в снег 0,4 с: нос вниз, передние гребут, ушёл с головой.
      const k = tf(f) / 0.4;
      const pf: [number, number][] = [
        [1.6, 1.2],
        [1.1, -0.2],
        [-0.6, 0],
        [0.3, 1.3],
      ];
      return {
        ...O0,
        pitch: -0.8 * sstep(0, 0.3, k),
        st: 0.4,
        sink: 17 * sstep(0.15, 0.85, k),
        hx: 0.8,
        hz: -0.8,
        hp: -0.3,
        earL: 0.8,
        earR: 0.8,
        tailUp: 1 + Math.sin(f * 1.7) * 0.25,
        tailSide: Math.sin(f * 1.3) * 0.5,
        feet: [pf[f % 4], pf[(f + 2) % 4], [-1.2, 0.6], [-1, 0.4]],
        snow: [clamp01(0.15 + k * 0.85) * 0.98, 0, 0, TAU],
      };
    }
    default: {
      // Смерть 0,8 с: взвизг, валится на бок, лапы дёргаются и стихают.
      const t = tf(f);
      const yelp = 1 - sstep(0.08, 0.2, t);
      const roll = trk(t, [
        [0, 0],
        [0.1, 0],
        [0.32, 1.5, easeOut],
      ]);
      const kick =
        t > 0.34 ? Math.sin((t - 0.34) * TAU * 4.5) * 0.9 * (1 - clamp01((t - 0.34) / 0.3)) : 0;
      return {
        ...O0,
        roll,
        z: trk(t, [
          [0, 0],
          [0.1, 0.4],
          [0.32, -1.2],
        ]),
        pitch: 0.2 * yelp,
        st: -0.2 * yelp,
        hp: 0.5 * yelp - 0.2 * (1 - yelp),
        hz: 0.6 * yelp,
        jaw: t < 0.3 ? 0.8 : 0.3,
        earL: 0.8,
        earR: 0.8,
        shut: t > 0.36,
        tailUp: lerp(0.8, 0, sstep(0.1, 0.4, t)),
        tailSide: kick * 0.4,
        feet: [
          [0.6 + kick, 0.6],
          [0.2 - kick, 0.5],
          [-0.4 - kick, 0.4],
          [0 + kick, 0.4],
        ],
        sackOff: sstep(0.05, 0.35, t),
        coins: t > 0.06 ? clamp01((t - 0.06) / 0.5) * 0.999 : 0,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Рисовальщики.
// ---------------------------------------------------------------------------

const N: Record<string, number> = {
  idle: 12,
  run: 8,
  hide: 16,
  leap: 15,
  land: 8,
  bite1: 8,
  biteN: 5,
  rec: 12,
  dig: 34,
  stun: 5,
  die: 19,
};
const NS: Record<string, number> = { idle: 12, run: 8, esc: 10, die: 19 };

/** Оборотень — те же позы своей шкурой: `w` в начале имени позы. */
const buildFox = (anim: string, f: number) =>
  anim[0] === 'w' ? foxBuild(pose(anim.slice(1), f), WEREC) : foxBuild(pose(anim, f), ARCTIC);
const buildSack = (anim: string, f: number) => foxBuild(pose(anim, f), REDC);

const DIE = 0.8;
/** Миг превращения в оборотня (время рендера); −1 — ещё песец. */
const WERE_AT = new WeakMap<Mob, number>();

/** Смерть: отброс по удару, оседает, тает к концу. */
function dieFx(v: { kx: number; ky: number }, t: number, ex: Partial<MobFrame>): void {
  const go = easeOut(t / 0.3) * 3;
  const up = t < 0.3 ? Math.sin((t / 0.3) * PI) * 3 : 0;
  ex.dx = v.kx * go;
  ex.dy = v.ky * go * 0.6 - up;
  ex.alpha = 1 - sstep(0.6, DIE, t);
  ex.linger = DIE;
  ex.still = true;
}

function paintFox(m: Mob, p: MobPose): MobFrame {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const d = m.data ?? {};
  const were = (d.were ?? 0) > 0;
  const mv = speedOf(m) > 0.4;
  const atk = mode === 'f12_wind' || mode === 'f12_leap' || mode === 'recover';
  // Приземление после прыжка держит курс прыжка; бег — по ходу.
  const want =
    mv && !atk && !(mode === 'chase' && t < 0.34) ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  const v = visOf(m, p, want, atk ? 40 : 14);
  const fc = v.yaw;
  const cf = Math.cos(fc);
  const sf = Math.sin(fc) * 0.77;
  const ex: Partial<MobFrame> = { shadow: were ? 5.4 : 4.6 };
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, N.die - 1);
    dieFx(v, t, ex);
  } else if (mode === 'f12_hide') {
    anim = 'hide';
    f = idlePh(m, now, 8, N.hide);
    ex.shadow = 0;
  } else if (mode === 'f12_leap') {
    anim = 'leap';
    f = fi(t, N.leap - 1);
    const k = clamp01(t / 0.6);
    // Дуга над прямой мозга; тень остаётся на льду и сжимается.
    ex.dy = -Math.sin(k * PI) * 13;
    ex.shadow = 4.6 * (1 - 0.35 * Math.sin(k * PI));
    ex.still = true;
    if (f >= 3) ex.ghost = { every: 0.04, life: 0.18, tint: '#dff4ff', alpha: 0.3 };
  } else if (mode === 'chase' && v.prev === 'f12_leap' && t < N.land / 24) {
    anim = 'land';
    f = fi(t, N.land - 1);
    if (f < 2) {
      ex.sx = 1.14 - f * 0.06;
      ex.sy = 0.86 + f * 0.06;
    }
  } else if (mode === 'f12_wind') {
    ex.still = true;
    if ((d.bites ?? 0) === 0) {
      anim = 'bite1';
      f = fi(t, N.bite1 - 1);
      // Отпрянул и замер; бросок — вперёд.
      const back = easeOut(t / 0.12) * 1.2 * (1 - sstep(0.24, 0.32, t));
      const go = sstep(0.24, 0.32, t) * 1.5;
      ex.dx = cf * (go - back);
      ex.dy = sf * (go - back);
      if (f >= 6) ex.ghost = { every: 0.03, life: 0.12, tint: '#dff4ff', alpha: 0.3 };
    } else {
      anim = 'biteN';
      f = fi(t, N.biteN - 1);
      const go = [2, 1.4, 0.2, -0.6, 1][f];
      ex.dx = cf * go;
      ex.dy = sf * go;
      if (f === 0 || f === 4) ex.ghost = { every: 0.03, life: 0.12, tint: '#dff4ff', alpha: 0.3 };
      if (f === 0) {
        ex.sx = 1.08;
        ex.sy = 0.94;
      }
    }
  } else if (mode === 'recover') {
    anim = 'rec';
    f = fi(t, N.rec - 1);
    const go = f < 4 ? 2 - f * 0.3 : Math.max(0, 1.1 - (f - 4) * 0.15);
    ex.dx = cf * go;
    ex.dy = sf * go;
    if (f === 0) {
      ex.sx = 1.08;
      ex.sy = 0.94;
    }
  } else if (mode === 'f12_burrow' && (d.dug ?? 0) > 0) {
    anim = 'dig';
    f = fi(d.dug ?? 0, N.dig - 1);
    ex.still = true;
    ex.shadow = 4.6 * (1 - sstep(0.4, 1, d.dug ?? 0));
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, N.stun - 1);
  } else if (mv) {
    anim = 'run';
    f = Math.floor(stepPh(v, 1.4) * N.run) % N.run;
  } else {
    f = idlePh(m, now, 8, N.idle);
  }
  // Превращение: вздулся из прежнего роста с перелётом, тёмный след.
  let w = WERE_AT.get(m);
  if (w === undefined) WERE_AT.set(m, (w = were ? -9 : -1));
  else if (w === -1 && were) WERE_AT.set(m, (w = now));
  const age = w >= 0 ? now - w : 9;
  if (age < 0.45) {
    const g = lerp(1 / WEREC.s, 1, easeBack(age / 0.45));
    ex.sx = (ex.sx ?? 1) * g;
    ex.sy = (ex.sy ?? 1) * g * (1 + 0.06 * Math.sin((age / 0.45) * PI));
    ex.ghost = { every: 0.04, life: 0.25, tint: '#1a2034', alpha: 0.45 };
  }
  const name = were ? `w${anim}` : anim;
  const fr = frameOf(KF, name, f, dirOf(fc), p, () => buildFox(name, f));
  if (mode !== 'dying') hurtFx(v, now, 1.8, ex);
  return { ...fr, ...ex };
}

function paintSack(m: Mob, p: MobPose): MobFrame {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const mv = speedOf(m) > 0.4;
  const v = visOf(m, p, mv ? Math.atan2(m.vy, m.vx) : (m.face ?? 0), 12);
  const ex: Partial<MobFrame> = { shadow: 4.4 };
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, NS.die - 1);
    dieFx(v, t, ex);
  } else if (mode === 'escape') {
    anim = 'esc';
    f = fi(t, NS.esc - 1);
    ex.still = true;
    ex.shadow = 4.4 * (1 - clamp01(t / 0.3));
  } else if (mv) {
    anim = 'run';
    f = Math.floor(stepPh(v, 1.5) * NS.run) % NS.run;
    // Золотой след — сокровище убегает.
    ex.ghost = { every: 0.08, life: 0.2, tint: '#ffcf7a', alpha: 0.25 };
  } else {
    f = idlePh(m, now, 8, NS.idle);
  }
  const fr = frameOf(KS, anim, f, dirOf(v.yaw), p, () => buildSack(anim, f));
  if (mode !== 'dying') hurtFx(v, now, 1.8, ex);
  return { ...fr, ...ex };
}

paintMob('f12_fox', paintFox);
paintMob('f12_sackfox', paintSack);

const listOf = (n: Record<string, number>, pre = ''): [string, number][] =>
  Object.entries(n).map(([a, k]) => [pre + a, k]);
const warmFox = (K: Kind) => warmAll(K, [...listOf(N), ...listOf(N, 'w')], buildFox);
registerMobWarm('f12_fox', () => warmFox(KF));
registerMobWarm('f12_sackfox', () => warmAll(KS, listOf(NS), buildSack));
