// Этаж 4 «Двойная крипта» — каменный страж в движении (анимации мобов 4).
// Общий рисовальщик `f4_statue` у стража-изваяния (`f4_sentry`) и стража
// идола (`f4_statue`, золото). Сон, постамент, пробуждение и сборка из груды
// остаются прежним фасадным рисунком (`f4-art.ts`: спящий обязан совпасть с
// предметом-статуей); всё, что статуя делает дальше — застывшие позы, крадётся,
// замах и удар, поклон, оглушение, смерть, — 3D-риг в 8 сторон: каменный рыцарь
// с мечом. Страж не дышит и не качается: под взглядом камень стоит мёртво
// (иначе игрок решит, что он движется, когда на него смотрят).

import type { Mob } from '../dungeon-sim';
import { hex, Px } from '../dungeon-art';
import { frameLRU, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  F4_MOB_STAT,
  INK,
  PI,
  R,
  Scene,
  TAU,
  WHITE,
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
  bake,
  hash01,
  headView,
  hull2,
  hurtFields,
  ik,
  lerp,
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

const STONE = {
  hi: hex('#c6c8be'),
  mid: hex('#989b91'),
  sh: hex('#6d7069'),
  dk: hex('#474a46'),
};
const GOLD = { hi: hex('#fff2b0'), mid: hex('#dcb44c'), dk: hex('#8a6a20') };
const EYE = hex('#ff3a28');

const S3_W = 55;
const S3_H = 52;
const S3_AX = 27;
const S3_AY = 41;

/** Поза каменного рыцаря в осях тела (вперёд f, вправо s, вверх u). */
interface StP {
  pel: P3;
  tilt: number;
  twist: number;
  head: P3;
  fl: P3;
  fr: P3;
  /** Колено на полу (поклон): левая голень лежит. */
  kneel: number;
  /** Правая кисть (рукоять), левая кисть, направление клинка. */
  hr: P3;
  hl: P3;
  sv: P3;
  skirt: number;
  eyes: number;
  /** След клинка дугой у плеча: угол от, угол до (в плоскости «вперёд—вверх»), яркость. */
  smear: [number, number, number] | null;
}

const SG: StP = {
  pel: v3(0, 0, 8.0),
  tilt: 0.04,
  twist: 0,
  head: v3(0, 0, 0),
  fl: v3(0.6, -2.0, 0),
  fr: v3(-0.4, 2.0, 0),
  kneel: 0,
  hr: v3(3.0, 1.6, 11.2),
  hl: v3(2.8, -0.4, 10.8),
  sv: vnorm(v3(0.8, -0.15, 0.58)),
  skirt: 0,
  eyes: 1,
  smear: null,
};

function mixSt(a: StP, b: StP, k: number): StP {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    pel: vlerp(a.pel, b.pel, k),
    tilt: lerp(a.tilt, b.tilt, k),
    twist: lerp(a.twist, b.twist, k),
    head: vlerp(a.head, b.head, k),
    fl: vlerp(a.fl, b.fl, k),
    fr: vlerp(a.fr, b.fr, k),
    kneel: lerp(a.kneel, b.kneel, k),
    hr: vlerp(a.hr, b.hr, k),
    hl: vlerp(a.hl, b.hl, k),
    sv: vslerp(a.sv, b.sv, k),
    skirt: lerp(a.skirt, b.skirt, k),
    eyes: lerp(a.eyes, b.eyes, k),
    smear: b.smear ?? a.smear,
  };
}

/** Угол клинка в плоскости «вперёд—вверх» (для следа). */
const angOf = (d: P3) => Math.atan2(d[2], d[0]);

