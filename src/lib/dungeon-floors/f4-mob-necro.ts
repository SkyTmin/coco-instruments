// Этаж 4 «Двойная крипта» — некромант (анимации мобов 4): балахон колоколом,
// капюшон с тьмой и двумя зелёными глазами, посох с черепом и могильным огнём.
// Каст — посох вперёд, огонь копится и срывается снарядом в кадр выстрела;
// поднятие — руки и посох вверх, удар пяткой посоха в миг подъёма костей;
// перенос — распад в пепел и сборка. Огонь и глаза — слой поверх темноты.

import type { Shot } from '../dungeon-sim';
import { hex, Px } from '../dungeon-art';
import {
  frameLRU,
  registerImpactPainter,
  registerMobPainter,
  registerMobWarm,
  registerShotPainter,
} from '../dungeon-paint';
import type { MobFrame, Sprite } from '../dungeon-paint';
import {
  F4_MOB_STAT,
  INK,
  PI,
  R,
  Scene,
  TAU,
  WOOD,
  addFields,
  cached,
  camOf,
  clamp01,
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
  offOf,
  mod,
  seg,
  v3,
  vadd,
  vlerp,
  vmul,
  vnorm,
  vslerp,
  viewOf,
  visOf,
  withFlash,
} from './f4-mobkit';
import type { Look, P3, RGBA } from './f4-mobkit';

const ROBE = {
  hi: hex('#6e5a7e'),
  mid: hex('#4a3856'),
  dk: hex('#2c2036'),
  deep: hex('#1a1220'),
};
const GREEN = { hi: hex('#e2ffd4'), mid: hex('#8cff7c'), dk: hex('#2eae4c') };
const BONE = { hi: hex('#f4efe0'), mid: hex('#d8cfb8'), sh: hex('#a79d84'), hole: hex('#1c1412') };
const GOLD_DK = hex('#8a6a20');
const BOOK = { mid: hex('#6a2a2a'), hi: hex('#9a4a3a') };
const EYE_GREEN = hex('#8aff7a');

const NC_W = 41;
const NC_H = 46;
const NC_AX = 20;
const NC_AY = 37;

interface NcP {
  /** Подъём над полом (парит), наклон вперёд, сдвиг корпуса. */
  hover: number;
  tilt: number;
  off: P3;
  /** Подол отстаёт: + назад. */
  hem: number;
  head: P3;
  /** Кисти: правая держит посох, левая свободна. */
  hr: P3;
  hl: P3;
  /** Посох: направление от кисти к навершию, кисть — доля от пятки. */
  st: P3;
  grip: number;
  /** Огонь на навершии 0…1 (размер), глаза. */
  fire: number;
  eyes: number;
  /** Капюшон откинут назад (поднятие). */
  hood: number;
}

const NG: NcP = {
  hover: 1.2,
  tilt: 0.04,
  off: v3(0, 0, 0),
  hem: 0,
  head: v3(0, 0, 0),
  hr: v3(1.6, 3.4, 9.5),
  hl: v3(1.6, -2.6, 8.4),
  st: vnorm(v3(0.1, 0.06, 1)),
  grip: 0.42,
  fire: 0.45,
  eyes: 1,
  hood: 0,
};

function mixNc(a: NcP, b: NcP, k: number): NcP {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    hover: lerp(a.hover, b.hover, k),
    tilt: lerp(a.tilt, b.tilt, k),
    off: vlerp(a.off, b.off, k),
    hem: lerp(a.hem, b.hem, k),
    head: vlerp(a.head, b.head, k),
    hr: vlerp(a.hr, b.hr, k),
    hl: vlerp(a.hl, b.hl, k),
    st: vslerp(a.st, b.st, k),
    grip: lerp(a.grip, b.grip, k),
    fire: lerp(a.fire, b.fire, k),
    eyes: lerp(a.eyes, b.eyes, k),
    hood: lerp(a.hood, b.hood, k),
  };
}

// ---- Капюшон: 5 видов 9×9 -------------------------------------------------------------

const HOODS: string[][] = [
  [
    '...hm....',
    '..hmmm...',
    '.hmmmmd..',
    '.hmmmddd.',
    'hmmmmdde.',
    'hmmmmddd.',
    'hmmmmddd.',
    '.mmmmmmd.',
    '..ddddd..',
  ],
  [
    '...hm....',
    '..hmmm...',
    '.hmmmmmd.',
    '.hmmddddm',
    'hmmedded.',
    'hmmdddddm',
    'hmmmddmmd',
    '.mmmmmmd.',
    '..ddddd..',
  ],
  [
    '....hm...',
    '...hmmd..',
    '..hmmmmd.',
    '.hmdddmmd',
    '.hmeddemd',
    '.hmddddmd',
    '.hmmddmmd',
    '.mmmmmmmd',
    '..ddddd..',
  ],
  [
    '....hm...',
    '...hmmm..',
    '..hmmmmd.',
    '.hmmmmmmd',
    '.hmmmmmmd',
    '.hmmmmmmd',
    '.hmmmmmdd',
    '.mmmmmmd.',
    '..ddddd..',
  ],
  [
    '....hm...',
    '...hmmm..',
    '..hmmmmd.',
    '.hmmmmmdd',
    '.hmmmmmmd',
    '.hmmmmmmd',
    '.hmmmmmmd',
    '.mmmmmmmd',
    '..ddddd..',
  ],
];

