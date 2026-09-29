// Этаж 2 — рисунки кодом: монстры грота и Живые доспехи, обломки лат и
// клинок, грибы-великаны, дождевики, пустые латы на стойках, колонны,
// клетки грибницы, споровых луж, ручья и мостков, облака спор, крик
// мандрагоры, взмах меча, иконки вещей.
//
// Правила рисунка те же, что у крыс (`dungeon-rats.ts`): формы — овалы со
// светом сверху-слева по нормали, контур `#150f0b`, всё смотрит ВПРАВО
// (влево — зеркало), каждый кадр рисуется один раз и лежит в кеше. Палитра —
// ступени камня 0x72 плюс два акцента этажа: кислотно-зелёный (споры, слизь)
// и лиловый (свечение грибов и роя в латах).

// Порядок важен: плитки раньше рисунков (см. `dungeon-mobart.ts`).
import { x72 } from '../dungeon-tiles';
import { hex, mix, Px, TS } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import type { X72Name } from '../dungeon-x72-frames';
import { F2_GROT, F2_RUIN, MK } from './f2';

type RGBA = [number, number, number, number];

const INK = hex('#150f0b');
const WHITE: RGBA = [255, 255, 255, 255];
const BLACK: RGBA = [0, 0, 0, 255];
const GOLD = hex('#ffcc40');
const PALE = hex('#f4ece4');
export const TAU = Math.PI * 2;

// Акценты этажа.
const ACID = hex('#b6f24a');
const ACID_D = hex('#6a9a2a');
const VIO = hex('#b07cff');
const VIO_L = hex('#e8d4ff');
const VIO_D = hex('#5a3a8a');

const alpha = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], Math.round(a * 255)];
const q = (n: number, steps: number) => Math.max(0, Math.min(steps - 1, Math.floor(n * steps)));
const mod = (n: number, m: number) => ((n % m) + m) % m;

// ---------------------------------------------------------------------------
// Свет и формы.
// ---------------------------------------------------------------------------

/** Свет сверху-слева-спереди — как у крыс. */
const LX = -0.45;
const LY = -0.75;
const LZ = 0.5;

interface Ell {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

const inE = (e: Ell, x: number, y: number) => {
  const dx = (x + 0.5 - e.x) / e.rx;
  const dy = (y + 0.5 - e.y) / e.ry;
  return dx * dx + dy * dy <= 1;
};

/** Ступень палитры по нормали овала: [тень, тело, свет, блик]. */
function tone(pal: RGBA[], e: Ell, x: number, y: number, bias = 0): RGBA {
  const dx = (x + 0.5 - e.x) / e.rx;
  const dy = (y + 0.5 - e.y) / e.ry;
  const nz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
  const k = dx * LX + dy * LY + nz * LZ + bias;
  if (k > 0.8) return pal[3];
  if (k > 0.45) return pal[2];
  if (k > 0.05) return pal[1];
  return pal[0];
}

/** Залить овал со светотенью; `keep` — какие пиксели оставить (срез). */
function ball(
  px: Px,
  e: Ell,
  pal: RGBA[],
  keep?: (x: number, y: number) => boolean,
  bias = 0,
): void {
  for (let y = Math.floor(e.y - e.ry - 1); y <= Math.ceil(e.y + e.ry + 1); y++)
    for (let x = Math.floor(e.x - e.rx - 1); x <= Math.ceil(e.x + e.rx + 1); x++) {
      if (!inE(e, x, y) || (keep && !keep(x, y))) continue;
      px.set(x, y, tone(pal, e, x, y, bias));
    }
}

/** Лист / лепесток / перо: от основания по углу, ширина — дугой. */
function leaf(
  px: Px,
  bx: number,
  by: number,
  ang: number,
  len: number,
  wid: number,
  c: RGBA,
  mid?: RGBA,
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const R = Math.ceil(len + wid + 1);
  for (let y = Math.floor(by - R); y <= Math.ceil(by + R); y++)
    for (let x = Math.floor(bx - R); x <= Math.ceil(bx + R); x++) {
      const dx = x + 0.5 - bx;
      const dy = y + 0.5 - by;
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      if (u < 0 || u > len) continue;
      const w = wid * Math.sin((Math.PI * u) / len);
      if (Math.abs(v) > w) continue;
      px.set(x, y, mid && Math.abs(v) < 0.5 && u > len * 0.15 ? mid : c);
    }
}

/** Толстая линия (кругляшами). */
function thick(px: Px, x0: number, y0: number, x1: number, y1: number, r: number, c: RGBA): void {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    if (r <= 0.6) px.set(x, y, c);
    else px.ell(x, y, r, r, c);
  }
}

/** Выпуклый многоугольник (для пластин, клинков, щитов). */
function poly(px: Px, pts: [number, number][], c: RGBA | ((x: number, y: number) => RGBA)): void {
  let x0 = 1e9;
  let x1 = -1e9;
  let y0 = 1e9;
  let y1 = -1e9;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++)
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > cy !== yj > cy && cx < ((xj - xi) * (cy - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) px.set(x, y, typeof c === 'function' ? c(x, y) : c);
    }
}

// ---------------------------------------------------------------------------
// Кадр: облик, вспышка, зеркало, кеш.
// ---------------------------------------------------------------------------

const frames = new Map<string, MobFrame | null>();

function cachedFrame(key: string, make: () => MobFrame | null): MobFrame | null {
  const hit = frames.get(key);
  if (hit !== undefined) return hit;
  const f = make();
  frames.set(key, f);
  return f;
}

/**
 * Готовый рисунок (смотрит вправо) → кадр: альбинос белёсый, элита в
 * золотом канте, удар белым, влево — зеркало.
 */
function finish(
  src: Px,
  ax: number,
  ay: number,
  eye: [number, number] | null,
  o: { left: boolean; flash: boolean; look: MobPose['look'] },
): MobFrame {
  let p = src;
  if (o.look === 'albino') p = p.tint(PALE, 0.55);
  if (o.look === 'elite') {
    const q2 = new Px(p.w + 2, p.h + 2);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) q2.set(x + 1, y + 1, p.get(x, y));
    q2.outline(GOLD);
    p = q2;
    ax += 1;
    ay += 1;
    if (eye) eye = [eye[0] + 1, eye[1] + 1];
  }
  if (o.flash) p = p.tint(WHITE, 0.85);
  if (o.left) {
    p = p.flipX();
    ax = p.w - ax;
    if (eye) eye = [p.w - 1 - eye[0], eye[1]];
  }
  return { img: p.canvas(), ax, ay, eye };
}

const lookKey = (pose: MobPose) => `${pose.left ? 1 : 0}${pose.flash ? 1 : 0}${pose.look[0]}`;

// ---------------------------------------------------------------------------
// Гриб-топотун.
// ---------------------------------------------------------------------------

const SHR = {
  cap: [hex('#4a2620'), hex('#7a3a2c'), hex('#a8563a'), hex('#d88a5a')],
  spot: hex('#eadcc0'),
  spotD: hex('#b8a88a'),
  gill: hex('#5a3a30'),
  gillD: hex('#3a2420'),
  stalk: [hex('#7a6a58'), hex('#b8aa90'), hex('#dcd0b6'), hex('#f0e8d4')],
  foot: hex('#9a8a72'),
  footD: hex('#6e604e'),
  eye: hex('#1a1210'),
  eyeHi: hex('#f4ff9a'),
  mouth: hex('#3a2018'),
  spore: hex('#d4ff7a'),
};

interface ShroomPose {
  bob: number;
  sway: number;
  cw: number;
  ch: number;
  liftF: number;
  liftB: number;
  stepF: number;
  stepB: number;
  eyes: 'open' | 'shut' | 'x' | 'angry';
  mouth: 'frown' | 'open' | 'none';
  puff: boolean;
  flat?: boolean;
}

function shroomPx(s: ShroomPose): { px: Px; eye: [number, number] | null } {
  const W = 24;
  const H = 26;
  const GY = 24;
  const px = new Px(W, H);
  const cx = 11.5 + s.sway;
  if (s.flat) {
    // Лопнул: шляпка лежит на земле, ножка раскисла.
    ball(px, { x: cx, y: GY - 2, rx: 9, ry: 3 }, SHR.cap);
    px.ell(cx, GY - 0.5, 8, 1.2, SHR.gill);
    for (const [dx, dy] of [
      [-4, -3],
      [1, -3.5],
      [4, -2.5],
    ])
      px.ell(cx + dx, GY + dy, 1.2, 0.8, SHR.spot);
    px.outline(INK);
    return { px, eye: null };
  }
  // Ноги: дальняя — темнее.
  const foot = (fx: number, lift: number, far: boolean) => {
    px.ell(fx, GY - 1 - lift, 2.3, 1.4, far ? SHR.footD : SHR.foot);
    px.set(fx + 1.5, GY - 1 - lift, far ? SHR.footD : SHR.stalk[1]);
  };
  foot(cx - 2.5 + s.stepB, s.liftB, true);
  // Ножка — тумба с лицом.
  const stalk: Ell = { x: cx + 0.3, y: GY - 6.2 + s.bob * 0.4, rx: 4.4, ry: 5.2 };
  ball(px, stalk, SHR.stalk);
  foot(cx + 2.5 + s.stepF, s.liftF, false);
  // Шляпка: купол со срезанным низом, под ним — пластинки.
  const capY = GY - 11 + s.bob;
  const cap: Ell = { x: cx, y: capY, rx: 9.2 * s.cw, ry: 6.4 * s.ch };
  px.ell(cx, capY + 1.6, 8.4 * s.cw, 2.1, SHR.gill);
  for (let x = Math.round(cx - 7 * s.cw); x <= Math.round(cx + 7 * s.cw); x += 2)
    px.set(x, Math.round(capY + 2), SHR.gillD);
  ball(px, cap, SHR.cap, (_x, y) => y <= capY + 1);
  // Кромка шляпки — светлая полоса по краю: объём.
  for (let x = Math.round(cx - 8 * s.cw); x <= Math.round(cx + 8 * s.cw); x++)
    if (px.solid(x, Math.round(capY + 1))) px.set(x, Math.round(capY + 1), SHR.cap[1]);
  // Пятна на шляпке.
  const spots: [number, number, number][] = [
    [-4.2, -3.2, 1.6],
    [0.8, -4.6, 1.3],
    [4.6, -1.8, 1.4],
    [-0.6, -1.2, 1],
    [-6.8, -0.4, 0.9],
  ];
  for (const [dx, dy, r] of spots) {
    const sx = cx + dx * s.cw;
    const sy = capY + dy * s.ch;
    if (!inE(cap, Math.round(sx), Math.round(sy))) continue;
    px.ell(sx, sy, r, r * 0.85, SHR.spot);
    px.set(Math.round(sx + r * 0.5), Math.round(sy + r * 0.5), SHR.spotD);
  }
  // Лицо на ножке (справа — куда смотрит).
  const ey = Math.round(GY - 7 + s.bob * 0.4);
  const ex = Math.round(cx + 1.2);
  let eye: [number, number] | null = [ex + 2, ey];
  if (s.eyes === 'open' || s.eyes === 'angry') {
    px.rect(ex, ey, ex, ey + 1, SHR.eye);
    px.rect(ex + 2, ey, ex + 2, ey + 1, SHR.eye);
    if (s.eyes === 'angry') {
      px.set(ex - 1, ey - 1, SHR.eye);
      px.set(ex + 3, ey - 1, SHR.eye);
    }
  } else if (s.eyes === 'shut') {
    px.rect(ex, ey + 1, ex, ey + 1, SHR.eye);
    px.rect(ex + 2, ey + 1, ex + 2, ey + 1, SHR.eye);
    eye = null;
  } else {
    px.set(ex, ey, SHR.eye);
    px.set(ex + 1, ey + 1, SHR.eye);
    px.set(ex + 2, ey, SHR.eye);
    px.set(ex, ey + 2, SHR.eye);
    px.set(ex + 2, ey + 2, SHR.eye);
    eye = null;
  }
  if (s.mouth === 'frown') {
    px.set(ex, ey + 4, SHR.mouth);
    px.set(ex + 1, ey + 3, SHR.mouth);
    px.set(ex + 2, ey + 4, SHR.mouth);
  } else if (s.mouth === 'open') {
    px.rect(ex, ey + 3, ex + 2, ey + 4, SHR.mouth);
  }
  px.outline(INK);
  if (eye) px.set(eye[0], eye[1], SHR.eyeHi);
  if (s.puff) {
    // Чих спорами: облачко над шляпкой.
    for (const [dx, dy] of [
      [-3, -9],
      [0, -10],
      [3, -9],
      [-1, -12],
      [2, -12],
      [-4, -11],
      [4, -11],
    ])
      px.set(Math.round(cx + dx), Math.round(capY + dy + 2), alpha(SHR.spore, 0.85));
  }
  return { px, eye };
}

