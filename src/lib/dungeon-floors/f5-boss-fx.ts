// Этаж 5, босс «Минотавр» — техники (v2.85): метки ударов, контакт, пыль,
// обломки, огонь разломов. Тело босса рисует `f5-art.ts`, здесь — всё, что
// бык делает с МИРОМ. Договор движка — библия §14.
//
// Как устроено:
//   • метка удара (`registerZonePainter` для strike) читается «куда» с
//     первого кадра (сектор с тёмной кромкой) и «когда» — фронт налива и
//     тень секиры доходят до места ровно в миг урона; последние 0,2 с —
//     «тик-тик» и жёлтая кромка;
//   • контакт (`registerImpactPainter`) — вспышка удара, раскол пола, пыль
//     клубами, камни с гравитацией и отскоком, ударная волна; тряска — по
//     силе удара;
//   • удары без своего strike (стена, колонна, рывок, занос, шаги, рёв
//     входа, смена фазы) — визуальные зоны `f5_fx*`, их ставит мозг (без
//     урона и статусов, `fx()` в `f5-brains.ts`);
//   • всё светящееся (искры, огонь разломов, звёзды оглушения, волна рёва)
//     — поверх темноты (`above`); пыль, трещины, камни — на полу под мобами.
//
// Песок арены пёстрый: тонкая линия на нём пропадает. Поэтому у всего
// светлого — тень на пиксель вниз-вправо (свет сверху-слева), кромки в два
// пикселя, пыль плотная, камни с тёмным контуром.
//
// Пиксели — на СЕТКЕ МИРА (`Pen`): эффект не «плывёт» по полу при движении
// камеры (правило «Тряска» подземелья). Частицы детерминированы — позиция
// считается от зерна и возраста, а не копится по кадрам: лист кадров и игра
// рисуют одно и то же, и стоп-кадр держит позу сам.
import { Px } from '../dungeon-art';
import { MOB_WARM, paintSim, registerImpactPainter, registerMobWarm, registerZonePainter } from '../dungeon-paint';
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
  groove: '#24160c',
  deep: '#140604',
  redDk: '#6a0e08',
  red: '#b01a10',
  redHot: '#ff3a1c',
  orange: '#ff8a2a',
  yellow: '#ffe060',
  white: '#fff8e0',
  shadow: '#1a0806',
  fire: ['#6a1a08', '#a8300c', '#ff6a1a', '#ffb030', '#fff0a0'],
  roar: '#fff2b8',
  roarDk: '#8a6a30',
  wind: '#fbf4e4',
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
  /** Прямоугольник в целых пикселях мира (уже с полом). */
  rect(x: number, y: number, w: number, h: number): void {
    this.g.fillRect(x + this.qx, y + this.qy, w, h);
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
  /** Линия с тенью на пиксель вниз-вправо — читается на пёстром песке. */
  lineS(x0: number, y0: number, x1: number, y1: number, c: string, a: number, sh = 0.5): void {
    if (sh > 0) {
      this.col(C.ink, a * sh);
      this.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1);
    }
    this.col(c, a);
    this.line(x0, y0, x1, y1);
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
 * Кольцо по пикселям цветом `c`. `keep(a, i)` — оставить ли пиксель
 * (пунктир, дуга, «рваная» пыль). `sh` — тень на пиксель вниз-вправо.
 */
function ring(
  p: Pen,
  cx: number,
  cy: number,
  r: number,
  c: string,
  a: number,
  keep?: (a: number, i: number) => boolean,
  sh = 0,
): void {
  const pts = circle(r);
  const ox = Math.floor(cx);
  const oy = Math.floor(cy);
  const n = pts.x.length;
  for (let pass = sh > 0 ? 0 : 1; pass < 2; pass++) {
    const d = pass ? 0 : 1;
    p.col(pass ? c : C.ink, pass ? a : a * sh);
    // Соседние по углу пиксели сливаются в отрезки: у вершин круга они
    // лежат строкой, у боков — столбцом. Вызовов рисования втрое меньше.
    let rx = 0;
    let ry = 0;
    let rw = 0;
    let rh = 0;
    for (let i = 0; i < n; i++) {
      if (keep && !keep(pts.a[i], i)) continue;
      const x = ox + pts.x[i] + d;
      const y = oy + pts.y[i] + d;
      if (rw && rh === 1 && y === ry && (x === rx + rw || x === rx - 1)) {
        if (x < rx) rx = x;
        rw++;
        continue;
      }
      if (rw === 1 && x === rx && (y === ry + rh || y === ry - 1)) {
        if (y < ry) ry = y;
        rh++;
        continue;
      }
      if (rw) p.rect(rx, ry, rw, rh);
      rx = x;
      ry = y;
      rw = 1;
      rh = 1;
    }
    if (rw) p.rect(rx, ry, rw, rh);
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

/**
 * Звезда удара: n лучей радиуса r (у основания — 0,34 r), залита по
 * пикселям. Кадр контакта: рисуется два-три кадра, сжимаясь.
 */
function star(p: Pen, cx: number, cy: number, r: number, n: number, rot: number): void {
  const R = Math.ceil(r) + 1;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const dx = x0 + x + 0.5 - cx;
      const dy = y0 + y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) continue;
      const th = Math.atan2(dy, dx) - rot;
      const spike = Math.pow(Math.abs(Math.cos((th * n) / 2)), 3);
      if (d <= r * (0.4 + 0.6 * spike)) p.dot(x0 + x, y0 + y);
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
  [hx('#a4865e'), hx('#e6d6b2'), hx('#fcf4e2')], // 0 — песок арены, светлее пола
  [hx('#4e3e34'), hx('#8a7464'), hx('#b8a490')], // 1 — каменная крошка стены
  [hx('#2a2624'), hx('#4a4440'), hx('#6e6660')], // 2 — дым угольков
  [hx('#b8a684'), hx('#ece2cc'), hx('#fffaf0')], // 3 — ветер, рёв
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
        const edge = !inside(x, y + 1) || (!inside(x + 1, y + 1) && l < 0);
        p.set(x, y, edge && R > 1 ? sh : l > 0.25 ? hi : mid);
      }
    return p;
  });
}

const STONE_PAL: RGBA[][] = [
  [hx('#5a4228'), hx('#8a6a42'), hx('#b48e5c'), hx('#ecd4a0')], // 0 — песчаник пола
  [hx('#3a2c24'), hx('#6a5444'), hx('#9a826a'), hx('#c4ac90')], // 1 — кирпич стены
  [hx('#4a3a30'), hx('#7a6454'), hx('#a48a74'), hx('#d8c0a8')], // 2 — колонна
  [hx('#5a1a10'), hx('#8a2a1a'), hx('#b04a2a'), hx('#e8b850')], // 3 — красная полоса колонны
];

