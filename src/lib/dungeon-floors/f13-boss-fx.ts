// Этаж 13 «Театр марионеток» — всё, что Кукловод создаёт в мире.
//
// Две зоны-режиссёра (их держит правило этажа у героя):
//  • `f13_strings` — поверх темноты: нити кукол и исполина (натяжение,
//    провис, дрожь, обрывки), нити самого Кукловода к колосникам, столбы
//    софитов с пылью в луче, луна «Звёздной ночи», гребни волн «Бури»,
//    звёзды-маятники со шлейфом, яркая часть меток (нити-лезвия, блики,
//    сигнал последних 0,2 с);
//  • `f13_stage` — на полу, под мобами: пятна софитов и луны с туманом, тени
//    нитей (где их резать), заливки меток, след дуги маятника и бегущая
//    впереди тень звезды, проёмы волн, пена.
// Остальное — короткие зоны `api.vfx` (лопнувшая нить, контакт ударов без
// своего удара по площади, пыль шагов исполина), занавес, удары по площади
// (сетка нитей, молния, «по памяти»), снаряды и их контакт.
//
// Координаты — игровые пиксели (16 на клетку); рисуем векторно, тонко.
// Время техник — от `m.t` и `z.t` (мозг — метроном), живое — от `time`.

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
import type { StringSeg } from './f13-brains';
import {
  css,
  giantShoulderPx,
  hash,
  hx,
  INK,
  lordVagaPx,
  mixc,
  P,
  spiderLift,
  TAU,
} from './f13-art';
import type { RGBA } from './f13-art';

const GOLD = P.gold;
const WHITE: RGBA = [255, 255, 255, 255];
const WARM: RGBA = [255, 220, 150, 255];
const MOON: RGBA = [176, 204, 255, 255];
const SILVER = P.silver;
const k01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (k: number) => {
  const v = k01(k);
  return v * v * (3 - 2 * v);
};
const easeIn = (k: number) => {
  const v = k01(k);
  return v * v;
};
const easeOut = (k: number) => {
  const v = 1 - k01(k);
  return 1 - v * v * v;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const zf = (z: Zone | Strike, key: string): number =>
  (z as unknown as Record<string, number>)[key] ?? 0;
const rgba = (c: RGBA, a: number) => css(c, k01(a));
const life = (z: Zone | Strike) => k01(z.t / Math.max(0.01, (z as Zone).life ?? 1));
type To = (x: number, y: number) => [number, number];

/** Мир → экран относительно точки зоны. */
function viewOf(z: { x: number; y: number }, px: number, py: number, S: number): To {
  return (wx: number, wy: number): [number, number] => [px + (wx - z.x) * S, py + (wy - z.y) * S];
}

/** Ширина и высота кадра в игровых пикселях (рендер рисует с масштабом). */
function viewSize(g: CanvasRenderingContext2D): [number, number] {
  const t = g.getTransform();
  return [g.canvas.width / (Math.abs(t.a) || 1), g.canvas.height / (Math.abs(t.d) || 1)];
}

/** Сложением (свет). */
function lighter(g: CanvasRenderingContext2D, f: () => void): void {
  const o = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  f();
  g.globalCompositeOperation = o;
}

/** Мягкое свечение: радиальный градиент. */
function glow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
  sy = 1,
): void {
  if (a <= 0.004 || r <= 0.2) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.45, rgba(col, a * 0.45));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, r, r * sy, 0, 0, TAU);
  g.fill();
}

/** Искра-крестик (блик металла, звёздочка разреза). */
function twinkle(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
): void {
  if (a <= 0.01 || r <= 0.3) return;
  g.fillStyle = rgba(col, a);
  g.fillRect(x - r, y - 0.5, r * 2, 1);
  g.fillRect(x - 0.5, y - r, 1, r * 2);
  g.fillStyle = rgba(WHITE, a);
  g.fillRect(x - 0.7, y - 0.7, 1.4, 1.4);
}

/** Разлёт частиц (общий запасной: опилки, лоскуты). */
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

/**
 * Баллистика частицы с сопротивлением: старт (x, y), скорость (vx, vy) px/с,
 * тяжесть `grav` px/с². Пол — экранный `floor`: на нём частица ложится.
 */
function fly(
  x: number,
  y: number,
  vx: number,
  vy: number,
  t: number,
  grav: number,
  floor: number,
  drag = 2.2,
): [number, number, boolean] {
  const e = (1 - Math.exp(-drag * t)) / drag;
  const nx = x + vx * e;
  let ny = y + (vy + grav / drag) * e - (grav / drag) * t;
  let landed = false;
  if (ny >= floor) {
    ny = floor;
    landed = true;
  }
  return [nx, ny, landed];
}

/** Искры: летят из точки и гаснут (свет — сложением, поверх темноты). */
function sparks(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  age: number,
  n: number,
  seed: number,
  speed: number,
  cols: RGBA[],
  span = 0.35,
  dir = -Math.PI / 2,
  spread = Math.PI,
  floor = Infinity,
): void {
  for (let i = 0; i < n; i++) {
    const lifeI = span * (0.6 + 0.8 * hash(seed, i, 41));
    if (age > lifeI) continue;
    const a = dir + (hash(seed, i, 42) - 0.5) * spread * 2;
    const v = speed * (0.45 + 0.75 * hash(seed, i, 43));
    const [px, py] = fly(x, y, Math.cos(a) * v, Math.sin(a) * v, age, 240, floor, 3);
    const [qx, qy] = fly(
      x,
      y,
      Math.cos(a) * v,
      Math.sin(a) * v,
      Math.max(0, age - 0.03),
      240,
      floor,
      3,
    );
    const k = age / lifeI;
    g.strokeStyle = rgba(cols[i % cols.length], 1 - k * k);
    g.lineWidth = k < 0.4 ? 1 : 0.7;
    g.beginPath();
    g.moveTo(qx, qy);
    g.lineTo(px + 0.01, py);
    g.stroke();
  }
}

// ---------------------------------------------------------------------------
// Нити: натяжение, провис, дрожь, обрывки.
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

const lordNow = () => F13_FX.mobs.find((q) => q.kind === 'f13boss' && q.mode !== 'dying') ?? null;

/** Вага Кукловода на экране — только по `lordVagaPx` «Тела». */
function vagaScreen(to: To, time: number): [number, number] | null {
  const lord = lordNow();
  if (!lord) return null;
  const [x, y] = to(lord.x, lord.y);
  const [dx, dy] = lordVagaPx(lord, time);
  return [x + dx, y + dy];
}

/** Когда лопнула каждая нить (время сцены): дрожь остальных, рост обрывков. */
const CUTS = new WeakMap<Mob, { mask: number; at: number[] }>();
function cutTimes(m: Mob): number[] {
  const mask = m.data.cut ?? 0;
  let c = CUTS.get(m);
  if (!c) {
    c = { mask, at: [-9, -9, -9, -9, -9, -9, -9, -9] };
    CUTS.set(m, c);
  }
  if (c.mask !== mask) {
    for (let i = 0; i < 8; i++) {
      const b = 1 << i;
      if (mask & b && !(c.mask & b)) c.at[i] = F13_FX.time;
      if (!(mask & b)) c.at[i] = -9;
    }
    c.mask = mask;
  }
  return c.at;
}

/** Натяжение: провис (1 — обычный, 0 — струна), дрожь, блеск, рывок ваги. */
interface Pull {
  sag: number;
  buzz: number;
  lit: number;
  jerk: number;
}

const STRIKING = new Set(['windup', 'f13_lance', 'f13_shield', 'f13_charge_aim', 'f13_charge']);
/** Обмякла: нити висят петлёй. */
const SLACK = new Set(['f13_slump', 'f13_fallen', 'f13_broken', 'f13_lost', 'stun']);

function pullOf(m: Mob, lastCut: number): Pull {
  const p: Pull = { sag: 1, buzz: 0, lit: 0, jerk: 0 };
  if (STRIKING.has(m.mode) || m.tele) {
    // Кукла бьёт: вага поддёрнула — нить в струну, блестит, к удару звенит.
    const k = ease(m.t / 0.3);
    p.sag = 1 - 0.94 * k;
    p.lit = 0.35 + 0.65 * k;
    p.jerk = 3 * k;
    if (m.danger > 0) p.buzz = 0.45;
  } else if (m.mode === 'recover' && m.t < 0.5) {
    // Отпустило с отскоком.
    const u = m.t / 0.5;
    p.sag = 0.06 + 0.94 * ease(u) + 0.4 * Math.sin(u * TAU) * (1 - u);
    p.lit = 1 - u;
    p.jerk = 3 * (1 - easeOut(u));
  } else if (m.mode === 'f13_reel' || m.data.crawl || SLACK.has(m.mode)) p.sag = 2.4;
  // Часть нитей срезана — оставшиеся провисают: кукла висит криво.
  else if (m.data.cut) p.sag = 1.6;
  const age = F13_FX.time - lastCut;
  if (age >= 0 && age < 0.9) p.buzz = Math.max(p.buzz, 2.6 * Math.exp(-age * 4.5));
  return p;
}

interface ThreadOpt {
  a: number;
  w: number;
  sag: number;
  seed: number;
  time: number;
  bowX?: number;
  buzz?: number;
  lit?: number;
  col?: RGBA;
  /** Верх уходит в темноту колосников. */
  fade?: boolean;
  glints?: boolean;
}

/** Нить от (x0, y0) — верх — к (x1, y1): провис, выгиб, дрожь, бегущий блик. */
function thread(
  g: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  o: ThreadOpt,
): void {
  if (o.a <= 0.01) return;
  const L = Math.hypot(x1 - x0, y1 - y0) || 1;
  const sag = o.sag * (1.2 + L * 0.055);
  const mx = (x0 + x1) / 2 + (o.bowX ?? 0) + Math.sin(o.time * 1.7 + o.seed) * 0.7 * o.sag;
  const my = (y0 + y1) / 2 + sag;
  const buzz = o.buzz ?? 0;
  const lit = o.lit ?? 0;
  const nx = -(y1 - y0) / L;
  const ny = (x1 - x0) / L;
  const pt = (s: number): [number, number] => {
    const u = 1 - s;
    let x = u * u * x0 + 2 * u * s * mx + s * s * x1;
    let y = u * u * y0 + 2 * u * s * my + s * s * y1;
    if (buzz > 0.05) {
      const d = buzz * Math.sin(Math.PI * s) * Math.sin(o.time * 57 + o.seed + s * 3);
      x += nx * d;
      y += ny * d;
    }
    return [x, y];
  };
  g.beginPath();
  if (buzz > 0.05) {
    g.moveTo(x0, y0);
    for (let i = 1; i <= 12; i++) {
      const [x, y] = pt(i / 12);
      g.lineTo(x, y);
    }
  } else {
    g.moveTo(x0, y0);
    g.quadraticCurveTo(mx, my, x1, y1);
  }
  const col = mixc(o.col ?? GOLD[2], GOLD[3], lit);
  if (o.fade) {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.45, rgba(col, o.a * 0.7));
    gr.addColorStop(1, rgba(col, o.a));
    g.strokeStyle = gr;
    g.lineWidth = o.w;
    g.stroke();
  } else {
    // Подложка тушью — нить читается и на светлых досках.
    g.strokeStyle = rgba(INK, o.a * 0.4);
    g.lineWidth = o.w + 0.9;
    g.stroke();
    g.strokeStyle = rgba(col, o.a);
    g.lineWidth = o.w;
    g.stroke();
  }
  if (o.glints === false) return;
  // Блики бегут вверх по нити; натянутая блестит ярче и чаще.
  const n = lit > 0.5 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const k = 1 - ((o.time * (0.45 + lit * 0.9) + o.seed * 0.13 + i * 0.5) % 1);
    if (o.fade && k < 0.35) continue;
    const [bx, by] = pt(k);
    g.fillStyle = rgba(lit > 0.5 ? WHITE : GOLD[3], o.a * (0.55 + 0.45 * lit));
    g.fillRect(bx - 0.6, by - 0.6, 1.2, 1.2);
  }
}

/** Обрывок: свисает от точки, качается; кончик распушён. */
function stub(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  sway: number,
  a: number,
  up = false,
): void {
  if (len < 0.5 || a <= 0.01) return;
  const s = up ? -1 : 1;
  const ex = x + Math.sin(sway) * len;
  const ey = y + s * Math.cos(sway) * len;
  g.strokeStyle = rgba(INK, a * 0.35);
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + Math.sin(sway * 0.4) * len * 0.5, y + s * len * 0.55, ex, ey);
  g.stroke();
  g.strokeStyle = rgba(GOLD[1], a);
  g.lineWidth = 0.7;
  g.stroke();
  g.fillStyle = rgba(GOLD[2], a);
  g.fillRect(ex - 1, ey, 0.7, 1.2);
  g.fillRect(ex + 0.3, ey - 0.2, 0.7, 1.4);
}

/** Маленькая вага (крестовина) — куда сходятся нити куклы. */
function crossbar(g: CanvasRenderingContext2D, x: number, y: number, w: number, a: number): void {
  g.strokeStyle = rgba(INK, a * 0.5);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x - w, y);
  g.lineTo(x + w, y);
  g.moveTo(x, y - 2.5);
  g.lineTo(x, y + 2.5);
  g.stroke();
  g.strokeStyle = rgba(P.wood[2], a);
  g.lineWidth = 1.1;
  g.stroke();
  g.fillStyle = rgba(GOLD[3], a);
  g.fillRect(x - w - 0.5, y - 0.5, 1, 1);
  g.fillRect(x + w - 0.5, y - 0.5, 1, 1);
}

/** Нити куклы к её крестовине и выше — во тьму колосников. */
function puppetStrings(
  g: CanvasRenderingContext2D,
  m: Mob,
  segs: StringSeg[],
  to: To,
  time: number,
  a: number,
): void {
  const at = cutTimes(m);
  const pull = pullOf(m, Math.max(...at));
  const sh = shoulderH(m, time);
  const bow = -m.vx * 1.4;
  let cx = 0;
  let cy = 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const s of segs) {
    const [bx, by] = to(s.bx, s.by);
    cx += bx;
    cy += by - 18 - pull.jerk;
    x0 = Math.min(x0, bx);
    x1 = Math.max(x1, bx);
  }
  cx /= segs.length;
  cy /= segs.length;
  for (const s of segs) {
    const [lx, lyFloor] = to(s.ax, s.ay);
    const ly = lyFloor + 0.18 * 16 - sh;
    const [tx] = to(s.bx, s.by);
    const ty = cy;
    const age = F13_FX.time - at[s.i];
    if (s.cut) {
      // Обрывки: от плеча и от крестовины, качаются и доигрывают хлыст.
      const k = ease(age / 0.35);
      const sw = Math.sin(time * 3.2 + s.i * 1.7 + m.id) * 0.25;
      const kick = Math.exp(-Math.max(0, age) * 3) * Math.sin(age * 14) * 0.9;
      stub(g, lx, ly, 5 * k, sw + kick, a * 0.85);
      stub(g, tx, ty, 7 * k, -sw - kick * 0.6, a * 0.85);
      continue;
    }
    thread(g, tx, ty, lx, ly, {
      a,
      w: 0.7,
      sag: pull.sag,
      bowX: bow,
      buzz: pull.buzz,
      lit: pull.lit,
      seed: s.i * 3.1 + m.id,
      time,
    });
  }
  crossbar(g, cx, cy, Math.max(3.5, (x1 - x0) / 2 + 1.5), a);
  // Выше ваги нить уходит во тьму колосников.
  thread(g, cx + 1 - bow * 0.5, cy - 44, cx, cy - 2, {
    a: a * 0.8,
    w: 0.6,
    sag: 0.2,
    seed: m.id,
    time,
    fade: true,
    lit: pull.lit,
  });
}

