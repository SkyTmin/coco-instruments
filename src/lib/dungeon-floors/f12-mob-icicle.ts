// Этаж 12 — Сосулька (анимации мобов 12). Мозг `f12_icicle` (`f12-brains.ts`):
// `f12_hang` — висит под сводом, спрятана (`data.hide`); герой ближе 1,7 →
// `f12_crack` 0,8 с + удар `f12_iciclefall` (круг r 1,05, `warn` 0,8 — урон
// ударом в 0,8) → `f12_stuck` 3 с (видна, удар ×1,5) → `escape` (+ зона
// `f12_shatter`, 0,4 с). Метку и контакт рисует `f12-boss-fx.ts` — не наши.
//
// Кадры (одна сторона: сосулька круглая, свет сверху слева один): висит 12
// (8 к/с, фаза от id: блик бежит вниз, на кончике набухает капля и падает),
// треск 20 (24 к/с: трещины у корня, снег сыплется, дрожит — в 0,35 с
// отрывается и падает с ускорением, со следом; кончик у льда — в 0,8),
// вонзилась 6 (кадр 0 — удар: осколки, звезда трещин, качается, как нож),
// торчит 8 (блик), удар героя 4 (крошка), тает 8 (капли, лужа, тоньше),
// рассыпается 10 (`escape`), разбита 14 (смерть: куски разлетаются).
// Наклон воткнутой — свой у каждой (от id), по `rot` вокруг острия.

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { hash, hx, ICE, ramp, SNOW, TAU, WATER, WHITE } from './f12-rig';
import {
  clamp01,
  fi,
  frameOf,
  hurtAge,
  idlePh,
  kindOf,
  lerp,
  paintMob,
  PI,
  puff,
  sstep,
  tf,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Part, RGBA, Scr } from './f12-mobkit';

const I_DEEP = ramp('#10284a', '#1a3e6a', '#2c5c8e', '#4f8cbc', '#94c8ec');
const CRACK: RGBA = [236, 248, 255, 255];
const CRACK2 = ICE[3];
const CHIP: RGBA[] = [WHITE, hx('#d8f0ff'), ICE[4], ICE[3]];
const DROP = hx('#cfeaff');
const POOL: RGBA = [WATER[4][0], WATER[4][1], WATER[4][2], 150];
const POOL2: RGBA = [ICE[4][0], ICE[4][1], ICE[4][2], 120];
const STREAK: RGBA = [216, 240, 255, 255];

const K = kindOf('f12_icicle', { w: 34, h: 58, ox: 17, oy: 46 }, 120, 1);

/** Высота кончика висящей сосульки (единицы модели; ×0,64 — точки экрана). */
const HZ = 26;
const L0 = 22;

interface IciO {
  /** Высота кончика над льдом. */
  z: number;
  /** Ушла в лёд. */
  sink: number;
  /** Таяние 0…1: короче и тоньше. */
  melt: number;
  /** Трещины у корня 0…1. */
  crack: number;
  /** Блик по длине: 0 — корень, 1 — кончик, −1 — нет. */
  glint: number;
  /** Капля: 0…0,6 набухает, 0,6…1 падает. */
  drop?: number;
  /** Ком инея на корне (висит). */
  clump: boolean;
  /** Снег сыплется с корня 0…1. */
  snow?: number;
  /** След падения (сила 0…1). */
  streak?: number;
  /** Осколки удара о лёд 0…1, звезда трещин 0…1. */
  shards?: number;
  star?: number;
  /** Звезда ещё горит белым (миг удара). */
  hot?: boolean;
  /** Крошка от удара героя 0…1. */
  chips?: number;
  /** Лужа 0…1. */
  pool?: number;
  /** Рассыпается 0…1 (куски разъезжаются и оседают). */
  burst?: number;
  /** Растянута по ходу падения. */
  stretch?: number;
}

const H0: IciO = { z: HZ, sink: 0, melt: 0, crack: 0, glint: -1, clump: true };

