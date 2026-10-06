// Адский пёс (анимации мобов 10): чёрная шкура, огненная грива-гребень и
// хвост-факел, костяные рога назад, пасть горит изнутри. Галоп — по
// пройденному пути, 8 сторон, туда, куда бежит.
//
// Метроном — `f10-brains.ts` (`f10_hound`): укус `windup` 0,4 с (урон в
// конце — кадр контакта = первый кадр `recover`, пасть смыкается), отдых
// 0,55; прыжок — прицел `aim` 0,45 (вжался, задние в пружину, гребень
// вспыхивает), `pounce` — полёт пастью вперёд со шлейфом, приземление —
// `recover` после `pounce` (шлепок, юз, встряхнулся). Пёс на цепи на её
// конце рвётся и лает (`bark`). Смерть 0,8 с: взвизгнул, завалился на бок,
// угли гаснут, пепел.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  PI,
  Rig,
  TAU,
  WHITE,
  alpha,
  camSide,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  moving,
  headOf,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  vlerp,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, RGBA } from './f10-mobs';
import type { Mat } from './f15-rig';

const FUR = tn('#0e0a0e', '#2a2028', '#463a44', '#6e5c66');
const BELLY = tn('#2a1010', '#4e1e1c', '#723028', '#9a4a38');
const HORN = tn('#241814', '#4a362c', '#76604c', '#a08a72');
const EMB = tn('#8a1a06', '#e05010', '#ffa030', '#fff0a0');
const MAW = tn('#3a0806', '#8a1c08', '#e0601a', '#ffc050');
const EYE = hx('#ffb030');
const TOOTH = hx('#f4ecd8');
const CLAW = hx('#d8c8a8');
const ASH: RGBA[] = [hx('#3a3436'), hx('#5a5054'), hx('#2a2426')];

interface HoundO {
  fwd: number;
  lift: number;
  pitch: number;
  roll: number;
  head: number;
  hturn: number;
  neck: number;
  jaw: number;
  /** Накал гривы 0…1 и пламя гривы: кадр мерцания, отставание назад (бег). */
  heat: number;
  flick: number;
  drag: number;
  ears: number;
  tail: number;
  tsw: number;
  /** Галоп: фаза и доля. */
  ph: number;
  step: number;
  /** Присел на задние; передние в упор; клубком (сон); лапы подломились; полёт. */
  crouch: number;
  brace: number;
  tuck: number;
  fall: number;
  fly: number;
  /** Угли гаснут (смерть), глаза закрыты, хватка — искра. */
  dim: number;
  shut: number;
  snap: number;
}
const H0: HoundO = {
  fwd: 0,
  lift: 0,
  pitch: 0,
  roll: 0,
  head: 0,
  hturn: 0,
  neck: 0,
  jaw: 0.1,
  heat: 0.45,
  flick: 0,
  drag: 0,
  ears: 0.2,
  tail: 0,
  tsw: 0,
  ph: 0,
  step: 0,
  crouch: 0,
  brace: 0,
  tuck: 0,
  fall: 0,
  fly: 0,
  dim: 0,
  shut: 0,
  snap: 0,
};

