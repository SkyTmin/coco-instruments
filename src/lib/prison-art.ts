// Текстуры каторги рисуются кодом: 26 пород × картинка — самая медленная
// часть такой игры, если рисовать руками. Каждая порода — квадрат 16×16
// пикселей из своей палитры и своего узора, растянутый без сглаживания
// (`image-rendering: pixelated`). Рисуется один раз за сессию и лежит в
// кеше как data-URL: на поле это обычная картинка, её не перерисовывают.
//
// Зерно у каждой породы своё и постоянное, поэтому гранит одинаков на любом
// телефоне и в любой заход — порода узнаётся по рисунку, а не только по
// цвету. Это важно: на поле рядом лежат пять пород, и различать их нужно
// с первого взгляда.

import { rng32, ROCKS } from './prison';
import { DEEP_BASE, DEEP_ROCKS } from './dungeon';
import { SPECIES } from './forest';
import type { Rock } from './prison';

const N = 16;

type RGB = [number, number, number];

function hex(h: string): RGB {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function mix(a: RGB, b: RGB, k: number): RGB {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];

class Pixels {
  readonly n: number;
  data: Uint8ClampedArray;
  constructor(n = N) {
    this.n = n;
    this.data = new Uint8ClampedArray(n * n * 4);
  }
  set(x: number, y: number, c: RGB, a = 255): void {
    const n = this.n;
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    const i = (y * this.n + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }
  toUrl(): string {
    if (typeof document === 'undefined') return '';
    const n = this.n;
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const g = c.getContext('2d');
    if (!g) return '';
    const img = g.createImageData(n, n);
    img.data.set(this.data);
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }
}

/** Каменная основа: крупные пятна плюс мелкое зерно. */
function ground(px: Pixels, r: Rock, rnd: () => number): void {
  const base = hex(r.base);
  const dark = hex(r.dark);
  const light = mix(base, hex(r.shine), 0.28);
  // Крупные пятна: сетка 4×4, у каждой клетки своя яркость.
  const blot: number[] = Array.from({ length: 16 }, () => rnd() * 0.16 - 0.08);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const t = rnd();
      let c = t < 0.2 ? dark : t < 0.82 ? base : light;
      const b = blot[Math.floor(y / 4) * 4 + Math.floor(x / 4)];
      c = b > 0 ? mix(c, WHITE, b) : mix(c, BLACK, -b);
      px.set(x, y, c);
    }
  }
}

/** Самоцвет в оправе породы: светлая грань сверху-слева, тень снизу-справа. */
function gem(px: Pixels, cx: number, cy: number, size: number, r: Rock): void {
  const fleck = hex(r.fleck);
  const shine = hex(r.shine);
  const deep = mix(fleck, BLACK, 0.45);
  for (let dy = -size; dy <= size; dy++) {
    for (let dx = -size; dx <= size; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > size) continue;
      const edge = Math.abs(dx) + Math.abs(dy) === size;
      let c = fleck;
      if (edge && (dx < 0 || dy < 0)) c = shine;
      else if (edge) c = deep;
      else if (dx + dy < 0) c = mix(fleck, shine, 0.3);
      px.set(cx + dx, cy + dy, c);
    }
  }
}

function paintRock(r: Rock, index: number, variant: number): string {
  const rnd = rng32(0x5eed + index * 977 + variant * 104729);
  const px = new Pixels();
  ground(px, r, rnd);
  const fleck = hex(r.fleck);
  const shine = hex(r.shine);
  const dark = hex(r.dark);
  const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  switch (r.pattern) {
    case 'grain': {
      for (let i = 0; i < 26; i++) px.set(ri(0, 15), ri(0, 15), rnd() < 0.7 ? fleck : shine);
      // В земле попадаются камешки: без них глина — однотонный шум.
      if (r.kind === 'soil') {
        const pebble: RGB = [128, 118, 108];
        for (let i = 0; i < variant; i++) {
          const x = ri(2, 12);
          const y = ri(2, 12);
          px.set(x, y, mix(pebble, WHITE, 0.3));
          px.set(x + 1, y, pebble);
          px.set(x, y + 1, pebble);
          px.set(x + 1, y + 1, mix(pebble, BLACK, 0.35));
          px.set(x + 2, y + 1, dark);
        }
      }
      break;
    }
    case 'bands': {
      const phase = rnd() * 6;
      const colors = [hex(r.base), fleck, mix(hex(r.base), dark, 0.6), shine];
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const band = Math.floor((y + 2.2 * Math.sin(x / 3 + phase) + 16) / 3) % colors.length;
          const c = mix(px.get(x, y), colors[band], 0.62);
          px.set(x, y, c);
        }
      }
      break;
    }
    case 'specks': {
      const n = ri(5, 7);
      for (let i = 0; i < n; i++) {
        const x = ri(1, 13);
        const y = ri(1, 13);
        px.set(x, y, fleck);
        px.set(x + 1, y, fleck);
        px.set(x, y + 1, fleck);
        if (rnd() < 0.6) px.set(x + 1, y + 1, mix(fleck, BLACK, 0.3));
        px.set(x, y, shine);
        if (rnd() < 0.5) px.set(x + 2, y + 1, dark);
      }
      break;
    }
    case 'veins': {
      for (let v = 0; v < 2; v++) {
        let y = ri(2, 13);
        for (let x = 0; x < N; x++) {
          px.set(x, y, fleck);
          if (rnd() < 0.35) px.set(x, y - 1, shine);
          if (rnd() < 0.3) px.set(x, y + 1, mix(fleck, BLACK, 0.35));
          y += rnd() < 0.33 ? -1 : rnd() < 0.5 ? 1 : 0;
          y = Math.max(1, Math.min(14, y));
        }
      }
      break;
    }
    case 'crystal': {
      const spots: [number, number][] = [
        [ri(3, 6), ri(3, 6)],
        [ri(9, 12), ri(8, 12)],
        [ri(3, 7), ri(10, 13)],
      ];
      spots.forEach(([x, y], i) => gem(px, x, y, i === 0 ? 3 : 2, r));
      break;
    }
    case 'flakes': {
      for (let i = 0; i < 12; i++) {
        const x = ri(0, 13);
        const y = ri(0, 15);
        px.set(x, y, fleck);
        px.set(x + 1, y, fleck);
        if (rnd() < 0.5) px.set(x + 2, y, shine);
        else px.set(x + 1, y, shine);
      }
      break;
    }
    case 'stars': {
      // Туманность: мягкое пятно цвета искр, потом сами звёзды.
      const cx = ri(4, 11);
      const cy = ri(4, 11);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const d = Math.hypot(x - cx, y - cy) / 8;
          if (d < 1) px.set(x, y, mix(px.get(x, y), fleck, 0.32 * (1 - d)));
        }
      }
      for (let i = 0; i < 7; i++) {
        const x = ri(1, 14);
        const y = ri(1, 14);
        px.set(x, y, shine);
        if (i < 3) {
          px.set(x - 1, y, fleck);
          px.set(x + 1, y, fleck);
          px.set(x, y - 1, fleck);
          px.set(x, y + 1, fleck);
        }
      }
      break;
    }
  }

  // Фаска: блок — это торец столба, свет сверху-слева.
  for (let i = 0; i < N; i++) {
    px.set(i, 0, mix(px.get(i, 0), WHITE, 0.22));
    px.set(0, i, mix(px.get(0, i), WHITE, 0.16));
    px.set(i, N - 1, mix(px.get(i, N - 1), BLACK, 0.32));
    px.set(N - 1, i, mix(px.get(N - 1, i), BLACK, 0.26));
  }
  return px.toUrl();
}

/**
 * Рисунков у породы несколько: одна и та же картинка во всех клетках
 * складывается в кафель, и поле читается как плитка, а не как порода.
 */
export const ROCK_VARIANTS = 4;

const rockCache = new Map<number, string>();

/** Картинка породы (data-URL, 16×16). `variant` — какой из рисунков. */
export function rockTexture(rock: number, variant = 0): string {
  const key = rock * ROCK_VARIANTS + (variant % ROCK_VARIANTS);
  let url = rockCache.get(key);
  if (url === undefined) {
    const r = ROCKS[rock];
    url = r ? paintRock(r, rock, variant % ROCK_VARIANTS) : '';
    rockCache.set(key, url);
  }
  return url;
}

