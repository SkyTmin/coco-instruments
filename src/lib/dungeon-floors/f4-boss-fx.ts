// Этаж 4, босс «Каменный идол» — техники (v2.85): всё, что идол и его
// стражи создают в мире. Метки ударов, контакт каждого удара
// (`registerImpactPainter`), визуальные зоны эффектов (пыль, осколки,
// столбы света) — без урона и статусов. Тело босса рисует `f4-art.ts`.
//
// Язык этажа: базальт идола, светлый камень стражей, свет идола (янтарь →
// белое золото → алый) и холодный свет плит-укрытий. Всё светящееся —
// поверх темноты (`above`), камень и пыль — на полу, под мобами.
//
// Правила, которые держат всё ниже:
//  • метка читается «куда» с первого кадра и «когда» — нарастает к удару,
//    последние ~0,2 с — ясный сигнал (вспыхивает кромка);
//  • контакт живёт в мире: осколки летят по баллистике и отскакивают,
//    пыль расходится с торможением и оседает, трещина остывает и гаснет;
//  • пиксели — целые, привязка к миру: узор полосы продолжается из полосы в
//    полосу, а не «плывёт» с камерой;
//  • частицы — не состояние, а функция (зерно, возраст): кадр можно
//    нарисовать в любой момент, стоп-кадр держит его сам;
//  • тяжёлое (текстуры полос, трещины, отпечаток ладони, осколки) рисуется
//    ОДИН раз и лежит в `frameLRU`.
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import { Px } from '../dungeon-art';
import { frameLRU, paintSim, registerImpactPainter, registerZonePainter } from '../dungeon-paint';
import type { ImpactDef, ZonePainter } from '../dungeon-paint';
import { LOOK, RULES, ST } from './f4-brains';

type G = CanvasRenderingContext2D;
type RGBA = [number, number, number, number];

const TAU = Math.PI * 2;
const cl = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
/** Разгон и торможение — кубические, как у меча героя. */
const eOut = (t: number) => 1 - (1 - cl(t)) ** 3;
const eIn = (t: number) => cl(t) ** 2;
const eIn3 = (t: number) => cl(t) ** 3;
const frac = (v: number) => v - Math.floor(v);
/** Колокол 0 → 1 → 0 на отрезке [0, 1]. */
const bell = (u: number) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));

/** Хеш целых → 0…1: зерно частиц и узоров, одно и то же на каждом кадре. */
function hs(a: number, b = 0, c = 0): number {
  let h =
    (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1442695041)) >>>
    0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function rgb(h: string, a = 255): RGBA {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}

/** Палитра: камень 0x72 и акценты этажа. */
const C = {
  ink: '#150f0b',
  white: '#ffffff',
  hot: '#fff6e0',
  gold: '#ffe08a',
  goldMid: '#dcb44c',
  goldDk: '#8a6a20',
  amber: '#ffb040',
  orange: '#ff7a2a',
  red: '#ff3a28',
  crimson: '#c8241a',
  blood: '#6a1410',
  soot: '#1a1210',
  smoke: '#3e3634',
  cold: '#d8f0ff',
  cyan: '#8fd6ff',
  coldDk: '#3a6a8a',
  dust: '#a39d90',
  dustDk: '#6e6a62',
  crack: '#1c1714',
  rim: '#b8b4aa',
};
const STONE = { hi: '#c6c8be', mid: '#989b91', sh: '#6d7069', dk: '#474a46' };
const BAS = { hi: '#a8a28e', mid: '#6a6558', sh: '#4d4940', dk: '#34312b' };
const SLAB = { hi: '#8c919a', mid: '#5f646e', sh: '#40434b' };

/** Учитывает «уменьшить движение»: без мерцания и строба. */
let calmQ: boolean | null = null;
function calm(): boolean {
  if (calmQ === null)
    calmQ =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  return calmQ;
}

/** Кадр целиком вне экрана — рисовать нечего. */
function offView(g: G, x0: number, y0: number, x1: number, y1: number): boolean {
  const m = g.getTransform();
  const sx = m.a || 1;
  const sy = m.d || 1;
  const l = -m.e / sx;
  const t = -m.f / sy;
  return x1 < l || y1 < t || x0 > l + g.canvas.width / sx || y0 > t + g.canvas.height / sy;
}

/** Прямоугольник цветом и прозрачностью (целые пиксели от точки привязки). */
function box(g: G, c: string, a: number, x: number, y: number, w = 1, h = 1): void {
  if (a <= 0.01 || w <= 0 || h <= 0) return;
  g.globalAlpha = a > 1 ? 1 : a;
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

// ---------------------------------------------------------------------------
// Кеш спрайтов: пыль, осколки, трещины, текстуры полос — рисуются один раз.
// ---------------------------------------------------------------------------

const SPR = frameLRU<HTMLCanvasElement>(320);

function cached(key: string, make: () => Px): HTMLCanvasElement {
  const hit = SPR.get(key);
  if (hit) return hit;
  return SPR.set(key, make().canvas());
}

/** Клуб пыли: диск в два тона, свет сверху-слева. */
function puffImg(r: number, light: string, dark: string): HTMLCanvasElement {
  const R = Math.max(1, Math.min(8, Math.round(r)));
  return cached(`pf|${R}|${light}|${dark}`, () => {
    const s = R * 2 + 1;
    const p = new Px(s, s);
    const L = rgb(light);
    const D = rgb(dark);
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const dx = x - R;
        const dy = y - R;
        if (dx * dx + dy * dy > R * R + R * 0.6) continue;
        p.set(x, y, dx + dy > R * 0.45 ? D : L);
      }
    return p;
  });
}

function puff(
  g: G,
  x: number,
  y: number,
  r: number,
  a: number,
  light = C.dust,
  dark = C.dustDk,
): void {
  if (a <= 0.01 || r < 0.5) return;
  const img = puffImg(r, light, dark);
  g.globalAlpha = a > 1 ? 1 : a;
  const h = (img.width - 1) / 2;
  g.drawImage(img, Math.round(x - h), Math.round(y - h));
}

/**
 * Пыль как в пиксельных играх: клуб вспухает за первые кадры и тает,
 * СЖИМАЯСЬ, а не выцветая — края остаются чёткими. `u` — доля жизни 0…1.
 */
function dust(
  g: G,
  x: number,
  y: number,
  r0: number,
  u: number,
  light = C.dust,
  dark = C.dustDk,
  a = 0.9,
): void {
  if (u < 0 || u >= 1) return;
  const r = r0 * (u < 0.12 ? 0.55 + (0.45 * u) / 0.12 : (1 - (u - 0.12) / 0.88) ** 0.8);
  puff(g, x, y, r, a, light, dark);
}

/** Осколок камня: кусочек с освещённым верхом и контуром. */
function chipImg(
  w: number,
  h: number,
  pal: { hi: string; mid: string; sh: string },
): HTMLCanvasElement {
  return cached(`ch|${w}|${h}|${pal.hi}`, () => {
    const p = new Px(w + 2, h + 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        p.set(x + 1, y + 1, rgb(y === 0 ? pal.hi : y === h - 1 && h > 1 ? pal.sh : pal.mid));
    // Мелочь без контура: обведённый камешек в 2 px читается пузырём.
    if (w >= 3 && h >= 2) p.outline(rgb(C.ink));
    else for (let x = 0; x < w; x++) p.set(x + 1, h + 1, rgb(C.ink, 160));
    return p;
  });
}

/**
 * Брошенный камешек: полёт, один отскок, короткое скольжение и покой.
 * Возвращает смещение по полу (x, y) и высоту z. Стартует с высоты `z0`.
 */
function toss(
  t: number,
  vx: number,
  vy: number,
  vz: number,
  G: number,
  z0 = 0,
  e = 0.32,
  f = 0.5,
): [number, number, number] {
  const T1 = (vz + Math.sqrt(vz * vz + 2 * G * z0)) / G;
  if (t <= T1) return [vx * t, vy * t, z0 + vz * t - 0.5 * G * t * t];
  let x = vx * T1;
  let y = vy * T1;
  const vz2 = (G * T1 - vz) * e;
  const T2 = (2 * vz2) / G;
  const u = t - T1;
  const bx = vx * f;
  const by = vy * f;
  if (u <= T2) return [x + bx * u, y + by * u, vz2 * u - 0.5 * G * u * u];
  x += bx * T2;
  y += by * T2;
  const s = Math.min(u - T2, 0.12);
  const k = s - (s * s) / 0.24;
  return [x + bx * f * k, y + by * f * k, 0];
}

/**
 * Сеть трещин от центра: `n` ветвей от радиуса `r0` до `r1`, ломаные, с
 * отростками. Трещина — тёмная линия в пиксель, кромка освещена снизу-справа.
 * `reach` 0…1 — докуда трещина успела добежать (стадии для «щелчка»).
 */
function crackNet(
  seed: number,
  n: number,
  r0: number,
  r1: number,
  reach: number,
  squash = 1,
): HTMLCanvasElement {
  const q = Math.round(reach * 4) / 4;
  return cached(`cn|${seed}|${n}|${r0}|${r1}|${q}|${squash}`, () => {
    const S = Math.ceil(r1) * 2 + 6;
    const c = S / 2;
    const p = new Px(S, S);
    const dark = rgb(C.crack);
    const lit = rgb(C.rim, 170);
    const pts: [number, number][] = [];
    const walk = (x: number, y: number, a: number, len: number, k: number, depth: number) => {
      let px0 = x;
      let py0 = y;
      for (let s = 0; s < len * q; s += 1.5) {
        a += (hs(seed, k, s * 7 + depth * 131) - 0.5) * 0.7;
        px0 += Math.cos(a) * 1.5;
        py0 += Math.sin(a) * 1.5 * squash;
        pts.push([Math.round(px0), Math.round(py0)]);
        if (depth < 1 && hs(seed, k * 13, s * 3) < 0.06)
          walk(px0, py0, a + (hs(seed, k, s) < 0.5 ? -0.9 : 0.9), len * 0.35, k * 7 + s, depth + 1);
      }
    };
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (hs(seed, i, 1) - 0.5) * 0.9;
      const r = r0 + hs(seed, i, 2) * 2;
      const len = (r1 - r0) * (0.55 + 0.45 * hs(seed, i, 3));
      walk(c + Math.cos(a) * r, c + Math.sin(a) * r * squash, a, len, i + 1, 0);
    }
    for (const [x, y] of pts) p.set(x, y, dark);
    for (const [x, y] of pts) if (!p.solid(x + 1, y + 1)) p.set(x + 1, y + 1, lit);
    return p;
  });
}

function drawCentered(g: G, img: HTMLCanvasElement, x: number, y: number, a: number): void {
  if (a <= 0.01) return;
  g.globalAlpha = a > 1 ? 1 : a;
  g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
}

/** Пиксельная линия (без сглаживания) — ступеньками по большему шагу. */
function line(g: G, x0: number, y0: number, x1: number, y1: number, step = 1): void {
  const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / step));
  for (let i = 0; i <= n; i++)
    g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
}