const HOOD_PAL: Record<string, RGBA> = { h: ROBE.hi, m: ROBE.mid, d: ROBE.deep };

function paintHood(
  p: Px,
  x: number,
  y: number,
  hv: number,
  eyes: number,
  eye: RGBA,
  glow: [number, number, RGBA][] | null,
  back = 0,
): void {
  const rows = HOODS[hv];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const ch = rows[r][c];
      if (!ch || ch === '.') continue;
      // Откинутый капюшон: верх опускается назад, лицо светлее (череп под ним).
      if (back > 0.5 && r < 2) continue;
      if (ch === 'e') {
        const col: RGBA =
          eyes > 0 ? [eye[0], eye[1], eye[2], R(255 * Math.min(1, eyes))] : ROBE.deep;
        p.set(x + c, y + r, col);
        if (eyes >= 0.5 && glow) glow.push([x + c, y + r, eye]);
      } else
        p.set(x + c, y + r, back > 0.5 && ch === 'd' && r >= 3 && r <= 6 ? BONE.sh : HOOD_PAL[ch]);
    }
}

// ---- Тело ------------------------------------------------------------------------------

/** Огонь на навершии посоха — только в слой поверх темноты (сам кадр огонь не хранит). */
function flamePts(
  x: number,
  y: number,
  size: number,
  ph: number,
  out: [number, number, RGBA][],
): void {
  if (size <= 0.05) return;
  const h = Math.max(1, R(1 + size * 5));
  for (let i = 0; i < h; i++) {
    const w = Math.max(0, R(((h - i) / h) * (0.6 + size * 1.6)));
    const sw = i > 0 ? R(Math.sin(ph * 1.7 + i * 0.9) * Math.min(1, i * 0.5)) : 0;
    const c = i === 0 || (i === 1 && size > 0.6) ? GREEN.hi : i < h - 1 ? GREEN.mid : GREEN.dk;
    for (let dx = -w; dx <= w; dx++)
      out.push([x + dx + sw, y - i, Math.abs(dx) === w && w > 0 ? GREEN.dk : c]);
  }
  // Искры над огнём.
  if (size > 0.5) {
    const n = size > 0.8 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = ph * 2.1 + (i / n) * TAU;
      out.push([
        R(x + Math.cos(a) * (2 + size * 2)),
        R(y - h + Math.sin(a) * 2 - ((ph * 3 + i) % 3)),
        GREEN.hi,
      ]);
    }
  }
}

interface NcOut {
  /** Навершие посоха на холсте (до зеркала). */
  top: [number, number];
}

