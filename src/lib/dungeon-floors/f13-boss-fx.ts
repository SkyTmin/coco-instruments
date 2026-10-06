// Этаж 13 «Театр марионеток» — нити, лучи, метки, зоны и контакты.
//
// Две зоны-режиссёра (их держит правило этажа у героя):
//  • `f13_strings` — поверх темноты: золотые нити кукол к ваге, столбы
//    света софитов и луны, волны «Бури», звёзды-маятники «Звёздной ночи»,
//    нити исполина к ваге Кукловода, его метки (рубка, укол, аркан, иглы);
//  • `f13_stage` — на полу: пятна софитов, тени звёзд, пена волн.
// Остальное — короткие зоны `api.vfx` (лопнувшая нить, опилки, люк, звонок,
// занавес), удары по площади (мешок, пожарный занавес, барабан, сетка нитей,
// молния, «по памяти»), снаряды (листок роли, нота, слеза, игла) и их контакт.
//
// Координаты — игровые пиксели (16 на клетку); рисуем векторно, тонко.

import {
  paintSim,
  registerImpactPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { Px } from '../dungeon-art';
import { BOSS, F13_FX, F13_SCENERY, SPOT, stringsOf } from './f13-brains';
import { css, giantShoulderPx, hash, hx, INK, lordVagaPx, P, spiderLift, TAU } from './f13-art';
import type { RGBA } from './f13-art';

const GOLD = P.gold;
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (k: number) => {
  const v = k01(k);
  return v * v * (3 - 2 * v);
};
const zf = (z: Zone | Strike, key: string): number =>
  (z as unknown as Record<string, number>)[key] ?? 0;
const rgba = (c: RGBA, a: number) => css(c, Math.max(0, Math.min(1, a)));

/** Мир → экран относительно точки зоны. */
function viewOf(z: { x: number; y: number }, px: number, py: number, S: number) {
  return (wx: number, wy: number): [number, number] => [px + (wx - z.x) * S, py + (wy - z.y) * S];
}

// ---------------------------------------------------------------------------
// Нити кукол.
// ---------------------------------------------------------------------------

/** Высота плеч куклы над её точкой на полу, пиксели (куда крепится нить). */
function shoulderH(m: Mob, time: number): number {
  switch (m.kind) {
    case 'f13_giant':
      return giantShoulderPx(m, time);
    case 'f13_nutcracker':
      return 24;
    case 'f13_spider':
      return 8 + spiderLift(m);
    case 'f13_prompter':
    case 'f13_cashier':
      return 12;
  }
  return 18;
}

/** Вага Кукловода на экране: [x, y, сдвиг от его точки на полу по y]. */
function vagaScreen(
  to: (x: number, y: number) => [number, number],
  time: number,
): [number, number, number] | null {
  const lord = F13_FX.mobs.find((q) => q.kind === 'f13boss' && q.mode !== 'dying');
  if (!lord) return null;
  const [x, y] = to(lord.x, lord.y);
  const [dx, dy] = lordVagaPx(lord, time);
  return [x + dx, y + dy, dy];
}

/** Нить: чуть провисшая, с бегущим бликом. */
function thread(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  a: number,
  time: number,
  seed: number,
  w = 0.7,
  col: RGBA = GOLD[2],
): void {
  const mx = (x0 + x1) / 2 + Math.sin(time * 1.7 + seed) * 1.2;
  const my = (y0 + y1) / 2 + 1.5;
  g.strokeStyle = rgba(col, a);
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.quadraticCurveTo(mx, my, x1, y1);
  g.stroke();
  // Блик бежит вверх по нити.
  const k = (time * 0.6 + seed * 0.13) % 1;
  const bx = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * mx + k * k * x1;
  const by = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * my + k * k * y1;
  g.fillStyle = rgba(GOLD[3], a);
  g.fillRect(bx - 0.6, by - 0.6, 1.2, 1.2);
}

/** Маленькая вага (крестовина) — куда сходятся нити куклы. */
function crossbar(g: CanvasRenderingContext2D, x: number, y: number, a: number): void {
  g.strokeStyle = rgba(P.wood[2], a);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(x - 4, y);
  g.lineTo(x + 4, y);
  g.moveTo(x, y - 2.5);
  g.lineTo(x, y + 2.5);
  g.stroke();
  g.fillStyle = rgba(GOLD[3], a);
  g.fillRect(x - 4.5, y - 0.5, 1, 1);
  g.fillRect(x + 3.5, y - 0.5, 1, 1);
}

function drawStrings(
  g: CanvasRenderingContext2D,
  to: (x: number, y: number) => [number, number],
  hx0: number,
  hy0: number,
  time: number,
): void {
  const vaga = vagaScreen(to, time);
  for (const m of F13_FX.mobs) {
    if (m.mode === 'dying' || (m.data.sn ?? 0) <= 0) continue;
    if (Math.abs(m.x - hx0) > 14 || Math.abs(m.y - hy0) > 12) continue;
    const segs = stringsOf(m);
    if (!segs.length) continue;
    const sh = shoulderH(m, time);
    const ghost = (m.data.ghost ?? 0) > 0;
    const a = ghost ? 0.25 : 0.85;
    const giant = m.kind === 'f13_giant';
    let ax = 0;
    let ay = 0;
    for (const s of segs) {
      const [x0, y0] = to(s.ax, s.ay);
      const lx = x0;
      const ly = y0 + (giant ? 0.55 : 0.18) * 16 - sh;
      const [x1, y0b] = to(s.bx, s.by);
      // Нить исполина уходит в вагу в руке Кукловода (точка нити — на 4 px
      // ниже ваги), у кукол — к их крестовине над головой.
      const y1 = giant ? (vaga ? y0b - 4 + vaga[2] + 2 : y0b - 40) : y0b - 18;
      if (s.cut) {
        // Обрывки: кусок висит от плеча и от ваги, качается.
        const sw = Math.sin(time * 4 + s.i + m.id) * 1.5;
        g.strokeStyle = rgba(GOLD[1], a * 0.8);
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(lx, ly);
        g.lineTo(lx + sw, ly + 5);
        g.moveTo(x1, y1);
        g.lineTo(x1 - sw, y1 + 6);
        g.stroke();
      } else thread(g, lx, ly, x1, y1, a, time, s.i * 3.1 + m.id, giant ? 1 : 0.7);
      ax = x1;
      ay = y1;
    }
    if (!giant) {
      crossbar(g, ax - (segs.length > 1 ? (segs[segs.length - 1].bx - segs[0].bx) * 8 : 0), ay, a);
      // Выше ваги нить уходит во тьму колосников.
      const gr = g.createLinearGradient(ax, ay, ax, ay - 40);
      gr.addColorStop(0, rgba(GOLD[1], a * 0.6));
      gr.addColorStop(1, rgba(GOLD[1], 0));
      g.strokeStyle = gr;
      g.lineWidth = 0.6;
      g.beginPath();
      g.moveTo(ax, ay - 2);
      g.lineTo(ax + 1, ay - 40);
      g.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Свет: софиты и луна.
// ---------------------------------------------------------------------------

function beam(
  g: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
): void {
  // Столб света от фонаря к пятну: трапеция, мягкий градиент.
  const dx = x - lx;
  const dy = y - ly;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const gr = g.createLinearGradient(lx, ly, x, y);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(1, rgba(col, a * 0.25));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(lx + nx * 2, ly + ny * 2);
  g.lineTo(x + nx * r, y + ny * r * 0.6);
  g.lineTo(x - nx * r, y - ny * r * 0.6);
  g.lineTo(lx - nx * 2, ly - ny * 2);
  g.closePath();
  g.fill();
}

function pool(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.7, rgba(col, a * 0.6));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, r, r * 0.92, 0, 0, TAU);
  g.fill();
}

const WARM: RGBA = [255, 220, 150, 255];
const MOON: RGBA = [170, 200, 255, 255];

// ---------------------------------------------------------------------------
// «Буря», «Звёздная ночь».
// ---------------------------------------------------------------------------

const ARENA_X0 = 12;
const ARENA_X1 = 52;

function waveCrest(
  g: CanvasRenderingContext2D,
  to: (x: number, y: number) => [number, number],
  w: (typeof F13_FX.waves)[number],
  time: number,
): void {
  const swell = w.t < BOSS.wave.swell;
  const k = swell ? w.t / BOSS.wave.swell : 1;
  const [, sy] = to(0, w.y);
  const S = P.sea;
  const inGap = (x: number) => w.gaps.some((gx) => Math.abs(x - gx) < w.gapW / 2);
  // Тень гребня на полу.
  g.fillStyle = 'rgba(4,14,30,0.35)';
  for (let x = ARENA_X0; x < ARENA_X1; x += 0.25) {
    if (inGap(x + 0.125)) continue;
    const [sx] = to(x, w.y);
    g.fillRect(sx, sy - 2, 4.2, 5);
  }
  for (let x = ARENA_X0; x < ARENA_X1; x += 0.25) {
    if (inGap(x + 0.125)) continue;
    const [sx] = to(x, w.y);
    const roll = Math.sin(x * 1.3 + time * 6);
    const h = (swell ? 4 + 10 * k : 15) + roll * 2;
    const curl = Math.sin(x * 2.1 - time * 8 * w.dir);
    const top = sy - h;
    // Тело: тёмный низ, светлее к гребню; контур тушью.
    g.fillStyle = rgba(INK, 0.9);
    g.fillRect(sx - 0.5, top - 1.5, 5.2, h + 2);
    g.fillStyle = rgba(S[0], 1);
    g.fillRect(sx, top, 4.2, h);
    g.fillStyle = rgba(S[1], 1);
    g.fillRect(sx, top, 4.2, h * 0.62);
    g.fillStyle = rgba(S[2], 1);
    g.fillRect(sx, top, 4.2, h * 0.3);
    g.fillStyle = rgba(S[3], 1);
    g.fillRect(sx, top - (curl > 0.4 ? 1 : 0), 4.2, 2);
    if (curl > 0.8) {
      g.fillStyle = 'rgba(255,255,255,0.95)';
      g.fillRect(sx + 0.5, top - 2.5, 2.5, 1.6);
    }
  }
  // Пока набухает — проёмы светятся: туда.
  if (swell)
    for (const gx of w.gaps) {
      const [cx] = to(gx, w.y);
      const half = (w.gapW / 2) * 16;
      g.strokeStyle = rgba(GOLD[3], 0.55 + 0.4 * Math.sin(time * 10));
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(cx - half + 1, sy - 12);
      g.lineTo(cx - half + 1, sy + 2);
      g.moveTo(cx + half - 1, sy - 12);
      g.lineTo(cx + half - 1, sy + 2);
      g.stroke();
      g.fillStyle = rgba(GOLD[3], 0.12);
      g.fillRect(cx - half, sy - 12, half * 2, 14);
    }
}

function star(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  fill: string,
  edge: string,
): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = edge;
  g.lineWidth = 0.8;
  g.stroke();
}

function drawStars(
  g: CanvasRenderingContext2D,
  to: (x: number, y: number) => [number, number],
  time: number,
): void {
  for (const s of F13_FX.stars) {
    const [px, py] = to(s.px, s.py);
    const [x, y] = to(s.x, s.y);
    const top = py - 60;
    if (s.cut) {
      // Срезанная: лежит на полу, тускло мерцает.
      star(g, x, y - 2, 6, 0.4, rgba(GOLD[1], 0.75), rgba(INK, 0.8));
      continue;
    }
    const sy = y - 14;
    // Две нити: к звезде и к её «маятнику» — обе режутся.
    thread(g, px - 3, top, x - 2, sy - 5, 0.9, time, s.px * 3, 0.8);
    thread(g, px + 3, top, x + 2, sy - 5, 0.9, time, s.px * 3 + 1, 0.8);
    const glow = g.createRadialGradient(x, sy, 0, x, sy, 14);
    glow.addColorStop(0, rgba([255, 240, 170, 255], 0.5));
    glow.addColorStop(1, rgba([255, 240, 170, 255], 0));
    g.fillStyle = glow;
    g.fillRect(x - 14, sy - 14, 28, 28);
    star(g, x, sy, 9, time * 1.4 + s.px, rgba(GOLD[2], 1), rgba(INK, 0.9));
    star(g, x - 1, sy - 1, 4, time * 1.4 + s.px, rgba(GOLD[3], 0.9), rgba(GOLD[3], 0));
  }
}

function moon(
  g: CanvasRenderingContext2D,
  to: (x: number, y: number) => [number, number],
  time: number,
): void {
  const m = F13_FX.moon;
  if (m.r <= 0) return;
  const [x, y] = to(m.x, m.y);
  const hy = y - 70;
  const old = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  beam(g, x + 6, hy + 6, x, y, m.r * 16, MOON, 0.16);
  g.globalCompositeOperation = old;
  // Месяц из картона на нити.
  g.strokeStyle = rgba(GOLD[1], 0.7);
  g.lineWidth = 0.6;
  g.beginPath();
  g.moveTo(x + 6, hy - 40);
  g.lineTo(x + 6, hy - 9);
  g.stroke();
  g.fillStyle = rgba([232, 236, 255, 255], 1);
  g.beginPath();
  g.arc(x + 6, hy, 9, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.night[1], 1);
  g.beginPath();
  g.arc(x + 10, hy - 2, 8, 0, TAU);
  g.fill();
  g.fillStyle = rgba(INK, 0.9);
  g.fillRect(x + 1, hy - 1, 1, 1);
  void time;
}

// ---------------------------------------------------------------------------
// Метки Кукловода (`vNoTele`): нити-лезвия вместо красного конуса движка.
// ---------------------------------------------------------------------------

const TELE: RGBA = [255, 70, 50, 255];

function lordTele(
  g: CanvasRenderingContext2D,
  to: (x: number, y: number) => [number, number],
  time: number,
): void {
  for (const m of F13_FX.mobs) {
    if (m.kind !== 'f13boss' || !m.tele) continue;
    const t = m.tele;
    const [ox, oy] = to(t.x ?? m.x, t.y ?? m.y);
    const k = k01(t.k ?? 0);
    const a0 = t.ang ?? 0;
    const R = t.r * 16;
    const hot = m.danger > 0;
    if (t.shape === 'cone') {
      const arc = t.arc ?? 1;
      g.fillStyle = rgba(TELE, 0.1 + 0.22 * k + (hot ? 0.12 : 0));
      g.beginPath();
      g.moveTo(ox, oy);
      g.arc(ox, oy, R, a0 - arc / 2, a0 + arc / 2);
      g.closePath();
      g.fill();
      // Веер нитей: натягиваются к удару.
      for (let i = 0; i <= 6; i++) {
        const a = a0 - arc / 2 + (arc * i) / 6;
        const L = R * (0.4 + 0.6 * k);
        g.strokeStyle = rgba(hot ? GOLD[3] : GOLD[2], 0.5 + 0.5 * k);
        g.lineWidth = 0.7;
        g.beginPath();
        g.moveTo(ox, oy);
        g.lineTo(ox + Math.cos(a) * L, oy + Math.sin(a) * L);
        g.stroke();
      }
      // Фронт заливки.
      g.strokeStyle = rgba(TELE, 0.85);
      g.lineWidth = 1;
      g.beginPath();
      g.arc(ox, oy, R * k, a0 - arc / 2, a0 + arc / 2);
      g.stroke();
    } else if (t.shape === 'line') {
      const w = (t.w ?? 0.4) * 16;
      const ca = Math.cos(a0);
      const sa = Math.sin(a0);
      g.save();
      g.translate(ox, oy);
      g.rotate(a0);
      g.fillStyle = rgba(TELE, 0.1 + 0.2 * k + (hot ? 0.12 : 0));
      g.fillRect(0, -w, R, w * 2);
      g.fillStyle = rgba(TELE, 0.35);
      g.fillRect(0, -w, R * k, w * 2);
      // Натянутая нить по оси, дрожит перед уколом.
      const j = hot ? Math.sin(time * 60) * 0.6 : 0;
      g.strokeStyle = rgba(GOLD[3], 0.9);
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(0, j);
      g.lineTo(R, -j);
      g.stroke();
      g.strokeStyle = rgba(TELE, 0.8);
      g.lineWidth = 0.6;
      g.strokeRect(0, -w, R, w * 2);
      g.restore();
      void ca;
      void sa;
    }
  }
}

// ---------------------------------------------------------------------------
// Зоны-режиссёры.
// ---------------------------------------------------------------------------

registerZonePainter('f13_strings', (g, z, px, py, S, time) => {
  const to = viewOf(z, px, py, S);
  const old = g.globalCompositeOperation;
  // Столбы света софитов и луны — сложением.
  g.globalCompositeOperation = 'lighter';
  for (const s of F13_FX.spots) {
    if (!s.on || Math.abs(s.x - z.x) > 18 || Math.abs(s.y - z.y) > 14) continue;
    const [lx, ly] = to(s.lx, s.ly);
    const [x, y] = to(s.x, s.y);
    beam(g, lx, ly - 13, x, y, SPOT.r * 16, WARM, 0.16);
    // Пятно — поверх темноты сложением: «где луч — там тебя видят» должно
    // читаться с первого взгляда; край пятна — чёткий, как у прожектора.
    const R = SPOT.r * 16;
    pool(g, x, y, R, WARM, 0.2 + 0.03 * Math.sin(time * 3 + s.x));
    g.strokeStyle = rgba(WARM, s.turned ? 0.5 : 0.3);
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(x, y, R * 0.97, R * 0.9, 0, 0, TAU);
    g.stroke();
  }
  g.globalCompositeOperation = old;
  if (F13_FX.act === 2 && F13_FX.moon.r > 0) moon(g, to, time);
  if (F13_FX.act === 1) for (const w of F13_FX.waves) waveCrest(g, to, w, time);
  if (F13_FX.act === 2) drawStars(g, to, time);
  drawStrings(g, to, z.x, z.y, time);
  lordTele(g, to, time);
  return true;
});

registerZonePainter('f13_stage', (g, z, px, py, S, time) => {
  const to = viewOf(z, px, py, S);
  for (const s of F13_FX.spots) {
    if (!s.on || Math.abs(s.x - z.x) > 18 || Math.abs(s.y - z.y) > 14) continue;
    const [x, y] = to(s.x, s.y);
    pool(g, x, y, SPOT.r * 16, WARM, 0.25);
    // Пылинки в луче.
    g.fillStyle = rgba(WARM, 0.5);
    for (let i = 0; i < 5; i++) {
      const a = time * 0.4 + i * 1.7 + s.lx;
      g.fillRect(x + Math.cos(a) * (8 + i * 4), y + Math.sin(a * 1.3) * (6 + i * 2) - 4, 0.8, 0.8);
    }
  }
  if (F13_FX.act === 2) {
    const m = F13_FX.moon;
    if (m.r > 0) {
      const [x, y] = to(m.x, m.y);
      pool(g, x, y, m.r * 16, MOON, 0.24);
    }
    for (const s of F13_FX.stars) {
      if (s.cut) continue;
      const [x, y] = to(s.x, s.y);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x, y + 1, 6, 2, 0, 0, TAU);
      g.fill();
    }
  }
  if (F13_FX.act === 1)
    for (const w of F13_FX.waves) {
      // Пена бежит перед гребнем.
      const [, sy] = to(0, w.y + w.dir * 0.6);
      g.fillStyle = rgba(P.sea[3], 0.35);
      for (let x = ARENA_X0; x < ARENA_X1; x += 0.5) {
        if (w.gaps.some((gx) => Math.abs(x - gx) < w.gapW / 2)) continue;
        const [sx] = to(x, 0);
        if (hash(Math.floor(x * 2), Math.floor(time * 8)) < 0.5) g.fillRect(sx, sy, 3, 1);
      }
    }
  return true;
});

