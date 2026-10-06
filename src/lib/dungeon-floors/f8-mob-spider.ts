// Этаж 8 — Демон-паук (анимации мобов 8). Прежний облик: тёмно-лиловое
// брюшко с белой маской и красными метками, бледное лицо демона на
// головогруди, розовые глаза, восемь ног аркой — колени выше спины, красные
// метки на коленях. Мини-3D (`f15-rig`), 8 сторон, все честные.
//
// Метроном мозга (`f8-brains.ts`, `f8_spider`): держит 2–5,7 клетки и бегает
// вокруг героя — лицом по ходу (ноги идут четвёрками, шаг по пути). Нить
// `aim` 0,62 с: весь — подготовка: встал на дыбы, брюшко выгнуто над спиной
// бородавками вперёд, они наливаются светом; в 0,62 — выстрел (первый кадр
// отдыха: отдача, вспышка бородавок, нить вперёд, дальше её рисует зона
// `f8_thread`) → отдых 0,7. Укус `windup` 0,45: вскинул передние ноги,
// хелицеры раскрыты, откат назад — бросок, контакт в 0,45 → отдых 0,7.

import type { Mob } from '../dungeon-sim';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  carry,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  F3,
  fi,
  frameOf,
  FPS,
  hash,
  hurtF,
  hurtFx,
  hx,
  ik,
  kindOf,
  mod,
  moving,
  PI,
  Rig,
  sampleKeys,
  seg2,
  sstep,
  tn,
  TAU,
  vadd,
  visOf,
  vlerp,
  vmul,
  warmAll,
  yawN,
  type PKey,
  type Pic,
  type PoseO,
  type V3,
} from './f8-mobkit';

const BODY = { T: tn('#140c18', '#261628', '#3e2440', '#5e3a60') };
const LEG = { T: tn('#100a12', '#20142a', '#382442', '#56385e') };
const FACE = tn('#8a8098', '#c8c0d4', '#ece8f4', '#ffffff');
const MARK = hx('#c8203a');
const EYE = hx('#ff3a8a');
const FANG = hx('#f0e8f4');
const SILK = hx('#e8e4f4');

/** Брюшко: белая маска сверху (две щели глаз), красные метки. */
const ABD = {
  T: BODY.T,
  pat: (q: V3, l: number) => {
    if (q[2] > 0.25 && Math.abs(q[1]) < 0.5 && q[0] > -0.55 && q[0] < 0.55) {
      // Щели маски.
      if (q[0] > 0.05 && q[0] < 0.25 && Math.abs(Math.abs(q[1]) - 0.22) < 0.1) return BODY.T[0];
      if (q[0] < -0.3 && Math.abs(q[1]) < 0.08) return MARK;
      return l > 0.55 ? FACE[3] : l > 0.3 ? FACE[2] : FACE[1];
    }
    if (q[2] > 0 && q[0] < -0.6 && Math.abs(q[1]) < 0.18) return MARK;
    return null;
  },
};
/** Головогрудь: бледное лицо демона спереди, тёмный панцирь сзади. */
const CEPH = {
  T: BODY.T,
  pat: (q: V3, l: number) => {
    if (q[0] > -0.15) return l > 0.6 ? FACE[3] : l > 0.35 ? FACE[2] : l > 0.15 ? FACE[1] : FACE[0];
    return null;
  },
};

/** Поза паука — числа (смешиваются ключами). */
interface SpO extends PoseO {
  /** Высота головогруди, наклон (+ — передом вверх), сдвиг вперёд. */
  bh: number;
  bp: number;
  fx: number;
  /** Подъём брюшка (рад, + — вверх над спиной). */
  ab: number;
  /** Передние ноги вскинуты 0…1, хелицеры раскрыты 0…1. */
  fr: number;
  fang: number;
  /** Ноги: разлёт (1 — стойка), поджаты к брюху при смерти 0…1. */
  crouch: number;
  curl: number;
  /** Бородавки светятся 0…1. */
  spin: number;
  /** Перевернулся на спину (рад крена). */
  flip: number;
  /** Глаза погасли. */
  shut: number;
}

const B0: SpO = {
  bh: 4.4,
  bp: 0,
  fx: 0,
  ab: 0.18,
  fr: 0,
  fang: 0.2,
  crouch: 1,
  curl: 0,
  spin: 0,
  flip: 0,
  shut: 0,
};

// ---- Треки -----------------------------------------------------------------------------

