// Этаж 12 — Вмёрзший воин (анимации мобов 12). Мозг `f12_warrior`
// (`f12-brains.ts`): `f12_frozen` — стоит в глыбе льда (пост); герой рядом
// 1,2 с (`data.near`) или три удара (`data.hits`) → `f12_thaw` 1,1 с (в 0
// зона `f12_shatter`, `m.face` на героя) → `chase`. Вплотную — каждый третий
// раз `f12_slam`, иначе `f12_wind`. `f12_wind` 0,75 с: прицел до 0,375,
// конус r 2 дуга 1,7, урон в 0,75, рывок v 3 → `recover` 0,7. `f12_slam`
// 0,95 с: круг r 1,35 в 1,2 впереди, урон в 0,95 (+ `f12_frostburst`, тряска
// 0,2) → `recover` 0,7. Что было перед отходом — по `data.n` (кратно 3 —
// удар сверху).
//
// Кадры (24 к/с от `pose.t`, 8 честных сторон — секира в правой руке):
// покой 8 (4 к/с, фаза от id: дышит паром, секира на плече, оглядывается),
// шаг 8 по пройденному пути, во льду 9 (трещины по ударам × дрожь по
// `data.near`, глаза разгораются), оттаял 20 (глыба лопнула, отряхивает
// иней, рык с секирой вверх, стойка), рубка 18 (шаг назад, секира за правым
// плечом, держит — иней трещит, косой удар через конус за 3 кадра со
// следом) + отход 14 (кадр 0 — урон: лезвие внизу слева, рывок, возврат),
// удар сверху 23 (присел, взмыл с секирой над головой обеими руками, держит,
// обрушил за 3 кадра) + отход 14 (кадр 0 — урон: лезвие во льду, крошка;
// выдёргивает), вздрог 8, смерть 21 (на колени, секира падает, иней
// покрывает — рассыпается льдом, `linger`).

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { BONE, hash, hx, ICE, ramp, SNOW, TAU, WHITE, WOOD } from './f12-rig';
import {
  angD,
  clamp01,
  dirOf,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  paintMob,
  PI,
  puff,
  rollParts,
  speedOf,
  sstep,
  tf,
  trk,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Ease, Part, RGBA, Scr, V3 } from './f12-mobkit';

const W_SKIN = ramp('#1a2a44', '#2c4468', '#466690', '#6a8cb4', '#9ab8d8');
const W_IRON = ramp('#14161c', '#2a2e38', '#464c58', '#6a7280', '#9aa2ae');
const W_CLOAK = ramp('#1c120c', '#34221a', '#523828', '#74523a', '#9a7454');
const W_FUR = ramp('#2a2420', '#4a4038', '#6e6254', '#988a78', '#c4b8a4');
const W_BEARD = ramp('#4a5a70', '#7a8aa0', '#a8b8cc', '#d4e0ec', '#f4f8ff');
const W_BOOT = ramp('#0a0a0e', '#16161c', '#24242c', '#363640', '#4c4c58');
const EYE = hx('#8af0ff');
const EYE_HOT = hx('#e8ffff');
const RIME: RGBA = [236, 246, 255, 230];
const SPARK: RGBA[] = [WHITE, hx('#d8fcff'), hx('#7ae8f0')];
const CHIP: RGBA[] = [WHITE, hx('#d8f0ff'), ICE[4], ICE[3]];
const CRACK: RGBA = [240, 250, 255, 255];
const SLASH: RGBA = [216, 244, 255, 255];

const K = kindOf('f12_warrior', { w: 64, h: 64, ox: 32, oy: 46 }, 1300);

// ---------------------------------------------------------------------------
// Поза и модель.
// ---------------------------------------------------------------------------

/** Поза воина: точки в осях модели (x вперёд, y вправо, z вверх). */
interface WarO {
  /** Наклон корпуса вперёд от пояса, рад. */
  lean: number;
  /** Закрутка плеч (+ — правое плечо назад), рад. */
  tw: number;
  /** Крен всей модели (+ — на правую ногу). */
  roll: number;
  /** Высота пояса от стойки (присед −, прыжок +). */
  z: number;
  /** Стопы: [вперёд, вбок, подъём]. */
  footL: V3;
  footR: V3;
  /** Кисти рук (точки модели); `two` — левая на древке ниже правой. */
  handL: V3;
  handR: V3;
  two?: boolean;
  /** Секира: курс и наклон древка от правой кисти. */
  axeYaw: number;
  axePitch: number;
  /** Секира выпала из рук: лежит у ног (смерть) 0…1. */
  drop?: number;
  /** Голова: кивок (+ вверх) и поворот. */
  nod: number;
  hyaw: number;
  /** Плащ: отмах назад, рад. */
  cape: number;
  /** Иней на воине 0…1, свет глаз 0…1. */
  frost: number;
  glow: number;
  /** Глыба льда вокруг 0…1 и трещины на ней 0…3. */
  block?: number;
  bcrack?: number;
  /** Осколки глыбы разлетаются 0…1. */
  shards?: number;
  /** Пар изо рта (фаза 0…1). */
  breath?: number;
  /** Иней с плеч осыпается (фаза 0…1). */
  shake?: number;
  /** Искры инея у лезвия (фаза кадра), −1 — нет. */
  spark?: number;
  /** След лезвия: точки кончика по ходу удара (модель). */
  trail?: [V3, V3][];
  /** Крошка льда у лезвия (удар во лёд) 0…1. */
  chips?: number;
  /** Снег из-под стопы при шаге: [сторона, доля разлёта]. */
  dust?: [number, number];
  /** Смерть: лёд покрывает 0…1, осыпается 0…1. */
  ice?: number;
  cr?: number;
  shut?: boolean;
}

const S = 1.1;
const REST_R: V3 = [2.6, 5, 10.5];
const REST_L: V3 = [1.8, -5, 9.2];
const O0: WarO = {
  lean: 0.08,
  tw: 0,
  roll: 0,
  z: 0,
  footL: [0.6, -2.4, 0],
  footR: [-0.4, 2.4, 0],
  handL: REST_L,
  handR: REST_R,
  axeYaw: PI * 0.92,
  axePitch: 1.15,
  nod: 0,
  hyaw: 0,
  cape: 0.2,
  frost: 0.35,
  glow: 0.5,
};

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** Сустав двух звеньев (бедро/голень, плечо/предплечье): изгиб к `bend`. */
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
  n = nl > 1e-3 ? mul(n, 1 / nl) : [1, 0, 0];
  return add(add(a, mul(u, x)), mul(n, h));
}