// ---------------------------------------------------------------------------
// Короткие зоны-картинки.
// ---------------------------------------------------------------------------

const life = (z: Zone | Strike) => k01(z.t / Math.max(0.01, (z as Zone).life ?? 1));

function burst(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  k: number,
  n: number,
  seed: number,
  cols: RGBA[],
  R: number,
  up = 0,
): void {
  for (let i = 0; i < n; i++) {
    const a = hash(seed, i, 1) * TAU;
    const sp = (0.4 + hash(seed, i, 2)) * R;
    const px = x + Math.cos(a) * sp * k;
    const py = y + Math.sin(a) * sp * k * 0.6 - up * k + 20 * k * k * hash(seed, i, 3);
    g.fillStyle = rgba(cols[i % cols.length], 1 - k);
    const s = 1 + (i % 2);
    g.fillRect(px, py, s, s);
  }
}

// Лопнувшая нить: обрывок хлещет вверх, искра в точке разреза.
registerZonePainter('f13_snap', (g, z, px, py, S) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const [bx, by] = to(zf(z, 'bx'), zf(z, 'by'));
  const x = px;
  const y = py - 18;
  const e = ease(k * 2);
  g.strokeStyle = rgba(GOLD[3], 1 - k);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(bx, by - 18);
  g.quadraticCurveTo(
    bx + (x - bx) * 0.5 + 6 * (1 - e),
    (by - 18 + y) / 2,
    bx + (x - bx) * (1 - e),
    by - 18 + (y - by + 18) * (1 - e),
  );
  g.stroke();
  // Звёздочка разреза.
  g.fillStyle = rgba([255, 255, 255, 255], 1 - k);
  const r = 4 * (1 - k);
  g.fillRect(x - r, y - 0.5, r * 2, 1);
  g.fillRect(x - 0.5, y - r, 1, r * 2);
  burst(g, x, y, k, 6, z.id, [GOLD[3], GOLD[2]], 8);
  return true;
});