function shroomPose(m: Mob, pose: MobPose): ShroomPose {
  const base: ShroomPose = {
    bob: 0,
    sway: 0,
    cw: 1,
    ch: 1,
    liftF: 0,
    liftB: 0,
    stepF: 0,
    stepB: 0,
    eyes: 'open',
    mouth: 'frown',
    puff: (m.data.squish ?? 0) > 0,
  };
  if (base.puff) {
    base.cw = 1.1;
    base.ch = 0.84;
    base.bob = 1;
  }
  if (pose.mode === 'stomp') {
    // Замах: нога вверх, шляпка поднимается, откидывается назад.
    const k = Math.min(1, pose.t / 0.62);
    return {
      ...base,
      bob: -2 * k,
      sway: -1 * k,
      liftF: 4 * k,
      stepF: 1,
      ch: 1 + 0.08 * k,
      eyes: 'angry',
      mouth: 'open',
    };
  }
  if (pose.mode === 'recover' && pose.t < 0.22)
    return { ...base, bob: 2, cw: 1.16, ch: 0.78, eyes: 'angry', mouth: 'open' };
  switch (pose.anim) {
    case 'run': {
      const ph = (mod(pose.frame, 6) / 6) * TAU;
      return {
        ...base,
        sway: Math.sin(ph) * 0.8,
        liftF: Math.max(0, Math.sin(ph)) * 2,
        liftB: Math.max(0, -Math.sin(ph)) * 2,
        stepF: Math.cos(ph) * 1.2,
        stepB: -Math.cos(ph) * 1.2,
        bob: -Math.abs(Math.sin(ph)),
      };
    }
    case 'hurt':
      return { ...base, sway: -1, cw: 1.06, ch: 0.9, eyes: 'x', mouth: 'open' };
    case 'dead':
      return { ...base, flat: true };
    case 'sleep':
      return { ...base, bob: 1.5, eyes: 'shut', mouth: 'none' };
    case 'wind':
      return { ...base, bob: -1, eyes: 'angry' };
    default:
      return { ...base, bob: [0, 0.5, 1, 0.5][mod(pose.frame, 4)] };
  }
}

registerMobPainter('f2_shroom', (m, pose) => {
  const s = shroomPose(m, pose);
  const key = `shr|${JSON.stringify(s)}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const { px, eye } = shroomPx(s);
    return finish(px, 11.5, 24, eye, pose);
  });
});

// ---------------------------------------------------------------------------
// Грибёнок.
// ---------------------------------------------------------------------------

const SPR = {
  cap: [hex('#2e1e46'), hex('#5a3a86'), hex('#8a62c0'), hex('#c8a4ff')],
  glow: hex('#f0e4ff'),
  stalk: [hex('#8a8298'), hex('#c4bcd0'), hex('#e4def0'), hex('#ffffff')],
  eye: hex('#1a1220'),
};

function sproutPx(bob: number, lean: number, squat: number, legs: number, shut: boolean): Px {
  const px = new Px(16, 16);
  const GY = 14;
  const cx = 7.5;
  // Ножки.
  px.rect(Math.round(cx - 1.5 - legs), GY - 1, Math.round(cx - 1.5 - legs), GY, SPR.stalk[0]);
  px.rect(Math.round(cx + 1.5 + legs), GY - 1, Math.round(cx + 1.5 + legs), GY, SPR.stalk[1]);
  const by = GY - 3.4 + bob + squat * 0.5;
  ball(px, { x: cx + lean * 0.4, y: by, rx: 2.8, ry: 2.6 - squat * 0.4 }, SPR.stalk);
  // Шляпка — круглая, светится пятнами.
  const capY = by - 3.4 + squat * 0.8;
  const cap: Ell = { x: cx + lean, y: capY, rx: 5.2 + squat * 0.6, ry: 4 - squat * 0.6 };
  ball(px, cap, SPR.cap, (_x, y) => y <= capY + 1.4);
  for (const [dx, dy] of [
    [-2.5, -1.5],
    [1, -2.8],
    [3, -0.4],
  ]) {
    const x = Math.round(cap.x + dx);
    const y = Math.round(capY + dy);
    if (inE(cap, x, y)) px.set(x, y, SPR.glow);
  }
  // Глаза-бусинки.
  const ex = Math.round(cx + lean * 0.4 + 0.5);
  const ey = Math.round(by - 0.5);
  if (shut) {
    px.set(ex, ey + 1, SPR.eye);
    px.set(ex + 2, ey + 1, SPR.eye);
  } else {
    px.rect(ex, ey, ex, ey + 1, SPR.eye);
    px.rect(ex + 2, ey, ex + 2, ey + 1, SPR.eye);
  }
  px.outline(INK);
  return px;
}

registerMobPainter('f2_sprout', (m, pose) => {
  let bob = 0;
  let lean = 0;
  let squat = 0;
  let legs = 0;
  let shut = false;
  const f = pose.frame;
  switch (pose.anim) {
    case 'run': {
      const i = mod(f, 6);
      bob = -[0, 1, 2, 2, 1, 0][i];
      legs = [0, 1, 1, 1, 1, 0][i];
      break;
    }
    case 'wind':
      squat = 1;
      lean = -0.5;
      break;
    case 'bite':
      lean = 1.5;
      bob = -1;
      break;
    case 'hurt':
      lean = -1;
      shut = true;
      break;
    case 'sleep':
      squat = 0.6;
      shut = true;
      break;
    case 'dead':
      squat = 1.4;
      shut = true;
      break;
    default:
      bob = [0, 0, 1, 0][mod(f, 4)];
  }
  const key = `spr|${bob}|${lean}|${squat}|${legs}|${shut ? 1 : 0}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const px = sproutPx(bob, lean, squat, legs, shut);
    return finish(px, 7.5, 14, shut ? null : [Math.round(7.5 + lean * 0.4 + 2.5), 11], pose);
  });
});

// ---------------------------------------------------------------------------
// Сводовая слизь.
// ---------------------------------------------------------------------------

const SLM = {
  body: [hex('#2a5a22'), hex('#4a9a36'), hex('#78c850'), hex('#b8ec80')],
  rim: hex('#123012'),
  core: hex('#1c4418'),
  coreL: hex('#8adc5a'),
  bone: hex('#e8dfc8'),
  bubble: hex('#d8ffa8'),
  hi: hex('#f4ffe0'),
};

/**
 * Слизь: капля с плоским дном, внутри — ядро и недоеденное (косточка,
 * пузырь). Полупрозрачная: сквозь край видно пол.
 */
function slimePx(rx: number, ry: number, lift: number, drop: boolean, dead: boolean): Px {
  const W = Math.ceil(rx * 2 + 6);
  const H = Math.ceil(ry * 2 + lift + (drop ? 6 : 0) + 5);
  const px = new Px(W, H);
  const GY = H - 2;
  const cx = W / 2;
  const cy = GY - ry * 0.8 - lift;
  const e: Ell = { x: cx, y: cy, rx, ry };
  // Низ плоский: ниже центра овал сплюснут.
  const inBody = (x: number, y: number) => {
    const dx = (x + 0.5 - cx) / rx;
    const yy = y + 0.5 - cy;
    const dy = yy > 0 ? yy / (ry * 0.8) : yy / ry;
    return dx * dx + dy * dy <= 1;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inBody(x, y)) continue;
      let c = tone(SLM.body, e, x, y);
      // Дно темнее — слизь лежит на полу, а не висит.
      if (y >= GY - lift - 1 && !drop) c = SLM.body[0];
      // Край прозрачнее середины: сквозь кромку видно пол.
      const edge = !inBody(x - 1, y) || !inBody(x + 1, y) || !inBody(x, y - 1);
      px.set(x, y, dead ? mix(c, BLACK, 0.3) : alpha(c, edge ? 0.72 : 0.94));
    }
  if (drop) {
    // Хвостик капли сверху — ещё тянется со свода.
    for (let i = 1; i <= 5; i++)
      px.rect(
        Math.round(cx - 1 + i * 0.1),
        Math.round(cy - ry - i),
        Math.round(cx),
        Math.round(cy - ry - i),
        alpha(SLM.body[1], 0.85),
      );
  }
  if (!dead) {
    // Ядро (в темноте светится) и то, что внутри.
    px.ell(cx + rx * 0.15, cy + ry * 0.15, rx * 0.34, ry * 0.32, SLM.core);
    px.set(Math.round(cx + rx * 0.15), Math.round(cy + ry * 0.15), SLM.coreL);
    if (rx > 6) {
      px.line(
        Math.round(cx - rx * 0.5),
        Math.round(cy + ry * 0.2),
        Math.round(cx - rx * 0.2),
        Math.round(cy + ry * 0.35),
        SLM.bone,
      );
      px.set(Math.round(cx - rx * 0.55), Math.round(cy + ry * 0.12), SLM.bone);
    }
    px.set(Math.round(cx + rx * 0.45), Math.round(cy - ry * 0.1), SLM.bubble);
    px.set(Math.round(cx - rx * 0.1), Math.round(cy + ry * 0.45), SLM.bubble);
    // Блик — дугой слева сверху: влажный глянец.
    for (let a = 3.5; a <= 4.6; a += 0.18)
      px.set(
        Math.round(cx + Math.cos(a) * rx * 0.62),
        Math.round(cy + Math.sin(a) * ry * 0.62),
        SLM.hi,
      );
    px.set(Math.round(cx - rx * 0.62), Math.round(cy - ry * 0.05), SLM.body[3]);
  }
  px.outline(SLM.rim);
  return px;
}

registerMobPainter('f2_slime', (m, pose) => {
  const small = (m.data.gen ?? 0) > 0 || m.r < 0.3;
  let rx = small ? 5.4 : 7.8;
  let ry = small ? 4.2 : 5.8;
  let lift = 0;
  let drop = false;
  let dead = false;
  const f = pose.frame;
  const t = pose.t;
  if (pose.mode === 'hopAim') {
    const k = Math.min(1, t / 0.6);
    const qk = q(k, 4) / 3;
    rx *= 1 + 0.25 * qk;
    ry *= 1 - 0.3 * qk;
  } else if (pose.mode === 'hop') {
    const k = Math.min(1, t / 0.32);
    lift = Math.round(Math.sin(k * Math.PI) * 7);
    rx *= 0.84;
    ry *= 1.2;
  } else if (pose.mode === 'drop') {
    rx *= 0.72;
    ry *= 1.25;
    drop = true;
  } else if (pose.mode === 'recover' && t < 0.25) {
    rx *= 1.32;
    ry *= 0.62;
  } else
    switch (pose.anim) {
      case 'run': {
        const s = Math.sin((mod(f, 6) / 6) * TAU);
        rx *= 1 + 0.13 * s;
        ry *= 1 - 0.1 * s;
        break;
      }
      case 'hurt':
        rx *= 1.12;
        ry *= 0.88;
        break;
      case 'dead':
        rx *= 1.45;
        ry *= 0.35;
        dead = true;
        break;
      case 'sleep':
        ry *= 0.85;
        break;
      default: {
        const s = [0, 1, 0, -1][mod(f, 4)];
        rx *= 1 + 0.05 * s;
        ry *= 1 - 0.06 * s;
      }
    }
  rx = Math.round(rx * 2) / 2;
  ry = Math.round(ry * 2) / 2;
  const key = `slm|${rx}|${ry}|${lift}|${drop ? 1 : 0}|${dead ? 1 : 0}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const px = slimePx(rx, ry, lift, drop, dead);
    const GY = px.h - 2;
    const cx = px.w / 2;
    const cy = GY - ry * 0.8 - lift;
    return finish(
      px,
      cx,
      GY,
      dead ? null : [Math.round(cx + rx * 0.15), Math.round(cy + ry * 0.15)],
      pose,
    );
  });
});

// ---------------------------------------------------------------------------
// Мандрагора.
// ---------------------------------------------------------------------------

const MDR = {
  leaf: hex('#2f5a2a'),
  leafM: hex('#4f8a3a'),
  leafL: hex('#7cbc4e'),
  vein: hex('#a8dc70'),
  body: [hex('#6a4a3a'), hex('#a8785a'), hex('#d0a07a'), hex('#eac4a0')],
  root: hex('#8a5a44'),
  soil: hex('#3a2a20'),
  soilL: hex('#5a4030'),
  mouth: hex('#3a0a10'),
  tongue: hex('#b83a44'),
  eye: hex('#ff5a3a'),
  eyeD: hex('#2a1010'),
  flower: hex('#e86a8a'),
};

interface MandrakePose {
  /** 0 — в земле, 1 — весь снаружи. */
  out: number;
  /** Крик: пасть нараспашку, руки вверх. */
  scream: boolean;
  shake: number;
  /** Вялые листья (после крика). */
  wilt: boolean;
  sway: number;
  dead: boolean;
}

function mandrakePx(s: MandrakePose): { px: Px; eye: [number, number] | null } {
  const W = 20;
  const H = 26;
  const GY = 23;
  const px = new Px(W, H);
  const cx = 10 + s.shake;
  const sink = Math.round((1 - s.out) * 13);
  const clip = (y: number) => y <= GY;
  if (s.dead) {
    // Лежит корнем на боку.
    ball(px, { x: cx, y: GY - 2, rx: 6, ry: 2.6 }, MDR.body);
    for (let i = 0; i < 4; i++)
      leaf(px, cx - 6, GY - 2, Math.PI + 0.4 - i * 0.25, 5, 1.2, MDR.leafM);
    px.set(Math.round(cx + 2), GY - 3, MDR.eyeD);
    px.outline(INK);
    return { px, eye: null };
  }
  // Земляной холмик.
  px.ell(cx, GY, 6, 2, MDR.soil);
  px.ell(cx - 1, GY - 0.5, 4.5, 1.2, MDR.soilL);
  const top = GY - 13 + sink;
  // Тело-корень.
  if (s.out > 0.05) {
    const body: Ell = { x: cx, y: top + 7, rx: 4.3, ry: 5.6 };
    for (let y = Math.floor(body.y - body.ry); y <= Math.ceil(body.y + body.ry); y++)
      for (let x = Math.floor(body.x - body.rx); x <= Math.ceil(body.x + body.rx); x++)
        if (inE(body, x, y) && clip(y)) px.set(x, y, tone(MDR.body, body, x, y));
    // Бороздки на корне.
    for (const yy of [top + 4, top + 8, top + 11])
      if (clip(yy)) px.line(Math.round(cx - 2.5), yy, Math.round(cx - 1), yy + 1, MDR.body[0]);
    // Ручки-корешки.
    const arm = (side: number) => {
      const bx = cx + side * 3.8;
      const by = top + 6;
      const up = s.scream;
      const ex = bx + side * (up ? 2.5 : 1.5);
      const ey = up ? by - 5 : by + (s.wilt ? 5 : 3);
      if (clip(by)) thick(px, bx, by, ex, Math.min(GY, ey), 0.5, MDR.root);
      if (up && clip(ey)) {
        px.set(Math.round(ex + side), Math.round(ey - 1), MDR.root);
        px.set(Math.round(ex - side * 0.5), Math.round(ey - 1.5), MDR.root);
      }
    };
    arm(-1);
    arm(1);
    // Лицо.
    const fy = top + 5;
    if (clip(fy + 4)) {
      if (s.scream) {
        px.ell(cx + 0.5, fy + 4, 2.1, 2.6, MDR.mouth);
        px.ell(cx + 0.5, fy + 5.2, 1.2, 0.9, MDR.tongue);
        px.set(Math.round(cx - 1.5), fy, MDR.eyeD);
        px.set(Math.round(cx + 2.5), fy, MDR.eyeD);
        px.set(Math.round(cx - 2), fy - 1, MDR.eyeD);
        px.set(Math.round(cx + 3), fy - 1, MDR.eyeD);
      } else if (s.wilt) {
        px.rect(Math.round(cx - 2), fy + 1, Math.round(cx - 1), fy + 1, MDR.eyeD);
        px.rect(Math.round(cx + 2), fy + 1, Math.round(cx + 3), fy + 1, MDR.eyeD);
        px.set(Math.round(cx + 0.5), fy + 4, MDR.mouth);
      } else {
        px.set(Math.round(cx - 1.5), fy + 1, MDR.eyeD);
        px.set(Math.round(cx + 2.5), fy + 1, MDR.eyeD);
        px.rect(Math.round(cx - 0.5), fy + 3, Math.round(cx + 1.5), fy + 3, MDR.mouth);
      }
    }
  }
  // Листья — розеткой из макушки (или из земли, пока сидит).
  const ly = Math.min(GY - 1, top + 1);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const spread = s.scream ? 1.25 : s.wilt ? 1.6 : 0.95;
    let a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42 * spread + s.sway;
    if (s.wilt) a += (i < n / 2 ? -1 : 1) * 0.55;
    const len = (i === 2 ? 7.5 : 6) * (s.scream ? 1.1 : 1);
    leaf(px, cx, ly, a, len, 1.6, i % 2 ? MDR.leafM : MDR.leafL, MDR.vein);
  }
  // Цветок на макушке.
  if (!s.wilt) px.set(Math.round(cx), Math.round(ly - 7.5 + (s.scream ? -0.5 : 0)), MDR.flower);
  // Земля спереди прикрывает то, что ещё внизу.
  if (s.out < 1) {
    px.ell(cx, GY + 0.5, 6, 1.5, MDR.soil);
    px.rect(Math.round(cx - 5), GY, Math.round(cx + 5), GY + 1, MDR.soil);
  }
  px.outline(INK);
  let eye: [number, number] | null = null;
  if (s.scream && s.out >= 1) {
    const fy = top + 5;
    px.set(Math.round(cx - 1.5), fy, MDR.eye);
    px.set(Math.round(cx + 2.5), fy, MDR.eye);
    eye = [Math.round(cx + 2.5), fy];
    // Визг — чёрточки у головы.
    for (const [dx, dy] of [
      [-7, -2],
      [-8, 1],
      [7, -2],
      [8, 1],
      [-6, -5],
      [6, -5],
    ])
      px.set(Math.round(cx + dx), Math.round(fy + dy), alpha(hex('#fff2a0'), 0.9));
  }
  return { px, eye };
}

registerMobPainter('f2_mandrake', (m, pose) => {
  const t = pose.t;
  const f = pose.frame;
  const s: MandrakePose = {
    out: 1,
    scream: false,
    shake: 0,
    wilt: false,
    sway: [0, 0.08, 0, -0.08][mod(f, 4)],
    dead: false,
  };
  switch (pose.mode) {
    case 'emerge':
      s.out = 0;
      break;
    case 'rise':
      s.out = q(t / 0.4, 4) / 3;
      break;
    case 'scream':
      s.scream = true;
      s.shake = f % 2 ? 1 : 0;
      break;
    case 'tired':
    case 'stun':
      s.wilt = true;
      s.out = 0.8;
      break;
    case 'sink':
      s.out = 1 - q(t / 0.5, 4) / 4;
      s.wilt = true;
      break;
    case 'dying':
      s.dead = true;
      break;
  }
  if (pose.anim === 'dead') s.dead = true;
  const key = `mdr|${JSON.stringify(s)}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const { px, eye } = mandrakePx(s);
    return finish(px, 10, 23, eye, pose);
  });
});

