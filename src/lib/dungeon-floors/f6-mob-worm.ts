// Этаж 6 — Магмовый червь (анимации мобов 6). Живёт в омуте: кольца корки,
// между ними светится лава, пасть — венец клыков, по бокам глазки-угли.
// Мини-3D (риг 15-го, ×1,3), 8 сторон честно. Поверхность лавы — земля
// кадра: невидимая плоскость срезает всё, что ниже (нырок, плаванье).
//
// Под лавой — только гребень спины волной и круги, за ним — след. Всплытие
// 0,45: лава вспучивается, голова пробивает поверхность, брызги. Плевок
// 0,8 с: откидывается, по шее вверх катится ком лавы, горло светится —
// выброс вперёд ровно в 0,8, отдача (второй плевок — так же). Висит: качается,
// пасть дышит, смотрит на героя. Укус 0,7: сжимается пружиной — бросок
// вперёд-вниз ровно в 0,7, проводка назад. Погружение 0,4: уходит спиной,
// круги. Смерть 0,9 с: корчится, кольца трескаются, лава хлещет, оседает в
// омут, пузыри.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { WORM } from './f6-brains';
import { F3, Rig } from './f15-rig';
import type { Mat, RigOut, V3 } from './f15-rig';
import {
  alpha,
  CLIP,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  FIRE,
  fi,
  FPS,
  frameOf,
  hash,
  hurtFx,
  hx,
  kf,
  kindOf,
  litOn,
  mod,
  PI,
  sstep,
  TAU,
  tn,
  trk,
  visOf,
  warmAll,
  yawN,
} from './f6-mobkit';
import type { Pic, Proj2 } from './f6-mobkit';

const CRUST = tn('#1a1010', '#3a2622', '#5e4238', '#86604c');
const LAVA_T = tn('#7a1c06', '#d8400e', '#ff8a1e', '#ffd24a');
const FANG = tn('#6a5a48', '#a89478', '#e0d0b0', '#fff4dc');
const MAW = tn('#5a0c04', '#a8200a', '#ff6a1a', '#ffe070');
const EYE = hx('#ffd040');
const LAVA_HI = hx('#ffc440');
const LAVA_MID = hx('#ff8a1e');
const LAVA_DK = hx('#a8240a');
const SC = 1.3;
const N = 7;

interface WormO {
  /** Подъём 0…1 (0 — под лавой), высота головы, вынос головы вперёд. */
  rise: number;
  h: number;
  reach: number;
  /** Изгиб шеи назад (+), качание вбок, наклон головы (+ вниз). */
  back: number;
  sway: number;
  hp: number;
  /** Пасть 0…1, ком лавы по шее 0…1 (−1 — нет), горло светится. */
  open: number;
  gulp: number;
  glow: number;
  /** Под лавой: фаза волны; брызги 0…1; круги 0…1; трещины 0…1; темнеет. */
  wave: number;
  splash: number;
  ripple: number;
  crack: number;
  dark: number;
  /** Плевок: вспышка у пасти 0…1. */
  spit: number;
  under: boolean;
}

const O0 = (): WormO => ({
  rise: 1,
  h: 13,
  reach: 1.5,
  back: 0,
  sway: 0,
  hp: -0.15,
  open: 0.15,
  gulp: -1,
  glow: 0.4,
  wave: 0,
  splash: 0,
  ripple: 0.3,
  crack: 0,
  dark: 0,
  spit: 0,
  under: false,
});

