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
  frameLRU,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
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
// Мобы этажа (анимации мобов 3): риг, ход в 8 сторон, дорожки 24 к/с.
import './f3-mobs';

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

// ---------------------------------------------------------------------------
// Алая пасть: алая хищная саламандра-щука. Длинное тело, плоская голова с
// огромной пастью (горло светится), гребень шипов по спине, хвост с
// плавником, четыре коротких лапы. Под водой — тёмный силуэт и гребень,
// режущий воду.
//
// Анимация (v2.85) — риг, а не набор картинок. Поза — горсть чисел
// (`MawRig`): центр тела, наклон, изгибы шеи и хвоста, голова, челюсть,
// горловой мешок, жабры, гребень, лапы, погружение. Техника — дорожка
// ключевых поз по времени режима (`pose.t`, 24 к/с), промежуточные позы —
// интерполяцией с разгоном и торможением. Тело рисуется из позы (сплайн
// позвоночника, голова в своих осях), поэтому любой изгиб ложится целыми
// пикселями, без поворота картинки. Общий ход (прыжок, отдача, вес) —
// трансформом кадра (`dx/dy/sx/sy`), свечение глотки — слоем `lit`.
//
// Метроном — `mawStep` в `f3-brains.ts` (тайминги НЕ трогаем):
//   surface 1,55/h, волна бьёт в 0,85/h — кадр удара 20 (от t·h);
//   spit    замах 0,6/h, плевок, ещё 0,5 с;
//   rise    0,5/h (0,34/h в «Голоде») → leap T = 0,74 + d/16 (0,66 + d/18),
//           удар приземления — ровно в конце полёта (кадр 0 «на берегу»);
//   beached с прилива хлёст хвостом: метка с 0,75 с, удар в 1,30 с;
//   crawl / swim / tail — циклы; roar 1,3 с; dying 0,7 с (+ `linger`).
// h — спешка 1,25 после 200 с боя. Кадр контакта = кадр урона.
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
  gillIn: hex('#ff6a5a'),
  wake: hex('#a0ece4', 210),
  sacHot: hex('#ffd070', 200),
  sacGlow: hex('#ff7a2a', 130),
  ember: hex('#ff7a50', 200),
  foam: hex('#e0fffa', 230),
  spit: hex('#5ad0cc'),
  spitDk: hex('#1c6a74'),
};

/** Поза рига. Всё — числа: промежуточная поза — интерполяция. */
interface MawRig {
  /** Центр тела (грудь) от точки ног, пиксели кадра. */
  cx: number;
  cy: number;
  /** Наклон тела, рад: + нос вверх. */
  p: number;
  /** Изгиб шеи и хвоста по звеньям, рад: + вверх (к спине). */
  fw1: number;
  fw2: number;
  bk1: number;
  bk2: number;
  bk3: number;
  /** Голова относительно шеи: + нос вверх. */
  hd: number;
  /** Челюсть 0…1 (чуть больше — на ударе). */
  jaw: number;
  /** Горловой мешок 0…1 — набор воздуха перед плевком. */
  throat: number;
  /** Жар в глотке 0…1 (слой поверх темноты). */
  glow: number;
  /** Жабры 0…1. */
  gill: number;
  /** Гребень: 0,6 прижат, 1 как есть, 1,5 дыбом; `crestRun` — волна от головы. */
  crest: number;
  crestRun: number;
  /** Перепонка между шипами — парус над водой. */
  sail: number;
  /** Хвостовой плавник: угол к хвосту и размах. */
  fin: number;
  finS: number;
  /** Лапы: фаза шага, ход шага, поджаты, вперёд когтями, врастопырку, бьют. */
  walk: number;
  step: number;
  tuck: number;
  reach: number;
  splay: number;
  kick: number;
  /** Глаз: 0 открыт, 1 прищур, 2 закрыт, 3 мёртв. */
  eye: number;
  /** На сколько пикселей тело ниже кромки воды. */
  sink: number;
}

const REST: MawRig = {
  cx: -2,
  cy: -6,
  p: 0,
  fw1: 0,
  fw2: 0,
  bk1: -0.06,
  bk2: -0.05,
  bk3: -0.04,
  hd: 0,
  jaw: 0.15,
  throat: 0,
  glow: 0,
  gill: 0.15,
  crest: 1,
  crestRun: 1,
  sail: 0,
  fin: 0,
  finS: 1,
  walk: 0,
  step: 0,
  tuck: 0,
  reach: 0,
  splay: 0,
  kick: 0,
  eye: 0,
  sink: 0,
};
const RIG_KEYS = Object.keys(REST) as (keyof MawRig)[];

type Ease = (x: number) => number;
const EZ = {
  lin: (x: number) => x,
  /** Разгон — замах, падение. */
  in: (x: number) => x * x,
  in3: (x: number) => x * x * x,
  /** Торможение — удар, выход из рывка. */
  out: (x: number) => 1 - (1 - x) * (1 - x) * (1 - x),
  out2: (x: number) => 1 - (1 - x) * (1 - x),
  io: (x: number) => x * x * (3 - 2 * x),
  /** С перелётом за цель. */
  back: (x: number) => {
    const y = x - 1;
    return 1 + 2.4 * y * y * y + 1.4 * y * y;
  },
};

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const F = (n: number) => n / 24;

type Key<T> = [number, Partial<T>, Ease?];

/**
 * Дорожка ключей: каждая следующая поза — предыдущая плюс изменения.
 * Возвращает функцию времени; ключи — по возрастанию.
 */
function lane<T extends object>(base: T, keys: Key<T>[]): (x: number) => T {
  const ts: number[] = [];
  const rs: T[] = [];
  const es: Ease[] = [];
  let cur = base;
  for (const [t, part, e] of keys) {
    cur = { ...cur, ...part };
    ts.push(t);
    rs.push(cur);
    es.push(e ?? EZ.io);
  }
  const names = Object.keys(base) as (keyof T)[];
  return (x: number) => {
    if (x <= ts[0]) return rs[0];
    for (let i = 1; i < ts.length; i++) {
      if (x > ts[i]) continue;
      const k = es[i]((x - ts[i - 1]) / Math.max(1e-6, ts[i] - ts[i - 1]));
      const a = rs[i - 1];
      const b = rs[i];
      const o = { ...a };
      for (const n of names) {
        const va = a[n] as unknown as number;
        const vb = b[n] as unknown as number;
        (o[n] as unknown as number) = va + (vb - va) * k;
      }
      return o;
    }
    return rs[rs.length - 1];
  };
}

function mixRig(a: MawRig, b: MawRig, k: number): MawRig {
  const o = { ...a };
  for (const n of RIG_KEYS) o[n] = a[n] + (b[n] - a[n]) * k;
  return o;
}

// ---- Геометрия ------------------------------------------------------------

/** Рабочий холст: с запасом под прыжок, дыбу и след хвоста кругом. */
const MW = 112;
const MH = 108;
const GX = 56;
const GY = 70;
const L_B = 6;
const L_F = 5.5;
const THICK = 5.2;

type V2 = [number, number];
const step2 = (p: V2, a: number, l: number): V2 => [p[0] + Math.cos(a) * l, p[1] + Math.sin(a) * l];

/** Толщина: хвост тонкий, к груди толще, шея чуть уже. */
const prof = (k: number) =>
  k < 0.55 ? 0.35 + (k / 0.55) * 0.65 : k < 0.8 ? 1 : 1 - (k - 0.8) * 1.2;

interface MawGeo {
  line: V2[];
  rad: number[];
  tan: V2[];
  hinge: V2;
  ha: number;
  /** Брюхо — в сторону +нормали (запас на переворот). */
  flip: number;
}

function mawGeo(r: MawRig): MawGeo {
  const a0 = -r.p;
  const C: V2 = [GX + r.cx, GY + r.cy + r.sink];
  const af1 = a0 - r.fw1;
  const af2 = af1 - r.fw2;
  const F1 = step2(C, af1, L_F);
  const F2 = step2(F1, af2, L_F);
  const ab1 = a0 + Math.PI + r.bk1;
  const ab2 = ab1 + r.bk2;
  const ab3 = ab2 + r.bk3;
  const B1 = step2(C, ab1, L_B);
  const B2 = step2(B1, ab2, L_B);
  const B3 = step2(B2, ab3, L_B);
  const line = spline([B3, B2, B1, C, F1, F2], 10) as V2[];
  const n = line.length;
  const rad = line.map((_, i) => THICK * prof(i / (n - 1)));
  const tan = line.map((_, i): V2 => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  });
  const ha = af2 - r.hd;
  return { line, rad, tan, hinge: step2(F2, ha, 3), ha, flip: 1 };
}

/** Нормаль к брюху в точке оси. */
const belly = (g: MawGeo, i: number): V2 => [-g.tan[i][1] * g.flip, g.tan[i][0] * g.flip];

/** Точка в многоугольнике (чёт-нечет). */
function inPoly(pts: V2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// ---- Кисти рига -------------------------------------------------------------

const TUBE_BEST = new Float32Array(MW * MH);
const TUBE_OWN = new Int16Array(MW * MH);
let WORK: Px | null = null;
let WLIT: Px | null = null;

/** Тело — трубка по оси: пиксель принадлежит тому звену, в котором он глубже. */
function mawTube(p: Px, g: MawGeo): void {
  const { line, rad } = g;
  const W = p.w;
  const H = p.h;
  const best = TUBE_BEST;
  const own = TUBE_OWN;
  best.fill(-1);
  let x0 = W;
  let x1 = 0;
  let y0 = H;
  let y1 = 0;
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i];
    const r = rad[i];
    const ya = Math.max(0, Math.floor(y - r));
    const yb = Math.min(H - 1, Math.ceil(y + r));
    const xa = Math.max(0, Math.floor(x - r));
    const xb = Math.min(W - 1, Math.ceil(x + r));
    for (let yy = ya; yy <= yb; yy++)
      for (let xx = xa; xx <= xb; xx++) {
        const dx = xx + 0.5 - x;
        const dy = yy + 0.5 - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) continue;
        const dep = 1 - Math.sqrt(d2) / r;
        const k = yy * W + xx;
        if (dep > best[k]) {
          best[k] = dep;
          own[k] = i;
        }
      }
    x0 = Math.min(x0, xa);
    x1 = Math.max(x1, xb);
    y0 = Math.min(y0, ya);
    y1 = Math.max(y1, yb);
  }
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const k = yy * W + xx;
      if (best[k] < 0) continue;
      const i = own[k];
      const [sx, sy] = line[i];
      const [nx, ny] = belly(g, i);
      const dx = xx + 0.5 - sx;
      const dy = yy + 0.5 - sy;
      const s = clamp((dx * nx + dy * ny) / rad[i], -1, 1);
      // Свет сверху-слева: на прямом теле — ровно прежняя формула.
      const c =
        s > 0.5
          ? tone(MAW.belly, 0.7 - s * 0.5)
          : tone(MAW.body, 0.42 + s * (nx * -0.45 + ny * -0.75) - dx * 0.04);
      p.set(xx, yy, c);
    }
}

