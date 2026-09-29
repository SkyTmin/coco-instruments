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
  frameLRU,
  MOB_PAINTERS,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
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
// Живые доспехи (v2.85): риг и техники кадрами на 24 к/с.
//
// Облик прежний: ведро-шлем с Т-прорезью висит над пустым горлом, плащ,
// щит с грибом, кираса с ребром и пряжкой. Поменялось ДВИЖЕНИЕ. Тело — риг:
// таз, ноги по IK (колено вперёд), торс с наклоном, рука с мечом (плечо →
// локоть → кулак), щит на дальней руке, плащ с запаздыванием, шлем плавает
// над горлом и отстаёт от тела на кадр-два. Техника — ключевые позы,
// промежуточные кадры — интерполяция с разгоном и торможением от `pose.t`
// на 24 к/с; кадр контакта — `floor(warn·24)`, тот, в который мозг бьёт.
//
// Меч идёт ГОРИЗОНТАЛЬНЫМ махом к герою, как у героя: удар — конус на полу,
// клинок поворачивается вокруг плеча, замах целится в край конуса, след
// (серп) — в слое света `lit`. Обычный взмах — сверху вниз (рубит), второй
// в ярости — снизу вверх, с другой стороны. Направление махов — пять
// классов на сторону (прямо, диагонали, вверх, вниз), остальное — зеркало.
//
// Свет (`lit`): прорезь, горло, суставы, трещины — только там, где их не
// закрывает меч или рука (пиксель проверяется после рисования тела). След
// меча над плечом прячется за телом — дуга проходит «за головой».
//
// Кадры — `frameLRU(400)`, ключ — квантованные числа рига (одинаковые позы
// двух техник — один кадр). Прогрев — `registerMobWarm`: покой, бег, рёв,
// взмах, укол и оглушение в обе стороны.
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

/** Цвета следа меча и свечения роя (слой света). */
const SM = {
  core: hex('#ffffff'),
  hi: hex('#dfe8f4'),
  mid: hex('#a9b8d4'),
  edge: hex('#8a6ad8'),
  vio: hex('#c9a4ff'),
  star: hex('#ffe070'),
  starD: hex('#b8903a'),
};

// ---- Кривые ----------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const eIn = (k: number) => k * k;
const eOut = (k: number) => 1 - (1 - k) * (1 - k);
const eOut3 = (k: number) => 1 - (1 - k) * (1 - k) * (1 - k);
const eIO = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
/** Пружина: 0 → 1 с перелётом и затуханием. */
const spring = (k: number) => (k >= 1 ? 1 : 1 - Math.exp(-5 * k) * Math.cos(k * 9));
/** Затухающее колебание около нуля. */
const wob = (k: number, n = 1.5) => (k >= 1 ? 0 : Math.exp(-4 * k) * Math.sin(k * Math.PI * 2 * n));
/** Кадр техники на 24 к/с. */
const f24 = (t: number) => Math.floor(Math.max(0, t) * 24 + 1e-6);
/** Детерминированный шум пикселя: растворение, мерцание. */
const hash2 = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---- Свечение с проверкой, не закрыто ли оно ---------------------------------

/**
 * Светящийся пиксель: в кадр — тусклым, в слой света — ярким, но только
 * если после рисования всего тела его не закрыли (меч перед лицом гасит
 * прорезь в `lit`, а не светит сквозь клинок).
 */
class Glow {
  list: [number, number, RGBA, RGBA][] = [];
  at(px: Px, x: number, y: number, main: RGBA, lit: RGBA): void {
    x = Math.round(x);
    y = Math.round(y);
    px.set(x, y, main);
    this.list.push([x, y, main, lit]);
  }
  flush(px: Px, lit: Px): void {
    for (const [x, y, m, l] of this.list) {
      const c = px.get(x, y);
      if (c[0] === m[0] && c[1] === m[1] && c[2] === m[2]) lit.set(x, y, l);
    }
  }
}

// ---- Поворот пиксельной картинки (RotSprite-lite) ----------------------------

/** Scale2x (EPX): пиксель → 2×2 без новых цветов, диагонали сглажены. */
function scale2x(src: Px): Px {
  const w = src.w;
  const h = src.h;
  const o = new Px(w * 2, h * 2);
  const s = new Uint32Array(src.data.buffer);
  const d = new Uint32Array(o.data.buffer);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : s[y * w + x]);
  const W2 = w * 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const P = s[y * w + x];
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      const i = y * 2 * W2 + x * 2;
      d[i] = C === A && C !== D && A !== B ? A : P;
      d[i + 1] = A === B && A !== C && B !== D ? B : P;
      d[i + W2] = D === C && D !== B && C !== A ? C : P;
      d[i + W2 + 1] = B === D && B !== A && D !== C ? D : P;
    }
  return o;
}

/**
 * Повернуть картинку без контура на угол `ang` вокруг (scx, scy): выборка из
 * учетверённой Scale2x — края не рвутся, новых цветов нет. Контур — после.
 */
function rotPx(src: Px, ang: number, scx: number, scy: number, size: number): Px {
  const up = scale2x(scale2x(src));
  const u = new Uint32Array(up.data.buffer);
  const o = new Px(size, size);
  const d = new Uint32Array(o.data.buffer);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const oc = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - oc;
      const dy = y + 0.5 - oc;
      const ux = Math.floor((c * dx + s * dy + scx) * 4);
      const uy = Math.floor((-s * dx + c * dy + scy) * 4);
      if (ux < 0 || uy < 0 || ux >= up.w || uy >= up.h) continue;
      d[y * size + x] = u[uy * up.w + ux];
    }
  return o;
}

// ---- Кадр из двух слоёв: тело и свет ------------------------------------------

interface Pair {
  px: Px;
  lit: Px | null;
  ax: number;
  ay: number;
  eye: [number, number] | null;
}

/** Обрезать пустые поля обоих слоёв одной рамкой — привязка общая. */
function cropPair(p: Pair): Pair {
  let x0 = p.px.w;
  let y0 = p.px.h;
  let x1 = -1;
  let y1 = -1;
  const scan = (q: Px) => {
    for (let y = 0; y < q.h; y++)
      for (let x = 0; x < q.w; x++)
        if (q.data[(y * q.w + x) * 4 + 3]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  };
  scan(p.px);
  if (p.lit) scan(p.lit);
  if (x1 < 0) return p;
  // Точка ног — внутри кадра: иначе тень и сортировка уедут.
  x0 = Math.min(x0, Math.floor(p.ax) - 1);
  x1 = Math.max(x1, Math.ceil(p.ax));
  y1 = Math.max(y1, Math.ceil(p.ay));
  const cut = (q: Px) => {
    const o = new Px(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) {
      const a = (y * q.w + x0) * 4;
      o.data.set(q.data.subarray(a, a + (x1 - x0 + 1) * 4), (y - y0) * o.w * 4);
    }
    return o;
  };
  return {
    px: cut(p.px),
    lit: p.lit ? cut(p.lit) : null,
    ax: p.ax - x0,
    ay: p.ay - y0,
    eye: p.eye ? [p.eye[0] - x0, p.eye[1] - y0] : null,
  };
}

/** Есть ли в слое хоть один пиксель. */
const anyPx = (q: Px | null) => {
  if (!q) return false;
  for (let i = 3; i < q.data.length; i += 4) if (q.data[i]) return true;
  return false;
};

/** Как `finish`, но для двух слоёв: облик, вспышка и зеркало — обоим. */
function finishPair(
  p: Pair,
  o: { left: boolean; flash: boolean; look: MobPose['look'] },
): MobFrame {
  let { px, lit, ax, ay, eye } = cropPair(p);
  if (o.look === 'albino') px = px.tint(PALE, 0.55);
  if (o.look === 'elite') {
    const grow = (q: Px) => {
      const g = new Px(q.w + 2, q.h + 2);
      for (let y = 0; y < q.h; y++) for (let x = 0; x < q.w; x++) g.set(x + 1, y + 1, q.get(x, y));
      return g;
    };
    px = grow(px);
    px.outline(GOLD);
    if (lit) lit = grow(lit);
    ax += 1;
    ay += 1;
    if (eye) eye = [eye[0] + 1, eye[1] + 1];
  }
  if (o.flash) px = px.tint(WHITE, 0.85);
  if (o.left) {
    px = px.flipX();
    if (lit) lit = lit.flipX();
    ax = px.w - ax;
    if (eye) eye = [px.w - 1 - eye[0], eye[1]];
  }
  return { img: px.canvas(), lit: anyPx(lit) ? lit!.canvas() : null, ax, ay, eye };
}
// ---- Риг ---------------------------------------------------------------------

/**
 * Поза доспехов. Смотрят ВПРАВО; все длины — пиксели, углы — радианы
 * экрана (0 — вправо, π/2 — вниз). Перед рисованием всё квантуется
 * (`normRig`): одинаковые позы дают один кадр, контур не «кипит».
 */
interface Rig {
  /** Таз: сдвиг от точки ног (вперёд) и вниз (присед). */
  hx: number;
  hy: number;
  /** Наклон торса: грудь вперёд относительно таза. */
  lean: number;
  /** Ступни: сдвиг вперёд от места под бедром и подъём. */
  fF: number;
  fB: number;
  lF: number;
  lB: number;
  /** Шлем над горлом: сдвиг и поворот прорези (−1…1). */
  helmX: number;
  helmY: number;
  helmR: number;
  /** Меч: угол клинка, кулак от плеча, длина клинка. */
  sa: number;
  hax: number;
  hay: number;
  len: number;
  /** Щит на дальней руке. */
  shX: number;
  shY: number;
  /** Плащ: отстаёт подолом назад, подол поднят, фаза волны 0…11. */
  capeT: number;
  capeL: number;
  capeW: number;
  /** Свечение роя 0…1. */
  glow: number;
  /** Грудь проседает (смерть): торс ниже таза на столько. */
  slump: number;
  /** Щит лёг плашмя 0…1 (смерть). */
  shSq: number;
  // ---- Слой света ----
  /** След меча: дуга от smA до smB вокруг плеча; smK — сколько её видно. */
  smA: number;
  smB: number;
  smK: number;
  /** Прочерк укола: длина за остриём и перед ним. */
  thr: number;
  /** Блик бежит по клинку 0…1; <0 — нет. */
  gl: number;
  /** Звёзды над шлемом: фаза оборота; <0 — нет. */
  stars: number;
  /** Вспышка из щелей 0…1. */
  flare: number;
  /** Трещины на латах 0…1. */
  crack: number;
  /** Рой вьётся вокруг: фаза; <0 — нет. */
  motes: number;
}

const GUARD: Rig = {
  hx: 0,
  hy: 0,
  lean: 0,
  fF: 1,
  fB: -1,
  lF: 0,
  lB: 0,
  helmX: 0,
  helmY: 0,
  helmR: 0,
  sa: 1.2,
  hax: 3,
  hay: 7,
  len: 20,
  shX: 0,
  shY: 0,
  capeT: 0,
  capeL: 0,
  capeW: 0,
  glow: 0.5,
  slump: 0,
  shSq: 0,
  smA: 0,
  smB: 0,
  smK: 0,
  thr: 0,
  gl: -1,
  stars: -1,
  flare: 0,
  crack: 0,
  motes: -1,
};

const RIG_NUM = Object.keys(GUARD) as (keyof Rig)[];

/** Промежуточная поза: числа — линейно (кривую задаёт k), эффекты — от b. */
function mixRig(a: Rig, b: Rig, k: number): Rig {
  const o = { ...b };
  for (const f of RIG_NUM) {
    if (f === 'gl' || f === 'stars' || f === 'motes' || f === 'smA' || f === 'smB' || f === 'smK')
      continue;
    o[f] = a[f] + (b[f] - a[f]) * k;
  }
  return o;
}

const rig = (base: Rig, over: Partial<Rig>): Rig => ({ ...base, ...over });

/** Кулак на радиусе r от плеча по углу клинка (отстаёт на lag). */
const handOn = (sa: number, r: number, lag = 0): Partial<Rig> => ({
  sa,
  hax: Math.cos(sa - lag) * r,
  hay: Math.sin(sa - lag) * r,
});

/**
 * Опустить поднятый клинок: кулак падает сразу, клинок опрокидывается поздно
 * и быстро — горизонталь вперёд проходит за кадр и не читается уколом.
 */
function lowerBlade(r: Rig, from: Rig, to: Rig, k: number): void {
  const kh = eOut(Math.min(1, k * 1.3));
  const ks = eIn(k);
  r.hax = lerp(from.hax, to.hax, kh);
  r.hay = lerp(from.hay, to.hay, kh);
  r.sa = lerp(from.sa, to.sa, ks);
}

/** Квант: одинаковое — один кадр; дробное — не «кипит». */
function normRig(r: Rig): Rig {
  const i = Math.round;
  const a = (x: number) => Math.round(x * 50) / 50;
  const s = (x: number) => Math.round(x * 8) / 8;
  return {
    hx: i(r.hx),
    hy: i(r.hy),
    lean: i(r.lean),
    fF: i(r.fF),
    fB: i(r.fB),
    lF: i(r.lF),
    lB: i(r.lB),
    helmX: i(r.helmX),
    helmY: i(r.helmY),
    helmR: Math.max(-1, Math.min(1, i(r.helmR))),
    sa: a(Math.atan2(Math.sin(r.sa), Math.cos(r.sa))),
    hax: i(r.hax),
    hay: i(r.hay),
    len: i(r.len),
    shX: i(r.shX),
    shY: i(r.shY),
    capeT: i(r.capeT),
    capeL: i(r.capeL),
    capeW: mod(i(r.capeW), 12),
    glow: s(clamp01(r.glow)),
    slump: i(r.slump),
    shSq: s(clamp01(r.shSq)),
    smA: r.smK > 0 ? a(r.smA) : 0,
    smB: r.smK > 0 ? a(r.smB) : 0,
    smK: s(clamp01(r.smK)),
    thr: i(r.thr),
    gl: r.gl < 0 ? -1 : Math.round(clamp01(r.gl) * 12) / 12,
    stars: r.stars < 0 ? -1 : Math.round(r.stars * 24) / 24,
    flare: s(clamp01(r.flare)),
    crack: s(clamp01(r.crack)),
    motes: r.motes < 0 ? -1 : Math.round(r.motes * 24) / 24,
  };
}

const rigKey = (r: Rig) => RIG_NUM.map((f) => r[f]).join(',');

// ---- Рисунок -------------------------------------------------------------------

/** Холст кадра: точка ног (ax, ag). Запас — под взмах вверх и укол вперёд. */
interface Canvas {
  w: number;
  h: number;
  ax: number;
  ag: number;
}
const CANVAS: Canvas = { w: 120, h: 100, ax: 50, ag: 72 };

/** Какие части рисовать (смерть и сборка снимают их по одной). */
const PT = {
  cape: 1,
  shield: 2,
  legF: 4,
  legB: 8,
  skirt: 16,
  cuirass: 32,
  paulB: 64,
  helm: 128,
  arm: 256,
  sword: 512,
  paulF: 1024,
  neck: 2048,
};
const PT_ALL = 4095;

/** Меч: клинок с долом, гарда, рукоять, навершие. Кулак в (hx, hy). */
function swordAt(px: Px, hx: number, hy: number, ang: number, len: number, streak: boolean): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let i = 3; i <= len; i++) {
    const x = hx + ux * i;
    const y = hy + uy * i;
    const tip = i > len - 3;
    px.set(Math.round(x), Math.round(y), tip && i === len ? ARM.bladeL : ARM.blade);
    if (!tip) {
      px.set(Math.round(x - uy), Math.round(y + ux), ARM.bladeD);
      px.set(Math.round(x + uy * 0.8), Math.round(y - ux * 0.8), ARM.bladeL);
    }
  }
  for (let k = -2.5; k <= 2.5; k += 0.5)
    px.set(Math.round(hx + ux * 2.5 - uy * k), Math.round(hy + uy * 2.5 + ux * k), ARM.gold);
  thick(px, hx - ux * 1.5, hy - uy * 1.5, hx + ux * 2, hy + uy * 2, 0.6, ARM.grip);
  px.set(Math.round(hx - ux * 2.2), Math.round(hy - uy * 2.2), ARM.gold);
  if (streak) {
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

/**
 * Толстая линия капсулой: пиксель, чей центр ближе r к отрезку. Та же форма,
 * что `thick` (штамп кругов), но за один проход — кадр босса дешевле.
 */
function cap(px: Px, x0: number, y0: number, x1: number, y1: number, r: number, c: RGBA): void {
  if (r <= 0.6) {
    thick(px, x0, y0, x1, y1, r, c);
    return;
  }
  const vx = x1 - x0;
  const vy = y1 - y0;
  const L2 = vx * vx + vy * vy || 1e-6;
  const r2 = r * r;
  const xa = Math.floor(Math.min(x0, x1) - r - 1);
  const xb = Math.ceil(Math.max(x0, x1) + r + 1);
  const ya = Math.floor(Math.min(y0, y1) - r - 1);
  const yb = Math.ceil(Math.max(y0, y1) + r + 1);
  for (let y = ya; y <= yb; y++)
    for (let x = xa; x <= xb; x++) {
      const px0 = x + 0.5 - x0;
      const py0 = y + 0.5 - y0;
      let k = (px0 * vx + py0 * vy) / L2;
      k = k < 0 ? 0 : k > 1 ? 1 : k;
      const dx = px0 - vx * k;
      const dy = py0 - vy * k;
      if (dx * dx + dy * dy <= r2) px.set(x, y, c);
    }
}

/** Контур снаружи фигуры — тот же, что `Px.outline`, но по 32-битным словам. */
function inkOutline(px: Px): void {
  const w = px.w;
  const h = px.h;
  const d = new Uint32Array(px.data.buffer);
  const ink = new Uint32Array(new Uint8ClampedArray([INK[0], INK[1], INK[2], 255]).buffer)[0];
  const add: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (px.data[i * 4 + 3]) continue;
      if (
        (x > 0 && px.data[(i - 1) * 4 + 3]) ||
        (x < w - 1 && px.data[(i + 1) * 4 + 3]) ||
        (y > 0 && px.data[(i - w) * 4 + 3]) ||
        (y < h - 1 && px.data[(i + w) * 4 + 3])
      )
        add.push(i);
    }
  for (const i of add) d[i] = ink;
}

