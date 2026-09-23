// Картинки подземелья рисует код — как всю каторгу. Пиксели без сглаживания,
// клетка 16×16, вид сверху-сбоку: у стены, за которой пол, видна передняя
// грань, пол виден сверху. Всё рисуется один раз в канву и лежит в кеше;
// кадр собирает из готовых картинок `dungeon-render.ts`.
//
// Герой собирается СЛОЯМИ: тело, сапоги, роба, каска, оружие. Комплект —
// это палитра и узор (`SETS` в `dungeon.ts`), поэтому каска, роба, сапоги и
// клинок одного комплекта нарисованы одной рукой и читаются как набор.

import { SETS, setOf } from './dungeon';
import type { AreaId, Gear, MobId, SetMotif } from './dungeon';

export const TS = 16;

type RGBA = [number, number, number, number];

export function hex(h: string, a = 255): RGBA {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a];
}

export function mix(a: RGBA, b: RGBA, k: number): RGBA {
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
    Math.round(a[3] + (b[3] - a[3]) * k),
  ];
}

const BLACK: RGBA = [0, 0, 0, 255];
const WHITE: RGBA = [255, 255, 255, 255];
const INK: RGBA = hex('#150f0b');

/** Детерминированный ГСЧ для узоров — один рисунок на один ключ. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Пиксельный холст любого размера. */
export class Px {
  readonly w: number;
  readonly h: number;
  data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGBA | null): void {
    x = Math.round(x);
    y = Math.round(y);
    if (!c || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (c[3] >= 255) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    // Полупрозрачное — поверх того, что есть.
    const a = c[3] / 255;
    const da = this.data[i + 3] / 255;
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++)
      this.data[i + k] = (c[k] * a + this.data[i + k] * da * (1 - a)) / oa;
    this.data[i + 3] = oa * 255;
  }
  get(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  solid(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.data[(y * this.w + x) * 4 + 3] > 0;
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGBA | null): void {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c);
  }
  ell(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    c: RGBA | ((x: number, y: number) => RGBA),
  ): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, typeof c === 'function' ? c(x, y) : c);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  /** Буквенная карта: буква — цвет палитры, точка — пусто. */
  map(rows: string[], pal: Record<string, RGBA | null>, ox = 0, oy = 0, flip = false): void {
    for (let y = 0; y < rows.length; y++) {
      const r = rows[y];
      for (let x = 0; x < r.length; x++) {
        const ch = r[x];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c === undefined) continue;
        this.set(ox + (flip ? r.length - 1 - x : x), oy + y, c);
      }
    }
  }
  /** Контур снаружи фигуры. */
  outline(c: RGBA, diag = false): void {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.solid(x, y)) continue;
        const n =
          this.solid(x - 1, y) ||
          this.solid(x + 1, y) ||
          this.solid(x, y - 1) ||
          this.solid(x, y + 1) ||
          (diag &&
            (this.solid(x - 1, y - 1) ||
              this.solid(x + 1, y - 1) ||
              this.solid(x - 1, y + 1) ||
              this.solid(x + 1, y + 1)));
        if (n) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
  }
  flipX(): Px {
    const o = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const j = (y * this.w + (this.w - 1 - x)) * 4;
        for (let k = 0; k < 4; k++) o.data[j + k] = this.data[i + k];
      }
    return o;
  }
  /** Перекрасить всё непрозрачное к цвету: вспышка удара. */
  tint(c: RGBA, k: number): Px {
    const o = new Px(this.w, this.h);
    for (let i = 0; i < this.data.length; i += 4) {
      if (!this.data[i + 3]) continue;
      o.data[i] = this.data[i] + (c[0] - this.data[i]) * k;
      o.data[i + 1] = this.data[i + 1] + (c[1] - this.data[i + 1]) * k;
      o.data[i + 2] = this.data[i + 2] + (c[2] - this.data[i + 2]) * k;
      o.data[i + 3] = this.data[i + 3];
    }
    return o;
  }
  canvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    const g = c.getContext('2d');
    if (g) {
      const img = g.createImageData(this.w, this.h);
      img.data.set(this.data);
      g.putImageData(img, 0, 0);
    }
    return c;
  }
  url(): string {
    if (typeof document === 'undefined') return '';
    return this.canvas().toDataURL();
  }
}

const cache = new Map<string, HTMLCanvasElement>();
function cached(key: string, make: () => Px): HTMLCanvasElement {
  let c = cache.get(key);
  if (!c) {
    c = make().canvas();
    cache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// Плитки районов.
// ---------------------------------------------------------------------------

interface AreaPal {
  floor: RGBA;
  floorDark: RGBA;
  floorLight: RGBA;
  pebble: RGBA;
  top: RGBA;
  topLight: RGBA;
  front: RGBA;
  frontDark: RGBA;
  frontLight: RGBA;
  timber: RGBA;
  timberDark: RGBA;
}

const AREA_PAL: Partial<Record<AreaId, AreaPal>> = {
  mouth: {
    floor: hex('#57493d'),
    floorDark: hex('#3f342b'),
    floorLight: hex('#6c5c4d'),
    pebble: hex('#7e6e5e'),
    top: hex('#241d18'),
    topLight: hex('#352b23'),
    front: hex('#65554a'),
    frontDark: hex('#463a31'),
    frontLight: hex('#7d6b5c'),
    timber: hex('#7a5532'),
    timberDark: hex('#4a321c'),
  },
  haul: {
    floor: hex('#48443f'),
    floorDark: hex('#332f2c'),
    floorLight: hex('#5c5750'),
    pebble: hex('#6d675f'),
    top: hex('#1c1a19'),
    topLight: hex('#2b2826'),
    front: hex('#554f49'),
    frontDark: hex('#3a3531'),
    frontLight: hex('#6d665e'),
    timber: hex('#6a4a2c'),
    timberDark: hex('#3e2a18'),
  },
};

export const palOf = (area: AreaId): AreaPal => AREA_PAL[area] ?? AREA_PAL.mouth!;

/** Пол: плиты камня с трещинами и галькой. Четыре рисунка на район. */
export function floorTile(area: AreaId, v: number): HTMLCanvasElement {
  return cached(`floor:${area}:${v & 3}`, () => {
    const p = palOf(area);
    const px = new Px(TS, TS);
    const r = rng(0xf100 + (v & 3) * 977 + area.length * 13);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const t = r();
        px.set(x, y, t < 0.18 ? p.floorDark : t < 0.9 ? p.floor : p.floorLight);
      }
    // Швы плит: неровная сетка, у каждого рисунка своя.
    const sx = 5 + Math.floor(r() * 6);
    const sy = 4 + Math.floor(r() * 7);
    for (let y = 0; y < TS; y++) px.set(sx + (y > sy ? 1 : 0), y, mix(p.floorDark, BLACK, 0.2));
    for (let x = 0; x < TS; x++) px.set(x, sy, mix(p.floorDark, BLACK, 0.2));
    for (let x = 0; x < TS; x++) if (r() < 0.5) px.set(x, sy + 1, p.floorLight);
    // Галька и щебень.
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(r() * 15);
      const y = Math.floor(r() * 15);
      px.set(x, y, p.pebble);
      px.set(x + 1, y, mix(p.pebble, BLACK, 0.35));
      px.set(x, y + 1, mix(p.pebble, BLACK, 0.45));
    }
    if ((v & 3) === 2) {
      // Трещина по плите.
      let x = 2 + Math.floor(r() * 10);
      let y = 1;
      for (let i = 0; i < 9; i++) {
        px.set(x, y, mix(p.floorDark, BLACK, 0.45));
        y += 1;
        x += r() < 0.5 ? -1 : 1;
      }
    }
    return px;
  });
}