/** Камень размера 1…4, поворот f (0…3): овал с объёмом и тёмным контуром. */
function stoneImg(sz: number, f: number, pal: number): HTMLCanvasElement {
  return sprite(20000 + pal * 100 + sz * 10 + (f & 3), () => {
    const s = sz * 2 + 3;
    const p = new Px(s, s);
    const c = s / 2;
    const rx = 0.55 + 0.6 * sz;
    const ry = 0.4 + 0.4 * sz;
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

/** Звёздочка оглушения с тёмным кантом (кадр f: крупная/мелкая). */
function stunStar(f: number): HTMLCanvasElement {
  return sprite(40000 + (f & 1), () => {
    const p = new Px(7, 7);
    const y = hx(C.star);
    const w = hx('#ffffff');
    if (f & 1) {
      for (const [x, yy] of [
        [3, 2],
        [2, 3],
        [3, 3],
        [4, 3],
        [3, 4],
      ])
        p.set(x, yy, y);
    } else {
      for (let i = 1; i <= 5; i++) {
        p.set(3, i, y);
        p.set(i, 3, y);
      }
      p.set(2, 2, y);
      p.set(4, 2, y);
      p.set(2, 4, y);
      p.set(4, 4, y);
    }
    p.set(3, 3, w);
    p.outline(hx('#3a2a08'));
    return p;
  });
}

// ---- Частицы: позиция от зерна и возраста -----------------------------------

interface Fly {
  /** Путь по земле (в секундах начальной скорости), высота, в воздухе ли. */
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
 * `big` — доля крупных (3–4 пикселя).
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
  big = 0.3,
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
    const sz = r4 < big * 0.4 ? 4 : r4 < big ? 3 : r4 < 0.7 ? 2 : 1;
    if (f.air) {
      p.col(C.ink, 0.3 * a);
      p.dot(gx - sz / 2, gy + 1, sz, 1);
    }
    const spin = f.air ? Math.floor(age * (14 + r2 * 10) + i) & 3 : i & 3;
    const im = stoneImg(sz, spin, pal === 2 && i % 4 === 0 ? 3 : pal);
    p.col('#000', a);
    p.img(im, gx - im.width / 2, gy - f.z - im.height / 2);
  }
}

/**
 * Пыль клубами: `n` клубов из (x, y), направление `ang` ± `spread`, скорость
 * с сопротивлением, растут `r0 → r1`, поднимаются на `rise` и тают за `life`.
 * `stagger` — задержка появления клуба (доля до `stagger` с).
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
  alpha = 0.92,
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
    // Клубы разные: крупный рядом с мелким, иначе ряд одинаковых «ваток».
    const sz = 0.5 + 0.6 * hash(seed, i, 25);
    const r = r0 + (r1 - r0) * sz * eOut2(k01(t / (L * 0.6)));
    const z = rise * (0.6 + 0.4 * h2) * eOut2(k);
    const im = puffImg(pal, r, i);
    // Плотный в начале, тает с трети жизни — редеет, а не гаснет разом.
    p.col('#000', alpha * (k < 0.3 ? 1 : 1 - Math.pow((k - 0.3) / 0.7, 1.2)));
    p.img(im, x + Math.cos(th) * d - im.width / 2, y + Math.sin(th) * d - z - im.height / 2);
  }
}

/** Искры: головка и хвост 2–4 пикселя по скорости, цвет по доле жизни. */
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
    const [bx, by] = at(Math.max(0, age - 0.04));
    p.col(sparkCol(k), 1 - k * 0.4);
    p.line(bx, by, ax, ay);
  }
}

// ---- Трещины: сеть от зерна, растёт от точки удара ---------------------------

interface Crack {
  x: Int16Array;
  y: Int16Array;
  d: Float32Array;
  /** Кромка: светлый пиксель снизу-справа от жёлоба. */
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
 * снизу-справа (свет сверху-слева), как высеченный жёлоб; у корня трещина
 * шире — раскол, а не царапина.
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
  let maxLen = 0;
  const walk = (x0: number, y0: number, a0: number, len: number, d0: number, wid: number, id: number, depth: number) => {
    let x = x0;
    let y = y0;
    let a = a0;
    maxLen = Math.max(maxLen, d0 + len);
    for (let s = 0, i = 0; s < len; s += 2, i++) {
      a += (hash(seed, id * 131 + i, 1) - 0.5) * jag * 2;
      a = a * 0.72 + a0 * 0.28;
      const nx = x + Math.cos(a) * 2;
      const ny = y + Math.sin(a) * 2;
      const w = wid * (1 - s / len);
      for (let q = 0; q <= 4; q++) {
        const qx = x + ((nx - x) * q) / 4;
        const qy = y + ((ny - y) * q) / 4;
        const d = d0 + s + q * 0.5;
        put(Math.floor(qx), Math.floor(qy), d);
        if (w > 1.1) put(Math.floor(qx + Math.sin(a) * 0.95), Math.floor(qy - Math.cos(a) * 0.95), d);
        if (w > 2.1) put(Math.floor(qx - Math.sin(a) * 0.95), Math.floor(qy + Math.cos(a) * 0.95), d);
      }
      x = nx;
      y = ny;
      if (depth < 1 && s > len * 0.3 && s < len * 0.75 && hash(seed, id * 17 + i, 2) < forkP) {
        const side = hash(seed, id * 19 + i, 3) < 0.5 ? -1 : 1;
        walk(x, y, a + side * (0.5 + 0.4 * hash(seed, id, 4)), (len - s) * 0.5, d0 + s, 1, id * 7 + i + 1, depth + 1);
      }
    }
  };
  br.forEach(([a, len, w], i) => walk(0.5, 0.5, a, len, 0, w, i + 1, 0));
  const pts = [...px.entries()].map(([k, d]) => [Math.floor(k / 4096) - 1024, (k % 4096) - 1024, d]);
  pts.sort((a, b) => a[2] - b[2]);
  // Кромка — только у широкой части: на тонких концах светлые точки на
  // пёстром песке превращаются в сор.
  const lips = pts
    .filter(([x, y, d]) => d < maxLen * 0.55 && !px.has(K(x + 1, y + 1)))
    .map(([x, y, d]) => [x + 1, y + 1, d]);
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

/**
 * Раскрытая трещина одним холстом: пока бежит — по пикселям, дорисовалась —
 * одним `drawImage` (разломы лежат по 5–7 с, их по шесть разом).
 */
const crackImgs = new WeakMap<Crack, Map<string, { img: HTMLCanvasElement; x: number; y: number }>>();
function crackImg(c: Crack, core: string, lip: string | null) {
  let m = crackImgs.get(c);
  if (!m) {
    m = new Map();
    crackImgs.set(c, m);
  }
  const key = `${core}|${lip}`;
  let hit = m.get(key);
  if (hit) return hit;
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  const grow = (xs: Int16Array, ys: Int16Array) => {
    for (let i = 0; i < xs.length; i++) {
      x0 = Math.min(x0, xs[i]);
      y0 = Math.min(y0, ys[i]);
      x1 = Math.max(x1, xs[i]);
      y1 = Math.max(y1, ys[i]);
    }
  };
  grow(c.x, c.y);
  if (lip) grow(c.lx, c.ly);
  if (x1 < x0) {
    x0 = y0 = 0;
    x1 = y1 = 0;
  }
  const px = new Px(x1 - x0 + 1, y1 - y0 + 1);
  if (lip) {
    const l = hx(lip, Math.round(0.7 * 255));
    for (let i = 0; i < c.lx.length; i++) px.set(c.lx[i] - x0, c.ly[i] - y0, l);
  }
  const k = hx(core);
  for (let i = 0; i < c.x.length; i++) px.set(c.x[i] - x0, c.y[i] - y0, k);
  hit = { img: px.canvas(), x: x0, y: y0 };
  m.set(key, hit);
  return hit;
}

/** Рамка трещины [x0, y0, x1, y1] относительно корня. */
const crackBoxes = new WeakMap<Crack, [number, number, number, number]>();
function crackBox(c: Crack): [number, number, number, number] {
  let b = crackBoxes.get(c);
  if (b) return b;
  b = [0, 0, 0, 0];
  for (let i = 0; i < c.x.length; i++) {
    b[0] = Math.min(b[0], c.x[i]);
    b[1] = Math.min(b[1], c.y[i]);
    b[2] = Math.max(b[2], c.x[i]);
    b[3] = Math.max(b[3], c.y[i]);
  }
  crackBoxes.set(c, b);
  return b;
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
  if (reach >= c.max) {
    const im = crackImg(c, core, lip);
    p.col('#000', a);
    p.img(im.img, ox + im.x, oy + im.y);
    return;
  }
  if (lip) {
    p.col(lip, a * 0.7);
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
    i % 2 ? Math.max(1, w - 1) : w,
  ]);

// ---- Общее для зон ----------------------------------------------------------

/** Лишние поля визуальных зон мозга (`fx()` в f5-brains). */
type FxZone = Zone & { ang?: number; mid?: number; len?: number; v?: number; n?: number };

const mobOf = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);

/**
 * Кто заслоняет точку мира (пиксели) для слоя поверх темноты. Этот слой
 * рисуется после всех мобов, и язык пламени за спиной быка ложился ему на
 * грудь — бык «горел». Заслоняют бык (силуэт ≈ трапеция 1,7 клетки внизу,
 * 2,3 вверху, 3,9 в высоту) и герой (0,9 × 1,25 клетки): точка ЗА ними и в
 * их силуэте не рисуется — как если бы слой сортировался по глубине.
 */