/** Нити исполина: от ваги в руке Кукловода (`lordVagaPx`) к плечам (`giantShoulderPx`). */
function giantStrings(
  g: CanvasRenderingContext2D,
  m: Mob,
  segs: StringSeg[],
  to: To,
  time: number,
  a: number,
): void {
  const vaga = vagaScreen(to, time);
  const at = cutTimes(m);
  const pull = pullOf(m, Math.max(...at));
  const sh = giantShoulderPx(m, time);
  const lord = lordNow();
  // Кукловод «провис» (одна нить срезана) — вага ниже, нити слабнут.
  const dip = lord ? k01((0.9 - (lord.data.lift ?? 1)) / 0.5) : 0;
  const sag = pull.sag * (1 + 1.6 * dip);
  const rebuild = m.mode === 'f13_rebuild';
  for (const s of segs) {
    const ox = s.ax - m.x;
    const oy = s.ay + 0.55 - m.y;
    const [bx, byFloor] = to(m.x + ox, m.y + oy);
    const by = byFloor - sh;
    const tx = vaga ? vaga[0] + ox * 8 : bx;
    const ty = vaga ? vaga[1] + 2 + oy * 8 : by - 44;
    const age = F13_FX.time - at[s.i];
    const seed = s.i * 3.1 + m.id;
    if (rebuild) {
      // Нити вяжутся обратно: опускаются от ваги к плечу по одной.
      const k = easeOut((m.t - 0.25 - s.i * 0.32) / 0.7);
      if (k <= 0) {
        stub(g, tx, ty, 6, Math.sin(time * 3 + s.i) * 0.3, a * 0.8);
        continue;
      }
      const ex = lerp(tx, bx, k);
      const ey = lerp(ty, by, k);
      thread(g, tx, ty, ex, ey, { a, w: 1, sag: 0.4 * (1 - k) + 0.3, seed, time, lit: 1 - k });
      if (k < 1) twinkle(g, ex, ey, 2.5, GOLD[3], 0.9);
      else if (m.t - 0.25 - s.i * 0.32 - 0.7 < 0.25) twinkle(g, bx, by, 3.5, WHITE, 0.9);
      continue;
    }
    if (s.cut) {
      const k = ease(age / 0.35);
      const sw = Math.sin(time * 2.6 + s.i * 1.9) * 0.22;
      const kick = Math.exp(-Math.max(0, age) * 2.5) * Math.sin(age * 12) * 1.1;
      stub(g, tx, ty, 10 * k, sw + kick, a * 0.9);
      stub(g, bx, by, 7 * k, -sw * 0.5 - kick * 0.5, a * 0.9);
      continue;
    }
    thread(g, tx, ty, bx, by, {
      a,
      w: 1,
      sag,
      bowX: -m.vx * 1.6,
      buzz: pull.buzz,
      lit: pull.lit,
      seed,
      time,
    });
  }
}

function drawStrings(
  g: CanvasRenderingContext2D,
  to: To,
  hx0: number,
  hy0: number,
  time: number,
): void {
  for (const m of F13_FX.mobs) {
    if (m.mode === 'dying' || (m.data.sn ?? 0) <= 0) continue;
    if (Math.abs(m.x - hx0) > 15 || Math.abs(m.y - hy0) > 13) continue;
    const segs = stringsOf(m);
    if (!segs.length) continue;
    const a = (m.data.ghost ?? 0) > 0 ? 0.3 : 0.9;
    if (m.kind === 'f13_giant') giantStrings(g, m, segs, to, time, a);
    else puppetStrings(g, m, segs, to, time, a);
  }
}

/** Тени нитей на полу: где их на самом деле режет взмах. */
function stringShadows(g: CanvasRenderingContext2D, to: To, hx0: number, hy0: number): void {
  for (const m of F13_FX.mobs) {
    if (m.mode === 'dying' || (m.data.sn ?? 0) <= 0) continue;
    if ((m.data.ghost ?? 0) > 0) continue;
    if (Math.abs(m.x - hx0) > 12 || Math.abs(m.y - hy0) > 10) continue;
    const giant = m.kind === 'f13_giant';
    for (const s of stringsOf(m)) {
      if (s.cut) continue;
      const [ax, ay] = to(s.ax, s.ay);
      const [bx, by] = to(s.bx, s.by);
      g.strokeStyle = 'rgba(8,4,12,0.32)';
      g.lineWidth = giant ? 1.6 : 1.2;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      // Золотая пунктирная риска поверх тени.
      g.strokeStyle = rgba(GOLD[2], giant ? 0.32 : 0.22);
      g.lineWidth = 0.6;
      g.setLineDash([1.5, 2.5]);
      g.stroke();
      g.setLineDash([]);
    }
  }
}

/**
 * Вага Кукловода в окно (акты I–III): ореол и искры. Его собственные нити к
 * шляпе и запястьям рисует «Тело» в кадре (`lordThread`) — второй набор здесь
 * дублировал их и проходил сквозь фигуру.
 */
function lordFlies(g: CanvasRenderingContext2D, to: To, time: number): void {
  if (F13_FX.act === 3) return;
  const lord = lordNow();
  if (!lord || lord.mode === 'chase') return;
  const [x, y] = to(lord.x, lord.y);
  const [vdx, vdy] = lordVagaPx(lord, time);
  if (lord.data.open) {
    // Окно: вага горит — ореол и искры с концов крестовины.
    const vx = x + vdx;
    const vy = y + vdy;
    const p = 0.5 + 0.5 * Math.sin(time * 7);
    lighter(g, () => glow(g, vx, vy, 11 + 2 * p, WARM, 0.32 + 0.12 * p));
    for (let i = 0; i < 4; i++) {
      const ph = (time * 1.6 + i * 0.25) % 1;
      const ex = vx + (i % 2 ? 5 : -5) * (i < 2 ? 1 : 0);
      const ey = vy + (i >= 2 ? (i % 2 ? 3.6 : -3.6) : 0);
      twinkle(g, ex, ey - ph * 4, 1.6 * (1 - ph), GOLD[3], 1 - ph);
    }
  }
}

// ---------------------------------------------------------------------------
// Свет: софиты с пылью в луче, луна акта III с туманом.
// ---------------------------------------------------------------------------

/** Столб света от фонаря (lx, ly) к пятну (x, y) радиуса r — сложением. */
function beam(
  g: CanvasRenderingContext2D,
  lx: number,
  ly: number,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
  time: number,
  seed: number,
  motes = 9,
): void {
  const dx = x - lx;
  const dy = y - ly;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const gr = g.createLinearGradient(lx, ly, x, y);
  gr.addColorStop(0, rgba(col, a * 1.2));
  gr.addColorStop(0.6, rgba(col, a * 0.55));
  gr.addColorStop(1, rgba(col, a * 0.2));
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(lx + nx * 2, ly + ny * 2);
  g.lineTo(x + nx * r, y + ny * r * 0.55);
  g.lineTo(x - nx * r, y - ny * r * 0.55);
  g.lineTo(lx - nx * 2, ly - ny * 2);
  g.closePath();
  g.fill();
  // Пыль в луче: медленно плывёт вниз и вбок, мерцает.
  for (let i = 0; i < motes; i++) {
    const u = (hash(seed, i, 61) + time * (0.035 + 0.03 * hash(seed, i, 62))) % 1;
    const v = Math.sin(time * (0.4 + hash(seed, i, 63) * 0.5) + i * 2.1) * 0.85;
    const half = lerp(2, r, u);
    const px = lx + dx * u + nx * v * half;
    const py = ly + dy * u + ny * v * half * 0.55;
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * (1.5 + i * 0.3) + i));
    g.fillStyle = rgba(col, a * 3.2 * tw * Math.sin(u * Math.PI));
    g.fillRect(px - 0.5, py - 0.5, 1, 1);
  }
}

/** Пятно света на полу: мягкий центр, чёткий край прожектора. */
function pool(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  col: RGBA,
  a: number,
  rim = 0,
): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(col, a));
  gr.addColorStop(0.75, rgba(col, a * 0.7));
  gr.addColorStop(0.95, rgba(col, a * 0.85));
  gr.addColorStop(1, rgba(col, 0));
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(x, y, r, r * 0.9, 0, 0, TAU);
  g.fill();
  if (rim > 0) {
    g.strokeStyle = rgba(col, rim);
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(x, y, r * 0.97, r * 0.87, 0, 0, TAU);
    g.stroke();
  }
}

/** Месяц из фанеры на двух нитях, холодный луч к пятну на полу. */
function moon(g: CanvasRenderingContext2D, to: To, time: number): void {
  const m = F13_FX.moon;
  if (m.r <= 0) return;
  const [x, y] = to(m.x, m.y);
  const mx = x + 8;
  const my = y - 78 + Math.sin(time * 0.9) * 1.2;
  const R = m.r * 16;
  lighter(g, () => {
    beam(g, mx, my + 4, x, y, R, MOON, 0.09, time, 7, 12);
    glow(g, mx, my, 20, MOON, 0.22);
  });
  // Нити месяца к колосникам.
  for (const dx of [-4, 4])
    thread(g, mx + dx, my - 70, mx + dx * 0.6, my - 7, {
      a: 0.7,
      w: 0.6,
      sag: 0.1,
      seed: dx,
      time,
      fade: true,
    });
  // Серп: светлая фанера, кромка, лицо в профиль.
  g.fillStyle = rgba(INK, 0.9);
  g.beginPath();
  g.arc(mx, my, 10, 0, TAU);
  g.fill();
  g.fillStyle = rgba([236, 240, 255, 255], 1);
  g.beginPath();
  g.arc(mx, my, 9, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.night[1], 1);
  g.beginPath();
  g.arc(mx + 5, my - 2.5, 8.2, 0, TAU);
  g.fill();
  g.fillStyle = rgba([196, 206, 236, 255], 1);
  g.fillRect(mx - 7, my + 1, 3, 1);
  g.fillStyle = rgba(INK, 0.9);
  g.fillRect(mx - 5, my - 2, 1, 1);
  g.fillRect(mx - 6, my + 3, 2, 1);
  g.strokeStyle = rgba(GOLD[2], 0.8);
  g.lineWidth = 0.6;
  g.beginPath();
  g.arc(mx, my, 9.4, 1.2, 5.1);
  g.stroke();
}

/** Пятно луны на полу и туман по его краю. */
function moonPool(g: CanvasRenderingContext2D, to: To, time: number): void {
  const m = F13_FX.moon;
  if (m.r <= 0) return;
  const [x, y] = to(m.x, m.y);
  const R = m.r * 16;
  pool(g, x, y, R, MOON, 0.26, 0.45);
  // Туман: клочья ползут по краю круга.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + time * 0.12 * (i % 2 ? 1 : -1);
    const rr = R * (0.85 + 0.25 * Math.sin(time * 0.5 + i * 1.3));
    const fx = x + Math.cos(a) * rr;
    const fy = y + Math.sin(a) * rr * 0.9;
    glow(g, fx, fy, 9 + 3 * Math.sin(time + i), [200, 214, 240, 255], 0.13, 0.45);
  }
}

// ---------------------------------------------------------------------------
// «Буря»: тканевые волны с шестами по краям проёмов.
// ---------------------------------------------------------------------------

const ARENA_X0 = 12;
const ARENA_X1 = 52;
type Wave = (typeof F13_FX.waves)[number];
const inGap = (w: Wave, x: number) => w.gaps.some((gx) => Math.abs(x - gx) < w.gapW / 2);
/** Волна проходит за кораблём: над бортом полотно не рисуем. */
const behindShip = (w: Wave, x: number) => Math.abs(w.y - 10.9) < 1.3 && x > 25.8 && x < 38.2;

/** Высота гребня: набухает, потом катится с перекатом полотна. */
function crestH(w: Wave, x: number, time: number): number {
  const swell = w.t < BOSS.wave.swell;
  const k = swell ? easeOut(w.t / BOSS.wave.swell) : 1;
  return (
    (3 + 13 * k) * (1 + 0.12 * Math.sin(x * 1.4 + time * 5 * w.dir)) +
    Math.sin(x * 0.6 - time * 3) * 1.2
  );
}

