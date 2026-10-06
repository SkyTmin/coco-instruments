// Этаж 6 — Живая руда (анимации мобов 6). Самородок: глыба породы с друзой
// кварца (`data.v` 10) или с серебряными жилами и комьями (11). Мини-3D (риг
// 15-го, ×1,3), 8 сторон честно.
//
// Притворяется: лежит вросшей в пол глыбой, раз в пару секунд по кристаллу
// пробегает блик — и всё. Засада 0,5 с — сцена: глыба вздрагивает, сыплется
// крошка, трещина спереди открывает глаза (до 0,15 — ещё призрак), из-под
// неё выдвигаются четыре каменные лапы, присед — прыжок — и всем весом вниз
// ровно в 0,5 (тогда бьёт круг); приземление дожимается в беге. Бег —
// рысью по пройденному пути, кристаллы звенят (дрожат). Укус 0,42: перед
// задирается, трещина-пасть раскрывается, бросок. Бегство — глаза
// круглые, бег вразвалку. Зарывается 0,6 с: лапы роют, глыба уходит в пол
// до вросшего вида засады. Смерть 0,8 с: трещины светом — раскалывается,
// осколки и кристаллы разлетаются и блестят.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { ORE } from './f6-brains';
import { F3, Rig, vadd, vlerp } from './f15-rig';
import type { Mat, RigOut, V3 } from './f15-rig';
import {
  alpha,
  angD,
  clamp,
  CLIP,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  FPS,
  frameOf,
  hash,
  headOf,
  hurtFx,
  hx,
  kf,
  kindOf,
  litOn,
  mod,
  moving,
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

const ROCK = tn('#241e24', '#3e363e', '#5e545c', '#857882');
const QUARTZ = tn('#8a7a98', '#c8bcd8', '#ece4f6', '#ffffff');
const SILVER = tn('#4a5058', '#8a949e', '#c8d0d8', '#ffffff');
const VEIN = hx('#d8e0e8');
const EYE = hx('#ffcf40');
const MAW = tn('#3a0c06', '#7a1c0c', '#d04a18', '#ff9a40');
const DIRT = hx('#5a4a44');
const SC = 1.3;
/** Вросшая глыба: на сколько ушла в пол (как в засаде и после норы). */
const BURY = 1.1;

interface OreO {
  fwd: number;
  z: number;
  pitch: number;
  roll: number;
  /** Лапы: выдвинуты 0…1, шаг (фаза, доля), разведены. */
  legs: number;
  ph: number;
  step: number;
  spread: number;
  /** Глаза 0…1 (0 — щель закрыта), круглые (страх), пасть 0…1. */
  eyes: number;
  wide: number;
  jaw: number;
  /** Блик по кристаллу 0…1 (−1 — нет), дрожь кристаллов, крошка сыплется. */
  glint: number;
  ring: number;
  crumbs: number;
  /** Ушла в пол, раскол (разлёт) 0…1, трещины светом 0…1, комья земли. */
  sink: number;
  burst: number;
  crack: number;
  dirt: number;
  /** Приземление (кольцо пыли) 0…1. */
  land: number;
}

const O0 = (): OreO => ({
  fwd: 0,
  z: 3.2,
  pitch: 0,
  roll: 0,
  legs: 1,
  ph: 0,
  step: 0,
  spread: 0,
  eyes: 1,
  wide: 0,
  jaw: 0,
  glint: -1,
  ring: 0,
  crumbs: 0,
  sink: 0,
  burst: 0,
  crack: 0,
  dirt: 0,
  land: -1,
});

const LEG_F = [1.5, -1.5];

function oreRig(o: OreO, yaw: number, silver: boolean): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw, [0, 0, -o.sink]).scale(SC);
  const C = B.at(o.fwd, 0, o.z).pitch(o.pitch).roll(o.roll);
  const crack = o.crack;
  const rockM: Mat = {
    T: ROCK,
    pat: (q) => {
      if (silver && Math.abs(Math.sin(q[0] * 5 + q[1] * 3) + q[2] * 0.6) < 0.15) return VEIN;
      if (
        crack > 0 &&
        Math.abs(Math.sin(q[0] * 6.1 - q[2] * 4.3) * Math.cos(q[1] * 5.2)) < 0.06 * crack
      )
        return hx('#fff0c0');
      return Math.abs(Math.sin(q[0] * 9 + q[1] * 7) * Math.sin(q[2] * 8)) < 0.05 ? ROCK[0] : null;
    },
    gpat:
      crack > 0
        ? (q) =>
            Math.abs(Math.sin(q[0] * 6.1 - q[2] * 4.3) * Math.cos(q[1] * 5.2)) < 0.06 * crack
              ? 1
              : 0
        : undefined,
  };
  // Лапы: рысь, диагональные пары.
  if (o.legs > 0.02)
    for (let i = 0; i < 2; i++)
      for (const sd of [-1, 1]) {
        const hip = C.p(LEG_F[i], sd * 1.8, -1.4);
        const grp = (i + (sd > 0 ? 1 : 0)) % 2;
        const ps = mod((o.ph + grp * 0.5) * 1000, 1000) / 1000;
        const L = 2.4 * o.step;
        let off = 0;
        let up = 0;
        if (ps < 0.5) off = L / 2 - L * (ps / 0.5);
        else {
          off = -L / 2 + L * ((ps - 0.5) / 0.5);
          up = Math.sin(PI * ((ps - 0.5) / 0.5)) * 1.2 * o.step;
        }
        const reach = o.legs;
        const foot = vlerp(
          C.p(LEG_F[i] * 0.8, sd * 1.4, -1.6),
          B.p(
            o.fwd + LEG_F[i] * 1.1 + off,
            sd * (2.6 + o.spread),
            up + 0.3 + Math.max(0, o.z - 3.4) * 0.8,
          ),
          reach,
        );
        const knee = vadd(vlerp(hip, foot, 0.5), B.v(0, sd * 0.8 * reach, 0.6 * reach));
        r.cap(hip, knee, 0.95 * SC, 0.8 * SC, rockM);
        r.cap(knee, foot, 0.8 * SC, 0.65 * SC, rockM);
      }
  const from = r.size;
  // Глыба — три кома.
  r.ell(C, [0, 0, 0], [3.6, 3.3, 2.7], rockM);
  r.ell(C, [-1.1, 1.0, 1.2], [2.3, 2.1, 1.9], rockM);
  r.ell(C, [0.9, -1.3, 1.0], [2.0, 1.8, 1.6], rockM);
  // Пасть — нижний край спереди отходит.
  if (o.jaw > 0.05) {
    r.ell(C, [2.5, 0, -0.5], [0.9, 1.5, 0.5 + o.jaw * 0.4], { T: MAW, glow: 0.5 * o.jaw });
    const J = C.at(1.6, 0, -1.0).pitch(o.jaw * 0.7);
    r.ell(J, [0.8, 0, -0.2], [1.6, 2.0, 0.9], rockM);
  }
  // Глаза в трещине.
  for (const sd of [-1, 1]) {
    const e = C.p(3.25, sd * 0.95, 0.7);
    if (o.eyes > 0.1) {
      r.dot(e, EYE, 0.9 * o.eyes, o.wide > 0.5 ? 2 : 1, 2.4);
    } else r.dot(e, ROCK[0], 0, 1, 2.2);
  }
  r.eye = o.eyes > 0.1 ? C.p(3.25, (Math.cos(yaw) >= 0 ? 1 : -1) * 0.95, 0.7) : null;
  // Друза кварца / серебро.
  const ring = o.ring;
  const crys: [V3, V3, number, number][] = [
    [[0.3, -0.5, 2.5], [0.2, -0.3, 1], 4.4, 1.2],
    [[-0.9, 0.8, 2.9], [-0.35, 0.45, 1], 3.6, 1.0],
    [[0.9, 1.1, 2.1], [0.5, 0.45, 0.9], 2.8, 0.85],
    [[-1.7, -1.1, 1.9], [-0.55, -0.5, 0.8], 2.4, 0.75],
  ];
  crys.forEach(([b, dv, L, w], i) => {
    const wob = ring * Math.sin(i * 2.1 + ring * 9) * 0.25;
    if (silver) {
      if (i < 2)
        r.ell(
          C.at(b[0], b[1], b[2] - 0.3),
          [0, 0, 0],
          [1.7 - i * 0.3, 1.5 - i * 0.2, 1.2 - i * 0.15],
          {
            T: SILVER,
            spec: true,
          },
        );
      return;
    }
    const gl = o.glint >= 0 && Math.abs(o.glint * 4 - i) < 0.7 ? 0.9 : 0.2;
    r.spike(
      C.p(b[0], b[1], b[2]),
      C.v(dv[0] + wob, dv[1] - wob, dv[2]),
      L * SC,
      w * SC,
      { T: QUARTZ, spec: true, glow: gl, bias: gl > 0.5 ? 0.6 : 0.25 },
      4,
      i * 0.4,
    );
  });
  if (o.burst > 0) r.explode(o.burst, C.p(0, 0, -0.5), 9, 8, 22, from, 0.35);
  // Пол: что ниже — не видно (вросла, роет).
  if (o.sink > 0.01)
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