function ncScene(
  sc: Scene,
  P: NcP,
  hv: number,
  glow: [number, number, RGBA][],
  eye: RGBA,
  out: NcOut,
): void {
  const base = vadd(P.off, [0, 0, P.hover]);
  const up: P3 = vnorm([Math.sin(P.tilt), 0, Math.cos(P.tilt)]);
  const sh = vadd(base, vmul(up, 13.5));
  const ring = (c: P3, rf: number, rs: number, back: number, n = 12): P3[] => {
    const o: P3[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const f = Math.cos(a) * rf - (Math.cos(a) < 0 ? back : back * 0.4);
      o.push(vadd(c, [f, Math.sin(a) * rs, 0]));
    }
    return o;
  };
  const hemC = vadd(base, [-P.hem * 0.6, 0, 0]);
  const hem = ring(hemC, 4.1, 4.7, P.hem);
  const top = ring(sh, 2.0, 2.9, 0);
  const H = hull2([...hem, ...top].map((q) => sc.P(q)));
  const hx = H.reduce((a, q) => a + q[0], 0) / H.length;
  const yTop = Math.min(...H.map((q) => q[1]));
  const yBot = Math.max(...H.map((q) => q[1]));
  const dBody = sc.P(vadd(base, vmul(up, 6)))[2];
  sc.add(dBody, (p) =>
    fillPoly(p, H, (x, y) => {
      if (y >= yBot - 1.5 && (x + y) % 2 === 0) return ROBE.deep;
      const rel = x - hx;
      const k = (y - yTop) / Math.max(1, yBot - yTop);
      return rel < -2.2 + k * -0.8 ? ROBE.hi : rel > 1.8 + k * 0.6 ? ROBE.dk : ROBE.mid;
    }),
  );
  // Складки: линии от груди к подолу на своих местах тела — поворачиваются с ним.
  for (const a of [0.5, 1.6, 2.6, 3.7, 4.8, 5.7]) {
    const t = vadd(sh, [Math.cos(a) * 1.5, Math.sin(a) * 2.2, -3]);
    const b = vadd(hemC, [Math.cos(a) * 3.2, Math.sin(a) * 3.8, 0.6]);
    const dt = (sc.P(t)[2] + sc.P(b)[2]) / 2;
    if (dt < dBody) continue;
    sc.seg(t, b, ROBE.dk, null, null, 0.05);
  }
  // Пояс-верёвка спереди и гримуар на левом бедре.
  const waist = vadd(base, vmul(up, 8.2));
  const belt = ring(waist, 2.55, 3.1, 0, 10);
  for (let i = 0; i < 10; i++) {
    const a = belt[i];
    const b = belt[(i + 1) % 10];
    if ((sc.P(a)[2] + sc.P(b)[2]) / 2 < dBody) continue;
    sc.seg(a, b, GOLD_DK, null, null, 0.1);
  }
  const book = vadd(waist, [0.4, -3.3, -1.6]);
  sc.spr(
    book,
    (p, x, y) => {
      p.rect(R(x) - 1, R(y) - 1, R(x) + 1, R(y) + 2, BOOK.mid);
      p.set(R(x) - 1, R(y) - 1, BOOK.hi);
      p.set(R(x), R(y), GOLD_DK);
    },
    0.2,
  );
  // Рукава и костяные кисти.
  const shR = vadd(sh, [0, 2.6, -0.4]);
  const shL = vadd(sh, [0, -2.6, -0.4]);
  for (const [s, h, sg] of [
    [shR, P.hr, 1],
    [shL, P.hl, -1],
  ] as [P3, P3, number][]) {
    const el = ik(s, h, 3.6, 3.4, [-0.4, 0.8 * sg, -0.8]);
    sc.thick(s, el, ROBE.mid, ROBE.dk, 0.15);
    sc.thick(el, h, ROBE.mid, ROBE.dk, 0.15);
    sc.seg(h, h, BONE.mid, null, null, 0.3);
  }
  // Посох: древко, череп-навершие, огонь — в слой поверх темноты.
  const d = P.st;
  const L = 22;
  const butt = vsub3(P.hr, vmul(d, L * P.grip));
  const tip = vadd(P.hr, vmul(d, L * (1 - P.grip)));
  const B = sc.P(butt);
  const T = sc.P(tip);
  out.top = [R(T[0]), R(T[1]) - 2];
  sc.add((B[2] + T[2]) / 2 + 0.25, (p) => {
    p.line(B[0], B[1], T[0], T[1], WOOD.dk);
    const n = Math.max(1, R(Math.max(Math.abs(T[0] - B[0]), Math.abs(T[1] - B[1]))));
    for (let i = 0; i <= n; i += 4)
      p.set(B[0] + ((T[0] - B[0]) * i) / n, B[1] + ((T[1] - B[1]) * i) / n, WOOD.hi);
    // Череп на навершии.
    const x = R(T[0]) - 1;
    const y = R(T[1]) - 2;
    p.rect(x, y, x + 2, y + 1, BONE.mid);
    p.set(x, y, BONE.hi);
    p.set(x + 1, y + 1, BONE.hole);
    p.set(x, y + 2, BONE.sh);
    p.set(x + 2, y + 2, BONE.sh);
  });
  // Капюшон.
  const headAt = vadd(vadd(sh, vmul(up, 2.6)), P.head);
  sc.spr(headAt, (p, x, y) => paintHood(p, R(x) - 4, R(y) - 5, hv, P.eyes, eye, glow, P.hood), 0.7);
}

const vsub3 = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// ---- Треки -------------------------------------------------------------------------

/** Парит: 8 кадров на 4 к/с, подол колышется, огонь дрожит. */
function ncIdle(f: number): NcP {
  const a = (f / 8) * TAU;
  return {
    ...NG,
    hover: NG.hover + 0.7 * Math.sin(a),
    hem: 0.35 * Math.sin(a - 1.2),
    head: v3(0, 0, 0.3 * Math.sin(a - 0.6)),
    hr: vadd(NG.hr, [0, 0, 0.4 * Math.sin(a - 0.3)]),
    hl: vadd(NG.hl, [0.3 * Math.sin(a + 0.5), 0, 0.3 * Math.sin(a - 0.2)]),
  };
}

/** Плывёт: подол отстаёт по ходу, корпус клонится в ход (md — ход относительно взгляда). */
const NC_GLIDE = 1.2;
function ncMove(f: number, md: number): NcP {
  const a = (f / 8) * TAU;
  const ma = (md * PI) / 4;
  const fw = Math.cos(ma);
  return {
    ...ncIdle(f),
    tilt: 0.04 + 0.16 * fw,
    off: v3(0.3 * fw, 0.3 * Math.sin(ma), 0),
    hem: 0.9 * fw + 0.35 * Math.sin(a),
  };
}

