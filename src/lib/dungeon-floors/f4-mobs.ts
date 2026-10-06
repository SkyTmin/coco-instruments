// Этаж 4 «Двойная крипта» — костяк и кучка костей (анимации мобов 4). Набор
// рисунка (проекция 8 сторон, сцена, кадр, память) — `f4-mobkit.ts`.

import type { Mob } from '../dungeon-sim';
import { hex, mix, Px } from '../dungeon-art';
import {
  frameLRU,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
} from '../dungeon-paint';
import type { MobFrame } from '../dungeon-paint';
import {
  F4_MOB_STAT,
  PI,
  TAU,
  R,
  INK,
  WHITE,
  BONE,
  RUST,
  IRON,
  RAG,
  CAVITY,
  WOOD,
  EYE_RED,
  clamp01,
  lerp,
  seg,
  eIn,
  eOut,
  eInOut,
  fi,
  mod,
  hash01,
  v3,
  vadd,
  vsub,
  vmul,
  vnorm,
  vlerp,
  vslerp,
  ik,
  camOf,
  dir8,
  viewOf,
  headView,
  Scene,
  fillPoly,
  hull2,
  bake,
  cached,
  eyeCol,
  visOf,
  hurtFields,
  addFields,
  emptyFrame,
  withFlash,
} from './f4-mobkit';
import type { RGBA, P3, Look } from './f4-mobkit';

// =====================================================================================
// Костяк и кучка костей.
// =====================================================================================

const SK_W = 31;
const SK_H = 32;
const SK_AX = 15;
const SK_AY = 27;
const SK_EYE = mix(EYE_RED, WHITE, 0.15);

/** Поза костяка: всё в осях тела, земля — u = 0. */
interface SkP {
  pel: P3;
  /** Наклон корпуса вперёд, поворот плеч (+ — правое вперёд), крен вбок. */
  tilt: number;
  twist: number;
  roll: number;
  /** Сдвиг черепа от шеи. */
  head: P3;
  jaw: number;
  fl: P3;
  fr: P3;
  hl: P3;
  hr: P3;
  /** Меч: направление клинка (единичный вектор в осях тела). */
  sv: P3;
  /** Тряпка отстаёт: + назад. */
  rag: number;
  eyes: number;
  /** След меча: от направления, до направления, яркость. */
  smear: [P3, P3, number] | null;
}

const SK_G: SkP = {
  pel: v3(0, 0, 6.6),
  tilt: 0.08,
  twist: 0.12,
  roll: 0,
  head: v3(0, 0, 0),
  jaw: 0,
  fl: v3(0.5, -1.7, 0),
  fr: v3(-0.4, 1.7, 0),
  hl: v3(0.6, -2.9, 7),
  hr: v3(2.4, 2.1, 7.6),
  sv: vnorm(v3(0.85, 0.12, 0.5)),
  rag: 0,
  eyes: 1,
  smear: null,
};

function mixSk(a: SkP, b: SkP, k: number): SkP {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    pel: vlerp(a.pel, b.pel, k),
    tilt: lerp(a.tilt, b.tilt, k),
    twist: lerp(a.twist, b.twist, k),
    roll: lerp(a.roll, b.roll, k),
    head: vlerp(a.head, b.head, k),
    jaw: lerp(a.jaw, b.jaw, k),
    fl: vlerp(a.fl, b.fl, k),
    fr: vlerp(a.fr, b.fr, k),
    hl: vlerp(a.hl, b.hl, k),
    hr: vlerp(a.hr, b.hr, k),
    sv: vslerp(a.sv, b.sv, k),
    rag: lerp(a.rag, b.rag, k),
    eyes: lerp(a.eyes, b.eyes, k),
    smear: b.smear ?? a.smear,
  };
}

/** Череп 7×7 — пять видов (бок, ¾ к нам, лицом, ¾ спиной, спиной); смотрит вправо. */
const SKULLS: string[][] = [
  ['.hhhh..', 'hhmmmh.', 'hmmmmmh', 'mmmmnnm', 'smmmmmn', '.ssmhm.', '..sss..'],
  ['.hhhhh.', 'hhmmmmh', 'hmmmmmm', 'mmnnmnn', 'smmmnmm', '.smhmh.', '..sss..'],
  ['.hhhhh.', 'hhmmmhm', 'hmmmmms', 'mnnmnnm', 'smmnmms', '.shshs.', '..sss..'],
  ['.hhhhh.', 'hhmmmmh', 'hmmmmmm', 'mmmmmms', 'smmmmms', '.sssss.', '.......'],
  ['.hhhhh.', 'hhmmmmh', 'hmmmmms', 'mmmsmms', 'smmmmms', '.sssss.', '.......'],
];
/** Где в черепе глаза (по виду). */
const SKULL_EYES: [number, number][][] = [
  [[5, 3]],
  [
    [3, 3],
    [6, 3],
  ],
  [
    [2, 3],
    [4, 3],
  ],
  [],
  [],
];
const SKULL_PAL: Record<string, RGBA> = {
  h: BONE.hi,
  m: BONE.mid,
  s: BONE.sh,
  n: BONE.hole,
};

/** Нарисовать череп с левым верхним углом (x, y); глаза — в список светящихся. */
function paintSkull(
  p: Px,
  x: number,
  y: number,
  hv: number,
  jaw: number,
  eyes: number,
  glow: [number, number, RGBA][] | null,
  eye: RGBA = SK_EYE,
  flip = false,
): void {
  const rows = SKULLS[hv];
  const open = jaw >= 0.5 && hv <= 2;
  const cx = (c: number) => x + (flip ? 6 - c : c);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    // Челюсть — нижний ряд: открыта — опущена на точку, под зубами провал.
    const yy = r === 6 && open ? r + 1 : r;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c];
      if (ch === '.') continue;
      p.set(cx(c), y + yy, SKULL_PAL[ch]);
    }
  }
  if (open) for (let c = 2; c <= 4; c++) p.set(cx(c), y + 6, BONE.hole);
  if (eyes > 0)
    for (const [ex, ey] of SKULL_EYES[hv]) {
      const c = eyes >= 1 ? eye : mix(BONE.hole, eye, eyes);
      p.set(cx(ex), y + ey, c);
      if (glow && eyes >= 0.5) glow.push([R(cx(ex)), R(y + ey), c]);
    }
}