/** Цепочка шаров по отрезку (звено конечности). */
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

const AXE_L = 10.5;
const AXE_BACK = 3;
/** Точка древка (доля `at` длины; 1 — кончик) от кисти по курсу и наклону. */
function axeTip(hand: V3, yaw: number, pitch: number, at = 1): V3 {
  const c = Math.cos(pitch);
  const l = AXE_L * S * at;
  return [
    hand[0] + Math.cos(yaw) * c * l,
    hand[1] + Math.sin(yaw) * c * l,
    hand[2] + Math.sin(pitch) * l,
  ];
}

/** Части секиры (древко, лезвия): при смерти лежат, а не рассыпаются. */
const isAxe = (p: Part) => (p.id ?? 0) >= 94 && (p.id ?? 0) <= 97;

function warBuild(o: WarO): Build {
  const parts: Part[] = [];
  const hipZ = 9.2 * S + o.z;
  const sl = Math.sin(o.lean);
  const cl = Math.cos(o.lean);
  const C: V3 = [sl * 5 * S, 0, hipZ + cl * 5 * S];
  const ct = Math.cos(o.tw);
  const st = Math.sin(o.tw);
  const rot = (v: V3): V3 => [v[0] * ct - v[1] * st, v[0] * st + v[1] * ct, v[2]];
  // Ноги: бедро → колено (вперёд) → стопа.
  for (const e of [-1, 1]) {
    const f = e > 0 ? o.footR : o.footL;
    const hip: V3 = [0, e * 1.9 * S, hipZ - 0.6];
    const foot: V3 = [f[0] * S, f[1] * S, 1.1 + f[2]];
    const knee = joint(hip, foot, 4.6 * S, 4.6 * S, [1, e * 0.15, 0]);
    seg(parts, hip, knee, 1.75 * S, 1.5 * S, W_CLOAK, 60 + e);
    seg(parts, knee, foot, 1.45 * S, 1.25 * S, W_FUR, 62 + e);
    parts.push({
      x: foot[0] + 0.9 * S,
      y: foot[1],
      z: foot[2] - 0.2,
      rx: 2 * S,
      ry: 1.25 * S,
      rz: 1 * S,
      pitch: f[2] > 0.5 ? 0.3 : 0,
      ramp: W_BOOT,
      id: 64 + e,
    });
  }
  // Пояс, юбка из шкуры.
  parts.push({ x: 0, y: 0, z: hipZ, rx: 2.6 * S, ry: 3.2 * S, rz: 2 * S, ramp: W_CLOAK, id: 70 });
  parts.push({
    x: 0.3,
    y: 0,
    z: hipZ - 1.6,
    rx: 2.9 * S,
    ry: 3.4 * S,
    rz: 1.8 * S,
    ramp: W_FUR,
    fur: 0.25,
    id: 71,
  });
  // Корпус: кольчуга, грудь закручена.
  parts.push({
    x: C[0] * 0.5,
    y: 0,
    z: (hipZ + C[2]) / 2,
    rx: 2.5 * S,
    ry: 3.1 * S,
    rz: 2.8 * S,
    pitch: -o.lean,
    yaw: o.tw,
    ramp: W_IRON,
    fur: 0.12,
    id: 72,
  });
  parts.push({
    x: C[0],
    y: 0,
    z: C[2],
    rx: 2.9 * S,
    ry: 3.9 * S,
    rz: 2.9 * S,
    pitch: -o.lean,
    yaw: o.tw,
    ramp: W_IRON,
    fur: 0.12,
    id: 73,
  });
  // Плащ из шкуры: на плечах и за спиной, отмах назад.
  const back: V3 = add(C, rot([-2.6 * S, 0, -0.6]));
  parts.push({
    x: back[0],
    y: back[1],
    z: back[2] + 0.8,
    rx: 1.8 * S,
    ry: 4.6 * S,
    rz: 3.2 * S,
    yaw: o.tw,
    ramp: W_FUR,
    fur: 0.3,
    id: 74,
  });
  const cp = o.cape;
  parts.push({
    x: back[0] - Math.sin(cp) * 3.5 - 0.6,
    y: back[1],
    z: back[2] - Math.cos(cp) * 3.6,
    rx: 1.4 * S,
    ry: 4 * S,
    rz: 3.4 * S,
    yaw: o.tw,
    pitch: cp,
    ramp: W_FUR,
    fur: 0.3,
    id: 75,
  });
  // Голова: лицо, борода, шлем с рогами.
  const nk: V3 = [C[0] + sl * 3.2 * S, 0, C[2] + cl * 3.2 * S];
  const hl = o.lean - o.nod;
  const hd: V3 = [nk[0] + Math.sin(hl) * 1.6 * S, 0, nk[2] + Math.cos(hl) * 1.6 * S];
  const hy = o.hyaw + o.tw * 0.5;
  const fwd: V3 = [Math.cos(hy) * Math.cos(hl), Math.sin(hy) * Math.cos(hl), -Math.sin(hl)];
  const side: V3 = [-Math.sin(hy), Math.cos(hy), 0];
  const up: V3 = [Math.cos(hy) * Math.sin(hl), Math.sin(hy) * Math.sin(hl), Math.cos(hl)];
  const at = (f: number, s: number, u: number): V3 =>
    add(hd, add(mul(fwd, f * S), add(mul(side, s * S), mul(up, u * S))));
  const pt = (q: V3, r: number[], R: RGBA[], id: number, extra: Partial<Part> = {}) =>
    parts.push({ x: q[0], y: q[1], z: q[2], rx: r[0], ry: r[1], rz: r[2], ramp: R, id, ...extra });
  pt(hd, [2.2 * S, 2.1 * S, 2.3 * S], W_SKIN, 76);
  pt(at(1.4, 0, -1.6), [1.6 * S, 1.8 * S, 1.7 * S], W_BEARD, 77, { fur: 0.2, yaw: hy, pitch: -hl });
  pt(at(-0.2, 0, 1.2), [2.5 * S, 2.5 * S, 1.7 * S], W_IRON, 78, { yaw: hy, pitch: -hl });
  pt(at(0.2, 0, 2.4), [1, 1, 1], W_IRON, 79);
  for (const e of [-1, 1])
    [
      [0, 2.2, 1.6, 0.85],
      [0.4, 3.6, 2.4, 0.75],
      [0.9, 4.3, 3.6, 0.6],
      [1.4, 4.4, 4.8, 0.45],
    ].forEach(([f, s, u, r], i) =>
      pt(at(f, e * s, u), [r * S, r * S, r * S], BONE, 80 + e, { id: 80 + e + i * 0 }),
    );
  const eyePts = [at(2, -0.85, 0.2), at(2, 0.85, 0.2)];
  // Руки: плечо (наплечник) → локоть (наружу, вниз) → кисть.
  const hands: V3[] = [];
  let hL = o.handL;
  const hR: V3 = mul(o.handR, S);
  const dir: V3 = [
    Math.cos(o.axeYaw) * Math.cos(o.axePitch),
    Math.sin(o.axeYaw) * Math.cos(o.axePitch),
    Math.sin(o.axePitch),
  ];
  if (o.two) hL = mul(sub(hR, mul(dir, 3.4 * S)), 1 / S);
  for (const e of [-1, 1]) {
    const sh = add(C, rot([-0.2, e * 3.9 * S, 1.3 * S]));
    const hand: V3 = e > 0 ? hR : mul(hL, S);
    if (o.drop === undefined || e < 0 || o.drop <= 0) hands.push(hand);
    const el = joint(sh, hand, 4.2 * S, 4.2 * S, [-0.5, e * 0.9, -0.5]);
    pt(sh, [1.9 * S, 1.9 * S, 1.7 * S], W_IRON, 84 + e);
    seg(parts, sh, el, 1.35 * S, 1.2 * S, W_FUR, 86 + e);
    seg(parts, el, hand, 1.2 * S, 1.05 * S, W_SKIN, 88 + e);
    pt(hand, [1.2 * S, 1.2 * S, 1.2 * S], W_BOOT, 90 + e);
  }
  // Секира: древко и ледяное лезвие с бородой.
  const dk = o.drop ?? 0;
  let ay = o.axeYaw;
  let ap = o.axePitch;
  let grip = hR;
  if (dk > 0) {
    // Выпала: древко ложится на лёд у правой ноги.
    grip = [lerp(hR[0], 1.5, dk), lerp(hR[1], 5.5 * S, dk), lerp(hR[2], 1, dk)];
    ay = lerp(ay, 0.6, dk);
    ap = lerp(ap, -0.05, dk);
  }
  const ca = Math.cos(ap);
  const ad: V3 = [Math.cos(ay) * ca, Math.sin(ay) * ca, Math.sin(ap)];
  const nh = 7;
  for (let i = 0; i <= nh; i++) {
    const k = -AXE_BACK * S + ((AXE_L + AXE_BACK) * S * i) / nh;
    const q = add(grip, mul(ad, k));
    if (dk > 0) q[2] = Math.max(q[2], 0.7 * S);
    pt(q, [0.65 * S, 0.65 * S, 0.65 * S], WOOD, 94);
  }
  const tip = add(grip, mul(ad, AXE_L * S));
  // Двойное ледяное лезвие: два полумесяца по обе стороны древка в его
  // вертикальной плоскости (длинные вдоль древка, тонкие поперёк).
  const upA: V3 = [-Math.cos(ay) * Math.sin(ap), -Math.sin(ay) * Math.sin(ap), ca];
  const flat = (dk * PI) / 2;
  const nn: V3 = add(
    mul(upA, Math.cos(flat)),
    mul([-Math.sin(ay), Math.cos(ay), 0], Math.sin(flat)),
  );
  const head = add(grip, mul(ad, (AXE_L - 1.3) * S));
  for (const e of [-1, 1]) {
    pt(add(head, mul(nn, e * 1.5 * S)), [2.3 * S, 0.55 * S, 1.6 * S], ICE, 95 + (e > 0 ? 1 : 0), {
      yaw: ay,
      pitch: ap,
      roll: -flat,
      gloss: true,
    });
  }
  pt(tip, [0.7 * S, 0.7 * S, 0.7 * S], ICE, 97, { gloss: true });
  // Глыба (во льду): три сросшихся куска стекла, видно воина.
  if (o.block) {
    const b = o.block;
    const glass = (x: number, y: number, z: number, r: V3, ex: Partial<Part>, id: number) =>
      parts.push({
        x,
        y,
        z,
        rx: r[0],
        ry: r[1],
        rz: r[2],
        ramp: ICE,
        alpha: 0.36,
        gloss: true,
        id,
        ...ex,
      });
    glass(0.4, 0, 9 * S * b, [6.6 * S, 7.4 * S, 10 * S * b], { yaw: 0.3 }, 98);
    glass(-0.8, 1.2, 19 * S * b, [5 * S, 5.6 * S, 6.5 * S * b], { yaw: -0.5, pitch: 0.15 }, 99);
    glass(2.5, -5, 5 * S * b, [2.8 * S, 2.6 * S, 6 * S * b], { roll: -0.35 }, 100);
  }
  // Смерть: лёд покрывает части по очереди снизу вверх, потом осыпаются.
  const ice = o.ice ?? 0;
  if (ice > 0)
    parts.forEach((p, i) => {
      if (p.alpha || isAxe(p)) return;
      if (p.z / 30 + hash(i, 3, 61) * 0.3 < ice * 1.3) {
        p.ramp = ICE;
        p.gloss = true;
        p.fur = 0;
      }
    });
  const cr = o.cr ?? 0;
  if (cr > 0)
    parts.forEach((p, i) => {
      if (isAxe(p)) return;
      const dl = 0.05 + hash(i, 5, 61) * 0.35 + (p.z / 40) * 0.2;
      const k = sstep(0, 1, (cr - dl) / (1 - dl - 0.05));
      if (k <= 0) return;
      const sc = 1 - 0.35 * k;
      p.rx *= sc;
      p.ry *= sc;
      p.rz *= sc;
      const a = Math.atan2(p.y, p.x + 0.01) + (hash(i, 7, 61) - 0.5) * 1.4;
      const go = k * (2 + hash(i, 9, 61) * 5);
      p.x += Math.cos(a) * go;
      p.y += Math.sin(a) * go;
      p.z = lerp(p.z, Math.min(p.rx, p.rz) * 0.7, k);
      p.pitch = (p.pitch ?? 0) + k * (hash(i, 11, 61) - 0.5) * 2;
    });
  rollParts(parts, o.roll, 2);
  const glowOn = o.glow > 0 && !o.shut && cr < 0.3;
  const eyeC = o.glow > 0.8 ? EYE_HOT : EYE;
  const extent: V3[] = [];
  if (o.trail) for (const [a, b] of o.trail) extent.push(a, b);
  if (o.shards !== undefined) extent.push([12, 0, 4], [-10, 0, 4], [0, 11, 4], [0, -11, 4]);
  if (o.chips !== undefined) extent.push(add(tip, [5, 5, 4]), add(tip, [-5, -5, 0]));
  return {
    parts,
    eyes: glowOn ? eyePts.map((e) => ({ x: e[0], y: e[1], z: e[2], c: eyeC })) : [],
    extent,
    post: (p, scr) => {
      if (o.frost > 0) rimeOf(p, scr, C, hd, o.frost, o.tw);
      if (o.block && o.bcrack) blockCracks(p, scr, o.bcrack);
      if (o.block) facets(p, scr, o.block);
      if (o.trail) slashOf(p, scr, o.trail);
      if (o.spark !== undefined && o.spark >= 0) sparkOf(p, scr, tip, o.spark);
      if (o.chips !== undefined) puff(p, scr, tip[0], tip[1], o.chips, 14, 9, 61, CHIP, 0, TAU);
      if (o.shards !== undefined) shardsOf(p, scr, o.shards);
      if (o.breath !== undefined) breathOf(p, scr, at(2.6, 0, -0.8), fwd, o.breath);
      if (o.shake !== undefined) shakeOf(p, scr, C, o.shake);
      if (o.dust) {
        const f = o.dust[0] > 0 ? o.footR : o.footL;
        puff(p, scr, f[0] * S + 1, f[1] * S, o.dust[1], 6, 6, 63, SNOW, 0, TAU);
      }
      // Рука держит секиру: ладонь поверх древка (иначе древко «висит»).
      for (const h of hands) {
        const [x, y] = scr(h[0], h[1], h[2] + 0.4);
        if (p.solid(Math.round(x), Math.round(y))) p.set(x, y, W_SKIN[3]);
      }
    },
  };
}

