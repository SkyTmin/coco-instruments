// Этаж 9 — каменный змей (анимации мобов 9). Серо-зелёная каменная чешуя
// с трещинами и мхом, капюшон с «глазами», голова поднята над кольцами.
//
// Длинное тело: голова ведёт, кольца идут за ней с запаздыванием. Курс
// хвоста догоняет курс головы по пройденному пути (как вагоны за
// паровозом): на повороте тело изогнуто, выпрямляется, когда змей
// проползёт свою длину; стоит — так и лежит изогнутым. Изгиб — пять
// ступеней в ключе кадра. По телу бежит волна от головы к хвосту (фаза —
// по пути). Взгляд: голова поднимается, капюшон раскрывается, глаза
// наливаются бирюзой и добела к мигу окаменения. Укус: голова оттянута
// S-образно, бросок вниз-вперёд в кадр урона. Смерть: каменеет, по телу
// бегут трещины, рассыпается щебнем.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig } from './f15-rig';
import type { Mat } from './f15-rig';
import {
  INK,
  NDIR,
  PI,
  TAU,
  angD,
  camSide,
  clamp,
  clamp01,
  dirN,
  drawRig,
  easeIn3,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFields,
  hx,
  kindOf,
  lerp,
  mixc,
  mod,
  moving,
  out,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  warmAll,
  yawN,
} from './f9-mobkit';
import type { Pic, RGBA } from './f9-mobkit';

// ---- Палитра (прежняя) ----

const BODY = tn('#232a26', '#46524a', '#6e7c70', '#9eac9c');
const BELLY = tn('#4a4632', '#7c7656', '#a8a07a', '#cec6a0');
const HOOD = tn('#1c2420', '#3a4a40', '#5e7064', '#8a9c8a');
const STONE = tn('#2e2e2e', '#555552', '#807e78', '#aaa8a0');
const MOSS = hx('#4a6a2a');
const CRACK = hx('#1a201c');
const EYE = hx('#6affe0');
const EYE_HOT = hx('#e8fff8');
const TONGUE = hx('#c83a4a');
const MOUTH = tn('#1a0a0a', '#3a1414', '#5a2020', '#7a3030');

/** Каменная чешуя: швы-трещины и пятна мха — по номеру кольца, не кипят. */
function scaleMat(T: typeof BODY, seed: number, stone: number): Mat {
  return {
    T: stone > 0 ? (T.map((c, i) => mixc(c, STONE[i], stone)) as typeof BODY) : T,
    pat: (q, l) => {
      const a = Math.floor(q[0] * 3 + seed * 1.7);
      const b = Math.floor(Math.atan2(q[2], q[1]) * 2.2 + 9);
      const h = hash(a, b, seed);
      if (h > 0.9 - stone * 0.25) return CRACK;
      if (stone < 0.5 && l > 0.55 && h < 0.1) return MOSS;
      return null;
    },
  };
}
const HOOD_M: Mat = {
  T: HOOD,
  // На спинке капюшона — два светлых «глаза».
  pat: (q) => {
    if (q[0] > -0.3) return null;
    const d = Math.hypot(Math.abs(q[1]) - 0.45, q[2] - 0.15);
    return d < 0.2 ? hx('#cec6a0') : d < 0.3 ? INK : null;
  },
};

interface SerpO {
  /** Волна по телу: фаза и размах; изгиб тела (рад к хвосту). */
  wave: number;
  waveA: number;
  bend: number;
  /** Кольца поджаты (0…1) — тело короче, волна круче. */
  coil: number;
  /** Голова: вынос вперёд, высота, наклон (+ вниз), капюшон, пасть, язык. */
  hx: number;
  hz: number;
  hp: number;
  hood: number;
  jaw: number;
  tongue: number;
  eye: number;
  shut: number;
  /** Камень 0…1, разлёт щебня 0…1. */
  stone: number;
  crumble: number;
  /** Голова на полу (смерть, ушиб). */
  fall: number;
}

const S0: SerpO = {
  wave: 0,
  waveA: 0.35,
  bend: 0,
  coil: 0,
  hx: 2.4,
  hz: 8.5,
  hp: 0.15,
  hood: 0.3,
  jaw: 0,
  tongue: 0,
  eye: 0.5,
  shut: 0,
  stone: 0,
  crumble: 0,
  fall: 0,
};

const NSEG = 9;

