// Разлом блока как в Майнкрафте (v2.68.0): десять стадий одной трещины.
//
// Владелец: «анимация ломания ужасная. Если блок ломается за два удара,
// анимация должна быть из двух кадров, если за три — из трёх… Как в
// Майнкрафте! Там приятная, плавная анимация». У нас было три стадии, и
// считались они так, что при двух ударах первая пропускалась.
//
// Готовых стадий под нашу лицензию нет (искали, см. CLAUDE.md): у самого
// Майнкрафта они Mojang, у Luanti — CC BY-SA, у Terasology происхождение
// тянется к паку для Майнкрафта, ProgrammerArt (CC BY) — сетка крестиков.
// Поэтому стадии строятся здесь, по тому же принципу, что `destroy_stage`:
// ОДНА сеть трещин от точки удара, и стадия k открывает её до «времени» k —
// каждая следующая содержит предыдущую, трещина растёт, а не подменяется.

/** Сторона стадии в пикселях: мельче клетки 16 — линия тоньше и живее. */
export const CRACK_N = 32;
/** Стадий, как `destroy_stage_0…9`. */
export const CRACK_STAGES = 10;
/** Рисунков: у соседних клеток разные (`crackVariant`). */
export const CRACK_KINDS = 8;

/**
 * Стадия по доле урона: 0 — трещины нет, 1…10 — `destroy_stage_0…9`.
 * Урон делится поровну, поэтому у блока на N ударов (N ≤ 10) каждый удар
 * даёт свою стадию: два удара — половина сети и разлом, три — треть, две
 * трети и разлом.
 */
export function crackStageOf(left: number, max: number): number {
  if (!(max > 0) || left >= max) return 0;
  const done = 1 - Math.max(0, left) / max;
  return 1 + Math.max(0, Math.min(CRACK_STAGES - 1, Math.floor(done * CRACK_STAGES + 1e-6)));
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Карта «времени» трещины: для каждого пикселя — путь от точки удара до
 * него по трещине (Infinity — не трескается). Стадия k — всё, что ближе
 * порога k. Четыре вида по два рисунка: звезда от точки удара, раскол
 * надвое, скол от края, зигзаг.
 */
export function crackMap(kind: number): { t: Float32Array; max: number; ox: number; oy: number } {
  const n = CRACK_N;
  const v = ((kind % CRACK_KINDS) + CRACK_KINDS) % CRACK_KINDS;
  const rnd = mulberry(0x9e3779b1 ^ Math.imul(v + 1, 0x85ebca6b));
  const t = new Float32Array(n * n).fill(Infinity);
  const mark1 = (xi: number, yi: number, time: number) => {
    if (xi < 0 || yi < 0 || xi >= n || yi >= n) return;
    const i = yi * n + xi;
    if (time < t[i]) t[i] = time;
  };
  // Линия — в один пиксель. Пробовал главные ветки в два у точки удара
  // (волосок на пёстрой руде теряется), и владелец вернул тонкие: «тонкие
  // линии мне очень нравились, больше чем толстые».
  const mark = (x: number, y: number, time: number) => mark1(Math.round(x), Math.round(y), time);
  const style = v % 4;
  const bend = style === 3 ? 1.5 : 0.75;
  // Ветка: шаг в полпикселя, угол гуляет; по пути отходят ветки поменьше.
  const walk = (x: number, y: number, ang: number, len: number, t0: number, depth: number) => {
    let time = t0;
    const steps = Math.round(len / 0.5);
    for (let s = 0; s < steps; s++) {
      ang += (rnd() - 0.5) * bend * 0.35;
      x += Math.cos(ang) * 0.5;
      y += Math.sin(ang) * 0.5;
      time += 0.5;
      mark(x, y, time);
      if (x < -1 || y < -1 || x > n || y > n) return;
      if (depth < 2 && s > 4 && rnd() < (depth === 0 ? 0.045 : 0.03)) {
        const side = rnd() < 0.5 ? -1 : 1;
        walk(x, y, ang + side * (0.55 + rnd() * 0.6), len * (0.22 + rnd() * 0.22), time, depth + 1);
      }
    }
  };
  let ox = n / 2 + (rnd() - 0.5) * n * 0.32;
  let oy = n / 2 + (rnd() - 0.5) * n * 0.32;
  const a0 = rnd() * Math.PI * 2;
  mark(ox, oy, 0);
  if (style === 2) {
    // Скол от края: удар пришёлся в ребро, трещина веером уходит внутрь.
    const side = Math.floor(rnd() * 4);
    const p = n * (0.25 + rnd() * 0.5);
    [ox, oy] = side === 0 ? [p, 0] : side === 1 ? [n - 1, p] : side === 2 ? [p, n - 1] : [0, p];
    const inward = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][side];
    for (let i = 0; i < 3; i++)
      walk(ox, oy, inward + (i - 1) * (0.55 + rnd() * 0.25), n * (0.75 + rnd() * 0.3), 0, 0);
  } else if (style === 1) {
    // Раскол надвое: две главные ветки в разные стороны.
    walk(ox, oy, a0, n * (0.7 + rnd() * 0.3), 0, 0);
    walk(ox, oy, a0 + Math.PI + (rnd() - 0.5) * 0.5, n * (0.7 + rnd() * 0.3), 0, 0);
  } else {
    // Звезда (и зигзаг): лучи от точки удара.
    const arms = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < arms; i++)
      walk(
        ox,
        oy,
        a0 + (i * Math.PI * 2) / arms + (rnd() - 0.5) * 0.6,
        n * (0.5 + rnd() * 0.35),
        0,
        0,
      );
  }
  let max = 0;
  for (const x of t) if (x !== Infinity && x > max) max = x;
  return { t, max, ox, oy };
}

