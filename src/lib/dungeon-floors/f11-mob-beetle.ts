// Жук-копилка (анимации мобов 11): золотой панцирь-копилка со щелью наверху,
// из щели торчит монета; голова и грудь — тёмная синяя сталь, жёлтые глазки,
// усики с золотыми булавами, шесть лапок. Мини-3D (`f15-rig.ts`), 8 сторон
// честно, 24 к/с.
//
// Метроном — `f11-brains.ts` (`f11_beetle`): только удирает (`flee`) — от героя,
// по течению и по ветру, 5,2 клетки/с; каждый удар — `stun` (0,2 с) и монеты
// из щели; через 20 с — `escape` (0,4 с, мир держит его 0,4 с), раскрывает
// надкрылья и улетает. Из норы (`emerge`) — выползает из темноты.
// - бег — трёхопорная походка по пройденному пути (цикл на 1,1 клетки),
//   панцирь подпрыгивает, монета в щели звякает, усики отстают;
// - удар — подбросило и повело набок, лапки вразлёт, две монеты выскакивают;
// - побег — надкрылья приоткрываются, крылья гудят, взлетает и тает;
// - смерть 0,9 с — подскок, переворот на спину, лапки дрыгаются, панцирь
//   трескается и монеты брызжут веером; лапки поджаты.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  WHITE,
  alpha,
  clamp01,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  gait,
  hash,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  leg,
  moving,
  put,
  spark2,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RGBA, Tones, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const SHELL = tn('#7a4814', '#b07226', '#d8983a', '#f2c46e');
const COIN = tn('#b88a18', '#f4c838', '#ffe878', '#fffbe0');
const BLUE = tn('#101a26', '#1a2a3a', '#2a4a6a', '#4a6e94');
const EYE = hx('#ffd040');
const WING: Tones = [
  hx('#b8d0ea', 110),
  hx('#d0e2f6', 130),
  hx('#e8f2ff', 150),
  hx('#ffffff', 170),
];
const SLOT = hx('#2e1e06');
const GLINT: RGBA[] = [hx('#fffbe0'), hx('#ffd860'), hx('#ffffff')];
const COINS: RGBA[] = [hx('#ffd860'), hx('#e0aa30'), hx('#fffbe0'), hx('#c29434')];

// ---- Поза --------------------------------------------------------------------

interface BtO {
  /** Подъём корпуса, наклон (+ нос вниз), крен, переворот на спину 0…1. */
  lift: number;
  pitch: number;
  roll: number;
  flip: number;
  /** Шаг: фаза и доля; лапки вразлёт 0…1, поджаты 0…1, дрыг (фаза). */
  ph: number;
  step: number;
  splay: number;
  curl: number;
  kick: number;
  /** Надкрылья приоткрыты 0…1, взмах крыла (−1…1), крылья есть. */
  open: number;
  flap: number;
  wings: boolean;
  /** Монета в щели: сдвиг вверх; нет её (выскочила). */
  coin: number;
  noCoin: boolean;
  /** Панцирь треснул 0…1. */
  crack: number;
  /** Усики отстают: вперёд-назад и вверх-вниз; подёргивание (левый вверх, правый вниз). */
  ant: [number, number];
  tw: number;
}

const B0: BtO = {
  lift: 0,
  pitch: 0,
  roll: 0,
  flip: 0,
  ph: 0,
  step: 0,
  splay: 0,
  curl: 0,
  kick: 0,
  open: 0,
  flap: 0,
  wings: false,
  coin: 0,
  noCoin: false,
  crack: 0,
  ant: [0, 0],
  tw: 0,
};

const BS = 1;
const BODY_H = 2.8;
/** Панцирь: центр от таза и полуоси. */
const SH_C: V3 = [-0.6, 0, 1.8];
const SH_R: V3 = [5.6, 4.4, 3.4];
const COIN_X = SH_C[0] + 0.08 * SH_R[0];
const COIN_UP = 0.9;
const LEG_F = [2.4, 0.3, -2.0];
const FOOT_F = [4.8, 0.6, -3.8];
/** Шаг: вынос ступни ±2 пикселя, цикл — 0,75 клетки (ступни почти не скользят). */
const STRIDE = 4.0;
const CYCLE = 0.75;