function trot(o: OreO, ph: number, fast: number): void {
  o.ph = ph;
  o.step = 1;
  o.z = 3.2 + 0.35 * Math.abs(Math.sin(ph * TAU)) * fast;
  o.roll = 0.07 * Math.sin(ph * TAU) * fast;
  o.pitch = 0.08;
  o.ring = 0.6;
}

function orePose(anim: string, f: number): OreO {
  const o = O0();
  switch (anim) {
    case 'hide': {
      // Вросла; блик бежит по кристаллам (кадры 1…4), кадр 0 — камень.
      o.legs = 0;
      o.eyes = 0;
      o.z = 2.6;
      o.sink = BURY;
      o.glint = f > 0 ? (f - 1) / 3 : -1;
      break;
    }
    case 'wake': {
      // 0,5 с (12 кадров): дрожь и крошка (до 0,15), глаза; лапы и присед
      // (до 0,3), прыжок (до 0,45), вниз всем весом (0,5).
      const k = kf(f, ORE.jump);
      const t = k * ORE.jump;
      o.sink = BURY * (1 - sstep(0.12, 0.26, t));
      o.legs = sstep(0.14, 0.28, t);
      o.eyes = sstep(0.04, 0.12, t);
      o.wide = t < 0.3 ? 1 : 0;
      o.crumbs = t < 0.3 ? 1 : 0;
      o.roll = t < 0.15 ? (f % 2 ? 0.08 : -0.08) : 0;
      o.z = trk(k, [
        [0, 2.6],
        [0.3, 2.6],
        [0.55, 2.4],
        [0.62, 2.0],
        [0.82, 7.5, easeOut],
        [1, 3.0, easeIn],
      ]);
      o.spread = k > 0.55 && k < 0.66 ? 0.6 : 0;
      o.pitch = trk(k, [
        [0, 0],
        [0.6, 0.15],
        [0.82, -0.25],
        [1, 0.1],
      ]);
      o.jaw = sstep(0.6, 0.85, k) * 0.6;
      o.ring = k > 0.6 ? 1 : 0.4;
      break;
    }
    case 'land': {
      // Приземление (5 кадров): дожим, кольцо пыли.
      const k = f / 4;
      o.z = 3.2 - 0.9 * Math.sin(PI * Math.min(1, k * 1.3)) * (1 - k * 0.4);
      o.spread = 0.8 * (1 - k);
      o.land = k;
      o.ring = 1 - k;
      break;
    }
    case 'run':
      trot(o, f / 8, 1);
      break;
    case 'flee':
      // Бегство: вразвалку, глаза круглые, нос вверх.
      trot(o, f / 8, 1.6);
      o.wide = 1;
      o.pitch = -0.12;
      break;
    case 'idle': {
      const a = (f / 8) * TAU;
      o.z = 3.2 + 0.15 * Math.sin(a);
      o.ring = 0.2;
      o.eyes = f === 5 ? 0 : 1;
      break;
    }
    case 'bite': {
      // Замах 0,42 с (10 кадров): перед вверх, пасть настежь, бросок.
      const k = kf(f, 0.42);
      o.fwd = trk(k, [
        [0, 0],
        [0.65, -1.0, easeOut],
        [0.8, -1.1],
        [1, 1.6, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.65, -0.4, easeOut],
        [0.8, -0.42],
        [1, 0.3, easeIn],
      ]);
      o.jaw = sstep(0.1, 0.6, k) * (k > 0.97 ? 0.2 : 1);
      o.z = 3.2 + 0.6 * sstep(0, 0.65, k);
      o.ring = k > 0.65 && k < 0.8 ? 1 : 0.3;
      o.roll = k > 0.65 && k < 0.8 ? (f % 2 ? 0.05 : -0.05) : 0;
      break;
    }
    case 'bitef': {
      // Проводка 0,5 с (12 кадров): щелчок, назад.
      const k = kf(f, 0.5);
      o.fwd = 1.6 * (1 - easeOut(Math.min(1, k / 0.5)));
      o.pitch = 0.3 * (1 - sstep(0, 0.4, k));
      o.jaw = f < 2 ? 0 : 0.4 * (1 - sstep(0.2, 0.6, k));
      o.z = 3.2 - 0.4 * (1 - sstep(0, 0.3, k));
      o.ring = 1 - k;
      break;
    }
    case 'dig': {
      // 0,6 с (15 кадров): лапы роют, глыба уходит в пол до вросшей.
      const t = f / FPS;
      const k = sstep(0.05, 0.55, t);
      o.ph = (f / 3) % 1;
      o.step = 1 - k;
      o.legs = 1 - sstep(0.3, 0.55, t);
      o.sink = BURY * k;
      o.z = 3.2 - 0.6 * k;
      o.roll = (f % 2 ? 0.07 : -0.07) * (1 - k);
      o.pitch = 0.2 * (1 - k);
      o.eyes = 1 - sstep(0.4, 0.58, t);
      o.dirt = 1 - sstep(0.4, 0.6, t);
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.25)) * (1 - (f / 4) * 0.5);
      o.pitch = -0.3 * b;
      o.z = 3.2 + 0.6 * b;
      o.eyes = 1 - b;
      o.ring = 1;
      break;
    }
    case 'alert': {
      const k = f / 8;
      const up = Math.sin(PI * Math.min(1, k * 1.4));
      o.z = 3.2 + 1.2 * up;
      o.eyes = Math.min(1, k * 3);
      o.wide = up > 0.5 ? 1 : 0;
      o.legs = Math.min(1, 0.3 + k);
      break;
    }
    case 'die': {
      // 0,8 с (20 кадров): трещины светом (до 0,25), раскол и разлёт.
      const t = f / FPS;
      o.crack = sstep(0, 0.22, t);
      o.roll = t < 0.25 ? (f % 2 ? 0.08 : -0.08) : 0;
      o.eyes = t < 0.2 ? 1 : 0;
      o.wide = 1;
      o.burst = sstep(0.24, 0.75, t);
      o.legs = 1 - sstep(0.1, 0.25, t);
      o.ring = 1;
      break;
    }
  }
  return o;
}

