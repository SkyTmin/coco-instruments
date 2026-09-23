// Крысы подземелья — рисованные кадрами из форм, а не буквенными картами.
// Владелец про прежних: «графика ужасная… также с мобами».
//
// Крыса — это две трети груши и хвост. Тело — два овала (зад толще груди),
// голова — круг с заострённой мордой, ухо — круг с розовым нутром, лапы —
// короткие штрихи с розовыми ступнями, хвост — кривая, тонеющая к концу.
// Свет сверху-слева считается по нормали каждого овала: тёмный низ, светлая
// холка, блик на макушке — поэтому крыса объёмная, а не плоский силуэт.
// Поза задаётся числами (растяжка тела, подскок, фаза лап, раскрытие
// пасти), и каждое действие — несколько поз: бег галопом, покой с
// принюхиванием, замах (поднимается на задние), укус (выпад с открытой
// пастью), удар, смерть (на спине, лапы вверх), сон клубком.
//
// Окраски (пасюк, альбинос, золотая, элита) — палитры; толстяк и подрывник
// — те же формы с другими числами и поклажей. Всё смотрит ВПРАВО; влево —
// зеркало.

import type { MobId } from './dungeon';
import { hex, Px } from './dungeon-art';

type RGBA = [number, number, number, number];

export type RatLook = 'normal' | 'albino' | 'elite';
export type RatAnim = 'idle' | 'run' | 'wind' | 'bite' | 'hurt' | 'dead' | 'sleep';

/** Кадров у действия: столько раз меняется поза за цикл. */
export const RAT_FRAMES: Record<RatAnim, number> = {
  idle: 4,
  run: 6,
  wind: 2,
  bite: 2,
  hurt: 1,
  dead: 1,
  sleep: 2,
};

interface Pal {
  ink: RGBA;
  dark: RGBA;
  fur: RGBA;
  light: RGBA;
  hi: RGBA;
  belly: RGBA;
  pink: RGBA;
  pinkDark: RGBA;
  eye: RGBA;
  eyeHi: RGBA;
}

const PALS: Record<string, Pal> = {
  rat: {
    ink: hex('#1c1416'),
    dark: hex('#3a2e2b'),
    fur: hex('#5a4840'),
    light: hex('#7a6252'),
    hi: hex('#9c806a'),
    belly: hex('#9a8676'),
    pink: hex('#d49088'),
    pinkDark: hex('#9c5e5a'),
    eye: hex('#ff3f2e'),
    eyeHi: hex('#ffd7a8'),
  },
  fatrat: {
    ink: hex('#171314'),
    dark: hex('#2e2928'),
    fur: hex('#4a4340'),
    light: hex('#665d58'),
    hi: hex('#857a72'),
    belly: hex('#857a70'),
    pink: hex('#c98580'),
    pinkDark: hex('#8d5652'),
    eye: hex('#ff4a2e'),
    eyeHi: hex('#ffd7a8'),
  },
  goldrat: {
    ink: hex('#3a2208'),
    dark: hex('#7a5216'),
    fur: hex('#b68420'),
    light: hex('#e2b442'),
    hi: hex('#fff0a0'),
    belly: hex('#f2d88c'),
    pink: hex('#f0b0a0'),
    pinkDark: hex('#b87a60'),
    eye: hex('#ffffff'),
    eyeHi: hex('#fff8d0'),
  },
  albino: {
    ink: hex('#3a2a30'),
    dark: hex('#9e9294'),
    fur: hex('#d6cdca'),
    light: hex('#efe8e5'),
    hi: hex('#ffffff'),
    belly: hex('#fbf6f2'),
    pink: hex('#f2a6ae'),
    pinkDark: hex('#c47480'),
    eye: hex('#ff2a52'),
    eyeHi: hex('#ffd0dc'),
  },
  elite: {
    ink: hex('#160c0e'),
    dark: hex('#34201f'),
    fur: hex('#56302a'),
    light: hex('#7a4636'),
    hi: hex('#a0664a'),
    belly: hex('#8e6a5a'),
    pink: hex('#d88070'),
    pinkDark: hex('#98504a'),
    eye: hex('#ffb020'),
    eyeHi: hex('#fff2b0'),
  },
};