/** Нить 0,62: на дыбы, брюшко над спиной бородавками вперёд, наливаются. */
const AIM: PKey<SpO>[] = carry<SpO>([
  [0, {}],
  [0.16, { bh: 5.4, bp: 0.32, ab: 0.9, fr: 0.55, fang: 0.5 }, easeOut],
  [0.45, { bh: 5.2, bp: 0.22, ab: 1.95, fr: 0.4, spin: 0.6 }],
  [0.62, { bh: 5.0, ab: 2.15, spin: 1, fx: -0.6 }],
]);
/** Отдых после нити 0,7: отдача, бородавки гаснут, брюшко ложится. */
const SHOT: PKey<SpO>[] = carry<SpO>([
  [0, { ...AIM[3][1] }],
  [0.05, { ab: 1.7, fx: -1.5, bh: 4.8, spin: 0.5 }, easeOut],
  [0.28, { ab: 1.0, fx: -0.6, bp: 0.08, fr: 0.1, spin: 0 }],
  [0.7, { ...B0 }],
]);
/** Укус 0,45: вскинул передние ноги, откат — бросок, контакт в 0,45. */
const BITE: PKey<SpO>[] = carry<SpO>([
  [0, {}],
  [0.2, { bh: 5.7, bp: 0.45, fr: 1, fang: 1, fx: -1.0, ab: 0.4 }, easeOut],
  [0.38, { bp: 0.55, fx: -1.5, bh: 5.9 }],
  [0.45, { bh: 3.4, bp: -0.28, fx: 2.6, fr: 0.25, fang: 0, ab: 0.05 }, easeIn],
]);
const BITEF: PKey<SpO>[] = carry<SpO>([
  [0, { ...BITE[3][1] }],
  [0.08, { fx: 2.8, bh: 3.2 }],
  [0.3, { fx: 0.6, bh: 4.2, fang: 0.4, bp: 0.05, fr: 0 }],
  [0.7, { ...B0 }],
]);
/** Вздрог 0,2. */
const FLINCH: PKey<SpO>[] = [
  [0, {}],
  [0.05, { bh: 3.6, bp: 0.25, fx: -1.0, fr: 0.4, fang: 0.8, crouch: 0.9 }, easeOut],
  [0.2, {}],
];
/** Смерть 0,8: вздыбился, перевернулся на спину, ноги поджимаются, дёргаются. */
const DIE: PKey<SpO>[] = carry<SpO>([
  [0, { bh: 5.2, bp: 0.35, fang: 1, fr: 0.6 }],
  [0.14, { bh: 5.6, bp: 0.6, flip: 1.0, fr: 0.3 }, easeOut],
  [0.3, { bh: 2.6, bp: 0, flip: PI, curl: 0.55, fr: 0, ab: 0, fang: 0.6 }, easeIn],
  [0.37, { bh: 3.3 }, easeOut],
  [0.45, { bh: 2.6, curl: 0.85, shut: 1 }, easeIn],
  [0.8, { curl: 1 }],
]);
const SLEEP: SpO = { ...B0, bh: 2.3, crouch: 0.55, ab: 0, fang: 0, shut: 1 };
const FALL: SpO = { ...B0, bh: 5.5, crouch: 0.85, fr: 0.2, fang: 0.8 };

// ---- Поза по кадру ---------------------------------------------------------------------

const RUN_N = 8;
const IDLE_N = 8;

/** Поза и фаза хода (−1 — стоит). */
function poseAt(anim: string, f: number): [SpO, number] {
  const t = (f + 0.5) / FPS;
  const at = (keys: PKey<SpO>[]) => sampleKeys(B0, keys, t);
  switch (anim) {
    case 'idle': {
      const p = (f / IDLE_N) * TAU;
      return [{ ...B0, bh: B0.bh + Math.sin(p) * 0.18, ab: B0.ab + Math.sin(p - 0.8) * 0.08, fang: 0.2 + Math.max(0, Math.sin(p * 2)) * 0.3 }, -1];
    }
    case 'run':
      return [{ ...B0, bh: 4.0, bp: -0.05 }, f / RUN_N];
    case 'aim': {
      const o = at(AIM);
      // Дрожь натяга на пике — рисунок, а не дрожь движка.
      if (t > 0.48) o.ab += f % 2 ? 0.06 : -0.04;
      return [o, -1];
    }
    case 'shot':
      return [at(SHOT), -1];
    case 'bite':
      return [at(BITE), -1];
    case 'bitef':
      return [at(BITEF), -1];
    case 'flinch':
      return [at(FLINCH), -1];
    case 'die': {
      const o = at(DIE);
      // Ноги дёргаются, пока поджимаются.
      if (f >= 9 && f <= 16) o.curl -= f % 2 ? 0.18 : 0;
      return [o, -1];
    }
    case 'stun': {
      const p = (f / 6) * TAU;
      return [{ ...B0, bh: 3.6 + Math.sin(p) * 0.3, bp: Math.cos(p) * 0.12, crouch: 1.12, fang: 0.6, ab: 0.05 }, -1];
    }
    case 'sleep':
      return [{ ...SLEEP, bh: SLEEP.bh + (f % 2 ? 0.2 : 0) }, -1];
    case 'alert': {
      const k = clamp01(t / 0.35);
      return [sampleKeys(SLEEP, [[0, {}], [0.35, { ...B0, bh: 5.0, fr: 0.5, fang: 0.9, shut: 0 }, easeOut]], k * 0.35), -1];
    }
    case 'drop': {
      const w = Math.sin((f / 4) * TAU);
      return [{ ...FALL, fr: 0.2 + w * 0.15 }, -1];
    }
  }
  return [B0, -1];
}