function waveCrest(g: CanvasRenderingContext2D, to: To, w: Wave, time: number): void {
  const [vw] = viewSize(g);
  const [, sy] = to(0, w.y);
  const [ex0] = to(ARENA_X0, 0);
  const [ex1] = to(ARENA_X1, 0);
  const S = P.sea;
  const front = w.dir > 0;
  const swell = w.t < BOSS.wave.swell;
  const xa = Math.max(ex0, -4);
  const xb = Math.min(ex1, vw + 4);
  for (let sx = Math.floor(xa / 2) * 2; sx < xb; sx += 2) {
    const wx = ARENA_X0 + (sx - ex0) / 16;
    if (inGap(w, wx + 1 / 16) || behindShip(w, wx)) continue;
    const h = crestH(w, wx, time);
    const top = sy - h;
    // Складки полотна: светлые гребни ткани и тени между ними.
    const fold = Math.sin(wx * 2.6 + time * 2.2 * w.dir) + 0.4 * Math.sin(wx * 6.1 - time);
    const body = fold > 0.7 ? S[2] : fold < -0.6 ? S[0] : S[1];
    g.fillStyle = rgba(INK, 0.85);
    g.fillRect(sx, top - 1.5, 2, h + 2);
    if (front) {
      // Лицо волны к зрителю: тёмный низ, светлеет к гребню, кружево пены.
      g.fillStyle = rgba(body, 1);
      g.fillRect(sx, top, 2, h);
      g.fillStyle = rgba(fold > 0.7 ? S[3] : S[2], 1);
      g.fillRect(sx, top, 2, h * 0.38);
      g.fillStyle = rgba(S[0], 0.8);
      g.fillRect(sx, sy - 2, 2, 2);
      const lace = Math.sin(wx * 9 + time * 7) > 0.2;
      g.fillStyle = rgba(WHITE, 0.95);
      g.fillRect(sx, top, 2, lace ? 2 : 1.2);
      if (lace) g.fillRect(sx + 0.5, top + 2, 1, 1.2);
    } else {
      // Спина волны: тёмная, пена только по кромке.
      g.fillStyle = rgba(S[0], 1);
      g.fillRect(sx, top, 2, h);
      g.fillStyle = rgba(body, 1);
      g.fillRect(sx, top, 2, h * 0.3);
      g.fillStyle = rgba(S[3], 0.9);
      g.fillRect(sx, top, 2, 1);
    }
    // Брызги с гребня, когда катится.
    if (!swell && hash(Math.floor(wx * 4), Math.floor(time * 10), 7) > 0.93) {
      g.fillStyle = rgba(WHITE, 0.85);
      g.fillRect(sx, top - 3 - hash(sx, Math.floor(time * 10), 8) * 4, 1, 1);
    }
  }
  // Края проёмов: шесты рабочих сцены держат полотно — видно заранее.
  for (const gx of w.gaps) {
    for (const s of [-1, 1]) {
      const wx = gx + (s * w.gapW) / 2;
      const [px] = to(wx, 0);
      if (px < -6 || px > vw + 6) continue;
      const h = crestH(w, wx, time) + 7;
      const p = 0.5 + 0.5 * Math.sin(time * 9 + s);
      g.fillStyle = rgba(INK, 0.9);
      g.fillRect(px - 1.5, sy - h - 1, 3, h + 3);
      g.fillStyle = rgba(P.wood[2], 1);
      g.fillRect(px - 0.5, sy - h, 1.5, h + 1);
      lighter(g, () => glow(g, px, sy - h, 5 + 2 * p, WARM, swell ? 0.5 : 0.35));
      g.fillStyle = rgba(GOLD[3], 1);
      g.fillRect(px - 1, sy - h - 1, 2.5, 2);
    }
  }
}