/** Ржавый меч в точке кисти по направлению `dir` (оси тела). */
function skSword(sc: Scene, hand: P3, dir: P3, len = 7): void {
  const d = vnorm(dir);
  const side: P3 = vnorm([-d[1] || 0.0001, d[0], 0]);
  const tip = vadd(hand, vmul(d, len));
  const T = sc.P(tip);
  const H = sc.P(hand);
  const pom = sc.P(vsub(hand, vmul(d, 1.2)));
  const g1 = sc.P(vadd(hand, vmul(side, 1.1)));
  const g2 = sc.P(vsub(hand, vmul(side, 1.1)));
  sc.add((T[2] + H[2]) / 2 + 0.3, (p) => {
    p.line(H[0], H[1], pom[0], pom[1], WOOD.dk);
    // Клинок: тень снизу, железо, ржа пятнами, светлое остриё.
    const n = Math.max(1, Math.round(Math.max(Math.abs(T[0] - H[0]), Math.abs(T[1] - H[1]))));
    for (let i = 1; i <= n; i++) {
      const x = H[0] + ((T[0] - H[0]) * i) / n;
      const y = H[1] + ((T[1] - H[1]) * i) / n;
      if (i < n - 1) p.set(x, y + 1, IRON.sh);
    }
    for (let i = 1; i <= n; i++) {
      const x = H[0] + ((T[0] - H[0]) * i) / n;
      const y = H[1] + ((T[1] - H[1]) * i) / n;
      const rust = (i * 7 + 3) % 5 === 0;
      p.set(x, y, i === n ? IRON.hi : rust ? RUST.mid : IRON.mid);
    }
    p.set(g1[0], g1[1], RUST.dk);
    p.set(g2[0], g2[1], RUST.dk);
  });
}

/** След клинка: веер от кисти между двумя направлениями, ярче у клинка. */
function skSmear(sc: Scene, hand: P3, a: P3, b: P3, k: number, len = 7.5): void {
  if (k <= 0.02) return;
  const H = sc.P(hand);
  const N = 9;
  const pts: [number, number, number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const d = vslerp(a, b, i / N);
    const A = sc.P(vadd(hand, vmul(d, 2.5)));
    const B = sc.P(vadd(hand, vmul(d, len)));
    pts.push([A[0], A[1], B[0], B[1]]);
  }
  sc.add(H[2] + 0.2, (p) => {
    for (let i = 0; i <= N; i++) {
      const [x0, y0, x1, y1] = pts[i];
      const al = R(255 * k * (0.12 + 0.7 * (i / N)));
      if (al < 16) continue;
      p.line(x0, y0, x1, y1, hex('#e8e2d0', al));
      p.set(x1, y1, hex('#ffffff', Math.min(255, al + 40)));
    }
  });
}

/** Ось корпуса костяка (наклон вперёд и крен). */
const skUp = (P: SkP): P3 => vnorm([Math.sin(P.tilt), Math.sin(P.roll), Math.cos(P.tilt)]);
/** Середина черепа в осях тела. */
const skSkull = (P: SkP): P3 => vadd(vadd(P.pel, vmul(skUp(P), 9)), P.head);

