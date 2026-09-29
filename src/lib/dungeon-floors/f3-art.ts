// Этаж 3 «Затопленная бездна» — рисовальщики. Всё — кодом, пикселями 16 на
// клетку, без сглаживания, свет сверху-слева, контур `#150f0b`. Палитра —
// камень набора 0x72 (`P`) плюс два акцента этажа: холодная бирюза воды и
// друз и фиолет кристаллов; алый — только у Алой пасти.
//
// Кадры монстров собираются из форм (объёмные эллипсы с тенью по нормали,
// многоугольники, толстые сплайны) и кешируются по ключу «вид, поза, кадр,
// сторона, вспышка, облик»: в кадре игры ничего не рисуется заново.
// Клетки (вода, пропасть, мелководье, мостки, водопад) собираются в кусок
// карты один раз — живое на них рисуют предметы и зоны.
//
// Порядок импорта — как у `dungeon-mobart.ts`: плитки раньше рисунков.
import { P } from '../dungeon-tiles';
import { hex, mix, Px, TS } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import { Tile } from '../dungeon-world';
import type { WorldObj } from '../dungeon-world';
import { F3_MARK } from './f3';
import type { F3Zone } from './f3-brains';

type RGBA = [number, number, number, number];

export const INK = hex('#150f0b');
export const WHITE: RGBA = [255, 255, 255, 255];
const GOLD = hex('#ffcc40');

// ---------------------------------------------------------------------------
// Кисти.
// ---------------------------------------------------------------------------

/** Свет сверху-слева-спереди: как у крыс (`dungeon-rats.ts`). */
const LX = -0.45;
const LY = -0.75;
const LZ = 0.5;

/** Освещённость точки эллипса по нормали: <0 — тень, ~1 — блик. */
function lit(cx: number, cy: number, rx: number, ry: number, x: number, y: number): number {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  return dx * LX + dy * LY + nz * LZ;
}

/** Ступени тона: [тень, основной, свет, блик]. */
type Ramp = [RGBA, RGBA, RGBA, RGBA];

function tone(r: Ramp, k: number): RGBA {
  return k > 0.82 ? r[3] : k > 0.45 ? r[2] : k > 0.02 ? r[1] : r[0];
}

const ramp = (a: string, b: string, c: string, d: string): Ramp => [hex(a), hex(b), hex(c), hex(d)];

/** Объёмный эллипс: тон по нормали. `cut` — где не рисовать. */
function blob(
  p: Px,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: Ramp,
  cut?: (x: number, y: number) => boolean,
): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      if (cut && cut(x, y)) continue;
      p.set(x, y, tone(r, lit(cx, cy, rx, ry, x, y)));
    }
}

/** Многоугольник: заливка по строкам (чёт-нечет). */
function poly(p: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy))
        xs.push(ax + ((yy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++)
        p.set(x, y, typeof c === 'function' ? c(x, y) : c);
  }
}

/** Кривая Катмулла — Рома через точки. */
function spline(pts: [number, number][], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Толстая кривая, сужается от `w0` к `w1`; цвет — от начала к концу. */
function tube(
  p: Px,
  pts: [number, number][],
  w0: number,
  w1: number,
  c: RGBA | ((k: number) => RGBA),
): void {
  const line = spline(pts, 8);
  line.forEach(([x, y], i) => {
    const k = i / Math.max(1, line.length - 1);
    const w = w0 + (w1 - w0) * k;
    const col = typeof c === 'function' ? c(k) : c;
    if (w <= 1) p.set(x, y, col);
    else p.ell(x, y, w / 2, w / 2, col);
  });
}

function clonePx(src: Px): Px {
  const o = new Px(src.w, src.h);
  o.data.set(src.data);
  return o;
}

/** Альбинос: белёсый, как у крыс. */
function pale(src: Px): Px {
  const o = clonePx(src);
  const d = o.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    d[i] = l * 0.5 + 244 * 0.5;
    d[i + 1] = l * 0.5 + 236 * 0.5;
    d[i + 2] = l * 0.5 + 228 * 0.5;
  }
  return o;
}

const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

// ---------------------------------------------------------------------------
// Кадры монстров: сырой рисунок → облик, сторона, вспышка → холст (кеш).
// ---------------------------------------------------------------------------

interface Raw {
  p: Px;
  /** Середина тела от левого края, земля от верха, глаз. */
  ax: number;
  ay: number;
  eye?: [number, number] | null;
}

const raws = new Map<string, Raw>();
const frames = new Map<string, MobFrame>();