// ---- Риг -------------------------------------------------------------------------------

/** Углы ног от курса (передняя → задняя), радиус стопы. */
const LEG_A = [0.42, 1.08, 1.85, 2.5];
const L1 = 7.4;
const L2 = 9.0;

interface SpJ {
  B: F3;
  C: F3;
  A: F3;
  head: V3;
  spin: V3;
  eye: V3;
}

/** Рамки тела: головогрудь C, брюшко A. */
function spJoints(o: SpO, yaw: number): SpJ {
  const B = F3.yaw(yaw);
  const C = B.at(o.fx, 0, o.bh).roll(o.flip).pitch(-o.bp);
  const A = C.at(-1.6, 0, 0.5).pitch(o.ab);
  return {
    B,
    C,
    A,
    head: C.p(2.6, 0, 0.3),
    spin: A.p(-9.6, 0, 0.2),
    eye: C.p(4.9, 0, 1.0),
  };
}

function spRig(r: Rig, o: SpO, ph: number, yaw: number, dead: boolean): SpJ {
  const J = spJoints(o, yaw);
  const { B, C, A } = J;
  // Брюшко и головогрудь.
  r.ell(A, [-4.8, 0, 0], [5.2, 4.4, 3.8], ABD);
  r.ell(C, [0.9, 0, 0], [3.8, 3.2, 2.6], CEPH);
  // Лицо: глаза (два главных и четыре малых), рот с хелицерами.
  const eC = dead || o.shut > 0.5 ? BODY.T[0] : EYE;
  const glow = dead || o.shut > 0.5 ? 0 : 1;
  for (const s of [-1, 1]) {
    r.dot(C.p(4.5, s * 0.95, 1.0), eC, glow, 1, 0.8);
    r.dot(C.p(4.1, s * 1.9, 1.6), eC, glow, 1, 0.8);
    r.dot(C.p(3.9, s * 0.6, 2.2), eC, glow * 0.6, 1, 0.8);
    // Хелицеры: тёмные, клыки светлые, раскрываются в стороны.
    const base = C.p(4.4, s * 0.7, -0.7);
    const tip = C.p(5.1 + o.fang * 0.4, s * (0.5 + o.fang * 1.1), -2.5 + o.fang * 0.5);
    r.cap(base, tip, 0.55, 0.35, LEG);
    r.dot(tip, FANG, 0, 1, 0.9);
  }
  r.dot(C.p(4.6, 0, 0.1), MARK, 0, 1, 0.8);
  r.eye = dead ? null : J.eye;

  // Ноги: две четвёрки (L1 R2 L3 R4 и R1 L2 R3 L4) — опора едет назад, мах — дугой.
  const R0 = 11.6 * o.crouch;
  const STRIDE = 3.4;
  const UP = 2.4;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hip = C.p(1.5 - i * 0.85, s * 1.9, -0.2);
      const a = LEG_A[i];
      let foot = B.p(o.fx * 0.3 + Math.cos(a) * R0, s * Math.sin(a) * R0, 0);
      if (ph >= 0) {
        const g = (i + (s > 0 ? 1 : 0)) % 2;
        const q = (((ph + g * 0.5) % 1) + 1) % 1;
        if (q < 0.5) foot = vadd(foot, B.v(STRIDE / 2 - STRIDE * (q / 0.5), 0, 0));
        else {
          const k = (q - 0.5) / 0.5;
          foot = vadd(foot, B.v(-STRIDE / 2 + STRIDE * k, 0, Math.sin(PI * k) * UP));
        }
      }
      // Передние ноги вскинуты (угроза, укус), вторая пара — наполовину.
      const raise = i === 0 ? o.fr : i === 1 ? o.fr * 0.45 : 0;
      if (raise > 0) foot = vlerp(foot, C.p(5.5 - i * 1.5, s * (4.6 + i), 5.2 - i * 1.2), raise);
      // Смерть: ноги поджимаются к брюху (после переворота оно сверху).
      if (o.curl > 0) foot = vlerp(foot, C.p(1.2 - i * 0.9, s * 2.4, -4.2), clamp01(o.curl));
      const pole = vadd(C.u, vmul(C.s, s * 0.45));
      const knee = ik(hip, foot, L1, L2, pole);
      r.cap(hip, knee, 0.6, 0.42, LEG);
      r.cap(knee, foot, 0.4, 0.16, LEG);
      r.dot(knee, MARK, 0, 1, 0.9);
    }
  }
  return J;
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_spider', 64, 50, 32, 34, 1500);

