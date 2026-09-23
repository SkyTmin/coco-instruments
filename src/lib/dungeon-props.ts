// Предметы подземелья в палитре 0x72: ящик и сундук — кадры набора, остальное
// (бочки, порох, гнёзда, вагонетки, крепь, фонари, указатели, нора, лампа,
// вход в штольню) нарисовано кодом теми же пятью ступенями камня и дерева
// ящика набора. Прежние предметы были своей, более мультяшной палитры и
// на плитках набора выглядели наклейками.
//
// Всё — вид в три четверти: сверху крышка, спереди бок, тёмная обводка
// снаружи. Рисуется от нижнего края (где предмет стоит на полу).

import { hex, Px } from './dungeon-art';
import { P, x72 } from './dungeon-tiles';
import type { PropArt } from './dungeon-art';

type RGBA = [number, number, number, number];

const W = {
  dark: hex('#3e1f1c'),
  base: hex('#6e3a26'),
  mid: hex('#8f4a2a'),
  light: hex('#b8683a'),
  hi: hex('#e0914a'),
};
const STRAW = hex('#b08a4a');
const STRAW_D = hex('#7a5a2c');
const STRAW_L = hex('#dcb86a');
const RAG = hex('#6e6660');
const RAG_L = hex('#948a80');
const HOLE = hex('#0e0909');
const EYE = hex('#ff3a28');
const RED = hex('#a82a24');
const RED_D = hex('#6a1a18');
const RED_L = hex('#d8503e');
const GLASS = hex('#ffd76a');
const GLASS_L = hex('#fff6c8');
const GLASS_OFF = hex('#3a3a44');

function barrel(px: Px, x0: number, y0: number, w: number, h: number, red: boolean): void {
  const body = red ? RED : W.base;
  const dark = red ? RED_D : W.dark;
  const light = red ? RED_L : W.light;
  const cx = x0 + w / 2;
  // Бок: клёпки-доски с объёмом — светлее слева, темнее справа.
  for (let y = y0 + 2; y < y0 + h - 1; y++)
    for (let x = x0; x < x0 + w; x++) {
      const t = (x - x0) / (w - 1);
      const bulge = Math.abs(y - (y0 + h / 2)) < h * 0.3 ? 0 : 1;
      if ((x === x0 || x === x0 + w - 1) && bulge) continue;
      let c = t < 0.2 ? light : t < 0.7 ? body : dark;
      if ((x - x0) % 3 === 0 && t > 0.1 && t < 0.9) c = dark;
      px.set(x, y, c);
    }
  // Обручи.
  for (const y of [y0 + 4, y0 + h - 4]) {
    px.rect(x0, y, x0 + w - 1, y, P.ironDark);
    px.set(x0 + 2, y, P.ironLight);
    px.set(x0 + 3, y, P.iron);
  }
  // Крышка — овал.
  px.ell(cx, y0 + 2.5, w / 2, 2.2, red ? RED_D : W.mid);
  px.ell(cx, y0 + 2.5, w / 2 - 1.2, 1.4, red ? RED : W.light);
  for (let x = x0 + 2; x < x0 + w - 2; x += 3) px.set(x, y0 + 2, red ? RED_D : W.mid);
}