/** Поза: числа, из которых собирается кадр. Координаты — пиксели кадра. */
interface Pose {
  /** Зад (овал). */
  hx: number;
  hy: number;
  hrx: number;
  hry: number;
  /** Грудь (овал). */
  cx: number;
  cy: number;
  crx: number;
  cry: number;
  /** Голова (круг) и морда — насколько вперёд и вниз. */
  headX: number;
  headY: number;
  headR: number;
  snout: number;
  snoutDrop: number;
  /** Пасть: 0 — закрыта, 1 — нараспашку. */
  jaw: number;
  /** Глаз прищурен (сон) — полоска. */
  sleepy: boolean;
  /** Лапы: [от x, от y, до x, до y] — дальняя передняя, ближняя передняя,
   * дальняя задняя, ближняя задняя. */
  legs: [number, number, number, number][];
  /** Хвост: точки кривой от основания к кончику. */
  tail: [number, number][];
  /** У короля: несколько хвостов и узел, где они сплетены. */
  tails?: [number, number][][];
  knot?: { x: number; y: number; r: number };
}

// ---------------------------------------------------------------------------
// Растеризация формы с объёмом.
// ---------------------------------------------------------------------------

interface Ell {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Свет сверху-слева-спереди. */
const LX = -0.45;
const LY = -0.75;
const LZ = 0.5;

function shadeOf(p: Pal, e: Ell, x: number, y: number, belly: boolean): RGBA {
  const dx = (x + 0.5 - e.x) / e.rx;
  const dy = (y + 0.5 - e.y) / e.ry;
  const r2 = dx * dx + dy * dy;
  const nz = Math.sqrt(Math.max(0, 1 - r2));
  const k = dx * LX + dy * LY + nz * LZ;
  if (belly && dy > 0.35) return k > 0.25 ? p.belly : p.fur;
  if (k > 0.78) return p.hi;
  if (k > 0.45) return p.light;
  if (k > 0.05) return p.fur;
  return p.dark;
}

const inE = (e: Ell, x: number, y: number) => {
  const dx = (x + 0.5 - e.x) / e.rx;
  const dy = (y + 0.5 - e.y) / e.ry;
  return dx * dx + dy * dy <= 1;
};

/** Кривая Катмулла — Рома через точки хвоста. */
function spline(pts: [number, number][], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function paintPose(pose: Pose, p: Pal, w: number, h: number, outline = true): Px {
  const px = new Px(w, h);
  // Хвост — первым: он за телом. Толщина 2 у основания, 1 к кончику.
  for (const t of pose.tails ?? [pose.tail]) {
    if (t.length < 2) continue;
    const line = spline(t, 7);
    const thick = pose.tails ? 0.6 : 0.35;
    line.forEach(([x, y], i) => {
      const k = i / line.length;
      px.set(x, y, k < 0.5 ? p.pink : p.pinkDark);
      if (k < thick) px.set(x, y + 1, p.pinkDark);
    });
  }
  // Узел хвостов: клубок в косую полоску — видно, что сплетены.
  if (pose.knot) {
    const { x: kx, y: ky, r } = pose.knot;
    px.ell(kx, ky, r, r * 0.85, (x, y) =>
      (x + y) % 3 === 0 ? p.pinkDark : (x - y) % 4 === 0 ? hex('#e8aaa2') : p.pink,
    );
  }
  // Дальние лапы — за телом, темнее.
  const leg = (l: [number, number, number, number], far: boolean) => {
    const [x0, y0, x1, y1] = l;
    px.line(x0, y0, x1, y1, far ? p.dark : p.fur);
    px.line(x0 + 1, y0, x1 + 1, y1, far ? p.dark : p.fur);
    px.set(x1, y1, far ? p.pinkDark : p.pink);
    px.set(x1 + 1, y1, far ? p.pinkDark : p.pink);
    px.set(x1 + 2, y1, far ? p.pinkDark : p.pink);
  };
  leg(pose.legs[0], true);
  leg(pose.legs[2], true);
  // Тело: зад и грудь, у каждого свой свет.
  const haunch: Ell = { x: pose.hx, y: pose.hy, rx: pose.hrx, ry: pose.hry };
  const chest: Ell = { x: pose.cx, y: pose.cy, rx: pose.crx, ry: pose.cry };
  const head: Ell = { x: pose.headX, y: pose.headY, rx: pose.headR, ry: pose.headR * 0.92 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inE(haunch, x, y)) px.set(x, y, shadeOf(p, haunch, x, y, true));
      else if (inE(chest, x, y)) px.set(x, y, shadeOf(p, chest, x, y, true));
    }
  // Голова с мордой: круг плюс клин к носу.
  const nx = pose.headX + pose.headR + pose.snout;
  const ny = pose.headY + pose.snoutDrop;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inHead = inE(head, x, y);
      // Клин: от верхней и нижней точки головы к носу.
      const tx = (x + 0.5 - pose.headX) / (nx - pose.headX);
      let inSnout = false;
      if (tx > 0 && tx <= 1) {
        const top = pose.headY - pose.headR * 0.75 + (ny - (pose.headY - pose.headR * 0.75)) * tx;
        const bot =
          pose.headY +
          pose.headR * (0.7 - pose.jaw * 0.2) +
          (ny + 0.5 - (pose.headY + pose.headR * 0.7)) * tx;
        inSnout = y + 0.5 >= top && y + 0.5 <= bot + 0.5;
      }
      if (inHead || inSnout) {
        const c = inHead ? shadeOf(p, head, x, y, false) : y + 0.5 < ny - 0.3 ? p.light : p.fur;
        px.set(x, y, c);
      }
    }
  // Пасть: тёмная щель, зубы сверху.
  if (pose.jaw > 0.2) {
    const mx0 = Math.round(pose.headX + pose.headR * 0.3);
    const my = Math.round(ny + 0.5);
    const open = Math.round(pose.jaw * 2);
    for (let x = mx0; x <= Math.round(nx) - 1; x++)
      for (let k = 0; k < open; k++) px.set(x, my + k, hex('#4a1418'));
    // Резцы: сверху у носа и снизу — крысу выдают именно они.
    const tooth = hex('#f4ece0');
    px.set(Math.round(nx) - 1, my, tooth);
    px.set(Math.round(nx) - 2, my, tooth);
    // Нижняя челюсть — под щелью, с нижними резцами.
    for (let x = mx0; x <= Math.round(nx) - 2; x++) px.set(x, my + open, p.fur);
    if (open >= 2) px.set(Math.round(nx) - 2, my + open - 1, tooth);
  }
  // Нос.
  px.set(Math.round(nx), Math.round(ny), p.pink);
  // Ухо: круг с розовым нутром, чуть позади макушки.
  const ex = pose.headX - pose.headR * 0.35;
  const ey = pose.headY - pose.headR * 0.95;
  px.ell(ex, ey, 2.2, 2.2, p.fur);
  px.ell(ex + 0.3, ey + 0.2, 1.2, 1.2, p.pink);
  // Ближние лапы — поверх тела.
  leg(pose.legs[1], false);
  leg(pose.legs[3], false);
  // Контур снаружи (у короля — после короны и мантии, одним проходом).
  if (!outline) return px;
  px.outline(p.ink);
  // Глаз — после контура: светится.
  const gx = Math.round(pose.headX + pose.headR * 0.35);
  const gy = Math.round(pose.headY - pose.headR * 0.2);
  if (pose.sleepy) {
    px.set(gx, gy + 1, p.ink);
    px.set(gx + 1, gy + 1, p.ink);
  } else {
    px.set(gx, gy, p.eye);
    px.set(gx + 1, gy, p.eyeHi);
    px.set(gx, gy + 1, p.eye);
  }
  return px;
}