function mobFrame(key: string, pose: MobPose, make: () => Raw): MobFrame {
  const fk = `${key}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = frames.get(fk);
  if (hit) return hit;
  let raw = raws.get(key);
  if (!raw) {
    raw = make();
    raws.set(key, raw);
  }
  let p = raw.p;
  if (pose.look === 'albino') p = pale(p);
  if (pose.look === 'elite') {
    p = clonePx(p);
    p.outline(GOLD);
  }
  if (pose.left) p = p.flipX();
  if (pose.flash) p = p.tint(WHITE, 0.85);
  const ax = pose.left ? p.w - raw.ax : raw.ax;
  const eye = raw.eye
    ? ([pose.left ? p.w - 1 - raw.eye[0] : raw.eye[0], raw.eye[1]] as [number, number])
    : null;
  const out: MobFrame = { img: p.canvas(), ax, ay: raw.ay, eye };
  frames.set(fk, out);
  return out;
}

export const cyc = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;

// ---------------------------------------------------------------------------
// Пересмешник: пепельная птица с длинным хвостом и БЕЛОЙ МАСКОЙ-ЛИЦОМ —
// тем, чем она «говорит». Голос чужой, лицо почти человеческое: глазницы
// тёмные, в глубине красная точка, клюв крючком снизу, как подбородок.
// ---------------------------------------------------------------------------

const MOCK = {
  feather: ramp('#46525e', '#74828e', '#a2aeb6', '#d0d8da'),
  far: ramp('#2a323c', '#404a56', '#5a6672', '#74808c'),
  tip: hex('#171b21'),
  pale: hex('#c8ccc4'),
  mask: ramp('#7a725e', '#b8ae94', '#e0d8c0', '#f6f0de'),
  hole: hex('#1a1210'),
  eye: hex('#ff4a36'),
  beak: hex('#3a3024'),
  mouth: hex('#2a0c0c'),
};

type WingPose = 'up' | 'mid' | 'down' | 'fold' | 'spread' | 'droop';

/** Направление крыла на экране (птица смотрит вправо): угол в градусах. */
const WING_DEG: Record<WingPose, number> = {
  up: -105,
  mid: -168,
  down: 150,
  fold: -176,
  spread: -130,
  droop: 125,
};

/**
 * Крыло: плечо → запястье толстой «рукой», от запястья веером четыре маховых
 * пера — кончики темнее, кроющие светлые. Так крыло читается пером, а не
 * лопатой, даже в шестнадцати точках.
 */
function wing(p: Px, sx: number, sy: number, pose: WingPose, far: boolean) {
  const a = (WING_DEG[pose] * Math.PI) / 180;
  const fold = pose === 'fold';
  const arm = fold ? 3.5 : 4;
  const wx = sx + Math.cos(a) * arm;
  const wy = sy + Math.sin(a) * arm;
  const r = far ? MOCK.far : MOCK.feather;
  // Перья: веер назад от запястья, длиннее к переднему краю.
  const fan = fold ? 0.12 : 0.3;
  for (let i = 3; i >= 0; i--) {
    const fa = a + (a < 0 ? 1 : -1) * (0.25 - i * fan);
    const len = (fold ? 6 : 6.5) - i * (fold ? 0.4 : 0.9);
    const tx = wx + Math.cos(fa) * len;
    const ty = wy + Math.sin(fa) * len;
    tube(
      p,
      [
        [wx, wy],
        [(wx + tx) / 2, (wy + ty) / 2],
        [tx, ty],
      ],
      2,
      1,
      (k) => (k > 0.75 ? (far ? r[0] : MOCK.tip) : k > 0.3 ? r[far ? 1 : 1] : r[far ? 1 : 2]),
    );
  }
  // Рука крыла — кроющие, светлее.
  tube(
    p,
    [
      [sx, sy],
      [(sx + wx) / 2, (sy + wy) / 2],
      [wx, wy],
    ],
    far ? 2.4 : 3,
    2.2,
    (k) => (k < 0.5 ? r[2] : r[far ? 1 : 3]),
  );
}

interface MockPose {
  wing: WingPose;
  body: 'fly' | 'dive' | 'perch' | 'dead' | 'sleep';
  mouth: number;
  tail: number;
}

function paintMocker(o: MockPose): Raw {
  const W = 28;
  const H = 24;
  const p = new Px(W, H);
  const dive = o.body === 'dive';
  const perch = o.body === 'perch' || o.body === 'sleep';
  const cy = perch ? 15 : 13;
  const cx = 13;
  if (o.body === 'dead') {
    // На спине: крылья раскинуты по земле, лапы вверх.
    wing(p, cx - 1, 17, 'droop', true);
    blob(p, cx, 17, 4, 2.3, MOCK.feather);
    wing(p, cx + 1, 17, 'mid', false);
    p.ell(cx + 5, 16.5, 2, 2, MOCK.mask[2]);
    p.set(cx + 5, 16, MOCK.hole);
    p.set(cx + 6, 17, MOCK.hole);
    p.line(cx - 1, 15, cx - 2, 13, MOCK.beak);
    p.line(cx + 1, 15, cx + 2, 13, MOCK.beak);
    p.outline(INK);
    return { p, ax: cx, ay: 20, eye: null };
  }
  // Хвост: две длинные ленты, светлые кончики — узнаётся издали.
  const tw = o.tail;
  const t0: [number, number][] = dive
    ? [
        [cx - 3, cy],
        [cx - 8, cy + 0.3],
        [cx - 12, cy + 0.5],
      ]
    : [
        [cx - 3, cy + 0.5],
        [cx - 7, cy + 0.5 + tw * 0.5],
        [cx - 12, cy - 0.5 + tw],
      ];
  const t1: [number, number][] = dive
    ? [
        [cx - 3, cy + 1],
        [cx - 8, cy + 1.6],
        [cx - 11, cy + 2.4],
      ]
    : [
        [cx - 3, cy + 1.5],
        [cx - 7, cy + 2.2 - tw * 0.4],
        [cx - 11, cy + 2.5 - tw],
      ];
  tube(p, t1, 2, 1, (k) => (k > 0.8 ? MOCK.pale : MOCK.far[2]));
  tube(p, t0, 2.2, 1, (k) => (k > 0.8 ? MOCK.pale : MOCK.feather[2]));
  // Дальнее крыло — за телом, темнее.
  const sx = cx + 1;
  const sy = cy - 1.5;
  if (!dive && o.wing !== 'droop' && o.wing !== 'down')
    wing(p, sx + 1, sy - 0.5, o.wing === 'spread' ? 'up' : o.wing, true);
  // Тело.
  const brx = dive ? 5 : 4;
  const bry = dive ? 2.2 : 2.7;
  blob(p, cx, cy, brx, bry, MOCK.feather);
  for (let x = cx - 1; x < cx + brx; x++) p.set(x, cy + bry - 0.5, MOCK.feather[3]);
  // Лапы: сидит — видны; летит — поджаты.
  if (perch) {
    p.line(cx - 1, cy + 2, cx - 1, cy + 4, MOCK.beak);
    p.line(cx + 2, cy + 2, cx + 2, cy + 4, MOCK.beak);
    p.set(cx, cy + 4, MOCK.beak);
    p.set(cx + 3, cy + 4, MOCK.beak);
  } else if (!dive) p.set(cx, cy + 3, MOCK.beak);
  // Голова и маска.
  const hx = dive ? cx + 5.5 : cx + 4.2;
  const hy = dive ? cy - 0.3 : o.body === 'sleep' ? cy - 0.5 : cy - 2.2;
  blob(p, hx, hy, 2.6, 2.5, MOCK.feather);
  if (o.body !== 'sleep') {
    blob(p, hx + 1.3, hy + 0.3, 1.8, 2.3, MOCK.mask);
    p.set(hx + 1.6, hy - 0.6, MOCK.hole);
    p.set(hx + 1.6, hy + 0.4, MOCK.hole);
    // Клюв крючком вниз — как подбородок маски.
    p.set(hx + 3, hy + 1.4, MOCK.beak);
    p.set(hx + 3, hy + 2.3, MOCK.beak);
    p.set(hx + 2.2, hy + 2.7, MOCK.beak);
    if (o.mouth > 0) p.ell(hx + 1.5, hy + 2, 0.9, 0.5 + o.mouth * 0.6, MOCK.mouth);
  }
  // Ближнее крыло.
  if (!dive || o.wing === 'fold') wing(p, sx, sy, o.wing, false);
  p.outline(INK);
  const eye: [number, number] | null =
    o.body === 'sleep' ? null : [Math.round(hx + 1.6), Math.round(hy - 0.6)];
  if (eye) p.set(eye[0], eye[1], MOCK.eye);
  return { p, ax: cx, ay: perch ? cy + 5 : cy + 4, eye };
}

registerMobPainter('f3_mocker', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let o: MockPose;
  let key: string;
  const flap = (['up', 'mid', 'down', 'mid'] as WingPose[])[cyc(pose.frame * 0.9, 4)];
  if (pose.anim === 'dead') {
    o = { wing: 'droop', body: 'dead', mouth: 0, tail: 0 };
    key = 'dead';
  } else if (pose.anim === 'sleep') {
    o = { wing: 'fold', body: 'sleep', mouth: 0, tail: 0 };
    key = 'sleep';
  } else if (mode === 'dive') {
    o = { wing: 'fold', body: 'dive', mouth: 1, tail: 0 };
    key = 'dive';
  } else if (mode === 'aim') {
    const f = cyc(m.t * 14, 2);
    o = { wing: f ? 'spread' : 'up', body: 'fly', mouth: 1, tail: f ? 1 : -1 };
    key = `aim${f}`;
  } else if (mode === 'call') {
    const f = cyc(m.t * 5, 4);
    o = {
      wing: (['spread', 'up', 'spread', 'mid'] as WingPose[])[f],
      body: 'fly',
      mouth: f % 2 ? 1 : 0.4,
      tail: f % 2 ? 0.5 : -0.5,
    };
    key = `call${f}`;
  } else if (mode === 'perch' || mode === 'dizzy') {
    const f = cyc(m.t * 4, 2);
    o = { wing: 'droop', body: 'perch', mouth: f ? 0.5 : 0, tail: 1.2 };
    key = `perch${f}`;
  } else {
    const f = cyc(pose.frame, 4);
    o = { wing: flap, body: 'fly', mouth: 0, tail: f % 2 ? 0.6 : -0.3 };
    key = `fly${f}`;
  }
  if (pose.anim === 'hurt' && mode !== 'dive') key += 'h';
  return mobFrame(`mock|${key}`, pose, () => paintMocker(o));
});

// ---------------------------------------------------------------------------
// Шар-копьё: броненосец в охристых пластинах с длинной костяной иглой на
// морде. Свернулся — шар с поясами пластин, игла вперёд, как копьё.
// ---------------------------------------------------------------------------

const SPEAR = {
  shell: ramp('#4e3018', '#86592c', '#b8864a', '#e0b878'),
  band: hex('#3a2210'),
  skin: ramp('#5a3a2a', '#8a6048', '#b48a6a', '#d8b490'),
  bone: ramp('#8a7c5e', '#c8b890', '#eee2c0', '#fffbea'),
  belly: hex('#c8a47a'),
  leg: hex('#4a2c1a'),
  eye: hex('#ffc860'),
  star: hex('#fff08a'),
};

interface SpearPose {
  kind: 'walk' | 'curl' | 'ball' | 'stuck' | 'dead';
  f: number;
  spin: number;
}

function paintSpear(o: SpearPose): Raw {
  const W = 26;
  const H = 18;
  const p = new Px(W, H);
  const g = 14;
  if (o.kind === 'dead') {
    blob(p, 11, g - 3, 6.5, 3.5, SPEAR.shell, (_x, y) => y < g - 5);
    for (const x of [7, 10, 13]) p.line(x, g - 5, x, g - 1, SPEAR.band);
    p.line(7, g - 5, 6, g - 8, SPEAR.leg);
    p.line(10, g - 5, 10, g - 8, SPEAR.leg);
    p.line(13, g - 5, 14, g - 8, SPEAR.leg);
    tube(
      p,
      [
        [17, g - 3],
        [21, g - 2],
        [24, g - 2],
      ],
      2,
      1,
      (k) => tone(SPEAR.bone, 0.6 - k * 0.4),
    );
    p.outline(INK);
    return { p, ax: 11, ay: g, eye: null };
  }
  if (o.kind === 'ball' || o.kind === 'curl') {
    // Шар: пояса пластин повёрнуты на `spin` — видно, что катится.
    const cx = 11;
    const r = o.kind === 'curl' && o.f === 0 ? 5.2 : 5.6;
    const cy = g - r;
    blob(p, cx, cy, r, r, SPEAR.shell);
    for (let k = 0; k < 3; k++) {
      const a = o.spin + (k * Math.PI) / 3;
      const ca = Math.cos(a);
      // Пояс — эллипс по долготе: сжатый по x в |cos|.
      for (let t = -1; t <= 1; t += 0.08) {
        const y = cy + t * r * 0.95;
        const x = cx + ca * Math.sqrt(1 - t * t) * r * 0.95;
        if (Math.sin(a) > 0) p.set(x, y, SPEAR.band);
      }
    }
    // Блик шара.
    p.set(cx - 2, cy - 3, SPEAR.shell[3]);
    p.set(cx - 3, cy - 2, SPEAR.shell[3]);
    // Игла вперёд — копьё.
    tube(
      p,
      [
        [cx + r - 1, cy + 0.5],
        [cx + r + 3, cy],
        [cx + r + 7, cy - 0.5],
      ],
      2.4,
      1,
      (k) => tone(SPEAR.bone, 0.9 - k * 0.5),
    );
    if (o.kind === 'curl' && o.f === 0) {
      // Ещё сворачивается: видны лапы.
      p.line(cx - 3, g - 1, cx - 3, g, SPEAR.leg);
      p.line(cx + 2, g - 1, cx + 2, g, SPEAR.leg);
    }
    p.outline(INK);
    if (o.kind === 'ball' && o.f > 0) {
      // Скорость: полосы позади шара (после контура — пыль, а не тело).
      for (let k = 0; k < 3; k++) {
        const y = cy - 2 + k * 2;
        const l = 3 + ((k + o.f) % 3);
        p.line(cx - r - 2 - l, y, cx - r - 2, y, [230, 214, 180, 150 - k * 30]);
      }
    }
    return { p, ax: cx, ay: g, eye: null };
  }
  // Ходьба / застрял: купол пластин, голова с иглой, короткие лапы.
  const stuck = o.kind === 'stuck';
  const lift = o.kind === 'walk' ? (o.f % 2) * 0.5 : 0;
  const cx = 10;
  const cy = g - 5 - lift;
  // Хвостик.
  tube(
    p,
    [
      [cx - 6, cy + 2],
      [cx - 8, cy + 3],
      [cx - 9, cy + 4],
    ],
    2,
    1,
    SPEAR.skin[1],
  );
  // Лапы: дальние темнее, шаг по кадру.
  const step = [0, 1, 0, -1][o.f % 4];
  const legs = [
    [cx - 4, -step],
    [cx - 1, step],
    [cx + 3, -step],
    [cx + 5, step],
  ];
  legs.forEach(([x, s], i) => {
    const far = i % 2 === 1;
    p.line(x, cy + 3, x + s, g - 1, far ? SPEAR.skin[0] : SPEAR.leg);
    p.set(x + s + 1, g - 1, far ? SPEAR.skin[0] : SPEAR.leg);
  });
  // Купол: пластины поясами.
  blob(p, cx, cy, 6.8, 4.8, SPEAR.shell, (_x, y) => y > cy + 3);
  for (const bx of [cx - 3, cx, cx + 3]) {
    for (let y = cy - 4; y <= cy + 3; y++) {
      const dx = (bx + 0.5 - cx) / 6.8;
      const dy = (y + 0.5 - cy) / 4.8;
      if (dx * dx + dy * dy <= 1) p.set(bx, y, SPEAR.band);
    }
  }
  // Кромка пластин снизу — светлая.
  for (let x = cx - 6; x <= cx + 6; x++) p.set(x, cy + 3, SPEAR.shell[2]);
  // Голова и игла.
  const hx = cx + 7 + (stuck ? 1 : 0);
  const hy = cy + 1 + (stuck ? 2 : 0);
  blob(p, hx, hy, 2.6, 2.3, SPEAR.skin);
  p.set(hx - 1, hy - 2.4, SPEAR.skin[2]);
  const tipY = stuck ? hy + 4 : hy - 0.5;
  tube(
    p,
    [
      [hx + 2, hy + 0.3],
      [hx + 4.5, (hy + tipY) / 2 + 0.2],
      [hx + 7, tipY],
    ],
    2.2,
    1,
    (k) => tone(SPEAR.bone, 0.9 - k * 0.5),
  );
  p.outline(INK);
  const eye: [number, number] = [Math.round(hx + 0.6), Math.round(hy - 0.8)];
  p.set(eye[0], eye[1], SPEAR.eye);
  if (stuck) {
    // Звёзды над головой: оглушён.
    const s = o.f % 2;
    p.set(hx - 2 + s * 3, hy - 5, SPEAR.star);
    p.set(hx + 1 - s * 3, hy - 6, SPEAR.star);
  }
  return { p, ax: cx, ay: g, eye };
}

registerMobPainter('f3_spear', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let o: SpearPose;
  let key: string;
  if (pose.anim === 'dead') {
    o = { kind: 'dead', f: 0, spin: 0 };
    key = 'dead';
  } else if (mode === 'curl') {
    // Раскрутка ускоряется к броску.
    const k = Math.min(1, m.t / 1);
    const f = m.t < 0.15 ? 0 : 1;
    const s = cyc(m.t * (6 + 22 * k), 6);
    o = { kind: 'curl', f, spin: (s * Math.PI) / 9 };
    key = `curl${f}${s}`;
  } else if (mode === 'roll') {
    const s = cyc(m.t * 26, 6);
    o = { kind: 'ball', f: 1 + (s % 3), spin: (s * Math.PI) / 9 };
    key = `roll${s}`;
  } else if (mode === 'dizzy' && m.data.stuck) {
    const f = cyc(m.t * 6, 2);
    o = { kind: 'stuck', f, spin: 0 };
    key = `stuck${f}`;
  } else if (pose.anim === 'sleep') {
    o = { kind: 'ball', f: 0, spin: 0.4 };
    key = 'sleep';
  } else {
    const f = pose.anim === 'run' ? cyc(pose.frame, 4) : 0;
    o = { kind: 'walk', f, spin: 0 };
    key = `walk${f}`;
  }
  return mobFrame(`spear|${key}`, pose, () => paintSpear(o));
});

// ---------------------------------------------------------------------------
// Омутник: под водой — рябь и два светящихся глаза. Вынырнул — широкая
// плоская голова с пастью-щелью, полной игл, и две длинные бледные руки с
// крючьями; ниже пояса — вода с пеной. Он летун для движка (плавает над
// «глубиной»), поэтому подъём летуна (6 точек) рисунок вычитает.
// ---------------------------------------------------------------------------

const GRASP = {
  skin: ramp('#1e2c26', '#34483e', '#557060', '#7e9a82'),
  arm: ramp('#5a6e5e', '#8ea48a', '#b8cab0', '#dce8d2'),
  claw: hex('#e8f0dc'),
  mouth: hex('#12060a'),
  tooth: hex('#f2f6e4'),
  eye: hex('#d6ff6a'),
  foam: hex('#bff4ea'),
  water: hex('#2a8a90', 190),
  waterD: hex('#15505a', 210),
  ripple: hex('#8fe0d8', 200),
};

/** Подъём летуна в рисунке движка — компенсируем, чтобы тело сидело в воде. */
const FLY_LIFT = 6;

function paintGrasp(kind: 'under' | 'rise' | 'hold' | 'dead', f: number): Raw {
  const W = 28;
  const H = 26;
  const p = new Px(W, H);
  const wl = 18; // линия воды
  const cx = 14;
  if (kind === 'under') {
    // Тёмное тело под водой, рябь кругами, глаза смотрят.
    p.ell(cx, wl, 5.5, 2.4, [10, 40, 44, 150]);
    for (let k = 0; k < 2; k++) {
      const rr = 3.5 + ((f + k * 2) % 4) * 1.4;
      for (let a = 0; a < Math.PI * 2; a += 0.12) {
        if (Math.sin(a * 3 + f) < -0.2) continue;
        p.set(cx + Math.cos(a) * rr * 1.4, wl + Math.sin(a) * rr * 0.55, GRASP.ripple);
      }
    }
    p.set(cx - 2, wl - 1, GRASP.eye);
    p.set(cx + 2, wl - 1, GRASP.eye);
    return { p, ax: cx, ay: wl + 2 - FLY_LIFT, eye: null };
  }
  if (kind === 'dead') {
    // Всплыл брюхом вверх.
    p.ell(cx, wl, 7, 2.2, GRASP.waterD);
    blob(p, cx, wl - 1, 6, 2.2, ramp('#6a806a', '#9ab094', '#bccaae', '#dce6cc'));
    p.line(cx - 7, wl - 1, cx - 10, wl - 3, GRASP.arm[1]);
    p.line(cx + 7, wl - 1, cx + 10, wl - 2, GRASP.arm[1]);
    p.outline(INK);
    p.set(cx + 3, wl - 3, INK);
    p.set(cx + 4, wl - 2, INK);
    return { p, ax: cx, ay: wl + 2 - FLY_LIFT, eye: null };
  }
  const up = kind === 'rise' ? (f === 0 ? 3 : 1) : 0;
  const hy = wl - 6 + up;
  // Руки: длинные, костлявые, с локтем; на концах — три крюка.
  //   rise 0 — выходят из воды по бокам, локтями вверх;
  //   rise 1 — хват: обе тянутся вперёд, к цели;
  //   hold   — раскинуты, покачиваются.
  const hand = (pts: [number, number][], open: boolean, fwd: number) => {
    tube(p, pts, 2.6, 1.8, (k) => tone(GRASP.arm, 0.15 + k * 0.6));
    const [x, y] = pts[pts.length - 1];
    for (let i = -1; i <= 1; i++) {
      const aa = fwd + i * (open ? 0.7 : 0.35);
      p.line(x, y, x + Math.cos(aa) * 2.6, y + Math.sin(aa) * 2.6, GRASP.claw);
    }
  };
  const sway = f % 2;
  if (kind === 'rise' && f === 1) {
    hand(
      [
        [cx - 4, wl - 1],
        [cx - 2, hy - 5],
        [cx + 5, hy - 6],
        [cx + 10, hy - 4],
      ],
      true,
      0.1,
    );
    hand(
      [
        [cx + 4, wl - 1],
        [cx + 7, hy - 1],
        [cx + 11, hy + 1],
      ],
      true,
      0.3,
    );
  } else if (kind === 'rise') {
    hand(
      [
        [cx - 5, wl],
        [cx - 8, hy - 3],
        [cx - 7, hy - 7],
      ],
      false,
      -1.4,
    );
    hand(
      [
        [cx + 5, wl],
        [cx + 8, hy - 3],
        [cx + 8, hy - 7],
      ],
      false,
      -1.6,
    );
  } else {
    hand(
      [
        [cx - 5, wl - 1],
        [cx - 10, hy - 2 - sway],
        [cx - 12, hy + 3],
      ],
      true,
      1.9,
    );
    hand(
      [
        [cx + 5, wl - 1],
        [cx + 10, hy - 3 + sway],
        [cx + 12, hy + 2],
      ],
      true,
      1.2,
    );
  }
  // Голова: широкая, плоская, с пастью-щелью.
  blob(p, cx, hy, 6.4, 4.4, GRASP.skin, (_x, y) => y > wl);
  blob(p, cx, hy + 3, 5, 2.2, ramp('#556a58', '#7e9478', '#9ab094', '#c0d0b4'), (_x, y) => y > wl);
  const open = kind === 'hold' ? 1 + (f % 2) : kind === 'rise' && f === 1 ? 2 : 0;
  if (open) {
    const my = hy + 1;
    for (let x = cx - 4; x <= cx + 4; x++)
      for (let k = 0; k < open; k++) p.set(x, my + k, GRASP.mouth);
    for (let x = cx - 4; x <= cx + 4; x += 2) {
      p.set(x, my, GRASP.tooth);
      p.set(x + 1, my + open - 1, GRASP.tooth);
    }
  } else p.line(cx - 4, hy + 1, cx + 4, hy + 1, GRASP.mouth);
  // Жабры и бородавки.
  p.set(cx - 5, hy - 1, GRASP.skin[0]);
  p.set(cx + 5, hy - 1, GRASP.skin[0]);
  p.set(cx - 2, hy - 3, GRASP.skin[3]);
  p.outline(INK);
  // Вода по пояс: полупрозрачная, с пеной по кромке.
  for (let y = wl; y < H - 1; y++)
    for (let x = cx - 9; x <= cx + 9; x++) {
      const dx = (x + 0.5 - cx) / 9;
      const dy = (y - wl + 0.5) / 4;
      if (dx * dx + dy * dy > 1) continue;
      p.set(x, y, y === wl ? GRASP.foam : (x + y) % 5 === 0 ? GRASP.ripple : GRASP.water);
    }
  for (let x = cx - 8; x <= cx + 8; x += 3) p.set(x + (f % 2), wl - 1, GRASP.foam);
  const eye: [number, number] = [cx + 3, hy - 2];
  p.set(cx - 3, hy - 2, GRASP.eye);
  p.set(eye[0], eye[1], GRASP.eye);
  return { p, ax: cx, ay: wl + 2 - FLY_LIFT, eye };
}

registerMobPainter('f3_grasp', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let kind: 'under' | 'rise' | 'hold' | 'dead';
  let f: number;
  if (pose.anim === 'dead') {
    kind = 'dead';
    f = 0;
  } else if (m.data.ghost) {
    kind = 'under';
    f = cyc(m.t * 5 + m.id, 4);
  } else if (mode === 'rise') {
    kind = 'rise';
    f = m.t < 0.55 ? 0 : 1;
  } else {
    kind = 'hold';
    f = cyc(m.t * 4, 2);
  }
  // Под водой не вспыхивает: удар его не берёт.
  const p2 = kind === 'under' ? { ...pose, flash: false } : pose;
  return mobFrame(`grasp|${kind}${f}`, p2, () => paintGrasp(kind, f));
});

// ---------------------------------------------------------------------------
// Друзовый краб: индиговый панцирь, из спины растёт фиолетовая друза —
// светится. Клешни подняты перед мордой — щит; замах — большая клешня
// вверх; удар — клешня в земле.
// ---------------------------------------------------------------------------

const CRAB = {
  shell: ramp('#231c36', '#3e3260', '#62538c', '#8e7fb8'),
  claw: ramp('#2e2446', '#50427a', '#7a6aa8', '#a898d0'),
  xtal: ramp('#5a2ea8', '#9468e8', '#c8a8ff', '#f4e8ff'),
  leg: hex('#2a2240'),
  eye: hex('#e2ccff'),
  stalk: hex('#3a2e58'),
};

function crystal(p: Px, x: number, y: number, h: number, lean: number, r: Ramp): void {
  // Призма: тёмная грань слева, светлая справа, блик по ребру.
  for (let k = 0; k < h; k++) {
    const yy = y - k;
    const xx = x + lean * (k / h);
    const w = k > h - 2 ? 0 : 1;
    p.set(xx - w, yy, r[1]);
    p.set(xx, yy, r[2]);
    p.set(xx + w, yy, k % 3 === 0 ? r[3] : r[2]);
  }
  p.set(x + lean, y - h, r[3]);
}

type CrabKind = 'walk' | 'guard' | 'raise' | 'slam' | 'dead' | 'sleep';

function paintCrab(kind: CrabKind, f: number): Raw {
  const W = 30;
  const H = 22;
  const p = new Px(W, H);
  const g = 18;
  const cx = 14;
  if (kind === 'dead') {
    blob(p, cx, g - 3, 7, 3, CRAB.shell);
    for (let i = 0; i < 3; i++) {
      p.line(cx - 5 + i * 3, g - 5, cx - 6 + i * 3, g - 8, CRAB.leg);
      p.line(cx + 1 + i * 2, g - 5, cx + 2 + i * 2, g - 8, CRAB.leg);
    }
    crystal(p, cx + 3, g, 3, 1, ramp('#3a2a58', '#5a4a80', '#7a6aa0', '#9a8ac0'));
    p.outline(INK);
    return { p, ax: cx, ay: g, eye: null };
  }
  const bob = kind === 'walk' ? f % 2 : 0;
  const lean = kind === 'raise' ? -1 : kind === 'slam' ? 1 : 0;
  const cy = g - 6 - bob + (kind === 'sleep' ? 2 : 0);
  // Ноги: по три с каждой стороны, суставом вверх, шаг по кадру.
  if (kind !== 'sleep')
    for (let i = 0; i < 3; i++) {
      const s = kind === 'walk' ? [1, -1, 1, -1][(f + i) % 4] : 0;
      const bx = cx - 5 + i * 2;
      p.line(bx, cy + 2, bx - 3, cy + 1, CRAB.leg);
      p.line(bx - 3, cy + 1, bx - 4 + s, g - 1, CRAB.leg);
      const fx = cx + 3 + i * 2;
      p.line(fx, cy + 2, fx + 3, cy + 1, CRAB.shell[1]);
      p.line(fx + 3, cy + 1, fx + 4 - s, g - 1, CRAB.shell[1]);
    }
  // Панцирь.
  blob(p, cx + lean, cy, 7.4, 4, CRAB.shell);
  for (let x = cx - 6; x <= cx + 6; x += 2) p.set(x + lean, cy + 3, CRAB.shell[0]);
  // Друза на спине: четыре призмы.
  const dx = cx - 1 + lean;
  crystal(p, dx - 3, cy - 2, 4, -1, CRAB.xtal);
  crystal(p, dx, cy - 3, 7, 0.5, CRAB.xtal);
  crystal(p, dx + 2, cy - 2, 5, 1.5, CRAB.xtal);
  crystal(p, dx + 4, cy - 1, 3, 1, CRAB.xtal);
  // Глаза на стебельках.
  const ex = cx + 5 + lean;
  p.line(ex, cy - 2, ex, cy - 4, CRAB.stalk);
  p.line(ex + 2, cy - 2, ex + 2, cy - 4, CRAB.stalk);
  // Клешни: ладонь и два пальца с щелью — пинцет читается и в шестнадцати
  // точках. `up` — клешня стоит торчком (щит перед мордой).
  const clawAt = (x: number, y: number, big: boolean, open: boolean, up = false) => {
    blob(p, x, y, big ? 2.8 : 2, big ? 2.2 : 1.6, CRAB.claw);
    const l = big ? 4.2 : 2.6;
    const gap = open ? 2.4 : 0.7;
    if (up) {
      tube(
        p,
        [
          [x - 0.8, y - 1],
          [x - 1 - gap * 0.5, y - l * 0.6],
          [x - gap * 0.4, y - l],
        ],
        2,
        1,
        CRAB.claw[3],
      );
      tube(
        p,
        [
          [x + 0.8, y - 1],
          [x + 1 + gap * 0.3, y - l * 0.6],
          [x + gap * 0.3, y - l],
        ],
        2,
        1,
        CRAB.claw[2],
      );
    } else {
      tube(
        p,
        [
          [x + 1, y - 0.8],
          [x + l * 0.6, y - 1 - gap * 0.6],
          [x + l, y - gap * 0.4],
        ],
        2,
        1,
        CRAB.claw[3],
      );
      tube(
        p,
        [
          [x + 1, y + 0.8],
          [x + l * 0.6, y + 1 + gap * 0.3],
          [x + l, y + gap * 0.3],
        ],
        2,
        1,
        CRAB.claw[2],
      );
    }
  };
  if (kind === 'raise') {
    // Замах: большая клешня высоко над панцирем, раскрыта.
    p.line(cx + 5, cy, cx + 7, cy - 6, CRAB.claw[1]);
    clawAt(cx + 8, cy - 8, true, true);
    clawAt(cx + 8, cy + 1, false, false);
  } else if (kind === 'slam') {
    // Удар: клешня в земле перед мордой.
    p.line(cx + 6, cy + 1, cx + 10, g - 2, CRAB.claw[1]);
    clawAt(cx + 11, g - 2, true, false);
    clawAt(cx + 8, cy + 1, false, false);
  } else if (kind === 'guard') {
    // Щит: клешни торчком перед мордой.
    clawAt(cx + 9, cy + 1, true, false, true);
    clawAt(cx + 11, cy + 3, false, false, true);
  } else {
    clawAt(cx + 8, cy + 1 + (f % 2), true, false);
    clawAt(cx + 7, cy + 3, false, false);
  }
  p.outline(INK);
  if (kind === 'sleep') return { p, ax: cx, ay: g, eye: null };
  const eye: [number, number] = [ex + 2, cy - 5];
  p.set(ex, cy - 5, CRAB.eye);
  p.set(eye[0], eye[1], CRAB.eye);
  return { p, ax: cx, ay: g, eye };
}

registerMobPainter('f3_crab', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let kind: CrabKind;
  let f = 0;
  if (pose.anim === 'dead') kind = 'dead';
  else if (pose.anim === 'sleep') kind = 'sleep';
  else if (mode === 'windup') kind = 'raise';
  else if (mode === 'recover') kind = 'slam';
  else if (m.data.ghost) {
    kind = 'guard';
    f = cyc(pose.frame, 2);
  } else {
    kind = 'walk';
    f = pose.anim === 'run' ? cyc(pose.frame, 4) : 0;
  }
  return mobFrame(`crab|${kind}${f}`, pose, () => paintCrab(kind, f));
});

// ---------------------------------------------------------------------------
// Туманка: прозрачный колокол с клевером внутри, светится; пять щупалец и
// две бахромы, колышутся. Замах — щупальца врозь и ярче.
// ---------------------------------------------------------------------------

const JELLY = {
  bell: hex('#6ad8ee', 170),
  bellD: hex('#3a98c0', 190),
  rim: hex('#d8fbff', 230),
  core: hex('#ffffff', 240),
  clover: hex('#b8f4ff', 230),
  tent: hex('#58c8e0', 200),
  tentHi: hex('#c8f8ff', 220),
  arm: hex('#9ae8f8', 210),
};

function paintJelly(kind: 'drift' | 'sting' | 'dead', f: number): Raw {
  const W = 18;
  const H = 24;
  const p = new Px(W, H);
  const cx = 9;
  if (kind === 'dead') {
    p.ell(cx, 20, 6, 2, JELLY.bellD);
    p.ell(cx, 19.5, 4, 1.2, JELLY.bell);
    for (let k = -2; k <= 2; k++) p.line(cx + k * 2, 21, cx + k * 3, 22, JELLY.tent);
    return { p, ax: cx, ay: 22, eye: null };
  }
  const pulse = [0, 0.6, 1, 0.4][f % 4];
  const rx = 5.8 - pulse * 0.8;
  const ry = 4.4 + pulse * 0.4;
  const cy = 7 - pulse * 0.4;
  const flare = kind === 'sting' ? 1 : 0;
  // Щупальца: волна по кадру.
  for (let k = -2; k <= 2; k++) {
    const x0 = cx + k * 1.8;
    const pts: [number, number][] = [];
    for (let j = 0; j <= 4; j++) {
      const y = cy + 3 + j * 3;
      const wv = Math.sin(j * 1.1 + f * 1.4 + k) * (0.6 + j * 0.3);
      pts.push([x0 + wv + k * j * 0.5 * flare, y]);
    }
    tube(p, pts, 1, 1, (t) => (t > 0.8 ? JELLY.tentHi : JELLY.tent));
  }
  // Бахрома рта — две ленты посередине.
  for (const s of [-1, 1]) {
    const pts: [number, number][] = [
      [cx + s * 0.8, cy + 2],
      [cx + s * 1.4 + Math.sin(f + s) * 0.6, cy + 6],
      [cx + s * 0.6, cy + 9],
    ];
    tube(p, pts, 2, 1, JELLY.arm);
  }
  // Колокол: прозрачный купол, снизу срезан.
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + 2); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1 || y > cy + 2) continue;
      p.set(x, y, d > 0.7 ? JELLY.bellD : JELLY.bell);
    }
  // Кромка и блик.
  for (let x = Math.round(cx - rx); x <= Math.round(cx + rx); x++) p.set(x, cy + 2, JELLY.rim);
  p.set(cx - 2, cy - ry + 1, JELLY.core);
  p.set(cx - 3, cy - ry + 2, JELLY.rim);
  // Клевер внутри — четыре дужки вокруг ядра.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    p.set(cx + Math.cos(a) * 2, cy + Math.sin(a) * 1.3, JELLY.clover);
  }
  p.set(cx, cy, flare ? JELLY.core : JELLY.clover);
  return { p, ax: cx, ay: H - 2, eye: null };
}

registerMobPainter('f3_jelly', (m: Mob, pose: MobPose) => {
  let kind: 'drift' | 'sting' | 'dead' = 'drift';
  let f = cyc(m.t * 4 + m.id, 4);
  if (pose.anim === 'dead') {
    kind = 'dead';
    f = 0;
  } else if (pose.mode === 'windup') kind = 'sting';
  return mobFrame(`jelly|${kind}${f}`, pose, () => paintJelly(kind, f));
});

// ---------------------------------------------------------------------------
// Алая пасть: алая хищная саламандра-щука. Длинное тело, плоская голова с
// огромной пастью (горло светится), гребень шипов по спине, хвост с
// плавником, четыре коротких лапы. Под водой — только плавник-гребень и
// тёмная тень с «усами» волны.
// ---------------------------------------------------------------------------

const MAW = {
  body: ramp('#34060e', '#6e0e18', '#a2202a', '#d8483e'),
  belly: ramp('#6e3a36', '#a0685e', '#c89080', '#e8b8a4'),
  spine: ramp('#2a0508', '#5a0c12', '#a01e24', '#ff8a6a'),
  fin: hex('#d23a32'),
  finHi: hex('#ff9a7a'),
  tooth: hex('#f6eedc'),
  throat: hex('#ff8a3a'),
  throatHi: hex('#ffd070'),
  mouth: hex('#2a0406'),
  eye: hex('#ffb030'),
  shadow: [58, 6, 10, 150] as RGBA,
  wake: hex('#a0ece4', 210),
  foam: hex('#e0fffa', 230),
  water: hex('#1e6e78', 185),
};

interface MawPose {
  kind: 'swim' | 'rise' | 'air' | 'beach' | 'crawl' | 'surface' | 'spit' | 'roar' | 'dead';
  f: number;
}

/**
 * Тело саламандры вдоль кривой `spine` (от хвоста к голове): толщина по
 * профилю, спина — гребень, брюхо светлое. Возвращает точку головы.
 */
function mawBody(p: Px, spine: [number, number][], thick: number, frameH: number, legsF: number) {
  const line = spline(spine, 10);
  const n = line.length;
  // Толщина: хвост тонкий, к груди толще, шея чуть уже.
  const prof = (k: number) =>
    k < 0.55 ? 0.35 + (k / 0.55) * 0.65 : k < 0.8 ? 1 : 1 - (k - 0.8) * 1.2;
  // Лапы (дальние — до тела).
  const legAt = (k: number, far: boolean, s: number) => {
    const i = Math.min(n - 1, Math.floor(k * (n - 1)));
    const [x, y] = line[i];
    const r = thick * prof(k);
    const lx = x + s * 1.5;
    const ly = Math.min(frameH - 2, y + r + 2);
    p.line(x, y + r * 0.4, lx, ly, far ? MAW.body[0] : MAW.body[1]);
    p.line(x + 1, y + r * 0.4, lx + 1, ly, far ? MAW.body[0] : MAW.body[1]);
    p.set(lx + 2, ly, MAW.tooth);
  };
  if (legsF >= 0) {
    legAt(0.45, true, [1, -1, 1, -1][legsF % 4]);
    legAt(0.75, true, [-1, 1, -1, 1][legsF % 4]);
  }
  // Тело: круги по кривой, тон по высоте в сечении.
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const [x, y] = line[i];
    const r = thick * prof(k);
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++)
      for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        if (dx * dx + dy * dy > r * r) continue;
        const t = dy / r;
        const c =
          t > 0.5 ? tone(MAW.belly, 0.7 - t * 0.5) : tone(MAW.body, 0.42 - t * 0.75 - dx * 0.04);
        p.set(xx, yy, c);
      }
  }
  // Гребень шипов по спине: треугольники, выше к середине.
  for (let i = Math.floor(n * 0.12); i < Math.floor(n * 0.82); i += 3) {
    const k = i / (n - 1);
    const [x, y] = line[i];
    const r = thick * prof(k);
    const h = 1.5 + Math.sin(k * Math.PI) * 3.2;
    p.line(x, y - r, x - 1, y - r - h, MAW.spine[1]);
    p.set(x - 1, y - r - h, MAW.spine[3]);
    p.set(x, y - r - 1, MAW.spine[2]);
  }
  // Хвостовой плавник.
  const [tx, ty] = line[0];
  poly(
    p,
    [
      [tx + 3, ty - 1],
      [tx - 3, ty - 5],
      [tx - 4, ty],
      [tx - 3, ty + 4],
      [tx + 3, ty + 1],
    ],
    (x) => (x < tx - 1 ? MAW.finHi : MAW.fin),
  );
  if (legsF >= 0) {
    legAt(0.5, false, [-1, 1, -1, 1][legsF % 4]);
    legAt(0.8, false, [1, -1, 1, -1][legsF % 4]);
  }
  return line[n - 1];
}

/** Голова: плоская, с пастью; `open` 0…1, глаз сверху. */
function mawHead(p: Px, hx: number, hy: number, open: number, glow: boolean): [number, number] {
  // Череп: широкий и плоский — пасть главнее всего.
  blob(p, hx - 0.5, hy - 1.5, 7.4, 4.4, MAW.body);
  // Нижняя челюсть — тяжёлая, откидывается вниз.
  const drop = open * 5;
  poly(
    p,
    [
      [hx - 4, hy + 1],
      [hx + 7.5, hy + 1 + drop * 0.55],
      [hx + 7, hy + 3.5 + drop],
      [hx - 3, hy + 3.8],
    ],
    (x, y) => (y > hy + 2.6 + drop * 0.5 ? MAW.belly[0] : MAW.belly[1]),
  );
  if (open > 0.1) {
    // Пасть: тёмный провал, светящееся горло, зубы сверху и снизу.
    poly(
      p,
      [
        [hx - 2, hy + 0.3],
        [hx + 7, hy - 0.2],
        [hx + 7, hy + 1 + drop * 0.6],
        [hx - 2, hy + 2.2],
      ],
      MAW.mouth,
    );
    if (glow) {
      p.ell(hx - 0.5, hy + 1.2, 1.6, 1, MAW.throat);
      p.set(hx - 1, hy + 1, MAW.throatHi);
      p.set(hx, hy + 1, MAW.throatHi);
    }
    // Зубы — иглы через точку: верхние вниз, нижние вверх.
    for (let x = Math.round(hx); x <= hx + 6.5; x += 2) {
      p.set(x, hy + 0.3, MAW.tooth);
      p.set(x + 1, hy + 0.6 + drop * 0.6, MAW.tooth);
    }
  } else {
    p.line(hx - 2, hy + 1, hx + 7, hy + 1, MAW.mouth);
    for (let x = hx + 1; x <= hx + 6; x += 2) p.set(x, hy + 2, MAW.tooth);
  }
  // Ноздря, надбровье с шипом.
  p.set(hx + 6, hy - 2.5, MAW.body[0]);
  p.set(hx + 1, hy - 5, MAW.spine[2]);
  p.set(hx, hy - 6, MAW.spine[3]);
  return [Math.round(hx + 1.5), Math.round(hy - 3.2)];
}

function paintMaw(o: MawPose): Raw {
  const W = 64;
  const H = 40;
  const p = new Px(W, H);
  const g = 34; // земля
  const cx = 30;
  if (o.kind === 'swim' || o.kind === 'rise') {
    // Под водой: тёмная тень тела и гребень над водой, «усы» волны.
    const wl = g;
    const sh = o.kind === 'rise' ? 1 : 0;
    p.ell(cx, wl, 15, 3.4, [58, 6, 10, o.kind === 'rise' ? 190 : 140]);
    p.ell(cx + 10, wl, 4.5, 2.6, [70, 8, 12, 150]);
    if (o.kind === 'swim') {
      // Гребень режет воду.
      poly(
        p,
        [
          [cx - 6, wl],
          [cx - 1, wl - 7],
          [cx + 1, wl - 7.5],
          [cx + 5, wl],
        ],
        (x) => (x < cx ? MAW.spine[2] : MAW.fin),
      );
      p.line(cx - 1, wl - 7, cx + 1, wl - 7, MAW.finHi);
      p.outline(INK);
      // Волна от гребня: расходящиеся «усы» и пена.
      for (let k = 0; k < 3; k++) {
        const s = ((o.f + k) % 4) * 2;
        p.line(cx - 7 - s, wl + 1 + k, cx - 13 - s * 1.4, wl + 2 + k * 1.6, MAW.wake);
        p.line(cx - 7 - s, wl - 1 - k * 0.3, cx - 13 - s * 1.4, wl - 1 - k, MAW.wake);
      }
      p.line(cx - 6, wl, cx + 6, wl, MAW.foam);
    } else {
      // Всплывает: пузыри кругом.
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + o.f;
        const rr = 5 + ((k * 7 + o.f) % 4) * 2;
        p.set(cx + 4 + Math.cos(a) * rr * 1.5, wl + Math.sin(a) * rr * 0.5, MAW.foam);
      }
      p.ell(cx + 4, wl, 5, 1.6, MAW.wake);
    }
    void sh;
    return { p, ax: cx, ay: wl - FLY_LIFT + 1, eye: null };
  }
  if (o.kind === 'dead') {
    const spine: [number, number][] = [
      [cx - 20, g - 3],
      [cx - 8, g - 4],
      [cx + 4, g - 4],
      [cx + 12, g - 5],
    ];
    mawBody(p, spine, 5, H, -1);
    const [hx, hy] = spine[spine.length - 1];
    mawHead(p, hx + 3, hy + 1, 0.8, false);
    p.outline(INK);
    p.set(hx + 4, hy - 2, INK);
    p.set(hx + 5, hy - 3, INK);
    p.set(hx + 5, hy - 1, INK);
    p.set(hx + 6, hy - 2, INK);
    return { p, ax: cx, ay: g - FLY_LIFT, eye: null };
  }
  if (o.kind === 'surface' || o.kind === 'spit') {
    // Вынырнула у кромки: голова и грудь над водой, хвост поднят для удара.
    const wl = g;
    const tailUp = o.kind === 'surface' ? (o.f === 0 ? -12 : -2) : -4;
    const spine: [number, number][] = [
      [cx - 16, wl + tailUp],
      [cx - 12, wl - 2],
      [cx - 4, wl - 3],
      [cx + 6, wl - 6],
    ];
    mawBody(p, spine, 5, H, -1);
    const [hx, hy] = spine[spine.length - 1];
    const open = o.kind === 'spit' ? (o.f ? 1 : 0.5) : o.f ? 0.7 : 0.2;
    const eye = mawHead(p, hx + 3, hy, open, true);
    p.outline(INK);
    // Вода: срез по кромке, пена.
    for (let y = wl; y < H; y++)
      for (let x = cx - 18; x <= cx + 16; x++) {
        const dx = (x + 0.5 - cx) / 17;
        const dy = (y - wl + 0.5) / 5;
        if (dx * dx + dy * dy > 1) continue;
        p.set(x, y, y === wl ? MAW.foam : (x * 3 + y) % 7 === 0 ? MAW.wake : MAW.water);
      }
    if (o.kind === 'surface' && o.f === 1)
      for (let k = 0; k < 8; k++)
        p.set(cx - 16 + ((k * 5) % 9) - 4, wl - 3 - (k % 4) * 2, MAW.foam);
    p.set(eye[0], eye[1], MAW.eye);
    return { p, ax: cx, ay: wl - FLY_LIFT + 1, eye };
  }
  if (o.kind === 'air') {
    // Прыжок: тело дугой, пасть нараспашку, лапы поджаты.
    const up = o.f === 0;
    const spine: [number, number][] = up
      ? [
          [cx - 18, g - 2],
          [cx - 10, g - 9],
          [cx, g - 13],
          [cx + 10, g - 16],
        ]
      : [
          [cx - 18, g - 16],
          [cx - 8, g - 14],
          [cx + 2, g - 10],
          [cx + 10, g - 4],
        ];
    mawBody(p, spine, 5, H, -1);
    const [hx, hy] = spine[spine.length - 1];
    const eye = mawHead(p, hx + 3, hy, 1, true);
    p.outline(INK);
    p.set(eye[0], eye[1], MAW.eye);
    return { p, ax: cx, ay: g - FLY_LIFT, eye };
  }
  // На берегу: лежит, бьёт хвостом; ползёт — лапы шагают; ревёт — пасть
  // вверх, горло горит.
  const f = o.f;
  const crawl = o.kind === 'crawl';
  const roar = o.kind === 'roar';
  const tw = [0, 3, 0, -3][f % 4];
  const spine: [number, number][] = roar
    ? [
        [cx - 20, g - 4],
        [cx - 10, g - 5],
        [cx, g - 7],
        [cx + 8, g - 11],
      ]
    : [
        [cx - 20, g - 4 + (crawl ? 0 : tw)],
        [cx - 11, g - 5 + (crawl ? tw * 0.3 : tw * 0.4)],
        [cx - 1, g - 6],
        [cx + 9, g - 6 - (crawl ? f % 2 : 0)],
      ];
  mawBody(p, spine, 5.2, H, crawl ? f : f % 2 === 0 ? 0 : 1);
  const [hx, hy] = spine[spine.length - 1];
  const open = roar ? 1 : crawl ? 0.15 : [0.2, 0.7, 0.4, 0.9][f % 4];
  const eye = mawHead(p, hx + 3, hy, open, roar || open > 0.6);
  p.outline(INK);
  p.set(eye[0], eye[1], MAW.eye);
  return { p, ax: cx, ay: g - FLY_LIFT, eye };
}

registerMobPainter('f3_maw', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  let o: MawPose;
  if (pose.anim === 'dead') o = { kind: 'dead', f: 0 };
  else if (mode === 'swim' || mode === 'tail') o = { kind: 'swim', f: cyc(m.t * 8, 4) };
  else if (mode === 'rise')
    o = m.data.ghost ? { kind: 'rise', f: cyc(m.t * 10, 4) } : { kind: 'roar', f: 0 };
  else if (mode === 'leap') o = { kind: 'air', f: m.t < (m.data.T || 1) / 2 ? 0 : 1 };
  else if (mode === 'surface') o = { kind: 'surface', f: m.t < 0.8 ? 0 : 1 };
  else if (mode === 'spit') o = { kind: 'spit', f: m.t < 0.55 ? 0 : 1 };
  else if (mode === 'roar') o = { kind: 'roar', f: 0 };
  else if (mode === 'crawl') o = { kind: 'crawl', f: cyc(m.t * 7, 4) };
  else o = { kind: 'beach', f: cyc(m.t * (m.data.thr ? 12 : 5), 4) };
  const key = `maw|${o.kind}${o.f}`;
  const fr = mobFrame(
    key,
    o.kind === 'swim' || o.kind === 'rise' ? { ...pose, flash: false } : pose,
    () => paintMaw(o),
  );
  // В прыжке — выше земли на высоту дуги.
  const z = m.data.z || 0;
  if (!z) return fr;
  return { ...fr, ay: fr.ay + Math.round(z * TS) };
});

// ---------------------------------------------------------------------------
// Клетки района: вода, омут, озеро, мелководье, отмель, пропасть, мостки,
// водопад, светляки. Рисуются в кусок карты один раз.
//
// Главное правило этих клеток: НИКАКОГО шума по точке. Одиночные светлые
// точки на тёмном читаются звёздным небом (так было с первой сборкой и у
// подземелья раньше). Вода, дымка пропасти и рябь — от гладкого шума по
// МИРОВЫМ координатам: узор течёт через швы клеток, берега скругляются.
// ---------------------------------------------------------------------------

const WATER = {
  deep: hex('#0a2630'),
  mid: hex('#0f3a44'),
  lite: hex('#1a5660'),
  shoal: hex('#2b7478'),
  foam: hex('#a6ece2'),
  glint: hex('#c8f8f0'),
  ripple: hex('#3e8c90'),
  red: hex('#3e0c16'),
  redL: hex('#6a1622'),
  bank: hex('#16201f'),
  sand: hex('#2e3c38'),
};

/** Гладкий шум 0…1 по мировым пикселям (значения в узлах решётки `s`). */
function vnoise(x: number, y: number, s: number, seed = 0): number {
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const r = (a: number, b: number) => (hash(a, b, seed) & 1023) / 1023;
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b * v;
}

/**
 * Гладкое поле по клетке: шум считается в узлах 5×5 (через 4 точки) и
 * внутри тянется линейно. Узлы на краю — те же мировые точки, что у соседа,
 * поэтому поле непрерывно через швы, а считать его вдесятеро дешевле, чем
 * шум в каждой точке (первая сборка куска с озером стоила 31 мс).
 */
function grid(wx: number, wy: number, fn: (X: number, Y: number) => number) {
  const v = new Float32Array(25);
  for (let j = 0; j < 5; j++)
    for (let i = 0; i < 5; i++) v[j * 5 + i] = fn(wx * TS + i * 4, wy * TS + j * 4);
  return (x: number, y: number) => {
    const gx = x / 4;
    const gy = y / 4;
    const i = Math.min(3, Math.floor(gx));
    const j = Math.min(3, Math.floor(gy));
    const fx = gx - i;
    const fy = gy - j;
    const a = v[j * 5 + i] * (1 - fx) + v[j * 5 + i + 1] * fx;
    const b = v[(j + 1) * 5 + i] * (1 - fx) + v[(j + 1) * 5 + i + 1] * fx;
    return a * (1 - fy) + b * fy;
  };
}

export const cells = new Map<string, Px>();

function cellCached(key: string, make: () => Px): Px {
  let p = cells.get(key);
  if (!p) {
    p = make();
    cells.set(key, p);
  }
  return p;
}

const isWaterMark = (mk: number) =>
  mk === F3_MARK.water || mk === F3_MARK.pool || mk === F3_MARK.lake;

/**
 * Суша вокруг клетки воды: 8 соседей. Суша у воды скругляет углы — пиксель в
 * углу, где обе стороны суша, тоже суша (радиус 5).
 */
function shoreOf(c: CellCtx, water: (dx: number, dy: number) => boolean) {
  const n: boolean[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n.push(!water(dx, dy));
  const at = (dx: number, dy: number) => n[(dy + 1) * 3 + dx + 1];
  // Прямоугольники суши вокруг — один раз на клетку.
  const rects: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(dx, dy)) rects.push(dx * TS, dy * TS);
  const R = 5;
  const corners: number[] = [];
  if (at(0, -1) && at(-1, 0)) corners.push(0, 0, 1, 1);
  if (at(0, -1) && at(1, 0)) corners.push(TS, 0, -1, 1);
  if (at(0, 1) && at(-1, 0)) corners.push(0, TS, 1, -1);
  if (at(0, 1) && at(1, 0)) corners.push(TS, TS, -1, -1);
  /** Расстояние от пикселя до суши в пикселях (до 8). */
  const dist = (x: number, y: number) => {
    let d2 = 64;
    const px = x + 0.5;
    const py = y + 0.5;
    for (let i = 0; i < rects.length; i += 2) {
      const x0 = rects[i];
      const y0 = rects[i + 1];
      const qx = px < x0 ? x0 : px > x0 + TS ? x0 + TS : px;
      const qy = py < y0 ? y0 : py > y0 + TS ? y0 + TS : py;
      const e = (px - qx) * (px - qx) + (py - qy) * (py - qy);
      if (e < d2) d2 = e;
    }
    let d = Math.sqrt(d2);
    // Скругление вогнутых углов воды: суша по двум сторонам — угол суши.
    for (let i = 0; i < corners.length; i += 4) {
      const cx = corners[i];
      const cy = corners[i + 1];
      if (Math.abs(cx - px) > R || Math.abs(cy - py) > R) continue;
      const kx = cx + corners[i + 2] * R;
      const ky = cy + corners[i + 3] * R;
      const r = Math.sqrt((px - kx) * (px - kx) + (py - ky) * (py - ky));
      const e = R - r;
      if (e < d) d = e < 0 ? 0 : e;
    }
    return d;
  };
  return { at, dist };
}

// Уровень воды — гладкое поле по всей карте: у клетки глубины 1, у
// мелководья 0,5, у суши 0; в пикселе — билинейно между центрами соседних
// клеток. Берег по такому полю идёт наискось, а не лесенкой по клеткам, и
// сходится на швах: соседние клетки считают одно и то же число. Вода и
// мелководье красятся ОДНОЙ функцией уровня — поэтому шва между ними нет.
const GROUND: RGBA = [44, 54, 62, 255];
const SHOAL_LO = 0.38;
const SHOAL_HI = 0.7;
const SHOAL_TEAL = hex('#1e6a70');

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function levelOf(mk: number, flood: boolean): number {
  if (isWaterMark(mk) || mk === F3_MARK.bridgeV || mk === F3_MARK.bridgeH) return 1;
  if (mk === F3_MARK.tide) return flood ? 1 : 0;
  return mk === F3_MARK.shallow ? 0.5 : 0;
}

/** Уровень в пикселе клетки. Стена берёт уровень самой клетки. */
function levelField(c: CellCtx, self: number, flood: boolean) {
  const v = new Float32Array(9);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      v[(dy + 1) * 3 + dx + 1] =
        !dx && !dy ? self : c.open(dx, dy) ? levelOf(c.markAt(dx, dy), flood) : self;
  const gE = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y, 9, 5));
  return (x: number, y: number) => {
    const u = (x + 0.5) / TS - 0.5;
    const w = (y + 0.5) / TS - 0.5;
    const ix = u < 0 ? 0 : 1;
    const iy = w < 0 ? 0 : 1;
    const tx = u < 0 ? u + 1 : u;
    const ty = w < 0 ? w + 1 : w;
    const a = v[iy * 3 + ix] * (1 - tx) + v[iy * 3 + ix + 1] * tx;
    const b = v[(iy + 1) * 3 + ix] * (1 - tx) + v[(iy + 1) * 3 + ix + 1] * tx;
    const f = a * (1 - ty) + b * ty;
    // Сухой край неровный: у низкого уровня порог гуляет по шуму.
    return f + (gE(x, y) - 0.5) * 0.16 * clamp01((0.62 - f) / 0.12);
  };
}

/** Мелко у берега — светлее (уровень ниже 0,95). */
function shoalTint(col: RGBA, f: number): RGBA {
  const s = clamp01((0.95 - f) / 0.25);
  return s > 0 ? mix(col, WATER.shoal, 0.7 * s) : col;
}

/** Мелководье поверх пола: цвет и непрозрачность по уровню, null — сухо. */
function shoalOver(f: number, n: number): RGBA | null {
  if (f < SHOAL_LO - 0.05) return null;
  const t = clamp01((f - SHOAL_LO) / (SHOAL_HI - SHOAL_LO));
  const edge = clamp01((f - (SHOAL_LO - 0.05)) / 0.05);
  const deepCol = shoalTint(mix(WATER.deep, WATER.mid, n * 0.8), SHOAL_HI);
  const col = mix(SHOAL_TEAL, deepCol, t * t);
  col[3] = Math.round((70 + 185 * Math.pow(t, 1.6)) * edge);
  return col;
}

function over(under: RGBA, o: RGBA): RGBA {
  const a = o[3] / 255;
  return [
    Math.round(under[0] + (o[0] - under[0]) * a),
    Math.round(under[1] + (o[1] - under[1]) * a),
    Math.round(under[2] + (o[2] - under[2]) * a),
    255,
  ];
}

/** Рябь — волнистые штрихи поперёк; фаза гуляет по гладкому шуму. */
function rippled(col: RGBA, Y: number, p: number, dash: number, k: number): RGBA {
  const wave = Math.sin(Y * 0.55 + p * 5);
  if (wave <= 0.95 || dash <= 0.56) return col;
  const out = mix(col, WATER.ripple, 0.7 * k);
  return wave > 0.985 && dash > 0.72 ? mix(out, WATER.glint, 0.55 * k) : out;
}

/** Вода: гладкая глубина, рябь линиями, пена по скруглённому берегу. */
function waterPx(c: CellCtx, kind: 'water' | 'lake' | 'flood'): Px {
  // Клетки кешируются по координатам: узор течёт через швы и нигде не
  // повторяется (воды на этаже — сотни клеток, это сотни КБ, не больше).
  return cellCached(`w|${kind}|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const sh = shoreOf(c, (dx, dy) => {
      if (!dx && !dy) return true;
      const mk = c.markAt(dx, dy);
      if (isWaterMark(mk) || mk === F3_MARK.bridgeV || mk === F3_MARK.bridgeH) return true;
      if (mk === F3_MARK.shallow) return true;
      return mk === F3_MARK.tide && kind === 'flood';
    });
    const lv = levelField(c, 1, kind === 'flood');
    const wallN = !c.open(0, -1);
    const deepInside = !sh.at(0, -1) && !sh.at(0, 1) && !sh.at(-1, 0) && !sh.at(1, 0);
    const gN = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y, 11, 3));
    const gR = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y, 19, 7));
    const gP = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y * 0.5, 30, 11));
    const gD = grid(c.wx, c.wy, (X, Y) => vnoise(X * 0.7, Y * 1.3, 6, 12));
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = c.wx * TS + x;
        const Y = c.wy * TS + y;
        const d = sh.dist(x, y);
        if (d <= 0.01) {
          // Скруглённый угол берега — мокрый камень.
          p.set(x, y, WATER.bank);
          continue;
        }
        const n = gN(x, y);
        const f = lv(x, y);
        let col: RGBA;
        if (f < SHOAL_HI) {
          // Угол у мелководья: та же отмель, что в соседней клетке.
          const o = shoalOver(f, n);
          col = o ? over(GROUND, o) : GROUND;
        } else {
          col = mix(WATER.deep, WATER.mid, n * 0.8);
          if (kind === 'lake' && deepInside) {
            // Алое озеро: из глубины красным светится.
            const r = gR(x, y);
            col = mix(col, r > 0.5 ? WATER.redL : WATER.red, Math.max(0, r - 0.25) * 0.9);
          }
          if (kind === 'flood') col = mix(WATER.lite, WATER.shoal, n);
          col = shoalTint(col, f);
        }
        col = rippled(col, Y, gP(x, y), gD(x, y), 1);
        if (d < 1.4) col = WATER.foam;
        else if (d < 2.2 && (X + Y) % 3 === 0) col = mix(col, WATER.foam, 0.6);
        p.set(x, y, col);
      }
    if (wallN || (sh.at(0, -1) && !c.open(0, -1))) {
      // Под стеной — тень стены в воде.
      for (let x = 0; x < TS; x++)
        for (let y = 0; y < 3; y++) p.set(x, y, mix(WATER.deep, [0, 0, 0, 255], 0.6 - y * 0.2));
    } else if (sh.at(0, -1)) {
      // Откос берега: суша на севере обрывается в воду каменной кромкой.
      for (let x = 0; x < TS; x++) {
        const h = 2 + (vnoise(c.wx * TS + x, c.wy, 5, 2) > 0.5 ? 1 : 0);
        for (let y = 0; y < h; y++) p.set(x, y, mix(P.stone, WATER.bank, y / h));
        p.set(x, h, WATER.foam);
      }
    }
    return p;
  });
}