function serpRig(o: SerpO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const step = 2.2 * (1 - 0.3 * o.coil);
  // Хребет на полу: от основания шеи назад; курс каждого кольца — изгиб
  // (растёт к хвосту) плюс бегущая волна.
  const base = 4.5;
  let x = base;
  let y = 0;
  const pts: [number, number][] = [[x, y]];
  for (let i = 1; i <= NSEG; i++) {
    const k = i / NSEG;
    const hd =
      PI + o.bend * k + (o.waveA + o.coil * 0.5) * Math.sin(o.wave - i * 0.8) * (0.5 + 0.7 * k);
    x += Math.cos(hd) * step;
    y += Math.sin(hd) * step;
    pts.push([x, y]);
  }
  const rad = (i: number) => lerp(2.5, 0.55, (i / NSEG) ** 1.15);
  for (let i = 0; i < NSEG; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const ra = rad(i);
    const rb = rad(i + 1);
    r.cap(B.p(ax, ay, ra * 0.8), B.p(bx, by, rb * 0.8), ra, rb, scaleMat(BODY, i + 1, o.stone));
  }
  // Шея поднимается от основания к голове (две капсулы, светлое брюхо спереди).
  const fall = o.fall;
  const hz = lerp(o.hz, 1.6, fall);
  const hxp = base + lerp(o.hx, 4.0, fall);
  const N0 = B.p(base, 0, 2.0);
  const N1 = B.p(base + (hxp - base) * 0.35 - 0.6, 0, lerp(2.0, hz, 0.55));
  const HP = B.p(hxp, 0, hz);
  const neck = scaleMat(BODY, 0, o.stone);
  r.cap(N0, N1, 2.4, 2.0, neck);
  r.cap(N1, HP, 2.0, 1.6, neck);
  r.cap(B.p(base + 0.9, 0, 2.6), vadd(HP, B.v(0.5, 0, -1.1)), 1.0, 0.9, { T: BELLY });
  // Капюшон: плоский веер за головой, раскрывается во взгляде.
  const Hd = F3.yaw(yaw, vadd(HP, B.v(-0.9, 0, -1.4)));
  r.ell(Hd, [0, 0, 0], [1.1, 1.4 + o.hood * 2.0, 2.0 + o.hood * 1.1], stoneHood(o.stone));
  // Голова.
  const H = F3.yaw(yaw, HP).pitch(o.hp);
  r.ell(H, [0.6, 0, 0], [2.3, 1.7, 1.2], scaleMat(BODY, 11, o.stone));
  if (o.jaw > 0.12) {
    const J = H.at(-0.2, 0, -0.6).pitch(o.jaw * 0.9);
    r.ell(H, [1.6, 0, -0.7], [1.3, 1.2, 0.2 + o.jaw * 0.5], { T: MOUTH, soft: true });
    r.ell(J, [1.4, 0, -0.2], [1.8, 1.4, 0.55], { T: BELLY });
    for (const sd of [-1, 1]) r.dot(H.p(2.4, sd * 0.6, -0.5), hx('#f0e6c8'), 0, 1, 0.9);
  }
  if (o.tongue > 0.05) {
    const a = H.p(2.8, 0, -0.5);
    const b = H.p(2.8 + o.tongue * 2.4, 0, -0.6);
    r.line(a, b, TONGUE, 0, 0.6);
    for (const sd of [-1, 1]) r.line(b, H.p(3.4 + o.tongue * 2.4, sd * 0.7, -0.7), TONGUE, 0, 0.6);
  }
  const ec: RGBA = o.eye > 0.8 ? EYE_HOT : EYE;
  for (const sd of [-1, 1]) {
    const E = H.p(1.3, sd * 1.15, 0.5);
    if (o.shut > 0.5 || o.stone > 0.6) r.dot(E, CRACK, 0, 1, 1.2);
    else r.dot(E, ec, clamp01(0.4 + o.eye * 0.6), 1, 1.2);
  }
  r.eye = o.shut > 0.5 || o.stone > 0.6 ? null : H.p(1.3, cs * 1.15, 0.5);
  if (o.crumble > 0) r.explode(o.crumble, B.p(-4, 0, 3), 9, 7, 22, 0, 0.45);
  return r;
}

function stoneHood(stone: number): Mat {
  if (stone <= 0) return HOOD_M;
  return { ...HOOD_M, T: HOOD.map((c, i) => mixc(c, STONE[i], stone)) as typeof HOOD };
}

// ---- Позы ----

