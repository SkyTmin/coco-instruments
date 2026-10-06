// Этаж 4 «Двойная крипта» — латник склепа (анимации мобов 4). Пустые латы:
// шлем-ведро с тлеющей щелью, сюрко и плащ, башенный щит и копьё. Щит — честная
// плоскость в руке: смотрит туда же, куда мозг считает фронт (`m.face`), поэтому
// со спины его видно ребром или изнанкой. Ход — по пройденному пути и в ту
// сторону, куда латник движется (мозг ведёт его и боком, щитом к герою), —
// ноги переступают вбок, корпус щитом не отворачивается.

import { hex, Px } from '../dungeon-art';
import { frameLRU, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame } from '../dungeon-paint';
import {
  F4_MOB_STAT,
  INK,
  IRON,
  PI,
  QK,
  R,
  Scene,
  WHITE,
  WOOD,
  addFields,
  cached,
  camOf,
  dir8,
  eIn,
  eInOut,
  eOut,
  eyeCol,
  fi,
  fillPoly,
  finish,
  hash01,
  headView,
  hull2,
  hurtFields,
  ik,
  lerp,
  litOf,
  mod,
  seg,
  v3,
  vadd,
  vlerp,
  vmul,
  vnorm,
  vslerp,
  vsub,
  viewOf,
  visOf,
  withFlash,
} from './f4-mobkit';
import type { Look, P3, RGBA } from './f4-mobkit';

const TABARD = { hi: hex('#a8443a'), mid: hex('#7a2c2a'), dk: hex('#4a1a1a') };
const GOLD = { hi: hex('#fff2b0'), mid: hex('#dcb44c'), dk: hex('#8a6a20') };
const BONEK = { hi: hex('#f4efe0'), mid: hex('#d8cfb8'), hole: hex('#1c1412') };
const EYE_AMBER = hex('#ffb040');
const SOUL = hex('#3a2c4a');

const KN_W = 49;
const KN_H = 48;
const KN_AX = 24;
const KN_AY = 35;

/** Поза латника в осях тела (вперёд f, вправо s, вверх u). */
interface KnP {
  pel: P3;
  tilt: number;
  twist: number;
  head: P3;
  fl: P3;
  fr: P3;
  /** Щит: середина, поворот лица вокруг вертикали (+ к правому боку), наклон лица вверх, крен. */
  sc: P3;
  syaw: number;
  spitch: number;
  sroll: number;
  /** Правая кисть и направление копья (от кисти к острию), где кисть на древке (доля от пятки). */
  hr: P3;
  sp: P3;
  grip: number;
  cape: number;
  eyes: number;
  /** Блеск наконечника (последние 0,25 с прицела). */
  shine: number;
  /** Шлем слетел (смерть): куда и как лёг; −1 — на плечах. */
  helmOff: P3 | null;
  helmRoll: number;
}

const KG: KnP = {
  pel: v3(0, 0, 7.2),
  tilt: 0.05,
  twist: 0,
  head: v3(0, 0, 0),
  fl: v3(0.7, -1.7, 0),
  fr: v3(-0.6, 1.7, 0),
  sc: v3(3.1, -0.7, 9.6),
  syaw: 0.55,
  spitch: 0.05,
  sroll: 0,
  hr: v3(1.3, 3.5, 9.4),
  sp: vnorm(v3(0.12, 0.04, 1)),
  grip: 0.36,
  cape: 0,
  eyes: 1,
  shine: 0,
  helmOff: null,
  helmRoll: 0,
};

function mixKn(a: KnP, b: KnP, k: number): KnP {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    pel: vlerp(a.pel, b.pel, k),
    tilt: lerp(a.tilt, b.tilt, k),
    twist: lerp(a.twist, b.twist, k),
    head: vlerp(a.head, b.head, k),
    fl: vlerp(a.fl, b.fl, k),
    fr: vlerp(a.fr, b.fr, k),
    sc: vlerp(a.sc, b.sc, k),
    syaw: lerp(a.syaw, b.syaw, k),
    spitch: lerp(a.spitch, b.spitch, k),
    sroll: lerp(a.sroll, b.sroll, k),
    hr: vlerp(a.hr, b.hr, k),
    sp: vslerp(a.sp, b.sp, k),
    grip: lerp(a.grip, b.grip, k),
    cape: lerp(a.cape, b.cape, k),
    eyes: lerp(a.eyes, b.eyes, k),
    shine: lerp(a.shine, b.shine, k),
    helmOff: b.helmOff ?? a.helmOff,
    helmRoll: lerp(a.helmRoll, b.helmRoll, k),
  };
}

// ---- Шлем: 5 видов 7×9 (гребень, ведро, щель с глазами) -------------------------------

