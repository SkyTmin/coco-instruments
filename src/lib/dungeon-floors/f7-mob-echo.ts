// Этаж 7 — Отражение (анимации мобов 7). Зеркальный двойник героя: тот же
// лист героя (Ninja Adventure, CC0) в его нынешнем снаряжении, перекрашенный
// в холодное стекло. Ходит, как герой: четыре стороны с запасом (по
// диагонали не мигает между боком и спиной), шаг — по пройденному пути
// (`STRIDE` героя), удар — строка удара листа. Клинок — стеклянный, кодом:
// растёт из ладони на замахе и тает после удара.
//   • копия взмаха героя (`copy`, 0,4 с): клинок взводится за плечо,
//     держится (по нему бежит блик), удар — дуга со следом-серпом; кадр
//     контакта — первый кадр `recover`, ровно когда мозг бьёт; проводка за
//     конец дуги, возврат;
//   • свой удар (`windup`, 0,42 с) — короткий взмах на 80° тем же порядком;
//   • удар героя: строка «удивления» листа, звон трещин и отброс полями;
//   • выход из зеркала: фигура рябит в стекле и твердеет сверху вниз;
//   • смерть: трещины паутиной, осколки разлетаются и ложатся на пол,
//     блестят и гаснут (`linger`).
// Кадры — `frameLRU` вида с пределом, прогрев — все стороны и действия.

import { Px } from '../dungeon-art';
import { frameLRU, registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { heroSprite } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import {
  INK,
  PI,
  TAU,
  WHITE,
  alpha,
  capsule,
  clamp01,
  dress,
  eOut,
  eOut3,
  fi,
  frameOf,
  hash,
  hurtFx,
  hx,
  kindOf,
  mixc,
  mod,
  phaseOf,
  smear,
  sstep,
  thick,
  tn,
  visOf,
  warmSteps,
} from './f7-mobkit';
import type { Look, Pic, RGBA, Vis } from './f7-mobkit';

// ---- Снаряжение героя (стор — ленивым импортом) ------------------------------

let gearGet: (() => { robe: number; weapon: number }) | null = null;
let gearAsked = false;
function heroGear(): { robe: number; weapon: number } {
  if (!gearAsked && typeof window !== 'undefined') {
    gearAsked = true;
    void import('../../store')
      .then((S) => {
        gearGet = () => {
          const g = S.useFinanceStore.getState().dungeon?.gear;
          return { robe: g?.robe?.tier ?? 8, weapon: g?.weapon?.tier ?? 8 };
        };
      })
      .catch(() => undefined);
  }
  return gearGet?.() ?? { robe: 8, weapon: 8 };
}

// ---- Стекло из листа героя -------------------------------------------------------

const ECHO_RAMP = ['#223258', '#3a5a8e', '#5e88bc', '#90b8e0', '#c6e2f6', '#f0faff'].map((c) =>
  hx(c),
);
const CYAN_HOT = hx('#e0fbff');
const ICE = hx('#9aeaff');
const GILT0 = hx('#4a3216');
const GILT2 = hx('#c29a48');
const BLADE = tn('#34507c', '#6c9ccc', '#b8e0f8', '#f4fcff');
const BLADE_HOT = tn('#5a86c0', '#9ccaf0', '#dff4ff', '#ffffff');

function fromCanvas(c: HTMLCanvasElement): Px {
  const p = new Px(c.width, c.height);
  const g = c.getContext('2d');
  if (g) p.data.set(g.getImageData(0, 0, c.width, c.height).data);
  return p;
}

/** Лист героя → зеркальное стекло (как прежде: яркость растянута, контур — чернила). */
function glassify(src: Px, ramp: RGBA[], ink: RGBA, sheen: number, top: number, lift: number): Px {
  const o = new Px(src.w, src.h);
  const lumOf = (i: number) => 0.3 * src.data[i] + 0.55 * src.data[i + 1] + 0.15 * src.data[i + 2];
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < src.data.length; i += 4) {
    if (!src.data[i + 3]) continue;
    const l = lumOf(i);
    if (l < 34) continue;
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  const solidLit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= src.w || y >= src.h) return false;
    const j = (y * src.w + x) * 4;
    return src.data[j + 3] > 0 && lumOf(j) >= 34;
  };
  const inner = (x: number, y: number) =>
    solidLit(x - 2, y) && solidLit(x + 2, y) && solidLit(x, y - 2) && solidLit(x, y + 2);
  const span = Math.max(24, hi - lo) * 0.5 + 110;
  lo = lo * 0.5 + 17;
  const n = ramp.length;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (!src.data[i + 3]) continue;
      const l = lumOf(i);
      if (l < 34) {
        o.set(x, y, ink);
        continue;
      }
      const warm = src.data[i] > src.data[i + 2] + 40 ? 0.12 : 0;
      let k = Math.round(((l - lo) / span) * (n - 1) * top + lift + warm * n);
      if (sheen && inner(x, y)) {
        const d = x - y * 0.9;
        const s0 = src.w * 0.28;
        if (Math.abs(d - s0) < sheen * 0.5) k += 2;
        else if (Math.abs(d - s0 - sheen * 2.2) < sheen * 0.35) k += 1;
      }
      o.set(x, y, ramp[Math.max(0, Math.min(n - 1, k))]);
    }
  const isInk = (c: RGBA) => c[0] === ink[0] && c[1] === ink[1] && c[2] === ink[2];
  for (let y = 0; y < o.h; y++)
    for (let x = o.w - 1; x > 0; x--) {
      if (!o.solid(x, y)) continue;
      for (let k = 0; k < 3 && x - k >= 0; k++) {
        const c = o.get(x - k, y);
        if (!o.solid(x - k, y) || isInk(c)) continue;
        o.set(x - k, y, mixc(c, ramp[n - 2], 0.55));
        break;
      }
      break;
    }
  return o;
}