interface Screen {
  (x: number, y: number): boolean;
  /** Прямоугольник [x0, x1] × [y0, y1] никем не заслонён — проверки не нужны. */
  clear(x0: number, y0: number, x1: number, y1: number): boolean;
}
function screenOf(S: number): Screen {
  const sim = paintSim();
  const box: number[] = [];
  if (sim) {
    for (const m of sim.mobs)
      if (m.r >= 0.8 && m.mode !== 'dying') box.push(m.x * S, m.y * S, 0.85 * S, 1.15 * S, 3.9 * S);
    const h = sim.hero;
    box.push(h.x * S, h.y * S, 0.45 * S, 0.45 * S, 1.25 * S);
  }
  const hid = ((x: number, y: number) => {
    for (let i = 0; i < box.length; i += 5) {
      const up = box[i + 1] - 1 - y;
      if (up <= 0 || up > box[i + 4]) continue;
      if (Math.abs(x - box[i]) < box[i + 2] + (box[i + 3] - box[i + 2]) * (up / box[i + 4])) return true;
    }
    return false;
  }) as Screen;
  hid.clear = (x0, y0, x1, y1) => {
    for (let i = 0; i < box.length; i += 5) {
      const w = Math.max(box[i + 2], box[i + 3]);
      if (x1 > box[i] - w && x0 < box[i] + w && y1 > box[i + 1] - 1 - box[i + 4] && y0 < box[i + 1] - 1) return false;
    }
    return true;
  };
  return hid;
}

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

/** Кромка сектора: дуга и два края, в два пикселя (тёмная снаружи). */
function sectorRim(
  p: Pen,
  cx: number,
  cy: number,
  R: number,
  a0: number,
  arc: number,
  r0: number,
  c: string,
  a: number,
  keep?: (u: number) => boolean,
): void {
  const ok = (ang: number) => {
    if (!inArc(ang, a0, arc)) return false;
    if (!keep) return true;
    const d = (((ang - a0) % TAU) + TAU) % TAU;
    return keep(Math.min(d, arc - d) * R);
  };
  ring(p, cx, cy, R + 1, C.ink, a * 0.6, ok);
  ring(p, cx, cy, R, c, a, ok);
  for (const ea of [a0, a0 + arc]) {
    const ex = Math.cos(ea);
    const ey = Math.sin(ea);
    // Тёмная сторона — снаружи сектора.
    const out = ea === a0 ? -1 : 1;
    const nx = -ey * out;
    const ny = ex * out;
    for (let r = r0; r < R; r += 1) {
      if (keep && !keep(R - r)) continue;
      p.col(C.ink, a * 0.6);
      p.dot(cx + ex * r + nx, cy + ey * r + ny);
      p.col(c, a);
      p.dot(cx + ex * r, cy + ey * r);
    }
  }
}

// =============================================================================
// СЕКИРА — конус r 3, дуга 2,3. Метка: налив от быка к кромке (ease-in —
// как разгон секиры), тень секиры по дуге от быка к точке удара — большая и
// бледная, пока секира высоко, тёмная и чёткая к удару. Контакт: звезда
// удара, пол раскалывается от точки удара веером, пыль, камни с отскоком,
// волна по конусу.
// =============================================================================

/** Где секира входит в пол: 2,2 клетки по оси удара (там же встают разломы). */
const AXE_BITE = 2.2;

/**
 * Тень лезвия: полумесяц, выпуклый в сторону удара (ux, uy), и тень
 * рукояти по (hx, hy). Пока секира высоко — крупная и рябая (мягкая),
 * к удару — маленькая и сплошная.
 */
function bladeShadow(
  p: Pen,
  x: number,
  y: number,
  ux: number,
  uy: number,
  hx0: number,
  hy0: number,
  s: number,
  soft: boolean,
): void {
  const nx = -uy;
  const ny = ux;
  const L = 7 * s;
  const W = 3.4 * s;
  const R = Math.ceil(L) + 2;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  for (let yy = -R; yy <= R; yy++)
    for (let xx = -R; xx <= R; xx++) {
      const dx = x0 + xx + 0.5 - x;
      const dy = y0 + yy + 0.5 - y;
      const a = (dx * nx + dy * ny) / L;
      const b = (dx * ux + dy * uy) / W;
      if (a * a + b * b > 1) continue;
      // Вырез: такой же овал, сдвинутый назад, — остаётся серп.
      const b2 = b + 0.85;
      if (a * a * 1.15 + b2 * b2 < 1) continue;
      if (soft && (x0 + xx + y0 + yy) & 1) continue;
      p.dot(x0 + xx, y0 + yy);
    }
  for (let d = W * 0.2; d < W * 0.2 + 10 * s; d += 1) {
    if (soft && Math.floor(d) & 1) continue;
    p.dot(x + hx0 * d, y + hy0 * d);
  }
}

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
    const nx = -uy;
    const ny = ux;
    const sig = left < SIG;
    const tk = !reduced() && tick(left);
    // «Куда»: весь сектор с первого кадра, с тёмной кромкой.
    p.col(C.redDk, 0.26 + 0.08 * k);
    fillSector(p, cx, cy, 0, R, a0, a0 + arc);
    // «Когда»: налив от быка к кромке, фронт — яркая дуга.
    const rf = R * (0.12 + 0.88 * Math.pow(k, 1.6));
    p.col(sig ? C.redHot : C.red, (tk ? 0.62 : 0.34) + 0.12 * k);
    fillSector(p, cx, cy, 0, rf, a0, a0 + arc);
    ring(p, cx, cy, rf, sig ? C.yellow : C.orange, 0.75 + 0.25 * k, (ang) => inArc(ang, a0, arc), 0.5);
    // Кромка: штрихи бегут от краёв к оси — удар сходится в точку.
    const run = time * (24 + 60 * k);
    sectorRim(
      p,
      cx,
      cy,
      R,
      a0,
      arc,
      S * 0.9,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.75 + 0.25 * k,
      sig ? undefined : (u) => (u + run) % 8 < 5.5,
    );
    // Тень секиры: по дуге от быка к точке удара; опускается — темнеет и
    // сжимается. Ход ускоряется к концу, как сама секира.
    const drop = Math.pow(k, 2.2);
    const along = S * (0.6 + (AXE_BITE - 0.6) * drop);
    const side = Math.sin(Math.PI * drop) * 7;
    const bx = cx + ux * along + nx * side;
    const by = cy + uy * along + ny * side;
    p.col(C.shadow, 0.2 + 0.6 * drop);
    bladeShadow(p, bx, by, ux, uy, -ux, -uy, 1.5 - 0.5 * drop, drop < 0.4);
    // Песок дрожит под занесённой секирой, к удару — подскакивает.
    for (let i = 0; i < 16; i++) {
      const rr = R * (0.3 + 0.62 * hash(st.id, i, 5));
      const aa = a0 + arc * hash(st.id, i, 6);
      const hop = k > 0.3 ? Math.floor(hash(i, Math.floor(time * 16), st.id) * (1 + 3 * k)) : 0;
      const gx = cx + Math.cos(aa) * rr;
      const gy = cy + Math.sin(aa) * rr;
      if (hop) {
        p.col(C.ink, 0.35);
        p.dot(gx, gy + 1);
      }
      p.col(C.sandHi, 0.9);
      p.dot(gx, gy - hop);
    }
    // Последние 0,2 с: трещины уже бегут из точки удара.
    if (sig) {
      const ck = crackOf(`axeTele|${st.id % 997}`, st.id, starBranches(st.id, 4, a, 6, 12, 1), 0.45, 0);
      drawCrack(p, ck, cx + ux * S * AXE_BITE, cy + uy * S * AXE_BITE, (1 - left / SIG) * 12, C.groove, null, 0.85);
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
    // Волна по всему конусу: удар накрыл весь сектор — пыль сдувает к краю.
    if (age < 0.22) {
      const k = age / 0.22;
      const rw = R * (0.35 + 0.75 * eOut2(k));
      ring(p, cx, cy, rw, C.wind, 0.9 * (1 - k), (ang, i) => inArc(ang, a - arc / 2, arc) && hash(i >> 1, sd, 7) > 0.2, 0.6);
    }
    // Раскол пола: главная трещина по оси удара — секира рубит вдоль, две
    // веером, коротко вбок и назад.
    const br: [number, number, number][] = [
      [a + (hash(sd, 1, 1) - 0.5) * 0.25, S * (1.5 + 0.5 * hash(sd, 1, 2)), 3],
      [a - 0.55 - 0.2 * hash(sd, 2, 1), S * (1.0 + 0.5 * hash(sd, 2, 2)), 2],
      [a + 0.55 + 0.2 * hash(sd, 3, 1), S * (1.0 + 0.5 * hash(sd, 3, 2)), 2],
      [a + Math.PI / 2 + (hash(sd, 4, 1) - 0.5) * 0.5, S * 0.55, 1],
      [a - Math.PI / 2 + (hash(sd, 5, 1) - 0.5) * 0.5, S * 0.55, 1],
      [a + Math.PI + (hash(sd, 6, 1) - 0.5) * 0.4, S * 0.7, 2],
    ];
    const ck = crackOf(`axe|${sd}`, sd, br, 0.4, 0.3);
    drawCrack(p, ck, bx, by, ck.max * eOut3(k01(age / 0.14)), C.groove, C.sandHi, fade);
    // Прорубь от лезвия — вдоль оси, тёмная, с отваленным песком.
    p.col(C.sandHi, 0.9 * fade);
    lens(p, bx + 1, by + 1, ux, uy, 7, 2.2);
    p.col(C.deep, fade);
    lens(p, bx, by, ux, uy, 6.5, 1.7);
    // Кадр контакта: звезда удара, пока держит стоп-кадр, потом гаснет.
    if (age < 0.13) {
      const k = age / 0.13;
      p.col(k < 0.4 ? '#ffffff' : C.yellow, 1);
      star(p, bx, by, 15 * (1 - 0.5 * k), 8, a + 0.2);
      if (k < 0.6) {
        p.col(C.yellow, 1);
        star(p, bx, by, 7, 4, a + 0.6);
      }
    }
    // Ударная волна от точки удара — рваная, как пыль, а не циркуль.
    if (age < 0.3) {
      const k = age / 0.3;
      ring(p, bx, by, 5 + 34 * eOut2(k), C.white, 0.95 * (1 - k), (_ang, i) => hash(i >> 2, sd, 9) > 0.22, 0.6);
      ring(p, bx, by, 4 + 34 * eOut2(k), C.sandHi, 0.7 * (1 - k), (_ang, i) => hash(i >> 2, sd, 10) > 0.4);
    }
    // Песок брызгами (мелкие, быстрые) и камни (тяжёлые, с отскоком).
    for (let i = 0; i < (few ? 6 : 18); i++) {
      const th = a + (hash(sd, i, 51) - 0.5) * 2.8;
      const v = 55 + 50 * hash(sd, i, 52);
      const f = fly(age, 35 + 45 * hash(sd, i, 53), 430, 0);
      if (!f.air) continue;
      const gx = bx + Math.cos(th) * v * f.h;
      const gy = by + Math.sin(th) * v * f.h - f.z;
      p.col(C.ink, 0.5);
      p.dot(gx + 1, gy + 1);
      p.col(hash(sd, i, 54) < 0.5 ? C.white : C.sandHi, 1);
      p.dot(gx, gy);
    }
    dust(p, sd, age, bx, by, few ? 4 : 10, a, 1.3, 26, 34, 3, 11, 7, 1.15, 0, 0.95);
    dust(p, sd + 1, age, bx, by, few ? 1 : 3, a + Math.PI, 0.8, 12, 12, 2, 7, 4, 0.85, 0, 0.9);
    stones(p, sd, age, bx, by, few ? 5 : 12, a, 1.25, 26, 44, 70, 80, 0, [1.1, 1.65], 0.45);
  }),
});