/** Рельсы поверх пола: шпалы и две нитки стали. */
export function railTile(area: AreaId, axis: 'v' | 'h'): HTMLCanvasElement {
  return cached(`rail:${area}:${axis}`, () => {
    const p = palOf(area);
    const px = new Px(TS, TS);
    const wood = mix(p.timber, BLACK, 0.2);
    const woodD = p.timberDark;
    const steel = hex('#8f969c');
    const steelD = hex('#4c5257');
    const steelL = hex('#cfd6db');
    for (let k = 0; k < 4; k++) {
      const a = k * 4 + 1;
      for (let s = 1; s < 15; s++) {
        const c = s === 1 || s === 14 ? woodD : wood;
        if (axis === 'v') {
          px.set(s, a, c);
          px.set(s, a + 1, woodD);
        } else {
          px.set(a, s, c);
          px.set(a + 1, s, woodD);
        }
      }
    }
    for (const rail of [4, 11]) {
      for (let s = 0; s < TS; s++) {
        if (axis === 'v') {
          px.set(rail - 1, s, steelD);
          px.set(rail, s, steel);
          px.set(rail + 1, s, s % 5 === 0 ? steelL : steel);
        } else {
          px.set(s, rail - 1, steelL);
          px.set(s, rail, steel);
          px.set(s, rail + 1, steelD);
        }
      }
    }
    return px;
  });
}

/** Лужа — тёмная вода с бликом свода. */
export function puddleTile(v: number): HTMLCanvasElement {
  return cached(`puddle:${v & 1}`, () => {
    const px = new Px(TS, TS);
    const water = hex('#1f2a30', 230);
    const edge = hex('#2e3b40', 200);
    const glint = hex('#9fb8c2', 220);
    px.ell(8, 8.5, 7.2 - (v & 1), 5.8, (x, y) => ((x + y) % 5 === 0 ? edge : water));
    px.line(4, 6, 7, 6, glint);
    px.set(9, 7, glint);
    px.set(11, 10, hex('#6f8a94', 200));
    return px;
  });
}

/** Решётка площадки клети. */
export function liftFloorTile(): HTMLCanvasElement {
  return cached('liftfloor', () => {
    const px = new Px(TS, TS);
    const base = hex('#3a3f44');
    const bar = hex('#6f777e');
    const hi = hex('#9aa3aa');
    const hole = hex('#15181b');
    px.rect(0, 0, 15, 15, base);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        if (x % 4 === 0 || y % 4 === 0) px.set(x, y, (x + y) % 8 === 0 ? hi : bar);
        else if ((x + y) % 2 === 0) px.set(x, y, hole);
      }
    return px;
  });
}

/**
 * Стена. `front` — видна передняя грань (за стеной на юг пол): верх — тёмная
 * шапка породы с каймой, низ — пласты камня. `side` — край, за которым пол
 * слева/справа: светлая кромка. Рисунки: 0 — порода, 1 — крепь (стойка с
 * верхняком), 2 — кабель, 3 — потёк воды.
 */
export function wallTile(
  area: AreaId,
  v: number,
  front: boolean,
  edgeL: boolean,
  edgeR: boolean,
): HTMLCanvasElement {
  const kind = front ? v % 7 : 0;
  return cached(
    `wall:${area}:${v & 3}:${front ? kind : 'x'}:${edgeL ? 1 : 0}${edgeR ? 1 : 0}`,
    () => {
      const p = palOf(area);
      const px = new Px(TS, TS);
      const r = rng(0x3a11 + (v & 3) * 131 + (front ? kind : 9) * 7);
      const capH = front ? 5 : 16;
      // Шапка породы — сверху видна её макушка.
      for (let y = 0; y < capH; y++)
        for (let x = 0; x < TS; x++) {
          const t = r();
          px.set(x, y, t < 0.12 ? p.topLight : t < 0.2 ? mix(p.top, BLACK, 0.3) : p.top);
        }
      if (front) {
        // Кайма шапки и пласты передней грани.
        for (let x = 0; x < TS; x++) {
          px.set(x, 4, p.topLight);
          px.set(x, 5, mix(p.frontLight, WHITE, 0.08));
        }
        for (let y = 6; y < TS; y++)
          for (let x = 0; x < TS; x++) {
            const band = Math.floor((y + (x > 7 ? 1 : 0)) / 3) % 2 === 0;
            const t = r();
            let c = band ? p.front : mix(p.front, p.frontDark, 0.45);
            if (t < 0.1) c = p.frontDark;
            else if (t > 0.94) c = p.frontLight;
            px.set(x, y, c);
          }
        // Трещины и сколы.
        for (let i = 0; i < 2; i++) {
          let x = 1 + Math.floor(r() * 13);
          let y = 6 + Math.floor(r() * 4);
          for (let k = 0; k < 4; k++) {
            px.set(x, y, p.frontDark);
            y += 1;
            x += r() < 0.5 ? 0 : r() < 0.5 ? -1 : 1;
          }
        }
        // Низ грани темнее — там, где стена уходит в пол.
        for (let x = 0; x < TS; x++) px.set(x, 15, mix(p.frontDark, BLACK, 0.4));
        if (kind === 1 || kind === 4) {
          // Крепь: стойка и верхняк.
          const wx = kind === 1 ? 2 : 11;
          px.rect(wx, 6, wx + 2, 15, p.timber);
          px.rect(wx + 2, 6, wx + 2, 15, p.timberDark);
          px.set(wx, 6, mix(p.timber, WHITE, 0.2));
          px.rect(0, 5, 15, 6, p.timber);
          px.rect(0, 7, 15, 7, p.timberDark);
          px.set(wx + 1, 9, hex('#a0a4a8'));
        } else if (kind === 2) {
          // Кабель в скобах.
          for (let x = 0; x < TS; x++) px.set(x, 8 + (x > 7 && x < 12 ? 1 : 0), hex('#1b1b1f'));
          px.set(3, 7, hex('#8c9196'));
          px.set(12, 8, hex('#8c9196'));
        } else if (kind === 3) {
          // Потёк воды и минеральный налёт.
          for (let y = 6; y < TS; y++) px.set(9 + ((y >> 2) & 1), y, hex('#3f4a4c'));
          px.set(9, 15, hex('#6f8890'));
          px.set(8, 12, hex('#c9c2a8', 180));
        }
      }
      if (edgeL) for (let y = 0; y < capH; y++) px.set(0, y, p.topLight);
      if (edgeR) for (let y = 0; y < capH; y++) px.set(15, y, p.topLight);
      return px;
    },
  );
}

/** Треснувшая стена: грань в сетке трещин, у подножия крошка. */
export function crackWallTile(area: AreaId, hits: number): HTMLCanvasElement {
  return cached(`crack:${area}:${Math.min(2, hits)}`, () => {
    const p = palOf(area);
    const px = new Px(TS, TS);
    const base = wallTile(area, 0, true, false, false);
    const g = base.getContext('2d')!;
    const d = g.getImageData(0, 0, TS, TS).data;
    px.data.set(d);
    const ink = mix(p.frontDark, BLACK, 0.6);
    const lip = p.frontLight;
    const paths = [
      [
        [7, 6],
        [6, 8],
        [8, 10],
        [7, 13],
        [9, 15],
      ],
      [
        [8, 10],
        [11, 11],
        [13, 14],
      ],
      [
        [6, 8],
        [3, 10],
        [2, 13],
      ],
    ];
    const n = 1 + Math.min(2, hits);
    for (let k = 0; k < n; k++) {
      const path = paths[k];
      for (let i = 0; i < path.length - 1; i++) {
        px.line(path[i][0] + 1, path[i][1], path[i + 1][0] + 1, path[i + 1][1], lip);
        px.line(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], ink);
      }
    }
    return px;
  });
}

/** Завал: камни и сломанная крепь, дальше не пройти. */
export function rubbleTile(area: AreaId, v: number): HTMLCanvasElement {
  return cached(`rubble:${area}:${v & 1}`, () => {
    const p = palOf(area);
    const px = new Px(TS, TS);
    const r = rng(0xbb1 + (v & 1));
    px.rect(0, 0, 15, 15, p.floorDark);
    for (let i = 0; i < 9; i++) {
      const cx = 1 + r() * 14;
      const cy = 2 + r() * 12;
      const rr = 2 + r() * 2.4;
      const shade = r();
      px.ell(cx, cy, rr, rr * 0.8, (x, y) =>
        y < cy - rr * 0.2 ? p.frontLight : shade > 0.5 ? p.front : p.frontDark,
      );
    }
    px.line(1, 12, 14, 5, p.timber);
    px.line(1, 13, 14, 6, p.timberDark);
    return px;
  });
}

