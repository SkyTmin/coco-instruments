// Этаж 9 — топь: болотный огонь, корневая хваталка, пиявка (анимации мобов 9).
//
// Болотный огонь: без ног, пламя — вторичное движение: языки отстают от
// хода и отклоняются назад, мерцают своей фазой. Проявление — искра,
// вспыхнула, развернулась; вспышка холода — вдох (сжался, ядро
// побелело) → раздулся → разрыв в кадр урона; угасание — чадит, дым, нет.
// Корневая хваталка: из-под трясины — бугор с рябью и кончиками корней;
// хватка — бугор пухнет, корни лезут наружу; выход — рывком из грязи с
// брызгами (сцена в начале `up`); хлёст корнем в кадр урона; уход —
// оседает, корни втягиваются последними. Пиявка: бесформенная, сторон нет
// (один рисунок на все курсы): ползёт волной сжатия-растяжения, прыжок
// из воды — комком по дуге, присосалась — пульсирует и наливается.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig } from './f15-rig';
import type { Mat, V3 } from './f15-rig';
import {
  INK,
  PI,
  TAU,
  camSide,
  clamp01,
  dirN,
  drawRig,
  easeIn,
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
import type { Pic } from './f9-mobkit';

// ===========================================================================
// Болотный огонь
// ===========================================================================

const FL_OUT = tn('#0e4a44', '#1a8a7a', '#4ad8b0', '#b8ffe8');
const FL_IN = tn('#4ad8b0', '#8af0d0', '#b8ffe8', '#ffffff');
const FL_HOT = tn('#b8ffe8', '#e0fff4', '#ffffff', '#ffffff');
const CORE = tn('#060e10', '#0e2a2c', '#1a3e40', '#2a5a5a');
const W_EYE = hx('#e8fff8');
const SPARK = hx('#e0fff0');
const SMOKE = hx('#5a6a68', 200);

interface WispO {
  /** Размер, наклон пламени назад (ход), вбок (удар), мерцание. */
  k: number;
  lean: number;
  side: number;
  fl: number;
  /** Жар: 0 обычный … 1 добела; ядро видно; глаза; искры; дым. */
  hot: number;
  core: number;
  eyes: number;
  spark: number;
  smoke: number;
  /** Только искра (появление) / разлёт (смерть). */
  ember: number;
  burst: number;
}

const WO: WispO = {
  k: 1,
  lean: 0,
  side: 0,
  fl: 0,
  hot: 0,
  core: 1,
  eyes: 1,
  spark: 0.3,
  smoke: 0,
  ember: 0,
  burst: 0,
};

function wispRig(o: WispO, yaw: number): Rig {
  const r = new Rig();
  const F = F3.yaw(yaw);
  const k = o.k * 1.45;
  if (o.ember > 0) {
    // Одна искра поднимается из воды.
    r.dot(F.p(0, 0, 1 + o.ember * 3), SPARK, 1, 1, 1);
    r.dot(F.p(0, 0, o.ember * 3), FL_OUT[2], 1, 1, 1);
    return r;
  }
  const out_: Mat = { T: o.hot > 0.6 ? FL_HOT : FL_OUT, glow: 0.85, soft: true, bias: 0.15 };
  const in_: Mat = { T: o.hot > 0.3 ? FL_HOT : FL_IN, glow: 1, soft: true, bias: 0.3 };
  // Ось пламени гнётся назад от хода и вбок от удара.
  const tip = (z: number): V3 => F.p(-o.lean * z * 0.35, o.side * z * 0.3, z);
  // Капля пламени: шар внизу и язык вверх, кончик мечется и отстаёт от хода.
  const top = (h: number, ph: number): V3 =>
    F.p(
      -o.lean * h * 0.4 + Math.sin(ph) * 0.7 * k,
      o.side * h * 0.3 + Math.cos(ph * 1.3) * 0.5 * k,
      h,
    );
  const c0 = tip(3.0 * k);
  r.ell(F3.yaw(yaw, c0), [0, 0, 0], [3.0 * k, 3.0 * k, 3.0 * k], out_);
  r.cap(
    c0,
    top((9 + 1.4 * Math.sin(o.fl * 1.7)) * k * (1 + o.hot * 0.3), o.fl),
    2.9 * k,
    0.3,
    out_,
  );
  r.ell(F3.yaw(yaw, tip(2.8 * k)), [0, 0, 0], [2.0 * k, 2.0 * k, 2.1 * k], in_);
  r.cap(tip(2.8 * k), top((6.4 + Math.sin(o.fl * 2.1)) * k, o.fl + 1), 1.9 * k, 0.3, in_);
  // Боковые языки — каждый своей фазой.
  for (const sd of [-1, 1]) {
    const ph = o.fl * 1.4 + (sd > 0 ? 0 : 2.3);
    const b = vadd(c0, F.v(-0.3 * k, sd * 1.9 * k, 0.8 * k));
    const e = vadd(
      b,
      F.v(
        -o.lean * 2.2,
        sd * (1.0 + 0.5 * Math.sin(ph)) * k + o.side * 1.5,
        (3.2 + 1.3 * Math.sin(ph)) * k,
      ),
    );
    r.cap(b, e, 1.1 * k, 0.2, out_);
  }
  // Хвост пламени снизу — висит и отстаёт.
  r.cap(
    tip(0.6),
    F.p(-o.lean * 1.6, o.side * 1.2, -1.6 * k - Math.sin(o.fl * 0.5) * 0.4),
    1.6 * k,
    0.3,
    out_,
  );
  // Тёмное ядро с глазами — выглядывает из пламени по ходу (лицо огня;
  // внутри шара его не было бы видно).
  // Лицо смотрит к зрителю и чуть в сторону хода (как прежний огонь).
  const fy = PI / 2 + 0.6 * Math.sin(yaw - PI / 2);
  const FF = F3.yaw(fy, c0);
  let eye: V3 | null = null;
  if (o.core > 0.05) {
    const c = o.core;
    const C = FF.at(1.75 * k, 0, 1.3 * k).pitch(-0.5);
    r.ell(C, [0, 0, 0], [1.5 * k * c, 1.7 * k * c, 1.6 * k * c], { T: CORE, bias: -0.2 });
    if (o.eyes > 0.5)
      for (const sd of [-1, 1]) r.dot(C.p(1.45 * k * c, sd * 0.75 * k, 0.25 * k), W_EYE, 1, 1, 1.2);
    eye = C.p(1.45 * k * c, 0, 0.25 * k);
  }
  r.eye = o.eyes > 0.5 ? eye : null;
  // Искры кружат и поднимаются.
  for (let i = 0; i < 5 && o.spark > 0; i++) {
    const a = o.fl * 0.6 + (i / 5) * TAU;
    const R = (3.6 + (i % 2)) * k;
    const z = (1 + ((i * 3.1 + o.fl) % 8)) * k;
    if (hash(i, 7) < o.spark)
      r.dot(F.p(Math.cos(a) * R - o.lean * 2, Math.sin(a) * R, z), SPARK, 1, 1, 1);
  }
  // Дым угасания.
  for (let i = 0; i < 4 && o.smoke > 0; i++)
    r.dot(F.p(-0.5 + (i % 2), (i - 1.5) * 0.8, 6 + o.smoke * (4 + i * 2)), SMOKE, 0, 1, 0.5);
  if (o.burst > 0) r.explode(o.burst, F.p(0, 0, 3), 5, 12, 6, 0, 0.7);
  return r;
}

function wispPose(anim: string, f: number): WispO {
  const o: WispO = { ...WO };
  const t = f / 24;
  switch (anim) {
    case 'float':
    case 'drift': {
      // 8 кадров по 10 к/с: языки мерцают; в ходу — пламя назад.
      o.fl = (f / 8) * TAU;
      o.k = 1 + 0.04 * Math.sin(o.fl * 2);
      o.lean = anim === 'drift' ? 1 : 0;
      o.spark = 0.5;
      break;
    }
    case 'fadein': {
      // Проявление 0,7 с: искра поднимается (до 0,15) → вспыхнула →
      // разворачивается (до 0,55) → глаза открылись.
      if (t < 0.15) {
        o.ember = t / 0.15;
        break;
      }
      o.k = trk(t, [
        [0.15, 0.25],
        [0.22, 0.7, easeOut],
        [0.3, 0.55],
        [0.6, 1.08],
        [0.7, 1],
      ]);
      o.hot = trk(t, [
        [0.15, 1],
        [0.3, 0.2],
      ]);
      o.core = trk(t, [
        [0.3, 0],
        [0.55, 1],
      ]);
      o.eyes = t > 0.55 ? 1 : 0;
      o.fl = t * 26;
      o.spark = trk(t, [
        [0.15, 1],
        [0.5, 0.3],
      ]);
      break;
    }
    case 'flare': {
      // Вспышка 0,7 с (17 кадров): вдох — сжался, ядро белеет (до 0,35) →
      // раздувается (до 0,62) → разрыв в кадр урона (16-й).
      o.k = trk(t, [
        [0, 1],
        [0.35, 0.72, easeOut],
        [0.62, 1.3, easeIn],
        [0.66, 1.65, easeOut],
      ]);
      o.hot = trk(t, [
        [0, 0],
        [0.35, 0.5],
        [0.6, 0.7],
        [0.66, 1],
      ]);
      o.core = trk(t, [
        [0, 1],
        [0.35, 0.7],
        [0.62, 0.4],
        [0.66, 0],
      ]);
      o.fl = t * 40;
      o.spark = trk(t, [
        [0, 0.3],
        [0.35, 0],
        [0.6, 1],
      ]);
      o.eyes = t < 0.62 ? 1 : 0;
      break;
    }
    case 'fade': {
      // Угасание 0,6 с: чадит, съёживается, дым — исчез.
      o.k = trk(t, [
        [0, 1.4],
        [0.1, 0.9, easeOut],
        [0.55, 0.25],
      ]);
      o.hot = trk(t, [
        [0, 0.8],
        [0.12, 0],
      ]);
      o.core = trk(t, [
        [0.05, 0.5],
        [0.3, 1],
        [0.55, 0.6],
      ]);
      o.eyes = t > 0.12 && t < 0.35 ? 1 : 0;
      o.smoke = trk(t, [
        [0.1, 0],
        [0.6, 1],
      ]);
      o.fl = t * 30;
      o.spark = 0;
      o.lean = Math.sin(t * 30) * 0.3;
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.side = 1.4 * b;
      o.k = 1 - 0.15 * b;
      o.eyes = b > 0.3 ? 0 : 1;
      o.fl = f * 1.3;
      o.hot = 0.3 * b;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: вскинулось белым (до 0,12) → рвётся искрами (до 0,5)
      // → дымок.
      o.k = trk(t, [
        [0, 1],
        [0.12, 1.45, easeOut],
      ]);
      o.hot = trk(t, [
        [0, 0.6],
        [0.12, 1],
      ]);
      o.core = trk(t, [
        [0, 1],
        [0.12, 0],
      ]);
      o.eyes = 0;
      o.fl = t * 30;
      o.burst = trk(t, [
        [0.12, 0],
        [0.55, 1, easeOut],
      ]);
      o.smoke = trk(t, [
        [0.3, 0],
        [0.87, 1],
      ]);
      break;
    }
  }
  return o;
}

const WISP = kindOf('f9_wisp', 56, 60, 28, 40, 900, 1.3);
const wispPic = (anim: string, f: number, d: number): Pic =>
  drawRig(WISP, wispRig(wispPose(anim, f), yawN(d)), 0, null);

registerMobPainter('f9_wisp', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, moving(m, 0.3) && md === 'chase' ? headOf(m, 0.3) : (m.face ?? 0), 5);
  // Парит сам: подъём и покачивание — сдвигом (кадр «стоит»).
  const bob = Math.round(Math.sin(now * 2.3 + id) * 1.5);
  const ex: Partial<MobFrame> = { shadow: 3, still: true, lift: 8, dy: bob };
  let anim = 'float';
  let f = mod((now + hash(id, 9) * 3) * 10, 8);
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.6, 0.9, t);
  } else if (md === 'f9_fadein') {
    anim = 'fadein';
    f = fi(t, 16);
    ex.alpha = clamp01(0.35 + t / 0.5);
    ex.shadow = t < 0.3 ? 1 : 3;
  } else if (md === 'flare') {
    anim = 'flare';
    f = fi(t, 16);
    ex.shadow = 3 + clamp01(t / 0.66) * 2;
  } else if (md === 'fade') {
    anim = 'fade';
    f = fi(t, 14);
    ex.alpha = 1 - sstep(0.3, 0.6, t);
  } else if (hurtAge(v, now) >= 0 || md === 'stun') {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
  } else if (moving(m, 0.5)) anim = 'drift';
  if (md !== 'dying') hurtFields(v, now, ex, 0.5);
  const d = dirN(v.yaw);
  return out(
    frameOf(WISP, anim, f, d, pose.look, () => wispPic(anim, f, d)),
    ex,
    pose.flash,
  );
});