const HELMS: string[][] = [
  [
    '..Rrr..',
    '.rrrr..',
    'hhmmmms',
    'hmmmmms',
    'hmmddde',
    'hmmmmds',
    'hmmmdms',
    'hmmmmms',
    '.ddddd.',
  ],
  [
    '..Rrr..',
    '.rrrrr.',
    'hhmmmms',
    'hmmmmms',
    'hdedmes',
    'hmmmdms',
    'hmdmdms',
    'hmmmmms',
    '.ddddd.',
  ],
  [
    '..rRr..',
    '..rrr..',
    'hhmmmms',
    'hmmmmms',
    'hdemeds',
    'hmmdmms',
    'hmdmdms',
    'hmmmmms',
    '.ddddd.',
  ],
  [
    '..rrR..',
    '.rrrrr.',
    'hhmmmms',
    'hmmmsms',
    'hmmmmms',
    'hmmmsms',
    'hmmmmms',
    'hmmmsms',
    '.ddddd.',
  ],
  [
    '..rRr..',
    '..rrr..',
    'hhmmmms',
    'hmmsmms',
    'hmmmmms',
    'hmmsmms',
    'hmmmmms',
    'hmmsmms',
    '.ddddd.',
  ],
];
const HELM_PAL: Record<string, RGBA> = {
  r: TABARD.mid,
  R: TABARD.hi,
  h: IRON.hi,
  m: IRON.mid,
  s: IRON.sh,
  d: IRON.dk,
};

function paintHelm(
  p: Px,
  x: number,
  y: number,
  hv: number,
  eyes: number,
  eye: RGBA,
  glow: [number, number, RGBA][] | null,
  roll = 0,
): void {
  const rows = HELMS[hv];
  // Слетевший шлем катится: поворот на четверти.
  const q = mod(Math.round(roll / (PI / 2)), 4);
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < 7; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      const [cx, cy] =
        q === 0 ? [c, r] : q === 1 ? [8 - r, c] : q === 2 ? [6 - c, 8 - r] : [r, 6 - c];
      let col = ch === 'e' ? (eyes > 0 ? eye : IRON.dk) : HELM_PAL[ch];
      if (ch === 'e' && eyes > 0 && eyes < 1) col = [eye[0], eye[1], eye[2], R(255 * eyes)];
      p.set(x + cx, y + cy, col);
      if (ch === 'e' && eyes >= 0.5 && glow) glow.push([x + cx, y + cy, eye]);
    }
}

// ---- Щит и копьё ------------------------------------------------------------------------

/** Векторы щита: лицо, верх, правый край. */
function shieldAxes(P: KnP): { n: P3; up: P3; side: P3 } {
  const cy = Math.cos(P.syaw);
  const sy = Math.sin(P.syaw);
  const cp = Math.cos(P.spitch);
  const spp = Math.sin(P.spitch);
  const n: P3 = [cy * cp, sy * cp, spp];
  const up0: P3 = [-cy * spp, -sy * spp, cp];
  const side0: P3 = [-sy, cy, 0];
  const cr = Math.cos(P.sroll);
  const sr = Math.sin(P.sroll);
  return {
    n,
    up: vadd(vmul(up0, cr), vmul(side0, sr)),
    side: vsub(vmul(side0, cr), vmul(up0, sr)),
  };
}

const SH_W = 3.5;
const SH_H = 6.4;