/** Нора на грани стены: тёмная дыра с земляной кромкой. */
export function burrowFront(): HTMLCanvasElement {
  return cached('burrowF', () => {
    const px = new Px(TS, TS);
    const dirt = hex('#6b5440');
    const dirtD = hex('#45352a');
    px.ell(8, 12.5, 5.2, 3.8, dirt);
    px.ell(8, 12.8, 4.2, 3, dirtD);
    px.ell(8, 13.2, 3.2, 2.4, hex('#0c0907'));
    px.set(6, 12, hex('#1f1712'));
    // Рассыпанная земля у норы.
    px.set(3, 15, dirt);
    px.set(12, 15, dirt);
    px.set(13, 14, dirtD);
    return px;
  });
}

/** Нора в боковой стене: полумесяц тьмы у самого пола. */
export function burrowSide(right: boolean): HTMLCanvasElement {
  return cached(`burrowS:${right ? 1 : 0}`, () => {
    const px = new Px(TS, TS);
    const dirt = hex('#6b5440');
    px.ell(right ? 16 : 0, 9, 5, 5.5, dirt);
    px.ell(right ? 16 : 0, 9, 3.6, 4.2, hex('#0c0907'));
    return px;
  });
}

/** Лампа на грани стены: клетка-кожух и колба. */
export function wallLamp(lit: boolean): HTMLCanvasElement {
  return cached(`wlamp:${lit ? 1 : 0}`, () => {
    const px = new Px(TS, TS);
    const metal = hex('#5a5f64');
    const metalD = hex('#2c2f33');
    const glass = lit ? hex('#fff2c2') : hex('#3c3a33');
    const glow = lit ? hex('#ffd27a') : hex('#2a2822');
    px.rect(7, 5, 8, 6, metalD);
    px.rect(5, 7, 10, 12, metal);
    px.rect(6, 8, 9, 11, glow);
    px.rect(7, 8, 8, 10, glass);
    for (const x of [5, 10]) px.rect(x, 7, x, 12, metalD);
    px.rect(5, 13, 10, 13, metalD);
    return px;
  });
}

/** Вход в подземную шахту: деревянная рама на грани, внутри темнота. */
export function minePortal(): HTMLCanvasElement {
  return cached('mineportal', () => {
    const px = new Px(TS * 3, TS);
    const wood = hex('#7a5532');
    const woodD = hex('#4a321c');
    const woodL = hex('#a07448');
    px.rect(8, 5, 39, 15, hex('#0b0907'));
    px.rect(10, 7, 37, 15, hex('#050404'));
    // Стойки и верхняк.
    px.rect(5, 3, 8, 15, wood);
    px.rect(39, 3, 42, 15, wood);
    px.rect(8, 3, 8, 15, woodD);
    px.rect(42, 3, 42, 15, woodD);
    px.rect(3, 1, 44, 4, wood);
    px.rect(3, 1, 44, 1, woodL);
    px.rect(3, 4, 44, 4, woodD);
    // Рельсы уходят внутрь.
    px.line(20, 15, 22, 9, hex('#6f777e'));
    px.line(27, 15, 25, 9, hex('#6f777e'));
    // Табличка.
    px.rect(18, 5, 29, 8, hex('#c9b27a'));
    px.rect(19, 6, 28, 7, hex('#8a6a44'));
    return px;
  });
}

/** Доска объявлений на грани стены. */
export function boardTile(): HTMLCanvasElement {
  return cached('board', () => {
    const px = new Px(TS, TS);
    const wood = hex('#6f4c2c');
    px.rect(1, 5, 14, 14, wood);
    px.rect(1, 5, 14, 5, hex('#8e6640'));
    px.rect(1, 14, 14, 14, hex('#3e2a18'));
    const paper = hex('#e6dcc2');
    px.rect(3, 7, 6, 11, paper);
    px.rect(8, 6, 12, 9, hex('#d8cfb4'));
    px.rect(9, 10, 12, 13, paper);
    px.line(4, 8, 5, 8, hex('#6d6352'));
    px.line(4, 10, 5, 10, hex('#6d6352'));
    px.line(9, 7, 11, 7, hex('#a0322a'));
    px.set(4, 6, hex('#b22'));
    px.set(10, 5, hex('#b22'));
    return px;
  });
}

/** Решётка ходка: закрытая — прутья, открытая — отведённая к стене. */
export function grateTile(open: boolean): HTMLCanvasElement {
  return cached(`grate:${open ? 1 : 0}`, () => {
    const px = new Px(TS, TS);
    const bar = hex('#7a8288');
    const barD = hex('#3d4246');
    if (open) {
      for (let y = 0; y < TS; y += 3) px.rect(0, y, 2, y, bar);
      px.rect(0, 0, 0, 15, barD);
      return px;
    }
    for (let x = 1; x < TS; x += 3) {
      px.rect(x, 0, x, 15, bar);
      px.rect(x + 1, 0, x + 1, 15, barD);
    }
    px.rect(0, 2, 15, 3, barD);
    px.rect(0, 12, 15, 13, barD);
    px.set(7, 8, hex('#c9a64a'));
    return px;
  });
}

// ---------------------------------------------------------------------------
// Герой.
// ---------------------------------------------------------------------------

export type Dir = 'down' | 'up' | 'side';

export const HERO_W = 16;
export const HERO_H = 22;

const SKIN = hex('#e2b38a');
const SKIN_D = hex('#b8845c');
const EYE = hex('#231712');

interface Pose {
  /** Сдвиг тела вверх (дыхание, шаг). */
  bob: number;
  /** Подъём левой/правой ноги, пикселей. */
  lift: [number, number];
  /** Сбоку: вынос передней и задней ноги. */
  stride: number;
  /** Руки: 0 — вдоль тела, 1 — вперёд (удар). */
  arm: number;
  crouch: number;
}

const POSES: Record<string, Pose[]> = {
  idle: [
    { bob: 0, lift: [0, 0], stride: 0, arm: 0, crouch: 0 },
    { bob: 1, lift: [0, 0], stride: 0, arm: 0, crouch: 0 },
  ],
  walk: [
    { bob: 0, lift: [1, 0], stride: 2, arm: 0, crouch: 0 },
    { bob: 1, lift: [0, 0], stride: 0, arm: 0, crouch: 0 },
    { bob: 0, lift: [0, 1], stride: -2, arm: 0, crouch: 0 },
    { bob: 1, lift: [0, 0], stride: 0, arm: 0, crouch: 0 },
  ],
  attack: [
    { bob: 0, lift: [0, 0], stride: 1, arm: 1, crouch: 1 },
    { bob: 0, lift: [0, 0], stride: 2, arm: 1, crouch: 0 },
  ],
  dash: [{ bob: 0, lift: [1, 1], stride: 3, arm: 0, crouch: 3 }],
  dead: [{ bob: 0, lift: [0, 0], stride: 0, arm: 0, crouch: 0 }],
};

export type HeroAnim = keyof typeof POSES;

interface GearPal {
  base: RGBA;
  dark: RGBA;
  light: RGBA;
  trim: RGBA;
  glow: RGBA;
  motif: SetMotif;
  tier: number;
}

function gearPal(tier: number): GearPal {
  const s = setOf(tier);
  return {
    base: hex(s.base),
    dark: hex(s.dark),
    light: hex(s.light),
    trim: hex(s.trim),
    glow: hex(s.glow),
    motif: s.motif,
    tier,
  };
}