// ---------------------------------------------------------------------------
// Позы.
// ---------------------------------------------------------------------------

/** Размер кадра и масштаб тела по виду. Слева — место под хвост. */
function frameOf(kind: MobId): { w: number; h: number; s: number; fat: number } {
  if (kind === 'fatrat') return { w: 40, h: 20, s: 1.2, fat: 1.35 };
  return { w: 34, h: 17, s: 1, fat: 1 };
}

/** Отступ тела от левого края — длина хвоста. */
const TAIL_ROOM = 10;

/**
 * Поза по действию и кадру. Числа заданы для обычной крысы и
 * масштабируются: `s` — рост, `fat` — толщина зада.
 */
function poseOf(anim: RatAnim, f: number, s: number, fat: number, w: number, h: number): Pose {
  const base = h - 2; // земля
  const o = TAIL_ROOM * s;
  // Нейтральное: зад слева, грудь в середине, голова справа.
  let hx = o + 5 * s;
  let hy = base - 4.2 * s;
  const hrx = 5.4 * s * Math.sqrt(fat);
  const hry = 3.7 * s * fat;
  let cx = o + 10.5 * s;
  let cy = base - 3.9 * s;
  const crx = 4.3 * s;
  const cry = 3 * s;
  let headX = o + 15.2 * s;
  let headY = base - 5.2 * s;
  const headR = 3 * s;
  let snout = 2.8 * s;
  let snoutDrop = 1.2 * s;
  let jaw = 0;
  let sleepy = false;
  // Лапы: передние под грудью, задние под задом; «от» — у тела, «до» — ступня.
  let fl: number[] = [cx + 1.2 * s, cy + 1.6 * s, cx + 1.8 * s, base];
  let fn: number[] = [cx - 0.3 * s, cy + 1.6 * s, cx + 0.2 * s, base];
  let hl: number[] = [hx + 2 * s, hy + 2.2 * s, hx + 2.8 * s, base];
  let hn: number[] = [hx - 0.5 * s, hy + 2.4 * s, hx + 0.3 * s, base];
  let tailWave = 0;
  let tailLift = 0;
  let tailRoot = hy + 0.8 * s;

  if (anim === 'idle') {
    // Дыхание и принюхивание: морда подёргивается, хвост медленно ходит.
    const b = f % 2 === 0 ? 0 : 0.45;
    hy -= b;
    cy -= b;
    headY -= b + (f === 2 ? 0.7 : 0);
    snout += f === 2 ? 0.7 : f === 3 ? -0.4 : 0;
    snoutDrop += f === 2 ? -0.5 : 0;
    tailWave = Math.sin((f / 4) * Math.PI * 2) * 1.4;
  } else if (anim === 'run') {
    // Галоп: зад и грудь то сходятся (лапы под телом), то расходятся
    // (передние тянутся вперёд, задние отталкиваются); тело подпрыгивает.
    const ph = (f / 6) * Math.PI * 2;
    const stretch = Math.sin(ph) * 1.8 * s;
    const bob = Math.max(0, Math.sin(ph + 0.9)) * 1.5 * s;
    hx -= stretch * 0.5;
    cx += stretch * 0.5;
    headX += stretch * 0.7;
    hy -= bob + Math.max(0, -Math.sin(ph)) * 0.8 * s;
    cy -= bob * 0.8;
    headY -= bob * 0.7 + Math.sin(ph) * 0.4;
    const fr = Math.cos(ph) * 3 * s;
    const hr = -Math.cos(ph) * 3.2 * s;
    const lift = (k: number) => Math.max(0, Math.sin(ph + k)) * 1.5 * s;
    fl = [cx + 1 * s, cy + 1.6 * s, cx + 1.4 * s + fr, base - lift(0.3)];
    fn = [cx - 0.3 * s, cy + 1.6 * s, cx + fr * 0.8, base - lift(0.9)];
    hl = [hx + 1.8 * s, hy + 2.2 * s, hx + 2 * s + hr, base - lift(3.4)];
    hn = [hx - 0.2 * s, hy + 2.4 * s, hx + hr * 0.8, base - lift(4)];
    tailWave = Math.sin(ph + 1.3) * 1.8;
    tailLift = -1.2;
    tailRoot = hy + 0.2 * s;
  } else if (anim === 'wind') {
    // Замах: встаёт на задние, грудь и голова вверх, передние лапы
    // подняты, пасть приоткрыта — видно, что сейчас прыгнет.
    const k = f === 0 ? 0.65 : 1;
    hx -= 0.6 * s * k;
    hy += 0.3 * s;
    cx -= 1.8 * s * k;
    cy -= 3.4 * s * k;
    headX -= 1.6 * s * k;
    headY -= 5.4 * s * k;
    snoutDrop -= 0.9 * k;
    jaw = 0.55 * k;
    fl = [cx + 1.5 * s, cy + 1 * s, cx + 3.6 * s, cy + 0.5 * s];
    fn = [cx + 0.5 * s, cy + 1.6 * s, cx + 3 * s, cy + 1.8 * s];
    hl = [hx + 2 * s, hy + 2 * s, hx + 3.4 * s, base];
    hn = [hx, hy + 2.4 * s, hx + 1.2 * s, base];
    tailWave = 1.6;
    tailLift = 1;
  } else if (anim === 'bite') {
    // Выпад: тело вытянуто вперёд, голова низко, пасть нараспашку.
    const k = f === 0 ? 1 : 0.55;
    hx += 0.8 * s * k;
    cx += 2.6 * s * k;
    cy += 0.4 * s;
    headX += 4.2 * s * k;
    headY += 1 * s * k;
    snout += 0.8 * s;
    jaw = k;
    fl = [cx + 1.2 * s, cy + 1.6 * s, cx + 4.2 * s, base];
    fn = [cx, cy + 1.6 * s, cx + 3 * s, base];
    hl = [hx + 1.6 * s, hy + 2.2 * s, hx - 1.8 * s, base];
    hn = [hx - 0.4 * s, hy + 2.4 * s, hx - 3.2 * s, base];
    tailWave = -1.2;
    tailLift = -0.6;
  } else if (anim === 'hurt') {
    // Удар: сжалась, отпрянула, голова втянута, глаза жмурит.
    hx -= 1 * s;
    cx -= 1.8 * s;
    headX -= 2.6 * s;
    headY += 0.9 * s;
    cy += 0.5 * s;
    jaw = 0.45;
    sleepy = true;
    tailWave = 2.2;
    tailLift = -2;
  } else if (anim === 'sleep') {
    // Клубком: голова к заду, хвост обёрнут вокруг, бока ходят.
    const b = f === 0 ? 0 : 0.5;
    cx = hx + 3.8 * s;
    cy = hy + 0.8 * s - b;
    hy -= b;
    headX = cx + 2.4 * s;
    headY = base - 2.9 * s - b;
    snout = 1.8 * s;
    snoutDrop = 1.3 * s;
    sleepy = true;
    fl = [cx + 0.5, base - 1, cx + 1, base];
    fn = [cx - 0.5, base - 1, cx, base];
    hl = [hx + 0.5, base - 1, hx + 1, base];
    hn = [hx - 1, base - 1, hx, base];
  }

  // Хвост: от основания зада назад длиной с тело — S-изгибом, кончик
  // загнут. Во сне — обёрнут вокруг под лапы.
  const tx0 = hx - hrx * 0.8;
  const ty0 = tailRoot;
  const L = 10 * s;
  const tail: [number, number][] =
    anim === 'sleep'
      ? [
          [tx0, ty0 + 0.5],
          [tx0 - 2.5 * s, ty0 + 2.2 * s],
          [hx - 1 * s, base + 0.4],
          [cx + 1.5 * s, base + 0.4],
          [cx + 3.5 * s, base - 0.6],
        ]
      : [
          [tx0, ty0],
          [tx0 - L * 0.3, ty0 + 1.4 * s + tailWave * 0.3 + tailLift * 0.5],
          [tx0 - L * 0.62, ty0 + 2.2 * s + tailWave * 0.9 + tailLift],
          [tx0 - L * 0.88, ty0 + 1.2 * s + tailWave * 1.3 + tailLift * 1.6],
          [tx0 - L, ty0 - 0.6 * s + tailWave * 1.6 + tailLift * 2],
        ];

  return {
    hx,
    hy,
    hrx,
    hry,
    cx,
    cy,
    crx,
    cry,
    headX,
    headY,
    headR,
    snout,
    snoutDrop,
    jaw,
    sleepy,
    legs: [fl, fn, hl, hn] as [number, number, number, number][],
    tail: tail.map(([x, y]) => [Math.max(0, x), Math.min(h - 1, y)] as [number, number]),
  };
}