/** Четыре застывшие позы (`data.pose`): стойка, меч над головой, выпад, когти. */
const ST_FROZEN: StP[] = [
  { ...SG, pel: v3(0, 0, 7.4), fl: v3(1.7, -2.0, 0), fr: v3(-1.5, 2.0, 0), tilt: 0.1 },
  {
    ...SG,
    pel: v3(-0.2, 0, 7.8),
    tilt: -0.12,
    fl: v3(1.5, -2.0, 0),
    fr: v3(-1.7, 2.0, 0),
    hr: v3(-0.2, 1.2, 19.0),
    hl: v3(-0.1, -0.6, 18.4),
    sv: vnorm(v3(-0.45, 0.1, 0.89)),
    head: v3(-0.2, 0, 0.2),
  },
  {
    ...SG,
    pel: v3(1.4, 0, 7.0),
    tilt: 0.34,
    twist: 0.35,
    fl: v3(4.4, -2.0, 0),
    fr: v3(-3.4, 2.0, 0),
    hr: v3(6.4, 1.4, 10.8),
    hl: v3(-2.0, -4.0, 9.6),
    sv: vnorm(v3(1, -0.04, -0.05)),
    head: v3(0.5, 0, -0.2),
    skirt: -0.4,
  },
  {
    ...SG,
    pel: v3(0.5, 0, 7.4),
    tilt: 0.22,
    twist: -0.4,
    fl: v3(2.8, -2.0, 0),
    fr: v3(-2.2, 2.0, 0),
    hr: v3(-1.6, 3.8, 7.6),
    hl: v3(5.8, -2.0, 13.6),
    sv: vnorm(v3(-0.5, 0.25, -0.83)),
    head: v3(0.6, -0.2, 0),
  },
];

// ---- Тело --------------------------------------------------------------------------

// Шлем 9×9 по видам: 0 — бок, 1 — три четверти к зрителю, 2 — лицом,
// 3 — три четверти спиной, 4 — спиной. `e` — глаз в прорези (горит в `lit`).
const HELM: string[][] = [
  [
    '....h....',
    '...hms...',
    '..hmmms..',
    '.hhmmmms.',
    'hmmmmmmms',
    'hmmmmddes',
    'hmmmmmmds',
    'hmmmmmmms',
    '.sssssss.',
  ],
  [
    '....h....',
    '...hms...',
    '..hmmms..',
    '.hhmmmms.',
    'hmmmmmmms',
    'hmmdeddes',
    'hmmmmdmms',
    'hmmmmdmms',
    '.sssssss.',
  ],
  [
    '....h....',
    '...hms...',
    '..hmmms..',
    '.hhmmmms.',
    'hmmmmmmms',
    'hdedddeds',
    'hmmmdmmms',
    'hmmmdmmms',
    '.sssssss.',
  ],
  [
    '....h....',
    '...hms...',
    '..hmsms..',
    '.hhmsmms.',
    'hmmmsmmms',
    'hmmmsmmms',
    'hmmmsmmms',
    'hmmmmmmms',
    '.sssssss.',
  ],
  [
    '....h....',
    '...hms...',
    '..hmsms..',
    '.hhmsmms.',
    'hmmmsmmms',
    'hmmmsmmms',
    'hmmmsmmms',
    'hmmmmmmms',
    '.sssssss.',
  ],
];

function paintStHelm(
  p: Px,
  x: number,
  y: number,
  hv: number,
  gold: boolean,
  eyes: number,
  eye: RGBA,
  glow: [number, number, RGBA][],
): void {
  const rows = HELM[hv];
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < 9; c++) {
      const ch = rows[r][c];
      if (ch === '.') continue;
      if (ch === 'e') {
        p.set(x + c, y + r, eyes > 0.5 ? eye : STONE.dk);
        if (eyes > 0.5) glow.push([x + c, y + r, eye]);
        continue;
      }
      const col = ch === 'h' ? STONE.hi : ch === 'm' ? STONE.mid : ch === 's' ? STONE.sh : STONE.dk;
      p.set(x + c, y + r, gold && r < 2 ? (ch === 'h' ? GOLD.hi : GOLD.mid) : col);
    }
}

/** Трещины по здоровью — на латах (вперёд, вправо, вверх от таза), поворачиваются с телом. */
const CRACKS: [P3, P3][] = [
  [v3(3.3, -0.8, 6.2), v3(3.3, 0.5, 4.0)],
  [v3(3.3, 0.5, 4.0), v3(3.1, 1.6, 3.0)],
  [v3(2.9, 1.8, 1.8), v3(3.0, 0.3, 0.6)],
  [v3(3.1, -2.8, 5.4), v3(3.2, -1.4, 3.4)],
  [v3(-3.2, 1.2, 6.0), v3(-3.0, -0.8, 4.0)],
];