/** Гребень шипов по спине; `sail` — перепонка (парус над водой). Кончики — наружу. */
function mawCrest(p: Px, g: MawGeo, r: MawRig): V2[] {
  const n = g.line.length;
  const spikes: { b: V2; t: V2 }[] = [];
  for (let i = Math.floor(n * 0.12); i < Math.floor(n * 0.82); i += 3) {
    const k = i / (n - 1);
    const [x, y] = g.line[i];
    const [tx, ty] = g.tan[i];
    const [nx, ny] = belly(g, i);
    const rr = g.rad[i];
    const run = clamp((r.crestRun - (1 - k)) * 3, 0, 1);
    const cr = 1 + (r.crest - 1) * run;
    const h = (1.5 + Math.sin(k * Math.PI) * 3.2) * (0.35 + 0.65 * cr);
    const lean = clamp(1 + (1 - cr) * 2.5, -0.4, 3);
    const b: V2 = [x - nx * rr, y - ny * rr];
    spikes.push({ b, t: [b[0] - nx * h - tx * lean, b[1] - ny * h - ty * lean] });
  }
  if (r.sail > 0.05)
    for (let j = 0; j + 1 < spikes.length; j++) {
      const a = spikes[j];
      const c = spikes[j + 1];
      const m = spikes.length - 1;
      const ka = r.sail * (0.35 + 0.65 * Math.sin((j / m) * Math.PI));
      const kc = r.sail * (0.35 + 0.65 * Math.sin(((j + 1) / m) * Math.PI));
      const lerp = (u: V2, v: V2, k: number): V2 => [
        u[0] + (v[0] - u[0]) * k,
        u[1] + (v[1] - u[1]) * k,
      ];
      poly(p, [a.b, lerp(a.b, a.t, ka), lerp(c.b, c.t, kc), c.b], (x, y) =>
        y < Math.min(a.t[1], c.t[1]) + 1.5 ? MAW.finHi : MAW.fin,
      );
    }
  for (const { b, t } of spikes) {
    p.line(b[0], b[1], t[0], t[1], MAW.spine[1]);
    p.set(t[0], t[1], MAW.spine[3]);
    const [dx, dy] = [t[0] - b[0], t[1] - b[1]];
    const l = Math.hypot(dx, dy) || 1;
    p.set(b[0] + dx / l, b[1] + dy / l, MAW.spine[2]);
  }
  return spikes.map((q) => q.t);
}

/** Хвостовой плавник по касательной к хвосту. */
function mawFin(p: Px, g: MawGeo, r: MawRig): void {
  const [tx, ty] = g.line[0];
  const a = Math.atan2(g.tan[0][1], g.tan[0][0]) + r.fin * g.flip;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const vx = -uy * g.flip;
  const vy = ux * g.flip;
  const s = r.finS;
  const pt = (u: number, v: number): V2 => [tx + (u * ux + v * s * vx), ty + (u * uy + v * s * vy)];
  poly(p, [pt(3, -1), pt(-3 * s, -5), pt(-4 * s, 0), pt(-3 * s, 4), pt(3, 1)], (x, y) =>
    (x + 0.5 - tx) * ux + (y + 0.5 - ty) * uy < -1 ? MAW.finHi : MAW.fin,
  );
}

/** Лапы: дальние — до тела, ближние — после. */
function mawLegs(p: Px, g: MawGeo, r: MawRig, far: boolean): void {
  const n = g.line.length;
  const legs: [number, number, boolean][] = far
    ? [
        [0.47, 0, true],
        [0.76, 0.5, false],
      ]
    : [
        [0.52, 0.5, true],
        [0.81, 0, false],
      ];
  const col = far ? MAW.body[0] : MAW.body[1];
  for (const [k, off, hind] of legs) {
    const i = Math.round(k * (n - 1));
    const [x, y] = g.line[i];
    const [tx, ty] = g.tan[i];
    const [nx, ny] = belly(g, i);
    const rr = g.rad[i];
    const hip: V2 = [x + nx * rr * 0.4, y + ny * rr * 0.4];
    const ph = (r.walk + off) * Math.PI * 2;
    let foot: V2;
    {
      const plant: V2 = [
        hip[0] + (hind ? -0.6 : 0.8) + Math.cos(ph) * r.step * 1.8 + (hind ? -2 : 2) * r.splay,
        Math.min(GY + 1, hip[1] + rr * 0.6 + 2.2) -
          Math.max(0, Math.sin(ph)) * r.step * 1.5 -
          r.splay * 1.2 -
          r.kick * (1.4 + Math.sin(ph) * 1.4),
      ];
      plant[0] += Math.cos(ph) * r.kick * 1.4;
      const tuck: V2 = [hip[0] - tx * 4.5 + nx * 1.2, hip[1] - ty * 4.5 + ny * 1.2];
      const reach: V2 = [hip[0] + tx * 4 + nx * 2.8, hip[1] + ty * 4 + ny * 2.8];
      const wt = clamp(r.tuck, 0, 1);
      const wr = clamp(r.reach, 0, 1);
      const w0 = Math.max(0, 1 - wt - wr);
      const sum = w0 + wt + wr || 1;
      foot = [
        (plant[0] * w0 + tuck[0] * wt + reach[0] * wr) / sum,
        (plant[1] * w0 + tuck[1] * wt + reach[1] * wr) / sum,
      ];
    }
    p.line(hip[0], hip[1], foot[0], foot[1], col);
    p.line(hip[0] + 1, hip[1], foot[0] + 1, foot[1], col);
    p.set(foot[0] + 2, foot[1], MAW.tooth);
  }
}

interface MawHead {
  /** Точка головы (u — вперёд по голове, v — вниз) в пикселях кадра. */
  at: (u: number, v: number) => V2;
  /** То же для нижней челюсти (поворачивается на шарнире). */
  jawAt: (u: number, v: number) => V2;
  eye: V2;
}

/** Оси головы: (u — вперёд, v — к горлу) → пиксели кадра. */
function headAt(g: MawGeo): (u: number, v: number) => V2 {
  const [hx, hy] = g.hinge;
  const ca = Math.cos(g.ha);
  const sa = Math.sin(g.ha);
  const fl = g.flip;
  return (u, v) => [hx + u * ca - v * fl * sa, hy + u * sa + v * fl * ca];
}

/** Горловой мешок под челюстью — набирает воздух перед плевком. */
function mawSac(p: Px, lit: Px, g: MawGeo, th: number): void {
  if (th < 0.04) return;
  const cu = -3.4;
  const cv = 3.0 + th * 1.8;
  const ru = 2 + th * 3.4;
  const rv = 1.2 + th * 2.8;
  const ca = Math.cos(g.ha);
  const sa = Math.sin(g.ha);
  const c = headAt(g)(cu, cv);
  const R = Math.ceil(Math.max(ru, rv)) + 1;
  const glowK = clamp((th - 0.3) / 0.7, 0, 1);
  for (let y = Math.floor(c[1] - R); y <= c[1] + R; y++)
    for (let x = Math.floor(c[0] - R); x <= c[0] + R; x++) {
      const dx = x + 0.5 - c[0];
      const dy = y + 0.5 - c[1];
      const du = (dx * ca + dy * sa) / ru;
      const dv = (-dx * sa + dy * ca) / rv;
      const d = du * du + dv * dv;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d);
      const wx = du * ca - dv * sa;
      const wy = du * sa + dv * ca;
      const k = wx * -0.45 + wy * -0.75 + nz * 0.5;
      // Натянутая кожа светлеет, внутри — жар.
      p.set(x, y, tone(MAW.belly, k + th * 0.25));
      if (glowK > 0 && d < 0.55)
        lit.set(
          x,
          y,
          d < 0.18
            ? [MAW.sacHot[0], MAW.sacHot[1], MAW.sacHot[2], 200 * glowK]
            : [MAW.sacGlow[0], MAW.sacGlow[1], MAW.sacGlow[2], 130 * glowK],
        );
    }
}

/**
 * Голова в своих осях: череп, челюсть на шарнире, пасть, зубы, ноздря,
 * бровь с шипом. На прямой голове — пиксель в пиксель прежний рисунок.
 */
function mawHead(p: Px, g: MawGeo, r: MawRig): MawHead {
  const [hx, hy] = g.hinge;
  const ca = Math.cos(g.ha);
  const sa = Math.sin(g.ha);
  const fl = g.flip;
  const at = headAt(g);
  const jawA = clamp(r.jaw, 0, 1.15) * 0.62;
  const jc = Math.cos(jawA);
  const js = Math.sin(jawA);
  const J: V2 = [-3.5, 1.3];
  const jr = (u: number, v: number): V2 => {
    const du = u - J[0];
    const dv = v - J[1];
    return [J[0] + du * jc - dv * js, J[1] + du * js + dv * jc];
  };
  const jawAt = (u: number, v: number) => at(...jr(u, v));
  const JAW: V2[] = [
    [-4, 1],
    [7.5, 1],
    [7, 3.5],
    [-3, 3.8],
  ];
  const open = r.jaw > 0.1;
  const CAV: V2[] = [[-2, 0.3], [7, -0.2], jr(7, 1), jr(-2, 1.6)];
  const R = 12;
  for (let y = Math.floor(hy - R); y <= hy + R; y++)
    for (let x = Math.floor(hx - R); x <= hx + R; x++) {
      const ox = x + 0.5 - hx;
      const oy = y + 0.5 - hy;
      const u = ox * ca + oy * sa;
      const v = (-ox * sa + oy * ca) * fl;
      // Вне черепа и челюсти — сразу дальше (дорого только многоугольникам).
      if (u < -8.6 || u > 9 || v < -6.4 || v > 11) continue;
      let c: RGBA | null = null;
      const eu = (u + 0.5) / 7.4;
      const ev = (v + 1.5) / 4.4;
      if (eu * eu + ev * ev <= 1) {
        const nz = Math.sqrt(Math.max(0, 1 - eu * eu - ev * ev));
        const wx = eu * ca - ev * fl * sa;
        const wy = eu * sa + ev * fl * ca;
        c = tone(MAW.body, wx * -0.45 + wy * -0.75 + nz * 0.5);
      }
      // Челюсть — в её осях.
      const du = u - J[0];
      const dv = v - J[1];
      const ju = J[0] + du * jc + dv * js;
      const jv = J[1] - du * js + dv * jc;
      if (ju > -4.5 && ju < 8 && jv > 0.5 && jv < 4.3 && inPoly(JAW, ju, jv))
        c = jv > 2.6 ? MAW.belly[0] : MAW.belly[1];
      if (open && u > -2.5 && u < 7.5 && v > -0.7 && inPoly(CAV, u, v)) c = MAW.mouth;
      if (c) p.set(x, y, c);
    }
  if (open) {
    if (r.glow > 0.3) {
      const c = at(-0.5, 1.2);
      p.ell(c[0], c[1], 1.6, 1, MAW.throat);
      p.set(...at(-1, 1), MAW.throatHi);
      p.set(...at(0, 1), MAW.throatHi);
    }
    // Зубы — иглы через точку: верхние вниз, нижние вверх.
    for (let u = 0; u <= 6.5; u += 2) {
      p.set(...at(u, 0.3), MAW.tooth);
      p.set(...jawAt(u + 1, 0.6), MAW.tooth);
    }
  } else {
    const a = at(-2, 1);
    const b = at(7, 1);
    p.line(a[0], a[1], b[0], b[1], MAW.mouth);
    for (let u = 1; u <= 6; u += 2) p.set(...at(u, 2), MAW.tooth);
  }
  // Ноздря, надбровье с шипом.
  p.set(...at(6, -2.5), MAW.body[0]);
  p.set(...at(1, -5), MAW.spine[2]);
  p.set(...at(0, -6), MAW.spine[3]);
  // Жабры: на вдохе за черепом раскрываются три розовые щели.
  if (r.gill > 0.45)
    for (let j = 0; j < 3; j++) {
      const u = -6.2 + j * 1.5;
      const a = at(u + 0.4, -1.6);
      const b = at(u - 0.2, 0.8);
      p.line(a[0], a[1], b[0], b[1], r.gill > 0.8 ? MAW.finHi : MAW.gillIn);
    }
  const e = at(1.5, -3.2);
  return { at, jawAt, eye: [Math.round(e[0]), Math.round(e[1])] };
}