/** Собрать костяк по позе. `parts` — что уже собрано (подъём): 1 ноги, 2 таз, 4 хребет и рёбра, 8 руки, 16 меч, 32 череп. */
function skelScene(
  sc: Scene,
  P: SkP,
  hv: number,
  parts = 63,
  ribs = 3,
  glow: [number, number, RGBA][] | null = null,
  eye: RGBA = SK_EYE,
): void {
  const pel = P.pel;
  const up = skUp(P);
  const chest = vadd(pel, vmul(up, 4.5));
  const neck = vadd(chest, vmul(up, 2.1));
  const tw = P.twist;
  const shR = vadd(chest, [2.5 * Math.sin(tw), 2.5 * Math.cos(tw), 0.2]);
  const shL = vadd(chest, [-2.5 * Math.sin(tw), -2.5 * Math.cos(tw), 0.2]);
  const hipR = vadd(pel, [0.4 * Math.sin(tw * 0.3), 1.3, 0]);
  const hipL = vadd(pel, [-0.4 * Math.sin(tw * 0.3), -1.3, 0]);
  // Ближняя к зрителю сторона светлее.
  const dR = sc.P(shR)[2];
  const dL = sc.P(shL)[2];
  const nearR = dR > dL + 0.4;
  const nearL = dL > dR + 0.4;
  const col = (near: boolean, far: boolean) => (far ? BONE.sh : near ? BONE.mid : BONE.mid);
  if (parts & 1) {
    for (const [hip, foot, near, far] of [
      [hipL, P.fl, nearL, nearR],
      [hipR, P.fr, nearR, nearL],
    ] as [P3, P3, boolean, boolean][]) {
      const knee = ik(hip, foot, 3.5, 3.4, [1, 0, 0.2]);
      const c = col(near, far);
      sc.seg(hip, knee, c, null, far ? BONE.sh : BONE.hi);
      sc.seg(knee, foot, c);
      const toe = vadd(foot, [1.3, foot[1] > 0 ? 0.2 : -0.2, 0]);
      sc.seg(foot, toe, far ? BONE.dk : BONE.mid, null, null, 0.05);
    }
  }
  if (parts & 2) {
    // Таз чашей и погребальная тряпка (спереди, сзади, с боков — видна со всех сторон).
    sc.seg(hipL, hipR, BONE.mid, BONE.hi, BONE.sh);
    sc.seg(vadd(pel, [0, -0.7, -0.8]), vadd(pel, [0, 0.7, -0.8]), BONE.sh);
    const rg = P.rag;
    const flap = (f: number, s: number, df: number, ds: number, c: RGBA) => {
      const a = vadd(pel, [f - ds * 1.1, s + df * 1.1, -0.3]);
      const b = vadd(pel, [f + ds * 1.1, s - df * 1.1, -0.3]);
      const bb = vadd(b, [-rg * 0.9, 0, -3.2]);
      const aa = vadd(a, [-rg * 0.9, 0, -3.6]);
      sc.poly([a, b, bb, aa], (x, y, k) => (k > 0.8 ? ((x + y) % 2 ? RAG.dk : null) : c), 0.1);
    };
    flap(0.9, 0, 0, 1, RAG.mid);
    flap(-0.9, 0, 0, -1, RAG.dk);
    flap(0, 1.3, 1, 0, RAG.hi);
    flap(0, -1.3, -1, 0, RAG.dk);
  }
  if (parts & 4) {
    // Грудная клетка: тёмная полость (силуэт — оболочка рёбер), хребет,
    // ключицы и рёбра обручами, которые спускаются к груди. Видна только
    // ближняя к зрителю половина обруча — светлые полосы через тёмную.
    const nR = Math.min(3, ribs);
    const rings: P3[][] = [];
    for (let i = 0; i < nR; i++) {
      const c0 = vadd(pel, vmul(up, 1.9 + i * 1.55));
      const ws = [1.9, 2.4, 2.6][i];
      const fs = [1.1, 1.35, 1.45][i];
      const tr = tw * (0.4 + 0.3 * i);
      const ring: P3[] = [];
      for (let j = 0; j < 12; j++) {
        const a = (j / 12) * TAU;
        const f = Math.cos(a) * fs;
        const s = Math.sin(a) * ws;
        const fr = f * Math.cos(tr) - s * Math.sin(tr);
        const sr = f * Math.sin(tr) + s * Math.cos(tr);
        ring.push(vadd(c0, [fr, sr, -((1 + Math.cos(a)) / 2) * 0.7]));
      }
      rings.push(ring);
    }
    const cd = sc.P(vadd(pel, vmul(up, 3.2)))[2];
    if (nR) {
      const hull = hull2(rings.flat().map((q) => sc.P(q)));
      sc.add(cd - 0.9, (p) => fillPoly(p, hull, CAVITY));
    }
    sc.seg(pel, neck, BONE.sh, null, null, -0.2);
    if (nR >= 3) sc.seg(shL, shR, BONE.mid, BONE.hi, BONE.hi, 0.02);
    rings.forEach((ring, i) => {
      const c = sc.P(vadd(pel, vmul(up, 1.9 + i * 1.55)))[2];
      for (let j = 0; j < 12; j++) {
        const a = ring[j];
        const b = ring[(j + 1) % 12];
        if ((sc.P(a)[2] + sc.P(b)[2]) / 2 < c - 0.05) continue;
        sc.seg(a, b, i === 2 ? BONE.hi : BONE.mid, null, null, 0.05);
      }
    });
  }
  if (parts & 8) {
    for (const [sh, hand, near, far] of [
      [shL, P.hl, nearL, nearR],
      [shR, P.hr, nearR, nearL],
    ] as [P3, P3, boolean, boolean][]) {
      const out = sh === shR ? 1 : -1;
      const elbow = ik(sh, hand, 3.1, 3.1, [-0.6, out, -0.8]);
      const c = col(near, far);
      sc.seg(sh, elbow, c, far ? BONE.sh : BONE.hi, null, 0.1);
      sc.seg(elbow, hand, c, null, far ? BONE.sh : BONE.hi, 0.1);
    }
  }
  if (parts & 16) {
    if (P.smear) skSmear(sc, P.hr, P.smear[0], P.smear[1], P.smear[2]);
    skSword(sc, P.hr, P.sv);
  }
  if (parts & 32)
    sc.spr(
      skSkull(P),
      (p, x, y) => paintSkull(p, R(x - 3.4), R(y - 3.4), hv, P.jaw, P.eyes, glow, eye),
      0.6,
    );
}

// ---- Кучка: одна и та же груда у мёртвого костяка, у кучки и в начале подъёма -----------

/** Кость груды: концы в точках экрана от точки ног; `g` — куда сползается при сборе. */
interface HeapBone {
  a: [number, number];
  b: [number, number];
  /** Какая часть костяка (для подъёма: уходит из груды, когда собрана). */
  part: number;
  c: RGBA;
}
const HEAP: HeapBone[] = [
  { a: [-7, -1], b: [-2, -3], part: 1, c: BONE.mid },
  { a: [2, -3], b: [7, -1], part: 1, c: BONE.mid },
  { a: [-5, 0], b: [0, -1], part: 1, c: BONE.sh },
  { a: [1, 0], b: [5, -2], part: 1, c: BONE.sh },
  { a: [-3, -4], b: [-1, -5], part: 4, c: BONE.mid },
  { a: [-1, -4], b: [1, -5], part: 4, c: BONE.mid },
  { a: [1, -4], b: [3, -5], part: 4, c: BONE.mid },
  { a: [-6, -3], b: [-4, -6], part: 8, c: BONE.sh },
  { a: [4, -4], b: [7, -5], part: 8, c: BONE.sh },
];

/**
 * Груда костей: `k` — сколько накопилось подъёма (0 — разбросаны, 1 —
 * сползлись, вот-вот встанут); `j` — номер дрожи; `mir` — рисуется в
 * зеркальной стороне (груда не зеркалится: всегда одна и та же). `used` —
 * части, которые уже ушли в собирающийся костяк.
 */