/** Пиксельная окружность точками (целые пиксели, без сглаживания). */
function ring(g: G, x: number, y: number, r: number, step = 2, phase = 0, sq = 1): void {
  if (r < 0.5) return;
  const n = Math.max(8, Math.round((TAU * r) / step));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + phase;
    g.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * sq), 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Прогрев: всё, что рисуется один раз (пыль, осколки, трещины, руны, ладонь,
// куски стража), готовится заранее — не больше 1 мс за кадр, пока в мире есть
// хоть одна зона или удар идола. Первый удар не платит за новые спрайты.
// ---------------------------------------------------------------------------

const WARM: (() => unknown)[] = [];
let warmAt = -1;
function warm(time: number): void {
  if (!WARM.length || time === warmAt) return;
  warmAt = time;
  const t0 = performance.now();
  while (WARM.length && performance.now() - t0 < 1) WARM.shift()?.();
}

function zonePainter(art: string, f: ZonePainter): void {
  registerZonePainter(art, (g, z, px, py, scale, time) => {
    warm(time);
    return f(g, z, px, py, scale, time);
  });
}

function impactPainter(art: string, def: ImpactDef): void {
  const paint = def.paint;
  registerImpactPainter(art, {
    ...def,
    paint: (g, rec, px, py, scale, age, time) => {
      warm(time);
      return paint(g, rec, px, py, scale, age, time);
    },
  });
}

// ---------------------------------------------------------------------------
// Взор: полосы наливаются, в миг удара — стена света, после — выжженный пол.
// ---------------------------------------------------------------------------

/**
 * Язык взора — руна-глаз на каждой плите пола. Метка: руны загораются по
 * одной (сколько горит — столько осталось ждать), к удару полоса густеет,
 * последние доли секунды руны и кромка бьют белым. Удар: из каждой руны —
 * столб света, полоса белеет и схлопывается в луч. После: руны выжжены в
 * камне и остывают, из них летят искры. Плиты пола — сетка 16×16 мира,
 * поэтому соседние полосы сливаются в одно поле, без швов и полос.
 */
const EYE_RUNE = ['.xxx.', 'x.x.x', '.xxx.'];

/**
 * Свет поверх темноты не должен ложиться на тело идола: помост под ним —
 * тоже пол арены, и полосы взора его накрывают. Вырезает прямоугольник
 * фигуры идола (трон 64×72 от точки ног). Вернуть true — нужен `restore`.
 */
function clipIdol(g: G, px: number, py: number, zx: number, zy: number, scale: number): boolean {
  const idol = paintSim()?.mobs.find((m) => m.kind === 'f4_idol');
  if (!idol) return false;
  const ix = Math.round(px + (idol.x - zx) * scale);
  const iy = Math.round(py + (idol.y - zy) * scale);
  g.save();
  g.beginPath();
  g.rect(-1e4, -1e4, 2e4, 2e4);
  g.rect(ix - 30, iy - 72, 60, 74);
  g.clip('evenodd');
  return true;
}

/** Руна-глаз 5×3 цветом. */
function eyeImg(color: string): HTMLCanvasElement {
  return runeImg(EYE_RUNE, color);
}

/** Выжженная руна с трещинкой (4 рисунка) — на стадии остывания. */
const BURN = ['#ffffff', '#fff0a0', '#ffc040', '#ff7a2a', '#c8301a', '#5a1a12'];
const BURN_GLOW = ['#fff0c0', '#ffc040', '#ff7a2a', '#c8301a', '#6a1410', '#2a100c'];
function burnImg(v: number, stage: number): HTMLCanvasElement {
  return cached(`bn|${v}|${stage}`, () => {
    const p = new Px(7, 5);
    p.map(EYE_RUNE, { x: rgb(BURN[stage]) }, 1, 1);
    // Пока горячо — ореол жара вокруг штрихов.
    if (stage < 4) p.outline(rgb(BURN_GLOW[stage], 90));
    return p;
  });
}

/** Какие плиты накрывает хоть одна полоса взора (кеш на набор ударов). */
let beamSetKey = '';
let beamSet = new Set<number>();
const beamEdges = new Map<number, { top: boolean[]; bot: boolean[]; l: boolean[]; r: boolean[] }>();
function tileKey(x: number, y: number): number {
  return y * 4096 + x;
}
function edgesOf(st: Strike) {
  const hit = beamEdges.get(st.id);
  if (hit) return hit;
  const sim = paintSim();
  const x0 = Math.round(st.x);
  const n = Math.max(1, Math.round(st.r));
  const y0 = Math.round(st.y - (st.w ?? 0.5));
  const m = Math.max(1, Math.round((st.w ?? 0.5) * 2));
  const e = {
    top: new Array<boolean>(n).fill(true),
    bot: new Array<boolean>(n).fill(true),
    l: new Array<boolean>(m).fill(true),
    r: new Array<boolean>(m).fill(true),
  };
  if (sim) {
    const beams = sim.strikes.filter((s) => s.art === 'f4_beam');
    const key = beams.map((s) => s.id).join(',');
    if (key !== beamSetKey) {
      beamSetKey = key;
      beamSet = new Set();
      for (const s of beams) {
        const bx = Math.round(s.x);
        const by = Math.round(s.y - (s.w ?? 0.5));
        const bw = Math.round(s.r);
        const bh = Math.round((s.w ?? 0.5) * 2);
        for (let yy = 0; yy < bh; yy++)
          for (let xx = 0; xx < bw; xx++) beamSet.add(tileKey(bx + xx, by + yy));
      }
    }
    for (let i = 0; i < n; i++) {
      e.top[i] = !beamSet.has(tileKey(x0 + i, y0 - 1));
      e.bot[i] = !beamSet.has(tileKey(x0 + i, y0 + m));
    }
    for (let j = 0; j < m; j++) {
      e.l[j] = !beamSet.has(tileKey(x0 - 1, y0 + j));
      e.r[j] = !beamSet.has(tileKey(x0 + n, y0 + j));
    }
  }
  if (beamEdges.size > 256) beamEdges.clear();
  beamEdges.set(st.id, e);
  return e;
}

/** Метка взора: руны-глаза загораются по одной, к удару полоса густеет. */
zonePainter('f4_beam', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const warn = Math.max(0.05, st.warn);
  const k = cl(st.t / warn);
  const left = warn - st.t;
  const n = Math.max(1, Math.round(st.r));
  const m = Math.max(1, Math.round((st.w ?? 0.5) * 2));
  const len = n * scale;
  const H = m * scale;
  const top = Math.round(py - H / 2);
  const x0 = Math.round(px);
  if (offView(g, x0 - 2, top - 2, x0 + len + 2, top + H + 2)) return true;
  const tx0 = Math.round(st.x);
  const ty0 = Math.round(st.y - (st.w ?? 0.5));
  const late = left < 0.2;
  const blink = late && !calm() && Math.floor(time * 20) % 2 === 0;
  // Свет копится на полу: сперва еле-еле, к удару — густо и светлее.
  box(g, '#8a140c', 0.07 + 0.2 * k * k, x0, top, len, H);
  if (k > 0.75) box(g, '#ff5a3a', 0.18 * eIn((k - 0.75) / 0.25), x0, top, len, H);
  // Руны: тусклая резьба видна сразу, каждая загорается в свой миг.
  const dim = eyeImg('#6a1a12');
  const on = eyeImg(k > 0.8 ? '#ffb080' : '#ff5a3a');
  const pop = eyeImg('#ffe0c8');
  const hot = eyeImg(blink ? C.white : '#ffd0a0');
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) {
      const tx = tx0 + i;
      const ty = ty0 + j;
      // Загорается в своё окно ДО удара: волны ближе к идолу — раньше.
      const lit = Math.max(0.05 * warn, warn - 0.2 - Math.min(1.7, warn * 0.8) * hs(tx, ty, 3));
      const x = x0 + i * scale + 6 + Math.round((hs(tx, ty, 13) - 0.5) * 6);
      const y = top + j * scale + 7 + Math.round((hs(tx, ty, 14) - 0.5) * 6);
      let img = dim;
      let a = 0.55;
      if (st.t >= lit) {
        img = late ? hot : st.t - lit < 0.08 ? pop : on;
        a = 1;
      }
      g.globalAlpha = a;
      g.drawImage(img, x, y);
    }
  // Кромка — только там, где кончается свет (у плит и у стен), не между волнами.
  const e = edgesOf(st);
  const ec = late ? (blink ? C.white : '#ffd0b0') : '#ff6a48';
  const ea = late ? 1 : 0.35 + 0.55 * k;
  g.fillStyle = ec;
  g.globalAlpha = ea;
  const wx0 = tx0 * scale;
  for (let i = 0; i < n; i++) {
    const xs = x0 + i * scale;
    if (e.top[i]) {
      g.fillRect(xs, top, scale, 1);
      for (let x = (8 - ((wx0 + i * scale) % 8)) % 8; x < scale; x += 8)
        g.fillRect(xs + x - 1, top + 1, 3, 1);
    }
    if (e.bot[i]) {
      g.fillRect(xs, top + H - 1, scale, 1);
      for (let x = (8 - ((wx0 + i * scale) % 8)) % 8; x < scale; x += 8)
        g.fillRect(xs + x - 1, top + H - 2, 3, 1);
    }
  }
  for (let j = 0; j < m; j++) {
    if (e.l[j]) g.fillRect(x0, top + j * scale, 1, scale);
    if (e.r[j]) g.fillRect(x0 + len - 1, top + j * scale, 1, scale);
  }
  // Жар дрожит над полом: искры поднимаются по всей полосе.
  g.fillStyle = '#ffc8a0';
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const ph = hs(tx0 + i, ty0 + j, 9);
      const u = frac(time * (0.7 + 0.6 * k) + ph);
      g.globalAlpha = bell(u) * (0.15 + 0.6 * k);
      g.fillRect(
        x0 + i * scale + Math.floor(hs(tx0 + i, ty0 + j, 5) * 15),
        top + j * scale + 15 - Math.floor(u * 15),
        1,
        1,
      );
    }
  g.globalAlpha = 1;
  return true;
});

/**
 * Взор бьёт — поверх темноты: полоса белеет (кадр удара), из каждой руны
 * бьёт вверх столб света, полоса схлопывается в раскалённый луч вдоль
 * средней линии и гаснет золотом.
 */
zonePainter('f4_flash', (g, z, px, py, scale) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) return true;
  const n = Math.max(1, Math.round(zz.r));
  const m = Math.max(1, Math.round((zz.dur ?? 0.5) * 2));
  const len = n * scale;
  const H = m * scale;
  const top = Math.round(py - H / 2);
  const x0 = Math.round(px);
  if (offView(g, x0, top - 40, x0 + len, top + H + 4)) return true;
  const a = zz.t - warn;
  const u = cl(a / Math.max(0.05, zz.life));
  const tx0 = Math.round(zz.x);
  const ty0 = Math.round(zz.y - (zz.dur ?? 0.5));
  const clipped = clipIdol(g, px, py, zz.x, zz.y, scale);
  // Кадр удара: вся полоса белая и чуть шире.
  if (a < 0.045) {
    box(g, '#ffe8b0', 0.9, x0 - 1, top - 2, len + 2, H + 4);
    box(g, C.white, 1, x0, top, len, H);
  } else {
    // Полоса гаснет золотом, свет стягивается в луч вдоль средней линии.
    const f = (1 - u) ** 2;
    box(g, u < 0.3 ? '#ffe08a' : C.orange, 0.55 * f, x0, top, len, H);
    const half = Math.max(1, Math.round((H / 2) * (1 - eOut(u)) + 1));
    const cy = Math.round(py);
    box(g, C.gold, 0.9 * (1 - u), x0, cy - half - 1, len, half * 2 + 2);
    box(g, C.white, 0.95 * (1 - u), x0, cy - half, len, half * 2);
  }
  // Занавес света встаёт над полосой и тает: свет падал В пол и отражается.
  const rise = eOut(a / 0.08);
  const cur = Math.round(14 * rise * (1 - 0.6 * u));
  const fa = (1 - u) ** 1.6;
  box(g, C.gold, 0.32 * fa, x0, top - Math.round(cur * 0.5), len, Math.round(cur * 0.5));
  box(g, C.gold, 0.16 * fa, x0, top - cur, len, cur - Math.round(cur * 0.5));
  // Столбы из рун — не из каждой: треть бьёт вверх, у каждой своя высота.
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const tx = tx0 + i;
      const ty = ty0 + j;
      if (hs(tx, ty, 2) > 0.24) continue;
      const d = hs(tx, ty, 4) * 0.05;
      const b = a - d;
      if (b < 0) continue;
      const v = cl(b / (zz.life - d));
      const hgt = Math.round((12 + 16 * hs(tx, ty, 6)) * eOut(b / 0.05) * (1 - 0.75 * eIn(v)));
      const x = x0 + i * scale + 6 + Math.round((hs(tx, ty, 7) - 0.5) * 6);
      const yb = top + j * scale + 8;
      const al = (1 - v) ** 1.4;
      // Луч: яркий у пола, к верху уже и прозрачнее — три ступени.
      const h1 = Math.round(hgt * 0.45);
      const h2 = Math.round(hgt * 0.3);
      const h3 = hgt - h1 - h2;
      box(g, C.gold, 0.3 * al, x, yb - h1, 3, h1);
      box(g, C.white, 0.95 * al, x + 1, yb - h1, 1, h1);
      box(g, C.gold, 0.18 * al, x, yb - h1 - h2, 3, h2);
      box(g, C.white, 0.6 * al, x + 1, yb - h1 - h2, 1, h2);
      box(g, C.white, 0.28 * al, x + 1, yb - hgt, 1, h3);
    }
  g.globalAlpha = 1;
  if (clipped) g.restore();
  return true;
});