function make(kind: PropArt): Px | null {
  switch (kind) {
    case 'crate':
      return x72('crate');
    case 'chest':
      return x72('chest_full_open_anim_f0');
    case 'chestOpen':
      return x72('chest_full_open_anim_f2');
    case 'barrel': {
      const px = new Px(12, 16);
      barrel(px, 0, 0, 12, 16, false);
      px.outline(P.ink);
      return px;
    }
    case 'powder': {
      const px = new Px(12, 18);
      barrel(px, 0, 2, 12, 16, true);
      // Трафарет «череп» на боку и фитиль из крышки.
      const bone = hex('#efe6d0');
      px.rect(4, 9, 7, 11, bone);
      px.set(5, 10, RED_D);
      px.set(7, 10, RED_D);
      px.rect(5, 12, 6, 12, bone);
      px.line(8, 3, 10, 0, hex('#2a2420'));
      px.outline(P.ink);
      px.set(10, 0, hex('#fff0a0'));
      return px;
    }
    case 'nest': {
      // Гнездо: кольцо из прутьев и соломы, тряпьё, кость, тёмная середина
      // и глаза в ней — сразу понятно, откуда полезут.
      const px = new Px(22, 13);
      px.ell(11, 7.5, 10.4, 5, (x, y) => {
        const k = (x * 7 + y * 13) % 11;
        return k === 0 ? STRAW_D : k < 3 ? STRAW_L : k < 6 ? STRAW : W.base;
      });
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        px.line(
          11 + Math.cos(a) * 6,
          7.5 + Math.sin(a) * 3,
          11 + Math.cos(a + 0.5) * 11,
          7.5 + Math.sin(a + 0.5) * 5.4,
          i % 2 ? W.dark : STRAW_D,
        );
      }
      px.ell(11, 7.8, 4.2, 2.2, HOLE);
      px.rect(1, 5, 4, 6, RAG);
      px.rect(2, 5, 3, 5, RAG_L);
      px.rect(16, 9, 19, 10, RAG);
      // Кость.
      px.line(14, 2, 18, 4, hex('#e8dcc4'));
      px.set(13, 2, hex('#e8dcc4'));
      px.set(19, 4, hex('#e8dcc4'));
      px.outline(P.ink);
      px.set(9, 8, EYE);
      px.set(12, 8, EYE);
      return px;
    }
    case 'cartnest': {
      // Вагонетка на боку: днище к нам, из кузова — солома и глаза.
      const px = new Px(22, 17);
      for (let y = 3; y <= 13; y++)
        for (let x = 1; x <= 20; x++) {
          const edge = y === 3 || y === 13 || x === 1 || x === 20;
          px.set(x, y, edge ? P.ironDark : (x + y) % 7 === 0 ? P.ironDark : P.iron);
        }
      px.rect(2, 4, 19, 4, P.ironLight);
      for (const x of [4, 10, 16]) for (const y of [5, 11]) px.set(x, y, P.ironLight);
      // Колёса, торчащие вбок.
      px.ell(5, 15, 2.2, 1.6, P.ink);
      px.ell(16, 15, 2.2, 1.6, P.ink);
      px.set(5, 15, P.iron);
      px.set(16, 15, P.iron);
      // Дыра-гнездо в кузове.
      px.ell(11, 8.5, 4.4, 3, HOLE);
      px.line(6, 12, 15, 12, STRAW);
      px.line(7, 11, 9, 13, STRAW_L);
      px.line(13, 11, 16, 13, STRAW_D);
      px.outline(P.ink);
      px.set(10, 8, EYE);
      px.set(12, 8, EYE);
      return px;
    }
    case 'cart': {
      // Вагонетка: железный кузов с заклёпками, в нём порода с пиритом.
      const px = new Px(18, 17);
      // Кузов — трапеция: шире сверху.
      for (let y = 4; y <= 12; y++) {
        const inset = Math.floor((y - 4) / 4);
        for (let x = 1 + inset; x <= 16 - inset; x++) {
          const t = (x - 1) / 15;
          px.set(x, y, t < 0.2 ? P.ironLight : t < 0.75 ? P.iron : P.ironDark);
        }
      }
      px.rect(1, 4, 16, 4, P.ironLight);
      px.rect(1, 7, 16, 7, P.ironDark);
      for (const x of [3, 8, 13]) px.set(x, 9, P.ironLight);
      // Груз.
      px.ell(8.5, 3.6, 7, 2.4, P.stone);
      for (const [x, y] of [
        [5, 3],
        [9, 2],
        [12, 3],
        [7, 4],
      ])
        px.set(x, y, P.stoneLight);
      px.set(10, 3, P.ore);
      px.set(6, 2, P.oreLight);
      // Колёса.
      for (const x of [4, 13]) {
        px.ell(x, 14, 2.4, 2.2, P.ink);
        px.set(x, 14, P.iron);
      }
      px.outline(P.ink);
      return px;
    }
    case 'pillar': {
      // Стойка крепи: бревно с корой, сверху подушка-доска, клин у пола.
      const px = new Px(12, 26);
      for (let y = 4; y < 24; y++)
        for (let x = 3; x <= 8; x++) {
          const t = (x - 3) / 5;
          let c = t < 0.2 ? W.light : t < 0.7 ? W.base : W.dark;
          if ((y * 3 + x) % 9 === 0) c = W.dark;
          px.set(x, y, c);
        }
      px.rect(0, 1, 11, 4, W.mid);
      px.rect(0, 1, 11, 1, W.hi);
      px.rect(0, 4, 11, 4, W.dark);
      px.rect(2, 23, 9, 25, W.dark);
      px.rect(3, 23, 8, 23, W.base);
      px.outline(P.ink);
      return px;
    }
    case 'lantern':
    case 'unlit': {
      // Фонарь горняка на треноге: колпак, стекло, ручка.
      const on = kind === 'lantern';
      const px = new Px(10, 16);
      px.line(1, 15, 4, 9, W.dark);
      px.line(8, 15, 5, 9, W.dark);
      px.line(4, 15, 4, 10, W.base);
      px.rect(2, 3, 7, 9, P.ironDark);
      px.rect(3, 4, 6, 8, on ? GLASS : GLASS_OFF);
      if (on) {
        px.rect(4, 5, 5, 6, GLASS_L);
      }
      px.rect(2, 2, 7, 2, P.iron);
      px.line(3, 1, 6, 1, P.ironDark);
      px.set(4, 0, P.ironDark);
      px.set(5, 0, P.ironDark);
      px.outline(P.ink);
      return px;
    }
    case 'plaque': {
      // Указатель: доска на столбе, строчки надписи.
      const px = new Px(16, 18);
      px.rect(7, 8, 8, 17, W.base);
      px.rect(7, 8, 7, 17, W.light);
      px.rect(0, 1, 15, 9, W.mid);
      px.rect(0, 1, 15, 1, W.hi);
      px.rect(0, 9, 15, 9, W.dark);
      for (const y of [3, 5, 7]) px.rect(2, y, 12 - (y % 3) * 2, y, W.dark);
      px.outline(P.ink);
      return px;
    }
    default:
      return null;
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/**
 * Предмет в палитре набора; null — у этого вида своего рисунка нет (или
 * атлас ещё не пришёл) — тогда рисуется прежний.
 */
export function propX72(kind: PropArt, flash = false): HTMLCanvasElement | null {
  const key = `${kind}:${flash ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let px = make(kind);
  if (!px) return null;
  if (flash) px = px.tint([255, 255, 255, 255], 0.85);
  const c = px.canvas();
  cache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// Настенное: лампа, нора, вход в штольню, доска — на лице стены.
// ---------------------------------------------------------------------------

/** Лампа на крюке: кованая скоба, стекло светит. */
export function wallLampX72(): HTMLCanvasElement {
  return cachedWall('lamp', () => {
    const px = new Px(16, 16);
    px.rect(7, 1, 8, 3, P.ironDark);
    px.rect(5, 3, 10, 3, P.iron);
    px.rect(6, 4, 9, 9, P.ironDark);
    px.rect(7, 5, 8, 8, GLASS);
    px.set(7, 5, GLASS_L);
    px.rect(6, 10, 9, 10, P.iron);
    px.outline(P.ink);
    return px;
  });
}

/** Нора в лице стены: рваная дыра, осыпь у подножия. */
export function burrowX72(): HTMLCanvasElement {
  return cachedWall('burrow', () => {
    const px = new Px(16, 16);
    px.ell(8, 11, 5, 4.2, P.ink);
    px.ell(8, 11.5, 4, 3.4, HOLE);
    // Рваный край — светлые сколы камня вокруг.
    for (const [x, y] of [
      [3, 9],
      [12, 8],
      [5, 7],
      [11, 13],
      [2, 13],
    ])
      px.set(x, y, P.stoneLight);
    // Осыпь.
    px.rect(2, 15, 13, 15, P.stone);
    px.set(4, 14, P.stoneLight);
    px.set(10, 14, P.stoneLight);
    px.set(7, 12, EYE);
    px.set(9, 12, EYE);
    return px;
  });
}

/** Вход в штольню: деревянная рама из двух стоек и верхняка, тьма внутри. */
export function minePortalX72(): HTMLCanvasElement {
  return cachedWall('mine', () => {
    const px = new Px(48, 16);
    px.rect(10, 3, 37, 15, HOLE);
    // Стойки.
    for (const x0 of [8, 36]) {
      px.rect(x0, 2, x0 + 3, 15, W.base);
      px.rect(x0, 2, x0, 15, W.light);
      px.rect(x0 + 3, 2, x0 + 3, 15, W.dark);
    }
    // Верхняк.
    px.rect(6, 0, 41, 3, W.mid);
    px.rect(6, 0, 41, 0, W.hi);
    px.rect(6, 3, 41, 3, W.dark);
    // Рельсы уходят в темноту.
    px.rect(19, 12, 19, 15, P.iron);
    px.rect(28, 12, 28, 15, P.iron);
    px.rect(18, 14, 29, 14, W.dark);
    // Табличка «ШАХТА» — светлая дощечка.
    px.rect(18, 5, 29, 8, W.light);
    px.rect(20, 6, 27, 7, W.dark);
    px.outline(P.ink);
    return px;
  });
}

/** Доска объявлений на стене: доска, приколотые листы. */
export function boardX72(): HTMLCanvasElement {
  return cachedWall('board', () => {
    const px = new Px(16, 16);
    px.rect(1, 2, 14, 12, W.base);
    px.rect(1, 2, 14, 2, W.light);
    px.rect(1, 12, 14, 12, W.dark);
    const paper = hex('#e8dcc0');
    px.rect(3, 4, 6, 8, paper);
    px.rect(8, 5, 12, 10, paper);
    px.rect(4, 5, 5, 5, P.stone);
    px.rect(9, 6, 11, 6, P.stone);
    px.rect(9, 8, 10, 8, P.stone);
    px.set(4, 4, RED);
    px.set(10, 5, RED);
    px.outline(P.ink);
    return px;
  });
}

const wallCache = new Map<string, HTMLCanvasElement>();
function cachedWall(key: string, make: () => Px): HTMLCanvasElement {
  let c = wallCache.get(key);
  if (!c) {
    c = make().canvas();
    wallCache.set(key, c);
  }
  return c;
}

export type { RGBA };