// ===========================================================================
// Корневая хваталка
// ===========================================================================

const BARK = tn('#1e140a', '#3e2a16', '#664628', '#8e6a3e');
const YOUNG = tn('#2a2a0e', '#4e5a1a', '#768a2a', '#a0b44a');
const MUD = tn('#1a1a0c', '#2e3014', '#46481e', '#5e622a');
const KNOT = tn('#8a4a10', '#d07a20', '#ffb040', '#fff0b0');
const RIPPLE = hx('#8a9a4a');
const MUD_DROP = hx('#46481e');

const BARK_M: Mat = {
  T: BARK,
  // Волокна коры вдоль ствола и тёмные трещины.
  pat: (q, l) => {
    const a = Math.floor(Math.atan2(q[2], q[1]) * 2.6 + 20);
    const h = hash(a, Math.floor(q[0] * 3), 4);
    if (h > 0.82) return BARK[0];
    if (l > 0.6 && h < 0.1) return BARK[3];
    return null;
  },
};
const BARK_FAR: Mat = { T: BARK, bias: -0.15 };
const YOUNG_M: Mat = { T: YOUNG };
const MUD_M: Mat = { T: MUD, bias: -0.1 };

interface RootO {
  /** Высота над трясиной 0…1 (1 — встал), бугор грязи. */
  h: number;
  mound: number;
  /** Наклон ствола (+ вперёд), качание. */
  lean: number;
  sway: number;
  /** Корни-руки: правый — хлёст (заброс 0…1, удар 0…1), левый — качание. */
  back: number;
  lash: number;
  curl: number;
  /** Глаз-сучок: свет; рябь; брызги; разлом. */
  knot: number;
  ripple: number;
  splash: number;
  wilt: number;
  chips: number;
}