/** Иней на плечах, шлеме, бороде: белые точки (их больше, чем сильнее иней). */
function rimeOf(p: Px, scr: Scr, C: V3, hd: V3, k: number, tw: number): void {
  const n = Math.round(4 + k * 10);
  for (let i = 0; i < n; i++) {
    const onHead = i % 3 === 0;
    const a = hash(i, 1, 71) * TAU;
    const base = onHead ? hd : C;
    const r = onHead ? 2.2 : 3.4;
    const [x, y] = scr(
      base[0] + Math.cos(a + tw) * r * 0.6 - 0.5,
      base[1] + Math.sin(a + tw) * r,
      base[2] + (onHead ? 2.4 : 2.2) + hash(i, 2, 71),
    );
    if (p.solid(Math.round(x), Math.round(y))) p.set(x, y, RIME);
  }
}

/** Грани глыбы: светлые прямые сколы. */
function facets(p: Px, scr: Scr, k: number): void {
  for (const [a, b] of [
    [
      [-4, -7, 3],
      [-1, -6.5, 22],
    ],
    [
      [5, 6, 2],
      [2, 7, 20],
    ],
    [
      [6, -3, 18],
      [-3, 4, 25],
    ],
  ] as [V3, V3][]) {
    const [x0, y0] = scr(a[0] * S, a[1] * S, a[2] * S * k);
    const [x1, y1] = scr(b[0] * S, b[1] * S, b[2] * S * k);
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++)
      p.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, [216, 240, 255, 110]);
  }
}