// ---- Кадр целиком -----------------------------------------------------------

interface MawDraw {
  /** Вода по кромке GY: ниже — тёмный силуэт, по кромке — пена и рябь. */
  water?: boolean;
  /** Фаза ряби и следа 0…1 (квантованная). */
  ph?: number;
  /** След «усами» за гребнем (плывёт) — длина. */
  wake?: number;
  /**
   * След быстрого движения: позы от старой к новой (часто, по дуге) и чьи
   * точки вести — нос и челюсть или хвост и плавник. Тонкая дуга, как у
   * клинка героя, а не залитый клин.
   */
  smear?: { rigs: MawRig[]; part: 'tail' | 'front'; col: RGBA } | null;
  /** След хвоста кругом: углы начала и конца дуги (по часовой), яркость. */
  ring?: { a0: number; a1: number; k: number } | null;
  /** Ярость (смена фазы): алый ореол по силуэту. */
  rage?: number;
  /** «Голод»: кончики гребня тлеют. */
  hunger?: boolean;
}

interface MawCanvas {
  p: Px;
  lit: Px;
  g: MawGeo;
  h: MawHead;
  eye: V2 | null;
}

function smearPts(r: MawRig, part: 'tail' | 'front'): V2[] {
  const g = mawGeo(r);
  if (part === 'tail') {
    const [tx, ty] = g.line[0];
    const a = Math.atan2(g.tan[0][1], g.tan[0][0]) + r.fin;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const s = r.finS;
    const fin = (u: number, v: number): V2 => [tx + u * ux - v * s * uy, ty + u * uy + v * s * ux];
    return [fin(-3 * s, -5), fin(-4 * s, 0), fin(-3 * s, 4), g.line[6]];
  }
  const at = headAt(g);
  const jawA = clamp(r.jaw, 0, 1.15) * 0.62;
  const du = 7 + 3.5;
  const dv = 3.5 - 1.3;
  const ju = -3.5 + du * Math.cos(jawA) - dv * Math.sin(jawA);
  const jv = 1.3 + du * Math.sin(jawA) + dv * Math.cos(jawA);
  return [at(7.5, -1.8), at(5, -4.5), at(ju, jv)];
}

/** Контур снаружи — как `Px.outline`, но только в рамке нарисованного. */
function outlineFast(p: Px, c: RGBA): void {
  const { w, h, data: d } = p;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return;
  const add: number[] = [];
  for (let y = Math.max(0, y0 - 1); y <= Math.min(h - 1, y1 + 1); y++)
    for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) {
      const i = y * w + x;
      if (d[i * 4 + 3]) continue;
      if (
        (x > 0 && d[(i - 1) * 4 + 3]) ||
        (x < w - 1 && d[(i + 1) * 4 + 3]) ||
        (y > 0 && d[(i - w) * 4 + 3]) ||
        (y < h - 1 && d[(i + w) * 4 + 3])
      )
        add.push(i);
    }
  for (const i of add) {
    d[i * 4] = c[0];
    d[i * 4 + 1] = c[1];
    d[i * 4 + 2] = c[2];
    d[i * 4 + 3] = 255;
  }
}

/** Только в пустые пиксели — «позади» тела. */
function under(p: Px, x: number, y: number, c: RGBA): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (!p.solid(xi, yi)) p.set(xi, yi, c);
}

function drawMaw(r: MawRig, o: MawDraw = {}): MawCanvas {
  // Рабочие холсты общие: кадр живёт только до `cropMaw`.
  const p = (WORK ??= new Px(MW, MH));
  const lit = (WLIT ??= new Px(MW, MH));
  p.data.fill(0);
  lit.data.fill(0);
  const g = mawGeo(r);
  mawLegs(p, g, r, true);
  mawTube(p, g);
  const tips = mawCrest(p, g, r);
  mawFin(p, g, r);
  mawLegs(p, g, r, false);
  mawSac(p, lit, g, r.throat);
  const h = mawHead(p, g, r);
  outlineFast(p, INK);
  // Глаз.
  let eye: V2 | null = null;
  const [ex, ey] = h.eye;
  if (r.eye < 0.5) {
    p.set(ex, ey, MAW.eye);
    eye = [ex, ey];
  } else if (r.eye < 1.5) {
    p.set(ex - 1, ey, INK);
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else if (r.eye < 2.5) {
    p.set(ex, ey, INK);
    p.set(ex + 1, ey, INK);
  } else {
    for (const [u, v] of [
      [0.5, -3.2],
      [1.5, -4.2],
      [1.5, -2.2],
      [2.5, -3.2],
    ] as V2[])
      p.set(...h.at(u, v), INK);
  }
  // Жар в глотке — поверх темноты.
  const mouthUnder = h.at(1, 1)[1] > GY + 0.5 && !!o.water;
  if (r.glow > 0.02 && r.jaw > 0.1) {
    const c = h.at(-0.3, 1.1);
    const k = clamp(r.glow, 0, 1) * (mouthUnder ? 0.35 : 1);
    const halo = mouthUnder ? 4.2 : 2.6 + r.jaw * 1.2;
    lit.ell(c[0], c[1], halo, halo * 0.75, hex('#ff4a1a', 70 * k));
    lit.ell(c[0], c[1], 1.7, 1.1, hex('#ff8a3a', 190 * k));
    if (!mouthUnder && k > 0.4) {
      lit.set(...h.at(-1, 1), hex('#ffe08a', 255 * k));
      lit.set(...h.at(0, 1), hex('#ffe08a', 255 * k));
    }
  } else if (o.water && r.glow > 0.02) {
    // Под водой пасть закрыта, но глотка просвечивает сквозь воду.
    // Чем ярче (перед прыжком), тем заметнее в темноте: алое пятно из глубины.
    const c = h.at(0, 0.5);
    const k = clamp(r.glow, 0, 1);
    lit.ell(c[0], c[1], 5, 3, [255, 58, 26, Math.round(70 * k)]);
    lit.ell(c[0], c[1], 2.2, 1.4, [255, 110, 50, Math.round(150 * k * k)]);
  }
  if (o.hunger) for (const [x, y] of tips) lit.set(x, y, MAW.ember);
  if (o.water) mawWater(p, r, o);
  if (o.smear) {
    const list = [
      ...o.smear.rigs.map((q) => smearPts(q, o.smear!.part)),
      smearPts(r, o.smear.part),
    ];
    const n = list.length;
    const [cr, cg, cb, ca] = o.smear.col;
    for (let k = 0; k < list[0].length; k++)
      for (let j = 0; j + 1 < n; j++) {
        const a = list[j][k];
        const b = list[j + 1][k];
        const f = (j + 1) / (n - 1);
        const al = Math.round(ca * f * f);
        const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1.5));
        for (let q = 0; q <= steps; q++) {
          const x = a[0] + ((b[0] - a[0]) * q) / steps;
          const y = a[1] + ((b[1] - a[1]) * q) / steps;
          under(p, x, y, [cr, cg, cb, al]);
          if (f > 0.4) under(p, x, y + 1, [cr, cg, cb, Math.round(al * 0.6)]);
        }
      }
  }
  if (o.ring) mawRing(p, lit, o.ring);
  if (o.rage && o.rage > 0.05) mawRage(p, lit, o.rage);
  return { p, lit, g, h, eye: eye && (!o.water || eye[1] < GY) ? eye : null };
}

/** Вода: всё ниже кромки — тёмный силуэт в толще, по кромке — пена и рябь. */
function mawWater(p: Px, r: MawRig, o: MawDraw): void {
  const d = p.data;
  let xa = MW;
  let xb = -1;
  for (let y = GY; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = (y * MW + x) * 4;
      if (!d[i + 3]) continue;
      if (y === GY) {
        xa = Math.min(xa, x);
        xb = Math.max(xb, x);
        continue;
      }
      const a = clamp(150 - (y - GY) * 8, 40, 150);
      d[i] = 46 + d[i] * 0.22;
      d[i + 1] = 10 + d[i + 1] * 0.14;
      d[i + 2] = 18 + d[i + 2] * 0.16;
      d[i + 3] = a;
    }
  if (xb < 0) return;
  // Кромка: пена по телу и на палец в стороны.
  for (let x = xa - 1; x <= xb + 1; x++) p.set(x, GY, MAW.foam);
  p.set(xa - 2, GY, hex('#e0fffa', 120));
  p.set(xb + 2, GY, hex('#e0fffa', 120));
  const ph = o.ph ?? 0;
  const xc = (xa + xb) / 2;
  const hw = (xb - xa) / 2;
  // Рябь: два кольца расходятся от кромки.
  for (let j = 0; j < 2; j++) {
    const f = (ph + j * 0.5) % 1;
    const rx = hw + 2.5 + f * 6;
    const ry = 1 + f * 1.6;
    const a = Math.round(150 * (1 - f));
    for (let t = 0; t < 64; t++) {
      const an = (t / 64) * Math.PI * 2;
      under(p, xc + Math.cos(an) * rx, GY + 0.5 + Math.sin(an) * ry, hex('#a0ece4', a));
    }
  }
  // «Усы» за гребнем: плывёт — расходятся назад, тают к концу.
  if (o.wake) {
    const len = o.wake;
    for (let side = -1; side <= 1; side += 2)
      for (let q = 0; q <= len; q++) {
        const f = q / len;
        // Пунктир бежит назад с фазой.
        if ((q + Math.floor(ph * 8)) % 4 === 3) continue;
        const x = xa - 1 - q;
        const y = GY + side * (0.6 + f * 2.4) + (side > 0 ? 0.6 : 0);
        under(p, x, y, [160, 236, 228, Math.round(200 * (1 - f))]);
      }
    // Бурун у носа.
    under(p, xb + 2, GY - 1, MAW.foam);
    under(p, xb + 3, GY, MAW.foam);
  }
  void r;
}

/** След хвоста кругом (хлёст на берегу): дальняя половина — позади тела. */
function mawRing(p: Px, lit: Px, ring: { a0: number; a1: number; k: number }): void {
  const cx = GX;
  const cy = GY - 2;
  const R = 30;
  const span = ring.a1 - ring.a0;
  const n = Math.max(8, Math.ceil(Math.abs(span) * R * 1.4));
  for (let s = 0; s <= n; s++) {
    const f = s / n;
    const an = ring.a0 + span * f;
    const lead = Math.pow(f, 1.6);
    for (let w = 0; w < 4; w++) {
      const rr = R - w;
      const x = cx + Math.cos(an) * rr;
      const y = cy + Math.sin(an) * rr * 0.9;
      const a = Math.round(255 * ring.k * lead * (w === 1 ? 1 : w === 0 ? 0.75 : 0.5));
      const col: RGBA = w <= 1 && lead > 0.7 ? [255, 214, 190, a] : [255, 90, 60, a];
      if (Math.sin(an) < 0) under(p, x, y, col);
      else p.set(x, y, col);
      if (w === 1 && lead > 0.5) lit.set(x, y, [255, 120, 80, Math.round(a * 0.6)]);
    }
  }
}

/** Ярость: алый ореол по силуэту на два пикселя. */
function mawRage(p: Px, lit: Px, k: number): void {
  const { w: W, h: H, data: d } = p;
  const near = new Uint8Array(W * H).fill(9);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] < 200) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const m = Math.abs(dx) + Math.abs(dy);
          if (m > 2 || m === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = yy * W + xx;
          if (m < near[i]) near[i] = m;
        }
    }
  for (let i = 0; i < W * H; i++) {
    if (near[i] > 2 || d[i * 4 + 3]) continue;
    lit.set(i % W, Math.floor(i / W), [255, 50, 30, Math.round((near[i] === 1 ? 150 : 70) * k)]);
  }
}