const R0: RootO = {
  h: 1,
  mound: 0,
  lean: 0.1,
  sway: 0,
  back: 0,
  lash: 0,
  curl: 0,
  knot: 0.7,
  ripple: 0,
  splash: 0,
  wilt: 0,
  chips: 0,
};

function rootRig(o: RootO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const cs = camSide(yaw);
  const h = o.h;
  // Лужа трясины у основания, рябь кольцом.
  r.ell(B, [0, 0, 0.25], [5.6, 5.6, 0.3 + o.mound * 1.6], MUD_M);
  if (o.ripple > 0)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const R = 4.5 + o.ripple * 3.5;
      r.dot(B.p(Math.cos(a) * R, Math.sin(a) * R, 0.4), RIPPLE, 0, 1, 0.2);
    }
  // Корни по земле — веером.
  for (let i = 0; i < 5 && h > 0.25; i++) {
    const a = (i / 5) * TAU + 0.5;
    // Клубок: корни расходятся широко и выгибаются над трясиной.
    const L = (6.2 + (i % 2) * 1.2) * Math.min(1, h);
    const M = B.p(Math.cos(a) * L * 0.55, Math.sin(a) * L * 0.55, 1.6);
    r.cap(B.p(Math.cos(a) * 1.6, Math.sin(a) * 1.6, 1.2), M, 1.4, 0.9, BARK_FAR);
    r.cap(M, B.p(Math.cos(a) * L, Math.sin(a) * L, 0.4), 0.9, 0.35, BARK_FAR);
  }
  if (h > 0.02) {
    // Ствол — три колена, с наклоном и качанием (верх отстаёт).
    const H = 11.5 * h;
    const P0 = B.p(0, 0, 0.3);
    const P1 = B.p(o.lean * 1.2 + o.sway * 0.4, o.sway * 0.6, H * 0.4);
    const P2 = B.p(o.lean * 2.6 + o.sway * 1.0, o.sway * 1.4 - o.wilt * 1.0, H * 0.75);
    const P3 = B.p(
      o.lean * 3.4 + o.sway * 1.6 - o.wilt * 2.4,
      o.sway * 2.0 - o.wilt * 2.0,
      H * (1 - o.wilt * 0.35),
    );
    r.cap(P0, P1, 4.2, 3.4, BARK_M);
    r.cap(P1, P2, 3.4, 2.7, BARK_M);
    r.cap(P2, P3, 2.7, 1.7, BARK_M);
    // Побеги на макушке.
    for (let i = 0; i < 3; i++)
      r.spike(
        vadd(P3, B.v(-0.4 + i * 0.4, (i - 1) * 0.9, 0.6)),
        B.v(-0.3 - o.wilt, (i - 1) * 0.6, 1 - o.wilt * 1.4),
        2.2 * h,
        0.5,
        YOUNG_M,
        3,
      );
    // Глаз-сучок спереди и сучок поменьше.
    const kc = KNOT;
    const kg = clamp01(o.knot);
    r.ball(B.p(o.lean * 2.6 + o.sway + 2.5, o.sway * 1.4, H * 0.66), 1.6, {
      T: kc,
      glow: kg,
      bias: 0.2,
    });
    r.dot(B.p(o.lean * 1.6 + 2.6, 1.0, H * 0.45), KNOT[1], kg * 0.6, 1, 1);
    r.eye = kg > 0.2 ? B.p(o.lean * 2.6 + o.sway + 3.9, o.sway * 1.4, H * 0.68) : null;
    // Руки-корни: с плеч, по четыре звена, кончик — коготь.
    for (const sd of [-1, 1]) {
      const S = B.p(o.lean * 2.2 + o.sway * 0.8, sd * 2.2 + o.sway, H * 0.7);
      const strike = sd > 0;
      let prev = S;
      for (let i = 1; i <= 4; i++) {
        const k = i / 4;
        // Хлёст: заброс назад-вверх, удар вперёд-вниз; звенья отстают.
        const bk = strike ? o.back : 0;
        const ls = strike ? o.lash : 0;
        const lag = Math.max(0, ls - (1 - k) * 0.25) / 0.75;
        const curl = o.curl * Math.sin(k * PI) * sd;
        const droop = o.wilt * k * 4;
        const fx = 2.2 * k + bk * (-2.8 * k) + lag * 5.2 * k;
        const fs = sd * (3.4 * k + 0.6 * Math.sin(o.sway * 2 + k * 2)) * (1 - lag * 0.6) + curl;
        const fz = 1.4 * k - k * k * 2.6 + bk * 4.6 * k - lag * 7.4 * k * k - droop;
        const pt = vadd(S, B.v(fx * 1.6, fs, fz * 1.4 * h));
        r.cap(prev, pt, lerp(1.5, 0.6, k - 0.25), lerp(1.5, 0.6, k), sd === cs ? BARK_M : BARK_FAR);
        prev = pt;
      }
      r.spike(prev, B.v(0.8 + (strike ? o.lash : 0), sd * 0.3, -0.6), 1.6, 0.45, { T: YOUNG }, 3);
    }
  }
  // Брызги грязи вверх и в стороны.
  for (let i = 0; i < 8 && o.splash > 0; i++) {
    const a = (i / 8) * TAU + 0.3;
    const s = o.splash;
    const R = 2.5 + s * 5;
    r.dot(
      B.p(Math.cos(a) * R, Math.sin(a) * R, 1 + Math.sin(s * PI) * (5 + (i % 3) * 2)),
      MUD_DROP,
      0,
      1,
      0.4,
    );
  }
  if (o.chips > 0) r.explode(o.chips, B.p(0, 0, 4), 3, 6, 24, 1, 0.3);
  return r;
}