/** Взор прошёл: руны выжжены в камне и остывают, по средней линии — копоть. */
impactPainter('f4_beam', {
  life: 1.8,
  shake: 0.08,
  flash: 0.3,
  flashRgb: '255,226,180',
  paint(g, rec, px, py, scale, age) {
    const n = Math.max(1, Math.round(rec.r ?? 1));
    const m = Math.max(1, Math.round((rec.w ?? 0.5) * 2));
    const len = n * scale;
    const H = m * scale;
    const top = Math.round(py - H / 2);
    const x0 = Math.round(px);
    if (offView(g, x0, top - 30, x0 + len, top + H + 4)) return true;
    const tx0 = Math.round(rec.x);
    const ty0 = Math.round(rec.y - (rec.w ?? 0.5));
    const out = age < 1.1 ? 1 : 1 - (age - 1.1) / 0.7;
    // Копоть вдоль хода взора.
    const soot = eOut(age / 0.1) * out;
    box(g, C.soot, 0.2 * soot, x0, top + Math.round(H * 0.15), len, Math.round(H * 0.7));
    box(g, C.soot, 0.2 * soot, x0, top + Math.round(H * 0.3), len, Math.round(H * 0.4));
    // Выжженные руны остывают: белое → золото → оранжевое → алое → тёмное.
    const s = age < 0.07 ? 0 : age < 0.25 ? 1 : age < 0.5 ? 2 : age < 0.85 ? 3 : age < 1.25 ? 4 : 5;
    for (let j = 0; j < m; j++)
      for (let i = 0; i < n; i++) {
        const tx = tx0 + i;
        const ty = ty0 + j;
        if (hs(tx, ty, 12) > 0.7) continue;
        const img = burnImg(Math.floor(hs(tx, ty, 8) * 4), s);
        g.globalAlpha = cl(out);
        const jx = Math.round((hs(tx, ty, 13) - 0.5) * 6);
        const jy = Math.round((hs(tx, ty, 14) - 0.5) * 6);
        g.drawImage(img, x0 + i * scale + 5 + jx, top + j * scale + 6 + jy);
      }
    // Искры вылетают из рун, падают, тлеют на полу.
    for (let j = 0; j < m; j++)
      for (let i = 0; i < n; i++) {
        for (let q = 0; q < 2; q++) {
          const tx = tx0 + i;
          const ty = ty0 + j;
          const t = age - hs(tx, ty, 20 + q) * 0.1;
          if (t < 0 || t > 0.9) continue;
          const vx = (hs(tx, ty, 22 + q) - 0.5) * 36;
          const vz = 60 + 90 * hs(tx, ty, 24 + q);
          const [dx, dy, dz] = toss(t, vx, (hs(tx, ty, 26 + q) - 0.5) * 10, vz, 330, 0, 0.2, 0.3);
          const col = t < 0.12 ? C.white : t < 0.35 ? '#ffd860' : t < 0.6 ? C.orange : '#b0281a';
          const a = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.3;
          const x = x0 + i * scale + 8;
          const y = top + j * scale + 8;
          box(g, col, a, Math.round(x + dx), Math.round(y + dy - dz));
          if (dz > 2) {
            const [ox, oy, oz] = toss(Math.max(0, t - 0.03), vx, 0, vz, 330, 0, 0.2, 0.3);
            box(g, col, a * 0.45, Math.round(x + ox), Math.round(y + oy - oz));
          }
        }
      }
    // Дымок от остывающих рун.
    for (let i = 0; i < n; i += 2) {
      const tx = tx0 + i;
      const t = age - 0.2 - hs(tx, ty0, 31) * 0.3;
      if (t < 0) continue;
      const u = t / 1.2;
      if (u >= 1) continue;
      const y = top + Math.floor(hs(tx, ty0, 32) * m) * scale + 8;
      puff(
        g,
        x0 + i * scale + 8 + t * 5,
        y - t * 16,
        1.5 + 2.5 * u,
        0.28 * bell(u),
        '#5a504c',
        C.smoke,
      );
    }
    g.globalAlpha = 1;
    return true;
  },
});

/** Когда полоса взора накроет ряды этой зоны (время зоны) — с меткой рядом. */
const plateHits = new Map<number, number | null>();
function plateHit(z: Zone): number | null {
  if (plateHits.has(z.id)) return plateHits.get(z.id) ?? null;
  const sim = paintSim();
  if (!sim) return null;
  let at: number | null = null;
  for (const st of sim.strikes) {
    if (st.art !== 'f4_beam') continue;
    if (Math.abs(st.y - z.y) > (st.w ?? 0.5) + 1.05) continue;
    const t = z.t + (st.warn - st.t);
    if (at === null || t < at) at = t;
  }
  if (plateHits.size > 64) plateHits.clear();
  plateHits.set(z.id, at);
  return at;
}

/** Знак плиты: глаз под щитом — «здесь свет не тронет». */
const PLATE_RUNE = [
  '...xxx...',
  '.xx...xx.',
  'x..xxx..x',
  'x.x...x.x',
  'x..xxx..x',
  '.x.....x.',
  '..x...x..',
  '...x.x...',
  '....x....',
];

function runeImg(rows: string[], color: string, outline = false): HTMLCanvasElement {
  return cached(`rn|${rows.join('')}|${color}|${outline ? 1 : 0}`, () => {
    const o = outline ? 1 : 0;
    const p = new Px(rows[0].length + o * 2, rows.length + o * 2);
    p.map(rows, { x: rgb(color) }, o, o);
    if (outline) p.outline(rgb(C.ink, 200), true);
    return p;
  });
}

/** Светлая плита на полу: холодный свет, бегущий кант, знак; вспыхивает, когда бьёт взор. */
zonePainter('f4_plate', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const half = Math.round(zz.r * scale);
  const x0 = Math.round(px - half);
  const y0 = Math.round(py - half);
  const S = half * 2;
  if (offView(g, x0 - 12, y0 - 12, x0 + S + 12, y0 + S + 12)) return true;
  const t = zz.t;
  const born = eOut(t / 0.25);
  const end = cl((zz.life - t) / 0.35);
  const A = born * end;
  const hit = plateHit(zz);
  const pre = hit === null ? 0 : cl(1 - (hit - t) / 1.2);
  const flare = hit === null || t < hit ? 0 : cl(1 - (t - hit) / 0.35);
  const pulse = 0.5 + 0.5 * Math.sin(time * 6 + zz.id);
  box(g, '#bfe6ff', A * (0.16 + 0.07 * pulse + 0.12 * pre + 0.3 * flare), x0, y0, S, S);
  // Кант и бегущие по нему штрихи: плита «живая», её видно краем глаза.
  const edge = A * (0.5 + 0.3 * pre + 0.4 * flare);
  box(g, '#e8f8ff', edge, x0 + 1, y0 + 1, S - 2, 1);
  box(g, '#e8f8ff', edge, x0 + 1, y0 + S - 2, S - 2, 1);
  box(g, '#e8f8ff', edge, x0 + 1, y0 + 2, 1, S - 4);
  box(g, '#e8f8ff', edge, x0 + S - 2, y0 + 2, 1, S - 4);
  const per = (S - 3) * 4;
  const run = time * (26 + 30 * pre);
  g.fillStyle = C.white;
  for (let d = frac(run / 7) * 7; d < per; d += 7) {
    const side = Math.floor(d / (S - 3));
    const o = d - side * (S - 3);
    const x =
      side === 0 ? x0 + 1 + o : side === 1 ? x0 + S - 2 : side === 2 ? x0 + S - 2 - o : x0 + 1;
    const y =
      side === 0 ? y0 + 1 : side === 1 ? y0 + 1 + o : side === 2 ? y0 + S - 2 : y0 + S - 2 - o;
    g.globalAlpha = A * (0.7 + 0.3 * flare);
    g.fillRect(Math.round(x), Math.round(y), 2, 2);
  }
  // Уголки.
  for (const [cx, cy, sx, sy] of [
    [x0 - 1, y0 - 1, 1, 1],
    [x0 + S, y0 - 1, -1, 1],
    [x0 - 1, y0 + S, 1, -1],
    [x0 + S, y0 + S, -1, -1],
  ]) {
    box(g, C.cold, A * 0.9, cx, cy, 4 * sx < 0 ? -4 : 4, sy < 0 ? -1 : 1);
    box(g, C.cold, A * 0.9, cx, cy, sx < 0 ? -1 : 1, 4 * sy < 0 ? -4 : 4);
  }
  // Знак посередине.
  drawCentered(g, runeImg(PLATE_RUNE, C.white), px, py, A * (0.55 + 0.35 * pulse + 0.4 * flare));
  // Рождение: квадрат света разбегается из центра к краям.
  if (t < 0.3) {
    const r = Math.round(half * eOut(t / 0.3));
    box(g, C.white, 0.8 * (1 - t / 0.3), Math.round(px - r), Math.round(py - r), r * 2, 1);
    box(g, C.white, 0.8 * (1 - t / 0.3), Math.round(px - r), Math.round(py + r - 1), r * 2, 1);
    box(g, C.white, 0.8 * (1 - t / 0.3), Math.round(px - r), Math.round(py - r), 1, r * 2);
    box(g, C.white, 0.8 * (1 - t / 0.3), Math.round(px + r - 1), Math.round(py - r), 1, r * 2);
  }
  // Взор ударил рядом — оберег держит: волна холодного света наружу.
  if (flare > 0) {
    const u = 1 - flare;
    const r = half + Math.round(10 * eOut(u));
    g.fillStyle = C.cold;
    g.globalAlpha = 0.8 * flare;
    g.fillRect(Math.round(px - r), Math.round(py - r), r * 2, 1);
    g.fillRect(Math.round(px - r), Math.round(py + r - 1), r * 2, 1);
    g.fillRect(Math.round(px - r), Math.round(py - r), 1, r * 2);
    g.fillRect(Math.round(px + r - 1), Math.round(py - r), 1, r * 2);
  }
  g.globalAlpha = 1;
  return true;
});

/** Столб холодного света над плитой — поверх темноты, видно через весь зал. */
zonePainter('f4_pillar', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const half = Math.round(zz.r * scale);
  const t = zz.t;
  const grow = eOut(t / 0.3);
  const end = cl((zz.life - t) / 0.4);
  const hit = plateHit(zz);
  const flare = hit === null || t < hit ? 0 : cl(1 - (t - hit) / 0.35);
  const pre = hit === null ? 0 : cl(1 - (hit - t) / 1.2);
  const Hc = Math.round(72 * grow * (0.25 + 0.75 * eOut(end)));
  const w = Math.max(2, Math.round((half * 2 - 6) * eOut(t / 0.22))) + (flare > 0 ? 2 : 0);
  const xl = Math.round(px - w / 2);
  const yb = Math.round(py + half - 2);
  const yt = Math.round(py - half - Hc);
  if (offView(g, xl, yt, xl + w, yb)) return true;
  const A = end * (1 + 0.8 * pre * 0 + 1.4 * flare);
  // Ступени прозрачности снизу вверх: столб растворяется в темноте свода.
  const steps = [0.2, 0.16, 0.12, 0.08, 0.05, 0.025];
  const span = yb - yt;
  for (let i = 0; i < steps.length; i++) {
    const y1 = yb - Math.round((span * i) / steps.length);
    const y0 = yb - Math.round((span * (i + 1)) / steps.length);
    box(g, '#cfeeff', steps[i] * A, xl, y0, w, y1 - y0);
    box(g, C.white, steps[i] * A * 1.6, xl, y0, 1, y1 - y0);
    box(g, C.white, steps[i] * A * 1.6, xl + w - 1, y0, 1, y1 - y0);
    box(g, C.white, steps[i] * A * 0.9, Math.round(px) - 1, y0, 2, y1 - y0);
  }
  // Пылинки в столбе поднимаются.
  g.fillStyle = C.white;
  for (let i = 0; i < 9; i++) {
    const u = frac(time * (0.35 + 0.2 * hs(zz.id, i, 1)) + hs(zz.id, i, 2));
    const x = xl + 1 + Math.floor(hs(zz.id, i, 3) * Math.max(1, w - 2));
    const y = yb - Math.round(u * span);
    g.globalAlpha = bell(u) * 0.85 * end;
    g.fillRect(x, y, 1, 1);
  }
  g.globalAlpha = 1;
  return true;
});