/** Какой рисунок у блока: постоянен для клетки и яруса в этой шахте. */
export function rockVariant(seed: number, cell: number, depth: number): number {
  let h = (seed ^ (cell * 374761393) ^ (depth * 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) % ROCK_VARIANTS;
}

/**
 * Руда шахт подземелья: тот же рисовальщик, что у пород каторги, — поле
 * подземелья должно выглядеть той же шахтой. Номера — после пород каторги
 * (`DEEP_BASE`), поэтому зерно рисунка не совпадёт ни с одной породой.
 */
export function deepRockTexture(rock: number, variant = 0): string {
  const key = rock * ROCK_VARIANTS + (variant % ROCK_VARIANTS);
  let url = rockCache.get(key);
  if (url === undefined) {
    const r = DEEP_ROCKS[rock - DEEP_BASE];
    url = r ? paintRock(r, rock, variant % ROCK_VARIANTS) : '';
    rockCache.set(key, url);
  }
  return url;
}

export function deepRockColors(rock: number): string[] {
  const r = DEEP_ROCKS[rock - DEEP_BASE];
  if (!r) return ['#444', '#222'];
  return [r.base, r.dark, r.fleck, r.base, r.shine];
}

let bedrock = '';

/** Дно шахты: коренная порода, её не берёт ни одна кирка. */
export function bedrockTexture(): string {
  if (bedrock) return bedrock;
  const rnd = rng32(0xbed);
  const px = new Pixels();
  const a: RGB = [38, 34, 34];
  const b: RGB = [24, 21, 22];
  const c: RGB = [58, 52, 50];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const t = rnd();
      px.set(x, y, t < 0.3 ? b : t < 0.86 ? a : c);
    }
  bedrock = px.toUrl();
  return bedrock;
}

const crackCache: string[] = [];

/** Отрезок по пикселям без дыр (Брезенхэм). */
function line(px: Pixels, x0: number, y0: number, x1: number, y1: number, c: RGB, a: number) {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 64; guard++) {
    px.set(x, y, c, a);
    if (x === tx && y === ty) break;
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

/** Ломаная из (x, y) по направлению `ang`: `n` звеньев по полтора пикселя. */
function walk(rnd: () => number, x: number, y: number, ang: number, n: number): [number, number][] {
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < n; i++) {
    ang += rnd() * 0.9 - 0.45;
    x += Math.cos(ang) * 1.6;
    y += Math.sin(ang) * 1.6;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Трещина стадии 1…3. Ветви одни и те же для всех стадий, растёт только
 * длина: трещина на глазах РАСТЁТ, а не подменяется другой картинкой. На
 * последней стадии она доходит до края и у блока откалываются углы.
 */
export function crackTexture(stage: number): string {
  if (stage <= 0) return '';
  const k = Math.min(3, stage);
  if (crackCache[k]) return crackCache[k];
  const rnd = rng32(0xc4ac);
  const px = new Pixels();
  const ink: RGB = [14, 10, 8];
  const lip: RGB = [255, 244, 225];
  const a0 = rnd() * Math.PI * 2;
  const main = [walk(rnd, 7.5, 7.5, a0, 9), walk(rnd, 7.5, 7.5, a0 + Math.PI, 9)];
  const branches = [0, 1, 2].map((i) => {
    const from = main[i % 2][3 + i * 2] ?? main[0][3];
    return walk(
      rnd,
      from[0],
      from[1],
      a0 + (i % 2 ? Math.PI : 0) + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.5),
      4,
    );
  });
  const reach = [0, 3, 6, 9][k];
  const draw = (pts: [number, number][], n: number) => {
    for (let i = 0; i < Math.min(n, pts.length - 1); i++) {
      // Светлая кромка на пиксель ниже: без неё тёмная линия на тёмной
      // породе теряется.
      line(px, pts[i][0] + 0.6, pts[i][1] + 0.9, pts[i + 1][0] + 0.6, pts[i + 1][1] + 0.9, lip, 60);
    }
    for (let i = 0; i < Math.min(n, pts.length - 1); i++) {
      line(px, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ink, 225);
    }
  };
  main.forEach((m) => draw(m, reach));
  if (k >= 2) draw(branches[0], 3);
  if (k >= 3) branches.forEach((b) => draw(b, 4));
  if (k >= 3) {
    // Отколотые углы: пиксели дыры открывают тёмную яму под блоком.
    const hole: RGB = [10, 7, 6];
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [15, 15],
      [14, 15],
      [15, 14],
      [15, 0],
    ])
      px.set(x, y, hole, 235);
  }
  crackCache[k] = px.toUrl();
  return crackCache[k];
}

/** Цвета крошки породы — для частиц. */
export function rockColors(rock: number): string[] {
  const r = ROCKS[rock];
  if (!r) return ['#444', '#222'];
  return [r.base, r.dark, r.fleck, r.base, r.shine];
}

// ---------------------------------------------------------------------------
// Находки: маленькие спрайты 12×12 по буквенной карте, как в старых играх.
// Буква — цвет из палитры спрайта, точка — прозрачно. Рисуются в тот же
// квадрат 16×16, что и породы, с полем в два пикселя.
// ---------------------------------------------------------------------------

interface Sprite {
  pal: Record<string, string>;
  map: string[];
}

const FIND_SPRITES: Record<string, Sprite> = {
  coin: {
    pal: { a: '#6e4a0c', b: '#e8b43a', c: '#ffe08a', d: '#b8861c' },
    map: [
      '....aaaa....',
      '..aabbbbaa..',
      '.abbccccbba.',
      '.abcbbbbcba.',
      'abcbbddbbcba',
      'abcbddddbcba',
      'abcbddddbcba',
      'abcbbddbbcba',
      '.abcbbbbcba.',
      '.abbccccbba.',
      '..aabbbbaa..',
      '....aaaa....',
    ],
  },
  key: {
    pal: { a: '#2e2a28', b: '#9a8f86', c: '#a0522d' },
    map: [
      '...aaaa.....',
      '..abbbba....',
      '..ab..ca....',
      '..abbbba....',
      '...abba.....',
      '....ab......',
      '....ac......',
      '....abaa....',
      '....abba....',
      '....ac......',
      '....abaa....',
      '....aaa.....',
    ],
  },
  fern: {
    pal: { a: '#4a4644', b: '#9a948c', c: '#4f6b45' },
    map: [
      '.aaaaaaaaaa.',
      'abbbbbbbbbba',
      'abbbbcbbbbba',
      'abbcbcbcbbba',
      'abbbccbbbbba',
      'abcbbcbbcbba',
      'abbccccbbbba',
      'abcbbcbbcbba',
      'abbbccbbbbba',
      'abbbbcbbbbba',
      'abbbbbbbbbba',
      '.aaaaaaaaaa.',
    ],
  },
  ammonite: {
    pal: { a: '#5a3a1c', b: '#c08a4a', c: '#e8c08a' },
    map: [
      '...aaaaaa...',
      '..abbbbbba..',
      '.abccccccba.',
      'abcbbbbbbcba',
      'abcbaaaabcba',
      'abcbabbabcba',
      'abcbabcabcba',
      'abcbabaabcba',
      'abcbbaabbcba',
      '.abccbbbcba.',
      '..abbbbbba..',
      '...aaaaaa...',
    ],
  },
  trilobite: {
    pal: { a: '#3e3530', b: '#8a7a68', c: '#b8a68e' },
    map: [
      '....aaaa....',
      '..aabbbbaa..',
      '.abbcbbcbba.',
      '.abbbbbbbba.',
      '.aaaaaaaaaa.',
      '.abcbbbbcba.',
      '.aaaaaaaaaa.',
      '.abcbbbbcba.',
      '.aaaaaaaaaa.',
      '..abcbbcba..',
      '...abbbba...',
      '....aaaa....',
    ],
  },
  nugget: {
    pal: { a: '#6e4a0c', b: '#f0b830', c: '#fff0a0', d: '#c08a18' },
    map: [
      '............',
      '....aaa.....',
      '...abbbaa...',
      '..abccbbba..',
      '.abccbbbbba.',
      '.abcbbbbdba.',
      'abbbbbbbdba.',
      'abbbbbbddba.',
      '.abbbbdddba.',
      '..aabbddaa..',
      '....aaaa....',
      '............',
    ],
  },
  tooth: {
    pal: { a: '#6e5a40', b: '#efe4c8', c: '#c8b690' },
    map: [
      '............',
      '..aaaaaaaa..',
      '.abbcbbcbba.',
      '.abbcbbcbba.',
      '.abbcbbcbba.',
      '.abbbbbbbba.',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '..abba.abba.',
      '..abba..aba.',
      '...aa....a..',
      '............',
    ],
  },
  geode: {
    pal: { a: '#3a3634', b: '#8a847e', c: '#e8e0f0', d: '#9b6ad8', e: '#e0c8ff' },
    map: [
      '....aaaa....',
      '..aabbbbaa..',
      '.abbccccbba.',
      '.abcddddcba.',
      'abcdeddedcba',
      'abcddeeddcba',
      'abcdeddedcba',
      'abcddddddcba',
      '.abcddddcba.',
      '.abbccccbba.',
      '..aabbbbaa..',
      '....aaaa....',
    ],
  },
  amber: {
    pal: { a: '#7a3e06', b: '#f09a20', c: '#ffd070', d: '#3a2410', e: '#9ab0c0' },
    map: [
      '.....aa.....',
      '....abba....',
      '...abccba...',
      '..abccccba..',
      '..abcbbcba..',
      '.abcbddbcba.',
      '.abbdeedbba.',
      '.abbbddbbba.',
      '.abbbbbbbba.',
      '..abbbbbba..',
      '...aabbaa...',
      '.....aa.....',
    ],
  },
  medal: {
    pal: { a: '#4a2e08', b: '#c83a30', c: '#b8861c', d: '#f0c040', e: '#fff0a0' },
    map: [
      '..abba.abba.',
      '..abbaabba..',
      '...abbbba...',
      '....abba....',
      '....abba....',
      '....aaaa....',
      '...acccca...',
      '..acddddca..',
      '..acdedeca..',
      '..acddddca..',
      '...acccca...',
      '....aaaa....',
    ],
  },
  core: {
    pal: { a: '#2a2624', b: '#9a948c', c: '#c9b89a', d: '#6a5a8a', e: '#b8583a', f: '#d8d2c8' },
    map: [
      '...aaaaaa...',
      '..affffffa..',
      '..acccccca..',
      '..acccccca..',
      '..adddddda..',
      '..adddddda..',
      '..aeeeeeea..',
      '..aeeeeeea..',
      '..abbbbbba..',
      '..adddddda..',
      '..acccccca..',
      '...aaaaaa...',
    ],
  },
  lamp: {
    pal: { a: '#2e261c', b: '#8a6a3a', c: '#ffd070', d: '#fff6d0' },
    map: [
      '....aaaa....',
      '...a....a...',
      '...a....a...',
      '..aaaaaaaa..',
      '..abbbbbba..',
      '..abccccba..',
      '..abcddcba..',
      '..abcddcba..',
      '..abccccba..',
      '..abbbbbba..',
      '..aaaaaaaa..',
      '...aaaaaa...',
    ],
  },
};