function rootPose(anim: string, f: number): RootO {
  const o: RootO = { ...R0 };
  const t = f / 24;
  switch (anim) {
    case 'sub': {
      // Под трясиной (8 кадров по 8 к/с): бугор ходит, рябь кольцом.
      const a = (f / 8) * TAU;
      o.h = 0;
      o.mound = 0.45 + 0.2 * Math.sin(a);
      o.ripple = (f % 8) / 8;
      o.knot = 0;
      break;
    }
    case 'grab': {
      // Хватка 0,62 (15 кадров): бугор пухнет, кончики корней лезут и
      // шарят (до 0,5), замирают в кадр удара (корни бьют у героя — зона).
      o.mound = trk(t, [
        [0, 0.5],
        [0.5, 1.2],
      ]);
      o.h = trk(t, [
        [0, 0],
        [0.5, 0.22, easeOut],
        [0.62, 0.28],
      ]);
      o.ripple = (t * 3) % 1;
      o.curl = Math.sin(t * 18) * 1.2;
      o.knot = trk(t, [
        [0.2, 0],
        [0.6, 0.8],
      ]);
      break;
    }
    case 'emerge': {
      // Выход (начало `up`, 0,35 с): рывком из грязи, перелёт, осел.
      o.h = trk(t, [
        [0, 0.3],
        [0.12, 1.18, easeOut],
        [0.22, 0.94],
        [0.32, 1],
      ]);
      o.mound = trk(t, [
        [0, 1.2],
        [0.15, 0],
      ]);
      o.splash = trk(t, [
        [0, 0],
        [0.3, 1],
      ]);
      o.lean = trk(t, [
        [0, -0.2],
        [0.12, 0.3],
        [0.3, 0.1],
      ]);
      o.curl = trk(t, [
        [0, 1.5],
        [0.3, 0],
      ]);
      o.knot = trk(t, [
        [0, 0.6],
        [0.12, 1],
        [0.3, 0.7],
      ]);
      break;
    }
    case 'idle': {
      // Стоит (8 кадров по 6 к/с): качается, корни шевелятся, сучок дышит.
      const a = (f / 8) * TAU;
      o.sway = 0.4 * Math.sin(a);
      o.curl = 0.6 * Math.sin(a + 1);
      o.knot = 0.6 + 0.25 * Math.sin(a * 2);
      break;
    }
    case 'lash': {
      // Хлёст, windup 0,5 (12 кадров): правый корень назад-вверх (до 0,3),
      // задержка, удар вперёд-вниз — кадр урона 11-й.
      const k = clamp01((f + 1) / 12);
      o.back = trk(k, [
        [0, 0],
        [0.6, 1, easeOut],
        [0.86, 1],
        [1, 0, easeIn3],
      ]);
      o.lash = trk(k, [
        [0.86, 0],
        [1, 1, easeIn3],
      ]);
      o.lean = trk(k, [
        [0, 0.1],
        [0.6, -0.35],
        [0.86, -0.4],
        [1, 0.55, easeIn3],
      ]);
      o.knot = trk(k, [
        [0, 0.7],
        [0.6, 1],
      ]);
      o.sway = trk(k, [
        [0, 0],
        [0.6, -0.4],
        [1, 0.3],
      ]);
      break;
    }
    case 'lashf': {
      // После хлёста 0,4 с: корень дальше цели, отдача, возврат.
      o.lash = trk(t, [
        [0, 1],
        [0.05, 1.15],
        [0.35, 0],
      ]);
      o.lean = trk(t, [
        [0, 0.55],
        [0.08, 0.6],
        [0.35, 0.1],
      ]);
      o.sway = trk(t, [
        [0, 0.3],
        [0.35, 0],
      ]);
      o.knot = trk(t, [
        [0, 1],
        [0.35, 0.7],
      ]);
      break;
    }
    case 'dive': {
      // Уход 0,45 с: оседает в трясину, корни втягиваются последними.
      o.h = trk(t, [
        [0, 1],
        [0.06, 1.08],
        [0.4, 0, easeIn],
      ]);
      o.mound = trk(t, [
        [0.25, 0],
        [0.45, 0.6],
      ]);
      o.curl = trk(t, [
        [0, 0],
        [0.3, 1.4],
      ]);
      o.lean = trk(t, [
        [0, 0.1],
        [0.06, -0.2],
        [0.4, 0.2],
      ]);
      o.splash = trk(t, [
        [0.3, 0],
        [0.45, 0.6],
      ]);
      o.ripple = trk(t, [
        [0.3, 0],
        [0.45, 0.5],
      ]);
      o.knot = trk(t, [
        [0, 0.7],
        [0.3, 0],
      ]);
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.lean = 0.1 - 0.6 * b;
      o.sway = 0.6 * b;
      o.curl = 1.2 * b;
      o.knot = 0.7 - 0.5 * b;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: сучок гаснет, корни обвисли, ствол переломился и
      // осел в трясину, щепа.
      o.knot = trk(t, [
        [0, 1],
        [0.1, 0.2],
        [0.15, 0.6],
        [0.3, 0],
      ]);
      o.wilt = trk(t, [
        [0.05, 0],
        [0.4, 1, easeIn],
      ]);
      o.h = trk(t, [
        [0.3, 1],
        [0.8, 0.45, easeIn],
      ]);
      o.lean = trk(t, [
        [0, 0.1],
        [0.1, -0.4],
        [0.4, 0.6],
      ]);
      o.chips = trk(t, [
        [0.35, 0],
        [0.75, 1, easeOut],
      ]);
      o.mound = trk(t, [
        [0.5, 0],
        [0.85, 0.5],
      ]);
      o.ripple = trk(t, [
        [0.5, 0],
        [0.87, 1],
      ]);
      break;
    }
  }
  return o;
}