/** На полу: тень гребня, светлые дорожки проёмов впереди, пена позади. */
function waveFloor(g: CanvasRenderingContext2D, to: To, w: Wave, time: number): void {
  const [vw] = viewSize(g);
  const [, sy] = to(0, w.y);
  const [ex0] = to(ARENA_X0, 0);
  const [ex1] = to(ARENA_X1, 0);
  const [, yTop] = to(0, 2);
  const [, yBot] = to(0, 23);
  const swell = w.t < BOSS.wave.swell;
  // Дорожки проёмов: от волны вперёд до края сцены.
  const far = w.dir > 0 ? yBot : yTop;
  for (const gx of w.gaps) {
    const [cx] = to(gx, 0);
    const half = (w.gapW / 2) * 16;
    if (cx + half < 0 || cx - half > vw) continue;
    const y0 = Math.min(sy, far);
    const y1 = Math.max(sy, far);
    g.fillStyle = rgba(WARM, swell ? 0.13 : 0.09);
    g.fillRect(cx - half, y0, half * 2, y1 - y0);
    g.strokeStyle = rgba(GOLD[2], swell ? 0.55 : 0.4);
    g.lineWidth = 0.8;
    g.setLineDash([3, 3]);
    g.lineDashOffset = -time * 24 * w.dir;
    g.beginPath();
    g.moveTo(cx - half + 0.5, y0);
    g.lineTo(cx - half + 0.5, y1);
    g.moveTo(cx + half - 0.5, y0);
    g.lineTo(cx + half - 0.5, y1);
    g.stroke();
    g.setLineDash([]);
  }
  // Тень гребня и пена позади.
  const xa = Math.max(ex0, -4);
  const xb = Math.min(ex1, vw + 4);
  for (let sx = Math.floor(xa / 2) * 2; sx < xb; sx += 2) {
    const wx = ARENA_X0 + (sx - ex0) / 16;
    if (inGap(w, wx + 1 / 16)) continue;
    g.fillStyle = 'rgba(4,14,30,0.4)';
    g.fillRect(sx, sy + (w.dir > 0 ? 0 : -3), 2, 4);
    if (swell) continue;
    for (let j = 0; j < 3; j++) {
      const back = sy - w.dir * (4 + j * 5);
      const on = hash(Math.floor(wx * 3), j, Math.floor(time * 6)) > 0.45 + j * 0.15;
      if (!on) continue;
      g.fillStyle = rgba(P.sea[3], 0.5 - j * 0.14);
      g.fillRect(sx, back, 2, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// «Звёздная ночь»: звёзды-маятники — дуга на полу, тень впереди, шлейф.
// ---------------------------------------------------------------------------

const STAR = BOSS.star;
const STAR_W = TAU / STAR.period;
/** Угол маятника звезды i в миг T (тот же закон, что у мозга). */
const starTh = (i: number, T: number) => STAR.amp * Math.sin(STAR_W * T + (i * TAU) / 3);

function starShape(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
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
  starShape(g, x, y, r, rot);
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = edge;
  g.lineWidth = 0.8;
  g.stroke();
}

/** Звезда сейчас, по закону маятника; null — если расходится с мозгом. */
function starNow(i: number, s: (typeof F13_FX.stars)[number]): number | null {
  const th = starTh(i, F13_FX.time);
  const x = s.px + Math.sin(th) * s.L;
  const y = s.py + Math.cos(th) * s.L;
  return Math.hypot(x - s.x, y - s.y) < 0.6 ? th : null;
}

function starFloor(g: CanvasRenderingContext2D, to: To, time: number): void {
  F13_FX.stars.forEach((s, i) => {
    if (s.cut) return;
    const at = (th: number): [number, number] =>
      to(s.px + Math.sin(th) * s.L, s.py + Math.cos(th) * s.L);
    // Дуга-след на полу: мелом, низ дуги (там быстрее всего) — ярче.
    g.lineWidth = 0.9;
    g.setLineDash([2, 3]);
    g.lineDashOffset = -time * 10;
    for (let j = 0; j < 24; j++) {
      const t0 = -STAR.amp + (2 * STAR.amp * j) / 24;
      const t1 = t0 + (2 * STAR.amp) / 24;
      const fast = 1 - Math.min(1, Math.abs((t0 + t1) / 2) / STAR.amp);
      const [x0, y0] = at(t0);
      const [x1, y1] = at(t1);
      g.strokeStyle = rgba(mixc(GOLD[1], GOLD[3], fast), 0.16 + 0.32 * fast * fast);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    g.setLineDash([]);
    const th = starNow(i, s);
    const [x, y] = to(s.x, s.y);
    // Своя тень под звездой и круг, где она бьёт.
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.ellipse(x, y + 1, 6, 2.2, 0, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(GOLD[2], 0.3);
    g.lineWidth = 0.7;
    g.beginPath();
    g.ellipse(x, y, STAR.r * 16, STAR.r * 16 * 0.85, 0, 0, TAU);
    g.stroke();
    if (th === null) return;
    // Тень бежит впереди: где звезда будет через 0,3 и 0,6 с.
    for (const [ahead, al] of [
      [0.3, 0.42],
      [0.6, 0.22],
    ] as const) {
      const [fx, fy] = at(starTh(i, F13_FX.time + ahead));
      g.fillStyle = `rgba(6,4,20,${al})`;
      starShape(g, fx, fy, 6.5, 0);
      g.fill();
      g.strokeStyle = rgba(GOLD[2], al * 0.8);
      g.lineWidth = 0.6;
      g.stroke();
    }
  });
}

function drawStars(g: CanvasRenderingContext2D, to: To, time: number): void {
  F13_FX.stars.forEach((s, i) => {
    const [px, py] = to(s.px, s.py);
    const [x, y] = to(s.x, s.y);
    const top = py - 60;
    if (s.cut) {
      // Срезанная: лежит на полу, тускло мерцает; обрывки висят сверху.
      star(g, x, y - 2, 6, 0.4, rgba(GOLD[1], 0.75), rgba(INK, 0.8));
      stub(g, px - 3, top, 10, Math.sin(time * 2 + i) * 0.3, 0.7);
      stub(g, px + 3, top, 8, Math.sin(time * 2.3 + i) * 0.3, 0.7);
      return;
    }
    const sy = y - 14;
    const th = starNow(i, s);
    const v =
      th === null
        ? 0
        : Math.abs(STAR.amp * STAR_W * Math.cos(Math.asin(k01(Math.abs(th) / STAR.amp)))) * s.L;
    const fast = k01((v - 5) / 7);
    // Свист у низа дуги — шлейф прошлых мест и полосы скорости.
    if (th !== null && fast > 0) {
      for (let j = 6; j >= 1; j--) {
        const tj = starTh(i, F13_FX.time - j * 0.028);
        const [gx, gy] = to(s.px + Math.sin(tj) * s.L, s.py + Math.cos(tj) * s.L);
        g.fillStyle = rgba(GOLD[3], fast * 0.32 * (1 - j / 7));
        starShape(g, gx, gy - 14, 8 * (1 - j * 0.06), time * 3);
        g.fill();
      }
      const t1 = starTh(i, F13_FX.time - 0.16);
      const [bx, by] = to(s.px + Math.sin(t1) * s.L, s.py + Math.cos(t1) * s.L);
      lighter(g, () => {
        for (const o of [-3, 0, 3]) {
          g.strokeStyle = rgba(WHITE, fast * 0.45);
          g.lineWidth = 0.7;
          g.beginPath();
          g.moveTo(bx, by - 14 + o);
          g.lineTo(x, sy + o * 0.6);
          g.stroke();
        }
      });
    }
    // Две нити: к звезде от балки — обе режутся.
    thread(g, px - 3, top, x - 2, sy - 6, { a: 0.9, w: 0.8, sag: 0.25, seed: s.px * 3, time });
    thread(g, px + 3, top, x + 2, sy - 6, { a: 0.9, w: 0.8, sag: 0.25, seed: s.px * 3 + 1, time });
    lighter(g, () => glow(g, x, sy, 15 + 3 * fast, [255, 236, 160, 255], 0.38 + 0.2 * fast));
    const rot = time * (1.2 + 5 * fast) + s.px;
    star(g, x, sy, 9, rot, rgba(GOLD[2], 1), rgba(INK, 0.9));
    star(g, x - 1, sy - 1, 4, rot, rgba(GOLD[3], 0.95), rgba(GOLD[3], 0));
    twinkle(g, x - 3, sy - 4, 2 + Math.sin(time * 6 + i) * 0.8, WHITE, 0.8);
  });
}

/** Облака из ваты на нитях над северным краем сцены (акт III). */
function cottonClouds(g: CanvasRenderingContext2D, to: To, time: number): void {
  const [vw] = viewSize(g);
  for (let i = 0; i < 5; i++) {
    const wx = ARENA_X0 + 4 + i * 8 + Math.sin(time * 0.15 + i * 2) * 1.2;
    const [x, y0] = to(wx, 2.6 + (i % 2) * 0.6);
    if (x < -30 || x > vw + 30) continue;
    const y = y0 - 34 + Math.sin(time * 0.7 + i) * 1.5;
    thread(g, x - 6, y - 60, x - 6, y - 4, { a: 0.5, w: 0.5, sag: 0, seed: i, time, fade: true });
    thread(g, x + 7, y - 60, x + 7, y - 4, {
      a: 0.5,
      w: 0.5,
      sag: 0,
      seed: i + 9,
      time,
      fade: true,
    });
    const puffs = [
      [-9, 1, 6],
      [-3, -3, 7],
      [4, -2, 6.5],
      [10, 1, 5],
      [1, 2, 6],
    ];
    g.fillStyle = rgba(INK, 0.6);
    for (const [dx, dy, r] of puffs) {
      g.beginPath();
      g.arc(x + dx, y + dy, r + 1, 0, TAU);
      g.fill();
    }
    g.fillStyle = rgba([150, 156, 196, 255], 1);
    for (const [dx, dy, r] of puffs) {
      g.beginPath();
      g.arc(x + dx, y + dy, r, 0, TAU);
      g.fill();
    }
    g.fillStyle = rgba([226, 228, 246, 255], 1);
    for (const [dx, dy, r] of puffs) {
      g.beginPath();
      g.arc(x + dx - 1, y + dy - 1.5, r * 0.7, 0, TAU);
      g.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Метки ударов Кукловода и исполина (`vNoTele`): золото, нити, свет рампы.
// «Куда» — весь контур с первого кадра; «когда» — фронт налива, натяжение
// нитей и бегущий блик; последние 0,2 с — белое золото, звон, двойной пульс.
// Пол — заливка и рисунок (под мобами), поверх темноты — тонкие яркие нити.
// ---------------------------------------------------------------------------

const WARN: Record<string, number> = {
  f13_cut1: BOSS.cone.warn,
  f13_cut2: BOSS.thrust.warn,
  f13_snare: BOSS.snare.aim,
  f13_needle: BOSS.needle.aim,
  f13_lance: BOSS.lance.aim,
  f13_shield: BOSS.shield.aim,
  f13_charge_aim: BOSS.charge.aim,
};

/** Последние 0,2 с перед уроном: 0 — ещё рано, 1 — удар. */
const lastK = (m: Mob) => k01(1 - ((WARN[m.mode] ?? 0.6) - m.t) / 0.2);
/** Двойной пульс сигнала. */
const pulse = (f: number) => (f > 0 ? 0.5 + 0.5 * Math.cos(f * Math.PI * 4) : 0);

type Layer = 'floor' | 'above';

/** Конус: веер нитей от руки к кромке, фронт налива, засечки. */
function markCone(
  g: CanvasRenderingContext2D,
  layer: Layer,
  ox: number,
  oy: number,
  hand: [number, number],
  R: number,
  a0: number,
  arc: number,
  k: number,
  f: number,
  time: number,
  T: Tone3,
): void {
  const l = a0 - arc / 2;
  const r = a0 + arc / 2;
  if (layer === 'floor') {
    const gr = g.createRadialGradient(ox, oy, 0, ox, oy, R);
    gr.addColorStop(0, rgba(T.fill, 0.04 + 0.1 * k));
    gr.addColorStop(1, rgba(T.fill, 0.1 + 0.2 * k + 0.2 * f));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(ox, oy);
    g.arc(ox, oy, R, l, r);
    g.closePath();
    g.fill();
    // Фронт налива: от ног к кромке, с ускорением.
    const fr = R * easeIn(k);
    g.fillStyle = rgba(T.fill, 0.14 + 0.1 * k);
    g.beginPath();
    g.moveTo(ox, oy);
    g.arc(ox, oy, fr, l, r);
    g.closePath();
    g.fill();
    // Кромка-нить «марширует» вдоль дуги.
    g.strokeStyle = rgba(T.edge, 0.45 + 0.4 * k);
    g.lineWidth = 1;
    g.setLineDash([3, 2]);
    g.lineDashOffset = -time * 18;
    g.beginPath();
    g.arc(ox, oy, R, l, r);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(ox + Math.cos(l) * 3, oy + Math.sin(l) * 3);
    g.lineTo(ox + Math.cos(l) * R, oy + Math.sin(l) * R);
    g.moveTo(ox + Math.cos(r) * 3, oy + Math.sin(r) * 3);
    g.lineTo(ox + Math.cos(r) * R, oy + Math.sin(r) * R);
    g.strokeStyle = rgba(T.edge, 0.3 + 0.4 * k);
    g.lineWidth = 0.7;
    g.stroke();
    return;
  }
  // Поверх темноты: веер нитей от руки к кромке — провисшие, к удару в струну.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = l + (arc * i) / (n - 1);
    const ex = ox + Math.cos(a) * R;
    const ey = oy + Math.sin(a) * R;
    thread(g, hand[0], hand[1], ex, ey, {
      a: 0.25 + 0.45 * k + 0.3 * f,
      w: 0.6,
      sag: 1.6 * (1 - ease(k)),
      buzz: f * 0.8,
      lit: k * 0.6 + f * 0.4,
      seed: i * 2.3,
      time,
      glints: i % 2 === 0,
      col: T.thread,
    });
  }
  // Кромка вспыхивает в последние 0,2 с.
  if (f > 0) {
    const p = pulse(f);
    g.strokeStyle = rgba(mixc(T.edge, WHITE, f), 0.5 + 0.5 * p);
    g.lineWidth = 1 + f;
    g.beginPath();
    g.arc(ox, oy, R, l, r);
    g.stroke();
    for (const e of [l, r])
      twinkle(g, ox + Math.cos(e) * R, oy + Math.sin(e) * R, 2 + 2 * p, WHITE, f);
  } else {
    g.strokeStyle = rgba(T.edge, 0.25 + 0.35 * k);
    g.lineWidth = 0.7;
    g.beginPath();
    g.arc(ox, oy, R, l, r);
    g.stroke();
  }
}

/** Линия: полоса, нить по оси, бегущая бусина-остриё, прицел на конце. */
function markLine(
  g: CanvasRenderingContext2D,
  layer: Layer,
  ox: number,
  oy: number,
  hand: [number, number],
  L: number,
  w: number,
  a0: number,
  k: number,
  f: number,
  time: number,
  T: Tone3,
  style: 'thrust' | 'snare' | 'lance' | 'charge' | 'needle',
): void {
  const ca = Math.cos(a0);
  const sa = Math.sin(a0);
  const ex = ox + ca * L;
  const ey = oy + sa * L;
  if (layer === 'floor') {
    g.save();
    g.translate(ox, oy);
    g.rotate(a0);
    const gr = g.createLinearGradient(0, 0, L, 0);
    gr.addColorStop(0, rgba(T.fill, 0.05 + 0.08 * k));
    gr.addColorStop(1, rgba(T.fill, 0.1 + 0.18 * k + 0.2 * f));
    g.fillStyle = gr;
    g.fillRect(0, -w, L, w * 2);
    if (style === 'lance') {
      // Турнирное копьё: косые полосы бегут к острию.
      g.save();
      g.beginPath();
      g.rect(0, -w, L * easeIn(0.25 + 0.75 * k), w * 2);
      g.clip();
      g.fillStyle = rgba(GOLD[2], 0.16 + 0.22 * k + 0.2 * f);
      const off = (time * 20) % 8;
      for (let x = -8 + off; x < L + 8; x += 8) {
        g.beginPath();
        g.moveTo(x, -w);
        g.lineTo(x + 4, -w);
        g.lineTo(x + 4 - w, w);
        g.lineTo(x - w, w);
        g.closePath();
        g.fill();
      }
      g.restore();
    } else if (style === 'charge') {
      // Таран: шевроны бегут вперёд, быстрее к броску.
      const sp = 14 + 50 * k;
      const off = (time * sp) % 9;
      g.strokeStyle = rgba(T.edge, 0.3 + 0.4 * k + 0.3 * f);
      g.lineWidth = 1.2;
      for (let x = off; x < L - 2; x += 9) {
        g.beginPath();
        g.moveTo(x - 3, -w * 0.7);
        g.lineTo(x, 0);
        g.lineTo(x - 3, w * 0.7);
        g.stroke();
      }
      // Где встанет: поперечная планка.
      g.fillStyle = rgba(T.edge, 0.5 + 0.4 * k);
      g.fillRect(L - 1.5, -w - 1, 2, w * 2 + 2);
    } else {
      // Фронт налива.
      g.fillStyle = rgba(T.fill, 0.12 + 0.1 * k);
      g.fillRect(0, -w, L * easeIn(k), w * 2);
    }
    // Края — пунктир «марширует» к концу.
    g.strokeStyle = rgba(T.edge, 0.35 + 0.4 * k);
    g.lineWidth = 0.7;
    g.setLineDash(style === 'snare' ? [1.2, 2.4] : [3, 2]);
    g.lineDashOffset = -time * 16;
    g.beginPath();
    if (style === 'snare' || style === 'needle') {
      g.moveTo(0, 0);
      g.lineTo(L, 0);
    } else {
      g.moveTo(0, -w);
      g.lineTo(L, -w);
      g.moveTo(0, w);
      g.lineTo(L, w);
    }
    g.stroke();
    g.setLineDash([]);
    if (style === 'snare') {
      // Петля лежит на конце: туда упадёт аркан.
      g.strokeStyle = rgba(T.edge, 0.4 + 0.5 * k);
      g.lineWidth = 0.9;
      g.beginPath();
      g.ellipse(L, 0, 5 + 2 * (1 - k), 4 + 2 * (1 - k), 0, 0, TAU);
      g.stroke();
    }
    g.restore();
    return;
  }
  // Поверх темноты: нить по оси (от руки к концу) и бусина-остриё.
  const tight = ease(k);
  if (style === 'thrust' || style === 'snare') {
    thread(g, hand[0], hand[1], ex, ey, {
      a: 0.3 + 0.45 * k + 0.25 * f,
      w: 0.7,
      sag: 1.4 * (1 - tight),
      buzz: f * 0.7,
      lit: 0.3 * k + 0.7 * f,
      seed: 3,
      time,
      col: T.thread,
    });
  }
  // Бусина бежит от него к концу, ускоряясь, — «когда».
  const bk = easeIn(k);
  const bx = lerp(ox, ex, bk);
  const by = lerp(oy, ey, bk);
  if (style !== 'snare') twinkle(g, bx, by, 1.5 + 1.5 * k, T.edge, 0.4 + 0.6 * k);
  // Прицел на конце: ромб крутится и сжимается.
  const rr = 4 + 3 * (1 - k);
  const rot = time * (2 + 6 * k);
  g.strokeStyle = rgba(mixc(T.edge, WHITE, f), 0.35 + 0.5 * k + 0.15 * pulse(f));
  g.lineWidth = 0.8 + f * 0.6;
  g.beginPath();
  for (let i = 0; i <= 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    const px = ex + Math.cos(a) * rr;
    const py = ey + Math.sin(a) * rr * 0.8;
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.stroke();
  if (f > 0) {
    const p = pulse(f);
    twinkle(g, ex, ey, 3 + 3 * p, WHITE, f);
    // Края полосы вспыхивают.
    const nx = -sa * w;
    const ny = ca * w;
    g.strokeStyle = rgba(
      mixc(T.edge, WHITE, f * 0.6),
      (0.35 + 0.55 * p) * (style === 'needle' ? 0.5 : 1),
    );
    g.lineWidth = 0.9;
    g.beginPath();
    if (style === 'needle' || style === 'snare') {
      g.moveTo(ox, oy);
      g.lineTo(ex, ey);
    } else {
      g.moveTo(ox + nx, oy + ny);
      g.lineTo(ex + nx, ey + ny);
      g.moveTo(ox - nx, oy - ny);
      g.lineTo(ex - nx, ey - ny);
    }
    g.stroke();
  }
}

/** Аркан над головой: петля крутится всё быстрее (поверх темноты). */
function lassoSpin(
  g: CanvasRenderingContext2D,
  hx0: number,
  hy0: number,
  k: number,
  f: number,
  t: number,
): void {
  const cx = hx0;
  const cy = hy0 - 7;
  const ph = t * (9 + 22 * k * k);
  const rx = 7 + 2 * k;
  const ry = 2.6;
  // Верёвка от руки к узлу петли.
  const kx = cx + Math.cos(ph) * rx;
  const ky = cy + Math.sin(ph) * ry;
  g.strokeStyle = rgba(INK, 0.5);
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(mixc(GOLD[2], WHITE, f), 0.85);
  g.lineWidth = 0.9;
  g.stroke();
  g.beginPath();
  g.moveTo(hx0, hy0);
  g.lineTo(kx, ky);
  g.stroke();
  twinkle(g, kx, ky, 1.5 + f * 2, GOLD[3], 0.9);
  // Свист: дуги позади узла.
  for (let j = 1; j <= 3; j++) {
    const pa = ph - j * 0.35;
    g.fillStyle = rgba(GOLD[3], (0.3 + 0.4 * k) * (1 - j / 4));
    g.fillRect(cx + Math.cos(pa) * rx - 0.5, cy + Math.sin(pa) * ry - 0.5, 1, 1);
  }
}

interface Tone3 {
  fill: RGBA;
  edge: RGBA;
  thread: RGBA;
}
const T_LORD: Tone3 = { fill: WARM, edge: GOLD[3], thread: GOLD[2] };
const T_NEEDLE: Tone3 = { fill: [200, 214, 240, 255], edge: SILVER[3], thread: SILVER[2] };
const T_LANCE: Tone3 = { fill: [255, 190, 150, 255], edge: GOLD[3], thread: GOLD[2] };
const T_SHIELD: Tone3 = { fill: [120, 150, 230, 255], edge: GOLD[3], thread: GOLD[2] };

/** Метки Кукловода и исполина по `m.tele` (обе в мозге — `vNoTele`). */
function bossMarks(g: CanvasRenderingContext2D, layer: Layer, to: To, time: number): void {
  for (const m of F13_FX.mobs) {
    const t = m.tele;
    if (!t || (m.kind !== 'f13boss' && m.kind !== 'f13_giant')) continue;
    const [ox, oy] = to(t.x ?? m.x, t.y ?? m.y);
    const k = k01(t.k ?? 0);
    const f = lastK(m);
    const a0 = t.ang ?? 0;
    const R = t.r * 16;
    const W = (t.w ?? 0.4) * 16;
    let hand: [number, number] = [ox, oy - 20];
    if (m.kind === 'f13boss') {
      const [dx, dy] = lordVagaPx(m, time);
      hand = [ox + dx, oy + dy];
    }
    switch (m.mode) {
      case 'f13_cut1':
        markCone(g, layer, ox, oy, hand, R, a0, t.arc ?? 2, k, f, time, T_LORD);
        break;
      case 'f13_cut2':
        markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LORD, 'thrust');
        break;
      case 'f13_snare':
        markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LORD, 'snare');
        if (layer === 'above') lassoSpin(g, hand[0], hand[1], k, f, m.t);
        break;
      case 'f13_needle':
        // Три иглы веером (разброс мозга 0,24): каждая — своя серебряная нить.
        for (const d of [-0.12, 0, 0.12])
          markLine(g, layer, ox, oy, hand, R, 2.4, a0 + d, k, f, time, T_NEEDLE, 'needle');
        if (layer === 'above')
          // Три иглы в пальцах веером — блестят сильнее к броску.
          for (const d of [-0.35, 0, 0.35]) {
            const a = a0 + d;
            const x0 = hand[0] + Math.cos(a) * 2;
            const y0 = hand[1] + Math.sin(a) * 2;
            g.strokeStyle = rgba(SILVER[3], 0.9);
            g.lineWidth = 0.8;
            g.beginPath();
            g.moveTo(x0, y0);
            g.lineTo(x0 + Math.cos(a) * 6, y0 + Math.sin(a) * 6);
            g.stroke();
            twinkle(g, x0 + Math.cos(a) * 6, y0 + Math.sin(a) * 6, 1 + 2 * k, WHITE, 0.4 + 0.6 * f);
          }
        break;
      case 'f13_lance':
        markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LANCE, 'lance');
        break;
      case 'f13_charge_aim':
        markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LANCE, 'charge');
        break;
      case 'f13_shield':
        markCone(g, layer, ox, oy, [ox, oy - 22], R, a0, t.arc ?? 1.7, k, f, time, T_SHIELD);
        break;
      default:
        if (t.shape === 'cone')
          markCone(g, layer, ox, oy, hand, R, a0, t.arc ?? 1, k, f, time, T_LORD);
        else if (t.shape === 'line')
          markLine(g, layer, ox, oy, hand, R, W, a0, k, f, time, T_LORD, 'thrust');
    }
  }
}

/** Иглы в полёте: серебряная нитка хвостом, блик острия — поверх темноты. */
function needleTrails(g: CanvasRenderingContext2D, to: To, time: number): void {
  const sim = paintSim();
  if (!sim) return;
  for (const s of sim.shots) {
    if (s.art !== 'f13_needle') continue;
    const [x, y] = to(s.x, s.y);
    const v = Math.hypot(s.vx, s.vy) || 1;
    const ux = s.vx / v;
    const uy = s.vy / v;
    const lift = needleLift(s);
    const hy = y - 6 - lift;
    // Хвост — золотая нитка, вьётся за иглой.
    g.strokeStyle = rgba(GOLD[2], 0.75);
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x - ux * 4, hy - uy * 4);
    for (let j = 1; j <= 6; j++) {
      const d = 4 + j * 3;
      const wv = Math.sin(time * 14 + j * 0.9 + s.id) * j * 0.18;
      g.lineTo(x - ux * d - uy * wv, hy - uy * d + ux * wv + Math.min(lift, j * 2) * 0.3);
    }
    g.stroke();
    twinkle(g, x + ux * 5, hy + uy * 5, 1.6, WHITE, 0.6 + 0.4 * Math.sin(time * 40 + s.id));
  }
}

/** Игла вылетает из руки (над полом) и за 0,25 с опускается к полу. */
function needleLift(s: Shot): number {
  return 26 * (1 - easeOut(s.age / 0.25));
}

// ---------------------------------------------------------------------------
// Зоны-режиссёры.
// ---------------------------------------------------------------------------

registerZonePainter('f13_strings', (g, z, px, py, S, time) => {
  const to = viewOf(z, px, py, S);
  // Столбы света софитов — сложением, с пылью в луче.
  lighter(g, () => {
    for (const s of F13_FX.spots) {
      if (!s.on || Math.abs(s.x - z.x) > 18 || Math.abs(s.y - z.y) > 14) continue;
      const [lx, ly] = to(s.lx, s.ly);
      const [x, y] = to(s.x, s.y);
      const R = SPOT.r * 16;
      beam(g, lx, ly - 13, x, y, R, WARM, 0.13, time, s.lx * 7 + s.ly);
      // Пятно — поверх темноты: «где луч — там тебя видят», край чёткий.
      pool(g, x, y, R, WARM, 0.16 + 0.03 * Math.sin(time * 3 + s.x), s.turned ? 0.5 : 0.32);
    }
  });
  const act = F13_FX.act;
  if (act === 2) {
    cottonClouds(g, to, time);
    if (F13_FX.moon.r > 0) moon(g, to, time);
  }
  if (act === 1) for (const w of F13_FX.waves) waveCrest(g, to, w, time);
  if (act === 2) drawStars(g, to, time);
  drawStrings(g, to, z.x, z.y, time);
  lordFlies(g, to, time);
  bossMarks(g, 'above', to, time);
  needleTrails(g, to, time);
  return true;
});

registerZonePainter('f13_stage', (g, z, px, py, S, time) => {
  const to = viewOf(z, px, py, S);
  for (const s of F13_FX.spots) {
    if (!s.on || Math.abs(s.x - z.x) > 18 || Math.abs(s.y - z.y) > 14) continue;
    const [x, y] = to(s.x, s.y);
    pool(g, x, y, SPOT.r * 16, WARM, 0.22);
  }
  const act = F13_FX.act;
  if (act === 2) {
    moonPool(g, to, time);
    starFloor(g, to, time);
  }
  if (act === 1) for (const w of F13_FX.waves) waveFloor(g, to, w, time);
  stringShadows(g, to, z.x, z.y);
  bossMarks(g, 'floor', to, time);
  return true;
});

// ---------------------------------------------------------------------------
// Короткие зоны-картинки.
// ---------------------------------------------------------------------------

/** Ближайшая кукла на нитях у точки — чья нить лопнула. */
function puppetAt(x: number, y: number): Mob | null {
  let best: Mob | null = null;
  let bd = 2.5;
  for (const m of F13_FX.mobs) {
    if ((m.data.sn ?? 0) <= 0) continue;
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < bd) [best, bd] = [m, d];
  }
  return best;
}

// Лопнувшая нить: верх хлещет к ваге, низ падает на пол, обрывки волокон
// летят по баллистике и ложатся; искра в точке разреза.
registerZonePainter('f13_snap', (g, z, px, py, S, time) => {
  const t = z.t;
  const to = viewOf(z, px, py, S);
  const m = puppetAt(z.x, z.y);
  const sh = m ? shoulderH(m, time) : 18;
  const giant = m?.kind === 'f13_giant';
  const star = F13_FX.stars.some(
    (s) => Math.abs(s.px - zf(z, 'bx')) < 0.3 && Math.abs(s.py - zf(z, 'by')) < 0.3,
  );
  // Низ нити (плечо) и верх (вага, крестовина или балка звезды).
  const [lx, lyF] = [px, py];
  const ly = star ? lyF - 14 : lyF - sh + (giant ? 0 : 0.18 * 16);
  const [bx, byF] = to(zf(z, 'bx'), zf(z, 'by'));
  let tx = bx;
  let ty = star ? byF - 60 : byF - 18;
  if (giant) {
    const v = vagaScreen(to, time);
    if (v) [tx, ty] = [v[0], v[1] + 2];
  }
  // Где разрезали — середина нити.
  const cx = (tx + lx) / 2;
  const cy = (ty + ly) / 2;
  const L = Math.hypot(tx - cx, ty - cy);
  // Верхняя половина: хлыст к ваге с перелётом и закруткой.
  const up = easeOut(t / 0.22);
  const curl = Math.sin(t * 22) * Math.exp(-t * 6) * 8;
  const ux = lerp(cx, tx, up * 0.75);
  const uy = lerp(cy, ty, up * 0.75) - Math.max(0, Math.sin(t * 9)) * 4 * Math.exp(-t * 4);
  g.strokeStyle = rgba(GOLD[3], 1 - k01(t / 0.9) * 0.5);
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(tx, ty);
  g.quadraticCurveTo((tx + ux) / 2 + curl, (ty + uy) / 2 + L * 0.15, ux, uy);
  g.stroke();
  // Нижняя половина: падает и хлещет по полу.
  const dn = easeIn(t / 0.3);
  const floor = lyF + 2;
  const dx = lerp(cx, lx + 8 * Math.sign(cx - lx || 1), dn);
  const dy = lerp(cy, floor, dn);
  g.beginPath();
  g.moveTo(lx, ly);
  g.quadraticCurveTo((lx + dx) / 2 - curl * 0.6, Math.max(ly, dy) + 3 * dn, dx, dy);
  g.stroke();
  // Звёздочка разреза и искры.
  const flash = 1 - k01(t / 0.18);
  if (flash > 0) {
    lighter(g, () => glow(g, cx, cy, 9, WARM, 0.6 * flash));
    twinkle(g, cx, cy, 5 * flash + 1, WHITE, flash);
  }
  sparks(g, cx, cy, t, 7, z.id, 70, [GOLD[3], WHITE, GOLD[2]], 0.4, -Math.PI / 2, Math.PI, floor);
  // Обрывки волокон: кувыркаются, падают и ложатся на пол.
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (hash(z.id, i, 5) - 0.5) * 2.4;
    const v = 30 + 40 * hash(z.id, i, 6);
    const [fx, fy, landed] = fly(cx, cy, Math.cos(a) * v, Math.sin(a) * v, t, 220, floor, 3.5);
    const rot = landed ? hash(z.id, i, 7) * 3 : t * (8 + 6 * hash(z.id, i, 8));
    const len = 2.5 + 1.5 * hash(z.id, i, 9);
    const al = 1 - k01((t - 0.5) / 0.4);
    g.strokeStyle = rgba(GOLD[2], al);
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(fx - Math.cos(rot) * len, fy - Math.sin(rot) * len * (landed ? 0.3 : 1));
    g.lineTo(fx + Math.cos(rot) * len, fy + Math.sin(rot) * len * (landed ? 0.3 : 1));
    g.stroke();
  }
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

// Рыцарь снова на нитях: спускается с колосников в такт движку (`drop`
// у моба: высота −(1−k²)·40 за 0,55 с), нити натягиваются при касании.
registerZonePainter('f13_retie', (g, z, px, py, _S, time) => {
  const t = z.t;
  const k = k01(t / 0.55);
  const up = (1 - k * k) * 40;
  const sh = py - 18 - up;
  const top = Math.min(sh - 50, py - 90);
  const land = t - 0.55;
  const lit = land > 0 ? Math.exp(-land * 6) : 0.3;
  for (const s of [-1, 1])
    thread(g, px + s * 4, top, px + s * 3, sh, {
      a: 0.9 * (1 - k01((t - 0.65) / 0.15)),
      w: 0.7,
      sag: land > 0 ? 0.05 : 0.5,
      buzz: land > 0 ? 2 * Math.exp(-land * 10) : 0,
      lit,
      seed: s + z.id,
      time,
      fade: true,
    });
  if (land > 0 && land < 0.25) {
    // Касание пола: пыль кольцом.
    const u = land / 0.25;
    g.strokeStyle = rgba(P.cream[2], 0.5 * (1 - u));
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px, py, 4 + 9 * u, 1.5 + 3 * u, 0, 0, TAU);
    g.stroke();
    twinkle(g, px + 3, sh, 3 * (1 - u), WHITE, 1 - u);
  }
  return true;
});

// ---- занавес ------------------------------------------------------------------
//
// Тяжёлый бархат: складки (тон по «выпуклости» складки), низ фестонами,
// золотой галун, бахрома и кисти, которые качаются после удара о пол и
// после каждого рывка подъёма; ламбрекен сверху. Падает с ускорением,
// бьётся о сцену и отскакивает; поднимается рывками на тросах — между
// тросами низ провисает фестонами.

interface Drape {
  /** Доля опускания: 0 поднят, 1 до пола. */
  drop: number;
  /** Последний толчок (удар о пол, рывок троса) — время зоны, сила. */
  kickT: number;
  kick: number;
  /** Подъём на тросах — фестоны 0…1. */
  lift: number;
  /** Пыль у кромки при ударе о пол. */
  dustT: number;
}

/** Падение: свободно 0,62 с, удар, два отскока. */
function fallDrape(t: number, d: Drape): void {
  const T0 = 0.62;
  if (t < T0) {
    d.drop = easeIn(t / T0);
    return;
  }
  const u = t - T0;
  d.drop = 1 - 0.05 * Math.exp(-u * 5) * Math.abs(Math.sin(u * 11));
  d.kickT = T0;
  d.kick = 1;
  d.dustT = u;
}

/** Подъём рывками: `n` рывков за отрезок [t0, t1]. */
function riseDrape(t: number, t0: number, t1: number, n: number, d: Drape): void {
  const p = k01((t - t0) / (t1 - t0));
  const i = Math.min(n - 1, Math.floor(p * n));
  const q = p * n - i;
  // Рывок — быстрый подхват за 40% доли, потом провис назад на 1,5%.
  const pull = easeOut(q / 0.4);
  const sag = q > 0.4 ? 0.015 * Math.sin(((q - 0.4) / 0.6) * Math.PI) : 0;
  d.drop = 1 - (i + pull) / n + sag;
  d.kickT = t0 + (i / n) * (t1 - t0);
  d.kick = 0.6;
  d.lift = Math.min(1, p * 3) * (1 - k01((p - 0.85) / 0.15));
}

function drape(
  g: CanvasRenderingContext2D,
  z: Zone | Strike,
  px: number,
  py: number,
  S: number,
  d: Drape,
  zt: number,
  time: number,
): void {
  if (d.drop <= 0.002) return;
  const to = viewOf(z, px, py, S);
  const [vw, vh] = viewSize(g);
  const [ax0, top] = to(ARENA_X0, 0);
  const [ax1, bottom] = to(ARENA_X1, 24);
  const yb = top + (bottom - top) * d.drop;
  if (yb < -4 || top > vh) return;
  const x0 = Math.max(ax0, -4);
  const x1 = Math.min(ax1, vw + 4);
  const age = zt - d.kickT;
  // Волна по ткани после толчка — бежит от середины к краям.
  const kick = age >= 0 ? d.kick * Math.exp(-age * 2.5) : 0;
  const [cx] = to((ARENA_X0 + ARENA_X1) / 2, 0);
  const cords = 6;
  const span = (ax1 - ax0) / cords;
  const hem = (x: number) => {
    let o = 0;
    if (d.lift > 0) {
      const u = ((((x - ax0) / span) % 1) + 1) % 1;
      o -= d.lift * 7 * (1 - Math.sin(u * Math.PI));
    }
    return o;
  };
  const fold = (x: number) => {
    const wx = x - ax0;
    const ripple = kick * Math.sin(Math.abs(x - cx) * 0.05 - age * 9) * 0.8;
    return (
      Math.sin(wx * 0.21 + Math.sin(time * 0.6) * 0.25 + ripple) + 0.42 * Math.sin(wx * 0.53 + 1.3)
    );
  };
  const V = P.velvet;
  for (let x = Math.floor(x0 / 2) * 2; x < x1; x += 2) {
    const f = fold(x);
    const c = f > 0.95 ? V[3] : f > 0.25 ? V[2] : f > -0.55 ? V[1] : V[0];
    const yh = yb + hem(x) + (f > 0.25 ? 1.5 : 0);
    g.fillStyle = rgba(c, 1);
    g.fillRect(x, top, 2.2, yh - top);
    // Галун над низом и бахрома.
    g.fillStyle = rgba(f > 0.25 ? GOLD[3] : GOLD[2], 1);
    g.fillRect(x, yh - 5, 2.2, 1.5);
    g.fillStyle = rgba(GOLD[1], 1);
    g.fillRect(x, yh - 3.5, 2.2, 1);
    const sw = Math.sin(time * 3 + x * 0.3) * 0.4 + kick * Math.sin(age * 14 + x * 0.2) * 1.5;
    g.fillStyle = rgba(GOLD[(x >> 1) % 2 ? 2 : 1], 1);
    g.fillRect(x + sw * 0.5, yh - 1, 1, 3 + ((x >> 1) % 3));
  }
  // Тень под ламбрекеном и тёплый свет рампы на низ полотна.
  const sh = g.createLinearGradient(0, top, 0, top + 40);
  sh.addColorStop(0, 'rgba(8,2,6,0.55)');
  sh.addColorStop(1, 'rgba(8,2,6,0)');
  g.fillStyle = sh;
  g.fillRect(x0, top, x1 - x0, Math.min(40, yb - top));
  const ramp = g.createLinearGradient(0, yb - 46, 0, yb);
  ramp.addColorStop(0, 'rgba(255,200,120,0)');
  ramp.addColorStop(1, 'rgba(255,190,110,0.22)');
  g.fillStyle = ramp;
  g.fillRect(x0, Math.max(top, yb - 46), x1 - x0, Math.min(46, yb - top));
  // Шов посередине: полотнища заходят друг на друга.
  if (cx > x0 && cx < x1) {
    g.fillStyle = rgba(INK, 0.55);
    g.fillRect(cx - 0.5, top, 1.5, yb - top);
    g.fillStyle = rgba(V[3], 0.6);
    g.fillRect(cx + 1, top, 1, yb - top);
  }
  // Тросы подъёма: золотые шнуры с кольцами, низ подтянут к ним.
  if (d.lift > 0) {
    for (let i = 1; i < cords; i++) {
      const x = ax0 + i * span;
      if (x < -2 || x > vw + 2) continue;
      g.fillStyle = rgba(GOLD[2], 0.9 * d.lift);
      g.fillRect(x - 0.4, top, 0.8, yb - top - 4);
      for (let y = top + 10 + ((time * 40) % 10); y < yb - 6; y += 10) {
        g.fillStyle = rgba(GOLD[3], 0.9 * d.lift);
        g.fillRect(x - 1, y, 2, 1);
      }
    }
  }
  // Кисти вдоль низа: висят на шнуре, качаются после толчка.
  for (let i = 0; i < cords; i++) {
    const x = ax0 + (i + 0.5) * span;
    if (x < -8 || x > vw + 8) continue;
    const yh = yb + hem(x) + 1;
    const th = 0.08 * Math.sin(time * 1.8 + i) + kick * 0.6 * Math.sin(age * 8 + i * 0.7);
    const L = 9;
    const ex = x + Math.sin(th) * L;
    const ey = yh + Math.cos(th) * L;
    g.strokeStyle = rgba(GOLD[1], 1);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, yh - 2);
    g.lineTo(ex, ey);
    g.stroke();
    g.fillStyle = rgba(INK, 0.8);
    g.beginPath();
    g.ellipse(ex, ey + 1, 2.6, 2.4, 0, 0, TAU);
    g.fill();
    g.fillStyle = rgba(GOLD[2], 1);
    g.beginPath();
    g.ellipse(ex, ey + 1, 2, 1.8, 0, 0, TAU);
    g.fill();
    g.fillStyle = rgba(GOLD[3], 1);
    g.fillRect(ex - 1, ey, 1, 1);
    // Юбка кисти: нитки, отстают от качания.
    for (let j = -2; j <= 2; j++) {
      g.fillStyle = rgba(GOLD[j % 2 ? 1 : 2], 1);
      g.fillRect(ex + j * 0.9 - Math.sin(th) * 2, ey + 3, 0.8, 4 + (j & 1));
    }
  }
  // Ламбрекен: фестоны с галуном и короткими кистями между ними.
  if (top > -30) {
    const sw = 32;
    for (let x = Math.floor((x0 - ax0) / sw) * sw + ax0; x < x1; x += sw) {
      g.fillStyle = rgba(V[0], 1);
      g.beginPath();
      g.moveTo(x, top);
      g.quadraticCurveTo(x + sw / 2, top + 30, x + sw, top);
      g.fill();
      g.fillStyle = rgba(V[2], 1);
      g.beginPath();
      g.moveTo(x + 2, top);
      g.quadraticCurveTo(x + sw / 2, top + 24, x + sw - 2, top);
      g.fill();
      g.strokeStyle = rgba(GOLD[2], 1);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, top + 1);
      g.quadraticCurveTo(x + sw / 2, top + 30, x + sw, top + 1);
      g.stroke();
      g.fillStyle = rgba(GOLD[3], 1);
      g.fillRect(x - 1, top + 2, 2, 6);
    }
    g.fillStyle = rgba(GOLD[2], 1);
    g.fillRect(x0, top, x1 - x0, 3);
    g.fillStyle = rgba(GOLD[3], 1);
    g.fillRect(x0, top, x1 - x0, 1);
  }
  // Пыль сцены от удара полотна о пол.
  if (d.dustT > 0 && d.dustT < 0.8) {
    const u = d.dustT / 0.8;
    for (let i = 0; i < 14; i++) {
      const x = x0 + hash(i, 3, z.id) * (x1 - x0);
      const y = yb + 2 - u * (6 + 10 * hash(i, 4, z.id)) + (x % 3);
      g.fillStyle = rgba(P.cream[2], 0.5 * (1 - u));
      g.fillRect(x + (hash(i, 5) - 0.5) * 14 * u, y, 2, 1.5);
    }
  }
}

// Между актами: падает (0,62 с) и бьётся о сцену, держится, пока меняют
// декорацию, и уходит вверх четырьмя рывками (весь переход — `BOSS.trans`).
registerZonePainter('f13_curtainfall', (g, z, px, py, S, time) => {
  const t = z.t;
  const T = BOSS.trans;
  const d: Drape = { drop: 0, kickT: -9, kick: 0, lift: 0, dustT: -1 };
  const up = BOSS.swap + 0.3;
  if (t < up) fallDrape(t, d);
  else riseDrape(t, up, T - 0.05, 4, d);
  drape(g, z, px, py, S, d, t, time);
  return true;
});

// Начало боя: занавес стоит, потом уходит вверх рывками.
registerZonePainter('f13_curtainrise', (g, z, px, py, S, time) => {
  const t = z.t;
  const d: Drape = { drop: 1, kickT: -9, kick: 0, lift: 0, dustT: -1 };
  if (t >= 0.3) riseDrape(t, 0.3, 1.9, 4, d);
  drape(g, z, px, py, S, d, t, time);
  return true;
});

/** Роза: цветок, стебель, листик. */
function rose(g: CanvasRenderingContext2D, x: number, y: number, rot: number, a: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.strokeStyle = rgba(P.green[2], a);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(7, 0);
  g.stroke();
  g.fillStyle = rgba(P.green[3], a);
  g.fillRect(3, -2, 2, 1.5);
  g.fillStyle = rgba(INK, a * 0.8);
  g.beginPath();
  g.arc(-1, 0, 2.8, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.red[2], a);
  g.beginPath();
  g.arc(-1, 0, 2.2, 0, TAU);
  g.fill();
  g.fillStyle = rgba(P.red[3], a);
  g.fillRect(-2, -1, 1.5, 1.5);
  g.restore();
}

// Смерть Кукловода: из зала летят розы (дугой, ложатся у его ног), потом
// занавес падает и бьётся о сцену, в конце — короткий рывок вверх.
registerZonePainter('f13_bow', (g, z, px, py, S, time) => {
  const t = z.t;
  const [, vh] = viewSize(g);
  for (let i = 0; i < 18; i++) {
    const t0 = 1.2 + hash(i, 7, 1) * 2.8;
    const u = (t - t0) / 0.75;
    if (u <= 0) continue;
    // Цель — у ног поклонившегося, старт — из зала (за нижним краем кадра).
    const tx = px + (hash(i, 1, 2) - 0.5) * 70;
    const ty = py + 6 + (hash(i, 2, 3) - 0.3) * 22;
    const sx = tx + (hash(i, 3, 4) - 0.5) * 60;
    const sy = Math.max(vh + 10, ty + 60);
    if (u < 1) {
      const x = lerp(sx, tx, u);
      const y = lerp(sy, ty, u) - Math.sin(u * Math.PI) * 50;
      rose(g, x, y, u * 9 + i, 1);
      continue;
    }
    // Легла: отскок и покой; лепестки рядом.
    const b = u - 1;
    const hop = b < 0.5 ? Math.abs(Math.sin(b * TAU)) * 3 * (1 - b * 2) : 0;
    rose(g, tx, ty - hop, i * 1.7, 1);
    if (b < 0.4) twinkle(g, tx, ty - 3, 2, P.pink[3], 1 - b / 0.4);
  }
  const d: Drape = { drop: 0, kickT: -9, kick: 0, lift: 0, dustT: -1 };
  if (t >= 4.4 && t < 6.1) fallDrape(t - 4.4, d);
  else if (t >= 6.1) riseDrape(t, 6.1, 6.5, 2, d);
  if (t >= 4.4 && d.kickT > -9) d.kickT += 4.4;
  const cz = { ...z, x: zf(z, 'cx'), y: zf(z, 'cy') } as Zone;
  const to = viewOf(z, px, py, S);
  const [cx, cy] = to(cz.x, cz.y);
  drape(g, cz, cx, cy, S, d, t, time);
  return true;
});

// ---- контакты и следы ---------------------------------------------------------

/** Щепа: продолговатые обломки летят по баллистике и ложатся. */
function splinters(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  floor: number,
  t: number,
  n: number,
  seed: number,
  dir: number,
  spread: number,
  speed: number,
  cols: RGBA[],
): void {
  for (let i = 0; i < n; i++) {
    const a = dir + (hash(seed, i, 11) - 0.5) * spread * 2;
    const v = speed * (0.5 + 0.7 * hash(seed, i, 12));
    const [fx, fy, landed] = fly(x, y, Math.cos(a) * v, Math.sin(a) * v - 40, t, 260, floor, 2.5);
    const rot = landed ? hash(seed, i, 13) * 3 : t * (10 + 8 * hash(seed, i, 14)) + i;
    const L = 1.5 + hash(seed, i, 15) * 1.5;
    const al = 1 - k01((t - 0.35) / 0.25);
    if (al <= 0) continue;
    g.strokeStyle = rgba(cols[i % cols.length], al);
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(fx - Math.cos(rot) * L, fy - Math.sin(rot) * L * (landed ? 0.3 : 1));
    g.lineTo(fx + Math.cos(rot) * L, fy + Math.sin(rot) * L * (landed ? 0.3 : 1));
    g.stroke();
  }
}

/** Звезда удара: лучи и белый центр, сложением. */
function hitStar(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  k: number,
  R: number,
  col: RGBA,
): void {
  if (k >= 1) return;
  const a = 1 - k;
  lighter(g, () => glow(g, x, y, R * 1.6, col, 0.5 * a));
  g.fillStyle = rgba(WHITE, a);
  const r = R * (0.6 + 0.6 * easeOut(k * 2));
  for (let i = 0; i < 4; i++) {
    const an = (i * Math.PI) / 2 + 0.4;
    g.beginPath();
    g.moveTo(x + Math.cos(an) * r, y + Math.sin(an) * r);
    g.lineTo(x + Math.cos(an + 1.45) * 1.4, y + Math.sin(an + 1.45) * 1.4);
    g.lineTo(x + Math.cos(an - 1.45) * 1.4, y + Math.sin(an - 1.45) * 1.4);
    g.closePath();
    g.fill();
  }
}

// Копьё исполина достало: прочерк по древку, звезда на острие, щепа.
registerZonePainter('f13_lancehit', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  const a = zf(z, 'ang');
  const L = zf(z, 'len') * 16;
  const h = 14;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Прочерк: яркая полоса от древка к острию, быстро гаснет с хвоста.
  const tail = easeOut(k01(t / 0.25));
  const x0 = px - ca * L * (1 - tail);
  const y0 = py - h - sa * L * (1 - tail);
  lighter(g, () => {
    g.strokeStyle = rgba(WARM, 0.45 * (1 - k));
    g.lineWidth = 6 * (1 - k) + 1;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(px, py - h);
    g.stroke();
  });
  g.strokeStyle = rgba(P.cream[3], 0.9 * (1 - k));
  g.lineWidth = 2.2 * (1 - k) + 0.4;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(px, py - h);
  g.stroke();
  // Кольца скорости вдоль древка.
  for (let i = 1; i <= 3; i++) {
    const u = 1 - i * 0.22 - k * 0.3;
    if (u <= 0) continue;
    const cx = px - ca * L * (1 - u);
    const cy = py - h - sa * L * (1 - u);
    g.strokeStyle = rgba(P.cream[3], 0.5 * (1 - k));
    g.lineWidth = 0.8;
    g.beginPath();
    g.ellipse(cx, cy, 2 + 3 * k, 4 + 4 * k, a, 0, TAU);
    g.stroke();
  }
  hitStar(g, px, py - h, k01(t / 0.3), 10, WARM);
  // Ударная дуга на полу перед остриём.
  g.strokeStyle = rgba(P.cream[2], 0.6 * (1 - k));
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, 4 + 10 * easeOut(k), 2 + 5 * easeOut(k), 0, a - 1.1, a + 1.1);
  g.stroke();
  splinters(g, px, py - h, py + 3, t, 8, z.id, a, 0.9, 70, [P.wood[3], P.cream[2], P.wood[2]]);
  return true;
});

