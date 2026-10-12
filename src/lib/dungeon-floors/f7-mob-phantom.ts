// Этаж 7 — Призрачная копия (анимации мобов 7). Бледная фигура в капюшоне
// без ног, вместо лица — гладкое зеркало, снизу — три ленты-хвоста. Риг
// мини-3D (`f15-rig.ts`), все 8 сторон рисуются честно: смотрит туда, куда
// плывёт, ленты отстают по ходу (вторичное движение со сдвигом фазы).
//   • плывёт: качается от времени, на быстром ходу кренится вперёд, ленты
//     тянутся назад; не видят — остаётся одна мерцающая кайма, переход —
//     за 0,15 с;
//   • касание (`windup`, 0,45 с): отшатнулась, руки вверх, в зеркале лица
//     загораются фиолетовые глаза — держит — бросок; кадр контакта —
//     первый кадр `recover`, ровно когда мозг «очаровывает»; искры у
//     ладоней, перелёт, ленты хлещут вперёд, возврат;
//   • выход из зеркала — проявляется зерном и поднимается;
//   • смерть — зеркало лица трескается, фигура расплетается и уходит
//     вверх, тая (`linger`).
// Эхо 15-го зовёт этот рисовальщик со своим мобом: `windup` длиннее
// (кадры зажаты), незнакомые режимы рисуются покоем.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vadd, vlerp } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  TAU,
  WHITE,
  alpha,
  clamp01,
  dir8,
  dither,
  dress,
  eOut,
  eOut3,
  fi,
  frameOf,
  headOf,
  hurtFx,
  hx,
  kindOf,
  lerp,
  litOf,
  mod,
  phaseOf,
  rigPic,
  rimOf,
  fadePx,
  smooth,
  sstep,
  tn,
  trk,
  visOf,
  warmSteps,
  yawOfDir,
} from './f7-mobkit';
import type { Look, Pic } from './f7-mobkit';

const PH = tn('#5a6c98', '#98aed8', '#cfe0f6', '#f6fbff');
const SILV = tn('#394252', '#667588', '#a9b8cb', '#eef4fc');
const CYAN_HOT = hx('#e0fbff');
const VIO_HOT = hx('#dccaff');
const CHARM = hx('#ff9ad8');
const RIM = hx('#f6fbff');

const W = 36;
const H = 44;
const AX = 18;
const AY = 36;

interface PO {
  /** Наклон вперёд (рад), крен, подъём. */
  lean: number;
  roll: number;
  z: number;
  /** Ладони в осях тела (вперёд, вправо, вверх от середины балахона). */
  lh: V3;
  rh: V3;
  /** Фаза лент и насколько они тянутся назад (отрицательное — хлещут вперёд). */
  ph: number;
  drag: number;
  /** Наклон капюшона. */
  head: number;
  eyes: number;
  charm: number;
}
const REST: PO = {
  lean: 0.08,
  roll: 0,
  z: 0,
  lh: [1.2, -3.6, 2.2],
  rh: [1.2, 3.6, 2.2],
  ph: 0,
  drag: 0.3,
  head: 0,
  eyes: 0,
  charm: 0,
};