// Кукла рассыпалась: опилки, лоскуты, шарниры.
registerZonePainter('f13_collapse', (g, z, px, py) => {
  const k = life(z);
  const pale = zf(z, 'k') > 0;
  burst(
    g,
    px,
    py - 8,
    k,
    18,
    z.id,
    pale ? [P.pink[2], P.porcelain[3], GOLD[2]] : [P.wood[2], P.wood[3], P.cream[2], GOLD[2]],
    14,
    6,
  );
  // Пыль оседает.
  g.fillStyle = rgba(P.cream[1], 0.35 * (1 - k));
  g.beginPath();
  g.ellipse(px, py, 8 + 6 * k, 3 + 2 * k, 0, 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f13_dust', (g, z, px, py) => {
  const k = life(z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + z.id;
    g.fillStyle = rgba(P.cream[1], 0.4 * (1 - k));
    g.beginPath();
    g.arc(px + Math.cos(a) * 8 * k, py + Math.sin(a) * 4 * k - 3 * k, 2.5 + 2 * k, 0, TAU);
    g.fill();
  }
  return true;
});

// Люк вот-вот откроется: щели светятся снизу, чаще к концу.
registerZonePainter('f13_trapwarn', (g, z, px, py, _S, time) => {
  const k = life(z);
  const blink = 0.5 + 0.5 * Math.sin(time * (8 + 16 * k));
  const R = 16;
  g.strokeStyle = rgba([255, 120, 60, 255], 0.35 + 0.55 * blink);
  g.lineWidth = 1.2;
  g.strokeRect(px - R, py - R, R * 2, R * 2);
  g.fillStyle = rgba([255, 90, 40, 255], 0.1 + 0.2 * k);
  g.fillRect(px - R, py - R, R * 2, R * 2);
  g.fillStyle = rgba([255, 220, 140, 255], 0.5 * blink);
  g.fillRect(px - R, py - 0.5, R * 2, 1);
  g.fillRect(px - 0.5, py - R, 1, R * 2);
  return true;
});

// Аплодисменты: на сцену летят цветы.
registerZonePainter('f13_flowers', (g, z, px, py) => {
  const k = life(z);
  const cols = [P.red[2], P.pink[2], P.cream[3], GOLD[2]];
  for (let i = 0; i < 14; i++) {
    const t = k01(k * 1.6 - hash(z.id, i, 9) * 0.6);
    if (t <= 0) continue;
    const x = px + (hash(z.id, i, 1) - 0.5) * 60;
    const y0 = py - 70;
    const y1 = py + (hash(z.id, i, 2) - 0.5) * 30;
    const y = y0 + (y1 - y0) * ease(t);
    g.fillStyle = rgba(cols[i % 4], 1 - Math.max(0, k - 0.8) * 5);
    g.fillRect(x - 1, y - 1, 2.5, 2.5);
    g.fillStyle = rgba(P.green[2], 1 - Math.max(0, k - 0.8) * 5);
    g.fillRect(x, y + 1.5, 0.8, 2.5);
  }
  return true;
});

// Смена декораций: линии на полу — где встанет картон.
registerZonePainter('f13_setwarn', (g, z, px, py, S, time) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const L = F13_SCENERY[Math.round(zf(z, 'lay'))];
  if (!L) return true;
  const blink = 0.5 + 0.5 * Math.sin(time * (6 + 14 * k));
  const col: RGBA = L.kind === 'sea' ? [120, 200, 255, 255] : [255, 200, 90, 255];
  g.strokeStyle = rgba(col, 0.35 + 0.5 * blink);
  g.lineWidth = 0.8;
  g.setLineDash([3, 2]);
  g.lineDashOffset = -time * 20;
  for (const [x, y] of L.cells) {
    const [sx, sy] = to(x, y);
    g.strokeRect(sx + 1.5, sy + 1.5, S - 3, S - 3);
  }
  g.setLineDash([]);
  g.fillStyle = rgba(col, 0.08 + 0.12 * k);
  for (const [x, y] of L.cells) {
    const [sx, sy] = to(x, y);
    g.fillRect(sx, sy, S, S);
  }
  return true;
});