/** Обвал по смерти: часть → [с какой доли падает, сдвиг f, сдвиг s]. */
const PART_DROP: [number, number, number][] = [
  // 0 меч, 1 шлем, 2 руки, 3 корпус, 4 юбка, 5 ноги
  [0.1, 2.5, 2.5],
  [0.14, 3.0, -1.5],
  [0.2, 1.0, 3.0],
  [0.27, 0.8, 0.4],
  [0.31, 0.2, -0.8],
  [0.36, 0, 0],
];

/** Толстая каменная часть в три линии: свет сверху-слева, середина, тень. */
function limb(sc: Scene, a: P3, b: P3, dz = 0): void {
  const A = sc.P(a);
  const B = sc.P(b);
  sc.add((A[2] + B[2]) / 2 + dz, (p) => {
    const vert = Math.abs(B[1] - A[1]) > Math.abs(B[0] - A[0]);
    const ox = vert ? 1 : 0;
    const oy = vert ? 0 : 1;
    p.line(A[0] + ox, A[1] + oy, B[0] + ox, B[1] + oy, STONE.sh);
    p.line(A[0], A[1], B[0], B[1], STONE.mid);
    p.line(A[0] - ox, A[1] - oy, B[0] - ox, B[1] - oy, STONE.hi);
  });
}

