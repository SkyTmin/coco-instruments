// Этаж 2, босс «Живые доспехи» — техники (v2.85): всё, что латы оставляют в
// мире. Метки ударов («куда» — с первого кадра, «когда» — наливается к
// удару, последние 0,2 с — ясный сигнал), контакт каждого удара
// (`registerImpactPainter`) и визуальные зоны мозга (`f2v_…`: пыль шагов,
// ветер клинка, след выпада, взрыв лат, нити сборки). Тело босса рисует
// `f2-art.ts`; с ним мы сходимся по мозгу: миг урона = кадр контакта тела
// = первый кадр контакта здесь.
//
// Всё — игровыми пикселями, как сам босс. Эффект пишет точки в свой слой
// (`Layer`: буфер пикселей, один `drawImage` на эффект), центр слоя прижат
// к точке экрана, поэтому эффект едет вместе с полом, а не «плавает» по
// нему, и контур не кипит. Переходы цвета и растворение — упорядоченным
// растром (Байер 4×4), а не прозрачностью: так рисуют пиксель-арт. Частицы —
// формулой от зерна и возраста (скорость, торможение, тяжесть, отскок), а не
// накопленным состоянием: любой кадр рисуется с любого места, и стоп-кадр
// держит картинку сам.
import { paintSim, registerImpactPainter, registerZonePainter } from '../dungeon-paint';
import type { ImpactRec } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { F2_BLADE, F2_MITE, F2_PLATE } from './f2';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Палитра: сталь лат, лиловый рой, пыль плит тронного зала, красная метка.
// ---------------------------------------------------------------------------

type RGB = readonly [number, number, number];
const rgb = (h: string): RGB => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

const RED = rgb('#ff482c');
const RED_D = rgb('#8a1e14');
const HOT = rgb('#ff9a60');
const WHITE = rgb('#ffffff');
const EDGE = rgb('#c8d4e8');
const SPEC = rgb('#eef2f6');
const STEEL = [rgb('#26282c'), rgb('#4b4e53'), rgb('#7a7f86'), rgb('#c4c8cc')] as const;
const VIO = rgb('#b07cff');
const VIO_L = rgb('#e8d4ff');
const VIO_D = rgb('#5a3a8a');
const VAPOR = rgb('#5a4e6e');
const VAPOR_L = rgb('#8a78a8');
const INK = rgb('#140f10');
/** Пыль плит: тело, свет сверху-слева, тень; светлая взвесь ударной волны. */
const DUST = rgb('#665c56');
const DUST_L = rgb('#8a7e76');
const DUST_D = rgb('#453d3a');
const PALE = rgb('#d8cdc2');
const CHIPS = [rgb('#8a7d74'), rgb('#6a5f59'), rgb('#4a413e')] as const;
/** Искра остывает: белая → жёлтая → оранжевая → красная. */
const SPARK = [
  rgb('#ffffff'),
  rgb('#fff3b0'),
  rgb('#ffd060'),
  rgb('#ff9030'),
  rgb('#d04a1a'),
  rgb('#7a2a10'),
] as const;
/** Волна клинка: от синеватого хвоста к белой кромке. */
const WAVE = [
  rgb('#4a5878'),
  rgb('#7a8aac'),
  rgb('#aebcd4'),
  rgb('#dce6f2'),
  rgb('#ffffff'),
] as const;

// ---------------------------------------------------------------------------
// Слой: буфер пикселей эффекта, один drawImage.
// ---------------------------------------------------------------------------

/** Порог растра Байера 4×4: переходы и растворение пикселями, без размытия. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

class Layer {
  readonly w: number;
  readonly h: number;
  /** Где в слое центр эффекта (слой берётся под рамку эффекта). */
  cx: number;
  cy: number;
  private readonly cv: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly px: Uint32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.cx = w >> 1;
    this.cy = h >> 1;
    this.cv = document.createElement('canvas');
    this.cv.width = w;
    this.cv.height = h;
    this.ctx = this.cv.getContext('2d')!;
    this.img = this.ctx.createImageData(w, h);
    this.px = new Uint32Array(this.img.data.buffer);
  }

  clear(): void {
    this.px.fill(0);
  }

  /** Рамка слоя в пикселях от центра эффекта: [x0, x1) × [y0, y1). */
  get x0(): number {
    return -this.cx;
  }
  get x1(): number {
    return this.w - this.cx;
  }
  get y0(): number {
    return -this.cy;
  }
  get y1(): number {
    return this.h - this.cy;
  }

  /** Стоит ли пиксель при плотности `v` (0…1) — растр Байера. */
  keep(x: number, y: number, v: number): boolean {
    if (v >= 1) return true;
    if (v <= 0) return false;
    // Растр — от центра эффекта, а не слоя: рамка меняется, узор стоит.
    const X = Math.floor(x) & 3;
    const Y = Math.floor(y) & 3;
    return v > BAYER[Y * 4 + X];
  }

  /** Точка (от центра эффекта) цветом `c` с прозрачностью `a` — поверх всего. */
  set(x: number, y: number, c: RGB, a = 1): void {
    const X = Math.floor(x) + this.cx;
    const Y = Math.floor(y) + this.cy;
    if (X < 0 || Y < 0 || X >= this.w || Y >= this.h || a <= 0.01) return;
    const A = a >= 1 ? 255 : Math.round(a * 255);
    this.px[Y * this.w + X] = ((A << 24) | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0;
  }

  /** Точка, только если на месте ничего плотнее нет (подложка под контуром). */
  under(x: number, y: number, c: RGB, a = 1): void {
    const X = Math.floor(x) + this.cx;
    const Y = Math.floor(y) + this.cy;
    if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) return;
    if (this.px[Y * this.w + X] >>> 24 >= a * 255) return;
    this.set(x, y, c, a);
  }

  /** На экран: центр слоя — в точку (px, py), прижатую к пикселю экрана. */
  blit(g: CanvasRenderingContext2D, px: number, py: number): void {
    const s = Math.abs(g.getTransform().a) || 1;
    const x = Math.round(px * s) / s;
    const y = Math.round(py * s) / s;
    this.ctx.putImageData(this.img, 0, 0);
    g.drawImage(this.cv, x - this.cx, y - this.cy);
  }
}

const LAYERS = new Map<number, Layer>();
/**
 * Чистый слой под рамку [x0, x1]×[y0, y1] (пиксели от центра эффекта).
 * Слои переиспользуются по размеру (шаг 16): на кадр не создаётся ни одного
 * холста, а выгружается и рисуется только то, где эффект есть.
 */
function layerBox(x0: number, y0: number, x1: number, y1: number): Layer {
  const w = Math.max(16, Math.ceil((x1 - x0 + 4) / 16) * 16);
  const h = Math.max(16, Math.ceil((y1 - y0 + 4) / 16) * 16);
  const key = w * 4096 + h;
  let l = LAYERS.get(key);
  if (!l) {
    l = new Layer(w, h);
    LAYERS.set(key, l);
  }
  l.cx = 2 - Math.floor(x0);
  l.cy = 2 - Math.floor(y0);
  l.clear();
  return l;
}

/** Чистый слой, в который влезает всё в радиусе `half` от центра. */
const layer = (half: number) => layerBox(-half, -half, half, half);

/** Рамка полосы вдоль `a`: вдоль [l0, l1], поперёк ±c, запас `pad`, подъём `dy`. */
function laneBox(
  l0: number,
  l1: number,
  c: number,
  a: number,
  pad: number,
  dy = 0,
): [number, number, number, number] {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const l of [l0, l1])
    for (const q of [-c, c]) {
      xs.push(l * ca - q * sa);
      ys.push(l * sa + q * ca);
    }
  return [
    Math.min(...xs) - pad,
    Math.min(...ys) - pad + Math.min(0, dy),
    Math.max(...xs) + pad,
    Math.max(...ys) + pad + Math.max(0, dy),
  ];
}

/** Рамка дуги: углы [a0, a1] (a0 ≤ a1), радиусы [r0, r1], запас `pad`. */
function arcBox(
  a0: number,
  a1: number,
  r0: number,
  r1: number,
  pad: number,
): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (ang: number) => {
    for (const r of [r0, r1]) {
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  };
  add(a0);
  add(a1);
  for (let q = Math.ceil(a0 / (Math.PI / 2)); q * (Math.PI / 2) < a1; q++) add((q * Math.PI) / 2);
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

// ---------------------------------------------------------------------------
// Фигуры и частицы.
// ---------------------------------------------------------------------------

/** Детерминированный ГСЧ: одно зерно — один рисунок. */
function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k: number) => 1 - Math.pow(1 - clamp01(k), 3);
const easeIn = (k: number) => Math.pow(clamp01(k), 2);
const easeInOut = (k: number) => {
  k = clamp01(k);
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
};
/** Угол в (−π, π]. */
const wrap = (a: number) => a - Math.round(a / TAU) * TAU;

