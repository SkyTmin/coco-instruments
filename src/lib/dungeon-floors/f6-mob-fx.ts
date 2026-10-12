// Этаж 6 — снаряды, метки и контакты мобов (анимации мобов 6). Только
// рисунок: мозг этажа не тронут, все id те же, что ставит мозг.
//
// - Плевок червя `f6_glob` — ком лавы на навесе, за ним капли по ходу
//   (направление на экране — с учётом подъёма и спуска дуги).
// - Его контакт (событие `strike` в миг падения) — брызги дугами и волна;
//   дальше лежит лужа `f6_lavapool` (рисует `f6-art.ts`).
// - Петарда беса `f6_cracker`: палочка падает с отскоком, фитиль горит
//   вниз, кольцо метки замыкается к взрыву, последние 0,15 с — белое.
//   Контакт — вспышка-звезда, искры, клочья обёртки и дым поверх темноты.

import { Px } from '../dungeon-art';
import {
  frameLRU,
  registerImpactPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { Sprite } from '../dungeon-paint';
import type { Shot, Strike } from '../dungeon-sim';
import { clamp01, FIRE, hash, hx, INK, PI, TAU } from './f6-mobkit';
import type { RGBA } from './f6-mobkit';

const TS = 16;
const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${clamp01(a) * (c[3] / 255)})`;
const seg = (x: number, a: number, b: number) => clamp01((x - a) / (b - a));
const eOut = (k: number) => 1 - (1 - k) ** 3;

const LAVA = {
  dark: hx('#a8240a'),
  hot: hx('#ff8a1e'),
  bright: hx('#ffc440'),
  white: hx('#fff4b0'),
  crust: hx('#2a1210'),
  crustLt: hx('#4a2018'),
};
const SMOKE = hx('#5a524e');
const PAPER = hx('#c8201a');
const PAPER_LT = hx('#f0e0a0');

const SMOKE_LT = hx('#8a8078');

/** Пиксельный круг (строками) в текущий путь — заливку делает вызывающий. */
function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  const R = Math.max(1, Math.round(r));
  for (let dy = -R; dy <= R; dy++) {
    const w = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
    g.rect(cx - w, cy + Math.round(dy * 0.8), w * 2 + 1, 1);
  }
}

/** Точка в пикселях (без сглаживания). */
function dot(g: CanvasRenderingContext2D, x: number, y: number, c: RGBA, a = 1, s = 1): void {
  if (a <= 0.02) return;
  g.fillStyle = css(c, a);
  g.fillRect(Math.round(x), Math.round(y), s, s);
}

// ---- Плевок червя: ком со следом ----------------------------------------------------------

const GLOB = frameLRU<Sprite>(160);

function globSprite(f: number, d: number, len: number): Sprite {
  const key = `${f}|${d}|${len}`;
  const hit = GLOB.get(key);
  if (hit) return hit;
  const W = 26;
  const c = W / 2;
  const p = new Px(W, W);
  // След: капли назад по ходу, дальше — мельче и темнее.
  const a = (d / 16) * TAU + PI;
  const n = 2 + len * 2;
  for (let i = n; i >= 1; i--) {
    const r = 2.6 + i * (1.6 + len * 0.6);
    const wob = ((i + f) % 2 ? 0.6 : -0.6) * (i > 1 ? 1 : 0);
    const x = c + Math.cos(a) * r - Math.sin(a) * wob;
    const y = c + Math.sin(a) * r + Math.cos(a) * wob;
    const k = i / n;
    const col = k > 0.7 ? LAVA.crustLt : k > 0.4 ? LAVA.dark : LAVA.hot;
    if (i === 1 || k < 0.5) p.ell(x, y, 1.3 - k * 0.5, 1.2 - k * 0.5, col);
    else p.set(Math.round(x), Math.round(y), col);
  }
  // Ком: корка, горячее нутро, блик сверху-слева.
  p.ell(c, c, 4, 3.6, LAVA.crust);
  p.ell(c + (f % 2 ? 0.5 : -0.5), c - 0.4, 2.8, 2.4, LAVA.hot);
  p.ell(c - 0.6, c - 1, 1.2, 1, LAVA.white);
  p.outline(INK);
  // Трещины корки светятся (кадр f — где именно).
  p.set(c + 2 - (f % 3), c + 2, LAVA.bright);
  return GLOB.set(key, { img: p.canvas(), ax: c, ay: c });
}

registerShotPainter('f6_glob', (s: Shot, time) => {
  const f = Math.floor(time * 12) % 4;
  // Скорость на экране: по полу + подъём/спуск дуги навеса.
  const vx = s.vx * TS;
  let vy = s.vy * TS;
  if (s.lob) {
    const T = Math.max(0.05, s.lob.T);
    const k = Math.min(1, s.age / T);
    const H = Math.min(3, T * 2.2);
    vy -= Math.cos(k * PI) * (PI / T) * H * TS;
  }
  const sp = Math.hypot(vx, vy);
  if (sp < 8) return globSprite(f, 0, -1);
  const d = ((Math.round((Math.atan2(vy, vx) / TAU) * 16) % 16) + 16) % 16;
  return globSprite(f, d, sp > 90 ? 1 : 0);
});

// Шлепок плевка: брызги дугами, волна, капли остывают коркой.
registerImpactPainter('f6_glob', {
  life: 0.7,
  shake: 0.05,
  paint(g, rec, px, py, _s, age) {
    const sd = rec.seed >>> 0;
    const R = 0.85 * TS;
    // Волна по луже — тонкое кольцо наружу.
    const w = eOut(seg(age, 0, 0.22));
    if (age < 0.3) {
      g.strokeStyle = css(LAVA.bright, 0.8 * (1 - seg(age, 0.12, 0.3)));
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(px, py, R * (0.3 + 0.8 * w), R * (0.3 + 0.8 * w) * 0.6, 0, 0, TAU);
      g.stroke();
    }
    // Вспышка в миг падения.
    if (age < 0.07) {
      dot(g, px - 2, py - 1, LAVA.white, 1, 4);
      dot(g, px - 1, py - 3, LAVA.white, 1, 2);
    }
    // Брызги: 10 капель дугами; упала — тлеет и темнеет.
    for (let i = 0; i < 10; i++) {
      const an = hash(sd, i, 1) * TAU;
      const v = 0.5 + hash(sd, i, 2) * 0.6;
      const T = 0.22 + hash(sd, i, 3) * 0.12;
      const k = Math.min(1, age / T);
      const x = px + Math.cos(an) * R * 1.3 * v * k;
      const y = py + Math.sin(an) * R * 0.8 * v * k - Math.sin(k * PI) * 7 * v;
      const cool = seg(age, T, 0.7);
      const col = k < 1 ? (i % 3 ? LAVA.hot : LAVA.white) : cool < 0.5 ? LAVA.dark : LAVA.crustLt;
      dot(g, x, y, col, 1 - seg(age, 0.5, 0.7));
    }
    return age < 0.7;
  },
});

// ---- Петарда беса ------------------------------------------------------------------------

registerZonePainter('f6_cracker', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const warn = Math.max(0.05, st.warn ?? 0.75);
  const t = st.t;
  const k = Math.min(1, t / warn);
  const R = z.r * TS;
  const id = ((st.id % 97) + 97) % 97;
  // Метка: кольцо замыкается к взрыву (с 1,5 R до R), внутри наливается.
  const ring = R * (1 + 0.5 * (1 - eOut(k)));
  const end = warn - t < 0.15;
  g.fillStyle = css(FIRE[1], 0.08 + 0.18 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  g.strokeStyle = end ? css(hx('#ffffff'), 0.95) : css(FIRE[2], 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, ring, ring * 0.8, 0, 0, TAU);
  g.stroke();
  if (ring > R + 0.5) {
    g.strokeStyle = css(FIRE[1], 0.3 + 0.4 * k);
    g.beginPath();
    g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
    g.stroke();
  }
  // Палочка: прилетела из-за плеча — падает, отскок, лежит наискось.
  const drop = t < 0.16 ? (1 - t / 0.16) * 7 : t < 0.26 ? Math.sin(((t - 0.16) / 0.1) * PI) * 2 : 0;
  const x0 = Math.round(px) - 1;
  const y0 = Math.round(py - drop);
  const lean = id % 2 ? 1 : -1;
  // Тень под ней.
  dot(g, x0 - 1, Math.round(py) + 1, hx('#000000'), 0.35, 4);
  for (let i = 0; i < 4; i++) {
    dot(g, x0 + (i < 2 ? 0 : lean), y0 - i, i === 3 ? PAPER_LT : PAPER);
    dot(g, x0 + 1 + (i < 2 ? 0 : lean), y0 - i, i === 3 ? PAPER_LT : hx('#8a1410'));
  }
  // Фитиль горит вниз: искра ползёт к палочке, вокруг брызжет.
  const fl = Math.round(3 * (1 - k));
  const fx = x0 + lean + (lean > 0 ? 1 : 0);
  for (let i = 1; i <= fl; i++) dot(g, fx + lean * (i > 1 ? 1 : 0), y0 - 3 - i, hx('#3a2a20'));
  const sx = fx + lean * (fl > 1 ? 1 : 0);
  const sy = y0 - 4 - fl;
  const fr = Math.floor(time * 20);
  dot(g, sx, sy, FIRE[4]);
  for (let i = 0; i < 3; i++) {
    const an = hash(fr, i, id) * TAU;
    const d = 1 + hash(fr, i, id + 7) * 2.5;
    dot(g, sx + Math.cos(an) * d, sy + Math.sin(an) * d - 1, i ? FIRE[3] : FIRE[4], 0.9);
  }
  return true;
});

// Взрыв петарды — поверх темноты: звезда, искры, клочья обёртки, дым.
registerImpactPainter('f6_cracker', {
  life: 0.6,
  shake: 0.12,
  flash: 0.12,
  flashRgb: '255,170,80',
  above: true,
  paint(g, rec, px, py, _s, age) {
    const sd = rec.seed >>> 0;
    const R = 0.85 * TS;
    // Дым — клубы расползаются и поднимаются; одна заливка на все клубы (без
    // тёмных нахлёстов), сверху-слева — светлее.
    if (age > 0.03) {
      const k = eOut(seg(age, 0.03, 0.6));
      const a = 0.6 * (1 - seg(age, 0.25, 0.6));
      for (const [col, off, sh] of [
        [SMOKE, 0, 1],
        [SMOKE_LT, -1, 0.6],
      ] as const) {
        g.beginPath();
        for (let i = 0; i < 4; i++) {
          const an = (i / 4) * TAU + hash(sd, i, 9) * 0.8;
          const x = px + Math.cos(an) * R * 0.45 * k + off;
          const y = py - 3 - k * 7 + Math.sin(an) * R * 0.25 * k + off;
          disc(g, x, y, (2 + k * 3.5) * sh);
        }
        g.fillStyle = css(col, a);
        g.fill();
      }
    }
    // Звезда вспышки: крест и диагонали, 0,1 с.
    if (age < 0.1) {
      const k = 1 - age / 0.1;
      const L = 3 + 7 * (1 - k * 0.4);
      g.fillStyle = css(hx('#fff8d0'), k);
      g.fillRect(Math.round(px - L), Math.round(py - 3), Math.round(L * 2), 1);
      g.fillRect(Math.round(px), Math.round(py - 3 - L * 0.7), 1, Math.round(L * 1.4));
      g.fillStyle = css(FIRE[3], k);
      g.fillRect(Math.round(px - 3), Math.round(py - 6), 6, 6);
      for (let i = 1; i < L * 0.6; i++) {
        dot(g, px + i, py - 3 - i, FIRE[4], k);
        dot(g, px - i, py - 3 - i, FIRE[4], k);
        dot(g, px + i, py - 3 + i, FIRE[3], k);
        dot(g, px - i, py - 3 + i, FIRE[3], k);
      }
    }
    // Искры веером с тяжестью.
    for (let i = 0; i < 12; i++) {
      const an = hash(sd, i, 1) * TAU;
      const v = 0.5 + hash(sd, i, 2) * 0.7;
      const k = Math.min(1, age / 0.4);
      const x = px + Math.cos(an) * R * 1.5 * v * eOut(k);
      const y = py - 3 + Math.sin(an) * R * 0.9 * v * eOut(k) - (1 - k) * k * 10 * v + k * k * 4;
      dot(g, x, y, i % 3 ? FIRE[3] : FIRE[4], 1 - seg(age, 0.2, 0.42));
    }
    // Клочья обёртки: красные и жёлтые, падают кувырком.
    for (let i = 0; i < 6; i++) {
      const an = hash(sd, i, 5) * TAU;
      const v = 0.4 + hash(sd, i, 6) * 0.5;
      const k = Math.min(1, age / 0.55);
      const x = px + Math.cos(an) * R * 1.1 * v * eOut(k);
      const y = py - 3 + Math.sin(an) * R * 0.5 * v - Math.sin(k * PI) * 9 * v + k * 3;
      const fl = (Math.floor(age * 24) + i) % 2;
      dot(g, x, y, i % 2 ? PAPER : PAPER_LT, 1 - seg(age, 0.45, 0.6), fl ? 2 : 1);
    }
    return age < 0.6;
  },
});