/** Нога по IK: бедро (hx, hy) → колено вперёд → лодыжка (ax, ay). */
function legAt(px: Px, gw: Glow, hx: number, hy: number, ax: number, ay: number, far: boolean) {
  const pal = far ? [ARM.steel[0], ARM.steel[0], ARM.steel[1], ARM.steel[2]] : ARM.steel;
  const L = 5.3;
  const vx = ax - hx;
  const vy = ay - hy;
  const d = Math.hypot(vx, vy) || 1;
  let kx = (hx + ax) / 2;
  let ky = (hy + ay) / 2;
  if (d < 2 * L - 0.05) {
    const h = Math.sqrt(L * L - (d * d) / 4);
    kx += (vy / d) * h;
    ky += (-vx / d) * h;
  }
  kx = Math.round(kx);
  ky = Math.round(ky);
  cap(px, hx, hy, kx, ky, 2, pal[1]);
  thick(px, hx - 1, hy, kx - 1, ky, 0.6, pal[2]);
  cap(px, kx, ky, ax, ay, 1.8, pal[1]);
  thick(px, kx - 1, ky + 1, ax - 1, ay - 1, 0.5, pal[2]);
  ball(px, { x: kx + 0.5, y: ky, rx: 2.2, ry: 1.8 }, pal);
  px.ell(ax + 2, ay + 1, 3.4, 1.4, pal[1]);
  px.set(ax + 4, ay, pal[3]);
  // Щель сустава — видно рой.
  gw.at(px, kx - 1, ky + 2, ARM.glow, VIO_L);
}

/** След меча — серп вокруг плеча: у клинка толстый и белый, к хвосту тает. */
function smearAt(
  lit: Px,
  body: Px,
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  R: number,
  k: number,
): void {
  const s = a1 >= a0 ? 1 : -1;
  const span = Math.abs(a1 - a0);
  if (span < 0.08 || k <= 0) return;
  const TH = 8;
  // Хвост отрезан на проводке: видно только ведущую часть дуги.
  const cut = 1 - k;
  // Клинок сам стоит на a1 — серп кончается за ним, не закрывая металл.
  const lead = Math.min(0.12, span * 0.2) / span;
  for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++)
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d > R + 0.5 || d < R - TH - 1) continue;
      let u = (Math.atan2(dy, dx) - a0) * s;
      u = ((u % TAU) + TAU) % TAU;
      if (u > span) continue;
      const uu = u / span;
      if (uu < cut || uu > 1 - lead) continue;
      const w = (uu - cut) / Math.max(0.001, 1 - cut - lead);
      const th = TH * (0.22 + 0.78 * w) * (k < 1 ? 0.75 : 1);
      const v = (R + 0.5 - d) / th;
      if (v < 0 || v > 1) continue;
      // Хвост — рваный: шахматка, реже к концу.
      if (w < 0.35 && hash2(x, y, 3) > w / 0.35) continue;
      // Над плечом дуга идёт за головой — тело её закрывает.
      if (y < cy - 1 && body.solid(x, y)) continue;
      const c =
        v < 0.3 ? (w > 0.55 ? SM.core : SM.hi) : v < 0.68 ? SM.hi : w > 0.5 ? SM.mid : SM.edge;
      lit.set(x, y, c);
    }
}

/** Прочерк укола: белая игла за остриём и короткий пробой вперёд. */
function streakAt(lit: Px, tx: number, ty: number, ang: number, len: number): void {
  if (len <= 0) return;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (let i = -Math.round(len); i <= Math.round(len * 0.6); i++) {
    const x = tx + ux * i;
    const y = ty + uy * i;
    const back = i < 0 ? -i / len : 0;
    if (back > 0.55 && hash2(i, 7, 5) < back - 0.35) continue;
    lit.set(Math.round(x), Math.round(y), i > 0 ? SM.hi : back < 0.4 ? SM.core : SM.mid);
    if (i < 0 && back < 0.7) {
      const side = back < 0.35 ? SM.hi : SM.edge;
      lit.set(Math.round(x - uy), Math.round(y + ux), side);
      if (back < 0.35) lit.set(Math.round(x + uy), Math.round(y - ux), SM.mid);
    }
  }
}

/** Блик по клинку: искра бежит от гарды к острию. */
function glintAt(lit: Px, hx: number, hy: number, ang: number, len: number, g: number): void {
  const d = 3 + g * (len - 3);
  const x = Math.round(hx + Math.cos(ang) * d);
  const y = Math.round(hy + Math.sin(ang) * d);
  lit.set(x, y, SM.core);
  const big = g > 0.85 ? 2 : 1;
  for (let i = 1; i <= big; i++) {
    const c = i === 1 ? SM.hi : SM.mid;
    lit.set(x + i, y, c);
    lit.set(x - i, y, c);
    lit.set(x, y + i, c);
    lit.set(x, y - i, c);
  }
}

/** Звезда 3×3: середина и лучи. */
function starAt(q: Px, x: number, y: number, core: RGBA, ray: RGBA, big: boolean): void {
  x = Math.round(x);
  y = Math.round(y);
  q.set(x, y, core);
  if (!big) return;
  q.set(x - 1, y, ray);
  q.set(x + 1, y, ray);
  q.set(x, y - 1, ray);
  q.set(x, y + 1, ray);
}

/**
 * Доспехи в позе `r`. Части по маске `parts`. Возвращает тело, слой света и
 * глаз (яркий пиксель прорези) — в координатах холста `cv`.
 */
