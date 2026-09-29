// Этаж 5, босс «Минотавр» — техники (v2.85): метки ударов, контакт, пыль,
// обломки, огонь разломов. Тело босса рисует `f5-art.ts`, здесь — всё, что
// бык делает с МИРОМ. Договор движка — библия §14.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) читается «куда» с
//     первого кадра и «когда» — фронт налива и тень секиры доходят до края
//     ровно в миг урона; последние 0,2 с — «тик-тик» и жёлтая кромка;
//   • контакт (`registerImpactPainter`) — трещины, пыль, камни с
//     гравитацией и отскоком, ударная волна; тряска — по силе удара;
//   • удары без своего strike (стена, колонна, рывок, занос, шаги, рёв
//     входа, смена фазы) — визуальные зоны `f5_fx*`, которые ставит мозг
//     (без урона и статусов, см. `fx()` в `f5-brains.ts`);
//   • всё светящееся (искры, огонь разломов, звёзды оглушения) — зоны с
//     `above`, поверх темноты; пыль, трещины, камни — на полу под мобами.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры (правило «Тряска» подземелья). Частицы детерминированы — позиция
// считается от зерна и возраста, а не копится по кадрам: лист кадров и игра
// рисуют одно и то же, и стоп-кадр держит позу сам.
import { Px } from '../dungeon-art';
import { paintSim, registerImpactPainter, registerZonePainter } from '../dungeon-paint';
import type { ImpactRec } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';

type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const hx = (h: string, a = 255): RGBA => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
};
/** Детерминированный шум по трём числам, 0…1. */
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const eIn2 = (t: number) => t * t;
const eOut2 = (t: number) => 1 - (1 - t) * (1 - t);
const eOut3 = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t);

/** Последние 0,2 с перед уроном — ясный сигнал «сейчас». */
const SIG = 0.2;
/** «Тик-тик»: две вспышки в последние 0,2 с (0,20…0,15 и 0,10…0,05). */
const tick = (left: number) => left < SIG && Math.floor(left / 0.05) % 2 === 1;

// ---- Палитра: песок арены, камень, кровь метки, огонь -----------------------

const C = {
  ink: '#150f0b',
  sandShade: '#5a4228',
  sandDk: '#8a6a42',
  sandHi: '#e2c48e',
  groove: '#2a1a10',
  deep: '#140604',
  redDk: '#5a0e0a',
  red: '#a01a12',
  redHot: '#e0301c',
  orange: '#ff7a2a',
  yellow: '#ffd860',
  white: '#fff4d0',
  shadow: '#1a0806',
  fire: ['#6a1a08', '#a8300c', '#ff6a1a', '#ffb030', '#fff0a0'],
  roar: '#fff0b0',
  roarDk: '#c8a860',
  wind: '#f4ecd8',
  star: '#fff27a',
};

/** Искра по доле жизни: белая → жёлтая → оранжевая → красная. */
const sparkCol = (k: number) =>
  k < 0.18 ? '#ffffff' : k < 0.42 ? C.fire[4] : k < 0.7 ? C.fire[3] : k < 0.88 ? C.fire[2] : C.fire[1];

let rmq: MediaQueryList | null | undefined;
/** Пользователь просил меньше движения: меньше частиц, без мигания. */
const reduced = () => {
  if (rmq === undefined)
    rmq =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
  return !!rmq?.matches;
};

// ---- Перо: пиксели на сетке мира -------------------------------------------

/**
 * Рисует в игровых пикселях, привязанных к сетке МИРА: `(px, py)` — где на
 * экране точка мира `(wx, wy)` (в пикселях мира). Сдвиг камеры дробный, но
 * кратен точке экрана; поправка `qx/qy` — остаток привязки движка, одна на
 * весь кадр, поэтому эффект стоит на полу, а не дрожит по нему.
 */
class Pen {
  readonly g: CanvasRenderingContext2D;
  readonly qx: number;
  readonly qy: number;
  constructor(g: CanvasRenderingContext2D, px: number, py: number, wx: number, wy: number) {
    this.g = g;
    const sc = g.getTransform().a || 1;
    this.qx = Math.round((px - wx) * sc) / sc;
    this.qy = Math.round((py - wy) * sc) / sc;
  }
  col(c: string, a = 1): void {
    this.g.fillStyle = c;
    this.g.globalAlpha = a < 0 ? 0 : a > 1 ? 1 : a;
  }
  dot(x: number, y: number, w = 1, h = 1): void {
    this.g.fillRect(Math.floor(x) + this.qx, Math.floor(y) + this.qy, w, h);
  }
  img(c: HTMLCanvasElement, x: number, y: number): void {
    this.g.drawImage(c, Math.floor(x) + this.qx, Math.floor(y) + this.qy);
  }
  /** Линия по пикселям (Брезенхэм), концы — точки мира. */
  line(x0: number, y0: number, x1: number, y1: number): void {
    let x = Math.floor(x0);
    let y = Math.floor(y0);
    const xe = Math.floor(x1);
    const ye = Math.floor(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 400; n++) {
      this.g.fillRect(x + this.qx, y + this.qy, 1, 1);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

// ---- Заливка сектора по строкам пикселей -----------------------------------

/**
 * Кольцевой сектор [r0, r1] × [a0, a1] строками пикселей (центр пикселя
 * внутри — пиксель наш). Угол больше четверти круга режется на куски с
 * ОБЩИМИ границами: пиксель на стыке достаётся ровно одному куску, и
 * полупрозрачная заливка не даёт шва.
 */
function fillSector(
  p: Pen,
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): void {
  if (r1 <= 0.5 || a1 <= a0) return;
  const full = a1 - a0 >= TAU - 1e-6;
  const n = full ? 1 : Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2)));
  const bx: number[] = [];
  const by: number[] = [];
  for (let j = 0; j <= n; j++) {
    const a = a0 + ((a1 - a0) * j) / n;
    bx.push(Math.cos(a));
    by.push(Math.sin(a));
  }
  const y0 = Math.floor(cy - r1);
  const y1 = Math.ceil(cy + r1);
  const g = p.g;
  for (let Y = y0; Y <= y1; Y++) {
    const yy = Y + 0.5 - cy;
    if (Math.abs(yy) >= r1) continue;
    const ho = Math.sqrt(r1 * r1 - yy * yy);
    const hi = Math.abs(yy) < r0 ? Math.sqrt(r0 * r0 - yy * yy) : 0;
    const segs: [number, number][] = hi > 0 ? [[-ho, -hi], [hi, ho]] : [[-ho, ho]];
    for (let j = 0; j < n; j++) {
      for (const [s0, s1] of segs) {
        let lo = s0;
        let up = s1;
        if (!full) {
          // cross(B_j, p) ≥ 0: p не раньше начала куска.
          const a = -by[j];
          const b = bx[j] * yy;
          if (a > 1e-9) lo = Math.max(lo, -b / a);
          else if (a < -1e-9) up = Math.min(up, -b / a);
          else if (b < 0) continue;
          // cross(B_{j+1}, p) < 0: p раньше конца куска.
          const a2 = by[j + 1];
          const b2 = -bx[j + 1] * yy;
          if (a2 > 1e-9) lo = Math.max(lo, -b2 / a2);
          else if (a2 < -1e-9) up = Math.min(up, -b2 / a2);
          else if (b2 <= 0) continue;
        }
        const xa = Math.ceil(cx + lo - 0.5);
        const xb = Math.floor(cx + up - 0.5);
        if (xb >= xa) g.fillRect(xa + p.qx, Y + p.qy, xb - xa + 1, 1);
      }
    }
  }
}

// ---- Окружности по пикселям (средняя точка), кеш по радиусу -----------------

interface CircPts {
  x: Int16Array;
  y: Int16Array;
  a: Float32Array;
}
const circles = new Map<number, CircPts>();
function circle(r: number): CircPts {
  const R = Math.max(1, Math.round(r));
  let c = circles.get(R);
  if (c) return c;
  const pts: [number, number][] = [];
  const seen = new Set<number>();
  const add = (x: number, y: number) => {
    const key = (x + 512) * 1024 + (y + 512);
    if (seen.has(key)) return;
    seen.add(key);
    pts.push([x, y]);
  };
  let x = R;
  let y = 0;
  let err = 1 - R;
  while (x >= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
      [-y, x],
      [-x, y],
      [-x, -y],
      [-y, -x],
      [y, -x],
      [x, -y],
    ])
      add(a, b);
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
  pts.sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
  c = {
    x: Int16Array.from(pts.map((p) => p[0])),
    y: Int16Array.from(pts.map((p) => p[1])),
    a: Float32Array.from(pts.map((p) => Math.atan2(p[1], p[0]))),
  };
  circles.set(R, c);
  return c;
}

/** Угол a в секторе [a0, a0 + span] (span > 0) с переходом через 2π. */
const inArc = (a: number, a0: number, span: number) => {
  const d = (((a - a0) % TAU) + TAU) % TAU;
  return d <= span;
};

/**
 * Кольцо по пикселям. `keep(a, i)` — оставить ли пиксель (пунктир, дуга,
 * «рваная» пыль); без него — целое.
 */
function ring(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  keep?: (a: number, i: number) => boolean,
): void {
  const c = circle(r);
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  for (let i = 0; i < c.x.length; i++) {
    if (keep && !keep(c.a[i], i)) continue;
    p.dot(ox + c.x[i], oy + c.y[i]);
  }
}