const findCache = new Map<string, string>();

/** Картинка находки. `ghost` — силуэт ещё не найденной (для коллекции). */
export function findTexture(id: string, ghost = false): string {
  const key = `${id}:${ghost ? 1 : 0}`;
  const hit = findCache.get(key);
  if (hit !== undefined) return hit;
  const sp = FIND_SPRITES[id];
  if (!sp) return '';
  const px = new Pixels();
  sp.map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || !sp.pal[ch]) continue;
      px.set(x + 2, y + 2, ghost ? [40, 34, 30] : hex(sp.pal[ch]), ghost ? 200 : 255);
    }
  });
  const url = px.toUrl();
  findCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Питомцы — кольская фауна, 12×12, мордой вправо (сова — анфас: так её и
// знают). Контур `a` у всех один и тот же, тёмный: на тёмной кнопке лагеря
// зверёк читается силуэтом, а не пятном.
// ---------------------------------------------------------------------------

const PET_SPRITES: Record<string, Sprite> = {
  lemming: {
    // Норвежский лемминг: чёрная голова и спина, золотые бока, светлое брюхо.
    pal: {
      a: '#1c120c',
      b: '#2e241e',
      c: '#d0913e',
      d: '#f0d4a4',
      e: '#ffffff',
      n: '#e89a9a',
    },
    map: [
      '............',
      '............',
      '...aaaaa....',
      '..abbbbbaa..',
      '.abbbbbbbba.',
      '.abbbbbbbeba',
      'acccbbbbbbbn',
      'accccccccba.',
      'acccccccccca',
      '.addddddddda',
      '..aa.a..aa..',
      '............',
    ],
  },
  fox: {
    pal: { a: '#3a3a46', b: '#f4f6fa', c: '#c8d0dc', d: '#1c1c22', e: '#1c1c22' },
    map: [
      '........a.a.',
      '.......abab.',
      '.......abbba',
      '......abbeba',
      'aa....abbbbd',
      'abca.abbbbaa',
      'abbbabbbbba.',
      '.abbbbbbbca.',
      '..abbbbbbca.',
      '..abcabcabca',
      '..aa.aa.aa..',
      '............',
    ],
  },
  wolverine: {
    pal: { a: '#140c08', b: '#4a3222', c: '#c8a070', d: '#2a1a10', e: '#000000' },
    map: [
      '............',
      '............',
      '.......aa...',
      '.aa..aabbaa.',
      'abba.abbbbba',
      'abbbabcccbeb',
      '.abbbbbbbbbd',
      '.abccccccbba',
      '..abbbbbbba.',
      '..abdabdabda',
      '..aa.aa.aa..',
      '............',
    ],
  },
  raven: {
    pal: { a: '#05060a', b: '#22242e', c: '#4a4e5c', d: '#6a6e7c', e: '#e8e8f0' },
    map: [
      '............',
      '......aaa...',
      '.....abbba..',
      '.....abebbaa',
      '.....abbbacc',
      '...aabbbba..',
      '..abbccbbba.',
      '.abbccccbba.',
      'abbbbbbbba..',
      'aaabbbbba...',
      '.....d.d....',
      '....dd.dd...',
    ],
  },
  owl: {
    pal: {
      a: '#3a3a46',
      b: '#f6f7fb',
      c: '#2a2a30',
      d: '#8a8e9a',
      e: '#ffd23a',
      f: '#000000',
      g: '#c89a3a',
    },
    map: [
      '............',
      '...aaaaaa...',
      '..abbbbbba..',
      '.abbbbbbbba.',
      '.abeebbeeba.',
      '.abefbbfeba.',
      '.abbbbcbbba.',
      '.abdbbbbdba.',
      '.abbbdbdbba.',
      '.abdbbbbdba.',
      '..abbbbbba..',
      '...agaaga...',
    ],
  },
  calf: {
    pal: { a: '#1e120a', b: '#8a5a32', c: '#d8b890', d: '#5a3a1e', e: '#000000', g: '#e8dcc8' },
    map: [
      '.......g.g..',
      '.......gag..',
      '........abba',
      '.......abbeb',
      '.......abbbd',
      '.aaaaaaabba.',
      'abbbbbbbbba.',
      'abbbbbbbbba.',
      '.acccccccba.',
      '..ab.ab.ab..',
      '..ab.ab.ab..',
      '..dd.dd.dd..',
    ],
  },
};

const petCache = new Map<string, string>();

/** Питомец. `ghost` — силуэт того, кого ещё нет. */
export function petTexture(id: string, ghost = false): string {
  const key = `${id}:${ghost ? 1 : 0}`;
  const hit = petCache.get(key);
  if (hit !== undefined) return hit;
  const sp = PET_SPRITES[id];
  if (!sp) return '';
  // Без полей: зверёк занимает всю картинку — на кнопке он маленький.
  const px = new Pixels(12);
  sp.map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || !sp.pal[ch]) continue;
      px.set(x, y, ghost ? [40, 34, 30] : hex(sp.pal[ch]), ghost ? 200 : 255);
    }
  });
  const url = px.toUrl();
  petCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Передачка: коробка в крафтовой бумаге, перевязанная бечёвкой, с сургучной
// печатью цвета редкости — редкость видна с первого взгляда, как у сундука.
// ---------------------------------------------------------------------------

const PARCEL_MAP = [
  '............',
  '...cc.cc....',
  '.aaaacaaaaa.',
  '.abbbcbbbda.',
  '.abbbcbbbda.',
  '.acccecccca.',
  '.abbeeebbda.',
  '.abbbebbbda.',
  '.abbbcbbbda.',
  '.adddcdddda.',
  '.aaaaaaaaaa.',
  '............',
];

const parcelCache = new Map<string, string>();

export function parcelTexture(seal: string): string {
  const hit = parcelCache.get(seal);
  if (hit !== undefined) return hit;
  const pal: Record<string, string> = {
    a: '#3a2814',
    b: '#b58a58',
    c: '#efe2c2',
    d: '#8a6638',
    e: seal,
  };
  const px = new Pixels();
  PARCEL_MAP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      px.set(x + 2, y + 2, hex(pal[ch]));
    }
  });
  const url = px.toUrl();
  parcelCache.set(seal, url);
  return url;
}

// ---------------------------------------------------------------------------
// Слеза гаста — так выглядит ключ от сундука. Бледно-голубая капля с белым
// бликом слева, как предмет в Майнкрафте: узнаётся с первого взгляда.
// ---------------------------------------------------------------------------