function armorDraw(r: Rig, parts = PT_ALL, cv: Canvas = CANVAS): Pair {
  const px = new Px(cv.w, cv.h);
  const lit = new Px(cv.w, cv.h);
  const gw = new Glow();
  const on = (p: number) => (parts & p) !== 0;
  const AX = cv.ax;
  const AG = cv.ag;
  const cx = AX + r.hx;
  const hip = AG - 13 + r.hy;
  const chx = cx + r.lean;
  const chest = hip - 8 + r.slump;
  const sh = chest - 5;
  const neck = sh - 2;
  const glowC = r.glow > 0.7 ? ARM.glowL : ARM.glow;
  const S: [number, number] = [chx + 6, sh + 2];
  const H: [number, number] = [S[0] + r.hax, S[1] + r.hay];
  const sn = Math.sin(r.sa);
  // Клинок за телом: поднят (от камеры) или отведён назад за спину.
  const bladeUp = sn < -0.3 || (Math.cos(r.sa) < -0.55 && sn < 0.55);
  const armBack = r.hax < -2.5 && r.hay > -3;
  const handUp = !armBack && r.hay < -2;
  const helmX = chx + 2 + r.helmX;
  const helmY = neck - 5 + r.helmY;

  // Рука с мечом: плечо → локоть (наружу-вниз) → кулак.
  const arm = () => {
    const vx = H[0] - S[0];
    const vy = H[1] - S[1];
    const d = Math.hypot(vx, vy) || 1;
    const L = 4.8;
    let ex = (S[0] + H[0]) / 2;
    let ey = (S[1] + H[1]) / 2;
    if (d < 2 * L - 0.1) {
      const h = Math.sqrt(L * L - (d * d) / 4);
      let nx = -vy / d;
      let ny = vx / d;
      if (ny + 0.35 * nx < 0) {
        nx = -nx;
        ny = -ny;
      }
      ex += nx * h;
      ey += ny * h;
    }
    ex = Math.round(ex);
    ey = Math.round(ey);
    cap(px, S[0], S[1], ex, ey, 1.6, ARM.steel[1]);
    cap(px, ex, ey, H[0], H[1], 1.5, ARM.steel[1]);
    thick(px, S[0] - 0.5, S[1] - 0.5, ex - 0.5, ey - 0.5, 0.5, ARM.steel[2]);
    thick(px, ex - 0.5, ey - 0.5, H[0] - 0.5, H[1] - 0.5, 0.5, ARM.steel[2]);
    ball(px, { x: ex + 0.5, y: ey + 0.5, rx: 1.6, ry: 1.4 }, ARM.steel);
    ball(px, { x: H[0], y: H[1], rx: 2, ry: 1.8 }, ARM.steel);
  };

  // Звёзды оглушения: те, что за шлемом, — в кадр до него, передние — в свет.
  const stars: [number, number, boolean, boolean][] = [];
  if (r.stars >= 0) {
    for (let j = 0; j < 3; j++) {
      const a = (r.stars + j / 3) * TAU;
      const x = helmX + Math.cos(a) * 7.5;
      const y = helmY - 8 + Math.sin(a) * 2.5;
      stars.push([x, y, Math.sin(a) > 0, (Math.round(r.stars * 24) + j) % 3 !== 0]);
    }
  }

  // 1. Плащ за спиной: сверху — от плеч, подол — от таза, отстаёт и полощет.
  if (on(PT.cape)) {
    const top = sh + 1;
    const hem = Math.min(hip + 11 - r.capeL, AG - 1);
    const n = Math.max(1, hem - top);
    for (let y = top; y <= hem; y++) {
      const k = (y - top) / n;
      const w0 =
        lerp(chx - 9, cx - 13, k) -
        r.capeT * k * k -
        r.capeL * 0.7 * k +
        Math.sin(k * 5 + (r.capeW * TAU) / 12) * 1.2 * (0.3 + 0.7 * k);
      const w1 = lerp(chx + 1, cx + 1, k);
      const x0 = Math.round(w0);
      for (let x = x0; x <= Math.round(w1); x++) {
        const xi = x - x0;
        const yi = y - top;
        if (y > hem - 6 && (xi * 7 + yi * 3) % 5 === 0) continue;
        // Лат нет — под плащом пусто: изнанка тёмная.
        const inner = !on(PT.cuirass) && x > Math.round(w1) - 4;
        px.set(
          x,
          y,
          inner ? ARM.cloak[0] : xi < 2 ? ARM.cloak[0] : xi < 5 ? ARM.cloak[1] : ARM.cloak[2],
        );
      }
    }
  }

  // 2. Щит на дальней руке, за корпусом: край и выцветший гриб.
  if (on(PT.shield)) {
    const sy0 = chest - 2 + r.shY;
    const sx = chx - 11 + r.shX;
    // Лёг плашмя: сплющен к нижнему краю.
    const q = 1 - r.shSq * 0.7;
    const Y = (y: number) => sy0 + 11 - (sy0 + 11 - y) * q;
    const pts: [number, number][] = [
      [sx - 4.5, Y(sy0 - 5)],
      [sx + 5, Y(sy0 - 5)],
      [sx + 5, Y(sy0 + 4)],
      [sx + 0.3, Y(sy0 + 11)],
      [sx - 4.5, Y(sy0 + 4)],
    ];
    const e: Ell = { x: sx, y: Y(sy0 + 1), rx: 6, ry: 9 * q };
    poly(px, pts, (x, y) => tone(ARM.shield, e, x, y));
    for (const [a, b] of [
      [0, 1],
      [0, 4],
      [4, 3],
    ])
      px.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1], ARM.rim);
    if (q > 0.6) {
      const ey = Y(sy0);
      ball(
        px,
        { x: sx + 0.3, y: ey, rx: 3, ry: 2.2 * q },
        [ARM.goldD, ARM.emblem, ARM.emblem, WHITE],
        (_x, y) => y <= ey + 0.5,
      );
      px.rect(
        Math.round(sx),
        Math.round(ey + 1),
        Math.round(sx + 1),
        Math.round(Y(sy0 + 4)),
        ARM.emblem,
      );
      px.set(Math.round(sx - 1), Math.round(ey - 1), ARM.shield[1]);
    }
  }

  // Звёзды за шлемом.
  for (const [x, y, front, big] of stars) if (!front) starAt(px, x, y, SM.star, SM.starD, big);

  // 3. Клинок, поднятый вверх, — за телом.
  if (on(PT.sword) && bladeUp) swordAt(px, H[0], H[1], r.sa, r.len, false);

  // 4. Дальняя нога.
  if (on(PT.legB)) legAt(px, gw, cx - 2, hip + 1, AX - 2 + r.fB, AG - 2 - r.lB, true);

  // 5. Юбка — две пластины (идёт за тазом, чуть за наклоном).
  if (on(PT.skirt)) {
    const kx = cx + Math.round(r.lean * 0.4);
    for (let i = 0; i < 2; i++) {
      const y = hip - 1 + i * 2 + Math.round(r.slump * 0.5);
      const w = 6.8 + i * 0.8;
      for (let x = Math.round(kx - w); x <= Math.round(kx + w); x++) {
        const k = (x - (kx - w)) / (2 * w);
        px.set(x, y, k < 0.3 ? ARM.steel[2] : k < 0.85 ? ARM.steel[1] : ARM.steel[0]);
        px.set(x, y + 1, ARM.steel[0]);
      }
    }
  }

  // 6. Ближняя нога.
  if (on(PT.legF)) legAt(px, gw, cx + 1, hip + 1, AX + 1 + r.fF, AG - 2 - r.lF, false);

  // Рука отведена за спину — за кирасой.
  if (on(PT.arm) && armBack) arm();

  // 7. Кираса: нагрудник с ребром, пояс с пряжкой, ржавый потёк, трещины.
  if (on(PT.cuirass)) {
    const cy = chest;
    const e: Ell = { x: chx + 1, y: cy, rx: 8, ry: 7.2 };
    ball(px, e, ARM.steel, (_x, y) => y <= cy + 4.5, 0.08);
    for (let y = cy - 6; y <= cy + 1; y++) px.set(chx + 3, y, y < cy - 2 ? ARM.spec : ARM.steel[3]);
    for (let x = chx - 6; x <= chx + 8; x++) if (px.solid(x, cy + 4)) px.set(x, cy + 4, ARM.grip);
    px.rect(chx + 2, cy + 3, chx + 3, cy + 5, ARM.gold);
    px.line(chx - 3, cy, chx - 2, cy + 3, ARM.rust);
    if (r.crack > 0) {
      // Трещина растёт сверху вниз; с 0,6 — ветка к боку.
      const pts: [number, number][] = [
        [chx - 1, cy - 6],
        [chx + 1, cy - 3],
        [chx - 1, cy],
        [chx + 1, cy + 3],
      ];
      const n = Math.ceil(r.crack * 3);
      for (let i = 0; i < n; i++)
        px.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], ARM.glow);
      for (let i = 0; i <= n; i++) gw.at(px, pts[i][0], pts[i][1], ARM.glow, VIO_L);
      if (r.crack >= 0.6) {
        px.line(chx - 1, cy, chx - 4, cy - 2, ARM.glow);
        gw.at(px, chx - 4, cy - 2, ARM.glow, VIO_L);
      }
      gw.at(px, chx, cy - 2, ARM.glowL, WHITE);
      px.set(chx + 1, cy + 1, ARM.shell);
      px.set(chx - 1, cy - 5, ARM.shell);
    }
  }

  // 8. Дальний наплечник.
  if (on(PT.paulB))
    ball(px, { x: chx - 5, y: sh + 1, rx: 3.6, ry: 2.8 }, [
      ARM.steel[0],
      ARM.steel[0],
      ARM.steel[1],
      ARM.steel[2],
    ]);

  if (on(PT.arm) && handUp) arm();

  // 9. Горло — пустота, в ней рой; шлем висит над ним.
  let eye: [number, number] | null = null;
  if (on(PT.neck)) {
    for (let x = chx; x <= chx + 3; x++)
      for (let y = neck - 1; y <= neck; y++) gw.at(px, x, y, glowC, x === chx + 1 ? WHITE : VIO_L);
    // Шлем поднят высоко — между ним и горлом тянутся нити роя.
    if (on(PT.helm) && r.helmY <= -2)
      for (let y = helmY + 4; y < neck - 1; y++)
        if ((y + (r.capeW & 1)) % 2 === 0)
          gw.at(px, chx + 1 + (y % 3 === 0 ? 1 : 0), y, ARM.glow, VIO_L);
  }
  if (on(PT.helm)) {
    const e: Ell = { x: helmX, y: helmY, rx: 4.6, ry: 5.2 };
    ball(px, e, ARM.steel, (_x, y) => y <= helmY + 4);
    for (let y = helmY - 6; y <= helmY - 2; y++) px.set(helmX, y, ARM.steel[3]);
    px.set(helmX, helmY - 6, ARM.spec);
    const vx = helmX + r.helmR;
    const vy = helmY;
    px.rect(vx - 1, vy, vx + 4, vy, ARM.steelD);
    px.rect(vx + 2, vy, vx + 2, vy + 3, ARM.steelD);
    gw.at(px, vx + 1, vy, glowC, VIO_L);
    gw.at(px, vx + 3, vy, glowC, r.glow > 0.7 ? WHITE : VIO_L);
    gw.at(px, vx + 2, vy + 1, glowC, VIO_L);
    if (r.glow >= 0.9) gw.at(px, vx + 2, vy + 2, ARM.glow, VIO);
    if (r.crack >= 0.6) {
      px.line(helmX - 3, helmY - 3, helmX - 1, helmY - 1, ARM.glow);
      gw.at(px, helmX - 2, helmY - 2, ARM.glow, VIO_L);
    }
    eye = [vx + 3, vy];
  }

  // 10. Рука (если не поднята) и клинок перед телом.
  if (on(PT.arm) && !handUp && !armBack) arm();
  if (on(PT.sword) && !bladeUp) swordAt(px, H[0], H[1], r.sa, r.len, false);

  // 11. Ближний наплечник — поверх руки.
  if (on(PT.paulF)) {
    ball(
      px,
      { x: S[0] - 0.5, y: S[1] + 1.5, rx: 3.6, ry: 1.8 },
      ARM.steel,
      (_x, y) => y <= S[1] + 2.5,
    );
    ball(
      px,
      { x: S[0] - 0.5, y: S[1] - 0.5, rx: 4.4, ry: 2.8 },
      ARM.steel,
      (_x, y) => y <= S[1] + 1,
      0.1,
    );
    px.set(S[0] - 2, S[1] - 2, ARM.spec);
    if (r.crack >= 0.6) {
      px.line(S[0] + 1, S[1] - 2, S[0] + 2, S[1], ARM.glow);
      gw.at(px, S[0] + 2, S[1], ARM.glow, VIO_L);
    }
  }

  inkOutline(px);
  if (eye) px.set(eye[0], eye[1], glowC);
  gw.flush(px, lit);

  // ---- Слой света: след, прочерк, блик, звёзды, вспышка, рой ----
  const R = Math.hypot(r.hax, r.hay) + r.len + 1;
  if (r.smK > 0) smearAt(lit, px, S[0], S[1], r.smA, r.smB, R, r.smK);
  if (r.thr > 0) {
    const tx = H[0] + Math.cos(r.sa) * r.len;
    const ty = H[1] + Math.sin(r.sa) * r.len;
    streakAt(lit, tx, ty, r.sa, r.thr);
  }
  if (r.gl >= 0 && on(PT.sword)) glintAt(lit, H[0], H[1], r.sa, r.len, r.gl);
  for (const [x, y, front, big] of stars) if (front) starAt(lit, x, y, SM.core, SM.star, big);
  if (r.flare > 0) {
    // Лучи роя из горла и прорези: веер вверх и в стороны.
    const fx = chx + 1.5;
    const fy = neck - 1;
    for (let j = 0; j < 7; j++) {
      const a = -Math.PI / 2 + (j - 3) * 0.42;
      const L = (5 + (j % 2) * 4) * r.flare + 2;
      for (let i = 2; i <= L; i++) {
        if (i > L * 0.6 && hash2(j, i, 9) < 0.5) continue;
        lit.set(
          Math.round(fx + Math.cos(a) * i),
          Math.round(fy + Math.sin(a) * i),
          i < L * 0.5 ? VIO_L : VIO,
        );
      }
    }
  }
  if (r.motes >= 0) {
    // Рой вьётся вокруг: искры по спирали вверх.
    for (let j = 0; j < 7; j++) {
      const ph = (r.motes + j / 7) % 1;
      const a = r.motes * TAU * 1.5 + j * 2.1;
      const x = chx + 1 + Math.cos(a) * (9 + (j % 3) * 2);
      const y = hip + 4 - ph * 34;
      if (Math.sin(a) < -0.2 && px.solid(Math.round(x), Math.round(y))) continue;
      lit.set(Math.round(x), Math.round(y), ph < 0.7 ? VIO_L : VIO);
      if (ph < 0.5) lit.set(Math.round(x), Math.round(y + 1), VIO);
    }
  }
  return { px, lit, ax: AX, ay: AG, eye };
}
// ---- Техники: ключевые позы и время ------------------------------------------

/** Что даёт план техники: поза тела и то, что двигает кадр целиком. */
interface Plan {
  rig: Rig;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  ghost: MobFrame['ghost'];
  shadow: number;
}

const plan = (r: Rig, o: Partial<Omit<Plan, 'rig'>> = {}): Plan => ({
  rig: r,
  dx: 0,
  dy: 0,
  sx: 1,
  sy: 1,
  rot: 0,
  ghost: null,
  shadow: 9,
  ...o,
});