/** Повёрнутый овал по пикселям: вдоль (ux, uy) полуось `l`, поперёк — `w`. */
function lens(
  p: Pen,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  l: number,
  w: number,
  dither = false,
): void {
  const R = Math.ceil(Math.max(l, w)) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const dx = x0 + x + 0.5 - cx;
      const dy = y0 + y + 0.5 - cy;
      const a = (dx * ux + dy * uy) / l;
      const b = (-dx * uy + dy * ux) / w;
      if (a * a + b * b > 1) continue;
      if (dither && (x0 + x + y0 + y) & 1) continue;
      p.dot(x0 + x, y0 + y);
    }
}

// ---- Спрайты-заготовки: клубы пыли, камни, языки пламени --------------------

const sprites = new Map<number, HTMLCanvasElement>();
const sprite = (key: number, make: () => Px): HTMLCanvasElement => {
  let c = sprites.get(key);
  if (!c) {
    c = make().canvas();
    sprites.set(key, c);
  }
  return c;
};

/** Пыль: тень снизу-справа, основа, свет сверху-слева. */
const PUFF_PAL: [RGBA, RGBA, RGBA][] = [
  [hx('#a08058'), hx('#cdb082'), hx('#ecdcb4')], // 0 — песок арены
  [hx('#5e4c40'), hx('#8a7464'), hx('#b09a86')], // 1 — каменная крошка стены
  [hx('#302c2a'), hx('#4e4844'), hx('#766e68')], // 2 — дым угольков
  [hx('#b8a684'), hx('#e2d6bc'), hx('#fbf4e4')], // 3 — ветер, рёв
  [hx('#6a3a1c'), hx('#a0582a'), hx('#d88a44')], // 4 — жар разлома
];

/**
 * Клуб пыли радиуса r (1…16), вариант v (0…3): три доли, чтобы край был
 * рваным, а не циркульным. Свет сверху-слева, тень — у нижней кромки.
 */
function puffImg(pal: number, r: number, v: number): HTMLCanvasElement {
  const R = Math.max(1, Math.min(16, Math.round(r)));
  return sprite(10000 + pal * 1000 + R * 8 + (v & 3), () => {
    const s = 2 * R + 3;
    const p = new Px(s, s);
    const c = R + 1.5;
    const rot = (v & 3) * 1.57 + 0.4;
    const lobes: [number, number, number][] = [
      [0, 0, R],
      [Math.cos(rot) * R * 0.5, Math.sin(rot) * R * 0.32, R * 0.62],
      [Math.cos(rot + 2.4) * R * 0.52, Math.sin(rot + 2.4) * R * 0.3, R * 0.56],
    ];
    const inside = (x: number, y: number) =>
      lobes.some(([ox, oy, rr]) => (x + 0.5 - c - ox) ** 2 + (y + 0.5 - c - oy) ** 2 <= rr * rr);
    const [sh, mid, hi] = PUFF_PAL[pal];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (!inside(x, y)) continue;
        const l = ((x + 0.5 - c) * -0.55 + (y + 0.5 - c) * -0.83) / Math.max(1, R);
        const edge = !inside(x + 1, y + 1) || !inside(x, y + 1);
        p.set(x, y, edge && R > 1 ? sh : l > 0.28 ? hi : mid);
      }
    return p;
  });
}

const STONE_PAL: RGBA[][] = [
  [hx('#5a4228'), hx('#8a6a42'), hx('#b48e5c'), hx('#e2c48e')], // 0 — песчаник пола
  [hx('#3a2c24'), hx('#6a5444'), hx('#9a826a'), hx('#c4ac90')], // 1 — камень стены
  [hx('#4a3a30'), hx('#7a6454'), hx('#a48a74'), hx('#c8b098')], // 2 — колонна
  [hx('#5a1a10'), hx('#8a2a1a'), hx('#b04a2a'), hx('#c8a040')], // 3 — красная полоса колонны
];

/** Камень размера 1…3, поворот f (0…3): овал с объёмом и тёмным контуром. */
function stoneImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return sprite(20000 + pal * 100 + sz * 10 + (f & 3), () => {
    const s = sz * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rx = 0.55 + 0.55 * sz;
    const ry = 0.4 + 0.36 * sz;
    const a = (f & 3) * (Math.PI / 4);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const t = STONE_PAL[pal];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const u = (dx * ca + dy * sa) / rx;
        const w = (-dx * sa + dy * ca) / ry;
        if (u * u + w * w > 1) continue;
        const l = -dx * 0.6 - dy * 0.8;
        p.set(x, y, l > 0.6 ? t[3] : l > -0.2 ? t[2] : l > -0.9 ? t[1] : t[0]);
      }
    p.outline(hx(C.ink));
    return p;
  });
}

/** Язык пламени высоты h (3…12), кадр f (0…3); основание — низ по центру. */
function flameImg(h: number, f: number): HTMLCanvasElement {
  const H = Math.max(3, Math.min(12, Math.round(h)));
  return sprite(30000 + H * 8 + (f & 3), () => {
    const w = Math.max(3, Math.round(H * 0.5)) | 1;
    const p = new Px(w + 2, H + 1);
    const cx = (w + 2) / 2;
    const fire = C.fire.map((c) => hx(c));
    for (let y = 0; y < H; y++) {
      const t = y / Math.max(1, H - 1); // 0 — кончик, 1 — основание
      const half = (w / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95) * 0.5), 0.9);
      // Кончик качается сильнее основания: язык «пляшет».
      const sway = Math.round(Math.sin((f & 3) * 1.57 + t * 2.6) * (1 - t) * 1.3);
      for (let x = 0; x < w + 2; x++) {
        const d = Math.abs(x + 0.5 - cx - sway);
        if (d > half + 0.25) continue;
        const inner = half - d;
        const col =
          y === 0
            ? fire[1]
            : t > 0.45 && inner > 1.4
              ? fire[4]
              : inner > 0.7
                ? fire[3]
                : t < 0.3
                  ? fire[1]
                  : fire[2];
        p.set(x, y, col);
      }
    }
    return p;
  });
}

// ---- Частицы: позиция от зерна и возраста -----------------------------------

interface Fly {
  /** Пройдено по земле (доля пути при начальной скорости), высота, в воздухе ли. */
  h: number;
  z: number;
  air: boolean;
}
/**
 * Полёт камня: подброс `vz`, тяжесть `G`, отскоки с потерей энергии и
 * трением — всё по формуле, от возраста. `h` — путь по земле в секундах
 * начальной скорости (умножить на скорость — пиксели).
 */
function fly(t: number, vz: number, G: number, e = 0.34): Fly {
  let tt = t;
  let v = vz;
  let sp = 1;
  let h = 0;
  for (let b = 0; b < 3; b++) {
    const T = (2 * v) / G;
    if (tt < T) return { h: h + sp * tt, z: v * tt - (G * tt * tt) / 2, air: true };
    tt -= T;
    h += sp * T;
    v *= e;
    sp *= 0.45;
    if (v < 10) break;
  }
  // Лёг: чуть проскальзывает и замирает.
  const slide = Math.min(tt, 0.12);
  return { h: h + sp * (slide - (slide * slide) / 0.24), z: 0, air: false };
}

/** Путь с сопротивлением: скорость v гаснет с темпом k. */
const drag = (v: number, k: number, t: number) => (v / k) * (1 - Math.exp(-k * t));

/**
 * Камни веером: `n` штук из (x, y) в сторону `ang` ± `spread`, скорость
 * `v0…v0+dv`, подброс `vz0…vz0+dvz`. Тень под летящим, лёгший гаснет к `fade`.
 */
function stones(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  n: number,
  ang: number,
  spread: number,
  v0: number,
  dv: number,
  vz0: number,
  dvz: number,
  pal: number,
  fade: [number, number],
  big = 0.2,
): void {
  const a = 1 - k01((age - fade[0]) / (fade[1] - fade[0]));
  if (a <= 0) return;
  for (let i = 0; i < n; i++) {
    const r1 = hash(seed, i, 11);
    const r2 = hash(seed, i, 12);
    const r3 = hash(seed, i, 13);
    const r4 = hash(seed, i, 14);
    const th = ang + (r1 - 0.5) * 2 * spread;
    const v = v0 + dv * r2;
    const f = fly(age, vz0 + dvz * r3, 430);
    const gx = x + Math.cos(th) * v * f.h;
    const gy = y + Math.sin(th) * v * f.h;
    const sz = r4 < big ? 3 : r4 < 0.62 ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.35 * a);
      p.dot(gx - 1, gy + 1, sz > 1 ? 2 : 1, 1);
    }
    const spin = f.air ? Math.floor(age * (14 + r2 * 10) + i) & 3 : i & 3;
    const im = stoneImg(sz, spin, (pal === 2 && i % 4 === 0 ? 3 : pal) as number);
    p.col('#000', a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/**
 * Пыль клубами: `n` клубов из (x, y), направление `ang` ± `spread`, скорость
 * с сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`.
 * `t0` — задержка появления клуба i (доля от `stagger`).
 */
function dust(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  n: number,
  ang: number,
  spread: number,
  v0: number,
  dv: number,
  r0: number,
  r1: number,
  rise: number,
  life: number,
  pal = 0,
  alpha = 0.85,
  stagger = 0,
): void {
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 21);
    const h2 = hash(seed, i, 22);
    const h3 = hash(seed, i, 23);
    const t = age - stagger * hash(seed, i, 24);
    if (t < 0) continue;
    const L = life * (0.75 + 0.4 * h3);
    if (t >= L) continue;
    const k = t / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const d = drag(v0 + dv * h2, 3.2, t);
    const r = r0 + (r1 - r0) * (0.7 + 0.3 * h3) * eOut2(k01(t / (L * 0.7)));
    const z = rise * (0.6 + 0.4 * h2) * eOut2(k);
    const im = puffImg(pal, r, i);
    p.col('#000', alpha * Math.pow(1 - k, 1.3));
    p.img(im, x + Math.cos(th) * d - im.width / 2, y + Math.sin(th) * d - z - im.height / 2);
  }
}