/** Волны взора из текущих ударов: когда (время зоны) и какие ряды мира. */
interface Wave {
  at: number;
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}
const gazeWaves = new Map<number, Wave[]>();
function wavesOf(z: Zone, sim: Sim | null): Wave[] {
  const hit = gazeWaves.get(z.id);
  if (hit) return hit;
  const out: Wave[] = [];
  if (sim)
    for (const st of sim.strikes) {
      if (st.art !== 'f4_beam') continue;
      const at = z.t + (st.warn - st.t);
      let w = out.find((v) => Math.abs(v.at - at) < 0.02);
      if (!w) {
        w = { at, y0: 1e9, y1: -1e9, x0: 1e9, x1: -1e9 };
        out.push(w);
      }
      w.y0 = Math.min(w.y0, st.y - (st.w ?? 0.5));
      w.y1 = Math.max(w.y1, st.y + (st.w ?? 0.5));
      w.x0 = Math.min(w.x0, st.x);
      w.x1 = Math.max(w.x1, st.x + st.r);
    }
  out.sort((a, b) => a.at - b.at);
  if (gazeWaves.size > 16) gazeWaves.clear();
  if (out.length) gazeWaves.set(z.id, out);
  return out;
}

/** Где глаза идола на экране (центр между ними), в пикселях мира от точки идола. */
const IDOL_EYES = { dx: 5, dy: -57 };

/**
 * Взор идола: из глаз к полосе, которая сейчас нальётся, тянется конус
 * алого света — видно, КТО смотрит и КУДА. В миг удара конус белеет и
 * перескакивает на следующую волну.
 */
zonePainter('f4_gazeray', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const sim = paintSim();
  const idol = sim?.mobs.find((m) => m.kind === 'f4_idol' && m.mode !== 'dying');
  if (!sim || !idol) return true;
  const waves = wavesOf(zz, sim);
  if (!waves.length) return true;
  const t = zz.t;
  const ix = px + (idol.x - zz.x) * scale;
  const iy = py + (idol.y - zz.y) * scale;
  const ey = Math.round(iy + IDOL_EYES.dy);
  const i = waves.findIndex((w) => t < w.at + 0.12);
  if (i < 0) return true;
  const w = waves[i];
  const prev = i > 0 ? waves[i - 1].at : 0;
  const k = cl((t - prev) / Math.max(0.1, w.at - prev));
  const after = t - w.at;
  const flash = after >= 0 ? 1 - after / 0.12 : 0;
  // Куда смотрит: верхний край волны.
  const ty = Math.round(py + (w.y0 - zz.y) * scale);
  const lx = Math.round(px + (w.x0 - zz.x) * scale);
  const rx = Math.round(px + (w.x1 - zz.x) * scale);
  if (offView(g, Math.min(lx, ix - 8), ey - 4, Math.max(rx, ix + 8), ty + 4)) return true;
  // Слабый алый свет в конусе — только на полу перед идолом, не на нём.
  const clipped = clipIdol(g, px, py, zz.x, zz.y, scale);
  g.globalAlpha =
    flash > 0 ? 0.08 * flash : (0.02 + 0.045 * k) * (0.85 + 0.15 * Math.sin(time * 30));
  g.fillStyle = flash > 0 ? '#fff0d8' : '#ff3a28';
  g.beginPath();
  g.moveTo(ix - IDOL_EYES.dx, ey);
  g.lineTo(ix + IDOL_EYES.dx, ey);
  g.lineTo(rx, ty);
  g.lineTo(lx, ty);
  g.closePath();
  g.fill();
  if (clipped) g.restore();
  // Края конуса — пунктиром, бегущим от глаз к полу.
  g.fillStyle = flash > 0 ? C.white : '#ff7a5a';
  g.globalAlpha = flash > 0 ? 0.7 * flash : 0.18 + 0.35 * k;
  const run = frac(time * 3);
  for (const [sx, tx] of [
    [ix - IDOL_EYES.dx, lx],
    [ix + IDOL_EYES.dx, rx],
  ]) {
    const n = Math.max(4, Math.round(Math.hypot(tx - sx, ty - ey) / 6));
    for (let j = 0; j < n; j++) {
      const u = (j + run) / n;
      g.fillRect(Math.round(sx + (tx - sx) * u), Math.round(ey + (ty - ey) * u), 1, 2);
    }
  }
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Заповедь: круг рун у ног (на полу) и знак над головой (поверх темноты).
// ---------------------------------------------------------------------------

const RULE_COL: Record<number, { hi: string; mid: string; dk: string }> = {
  [RULES.bow]: { hi: '#fff2b0', mid: '#ffd24a', dk: '#8a6a20' },
  [RULES.praise]: { hi: '#f0faff', mid: '#9fd8ff', dk: '#2e5a80' },
  [RULES.sheathe]: { hi: '#ffe0d0', mid: '#ff6a4a', dk: '#7a1a12' },
};

/** Знаки заповедей — те же, что на скрижали, крупнее. */
const RULE_GLYPH: Record<number, string[]> = {
  // ПОКЛОНИСЬ: шеврон вниз над чертой — «замри, к земле».
  [RULES.bow]: [
    'x.......x',
    'xx.....xx',
    '.xx...xx.',
    '..xx.xx..',
    '...xxx...',
    '....x....',
    '.........',
    'xxxxxxxxx',
    'xxxxxxxxx',
  ],
  // ВОСХВАЛИ: глаз — «смотри на меня».
  [RULES.praise]: [
    '.........',
    '...xxx...',
    '.xx...xx.',
    'x..xxx..x',
    'x.xx.xx.x',
    'x..xxx..x',
    '.xx...xx.',
    '...xxx...',
    '.........',
  ],
  // ОПУСТИ МЕЧ: меч остриём вниз, перечёркнутый наискось.
  [RULES.sheathe]: [
    '....x...x',
    '....x..x.',
    '..xxxxx..',
    '....xx...',
    '....x....',
    '...xx....',
    '..x.x....',
    '.x..x....',
    'x...x....',
  ],
};

/** Руны круга: четыре мелких знака 3×3. */
const RUNES3 = [
  ['x.x', '.x.', 'x.x'],
  ['xxx', 'x..', 'xxx'],
  ['.x.', 'xxx', '.x.'],
  ['x..', 'xxx', '..x'],
];

interface RuleView {
  rule: number;
  /** Где рисовать круг: у ног героя, у «поклонись» на суде — на якоре. */
  hx: number;
  hy: number;
  ax: number;
  ay: number;
  face: number;
  /** Приговор: 0 — нет, 1 — соблюдено, 2 — кара; `vt` — когда (время зоны). */
  verdict: 0 | 1 | 2;
  vt: number;
  idol: Mob | null;
}

const verdicts = new Map<number, { v: 1 | 2; t: number }>();
function ruleView(z: Zone, px: number, py: number, scale: number): RuleView {
  const sim = paintSim();
  const b = sim?.boss;
  const d = b?.data;
  const h = sim?.hero;
  const rule = (d?.rule as number | undefined) ?? RULES.bow;
  const at = (x: number, y: number): [number, number] => [
    px + (x - z.x) * scale,
    py + (y - z.y) * scale,
  ];
  const [hx, hy] = h ? at(h.x, h.y) : [px, py];
  const [ax, ay] = d && d.ax !== undefined ? at(d.ax, d.ay) : [hx, hy];
  let v = verdicts.get(z.id);
  if (!v && d && b) {
    const over = b.state !== 'fight';
    if (d.st !== ST.rule || over) {
      v = { v: d.st === ST.wrath ? 2 : 1, t: z.t };
      if (verdicts.size > 32) verdicts.clear();
      verdicts.set(z.id, v);
    }
  }
  return {
    rule,
    hx,
    hy,
    ax,
    ay,
    face: h?.face ?? Math.PI / 2,
    verdict: v?.v ?? 0,
    vt: v?.t ?? 0,
    idol: sim?.mobs.find((m) => m.kind === 'f4_idol') ?? null,
  };
}

/** Круг заповеди на полу: руны встают по кругу, на суде гаснут, как часы. */
zonePainter('f4_judge', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const V = ruleView(zz, px, py, scale);
  const col = RULE_COL[V.rule] ?? RULE_COL[RULES.bow];
  const warn = zz.warn ?? 0;
  const t = zz.t;
  const judging = t >= warn && !V.verdict;
  const dur = Math.max(0.1, zz.life - 0.5);
  const left = 1 - cl((t - warn) / dur);
  // Круг идёт за героем; «поклонись» на суде приколачивает его к месту.
  const cx = judging && V.rule === RULES.bow ? V.ax : V.hx;
  const cy = judging && V.rule === RULES.bow ? V.ay : V.hy;
  if (offView(g, cx - 32, cy - 32, cx + 32, cy + 32)) return true;
  const snap = t >= warn ? cl((t - warn) / 0.1) : 0;
  const R = 21 - 3 * eOut(snap);
  const spin = judging || V.verdict ? 0 : t * 0.7;
  const N = 12;
  const late = judging && left * dur < 0.2;
  const blink = late && !calm() && Math.floor(time * 24) % 2 === 0;
  // Приговор: соблюдено — руны разлетаются; кара — схлопываются в центр.
  const vu = V.verdict ? cl((t - V.vt) / (V.verdict === 1 ? 0.45 : 0.14)) : 0;
  if (V.verdict && vu >= 1) return true;
  const ringA = V.verdict ? 1 - vu : 1;
  // Печать: лёгкая заливка цветом заповеди, по краю — круг.
  if (!V.verdict || V.verdict === 1) {
    g.fillStyle = col.mid;
    g.globalAlpha = (judging ? 0.13 : 0.07) * ringA * eOut(t / 0.3);
    g.beginPath();
    g.arc(cx, cy, V.verdict === 1 ? R + 12 * eOut(vu) : R, 0, TAU);
    g.fill();
  }
  g.fillStyle = judging ? col.mid : col.dk;
  g.globalAlpha = (judging ? 0.9 : 0.6) * ringA * eOut(t / 0.3);
  ring(g, cx, cy, R, judging ? 1 : 2, spin);
  // Суд начался — печать защёлкивается: белое кольцо сходится на круг.
  if (snap > 0 && snap < 1 && !V.verdict) {
    g.fillStyle = C.white;
    g.globalAlpha = 1 - snap;
    ring(g, cx, cy, R + 10 * (1 - eOut(snap)), 1);
  }
  // Часы суда: дуга по внешнему краю тает по часовой — сколько ещё терпеть.
  if (judging) {
    g.fillStyle = late ? (blink ? C.white : col.hi) : col.hi;
    g.globalAlpha = 1;
    const a0 = -Math.PI / 2;
    const n = Math.round(TAU * (R + 3));
    for (let i = 0; i < n * left; i++) {
      const a = a0 + (i / n) * TAU;
      g.fillRect(
        Math.round(cx + Math.cos(a) * (R + 3)),
        Math.round(cy + Math.sin(a) * (R + 3)),
        1,
        2,
      );
    }
  }
  if (judging && V.rule === RULES.bow) {
    // «Замри»: круг-якорь у ног и четыре гвоздя — дальше не шагнуть.
    g.fillStyle = col.hi;
    g.globalAlpha = 0.6 * ringA;
    ring(g, cx, cy, 12.8, 2);
    g.globalAlpha = 0.95 * ringA;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      const x = Math.round(cx + Math.cos(a) * 12.8);
      const y = Math.round(cy + Math.sin(a) * 12.8);
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  }
  // Руны встают по кругу одна за другой; на суде горят ровно и дышат.
  for (let i = 0; i < N; i++) {
    const a = -Math.PI / 2 + (i / N) * TAU + spin;
    const appear = warn > 0 ? cl((t - (i / N) * Math.min(1.1, warn * 0.7)) / 0.08) : 1;
    if (appear <= 0) continue;
    let rr = R;
    if (V.verdict === 1) rr = R + 12 * eOut(vu);
    if (V.verdict === 2) rr = R * (1 - eIn(vu));
    const x = Math.round(cx + Math.cos(a) * rr) - 1;
    const y = Math.round(cy + Math.sin(a) * rr) - 1;
    let c = judging ? col.hi : col.mid;
    let al = judging ? 0.75 + 0.25 * Math.sin(time * 6 + i) : 0.9;
    if (appear < 1) c = C.white;
    if (late) c = blink ? C.white : col.hi;
    if (V.verdict === 2) c = C.red;
    if (V.verdict === 1) c = col.hi;
    al *= appear * ringA;
    const rows = RUNES3[(((i * 7 + (zz.id % 4)) % 4) + 4) % 4];
    g.fillStyle = C.ink;
    g.globalAlpha = al * 0.5;
    g.fillRect(x - 1, y - 1, 5, 5);
    g.fillStyle = c;
    g.globalAlpha = al;
    for (let yy = 0; yy < 3; yy++)
      for (let xx = 0; xx < 3; xx++) if (rows[yy][xx] === 'x') g.fillRect(x + xx, y + yy, 1, 1);
  }
  // «Восхвали»: дуга круга в сторону идола светится, стрелка — куда смотришь.
  if (V.rule === RULES.praise && V.idol && !V.verdict) {
    const ia = Math.atan2(py + (V.idol.y - zz.y) * scale - cy, px + (V.idol.x - zz.x) * scale - cx);
    const ok = Math.abs(Math.atan2(Math.sin(V.face - ia), Math.cos(V.face - ia))) <= LOOK * 0.8;
    g.fillStyle = col.hi;
    g.globalAlpha = judging ? 0.85 : 0.45;
    for (let s = -8; s <= 8; s++) {
      const a = ia + (s / 8) * LOOK * 0.8;
      g.fillRect(
        Math.round(cx + Math.cos(a) * (R + 6)),
        Math.round(cy + Math.sin(a) * (R + 6)),
        1,
        1,
      );
    }
    const fx = cx + Math.cos(V.face) * (R + 6);
    const fy = cy + Math.sin(V.face) * (R + 6);
    g.fillStyle = ok ? C.white : C.red;
    g.globalAlpha = judging ? 1 : 0.7;
    g.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 3, 3);
  }
  g.globalAlpha = 1;
  return true;
});

