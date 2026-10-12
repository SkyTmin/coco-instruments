// Этаж 12 — Хранитель сияния (анимации мобов 12). Мозг `f12_keeper`
// (`f12-brains.ts`, `KEEPER`): `chase` — держит 4–6,5 клетки, кружит, лицом к
// герою; щит (урон ×0,3), пока он холодный: не у горящей жаровни, `data.spent`
// = 0, не колдует. Таймер `data.sum` (5 с, потом 12) и духов меньше 4 →
// `f12_summon` 1 с: в 1,0 два духа по бокам (±90° от взгляда, 1,6 клетки,
// `f12_ignite`) → `recover` 0,9. Видит героя ближе 9 и `cd` ≤ 0 → `f12_wind`
// 0,85 с: в 0,85 линия `f12_curtain` (длина ≤ 9, ширина 1,4, предупреждение
// 0,95) → `recover` 0,9; занавес бьёт через 0,95 после броска — в первые
// 0,05 с погони. После обоих `spent` 3 с — щит снят. Какой был отход — по
// `data.sum` (призыв ставит 12, после броска его меньше 10,3).
//
// Кадры (8 честных сторон — посох в правой; 24 к/с от `pose.t`): парит в
// робе над снегом, подол волной, палантин отстаёт; щит — шесть ледяных
// осколков по кругу. Покой 8 со щитом и 8 без (кристалл тусклый, ссутулился;
// фаза от id, 7 к/с), щит собирается 10 (по `data.spent`: осколки слетаются
// из инея), бросок 21 (осколки втянуты в кристалл, посох над головой обеими
// руками, разгорается, держит — дрожит, отклон назад) + отход 22 (кадр 0 —
// бросок: посох к герою, выпад, вспышка и искры вперёд; держит луч — искры
// текут к занавесу; замах — и удар посохом в лёд в кадре 21, когда занавес
// падает) + 6 кадров отскока в погоне (только вживую), призыв 24 (посох и
// левая вверх, вихрь сияния вокруг, дрожь) + отход 22 (кадр 0 — руки в
// стороны, где встают духи, вспышка из ладоней; опускает), смерть 1,15 с
// (`linger`: отброшен, кристалл гаснет, падает на снег, роба оседает пустой,
// маска падает, посох валится, сияние уходит вверх). Удар героя — `hurtFx`;
// в полёте клонится по ходу (`rot`, без новых кадров).

import type { Px } from '../dungeon-art';
import { paintSim, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { f12State } from './f12-brains';
import { AURORA, BONE, hash, hx, ICE, mixc, ramp, SNOW, TAU, TEAL, WHITE } from './f12-rig';
import {
  clamp,
  dirOf,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  lin,
  paintMob,
  puff,
  RIM_C,
  rimLight,
  smooth,
  sstep,
  trail,
  trk,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Ease, Part, PostFx, RGBA, Scr, V3 } from './f12-mobkit';

const K_ROBE = ramp('#0a1222', '#16223a', '#243656', '#384e76', '#546c96');
const K_MASK = ramp('#5a5448', '#8a8270', '#bab096', '#ddd4b8', '#fbf4dc');
const K_TRIM = ramp('#0c2e36', '#145058', '#1f7a80', '#3aa8a8', '#7ad8d0');
const K_FUR = ramp('#2a3044', '#465068', '#6a7690', '#98a6c0', '#cdd8ea');
const K_STOLE = ramp('#082420', '#0e3e36', '#17604e', '#24886a', '#4cb894');
const K_STAFF = ramp('#3a3428', '#5e5442', '#857a62', '#ada286', '#d4caae');
const K_DIM = ramp('#0a2a2a', '#124440', '#1e6458', '#348a74', '#5aae94');
const EYE = hx('#6cff9a');
const VIOLET = hx('#b89aff');
const MOTE: RGBA[] = [AURORA[3], TEAL[3], AURORA[4], VIOLET];
const CHIP: RGBA[] = [WHITE, hx('#d8f0ff'), ICE[4], ICE[3]];
const DUST: RGBA[] = [SNOW[4], SNOW[3], WHITE, AURORA[3]];

/** Рост фигуры: чуть выше героя. */
const S = 1.15;

// ---------------------------------------------------------------------------
// Поза и модель.
// ---------------------------------------------------------------------------

interface KeepO {
  /** Парение (вверх-вниз), ед. модели. */
  z: number;
  /** Наклон корпуса вперёд (+) / назад (−) и головы сверх него. */
  lean: number;
  head: number;
  /** Кисть с посохом (хват) и левая кисть; `grip` — левая на древке. */
  hR: V3;
  hL: V3;
  grip: number;
  /** Посох: курс и наклон от хвата (π/2 — стоймя), упал (смерть) — от комля. */
  sYaw: number;
  sPitch: number;
  butt: V3 | null;
  /** Правая кисть отдельно от посоха (смерть: выпустил). */
  arm: V3 | null;
  /** Сила кристалла 0…2. */
  glow: number;
  /** Подол: фаза волны, размах, снос назад (выпад). Палантин: качание. */
  hem: number;
  hemA: number;
  flare: number;
  stole: number;
  /** Щит: размер 0…1, поворот круга, радиус, высота; втянут в кристалл 0…1. */
  shield: number;
  spin: number;
  shR: number;
  shZ: number;
  pull: number;
  /** Вихрь сияния 0…1 и его фаза; `swC` — вокруг кристалла (бросок). */
  swirl: number;
  swPh: number;
  swC: boolean;
  /** Вспышка: 0…1 разлёта; куда — 0 вперёд от кристалла, 1 из ладоней в стороны, 2 осколки щита. */
  burst: number;
  side: number;
  /** Поток искр от кристалла вперёд (держит занавес), фаза. */
  stream: number;
  strPh: number;
  /** Удар посохом в лёд: 0…1 разлёта крошки. */
  slam: number;
  /** Смерть: роба оседает, маска падает, сияние уходит вверх. */
  sink: number;
  mask: number;
  wisp: number;
}

const REST_R: V3 = [2.4, 4.4, 10.6];
const REST_L: V3 = [2.8, -3.0, 9.4];
const O0: KeepO = {
  z: 0,
  lean: 0.05,
  head: 0,
  hR: REST_R,
  hL: REST_L,
  grip: 0,
  sYaw: 0.15,
  sPitch: 1.42,
  butt: null,
  arm: null,
  glow: 0.75,
  hem: 0,
  hemA: 0.4,
  flare: 0,
  stole: 0,
  shield: 0,
  spin: 0,
  shR: 7.5,
  shZ: 10,
  pull: 0,
  swirl: 0,
  swPh: 0,
  swC: false,
  burst: 0,
  side: 0,
  stream: 0,
  strPh: 0,
  slam: 0,
  sink: 0,
  mask: 0,
  wisp: 0,
};

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const lerp3 = (a: V3, b: V3, k: number): V3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];
const bump = (k: number, a: number, b: number) =>
  k <= a || k >= b ? 0 : Math.sin(((k - a) / (b - a)) * Math.PI);