function iciBuild(o: IciO): Build {
  const parts: Part[] = [];
  const L = L0 * (1 - 0.35 * o.melt) * (1 + (o.stretch ?? 0) * 0.12);
  const w = 1 - 0.3 * o.melt;
  const z0 = o.z - o.sink;
  const n = 10;
  // Основная: корень сверху, кончик снизу; бугры — свои у каждого шара.
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = (0.55 + (1 - t) * 2.9) * w;
    parts.push({
      x: (hash(i, 1, 41) - 0.5) * 0.5,
      y: (hash(i, 2, 41) - 0.5) * 0.5,
      z: z0 + L * (1 - t),
      rx: r,
      ry: r,
      rz: r * 1.45,
      ramp: i > 6 ? ICE : I_DEEP,
      gloss: true,
      id: 1,
    });
  }
  // Две малые у корня.
  for (const [e, len] of [
    [-1, 8],
    [1, 6],
  ] as const) {
    const m = 4;
    for (let i = 0; i < m; i++) {
      const t = i / (m - 1);
      const r = (0.45 + (1 - t) * 1.3) * w;
      parts.push({
        x: -0.6 * e,
        y: e * 2.6,
        z: z0 + L - len * (1 - 0.35 * o.melt) * t + 0.5,
        rx: r,
        ry: r,
        rz: r * 1.5,
        ramp: ICE,
        gloss: true,
        id: 2 + e,
      });
    }
  }
  // Отломанный корень — зубцы излома.
  if (!o.clump)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU + 0.5;
      parts.push({
        x: Math.cos(a) * 1.1 * w,
        y: Math.sin(a) * 1.2 * w,
        z: z0 + L + 1.2 + hash(i, 12, 41) * 0.8,
        rx: 0.75 * w,
        ry: 0.75 * w,
        rz: 1.5 + hash(i, 13, 41),
        pitch: Math.cos(a) * 0.35,
        roll: -Math.sin(a) * 0.35,
        ramp: ICE,
        gloss: true,
        id: 7 + i,
      });
    }
  // Ком инея — корень у свода.
  if (o.clump)
    parts.push(
      { x: 0, y: 0, z: z0 + L + 2.2, rx: 3.8, ry: 4.2, rz: 1.8, ramp: SNOW, id: 5 },
      { x: -1, y: -1.4, z: z0 + L + 3.4, rx: 2.4, ry: 2.6, rz: 1.4, ramp: SNOW, id: 6 },
    );
  // Рассыпается: куски разъезжаются, валятся набок, оседают.
  const bk = o.burst ?? 0;
  if (bk > 0)
    parts.forEach((p, i) => {
      const a = hash(i, 3, 41) * TAU;
      const go = bk * (3 + hash(i, 4, 41) * 6);
      p.x += Math.cos(a) * go;
      p.y += Math.sin(a) * go * 0.8;
      const fall = Math.min(1, bk * 1.6);
      p.z = lerp(p.z, Math.min(p.rx, p.rz) * 0.6, fall * fall);
      p.pitch = (p.pitch ?? 0) + bk * (hash(i, 5, 41) - 0.5) * 2.4;
      const sc = 1 - 0.35 * bk;
      p.rx *= sc;
      p.ry *= sc;
      p.rz *= sc * (1 - 0.3 * bk);
    });
  const top = z0 + L;
  const extent: [number, number, number][] = [];
  if (o.drop !== undefined || o.pool !== undefined) extent.push([0, 0, 0], [-5, 0, 0], [5, 0, 0]);
  if (o.shards !== undefined || o.chips !== undefined || o.star !== undefined)
    extent.push([8, 0, 0], [-8, 0, 0], [0, 7, 0], [0, -7, 0], [0, 0, z0 + 12]);
  if (o.streak) extent.push([0, 0, top + 14]);
  return {
    parts,
    clip: o.sink > 0 ? 0 : undefined,
    extent,
    post: (p, scr) => {
      if (o.pool) poolOf(p, scr, o.pool);
      if (o.star) starOf(p, scr, o.star, !!o.hot);
      if (o.crack > 0) crackOf(p, scr, top, o.crack);
      if (o.glint >= 0 && bk === 0) {
        const zg = top - L * o.glint;
        const r = (0.55 + o.glint * 0.1 + (1 - o.glint) * 2.9) * w;
        const [gx, gy] = scr(-r * 0.55, -r * 0.55, zg);
        p.set(gx, gy, WHITE);
        p.set(gx, gy + 1, [255, 255, 255, 170]);
      }
      if (o.drop !== undefined) dropOf(p, scr, z0, o.drop);
      if (o.snow !== undefined) snowOf(p, scr, top + 1, o.snow);
      if (o.streak) streakOf(p, scr, top, o.streak);
      if (o.shards !== undefined) puff(p, scr, 0, 0, o.shards, 14, 9, 43, CHIP, 0, TAU);
      if (o.chips !== undefined) chipsOf(p, scr, z0 + L * 0.45, o.chips);
    },
  };
}