function serpPose(anim: string, f: number, bend: number): SerpO {
  const o: SerpO = { ...S0, bend };
  const t = f / 24;
  switch (anim) {
    case 'crawl': {
      // 8 кадров на волну (по пути): голова покачивается навстречу волне.
      const a = (f / 8) * TAU;
      o.wave = a;
      o.waveA = 0.45;
      o.hz = 8.0 + 0.3 * Math.sin(a);
      o.hp = 0.2;
      break;
    }
    case 'idle': {
      // 8 кадров по 5 к/с: голова качается, язык пробует воздух.
      const a = (f / 8) * TAU;
      o.wave = a * 0.25;
      o.waveA = 0.3;
      o.hz = 8.6 + 0.35 * Math.sin(a);
      o.hx = 2.4 + 0.3 * Math.sin(a + 1);
      o.hp = 0.1 + 0.05 * Math.sin(a);
      o.tongue = f === 5 ? 1 : f === 6 ? 0.6 : 0;
      o.shut = f === 1 ? 1 : 0;
      break;
    }
    case 'gaze': {
      // Взгляд 0,9 с (22 кадра): голова выше, капюшон шире, глаза
      // наливаются; с 0,45 застыл, дрожь напряжения; добела к 0,9.
      o.hz = trk(t, [
        [0, 8.5],
        [0.3, 11.2, easeOut],
        [0.9, 11.6],
      ]);
      o.hx = trk(t, [
        [0, 2.4],
        [0.3, 1.4],
        [0.85, 1.2],
        [0.9, 2.0],
      ]);
      o.hp = trk(t, [
        [0, 0.15],
        [0.3, -0.1],
        [0.85, 0.05],
      ]);
      o.hood = trk(t, [
        [0, 0.3],
        [0.35, 1, easeOut],
      ]);
      o.eye = trk(t, [
        [0, 0.5],
        [0.45, 0.7],
        [0.82, 0.78],
        [0.88, 1],
      ]);
      o.coil = trk(t, [
        [0, 0],
        [0.4, 0.5],
      ]);
      o.wave = 1.2;
      o.waveA = 0.2;
      o.jaw = trk(t, [
        [0.6, 0],
        [0.88, 0.35],
      ]);
      break;
    }
    case 'gazef': {
      // После взгляда 0,7 с: голову откинуло, капюшон складывается, глаза гаснут.
      o.hz = trk(t, [
        [0, 11.6],
        [0.1, 12.0],
        [0.5, 8.5],
      ]);
      o.hx = trk(t, [
        [0, 2.0],
        [0.1, 0.6, easeOut],
        [0.5, 2.4],
      ]);
      o.hp = trk(t, [
        [0, 0.05],
        [0.1, -0.35],
        [0.5, 0.15],
      ]);
      o.hood = trk(t, [
        [0.1, 1],
        [0.5, 0.3],
      ]);
      o.eye = trk(t, [
        [0, 1],
        [0.08, 0.8],
        [0.4, 0.5],
      ]);
      o.coil = trk(t, [
        [0, 0.5],
        [0.6, 0],
      ]);
      o.wave = 1.2 + t * 4;
      o.waveA = 0.25;
      o.jaw = trk(t, [
        [0, 0.35],
        [0.15, 0],
      ]);
      break;
    }
    case 'bite': {
      // Укус, windup 0,5 (12 кадров): голова оттянута назад-вверх, кольца
      // поджаты (до 0,3), задержка, бросок вперёд-вниз — кадр урона 11-й.
      const k = clamp01((f + 1) / 12);
      o.hx = trk(k, [
        [0, 2.4],
        [0.6, -0.6, easeOut],
        [0.86, -0.9],
        [1, 6.0, easeIn3],
      ]);
      o.hz = trk(k, [
        [0, 8.5],
        [0.6, 10.6],
        [0.86, 10.8],
        [1, 4.0, easeIn3],
      ]);
      o.hp = trk(k, [
        [0, 0.15],
        [0.6, -0.25],
        [1, 0.55, easeIn3],
      ]);
      o.coil = trk(k, [
        [0, 0],
        [0.6, 1],
        [1, 0.3],
      ]);
      o.jaw = trk(k, [
        [0.4, 0],
        [0.6, 0.6],
        [0.86, 0.5],
        [1, 1],
      ]);
      o.hood = trk(k, [
        [0, 0.3],
        [0.6, 0.8],
      ]);
      o.eye = 0.7;
      o.wave = k * 2;
      break;
    }
    case 'bitef': {
      // После укуса 0,7 с: голова у пола, отдёрнул, поднялся.
      o.hx = trk(t, [
        [0, 6.0],
        [0.05, 6.4],
        [0.35, 1.8],
        [0.6, 2.4],
      ]);
      o.hz = trk(t, [
        [0, 4.0],
        [0.08, 3.6],
        [0.45, 8.8],
        [0.6, 8.5],
      ]);
      o.hp = trk(t, [
        [0, 0.55],
        [0.4, 0.1],
      ]);
      o.coil = trk(t, [
        [0, 0.3],
        [0.5, 0],
      ]);
      o.jaw = trk(t, [
        [0, 1],
        [0.2, 0],
      ]);
      o.hood = trk(t, [
        [0.1, 0.8],
        [0.5, 0.3],
      ]);
      o.wave = 2 + t * 6;
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.hx = 2.4 - 2.0 * b;
      o.hz = 8.5 - 1.5 * b;
      o.hp = 0.15 - 0.5 * b;
      o.shut = b > 0.3 ? 1 : 0;
      o.jaw = 0.6 * b;
      o.hood = 0.3 + 0.5 * b;
      o.coil = 0.4 * b;
      o.wave = f * 0.8;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: дёрнулся и упал головой (до 0,3), каменеет (до 0,55),
      // трещины — рассыпался щебнем (с 0,6).
      o.fall = trk(t, [
        [0.06, 0],
        [0.3, 1, easeIn3],
      ]);
      o.hp = trk(t, [
        [0, 0.15],
        [0.08, -0.5],
        [0.3, 0.3],
      ]);
      o.jaw = trk(t, [
        [0, 0.5],
        [0.1, 1],
        [0.4, 0.4],
      ]);
      o.shut = t > 0.3 ? 1 : 0;
      o.wave = t * 14;
      o.waveA = trk(t, [
        [0, 0.6],
        [0.35, 0.15],
      ]);
      o.coil = trk(t, [
        [0, 0],
        [0.15, 0.7],
        [0.4, 0.2],
      ]);
      o.stone = trk(t, [
        [0.25, 0],
        [0.55, 1],
      ]);
      o.crumble = trk(t, [
        [0.6, 0],
        [0.87, 1, easeOut],
      ]);
      o.hood = 0.6;
      break;
    }
  }
  return o;
}