/** Петля аркана вокруг точки: эллипс с узлом. */
function loop(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  a: number,
  f: number,
): void {
  g.strokeStyle = rgba(INK, a * 0.5);
  g.lineWidth = 2.2;
  g.beginPath();
  g.ellipse(x, y, rx, rx * 0.45, 0, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(mixc(GOLD[2], WHITE, f), a);
  g.lineWidth = 1;
  g.stroke();
  g.fillStyle = rgba(GOLD[3], a);
  g.fillRect(x + rx - 1, y - 1, 2, 2);
}

/** Рука Кукловода на экране (или точка зоны, если его уже нет). */
function lordHand(
  to: To,
  z: Zone | Strike,
  px: number,
  py: number,
  time: number,
): [number, number] {
  const lord = F13_FX.mobs.find((q) => q.kind === 'f13boss');
  if (!lord) return [px, py - 24];
  const [x, y] = to(lord.x, lord.y);
  const [dx, dy] = lordVagaPx(lord, time);
  return [x + dx, y + dy];
}

// Аркан поймал: петля долетает за 0,08 с, затягивается на поясе героя,
// верёвка в струну тянет его к Кукловоду; потом провисает и уходит.
registerZonePainter('f13_snareline', (g, z, px, py, S, time) => {
  const t = z.t;
  const to = viewOf(z, px, py, S);
  const sim = paintSim();
  const [hx0, hy0] = sim ? to(sim.hero.x, sim.hero.y) : to(zf(z, 'tx'), zf(z, 'ty'));
  const [hx1, hy1] = lordHand(to, z, px, py, time);
  const fly0 = easeOut(t / 0.08);
  const lx = lerp(hx1, hx0, fly0);
  const ly = lerp(hy1, hy0 - 8, fly0);
  const pull = t > 0.08 && t < 0.4;
  const slack = k01((t - 0.4) / 0.2);
  const fade = 1 - k01((t - 0.45) / 0.15);
  thread(g, hx1, hy1, lx, ly, {
    a: fade,
    w: 1,
    sag: pull ? 0.02 : 0.2 + slack * 1.4,
    buzz: pull ? 1.2 : 0,
    lit: pull ? 1 : 0.4,
    seed: z.id,
    time,
    col: GOLD[2],
  });
  const rx = t < 0.08 ? 8 : lerp(8, 4.5, easeOut((t - 0.08) / 0.1));
  loop(g, lx, ly, rx, fade, pull ? 1 : 0);
  if (t > 0.08 && t < 0.25) twinkle(g, lx + rx, ly, 3, WHITE, 1 - (t - 0.08) / 0.17);
  return true;
});

// Аркан мимо: петля падает на пол в конце метки, её дёргают назад к руке.
registerZonePainter('f13_v_snarethrow', (g, z, px, py, S, time) => {
  const sim = paintSim();
  if (sim?.zones.some((q) => q.art === 'f13_snareline' && Math.abs(q.t - z.t) < 0.05)) return true;
  const t = z.t;
  const to = viewOf(z, px, py, S);
  const a = zf(z, 'ang');
  const L = zf(z, 'len') * 16;
  const ex = px + Math.cos(a) * L;
  const ey = py + Math.sin(a) * L;
  const [hx1, hy1] = lordHand(to, z, px, py, time);
  // 0…0,1 — долетает и шлёпается, 0,2…0,6 — волочится назад.
  const back = easeIn((t - 0.2) / 0.4);
  const lx = lerp(ex, hx1, back);
  const ly = lerp(ey, hy1, back) - (t < 0.1 ? Math.sin((t / 0.1) * Math.PI) * 6 : 0);
  const fade = 1 - k01((t - 0.5) / 0.1);
  thread(g, hx1, hy1, lx, ly, { a: fade, w: 0.9, sag: 1.2 - back, seed: z.id, time });
  loop(g, lx, ly, 6 - 2 * back, fade, 0);
  if (t > 0.08 && t < 0.3) {
    const u = (t - 0.08) / 0.22;
    g.fillStyle = rgba(P.cream[2], 0.6 * (1 - u));
    for (let i = 0; i < 5; i++)
      g.fillRect(ex + (hash(z.id, i) - 0.5) * 14 * u, ey - u * 4 * hash(i, z.id), 1.5, 1);
  }
  return true;
});

// Волна накрыла: корона брызг из лоскутов ткани и пены, круг на полу.
registerZonePainter('f13_splash', (g, z, px, py, _S, time) => {
  const t = z.t;
  const k = life(z);
  g.strokeStyle = rgba(P.sea[3], 0.7 * (1 - k));
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(px, py, 5 + 16 * easeOut(k), 2.5 + 7 * easeOut(k), 0, 0, TAU);
  g.stroke();
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI / 2 + (hash(z.id, i, 21) - 0.5) * 2.6;
    const v = 50 + 60 * hash(z.id, i, 22);
    const [fx, fy, landed] = fly(
      px,
      py - 4,
      Math.cos(a) * v * 0.7,
      Math.sin(a) * v,
      t,
      300,
      py + 4,
      2,
    );
    const al = 1 - k01((t - 0.3) / 0.3);
    if (al <= 0) continue;
    const c = i % 3 === 0 ? WHITE : i % 3 === 1 ? P.sea[3] : P.sea[2];
    g.fillStyle = rgba(c, al);
    if (i % 3 === 2 && !landed) {
      // Лоскут ткани: кувыркается.
      const r = time * 12 + i;
      g.fillRect(fx - 1.5 * Math.abs(Math.cos(r)), fy - 1, 3 * Math.abs(Math.cos(r)) + 0.5, 2);
    } else g.fillRect(fx - 1, fy - 1, landed ? 2 : 1.5, landed ? 1 : 1.5);
  }
  return true;
});