/** Отрезок в пиксель толщиной. */
function line(L: Layer, x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) L.set(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c, a);
}

/** Кольцо [r0, r1) вокруг (x, y); `v` — плотность растра (1 — сплошное). */
function ring(L: Layer, x: number, y: number, r0: number, r1: number, c: RGB, a = 1, v = 1): void {
  if (r1 <= 0.5) return;
  const R = Math.ceil(r1) + 1;
  const q0 = r0 * r0;
  const q1 = r1 * r1;
  const bx = Math.floor(x);
  const by = Math.floor(y);
  for (let yy = by - R; yy <= by + R; yy++)
    for (let xx = bx - R; xx <= bx + R; xx++) {
      const dx = xx + 0.5 - x;
      const dy = yy + 0.5 - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < q0 || d2 >= q1) continue;
      if (v < 1 && !L.keep(xx, yy, v)) continue;
      L.set(xx, yy, c, a);
    }
}

/**
 * Клуб пыли — три круглых комка со светом сверху-слева и тенью снизу-справа.
 * Быстро вздувается (первая пятая жизни), потом тает — сжимается, как в
 * пиксельных играх, а не рассыпается растром. `k` — возраст 0…1, `n` —
 * номер клуба (у соседей комки лежат по-разному).
 */
function dust(
  L: Layer,
  x: number,
  y: number,
  rMax: number,
  k: number,
  n = 0,
  body: RGB = DUST,
  light: RGB = DUST_L,
  shade: RGB = DUST_D,
  alpha = 0.95,
): void {
  if (k < 0 || k >= 1) return;
  const r = rMax * (k < 0.2 ? easeOut(k / 0.2) : 1 - easeIn((k - 0.2) / 0.8));
  if (r < 0.5) return;
  const a = alpha * (1 - 0.4 * k);
  const s = (n * 2.39996) % TAU;
  const lumps: [number, number, number][] = [
    [0, 0, r],
    [Math.cos(s) * r * 0.62, Math.sin(s) * r * 0.35 + r * 0.15, r * 0.7],
    [Math.cos(s + 2.4) * r * 0.55, Math.sin(s + 2.4) * r * 0.3 + r * 0.2, r * 0.6],
  ];
  for (const [ox, oy, rr] of lumps) {
    if (rr < 0.6) continue;
    const cx = x + ox;
    const cy = y + oy;
    const R = Math.ceil(rr) + 1;
    const bx = Math.floor(cx);
    const by = Math.floor(cy);
    for (let yy = by - R; yy <= by + R; yy++)
      for (let xx = bx - R; xx <= bx + R; xx++) {
        const dx = xx + 0.5 - cx;
        const dy = yy + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        const lit = (dx + dy) / rr;
        L.set(xx, yy, rr < 1.3 ? body : lit < -0.55 ? light : lit > 0.5 ? shade : body, a);
      }
  }
}

/**
 * Полёт частицы, пиксели и секунды: по полу — скорость с торможением
 * `drag`, по высоте — подброс `vz` с тяжестью `grav` и отскоками (`bounce` —
 * доля скорости). Вернёт место на полу и высоту.
 */
function fly(
  t: number,
  vx: number,
  vy: number,
  vz: number,
  z0: number,
  drag: number,
  grav: number,
  bounce: number,
): { x: number; y: number; z: number; down: boolean } {
  const s = drag > 0 ? (1 - Math.exp(-drag * t)) / drag : t;
  let z = 0;
  let down = true;
  let v = vz;
  let h0 = z0;
  let tt = t;
  if (grav <= 0) return { x: vx * s, y: vy * s, z: z0 + vz * t, down: false };
  for (let hop = 0; hop < 3; hop++) {
    const land = (v + Math.sqrt(v * v + 2 * grav * h0)) / grav;
    if (tt < land) {
      z = h0 + v * tt - (grav * tt * tt) / 2;
      down = false;
      break;
    }
    tt -= land;
    v = (grav * land - v) * bounce;
    h0 = 0;
    if (v < 12) break;
  }
  return { x: vx * s, y: vy * s, z, down };
}

/** Искра: яркая голова и хвост по ходу полёта; остывает к концу жизни. */
function spark(
  L: Layer,
  t: number,
  life: number,
  x0: number,
  y0: number,
  vx: number,
  vy: number,
  vz: number,
  z0: number,
  grav = 300,
): void {
  if (t < 0 || t >= life) return;
  const k = t / life;
  const c = SPARK[Math.min(SPARK.length - 1, Math.floor(k * SPARK.length))];
  const tail = SPARK[Math.min(SPARK.length - 1, Math.floor(k * SPARK.length) + 1)];
  const a = fly(t, vx, vy, vz, z0, 2.2, grav, 0.35);
  const b = fly(Math.max(0, t - 0.03), vx, vy, vz, z0, 2.2, grav, 0.35);
  line(L, x0 + b.x, y0 + b.y - b.z, x0 + a.x, y0 + a.y - a.z, tail, 0.9);
  L.set(x0 + a.x, y0 + a.y - a.z, c, 1);
}

/** Звезда-блик: крест с длинными лучами (контакт металла). */
function star(L: Layer, x: number, y: number, n: number, c: RGB, diag = 0): void {
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) L.set(x + i, y + j, c);
  for (let i = 2; i <= n; i++) {
    const a = i === n ? 0.6 : 1;
    L.set(x - i, y, c, a);
    L.set(x + i, y, c, a);
    L.set(x, y - i, c, a);
    L.set(x, y + i, c, a);
  }
  for (let i = 2; i <= diag; i++) {
    L.set(x - i, y - i, c, 0.8);
    L.set(x + i, y - i, c, 0.8);
    L.set(x - i, y + i, c, 0.8);
    L.set(x + i, y + i, c, 0.8);
  }
}

/** Ключ удара по месту и направлению — метка передаёт контакту своё. */
const strikeKey = (x: number, y: number, ang = 0) =>
  `${x.toFixed(2)}|${y.toFixed(2)}|${ang.toFixed(3)}`;

/** Что метка узнала для контакта (направление взмаха, откуда летел обломок). */
const NOTE = new Map<string, number>();
function note(key: string, v: number): void {
  if (!NOTE.has(key) && NOTE.size > 96) NOTE.delete(NOTE.keys().next().value as string);
  NOTE.set(key, v);
}

/** Моб по id в вылазке, которую рисуют сейчас (на листе кадров её нет). */
const mobById = (id: number | undefined): Mob | undefined =>
  id === undefined ? undefined : paintSim()?.mobs.find((m) => m.id === id);

const seedAt = (x: number, y: number) => Math.floor(x * 1013 + y * 7919) >>> 0;

/** Сколько секунд до удара и вспышка «сейчас» в последние 0,2 с. */
function countdown(
  t: number,
  warn: number,
): { k: number; left: number; late: boolean; pulse: number } {
  const w = Math.max(0.05, warn);
  const tt = Math.min(t, w);
  const left = w - tt;
  const late = left <= 0.2;
  return { k: tt / w, left, late, pulse: late ? clamp01(1 - (0.2 - left) / 0.1) : 0 };
}

// ---------------------------------------------------------------------------
// Взмах меча `f2_sword`: конус r 2,6, раствор 2,1; урон — в конце метки.
// ---------------------------------------------------------------------------

/**
 * Куда клинок идёт по конусу: +1 — от `ang − arc/2` к `ang + arc/2`.
 * Первый взмах — по экрану сверху вниз (как рубит тело), ответный в ярости
 * (`combo`) — обратно, «с другой руки».
 */
export const sweepDir = (ang: number, combo: number) =>
  (Math.cos(ang) >= 0 ? 1 : -1) * (combo ? -1 : 1);

function comboOf(st: Strike): number {
  const v = (st as Strike & { vc?: number }).vc;
  if (v !== undefined) return v;
  return mobById(st.from)?.data.combo ?? 0;
}

