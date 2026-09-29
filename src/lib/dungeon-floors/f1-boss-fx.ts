// Этаж 1, босс «Крысиный король» — ТЕХНИКИ (v2.85): всё, что король делает
// с миром. Тело короля и его кадры — `f1-art.ts`; здесь — метки ударов,
// контакт каждого удара, пыль, искры, щепа, трещины, тесак на полу, норы
// при призыве, лопнувший узел хвостов.
//
// Как устроено:
//   • МЕТКИ рисует одна зона-смотритель на весь бой (`f1_kingtele` на полу и
//     `f1_kingteleL` поверх темноты — их кладёт сценарий босса на старте).
//     Каждый кадр она читает живых королей из `paintSim()` и рисует поверх
//     красной метки движка (`m.tele`) свою: форму берёт из `m.tele`, время —
//     из `m.t`. Своих данных метке не нужно, поэтому мозг ради меток не
//     правится и метка не расходится с ударом ни на кадр.
//   • КОНТАКТ — зоны-картинки, которые мозг кладёт в МИГ урона (`vfx` в
//     `f1-brains.ts`): «пол» (`…_hit`, под мобами) и «свет» (`…_hitL`,
//     поверх темноты). Всё движется по `z.t` — в стоп-кадре кадр контакта
//     стоит вместе с миром. Те же рисунки зарегистрированы контактом удара
//     (`registerImpactPainter`) — ими пользуется лист кадров.
//   • ЧАСТИЦЫ — не состояние, а формула от зерна и возраста: вылет,
//     гравитация, отскок, скольжение, затухание. Кадр ничего не хранит, и
//     два кадра с одним возрастом одинаковы до пикселя.
//
// Язык меток один на все удары, чтобы его учили один раз:
//   • КУДА — видно с первого кадра: кромка формы костяными штрихами с тёмной
//     подложкой (читается и на красном ковре, и на буром полу);
//   • КОГДА — «фронт»: полоса идёт от короля к кромке и доходит до неё ровно
//     в миг урона; последние 0,2 с кромка сплошная и белая;
//   • ЖИВАЯ — штрихи бегут по кромке в сторону удара, пылинки втягиваются
//     к королю, хвосты кружат, шевроны ведут по линии переката.
import { hex, Px, TS } from '../dungeon-art';
import { frameLRU, paintSim, registerImpactPainter, registerZonePainter } from '../dungeon-paint';
import type { ImpactRec } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import { METAL, blade } from './f1-art';
import { KING_RAGE } from './f1-brains';

// ---------------------------------------------------------------------------
// Палитра этажа: кость и пыль нор, солома, щепа, ржавый металл, розовые
// хвосты и золото короны. Насыщенное — только искры и раскалённое.
// ---------------------------------------------------------------------------

const C = {
  ink: '#150f0b',
  bone: '#f0d8a0',
  boneHi: '#fff4d8',
  white: '#ffffff',
  // Остывание: белое → жёлтое → оранжевое → красное → бурое.
  hot: ['#ffffff', '#fff3b0', '#ffd24a', '#ff8a2a', '#c8401a', '#5a1a0c'],
  // Пыль светлее пола нор (пол после света ≈ #3c342c): иначе её не видно.
  dust: ['#8a7a62', '#b5a384', '#dccca8'],
  dustPale: ['#a39278', '#cbb998', '#eee0c0'],
  dirt: ['#2a1f16', '#5a4632', '#8a7054', '#b4987a'],
  straw: ['#8a6a2a', '#c8a458', '#f0dc98'],
  wood: ['#3e2414', '#7a4a28', '#a8703e', '#d09a60'],
  pink: ['#5e3232', '#935654', '#d08a82', '#e8aaa2', '#ffd8d0'],
  rock: ['#26221e', '#5e564c', '#8c8274', '#bdb2a0'],
  gold: ['#7a5210', '#b88420', '#e8b830', '#fff0a0'],
  thread: ['#40101c', '#94303e'],
} as const;

type Pal = readonly string[];

/** Звезда разрыва узла: от белого к розовому. */
const PINK_STAR: Pal = ['#ffffff', '#ffd8d0', '#e8aaa2', '#d08a82'];

// ---------------------------------------------------------------------------
// Основа: зерно, кривые, «перо» — рисование целыми игровыми пикселями.
// ---------------------------------------------------------------------------

/** Хеш двух чисел в [0, 1): одно зерно — один узор, без `Math.random`. */
function hs(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** i-е случайное число k-го свойства частицы. */
const rr = (seed: number, i: number, k: number) => hs(seed + k * 7919, i * 131 + k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeIn = (t: number) => clamp01(t) ** 2;
const TAU = Math.PI * 2;

/**
 * Перо: начало координат эффекта, прижатое к точке экрана. Всё, что рисует
 * эффект, ложится целыми игровыми пикселями от этого начала — сетка эффекта
 * не «плывёт» относительно самой себя, а целиком едет с камерой, как спрайт.
 */
interface Pen {
  g: CanvasRenderingContext2D;
  x: number;
  y: number;
}

function penAt(g: CanvasRenderingContext2D, px: number, py: number): Pen {
  const S = g.getTransform().a || 1;
  return { g, x: Math.round(px * S) / S, y: Math.round(py * S) / S };
}

function ink(p: Pen, c: string, a = 1): void {
  p.g.fillStyle = c;
  p.g.globalAlpha = a <= 0 ? 0 : a >= 1 ? 1 : a;
}

function put(p: Pen, x: number, y: number, w = 1, h = 1): void {
  p.g.fillRect(p.x + Math.round(x), p.y + Math.round(y), w, h);
}

/** Дуга пикселями: без повторов соседних точек, `each(x, y, u, a)`. */
function arcPx(
  R: number,
  a0: number,
  a1: number,
  each: (x: number, y: number, u: number, a: number) => void,
): void {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * Math.max(1, R) * 1.25));
  let lx = 1e9;
  let ly = 1e9;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = a0 + (a1 - a0) * u;
    const x = Math.round(Math.cos(a) * R);
    const y = Math.round(Math.sin(a) * R);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    each(x, y, u, a);
  }
}

/** Отрезок пикселями, `each(x, y, u)`. */
function linePx(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  each: (x: number, y: number, u: number) => void,
): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  let lx = 1e9;
  let ly = 1e9;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = Math.round(x0 + (x1 - x0) * u);
    const y = Math.round(y0 + (y1 - y0) * u);
    if (x === lx && y === ly) continue;
    lx = x;
    ly = y;
    each(x, y, u);
  }
}

// ---------------------------------------------------------------------------
// Готовые пиксельные картинки: клуб пыли, звезда вспышки, тесак под углом.
// Рисуются один раз на размер и цвет.
// ---------------------------------------------------------------------------

const IMG = new Map<string, HTMLCanvasElement>();
function img(key: string, make: () => Px): HTMLCanvasElement {
  let c = IMG.get(key);
  if (!c) {
    c = make().canvas();
    IMG.set(key, c);
  }
  return c;
}

/** Клуб пыли радиуса r: шар со светом сверху-слева и рваным краем. */
function puffImg(r: number, pal: Pal): HTMLCanvasElement {
  return img(`puff|${r}|${pal[1]}`, () => {
    const n = r * 2 + 1;
    const px = new Px(n, n);
    const cols = pal.map((h) => hex(h));
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const dx = (x - r) / (r + 0.5);
        const dy = (y - r) / (r + 0.5);
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        // Край клуба — через пиксель: мягкий, но без сглаживания.
        if (d2 > 0.62 && (x + y) % 2 === 1) continue;
        const k = -0.45 * dx - 0.75 * dy + 0.5 * Math.sqrt(1 - d2);
        px.set(x, y, k > 0.55 ? cols[2] : k > 0.12 ? cols[1] : cols[0]);
      }
    return px;
  });
}

function drawPuff(p: Pen, x: number, y: number, r: number, pal: Pal, a: number): void {
  if (a <= 0.01) return;
  const R = Math.max(1, Math.min(14, Math.round(r)));
  p.g.globalAlpha = Math.min(1, a);
  p.g.drawImage(puffImg(R, pal), p.x + Math.round(x) - R, p.y + Math.round(y) - R);
}

/** Звезда вспышки: четыре длинных луча и четыре коротких, к кончикам — огонь. */
function starImg(n: number, pal: Pal = C.hot): HTMLCanvasElement {
  return img(`star|${n}|${pal[2]}`, () => {
    const s = n * 2 + 1;
    const px = new Px(s, s);
    const c = pal.map((h) => hex(h));
    const tone = (d: number, len: number) => {
      const k = d / Math.max(1, len);
      return k < 0.35 ? c[0] : k < 0.65 ? c[1] : k < 0.9 ? c[2] : c[3];
    };
    for (let d = 0; d <= n; d++) {
      const col = tone(d, n);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        px.set(n + dx * d, n + dy * d, col);
    }
    const nd = Math.max(1, Math.floor(n * 0.45));
    for (let d = 1; d <= nd; d++) {
      const col = tone(d * 1.6, n);
      for (const [dx, dy] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ])
        px.set(n + dx * d, n + dy * d, col);
    }
    // Сердце вспышки — белый ромб.
    const core = Math.max(1, Math.floor(n * 0.25));
    for (let y = -core; y <= core; y++)
      for (let x = -core; x <= core; x++)
        if (Math.abs(x) + Math.abs(y) <= core) px.set(n + x, n + y, c[0]);
    return px;
  });
}

function drawStar(p: Pen, x: number, y: number, n: number, a: number, pal: Pal = C.hot): void {
  if (a <= 0.01 || n < 1) return;
  const N = Math.round(n);
  p.g.globalAlpha = Math.min(1, a);
  p.g.drawImage(starImg(N, pal), p.x + Math.round(x) - N, p.y + Math.round(y) - N);
}

/** Кольцо пикселями толщиной `w` (1–2). */
/**
 * Кольцо вспышки пикселями толщиной `w`, рваное: треть точек выпадает —
 * ровный циркульный круг читается наклейкой, а не волной.
 */
function ringPx(p: Pen, x: number, y: number, R: number, w = 1, seed = 1): void {
  if (R < 0.5) {
    put(p, x, y);
    return;
  }
  arcPx(R, 0, TAU, (dx, dy, u) => {
    if (rr(seed, Math.round(u * R * 2.2), 5) < 0.3) return;
    put(p, x + dx, y + dy, w, w);
  });
}

// ---------------------------------------------------------------------------
// Физика частиц: полёт с отскоками и скольжением — формулой от возраста.
// ---------------------------------------------------------------------------

/**
 * Путь по полу `s` и высота `z` через `t` секунд: вылет со скоростью `v`
 * вдоль пола и `vz` вверх, гравитация `gr`, до двух отскоков (`bounce` —
 * доля вертикали, по полу при ударе теряется половина), потом скольжение
 * с трением `slide`. `rest` — лежит.
 */
function fly(
  t: number,
  v: number,
  vz: number,
  gr: number,
  bounce: number,
  slide: number,
): { s: number; z: number; rest: boolean; hops: number } {
  let s = 0;
  let sp = v;
  let up = vz;
  let tt = t;
  let hops = 0;
  for (let k = 0; k < 3 && up > 6; k++) {
    const T = (2 * up) / gr;
    if (tt < T) return { s: s + sp * tt, z: up * tt - (gr * tt * tt) / 2, rest: false, hops };
    s += sp * T;
    tt -= T;
    up *= bounce;
    sp *= 0.5;
    hops++;
  }
  return { s: s + (sp * (1 - Math.exp(-slide * tt))) / slide, z: 0, rest: true, hops };
}

type BitKind = 'pebble' | 'clod' | 'chunk' | 'straw' | 'splinter' | 'shred' | 'thread' | 'gold';

interface BitSpec {
  n: number;
  /** Куда летят: середина и разброс (±). */
  ang: number;
  spread: number;
  v: [number, number];
  vz: [number, number];
  life: [number, number];
  gr?: number;
  bounce?: number;
  slide?: number;
  delay?: [number, number];
  /** Откуда: разброс начала вдоль и поперёк направления, пиксели. */
  from?: (i: number, seed: number) => [number, number];
  kinds: BitKind[];
  /** Разворот направления на каждой второй частице (веер в обе стороны). */
  mirror?: boolean;
  /** Своё направление каждой частице (перекрывает `ang`): «наружу от круга». */
  dir?: (i: number, seed: number) => number;
  /** Своя задержка каждой частице (перекрывает `delay`): «когда прошёл удар». */
  at?: (i: number) => number;
}