// Палочка дирижёра: оркестр замолк — кольцо тишины.
registerZonePainter('f13_hush', (g, z, px, py) => {
  const k = life(z);
  g.strokeStyle = rgba([180, 210, 255, 255], 0.7 * (1 - k));
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(px, py, z.r * 16 * ease(k), z.r * 16 * ease(k) * 0.8, 0, 0, TAU);
  g.stroke();
  return true;
});

// Стопор заклинил занавес: искры по ряду.
registerZonePainter('f13_jam', (g, z, px, py, _S, time) => {
  const k = life(z);
  if (k > 0.97) return true;
  for (let i = 0; i < 8; i++) {
    const x = px + (hash(i, Math.floor(time * 12), z.id) - 0.5) * z.r * 32;
    g.fillStyle = rgba(GOLD[3], 0.8);
    g.fillRect(x, py - 6 - hash(i, 3, Math.floor(time * 12)) * 6, 1, 1);
  }
  return true;
});

registerZonePainter('f13_backstab', (g, z, px, py) => {
  const k = life(z);
  const r = 10 * ease(k * 2);
  g.strokeStyle = rgba([210, 190, 255, 255], 1 - k);
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(px - r, py - 10 - r);
  g.lineTo(px + r, py - 10 + r);
  g.moveTo(px + r, py - 10 - r);
  g.lineTo(px - r, py - 10 + r);
  g.stroke();
  return true;
});