// ---- Холст кадра ----------------------------------------------------------------

const W = 40;
const H = 38;
/** Где в холсте лист героя 16×16: так ноги встают туда же, где у героя. */
const BX = 12;
const BY = 13;
const AX = 20;
const AY = 28;
/** Кулак: как у героя — от груди по ходу удара. */
const handOf = (a: number, push = 0): [number, number] => [
  AX + Math.cos(a) * (5 + push),
  AY - 6 + Math.sin(a) * (4 + push * 0.8),
];
const BLADE_LEN = 9;

const DIRS: Dir4[] = ['down', 'up', 'left', 'right'];
const dirOf = (a: number): Dir4 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return Math.abs(c) > Math.abs(s) * 1.1 ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
};
/** Сторона с запасом, как у героя: ось меняется, только когда новая перевесила. */
function sideOf(v: Vis, a: number): Dir4 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const side = Math.abs(c) > Math.abs(s);
  const prev = v.side;
  if (prev < 0) {
    v.side = DIRS.indexOf(dirOf(a));
    return DIRS[v.side];
  }
  const prevSide = prev >= 2;
  const keep = side === prevSide || Math.abs(Math.abs(c) - Math.abs(s)) < 0.18;
  const useSide = keep ? prevSide : side;
  const d: Dir4 = useSide ? (c < 0 ? 'left' : 'right') : s < 0 ? 'up' : 'down';
  v.side = DIRS.indexOf(d);
  return d;
}

/** Прорези забрала (светятся) — точки листа по стороне. */
const SLITS: Record<Dir4, [number, number][]> = {
  down: [
    [6, 7],
    [9, 7],
  ],
  left: [[5, 7]],
  right: [[10, 7]],
  up: [],
};
/** Короткая трещина сбоку: забрало должно читаться. */
const CRACK: [number, number][] = [
  [12, 9],
  [11, 11],
  [12, 13],
];

const BODY = frameLRU<Px | null>(160);
/**
 * Стеклянное тело: строка листа героя, сторона, блик (−1 — нет; 0…7 —
 * полоса света бежит по стеклу сверху-слева вниз-вправо).
 */