const ROOT = kindOf('f9_root', 56, 52, 28, 34, 900, 1.25);
const rootPic = (anim: string, f: number, d: number): Pic =>
  drawRig(ROOT, rootRig(rootPose(anim, f), yawN(d)));

registerMobPainter('f9_root', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 6);
  const ex: Partial<MobFrame> = { shadow: 0, still: true };
  let anim = 'idle';
  let f = mod((now + hash(id, 13) * 5) * 6, 8);
  let d = dirN(v.yaw);
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.72, 0.9, t);
  } else if (md === 'f9_sub') {
    anim = 'sub';
    f = mod(now * 8 + id, 8);
    d = 0;
  } else if (md === 'grab') {
    anim = 'grab';
    f = fi(t, 14);
  } else if (md === 'up' && v.prev === 'windup' && t >= 1.2 && t < 1.6) {
    anim = 'lashf';
    f = fi(t - 1.2, 9);
  } else if (md === 'up' && t < 0.35 && v.prev === 'grab') {
    anim = 'emerge';
    f = fi(t, 8);
  } else if (md === 'windup') {
    anim = 'lash';
    f = fi(t, 11);
  } else if (md === 'dive') {
    anim = 'dive';
    f = fi(t, 10);
  } else if (md === 'stun' || hurtAge(v, now) >= 0) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
  }
  if (md !== 'dying' && md !== 'f9_sub') hurtFields(v, now, ex, 0.4);
  return out(
    frameOf(ROOT, anim, f, d, pose.look, () => rootPic(anim, f, d)),
    ex,
    pose.flash,
  );
});