/** Позвоночник (локально f, s, u) и радиусы колец. */
function spine(o: WormO): [V3[], number[]] {
  const pts: V3[] = [];
  const rr: number[] = [];
  if (o.under) {
    // Под лавой: тело вдоль хода, гребни волной чуть над поверхностью.
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const f = 4 - s * 11;
      const u = -1.2 + 1.1 * Math.sin(o.wave * TAU - s * PI * 2.2);
      pts.push([f, Math.sin(o.wave * TAU + s * 3) * 0.6, u]);
      rr.push(2.3 - s * 0.6);
    }
    return [pts, rr];
  }
  const H = o.h * o.rise;
  const base: V3 = [-o.back * 0.8 - 1, 0, -4];
  const mid: V3 = [-o.back * 2.2 - 1.6, o.sway, H * 0.6];
  const top: V3 = [o.reach + 1.5, o.sway * 0.6, H - 3 * (1 - o.rise)];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const a = (1 - s) * (1 - s);
    const b = 2 * s * (1 - s);
    const c = s * s;
    pts.push([
      a * base[0] + b * mid[0] + c * top[0],
      a * base[1] + b * mid[1] + c * top[1] + Math.sin(o.wave * TAU + s * 4) * 0.4 * s,
      a * base[2] + b * mid[2] + c * top[2],
    ]);
    rr.push(2.8 - s * 0.9);
  }
  return [pts, rr];
}

function wormRig(o: WormO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw).scale(SC);
  const dk = o.dark;
  const crustM: Mat = {
    T: CRUST,
    bias: -dk * 0.5,
    pat: (q) =>
      o.crack > 0 && Math.abs(Math.sin(q[0] * 6 + q[2] * 5)) < 0.12 * o.crack ? FIRE[3] : null,
    gpat:
      o.crack > 0
        ? (q) => (Math.abs(Math.sin(q[0] * 6 + q[2] * 5)) < 0.12 * o.crack ? 1 : 0)
        : undefined,
  };
  const lavaM: Mat = { T: LAVA_T, glow: (0.5 + o.glow * 0.4) * (1 - dk), bias: 0.15 - dk };
  const [pts, rr] = spine(o);
  const P = (v: V3) => B.p(v[0], v[1], v[2]);
  // Кольца: корка и лава между ними; гребни на спине.
  for (let i = 0; i < N; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    r.ball(P(m), rr[i] * 0.86 * SC, lavaM);
    r.ball(P(a), rr[i] * SC, crustM);
    const back: V3 = o.under ? [0, 0, 1] : [-1, 0, 0.3];
    r.spike(P(a), B.v(back[0], back[1], back[2]), 1.3 * SC, 0.5 * SC, crustM, 3);
  }
  // Ком лавы катится по шее (плевок).
  if (o.gulp >= 0) {
    const s = o.gulp * N;
    const i = Math.min(N - 1, Math.floor(s));
    const k = s - i;
    const a = pts[i];
    const b = pts[i + 1];
    const c: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    r.ball(P(c), (rr[i] + 0.45) * SC, { T: LAVA_T, glow: 0.9, bias: 0.3 });
  }
  // Голова.
  const hd = pts[N];
  const Hf = B.at(hd[0], hd[1], hd[2]).pitch(o.hp);
  r.ell(Hf, [0, 0, 0], [2.8, 3.0, 2.7], crustM);
  const op = clamp01(o.open);
  // Пасть: светящийся зев и венец клыков.
  r.ell(Hf, [2.3, 0, 0], [0.6, 0.8 + op * 1.3, 0.8 + op * 1.3], {
    T: MAW,
    glow: (0.4 + op * 0.5 + o.glow * 0.3) * (1 - dk),
    bias: 0.2 * op,
  });
  for (let j = 0; j < 6; j++) {
    const an = (j / 6) * TAU + 0.26;
    const R = 1.5 + op * 0.7;
    const ca = Math.cos(an);
    const sa = Math.sin(an);
    r.spike(
      Hf.p(2.2, ca * R, sa * R),
      Hf.v(1, -ca * 0.7 * (1 - op) + ca * 0.3 * op, -sa * 0.7 * (1 - op) + sa * 0.3 * op),
      1.4 * SC,
      0.42 * SC,
      { T: FANG, bias: -dk * 0.5 },
      3,
    );
  }
  for (const sd of [-1, 1]) r.dot(Hf.p(1.5, sd * 2.3, 1.2), EYE, 0.9 * (1 - dk), 1, 2.2);
  r.eye = Hf.p(1.5, (Math.cos(yaw) >= 0 ? 1 : -1) * 2.3, 1.2);
  // Поверхность лавы.
  r.poly(
    [
      [-40, -40, 0],
      [40, -40, 0],
      [40, 40, 0],
      [-40, 40, 0],
    ],
    { T: CLIP, flat: 0, soft: true },
  );
  return r;
}