/** Направление посоха (курс, наклон) — единичный вектор. */
const dirV = (yaw: number, pitch: number): V3 => [
  Math.cos(yaw) * Math.cos(pitch),
  Math.sin(yaw) * Math.cos(pitch),
  Math.sin(pitch),
];

/** Сустав двух звеньев (плечо/предплечье): изгиб к `bend`. */
function joint(a: V3, c: V3, l1: number, l2: number, bend: V3): V3 {
  const d = sub(c, a);
  const L = Math.max(1e-3, len(d));
  const u = mul(d, 1 / L);
  const k = Math.min(L, l1 + l2 - 1e-3);
  const x = (k * k + l1 * l1 - l2 * l2) / (2 * k);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const bu = bend[0] * u[0] + bend[1] * u[1] + bend[2] * u[2];
  let n = sub(bend, mul(u, bu));
  const nl = len(n);
  n = nl > 1e-3 ? mul(n, 1 / nl) : [0, 0, -1];
  return add(add(a, mul(u, x)), mul(n, h));
}

/** Цепочка шаров по отрезку. */
function seg(out: Part[], a: V3, b: V3, r0: number, r1: number, R: RGBA[], id: number, n = 2) {
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const r = lerp(r0, r1, k);
    out.push({
      x: lerp(a[0], b[0], k),
      y: lerp(a[1], b[1], k),
      z: lerp(a[2], b[2], k),
      rx: r,
      ry: r,
      rz: r,
      ramp: R,
      id,
    });
  }
}

const STAFF_UP = 10;
const STAFF_DN = 9.5;
/** Хват посоха: из позы (кисть) или от комля (упавший). */
function staffOf(o: KeepO): { G: V3; u: V3; top: V3; cr: V3 } {
  const u = dirV(o.sYaw, o.sPitch);
  const G = o.butt ? add(o.butt, mul(u, STAFF_DN)) : add(o.hR, [0, 0, o.z]);
  const top = add(G, mul(u, STAFF_UP));
  return { G, u, top, cr: add(top, mul(u, 2)) };
}

/** Кристалл посоха: тусклый — к тёмной бирюзе, яркий — к белому. */
function crystalRamp(g: number): RGBA[] {
  if (g < 0.6) return K_DIM.map((c, i) => mixc(c, AURORA[i], g / 0.6));
  if (g <= 1.2) return AURORA;
  return AURORA.map((c) => mixc(c, WHITE, Math.min(0.6, (g - 1.2) * 0.6)));
}