/** Трещины по глыбе: по числу ударов героя. */
function blockCracks(p: Px, scr: Scr, n: number): void {
  for (let j = 0; j < n * 2; j++) {
    const a = hash(j, 3, 71) * TAU;
    let [x, y] = scr(Math.cos(a) * 6.5 * S, Math.sin(a) * 6.5 * S, (8 + hash(j, 4, 71) * 10) * S);
    x = Math.round(x);
    y = Math.round(y);
    for (let s = 0; s < 6; s++) {
      x += hash(j, s, 72) > 0.5 ? 1 : -1;
      y += hash(j, s, 73) > 0.4 ? 1 : -1;
      if (p.solid(x, y)) p.set(x, y, CRACK);
    }
  }
}

/**
 * След лезвия — серп: полоса от середины древка до кончика по последним
 * положениям секиры; ярче к кромке и к голове удара, тает к хвосту. Каждый
 * пиксель — один раз (наибольшая яркость), без наслоения.
 */
function slashOf(p: Px, scr: Scr, pts: [V3, V3][]): void {
  const sp = pts.map(([a, b]) => [scr(a[0], a[1], a[2]), scr(b[0], b[1], b[2])]);
  const acc = new Map<number, number>();
  const n = sp.length;
  for (let i = 0; i < n - 1; i++) {
    const [[ax0, ay0], [bx0, by0]] = sp[i];
    const [[ax1, ay1], [bx1, by1]] = sp[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx1 - bx0, by1 - by0) * 1.5));
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const k = (i + u) / (n - 1);
      const ix = lerp(ax0, ax1, u);
      const iy = lerp(ay0, ay1, u);
      const ox = lerp(bx0, bx1, u);
      const oy = lerp(by0, by1, u);
      const L = Math.max(1, Math.ceil(Math.hypot(ox - ix, oy - iy) * 1.5));
      for (let j = 0; j <= L; j++) {
        const r = j / L;
        const x = Math.round(lerp(ix, ox, r));
        const y = Math.round(lerp(iy, oy, r));
        const a = j >= L - 1 ? 0.35 + 0.65 * k : (0.15 + 0.85 * k) * (0.06 + 0.8 * r * r);
        const key = y * 4096 + x;
        if ((acc.get(key) ?? 0) < a) acc.set(key, a);
      }
    }
  }
  for (const [key, a] of acc) {
    const y = Math.floor(key / 4096);
    const x = key - y * 4096;
    const c = a > 0.5 ? SLASH : ICE[4];
    p.set(x, y, [c[0], c[1], c[2], Math.round(255 * Math.min(1, a))]);
  }
}