// Каст 0,85 с: посох поднят (отклонился назад), огонь растёт, искры
// стягиваются; в 0,72–0,85 — посох выброшен вперёд, снаряд — в кадр выстрела.
const NC_CHARGE: NcP = {
  ...NG,
  tilt: -0.14,
  off: v3(-0.4, 0, 0),
  hem: 0.4,
  head: v3(-0.3, 0, 0.2),
  hr: v3(0.6, 3.0, 12.6),
  hl: v3(3.0, -1.6, 10.6),
  st: vnorm(v3(0.35, 0.05, 1)),
  grip: 0.38,
  fire: 1,
};
const NC_THRUST: NcP = {
  ...NG,
  tilt: 0.26,
  off: v3(0.7, 0, 0),
  hem: 0.7,
  head: v3(0.5, 0, -0.3),
  hr: v3(4.8, 1.8, 11.0),
  hl: v3(-0.6, -3.4, 8.4),
  st: vnorm(v3(1, -0.08, 0.42)),
  grip: 0.36,
  fire: 1.15,
};
const NC_AIM_T = 0.85;
function ncAim(t: number): NcP {
  if (t < 0.24) return mixNc(NG, NC_CHARGE, eInOut(t / 0.24));
  if (t < 0.7) {
    const k = seg(t, 0.24, 0.7);
    return { ...NC_CHARGE, fire: 0.6 + 0.5 * k, hover: NG.hover + 0.4 * k };
  }
  return mixNc(NC_CHARGE, NC_THRUST, eIn(seg(t, 0.7, NC_AIM_T)));
}
/** Отдых после выстрела 0,45: кадр 0 — выстрел (огонь сорвался), отдача, возврат. */
function ncShotRecover(t: number): NcP {
  if (t < 1 / 24) return { ...NC_THRUST, fire: 0.15 };
  if (t < 0.17)
    return { ...mixNc(NC_THRUST, NG, eOut(seg(t, 1 / 24, 0.17)) * 0.5), fire: 0.2, tilt: -0.05 };
  return {
    ...mixNc(mixNc(NC_THRUST, NG, 0.5), NG, eInOut(seg(t, 0.17, 0.45))),
    fire: lerp(0.2, NG.fire, seg(t, 0.17, 0.45)),
  };
}

// Поднятие 1,1 с: руки разведены низко → медленно вверх, капюшон откинут,
// посох над головой; в миг подъёма (кадр 0 отдыха) — удар пяткой посоха.
const NC_CALL_LOW: NcP = {
  ...NG,
  hover: 0.6,
  tilt: 0.12,
  hr: v3(1.2, 4.6, 6.4),
  hl: v3(1.2, -4.6, 6.4),
  st: vnorm(v3(0.3, 0.3, 1)),
  fire: 0.7,
};
const NC_CALL_HIGH: NcP = {
  ...NG,
  hover: 2.6,
  tilt: -0.18,
  head: v3(-0.4, 0, 0.4),
  hr: v3(0.6, 3.4, 16.5),
  hl: v3(0.8, -3.6, 16.2),
  st: vnorm(v3(0.1, 0.12, 1)),
  grip: 0.2,
  fire: 1.2,
  hood: 1,
};
const NC_SLAM: NcP = {
  ...NG,
  hover: 0.4,
  tilt: 0.3,
  off: v3(0.4, 0, 0),
  hem: -0.4,
  head: v3(0.6, 0, -0.6),
  hr: v3(3.2, 2.4, 9.0),
  hl: v3(2.2, -2.0, 7.0),
  st: vnorm(v3(0.2, 0.05, 1)),
  grip: 0.6,
  fire: 0.9,
  hood: 0,
};
function ncRaise(t: number): NcP {
  if (t < 0.25) return mixNc(NG, NC_CALL_LOW, eOut(t / 0.25));
  if (t < 0.92) return mixNc(NC_CALL_LOW, NC_CALL_HIGH, eInOut(seg(t, 0.25, 0.92)));
  return { ...NC_CALL_HIGH, hover: NC_CALL_HIGH.hover + 0.4 * eOut(seg(t, 0.92, 1.1)) };
}
function ncRaiseRecover(t: number): NcP {
  if (t < 2 / 24) return NC_SLAM;
  return mixNc(NC_SLAM, NG, eInOut(seg(t, 2 / 24, 0.45)));
}

// Сбит (0,2 с): откинуло, огонь сбит.
const NC_HIT: NcP = {
  ...NG,
  tilt: -0.35,
  off: v3(-0.8, 0, 0),
  hem: 1.1,
  head: v3(-0.7, 0.3, 0.2),
  hr: v3(0.2, 4.2, 11),
  hl: v3(-0.6, -4.2, 11),
  st: vnorm(v3(-0.25, 0.3, 1)),
  fire: 0.2,
};