interface MawRaw {
  p: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: V2 | null;
}

/** Обрезать по нарисованному: ноги кадра — точка (GX, GY). */
function cropMaw(c: MawCanvas): MawRaw {
  let x0 = MW;
  let y0 = MH;
  let x1 = -1;
  let y1 = -1;
  let litUsed = false;
  for (let y = 0; y < MH; y++)
    for (let x = 0; x < MW; x++) {
      const i = (y * MW + x) * 4 + 3;
      const a = c.p.data[i];
      const b = c.lit.data[i];
      if (b) litUsed = true;
      if (!a && !b) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) {
    x0 = GX;
    y0 = GY;
    x1 = GX;
    y1 = GY;
  }
  const w = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  const cut = (src: Px): Px => {
    const o = new Px(w, hh);
    for (let y = 0; y < hh; y++)
      o.data.set(
        src.data.subarray(((y + y0) * MW + x0) * 4, ((y + y0) * MW + x0 + w) * 4),
        y * w * 4,
      );
    return o;
  };
  return {
    p: cut(c.p),
    lit: litUsed ? cut(c.lit) : null,
    ax: GX - x0,
    ay: GY - y0 - FLY_LIFT,
    eye: c.eye ? [c.eye[0] - x0, c.eye[1] - y0] : null,
  };
}

// ---- Техники: поза по времени мозга ----------------------------------------

/** Плывёт под водой (swim) и несётся к кромке (tail): цикл от `now`. */
function swimRig(ph: number, fast: boolean): MawRig {
  const w = ph * Math.PI * 2;
  const A = fast ? 0.26 : 0.19;
  return {
    ...REST,
    sink: fast ? 10 : 12.5,
    crest: fast ? 1.45 : 1.4,
    sail: 1,
    tuck: 1,
    jaw: 0.1,
    glow: 0.4,
    gill: 0,
    bk1: -0.02 + A * 0.5 * Math.sin(w),
    bk2: A * Math.sin(w - 1.1),
    bk3: A * 1.25 * Math.sin(w - 2.2),
    fw1: 0.05 * Math.sin(w + 1.3),
    hd: (fast ? 0.1 : 0) + 0.04 * Math.sin(w + 2),
    fin: 0.45 * Math.sin(w - 3),
  };
}

/** Ползёт к воде: диагональные пары лап, волна по хвосту, голова кивает. */
function crawlRig(ph: number): MawRig {
  const w = ph * Math.PI * 2;
  return {
    ...REST,
    walk: ph,
    step: 1,
    cy: -6.2,
    bk1: -0.06 + 0.07 * Math.sin(w),
    bk2: -0.05 + 0.11 * Math.sin(w - 1),
    bk3: -0.04 + 0.17 * Math.sin(w - 2),
    fw1: 0.04 * Math.sin(w + 0.8),
    hd: 0.05 * Math.sin(2 * w + 1),
    jaw: 0.14 + 0.06 * Math.sin(w),
    fin: 0.3 * Math.sin(w - 3),
    gill: 0.3 + 0.2 * Math.sin(w),
  };
}

/**
 * Всплытие-удар: вынырнула, выросла из воды на дыбы (шея лебедем, хвост
 * уходит в глубину, передние лапы когтями вперёд), замерла — и рухнула
 * грудью в воду к герою: голова рывком вперёд, хвост взлетает гребнем.
 * Кадр удара — 20 (0,85 с · спешка), кадр 19 — смаз.
 */
const SURF_HIT = Math.floor(0.85 * 24);
const surfRig = lane<MawRig>(swimRig(0, true), [
  [0, {}],
  [
    F(4),
    {
      sink: 1,
      sail: 0,
      p: 0.1,
      cy: -7,
      fw1: 0.2,
      fw2: 0.1,
      hd: 0.05,
      jaw: 0.35,
      tuck: 0.3,
      reach: 0.4,
      crest: 1.25,
      bk1: -0.2,
      bk2: -0.15,
      bk3: -0.05,
      fin: 0,
      glow: 0.5,
      gill: 0.6,
    },
    EZ.out,
  ],
  [
    F(11),
    {
      sink: 0,
      p: 0.22,
      cy: -9,
      cx: -3,
      fw1: 0.38,
      fw2: 0.22,
      hd: -0.14,
      jaw: 0.7,
      throat: 0.25,
      reach: 1,
      tuck: 0,
      crest: 1.4,
      bk1: -0.34,
      bk2: -0.28,
      bk3: -0.1,
      fin: 0.2,
      glow: 0.75,
      gill: 1,
    },
    EZ.io,
  ],
  [
    F(17),
    {
      p: 0.28,
      cy: -10.5,
      cx: -4.5,
      fw1: 0.46,
      fw2: 0.28,
      hd: -0.12,
      jaw: 0.9,
      throat: 0.35,
      crest: 1.5,
      bk3: 0.05,
      glow: 0.95,
    },
    EZ.io,
  ],
  [F(18), { p: 0.3, cy: -11, cx: -5, fw1: 0.5, jaw: 0.96, bk3: 0.12 }, EZ.lin],
  // Кадр смаза: пошла вниз.
  [
    F(SURF_HIT - 1),
    {
      p: 0.06,
      cy: -8,
      cx: -1,
      fw1: 0.1,
      fw2: 0.04,
      hd: -0.04,
      jaw: 1.05,
      bk1: -0.05,
      bk2: 0.05,
      bk3: 0.2,
      fin: 0.3,
    },
    EZ.in,
  ],
  // Удар: грудь на воде, голова вперёд над водой, хвост взлетел.
  [
    F(SURF_HIT),
    {
      p: -0.04,
      cy: -6.6,
      cx: 2.5,
      fw1: -0.04,
      fw2: 0,
      hd: 0.12,
      jaw: 0.95,
      throat: 0.05,
      reach: 0.7,
      crest: 1.5,
      bk1: 0.2,
      bk2: 0.26,
      bk3: 0.3,
      fin: 0.6,
      glow: 1,
    },
    EZ.in,
  ],
  [
    F(SURF_HIT + 2),
    {
      p: -0.07,
      cy: -6.1,
      cx: 3,
      fw1: -0.08,
      hd: 0.08,
      jaw: 0.8,
      bk1: 0.28,
      bk2: 0.34,
      bk3: 0.28,
      fin: 0.1,
      sink: 0.5,
    },
    EZ.out,
  ],
  [
    F(SURF_HIT + 6),
    {
      p: -0.02,
      cy: -6,
      cx: 1,
      fw1: 0,
      fw2: 0,
      hd: 0,
      jaw: 0.45,
      bk1: -0.12,
      bk2: -0.16,
      bk3: -0.2,
      fin: -0.5,
      crest: 1.2,
      glow: 0.4,
      sink: 1.5,
      reach: 0,
      tuck: 0.6,
    },
    EZ.io,
  ],
  [
    F(SURF_HIT + 10),
    {
      p: 0,
      cy: -6,
      cx: -1,
      jaw: 0.25,
      bk1: -0.05,
      bk2: -0.03,
      bk3: 0,
      fin: 0.1,
      glow: 0.3,
      sink: 4,
      gill: 0.4,
    },
    EZ.io,
  ],
  [
    1.55,
    {
      sink: 12.5,
      sail: 1,
      tuck: 1,
      jaw: 0.1,
      crest: 1.4,
      glow: 0.4,
      cx: -2,
      cy: -6,
      p: 0,
      hd: 0,
      gill: 0,
      throat: 0,
    },
    EZ.in,
  ],
]);

/** Плевок: вынырнула, набрала воздух в мешок, выплюнула с отдачей. */
function spitRig(a: number, b: number): MawRig {
  // a — доля замаха (до плевка), b — секунды после него (−1 — ещё не плюнула).
  if (b < 0) return spitPre(a);
  return spitPost(b);
}
const spitPre = lane<MawRig>(swimRig(0, false), [
  [0, {}],
  [
    0.25,
    { sink: 2, sail: 0, p: 0.15, cy: -7, jaw: 0.2, crest: 1.2, glow: 0.4, gill: 0.5, tuck: 0.5 },
    EZ.out,
  ],
  [
    0.8,
    { p: 0.28, hd: 0.3, cx: -3.5, jaw: 0.04, throat: 1, crest: 1.45, glow: 0.8, gill: 0 },
    EZ.in,
  ],
  [0.93, { p: 0.3, hd: 0.36, cx: -4, throat: 1.08 }, EZ.lin],
  [1, { p: 0.02, hd: -0.12, cx: 0.5, jaw: 0.7, throat: 0.9 }, EZ.in],
]);
const spitPost = lane<MawRig>(spitPre(1), [
  [0, { p: -0.05, hd: -0.16, cx: 1, jaw: 1.1, throat: 0.25, glow: 1 }],
  [0.1, { p: 0.12, hd: 0.22, cx: -2.5, jaw: 0.8, throat: 0.1, glow: 0.6 }, EZ.out],
  [0.24, { p: 0.08, hd: 0.05, cx: -1.5, jaw: 0.35, throat: 0, glow: 0.4, crest: 1.2 }, EZ.io],
  [0.5, { sink: 11, sail: 1, p: 0, hd: 0, cx: -2, cy: -6, jaw: 0.1, tuck: 1, crest: 1.35 }, EZ.in],
]);

/** Подъём из глубины перед прыжком: ушла вниз, пошла вверх, нос пробил воду. */
const riseWater = lane<MawRig>(swimRig(0, false), [
  [0, {}],
  [
    0.42,
    { sink: 15, sail: 0.2, p: 0.2, glow: 0.6, bk1: -0.15, bk2: -0.1, bk3: -0.05, jaw: 0.3 },
    EZ.io,
  ],
  [0.85, { sink: 7, sail: 0, p: 0.42, hd: 0.15, glow: 1, jaw: 0.8, crest: 1.2 }, EZ.in],
  [1, { sink: 4, p: 0.5, jaw: 0.9 }, EZ.lin],
]);

/** На суше перед прыжком серии: сжалась пружиной. */
const riseLand = lane<MawRig>(REST, [
  [0, {}],
  [
    0.7,
    {
      cy: -5,
      cx: -3.5,
      p: -0.12,
      hd: 0.14,
      bk1: 0.25,
      bk2: 0.3,
      bk3: 0.35,
      crest: 1.35,
      jaw: 0.5,
      glow: 0.6,
      splay: 0.6,
      gill: 0.8,
      fin: 0.3,
    },
    EZ.io,
  ],
  [1, { cy: -4.6, cx: -4, p: -0.16, bk3: 0.45, jaw: 0.6 }, EZ.in],
]);

/** Полёт: наклон — по скорости на экране, отдельно; здесь изгиб и пасть. */
const leapRig = lane<MawRig>(REST, [
  [
    0,
    {
      cy: -6,
      bk1: -0.2,
      bk2: -0.18,
      bk3: -0.1,
      jaw: 0.4,
      tuck: 0.3,
      crest: 0.8,
      glow: 0.4,
      fin: -0.3,
      gill: 0,
    },
  ],
  [0.15, { bk1: -0.12, bk2: -0.12, bk3: -0.08, tuck: 1, jaw: 0.55, crest: 0.7, fin: -0.4 }, EZ.out],
  [
    0.45,
    {
      fw1: -0.1,
      fw2: -0.05,
      bk1: -0.08,
      bk2: -0.08,
      bk3: -0.02,
      jaw: 0.95,
      glow: 0.9,
      crest: 0.9,
      fin: 0,
    },
    EZ.io,
  ],
  [
    0.75,
    {
      fw1: -0.02,
      fw2: 0,
      bk1: 0.12,
      bk2: 0.16,
      bk3: 0.2,
      jaw: 1.05,
      reach: 0.6,
      tuck: 0.4,
      crest: 1.2,
      fin: 0.35,
      hd: 0.08,
    },
    EZ.io,
  ],
  [
    1,
    { bk1: 0.18, bk2: 0.22, bk3: 0.26, jaw: 1.1, reach: 1, tuck: 0, hd: 0.12, crest: 1.3, glow: 1 },
    EZ.in,
  ],
]);