const TEAR_MAP = [
  '.....aa.....',
  '....abca....',
  '....abca....',
  '...abccda...',
  '...abccda...',
  '..abcccdda..',
  '..abcccdda..',
  '.abccccddda.',
  '.abccccddda.',
  '.abbcccddda.',
  '..abbcddda..',
  '...aaaaaa...',
];

let tearUrl: string | undefined;

export function tearTexture(): string {
  if (tearUrl !== undefined) return tearUrl;
  const pal: Record<string, string> = {
    a: '#4f8490',
    b: '#ffffff',
    c: '#d8f6fa',
    d: '#8fd0da',
  };
  const px = new Pixels(12);
  TEAR_MAP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.') px.set(x, y, hex(pal[ch]));
    }
  });
  tearUrl = px.toUrl();
  return tearUrl;
}

// ---------------------------------------------------------------------------
// Сейд-камень: тёмный базальт с резным светящимся знаком — два кольца и
// ядро. Ни одна порода так не светится, поэтому его не спутать ни с чем.
// ---------------------------------------------------------------------------

const SEID_MAP = [
  'abbbbcbbbbbbcbba',
  'bbcbbbbbbbbbbbbb',
  'bbbbbddddddbbbcb',
  'bbbddbbbbbbddbbb',
  'bbdbbbbddbbbbdbb',
  'bcdbbbdbbdbbbdcb',
  'bdbbbdbeebdbbbdb',
  'bdbbdbeeeebdbbdb',
  'bdbbdbeeeebdbbdb',
  'bdbbbdbeebdbbbdb',
  'bcdbbbdbbdbbbdcb',
  'bbdbbbbddbbbbdbb',
  'bbbddbbbbbbddbbb',
  'bcbbbddddddbbbbb',
  'bbbbbbbbbbbbbcbb',
  'abbcbbbbbbbbbbba',
];

let seidUrl: string | undefined;

export function seidTexture(): string {
  if (seidUrl !== undefined) return seidUrl;
  const pal: Record<string, string> = {
    a: '#15181c',
    b: '#262b33',
    c: '#3a414c',
    d: '#3fe6d0',
    e: '#c8fff6',
  };
  const px = new Pixels();
  SEID_MAP.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) px.set(x, y, hex(pal[row[x]]));
  });
  seidUrl = px.toUrl();
  return seidUrl;
}

// ---------------------------------------------------------------------------
// Лесоповал. Кора — плитка 16×16, повторяется вдоль бревна; у берёз — белая
// с чёрными чечевичками, у сосны — рыжие пластины, у остальных — продольные
// трещины. Крона — 24×24: хвойные ёлочкой со снегом на лапах, лиственные
// шапкой. Всё рисуется один раз за сессию и лежит в кеше.
// ---------------------------------------------------------------------------

const barkCache = new Map<number, string>();

export function barkTexture(species: number): string {
  const hit = barkCache.get(species);
  if (hit !== undefined) return hit;
  const sp = SPECIES[species];
  if (!sp) return '';
  const rnd = rng32(species * 7919 + 11);
  const base = hex(sp.bark);
  const dark = hex(sp.dark);
  const light = hex(sp.light);
  const px = new Pixels();
  const birch = sp.id === 'birch' || sp.id === 'karelian';
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) px.set(x, y, mix(base, rnd() < 0.5 ? light : dark, rnd() * 0.18));
  if (birch) {
    // Чечевички — короткие горизонтальные чёрточки.
    for (let k = 0; k < 9; k++) {
      const y = Math.floor(rnd() * N);
      const x0 = Math.floor(rnd() * N);
      const len = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < len; i++) px.set((x0 + i) % N, y, mix(dark, BLACK, 0.3));
    }
    if (sp.id === 'karelian') {
      // Узор карельской берёзы проступает бурыми завитками.
      for (let k = 0; k < 5; k++) {
        const cx = Math.floor(rnd() * N);
        const cy = Math.floor(rnd() * N);
        px.set(cx, cy, hex('#8a5a32'));
        px.set((cx + 1) % N, cy, hex('#a06a3a'));
        px.set(cx, (cy + 1) % N, hex('#6a4024'));
      }
    }
  } else if (sp.id === 'pine' || sp.id === 'larch') {
    // Пластины коры: горизонтальные тёмные швы со сдвигом.
    for (let y = 0; y < N; y += 4) {
      const off = Math.floor(rnd() * 8);
      for (let x = 0; x < N; x++) if ((x + off) % 8 !== 0) px.set(x, y, mix(dark, BLACK, 0.2));
      for (let x = 0; x < N; x++)
        if ((x + off) % 8 === 0) for (let d = 1; d < 4; d++) px.set(x, y + d, dark);
      for (let x = 0; x < N; x += 3) px.set((x + off) % N, y + 1, light);
    }
  } else {
    // Продольные трещины: коротко, но по всей высоте — кора читается ростом.
    for (let k = 0; k < 6; k++) {
      let x = Math.floor(rnd() * N);
      for (let y = 0; y < N; y++) {
        px.set(x, y, dark);
        if (rnd() < 0.25) x = (x + (rnd() < 0.5 ? 1 : N - 1)) % N;
      }
    }
    for (let k = 0; k < 10; k++) px.set(Math.floor(rnd() * N), Math.floor(rnd() * N), light);
  }
  const url = px.toUrl();
  barkCache.set(species, url);
  return url;
}

const boardCache = new Map<number, string>();

/**
 * Доски породы: три строганые плахи стопкой, срез — цвет древесины, торцы
 * темнее, волокно продольными штрихами. Строганое дерево светлее коры —
 * так доски и брёвна не путаются в одном списке.
 */
export function boardTexture(species: number): string {
  const hit = boardCache.get(species);
  if (hit !== undefined) return hit;
  const sp = SPECIES[species];
  if (!sp) return '';
  const rnd = rng32(species * 4219 + 5);
  const wood = hex(sp.wood);
  const dark = mix(wood, hex('#5a3a1e'), 0.55);
  const light = mix(wood, WHITE, 0.35);
  const px = new Pixels();
  const planks = [
    { y: 3, x0: 2, x1: 13 },
    { y: 7, x0: 1, x1: 14 },
    { y: 11, x0: 2, x1: 15 },
  ];
  for (const pl of planks) {
    for (let y = pl.y; y < pl.y + 4; y++)
      for (let x = pl.x0; x <= pl.x1; x++) {
        const edge = y === pl.y + 3 || x === pl.x0 || x === pl.x1;
        const top = y === pl.y;
        px.set(
          x,
          y,
          edge ? dark : top ? light : mix(wood, rnd() < 0.5 ? light : dark, rnd() * 0.2),
        );
      }
    // Волокно: два штриха вдоль плахи.
    for (let k = 0; k < 2; k++) {
      const y = pl.y + 1 + k;
      const x0 = pl.x0 + 1 + Math.floor(rnd() * 4);
      for (let x = x0; x < Math.min(pl.x1, x0 + 4 + Math.floor(rnd() * 5)); x++)
        px.set(x, y, mix(wood, dark, 0.45));
    }
  }
  const url = px.toUrl();
  boardCache.set(species, url);
  return url;
}

const crownCache = new Map<string, string>();

/** Крона. `seid` — сейд-сосна: хвоя с бирюзовым светом. */
export function crownTexture(species: number, seid = false): string {
  const key = `${species}:${seid ? 1 : 0}`;
  const hit = crownCache.get(key);
  if (hit !== undefined) return hit;
  const sp = SPECIES[species];
  if (!sp) return '';
  const S = 24;
  const px = new Pixels(S);
  const rnd = rng32(species * 131 + (seid ? 7 : 1));
  const leaf = hex(seid ? '#2a8a7a' : sp.leaf);
  const dark = mix(leaf, BLACK, 0.35);
  const lite = mix(leaf, WHITE, 0.25);
  const snow: RGB = [236, 242, 248];
  if (sp.conifer) {
    // Три яруса лап, снизу шире; снег на верхнем крае каждого.
    const tiers = [
      [4, 12, 11],
      [9, 17, 8],
      [14, 23, 5],
    ];
    for (const [y0, y1, half] of tiers) {
      for (let y = y0; y <= y1; y++) {
        const w = Math.round(((y - y0 + 1) / (y1 - y0 + 1)) * half) + 1;
        for (let x = 12 - w; x <= 11 + w; x++) {
          const edge = x === 12 - w || x === 11 + w;
          px.set(x, y, edge ? dark : rnd() < 0.2 ? lite : leaf);
        }
        if (y === y0 + 1) for (let x = 13 - w; x <= 10 + w; x += 2) px.set(x, y - 1, snow);
      }
    }
    px.set(11, 3, dark);
    px.set(12, 3, dark);
    px.set(11, 2, snow);
    px.set(12, 2, snow);
  } else {
    // Шапка: несколько кругов листвы внахлёст.
    const blobs = [
      [12, 13, 9],
      [7, 12, 6],
      [17, 12, 6],
      [12, 7, 6],
    ];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let inside = false;
        let edge = false;
        for (const [cx, cy, r] of blobs) {
          const d = Math.hypot(x - cx, y - cy);
          if (d <= r) inside = true;
          if (d > r - 1.2 && d <= r) edge = true;
        }
        if (!inside) continue;
        px.set(x, y, edge ? dark : rnd() < 0.22 ? lite : rnd() < 0.15 ? dark : leaf);
      }
    if (sp.id === 'rowan')
      // Гроздья рябины.
      for (let k = 0; k < 7; k++) {
        const x = 5 + Math.floor(rnd() * 14);
        const y = 8 + Math.floor(rnd() * 10);
        px.set(x, y, hex('#e8402a'));
        px.set(x + 1, y, hex('#c82a1a'));
      }
    // Снег на макушке.
    for (let x = 8; x <= 15; x++) if (rnd() < 0.7) px.set(x, 2, snow);
  }
  if (seid)
    for (let k = 0; k < 10; k++)
      px.set(4 + Math.floor(rnd() * 16), 4 + Math.floor(rnd() * 18), hex('#c8fff6'));
  const url = px.toUrl();
  crownCache.set(key, url);
  return url;
}