/** Направление удара в кадре «смотрит вправо»: пять классов на сторону. */
function aimClass(dir: number, left: boolean): number {
  let a = left ? Math.PI - dir : dir;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, a));
  return (Math.round(a / (Math.PI / 4)) * Math.PI) / 4;
}

/** Покой: дыхание, шлем плавает с запозданием, прорезь тлеет (8 к/с, 12 кадров). */
function idleRig(now: number, angry: boolean): Rig {
  const i = Math.floor(now * (angry ? 10 : 8)) % 12;
  const p = i / 12;
  const breath = 0.5 - 0.5 * Math.cos(p * TAU);
  return rig(GUARD, {
    hy: Math.round(breath),
    helmY: Math.round(Math.sin(p * TAU - 1.4) * 1.2),
    helmX: angry ? [0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0][i] : 0,
    glow: 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(p * TAU - 0.6)),
    capeW: i,
    shY: breath > 0.5 ? 1 : 0,
    motes: angry ? p : -1,
  });
}

/** Бег: 8 кадров, тяжёлый шаг — таз проседает после опоры, шлем догоняет. */
function runRig(now: number, speed: number): Rig {
  const rate = speed > 1.2 ? 11 : 7.5;
  const i = Math.floor(now * rate) % 8;
  const p = i / 8;
  const c = Math.cos(p * TAU);
  const s = Math.sin(p * TAU);
  const cl = Math.cos((p - 1 / 8) * TAU);
  return rig(GUARD, {
    fF: 1 + 5 * s,
    fB: -1 - 5 * s,
    lF: Math.max(0, c) * 4,
    lB: Math.max(0, -c) * 4,
    hy: Math.round(1.4 * (1 - Math.abs(c))),
    lean: 2,
    helmY: Math.round(1.3 * (1 - Math.abs(cl))) - 1,
    sa: 1.2 + 0.14 * s,
    hax: 3 - 1.5 * s,
    hay: 7,
    shX: Math.round(s),
    capeT: 2 + Math.round(Math.abs(s)),
    capeW: i * 1.5,
    glow: 0.5,
  });
}

/**
 * Взмах. Контакт — кадр `floor(warn·24)`: клинок прошёл весь конус, серп
 * полный. Кадр перед ним — клинок входит в конус. До того — замах: кулак
 * поднимается (ease-in-out), потом держит натяжение, по клинку бежит блик.
 * `back` — второй взмах ярости: снизу вверх, в обратную сторону.
 */
function swingPlan(ad: number, t: number, warn: number, back: boolean): Plan {
  const S = ad - 1.05;
  const E = ad + 1.05;
  const sg = back ? -1 : 1;
  const fc = f24(warn);
  const i = f24(t);
  const tc = Math.max(1, fc - 1) / 24;
  // Замах рубящего — всегда над плечом (не ниже диагонали вверх-вперёд):
  // клинок, отведённый горизонтально, читался бы уколом.
  const coilA = back ? E + 1.25 : Math.min(S - 0.6, -0.55);
  // Замах вперёд и вверх идёт мельницей через спину: клинок опускается за
  // ногу, уходит за спину и встаёт над головой. Коротким путём он проходил
  // бы горизонтально вперёд — кадр читался уколом.
  const coilPath = !back && ad <= 0.01 ? coilA + TAU : coilA;
  const relA = back ? E - 0.5 : S + 0.5;
  const hitA = back ? S - 0.25 : E + 0.25;
  const ft1A = back ? S - 0.5 : E + 0.5;
  const ft2A = back ? S - 0.58 : E + 0.58;
  const up = (a: number) => Math.sin(a) < 0;
  // Замах: кулак над плечом (рубит сверху) или у бедра (снизу).
  const COIL = rig(GUARD, {
    ...handOn(coilPath, 6, -0.35 * sg),
    hx: -2,
    hy: 2,
    lean: back ? -2 : -3,
    fF: 4,
    fB: -5,
    helmX: -1,
    helmY: 1,
    shX: 2,
    shY: -1,
    capeT: -1,
    glow: 0.8,
    len: 21,
  });
  const COILP = rig(COIL, {
    ...handOn(coilPath - 0.14 * sg, 6, -0.35 * sg),
    hy: 3,
    lean: COIL.lean - 1,
    glow: 1,
  });
  const HIT = rig(GUARD, {
    ...handOn(hitA, 7.5, 0.2 * sg),
    hx: back ? 2 : 3,
    hy: up(hitA) ? 2 : 3,
    lean: back ? 3 : 4,
    fF: 6,
    fB: -5,
    helmX: back ? 0 : 1,
    helmY: up(hitA) ? -1 : 0,
    shX: -1,
    capeT: 3,
    capeW: 3,
    glow: 1,
    len: 22,
  });
  const FT2 = rig(HIT, {
    ...handOn(ft2A, 7, 0.1 * sg),
    lean: back ? 1 : 3,
    helmX: back ? 1 : 3,
    capeT: 3,
    capeW: 6,
    glow: 0.8,
    len: 21,
  });
  // Откуда замах: первый — из стойки, второй — из конца первого взмаха.
  const START = back ? swingEnd(ad, false) : GUARD;
  let r: Rig;
  let dx = 0;
  if (i < fc - 1) {
    const u = Math.min(1, t / tc);
    if (u < 0.6) {
      const k = eIO(u / 0.6);
      r = mixRig(START, COIL, k);
      // Кулак идёт за клинком по дуге (мельница), а не по прямой.
      const a = lerp(START.sa, coilPath, eIO(seg(u, 0.04, 0.6)));
      Object.assign(r, handOn(a, lerp(Math.hypot(START.hax, START.hay), 6, k), -0.35 * sg * k));
      // Шлем уходит назад позже тела.
      r.helmX = lerp(START.helmX, COIL.helmX, eIO(seg(u, 0.18, 0.6)));
      dx = -0.6 * k;
    } else {
      const k = eOut((u - 0.6) / 0.4);
      r = mixRig(COIL, COILP, k);
      r.gl = seg(u, 0.62, 1);
      // Натяжение: последние кадры клинок дрожит — сейчас ударит.
      if (i >= fc - 5) r.sa += i % 2 ? 0.04 : -0.04;
      dx = -0.6 - 0.4 * k;
    }
    r.capeW = f24(t) * 0.5;
  } else if (i === fc - 1) {
    r = mixRig(COILP, HIT, 0.45);
    Object.assign(r, handOn(relA, 7, 0.25 * sg));
    r.smA = coilA - 0.1 * sg;
    r.smB = relA;
    r.smK = 1;
    r.glow = 1;
    dx = 0.5;
  } else if (i === fc) {
    r = { ...HIT, smA: coilA + 0.1 * sg, smB: hitA, smK: 1 };
    dx = 2;
  } else if (i === fc + 1) {
    r = rig(mixRig(HIT, FT2, 0.6), {
      ...handOn(ft1A, 7.2, 0.15 * sg),
      smA: coilA + 0.4 * sg,
      smB: ft1A,
      smK: 0.45,
      helmX: back ? 1 : 3,
      lean: back ? 3 : 5,
    });
    dx = 2;
  } else {
    r = FT2;
    dx = 1.6;
  }
  return plan(r, { dx });
}

/** Конец взмаха — с него начинается отдых (и второй взмах ярости). */
function swingEnd(ad: number, back: boolean): Rig {
  return swingPlan(ad, 5, 0.72, back).rig;
}

/** Отдых после взмаха: тяжесть держит клинок у пола, потом — в стойку. */
function recoverSwing(ad: number, t: number, rec: number, back: boolean, base: Rig): Plan {
  const END = { ...swingEnd(ad, back), smK: 0 };
  const u = t / rec;
  let r: Rig;
  if (u < 0.2) {
    r = rig(END, { sa: END.sa + 0.06 * (back ? -1 : 1) * seg(u, 0, 0.2), helmX: END.helmX - 1 });
  } else {
    const k = eIO(seg(u, 0.2, 1));
    r = mixRig(END, base, k);
    if (Math.sin(END.sa) < -0.3) lowerBlade(r, END, base, seg(u, 0.2, 1));
    r.helmX = lerp(END.helmX - 1, base.helmX, spring(seg(u, 0.25, 1)));
  }
  r.capeW = 6 + f24(t) * 0.5;
  return plan(r, { dx: 1.6 * (1 - eIO(seg(u, 0.1, 0.8))) });
}

/**
 * Укол: 0,32 с целится (клинок на героя, кулак назад, щит вперёд), держит
 * натяжение до удара, в кадр удара — рука выброшена, прочерк во всю линию.
 * Дальше выпад (0,2 с) со шлейфом и тормоз.
 */
function thrustPlan(ad: number, t: number, hit: number): Plan {
  const fc = f24(hit);
  const i = f24(t);
  const c = Math.cos(ad);
  const s = Math.sin(ad);
  const vs = Math.abs(s);
  // Укол к камере или от неё: кулак отводится к плечу (не за голову), клинок
  // короче — в ракурсе.
  const hand = (a: number, b: number): Partial<Rig> => ({
    hax: a * (1 - 0.6 * vs) * c - b * s + 2 * vs,
    hay: a * (1 - 0.6 * vs) * s + b * c,
  });
  const len = Math.round(21 - vs * 8);
  const AIM = rig(GUARD, {
    ...hand(-9, 2),
    sa: ad,
    len,
    hx: -3,
    hy: 3,
    lean: -3,
    fF: 5,
    fB: -5,
    shX: 3,
    shY: -2,
    helmX: -1,
    capeT: -1,
    glow: 0.8,
  });
  const HOLD = rig(AIM, { ...hand(-10, 3), hy: 4, lean: -4, glow: 1 });
  let r: Rig;
  let dx = 0;
  if (t < 0.32) {
    const k = eIO(t / 0.32);
    r = mixRig(GUARD, AIM, k);
    r.sa = lerp(GUARD.sa, ad, eOut3(t / 0.32));
    dx = -0.8 * k;
  } else if (i < fc - 1) {
    const u = seg(t, 0.32, (fc - 1) / 24);
    r = mixRig(AIM, HOLD, eOut(u));
    // Блик бежит к острию и остаётся на нём звездой — сюда ударит.
    r.gl = Math.min(1, u * 1.3);
    if (i >= fc - 4) r.hy += i % 2;
    dx = -0.8 - 0.4 * u;
  } else if (i === fc - 1) {
    r = rig(HOLD, { ...hand(2, 1), lean: 1, hx: 0, thr: 7, glow: 1 });
    dx = 0.4;
  } else {
    r = lungeRig(ad, 0);
    dx = 2;
  }
  return plan(r, { dx });
}

/** Выпад: рука вытянута, передняя нога шагнула, плащ струной назад. */
function lungeRig(ad: number, t: number): Rig {
  const c = Math.cos(ad);
  const s = Math.sin(ad);
  const k = Math.min(1, t / 0.2);
  return rig(GUARD, {
    hax: 10 * c,
    hay: 10 * s,
    sa: ad,
    len: 24 - Math.abs(s) * 4,
    hx: 2,
    hy: 2,
    lean: 4,
    fF: 7 + k,
    fB: -6,
    lB: 1,
    shX: -2,
    helmX: -1,
    capeT: 4 + 2 * k,
    capeL: 1 + k,
    capeW: f24(t) * 2,
    glow: 1,
    thr: Math.round(22 * (1 - k * 0.8)),
  });
}

/** Тормоз после выпада: плащ по инерции вперёд, клинок — в стойку. */
function recoverLunge(ad: number, t: number, base: Rig): Plan {
  const END = { ...lungeRig(ad, 0.2), thr: 0 };
  const BRAKE = rig(END, { lean: -1, hy: 3, capeT: -3, capeL: 0, helmX: 2, fF: 8, fB: -5 });
  let r: Rig;
  if (t < 0.16) r = mixRig(END, BRAKE, eOut(t / 0.16));
  else {
    r = mixRig(BRAKE, base, eIO(seg(t, 0.16, 0.8)));
    r.helmX = lerp(BRAKE.helmX, 0, spring(seg(t, 0.2, 0.85)));
    r.capeT = lerp(BRAKE.capeT, 0, spring(seg(t, 0.16, 0.85)));
  }
  r.capeW = f24(t);
  return plan(r, { dx: 2 * (1 - eIO(seg(t, 0.05, 0.6))), sy: t < 0.16 ? 0.97 : 1 });
}

/** Присед перед прыжком: вдавливается в пол, меч за голову, шлем проседает позже. */
function crouchPlan(t: number, dur: number): Plan {
  const u = Math.min(1, t / dur);
  const SQUAT = rig(GUARD, {
    hy: 5,
    lean: 1,
    fF: 3,
    fB: -3,
    ...handOn(-2.3, 6),
    len: 21,
    shX: 2,
    shY: 1,
    helmY: 3,
    capeT: 1,
    glow: 1,
  });
  const k = eIO(u);
  const r = mixRig(GUARD, SQUAT, k);
  r.helmY = lerp(0, 3, eIO(seg(u, 0.2, 1)));
  r.gl = seg(u, 0.5, 1);
  r.capeW = f24(t);
  const last = f24(t) >= f24(dur) - 1;
  return plan(r, {
    sx: 1 + 0.09 * eIn(u),
    sy: 1 - 0.08 * eIn(u),
    dx: last ? (f24(t) % 2 ? 0.5 : -0.5) : 0,
  });
}