/** Мелководье поверх пола: вода по щиколотку, пол виден, края тают. */
function shallowPx(c: CellCtx): Px {
  return cellCached(`s|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const lv = levelField(c, 0.5, false);
    const gN = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y, 11, 3));
    const gP = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y * 0.5, 30, 11));
    const gD = grid(c.wx, c.wy, (X, Y) => vnoise(X * 0.7, Y * 1.3, 6, 12));
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const X = c.wx * TS + x;
        const Y = c.wy * TS + y;
        const f = lv(x, y);
        const n = gN(x, y);
        if (f >= SHOAL_HI) {
          // Глубь заходит в клетку наискось — красим, как вода рядом.
          p.set(
            x,
            y,
            rippled(shoalTint(mix(WATER.deep, WATER.mid, n * 0.8), f), Y, gP(x, y), gD(x, y), 1),
          );
          continue;
        }
        let col = shoalOver(f, n);
        if (!col) continue;
        const a = col[3];
        col = rippled(col, Y, gP(x, y), gD(x, y), 0.6);
        col[3] = a;
        // Кромка воды — редкими штрихами пены по линии уреза.
        if (f < SHOAL_LO + 0.05 && f > SHOAL_LO - 0.02 && vnoise(X * 1.3, Y * 1.3, 4, 19) > 0.55)
          col = [WATER.foam[0], WATER.foam[1], WATER.foam[2], 170];
        p.set(x, y, col);
      }
    return p;
  });
}

/** Сухая отмель арены: мокрый песок и ракушки; кромка — старая линия прибоя. */
function tidePx(c: CellCtx): Px {
  return cellCached(`t|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const wetN = (dx: number, dy: number) => {
      const mk = c.markAt(dx, dy);
      return mk === F3_MARK.tide || isWaterMark(mk) || !c.open(dx, dy);
    };
    const sh = shoreOf(c, wetN);
    const gT = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y, 7, 17));
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = sh.dist(x, y);
        const n = gT(x, y);
        let col: RGBA = [18, 48, 54, Math.round(80 + n * 60)];
        if (d > 0.5 && d < 1.6) col = [150, 200, 190, 120];
        p.set(x, y, col);
      }
    const r = hash(c.wx, c.wy, 5);
    if (r % 3 === 0) {
      const x = 3 + (r % 9);
      const y = 4 + ((r >> 4) % 8);
      p.set(x, y, hex('#e8dccc'));
      p.set(x + 1, y, hex('#b8a894'));
      p.set(x, y + 1, hex('#8a7c6c'));
    }
    return p;
  });
}