/** Узор комплекта на ткани/металле в точке — один на все вещи набора. */
function motifAt(g: GearPal, x: number, y: number, c: RGBA): RGBA {
  switch (g.motif) {
    case 'quilt':
      // Стёжка ватника: горизонтальные швы через ряд.
      return y % 3 === 0 ? g.dark : c;
    case 'canvas':
      return (x + y) % 4 === 0 ? mix(c, g.dark, 0.25) : c;
    case 'rivets':
      return x % 4 === 1 && y % 4 === 1 ? g.light : c;
    case 'chased':
      return (x + y) % 5 === 0 ? g.trim : c;
    case 'glass':
      return (x * 3 + y) % 7 === 0 ? g.glow : c;
    case 'sheen':
      return (x - y + 20) % 6 === 0 ? g.light : c;
    case 'stars':
      return (x * 5 + y * 3) % 11 === 0 ? g.trim : c;
    case 'aurora':
      return y % 4 === 0 ? mix(g.trim, g.glow, (x % 5) / 5) : c;
  }
}

/** Каска по ступени: ушанка, каска с фонарём, шлем. */
function drawHelm(px: Px, g: GearPal, dir: Dir, oy: number, flip: boolean): void {
  const y0 = oy;
  if (g.tier === 1) {
    // Ушанка: мех, опущенные уши, светлая оторочка.
    const fur = g.base;
    const furD = g.dark;
    const furL = g.light;
    if (dir === 'side') {
      px.rect(4, y0 + 1, 10, y0 + 4, fur);
      px.rect(5, y0 + 0, 9, y0 + 0, furD);
      px.rect(4, y0 + 4, 10, y0 + 4, furL);
      // Ухо ушанки — сзади головы.
      const ex = flip ? 10 : 4;
      px.rect(ex, y0 + 4, ex + 1, y0 + 7, furD);
      return;
    }
    px.rect(4, y0 + 1, 11, y0 + 4, fur);
    px.rect(5, y0 + 0, 10, y0 + 0, furD);
    for (let x = 4; x <= 11; x++) if ((x + y0) % 2 === 0) px.set(x, y0 + 2, furD);
    if (dir === 'down') px.rect(4, y0 + 4, 11, y0 + 4, furL);
    px.rect(3, y0 + 3, 3, y0 + 7, furD);
    px.rect(12, y0 + 3, 12, y0 + 7, furD);
    if (dir === 'down') {
      // Звёздочка кокарды без звезды — лагерь: пустое пятно от неё.
      px.set(7, y0 + 2, g.trim);
      px.set(8, y0 + 2, g.trim);
    }
    return;
  }
  if (g.tier === 2) {
    // Каска с фонарём.
    const shell = g.base;
    const shellD = g.dark;
    const shellL = g.light;
    if (dir === 'side') {
      px.rect(4, y0 + 1, 10, y0 + 4, shell);
      px.rect(5, y0 + 0, 9, y0 + 0, shellL);
      px.rect(3, y0 + 4, 11, y0 + 4, shellD);
      const lx = flip ? 3 : 11;
      px.rect(lx, y0 + 2, lx, y0 + 3, g.glow);
      return;
    }
    px.rect(4, y0 + 1, 11, y0 + 3, shell);
    px.rect(5, y0 + 0, 10, y0 + 0, shellL);
    px.rect(3, y0 + 4, 12, y0 + 4, shellD);
    px.rect(7, y0 + 0, 8, y0 + 3, shellD);
    if (dir === 'down') {
      px.rect(6, y0 + 1, 9, y0 + 3, hex('#2c2f33'));
      px.rect(7, y0 + 2, 8, y0 + 2, g.glow);
      px.set(7, y0 + 1, WHITE);
    }
    return;
  }
  // Шлем старших комплектов: купол, обод, наносник.
  const m = g.base;
  if (dir === 'side') {
    px.rect(4, y0, 10, y0 + 4, m);
    px.rect(4, y0 + 4, 10, y0 + 4, g.trim);
    const nx = flip ? 4 : 10;
    px.rect(nx, y0 + 4, nx, y0 + 6, g.dark);
  } else {
    px.rect(4, y0, 11, y0 + 4, m);
    px.rect(4, y0 + 4, 11, y0 + 4, g.trim);
    if (dir === 'down') px.rect(7, y0 + 4, 8, y0 + 7, g.dark);
  }
  for (let y = y0; y <= y0 + 3; y++)
    for (let x = 4; x <= 11; x++) px.set(x, y, motifAt(g, x, y, px.get(x, y)));
  px.set(6, y0 + 1, g.light);
}

function paintHero(gear: Gear, dir: Dir, anim: HeroAnim, frame: number, flip: boolean): Px {
  const px = new Px(HERO_W, HERO_H);
  const pose = POSES[anim][frame % POSES[anim].length];
  const helm = gearPal(gear.helm.tier);
  const robe = gearPal(gear.robe.tier);
  const boots = gearPal(gear.boots.tier);
  const pants = mix(robe.dark, BLACK, 0.3);
  const pantsL = mix(robe.dark, robe.base, 0.3);
  const bootC = mix(boots.dark, BLACK, 0.45);
  const bootL = mix(boots.dark, boots.light, 0.35);
  const yb = pose.crouch; // приседание сдвигает всё, кроме ног
  const top = 1 + pose.bob + yb;

  if (anim === 'dead') {
    // Лежит на спине: фигура поперёк.
    const p2 = new Px(HERO_W, HERO_H);
    p2.rect(1, 15, 14, 19, robe.base);
    p2.rect(1, 18, 14, 19, robe.dark);
    p2.rect(12, 14, 15, 18, SKIN);
    p2.rect(0, 15, 1, 19, bootC);
    p2.rect(13, 13, 15, 14, helm.base);
    p2.outline(INK);
    return p2;
  }

  // Ноги и сапоги.
  if (dir === 'side') {
    const s = pose.stride;
    // Задняя нога темнее и рисуется первой; шаг разводит ноги.
    const legs: [number, number][] = [
      [Math.round(6 - s / 2), 1],
      [Math.round(7 + s / 2), 0],
    ];
    for (const [lx, back] of legs) {
      const c = back ? mix(pants, BLACK, 0.2) : pants;
      px.rect(lx, 15, lx + 2, 18, c);
      px.rect(lx, 18, lx + 2, 21, back ? mix(bootC, BLACK, 0.2) : bootC);
      px.set(lx + (flip ? 0 : 3), 21, bootC);
      px.set(lx + 1, 18, bootL);
    }
  } else {
    for (const [i, lx] of [
      [0, 5],
      [1, 8],
    ] as const) {
      const up = pose.lift[i];
      px.rect(lx, 15 + yb, lx + 2, 18 - up, i ? pantsL : pants);
      px.rect(lx, 18 - up, lx + 2, 21 - up, bootC);
      px.rect(lx, 18 - up, lx + 2, 18 - up, bootL);
      px.set(i ? lx + 3 : lx - 1, 21 - up, bootC);
    }
  }

  // Туловище и руки.
  const tx0 = dir === 'side' ? 5 : 4;
  const tx1 = dir === 'side' ? 10 : 11;
  for (let y = top + 8; y <= top + 14; y++)
    for (let x = tx0; x <= tx1; x++) {
      let c = x === tx0 ? robe.dark : x === tx1 ? mix(robe.base, robe.dark, 0.4) : robe.base;
      c = motifAt(robe, x, y, c);
      px.set(x, y, c);
    }
  // Ремень.
  px.rect(tx0, top + 13, tx1, top + 13, hex('#2a1c12'));
  px.set(dir === 'side' ? (flip ? 6 : 9) : 7, top + 13, hex('#c9a64a'));
  // Воротник.
  px.rect(
    tx0 + 1,
    top + 8,
    tx1 - 1,
    top + 8,
    robe.tier === 1 ? mix(robe.trim, BLACK, 0.2) : robe.trim,
  );
  // Светоотражающая полоса брезента.
  if (robe.motif === 'canvas') px.rect(tx0, top + 11, tx1, top + 11, robe.trim);

  // Руки.
  if (dir === 'side') {
    const ax = pose.arm ? (flip ? 3 : 10) : 7;
    const ay = pose.arm ? top + 10 : top + 9;
    px.rect(ax, ay, ax + 1, ay + 4, mix(robe.base, robe.dark, 0.3));
    px.rect(ax, ay + 5, ax + 1, ay + 5, SKIN);
  } else {
    for (const ax of [2, 12]) {
      px.rect(ax, top + 9, ax + 1, top + 13, mix(robe.base, robe.dark, ax === 2 ? 0.45 : 0.2));
      if (robe.motif === 'canvas') px.rect(ax, top + 11, ax + 1, top + 11, robe.trim);
      px.rect(ax, top + 14, ax + 1, top + 14, SKIN);
    }
  }

  // Голова.
  const hx0 = dir === 'side' ? 5 : 5;
  const hx1 = dir === 'side' ? 10 : 10;
  if (dir === 'up') {
    px.rect(hx0, top + 3, hx1, top + 7, mix(SKIN_D, BLACK, 0.2));
    px.rect(hx0, top + 3, hx1, top + 5, hex('#3a2a20'));
  } else {
    px.rect(hx0, top + 3, hx1, top + 7, SKIN);
    px.rect(hx0, top + 7, hx1, top + 7, SKIN_D);
    if (dir === 'down') {
      px.set(6, top + 5, EYE);
      px.set(9, top + 5, EYE);
      px.set(7, top + 7, mix(SKIN_D, BLACK, 0.15));
      px.set(8, top + 7, mix(SKIN_D, BLACK, 0.15));
    } else {
      px.set(flip ? 6 : 9, top + 5, EYE);
      px.set(flip ? 4 : 11, top + 6, SKIN);
    }
  }
  drawHelm(px, helm, dir, top, flip);
  px.outline(INK);
  return flip ? px.flipX() : px;
}