/**
 * Мёртвая: на боку, лапы окоченело вытянуты, хвост плетью, глаз
 * крестиком. Своя поза, а не поворот кадра — поворот рвал пиксели.
 */
function paintDead(p: Pal, s: number, fat: number, w: number, h: number): Px {
  const pose = poseOf('idle', 0, s, fat, w, h);
  const base = h - 2;
  // Тело опущено к земле и приплюснуто.
  pose.hy = base - 2.6 * s;
  pose.cy = base - 2.4 * s;
  pose.headY = base - 3 * s;
  pose.headX += 0.8 * s;
  pose.hry *= 0.8;
  pose.cry *= 0.85;
  pose.sleepy = true;
  pose.jaw = 0.3;
  // Лапы торчат вбок — к зрителю.
  pose.legs = [
    [pose.cx + 1 * s, pose.cy + 1, pose.cx + 3.5 * s, base + 0.5],
    [pose.cx - 0.5 * s, pose.cy + 1, pose.cx + 1.5 * s, base + 0.5],
    [pose.hx + 1.5 * s, pose.hy + 1, pose.hx + 2.5 * s, base + 0.5],
    [pose.hx - 0.5 * s, pose.hy + 1, pose.hx - 2 * s, base + 0.5],
  ];
  pose.tail = [
    [pose.hx - pose.hrx * 0.8, pose.hy + 1],
    [pose.hx - pose.hrx * 0.8 - 4 * s, base],
    [pose.hx - pose.hrx * 0.8 - 9 * s, base - 0.3],
  ];
  const px = paintPose(pose, p, w, h);
  // Глаз — крестиком поверх прищура.
  const gx = Math.round(pose.headX + pose.headR * 0.35);
  const gy = Math.round(pose.headY - pose.headR * 0.2);
  px.set(gx - 1, gy - 1, p.ink);
  px.set(gx + 1, gy + 1, p.ink);
  px.set(gx + 1, gy - 1, p.ink);
  px.set(gx - 1, gy + 1, p.ink);
  px.set(gx, gy, p.ink);
  return px;
}