/** Приземление: пасть захлопнулась, хвост хлопнул, гребень спружинил. */
const landRig = lane<MawRig>(REST, [
  [
    0,
    {
      cy: -5.2,
      jaw: 1.1,
      reach: 0.8,
      splay: 0.6,
      bk1: 0.2,
      bk2: 0.24,
      bk3: 0.3,
      crest: 1.3,
      hd: 0.1,
      glow: 0.9,
      eye: 1,
    },
  ],
  [
    F(2),
    {
      cy: -4.6,
      jaw: 0.05,
      reach: 0,
      splay: 1,
      bk1: -0.2,
      bk2: -0.16,
      bk3: -0.1,
      crest: 1.45,
      hd: -0.12,
      glow: 0.3,
    },
    EZ.out,
  ],
  [
    F(4),
    {
      cy: -6.4,
      bk1: 0.12,
      bk2: 0.18,
      bk3: 0.25,
      jaw: 0.3,
      crest: 0.9,
      hd: 0.06,
      splay: 0.7,
      eye: 0,
    },
    EZ.io,
  ],
  [
    F(7),
    {
      cy: -6,
      bk1: -0.06,
      bk2: -0.05,
      bk3: -0.04,
      jaw: 0.25,
      crest: 1,
      splay: 0.4,
      hd: 0,
      glow: 0.2,
    },
    EZ.io,
  ],
]);

/** Выброшенная рыба: подброс, шлепок, хватает воздух, жабры ходят. */
const FLOP_T = 16 / 12;
const flopRig = lane<MawRig>({ ...REST, splay: 0.4, jaw: 0.25, gill: 0.2 }, [
  [0, {}],
  [0.1, { fw1: -0.08, bk1: -0.12, bk2: -0.1, jaw: 0.1, gill: 0.1 }, EZ.io],
  [
    0.22,
    {
      fw1: 0.22,
      fw2: 0.12,
      bk1: 0.22,
      bk2: 0.26,
      bk3: 0.32,
      hd: 0.15,
      jaw: 0.85,
      gill: 1,
      fin: 0.4,
      kick: 1,
      walk: 0.3,
      crest: 1.25,
    },
    EZ.out,
  ],
  [
    0.34,
    {
      fw1: -0.1,
      fw2: 0,
      bk1: -0.14,
      bk2: -0.1,
      bk3: -0.1,
      hd: -0.05,
      jaw: 0.35,
      gill: 0.6,
      kick: 0.4,
      walk: 0.6,
      fin: -0.35,
      crest: 0.9,
    },
    EZ.in,
  ],
  [
    0.46,
    { fw1: 0, bk1: -0.06, bk2: -0.05, bk3: 0.02, hd: 0, jaw: 0.3, kick: 0, fin: 0.15, crest: 1 },
    EZ.out,
  ],
  [0.72, { jaw: 0.58, gill: 0.95, throat: 0.12, cy: -6.4, fin: -0.05 }, EZ.io],
  [1.0, { jaw: 0.2, gill: 0.25, throat: 0, cy: -6 }, EZ.io],
  [FLOP_T, { jaw: 0.25, gill: 0.2, fin: 0 }, EZ.io],
]);

/**
 * Хлёст хвостом по кругу (с прилива): метка с 0,75 с, удар в 1,30 — кадр
 * 31 от начала «берега». Ключи — в кадрах от 0,75 с (кадр 18): смаз — 12,
 * удар — 13.
 */
const THR_AT = 0.75;
const THR_HIT = Math.floor((THR_AT + 0.55) * 24);
const THR_K = THR_HIT - 18;
const thrashRig = lane<MawRig>({ ...REST, splay: 0.4, jaw: 0.25 }, [
  [0, {}],
  [F(3), { hd: 0.15, jaw: 0.6, crest: 1.3, glow: 0.4, splay: 0.8, cy: -7, gill: 0.6 }, EZ.out],
  [
    F(9),
    {
      fw1: 0.2,
      fw2: 0.1,
      bk1: 0.45,
      bk2: 0.6,
      bk3: 0.7,
      hd: 0.2,
      jaw: 0.8,
      glow: 0.8,
      crest: 1.45,
      gill: 1,
      cy: -8,
      throat: 0.2,
      fin: 0.3,
    },
    EZ.io,
  ],
  [F(THR_K - 2), { bk3: 0.82, cx: -3, fw1: 0.24, jaw: 0.86 }, EZ.io],
  // Кадр смаза: хвост пошёл.
  [F(THR_K - 1), { bk1: 0.1, bk2: 0.05, bk3: -0.1, p: -0.06, cx: -1.5, jaw: 1 }, EZ.in],
  // Удар: хвост метёт по земле, тело крутнуло.
  [
    F(THR_K),
    {
      bk1: -0.25,
      bk2: -0.5,
      bk3: -0.6,
      p: -0.15,
      fw1: -0.1,
      hd: -0.2,
      jaw: 1.1,
      cx: 1,
      cy: -6,
      glow: 1,
    },
    EZ.in,
  ],
  [
    F(THR_K + 2),
    { bk1: -0.35, bk2: -0.3, bk3: 0.05, p: -0.1, jaw: 0.9, fin: -0.5, crest: 1.2 },
    EZ.out,
  ],
  [
    F(THR_K + 6),
    {
      bk1: -0.02,
      bk2: -0.05,
      bk3: 0.12,
      p: 0,
      fw1: 0,
      hd: 0,
      jaw: 0.45,
      cx: -2,
      cy: -6.4,
      crest: 1.1,
      glow: 0.3,
      fin: 0.2,
    },
    EZ.io,
  ],
  [
    F(THR_K + 10),
    {
      bk1: -0.06,
      bk2: -0.05,
      bk3: -0.04,
      jaw: 0.25,
      crest: 1,
      splay: 0.4,
      glow: 0,
      throat: 0,
      gill: 0.2,
      fin: 0,
      cy: -6,
    },
    EZ.io,
  ],
]);

/** Рёв на берегу в начале боя: поднялась, вдох, рёв с дрожью, опустилась. */
const roarRig = lane<MawRig>(REST, [
  [0, { crestRun: 0 }],
  [
    F(4),
    {
      cy: -7.5,
      p: 0.12,
      fw1: 0.15,
      hd: 0.1,
      jaw: 0.35,
      crest: 1.3,
      crestRun: 0.35,
      gill: 0.6,
      splay: 0.4,
      bk1: 0.1,
      bk2: 0.15,
      bk3: 0.2,
    },
    EZ.out,
  ],
  [
    F(7),
    {
      jaw: 0.06,
      throat: 0.45,
      fw1: 0.06,
      hd: -0.12,
      p: 0.06,
      cx: -3.5,
      crestRun: 0.7,
      crest: 1.45,
      glow: 0.2,
    },
    EZ.io,
  ],
  [
    F(9),
    {
      jaw: 1.15,
      fw1: 0.38,
      fw2: 0.26,
      hd: 0.2,
      p: 0.2,
      cy: -8.5,
      cx: -1,
      glow: 1,
      throat: 0.12,
      crest: 1.55,
      crestRun: 1,
      gill: 1,
      bk1: 0.25,
      bk2: 0.3,
      bk3: 0.35,
      fin: 0.4,
    },
    EZ.out,
  ],
  [F(23), { jaw: 1.05, fw1: 0.34, hd: 0.15 }, EZ.lin],
  [
    F(27),
    {
      jaw: 0.25,
      fw1: 0,
      fw2: 0,
      hd: 0,
      p: 0.04,
      cy: -6.5,
      glow: 0.2,
      crest: 1.15,
      gill: 0.3,
      bk1: -0.06,
      bk2: -0.05,
      bk3: -0.04,
      fin: 0,
    },
    EZ.io,
  ],
  [1.3, { cy: -6.2, cx: -2, p: 0, crest: 1, step: 1, walk: 0, splay: 0 }, EZ.io],
]);

/**
 * Смерть на суше: две судороги (выгнулась, ударилась), обмякла — шея и
 * голова падают, пасть отвисла, гребень лёг, лапы разъехались; хвост
 * вздрагивает; потом тело оседает и тает алой лужей.
 */
const dieLand = lane<MawRig>(REST, [
  [0, { jaw: 0.9, eye: 1, crest: 1.4, glow: 1, hd: 0.3, p: 0.15, bk1: 0.3, bk2: 0.3, bk3: 0.3 }],
  [
    F(3),
    { fw1: 0.3, fw2: 0.15, hd: 0.34, bk1: 0.35, bk2: 0.36, bk3: 0.4, jaw: 1.12, gill: 1, fin: 0.5 },
    EZ.out,
  ],
  [
    F(6),
    { fw1: -0.1, fw2: 0, hd: -0.05, p: 0, bk1: -0.15, bk2: -0.1, bk3: -0.1, jaw: 0.6, fin: -0.4 },
    EZ.in,
  ],
  [
    F(8),
    { fw1: 0.2, hd: 0.2, bk1: 0.25, bk2: 0.3, bk3: 0.3, jaw: 1.05, glow: 0.6, fin: 0.3 },
    EZ.out,
  ],
  [
    F(11),
    {
      fw1: 0,
      hd: 0,
      bk1: -0.06,
      bk2: -0.05,
      bk3: -0.04,
      jaw: 0.7,
      glow: 0.3,
      crest: 1.1,
      fin: 0,
      gill: 0.5,
    },
    EZ.in,
  ],
  [
    F(15),
    {
      cy: -4.6,
      fw1: -0.14,
      fw2: -0.12,
      hd: -0.12,
      jaw: 0.85,
      eye: 3,
      glow: 0,
      crest: 0.55,
      splay: 1.2,
      bk1: -0.1,
      bk2: -0.07,
      bk3: -0.05,
      gill: 0,
    },
    EZ.io,
  ],
  [F(18), { bk3: 0.25, fin: 0.5, kick: 0.5, walk: 0.3 }, EZ.out],
  [F(21), { bk3: -0.06, fin: -0.1, kick: 0, walk: 0.6 }, EZ.io],
  [F(24), { bk3: 0.08, fin: 0.3 }, EZ.io],
  [1.4, { bk3: -0.05, fin: 0 }, EZ.io],
]);

/** Смерть в воде: рванулась из воды, судорога, обмякла и тонет. */
const dieWater = lane<MawRig>({ ...REST, sink: 2 }, [
  [0, { jaw: 0.9, eye: 1, crest: 1.4, glow: 1, hd: 0.3, p: 0.3, cy: -8 }],
  [
    F(4),
    { p: 0.4, fw1: 0.3, fw2: 0.2, hd: 0.3, jaw: 1.12, bk1: -0.2, bk2: -0.1, cy: -10, gill: 1 },
    EZ.out,
  ],
  [
    F(9),
    {
      p: 0.05,
      fw1: 0,
      fw2: 0,
      hd: 0,
      jaw: 0.7,
      bk1: -0.1,
      bk2: -0.1,
      bk3: -0.1,
      cy: -6,
      glow: 0.4,
    },
    EZ.in,
  ],
  [F(14), { eye: 3, glow: 0, jaw: 0.85, crest: 0.6, fw1: -0.12, hd: -0.1, sink: 4 }, EZ.io],
  [1.4, { sink: 18, jaw: 0.7, bk3: 0.1 }, EZ.in],
]);