/**
 * Знак заповеди над головой героя (падает сверху и покачивается), тонкая
 * нить света от третьего глаза идола к знаку, пока идёт суд, и крупный знак
 * над венцом идола. Приговор: соблюдено — знак раскалывается и улетает,
 * кара — алым падает на героя.
 */
zonePainter('f4_sign', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const V = ruleView(zz, px, py, scale);
  const col = RULE_COL[V.rule] ?? RULE_COL[RULES.bow];
  const rows = RULE_GLYPH[V.rule] ?? RULE_GLYPH[RULES.bow];
  const warn = zz.warn ?? 0;
  const t = zz.t;
  const judging = t >= warn && !V.verdict;
  const dur = Math.max(0.1, zz.life - 0.5);
  const left = (1 - cl((t - warn) / dur)) * dur;
  const late = judging && left < 0.2;
  const blink = late && !calm() && Math.floor(time * 24) % 2 === 0;
  const vu = V.verdict ? cl((t - V.vt) / (V.verdict === 1 ? 0.45 : 0.16)) : 0;
  if (V.verdict && vu >= 1) return true;
  // Над головой героя.
  const drop = eOut(t / 0.28);
  const bob = judging || calm() ? 0 : Math.round(Math.sin(time * 4) * 1);
  let gx = V.hx;
  let gy = V.hy - 31 - (1 - drop) * 26 + bob;
  if (V.verdict === 2) gy += 22 * eIn(vu);
  const color = V.verdict === 2 ? C.red : late && blink ? C.white : judging ? col.hi : col.mid;
  const img = runeImg(rows, color, true);
  const a = (t < 0.28 ? drop : 1) * (V.verdict === 1 ? 1 - vu : 1);
  if (V.verdict === 1) {
    // Раскололся: четыре четверти разлетаются вверх и в стороны.
    const q = Math.ceil(img.width / 2);
    for (let i = 0; i < 4; i++) {
      const sx = (i % 2) * q;
      const sy = Math.floor(i / 2) * q;
      const dx = (i % 2 ? 1 : -1) * 10 * eOut(vu);
      const dy = -14 * eOut(vu) + (Math.floor(i / 2) ? 4 : -2) * vu;
      g.globalAlpha = cl(1 - vu);
      g.drawImage(
        img,
        sx,
        sy,
        q,
        q,
        Math.round(gx - img.width / 2 + sx + dx),
        Math.round(gy - img.height / 2 + sy + dy),
        q,
        q,
      );
    }
  } else drawCentered(g, img, gx, gy, a);
  // Нить суда: от третьего глаза идола к знаку, точки бегут к герою.
  if (judging && V.idol) {
    const ix = px + (V.idol.x - zz.x) * scale;
    const iy = py + (V.idol.y - zz.y) * scale - 62;
    const n = Math.max(6, Math.round(Math.hypot(gx - ix, gy - iy) / 5));
    const run = frac(time * 2.2);
    g.fillStyle = col.hi;
    for (let j = 0; j < n; j++) {
      const u = (j + run) / n;
      g.globalAlpha = 0.18 + 0.3 * u;
      g.fillRect(Math.round(ix + (gx - ix) * u), Math.round(iy + (gy - 6 - iy) * u), 1, 1);
    }
  }
  // Крупный знак над венцом идола — заповедь видна и от трона.
  if (V.idol && !V.verdict) {
    const ix = px + (V.idol.x - zz.x) * scale;
    const iy = py + (V.idol.y - zz.y) * scale - 86;
    const big = cached(`rg2|${V.rule}|${color}`, () => {
      const p = new Px(rows[0].length * 2 + 2, rows.length * 2 + 2);
      const c = rgb(color);
      for (let y = 0; y < rows.length; y++)
        for (let x = 0; x < rows[y].length; x++)
          if (rows[y][x] === 'x') p.rect(1 + x * 2, 1 + y * 2, 2 + x * 2, 2 + y * 2, c);
      p.outline(rgb(C.ink, 200), true);
      return p;
    });
    const pulse = judging ? 0.75 + 0.25 * Math.sin(time * 9) : 0.55;
    drawCentered(g, big, ix, iy, eOut(t / 0.4) * pulse);
  }
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Кара: столб света с потолка в героя и выжженный знак на полу.
// ---------------------------------------------------------------------------

/** Столб кары — поверх темноты: игла света, удар во всю ширину, угасание. */
zonePainter('f4_wrath', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const a = zz.t;
  const u = cl(a / zz.life);
  const x = Math.round(px);
  const y = Math.round(py);
  if (offView(g, x - 30, y - 400, x + 30, y + 30)) return true;
  const top = y - 400;
  // Ширина: игла (0–0,04 с) → удар во всю ширину → тает к нитке.
  const W =
    a < 0.04
      ? 2
      : a < 0.14
        ? Math.round(2 + 16 * eOut((a - 0.04) / 0.1))
        : Math.round(18 * (1 - eIn((a - 0.14) / 0.46)));
  const fade = a < 0.14 ? 1 : (1 - (a - 0.14) / 0.46) ** 1.5;
  const jit = !calm() && a > 0.14 && Math.floor(time * 24) % 2 === 0 ? 1 : 0;
  const w = Math.max(1, W - jit);
  box(g, C.amber, 0.45 * fade, x - Math.round(w / 2) - 2, top, w + 4, y - top + 2);
  box(g, C.gold, 0.85 * fade, x - Math.round(w / 2), top, w, y - top + 2);
  const core = a < 0.14 ? 0.95 : 0.8;
  box(
    g,
    C.white,
    core * fade,
    x - Math.round(w / 5),
    top,
    Math.max(1, Math.round((w * 2) / 5)),
    y - top + 2,
  );
  // Удар о пол: кольцо и вспышка у ног.
  if (a >= 0.03) {
    const b = (a - 0.03) / 0.35;
    if (b < 1) {
      g.fillStyle = b < 0.3 ? C.white : C.gold;
      g.globalAlpha = 1 - b;
      ring(g, x, y, 5 + 22 * eOut(b), 2, 0, 0.55);
      ring(g, x, y, 3 + 15 * eOut(b), 3, 0.3, 0.55);
    }
    const f = 1 - cl((a - 0.03) / 0.25);
    puff(g, x, y, 7 * f + 2, 0.7 * f, C.hot, C.gold);
  }
  // Золотые искры поднимаются вокруг столба.
  g.fillStyle = C.gold;
  for (let i = 0; i < 10; i++) {
    const t = a - 0.06 - hs(zz.id, i, 1) * 0.12;
    if (t < 0) continue;
    const ang = hs(zz.id, i, 2) * TAU + t * 5;
    const r = 5 + 5 * hs(zz.id, i, 3) + t * 8;
    g.globalAlpha = cl(1 - t / 0.5);
    g.fillRect(
      Math.round(x + Math.cos(ang) * r),
      Math.round(y - t * 70 - hs(zz.id, i, 4) * 10),
      1,
      1,
    );
  }
  g.globalAlpha = 1;
  return true;
});

/** Ожог кары на полу: копоть, раскалённое кольцо рун, трещины, тлеющие искры. */
zonePainter('f4_scorch', (g, z, px, py, scale) => {
  const zz = z as Zone;
  const a = zz.t;
  const x = Math.round(px);
  const y = Math.round(py);
  if (offView(g, x - 24, y - 24, x + 24, y + 24)) return true;
  const out = a < 1.1 ? 1 : 1 - (a - 1.1) / 0.7;
  const heat = (c0: number) =>
    a < c0 * 0.4 ? C.white : a < c0 ? '#ffd860' : a < c0 * 2 ? C.orange : '#8a2012';
  const sootImg = cached('sc|soot', () => {
    const p = new Px(27, 17);
    const s = rgb(C.soot);
    for (let yy = 0; yy < 17; yy++)
      for (let xx = 0; xx < 27; xx++) {
        const dx = (xx - 13) / 13;
        const dy = (yy - 8) / 8;
        const d = dx * dx + dy * dy;
        if (d < 1 && hs(xx, yy, 77) < 0.9 - d * 0.8) p.set(xx, yy, s);
      }
    return p;
  });
  drawCentered(g, sootImg, x, y, 0.6 * eOut(a / 0.06) * out);
  drawCentered(g, crackNet(((zz.id % 5) + 5) % 5, 7, 3, 13, 1, 0.6), x, y, out);
  // Кольцо выжженных рун.
  g.fillStyle = heat(0.35);
  g.globalAlpha = out;
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * TAU;
    g.fillRect(Math.round(x + Math.cos(ang) * 10), Math.round(y + Math.sin(ang) * 6), 1, 1);
  }
  // Раскалённая сердцевина.
  const core = 1 - cl(a / 0.6);
  puff(g, x, y, 1 + 3 * core, core, C.hot, C.amber);
  // Искры скачут по плитам.
  for (let i = 0; i < 12; i++) {
    const t = a - hs(zz.id, i, 1) * 0.08;
    if (t < 0 || t > 0.9) continue;
    const ang = hs(zz.id, i, 2) * TAU;
    const v = 30 + 60 * hs(zz.id, i, 3);
    const [dx, dy, dz] = toss(
      t,
      Math.cos(ang) * v,
      Math.sin(ang) * v * 0.55,
      60 + 70 * hs(zz.id, i, 4),
      360,
    );
    const c = t < 0.15 ? C.white : t < 0.4 ? '#ffd860' : t < 0.65 ? C.orange : '#8a2012';
    box(g, c, 1 - Math.max(0, t - 0.6) / 0.3, Math.round(x + dx), Math.round(y + dy - dz));
  }
  g.globalAlpha = 1;
  return true;
});

// ---------------------------------------------------------------------------
// Удар ладонью: тень ладони растёт, плиты трескаются, пыль кольцом, осколки.
// ---------------------------------------------------------------------------