const branchCache = new Map<number, string>();

/** Сучок, растущий ВПРАВО; левый — тот же, зеркально (CSS). */
export function branchTexture(species: number): string {
  const hit = branchCache.get(species);
  if (hit !== undefined) return hit;
  const sp = SPECIES[species];
  if (!sp) return '';
  const px = new Pixels(12);
  const bark = hex(sp.dark);
  const leaf = hex(sp.leaf);
  const snow: RGB = [236, 242, 248];
  // Ветка чуть вверх от ствола, на конце — пучок листвы или хвои.
  for (let x = 0; x < 9; x++) {
    const y = 7 - Math.floor(x / 3);
    px.set(x, y, bark);
    px.set(x, y + 1, mix(bark, BLACK, 0.3));
  }
  for (let y = 2; y <= 6; y++)
    for (let x = 6; x <= 11; x++) if (Math.hypot(x - 9, y - 4) <= 2.6) px.set(x, y, leaf);
  px.set(8, 2, snow);
  px.set(9, 2, snow);
  px.set(10, 2, snow);
  const url = px.toUrl();
  branchCache.set(species, url);
  return url;
}

const MARKS: Record<string, Sprite> = {
  burl: {
    pal: { a: '#3a2414', b: '#7a4a28', c: '#a86a3a', d: '#c88a52' },
    map: [
      '............',
      '....aaaa....',
      '..aabbcbaa..',
      '.abccbdcbba.',
      '.abcdccbcba.',
      'abcbcdcbccba',
      'abccbccdcbba',
      '.abcbdcbcba.',
      '.abbccbccba.',
      '..aabbbbaa..',
      '....aaaa....',
      '............',
    ],
  },
  hollow: {
    pal: { a: '#2a1a10', b: '#120a06', c: '#4a3222' },
    map: [
      '............',
      '............',
      '....cccc....',
      '...caaaac...',
      '..caabbaac..',
      '..cabbbbac..',
      '..cabbbbac..',
      '..caabbaac..',
      '...caaaac...',
      '....cccc....',
      '............',
      '............',
    ],
  },
  chaga: {
    pal: { a: '#0e0a08', b: '#2a1e16', c: '#5a3a22', d: '#8a5a32' },
    map: [
      '............',
      '...aa.......',
      '..abba.aa...',
      '.abcbbaaba..',
      '.abbcbbbba..',
      'abbbbcbbbba.',
      'abcbbbbcbba.',
      '.abbbdbbba..',
      '..abbbbba...',
      '...aaaaa....',
      '............',
      '............',
    ],
  },
  figured: {
    pal: { a: '#8a5a32', b: '#c88a52' },
    map: [
      '............',
      '..aa....aa..',
      '.a..a..a..a.',
      '.a.b.a.a.b.a',
      '..a..a..a.a.',
      '...aa....a..',
      '....a..aa...',
      '...a.b.a....',
      '..a...a..aa.',
      '...aaa..a..a',
      '.........aa.',
      '............',
    ],
  },
};

const markCache = new Map<string, string>();

/** Метка особого бревна: капокорень, дупло, чага, свиль. */
export function logMarkTexture(kind: string): string {
  const hit = markCache.get(kind);
  if (hit !== undefined) return hit;
  const sp = MARKS[kind];
  if (!sp) return '';
  const px = new Pixels(12);
  sp.map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch !== '.' && sp.pal[ch]) px.set(x, y, hex(sp.pal[ch]));
    }
  });
  const url = px.toUrl();
  markCache.set(kind, url);
  return url;
}

// ---------------------------------------------------------------------------
// Двор (v2.54): метеорит, Куйва, медведь и Барыга. Фигуры собираются из
// простых форм, контур — там, где пиксель граничит с пустотой: так силуэт
// читается на любом фоне поля и сцены.
// ---------------------------------------------------------------------------

/** Обвести залитые пиксели: граничащий с пустотой темнеет до `line`. */
function outline(px: Pixels, line: RGB): void {
  const n = px.n;
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && px.data[(y * n + x) * 4 + 3] > 0;
  const edge: [number, number][] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (
        solid(x, y) &&
        (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))
      )
        edge.push([x, y]);
  for (const [x, y] of edge) px.set(x, y, line);
}

/**
 * Контур СНАРУЖИ фигуры: пустые пиксели рядом с залитыми. `outline` красит
 * крайние пиксели самой фигуры, и деталь в два пикселя (ножка табурета)
 * целиком уходила в чёрное.
 */
function outlineOut(px: Pixels, line: RGB): void {
  const n = px.n;
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < n && y < n && px.data[(y * n + x) * 4 + 3] > 0;
  const add: [number, number][] = [];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (
        !solid(x, y) &&
        (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
      )
        add.push([x, y]);
  for (const [x, y] of add) px.set(x, y, line);
}

let meteorUrl: string | undefined;

/** Метеорит: обугленный камень с раскалёнными трещинами. */
export function meteorTexture(): string {
  if (meteorUrl !== undefined) return meteorUrl;
  const px = new Pixels();
  const rnd = rng32(1908);
  const rock = hex('#4a3a30');
  const dark = hex('#2a1e18');
  const hot = hex('#ff6a1a');
  const core = hex('#ffd35a');
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x - 7.5) / 6.6;
      const dy = (y - 8) / 6;
      const r = dx * dx + dy * dy + (rnd() - 0.5) * 0.18;
      if (r > 1) continue;
      px.set(x, y, mix(rock, rnd() < 0.5 ? dark : WHITE, rnd() * 0.16));
    }
  // Трещины: две ломаные от центра, у центра — жёлтое ядро.
  for (const [ax, ay] of [
    [1, 1],
    [-1, 0.6],
    [0.4, -1],
  ]) {
    let x = 7.5;
    let y = 8;
    for (let k = 0; k < 6; k++) {
      px.set(Math.round(x), Math.round(y), k < 2 ? core : hot);
      x += ax + (rnd() - 0.5) * 0.8;
      y += ay + (rnd() - 0.5) * 0.8;
    }
  }
  px.set(7, 8, core);
  px.set(8, 8, core);
  px.set(7, 7, hex('#fff3b0'));
  outline(px, hex('#140c08'));
  meteorUrl = px.toUrl();
  return meteorUrl;
}

let kuivaUrl: string | undefined;

/**
 * Куйва — каменный великан с Сейдозера: лицо, проступившее в скале.
 * Глаза светятся тем же бирюзовым, что сейд-камни, — это их хозяин.
 */