// ---------------------------------------------------------------------------
// Сундучный рак (мимик). Сундук — тот же кадр атласа, что у настоящих
// тайников: пока он спит, отличить нельзя. Проснулся — лапы, стебельки глаз,
// клешня и зубастая пасть (кадры мимика из того же атласа).
// ---------------------------------------------------------------------------

const MIM = {
  chit: [hex('#3a1614'), hex('#6a2a22'), hex('#9a4430'), hex('#c8704a')],
  tip: hex('#e8a070'),
  eye: hex('#ffb04a'),
  stalk: hex('#5a2420'),
};

/** Сундук кодом — пока не пришёл атлас. */
function chestFallback(open: number): Px {
  const p = new Px(16, 16);
  const wood = hex('#8a4a22');
  const woodD = hex('#5a2a14');
  const band = hex('#d8a83a');
  p.rect(1, 7, 14, 15, wood);
  p.rect(1, 3 - open, 14, 7 - open, mix(wood, WHITE, 0.15));
  p.rect(1, 11, 14, 11, woodD);
  p.rect(3, 3 - open, 3, 15, band);
  p.rect(12, 3 - open, 12, 15, band);
  p.rect(7, 8, 8, 10, band);
  if (open) p.rect(2, 7 - open, 13, 7, hex('#1a0a08'));
  p.outline(INK);
  return p;
}

function chestPx(name: X72Name, open: number): Px {
  return x72(name) ?? chestFallback(open);
}

interface MimicPose {
  frame: 0 | 1 | 2;
  /** Лапы: 0 — спрятаны, 1 — стоит. */
  legs: number;
  /** Фаза шага. */
  step: number;
  /** Сдвиг корпуса вперёд (укус). */
  lunge: number;
  /** Приподнять крышку на пиксель (выдаёт себя). */
  peek: boolean;
  claw: number;
  dead: boolean;
}

function mimicPx(s: MimicPose): { px: Px; eye: [number, number] | null } {
  const W = 28;
  const H = 26;
  const GY = 24;
  const px = new Px(W, H);
  const lift = Math.round(s.legs * 4);
  const ox = 6 + s.lunge;
  const oy = GY - 15 - lift;
  // Лапы — по три с каждой стороны, суставом вверх.
  if (s.legs > 0 && !s.dead) {
    for (let i = 0; i < 3; i++) {
      for (const far of [true, false]) {
        const ph = s.step + i * 2.1 + (far ? Math.PI : 0);
        const bx = ox + 3 + i * 4.5 + (far ? 1 : 0);
        const by = oy + 13;
        const kx = bx + (i - 1) * 1.8 + Math.cos(ph) * 1.2;
        const ky = by - 1 - s.legs * 1.2 - Math.max(0, Math.sin(ph)) * 1.5;
        const fx = bx + (i - 1) * 3.2 + Math.cos(ph) * 1.5;
        const fy = GY - Math.max(0, Math.sin(ph)) * 1.5;
        const c = far ? MIM.chit[0] : MIM.chit[2];
        thick(px, bx, by, kx, ky, 0.5, c);
        thick(px, kx, ky, fx, fy, 0.5, far ? MIM.chit[1] : MIM.chit[3]);
        px.set(Math.round(fx), Math.round(fy), far ? MIM.chit[1] : MIM.tip);
      }
    }
  }
  // Сундук.
  const names: X72Name[] = [
    'chest_mimic_open_anim_f0',
    'chest_mimic_open_anim_f1',
    'chest_mimic_open_anim_f2',
  ];
  const base =
    s.legs > 0 || s.frame > 0
      ? chestPx(names[s.frame], s.frame)
      : chestPx('chest_full_open_anim_f0', 0);
  for (let y = 0; y < base.h; y++)
    for (let x = 0; x < base.w; x++) {
      const c = base.get(x, y);
      if (!c[3]) continue;
      // Крышка (верх сундука) приподнята на пиксель — сундук «дышит».
      const dy = s.peek && y < 8 ? -1 : 0;
      px.set(ox + x, oy + y + dy, c);
    }
  let eye: [number, number] | null = null;
  if (s.dead) {
    // Лапы кверху, сундук пуст.
    for (let i = 0; i < 3; i++) {
      const bx = ox + 4 + i * 4;
      thick(px, bx, oy + 2, bx + (i - 1) * 2, oy - 3, 0.5, MIM.chit[1]);
      px.set(bx + (i - 1) * 2, oy - 4, MIM.tip);
    }
  } else if (s.legs > 0) {
    // Стебельки глаз над крышкой и клешня спереди.
    const sy = oy + 1 - Math.round(s.legs * 2);
    for (const ex of [ox + 9, ox + 13]) {
      thick(px, ex, oy + 2, ex + 0.5, sy + 1, 0.4, MIM.stalk);
      px.set(ex, sy, MIM.eye);
      px.set(ex + 1, sy, MIM.eye);
    }
    eye = [ox + 13, sy];
    const cx0 = ox + 15;
    const cy0 = oy + 11;
    const open = s.claw;
    thick(px, cx0, cy0, cx0 + 3, cy0 - 1, 0.7, MIM.chit[2]);
    leaf(px, cx0 + 3, cy0 - 1, -0.5 - open * 0.5, 4, 1.3, MIM.chit[3]);
    leaf(px, cx0 + 3, cy0 - 1, 0.35 + open * 0.5, 3.5, 1.1, MIM.chit[2]);
  }
  px.outline(INK);
  if (eye) {
    px.set(eye[0], eye[1], MIM.eye);
    px.set(eye[0] - 4, eye[1], MIM.eye);
  }
  return { px, eye };
}