registerZonePainter('f2_sword', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const { k, late, pulse } = countdown(st.t, st.warn);
  const R = st.r * S;
  const a = st.ang ?? 0;
  const h = (st.arc ?? 2.1) / 2;
  const dir = sweepDir(a, comboOf(st));
  note(strikeKey(st.x, st.y, a), dir);
  const a0 = a - dir * h;
  const L = layerBox(...arcBox(a - h, a + h, 0, R, 3));
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ch = Math.cos(h);
  // «Когда»: жар идёт от ног к кромке и доходит до неё к последним 0,2 с;
  // сталь бежит по кромке от края, откуда пойдёт клинок.
  const kf = easeInOut(Math.min(st.t, st.warn) / Math.max(0.05, st.warn - 0.2));
  const rf = 4 + (R - 4) * kf;
  const run = 2 * h * kf;
  const base = 0.08 + 0.1 * k + 0.015 * Math.sin(time * 7) + (late ? 0.1 : 0) + 0.22 * pulse;
  // Лучи-предвестники бегут по конусу в сторону взмаха — всё быстрее.
  const stripe = (time * (0.7 + 2.6 * k)) % 1;
  const Ri = Math.ceil(R);
  for (let y = Math.max(-Ri, L.y0); y < Math.min(Ri, L.y1); y++)
    for (let x = Math.max(-Ri, L.x0); x < Math.min(Ri, L.x1); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d2 = cx * cx + cy * cy;
      if (d2 >= R * R || d2 < 16) continue;
      const d = Math.sqrt(d2);
      if (cx * ca + cy * sa < d * ch) continue;
      let c = RED;
      let al = base + (d < rf ? 0.07 : 0);
      if (!late && d >= rf - 1 && d < rf) {
        c = HOT;
        al = 0.3 + 0.35 * k;
      }
      if (d >= R - 3) {
        const rel = dir * wrap(Math.atan2(cy, cx) - a0);
        if (d >= R - 1) {
          c = RED_D;
          al = 0.8;
        }
        if (d >= R - 2 && rel <= run) {
          c = late ? SPEC : EDGE;
          al = late ? 1 : 0.55 + 0.35 * k;
        } else if (late && d < R - 2) {
          c = WHITE;
          al = 0.5 + 0.45 * pulse;
        }
      } else if (!late && d > R * 0.42) {
        const rel = dir * wrap(Math.atan2(cy, cx) - a0);
        const ph = (rel / (2 * h) - stripe + 2) % (1 / 3);
        if (ph < 0.028) {
          c = HOT;
          al = Math.max(al, 0.12 + 0.2 * k);
        }
      }
      L.set(x, y, c, al);
    }
  // Край, откуда пойдёт клинок, — сталью; куда — тускло.
  const edge = (ang: number, c: RGB, al: number) =>
    line(
      L,
      Math.cos(ang) * 5,
      Math.sin(ang) * 5,
      Math.cos(ang) * (R - 1),
      Math.sin(ang) * (R - 1),
      c,
      al,
    );
  edge(a + dir * h, RED_D, 0.65);
  edge(a0, late ? SPEC : EDGE, late ? 1 : 0.45 + 0.45 * k);
  // Остриё — белый блик на бегущем конце; по пройденному пути бежит отблеск.
  if (run > 0.02) {
    const tip = a0 + dir * run;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ])
      L.set(Math.cos(tip) * (R - 1.5) - 1 + dx, Math.sin(tip) * (R - 1.5) - 1 + dy, WHITE);
    const gl = (time * 2.2) % 1;
    const ga = a0 + dir * run * gl;
    L.set(Math.cos(ga) * (R - 1.5), Math.sin(ga) * (R - 1.5), WHITE, 1 - gl);
  }
  L.blit(g, px, py);
  return true;
});

/** Сколько клинок проходит после края конуса — проводка с перелётом, рад. */
const OVER = 0.38;
/** Сколько идёт сам взмах, с (две смены кадра на 24 к/с). */
const SWEEP_T = 0.11;

registerImpactPainter('f2_sword', {
  life: 0.46,
  shake: 0.25,
  above: true,
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 2.6) * S;
    const a = rec.ang ?? 0;
    const h = (rec.arc ?? 2.1) / 2;
    const vc = (rec as ImpactRec & { vc?: number }).vc;
    const dir =
      vc !== undefined ? sweepDir(a, vc) : (NOTE.get(strikeKey(rec.x, rec.y, a)) ?? sweepDir(a, 0));
    const a0 = a - dir * h;
    const span = 2 * h + OVER;
    const aLo = Math.min(a0, a0 + dir * span) - 0.15;
    const aHi = Math.max(a0, a0 + dir * span) + 0.15;
    const L = layerBox(...arcBox(aLo, aHi, R * 0.25, R * 1.2 + 10, 20));
    // Взмах — три кадра на 24 к/с: половина, почти всё, перелёт за край.
    const sw = clamp01(age / SWEEP_T);
    const sp = 1 - (1 - sw) * (1 - sw);
    const lead = span * sp;
    const after = Math.max(0, age - SWEEP_T);
    const fade = clamp01(1 - after / 0.22);
    const thin = easeOut(after / 0.16);
    const tail = Math.min(lead, 1.3) * (0.35 + 0.65 * fade);
    const Ro = R * 1.04 - thin * 2;
    const Tm = R * 0.46 * (1 - thin) + 2 * thin;
    const Rmax = Math.ceil(R * 1.1);
    const flash = age < 0.06 ? 1 - age / 0.06 : 0;
    for (let y = Math.max(-Rmax, L.y0); y < Math.min(Rmax, L.y1); y++)
      for (let x = Math.max(-Rmax, L.x0); x < Math.min(Rmax, L.x1); x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        const d = Math.sqrt(cx * cx + cy * cy);
        if (d < R * 0.3 || d >= Ro) continue;
        const rel = dir * wrap(Math.atan2(cy, cx) - a0);
        // Кадр удара: весь конус вспыхивает на миг.
        if (flash > 0 && rel >= 0 && rel <= 2 * h && d < R) L.set(x, y, WHITE, 0.38 * flash);
        if (fade <= 0) continue;
        // Серп волны: толстый у кромки клинка, сходит на нет к хвосту.
        const u = (rel - (lead - tail)) / tail;
        if (u < 0 || u > 1) continue;
        // Толще всего у носа, нос скруглён, к хвосту сходит на нет.
        const prof = u < 0.82 ? Math.pow(u / 0.82, 0.65) : Math.sqrt(1 - ((u - 0.82) / 0.18) ** 2);
        const th = Tm * (0.1 + 0.9 * prof);
        const rin = Ro - th;
        if (d < rin) continue;
        const rr = (d - rin) / th;
        if (u < 0.3 && !L.keep(x, y, u / 0.3)) continue;
        const v = clamp01(u * 0.72 + rr * 0.38);
        let lv = v * (WAVE.length - 1);
        const i0 = Math.floor(lv);
        lv -= i0;
        const ci = Math.min(WAVE.length - 1, i0 + (L.keep(x, y, lv) ? 1 : 0));
        const outer = d >= Ro - 1 && u > 0.3;
        L.set(x, y, outer ? WHITE : WAVE[ci], (0.6 + 0.4 * v) * Math.max(0.35, fade));
      }
    // Разрезанный воздух: две штриховые дуги отходят от серпа и рвутся.
    if (age > 0.04) {
      const k = clamp01((age - 0.04) / 0.32);
      for (const [rr, a1, sh, c] of [
        [1.15, 0.9, 0, SPEC],
        [0.46, 0.7, 3, EDGE],
      ] as const) {
        const r = R * rr + (rr > 1 ? 8 : -4) * easeOut(k);
        if (a1 * (1 - k) <= 0.05) continue;
        const n = Math.ceil(r * lead);
        for (let i = 0; i < n; i++) {
          if ((i + sh) % 9 > 5 - Math.floor(k * 4)) continue;
          const ang = a0 + (dir * (i + 0.5)) / r;
          L.set(Math.cos(ang) * r, Math.sin(ang) * r, c, a1 * (1 - k));
        }
      }
    }
    // Веер искр с кромки: рождаются там, где проходит остриё, летят вперёд
    // по ходу взмаха и наружу, падают и гаснут.
    const r = rnd(rec.seed);
    for (let i = 0; i < 18; i++) {
      const f = 0.2 + 0.8 * (i / 18);
      const tb = SWEEP_T * f;
      const ang = a0 + dir * span * (1 - (1 - f) * (1 - f)) + (r() - 0.5) * 0.08;
      const rr = R * (0.86 + 0.18 * r());
      const tang = ang + (dir * Math.PI) / 2;
      const v = 80 + 90 * r();
      const out = 25 + 45 * r();
      spark(
        L,
        age - tb,
        0.16 + 0.22 * r(),
        Math.cos(ang) * rr,
        Math.sin(ang) * rr,
        Math.cos(tang) * v + Math.cos(ang) * out,
        Math.sin(tang) * v + Math.sin(ang) * out,
        30 + 60 * r(),
        6 + 10 * r(),
      );
    }
    L.blit(g, px, py);
    return true;
  },
});