function stScene(
  sc: Scene,
  P: StP,
  hv: number,
  gold: boolean,
  cracks: number,
  eye: RGBA,
  glow: [number, number, RGBA][],
  post: ((p: Px) => void)[],
  fall: number,
): void {
  // Смерть: часть оседает к полу со своего мига и сползает в сторону.
  const T = (part: number, q: P3): P3 => {
    if (fall < 0) return q;
    const [t0, df, ds] = PART_DROP[part];
    const k = seg(fall, t0, t0 + 0.4) ** 2;
    if (k <= 0) return q;
    const h = q[2];
    const rest = Math.min(h, 1.2 + hash01(part * 7 + R(h)) * 1.4);
    return [q[0] + df * k, q[1] + ds * k, h * (1 - k) + rest * k];
  };
  const pel = P.pel;
  const up: P3 = vnorm([Math.sin(P.tilt), 0, Math.cos(P.tilt)]);
  const chest = vadd(pel, vmul(up, 7.0));
  const waist = vadd(pel, vmul(up, 1.2));
  const tw = P.twist;
  const rot = (f: number, s: number): P3 => [
    f * Math.cos(tw) - s * Math.sin(tw),
    f * Math.sin(tw) + s * Math.cos(tw),
    0,
  ];
  const shR = vadd(chest, vadd(rot(0, 5.4), [0, 0, 0.3]));
  const shL = vadd(chest, vadd(rot(0, -5.4), [0, 0, 0.3]));
  // Ноги: толстые каменные; в поклоне левое колено в полу.
  for (const [hs, foot0] of [
    [-1.9, P.fl],
    [1.9, P.fr],
  ] as [number, P3][]) {
    const hip0 = vadd(pel, [0, hs, 0]);
    const kneeOnFloor = hs < 0 && P.kneel > 0.5;
    const knee0 = kneeOnFloor
      ? vadd(foot0, [3.6, 0, 0.6])
      : ik(hip0, foot0, 4.2, 4.2, [1, hs * 0.12, 0.1]);
    const hip = T(5, hip0);
    const knee = T(5, knee0);
    const foot = T(5, foot0);
    limb(sc, hip, knee);
    limb(sc, knee, foot);
    sc.thick(foot, vadd(foot, [1.8, 0, 0.2]), STONE.mid, STONE.dk, 0.05);
  }
  // Каменная юбка (тассеты) — колокол от пояса к коленям, разрезы.
  const sk = P.skirt;
  const skirtPts: P3[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    skirtPts.push(T(4, vadd(waist, rot(Math.cos(a) * 2.8, Math.sin(a) * 3.9))));
    skirtPts.push(
      T(4, vadd(vadd(pel, [0, 0, -4.6]), rot(Math.cos(a) * 3.8 - sk * 0.6, Math.sin(a) * 5.0))),
    );
  }
  const skH = hull2(skirtPts.map((q) => sc.P(q)));
  const skx = skH.reduce((a, q) => a + q[0], 0) / skH.length;
  const dSk = sc.P(T(4, vadd(pel, [0, 0, -1])))[2];
  sc.add(dSk, (p) =>
    fillPoly(p, skH, (x, _y, k) =>
      k > 0.88 ? STONE.dk : x < skx - 3.5 ? STONE.hi : x > skx + 1.5 ? STONE.sh : STONE.mid,
    ),
  );
  for (const a of [0.5, 1.3, 2.2, 4.1, 5.0, 5.8]) {
    const t0 = T(4, vadd(waist, rot(Math.cos(a) * 2.8, Math.sin(a) * 3.9)));
    const b0 = T(4, vadd(vadd(pel, [0, 0, -4.4]), rot(Math.cos(a) * 3.8, Math.sin(a) * 5.0)));
    if ((sc.P(t0)[2] + sc.P(b0)[2]) / 2 >= dSk) sc.seg(t0, b0, STONE.dk, null, null, 0.05);
  }
  // Корпус: кираса, сверху шире.
  const ring = (c: P3, f: number, s: number): P3[] => [
    vadd(c, rot(f, s)),
    vadd(c, rot(f, -s)),
    vadd(c, rot(-f, s)),
    vadd(c, rot(-f, -s)),
    vadd(c, rot(f * 1.08, 0)),
    vadd(c, rot(-f * 1.04, 0)),
    vadd(c, rot(0, s * 1.06)),
    vadd(c, rot(0, -s * 1.06)),
  ];
  const body = hull2(
    [...ring(vadd(chest, [0, 0, 0.9]), 3.3, 5.2), ...ring(waist, 2.7, 3.8)].map((q) =>
      sc.P(T(3, q)),
    ),
  );
  const bx = body.reduce((a, q) => a + q[0], 0) / body.length;
  const dB = sc.P(T(3, vadd(pel, vmul(up, 4))))[2];
  sc.add(dB, (p) =>
    fillPoly(p, body, (x, _y, k) =>
      k < 0.07
        ? STONE.hi
        : k > 0.9
          ? STONE.sh
          : x < bx - 3.2
            ? STONE.hi
            : x > bx + 1.2
              ? STONE.sh
              : STONE.mid,
    ),
  );
  // Ребро кирасы и пояс (у стража идола — золотой).
  const keelA = T(3, vadd(vadd(chest, rot(3.4, 0)), [0, 0, 0.6]));
  const keelB = T(3, vadd(waist, rot(2.9, 0)));
  sc.seg(keelA, keelB, STONE.hi, null, null, 0.3);
  sc.seg(
    T(3, vadd(waist, rot(2.8, -3.6))),
    T(3, vadd(waist, rot(2.8, 3.6))),
    gold ? GOLD.dk : STONE.dk,
    null,
    null,
    0.25,
  );
  if (gold) sc.seg(keelB, keelB, GOLD.hi, null, null, 0.35);
  // Трещины.
  // В смерти — все разом и светятся изнутри первые доли секунды.
  const nCr = fall >= 0 ? CRACKS.length : Math.min(CRACKS.length, cracks > 0 ? cracks * 2 - 1 : 0);
  const crGlow = fall >= 0 ? 1 - seg(fall, 0.12, 0.45) : 0;
  const dMid = sc.P(vadd(pel, vmul(up, 4)))[2];
  for (let i = 0; i < nCr; i++) {
    const [a, b] = CRACKS[i];
    const A = T(3, vadd(vadd(pel, rot(a[0], a[1])), vmul(up, a[2])));
    const B = T(3, vadd(vadd(pel, rot(b[0], b[1])), vmul(up, b[2])));
    sc.seg(A, B, crGlow > 0 ? hex('#e8c890') : STONE.dk, null, null, 0.4);
    const PA = sc.P(A);
    const PB = sc.P(B);
    if (crGlow > 0 && (PA[2] + PB[2]) / 2 > dMid) {
      const n = Math.max(1, R(Math.max(Math.abs(PB[0] - PA[0]), Math.abs(PB[1] - PA[1]))));
      for (let j = 0; j <= n; j++)
        glow.push([
          R(lerp(PA[0], PB[0], j / n)),
          R(lerp(PA[1], PB[1], j / n)),
          hex('#ffe0a0', R(230 * crGlow)),
        ]);
    }
  }
  // Наплечники.
  for (const [s, c] of [
    [shL, STONE.hi],
    [shR, STONE.mid],
  ] as [P3, RGBA][])
    sc.spr(
      T(2, s),
      (p, x, y) => {
        p.rect(R(x) - 3, R(y) - 1, R(x) + 2, R(y) + 2, c);
        p.rect(R(x) - 2, R(y) - 2, R(x) + 1, R(y) - 2, STONE.hi);
        p.rect(R(x) - 3, R(y) - 1, R(x) + 1, R(y) - 1, STONE.hi);
        p.rect(R(x) - 3, R(y) + 2, R(x) + 2, R(y) + 2, STONE.sh);
      },
      0.5,
    );
  // Руки.
  for (const [s, h, sg] of [
    [shR, P.hr, 1],
    [shL, P.hl, -1],
  ] as [P3, P3, number][]) {
    const el = ik(s, h, 4.3, 4.3, [-0.6, 0.8 * sg, -0.7]);
    sc.thick(T(2, s), T(2, el), STONE.mid, STONE.sh, 0.2);
    sc.thick(T(2, el), T(2, h), STONE.mid, STONE.sh, 0.2);
    sc.spr(
      T(2, h),
      (p, x, y) => {
        p.rect(R(x), R(y), R(x) + 1, R(y) + 1, STONE.mid);
        p.set(R(x), R(y), STONE.hi);
      },
      0.3,
    );
  }
  // След клинка — дуга у плеча, полосой между лучами (не веером линий).
  const d = P.sv;
  const hand = P.hr;
  if (P.smear) {
    const [a0, a1, k] = P.smear;
    const piv = T(0, shR);
    const N = 10;
    const ray = (a: number, r: number) =>
      sc.P(vadd(piv, vadd(rot(Math.cos(a) * r, 0.4), [0, 0, Math.sin(a) * r])));
    const inner: [number, number, number][] = [];
    const outer: [number, number, number][] = [];
    for (let i = 0; i <= N; i++) {
      const a = lerp(a0, a1, i / N);
      inner.push(ray(a, 12));
      outer.push(ray(a, 17.5));
    }
    post.push((p) => {
      for (let i = 0; i < N; i++) {
        const al = R(255 * k * (0.1 + 0.55 * ((i + 1) / N) ** 1.5));
        if (al < 10) continue;
        fillPoly(p, [inner[i], outer[i], outer[i + 1], inner[i + 1]], hex('#eceee4', al));
      }
      for (let i = 0; i < N; i++) {
        const al = R(255 * k * (0.2 + 0.8 * ((i + 1) / N)));
        p.line(outer[i][0], outer[i][1], outer[i + 1][0], outer[i + 1][1], hex('#ffffff', al));
      }
    });
  }
  // Меч: широкий каменный клинок, гарда и навершие (у стража идола — золото).
  const tip = vadd(hand, vmul(d, 15));
  const pom = vsub(hand, vmul(d, 2.4));
  const side: P3 = vnorm([-d[1] || 0.0001, d[0], 0]);
  const segs = 3;
  for (let i = 0; i < segs; i++) {
    const A = sc.P(T(0, vlerp(hand, tip, i / segs)));
    const B = sc.P(T(0, vlerp(hand, tip, (i + 1) / segs)));
    sc.add((A[2] + B[2]) / 2 + 0.35, (p) => {
      const flat = Math.abs(B[1] - A[1]) < Math.abs(B[0] - A[0]);
      if (flat) p.line(A[0], A[1] + 1, B[0], B[1] + 1, STONE.sh);
      else p.line(A[0] + 1, A[1], B[0] + 1, B[1], STONE.sh);
      p.line(A[0], A[1], B[0], B[1], STONE.hi);
      if (i === segs - 1) p.set(B[0], B[1], WHITE);
    });
  }
  const g1 = sc.P(T(0, vadd(hand, vmul(side, 2.6))));
  const g2 = sc.P(T(0, vsub(hand, vmul(side, 2.6))));
  const Pm = sc.P(T(0, pom));
  const Hh = sc.P(T(0, hand));
  sc.add(Hh[2] + 0.45, (p) => {
    p.line(g1[0], g1[1], g2[0], g2[1], gold ? GOLD.mid : STONE.dk);
    p.line(Hh[0], Hh[1], Pm[0], Pm[1], STONE.sh);
    p.set(Pm[0], Pm[1], gold ? GOLD.hi : STONE.mid);
  });
  // Шлем.
  const helmAt = T(1, vadd(vadd(chest, vmul(up, 4.4)), P.head));
  sc.spr(helmAt, (p, x, y) => paintStHelm(p, R(x) - 4, R(y) - 7, hv, gold, P.eyes, eye, glow), 0.6);
}