/** Пропасть: гладкая дымка глубины; под сушей на севере — отвесная стена. */
function abyssPx(c: CellCtx): Px {
  return cellCached(`a|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    const ab = (dx: number, dy: number) =>
      c.markAt(dx, dy) === F3_MARK.abyss ||
      c.markAt(dx, dy) === F3_MARK.bridgeV ||
      c.markAt(dx, dy) === F3_MARK.bridgeH;
    const land = (dx: number, dy: number) => c.open(dx, dy) && !ab(dx, dy);
    const void0 = hex('#020409');
    const fogC = hex('#0c2632');
    const gF = grid(c.wx, c.wy, (X, Y) => vnoise(X, Y, 23, 21) * 0.6 + vnoise(X, Y, 9, 22) * 0.4);
    const gW = grid(c.wx, c.wy, (X, Y) => vnoise(X * 0.35, Y * 2, 12, 23));
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const f = gF(x, y);
        let col = mix(void0, fogC, Math.max(0, f - 0.35) * 1.3);
        // Пологие полосы тумана поперёк — мягко, без точек.
        const w = gW(x, y);
        if (w > 0.6) col = mix(col, hex('#163a48'), (w - 0.6) * 1.2);
        p.set(x, y, col);
      }
    const n = land(0, -1) || !c.open(0, -1);
    if (n) {
      // Отвесная стена обрыва: камень темнеет вниз, в дымку.
      for (let x = 0; x < TS; x++) {
        const h = 6 + Math.round(vnoise(c.wx * TS + x, c.wy, 4, 2) * 5);
        for (let y = 0; y < h; y++) {
          const k = y / h;
          const band = (x + Math.floor(y / 3) * 2 + c.wx * 3) % 7 === 0;
          p.set(x, y, mix(band ? P.stoneLight : P.stone, void0, k * 0.95));
        }
        p.set(x, 0, P.rim);
      }
    }
    // Кромка сбоку — край скалы виден светлой ниткой.
    const lip = mix(P.rim, void0, 0.45);
    if (land(-1, 0)) for (let y = 0; y < TS; y++) p.set(0, y, lip);
    if (land(1, 0)) for (let y = 0; y < TS; y++) p.set(TS - 1, y, lip);
    return p;
  });
}

/** Мостки: доски поперёк хода, верёвки только по наружным краям. */
function bridgePx(c: CellCtx, vertical: boolean): Px {
  const same = vertical ? F3_MARK.bridgeV : F3_MARK.bridgeH;
  const lo = vertical ? c.markAt(-1, 0) === same : c.markAt(0, -1) === same;
  const hi = vertical ? c.markAt(1, 0) === same : c.markAt(0, 1) === same;
  const waterUnder = [c.markAt(-1, 0), c.markAt(1, 0), c.markAt(0, -1), c.markAt(0, 1)].some((m) =>
    isWaterMark(m),
  );
  return cellCached(`b|${vertical ? 1 : 0}|${c.wx}|${c.wy}|${lo ? 1 : 0}${hi ? 1 : 0}`, () => {
    const p = new Px(TS, TS);
    const under = waterUnder ? WATER.deep : hex('#020409');
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) p.set(x, y, under);
    // Доски: по 3 точки, щель в точку; доска общая на всю ширину мостков.
    const along = vertical ? c.wy : c.wx;
    for (let k = 0; k < 4; k++) {
      const idx = along * 4 + k;
      const h = hash(idx, 7, 41);
      if (h % 29 === 0) continue; // выпавшая доска: видно пустоту
      const base = [P.wood, mix(P.wood, P.woodLight, 0.4), P.wood, mix(P.wood, P.woodDark, 0.3)][
        h % 4
      ];
      for (let t = k * 4; t < k * 4 + 3; t++)
        for (let q = 0; q < TS; q++) {
          const shade = t === k * 4 ? mix(base, WHITE, 0.12) : t === k * 4 + 2 ? P.woodDark : base;
          const inner = (lo ? q : q - 1) >= 0 && (hi ? q : q + 1) < TS;
          if (!inner) continue;
          if (vertical) p.set(q, t, shade);
          else p.set(t, q, shade);
        }
      // Гвозди у краёв доски.
      const nail = (q: number) => p.set(vertical ? q : k * 4 + 1, vertical ? k * 4 + 1 : q, P.iron);
      if (!lo) nail(2);
      if (!hi) nail(TS - 3);
    }
    // Верёвки перил — только по краям мостков, с узлами.
    const rope = hex('#b89a64');
    const ropeD = hex('#7a6038');
    for (let t = 0; t < TS; t++) {
      const col = t % 4 === 0 ? ropeD : rope;
      if (!lo) p.set(vertical ? 0 : t, vertical ? t : 0, col);
      if (!hi) p.set(vertical ? TS - 1 : t, vertical ? t : TS - 1, col);
    }
    return p;
  });
}

/** Водопад по лицу стены: струи и пена у подножия. */
function fallPx(c: CellCtx): Px {
  return cellCached(`f|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    for (let x = 0; x < TS; x++)
      for (let y = 0; y < TS; y++) {
        const X = c.wx * TS + x;
        const s = vnoise(X * 3, y * 0.4, 6, 31);
        const l = vnoise(X * 2, y * 2 + X, 5, 32);
        let col: RGBA = s > 0.45 ? (l > 0.6 ? WATER.glint : WATER.foam) : WATER.shoal;
        if (s < 0.3) col = [22, 70, 78, 220];
        p.set(x, y, col);
      }
    for (let x = 0; x < TS; x++) {
      p.set(x, TS - 1, WATER.foam);
      p.set(x, TS - 2, (x + c.wx) % 2 ? WATER.foam : WATER.glint);
    }
    return p;
  });
}

