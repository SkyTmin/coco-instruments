// Этаж 14 — «Двойник из прошлого» (анимации мобов 14).
//
// Это сам герой пять секунд назад: его лист из набора (ступень робы и клинок
// — из стора), засвеченная плёнка — светлота своя у каждой точки, цвет —
// бледный янтарь, второй отпечаток со сдвигом, строки развёртки, золотой
// кант. Четыре стороны — как у самого героя (лист набора), с тем же запасом
// у границы; шаг — по пройденному пути (0,36 клетки на кадр, как у героя).
//
// Удары — повтор ударов героя (мозг: `m.data.swing`, `vAng`, `vHeavy`):
// предупреждение 0,6 с — весь замах, контакт — ровно в миг удара (кадр 0
// дорожки = `swing + DOUBLE.warn`). Лёгкие удары идут серией: следующий —
// обратным ходом, как у героя. Тяжёлый — кольцо набора, как у героя, и
// широкий взмах. Топот раз в 2,6 с (`vStomp`): присел, прыжок, падение —
// контакт в миг удара (`vStomp + 0,8`). Чем ближе удар, тем «плотнее»
// плёнка: строки развёртки гаснут, в контакт — пересвет.
//
// Кадры: клинок замаха — по стороне листа (4), взмах — 16 сторон, отход — 8.
// Всё, что играет, прогревается; состояние рисунка — в `WeakMap` по мобу.

import { Px } from '../dungeon-art';
import { registerImpactPainter, registerMobPainter } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { bladeSprite, heroSprite, loadDungeonSprites, spritesReady } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import { DOUBLE } from './f14-brains';
import {
  FPS,
  PI,
  TAU,
  alpha,
  clamp01,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  hx,
  hurtAge,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  mixc,
  speedOf,
  sstep,
  visOf,
  warmAll,
  regWarm,
  warmGray,
  wnow,
} from './f14-mobkit';
import type { Pic, RGBA } from './f14-mobkit';

// ---------------------------------------------------------------------------
// Ступень героя — из стора (ленивым импортом, как у этажа 7).
// ---------------------------------------------------------------------------

let gearGet: (() => [number, number]) | null = null;
let gearAsked = false;
function gearTiers(): [number, number] {
  if (!gearAsked && typeof window !== 'undefined') {
    gearAsked = true;
    void import('../../store')
      .then((S) => {
        gearGet = () => {
          const g = S.useFinanceStore.getState().dungeon?.gear;
          return [g?.robe?.tier ?? 8, g?.weapon?.tier ?? 8];
        };
      })
      .catch(() => undefined);
  }
  return gearGet?.() ?? [8, 8];
}

// ---------------------------------------------------------------------------
// Плёнка: исходные точки листа → бледный янтарь.
// ---------------------------------------------------------------------------