registerZonePainter('f13_yank', (g, z, px, py) => {
  const k = life(z);
  g.strokeStyle = rgba(GOLD[3], 0.9 * (1 - k));
  g.lineWidth = 0.8;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(px + i * 4, py - 22 - k * 10);
    g.lineTo(px + i * 4, py - 30 - k * 14);
    g.stroke();
  }
  return true;
});

registerZonePainter('f13_hatch', (g, z, px, py) => {
  const k = life(z);
  g.fillStyle = rgba([10, 4, 8, 255], 0.8 * (1 - k * k));
  g.fillRect(px - 9, py - 6, 18, 12);
  g.strokeStyle = rgba(P.wood[3], 1 - k);
  g.lineWidth = 1;
  g.strokeRect(px - 9, py - 6, 18, 12);
  burst(g, px, py, k, 8, z.id, [P.wood[2], P.cream[1]], 12, 4);
  return true;
});

// Шёпот суфлёра: ленточка букв к тому, кого он подбадривает.
registerZonePainter('f13_whisper', (g, z, px, py, S) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const [tx, ty] = to(zf(z, 'tx'), zf(z, 'ty'));
  for (let i = 0; i < 7; i++) {
    const u = k01(k * 1.4 - i * 0.06);
    if (u <= 0 || u >= 1) continue;
    const x = px + (tx - px) * u;
    const y = py - 10 + (ty - py) * u - Math.sin(u * Math.PI) * 10;
    g.fillStyle = rgba(P.cream[3], 0.9);
    g.fillRect(x, y, 1.6, 1);
    g.fillRect(x + 0.6, y - 1, 0.8, 1);
  }
  return true;
});

registerZonePainter('f13_shatter', (g, z, px, py) => {
  const k = life(z);
  burst(g, px, py - 10, k, 12, z.id, [P.porcelain[3], P.porcelain[1], GOLD[2]], 12, 2);
  return true;
});

registerZonePainter('f13_mend', (g, z, px, py) => {
  const k = life(z);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + k * 3;
    const r = 14 * (1 - k);
    g.fillStyle = rgba(GOLD[3], 0.9 * (1 - k * 0.5));
    g.fillRect(px + Math.cos(a) * r, py - 10 + Math.sin(a) * r * 0.7, 1.2, 1.2);
  }
  return true;
});

// Луч лечения маски маске: золотая лента между двумя.
registerZonePainter('f13_healbeam', (g, z, px, py, S, time) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const a = F13_FX.mobs.find((m) => m.id === zf(z, 'from'));
  const b = F13_FX.mobs.find((m) => m.id === zf(z, 'to'));
  if (!a || !b) return true;
  const [x0, y0] = to(a.x, a.y);
  const [x1, y1] = to(b.x, b.y);
  g.strokeStyle = rgba([255, 230, 140, 255], 0.75 * (1 - k));
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(x0, y0 - 18);
  g.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 - 30 + Math.sin(time * 9) * 3, x1, y1 - 18);
  g.stroke();
  return true;
});

registerZonePainter('f13_fade', (g, z, px, py) => {
  const k = life(z);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = rgba(P.shade[3], 0.4 * (1 - k));
    g.beginPath();
    g.arc(px + (hash(z.id, i) - 0.5) * 12, py - 8 - k * 16 - i * 2, 2 + i * 0.4, 0, TAU);
    g.fill();
  }
  return true;
});

// Паук вяжет нить / рыцаря спускают: золотые нити опускаются сверху.
registerZonePainter('f13_retie', (g, z, px, py) => {
  const k = life(z);
  const len = 40 * ease(k * 1.5);
  g.strokeStyle = rgba(GOLD[2], 0.9 * (1 - Math.max(0, k - 0.6) * 2.5));
  g.lineWidth = 0.7;
  for (const dx of [-3, 3]) {
    g.beginPath();
    g.moveTo(px + dx, py - 60);
    g.lineTo(px + dx, py - 60 + len);
    g.stroke();
  }
  return true;
});