/** Искры: головка и хвост 2–3 пикселя по скорости, цвет по доле жизни. */
function sparks(
  p: Pen,
  seed: number,
  age: number,
  x: number,
  y: number,
  n: number,
  ang: number,
  spread: number,
  v0: number,
  dv: number,
  life: number,
  up = 50,
): void {
  for (let i = 0; i < n; i++) {
    const h1 = hash(seed, i, 31);
    const h2 = hash(seed, i, 32);
    const h3 = hash(seed, i, 33);
    const L = life * (0.6 + 0.6 * h3);
    if (age >= L) continue;
    const k = age / L;
    const th = ang + (h1 - 0.5) * 2 * spread;
    const v = v0 + dv * h2;
    const vz = up * (0.4 + h3);
    const at = (t: number): [number, number] => {
      const d = drag(v, 2.2, t);
      const z = vz * t - 160 * t * t;
      return [x + Math.cos(th) * d, y + Math.sin(th) * d - z];
    };
    const [ax, ay] = at(age);
    const [bx, by] = at(Math.max(0, age - 0.035));
    p.col(sparkCol(k), 1 - k * 0.5);
    p.line(bx, by, ax, ay);
  }
}

// ---- Трещины: сеть от зерна, растёт от точки удара ---------------------------

interface Crack {
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  lx: Int16Array;
  ly: Int16Array;
  ld: Float32Array;
  /** Самая дальняя точка, пиксели пути. */
  max: number;
}
const cracks = new Map<string, Crack>();

/**
 * Сеть трещин из точки (0, 0): ветви `[угол, длина, ширина-у-корня]`,
 * извилистость `jag`, развилки с шансом `forkP`. Каждый пиксель знает путь
 * от корня — трещина «бежит», а не проявляется. Кромка — светлый пиксель
 * снизу-справа (свет сверху-слева), как высеченный жёлоб.
 */
function crackOf(key: string, seed: number, br: [number, number, number][], jag = 0.5, forkP = 0.22): Crack {
  let c = cracks.get(key);
  if (c) return c;
  const px = new Map<number, number>();
  const K = (x: number, y: number) => (x + 1024) * 4096 + (y + 1024);
  const put = (x: number, y: number, d: number) => {
    const k = K(x, y);
    const o = px.get(k);
    if (o === undefined || d < o) px.set(k, d);
  };
  const walk = (x0: number, y0: number, a0: number, len: number, d0: number, wid: number, id: number, depth: number) => {
    let x = x0;
    let y = y0;
    let a = a0;
    for (let s = 0, i = 0; s < len; s += 2, i++) {
      a += (hash(seed, id * 131 + i, 1) - 0.5) * jag * 2;
      a = a * 0.75 + a0 * 0.25;
      const nx = x + Math.cos(a) * 2;
      const ny = y + Math.sin(a) * 2;
      for (let q = 0; q <= 4; q++) {
        const qx = x + ((nx - x) * q) / 4;
        const qy = y + ((ny - y) * q) / 4;
        const d = d0 + s + q * 0.5;
        put(Math.floor(qx), Math.floor(qy), d);
        // У корня трещина шире: раскол, а не царапина.
        if (wid > 1 && s < len * 0.45) put(Math.floor(qx + Math.sin(a) * 0.9), Math.floor(qy - Math.cos(a) * 0.9), d);
        if (wid > 2 && s < len * 0.2) put(Math.floor(qx - Math.sin(a) * 0.9), Math.floor(qy + Math.cos(a) * 0.9), d);
      }
      x = nx;
      y = ny;
      if (depth < 1 && s > len * 0.25 && s < len * 0.8 && hash(seed, id * 17 + i, 2) < forkP) {
        const side = hash(seed, id * 19 + i, 3) < 0.5 ? -1 : 1;
        walk(x, y, a + side * (0.5 + 0.4 * hash(seed, id, 4)), (len - s) * 0.55, d0 + s, 1, id * 7 + i + 1, depth + 1);
      }
    }
  };
  br.forEach(([a, len, w], i) => walk(0.5, 0.5, a, len, 0, w, i + 1, 0));
  const pts = [...px.entries()].map(([k, d]) => [Math.floor(k / 4096) - 1024, (k % 4096) - 1024, d]);
  pts.sort((a, b) => a[2] - b[2]);
  const lips = pts.filter(([x, y]) => !px.has(K(x + 1, y + 1))).map(([x, y, d]) => [x + 1, y + 1, d]);
  c = {
    x: Int16Array.from(pts.map((p) => p[0])),
    y: Int16Array.from(pts.map((p) => p[1])),
    d: Float32Array.from(pts.map((p) => p[2])),
    lx: Int16Array.from(lips.map((p) => p[0])),
    ly: Int16Array.from(lips.map((p) => p[1])),
    ld: Float32Array.from(lips.map((p) => p[2])),
    max: pts.length ? pts[pts.length - 1][2] : 0,
  };
  if (cracks.size > 80) cracks.delete(cracks.keys().next().value as string);
  cracks.set(key, c);
  return c;
}

/** Трещина до пути `reach` (пиксели): жёлоб `core`, кромка `lip`. */
function drawCrack(
  p: Pen,
  c: Crack,
  x: number,
  y: number,
  reach: number,
  core: string,
  lip: string | null,
  a: number,
): void {
  if (a <= 0) return;
  const ox = Math.floor(x);
  const oy = Math.floor(y);
  if (lip) {
    p.col(lip, a * 0.85);
    for (let i = 0; i < c.lx.length && c.ld[i] <= reach; i++) p.dot(ox + c.lx[i], oy + c.ly[i]);
  }
  p.col(core, a);
  for (let i = 0; i < c.x.length && c.d[i] <= reach; i++) p.dot(ox + c.x[i], oy + c.y[i]);
}

/** Звезда трещин: n ветвей вокруг, длины lo…hi, первая — по углу a. */
const starBranches = (seed: number, n: number, a: number, lo: number, hi: number, w = 2): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [
    a + (i / n) * TAU + (hash(seed, i, 41) - 0.5) * (TAU / n) * 0.6,
    lo + (hi - lo) * hash(seed, i, 42),
    i % 2 ? 1 : w,
  ]);

// ---- Общее для зон ----------------------------------------------------------

/** Лишние поля визуальных зон мозга (`fx()` в f5-brains). */
type FxZone = Zone & { ang?: number; mid?: number; len?: number; v?: number; n?: number };

const mobOf = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);

/** Зерно от места: пол и огонь одного разлома рисуют одну трещину. */
const placeSeed = (x: number, y: number) => (Math.round(x * 64) * 7919 + Math.round(y * 64) * 104729) >>> 0;

/**
 * Обёртка рисовальщика: сохранить и вернуть контекст (зоны рисуются без
 * `save/restore` движка — прозрачность не должна утечь в соседей).
 */
function guarded<A extends unknown[]>(f: (g: CanvasRenderingContext2D, ...a: A) => void) {
  return (g: CanvasRenderingContext2D, ...a: A) => {
    g.save();
    try {
      f(g, ...a);
    } finally {
      g.restore();
    }
    return true;
  };
}

// =============================================================================
// СЕКИРА — конус r 3, дуга 2,3. Метка: налив от быка к кромке (ease-in —
// как разгон секиры), тень секиры у точки удара — большая и бледная, пока
// секира высоко, тёмная и чёткая к удару. Контакт: пол раскалывается от
// точки удара веером, пыль, камни с отскоком, волна по конусу.
// =============================================================================

/** Где секира входит в пол: 2,2 клетки по оси удара (там же встают разломы). */
const AXE_BITE = 2.2;