function houndRig(o: HoundO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const zc = 8.2 + o.lift - o.tuck * 5.0 - o.crouch * 1.6;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const heat = clamp01(o.heat) * (1 - o.dim);
  const ash = o.dim > 0.75;
  const T = ash ? tn('#1a1618', '#3a3236', '#5a5054', '#7a7074') : FUR;
  const plain: Mat = { T };
  const body: Mat = {
    T,
    pat: (q) => (!ash && q[2] < -0.45 && Math.abs(q[1]) < 0.75 ? BELLY[q[2] < -0.7 ? 0 : 1] : null),
  };
  // Зад, поджарая талия, глубокая грудь.
  r.ell(C, [-4.4, 0, 0.2], [3.6, 3.6, 2.8], body);
  r.cap(C.p(-2.2, 0, 0.4), C.p(1.6, 0, 0.6), 2.5, 3.0, plain);
  r.ell(C, [3.0, 0, 0.5], [4.0, 4.0, 3.4], body);
  // Шея и голова: череп, морда, нижняя челюсть.
  const Hd = C.at(7.0 + o.neck * 1.6, 0, 3.6 - o.neck * 0.8 - o.tuck * 1.4)
    .turn(o.hturn)
    .pitch(o.head);
  r.cap(C.p(4.6, 0, 1.6), Hd.p(-0.9, 0, -0.3), 2.8, 2.2, plain);
  r.ell(Hd, [0.6, 0, 0.3], [2.8, 2.7, 2.2], plain);
  r.cap(Hd.p(2.2, 0, 0), Hd.p(5.6, 0, -0.4), 1.7, 1.1, plain);
  r.dot(Hd.p(6.1, 0, -0.2), T[0], 0, 1, 0.4);
  const J = Hd.at(1.9, 0, -1.2).pitch(o.jaw * 0.85);
  r.cap(J.p(0, 0, 0), J.p(3.6, 0, -0.2), 1.1, 0.75, plain);
  // Пасть горит изнутри: видна, когда челюсть открыта.
  if (o.jaw > 0.15 && !ash)
    r.ell(Hd, [3.4, 0, -1.25 - o.jaw * 0.5], [1.8, 0.9, 0.4 + o.jaw * 0.6], {
      T: MAW,
      glow: 0.55 + 0.45 * heat,
      soft: true,
    });
  const hornM: Mat = { T: ash ? T : HORN, bias: 0.1 };
  for (const sd of [-1, 1]) {
    r.dot(Hd.p(5.0, sd * 0.7, -1.25), TOOTH, 0, 1, 0.5);
    if (o.jaw > 0.3) r.dot(J.p(3.1, sd * 0.6, 0.7), TOOTH, 0, 1, 0.5);
    // Глаза — угли.
    if (!o.shut && o.dim < 0.6) r.dot(Hd.p(1.9, sd * 1.55, 1.0), EYE, 1, 2, 0.6);
    // Рога: назад и вверх, кончиком вниз.
    const h0 = Hd.p(-0.2, sd * 1.3, 1.9);
    const h1 = vadd(h0, Hd.v(-1.9 - o.ears * 0.4, sd * 0.8, 1.5 - o.ears * 0.5));
    const h2 = vadd(h1, Hd.v(-1.6, sd * 0.3, -0.5));
    r.cap(h0, h1, 0.6, 0.4, hornM);
    r.cap(h1, h2, 0.4, 0.2, hornM);
    // Уши — короткие, прижимаются.
    r.spike(
      Hd.p(-0.6, sd * 1.8, 1.2),
      Hd.v(-0.8 - o.ears, sd * 0.9, 0.9 - o.ears * 0.6),
      2.2,
      1.0,
      { T, bias: 0.15 },
      3,
    );
  }
  r.eye = Hd.p(1.9, cs * 1.55, 1.0);
  // Огненная грива-гребень: языки по хребту (снаружи красные, внутри —
  // жёлтые), отстают назад на бегу и мерцают по кадру.
  if (!ash) {
    const g = 0.45 + 0.55 * heat;
    const outer: Mat = { T: EMB, flat: 1, glow: 0.7 * g, soft: true };
    const inner: Mat = { T: EMB, flat: 2, glow: 0.95 * g, soft: true };
    const core: Mat = { T: EMB, flat: 3, glow: 1, soft: true };
    for (let i = 0; i < 7; i++) {
      const k = i / 6;
      const P = vlerp(C.p(-6.0, 0, 2.2), Hd.p(-1.2, 0, 1.4), k);
      const wob = Math.sin(i * 2.3 + o.flick * 1.9);
      const L = (2.2 + 2.2 * heat) * (0.8 + 0.25 * wob) * (i === 6 ? 0.6 : 1) * (1 - o.dim);
      if (L < 0.5) continue;
      const dir = C.v(-0.4 - o.drag * 0.8, 0.12 * wob, 1.2 - o.drag * 0.2);
      r.spike(P, dir, L, 1.5, outer, 3, 0.5);
      if (L > 1.6)
        r.spike(vadd(P, C.v(0, cs * 0.3, 0.2)), dir, L * 0.55, 0.9, i % 2 ? inner : core, 3, 0.5);
    }
  } else
    for (let i = 0; i < 5; i++)
      r.spike(
        vlerp(C.p(-5.2, 0, 2.3), C.p(3.6, 0, 3.4), i / 4),
        C.v(-0.6, 0, 1),
        1.1,
        0.8,
        plain,
        3,
      );
  // Хвост-плеть с факелом на конце.
  const a1 = 0.35 + o.tail * 0.6;
  const a2 = a1 - 0.4 + o.tail * 0.25;
  const T0 = C.p(-7.4, 0, 1.0);
  const T1 = vadd(T0, C.v(-2.8 * Math.cos(a1), Math.sin(o.tsw) * 2.0, 2.8 * Math.sin(a1)));
  const T2 = vadd(T1, C.v(-2.6 * Math.cos(a2), Math.sin(o.tsw * 1.6) * 2.2, 2.6 * Math.sin(a2)));
  r.cap(T0, T1, 1.0, 0.7, plain);
  r.cap(T1, T2, 0.7, 0.45, plain);
  if (o.dim < 0.7) {
    const fl = o.flick % 3;
    const up = C.v(-0.5 - o.drag, 0, 1);
    r.spike(T2, up, 2.2 + heat * 1.4 + (fl === 1 ? 0.5 : 0), 1.0, {
      T: [EMB[1], EMB[2], EMB[3], WHITE],
      glow: 0.9,
      soft: true,
    });
  }
  // Лапы: галоп парами со сдвигом, упор, сон, падение, полёт.
  const legs: [number, number, number, number, boolean][] = [
    [3.4, 3.9, 3.3, 0, true],
    [-4.5, -5.0, 3.5, 0.55, false],
  ];
  for (const [hipF, footF, footS, phase, front] of legs)
    for (const sd of [-1, 1]) {
      const legM: Mat = { T, bias: sd === cs ? 0 : -0.2 };
      const hip = C.p(hipF, sd * 2.6, -1.1);
      const ps = (((o.ph + phase + (sd > 0 ? 0.12 : 0)) % 1) + 1) % 1;
      const R = (front ? 3.6 : 3.9) * o.step;
      let off = 0;
      let rise = 0;
      if (ps < 0.42) off = R - 2 * R * (ps / 0.42);
      else {
        off = -R + 2 * R * ((ps - 0.42) / 0.58);
        rise = Math.sin(PI * ((ps - 0.42) / 0.58)) * 3.0 * o.step;
      }
      let foot = B.p(
        footF + o.fwd * 0.3 + off + (front ? 1.3 * o.brace : 1.8 * o.crouch),
        sd * (footS + (front ? 0.6 * o.brace : 0)),
        rise,
      );
      if (o.tuck > 0)
        foot = vlerp(foot, B.p(front ? footF + 3.4 : footF + 1.2, sd * 2.8, 0), o.tuck);
      if (o.fly > 0)
        foot = vlerp(
          foot,
          front ? C.p(hipF + 4.6, sd * 2.0, -3.4) : C.p(hipF - 4.2, sd * 2.2, -3.2),
          o.fly,
        );
      if (o.fall > 0) foot = vlerp(foot, C.p(footF * 0.9, sd * 4.2, -6.0), o.fall);
      const mid = vlerp(hip, foot, 0.5);
      if (front) {
        const elbow = vadd(mid, C.v(-0.9, 0, 0.2));
        r.cap(hip, elbow, 1.45, 0.95, legM);
        r.cap(elbow, foot, 0.9, 0.65, legM);
      } else {
        const knee = vadd(mid, C.v(1.6, 0, 0.3));
        const hock = vadd(vlerp(knee, foot, 0.6), C.v(-1.1, 0, 0.3));
        r.cap(hip, knee, 1.85, 1.15, legM);
        r.cap(knee, hock, 1.0, 0.7, legM);
        r.cap(hock, foot, 0.68, 0.6, legM);
      }
      r.dot(vadd(foot, B.v(0.7, 0, 0.2)), CLAW, 0, 1, 0.4);
    }
  // Искра хватки.
  if (o.snap > 0) r.dot(Hd.p(5.6, 0, -1.2), alpha(WHITE, o.snap), 1, 2, 1);
  return r;
}