// ---- занавес ------------------------------------------------------------------

/** Бархатный занавес через всю сцену, низ — на `drop` (0 поднят, 1 опущен). */
function curtain(
  g: CanvasRenderingContext2D,
  z: Zone | Strike,
  px: number,
  py: number,
  S: number,
  drop: number,
  time: number,
): void {
  if (drop <= 0.001) return;
  const to = viewOf(z, px, py, S);
  const [x0, top] = to(ARENA_X0, 0);
  const [x1, bottom] = to(ARENA_X1, 24);
  const yb = top + (bottom - top) * drop;
  // Складки: полосы тонов.
  for (let x = x0; x < x1; x += 2) {
    const s = Math.sin(x * 0.31 + Math.sin(time * 0.8) * 0.3) + 0.35 * Math.sin(x * 0.9);
    const c = s > 0.9 ? P.velvet[3] : s > 0.2 ? P.velvet[2] : s > -0.6 ? P.velvet[1] : P.velvet[0];
    g.fillStyle = rgba(c, 1);
    g.fillRect(x, top, 2.2, yb - top);
  }
  // Бахрома и золотая кайма.
  g.fillStyle = rgba(GOLD[2], 1);
  g.fillRect(x0, yb - 4, x1 - x0, 2);
  for (let x = x0; x < x1; x += 3) {
    g.fillStyle = rgba(GOLD[(x / 3) % 2 ? 1 : 3], 1);
    g.fillRect(x, yb - 2, 1.5, 3 + (Math.floor(x / 3) % 2));
  }
  // Ламбрекен сверху.
  g.fillStyle = rgba(P.velvet[1], 1);
  for (let x = x0; x < x1; x += 24) {
    g.beginPath();
    g.moveTo(x, top);
    g.quadraticCurveTo(x + 12, top + 26, x + 24, top);
    g.fill();
  }
  g.fillStyle = rgba(GOLD[2], 1);
  g.fillRect(x0, top, x1 - x0, 3);
}

// Между актами: падает, держится, поднимается (весь переход — `BOSS.trans`).
registerZonePainter('f13_curtainfall', (g, z, px, py, S, time) => {
  const t = z.t;
  const T = BOSS.trans;
  const drop =
    t < 0.9
      ? ease(t / 0.9)
      : t < BOSS.swap + 0.3
        ? 1
        : 1 - ease((t - BOSS.swap - 0.3) / (T - BOSS.swap - 0.3));
  curtain(g, z, px, py, S, drop, time);
  return true;
});

registerZonePainter('f13_curtainrise', (g, z, px, py, S, time) => {
  const t = z.t;
  curtain(g, z, px, py, S, 1 - ease((t - 0.3) / 1.6), time);
  return true;
});

// Смерть Кукловода: цветы, поклон, занавес падает и закрывает сцену.
registerZonePainter('f13_bow', (g, z, px, py, S, time) => {
  const t = z.t;
  if (t > 1.2) {
    const k = k01((t - 1.2) / 3.5);
    const cols = [P.red[2], P.pink[2], P.cream[3], GOLD[2]];
    for (let i = 0; i < 30; i++) {
      const u = k01(k * 1.5 - hash(i, 7) * 0.5);
      if (u <= 0) continue;
      const x = px + (hash(i, 1) - 0.5) * 120;
      const y = py - 90 + (100 + hash(i, 2) * 30) * ease(u);
      g.fillStyle = rgba(cols[i % 4], 1);
      g.fillRect(x, y, 2.4, 2.4);
    }
  }
  const drop =
    t < 4.4 ? 0 : t < 5.6 ? ease((t - 4.4) / 1.2) : t < 6.1 ? 1 : 1 - ease((t - 6.1) / 0.4);
  const cz = { ...z, x: zf(z, 'cx'), y: zf(z, 'cy') } as Zone;
  const to = viewOf(z, px, py, S);
  const [cx, cy] = to(cz.x, cz.y);
  curtain(g, cz, cx, cy, S, drop, time);
  return true;
});

// ---- контакты и следы ---------------------------------------------------------

registerZonePainter('f13_lancehit', (g, z, px, py) => {
  const k = life(z);
  const a = zf(z, 'ang');
  const L = zf(z, 'len') * 16;
  g.strokeStyle = rgba([255, 240, 200, 255], 0.8 * (1 - k));
  g.lineWidth = 2 * (1 - k);
  g.beginPath();
  g.moveTo(px - Math.cos(a) * L, py - Math.sin(a) * L - 20);
  g.lineTo(px, py - 20);
  g.stroke();
  burst(g, px, py - 18, k, 10, z.id, [[255, 255, 255, 255], GOLD[3], P.cream[2]], 12);
  return true;
});

registerZonePainter('f13_snareline', (g, z, px, py, S) => {
  const k = life(z);
  const to = viewOf(z, px, py, S);
  const [tx, ty] = to(zf(z, 'tx'), zf(z, 'ty'));
  g.strokeStyle = rgba(GOLD[3], 1 - k);
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(px, py - 24);
  g.lineTo(tx, ty - 10);
  g.stroke();
  g.beginPath();
  g.ellipse(tx, ty - 6, 7, 4, 0, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f13_splash', (g, z, px, py) => {
  const k = life(z);
  burst(g, px, py - 6, k, 16, z.id, [P.sea[3], P.sea[2], [255, 255, 255, 255]], 16, 14);
  return true;
});

registerZonePainter('f13_starfall', (g, z, px, py, _S, time) => {
  const k = life(z);
  const y = py - 60 + 60 * ease(k);
  star(g, px, y, 8 * (1 - k * 0.3), time * 6, rgba(GOLD[2], 1 - k * 0.5), rgba(INK, 0.8));
  burst(g, px, y, k, 8, z.id, [GOLD[3]], 10);
  return true;
});

// ---------------------------------------------------------------------------
// Удары по площади: метка до удара.
// ---------------------------------------------------------------------------

registerZonePainter('f13_none', () => true);

const warnK = (st: Strike) => k01(st.t / Math.max(0.05, st.warn));

// Противовес: тень мешка растёт, сверху спускается мешок на канате.
registerZonePainter('f13_sandbag', (g, z, px, py) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  g.fillStyle = rgba(TELE, 0.12 + 0.2 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(TELE, 0.7);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R * k, R * k * 0.9, 0, 0, TAU);
  g.stroke();
  const y = py - 80 * (1 - ease(k));
  g.strokeStyle = rgba(P.cream[1], 0.9);
  g.beginPath();
  g.moveTo(px, y - 60);
  g.lineTo(px, y - 12);
  g.stroke();
  g.fillStyle = rgba(P.cream[1], 1);
  g.beginPath();
  g.ellipse(px, y - 6, 6, 7, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.cream[2], 1);
  g.fillRect(px - 4, y - 11, 4, 3);
  return true;
});