function knShield(sc: Scene, P: KnP, rim: number): void {
  const { n, up, side } = shieldAxes(P);
  const c = P.sc;
  const at = (a: number, b: number) => vadd(c, vadd(vmul(side, a), vmul(up, b)));
  const pts = [
    at(-SH_W, SH_H),
    at(SH_W, SH_H),
    at(SH_W * 0.9, -SH_H * 0.62),
    at(0, -SH_H - 1.3),
    at(-SH_W * 0.9, -SH_H * 0.62),
  ];
  const Q = pts.map((q) => sc.P(q));
  // К зрителю (сверху, с юга) — вектор (sin yaw, cos yaw, QK) в осях тела.
  const vf = n[0] * sc.cam.s + n[1] * sc.cam.c + n[2] * QK;
  const front = vf > 0;
  const C = sc.P(c);
  const E = sc.P(vadd(c, vmul(up, 0.9)));
  const wpx = Math.abs(sc.P(at(SH_W, 0))[0] - sc.P(at(-SH_W, 0))[0]);
  const gx = Q.reduce((a, q) => a + q[0], 0) / Q.length;
  const gy = Q.reduce((a, q) => a + q[1], 0) / Q.length;
  sc.add(C[2] + 0.4, (p) => {
    fillPoly(p, Q, (x) =>
      front
        ? x < gx - wpx * 0.25
          ? TABARD.hi
          : x > gx + wpx * 0.3
            ? TABARD.dk
            : TABARD.mid
        : WOOD.dk,
    );
    if (!front && wpx >= 3) {
      // Изнанка: доски и ремни.
      const a = sc.P(at(-SH_W * 0.7, 1.5));
      const b = sc.P(at(SH_W * 0.7, 1.5));
      p.line(a[0], a[1], b[0], b[1], WOOD.mid);
      const a2 = sc.P(at(-SH_W * 0.7, -2));
      const b2 = sc.P(at(SH_W * 0.7, -2));
      p.line(a2[0], a2[1], b2[0], b2[1], WOOD.mid);
    }
    // Оковка: кромка сверху-слева светлая, снизу-справа в тени; отбой — раскалена.
    for (let i = 0; i < Q.length; i++) {
      const a = Q[i];
      const b = Q[(i + 1) % Q.length];
      const mx = (a[0] + b[0]) / 2 - gx;
      const my = (a[1] + b[1]) / 2 - gy;
      const lit = my < -0.5 || mx < -wpx * 0.3;
      const col =
        rim > 0 ? (rim > 0.5 ? WHITE : IRON.hi) : lit ? IRON.hi : front ? IRON.sh : IRON.dk;
      p.line(a[0], a[1], b[0], b[1], col);
    }
    if (wpx < 2.5) {
      // Ребром: полоса поля между кромками.
      const t = sc.P(at(0, SH_H - 0.6));
      const b = sc.P(at(0, -SH_H + 0.4));
      p.line(
        t[0] + (front ? 1 : -1),
        t[1],
        b[0] + (front ? 1 : -1),
        b[1],
        front ? TABARD.mid : WOOD.dk,
      );
    }
    if (front && wpx >= 4.5) {
      // Знак склепа — череп на поле.
      const sx = R(E[0]) - 1;
      const sy = R(E[1]) - 1;
      p.rect(sx, sy, sx + 2, sy + 1, BONEK.mid);
      p.set(sx, sy, BONEK.hi);
      p.set(sx, sy + 1, BONEK.hole);
      p.set(sx + 2, sy + 1, BONEK.hole);
      p.set(sx + 1, sy + 2, BONEK.mid);
    }
  });
}

const SP_L = 21;

function knSpear(sc: Scene, P: KnP, glow: [number, number, RGBA][]): void {
  const d = P.sp;
  const butt = vsub(P.hr, vmul(d, SP_L * P.grip));
  const tip = vadd(P.hr, vmul(d, SP_L * (1 - P.grip)));
  const neck = vsub(tip, vmul(d, 3));
  const side: P3 = vnorm([-d[1] || 0.0001, d[0], 0]);
  const B = sc.P(butt);
  const T = sc.P(tip);
  const N = sc.P(neck);
  const W1 = sc.P(vadd(neck, vmul(side, 1)));
  const W2 = sc.P(vsub(neck, vmul(side, 1)));
  const shine = P.shine;
  // Древко кусками — у каждого своя глубина: конец перед щитом ложится поверх него.
  const flat = Math.abs(T[1] - B[1]) < Math.abs(T[0] - B[0]);
  const K = 4;
  for (let i = 0; i < K; i++) {
    const a = vlerp(butt, neck, i / K);
    const b = vlerp(butt, neck, (i + 1) / K);
    const A = sc.P(a);
    const Bb = sc.P(b);
    sc.add((A[2] + Bb[2]) / 2 + 0.35, (p) => {
      if (flat) p.line(A[0], A[1] + 1, Bb[0], Bb[1] + 1, WOOD.dk);
      else p.line(A[0] + 1, A[1], Bb[0] + 1, Bb[1], WOOD.dk);
      p.line(A[0], A[1], Bb[0], Bb[1], WOOD.mid);
      if (i === 0) p.set(B[0], B[1], WOOD.dk);
    });
  }
  sc.add((N[2] + T[2]) / 2 + 0.35, (p) => {
    p.line(N[0], N[1], T[0], T[1], IRON.mid);
    p.set(W1[0], W1[1], IRON.sh);
    p.set(W2[0], W2[1], IRON.sh);
    p.set(T[0], T[1], shine > 0 ? WHITE : IRON.hi);
  });
  if (shine > 0.4) {
    const x = R(T[0]);
    const y = R(T[1]);
    const g: RGBA = [255, 250, 220, 255];
    glow.push([x, y, g]);
    if (shine > 0.7) {
      glow.push([x - 1, y, [255, 240, 200, 150]]);
      glow.push([x + 1, y, [255, 240, 200, 150]]);
      glow.push([x, y - 1, [255, 240, 200, 150]]);
      glow.push([x, y + 1, [255, 240, 200, 150]]);
    }
  }
}