registerZonePainter(
  'f5_axe',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const k = k01(st.t / Math.max(0.01, st.warn));
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const a = st.ang ?? 0;
    const arc = st.arc ?? 2.3;
    const a0 = a - arc / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    // «Куда»: весь сектор с первого кадра.
    p.col(C.redDk, 0.2 + 0.08 * k);
    fillSector(p, cx, cy, 0, R, a0, a0 + arc);
    // «Когда»: налив от быка к кромке, фронт — яркая дуга.
    const rf = R * (0.12 + 0.88 * Math.pow(k, 1.6));
    p.col(sig ? C.redHot : C.red, (tk ? 0.5 : 0.24) + 0.14 * k);
    fillSector(p, cx, cy, 0, rf, a0, a0 + arc);
    p.col(sig ? C.yellow : C.orange, 0.55 + 0.4 * k);
    ring(p, cx, cy, rf, (ang) => inArc(ang, a0, arc));
    // Кромка: штрихи бегут от краёв к оси — удар сходится в точку.
    const run = time * (22 + 50 * k);
    p.col(sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot, 0.6 + 0.4 * k);
    ring(p, cx, cy, R, (ang) => {
      if (!inArc(ang, a0, arc)) return false;
      const u = Math.abs(ang - a) * R;
      return sig || (u + run) % 7 < 4.5;
    });
    for (const side of [-1, 1]) {
      const ea = a + (side * arc) / 2;
      const ex = Math.cos(ea);
      const ey = Math.sin(ea);
      for (let r = S * 0.9; r < R; r += 1) {
        if (!sig && (r - run) % 7 > 4) continue;
        p.dot(cx + ex * r, cy + ey * r);
      }
    }
    // Тень секиры: у точки удара, опускается — темнеет и сжимается.
    const drop = Math.pow(k, 1.8);
    const bx = cx + ux * S * (1.4 + (AXE_BITE - 1.4) * drop);
    const by = cy + uy * S * (1.4 + (AXE_BITE - 1.4) * drop);
    p.col(C.shadow, 0.14 + 0.5 * drop);
    lens(p, bx, by, -uy, ux, 10 - 4 * drop, 3.6 - 1.4 * drop, drop < 0.45);
    p.col(C.shadow, (0.14 + 0.5 * drop) * 0.7);
    p.line(bx, by, bx - ux * (9 - 3 * drop), by - uy * (9 - 3 * drop));
    // Песок дрожит под занесённой секирой, к удару — подскакивает.
    for (let i = 0; i < 14; i++) {
      const rr = R * (0.35 + 0.6 * hash(st.id, i, 5));
      const aa = a0 + arc * hash(st.id, i, 6);
      const hop = k > 0.35 ? Math.floor(hash(i, Math.floor(time * 16), st.id) * (1 + 2.5 * k)) : 0;
      p.col(C.sandHi, 0.5 + 0.4 * k);
      p.dot(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr - hop);
    }
    // Последние 0,2 с: волосяные трещины уже бегут из точки удара.
    if (sig) {
      const ck = crackOf(`axeTele|${st.id % 997}`, st.id, starBranches(st.id, 4, a, 6, 12, 1), 0.45, 0);
      drawCrack(p, ck, cx + ux * S * AXE_BITE, cy + uy * S * AXE_BITE, (1 - left / SIG) * 12, C.groove, null, 0.7);
    }
  }),
);

registerImpactPainter('f5_axe', {
  life: 1.7,
  shake: 0.32,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = rec.ang ?? 0;
    const arc = rec.arc ?? 2.3;
    const R = (rec.r ?? 3) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const bx = cx + ux * S * AXE_BITE;
    const by = cy + uy * S * AXE_BITE;
    const sd = rec.seed;
    const few = reduced();
    const fade = 1 - k01((age - 1.1) / 0.55);
    // Волна по всему конусу: удар накрыл весь сектор.
    if (age < 0.2) {
      const k = age / 0.2;
      const rw = R * (0.3 + 0.8 * eOut2(k));
      p.col(C.sandHi, 0.8 * (1 - k));
      ring(p, cx, cy, rw, (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 1, sd, 7) > 0.18);
      p.col(C.sandDk, 0.6 * (1 - k));
      ring(p, cx, cy, rw - 1, (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 1, sd, 8) > 0.3);
    }
    // Раскол пола веером от точки удара + короткие назад и вбок.
    const br: [number, number, number][] = [];
    for (let i = 0; i < 5; i++)
      br.push([a + (i / 4 - 0.5) * arc * 0.75 + (hash(sd, i, 1) - 0.5) * 0.3, S * (1.0 + 0.9 * hash(sd, i, 2)), i === 2 ? 3 : 2]);
    br.push([a + Math.PI / 2, S * (0.5 + 0.3 * hash(sd, 9, 2)), 1]);
    br.push([a - Math.PI / 2, S * (0.5 + 0.3 * hash(sd, 10, 2)), 1]);
    br.push([a + Math.PI, S * 0.35, 1]);
    const ck = crackOf(`axe|${sd}`, sd, br, 0.42, 0.3);
    drawCrack(p, ck, bx, by, ck.max * eOut3(k01(age / 0.16)), C.groove, C.sandHi, fade);
    // Прорубь от лезвия: тёмная, с отваленным песком по краям.
    p.col(C.deep, fade);
    lens(p, bx, by, -uy, ux, 6.5, 1.6);
    p.col(C.sandHi, 0.8 * fade);
    lens(p, bx + ux * 2.5, by + uy * 2.5, -uy, ux, 5, 0.9);
    // Кадр контакта: раскалённый отпечаток лезвия, пока держит стоп-кадр.
    if (age < 0.11) {
      p.col(age < 0.055 ? C.white : C.yellow, 1);
      lens(p, bx, by, -uy, ux, age < 0.055 ? 11 : 8, age < 0.055 ? 3 : 2);
    }
    // Ударная волна от точки удара — рваная, как пыль, а не циркуль.
    if (age < 0.26) {
      const k = age / 0.26;
      p.col(C.white, 0.9 * (1 - k));
      ring(p, bx, by, 4 + 30 * eOut2(k), (_ang, i) => hash(i >> 2, sd, 9) > 0.25);
    }
    // Песок брызгами (мелкие, быстрые) и камни (тяжёлые, с отскоком).
    for (let i = 0; i < (few ? 6 : 16); i++) {
      const th = a + (hash(sd, i, 51) - 0.5) * 2.6;
      const v = 50 + 45 * hash(sd, i, 52);
      const f = fly(age, 25 + 35 * hash(sd, i, 53), 430, 0);
      if (!f.air || f.h * v > 60) continue;
      p.col(hash(sd, i, 54) < 0.5 ? C.sandHi : '#cdb082', 0.95);
      p.dot(bx + Math.cos(th) * v * f.h, by + Math.sin(th) * v * f.h - f.z);
    }
    stones(p, sd, age, bx, by, few ? 5 : 11, a, 1.2, 26, 40, 55, 65, 0, [1.05, 1.6], 0.22);
    dust(p, sd, age, bx, by, few ? 4 : 9, a, 1.25, 22, 30, 2, 9, 5, 1.05, 0, 0.85);
    dust(p, sd + 1, age, bx, by, few ? 1 : 3, a + Math.PI, 0.7, 10, 12, 2, 6, 3, 0.8, 0, 0.7);
  }),
});

// =============================================================================
// ВИХРЬ — круг r 3,1. Метка: «часы» — сектор заметает круг от того места,
// где висит секира, и замыкается ровно в миг урона; фронт — тень лезвия со
// смазом. Ветер крутит песок всё быстрее. Контакт: кольцо ветра и пыли
// разлетается по спирали, пол прочерчен лезвием.
// =============================================================================

/** Куда крутит: по часовой, если смотрит вправо (как кадры вихря в f5-art). */
function spinOf(from: number | undefined, fallback = 1): { a0: number; dir: number } {
  const m = mobOf(from) ?? paintSim()?.mobs.find((q) => q.kind === 'f5_minotaur');
  const right = m ? Math.cos(m.face) >= 0 : fallback > 0;
  return { a0: right ? 0 : Math.PI, dir: right ? 1 : -1 };
}

registerZonePainter(
  'f5_whirl',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const st = z as Strike;
    const w = Math.max(0.01, st.warn);
    const k = k01(st.t / w);
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    const { a0, dir } = spinOf(st.from);
    // Угол ветра — интеграл скорости, которая растёт как k²: разгон.
    const tt = st.t;
    const spin = dir * (1.4 * tt + (10 * tt * tt * tt) / (3 * w * w));
    p.col(C.redDk, 0.16 + 0.06 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    // Заметённое лезвием — налито.
    const sw = TAU * Math.pow(k, 1.7);
    const lo = dir > 0 ? a0 : a0 - sw;
    p.col(sig ? C.redHot : C.red, (tk ? 0.5 : 0.24) + 0.1 * k);
    fillSector(p, cx, cy, 0, R, lo, lo + sw);
    // Фронт — тень лезвия и смаз за ней.
    const aL = a0 + dir * sw;
    for (let j = 0; j < 3; j++) {
      const s0 = dir > 0 ? aL - (j + 1) * 0.13 : aL + j * 0.13;
      p.col(C.shadow, (0.3 - j * 0.09) * (0.5 + 0.5 * k));
      fillSector(p, cx, cy, S * 1.3, S * 2.9, s0, s0 + 0.13);
    }
    p.col(C.shadow, 0.35 + 0.45 * k);
    lens(p, cx + Math.cos(aL) * S * 2.2, cy + Math.sin(aL) * S * 2.2, -Math.sin(aL), Math.cos(aL), 8, 2.6);
    // Кромка — пунктир, крутится с ветром.
    p.col(sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot, 0.6 + 0.4 * k);
    ring(p, cx, cy, R, (ang) => sig || (((ang - spin) % 0.5) + 0.5) % 0.5 < 0.3);
    // Струи ветра — дуги, крутятся и ускоряются.
    p.col(C.wind, 0.3 + 0.45 * k);
    for (let i = 0; i < 4; i++) {
      const rr = R * (0.42 + 0.16 * i);
      const s = spin * (1.5 - i * 0.15) + (i * TAU) / 4;
      const len = 0.45 + 0.5 * k;
      ring(p, cx, cy, rr, (ang) => inArc(ang, dir > 0 ? s - len : s, len));
    }
    // Песчинки по кругу, чем ближе — тем быстрее, к удару отходят наружу.
    p.col(C.sandHi, 0.55 + 0.4 * k);
    for (let i = 0; i < 16; i++) {
      const r0 = R * (0.3 + 0.62 * hash(st.id, i, 3));
      const rr = r0 + R * 0.08 * k;
      const aa = hash(st.id, i, 4) * TAU + spin * (1.8 - (r0 / R) * 0.9);
      p.dot(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr - (k > 0.5 ? (i & 1) : 0));
    }
  }),
);