// ===========================================================================
// Пиявка — сторон нет
// ===========================================================================

const LEECH = tn('#140a0e', '#2e161e', '#4e2a30', '#7a4448');
const L_STRIPE = hx('#6a4a1a');
const L_MOUTH = tn('#5a1020', '#a02040', '#c8304a', '#ff8aa0');
const L_WET = hx('#b8a0a8');
const STAR = hx('#ffe9a8');
const BLOOD = hx('#8a1020');

const LEECH_M: Mat = {
  T: LEECH,
  // Кольца поперёк и полоса вдоль спины; блик мокрой кожи.
  pat: (q, l) => {
    if (l > 0.82) return L_WET;
    if (Math.abs(q[1]) < 0.12 && q[2] > 0.3) return L_STRIPE;
    return Math.floor((q[0] + 1) * 4.5) % 2 === 0 && l < 0.6 ? LEECH[0] : null;
  },
};

interface LeechO {
  /** Растяжение вдоль (sx) и высота (sz); горб волны; присоска. */
  sx: number;
  sz: number;
  hump: number;
  mouth: number;
  /** Налилась кровью, свернулась в комок, звёзды, разрыв. */
  full: number;
  ball: number;
  stars: number;
  spin: number;
  pop: number;
}

const LO: LeechO = {
  sx: 1,
  sz: 1,
  hump: 0,
  mouth: 0.2,
  full: 0,
  ball: 0,
  stars: 0,
  spin: 0,
  pop: 0,
};