/** Прыжок: дуга через dy, в полёте группировка, в конце — рубящий удар вниз. */
function airPlan(t: number): Plan {
  const T = 0.72;
  const k = Math.min(1, t / T);
  const h = 4 * k * (1 - k);
  const i = f24(t);
  const UP = rig(GUARD, {
    hy: -2,
    fF: 1,
    fB: -1,
    lB: 1,
    ...handOn(-2.4, 6.5),
    len: 21,
    helmY: 1,
    capeL: 3,
    glow: 1,
  });
  const TUCK = rig(UP, {
    hy: 0,
    lF: 4,
    lB: 3,
    fF: 3,
    fB: -1,
    ...handOn(-2.55, 6.5),
    helmY: -1,
    capeL: 5,
  });
  const DOWN = rig(TUCK, {
    lF: 1,
    lB: 0,
    fF: 3,
    fB: -2,
    ...handOn(-2.3, 6.5),
    capeL: 4,
    helmY: -2,
  });
  let r: Rig;
  let sx = 1;
  let sy = 1;
  if (k < 0.14) {
    const u = k / 0.14;
    r = mixRig(UP, TUCK, eIn(u) * 0.3);
    sy = lerp(1.12, 1.02, u);
    sx = lerp(0.92, 0.99, u);
  } else if (k < 0.55) r = mixRig(UP, TUCK, lerp(0.3, 1, eOut(seg(k, 0.14, 0.55))));
  else if (i < 14) r = mixRig(TUCK, DOWN, eIO(seg(k, 0.55, 0.8)));
  else {
    // Рубящий удар сверху: три кадра до земли.
    const a = [-1.25, 0.15, 0.85][Math.min(2, i - 14)];
    r = rig(DOWN, {
      ...handOn(a, 7.5, 0.2),
      len: 22,
      hy: -1,
      lF: 0,
      lB: 0,
      fF: 3,
      fB: -2,
      smA: -2.5,
      smB: a,
      smK: 1,
      helmY: -1,
    });
    sy = 1.07;
    sx = 0.96;
  }
  r.capeW = i;
  return plan(r, {
    dy: -28 * h,
    sx,
    sy,
    shadow: Math.round(9 - 4 * h),
    // Шлейф — только на быстрых участках (взлёт и пике): у вершины силуэты
    // ложились бы на самого (движок рисует их поверх моба) и красили его.
    ghost: k < 0.2 || k > 0.74 ? { every: 0.035, life: 0.18, tint: '#a58ce6', alpha: 0.28 } : null,
  });
}

/** Приземление с прыжка: удар об пол, меч в полу, отскок, выдернуть клинок. */
function recoverLand(t: number, base: Rig): Plan {
  const SLAM = rig(GUARD, {
    hy: 5,
    lean: 3,
    fF: 6,
    fB: -5,
    ...handOn(1.05, 9, -0.3),
    len: 15,
    helmY: 2,
    helmX: 1,
    capeL: 4,
    capeT: 1,
    shX: 3,
    shY: 2,
    glow: 1,
    flare: 1,
  });
  const PULL = rig(SLAM, { hy: 3, ...handOn(1.2, 7.5), len: 20, capeL: 0, helmY: -1, flare: 0 });
  let r: Rig;
  let sx = 1;
  let sy = 1;
  if (t < 0.085) {
    r = SLAM;
    sy = 0.84;
    sx = 1.16;
  } else if (t < 0.22) {
    const u = seg(t, 0.085, 0.22);
    r = mixRig(SLAM, rig(SLAM, { hy: 3, capeL: 1, helmY: -2, flare: 0.3 }), eOut(u));
    sy = lerp(0.84, 1.04, eOut(u));
    sx = lerp(1.16, 0.97, eOut(u));
  } else if (t < 0.42) {
    const u = seg(t, 0.22, 0.42);
    r = mixRig(rig(SLAM, { hy: 3, capeL: 1, helmY: -2, flare: 0.3 }), PULL, eIO(u));
    // Рывок: клинок выходит из пола в один кадр.
    if (u > 0.5) r.len = 20;
    sy = lerp(1.04, 1, u);
    sx = lerp(0.97, 1, u);
  } else {
    r = mixRig(PULL, base, eIO(seg(t, 0.42, 1)));
    r.helmY = lerp(PULL.helmY, 0, spring(seg(t, 0.42, 1)));
  }
  r.capeW = f24(t);
  return plan(r, { sx, sy });
}

/** Оглушение о стену: откат, шлем шатается по кругу, звёзды, стряхнул. */
function dizzyPlan(t: number): Plan {
  const HIT = rig(GUARD, {
    lean: -3,
    hy: 1,
    ...handOn(2.4, 6),
    helmY: -4,
    helmX: -2,
    helmR: -1,
    glow: 0.2,
    capeT: -2,
  });
  const loop = (tau: number): Rig => {
    const th = tau * TAU * 1.5;
    return rig(GUARD, {
      lean: Math.round(1.6 * Math.sin(tau * TAU * 1.3)),
      hy: 1 + Math.round(0.5 + 0.5 * Math.sin(tau * TAU * 2.6)),
      helmX: Math.round(2 * Math.cos(th)),
      helmY: Math.round(1 + Math.sin(th)),
      helmR: Math.round(Math.cos(th)),
      ...handOn(1.52 + 0.08 * Math.sin(tau * TAU * 1.3), 7),
      glow: 0.15 + (0.25 * ((f24(tau) * 7) % 3)) / 2,
      capeW: f24(tau),
      stars: tau * 1.3,
    });
  };
  let r: Rig;
  if (t < 0.1) r = mixRig(GUARD, HIT, eOut(t / 0.1));
  else if (t < 0.3) r = mixRig(HIT, loop(t - 0.1), eIO(seg(t, 0.1, 0.3)));
  else if (t < 1.05) r = loop(t - 0.1);
  else {
    const u = seg(t, 1.05, 1.3);
    r = mixRig(loop(0.95), GUARD, eIO(u));
    r.helmX = lerp(loop(0.95).helmX, 0, spring(u));
    r.stars = u < 0.5 ? loop(t - 0.1).stars : -1;
    r.glow = lerp(0.3, 0.6, u);
  }
  if (t >= 0.1 && t < 0.3) r.stars = loop(t - 0.1).stars;
  return plan(r);
}

/** Рёв: присесть, взметнуть меч к своду, шлем взлетает, рой вьётся, опустить. */
function roarPlan(t: number): Plan {
  const GATHER = rig(GUARD, {
    hy: 3,
    lean: -1,
    ...handOn(2.5, 6),
    shX: 2,
    helmY: 2,
    glow: 0.25,
    capeT: -1,
  });
  const CRY = rig(GUARD, {
    hy: -1,
    fF: 3,
    fB: -3,
    ...handOn(-1.7, 8, 0.3),
    len: 21,
    shX: -3,
    shY: -2,
    helmY: -6,
    glow: 1,
    flare: 1,
    capeT: 2,
    capeL: 2,
  });
  let r: Rig;
  let dy = 0;
  let sy = 1;
  const i = f24(t);
  if (t < 0.2) r = mixRig(GUARD, GATHER, eIO(t / 0.2));
  else if (t < 0.32) {
    const u = seg(t, 0.2, 0.32);
    r = mixRig(GATHER, CRY, eOut3(u));
    dy = -2 * Math.sin(Math.PI * u);
    sy = 1 + 0.06 * Math.sin(Math.PI * u);
  } else if (t < 0.95) {
    const u = seg(t, 0.32, 0.95);
    r = rig(CRY, {
      helmX: [0, 1, 0, -1][i % 4],
      helmY: -5 - (i % 2),
      sa: CRY.sa + (i % 2 ? 0.03 : -0.03),
      flare: 1 - 0.5 * u,
      motes: (t - 0.32) * 1.6,
      gl: seg(u, 0, 0.5),
    });
  } else {
    const u = seg(t, 0.95, 1.2);
    r = mixRig(CRY, GUARD, eIO(u));
    lowerBlade(r, CRY, GUARD, u);
    r.helmY = lerp(-5, 0, spring(u));
    r.flare = 0;
  }
  r.capeW = i;
  return plan(r, { dy, sy });
}
// ---- Смерть и сборка ------------------------------------------------------------

/**
 * Где деталь сидит на теле в стойке (центр детали от точки ног, смотрит
 * вправо): 0 шлем, 1 кираса, 2 наплечник, 3 перчатка, 4 поножа, 5 клинок.
 * Отсюда обломки разлетаются при разбитии и сюда же возвращаются при сборке.
 */
const PART_SLOT: [number, number][] = [
  [2, -33],
  [1, -21],
  [6, -25],
  [9, -17],
  [2, -5],
  [13, -6],
];

/**
 * Разбитие (1,5 с). Шлем, кираса, наплечник, перчатка, поножа и клинок —
 * обломки (отдельные мобы, летят сами со своих мест на теле), а тут
 * остаётся пустое: плащ, щит, дальняя нога. Кадр удара — рой бьёт из горла,
 * взрыв раздувает плащ и отбрасывает щит; потом всё оседает кучей, рой
 * уходит искрами, куча истлевает.
 */
function remainsDraw(t: number, cracked: boolean): Pair {
  // С первого кадра шлем, кираса, наплечник, перчатка, поножа и клинок —
  // уже обломки (отдельные мобы стартуют со своих мест на теле), поэтому
  // тут только то, что осталось: иначе в стоп-кадре детали двоились бы.
  const u = eIn(seg(t, 0.04, 0.34));
  const b = t > 0.34 ? wob(seg(t, 0.34, 0.62), 1) * 1.5 : 0;
  // Взрыв изнутри: плащ раздувает, щит отбрасывает — потом всё оседает.
  const blast = 1 - eOut(seg(t, 0.04, 0.3));
  const r = normRig(
    rig(GUARD, {
      hy: 9 * u - b,
      slump: 6 * u,
      capeT: 5 * u - 3 * blast,
      capeL: 5 * blast - 1,
      capeW: f24(t),
      shSq: u,
      shX: -3 * u - 2 * blast,
      shY: -2 * blast,
      fB: -1 - 2 * u,
      glow: 0.2,
      flare: t < 0.05 ? 1 : 0.8 * blast,
      crack: cracked ? 1 : 0,
    }),
  );
  const out = armorDraw(r, PT.cape | PT.shield | PT.legB | PT.skirt | PT.paulB);
  const { px, lit } = out;
  const AX = CANVAS.ax;
  const AG = CANVAS.ag;
  // Рой уходит из кучи: искры поднимаются и гаснут.
  for (let j = 0; j < 9; j++) {
    const born = 0.05 + j * 0.09;
    const age = t - born;
    if (age < 0 || age > 0.7) continue;
    const k = age / 0.7;
    const x = AX - 4 + (j % 3) * 4 + Math.sin(age * 9 + j) * 2;
    const y = AG - 5 - k * 22 - (j % 2) * 3;
    lit!.set(Math.round(x), Math.round(y), k < 0.5 ? VIO_L : VIO);
    if (k < 0.4) lit!.set(Math.round(x), Math.round(y) + 1, VIO);
  }
  // Истлевает: пиксели гаснут по шуму, на кромке — лиловые искры.
  const d = seg(t, 0.95, 1.45);
  if (d > 0)
    for (let y = 0; y < px.h; y++)
      for (let x = 0; x < px.w; x++) {
        if (!px.solid(x, y)) continue;
        const h = hash2(x, y, 11);
        if (h < d) clearPx(px, x, y);
        else if (h < d + 0.06) lit!.set(x, y, h < d + 0.03 ? VIO_L : VIO);
      }
  return out;
}

/** Стереть пиксель (`Px.set` прозрачным не пишет). */
function clearPx(px: Px, x: number, y: number): void {
  const k = (y * px.w + x) * 4;
  px.data[k] = px.data[k + 1] = px.data[k + 2] = px.data[k + 3] = 0;
}

/** Когда деталь летит на тело при сборке: [начало, конец], с. */
const REB_WIN: [number, number][] = [
  [0.66, 0.88],
  [0.22, 0.42],
  [0.38, 0.54],
  [0.46, 0.6],
  [0.08, 0.26],
  [0.56, 0.74],
];
/** Какие части тела встают на место вместе с деталью. */
const REB_PARTS = [
  PT.helm | PT.neck,
  PT.cuirass | PT.skirt | PT.paulB,
  PT.paulF,
  PT.arm,
  PT.legF | PT.legB,
  PT.sword,
];
const REB_CV: Canvas = { w: 140, h: 116, ax: 70, ag: 84 };
/** Куча по умолчанию (если мозг не записал, где лежали обломки). */
const REB_PILE: [number, number][] = [
  [-7, 2],
  [5, 3],
  [-2, -3],
  [8, -2],
  [1, 5],
  [0, -9],
];