function bodyOf(tier: number, dir: Dir4, row: number, sheen: number): Px | null {
  const key = `${tier}|${dir}|${row}|${sheen}`;
  const hit = BODY.get(key);
  if (hit !== undefined) return hit;
  const c = heroSprite(tier, dir, row);
  if (!c) return null;
  const b = glassify(fromCanvas(c), ECHO_RAMP, INK, 1.6, 0.9, 0.95);
  for (let i = 0; i + 1 < CRACK.length; i++)
    thick(b, CRACK[i][0], CRACK[i][1], CRACK[i + 1][0], CRACK[i + 1][1], hx('#16203a'));
  for (const [x, y] of SLITS[dir]) b.set(x, y, CYAN_HOT);
  if (sheen >= 0) {
    // Блик зеркала: косая полоса пробегает по фигуре (вторичное движение стекла).
    const pos = -6 + sheen * 3.2;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!b.solid(x, y)) continue;
        const c0 = b.get(x, y);
        if (c0[0] === INK[0] && c0[1] === INK[1] && c0[2] === INK[2]) continue;
        const d = Math.abs(x + y * 0.6 - pos - 4);
        if (d < 0.8) b.set(x, y, mixc(c0, WHITE, 0.7));
        else if (d < 1.8) b.set(x, y, mixc(c0, WHITE, 0.3));
      }
  }
  return BODY.set(key, b);
}

/** Стеклянный клинок от кулака: остриё по углу `a`; `len` 0…1 — растёт из ладони. */
function blade(
  p: Px,
  x: number,
  y: number,
  a: number,
  len: number,
  hot: boolean,
  glint = -1,
): void {
  if (len <= 0.05) return;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const L = BLADE_LEN * len;
  const tx = x + ux * L;
  const ty = y + uy * L;
  capsule(p, x + ux * 1.2, y + uy * 1.2, tx, ty, 1.1, 0.45, hot ? BLADE_HOT : BLADE, 0.2);
  // Кромка: светлая черта вдоль лезвия.
  thick(p, x + ux * 2 - uy * 0.6, y + uy * 2 + ux * 0.6, tx - uy * 0.2, ty + ux * 0.2, BLADE[3]);
  if (len > 0.6) {
    thick(p, x - uy * 2, y + ux * 2, x + uy * 2, y - ux * 2, GILT2);
    thick(p, x - ux * 2, y - uy * 2, x, y, GILT0);
  }
  // Блик бежит по клинку от рукояти к острию.
  if (glint >= 0) {
    const g = 2 + glint * (L - 2);
    p.set(x + ux * g, y + uy * g, WHITE);
    p.set(x + ux * (g - 1), y + uy * (g - 1), mixc(BLADE[3], WHITE, 0.5));
  }
}

// ---- Позы: строка листа, клинок, след ----------------------------------------------

interface EPose {
  row: number;
  /** Клинок: угол, длина 0…1, вынос кулака, горячий, блик. */
  ba: number;
  bl: number;
  push: number;
  hot: boolean;
  glint: number;
  /** След-серп: от угла, до угла, сила (0 — нет). */
  s0: number;
  s1: number;
  sk: number;
  /** Поля кадра: наклон корпуса и сдвиг. */
  dx: number;
  dy: number;
  sx: number;
  sy: number;
}
const P0: EPose = {
  row: 0,
  ba: 0,
  bl: 0,
  push: 0,
  hot: false,
  glint: -1,
  s0: 0,
  s1: 0,
  sk: 0,
  dx: 0,
  dy: 0,
  sx: 1,
  sy: 1,
};

/** Дуги взмаха: обычный и третий удар серии — 110°, тяжёлый — 220°, свой удар — 80°. */
const ARC = [(110 * PI) / 180, (220 * PI) / 180, (80 * PI) / 180];
const N_COPY = 10;
const N_REC = 12;

/**
 * Взмах. `f` 0…9 — режим `copy` (0,4 с) или свой удар `windup` (0,42 с),
 * 10…21 — `recover` после него. Кадр 10 — контакт: мозг бьёт в t ≥ 0,4
 * (0,42), и первым после удара рисуется он.
 */