/** Иней трещит у лезвия: искры вокруг, свой рисунок на кадр. */
function sparkOf(p: Px, scr: Scr, tip: V3, ph: number): void {
  for (let i = 0; i < 5; i++) {
    const a = hash(i, ph, 74) * TAU;
    const r = 2.6 + hash(i, ph, 75) * 2;
    const [x, y] = scr(tip[0] + Math.cos(a) * r, tip[1], tip[2] + Math.sin(a) * r);
    p.set(x, y, SPARK[i % 3]);
  }
}

/** Осколки глыбы: летят дугой во все стороны. */
function shardsOf(p: Px, scr: Scr, k: number): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < 16; i++) {
    const a = hash(i, 5, 76) * TAU;
    const v = 0.5 + hash(i, 6, 76) * 0.5;
    const r = (6 + 9 * k * v) * S;
    const z = (6 + hash(i, 7, 76) * 14) * S + Math.sin(k * PI) * 5 - k * k * 14;
    if (z < 0.5) continue;
    const [x, y] = scr(Math.cos(a) * r, Math.sin(a) * r, z);
    const c = CHIP[i % CHIP.length];
    p.set(x, y, c);
    if (i % 3 === 0) p.set(x + 1, y, c);
  }
}

/** Пар изо рта: два-три клуба вперёд и вверх, тают. */
function breathOf(p: Px, scr: Scr, m: V3, f: V3, ph: number): void {
  for (let i = 0; i < 3; i++) {
    const q = (ph + i * 0.18) % 1;
    if (q > 0.7) continue;
    const [x, y] = scr(m[0] + f[0] * q * 5, m[1] + f[1] * q * 5, m[2] + q * 2.5);
    const a = Math.round(200 * (1 - q / 0.7));
    p.set(x, y, [236, 244, 255, a]);
    if (q > 0.25) p.set(x + 1, y, [236, 244, 255, Math.round(a * 0.6)]);
  }
}

/** Отряхивает иней: крупинки сыплются с плеч. */
function shakeOf(p: Px, scr: Scr, C: V3, ph: number): void {
  for (let i = 0; i < 8; i++) {
    const q = (ph * 1.6 + i / 8) % 1;
    const e = i % 2 ? 1 : -1;
    const [x, y] = scr(C[0] - 0.5, e * (4 + q * 2.5), C[2] + 2.5 - q * 14);
    p.set(x, y, [236, 246, 255, Math.round(240 * (1 - q * 0.7))]);
  }
}

// ---------------------------------------------------------------------------
// Дорожки.
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

/** Шаг (8 на цикл): фаза 0…1; опора левой — 0, правой — 0,5. */
function walkPose(f: number): WarO {
  const ph = f / 8;
  const legOf = (q: number, e: number): V3 => {
    const u = ((q % 1) + 1) % 1;
    if (u < 0.5) return [lerp(2.6, -2.6, u / 0.5), e * 2.3, 0];
    const s = (u - 0.5) / 0.5;
    return [lerp(-2.6, 2.6, easeOut(s)), e * 2.3, Math.sin(s * PI) * 2.4];
  };
  const L = legOf(ph, -1);
  const R = legOf(ph + 0.5, 1);
  const sw = Math.sin(ph * TAU);
  const plant = Math.max(0, Math.cos(ph * 2 * TAU));
  return {
    ...O0,
    footL: L,
    footR: R,
    z: -0.5 * plant,
    roll: -sw * 0.05,
    lean: 0.18,
    tw: sw * 0.12,
    handL: [REST_L[0] - L[0] * 0.8, REST_L[1], REST_L[2] + Math.max(0, -L[0]) * 0.3],
    handR: [REST_R[0] - R[0] * 0.25, REST_R[1], REST_R[2] + 0.3 * plant],
    cape: 0.3 + 0.12 * Math.sin(ph * TAU * 2 - 1),
    nod: -0.06 * plant,
    dust:
      f === 0
        ? [-1, 0.4]
        : f === 4
          ? [1, 0.4]
          : f === 1
            ? [-1, 0.75]
            : f === 5
              ? [1, 0.75]
              : undefined,
  };
}

/** Рубка: кисть и секира по `k` = t / 0,75 (кончик лезвия — для следа). */
function chopAt(k: number): { hR: V3; hL: V3; yaw: number; pitch: number } {
  return {
    hR: trk3(k, [
      [0, REST_R],
      [0.45, [-2.2, 4.4, 20.5], easeOut],
      [0.83, [-2.6, 4.2, 21]],
      [0.92, [4.5, 2.5, 18], easeIn],
      [1, [7.5, -2.6, 7]],
      [1.12, [6.5, -4.4, 5]],
      [1.5, [5, -1, 8]],
      [1.93, REST_R],
    ]),
    hL: trk3(k, [
      [0, REST_L],
      [0.45, [4, -4.4, 12]],
      [0.83, [4.2, -4.2, 12.5]],
      [1, [2, -5.5, 9]],
      [1.93, REST_L],
    ]),
    yaw: trk(k, [
      [0, PI * 0.92],
      [0.45, PI * 1.05, easeOut],
      [0.83, PI * 1.08],
      [0.92, PI * 0.45, easeIn],
      [1, -0.55],
      [1.12, -0.85],
      [1.5, -0.3],
      [1.93, PI * 0.92],
    ]),
    pitch: trk(k, [
      [0, 1.15],
      [0.45, 0.2, easeOut],
      [0.83, 0.1],
      [0.92, 0.85, easeIn],
      [1, -0.75],
      [1.12, -0.95],
      [1.5, -0.4],
      [1.93, 1.15],
    ]),
  };
}

/** Удар сверху: кисть и секира по `k` = t / 0,95 (обе руки на древке). */
function slamAt(k: number): { hR: V3; yaw: number; pitch: number } {
  return {
    hR: trk3(k, [
      [0, REST_R],
      [0.2, [5, 1.4, 8], easeOut],
      [0.5, [-0.5, 1, 23]],
      [0.82, [-1, 1, 23.5]],
      [0.92, [6, 0.8, 16], easeIn],
      [1, [8.5, 0.6, 5]],
      [1.3, [8.4, 0.6, 5]],
      [1.5, [6, 2, 10]],
      [1.74, REST_R],
    ]),
    yaw: trk(k, [
      [0, PI * 0.92],
      [0.2, 0.1],
      [0.5, PI * 0.98],
      [0.82, PI],
      [0.9, PI * 0.5],
      [0.95, 0],
      [1.3, 0],
      [1.5, 0.3],
      [1.74, PI * 0.92],
    ]),
    pitch: trk(k, [
      [0, 1.15],
      [0.2, 0.7],
      [0.5, 0.5, easeOut],
      [0.82, 0.35],
      [0.92, 1.3, easeIn],
      [1, -0.42],
      [1.3, -0.4],
      [1.5, 0.6],
      [1.74, 1.15],
    ]),
  };
}