// =============================================================================
// ВИХРЬ — круг r 3,1. Метка: «часы» — сектор заметает круг от того места,
// где висит секира, и замыкается ровно в миг урона; фронт — тень лезвия со
// смазом. Ветер крутит песок всё быстрее. Контакт: лезвие пролетает полный
// круг светлым смазом, кольцо ветра и пыли разлетается по спирали, пол
// прочерчен лезвием.
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
    p.col(C.redDk, 0.22 + 0.06 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    // Заметённое лезвием — налито.
    const sw = TAU * Math.pow(k, 1.7);
    const lo = dir > 0 ? a0 : a0 - sw;
    p.col(sig ? C.redHot : C.red, (tk ? 0.62 : 0.34) + 0.1 * k);
    fillSector(p, cx, cy, 0, R, lo, lo + sw);
    // Фронт — тень лезвия и смаз за ней.
    const aL = a0 + dir * sw;
    for (let j = 0; j < 4; j++) {
      const s0 = dir > 0 ? aL - (j + 1) * 0.12 : aL + j * 0.12;
      p.col(C.shadow, (0.42 - j * 0.1) * (0.5 + 0.5 * k));
      fillSector(p, cx, cy, S * 1.2, S * 3.0, s0, s0 + 0.12);
    }
    p.col(C.shadow, 0.45 + 0.45 * k);
    bladeShadow(
      p,
      cx + Math.cos(aL) * S * 2.3,
      cy + Math.sin(aL) * S * 2.3,
      -Math.sin(aL) * dir,
      Math.cos(aL) * dir,
      -Math.cos(aL),
      -Math.sin(aL),
      1.1,
      false,
    );
    // Кромка — пунктир, крутится с ветром.
    ring(p, cx, cy, R + 1, C.ink, 0.5);
    ring(
      p,
      cx,
      cy,
      R,
      sig ? (tk ? C.white : C.yellow) : k > 0.5 ? C.orange : C.redHot,
      0.8 + 0.2 * k,
      (ang) => sig || (((ang - spin) % 0.5) + 0.5) % 0.5 < 0.32,
    );
    // Струи ветра — дуги с тенью, крутятся и ускоряются.
    for (let i = 0; i < 4; i++) {
      const rr = R * (0.42 + 0.16 * i);
      const s = spin * (1.5 - i * 0.15) + (i * TAU) / 4;
      const len = 0.5 + 0.55 * k;
      const keep = (ang: number) => inArc(ang, dir > 0 ? s - len : s, len);
      ring(p, cx, cy, rr, C.wind, 0.5 + 0.45 * k, keep, 0.45);
    }
    // Песчинки по кругу, чем ближе — тем быстрее, к удару отходят наружу.
    for (let i = 0; i < 18; i++) {
      const r0 = R * (0.3 + 0.62 * hash(st.id, i, 3));
      const rr = r0 + R * 0.08 * k;
      const aa = hash(st.id, i, 4) * TAU + spin * (1.8 - (r0 / R) * 0.9);
      const gx = cx + Math.cos(aa) * rr;
      const gy = cy + Math.sin(aa) * rr - (k > 0.5 ? i & 1 : 0);
      p.col(C.ink, 0.4);
      p.dot(gx + 1, gy + 1);
      p.col(C.sandHi, 1);
      p.dot(gx, gy);
    }
  }),
);

/** Сторона вращения на запись контакта: бык за миг может повернуться. */
const spinDir = new WeakMap<ImpactRec, { a0: number; dir: number }>();