function leechRig(o: LeechO, yaw: number): Rig {
  const r = new Rig();
  // Тело вытянуто по ходу: присоской вперёд (8 сторон — один эллипсоид).
  const B = F3.yaw(yaw);
  const k = 1 + o.full * 0.3;
  const len = lerp(5.4 * o.sx, 3.3, o.ball) * k;
  const wid = lerp(3.3 / Math.sqrt(o.sx), 3.3, o.ball) * k;
  const hz = lerp(2.4 * o.sz, 3.3, o.ball) * k;
  r.ell(B, [0, 0, hz], [len, wid, hz], LEECH_M);
  // Горб волны — бугор, бегущий по спине.
  if (o.hump > 0 && o.ball < 0.5)
    r.ell(
      B,
      [lerp(-len * 0.6, len * 0.6, o.hump), 0, hz * 1.5],
      [len * 0.35, wid * 0.8, hz * 0.6],
      LEECH_M,
    );
  // Присоска сверху спереди: кольцо зубов, тёмный зев.
  const M = B.p(len * 0.55, 0, hz * 1.75);
  const mr = 0.5 + o.mouth * 0.9;
  r.ell(F3.yaw(0, M), [0, 0, 0], [mr, mr, 0.35], { T: L_MOUTH });
  if (o.mouth > 0.3) r.dot(vadd(M, [0, 0, 0.3]), INK, 0, 1, 1);
  r.eye = null;
  for (let i = 0; i < 4 && o.stars > 0; i++) {
    const a = o.spin + (i / 4) * TAU;
    r.dot(B.p(Math.cos(a) * 3, Math.sin(a) * 2, hz * 2 + 3), STAR, 0.8, 1, 1);
  }
  for (let i = 0; i < 8 && o.pop > 0; i++) {
    const a = (i / 8) * TAU;
    const R = 1 + o.pop * 6;
    r.dot(
      B.p(
        Math.cos(a) * R,
        Math.sin(a) * R,
        Math.max(0.4, 2 + Math.sin(o.pop * PI) * 3 - o.pop * 2),
      ),
      BLOOD,
      0,
      1,
      0.5,
    );
  }
  return r;
}

function leechPose(anim: string, f: number): LeechO {
  const o: LeechO = { ...LO };
  const t = f / 24;
  switch (anim) {
    case 'crawl': {
      // 8 кадров на волну: вытянулась — горб пошёл — сжалась.
      const a = (f / 8) * TAU;
      o.sx = 1 + 0.28 * Math.sin(a);
      o.sz = 1 - 0.2 * Math.sin(a);
      o.hump = (f % 8) / 8;
      o.mouth = 0.4 + 0.3 * Math.sin(a + 1);
      break;
    }
    case 'idle': {
      const a = (f / 8) * TAU;
      o.sx = 1 + 0.08 * Math.sin(a);
      o.sz = 1 - 0.06 * Math.sin(a);
      o.mouth = 0.2 + 0.2 * Math.max(0, Math.sin(a * 2));
      break;
    }
    case 'leap': {
      // Прыжок 0,4 с (10 кадров): сжалась → комком по дуге, вертится →
      // шлёп (сплющило).
      o.ball = trk(t, [
        [0, 0],
        [0.06, 1],
        [0.34, 1],
        [0.4, 0],
      ]);
      o.sx = trk(t, [
        [0, 0.7],
        [0.34, 1],
        [0.4, 1.5],
      ]);
      o.sz = trk(t, [
        [0, 1.4],
        [0.34, 1],
        [0.4, 0.55],
      ]);
      o.mouth = 0.9;
      break;
    }
    case 'latch': {
      // Присосалась (8 кадров по 8 к/с): глотки — сжатие, наливается.
      const a = (f / 8) * TAU;
      o.sx = 1.1 - 0.15 * Math.max(0, Math.sin(a));
      o.sz = 1.1 + 0.2 * Math.max(0, Math.sin(a));
      o.full = 0.25 + 0.2 * Math.max(0, Math.sin(a - 0.6));
      o.mouth = 1;
      o.hump = (f % 8) / 8;
      break;
    }
    case 'dizzy': {
      // Стряхнули (1,1 с, 27 кадров): кувырок комком (до 0,3), шлёп,
      // лежит, над ней звёзды.
      o.ball = trk(t, [
        [0, 1],
        [0.3, 1],
        [0.36, 0],
      ]);
      o.sx = trk(t, [
        [0.3, 1],
        [0.36, 1.5],
        [0.5, 1.1],
      ]);
      o.sz = trk(t, [
        [0.3, 1],
        [0.36, 0.5],
        [0.5, 0.85],
      ]);
      o.stars = t > 0.36 ? 1 : 0;
      o.spin = t * 9;
      o.mouth = 0.1;
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.2)) * (1 - (f / 4) * 0.4);
      o.sx = 1 - 0.3 * b;
      o.sz = 1 + 0.35 * b;
      o.mouth = 1 - b;
      break;
    }
    case 'die': {
      // Смерть 0,87 с: вздулась (до 0,15) → лопнула брызгами → сморщилась.
      o.full = trk(t, [
        [0, 0.2],
        [0.15, 0.7, easeOut],
        [0.2, 0],
      ]);
      o.pop = trk(t, [
        [0.15, 0],
        [0.55, 1, easeOut],
      ]);
      o.sx = trk(t, [
        [0.15, 1],
        [0.3, 1.3],
        [0.8, 1.2],
      ]);
      o.sz = trk(t, [
        [0.15, 1.2],
        [0.3, 0.35],
        [0.8, 0.25],
      ]);
      o.mouth = trk(t, [
        [0, 1],
        [0.3, 0],
      ]);
      break;
    }
  }
  return o;
}