function houndPose(anim: string, f: number): HoundO {
  const o: HoundO = { ...H0, flick: f };
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: дышит, хвост ходит, голова оглядывается, грива тлеет.
      const a = (f / 8) * TAU;
      o.lift = 0.15 * Math.sin(a);
      o.tsw = Math.sin(a) * 0.5;
      o.tail = 0.1 * Math.sin(a + 1);
      o.hturn = 0.2 * Math.sin(a * 0.5 + 0.5) * (f > 3 ? 1 : 0.4);
      o.jaw = f % 4 < 2 ? 0.3 : 0.12;
      o.heat = 0.4 + 0.15 * Math.sin(a);
      o.ears = 0.15 + (f === 5 ? 0.35 : 0);
      break;
    }
    case 'run': {
      // Галоп: 8 кадров на цикл; корпус качается, грива и хвост тянутся назад.
      o.ph = f / 8;
      o.step = 1;
      const a = o.ph * TAU;
      o.pitch = 0.11 * Math.sin(a + 0.6);
      o.lift = 0.9 * Math.max(0, Math.sin(a + 2.2));
      o.head = -0.08 * Math.sin(a + 0.6);
      o.neck = 0.4;
      o.tail = -0.25 + 0.15 * Math.sin(a + 1.5);
      o.tsw = 0.15 * Math.sin(a);
      o.ears = 0.7;
      o.jaw = 0.3;
      o.heat = 0.65;
      o.drag = 0.8;
      break;
    }
    case 'bark': {
      // На цепи: упёрся передними, тянет вперёд, лает — 6 кадров по 9 к/с.
      const a = (f / 6) * TAU;
      o.brace = 1;
      o.crouch = 0.35;
      o.fwd = 0.8 + 0.4 * Math.sin(a);
      o.pitch = -0.08 + 0.06 * Math.sin(a);
      o.head = -0.2 - 0.15 * Math.max(0, Math.sin(a));
      o.jaw = f % 3 === 0 ? 0.9 : f % 3 === 1 ? 0.4 : 0.1;
      o.neck = 0.6;
      o.ears = 0.9;
      o.tail = 0.4;
      o.heat = 0.8;
      o.drag = 0.3;
      break;
    }
    case 'bite': {
      // Укус, 0,4 с (10 кадров): присел, голова низко, пасть приоткрыта,
      // дрожь на пике (0,5–0,8), бросок — пасть настежь к кадру урона.
      const k = (f + 0.5) / FPS / 0.4;
      o.crouch = trk(k, [
        [0, 0],
        [0.45, 1, easeOut],
        [0.8, 1],
        [1, 0, easeIn],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.45, -2.0, easeOut],
        [0.8, -2.2],
        [1, 2.8, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.45, -0.14],
        [0.8, -0.16],
        [1, 0.1, easeIn],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.45, 0.3],
        [1, 0.05],
      ]);
      o.jaw = trk(k, [
        [0, 0.1],
        [0.45, 0.35],
        [0.8, 0.4],
        [1, 1, easeIn],
      ]);
      o.ears = 1;
      o.tail = -0.1;
      o.heat = trk(k, [
        [0, 0.5],
        [0.8, 0.9],
      ]);
      if (k > 0.45 && k < 0.82) o.fwd += f % 2 ? 0.2 : -0.2;
      break;
    }
    case 'bitef': {
      // Хватка (0,55 с, 14 кадров): сомкнул пасть, трёпка, отдача, возврат.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 3.2],
        [0.06, 3.5],
        [0.3, -1.0],
        [0.55, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0],
        [0.25, 0],
        [0.35, 0.45],
        [0.55, 0.1],
      ]);
      o.head = trk(t, [
        [0, 0.15],
        [0.3, 0.1],
        [0.55, 0],
      ]);
      o.hturn = t < 0.28 ? 0.38 * Math.sin(f * 2.4) * (1 - t / 0.28) : 0;
      o.pitch = trk(t, [
        [0, 0.1],
        [0.3, -0.04],
        [0.55, 0],
      ]);
      o.ears = trk(t, [
        [0, 1],
        [0.55, 0.3],
      ]);
      o.tail = trk(t - 0.06, [
        [0, 0.3],
        [0.3, -0.1],
        [0.5, 0],
      ]);
      o.heat = trk(t, [
        [0, 1],
        [0.55, 0.5],
      ]);
      o.snap = f === 0 ? 1 : f === 1 ? 0.5 : 0;
      break;
    }
    case 'aim': {
      // Прицел прыжка, 0,45 с (11 кадров): вжался к земле, задние в пружину,
      // голова в линию цели, грива вспыхивает; последние 0,15 с — дрожь.
      const k = (f + 0.5) / FPS / 0.45;
      o.crouch = trk(k, [
        [0, 0],
        [0.4, 1.5, easeOut],
        [1, 1.7],
      ]);
      o.fwd = trk(k, [
        [0, 0],
        [0.4, -2.4, easeOut],
        [1, -2.8],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.4, 0.12],
        [1, 0.16],
      ]);
      o.head = trk(k, [
        [0, 0],
        [0.4, -0.2],
        [1, -0.25],
      ]);
      o.neck = trk(k, [
        [0, 0],
        [0.5, 0.7],
      ]);
      o.jaw = trk(k, [
        [0, 0.15],
        [0.7, 0.35],
        [1, 0.6],
      ]);
      o.ears = 1;
      o.tail = trk(k, [
        [0, 0],
        [0.5, 0.6],
        [1, 0.75],
      ]);
      o.tsw = 0;
      o.heat = trk(k, [
        [0, 0.5],
        [1, 1],
      ]);
      o.drag = 0.2;
      if (k > 0.66) o.fwd += f % 2 ? 0.25 : -0.25;
      break;
    }
    case 'pounce': {
      // Полёт (до 0,6 с, 15 кадров): толчок — вытянулся струной, передние
      // вперёд, задние назад, пасть настежь, грива — назад пламенем.
      const t = f / FPS;
      o.fly = trk(t, [
        [0, 0.3],
        [0.08, 1, easeOut],
      ]);
      o.pitch = trk(t, [
        [0, -0.18],
        [0.12, -0.08],
        [0.32, 0.1],
      ]);
      o.neck = 1;
      o.head = -0.1;
      o.jaw = trk(t, [
        [0, 0.6],
        [0.1, 1],
      ]);
      o.ears = 1;
      o.tail = -0.15;
      o.tsw = 0.2 * Math.sin(f * 1.3);
      o.heat = 1;
      o.drag = 1;
      o.fwd = 1.0;
      break;
    }
    case 'land': {
      // Приземление (отдых после прыжка, 0,55 с, 14 кадров): шлепок на
      // передние, юз, встряхнулся.
      const t = f / FPS;
      o.brace = trk(t, [
        [0, 1],
        [0.3, 1],
        [0.5, 0],
      ]);
      o.crouch = trk(t, [
        [0, 1.1],
        [0.08, 0.7],
        [0.3, 0.2],
        [0.5, 0],
      ]);
      o.pitch = trk(t, [
        [0, 0.2],
        [0.1, -0.06],
        [0.3, 0],
      ]);
      o.fwd = trk(t, [
        [0, 1.4],
        [0.15, 0.4],
        [0.5, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0.8],
        [0.12, 0],
        [0.5, 0.2],
      ]);
      o.roll = t > 0.28 && t < 0.48 ? 0.22 * Math.sin((t - 0.28) * 47) : 0;
      o.hturn = o.roll * 1.4;
      o.ears = trk(t, [
        [0, 1],
        [0.5, 0.3],
      ]);
      o.tail = trk(t - 0.05, [
        [0, -0.3],
        [0.3, 0.4],
        [0.5, 0],
      ]);
      o.heat = trk(t, [
        [0, 1],
        [0.55, 0.5],
      ]);
      o.drag = trk(t, [
        [0, 1],
        [0.3, 0],
      ]);
      break;
    }
    case 'flinch': {
      // Ушиб: взвизгнул — голова вверх, хвост поджат, грива пригасла.
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.fwd = -1.6 * b;
      o.lift = -0.5 * b;
      o.head = -0.45 * b;
      o.jaw = 0.1 + 0.55 * b;
      o.ears = 0.3 + 0.7 * b;
      o.tail = -0.7 * b;
      o.heat = 0.45 - 0.2 * b;
      break;
    }
    case 'sleep': {
      // Спит клубком: голова на лапах, грива едва тлеет.
      o.tuck = 1;
      o.head = 0.55;
      o.neck = -0.4;
      o.ears = 0.9;
      o.tail = -0.5;
      o.tsw = 1.1;
      o.heat = 0.12 + f * 0.1;
      o.shut = 1;
      o.jaw = 0;
      break;
    }
    case 'die': {
      // 19 кадров (0,8 с): взвизгнул (0–3), лапы подломились — на бок
      // (3–11), грива гаснет, пепел (11–18).
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, -1.6, easeOut],
        [0.12, -1.8],
        [0.66, -1.2],
      ]);
      o.head = trk(t, [
        [0, -0.55],
        [0.12, -0.6],
        [0.5, 0.5],
        [0.7, 0.65],
      ]);
      o.jaw = trk(t, [
        [0, 0.85],
        [0.4, 0.5],
        [0.7, 0.3],
      ]);
      o.roll = trk(t, [
        [0.12, 0],
        [0.42, 1.35, easeIn],
        [0.5, 1.25],
        [0.58, 1.32],
      ]);
      o.lift = trk(t, [
        [0, 0],
        [0.12, 0.3],
        [0.42, -3.2, easeIn],
        [0.7, -3.4],
      ]);
      o.fall = trk(t, [
        [0.1, 0],
        [0.45, 1],
      ]);
      o.tail = trk(t, [
        [0, 0.5],
        [0.5, -0.4],
      ]);
      o.ears = 1;
      o.heat = trk(t, [
        [0, 1],
        [0.2, 1],
        [0.6, 0.2],
      ]);
      o.dim = sstep(0.4, 0.72, t);
      o.shut = t > 0.45 ? 1 : 0;
      break;
    }
  }
  return o;
}