/** Модель в единицах (до масштаба `S`). */
function keepParts(o: KeepO): { parts: Part[]; eyes: V3[]; cr: V3; G: V3; u: V3 } {
  const P: Part[] = [];
  const sk = o.sink;
  const hemZ = Math.max(0.5, 2.4 + o.z);
  const waistZ = Math.max(hemZ + 2.2, 11 + o.z - sk * 6);
  // Роба: колокол от пояса к подолу; подол сносит назад и он ходит волной.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = lerp(5.1, 2.9, Math.pow(t, 0.85)) * (1 + sk * 0.45 * (1 - t));
    P.push({
      x: -o.flare * (1 - t) * (1 - t) * 2.6,
      y: 0,
      z: lerp(hemZ + 0.9, waistZ, t),
      rx: r * 0.92,
      ry: r,
      rz: lerp(2.3, 2.6, t) * (1 - sk * 0.35),
      ramp: K_ROBE,
      fur: 0.05,
      id: 70,
    });
  }
  const hemR = 5 * (1 + sk * 0.45);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    const w = Math.sin(o.hem + a * 2) * o.hemA;
    P.push({
      x: Math.cos(a) * hemR * 0.92 - o.flare * 2.6,
      y: Math.sin(a) * hemR,
      z: hemZ + 0.35 + w * (1 - sk),
      rx: 1.45,
      ry: 1.45,
      rz: 1.05,
      ramp: K_TRIM,
      id: 69,
    });
  }
  // Пояс, корпус, меховая пелерина.
  P.push({ x: 0, y: 0, z: waistZ, rx: 2.7, ry: 3.2, rz: 1, ramp: K_TRIM, id: 71 });
  const l = o.lean;
  const sl = Math.sin(l);
  const cl = Math.cos(l);
  const tl = (v: V3): V3 => [v[0] * cl + v[2] * sl, v[1], v[2] * cl - v[0] * sl];
  const C: V3 = add([0, 0, waistZ], tl([0, 0, 4.6 * (1 - sk * 0.45)]));
  P.push({
    x: C[0] * 0.5,
    y: 0,
    z: (waistZ + C[2]) / 2,
    rx: 2.4,
    ry: 3,
    rz: 2.6,
    pitch: -l,
    ramp: K_ROBE,
    id: 72,
  });
  P.push({ x: C[0], y: 0, z: C[2], rx: 2.6, ry: 3.5, rz: 2.5, pitch: -l, ramp: K_ROBE, id: 72 });
  const mt = add(C, tl([-0.4, 0, 1.3]));
  P.push({
    x: mt[0],
    y: 0,
    z: mt[2],
    rx: 3,
    ry: 4.3,
    rz: 1.8,
    pitch: -l,
    ramp: K_FUR,
    fur: 0.25,
    id: 73,
  });
  // Палантин: две полосы с плеч по груди — отстают от тела.
  for (const e of [-1, 1]) {
    const top = add(C, tl([2.2, e * 1.25, 0.9]));
    const bot: V3 = [
      top[0] * 0.55 + 2.4 + Math.sin(o.stole) * 1.3,
      e * (1.45 + Math.abs(Math.sin(o.stole)) * 0.3),
      waistZ - 3.4,
    ];
    const mid = lerp3(top, bot, 0.5);
    mid[0] += 0.5;
    seg(P, top, mid, 0.8, 0.75, K_STOLE, 78, 2);
    seg(P, mid, bot, 0.75, 0.7, K_STOLE, 78, 2);
  }
  // Голова: капюшон с острым верхом, костяная маска, рога-кристаллы.
  const hl = l + o.head;
  const sh = Math.sin(hl);
  const ch = Math.cos(hl);
  const th = (v: V3): V3 => [v[0] * ch + v[2] * sh, v[1], v[2] * ch - v[0] * sh];
  const H = add(C, tl([0, 0, 4.1 * (1 - sk * 0.3)]));
  const hood = add(H, th([-0.7, 0, 0.3]));
  P.push({ x: hood[0], y: 0, z: hood[2], rx: 3.1, ry: 3, rz: 3.2, pitch: -hl, ramp: K_ROBE, id: 74 });
  const peak = add(H, th([-2.3, 0, 2.5]));
  P.push({ x: peak[0], y: 0, z: peak[2], rx: 1.5, ry: 1.4, rz: 1.6, ramp: K_ROBE, id: 74 });
  const mk0 = add(H, th([1.5, 0, -0.2]));
  const mk1: V3 = [5.6, 0.8, 0.7];
  const mf = easeIn(o.mask);
  const mk = lerp3(mk0, mk1, mf);
  mk[2] += Math.sin(o.mask * Math.PI) * 2.5;
  P.push({
    x: mk[0],
    y: mk[1],
    z: mk[2],
    rx: 1,
    ry: 1.8,
    rz: 2.2,
    pitch: -hl - mf * 1.45,
    ramp: K_MASK,
    id: 75,
  });
  for (const e of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const c = add(H, th([-0.4 - i * 0.35, e * (1.8 + i * 0.55), 2.4 + i * 1.25]));
      const r = 0.85 - i * 0.2;
      P.push({
        x: c[0],
        y: c[1],
        z: c[2] - sk * i * 0.6,
        rx: r,
        ry: r,
        rz: r * 1.5,
        roll: e * 0.45,
        ramp: TEAL,
        glow: true,
        gloss: true,
        id: 76,
      });
    }
  const eyes: V3[] =
    o.mask > 0.25 ? [] : [-1, 1].map((e) => add(H, th([2.55, e * 0.75, 0.2])));
  // Посох и кристалл.
  const st = staffOf(o);
  const nS = 14;
  for (let i = 0; i <= nS; i++) {
    const p = add(st.G, mul(st.u, -STAFF_DN + ((STAFF_UP + STAFF_DN) * i) / nS));
    P.push({ x: p[0], y: p[1], z: p[2], rx: 0.55, ry: 0.55, rz: 0.55, ramp: K_STAFF, id: 90 });
  }
  const side: V3 = [-Math.sin(o.sYaw), Math.cos(o.sYaw), 0];
  for (const e of [-1, 1]) {
    const pr = add(add(st.top, mul(side, e * 1.05)), mul(st.u, 1.1));
    P.push({ x: pr[0], y: pr[1], z: pr[2], rx: 0.55, ry: 0.55, rz: 0.75, ramp: BONE, id: 91 });
  }
  const g = o.glow;
  P.push({
    x: st.cr[0],
    y: st.cr[1],
    z: st.cr[2],
    rx: 2 + g * 0.35,
    ry: 1.15 + g * 0.22,
    rz: 1.15 + g * 0.22,
    yaw: o.sYaw,
    pitch: o.sPitch,
    ramp: crystalRamp(g),
    glow: g > 0.15,
    gloss: true,
    id: 92,
  });
  // Руки: плечо → локоть (вниз-наружу) → широкий рукав → кисть.
  const onStaff = add(st.G, mul(st.u, -3.4));
  for (const e of [-1, 1]) {
    const shd = add(C, tl([-0.2, e * 3.4, 0.9]));
    const hand =
      e > 0 ? (o.arm ? add(o.arm, [0, 0, o.z]) : st.G) : lerp3(add(o.hL, [0, 0, o.z]), onStaff, o.grip);
    const el = joint(shd, hand, 4.2, 4.4, [-0.4, e * 0.9, -1]);
    seg(P, shd, el, 1.4, 1.5, K_ROBE, 80 + e);
    const wr = lerp3(el, hand, 0.82);
    seg(P, el, wr, 1.55, 2.05, K_ROBE, 82 + e);
    P.push({ x: hand[0], y: hand[1], z: hand[2], rx: 0.95, ry: 0.95, rz: 0.95, ramp: K_MASK, id: 84 + e });
  }
  // Щит: шесть осколков по кругу (втягиваются в кристалл).
  if (o.shield > 0.02)
    for (let k = 0; k < 6; k++) {
      const a = o.spin + (k / 6) * TAU;
      const at: V3 = [Math.cos(a) * o.shR, Math.sin(a) * o.shR, o.shZ + o.z + Math.sin(a * 2 + 0.5)];
      const pk = o.pull * o.pull;
      const p = lerp3(at, st.cr, pk);
      const s = o.shield * (1 - 0.75 * pk);
      P.push({
        x: p[0],
        y: p[1],
        z: p[2],
        rx: 0.75 * s,
        ry: 0.55 * s,
        rz: 2.1 * s,
        yaw: a,
        ramp: ICE,
        alpha: 0.8,
        glow: true,
        gloss: true,
        id: 100 + k,
      });
    }
  return { parts: P, eyes, cr: st.cr, G: st.G, u: st.u };
}