/** Смерть 0,85 с (`linger`): посох падает, тело уходит в балахон, балахон оседает пустой, душа вверх. */
const NC_DIE_T = 0.85;
function ncDeath(t: number): { P: NcP; sink: number; soul: number } {
  const P0 = t < 0.08 ? mixNc(NG, NC_HIT, eOut(t / 0.08)) : NC_HIT;
  const s = eIn(seg(t, 0.1, 0.5));
  const P: NcP = {
    ...P0,
    hover: lerp(P0.hover, 0, s),
    hr: vlerp(P0.hr, v3(2.5, 4.5, 1), s),
    hl: vlerp(P0.hl, v3(1.5, -4.5, 1), s),
    st: vslerp(P0.st, vnorm(v3(0.4, 0.9, -0.05)), eIn(seg(t, 0.08, 0.38))),
    grip: lerp(P0.grip, 0.5, s),
    fire: Math.max(0, 0.4 - t * 1.2),
    eyes: t < 0.3 ? 1 - t / 0.3 : 0,
  };
  return { P, sink: s, soul: seg(t, 0.3, NC_DIE_T) };
}

// ---- Кадр -------------------------------------------------------------------------

type NcFr = MobFrame & {
  top: [number, number];
  glow: [number, number, RGBA][];
  /** Слой огня по фазе и силе — у кадра тела, чтобы не собирать точки на каждый вызов. */
  lits: Map<string, HTMLCanvasElement | null>;
};
const ncFrames = frameLRU<NcFr>(1100);
/** Сторона скольжения относительно взгляда → класс кадра (вперёд, вбок, назад). */
const MV3 = [0, 0, 2, 4, 4, 4, 2, 0];
F4_MOB_STAT.size.f4_necro = () => ncFrames.size;

/** Кадр тела без огня (огонь и глаза — в `lit`, по фазе огня). */
function ncBody(
  key: string,
  d8: number,
  look: Look,
  flash: boolean,
  P: NcP,
  extra?: (p: Px, mir: boolean) => void,
): NcFr {
  const fr = cached(ncFrames, 'f4_necro', `${key}|${d8}|${look}`, () => {
    const vw = viewOf(d8);
    const sc = new Scene(camOf(vw.yaw, NC_AX, NC_AY));
    const glow: [number, number, RGBA][] = [];
    const out: NcOut = { top: [NC_AX, 10] };
    ncScene(sc, P, headView(vw.d), glow, eyeCol(look, EYE_GREEN), out);
    const p = new Px(NC_W, NC_H);
    sc.paint(p);
    p.outline(INK);
    extra?.(p, vw.mir);
    const fx = (x: number) => (vw.mir ? NC_W - 1 - x : x);
    return {
      img: finish(p, vw.mir, false, look),
      ax: NC_AX,
      ay: NC_AY,
      eye: null,
      shadow: 6,
      top: [fx(out.top[0]), out.top[1]],
      // Огонь навершия — слой позже (`ncFrame`): обрезка оставляет место над ним.
      keep: [fx(out.top[0]) - 7, out.top[1] - 13],
      glow: glow.map(([x, y, c]): [number, number, RGBA] => [fx(x), y, c]),
      lits: new Map(),
    };
  }) as NcFr;
  return withFlash(fr, flash);
}

/** Тело + огонь навершия (фаза огня 8 к/с — только слой поверх темноты). */
function ncFrame(
  key: string,
  d8: number,
  look: Look,
  flash: boolean,
  P: NcP,
  now: number,
  extra?: (p: Px, mir: boolean) => void,
  fireMul = 1,
): MobFrame {
  const b = ncBody(key, d8, look, flash, P, extra);
  const ph = mod(now * 8, 6);
  const lk = `${ph}|${R(fireMul * 20)}`;
  let lit = b.lits.get(lk);
  if (lit === undefined) {
    const pts: [number, number, RGBA][] = fireMul < 0.3 ? [] : [...b.glow];
    flamePts(b.top[0], b.top[1], P.fire * fireMul, ph, pts);
    // Кадр в кеше обрезан до рисунка: точки огня — в его начало.
    const [ox, oy] = offOf(b.img);
    lit = litOf(
      NC_W,
      NC_H,
      pts.map(([x, y, c]): [number, number, RGBA] => [x - ox, y - oy, c]),
    );
    b.lits.set(lk, lit);
  }
  return { img: b.img, ax: b.ax, ay: b.ay, eye: null, shadow: b.shadow, lit };
}