const OK = kindOf('f6_ore', 44, 40, 22, 30, 1600);

function orePic(anim: string, f: number, d: number): Pic {
  const silver = anim.endsWith('s');
  const a = silver ? anim.slice(0, -1) : anim;
  const o = orePose(a, f);
  const yaw = yawN(d);
  return draw(OK, oreRig(o, yaw, silver), (out, P) => post(out, P, o, yaw, f, a, silver));
}

function post(
  out: RigOut,
  P: Proj2,
  o: OreO,
  yaw: number,
  f: number,
  a: string,
  silver: boolean,
): void {
  const B = F3.yaw(yaw).scale(SC);
  // Крошка с глыбы при пробуждении.
  if (o.crumbs > 0)
    for (let i = 0; i < 5; i++) {
      const k = mod(f * 0.21 + i * 0.2, 1);
      const [x, y] = P(B.p((hash(i, 3) - 0.5) * 6, (hash(i, 4) - 0.5) * 6, 5 - k * 5));
      out.p.set(Math.round(x), Math.round(y), i % 2 ? ROCK[3] : ROCK[2]);
    }
  // Комья земли из-под лап (роет).
  if (o.dirt > 0)
    for (let i = 0; i < 6; i++) {
      const k = mod(f * 0.27 + i / 6, 1);
      const sd = i % 2 ? 1 : -1;
      const [x, y] = P(B.p(-2 - k * 4, sd * (2 + k * 3), 3 * Math.sin(PI * k)));
      out.p.set(Math.round(x), Math.round(y), alpha(DIRT, o.dirt));
    }
  // Кольцо пыли приземления.
  if (o.land >= 0) {
    const [x, y] = P([0, 0, 0]);
    const R = 5 + o.land * 8;
    for (let i = 0; i < 12; i++) {
      const an = (i / 12) * TAU;
      out.p.set(
        Math.round(x + Math.cos(an) * R),
        Math.round(y + Math.sin(an) * R * 0.45),
        alpha(DIRT, 0.9 * (1 - o.land)),
      );
    }
  }
  // Осколки блестят при разлёте.
  if (a === 'die' && o.burst > 0.2) {
    const lit = litOn(out);
    const [x, y] = P([0, 0, 0.5]);
    for (let i = 0; i < 4; i++)
      if (hash(i, f, 2) < 0.5) {
        const px = Math.round(x + (hash(i, 5) - 0.5) * 18 * o.burst);
        const py = Math.round(y + (hash(i, 6) - 0.5) * 6 * o.burst);
        const c = silver ? SILVER[3] : QUARTZ[3];
        out.p.set(px, py, c);
        lit.set(px, py, c);
      }
  }
}