/** Кадр героя: слои по комплектам, кеш по снаряжению и кадру. */
export function heroFrame(
  gear: Gear,
  dir: Dir,
  anim: HeroAnim,
  frame: number,
  left: boolean,
): HTMLCanvasElement {
  const n = POSES[anim].length;
  // Отрицательный или дробный кадр (часы на первом кадре) — не повод падать.
  const f = ((Math.floor(frame) % n) + n) % n || 0;
  const key = `hero:${gear.helm.tier}${gear.robe.tier}${gear.boots.tier}:${dir}:${anim}:${f}:${left ? 1 : 0}`;
  return cached(key, () => {
    // Слева — зеркало профиля; фронт и спина симметричны.
    const p = paintHero(gear, dir, anim, f, false);
    return left && dir === 'side' ? p.flipX() : p;
  });
}

export const heroFrames = (anim: HeroAnim) => POSES[anim].length;

/** Белый силуэт героя — кадр вспышки при попадании. */
export function heroFlash(
  gear: Gear,
  dir: Dir,
  anim: HeroAnim,
  frame: number,
  left: boolean,
): HTMLCanvasElement {
  const n = POSES[anim].length;
  const f = ((Math.floor(frame) % n) + n) % n || 0;
  const key = `heroF:${gear.helm.tier}${gear.robe.tier}${gear.boots.tier}:${dir}:${anim}:${f}:${left ? 1 : 0}`;
  return cached(key, () => {
    const p = paintHero(gear, dir, anim, f, false);
    return (left && dir === 'side' ? p.flipX() : p).tint(hex('#ffe6e0'), 0.85);
  });
}

// ---------------------------------------------------------------------------
// Оружие: клинок вдоль оси X, рукоять слева. Поворачивает рисовальщик.
// ---------------------------------------------------------------------------

export const WEAPON_GRIP = 2;

export function weaponArt(tier: number): HTMLCanvasElement {
  return cached(`weapon:${tier}`, () => {
    const g = gearPal(tier);
    if (tier === 1) {
      // Тесак из рессоры: обмотка, короткая гарда, кривое полотно.
      const px = new Px(15, 5);
      px.rect(0, 2, 3, 2, hex('#5a3a22'));
      px.set(1, 2, hex('#8a6040'));
      px.set(3, 2, hex('#8a6040'));
      px.rect(4, 1, 4, 3, hex('#3c3a36'));
      px.rect(5, 1, 12, 2, hex('#9aa0a4'));
      px.rect(5, 3, 11, 3, hex('#6c7278'));
      px.set(13, 2, hex('#9aa0a4'));
      px.set(13, 1, hex('#c9d0d4'));
      px.set(14, 1, hex('#c9d0d4'));
      px.line(6, 1, 11, 1, hex('#dfe6ea'));
      px.outline(INK);
      return px;
    }
    // Палаш и старшие клинки: гарда цвета отделки комплекта.
    const len = 15 + Math.min(4, tier);
    const px = new Px(len + 3, 5);
    px.rect(0, 2, 3, 2, hex('#3e2a18'));
    px.set(1, 2, g.trim);
    px.rect(4, 0, 4, 4, g.trim);
    px.rect(5, 1, len, 3, tier === 2 ? hex('#b8c0c6') : g.light);
    px.rect(5, 3, len, 3, tier === 2 ? hex('#7a8288') : g.dark);
    px.line(6, 2, len - 2, 2, tier === 2 ? hex('#8e969c') : g.base);
    px.line(6, 1, len - 1, 1, WHITE);
    px.set(len + 1, 2, tier === 2 ? hex('#b8c0c6') : g.light);
    if (g.motif === 'glass' || g.motif === 'stars' || g.motif === 'aurora')
      for (let x = 7; x < len; x += 3) px.set(x, 2, g.glow);
    px.outline(INK);
    return px;
  });
}

// ---------------------------------------------------------------------------
// Крысы. Вид сбоку, мордой вправо; влево — зеркало.
// ---------------------------------------------------------------------------

export type MobLook = 'normal' | 'elite' | 'albino';
export type MobAnim = 'run0' | 'run1' | 'wind' | 'bite' | 'dead' | 'sleep';

interface RatPal {
  fur: RGBA;
  dark: RGBA;
  belly: RGBA;
  tail: RGBA;
  ear: RGBA;
  eye: RGBA;
}

function ratPal(kind: MobId, look: MobLook): RatPal {
  if (look === 'albino')
    return {
      fur: hex('#ebe4de'),
      dark: hex('#b3a79f'),
      belly: hex('#ffffff'),
      tail: hex('#e6a8a0'),
      ear: hex('#f0b8b0'),
      eye: hex('#d8323a'),
    };
  if (kind === 'goldrat')
    return {
      fur: hex('#d8a83a'),
      dark: hex('#8a6418'),
      belly: hex('#f6dc86'),
      tail: hex('#c98f56'),
      ear: hex('#f2c070'),
      eye: hex('#2a1606'),
    };
  if (kind === 'fatrat')
    return {
      fur: hex('#7a6852'),
      dark: hex('#4a3e30'),
      belly: hex('#a8987e'),
      tail: hex('#c48e82'),
      ear: hex('#d7a095'),
      eye: hex('#120c08'),
    };
  if (kind === 'bomber')
    return {
      fur: hex('#5a524c'),
      dark: hex('#34302c'),
      belly: hex('#857a70'),
      tail: hex('#bf8a80'),
      ear: hex('#cf9a92'),
      eye: hex('#ffb040'),
    };
  return {
    fur: hex('#6b6158'),
    dark: hex('#3d3630'),
    belly: hex('#978b80'),
    tail: hex('#c68d84'),
    ear: hex('#d49c95'),
    eye: hex('#140e0a'),
  };
}