// Пожарный занавес: ряд горит полосами «осторожно», сверху спускается лист.
registerZonePainter('f13_iron', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const L = st.r * 16;
  const a = st.ang ?? 0;
  const w = (st.w ?? 0.5) * 16;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  const blink = 0.5 + 0.5 * Math.sin(time * (10 + 14 * k));
  g.fillStyle = rgba(TELE, 0.15 + 0.25 * k);
  g.fillRect(0, -w, L, w * 2);
  for (let x = 0; x < L; x += 6) {
    g.fillStyle = rgba([230, 190, 40, 255], 0.5 + 0.4 * blink);
    g.fillRect(x, -w, 3, w * 2);
  }
  g.restore();
  // Лист железа над рядом — тень спускается.
  if (Math.abs(a) < 0.1 || Math.abs(Math.abs(a) - Math.PI) < 0.1) {
    const x0 = Math.min(px, px + Math.cos(a) * L);
    g.fillStyle = rgba(P.steel[1], 0.55 * k);
    g.fillRect(x0, py - 40 * (1 - k) - 14, L, 14);
    g.fillStyle = rgba(P.steel[3], 0.6 * k);
    g.fillRect(x0, py - 40 * (1 - k) - 14, L, 1);
  }
  return true;
});

// Барабан: кольцо-волна, кожа барабана на полу.
registerZonePainter('f13_drum', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  const w = (st.w ?? 0.6) * 16;
  const ri = Math.max(0, R - w);
  g.fillStyle = rgba(TELE, 0.12 + 0.24 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.ellipse(px, py, ri, ri * 0.9, 0, 0, TAU, true);
  g.fill('evenodd');
  g.strokeStyle = rgba(GOLD[2], 0.5 + 0.4 * Math.sin(time * 12));
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, ri + w * k, (ri + w * k) * 0.9, 0, 0, TAU);
  g.stroke();
  return true;
});

// Арлекин вынырнет: люк намечается трещинами.
registerZonePainter('f13_pop', (g, z, px, py) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  g.fillStyle = rgba(TELE, 0.14 + 0.24 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba([255, 200, 120, 255], 0.5 + 0.5 * k);
  g.lineWidth = 0.8;
  g.strokeRect(px - 8, py - 6, 16, 12);
  g.beginPath();
  g.moveTo(px - 8, py);
  g.lineTo(px + 8, py);
  g.stroke();
  return true;
});

// Сетка нитей: тонкая нить натягивается, толстеет и светится к удару.
registerZonePainter('f13_gridline', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const L = st.r * 16;
  const a = st.ang ?? 0;
  const w = (st.w ?? 0.35) * 16;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = rgba(TELE, 0.08 + 0.2 * k);
  g.fillRect(-L, -w, L * 2, w * 2);
  const j = k > 0.8 ? Math.sin(time * 50 + st.id) * 0.5 : 0;
  g.strokeStyle = rgba(k > 0.8 ? GOLD[3] : GOLD[2], 0.5 + 0.5 * k);
  g.lineWidth = 0.5 + 1.2 * k;
  g.beginPath();
  g.moveTo(-L, j);
  g.lineTo(L, -j);
  g.stroke();
  g.restore();
  return true;
});

// Молния-софит: белое пятно сужается к удару.
registerZonePainter('f13_bolt', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  g.fillStyle = rgba([220, 230, 255, 255], 0.1 + 0.3 * k + (Math.sin(time * 40) > 0.6 ? 0.1 : 0));
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(TELE, 0.8);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R * (1.6 - 0.6 * k), R * (1.6 - 0.6 * k) * 0.9, 0, 0, TAU);
  g.stroke();
  return true;
});

// «По памяти»: туда, где ты был, — бледный круг и тень-силуэт.
registerZonePainter('f13_memory', (g, z, px, py) => {
  const st = z as Strike;
  const k = warnK(st);
  const R = st.r * 16;
  g.fillStyle = rgba([150, 170, 255, 255], 0.12 + 0.22 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(TELE, 0.75);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R * k, R * k * 0.9, 0, 0, TAU);
  g.stroke();
  g.fillStyle = rgba([180, 190, 255, 255], 0.3 * (1 - k));
  g.fillRect(px - 3, py - 18, 6, 16);
  return true;
});

// ---- контакты ударов ----------------------------------------------------------

function impact(
  art: string,
  paint: (
    g: CanvasRenderingContext2D,
    r: ImpactRec,
    px: number,
    py: number,
    k: number,
    time: number,
  ) => void,
  life0: number,
  shake = 0.15,
  above = false,
): void {
  registerImpactPainter(art, {
    life: life0,
    shake,
    above,
    paint: (g, rec, px, py, _S, age, time) => {
      paint(g, rec, px, py, k01(age / life0), time);
      return age < life0;
    },
  });
}

impact(
  'f13_sandbag',
  (g, r, px, py, k) => {
    g.fillStyle = rgba(P.cream[1], 1 - k);
    g.beginPath();
    g.ellipse(px, py - 4, 7, 5, 0, 0, TAU);
    g.fill();
    burst(g, px, py, k, 14, r.seed, [P.cream[2], P.cream[1], P.wood[2]], 18, 4);
  },
  0.6,
  0.25,
);

impact(
  'f13_iron',
  (g, r, px, py, k) => {
    burst(g, px, py - 6, k, 18, r.seed, [GOLD[3], [255, 255, 255, 255], P.steel[3]], 26, 6);
  },
  0.5,
  0.3,
);