/** Порог стадии k (0…9): первая — пара пикселей у точки удара, десятая — вся сеть. */
export function stageLimit(k: number, max: number): number {
  return max * Math.pow((k + 1) / CRACK_STAGES, 1.2);
}

type RGBA = [number, number, number, number];

/**
 * Пиксели стадии k: трещина в один пиксель и светлая кромка под ней (без неё
 * тёмная линия на тёмной руде теряется), с шестой стадии — вмятина у точки
 * удара, на двух последних — отколотые углы. Возвращает RGBA CRACK_N×CRACK_N.
 */
export function crackStagePixels(kind: number, k: number): Uint8ClampedArray {
  const n = CRACK_N;
  const { t, max, ox, oy } = crackMap(kind);
  const lim = stageLimit(k, max);
  const out = new Uint8ClampedArray(n * n * 4);
  const put = (x: number, y: number, [r, g, b, a]: RGBA) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const i = (y * n + x) * 4;
    if (out[i + 3] >= a) return;
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  };
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && t[y * n + x] <= lim;
  const INK: RGBA = [16, 11, 8, 232];
  const LIP: RGBA = [255, 242, 222, 70];
  const DENT: RGBA = [16, 11, 8, 105];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (ink(x, y)) {
        put(x, y, INK);
        if (!ink(x + 1, y + 1)) put(x + 1, y + 1, LIP);
      }
    }
  // Вмятина: у точки удара порода крошится — пятно в шахматку, растёт.
  if (k >= 5) {
    const r = 1.2 + (k - 5) * 0.9;
    for (let y = Math.floor(oy - r); y <= Math.ceil(oy + r); y++)
      for (let x = Math.floor(ox - r); x <= Math.ceil(ox + r); x++)
        if (Math.hypot(x - ox, y - oy) <= r && (x + y) % 2 === 0) put(x, y, DENT);
  }
  // Отколотые углы: у каждого рисунка свои, на последних стадиях.
  if (k >= 8) {
    const rnd = mulberry(0x51ed27 ^ kind);
    const HOLE: RGBA = [8, 6, 5, 236];
    const corners: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [n - 1, 0, -1, 1],
      [0, n - 1, 1, -1],
      [n - 1, n - 1, -1, -1],
    ];
    for (const [cx, cy, dx, dy] of corners) {
      if (rnd() < 0.4) continue;
      const s = (k === 9 ? 3 : 2) + Math.floor(rnd() * 2);
      for (let i = 0; i < s; i++)
        for (let j = 0; j < s - i; j++) put(cx + dx * i, cy + dy * j, HOLE);
    }
  }
  return out;
}

const stripCache: string[] = [];

/**
 * Лента всех десяти стадий рисунка сверху вниз (CRACK_N × CRACK_N·10):
 * клетка показывает стадию сдвигом ленты, трансформом, — рост трещины
 * между ударами проигрывается без перерисовки.
 */
export function crackStrip(kind: number): string {
  const v = ((kind % CRACK_KINDS) + CRACK_KINDS) % CRACK_KINDS;
  if (stripCache[v]) return stripCache[v];
  if (typeof document === 'undefined') return '';
  const n = CRACK_N;
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n * CRACK_STAGES;
  const g = c.getContext('2d');
  if (!g) return '';
  for (let k = 0; k < CRACK_STAGES; k++) {
    const img = g.createImageData(n, n);
    img.data.set(crackStagePixels(v, k));
    g.putImageData(img, 0, k * n);
  }
  stripCache[v] = c.toDataURL();
  return stripCache[v];
}