// ---------------------------------------------------------------------------
// Рисунок поверх: вихрь, вспышки, поток, крошка, сияние уходит.
// ---------------------------------------------------------------------------

/** Светящаяся точка: в кадр и в слой света; за телом — не рисуется. */
function mote(p: Px, fx: PostFx, s: [number, number, number], c: RGBA, a = 1): void {
  if (a <= 0.05) return;
  if (fx.z(s[0], s[1]) > s[2] + 0.8) return;
  const col: RGBA = a >= 1 ? c : [c[0], c[1], c[2], Math.round(255 * a)];
  p.set(s[0], s[1], col);
  fx.lit().set(s[0], s[1], col);
}

function keepPost(o: KeepO, m: { cr: V3; G: V3; u: V3 }): (p: Px, scr: Scr, fx: PostFx) => void {
  return (p, scr0, fx) => {
    const scr: Scr = (x, y, z) => scr0(x * S, y * S, z * S);
    rimLight(p, RIM_C, 0.36);
    const cr = m.cr;
    if (o.swirl > 0) {
      const n = o.swC ? 10 : 18;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        let pt: V3;
        if (o.swC) {
          const a = o.swPh * 1.4 + u * TAU;
          const r = lerp(6.5, 1.9, o.swirl) + (i % 3) * 0.5;
          pt = [cr[0] + Math.cos(a) * r, cr[1] + Math.sin(a) * r, cr[2] + Math.sin(a * 2) * r * 0.35];
        } else {
          const a = o.swPh + u * TAU * 2;
          const r = lerp(10.5, 6.5, o.swirl) * (1 - u * 0.25);
          pt = [Math.cos(a) * r, Math.sin(a) * r, 2.5 + o.z + u * 21 * (0.35 + 0.65 * o.swirl)];
        }
        if (u > o.swirl * 1.15) continue;
        mote(p, fx, scr(pt[0], pt[1], pt[2]), MOTE[i % 4], 0.55 + 0.45 * o.swirl);
      }
    }
    if (o.burst > 0 && o.burst < 1) {
      const k = o.burst;
      const fade = 1 - k * k;
      if (o.side === 0) {
        // Бросок: вспышка в кристалле, искры веером вперёд.
        if (k < 0.3) {
          const c = scr(cr[0], cr[1], cr[2]);
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            mote(p, fx, [c[0] + dx, c[1] + dy, c[2] + 9], WHITE);
        }
        for (let i = 0; i < 12; i++) {
          const a = (hash(i, 7, 311) - 0.5) * 1.1;
          const el = (hash(i, 8, 311) - 0.6) * 0.7;
          const d = (2 + 10 * easeOut(k)) * (0.55 + 0.45 * hash(i, 9, 311));
          const pt: V3 = [
            cr[0] + Math.cos(a) * Math.cos(el) * d,
            cr[1] + Math.sin(a) * Math.cos(el) * d,
            cr[2] + Math.sin(el) * d - k * k * 3,
          ];
          mote(p, fx, scr(pt[0], pt[1], pt[2]), i % 3 ? MOTE[i % 4] : WHITE, fade);
        }
      } else if (o.side === 1) {
        // Призыв: из ладоней в стороны — туда, где встают духи.
        for (const e of [-1, 1]) {
          const h0: V3 = e < 0 ? add(o.hL, [0, 0, o.z]) : m.G;
          for (let i = 0; i < 9; i++) {
            const d = (1 + 9 * easeOut(k)) * (0.5 + 0.5 * hash(i, e, 312));
            const sp = (hash(i, e, 313) - 0.5) * 0.9;
            const pt: V3 = [
              h0[0] + Math.sin(sp) * d * 0.6,
              h0[1] + e * Math.cos(sp) * d,
              h0[2] + (hash(i, e, 314) - 0.5) * d * 0.5 - k * 2,
            ];
            mote(p, fx, scr(pt[0], pt[1], pt[2]), MOTE[(i + 1) % 4], fade);
          }
        }
      } else {
        // Смерть: осколки щита разлетаются крошкой.
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + hash(i, 3, 315) * 0.4;
          const d = 7.5 + 6 * easeOut(k) * (0.6 + 0.4 * hash(i, 4, 315));
          const z = 10 + o.z + 3 * Math.sin(k * Math.PI) - 9 * k * k;
          const s = scr(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.5, z));
          p.set(s[0], s[1], CHIP[i % 4]);
        }
      }
    }
    if (o.stream > 0) {
      // Держит занавес: искры текут от кристалла вперёд к земле.
      for (let i = 0; i < 7; i++) {
        const d = (((o.strPh + i / 7) % 1) + 1) % 1;
        const pt: V3 = [
          cr[0] + d * 11,
          cr[1] + Math.sin(d * 9 + i) * 0.9,
          lerp(cr[2], 1.2, d * d),
        ];
        mote(p, fx, scr(pt[0], pt[1], pt[2]), MOTE[i % 4], o.stream * (1 - d * 0.6));
      }
      const c0 = scr(cr[0], cr[1], cr[2]);
      const c1 = scr(cr[0] + 3.5, cr[1], cr[2] - 0.8);
      trail(p, [[c0[0], c0[1]], [c1[0], c1[1]]], AURORA[3], 0.7 * o.stream, 0.1);
    }
    if (o.slam > 0 && o.slam < 1) {
      // Посох в лёд: крошка и снег от кончика, искры сияния вверх.
      const tip = add(m.G, mul(m.u, STAFF_UP + 3));
      puff(p, scr, tip[0], tip[1], o.slam, 12, 5, 77, DUST);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        const r = 1 + 4 * easeOut(o.slam);
        const s = scr(tip[0] + Math.cos(a) * r, tip[1] + Math.sin(a) * r, 0.5 + 5 * o.slam * hash(i, 5, 316));
        mote(p, fx, s, MOTE[i % 4], 1 - o.slam);
      }
    }
    if (o.wisp > 0) {
      // Смерть: сияние уходит вверх из пустой робы.
      for (let i = 0; i < 9; i++) {
        const ph = (o.wisp * 1.35 + hash(i, 1, 317)) % 1;
        const a = Math.min(1, o.wisp * 5) * (1 - ph) * (1 - sstep(0.75, 1, o.wisp));
        const x = (hash(i, 2, 317) - 0.5) * 7 + Math.sin(ph * 6 + i) * 1.3;
        const y = (hash(i, 3, 317) - 0.5) * 7;
        mote(p, fx, scr(x, y, 2 + ph * 18), MOTE[i % 4], a);
      }
    }
    if (o.pull > 0 && o.pull < 1 && o.shield > 0.02) {
      // Осколки щита втягиваются в кристалл: короткий след к нему.
      for (let k = 0; k < 6; k++) {
        const a = o.spin + (k / 6) * TAU;
        const at: V3 = [Math.cos(a) * o.shR, Math.sin(a) * o.shR, o.shZ + o.z];
        const p0 = lerp3(at, cr, o.pull * o.pull);
        const p1 = lerp3(at, cr, Math.max(0, o.pull - 0.35) ** 2);
        const s0 = scr(p0[0], p0[1], p0[2]);
        const s1 = scr(p1[0], p1[1], p1[2]);
        trail(p, [[s0[0], s0[1]], [s1[0], s1[1]]], TEAL[4], 0.8, 0.1);
      }
    }
  };
}