function paintHeap(
  p: Px,
  k: number,
  j: number,
  eyes: number,
  mir: boolean,
  used = 0,
  skull = true,
  glow: [number, number, RGBA][] | null = null,
  eye: RGBA = SK_EYE,
): void {
  const sx = mir ? -1 : 1;
  const spread = 1 + (1 - k) * 0.55;
  const amp = k < 0.3 ? 0 : k < 0.85 ? 1 : 1.6;
  const jit = (n: number) => (j === 0 ? 0 : (((n * 7 + j * 5) % 3) - 1) * amp);
  const X = (x: number) => SK_AX + sx * x;
  const Y = (y: number) => SK_AY + y;
  // Таз и тряпка — в середине.
  if (!(used & 2)) {
    p.rect(X(-1) - (mir ? 2 : 0), Y(-2), X(-1) + (mir ? 0 : 2), Y(-1), BONE.sh);
    p.set(X(-1), Y(-2), BONE.mid);
    p.rect(X(2) - (mir ? 2 : 0), Y(-1), X(2) + (mir ? 0 : 2), Y(0), RAG.dk);
    p.set(X(3), Y(-1), RAG.mid);
  }
  HEAP.forEach((hb, i) => {
    if (used & hb.part) return;
    const ax = hb.a[0] * spread + jit(i);
    const bx = hb.b[0] * spread + jit(i + 3);
    const ay = hb.a[1] + (j && amp > 1 && i % 3 === 0 ? -1 : 0);
    const by = hb.b[1] + jit(i + 1) * 0.5;
    p.line(X(ax), Y(ay) + 0.4, X(bx), Y(by) + 0.4, BONE.dk);
    p.line(X(ax), Y(ay), X(bx), Y(by), hb.c);
    p.set(X(ax), Y(ay), BONE.hi);
    p.set(X(bx), Y(by), BONE.hi);
  });
  // Меч лежит поперёк.
  if (!(used & 16)) {
    const s0 = X(-8 * spread);
    const s1 = X(6 * spread);
    p.line(s0, Y(0), s1, Y(-1), IRON.sh);
    p.set(X(-8 * spread), Y(0), WOOD.dk);
    p.set(X(-7 * spread), Y(0), RUST.dk);
    p.set(X(6 * spread), Y(-1), IRON.hi);
    p.set(X(-2), Y(-1), RUST.mid);
  }
  // Череп: чем ближе подъём, тем выше он сидит на груде.
  if (skull && !(used & 32)) {
    const [x, y] = heapSkull(k, mir);
    const jaw = k > 0.8 && j === 1 ? 1 : 0;
    paintSkull(p, x, y - (j && amp > 1 ? 1 : 0), 1, jaw, eyes, glow, eye, mir);
  }
}

/**
 * Левый верхний угол черепа на груде (тот же у кучки, смерти и подъёма). В
 * зеркальной стороне — место, которое после отражения кадра совпадёт с
 * незеркальным (череп при этом рисуется отражённым — `flip`).
 */
function heapSkull(k: number, mir: boolean): [number, number] {
  const spread = 1 + (1 - k) * 0.55;
  const hx = lerp(4.5, 0, clamp01(k * 1.4)) * spread;
  const hy = lerp(-5, -8.5, clamp01((k - 0.3) / 0.6));
  const x = R(SK_AX + hx - 3.5);
  return [mir ? SK_W - 7 - x : x, R(SK_AY + hy - 2)];
}

// ---- Треки костяка ------------------------------------------------------------------

const SK_WALK = 0.75; // клеток на цикл из двух шагов

function skIdle(f: number): SkP {
  const a = (f / 8) * TAU;
  return {
    ...SK_G,
    pel: vadd(SK_G.pel, [0, 0.25 * Math.sin(a), 0.3 * Math.sin(a)]),
    roll: 0.05 * Math.sin(a),
    head: v3(0.2 * Math.sin(a - 0.6), 0.3 * Math.sin(a - 1.1), 0.35 * Math.sin(a - 0.9)),
    jaw: f === 5 ? 1 : 0,
    hr: vadd(SK_G.hr, [0, 0, 0.35 * Math.sin(a - 0.5)]),
    sv: vnorm(vadd(SK_G.sv, [0, 0, 0.12 * Math.sin(a - 0.8)])),
    hl: vadd(SK_G.hl, [0.35 * Math.sin(a + 1), 0, 0.2 * Math.sin(a + 0.3)]),
    rag: 0.35 * Math.sin(a - 1.4),
  };
}

function skWalk(f: number): SkP {
  const a = (f / 8) * TAU;
  const A = 2.9;
  const cl = Math.cos(a);
  const sl = Math.sin(a);
  // Нога в махе (идёт вперёд) поднята, опорная — на полу.
  const lift = (s: number) => Math.max(0, -s) * 1.5;
  const bob = 0.7 * (1 - Math.abs(cl)) - 0.35;
  const bobLag = 0.7 * (1 - Math.abs(Math.cos(a - 0.8))) - 0.35;
  return {
    ...SK_G,
    pel: v3(0.3, 0, 6.6 + bob),
    tilt: 0.16,
    twist: 0.22 * cl,
    fl: v3(0.3 + A * cl, -1.6, lift(sl)),
    fr: v3(0.3 - A * cl, 1.6, lift(-sl)),
    hl: v3(0.6 - 1.9 * cl, -2.9, 7 + 0.4 * Math.abs(cl)),
    hr: v3(2.6 + 0.6 * cl, 2.0, 7.3 + bob * 0.5),
    sv: vnorm(v3(0.8, 0.1, 0.3 + 0.1 * cl)),
    head: v3(0.3, 0, bobLag - bob),
    jaw: f === 2 || f === 6 ? 1 : 0,
    rag: 0.6 * Math.sin(a - 0.8) + 0.3,
  };
}