/** Светляки под сводом: тусклые бирюзовые точки на полу (сама подсветка — свет). */
function glowPx(c: CellCtx): Px {
  return cellCached(`g|${c.wx}|${c.wy}`, () => {
    const p = new Px(TS, TS);
    for (let k = 0; k < 6; k++) {
      const r = hash(k, c.wx, c.wy);
      const x = 1 + (r % 14);
      const y = 1 + ((r >> 5) % 14);
      p.set(x, y, [106, 240, 224, 200]);
      p.set(x + 1, y, [106, 240, 224, 90]);
    }
    return p;
  });
}

function f3Cell(c: CellCtx): Px | null {
  const deep = c.tile === Tile.Deep;
  switch (c.mark) {
    case F3_MARK.water:
    case F3_MARK.pool:
      return waterPx(c, 'water');
    case F3_MARK.lake:
      return waterPx(c, 'lake');
    case F3_MARK.tide:
      return deep ? waterPx(c, 'flood') : tidePx(c);
    case F3_MARK.shallow:
      return shallowPx(c);
    case F3_MARK.abyss:
      return abyssPx(c);
    case F3_MARK.bridgeV:
      return bridgePx(c, true);
    case F3_MARK.bridgeH:
      return bridgePx(c, false);
    case F3_MARK.fall:
      return fallPx(c);
    case F3_MARK.glow:
      return glowPx(c);
    case F3_MARK.spring:
      return null;
    default:
      return deep ? waterPx(c, 'water') : null;
  }
}