function keepBuild(o: KeepO): Build {
  const m = keepParts(o);
  for (const pt of m.parts) {
    pt.x *= S;
    pt.y *= S;
    pt.z *= S;
    pt.rx *= S;
    pt.ry *= S;
    pt.rz *= S;
  }
  const ext: V3[] = [];
  const cr = m.cr;
  if (o.swirl > 0 && !o.swC) ext.push([10.5, 10.5, 2], [-10.5, -10.5, 26]);
  if (o.swirl > 0 && o.swC) ext.push(add(cr, [7, 7, 3]), add(cr, [-7, -7, -3]));
  if (o.burst > 0 && o.burst < 1 && o.side === 0) ext.push(add(cr, [12, 6, 4]), add(cr, [12, -6, -5]));
  if (o.burst > 0 && o.burst < 1 && o.side === 1) ext.push([2, 18, 16], [2, -18, 16]);
  if (o.burst > 0 && o.burst < 1 && o.side === 2) ext.push([14, 14, 13], [-14, -14, 1]);
  if (o.stream > 0) ext.push(add(cr, [11, 1, -cr[2] + 1]));
  if (o.slam > 0) {
    const tip = add(m.G, mul(m.u, STAFF_UP + 3));
    ext.push(add(tip, [6, 6, 0]), add(tip, [-6, -6, 6]));
  }
  if (o.wisp > 0) ext.push([4, 4, 21], [-4, -4, 1]);
  return {
    parts: m.parts,
    eyes: m.eyes.map((e) => ({ x: e[0] * S, y: e[1] * S, z: e[2] * S, c: EYE })),
    extent: ext.map((e) => mul(e, S)),
    post: keepPost(o, m),
  };
}

// ---------------------------------------------------------------------------
// Дорожки поз.
// ---------------------------------------------------------------------------

type Key3 = [number, V3, Ease?];
const trk3 = (k: number, keys: Key3[]): V3 => [
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[0], e]),
  ),
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[1], e]),
  ),
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[2], e]),
  ),
];

/** Покой: парит, подол волной, палантин отстаёт; со щитом — осколки кружат. */
function idlePose(ph: number, sh: boolean): KeepO {
  const s = Math.sin(ph);
  return {
    ...O0,
    z: (sh ? 0.85 : 0.6) * s,
    lean: sh ? 0.05 : 0.15,
    head: (sh ? 0 : 0.14) + 0.06 * Math.sin(ph - 0.6),
    hL: [REST_L[0], REST_L[1], REST_L[2] + 0.35 * Math.sin(ph - 0.9)],
    sPitch: 1.42 + 0.04 * Math.sin(ph - 0.4),
    glow: sh ? 0.8 + 0.2 * Math.sin(ph * 2) : 0.3 + 0.08 * Math.sin(ph),
    hem: ph,
    stole: Math.sin(ph - 1.1) * 0.5,
    shield: sh ? 1 : 0,
    spin: (ph / TAU) * (TAU / 6),
  };
}

const T = (f: number) => (f + 0.5) / 24;