/**
 * Сборка без обломков — то, что не зависит от того, где они лежали: встающее
 * тело, сотканные плащ и щит, лиловый призрак роя, искры щелчков. Кадр на
 * номер (24 к/с) один на все сборки — лежит в кеше и прогревается; обломки
 * кладутся поверх копии.
 */
const rebBaseCache = new Map<string, Pair>();
function rebBase(i: number, cracked: boolean): Pair {
  const key = `${i}|${cracked ? 1 : 0}`;
  const hit = rebBaseCache.get(key);
  if (hit) return hit;
  const t = i / 24;
  const AX = REB_CV.ax;
  const AG = REB_CV.ag;
  let parts = 0;
  for (let p = 0; p < 6; p++) if (t >= REB_WIN[p][1]) parts |= REB_PARTS[p];
  const weave = seg(t, 0.28, 0.62);
  const lastLand = REB_WIN.reduce((a, w) => (t >= w[1] ? Math.max(a, w[1]) : a), -1);
  const settle = lastLand >= 0 ? Math.max(0, 1 - (t - lastLand) / 0.08) : 0;
  const r = normRig(
    rig(GUARD, {
      hy: settle > 0 ? 1 : 0,
      glow: t >= 0.88 ? 1 : 0.4,
      flare: t >= 0.88 ? 1 - seg(t, 0.88, 0.95) * 0.6 : 0,
      crack: cracked ? 1 : 0,
    }),
  );
  const body = armorDraw(r, parts & ~(PT.cape | PT.shield), REB_CV);
  const px = body.px;
  const lit = body.lit!;
  // Плащ и щит: рой ткёт их — пиксели проступают по шуму, под телом.
  if (weave > 0) {
    const back = rebBack();
    for (let y = 0; y < px.h; y++)
      for (let x = 0; x < px.w; x++) {
        if (!back.solid(x, y) || px.solid(x, y)) continue;
        const h = hash2(x, y, 5);
        if (h < weave) px.set(x, y, back.get(x, y));
        else if (h < weave + 0.12) lit.set(x, y, VIO);
      }
  }
  // Призрак роя: контур тела пунктиром и редкие искры внутри — рой держит
  // форму, на которую садятся латы. Встаёт от пола вверх.
  if (t < 0.9) {
    const ghostB = rebGhost();
    const rise = AG - eOut(seg(t, 0, 0.35)) * 60;
    const fade = 1 - seg(t, 0.72, 0.9);
    const ph = i >> 1;
    for (let y = Math.max(0, Math.floor(rise)); y < px.h; y++)
      for (let x = 0; x < px.w; x++) {
        if (px.solid(x, y)) continue;
        const k = (y * ghostB.w + x) * 4;
        if (!ghostB.data[k + 3]) continue;
        const edge = ghostB.data[k] === INK[0] && ghostB.data[k + 1] === INK[1];
        const h = hash2(x, y, ph);
        if (edge ? h < 0.55 * fade : h < 0.07 * fade) lit.set(x, y, edge && h < 0.12 ? VIO_L : VIO);
      }
  }
  // Щелчок встающей детали — искра на месте.
  for (let p = 0; p < 6; p++) {
    const w1 = REB_WIN[p][1];
    if (t < w1 || t >= w1 + 0.09) continue;
    const [sx, sy] = PART_SLOT[p];
    starAt(lit, AX + sx, AG + sy, SM.core, VIO_L, true);
    lit.set(AX + sx - 2, AG + sy, VIO);
    lit.set(AX + sx + 2, AG + sy, VIO);
  }
  rebBaseCache.set(key, body);
  return body;
}

/** Копия холста (основа сборки из кеша не портится). */
function copyPx(q: Px): Px {
  const o = new Px(q.w, q.h);
  o.data.set(q.data);
  return o;
}

/**
 * Сборка (0,95 с): рой встаёт лиловым призраком тела от пола вверх, обломки
 * взлетают туда, где лежали, — по одному, дугой, с оборотом — и садятся на
 * место: поножи, кираса, наплечник, перчатка, клинок, шлем. Плащ и щит рой
 * ткёт сам. Шлем сел — прорезь вспыхивает.
 */
function rebuildDraw(i: number, offs: [number, number][], cracked: boolean): Pair {
  const t = i / 24;
  const AX = REB_CV.ax;
  const AG = REB_CV.ag;
  const base = rebBase(i, cracked);
  const px = copyPx(base.px);
  const lit = copyPx(base.lit!);
  // Обломки: лежат, дрожат, взлетают по очереди и садятся на место.
  for (let p = 0; p < 6; p++) {
    const [w0, w1] = REB_WIN[p];
    if (t >= w1) continue;
    const [ox, oy] = offs[p];
    const k = seg(t, w0, w1);
    const [sx, sy] = PART_SLOT[p];
    const rest = p === 5 ? -12 : PLATE_REST[p];
    const x = lerp(AX + ox, AX + sx, eIO(k));
    const y = lerp(AG + oy + rest, AG + sy, eIO(k)) - 12 * 4 * k * (1 - k);
    if (p === 5) {
      // Клинок летит в руку оборотом.
      const a = lerp(Math.PI / 2, GUARD.sa + TAU, eIO(k));
      const q = new Px(40, 40);
      swordAt(q, 20 - Math.cos(a) * 10, 20 - Math.sin(a) * 10, a, 20, false);
      q.outline(INK);
      blitAt(px, q, Math.round(x) - 20, Math.round(y) - 20);
    } else {
      const shake = t > 0 && k === 0 ? (i + p) % 2 : 0;
      const ang = k > 0 ? (p % 2 ? -1 : 1) * TAU * eIO(k) : 0;
      const q = plateSprite(p, ang);
      blitAt(px, q, Math.round(x) - 10 + shake, Math.round(y) - 10);
      // Нить роя от лежащего обломка к телу.
      if (k === 0 && t > 0.02)
        for (let j = 1; j < 12; j++) {
          const kk = j / 12;
          const lx = Math.round(lerp(x, AX + 1, kk));
          const ly = Math.round(lerp(y, AG - 16, kk) - Math.sin(kk * Math.PI) * 4);
          if (hash2(j, p, i) < 0.55) lit.set(lx, ly, j % 3 ? VIO : VIO_L);
        }
    }
  }
  return { px, lit, ax: base.ax, ay: base.ay, eye: base.eye };
}

let rebBackPx: Px | null = null;
let rebGhostPx: Px | null = null;
/** Плащ и щит в стойке и силуэт всего тела — рисуются один раз. */
const rebBack = () =>
  rebBackPx || (rebBackPx = armorDraw(normRig(GUARD), PT.cape | PT.shield, REB_CV).px);
const rebGhost = () => rebGhostPx || (rebGhostPx = armorDraw(normRig(GUARD), PT_ALL, REB_CV).px);

/** Наложить картинку поверх (непрозрачные пиксели). */
function blitAt(dst: Px, src: Px, x0: number, y0: number): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const k = (y * src.w + x) * 4;
      if (src.data[k + 3])
        dst.set(x0 + x, y0 + y, [src.data[k], src.data[k + 1], src.data[k + 2], src.data[k + 3]]);
    }
}

// ---- Кеш и рисовальщик доспехов ---------------------------------------------------

const ARM_LRU = frameLRU<MobFrame>(400);

function armorPlan(m: Mob, pose: MobPose): Plan {
  const t = pose.t;
  const angry = (m.data.angry ?? 0) > 0;
  const haste = angry ? 1.2 : 1;
  const ad = aimClass(m.dir, pose.left);
  switch (pose.mode) {
    case 'roar':
      return roarPlan(t);
    case 'swing':
      return swingPlan(ad, t, m.data.warn ?? 0.72, (m.data.combo ?? 0) > 0);
    case 'thrustAim':
      return thrustPlan(ad, t, 0.32 + 0.4 / haste);
    case 'lunge': {
      const vert = Math.abs(Math.sin(ad)) > 0.7;
      return plan(lungeRig(ad, t), {
        dx: 2,
        sx: vert ? 0.97 : 1.05,
        sy: vert ? 1.04 : 0.97,
        ghost: { every: 0.03, life: 0.24, tint: '#b9a2ff', alpha: 0.3 },
      });
    }
    case 'crouch':
      return crouchPlan(t, 0.5 / haste);
    case 'air':
      return airPlan(t);
    case 'recover': {
      const rec = m.data.rec ?? 0.6;
      if (rec >= 0.99) return recoverLand(t, GUARD);
      if (rec > 0.7) return recoverLunge(ad, t, GUARD);
      return recoverSwing(ad, t, rec, angry, GUARD);
    }
    case 'dizzy':
      return dizzyPlan(t);
    default: {
      const speed = Math.hypot(m.vx, m.vy);
      if (speed > 0.4) return plan(runRig(pose.now, speed));
      return plan(idleRig(pose.now, angry));
    }
  }
}