// ---- Треки -------------------------------------------------------------------------

/** Шаг крадущегося камня: тяжёлый, ступня ставится плоско, меч волочится сбоку. */
const ST_WALK = 1.15;
function stWalk(f: number): StP {
  const a = (f / 8) * TAU;
  const c = Math.cos(a);
  const A = 2.7;
  const lift = (s: number) => Math.max(0, s) * 1.5;
  const bob = 0.5 * Math.abs(Math.sin(a)) - 0.25;
  return {
    ...SG,
    pel: v3(0.3, 0, 7.8 + bob),
    tilt: 0.16,
    twist: 0.12 * c,
    fl: v3(0.5 + A * c, -2.0, lift(Math.sin(a))),
    fr: v3(-0.3 - A * c, 2.0, lift(-Math.sin(a))),
    hr: v3(1.0 - 0.6 * c, 3.9, 9.2),
    hl: v3(0.8 + 1.4 * c, -3.7, 9.2),
    sv: vnorm(v3(0.75, 0.15, -0.65)),
    skirt: 0.5 + 0.2 * Math.sin(a),
    head: v3(0.4, 0, -bob * 0.4),
  };
}

// Замах (k = накопленный замах мозга, копится только пока на статую не смотрят):
// меч за голову, корпус откинут; последние доли — меч уже пошёл вниз. Удар —
// кадр 0 отдыха: остриё в пол перед собой.
const ST_WIND: StP = {
  ...SG,
  pel: v3(-0.6, 0, 7.4),
  tilt: -0.22,
  twist: -0.45,
  fl: v3(1.9, -2.0, 0),
  fr: v3(-2.3, 2.0, 0),
  hr: v3(-1.6, 1.8, 18.0),
  hl: v3(-1.2, 0.2, 17.4),
  sv: vnorm(v3(-0.82, 0.2, 0.54)),
  head: v3(-0.3, 0, 0.2),
};
const ST_HIT: StP = {
  ...SG,
  pel: v3(1.8, 0, 6.8),
  tilt: 0.42,
  twist: 0.35,
  fl: v3(4.6, -2.0, 0),
  fr: v3(-3.0, 2.0, 0),
  hr: v3(6.0, 0.9, 8.0),
  hl: v3(5.2, -0.6, 8.3),
  sv: vnorm(v3(0.72, -0.05, -0.69)),
  head: v3(0.7, 0, -0.4),
  skirt: -0.6,
};
const A_WIND = angOf(ST_WIND.sv);
const A_HIT = angOf(ST_HIT.sv);
function stWind(k: number, from: StP): StP {
  if (k < 0.8) return mixSt(from, ST_WIND, eInOut(k / 0.8));
  const m = eIn(seg(k, 0.8, 1)) * 0.45;
  const P = mixSt(ST_WIND, ST_HIT, m);
  return { ...P, smear: m > 0.05 ? [A_WIND, angOf(P.sv), 0.7] : null };
}
function stRecover(t: number): StP {
  if (t < 1 / 24) return { ...ST_HIT, smear: [A_WIND, A_HIT, 1] };
  if (t < 0.13) {
    const k = eOut(seg(t, 1 / 24, 0.13));
    return {
      ...ST_HIT,
      smear: k < 0.9 ? [lerp(A_WIND, A_HIT, k * 0.7), A_HIT, 0.8 * (1 - k)] : null,
    };
  }
  return mixSt(ST_HIT, ST_FROZEN[0], eInOut(seg(t, 0.13, 0.5)));
}