function pose(anim: string, f: number): KeepO {
  const t = T(f);
  switch (anim) {
    case 'idleS':
      return idlePose((f / 8) * TAU, true);
    case 'idleN':
      return idlePose((f / 8) * TAU, false);
    case 'form': {
      // Щит собирается: иней слетается к кругу и твердеет в осколки.
      const k = f / 9;
      const e = easeOut(k);
      return {
        ...idlePose(0, true),
        shield: lerp(0.3, 1, e),
        shR: lerp(12.5, 7.5, e),
        shZ: lerp(15, 10, e),
        spin: -(1 - e) * 2.2,
        glow: 0.8 + 0.9 * bump(k, 0.1, 0.9),
        hR: [REST_R[0], REST_R[1], REST_R[2] + 1.2 * bump(k, 0, 1)],
      };
    }
    case 'cast': {
      // Посох над головой обеими руками, кристалл разгорается; на пике держит.
      const hold = f >= 12 && f <= 17;
      const o: KeepO = {
        ...O0,
        pull: trk(t, [
          [0, 0],
          [0.25, 1, easeIn],
        ]),
        shield: t < 0.25 ? 1 : 0,
        lean: trk(t, [
          [0, 0.05],
          [0.2, -0.1, easeOut],
          [0.5, -0.2, smooth],
          [0.75, -0.2],
          [0.85, -0.27, smooth],
        ]),
        z: trk(t, [
          [0, 0],
          [0.5, 2, smooth],
          [0.75, 2],
          [0.85, 2.4],
        ]),
        hR: trk3(t, [
          [0, REST_R],
          [0.18, [1.8, 4, 13]],
          [0.5, [0.4, 2.6, 20.5], easeOut],
          [0.75, [0.4, 2.6, 20.5]],
          [0.85, [-0.7, 2.4, 21.5], smooth],
        ]),
        hL: trk3(t, [
          [0, REST_L],
          [0.3, [1.6, -1.5, 14]],
        ]),
        grip: trk(t, [
          [0.15, 0],
          [0.45, 1, smooth],
        ]),
        sYaw: trk(t, [
          [0, 0.15],
          [0.4, -0.2],
        ]),
        sPitch: trk(t, [
          [0, 1.42],
          [0.5, 1.62, easeOut],
          [0.75, 1.62],
          [0.85, 1.8, smooth],
        ]),
        glow:
          trk(t, [
            [0, 0.8],
            [0.25, 1.1],
            [0.5, 1.6],
            [0.75, 1.6],
            [0.85, 2],
          ]) + (hold && f % 2 ? 0.25 : 0),
        head: trk(t, [
          [0, 0],
          [0.45, -0.3, smooth],
          [0.75, -0.3],
          [0.85, -0.15],
        ]),
        hem: t * 9,
        hemA: 0.4 + 0.4 * sstep(0.2, 0.6, t),
        stole: Math.sin(t * 13) * 0.35 * sstep(0.1, 0.5, t) - 0.35 * sstep(0, 0.5, t),
        swirl: trk(t, [
          [0.2, 0],
          [0.6, 0.7],
          [0.85, 1],
        ]),
        swPh: t * 11,
        swC: true,
      };
      if (hold) o.z += f % 2 ? 0.3 : -0.15;
      return o;
    }
    case 'crec': {
      // Кадр 0 — бросок к герою; держит луч; замах — и удар посохом в лёд (кадр 21).
      const o: KeepO = {
        ...O0,
        grip: 1,
        sYaw: 0,
        sPitch: trk(t, [
          [0, 0.42],
          [0.042, 0.26, easeOut],
          [0.16, 0.4, smooth],
          [0.6, 0.45],
          [0.79, 1.15, smooth],
          [0.83, 0.55, easeIn],
          [0.875, -0.32, easeIn],
        ]),
        hR: trk3(t, [
          [0, [5.4, 2.2, 13.5]],
          [0.042, [6, 2, 13]],
          [0.16, [5, 2.2, 13.6], smooth],
          [0.6, [4.8, 2.2, 14]],
          [0.79, [3, 2.6, 19], smooth],
          [0.875, [5.6, 2, 9.5], easeIn],
        ]),
        lean: trk(t, [
          [0, 0.34],
          [0.042, 0.42],
          [0.16, 0.3, smooth],
          [0.6, 0.26],
          [0.79, 0, smooth],
          [0.875, 0.46, easeIn],
        ]),
        z: trk(t, [
          [0, 1.8],
          [0.2, 1, smooth],
          [0.6, 1],
          [0.79, 1.8, smooth],
          [0.875, -0.2, easeIn],
        ]),
        flare: trk(t, [
          [0, 1],
          [0.3, 0.3, easeOut],
          [0.6, 0.2],
          [0.79, 0],
          [0.875, 0.9, easeIn],
        ]),
        glow:
          trk(t, [
            [0, 2],
            [0.12, 1.3, easeOut],
            [0.6, 1.2],
            [0.79, 1.6],
            [0.875, 2],
          ]) + (f >= 6 && f <= 14 && f % 2 ? 0.15 : 0),
        head: trk(t, [
          [0, 0.15],
          [0.6, 0.1],
          [0.79, -0.15, smooth],
          [0.875, 0.25],
        ]),
        hem: 3 + t * 7,
        hemA: 0.5,
        stole: trk(t, [
          [0, -0.7],
          [0.3, 0.35, smooth],
          [0.6, 0],
          [0.79, -0.3],
          [0.875, 0.7, easeIn],
        ]),
        burst: t < 0.17 ? 0.15 + t / 0.2 : 0,
        side: 0,
        stream: t > 0.18 && t < 0.62 ? sstep(0.18, 0.28, t) * (1 - sstep(0.52, 0.62, t)) : 0,
        strPh: t * 3.2,
        slam: f >= 21 ? 0.15 : 0,
      };
      return o;
    }
    case 'cfol': {
      // Отскок после удара посохом (погоня, первые 0,25 с): крошка, посох назад.
      const k = sstep(0.06, 0.25, t);
      return {
        ...O0,
        grip: 1 - k,
        sYaw: lerp(0, 0.15, k),
        sPitch: lerp(-0.32, 1.42, easeOut(k)),
        hR: lerp3([5.6, 2, 9.5], REST_R, k),
        lean: lerp(0.46, 0.15, k),
        head: lerp(0.25, 0.14, k),
        z: lerp(-0.2, 0, k),
        flare: lerp(0.9, 0, k),
        glow: lerp(2, 0.3, easeOut(k)),
        hem: 9 + t * 6,
        stole: lerp(0.7, 0, k),
        slam: 0.3 + t * 2.6,
      };
    }
    case 'summon': {
      // Посох и левая вверх, вихрь сияния кругом, на пике — дрожь.
      const hold = f >= 17;
      const o: KeepO = {
        ...O0,
        pull: trk(t, [
          [0, 0],
          [0.25, 1, easeIn],
        ]),
        shield: t < 0.25 ? 1 : 0,
        hR: trk3(t, [
          [0, REST_R],
          [0.3, [1.4, 4.6, 13]],
          [0.6, [0.6, 4, 19.5], easeOut],
          [1, [0.4, 4.2, 20.5]],
        ]),
        sPitch: 1.5,
        sYaw: 0.1,
        hL: trk3(t, [
          [0, REST_L],
          [0.25, [2.4, -3.6, 12]],
          [0.6, [0.8, -4.6, 20], easeOut],
          [1, [0.6, -4.8, 21]],
        ]),
        lean: trk(t, [
          [0, 0.05],
          [0.5, -0.16, smooth],
          [1, -0.2],
        ]),
        head: trk(t, [
          [0, 0],
          [0.5, -0.35, smooth],
          [1, -0.4],
        ]),
        z: trk(t, [
          [0, 0],
          [0.8, 2.6, smooth],
          [1, 2.8],
        ]),
        glow:
          trk(t, [
            [0, 0.8],
            [0.6, 1.4],
            [1, 1.9],
          ]) + (hold && f % 2 ? 0.2 : 0),
        swirl: trk(t, [
          [0.1, 0],
          [0.6, 0.6],
          [1, 1],
        ]),
        swPh: t * 9,
        hem: t * 10,
        hemA: lerp(0.4, 0.8, sstep(0.2, 0.7, t)),
        stole: Math.sin(t * 12) * 0.4 * sstep(0.2, 0.6, t),
      };
      if (hold) o.z += f % 2 ? 0.3 : -0.15;
      return o;
    }
    case 'srec':
      // Кадр 0 — руки в стороны, где встают духи; держит и опускает.
      return {
        ...O0,
        hL: trk3(t, [
          [0, [1.2, -8.6, 14.5]],
          [0.05, [1, -9, 13.6], easeOut],
          [0.45, [1.4, -8.2, 13]],
          [0.9, REST_L, smooth],
        ]),
        hR: trk3(t, [
          [0, [1.2, 8.2, 14.5]],
          [0.05, [1, 8.6, 13.6], easeOut],
          [0.45, [1.4, 7.8, 13]],
          [0.9, REST_R, smooth],
        ]),
        sYaw: trk(t, [
          [0, 0.45],
          [0.45, 0.4],
          [0.9, 0.15, smooth],
        ]),
        sPitch: trk(t, [
          [0, 1.38],
          [0.9, 1.42],
        ]),
        lean: trk(t, [
          [0, -0.05],
          [0.05, 0.08],
          [0.9, 0.15, smooth],
        ]),
        head: trk(t, [
          [0, -0.1],
          [0.9, 0.14, smooth],
        ]),
        z: trk(t, [
          [0, 2],
          [0.08, 1, easeOut],
          [0.45, 0.9],
          [0.9, 0, smooth],
        ]),
        glow: trk(t, [
          [0, 2],
          [0.2, 1, easeOut],
          [0.9, 0.3],
        ]),
        burst: t < 0.21 ? 0.1 + t / 0.23 : 0,
        side: 1,
        hem: 4 + t * 7,
        hemA: lerp(0.8, 0.4, t / 0.9),
        flare: trk(t, [
          [0, 0.5],
          [0.3, 0],
        ]),
      };
    case 'die': {
      // Отброшен; парение рвётся — падает на снег; роба оседает пустой.
      const B: V3 = [-0.5, 5.8, 0.6];
      const fall = t > 0.12;
      return {
        ...O0,
        lean: trk(t, [
          [0, -0.3],
          [0.12, -0.38, easeOut],
          [0.42, 0.3, smooth],
          [0.75, 0.55],
        ]),
        head: trk(t, [
          [0, -0.4],
          [0.12, -0.45],
          [0.45, 0.5, smooth],
          [0.75, 0.7],
        ]),
        z: trk(t, [
          [0, 0.8],
          [0.12, 1.3, easeOut],
          [0.42, -2.2, easeIn],
        ]),
        sink: trk(t, [
          [0.38, 0],
          [0.78, 1, smooth],
        ]),
        arm: trk3(t, [
          [0, [0.5, 5.5, 16]],
          [0.15, [0, 6, 17], easeOut],
          [0.5, [2.5, 5, 6], smooth],
          [0.8, [3.5, 4.5, 3]],
        ]),
        hL: trk3(t, [
          [0, [1, -6, 14]],
          [0.15, [0.5, -6.5, 15], easeOut],
          [0.5, [2.5, -4.5, 5], smooth],
          [0.8, [3.5, -4, 3]],
        ]),
        hR: [0.5, 5.5, 16],
        butt: fall ? B : null,
        sYaw: fall ? 2.3 : 0.6,
        sPitch: fall
          ? trk(t, [
              [0.12, 1.7],
              [0.55, 0.06, easeIn],
              [0.62, 0.2, easeOut],
              [0.7, 0.06, easeIn],
            ])
          : 1.8,
        glow: trk(t, [
          [0, 2.2],
          [0.1, 1.6],
          [0.5, 0.9],
          [0.9, 0],
        ]),
        mask: trk(t, [
          [0.5, 0],
          [0.72, 1, lin],
        ]),
        wisp: trk(t, [
          [0.55, 0],
          [1.15, 1, lin],
        ]),
        hem: t * 6,
        hemA: trk(t, [
          [0, 0.6],
          [0.5, 0.1],
        ]),
        burst: t < 0.2 ? 0.1 + t / 0.22 : 0,
        side: 2,
      };
    }
  }
  return O0;
}