registerImpactPainter('f5_whirl', {
  life: 1.4,
  shake: 0.3,
  paint: guarded((g, rec: ImpactRec, px: number, py: number, S: number, age: number) => {
    const cx = rec.x * S;
    const cy = rec.y * S;
    const p = new Pen(g, px, py, cx, cy);
    const R = (rec.r ?? 3.1) * S;
    const sd = rec.seed;
    const few = reduced();
    let sp = spinDir.get(rec);
    if (!sp) {
      sp = spinOf(undefined);
      spinDir.set(rec, sp);
    }
    const { a0, dir } = sp;
    const fade = 1 - k01((age - 0.95) / 0.45);
    // Борозда лезвия по кругу — рваная дуга с кромкой.
    const gr = S * 2.2;
    ring(p, cx + 1, cy + 1, gr, C.sandHi, 0.85 * fade, (_a, i) => hash(i >> 2, sd, 3) > 0.28);
    ring(p, cx, cy, gr, C.groove, 0.95 * fade, (_a, i) => hash(i >> 2, sd, 3) > 0.28);
    // Смаз лезвия: светлая полоса пробегает полный круг за 0,1 с и тает.
    if (age < 0.2) {
      const k = age / 0.2;
      const head = a0 + dir * TAU * Math.min(1, age / 0.1);
      const tail = 2.4 * (1 - k);
      const lo = dir > 0 ? head - tail : head;
      p.col(C.white, 0.9 * (1 - k));
      fillSector(p, cx, cy, S * 1.7, S * 2.8, lo, lo + tail);
      p.col(C.yellow, 0.8 * (1 - k));
      fillSector(p, cx, cy, S * 2.05, S * 2.45, lo, lo + tail);
    }
    // Ударная волна.
    if (age < 0.3) {
      const k = age / 0.3;
      ring(p, cx, cy, R * (0.6 + 0.65 * eOut2(k)), C.wind, 0.95 * (1 - k), (_a, i) => hash(i >> 1, sd, 4) > 0.2, 0.6);
    }
    // Кольцо ветра: дуги по касательной, крутятся и уходят наружу.
    if (age < 0.6) {
      const k = age / 0.6;
      for (let i = 0; i < 6; i++) {
        const rr = R * (0.6 + 0.55 * eOut2(k) + 0.06 * (i % 3));
        const s = dir * (age * 9 + (i * TAU) / 6);
        ring(p, cx, cy, rr, C.wind, 0.85 * (1 - k), (ang) => inArc(ang, dir > 0 ? s - 0.55 : s, 0.55), 0.5);
      }
    }
    // Пыль спиралью: наружу и по ходу вращения.
    const n = few ? 6 : 13;
    for (let i = 0; i < n; i++) {
      const phi = (i / n) * TAU + hash(sd, i, 5) * 0.45;
      const r0 = R * (0.55 + 0.4 * hash(sd, i, 6));
      const vr = 16 + 16 * hash(sd, i, 7);
      const vt = 28 + 14 * hash(sd, i, 8);
      const L = 0.6 + 0.6 * hash(sd, i, 9);
      if (age >= L) continue;
      const k = age / L;
      const dr = drag(vr, 2.6, age);
      const dt = drag(vt, 2.6, age) / (r0 + dr);
      const ang = phi + dir * dt;
      const im = puffImg(0, 2 + 8 * eOut2(k01(age / 0.6)) * (0.35 + 0.65 * hash(sd, i, 10)), i);
      p.col('#000', 0.9 * (k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7));
      p.img(im, cx + Math.cos(ang) * (r0 + dr) - im.width / 2, cy + Math.sin(ang) * (r0 + dr) - 4 * eOut2(k) - im.height / 2);
    }
    // Камни — по касательной: их отбросило лезвие.
    for (let i = 0; i < (few ? 4 : 10); i++) {
      const phi = hash(sd, i, 61) * TAU;
      stones(p, sd * 31 + i, age, cx + Math.cos(phi) * gr, cy + Math.sin(phi) * gr, 1, phi + dir * 1.2, 0.35, 28, 36, 55, 60, 0, [1.0, 1.4], 0.4);
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
    p.col('#e8c860', (tk ? 0.26 : 0.1) + 0.08 * k);
    fillSector(p, cx, cy, 0, R, 0, TAU);
    // Кромка в два пикселя: тёмная снаружи, светлая, пунктир бежит.
    ring(p, cx, cy, R + 1, C.ink, 0.55);
    ring(p, cx, cy, R, sig ? (tk ? '#ffffff' : C.yellow) : C.roar, 0.75 + 0.25 * k, (_a, i) => sig || (i + Math.floor(st.t * 30)) % 9 < 6);
    // Кольцо вдоха сходится к быку — дошло до него, значит, рёв.
    for (const lag of [0, 0.14]) {
      const kk = k01(k - lag);
      const rr = S * 0.95 + (R - S * 0.95) * (1 - Math.pow(kk, 1.5));
      const al = (0.55 + 0.45 * kk) * (lag ? 0.6 : 1);
      ring(p, cx, cy, rr + 2, C.roarDk, al * 0.8);
      ring(p, cx, cy, rr + 1, C.roar, al);
      ring(p, cx, cy, rr, sig && !lag ? '#ffffff' : C.roar, al, undefined, 0.4);
    }
    // Струи пыли тянутся внутрь; разгон — интеграл скорости 0,45 + 2,5·k².
    const tt = st.t;
    const run = 0.45 * tt + (2.5 * tt * tt * tt) / (3 * w * w);
    for (let i = 0; i < 24; i++) {
      const phi = hash(st.id, i, 1) * TAU;
      const u = (hash(st.id, i, 2) + run * (0.8 + 0.4 * hash(st.id, i, 3))) % 1;
      const rr = R * (1 - u) + S * 0.8 * u;
      // Струя длиннее к удару: воздух несётся к пасти всё быстрее.
      const len = 3 + Math.round(8 * k * k);
      const x0 = cx + Math.cos(phi) * rr;
      const y0 = cy + Math.sin(phi) * rr;
      const x1 = cx + Math.cos(phi) * (rr + len);
      const y1 = cy + Math.sin(phi) * (rr + len);
      p.lineS(x0, y0, x1, y1, C.wind, 0.5 + 0.5 * u, 0.5);
      p.col('#e6d6b2', 0.5 + 0.5 * u);
      p.line(x0 - Math.sin(phi), y0 + Math.cos(phi), x1 - Math.sin(phi), y1 + Math.cos(phi));
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
    // Три кольца пыли по воздуху — толстые, рваные, у каждого своя «рвань».
    for (let j = 0; j < 3; j++) {
      const t = age - [0, 0.1, 0.22][j];
      if (t < 0 || t > 0.5) continue;
      const k = t / 0.5;
      const rr = S + (R * 1.12 - S) * eOut2(k);
      const a = (1 - k) * (j === 0 ? 1 : 0.75);
      const keep = (_a: number, i: number) => hash(i >> 2, sd + j, 5) > 0.14;
      ring(p, cx, cy, rr - 2, C.roarDk, a * 0.75, keep);
      ring(p, cx, cy, rr - 1, '#e6d6b2', a, keep);
      ring(p, cx, cy, rr, j === 0 ? '#ffffff' : C.roar, a, keep, 0.5);
      // Штрихи ветра за первым кольцом.
      if (j === 0)
        for (let i = 0; i < 18; i++) {
          const phi = (i / 18) * TAU + hash(sd, i, 7) * 0.3;
          const r1 = rr - 5 - 3 * hash(sd, i, 8);
          p.lineS(cx + Math.cos(phi) * r1, cy + Math.sin(phi) * r1, cx + Math.cos(phi) * (r1 - 6), cy + Math.sin(phi) * (r1 - 6), C.wind, a * 0.9, 0.4);
        }
    }
    // Оглушённый герой: звёзды кружат над головой, пока держит оглушение.
    const h = paintSim()?.hero;
    const stun = h?.status?.stun;
    if (h && stun && stun.t > 0) {
      const hx0 = h.x * S;
      const hy0 = h.y * S - 21;
      for (let i = 0; i < 3; i++) {
        const an = time * 6 + (i * TAU) / 3;
        const front = Math.sin(an) > 0;
        const im = stunStar(front ? 0 : 1);
        p.col('#000', front ? 1 : 0.75);
        p.img(im, hx0 + Math.cos(an) * 8 - 3, hy0 + Math.sin(an) * 2.5 - 3);
      }
      // Удар по ушам: кольцо у головы в первые мгновения.
      if (age < 0.3) ring(p, hx0, hy0 + 6, 4 + 10 * eOut2(age / 0.3), '#ffffff', 0.9 * (1 - age / 0.3), (_a, i) => i % 3 !== 0, 0.5);
    }
  }),
});

// =============================================================================
// РАЗЛОМ (фаза ≥ 1): трещина раскрывается от середины к концам, пол вокруг
// обгорает; огонь (`f5_fxfire`, поверх темноты) пляшет языками посередине,
// летят угольки; к концу пламя опадает, трещина тлеет угольками и дымит.
// =============================================================================

/** Трещина разлома: поперёк удара, от середины в обе стороны. */
function riftCrack(z: FxZone, S: number): Crack {
  const sd = placeSeed(z.x, z.y);
  const a = (z.ang ?? 0) + Math.PI / 2;
  const L = z.r * S * 1.15;
  return crackOf(
    `rift|${sd}`,
    sd,
    [
      [a, L, 3],
      [a + Math.PI, L * (0.8 + 0.3 * hash(sd, 1, 1)), 3],
    ],
    0.5,
    0.3,
  );
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
    // Обгоревший песок вокруг — пятно под огнём, по краю рваное.
    if (on) {
      const burn = Math.min(1, (z.t - warn) / 0.4);
      p.col('#3a1a0c', 0.32 * fade * burn);
      fillSector(p, cx, cy, 0, z.r * S * 1.05, 0, TAU);
      ring(p, cx, cy, z.r * S * 1.05 + 1, '#3a1a0c', 0.2 * fade * burn, (_a, i) => hash(i, z.id, 2) > 0.5);
    }
    const reach = ck.max * eOut2(open);
    // Раскрытие: сначала трещина бежит, потом жёлоб темнеет — нутро.
    drawCrack(p, ck, cx, cy, reach, on ? '#2a0804' : C.groove, C.sandHi, fade);
    // Песок осыпается в трещину, пока она раскрывается.
    if (!on || z.t < warn + 0.2)
      dust(p, z.id, z.t, cx, cy, 3, (z.ang ?? 0) + Math.PI / 2, Math.PI, 8, 10, 1, 5, 3, 0.55, 0, 0.9);
  }),
);

/** Корзины точек жара: 3 цвета × 4 ступени, угольки × 4. */
const fireBins: number[][] = Array.from({ length: 16 }, () => []);