/** Подрывник несёт на спине связку шашек с горящим фитилём. */
function addBomb(px: Pal, img: Px, pose: Pose, f: number): void {
  const x0 = Math.round(pose.hx - 2);
  const y0 = Math.round(pose.hy - pose.hry - 3);
  const red = hex('#b8332a');
  const redD = hex('#7a1f1c');
  for (let k = 0; k < 3; k++) {
    img.rect(x0 + k * 2, y0, x0 + k * 2 + 1, y0 + 3, k === 1 ? red : redD);
    img.set(x0 + k * 2, y0, hex('#d8554a'));
  }
  img.rect(x0, y0 + 1, x0 + 5, y0 + 1, hex('#3a2a20'));
  // Фитиль и искра.
  img.set(x0 + 5, y0 - 1, px.dark);
  img.set(x0 + 6, y0 - 2, f % 2 === 0 ? hex('#fff3a0') : hex('#ff9a30'));
}

// ---------------------------------------------------------------------------
// Крысиный король. В поверьях это клубок крыс, сросшихся хвостами; у нас —
// огромная крыса в короне и мантии, за которой тянется узел из трёх
// сплетённых хвостов. Крысёныш — младший, поменьше и с венчиком.
// ---------------------------------------------------------------------------

const KING_PAL: Pal = {
  ink: hex('#120c0e'),
  dark: hex('#2c2224'),
  fur: hex('#4a3a38'),
  light: hex('#6a5450'),
  hi: hex('#8e7266'),
  belly: hex('#7e6a62'),
  pink: hex('#c77c78'),
  pinkDark: hex('#8a4a4a'),
  eye: hex('#ffcc30'),
  eyeHi: hex('#ffffff'),
};