function paintRat(kind: MobId, look: MobLook, anim: MobAnim): Px {
  const fat = kind === 'fatrat';
  const W = fat ? 20 : 16;
  const H = fat ? 13 : 11;
  const px = new Px(W, H);
  const c = ratPal(kind, look);
  const dead = anim === 'dead';
  const low = anim === 'wind' ? 1 : 0;
  const reach = anim === 'bite' ? 1 : 0;
  // Тело — овал с тенью снизу и светлым брюхом.
  const bx = fat ? 8 : 6.5;
  const by = (fat ? 7 : 6.2) + low;
  const rx = fat ? 6.4 : 4.6;
  const ry = fat ? 3.9 : 2.7;
  const body = (x: number, y: number) => {
    if (y > by + ry * 0.35) return c.belly;
    if (y < by - ry * 0.45) return mix(c.fur, WHITE, 0.08);
    return (x + y) % 5 === 0 ? c.dark : c.fur;
  };
  px.ell(bx, by, rx, ry, body);
  // Голова, вытянутая морда.
  const hx = bx + rx - 0.6 + reach;
  const hy = by - 0.8 + (anim === 'wind' ? 0.8 : 0);
  px.ell(hx, hy, fat ? 3 : 2.6, fat ? 2.4 : 2, c.fur);
  px.line(
    Math.round(hx + 1),
    Math.round(hy + 0.5),
    Math.round(hx + (fat ? 3 : 2.6)),
    Math.round(hy + 0.8),
    c.fur,
  );
  px.set(Math.round(hx + (fat ? 3.4 : 3)), Math.round(hy + 0.8), hex('#e7a0a0'));
  // Ухо.
  px.ell(hx - 0.8, hy - (fat ? 2.3 : 1.9), 1.3, 1.2, c.dark);
  px.set(Math.round(hx - 0.8), Math.round(hy - (fat ? 2.3 : 1.9)), c.ear);
  // Глаз с бликом.
  px.set(Math.round(hx + 0.6), Math.round(hy - 0.6), c.eye);
  if (look !== 'albino') px.set(Math.round(hx + 0.6), Math.round(hy - 1.2), hex('#ffffff', 180));
  // Укус: открытая пасть и зубы.
  if (anim === 'bite') {
    px.set(Math.round(hx + 2), Math.round(hy + 1.6), hex('#7a1818'));
    px.set(Math.round(hx + 2.6), Math.round(hy + 1.5), WHITE);
  }
  // Хвост — розовая дуга назад.
  const tx = bx - rx;
  for (let i = 0; i < (fat ? 7 : 6); i++) {
    const x = tx - i * 0.9;
    const y = by + 0.4 - Math.sin(i * 0.55) * 2.2;
    px.set(x, y, c.tail);
  }
  // Лапы: бег — попеременно.
  const legY = Math.min(H - 1, Math.round(by + ry - 0.2));
  const phase = anim === 'run1' ? 1 : 0;
  const legs = fat ? [bx - 3.5, bx - 1.5, bx + 2, bx + 4] : [bx - 2.5, bx - 1, bx + 1.5, bx + 3];
  legs.forEach((lx, i) => {
    const shift = (i + phase) % 2 === 0 ? -0.6 : 0.6;
    px.set(lx + (anim.startsWith('run') ? shift : 0), legY, c.dark);
    px.set(lx + (anim.startsWith('run') ? shift : 0), legY - 1, c.dark);
  });
  // Подрывник: шашка на спине, фитиль.
  if (kind === 'bomber') {
    px.rect(
      Math.round(bx - 2),
      Math.round(by - ry - 1),
      Math.round(bx + 2),
      Math.round(by - ry),
      hex('#b8322a'),
    );
    px.rect(
      Math.round(bx - 2),
      Math.round(by - ry),
      Math.round(bx + 2),
      Math.round(by - ry),
      hex('#7a1c16'),
    );
    px.set(Math.round(bx - 3), Math.round(by - ry - 1), hex('#d8c098'));
    px.set(Math.round(bx - 4), Math.round(by - ry - 2), hex('#ffd24a'));
  }
  if (kind === 'goldrat') {
    px.set(Math.round(bx - 1), Math.round(by - 1), hex('#fff8d0'));
    px.set(Math.round(bx + 2), Math.round(by), hex('#fff8d0'));
  }
  if (anim === 'sleep') {
    // Спит клубком: морда поджата, глаз закрыт.
    px.set(Math.round(hx + 0.6), Math.round(hy - 0.6), c.dark);
  }
  px.outline(look === 'elite' ? hex('#ffcc40') : INK);
  if (dead) {
    // Перевернулась на спину: зеркало по вертикали, лапы кверху.
    const o = new Px(W, H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = ((H - 1 - y) * W + x) * 4;
        const j = (y * W + x) * 4;
        for (let k = 0; k < 4; k++) o.data[j + k] = px.data[i + k];
      }
    return o;
  }
  return px;
}

/** Крыса короля — клубок тел со сплетёнными хвостами и короной. */
function paintKing(small: boolean, anim: MobAnim): Px {
  const W = small ? 22 : 34;
  const H = small ? 18 : 28;
  const px = new Px(W, H);
  const c = ratPal('rat', 'normal');
  const cx = W / 2;
  const cy = H / 2 + (small ? 1 : 2);
  const r = small ? 6.5 : 10;
  const fur = mix(c.fur, hex('#3a2a20'), 0.25);
  px.ell(cx, cy, r, r * 0.78, (x, y) =>
    (x * 3 + y * 5) % 7 === 0 ? c.dark : y > cy + r * 0.35 ? c.belly : fur,
  );
  // Головы наружу по кругу.
  const heads = small ? 3 : 6;
  for (let i = 0; i < heads; i++) {
    const a = (i / heads) * Math.PI * 2 + (anim === 'run1' ? 0.18 : 0) + 0.4;
    const hx = cx + Math.cos(a) * r * 0.95;
    const hy = cy + Math.sin(a) * r * 0.72;
    px.ell(hx, hy, 2.4, 1.9, c.fur);
    px.set(hx + Math.cos(a) * 1.8, hy + Math.sin(a) * 1.4, hex('#e7a0a0'));
    px.set(
      hx + Math.cos(a - 0.7) * 1.1,
      hy + Math.sin(a - 0.7) * 1 - 0.5,
      anim === 'wind' ? hex('#ff4040') : c.eye,
    );
    px.set(hx - Math.cos(a) * 0.4, hy - 1.8, c.ear);
  }
  // Узел хвостов в центре.
  for (let i = 0; i < (small ? 8 : 16); i++) {
    const a = i * 1.7;
    px.set(cx + Math.cos(a) * (1 + (i % 3)), cy + Math.sin(a) * (1 + (i % 3)) * 0.8, c.tail);
  }
  // Корона.
  const gold = hex('#e8b830');
  const goldD = hex('#9a7018');
  const top = cy - r * 0.78 - (small ? 3 : 5);
  const cw = small ? 3 : 5;
  px.rect(
    Math.round(cx - cw),
    Math.round(top + (small ? 2 : 3)),
    Math.round(cx + cw),
    Math.round(top + (small ? 3 : 5)),
    gold,
  );
  for (let k = -cw; k <= cw; k += small ? 3 : 2.5)
    px.rect(Math.round(cx + k), Math.round(top), Math.round(cx + k), Math.round(top + 2), gold);
  px.rect(
    Math.round(cx - cw),
    Math.round(top + (small ? 3 : 5)),
    Math.round(cx + cw),
    Math.round(top + (small ? 3 : 5)),
    goldD,
  );
  px.set(Math.round(cx), Math.round(top + (small ? 2 : 3)), hex('#d82040'));
  px.outline(anim === 'wind' ? hex('#ff5030') : INK);
  return px;
}

export function mobArt(
  kind: MobId,
  look: MobLook,
  anim: MobAnim,
  left: boolean,
  flash = false,
): HTMLCanvasElement {
  return cached(`mob:${kind}:${look}:${anim}:${left ? 1 : 0}:${flash ? 1 : 0}`, () => {
    let p =
      kind === 'king'
        ? paintKing(false, anim)
        : kind === 'kinglet'
          ? paintKing(true, anim)
          : paintRat(kind, look, anim);
    if (left) p = p.flipX();
    if (flash) p = p.tint(WHITE, 0.9);
    return p;
  });
}

// ---------------------------------------------------------------------------
// Предметы мира.
// ---------------------------------------------------------------------------

export type PropArt =
  | 'crate'
  | 'barrel'
  | 'powder'
  | 'nest'
  | 'cartnest'
  | 'cart'
  | 'pillar'
  | 'lantern'
  | 'unlit'
  | 'plaque'
  | 'chest'
  | 'chestOpen'
  | 'gate'
  | 'liftFrame'
  | 'bomb';