/** Ладонь (тень или отпечаток): пальцы к зрителю, большой — к идолу. */
function palmPx(s: number, side: number, kind: 'shadow' | 'print'): Px {
  const W = Math.round(34 * s) + 4;
  const H = Math.round(30 * s) + 4;
  const p = new Px(W, H);
  const cx = W / 2;
  const top = 2;
  const pal = rgb(kind === 'shadow' ? '#000000' : '#1e1a16');
  const put = (x: number, y: number) => p.set(Math.round(x), Math.round(y), pal);
  // Ладонь — овал.
  const pw = 9.5 * s;
  const ph = 7 * s;
  const pcy = top + ph;
  for (let y = -ph; y <= ph; y++)
    for (let x = -pw; x <= pw; x++) if ((x / pw) ** 2 + (y / ph) ** 2 <= 1) put(cx + x, pcy + y);
  // Четыре пальца вниз, чуть веером.
  for (let f = 0; f < 4; f++) {
    const fx = cx + (f - 1.5) * 4.6 * s;
    const lean = (f - 1.5) * 0.9 * s;
    const len = (f === 1 || f === 2 ? 12 : 10) * s;
    for (let t = 0; t <= len; t += 0.5)
      for (let w = -1.4 * s; w <= 1.4 * s; w += 0.5)
        put(fx + w + (lean * t) / Math.max(1, len), pcy + ph * 0.6 + t);
  }
  // Большой палец — к середине идола (в сторону, противоположную руке).
  const tx = cx - side * pw * 0.9;
  for (let t = 0; t <= 8 * s; t += 0.5)
    for (let w = -1.4 * s; w <= 1.4 * s; w += 0.5)
      put(tx - side * t * 0.8 + w * 0.3, pcy + t * 0.5 + w);
  if (kind === 'print') {
    // Вдавленный отпечаток: свет ловит нижний-правый край ямы, тень — верхний-левый.
    const lit = rgb('#9a968c', 200);
    const dk = rgb('#0c0a08');
    const q = new Px(W, H);
    q.data.set(p.data);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!p.solid(x, y)) {
          if (p.solid(x - 1, y - 1)) q.set(x, y, lit);
          continue;
        }
        if (!p.solid(x - 1, y) || !p.solid(x, y - 1)) q.set(x, y, dk);
      }
    return q;
  }
  return p;
}

function palmImg(s: number, side: number, kind: 'shadow' | 'print'): HTMLCanvasElement {
  const q = Math.round(s * 10) / 10;
  return cached(`palm|${q}|${side}|${kind}`, () => palmPx(q, side, kind));
}

/** Сторона руки по положению удара относительно идола. */
function slamSide(x: number): number {
  const idol = paintSim()?.mobs.find((m) => m.kind === 'f4_idol');
  return idol && x < idol.x ? -1 : 1;
}

/**
 * Метка ладони: круг удара с рунными засечками стоит с первого кадра,
 * к центру бегут сходящиеся кольца (всё чаще), тень ладони растёт и
 * темнеет — сначала медленно (рука высоко), в конце разом. Последние
 * 0,2 с — кромка белеет, с пола срывается пыль.
 */
zonePainter('f4_slam', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const warn = Math.max(0.05, st.warn);
  const k = cl(st.t / warn);
  const left = warn - st.t;
  const R = st.r * scale;
  const x = Math.round(px);
  const y = Math.round(py);
  if (offView(g, x - R - 4, y - R - 4, x + R + 4, y + R + 4)) return true;
  const late = left < 0.22;
  const blink = late && !calm() && Math.floor(time * 24) % 2 === 0;
  // Пятно под ударом.
  g.fillStyle = '#5a0e08';
  g.globalAlpha = 0.08 + 0.14 * k;
  g.beginPath();
  g.arc(x, y, R, 0, TAU);
  g.fill();
  // Сходящиеся кольца: всё чаще к удару.
  const per = 0.55 - 0.37 * k;
  g.fillStyle = '#ff6a4a';
  for (let j = 0; j < 3; j++) {
    const u = frac(st.t / per + j / 3);
    g.globalAlpha = (0.15 + 0.5 * k) * u * (1 - u) * 4 * 0.6;
    ring(g, x, y, R * (1 - u), 4, j);
  }
  // Кромка с засечками — где кончается удар.
  g.fillStyle = late ? (blink ? C.white : '#ffd0b0') : '#d8402a';
  g.globalAlpha = late ? 1 : 0.4 + 0.5 * k;
  ring(g, x, y, R, 2);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + 0.1;
    const cx = Math.cos(a);
    const cy = Math.sin(a);
    g.fillRect(Math.round(x + cx * (R - 3)), Math.round(y + cy * (R - 3)), 1, 1);
    g.fillRect(Math.round(x + cx * (R - 2)), Math.round(y + cy * (R - 2)), 1, 1);
  }
  // Тень ладони: рука опускается — тень растёт, темнеет и чуть сползает к центру.
  const side = slamSide(st.x);
  const fall = eIn3(cl((st.t - (warn - 0.3)) / 0.3));
  const s = 0.55 + 0.2 * k + 0.25 * fall;
  const img = palmImg(s, side, 'shadow');
  drawCentered(g, img, x, y - (1 - fall) * 7, 0.18 + 0.2 * k + 0.35 * fall);
  // Воздух под ладонью срывает пыль с плит — наружу, к кромке.
  if (late) {
    const u = 1 - left / 0.22;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + hs(st.id, i) * 0.5;
      const r = R * (0.45 + 0.5 * u) + hs(st.id, i, 2) * 4;
      puff(g, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8 - u * 2, 1 + u, 0.5 * u);
    }
  }
  g.globalAlpha = 1;
  return true;
});

/** Ладонь легла: отпечаток, трещины щелчком, кольцо пыли, плиты и камешки. */
impactPainter('f4_slam', {
  life: 1.7,
  shake: 0.5,
  flash: 0.22,
  flashRgb: '235,220,195',
  paint(g, rec, px, py, scale, age) {
    const R = (rec.r ?? 1.9) * scale;
    const x = px;
    const y = py;
    if (offView(g, x - R * 1.7, y - R * 1.7 - 40, x + R * 1.7, y + R * 1.7)) return true;
    const side = slamSide(rec.x);
    const out = age < 1.15 ? 1 : 1 - (age - 1.15) / 0.55;
    // Кадр удара: под ладонью вспыхивает плита, белое кольцо разбегается.
    if (age < 0.07) {
      g.fillStyle = '#fff4e0';
      g.globalAlpha = 0.55 * (1 - age / 0.07);
      g.beginPath();
      g.ellipse(x, y, R * 0.95, R * 0.76, 0, 0, TAU);
      g.fill();
    }
    if (age < 0.12) {
      g.fillStyle = C.white;
      g.globalAlpha = 1 - age / 0.12;
      ring(g, x, y, R * 1.15 * eOut(age / 0.12), 2, 0, 0.8);
    }
    // Трещины добегают щелчком (два кадра) и остаются.
    const reach = age < 0.04 ? 0.5 : age < 0.08 ? 0.75 : 1;
    drawCentered(g, crackNet(rec.seed % 6, 9, 9, R * 1.05, reach, 0.8), x, y, out);
    // Отпечаток ладони.
    drawCentered(g, palmImg(1, side, 'print'), x, y, out * eOut(age / 0.03));
    // Кольцо пыли: разбегается с торможением, поднимается и оседает.
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + (hs(rec.seed, i) - 0.5) * 0.3;
      const t = age - hs(rec.seed, i, 1) * 0.04;
      if (t < 0) continue;
      const jit = 0.85 + 0.3 * hs(rec.seed, i, 5);
      const spread = R * jit * (0.35 + 0.9 * eOut(t / 0.45)) + 7 * eOut((t - 0.45) / 0.9);
      const rise = 5 * eOut(t / 0.6);
      const u = t / 1.25;
      if (u >= 1) continue;
      const r = 3 + 3 * hs(rec.seed, i, 2);
      dust(g, x + Math.cos(a) * spread, y + Math.sin(a) * spread * 0.8 - rise, r, u);
    }
    // Плиты подскакивают и падают кусками.
    for (let i = 0; i < 8; i++) {
      const a = hs(rec.seed, i, 11) * TAU;
      const r0 = 4 + hs(rec.seed, i, 12) * R * 0.4;
      const v = 40 + 70 * hs(rec.seed, i, 13);
      const [dx, dy, dz] = toss(
        age,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.8,
        90 + 90 * hs(rec.seed, i, 14),
        520,
      );
      const img = chipImg(3 + (i % 2), 2 + (i % 3 === 0 ? 1 : 0), SLAB);
      const cx = x + Math.cos(a) * r0 + dx;
      const cy = y + Math.sin(a) * r0 * 0.8 + dy;
      if (dz > 0.5) box(g, '#000000', 0.25 * out, Math.round(cx) - 1, Math.round(cy), 3, 1);
      g.globalAlpha = cl(out);
      g.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - dz - img.height / 2));
    }
    // Камешки — быстрые, мелкие.
    for (let i = 0; i < 18; i++) {
      const a = hs(rec.seed, i, 31) * TAU;
      const v = 60 + 110 * hs(rec.seed, i, 32);
      const [dx, dy, dz] = toss(
        age,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.8,
        50 + 110 * hs(rec.seed, i, 33),
        560,
        2,
      );
      const c = i % 3 === 0 ? SLAB.hi : i % 3 === 1 ? SLAB.mid : BAS.mid;
      box(g, c, out, Math.round(x + dx), Math.round(y + dy - dz), i % 4 === 0 ? 2 : 1, 1);
    }
    // Столб пыли из-под ладони.
    for (let i = 0; i < 4; i++) {
      const t = age - i * 0.05;
      if (t < 0 || t > 0.8) continue;
      const u = t / 0.8;
      dust(g, x + (i - 1.5) * 5, y - 4 - 16 * eOut(u), 4 + (i % 2) * 2, u);
    }
    g.globalAlpha = 1;
    return true;
  },
});

// ---------------------------------------------------------------------------
// Стражи: пробуждение, шаги, застывание, удар мечом, распад и сборка.
// ---------------------------------------------------------------------------

/** Страж сошёл с постамента: каменная корка трескается и сыплется, пыль кольцом. */
impactPainter('f4_wake', {
  life: 1.1,
  shake: 0.14,
  paint(g, rec, px, py, scale, age) {
    const x = px;
    const y = py;
    if (offView(g, x - 30, y - 40, x + 30, y + 20)) return true;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + hs(rec.seed, i) * 0.4;
      const u = age / 0.9;
      if (u >= 1) break;
      const r = 5 + 13 * eOut(age / 0.4);
      const px1 = x + Math.cos(a) * r;
      const py1 = y + 1 + Math.sin(a) * r * 0.55 - 3 * eOut(u);
      dust(g, px1, py1, 2.5 + hs(rec.seed, i, 3) * 2, u);
    }
    // Каменная корка откалывается с плеч и головы и падает.
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      const [dx, dy, dz] = toss(
        age,
        side * (10 + 30 * hs(rec.seed, i, 5)),
        (hs(rec.seed, i, 6) - 0.3) * 16,
        20 + 50 * hs(rec.seed, i, 7),
        460,
        10 + 16 * hs(rec.seed, i, 8),
      );
      const x0 = side * (4 + 5 * hs(rec.seed, i, 9));
      const img = chipImg(1 + (i % 2), 1 + (i % 3 === 0 ? 1 : 0), STONE);
      g.globalAlpha = cl(age < 0.8 ? 1 : 1 - (age - 0.8) / 0.3);
      g.drawImage(img, Math.round(x + x0 + dx - 1), Math.round(y + dy - dz - 1));
    }
    if (age < 0.1) {
      g.fillStyle = C.white;
      g.globalAlpha = 1 - age / 0.1;
      ring(g, x, y + 1, 4 + 10 * (age / 0.1), 2, 0, 0.55);
    }
    g.globalAlpha = 1;
    return true;
  },
});

/** Шаг камня: пыль из-под ступни. */
zonePainter('f4_step', (g, z, px, py) => {
  const zz = z as Zone;
  const u = cl(zz.t / zz.life);
  for (let i = 0; i < 3; i++) {
    const d = (i - 1) * (3 + 3 * eOut(u));
    dust(g, px + d, py + 1 - 2 * eOut(u) + (i === 1 ? 1 : 0), 1.8, u, C.dust, C.dustDk, 0.7);
  }
  g.globalAlpha = 1;
  return true;
});