const GOLD = hex('#e8b830');
const GOLD_D = hex('#9a6a14');
const GOLD_L = hex('#fff0a0');
const RUBY = hex('#d8203a');
const CAPE = hex('#6a1a2a');
const CAPE_D = hex('#40101c');
const CAPE_L = hex('#94303e');

function kingSize(small: boolean): { w: number; h: number; s: number } {
  return small ? { w: 50, h: 28, s: 1.35 } : { w: 72, h: 40, s: 1.95 };
}

function paintKing(small: boolean, anim: RatAnim, f: number): Px {
  const { w, h, s } = kingSize(small);
  const pose =
    anim === 'dead'
      ? poseOf('idle', 0, s, 1.4, w, h)
      : poseOf(anim === 'hurt' ? 'hurt' : anim, f, s, 1.4, w, h);
  if (anim === 'dead') {
    pose.hy += 1.5 * s;
    pose.cy += 1.5 * s;
    pose.headY += 2 * s;
    pose.sleepy = true;
  }
  // Узел хвостов позади: из зада в клубок, из клубка — три конца врозь:
  // вверх с завитком, назад и по земле.
  const kx = pose.hx - pose.hrx - 2.6 * s;
  const ky = pose.hy + 0.6 * s;
  const sway = anim === 'run' || anim === 'idle' ? Math.sin((f / 4) * Math.PI * 2) : 0;
  const root: [number, number] = [pose.hx - pose.hrx * 0.8, pose.hy];
  pose.tails = [
    [root, [kx + 1.5 * s, ky - 0.5 * s], [kx, ky]],
    [
      [kx - 1 * s, ky - 1.5 * s],
      [kx - 3 * s, ky - 5 * s + sway],
      [kx - 6.5 * s, ky - 6.5 * s + sway * 1.4],
      [kx - 8 * s, ky - 4.5 * s + sway * 1.8],
    ],
    [
      [kx - 1.5 * s, ky],
      [kx - 5 * s, ky - 0.8 * s - sway],
      [kx - 9 * s, ky + 0.4 * s - sway * 1.2],
      [kx - 11.5 * s, ky - 1.2 * s - sway * 1.5],
    ],
    [
      [kx - 1 * s, ky + 1.2 * s],
      [kx - 3.5 * s, h - 2.5],
      [kx - 7.5 * s, h - 2.2],
      [kx - 10 * s, h - 3 + sway * 0.6],
    ],
  ];
  pose.knot = { x: kx, y: ky, r: 2.3 * s };
  const px = paintPose(pose, KING_PAL, w, h, false);
  // Мантия: накидка по холке, до середины бока, с бахромой.
  if (anim !== 'sleep' && anim !== 'dead') {
    const mx0 = pose.hx - pose.hrx * 0.5;
    const mx1 = pose.cx + pose.crx * 0.4;
    for (let x = Math.floor(mx0); x <= Math.ceil(mx1); x++) {
      const t = (x - mx0) / (mx1 - mx0);
      const topY = pose.hy - pose.hry + (pose.cy - pose.cry - (pose.hy - pose.hry)) * t - 0.5;
      const len = (2.4 + Math.sin(t * Math.PI) * 1.6) * s;
      for (let y = Math.floor(topY); y <= topY + len; y++) {
        const edge = y > topY + len - 1;
        px.set(x, y, edge ? CAPE_D : y < topY + 1.2 ? CAPE_L : CAPE);
      }
      if (x % 3 === 0) px.set(x, Math.floor(topY + len) + 1, GOLD_D);
    }
  }
  // Корона на макушке: обод, три зубца, камень.
  const cx0 = Math.round(pose.headX - pose.headR * 0.9);
  const cy0 = Math.round(pose.headY - pose.headR * 1.15);
  const cw = Math.round(pose.headR * 1.7);
  const ch = Math.round(small ? 3 : 4);
  if (anim !== 'dead') {
    px.rect(cx0, cy0, cx0 + cw, cy0 + 1, GOLD);
    px.rect(cx0, cy0 + 1, cx0 + cw, cy0 + 1, GOLD_D);
    for (const k of [0, 0.5, 1]) {
      const x = Math.round(cx0 + cw * k);
      px.rect(x, cy0 - ch + 1, x, cy0, GOLD);
      px.set(x, cy0 - ch, GOLD_L);
    }
    px.set(Math.round(cx0 + cw / 2), cy0, RUBY);
  } else {
    // Корона скатилась с головы и лежит рядом.
    const x = Math.round(pose.headX + pose.headR + 2);
    const y = h - 3;
    px.rect(x, y - 1, x + cw, y, GOLD);
    px.set(x + Math.round(cw / 2), y - 1, RUBY);
  }
  px.outline(KING_PAL.ink);
  // Глаз поверх контура — жёлтый, у короля свой.
  const gx = Math.round(pose.headX + pose.headR * 0.35);
  const gy = Math.round(pose.headY - pose.headR * 0.2);
  if (!pose.sleepy) {
    px.rect(gx, gy, gx + 1, gy + 1, KING_PAL.eye);
    px.set(gx + 1, gy, KING_PAL.eyeHi);
  }
  return px;
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Кадр крысы. `frame` — любое число, берётся по модулю кадров действия.
 * `left` — смотрит влево (зеркало), `flash` — вспышка удара.
 */
export function ratFrame(
  kind: MobId,
  look: RatLook,
  anim: RatAnim,
  frame: number,
  left: boolean,
  flash = false,
): HTMLCanvasElement {
  const n = RAT_FRAMES[anim];
  const f = ((Math.floor(frame) % n) + n) % n;
  const key = `${kind}:${look}:${anim}:${f}:${left ? 1 : 0}:${flash ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;
  const pal =
    look === 'albino'
      ? PALS.albino
      : look === 'elite'
        ? PALS.elite
        : kind === 'goldrat'
          ? PALS.goldrat
          : kind === 'fatrat'
            ? PALS.fatrat
            : PALS.rat;
  const { w, h, s, fat } = frameOf(kind);
  let px: Px;
  if (kind === 'king' || kind === 'kinglet') px = paintKing(kind === 'kinglet', anim, f);
  else if (anim === 'dead') px = paintDead(pal, s, fat, w, h);
  else {
    const pose = poseOf(anim, f, s, fat, w, h);
    px = paintPose(pose, pal, w, h);
    if (kind === 'bomber') addBomb(pal, px, pose, f);
  }
  if (left) px = px.flipX();
  if (flash) px = px.tint([255, 255, 255, 255], 0.9);
  c = px.canvas();
  cache.set(key, c);
  return c;
}

/** Где у кадра глаз — для свечения поверх темноты. */
export function ratEye(kind: MobId, anim: RatAnim, frame: number): [number, number] {
  const { w, h, s, fat } = sizeOf(kind);
  const n = RAT_FRAMES[anim];
  const f = ((Math.floor(frame) % n) + n) % n;
  const p = poseOf(anim === 'dead' ? 'idle' : anim, f, s, fat, w, h);
  return [Math.round(p.headX + p.headR * 0.35), Math.round(p.headY - p.headR * 0.2)];
}

function sizeOf(kind: MobId): { w: number; h: number; s: number; fat: number } {
  if (kind === 'king' || kind === 'kinglet') return { ...kingSize(kind === 'kinglet'), fat: 1.4 };
  return frameOf(kind);
}

/** Размер кадра и где в нём середина тела (от левого края, смотрит вправо). */
export function ratSize(kind: MobId): { w: number; h: number; body: number } {
  const { w, h, s } = sizeOf(kind);
  return { w, h, body: Math.round((TAIL_ROOM + 10) * s) };
}