/** Мелкая частица: вид, фаза вращения (0–3), тон. */
function drawBit(p: Pen, x: number, y: number, kind: BitKind, ph: number, tone: number): void {
  switch (kind) {
    case 'pebble': {
      const a = p.g.globalAlpha;
      ink(p, C.ink, a * 0.6);
      put(p, x, y + 1);
      ink(p, C.rock[2 + (tone & 1)], a);
      put(p, x, y);
      return;
    }
    case 'clod': {
      // Ком 2×2: свет сверху-слева, тёмный низ и тёмная кайма снизу.
      const a = p.g.globalAlpha;
      ink(p, C.ink, a * 0.7);
      put(p, x, y + 2, 2, 1);
      ink(p, C.dirt[1], a);
      put(p, x, y, 2, 2);
      ink(p, C.dirt[2], a);
      put(p, x, y, 2, 1);
      ink(p, C.dirt[3], a);
      put(p, x, y);
      return;
    }
    case 'chunk': {
      // Глыба 3×3 камнем: три тона по свету и кайма.
      const a = p.g.globalAlpha;
      ink(p, C.ink, a * 0.8);
      put(p, x - 1, y + 2, 3, 1);
      put(p, x + 2, y - 1, 1, 3);
      ink(p, C.rock[1], a);
      put(p, x - 1, y - 1, 3, 3);
      ink(p, C.rock[2], a);
      put(p, x - 1, y - 1, 2, 2);
      ink(p, C.rock[3], a);
      put(p, x - 1, y - 1);
      if (ph % 2) put(p, x, y - 1);
      return;
    }
    case 'gold': {
      const a = p.g.globalAlpha;
      ink(p, C.gold[2], a);
      put(p, x, y);
      ink(p, C.gold[3], a);
      if (ph % 2 === 0) put(p, x, y);
      return;
    }
    default: {
      // Длинные: соломина, щепа, клочок хвоста, нитка ковра — поворачиваются
      // на четверть оборота, пока в воздухе.
      const pal: Pal =
        kind === 'straw'
          ? C.straw
          : kind === 'splinter'
            ? C.wood
            : kind === 'shred'
              ? C.pink
              : C.thread;
      const len = kind === 'thread' ? 2 : 3;
      const dirs = [
        [1, 0],
        [1, 1],
        [0, 1],
        [1, -1],
      ];
      const [dx, dy] = dirs[ph & 3];
      const a = p.g.globalAlpha;
      for (let k = 0; k < len; k++) {
        const c =
          kind === 'shred'
            ? k === 1
              ? pal[3]
              : pal[2 - (tone & 1)]
            : k === len - 1
              ? pal[pal.length - 1]
              : pal[1 + (tone & 1)];
        ink(p, c, a);
        // Клочок хвоста — закорючка: средний пиксель сдвинут.
        const bend = kind === 'shred' && k === 1 ? 1 : 0;
        put(p, x + dx * k - dy * bend, y + dy * k + dx * bend);
      }
    }
  }
}

/** Стая частиц одного вылета: комья, солома, щепа — со своей тенью. */
function bits(p: Pen, seed: number, age: number, o: BitSpec, ox = 0, oy = 0): void {
  const gr = o.gr ?? 420;
  const bounce = o.bounce ?? 0.32;
  const slide = o.slide ?? 9;
  for (let i = 0; i < o.n; i++) {
    const d0 = o.at ? o.at(i) : o.delay ? lerp(o.delay[0], o.delay[1], rr(seed, i, 9)) : 0;
    const t = age - d0;
    if (t < 0) continue;
    const life = lerp(o.life[0], o.life[1], rr(seed, i, 1));
    if (t >= life) continue;
    let a = (o.dir ? o.dir(i, seed) : o.ang) + (rr(seed, i, 2) * 2 - 1) * o.spread;
    if (o.mirror && i % 2 === 1) a += Math.PI;
    const v = lerp(o.v[0], o.v[1], rr(seed, i, 3));
    const vz = lerp(o.vz[0], o.vz[1], rr(seed, i, 4));
    const f = fly(t, v, vz, gr, bounce, slide);
    const [fx, fy] = o.from ? o.from(i, seed) : [0, 0];
    const x = ox + fx + Math.cos(a) * f.s;
    const y = oy + fy + Math.sin(a) * f.s;
    const fade = t > life * 0.72 ? 1 - (t - life * 0.72) / (life * 0.28) : 1;
    const kind = o.kinds[Math.floor(rr(seed, i, 5) * o.kinds.length)];
    // Тень: пока в воздухе — пятнышко на полу под частицей.
    if (f.z > 1.5) {
      ink(p, C.ink, 0.28 * fade);
      put(p, x, y + 1, kind === 'chunk' ? 2 : 1, 1);
    }
    const spin = f.rest
      ? Math.floor(rr(seed, i, 6) * 4)
      : Math.floor(t * lerp(10, 22, rr(seed, i, 7)) + rr(seed, i, 6) * 4);
    p.g.globalAlpha = fade;
    drawBit(p, x, y - f.z, kind, spin, i);
  }
}

interface PuffSpec {
  n: number;
  ang: number;
  spread: number;
  /** Сколько пролетает клуб, пиксели. */
  dist: [number, number];
  r0: [number, number];
  r1: [number, number];
  life: [number, number];
  /** Насколько поднимается. */
  rise?: [number, number];
  delay?: [number, number];
  a0?: number;
  pal?: Pal;
  from?: (i: number, seed: number) => [number, number];
  mirror?: boolean;
  dir?: (i: number, seed: number) => number;
  at?: (i: number) => number;
}

/** Клубы пыли: вылетают, тормозят, пухнут, оседают и тают. */
function puffs(p: Pen, seed: number, age: number, o: PuffSpec, ox = 0, oy = 0): void {
  const pal = o.pal ?? C.dust;
  for (let i = 0; i < o.n; i++) {
    const d0 = o.at ? o.at(i) : o.delay ? lerp(o.delay[0], o.delay[1], rr(seed, i, 19)) : 0;
    const t = age - d0;
    if (t < 0) continue;
    const life = lerp(o.life[0], o.life[1], rr(seed, i, 11));
    const u = t / life;
    if (u >= 1) continue;
    let a = (o.dir ? o.dir(i, seed) : o.ang) + (rr(seed, i, 12) * 2 - 1) * o.spread;
    if (o.mirror && i % 2 === 1) a += Math.PI;
    const e = 1 - (1 - u) ** 3;
    const d = lerp(o.dist[0], o.dist[1], rr(seed, i, 13)) * e;
    const r = lerp(
      lerp(o.r0[0], o.r0[1], rr(seed, i, 14)),
      lerp(o.r1[0], o.r1[1], rr(seed, i, 15)),
      e,
    );
    const rise = o.rise ? lerp(o.rise[0], o.rise[1], rr(seed, i, 16)) : 0;
    // Поднимается и снова ложится: пыль оседает, а не висит.
    const z = rise * Math.sin(Math.min(1, u * 1.4) * Math.PI) * (1 - u * 0.5);
    const [fx, fy] = o.from ? o.from(i, seed) : [0, 0];
    const alpha = (o.a0 ?? 0.6) * Math.min(1, u * 8) * (1 - u) ** 1.4;
    drawPuff(p, ox + fx + Math.cos(a) * d, oy + fy + Math.sin(a) * d - z, r, pal, alpha);
  }
}

interface SparkSpec {
  n: number;
  ang: number;
  spread: number;
  v: [number, number];
  vz: [number, number];
  life: [number, number];
  delay?: [number, number];
  from?: (i: number, seed: number, t0: number) => [number, number];
  /** Своё направление каждой искре (перекрывает `ang`). */
  dir?: (i: number, seed: number, t0: number) => number;
  gr?: number;
}

/** Искры: раскалённые чёрточки по ходу полёта, остывают на лету, скачут по полу. */
function sparks(p: Pen, seed: number, age: number, o: SparkSpec, ox = 0, oy = 0): void {
  const gr = o.gr ?? 520;
  for (let i = 0; i < o.n; i++) {
    const d0 = o.delay ? lerp(o.delay[0], o.delay[1], rr(seed, i, 29)) : 0;
    const t = age - d0;
    if (t < 0) continue;
    const life = lerp(o.life[0], o.life[1], rr(seed, i, 21));
    const u = t / life;
    if (u >= 1) continue;
    const a = (o.dir ? o.dir(i, seed, d0) : o.ang) + (rr(seed, i, 22) * 2 - 1) * o.spread;
    const v = lerp(o.v[0], o.v[1], rr(seed, i, 23));
    const vz = lerp(o.vz[0], o.vz[1], rr(seed, i, 24));
    const [fx, fy] = o.from ? o.from(i, seed, d0) : [0, 0];
    const at = (tt: number) => {
      const f = fly(Math.max(0, tt), v, vz, gr, 0.4, 14);
      return [ox + fx + Math.cos(a) * f.s, oy + fy + Math.sin(a) * f.s - f.z];
    };
    const [x1, y1] = at(t);
    const [x0, y0] = at(t - 0.022);
    const col = u < 0.2 ? C.hot[0] : u < 0.45 ? C.hot[1] : u < 0.7 ? C.hot[2] : C.hot[3];
    ink(p, col, u > 0.8 ? (1 - u) * 5 : 1);
    linePx(x0, y0, x1, y1, (x, y) => put(p, x, y));
  }
}

// ---------------------------------------------------------------------------
// Трещины в полу: ломаная с отростком, тёмная середина и светлая кромка
// снизу-справа (свет сверху-слева падает на дальнюю стенку трещины).
// ---------------------------------------------------------------------------

const CRACKS = frameLRU<number[]>(160);

function crackPts(seed: number, i: number, a: number, r0: number, r1: number): number[] {
  const key = `${seed}|${i}|${a.toFixed(2)}|${r0}|${r1}`;
  const hit = CRACKS.get(key);
  if (hit) return hit;
  const pts: number[] = [];
  let x = Math.cos(a) * r0;
  let y = Math.sin(a) * r0;
  let ang = a;
  let len = r0;
  let k = 0;
  const branchAt = lerp(0.35, 0.6, rr(seed, i, 41));
  let branch: number[] | null = null;
  let lx = 1e9;
  let ly = 1e9;
  while (len < r1) {
    if (k % 3 === 0) ang = a + (rr(seed, i * 17 + k, 42) * 2 - 1) * 0.55;
    x += Math.cos(ang);
    y += Math.sin(ang);
    len += 1;
    k++;
    const px = Math.round(x);
    const py = Math.round(y);
    if (px !== lx || py !== ly) {
      pts.push(px, py);
      lx = px;
      ly = py;
    }
    if (!branch && (len - r0) / (r1 - r0) > branchAt) {
      // Отросток: короче и под углом.
      branch = [];
      const side = rr(seed, i, 43) < 0.5 ? -1 : 1;
      let bx = x;
      let by = y;
      const ba = ang + side * lerp(0.6, 1.0, rr(seed, i, 44));
      const bl = (r1 - r0) * lerp(0.25, 0.4, rr(seed, i, 45));
      for (let j = 0; j < bl; j++) {
        const aj = ba + (rr(seed, i * 31 + j, 46) * 2 - 1) * 0.4;
        bx += Math.cos(aj);
        by += Math.sin(aj);
        branch.push(Math.round(bx), Math.round(by));
      }
    }
  }
  // Отросток — в хвост, после основной ломаной: растёт позже.
  const out = branch ? pts.concat(branch) : pts;
  return CRACKS.set(key, out);
}

/** Трещина: `grow` 0…1 — сколько её уже прошло, `a` — прозрачность. */
function drawCrack(p: Pen, pts: number[], grow: number, a: number, ox = 0, oy = 0): void {
  const n = Math.floor((pts.length / 2) * clamp01(grow));
  if (n <= 0 || a <= 0) return;
  ink(p, C.dust[2], a * 0.55);
  for (let j = 0; j < n; j++) put(p, ox + pts[j * 2] + 1, oy + pts[j * 2 + 1] + 1);
  ink(p, '#120c08', a);
  for (let j = 0; j < n; j++) put(p, ox + pts[j * 2], oy + pts[j * 2 + 1]);
}