const shellMat = (crack: number): Mat => ({
  T: SHELL,
  spec: true,
  pat: (q, l) => {
    // Щель копилки вдоль хребта (монета стоит в ней).
    if (Math.abs(q[1]) < 0.1 && q[0] > -0.3 && q[0] < 0.45 && q[2] > 0.6) return SLOT;
    // Шов надкрылий — от щели назад.
    if (q[0] < -0.3 && Math.abs(q[1]) < 0.055 && q[2] > 0.2) return SHELL[0];
    // Кант по краю.
    if (Math.abs(q[2] - 0.1) < 0.06) return l > 0.5 ? SHELL[1] : SHELL[0];
    if (crack > 0) {
      // Трещина — ломаная от щели вбок.
      const z = Math.abs(q[1] - 0.15 * Math.sin(q[0] * 14) - 0.3 * q[0]);
      if (z < 0.05 * crack && q[2] > 0.2) return SLOT;
    }
    return null;
  },
});

function beetleRig(o: BtO, yaw: number): KRig {
  const r = new KRig(BS);
  const B = F3.yaw(yaw).scale(BS);
  const fl = easeIn(o.flip) * PI;
  let P = B.at(0, 0, BODY_H + o.lift + o.flip * 3.2).pitch(o.pitch);
  P = P.roll(o.roll + fl);
  const up = Math.cos(fl) >= 0 ? 1 : -1;
  const legM: Mat = { T: BLUE, spec: true };
  // Лапки: трёхопорная походка, у перевёрнутого — дрыгаются в воздухе.
  for (let i = 0; i < 3; i++)
    for (const sd of [-1, 1]) {
      const hip = P.p(LEG_F[i], sd * 2.0, 0.2);
      const grp = (i + (sd > 0 ? 1 : 0)) % 2;
      const [off, rise] = gait(o.ph + grp * 0.5);
      let foot = B.p(
        FOOT_F[i] + off * STRIDE * o.step,
        sd * (5.4 + o.splay * 1.6),
        rise * 1.7 * o.step + o.splay * 2.6,
      );
      if (o.flip > 0) {
        const k = Math.sin(o.kick + i * 2.1 + (sd > 0 ? 1.3 : 0));
        const air = P.p(
          FOOT_F[i] * (1 - o.curl * 0.5) + k * 0.9,
          sd * (4.6 - o.curl * 2.2),
          -3.4 + o.curl * 1.8 - Math.abs(k) * 0.6,
        );
        foot = [
          foot[0] + (air[0] - foot[0]) * o.flip,
          foot[1] + (air[1] - foot[1]) * o.flip,
          foot[2] + (air[2] - foot[2]) * o.flip,
        ];
      }
      leg(r, hip, foot, 3.0 * BS, 3.9 * BS, vadd(P.v(0, sd, 0), [0, 0, up]), [0.6, 0.5, 0.4], legM);
    }
  // Брюшко (видно у перевёрнутого), грудь, голова, глазки.
  r.ell(P, [-0.6, 0, 0.9], [5.0, 3.6, 1.5], { T: BLUE, spec: true, bias: -0.1 });
  r.ell(P, [4.2, 0, 1.5], [1.9, 2.8, 1.9], { T: BLUE, spec: true });
  r.ell(P, [6.0, 0, 1.1], [1.4, 1.9, 1.4], { T: BLUE, spec: true, bias: 0.05 });
  for (const sd of [-1, 1]) r.dot(P.p(6.8, sd * 1.3, 1.6), EYE, 0.6, 1, 0.8);
  r.eye = P.p(7.0, 0, 1.6);
  // Усики: от лба вперёд-вверх, булавы золотые.
  for (const sd of [-1, 1]) {
    const a0 = P.p(6.9, sd * 0.8, 1.9);
    const a1 = P.p(9.2 + o.ant[0], sd * 2.6, 4.4 + o.ant[1] - sd * o.tw);
    r.cap(a0, a1, 0.26, 0.22, { T: BLUE, spec: true });
    r.ball(a1, 0.6, { T: COIN, spec: true });
  }
  // Панцирь-копилка; приоткрытые надкрылья — две половины.
  if (o.open > 0.02) {
    for (const sd of [-1, 1]) {
      const E = P.at(SH_C[0] + 2.2, sd * 0.3, SH_C[2] - 0.4)
        .roll(sd * o.open * 0.75)
        .pitch(-o.open * 0.35);
      r.ell(E, [-2.2, 0, 0.4], SH_R, shellMat(0), (q) => q[1] * sd < 0);
    }
    if (o.wings)
      for (const sd of [-1, 1]) {
        const root = P.p(1.6, sd * 1.0, 3.6);
        const fa = o.flap;
        r.poly(
          [
            root,
            P.p(-1.4, sd * (5.0 + 2.2 * fa), 6.6 + 3.4 * fa),
            P.p(-5.6, sd * (8.4 + 1.6 * fa), 5.4 + 4.6 * fa),
            P.p(-6.8, sd * (4.0 + 0.8 * fa), 3.2 + 1.8 * fa),
          ],
          { T: WING, soft: true },
          0.4,
        );
      }
  } else {
    r.ell(P, SH_C, SH_R, shellMat(o.crack));
  }
  // Монета в щели (у перевёрнутого — выпала): всегда лицом к зрителю —
  // в 11 пикселях панциря ребро монеты не читается.
  if (!o.noCoin && o.flip < 0.3 && o.open < 0.3) {
    const C = P.p(COIN_X, 0, SH_C[2] + SH_R[2] + COIN_UP + o.coin);
    r.ell(F3.yaw(0, C), [0, 0, 0], [1.75, 0.45, 1.6], { T: COIN, spec: true, bias: 0.15 });
  }
  return r;
}