/** Кеш стороны вращения на запись контакта: бык за миг может повернуться. */
const spinDir = new WeakMap<ImpactRec, number>();

registerImpactPainter('f5_whirl', {
  life: 1.35,
  shake: 0.3,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.1) * S;
    const sd = rec.seed;
    const few = reduced();
    let dir = spinDir.get(rec);
    if (dir === undefined) {
      dir = spinOf(undefined).dir;
      spinDir.set(rec, dir);
    }
    const fade = 1 - k01((age - 0.9) / 0.45);
    // Борозда лезвия по кругу — рваная дуга, с кромкой.
    const gr = S * 2.2;
    p.col(C.sandHi, 0.8 * fade);
    ring(p, cx + 1, cy + 1, gr, (_a, i) => hash(i >> 2, sd, 3) > 0.3);
    p.col(C.groove, 0.9 * fade);
    ring(p, cx, cy, gr, (_a, i) => hash(i >> 2, sd, 3) > 0.3);
    // Ударная волна.
    if (age < 0.28) {
      const k = age / 0.28;
      p.col(C.wind, 0.85 * (1 - k));
      ring(p, cx, cy, R * (0.55 + 0.65 * eOut2(k)), (_a, i) => hash(i >> 1, sd, 4) > 0.2);
    }
    // Кольцо ветра: дуги по касательной, крутятся и уходят наружу.
    if (age < 0.6) {
      const k = age / 0.6;
      p.col(C.wind, 0.8 * (1 - k));
      for (let i = 0; i < 6; i++) {
        const rr = R * (0.6 + 0.55 * eOut2(k) + 0.06 * (i % 3));
        const s = dir * (age * 9 + (i * TAU) / 6);
        ring(p, cx, cy, rr, (ang) => inArc(ang, dir > 0 ? s - 0.5 : s, 0.5));
      }
    }
    // Пыль спиралью: наружу и по ходу вращения.
    const n = few ? 6 : 16;
    for (let i = 0; i < n; i++) {
      const phi = (i / n) * TAU + hash(sd, i, 5) * 0.4;
      const r0 = R * (0.7 + 0.15 * hash(sd, i, 6));
      const vr = 16 + 16 * hash(sd, i, 7);
      const vt = 26 + 12 * hash(sd, i, 8);
      const L = 0.95 + 0.4 * hash(sd, i, 9);
      if (age >= L) continue;
      const k = age / L;
      const dr = drag(vr, 2.6, age);
      const dt = drag(vt, 2.6, age) / (r0 + dr);
      const ang = phi + dir * dt;
      const im = puffImg(0, 3 + 6 * eOut2(k01(age / 0.7)) * (0.7 + 0.3 * hash(sd, i, 10)), i);
      p.col('#000', 0.8 * Math.pow(1 - k, 1.3));
      p.img(im, cx + Math.cos(ang) * (r0 + dr) - im.width / 2, cy + Math.sin(ang) * (r0 + dr) - 3 * eOut2(k) - im.height / 2);
    }
    // Камни — по касательной: их отбросило лезвие.
    for (let i = 0; i < (few ? 4 : 10); i++) {
      const phi = hash(sd, i, 61) * TAU;
      stones(p, sd * 31 + i, age, cx + Math.cos(phi) * gr, cy + Math.sin(phi) * gr, 1, phi + dir * 1.2, 0.35, 25, 35, 45, 55, 0, [0.95, 1.35], 0.25);
    }
  }),
});

// =============================================================================
// РЁВ — круг r 4,6, оглушение. Метка: бык ВДЫХАЕТ — кольцо сходится к нему,
// пыль струями тянется внутрь, быстрее к удару. Контакт (поверх темноты:
// волна идёт по воздуху): три кольца пыли расходятся, у оглушённого героя
// над головой звёзды, пока держит оглушение. Трещины пола — зона мозга
// `f5_fxquake`.
// =============================================================================

registerZonePainter(
  'f5_roar',
  guarded((g, z: Zone | Strike, px: number, py: number, S: number) => {
    const st = z as Strike;
    const w = Math.max(0.01, st.warn);
    const k = k01(st.t / w);
    const left = st.warn - st.t;
    const cx = st.x * S;
    const cy = st.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = st.r * S;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    p.col(C.roar, (tk ? 0.2 : 0.07) + 0.06 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    // Кромка двойная: светлая и тёмная внутри — читается на песке.
    p.col(C.roarDk, 0.55 + 0.35 * k);
    ring(p, cx, cy, R - 1);
    p.col(sig ? (tk ? '#ffffff' : C.yellow) : C.roar, 0.6 + 0.4 * k);
    ring(p, cx, cy, R, (_a, i) => sig || (i + Math.floor(st.t * 30)) % 9 < 6);
    // Кольцо вдоха сходится к быку — дошло до него, значит, рёв.
    for (const lag of [0, 0.12]) {
      const kk = k01(k - lag);
      const rr = S * 0.95 + (R - S * 0.95) * (1 - Math.pow(kk, 1.5));
      p.col(C.roarDk, (0.45 + 0.4 * kk) * (lag ? 0.6 : 1));
      ring(p, cx, cy, rr + 1);
      p.col(C.roar, (0.55 + 0.45 * kk) * (lag ? 0.6 : 1));
      ring(p, cx, cy, rr);
    }
    // Струи пыли тянутся внутрь; разгон — интеграл скорости 0,5 + 2,5·k².
    const tt = st.t;
    const run = 0.45 * tt + (2.5 * tt * tt * tt) / (3 * w * w);
    for (let i = 0; i < 22; i++) {
      const phi = hash(st.id, i, 1) * TAU;
      const u = (hash(st.id, i, 2) + run * (0.8 + 0.4 * hash(st.id, i, 3))) % 1;
      const rr = R * (1 - u) + S * 0.8 * u;
      const len = 2 + Math.round(4 * k);
      p.col(C.roar, 0.3 + 0.55 * u);
      p.line(cx + Math.cos(phi) * rr, cy + Math.sin(phi) * rr, cx + Math.cos(phi) * (rr + len), cy + Math.sin(phi) * (rr + len));
    }
  }),
);

registerImpactPainter('f5_roar', {
  life: 1.3,
  shake: 0.25,
  flash: 0.3,
  flashRgb: '255,236,170',
  above: true,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number, time: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 4.6) * S;
    const sd = rec.seed;
    // Три кольца пыли по воздуху — рваные, у каждого своя «рвань».
    for (let j = 0; j < 3; j++) {
      const t = age - [0, 0.09, 0.2][j];
      if (t < 0 || t > 0.46) continue;
      const k = t / 0.46;
      const rr = S + (R * 1.12 - S) * eOut2(k);
      const a = (1 - k) * (j === 0 ? 0.95 : 0.7);
      p.col('#e2d6bc', a);
      ring(p, cx, cy, rr - 1, (_a, i) => hash(i >> 2, sd + j, 5) > 0.15);
      p.col(j === 0 ? '#ffffff' : C.roar, a);
      ring(p, cx, cy, rr, (_a, i) => hash(i >> 2, sd + j, 5) > 0.15);
      p.col(C.roarDk, a * 0.7);
      ring(p, cx, cy, rr - 2, (_a, i) => hash(i >> 1, sd + j, 6) > 0.5);
      // Штрихи ветра за первым кольцом.
      if (j === 0)
        for (let i = 0; i < 16; i++) {
          const phi = (i / 16) * TAU + hash(sd, i, 7) * 0.3;
          p.col(C.wind, a * 0.8);
          const r1 = rr - 4 - 3 * hash(sd, i, 8);
          p.line(cx + Math.cos(phi) * r1, cy + Math.sin(phi) * r1, cx + Math.cos(phi) * (r1 - 5), cy + Math.sin(phi) * (r1 - 5));
        }
    }
    // Оглушённый герой: звёзды кружат над головой, пока держит оглушение.
    const h = paintSim()?.hero;
    const stun = h?.status?.stun;
    if (h && stun && stun.t > 0) {
      const hx0 = h.x * S;
      const hy0 = h.y * S - 20;
      for (let i = 0; i < 3; i++) {
        const an = time * 7 + (i * TAU) / 3;
        const front = Math.sin(an) > 0;
        const sx = hx0 + Math.cos(an) * 7;
        const sy = hy0 + Math.sin(an) * 2.5;
        p.col(front ? C.star : '#b89a40', front ? 1 : 0.7);
        p.dot(sx - 1, sy, 3, 1);
        p.dot(sx, sy - 1, 1, 3);
        if (front) {
          p.col('#ffffff', 1);
          p.dot(sx, sy);
        }
      }
      // Удар по ушам: кольцо у головы в первые мгновения.
      if (age < 0.3) {
        p.col('#ffffff', 0.8 * (1 - age / 0.3));
        ring(p, hx0, hy0 + 8, 4 + 10 * eOut2(age / 0.3), (_a, i) => i % 3 !== 0);
      }
    }
  }),
});