/** Отдёрнулась от удара: пасть захлопнута, прищур, гребень прижат. */
function flinch(r: MawRig): MawRig {
  return {
    ...r,
    jaw: 0.04,
    eye: 1,
    crest: Math.min(r.crest, 0.85),
    hd: r.hd - 0.12,
    cx: r.cx - 0.8,
    bk1: r.bk1 + 0.1,
    bk3: r.bk3 + 0.15,
    gill: 0.9,
  };
}

/** Ярость смены фазы: пасть, жар, гребень дыбом. */
function enrage(r: MawRig, k: number): MawRig {
  return {
    ...r,
    jaw: Math.max(r.jaw, 1.05 * k),
    glow: Math.max(r.glow, k),
    crest: Math.max(r.crest, 1 + 0.5 * k),
    hd: r.hd + 0.28 * k,
    gill: Math.max(r.gill, k),
    eye: k > 0.3 ? 0 : r.eye,
  };
}

// ---- Кадры: поза → рисунок (кеш), трансформ — каждый кадр игры -------------

/** Что знает рисовальщик о пасти в этот миг. */
interface MawCtx {
  mode: string;
  t: number;
  now: number;
  data: Record<string, number>;
  /** Фаза боя и спешка (1,25 после 200 с) — из `paintSim()`. */
  ph: number;
  haste: number;
  hurt: boolean;
  /** Откуда прыжок: из воды, с берега (серия) или нырок с суши в воду. */
  from: 'water' | 'land' | 'dive';
  /** Погибла в воде. */
  wet: boolean;
  /** Сцена смены фазы: секунды от начала, −1 — нет. */
  rage: number;
  /** Секунды после нырка с суши (swim), −1 — нет. */
  entry: number;
  /** Экранная скорость полёта для наклона: пикселей за k по x и по y. */
  flight: [number, number] | null;
}

interface MawFx {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  shadow: number;
  ghost: boolean;
  alpha: number;
  linger?: number;
}

interface MawSpec {
  key: string;
  make: () => MawRaw;
  fx: MawFx;
}

/** Позы вдоль дуги от `t0` до `t1` — для следа. */
function path(f: (x: number) => MawRig, t0: number, t1: number, n = 6): MawRig[] {
  const out: MawRig[] = [];
  for (let i = 0; i < n; i++) out.push(f(t0 + ((t1 - t0) * i) / n));
  return out;
}

const FX0: MawFx = { dx: 0, dy: 0, sx: 1, sy: 1, shadow: 16, ghost: false, alpha: 1 };

/** Кадр 24 к/с от времени техники. */
const q24 = (t: number) => Math.max(0, Math.floor(t * 24 + 1e-6));

/** Пузыри на кромке вокруг тела: `n` штук, мигают по фазе. */
function bubbles(c: MawCanvas, n: number, ph: number, spread: number): void {
  const g = c.g;
  const cx = g.line[Math.floor(g.line.length * 0.6)][0];
  for (let i = 0; i < n; i++) {
    const h = hash(i, 17, 3);
    const life = ((ph * 2 + (h % 100) / 100) % 1) * 1;
    if (life > 0.8) continue;
    const x = cx + (((h >> 8) % 100) / 100 - 0.5) * spread * 2;
    const y = GY - 1 + ((h >> 16) % 3) - life * 2;
    if (life < 0.55) c.p.set(x, y, MAW.foam);
    else {
      c.p.set(x - 1, y, hex('#e0fffa', 150));
      c.p.set(x + 1, y, hex('#e0fffa', 150));
    }
  }
}

/** Капли, стекающие с тела после выхода из воды: `k` 0…1 — сколько прошло. */
function drips(c: MawCanvas, k: number, n = 7): void {
  if (k >= 1) return;
  const g = c.g;
  for (let i = 0; i < n; i++) {
    const h = hash(i, 5, 11);
    const j = 4 + (h % (g.line.length - 8));
    const s = g.line[j];
    const r = g.rad[j];
    const fall = 3 + k * k * 26 * (0.7 + ((h >> 10) % 30) / 100);
    const x = s[0] - k * 3 * (((h >> 4) % 3) - 1);
    const y = s[1] + r + fall;
    const a = Math.round(220 * (1 - k));
    c.p.set(x, y, hex('#a0ece4', a));
    if (k < 0.5) c.p.set(x, y - 1, hex('#e0fffa', a * 0.6));
  }
}

/**
 * Грудь ударила в воду: две стенки брызг по бокам груди поднимаются и
 * опадают, капли летят дугой, по кромке — пена. `f` — кадр после удара.
 */
function splash(c: MawCanvas, f: number, cx: number): void {
  const k = f / 8;
  const rise = Math.sin(Math.min(1, (f + 1) / 4) * Math.PI * 0.5);
  const fall = f < 4 ? 0 : (f - 4) / 4;
  for (const side of [-1, 1]) {
    // Стенка: столбики от кромки, выше у тела, наклон наружу.
    for (let j = 0; j < 6; j++) {
      const x0 = cx + side * (6 + j * 1.6 + f * 0.9);
      const hgt = (9 - j * 1.2) * rise * (1 - fall * 0.8);
      for (let q = 0; q < hgt; q++) {
        const y = GY - q;
        const x = x0 + side * q * 0.35;
        const top = q > hgt - 2;
        const a = Math.round((top ? 240 : 150) * (1 - k * 0.7));
        c.p.set(x, y, top ? [224, 255, 250, a] : [160, 236, 228, a]);
      }
    }
  }
  for (let i = 0; i < 16; i++) {
    const h = hash(i, 9, 2);
    const side = i % 2 ? 1 : -1;
    const vx = side * (1.2 + ((h >> 3) % 5) * 0.5);
    const vy = -(2.2 + ((h >> 9) % 7) * 0.45);
    const tt = f * 0.9;
    const px = cx + side * 5 + vx * tt * 1.6;
    const py = GY - 2 + vy * tt * 1.6 + tt * tt * 0.55;
    if (py > GY) continue;
    c.p.set(px, py, [224, 255, 250, Math.round(235 * (1 - k))]);
  }
  for (let x = -12 - f; x <= 12 + f; x++)
    under(c.p, cx + x, GY, [224, 255, 250, Math.round(200 * (1 - k))]);
}

function surfSpec(x: MawCtx): MawSpec {
  const u = x.t * x.haste;
  const fi = Math.min(q24(u), q24(1.55) - 1);
  const t = F(fi);
  const fx: MawFx = { ...FX0, shadow: 0 };
  // Замах — дрожь на вершине (0,71–0,79), удар — толчок вперёд и сжатие.
  if (u > 0.71 && u < 0.8) fx.dx = Math.sin(x.now * 70) * 0.7;
  const hk = u - F(SURF_HIT);
  if (hk >= 0 && hk < 0.3) {
    const e = 1 - hk / 0.3;
    fx.dx = 2.2 * e * e;
    fx.sx = 1 + 0.1 * e * e;
    fx.sy = 1 - 0.12 * e * e;
  }
  return {
    key: `surf|${fi}`,
    fx,
    make: () => {
      const r = surfRig(t);
      const smear =
        fi === SURF_HIT - 1 || fi === SURF_HIT
          ? {
              rigs: path(surfRig, t - F(1.2), t),
              part: 'front' as const,
              col: [255, 250, 240, 255] as RGBA,
            }
          : fi === SURF_HIT + 1 || fi === SURF_HIT + 2
            ? {
                rigs: path(surfRig, t - F(1.4), t),
                part: 'tail' as const,
                col: hex('#ffb098', 200),
              }
            : null;
      const c = drawMaw(r, { water: true, ph: fi / 10, smear });
      if (fi >= 3 && fi < 14) drips(c, (fi - 3) / 11);
      if (fi >= SURF_HIT && fi < SURF_HIT + 8)
        splash(c, fi - SURF_HIT, c.g.line[c.g.line.length - 12][0]);
      return cropMaw(c);
    },
  };
}

function spitSpec(x: MawCtx): MawSpec {
  const wind = 0.6 / x.haste;
  const hitF = q24(wind);
  const fi = Math.min(q24(x.t), hitF + 11);
  const pre = fi < hitF;
  const a = pre ? fi / hitF : 1;
  const b = pre ? -1 : F(fi - hitF);
  const fx: MawFx = { ...FX0, shadow: 0 };
  // Набор: тело чуть раздувается; плевок — отдача назад.
  if (pre && a > 0.25) {
    const k = clamp((a - 0.25) / 0.7, 0, 1);
    fx.sx = 1 + 0.03 * k;
    fx.sy = 1 + 0.03 * k;
    if (a > 0.8) fx.dx = Math.sin(x.now * 60) * 0.5;
  }
  const since = x.t - wind;
  if (since >= 0 && since < 0.3) {
    const e = 1 - since / 0.3;
    fx.dx = -2.6 * e * e;
    fx.sy = 1 + 0.06 * e * e;
    fx.sx = 1 - 0.04 * e * e;
  }
  const n = x.ph >= 2 ? 3 : 1;
  return {
    key: `spit|${fi}|${hitF}|${n}`,
    fx,
    make: () => {
      const r = spitRig(a, b);
      const c = drawMaw(r, {
        water: true,
        ph: fi / 9,
        smear:
          fi === hitF
            ? { rigs: path(spitPre, 0.9, 1), part: 'front', col: hex('#9affee', 200) }
            : null,
      });
      if (fi >= 3 && fi < 10) drips(c, (fi - 3) / 7, 5);
      if (!pre && fi - hitF < 5) {
        // Струя из пасти: сгусток и брызги конусом вперёд, тают.
        const k = (fi - hitF) / 5;
        const [mx, my] = c.h.at(8, 0.6);
        const a0 = c.g.ha + 0.08;
        if (k < 0.3) {
          c.p.ell(mx + 1, my, 2.2, 1.6, MAW.spitDk);
          c.p.ell(mx + 1, my - 0.4, 1.3, 0.9, MAW.spit);
          c.lit.ell(mx + 1, my, 2.6, 2, hex('#9affee', 120));
        }
        for (let i = 0; i < 10 + 5 * n; i++) {
          const h = hash(i, 23, n);
          const an = a0 + (((h >> 6) % 100) / 100 - 0.5) * (0.5 + k * 0.7);
          const dist = 3 + k * (8 + (h % 10)) + (i % 3);
          const px = mx + Math.cos(an) * dist;
          const py = my + Math.sin(an) * dist + k * k * 6;
          const col = i % 3 ? MAW.spit : MAW.spitDk;
          c.p.set(px, py, [col[0], col[1], col[2], Math.round(255 * (1 - k * 0.7))]);
          if (i % 3 === 0) c.lit.set(px, py, hex('#9affee', Math.round(150 * (1 - k))));
        }
      }
      return cropMaw(c);
    },
  };
}