// ---- Тело ----------------------------------------------------------------------------

function knScene(
  sc: Scene,
  P: KnP,
  hv: number,
  glow: [number, number, RGBA][],
  eye: RGBA,
  rim: number,
  soul = 0,
): void {
  const pel = P.pel;
  const up: P3 = vnorm([Math.sin(P.tilt), 0, Math.cos(P.tilt)]);
  const chest = vadd(pel, vmul(up, 6.2));
  const waist = vadd(pel, vmul(up, 1.0));
  const tw = P.twist;
  const rot = (f: number, s: number): P3 => [
    f * Math.cos(tw) - s * Math.sin(tw),
    f * Math.sin(tw) + s * Math.cos(tw),
    0,
  ];
  const shR = vadd(chest, vadd(rot(0, 3.0), [0, 0, 0.4]));
  const shL = vadd(chest, vadd(rot(0, -3.0), [0, 0, 0.4]));
  // Ноги в поножах: толстые, наколенник светлый, сабатон вперёд.
  for (const [hs, foot] of [
    [-1.5, P.fl],
    [1.5, P.fr],
  ] as [number, P3][]) {
    const hip = vadd(pel, [0, hs, 0]);
    const knee = ik(hip, foot, 3.9, 3.9, [1, hs * 0.15, 0.1]);
    sc.thick(hip, knee, IRON.mid, IRON.dk);
    sc.thick(knee, foot, IRON.mid, IRON.dk);
    sc.seg(knee, knee, IRON.hi, null, null, 0.1);
    sc.seg(foot, vadd(foot, [1.6, 0, 0.2]), IRON.dk, null, null, 0.05);
  }
  // Кираса — оболочка груди и пояса.
  const ring = (c: P3, f: number, s: number): P3[] => [
    vadd(c, rot(f, s)),
    vadd(c, rot(f, -s)),
    vadd(c, rot(-f, s)),
    vadd(c, rot(-f, -s)),
    vadd(c, rot(0, s * 1.05)),
    vadd(c, rot(0, -s * 1.05)),
  ];
  const body = hull2(
    [...ring(vadd(chest, [0, 0, 0.8]), 1.95, 2.9), ...ring(waist, 1.7, 2.4)].map((q) => sc.P(q)),
  );
  const bx = body.reduce((a, q) => a + q[0], 0) / body.length;
  sc.add(sc.P(vadd(pel, vmul(up, 3.5)))[2], (p) =>
    fillPoly(p, body, (x, _y, k) =>
      k > 0.88 ? IRON.dk : x < bx - 1.5 ? IRON.hi : x > bx + 1.2 ? IRON.sh : IRON.mid,
    ),
  );
  // Сюрко спереди: от груди до колен, низ рваный; пояс с пряжкой.
  const cape = P.cape;
  const tf = 2.05;
  sc.poly(
    [
      vadd(chest, rot(tf, -1.8)),
      vadd(chest, rot(tf, 1.8)),
      vadd(vadd(pel, rot(tf + 0.2 - cape * 0.4, 2.1)), [0, 0, -4.2]),
      vadd(vadd(pel, rot(tf + 0.2 - cape * 0.4, -2.1)), [0, 0, -4.2]),
    ],
    (x, y, k) => (k > 0.86 ? ((x + y) % 2 ? TABARD.dk : null) : TABARD.mid),
    0.25,
  );
  sc.seg(
    vadd(waist, rot(tf + 0.05, -2.0)),
    vadd(waist, rot(tf + 0.05, 2.0)),
    WOOD.dk,
    null,
    null,
    0.3,
  );
  sc.seg(vadd(waist, rot(tf + 0.1, 0)), vadd(waist, rot(tf + 0.1, 0)), GOLD.mid, null, null, 0.35);
  // Плащ за спиной: отстаёт на ходу.
  sc.poly(
    [
      vadd(chest, vadd(rot(-1.8, -2.7), [0, 0, 0.6])),
      vadd(chest, vadd(rot(-1.8, 2.7), [0, 0, 0.6])),
      vadd(pel, vadd(rot(-2.1 - cape, 3.1), [0, 0, -5.6 + cape * 0.8])),
      vadd(pel, vadd(rot(-2.1 - cape, -3.1), [0, 0, -5.6 + cape * 0.8])),
    ],
    (x, y, k) =>
      k > 0.9 ? ((x + y) % 2 ? TABARD.dk : null) : x % 5 === 0 ? TABARD.mid : TABARD.dk,
    -0.3,
  );
  // Наплечники.
  for (const [s, c] of [
    [shL, IRON.hi],
    [shR, IRON.mid],
  ] as [P3, RGBA][])
    sc.spr(
      s,
      (p, x, y) => {
        p.rect(R(x) - 1, R(y) - 1, R(x) + 1, R(y), c);
        p.set(R(x) - 1, R(y) - 1, IRON.hi);
        p.set(R(x) + 1, R(y), IRON.sh);
      },
      0.5,
    );
  // Правая рука с копьём.
  const elR = ik(shR, P.hr, 3.3, 3.3, [-0.6, 0.8, -0.7]);
  sc.thick(shR, elR, IRON.mid, IRON.sh, 0.2);
  sc.thick(elR, P.hr, IRON.mid, IRON.sh, 0.2);
  // Левая рука держит щит за ремень.
  const { n } = shieldAxes(P);
  const grip = vsub(P.sc, vmul(n, 0.8));
  const elL = ik(shL, grip, 3.3, 3.3, [-0.6, -0.8, -0.7]);
  sc.thick(shL, elL, IRON.mid, IRON.sh, 0.1);
  sc.thick(elL, grip, IRON.sh, IRON.dk, 0.1);
  knSpear(sc, P, glow);
  knShield(sc, P, rim);
  // Шлем на плечах или слетевший.
  const helmAt = P.helmOff ?? vadd(vadd(chest, vmul(up, 3.6)), P.head);
  sc.spr(
    helmAt,
    (p, x, y) => paintHelm(p, R(x) - 3, R(y) - 5, hv, P.eyes, eye, glow, P.helmRoll),
    P.helmOff ? 0.2 : 0.6,
  );
  if (soul > 0) {
    // Душа уходит из ворота: тёмный дым вверх, тает.
    const S = sc.P(vadd(chest, vmul(up, 2)));
    sc.add(99, (p) => {
      for (let i = 0; i < 7; i++) {
        const h = hash01(i * 11 + 3);
        const yy = S[1] - soul * (8 + h * 10) - i * 0.6;
        const xx = S[0] + Math.sin(soul * 6 + i) * (1 + h * 2);
        const a = R(200 * (1 - soul) * (0.5 + h * 0.5));
        if (a > 8) p.set(xx, yy, [SOUL[0], SOUL[1], SOUL[2], a]);
      }
    });
  }
}