/** Застыл на полушаге: с него осыпается пыль, у ног — облачко. Он только что шёл. */
zonePainter('f4_freeze', (g, z, px, py) => {
  const zz = z as Zone;
  const a = zz.t;
  const u = cl(a / zz.life);
  g.fillStyle = C.dust;
  for (let i = 0; i < 9; i++) {
    const t = a - hs(zz.id, i, 1) * 0.15;
    if (t < 0) continue;
    const x0 = (hs(zz.id, i, 2) - 0.5) * 14;
    const [, , dz] = toss(t, 0, 0, 0, 260, 6 + 18 * hs(zz.id, i, 3), 0.1);
    g.globalAlpha = 0.8 * (1 - u);
    g.fillRect(Math.round(px + x0), Math.round(py - dz), 1, 1);
  }
  for (let i = 0; i < 5; i++) {
    const d = (i - 2) * (2 + 4 * eOut(u));
    dust(g, px + d, py + 1 - eOut(u), 2, u, C.dust, C.dustDk, 0.7);
  }
  g.globalAlpha = 1;
  return true;
});

/** Куда смотрел страж, чей меч лёг здесь (кеш на зону). */
const cutDirs = new Map<number, number>();
function cutDir(z: Zone): number {
  const hit = cutDirs.get(z.id);
  if (hit !== undefined) return hit;
  const sim = paintSim();
  let best: Mob | null = null;
  let bd = 3;
  for (const m of sim?.mobs ?? []) {
    if (m.kind !== 'f4_statue') continue;
    const d = Math.hypot(m.x - z.x, m.y - z.y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  const a = best ? best.face : 0;
  if (cutDirs.size > 32) cutDirs.clear();
  cutDirs.set(z.id, a);
  return a;
}

/** Каменный меч врезался в плиты: борозда вдоль удара, сколы, пыль, искра. */
zonePainter('f4_cut', (g, z, px, py) => {
  const zz = z as Zone;
  const a = zz.t;
  const f = cutDir(zz);
  const cx = Math.cos(f);
  const cy = Math.sin(f) * 0.7;
  const out = a < 0.55 ? 1 : 1 - (a - 0.55) / 0.35;
  // Борозда.
  g.fillStyle = C.crack;
  g.globalAlpha = out;
  const len = Math.round(9 * eOut(a / 0.05));
  for (let i = -3; i < len; i++) {
    const j = Math.round((hs(zz.id, i, 1) - 0.5) * 1.6);
    g.fillRect(Math.round(px + cx * i - cy * j), Math.round(py + cy * i + cx * j * 0.7), 1, 1);
  }
  g.fillStyle = C.rim;
  g.globalAlpha = out * 0.6;
  for (let i = -2; i < len; i += 2)
    g.fillRect(Math.round(px + cx * i + 1), Math.round(py + cy * i + 1), 1, 1);
  // Искра камня о камень.
  if (a < 0.08) {
    g.fillStyle = C.white;
    g.globalAlpha = 1 - a / 0.08;
    g.fillRect(Math.round(px) - 2, Math.round(py) - 1, 5, 1);
    g.fillRect(Math.round(px), Math.round(py) - 3, 1, 5);
  }
  // Сколы в стороны от клинка.
  for (let i = 0; i < 7; i++) {
    const s = i % 2 ? 1 : -1;
    const v = 30 + 50 * hs(zz.id, i, 4);
    const [dx, dy, dz] = toss(
      a,
      -cy * s * v + cx * 15,
      cx * s * v * 0.7 + cy * 10,
      40 + 60 * hs(zz.id, i, 5),
      480,
    );
    box(g, i % 3 ? STONE.mid : SLAB.hi, out, Math.round(px + dx), Math.round(py + dy - dz));
  }
  for (let i = 0; i < 4; i++) {
    const u = a / 0.7;
    if (u >= 1) break;
    dust(g, px + (i - 1.5) * 3 * (1 + u), py - 3 * eOut(u), 2.2, u);
  }
  g.globalAlpha = 1;
  return true;
});

/** Куски разбитого стража: где лежат в груде, куда встают в собранном. */
interface Piece {
  w: number;
  h: number;
  /** В груде (от центра постамента). */
  gx: number;
  gy: number;
  /** В собранном стаже (от точки ног). */
  sx: number;
  sy: number;
  pal: 'stone' | 'head' | 'gold' | 'blade';
}
const PIECES: Piece[] = [
  { w: 7, h: 7, gx: -10, gy: 1, sx: 0, sy: -22, pal: 'head' }, // шлем
  { w: 9, h: 7, gx: 0, gy: -3, sx: 0, sy: -14, pal: 'stone' }, // кираса
  { w: 5, h: 4, gx: -5, gy: -5, sx: -5, sy: -18, pal: 'stone' }, // наплечник
  { w: 5, h: 4, gx: 6, gy: -4, sx: 5, sy: -18, pal: 'stone' }, // наплечник
  { w: 11, h: 7, gx: -2, gy: 2, sx: 0, sy: -7, pal: 'gold' }, // пояс и юбка
  { w: 3, h: 5, gx: 9, gy: 1, sx: -2, sy: -2, pal: 'stone' }, // нога
  { w: 3, h: 5, gx: -7, gy: 5, sx: 2, sy: -2, pal: 'stone' }, // нога
  { w: 14, h: 2, gx: 3, gy: 6, sx: 7, sy: -8, pal: 'blade' }, // меч
  { w: 3, h: 2, gx: 12, gy: 5, sx: -3, sy: -11, pal: 'stone' },
  { w: 3, h: 2, gx: -12, gy: 5, sx: 3, sy: -12, pal: 'stone' },
];
const PIECE_PAL = {
  stone: STONE,
  head: STONE,
  gold: { hi: '#fff2b0', mid: '#dcb44c', sh: '#8a6a20' },
  blade: { hi: '#a8adb0', mid: '#4c4f52', sh: '#2e3032' },
};

function pieceImg(p: Piece, upright: boolean, white: boolean): HTMLCanvasElement {
  const w = upright && p.pal === 'blade' ? p.h : p.w;
  const h = upright && p.pal === 'blade' ? p.w : p.h;
  return cached(`pc|${w}|${h}|${p.pal}|${white ? 1 : 0}`, () => {
    const pal = PIECE_PAL[p.pal];
    const q = new Px(w + 2, h + 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const rel = x / Math.max(1, w - 1);
        const c = white
          ? '#ffe8e0'
          : y === 0 || rel < 0.28
            ? pal.hi
            : y === h - 1 || rel > 0.7
              ? pal.sh
              : pal.mid;
        q.set(x + 1, y + 1, rgb(c));
      }
    if (!white && p.pal === 'head') {
      // Шлем-ведро: Т-образная прорезь и золотой гребень.
      for (let x = 1; x < w - 1; x++) q.set(x + 1, 4, rgb(STONE.dk));
      for (let y = 4; y < h - 1; y++) q.set(Math.floor(w / 2) + 1, y + 1, rgb(STONE.dk));
      q.set(Math.floor(w / 2) + 1, 1, rgb('#dcb44c'));
    }
    if (!white && p.pal === 'gold') {
      // Пояс золотом, ниже — юбка камнем со складками.
      for (let y = 2; y < h; y++)
        for (let x = 0; x < w; x++) {
          const rel = x / Math.max(1, w - 1);
          q.set(
            x + 1,
            y + 1,
            rgb(x % 3 === 1 ? STONE.sh : rel < 0.3 ? STONE.hi : rel > 0.7 ? STONE.sh : STONE.mid),
          );
        }
    }
    q.outline(rgb(C.ink));
    return q;
  });
}

/** Откуда ползут куски: где рассыпался страж (кеш на зону). */
const reformFrom = new Map<number, [number, number] | null>();
function reformOrigin(z: Zone): [number, number] | null {
  if (reformFrom.has(z.id)) return reformFrom.get(z.id) ?? null;
  const sim = paintSim();
  let best: Mob | null = null;
  let bd = 40;
  for (const m of sim?.mobs ?? []) {
    if (m.kind !== 'f4_statue' || m.mode !== 'dying') continue;
    const d = Math.hypot(m.x - z.x, m.y - z.y);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  const o: [number, number] | null =
    best && z.life > 3 && z.t < 0.5 && bd > 0.8 ? [best.x, best.y] : null;
  if (reformFrom.size > 32) reformFrom.clear();
  reformFrom.set(z.id, o);
  return o;
}

/** Мест у зала хватит, чтобы страж встал (иначе куски только рвутся). */
function reformRoom(): boolean {
  const sim = paintSim();
  const b = sim?.boss;
  if (!sim || !b) return true;
  const cap = [2, 3, 4][Math.min(2, b.phase)];
  let awake = 0;
  for (const m of sim.mobs)
    if (m.kind === 'f4_statue' && m.mode !== 'dying' && m.mode !== 'dormant') awake += 1;
  return awake < cap;
}

/**
 * Страж собирается: куски ползут с места гибели к постаменту, лежат грудой
 * (изредка вздрагивают, в щелях тлеет алый), за полторы секунды до срока
 * дрожат и поднимаются, в последние полсекунды слетаются в фигуру —
 * и вспышка, из которой встаёт страж.
 */
zonePainter('f4_reform', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const t = zz.t;
  const L = zz.life;
  if (offView(g, px - 40, py - 40, px + 40, py + 20)) return true;
  const long = L > 3;
  const o = long ? reformOrigin(zz) : null;
  const ox = o ? (o[0] - zz.x) * scale : 0;
  const oy = o ? (o[1] - zz.y) * scale : 0;
  const room = reformRoom();
  const tEnd = L - t;
  const awaken = long ? cl(1 - (tEnd - 0.5) / 1.1) : 1;
  const conv = long && room ? cl(1 - tEnd / 0.5) : 0;
  const glow = long ? cl(t / Math.max(1, L - 1.6)) ** 2 : 1;
  const x0 = Math.round(px);
  const y0 = Math.round(py - 2);
  let headX = 0;
  let headY = 0;
  for (let i = 0; i < PIECES.length; i++) {
    const p = PIECES[i];
    // Путь с места гибели: куски ползут по полу с подскоками.
    let x = p.gx;
    let y = p.gy;
    let zlift = 0;
    if (o) {
      const d0 = 0.8 + i * 0.1;
      const u = cl((t - d0) / 0.9);
      const sx = ox + (hs(zz.id, i, 1) - 0.5) * 14;
      const sy = oy + (hs(zz.id, i, 2) - 0.5) * 8;
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      x = sx + (p.gx - sx) * e;
      y = sy + (p.gy - sy) * e;
      zlift = u > 0 && u < 1 ? Math.abs(Math.sin(u * Math.PI * 3)) * 2 : 0;
      if (u <= 0) zlift = 0;
    }
    // Вздрагивают: редкие подскоки на пиксель.
    if (long && awaken <= 0 && frac(t * 0.37 + hs(zz.id, i, 3)) < 0.025) zlift += 1;
    // Пробуждение: дрожь и подъём.
    if (awaken > 0) {
      const q = Math.floor(time * 16);
      const amp = calm() ? 0 : awaken;
      x += Math.round((hs(q, i, zz.id) - 0.5) * 2 * amp);
      y += Math.round((hs(q, i + 50, zz.id) - 0.5) * 1.4 * amp);
      zlift += 8 * eOut(awaken) * (0.55 + 0.45 * hs(zz.id, i, 5));
    }
    // Сборка: слетаются в фигуру стража с разгоном.
    let upright = false;
    if (conv > 0) {
      const e = eIn(conv);
      x = x + (p.sx - x) * e;
      const yy = y - zlift;
      y = yy + (p.sy - yy) * e;
      zlift = 0;
      upright = conv > 0.5;
    }
    const white = conv > 0.84;
    const img = pieceImg(p, upright, white);
    const drawX = Math.round(x0 + x - img.width / 2);
    const drawY = Math.round(y0 + y - zlift - img.height / 2);
    if (zlift > 1 && conv <= 0)
      box(g, '#000000', 0.3, Math.round(x0 + x - 2), Math.round(y0 + y + 2), 4, 1);
    g.globalAlpha = 1;
    g.drawImage(img, drawX, drawY);
    if (i === 0) {
      headX = drawX + img.width / 2;
      headY = drawY + img.height / 2;
    }
    // С поднятых кусков сыплется пыль.
    if (awaken > 0 && conv <= 0 && i < 6) {
      const u = frac(time * 2.5 + hs(zz.id, i, 6));
      box(
        g,
        C.dust,
        0.7 * (1 - u),
        Math.round(x0 + x),
        Math.round(y0 + y - zlift + 2 + u * zlift),
        1,
        1,
      );
    }
  }
  // Щели груды тлеют алым, в прорези шлема горят глаза — ярче к сроку.
  if (conv < 1) {
    const pulse = 0.6 + 0.4 * Math.sin(time * (2 + 10 * awaken));
    const a = (0.2 + 0.7 * glow) * pulse * (1 - conv);
    for (const [dx, dy] of [
      [-4, 0],
      [4, -1],
      [1, 3],
      [-7, 4],
      [7, 3],
    ])
      box(g, awaken > 0.5 ? '#ff8a60' : C.red, a, x0 + dx, y0 + dy, 2, 1);
    const e = (0.35 + 0.65 * glow) * (1 - conv);
    box(g, C.red, e, Math.round(headX) - 2, Math.round(headY - 0.5), 1, 1);
    box(g, C.red, e, Math.round(headX) + 2, Math.round(headY - 0.5), 1, 1);
  }
  // Вспышка сборки — склейка с настоящим стражем прячется под ней.
  if (conv > 0.8) {
    const f = (conv - 0.8) / 0.2;
    puff(g, x0, y0 - 12, 5 + 5 * f, 0.4 * f, '#ffe8e0', '#ff9a80');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      dust(
        g,
        x0 + Math.cos(a) * (4 + 8 * f),
        y0 + 2 + Math.sin(a) * (2 + 4 * f),
        2.5,
        0.1 + 0.3 * f,
      );
    }
  }
  g.globalAlpha = 1;
  return true;
});

/** Страж рассыпался: пыль клубом и куски — летят, отскакивают, ложатся. */
zonePainter('f4_crumble', (g, z, px, py) => {
  const zz = z as Zone;
  const a = zz.t;
  if (offView(g, px - 40, py - 40, px + 40, py + 30)) return true;
  const out = a < 0.95 ? 1 : 1 - (a - 0.95) / 0.45;
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU + hs(zz.id, i) * 0.5;
    const t = a - hs(zz.id, i, 1) * 0.05;
    if (t < 0) continue;
    const u = t / 1.2;
    if (u >= 1) continue;
    const r = 3 + 14 * eOut(t / 0.5);
    const h = 8 + 10 * hs(zz.id, i, 2);
    const x1 = px + Math.cos(ang) * r;
    const y1 = py - h * (1 - eOut(t / 0.9)) * 0.7 + Math.sin(ang) * r * 0.5 - 4 * eOut(u);
    dust(g, x1, y1, 3.5 + 3 * hs(zz.id, i, 3), u, STONE.mid, STONE.sh);
  }
  for (let i = 0; i < 10; i++) {
    const ang = hs(zz.id, i, 11) * TAU;
    const v = 25 + 60 * hs(zz.id, i, 12);
    const [dx, dy, dz] = toss(
      a,
      Math.cos(ang) * v,
      Math.sin(ang) * v * 0.6,
      30 + 70 * hs(zz.id, i, 13),
      480,
      6 + 18 * hs(zz.id, i, 14),
    );
    const p = PIECES[i % PIECES.length];
    const img = pieceImg({ ...p, w: Math.max(2, p.w - 2), h: Math.max(2, p.h - 1) }, false, false);
    if (dz > 1)
      box(g, '#000000', 0.25 * out, Math.round(px + dx - 1), Math.round(py + dy + 1), 3, 1);
    g.globalAlpha = cl(out);
    g.drawImage(
      img,
      Math.round(px + dx - img.width / 2),
      Math.round(py + dy - dz - img.height / 2),
    );
  }
  g.globalAlpha = 1;
  return true;
});