registerMobPainter('f2_mimic', (m, pose) => {
  const t = pose.t;
  const f = pose.frame;
  const s: MimicPose = {
    frame: 0,
    legs: 1,
    step: 0,
    lunge: 0,
    peek: false,
    claw: 0,
    dead: false,
  };
  switch (pose.mode) {
    case 'sleep':
      s.legs = 0;
      s.peek = (m.data.tw ?? 1) < 0;
      break;
    case 'spring':
      s.frame = t < 0.1 ? 1 : 2;
      s.legs = q(t / 0.25, 3) / 2;
      s.claw = 1;
      break;
    case 'lunge':
      s.frame = 2;
      s.claw = 1;
      s.lunge = t < 0.4 ? -1 : 2;
      break;
    case 'windup':
      s.frame = 2;
      s.claw = 1;
      s.lunge = -1;
      break;
    case 'close':
      s.legs = 1 - q(t / 0.45, 3) / 2;
      break;
    case 'dying':
      s.dead = true;
      s.frame = 2;
      break;
    default:
      if (pose.mode === 'recover' && t < 0.18) {
        s.frame = 1;
        s.lunge = 2;
      } else if (pose.anim === 'run') {
        s.step = (mod(f, 6) / 6) * TAU;
        s.frame = f % 3 === 0 ? 1 : 0;
      } else if (pose.anim === 'hurt') {
        s.frame = 1;
        s.lunge = -1;
      } else s.step = mod(f, 4) * 0.4;
  }
  const key = `mim|${JSON.stringify(s)}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const { px, eye } = mimicPx(s);
    return finish(px, 14 + (s.lunge > 0 ? 0 : 0), 24, eye, pose);
  });
});

// ---------------------------------------------------------------------------
// Хваталка.
// ---------------------------------------------------------------------------

const SNP = {
  vine: hex('#2a4a22'),
  vineM: hex('#3f6e30'),
  vineL: hex('#5f9a44'),
  pod: [hex('#3a1a2a'), hex('#6a2a40'), hex('#9a4a5a'), hex('#c87a84')],
  jaw: [hex('#2a4a22'), hex('#3f6e30'), hex('#6aa84a'), hex('#9fd06a')],
  mouth: hex('#8a1a2a'),
  mouthL: hex('#d84a5a'),
  tooth: hex('#efe6d0'),
  lure: hex('#ff4a6a'),
  leaf: hex('#2f5a2a'),
  leafL: hex('#4f8a3a'),
};

/** Голова-ловушка: две доли с зубами по кромке, `open` 0…1, смотрит по `ang`. */
function trapHead(px: Px, hx: number, hy: number, ang: number, open: number, R = 4): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const gap = open * 1.8;
  for (let y = Math.floor(hy - 7); y <= Math.ceil(hy + 7); y++)
    for (let x = Math.floor(hx - 7); x <= Math.ceil(hx + 7); x++) {
      const dx = x + 0.5 - hx;
      const dy = y + 0.5 - hy;
      const u = dx * ux + dy * uy;
      const v = -dx * uy + dy * ux;
      // Доли: верхняя и нижняя половины овала, раскрытые клином к морде.
      const opening = gap * Math.max(0, (u + R) / (2 * R));
      const vu = v + opening;
      const vl = v - opening;
      const inU = (u / R) ** 2 + (Math.min(0, vu) / (R * 0.65)) ** 2 <= 1 && vu <= 0.5;
      const inL = (u / R) ** 2 + (Math.max(0, vl) / (R * 0.65)) ** 2 <= 1 && vl >= -0.5;
      if (open > 0.1 && Math.abs(v) < opening && u > -R * 0.6 && (u / R) ** 2 < 1) {
        px.set(x, y, u > 1 ? SNP.mouthL : SNP.mouth);
        continue;
      }
      if (inU || inL) {
        const e: Ell = { x: hx, y: hy, rx: R, ry: R * 0.65 };
        px.set(x, y, tone(SNP.jaw, e, x, y));
      }
    }
  // Зубы по кромкам долей.
  if (open > 0.1)
    for (let i = -1; i <= 3; i++) {
      const u = i * 1.2;
      for (const s of [-1, 1]) {
        const v = s * (open * 1.8 * ((u + R) / (2 * R)) - 0.3);
        px.set(Math.round(hx + u * ux - v * uy), Math.round(hy + u * uy + v * ux), SNP.tooth);
      }
    }
  else {
    // Сомкнута: шов зубов посередине.
    for (let i = -2; i <= 3; i++)
      px.set(Math.round(hx + i * ux), Math.round(hy + i * uy), i % 2 ? SNP.tooth : SNP.jaw[0]);
  }
}

interface SnapPose {
  dir: number;
  /** Длина хлыста, клеток (0 — голова у корня). */
  reach: number;
  open: number;
  limp: boolean;
  sway: number;
  pull: number;
  dead: boolean;
}

function snapperPx(s: SnapPose): { px: Px; ax: number; ay: number; eye: [number, number] | null } {
  const reachPx = s.reach * TS;
  const R = Math.ceil(reachPx + 14);
  const W = R * 2;
  const H = R * 2;
  const px = new Px(W, H);
  const cx = R;
  const GY = R + 3;
  // Листья-розетка у корня (лежат на полу).
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.05 + i * 0.225) + (i % 2 ? 0.1 : 0);
    leaf(px, cx, GY - 1, Math.PI + a, 6, 1.5, i % 2 ? SNP.leaf : SNP.leafL);
  }
  // Луковица.
  ball(px, { x: cx, y: GY - 3, rx: 5, ry: 3.6 }, SNP.pod);
  px.set(cx - 2, GY - 5, SNP.pod[3]);
  // Куда голова.
  let hx: number;
  let hy: number;
  let ang = s.dir;
  if (s.dead) {
    hx = cx + 7;
    hy = GY - 1;
    ang = 0.3;
  } else if (s.reach > 0.05) {
    hx = cx + Math.cos(s.dir) * reachPx;
    hy = GY - 5 + Math.sin(s.dir) * reachPx + (s.limp ? 3 : 0);
  } else {
    // Покой: шея изогнута над луковицей, голова качается.
    hx = cx + 3 + s.sway - Math.cos(s.dir) * s.pull;
    hy = GY - 13 - Math.sin(s.dir) * s.pull * 0.6;
  }
  // Лоза: изогнутая кривая от луковицы к голове.
  const sx = cx;
  const sy = GY - 5;
  const mx = (sx + hx) / 2 + (s.reach > 0.05 ? -Math.sin(ang) * 3 : -4);
  const my = (sy + hy) / 2 + (s.reach > 0.05 ? Math.cos(ang) * 3 + (s.limp ? 3 : 0) : 2);
  const n = Math.max(8, Math.ceil(Math.hypot(hx - sx, hy - sy) * 1.5));
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    const x = (1 - tt) * (1 - tt) * sx + 2 * (1 - tt) * tt * mx + tt * tt * hx;
    const y = (1 - tt) * (1 - tt) * sy + 2 * (1 - tt) * tt * my + tt * tt * hy;
    const r = 1.8 - tt * 0.8;
    px.ell(x, y, r, r, SNP.vineM);
    px.set(Math.round(x - 0.5), Math.round(y - 1), SNP.vineL);
    // Шипы-листочки вдоль лозы.
    if (i % 6 === 3) px.set(Math.round(x + 1.5), Math.round(y - 1.5), SNP.leafL);
  }
  trapHead(px, hx, hy, ang, s.dead ? 0 : s.open, s.reach > 0.05 ? 5 : 4);
  px.outline(INK);
  // Приманка — светящаяся ягода на усике над головой.
  let eye: [number, number] | null = null;
  if (!s.dead) {
    const lx = Math.round(hx - Math.cos(ang) * 1 - 1);
    const ly = Math.round(hy - 4.5);
    px.set(lx, ly + 1, SNP.vine);
    px.set(lx, ly, SNP.lure);
    eye = [lx, ly];
  }
  return { px, ax: cx, ay: GY, eye };
}

/** Обрезать пустые поля кадра — большие кадры хлыста легче. */
function crop(px: Px, ax: number, ay: number, eye: [number, number] | null) {
  let x0 = px.w;
  let y0 = px.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < px.h; y++)
    for (let x = 0; x < px.w; x++)
      if (px.solid(x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0) return { px, ax, ay, eye };
  y1 = Math.max(y1, Math.ceil(ay));
  const out = new Px(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) out.set(x - x0, y - y0, px.get(x, y));
  return {
    px: out,
    ax: ax - x0,
    ay: ay - y0,
    eye: eye ? ([eye[0] - x0, eye[1] - y0] as [number, number]) : null,
  };
}

registerMobPainter('f2_snapper', (m, pose) => {
  const t = pose.t;
  const f = pose.frame;
  const dir16 = Math.round((mod(m.dir, TAU) / TAU) * 16) % 16;
  const dir = (dir16 / 16) * TAU;
  const len = Math.round((m.data.len ?? 3.3) * 2) / 2;
  const s: SnapPose = {
    dir: pose.left ? Math.PI : 0,
    reach: 0,
    open: 0,
    limp: false,
    sway: [0, 1, 0, -1][mod(f, 4)],
    pull: 0,
    dead: false,
  };
  let free = false;
  switch (pose.mode) {
    case 'aim': {
      const k = q(t / 0.75, 4) / 3;
      s.dir = dir;
      s.open = k;
      s.pull = 2 + k * 2;
      free = true;
      break;
    }
    case 'snap':
      s.dir = dir;
      s.reach = len * (t < 0.08 ? 0.6 : 1);
      s.open = 0;
      free = true;
      break;
    case 'retract': {
      const ext = Math.max(0, 1 - t / 1.2);
      s.dir = dir;
      s.reach = Math.round(len * q(ext, 4) * 4) / 12;
      s.open = 0.5;
      s.limp = true;
      free = true;
      if (s.reach < 0.2) {
        s.reach = 0;
        s.limp = false;
      }
      break;
    }
    case 'dying':
      s.dead = true;
      break;
  }
  if (pose.anim === 'dead') s.dead = true;
  const leftKey = free ? 0 : pose.left ? 1 : 0;
  const key = `snp|${JSON.stringify(s)}|${pose.flash ? 1 : 0}|${pose.look[0]}|${leftKey}`;
  return cachedFrame(key, () => {
    const r = snapperPx(s);
    const c = crop(r.px, r.ax, r.ay, r.eye);
    // Хлыст в свободном направлении не зеркалим: он уже смотрит куда надо.
    return finish(c.px, c.ax, c.ay, c.eye, { ...pose, left: false });
  });
});

// ---------------------------------------------------------------------------
// Монетный жук.
// ---------------------------------------------------------------------------

const BUG = {
  leg: hex('#2a1a10'),
  head: [hex('#1a120a'), hex('#3a2a1a'), hex('#5a4228'), hex('#7a5a38')],
  gold: [hex('#6a4a10'), hex('#b8841e'), hex('#e2b442'), hex('#fff0a0')],
  ruby: hex('#e0344a'),
  sapph: hex('#3a78e8'),
  emer: hex('#3ad878'),
};

function coinbugPx(step: number, bob: number, hurt: boolean, dead: boolean): Px {
  const px = new Px(20, 14);
  const GY = 12;
  const cx = 9;
  const cy = GY - 4.5 + bob;
  if (!dead)
    for (let i = 0; i < 3; i++) {
      const ph = step + i * 2.1;
      const bx = cx - 3.5 + i * 3.5;
      px.line(bx, cy + 2, bx + Math.cos(ph) * 1.5 - 0.5, GY - Math.max(0, Math.sin(ph)), BUG.leg);
    }
  // Голова с усами.
  ball(px, { x: cx + 6, y: cy + 1, rx: 2, ry: 1.8 }, BUG.head);
  px.line(cx + 7, cy - 0.5, cx + 9, cy - 3 + (hurt ? 1 : 0), BUG.leg);
  // Спина — горка монет.
  const shell: Ell = { x: cx, y: cy, rx: 6.2, ry: dead ? 2.4 : 4 };
  ball(px, shell, BUG.gold, (_x, y) => y <= cy + 2);
  const coins: [number, number][] = [
    [-3.5, -1],
    [0, -2.5],
    [3, -1],
    [-1, 0.8],
    [2.5, 1],
  ];
  for (const [dx, dy] of coins) {
    const x = Math.round(cx + dx);
    const y = Math.round(cy + dy);
    px.set(x, y, BUG.gold[3]);
    px.set(x + 1, y, BUG.gold[2]);
    px.set(x, y + 1, BUG.gold[0]);
  }
  px.set(Math.round(cx - 1), Math.round(cy - 1.5), BUG.ruby);
  px.set(Math.round(cx + 2), Math.round(cy - 2.8), BUG.sapph);
  px.set(Math.round(cx + 4), Math.round(cy + 0.5), BUG.emer);
  px.outline(INK);
  return px;
}

registerMobPainter('f2_coinbug', (_m, pose) => {
  const f = pose.frame;
  const run = pose.anim === 'run';
  const step = run ? (mod(f, 6) / 6) * TAU : 0;
  const bob = run ? -Math.round(Math.abs(Math.sin(step))) : 0;
  const hurt = pose.anim === 'hurt';
  const dead = pose.anim === 'dead';
  const key = `bug|${step.toFixed(2)}|${bob}|${hurt ? 1 : 0}|${dead ? 1 : 0}|${lookKey(pose)}`;
  return cachedFrame(key, () => finish(coinbugPx(step, bob, hurt, dead), 9, 12, [16, 7], pose));
});

// ---------------------------------------------------------------------------
// Живые доспехи.
// ---------------------------------------------------------------------------

const ARM = {
  steel: [hex('#26282c'), hex('#4b4e53'), hex('#7a7f86'), hex('#c4c8cc')],
  steelD: hex('#1a1b1e'),
  spec: hex('#eef2f6'),
  rust: hex('#7a3e22'),
  rustL: hex('#a85a30'),
  cloak: [hex('#2a0e12'), hex('#4a161c'), hex('#6e2228'), hex('#8a3434')],
  glow: VIO,
  glowL: VIO_L,
  blade: hex('#9aa0a8'),
  bladeL: hex('#e2e6ea'),
  bladeD: hex('#5a5e66'),
  gold: hex('#c8982a'),
  goldD: hex('#7a5a18'),
  grip: hex('#3a2418'),
  shield: [hex('#1e2638'), hex('#2e3a58'), hex('#465a80'), hex('#6a80a8')],
  rim: hex('#8a6a3a'),
  emblem: hex('#cdbfa6'),
  shell: hex('#e4d6b8'),
};

interface ArmorPose {
  /** Смещение всего корпуса вниз (присед, покачивание). */
  bob: number;
  /** Наклон вперёд, пиксели. */
  lean: number;
  /** Шаг: вынос передней ноги (−1…1). */
  stride: number;
  /** Шлем «плавает» над горлом. */
  helm: number;
  /** Меч: 'low' | 'up' | 'slash' | 'back' | 'thrust' | 'rest'. */
  sword: string;
  /** Подъём над землёй (прыжок), пиксели. */
  lift: number;
  /** Колени согнуты (присед перед прыжком, приземление). */
  crouch: number;
  /** Трещины и рой в щелях. */
  cracked: boolean;
  /** Сборка: 0 — одни ноги, 1 — всё на месте. */
  build: number;
  dizzy: boolean;
  glow: number;
  cape: number;
}

function swordAt(px: Px, hx: number, hy: number, ang: number, len: number, streak: boolean): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Клинок.
  for (let i = 3; i <= len; i++) {
    const x = hx + ux * i;
    const y = hy + uy * i;
    const w = i > len - 3 ? 0.5 : 1;
    px.set(Math.round(x), Math.round(y), ARM.blade);
    if (w >= 1) {
      px.set(Math.round(x - uy), Math.round(y + ux), ARM.bladeD);
      px.set(Math.round(x + uy * 0.8), Math.round(y - ux * 0.8), ARM.bladeL);
    }
  }
  // Крестовина и рукоять.
  for (let k = -2.5; k <= 2.5; k += 0.5)
    px.set(Math.round(hx + ux * 2.5 - uy * k), Math.round(hy + uy * 2.5 + ux * k), ARM.gold);
  thick(px, hx - ux * 1.5, hy - uy * 1.5, hx + ux * 2, hy + uy * 2, 0.6, ARM.grip);
  px.set(Math.round(hx - ux * 2.2), Math.round(hy - uy * 2.2), ARM.gold);
  if (streak) {
    // След взмаха — светлая дуга за клинком.
    for (let i = 6; i <= len; i += 1) {
      const a2 = ang - 0.35;
      px.set(
        Math.round(hx + Math.cos(a2) * i),
        Math.round(hy + Math.sin(a2) * i),
        alpha(WHITE, 0.55),
      );
    }
  }
}

function armorPx(s: ArmorPose): { px: Px; eye: [number, number] | null } {
  const W = 64;
  const H = 62;
  const GY = 58;
  const px = new Px(W, H);
  const cx = 26 + s.lean * 0.5;
  const base = GY - s.lift;
  const hip = base - 13 + s.bob + s.crouch * 3;
  const chestY = hip - 8;
  const shoulder = chestY - 5;
  const neck = shoulder - 2;
  const b = s.build;
  const drop = (from: number) => Math.round(Math.max(0, 1 - (b - from) / 0.25) * 16);
  const partOn = (from: number) => b >= from;
  const glow = s.glow > 0.6 ? ARM.glowL : ARM.glow;

  // Сборка: лиловые нити роя тянут части к телу.
  if (b < 1) {
    for (let i = 0; i < 4; i++) {
      const x = cx - 3 + i * 2.5;
      for (let y = Math.round(hip - 24); y < hip; y += 2)
        if ((y + i) % 3 === 0)
          px.set(Math.round(x + Math.sin(y * 0.7 + i) * 1.2), y, alpha(VIO, 0.7));
    }
  }

  // Плащ за спиной — рваный край, колышется.
  if (partOn(0.5)) {
    const top = shoulder - drop(0.5) + 1;
    for (let y = top; y < hip + 11; y++) {
      const k = (y - top) / (hip + 11 - top);
      const w0 = cx - 9 - k * 4 + Math.sin(k * 5 + s.cape) * 1.2;
      const w1 = cx + 1;
      for (let x = Math.round(w0); x <= w1; x++) {
        const rag = y > hip + 5 && (x * 7 + y * 3) % 5 === 0;
        if (rag) continue;
        const c = x < w0 + 2 ? ARM.cloak[0] : x < w0 + 5 ? ARM.cloak[1] : ARM.cloak[2];
        px.set(x, y, c);
      }
    }
  }

  // Щит — на дальней руке, за корпусом слева: край и эмблема видны.
  if (partOn(0.5)) {
    const sy = chestY - 2 - drop(0.5);
    const sx = cx - 11;
    const pts: [number, number][] = [
      [sx - 4.5, sy - 5],
      [sx + 5, sy - 5],
      [sx + 5, sy + 4],
      [sx + 0.3, sy + 11],
      [sx - 4.5, sy + 4],
    ];
    const e: Ell = { x: sx, y: sy + 1, rx: 6, ry: 9 };
    poly(px, pts, (x, y) => tone(ARM.shield, e, x, y));
    for (const [x0, y0, x1, y1] of [
      [sx - 4.5, sy - 5, sx + 5, sy - 5],
      [sx - 4.5, sy - 5, sx - 4.5, sy + 4],
      [sx - 4.5, sy + 4, sx + 0.3, sy + 11],
    ])
      px.line(x0, y0, x1, y1, ARM.rim);
    // Выцветший знак — гриб: крепость жила под ним, руины его пережили.
    ball(
      px,
      { x: sx + 0.3, y: sy, rx: 3, ry: 2.2 },
      [ARM.goldD, ARM.emblem, ARM.emblem, WHITE],
      (_x, y) => y <= sy + 0.5,
    );
    px.rect(Math.round(sx), Math.round(sy + 1), Math.round(sx + 1), Math.round(sy + 4), ARM.emblem);
    px.set(Math.round(sx - 1), Math.round(sy - 1), ARM.shield[1]);
  }

  // Ноги: дальняя темнее; бедро, наколенник, голень, сабатон.
  const leg = (off: number, far: boolean) => {
    const pal = far ? [ARM.steel[0], ARM.steel[0], ARM.steel[1], ARM.steel[2]] : ARM.steel;
    const fx = cx + off * 3 + (far ? -2 : 1);
    const knee = hip + 6 + s.crouch;
    const kx = fx + off * 1.5 + s.crouch * 1.5;
    const ax = fx + off * 3;
    thick(px, fx, hip + 1, kx, knee, 2, pal[1]);
    thick(px, fx - 1, hip + 1, kx - 1, knee, 0.6, pal[2]);
    thick(px, kx, knee, ax, base - 2, 1.8, pal[1]);
    thick(px, kx - 1, knee + 1, ax - 1, base - 3, 0.5, pal[2]);
    ball(px, { x: kx + 0.5, y: knee, rx: 2.2, ry: 1.8 }, pal);
    px.ell(ax + 2, base - 1, 3.4, 1.4, pal[1]);
    px.set(Math.round(ax + 4), base - 2, pal[3]);
    // Щель сустава — видно рой.
    px.set(Math.round(kx - 1), knee + 2, glow);
  };
  leg(-s.stride, true);

  // Юбка — две пластины.
  if (partOn(0.25)) {
    const d = drop(0.25);
    for (let i = 0; i < 2; i++) {
      const y = hip - 1 + i * 2 - d;
      const w = 6.8 + i * 0.8;
      for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
        const k = (x - (cx - w)) / (2 * w);
        px.set(x, y, k < 0.3 ? ARM.steel[2] : k < 0.85 ? ARM.steel[1] : ARM.steel[0]);
        px.set(x, y + 1, ARM.steel[0]);
      }
    }
  }
  leg(s.stride, false);

  // Кираса: гладкий нагрудник с ребром, пояс с пряжкой.
  if (partOn(0.25)) {
    const d = drop(0.25);
    const cy = chestY - d;
    const e: Ell = { x: cx + 1, y: cy, rx: 8, ry: 7.2 };
    ball(px, e, ARM.steel, (_x, y) => y <= cy + 4.5, 0.08);
    // Ребро — только верх груди, где свет.
    for (let y = Math.round(cy - 6); y <= Math.round(cy + 1); y++)
      px.set(Math.round(cx + 3), y, y < cy - 2 ? ARM.spec : ARM.steel[3]);
    // Пояс и пряжка.
    for (let x = Math.round(cx - 6); x <= Math.round(cx + 8); x++)
      if (px.solid(x, Math.round(cy + 4))) px.set(x, Math.round(cy + 4), ARM.grip);
    px.rect(
      Math.round(cx + 2),
      Math.round(cy + 3),
      Math.round(cx + 3),
      Math.round(cy + 5),
      ARM.gold,
    );
    // Ржавый потёк.
    px.line(Math.round(cx - 3), Math.round(cy), Math.round(cx - 2), Math.round(cy + 3), ARM.rust);
    if (s.cracked) {
      // Трещина и рой в ней: латы не держат.
      const pts: [number, number][] = [
        [cx - 1, cy - 6],
        [cx + 1, cy - 3],
        [cx - 1, cy],
        [cx + 1, cy + 3],
      ];
      for (let i = 0; i < pts.length - 1; i++)
        px.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ARM.glow);
      px.set(Math.round(cx), Math.round(cy - 2), ARM.glowL);
      px.set(Math.round(cx + 1), Math.round(cy + 1), ARM.shell);
      px.set(Math.round(cx - 1), Math.round(cy - 5), ARM.shell);
    }
  }

  // Наплечник дальний.
  if (partOn(0.5)) {
    const d = drop(0.5);
    ball(px, { x: cx - 5, y: shoulder - d + 1, rx: 3.6, ry: 2.8 }, [
      ARM.steel[0],
      ARM.steel[0],
      ARM.steel[1],
      ARM.steel[2],
    ]);
  }

  // Шлем: ведро с Т-прорезью, в прорези светится рой. Висит над горлом —
  // внутри пусто, и видно щель.
  let eye: [number, number] | null = null;
  if (partOn(0.75)) {
    const d = drop(0.75);
    const hy = neck - 5 - s.helm - d;
    const hx = cx + 2 + (s.dizzy ? 2 : 0);
    if (b >= 1)
      px.rect(Math.round(cx), Math.round(neck - 1), Math.round(cx + 3), Math.round(neck), glow);
    const e: Ell = { x: hx, y: hy, rx: 4.6, ry: 5.2 };
    ball(px, e, ARM.steel, (_x, y) => y <= hy + 4);
    for (let y = Math.round(hy - 6); y <= Math.round(hy - 2); y++)
      px.set(Math.round(hx), y, ARM.steel[3]);
    px.set(Math.round(hx), Math.round(hy - 6), ARM.spec);
    const vy = Math.round(hy);
    px.rect(Math.round(hx - 1), vy, Math.round(hx + 4), vy, ARM.steelD);
    px.rect(Math.round(hx + 2), vy, Math.round(hx + 2), vy + 3, ARM.steelD);
    px.set(Math.round(hx + 1), vy, glow);
    px.set(Math.round(hx + 3), vy, glow);
    px.set(Math.round(hx + 2), vy + 1, glow);
    eye = [Math.round(hx + 3), vy];
    if (s.dizzy)
      for (const [dx, dy] of [
        [-4, -8],
        [2, -10],
        [6, -7],
      ])
        px.set(Math.round(hx + dx), Math.round(hy + dy), hex('#ffe070'));
  }

  // Рука с мечом (ближняя) и сам меч.
  if (partOn(0.5)) {
    const d = drop(0.5);
    const sx = cx + 6;
    const sy = shoulder - d + 2;
    let hx = sx + 3;
    let hy = sy + 7;
    let ang = 1.2;
    let len = 20;
    let streak = false;
    switch (s.sword) {
      case 'up':
        hx = sx - 1;
        hy = sy - 5;
        ang = -2.3;
        break;
      case 'slash':
        hx = sx + 5;
        hy = sy + 5;
        ang = 0.95;
        streak = true;
        break;
      case 'back':
        hx = sx - 3;
        hy = sy + 3;
        ang = Math.PI - 0.05;
        len = 18;
        break;
      case 'thrust':
        hx = sx + 8;
        hy = sy + 3;
        ang = 0.02;
        len = 22;
        streak = true;
        break;
      case 'rest':
        hx = sx + 3;
        hy = sy + 8;
        ang = 1.45;
        break;
    }
    if (s.sword === 'slash') {
      // След рубящего взмаха: дуга от плеча сверху-сзади вниз-вперёд.
      for (let a = -2.2; a <= 0.9; a += 0.06) {
        const r = 17;
        const x = sx + Math.cos(a) * r;
        const y = sy + Math.sin(a) * r;
        px.set(Math.round(x), Math.round(y), alpha(WHITE, 0.35 + 0.5 * ((a + 2.2) / 3.1)));
        px.set(
          Math.round(x - Math.cos(a)),
          Math.round(y - Math.sin(a)),
          alpha(hex('#c8d4e8'), 0.35),
        );
      }
    }
    swordAt(px, hx, hy, ang, len, streak && s.sword === 'thrust');
    thick(px, sx, sy, hx, hy, 1.6, ARM.steel[1]);
    thick(px, sx - 0.5, sy - 0.5, hx - 0.5, hy - 0.5, 0.5, ARM.steel[2]);
    ball(px, { x: hx, y: hy, rx: 2, ry: 1.8 }, ARM.steel);
    // Ближний наплечник — большая пластина и пластина под ней.
    ball(px, { x: sx - 0.5, y: sy + 1.5, rx: 3.6, ry: 1.8 }, ARM.steel, (_x, y) => y <= sy + 2.5);
    ball(
      px,
      { x: sx - 0.5, y: sy - 0.5, rx: 4.4, ry: 2.8 },
      ARM.steel,
      (_x, y) => y <= sy + 1,
      0.1,
    );
    px.set(Math.round(sx - 2), Math.round(sy - 2), ARM.spec);
  }
  px.outline(INK);
  if (eye) px.set(eye[0], eye[1], glow);
  return { px, eye };
}

registerMobPainter('f2_armor', (m, pose) => {
  const t = pose.t;
  const f = pose.frame;
  const s: ArmorPose = {
    bob: 0,
    lean: 0,
    stride: 0,
    helm: 0,
    sword: 'low',
    lift: 0,
    crouch: 0,
    cracked: (m.data.angry ?? 0) > 0,
    build: 1,
    dizzy: false,
    glow: 0.4,
    cape: 0,
  };
  const i4 = mod(f, 4);
  switch (pose.mode) {
    case 'roar':
      s.sword = 'up';
      s.glow = 1;
      s.helm = 1;
      break;
    case 'rebuild':
      s.build = q(t / 0.95, 5) / 4;
      s.glow = 1;
      break;
    case 'swing': {
      const warn = m.data.warn ?? 0.72;
      if (t < warn) {
        s.sword = 'up';
        s.lean = -2;
        s.glow = 0.4 + (0.6 * q(t / warn, 3)) / 2;
      } else {
        s.sword = 'slash';
        s.lean = 3;
        s.glow = 1;
      }
      break;
    }
    case 'thrustAim':
      s.sword = 'back';
      s.lean = -1;
      s.crouch = 0.5;
      s.glow = 0.8;
      break;
    case 'lunge':
      s.sword = 'thrust';
      s.lean = 4;
      s.stride = 1;
      break;
    case 'crouch':
      s.crouch = 1;
      s.sword = 'up';
      s.glow = 0.8;
      break;
    case 'air': {
      const k = Math.min(1, t / 0.72);
      s.lift = Math.round(Math.sin(k * Math.PI) * 12);
      s.crouch = 0.6;
      s.sword = 'up';
      s.helm = 1;
      break;
    }
    case 'recover':
      s.sword = 'rest';
      s.lean = 1;
      s.bob = 1;
      break;
    case 'dizzy':
      s.sword = 'rest';
      s.dizzy = true;
      s.bob = 1;
      s.helm = -1;
      break;
    default:
      if (pose.anim === 'run') {
        const ph = (mod(f, 6) / 6) * TAU;
        s.stride = Math.sin(ph);
        s.bob = Math.round(Math.abs(Math.cos(ph)));
        s.helm = Math.round(Math.abs(Math.sin(ph + 0.8)));
        s.cape = ph;
      } else if (pose.anim === 'hurt') {
        s.lean = -2;
        s.glow = 1;
      } else if (pose.anim === 'dead') {
        s.build = 0.25;
        s.crouch = 1;
      } else {
        s.bob = [0, 0, 1, 1][i4];
        s.helm = [0, 1, 1, 0][i4];
        s.cape = i4 * 0.8;
        s.glow = [0.4, 0.5, 0.7, 0.5][i4];
      }
  }
  const key = `arm|${JSON.stringify(s)}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    const { px, eye } = armorPx(s);
    return finish(px, 26, 58, eye, pose);
  });
});