interface Src {
  w: number;
  h: number;
  d: Uint8ClampedArray;
}
const SRC = new Map<string, Src>();
function srcOf(key: string, c: HTMLCanvasElement | null): Src | null {
  const got = SRC.get(key);
  if (got) return got;
  if (!c || !c.width || !c.height) return null;
  const g = c.getContext('2d');
  if (!g) return null;
  const s = { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
  SRC.set(key, s);
  return s;
}
const DIRS: Dir4[] = ['down', 'left', 'up', 'right'];
const heroSrc = (tier: number, d: number, row: number) =>
  srcOf(`h${tier}|${d}|${row}`, heroSprite(tier, DIRS[d], row));
const bladeSrc = (wt: number) => srcOf(`b${wt}`, bladeSprite(wt));

const PALE = hx('#ffe6a8');
const DEEP = hx('#5a3a14');
const OVER = hx('#fff8e4');
const GOLD = hx('#ffcf5a', 210);
const SM_A = hx('#ffd66e');
const SM_B = hx('#fff6d6');
const RING_W = hx('#ffffff');
const RING_G = hx('#ffe08a');
const DUST = hx('#e8d2a0');
const EMBER = hx('#ff9a3c');
const CHAR = hx('#2a1a0c');

/** Светлота точки → янтарь плёнки; `over` — пересвет к белому. */
function pastC(d: Uint8ClampedArray, i: number, over: number): RGBA {
  const l = Math.min(1, ((d[i] * 0.3 + d[i + 1] * 0.55 + d[i + 2] * 0.15) / 255) * 1.5 + 0.12);
  const c = l < 0.2 ? DEEP : mixc(DEEP, PALE, l);
  return over > 0 ? mixc(c, OVER, Math.min(1, over) * 0.7) : c;
}

interface Film {
  /** 0 — плёнка (развёртка, отпечаток), 1 — плотный, «настоящий». */
  solid: number;
  over: number;
  /** Фаза развёртки 0…3 (строка, что гаснет). */
  roll: number;
  /** Сдвиг второго отпечатка. */
  pdx: number;
  pdy: number;
  /** Сдвиг строк (разрыв плёнки) и видимость точки (прожог, проявка). */
  shift?: (y: number) => number;
  keep?: (x: number, y: number) => number;
}

/** Лист героя на холст: отпечаток прошлого кадра, потом сам кадр. */
function film(p: Px, s: Src, ox: number, oy: number, F: Film): void {
  const pa = 0.26 * (1 - F.solid);
  for (let pass = pa > 0.01 ? 0 : 1; pass < 2; pass++)
    for (let y = 0; y < s.h; y++) {
      const sh = F.shift ? F.shift(y) : 0;
      const line = (y + F.roll) % 4 === 3;
      const a0 = line ? lerp(0.66, 1, F.solid) : lerp(0.88, 1, F.solid);
      for (let x = 0; x < s.w; x++) {
        const i = (y * s.w + x) * 4;
        if (!s.d[i + 3]) continue;
        const kp = F.keep ? F.keep(x, y) : 1;
        if (kp <= 0) continue;
        if (pass === 0) p.set(ox + x + sh + F.pdx, oy + y + F.pdy, alpha(PALE, pa * kp));
        else p.set(ox + x + sh, oy + y, alpha(pastC(s.d, i, F.over), a0 * kp));
      }
    }
}

/** Клинок в кулаке (fx, fy): рукоять в руке, остриё по углу `a` (как у героя). */
function blade(p: Px, b: Src, fx: number, fy: number, a: number, A: number, over: number): void {
  const r = a - PI / 2;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const half = Math.floor(b.w / 2);
  const x0 = Math.round(fx);
  const y0 = Math.round(fy);
  for (let y = -13; y <= 13; y++)
    for (let x = -13; x <= 13; x++) {
      const dx = x + 0.5 - (fx - x0) - 0.5;
      const dy = y + 0.5 - (fy - y0) - 0.5;
      const lx = c * dx + s * dy;
      const ly = -s * dx + c * dy;
      const ix = Math.floor(lx + half + 0.5);
      const iy = Math.floor(ly + 3 + 0.5);
      if (ix < 0 || iy < 0 || ix >= b.w || iy >= b.h) continue;
      const i = (iy * b.w + ix) * 4;
      if (!b.d[i + 3]) continue;
      p.set(x0 + x, y0 + y, alpha(pastC(b.d, i, over + 0.15), A));
    }
}

/**
 * След клинка: серп от угла `a0` к `a1` вокруг (cx, cy), толще у свежего
 * края, кромка — светлая. Точка считается один раз — без наложения.
 */
function smearArc(
  p: Px,
  lit: Px | null,
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  k: number,
): void {
  const span = a1 - a0;
  const n = Math.abs(span);
  if (n < 0.08 || k <= 0) return;
  const sg = span > 0 ? 1 : -1;
  for (let y = Math.floor(cy - r1 - 1); y <= Math.ceil(cy + r1 + 1); y++)
    for (let x = Math.floor(cx - r1 - 1); x <= Math.ceil(cx + r1 + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const rr = Math.hypot(dx, dy);
      if (rr > r1) continue;
      const d = ((((Math.atan2(dy, dx) - a0) * sg) % TAU) + TAU) % TAU;
      const u = d / n;
      if (u > 1) continue;
      // Серп: у свежего края — во всю ширину, к хвосту — тоньше и бледнее.
      const rin = lerp(r1 - 1.6, r0, Math.pow(u, 0.7));
      if (rr < rin) continue;
      const rim = r1 - rr < 1.3;
      const a = k * (0.2 + 0.8 * u * u) * (rim ? 1 : 0.55);
      if (a < 0.06) continue;
      p.set(x, y, alpha(rim ? SM_B : SM_A, a));
      if (lit && a > 0.3) lit.set(x, y, alpha(SM_B, a * 0.6));
    }
}

/** Кольцо набора тяжёлого — как у героя: пунктир растёт, полное — золото. */
function ring(p: Px, cx: number, cy: number, R: number, gold: boolean): void {
  const n = Math.ceil(TAU * R * 1.3);
  for (let i = 0; i < n; i++) {
    if (!gold && (i >> 1) % 2) continue;
    const a = (i / n) * TAU;
    p.set(
      Math.round(cx + Math.cos(a) * R - 0.5),
      Math.round(cy + Math.sin(a) * R - 0.5),
      gold ? alpha(RING_G, 0.95) : alpha(RING_W, 0.7),
    );
  }
}

// ---------------------------------------------------------------------------
// Холст вида и позы.
// ---------------------------------------------------------------------------

const W = 52;
const H = 50;
const AX = 26;
const AY = 34;
/** Лист героя: верх кадра 16×16 — на 15 точек выше ног (как рисует герой). */
const OX = AX - 8;
const OY = AY - 15;
/** Грудь: центр кольца и следа (у героя — `py − 4,5`). */
const CX = AX + 0.5;
const CY = AY - 6.5;
const KD = kindOf('double', W, H, AX, AY, 1300);

/** Половина дуги лёгкого и тяжёлого (зоны мозга: 1,9 и 3,4). */
const HALF_L = 0.95;
const HALF_H = 1.7;
const SEC16 = (a: number) => ((Math.round((a / TAU) * 16) % 16) + 16) % 16;
const SEC8 = (a: number) => ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
const DIR_A = [PI / 2, PI, -PI / 2, 0];

/** Сторона листа по углу; `prev` ≥ 0 — с запасом у границы (как у героя). */
function dir4(a: number, prev: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const side = Math.abs(c) > Math.abs(s);
  const prevSide = prev === 1 || prev === 3;
  const keep = prev >= 0 && (side === prevSide || Math.abs(Math.abs(c) - Math.abs(s)) < 0.18);
  const use = keep ? prevSide : side;
  return use ? (c < 0 ? 1 : 3) : s < 0 ? 2 : 0;
}

interface SwP {
  row: number;
  b: number;
  hand: number;
  ba: number;
  solid: number;
  over: number;
  sm0: number;
  sm1: number;
  smk: number;
  /** Кольцо тяжёлого: радиус (0 — нет) и полное ли. */
  ringR: number;
  gold: boolean;
}

/**
 * Поза удара по кадру дорожки `g` (0 — контакт): замах −14…−9, держит
 * −8…−2 (две ступени плотности), спуск −1, контакт 0, проводка 1–3, отход 4–8.
 */
function swPose(g: number, A: number, s: number, heavy: boolean, row: number): SwP {
  const Hf = heavy ? HALF_H : HALF_L;
  const start = A - s * Hf;
  const end = A + s * Hf;
  const cock = A - s * (Hf + (heavy ? 0.3 : 0.45));
  const handCock = A - s * (heavy ? 1.9 : 1.2);
  const P: SwP = {
    row,
    b: cock,
    hand: handCock,
    ba: 1,
    solid: 0.65,
    over: 0,
    sm0: 0,
    sm1: 0,
    smk: 0,
    ringR: 0,
    gold: false,
  };
  if (g <= -9) {
    const i = g + 14;
    const k = easeOut((i + 1) / 6);
    P.b = lerp(A - s * 0.35, cock, k);
    P.hand = lerp(A - s * 0.3, handCock, k);
    P.ba = lerp(0.45, 1, clamp01(i / 3));
    P.solid = 0.45 * k;
    if (heavy) P.ringR = 4 + 7 * 0.7 * ((i + 1) / 6);
  } else if (g <= -5) {
    P.solid = 0.65;
    if (heavy) P.ringR = 4 + 7 * 0.85;
  } else if (g <= -2) {
    P.b = cock - s * 0.1;
    P.hand = handCock - s * 0.08;
    P.solid = 0.9;
    if (heavy) {
      P.ringR = 11;
      P.gold = true;
    }
  } else if (g <= 3) {
    P.row = 4;
    P.solid = 1;
    const TB = [
      start + s * 0.1 * Hf,
      A + s * Hf * 0.55,
      end + s * 0.2,
      end + s * 0.3,
      end + s * 0.25,
    ];
    const TH = [A - s * 0.5, A + s * 0.15, A + s * 0.6, A + s * 0.7, A + s * 0.65];
    const TS: [number, number, number][] = [
      [cock, TB[0], 0.45],
      [start, TB[1], 1],
      [start, TB[2], 0.75],
      [A, TB[3], 0.4],
      [end - s * 0.35, TB[4], 0.18],
    ];
    const j = g + 1;
    P.b = TB[j];
    P.hand = TH[j];
    [P.sm0, P.sm1, P.smk] = TS[j];
    P.over = [0.2, 0.6, 0.3, 0.1, 0][j];
  } else {
    const k = (g - 3) / 5;
    P.row = 0;
    P.b = lerp(end + s * 0.25, A + s * 0.6, easeOut(k));
    P.hand = lerp(A + s * 0.65, A + s * 0.3, k);
    P.ba = 1 - easeIn(k);
    P.solid = lerp(0.8, 0, k);
  }
  return P;
}

/** Тело, клинок, след, кольцо — кадр удара. */
function swingPic(
  tier: number,
  wt: number,
  d: number,
  P: SwP,
  heavy: boolean,
  s: number,
): Pic | null {
  const src = heroSrc(tier, d, P.row);
  const bl = bladeSrc(wt);
  if (!src) return null;
  const p = new Px(W, H);
  const fx = AX + Math.cos(P.hand) * 5;
  const fy = AY - 6 + Math.sin(P.hand) * 4;
  const behind = Math.sin(P.b) < -0.35 || d === 2;
  const F: Film = { solid: P.solid, over: P.over, roll: 0, pdx: -1, pdy: -1 };
  if (bl && P.ba > 0.02 && behind) blade(p, bl, fx, fy, P.b, P.ba, P.over);
  film(p, src, OX, OY, F);
  if (bl && P.ba > 0.02 && !behind) blade(p, bl, fx, fy, P.b, P.ba, P.over);
  p.outline(GOLD);
  let lit: Px | null = null;
  if (P.smk > 0) {
    if (P.smk >= 0.75) lit = new Px(W, H);
    smearArc(p, lit, CX, CY, P.sm0, P.sm1, 5, heavy ? 15 : 14, P.smk);
    // Тяжёлый — второй, внутренний серп с отставанием (у героя — тройной след).
    if (heavy) smearArc(p, lit, CX, CY, P.sm0, P.sm1 - s * 0.5, 3, 9, P.smk * 0.7);
  }
  if (P.ringR > 0) ring(p, CX, CY, P.ringR, P.gold);
  return { p, lit, ax: AX, ay: AY, eye: null };
}

// ---------------------------------------------------------------------------
// Позы без удара: покой, шаг, топот, проявка, ушиб, смерть.
// ---------------------------------------------------------------------------

function plainPic(tier: number, d: number, row: number, F: Film): Pic | null {
  const src = heroSrc(tier, d, row);
  if (!src) return null;
  const p = new Px(W, H);
  film(p, src, OX, OY, F);
  p.outline(GOLD);
  return { p, lit: null, ax: AX, ay: AY, eye: null };
}

/** Пыль приземления: клубы у ног в обе стороны и искорки. */
function dust(p: Px, j: number): void {
  const k = j / 5;
  for (const sd of [-1, 1]) {
    const x = AX + sd * (4 + 4 * easeOut(k));
    const y = AY - 1 - k;
    const r = 1.4 + 1.6 * k;
    p.ell(x, y, r, r * 0.7, alpha(DUST, 0.75 * (1 - k)));
  }
  for (let i = 0; i < 6; i++) {
    const a = PI + (i / 5) * PI;
    const rr = 3 + 9 * easeOut(k) * (0.6 + 0.4 * hash(i, 5));
    p.set(
      Math.round(AX + Math.cos(a) * rr),
      Math.round(AY - 2 + Math.sin(a) * rr * 0.5),
      alpha(SM_B, 1 - k),
    );
  }
}

/** Смерть — плёнка горит: пересвет, разрыв строк, прожог от груди, пепел вверх. */
function diePic(tier: number, d: number, f: number): Pic | null {
  const src = heroSrc(tier, d, 0);
  if (!src) return null;
  const p = new Px(W, H);
  const t = f / FPS;
  const tear = sstep(0.08, 0.5, t);
  const burn = sstep(0.12, 0.62, t);
  const nz = (x: number, y: number) =>
    Math.hypot((x - 7.5) / 8, (y - 8) / 9) * 0.75 + hash(x, y, 31) * 0.3;
  const F: Film = {
    solid: 1,
    over: f < 3 ? 1 - f * 0.2 : 0.3 * (1 - tear),
    roll: 0,
    pdx: 0,
    pdy: 0,
    shift: (y) => Math.round((((y >> 1) & 1) * 2 - 1) * tear * (2 + 5 * hash(y >> 1, 41))),
    keep: (x, y) => (nz(x, y) < burn * 1.15 ? 0 : 1),
  };
  film(p, src, OX, OY, F);
  if (f < 18) p.outline(alpha(GOLD, 0.82 * (1 - burn)));
  // Кромка прожога: тлеет янтарём, за ней — обугленный край.
  if (burn > 0 && burn < 1)
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        if (!src.d[(y * src.w + x) * 4 + 3]) continue;
        const q = nz(x, y) - burn * 1.15;
        if (q < 0 || q > 0.16) continue;
        const sh = F.shift?.(y) ?? 0;
        p.set(OX + x + sh, OY + y, q < 0.07 ? alpha(EMBER, 0.95) : alpha(CHAR, 0.85));
      }
  // Пепел и искры летят вверх.
  if (t > 0.18)
    for (let i = 0; i < 12; i++) {
      const k = clamp01((t - 0.18 - hash(i, 2) * 0.2) / 0.6);
      if (k <= 0 || k >= 1) continue;
      const x = OX + 2 + hash(i, 3) * 12 + Math.sin(k * 5 + i) * 1.5;
      const y = OY + 4 + hash(i, 4) * 10 - k * 14;
      p.set(Math.round(x), Math.round(y), alpha(i % 3 ? SM_A : EMBER, 1 - k));
    }
  return { p, lit: null, ax: AX, ay: AY, eye: null };
}

/** Вид кадра: имя — с ступенью робы и клинка (их меняют прямо в забеге). */
function dbPic(anim: string, f: number, d: number): Pic {
  const [nm, ts, ws] = anim.split('.');
  const tier = +ts;
  const wt = +ws;
  let pic: Pic | null = null;
  if (nm === 'id') {
    // Покой: развёртка бежит, второй отпечаток дрожит — плёнка жива.
    pic = plainPic(tier, d, 0, { solid: 0, over: 0, roll: f % 4, pdx: -1, pdy: f < 4 ? -1 : 0 });
  } else if (nm === 'wk') {
    pic = plainPic(tier, d, f >> 2, { solid: 0, over: 0, roll: f % 4, pdx: -1, pdy: -1 });
  } else if (nm === 'wl' || nm === 'wh') {
    const heavy = nm === 'wh';
    const row = f >> 3;
    const i = f & 7;
    const g = i < 6 ? i - 14 : i === 6 ? -6 : -3;
    const dd = heavy ? d : d >> 1;
    const s = heavy ? -1 : d & 1 ? -1 : 1;
    pic = swingPic(tier, wt, dd, swPose(g, DIR_A[dd], s, heavy, row), heavy, s);
  } else if (nm === 'sl' || nm === 'sh' || nm === 'rl' || nm === 'rh') {
    const heavy = nm[1] === 'h';
    const rec = nm[0] === 'r';
    const s = heavy ? -1 : d & 1 ? -1 : 1;
    const sec = heavy ? d : d >> 1;
    const A = (sec / (rec ? 8 : 16)) * TAU;
    const g = rec ? f + 4 : f - 1;
    pic = swingPic(tier, wt, dir4(A, -1), swPose(g, A, s, heavy, 0), heavy, s);
  } else if (nm === 'st') {
    // Топот: 0 присел, 1 в воздухе, 2 падает, 3–8 приземление с пылью.
    const row = f === 1 ? 6 : f <= 5 ? 5 : 0;
    const F: Film = {
      solid: f === 0 ? 0.4 : f <= 3 ? 0.6 + f * 0.13 : lerp(1, 0.3, (f - 3) / 5),
      over: f === 3 ? 0.5 : 0,
      roll: 0,
      pdx: f === 2 ? 0 : -1,
      pdy: f === 2 ? -2 : -1,
    };
    pic = plainPic(tier, d, row, F);
    if (pic && f === 2)
      for (const x of [3, 8, 12])
        for (let y = 1; y <= 5; y++) pic.p.set(OX + x, OY - 2 - y, alpha(PALE, 0.55 - y * 0.08));
    if (pic && f >= 3) dust(pic.p, f - 3);
  } else if (nm === 'dv') {
    // Проявка: кадр проецируется сверху вниз, кромка — пересвет.
    const k = f / 10;
    const front = Math.round(k * 17);
    pic = plainPic(tier, d, 0, {
      solid: k * 0.6,
      over: 1 - k,
      roll: f % 4,
      pdx: -1,
      pdy: -1,
      keep: (_x, y) => (y <= front ? 1 : 0),
    });
    if (pic && f < 10)
      for (let x = -2; x < 18; x++)
        if (pic.p.solid(OX + x, OY + front) || hash(x, f, 7) < 0.4)
          pic.p.set(OX + x, OY + front, alpha(OVER, 0.9));
  } else if (nm === 'hu') {
    // Ушиб: плёнку дёрнуло — полосы врозь, пересвет, отпечаток отлетел.
    const k = 1 - f / 5;
    pic = plainPic(tier, d, 0, {
      solid: 0.3,
      over: 0.6 * k,
      roll: 0,
      pdx: -1 - Math.round(2 * k),
      pdy: -1,
      shift: (y) => (y >= 5 && y < 9 ? Math.round(2 * k) : y >= 9 && y < 12 ? -Math.round(k) : 0),
    });
  } else if (nm === 'die') {
    pic = diePic(tier, d, f);
  }
  return pic ?? { p: new Px(1, 1), lit: null, ax: 0, ay: 0, eye: null };
}

// ---------------------------------------------------------------------------
// Удары двойника: что играет сейчас.
// ---------------------------------------------------------------------------

interface Sw {
  /** Миг контакта (время мира). */
  c: number;
  a: number;
  h: boolean;
  /** Ход взмаха: +1 / −1 (серия — попеременно, как у героя). */
  s: number;
}
interface DS {
  sw: Sw[];
  seen: number;
  dir: number;
}
const DST = new WeakMap<Mob, DS>();

function dsOf(m: Mob, now: number): DS {
  let st = DST.get(m);
  if (!st) {
    st = { sw: [], seen: NaN, dir: -1 };
    DST.set(m, st);
  }
  const sw = m.data?.swing;
  if (typeof sw === 'number' && sw !== st.seen) {
    st.seen = sw;
    const c = sw + DOUBLE.warn;
    const h = !!m.data.vHeavy;
    const last = st.sw[st.sw.length - 1];
    // Серия: прошлый лёгкий ещё в замахе или проводке — новый идёт обратно.
    const chain = !!last && !last.h && !h && c - last.c < DOUBLE.warn;
    const s = h ? -1 : chain ? -last.s : (m.data.vSheetSide ?? 1) < 0 ? -1 : 1;
    st.sw.push({ c, a: m.data.vAng ?? m.face ?? 0, h, s });
    if (st.sw.length > 6) st.sw.shift();
  }
  while (st.sw.length && st.sw[0].c < now - 1) st.sw.shift();
  return st;
}

/** Удар, что сейчас на экране, и кадр его дорожки (0 — контакт). */
function activeSwing(st: DS, now: number): [Sw, number] | null {
  for (let i = 0; i < st.sw.length; i++) {
    const w = st.sw[i];
    const nx = st.sw[i + 1];
    let end = w.c + 9 / FPS;
    // Следующий удар серии забирает кадр после двух кадров проводки.
    if (nx) end = Math.min(end, Math.max(w.c + 3 / FPS, nx.c - DOUBLE.warn));
    if (now >= end) continue;
    if (now < w.c - DOUBLE.warn - 0.02) return null;
    // Сетка 24 к/с — от начала замаха: кадр контакта тот, в котором удар.
    const g = Math.max(-14, Math.min(8, Math.floor((now - w.c + DOUBLE.warn) * FPS + 1e-6) - W_F));
    return [w, g];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Рисовальщик.
// ---------------------------------------------------------------------------

const STRIDE = 0.36;
const DIE_T = 0.85;
const STOMP_UP = 11;
/** Кадр контакта замаха и топота на сетке 24 к/с (удар — внутри кадра). */
const W_F = Math.floor(DOUBLE.warn * FPS);
const ST_F = Math.floor(0.8 * FPS);
/** Топот: присел до, вершина прыжка, земля — начало кадра контакта. */
const ST_CROUCH = 7 / FPS;
const ST_PEAK = 0.62;
const ST_LAND = ST_F / FPS;

/** Пока лист героя не пришёл (портрет до загрузки): тень-силуэт. */
let fall: MobFrame | null = null;
function fallback(): MobFrame {
  if (fall) return fall;
  const p = new Px(14, 18);
  p.ell(7, 5, 3.2, 3.2, alpha(PALE, 0.8));
  for (let y = 8; y < 17; y++)
    for (let x = 3; x < 11; x++) if (y % 4 !== 3) p.set(x, y, alpha(PALE, 0.7));
  p.outline(GOLD);
  fall = { img: p.canvas(), ax: 7, ay: 17, eye: null, shadow: 4 };
  return fall;
}

registerMobPainter('f14_double', (m: Mob, pose: MobPose) => {
  if (!spritesReady()) void loadDungeonSprites();
  const [tier, wt] = gearTiers();
  if (!heroSprite(tier, 'down', 0)) return fallback();
  const tw = `${tier}.${wt}`;
  const md = pose.mode;
  const t = pose.t || 0;
  const now = wnow(pose);
  const rnow = pose.now || 0;
  const st = dsOf(m, now);
  const sp = speedOf(m);
  const want = sp > 0.4 ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  const v = visOf(m, pose, want, 14);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'id';
  let f = 0;
  let d = (st.dir = dir4(v.yaw, st.dir));
  let gray = false;
  const roll = Math.floor(now * 8 + hash(m.id ?? 0, 13) * 4) & 3;
  const busy = md === 'chase' || md === 'idle';
  const sw = busy ? activeSwing(st, now) : null;
  const ts = typeof m.data?.vStomp === 'number' ? now - m.data.vStomp : 9;
  const stomp = busy && ts >= 0 && ts < ST_LAND + 9 / FPS;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = DIE_T;
    ex.alpha = 1 - sstep(0.62, DIE_T, t);
    ex.still = true;
  } else if (md === 'f14_frozen') {
    gray = true;
    ex.still = true;
  } else if (md === 'emerge') {
    anim = 'dv';
    f = Math.min(10, Math.floor((t / 0.45) * 11));
  } else if (md === 'alert') {
    anim = 'dv';
    f = Math.min(10, 5 + Math.floor((t / 0.35) * 6));
  } else if (md === 'sleep') {
    // Плёнка на паузе: кадр стоит, тусклее.
    ex.alpha = 0.72;
  } else if (md === 'drop') {
    anim = 'st';
    f = 1;
  } else if (md === 'stun' && v.prev === 'drop') {
    anim = 'st';
    f = 3 + Math.min(5, Math.floor(t * FPS));
    ex.sy = 1 - 0.2 * (1 - clamp01(t / 0.12));
    ex.sx = 1 + 0.18 * (1 - clamp01(t / 0.12));
  } else if (md === 'stun') {
    anim = 'hu';
    f = fi(t, 4);
  } else if (sw) {
    const [w, g] = sw;
    // Сторона листа — по тому же углу, что и кадры взмаха (16 сторон).
    const dd = (st.dir = dir4((SEC16(w.a) / 16) * TAU, -1));
    d = dd;
    ex.still = true;
    if (g <= -2) {
      const row = sp > 0.6 ? Math.floor(v.dist / STRIDE) & 3 : 0;
      const i = g <= -9 ? g + 14 : g <= -5 ? 6 : 7;
      anim = w.h ? 'wh' : 'wl';
      f = row * 8 + i;
      d = w.h ? dd : dd * 2 + (w.s > 0 ? 0 : 1);
      // Держит замах: дрожь натянутой руки, ближе к удару — сильнее.
      if (g >= -8) ex.dx = (g & 1 ? 0.5 : -0.5) * (g >= -4 ? 1.4 : 0.8);
    } else if (g <= 3) {
      anim = w.h ? 'sh' : 'sl';
      f = g + 1;
      d = w.h ? SEC16(w.a) : SEC16(w.a) * 2 + (w.s > 0 ? 0 : 1);
      // Вес: корпус уходит в удар и отдаёт назад.
      const lunge = [0.6, 1.6, 1.2, 0.5, 0.2][g + 1];
      ex.dx = Math.cos(w.a) * lunge;
      ex.dy = Math.sin(w.a) * lunge * 0.6;
      if (g === 0) {
        ex.sx = w.h ? 1.1 : 1.06;
        ex.sy = w.h ? 0.9 : 0.95;
      }
      if (g <= 1) ex.ghost = { every: 0.03, life: 0.12, tint: '#fff2c0', alpha: 0.3 };
    } else {
      anim = w.h ? 'rh' : 'rl';
      f = g - 4;
      d = w.h ? SEC8(w.a) : SEC8(w.a) * 2 + (w.s > 0 ? 0 : 1);
    }
  } else if (stomp) {
    anim = 'st';
    const i = Math.floor(ts * FPS + 1e-6);
    f = i < 7 ? 0 : i < 17 ? 1 : i < ST_F ? 2 : 3 + Math.min(5, i - ST_F);
    ex.still = true;
  } else if (hurtAge(v, rnow) < 0.2 && md !== 'f14_frozen') {
    anim = 'hu';
    f = fi(hurtAge(v, rnow), 4);
  } else if (sp > 0.6) {
    anim = 'wk';
    f = ((Math.floor(v.dist / STRIDE) & 3) << 2) | roll;
    // Догоняет прошлое бегом — за ним шлейф отпечатков.
    if (sp > 5.5) ex.ghost = { every: 0.05, life: 0.2, tint: '#ffcf5a', alpha: 0.26 };
  } else {
    anim = 'id';
    f = roll + (idlePh(m, pose, 2.4) < 0.5 ? 0 : 4);
  }
  // Топот: высота и сжатие — полями кадра поверх любой позы (и поверх удара).
  if (stomp) {
    let up = 0;
    if (ts < ST_CROUCH) {
      const k = easeOut(ts / ST_CROUCH);
      ex.sy = (ex.sy ?? 1) * (1 - 0.13 * k);
      ex.sx = (ex.sx ?? 1) * (1 + 0.08 * k);
    } else if (ts < ST_PEAK) {
      const k = (ts - ST_CROUCH) / (ST_PEAK - ST_CROUCH);
      up = STOMP_UP * easeOut(k);
      ex.sy = (ex.sy ?? 1) * (1 + 0.1 * (1 - k));
      ex.sx = (ex.sx ?? 1) * (1 - 0.06 * (1 - k));
    } else if (ts < ST_LAND) {
      const k = (ts - ST_PEAK) / (ST_LAND - ST_PEAK);
      up = STOMP_UP * (1 - easeIn(k));
      ex.sy = (ex.sy ?? 1) * (1 + 0.1 * k);
      ex.sx = (ex.sx ?? 1) * (1 - 0.06 * k);
      if (k > 0.4) ex.ghost = { every: 0.03, life: 0.1, tint: '#fff2c0', alpha: 0.28 };
    } else {
      const k = clamp01((ts - ST_LAND) / 0.25);
      ex.sx = (ex.sx ?? 1) * (1 + 0.24 * (1 - k) * (1 - k));
      ex.sy = (ex.sy ?? 1) * (1 - 0.22 * (1 - k) * (1 - k));
    }
    ex.dy = (ex.dy ?? 0) - up;
    ex.shadow = 5 - 1.6 * (up / STOMP_UP);
  }
  if (md !== 'dying' && !gray) hurtFx(v, rnow, 0.6, ex);
  const name = `${anim}.${tw}`;
  return { ...frameOf(KD, name, f, d, pose, () => dbPic(name, f, d), gray), ...ex };
});

// ---------------------------------------------------------------------------
// Прогрев: всё, что играет, — для ступени героя (лист должен прийти).
// ---------------------------------------------------------------------------

const D4 = [0, 1, 2, 3];
const D8 = [0, 1, 2, 3, 4, 5, 6, 7];
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Кадров в серии по позе (имя позы — `поза.ступень.оружие`). */
const DB_N: Record<string, number> = {
  id: 8,
  wk: 16,
  wl: 32,
  sl: 5,
  rl: 5,
  wh: 32,
  sh: 5,
  rh: 5,
  st: 9,
  hu: 5,
  die: 21,
  dv: 11,
};

regWarm(
  'f14_double',
  function* () {
    for (let i = 0; i < 1200 && (!spritesReady() || !gearGet); i++) {
      void loadDungeonSprites();
      gearTiers();
      yield 0;
    }
    if (!spritesReady()) return;
    const [tier, wt] = gearTiers();
    const tw = `${tier}.${wt}`;
    const list: [string, number, number[]?][] = [
      [`id.${tw}`, DB_N.id, D4],
      [`wk.${tw}`, DB_N.wk, D4],
      [`wl.${tw}`, DB_N.wl, D8],
      [`sl.${tw}`, DB_N.sl, range(32)],
      [`rl.${tw}`, DB_N.rl, range(16)],
      [`wh.${tw}`, DB_N.wh, D4],
      [`sh.${tw}`, DB_N.sh, range(16)],
      [`rh.${tw}`, DB_N.rh, D8],
      [`st.${tw}`, DB_N.st, D4],
      [`hu.${tw}`, DB_N.hu, D4],
      [`die.${tw}`, DB_N.die, D4],
      [`dv.${tw}`, DB_N.dv, D4],
    ];
    yield* warmAll(KD, list, dbPic);
    yield* warmGray(KD, [[`id.${tw}`, [0], D4]]);
  },
  [
    [
      KD,
      (anim) => {
        const n = DB_N[anim.split('.')[0]];
        return n && spritesReady() ? [n, dbPic] : null;
      },
    ],
  ],
);

// ---------------------------------------------------------------------------
// Контакт ударов двойника (вместо общего взрыва движка).
// ---------------------------------------------------------------------------

const rgba = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a).toFixed(3)})`;

/** Удар из прошлого лёг: кромка конуса вспыхнула плёнкой, золото искрами. */
registerImpactPainter('f14_echo', {
  life: 0.32,
  shake: 0.1,
  above: true,
  paint(g, rec, px, py, S, age) {
    const k = clamp01(age / 0.32);
    const R = (rec.r ?? 1.45) * S;
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 1.9;
    g.strokeStyle = rgba(SM_B, 0.9 * (1 - k));
    g.lineWidth = Math.max(1, Math.round(2.5 * (1 - k)));
    g.beginPath();
    g.arc(px, py, R * (0.86 + 0.12 * easeOut(k)), a - arc / 2, a + arc / 2);
    g.stroke();
    g.fillStyle = rgba(SM_A, 1 - k);
    for (let i = 0; i < 9; i++) {
      const aa = a - arc / 2 + arc * hash(rec.seed, i);
      const rr = R * (0.7 + 0.45 * easeOut(k) * (0.5 + hash(rec.seed, i, 2)));
      g.fillRect(Math.round(px + Math.cos(aa) * rr), Math.round(py + Math.sin(aa) * rr), 1, 1);
    }
    return true;
  },
});

/** Топот лёг: волна по полу, пыль кольцом. */
registerImpactPainter('f14_echostomp', {
  life: 0.45,
  shake: 0.18,
  paint(g, rec, px, py, S, age) {
    const k = clamp01(age / 0.45);
    const R = (rec.r ?? DOUBLE.stompR) * S;
    const rr = R * (0.35 + 0.8 * easeOut(k));
    g.strokeStyle = rgba(SM_A, 0.85 * (1 - k));
    g.lineWidth = Math.max(1, Math.round(3 * (1 - k)));
    g.beginPath();
    g.ellipse(px, py, rr, rr * 0.62, 0, 0, TAU);
    g.stroke();
    if (age < 0.08) {
      g.fillStyle = rgba(SM_B, 0.5 * (1 - age / 0.08));
      g.beginPath();
      g.ellipse(px, py, R * 0.5, R * 0.3, 0, 0, TAU);
      g.fill();
    }
    g.fillStyle = rgba(DUST, 0.8 * (1 - k));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hash(rec.seed, i) * 0.4;
      const q = rr * (0.85 + 0.25 * hash(rec.seed, i, 3));
      g.fillRect(
        Math.round(px + Math.cos(a) * q),
        Math.round(py + Math.sin(a) * q * 0.62 - k * 3),
        1,
        1,
      );
    }
    return true;
  },
});
