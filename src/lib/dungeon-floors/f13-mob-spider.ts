// Паук-кукловод (анимации мобов 13). Облик прежний: деревянная голова, чёрное
// брюшко с золотыми шевронами, восемь деревянных ног на латунных шарнирах,
// золотые бусины глаз; на спине — латунная крестовина-вага, к ней нить.
//
// Высота над полом — контракт нитей (`spiderLift` в `f13-art.ts`, по нему
// `f13-boss-fx.ts` крепит нить в висе, подъёме, ударе): в этих режимах кадр
// поднят ровно на `spiderLift`. Где нити у мозга нет (наверху, бросок вниз,
// вязка, конец подъёма) — свою паутинку рисует кадр, а высоту ведёт рисунок:
// - `f13_drop` 0,9 с: над целью сжимается в комок, дрожит, падает камнем
//   (последние 0,24 с — с разгоном и шлейфом); касание — первый кадр
//   `f13_hang` (урон в конце броска): лапы врастопырку, брюшко к полу;
// - `windup` 0,8 с: встаёт на дыбы, передние лапы вверх, хелицеры
//   раскрыты, держит; удар — бросок вперёд, лапы в цель (контакт — первый
//   кадр `recover`), отдача, возврат;
// - `f13_fallen` 1 с (нить срезана): шлёпается, переворачивается на спину,
//   сучит лапами, переворачивается обратно; дальше бегает по полу;
// - смерть: подскок, на спину, лапы поджаты, дёрнулся.
// Паук симметричен: 5 сторон рисуются, 3 — зеркало.