function phantomRig(o: PO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const C = B.at(0, 0, 8 + o.z)
    .pitch(o.lean)
    .roll(o.roll);
  const robe: Mat = { T: PH, bias: 0.05 };
  // Балахон: верх — овал, низ сужается и уходит назад.
  r.ell(C, [0, 0, 5.6], [3.0, 3.5, 4.8], robe);
  r.cap(C.p(0, 0, 2), C.p(-0.6 - 0.8 * o.drag, 0, -3), 3.3, 2.2, robe);
  // Ленты: от подола назад и вниз, каждая волной со своим запаздыванием.
  for (let i = -1; i <= 1; i++) {
    const b0 = C.p(-0.8, i * 1.6, -3);
    const w1 = Math.sin(o.ph + i * 1.3) * 1.1;
    const w2 = Math.sin(o.ph + i * 1.3 - 1.2) * 1.5;
    const p1 = vadd(b0, B.v(-(0.9 + 1.1 * o.drag), i * 0.5 + w1, -2.4));
    const p2 = vadd(p1, B.v(-(0.8 + 1.4 * o.drag), i * 0.3 + w2, -1.9 + o.drag * 0.5));
    r.cap(b0, p1, 1.25, 0.9, robe);
    r.cap(p1, p2, 0.9, 0.4, { T: PH, bias: -0.1 });
  }
  // Руки: плечо — локоть (провисает) — ладонь, когти-льдинки светятся.
  for (const sd of [-1, 1]) {
    const sh = C.p(0.5, sd * 3.0, 8.8);
    const hand = C.p(...(sd < 0 ? o.lh : o.rh));
    const el = vadd(vlerp(sh, hand, 0.5), C.v(-0.4, sd * 0.9, -1.1));
    r.cap(sh, el, 1.0, 0.85, robe);
    r.cap(el, hand, 0.85, 0.7, robe);
    r.dot(hand, CYAN_HOT, 0.9, 1, 0.8);
    if (o.charm > 0) {
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + o.charm * 5 + (sd > 0 ? 1 : 0);
        const q = vadd(hand, [Math.cos(a) * 2.2 * o.charm, Math.sin(a) * 2.2 * o.charm, 1.2]);
        r.dot(q, k ? alpha(CHARM, o.charm) : alpha(VIO_HOT, o.charm), 1, 1, 0.9);
      }
    }
  }
  // Капюшон с острым концом и лицо-зеркало.
  const Hd = C.at(0.6, 0, 13.6).pitch(o.head);
  r.ell(Hd, [0, 0, 0], [3.6, 3.7, 3.9], robe);
  r.cap(Hd.p(-2.0, 0, 2.4), Hd.p(-3.6, 0, 3.4), 1.4, 0.5, robe);
  const disc: V3[] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU;
    disc.push(Hd.p(3.25, Math.cos(a) * 2.1, Math.sin(a) * 2.5 - 0.4));
  }
  r.poly(disc, { T: SILV, spec: true, bias: 0.25 });
  r.line(Hd.p(3.45, -1.3, 1.3), Hd.p(3.45, 0.2, -1.4), SILV[3], 0, 0.9);
  if (o.eyes > 0)
    for (const sd of [-1, 1]) r.dot(Hd.p(3.5, sd * 0.85, 0.1), alpha(VIO_HOT, o.eyes), 1, 1, 1);
  r.eye = Hd.p(3.4, 0, 0.2);
  return r;
}

function pic(o: PO, d: number): Pic {
  const pc = rigPic(phantomRig(o, yawOfDir(d)), W, H, AX, AY, {
    outline: alpha(hx('#2a3456'), 0.85),
    inner: 2.4,
  });
  // Призрак полупрозрачен: сквозь него угадывается пол (свет — нет).
  return { ...pc, p: fadePx(pc.p, 0.86) };
}

// ---- Позы во времени ---------------------------------------------------------------

const FLOAT_N = 6;
/** Плывёт: `i` — кадр качания (12 к/с), `fast` — быстрый ход (крен вперёд, ленты назад). */
function floatPose(i: number, fast: number): PO {
  const ph = (i / FLOAT_N) * TAU;
  return {
    ...REST,
    lean: fast ? 0.2 : 0.06,
    z: Math.sin(ph) * 0.8,
    roll: Math.sin(ph + 0.8) * 0.05,
    ph,
    drag: fast ? 0.9 : 0.3,
    lh: [1.2 + (fast ? -1.2 : 0), -3.6, 2.2 + Math.sin(ph - 0.6) * 0.4],
    rh: [1.2 + (fast ? -1.2 : 0), 3.6, 2.2 + Math.sin(ph - 1.2) * 0.4],
  };
}

const WIND_N = 11;
const REC_N = 17;
/**
 * Касание: `f` 0…10 — `windup` (0,45 с), 11…27 — `recover` (0,7 с). Кадр 11 —
 * контакт: мозг бьёт в t ≥ 0,45, первым после удара рисуется он.
 */