/** Распад в пепел: пиксели гаснут по шуму снизу вверх и улетают вверх (k 0…1). */
function ashOut(k: number) {
  return (p: Px) => {
    if (k <= 0) return;
    const src = new Px(p.w, p.h);
    src.data.set(p.data);
    p.data.fill(0);
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const c = src.get(x, y);
        if (!c[3]) continue;
        const n = hash01(x * 31 + y * 17);
        const th = k * 1.35 - (1 - y / p.h) * 0.35;
        if (n > th) p.set(x, y, c);
        else if (n > th - 0.25) {
          // Пепел: зелёно-чёрная искра, сорвалась вверх.
          const lift = R((th - n) * 24);
          p.set(x + R(Math.sin(n * 20) * 1.5), y - lift, n % 0.1 < 0.03 ? GREEN.dk : ROBE.deep);
        }
      }
  };
}

registerMobPainter('f4_necro', (m, pose) => {
  const md = pose.mode;
  const t = pose.t;
  const look = pose.look;
  const flash = pose.flash;
  const now = pose.now;
  const v = visOf(m, pose, m.face ?? 0, 9);
  const d8 = dir8(v.yaw);
  let ex: Partial<MobFrame> = {};
  let fr: MobFrame;
  if (pose.anim === 'dead' || md === 'dying') {
    const i = fi(t, 20);
    const d = ncDeath(i / 24);
    fr = ncFrame(`die|${i}`, d8, look, false, d.P, now, (p, mir) => ncSink(p, d.sink, d.soul, mir));
    return { ...fr, still: true, linger: NC_DIE_T, alpha: 1 - seg(t, 0.65, NC_DIE_T) };
  }
  if (md === 'aim') {
    const i = fi(t, 20);
    fr = ncFrame(`aim|${i}`, d8, look, flash, ncAim(i / 24), now);
    ex = { still: true };
  } else if (md === 'raise') {
    const i = fi(t, 26);
    fr = ncFrame(`raise|${i}`, d8, look, flash, ncRaise(i / 24), now, (p, mir) =>
      ncMotes(p, i / 24, mir),
    );
    ex = { still: true };
  } else if (md === 'recover') {
    const i = fi(t, 10);
    if (v.prev === 'raise') {
      fr = ncFrame(`rrec|${i}`, d8, look, flash, ncRaiseRecover(i / 24), now, (p) =>
        ncRing(p, i / 24),
      );
      if (i < 2) ex = { sy: 0.94, sx: 1.05 };
    } else {
      fr = ncFrame(`srec|${i}`, d8, look, flash, ncShotRecover(i / 24), now);
      if (i === 0) ex = { dx: -Math.cos(m.face ?? 0) * 1.2, dy: -Math.sin(m.face ?? 0) * 0.6 };
    }
    ex.still = true;
  } else if (md === 'blink' || md === 'appear') {
    // Перенос: распад в пепел за 0,35 с — и сборка на новом месте.
    const i = fi(t, 8);
    const k = md === 'blink' ? i / 8 : 1 - i / 8;
    const step = R(k * 8);
    fr = ncFrame(`ash|${step}`, d8, look, flash, ncIdle(0), now, ashOut(step / 8), 1 - k);
    ex = { still: true };
  } else if (md === 'stun') {
    const i = fi(t, 4);
    const k = i < 2 ? eOut(i / 2) : 1 - eInOut((i - 2) / 3);
    fr = ncFrame(`stun|${i}`, d8, look, flash, mixNc(NG, NC_HIT, k), now);
  } else if (md === 'sleep') {
    fr = ncFrame(
      'sleep',
      d8,
      look,
      flash,
      { ...NG, hover: 0.5, head: v3(0.6, 0, -0.8), eyes: 0, fire: 0.2 },
      now,
    );
  } else if (md === 'alert') {
    const i = fi(t, 8);
    const P = mixNc(
      { ...NG, hover: 0.5, head: v3(0.6, 0, -0.8), eyes: 0, fire: 0.2 },
      NG,
      eOut(i / 8),
    );
    fr = ncFrame(`alert|${i}`, d8, look, flash, P, now);
  } else {
    const sp = Math.hypot(m.vx ?? 0, m.vy ?? 0);
    const f = mod(now * 4 + hash01(m.id ?? 0) * 8, 8);
    if (sp > 0.4) {
      const mv = MV3[dir8(Math.atan2(m.vy ?? 0, m.vx ?? 0) - (m.face ?? 0))];
      const g = mod((v.dist / NC_GLIDE) * 8, 8);
      fr = ncFrame(`move|${g}|${mv}`, d8, look, flash, ncMove(g, mv), now);
    } else fr = ncFrame(`idle|${f}`, d8, look, flash, ncIdle(f), now);
  }
  ex = addFields(ex, hurtFields(v, now, 0.8));
  return { ...fr, ...ex };
});