// Срезанная звезда падает, бьётся о сцену и подпрыгивает; искры.
registerZonePainter('f13_starfall', (g, z, px, py) => {
  const t = z.t;
  const T0 = 0.45;
  let y: number;
  let rot: number;
  if (t < T0) {
    y = py - 14 - 46 * (1 - easeIn(t / T0));
    rot = t * 14;
  } else {
    const u = t - T0;
    y = py - 2 - Math.abs(Math.sin(u * 8)) * 8 * Math.exp(-u * 6);
    rot = T0 * 14 + 0.6 * (1 - Math.exp(-u * 6));
  }
  const fade = 1 - k01((t - 0.9) / 0.3);
  star(g, px, y, 8, rot, rgba(GOLD[2], fade), rgba(INK, 0.8 * fade));
  if (t >= T0) {
    const u = t - T0;
    sparks(g, px, py - 2, u, 10, z.id, 80, [GOLD[3], WHITE], 0.5, -Math.PI / 2, 1.3, py + 3);
    if (u < 0.3) {
      g.strokeStyle = rgba(P.cream[2], 0.6 * (1 - u / 0.3));
      g.lineWidth = 1;
      g.beginPath();
      g.ellipse(px, py, 4 + 12 * (u / 0.3), 1.5 + 4 * (u / 0.3), 0, 0, TAU);
      g.stroke();
    }
  }
  return true;
});