function riseSpec(x: MawCtx): MawSpec {
  const wind = (x.ph >= 2 ? 0.34 : 0.5) / x.haste;
  const total = Math.max(1, q24(wind));
  const fi = Math.min(q24(x.t), total);
  const k = fi / total;
  const water = (x.data.ghost ?? 0) > 0;
  const fx: MawFx = { ...FX0, shadow: water ? 0 : 16 };
  if (water) fx.dx = Math.sin(x.now * 44) * 0.35 * k;
  else {
    // Сжалась пружиной: чем ближе прыжок, тем ниже.
    const e = EZ.in(clamp(x.t / wind, 0, 1));
    fx.sx = 1 + 0.12 * e;
    fx.sy = 1 - 0.14 * e;
    if (e > 0.5) fx.dx = Math.sin(x.now * 64) * 0.6;
  }
  return {
    key: `rise|${water ? 'w' : 'l'}|${Math.round(k * 24)}`,
    fx,
    make: () => {
      if (!water) return cropMaw(drawMaw(riseLand(k)));
      const c = drawMaw(riseWater(k), { water: true, ph: fi / 8, wake: 0 });
      bubbles(c, Math.round(3 + k * 14), fi / 8, 10 + k * 6);
      if (k > 0.6) {
        // Вода вспучилась над головой; нос пробивает кромку.
        const [hx] = c.h.at(3, 0);
        const w = 3 + (k - 0.6) * 12;
        for (let xx = -w; xx <= w; xx++)
          under(c.p, hx + xx, GY - 1 - (Math.abs(xx) < w * 0.5 ? 1 : 0), hex('#a0ece4', 160));
        if (k > 0.85)
          for (let i = 0; i < 9; i++) {
            const an = -Math.PI * (0.1 + (0.8 * i) / 8);
            c.p.set(hx + Math.cos(an) * (w + 1), GY - 1 + Math.sin(an) * 4, MAW.foam);
          }
      }
      return cropMaw(c);
    },
  };
}

function leapSpec(x: MawCtx): MawSpec {
  const T = x.data.T || 1;
  const hop = x.data.hop || 2.5;
  const kc = clamp(x.t / T, 0, 1);
  const fi = Math.min(24, q24(kc));
  const k = fi / 24;
  // Наклон — по скорости на экране: вверх на взлёте, носом вниз к земле.
  const [fxs, fys] = x.flight ?? [T * 90, 0];
  const vx = Math.abs(fxs);
  const vy = fys - Math.cos(k * Math.PI) * Math.PI * hop * TS;
  let pitch = clamp(0.7 * Math.atan2(-vy, Math.max(vx, 60)), -0.55, 0.62);
  // К земле — брюхом, лапами вперёд: нос выравнивается.
  if (k > 0.72) pitch += (-0.1 - pitch) * EZ.io((k - 0.72) / 0.28);
  const pq = Math.round(pitch / 0.07);
  const z = Math.sin(kc * Math.PI) * hop;
  const fx: MawFx = {
    ...FX0,
    dy: -z * TS,
    shadow: Math.round(16 * (1 - 0.4 * Math.sin(kc * Math.PI))),
    ghost: true,
  };
  // Толчок — вытянулась; к земле — вытягивается навстречу удару.
  if (kc < 0.22) {
    const e = 1 - kc / 0.22;
    fx.sy = 1 + 0.2 * e * e - 0.03 * Math.sin(e * Math.PI);
    fx.sx = 1 - 0.14 * e * e + 0.02 * Math.sin(e * Math.PI);
  } else if (kc > 0.8) {
    const e = (kc - 0.8) / 0.2;
    fx.sy = 1 + 0.08 * e;
    fx.sx = 1 - 0.05 * e;
  }
  const from = x.from;
  return {
    key: `air|${fi}|${pq}|${from}`,
    fx,
    make: () => {
      let r = { ...leapRig(k), p: pq * 0.07 };
      if (from === 'dive') r = { ...r, jaw: 0.15, reach: 0, tuck: 1, crest: 0.6, glow: 0.2 };
      const c = drawMaw(r, { hunger: x.ph >= 2 });
      if (from === 'water') drips(c, k / 0.5, 9);
      return cropMaw(c);
    },
  };
}

function beachSpec(x: MawCtx): MawSpec {
  const t = x.t;
  const thr = (x.data.thr ?? 0) > 0 && t >= THR_AT;
  const series = (x.data.series ?? 0) > 0;
  const fx: MawFx = { ...FX0 };
  let key: string;
  let rig: () => MawRig;
  let draw: MawDraw = { hunger: x.ph >= 2 };
  let flin = x.hurt;
  if (t < F(7)) {
    // Приземление: сплющило, отпружинила.
    const fi = q24(t);
    key = `land|${fi}`;
    rig = () => landRig(F(fi));
    const pts: [number, number, number][] = [
      [0, 1.2, 0.8],
      [F(2), 1.13, 0.86],
      [F(3.5), 0.95, 1.07],
      [F(5), 1.02, 0.98],
      [F(7), 1, 1],
    ];
    for (let i = 1; i < pts.length; i++)
      if (t <= pts[i][0]) {
        const e = EZ.io((t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]));
        fx.sx = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * e;
        fx.sy = pts[i - 1][2] + (pts[i][2] - pts[i - 1][2]) * e;
        break;
      }
    flin = false;
  } else if (thr && t < THR_AT + 1) {
    // Хлёст: метка 0,55 с — заводит хвост; удар — ровно в кадр урона.
    const fi = q24(t);
    const tt = F(fi) - THR_AT;
    key = `thr|${fi}`;
    rig = () => thrashRig(tt);
    const rel = fi - THR_HIT;
    if (rel >= -1 && rel <= 2) {
      // След хвоста кругом, по часовой: от хвоста (слева) через верх.
      const a0 = Math.PI * 0.95;
      const span = rel === -1 ? 0.9 : rel === 0 ? 2 * Math.PI : 2 * Math.PI;
      const k = rel <= 0 ? 1 : rel === 1 ? 0.6 : 0.3;
      draw = {
        ...draw,
        ring: { a0: rel <= 0 ? a0 : a0 + 0.5 * rel, a1: a0 + span, k },
        smear:
          rel <= 0
            ? { rigs: path(thrashRig, tt - F(1.2), tt), part: 'tail', col: hex('#ffb098', 210) }
            : null,
      };
    }
    if (t > THR_AT + F(9) && t < F(THR_HIT - 1)) fx.dx = Math.sin(x.now * 66) * 0.6;
    if (rel >= 0 && rel < 6) {
      const e = 1 - rel / 6;
      fx.sx = 1 + 0.08 * e;
      fx.sy = 1 - 0.1 * e;
    }
    flin = false;
  } else if (series) {
    // Серия: не лежит — глядит на цель, готова к следующему прыжку.
    const fi = Math.min(q24(t), 12);
    key = `glare|${fi}`;
    rig = () =>
      mixRig(
        landRig(F(7)),
        { ...REST, hd: 0.14, jaw: 0.5, crest: 1.3, glow: 0.6, splay: 0.5, gill: 0.6 },
        EZ.io(clamp((F(fi) - F(7)) / 0.2, 0, 1)),
      );
  } else {
    // Выброшенная рыба: цикл 16 кадров на 12 к/с.
    const fi = Math.floor(((t - F(7)) * 12) % 16);
    const lt = fi / 12;
    key = `flop|${fi}`;
    rig = () => {
      const r = flopRig(lt);
      // Кончик хвоста подрагивает, пока лежит.
      return lt > 0.5 ? { ...r, bk3: r.bk3 + 0.1 * Math.sin(lt * 17) } : r;
    };
    const lc = ((t - F(7)) % FLOP_T) / FLOP_T;
    const T0 = 0.1 / FLOP_T;
    const T1 = 0.22 / FLOP_T;
    const T2 = 0.34 / FLOP_T;
    const T3 = 0.46 / FLOP_T;
    if (lc > T0 && lc < T2) fx.dy = -2.6 * Math.sin(((lc - T0) / (T2 - T0)) * Math.PI);
    if (lc >= T1 - 0.02 && lc < T3) {
      const e = lc < T2 ? 0 : 1 - (lc - T2) / (T3 - T2);
      fx.sx = 1 + 0.08 * e;
      fx.sy = 1 - 0.1 * e;
    }
  }
  const make = (): MawRaw => {
    let r = rig();
    if (flin) r = flinch(r);
    if (x.rage >= 0 && !thr) r = enrage(r, rageK(x.rage));
    return cropMaw(drawMaw(r, { ...draw, rage: x.rage >= 0 ? rageK(x.rage) : 0 }));
  };
  const rq = x.rage >= 0 && !thr ? Math.round(rageK(x.rage) * 4) : -1;
  return {
    key: `${key}|${flin ? 'h' : ''}|${rq}|${x.ph >= 2 ? 'g' : ''}`,
    fx,
    make,
  };
}

/** Сцена смены фазы: 0,9 с — вспыхнула, заревела, отпустило. */
const rageK = (s: number) =>
  s < 0.12 ? s / 0.12 : s < 0.62 ? 1 : Math.max(0, 1 - (s - 0.62) / 0.28);

function crawlSpec(x: MawCtx): MawSpec {
  const fi = Math.floor(x.t * 12) % 10;
  const ph = fi / 10;
  const fx: MawFx = { ...FX0, dy: -0.6 * Math.max(0, Math.sin(((x.t * 12) / 10) * Math.PI * 4)) };
  const rq = x.rage >= 0 ? Math.round(rageK(x.rage) * 4) : -1;
  return {
    key: `crawl|${fi}|${x.hurt ? 'h' : ''}|${rq}|${x.ph >= 2 ? 'g' : ''}`,
    fx,
    make: () => {
      let r = crawlRig(ph);
      if (x.hurt) r = flinch(r);
      if (rq >= 0) r = enrage(r, rq / 4);
      return cropMaw(drawMaw(r, { hunger: x.ph >= 2, rage: rq >= 0 ? rq / 4 : 0 }));
    },
  };
}

function swimSpec(x: MawCtx, fast: boolean): MawSpec {
  const n = 8;
  const fi = Math.floor(x.now * (fast ? 16 : 10)) % n;
  const ph = fi / n;
  const fx: MawFx = { ...FX0, shadow: 0 };
  const ent = x.entry >= 0 && x.entry < 0.42 ? Math.min(9, q24(x.entry)) : -1;
  return {
    key: `swim|${fast ? 1 : 0}|${fi}|${ent}`,
    fx,
    make: () => {
      let r = swimRig(ph, fast);
      if (ent >= 0) {
        // Нырнула с берега: уходит под воду по кадрам.
        const e = EZ.out(ent / 9);
        r = { ...r, sink: 2 + (r.sink - 2) * e, sail: e, jaw: 0.3 * (1 - e) + r.jaw * e };
      }
      const c = drawMaw(r, { water: true, ph, wake: fast ? 13 : 9 });
      if (ent >= 0) bubbles(c, 12 - ent, ent / 6, 14);
      else if (fi % 4 === 1) bubbles(c, 2, ph, 8);
      return cropMaw(c);
    },
  };
}

function roarSpec(x: MawCtx): MawSpec {
  const fi = Math.min(q24(x.t), q24(1.3) - 1);
  const fx: MawFx = { ...FX0 };
  if (x.t > F(9) && x.t < F(24)) {
    fx.dx = Math.sin(x.now * 55) * 0.7;
    fx.dy = -0.8;
  }
  return {
    key: `roar|${fi}`,
    fx,
    make: () => {
      let r = roarRig(F(fi));
      // Рёв — дрожь челюсти и головы через кадр.
      if (fi > 9 && fi < 24)
        r = { ...r, hd: r.hd + (fi % 2 ? 0.05 : -0.03), jaw: r.jaw + (fi % 2 ? 0.04 : -0.04) };
      const c = drawMaw(r);
      if (fi >= 9 && fi < 25) {
        // Брызги слюны из пасти — летят по дуге.
        for (let i = 0; i < 6; i++) {
          const h = hash(i, fi >> 1, 31);
          const s = ((fi - 9 + i * 2.7) % 8) / 8;
          const [px, py] = c.h.at(6 + s * 14 + (h % 3), -1 - s * 6 + s * s * 12 + ((h >> 4) % 3));
          c.p.set(px, py, hex('#f6eedc', Math.round(220 * (1 - s))));
        }
      }
      if (fi >= 24) {
        // Выдохнула: пар из ноздрей вьётся вверх и тает.
        const k = (fi - 24) / 7;
        for (let i = 0; i < 5; i++) {
          const s = clamp(k * 1.3 - i * 0.12, 0, 1);
          if (s <= 0 || s >= 1) continue;
          const [nx, ny] = c.h.at(6.5 + s * 3, -3 - s * 9);
          const wob = Math.sin(s * 7 + i) * 1.2;
          c.p.set(nx + wob, ny, [226, 214, 208, Math.round(170 * (1 - s))]);
          if (s > 0.3) c.p.set(nx + wob + 1, ny, [226, 214, 208, Math.round(110 * (1 - s))]);
        }
      }
      return cropMaw(c);
    },
  };
}