function pose(anim: string, f: number): WarO {
  switch (anim) {
    case 'idle': {
      // 8 кадров по 4 к/с: дышит паром, плащ колышется, оглядывается.
      const ph = (f / 8) * TAU;
      return {
        ...O0,
        z: Math.sin(ph) * 0.25,
        lean: 0.08 - Math.sin(ph) * 0.03,
        handR: [REST_R[0], REST_R[1], REST_R[2] + Math.sin(ph - 0.6) * 0.3],
        handL: [REST_L[0], REST_L[1], REST_L[2] + Math.sin(ph - 0.9) * 0.4],
        cape: 0.2 + Math.sin(ph - 1) * 0.06,
        hyaw: f >= 5 && f <= 6 ? -0.45 : f === 7 ? -0.15 : 0,
        breath: f >= 1 && f <= 4 ? (f - 1) / 4 : undefined,
        shut: f === 3,
      };
    }
    case 'walk':
      return walkPose(f);
    case 'frozen': {
      // Во льду: стойка, секира над плечом; трещины по ударам, дрожь — по
      // близости героя (глаза разгораются).
      const hits = Math.floor(f / 3);
      const near = f % 3;
      return {
        ...O0,
        lean: 0.12,
        footL: [2, -2.8, 0],
        footR: [-1.8, 2.8, 0],
        z: -0.6,
        handR: [0, 4.6, 17.5],
        handL: [3.6, -3.4, 11],
        axeYaw: PI,
        axePitch: 0.9,
        cape: 0.35,
        frost: 1,
        glow: 0.25 + near * 0.35,
        block: 1,
        bcrack: hits,
      };
    }
    case 'thaw': {
      // 1,1 с: глыба лопнула (осколки), отряхивает иней, рык с секирой
      // вверх, встаёт в стойку.
      const t = tf(f);
      const sh = sstep(0.12, 0.5, t);
      const roar = sstep(0.5, 0.68, t) * (1 - sstep(0.85, 1.05, t));
      const jit = t > 0.12 && t < 0.5 ? (f % 2 ? 1 : -1) : 0;
      return {
        ...O0,
        lean: lerp(0.12, 0.08, sh) - 0.25 * roar + jit * 0.04,
        tw: jit * 0.12,
        z: -0.6 + 0.4 * sh,
        footL: [lerp(2, 0.6, sstep(0.85, 1.05, t)), lerp(-2.8, -2.4, sh), 0],
        footR: [lerp(-1.8, -0.4, sstep(0.85, 1.05, t)), lerp(2.8, 2.4, sh), 0],
        handR: trk3(t, [
          [0.1, [0, 4.6, 17.5]],
          [0.45, [1, 5.4, 13]],
          [0.62, [0.5, 5.6, 22], easeOut],
          [0.85, [0.6, 5.6, 22.5]],
          [1.05, REST_R],
        ]),
        handL: trk3(t, [
          [0.1, [3.6, -3.4, 11]],
          [0.45, [2, -5.4, 10]],
          [0.62, [1, -7, 15], easeOut],
          [0.85, [1, -7, 15.5]],
          [1.05, REST_L],
        ]),
        axeYaw: trk(t, [
          [0.1, PI],
          [0.45, PI * 0.95],
          [0.62, PI * 0.9],
          [1.05, PI * 0.92],
        ]),
        axePitch: trk(t, [
          [0.1, 0.9],
          [0.45, 1],
          [0.62, 1.4],
          [0.85, 1.4],
          [1.05, 1.15],
        ]),
        nod: 0.45 * roar + jit * 0.06,
        hyaw: jit * 0.2,
        cape: 0.35 + 0.15 * sh,
        frost: lerp(1, 0.35, sh),
        glow: t < 0.62 ? 0.7 : 1 - 0.5 * sstep(0.85, 1.05, t),
        shards: t < 0.5 ? t / 0.5 : undefined,
        shake: t > 0.12 && t < 0.55 ? (t - 0.12) / 0.43 : undefined,
        breath: roar > 0.5 ? (t - 0.6) / 0.3 : undefined,
      };
    }
    case 'chop':
    case 'crec': {
      // Рубка 0,75 с: шаг правой назад, секира за правым плечом (держит,
      // иней трещит), косой удар через конус за 3 кадра; кадр 0 отхода —
      // урон: лезвие внизу слева, рывок вперёд, проводка, возврат.
      const t = anim === 'chop' ? tf(f) : 0.75 + tf(f);
      const k = t / 0.75;
      const a = chopAt(k);
      const hold = k > 0.45 && k < 0.83;
      let tr: [V3, V3][] | undefined;
      if (k > 0.86 && k < 1.2) {
        tr = [];
        for (let i = 0; i <= 6; i++) {
          const q = Math.max(0.83, k - 0.16 + (i / 6) * 0.16);
          const s = chopAt(q);
          tr.push([
            axeTip(mul(s.hR, S), s.yaw, s.pitch, 0.5),
            axeTip(mul(s.hR, S), s.yaw, s.pitch),
          ]);
        }
      }
      return {
        ...O0,
        lean: trk(k, [
          [0, 0.08],
          [0.45, -0.18],
          [0.83, -0.22],
          [1, 0.5, easeIn],
          [1.15, 0.55],
          [1.93, 0.08],
        ]),
        tw: trk(k, [
          [0, 0],
          [0.45, 0.65, easeOut],
          [0.83, 0.7],
          [1, -0.5, easeIn],
          [1.12, -0.6],
          [1.93, 0],
        ]),
        roll: trk(k, [
          [0, 0],
          [0.45, 0.06],
          [1, -0.05],
          [1.5, 0],
        ]),
        z: trk(k, [
          [0, 0],
          [0.45, -0.4],
          [0.83, -0.5],
          [1, -1.4],
          [1.2, -1.2],
          [1.93, 0],
        ]),
        footR: trk3(k, [
          [0, O0.footR],
          [0.35, [-3.2, 2.6, 0]],
          [1, [-3.2, 2.6, 0]],
          [1.6, O0.footR],
        ]),
        footL: trk3(k, [
          [0, O0.footL],
          [0.3, [1.6, -2.4, 0]],
          [0.88, [1.6, -2.4, 0]],
          [0.96, [3.6, -2.6, 1.2]],
          [1.04, [4.2, -2.6, 0]],
          [1.6, [2, -2.4, 0]],
          [1.93, O0.footL],
        ]),
        handR: a.hR,
        handL: a.hL,
        axeYaw: a.yaw,
        axePitch: a.pitch,
        nod: trk(k, [
          [0, 0],
          [0.45, 0.15],
          [1, -0.2],
          [1.5, 0],
        ]),
        cape: trk(k, [
          [0, 0.2],
          [0.45, 0.1],
          [1, 0.55],
          [1.25, 0.65],
          [1.93, 0.2],
        ]),
        glow: hold ? 1 : 0.6,
        spark: hold ? f : -1,
        trail: tr,
      };
    }
    case 'slam':
    case 'srec': {
      // Удар сверху 0,95 с: присел с секирой внизу, взмыл — секира над
      // головой обеими руками, держит на носках (иней собирается), обрушил за
      // 3 кадра; кадр 0 отхода — урон: лезвие во льду, крошка; выдёргивает.
      const t = anim === 'slam' ? tf(f) : 0.95 + tf(f);
      const k = t / 0.95;
      const a = slamAt(k);
      const hold = k > 0.5 && k < 0.82;
      let tr: [V3, V3][] | undefined;
      if (k > 0.85 && k < 1.15) {
        tr = [];
        for (let i = 0; i <= 6; i++) {
          const q = Math.max(0.82, k - 0.14 + (i / 6) * 0.14);
          const s = slamAt(q);
          tr.push([
            axeTip(mul(s.hR, S), s.yaw, s.pitch, 0.5),
            axeTip(mul(s.hR, S), s.yaw, s.pitch),
          ]);
        }
      }
      return {
        ...O0,
        two: k > 0.12 && k < 1.5,
        lean: trk(k, [
          [0, 0.08],
          [0.2, 0.4],
          [0.5, -0.2, easeOut],
          [0.82, -0.3],
          [1, 0.75, easeIn],
          [1.3, 0.7],
          [1.5, 0.35],
          [1.74, 0.08],
        ]),
        z: trk(k, [
          [0, 0],
          [0.2, -2.2],
          [0.5, 1.2, easeOut],
          [0.82, 1.5],
          [0.95, 0],
          [1, -2.6, easeIn],
          [1.3, -2.4],
          [1.5, -1],
          [1.74, 0],
        ]),
        footL: trk3(k, [
          [0, O0.footL],
          [0.2, [1.4, -2.8, 0]],
          [0.5, [1.4, -2.8, 0.6]],
          [0.82, [1.4, -2.8, 0.8]],
          [0.95, [1.6, -2.9, 0]],
          [1.74, O0.footL],
        ]),
        footR: trk3(k, [
          [0, O0.footR],
          [0.2, [-1.4, 2.8, 0]],
          [0.5, [-1.4, 2.8, 0.6]],
          [0.82, [-1.4, 2.8, 0.8]],
          [0.95, [-1.6, 2.9, 0]],
          [1.74, O0.footR],
        ]),
        handR: a.hR,
        handL: REST_L,
        axeYaw: a.yaw,
        axePitch: a.pitch,
        nod: trk(k, [
          [0, 0],
          [0.5, 0.35],
          [0.82, 0.4],
          [1, -0.3],
          [1.5, 0],
        ]),
        cape: trk(k, [
          [0, 0.2],
          [0.2, 0.1],
          [0.5, 0.05],
          [0.95, 0.7],
          [1.2, 0.5],
          [1.74, 0.2],
        ]),
        glow: hold ? 1 : 0.6,
        spark: hold ? f : -1,
        trail: tr,
        chips:
          k >= 1 && k < 1.45 ? 0.1 + (k - 1) * 2 : k >= 1.3 && k < 1.6 ? (k - 1.3) * 3 : undefined,
      };
    }
    case 'stun': {
      // Вздрог 0,3 с: откинуло назад, руки врозь, шаг назад — и назад.
      const a = [0, 1, 0.85, 0.6, 0.4, 0.22, 0.1, 0][f];
      return {
        ...O0,
        lean: 0.08 - 0.4 * a,
        nod: 0.35 * a,
        z: -0.6 * a,
        footR: [-0.4 - 1.6 * a, 2.6, 0],
        handL: [REST_L[0] - 1.5 * a, REST_L[1] - 1.5 * a, REST_L[2] + 2 * a],
        handR: [REST_R[0] - 1.2 * a, REST_R[1] + 0.8 * a, REST_R[2] + 1.5 * a],
        axePitch: 1.15 - 0.3 * a,
        cape: 0.2 + 0.35 * a,
        shut: f >= 1 && f <= 3,
      };
    }
    case 'die': {
      // 1,4 с: откинуло, падает на колени, секира выпала и легла плашмя;
      // иней ползёт от ног к шлему, глаза гаснут — статуя трескается и
      // рассыпается льдом (`linger`).
      const t = tf(f);
      const kn = sstep(0.12, 0.42, t);
      return {
        ...O0,
        lean: trk(t, [
          [0, 0.08],
          [0.1, -0.35],
          [0.42, 0.45, easeIn],
          [0.5, 0.35],
          [0.62, 0.4],
        ]),
        nod: trk(t, [
          [0, 0],
          [0.1, 0.5],
          [0.42, -0.2],
          [0.62, -0.35],
        ]),
        z: -5.2 * easeIn(kn),
        footL: [lerp(0.6, -3.2, kn), -2.6, lerp(0, 0.4, kn)],
        footR: [lerp(-0.4, -3.6, kn), 2.6, lerp(0, 0.4, kn)],
        handL: trk3(t, [
          [0, REST_L],
          [0.1, [-1, -6, 12]],
          [0.42, [4, -4.4, 4]],
        ]),
        handR: trk3(t, [
          [0, REST_R],
          [0.1, [-1, 6, 12]],
          [0.42, [4.2, 4.4, 4]],
        ]),
        drop: sstep(0.12, 0.4, t),
        cape: trk(t, [
          [0, 0.2],
          [0.1, 0.6],
          [0.42, 0.05],
        ]),
        frost: trk(t, [
          [0.3, 0.35],
          [0.8, 1],
        ]),
        glow: 1 - sstep(0.45, 0.75, t),
        shut: t > 0.75,
        ice: sstep(0.45, 0.85, t),
        cr: sstep(0.95, 1.35, t),
        shards: t > 0.95 && t < 1.35 ? (t - 0.95) / 0.4 : undefined,
      };
    }
  }
  return O0;
}