// ---------------------------------------------------------------------------
// МЕТКИ. Общий язык: кромка штрихами + фронт + последние 0,2 с — белая.
// ---------------------------------------------------------------------------

/** Сколько секунд перед уроном метка «горит» сплошной. */
const HOT = 0.2;

interface Tele {
  R: number;
  ang: number;
  arc: number;
  /** Доля подготовки 0…1. */
  p: number;
  /** Секунд до урона. */
  tl: number;
  /** Секунд с начала подготовки. */
  t: number;
  small?: boolean;
}

const hotOf = (tl: number) => (tl < HOT ? clamp01(1 - tl / HOT) : 0);

/** Непрозрачность кромки: видна с первого кадра, к удару — полная. */
const rimAlpha = (o: Tele, hot: number) => 0.72 + 0.28 * Math.max(o.p * o.p, hot);

/**
 * Кромка: тёмная подложка на пиксель ниже (отрывает кромку от любого пола —
 * и от красного ковра, и от бурой земли), поверх — кость. Подложка идёт
 * отдельным проходом раньше светлой, иначе ляжет на соседнюю точку кромки.
 */
function rim(
  p: Pen,
  pts: [number, number, number][],
  base: string,
  hot: number,
  alpha: number,
  thick: boolean,
): void {
  ink(p, C.ink, 0.55 * alpha);
  for (const [x, y, on] of pts) if (on) put(p, x, y + 1, thick ? 2 : 1, 1);
  const col = hot > 0.02 ? (hot > 0.5 ? C.white : C.boneHi) : base;
  ink(p, col, alpha);
  for (const [x, y, on] of pts) if (on) put(p, x, y, thick ? 2 : 1, thick ? 2 : 1);
}

/** Штрих кромки: 5 точек есть, 2 нет; бежит со скоростью `run`. */
const dashOn = (s: number, run: number, hot: number) => hot > 0.02 || (((s - run) % 7) + 7) % 7 < 5;

/**
 * Пылинки втягиваются к королю вдоль лучей формы — удар набирает силу.
 * Каждая — чёрточка в два пикселя по ходу движения.
 */
function motes(
  p: Pen,
  seed: number,
  t: number,
  n: number,
  pick: (u: number, v: number) => [number, number],
  a: number,
): void {
  for (let i = 0; i < n; i++) {
    const sp = lerp(0.7, 1.3, rr(seed, i, 52));
    const ph = (rr(seed, i, 51) + t * sp) % 1;
    const v = rr(seed, i, 53);
    const [x, y] = pick(1 - ph, v);
    const [x2, y2] = pick(Math.min(1, 1 - ph + 0.06), v);
    ink(p, C.boneHi, a * Math.sin(ph * Math.PI));
    put(p, x, y);
    put(p, x2, y2);
  }
}

/** Заливка сектора (путём холста: мягкий край под красной меткой не виден). */
function wedge(p: Pen, r0: number, r1: number, a0: number, a1: number, c: string, a: number): void {
  if (a <= 0 || r1 <= r0) return;
  p.g.globalAlpha = a;
  p.g.fillStyle = c;
  p.g.beginPath();
  p.g.arc(p.x, p.y, r1, a0, a1);
  if (r0 > 0) p.g.arc(p.x, p.y, r0, a1, a0, true);
  else p.g.lineTo(p.x, p.y);
  p.g.closePath();
  p.g.fill();
}

/** Конус: рубка тесаком и взмах рельса. `side` — куда идёт взмах (0 — рубка сверху). */
function teleCone(p: Pen, o: Tele, seed: number, side: number, mark: number): void {
  const { R, ang, arc } = o;
  const h = arc / 2;
  const a0 = ang - h;
  const a1 = ang + h;
  const hot = hotOf(o.tl);
  const alpha = rimAlpha(o, hot);
  // Тень замаха: пол под конусом темнеет — удар уже «висит» над ним.
  wedge(p, 0, R, a0, a1, '#0c0606', 0.12 + 0.14 * o.p);
  // Налитое: от короля до фронта пол светлеет — видно, сколько осталось.
  // Фронт стартует от края тела короля (под ним его не видно).
  const rf = lerp(R * 0.3, R, o.p ** 1.35);
  wedge(p, 0, rf, a0, a1, C.boneHi, 0.07 + 0.13 * o.p + 0.14 * hot);
  // Фронт: дуга в два пикселя, доходит до кромки в миг удара.
  if (hot < 0.99) {
    ink(p, C.boneHi, (0.45 + 0.45 * o.p) * (1 - hot));
    arcPx(rf, a0 + 0.04, a1 - 0.04, (x, y) => put(p, x, y));
    ink(p, C.bone, (0.2 + 0.25 * o.p) * (1 - hot));
    arcPx(Math.max(1, rf - 1.5), a0 + 0.06, a1 - 0.06, (x, y) => put(p, x, y));
  }
  // Кромка: штрихи бегут от короля к дуге и по дуге — к краям.
  const run = o.t * (18 + 46 * o.p);
  const pts: [number, number, number][] = [];
  for (const e of [a0, a1])
    linePx(0, 0, Math.cos(e) * R, Math.sin(e) * R, (x, y, u) => {
      if (u > 0.1) pts.push([x, y, dashOn(u * R, run, hot) ? 1 : 0]);
    });
  arcPx(R, a0, a1, (x, y, u) =>
    pts.push([x, y, dashOn(Math.abs(u - 0.5) * arc * R + R, run, hot) ? 1 : 0]),
  );
  rim(p, pts, C.bone, hot, alpha, hot > 0.35);
  // Взмах рельса: изогнутые шевроны по дуге — в сторону взмаха; кромка, с
  // которой начнётся взмах, двойная: «рельс сейчас здесь».
  if (side !== 0) {
    const start = side > 0 ? a0 : a1;
    for (const rc of [R * 0.5, R * 0.8]) {
      const n = rc > R * 0.6 ? 5 : 3;
      for (let j = 0; j < n; j++) {
        const u = (j / n + o.t * (0.8 + 1.8 * o.p)) % 1;
        const ac = start + side * u * arc;
        const cx = Math.cos(ac) * rc;
        const cy = Math.sin(ac) * rc;
        const tx = -Math.sin(ac) * side;
        const ty = Math.cos(ac) * side;
        const nx = Math.cos(ac);
        const ny = Math.sin(ac);
        const fade = Math.sin(u * Math.PI);
        const wing = rc > R * 0.6 ? 3 : 2;
        ink(p, C.ink, 0.45 * fade);
        for (let k = -wing; k <= wing; k++) {
          const back = Math.abs(k) * 0.9;
          put(p, cx + nx * k - tx * back, cy + ny * k - ty * back + 1);
        }
        ink(p, hot > 0.02 ? C.white : C.boneHi, (0.55 + 0.45 * o.p) * fade);
        for (let k = -wing; k <= wing; k++) {
          const back = Math.abs(k) * 0.9;
          put(p, cx + nx * k - tx * back, cy + ny * k - ty * back);
        }
      }
    }
    ink(p, C.boneHi, alpha * (0.55 + 0.45 * o.p));
    linePx(0, 0, Math.cos(start) * R, Math.sin(start) * R, (x, y, u) => {
      if (u > 0.15) put(p, x - Math.sin(start) * side, y + Math.cos(start) * side);
    });
  }
  // Рубка: куда ляжет тесак — косой крест, растёт к удару.
  if (mark > 0) {
    const mx = Math.cos(ang) * mark;
    const my = Math.sin(ang) * mark;
    const sz = 2 + Math.round(2 * o.p) + (hot > 0.3 ? 1 : 0);
    ink(p, C.ink, 0.6 * alpha);
    for (let k = -sz; k <= sz; k++) {
      put(p, mx + k, my + k + 1, 2, 1);
      put(p, mx + k, my - k + 1, 2, 1);
    }
    ink(p, hot > 0.3 ? C.white : C.boneHi, 0.55 + 0.45 * o.p);
    for (let k = -sz; k <= sz; k++) {
      put(p, mx + k, my + k);
      put(p, mx + k, my - k);
    }
  }
  // Пылинки тянутся к королю.
  motes(
    p,
    seed,
    o.t,
    10,
    (u, v) => {
      const a = ang + (v * 2 - 1) * h * 0.9;
      return [Math.cos(a) * R * (0.18 + 0.8 * u), Math.sin(a) * R * (0.18 + 0.8 * u)];
    },
    0.7 + 0.3 * o.p,
  );
}

/** Круг хвостов: весь диск опасен (не кольцо!) — хвосты метут его целиком. */
function teleWhip(p: Pen, o: Tele, seed: number): void {
  const { R } = o;
  const hot = hotOf(o.tl);
  const alpha = rimAlpha(o, hot);
  wedge(p, 0, R, 0, TAU, '#0c0606', 0.1 + 0.12 * o.p);
  const rf = lerp(R * 0.4, R, o.p ** 1.35);
  wedge(p, 0, rf, 0, TAU, C.pink[4], 0.06 + 0.1 * o.p + 0.12 * hot);
  // Хвосты: три розовые запятые кружат всё быстрее — метут весь круг.
  const spin = TAU * (0.9 * o.t + 1.6 * o.p * o.p);
  for (let j = 0; j < 3; j++) {
    const head = spin + (j * TAU) / 3 + rr(seed, j, 61);
    const len = 1.0 + 0.8 * o.p + 1.0 * hot;
    const steps = Math.ceil(len * R * 0.9);
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const a = head - u * len;
      const rad = R * lerp(0.94, 0.35, u);
      const x = Math.round(Math.cos(a) * rad);
      const y = Math.round(Math.sin(a) * rad);
      ink(p, C.ink, 0.4 * (1 - u));
      put(p, x, y + 1);
      ink(p, u < 0.2 ? C.pink[4] : C.pink[3], (0.7 + 0.3 * o.p) * (1 - u));
      put(p, x, y);
      if (u < 0.4) put(p, x + 1, y);
    }
  }
  // Фронт: кольцо давления растёт от короля к кромке.
  if (hot < 0.99) {
    ink(p, C.boneHi, (0.4 + 0.45 * o.p) * (1 - hot));
    arcPx(rf, 0, TAU, (x, y) => put(p, x, y));
  }
  // Кромка: штрихи бегут по кругу в сторону вращения.
  const run = o.t * (22 + 60 * o.p);
  const pts: [number, number, number][] = [];
  arcPx(R, 0, TAU, (x, y, u) => pts.push([x, y, dashOn(u * TAU * R, run, hot) ? 1 : 0]));
  rim(p, pts, C.bone, hot, alpha, hot > 0.35);
}