function plankBox(px: Px, x0: number, y0: number, w: number, h: number, top: number): void {
  const wood = hex('#8a6038');
  const woodL = hex('#b0804e');
  const woodD = hex('#5a3a1e');
  const nail = hex('#2a2420');
  // Верхняя грань.
  px.rect(x0, y0, x0 + w - 1, y0 + top - 1, woodL);
  for (let x = x0; x < x0 + w; x += 4) px.rect(x, y0, x, y0 + top - 1, mix(woodL, woodD, 0.4));
  // Передняя грань.
  px.rect(x0, y0 + top, x0 + w - 1, y0 + h - 1, wood);
  for (let y = y0 + top + 3; y < y0 + h; y += 4) px.rect(x0, y, x0 + w - 1, y, woodD);
  px.line(x0 + 1, y0 + top + 1, x0 + w - 2, y0 + h - 2, woodD);
  px.set(x0 + 1, y0 + top + 1, nail);
  px.set(x0 + w - 2, y0 + top + 1, nail);
  px.set(x0 + 1, y0 + h - 2, nail);
  px.set(x0 + w - 2, y0 + h - 2, nail);
}

export function propArt(kind: PropArt, flash = false): HTMLCanvasElement {
  return cached(`prop:${kind}:${flash ? 1 : 0}`, () => {
    let px: Px;
    switch (kind) {
      case 'crate':
        px = new Px(14, 15);
        plankBox(px, 0, 0, 14, 15, 5);
        break;
      case 'barrel':
      case 'powder': {
        px = new Px(12, 15);
        const body = kind === 'powder' ? hex('#a8322a') : hex('#7e5a36');
        const dark = kind === 'powder' ? hex('#6a1a14') : hex('#4e3620');
        const light = kind === 'powder' ? hex('#d05a48') : hex('#a67a4c');
        px.ell(6, 3, 5.6, 2.6, light);
        px.rect(0, 3, 11, 13, body);
        px.ell(6, 13, 5.6, 1.8, body);
        px.rect(0, 3, 1, 13, dark);
        px.rect(3, 3, 3, 13, light);
        for (const y of [5, 11]) px.rect(0, y, 11, y, hex('#3a3632'));
        if (kind === 'powder') {
          px.rect(4, 7, 7, 9, hex('#f0e6c8'));
          px.set(5, 8, hex('#1a1a1a'));
          px.set(6, 8, hex('#1a1a1a'));
        }
        break;
      }
      case 'nest': {
        px = new Px(18, 11);
        const straw = hex('#a88a4a');
        const strawD = hex('#6a5428');
        const rag = hex('#7a7266');
        px.ell(9, 6.5, 8.4, 4.2, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? strawD : straw));
        px.ell(9, 7, 3.4, 2, hex('#1a120c'));
        px.rect(2, 4, 5, 5, rag);
        px.rect(12, 7, 15, 8, rag);
        px.set(8, 7, hex('#ff5a3a'));
        px.set(10, 7, hex('#ff5a3a'));
        for (let i = 0; i < 6; i++) px.line(1 + i * 3, 3, 3 + i * 3, 1, strawD);
        break;
      }
      case 'cartnest': {
        px = new Px(18, 15);
        const metal = hex('#6a625a');
        const metalD = hex('#3c3632');
        // Перевёрнутая вагонетка на боку.
        px.rect(1, 3, 16, 12, metal);
        px.rect(1, 3, 16, 4, hex('#8a8178'));
        px.rect(1, 11, 16, 12, metalD);
        for (let x = 3; x < 16; x += 4) px.set(x, 7, hex('#2a2622'));
        px.ell(4, 13.5, 1.8, 1.4, hex('#222'));
        px.ell(13, 13.5, 1.8, 1.4, hex('#222'));
        px.ell(9, 8, 3.6, 2.4, hex('#150d08'));
        px.line(5, 12, 12, 13, hex('#a88a4a'));
        px.set(8, 8, hex('#ff5a3a'));
        px.set(10, 8, hex('#ff5a3a'));
        break;
      }
      case 'cart': {
        px = new Px(16, 15);
        const metal = hex('#7a6e62');
        const metalD = hex('#443c34');
        const rust = hex('#8e5a34');
        px.rect(1, 1, 14, 4, hex('#2c2622'));
        px.rect(1, 1, 14, 1, hex('#a09486'));
        px.rect(1, 5, 14, 12, metal);
        px.rect(1, 5, 1, 12, metalD);
        px.rect(14, 5, 14, 12, metalD);
        px.rect(1, 12, 14, 12, metalD);
        for (const x of [3, 12]) px.set(x, 7, hex('#cfc4b4'));
        px.set(6, 9, rust);
        px.set(9, 8, rust);
        px.ell(4, 13.5, 2, 1.5, hex('#1e1c1a'));
        px.ell(11.5, 13.5, 2, 1.5, hex('#1e1c1a'));
        // Руда в кузове.
        px.set(4, 2, hex('#d8b44a'));
        px.set(8, 3, hex('#6a6258'));
        px.set(11, 2, hex('#8a8278'));
        break;
      }
      case 'pillar': {
        px = new Px(10, 28);
        const wood = hex('#7a5532');
        const woodD = hex('#4a321c');
        const woodL = hex('#a07448');
        px.rect(3, 4, 6, 27, wood);
        px.rect(3, 4, 3, 27, woodL);
        px.rect(6, 4, 6, 27, woodD);
        px.rect(0, 0, 9, 4, wood);
        px.rect(0, 0, 9, 0, woodL);
        px.rect(0, 4, 9, 4, woodD);
        px.rect(3, 14, 6, 15, hex('#5c6166'));
        for (let y = 7; y < 26; y += 5) px.set(4, y, woodD);
        break;
      }
      case 'lantern':
      case 'unlit': {
        px = new Px(8, 16);
        const lit = kind === 'lantern';
        px.rect(3, 6, 4, 15, hex('#3a3632'));
        px.rect(1, 1, 6, 6, hex('#2c2f33'));
        px.rect(2, 2, 5, 5, lit ? hex('#ffd27a') : hex('#3c3a33'));
        if (lit) px.rect(3, 3, 4, 4, hex('#fff6d8'));
        px.rect(1, 0, 6, 0, hex('#5a5f64'));
        px.rect(2, 15, 5, 15, hex('#2a2622'));
        break;
      }
      case 'plaque': {
        px = new Px(14, 16);
        px.rect(6, 8, 7, 15, hex('#4a321c'));
        px.rect(0, 1, 13, 8, hex('#8a6a44'));
        px.rect(0, 1, 13, 1, hex('#b08a5a'));
        px.rect(0, 8, 13, 8, hex('#4a321c'));
        px.line(2, 3, 11, 3, hex('#2e2014'));
        px.line(2, 5, 9, 5, hex('#2e2014'));
        break;
      }
      case 'chest':
      case 'chestOpen': {
        px = new Px(14, 12);
        const wood = hex('#6a4424');
        const band = hex('#a8852e');
        px.rect(0, 4, 13, 11, wood);
        px.rect(0, 11, 13, 11, hex('#3e2612'));
        if (kind === 'chestOpen') {
          px.rect(0, 0, 13, 3, hex('#4a2e16'));
          px.rect(1, 4, 12, 5, hex('#1a100a'));
        } else {
          px.rect(0, 1, 13, 4, hex('#7e5430'));
          px.rect(0, 1, 13, 1, hex('#9a6c40'));
        }
        for (const x of [2, 11]) px.rect(x, 1, x, 11, band);
        px.rect(6, 5, 7, 7, hex('#f0d060'));
        break;
      }
      case 'gate': {
        px = new Px(16, 30);
        const bar = hex('#6a7278');
        const barL = hex('#a8b0b6');
        const barD = hex('#2e3236');
        for (let x = 2; x < 16; x += 4) {
          px.rect(x, 0, x + 1, 29, bar);
          px.rect(x, 0, x, 29, barL);
          px.set(x, 0, barD);
        }
        px.rect(0, 3, 15, 4, barD);
        px.rect(0, 20, 15, 21, barD);
        px.rect(0, 29, 15, 29, barD);
        break;
      }
      case 'liftFrame': {
        px = new Px(52, 60);
        const beam = hex('#5a6168');
        const beamL = hex('#8e979e');
        const beamD = hex('#2c3035');
        // Стойки.
        for (const x of [1, 47]) {
          px.rect(x, 8, x + 3, 59, beam);
          px.rect(x, 8, x, 59, beamL);
          px.rect(x + 3, 8, x + 3, 59, beamD);
          for (let y = 14; y < 58; y += 8) px.line(x, y, x + 3, y + 4, beamD);
        }
        // Верхняя балка и шкив.
        px.rect(0, 4, 51, 9, beam);
        px.rect(0, 4, 51, 4, beamL);
        px.rect(0, 9, 51, 9, beamD);
        px.ell(26, 4, 5, 4, hex('#3e444a'));
        px.ell(26, 4, 2, 1.6, hex('#8e979e'));
        // Тросы вниз.
        px.line(24, 8, 24, 30, hex('#9a9a90'));
        px.line(28, 8, 28, 30, hex('#9a9a90'));
        break;
      }
      case 'bomb': {
        px = new Px(8, 6);
        px.rect(0, 2, 6, 4, hex('#b8322a'));
        px.rect(0, 4, 6, 4, hex('#7a1c16'));
        px.rect(2, 2, 3, 4, hex('#e0d0a8'));
        px.set(7, 1, hex('#ffd24a'));
        px.set(6, 1, hex('#d8c098'));
        break;
      }
    }
    px.outline(INK);
    return flash ? px.tint(WHITE, 0.9) : px;
  });
}