/** Ветер клинка по полу (зона мозга в миг удара): пыль по дуге, вперёд по ходу. */
registerZonePainter('f2v_swdust', (g, z, px, py, S) => {
  const zz = z as Zone & { va?: number; vc?: number; vr?: number };
  const t = zz.t;
  const R = (zz.vr ?? 2.6) * S;
  const a = zz.va ?? 0;
  const h = 1.05;
  const dir = sweepDir(a, zz.vc ?? 0);
  const a0 = a - dir * h;
  const span = 2 * h + OVER;
  const L = layerBox(
    ...arcBox(Math.min(a0, a0 + dir * span), Math.max(a0, a0 + dir * span), R * 0.6, R * 1.05, 18),
  );
  const r = rnd(seedAt(zz.x, zz.y) ^ Math.floor(a * 1000));
  for (let i = 0; i < 8; i++) {
    const f = 0.15 + 0.85 * (i / 7);
    const tb = SWEEP_T * f;
    const ang = a0 + dir * (2 * h + OVER) * (1 - (1 - f) * (1 - f)) + (r() - 0.5) * 0.12;
    const rr = R * (0.72 + 0.3 * r());
    const tang = ang + (dir * Math.PI) / 2;
    const v = 22 + 22 * r();
    const tt = t - tb;
    const life = 0.4 + 0.25 * r();
    if (tt < 0 || tt > life) continue;
    const m = fly(
      tt,
      Math.cos(tang) * v + Math.cos(ang) * 10,
      Math.sin(tang) * v + Math.sin(ang) * 6,
      0,
      0,
      3.2,
      0,
      0,
    );
    const k = tt / life;
    const x = Math.cos(ang) * rr + m.x;
    dust(L, x, Math.sin(ang) * rr + m.y - 5 * easeOut(k), 3.4, k, i, DUST, DUST_L, DUST_D, 0.75);
  }
  L.blit(g, px, py);
  return true;
});

// ---------------------------------------------------------------------------
// Выпад `f2_thrust`: линия r 3,9, полуширина 0,5; мозг целится 0,32 с
// (метку прицела рисует движок), потом метка 0,4 с — и удар, за ним рывок.
// ---------------------------------------------------------------------------

registerZonePainter('f2_thrust', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const { k, late, pulse } = countdown(st.t, st.warn);
  const t = Math.min(st.t, st.warn);
  const Ln = st.r * S;
  const hw = (st.w ?? 0.5) * S;
  const a = st.ang ?? 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const L = layerBox(...laneBox(0, Ln + 8, hw + 2, a, 3));
  // Захват цели: дорожка вспыхивает в первые кадры — направление заперто;
  // кромки дотягиваются до конца за 0,06 с.
  const lock = clamp01(1 - t / 0.09);
  const reach = 6 + (Ln - 6) * easeOut(t / 0.06);
  const base = 0.08 + 0.11 * k + 0.24 * lock + (late ? 0.1 : 0) + 0.2 * pulse;
  // Шевроны бегут от лат к острию — всё быстрее; в конце сливаются в жилу.
  const gap = 11;
  const off = (time * (50 + 230 * k * k)) % gap;
  for (let y = L.y0; y < L.y1; y++)
    for (let x = L.x0; x < L.x1; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const al = cx * ca + cy * sa;
      const ac = -cx * sa + cy * ca;
      if (al < 6 || al >= reach || Math.abs(ac) >= hw) continue;
      let c = RED;
      let aa = base;
      if (Math.abs(ac) >= hw - 1) {
        c = late ? SPEC : lock > 0 ? WHITE : RED_D;
        aa = late || lock > 0 ? 0.95 : 0.85;
      } else if (late && Math.abs(ac) < 1) {
        c = WHITE;
        aa = 0.6 + 0.35 * pulse;
      } else if (Math.abs(ac) < 3.5 && al > 12 && al < reach - 4) {
        const ph = (((al + Math.abs(ac) * 1.1 - off) % gap) + gap) % gap;
        if (ph < 1) {
          c = late ? WHITE : HOT;
          aa = late ? 0.8 : 0.3 + 0.5 * k;
        }
      }
      L.set(x, y, c, aa);
    }
  // Конец удара — поперечная планка и ромб; наливаются к удару.
  if (reach >= Ln - 1) {
    const c = late ? SPEC : HOT;
    const al = 0.5 + 0.5 * k;
    line(
      L,
      Ln * ca + (hw + 1) * sa,
      Ln * sa - (hw + 1) * ca,
      Ln * ca - (hw + 1) * sa,
      Ln * sa + (hw + 1) * ca,
      c,
      al,
    );
    const tx = (Ln + 4) * ca;
    const ty = (Ln + 4) * sa;
    for (const [dx, dy] of [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      L.set(tx + dx, ty + dy, c, al);
  }
  L.blit(g, px, py);
  return true;
});

/** Высота клинка над полом при выпаде, пиксели: жила идёт на уровне меча. */
const THRUST_Z = 11;

registerImpactPainter('f2_thrust', {
  life: 0.42,
  shake: 0.2,
  above: true,
  paint(g, rec, px, py, S, age) {
    const Ln = (rec.r ?? 3.9) * S;
    const hw = (rec.w ?? 0.5) * S;
    const a = rec.ang ?? 0;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const Z = THRUST_Z;
    const L = layerBox(...laneBox(-4, Ln + 18, hw + 26, a, 12, -Z));
    // Прокол: жила выстреливает до конца за две смены кадра, потом хвост
    // догоняет остриё — удар «уходит» вперёд и тает.
    const front = 6 + (Ln - 6) * easeOut(age / 0.05);
    const tail = 6 + (Ln - 12) * easeIn((age - 0.05) / 0.22);
    const fade = clamp01(1 - (age - 0.05) / 0.26);
    const glow = age < 0.1 ? 1 - age / 0.1 : 0;
    if (front - tail > 1 && fade > 0)
      for (let y = L.y0 + Z; y < L.y1 + Z; y++)
        for (let x = L.x0; x < L.x1; x++) {
          const cx = x + 0.5;
          const cy = y + 0.5;
          const al = cx * ca + cy * sa;
          if (al < tail || al >= front) continue;
          const ac = Math.abs(-cx * sa + cy * ca);
          // Остриё — клином: к концу жила сужается; к хвосту — тоже.
          const nose = clamp01((front - al) / 7);
          const back = clamp01((al - tail) / 10);
          const w = (0.8 + 1.6 * fade) * (0.35 + 0.65 * Math.min(nose, 0.5 + back));
          if (ac < w * 0.5) L.set(x, y - Z, WHITE, 1);
          else if (ac < w * 1.25) L.set(x, y - Z, EDGE, 0.95 * Math.max(0.4, fade));
          else if (ac < w * 1.25 + 1) L.set(x, y - Z, WAVE[1], 0.7 * fade);
          else if (glow > 0 && ac < hw) L.set(x, y - Z, SPEC, 0.3 * glow * (1 - ac / hw));
        }
    // Остриё: звезда на бегущем конце, у цели — кольцо и звезда крупнее.
    const tx = front * ca;
    const ty = front * sa - Z;
    if (age < 0.16)
      star(L, tx, ty, age < 0.05 ? 4 : 7 - Math.floor(age * 30), WHITE, age > 0.04 ? 3 : 0);
    if (age > 0.04 && age < 0.28) {
      const k = (age - 0.04) / 0.24;
      const rr = 3 + 12 * easeOut(k);
      ring(L, tx, ty, rr - 1, rr, SPEC, 0.9 * (1 - k), 1 - k * 0.6);
    }
    // Спутный след: две штриховые линии расходятся от жилы.
    if (age > 0.03) {
      const k = clamp01((age - 0.03) / 0.32);
      const offc = 4 + 18 * easeOut(k);
      for (let s = Ln * 0.18; s < Ln * 0.96; s += 1) {
        if ((Math.floor(s) + Math.floor(age * 90)) % 8 > 4 - Math.floor(k * 3)) continue;
        for (const side of [-1, 1])
          L.set(s * ca - side * offc * sa, s * sa + side * offc * ca - Z, SPEC, 0.6 * (1 - k));
      }
    }
    // Штрихи скорости: летят вдоль жилы быстрее самого удара.
    const r = rnd(rec.seed);
    for (let i = 0; i < 7; i++) {
      const c = (r() - 0.5) * hw * 2.4;
      const t0 = r() * 0.08;
      const k = (age - t0) / 0.14;
      if (k < 0 || k > 1) continue;
      const s0 = Ln * (0.1 + 0.95 * easeOut(k)) - 10;
      line(
        L,
        s0 * ca - c * sa,
        s0 * sa + c * ca - Z,
        (s0 + 10) * ca - c * sa,
        (s0 + 10) * sa + c * ca - Z,
        WHITE,
        0.85 * (1 - k),
      );
    }
    // Искры с острия: вперёд веером и вниз, на пол.
    for (let i = 0; i < 10; i++) {
      const sp = (r() - 0.5) * 1.7;
      const v = 60 + 90 * r();
      spark(
        L,
        age - 0.045,
        0.16 + 0.2 * r(),
        Ln * ca,
        Ln * sa,
        Math.cos(a + sp) * v,
        Math.sin(a + sp) * v,
        10 + 40 * r(),
        Z,
      );
    }
    L.blit(g, px, py);
    return true;
  },
});

/** След рывка (зона мозга с начала рывка): пыль по пути, камешки из-под ног. */
const lungeLen = new WeakMap<object, number>();
registerZonePainter('f2v_lunge', (g, z, px, py, S) => {
  const zz = z as Zone & { va?: number; vm?: number };
  const a = zz.va ?? 0;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // Путь — до того места, где латы сейчас (или где встали).
  let len = lungeLen.get(zz) ?? 2.2;
  const m = mobById(zz.vm);
  if (m && m.mode === 'lunge') {
    len = Math.hypot(m.x - zz.x, m.y - zz.y);
    lungeLen.set(zz, len);
  }
  const D = len * S;
  const V = 11 * S;
  const L = layerBox(...laneBox(0, D + 6, 16, a, 8, -10));
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x51);
  for (let s = 2; s < D; s += 5) {
    const side = r() < 0.5 ? -1 : 1;
    const tt = zz.t - s / V;
    const life = 0.45 + 0.3 * r();
    if (tt < 0 || tt > life) continue;
    const k = tt / life;
    const drift = (4 + 8 * r()) * easeOut(k) * side;
    dust(
      L,
      s * ca - drift * sa - ca * 5 * easeOut(k),
      s * sa + drift * ca - 4 * easeOut(k),
      3.8,
      k,
      s,
    );
  }
  // Камешки из-под сабатонов — подлетают и падают на пол.
  for (let i = 0; i < 12; i++) {
    const s = D * r();
    const side = r() < 0.5 ? -1 : 1;
    const v = 20 + 30 * r();
    const c = CHIPS[Math.floor(r() * 3)];
    const vz = 30 + 40 * r();
    const tt = zz.t - s / V;
    if (tt < 0 || tt > 0.75) continue;
    const f = fly(tt, -ca * 25 - side * sa * v, -sa * 25 + side * ca * v, vz, 2, 3, 320, 0.3);
    if (f.z > 1) L.set(s * ca + f.x, s * sa + f.y, INK, 0.3);
    L.set(s * ca + f.x, s * sa + f.y - f.z, c, tt > 0.55 ? 1 - (tt - 0.55) / 0.2 : 1);
  }
  L.blit(g, px, py);
  return true;
});