import type { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { INK, P, Rig, hx, pose0, spiderLift, v3, vadd, vmix, withA } from './f13-art';
import type { Pose, RGBA, Tone, V3 } from './f13-art';
import {
  PI,
  TAU,
  clamp01,
  dirN,
  draw,
  eBack,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  kindOf,
  lin,
  mixP,
  moving,
  puff,
  smooth,
  spark,
  sstep,
  tf,
  track,
  visOf,
  warmAll,
  yawN,
} from './f13-mobkit';
import type { PKey, Pic } from './f13-mobkit';

/**
 * Поза паука. Числа ног (0…1, смешиваются): `curl` поджаты, `rear` передние
 * вверх, `stab` передние в цель, `splay` врастопырку, `dng` висят, `fl` сучит
 * (на спине), `cl` лезет по нити, `wv` вяжет; `ph` — фаза лап, `gA` — шаг.
 * Тело: `by` высота, `bz` вперёд, `pitch` нос вверх, `roll` переворот (π —
 * на спине), `ab` брюшко вверх, `fang` хелицеры, `oy` сдвиг всего рига.
 */
interface SP extends Pose {
  by: number;
  bz: number;
  pitch: number;
  roll: number;
  ab: number;
  fang: number;
  curl: number;
  rear: number;
  stab: number;
  splay: number;
  dng: number;
  fl: number;
  cl: number;
  wv: number;
  ph: number;
  gA: number;
  oy: number;
}
const S0: SP = {
  ...pose0(),
  by: 4.4,
  bz: 0,
  pitch: 0,
  roll: 0,
  ab: 0,
  fang: 0.2,
  curl: 0,
  rear: 0,
  stab: 0,
  splay: 0,
  dng: 0,
  fl: 0,
  cl: 0,
  wv: 0,
  ph: 0,
  gA: 0,
  oy: 0,
};
const sp = (o: Partial<SP>, b: SP = S0): SP => ({ ...b, ...o });

const W = 0.8;
const IDLE_N = 8;
const WALK_N = 8;
const STRIDE = 0.9;
const HANG_N = 12;
const LAND_N = 8;
const DROP_N = 22;
const WIND_N = 20;
const REC_N = 11;
const CLIMB_N = 15;
const TIE_N = 21;
const UP_N = 8;
const FALL_N = 24;
const DIE_N = 18;
const HURT_N = 6;
const HIGH = 44;

// ---- позы и треки ------------------------------------------------------------------

/** Висит на нити: лапы свисают и перебирают воздух. */
const hangP = (ph: number, k = 0.85): SP => sp({ dng: k, ph, pitch: -0.1, fang: 0.3 });

const LAND: PKey<SP>[] = [
  [0, sp({ splay: 1, by: 2.4, oy: -4, fang: 0.9, pitch: -0.15, ab: 0.5 })],
  [0.08, sp({ splay: 0.8, by: 3, oy: -3.4, fang: 0, pitch: -0.1, ab: 0.3 }), easeOut],
  [0.2, sp({ splay: 0.3, by: 4.2, oy: -1, dng: 0.5, fang: 0.2 })],
  [0.33, hangP(0), eBack],
];

/** Бросок вниз: комок над целью, потом лапы раскрываются к полу. */
const DR1 = sp({ curl: 0.5, pitch: -0.5, fang: 0.5, dng: 0.3 });
const DR2 = sp({ curl: 1, pitch: -0.7, fang: 1, ab: 0.6, by: 4.8 });
const DROP: PKey<SP>[] = [
  [0, hangP(0, 0.6)],
  [0.25, DR1],
  [0.55, DR2],
  [0.66, sp({ curl: 1.05, pitch: -0.75 }, DR2)],
  [0.82, sp({ curl: 0, splay: 0.6, dng: 0, pitch: -0.2, fang: 1, by: 4.4 }), easeOut],
  [0.9, sp({ splay: 1, by: 3, pitch: 0, fang: 1 })],
];
/** Высота броска, пиксели: опускается над целью, держит, падает камнем. */
function dropLift(t: number): number {
  if (t < 0.3) return HIGH - 4 * smooth(t / 0.3);
  if (t < 0.66) return HIGH - 4;
  return (HIGH - 4) * (1 - easeIn((t - 0.66) / 0.24));
}

/** Укус: на дыбы, передние лапы вверх, бросок вперёд. */
const WC = sp({ by: 3, pitch: -0.3, stab: 1, fang: 0, bz: 1.8, ab: 0.4 });
const WIND: PKey<SP>[] = [
  [0, S0],
  [0.14, sp({ by: 3.6, curl: 0.25, pitch: -0.1, fang: 0.3 })],
  [0.42, sp({ by: 5, pitch: 0.55, rear: 1, ab: -0.8, fang: 1, bz: -0.6 }), easeOut],
  [0.66, sp({ by: 5.2, pitch: 0.62, rear: 1.1, ab: -0.9, fang: 1.1, bz: -0.8 }), lin],
  [W, WC, easeIn],
];
const REC: PKey<SP>[] = [
  [0, WC],
  [0.08, sp({ by: 2.6, pitch: -0.4, stab: 1, bz: 2.2, fang: 0.1, ab: 0.5 }), easeOut],
  [0.2, sp({ by: 4.2, pitch: 0.15, stab: 0.2, bz: 0.3, fang: 0.4 })],
  [0.42, S0, eBack],
];

/** Нить срезана: шлёп, на спину, сучит лапами, переворот обратно. */
const FALL: PKey<SP>[] = [
  [0, sp({ dng: 0.8, oy: 4, fang: 0.8 })],
  [0.12, sp({ oy: 0, by: 4.6, roll: 0.6, splay: 0.5, fang: 1 }), easeIn],
  [0.28, sp({ roll: PI, by: 5.2, fl: 1, fang: 1 }), easeOut],
  [0.7, sp({ roll: PI, by: 5.2, fl: 1, fang: 0.6 })],
  [0.9, sp({ roll: TAU, by: 4.8, splay: 0.4, fl: 0.2 }), easeIn],
  [0.95, sp({ roll: TAU, by: 3.4, splay: 0.7 }), easeOut],
  [1, sp({ roll: TAU, by: 4.2, splay: 0.2 })],
];

/** Смерть: подскок, на спину, лапы поджаты. */
const DIE: PKey<SP>[] = [
  [0, S0],
  [0.08, sp({ by: 6, oy: 1.5, pitch: 0.5, rear: 0.6, fang: 1 }), easeOut],
  [0.3, sp({ roll: PI, by: 5, fl: 0.7, curl: 0.3, fang: 1 }), easeIn],
  [0.42, sp({ roll: PI, by: 4.6, curl: 1, fang: 0.4 }), easeOut],
  [0.75, sp({ roll: PI, by: 4.6, curl: 1, fang: 0.4 })],
];

const HURT: PKey<SP>[] = [
  [0, S0],
  [0.04, sp({ by: 5.2, pitch: 0.35, curl: 0.35, fang: 0.9, bz: -0.8 }), easeOut],
  [0.25, S0, eBack],
];

/** Вязка (1,2 с): спуск к кукле, вяжет, подъём; уникальный кадр по кадру режима. */
function tieIndex(f: number): number {
  if (f < 8) return f;
  if (f < 24) return 8 + ((f - 8) % 8);
  return 16 + Math.min(4, f - 24);
}
function tieLift(t: number): number {
  if (t < 0.3) return HIGH - 22 * smooth(t / 0.3);
  if (t < 1) return HIGH - 22;
  return HIGH - 22 + 22 * smooth((t - 1) / 0.2);
}
const climbP = (ph: number): SP => sp({ cl: 1, ph, pitch: 0.9, dng: 0.6, fang: 0.3 });

function sPose(anim: string, f: number): SP {
  const t = tf(f);
  switch (anim) {
    case 'walk': {
      const ph = (f / WALK_N) * TAU;
      return sp({
        ph,
        gA: 1.6,
        by: 4.4 + 0.25 * Math.abs(Math.sin(ph * 2)),
        pitch: 0.04 * Math.sin(ph * 2),
      });
    }
    case 'hang':
      return hangP((f / HANG_N) * TAU);
    case 'land':
      return track(t, LAND);
    case 'drop':
      return track(t, DROP);
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'climb':
      return mixP(hangP(0), climbP(t * TAU * 4), smooth(t / 0.12));
    case 'tie': {
      if (f < 8)
        return mixP(
          hangP((f / 8) * PI, 0.7),
          sp({ wv: 1, pitch: -0.3, fang: 0.5 }),
          sstep(4, 8, f),
        );
      if (f < 16)
        return sp({ wv: 1, ph: ((f - 8) / 8) * TAU, pitch: -0.3, fang: 0.5 + 0.2 * Math.sin(f) });
      const k = (f - 15) / 5;
      return mixP(sp({ wv: 1, pitch: -0.3, fang: 0.5 }), climbP(k * TAU * 1.5), smooth(k * 2));
    }
    case 'upw':
      return sp({ ph: (f / UP_N) * TAU, gA: 1.4, dng: 0.45, fang: 0.3 });
    case 'upi':
      return hangP((f / UP_N) * TAU);
    case 'fall': {
      const q = track(t, FALL);
      return { ...q, ph: t * TAU * 4 };
    }
    case 'die': {
      const q = track(t, DIE);
      // Дёрнулся напоследок.
      return f === 13 || f === 14 ? { ...q, curl: 0.8, ph: 1 } : { ...q, ph: t * TAU * 3 };
    }
    case 'hu':
      return track(t, HURT);
  }
  // Покой на полу: переминается, хелицеры шевелятся.
  const ph = (f / IDLE_N) * TAU;
  return sp({
    ph,
    gA: 0.25,
    by: 4.4 + 0.2 * Math.sin(ph),
    fang: 0.2 + 0.15 * Math.max(0, Math.sin(ph * 2)),
  });
}

// ---- рисунок -------------------------------------------------------------------------

const rotXn = (v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return v3(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
};
const lerpV = (a: V3, b: V3, k: number): V3 => (k <= 0 ? a : vmix(a, b, Math.min(1.2, k)));

const EYE_C = hx('#ffcf40');
const SILK = hx('#f0e6c8');
const STRIPES = (_t: number, _nx: number, _ny: number, nm: V3): Tone | null =>
  Math.abs(nm.z + 0.05) < 0.1 || Math.abs(nm.z + 0.42) < 0.09 ? P.gold : null;
const ANG = [0.72, 1.22, 1.82, 2.4];

type Pts = { a?: V3; b?: V3; c?: V3; p?: V3[] };
function remap(rig: Rig, fn: (v: V3) => V3): void {
  for (const p of rig.prims as unknown as Pts[]) {
    if (p.a) p.a = fn(p.a);
    if (p.b) p.b = fn(p.b);
    if (p.c) p.c = fn(p.c);
    if (p.p) p.p = p.p.map(fn);
  }
}

/** Риг паука; `top` — верх брюшка (крепление нити) в осях модели. */
function spiderRig(q: SP): { rig: Rig; top: V3; fangs: V3 } {
  const rig = new Rig();
  const by = q.by - 0.6;
  const body = (v: V3): V3 => vadd(rotXn(v, -q.pitch), v3(0, by, q.bz));
  // Лапы: корень у головогруди, колено высоко наружу, стопа — по позе.
  for (let k = 0; k < 4; k++)
    for (const s of [-1, 1]) {
      const i = k * 2 + (s > 0 ? 1 : 0);
      const root = body(v3(s * 1.7, -0.2, 1.9 - k * 0.95));
      const th = ANG[k];
      const dx = s * Math.sin(th);
      const dz = Math.cos(th);
      const R = 7.2 * (1 + 0.3 * q.splay);
      let foot = v3(root.x + dx * R, 0, root.z + dz * R);
      if (q.gA) {
        const g = q.ph + ((k + (s > 0 ? 1 : 0)) % 2) * PI;
        foot = vadd(foot, v3(0, 0.6 * q.gA * Math.max(0, Math.cos(g)), q.gA * Math.sin(g)));
      }
      if (q.dng) {
        const pd = q.ph + i * 1.7;
        foot = lerpV(
          foot,
          v3(
            root.x + dx * R * 0.55,
            by - 6 + 1.1 * Math.sin(pd),
            root.z + dz * R * 0.55 + 0.9 * Math.cos(pd),
          ),
          q.dng,
        );
      }
      if (q.curl) foot = lerpV(foot, body(v3(s * 1.6, -2.4, 1.2 - k * 0.7)), q.curl);
      if (q.rear && k < 2)
        foot = lerpV(
          foot,
          body(v3(s * (2.2 + k * 1.2), 6.2 - k * 1.8, 4.8 - k * 1.4)),
          q.rear * (k ? 0.65 : 1),
        );
      if (q.stab && k < 2)
        foot = lerpV(
          foot,
          v3(s * (1.2 + k * 1.4), 0, root.z + 5.8 - k * 1.2),
          q.stab * (k ? 0.7 : 1),
        );
      if (q.fl) {
        const pf = q.ph + i * 1.3;
        foot = lerpV(
          foot,
          body(
            v3(
              s * (4 + 1.5 * Math.sin(pf)),
              -4.6 - 1.4 * Math.cos(pf),
              2.6 - k * 1.8 + Math.sin(pf + k),
            ),
          ),
          q.fl,
        );
      }
      if (q.cl && k < 2) {
        const up = Math.max(0, Math.sin(q.ph + (s > 0 ? PI : 0) + k * PI));
        foot = lerpV(foot, body(v3(s * 0.9, 4 + 3 * up, 1.6 - k)), q.cl);
      }
      if (q.wv && k < 2)
        foot = lerpV(
          foot,
          body(
            v3(
              s * 1.3 + 0.9 * Math.cos(q.ph + s),
              0.4 + 1.3 * Math.sin(q.ph + s * 1.3 + k),
              4.6 - k,
            ),
          ),
          q.wv,
        );
      const kh = 2.6 * (1 - 0.6 * Math.max(q.curl, q.splay)) + 0.6 * q.dng;
      const knee = vadd(vmix(root, foot, 0.42), v3(dx * 1.3, kh, dz * 0.7));
      rig.cap(root, knee, 0.75, 0.55, P.wood);
      rig.cap(knee, foot, 0.55, 0.3, P.wood);
      rig.ball(knee, 0.72, P.brass);
    }
  // Головогрудь, брюшко с шевронами, крестовина-вага на спине.
  rig.ball(body(v3(0, 0, 1.5)), 2.5, P.wood);
  const ab = body(v3(0, 0.9 + q.ab, -2.6));
  rig.ball(ab, 3.9, P.black, STRIPES);
  const top = body(v3(0, 4.7 + q.ab, -2.6));
  rig.cap(body(v3(-1.9, 4.4 + q.ab, -2.4)), body(v3(1.9, 4.4 + q.ab, -2.4)), 0.45, 0.45, P.brass);
  rig.cap(body(v3(0, 4.3 + q.ab, -4.2)), body(v3(0, 4.5 + q.ab, -0.9)), 0.45, 0.45, P.brass);
  // Хелицеры и глаза.
  for (const s of [-1, 1]) {
    rig.cap(
      body(v3(s * 0.7, -0.9, 3.5)),
      body(v3(s * (0.6 + q.fang * 0.9), -2.5 + q.fang * 0.4, 4.2 + q.fang * 0.3)),
      0.62,
      0.3,
      P.porcelain,
    );
    rig.dot(body(v3(s * 0.85, 1.3, 3.6)), EYE_C, 1, true);
  }
  const fangs = body(v3(0, -2, 4.4));
  const out = (v: V3) => v3(v.x, v.y + q.oy, v.z);
  let rt = top;
  let rf = fangs;
  if (q.roll) {
    // Переворот вокруг оси «вперёд» через середину тела.
    const c = Math.cos(q.roll);
    const s = Math.sin(q.roll);
    const cy = by;
    const rr = (v: V3) => v3(v.x * c - (v.y - cy) * s, cy + v.x * s + (v.y - cy) * c, v.z);
    remap(rig, rr);
    rt = rr(rt);
    rf = rr(rf);
  }
  if (q.oy) remap(rig, out);
  return { rig, top: out(rt), fangs: out(rf) };
}

/** Своя паутинка вверх от спины (где нити у мозга нет): гаснет кверху. */
function silk(p: Px, x: number, y: number, L: number, a0 = 0.85): void {
  const xi = Math.round(x);
  for (let i = 0; i < L; i++) {
    const a = a0 * (1 - (i / L) ** 1.6);
    p.set(xi, Math.round(y) - i, withA(SILK, a));
    p.set(xi + 1, Math.round(y) - i, withA(INK, a * 0.45));
  }
}

const SPARK_C = hx('#ffffff');
const DUST: readonly RGBA[] = [hx('#c89a5a'), hx('#f0d8a0'), hx('#5a3a1c')];

const K = kindOf('f13_spider', 52, 76, 26, 62, 1100);
/** Рисуемые стороны; 3, 4, 5 — зеркала 1, 0, 7. */
const SIDES = [0, 1, 2, 6, 7] as const;
/** Кадры с собственной паутинкой. */
const OWN_SILK = new Set(['drop', 'upw', 'upi', 'tie']);

const sPic = (anim: string, f: number, d: number): Pic => {
  const q = sPose(anim, f);
  const { rig, top, fangs } = spiderRig(q);
  return draw(K, rig, yawN(d), (o, Pj, lit) => {
    const [tx, ty] = Pj(top);
    if (OWN_SILK.has(anim) || (anim === 'climb' && f >= 7)) silk(o.px, tx, ty, 36);
    else if (anim === 'land') silk(o.px, tx, ty, 10, 0.7);
    if (anim === 'rec' && f <= 1) {
      const [x, y] = Pj(fangs);
      spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.55);
    }
    if (anim === 'rec' && f >= 1 && f <= 5) {
      const [x, y] = Pj(v3(0, 0, q.bz + 5.5));
      puff(o.px, x, y, (f - 0.5) / 5.5, 19, DUST, 5, 4);
    }
    if (anim === 'wind' && f >= 12 && f <= 15) {
      // Держит на дыбах: блик на хелицерах.
      const [x, y] = Pj(fangs);
      spark(lit(), x, y, EYE_C, f % 2 ? 0.5 : 0.85);
    }
  });
};

// ---- рисовальщик -----------------------------------------------------------------------

const TECH = new Set([
  'windup',
  'recover',
  'f13_hang',
  'f13_drop',
  'f13_retie',
  'f13_climb',
  'f13_fallen',
  'stun',
]);
/** Режимы у пола: оттуда наверх паук взлетает по нити, а не прыгает. */
const LOW = new Set(['f13_hang', 'windup', 'recover', 'stun', 'f13_fallen', 'chase']);
const GHOST = { every: 0.035, life: 0.14, tint: '#ffcf40', alpha: 0.3 };

registerMobPainter('f13_spider', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m, 0.3);
  const v = visOf(m, pose, want, 10);
  const d = dirN(v.yaw);
  const mir = d >= 3 && d <= 5;
  const ds = mir ? (12 - d) % 8 : d;
  const ex: Partial<MobFrame> = {};
  let anim = 'idle';
  let f = 0;
  let lift = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.8;
    ex.alpha = 1 - sstep(0.55, 0.8, t);
  } else if (md === 'f13_drop') {
    anim = 'drop';
    f = fi(t, DROP_N - 1);
    lift = dropLift(t);
    ex.alpha = 0.55 + 0.45 * smooth(t / 0.3);
    if (t >= 0.66) ex.ghost = GHOST;
    // Комок дрожит над целью.
    if (t >= 0.5 && t < 0.66) ex.dx = Math.floor(now * 30) % 2 ? 0.4 : -0.4;
  } else if (md === 'f13_hang' && v.prev === 'f13_drop' && t < LAND_N / 24) {
    anim = 'land';
    f = fi(t, LAND_N - 1);
    lift = spiderLift(m);
    const k = 1 - sstep(0, 0.12, t);
    ex.sx = 1 + 0.16 * k;
    ex.sy = 1 - 0.16 * k;
  } else if (md === 'f13_hang') {
    anim = 'hang';
    f = Math.floor(now * 8 + hash(id, 7) * HANG_N) % HANG_N;
    lift = spiderLift(m);
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    lift = spiderLift(m);
    if (t >= 0.5 && t < 0.66) ex.dx = Math.floor(now * 30) % 2 ? 0.3 : -0.3;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    lift = spiderLift(m);
    const k = 1 - sstep(0, 0.14, t);
    ex.sx = 1 + 0.12 * k;
    ex.sy = 1 - 0.12 * k;
  } else if (md === 'f13_climb') {
    anim = 'climb';
    f = fi(t, CLIMB_N - 1);
    lift = spiderLift(m);
    ex.alpha = 1 - 0.45 * sstep(0.25, 0.6, t);
  } else if (md === 'f13_retie') {
    anim = 'tie';
    f = tieIndex(fi(t, 28));
    lift = tieLift(t);
    ex.alpha = 0.8;
  } else if (md === 'f13_up') {
    anim = moving(m, 0.3) ? 'upw' : 'upi';
    f =
      anim === 'upw'
        ? Math.floor((v.dist / STRIDE) * UP_N) % UP_N
        : Math.floor(now * 6 + hash(id, 7) * UP_N) % UP_N;
    // С пола наверх — взлетает по нити.
    lift = LOW.has(v.prev) && t < 0.35 ? HIGH * smooth(t / 0.35) : HIGH;
    ex.alpha = 0.55;
  } else if (md === 'f13_fallen') {
    anim = 'fall';
    f = fi(t, FALL_N - 1);
    const k = Math.sin(PI * clamp01((t - 0.9) / 0.08));
    ex.sx = 1 + 0.12 * k;
    ex.sy = 1 - 0.12 * k;
  } else if (md === 'stun' || hurtAge(v, now) < HURT_N / 24) {
    anim = 'hu';
    f = fi(md === 'stun' ? t : hurtAge(v, now), HURT_N - 1);
  } else if (moving(m, 0.3)) {
    anim = 'walk';
    f = Math.floor((v.dist / STRIDE) * WALK_N) % WALK_N;
  } else {
    f = Math.floor(now * 8 + hash(id, 7) * IDLE_N) % IDLE_N;
  }
  ex.dy = -lift;
  ex.shadow = 6 - Math.min(4.5, lift / 10);
  if (md !== 'dying' && md !== 'f13_drop' && md !== 'f13_up') hurtFx(v, now, 1.2, ex);
  const fr = frameOf(K, anim, f, ds, pose, () => sPic(anim, f, ds));
  if (mir) ex.sx = -(ex.sx ?? 1);
  return { ...fr, ...ex };
});

registerMobWarm('f13_spider', function* () {
  yield* warmAll(
    K,
    [
      ['upw', UP_N],
      ['upi', UP_N],
      ['drop', DROP_N],
      ['land', LAND_N],
      ['hang', HANG_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['climb', CLIMB_N],
      ['tie', TIE_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      // Нить срезана: падает и бегает по полу.
      ['fall', FALL_N],
      ['walk', WALK_N],
      ['idle', IDLE_N],
    ],
    sPic,
    SIDES,
  );
});