/** Линия переката: шевроны бегут к цели, кромки — рельсами. */
function teleRoll(p: Pen, o: Tele & { W: number }, seed: number): void {
  const { R: L, W, ang } = o;
  const hot = hotOf(o.tl);
  const alpha = rimAlpha(o, hot);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const at = (u: number, v: number): [number, number] => [c * u - s * v, s * u + c * v];
  const lane = (u0: number, u1: number, col: string, a: number) => {
    if (a <= 0 || u1 <= u0) return;
    p.g.save();
    p.g.translate(p.x, p.y);
    p.g.rotate(ang);
    p.g.globalAlpha = a;
    p.g.fillStyle = col;
    p.g.fillRect(u0, -W, u1 - u0, W * 2);
    p.g.restore();
  };
  lane(0, L, '#0c0606', 0.1 + 0.12 * o.p);
  const lf = L * Math.max(0.08, o.p ** 1.2);
  lane(0, lf, C.boneHi, 0.05 + 0.08 * o.p + 0.12 * hot);
  // Кромки-рельсы: штрихи бегут вперёд.
  const run = o.t * (26 + 120 * o.p);
  const pts: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    const [x0, y0] = at(4, side * W);
    const [x1, y1] = at(L, side * W);
    linePx(x0, y0, x1, y1, (x, y, u) => pts.push([x, y, dashOn(u * L, run, hot) ? 1 : 0]));
  }
  rim(p, pts, C.bone, hot, alpha, hot > 0.35);
  // Шевроны «>»: бегут от короля к концу, ускоряясь; за фронтом — ярче.
  const gap = o.small ? 11 : 14;
  const n = Math.floor((L - 8) / gap);
  const wing = Math.max(2, Math.min(W - 3, o.small ? 4 : 6));
  for (let j = 0; j < n; j++) {
    const u = 8 + ((((j * gap + run * 0.9) % (n * gap)) + n * gap) % (n * gap));
    if (u > L - 4) continue;
    const lit = u < lf ? 1 : 0.45;
    const edge = Math.min(1, (u - 8) / 10, (L - 4 - u) / 10);
    for (const pass of [0, 1]) {
      ink(
        p,
        pass ? (hot > 0.3 ? C.white : C.boneHi) : C.ink,
        (pass ? 0.5 + 0.5 * o.p : 0.4) * lit * edge,
      );
      for (let k = -wing; k <= wing; k++) {
        const back = Math.abs(k) * 0.75;
        const [x, y] = at(u - back, k);
        const [x2, y2] = at(u - back - 1, k);
        put(p, x, y + (pass ? 0 : 1));
        put(p, x2, y2 + (pass ? 0 : 1));
      }
    }
  }
  // Острие в конце линии.
  ink(p, hot > 0.3 ? C.white : C.boneHi, alpha);
  for (let k = -W; k <= W; k++) {
    const [x, y] = at(L + 3 - Math.abs(k) * 0.45, k);
    put(p, x, y);
  }
  // Пыль у ног: король раскачивается перед рывком.
  motes(p, seed, o.t * 1.5, 7, (u, v) => at(-2 - u * 9, (v * 2 - 1) * W * 0.9), 0.5 + 0.4 * o.p);
}

/** Прицел прыжка: сходящееся кольцо и четыре засечки; в прыжке — застывает. */
function teleLeap(p: Pen, o: Tele & { lock: boolean; air: boolean }): void {
  const { R } = o;
  const hot = hotOf(o.tl);
  const alpha = rimAlpha(o, hot);
  wedge(p, 0, R, 0, TAU, '#0c0606', 0.12 + 0.16 * o.p);
  // Тень короля в воздухе: растёт над точкой падения — он уже над тобой.
  if (o.air) {
    const k = clamp01(1 - o.tl / 0.5);
    p.g.globalAlpha = 0.18 + 0.3 * k;
    p.g.fillStyle = '#050304';
    p.g.beginPath();
    p.g.ellipse(p.x, p.y + 1, 4 + 10 * k, 1.5 + 3.5 * k, 0, 0, TAU);
    p.g.fill();
  }
  // Кромка: штрихи медленно кружат; сплошная — в последний миг.
  const run = o.t * 10;
  const pts: [number, number, number][] = [];
  arcPx(R, 0, TAU, (x, y, u) => pts.push([x, y, dashOn(-(u * TAU * R), run, hot) ? 1 : 0]));
  rim(p, pts, o.air ? C.gold[3] : C.bone, hot, alpha, hot > 0.35 || o.air);
  // Сходящееся кольцо: доходит до кромки ровно в миг приземления.
  const rc = R + R * 1.25 * clamp01(o.tl / 1.2);
  const ringCol = o.air ? C.gold[3] : C.boneHi;
  if (rc > R + 0.8) {
    const cp: [number, number, number][] = [];
    arcPx(rc, 0, TAU, (x, y, u) => cp.push([x, y, Math.round(u * rc * 5) % 4 !== 3 ? 1 : 0]));
    rim(p, cp, ringCol, 0, alpha * (0.6 + 0.4 * o.p), false);
  }
  // Засечки прицела: четыре клина остриём к центру.
  const rot = o.lock ? 0.8 * 0.4 : 0.8 * o.t;
  for (let j = 0; j < 4; j++) {
    const a = rot + (j * Math.PI) / 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const vx = -uy;
    const vy = ux;
    for (const pass of [0, 1]) {
      ink(p, pass ? (hot > 0.3 ? C.white : ringCol) : C.ink, pass ? alpha : 0.5 * alpha);
      for (let k = 0; k < 6; k++) {
        const w = Math.floor((5 - k) / 2);
        for (let q = -w; q <= w; q++)
          put(p, ux * (rc + 1 + k) + vx * q, uy * (rc + 1 + k) + vy * q + (pass ? 0 : 1));
      }
    }
  }
  // Середина: крестик.
  ink(p, hot > 0.3 ? C.white : C.boneHi, alpha * 0.85);
  for (let k = -2; k <= 2; k++) {
    put(p, k, 0);
    put(p, 0, k);
  }
}

// ---------------------------------------------------------------------------
// Смотритель боя: метки всех королей из живой симуляции.
// ---------------------------------------------------------------------------

const isKing = (m: Mob) => (m.kind === 'king' || m.kind === 'kinglet') && m.mode !== 'dying';

/** Во сколько раз быстрее бьёт король сейчас (как в мозге: ярость). */
const rageOf = (sim: Sim) => (sim.boss && sim.boss.t > KING_RAGE ? 1.35 : 1);

/**
 * Время до урона из метки: у метки мозга k = t / T. В первый миг (k ≈ 0) T
 * из метки не вывести — берётся обычная длительность `def`.
 */
function teleTime(m: Mob, def: number): { p: number; T: number } {
  const k = m.tele?.k ?? 0;
  if (k < 0.02 || m.t < 0.02) return { p: clamp01(m.t / def), T: def };
  return { p: Math.min(1, k), T: k >= 1 ? m.t : m.t / k };
}

function kingFloor(g: CanvasRenderingContext2D, sim: Sim, m: Mob, px: number, py: number): void {
  const t = m.tele;
  const small = m.kind === 'kinglet';
  const seed = m.id * 97;
  switch (m.mode) {
    case 'cleaveAim':
    case 'sweepAim': {
      if (!t || t.shape !== 'cone') return;
      const sweep = m.mode === 'sweepAim';
      const n = 3 - (m.data.combo ?? 3);
      const { p, T } = teleTime(m, sweep ? (n === 0 ? 0.55 : 0.38) : 0.75);
      const side = sweep ? swingSide(n, m.face) : 0;
      teleCone(
        penAt(g, px, py),
        { R: t.r * TS, ang: t.ang ?? m.dir, arc: t.arc ?? 1, p, tl: T - m.t, t: m.t, small },
        seed,
        side,
        sweep ? 0 : 1.4 * TS,
      );
      return;
    }
    case 'whipAim': {
      if (!t) return;
      const { p, T } = teleTime(m, 0.7);
      teleWhip(
        penAt(g, px, py),
        { R: t.r * TS, ang: 0, arc: TAU, p, tl: T - m.t, t: m.t, small },
        seed,
      );
      return;
    }
    case 'rollAim': {
      if (!t || t.shape !== 'line') return;
      const T = 0.8 / rageOf(sim);
      teleRoll(
        penAt(g, px, py),
        {
          R: t.r * TS,
          W: (t.w ?? m.r) * TS,
          ang: t.ang ?? m.dir,
          arc: 0,
          p: clamp01(m.t / T),
          tl: T - m.t,
          t: m.t,
          small,
        },
        seed,
      );
      return;
    }
    case 'leapAim':
    case 'leap': {
      if (!t || t.x === undefined || t.y === undefined) return;
      const air = m.mode === 'leap';
      // До приземления: в прицеле — T из метки (она наливается к нему), в
      // прыжке — ровно 0,5 с полёта.
      const aim = teleTime(m, 1.2);
      const tl = air ? Math.max(0, 0.5 - m.t) : aim.T - m.t;
      const p = air ? 1 : aim.p;
      teleLeap(penAt(g, px + (t.x - m.x) * TS, py + (t.y - m.y) * TS), {
        R: t.r * TS,
        ang: 0,
        arc: TAU,
        p,
        tl,
        t: air ? 1 + m.t : m.t,
        lock: air || m.t >= 0.4,
        air,
      });
      return;
    }
    case 'roar':
      roarFloor(penAt(g, px, py), m.t, seed, small);
      return;
    case 'summon':
      summonFloor(penAt(g, px, py), m.t, seed);
      return;
  }
}

function kingAir(g: CanvasRenderingContext2D, m: Mob, px: number, py: number): void {
  const small = m.kind === 'kinglet';
  const left = Math.cos(m.face) < 0 ? -1 : 1;
  if (m.mode === 'roar' || m.mode === 'summon') {
    // Рык и зов: звук волнами из пасти.
    const hx = px + left * (small ? 8 : 16);
    const hy = py - (small ? 9 : 44);
    shout(penAt(g, hx, hy), m.t, left, m.mode === 'roar' ? 1 : 0.6);
  }
}

/** Смотритель: одна зона на бой, рисует метки всех королей. */
function overseer(above: boolean) {
  return (g: CanvasRenderingContext2D, z: Zone | Strike, px: number, py: number): boolean => {
    const sim = paintSim();
    if (!sim) return true;
    // Начало координат кадра: зона стоит в (z.x, z.y) и нарисована в (px, py).
    const left = z.x * TS - px;
    const top = z.y * TS - py;
    g.save();
    for (const m of sim.mobs) {
      if (!isKing(m)) continue;
      const mx = m.x * TS - left;
      const my = m.y * TS - top;
      if (above) kingAir(g, m, mx, my);
      else kingFloor(g, sim, m, mx, my);
    }
    g.restore();
    return true;
  };
}

registerZonePainter('f1_kingtele', overseer(false));
registerZonePainter('f1_kingteleL', overseer(true));

/**
 * Куда идёт взмах рельса: чётный — из-за спины сверху вниз, нечётный —
 * обратно. Смотрит вправо — «сверху вниз» это по часовой (+), влево — против.
 * Номер взмаха в серии — `3 − m.data.combo` (0, 1, 2).
 */
function swingSide(n: number, face: number): number {
  const right = Math.cos(face) >= 0 ? 1 : -1;
  return (n % 2 === 0 ? 1 : -1) * right;
}

// ---------------------------------------------------------------------------
// Рык и зов (живут, пока король в этом режиме).
// ---------------------------------------------------------------------------

/** Рык: пол вздрагивает волнами от ног, со свода сыплются камешки. */
function roarFloor(p: Pen, t: number, seed: number, small: boolean): void {
  if (small) return;
  for (const [t0, R1] of [
    [0.1, 72],
    [0.42, 58],
  ] as [number, number][]) {
    const u = (t - t0) / 0.8;
    if (u < 0 || u >= 1) continue;
    const R = 10 + R1 * easeOut(u);
    const a = 0.75 * (1 - u) ** 1.3;
    // Фронт волны — рваное кольцо (сплющено: пол в три четверти).
    ink(p, C.dustPale[2], a * 0.7);
    arcPx(R, 0, TAU, (x, y, v) => {
      if (rr(seed + t0 * 100, Math.round(v * R * 2), 71) < 0.5) put(p, x, y * 0.8);
    });
    // Пыль поднимается там, где прошла волна: вразнобой, не бусами.
    for (let i = 0; i < 16; i++) {
      const ang = rr(seed + t0 * 100, i, 75) * TAU;
      const d = R * lerp(0.75, 1.05, rr(seed + t0 * 100, i, 76));
      const rp = lerp(2, 5, rr(seed + t0 * 100, i, 77)) * (0.6 + 0.8 * u);
      drawPuff(p, Math.cos(ang) * d, Math.sin(ang) * d * 0.8 - 2 * u, rp, C.dustPale, a * 0.8);
    }
  }
  // Камешки со свода: падают вокруг короля, у пола — облачко и отскок.
  for (let i = 0; i < 14; i++) {
    const t0 = lerp(0.1, 0.85, rr(seed, i, 72));
    const tt = t - t0;
    if (tt < 0 || tt > 0.7) continue;
    const a = rr(seed, i, 73) * TAU;
    const d = lerp(16, 70, rr(seed, i, 74));
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d * 0.75;
    const fall = 0.32;
    const big = i % 3 === 0;
    if (tt < fall) {
      const k = tt / fall;
      const z = 100 * (1 - k * k);
      ink(p, C.ink, 0.15 + 0.3 * k);
      put(p, x - 1, y + 1, big ? 3 : 2, 1);
      p.g.globalAlpha = 1;
      drawBit(p, x, y - z, big ? 'chunk' : 'pebble', i, i);
    } else {
      const k = (tt - fall) / (0.7 - fall);
      drawPuff(p, x, y - k * 3, 1 + 3 * k, C.dustPale, 0.65 * (1 - k));
      const hop = Math.max(0, Math.sin(Math.min(1, k * 2.5) * Math.PI) * 4);
      p.g.globalAlpha = 1 - k * k;
      drawBit(p, x + (i % 2 ? 1 : -1) * Math.round(k * 4), y - hop, big ? 'chunk' : 'pebble', 0, i);
    }
  }
}