function spiderPic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [o, ph] = poseAt(anim, f);
  const dead = anim === 'die' && f > 9;
  const r = new Rig();
  const J = spRig(r, o, ph, yaw, dead);
  return draw(K, r, (p, lit, P) => {
    // Бородавки: свечение набора и вспышка выстрела.
    const glow = anim === 'aim' ? o.spin : anim === 'shot' && f <= 2 ? 1 : 0;
    if (glow > 0) {
      const [sx, sy] = P(J.spin);
      const L = lit();
      const c = alphaC(hx('#ff9ad0'), 0.4 + 0.6 * glow);
      L.set(Math.floor(sx), Math.floor(sy), hx('#ffffff'));
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        L.set(Math.floor(sx) + dx, Math.floor(sy) + dy, c);
    }
    if (anim === 'shot' && f <= 3) {
      // Нить уходит вперёд от бородавок — дальше её держит зона `f8_thread`.
      const [sx, sy] = P(J.spin);
      const [tx, ty] = P(vadd(J.spin, J.B.v(14 + f * 4, 0, -J.spin[2] * 0.8)));
      seg2(lit(), sx, sy, tx, ty, alphaC(SILK, 1 - f * 0.22));
      seg2(p, sx, sy, tx, ty, alphaC(SILK, 0.8 - f * 0.18));
    }
    if (anim === 'drop') {
      // Спускается на нити со свода: нить из бородавок вверх до края холста.
      const [sx, sy] = P(J.spin);
      seg2(p, sx, sy, sx, 0, alphaC(SILK, 0.7));
    }
    if (anim === 'stun') {
      const [hxp, hyp] = P(J.C.p(1, 0, 4));
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = Math.floor(hxp + Math.cos(a) * 5);
        const y = Math.floor(hyp - 2 + Math.sin(a) * 1.6);
        lit().set(x, y, hx('#fff27a'));
        p.set(x, y, hx('#ffffff'));
      }
    }
    if (anim === 'die' && f >= 7 && f <= 11) {
      // Удар спиной об пол — серая пыль в стороны.
      const k = (f - 7) / 4;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + hash(i, 3);
        const [bx, by] = P(J.B.p(Math.cos(a) * (4 + k * 6), Math.sin(a) * (4 + k * 6), 0.5 + k));
        p.set(Math.floor(bx), Math.floor(by), alphaC(hx('#8a8090'), 0.8 - k * 0.6));
      }
    }
  });
}

registerMobPainter('f8_spider', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, md === 'aim' ? 20 : 12);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 6 * (1 - sstep(0.5, 0.8, t));
    ex.still = true;
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 14);
    ex.still = true;
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 10);
    ex.still = true;
  } else if (md === 'recover') {
    anim = v.prev === 'aim' ? 'shot' : 'bitef';
    f = fi(t, 16);
    if (anim === 'bitef' && f <= 1) {
      ex.sx = 1.08;
      ex.sy = 0.93;
    }
    ex.still = true;
  } else if (md === 'stun') {
    if (v.prev === 'drop' && t < 0.12) {
      anim = 'bitef';
      f = 1;
      ex.sx = 1.18 - t;
      ex.sy = 0.82 + t;
    } else {
      anim = 'stun';
      f = mod(now * 16, 6);
    }
  } else if (md === 'drop') {
    anim = 'drop';
    f = mod(now * 8 + id, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = mod(now * 1.2 + hash(id, 3) * 2, 2);
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else if (hurtF(v, now) >= 0 && !moving(m)) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'run';
    // Шаг — по пройденному пути: цикл 0,75 клетки.
    f = mod((v.dist / 0.75) * RUN_N, RUN_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 5, IDLE_N);
  }
  if (md === 'f8_out') ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(K, anim, f, d, pose, () => spiderPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_spider', function* () {
  yield* warmAll(
    K,
    [
      ['run', RUN_N],
      ['idle', IDLE_N],
      ['aim', 15],
      ['shot', 17],
      ['bite', 11],
      ['bitef', 17],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
      ['drop', 4],
    ],
    spiderPic,
  );
});