/** Где растут три языка пламени: точки жилы по обе стороны и в середине. */
const anchorCache = new WeakMap<Crack, number[]>();
function flameAnchors(ck: Crack, ra: number, core: number): number[] {
  let a = anchorCache.get(ck);
  if (a) return a;
  a = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const want = (i - 1) * core * 0.55;
    let best = 1e9;
    for (let q = 0; q < ck.x.length; q++) {
      const sgn = ck.x[q] * Math.cos(ra) + ck.y[q] * Math.sin(ra) >= 0 ? 1 : -1;
      const dd = Math.abs(ck.d[q] * sgn - want);
      if (dd < best) {
        best = dd;
        a[i] = q;
      }
    }
  }
  anchorCache.set(ck, a);
  return a;
}

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
    const core = ck.max * 0.62;
    const ra = (z.ang ?? 0) + Math.PI / 2;
    const scr = screenOf(S);
    const bb = crackBox(ck);
    const hid: (x: number, y: number) => boolean = scr.clear(
      ox + bb[0],
      oy + bb[1] - 24,
      ox + bb[2],
      oy + bb[3],
    )
      ? () => false
      : scr;
    // Жар в трещине: светящаяся жила, переливается; к концам — темнее.
    // Точки раскладываются по корзинам (цвет × ступень яркости) и рисуются
    // корзиной — смена цвета канвы на каждую точку стоила миллисекунды.
    const bins = fireBins;
    for (const b of bins) b.length = 0;
    const blink = Math.floor(time * 3);
    for (let i = 0; i < ck.x.length; i += 1) {
      if (ck.d[i] > core) continue;
      const w = 0.5 + 0.5 * Math.sin(time * 5 + ck.d[i] * 0.35 + (i & 3));
      const hot = env * (0.55 + 0.45 * w) * (1 - (ck.d[i] / core) * 0.4);
      let bin = -1;
      if (hot > 0.05) {
        const lvl = Math.min(3, Math.floor(Math.min(1, hot * 1.3) * 4));
        bin = (hot > 0.8 ? 2 : hot > 0.5 ? 1 : 0) * 4 + lvl;
      } else {
        // Угольки: гаснет — тлеют отдельные точки.
        const cold = (1 - env) * ember * (w > 0.55 ? 1 : 0.35);
        if (cold > 0.05 && (i + blink) % 3 === 0) bin = 12 + Math.min(3, Math.floor(cold * 4));
      }
      if (bin < 0 || hid(ox + ck.x[i], oy + ck.y[i])) continue;
      bins[bin].push(i);
    }
    for (let b = 0; b < 16; b++) {
      const list = bins[b];
      if (!list.length) continue;
      p.col(b < 12 ? C.fire[2 + (b >> 2)] : C.fire[1], ((b & 3) + 1) / 4);
      for (const i of list) p.rect(ox + ck.x[i], oy + ck.y[i], 1, 1);
    }
    // Языки пламени — посередине трещины, в центре выше.
    const anchors = flameAnchors(ck, ra, core);
    for (let i = 0; i < 3 && env > 0.02; i++) {
      const j = anchors[i];
      const base = i === 1 ? 10 : 7 + 2 * hash(sd, i, 1);
      const h = base * env * (0.8 + 0.2 * Math.sin(time * 9 + i * 1.9));
      if (h < 2.5 || hid(ox + ck.x[j], oy + ck.y[j])) continue;
      const im = flameImg(h, Math.floor(time * 12 + i * 2.3));
      p.col('#000', 1);
      p.img(im, ox + ck.x[j] - im.width / 2 + 0.5, oy + ck.y[j] - im.height + 1);
    }
    // Угольки поднимаются и гаснут; к концу — дым.
    for (let i = 0; i < 7; i++) {
      const P = 0.7 + 0.35 * hash(sd, i, 2);
      const ph = (t + hash(sd, i, 3) * P) / P;
      const cyc = Math.floor(ph);
      const u = ph - cyc;
      const j = Math.floor(hash(sd, i * 13 + cyc, 4) * ck.x.length * 0.6);
      const live = Math.max(env, ember * 0.6);
      if (live < 0.05 || hid(ox + ck.x[j], oy + ck.y[j])) continue;
      p.col(sparkCol(0.3 + 0.7 * u), (1 - u) * live);
      p.dot(ox + ck.x[j] + Math.sin(u * 5 + i) * 2, oy + ck.y[j] - u * (13 + 7 * hash(sd, i, 5)));
    }
    if (env < 0.7 && endIn > 0.1) {
      const smoke = (1 - env) * ember;
      for (let i = 0; i < 3; i++) {
        const u = (t * 0.8 + i / 3) % 1;
        const j = Math.floor(((i + 0.5) / 3) * ck.x.length * 0.6);
        if (hid(ox + ck.x[j], oy + ck.y[j])) continue;
        const im = puffImg(2, 2 + 3 * u, i);
        p.col('#000', smoke * 0.6 * (1 - u));
        p.img(im, ox + ck.x[j] - im.width / 2 + Math.sin(u * 4 + i) * 2, oy + ck.y[j] - 4 - u * 12 - im.height / 2);
      }
    }
  }),
);

// =============================================================================
// РЫВОК: прицел (`f5_fxlane`) — стрелки бегут по полосе, пока бык водит
// рогами — тускло; замер — «щелчок» по полосе и стрелки горят; последние
// 0,28 с (окно уклона) — жёлтые. На конце — куда врежется (звезда трещин у
// стены) или где его занесёт (стоп-черта). Полоса — поверх всего: движок
// кладёт на неё свой красный прямоугольник (`m.tele`), под ним стрелки
// тонули. Бег (`f5_fxdust`) — клубы пыли за копытами, 10 в секунду, на
// старте — рывок из-под копыт веером. Занос
// (`f5_fxskid`) — две борозды, песок веером, искры с подков. Стена
// (`f5_fxwall`, поверх всех: обломки летят в камеру) — трещины в кладке,
// обломки назад, пыль по стене, песок
// сыплется сверху; колонна — обломки вперёд и уголья факела.
// =============================================================================