/** Поклон взору идола: на колено, меч остриём в пол, голова опущена. */
const ST_BOW: StP = {
  ...SG,
  pel: v3(-0.4, 0, 4.8),
  tilt: 0.3,
  fl: v3(-2.4, -2.0, 0),
  fr: v3(1.6, 2.0, 0),
  kneel: 1,
  hr: v3(3.4, 0.6, 8.2),
  hl: v3(3.2, -0.6, 8.0),
  sv: vnorm(v3(0.15, 0, -1)),
  head: v3(0.7, 0, -1.0),
  eyes: 0,
};

// ---- Кадр -------------------------------------------------------------------------

const stFrames = frameLRU<MobFrame>(1200);
F4_MOB_STAT.size.f4_statue = () => stFrames.size;

function stFrame(
  key: string,
  d8: number,
  look: Look,
  flash: boolean,
  gold: boolean,
  cracks: number,
  P: StP,
  fall = -1,
): MobFrame {
  const fr = cached(stFrames, 'f4_statue', `${key}|${d8}|${look}|${gold ? 1 : 0}|${cracks}`, () => {
    const vw = viewOf(d8);
    const sc = new Scene(camOf(vw.yaw, S3_AX, S3_AY));
    const glow: [number, number, RGBA][] = [];
    const post: ((p: Px) => void)[] = [];
    stScene(sc, P, headView(vw.d), gold, cracks, eyeCol(look, EYE), glow, post, fall);
    const p = new Px(S3_W, S3_H);
    sc.paint(p);
    p.outline(INK);
    // След клинка — после контура: иначе дуга обводится чернилами и темнеет.
    for (const f of post) f(p);
    if (fall >= 0) stDust(p, fall);
    const pts = glow.map(([x, y, c]): [number, number, RGBA] => [vw.mir ? S3_W - 1 - x : x, y, c]);
    return bake(p, vw.mir, look, S3_AX, S3_AY, pts, { shadow: 8, still: true });
  });
  return withFlash(fr, flash);
}