// =============================================================================
// РАЗЛОМ (фаза ≥ 1): трещина раскрывается от середины к концам, пол вокруг
// обгорает; огонь (`f5_fxfire`, поверх темноты) пляшет языками, летят
// угольки; к концу пламя опадает, трещина тлеет угольками и дымит.
// =============================================================================

/** Трещина разлома: поперёк удара, от середины в обе стороны. */
function riftCrack(z: FxZone, S: number): Crack {
  const sd = placeSeed(z.x, z.y);
  const a = (z.ang ?? 0) + Math.PI / 2;
  const L = z.r * S * 1.25;
  return crackOf(`rift|${sd}`, sd, [
    [a, L, 3],
    [a + Math.PI, L * (0.8 + 0.3 * hash(sd, 1, 1)), 3],
  ], 0.55, 0.35);
}

registerZonePainter(
  'f5_rift',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const warn = z.warn ?? 0;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const ck = riftCrack(z, S);
    const open = k01(z.t / Math.max(0.01, warn));
    const fade = k01((warn + z.life - z.t) / 0.9);
    const on = z.t >= warn;
    // Обгоревший песок вокруг — шире, пока горит.
    if (on) {
      p.col('#3a1a0c', 0.28 * fade);
      fillSector(p, cx, cy, 0, z.r * S * 1.05, 0, TAU);
    }
    const reach = ck.max * eOut2(open);
    // Раскрытие: сначала тонкая трещина, потом жёлоб — тёмное нутро.
    drawCrack(p, ck, cx, cy, reach, on ? '#2a0804' : C.groove, C.sandHi, fade);
    if (on) {
      p.col(C.deep, fade);
      const ox = Math.floor(cx);
      const oy = Math.floor(cy);
      for (let i = 0; i < ck.x.length && ck.d[i] < ck.max * 0.7; i += 2) p.dot(ox + ck.x[i], oy + ck.y[i]);
    }
    // Песок осыпается в трещину, пока она раскрывается.
    if (!on) dust(p, z.id, z.t, cx, cy, 3, (z.ang ?? 0) + Math.PI / 2, Math.PI, 8, 10, 1, 4, 3, 0.5, 0, 0.7);
  }),
);

registerZonePainter(
  'f5_fxfire',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as FxZone;
    const warn = z.warn ?? 0;
    const t = z.t - warn;
    if (t < 0) return;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const ck = riftCrack(z, S);
    const endIn = z.life - t;
    // Огонь: вспыхнул за 0,25 с, горит, за 1,8 с до конца опадает.
    const env = Math.min(eOut2(k01(t / 0.25)), k01((endIn - 0.4) / 1.4));
    const ember = k01(endIn / 0.9);
    const ox = Math.floor(cx);
    const oy = Math.floor(cy);
    const sd = placeSeed(z.x, z.y);
    // Жар в трещине: светящаяся жила, переливается.
    for (let i = 0; i < ck.x.length; i += 1) {
      if (ck.d[i] > ck.max * 0.8) continue;
      const w = 0.5 + 0.5 * Math.sin(time * 5 + ck.d[i] * 0.35 + (i & 3));
      const hot = env * (0.6 + 0.4 * w);
      const cold = (1 - env) * ember * (w > 0.55 ? 1 : 0.35);
      if (hot > 0.05) {
        p.col(hot > 0.75 ? C.fire[3] : C.fire[2], Math.min(1, hot * 1.2));
        p.dot(ox + ck.x[i], oy + ck.y[i]);
      } else if (cold > 0.05) {
        // Угольки: гаснет — тлеют отдельные точки.
        p.col(C.fire[1], cold);
        if ((i + Math.floor(time * 3)) % 3 === 0) p.dot(ox + ck.x[i], oy + ck.y[i]);
      }
    }
    // Языки пламени вдоль трещины.
    const n = 6;
    for (let i = 0; i < n && env > 0.02; i++) {
      const j = Math.floor(((i + 0.5) / n) * ck.x.length * 0.8);
      const fx = ox + ck.x[j];
      const fy = oy + ck.y[j];
      const base = 5 + 4 * hash(sd, i, 1);
      const h = base * env * (0.78 + 0.22 * Math.sin(time * 9 + i * 1.9));
      if (h < 2.5) continue;
      const im = flameImg(h, Math.floor(time * 12 + i * 2.3));
      p.col('#000', 1);
      p.img(im, fx - im.width / 2 + 0.5, fy - im.height + 1);
    }
    // Угольки поднимаются и гаснут; к концу — дым.
    for (let i = 0; i < 7; i++) {
      const P = 0.7 + 0.35 * hash(sd, i, 2);
      const ph = (t + hash(sd, i, 3) * P) / P;
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      const j = Math.floor(hash(sd, i * 13 + cyc, 4) * ck.x.length * 0.8);
      const ex = ox + ck.x[j] + Math.sin(u * 5 + i) * 2;
      const ey = oy + ck.y[j] - u * (12 + 6 * hash(sd, i, 5));
      const live = Math.max(env, ember * 0.6);
      if (live < 0.05) continue;
      p.col(sparkCol(0.3 + 0.7 * u), (1 - u) * live);
      p.dot(ex, ey);
    }
    if (env < 0.7 && endIn > 0.1) {
      const smoke = (1 - env) * ember;
      for (let i = 0; i < 3; i++) {
        const u = (t * 0.8 + i / 3) % 1;
        const j = Math.floor(((i + 0.5) / 3) * ck.x.length * 0.8);
        const im = puffImg(2, 2 + 3 * u, i);
        p.col('#000', smoke * 0.55 * (1 - u));
        p.img(im, ox + ck.x[j] - im.width / 2 + Math.sin(u * 4 + i) * 2, oy + ck.y[j] - 4 - u * 12 - im.height / 2);
      }
    }
  }),
);

// =============================================================================
// РЫВОК: прицел (`f5_fxlane`) — стрелки бегут по полосе, пока бык водит
// рогами — тускло; замер — «щелчок» по полосе и стрелки горят; последние
// 0,28 с (окно уклона) — жёлтые. На конце — куда врежется (звезда трещин у
// стены) или где его занесёт (стоп-черта). Копыто роет песок.
// Бег (`f5_fxdust`) — клубы пыли за копытами, 10 в секунду. Занос
// (`f5_fxskid`) — две борозды, песок веером, искры с подков. Стена
// (`f5_fxwall`) — трещины в кладке, обломки назад, пыль по стене, песок
// сыплется сверху; колонна — обломки вперёд и уголья факела.
// =============================================================================

registerZonePainter(
  'f5_fxlane',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as FxZone;
    const m = mobOf(z.mid);
    if (!m || m.mode !== 'aim') return;
    const p = new Pen(g, px, py, z.x * S, z.y * S);
    const haste = m.data.haste ?? 1;
    const T = (m.data.next ? 0.62 : 0.95) / haste;
    const t = m.t;
    const k = k01(t / T);
    const left = T - t;
    const lock = t >= T * 0.55;
    const danger = left < 0.28;
    const ux = Math.cos(m.dir);
    const uy = Math.sin(m.dir);
    const nx = -uy;
    const ny = ux;
    const mx = m.x * S;
    const my = m.y * S;
    const L = ((m.data.len ?? 9) + m.r * 0.5) * S;
    const W = m.r * 0.9 * S;
    const r0 = m.r * S;
    const blink = danger && !reduced() && Math.floor(left / 0.07) % 2 === 0;
    // Кромки полосы: пунктир бежит вперёд.
    const run = time * (lock ? 70 : 26);
    p.col(danger ? (blink ? C.white : C.yellow) : lock ? C.orange : C.redHot, danger ? 1 : lock ? 0.8 : 0.45);
    for (const s of [-1, 1])
      for (let u = r0; u < L; u += 1) {
        if (!danger && (u - run) % 8 > 5) continue;
        p.dot(mx + ux * u + nx * W * s, my + uy * u + ny * W * s);
      }
    // Стрелки-«галочки» по полосе.
    const gap = 15;
    const off = (time * (lock ? 60 : 18)) % gap;
    for (let u = r0 + 6 + off; u < L - 5; u += gap) {
      const bright = danger ? 1 : lock ? 0.75 : 0.32;
      p.col(danger ? (blink ? C.white : C.yellow) : lock ? C.orange : C.redHot, bright * k01((L - 5 - u) / 10));
      const tx = mx + ux * u;
      const ty = my + uy * u;
      for (const s of [-1, 1]) {
        const ax = -ux * 0.62 + nx * s * 0.78;
        const ay = -uy * 0.62 + ny * s * 0.78;
        p.line(tx, ty, tx + ax * 6, ty + ay * 6);
      }
    }
    // Щелчок замера: вспышка бежит по полосе от быка к концу.
    const lt = t - T * 0.55;
    if (lt >= 0 && lt < 0.14) {
      const u = r0 + (L - r0) * (lt / 0.14);
      p.col(C.white, 0.9);
      p.line(mx + ux * u + nx * W, my + uy * u + ny * W, mx + ux * u - nx * W, my + uy * u - ny * W);
    }
    // Конец полосы: стена — звезда трещин; нет стены — стоп-черта.
    const ex = mx + ux * L;
    const ey = my + uy * L;
    if (m.data.wall) {
      const pulse = 0.5 + 0.5 * Math.sin(time * (lock ? 16 : 7));
      p.col(danger ? C.yellow : C.orange, 0.5 + 0.5 * pulse * (lock ? 1 : 0.5));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const r1 = 2 + (i & 1 ? 3 : 5) + (lock ? pulse * 2 : 0);
        p.line(ex + Math.cos(a) * 2, ey + Math.sin(a) * 2, ex + Math.cos(a) * r1, ey + Math.sin(a) * r1);
      }
    } else {
      p.col(danger ? C.yellow : C.orange, lock ? 0.85 : 0.4);
      for (let s = -W; s <= W; s += 1) if ((s + 20) % 4 < 2.5) p.dot(ex + nx * s, ey + ny * s);
    }
    // Копыто роет: раз в 0,22 с песок из-под заднего копыта назад.
    const hx0 = mx - ux * S * 0.35 + nx * 3;
    const hy0 = my - uy * S * 0.35 + ny * 3 + 1;
    for (let i = 0; i < 8; i++) {
      const at = 0.06 + i * 0.22;
      const a = t - at;
      if (a < 0 || a > 0.55) continue;
      const sd = z.id * 17 + i;
      dust(p, sd, a, hx0, hy0, 2, m.dir + Math.PI, 0.6, 14, 10, 1, 4, 3, 0.55, 0, 0.75);
      for (let j = 0; j < 3; j++) {
        const f = fly(a, 30 + 20 * hash(sd, j, 1), 430, 0);
        if (!f.air) continue;
        const th = m.dir + Math.PI + (hash(sd, j, 2) - 0.5) * 1.2;
        const v = 30 + 20 * hash(sd, j, 3);
        p.col(C.sandHi, 0.95);
        p.dot(hx0 + Math.cos(th) * v * f.h, hy0 + Math.sin(th) * v * f.h - f.z);
      }
    }
  }),
);