registerCellPainter('f3rim', f3Cell);
registerCellPainter('f3depth', f3Cell);

// ---------------------------------------------------------------------------
// Предметы: друзы (свет), друза, которую бьют, родник, кости, древний столб.
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();

export function sprite(key: string, make: () => Px, ax?: number, ay?: number): Sprite {
  let s = sprites.get(key);
  if (!s) {
    const p = make();
    s = { img: p.canvas(), ax: ax ?? p.w / 2, ay: ay ?? p.h };
    sprites.set(key, s);
  }
  return s;
}

const XTAL_T = ramp('#0e5a5c', '#20a0a0', '#6ae8dc', '#e4fffa');
const XTAL_V = ramp('#3a1e78', '#7a4ad0', '#b88cff', '#f4e8ff');

/** Друза: четыре-пять призм из общего камня; блик пробегает по гребням. */
function crystalPx(r: Ramp, v: number, glint: number): Px {
  const p = new Px(16, 22);
  // Основание — камень.
  blob(p, 8, 19, 5.5, 2.4, ramp('#1e1a1c', '#3a3032', '#5a4c4c', '#7a6a66'));
  const prisms = [
    [8, 19, 13, 0.5],
    [5, 19, 8, -2.5],
    [11, 19, 9, 2.5],
    [3, 20, 4, -1.5],
    [13, 20, 5, 1.5],
  ].map(([x, y, h, l], i) => [x + ((v >> i) & 1 ? 0.3 : -0.3), y, h - ((v >> (i + 2)) & 1), l]);
  prisms.forEach(([x, y, h, lean], i) => {
    const w = i === 0 ? 2 : 1;
    for (let k = 0; k < h; k++) {
      const yy = y - k;
      const xx = x + lean * (k / h);
      for (let d = -w; d <= w; d++) {
        const c = d < 0 ? r[1] : d === 0 ? r[2] : r[1];
        p.set(xx + d, yy, k > h - 2 && Math.abs(d) === w ? null : c);
      }
      if ((k + i) % 4 === 0) p.set(xx + w, yy, r[0]);
    }
    p.set(x + lean, y - h, r[3]);
    if (glint === i) {
      p.set(x + lean, y - h + 1, WHITE);
      p.set(x + lean - 1, y - h + 2, r[3]);
    }
  });
  p.outline(INK);
  return p;
}