// ---------------------------------------------------------------------------
// Латник — моллюск роя: створки-ракушка, мягкое тело, стебельки глаз.
// ---------------------------------------------------------------------------

const MIT = {
  shell: [hex('#7a6650'), hex('#c4ae8a'), hex('#e8d8b4'), hex('#fffaf0')],
  rib: hex('#6a5640'),
  body: hex('#6a4a9a'),
  bodyL: hex('#9a7ad0'),
  eye: hex('#f0e0ff'),
};

function mitePx(open: number, bob: number, lean: number, stretch: number, flip: boolean): Px {
  const px = new Px(14, 12);
  const GY = 10;
  const cx = 6 + lean;
  // Тело — слизень под раковиной, вытянут вперёд.
  if (!flip) {
    px.ell(cx + 2 + stretch, GY - 1 + bob * 0.3, 3.2 + stretch, 1.4, MIT.body);
    px.set(Math.round(cx + 3 + stretch), GY - 2, MIT.bodyL);
    // Стебельки глаз.
    const ex = Math.round(cx + 4 + stretch);
    px.line(ex, GY - 2, ex + 1, GY - 5 - open, MIT.body);
    px.set(ex + 1, GY - 6 - open, MIT.eye);
  }
  // Раковина: веер со створками, рёбра к замку.
  const sy = GY - 3 + bob - (flip ? -1 : 0);
  const e: Ell = { x: cx, y: sy, rx: 4.6, ry: 3.6 };
  ball(px, e, MIT.shell, (_x, y) => (flip ? y >= sy - 1 : y <= sy + 1));
  for (let i = -2; i <= 2; i++)
    px.line(
      Math.round(cx - 3),
      Math.round(sy + 1),
      Math.round(cx + i * 1.8),
      Math.round(sy - 3 + Math.abs(i) * 0.6),
      MIT.rib,
    );
  if (open > 0 && !flip) {
    // Створки приоткрыты: тёмная щель и светящееся нутро.
    px.line(
      Math.round(cx - 3),
      Math.round(sy + 1.5),
      Math.round(cx + 4),
      Math.round(sy + 1.5 + open),
      VIO_D,
    );
    px.set(Math.round(cx + 2), Math.round(sy + 1.5 + open * 0.5), VIO);
  }
  px.outline(INK);
  return px;
}