// ---------------------------------------------------------------------------
// Добыча на полу.
// ---------------------------------------------------------------------------

export type ItemArt =
  | 'meat'
  | 'fatmeat'
  | 'skin'
  | 'tail'
  | 'pyrite'
  | 'crown'
  | 'coin'
  | 'token'
  | 'key';

export function itemArt(kind: ItemArt): HTMLCanvasElement {
  return cached(`item:${kind}`, () => itemPx(kind));
}

/** Картинки для разметки (data-URL) — один раз на вид: разметка табло
 * перерисовывается часто, а `toDataURL` на каждый раз — это кодирование PNG. */
const urls = new Map<string, string>();

export function itemUrl(kind: ItemArt): string {
  const key = `itemurl:${kind}`;
  let url = urls.get(key);
  if (!url) {
    url = itemPx(kind).url();
    urls.set(key, url);
  }
  return url;
}

function itemPx(kind: ItemArt): Px {
  const px = new Px(10, 10);
  switch (kind) {
    case 'meat':
    case 'fatmeat': {
      // Кусок мяса с косточкой.
      const meat = kind === 'fatmeat' ? hex('#c8604a') : hex('#b0402e');
      const fat = hex('#f2d8c0');
      px.ell(4.5, 5, 3.8, 3, meat);
      px.ell(3.6, 4, 1.4, 1, kind === 'fatmeat' ? fat : mix(meat, WHITE, 0.3));
      if (kind === 'fatmeat') px.line(2, 6, 6, 7, fat);
      px.rect(7, 4, 9, 5, hex('#efe6d6'));
      px.set(9, 3, hex('#efe6d6'));
      px.set(9, 6, hex('#efe6d6'));
      break;
    }
    case 'skin': {
      const fur = hex('#6b6158');
      px.ell(5, 5, 4.2, 3.4, (x, y) => ((x + y) % 3 === 0 ? hex('#4a423a') : fur));
      px.set(1, 2, fur);
      px.set(8, 8, fur);
      px.line(4, 4, 6, 6, hex('#8a7e72'));
      break;
    }
    case 'tail': {
      px.line(1, 8, 4, 4, hex('#c68d84'));
      px.line(4, 4, 8, 2, hex('#c68d84'));
      px.set(8, 1, hex('#ffd24a'));
      break;
    }
    case 'pyrite': {
      px.rect(2, 3, 7, 8, hex('#b89436'));
      px.rect(2, 3, 7, 3, hex('#fff0a8'));
      px.rect(7, 3, 7, 8, hex('#7a5e1c'));
      px.set(4, 5, hex('#fff0a8'));
      px.set(5, 6, hex('#8a6a22'));
      break;
    }
    case 'crown': {
      const g = hex('#e8b830');
      px.rect(1, 5, 8, 8, g);
      for (const x of [1, 4, 8]) px.rect(x, 2, x, 5, g);
      px.rect(1, 8, 8, 8, hex('#9a7018'));
      px.set(4, 6, hex('#d82040'));
      break;
    }
    case 'coin': {
      px.ell(5, 5, 3.8, 3.8, hex('#e8b830'));
      px.ell(5, 5, 2.4, 2.4, hex('#f6d860'));
      px.set(4, 3, hex('#fff6c0'));
      px.rect(5, 4, 5, 6, hex('#9a7018'));
      break;
    }
    case 'token': {
      px.ell(5, 5, 4, 4, hex('#7fd6c4'));
      px.set(5, 2, hex('#e8fff8'));
      px.rect(3, 5, 7, 5, hex('#e8fff8'));
      px.set(5, 4, hex('#e8fff8'));
      px.set(5, 6, hex('#e8fff8'));
      break;
    }
    case 'key': {
      // Слеза гаста.
      px.ell(5, 6, 3, 3.2, hex('#9fe6f0'));
      px.line(5, 1, 5, 3, hex('#9fe6f0'));
      px.set(4, 5, hex('#ffffff'));
      px.set(6, 7, hex('#4f8490'));
      break;
    }
  }
  px.outline(INK);
  return px;
}

// ---------------------------------------------------------------------------
// Свет: мягкое пятно, нарисованное один раз. Рисовальщик масштабирует его.
// ---------------------------------------------------------------------------

export function lightBlob(): HTMLCanvasElement {
  const key = 'lightblob';
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  cache.set(key, c);
  return c;
}

/** Цветное пятно света для тёплого подсвета (`lighter`). */
export function glowBlob(color: string): HTMLCanvasElement {
  const key = `glow:${color}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  cache.set(key, c);
  return c;
}

/** Иконка вещи комплекта для листа снаряжения: картинка слота в цвет ступени. */
export function gearIcon(slot: 'helm' | 'robe' | 'boots' | 'weapon', tier: number): string {
  const key = `gearicon:${slot}:${tier}`;
  const hitUrl = urls.get(key);
  if (hitUrl) return hitUrl;
  const url = gearIconCanvas(slot, tier, key).toDataURL();
  urls.set(key, url);
  return url;
}

function gearIconCanvas(
  slot: 'helm' | 'robe' | 'boots' | 'weapon',
  tier: number,
  key: string,
): HTMLCanvasElement {
  const hit = cache.get(key);
  if (hit) return hit;
  const gear: Gear = {
    weapon: { tier, plus: 0 },
    helm: { tier, plus: 0 },
    robe: { tier, plus: 0 },
    boots: { tier, plus: 0 },
  };
  if (slot === 'weapon') {
    const w = weaponArt(tier);
    const c = document.createElement('canvas');
    c.width = 20;
    c.height = 20;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.translate(10, 10);
    g.rotate(-Math.PI / 4);
    g.drawImage(w, -w.width / 2, -w.height / 2);
    cache.set(key, c);
    return c;
  }
  // Каску, робу и сапоги вырезаем из фигуры героя: так иконка и есть та вещь,
  // что надета.
  const full = paintHero(gear, 'down', 'idle', 0, false);
  const [y0, y1] = slot === 'helm' ? [0, 8] : slot === 'robe' ? [8, 16] : [15, 21];
  const px = new Px(16, 16);
  const off = Math.floor((16 - (y1 - y0 + 1)) / 2);
  for (let y = y0; y <= y1; y++)
    for (let x = 0; x < 16; x++) px.set(x, y - y0 + off, full.get(x, y)[3] ? full.get(x, y) : null);
  const c = px.canvas();
  cache.set(key, c);
  return c;
}

export { SETS };