/** Выпад о стену (зона мозга): искры рикошетом, звезда, кольцо звона, пыль. */
registerZonePainter('f2v_bonk', (g, z, px, py) => {
  const zz = z as Zone & { va?: number };
  const t = zz.t;
  const a = (zz.va ?? 0) + Math.PI;
  const L = layer(48);
  const H = 6;
  if (t < 0.12) star(L, 0, -H, t < 0.05 ? 7 : 5, WHITE, t < 0.05 ? 3 : 0);
  if (t < 0.26) {
    const k = t / 0.26;
    const rr = 3 + 15 * easeOut(k);
    ring(L, 0, -H, rr - 1, rr, SPEC, 0.85 * (1 - k), 1 - 0.5 * k);
  }
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x9);
  for (let i = 0; i < 16; i++) {
    const sp = (r() - 0.5) * 2.4;
    const v = 60 + 100 * r();
    spark(
      L,
      t,
      0.2 + 0.25 * r(),
      0,
      -H,
      Math.cos(a + sp) * v,
      Math.sin(a + sp) * v,
      30 + 60 * r(),
      6,
    );
  }
  for (let i = 0; i < 6; i++) {
    const ang = a + (r() - 0.5) * 2.2;
    const k = clamp01(t / (0.45 + 0.2 * r()));
    if (k >= 1) continue;
    const e = easeOut(k);
    dust(L, Math.cos(ang) * (3 + 11 * e), Math.sin(ang) * 7 * e - 3 * e, 4, k, i);
  }
  L.blit(g, px, py);
  return true;
});

// ---------------------------------------------------------------------------
// Прыжок `f2_leap`: круг r 1,75 там, куда рухнут латы; полёт 0,72 с.
// ---------------------------------------------------------------------------

/** Трещины в плитах от удара: ломаные от центра с ветками — одни на место. */
interface Crack {
  pts: [number, number][];
  /** С какой доли радиуса трещина начинается (ветка — позже). */
  at: number;
}
const CRACKS = new Map<string, Crack[]>();
function cracksOf(seed: number, R: number, n: number): Crack[] {
  const key = `${seed}|${R.toFixed(1)}|${n}`;
  const hit = CRACKS.get(key);
  if (hit) return hit;
  const r = rnd(seed);
  const out: Crack[] = [];
  const walk = (x: number, y: number, ang: number, len: number, at: number, depth: number) => {
    const pts: [number, number][] = [[x, y]];
    let d = 0;
    while (d < len) {
      const st = 2.5 + r() * 2.5;
      ang += (r() - 0.5) * 0.7;
      x += Math.cos(ang) * st;
      y += Math.sin(ang) * st;
      d += st;
      pts.push([x, y]);
      if (depth < 1 && d > len * 0.3 && r() < 0.2)
        walk(
          x,
          y,
          ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5),
          (len - d) * 0.6,
          at + d / R,
          depth + 1,
        );
    }
    out.push({ pts, at });
  };
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU + (r() - 0.5) * 0.6;
    const r0 = R * 0.2;
    walk(Math.cos(ang) * r0, Math.sin(ang) * r0, ang, R * (0.55 + 0.6 * r()), 0.2, 0);
  }
  if (CRACKS.size > 24) CRACKS.delete(CRACKS.keys().next().value as string);
  CRACKS.set(key, out);
  return out;
}

/**
 * Трещины, выросшие на долю `grow` от центра. `fresh` — только что
 * лопнули и светятся пылью; `v` — сколько их осталось (растворение).
 */
function drawCracks(L: Layer, cr: Crack[], R: number, grow: number, fresh: boolean, v = 1): void {
  for (const k of cr) {
    let d = k.at * R;
    for (let i = 1; i < k.pts.length; i++) {
      const [x0, y0] = k.pts[i - 1];
      const [x1, y1] = k.pts[i];
      const l = Math.hypot(x1 - x0, y1 - y0);
      if (d > grow * R * 1.25) break;
      const f = Math.min(1, (grow * R * 1.25 - d) / l);
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * f));
      for (let j = 0; j <= n; j++) {
        const x = x0 + ((x1 - x0) * f * j) / n;
        const y = y0 + ((y1 - y0) * f * j) / n;
        if (v < 1 && !L.keep(x, y, v)) continue;
        if (fresh) L.set(x, y, PALE, 1);
        else {
          // Край трещины на свету (снизу-справа) и сама щель.
          L.under(x + 1, y + 1, DUST_L, 0.85);
          L.set(x, y, INK, 1);
        }
      }
      d += l;
    }
  }
}

registerZonePainter('f2_leap', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const { k, left, late, pulse } = countdown(st.t, st.warn);
  const R = st.r * S;
  const L = layer(R * 2 + 6);
  // «Куда» — круг сразу; «когда» — второе кольцо падает на него с разгоном,
  // как сами латы: встретились — удар.
  const rc = R * (1 + 0.95 * (1 - easeIn(k)));
  const base = 0.07 + 0.12 * k + (late ? 0.1 : 0) + 0.2 * pulse;
  const spin = late ? 0 : time * 0.9;
  const B = Math.ceil(rc + 3);
  for (let y = -B; y < B; y++)
    for (let x = -B; x < B; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d < R) {
        let c = RED;
        let al = base + (d < R * 0.42 ? 0.06 + 0.1 * k : 0);
        if (d >= R - 1) {
          c = late ? SPEC : HOT;
          al = late ? 1 : 0.5 + 0.35 * k;
        } else if (late && d >= R - 2) {
          c = WHITE;
          al = 0.5 + 0.45 * pulse;
        } else if (d >= R - 5 && d < R - 1.5) {
          // Засечки прицела: восемь штрихов у кромки, медленно кружат.
          const ang = Math.atan2(cy, cx) - spin;
          const ph = ((((ang / TAU) * 8) % 1) + 1) % 1;
          if (ph < 0.06 || ph > 0.94) {
            c = late ? WHITE : HOT;
            al = 0.55 + 0.4 * k;
          }
        }
        L.set(x, y, c, al);
      } else if (rc > R + 1.5 && d >= rc - 1 && d < rc) L.set(x, y, HOT, 0.35 + 0.55 * k);
      else if (rc > R + 1.5 && d >= rc + 1 && d < rc + 2) L.set(x, y, HOT, 0.15 + 0.2 * k);
    }
  // Плиты дрожат: в последние 0,3 с по кругу подскакивает крошка.
  if (left < 0.3) {
    const q = 1 - left / 0.3;
    const r = rnd(seedAt(st.x, st.y));
    for (let i = 0; i < 18; i++) {
      const ang = r() * TAU;
      const rr = R * Math.sqrt(r()) * 0.9;
      const hop = Math.abs(Math.sin(time * (26 + r() * 10) + i)) * 2.4 * q;
      L.set(Math.cos(ang) * rr, Math.sin(ang) * rr - Math.round(hop), CHIPS[i % 3], 1);
    }
    // Трещины заранее — в кеш, чтобы кадр удара не считал их с нуля.
    cracksOf(seedAt(st.x, st.y), R, 7);
  }
  L.blit(g, px, py);
  return true;
});