registerMobPainter('f2_mite', (m, pose) => {
  const f = pose.frame;
  let open = 0;
  let bob = 0;
  let lean = 0;
  let stretch = 0;
  let flip = false;
  let shrink = 0;
  switch (pose.mode === 'hop' ? 'hop' : pose.anim) {
    case 'hop':
      // Прыжок от клинка: створки нараспашку, в воздухе.
      bob = -3;
      open = 2;
      lean = -1;
      break;
    case 'run': {
      const i = mod(f, 6);
      bob = -[0, 1, 1, 0, 0, 0][i];
      stretch = [0, 1, 2, 1, 0, 0][i];
      break;
    }
    case 'wind':
      open = 2;
      lean = -1;
      break;
    case 'bite':
      open = 1;
      stretch = 2;
      lean = 1;
      break;
    case 'hurt':
      lean = -1;
      break;
    case 'dead':
      flip = true;
      if (pose.mode === 'escape') {
        flip = false;
        shrink = q(pose.t / 0.4, 3);
      }
      break;
    default:
      open = [0, 1, 1, 0][mod(f, 4)];
  }
  const key = `mit|${open}|${bob}|${lean}|${stretch}|${flip ? 1 : 0}|${shrink}|${lookKey(pose)}`;
  return cachedFrame(key, () => {
    let px = mitePx(open, bob, lean, stretch, flip);
    if (shrink) {
      // Влезает в латы: съёживается.
      const k = 1 - shrink * 0.3;
      const out = new Px(px.w, px.h);
      for (let y = 0; y < px.h; y++)
        for (let x = 0; x < px.w; x++) {
          const sx = Math.round(7 + (x - 7) / k);
          const sy = Math.round(10 + (y - 10) / k);
          out.set(x, y, px.get(sx, sy));
        }
      px = out;
    }
    return finish(px, 7, 10, flip ? null : [Math.round(6 + lean + 5 + stretch), 4 - open], pose);
  });
});

// ---------------------------------------------------------------------------
// Обломки лат.
// ---------------------------------------------------------------------------

function platePx(part: number, tw: number): Px {
  const px = new Px(16, 12);
  const GY = 10;
  const P = ARM.steel;
  switch (part) {
    case 0: {
      // Шлем на боку, прорезью к зрителю — внутри темно.
      ball(px, { x: 8, y: GY - 3.5, rx: 5, ry: 3.6 }, P);
      px.rect(6, GY - 4, 11, GY - 4, ARM.steelD);
      px.rect(9, GY - 4, 9, GY - 2, ARM.steelD);
      px.set(8, GY - 4, tw > 0.5 ? VIO_L : VIO);
      break;
    }
    case 1: {
      // Кираса вверх дном.
      ball(px, { x: 8, y: GY - 3, rx: 6.2, ry: 3.4 }, P);
      px.line(8, GY - 6, 8, GY - 1, ARM.steel[3]);
      px.set(4, GY - 3, ARM.rust);
      break;
    }
    case 2: {
      // Наплечник — три пластины веером.
      for (let i = 0; i < 3; i++)
        ball(px, { x: 6 + i * 2, y: GY - 2 - i * 0.6, rx: 3, ry: 1.8 }, P);
      break;
    }
    case 3: {
      // Латная перчатка — пальцы в щепоть.
      ball(px, { x: 7, y: GY - 2, rx: 3.5, ry: 2 }, P);
      for (let i = 0; i < 3; i++) px.line(10, GY - 3 + i, 12, GY - 3 + i, P[i === 1 ? 2 : 1]);
      break;
    }
    default: {
      // Поножа с сабатоном.
      thick(px, 3, GY - 3, 10, GY - 2, 1.5, P[1]);
      thick(px, 3, GY - 4, 10, GY - 3, 0.4, P[2]);
      px.ell(12, GY - 1.5, 2.6, 1.3, P[1]);
      break;
    }
  }
  // Слизь роя — лиловые потёки.
  px.set(4, GY - 1, alpha(VIO, 0.8));
  px.outline(INK);
  return px;
}

registerMobPainter('f2_plate', (m, pose) => {
  const part = m.data.part ?? 0;
  const tw = m.data.tw ?? 0;
  // Дрожь: чем ближе сборка, тем чаще кадр со сдвигом.
  const jitter = tw > 0.2 && mod(pose.frame, Math.max(2, Math.round(6 - tw * 4))) === 0 ? 1 : 0;
  const hot = tw > 0.5 ? 1 : 0;
  const key = `plt|${part}|${jitter}|${hot}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}`;
  return cachedFrame(key, () =>
    finish(platePx(part, tw), 8 - jitter, 10, null, { ...pose, look: 'normal' }),
  );
});

// ---------------------------------------------------------------------------
// Живой клинок — меч лат летает сам: рой в рукояти.
// ---------------------------------------------------------------------------

function bladePx(dir16: number, stab: boolean): { px: Px; ax: number; ay: number } {
  const px = new Px(40, 40);
  const cx = 20;
  const cy = 20;
  const ang = (dir16 / 16) * TAU;
  const hx = cx - Math.cos(ang) * 9;
  const hy = cy - Math.sin(ang) * 9;
  swordAt(px, hx, hy, ang, 20, stab);
  // Лиловые нити роя у рукояти.
  for (let i = 0; i < 4; i++) {
    const a = ang + Math.PI + (i - 1.5) * 0.5;
    px.set(Math.round(hx + Math.cos(a) * 3), Math.round(hy + Math.sin(a) * 3), alpha(VIO, 0.8));
  }
  px.set(Math.round(hx), Math.round(hy), VIO_L);
  px.outline(INK);
  px.set(Math.round(hx - Math.cos(ang) * 2.2), Math.round(hy - Math.sin(ang) * 2.2), VIO_L);
  return { px, ax: cx, ay: cy + 8 };
}

registerMobPainter('f2_blade', (m, pose) => {
  let d = m.dir;
  if (pose.mode === 'hover' || pose.mode === 'gather')
    d = Math.PI / 2 + Math.sin(pose.frame * 0.7) * 0.2;
  const dir16 = Math.round((mod(d, TAU) / TAU) * 16) % 16;
  const stab = pose.mode === 'stab';
  const key = `bld|${dir16}|${stab ? 1 : 0}|${pose.flash ? 1 : 0}`;
  return cachedFrame(key, () => {
    const b = bladePx(dir16, stab);
    const c = crop(b.px, b.ax, b.ay, null);
    return finish(c.px, c.ax, c.ay, null, { ...pose, left: false, look: 'normal' });
  });
});

// ---------------------------------------------------------------------------
// Предметы этажа: грибы-великаны, дождевики, латы на стойке, колонна.
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();
function cachedSprite(key: string, make: () => Px, ax: number, ay: number): Sprite {
  let s = sprites.get(key);
  if (!s) {
    s = { img: make().canvas(), ax, ay };
    sprites.set(key, s);
  }
  return s;
}

const BIG = {
  vio: {
    cap: [hex('#2a1a46'), hex('#4a2e7a'), hex('#7050b0'), hex('#a888e0')],
    glow: [hex('#c8a8ff'), hex('#f0e4ff')],
    gill: hex('#3a2a5a'),
  },
  grn: {
    cap: [hex('#1e3a22'), hex('#2e5a30'), hex('#4a8a44'), hex('#7cc05a')],
    glow: [hex('#b6f24a'), hex('#eaffb0')],
    gill: hex('#284a24'),
  },
  stalk: [hex('#6a6456'), hex('#a8a08a'), hex('#d0c8b0'), hex('#ece6d4')],
};

function bigCapPx(green: boolean, pulse: number): Px {
  const px = new Px(32, 38);
  const pal = green ? BIG.grn : BIG.vio;
  const GY = 36;
  const cx = 16;
  // Корни-лапы у основания.
  for (const [dx, a] of [
    [-3, Math.PI - 0.4],
    [3, 0.4],
    [-1, Math.PI - 1.1],
  ] as [number, number][])
    leaf(px, cx + dx, GY - 1, a, 5, 1.2, BIG.stalk[1]);
  // Ножка — толстая, чуть изогнута.
  for (let y = GY - 20; y <= GY; y++) {
    const k = (y - (GY - 20)) / 20;
    const w = 3 + k * 1.5;
    const off = Math.sin(k * 2) * 1.2;
    const e: Ell = { x: cx + off, y, rx: w, ry: 1 };
    for (let x = Math.floor(cx + off - w); x <= Math.ceil(cx + off + w); x++)
      px.set(x, y, tone(BIG.stalk, { ...e, ry: 3 }, x, y));
  }
  // Кольцо на ножке.
  px.ell(cx + 0.8, GY - 14, 4.6, 1.2, BIG.stalk[2]);
  // Шляпка.
  const capY = GY - 22;
  if (green) {
    // Зонтик: широкий и плоский, с зубчатым краем.
    const e: Ell = { x: cx, y: capY + 2, rx: 14, ry: 6 };
    px.ell(cx, capY + 4, 12.5, 2, pal.gill);
    ball(px, e, pal.cap, (_x, y) => y <= capY + 3);
    for (let x = cx - 13; x <= cx + 13; x += 3) px.set(x, capY + 4, pal.cap[1]);
  } else {
    // Колокол: высокий купол.
    const e: Ell = { x: cx, y: capY + 1, rx: 12, ry: 9 };
    px.ell(cx, capY + 4, 10.5, 2, pal.gill);
    ball(px, e, pal.cap, (_x, y) => y <= capY + 3);
  }
  // Светящиеся пятна — дышат.
  const spots: [number, number][] = green
    ? [
        [-8, 0],
        [-3, -2],
        [3, -1],
        [8, 1],
        [0, 1],
      ]
    : [
        [-6, -2],
        [-1, -6],
        [4, -3],
        [7, 1],
        [-8, 2],
        [1, -1],
      ];
  spots.forEach(([dx, dy], i) => {
    const on = (i + pulse) % 3 === 0;
    const c = on ? pal.glow[1] : pal.glow[0];
    px.set(cx + dx, capY + dy, c);
    px.set(cx + dx + 1, capY + dy, c);
    if (on) px.set(cx + dx, capY + dy - 1, pal.glow[0]);
  });
  px.outline(INK);
  return px;
}

registerPropPainter('f2_bigcap', (_o, time) => {
  const p = Math.floor(time * 1.5) % 3;
  return cachedSprite(`bigv|${p}`, () => bigCapPx(false, p), 16, 37);
});
registerPropPainter('f2_bigcap_g', (_o, time) => {
  const p = Math.floor(time * 1.3 + 1) % 3;
  return cachedSprite(`bigg|${p}`, () => bigCapPx(true, p), 16, 37);
});

registerPropPainter('f2_puffs', (_o, _time, alive, flash) => {
  if (!alive) return null;
  return cachedSprite(
    `puffs|${flash ? 1 : 0}`,
    () => {
      const px = new Px(18, 14);
      const pal = [hex('#8a7a58'), hex('#c8b88a'), hex('#e8dcb4'), hex('#fff8e0')];
      ball(px, { x: 6, y: 8, rx: 4.2, ry: 3.8 }, pal);
      ball(px, { x: 12, y: 9, rx: 3.4, ry: 3 }, pal);
      ball(px, { x: 9, y: 5.5, rx: 3, ry: 2.8 }, pal);
      // Пора на макушках — отсюда пыхнет.
      px.set(9, 3, hex('#5a4a30'));
      px.set(6, 5, hex('#5a4a30'));
      px.set(4, 7, pal[3]);
      px.set(11, 7, pal[3]);
      px.outline(INK);
      return flash ? px.tint(WHITE, 0.85) : px;
    },
    9,
    13,
  );
});