// Замах 0,42: подготовка (меч за плечо, присел) → задержка на пике (клацает
// челюстью) → удар через верх наискось → контакт = первый кадр `recover`.
const SK_COIL: SkP = {
  ...SK_G,
  pel: v3(-0.4, 0, 5.8),
  tilt: -0.12,
  twist: -0.55,
  head: v3(-0.4, 0, -0.2),
  jaw: 1,
  fl: v3(1.7, -1.7, 0),
  fr: v3(-1.5, 1.8, 0),
  hl: v3(2.1, -2.0, 8.6),
  hr: v3(-2.2, 1.7, 12.4),
  sv: vnorm(v3(-0.7, 0.42, 0.6)),
  rag: 0.6,
};
const SK_PEAK: SkP = {
  ...SK_COIL,
  pel: v3(-0.6, 0, 5.5),
  tilt: -0.2,
  twist: -0.68,
  head: v3(-0.6, 0, -0.1),
  hr: v3(-2.8, 1.5, 12.6),
  sv: vnorm(v3(-0.82, 0.45, 0.38)),
  hl: v3(2.4, -1.8, 9),
};
const SK_HIT: SkP = {
  ...SK_G,
  pel: v3(1.4, 0, 5.6),
  tilt: 0.36,
  twist: 0.5,
  head: v3(0.6, 0, -0.3),
  jaw: 1,
  fl: v3(2.7, -1.7, 0),
  fr: v3(-1.7, 1.8, 0),
  hl: v3(-0.4, -2.7, 7.2),
  hr: v3(4.6, 0.9, 6.6),
  sv: vnorm(v3(0.82, -0.28, -0.5)),
  rag: -0.5,
};
const SK_FOLLOW: SkP = {
  ...SK_HIT,
  pel: v3(1.6, 0, 5.3),
  tilt: 0.46,
  twist: 0.62,
  head: v3(0.8, 0, -0.4),
  hr: v3(4.3, 0.4, 4.9),
  sv: vnorm(v3(0.42, -0.45, -0.78)),
  rag: -0.2,
};
const SK_WIND_T = 0.42;

function skWindup(t: number): SkP {
  if (t < 0.12) return mixSk(SK_G, SK_COIL, eInOut(t / 0.12));
  if (t < 0.3) {
    const k = eIn(seg(t, 0.12, 0.3));
    const P = mixSk(SK_COIL, SK_PEAK, k);
    // Задержка на пике: челюсть клацает, глаза разгораются.
    return { ...P, jaw: fi(t, 99) % 2 ? 1 : 0, eyes: 1 };
  }
  const k = seg(t, 0.3, SK_WIND_T) ** 1.25;
  const P = mixSk(SK_PEAK, SK_HIT, k);
  return { ...P, smear: k > 0.08 ? [SK_PEAK.sv, P.sv, 0.95] : null };
}

function skRecover(t: number): SkP {
  if (t < 1 / 24) return { ...SK_HIT, smear: [SK_PEAK.sv, SK_HIT.sv, 1] };
  if (t < 0.125) {
    const k = eOut(seg(t, 1 / 24, 0.125));
    const P = mixSk(SK_HIT, SK_FOLLOW, k);
    return { ...P, smear: [SK_PEAK.sv, P.sv, 0.8 * (1 - k)] };
  }
  return mixSk(SK_FOLLOW, SK_G, eInOut(seg(t, 0.125, 0.35)));
}

// Оглушение 0,2 с: отброшен, руки врозь, череп запрокинут; возврат.
const SK_STUN: SkP = {
  ...SK_G,
  pel: v3(-0.9, 0, 6.1),
  tilt: -0.38,
  twist: -0.3,
  head: v3(-1.1, 0.3, 0.3),
  jaw: 1,
  fl: v3(0.8, -1.8, 0),
  fr: v3(-1.3, 1.8, 0.8),
  hl: v3(-0.6, -3.4, 11),
  hr: v3(0.4, 3.4, 10.5),
  sv: vnorm(v3(0.2, 0.5, 0.85)),
  rag: 0.8,
};
function skStun(t: number): SkP {
  if (t < 0.05) return mixSk(SK_G, SK_STUN, eOut(t / 0.05));
  if (t < 0.12) return SK_STUN;
  return mixSk(SK_STUN, SK_G, eInOut(seg(t, 0.12, 0.2)));
}

/**
 * Подъём из груды (0,55 с): груда дрожит → встают ноги (таз поднимается) →
 * хребет и рёбра по одному → руки, правая берёт меч из груды → череп
 * последним прыгает на шею, глаза вспыхивают.
 */
const SK_RISE_T = 0.55;
function skRise(t: number): { P: SkP; parts: number; ribs: number; used: number; hop: number } {
  let parts = 0;
  let used = 0;
  if (t >= 0.06) {
    parts |= 1 | 2;
    used |= 1 | 2;
  }
  if (t >= 0.16) {
    parts |= 4;
    used |= 4;
  }
  if (t >= 0.26) {
    parts |= 8;
    used |= 8;
  }
  if (t >= 0.3) {
    parts |= 16;
    used |= 16;
  }
  const ribs = t < 0.16 ? 0 : t < 0.2 ? 1 : t < 0.24 ? 2 : 3;
  const up = eOut(seg(t, 0.06, 0.32));
  const straight = eOut(seg(t, 0.16, 0.44));
  const grab = seg(t, 0.28, 0.46);
  const P: SkP = {
    ...SK_G,
    pel: v3(-0.2 * (1 - up), 0, lerp(1.4, 6.6, up)),
    tilt: lerp(1.0, SK_G.tilt, straight),
    twist: lerp(-0.3, SK_G.twist, straight),
    fl: v3(0.2, -1.8, 0),
    fr: v3(-0.2, 1.8, 0),
    hl: vlerp(v3(1.2, -2.6, 2.5), SK_G.hl, eOut(seg(t, 0.26, 0.44))),
    hr:
      grab < 0.35
        ? vlerp(v3(1.5, 2.2, 4), v3(2.2, 2.4, 1.2), eOut(grab / 0.35))
        : vlerp(v3(2.2, 2.4, 1.2), SK_G.hr, eInOut((grab - 0.35) / 0.65)),
    sv:
      grab < 0.35
        ? vnorm(v3(0.9, 0.2, -0.3))
        : vslerp(vnorm(v3(0.9, 0.2, -0.3)), SK_G.sv, eInOut((grab - 0.35) / 0.65)),
    jaw: t > 0.47 && t < 0.52 ? 1 : 0,
    eyes: t < 0.47 ? 0 : 1,
    rag: 0.6 * (1 - straight),
  };
  // Череп: до 0,36 лежит в груде, 0,36–0,47 — прыжок дугой на шею.
  let hop = -1;
  if (t >= 0.36) {
    used |= 32;
    const k = seg(t, 0.36, 0.47);
    if (k < 1) hop = k;
    else parts |= 32;
  }
  return { P, parts, ribs, used, hop };
}