registerImpactPainter('f2_leap', {
  life: 1.45,
  shake: 0.35,
  flash: 0.25,
  flashRgb: '255,236,214',
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 1.75) * S;
    const seed = seedAt(rec.x, rec.y) || rec.seed;
    const L = layer(R * 1.9 + 12);
    const cr = cracksOf(seed, R, 7);
    // Трещины бегут от центра за 0,07 с; в миг удара светятся пылью.
    const grow = easeOut(age / 0.07);
    const gone = age > 1.0 ? 1 - (age - 1.0) / 0.45 : 1;
    // Вмятина: тёмная чаша, верхне-левый край в тени, нижне-правый на свету.
    const cr0 = Math.max(4, R * 0.26);
    if (gone > 0) {
      const B = Math.ceil(cr0 + 2);
      for (let y = -B; y < B; y++)
        for (let x = -B; x < B; x++) {
          const cx = x + 0.5;
          const cy = y + 0.5;
          const d = Math.sqrt(cx * cx + cy * cy);
          if (d >= cr0 + 1 || !L.keep(x, y, gone)) continue;
          const lit = (cx + cy) / Math.max(1, d);
          if (d >= cr0) {
            if (lit < -0.3) L.set(x, y, INK, 0.9);
          } else if (d >= cr0 - 1.2 && lit > 0.35) L.set(x, y, DUST_L, 1);
          else L.set(x, y, d < cr0 * 0.6 ? INK : DUST_D, age < 0.08 ? 0.5 : 0.85);
        }
      drawCracks(L, cr, R, grow, age < 0.09, gone);
      // Выбитые сколы у края вмятины.
      const rc = rnd(seed ^ 0x55);
      for (let i = 0; i < 10; i++) {
        const ang = rc() * TAU;
        const rr = cr0 + 1 + rc() * 4;
        const x = Math.cos(ang) * rr;
        const y = Math.sin(ang) * rr;
        if (L.keep(x, y, gone)) L.set(x, y, CHIPS[i % 2], 1);
      }
    }
    // Ударная волна по полу: светлая взвесь уходит кольцом и гаснет.
    const w1 = clamp01(age / 0.32);
    if (w1 < 1) {
      const rr = R * (0.3 + 1.35 * easeOut(w1));
      ring(L, 0, 0, rr - 2, rr, PALE, 0.9, 1 - w1);
      ring(L, 0, 0, rr * 0.7 - 1, rr * 0.7, PALE, 0.7, 0.6 * (1 - w1));
    }
    // Кольцо пыли: клубы разлетаются, тормозят, растут, поднимаются и оседают.
    const r = rnd(seed ^ 0xabc);
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * TAU + (r() - 0.5) * 0.35;
      const v = 75 + 55 * r();
      const life = 0.65 + 0.45 * r();
      const tt = age - 0.015 * r();
      if (tt < 0 || tt > life) continue;
      const k = tt / life;
      const f = fly(tt, Math.cos(ang) * v, Math.sin(ang) * v * 0.8, 0, 0, 4.2, 0, 0);
      const r0 = R * 0.4;
      const y = Math.sin(ang) * r0 + f.y - 9 * easeOut(k);
      dust(L, Math.cos(ang) * r0 + f.x, y, 4 + 1.6 * r(), k, i, DUST, DUST_L, DUST_D, 0.72);
    }
    // Осколки плит: подлетают, падают с отскоком, лежат и тают.
    for (let i = 0; i < 16; i++) {
      const ang = r() * TAU;
      const v = 35 + 65 * r();
      const vz = 55 + 85 * r();
      const f = fly(age, Math.cos(ang) * v, Math.sin(ang) * v * 0.8, vz, 3, 1.6, 330, 0.35);
      const x = Math.cos(ang) * R * 0.3 + f.x;
      const y = Math.sin(ang) * R * 0.3 + f.y;
      if (!L.keep(x, y, gone)) continue;
      if (f.z > 1) L.set(x, y, INK, 0.35);
      L.set(x, y - f.z, CHIPS[i % 3], 1);
      if (i % 4 === 0) L.set(x + 1, y - f.z, CHIPS[(i + 1) % 3], 1);
    }
    L.blit(g, px, py);
    return true;
  },
});

/** Толчок перед прыжком (зона мозга): пыль из-под ног кольцом. */
registerZonePainter('f2v_takeoff', (g, z, px, py) => {
  const zz = z as Zone;
  const L = layer(40);
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x77);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU + r() * 0.4;
    const life = 0.45 + 0.25 * r();
    const k = zz.t / life;
    if (k > 1) continue;
    const f = fly(zz.t, Math.cos(ang) * 55, Math.sin(ang) * 38, 0, 0, 5, 0, 0);
    dust(L, Math.cos(ang) * 5 + f.x, Math.sin(ang) * 3 + f.y - 4 * easeOut(k), 4.4, k, i);
  }
  L.blit(g, px, py);
  return true;
});

// ---------------------------------------------------------------------------
// Обломки лат `f2_shard`: круг r 0,6, где упадёт обломок; метка — время
// полёта.
// ---------------------------------------------------------------------------

registerZonePainter('f2_shard', (g, z, px, py, S, time) => {
  const st = z as Strike;
  const { k, late } = countdown(st.t, st.warn);
  const R = st.r * S;
  // Откуда летит обломок — запомнить для искр контакта.
  const key = strikeKey(st.x, st.y);
  if (!NOTE.has(key)) {
    const pl = paintSim()?.mobs.find(
      (m) =>
        m.kind === F2_PLATE &&
        m.mode === 'fly' &&
        Math.abs((m.data.tx ?? 0) - st.x) < 0.01 &&
        Math.abs((m.data.ty ?? 0) - st.y) < 0.01,
    );
    if (pl) note(key, Math.atan2(st.y - pl.y, st.x - pl.x));
  }
  const L = layer(R * 2.6 + 6);
  const rc = R * (1 + 1.5 * (1 - easeIn(k)));
  const spin = late ? Math.PI / 4 : Math.PI / 4 + time * 1.4;
  const B = Math.ceil(Math.max(rc, R + 4) + 2);
  for (let y = -B; y < B; y++)
    for (let x = -B; x < B; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d < R - 1) L.set(x, y, RED, 0.1 + 0.18 * k + (late ? 0.12 : 0));
      else if (d < R) L.set(x, y, late ? SPEC : HOT, late ? 1 : 0.55 + 0.35 * k);
      else if (rc > R + 1 && d >= rc - 1 && d < rc) L.set(x, y, HOT, 0.3 + 0.6 * k);
    }
  // Прицел: четыре засечки снаружи, чуть кружат.
  for (let i = 0; i < 4; i++) {
    const ang = spin + (i * Math.PI) / 2;
    line(
      L,
      Math.cos(ang) * (R + 1),
      Math.sin(ang) * (R + 1),
      Math.cos(ang) * (R + 3),
      Math.sin(ang) * (R + 3),
      late ? WHITE : HOT,
      0.6 + 0.4 * k,
    );
  }
  // Тень падающего обломка темнеет и растёт к удару.
  ring(L, 0, 1, 0, 1 + 3 * easeIn(k), INK, 0.2 + 0.4 * k);
  L.blit(g, px, py);
  return true;
});