registerPropPainter('f3_crystal', (o: WorldObj, time: number) => {
  const v = hash(o.x, o.y) & 31;
  const g = cyc(time * 1.6 + v, 10);
  return sprite(`xt|${v}|${g}`, () => crystalPx(XTAL_T, v, g < 5 ? g : -1), 8, 21);
});

registerPropPainter('f3_crystal_v', (o: WorldObj, time: number) => {
  const v = hash(o.x, o.y) & 31;
  const g = cyc(time * 1.3 + v, 10);
  return sprite(`xv|${v}|${g}`, () => crystalPx(XTAL_V, v, g < 5 ? g : -1), 8, 21);
});

registerPropPainter('f3_druse', (o: WorldObj, time: number, _alive: boolean, flash: boolean) => {
  const v = hash(o.x, o.y) & 7;
  const g = cyc(time * 2 + v, 6);
  return sprite(
    `dr|${v}|${g}|${flash ? 1 : 0}`,
    () => {
      const p = new Px(16, 14);
      // Жеода: камень, расколотый сверху, внутри — кристаллы.
      blob(p, 8, 9, 6.5, 4.4, ramp('#2a2224', '#4a3c3a', '#6e5c56', '#94807a'));
      p.ell(8, 7.6, 4, 2.2, hex('#1a1022'));
      const r = v % 2 ? XTAL_V : XTAL_T;
      for (let k = 0; k < 5; k++) {
        const x = 5 + k * 1.5;
        const h = 2 + ((v + k) % 3);
        p.line(x, 8, x, 8 - h, r[k % 2 ? 1 : 2]);
        p.set(x, 8 - h, r[3]);
      }
      if (g < 3) p.set(6 + g * 2, 5, WHITE);
      // Трещины по камню.
      p.line(3, 10, 5, 12, hex('#1e1618'));
      p.outline(INK);
      return flash ? p.tint(WHITE, 0.8) : p;
    },
    8,
    13,
  );
});