/** Зов стаи: у ног дрожит пол — камешки подпрыгивают. */
function summonFloor(p: Pen, t: number, seed: number): void {
  for (let i = 0; i < 12; i++) {
    const a = rr(seed, i, 81) * TAU;
    const d = lerp(14, 40, rr(seed, i, 82));
    const hop = Math.abs(Math.sin(t * lerp(18, 26, rr(seed, i, 83)) + i)) * 2 * Math.min(1, t * 2);
    ink(p, C.ink, 0.3);
    put(p, Math.cos(a) * d, Math.sin(a) * d * 0.75 + 1);
    ink(p, C.rock[3], 0.9);
    put(p, Math.cos(a) * d, Math.sin(a) * d * 0.75 - hop);
  }
}

/** Звук волнами: дуги из пасти в сторону взгляда и назад. */
function shout(p: Pen, t: number, left: number, power: number): void {
  const period = power > 0.8 ? 0.22 : 0.16;
  const dur = 0.5;
  for (let k = 0; k < 8; k++) {
    const t0 = k * period;
    const u = (t - t0) / dur;
    if (u < 0 || u >= 1) continue;
    const R = 4 + (power > 0.8 ? 30 : 22) * easeOut(u);
    const a = (1 - u) * (power > 0.8 ? 0.8 : 0.6);
    for (const dir of [left, -left]) {
      const mid = dir > 0 ? 0 : Math.PI;
      const span = dir === left ? 0.75 : 0.5;
      ink(p, C.ink, a * 0.35);
      arcPx(R, mid - span, mid + span, (x, y) => put(p, x, y + 1));
      ink(p, power > 0.8 ? C.boneHi : C.pink[4], a);
      arcPx(R, mid - span, mid + span, (x, y) => put(p, x, y));
    }
  }
}

// ---------------------------------------------------------------------------
// КОНТАКТ ударов. Каждый — рисунок «пол» (слой 0) и «свет» (слой 1).
// ---------------------------------------------------------------------------

/** Что знает контакт: форма, направление, зерно; поля `v…` зоны мозга. */
interface FxRec {
  ang: number;
  r: number;
  arc: number;
  w: number;
  seed: number;
  /** Номер взмаха в серии, сторона, нормаль стены, задержка. */
  n: number;
  nx: number;
  ny: number;
  delay: number;
  dx: number;
  dy: number;
}

type VZone = Zone & {
  vAng?: number;
  vR?: number;
  vN?: number;
  vNx?: number;
  vNy?: number;
  vDelay?: number;
  vDx?: number;
  vDy?: number;
  vSeed?: number;
};

function recOfZone(z: VZone): FxRec {
  return {
    ang: z.vAng ?? 0,
    r: z.vR ?? z.r,
    arc: 0,
    w: 0,
    seed: (z.vSeed ?? Math.round(z.x * 131 + z.y * 977)) | 0,
    n: z.vN ?? 0,
    nx: z.vNx ?? 0,
    ny: z.vNy ?? -1,
    delay: z.vDelay ?? 0,
    dx: z.vDx ?? 0,
    dy: z.vDy ?? 0,
  };
}

function recOfImpact(r: ImpactRec): FxRec {
  return {
    ang: r.ang ?? 0,
    r: r.r ?? 1,
    arc: r.arc ?? 1,
    w: r.w ?? 0.5,
    seed: r.seed | 0,
    n: 0,
    nx: 0,
    ny: -1,
    delay: 0,
    dx: 0,
    dy: 0,
  };
}

type FxPaint = (p: Pen, r: FxRec, age: number, layer: 0 | 1) => void;

/**
 * Контакт `art`: зоны мозга `art_hit` (пол) и `art_hitL` (свет) и контакт
 * удара `art` для листа кадров (там рисуются оба слоя сразу).
 */
function contact(art: string, life: number, paint: FxPaint, shake?: number): void {
  registerImpactPainter(art, {
    life,
    shake,
    paint: (g, rec, px, py, _s, age) => {
      const p = penAt(g, px, py);
      const r = recOfImpact(rec);
      paint(p, r, age, 0);
      paint(p, r, age, 1);
      return true;
    },
  });
  for (const layer of [0, 1] as const)
    registerZonePainter(`${art}_hit${layer ? 'L' : ''}`, (g, z, px, py) => {
      const zz = z as VZone;
      g.save();
      paint(penAt(g, px, py), recOfZone(zz), zz.t, layer);
      g.restore();
      g.globalAlpha = 1;
      return true;
    });
}

// ---- Рубка тесаком ---------------------------------------------------------

/** Точка, куда ложится тесак: 1,4 клетки перед королём (как `boom` мозга). */
const CLEAVE_AT = 1.4 * TS;

/** Вмятина: тёмное пятно, пол просел под ударом. */
function dent(p: Pen, x: number, y: number, rx: number, ry: number, a: number): void {
  if (a <= 0.01 || rx < 1) return;
  // Два прохода по цвету: смена `fillStyle` на каждый пиксель дорога.
  for (const core of [true, false]) {
    ink(p, '#120c08', a * (core ? 0.55 : 0.35));
    for (let yy = -Math.ceil(ry); yy <= Math.ceil(ry); yy++)
      for (let xx = -Math.ceil(rx); xx <= Math.ceil(rx); xx++) {
        const d = (xx * xx) / (rx * rx) + (yy * yy) / (ry * ry);
        if (d > 1 || d < 0.6 !== core) continue;
        // Край — через пиксель: мягкий, но без сглаживания.
        if (!core && (xx + yy) % 2 !== 0) continue;
        put(p, x + xx, y + yy);
      }
  }
  // Светлая дальняя кромка: свет сверху-слева ложится на её нижнюю стенку.
  ink(p, C.dust[2], a * 0.45);
  arcPx(rx, 0.35, Math.PI - 0.35, (xx, yy) => put(p, x + xx, y + (yy * ry) / rx + 1));
}

/** Рваное кольцо пыли по полу: волна удара расходится и гаснет. */
function dustRing(p: Pen, x: number, y: number, R: number, a: number, seed: number): void {
  if (a <= 0.01) return;
  ink(p, C.dustPale[2], a);
  arcPx(R, 0, TAU, (xx, yy, u) => {
    if (rr(seed, Math.round(u * 97), 7) < 0.55) put(p, x + xx, y + yy * 0.85);
  });
  ink(p, C.dustPale[1], a * 0.6);
  arcPx(Math.max(1, R - 2), 0, TAU, (xx, yy, u) => {
    if (rr(seed, Math.round(u * 89), 8) < 0.35) put(p, x + xx, y + yy * 0.85);
  });
}

contact('f1_cleave', 1.7, (p, r, age, layer) => {
  const c = Math.cos(r.ang);
  const s = Math.sin(r.ang);
  const ix = c * CLEAVE_AT;
  const iy = s * CLEAVE_AT;
  // Поперёк удара разлетается грязь: тесак вгоняет лезвие в пол.
  const perp = r.ang + Math.PI / 2;
  const nx = Math.cos(perp);
  const ny = Math.sin(perp);
  const seed = r.seed;
  const fade = age < 1.1 ? 1 : clamp01(1 - (age - 1.1) / 0.6);
  if (layer === 0) {
    dent(p, ix + c * 2, iy + s * 2, 7, 4, fade);
    // Рубец вдоль удара: тёмная середина в два пикселя, светлая губа сверху.
    const grow = easeOut(age / 0.05);
    const up = ny < 0 ? 1 : -1;
    linePx(
      ix - c * 9 * grow,
      iy - s * 9 * grow,
      ix + c * 12 * grow,
      iy + s * 12 * grow,
      (x, y, u) => {
        const mid = 1 - Math.abs(u - 0.45) * 2;
        ink(p, C.dust[2], 0.8 * fade);
        put(p, x - nx * up * (mid > 0.4 ? 2 : 1), y - ny * up * (mid > 0.4 ? 2 : 1));
        ink(p, '#100a06', 0.95 * fade);
        put(p, x, y);
        if (mid > 0.3) put(p, x + nx * up, y + ny * up);
      },
    );
    // Трещинки из концов и боков рубца.
    for (let i = 0; i < 4; i++) {
      const a = r.ang + [0, Math.PI, 1.9, -1.9][i] + (rr(seed, i, 91) - 0.5) * 0.6;
      const pts = crackPts(seed, i, a, 0, lerp(7, 13, rr(seed, i, 92)));
      const ox = i === 0 ? ix + c * 11 : i === 1 ? ix - c * 8 : ix + c * 2;
      const oy = i === 0 ? iy + s * 11 : i === 1 ? iy - s * 8 : iy + s * 2;
      drawCrack(p, pts, easeOut((age - 0.02) / 0.08), 0.85 * fade, ox, oy);
    }
    // Волна пыли по полу — рваное кольцо.
    if (age < 0.22) dustRing(p, ix, iy, 4 + 22 * easeOut(age / 0.22), 0.8 * (1 - age / 0.22), seed);
    // Пыль клубами в обе стороны от рубца и вперёд: вылетает, тормозит, ложится.
    puffs(p, seed, age, {
      n: 14,
      ang: perp,
      spread: 0.6,
      mirror: true,
      dist: [12, 30],
      r0: [2, 3],
      r1: [5, 9],
      life: [0.6, 1.1],
      rise: [2, 7],
      a0: 0.75,
      pal: C.dustPale,
      from: (i) => {
        const u = (i / 14) * 20 - 8;
        return [ix + c * u, iy + s * u];
      },
    });
    puffs(p, seed + 5, age, {
      n: 5,
      ang: r.ang,
      spread: 0.45,
      dist: [14, 26],
      r0: [2, 3],
      r1: [6, 9],
      life: [0.6, 0.95],
      rise: [3, 8],
      a0: 0.6,
      pal: C.dustPale,
      from: () => [ix, iy],
    });
    // Комья, солома, щепа и нитки ковра: веером в стороны, скачут и ложатся.
    bits(p, seed, age, {
      n: 26,
      ang: perp,
      spread: 0.9,
      mirror: true,
      v: [26, 80],
      vz: [60, 150],
      life: [1.0, 1.6],
      kinds: ['clod', 'clod', 'clod', 'pebble', 'straw', 'straw', 'splinter', 'thread'],
      from: (i) => [ix + c * ((i % 6) * 3 - 7), iy + s * ((i % 6) * 3 - 7)],
    });
  } else {
    // Кадр удара: белый разрез вдоль рубца и звезда.
    if (age < 0.09) {
      const k = age / 0.09;
      ink(p, k < 0.5 ? C.white : C.hot[1], 1 - k * 0.5);
      linePx(ix - c * 10, iy - s * 10, ix + c * 13, iy + s * 13, (x, y, u) => {
        const w = Math.abs(u - 0.45) < 0.25 ? 2 : 1;
        put(p, x - (w > 1 ? nx : 0), y - (w > 1 ? ny : 0), 1, 1);
        put(p, x, y);
      });
      drawStar(p, ix, iy - 1, Math.round(lerp(10, 5, k)), 1);
    }
    // Раскалённая губа рубца остывает.
    if (age >= 0.09 && age < 0.35) {
      const k = (age - 0.09) / 0.26;
      ink(p, k < 0.3 ? C.hot[1] : k < 0.6 ? C.hot[2] : C.hot[4], 1 - k);
      linePx(ix - c * 6, iy - s * 6, ix + c * 9, iy + s * 9, (x, y) => put(p, x, y));
    }
    // Искры: металл о камень, коротко и близко.
    sparks(p, seed, age, {
      n: 8,
      ang: r.ang,
      spread: 1.2,
      v: [50, 120],
      vz: [40, 110],
      life: [0.16, 0.34],
      from: () => [ix, iy],
    });
  }
});

// ---- Хлыст хвостами --------------------------------------------------------