export function kuivaTexture(): string {
  if (kuivaUrl !== undefined) return kuivaUrl;
  const n = 24;
  const px = new Pixels(n);
  const rnd = rng32(1973);
  const stone = hex('#6a727c');
  const dark = hex('#3a4048');
  const light = hex('#9aa4ae');
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x - 11.5) / 11.2;
      const dy = (y - 12.5) / 11.4;
      if (dx * dx * (y > 16 ? 1.25 : 1) + dy * dy > 1) continue;
      // Свет сверху-слева: скала объёмная.
      const lit = 0.5 - (dx + dy) * 0.35;
      px.set(x, y, mix(mix(dark, light, Math.max(0, Math.min(1, lit))), stone, rnd() * 0.35));
    }
  // Трещины по скале.
  for (let k = 0; k < 5; k++) {
    let x = 2 + Math.floor(rnd() * 20);
    let y = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < 6; i++) {
      // Трещина — только по скале: за контуром лица она висела бы в воздухе.
      if (x >= 0 && x < n && px.data[(y * n + x) * 4 + 3] > 0) px.set(x, y, dark);
      y += 1;
      x += rnd() < 0.5 ? -1 : 1;
    }
  }
  // Брови — тяжёлый выступ.
  for (let x = 4; x <= 19; x++) if (x < 11 || x > 12) px.set(x, 7, light);
  for (let x = 5; x <= 18; x++) if (x < 11 || x > 12) px.set(x, 8, dark);
  // Глаза.
  const eye = hex('#3fe6d0');
  const glow = hex('#c8fff6');
  for (const ex of [7, 15]) {
    for (let y = 9; y <= 11; y++) for (let x = ex - 1; x <= ex + 2; x++) px.set(x, y, dark);
    px.set(ex, 10, eye);
    px.set(ex + 1, 10, eye);
    px.set(ex, 9, glow);
  }
  // Нос — светлая грань.
  for (let y = 9; y <= 15; y++) px.set(11, y, light);
  for (let y = 12; y <= 15; y++) px.set(12, y, dark);
  // Рот — тёмная щель со скошенными краями.
  for (let x = 7; x <= 16; x++) px.set(x, 18, hex('#1a1c20'));
  px.set(6, 17, dark);
  px.set(17, 17, dark);
  outline(px, hex('#15181c'));
  kuivaUrl = px.toUrl();
  return kuivaUrl;
}

let bearUrl: string | undefined;

/**
 * Медведь сбоку, мордой вправо. Медведя от собаки и лошади отличают горб на
 * холке, короткие толстые лапы почти под брюхом и круглые уши — на этом и
 * держится силуэт.
 */
export function bearTexture(): string {
  if (bearUrl !== undefined) return bearUrl;
  // 20×20: на шестнадцати пикселях контур съедал голову, и выходила капибара.
  const n = 20;
  const px = new Pixels(n);
  const fur = hex('#6a4428');
  const dark = hex('#3e2614');
  const light = hex('#8e6440');
  const snout = hex('#b08a5e');
  const inE = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
    ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  // Горб выше головы, голова опущена и вынесена вперёд — медвежья посадка.
  const body = (x: number, y: number) => inE(x, y, 8, 12.4, 7, 3.8);
  const hump = (x: number, y: number) => inE(x, y, 9.4, 9.2, 4, 2.7);
  const head = (x: number, y: number) => inE(x, y, 15.4, 12.2, 3, 2.8);
  const ear = (x: number, y: number) =>
    inE(x, y, 13.9, 9.3, 1.1, 1.1) || inE(x, y, 16.6, 9.5, 1.1, 1.1);
  const muzzle = (x: number, y: number) => x >= 17 && x <= 19 && y >= 12 && y <= 14;
  const leg = (x: number, y: number) =>
    y >= 14 && y <= 18 && ((x >= 2 && x <= 5) || (x >= 11 && x <= 14));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!(body(x, y) || hump(x, y) || head(x, y) || ear(x, y) || muzzle(x, y) || leg(x, y)))
        continue;
      let c = fur;
      if (y >= 16) c = dark;
      else if (!head(x, y) && !ear(x, y) && y <= 9) c = light;
      if (muzzle(x, y)) c = snout;
      px.set(x, y, c);
    }
  outline(px, hex('#1a0e06'));
  px.set(14, 9, dark);
  px.set(16, 10, dark);
  px.set(19, 12, hex('#120a06')); // нос
  px.set(16, 11, hex('#120a06')); // глаз
  bearUrl = px.toUrl();
  return bearUrl;
}

let barygaUrl: string | undefined;

/** Барыга: ушанка, телогрейка, мешок за плечом. */
export function barygaTexture(): string {
  if (barygaUrl !== undefined) return barygaUrl;
  const px = new Pixels();
  const hat = hex('#5a4a3e');
  const fur = hex('#8a7662');
  const skin = hex('#e0b48a');
  const coat = hex('#3a4438');
  const seam = hex('#27302a');
  const sack = hex('#b09060');
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // Мешок за левым плечом.
      if (x >= 1 && x <= 5 && y >= 7 && y <= 12 && (x - 3) ** 2 / 6 + (y - 9.5) ** 2 / 9 <= 1)
        px.set(x, y, sack);
      // Ушанка с опущенными ушами.
      if (y >= 1 && y <= 4 && x >= 5 && x <= 11) px.set(x, y, y === 4 ? fur : hat);
      if (y >= 4 && y <= 7 && (x === 4 || x === 12)) px.set(x, y, fur);
      // Лицо.
      if (y >= 5 && y <= 8 && x >= 5 && x <= 11) px.set(x, y, skin);
      // Телогрейка стёжкой.
      if (y >= 9 && y <= 15 && x >= 4 + (y > 13 ? 0 : 0) && x <= 12)
        px.set(x, y, y % 2 === 0 ? seam : coat);
    }
  // Глаза прищуром и щетина.
  px.set(6, 6, hex('#1a1210'));
  px.set(9, 6, hex('#1a1210'));
  for (let x = 6; x <= 10; x++) px.set(x, 8, hex('#9a7a5a'));
  outline(px, hex('#120e0a'));
  barygaUrl = px.toUrl();
  return barygaUrl;
}

// ---------------------------------------------------------------------------
// Рунные камни (v2.57): 32×32. Сланцевая плита с аркой сверху, свет слева
// сверху — светлая фаска там, тёмная внизу справа. Знак ВЫСЕЧЕН: жёлоб
// темнее камня, верхняя-левая стенка жёлоба в тени, нижний-правый край
// камня у жёлоба светлый — так резьба читается глубиной, а не краской.
// Со второй ступени в жёлобе залита светящаяся смальта цвета ступени, с
// третьей вокруг знака ореол, у пятой — искры. Раньше руна была тремя
// линиями на плитке, и владелец назвал её «ужасно и непонятно».
// ---------------------------------------------------------------------------

/** Знаки старшего футарка ломаными в поле 20×28 (как в SVG прежней иконки). */
const RUNE_STROKES: Record<string, [number, number][][]> = {
  sell: [
    [
      [7, 4],
      [7, 24],
    ],
    [
      [7, 11],
      [14, 5],
    ],
    [
      [7, 17],
      [14, 11],
    ],
  ],
  dmg: [
    [
      [6, 24],
      [6, 4],
      [14, 10],
      [14, 24],
    ],
  ],
  rate: [
    [
      [6, 24],
      [6, 4],
      [13, 8],
      [6, 13],
      [14, 24],
    ],
  ],
  loot: [
    [
      [9, 5],
      [4, 11],
      [9, 17],
    ],
    [
      [11, 11],
      [16, 17],
      [11, 23],
    ],
  ],
  token: [
    [
      [4, 5],
      [16, 23],
    ],
    [
      [16, 5],
      [4, 23],
    ],
  ],
  proc: [
    [
      [13, 3],
      [6, 11],
      [14, 17],
      [7, 25],
    ],
  ],
};

const RUNE_TIER_COLORS = ['#9aa7b4', '#4f8cff', '#b36cff', '#ffb020', '#ff5a6a'];

const runeCache = new Map<string, string>();