/** Зелёные искры из пола вокруг (поднятие): поднимаются к рукам. */
function ncMotes(p: Px, t: number, mir: boolean): void {
  const k = seg(t, 0.2, 1.1);
  if (k <= 0) return;
  for (let i = 0; i < 9; i++) {
    const h = hash01(i * 23 + 11);
    const a = (i / 9) * TAU + h;
    const r = 9 - k * 4;
    const ph = (k * 2 + h) % 1;
    const x = NC_AX + Math.cos(a) * r * (mir ? -1 : 1);
    const y = NC_AY + Math.sin(a) * r * 0.5 - ph * 14;
    const c: RGBA = ph > 0.7 ? GREEN.hi : ph > 0.3 ? GREEN.mid : GREEN.dk;
    p.set(x, y, [c[0], c[1], c[2], R(255 * (1 - ph * 0.5))]);
  }
}

/** Удар посохом об пол: зелёное кольцо по полу (миг подъёма костей). */
function ncRing(p: Px, t: number): void {
  if (t > 0.25) return;
  const k = eOut(t / 0.25);
  const r = 3 + k * 12;
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    const x = NC_AX + Math.cos(a) * r;
    const y = NC_AY + Math.sin(a) * r * 0.5;
    p.set(x, y, [GREEN.mid[0], GREEN.mid[1], GREEN.mid[2], R(230 * (1 - k))]);
  }
}

/** Смерть: тело уходит в балахон (верх стирается сверху вниз), груда ткани, душа — зелёный дымок вверх. */
function ncSink(p: Px, s: number, soul: number, mir: boolean): void {
  if (s > 0) {
    // Верх кадра стирается — тело уходит в балахон.
    const cut = Math.min(p.h, R(lerp(10, NC_AY - 2, s)));
    p.data.fill(0, 0, cut * p.w * 4);
    // Скомканный балахон у пола.
    if (s > 0.6) {
      const w = R(lerp(5, 7, s));
      for (let x = -w; x <= w; x++) {
        const hgt = R((1 - Math.abs(x) / (w + 1)) * 3 * s);
        for (let y = 0; y <= hgt; y++) p.set(NC_AX + x, NC_AY - y, y === hgt ? ROBE.mid : ROBE.dk);
      }
      p.set(NC_AX + (mir ? 2 : -2), NC_AY - 3, BONE.mid);
    }
  }
  if (soul > 0) {
    for (let i = 0; i < 10; i++) {
      const h = hash01(i * 13 + 1);
      const y = NC_AY - 6 - soul * (14 + h * 12) - i;
      const x = NC_AX + Math.sin(soul * 7 + i * 0.8) * (1 + h * 2.5);
      const a = R(220 * (1 - soul) * (0.4 + h * 0.6));
      if (a > 10 && y > 0) p.set(x, y, [GREEN.dk[0], GREEN.dk[1], GREEN.dk[2], a]);
    }
  }
}

registerMobWarm('f4_necro', function* () {
  for (let d = 0; d < 8; d++) {
    for (let f = 0; f < 8; f++) {
      ncBody(`idle|${f}`, d, 'normal', false, ncIdle(f));
      yield 0;
    }
    for (const mv of [0, 2, 4])
      for (let f = 0; f < 8; f++) {
        ncBody(`move|${f}|${mv}`, d, 'normal', false, ncMove(f, mv));
        yield 0;
      }
  }
  for (let d = 0; d < 8; d++)
    for (let i = 0; i <= 20; i++) {
      ncBody(`aim|${i}`, d, 'normal', false, ncAim(i / 24));
      yield 0;
    }
  for (let d = 0; d < 8; d++) {
    for (let i = 0; i <= 10; i++) {
      ncBody(`srec|${i}`, d, 'normal', false, ncShotRecover(i / 24));
      yield 0;
    }
    for (let i = 0; i <= 26; i++) {
      ncBody(`raise|${i}`, d, 'normal', false, ncRaise(i / 24), (p, mir) =>
        ncMotes(p, i / 24, mir),
      );
      yield 0;
    }
    for (let i = 0; i <= 10; i++) {
      ncBody(`rrec|${i}`, d, 'normal', false, ncRaiseRecover(i / 24), (p) => ncRing(p, i / 24));
      yield 0;
    }
  }
});

// ---- Снаряд: могильный огонь — череп в зелёном пламени со следом ----------------------

const shotSprites = frameLRU<Sprite>(96);