/** Трещины у корня: белые зигзаги вниз и вбок, растут с `k`. */
function crackOf(p: Px, scr: Scr, top: number, k: number): void {
  for (let j = 0; j < 2; j++) {
    const n = Math.round(1 + k * 3);
    let [x, y] = scr(0, (j - 0.5) * 2.4, top - 1);
    x = Math.round(x);
    y = Math.round(y);
    for (let s = 0; s < n; s++) {
      x += hash(j, s, 51) > 0.5 ? 1 : -1;
      y += 1;
      p.set(x, y, s < 2 ? CRACK : CRACK2);
    }
  }
}

/** Капля: набухает на кончике, срывается и падает до льда, плеск. */
function dropOf(p: Px, scr: Scr, z0: number, k: number): void {
  if (k < 0.6) {
    const [x, y] = scr(0, 0, z0 - 0.4 - k * 1.2);
    p.set(x, y, DROP);
    if (k > 0.3) p.set(x, y + 1, DROP);
    return;
  }
  const u = (k - 0.6) / 0.4;
  const z = z0 * (1 - u * u);
  if (u < 0.96) {
    const [x, y] = scr(0, 0, z);
    p.set(x, y, DROP);
    p.set(x, y - 1, [207, 234, 255, 140]);
  } else {
    const [x, y] = scr(0, 0, 0);
    p.set(x - 1, y, DROP);
    p.set(x + 1, y, DROP);
    p.set(x, y - 1, [207, 234, 255, 160]);
  }
}

/** Снег с корня: крупинки падают вниз, отставая. */
function snowOf(p: Px, scr: Scr, top: number, k: number): void {
  for (let i = 0; i < 6; i++) {
    const q = clamp01(k * 1.5 - i * 0.09);
    if (q <= 0 || q >= 1) continue;
    const [x, y] = scr((hash(i, 6, 41) - 0.5) * 7, (hash(i, 7, 41) - 0.5) * 6, top - q * q * 22);
    p.set(x, y, i % 2 ? SNOW[4] : WHITE);
  }
}

/** След падения: полосы инея над сосулькой. */
function streakOf(p: Px, scr: Scr, top: number, k: number): void {
  for (const [dy, a] of [
    [-1.2, 0.5],
    [0, 0.8],
    [1.2, 0.45],
  ] as const) {
    const [x, y0] = scr(0, dy, top + 1);
    const [, y1] = scr(0, dy, top + 1 + 13 * k);
    for (let y = Math.round(y1); y < Math.round(y0); y++) {
      const q = (y0 - y) / Math.max(1, y0 - y1);
      p.set(x, y, [STREAK[0], STREAK[1], STREAK[2], Math.round(255 * a * k * (1 - q))]);
    }
  }
}