export function runeTexture(kind: string, tier: number): string {
  const t = Math.max(1, Math.min(5, Math.round(tier)));
  const key = `${kind}:${t}`;
  const hit = runeCache.get(key);
  if (hit !== undefined) return hit;
  const n = 40;
  const px = new Pixels(n);
  const rnd = rng32(kind.length * 131 + t * 17 + kind.charCodeAt(0) * 7);
  // Плита: высокая арка сверху, сколотые нижние углы.
  const inside = (x: number, y: number): boolean => {
    if (x < 5 || x > 34 || y < 2 || y > 38) return false;
    if (y < 14) return ((x - 19.5) / 15) ** 2 + ((y - 14) / 12) ** 2 <= 1;
    if (y >= 37 && (x < 7 || x > 32)) return false;
    if (y >= 38 && (x < 8 || x > 31)) return false;
    return true;
  };
  const stone = hex('#5d626b');
  const lightS = hex('#9aa0aa');
  const darkS = hex('#2e3137');
  // Крупные пятна (сетка 5×5) плюс зерно — поверхность живого камня.
  const blot = Array.from({ length: 81 }, () => rnd() * 0.22 - 0.11);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!inside(x, y)) continue;
      const lit = 0.55 - ((x - 20) / 30 + (y - 20) / 36);
      let c = mix(mix(darkS, lightS, Math.max(0, Math.min(1, lit))), stone, 0.4);
      const b = blot[Math.floor(y / 5) * 9 + Math.floor(x / 5)];
      c = b > 0 ? mix(c, WHITE, b) : mix(c, BLACK, -b);
      c = mix(c, rnd() < 0.5 ? WHITE : BLACK, rnd() * 0.08);
      px.set(x, y, c);
    }
  // Лишайник на простых камнях: они лежали в поле, не в сокровищнице.
  if (t <= 2)
    for (let k = 0; k < 5; k++) {
      const cx = 8 + Math.floor(rnd() * 24);
      const cy = 22 + Math.floor(rnd() * 14);
      for (let i = 0; i < 4; i++) {
        const x = cx + Math.floor(rnd() * 3) - 1;
        const y = cy + Math.floor(rnd() * 3) - 1;
        if (inside(x, y)) px.set(x, y, mix(hex('#7c8c52'), hex('#a8b870'), rnd()));
      }
    }
  // Трещины.
  for (let k = 0; k < 3; k++) {
    let x = 8 + Math.floor(rnd() * 24);
    let y = 26 + Math.floor(rnd() * 10);
    for (let i = 0; i < 6; i++) {
      if (inside(x, y)) px.set(x, y, mix(darkS, BLACK, 0.35));
      x += rnd() < 0.5 ? 1 : -1;
      y += rnd() < 0.65 ? -1 : 0;
    }
  }
  // Двойная фаска: внешний ряд ярче/темнее, внутренний — вполсилы.
  const edge = (x: number, y: number, d: number) =>
    !inside(x - d, y) || !inside(x, y - d)
      ? 'lit'
      : !inside(x + d, y) || !inside(x, y + d)
        ? 'dark'
        : null;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (!inside(x, y)) continue;
      const e1 = edge(x, y, 1);
      const e2 = edge(x, y, 2);
      if (e1 === 'lit') px.set(x, y, mix(lightS, WHITE, 0.35));
      else if (e1 === 'dark') px.set(x, y, mix(darkS, BLACK, 0.4));
      else if (e2 === 'lit') px.set(x, y, mix(px.get(x, y), WHITE, 0.18));
      else if (e2 === 'dark') px.set(x, y, mix(px.get(x, y), BLACK, 0.22));
    }
  // Жёлоб знака: ломаные в масштабе 1,3, толщиной 2–3 пикселя.
  const groove = new Set<number>();
  const put = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) groove.add(y * n + x);
  };
  for (const line of RUNE_STROKES[kind] ?? []) {
    for (let s2 = 1; s2 < line.length; s2++) {
      const [x0, y0] = line[s2 - 1];
      const [x1, y1] = line[s2];
      const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 3);
      for (let i = 0; i <= steps; i++) {
        const gx = 19.5 + (x0 + ((x1 - x0) * i) / steps - 10) * 1.3;
        const gy = 20 + (y0 + ((y1 - y0) * i) / steps - 14) * 1.3;
        const x = Math.round(gx - 0.5);
        const y = Math.round(gy - 0.5);
        put(x, y);
        put(x + 1, y);
        put(x, y + 1);
        put(x + 1, y + 1);
      }
    }
  }
  const glow = hex(RUNE_TIER_COLORS[t - 1]);
  const has = (x: number, y: number) => groove.has(y * n + x);
  // Ореол с третьей ступени.
  if (t >= 3)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!inside(x, y) || has(x, y)) continue;
        let near = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) if (has(x + dx, y + dy)) near += 1;
        if (near)
          px.set(x, y, mix(px.get(x, y), glow, Math.min(0.6, near * 0.025 + (t - 3) * 0.06)));
      }
  for (const idx of groove) {
    const x = idx % n;
    const y = Math.floor(idx / n);
    if (!inside(x, y)) continue;
    const shade = !has(x - 1, y) || !has(x, y - 1);
    const core = has(x + 1, y) && has(x, y + 1) && has(x - 1, y) && has(x, y - 1);
    if (t === 1) px.set(x, y, shade ? hex('#121418') : hex('#24272d'));
    else
      px.set(
        x,
        y,
        shade ? mix(glow, BLACK, 0.5) : core ? mix(glow, WHITE, 0.55) : mix(glow, WHITE, 0.12),
      );
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ] as const)
      if (inside(x + dx, y + dy) && !has(x + dx, y + dy))
        px.set(x + dx, y + dy, mix(px.get(x + dx, y + dy), WHITE, 0.32));
  }
  // Оковка с четвёртой ступени: металлические уголки с заклёпками внизу.
  if (t >= 4) {
    const metal = t === 4 ? hex('#d8a23a') : hex('#e8c060');
    const metalD = mix(metal, BLACK, 0.45);
    const metalL = mix(metal, WHITE, 0.45);
    for (const side of [0, 1]) {
      for (let i = 0; i < 6; i++) {
        const xa = side ? 33 - i : 6 + i;
        const ya = 36;
        if (inside(xa, ya)) px.set(xa, ya, i === 0 ? metalL : metal);
        if (inside(xa, ya + 1)) px.set(xa, ya + 1, metalD);
        const xb = side ? 33 : 6;
        const yb = 36 - i;
        if (inside(xb, yb)) px.set(xb, yb, metal);
        if (inside(xb + (side ? -1 : 1), yb)) px.set(xb + (side ? -1 : 1), yb, metalD);
      }
      const rx = side ? 32 : 7;
      px.set(rx, 35, metalL);
    }
  }
  // Пятая ступень: самоцвет в вершине арки и искры по камню.
  if (t === 5) {
    const gem = hex('#ff3a52');
    for (const [x, y, c] of [
      [19, 4, mix(gem, WHITE, 0.5)],
      [20, 4, gem],
      [19, 5, gem],
      [20, 5, mix(gem, BLACK, 0.4)],
    ] as const)
      px.set(x, y, c);
    for (let k = 0; k < 9; k++) {
      const x = 7 + Math.floor(rnd() * 26);
      const y = 5 + Math.floor(rnd() * 31);
      if (inside(x, y) && !has(x, y)) px.set(x, y, mix(glow, WHITE, 0.75));
    }
  }
  outline(px, t >= 2 ? mix(glow, BLACK, 0.72) : hex('#101216'));
  const url = px.toUrl();
  runeCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Верстак (v2.57): вещи из досок. 20×20, цвет дерева — от породы досок,
// чтобы заказ на берёзовые лыжи и был берёзовым. Крепь — рама забоя: две
// стойки и верхняк; рукоять — обструганная палка с оплёткой.
// ---------------------------------------------------------------------------

const benchCache = new Map<string, string>();

/** Строганая доска: светлый верх, тёмный низ, волокно штрихами. */
function plank(
  px: Pixels,
  x0: number,
  y0: number,
  w: number,
  h: number,
  wood: RGB,
  rnd: () => number,
) {
  const light = mix(wood, WHITE, 0.3);
  const dark = mix(wood, hex('#3a2410'), 0.55);
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const edge = y === y0 ? light : y === y0 + h - 1 || x === x0 + w - 1 ? dark : null;
      px.set(x, y, edge ?? mix(wood, rnd() < 0.5 ? light : dark, rnd() * 0.18));
    }
  if (w > 4)
    for (let k = 0; k < Math.max(1, Math.floor(w / 6)); k++) {
      const y = y0 + 1 + Math.floor(rnd() * Math.max(1, h - 2));
      const x = x0 + 1 + Math.floor(rnd() * (w - 4));
      for (let i = 0; i < 3; i++) px.set(x + i, y, mix(wood, dark, 0.5));
    }
}