registerMobPainter('f6_ore', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const sv = m.data?.v === 11 ? 's' : '';
  const tech = md === 'windup' || md === 'f6_wake' || md === 'f6_hide';
  const want = tech ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, tech ? 14 : 10);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6, still: true };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.8;
    ex.alpha = 1 - sstep(0.65, 0.8, t);
    ex.shadow = 6 * (1 - sstep(0.25, 0.5, t));
  } else if (md === 'f6_hide' || md === 'sleep') {
    // Камень; блик раз в ~2,5 с (своя фаза по id).
    anim = 'hide';
    const g = mod((now + hash(id, 9) * 2.5) / 2.5, 1) * 2.5;
    f = g < 0.25 ? 1 + Math.min(3, Math.floor((g / 0.25) * 4)) : 0;
    ex.shadow = 0;
  } else if (md === 'f6_wake') {
    anim = 'wake';
    f = fi(t, 11);
    ex.shadow = 6 * sstep(0.12, 0.3, t);
  } else if (md === 'f6_dig') {
    anim = 'dig';
    f = fi(t, 14);
    ex.shadow = 6 * (1 - sstep(0.3, 0.6, t));
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 9);
  } else if (md === 'recover' && v.prev === 'windup') {
    anim = 'bitef';
    f = fi(t, 11);
  } else if (md === 'stun') {
    anim = 'flinch';
    f = fi(t, 4);
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else if (md === 'chase' && v.prev === 'f6_wake' && now - v.modeAt < 0.2) {
    anim = 'land';
    f = Math.min(4, Math.floor((now - v.modeAt) * FPS));
  } else if (moving(m)) {
    anim = md === 'f6_flee' ? 'flee' : 'run';
    f = Math.floor((v.dist / 0.6) * 8) % 8;
    const turn = angD(want, v.yaw);
    ex.rot = clamp(turn * 0.1, -0.08, 0.08);
  } else {
    anim = 'idle';
    f = Math.floor((now + hash(id, 7) * 3) * 6) % 8;
  }
  if (md !== 'dying' && md !== 'f6_hide') hurtFx(v, now, 1.2, ex);
  const key = anim + sv;
  return { ...frameOf(OK, key, f, d, pose, () => orePic(key, f, d)), ...ex };
});

registerMobWarm('f6_ore', function* () {
  for (const sv of ['', 's'])
    yield* warmAll(
      OK,
      [
        [`hide${sv}`, 5],
        [`wake${sv}`, 12],
        [`land${sv}`, 5],
        [`run${sv}`, 8],
        [`bite${sv}`, 10],
        [`bitef${sv}`, 12],
        [`die${sv}`, 20],
      ],
      orePic,
    );
  yield* warmAll(
    OK,
    [
      ['flee', 8],
      ['dig', 15],
      ['idle', 8],
      ['flinch', 5],
    ],
    orePic,
  );
});