// ---- Треки -------------------------------------------------------------------

function runO(f: number): BtO {
  const ph = f / 6;
  const a = ph * TAU;
  return {
    ...B0,
    ph,
    step: 1,
    lift: 0.45 * Math.abs(Math.sin(a)),
    roll: 0.06 * Math.sin(a),
    pitch: 0.05,
    coin: 0.5 * Math.max(0, Math.cos(2 * a)),
    ant: [-1.6 - 0.4 * Math.cos(2 * a), -1.0 + 0.5 * Math.sin(2 * a)],
  };
}

const IDLE_TW = [0, 0.5, 1.4, 0.9, 0, 0, -1.2, -0.5];
const IDLE_COIN = [0, 0, 0, 0, 0.6, 0.25, 0, 0];
function idleO(f: number): BtO {
  // Дышит, усики подёргиваются поочерёдно, монета звякает в щели.
  const a = (f / 8) * TAU;
  return {
    ...B0,
    lift: 0.25 * Math.sin(a),
    pitch: 0.04 * Math.sin(a + 1),
    ant: [0.5 * Math.sin(a), 0.6 * Math.sin(a + 1)],
    tw: IDLE_TW[f],
    coin: IDLE_COIN[f],
  };
}

function hurtO(f: number): BtO {
  // Подбросило, повело набок, лапки вразлёт, монеты выскочили; приземлился.
  const k = [1, 0.85, 0.5, 0.15, 0][Math.min(4, f)];
  return {
    ...B0,
    lift: [1.8, 2.6, 1.8, 0.6, 0][Math.min(4, f)],
    roll: 0.5 * k,
    pitch: -0.25 * k,
    splay: k,
    noCoin: f <= 2,
    ant: [-1.4 * k, 1.6 * k],
  };
}

const FLY_N = 10;
function flyO(f: number): BtO {
  // Надкрылья приоткрылись, крылья гудят, нос вверх, лапки повисли.
  return {
    ...B0,
    open: Math.min(1, (f + 1) / 3),
    wings: f >= 2,
    flap: f % 2 ? 1 : -0.6,
    pitch: -0.3 * Math.min(1, f / 4),
    lift: 0.6 * Math.min(1, f / 3),
    splay: -0.4 * Math.min(1, f / 4),
    ant: [-0.6, 1.2],
  };
}