registerPropPainter('f3_spring', (o: WorldObj, time: number) => {
  const f = cyc(time * 3 + (o.x & 3), 4);
  return sprite(
    `sp|${f}`,
    () => {
      const p = new Px(16, 10);
      // Каменная чаша с родником: бирюзовая вода светится, пузыри.
      p.ell(8, 5, 7, 3.6, hex('#3a3634'));
      p.ell(8, 4.6, 5.6, 2.6, hex('#1c6a70'));
      p.ell(8, 4.4, 4, 1.8, hex('#46c8c0'));
      const rr = 1 + f * 0.9;
      for (let a = 0; a < Math.PI * 2; a += 0.35)
        p.set(8 + Math.cos(a) * rr * 1.5, 4.4 + Math.sin(a) * rr * 0.6, hex('#c8fff4'));
      p.set(7 + (f % 2), 3, WHITE);
      p.outline(INK);
      return p;
    },
    8,
    9,
  );
});

registerPropPainter('f3_bones', (o: WorldObj) => {
  const v = hash(o.x, o.y) & 3;
  return sprite(
    `bn|${v}`,
    () => {
      const p = new Px(18, 10);
      const bone = hex('#d8ccb4');
      const boneD = hex('#9a8c74');
      // Череп.
      p.ell(4 + v, 5, 2.4, 2, bone);
      p.set(3 + v, 5, INK);
      p.set(5 + v, 5, INK);
      p.set(4 + v, 7, boneD);
      // Рёбра и кость.
      for (let k = 0; k < 3; k++) p.line(8 + k * 2, 4, 9 + k * 2, 7, k % 2 ? boneD : bone);
      p.line(8, 5, 14, 5, boneD);
      p.line(12 - v, 8, 16 - v, 7, bone);
      // Обрывок верёвки экспедиции и фонарь.
      if (v % 2) {
        p.line(1, 8, 6, 9, hex('#a88a54'));
        p.rect(14, 1, 15, 3, hex('#5a4a3a'));
        p.set(14, 2, hex('#ffcf6a'));
      }
      p.outline(INK);
      return p;
    },
    9,
    9,
  );
});

registerPropPainter('f3_pillar', (o: WorldObj, time: number) => {
  const v = hash(o.x, o.y) & 1;
  const g = cyc(time * 0.8 + o.x, 8);
  return sprite(
    `pl|${v}|${g < 4 ? g : 4}`,
    () => {
      const p = new Px(14, 30);
      const st = ramp('#2a2830', '#44404a', '#646070', '#8a8698');
      // Столб древних: обтёсан, с каймой, наверху скол.
      for (let y = 4; y < 28; y++)
        for (let x = 3; x < 11; x++) {
          const k = x < 5 ? 0 : x < 8 ? 1 : x < 10 ? 2 : 1;
          p.set(x, y, st[k]);
        }
      for (let x = 2; x < 12; x++) {
        p.set(x, 27, st[1]);
        p.set(x, 28, st[0]);
        p.set(x, 5, st[2]);
      }
      poly(
        p,
        [
          [3, 5],
          [5, 2],
          [9, 3],
          [11, 5],
        ],
        st[2],
      );
      // Руна светится бирюзой, дышит.
      const rune = g < 4 ? mix(XTAL_T[2], WHITE, g * 0.15) : XTAL_T[1];
      p.line(7, 10, 7, 20, rune);
      p.line(5, 12, 9, 16, rune);
      p.line(9, 12, 5, 16, rune);
      if (v) p.line(5, 19, 9, 19, rune);
      p.outline(INK);
      return p;
    },
    7,
    29,
  );
});

// ---------------------------------------------------------------------------
// Удары и зоны: круг приземления пасти, волна хвоста, хлёст на берегу,
// хват омутника, ледяное облако, ложный огонёк, прилив, кольцо тяги.
// ---------------------------------------------------------------------------

export const rgba = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Ледяное облако туманки: клубы, иней по краю; до срока — тонкое кольцо. */
registerZonePainter('f3_mist', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  const R = zz.r * scale;
  g.save();
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.strokeStyle = `rgba(190,245,255,${0.3 + 0.5 * k})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, R, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    return true;
  }
  const life = zz.t - warn;
  const fade = Math.max(0, Math.min(1, (zz.life - life) / 0.8, life / 0.3));
  for (let i = 0; i < 6; i++) {
    const a = time * 0.5 + i * 1.05 + zz.id;
    const r = R * (0.25 + 0.45 * ((i * 0.37 + time * 0.1) % 1));
    const rr = R * (0.35 + 0.12 * (i % 3));
    g.fillStyle = `rgba(200,245,255,${0.12 * fade})`;
    g.beginPath();
    g.arc(px + Math.cos(a) * r, py + Math.sin(a) * r * 0.6, rr, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = `rgba(230,252,255,${0.7 * fade})`;
  for (let i = 0; i < 8; i++) {
    const a = i * 0.785 + time * 0.3;
    g.fillRect(
      Math.round(px + Math.cos(a) * R * 0.9),
      Math.round(py + Math.sin(a) * R * 0.6),
      1,
      1,
    );
  }
  g.restore();
  return true;
});

/** Ложный огонёк: тёплый свет в темноте, как чужой фонарь, и тень-фигура. */
registerZonePainter('f3_lure', (g, z, px, py, _scale, time) => {
  const zz = z as Zone;
  const fade = Math.max(0, Math.min(1, zz.t / 0.5, (zz.life - zz.t) / 0.8));
  if (fade <= 0) return true;
  const fl = 0.8 + Math.sin(time * 11 + zz.id) * 0.1 + Math.sin(time * 23) * 0.06;
  g.save();
  const gr = g.createRadialGradient(px, py - 6, 0, px, py - 6, 26);
  gr.addColorStop(0, `rgba(255,214,140,${0.85 * fade * fl})`);
  gr.addColorStop(0.35, `rgba(255,170,90,${0.35 * fade * fl})`);
  gr.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = gr;
  g.fillRect(px - 26, py - 32, 52, 52);
  // Тонкая фигура «человека» в свете — силуэт, лица нет.
  g.fillStyle = `rgba(20,12,10,${0.7 * fade})`;
  g.fillRect(Math.round(px) - 1, Math.round(py) - 9, 3, 7);
  g.fillRect(Math.round(px) - 1, Math.round(py) - 11, 2, 2);
  // Огонёк в «руке».
  const bob = Math.round(Math.sin(time * 3) * 1);
  g.fillStyle = `rgba(255,230,160,${fade})`;
  g.fillRect(Math.round(px) + 2, Math.round(py) - 7 + bob, 2, 2);
  g.fillStyle = `rgba(255,255,230,${fade})`;
  g.fillRect(Math.round(px) + 2, Math.round(py) - 7 + bob, 1, 1);
  g.restore();
  return true;
});

/** Кольцо тяги у ног героя: наливается по кругу, бирюза → фиолет → алый. */
registerZonePainter('f3_curse', (g, z, px, py, _scale, time) => {
  const k = (z as Zone & F3Zone).k ?? 0;
  if (k < 0.03) return true;
  const col: RGBA =
    k < 0.4
      ? mix(hex('#5ae0d8'), hex('#a070ff'), k / 0.4)
      : k < 0.75
        ? mix(hex('#a070ff'), hex('#ff4a6a'), (k - 0.4) / 0.35)
        : hex('#ff4a6a');
  const pulse = k > 0.75 ? 0.6 + 0.4 * Math.abs(Math.sin(time * 7)) : 1;
  g.save();
  g.translate(px, py + 2);
  g.scale(1, 0.45);
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(8,4,16,0.55)';
  g.beginPath();
  g.arc(0, 0, 9, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = rgba(col, 0.9 * pulse);
  g.beginPath();
  g.arc(0, 0, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
  g.stroke();
  g.restore();
  // С сорока процентов — тяжёлые капли тянутся вниз от ног.
  if (k > 0.4) {
    g.fillStyle = rgba(col, 0.7);
    for (let i = 0; i < 3; i++) {
      const t = (time * 0.9 + i / 3) % 1;
      g.fillRect(Math.round(px - 5 + i * 5), Math.round(py + 1 + t * 5), 1, 1);
    }
  }
  return true;
});

/** Хват омутника: брызги у кромки (метку рисует движок). */
registerZonePainter('f3_grab', () => true);

// ---------------------------------------------------------------------------
// Снаряд: плевок Алой пасти — сгусток тёмной воды с бликом.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

function icon(draw: (p: Px) => void): () => Px {
  let cache: Px | null = null;
  return () => {
    if (!cache) {
      const p = new Px(10, 10);
      draw(p);
      p.outline(INK);
      cache = p;
    }
    return cache;
  };
}

registerItemArt(
  'f3_feather',
  icon((p) => {
    p.line(2, 8, 7, 1, hex('#e0dcd0'));
    for (let k = 0; k < 5; k++) {
      p.line(3 + k, 7 - k * 1.3, 2 + k, 5 - k * 1.3, MOCK.feather[2]);
      p.line(3 + k, 7 - k * 1.3, 5 + k, 7 - k * 1.3, MOCK.feather[1]);
    }
    p.set(7, 1, MOCK.pale);
  }),
);

registerItemArt(
  'f3_spine',
  icon((p) => {
    tube(
      p,
      [
        [1, 8],
        [5, 5],
        [9, 1],
      ],
      2.6,
      1,
      (k) => tone(SPEAR.bone, 0.9 - k * 0.5),
    );
  }),
);

registerItemArt(
  'f3_chitin',
  icon((p) => {
    blob(p, 5, 6, 4, 2.6, CRAB.shell);
    crystal(p, 4, 5, 4, -0.5, CRAB.xtal);
    crystal(p, 6, 5, 3, 0.5, CRAB.xtal);
  }),
);

registerItemArt(
  'f3_pearl',
  icon((p) => {
    blob(p, 5, 5, 3.4, 3.4, ramp('#7ab8c0', '#bfe4e6', '#eafcfa', '#ffffff'));
    p.set(4, 3, WHITE);
  }),
);

registerItemArt(
  'f3_fang',
  icon((p) => {
    poly(
      p,
      [
        [2, 2],
        [7, 2],
        [5, 9],
      ],
      (x) => (x < 5 ? MAW.tooth : hex('#d8cfb8')),
    );
    p.rect(2, 1, 7, 2, MAW.body[1]);
    p.set(3, 1, MAW.body[3]);
  }),
);

registerItemArt(
  'f3_meat',
  icon((p) => {
    p.ell(4.5, 5, 3.8, 3, hex('#8e3a30'));
    p.ell(3.6, 4, 1.4, 1, hex('#c86a58'));
    p.line(7, 7, 9, 9, hex('#e8dcc8'));
  }),
);

registerItemArt(
  'f3_fish',
  icon((p) => {
    p.ell(4.5, 5, 3.6, 2.2, hex('#4a7a78'));
    p.ell(4, 5.5, 2.6, 1, hex('#a8c8c0'));
    poly(
      p,
      [
        [8, 5],
        [10, 3],
        [10, 7],
      ],
      hex('#3a6462'),
    );
    p.set(2, 4, INK);
  }),
);

registerItemArt(
  'f3_crabmeat',
  icon((p) => {
    p.ell(5, 5.5, 4, 3, CRAB.shell[1]);
    p.ell(5, 5, 2.6, 1.8, hex('#f0d8d0'));
    p.set(4, 4, WHITE);
  }),
);