// ---- Треки -------------------------------------------------------------------------

/** Покой: тяжёлое дыхание лат, плащ колышется, копьё чуть ходит. 8 кадров на 5 к/с. */
function knIdle(f: number): KnP {
  const a = (f / 8) * PI * 2;
  return {
    ...KG,
    pel: vadd(KG.pel, [0, 0, 0.3 * Math.sin(a)]),
    head: v3(0, 0, 0.25 * Math.sin(a - 0.7)),
    sc: vadd(KG.sc, [0, 0, 0.25 * Math.sin(a - 0.4)]),
    hr: vadd(KG.hr, [0, 0, 0.3 * Math.sin(a - 0.3)]),
    cape: 0.25 + 0.2 * Math.sin(a - 1.2),
  };
}

const KN_WALK = 1.05;
/** Шаг по направлению хода в осях тела (md — сторона хода относительно взгляда, 0…7). */
function knWalk(f: number, md: number): KnP {
  const a = (f / 8) * PI * 2;
  const ma = (md * PI) / 4;
  const df = Math.cos(ma);
  const ds = Math.sin(ma);
  const A = 2.4;
  const c = Math.cos(a);
  const lift = (s: number) => Math.max(0, s) * 1.6;
  const bob = 0.45 * Math.abs(Math.sin(a)) - 0.2;
  const back = df < -0.5;
  return {
    ...KG,
    pel: v3(0.2 * df, 0.2 * ds, 7.2 + bob),
    tilt: back ? -0.02 : 0.1,
    twist: 0.1 * c * df,
    fl: v3(0.7 + A * c * df, -1.7 + A * c * ds * 0.8, lift(Math.sin(a))),
    fr: v3(-0.6 - A * c * df, 1.7 - A * c * ds * 0.8, lift(-Math.sin(a))),
    head: v3(0, 0, -bob * 0.4),
    sc: vadd(KG.sc, [0, 0, 0.35 * Math.sin(a * 2 - 0.6)]),
    hr: vadd(KG.hr, [0.3 * c, 0, 0.3 * Math.sin(a * 2 - 0.3)]),
    sp: vnorm(v3(0.12 + 0.06 * c, 0.04, 1)),
    cape: 0.7 * Math.max(0, df) + 0.25 * Math.sin(a - 0.9),
  };
}