registerMobPainter('f2_armor', (m, pose) => {
  const angry = (m.data.angry ?? 0) > 0;
  const side = pose.left ? -1 : 1;
  if (pose.mode === 'dying') {
    const t = pose.t;
    const i = Math.min(36, f24(t));
    const key = `rem|${i}|${angry ? 1 : 0}|${lookKey(pose)}`;
    let fr = ARM_LRU.get(key);
    if (!fr) fr = ARM_LRU.set(key, finishPair(remainsDraw(t, angry), pose));
    return {
      ...fr,
      still: true,
      shadow: Math.max(0, Math.round(9 - 3 * seg(t, 0.9, 1.45))),
      linger: 1.5,
      dy: i === 0 ? -1 : 0,
    };
  }
  if (pose.mode === 'rebuild') {
    const t = pose.t;
    const i = Math.min(23, f24(t));
    const offs = PART_SLOT.map((_, p): [number, number] => {
      const x = m.data[`vP${p}x`];
      const y = m.data[`vP${p}y`];
      if (x === undefined || y === undefined) return REB_PILE[p];
      const cx = Math.max(-30, Math.min(30, Math.round(x)));
      return [pose.left ? -cx : cx, Math.max(-24, Math.min(22, Math.round(y)))];
    });
    const key = `reb|${i}|${offs.join(';')}|${angry ? 1 : 0}|${lookKey(pose)}`;
    let fr = ARM_LRU.get(key);
    if (!fr) fr = ARM_LRU.set(key, finishPair(rebuildDraw(i, offs, angry), pose));
    return { ...fr, still: true, shadow: 9 };
  }
  const p = armorPlan(m, pose);
  // Трещины: в ярости — всегда; в миг «ЛАТЫ ТРЕЩАТ» — растут, рой бьёт.
  let crack = angry ? 1 : 0;
  const sim = paintSim();
  const vc = m.data.vCrack;
  if (sim && vc !== undefined) {
    const age = sim.time - vc;
    if (age >= 0 && age < 0.9) {
      crack = Math.max(0.2, Math.min(1, age / 0.45));
      p.rig.flare = Math.max(p.rig.flare, 1 - age / 0.6);
      p.rig.motes = age < 0.8 ? age * 1.4 : p.rig.motes;
      p.rig.glow = 1;
      // Латы дёрнуло изнутри: шлем подбросило, корпус качнуло назад.
      const j = 1 - seg(age, 0, 0.45);
      p.rig.helmY -= Math.round(3 * j);
      p.rig.lean -= Math.round(2 * j);
      if (age < 0.4) p.dx += (f24(age) % 2 ? 1 : -1) * (1 - age / 0.4);
    }
  }
  p.rig.crack = crack;
  let dx = p.dx * side;
  let rot = p.rot * side;
  // Отдача от удара героя: корпус отшатывается ОТ героя и кренится.
  const hk = Math.min(1, m.flash / 0.12);
  if (hk > 0) {
    let ux = -side;
    if (sim) {
      const d = Math.hypot(m.x - sim.hero.x, m.y - sim.hero.y) || 1;
      ux = (m.x - sim.hero.x) / d;
    }
    dx += ux * 2.2 * hk;
    rot += ux * 0.07 * hk;
  }
  const r = normRig(p.rig);
  const key = `${rigKey(r)}|${lookKey(pose)}`;
  let fr = ARM_LRU.get(key);
  if (!fr) fr = ARM_LRU.set(key, finishPair(armorDraw(r), pose));
  return {
    ...fr,
    still: true,
    shadow: p.shadow,
    dx,
    dy: p.dy,
    sx: p.sx,
    sy: p.sy,
    rot,
    ghost: p.ghost,
  };
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

interface MitePose {
  /** Створки приоткрыты 0…2. */
  open: number;
  /** Раковина вверх-вниз. */
  bob: number;
  /** Наклон назад (−) и вперёд (+). */
  lean: number;
  /** Тело вытянуто вперёд. */
  stretch: number;
  /** Кверху брюхом. */
  flip: boolean;
  /** Стебельки качаются −1…1. */
  stalk: number;
  /** Раковина сплющена (приземление) 0…1. */
  squash: number;
}

function mitePx(s: MitePose): Px {
  const px = new Px(16, 13);
  const GY = 11;
  const cx = 6 + s.lean;
  const { open, bob, stretch, flip } = s;
  if (!flip) {
    // Тело — слизень под раковиной, вытянут вперёд.
    px.ell(cx + 2 + stretch, GY - 1 + bob * 0.3, 3.2 + stretch, 1.4, MIT.body);
    px.set(Math.round(cx + 3 + stretch), GY - 2, MIT.bodyL);
    // Стебельки глаз.
    const ex = Math.round(cx + 4 + stretch);
    const tx = ex + 1 + s.stalk;
    px.line(ex, GY - 2, tx, GY - 5 - open, MIT.body);
    px.set(tx, GY - 6 - open, MIT.eye);
  }
  const sy = GY - 3 + bob + (flip ? 1 : 0) + s.squash * 0.6;
  const e: Ell = { x: cx, y: sy, rx: 4.6 + s.squash * 0.6, ry: 3.6 - s.squash * 0.9 };
  ball(px, e, MIT.shell, (_x, y) => (flip ? y >= sy - 1 : y <= sy + 1));
  const rk = e.ry / 3.6;
  for (let i = -2; i <= 2; i++)
    px.line(
      Math.round(cx - 3),
      Math.round(sy + (flip ? -1 : 1)),
      Math.round(cx + i * 1.8),
      Math.round(flip ? sy + (3 - Math.abs(i) * 0.6) * rk : sy - (3 - Math.abs(i) * 0.6) * rk),
      MIT.rib,
    );
  if (open > 0 && !flip) {
    px.line(
      Math.round(cx - 3),
      Math.round(sy + 1.5),
      Math.round(cx + 4),
      Math.round(sy + 1.5 + open),
      VIO_D,
    );
    px.set(Math.round(cx + 2), Math.round(sy + 1.5 + open * 0.5), VIO);
  }
  if (flip) {
    // Кверху брюхом: мягкое тело торчит и дёргается.
    px.ell(cx + 1, sy - 2, 2.4, 1.1, MIT.body);
    px.set(Math.round(cx + 3 + s.stalk), Math.round(sy - 3), MIT.bodyL);
  }
  px.outline(INK);
  return px;
}

const MITE_LRU = frameLRU<MobFrame>(260);

registerMobPainter('f2_mite', (m, pose) => {
  const t = pose.t;
  // Своя фаза у каждого: рой не дышит хором.
  const now = pose.now + m.id * 0.37;
  const s: MitePose = { open: 0, bob: 0, lean: 0, stretch: 0, flip: false, stalk: 0, squash: 0 };
  let dx = 0;
  let dy = 0;
  let sx = 1;
  let sy = 1;
  let a = 1;
  let ghost: MobFrame['ghost'] = null;
  let linger: number | undefined;
  let glowK = 0;
  const moving = Math.hypot(m.vx, m.vy) > 0.5;
  switch (pose.mode) {
    case 'hop': {
      // Прыжок от клинка: присел → дугой в сторону → сплющился о пол.
      const k = Math.min(1, t / 0.22);
      const i = f24(t);
      dy = -9 * 4 * k * (1 - k);
      s.open = 0;
      s.stalk = -1;
      s.lean = i === 0 ? -1 : 0;
      s.squash = i === 0 || k > 0.9 ? 1 : 0;
      s.bob = i === 0 ? 1 : -1;
      ghost = { every: 0.03, life: 0.14, tint: '#d8c8ff', alpha: 0.35 };
      break;
    }
    case 'windup': {
      // Замах укуса: встаёт на дыбы, створки распахнуты, внутри горит рой.
      const u = Math.min(1, t / 0.3);
      s.lean = u < 0.4 ? -1 : -2;
      s.open = u < 0.25 ? 1 : 2;
      s.stretch = u < 0.6 ? 0 : -1;
      s.bob = u < 0.5 ? 0 : -1;
      s.stalk = f24(t) % 2 ? 1 : 0;
      glowK = u;
      break;
    }
    case 'recover':
      if (t < 0.18) {
        // Укус: выброс вперёд и назад.
        const k = t / 0.18;
        s.open = k < 0.5 ? 1 : 0;
        s.stretch = k < 0.5 ? 3 : 1;
        s.lean = 1;
        dx = 3 * Math.sin(Math.PI * Math.min(1, k * 1.4));
        sx = 1 + 0.12 * (1 - k);
      } else {
        s.open = 0;
        s.stalk = f24(t) % 4 < 2 ? 0 : 1;
      }
      break;
    case 'stun': {
      // Выбросило из лат — кувырок раковиной.
      const i = Math.floor(t * 18);
      const seq = [0, 1, 2, 1];
      const ph = seq[i % 4];
      s.flip = ph === 2;
      s.lean = ph === 1 ? -1 : 0;
      s.squash = ph === 1 ? 1 : 0;
      dy = t < 0.25 ? -5 * Math.sin((Math.PI * t) / 0.25) : 0;
      break;
    }
    case 'escape': {
      // Ныряет в латы: сжимается в точку, рой гаснет искрой.
      const k = Math.min(1, t / 0.4);
      s.open = 2;
      s.stretch = 2;
      s.lean = 1;
      sx = sy = 1 - 0.85 * eIn(k);
      a = 1 - k * k;
      glowK = 1;
      break;
    }
    case 'dying': {
      // Раковина слетает кверху брюхом, тело растекается и гаснет.
      linger = 0.9;
      s.flip = t > 0.06;
      s.squash = t > 0.3 ? 1 : 0;
      s.stalk = f24(t) % 3 === 0 ? 1 : 0;
      dy = t > 0.06 && t < 0.3 ? -6 * Math.sin((Math.PI * (t - 0.06)) / 0.24) : 0;
      a = 1 - seg(t, 0.45, 0.9);
      break;
    }
    default: {
      if (moving || pose.anim === 'run') {
        // Бег прыжками: оттолкнулся — вытянулся — сплющился.
        const i = Math.floor(now * 14) % 6;
        s.bob = -[0, 1, 2, 1, 0, 0][i];
        s.stretch = [0, 1, 2, 1, 0, 0][i];
        s.squash = i === 4 ? 1 : 0;
        s.stalk = [0, -1, -1, 0, 1, 0][i];
        if (pose.mode === 'gather') glowK = 0.6;
      } else {
        // Покой: створки дышат, глаза оглядываются.
        const i = Math.floor(now * 7) % 8;
        s.open = [0, 0, 1, 1, 1, 0, 0, 0][i];
        s.bob = [0, 0, 0, -1, 0, 0, 0, 0][i];
        s.stalk = [0, 1, 1, 0, -1, -1, 0, 0][i];
      }
    }
  }
  const gk = Math.round(glowK * 3);
  const key = `${s.open}|${s.bob}|${s.lean}|${s.stretch}|${s.flip ? 1 : 0}|${s.stalk}|${s.squash}|${gk}|${lookKey(pose)}`;
  let fr = MITE_LRU.get(key);
  if (!fr) {
    const px = mitePx(s);
    const lit = new Px(px.w, px.h);
    if (gk > 0 && !s.flip) {
      // Рой внутри светится сквозь створки.
      const cx = 6 + s.lean;
      const yy = 11 - 3 + s.bob + s.squash * 0.6 + 1.5;
      lit.set(Math.round(cx + 2), Math.round(yy + s.open * 0.5), gk > 1 ? VIO_L : VIO);
      if (gk > 1) lit.set(Math.round(cx + 1), Math.round(yy + s.open * 0.5), VIO);
      if (gk > 2) lit.set(Math.round(cx + 3), Math.round(yy + s.open * 0.5), VIO);
    }
    const eye: [number, number] | null = s.flip
      ? null
      : [Math.round(6 + s.lean + 5 + s.stretch + s.stalk), 11 - 6 - s.open];
    fr = MITE_LRU.set(key, finishPair({ px, lit, ax: 7, ay: 11, eye }, pose));
  }
  return {
    ...fr,
    still: true,
    shadow: 3,
    dx: dx * (pose.left ? -1 : 1),
    dy,
    sx,
    sy,
    alpha: a,
    ghost,
    linger,
  };
});

// ---------------------------------------------------------------------------
// Обломки лат: летят кувырком по дуге, падают с отскоком, дрожат перед
// сборкой, ползут к остальным. Поворот — пиксельный (RotSprite-lite), не
// поворот холста.
// ---------------------------------------------------------------------------

/** Обломок без контура, 16×12, земля — строка 10. */
function plateRaw(part: number): Px {
  const px = new Px(16, 12);
  const GY = 10;
  const P = ARM.steel;
  switch (part) {
    case 0: {
      // Шлем на боку, прорезью к зрителю — внутри темно.
      ball(px, { x: 8, y: GY - 3.5, rx: 5, ry: 3.6 }, P);
      px.rect(6, GY - 4, 11, GY - 4, ARM.steelD);
      px.rect(9, GY - 4, 9, GY - 2, ARM.steelD);
      px.set(8, GY - 4, VIO);
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
  return px;
}

/** Середина обломка (ось поворота) и сколько она над землёй. */
const PLATE_MID: [number, number][] = [0, 1, 2, 3, 4].map((p): [number, number] => {
  const q = plateRaw(p);
  let x0 = 99;
  let x1 = -1;
  let y0 = 99;
  let y1 = -1;
  for (let y = 0; y < q.h; y++)
    for (let x = 0; x < q.w; x++)
      if (q.solid(x, y)) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
});
/** Где середина лежащего обломка относительно пола (отрицательно — выше). */
const PLATE_REST = [0, 1, 2, 3, 4, 5].map((p) => (p < 5 ? PLATE_MID[p][1] - 10 : -2));

const PLATE_STEPS = 32;
const plateCache = new Map<string, Px>();
/** Обломок, повёрнутый на угол (32 шага), с контуром; ось — середина 20×20. */
function plateSprite(part: number, ang: number): Px {
  const n = mod(Math.round((ang / TAU) * PLATE_STEPS), PLATE_STEPS);
  const key = `${part}|${n}`;
  let q = plateCache.get(key);
  if (!q) {
    const [mx, my] = PLATE_MID[part];
    q = rotPx(plateRaw(part), (n / PLATE_STEPS) * TAU, mx, my, 20);
    q.outline(INK);
    plateCache.set(key, q);
  }
  return q;
}

const PLATE_LRU = frameLRU<MobFrame>(300);

registerMobPainter('f2_plate', (m, pose) => {
  const part = Math.max(0, Math.min(4, m.data.part ?? 0));
  const t = pose.t;
  const left = (m.data.vL ?? 0) > 0;
  const rest = PLATE_REST[part];
  const spin = m.id % 2 ? -1 : 1;
  let ang = 0;
  let dx = 0;
  let dy = rest;
  let hot = 0;
  let fade = 0;
  let linger: number | undefined;
  let ghost: MobFrame['ghost'] = null;
  let alphaK = 1;
  switch (pose.mode) {
    case 'fly': {
      // С места на теле — дугой к метке, кувырком; к земле — ровно на бок.
      const T = m.data.T ?? 0.5;
      const k = Math.min(1, t / T);
      const [sx0, sy0] = PART_SLOT[part];
      dx = (left ? -sx0 : sx0) * (1 - k);
      dy = lerp(sy0, rest, k) - (12 + part * 2) * 4 * k * (1 - k);
      ang = spin * (1 + (m.id % 3 === 0 ? 1 : 0)) * TAU * k;
      ghost = { every: 0.035, life: 0.14, tint: '#c8d0e0', alpha: 0.3 };
      break;
    }
    case 'lie': {
      // Отскок от пола, потом покачивается и замирает. Шлем катается.
      const b1 = t < 0.2 ? Math.sin((Math.PI * t) / 0.2) * 4 : 0;
      const b2 = t >= 0.2 && t < 0.3 ? Math.sin((Math.PI * (t - 0.2)) / 0.1) * 1.2 : 0;
      dy = rest - b1 - b2;
      ang = t < 0.3 ? -spin * 0.35 * Math.sin((Math.PI * t) / 0.3) : 0;
      if (part === 0 && t < 1.2) {
        // Шлем катится по полу туда-обратно, пока не ляжет.
        const roll = 6 * Math.exp(-3.2 * t) * Math.sin(TAU * 1.1 * t);
        dx += (left ? -1 : 1) * roll;
        ang += roll / 4;
      } else if (t < 0.6) ang += 0.2 * wob(seg(t, 0.3, 0.6), 1);
      // Перед сборкой дрожит: чем ближе, тем чаще и сильнее; прорезь шлема
      // загорается, по краю — лиловый отсвет роя.
      const tw = m.data.tw ?? 0;
      if (tw > 0.15) {
        const ph = Math.floor(pose.now * (8 + 22 * tw) + m.id);
        dx += (ph % 2 ? 1 : -1) * (tw > 0.6 ? 1 : 0.5);
        if (tw > 0.75 && ph % 5 === 0) dy -= 1.5;
        if (tw > 0.5) ang += (ph % 3 === 0 ? 1 : 0) * spin * (TAU / PLATE_STEPS);
        hot = tw > 0.5 ? 2 : 1;
      }
      break;
    }
    case 'gather': {
      // Ползёт к остальным подскоками, наклоняясь по ходу.
      const v = Math.hypot(m.vx, m.vy);
      const ph = pose.now * 9 + m.id;
      if (v > 0.2) {
        dy = rest - 2.5 * Math.abs(Math.sin(ph));
        ang = Math.sign(m.vx || 1) * 0.2 * Math.cos(ph);
      } else {
        dx = Math.floor(ph) % 2 ? 0.5 : -0.5;
      }
      hot = 2;
      break;
    }
    case 'dying': {
      // Рой добит: последний подскок, отсвет гаснет, обломок истлевает.
      linger = 1.6;
      dy = rest - (t < 0.22 ? Math.sin((Math.PI * t) / 0.22) * 3 : 0);
      hot = t < 0.25 ? 2 : t < 0.55 ? 1 : 0;
      fade = seg(t, 0.8, 1.5);
      alphaK = 1 - seg(t, 1.35, 1.6);
      break;
    }
  }
  const n = mod(Math.round((ang / TAU) * PLATE_STEPS), PLATE_STEPS);
  const fk = Math.round(fade * 8);
  const key = `${part}|${n}|${hot}|${fk}|${left ? 1 : 0}|${pose.flash ? 1 : 0}`;
  let fr = PLATE_LRU.get(key);
  if (!fr) {
    const q = plateSprite(part, (n / PLATE_STEPS) * TAU);
    const px = new Px(q.w, q.h);
    px.data.set(q.data);
    const lit = new Px(q.w, q.h);
    if (hot) {
      // Отсвет роя: лиловые пиксели по кромке снизу, у шлема — прорезь.
      for (let y = 1; y < px.h - 1; y++)
        for (let x = 1; x < px.w - 1; x++) {
          const c = px.get(x, y);
          const edge = c[3] && c[0] === INK[0] && c[1] === INK[1] && c[2] === INK[2];
          if (edge && !px.solid(x, y + 1) && hash2(x, y, n) < (hot > 1 ? 0.7 : 0.35))
            lit.set(x, y, hot > 1 ? VIO : VIO_D);
        }
      if (part === 0) {
        const a = (n / PLATE_STEPS) * TAU;
        const [mx, my] = PLATE_MID[0];
        const vx = 8 - mx;
        const vy = 6 - my;
        lit.set(
          Math.round(10 + vx * Math.cos(a) - vy * Math.sin(a)),
          Math.round(10 + vx * Math.sin(a) + vy * Math.cos(a)),
          hot > 1 ? VIO_L : VIO,
        );
      }
    }
    if (fk > 0)
      for (let y = 0; y < px.h; y++)
        for (let x = 0; x < px.w; x++) {
          if (!px.solid(x, y)) continue;
          const h = hash2(x, y, part);
          if (h < fk / 8) clearPx(px, x, y);
          else if (h < fk / 8 + 0.08) lit.set(x, y, VIO);
        }
    fr = PLATE_LRU.set(
      key,
      finishPair({ px, lit, ax: 10, ay: 10, eye: null }, { ...pose, left, look: 'normal' }),
    );
  }
  return { ...fr, still: true, shadow: 3, dx, dy, ghost, linger, alpha: alphaK };
});

// ---------------------------------------------------------------------------
// Живой клинок — меч лат летает сам: рой в рукояти. 48 углов.
// ---------------------------------------------------------------------------

const BLADE_STEPS = 48;
const BLADE_LRU = frameLRU<MobFrame>(300);

/** Клинок по углу: середина клинка — в (20, 20). */
function bladeDraw(n: number, hot: number, glint: number, bend: number): Pair {
  const px = new Px(40, 40);
  const lit = new Px(40, 40);
  const ang = (n / BLADE_STEPS) * TAU;
  const hx = 20 - Math.cos(ang) * 10;
  const hy = 20 - Math.sin(ang) * 10;
  swordAt(px, hx, hy, ang, 20, false);
  if (bend) {
    // Звон: кончик дрожит на пиксель поперёк.
    const tx = Math.round(hx + Math.cos(ang) * 19);
    const ty = Math.round(hy + Math.sin(ang) * 19);
    const nx = Math.round(-Math.sin(ang) * bend);
    const ny = Math.round(Math.cos(ang) * bend);
    for (let i = 16; i <= 20; i++) {
      const x = Math.round(hx + Math.cos(ang) * i);
      const y = Math.round(hy + Math.sin(ang) * i);
      clearPx(px, x, y);
    }
    px.line(
      tx - Math.round(Math.cos(ang) * 4),
      ty - Math.round(Math.sin(ang) * 4),
      tx + nx,
      ty + ny,
      ARM.blade,
    );
  }
  // Лиловые нити роя у рукояти.
  for (let i = 0; i < 4; i++) {
    const a = ang + Math.PI + (i - 1.5) * 0.5;
    px.set(Math.round(hx + Math.cos(a) * 3), Math.round(hy + Math.sin(a) * 3), alpha(VIO, 0.8));
  }
  px.set(Math.round(hx), Math.round(hy), VIO_L);
  px.outline(INK);
  const kx = Math.round(hx - Math.cos(ang) * 2.2);
  const ky = Math.round(hy - Math.sin(ang) * 2.2);
  px.set(kx, ky, VIO_L);
  if (hot > 0) {
    lit.set(kx, ky, VIO_L);
    lit.set(Math.round(hx), Math.round(hy), hot > 1 ? WHITE : VIO_L);
    if (hot > 1) {
      // Остриё горит — сюда ударит.
      const tx = Math.round(hx + Math.cos(ang) * 20);
      const ty = Math.round(hy + Math.sin(ang) * 20);
      starAt(lit, tx, ty, SM.core, VIO_L, true);
    }
  }
  if (glint >= 0) glintAt(lit, hx, hy, ang, 20, glint);
  return { px, lit, ax: 20, ay: 20, eye: null };
}

/** Кратчайший поворот от a к b. */
const angTo = (a: number, b: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a));

registerMobPainter('f2_blade', (m, pose) => {
  const t = pose.t;
  const left = (m.data.vL ?? 0) > 0;
  const bob = Math.sin(pose.now * 2.3 + m.id) * 1.4;
  const down = Math.PI / 2;
  let ang = m.dir;
  let dx = 0;
  let dy = -6 + bob;
  let hot = 1;
  let glint = -1;
  let bend = 0;
  let thr = 0;
  let ghost: MobFrame['ghost'] = null;
  let linger: number | undefined;
  let alphaK = 1;
  let shadow = 3;
  switch (pose.mode) {
    case 'fly': {
      // Из руки лат — дугой вверх, крутясь.
      const T = m.data.T ?? 0.5;
      const k = Math.min(1, t / T);
      const [sx0, sy0] = PART_SLOT[5];
      dx = (left ? -sx0 : sx0) * (1 - k);
      dy = lerp(sy0 + 6, -6, eOut(k)) - 10 * 4 * k * (1 - k);
      ang = m.dir;
      ghost = { every: 0.03, life: 0.16, tint: '#d8d0ff', alpha: 0.35 };
      break;
    }
    case 'hover': {
      ang = down + 0.22 * Math.sin(pose.now * 1.6 + m.id);
      // После выпада: доворачивается остриём вниз, дрожа.
      if (m.cd > 2 && t < 0.4) {
        const k = t / 0.4;
        ang = angTo(m.dir, down);
        ang = lerp(m.dir, ang, eOut3(k)) + 0.3 * wob(k, 2.5);
        dy = -6;
      }
      break;
    }
    case 'aim': {
      // Разворот на героя с перелётом, оттяжка назад, дрожь, блик к острию.
      const d = m.dir;
      const from = angTo(d, down);
      ang = t < 0.2 ? lerp(from, d, spring(t / 0.2)) : d;
      const back = 3.5 * eIO(seg(t, 0.15, 0.55));
      dx = -Math.cos(d) * back;
      dy = -6 - Math.sin(d) * back;
      if (t > 0.55) dx += f24(t) % 2 ? 0.5 : -0.5;
      glint = seg(t, 0.3, 0.72);
      hot = t > 0.45 ? 2 : 1;
      break;
    }
    case 'stab': {
      ang = m.dir;
      const k = Math.min(1, t / 0.24);
      dx = Math.cos(m.dir) * lerp(-3.5, 1.5, eOut(Math.min(1, k * 3)));
      dy = -6 + Math.sin(m.dir) * lerp(-3.5, 1.5, eOut(Math.min(1, k * 3)));
      thr = 1;
      hot = 2;
      ghost = { every: 0.025, life: 0.2, tint: '#e8e0ff', alpha: 0.45 };
      break;
    }
    case 'gather':
      ang = down + (f24(pose.now) % 3 === 0 ? 0.13 : 0);
      hot = 2;
      break;
    case 'dying': {
      // Падает на пол плашмя, отскакивает, звенит (кончик дрожит, блик
      // бежит), рой из рукояти уходит, клинок истлевает.
      linger = 1.6;
      const flat = m.id % 2 ? 0.1 : Math.PI - 0.1;
      const start = angTo(flat, down);
      if (t < 0.22) {
        const k = t / 0.22;
        ang = lerp(start, flat, eIn(k));
        dy = lerp(-6, 4, eIn(k));
      } else if (t < 0.36) {
        ang = flat + 0.1 * Math.sin((Math.PI * (t - 0.22)) / 0.14);
        dy = 4 - 3 * Math.sin((Math.PI * (t - 0.22)) / 0.14);
      } else {
        ang = flat;
        dy = 4;
        if (t < 0.8) bend = f24(t) % 2 ? (t < 0.55 ? 2 : 1) : 0;
        if (t > 0.4 && t < 1) glint = seg(t, 0.4, 1);
      }
      hot = t < 0.5 ? 1 : 0;
      shadow = Math.round(lerp(2, 5, seg(t, 0, 0.22)));
      alphaK = 1 - seg(t, 1.1, 1.6);
      break;
    }
  }
  const n = mod(Math.round((ang / TAU) * BLADE_STEPS), BLADE_STEPS);
  const gk = glint < 0 ? -1 : Math.round(glint * 10);
  const key = `${n}|${hot}|${gk}|${bend}|${thr}|${pose.flash ? 1 : 0}`;
  let fr = BLADE_LRU.get(key);
  if (!fr) {
    const p = bladeDraw(n, hot, gk < 0 ? -1 : gk / 10, bend);
    if (thr) {
      const a = (n / BLADE_STEPS) * TAU;
      streakAt(p.lit!, 20 + Math.cos(a) * 10, 20 + Math.sin(a) * 10, a, 14);
    }
    fr = BLADE_LRU.set(key, finishPair(p, { ...pose, left: false, look: 'normal' }));
  }
  return { ...fr, still: true, shadow, dx, dy, ghost, linger, alpha: alphaK };
});

// ---------------------------------------------------------------------------
// Прогрев: первая фаза в обе стороны и обломки — пока бой не начался.
// ---------------------------------------------------------------------------

registerMobWarm('f2_armor', function* () {
  const paint = (id: string) => MOB_PAINTERS.get(id)!;
  const fake = (mode: string, t: number, left: boolean, data: Record<string, number>, v = 0) =>
    ({
      id: 0,
      kind: 'f2_armor',
      x: 0,
      y: 0,
      vx: v,
      vy: 0,
      kx: 0,
      ky: 0,
      mode,
      t,
      dir: left ? Math.PI : 0,
      face: left ? Math.PI : 0,
      flash: 0,
      cd: 0,
      data,
    }) as unknown as Mob;
  const pose = (
    mode: string,
    t: number,
    left: boolean,
    anim: MobPose['anim'] = 'idle',
  ): MobPose => ({
    anim,
    frame: 0,
    mode,
    t,
    left,
    flash: false,
    look: 'normal',
    now: t,
  });
  const arm = paint('f2_armor');
  for (const left of [false, true]) {
    for (let i = 0; i < 12; i++) {
      arm(fake('chase', 0, left, {}), { ...pose('chase', 0, left, 'idle'), now: i / 8 + 0.01 });
      yield;
    }
    for (let i = 0; i < 8; i++) {
      arm(fake('chase', 0, left, {}, 2), { ...pose('chase', 0, left, 'run'), now: i / 11 + 0.01 });
      yield;
    }
    const run = (mode: string, dur: number, data: Record<string, number>) => {
      const list: [Mob, MobPose][] = [];
      for (let t = 0; t < dur; t += 1 / 24)
        list.push([fake(mode, t + 0.001, left, data), pose(mode, t + 0.001, left)]);
      return list;
    };
    for (const [m, p] of [
      ...run('roar', 1.2, {}),
      ...run('swing', 0.84, { warn: 0.72 }),
      ...run('recover', 0.6, {}),
      ...run('thrustAim', 0.72, {}),
      ...run('lunge', 0.2, {}),
      ...run('recover', 0.85, { rec: 0.85 }),
      ...run('dizzy', 1.3, {}),
    ]) {
      arm(m, p);
      yield;
    }
  }
  for (let part = 0; part < 5; part++)
    for (let n = 0; n < PLATE_STEPS; n++) {
      plateSprite(part, (n / PLATE_STEPS) * TAU);
      yield;
    }
  // Сборка бывает только после разбития — латы уже в трещинах.
  for (let i = 0; i <= 23; i++) {
    rebBase(i, true);
    yield;
  }
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