/** Галочка «>» в два пикселя: остриё в (x, y), смотрит по (ux, uy). */
function chevron(p: Pen, x: number, y: number, ux: number, uy: number, s: number, c: string, a: number): void {
  const nx = -uy;
  const ny = ux;
  for (const side of [-1, 1]) {
    const ex = x + (-ux * 0.62 + nx * side * 0.78) * s;
    const ey = y + (-uy * 0.62 + ny * side * 0.78) * s;
    p.lineS(x, y, ex, ey, c, a, 0.55);
    p.col(c, a);
    p.line(x - ux, y - uy, ex - ux, ey - uy);
  }
}

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
    const col = danger ? (blink ? C.white : C.yellow) : lock ? C.orange : C.redHot;
    // Кромки полосы в два пикселя: пунктир бежит вперёд.
    const run = time * (lock ? 70 : 26);
    for (const s of [-1, 1])
      for (let u = r0; u < L; u += 1) {
        if (!danger && (u - run) % 8 > 5) continue;
        const x = mx + ux * u + nx * W * s;
        const y = my + uy * u + ny * W * s;
        p.col(C.ink, 0.55);
        p.dot(x + nx * s, y + ny * s);
        p.col(col, danger ? 1 : lock ? 0.9 : 0.6);
        p.dot(x, y);
      }
    // Стрелки-«галочки» по полосе.
    const gap = 16;
    const off = (time * (lock ? 64 : 18)) % gap;
    for (let u = r0 + 7 + off; u < L - 6; u += gap) {
      const bright = danger ? 1 : lock ? 0.85 : 0.4;
      chevron(p, mx + ux * u, my + uy * u, ux, uy, 7, col, bright * k01((L - 6 - u) / 10));
    }
    // Щелчок замера: вспышка бежит по полосе от быка к концу.
    const lt = t - T * 0.55;
    if (lt >= 0 && lt < 0.14) {
      const u = r0 + (L - r0) * (lt / 0.14);
      p.lineS(mx + ux * u + nx * W, my + uy * u + ny * W, mx + ux * u - nx * W, my + uy * u - ny * W, C.white, 1, 0.5);
    }
    // Конец полосы: стена — звезда трещин; нет стены — стоп-черта.
    const ex = mx + ux * L;
    const ey = my + uy * L;
    if (m.data.wall) {
      const pulse = 0.5 + 0.5 * Math.sin(time * (lock ? 16 : 7));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2;
        const r1 = 3 + (i & 1 ? 3 : 6) + (lock ? pulse * 2 : 0);
        p.lineS(ex + Math.cos(a) * 2, ey + Math.sin(a) * 2, ex + Math.cos(a) * r1, ey + Math.sin(a) * r1, danger ? C.yellow : C.orange, lock ? 1 : 0.6, 0.5);
      }
    } else {
      for (let s = -W; s <= W; s += 1)
        if ((s + 20) % 4 < 2.5) {
          p.col(C.ink, 0.5);
          p.dot(ex + nx * s + ux, ey + ny * s + uy);
          p.col(danger ? C.yellow : C.orange, lock ? 0.9 : 0.5);
          p.dot(ex + nx * s, ey + ny * s);
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
    // Следы копыт: вывороченный песок, тает.
    const mark = 1 - k01((t - 0.35) / 0.55);
    for (let i = 0; i < 2; i++) {
      const b = len * (0.25 + 0.5 * i);
      const s = i ? -3 : 3;
      const x = cx - ux * b - uy * s;
      const y = cy - uy * b + ux * s;
      p.col(C.sandShade, 0.75 * mark);
      p.dot(x - 1, y, 3, 1);
      p.col(C.sandHi, 0.7 * mark);
      p.dot(x - 1, y + 1, 3, 1);
    }
    // Клубы: по полосе пройденного за 0,1 с, сносит назад и вбок, тают.
    for (let i = 0; i < 2; i++) {
      const b = len * (0.2 + 0.5 * i);
      const side = (i % 2 ? 1 : -1) * (2 + 3 * hash(sd, i, 1));
      dust(p, sd * 7 + i, t, cx - ux * b - uy * side, cy - uy * b + ux * side + 1, 1, a + Math.PI + (i % 2 ? 0.7 : -0.7), 0.4, 14, 10, 2, 7, 7, 0.6, 0, 0.85);
    }
    // Старт рывка: копыта рвут песок — веер назад и клубы.
    if ((z.n ?? 0) > 0) {
      dust(p, sd * 3 + 1, t, cx - ux * 6, cy - uy * 6 + 1, 4, a + Math.PI, 0.9, 30, 20, 3, 9, 6, 0.8, 0, 0.95);
      for (let i = 0; i < 12; i++) {
        const f = fly(t, 50 + 40 * hash(sd, i, 15), 430, 0);
        if (!f.air) continue;
        const th = a + Math.PI + (hash(sd, i, 16) - 0.5) * 1.8;
        const v = 60 + 50 * hash(sd, i, 17);
        const gx = cx + Math.cos(th) * v * f.h;
        const gy = cy + Math.sin(th) * v * f.h - f.z;
        p.col(C.ink, 0.45);
        p.dot(gx + 1, gy + 1);
        p.col(i & 1 ? C.white : C.sandHi, 1);
        p.dot(gx, gy);
      }
    }
    // Песчинки из-под копыт.
    for (let i = 0; i < 4; i++) {
      const f = fly(t, 40 + 25 * hash(sd, i, 5), 430, 0);
      if (!f.air) continue;
      const th = a + Math.PI + (hash(sd, i, 6) - 0.5) * 1.4;
      const v = 38 + 25 * hash(sd, i, 7);
      const gx = cx + Math.cos(th) * v * f.h;
      const gy = cy + Math.sin(th) * v * f.h - f.z;
      p.col(C.ink, 0.45);
      p.dot(gx + 1, gy + 1);
      p.col(C.sandHi, 1);
      p.dot(gx, gy);
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
      p.col(C.sandHi, 0.9 * fade);
      p.line(x0 + 1, y0 + 1, x0 + ux * L + 1, y0 + uy * L + 1);
      p.col(C.groove, 0.9 * fade);
      p.line(x0, y0, x0 + ux * L, y0 + uy * L);
      const im = puffImg(0, 1 + Math.min(3, L / 7), 1);
      p.col('#000', fade);
      p.img(im, x0 + ux * (L + 2) - im.width / 2, y0 + uy * (L + 2) - im.height / 2);
    }
    // Песок веером вперёд-вбок и искры с подков, пока скорость велика.
    for (let i = 0; i < 14; i++) {
      const ti = i * 0.028;
      const age = t - ti;
      if (age < 0 || age > 0.45) continue;
      const side = i % 2 ? 1 : -1;
      const fx0 = cx + ux * at(ti) * S - uy * side * 4;
      const fy0 = cy + uy * at(ti) * S + ux * side * 4;
      const th = a + side * (0.6 + 0.8 * hash(sd, i, 1));
      const f = fly(age, 45 + 30 * hash(sd, i, 2), 430, 0);
      if (f.air) {
        const vv = 70 + 50 * hash(sd, i, 3);
        for (const kk of [1, 0.8, 0.62]) {
          const gx = fx0 + Math.cos(th + (1 - kk)) * vv * kk * f.h;
          const gy = fy0 + Math.sin(th + (1 - kk)) * vv * kk * f.h - f.z * kk;
          p.col(C.ink, 0.45);
          p.dot(gx + 1, gy + 1);
          p.col(kk < 1 ? C.sandHi : C.white, 1);
          p.dot(gx, gy);
        }
      }
      if (i < 9) sparks(p, sd * 5 + i, age, fx0, fy0 - 1, 1, a + side * 0.3, 0.5, 70, 50, 0.24, 70);
    }
    // Пыль из-под копыт в стороны, пока едет, и догоняет, когда встал.
    for (const s of [-1, 1])
      dust(p, sd + (s > 0 ? 3 : 5), t, cx + ux * L - uy * s * 6, cy + uy * L + ux * s * 6, 3, a + s * 1.3, 0.5, 26, 14, 2, 8, 6, 0.9, 0, 0.9, 0.3);
    dust(p, sd, t - 0.08, cx + ux * L, cy + uy * L, 4, a, 0.9, 16, 12, 3, 10, 6, 1.0, 0, 0.85, 0.2);
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
      // Слой поверх всех: стену за спиной быка он не рисует (`screenOf`).
      const hid = screenOf(S);
      if (!hid(cx, cy - 4)) {
        const ck = crackOf(`wall|${sd}`, sd, starBranches(sd, 7, a + Math.PI, 8, 16, 3), 0.5, 0.3);
        drawCrack(p, ck, cx, cy - 4, ck.max * eOut3(k01(t / 0.09)), C.deep, '#b09a86', fade);
        p.col('#b09a86', fade);
        lens(p, cx + 1, cy - 3, 1, 0, 4, 3);
        p.col(C.deep, fade);
        lens(p, cx, cy - 4, 1, 0, 3.4, 2.6);
      }
      // Песок сыплется со стены ещё секунду.
      for (let i = 0; i < 12; i++) {
        const t0 = 0.05 + 0.9 * hash(sd, i, 7);
        const u = t - t0;
        if (u < 0 || u > 0.45) continue;
        const gx = cx + (hash(sd, i, 8) - 0.5) * 18;
        const gy = cy - 18 + (hash(sd, i, 9) - 0.5) * 6 + 160 * u * u;
        p.col(C.ink, 0.4);
        p.dot(gx + 1, gy + 1);
        p.col(i % 2 ? C.sandHi : '#b09a86', 1 - u / 0.45);
        p.dot(gx, gy);
      }
    }
    // Обломки: от стены — назад, колонна — разлетается вперёд.
    const back = pillar ? a : a + Math.PI;
    stones(p, sd, t, cx, cy, few ? 6 : pillar ? 20 : 14, back, pillar ? 1.35 : 1.05, 30, 50, 70, 80, pillar ? 2 : 1, [z.life - 1.1, z.life - 0.3], pillar ? 0.55 : 0.45);
    // Пыль: клуб от удара встаёт и уходит вверх (слой поверх быка — он
    // накрывает его на миг и рассеивается), вдоль стены в обе стороны.
    dust(p, sd + 1, t, cx, cy - 4, few ? 3 : 5, back, 0.8, 22, 22, 4, pillar ? 12 : 10, pillar ? 22 : 14, 0.95, 0, 0.8);
    dust(p, sd + 2, t, cx, cy, few ? 2 : 3, a + Math.PI / 2, 0.35, 22, 16, 3, 8, 6, 0.9, 1, 0.75);
    dust(p, sd + 3, t, cx, cy, few ? 2 : 3, a - Math.PI / 2, 0.35, 22, 16, 3, 8, 6, 0.9, 1, 0.75);
    dust(p, sd + 4, t, cx, cy, few ? 1 : 3, back, 0.9, 34, 20, 2, 6, 4, 0.8, 0, 0.85);
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
    p.col(C.sandHi, 0.6 * mark);
    for (const s of [-1.3, 1.3]) lens(p, cx - uy * s + 1, cy + ux * s + 1, ux, uy, 2, 1);
    p.col(C.sandShade, 0.7 * mark);
    for (const s of [-1.3, 1.3]) lens(p, cx - uy * s, cy + ux * s, ux, uy, 2, 1);
    // Тяжёлый шаг — толчок кольцом по песку и пыль в стороны.
    if (t < 0.22) dustRing(p, z.id, cx, cy, 4 + 9 * eOut2(t / 0.22), 0.8 * (1 - t / 0.22));
    dust(p, z.id, t, cx, cy, 2, a + Math.PI / 2, 0.4, 18, 8, 2, 6, 3, 0.6, 0, 0.9);
    dust(p, z.id + 5, t, cx, cy, 2, a - Math.PI / 2, 0.4, 18, 8, 2, 6, 3, 0.6, 0, 0.9);
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
    const sy = kind === 1 || kind === 3 ? cy - 6 : cy;
    // Звезда удара — у стены и рога (у секиры она на полу, в контакте).
    if (kind !== 0 && t < 0.12) {
      const k = t / 0.12;
      const r = (kind === 2 ? 11 : 16) * (1 - 0.45 * k);
      p.col(k < 0.4 ? '#ffffff' : C.yellow, 1);
      star(p, cx, sy, r, kind === 2 ? 6 : 8, a);
    }
    // Рог в героя: штрихи удара расходятся.
    if (kind === 2 && t < 0.16) {
      const k = t / 0.16;
      for (let i = 0; i < 7; i++) {
        const th = a + (i / 7 - 0.5) * 2.4;
        const r0 = 6 + 12 * eOut2(k);
        p.lineS(cx + Math.cos(th) * r0, cy + Math.sin(th) * r0, cx + Math.cos(th) * (r0 + 6), cy + Math.sin(th) * (r0 + 6), '#ffffff', 1 - k, 0.5);
      }
    }
    const dir = kind === 1 ? a + Math.PI : a;
    const n = few ? 4 : ([12, 14, 7, 16][kind] ?? 8);
    sparks(p, sd, t, cx, sy, n, dir, kind === 0 ? 1.4 : 1.1, 70, 80, 0.42, kind === 0 ? 80 : 50);
    // Колонна: уголья упавшего факела медленно поднимаются.
    if (kind === 3)
      for (let i = 0; i < 10; i++) {
        const L = 0.7 + 0.5 * hash(sd, i, 1);
        if (t > L) continue;
        const u = t / L;
        p.col(sparkCol(0.35 + 0.65 * u), 1 - u);
        p.dot(cx + (hash(sd, i, 2) - 0.5) * 16 + Math.sin(u * 6 + i) * 2, cy - 6 - u * (16 + 8 * hash(sd, i, 3)));
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
    const z = u > 0 && u < 0.3 ? Math.round(Math.sin((u / 0.3) * Math.PI) * (3 + 4 * hash(sd, i, 3))) : 0;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (z) {
      p.col(C.ink, 0.35);
      p.dot(x - 1, y + 1, 2, 1);
    }
    const im = stoneImg(1 + (i % 3 === 0 ? 1 : 0), i & 3, 0);
    p.col('#000', 1);
    p.img(im, x - im.width / 2, y - z - im.height / 2);
  }
}