/** Звезда трещин во льду вокруг острия. */
function starOf(p: Px, scr: Scr, k: number, hot: boolean): void {
  const [x, y] = scr(0, 0, 0);
  for (let a = 0; a < 7; a++) {
    const t = (a / 7) * TAU + 0.3 + hash(a, 8, 41) * 0.4;
    const R = 2 + (3 + hash(a, 9, 41) * 3) * k;
    for (let r = 2; r < R; r++)
      p.set(
        x + Math.cos(t) * r,
        y + Math.sin(t) * r * 0.55,
        hot && r < 4 ? CRACK : [CRACK2[0], CRACK2[1], CRACK2[2], hot ? 220 : 150],
      );
  }
}

/** Лужа талой воды у острия. */
function poolOf(p: Px, scr: Scr, k: number): void {
  const [cx, cy] = scr(0, 0, 0);
  const rx = 2 + k * 5;
  const ry = 1 + k * 2;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      const d = u * u + v * v;
      if (d <= 1 && !p.solid(x, y)) p.set(x, y, d > 0.6 ? POOL2 : POOL);
    }
}

/** Крошка от удара героя: брызги льда в стороны от середины. */
function chipsOf(p: Px, scr: Scr, z: number, k: number): void {
  for (let i = 0; i < 8; i++) {
    const a = hash(i, 10, 41) * TAU;
    const r = 2.5 + k * (4 + hash(i, 11, 41) * 4);
    const [x, y] = scr(Math.cos(a) * r, Math.sin(a) * r, z + Math.sin(k * PI) * 3 - k * k * 5);
    p.set(x, y, CHIP[i % CHIP.length]);
  }
}

// ---------------------------------------------------------------------------
// Дорожки.
// ---------------------------------------------------------------------------

function pose(anim: string, f: number): IciO {
  switch (anim) {
    case 'hang': {
      // 12 кадров по 8 к/с: блик бежит вниз (0–5), капля набухает (5–9),
      // срывается и падает (9–11).
      return {
        ...H0,
        glint: f < 6 ? f / 5 : -1,
        drop: f >= 5 ? (f - 5) / 6.6 : undefined,
      };
    }
    case 'crack': {
      // 0,8 с: трещит, сыплет снег, дрожит; в 0,35 отрыв — падает с
      // ускорением, растянута, со следом; кончик у льда — в 0,8.
      const t = tf(f);
      const u = clamp01((t - 0.35) / 0.45);
      const falling = t >= 0.35;
      return {
        ...H0,
        z: HZ * (1 - u * u),
        crack: Math.min(1, t / 0.3),
        clump: !falling,
        snow: t < 0.6 ? t / 0.6 : undefined,
        streak: falling ? Math.min(1, u * 2.2) : undefined,
        stretch: falling ? u : 0,
        chips: falling && u < 0.25 ? 0.2 + u * 3 : undefined,
      };
    }
    case 'hit': {
      // Кадр 0 — урон: ушла в лёд, осколки, звезда трещин.
      return {
        ...H0,
        z: 0,
        sink: 4,
        clump: false,
        shards: 0.12 + f * 0.17,
        star: Math.min(1, 0.5 + f * 0.25),
        hot: f < 3,
      };
    }
    case 'stk':
      // Торчит: блик пробегает раз за круг.
      return { ...H0, z: 0, sink: 4, clump: false, star: 1, glint: f < 5 ? f / 4 : -1 };
    case 'hurt':
      return {
        ...H0,
        z: 0,
        sink: 4,
        clump: false,
        star: 1,
        chips: 0.15 + f * 0.25,
      };
    case 'melt': {
      // 0,8 с: тоньше, капли бегут, лужа растёт.
      const k = (f + 1) / 8;
      return {
        ...H0,
        z: 0,
        sink: 4,
        clump: false,
        star: 1 - k * 0.6,
        melt: k,
        pool: k,
        glint: f % 4 === 0 ? 0.6 : -1,
        drop: 0.2 + (f % 3) * 0.15,
      };
    }
    case 'gone': {
      // Уход (`escape` 0,4 с): осыпается, тает в лужу.
      const k = (f + 1) / 10;
      return {
        ...H0,
        z: 0,
        sink: 4,
        clump: false,
        melt: 1,
        pool: 1,
        burst: k * 0.7,
      };
    }
    case 'die': {
      // Разбита: трещина, куски разлетаются и оседают.
      const k = tf(f) / 0.58;
      return {
        ...H0,
        z: 0,
        sink: 4,
        clump: false,
        star: 1,
        crack: 0,
        burst: sstep(0.05, 1, k),
        shards: k < 0.6 ? 0.1 + k * 1.4 : undefined,
      };
    }
  }
  return H0;
}