function copyPose(f: number, a: number, cls: number): EPose {
  const A = ARC[cls];
  const s = cls === 1 ? -1 : 1;
  const aCock = a - s * (A / 2 + 0.45);
  const aEnd = a + s * (A / 2);
  const aOver = aEnd + s * 0.35;
  const o: EPose = { ...P0 };
  const fx = Math.cos(a);
  const fy = Math.sin(a);
  if (f <= 7) {
    // Взвод: клинок растёт из ладони и уходит за плечо, корпус отклоняется.
    const k = eOut3(f / 4);
    o.ba = a - s * 0.3 + (aCock - (a - s * 0.3)) * k;
    o.bl = 0.35 + 0.65 * clamp01(f / 2.5);
    o.glint = f >= 3 ? (f - 3) / 4 : -1;
    o.dx = -fx * 1.2 * k;
    o.dy = -fy * 0.6 * k;
    o.sy = 1 - 0.04 * k;
    o.sx = 1 + 0.03 * k;
    return o;
  }
  if (f <= 9) {
    // Удар: два кадра дуги со следом.
    const k = f === 8 ? 0.28 : 0.72;
    o.row = 4;
    o.ba = aCock + (aEnd - aCock) * k;
    o.bl = 1;
    o.s0 = aCock;
    o.s1 = o.ba;
    o.sk = 0.8;
    o.dx = fx * (f === 8 ? 0 : 1);
    o.dy = fy * (f === 8 ? 0 : 0.5);
    return o;
  }
  const r = f - 10;
  o.row = 4;
  o.bl = 1;
  if (r === 0) {
    // Контакт: клинок в конце дуги, след по всей дуге, горячий; вжатие.
    o.ba = aEnd;
    o.hot = true;
    o.s0 = aCock;
    o.s1 = aEnd;
    o.sk = 1;
    o.dx = fx * 2;
    o.dy = fy * 1;
    o.sx = 1.08;
    o.sy = 0.92;
    return o;
  }
  if (r <= 2) {
    // Проводка за конец дуги, след гаснет.
    o.ba = aOver;
    o.s0 = aCock + (aEnd - aCock) * (0.35 + r * 0.2);
    o.s1 = aOver;
    o.sk = r === 1 ? 0.65 : 0.3;
    o.dx = fx * 2.2;
    o.dy = fy * 1.1;
    o.sx = r === 1 ? 1.04 : 1;
    o.sy = r === 1 ? 0.96 : 1;
    return o;
  }
  // Отдача и возврат: клинок опускается и тает, корпус встаёт на место.
  const k = (r - 3) / (N_REC - 4);
  const e = eOut(k);
  o.row = r < 6 ? 4 : 0;
  o.ba = aOver + (a + s * 0.9 - aOver) * e;
  o.bl = 1 - sstep(0.45, 1, k);
  o.dx = fx * 2.2 * (1 - e);
  o.dy = fy * 1.1 * (1 - e);
  return o;
}

/** Картинка позы: тело, клинок (за спиной, если поднят или герой спиной), след. */
function paintPose(tier: number, dir: Dir4, o: EPose, sheen = -1): Pic | null {
  const b = bodyOf(tier, dir, o.row, sheen);
  if (!b) return null;
  const p = new Px(W, H);
  const lit = new Px(W, H);
  const [hxp, hyp] = handOf(o.ba, o.push);
  const behind = o.bl > 0 && (Math.sin(o.ba) < -0.35 || dir === 'up');
  if (behind) blade(p, hxp, hyp, o.ba, o.bl, o.hot, o.glint);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const i = (y * 16 + x) * 4;
      if (b.data[i + 3]) p.set(BX + x, BY + y, [b.data[i], b.data[i + 1], b.data[i + 2], 255]);
    }
  if (!behind) blade(p, hxp, hyp, o.ba, o.bl, o.hot, o.glint);
  p.outline(alpha(INK, 0.55));
  // Отражение чуть прозрачно: сквозь него угадывается пол.
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] === 255) p.data[i] = 232;
  for (const [x, y] of SLITS[dir]) lit.set(BX + x, BY + y, CYAN_HOT);
  if (o.sk > 0) {
    const [cx, cy] = handOf(o.ba, 0);
    smear(p, cx, cy, o.s0, o.s1, 3, BLADE_LEN + 2, CYAN_HOT, hx('#6c9ccc'), o.sk, 0.85);
    if (o.sk >= 1)
      smear(lit, cx, cy, o.s0, o.s1, BLADE_LEN + 1, BLADE_LEN + 2.4, WHITE, ICE, 1, 0.85);
  }
  const sl = SLITS[dir][0];
  return { p, lit, ax: AX, ay: AY, eye: sl ? [BX + sl[0], BY + sl[1]] : null };
}