// ---------------------------------------------------------------------------
// Кадры и рисовальщик.
// ---------------------------------------------------------------------------

const span = (a: number, b: number, step = 1) => {
  const out: number[] = [];
  for (let i = a; i <= b; i += step) out.push(i);
  return out;
};
/** Кадры позы на дорожке техники: номер кадра 24 к/с, с которого поза. */
const KEYS: Record<string, number[]> = {
  idle: span(0, 7),
  walk: span(0, 7),
  frozen: span(0, 8),
  thaw: [...span(0, 11), ...span(12, 26, 2)],
  chop: span(0, 17),
  crec: [...span(0, 9), ...span(10, 16, 2)],
  slam: span(0, 22),
  srec: [...span(0, 9), ...span(10, 16, 2)],
  stun: span(0, 7),
  die: [...span(0, 22), ...span(23, 33, 2)],
};
const LAST: Record<string, number> = {
  thaw: 26,
  chop: 17,
  crec: 16,
  slam: 22,
  srec: 16,
  stun: 7,
  die: 33,
};
function keyOf(anim: string, f: number): number {
  const ks = KEYS[anim];
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1] <= f) i++;
  return i;
}
const build = (anim: string, i: number) => warBuild(pose(anim, KEYS[anim][i]));
const N = Object.fromEntries(Object.entries(KEYS).map(([a, ks]) => [a, ks.length]));

