// Готовые спрайты для подземелья — Ninja Adventure Asset Pack (Pixel-boy,
// CC0, см. public/dungeon/na/CREDITS.txt). Владелец: «анимация ходьбы и
// предметы в руках выглядят ужасно… поищи, откуда скопировать пресеты».
// Нарисованный кодом герой двигал ногой на пиксель и крутил клинок вокруг
// тела; здесь — рисованная анимация: 4 стороны × 4 кадра шага, поза удара,
// прыжок, и клинок, который появляется в руке только в ударе.
//
// Каждая ступень робы — свой персонаж набора, ПЕРЕКРАШЕННЫЙ в цвета
// комплекта: палитры у спрайтов по 5–8 цветов, и у каждого цвета известна
// роль (мех ушанки, ватник, каска, броня, кожа), поэтому перекраска точная, а
// не «примерно по яркости». Так держится правило плана: вещи одной ступени
// выглядят одной вещью.
//
// Картинки грузятся асинхронно (`loadDungeonSprites`); пока не пришли, всё,
// что их просит, получает `null` и рисует прежнего героя. Экран клети
// закрывает загрузку при спуске.

import { useEffect, useSyncExternalStore } from 'react';
import { setOf } from './dungeon';
import { loadX72 } from './dungeon-tiles';
import type { Gear } from './dungeon';

export type Dir4 = 'down' | 'up' | 'left' | 'right';
const COL: Record<Dir4, number> = { down: 0, up: 1, left: 2, right: 3 };

/** Строки листа персонажа: 0–3 шаг, 4 удар, 5 прыжок, 6 особые позы. */
export const ROW = { walk: 0, attack: 4, jump: 5, special: 6 } as const;

export type FxId = 1 | 3 | 4 | 5 | 7 | 8 | 9 | 10 | 11 | 12 | 18;
const FX_IDS: FxId[] = [1, 3, 4, 5, 7, 8, 9, 10, 11, 12, 18];
/** Рабочих кадров в листе эффекта: хвост листа у набора бывает пустым. */
const FX_FRAMES: Record<FxId, number> = {
  1: 4,
  3: 6,
  4: 5,
  5: 5,
  7: 4,
  8: 4,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  18: 6,
};

type Sheet = 'char3' | 'char15' | 'char18' | 'char19' | 'sword' | 'katana' | 'bigsword';
const SHEETS: Sheet[] = ['char3', 'char15', 'char18', 'char19', 'sword', 'katana', 'bigsword'];

const images = new Map<string, HTMLImageElement>();
let ready = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const url = (name: string) => `${import.meta.env.BASE_URL}dungeon/na/${name}.png`;

function load(name: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      images.set(name, img);
      resolve();
    };
    // Картинка не пришла — рисуем прежнего героя, игра не встаёт.
    img.onerror = () => resolve();
    img.src = url(name);
  });
}

/** Начать загрузку (повторный вызов — та же загрузка). */
export function loadDungeonSprites(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (!loading) {
    loading = Promise.all([...SHEETS.map(load), ...FX_IDS.map((id) => load(`fx${id}`))]).then(
      () => {
        ready = SHEETS.every((s) => images.has(s));
        listeners.forEach((f) => f());
      },
    );
  }
  return loading;
}

export const spritesReady = () => ready;