registerImpactPainter('f2_shard', {
  life: 1.1,
  shake: 0.09,
  paint(g, rec, px, py, _S, age) {
    const L = layer(40);
    const from = NOTE.get(strikeKey(rec.x, rec.y)) ?? (rec.seed % 628) / 100;
    const r = rnd(rec.seed);
    // Вмятина с короткими трещинами — обломок ляжет в неё.
    const gone = age > 0.8 ? 1 - (age - 0.8) / 0.3 : 1;
    if (gone > 0) {
      for (let y = -5; y < 5; y++)
        for (let x = -5; x < 5; x++) {
          const cx = x + 0.5;
          const cy = y + 0.5;
          const d = Math.sqrt(cx * cx + cy * cy);
          if (d >= 4.2 || !L.keep(x, y, gone)) continue;
          const lit = (cx + cy) / Math.max(1, d);
          if (d >= 3.2 && lit > 0.3) L.set(x, y, DUST_L, 1);
          else L.set(x, y, d < 2.4 ? INK : DUST_D, 0.85);
        }
      for (let i = 0; i < 4; i++) {
        const ang = from + (i - 1.5) * 1.3 + (r() - 0.5) * 0.5;
        const l = (4 + r() * 5) * easeOut(age / 0.05);
        for (let s = 4; s < 4 + l; s++) {
          const x = Math.cos(ang) * s;
          const y = Math.sin(ang) * s;
          if (!L.keep(x, y, gone)) continue;
          L.under(x + 1, y + 1, DUST_L, 0.8);
          L.set(x, y, INK, 1);
        }
      }
    }
    // Звон — два тонких кольца, второе с запозданием.
    for (const [d, max, al] of [
      [0, 18, 0.95],
      [0.06, 12, 0.6],
    ] as const) {
      const k = (age - d) / 0.2;
      if (k < 0 || k > 1) continue;
      const rr = 3 + (max - 3) * easeOut(k);
      ring(L, 0, -1, rr - 1, rr, SPEC, al, 1 - 0.6 * k);
    }
    if (age < 0.1) star(L, 0, -4, age < 0.04 ? 6 : 4, WHITE, age < 0.04 ? 2 : 0);
    // Искры: веером по ходу полёта и вверх.
    for (let i = 0; i < 12; i++) {
      const ang = from + (r() - 0.5) * 2.2;
      const v = 40 + 85 * r();
      spark(
        L,
        age,
        0.18 + 0.24 * r(),
        0,
        -2,
        Math.cos(ang) * v,
        Math.sin(ang) * v * 0.8,
        30 + 70 * r(),
        3,
      );
    }
    // Каменная крошка.
    for (let i = 0; i < 7; i++) {
      const ang = r() * TAU;
      const v = 20 + 30 * r();
      const f = fly(age, Math.cos(ang) * v, Math.sin(ang) * v, 30 + 45 * r(), 1, 2, 320, 0.3);
      if (!L.keep(f.x, f.y, gone)) continue;
      L.set(f.x, f.y - f.z, CHIPS[i % 3], 1);
    }
    L.blit(g, px, py);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Зоны мозга: шаги, капли роя, рёв, взрыв лат, сборка.
// ---------------------------------------------------------------------------

/** Шаг лат (зона мозга): пыль из-под сабатона, пара камешков. */
registerZonePainter('f2v_step', (g, z, px, py) => {
  const zz = z as Zone & { va?: number };
  const k = zz.t / 0.5;
  if (k > 1) return true;
  const a = zz.va ?? 0;
  const L = layer(16);
  // Пыль отбрасывает назад, против хода.
  const bx = -Math.cos(a);
  const by = -Math.sin(a);
  const e = easeOut(k);
  dust(L, bx * 3 * e - 2, by * 2 * e - 2 * e, 3.4, k, 1);
  dust(L, bx * 5 * e + 2, by * 3 * e - 3 * e, 2.6, k * 1.15, 2);
  const r = rnd(seedAt(zz.x, zz.y));
  for (let i = 0; i < 2; i++) {
    const f = fly(zz.t, bx * 20 + (r() - 0.5) * 20, by * 14, 25 + 20 * r(), 1, 3, 320, 0.3);
    L.set(f.x, f.y - f.z, CHIPS[i], 1 - k);
  }
  L.blit(g, px, py);
  return true;
});

/** Капля роя из треснувших лат (зона мозга): падает, растекается, темнеет. */
registerZonePainter('f2v_drip', (g, z, px, py) => {
  const zz = z as Zone;
  const t = zz.t;
  const L = layer(20);
  const H = 15;
  const tf = 0.22;
  if (t < tf) {
    const y = -H + H * easeIn(t / tf);
    L.set(0, y - 1, VIO_L, 1);
    L.set(0, y, VIO, 1);
    L.set(0, y - 2, VIO, 0.5);
  } else {
    const k = (t - tf) / (zz.life - tf);
    const a = k > 0.55 ? 1 - (k - 0.55) / 0.45 : 1;
    const w = Math.min(2.6, 1 + (t - tf) * 14);
    ring(L, 0, 0, 0, w, VIO_D, 0.9, a);
    if (k < 0.5) ring(L, -0.5, -0.5, 0, Math.max(1, w - 1), VIO, 0.85, a * (1 - k * 2));
    if (k < 0.3) L.set(-1, -1, VIO_L, 1 - k / 0.3);
    if (t - tf < 0.14) {
      const s = (t - tf) / 0.14;
      L.set(-2 - 2 * s, -1 - 3 * s + 5 * s * s, VIO_L, 1 - s);
      L.set(2 + 2 * s, -1 - 3 * s + 5 * s * s, VIO_L, 1 - s);
    }
  }
  L.blit(g, px, py);
  return true;
});

/** Рёв лат (зона мозга): лиловые кольца по полу и пыль прочь. */
registerZonePainter('f2v_roar', (g, z, px, py) => {
  const zz = z as Zone;
  const L = layer(64);
  for (const d of [0, 0.22, 0.44]) {
    const k = (zz.t - d) / 0.7;
    if (k < 0 || k > 1) continue;
    const rr = 8 + 48 * easeOut(k);
    ring(L, 0, 0, rr - 1, rr, VIO, 0.75, 1 - k);
    ring(L, 0, 0, rr - 2, rr - 1, VIO_D, 0.5, 0.7 * (1 - k));
  }
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x3);
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * TAU + r() * 0.3;
    const life = 0.7 + 0.35 * r();
    const k = zz.t / life;
    if (k > 1) continue;
    const f = fly(zz.t, Math.cos(ang) * 75, Math.sin(ang) * 52, 0, 0, 3.5, 0, 0);
    dust(L, Math.cos(ang) * 8 + f.x, Math.sin(ang) * 5 + f.y - 5 * easeOut(k), 4.8, k, i);
  }
  L.blit(g, px, py);
  return true;
});

/** Высота груди лат над полом, пиксели: отсюда взрыв и сюда сходятся нити. */
const CHEST = 18;

/** Латы разбиты (зона мозга, поверх темноты): вспышка, кольцо, пар, осколки. */
registerZonePainter('f2v_burst', (g, z, px, py) => {
  const zz = z as Zone;
  const t = zz.t;
  const L = layer(92);
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x1234);
  // Кольцо по полу: лиловое с белой кромкой.
  for (const [d, max, th, al] of [
    [0, 64, 2, 1],
    [0.08, 46, 1, 0.6],
  ] as const) {
    const k = (t - d) / 0.42;
    if (k < 0 || k > 1) continue;
    const rr = 6 + max * easeOut(k);
    ring(L, 0, 0, rr - th, rr, VIO_L, al, 1 - k);
    ring(L, 0, 0, rr - th - 2, rr - th, VIO, al * 0.8, 0.8 * (1 - k));
  }
  // Пар роя: клубы от груди наружу и вверх, растут и тают.
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * TAU + (r() - 0.5) * 0.5;
    const v = 55 + 60 * r();
    const life = 0.45 + 0.3 * r();
    const k = t / life;
    if (k > 1) continue;
    const f = fly(t, Math.cos(ang) * v, Math.sin(ang) * v * 0.7, 0, 0, 3.2, 0, 0);
    const lift = CHEST - 6 + 9 * easeOut(k) + Math.sin(ang) * 4;
    dust(L, f.x, f.y - lift, 5, k, i, VAPOR_L, VIO_L, VAPOR, 0.7);
  }
  // Вспышка в груди и лучи — первые кадры.
  if (t < 0.1) {
    const k = t / 0.1;
    ring(L, 0, -CHEST, 0, 7 + 9 * k, VIO_L, 0.95 * (1 - k * 0.6));
    ring(L, 0, -CHEST, 0, 4 + 4 * k, WHITE, 1 - k * 0.5);
  }
  if (t < 0.18) {
    const k = t / 0.18;
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * TAU + 0.2;
      const r0 = 8 + 32 * easeOut(k);
      const r1 = r0 + 10 * (1 - k);
      line(
        L,
        Math.cos(ang) * r0,
        Math.sin(ang) * r0 * 0.8 - CHEST,
        Math.cos(ang) * r1,
        Math.sin(ang) * r1 * 0.8 - CHEST,
        VIO_L,
        1 - k,
      );
    }
  }
  // Осколки стали: вертятся (четыре положения), падают и звенят об пол.
  const ORI: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  for (let i = 0; i < 14; i++) {
    const ang = r() * TAU;
    const v = 60 + 95 * r();
    const f = fly(
      t,
      Math.cos(ang) * v,
      Math.sin(ang) * v * 0.7,
      40 + 90 * r(),
      CHEST,
      1.4,
      330,
      0.3,
    );
    const a = t > 0.9 ? 1 - (t - 0.9) / 0.3 : 1;
    if (a <= 0) continue;
    const spin = f.down ? 0 : Math.floor(t * (14 + r() * 10) + i) % 4;
    const [ox, oy] = ORI[spin];
    const x = f.x;
    const y = f.y - f.z;
    if (!L.keep(x, y, a)) continue;
    if (f.z > 1) L.set(f.x, f.y, INK, 0.3);
    L.set(x, y, spin === 1 ? SPEC : STEEL[i % 2 ? 3 : 2]);
    L.set(x + ox, y + oy, STEEL[2]);
    L.set(x - ox, y - oy, STEEL[1]);
  }
  // Искры роя: лиловые, быстрые, гаснут в полёте.
  for (let i = 0; i < 20; i++) {
    const ang = r() * TAU;
    const v = 90 + 120 * r();
    const life = 0.3 + 0.3 * r();
    const k = t / life;
    if (k > 1) continue;
    const f = fly(t, Math.cos(ang) * v, Math.sin(ang) * v * 0.75, 20 * r(), CHEST, 3, 60, 0);
    L.set(f.x, f.y - f.z, k < 0.4 ? VIO_L : VIO, 1 - k * 0.6);
  }
  L.blit(g, px, py);
  return true;
});