registerPropPainter('f2_stand', () =>
  cachedSprite(
    'stand',
    () => {
      // Пустые латы на деревянной стойке — такие же, как босс. Или нет?
      const px = new Px(18, 30);
      const wood = hex('#5a3a22');
      const woodL = hex('#7a5232');
      px.rect(8, 8, 9, 28, wood);
      px.rect(8, 8, 8, 28, woodL);
      px.rect(4, 27, 13, 28, wood);
      px.rect(3, 12, 14, 13, wood);
      ball(px, { x: 9, y: 15, rx: 5.4, ry: 5 }, ARM.steel, (_x, y) => y <= 18);
      px.line(9, 11, 9, 18, ARM.steel[3]);
      px.set(6, 14, ARM.rust);
      ball(px, { x: 9, y: 6, rx: 3.6, ry: 4 }, ARM.steel, (_x, y) => y <= 9);
      px.rect(8, 6, 12, 6, ARM.steelD);
      px.rect(10, 6, 10, 8, ARM.steelD);
      // Пыль и грибница на плечах.
      px.set(5, 11, hex('#d8d0c0'));
      px.set(13, 12, hex('#d8d0c0'));
      px.outline(INK);
      return px;
    },
    9,
    29,
  ),
);

registerPropPainter('f2_column', () =>
  cachedSprite(
    'column',
    () => {
      // Колонна крепости: капитель, ствол с желобками, обломанный край,
      // трутовики и грибница у подножия.
      const px = new Px(18, 40);
      const S = [hex('#26262c'), hex('#44454d'), hex('#6e717c'), hex('#a3a6b0')];
      const e: Ell = { x: 9, y: 20, rx: 5.5, ry: 20 };
      for (let y = 6; y <= 37; y++)
        for (let x = 3; x <= 14; x++) {
          let c = tone(S, e, x, y);
          if ((x - 3) % 3 === 2) c = mix(c, BLACK, 0.25);
          px.set(x, y, c);
        }
      px.rect(1, 36, 16, 38, S[1]);
      px.rect(1, 36, 16, 36, S[2]);
      // Обломанный верх.
      px.rect(2, 4, 15, 6, S[2]);
      px.rect(2, 6, 15, 6, S[1]);
      px.set(4, 3, S[2]);
      px.set(5, 3, S[2]);
      px.set(12, 3, S[2]);
      // Трутовики.
      for (const [x, y] of [
        [3, 24],
        [14, 18],
        [3, 30],
      ]) {
        px.ell(x, y, 2.4, 1.1, hex('#b87a3a'));
        px.set(x - 1, y - 1, hex('#e8b070'));
      }
      // Мох и грибница ползут по подножию.
      for (let x = 2; x <= 15; x++) {
        const h = 1 + ((x * 7) % 5 === 0 ? 3 : (x * 3) % 4 === 0 ? 2 : 0);
        for (let k = 0; k < h; k++)
          px.set(x, 35 - k, k === h - 1 ? hex('#5b7a2c') : hex('#3d5620'));
      }
      px.set(6, 35, VIO);
      px.set(11, 35, VIO_L);
      px.outline(INK);
      return px;
    },
    9,
    39,
  ),
);

// ---------------------------------------------------------------------------
// Клетки грота и руин.
// ---------------------------------------------------------------------------

const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

const MYC = {
  thread: hex('#b4aac8', 105),
  threadD: hex('#877d9e', 95),
  hub: hex('#e4dcf4', 170),
  hubD: hex('#6e6488', 150),
};

/** Сглаженный шум в пикселях мира — узоры сшиваются между клетками. */
function vnoise(x: number, y: number, s: number, seed: number): number {
  const r = (a: number, b: number) => (hash(a, b, seed) & 0xffff) / 0xffff;
  const xi = Math.floor(x / s);
  const yi = Math.floor(y / s);
  const fx = x / s - xi;
  const fy = y / s - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = r(xi, yi) * (1 - u) + r(xi + 1, yi) * u;
  const b2 = r(xi, yi + 1) * (1 - u) + r(xi + 1, yi + 1) * u;
  return a * (1 - v) + b2 * v;
}

const isMycel = (m: number) => m === MK.mycel || m === MK.glowG || m === MK.glowV;

/**
 * Грибница: белёсый пушок — облачко полупрозрачных точек вокруг узла, от
 * него пара нитей к соседям-грибнице (точка на общей границе известна обеим
 * клеткам — нить не рвётся на шве). Длинные сплошные нити читались
 * трещинами в полу, пушок — живым налётом.
 */
function mycelPx(c: CellCtx, px: Px, dense = 1): void {
  const h = hash(c.wx, c.wy, 7);
  const hx = 4 + (h % 8);
  const hy = 4 + ((h >>> 3) % 8);
  // Пушок.
  const dots = Math.round((14 + (h % 10)) * dense);
  for (let i = 0; i < dots; i++) {
    const r = hash(c.wx, c.wy, 300 + i);
    const a = ((r & 1023) / 1024) * TAU;
    const d = Math.sqrt(((r >>> 10) & 1023) / 1024) * (3.2 + (h % 3));
    const x = Math.round(hx + Math.cos(a) * d);
    const y = Math.round(hy + Math.sin(a) * d * 0.8);
    if (x < 0 || y < 0 || x > 15 || y > 15) continue;
    px.set(x, y, d < 1.8 ? MYC.hub : i % 3 ? MYC.thread : MYC.threadD);
  }
  const edge = (side: number): [number, number] => {
    // 0 — лево, 1 — право, 2 — верх, 3 — низ.
    if (side === 0) return [-0.5, 3 + (hash(c.wx - 1, c.wy, 101) % 10)];
    if (side === 1) return [15.5, 3 + (hash(c.wx, c.wy, 101) % 10)];
    if (side === 2) return [3 + (hash(c.wx, c.wy - 1, 103) % 10), -0.5];
    return [3 + (hash(c.wx, c.wy, 103) % 10), 15.5];
  };
  const nb: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  nb.forEach(([dx, dy], side) => {
    // Связь — не со всеми соседями: сеть редкая. Решает граница (одинаково
    // для обеих клеток).
    const bx = side === 0 ? c.wx - 1 : c.wx;
    const by = side === 2 ? c.wy - 1 : c.wy;
    if (!isMycel(c.markAt(dx, dy)) || hash(bx, by, side < 2 ? 211 : 223) % 2 !== 0) return;
    const [ex, ey] = edge(side);
    const bend = (((h >>> (side * 3 + 17)) % 7) - 3) * 0.9;
    const mx = (hx + ex) / 2 + (ey - hy) * 0.12 * bend;
    const my = (hy + ey) / 2 - (ex - hx) * 0.12 * bend;
    const n = Math.max(4, Math.ceil(Math.hypot(ex - hx, ey - hy) * 1.4));
    for (let i = 2; i <= n; i++) {
      // Пунктиром: нить тонкая и полупрозрачная.
      if (i % 3 === 0) continue;
      const t = i / n;
      const x = Math.round((1 - t) * (1 - t) * hx + 2 * (1 - t) * t * mx + t * t * ex);
      const y = Math.round((1 - t) * (1 - t) * hy + 2 * (1 - t) * t * my + t * t * ey);
      if (x < 0 || y < 0 || x > 15 || y > 15) continue;
      px.set(x, y, MYC.threadD);
    }
  });
  px.set(hx, hy, MYC.hub);
  px.set(hx + 1, hy + 1, MYC.hubD);
}

function glowPx(c: CellCtx, green: boolean): Px {
  const px = new Px(TS, TS);
  mycelPx(c, px, 0.6);
  const h = hash(c.wx, c.wy, 11);
  const n = 2 + (h % 2);
  const cap = green ? [hex('#6aa82a'), ACID, hex('#eaffb0')] : [VIO_D, VIO, VIO_L];
  for (let i = 0; i < n; i++) {
    const x = 2 + ((h >>> (i * 6)) % 11);
    const y = 5 + ((h >>> (i * 6 + 3)) % 9);
    const tall = 2 + ((h >>> (i + 20)) % 2);
    px.rect(x, y - tall + 1, x, y, hex('#d8d0c0'));
    px.set(x - 1, y - tall, cap[0]);
    px.set(x, y - tall, cap[1]);
    px.set(x + 1, y - tall, cap[0]);
    px.set(x, y - tall - 1, cap[2]);
  }
  return px;
}

/**
 * Споровая лужа: тёмная жижа с рыжевато-зелёной плёнкой, пузыри. Плёнка —
 * шумом в пикселях мира (сшита между клетками); к сухому полу край рваный и
 * прозрачный — видно грунт, а не квадрат плитки.
 */
function sporePoolPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const deep = hex('#0c1208');
  const base = hex('#151d0c');
  const film = hex('#1f2b10');
  const scum = hex('#4c5a14');
  const scumL = hex('#7c8e22');
  const glint = hex('#3a4a28');
  const froth = hex('#a4b648');
  const rim = hex('#070a04');
  const bub = hex('#b8c850');
  const same = (dx: number, dy: number) => c.markAt(dx, dy) === MK.spore;
  const gx0 = c.wx * TS;
  const gy0 = c.wy * TS;
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const wx = gx0 + x;
      const wy = gy0 + y;
      // Рваный край: чем ближе к сухому соседу, тем вероятнее дырка.
      let d = 99;
      if (!same(-1, 0)) d = Math.min(d, x);
      if (!same(1, 0)) d = Math.min(d, 15 - x);
      if (!same(0, -1)) d = Math.min(d, y);
      if (!same(0, 1)) d = Math.min(d, 15 - y);
      const ragged = vnoise(wx, wy, 3, 5) * 3.2;
      if (d < ragged) continue;
      // Тёмная жижа, по ней — редкие островки плёнки.
      const n = vnoise(wx, wy, 5, 9);
      const n2 = vnoise(wx + 40, wy, 2.5, 11);
      let col = n < 0.4 ? deep : n < 0.66 ? base : film;
      if (n > 0.74) col = n2 > 0.6 ? scumL : scum;
      // Мокрый блик: короткие горизонтальные штрихи.
      else if ((wy % 5 === 2 && (wx + wy * 3) % 11 < 3) || (wy % 7 === 4 && (wx * 5 + wy) % 13 < 2))
        col = glint;
      // Кромка: снаружи — пена, под ней — тёмная кайма.
      if (d < ragged + 1) col = (wx + wy) % 2 ? froth : scum;
      else if (d < ragged + 2) col = rim;
      px.set(x, y, col);
    }
  const h = hash(c.wx, c.wy, 13);
  for (let i = 0; i < 2; i++) {
    const x = 4 + ((h >>> (i * 5)) % 8);
    const y = 4 + ((h >>> (i * 5 + 2)) % 8);
    if (!px.solid(x, y)) continue;
    // Пузырь — колечко с бликом.
    px.set(x, y - 1, bub);
    px.set(x - 1, y, bub);
    px.set(x + 1, y, mix(bub, BLACK, 0.45));
    px.set(x, y + 1, mix(bub, BLACK, 0.45));
    px.set(x, y, deep);
    if (i === 0) px.set(x - 1, y - 1, hex('#eaf4a0'));
  }
  return px;
}

function streamPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const deep = hex('#08161a');
  const mid = hex('#0e2a30');
  const band = hex('#164048');
  const foam = hex('#5a8a88');
  const spark = hex('#5affd0');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      // Течение на восток — вытянутые полосы.
      const n = ((c.wx * 16 + x) * 3 + (c.wy * 16 + y) * 17) % 29;
      px.set(x, y, n < 3 ? band : n < 9 ? mid : deep);
    }
  const water = (dx: number, dy: number) => c.markAt(dx, dy) === MK.stream;
  if (!water(0, -1)) {
    px.rect(0, 0, 15, 1, foam);
    for (let x = 0; x < TS; x += 3) px.set(x + ((c.wx + c.wy) % 3), 2, foam);
  }
  if (!water(0, 1)) px.rect(0, 14, 15, 15, mix(foam, BLACK, 0.4));
  const h = hash(c.wx, c.wy, 17);
  // Светлячки воды — светящийся планктон грота.
  if (h % 3 === 0) px.set(2 + (h % 12), 4 + ((h >>> 4) % 8), spark);
  return px;
}

function shallowPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const film = hex('#2a6a70', 110);
  const ripple = hex('#8ad0c8', 150);
  const pebble = hex('#6a6058');
  const h = hash(c.wx, c.wy, 19);
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) px.set(x, y, film);
  for (let i = 0; i < 3; i++) {
    const x = 2 + ((h >>> (i * 4)) % 11);
    const y = 2 + ((h >>> (i * 4 + 2)) % 11);
    px.set(x, y, pebble);
    px.set(x + 1, y, pebble);
  }
  const y0 = 3 + (h % 8);
  px.rect(3 + (h % 4), y0, 8 + (h % 4), y0, ripple);
  return px;
}