function dieO(T: number): BtO {
  const f = Math.floor(T * FPS);
  return {
    ...B0,
    lift: trk(T, [
      [0, 0],
      [0.08, 3.4, easeOut],
      [0.24, 0, easeIn],
      [0.3, 0.6],
      [0.36, 0],
    ]),
    flip: trk(T, [
      [0.02, 0],
      [0.24, 1, easeIn],
    ]),
    splay: trk(T, [
      [0, 0],
      [0.06, 1],
      [0.24, 0.4],
    ]),
    kick: f * 1.7,
    curl: trk(T, [
      [0.5, 0],
      [0.82, 1],
    ]),
    crack: T > 0.24 ? 1 : 0,
    noCoin: T > 0.06,
    ant: [
      trk(T, [
        [0, 0],
        [0.08, -1.6],
        [0.3, 1.0],
        [0.6, -0.4],
      ]),
      trk(T, [
        [0, 0],
        [0.24, -1.4],
        [0.6, -0.6],
      ]),
    ],
  };
}

function beetlePose(anim: string, f: number): BtO {
  switch (anim) {
    case 'run':
      return runO(f);
    case 'idle':
      return idleO(f);
    case 'hurt':
      return hurtO(f);
    case 'fly':
      return flyO(f);
    case 'die':
      return dieO((f + 0.5) / FPS);
  }
  return { ...B0 };
}

// ---- Кадр --------------------------------------------------------------------

const BT = kindOf('beetle', 48, 40, 24, 28, 800);

const beetlePic = (anim: string, f: number, d: number): Pic => {
  const g = beetlePose(anim, f);
  const yaw = yawN(d);
  return draw(BT, beetleRig(g, yaw), (o, P2) => {
    const B = F3.yaw(yaw).scale(BS);
    const P = B.at(0, 0, BODY_H + g.lift);
    const top = P2(P.p(SH_C[0] + 0.12 * SH_R[0], 0, SH_C[2] + SH_R[2] + 0.4));
    if (anim === 'idle' || anim === 'run') {
      // Блик золота бежит по панцирю.
      const k = anim === 'idle' ? f / 8 : f / 6;
      const sx = SH_C[0] + SH_R[0] * (0.55 - 1.1 * k);
      const q = P2(P.p(sx, -1.2, SH_C[2] + SH_R[2] * 0.8));
      if (o.p.get(Math.round(q[0]), Math.round(q[1]))[3]) o.p.set(q[0], q[1], WHITE);
      // Блик на монете — сверху слева.
      const c = P.p(COIN_X, 0, SH_C[2] + SH_R[2] + COIN_UP + g.coin);
      const cg = P2([c[0] - 0.6, c[1], c[2] + 0.7]);
      if (o.p.get(Math.round(cg[0]), Math.round(cg[1]))[3]) o.p.set(cg[0], cg[1], GLINT[0]);
    }
    if (anim === 'hurt' && f <= 3) {
      // Две монеты выскочили из щели — дугой в стороны.
      for (const sd of [-1, 1]) {
        const k = (f + 1) / 4;
        const x = top[0] + sd * 5 * k;
        const y = top[1] - 7 * Math.sin(PI * Math.min(1, k * 1.1)) + k * k * 3;
        spark2(o, Math.round(x), Math.round(y), COINS[0], 0.6);
        spark2(o, Math.round(x) + 1, Math.round(y), COINS[1], 0.4);
        o.p.set(Math.round(x), Math.round(y) - 1, GLINT[0]);
      }
      if (f === 0) spark2(o, top[0], top[1] - 1, WHITE, 1);
    }
    if (anim === 'fly' && g.wings) {
      // Гул крыльев: дуги-смазы по бокам.
      for (const sd of [-1, 1]) {
        const q = P2(P.p(-2.4, sd * 6.4, 6.4));
        for (let i = -2; i <= 2; i++)
          o.p.set(
            Math.round(q[0] + i),
            Math.round(q[1] - Math.abs(i) * 0.6 + (f % 2)),
            alpha(WHITE, 0.35),
          );
      }
    }
    if (anim === 'die' && f >= 5 && f <= 18) {
      // Панцирь треснул — монеты брызжут веером и падают.
      const k = (f - 4) / 14;
      const c = P2(P.p(0, 0, 2.6));
      for (let i = 0; i < 9; i++) {
        const a = -PI / 2 + (hash(i, 1, 97) - 0.5) * 2.6;
        const v = 6 + 7 * hash(i, 2, 97);
        const t = Math.min(k * 1.3, 1);
        const x = c[0] + Math.cos(a) * v * t * 1.4;
        const y = c[1] + Math.sin(a) * v * t * 1.6 + 16 * t * t;
        const yy = Math.min(y, c[1] + 6 + hash(i, 3, 97) * 4);
        o.p.set(Math.round(x), Math.round(yy), COINS[i % 4]);
        if (i % 3 === 0) o.p.set(Math.round(x) + 1, Math.round(yy), COINS[(i + 1) % 4]);
      }
      if (f <= 7) spray(o.p, c[0], c[1] - 2, 7, 6, (f - 4) / 3, 99, GLINT, 2, 3);
    }
  });
};