/** Пыльное кольцо по полу: рваное, с тенью. */
function dustRing(p: Pen, sd: number, cx: number, cy: number, r: number, a: number): void {
  const keep = (_a: number, i: number) => hash(i >> 2, sd, 3) > 0.22;
  ring(p, cx, cy, r + 1, C.sandDk, a * 0.7, keep);
  ring(p, cx, cy, r, '#f0e2c0', a, keep, 0.4);
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
      const ck = crackOf(`roar|${sd % 97}`, sd, starBranches(sd, 6, 0.4, S * 0.7, S * 1.3, 2), 0.5, 0.25);
      drawCrack(p, ck, cx, cy + 2, ck.max * eOut3(k01((t - 0.25) / 0.12)), C.groove, C.sandHi, fade);
    }
    for (const t0 of [0.25, 0.62, 0.98]) {
      const u = t - t0;
      if (u < 0 || u >= 0.42) continue;
      const k = u / 0.42;
      const rr = S * (1.1 + 2.8 * eOut2(k));
      dustRing(p, sd + Math.round(t0 * 10), cx, cy + 1, rr, 0.95 * (1 - k));
      dustRing(p, sd + Math.round(t0 * 10) + 1, cx, cy + 1, rr - 3, 0.6 * (1 - k));
      // Пыль встаёт по кольцу толчка.
      for (let i = 0; i < 10; i++) {
        const ph = (i / 10) * TAU + hash(sd, i, Math.round(t0 * 10)) * 0.5;
        const im = puffImg(0, 2 + 3 * k, i);
        p.col('#000', 0.8 * (1 - k));
        p.img(im, cx + Math.cos(ph) * rr - im.width / 2, cy + 1 + Math.sin(ph) * rr - 3 * k - im.height / 2);
      }
    }
    const last = t > 0.98 ? t - 0.98 : t > 0.62 ? t - 0.62 : t - 0.25;
    if (t > 0.25) pebbles(p, sd, last, cx, cy, 12, S * 1.4, S * 3.2);
    if (t > 0.25) dust(p, sd, t - 0.25, cx, cy + 2, reduced() ? 2 : 6, 0, Math.PI, 18, 10, 3, 7, 3, 0.9, 0, 0.85);
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
    if (t < 0.4) dustRing(p, sd, cx, cy + 1, S * (1 + 2.6 * eOut2(t / 0.4)), 0.9 * (1 - t / 0.4));
    pebbles(p, sd, t, cx, cy, 14, S * 1.3, S * 4);
    dust(p, sd, t, cx, cy + 2, reduced() ? 3 : 8, 0, Math.PI, 22, 14, 3, 9, 4, 1.1, 0, 0.85);
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
    const glow = fade * (0.6 + 0.4 * Math.sin(time * 6));
    p.col(rage ? C.fire[3] : C.redHot, glow);
    for (let i = 0; i < ck.x.length && ck.d[i] <= reach; i += 1)
      if (ck.d[i] < ck.max * 0.5 && (i & 1) === 0) p.dot(ox + ck.x[i], oy + ck.y[i]);
    if (t < 0.5) dustRing(p, sd, cx, cy + 1, S * (1.2 + 3.6 * eOut2(t / 0.5)), 0.95 * (1 - t / 0.5));
    stones(p, sd, t, cx, cy, reduced() ? 5 : 16, 0, Math.PI, 30, 44, 80, 80, 0, [z.life - 1.2, z.life - 0.2], 0.45);
    dust(p, sd, t, cx, cy + 2, reduced() ? 4 : 12, 0, Math.PI, 28, 16, 4, 12, 7, 1.6, 0, 0.9);
  }),
);

// =============================================================================
// ПРОГРЕВ: заготовки техник рисуются до боя, по одной на шаг (движок тратит
// на прогрев до 3 мс за кадр, пока бык в мире) — первый клуб пыли, камень
// или язык пламени не рисуется впервые посреди удара. Генератор тела быка
// (`f5-art` грузится раньше, см. `art.ts`) идёт первым и не теряется.
// =============================================================================

function* warmFx(): Generator<unknown> {
  for (let r = 1; r <= 100; r++) {
    circle(r);
    yield;
  }
  for (let pal = 0; pal < PUFF_PAL.length; pal++)
    for (let r = 1; r <= 16; r++)
      for (let v = 0; v < 4; v++) {
        puffImg(pal, r, v);
        yield;
      }
  for (let pal = 0; pal < STONE_PAL.length; pal++)
    for (let sz = 1; sz <= 4; sz++)
      for (let f = 0; f < 4; f++) {
        stoneImg(sz, f, pal);
        yield;
      }
  for (let h = 3; h <= 12; h++)
    for (let f = 0; f < 4; f++) {
      flameImg(h, f);
      yield;
    }
  stunStar(0);
  stunStar(1);
}

const bodyWarm = MOB_WARM.get('f5_minotaur');
registerMobWarm('f5_minotaur', function* () {
  if (bodyWarm) {
    const it = bodyWarm();
    while (!it.next().done) yield;
  }
  yield* warmFx();
});