const HOUND = kindOf('hound', 46, 38, 23, 28, 1100);
const houndPic = (anim: string, f: number, d: number): Pic =>
  draw(HOUND, houndRig(houndPose(anim, f), yawN(d)), (o, P) => {
    if (anim !== 'die' || f < 9) return;
    // Пепел и дым над остывающим телом.
    const [x, y] = P([0, 0, 6]);
    const k = (f - 8) / 10;
    spray(o.p, x, y, 9, 9, k, 77, ASH, 0, 10);
  });

/** Пёс на цепи стоит на её конце и рвётся к герою. */
const straining = (m: Mob) =>
  !!m.data?.chain &&
  m.mode === 'chase' &&
  Math.hypot((m.x ?? 0) - m.data.px, (m.y ?? 0) - m.data.py) > (m.data.len ?? 3.1) - 0.2 &&
  !moving(m, 1.2);

registerMobPainter('f10_hound', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const tech =
    md === 'windup' ||
    md === 'recover' ||
    md === 'aim' ||
    md === 'pounce' ||
    md === 'alert' ||
    straining(m);
  const v = visOf(m, pose, tech ? (m.face ?? 0) : headOf(m), md === 'pounce' ? 30 : 14);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 7 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  const id = m.id ?? 0;
  if (md === 'dying') {
    f = fi(t, 18);
    anim = 'die';
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.7, 0.85, t);
    ex.shadow = 7 * (1 - sstep(0.6, 0.85, t));
    ex.still = true;
  } else if (md === 'windup') {
    f = fi(t, 9);
    anim = 'bite';
    ex.still = true;
  } else if (md === 'aim') {
    f = fi(t, 10);
    anim = 'aim';
    ex.still = true;
    if (f >= 7) {
      ex.sx = 1.06;
      ex.sy = 0.95;
    }
  } else if (md === 'pounce') {
    f = fi(t, 14);
    anim = 'pounce';
    ex.still = true;
    // Дуга прыжка: вверх и вниз за ~0,38 с, дальше — над самой землёй.
    const k = clamp01(t / 0.38);
    ex.dy = -Math.sin(PI * k) * 6;
    ex.sx = 1.08;
    ex.sy = 0.94;
    ex.shadow = 7 - 2 * Math.sin(PI * k);
    ex.ghost = { every: 0.03, life: 0.16, tint: '#ff7a2a', alpha: 0.3 };
  } else if (md === 'recover') {
    ex.still = true;
    if (v.prev === 'pounce') {
      f = fi(t, 13);
      anim = 'land';
      if (f <= 1) {
        ex.sx = 1.12;
        ex.sy = 0.88;
      }
    } else {
      f = fi(t, 13);
      anim = 'bitef';
      if (f <= 1) {
        ex.sx = 1.08;
        ex.sy = 0.93;
      }
    }
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.1 + hash(id, 3) * 2) % 2;
    anim = 'sleep';
  } else if (md === 'emerge') {
    // Из норы: проявляется из темноты, выползая.
    const k = clamp01(t / 0.45);
    f = Math.floor(t * 16) % 8;
    anim = 'run';
    dark = 3 - Math.min(3, Math.floor(k * 4));
  } else if (md === 'drop') {
    f = 6;
    anim = 'pounce';
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (straining(m)) {
    f = Math.floor(now * 9 + hash(id, 5) * 6) % 6;
    anim = 'bark';
  } else if (moving(m)) {
    f = Math.floor((v.dist / 1.25) * 8) % 8;
    anim = 'run';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 6) % 8;
    anim = 'idle';
    if (md === 'alert') ex.dy = -Math.sin(PI * clamp01(t / 0.35)) * 2.6;
  }
  if (md !== 'dying') hurtFx(v, now, 1.8, ex);
  return { ...frameOf(HOUND, anim, f, d, pose, () => houndPic(anim, f, d), dark), ...ex };
});

registerMobWarm('f10_hound', function* () {
  yield* warmAll(
    HOUND,
    [
      ['run', 8],
      ['idle', 8],
      ['bite', 10],
      ['bitef', 14],
      ['aim', 11],
      ['pounce', 15],
      ['land', 14],
      ['flinch', 5],
      ['die', 19],
      ['bark', 6],
      ['sleep', 2],
    ],
    houndPic,
  );
});