// ---- контакты без своего удара (зоны `api.vfx` в строках урона мозга) --------

// Пыль и опилки из-под ноги исполина.
registerZonePainter('f13_v_dust', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  const a = zf(z, 'ang');
  // Клубы пыли сцены — мягкие, расползаются и оседают.
  for (let i = 0; i < 4; i++) {
    const da = a + Math.PI + (i - 1.5) * 0.9;
    const r = 2 + 7 * easeOut(k) * (0.7 + 0.5 * hash(i, z.id >>> 0, 5));
    const s = 2.5 + 3 * easeOut(k);
    g.fillStyle = rgba(P.cream[1], 0.32 * (1 - k));
    g.beginPath();
    g.ellipse(px + Math.cos(da) * r, py + Math.sin(da) * r * 0.5 - 2 * k, s, s * 0.6, 0, 0, TAU);
    g.fill();
  }
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const da = a + (Math.PI / 2) * side + (hash(z.id >>> 0, i) - 0.5) * 0.8;
    const r = 3 + 10 * easeOut(k) * (0.6 + 0.6 * hash(i, z.id >>> 0, 2));
    const x = px + Math.cos(da) * r;
    const y = py + Math.sin(da) * r * 0.5 - 4 * Math.sin(Math.min(1, t * 3) * Math.PI) * hash(i, 3);
    g.fillStyle = rgba(i % 3 ? P.cream[1] : P.wood[3], 0.6 * (1 - k));
    g.fillRect(x, y, i % 3 ? 2 : 1.5, i % 3 ? 1.5 : 1);
  }
  g.strokeStyle = rgba(P.cream[1], 0.35 * (1 - k));
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, 5 + 6 * easeOut(k), 2 + 2 * easeOut(k), 0, 0, TAU);
  g.stroke();
  return true;
});

// Удар щитом: дуга ударной волны по сектору, пыль, щепа.
registerZonePainter('f13_v_bash', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  const a = zf(z, 'ang');
  const R = z.r * 16;
  const arc = BOSS.shield.arc;
  const r = R * easeOut(k01(t / 0.25));
  g.strokeStyle = rgba(P.cream[3], 0.8 * (1 - k));
  g.lineWidth = 2.5 * (1 - k) + 0.5;
  g.beginPath();
  g.ellipse(px, py, r, r * 0.85, 0, a - arc / 2, a + arc / 2);
  g.stroke();
  g.strokeStyle = rgba(GOLD[2], 0.5 * (1 - k));
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, r * 0.7, r * 0.6, 0, a - arc / 2.5, a + arc / 2.5);
  g.stroke();
  const fx0 = px + Math.cos(a) * 10;
  const fy0 = py + Math.sin(a) * 8;
  splinters(g, fx0, fy0 - 10, fy0 + 4, t, 7, z.id >>> 0, a, 0.8, 60, [P.cream[2], P.wood[3]]);
  return true;
});

// Таран исполина в героя: звезда, полосы скорости, щепа.
registerZonePainter('f13_v_ram', (g, z, px, py) => {
  const t = z.t;
  const a = zf(z, 'ang');
  const k = life(z);
  for (let i = -2; i <= 2; i++) {
    const o = i * 3;
    const L = 18 * (1 - k);
    const x0 = px - Math.cos(a) * 6 - Math.sin(a) * o;
    const y0 = py - 10 - Math.sin(a) * 6 + Math.cos(a) * o;
    g.strokeStyle = rgba(WHITE, 0.6 * (1 - k));
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0 - Math.cos(a) * L, y0 - Math.sin(a) * L);
    g.stroke();
  }
  hitStar(g, px, py - 10, k01(t / 0.3), 9, WARM);
  splinters(g, px, py - 10, py + 3, t, 7, z.id >>> 0, a, 1.2, 80, [P.wood[3], GOLD[2]]);
  return true;
});

// Исполин рухнул: облако опилок кольцом, доски подпрыгивают.
registerZonePainter('f13_v_slump', (g, z, px, py) => {
  const t = z.t;
  const k = life(z);
  const R = z.r * 16;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + hash(i, z.id >>> 0) * 0.4;
    const r = R * easeOut(k01(t / 0.6)) * (0.7 + 0.5 * hash(i, 2));
    const x = px + Math.cos(a) * r;
    const y = py + Math.sin(a) * r * 0.5 - 6 * easeOut(k) * hash(i, 3);
    const s = 3 + 3 * hash(i, 4);
    g.fillStyle = rgba(P.cream[1], 0.35 * (1 - k));
    g.beginPath();
    g.ellipse(x, y, s, s * 0.6, 0, 0, TAU);
    g.fill();
  }
  splinters(g, px, py - 6, py + 4, t, 10, z.id >>> 0, -Math.PI / 2, 1.5, 70, [
    P.wood[3],
    P.wood[2],
    GOLD[2],
  ]);
  return true;
});

// Срез Кукловода (конус): нить-лезвие проходит дугой от края к краю за
// 0,1 с, оставляет серп, по кромке — искры.
registerZonePainter('f13_v_cut', (g, z, px, py, _S, time) => {
  const t = z.t;
  const a = zf(z, 'ang');
  const R = z.r * 16;
  const arc = BOSS.cone.arc;
  const sw = easeOut(t / 0.1);
  const l = a - arc / 2;
  const cur = l + arc * sw;
  const fade = 1 - k01((t - 0.1) / 0.35);
  // Серп следа.
  g.fillStyle = rgba(WARM, 0.32 * fade);
  g.beginPath();
  g.arc(px, py - 8, R, l, cur);
  g.arc(px, py - 8, R * 0.62, cur, l, true);
  g.closePath();
  g.fill();
  g.strokeStyle = rgba(mixc(GOLD[3], WHITE, fade), fade);
  g.lineWidth = 1.4 * fade + 0.3;
  g.beginPath();
  g.arc(px, py - 8, R, l, cur);
  g.stroke();
  // Сама нить-лезвие (луч от руки) в миг взмаха.
  if (t < 0.16) {
    g.strokeStyle = rgba(WHITE, 1 - t / 0.16);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, py - 8);
    g.lineTo(px + Math.cos(cur) * R, py - 8 + Math.sin(cur) * R);
    g.stroke();
  }
  for (let i = 0; i < 5; i++) {
    const ai = l + (arc * (i + 0.5)) / 5;
    if (ai > cur) continue;
    sparks(
      g,
      px + Math.cos(ai) * R,
      py - 8 + Math.sin(ai) * R,
      t - (i * 0.1) / 5,
      2,
      (z.id >>> 0) + i,
      50,
      [GOLD[3], WHITE],
      0.3,
    );
  }
  void time;
  return true;
});

// Выпад Кукловода: нить-шпага выстреливает на всю длину за 0,08 с и
// возвращается, на острие — звезда.
registerZonePainter('f13_v_thrust', (g, z, px, py) => {
  const t = z.t;
  const a = zf(z, 'ang');
  const L = zf(z, 'len') * 16;
  const out = t < 0.08 ? easeOut(t / 0.08) : 1 - easeIn((t - 0.18) / 0.22);
  const ex = px + Math.cos(a) * L * out;
  const ey = py - 10 + Math.sin(a) * L * out;
  const fade = 1 - k01((t - 0.3) / 0.15);
  g.strokeStyle = rgba(WARM, 0.35 * fade);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(px, py - 10);
  g.lineTo(ex, ey);
  g.stroke();
  g.strokeStyle = rgba(WHITE, fade);
  g.lineWidth = 1;
  g.stroke();
  hitStar(g, px + Math.cos(a) * L, py - 10 + Math.sin(a) * L, k01((t - 0.06) / 0.3), 6, WARM);
  return true;
});

// Смерть Кукловода: его нити к колосникам лопаются — верх хлещет вверх,
// обрывки падают на него.
registerZonePainter('f13_v_lordsnap', (g, z, px, py, _S, time) => {
  const t = z.t;
  const lp = zf(z, 'lift') * 30;
  if (zf(z, 'lift') <= 0.01) return true;
  const pts: [number, number][] = [
    [px - 4, py - 26 - lp],
    [px + 4, py - 26 - lp],
    [px - 2, py - 37 - lp],
  ];
  pts.forEach(([ax, ay], i) => {
    const cy = ay - 22 - i * 4;
    const tt = t - i * 0.06;
    if (tt < 0) {
      thread(g, ax, ay - 80, ax, ay, {
        a: 0.85,
        w: 0.6,
        sag: 0.1,
        seed: i,
        time,
        fade: true,
        buzz: 2,
        lit: 1,
      });
      return;
    }
    const up = easeOut(tt / 0.3);
    g.strokeStyle = rgba(GOLD[2], 1 - k01(tt / 0.6));
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(ax, cy - 60 * up - 10);
    g.quadraticCurveTo(
      ax + Math.sin(tt * 20) * 6 * (1 - up),
      cy - 30 * up - 10,
      ax,
      cy - 10 - 40 * up,
    );
    g.stroke();
    // Нижний обрывок падает к полу.
    const [fx, fy] = fly(ax, cy, (i - 1) * 20, -10, tt, 260, py, 2);
    const al = 1 - k01((tt - 0.9) / 0.4);
    g.beginPath();
    g.moveTo(ax, Math.min(ay, fy));
    g.quadraticCurveTo((ax + fx) / 2 + Math.sin(tt * 9 + i) * 4, (ay + fy) / 2, fx, fy);
    g.strokeStyle = rgba(GOLD[2], al);
    g.stroke();
    if (tt < 0.2) {
      lighter(g, () => glow(g, ax, cy, 8, WARM, 0.6 * (1 - tt / 0.2)));
      twinkle(g, ax, cy, 4 * (1 - tt / 0.2) + 1, WHITE, 1 - tt / 0.2);
    }
    sparks(g, ax, cy, tt, 5, (z.id >>> 0) + i, 60, [GOLD[3], WHITE], 0.4);
  });
  return true;
});

// ---------------------------------------------------------------------------
// Удары по площади: метка до удара.
// ---------------------------------------------------------------------------

const TELE: RGBA = [255, 70, 50, 255];

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

// ---- удары Кукловода по площади: метки ---------------------------------------

/** Последние 0,2 с удара по площади: 0 — рано, 1 — удар. */
const lastS = (st: Strike) => k01(1 - (st.warn - st.t) / 0.2);

/** Гвоздик-кнопка, на которой держится нить сетки. */
function tack(g: CanvasRenderingContext2D, x: number, y: number, a: number, hot: number): void {
  if (hot > 0) lighter(g, () => glow(g, x, y, 5 + 3 * hot, WARM, 0.35 * hot));
  g.fillStyle = rgba(INK, a);
  g.fillRect(x - 2, y - 2, 4, 4);
  g.fillStyle = rgba(GOLD[2], a);
  g.fillRect(x - 1.5, y - 1.5, 3, 3);
  g.fillStyle = rgba(GOLD[3], a);
  g.fillRect(x - 1.5, y - 1.5, 1.5, 1.5);
}