function wormPose(anim: string, f: number): WormO {
  const o = O0();
  switch (anim) {
    case 'under': {
      o.under = true;
      o.wave = f / 8;
      o.ripple = 1;
      o.glow = 0.2;
      break;
    }
    case 'surface': {
      // 0,45 с (11 кадров): лава вспучивается, голова пробивает, брызги.
      const k = kf(f, 0.45);
      o.rise = trk(k, [
        [0, 0],
        [0.2, 0.05],
        [0.75, 1.1, easeOut],
        [1, 1],
      ]);
      o.splash = k < 0.2 ? -1 + k / 0.2 : k;
      o.open = sstep(0.5, 0.9, k) * 0.6;
      o.hp = -0.5 * (1 - k);
      o.ripple = 1;
      o.wave = k;
      break;
    }
    case 'aim': {
      // 0,8 с (20 кадров): откинулся, ком лавы по шее, горло светится —
      // выброс вперёд в 0,8.
      const k = kf(f, WORM.aim);
      o.back = trk(k, [
        [0, 0],
        [0.55, 1.6, easeOut],
        [0.88, 1.8],
        [1, -0.6, easeIn],
      ]);
      o.hp = trk(k, [
        [0, -0.15],
        [0.55, -0.55, easeOut],
        [0.88, -0.6],
        [1, 0.15, easeIn],
      ]);
      o.reach = 1.5 - o.back;
      o.gulp = k < 0.15 ? -1 : (k - 0.15) / 0.8;
      if (o.gulp > 1) o.gulp = -1;
      o.glow = 0.4 + 0.6 * sstep(0.3, 0.9, k);
      o.open = 0.15 + 0.5 * sstep(0.6, 0.95, k);
      o.h = 13 + 0.8 * sstep(0, 0.55, k);
      o.wave = k * 0.5;
      break;
    }
    case 'spit': {
      // Отдача плевка (5 кадров): пасть настежь, вспышка, назад.
      const k = f / 4;
      o.back = -0.6 + 0.6 * easeOut(k);
      o.reach = 2.1 - 0.6 * k;
      o.hp = 0.15 - 0.3 * k;
      o.open = 1 - 0.6 * k;
      o.spit = 1 - k;
      o.glow = 1 - 0.5 * k;
      break;
    }
    case 'linger': {
      // 12 кадров по 8 к/с: качается, пасть дышит.
      const a = (f / 12) * TAU;
      o.sway = Math.sin(a) * 1.2;
      o.back = 0.3 * Math.sin(a * 2);
      o.open = 0.3 + 0.3 * Math.max(0, Math.sin(a * 2 + 1));
      o.glow = 0.35 + 0.15 * Math.sin(a);
      o.wave = f / 12;
      o.h = 13 + 0.4 * Math.sin(a * 2);
      break;
    }
    case 'bite': {
      // Замах 0,7 с (17 кадров): пружина назад (до 0,7), дрожь, бросок
      // вперёд-вниз (до 1).
      const k = kf(f, 0.7);
      o.back = trk(k, [
        [0, 0],
        [0.7, 2.2, easeOut],
        [0.85, 2.3],
        [1, -2.5, easeIn],
      ]);
      o.reach = trk(k, [
        [0, 1.5],
        [0.7, -0.6, easeOut],
        [0.85, -0.7],
        [1, 6.5, easeIn],
      ]);
      o.h = trk(k, [
        [0, 13],
        [0.7, 14.5, easeOut],
        [0.85, 14.6],
        [1, 6.5, easeIn],
      ]);
      o.hp = trk(k, [
        [0, -0.15],
        [0.7, -0.5],
        [0.85, -0.5],
        [1, 0.7, easeIn],
      ]);
      o.open = sstep(0.2, 0.7, k) * (k > 0.97 ? 0.3 : 1);
      o.glow = 0.4 + 0.5 * sstep(0.3, 0.8, k);
      if (k > 0.7 && k < 0.85) o.sway = f % 2 ? 0.4 : -0.4;
      break;
    }
    case 'bitef': {
      // Проводка 0,5 с (12 кадров): сомкнул, тянет назад, выпрямился.
      const k = kf(f, 0.5);
      const e = easeOut(Math.min(1, k / 0.7));
      o.back = -2.5 + 2.5 * e;
      o.reach = 6.5 - 5 * e;
      o.h = 6.5 + 6.5 * e;
      o.hp = 0.7 - 0.85 * e;
      o.open = f < 2 ? 0 : 0.2 * e;
      break;
    }
    case 'sink': {
      // 0,4 с (10 кадров): уходит спиной, круги.
      const k = kf(f, 0.4);
      o.rise = 1 - easeIn(k);
      o.back = 0.8 * k;
      o.hp = 0.3 * k;
      o.open = 0.1;
      o.ripple = 1;
      o.splash = k > 0.6 ? (k - 0.6) / 0.4 : 0;
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.25)) * (1 - (f / 4) * 0.5);
      o.back = 1.2 * b;
      o.hp = -0.4 * b;
      o.open = 0.6 * b;
      o.sway = 0.8 * b;
      break;
    }
    case 'die': {
      // 0,9 с (22 кадра): корчится, трещины, лава хлещет; оседает.
      const t = f / FPS;
      o.sway = Math.sin(f * 1.7) * 2 * (1 - sstep(0.3, 0.6, t));
      o.back = Math.sin(f * 1.1) * 1.2 * (1 - sstep(0.3, 0.6, t));
      o.crack = sstep(0, 0.3, t);
      o.open = 1 - sstep(0.4, 0.7, t) * 0.7;
      o.hp = -0.4 + 1.0 * sstep(0.25, 0.7, t);
      o.rise = 1 - easeIn(sstep(0.3, 0.8, t));
      o.glow = 1;
      o.dark = sstep(0.5, 0.9, t);
      o.ripple = 1;
      o.splash = sstep(0.55, 0.9, t);
      break;
    }
  }
  return o;
}