/** Скол идола: базальтовая крошка отлетает к герою, пыль у места удара. */
zonePainter('f4_chip', (g, z, px, py) => {
  const zz = z as Zone;
  const a = zz.t;
  const sim = paintSim();
  const idol = sim?.mobs.find((m) => m.kind === 'f4_idol');
  const dir = idol ? Math.atan2(zz.y - idol.y, zz.x - idol.x) : Math.PI / 2;
  const out = a < 0.45 ? 1 : 1 - (a - 0.45) / 0.25;
  for (let i = 0; i < 8; i++) {
    const ang = dir + (hs(zz.id, i) - 0.5) * 1.6;
    const v = 40 + 60 * hs(zz.id, i, 2);
    const [dx, dy, dz] = toss(
      a,
      Math.cos(ang) * v,
      Math.sin(ang) * v * 0.7,
      20 + 50 * hs(zz.id, i, 3),
      460,
      8 + 12 * hs(zz.id, i, 4),
    );
    const c = i % 3 === 0 ? BAS.hi : i % 3 === 1 ? BAS.mid : BAS.sh;
    box(g, c, out, Math.round(px + dx), Math.round(py + dy - dz), i % 3 === 0 ? 2 : 1, 1);
  }
  const u = a / 0.5;
  dust(g, px, py - 12 + 2 * u, 2.5, u, BAS.hi, BAS.mid, 0.8);
  g.globalAlpha = 1;
  return true;
});

/** Смена фазы: с свода сыплется песок струями, падают камешки. */
zonePainter('f4_quake', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const a = zz.t;
  for (let s = 0; s < 5; s++) {
    const d0 = hs(zz.id, s, 1) * 0.5;
    const t = a - d0;
    if (t < 0 || t > 1.8) continue;
    const ang = (s / 5) * TAU + hs(zz.id, s, 2) * 0.9;
    const rr = (2.2 + 2.6 * hs(zz.id, s, 3)) * scale;
    const x = Math.round(px + Math.cos(ang) * rr);
    const y = Math.round(py + Math.sin(ang) * rr * 0.75);
    if (offView(g, x - 8, y - 100, x + 8, y + 6)) continue;
    const on = t < 1.3 ? 1 : 1 - (t - 1.3) / 0.5;
    // Струя песка с потолка: тонкая нить и бегущие вниз песчинки.
    box(g, C.dust, 0.22 * on, x, y - 96, 1, 96);
    g.fillStyle = C.dust;
    for (let j = 0; j < 10; j++) {
      const u = frac(time * 2.2 + j / 10 + s * 0.13);
      g.globalAlpha = 0.85 * on;
      g.fillRect(x + (j % 3 === 0 ? 1 : 0), y - 96 + Math.round(u * 96), 1, 2);
    }
    // Горка песка растёт, от удара струи — пыль.
    const w = Math.round(1 + 4 * eOut(t / 1.3));
    box(g, C.dust, 0.9 * on, x - w + 1, y - 1, w * 2 - 1, 1);
    box(g, C.dustDk, 0.9 * on, x - w, y, w * 2 + 1, 1);
    dust(g, x + (s % 2 ? 2 : -2), y - 2, 2, frac(t * 2.2), C.dust, C.dustDk, 0.6 * on);
  }
  // Камешки падают со свода с тенью.
  for (let i = 0; i < 7; i++) {
    const t = a - 0.2 - hs(zz.id, i, 11) * 1.2;
    if (t < 0 || t > 1.4) continue;
    const x = Math.round(px + (hs(zz.id, i, 12) - 0.5) * scale * 10);
    const y = Math.round(py + (hs(zz.id, i, 13) - 0.5) * scale * 8);
    const [, , dz] = toss(t, 0, 0, 0, 700, 90);
    const out = t < 1 ? 1 : 1 - (t - 1) / 0.4;
    const sh = 1 - dz / 90;
    box(g, '#000000', 0.35 * sh * out, x - 1, y + 1, 3, 1);
    g.globalAlpha = cl(out);
    g.drawImage(chipImg(2, 2, STONE), x - 2, Math.round(y - dz - 2));
    if (dz <= 0.5 && t < 1.2) puff(g, x, y, 1.5, 0.4 * out);
  }
  g.globalAlpha = 1;
  return true;
});

/** Идол пал: волна пыли по залу, трещины от помоста, глыбы падают у трона. */
zonePainter('f4_collapse', (g, z, px, py, scale) => {
  const zz = z as Zone;
  const a = zz.t;
  const x = Math.round(px);
  const y = Math.round(py);
  if (offView(g, x - 110, y - 90, x + 110, y + 110)) return true;
  const out = a < 1.8 ? 1 : 1 - (a - 1.8) / 0.8;
  drawCentered(g, crackNet(((zz.id % 4) + 4) % 4, 11, 16, 60, cl(a / 0.25), 0.7), x, y + 8, out);
  for (let i = 0; i < 40; i++) {
    // Волна пыли идёт в зал — на юг и в стороны; позади трона стена.
    const ang = -0.15 * Math.PI + (i / 40) * 1.3 * Math.PI + (hs(zz.id, i) - 0.5) * 0.12;
    const layer = i % 3 === 0 ? 0.6 : 1;
    const t = a - hs(zz.id, i, 1) * 0.12 - (layer < 1 ? 0.08 : 0);
    if (t < 0) continue;
    const u = t / 2.2;
    if (u >= 1) continue;
    const r = (18 + 70 * layer * eOut(t / 1.2)) * (0.85 + 0.3 * hs(zz.id, i, 3));
    const x1 = x + Math.cos(ang) * r;
    const y1 = y + 6 + Math.sin(ang) * r * 0.6 - 8 * eOut(u);
    dust(g, x1, y1, 4.5 + 3 * hs(zz.id, i, 2), u, BAS.hi, BAS.mid);
  }
  for (let i = 0; i < 9; i++) {
    const t = a - 0.1 - hs(zz.id, i, 11) * 0.7;
    if (t < 0) continue;
    const gx = (hs(zz.id, i, 12) - 0.5) * 70;
    const gy = 4 + hs(zz.id, i, 13) * 26;
    const [, , dz] = toss(t, 0, 0, 0, 600, 30 + 50 * hs(zz.id, i, 14), 0.25);
    const img = chipImg(3 + (i % 3), 3 + (i % 2), BAS);
    box(g, '#000000', 0.3 * out, Math.round(x + gx - 2), Math.round(y + gy + 2), 5, 1);
    g.globalAlpha = cl(out);
    g.drawImage(img, Math.round(x + gx - img.width / 2), Math.round(y + gy - dz - img.height / 2));
    if (dz <= 0.5) dust(g, x + gx, y + gy, 4, t / 1.1, BAS.hi, BAS.mid);
  }
  g.globalAlpha = 1;
  return true;
});

// Очередь прогрева — в порядке, в каком это понадобится в бою.
{
  const pals: [string, string][] = [
    [C.dust, C.dustDk],
    [STONE.mid, STONE.sh],
    [BAS.hi, BAS.mid],
    ['#5a504c', C.smoke],
    [C.hot, C.gold],
    [C.hot, C.amber],
    ['#ffe8e0', '#ff9a80'],
  ];
  for (const [l, d] of pals) for (let r = 1; r <= 8; r++) WARM.push(() => puffImg(r, l, d));
  for (const rule of [RULES.bow, RULES.praise, RULES.sheathe]) {
    const col = RULE_COL[rule];
    for (const c of [col.mid, col.hi, C.white, C.red])
      WARM.push(() => runeImg(RULE_GLYPH[rule], c, true));
  }
  for (const c of ['#6a1a12', '#ff5a3a', '#ffb080', '#ffe0c8', '#ffd0a0', C.white])
    WARM.push(() => eyeImg(c));
  for (let st = 0; st < 6; st++) WARM.push(() => burnImg(0, st));
  WARM.push(() => runeImg(PLATE_RUNE, C.white));
  for (let sd = 0; sd < 6; sd++)
    for (const q of [0.5, 0.75, 1]) WARM.push(() => crackNet(sd, 9, 9, 1.9 * 16 * 1.05, q, 0.8));
  for (const side of [-1, 1]) {
    for (let k = 5; k <= 10; k++) WARM.push(() => palmImg(k / 10, side, 'shadow'));
    WARM.push(() => palmImg(1, side, 'print'));
  }
  for (let sd = 0; sd < 5; sd++) WARM.push(() => crackNet(sd, 7, 3, 13, 1, 0.6));
  for (const p of PIECES)
    for (const up of [false, true])
      for (const w of [false, true]) WARM.push(() => pieceImg(p, up, w));
  for (const [w, h] of [
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
    [3, 2],
    [4, 2],
    [3, 3],
    [4, 3],
    [5, 3],
    [5, 4],
  ])
    for (const pal of [STONE, SLAB, BAS]) WARM.push(() => chipImg(w, h, pal));
  for (let sd = 0; sd < 4; sd++)
    for (const q of [0.25, 0.5, 0.75, 1]) WARM.push(() => crackNet(sd, 11, 16, 60, q, 0.7));
}