registerShotPainter('f4_gravefire', (s: Shot, time: number) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = mod(Math.round(a / (TAU / 16)), 16);
  const ph = mod(time * 12 + s.id, 3);
  const born = s.age < 0.08 ? 1 : 0;
  const key = `${q}|${ph}|${born}`;
  let sp = shotSprites.get(key);
  if (!sp) {
    const W = 25;
    const C = 12;
    const p = new Px(W, W);
    const ang = (q * TAU) / 16;
    const cx = Math.cos(ang);
    const cy = Math.sin(ang) * 0.75;
    // След: огонь тянется назад, редеет и темнеет.
    for (let i = 10; i >= 1; i--) {
      const k = i / 10;
      const w = (1 - k) * 2.4 + 0.4;
      const wob = Math.sin(i * 1.3 + ph * 2.1) * 0.9 * k;
      const x = C - cx * i * 1.05 - cy * wob;
      const y = C - cy * i * 1.05 + cx * wob;
      const col = k < 0.35 ? GREEN.mid : k < 0.7 ? GREEN.dk : hex('#1a5a2a');
      if (born && i > 4) continue;
      p.ell(x, y, w, w * 0.85, [col[0], col[1], col[2], R(255 * (1 - k * 0.55))]);
    }
    // Голова: светлое ядро, череп.
    p.ell(C, C, 3.4, 3.1, GREEN.dk);
    p.ell(C + cx * 0.4, C + cy * 0.4 - 0.4, 2.6, 2.3, GREEN.mid);
    p.rect(C - 1, C - 2, C + 1, C, GREEN.hi);
    p.set(C - 1, C - 1, ROBE.deep);
    p.set(C + 1, C - 1, ROBE.deep);
    p.set(C, C + 1, ROBE.deep);
    p.set(C + R(cx * 3), C - 3 + ph, GREEN.hi);
    p.outline(hex('#0c2a12'));
    sp = shotSprites.set(key, { img: p.canvas(), ax: C, ay: C });
  }
  return sp;
});

// ---- Контакты: снаряд, перенос ---------------------------------------------------------

/** Могильный огонь лёг: всплеск, обломки черепа, иней холода — поверх темноты. */
registerImpactPainter('f4_gravefire', {
  life: 0.5,
  above: true,
  shake: 0.08,
  paint: (g, rec, px, py, _scale, age) => {
    const u = clamp01(age / 0.5);
    // Выжженная метка под всплеском — первые 0,15 с.
    if (age < 0.15) {
      g.globalAlpha = 0.5 * (1 - age / 0.15);
      g.fillStyle = '#0c2a12';
      g.beginPath();
      g.ellipse(px, py + 1, 6, 3, 0, 0, TAU);
      g.fill();
    }
    // Вспышка — ядро и кольцо.
    if (age < 0.12) {
      const k = age / 0.12;
      g.globalAlpha = 1 - k;
      g.fillStyle = '#e2ffd4';
      g.fillRect(
        Math.round(px - 2 - k * 2),
        Math.round(py - 2 - k * 2),
        4 + R(k * 4),
        4 + R(k * 4),
      );
    }
    const r = 3 + eOut(u) * 11;
    g.globalAlpha = 0.8 * (1 - u);
    g.fillStyle = '#8cff7c';
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.5), 1, 1);
    }
    // Языки огня и обломки — по направлению полёта.
    const va = Math.atan2(rec.vy ?? 0, rec.vx ?? 1);
    for (let i = 0; i < 8; i++) {
      const h = hash01((rec.seed + i * 37) | 0);
      const a = va + (h - 0.5) * 2.4;
      const d = 2 + eOut(u) * (6 + h * 8);
      const z = Math.max(0, 12 * u - 30 * u * u) * (0.5 + h);
      g.globalAlpha = 1 - u;
      g.fillStyle = i % 3 === 0 ? '#d8cfb8' : i % 3 === 1 ? '#8cff7c' : '#2eae4c';
      g.fillRect(
        Math.round(px + Math.cos(a) * d),
        Math.round(py + Math.sin(a) * d * 0.5 - z),
        1,
        1,
      );
    }
    // Иней (холод): бледные кристаллы оседают.
    for (let i = 0; i < 6; i++) {
      const h = hash01((rec.seed >> 2) + i * 53);
      const a = h * TAU;
      g.globalAlpha = 0.7 * (1 - seg(age, 0.2, 0.5));
      g.fillStyle = '#d8fff0';
      g.fillRect(
        Math.round(px + Math.cos(a) * (4 + h * 5)),
        Math.round(py + Math.sin(a) * (2 + h * 2) + u * 2),
        1,
        1,
      );
    }
    g.globalAlpha = 1;
    return true;
  },
});

/** Некромант ушёл: пепел и зелёные искры кружат на старом месте и оседают. */
registerImpactPainter('f4_blink', {
  life: 0.6,
  above: true,
  paint: (g, rec, px, py, _scale, age) => {
    const u = clamp01(age / 0.6);
    for (let i = 0; i < 16; i++) {
      const h = hash01((rec.seed + i * 19) | 0);
      const a = h * TAU + u * 3 * (i % 2 ? 1 : -1);
      const r = 2 + h * 5 + u * 3;
      const z = 6 + h * 14 - u * u * 10 + Math.sin(u * 6 + h * 9) * 2;
      g.globalAlpha = (1 - u) * (i % 3 ? 0.8 : 1);
      g.fillStyle = i % 3 === 0 ? '#8cff7c' : '#1a1220';
      g.fillRect(
        Math.round(px + Math.cos(a) * r),
        Math.round(py + Math.sin(a) * r * 0.5 - z),
        1,
        1,
      );
    }
    g.globalAlpha = 1;
    return true;
  },
});