const DIE = 1.4;
/** Переступает, поворачиваясь на месте (свой путь шага по углу). */
const TURN = new WeakMap<Mob, { yaw: number; acc: number; until: number }>();

paintMob('f12_warrior', (m: Mob, p: MobPose): MobFrame => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const d = m.data ?? {};
  const mv = speedOf(m) > 0.3;
  const atk = mode === 'f12_wind' || mode === 'f12_slam' || mode === 'recover';
  const want = mv && mode === 'chase' ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  const v = visOf(m, p, want, atk ? 12 : 8);
  let tr = TURN.get(m);
  if (!tr) TURN.set(m, (tr = { yaw: v.yaw, acc: 0, until: -9 }));
  const dy = Math.abs(angD(v.yaw, tr.yaw));
  tr.yaw = v.yaw;
  tr.acc += dy * 1.2;
  if (dy > 0.004) tr.until = now + 0.2;
  const turning = now < tr.until && mode === 'chase';
  const fc = v.yaw;
  const cf = Math.cos(fc);
  const sf = Math.sin(fc) * 0.77;
  const ex: Partial<MobFrame> = { shadow: 7 };
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, LAST.die);
    ex.linger = DIE;
    ex.alpha = 1 - sstep(1.15, DIE, t);
    ex.still = true;
    ex.shadow = 7 * (1 - 0.6 * sstep(0.95, 1.3, t));
  } else if (mode === 'f12_frozen') {
    anim = 'frozen';
    const near = clamp01((d.near ?? 0) / 1.2);
    const lvl = near > 0.66 ? 2 : near > 0.05 ? 1 : 0;
    f = Math.min(2, d.hits ?? 0) * 3 + lvl;
    ex.still = true;
    ex.shadow = 9;
    // Дрожит, когда герой рядом: чем дольше — тем сильнее.
    if (lvl > 0) ex.dx = (Math.floor(now * 24) % 2 ? 0.5 : -0.5) * lvl * 0.7;
  } else if (mode === 'f12_thaw') {
    anim = 'thaw';
    f = fi(t, LAST.thaw);
    ex.still = true;
  } else if (mode === 'f12_wind') {
    anim = 'chop';
    f = fi(t, LAST.chop);
    ex.still = true;
    // Шаг назад на замах, бросок вперёд на ударе.
    const go = -0.8 * sstep(0.05, 0.4, t / 0.75) + 2 * sstep(0.85, 1, t / 0.75);
    ex.dx = cf * go;
    ex.dy = sf * go;
    if (f >= 15) ex.ghost = { every: 0.03, life: 0.12, tint: '#bfe8ff', alpha: 0.3 };
  } else if (mode === 'f12_slam') {
    anim = 'slam';
    f = fi(t, LAST.slam);
    ex.still = true;
    if (f >= 20) ex.ghost = { every: 0.03, life: 0.12, tint: '#bfe8ff', alpha: 0.3 };
  } else if (mode === 'recover') {
    const slam = (d.n ?? 0) % 3 === 0;
    anim = slam ? 'srec' : 'crec';
    f = fi(t, LAST[anim]);
    ex.still = f < 9;
    if (f === 0) {
      ex.sx = slam ? 1.1 : 1.05;
      ex.sy = slam ? 0.9 : 0.95;
    } else if (f === 1) {
      ex.sx = slam ? 1.04 : 1.02;
      ex.sy = slam ? 0.96 : 0.98;
    }
    if (!slam && f < 2) ex.ghost = { every: 0.03, life: 0.12, tint: '#bfe8ff', alpha: 0.3 };
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, LAST.stun);
    const a = [0, 1, 0.8, 0.5, 0.3, 0.15, 0.05, 0][f];
    ex.dx = -cf * a * 1.3;
    ex.dy = -sf * a * 1.3;
  } else if (mv || turning) {
    anim = 'walk';
    const ph = ((((v.dist + tr.acc) / 1.7) % 1) + 1) % 1;
    f = Math.floor(ph * 8) % 8;
  } else {
    f = idlePh(m, now, 4, 8);
  }
  const i = keyOf(anim, f);
  const fr = frameOf(K, anim, i, dirOf(fc), p, () => build(anim, i));
  if (mode !== 'dying' && mode !== 'f12_frozen') hurtFx(v, now, 1, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_warrior', () => warmAll(K, Object.entries(N) as [string, number][], build));