// ---- Смерть: паутина трещин → осколки на полу -----------------------------------------

const DIE_T = 0.875;
const DIE_N = 21;
/** Трещины смерти от середины груди. */
const WEB: [number, number][][] = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = (i / 6) * TAU + 0.4;
  const pts: [number, number][] = [[AX, AY - 8]];
  for (let k = 1; k <= 3; k++) {
    const r = k * 2.6;
    pts.push([
      AX + Math.cos(a + (hash(i, k) - 0.5) * 0.7) * r,
      AY - 8 + Math.sin(a + (hash(i, k, 1) - 0.5) * 0.7) * r * 1.1,
    ]);
  }
  return pts;
});

function deathPic(tier: number, dir: Dir4, f: number): Pic | null {
  const base = paintPose(tier, dir, { ...P0, row: 6 });
  if (!base) return null;
  const t = (f + 0.5) / 24;
  const src = base.p;
  const p = new Px(W, H);
  const lit = new Px(W, H);
  if (t < 0.1) {
    // Замер: паутина трещин расходится от груди.
    p.data.set(src.data);
    const k = (f + 1) / 3;
    for (const ln of WEB) {
      const n = Math.max(1, Math.round((ln.length - 1) * k));
      for (let i = 0; i < n; i++) {
        const [x0, y0] = ln[i];
        const [x1, y1] = ln[i + 1];
        const m = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0)));
        for (let j = 0; j <= m; j++) {
          const x = Math.round(x0 + ((x1 - x0) * j) / m);
          const y = Math.round(y0 + ((y1 - y0) * j) / m);
          if (!src.solid(x, y)) continue;
          p.set(x, y, WHITE);
          lit.set(x, y, alpha(CYAN_HOT, 0.8));
        }
      }
    }
    return { p, lit, ax: AX, ay: AY, eye: null };
  }
  // Осколки: клинья вокруг груди, у каждого — скорость, падение и пол.
  const tau = t - 0.1;
  const floorY = AY - 1;
  const fade = 1 - sstep(0.6, DIE_T, t);
  const N = 9;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!src.data[i + 3]) continue;
      const a = Math.atan2(y + 0.5 - (AY - 8), x + 0.5 - AX);
      const wdg = mod(Math.floor(((a + PI) / TAU) * N + hash(Math.floor(y / 3), 5) * 0.9), N);
      const wa = ((wdg + 0.5) / N) * TAU - PI;
      const sp = 14 + hash(wdg, 9, tier) * 16;
      const up = 10 + hash(wdg, 3) * 14;
      const vx = Math.cos(wa) * sp;
      let yy = y + Math.sin(wa) * sp * 0.55 * tau - up * tau + 90 * tau * tau;
      let xx = x + vx * tau * (1 - Math.min(0.8, tau * 1.4));
      // Упал на пол — лежит, скользит чуть-чуть дальше.
      const rest = yy > floorY - (y > AY - 4 ? 0 : 1 + (wdg % 3));
      if (rest) {
        yy = floorY - (wdg % 3 === 0 ? 1 : 0);
        xx = x + vx * Math.min(tau, 0.3) * 0.7;
      }
      const c: RGBA = [src.data[i], src.data[i + 1], src.data[i + 2], Math.round(232 * fade)];
      const glint = hash(wdg, f) < 0.18 && (x + y) % 3 === 0;
      p.set(xx, yy, glint ? alpha(WHITE, fade) : c);
      if (glint && fade > 0.3) lit.set(xx, yy, alpha(CYAN_HOT, 0.7 * fade));
    }
  return { p, lit, ax: AX, ay: AY, eye: null };
}

// ---- Выход из зеркала: рябь в стекле, твердеет сверху вниз --------------------------------