const skFrames = frameLRU<MobFrame>(720);
F4_MOB_STAT.size.f4_skel = () => skFrames.size;

/** Кадр костяка по позе: 8 сторон (5 рисуются), глаза — в слой поверх темноты. */
function skelFrame(
  key: string,
  d8: number,
  look: Look,
  flash: boolean,
  build: (sc: Scene, hv: number, mir: boolean, glow: [number, number, RGBA][], eye: RGBA) => void,
): MobFrame {
  const fr = cached(skFrames, 'f4_skel', `${key}|${d8}|${look}`, () => {
    const vw = viewOf(d8);
    const sc = new Scene(camOf(vw.yaw, SK_AX, SK_AY));
    const glow: [number, number, RGBA][] = [];
    const eye = eyeCol(look, SK_EYE);
    const p = new Px(SK_W, SK_H);
    build(sc, headView(vw.d), vw.mir, glow, eye);
    sc.paint(p);
    p.outline(INK);
    const pts = glow.map(([x, y, c]): [number, number, RGBA] => [vw.mir ? SK_W - 1 - x : x, y, c]);
    return bake(p, vw.mir, look, SK_AX, SK_AY, pts, { shadow: 5 });
  });
  return withFlash(fr, flash);
}

/** Костяк по позе (обычный кадр). */
function skelPose(key: string, d8: number, look: Look, flash: boolean, P: SkP): MobFrame {
  return skelFrame(key, d8, look, flash, (sc, hv, _mir, glow, eye) =>
    skelScene(sc, P, hv, 63, 3, glow, eye),
  );
}

/** Череп в полёте между двумя точками (левый верхний угол), дугой вверх. */
function skullHop(
  sc: Scene,
  from: [number, number],
  to: [number, number],
  k: number,
  arc: number,
  hv: [number, number],
  flip: [boolean, boolean],
  eyes: number,
  glow: [number, number, RGBA][] | null,
  eye: RGBA,
): void {
  const x = R(lerp(from[0], to[0], eInOut(k)));
  const y = R(lerp(from[1], to[1], k) - Math.sin(k * PI) * arc);
  const e = k < 0.5 ? 0 : 1;
  sc.add(99, (p) => paintSkull(p, x, y, hv[e], 1, eyes, glow, eye, flip[e]));
}

/** Левый верхний угол черепа костяка в позе. */
function skullTL(sc: Scene, P: SkP): [number, number] {
  const S = sc.P(skSkull(P));
  return [R(S[0] - 3.4), R(S[1] - 3.4)];
}

/**
 * Подъём по кадру `i` (24 к/с; `alert` идёт тем же треком быстрее): груда
 * дрожит → встают ноги и таз → хребет и рёбра по одному → руки, правая
 * выдёргивает меч из груды → череп последним прыгает с груды на шею, глаза
 * вспыхивают в миг посадки.
 */
function skelRise(i: number, d8: number, look: Look, flash: boolean): MobFrame {
  const t = Math.min(SK_RISE_T, i / 24);
  return skelFrame(`rise|${i}`, d8, look, flash, (sc, hv, mir, glow, eye) => {
    const r = skRise(t);
    const rattle = t < 0.06 ? 1 + (i % 2) : 0;
    sc.add(-50, (p) =>
      paintHeap(p, 1, rattle, t < 0.06 ? 1 : 0, mir, r.used, true, t < 0.06 ? glow : null, eye),
    );
    if (r.hop >= 0)
      skullHop(
        sc,
        heapSkull(1, mir),
        skullTL(sc, r.P),
        r.hop,
        5,
        [1, hv],
        [mir, false],
        0,
        null,
        eye,
      );
    skelScene(sc, r.P, hv, r.parts, r.ribs, glow, eye);
  });
}

/**
 * Смерть костяка (0,3 с, дальше кадр пуст — груду рисует кучка, которую мозг
 * ставит в миг смерти на то же место): удар сносит череп, он летит дугой на
 * груду; остальное оседает «подъёмом наоборот» — руки и меч, рёбра, ноги.
 */
const SK_DIE_T = 0.3;
function skelDeath(i: number, d8: number, look: Look): MobFrame {
  const t = i / 24;
  return skelFrame(`die|${i}`, d8, look, false, (sc, hv, mir, _glow, eye) => {
    if (i === 0) {
      // Миг удара: отброшен, череп ещё на месте, глаза гаснут.
      skelScene(sc, { ...mixSk(SK_G, SK_STUN, 0.85), eyes: 0.4 }, hv, 63, 3, null, eye);
      return;
    }
    const back = seg(t, 0.04, SK_DIE_T - 0.01);
    const r = skRise(lerp(0.44, 0.05, back ** 1.3));
    const parts = r.parts & ~32;
    sc.add(-50, (p) => paintHeap(p, 0, 0, 0, mir, parts, t > 0.22, null, eye));
    skelScene(sc, { ...r.P, eyes: 0, jaw: 1 }, hv, parts, r.ribs, null, eye);
    if (t <= 0.22) {
      const from = skullTL(sc, { ...mixSk(SK_G, SK_STUN, 0.85) });
      skullHop(sc, from, heapSkull(0, mir), t / 0.22, 4, [hv, 1], [false, mir], 0, null, eye);
    }
  });
}

/** Курс костяка: идёт — по скорости, стоит или бьёт — куда смотрит. */
function headOf(m: Mob, tech: boolean): number {
  const vx = m.vx ?? 0;
  const vy = m.vy ?? 0;
  if (!tech && Math.hypot(vx, vy) > 0.5) return Math.atan2(vy, vx);
  return m.face ?? 0;
}