registerZonePainter(
  'f5_fxdust',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = z.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const len = (z.len ?? 1.1) * S;
    const t = z.t;
    const sd = z.id;
    // Следы копыт: разлетевшийся песок, тает.
    const mark = 1 - k01((t - 0.35) / 0.55);
    for (let i = 0; i < 2; i++) {
      const b = len * (0.25 + 0.5 * i);
      const s = i ? -3 : 3;
      p.col(C.sandDk, 0.7 * mark);
      p.dot(cx - ux * b - uy * s - 1, cy - uy * b + ux * s, 3, 1);
      p.col(C.sandShade, 0.6 * mark);
      p.dot(cx - ux * b - uy * s, cy - uy * b + ux * s + 1, 1, 1);
    }
    // Клубы: по полосе пройденного за 0,1 с, сносит назад и вбок.
    for (let i = 0; i < 3; i++) {
      const b = len * (i / 3);
      const side = (i % 2 ? 1 : -1) * (2 + 3 * hash(sd, i, 1));
      dust(p, sd * 7 + i, t, cx - ux * b - uy * side, cy - uy * b + ux * side + 1, 1, a + Math.PI + (i % 2 ? 0.6 : -0.6), 0.35, 8, 10, 2, 7, 5, 0.85, 0, 0.8);
    }
    // Песчинки из-под копыт.
    for (let i = 0; i < 4; i++) {
      const f = fly(t, 35 + 25 * hash(sd, i, 5), 430, 0);
      if (!f.air) continue;
      const th = a + Math.PI + (hash(sd, i, 6) - 0.5) * 1.4;
      const v = 35 + 25 * hash(sd, i, 7);
      p.col(C.sandHi, 0.95);
      p.dot(cx + Math.cos(th) * v * f.h, cy + Math.sin(th) * v * f.h - f.z);
    }
  }),
);

/** Занос: сколько проехал (клеток) — вживую по быку, иначе по формуле. */
const skidLen = new Map<number, number>();

registerZonePainter(
  'f5_fxskid',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = z.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const t = z.t;
    const sd = z.id;
    const v = z.v ?? 11;
    // Скорость гаснет ×0,86 за шаг 1/60 с — путь по формуле.
    const D = ((v / 60) * 0.86) / 0.14;
    const at = (tt: number) => D * (1 - Math.pow(0.86, 60 * Math.max(0, tt)));
    let d = at(t);
    const m = mobOf(z.mid);
    if (m && m.mode === 'skid') {
      d = Math.max(0, (m.x - z.x) * ux + (m.y - z.y) * uy);
      skidLen.set(z.id, d);
    } else if (skidLen.has(z.id)) d = skidLen.get(z.id)!;
    if (skidLen.size > 40) skidLen.delete(skidLen.keys().next().value as number);
    const fade = k01((z.life - t) / 0.6);
    const L = d * S;
    // Борозды от копыт: жёлоб с кромкой и валик песка впереди.
    for (const s of [-4, 3]) {
      const x0 = cx - uy * s;
      const y0 = cy + ux * s;
      p.col(C.sandHi, 0.8 * fade);
      p.line(x0 + 1 - uy, y0 + 1 + ux, x0 + ux * L + 1, y0 + uy * L + 1);
      p.col(C.groove, 0.85 * fade);
      p.line(x0, y0, x0 + ux * L, y0 + uy * L);
      const im = puffImg(0, 1 + Math.min(2, L / 8), 1);
      p.col('#000', fade);
      p.img(im, x0 + ux * (L + 2) - im.width / 2, y0 + uy * (L + 2) - im.height / 2);
    }
    // Песок веером вперёд-вбок и искры с подков, пока скорость велика.
    for (let i = 0; i < 12; i++) {
      const ti = i * 0.03;
      const age = t - ti;
      if (age < 0 || age > 0.45) continue;
      const side = i % 2 ? 1 : -1;
      const fx0 = cx + ux * at(ti) * S - uy * side * 4;
      const fy0 = cy + uy * at(ti) * S + ux * side * 4;
      const th = a + side * (0.5 + 0.6 * hash(sd, i, 1));
      const f = fly(age, 28 + 22 * hash(sd, i, 2), 430, 0);
      if (f.air) {
        const vv = 40 + 30 * hash(sd, i, 3);
        p.col(hash(sd, i, 4) < 0.5 ? C.sandHi : '#cdb082', 0.95);
        p.dot(fx0 + Math.cos(th) * vv * f.h, fy0 + Math.sin(th) * vv * f.h - f.z);
        p.dot(fx0 + Math.cos(th + 0.2) * vv * 0.8 * f.h, fy0 + Math.sin(th + 0.2) * vv * 0.8 * f.h - f.z * 0.9);
      }
      if (i < 8) sparks(p, sd * 5 + i, age, fx0, fy0 - 1, 1, a + side * 0.3, 0.5, 60, 40, 0.22, 60);
    }
    // Пыль догоняет и накрывает, когда бык встал.
    dust(p, sd, t - 0.08, cx + ux * L, cy + uy * L, 4, a, 0.9, 14, 12, 3, 9, 5, 1.1, 0, 0.8, 0.2);
  }),
);

registerZonePainter(
  'f5_fxwall',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const a = z.ang ?? 0;
    const t = z.t;
    const sd = z.id;
    const pillar = (z.n ?? 0) > 0;
    const few = reduced();
    const fade = k01((z.life - t) / 0.7);
    if (!pillar) {
      // Кладка треснула звездой от места удара, в середине — выбоина.
      const ck = crackOf(`wall|${sd}`, sd, starBranches(sd, 6, a + Math.PI, 7, 14, 2), 0.5, 0.3);
      drawCrack(p, ck, cx, cy, ck.max * eOut3(k01(t / 0.09)), C.deep, '#b09a86', fade);
      p.col(C.deep, fade);
      lens(p, cx, cy, 1, 0, 3, 2);
      // Песок сыплется со стены ещё секунду.
      for (let i = 0; i < 10; i++) {
        const t0 = 0.05 + 0.9 * hash(sd, i, 7);
        const u = t - t0;
        if (u < 0 || u > 0.45) continue;
        const gx = cx + (hash(sd, i, 8) - 0.5) * 16;
        const gy = cy - 14 + (hash(sd, i, 9) - 0.5) * 6 + 160 * u * u;
        p.col(i % 2 ? C.sandHi : '#b09a86', 1 - u / 0.45);
        p.dot(gx, gy);
      }
    }
    // Обломки: от стены — назад, колонна — разлетается вперёд.
    const back = pillar ? a : a + Math.PI;
    stones(p, sd, t, cx, cy, few ? 5 : pillar ? 18 : 13, back, pillar ? 1.3 : 1.05, 30, 45, 60, 70, pillar ? 2 : 1, [z.life - 1.1, z.life - 0.3], pillar ? 0.3 : 0.2);
    // Пыль: вдоль стены в обе стороны и назад; у колонны — столбом.
    dust(p, sd + 1, t, cx, cy, few ? 3 : 4, back, 0.8, 18, 20, 3, pillar ? 12 : 10, pillar ? 12 : 6, 1.5, 1, 0.85);
    dust(p, sd + 2, t, cx, cy, few ? 2 : 3, a + Math.PI / 2, 0.35, 16, 16, 3, 9, 4, 1.3, 0, 0.8);
    dust(p, sd + 3, t, cx, cy, few ? 2 : 3, a - Math.PI / 2, 0.35, 16, 16, 3, 9, 4, 1.3, 0, 0.8);
    // Кадр контакта — белый выплеск, пока стоит стоп-кадр.
    if (t < 0.1) {
      p.col(C.white, 1 - t / 0.1);
      ring(p, cx, cy, 3 + 12 * eOut2(t / 0.1), (_a, i) => i % 2 === 0);
    }
  }),
);