/** Каменная пыль при обвале. */
function stDust(p: Px, k: number): void {
  const u = seg(k, 0.22, 0.9);
  if (u <= 0) return;
  for (let i = 0; i < 20; i++) {
    const h = hash01(i * 41 + 9);
    const a = h * TAU;
    const r = 3 + u * (8 + h * 9);
    const x = S3_AX + Math.cos(a) * r;
    const y = S3_AY - 1 + Math.sin(a) * r * 0.45 - u * (2 + h * 4);
    p.set(x, y, hex('#b8bab0', R(190 * (1 - u))));
  }
}

const ST_DIE_T = 0.9;

/** Последняя поза стража (держит оглушение и смерть) — по id. */
const LAST = new Map<number, { P: StP; now: number }>();

/**
 * Кадр нового рига, или null — пусть рисует прежний фасад (сон, постамент,
 * пробуждение, сборка из груды). Курс заводится и в фасадных режимах: страж
 * просыпается лицом к зрителю и сперва поворачивается, потом идёт.
 */
export function statueFrame(m: Mob, pose: MobPose, gold: boolean, cracks: number): MobFrame | null {
  const md = pose.mode;
  const id = m.id ?? -1;
  const facade =
    md === 'sleep' || md === 'dormant' || md === 'rise' || md === 'alert' || md === 'emerge';
  const want = facade ? PI / 2 : (m.face ?? 0);
  // Застыла — курс стоит (под взглядом камень не поворачивается); в миг, когда
  // застыла после шага, — уже повёрнута, как и поза.
  const v = visOf(m, pose, want, md === 'still' ? (pose.t < 0.06 ? 99 : 0) : 9);
  let mem = LAST.get(id);
  if (!mem || pose.now < mem.now - 0.05 || pose.now - mem.now > 1.5) {
    mem = { P: ST_FROZEN[0], now: pose.now };
    LAST.set(id, mem);
    if (LAST.size > 128) LAST.delete(LAST.keys().next().value as number);
  }
  mem.now = pose.now;
  if (facade) {
    mem.P = ST_FROZEN[0];
    return null;
  }
  const d8 = dir8(v.yaw);
  const look = pose.look;
  const t = pose.t;
  if (pose.anim === 'dead' || md === 'dying') {
    const i = fi(t, 21);
    // Глаза гаснут на третьем кадре, вместе с первым сколом.
    const from = { ...mem.P, smear: null, eyes: i < 3 ? mem.P.eyes : 0 };
    const fr = stFrame(`die|${i}|${poseKey(from)}`, d8, look, false, gold, cracks, from, i / 24);
    // Добивающий удар: камень вздрагивает (сжатие на кадре 0), потом трещины и обвал.
    const jolt = addFields(i === 0 ? { sx: 1.05, sy: 0.95 } : {}, hurtFields(v, pose.now, 0.7));
    return { ...fr, ...jolt, linger: ST_DIE_T, alpha: 1 - seg(t, 0.65, ST_DIE_T) };
  }
  const n = mod(m.data?.pose ?? 0, 4);
  const ghost = { every: 0.03, life: 0.14, tint: '#c8ccc0', alpha: 0.3 };
  let ex: Partial<MobFrame> = {};
  let P: StP;
  let key: string;
  if (md === 'still') {
    // Застыла камнем в новой позе — без перехода: обернулся, а она уже иначе.
    P = { ...ST_FROZEN[n], eyes: m.data?.eyes ?? 0 };
    key = `still|${n}|${P.eyes > 0.5 ? 1 : 0}`;
  } else if (md === 'creep' || md === 'chase') {
    const f = mod((v.dist / ST_WALK) * 8, 8);
    P = stWalk(f);
    key = `walk|${f}`;
  } else if (md === 'wind') {
    // Замах идёт, только пока на статую не смотрят, — кадр от накопленного замаха.
    const k = Math.min(1, (m.data?.wk ?? t) / 0.55);
    const i = Math.min(13, Math.floor(k * 13 + 1e-6));
    P = { ...stWind(i / 13, ST_FROZEN[0]), eyes: m.data?.eyes ?? 1 };
    key = `wind|${i}|${P.eyes > 0.5 ? 1 : 0}`;
    if (i >= 11) ex.ghost = ghost;
  } else if (md === 'recover') {
    const i = fi(t, 12);
    P = stRecover(i / 24);
    key = `rec|${i}`;
    if (i === 0) ex = { sx: 1.07, sy: 0.93, ghost };
    else if (i === 1) ex = { sx: 1.03, sy: 0.97 };
  } else if (md === 'bow') {
    const i = fi(t, 10);
    P = mixSt(ST_FROZEN[n], ST_BOW, eOut(i / 10));
    key = `bow|${i}|${n}`;
    if (i === 8 || i === 9) ex = { sx: 1.04, sy: 0.95 };
  } else {
    // Оглушён (0,1 с) и прочее — держит прежнюю позу, отдачу рисует удар.
    P = { ...mem.P, smear: null };
    key = `hold|${poseKey(P)}`;
  }
  mem.P = P;
  const fr = stFrame(key, d8, look, pose.flash, gold, cracks, P);
  ex = addFields(ex, hurtFields(v, pose.now, 0.7));
  return { ...fr, ...ex };
}