function deathSpec(x: MawCtx): MawSpec {
  const fi = Math.min(q24(x.t), q24(1.4) - 1);
  const t = F(fi);
  const fx: MawFx = { ...FX0, linger: 1.4 };
  if (!x.wet) {
    // Судороги — подскоки; перевернулась — сплющило на миг; тает.
    if (x.t < F(6)) fx.dy = -3 * Math.sin((x.t / F(6)) * Math.PI);
    else if (x.t < F(11)) fx.dy = -1.5 * Math.sin(((x.t - F(6)) / F(5)) * Math.PI);
    if (x.t > F(12) && x.t < F(18)) fx.sy = 1 - 0.35 * Math.sin(((x.t - F(12)) / F(6)) * Math.PI);
    if (x.t > 1.0) {
      const k = (x.t - 1) / 0.4;
      fx.alpha = 1 - k;
      fx.sy = 1 - 0.25 * k;
      fx.sx = 1 + 0.08 * k;
    }
  } else {
    fx.shadow = 0;
    if (x.t > 1.1) fx.alpha = 1 - (x.t - 1.1) / 0.3;
  }
  if (x.t < 0.1) fx.dx = 2 * (1 - x.t / 0.1);
  return {
    key: `die|${x.wet ? 'w' : 'l'}|${fi}`,
    fx,
    make: () => {
      if (x.wet) {
        const c = drawMaw(dieWater(t), { water: true, ph: fi / 8 });
        bubbles(c, fi < 14 ? 4 : 10, fi / 6, 12);
        return cropMaw(c);
      }
      const c = drawMaw(dieLand(t));
      if (t > 0.72) {
        // Алая лужа растекается из-под тела, пар поднимается.
        const k = clamp((t - 0.72) / 0.6, 0, 1);
        const rx = 8 + k * 14;
        for (let y = -3; y <= 3; y++)
          for (let xx = -rx; xx <= rx; xx++) {
            const e = (xx / rx) ** 2 + (y / (2 + k * 2)) ** 2;
            if (e <= 1)
              under(c.p, GX - 3 + xx, GY + y, [110, 12, 18, Math.round(150 * (1 - e * 0.5))]);
          }
        for (let i = 0; i < 6; i++) {
          const h = hash(i, 3, 77);
          const s = (k * 1.5 + (h % 100) / 100) % 1;
          c.p.set(GX - 14 + (h % 26), GY - 8 - s * 12, hex('#d8b0a8', Math.round(140 * (1 - s))));
        }
      }
      return cropMaw(c);
    },
  };
}

function mawSpec(x: MawCtx): MawSpec {
  switch (x.mode) {
    case 'dying':
      return deathSpec(x);
    case 'swim':
      return swimSpec(x, false);
    case 'tail':
      return swimSpec(x, true);
    case 'surface':
      return surfSpec(x);
    case 'spit':
      return spitSpec(x);
    case 'rise':
      return riseSpec(x);
    case 'leap':
      return leapSpec(x);
    case 'roar':
      return roarSpec(x);
    case 'crawl':
      return crawlSpec(x);
    default:
      return beachSpec(x);
  }
}

const mawRaws = frameLRU<MawRaw>(180);
const mawFrames = frameLRU<MobFrame>(400);
const mawLits = frameLRU<HTMLCanvasElement>(260);

function mawFrame(spec: MawSpec, left: boolean, flash: boolean): MobFrame {
  const fk = `${spec.key}|${left ? 1 : 0}|${flash ? 1 : 0}`;
  const hit = mawFrames.get(fk);
  if (hit) return hit;
  let raw = mawRaws.get(spec.key);
  if (!raw) raw = mawRaws.set(spec.key, spec.make());
  let p = raw.p;
  if (left) p = p.flipX();
  if (flash) p = p.tint(WHITE, 0.8);
  let lit: HTMLCanvasElement | null = null;
  if (raw.lit) {
    const lk = `${spec.key}|${left ? 1 : 0}`;
    lit = mawLits.get(lk) ?? mawLits.set(lk, (left ? raw.lit.flipX() : raw.lit).canvas());
  }
  const ax = left ? p.w - raw.ax : raw.ax;
  const eye = raw.eye ? ([left ? p.w - 1 - raw.eye[0] : raw.eye[0], raw.eye[1]] as V2) : null;
  return mawFrames.set(fk, { img: p.canvas(), ax, ay: raw.ay, eye, lit });
}

/** Что пасть делала до этого режима — для прыжка, нырка и смерти. */
interface MawMem {
  mode: string;
  prev: string;
  wetPrev: boolean;
  from: 'water' | 'land' | 'dive';
  wet: boolean;
  phase: number;
  phaseAt: number;
  diveAt: number;
}
const mawMem = new Map<number, MawMem>();

function mawCtx(m: Mob, pose: MobPose): MawCtx {
  const sim = paintSim();
  const ph = sim?.boss?.phase ?? m.data.vPh ?? 0;
  const haste = (sim?.boss?.t ?? 0) > 200 ? 1.25 : 1;
  let mem = mawMem.get(m.id);
  if (!mem) {
    mem = {
      mode: m.mode,
      prev: '',
      wetPrev: false,
      from: 'water',
      wet: false,
      phase: ph,
      phaseAt: -9,
      diveAt: -9,
    };
    mawMem.set(m.id, mem);
  }
  if (mem.mode !== m.mode) {
    const wasWet =
      mem.mode === 'swim' ||
      mem.mode === 'tail' ||
      mem.mode === 'surface' ||
      mem.mode === 'spit' ||
      (mem.mode === 'rise' && (m.data.ghost ?? 0) > 0);
    mem.prev = mem.mode;
    mem.wetPrev = wasWet;
    mem.mode = m.mode;
    if (m.mode === 'leap')
      mem.from = mem.prev === 'crawl' ? 'dive' : mem.prev === 'rise' && wasWet ? 'water' : 'land';
    if (m.mode === 'dying') mem.wet = wasWet;
    if (m.mode === 'swim' && (mem.prev === 'crawl' || mem.prev === 'leap' || mem.prev === 'roar'))
      mem.diveAt = pose.now;
  }
  if (ph > mem.phase) {
    mem.phase = ph;
    mem.phaseAt = pose.now;
  }
  const since = pose.now - mem.phaseAt;
  const rage = since >= 0 && since < 0.9 ? since : -1;
  const d = m.data;
  const flight: [number, number] | null =
    d.lx !== undefined && d.sx !== undefined
      ? [(d.lx - d.sx) * TS * (pose.left ? -1 : 1), (d.ly - d.sy) * TS]
      : null;
  return {
    mode: m.mode,
    t: m.t,
    now: pose.now,
    data: d,
    ph,
    haste,
    hurt: pose.anim === 'hurt',
    from: d.vFrom === 1 ? 'water' : d.vFrom === 2 ? 'land' : d.vFrom === 3 ? 'dive' : mem.from,
    wet: d.vWet === 1 ? true : mem.wet,
    rage,
    entry:
      m.mode === 'swim' && pose.now - mem.diveAt < 0.5 ? pose.now - mem.diveAt : (d.vEntry ?? -1),
    flight,
  };
}

registerMobPainter('f3_maw', (m: Mob, pose: MobPose) => {
  const x = mawCtx(m, pose);
  const spec = mawSpec(x);
  // Вспышка: под водой её не бывает; на смерти — только удар, добивший её
  // (копия долгой смерти держит `flash` таким, каким он был в миг гибели).
  const flash =
    pose.flash && x.mode !== 'swim' && x.mode !== 'tail' && !(x.mode === 'dying' && x.t > 0.12);
  const fr = mawFrame(spec, pose.left, flash);
  const fx = spec.fx;
  let dx = fx.dx;
  let dy = fx.dy;
  let sx = fx.sx;
  let sy = fx.sy;
  // Удар героя: отдача от него, тело вжимается.
  if (m.flash > 0 && m.mode !== 'dying') {
    const k = clamp(m.flash / 0.12, 0, 1);
    const hero = paintSim()?.hero;
    const away = hero ? Math.sign(m.x - hero.x) || (pose.left ? 1 : -1) : pose.left ? 1 : -1;
    const e = Math.sin(k * Math.PI * 0.5);
    dx += away * 2.4 * e;
    if (hero) dy += Math.sign(m.y - hero.y) * 0.8 * e;
    sx *= 1 + 0.05 * e;
    sy *= 1 - 0.07 * e;
  }
  // Смена фазы: дрожь всем телом.
  if (x.rage >= 0) dx += Math.sin(x.now * 58) * 0.9 * rageK(x.rage);
  return {
    ...fr,
    dx,
    dy,
    sx,
    sy,
    still: true,
    shadow: fx.shadow,
    ghost: fx.ghost ? { every: 0.035, life: 0.2, tint: '#ff4a32', alpha: 0.3 } : null,
    alpha: fx.alpha < 1 ? Math.max(0, fx.alpha) : undefined,
    linger: fx.linger,
  };
});

/**
 * Прогрев: всё, что игрок увидит в первом бою (рёв, ползком к воде, под
 * водой, подъём, прыжок, берег, плевок), — в обе стороны; потом прилив
 * (всплытие-волна, хлёст), пока не наберётся 340 кадров: кеш держит 400.
 */
registerMobWarm('f3_maw', function* () {
  const base: MawCtx = {
    mode: 'roar',
    t: 0,
    now: 0,
    data: { ghost: 1, T: 1.1, hop: 3.5 },
    ph: 0,
    haste: 1,
    hurt: false,
    from: 'water',
    wet: false,
    rage: -1,
    entry: -1,
    flight: [100, 0],
  };
  const plan: [string, number, number, Partial<MawCtx>?][] = [
    ['roar', 1.3, 1 / 24],
    ['crawl', 0.84, 1 / 12],
    ['swim', 0.8, 1 / 10],
    ['rise', 0.5, 1 / 24],
    ['leap', 1.1, 1.1 / 24],
    ['beached', 2.6, 1 / 24],
    ['spit', 1.1, 1 / 24],
    ['tail', 0.5, 1 / 16],
    ['surface', 1.55, 1 / 24, { data: { thr: 1 } }],
    ['beached', 1.8, 1 / 24, { data: { thr: 1 }, ph: 1 }],
  ];
  // Только новые кадры и не больше, чем держит кеш с запасом на бой.
  const done = new Set<string>();
  for (const [mode, dur, dt, extra] of plan)
    for (const left of [false, true])
      for (let t = 0; t < dur; t += dt) {
        const spec = mawSpec({ ...base, ...extra, mode, t, now: t });
        const fk = `${spec.key}|${left ? 1 : 0}`;
        if (done.has(fk)) continue;
        done.add(fk);
        mawFrame(spec, left, false);
        yield;
        if (done.size >= 340) return;
      }
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