// Прицел 0,75 с: упор — щит вперёд, копьё ложится на кромку щита, присед;
// задержка — копьё оттянуто (замах назад), наконечник блестит последние 0,25 с.
const KN_BRACE: KnP = {
  ...KG,
  pel: v3(-0.4, 0, 6.3),
  tilt: 0.2,
  twist: -0.25,
  fl: v3(2.0, -1.8, 0),
  fr: v3(-2.4, 1.8, 0),
  sc: v3(3.7, -0.5, 8.3),
  syaw: 0.45,
  spitch: 0.08,
  hr: v3(-0.2, 3.0, 14.2),
  sp: vnorm(v3(1, -0.12, -0.1)),
  grip: 0.45,
  cape: 0.4,
};
const KN_DRAW: KnP = {
  ...KN_BRACE,
  pel: v3(-0.8, 0, 6.1),
  twist: -0.42,
  hr: v3(-1.8, 3.0, 14.6),
  head: v3(-0.2, 0, -0.2),
};
function knAim(t: number): KnP {
  if (t < 0.3) return mixKn(KG, KN_BRACE, eInOut(t / 0.3));
  const P = mixKn(KN_BRACE, KN_DRAW, eIn(seg(t, 0.3, 0.75)));
  const s = seg(t, 0.5, 0.75);
  return { ...P, shine: s > 0 ? 0.5 + 0.5 * ((fi(t, 99) % 3) / 2) : 0 };
}

// Выпад 0,26 с: с первого кадра — полный вынос копья и шаг (урон при касании
// в любой миг выпада), потом держит; щит прижат к боку.
const KN_THRUST: KnP = {
  ...KN_BRACE,
  pel: v3(1.4, 0, 6.6),
  tilt: 0.34,
  twist: 0.3,
  fl: v3(3.8, -1.7, 0),
  fr: v3(-3.4, 1.7, 0.4),
  sc: v3(3.1, -1.6, 9.0),
  syaw: 0.3,
  hr: v3(4.4, 2.2, 13.2),
  sp: vnorm(v3(1, -0.08, -0.14)),
  grip: 0.3,
  cape: 1.2,
  head: v3(0.4, 0, -0.2),
};
function knLunge(t: number): KnP {
  if (t < 1 / 24) return mixKn(KN_DRAW, KN_THRUST, 0.7);
  return { ...KN_THRUST, pel: vadd(KN_THRUST.pel, [0.2 * eOut(seg(t, 0.04, 0.26)), 0, 0]) };
}

// Окно 1,15 с: копьё воткнулось в пол, щит опущен и отвёрнут — фронт открыт.
const KN_OPEN: KnP = {
  ...KG,
  pel: v3(0.9, 0, 6.1),
  tilt: 0.42,
  twist: 0.2,
  fl: v3(3.0, -1.7, 0),
  fr: v3(-2.6, 1.7, 0),
  head: v3(0.5, 0, -0.6),
  sc: v3(1.4, -3.4, 5.0),
  syaw: -1.0,
  spitch: -0.55,
  sroll: -0.3,
  hr: v3(4.0, 1.9, 6.8),
  sp: vnorm(v3(0.75, -0.05, -0.66)),
  grip: 0.55,
  cape: 0.4,
  eyes: 0.6,
};
function knOpen(t: number): KnP {
  if (t < 0.21) return mixKn(KN_THRUST, KN_OPEN, eOut(t / 0.21));
  if (t < 0.95) {
    const b = fi(t, 99) % 8 < 4 ? 0 : 1;
    return {
      ...KN_OPEN,
      pel: vadd(KN_OPEN.pel, [0, 0, b * 0.4]),
      head: vadd(KN_OPEN.head, [0, 0, b * 0.3]),
    };
  }
  return mixKn(KN_OPEN, KG, eIn(seg(t, 0.95, 1.15)) * 0.45);
}

// Щит выбит 1,3 с: щит отлетает наружу, корпус откинут, копьё вскинуто.
const KN_STAG: KnP = {
  ...KG,
  pel: v3(-1.1, 0, 6.8),
  tilt: -0.32,
  twist: 0.35,
  fl: v3(1.6, -1.9, 0),
  fr: v3(-2.2, 1.9, 0),
  head: v3(-0.5, 0.3, 0.2),
  sc: v3(0.2, -4.8, 9.2),
  syaw: -1.45,
  spitch: 0.3,
  sroll: 0.7,
  hr: v3(0.2, 3.6, 12.0),
  sp: vnorm(v3(0.35, 0.35, 0.87)),
  cape: -0.4,
  eyes: 0.5,
};
function knStagger(t: number, T: number): KnP {
  if (t < 0.12) return mixKn(KG, KN_STAG, eOut(t / 0.12));
  if (t < T - 0.3) {
    const w = fi(t, 999) % 6 < 3 ? 1 : -1;
    return { ...KN_STAG, pel: vadd(KN_STAG.pel, [0, 0.3 * w, 0]), sroll: KN_STAG.sroll + 0.08 * w };
  }
  return mixKn(KN_STAG, KG, eInOut(seg(t, T - 0.3, T)));
}