function touchPose(f: number): PO {
  const t = (f + 0.5) / 24;
  const o: PO = { ...REST, ph: t * 7 };
  if (f < WIND_N) {
    // Отшатнулась и подняла руки (0…0,2 с), держит, в зеркале — глаза.
    const k = eOut3(clamp01(t / 0.2));
    const hold = f >= 5 && f <= 9 ? (f % 2 ? 0.25 : -0.25) : 0;
    const go = f === 10 ? 1 : 0;
    o.lean = lerp(0.06, -0.26, k) + go * 0.3;
    o.z = 1.4 * k - go * 0.4;
    o.head = -0.25 * k + go * 0.2;
    o.lh = go ? [3.6, -3.6, 9] : [lerp(1.2, -0.4, k), lerp(-3.6, -5.6, k), lerp(2.2, 11 + hold, k)];
    o.rh = go ? [3.6, 3.6, 9] : [lerp(1.2, -0.4, k), lerp(3.6, 5.6, k), lerp(2.2, 11 - hold, k)];
    o.eyes = sstep(0.05, 0.22, t);
    o.drag = lerp(0.35, 0.9, k) - go * 0.6;
    return o;
  }
  const r = f - WIND_N;
  const tr = (r + 0.5) / 24;
  // Бросок: ладони у цели, крен вперёд, искры «очарования»; перелёт; возврат.
  const out = trk(tr, [
    [0, 1],
    [0.12, 1.12, eOut],
    [0.7, 0, smooth],
  ]);
  o.lean = 0.06 + 0.14 * out;
  o.z = -0.6 * out;
  o.head = 0.15 * out;
  o.lh = [lerp(1.2, 5.6, out), lerp(-3.6, -3.0, out), lerp(2.2, 7.2, out)];
  o.rh = [lerp(1.2, 5.6, out), lerp(3.6, 3.0, out), lerp(2.2, 7.2, out)];
  o.eyes = 1 - sstep(0.1, 0.4, tr);
  o.charm = r === 0 ? 1 : r <= 4 ? 1 - r / 5 : 0;
  o.drag = lerp(0.35, -0.7, sstep(0, 0.12, tr) * (1 - sstep(0.15, 0.6, tr)));
  return o;
}

/** Удар героя: отшатнулась, руки вскинуты, ленты вперёд (5 кадров). */
function stunPose(f: number): PO {
  const k = [1, 0.85, 0.6, 0.35, 0.15][Math.min(4, f)];
  return {
    ...REST,
    lean: 0.08 - 0.42 * k,
    head: -0.3 * k,
    z: 0.8 * k,
    roll: 0.12 * k,
    lh: [lerp(1.2, -1.5, k), lerp(-3.6, -5.2, k), lerp(2.2, 8, k)],
    rh: [lerp(1.2, -1.2, k), lerp(3.6, 5.4, k), lerp(2.2, 6.5, k)],
    drag: 0.35 - 0.8 * k,
    ph: f,
  };
}

// ---- Картинки: проявление, смерть ------------------------------------------------------

const STEP_N = 12;
function stepPic(d: number, f: number): Pic {
  const k = (f + 1) / STEP_N;
  const pc = pic({ ...REST, z: -3 + 3 * eOut(k), ph: f * 0.5, drag: 0.8 * (1 - k) }, d);
  return { ...pc, p: dither(pc.p, 0.15 + 0.85 * smooth(k), f), lit: k > 0.6 ? pc.lit : null };
}

const DIE_T = 0.85;
const DIE_N = 20;
function deathPic(d: number, f: number): Pic {
  const t = (f + 0.5) / 24;
  const k0 = clamp01(t / 0.15);
  const o = stunPose(0);
  o.lean = lerp(0.08, -0.45, k0);
  const r = phantomRig(o, yawOfDir(d));
  // Расплетается: части уходят вверх и сжимаются (обратная тяжесть).
  const k = sstep(0.12, DIE_T, t);
  if (k > 0) r.explode(k, [0, 0, 12], 11 + d, 7, -12, 0, 0.75);
  const pc = rigPic(
    r,
    W,
    H,
    AX,
    AY,
    { outline: alpha(hx('#2a3456'), 0.85), inner: 2.4 },
    (out, P) => {
      // Зеркало лица трескается в первые кадры.
      if (t < 0.3) {
        const L = litOf(out);
        const [cx, cy] = P(F3.yaw(yawOfDir(d)).p(3.6, 0, 21.2));
        for (let j = 0; j < 4; j++) {
          const a = j * 1.7 + 0.4;
          for (let s = 0; s < 3; s++) {
            const x = cx + Math.cos(a) * s;
            const y = cy + Math.sin(a) * s;
            if (out.p.solid(Math.round(x), Math.round(y))) {
              out.p.set(x, y, WHITE);
              L.set(x, y, alpha(VIO_HOT, 0.7));
            }
          }
        }
      }
    },
  );
  const fade = 1 - sstep(0.35, DIE_T, t);
  return {
    ...pc,
    p: dither(fadePx(pc.p, 0.86), 0.2 + 0.8 * fade, f),
    lit: pc.lit && fade > 0.4 ? pc.lit : null,
    eye: null,
  };
}

// ---- Рисовальщик ---------------------------------------------------------------------

const K = kindOf('f7_phantom', 1100);
const keyed = (key: string, look: Look, build: () => Pic): MobFrame =>
  frameOf(K, key, false, look, build);
const hidPic = (o: PO, d: number, i: number): Pic => {
  const pc = pic(o, d);
  return { ...pc, p: rimOf(pc.p, alpha(RIM, 0.4), i), lit: null, eye: null };
};