const WK = kindOf('f6_worm', 48, 56, 24, 42, 1300);

function wormPic(anim: string, f: number, d: number): Pic {
  const o = wormPose(anim, f);
  const yaw = yawN(d);
  return draw(WK, wormRig(o, yaw), (out, P) => post(out, P, o, yaw, f));
}

function post(out: RigOut, P: Proj2, o: WormO, yaw: number, f: number): void {
  const B = F3.yaw(yaw).scale(SC);
  const lit = litOn(out);
  const put = (x: number, y: number, c: [number, number, number, number], l = false) => {
    out.p.set(Math.round(x), Math.round(y), c);
    if (l) lit.set(Math.round(x), Math.round(y), c);
  };
  // Круги по лаве вокруг шеи (под лавой — у гребня и след позади).
  if (o.ripple > 0) {
    const [cx, cy] = P(B.p(o.under ? 1 : -1 - o.back * 0.8, 0, 0));
    const k = 1 + mod(f, 4) * 0.12;
    const R = (o.under ? 4 : 3.4 * Math.max(0.4, o.rise)) * k * SC;
    for (let a = 0; a < TAU; a += 0.09) {
      const front = Math.sin(a) > 0;
      const x = cx + Math.cos(a) * R;
      const y = cy + Math.sin(a) * R * 0.42;
      if (!front && out.p.solid(Math.round(x), Math.round(y))) continue;
      put(x, y, alpha(front ? LAVA_HI : LAVA_MID, 0.85 * o.ripple), front);
      if (front) put(x, y + 1, alpha(LAVA_DK, 0.7 * o.ripple));
    }
    if (o.under)
      for (let i = 1; i <= 3; i++) {
        // След: «усы» позади гребня.
        for (const sd of [-1, 1]) {
          const [x, y] = P(B.p(-6 - i * 2, sd * (1.5 + i * 1.1), 0));
          put(x, y, alpha(LAVA_HI, 0.7 - i * 0.15));
        }
      }
  }
  // Вспучивание и брызги (всплытие, погружение, смерть).
  if (o.splash < 0) {
    const k = o.splash + 1;
    const [cx, cy] = P([0, 0, 0]);
    const h = 1 + k * 3;
    for (let y = 0; y <= h; y++) {
      const w = Math.round(Math.sqrt(1 - (y / (h + 0.5)) ** 2) * (3 + k * 3));
      for (let x = -w; x <= w; x++)
        put(cx + x, cy - y, Math.abs(x) === w ? LAVA_MID : LAVA_HI, true);
    }
  } else if (o.splash > 0) {
    const [cx, cy] = P([0, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const side = hash(i, 19) < 0.5 ? -1 : 1;
      const v = 0.6 + hash(i, 17) * 0.8;
      const tt = o.splash * 1.4;
      const x = cx + side * (2 + tt * 8 * v);
      const y = cy - 1 - tt * 12 * v + tt * tt * 10;
      if (y < cy) put(x, y, i % 2 ? LAVA_HI : FIRE[3], true);
    }
  }
  // Плевок: ком у пасти и капли вперёд.
  if (o.spit > 0) {
    const [hx0, hy0] = P(B.p(o.reach + 4 + (1 - o.spit) * 4, 0, o.h - 0.5));
    out.p.ell(hx0, hy0, 2 * o.spit + 0.8, 1.6 * o.spit + 0.8, FIRE[3]);
    lit.ell(hx0, hy0, 2 * o.spit + 0.8, 1.6 * o.spit + 0.8, FIRE[3]);
    for (let i = 0; i < 3; i++)
      put(hx0 + (hash(i, f) - 0.5) * 6, hy0 + (hash(i, f, 2) - 0.5) * 4, FIRE[4], true);
  }
}

registerMobPainter('f6_worm', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const under = md === 'f6_under' || md === 'chase';
  const sp = Math.hypot(m.vx ?? 0, m.vy ?? 0);
  const want = under && sp > 0.3 ? Math.atan2(m.vy ?? 0, m.vx ?? 0) : (m.face ?? 0);
  const v = visOf(m, pose, want, under ? 5 : 8);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { lift: 0, still: true, shadow: 0 };
  // Плевок: конец прицела (смена режима или повтор прицела с t назад).
  const lastT = v.n.aimT ?? -1;
  if (md === 'aim' && lastT > t + 0.2) v.n.spat = now;
  v.n.aimT = md === 'aim' ? t : -1;
  if (md === 'f6_linger' && v.prev === 'aim' && (v.n.spat ?? -9) < v.modeAt - 0.05)
    v.n.spat = v.modeAt;
  const spa = now - (v.n.spat ?? -9);
  let anim = 'linger';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 21);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.8, 0.9, t);
  } else if (under) {
    anim = 'under';
    f = mod(Math.floor((now + hash(id, 3)) * 10), 8);
  } else if (md === 'f6_surface') {
    anim = 'surface';
    f = fi(t, 10);
  } else if (spa >= 0 && spa < 0.2 && md !== 'windup') {
    anim = 'spit';
    f = Math.min(4, Math.floor(spa * FPS));
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 19);
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 16);
  } else if (md === 'recover' && v.prev === 'windup') {
    anim = 'bitef';
    f = fi(t, 11);
  } else if (md === 'f6_sink') {
    anim = 'sink';
    f = fi(t, 9);
  } else if (md === 'stun') {
    anim = 'flinch';
    f = fi(t, 4);
  } else {
    anim = 'linger';
    f = Math.floor((now + hash(id, 7) * 3) * 8) % 12;
  }
  if (md !== 'dying' && !under) {
    const age = hurtFx(v, now, 1.0, ex);
    if (age >= 0 && age < 0.2 && anim === 'linger') {
      anim = 'flinch';
      f = Math.min(4, Math.floor(age * FPS));
    }
  }
  return { ...frameOf(WK, anim, f, d, pose, () => wormPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_worm', function* () {
  yield* warmAll(
    WK,
    [
      ['under', 8],
      ['surface', 11],
      ['aim', 20],
      ['spit', 5],
      ['linger', 12],
      ['bite', 17],
      ['bitef', 12],
      ['sink', 10],
      ['flinch', 5],
      ['die', 22],
    ],
    wormPic,
  );
});