contact('f1_whip', 1.3, (p, r, age, layer) => {
  const R = r.r * TS;
  const seed = r.seed;
  // Хвосты проходят полный круг за 0,11 с — по часовой, как кружили в метке.
  const SW = 0.11;
  const a0 = rr(seed, 0, 101) * TAU;
  const head = a0 + TAU * easeOut(age / SW);
  // Когда хвосты прошли долю круга u (обратная к easeOut).
  const whipAt = (u: number) => SW * (1 - Math.cbrt(1 - clamp01(u)));
  const fade = age < 0.7 ? 1 : clamp01(1 - (age - 0.7) / 0.5);
  if (layer === 0) {
    // Борозда по кругу: хвосты чиркнули по полу.
    const done = Math.min(1, age / SW);
    arcPx(R, a0, a0 + TAU * done, (x, y, u) => {
      const q = rr(seed, Math.round(u * 300), 102);
      if (q < 0.25) return;
      ink(p, '#120c08', 0.6 * fade);
      put(p, x, y);
      if (q > 0.7) {
        ink(p, C.dust[2], 0.5 * fade);
        put(p, x, y - 1);
      }
    });
    // Пыль сдувает наружу по ходу хвостов — спиралью.
    puffs(p, seed, age, {
      n: 20,
      ang: 0,
      spread: 0.3,
      dist: [8, 18],
      r0: [2, 3],
      r1: [4, 7],
      life: [0.5, 0.9],
      rise: [2, 5],
      a0: 0.7,
      pal: C.dustPale,
      at: (i) => whipAt(i / 20),
      dir: (i) => a0 + (i / 20) * TAU + 0.6,
      from: (i) => {
        // Неровно: клубы не бусами по кругу, а где хвост чиркнул сильнее.
        const a = a0 + ((i + rr(seed, i, 104) * 0.8) / 20) * TAU;
        const rad = R + (rr(seed, i, 105) - 0.4) * 7;
        return [Math.cos(a) * rad, Math.sin(a) * rad];
      },
    });
    bits(p, seed, age, {
      n: 16,
      ang: 0,
      spread: 0.5,
      v: [24, 64],
      vz: [40, 100],
      life: [0.8, 1.2],
      at: (i) => whipAt(i / 16),
      dir: (i) => a0 + (i / 16) * TAU + 0.7,
      kinds: ['straw', 'straw', 'pebble', 'clod', 'thread'],
      from: (i) => {
        const a = a0 + (i / 16) * TAU;
        return [Math.cos(a) * R, Math.sin(a) * R];
      },
    });
  } else {
    // След хвостов: толстый розово-белый серп бежит по кругу, хвост тает.
    if (age < SW + 0.1) {
      const tail = 2.4;
      const fadeAll = age > SW ? clamp01(1 - (age - SW) / 0.1) : 1;
      const steps = Math.ceil(tail * R);
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const a = head - u * tail;
        if (a < a0) continue;
        const w = u < 0.12 ? 3 : u < 0.4 ? 2 : 1;
        const x = Math.cos(a) * (R + (w > 1 ? 1 : 0));
        const y = Math.sin(a) * (R + (w > 1 ? 1 : 0));
        ink(p, C.ink, 0.5 * (1 - u) * fadeAll);
        put(p, x - (w - 1) / 2, y - (w - 1) / 2 + 1, w, w);
        const col = u < 0.08 ? C.white : u < 0.3 ? C.pink[4] : u < 0.6 ? C.pink[3] : C.pink[2];
        ink(p, col, (1 - u) ** 0.7 * fadeAll);
        put(p, x - (w - 1) / 2, y - (w - 1) / 2, w, w);
      }
    }
    // Щелчки кнутов — три звёздочки там, где прошли концы хвостов.
    for (let j = 0; j < 3; j++) {
      const tj = SW * (0.3 + j * 0.32);
      const k = (age - tj) / 0.12;
      if (k < 0 || k >= 1) continue;
      const a = a0 + TAU * easeOut(tj / SW);
      drawStar(p, Math.cos(a) * (R + 3), Math.sin(a) * (R + 3), Math.round(lerp(6, 2, k)), 1 - k);
    }
  }
});

// ---- Взмах рельса ----------------------------------------------------------

contact('f1_sweep', 1.5, (p, r, age, layer) => {
  const n = r.n;
  const heavy = n >= 2;
  const side = swingSide(n, r.ang);
  const H = 1.25;
  const aS = r.ang - side * H;
  // Каждый взмах чиркает на своём расстоянии: три борозды не сливаются в одну.
  const RR = (r.r > 1.5 ? r.r : 2.8) * TS * [0.8, 0.66, 0.9][n % 3];
  const seed = r.seed + n * 17;
  // Конец рельса чиркает по полу дугой за 0,09 с.
  const SW = 0.09;
  const headU = easeOut(age / SW);
  const angAt = (u: number) => aS + side * 2 * H * u;
  // Когда конец прошёл угол u (обратная к easeOut).
  const tAt = (u: number) => SW * (1 - Math.cbrt(1 - clamp01(u)));
  const steps = Math.ceil(2 * H * RR);
  if (layer === 0) {
    const fade = age < 1.0 ? 1 : clamp01(1 - (age - 1.0) / 0.5);
    // Борозда: неровная, у тяжёлого — двойная и с трещинами.
    for (let k = 0; k <= steps * headU; k++) {
      const u = k / steps;
      const a = angAt(u);
      const j = (rr(seed, k, 111) - 0.5) * 1.6;
      const x = Math.cos(a) * (RR + j);
      const y = Math.sin(a) * (RR + j);
      ink(p, '#100a06', 0.85 * fade);
      put(p, x, y);
      if (heavy || rr(seed, k, 114) < 0.3) put(p, x + Math.cos(a), y + Math.sin(a));
      ink(p, C.dust[2], 0.6 * fade);
      put(p, x - Math.cos(a), y - Math.sin(a) - 1);
    }
    if (heavy)
      for (let i = 0; i < 5; i++) {
        const u = 0.1 + i * 0.2;
        const a = angAt(u);
        const pts = crackPts(
          seed,
          i,
          a + (rr(seed, i, 112) - 0.5) * 0.8,
          0,
          9 + rr(seed, i, 113) * 7,
        );
        drawCrack(
          p,
          pts,
          easeOut((age - tAt(u)) / 0.07),
          0.85 * fade,
          Math.cos(a) * RR,
          Math.sin(a) * RR,
        );
      }
    // Пыль вдоль дуги — сдута по ходу взмаха и наружу.
    const np = heavy ? 16 : 10;
    puffs(p, seed, age, {
      n: np,
      ang: 0,
      spread: 0.3,
      dist: [8, 18],
      r0: [2, 3],
      r1: [4, heavy ? 8 : 6],
      life: [0.5, 0.95],
      rise: [2, 5],
      a0: 0.7,
      pal: C.dustPale,
      at: (i) => tAt(i / np),
      dir: (i) => angAt(i / np) + side * 0.8,
      from: (i) => {
        const a = angAt(i / np);
        return [Math.cos(a) * RR, Math.sin(a) * RR];
      },
    });
    const nb = heavy ? 18 : 10;
    bits(p, seed, age, {
      n: nb,
      ang: 0,
      spread: 0.6,
      v: [24, 76],
      vz: [40, 110],
      life: [0.8, 1.3],
      at: (i) => tAt(i / nb),
      dir: (i) => angAt(i / nb) + side * 0.9,
      kinds: heavy
        ? ['chunk', 'clod', 'pebble', 'pebble', 'straw']
        : ['pebble', 'clod', 'straw', 'pebble'],
      from: (i) => {
        const a = angAt(i / nb);
        return [Math.cos(a) * RR, Math.sin(a) * RR];
      },
    });
  } else {
    // Раскалённая дуга: где конец прошёл только что — бело и толсто, дальше
    // остывает и тончает.
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const since = age - tAt(u);
      if (since < 0 || since > 0.6) continue;
      const a = angAt(u);
      const col =
        since < 0.04
          ? C.hot[0]
          : since < 0.12
            ? C.hot[1]
            : since < 0.25
              ? C.hot[2]
              : since < 0.42
                ? C.hot[3]
                : C.hot[4];
      const w = since < 0.05 ? 3 : since < 0.15 || heavy ? 2 : 1;
      ink(p, col, since > 0.42 ? (0.6 - since) / 0.18 : 1);
      for (let q = 0; q < w; q++) put(p, Math.cos(a) * (RR + q - 1), Math.sin(a) * (RR + q - 1));
    }
    // Веер искр с конца рельса: по касательной, в сторону взмаха.
    sparks(p, seed, age, {
      n: heavy ? 30 : 18,
      ang: 0,
      spread: 0.4,
      v: [70, 160],
      vz: [30, 100],
      life: [0.18, 0.4],
      delay: [0, SW],
      dir: (_i, _s, t0) => angAt(1 - (1 - t0 / SW) ** 3) + side * (Math.PI / 2) * 0.85,
      from: (_i, _s, t0) => {
        const a = angAt(1 - (1 - t0 / SW) ** 3);
        return [Math.cos(a) * RR, Math.sin(a) * RR];
      },
    });
    // Конец взмаха — вспышка; у тяжёлого крупнее.
    const k = (age - SW) / 0.12;
    if (k >= 0 && k < 1) {
      const a = angAt(1);
      drawStar(p, Math.cos(a) * RR, Math.sin(a) * RR, Math.round(lerp(heavy ? 9 : 5, 2, k)), 1 - k);
    }
  }
});

// ---- Прыжок с рельсом: приземление -----------------------------------------

contact('f1_leap', 2.8, (p, r, age, layer) => {
  const seed = r.seed;
  const R = 1.7 * TS;
  const fade = age < 2.1 ? 1 : clamp01(1 - (age - 2.1) / 0.7);
  if (layer === 0) {
    // Воронка: пол просел — тёмная середина, светлая дальняя кромка.
    dent(p, 0, 1, 10 * easeOut(age / 0.05), 6 * easeOut(age / 0.05), fade);
    // Лучи трещин.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + (rr(seed, i, 121) - 0.5) * 0.5;
      const pts = crackPts(seed, i, a, 7, lerp(20, 32, rr(seed, i, 122)));
      drawCrack(p, pts, easeOut(age / 0.1), 0.95 * fade);
    }
    // Ударная волна по полу — до края круга и дальше.
    if (age < 0.3)
      dustRing(p, 0, 0, 8 + (R + 10) * easeOut(age / 0.3), 0.85 * (1 - age / 0.3), seed);
    // Кольцо пыли: катится наружу, тормозит, оседает.
    puffs(p, seed, age, {
      n: 24,
      ang: 0,
      spread: Math.PI,
      dist: [18, 36],
      r0: [3, 4],
      r1: [7, 11],
      life: [0.9, 1.5],
      rise: [4, 10],
      a0: 0.75,
      pal: C.dustPale,
    });
    // Глыбы и камни вверх — падают, скачут, ложатся.
    bits(p, seed, age, {
      n: 30,
      ang: 0,
      spread: Math.PI,
      v: [30, 100],
      vz: [90, 200],
      life: [1.5, 2.5],
      kinds: ['chunk', 'chunk', 'chunk', 'clod', 'clod', 'pebble', 'straw'],
    });
  } else {
    // Свет: белая звезда и толстое кольцо удара.
    if (age < 0.18) {
      const k = age / 0.18;
      drawStar(p, 0, -2, Math.round(lerp(15, 5, k)), 1 - k * 0.4);
      ink(p, k < 0.3 ? C.white : k < 0.6 ? C.hot[1] : C.hot[3], 1 - k);
      ringPx(p, 0, 0, 6 + (R + 6) * easeOut(k), k < 0.5 ? 2 : 1, seed);
    }
    sparks(p, seed, age, {
      n: 12,
      ang: 0,
      spread: Math.PI,
      v: [50, 120],
      vz: [70, 160],
      life: [0.25, 0.5],
    });
  }
});

// ---- Волна после прыжка: `f1_shock` — настоящий удар по площади -------------