/** Слизь роя на плитах после взрыва (зона мозга): лиловые кляксы, сохнут. */
registerZonePainter('f2v_splat', (g, z, px, py) => {
  const zz = z as Zone;
  const L = layer(52);
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x999);
  const grow = easeOut(zz.t / 0.25);
  const left = zz.life - zz.t;
  const a = left < 2 ? Math.max(0, left / 2) : 1;
  for (let i = 0; i < 10; i++) {
    const ang = r() * TAU;
    const d = (10 + 32 * r()) * grow;
    const s = 1.5 + 2.5 * r();
    const x = Math.cos(ang) * d;
    const y = Math.sin(ang) * d * 0.8;
    // Потёк — хвост кляксы к центру взрыва.
    for (let j = 0; j < s * 1.6; j++) {
      const qx = x - Math.cos(ang) * j;
      const qy = y - Math.sin(ang) * j * 0.8;
      if (L.keep(qx, qy, a * (1 - j / (s * 1.6)))) L.set(qx, qy, VIO_D, 0.8);
    }
    ring(L, x, y, 0, s, VIO_D, 0.85, a);
    ring(L, x - 0.5, y - 0.5, 0, Math.max(1, s - 1), VIO, 0.6, a * 0.8);
    if (L.keep(x - 1, y - 1, a)) L.set(x - 1, y - 1, VIO_L, 0.9);
  }
  L.blit(g, px, py);
  return true;
});

/**
 * Сборка (зона мозга, поверх темноты): от каждого обломка, клинка и латника
 * к центру тянутся лиловые нити, по ним бегут бусины, в центре — вихрь.
 */
registerZonePainter('f2v_gather', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / zz.life);
  const cy = -CHEST;
  const sim = paintSim();
  const threads: { x: number; y: number; id: number; mite: boolean }[] = [];
  // Рамка — по концам нитей: слой не больше, чем нужно.
  let bx0 = -26;
  let by0 = cy - 20;
  let bx1 = 26;
  let by1 = 8;
  for (const m of sim?.mobs ?? []) {
    if (m.mode !== 'gather') continue;
    if (m.kind !== F2_PLATE && m.kind !== F2_BLADE && m.kind !== F2_MITE) continue;
    const x = (m.x - zz.x) * S;
    const y = (m.y - zz.y) * S - (m.kind === F2_BLADE ? 12 : 3);
    if (Math.abs(x) > 150 || Math.abs(y) > 150) continue;
    bx0 = Math.min(bx0, x - 10);
    bx1 = Math.max(bx1, x + 10);
    by0 = Math.min(by0, y - 10);
    by1 = Math.max(by1, y + 10);
    threads.push({ x, y, id: m.id, mite: m.kind === F2_MITE });
  }
  const L = layerBox(bx0, by0, bx1, by1);
  for (const th of threads) {
    const d = Math.hypot(th.x, th.y - cy);
    if (d < 3) continue;
    const nx = -(th.y - cy) / d;
    const ny = th.x / d;
    const wob = Math.min(8, d * 0.15) * Math.sin(time * 4 + th.id * 1.7) * (1 - k * 0.6);
    const al = (th.mite ? 0.5 : 0.75) + 0.25 * k;
    const n = Math.ceil(d);
    const at = (f: number) => {
      const bow = 4 * f * (1 - f) * wob;
      return [th.x * (1 - f) + nx * bow, th.y + (cy - th.y) * f + ny * bow] as const;
    };
    for (let i = 1; i < n; i++) {
      const f = i / n;
      // Нить латника — штрихом, обломка — сплошной.
      if (th.mite && i % 3 === 0) continue;
      const [x, y] = at(f);
      L.set(x, y, VIO, al * (0.55 + 0.45 * f));
    }
    // Бусины бегут к центру — всё быстрее к концу сборки.
    for (let b = 0; b < 2; b++) {
      const f = (time * (0.8 + 1.6 * k) + b * 0.5 + th.id * 0.13) % 1;
      const [x, y] = at(f);
      L.set(x, y, VIO_L, 1);
      L.set(x + 1, y, VIO_L, 0.8);
    }
    // У обломка — светится узел, где нить держит его.
    if (!th.mite) L.set(th.x, th.y, VIO_L, 0.6 + 0.4 * Math.sin(time * 9 + th.id));
  }
  // Вихрь в центре: пылинки роя закручиваются внутрь, ядро растёт.
  const rr = rnd(seedAt(zz.x, zz.y));
  for (let i = 0; i < 16; i++) {
    const ph = (time * (0.7 + 0.8 * k) + rr()) % 1;
    const rad = (6 + 16 * rr()) * (1 - ph);
    const ang = rr() * TAU + ph * 5;
    L.set(
      Math.cos(ang) * rad,
      cy + Math.sin(ang) * rad * 0.7,
      ph > 0.7 ? VIO_L : VIO,
      0.4 + 0.6 * ph,
    );
  }
  // Ядро — не шар, а вихрь: кольцо искр кружит вокруг светящейся точки,
  // сжимается и ярчает к концу сборки.
  const orb = 7 - 3 * k;
  const spin = time * (4 + 6 * k);
  for (let i = 0; i < 8; i++) {
    const ang = spin + (i * TAU) / 8;
    const x = Math.cos(ang) * orb;
    const y = cy + Math.sin(ang) * orb * 0.55;
    L.set(x, y, i % 2 ? VIO_L : VIO, 0.7 + 0.3 * k);
    L.set(x - Math.cos(ang - 0.5) * 1.5, y - Math.sin(ang - 0.5) * 0.8, VIO, 0.45);
  }
  const core = 1 + 1.6 * k + (Math.sin(time * 12) > 0.6 ? 0.6 : 0);
  ring(L, 0, cy, 0, core + 1, VIO, 0.8);
  ring(L, 0, cy, 0, core, k > 0.8 ? WHITE : VIO_L, 1);
  L.blit(g, px, py);
  return true;
});

/** Латы встают (зона мозга, поверх темноты): кольцо сходится, вспышка, рой вползает. */
registerZonePainter('f2v_reform', (g, z, px, py) => {
  const zz = z as Zone;
  const t = zz.t;
  const L = layer(56);
  if (t < 0.2) {
    const k = easeIn(t / 0.2);
    const rr = 46 * (1 - k) + 4;
    ring(L, 0, 0, rr - 2, rr, VIO_L, 0.6 + 0.4 * k);
    ring(L, 0, 0, rr, rr + 2, VIO, 0.5 + 0.4 * k, 0.6);
  } else if (t < 0.36) {
    const k = (t - 0.2) / 0.16;
    ring(L, 0, -CHEST, 0, 12 - 8 * k, VIO_L, 0.95 * (1 - k));
    ring(L, 0, -CHEST, 0, 6 - 4 * k, WHITE, 1 - k * 0.5);
    ring(L, 0, 0, 12 + 22 * k - 1, 12 + 22 * k, VIO_L, 0.85, 1 - k);
  }
  // Рой вползает в латы: искры поднимаются от сабатонов к шлему.
  const r = rnd(seedAt(zz.x, zz.y) ^ 0x42);
  for (let i = 0; i < 18; i++) {
    const t0 = 0.2 + r() * 0.7;
    const x = (r() - 0.5) * 16;
    const k = (t - t0) / 0.3;
    if (k < 0 || k > 1) continue;
    L.set(x * (1 - k * 0.6), -2 - 34 * easeOut(k), k < 0.5 ? VIO_L : VIO, 1 - k * 0.7);
  }
  L.blit(g, px, py);
  return true;
});