// ---------------------------------------------------------------------------
// Кадры и рисовальщик.
// ---------------------------------------------------------------------------

const LEN: Record<string, number> = {
  idleS: 8,
  idleN: 8,
  form: 10,
  cast: 21,
  crec: 22,
  cfol: 6,
  summon: 24,
  srec: 22,
  die: 28,
};
/** Кадр, чью позу показывает кадр `f`: удержания чередуют пару, хвосты — через кадр. */
function alias(anim: string, f: number): number {
  switch (anim) {
    case 'cast':
      return f >= 12 && f <= 17 ? 12 + ((f - 12) % 2) : f;
    case 'crec':
      return f >= 6 && f <= 14 ? 6 + ((f - 6) % 2) : f;
    case 'summon':
      return f >= 17 ? 17 + ((f - 17) % 2) : f;
    case 'srec':
      return f >= 11 ? 11 + 2 * Math.floor((f - 11) / 2) : f;
    case 'die':
      return f >= 14 ? 14 + 2 * Math.floor((f - 14) / 2) : f;
  }
  return f;
}
const REP: Record<string, number[]> = {};
const MAP: Record<string, number[]> = {};
for (const [a, n] of Object.entries(LEN)) {
  const rep: number[] = [];
  const map: number[] = [];
  for (let f = 0; f < n; f++) {
    const r = alias(a, f);
    if (!rep.includes(r)) rep.push(r);
    map.push(rep.indexOf(r));
  }
  REP[a] = rep;
  MAP[a] = map;
}
const N = Object.fromEntries(Object.entries(REP).map(([a, r]) => [a, r.length]));
const TOTAL = Object.values(N).reduce((s, n) => s + n, 0);