/** Метка волны: кольцо-полоса опасна, внутри — безопасно; трещины бегут к ней. */
registerZonePainter('f1_shock', (g, z, px, py, scale) => {
  const st = z as Strike;
  const p = penAt(g, px, py);
  const k = clamp01(st.t / st.warn);
  const tl = st.warn - st.t;
  const hot = hotOf(tl);
  const R = st.r * scale;
  const w = (st.w ?? 0.5) * scale;
  const seed = (st.id ?? 1) * 13 + 7;
  g.save();
  // Полоса опасности: заливка кольцом — красная, к удару светлеет.
  g.globalAlpha = 0.16 + 0.24 * k + 0.12 * hot;
  g.strokeStyle = hot > 0.5 ? '#ff9a60' : '#d8402a';
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(p.x, p.y, R, 0, TAU);
  g.stroke();
  // Трещины бегут от воронки к полосе — волна идёт под полом.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + rr(seed, i, 131) * 0.4;
    const pts = crackPts(seed, i, a, 10, R - w);
    drawCrack(p, pts, easeIn(k * 1.05), 0.85);
  }
  // Кромки полосы: штрихи бегут наружу по кругу.
  const run = st.t * 40;
  for (const rad of [R - w, R + w]) {
    const pts: [number, number, number][] = [];
    arcPx(rad, 0, TAU, (x, y, u) => pts.push([x, y, dashOn(u * TAU * rad, run, hot) ? 1 : 0]));
    rim(p, pts, C.bone, hot, 0.7 + 0.3 * k, hot > 0.35);
  }
  // Камешки на полосе подскакивают — земля ходит, к удару всё сильнее.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU + rr(seed, i, 132) * 0.2;
    const rad = R + (rr(seed, i, 133) * 2 - 1) * w * 0.7;
    const hop = Math.abs(Math.sin(st.t * 22 + i * 1.7)) * (1 + 4 * k * k);
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    ink(p, C.ink, 0.45);
    put(p, x, y + 1);
    ink(p, C.rock[3], 1);
    put(p, x, y - hop);
  }
  g.restore();
  return true;
});

contact(
  'f1_shock',
  1.4,
  (p, r, age, layer) => {
    const R = (r.r > 0.5 ? r.r : 3) * TS;
    const seed = r.seed + 3;
    const fade = age < 0.9 ? 1 : clamp01(1 - (age - 0.9) / 0.5);
    if (layer === 0) {
      // Выброс по кругу: земля вздыбилась столбами и падает обратно.
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU + rr(seed, i, 143) * 0.2;
        const u = (age - rr(seed, i, 144) * 0.05) / 0.35;
        if (u < 0 || u >= 1) continue;
        const h = Math.round(lerp(10, 20, rr(seed, i, 145)) * Math.sin(u * Math.PI));
        const x = Math.round(Math.cos(a) * R);
        const y = Math.round(Math.sin(a) * R);
        ink(p, C.dust[1], 0.8 * (1 - u));
        put(p, x - 1, y - h, 3, h);
        ink(p, C.dustPale[2], 0.9 * (1 - u));
        put(p, x - 1, y - h, 1, h);
      }
      bits(p, seed, age, {
        n: 36,
        ang: 0,
        spread: 0.45,
        dir: (i) => (i / 36) * TAU,
        v: [10, 40],
        vz: [80, 170],
        life: [0.8, 1.3],
        kinds: ['clod', 'chunk', 'pebble', 'pebble', 'straw'],
        from: (i) => {
          const a = (i / 36) * TAU;
          return [Math.cos(a) * R, Math.sin(a) * R];
        },
      });
      puffs(p, seed, age, {
        n: 26,
        ang: 0,
        spread: 0.3,
        dir: (i) => (i / 26) * TAU + rr(seed, i, 141) * 0.2,
        dist: [6, 14],
        r0: [2, 3],
        r1: [5, 8],
        life: [0.6, 1.1],
        rise: [4, 10],
        a0: 0.7,
        pal: C.dustPale,
        from: (i) => {
          const a = (i / 26) * TAU + rr(seed, i, 141) * 0.2;
          return [Math.cos(a) * R, Math.sin(a) * R];
        },
      });
      // След волны — бороздка по кругу.
      ink(p, '#100a06', 0.5 * fade);
      arcPx(R, 0, TAU, (x, y, u) => {
        if (rr(seed, Math.round(u * 300), 142) > 0.45) put(p, x, y);
      });
    } else if (age < 0.2) {
      const k = age / 0.2;
      ink(p, k < 0.35 ? C.white : C.hot[2], (1 - k) * 0.95);
      ringPx(p, 0, 0, R + 10 * easeOut(k), k < 0.4 ? 2 : 1, seed);
      ink(p, C.hot[1], (1 - k) * 0.6);
      ringPx(p, 0, 0, R - 6 * easeOut(k), 1, seed + 1);
    }
  },
  0.2,
);

// ---- Перекат: пыль следом, удар о стену ------------------------------------

registerZonePainter('f1_rolldust', (g, z, px, py) => {
  const r = recOfZone(z as VZone);
  const p = penAt(g, px, py);
  const age = (z as Zone).t;
  const back = r.ang + Math.PI;
  // Малый король катится клубком втрое меньше — и след меньше.
  const k = Math.max(0.5, Math.min(1, r.r / 0.95));
  g.save();
  // Примятая полоса: два тёмных следа, тают.
  const fade = clamp01(1 - age / 0.9);
  const c = Math.cos(r.ang);
  const s = Math.sin(r.ang);
  ink(p, '#120c08', 0.4 * fade);
  for (const side of [-1, 1])
    linePx(
      -c * 10 - s * side * 4,
      -s * 10 + c * side * 4,
      c * 4 - s * side * 4,
      s * 4 + c * side * 4,
      (x, y) => put(p, x, y),
    );
  // Клубы вдоль следа (зона кладётся раз в 1,2 клетки — полоса без дыр).
  puffs(p, r.seed, age, {
    n: 6,
    ang: back,
    spread: 1.2,
    dist: [4 * k, 12 * k],
    r0: [2 * k, 3 * k],
    r1: [4 * k, 7 * k],
    life: [0.5, 0.85],
    rise: [2, 6],
    a0: 0.7,
    pal: C.dustPale,
    from: (i) => [-c * (i * 3.4 - 4), -s * (i * 3.4 - 4)],
  });
  bits(p, r.seed, age, {
    n: Math.round(4 * k),
    ang: back,
    spread: 0.8,
    v: [20, 50],
    vz: [40, 90],
    life: [0.5, 0.85],
    kinds: ['straw', 'pebble', 'thread', 'clod'],
  });
  g.restore();
  return true;
});

contact('f1_wall', 1.5, (p, r, age, layer) => {
  // Нормаль стены — от стены в зал: туда летят осколки.
  const na = Math.atan2(r.ny, r.nx);
  const seed = r.seed;
  const fade = age < 1.0 ? 1 : clamp01(1 - (age - 1.0) / 0.5);
  if (layer === 0) {
    // Трещины звездой по стене — в сторону, противоположную залу.
    for (let i = 0; i < 5; i++) {
      const a = na + Math.PI + (i / 4 - 0.5) * 2.4;
      const pts = crackPts(seed, i, a, 1, lerp(6, 11, rr(seed, i, 151)));
      drawCrack(p, pts, easeOut(age / 0.06), 0.9 * fade, 0, -4);
    }
    if (age < 0.2) dustRing(p, 0, 0, 3 + 14 * easeOut(age / 0.2), 0.7 * (1 - age / 0.2), seed);
    puffs(p, seed, age, {
      n: 12,
      ang: na,
      spread: 1.2,
      dist: [8, 24],
      r0: [2, 3],
      r1: [5, 9],
      life: [0.6, 1.1],
      rise: [4, 10],
      a0: 0.7,
      pal: C.dustPale,
    });
    bits(p, seed, age, {
      n: 18,
      ang: na,
      spread: 1.1,
      v: [30, 90],
      vz: [50, 130],
      life: [0.9, 1.5],
      kinds: ['chunk', 'chunk', 'pebble', 'pebble', 'clod'],
    });
  } else if (age < 0.12) {
    const k = age / 0.12;
    drawStar(p, 0, -5, Math.round(lerp(9, 3, k)), 1 - k * 0.5);
  }
});

// ---- Отрыв от пола и шаги --------------------------------------------------

registerZonePainter('f1_takeoff', (g, z, px, py) => {
  const r = recOfZone(z as VZone);
  const age = (z as Zone).t;
  const p = penAt(g, px, py);
  g.save();
  // Толчок: вмятина от ног, кольцо пыли и комья назад — прочь от цели.
  dent(p, 0, 1, 7, 3.5, clamp01(1 - (age - 0.5) / 0.5));
  if (age < 0.25) dustRing(p, 0, 0, 4 + 18 * easeOut(age / 0.25), 0.75 * (1 - age / 0.25), r.seed);
  puffs(p, r.seed, age, {
    n: 12,
    ang: r.ang + Math.PI,
    spread: 1.5,
    dist: [8, 22],
    r0: [2, 3],
    r1: [5, 8],
    life: [0.55, 0.95],
    rise: [2, 6],
    a0: 0.7,
    pal: C.dustPale,
  });
  bits(p, r.seed, age, {
    n: 10,
    ang: r.ang + Math.PI,
    spread: 1.0,
    v: [20, 60],
    vz: [50, 120],
    life: [0.7, 1.0],
    kinds: ['clod', 'pebble', 'straw', 'clod'],
  });
  const pts = crackPts(r.seed, 0, r.ang + Math.PI, 3, 11);
  drawCrack(p, pts, easeOut(age / 0.06), 0.8 * clamp01(1 - (age - 0.6) / 0.4));
  g.restore();
  return true;
});

registerZonePainter('f1_step', (g, z, px, py) => {
  const r = recOfZone(z as VZone);
  const age = (z as Zone).t;
  const p = penAt(g, px, py);
  g.save();
  puffs(p, r.seed, age, {
    n: 3,
    ang: r.ang + Math.PI,
    spread: 1.4,
    dist: [3, 8],
    r0: [1, 2],
    r1: [3, 4],
    life: [0.35, 0.6],
    rise: [1, 3],
    a0: 0.55,
    pal: C.dustPale,
  });
  bits(p, r.seed, age, {
    n: 2,
    ang: r.ang + Math.PI,
    spread: 1.2,
    v: [8, 22],
    vz: [20, 45],
    life: [0.4, 0.6],
    kinds: ['pebble', 'straw'],
  });
  g.restore();
  return true;
});

// ---- Узел лопнул -----------------------------------------------------------

contact('f1_split', 1.8, (p, r, age, layer) => {
  const seed = r.seed;
  if (layer === 0) {
    // Клочья хвостов и шерсти разлетаются, ложатся розовыми закорючками.
    bits(p, seed, age, {
      n: 26,
      ang: 0,
      spread: Math.PI,
      v: [30, 95],
      vz: [70, 160],
      life: [1.2, 1.8],
      kinds: ['shred', 'shred', 'shred', 'thread', 'gold'],
    });
    puffs(p, seed, age, {
      n: 12,
      ang: 0,
      spread: Math.PI,
      dist: [10, 22],
      r0: [2, 3],
      r1: [5, 8],
      life: [0.6, 1.0],
      rise: [4, 9],
      a0: 0.6,
      pal: C.dustPale,
    });
    // Розовый хлопок у самого узла: шерсть и пыль из клубка хвостов.
    puffs(p, seed + 9, age, {
      n: 7,
      ang: 0,
      spread: Math.PI,
      dist: [3, 10],
      r0: [3, 4],
      r1: [5, 8],
      life: [0.35, 0.6],
      rise: [6, 12],
      a0: 0.8,
      pal: [C.pink[1], C.pink[2], C.pink[3]],
    });
  } else {
    // Вспышка разрыва: белое сердце и розовое кольцо.
    if (age < 0.22) {
      const k = age / 0.22;
      drawStar(p, 0, -8, Math.round(lerp(13, 4, k)), 1 - k * 0.4, PINK_STAR);
      ink(p, k < 0.3 ? C.white : C.pink[4], 1 - k);
      ringPx(p, 0, -8, 4 + 24 * easeOut(k), k < 0.4 ? 2 : 1, seed);
    }
    // Два обрубка хвостов хлещут в стороны малых и обвисают.
    if (age < 0.6)
      for (const sd of [-1, 1]) {
        const k = clamp01(age / 0.35);
        const a = r.ang + Math.PI + sd * 0.7;
        const whip = Math.sin(k * Math.PI * 2.2) * (1 - k) * 0.9;
        const len = 7 + 13 * easeOut(k);
        const fade = age > 0.4 ? 1 - (age - 0.4) / 0.2 : 1;
        let x = 0;
        let y = -8;
        for (let j = 0; j < len; j++) {
          const aj = a + whip * (j / len) * sd + (j / len) * 0.9 * k;
          x += Math.cos(aj);
          y += Math.sin(aj) + (j / len) * k * 0.6;
          ink(p, C.ink, 0.5 * fade);
          put(p, x, y + 2);
          ink(p, j < 2 ? C.pink[4] : C.pink[3], fade);
          put(p, x, y);
          ink(p, C.pink[1], fade);
          put(p, x, y + 1);
        }
      }
  }
});