// Сетка нитей: нить разматывается от края сцены (первая треть), лежит
// провисшей, к удару натягивается в струну и звенит. Ряды и столбцы — до
// проёма: проём (где встать) видно по гвоздикам на концах.
registerZonePainter('f13_gridline', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const f = lastS(st);
  const L = st.r * 16;
  const a = st.ang ?? 0;
  const w = (st.w ?? 0.35) * 16;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const unroll = easeOut(k / 0.35);
  const Lv = L * unroll;
  // Полоса на полу (поверх темноты, поэтому тихо): где нить бьёт.
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = rgba(WARM, 0.05 + 0.1 * k + 0.12 * f);
  g.fillRect(0, -w, Lv, w * 2);
  g.strokeStyle = rgba(GOLD[2], 0.25 + 0.35 * k);
  g.lineWidth = 0.6;
  g.setLineDash([2, 3]);
  g.lineDashOffset = -time * 12;
  g.beginPath();
  g.moveTo(0, -w);
  g.lineTo(Lv, -w);
  g.moveTo(0, w);
  g.lineTo(Lv, w);
  g.stroke();
  g.setLineDash([]);
  g.restore();
  // Сама нить — над полом на высоте пояса; провис уходит к удару.
  const h = 8;
  const ex = px + ca * Lv;
  const ey = py + sa * Lv - h;
  const tight = ease((k - 0.35) / 0.65);
  thread(g, px, py - h, ex, ey, {
    a: 0.75 + 0.25 * f,
    w: 0.8 + 0.4 * f,
    sag: 0.15 + 0.9 * (1 - tight),
    buzz: f * 1.4 + (k > 0.6 ? 0.3 : 0),
    lit: 0.3 + 0.7 * Math.max(tight * 0.5, f),
    seed: st.id,
    time,
  });
  // Катушка катится, пока нить разматывается.
  if (unroll < 1) {
    g.fillStyle = rgba(P.wood[2], 1);
    g.beginPath();
    g.arc(ex, ey, 2.5, 0, TAU);
    g.fill();
    g.fillStyle = rgba(GOLD[3], 1);
    g.fillRect(ex + Math.cos(time * 20) * 1.5 - 0.5, ey + Math.sin(time * 20) * 1.5 - 0.5, 1, 1);
  }
  tack(g, px, py - h, 1, f);
  if (unroll >= 1) tack(g, ex, ey, 1, Math.max(f, 0.3 * k));
  // Звон: короткие чёрточки дрожи вдоль нити в последние 0,2 с.
  if (f > 0) {
    const p = pulse(f);
    for (let i = 1; i < 6; i++) {
      const u = i / 6;
      const x = px + ca * Lv * u;
      const y = py + sa * Lv * u - h;
      g.fillStyle = rgba(WHITE, 0.5 * p);
      g.fillRect(x - sa * 3 - 0.5, y + ca * 3 - 0.5, 1, 1);
      g.fillRect(x + sa * 3 - 0.5, y - ca * 3 - 0.5, 1, 1);
    }
  }
  return true;
});

/** Фанерная молния: зигзаг, золото по краю. */
function boltShape(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  rot: number,
): void {
  const pts = [
    [-1, -6],
    [3, -6],
    [0.5, -1],
    [3.5, -1],
    [-2, 7],
    [-0.5, 1],
    [-3.5, 1],
  ];
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  pts.forEach(([px, py], i) => (i ? g.lineTo(px * s, py * s) : g.moveTo(px * s, py * s)));
  g.closePath();
  g.fillStyle = rgba(INK, 0.9);
  g.lineWidth = 2;
  g.strokeStyle = rgba(INK, 0.9);
  g.stroke();
  g.fillStyle = rgba(P.cream[3], 1);
  g.fill();
  g.lineWidth = 0.6;
  g.strokeStyle = rgba(GOLD[2], 1);
  g.stroke();
  g.restore();
}

// Молния «Бури»: с колосников на нити спускается фанерная молния и
// качается над целью; на полу — холодный круг с нарисованным зигзагом.
registerZonePainter('f13_bolt', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const f = lastS(st);
  const R = st.r * 16;
  const COLD: RGBA = [200, 220, 255, 255];
  g.fillStyle = rgba(COLD, 0.06 + 0.14 * k + 0.12 * f);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(mixc(COLD, WHITE, f), 0.4 + 0.4 * k + 0.2 * pulse(f));
  g.lineWidth = 0.9 + f;
  g.setLineDash([3, 2]);
  g.lineDashOffset = time * 14;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.stroke();
  g.setLineDash([]);
  // Сходящееся кольцо — «когда».
  const rr = R * (1 - easeIn(k)) + 2;
  g.strokeStyle = rgba(COLD, 0.6);
  g.lineWidth = 0.8;
  g.beginPath();
  g.ellipse(px, py, rr, rr * 0.9, 0, 0, TAU);
  g.stroke();
  // Молния на нити: спускается и качается.
  const sw = Math.sin(time * 4 + st.id) * 0.18 * (1 - f);
  const by = py - 44 - 40 * (1 - easeOut(k));
  const bx = px + Math.sin(sw) * 10;
  thread(g, px, by - 70, bx, by - 8, { a: 0.8, w: 0.6, sag: 0.05, seed: st.id, time, fade: true });
  lighter(g, () => glow(g, bx, by, 10 + 6 * f, COLD, 0.25 + 0.4 * f));
  boltShape(g, bx, by, 1.2, sw);
  if (f > 0) twinkle(g, bx, by - 2, 3 + 3 * pulse(f), WHITE, f);
  return true;
});

/** Меловой силуэт героя: голова, плечи, ноги. */
function chalkFigure(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  a: number,
  col: RGBA,
): void {
  g.strokeStyle = rgba(col, a);
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(x, y - 13, 2.6, 0, TAU);
  g.moveTo(x - 4, y - 9);
  g.lineTo(x + 4, y - 9);
  g.lineTo(x + 3, y - 3);
  g.lineTo(x - 3, y - 3);
  g.closePath();
  g.moveTo(x - 2, y - 3);
  g.lineTo(x - 2.5, y);
  g.moveTo(x + 2, y - 3);
  g.lineTo(x + 2.5, y);
  g.stroke();
}

// «По памяти» (акт III): мелом обводят место, где ты стоял секунду назад, —
// круг дорисовывается рукой, внутри проступает твой меловой силуэт.
registerZonePainter('f13_memory', (g, z, px, py, _S, time) => {
  const st = z as Strike;
  const k = warnK(st);
  const f = lastS(st);
  const R = st.r * 16;
  const COL: RGBA = [176, 196, 255, 255];
  g.fillStyle = rgba(COL, 0.06 + 0.14 * k + 0.1 * f);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, 0, TAU);
  g.fill();
  // Мел ведёт круг за 40% метки.
  const draw = easeOut(k / 0.4);
  g.strokeStyle = rgba(mixc(COL, WHITE, 0.5 + 0.5 * f), 0.7 + 0.3 * pulse(f));
  g.lineWidth = 1 + f;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.9, 0, -Math.PI / 2, -Math.PI / 2 + TAU * draw);
  g.stroke();
  if (draw < 1) {
    const ca = -Math.PI / 2 + TAU * draw;
    twinkle(g, px + Math.cos(ca) * R, py + Math.sin(ca) * R * 0.9, 2, WHITE, 1);
  }
  // Штриховка налива — от края к центру.
  const fill = R * (1 - easeIn(k));
  g.strokeStyle = rgba(COL, 0.25 + 0.2 * k);
  g.lineWidth = 0.6;
  g.beginPath();
  g.ellipse(px, py, fill, fill * 0.9, 0, 0, TAU);
  g.stroke();
  chalkFigure(g, px, py, 0.25 + 0.55 * k, mixc(COL, WHITE, f));
  void time;
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
  flash = 0,
  flashRgb?: string,
): void {
  registerImpactPainter(art, {
    life: life0,
    shake,
    above,
    flash,
    flashRgb,
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

// Нить сетки ударила: вспышка бежит от гвоздика к гвоздику, искры вдоль,
// нить лопается посередине и обрывки оседают. Восемь сразу — тряска мала.
impact(
  'f13_gridline',
  (g, r, px, py, k, time) => {
    const L = (r.r ?? 8) * 16;
    const a = r.ang ?? 0;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const h = 8;
    const t = k * 0.6;
    const run = easeOut(t / 0.12);
    lighter(g, () => {
      g.strokeStyle = rgba(WARM, 0.5 * (1 - k));
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(px, py - h);
      g.lineTo(px + ca * L * run, py + sa * L * run - h);
      g.stroke();
    });
    // Две половины: от гвоздиков, сворачиваются к ним.
    const back = easeOut(k01((t - 0.1) / 0.35));
    const half = L / 2;
    g.strokeStyle = rgba(GOLD[3], 1 - k);
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(px, py - h);
    g.lineTo(px + ca * half * (1 - back), py + sa * half * (1 - back) - h + back * 6);
    g.moveTo(px + ca * L, py + sa * L - h);
    g.lineTo(px + ca * (L - half * (1 - back)), py + sa * (L - half * (1 - back)) - h + back * 6);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      const u = (i + 0.5) / 4;
      sparks(
        g,
        px + ca * L * u,
        py + sa * L * u - h,
        t,
        3,
        r.seed + i,
        50,
        [GOLD[3], WHITE],
        0.35,
        -Math.PI / 2,
        1.4,
        py + sa * L * u + 2,
      );
    }
    void time;
  },
  0.6,
  0.08,
  true,
);

// Молния ударила: зигзаг с колосников в цель, холодная вспышка, копоть
// кругом, фанерная молния отскакивает и падает.
impact(
  'f13_bolt',
  (g, r, px, py, k, time) => {
    const t = k * 0.6;
    const COLD: RGBA = [200, 220, 255, 255];
    if (t < 0.2) {
      const a = 1 - t / 0.2;
      lighter(g, () => {
        g.strokeStyle = rgba(COLD, a * 0.6);
        g.lineWidth = 4;
        g.beginPath();
        let x = px + (hash(r.seed, 1) - 0.5) * 10;
        g.moveTo(x, py - 120);
        for (let i = 0; i < 7; i++) {
          x = px + (hash(r.seed, i + 2) - 0.5) * 14 * (1 - i / 6);
          g.lineTo(x, py - 120 + ((i + 1) * 120) / 7);
        }
        g.stroke();
        g.strokeStyle = rgba(WHITE, a);
        g.lineWidth = 1.2;
        g.stroke();
        glow(g, px, py, 26, COLD, 0.6 * a);
      });
    }
    const R = (r.r ?? 1.2) * 16;
    g.fillStyle = rgba(INK, 0.4 * (1 - k));
    g.beginPath();
    g.ellipse(px, py, R * 0.8, R * 0.7, 0, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(COLD, 0.7 * (1 - k));
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(px, py, R * (0.6 + 0.6 * easeOut(k)), R * (0.5 + 0.5 * easeOut(k)), 0, 0, TAU);
    g.stroke();
    sparks(
      g,
      px,
      py - 2,
      t,
      12,
      r.seed,
      90,
      [COLD, WHITE, GOLD[3]],
      0.5,
      -Math.PI / 2,
      1.5,
      py + 3,
    );
    // Фанерная молния падает плашмя и подпрыгивает.
    const [bx, by, landed] = fly(px + 2, py - 44, 30, -40, t, 420, py, 1.5);
    boltShape(g, bx, by - (landed ? 2 : 0), 1.2, landed ? 1.3 : t * 12);
    void time;
  },
  0.6,
  0.3,
  true,
  0.3,
  '200,220,255',
);

// «По памяти»: силуэт рассыпается меловой пылью, ударное кольцо.
impact(
  'f13_memory',
  (g, r, px, py, k) => {
    const COL: RGBA = [176, 196, 255, 255];
    const R = (r.r ?? 1.5) * 16;
    g.strokeStyle = rgba(WHITE, 0.8 * (1 - k));
    g.lineWidth = 1.5 * (1 - k) + 0.3;
    g.beginPath();
    g.ellipse(px, py, R * easeOut(k * 1.4), R * 0.9 * easeOut(k * 1.4), 0, 0, TAU);
    g.stroke();
    chalkFigure(g, px, py - 4 * k, 1 - k, COL);
    for (let i = 0; i < 14; i++) {
      const a = hash(r.seed, i, 31) * TAU;
      const d = (4 + 14 * hash(r.seed, i, 32)) * easeOut(k);
      g.fillStyle = rgba(i % 2 ? COL : WHITE, 0.9 * (1 - k));
      g.fillRect(px + Math.cos(a) * d, py - 8 + Math.sin(a) * d * 0.7 - 8 * k, 1.5, 1.5);
    }
  },
  0.55,
  0.2,
);

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

// Игла Кукловода: 16 поворотов, серебро с бликом, ушко с золотой ниткой.
// Вылетает из руки и за 0,25 с опускается к полу (`needleLift`); нитка
// хвостом — в режиссёре поверх темноты.
const dir16 = (s: Shot) => ((Math.round((Math.atan2(s.vy, s.vx) / TAU) * 16) % 16) + 16) % 16;
registerShotPainter('f13_needle', (s) => {
  const d = dir16(s);
  const base = shotSprite(`needle16_${d}`, 16, 16, (p) => {
    const a = (d / 16) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cx = 8;
    const cy = 8;
    p.line(cx - ca * 5, cy - sa * 5, cx + ca * 5, cy + sa * 5, P.silver[2]);
    p.line(cx - ca * 4 - sa * 0.6, cy - sa * 4 + ca * 0.6, cx + ca * 3, cy + sa * 3, P.silver[3]);
    p.set(cx + ca * 5, cy + sa * 5, hx('#ffffff'));
    p.set(cx + ca * 6, cy + sa * 6, hx('#ffffff'));
    p.set(cx - ca * 5, cy - sa * 5, P.gold[2]);
    p.set(cx - ca * 6 + sa, cy - sa * 6 - ca, P.gold[3]);
  });
  return { img: base.img, ax: base.ax, ay: base.ay + Math.round(needleLift(s)) };
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

// Игла вонзилась: блеск, игла торчит из пола и дрожит, нитка ложится.
impact(
  'f13_needle',
  (g, r, px, py, k, time) => {
    const a = Math.atan2(r.vy ?? 0, r.vx ?? 1);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const q = Math.sin(time * 60) * 1.2 * (1 - k) * (1 - k);
    const al = 1 - k01((k - 0.7) / 0.3);
    g.strokeStyle = rgba(P.silver[3], al);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px - ca * 5 + q, py - 5 - sa * 2);
    g.stroke();
    g.strokeStyle = rgba(GOLD[2], al);
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(px - ca * 5 + q, py - 5 - sa * 2);
    g.quadraticCurveTo(px - ca * 9, py - 1, px - ca * 13, py + 1);
    g.stroke();
    if (k < 0.3) twinkle(g, px, py - 1, 3 * (1 - k / 0.3), WHITE, 1 - k / 0.3);
    burst(g, px, py - 2, k, 5, r.seed, [P.silver[3], GOLD[3]], 8);
  },
  0.5,
  0.1,
);