registerMobPainter('f4_skel', (m, pose) => {
  const md = pose.mode;
  const t = pose.t;
  const look = pose.look;
  const flash = pose.flash;
  const tech = md === 'windup' || md === 'recover' || md === 'rise' || md === 'alert';
  const v = visOf(m, pose, headOf(m, tech), tech ? 30 : 12);
  const d8 = dir8(v.yaw);
  let fr: MobFrame;
  let ex: Partial<MobFrame> = {};
  if (pose.anim === 'dead' || md === 'dying') {
    if (t >= SK_DIE_T) return emptyFrame();
    fr = skelDeath(fi(t, 7), d8, look);
    ex = { still: true };
  } else if (md === 'sleep') {
    // Спит грудой костей — как кучка, только без глаз; изредка кость дёргается.
    const ph = mod(pose.now * 0.5 + hash01(m.id ?? 0) * 3, 3);
    const tw = ph < 0.08 ? 1 : 0;
    fr = cached(skFrames, 'f4_skel', `sleep|${tw}|${look}`, () => {
      const p = new Px(SK_W, SK_H);
      paintHeap(p, 0.55, tw, 0, false);
      p.outline(INK);
      return bake(p, false, look, SK_AX, SK_AY, [], { shadow: 5 });
    });
    ex = { still: true };
  } else if (md === 'rise' || md === 'alert') {
    const T = md === 'alert' ? t * (SK_RISE_T / 0.35) : t;
    const i = fi(T, 13);
    fr = skelRise(i, d8, look, flash);
    const land = T - 0.47;
    ex = { still: true, ...(land >= 0 && land < 0.05 ? { sy: 0.93, sx: 1.06 } : {}) };
  } else if (md === 'windup') {
    const i = fi(t, 9);
    fr = skelPose(`wind|${i}`, d8, look, flash, skWindup(i / 24));
    ex = { still: true };
    if (i >= 8) ex.ghost = { every: 0.03, life: 0.12, tint: '#d8d0bc', alpha: 0.28 };
  } else if (md === 'recover' && v.prev !== 'stun') {
    const i = fi(t, 8);
    fr = skelPose(`rec|${i}`, d8, look, flash, skRecover(i / 24));
    ex =
      i === 0
        ? { still: true, sx: 1.08, sy: 0.92, dx: Math.cos(m.face ?? 0) * 1 }
        : { still: true };
    if (i === 0) ex.ghost = { every: 0.03, life: 0.12, tint: '#d8d0bc', alpha: 0.28 };
  } else if (md === 'stun') {
    const i = fi(t, 4);
    fr = skelPose(`stun|${i}`, d8, look, flash, skStun(i / 24));
  } else if (Math.hypot(m.vx ?? 0, m.vy ?? 0) > 0.4) {
    const f = mod((v.dist / SK_WALK) * 8, 8);
    fr = skelPose(`walk|${f}`, d8, look, flash, skWalk(f));
  } else {
    const f = mod(pose.now * 6 + hash01(m.id ?? 0) * 8, 8);
    fr = skelPose(`idle|${f}`, d8, look, flash, skIdle(f));
  }
  if (md !== 'dying' && pose.anim !== 'dead') ex = addFields(ex, hurtFields(v, pose.now));
  return { ...fr, ...ex };
});

registerMobWarm('f4_skel', function* () {
  for (let d = 0; d < 8; d++) {
    for (let f = 0; f < 8; f++) {
      skelPose(`walk|${f}`, d, 'normal', false, skWalk(f));
      yield 0;
    }
    for (let f = 0; f < 8; f++) {
      skelPose(`idle|${f}`, d, 'normal', false, skIdle(f));
      yield 0;
    }
  }
  for (let d = 0; d < 8; d++) {
    for (let i = 0; i <= 9; i++) {
      skelPose(`wind|${i}`, d, 'normal', false, skWindup(i / 24));
      yield 0;
    }
    for (let i = 0; i <= 8; i++) {
      skelPose(`rec|${i}`, d, 'normal', false, skRecover(i / 24));
      yield 0;
    }
    for (let i = 0; i <= 13; i++) {
      skelRise(i, d, 'normal', false);
      yield 0;
    }
  }
});

// ---- Кучка костей -----------------------------------------------------------------

const pileFrames = frameLRU<MobFrame>(200);
F4_MOB_STAT.size.f4_bones = () => pileFrames.size;

function pileFrame(
  key: string,
  look: Look,
  flash: boolean,
  draw: (p: Px, glow: [number, number, RGBA][], eye: RGBA) => void,
  ex: Partial<MobFrame> = {},
): MobFrame {
  return {
    ...cached(pileFrames, 'f4_bones', `${key}|${look}`, () => {
      const p = new Px(SK_W, SK_H);
      const glow: [number, number, RGBA][] = [];
      draw(p, glow, eyeCol(look, SK_EYE));
      p.outline(INK);
      return bake(p, false, look, SK_AX, SK_AY, glow, { shadow: 6, still: true });
    }),
    ...ex,
  };
}

/** Кости разлетаются: каждая — своей дугой от удара, череп раскалывается, пыль. */
function paintShatter(p: Px, t: number, side: number): void {
  const X = (x: number) => SK_AX + x;
  const Y = (y: number) => SK_AY + y;
  HEAP.forEach((hb, i) => {
    const h = hash01(i * 13 + 5);
    const vx = (hb.a[0] + hb.b[0]) * 0.35 + side * (2 + h * 5);
    const vz = 6 + h * 8;
    const tt = Math.min(t, 0.32 + h * 0.1);
    const ox = vx * tt * 2.2;
    const oz = Math.max(0, vz * tt * 3 - 60 * tt * tt);
    const rot = (h - 0.5) * 6 * tt;
    const cx = (hb.a[0] + hb.b[0]) / 2;
    const cy = (hb.a[1] + hb.b[1]) / 2;
    const hx = (hb.b[0] - hb.a[0]) / 2;
    const hy = (hb.b[1] - hb.a[1]) / 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const x0 = cx + ox - (hx * c - hy * s);
    const y0 = cy - oz - (hx * s + hy * c);
    const x1 = cx + ox + (hx * c - hy * s);
    const y1 = cy - oz + (hx * s + hy * c);
    p.line(X(x0), Y(y0), X(x1), Y(y1), hb.c);
    p.set(X(x1), Y(y1), BONE.hi);
  });
  // Череп раскололся надвое.
  const k = clamp01(t / 0.3);
  const hz = Math.max(0, 7 * k - 9 * k * k) * 3;
  for (const s of [-1, 1]) {
    const x = X(side * 2 + s * (1 + k * 4)) - 2;
    const y = Y(-6 - hz + k * 4);
    p.rect(x, y, x + 2, y + 2, BONE.mid);
    p.set(x + (s < 0 ? 0 : 2), y, BONE.hi);
    p.set(x + 1, y + 1, BONE.hole);
  }
  // Пыль кости — светлые точки, оседают.
  for (let i = 0; i < 10; i++) {
    const h = hash01(i * 31 + 7);
    const a = h * TAU;
    const r = 2 + t * (10 + h * 10);
    const x = X(Math.cos(a) * r);
    const y = Y(-2 - Math.abs(Math.sin(a)) * r * 0.5 + t * 6);
    p.set(x, y, hex('#d8d0bc', R(200 * (1 - clamp01(t / 0.5)))));
  }
}