/** Подписка на «спрайты пришли» — чтобы разметка перерисовала иконки. */
export function onSpritesReady(f: () => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** Для разметки: начать загрузку и перерисоваться, когда картинки придут. */
export function useDungeonSprites(): boolean {
  useEffect(() => {
    void loadDungeonSprites();
    // Плитки мира грузятся тем же заходом: к спуску клетью они уже есть.
    void loadX72();
  }, []);
  return useSyncExternalStore(onSpritesReady, spritesReady, () => false);
}

// ---------------------------------------------------------------------------
// Перекраска.
// ---------------------------------------------------------------------------

type ColorMap = Record<string, string>;

/** Кожа — одна на всех персонажей набора (у первого она была красной). */
const SKIN = '#fb9a56';
const SKIN_SHADE = '#c37b49';

/** Какой персонаж и какие цвета у ступени робы. */
function heroRecipe(tier: number): { sheet: Sheet; map: ColorMap; lamp?: boolean } {
  const s = setOf(tier);
  switch (tier) {
    case 1:
      // Северянин в меховом капюшоне → ушанка и ватник. Мех светлее ватника,
      // лицо — кожа, как у остальных: серое на сером читалось мешком.
      return {
        sheet: 'char19',
        map: {
          '#5478db': s.base,
          '#30accb': s.light,
          '#5c4394': s.dark,
          '#e3f1f5': '#c4ab80',
          '#c03a24': SKIN_SHADE,
          '#e27d2d': SKIN,
        },
      };
    case 2:
      // Солдат в каске → шахтёрская каска с лампой, брезентовая роба. Каска
      // желтее комплекта и с тёмным ободом: оранжевая сливалась с лицом.
      return {
        sheet: 'char3',
        map: {
          '#2c3126': '#6a3c10',
          '#48543d': '#d98c1c',
          '#51614e': '#a8651f',
          '#6f805b': '#f6c552',
          '#c37b49': '#a86a44',
          '#fb9a56': '#d9926a',
          '#65796f': '#8a7a58',
          '#8fabb4': '#b8a878',
          '#2e3939': '#4a4032',
        },
        lamp: true,
      };
    case 3:
    case 5:
    case 7:
      // Рыцарь в шлеме с забралом — кованые комплекты.
      return {
        sheet: 'char15',
        map: {
          '#9ba7aa': s.base,
          '#4e5456': s.dark,
          '#c2e5ff': s.light,
          '#c03a24': s.trim,
        },
      };
    default:
      // Рыцарь в плаще — мастерские и самоцветные комплекты.
      return {
        sheet: 'char18',
        map: {
          '#7fa2ad': s.base,
          '#537079': s.dark,
          '#e3f1f5': s.light,
          '#5c4394': mixHex(s.trim, s.dark, 0.45),
          '#341e53': mixHex(s.trim, s.dark, 0.75),
          '#9e1e21': s.trim,
        },
      };
  }
}

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mixHex(a: string, b: string, k: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const key3 = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Картинка → холст с заменой цветов (и белой заливкой для вспышки удара). */
function recolor(img: HTMLImageElement, map: ColorMap, flash = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const lut = new Map<string, [number, number, number]>();
  for (const [from, to] of Object.entries(map)) lut.set(from, hexRgb(to));
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (flash) {
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      continue;
    }
    const to = lut.get(key3(d[i], d[i + 1], d[i + 2]));
    if (to) {
      d[i] = to[0];
      d[i + 1] = to[1];
      d[i + 2] = to[2];
    }
  }
  g.putImageData(data, 0, 0);
  return c;
}

const sheets = new Map<string, HTMLCanvasElement>();
const frames = new Map<string, HTMLCanvasElement>();

function heroSheet(tier: number, flash: boolean): HTMLCanvasElement | null {
  const key = `hero:${tier}:${flash ? 1 : 0}`;
  let c = sheets.get(key);
  if (c) return c;
  const r = heroRecipe(tier);
  const img = images.get(r.sheet);
  if (!img) return null;
  c = recolor(img, r.map, flash);
  // Каска забойщика — с лампой: тёмный корпус и яркое стекло спереди, в
  // профиль — на лбу у края. Без лампы жёлтая каска читалась чёлкой.
  if (r.lamp && !flash) {
    const g = c.getContext('2d')!;
    const glass = setOf(tier).glow;
    for (let row = 0; row < 7; row++)
      for (const dir of ['down', 'left', 'right'] as Dir4[]) {
        const x0 = COL[dir] * 16;
        const y0 = row * 16;
        const d = g.getImageData(x0, y0, 16, 16).data;
        // Верх каски — первая непрозрачная строка кадра (кадры шага качаются).
        let top = -1;
        for (let y = 0; y < 16 && top < 0; y++)
          for (let x = 0; x < 16; x++)
            if (d[(y * 16 + x) * 4 + 3]) {
              top = y;
              break;
            }
        if (top < 0) continue;
        const y = y0 + top + 2;
        const [hx, gx, w] = dir === 'down' ? [6, 7, 4] : dir === 'right' ? [12, 13, 2] : [2, 2, 2];
        g.fillStyle = '#2a211b';
        g.fillRect(x0 + hx, y, w, 2);
        g.fillStyle = glass;
        g.fillRect(x0 + gx, y, dir === 'down' ? 2 : 1, 1);
      }
  }
  sheets.set(key, c);
  return c;
}

/** Кадр героя 16×16: ступень робы, сторона, строка листа, номер кадра. */
export function heroSprite(
  tier: number,
  dir: Dir4,
  row: number,
  flash = false,
): HTMLCanvasElement | null {
  const key = `hf:${tier}:${dir}:${row}:${flash ? 1 : 0}`;
  let f = frames.get(key);
  if (f) return f;
  const sheet = heroSheet(Math.max(1, Math.min(8, tier)), flash);
  if (!sheet) return null;
  f = document.createElement('canvas');
  f.width = 16;
  f.height = 16;
  const g = f.getContext('2d')!;
  g.drawImage(sheet, COL[dir] * 16, Math.max(0, Math.min(6, row)) * 16, 16, 16, 0, 0, 16, 16);
  frames.set(key, f);
  return f;
}

/** Клинок ступени, как в наборе: остриё ВНИЗ, навершие вверху. */
export function bladeSprite(tier: number): HTMLCanvasElement | null {
  const key = `blade:${tier}`;
  let c = sheets.get(key);
  if (c) return c;
  const s = setOf(tier);
  let img: HTMLImageElement | undefined;
  let map: ColorMap;
  if (tier === 1) {
    // Тесак из рессоры: тусклое железо, обмотка вместо цуба.
    img = images.get('katana');
    map = {
      '#ffffff': '#c8bcae',
      '#ae9a9a': '#857868',
      '#ff971d': '#5a3a22',
      '#584e4e': '#3a2e28',
    };
  } else {
    img = images.get('bigsword');
    map =
      tier <= 3
        ? { '#ffad5d': s.trim, '#8d977f': mixHex(s.trim, '#000000', 0.35) }
        : {
            '#f2eaf1': s.glow,
            '#abc2bc': s.light,
            '#ffad5d': s.trim,
            '#8d977f': mixHex(s.trim, '#000000', 0.35),
          };
  }
  if (!img) return null;
  c = recolor(img, map);
  sheets.set(key, c);
  return c;
}

/** Кадры эффекта: лист 32 px высотой, кадры по 32. */
export function fxFrame(id: FxId, frame: number): HTMLCanvasElement | null {
  const img = images.get(`fx${id}`);
  if (!img) return null;
  const f = Math.max(0, Math.min(FX_FRAMES[id] - 1, Math.floor(frame)));
  const key = `fx:${id}:${f}`;
  let c = frames.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  c.getContext('2d')!.drawImage(img, f * 32, 0, 32, 32, 0, 0, 32, 32);
  frames.set(key, c);
  return c;
}

export function fxCount(id: FxId): number {
  return images.has(`fx${id}`) ? FX_FRAMES[id] : 0;
}

/** Портрет героя в его снаряжении (лицом к нам) — для клети, лагеря и сидора. */
export function heroPortrait(gear: Gear): HTMLCanvasElement | null {
  return heroSprite(gear.robe.tier, 'down', 0);
}
