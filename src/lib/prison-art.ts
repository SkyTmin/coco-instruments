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