/** Спит стоя: голова опущена, щит упёрт в пол, глаза погасли. */
const KN_SLEEP: KnP = {
  ...KG,
  pel: v3(0, 0, 6.9),
  head: v3(0.7, 0, -0.9),
  sc: v3(2.8, -0.9, 6.9),
  spitch: -0.05,
  eyes: 0,
};

/** Смерть 0,8 с (`linger`): пустые латы оседают, шлем слетает и катится, щит плашмя, копьё падает; душа уходит из ворота. */
const KN_DIE_T = 0.8;
function knDeath(t: number): { P: KnP; soul: number } {
  const k = eInOut(seg(t, 0.08, 0.45));
  const P0 = t < 0.08 ? mixKn(KG, KN_STAG, eOut(t / 0.08) * 0.6) : mixKn(KG, KN_STAG, 0.6);
  const fall = eIn(seg(t, 0.12, 0.42));
  const P: KnP = {
    ...P0,
    pel: vlerp(P0.pel, v3(0.4, 0, 1.6), k),
    tilt: lerp(P0.tilt, 1.15, eIn(seg(t, 0.2, 0.45))),
    fl: vlerp(P0.fl, v3(1.8, -2.6, 0), k),
    fr: vlerp(P0.fr, v3(-1.4, 2.6, 0), k),
    sc: vlerp(P0.sc, v3(3.2, -3.2, 0.5), fall),
    syaw: lerp(P0.syaw, -0.6, fall),
    spitch: lerp(P0.spitch, 1.5, fall),
    sroll: lerp(P0.sroll, 0, fall),
    hr: vlerp(P0.hr, v3(1.0, 4.4, 0.6), fall),
    sp: vslerp(P0.sp, vnorm(v3(0.45, 0.89, -0.02)), fall),
    eyes: t < 0.1 ? (fi(t, 9) % 2 ? 0.6 : 0) : 0,
    cape: lerp(P0.cape, -0.8, k),
  };
  // Шлем: срывается в 0,22, падает перед латами, отскок, катится до 0,6.
  if (t >= 0.22) {
    const h = seg(t, 0.22, 0.6);
    const z = h < 0.45 ? 14 * (1 - (h / 0.45) ** 2) : 1.6 * Math.sin(((h - 0.45) / 0.55) * PI);
    P.helmOff = v3(lerp(1, 5.2, eOut(h)), lerp(0, -2.2, h), Math.max(0, z) + 2.4);
    P.helmRoll = eOut(h) * PI;
  }
  return { P, soul: seg(t, 0.4, 0.8) };
}

// ---- Кадр -------------------------------------------------------------------------

const knFrames = frameLRU<MobFrame>(1300);
/** Сторона хода относительно взгляда → класс кадра (вперёд, вбок, назад, вбок). */
const MV4 = [0, 0, 2, 4, 4, 4, 6, 0];
F4_MOB_STAT.size.f4_knight = () => knFrames.size;

function knFrame(
  key: string,
  d8: number,
  look: Look,
  flash: boolean,
  rim: number,
  P: KnP,
  soul = 0,
): MobFrame {
  const fr = cached(knFrames, 'f4_knight', `${key}|${d8}|${look}|${rim}`, () => {
    const vw = viewOf(d8);
    const sc = new Scene(camOf(vw.yaw, KN_AX, KN_AY));
    const glow: [number, number, RGBA][] = [];
    const eye = eyeCol(look, EYE_AMBER);
    knScene(sc, P, headView(vw.d), glow, eye, rim, soul);
    const p = new Px(KN_W, KN_H);
    sc.paint(p);
    p.outline(INK);
    const pts = glow.map(([x, y, c]): [number, number, RGBA] => [vw.mir ? KN_W - 1 - x : x, y, c]);
    return {
      img: finish(p, vw.mir, false, look),
      lit: litOf(KN_W, KN_H, pts),
      ax: KN_AX,
      ay: KN_AY,
      eye: null,
      shadow: 7,
    };
  });
  return withFlash(fr, flash);
}