/** Ключ позы по числам (для удержания и смерти из любой позы). */
function poseKey(P: StP): string {
  return [
    ...P.pel,
    P.tilt * 5,
    P.twist * 5,
    ...P.fl,
    ...P.fr,
    ...P.hr,
    ...P.hl,
    ...P.sv.map((x) => x * 5),
    P.kneel,
    P.eyes,
  ]
    .map((x) => R(x * 2))
    .join(',');
}

registerMobWarm('f4_statue', function* () {
  for (const gold of [false, true])
    for (let d = 0; d < 8; d++) {
      for (let f = 0; f < 8; f++) {
        stFrame(`walk|${f}`, d, 'normal', false, gold, 0, stWalk(f));
        yield 0;
      }
      for (let n = 0; n < 4; n++) {
        stFrame(`still|${n}|0`, d, 'normal', false, gold, 0, { ...ST_FROZEN[n], eyes: 0 });
        yield 0;
      }
      for (let i = 0; i <= 13; i++) {
        stFrame(`wind|${i}|1`, d, 'normal', false, gold, 0, {
          ...stWind(i / 13, ST_FROZEN[0]),
          eyes: 1,
        });
        yield 0;
      }
      for (let i = 0; i <= 12; i++) {
        stFrame(`rec|${i}`, d, 'normal', false, gold, 0, stRecover(i / 24));
        yield 0;
      }
    }
});