const STEP_N = 12;
function stepPic(tier: number, dir: Dir4, f: number): Pic | null {
  const row = [0, 1, 2, 3][Math.floor(f / 3) % 4];
  const base = paintPose(tier, dir, { ...P0, row });
  if (!base) return null;
  const k = (f + 1) / STEP_N;
  const src = base.p;
  const p = new Px(W, H);
  const front = BY - 2 + (16 + 4) * eOut(k);
  for (let y = 0; y < H; y++) {
    const solid = y < front;
    const amp = solid ? 0 : 2.2 * (1 - k);
    const sh = Math.round(Math.sin(y * 0.9 + f * 1.7) * amp);
    for (let x = 0; x < W; x++) {
      const i = (y * W + (x - sh)) * 4;
      if (x - sh < 0 || x - sh >= W || !src.data[i + 3]) continue;
      const c: RGBA = [src.data[i], src.data[i + 1], src.data[i + 2], 255];
      if (solid) p.set(x, y, [c[0], c[1], c[2], 232]);
      else if ((x + y + f) % 2 === 0) p.set(x, y, alpha(mixc(c, hx('#4a78a2'), 0.5), 0.45));
    }
  }
  // Кромка стекла — белая черта по фронту.
  const lit = new Px(W, H);
  const fy = Math.round(front);
  for (let x = 0; x < W; x++)
    if (src.solid(x, fy) && k < 1) {
      p.set(x, fy, alpha(WHITE, 0.85));
      lit.set(x, fy, alpha(CYAN_HOT, 0.7));
    }
  return { p, lit, ax: AX, ay: AY, eye: null };
}

// ---- Рисовальщик ---------------------------------------------------------------------

const K = kindOf('f7_echo', 1400);
const SHEEN_T = 2.8;
const AIM16 = (a: number) => mod(Math.round(a / (TAU / 16)), 16);
const AIM8 = (a: number) => mod(Math.round(a / (TAU / 8)), 8);
const arcCls = (m: Mob) => ((m.data?.cArc ?? 1.92) > 3 ? 1 : 0);

function frameFor(tier: number, key: string, look: Look, build: () => Pic | null): MobFrame | null {
  // Лист героя ещё не пришёл — движок нарисует запасной вид (кеш не трогаем).
  if (!heroSprite(tier, 'down', 0)) return null;
  return frameOf(K, `${tier}|${key}`, false, look, () => build() ?? emptyPic());
}
const emptyPic = (): Pic => ({ p: new Px(1, 1), lit: null, ax: 0, ay: 0, eye: null });