const HEAD = new WeakMap<Mob, number>();

registerMobPainter('f11_beetle', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const mv = moving(m, 0.3);
  // Курс — по бегу; сбитый ударом и в полёте — прежний.
  if (mv && md !== 'stun' && md !== 'dying' && md !== 'escape')
    HEAD.set(m, Math.atan2(m.vy ?? 0, m.vx ?? 0));
  const want = HEAD.get(m) ?? m.face ?? 0;
  const v = visOf(m, pose, want, md === 'dying' || md === 'escape' ? 0 : 16);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.76, 0.9, t);
    ex.still = true;
    const th = clamp01((t - 0.22) / 0.08);
    if (th > 0 && th < 1) {
      ex.sx = 1 + 0.12 * Math.sin(PI * th);
      ex.sy = 1 - 0.14 * Math.sin(PI * th);
    }
  } else if (md === 'escape') {
    // Мир держит его 0,4 с: взлёт, уменьшается и тает.
    f = fi(t, FLY_N - 1);
    anim = 'fly';
    ex.still = true;
    const k = clamp01(t / 0.4);
    ex.dy = -16 * easeIn(k) - 2 * Math.min(1, k * 4);
    ex.sx = 1 - 0.25 * k;
    ex.sy = 1 - 0.25 * k;
    ex.alpha = 1 - sstep(0.25, 0.4, t);
    ex.shadow = 5 * (1 - 0.6 * k);
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    const a = md === 'stun' && hurtAge(v, now) > 0.2 ? t : hurtAge(v, now);
    f = fi(a, 4);
    anim = 'hurt';
  } else if (mv) {
    f = Math.floor((v.dist / CYCLE) * 6) % 6;
    anim = 'run';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 6) % 8;
    anim = 'idle';
  }
  if (md === 'emerge') {
    dark = 3 - Math.min(3, Math.floor(clamp01(t / 0.45) * 4));
    if (dark > 0) {
      f = Math.floor((v.dist / CYCLE) * 6) % 6;
      anim = 'run';
    }
  }
  if (md !== 'dying' && md !== 'escape') hurtFx(v, now, 1.4, ex);
  return put(
    frameOf(BT, anim, f, d, pose, (dd) => beetlePic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_beetle', function* () {
  yield* warmAll(
    BT,
    [
      ['run', 6],
      ['idle', 8],
      ['hurt', 5],
      ['fly', FLY_N],
      ['die', 22],
    ],
    beetlePic,
  );
  // Из норы — бег из темноты, три ступени.
  for (const dk of [1, 2, 3])
    yield* warmAll(BT, [['run', 6]], beetlePic, ['normal'], undefined, dk);
});