registerMobPainter('f7_phantom', (m: Mob, pose: MobPose) => {
  const mode = pose.mode;
  const t = Math.max(0, pose.t || 0);
  const now = pose.now || 0;
  const busy = mode === 'windup' || mode === 'recover' || mode === 'stun';
  const v = visOf(m, pose, busy ? (m.face ?? 0) : headOf(m), 10);
  const d = dir8(v.yaw);
  const look = pose.look;
  // Видят ли: невидимка — только кайма; переход 0,15 с (память — `v.a`).
  const hidden = (m.data?.ghost ?? 0) > 0 && mode !== 'f7_step' && !busy && mode !== 'dying';
  const dtv = Math.min(0.1, Math.max(0, now - v.b));
  v.b = now;
  v.a = clamp01(v.a + (hidden ? dtv : -dtv) / 0.15);
  const bob = Math.sin(now * 2.6 + phaseOf(m) * TAU);
  const ex: Partial<MobFrame> = { still: true, shadow: 4, lift: 5 + Math.round(bob) };
  let fr: MobFrame;
  if (mode === 'dying') {
    const f = fi(t, DIE_N - 1);
    fr = keyed(`x|${d}|${f}`, look, () => deathPic(d, f));
    ex.linger = DIE_T;
    ex.lift = 5 + Math.round(t * 6);
    ex.shadow = t < 0.4 ? 4 : 0;
  } else if (mode === 'windup' || mode === 'recover') {
    const f = mode === 'windup' ? fi(t, WIND_N - 1) : WIND_N + fi(t, REC_N - 1);
    fr = keyed(`w|${d}|${f}`, look, () => pic(touchPose(f), d));
    // Бросок вперёд — сдвигом кадра по курсу.
    if (mode === 'recover') {
      const out = trk(t, [
        [0, 1],
        [0.12, 1.12, eOut],
        [0.7, 0, smooth],
      ]);
      ex.dx = Math.cos(v.yaw) * 2.6 * out;
      ex.dy = Math.sin(v.yaw) * 1.3 * out;
      if (t < 1 / 24) {
        ex.sx = 1.07;
        ex.sy = 0.94;
      }
    } else if (t > 0.2) ex.lift = 6;
  } else if (mode === 'stun') {
    const f = fi(t, 4);
    fr = keyed(`s|${d}|${f}`, look, () => pic(stunPose(f), d));
  } else if (mode === 'f7_step') {
    const f = fi(t, STEP_N - 1);
    fr = keyed(`e|${d}|${f}`, look, () => stepPic(d, f));
    ex.lift = Math.round(1 + 4 * clamp01(t / 0.5));
  } else {
    const fast = Math.hypot(m.vx ?? 0, m.vy ?? 0) > 2.4 ? 1 : 0;
    const i = mod(Math.floor(now * 12 + phaseOf(m) * FLOAT_N), FLOAT_N);
    if (v.a > 0.5) fr = keyed(`fh|${d}|${fast}|${i}`, look, () => hidPic(floatPose(i, fast), d, i));
    else fr = keyed(`f|${d}|${fast}|${i}`, look, () => pic(floatPose(i, fast), d));
    if (v.a > 0 && v.a <= 0.5) ex.alpha = 1 - v.a;
    else if (v.a > 0.5) ex.shadow = 0;
  }
  hurtFx(v, now, 2.4, ex);
  return dress(fr, pose.flash, ex);
});

registerMobWarm('f7_phantom', () => {
  const steps: (() => unknown)[] = [];
  const look: Look = 'normal';
  for (let d = 0; d < 8; d++) {
    for (let fast = 0; fast < 2; fast++)
      for (let i = 0; i < FLOAT_N; i++) {
        steps.push(() => keyed(`f|${d}|${fast}|${i}`, look, () => pic(floatPose(i, fast), d)));
        steps.push(() =>
          keyed(`fh|${d}|${fast}|${i}`, look, () => hidPic(floatPose(i, fast), d, i)),
        );
      }
    for (let f = 0; f < WIND_N + REC_N; f++)
      steps.push(() => keyed(`w|${d}|${f}`, look, () => pic(touchPose(f), d)));
    for (let f = 0; f < 5; f++)
      steps.push(() => keyed(`s|${d}|${f}`, look, () => pic(stunPose(f), d)));
    for (let f = 0; f < STEP_N; f++)
      steps.push(() => keyed(`e|${d}|${f}`, look, () => stepPic(d, f)));
    for (let f = 0; f < DIE_N; f++)
      steps.push(() => keyed(`x|${d}|${f}`, look, () => deathPic(d, f)));
  }
  return warmSteps(steps);
});