impact(
  'f13_drum',
  (g, r, px, py, k) => {
    const R = (r.r ?? 3) * 16;
    g.strokeStyle = rgba(GOLD[3], 1 - k);
    g.lineWidth = 2 * (1 - k);
    g.beginPath();
    g.ellipse(px, py, R * (0.8 + 0.4 * k), R * (0.8 + 0.4 * k) * 0.9, 0, 0, TAU);
    g.stroke();
  },
  0.4,
  0.2,
);

impact(
  'f13_pop',
  (g, r, px, py, k) => burst(g, px, py, k, 12, r.seed, [P.wood[2], P.red[2], GOLD[2]], 16, 8),
  0.5,
  0.12,
);

impact(
  'f13_gridline',
  (g, r, px, py, k) => {
    const L = (r.r ?? 8) * 16;
    const a = r.ang ?? 0;
    g.strokeStyle = rgba([255, 255, 230, 255], 1 - k);
    g.lineWidth = 2.2 * (1 - k);
    g.beginPath();
    g.moveTo(px - Math.cos(a) * L, py - Math.sin(a) * L);
    g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
    g.stroke();
  },
  0.35,
  0.08,
  true,
);

impact(
  'f13_bolt',
  (g, r, px, py, k) => {
    // Зигзаг молнии сверху и вспышка.
    g.strokeStyle = rgba([235, 240, 255, 255], 1 - k);
    g.lineWidth = 1.6;
    g.beginPath();
    let x = px + (hash(r.seed, 1) - 0.5) * 10;
    let y = py - 90;
    g.moveTo(x, y);
    for (let i = 0; i < 6; i++) {
      x = px + (hash(r.seed, i + 2) - 0.5) * 14 * (1 - i / 6);
      y += 15;
      g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = rgba([220, 230, 255, 255], 0.5 * (1 - k));
    g.beginPath();
    g.ellipse(px, py, 18, 14, 0, 0, TAU);
    g.fill();
  },
  0.35,
  0.2,
  true,
);

impact(
  'f13_memory',
  (g, r, px, py, k) =>
    burst(
      g,
      px,
      py - 6,
      k,
      12,
      r.seed,
      [
        [200, 210, 255, 255],
        [255, 255, 255, 255],
      ],
      14,
      6,
    ),
  0.45,
  0.1,
);

// ---------------------------------------------------------------------------
// Снаряды.
// ---------------------------------------------------------------------------

const SHOT_CACHE = new Map<string, Sprite>();
function shotSprite(key: string, w: number, h: number, draw: (p: Px) => void): Sprite {
  let s = SHOT_CACHE.get(key);
  if (!s) {
    const p = new Px(w, h);
    draw(p);
    p.outline(INK);
    s = { img: p.canvas(), ax: w / 2, ay: h / 2 + 6 };
    SHOT_CACHE.set(key, s);
  }
  return s;
}

const dir8 = (s: Shot) => ((Math.round((Math.atan2(s.vy, s.vx) / TAU) * 8) % 8) + 8) % 8;

// Листок роли — кружится.
registerShotPainter('f13_page', (s, time) => {
  const f = Math.floor(time * 12 + s.id) % 4;
  return shotSprite(`page${f}`, 9, 9, (p) => {
    const w = [3, 2, 1, 2][f];
    p.rect(4 - w, 2, 4 + w, 6, P.cream[3]);
    if (w > 1) {
      p.line(4 - w + 1, 3, 4 + w - 1, 3, P.cream[0]);
      p.line(4 - w + 1, 5, 4 + w - 1, 5, P.cream[0]);
    }
  });
});

// Нота скрипача — светится, режет нити.
registerShotPainter('f13_note', (s, time) => {
  const f = Math.floor(time * 8 + s.id) % 2;
  return shotSprite(`note${f}${s.id % 2}`, 9, 11, (p) => {
    const c = s.id % 2 ? hx('#a8e0ff') : hx('#ffe08a');
    p.ell(3, 8, 2.4, 1.8, c);
    p.rect(5, 1 + f, 5, 8, c);
    p.line(5, 1 + f, 8, 3 + f, c);
  });
});

registerShotPainter('f13_tear', (s) =>
  shotSprite(`tear${dir8(s)}`, 9, 9, (p) => {
    p.ell(4.5, 5, 2.6, 2.6, hx('#6ac8ff'));
    p.set(4, 2, hx('#6ac8ff'));
    p.set(4, 3, hx('#bfe8ff'));
    p.set(3, 4, hx('#ffffff'));
  }),
);

// Игла Кукловода с золотой ниткой хвостом.
registerShotPainter('f13_needle', (s) => {
  const d = dir8(s);
  return shotSprite(`needle${d}`, 14, 14, (p) => {
    const a = (d / 8) * TAU;
    const cx = 7;
    const cy = 7;
    p.line(
      cx - Math.cos(a) * 5,
      cy - Math.sin(a) * 5,
      cx + Math.cos(a) * 5,
      cy + Math.sin(a) * 5,
      P.silver[3],
    );
    p.set(cx + Math.cos(a) * 5, cy + Math.sin(a) * 5, hx('#ffffff'));
    p.line(
      cx - Math.cos(a) * 5,
      cy - Math.sin(a) * 5,
      cx - Math.cos(a) * 7 + Math.sin(a) * 2,
      cy - Math.sin(a) * 7 - Math.cos(a) * 2,
      P.gold[2],
    );
  });
});

impact(
  'f13_note',
  (g, r, px, py, k) => burst(g, px, py - 6, k, 6, r.seed, [[168, 224, 255, 255], GOLD[3]], 8),
  0.3,
  0,
);
impact(
  'f13_page',
  (g, r, px, py, k) => burst(g, px, py - 6, k, 6, r.seed, [P.cream[3], P.cream[1]], 8),
  0.3,
  0,
);
impact(
  'f13_tear',
  (g, r, px, py, k) =>
    burst(
      g,
      px,
      py - 6,
      k,
      6,
      r.seed,
      [
        [106, 200, 255, 255],
        [255, 255, 255, 255],
      ],
      8,
    ),
  0.3,
  0,
);
impact(
  'f13_needle',
  (g, r, px, py, k) => burst(g, px, py - 6, k, 5, r.seed, [P.silver[3], GOLD[3]], 8),
  0.3,
  0,
);

void paintSim;
