// Рисовальщик площади каторги (v2.80). Тот же приём, что у подземелья
// (`dungeon-render.ts`), только проще: карта — одна готовая картинка пола и
// стен (её рисует `scripts/hub`), поверх — предметы из атласа, жители и
// герой по глубине, частицы, свет и сутки.
//
// Главное правило то же, что внизу, — оно выстрадано (CLAUDE.md, «Тряска»):
// мир меряется игровыми пикселями, но рисуется СРАЗУ на экранную канву с
// целым множителем, а каждая позиция прижата к точке экрана (`q`). Никакого
// маленького буфера с растяжкой: камера и спрайты прыгали бы целыми игровыми
// пикселями, и при ходьбе всё тряслось бы. Растягивается только маска света —
// она мягкая и такой и должна быть.

import { HUB_REV, HUB_SPRITES } from './hub-maps';
import type { HubMapData } from './hub-maps';
import type { HubSim } from './hub-sim';
import { dayPhase, lampsOn, nightness, shadeAt } from './hub-time';
import { glowBlob, heroFrame, lightBlob, TS } from './dungeon-art';
import type { Dir, HeroAnim } from './dungeon-art';
import type { Gear } from './dungeon';
import { heroSprite } from './dungeon-sprites';
import type { Dir4 } from './dungeon-sprites';
import { walkRow } from './walk';

// ---------------------------------------------------------------------------
// Картинки.
// ---------------------------------------------------------------------------

const imgs = new Map<string, HTMLImageElement>();
const failed = new Set<string>();

/** Адрес картинки площади: ревизия в адресе — перерисованное не придёт из старого кеша. */
export const hubUrl = (path: string) => `${import.meta.env.BASE_URL}hub/${path}?v=${HUB_REV}`;

/**
 * Картинка, если уже пришла; иначе начать загрузку и вернуть null. Кадр
 * рисуется каждые 16 мс, так что пришедшая картинка появится сама, без
 * подписки: до того на её месте пусто, но ничего не падает.
 */