export function benchTexture(item: string, species: number): string {
  const key = `${item}:${species}`;
  const hit = benchCache.get(key);
  if (hit !== undefined) return hit;
  const sp = SPECIES[Math.max(0, species)];
  const wood = hex(species < 0 ? '#e0b878' : sp.wood);
  const dark = mix(wood, hex('#2a1808'), 0.6);
  const iron = hex('#5a6068');
  const px = new Pixels(20);
  const rnd = rng32(item.length * 977 + species * 13 + 5);
  switch (item) {
    case 'box':
      for (let i = 0; i < 4; i++) plank(px, 2, 5 + i * 3, 16, 3, wood, rnd);
      plank(px, 2, 4, 2, 13, mix(wood, BLACK, 0.15), rnd);
      plank(px, 16, 4, 2, 13, mix(wood, BLACK, 0.15), rnd);
      break;
    case 'stool':
      plank(px, 2, 5, 16, 3, wood, rnd);
      plank(px, 4, 8, 2, 10, mix(wood, BLACK, 0.12), rnd);
      plank(px, 14, 8, 2, 10, mix(wood, BLACK, 0.12), rnd);
      plank(px, 5, 13, 10, 2, mix(wood, BLACK, 0.2), rnd);
      break;
    case 'skis':
      for (const x of [5, 12]) {
        plank(px, x, 3, 3, 15, wood, rnd);
        px.set(x, 2, mix(wood, WHITE, 0.3));
        px.set(x + 1, 1, mix(wood, WHITE, 0.3));
        for (let i = 0; i < 3; i++) px.set(x + i, 10, hex('#8a3a2a'));
      }
      break;
    case 'barrel':
      for (let i = 0; i < 5; i++) {
        const bulge = i === 0 || i === 4 ? 1 : 0;
        plank(
          px,
          4 + i * 2 + (i > 2 ? 1 : 0) - (i < 2 ? 0 : 0),
          3 + bulge,
          3,
          15 - bulge * 2,
          wood,
          rnd,
        );
      }
      for (const y of [6, 14])
        for (let x = 3; x <= 16; x++) px.set(x, y, mix(iron, WHITE, x < 7 ? 0.3 : 0));
      break;
    case 'frame':
      plank(px, 2, 2, 16, 2, wood, rnd);
      plank(px, 2, 16, 16, 2, wood, rnd);
      plank(px, 2, 2, 2, 16, wood, rnd);
      plank(px, 16, 2, 2, 16, wood, rnd);
      plank(px, 9, 4, 2, 12, wood, rnd);
      plank(px, 4, 9, 12, 2, wood, rnd);
      for (const [x, y] of [
        [5, 5],
        [12, 5],
        [5, 12],
        [12, 12],
      ])
        for (let dy = 0; dy < 3; dy++)
          for (let dx = 0; dx < 3; dx++)
            px.set(x + dx, y + dy, mix(hex('#9ac8e8'), WHITE, dy === 0 ? 0.4 : 0));
      break;
    case 'sled':
      plank(px, 3, 8, 14, 3, wood, rnd);
      plank(px, 3, 11, 14, 2, mix(wood, BLACK, 0.15), rnd);
      for (let x = 2; x <= 18; x++) px.set(x, 15, dark);
      px.set(18, 14, dark);
      px.set(19, 13, dark);
      plank(px, 5, 12, 2, 3, dark, rnd);
      plank(px, 13, 12, 2, 3, dark, rnd);
      break;
    case 'boat':
      for (let x = 1; x <= 18; x++) {
        const d = Math.abs(x - 9.5);
        const top = 9;
        const bottom = Math.round(15 - d * 0.35);
        for (let y = top; y <= bottom; y++)
          px.set(x, y, y === top ? mix(wood, WHITE, 0.3) : y % 2 ? wood : mix(wood, BLACK, 0.12));
      }
      for (let y = 1; y < 9; y++) px.set(9, y, dark);
      for (let y = 2; y < 8; y++)
        for (let x = 10; x < 10 + (y - 1); x++) px.set(x, y, hex('#e8dcc0'));
      break;
    case 'prop':
      // Рама забоя: две стойки и верхняк, под ним тень свода.
      plank(px, 2, 3, 16, 3, wood, rnd);
      plank(px, 3, 6, 3, 12, mix(wood, BLACK, 0.1), rnd);
      plank(px, 14, 6, 3, 12, mix(wood, BLACK, 0.1), rnd);
      for (let x = 6; x < 14; x++)
        for (let y = 6; y < 18; y++) px.set(x, y, mix(hex('#1a120c'), BLACK, (y - 6) / 24));
      break;
    case 'handle':
      // Обструганная рукоять наискось, толщиной три пикселя, с оплёткой.
      for (let i = 0; i < 15; i++) {
        const x = 3 + i;
        const y = 16 - i;
        px.set(x, y, mix(wood, WHITE, 0.35));
        px.set(x + 1, y, wood);
        px.set(x + 1, y + 1, mix(wood, BLACK, 0.12));
        px.set(x, y + 1, wood);
        px.set(x + 1, y + 2, dark);
      }
      for (let i = 1; i < 5; i++) {
        const x = 3 + i;
        const y = 16 - i;
        const c = i % 2 ? hex('#3a2a1a') : hex('#7a5232');
        px.set(x, y, c);
        px.set(x + 1, y, c);
        px.set(x, y + 1, c);
        px.set(x + 1, y + 1, c);
      }
      break;
  }
  outlineOut(px, hex('#1a0e06'));
  const url = px.toUrl();
  benchCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Бригада (v2.57): рабочий у забоя и вагонетка с породой. 16×16, рубаха у
// каждого своя — шестеро одинаковых читались бы кляксой.
// ---------------------------------------------------------------------------

const SHIRTS = ['#3a5a8a', '#8a3a3a', '#4a6a3a', '#7a5a2a', '#5a3a7a', '#2a6a6a'];
const workerCache = new Map<number, string>();

export function workerTexture(i: number): string {
  const hit = workerCache.get(i);
  if (hit !== undefined) return hit;
  const px = new Pixels();
  const shirt = hex(SHIRTS[i % SHIRTS.length]);
  const skin = hex('#e0b48a');
  const helmet = hex('#e8b830');
  const pants = hex('#2a2e38');
  // Каска с фонарём.
  for (let x = 5; x <= 10; x++) px.set(x, 2, helmet);
  for (let x = 4; x <= 11; x++) px.set(x, 3, mix(helmet, BLACK, x > 8 ? 0.2 : 0));
  px.set(7, 1, hex('#fff6c0'));
  px.set(8, 1, hex('#fff6c0'));
  // Лицо.
  for (let y = 4; y <= 6; y++) for (let x = 5; x <= 10; x++) px.set(x, y, skin);
  px.set(6, 5, hex('#1a1210'));
  px.set(9, 5, hex('#1a1210'));
  for (let x = 6; x <= 9; x++) px.set(x, 7, mix(skin, hex('#6a4a2a'), 0.5));
  // Рубаха и штаны.
  for (let y = 8; y <= 11; y++)
    for (let x = 4; x <= 11; x++)
      px.set(x, y, mix(shirt, y === 8 ? WHITE : BLACK, y === 8 ? 0.2 : (y - 8) * 0.05));
  for (let y = 12; y <= 14; y++) {
    for (let x = 5; x <= 7; x++) px.set(x, y, pants);
    for (let x = 8; x <= 10; x++) px.set(x, y, pants);
  }
  for (let x = 4; x <= 7; x++) px.set(x, 15, hex('#3a2616'));
  for (let x = 8; x <= 11; x++) px.set(x, 15, hex('#3a2616'));
  // Кирка на плече.
  for (let k = 0; k < 6; k++) px.set(12 - Math.floor(k / 2), 5 + k, hex('#8a5a2a'));
  for (let x = 11; x <= 15; x++) px.set(x, 4, hex('#9aa4ae'));
  px.set(15, 5, hex('#9aa4ae'));
  outline(px, hex('#120e0a'));
  const url = px.toUrl();
  workerCache.set(i, url);
  return url;
}

const cartCache = new Map<number, string>();

/** Вагонетка, полная породы `rock`. */
export function cartTexture(rock: number): string {
  const hit = cartCache.get(rock);
  if (hit !== undefined) return hit;
  const r = ROCKS[Math.max(0, Math.min(ROCKS.length - 1, rock))];
  const px = new Pixels();
  const rnd = rng32(rock * 211 + 3);
  const iron = hex('#6a727c');
  const ironD = hex('#3a4048');
  // Горка породы — кусками 2×2 с бликом, чтобы читалась порода, а не каша.
  for (let y = 1; y <= 7; y += 2)
    for (let x = 2; x <= 12; x += 2) {
      const d = Math.abs(x + 0.5 - 7.5) / 7.5 + (7 - y) / 8;
      if (d > 1) continue;
      const c = rnd() < 0.3 ? hex(r.fleck) : hex(r.base);
      px.set(x, y, mix(c, WHITE, 0.35));
      px.set(x + 1, y, c);
      px.set(x, y + 1, c);
      px.set(x + 1, y + 1, hex(r.dark));
    }
  // Кузов — трапеция с рёбрами.
  for (let y = 7; y <= 11; y++) {
    const inset = Math.floor((y - 7) / 2);
    for (let x = 2 + inset; x <= 13 - inset; x++)
      px.set(
        x,
        y,
        y === 7 ? mix(iron, WHITE, 0.3) : x === 2 + inset || x === 13 - inset ? ironD : iron,
      );
  }
  for (let y = 8; y <= 10; y++) px.set(7, y, ironD);
  // Колёса.
  for (const cx of [4, 11])
    for (let y = 11; y <= 13; y++)
      for (let x = cx - 1; x <= cx + 1; x++)
        px.set(x, y, x === cx && y === 12 ? hex('#c8ccd0') : hex('#1e2126'));
  outline(px, hex('#101216'));
  const url = px.toUrl();
  cartCache.set(rock, url);
  return url;
}
