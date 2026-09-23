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