// ---- Нора при призыве: земля вспучивается, потом выбрасывает крысу ----------

registerZonePainter('f1_bulge', (g, z, px, py) => {
  const r = recOfZone(z as VZone);
  const age = (z as Zone).t;
  const p = penAt(g, px, py);
  g.save();
  // Холм растёт весь призыв (1 с), дрожит, трескается; потом оседает.
  const up = easeOut(age / 1.0);
  const down = clamp01((age - 1.0) / 0.9);
  const h = Math.round(5 * up * (1 - down));
  const rad = Math.round(3 + 6 * up);
  const shake = age < 1.0 ? Math.round(Math.sin(age * 55) * up) : 0;
  if (down < 1) {
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) {
        const d = (x * x + y * y * 2.2) / (rad * rad);
        if (d > 1) continue;
        if (d > 0.72 && (x + y) % 2 !== 0) continue;
        const k = -0.5 * x - 0.9 * y + (1 - d) * 3;
        ink(p, k > 3 ? C.dirt[3] : k > 0 ? C.dirt[2] : C.dirt[1], 1 - down);
        put(p, x + shake, y - Math.round(h * (1 - d)));
      }
    // Тень под холмом со стороны света.
    ink(p, C.ink, 0.35 * (1 - down));
    arcPx(rad, 0.3, Math.PI - 0.3, (x, y) => put(p, x + shake, y / 2.2 + 1));
  }
  for (let i = 0; i < 5; i++) {
    const pts = crackPts(r.seed, i, (i / 5) * TAU + 0.4, 2, rad + 4);
    drawCrack(p, pts, easeOut((age - 0.25) / 0.6), 0.9 * (1 - down), shake, -Math.round(h * 0.5));
  }
  // Камешки на холме подпрыгивают.
  for (let i = 0; i < 6; i++) {
    const a = rr(r.seed, i, 161) * TAU;
    const d = rad * lerp(0.3, 0.9, rr(r.seed, i, 162));
    const hop = Math.abs(Math.sin(age * 24 + i * 1.3)) * 2 * up * (1 - down);
    ink(p, C.rock[3], 1 - down);
    put(p, Math.cos(a) * d + shake, (Math.sin(a) * d) / 2.2 - h * 0.7 - hop);
  }
  g.restore();
  return true;
});

registerZonePainter('f1_burst', (g, z, px, py) => {
  const r = recOfZone(z as VZone);
  const age = (z as Zone).t - r.delay;
  if (age < 0) return true;
  const p = penAt(g, px, py);
  g.save();
  // Из норы в зал: комья и пыль туда, куда выходит крыса.
  const a = Math.atan2(r.dy, r.dx);
  if (age < 0.2) dustRing(p, 0, 0, 3 + 12 * easeOut(age / 0.2), 0.7 * (1 - age / 0.2), r.seed);
  puffs(p, r.seed, age, {
    n: 10,
    ang: a,
    spread: 1.0,
    dist: [8, 20],
    r0: [2, 3],
    r1: [5, 8],
    life: [0.5, 0.95],
    rise: [3, 7],
    a0: 0.75,
    pal: C.dustPale,
  });
  bits(p, r.seed, age, {
    n: 14,
    ang: a,
    spread: 1.0,
    v: [24, 76],
    vz: [60, 140],
    life: [0.9, 1.4],
    kinds: ['clod', 'clod', 'pebble', 'straw', 'chunk'],
  });
  g.restore();
  return true;
});

// ---- Брошенный тесак: вылетает из руки, крутится, звенит о пол, лежит -------

/**
 * Тесак под углом (32 шага): картинка рисуется один раз на угол. `dim` —
 * притушенный под свет зала: в полёте он рисуется поверх темноты (над
 * королём), и без этого в миг касания пола «гас» бы.
 */
function cleaverAt(step: number, dim: boolean): HTMLCanvasElement {
  const k = ((step % 32) + 32) % 32;
  return img(`cleaver|${k}|${dim ? 1 : 0}`, () => {
    let p = new Px(28, 28);
    const a = (k / 32) * TAU;
    // Середина тесака — в середине холста: рукоять начинается за 7,5 от неё.
    blade(p, [14 - Math.cos(a) * 7.5, 14 - Math.sin(a) * 7.5], a, {
      grip: 3,
      len: 12,
      w: 6,
      metal: METAL.steel,
      kind: 'cleaver',
    });
    p.outline(hex('#150f0b'));
    if (dim) p = p.tint(hex('#1a1420'), 0.32);
    return p;
  });
}

/** Когда тесак касается пола: удар и отскок (с броска). */
const CLEAVER_T1 = 0.42;
const CLEAVER_T2 = CLEAVER_T1 + 0.24;

/** Где тесак через `t` с после броска: сдвиг, высота, угол. */
function cleaverPath(t: number): { x: number; y: number; z: number; a: number; hit: number } {
  const REST = -0.15;
  // Из руки короля (правее и выше места, где ляжет) — дугой вниз, кувырком.
  if (t < CLEAVER_T1) {
    const k = t / CLEAVER_T1;
    const z = 34 + 30 * t - 263 * t * t;
    return {
      x: 16 * (1 - k),
      y: -7 * (1 - k),
      z: Math.max(0, z),
      a: REST - 0.5 - (1 - k) * 5.6,
      hit: 0,
    };
  }
  // Отскок: подпрыгнул на ребре, довернулся плашмя.
  if (t < CLEAVER_T2) {
    const tt = t - CLEAVER_T1;
    const k = tt / (CLEAVER_T2 - CLEAVER_T1);
    return {
      x: -3 * k,
      y: 1 * k,
      z: 60 * tt - 250 * tt * tt,
      a: REST - 0.5 + 0.5 * easeOut(k),
      hit: 1,
    };
  }
  // Лёг и качнулся.
  const tt = t - CLEAVER_T2;
  const rock = 0.12 * Math.sin(tt * 30) * Math.exp(-tt * 9);
  return { x: -3, y: 1, z: 0, a: REST + rock, hit: 2 };
}

function cleaverSprite(p: Pen, c: ReturnType<typeof cleaverPath>, dim: boolean, a: number): void {
  const step = Math.round((c.a / TAU) * 32);
  p.g.globalAlpha = a;
  p.g.drawImage(cleaverAt(step, dim), p.x + Math.round(c.x) - 14, p.y + Math.round(c.y - c.z) - 14);
}

/** Тесак на полу (зона сценария, 90 с): тень всегда, сам — с первого касания. */
registerZonePainter('f1_cleaver', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const t = zz.t;
  const p = penAt(g, px, py);
  const c = cleaverPath(t);
  const fade = clamp01((zz.life - t) / 1.0);
  g.save();
  // Тень: меньше и бледнее, пока тесак высоко.
  const sh = clamp01(1 - c.z / 40);
  g.globalAlpha = (0.2 + 0.2 * sh) * fade;
  g.fillStyle = C.ink;
  g.beginPath();
  g.ellipse(p.x + c.x, p.y + c.y + 1, 4 + 4 * sh, 1.5 + sh, 0, 0, TAU);
  g.fill();
  // В полёте его рисует слой поверх темноты (`f1_cleaverdrop_hitL`), он
  // перед королём; на полу — здесь, под мобами.
  if (t >= CLEAVER_T1) cleaverSprite(p, c, false, fade);
  // Лежит — раз в несколько секунд по лезвию бежит блик: «вот он».
  if (c.hit === 2) {
    const ph = (time * 0.35 + zz.x) % 1;
    if (ph < 0.08) {
      const u = ph / 0.08;
      const a = c.a;
      const ex = Math.cos(a) * lerp(-4, 8, u) - Math.sin(a) * 2;
      const ey = Math.sin(a) * lerp(-4, 8, u) + Math.cos(a) * 2;
      ink(p, C.white, fade * Math.sin(u * Math.PI));
      put(p, c.x + ex, c.y + ey);
    }
  }
  g.restore();
  return true;
});

/** Полёт тесака (поверх), звон о пол: искры и пыль в миг удара и отскока. */
contact('f1_cleaverdrop', 1.3, (p, r, age, layer) => {
  if (layer === 1 && age < CLEAVER_T1) {
    const c = cleaverPath(age);
    // След кувырка: два бледных прошлых положения.
    for (const [dt, a] of [
      [0.05, 0.22],
      [0.025, 0.4],
    ] as [number, number][])
      if (age > dt) cleaverSprite(p, cleaverPath(age - dt), true, a);
    cleaverSprite(p, c, true, 1);
  }
  for (const [t0, k] of [
    [CLEAVER_T1, 1],
    [CLEAVER_T2, 0.5],
  ] as [number, number][]) {
    const a = age - t0;
    if (a < 0) continue;
    const at = cleaverPath(t0 + 0.001);
    if (layer === 0) {
      if (a < 0.16)
        dustRing(p, at.x, at.y, 2 + 9 * k * easeOut(a / 0.16), 0.7 * (1 - a / 0.16), r.seed);
      puffs(
        p,
        r.seed + t0 * 100,
        a,
        {
          n: Math.round(7 * k),
          ang: 0,
          spread: Math.PI,
          dist: [4, 13],
          r0: [1, 2],
          r1: [3, 6],
          life: [0.45, 0.8],
          rise: [1, 4],
          a0: 0.65,
          pal: C.dustPale,
        },
        at.x,
        at.y,
      );
    } else {
      sparks(
        p,
        r.seed + t0 * 100,
        a,
        {
          n: Math.round(9 * k),
          ang: -Math.PI / 2,
          spread: 1.4,
          v: [40, 100],
          vz: [40, 110],
          life: [0.15, 0.3],
        },
        at.x,
        at.y,
      );
      if (a < 0.08)
        drawStar(p, at.x + 4, at.y - 1, Math.round(lerp(6 * k + 1, 1, a / 0.08)), 1 - a / 0.08);
    }
  }
});

// ---------------------------------------------------------------------------
// Метки для листа кадров: удар с `art` рисует ту же метку, что смотритель.
// В бою эти зоны не появляются — метки рисует смотритель из `m.tele`.
// ---------------------------------------------------------------------------

function sheetTele(draw: (p: Pen, st: Strike, o: Tele) => void) {
  return (g: CanvasRenderingContext2D, z: Zone | Strike, px: number, py: number, scale: number) => {
    const st = z as Strike;
    g.save();
    const T = st.warn || 1;
    draw(penAt(g, px, py), st, {
      R: st.r * scale,
      ang: st.ang ?? 0,
      arc: st.arc ?? TAU,
      p: clamp01(st.t / T),
      tl: T - st.t,
      t: st.t,
    });
    g.restore();
    return true;
  };
}

registerZonePainter(
  'f1_cleave',
  sheetTele((p, _st, o) => teleCone(p, o, 7, 0, CLEAVE_AT)),
);
registerZonePainter(
  'f1_sweep',
  sheetTele((p, _st, o) => teleCone(p, o, 7, swingSide(0, o.ang), 0)),
);
registerZonePainter(
  'f1_whip',
  sheetTele((p, _st, o) => teleWhip(p, o, 7)),
);
registerZonePainter(
  'f1_roll',
  sheetTele((p, st, o) => teleRoll(p, { ...o, W: (st.w ?? 0.95) * TS }, 7)),
);
registerZonePainter(
  'f1_leap',
  sheetTele((p, st, o) => teleLeap(p, { ...o, lock: st.t > 0.7, air: st.t > 0.7 })),
);