// ---- Кадры ----

const SERP = kindOf('f9_serpent', 64, 52, 32, 34, 1800, 1.12);
const BEND_STEP = 0.42;
const serpPic = (anim: string, f: number, d: number, b = 0): Pic =>
  drawRig(SERP, serpRig(serpPose(anim, f, b * BEND_STEP), yawN(d)));

/** Курс хвоста по мобу: догоняет курс головы по пройденному пути. */
interface Tail {
  y: number;
  dist: number;
  now: number;
}
const TAILS = new Map<number, Tail>();
const BODY_LEN = 1.3;

registerMobPainter('f9_serpent', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const tech = md === 'gaze' || md === 'windup' || md === 'recover';
  const v = visOf(m, pose, tech || !moving(m, 0.3) ? (m.face ?? 0) : headOf(m, 0.3), 6);
  let tl = TAILS.get(id);
  if (!tl || now < tl.now || now - tl.now > 1.5) {
    tl = { y: v.yaw, dist: v.dist, now };
    if (TAILS.size > 200) TAILS.clear();
    TAILS.set(id, tl);
  }
  const moved = Math.max(0, v.dist - tl.dist);
  tl.y += angD(v.yaw, tl.y) * clamp01(moved / BODY_LEN);
  tl.dist = v.dist;
  tl.now = now;
  // Изгиб: насколько курс хвоста отстаёт от головы (в осях экрана рига).
  const d = dirN(v.yaw);
  const bendRaw = -angD((d / NDIR) * TAU, tl.y);
  const bl = clamp(Math.round(bendRaw / BEND_STEP), -2, 2);

  const ex: Partial<MobFrame> = { shadow: 7, still: true };
  let anim = 'idle';
  let f = 0;
  let b = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.75, 0.9, t);
  } else if (md === 'gaze') {
    anim = 'gaze';
    f = fi(t, 21);
    if (t > 0.5 && t < 0.86) ex.dx = Math.floor(t * 40) % 2 ? 0.3 : -0.3;
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 11);
  } else if (md === 'recover') {
    anim = v.prev === 'gaze' ? 'gazef' : 'bitef';
    f = fi(t, 16);
  } else if (md === 'stun' || hurtAge(v, now) >= 0) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
  } else if (moving(m, 0.3)) {
    anim = 'crawl';
    f = mod((v.dist / 1.1) * 8, 8);
    b = bl;
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 5) * 5) * 5, 8);
    b = bl;
  }
  if (md !== 'dying') hurtFields(v, now, ex, 0.6);
  const key = b ? `${anim}~${b}` : anim;
  return out(
    frameOf(SERP, key, f, d, pose.look, () => serpPic(anim, f, d, b)),
    ex,
    pose.flash,
  );
});

export const SERP_WARM: [string, number][] = [
  ['crawl', 8],
  ['idle', 8],
  ['gaze', 22],
  ['gazef', 17],
  ['bite', 12],
  ['bitef', 17],
  ['flinch', 5],
  ['die', 21],
];
registerMobWarm('f9_serpent', function* () {
  yield* warmAll(SERP, SERP_WARM, (a, f, d) => serpPic(a, f, d));
  // Изогнутые кольца в ходу и покое — все ступени изгиба.
  for (const b of [-2, -1, 1, 2])
    for (const a of ['crawl', 'idle'])
      for (let d = 0; d < NDIR; d++)
        for (let f = 0; f < 8; f++) {
          frameOf(SERP, `${a}~${b}`, f, d, 'normal', () => serpPic(a, f, d, b));
          yield 0;
        }
});