const LCH = kindOf('f9_leech', 40, 36, 20, 24, 900, 1.4);
const leechPic = (anim: string, f: number, d: number): Pic =>
  drawRig(LCH, leechRig(leechPose(anim, f), yawN(d)));

registerMobPainter('f9_leech', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  // Курс — по ходу (присоской вперёд), на герое — к нему.
  const v = visOf(m, pose, md === 'latch' || !moving(m, 0.3) ? (m.face ?? 0) : headOf(m, 0.3), 14);
  const ex: Partial<MobFrame> = { shadow: 4, still: true };
  let anim = 'idle';
  let f = mod((now + hash(id, 17) * 5) * 6, 8);
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.7, 0.9, t);
  } else if (md === 'f9_leap') {
    anim = 'leap';
    f = fi(t, 9);
    // Дуга прыжка — сдвигом; комок вертится поворотом кадра не рисуем —
    // кувырок даёт смена ширины.
    const k = clamp01(t / 0.4);
    ex.dy = -Math.sin(k * PI) * 10;
    ex.shadow = 2 + k * 2;
  } else if (md === 'latch') {
    // Висит на герое: выше пола, пульсирует.
    anim = 'latch';
    f = mod(now * 8 + id, 8);
    ex.dy = -5;
    ex.shadow = 0;
  } else if (md === 'dizzy') {
    anim = 'dizzy';
    f = fi(t, 26);
    if (t < 0.3) ex.dy = -Math.sin((t / 0.3) * PI) * 6;
  } else if (md === 'stun' || hurtAge(v, now) >= 0) {
    anim = 'flinch';
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
  } else if (moving(m, 0.3)) {
    anim = 'crawl';
    f = mod((v.dist / 0.5) * 8, 8);
  }
  if (md !== 'dying' && md !== 'latch') hurtFields(v, now, ex, 0.6);
  const d = dirN(v.yaw);
  return out(
    frameOf(LCH, anim, f, d, pose.look, () => leechPic(anim, f, d)),
    ex,
    pose.flash,
  );
});

// ---- Прогрев ----

export const WISP_WARM: [string, number][] = [
  ['float', 8],
  ['drift', 8],
  ['fadein', 17],
  ['flare', 17],
  ['fade', 15],
  ['flinch', 5],
  ['die', 21],
];
export const ROOT_WARM: [string, number][] = [
  ['idle', 8],
  ['grab', 15],
  ['emerge', 9],
  ['lash', 12],
  ['lashf', 10],
  ['dive', 11],
  ['flinch', 5],
  ['die', 21],
];
export const LEECH_WARM: [string, number][] = [
  ['crawl', 8],
  ['idle', 8],
  ['leap', 10],
  ['latch', 8],
  ['dizzy', 27],
  ['flinch', 5],
  ['die', 21],
];
registerMobWarm('f9_wisp', function* () {
  yield* warmAll(WISP, WISP_WARM, wispPic);
});
registerMobWarm('f9_root', function* () {
  // Под трясиной сторон нет — один рисунок.
  for (let f = 0; f < 8; f++) {
    frameOf(ROOT, 'sub', f, 0, 'normal', () => rootPic('sub', f, 0));
    yield 0;
  }
  yield* warmAll(ROOT, ROOT_WARM, rootPic);
});
registerMobWarm('f9_leech', function* () {
  yield* warmAll(LCH, LEECH_WARM, leechPic);
});