export function hubImage(path: string): HTMLImageElement | null {
  let im = imgs.get(path);
  if (!im) {
    if (typeof Image === 'undefined' || failed.has(path)) return null;
    im = new Image();
    im.decoding = 'async';
    im.onerror = () => failed.add(path);
    im.src = hubUrl(path);
    imgs.set(path, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

/** Загрузить заранее то, что понадобится на карте: пол, атлас, жителей. */
export function preloadHubMap(m: HubMapData): void {
  hubImage('atlas.png');
  hubImage(`maps/${m.id}.png`);
  for (const n of m.npcs) {
    hubImage(`chars/${n.sheet}.png`);
    hubImage(`faces/${n.sheet}.png`);
  }
}

// ---------------------------------------------------------------------------
// Частицы.
// ---------------------------------------------------------------------------

interface Part {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ускорение вниз, пикселей/с². Дым и пар — отрицательное: всплывают. */
  g: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  color: string;
  alpha: number;
  glow: boolean;
  /** Мерцание (магические искры), частота. */
  twinkle: number;
  /** Капля: на земле разбивается брызгами. */
  floor?: number;
}

/** Сколько частиц в секунду даёт источник с rate = 1, по видам. */
const FX_BASE: Record<string, number> = {
  smoke: 2.2,
  sparks: 2.5,
  embers: 3,
  steam: 2.2,
  dust: 1.6,
  motes: 2.4,
  drip: 0.7,
};
const MAX_PARTS = 420;

const reduce = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** Гладкий шум для мерцания огня: случайное число на кадр — это брак. */
function noise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

const DIRS: Dir4[] = ['down', 'up', 'left', 'right'];

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.replace('#', '').slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const rgba = (h: string, a: number) => {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
};

/** Цвета яиц: основа, свет, тень, крапинки. */
const EGG_PAL: Record<string, [string, string, string, string]> = {
  moss: ['#6f8f4a', '#a3c46c', '#3f5a2a', '#d0dc96'],
  stone: ['#8a8a90', '#b8b8be', '#55555c', '#6a6a70'],
  crystal: ['#5ab8d8', '#b8f0ff', '#2f6e98', '#e6cfff'],
  dragon: ['#b83a2a', '#ec7a3e', '#6a1a14', '#ffd24a'],
};
const eggs = new Map<string, HTMLCanvasElement>();

/** Пиксельное яйцо 11×13 с контуром, светом сверху-слева и крапом. */
function eggSprite(id: string): HTMLCanvasElement {
  let c = eggs.get(id);
  if (c) return c;
  const [base, light, dark, fleck] = EGG_PAL[id] ?? EGG_PAL.stone;
  const W = 11;
  const H = 13;
  c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const inside = (x: number, y: number) => {
    // Яйцо уже сверху: полуось 6 над серединой, 5 — под ней.
    const cy = 7;
    const dy = (y + 0.5 - cy) / (y + 0.5 < cy ? 6 : 5);
    const dx = (x + 0.5 - W / 2) / 4.5;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (inside(x, y)) {
        const lx = x - 3.5;
        const ly = y - 4;
        let col = base;
        if (lx * lx + ly * ly < 5) col = light;
        else if (x >= 7 || y >= 10) col = dark;
        if ((x * 7 + y * 13) % 11 === 0 && col === base) col = fleck;
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      } else if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) {
        g.fillStyle = '#141b1b';
        g.fillRect(x, y, 1, 1);
      }
    }
  eggs.set(id, c);
  return c;
}

/** Какие жители и двери сейчас с «!» — решает страница, рисует рисовальщик. */
export interface HubFlags {
  npcs: Set<string>;
  doors: Set<number>;
}

export class HubRenderer {
  readonly view: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  /** Масштаб: игровой пиксель = столько экранных. */
  scale = 4;
  gw = 192;
  gh = 400;
  private dpr = 1;
  /** Камера — мировые пиксели точки, что стоит в середине видимой части. */
  camX = 0;
  camY = 0;
  private camReady = false;
  /** Сколько сверху и снизу закрыто табло, игровые пиксели. */
  private insetTop = 0;
  private insetBottom = 0;
  /** Левый верхний угол кадра в мире — после прижатия к точкам экрана. */
  left = 0;
  top = 0;
  private time = 0;
  private parts: Part[] = [];
  private emitAcc: number[] = [];
  private mapId = '';
  /** Прошлая строка листа у работающих жителей — удар молота ловится по смене. */
  private lastRow = new Map<string, number>();
  private cone: HTMLCanvasElement | null = null;
  /** Кольцо на полу там, куда пошёл по тапу. */
  private tapRing: { x: number; y: number; life: number } | null = null;
  flags: HubFlags = { npcs: new Set(), doors: new Set() };
  /** Яйца в гнёздах игрока — лежат на метках `nest0`, `nest1` Питомника. */
  nests: { egg: string; ready: boolean }[] = [];
  /** Час суток для стенда: null — настоящий. */
  phaseOverride: number | null = null;

  constructor(view: HTMLCanvasElement) {
    this.view = view;
    this.g = view.getContext('2d')!;
    this.light = document.createElement('canvas');
    this.lctx = this.light.getContext('2d')!;
  }

  /**
   * Подогнать под экран: множитель целый, в ширину — около двенадцати
   * плиток (192 игровых пикселя), как просит художественная библия.
   */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = Math.min(3, Math.max(1, dpr));
    const w = Math.max(1, Math.round(cssW * this.dpr));
    const h = Math.max(1, Math.round(cssH * this.dpr));
    this.view.width = w;
    this.view.height = h;
    this.scale = Math.max(1, Math.floor(w / 192));
    this.gw = w / this.scale;
    this.gh = h / this.scale;
    this.light.width = Math.ceil(this.gw) + 2;
    this.light.height = Math.ceil(this.gh) + 2;
    this.g.imageSmoothingEnabled = false;
  }

  /** Сколько экрана занимает табло сверху и снизу (CSS px). */
  setInsets(topCss: number, bottomCss: number): void {
    this.insetTop = (topCss * this.dpr) / this.scale;
    this.insetBottom = (bottomCss * this.dpr) / this.scale;
  }

  /** Камеру — сразу на героя (новая карта, быстрый переход). */
  snap(): void {
    this.camReady = false;
  }

  /** Координата в игровых пикселях, прижатая к точке экрана. */
  private q = (v: number) => Math.round(v * this.scale) / this.scale;

  toWorld(cssX: number, cssY: number): { x: number; y: number } {
    const gx = (cssX * this.dpr) / this.scale;
    const gy = (cssY * this.dpr) / this.scale;
    return { x: (gx + this.left) / TS, y: (gy + this.top) / TS };
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: ((x * TS - this.left) * this.scale) / this.dpr,
      y: ((y * TS - this.top) * this.scale) / this.dpr,
    };
  }

  // ---- Камера ------------------------------------------------------------

  /**
   * Левая или верхняя кромка кадра по одной оси. Карта больше видимой части —
   * камера ходит за героем, но не показывает пустоту за краем (сверху край
   * карты доходит до табло, не дальше). Карта меньше — стоит ПОСЕРЕДИНЕ
   * видимой части: зажим подземелья прижал бы её к краю, а комната должна
   * висеть в центре экрана.
   */
  private edge(cam: number, size: number, view: number, lo: number, hi: number): number {
    const min = -lo;
    const max = size - view + hi;
    if (min >= max) return (min + max) / 2;
    return Math.max(min, Math.min(max, cam));
  }

  private camera(sim: HubSim, dt: number): void {
    const h = sim.hero;
    const vis = this.gh - this.insetTop - this.insetBottom;
    // Точка середины видимой части в кадре.
    const sy = this.insetTop + vis / 2;
    const tx = h.x * TS;
    const ty = h.y * TS - 6;
    if (!this.camReady) {
      this.camX = tx;
      this.camY = ty;
      this.camReady = true;
    }
    const k = 1 - Math.exp(-6 * dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    const mw = sim.map.w * TS;
    const mh = sim.map.h * TS;
    this.left = this.q(this.edge(this.camX - this.gw / 2, mw, this.gw, 0, 0));
    // Снизу у площади пустоты не показываем вовсе: под джойстиком и кнопкой
    // карты лежит сама площадь (там стена и ворота), а не фон за её краем —
    // иначе у ворот внизу экрана висела пустая бурая полоса. Комнату же
    // по-прежнему центруем в части экрана над нижними кнопками.
    const hi = sim.map.data.kind === 'outdoor' ? 0 : this.insetBottom;
    this.top = this.q(this.edge(this.camY - sy, mh, this.gh, this.insetTop, hi));
  }

  // ---- Кадр --------------------------------------------------------------

  frame(sim: HubSim, gear: Gear, dt: number, now = Date.now()): void {
    this.time += dt;
    const m = sim.map.data;
    if (this.mapId !== m.id) {
      this.mapId = m.id;
      this.parts.length = 0;
      this.emitAcc = m.fx.map(() => 0);
      this.lastRow.clear();
      this.camReady = false;
      preloadHubMap(m);
    }
    this.camera(sim, dt);
    const g = this.g;
    const left = this.left;
    const top = this.top;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = m.bg || '#120c10';
    g.fillRect(0, 0, this.view.width, this.view.height);
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);

    // Пол и стены — одна картинка на карту.
    const ground = hubImage(`maps/${m.id}.png`);
    if (ground) g.drawImage(ground, -left, -top);
    this.drawTapRing(dt);

    // Предметы, жители и герой — по ногам.
    const atlas = hubImage('atlas.png');
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    const tops: D[] = [];
    const inView = (x: number, y: number, w: number, h: number) =>
      x + w > left && x < left + this.gw && y + h > top && y < top + this.gh;
    if (atlas) {
      for (const o of m.objs) {
        const sp = HUB_SPRITES[o[0]];
        if (!sp) continue;
        const [sx, sy, w, h, n] = sp;
        if (!inView(o[1], o[2], w, h)) continue;
        const fps = o[5];
        const f = fps > 0 && n > 1 ? Math.floor(this.time * fps + o[6] * n) % n : 0;
        const d: D = {
          y: o[3],
          draw: () => g.drawImage(atlas, sx + f * w, sy, w, h, o[1] - left, o[2] - top, w, h),
        };
        (o[4] ? tops : list).push(d);
      }
    }
    for (const n of sim.npcs) list.push({ y: n.y * TS, draw: () => this.drawNpc(sim, n) });
    this.nests.forEach((nest, i) => {
      const mk = m.marks[`nest${i}`];
      if (mk)
        list.push({ y: mk[1] * TS + 0.5, draw: () => this.drawEgg(nest, mk[0] * TS, mk[1] * TS) });
    });
    list.push({ y: sim.hero.y * TS + 0.02, draw: () => this.drawHero(sim, gear) });
    list.sort((a, b) => a.y - b.y);
    for (const d of list) d.draw();
    for (const d of tops) d.draw();

    // Частицы.
    this.emit(m, dt);
    this.drawParts(dt);

    // Свет и сутки.
    const phase = this.phaseOverride ?? dayPhase(now);
    this.drawLight(sim, phase);

    // «!» и имена — поверх темноты: их обязаны видеть и ночью.
    this.drawMarks(sim);
  }

  /** Пошёл по тапу — кольцо на полу в точке, как в MMORPG: видно, что тап принят. */
  markTap(x: number, y: number): void {
    this.tapRing = { x: x * TS, y: y * TS, life: 0 };
  }

  private drawTapRing(dt: number): void {
    const r = this.tapRing;
    if (!r) return;
    r.life += dt;
    const k = r.life / 0.5;
    if (k >= 1) {
      this.tapRing = null;
      return;
    }
    const g = this.g;
    g.globalAlpha = 0.85 * (1 - k);
    g.strokeStyle = '#ffe08a';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(r.x - this.left, r.y - this.top, 3 + k * 5, 1.5 + k * 2.5, 0, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }

  // ---- Жители и герой ----------------------------------------------------

  private shadow(px: number, py: number): void {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.32)';
    g.beginPath();
    g.ellipse(px, py + 2, 5, 2, 0, 0, Math.PI * 2);
    g.fill();
  }

  private drawNpc(sim: HubSim, n: HubSim['npcs'][number]): void {
    const img = hubImage(`chars/${n.data.sheet}.png`);
    const px = this.q(n.x * TS - this.left);
    const py = this.q(n.y * TS - this.top);
    this.shadow(px, py);
    if (!img) return;
    let row = 0;
    if (n.working) {
      // Молот: замах (первый кадр шага) и удар (строка удара) — через 0,45 с.
      // Фаза от id: два работника не стучат в унисон.
      const beat = Math.floor((this.time + (n.id.length % 5) * 0.13) / 0.45);
      row = beat % 2 ? 4 : 0;
      const was = this.lastRow.get(n.id);
      if (row === 4 && was === 0) this.strike(sim, n);
      this.lastRow.set(n.id, row);
    } else if (n.moving) row = walkRow(n.walk);
    this.g.drawImage(img, n.face * 16, row * 16, 16, 16, px - 8, py - 13, 16, 16);
  }

  /**
   * Яйцо игрока в гнезде — пиксельное, в руке площади, а не рисунок тушью из
   * Питомника: 512-точечная тушь, ужатая до десяти пикселей, выглядела бы
   * чужой вещью. Согревшееся светится и подпрыгивает — его пора вылуплять.
   */
  private drawEgg(nest: { egg: string; ready: boolean }, x: number, y: number): void {
    const g = this.g;
    const img = eggSprite(nest.egg);
    let hop = 0;
    if (nest.ready) {
      const t = this.time % 1.4;
      // Прыжок на пару пикселей раз в полторы секунды: целыми пикселями, по дуге.
      hop = !reduce() && t < 0.3 ? Math.round(Math.sin((t / 0.3) * Math.PI) * 2) : 0;
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.5 + 0.2 * Math.sin(this.time * 4);
      const r = 14;
      g.drawImage(
        glowBlob('rgba(255,214,120,0.9)'),
        x - this.left - r,
        y - this.top - 6 - r,
        r * 2,
        r * 2,
      );
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    g.drawImage(
      img,
      this.q(x - this.left - img.width / 2),
      this.q(y - this.top - img.height - hop),
    );
  }

  /**
   * Удар — сноп искр, но только если у жителя под рукой источник искр карты
   * (наковальня кузнеца). «Работают» и другие: крупье сдаёт карты той же
   * сменой строк — у него искр нет, и выдумывать их нельзя.
   */
  private strike(sim: HubSim, n: HubSim['npcs'][number]): void {
    if (reduce()) return;
    const nx = n.x * TS;
    const ny = n.y * TS;
    let at: HubMapData['fx'][number] | null = null;
    let bd = 28;
    for (const f of sim.map.data.fx) {
      if (f[0] !== 'sparks') continue;
      const d = Math.hypot(f[1] - nx, f[2] - ny);
      if (d < bd) {
        bd = d;
        at = f;
      }
    }
    if (at) for (let i = 0; i < 9; i++) this.spawn('sparks', at[1], at[2], 1.6);
  }

  private heroDir(face: number): Dir4 {
    return DIRS[face & 3];
  }

  private drawHero(sim: HubSim, gear: Gear): void {
    const h = sim.hero;
    const g = this.g;
    const px = this.q(h.x * TS - this.left);
    const py = this.q(h.y * TS - this.top);
    this.shadow(px, py);
    const dir = this.heroDir(h.face);
    const row = h.moving ? walkRow(h.walk) : 0;
    const img = heroSprite(gear.robe.tier, dir, row);
    if (img) {
      g.drawImage(img, px - 8, py - 13);
      return;
    }
    // Спрайты подземелья ещё в пути — прежний нарисованный кодом герой.
    const d: Dir = dir === 'left' || dir === 'right' ? 'side' : dir;
    const anim: HeroAnim = h.moving ? 'walk' : 'idle';
    const frame = h.moving ? Math.floor(h.walk * 2.4) % 4 : Math.floor(this.time * 1.6) % 2;
    g.drawImage(heroFrame(gear, d, anim, frame, dir === 'left'), px - 8, py - 19);
  }

  // ---- Частицы -----------------------------------------------------------

  private emit(m: HubMapData, dt: number): void {
    if (reduce()) return;
    for (let i = 0; i < m.fx.length; i++) {
      const [kind, x, y, rate] = m.fx[i];
      const base = FX_BASE[kind] ?? 1;
      this.emitAcc[i] = (this.emitAcc[i] ?? 0) + base * rate * dt;
      while (this.emitAcc[i] >= 1) {
        this.emitAcc[i] -= 1;
        this.spawn(kind, x, y);
      }
    }
  }

  /** Одна частица вида `kind` у точки (x, y) мира в пикселях. */
  spawn(kind: string, x: number, y: number, k = 1): void {
    if (this.parts.length >= MAX_PARTS) return;
    const r = Math.random;
    const p: Part = {
      x,
      y,
      vx: 0,
      vy: 0,
      g: 0,
      life: 0,
      max: 1,
      size: 1,
      grow: 0,
      color: '#ffffff',
      alpha: 1,
      glow: false,
      twinkle: 0,
    };
    switch (kind) {
      case 'smoke':
        p.x += (r() - 0.5) * 6;
        p.vx = (r() - 0.5) * 3 + 1.5;
        p.vy = -7 - r() * 4;
        p.max = 2.6 + r() * 1.2;
        p.size = 2;
        p.grow = 1.6;
        p.color = r() < 0.5 ? '#4a4440' : '#5c5550';
        p.alpha = 0.45;
        break;
      case 'steam':
        p.x += (r() - 0.5) * 8;
        p.vx = (r() - 0.5) * 4;
        p.vy = -9 - r() * 4;
        p.max = 1.1 + r() * 0.6;
        p.size = 2;
        p.grow = 2.2;
        p.color = '#dfe6ea';
        p.alpha = 0.32;
        break;
      case 'sparks': {
        const a = -Math.PI / 2 + (r() - 0.5) * 2.4;
        const s = (22 + r() * 30) * k;
        p.vx = Math.cos(a) * s;
        p.vy = Math.sin(a) * s;
        p.g = 110;
        p.max = 0.3 + r() * 0.35;
        p.color = r() < 0.4 ? '#fff3c0' : '#ffc45a';
        p.glow = true;
        break;
      }
      case 'embers':
        p.x += (r() - 0.5) * 14;
        p.vx = (r() - 0.5) * 5;
        p.vy = -10 - r() * 10;
        p.max = 1.1 + r() * 1.1;
        p.color = r() < 0.5 ? '#ff8a3a' : '#ffc45a';
        p.glow = true;
        p.twinkle = 9;
        break;
      case 'dust':
        p.x += (r() - 0.5) * 26;
        p.y += (r() - 0.5) * 18;
        p.vx = (r() - 0.5) * 4;
        p.vy = (r() - 0.5) * 2 - 0.6;
        p.max = 3 + r() * 2.5;
        p.color = '#f0dcae';
        p.alpha = 0.55;
        p.twinkle = 2;
        break;
      case 'motes':
        p.x += (r() - 0.5) * 22;
        p.y += (r() - 0.5) * 16;
        p.vx = (r() - 0.5) * 5;
        p.vy = -3 - r() * 4;
        p.max = 1.6 + r() * 1.4;
        p.color = r() < 0.5 ? '#c49bff' : '#8fe8ff';
        p.glow = true;
        p.twinkle = 6;
        break;
      case 'drip':
        p.g = 160;
        p.max = 2;
        p.floor = y + 12 + r() * 4;
        p.color = '#9fc4d8';
        p.alpha = 0.85;
        break;
      case 'splash': {
        const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
        p.vx = Math.cos(a) * 14;
        p.vy = Math.sin(a) * 14;
        p.g = 90;
        p.max = 0.25;
        p.color = '#b8d8e8';
        p.alpha = 0.8;
        break;
      }
      case 'puff':
        p.x += (r() - 0.5) * 4;
        p.vx = (r() - 0.5) * 8;
        p.vy = -3 - r() * 3;
        p.max = 0.35 + r() * 0.2;
        p.size = 1;
        p.grow = 2;
        p.color = '#b8a88c';
        p.alpha = 0.4;
        break;
      default:
        return;
    }
    this.parts.push(p);
  }

  private drawParts(dt: number): void {
    const g = this.g;
    const keep: Part[] = [];
    const left = this.left;
    const top = this.top;
    for (const p of this.parts) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.floor !== undefined && p.y >= p.floor) {
        for (let i = 0; i < 3; i++) this.spawn('splash', p.x, p.floor);
        continue;
      }
      keep.push(p);
    }
    this.parts = keep;
    // Светящееся — сложением, остальное — обычным наложением.
    for (const glow of [false, true]) {
      g.globalCompositeOperation = glow ? 'lighter' : 'source-over';
      for (const p of this.parts) {
        if (p.glow !== glow) continue;
        const k = p.life / p.max;
        let a = p.alpha * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
        if (p.twinkle) a *= 0.6 + 0.4 * Math.sin(p.life * p.twinkle + p.x);
        if (a <= 0.01) continue;
        const s = Math.max(1, Math.round(p.size + p.grow * k));
        g.globalAlpha = Math.min(1, a);
        g.fillStyle = p.color;
        g.fillRect(this.q(p.x - left - s / 2), this.q(p.y - top - s / 2), s, s);
      }
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** Пыль из-под ног на шаге — по событию симуляции. */
  onStep(sim: HubSim): void {
    if (reduce() || sim.map.data.kind !== 'outdoor') return;
    const h = sim.hero;
    this.spawn('puff', h.x * TS, h.y * TS + 1);
  }

  // ---- Свет --------------------------------------------------------------

  /**
   * Луч прожектора — клин, нарисованный один раз и поворачиваемый
   * трансформом (градиент каждый кадр — это перерисовка, а не поворот).
   */
  private coneImg(): HTMLCanvasElement {
    if (this.cone) return this.cone;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    for (const [half, a] of [
      [0.22, 0.18],
      [0.15, 0.25],
      [0.09, 0.32],
    ] as const) {
      const grad = g.createLinearGradient(0, 0, 128, 0);
      grad.addColorStop(0, `rgba(255,248,220,${a})`);
      grad.addColorStop(0.7, `rgba(255,248,220,${a * 0.6})`);
      grad.addColorStop(1, 'rgba(255,248,220,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 32);
      g.lineTo(128, 32 - Math.tan(half) * 128);
      g.lineTo(128, 32 + Math.tan(half) * 128);
      g.closePath();
      g.fill();
    }
    this.cone = c;
    return c;
  }

  private drawLight(sim: HubSim, phase: number): void {
    const m = sim.map.data;
    const outdoor = m.kind === 'outdoor';
    let dark: { r: number; g: number; b: number; a: number };
    let night = 1;
    if (outdoor) {
      dark = shadeAt(phase);
      night = nightness(phase);
    } else {
      // Внутри сутки не видны: свой постоянный сумрак, тёплый, в цвет стен.
      dark = { r: 10, g: 7, b: 14, a: Math.max(0, Math.min(0.85, 1 - m.ambient)) };
    }
    const g = this.g;
    const t = this.time;
    const left = this.left;
    const top = this.top;
    // Какие огни горят и насколько (с мерцанием у живого огня).
    const lit: { x: number; y: number; r: number; color: string; kind: string; k: number }[] = [];
    let lamp = 0;
    for (const L of m.lights) {
      const [x, y, r, color, kind, onlyNight] = L;
      if (onlyNight && outdoor && !lampsOn(phase, lamp++)) continue;
      if (onlyNight && !outdoor) lamp++;
      const fire = kind === 'fire' || kind === 'candle' || kind === 'forge';
      const k = fire ? 1 + noise(t * 3.1, x * 0.37 + y) * 0.07 + Math.sin(t * 9 + x) * 0.025 : 1;
      lit.push({ x, y, r, color, kind, k });
    }
    const beams = outdoor && night > 0.02 ? m.searchlights : [];

    if (dark.a > 0.004) {
      const l = this.lctx;
      const lx = Math.floor(left) - 1;
      const ly = Math.floor(top) - 1;
      const LW = this.light.width;
      const LH = this.light.height;
      l.globalCompositeOperation = 'source-over';
      l.globalAlpha = 1;
      l.clearRect(0, 0, LW, LH);
      l.fillStyle = `rgba(${Math.round(dark.r)},${Math.round(dark.g)},${Math.round(dark.b)},${dark.a.toFixed(3)})`;
      l.fillRect(0, 0, LW, LH);
      l.globalCompositeOperation = 'destination-out';
      const blob = lightBlob();
      const hole = (x: number, y: number, r: number, a = 1) => {
        const px = x - lx;
        const py = y - ly;
        if (px + r < 0 || py + r < 0 || px - r > LW || py - r > LH) return;
        l.globalAlpha = Math.min(1, a);
        l.drawImage(blob, px - r, py - r, r * 2, r * 2);
      };
      for (const L of lit) hole(L.x, L.y, L.r * L.k);
      // Ночью герой не теряется во тьме: слабое пятно вокруг него.
      if (outdoor) hole(sim.hero.x * TS, sim.hero.y * TS - 6, 26, 0.55 * night);
      for (const [x, y, ph] of beams) {
        const a = this.beamAngle(ph);
        hole(x + Math.cos(a) * 96, y + Math.sin(a) * 96, 30, 0.8 * night);
      }
      l.globalAlpha = 1;
      l.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = true;
      g.drawImage(this.light, lx - left, ly - top);
      g.imageSmoothingEnabled = false;
    }

    // Цветной подсвет — сложением. Снаружи днём его почти не видно, ночью —
    // в полную силу; внутри — всегда.
    g.globalCompositeOperation = 'lighter';
    // Сила — прозрачностью, а не цветом пятна: пятно кешируется по цвету, и
    // сила, плавно меняющаяся на закате, плодила бы по холсту на кадр.
    g.globalAlpha = outdoor ? 0.08 + 0.3 * night : 0.3;
    for (const L of lit) {
      const rr = L.r * 0.8 * L.k;
      const px = L.x - left;
      const py = L.y - top;
      if (px + rr < 0 || py + rr < 0 || px - rr > this.gw || py - rr > this.gh) continue;
      g.drawImage(glowBlob(rgba(L.color, 1)), px - rr, py - rr, rr * 2, rr * 2);
    }
    g.globalAlpha = 1;
    if (beams.length) {
      const cone = this.coneImg();
      g.globalAlpha = Math.min(1, night);
      for (const [x, y, ph] of beams) {
        g.save();
        g.translate(x - left, y - top);
        g.rotate(this.beamAngle(ph));
        g.drawImage(cone, 0, -48, 128 * 1.1, 96);
        g.restore();
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';
  }

  /** Прожектор ходит по кругу — оборот за шестнадцать секунд, фаза своя у каждой вышки. */
  private beamAngle(phase: number): number {
    return phase * Math.PI * 2 + this.time * 0.39;
  }

  // ---- «!» и имена -------------------------------------------------------

  private drawMarks(sim: HubSim): void {
    const g = this.g;
    const bob = reduce() ? 0 : Math.round(Math.sin(this.time * 4) * 1.5);
    for (const n of sim.npcs) {
      if (!this.flags.npcs.has(n.id) || sim.talking === n.id) continue;
      // Над именем: имя висит сразу над макушкой, «!» — выше него.
      this.bang(this.q(n.x * TS - this.left), this.q(n.y * TS - this.top) - 36 + bob);
    }
    for (const d of sim.map.doors) {
      if (!this.flags.doors.has(d.i)) continue;
      const x = (d.x + d.w / 2) * TS - this.left;
      // Дверь фасада (подходят снизу) — над проёмом: его верх в двух плитках
      // над нижней кромкой двери. Коврик в комнате — прямо над ним.
      const y = d.ny < 0 ? (d.y + d.h - 2) * TS - this.top - 14 : d.y * TS - this.top - 14;
      this.bang(this.q(x), this.q(y) + bob);
    }
    // Имена жителей — чёткими буквами экрана, не пикселями мира.
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Кегль — в точках CSS (11,5), а не в игровых пикселях: на плотном экране
    // игровой пиксель мелкий, и имя в 3,4 таких было бы с булавочную головку.
    const size = Math.round(11.5 * this.dpr);
    g.font = `800 ${size}px GxRubik, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    for (const n of sim.npcs) {
      const name = n.data.name;
      if (!name) continue;
      const d = Math.hypot(sim.hero.x - n.x, sim.hero.y - n.y);
      // Имя видно вблизи — вдали оно ничего не говорит, а поле загромождает.
      const a = Math.max(0, Math.min(1, (5 - d) / 1.5));
      if (a <= 0) continue;
      const x = (n.x * TS - this.left) * this.scale;
      const y = (n.y * TS - this.top - 15) * this.scale;
      g.globalAlpha = a;
      g.lineWidth = Math.max(2, Math.round(size / 4));
      g.strokeStyle = 'rgba(12,8,6,0.9)';
      g.strokeText(name, x, y);
      g.fillStyle = '#f7ead0';
      g.fillText(name, x, y);
    }
    g.globalAlpha = 1;
  }

  /** Золотой «!» в пиксель — как у квестодателей в MMORPG. */
  private bang(x: number, y: number): void {
    const g = this.g;
    g.fillStyle = '#141b1b';
    g.fillRect(x - 3, y - 1, 6, 12);
    g.fillStyle = '#ffd24a';
    g.fillRect(x - 2, y, 4, 6);
    g.fillRect(x - 2, y + 8, 4, 2);
    g.fillStyle = '#fff3b0';
    g.fillRect(x - 2, y, 1, 5);
    g.fillStyle = '#b8860b';
    g.fillRect(x + 1, y + 1, 1, 5);
  }
}