registerMobPainter('f4_knight', (m, pose) => {
  const md = pose.mode;
  const t = pose.t;
  const look = pose.look;
  // Латник поворачивается только мозгом (с пределом) — рисунок смотрит туда же.
  const v = visOf(m, pose, m.face ?? 0, 99);
  const d8 = dir8(m.face ?? 0);
  // Отбой щитом: вспыхивает кант щита, а не весь латник.
  const pr = pose.now - v.parryAt;
  const rim = pr >= 0 && pr < 0.09 ? (pr < 0.045 ? 2 : 1) : 0;
  const flash = pose.flash && rim === 0;
  let ex: Partial<MobFrame> = {};
  let fr: MobFrame;
  if (pose.anim === 'dead' || md === 'dying') {
    const i = fi(t, 19);
    const d = knDeath(i / 24);
    fr = knFrame(`die|${i}`, d8, look, false, 0, d.P, d.soul);
    return { ...fr, still: true, linger: KN_DIE_T, alpha: 1 - seg(t, 0.62, KN_DIE_T) };
  }
  if (md === 'sleep') {
    fr = knFrame('sleep', d8, look, flash, rim, KN_SLEEP);
  } else if (md === 'alert') {
    const i = fi(t, 8);
    const P = mixKn(KN_SLEEP, KG, eOut(i / 8));
    fr = knFrame(`alert|${i}`, d8, look, flash, rim, { ...P, eyes: i < 3 ? 0 : i < 5 ? 0.6 : 1 });
    ex.still = true;
  } else if (md === 'aim') {
    const i = fi(t, 18);
    fr = knFrame(`aim|${i}`, d8, look, flash, rim, knAim(i / 24));
    ex = { still: true };
  } else if (md === 'lunge') {
    const i = fi(t, 6);
    fr = knFrame(`lunge|${i}`, d8, look, flash, rim, knLunge(i / 24));
    ex = { still: true, ghost: { every: 0.03, life: 0.14, tint: '#7a2c2a', alpha: 0.32 } };
    if (i === 0) ex = { ...ex, sx: 1.06, sy: 0.95 };
  } else if (md === 'open') {
    const i = fi(t, 27);
    fr = knFrame(`open|${i}`, d8, look, flash, rim, knOpen(i / 24));
    ex = { still: true };
  } else if (md === 'stagger' || md === 'stun') {
    const T = md === 'stun' ? 0.3 : 1.3;
    const i = fi(t, R(T * 24));
    fr = knFrame(`${md}|${i}`, d8, look, flash, rim, knStagger(i / 24, T));
  } else {
    const sp = Math.hypot(m.vx ?? 0, m.vy ?? 0);
    // Выход из окна — латник поднимает щит и копьё.
    const back = (v.prev === 'open' || v.prev === 'stagger') && t < 0.25;
    if (sp > 0.35) {
      const mv = MV4[dir8(Math.atan2(m.vy ?? 0, m.vx ?? 0) - (m.face ?? 0))];
      const f = mod((v.dist / KN_WALK) * 8, 8);
      fr = knFrame(`walk|${f}|${mv}`, d8, look, flash, rim, knWalk(f, mv));
    } else if (back) {
      const i = fi(t, 5);
      fr = knFrame(
        `up|${i}`,
        d8,
        look,
        flash,
        rim,
        mixKn(mixKn(KN_OPEN, KG, 0.45), KG, eOut(i / 5)),
      );
    } else {
      const f = mod(pose.now * 5 + hash01(m.id ?? 0) * 8, 8);
      fr = knFrame(`idle|${f}`, d8, look, flash, rim, knIdle(f));
    }
  }
  if (rim) {
    // Отбой: латы откатываются от удара на пиксель.
    const a = m.face ?? 0;
    ex = addFields(ex, {
      dx: -Math.cos(a) * (rim === 2 ? 1.4 : 0.7),
      dy: -Math.sin(a) * 0.5,
      sy: 0.97,
    });
  } else ex = addFields(ex, hurtFields(v, pose.now, 0.5));
  return { ...fr, ...ex };
});

registerMobWarm('f4_knight', function* () {
  for (let d = 0; d < 8; d++) {
    for (let f = 0; f < 8; f++) {
      knFrame(`idle|${f}`, d, 'normal', false, 0, knIdle(f));
      yield 0;
      knFrame(`walk|${f}|0`, d, 'normal', false, 0, knWalk(f, 0));
      yield 0;
    }
  }
  for (let d = 0; d < 8; d++) {
    for (let i = 0; i <= 18; i++) {
      knFrame(`aim|${i}`, d, 'normal', false, 0, knAim(i / 24));
      yield 0;
    }
    for (let i = 0; i <= 6; i++) {
      knFrame(`lunge|${i}`, d, 'normal', false, 0, knLunge(i / 24));
      yield 0;
    }
    for (let i = 0; i <= 27; i++) {
      knFrame(`open|${i}`, d, 'normal', false, 0, knOpen(i / 24));
      yield 0;
    }
    for (let i = 0; i <= 5; i++) {
      knFrame(`up|${i}`, d, 'normal', false, 0, mixKn(mixKn(KN_OPEN, KG, 0.45), KG, eOut(i / 5)));
      yield 0;
    }
  }
});