registerZonePainter(
  'f5_fxstep',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const t = z.t;
    const a = z.ang ?? 0;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // Раздвоенное копыто: два следа рядом, тают.
    const mark = 1 - k01((t - 0.7) / 0.6);
    p.col(C.sandShade, 0.55 * mark);
    for (const s of [-1.2, 1.2]) lens(p, cx - uy * s, cy + ux * s, ux, uy, 1.8, 0.9);
    p.col(C.sandHi, 0.5 * mark);
    p.dot(cx + ux * 2.5, cy + uy * 2.5 + 1, 2, 1);
    // Тяжёлый шаг — пыль в стороны по полу.
    dust(p, z.id, t, cx, cy, 2, a + Math.PI / 2, 0.3, 12, 6, 1, 4, 2, 0.55, 0, 0.7);
    dust(p, z.id + 5, t, cx, cy, 2, a - Math.PI / 2, 0.3, 12, 6, 1, 4, 2, 0.55, 0, 0.7);
  }),
);

// =============================================================================
// Искры и вспышка контакта (поверх темноты): секира о пол, рог в героя,
// лоб о стену, колонна (с угольями факела).
// kind: 0 — секира, 1 — стена, 2 — рог, 3 — колонна.
// =============================================================================

registerZonePainter(
  'f5_fxspark',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const kind = z.n ?? 0;
    const a = z.ang ?? 0;
    const t = z.t;
    const sd = z.id;
    const few = reduced();
    // Звезда удара: крест с лучами, белое ядро — первые 0,1 с.
    if (t < 0.1) {
      const big = kind === 1 || kind === 3 ? 13 : kind === 2 ? 9 : 11;
      const k = t / 0.1;
      const L = big * (1 - k * 0.5);
      p.col(k < 0.5 ? '#ffffff' : C.yellow, 1 - k * 0.4);
      p.line(cx - L, cy, cx + L, cy);
      p.line(cx, cy - L * 0.8, cx, cy + L * 0.8);
      p.col(C.yellow, 0.8 * (1 - k));
      const d = L * 0.45;
      p.line(cx - d, cy - d, cx + d, cy + d);
      p.line(cx - d, cy + d, cx + d, cy - d);
      p.col('#ffffff', 1);
      p.dot(cx - 1, cy - 1, 3, 3);
    }
    // Рог в героя: штрихи удара расходятся.
    if (kind === 2 && t < 0.16) {
      const k = t / 0.16;
      p.col('#ffffff', 1 - k);
      for (let i = 0; i < 7; i++) {
        const th = a + (i / 7 - 0.5) * 2.4;
        const r0 = 4 + 10 * eOut2(k);
        p.line(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0, cx + Math.cos(th) * (r0 + 5), cy + Math.sin(th) * (r0 + 5));
      }
    }
    const dir = kind === 1 ? a + Math.PI : a;
    const n = few ? 4 : [10, 12, 6, 14][kind] ?? 8;
    sparks(p, sd, t, cx, cy, n, dir, kind === 0 ? 1.3 : 1.1, 60, 70, 0.4, kind === 0 ? 70 : 45);
    // Колонна: уголья упавшего факела медленно поднимаются.
    if (kind === 3)
      for (let i = 0; i < 9; i++) {
        const L = 0.7 + 0.5 * hash(sd, i, 1);
        if (t > L) continue;
        const u = t / L;
        p.col(sparkCol(0.35 + 0.65 * u), 1 - u);
        p.dot(cx + (hash(sd, i, 2) - 0.5) * 14 + Math.sin(u * 6 + i) * 2, cy - 4 - u * (14 + 8 * hash(sd, i, 3)));
      }
  }),
);

// =============================================================================
// Пол под рёвом: рёв входа (`f5_fxroar`: три толчка), трещины под рёвом-
// оглушением (`f5_fxquake`), смена фазы (`f5_fxphase`: звезда трещин с
// жаром — «РЁВ ЛАБИРИНТА» багровым, «КРОВАВАЯ ЯРОСТЬ» раскалённым).
// =============================================================================

/** Камешки подпрыгивают на толчке: t — время с толчка. */
function pebbles(p: Pen, sd: number, t: number, cx: number, cy: number, n: number, r0: number, r1: number): void {
  for (let i = 0; i < n; i++) {
    const a = hash(sd, i, 1) * TAU;
    const r = r0 + (r1 - r0) * hash(sd, i, 2);
    const delay = (r / Math.max(1, r1)) * 0.12;
    const u = t - delay;
    const z = u > 0 && u < 0.3 ? Math.round(Math.sin((u / 0.3) * Math.PI) * (3 + 3 * hash(sd, i, 3))) : 0;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (z) {
      p.col(C.ink, 0.3);
      p.dot(x, y + 1);
    }
    const im = stoneImg(1 + (i % 2), i & 3, 0);
    p.col('#000', 1);
    p.img(im, x - im.width / 2, y - z - im.height / 2);
  }
}

registerZonePainter(
  'f5_fxroar',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const t = z.t;
    const sd = z.id;
    const fade = k01((z.life - t) / 0.5);
    // Трещины из-под копыт на первом толчке.
    if (t > 0.25) {
      const ck = crackOf(`roar|${sd % 97}`, sd, starBranches(sd, 6, 0.4, S * 0.6, S * 1.2, 2), 0.5, 0.25);
      drawCrack(p, ck, cx, cy + 2, ck.max * eOut3(k01((t - 0.25) / 0.12)), C.groove, C.sandHi, fade);
    }
    for (const t0 of [0.25, 0.62, 0.98]) {
      const u = t - t0;
      if (u < 0) continue;
      if (u < 0.42) {
        const k = u / 0.42;
        p.col(C.sandDk, 0.6 * (1 - k));
        ring(p, cx, cy + 1, S * (1.1 + 2.8 * eOut2(k)) + 1, (_a, i) => hash(i >> 2, sd, t0 * 10) > 0.25);
        p.col(C.sandHi, 0.85 * (1 - k));
        ring(p, cx, cy + 1, S * (1.1 + 2.8 * eOut2(k)), (_a, i) => hash(i >> 2, sd, t0 * 10) > 0.25);
      }
    }
    const last = t > 0.98 ? t - 0.98 : t > 0.62 ? t - 0.62 : t - 0.25;
    if (t > 0.25) pebbles(p, sd, last, cx, cy, 10, S * 1.4, S * 3.2);
  }),
);

registerZonePainter(
  'f5_fxquake',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const t = z.t;
    const sd = z.id;
    const fade = k01((z.life - t) / 0.6);
    const ck = crackOf(`quake|${sd % 97}`, sd, starBranches(sd, 7, hash(sd, 0, 9) * TAU, S * 1.2, S * 2.3, 3), 0.5, 0.3);
    drawCrack(p, ck, cx, cy + 2, ck.max * eOut3(k01(t / 0.14)), C.groove, C.sandHi, fade);
    if (t < 0.4) {
      const k = t / 0.4;
      p.col(C.sandHi, 0.85 * (1 - k));
      ring(p, cx, cy + 1, S * (1 + 2.6 * eOut2(k)), (_a, i) => hash(i >> 2, sd, 3) > 0.2);
    }
    pebbles(p, sd, t, cx, cy, 12, S * 1.3, S * 4);
    dust(p, sd, t, cx, cy + 2, reduced() ? 3 : 8, 0, Math.PI, 20, 14, 3, 8, 4, 1.1, 0, 0.7);
  }),
);

registerZonePainter(
  'f5_fxphase',
  guarded((g, zz: Zone | Strike, px: number, py: number, S: number, time: number) => {
    const z = zz as FxZone;
    const cx = z.x * S;
    const cy = z.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const t = z.t;
    const sd = z.id;
    const rage = (z.n ?? 1) >= 2;
    const fade = k01((z.life - t) / 1);
    const ck = crackOf(`phase|${sd % 97}`, sd, starBranches(sd, 9, 0.3, S * 2.1, S * 3.4, 3), 0.45, 0.35);
    const reach = ck.max * eOut3(k01(t / 0.22));
    drawCrack(p, ck, cx, cy + 2, reach, C.deep, C.sandHi, fade);
    // Жар из трещин: багровый — рёв лабиринта, раскалённый — ярость.
    const ox = Math.floor(cx);
    const oy = Math.floor(cy + 2);
    const glow = fade * (0.55 + 0.45 * Math.sin(time * 6));
    p.col(rage ? C.fire[2] : C.redHot, glow);
    for (let i = 0; i < ck.x.length && ck.d[i] <= reach; i += 2)
      if (ck.d[i] < ck.max * 0.6) p.dot(ox + ck.x[i], oy + ck.y[i]);
    if (t < 0.5) {
      const k = t / 0.5;
      p.col(C.sandHi, 0.9 * (1 - k));
      ring(p, cx, cy + 1, S * (1.2 + 3.6 * eOut2(k)), (_a, i) => hash(i >> 2, sd, 4) > 0.2);
    }
    stones(p, sd, t, cx, cy, reduced() ? 5 : 14, 0, Math.PI, 30, 40, 70, 70, 0, [z.life - 1.2, z.life - 0.2], 0.3);
    dust(p, sd, t, cx, cy + 2, reduced() ? 4 : 10, 0, Math.PI, 26, 16, 3, 10, 6, 1.5, 0, 0.8);
  }),
);