// ---------------------------------------------------------------------------
// Кадры и рисовальщик.
// ---------------------------------------------------------------------------

const N: Record<string, number> = {
  hang: 12,
  crack: 20,
  hit: 6,
  stk: 8,
  hurt: 4,
  melt: 8,
  gone: 10,
  die: 14,
};
const build = (anim: string, f: number) => iciBuild(pose(anim, f));
/** Качается, вонзившись (как нож): крен по кадрам после удара. */
const QUIVER = [0, 0.14, -0.1, 0.07, -0.045, 0.02];
const DIE = 0.6;

paintMob('f12_icicle', (m: Mob, p: MobPose): MobFrame => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const v = visOf(m, p, 0, 0);
  const tilt = (hash(m.id ?? 0, 33, 41) - 0.5) * 0.3;
  const ex: Partial<MobFrame> = { still: true, shadow: 3 };
  let anim = 'hang';
  let f = 0;
  if (mode === 'f12_crack') {
    anim = 'crack';
    f = fi(t, N.crack - 1);
    // Дрожит, пока трещит; падая — клонится к своему наклону.
    if (f >= 2 && f < 8) ex.dx = f % 2 ? 0.6 : -0.6;
    ex.rot = tilt * sstep(0.55, 0.8, t);
    ex.shadow = 2 + 4 * clamp01((t - 0.35) / 0.45) ** 2;
  } else if (mode === 'f12_stuck') {
    const ha = hurtAge(v, now);
    if (t < 0.25) {
      anim = 'hit';
      f = fi(t, 5);
      ex.rot = tilt + QUIVER[f];
      if (f === 0) {
        ex.sx = 1.12;
        ex.sy = 0.86;
      }
    } else if (ha >= 0 && ha < 4 / 24) {
      anim = 'hurt';
      f = Math.min(3, Math.floor(ha * 24));
      ex.rot = tilt + QUIVER[f + 1] * 0.7;
    } else if (t < 2.2) {
      anim = 'stk';
      f = idlePh(m, now, 6, 8);
      ex.rot = tilt;
    } else {
      anim = 'melt';
      f = Math.min(7, Math.floor((t - 2.2) / 0.1));
      ex.rot = tilt * (1 + 0.4 * clamp01((t - 2.2) / 0.8));
    }
  } else if (mode === 'escape') {
    anim = 'gone';
    f = fi(t, N.gone - 1);
    ex.rot = tilt * 1.4;
    ex.alpha = 1 - sstep(0.15, 0.4, t);
  } else if (mode === 'dying') {
    anim = 'die';
    f = fi(t, N.die - 1);
    ex.rot = tilt;
    ex.linger = DIE;
    ex.alpha = 1 - sstep(0.4, DIE, t);
  } else {
    // Висит (спрятана): чуть прозрачна — часть свода.
    f = idlePh(m, now, 8, 12);
    ex.alpha = 0.85;
    ex.shadow = 2;
  }
  const fr = frameOf(K, anim, f, 0, p, () => build(anim, f));
  return { ...fr, ...ex };
});

registerMobWarm('f12_icicle', () => warmAll(K, Object.entries(N), build));