registerMobPainter('f4_bones', (m, pose) => {
  const data = m.data ?? {};
  const look: Look = data.elite === 1 ? 'elite' : 'normal';
  const t = pose.t;
  const v = visOf(m, pose, m.face ?? 0, 0);
  if (pose.anim === 'dead' || pose.mode === 'dying') {
    const i = fi(t, 14);
    const side = Math.cos(v.hitAng) < 0 ? -1 : 1;
    return pileFrame(`die|${i}|${side}`, 'normal', false, (p) => paintShatter(p, i / 24, side), {
      linger: 0.6,
      alpha: 1 - seg(i / 24, 0.4, 0.6),
    });
  }
  // Только что рассыпался костяк — первые 0,3 с кости ещё падают (их рисует он).
  if (data.skHp !== undefined && t < SK_DIE_T && (data.k ?? 0) < 0.05) return emptyFrame();
  const k = clamp01(data.k ?? 0);
  const ks = Math.round(k * 12);
  // Дрожь: чем ближе подъём, тем чаще и сильнее (12 к/с, фаза от номера).
  const jr = k < 0.3 ? 0 : 1 + mod(pose.now * (k < 0.85 ? 8 : 14) + hash01(m.id ?? 0) * 3, 2);
  const eyes = k < 0.55 ? 0 : k < 0.7 ? 0.5 : 1;
  let ex: Partial<MobFrame> = {};
  // Кости из-под плит (некромант): груда поднимается из пола.
  if (data.skHp === undefined && t < 0.3 && pose.mode === 'pile' && v.prev === '') {
    const i = fi(t, 7);
    return pileFrame(`up|${i}|${ks}`, look, pose.flash, (p, glow, eye) => {
      const q = new Px(SK_W, SK_H);
      const g0: [number, number, RGBA][] = [];
      paintHeap(q, k, 0, eyes, false, 0, true, g0, eye);
      const rise = R(lerp(9, 0, eOut(i / 7)));
      for (const [x, y, c] of g0) if (y + rise <= SK_AY) glow.push([x, y + rise, c]);
      for (let y = 0; y < SK_H; y++)
        for (let x = 0; x < SK_W; x++) {
          const yy = y - rise;
          if (yy < 0) continue;
          const c = q.get(x, yy);
          if (c[3] && y <= SK_AY) p.set(x, y, c);
        }
      // Земля из-под плит: комья по краю.
      for (let x = -6; x <= 6; x += 2)
        p.set(SK_AX + x, SK_AY - (x % 4 === 0 ? 1 : 0), hex('#4a3e34'));
    });
  }
  const fr = pileFrame(`pile|${ks}|${jr}|${eyes}`, look, pose.flash, (p, glow, eye) =>
    paintHeap(p, k, jr, eyes, false, 0, true, glow, eye),
  );
  ex = hurtFields(v, pose.now, 0.6);
  return { ...fr, ...ex };
});

registerMobWarm('f4_bones', function* () {
  for (let ks = 0; ks <= 12; ks++)
    for (let jr = 0; jr <= 2; jr++) {
      const k = ks / 12;
      if (k < 0.3 && jr) continue;
      const eyes = k < 0.55 ? 0 : k < 0.7 ? 0.5 : 1;
      pileFrame(`pile|${ks}|${jr}|${eyes}`, 'normal', false, (p, glow, eye) =>
        paintHeap(p, k, jr, eyes, false, 0, true, glow, eye),
      );
      yield 0;
    }
});

// ---- Контакт: кости встают (подъём костяка и кости из-под плит некроманта) ----------

registerImpactPainter('f4_rise', {
  life: 0.7,
  shake: 0.05,
  paint: (g, rec, px, py, _scale, age) => {
    const u = clamp01(age / 0.7);
    // Пыль кольцом по полу.
    for (let i = 0; i < 12; i++) {
      const h = hash01((rec.seed + i * 17) | 0);
      const a = (i / 12) * TAU + h;
      const r = 3 + eOut(u) * (8 + h * 4);
      g.globalAlpha = 0.55 * (1 - u);
      g.fillStyle = i % 3 ? '#8c8070' : '#b8ad98';
      g.fillRect(
        Math.round(px + Math.cos(a) * r),
        Math.round(py + 1 + Math.sin(a) * r * 0.5 - eOut(u) * 2),
        i % 4 ? 1 : 2,
        1,
      );
    }
    // Щепки кости подлетают и падают.
    for (let i = 0; i < 4; i++) {
      const h = hash01((rec.seed >> 3) + i * 29);
      const a = h * TAU;
      const tt = Math.min(age, 0.45);
      const x = px + Math.cos(a) * (4 + 14 * tt);
      const z = Math.max(0, 22 * tt - 90 * tt * tt);
      g.globalAlpha = 1 - seg(age, 0.4, 0.7);
      g.fillStyle = '#e8e2d0';
      g.fillRect(Math.round(x), Math.round(py + Math.sin(a) * 3 - z), 1, 1);
    }
    g.globalAlpha = 1;
    return true;
  },
});