registerMobPainter('f7_echo', (m: Mob, pose: MobPose) => {
  const tier = heroGear().robe;
  const face = m.face ?? 0;
  const v = visOf(m, pose, face, 40);
  const now = pose.now || 0;
  const t = pose.t || 0;
  const look = pose.look;
  const ex: Partial<MobFrame> = { still: true, shadow: 5 };
  let fr: MobFrame | null = null;
  const mode = pose.mode;
  const fromCopy = mode === 'recover' && v.prev === 'copy';
  const fromStab = mode === 'recover' && v.prev !== 'copy';
  if (mode === 'dying') {
    const dir = DIRS[Math.max(0, v.side)] ?? 'down';
    const f = fi(t, DIE_N - 1);
    fr = frameFor(tier, `d|${dir}|${f}`, look, () => deathPic(tier, dir, f));
    ex.linger = DIE_T;
    ex.shadow = t < 0.12 ? 5 : 0;
  } else if (mode === 'copy' || fromCopy) {
    const aim = (AIM16(m.dir ?? face) * TAU) / 16;
    const cls = arcCls(m);
    const f = mode === 'copy' ? fi(t, N_COPY - 1) : N_COPY + fi(t, N_REC - 1);
    const dir = dirOf(aim);
    v.side = DIRS.indexOf(dir);
    const o = copyPose(f, aim, cls);
    fr = frameFor(tier, `c|${AIM16(aim)}|${cls}|${f}`, look, () => paintPose(tier, dir, o));
    Object.assign(ex, { dx: o.dx, dy: o.dy, sx: o.sx, sy: o.sy });
  } else if (mode === 'windup' || fromStab) {
    const aim = (AIM8(face) * TAU) / 8;
    const f = mode === 'windup' ? fi(t, 9) : N_COPY + fi(t, N_REC - 1);
    const dir = dirOf(aim);
    v.side = DIRS.indexOf(dir);
    const o = copyPose(f, aim, 2);
    fr = frameFor(tier, `b|${AIM8(aim)}|${f}`, look, () => paintPose(tier, dir, o));
    Object.assign(ex, { dx: o.dx, dy: o.dy, sx: o.sx, sy: o.sy });
  } else if (mode === 'f7_step') {
    const dir = sideOf(v, face);
    const f = fi(t, STEP_N - 1);
    fr = frameFor(tier, `s|${dir}|${f}`, look, () => stepPic(tier, dir, f));
    ex.shadow = 2 + Math.round(3 * clamp01(t / 0.5));
  } else if (mode === 'stun' && t < 0.17) {
    // Удар героя: строка «удивления» листа, по стеклу пробегает звон.
    const dir = sideOf(v, face);
    const f = fi(t, 3);
    fr = frameFor(tier, `h|${dir}|${f}`, look, () => paintPose(tier, dir, { ...P0, row: 6 }, f));
  } else {
    const dir = sideOf(v, face);
    const walking = Math.hypot(m.vx ?? 0, m.vy ?? 0) > 0.6;
    if (walking) {
      const row = mod(Math.floor(v.dist / 0.36), 4);
      fr = frameFor(tier, `w|${dir}|${row}`, look, () => paintPose(tier, dir, { ...P0, row }));
    } else {
      // Покой героя — одна строка; живёт стекло: блик раз в 2,8 с, у каждого свой миг.
      const ph = ((now / SHEEN_T + phaseOf(m)) % 1) * SHEEN_T;
      const sh = ph < 8 / 24 ? Math.floor(ph * 24) : -1;
      fr = frameFor(tier, `i|${dir}|${sh}`, look, () => paintPose(tier, dir, P0, sh));
    }
  }
  if (!fr) return null;
  hurtFx(v, now, 2, ex);
  return dress(fr, pose.flash, ex);
});

// ---- Прогрев: всё частое во всех сторонах, смерть тоже --------------------------------------

registerMobWarm('f7_echo', () => {
  const tier = heroGear().robe;
  const steps: (() => unknown)[] = [];
  const look: Look = 'normal';
  for (const dir of DIRS) {
    for (let row = 0; row < 4; row++)
      steps.push(() =>
        frameFor(tier, `w|${dir}|${row}`, look, () => paintPose(tier, dir, { ...P0, row })),
      );
    for (let sh = -1; sh < 8; sh++)
      steps.push(() => frameFor(tier, `i|${dir}|${sh}`, look, () => paintPose(tier, dir, P0, sh)));
  }
  for (let ai = 0; ai < 16; ai++) {
    const aim = (ai * TAU) / 16;
    const dir = dirOf(aim);
    for (let f = 0; f < N_COPY + N_REC; f++)
      steps.push(() =>
        frameFor(tier, `c|${ai}|0|${f}`, look, () => paintPose(tier, dir, copyPose(f, aim, 0))),
      );
  }
  for (let ai = 0; ai < 8; ai++) {
    const aim = (ai * TAU) / 8;
    const dir = dirOf(aim);
    for (let f = 0; f < N_COPY + N_REC; f++)
      steps.push(() =>
        frameFor(tier, `b|${ai}|${f}`, look, () => paintPose(tier, dir, copyPose(f, aim, 2))),
      );
  }
  for (const dir of DIRS) {
    for (let f = 0; f < DIE_N; f++)
      steps.push(() => frameFor(tier, `d|${dir}|${f}`, look, () => deathPic(tier, dir, f)));
    for (let f = 0; f < STEP_N; f++)
      steps.push(() => frameFor(tier, `s|${dir}|${f}`, look, () => stepPic(tier, dir, f)));
    for (let f = 0; f < 4; f++)
      steps.push(() =>
        frameFor(tier, `h|${dir}|${f}`, look, () => paintPose(tier, dir, { ...P0, row: 6 }, f)),
      );
  }
  return warmSteps(steps);
});