function bridgePx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const water = hex('#0a2226');
  const plank = [hex('#3a2416'), hex('#5a3a22'), hex('#7a5232'), hex('#9a6a42')];
  // Под мостками — вода в щелях.
  px.rect(0, 0, 15, 15, water);
  for (let i = 0; i < 4; i++) {
    const y0 = i * 4;
    const tone2 = plank[1 + ((c.wy + i + c.wx) % 2)];
    px.rect(1, y0, 14, y0 + 2, tone2);
    px.rect(1, y0, 14, y0, plank[3]);
    px.rect(1, y0 + 2, 14, y0 + 2, plank[0]);
    // Гвозди.
    px.set(3, y0 + 1, hex('#8b8f94'));
    px.set(12, y0 + 1, hex('#8b8f94'));
  }
  // Перила — по бокам, если сбоку вода.
  const side = (dx: number) => c.markAt(dx, 0) !== MK.bridge;
  // Доски сплошные поперёк мостков: щели — только между досками.
  for (let i = 0; i < 4; i++) {
    const y0 = i * 4;
    const tone2 = plank[1 + ((c.wy + i + c.wx) % 2)];
    if (!side(-1)) px.rect(0, y0, 0, y0 + 2, tone2);
    if (!side(1)) px.rect(15, y0, 15, y0 + 2, tone2);
  }
  if (side(-1)) px.rect(0, 0, 0, 15, plank[0]);
  if (side(1)) px.rect(15, 0, 15, 15, plank[0]);
  return px;
}

function dripPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const h = hash(c.wx, c.wy, 23);
  const g = alpha(SLM.body[2], 0.75);
  const d = alpha(SLM.body[1], 0.8);
  // Натёки слизи — то, что капает со свода.
  px.ell(8, 9, 4, 2.4, d);
  px.ell(7, 8.5, 2.6, 1.4, g);
  px.set(6, 8, SLM.hi);
  for (let i = 0; i < 3; i++) px.set(2 + ((h >>> (i * 4)) % 12), 3 + ((h >>> (i * 4 + 2)) % 11), g);
  return px;
}

function moundPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  // Рыхлая земля — здесь кто-то зарылся.
  px.ell(8, 10, 5, 2.6, hex('#3a2a20', 220));
  px.ell(7, 9.5, 3.4, 1.4, hex('#5a4030', 220));
  const h = hash(c.wx, c.wy, 29);
  px.set(4 + (h % 3), 8, hex('#6a5040'));
  px.set(11, 11, hex('#6a5040'));
  return px;
}

function rootsPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const bark = [hex('#2a1a12'), hex('#4a2e1c'), hex('#6a442a')];
  const h = hash(c.wx, c.wy, 31);
  const y0 = 5 + (h % 5);
  for (let x = 0; x < TS; x++) {
    const y = y0 + Math.round(Math.sin((c.wx * 16 + x) * 0.35) * 1.5);
    px.set(x, y - 1, bark[2]);
    px.set(x, y, bark[1]);
    px.set(x, y + 1, bark[1]);
    px.set(x, y + 2, bark[0]);
  }
  return px;
}

function bonesPx(c: CellCtx): Px {
  const px = new Px(TS, TS);
  const bone = hex('#cdbfa6');
  const boneD = hex('#8d7f6c');
  const h = hash(c.wx, c.wy, 37);
  if (h % 2) {
    // Череп искателя: глазницы и челюсть.
    px.ell(8, 8, 3.2, 2.8, bone);
    px.set(7, 8, boneD);
    px.set(9, 8, boneD);
    px.rect(7, 10, 9, 10, boneD);
  } else {
    // Ржавый обломок клинка.
    px.line(3, 11, 11, 6, hex('#7a3e22'));
    px.line(3, 12, 11, 7, hex('#4a2a18'));
    px.rect(2, 11, 3, 13, hex('#5a4030'));
  }
  px.line(10, 12, 14, 13, bone);
  px.set(10, 12, boneD);
  px.set(14, 13, boneD);
  return px;
}

/** Трутовики на лице стены — полки-грибы, иные светятся. */
function wallShroomPx(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const px = new Px(TS, TS);
  const h = hash(c.wx, c.wy, 41);
  const glow = h % 4 === 0;
  const top = glow ? VIO : hex('#b87a3a');
  const under = glow ? VIO_L : hex('#e8b070');
  const dark = glow ? VIO_D : hex('#6a3a1a');
  const n = 2 + (h % 2);
  for (let i = 0; i < n; i++) {
    const x = 3 + ((h >>> (i * 5)) % 10);
    const y = 7 + ((h >>> (i * 5 + 3)) % 7);
    const w = 2 + ((h >>> (i + 16)) % 2);
    px.ell(x, y, w, 1.2, top);
    px.rect(x - w + 1, y + 1, x + w - 1, y + 1, under);
    px.set(x - w, y, dark);
  }
  return px;
}

function cellPainter(c: CellCtx): Px | null {
  switch (c.mark) {
    case MK.mycel: {
      const px = new Px(TS, TS);
      mycelPx(c, px);
      return px;
    }
    case MK.glowG:
      return glowPx(c, true);
    case MK.glowV:
      return glowPx(c, false);
    case MK.spore:
      return sporePoolPx(c);
    case MK.stream:
      return streamPx(c);
    case MK.shallow:
      return shallowPx(c);
    case MK.bridge:
      return bridgePx(c);
    case MK.drip:
      return dripPx(c);
    case MK.mandrake:
    case MK.snapper:
      return moundPx(c);
    case MK.roots:
      return rootsPx(c);
    case MK.bones:
      return bonesPx(c);
    case MK.wallShroom:
      return wallShroomPx(c);
    default:
      return null;
  }
}

registerCellPainter(F2_GROT, cellPainter);
registerCellPainter(F2_RUIN, cellPainter);

// ---------------------------------------------------------------------------
// Лужи, облака и удары по площади.
// ---------------------------------------------------------------------------

export const rgba = (c: RGBA, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Облако спор: клубы жёлто-зелёной пыли, пылинки кружат. */
registerZonePainter('f2_spores', (g, z, px, py, scale, time) => {
  const zone = z as Zone;
  const warn = zone.warn ?? 0;
  const R = zone.r * scale;
  if (zone.t < warn) {
    const k = zone.t / Math.max(0.01, warn);
    g.fillStyle = rgba(ACID, 0.18 + 0.2 * k);
    g.beginPath();
    g.arc(px, py, R * (0.4 + 0.6 * k), 0, TAU);
    g.fill();
    return true;
  }
  const life = zone.t - warn;
  const fade = Math.min(1, (zone.life - life) / 0.8) * Math.min(1, life / 0.2);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05 + zone.id;
    const rr = R * (0.35 + 0.18 * Math.sin(time * 1.3 + i));
    const cx = px + Math.cos(a + time * 0.4) * R * 0.45;
    const cy = py + Math.sin(a + time * 0.4) * R * 0.3;
    g.fillStyle = rgba(i % 2 ? ACID : ACID_D, 0.16 * fade);
    g.beginPath();
    g.arc(Math.round(cx), Math.round(cy), rr, 0, TAU);
    g.fill();
  }
  g.fillStyle = rgba(hex('#eaffb0'), 0.7 * fade);
  for (let i = 0; i < 9; i++) {
    const a = time * (0.6 + (i % 3) * 0.2) + i * 0.7 + zone.id;
    const rr = R * (0.2 + 0.75 * ((i * 0.37 + time * 0.15) % 1));
    g.fillRect(Math.round(px + Math.cos(a) * rr), Math.round(py + Math.sin(a) * rr * 0.7), 1, 1);
  }
  return true;
});

/** Лужа слизи: вязнет. */
registerZonePainter('f2_goo', (g, z, px, py, scale) => {
  const zone = z as Zone;
  const fade = Math.min(1, (zone.life - zone.t) / 0.8);
  const R = zone.r * scale;
  g.fillStyle = rgba(SLM.body[1], 0.45 * fade);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(SLM.body[3], 0.5 * fade);
  g.fillRect(Math.round(px - R * 0.4), Math.round(py - R * 0.2), 2, 1);
  return true;
});

/** Росток грибницы на месте убитого: скоро вылезет грибёнок. */
registerZonePainter('f2_sprouting', (g, z, px, py, _scale, time) => {
  const zone = z as Zone;
  const k = Math.min(1, zone.t / zone.life);
  g.fillStyle = rgba(hex('#d8d0e8'), 0.35 + 0.3 * k);
  const n = 3 + Math.floor(k * 6);
  for (let i = 0; i < n; i++) {
    const a = i * 2.4;
    const r = 2 + k * 5 * ((i % 3) / 2 + 0.3);
    g.fillRect(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.6), 1, 1);
  }
  if (k > 0.5) {
    const bob = Math.round(Math.sin(time * 6) * 0.5);
    g.fillStyle = rgba(VIO, 0.9);
    g.fillRect(Math.round(px) - 1, Math.round(py) - 2 + bob, 3, 1);
    g.fillStyle = rgba(hex('#d8d0c0'), 0.9);
    g.fillRect(Math.round(px), Math.round(py) - 1 + bob, 1, 2);
  }
  return true;
});

/** Крик мандрагоры: круг наливается, по нему бегут звуковые волны. */
registerZonePainter('f2_scream', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  const Y = hex('#ffe070');
  g.fillStyle = rgba(Y, 0.08 + 0.2 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(Y, 0.55 + 0.4 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Волны от середины к краю — чаще к концу.
  for (let i = 0; i < 3; i++) {
    const w = (time * (1.5 + k * 2) + i / 3) % 1;
    g.strokeStyle = rgba(Y, (1 - w) * 0.5 * k);
    g.beginPath();
    g.arc(px, py - 4, R * w, 0, TAU);
    g.stroke();
  }
  return true;
});

/** Метка приземления слизи: зелёная тень растёт. */
registerZonePainter('f2_hop', (g, z, px, py, scale) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  g.fillStyle = rgba(SLM.body[1], 0.15 + 0.3 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.5 + 0.5 * k), R * (0.35 + 0.35 * k), 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(SLM.body[3], 0.6);
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.stroke();
  return true;
});

// ---------------------------------------------------------------------------
// Вещи этажа — иконки 10×10.
// ---------------------------------------------------------------------------

function icon(draw: (p: Px) => void): () => Px {
  return () => {
    const p = new Px(10, 10);
    draw(p);
    p.outline(INK);
    return p;
  };
}

registerItemArt(
  'f2_cap',
  icon((p) => {
    // Ломоть шляпки: кожица и белая мякоть.
    ball(p, { x: 5, y: 5, rx: 4, ry: 3 }, SHR.cap, (_x, y) => y <= 5);
    p.rect(1, 6, 8, 7, SHR.stalk[2]);
    p.set(3, 3, SHR.spot);
    p.set(6, 2, SHR.spot);
  }),
);
registerItemArt(
  'f2_jelly',
  icon((p) => {
    // Сушёная слизь — полупрозрачный брусок.
    p.rect(2, 3, 7, 8, SLM.body[2]);
    p.rect(2, 3, 7, 3, SLM.body[3]);
    p.rect(7, 4, 7, 8, SLM.body[1]);
    p.set(3, 4, SLM.hi);
    p.set(5, 6, SLM.core);
  }),
);
registerItemArt(
  'f2_crab',
  icon((p) => {
    // Мясо мимика: розовая мякоть в красном панцире.
    ball(p, { x: 5, y: 5, rx: 4, ry: 3.2 }, MIM.chit);
    p.ell(5, 6, 2.4, 1.6, hex('#f0b8a0'));
    p.set(4, 5, hex('#fff0e0'));
  }),
);
registerItemArt(
  'f2_root',
  icon((p) => {
    // Корень мандрагоры с ботвой.
    ball(p, { x: 5, y: 6, rx: 2.6, ry: 3.2 }, MDR.body);
    leaf(p, 5, 3, -Math.PI / 2 - 0.4, 3, 1, MDR.leafM);
    leaf(p, 5, 3, -Math.PI / 2 + 0.4, 3, 1, MDR.leafL);
    p.set(4, 6, MDR.eyeD);
    p.set(6, 6, MDR.eyeD);
  }),
);
registerItemArt(
  'f2_spores',
  icon((p) => {
    // Мешочек спор, из горловины пылит.
    ball(p, { x: 5, y: 6, rx: 3.4, ry: 3 }, [
      hex('#5a4a2a'),
      hex('#8a7a48'),
      hex('#b8a468'),
      hex('#dccc90'),
    ]);
    p.rect(4, 2, 6, 3, hex('#6a5a38'));
    p.set(4, 1, ACID);
    p.set(6, 0, ACID);
    p.set(7, 1, hex('#eaffb0'));
  }),
);
registerItemArt(
  'f2_core',
  icon((p) => {
    // Ядро слизи — тёмный глянцевый шарик.
    ball(p, { x: 5, y: 5, rx: 3.6, ry: 3.6 }, [SLM.core, SLM.body[0], SLM.body[1], SLM.body[2]]);
    p.set(3, 3, SLM.hi);
  }),
);
registerItemArt(
  'f2_claw',
  icon((p) => {
    // Клешня.
    leaf(p, 2, 7, -0.6, 7, 1.8, MIM.chit[2]);
    leaf(p, 3, 8, -0.1, 5, 1.2, MIM.chit[1]);
    p.set(7, 3, MIM.tip);
  }),
);
registerItemArt(
  'f2_shell',
  icon((p) => {
    // Створка латника — веер с рёбрами.
    ball(p, { x: 5, y: 6, rx: 4, ry: 3.4 }, MIT.shell, (_x, y) => y <= 7);
    for (let i = -2; i <= 2; i++) p.line(5, 8, 5 + i * 1.6, 3 + Math.abs(i) * 0.5, MIT.rib);
    p.set(3, 4, MIT.shell[3]);
  }),
);
registerItemArt(
  'f2_sword',
  icon((p) => {
    // Живой клинок: меч с лиловой искрой в рукояти.
    p.line(2, 7, 8, 1, ARM.blade);
    p.line(3, 7, 8, 2, ARM.bladeD);
    p.line(1, 6, 4, 9, ARM.gold);
    p.set(1, 8, ARM.grip);
    p.set(8, 1, ARM.bladeL);
    p.set(2, 8, VIO_L);
  }),
);

void BLACK;