const K = kindOf('f12_keeper', { w: 72, h: 84, ox: 36, oy: 60 }, Math.ceil(TOTAL * 8 * 1.08));
const build = (anim: string, i: number) => keepBuild(pose(anim, REP[anim][i]));

const DIE = 1.15;
/** Щит собирается за столько секунд до конца `spent`. */
const FORM = 0.45;
/** Наклон по ходу (сглажен): парит, а не шагает. */
const TILT = new WeakMap<Mob, { r: number; now: number }>();

/** У горящей жаровни — тёплый, щита нет (как в мозгу). */
function warmAt(m: Mob): boolean {
  const st = f12State(paintSim());
  if (!st) return false;
  return st.braziers.some(
    (o) => st.lit.has(o.id) && Math.hypot(o.x + 0.5 - m.x, o.y + 0.5 - m.y) < 3.2,
  );
}

paintMob('f12_keeper', (m: Mob, p: MobPose): MobFrame => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const d = m.data ?? {};
  const v = visOf(m, p, m.face ?? 0, 10);
  const ex: Partial<MobFrame> = { shadow: 6 };
  let anim = 'idleS';
  let f = 0;
  const castRec = (d.sum ?? 0) <= 10.6 && v.prev !== 'f12_summon';
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, LEN.die - 1);
    ex.linger = DIE;
    ex.still = true;
    ex.alpha = 1 - sstep(0.85, DIE, t);
    ex.shadow = 6 * (1 - 0.5 * sstep(0.3, 0.5, t));
  } else if (mode === 'f12_wind') {
    anim = 'cast';
    f = fi(t, LEN.cast - 1);
    ex.still = true;
  } else if (mode === 'f12_summon') {
    anim = 'summon';
    f = fi(t, LEN.summon - 1);
    ex.still = true;
  } else if (mode === 'recover') {
    anim = castRec ? 'crec' : 'srec';
    f = fi(t, LEN[anim] - 1);
    ex.still = true;
    if (castRec) {
      // Бросок — выпад к герою; удар посохом — вжатие.
      const cf = Math.cos(v.yaw);
      const sf = Math.sin(v.yaw) * 0.77;
      const go = 1.4 * (1 - sstep(0, 0.25, t)) + 0.9 * sstep(0.8, 0.875, t);
      ex.dx = cf * go;
      ex.dy = sf * go;
      if (f < 2 || f === 20) ex.ghost = { every: 0.03, life: 0.12, tint: '#9affd8', alpha: 0.3 };
      if (f === 21) {
        ex.sx = 1.06;
        ex.sy = 0.93;
      }
    } else if (f < 2) {
      ex.sx = 1.05;
      ex.sy = 0.95;
    }
  } else if (v.prev === 'recover' && castRec && t < 0.25 && mode === 'chase') {
    anim = 'cfol';
    f = fi(t, LEN.cfol - 1);
    ex.still = true;
    if (f < 2) {
      ex.sx = 1.05;
      ex.sy = 0.94;
    }
  } else {
    const spent = d.spent ?? 0;
    const warm = warmAt(m);
    if (!warm && spent > 0 && spent < FORM) {
      anim = 'form';
      f = Math.min(LEN.form - 1, Math.floor(((FORM - spent) / FORM) * LEN.form));
    } else {
      anim = !warm && spent <= 0 ? 'idleS' : 'idleN';
      f = idlePh(m, now, 7, 8);
    }
  }
  // Парит: клонится по ходу (сглажено), без новых кадров.
  let tl = TILT.get(m);
  if (!tl) TILT.set(m, (tl = { r: 0, now }));
  const dt = clamp(now - tl.now, 0, 0.1);
  tl.now = now;
  const want = mode === 'chase' ? clamp((m.vx ?? 0) * 0.04, -0.1, 0.1) : 0;
  tl.r += (want - tl.r) * Math.min(1, dt * 6);
  if (mode !== 'dying') ex.rot = (ex.rot ?? 0) + tl.r;
  const i = MAP[anim][f];
  const fr = frameOf(K, anim, i, dirOf(v.yaw), p, () => build(anim, i));
  if (mode !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_keeper', () => warmAll(K, Object.entries(N) as [string, number][], build));
