// Имп-носильщик (анимации мобов 10): красный бесёнок с мешком золота за
// левым плечом, рожки, уши-лопухи, жёлтые глаза, крылышки, хвост-стрелка.
// Удирает вприпрыжку туда, куда бежит (8 сторон честно: мешок на одном
// плече), оглядывается и хихикает.
//
// Метроном — `f10-brains.ts` (`f10_imp`):
// - `flee`/`chase` — бег по пути, мешок подпрыгивает с запаздыванием, хвост
//   и крылышки отстают; раз в шаг оглядывается;
// - `f10_puff` 0,35 с (`ghost`) — присел, кутается в дым и пропадает;
//   мозг переносит его и сразу ставит `flee` — первые 0,25 с после дыма
//   он выскакивает из клуба (растяжка, дым расходится);
// - удар героя (`stun`, `flinch` 1) — подлетает, из мешка брызжет золото;
// - смерть 0,6 с — мешок лопается, монеты веером, бес крутится и
//   исчезает в дыму; `escape` (ушёл через 20 с) — тот же дым.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  arm,
  camSide,
  clamp01,
  dirN,
  draw,
  easeOut,
  fi,
  frameOf,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hx,
  kindOf,
  leg,
  moving,
  smooth,
  spark2,
  spray,
  sstep,
  tn,
  vadd,
  visOf,
  warmAll,
  yawN,
} from './f10-mobs';
import type { Pic, RGBA, RigOut, V3 } from './f10-mobs';
import type { Mat } from './f15-rig';

const SKIN = tn('#3a0808', '#7a1814', '#b8322a', '#e8664a');
const SACK = tn('#2a1c0e', '#5a3e1e', '#8a6232', '#b8904e');
const HORN = tn('#2a1a10', '#5a4030', '#a08060', '#e8d0b0');
const WING = tn('#2a0606', '#4a0e0c', '#6e1a16', '#9a2a22');
const GOLD: RGBA[] = [hx('#8a5a10'), hx('#e0a830'), hx('#fff0a0')];
const EYE = hx('#ffd040');
const SMOKE: RGBA[] = [hx('#4a3a46'), hx('#6a5a66'), hx('#8a7a86'), hx('#3a2e38')];

const SK = 1.85;

interface ImO {
  fwd: number;
  bob: number;
  lean: number;
  roll: number;
  /** Голова: кивок, поворот (оглянулся — ±1,6), пасть-ухмылка. */
  head: number;
  hturn: number;
  grin: number;
  fR: V3;
  fL: V3;
  /** Правая рука машет, левая держит мешок; мешок подскакивает. */
  hR: V3;
  sackUp: number;
  sackSw: number;
  wing: number;
  tail: number;
  drag: number;
  /** Сжат в клуб дыма 0…1, крутится (рад), золото брызжет 0…1. */
  puff: number;
  spin: number;
  coins: number;
  /** Мешок цел 0…1 (в смерти лопается). */
  sack: number;
}

const I0: ImO = {
  fwd: 0,
  bob: 0,
  lean: 0.1,
  roll: 0,
  head: 0,
  hturn: 0,
  grin: 0.5,
  fR: [0.2, 1.1, 0],
  fL: [0.2, -1.1, 0],
  hR: [1.6, 2.2, 4.2],
  sackUp: 0,
  sackSw: 0,
  wing: 0,
  tail: 0,
  drag: 0.2,
  puff: 0,
  spin: 0,
  coins: 0,
  sack: 1,
};

function impRig(o: ImO, yaw: number): KRig {
  const r = new KRig(SK);
  const B = F3.yaw(yaw + o.spin).scale(SK);
  const cs = camSide(yaw);
  const sq = 1 - 0.55 * o.puff;
  const P = B.at(o.fwd, 0, (3.4 + o.bob) * sq)
    .roll(o.roll)
    .pitch(o.lean);
  const T = P.at(0, 0, 0.5);
  const Hd = T.at(0.6, 0, 4.2)
    .pitch(-o.lean + o.head)
    .turn(o.hturn);
  const skin: Mat = { T: SKIN };
  // Ноги.
  for (const sd of [-1, 1]) {
    const f = sd > 0 ? o.fR : o.fL;
    const foot = B.p(o.fwd + f[0], f[1], f[2] + 0.4);
    leg(
      r,
      P.p(0, sd * 1.0, -0.2),
      foot,
      1.9 * SK,
      1.8 * SK,
      B.v(1, 0, 0),
      [0.85, 0.6, 0.55],
      skin,
      vadd(foot, B.v(1.0, 0, -0.2)),
    );
  }
  // Пузо, грудь.
  r.ell(P, [0.3, 0, 0.7], [1.9, 1.9, 1.7], skin);
  r.ell(T, [0.1, 0, 2.3], [1.5, 1.9, 1.5], skin);
  // Крылышки за спиной.
  for (const sd of [-1, 1]) {
    const root = T.p(-1.0, sd * 0.8, 3.0);
    const tip = vadd(root, T.v(-1.4, sd * (2.0 + 0.8 * o.wing), 1.4 - 1.2 * o.wing));
    const low = vadd(root, T.v(-1.0, sd * 1.4, -1.2));
    r.poly([root, tip, low], { T: WING, flat: 2 });
    r.cap(root, tip, 0.3, 0.15, { T: WING });
  }
  // Хвост-стрелка: от крестца назад и кверху крючком.
  const q0 = P.p(-1.5, 0, 0.2);
  const q1 = vadd(q0, B.v(-1.3 - 0.5 * o.drag, o.tail * 0.9, -0.5 + 0.3 * o.drag));
  const q2 = vadd(q1, B.v(-0.7 - 0.3 * o.drag, o.tail * 1.2, 1.5));
  r.cap(q0, q1, 0.4, 0.3, skin);
  r.cap(q1, q2, 0.3, 0.22, skin);
  r.spike(q2, B.v(0.2, o.tail * 0.5, 1), 1.1, 0.7, skin, 3);
  // Голова: шар, морда, уши, рожки, глаза, ухмылка.
  r.ball(Hd.p(0, 0, 0), 2.2, skin);
  r.ell(Hd, [1.5, 0, -0.6], [1.0, 1.2, 0.9], { T: SKIN, bias: 0.1 });
  for (const sd of [-1, 1]) {
    r.spike(Hd.p(-0.2, sd * 1.8, 0.2), Hd.v(-0.3, sd * 1, 0.3), 2.2, 0.8, skin, 3);
    r.spike(Hd.p(0.3, sd * 1.0, 1.6), Hd.v(-0.1, sd * 0.55, 1), 1.9, 0.55, { T: HORN }, 3);
    r.dot(Hd.p(1.8, sd * 0.75, 0.4), EYE, 1, 1, 0.6);
  }
  if (o.grin > 0.2) r.dot(Hd.p(2.15, 0, -0.85), hx('#fff0d0'), 0, 1, 0.5);
  r.eye = Hd.p(1.8, cs * 0.75, 0.4);
  // Правая рука машет; левая за плечом держит мешок.
  const shR = T.p(0.2, 1.6, 3.0);
  const shL = T.p(0.0, -1.6, 3.0);
  arm(
    r,
    shR,
    B.p(o.fwd + o.hR[0], o.hR[1], o.hR[2] * sq),
    1.8 * SK,
    1.8 * SK,
    B.v(-1, 0.5, 0),
    [0.55, 0.45, 0.45],
    skin,
  );
  const S = T.at(-2.0 - o.sackSw * 0.6, -1.3, 4.3 + o.sackUp);
  const sackC = S.p(0, 0, 0);
  arm(
    r,
    shL,
    vadd(sackC, T.v(0.6, 0.4, 1.4)),
    1.8 * SK,
    1.8 * SK,
    B.v(0, -1, -0.3),
    [0.55, 0.45, 0.45],
    skin,
  );
  if (o.sack > 0.05) {
    const k = o.sack;
    r.ell(S, [0, 0, 0], [2.5 * k, 2.3 * k, 2.2 * k], { T: SACK });
    r.cap(vadd(sackC, T.v(0.4, 0.3, 1.9 * k)), vadd(sackC, T.v(0.7, 0.4, 2.7 * k)), 0.7, 0.45, {
      T: SACK,
    });
    r.dot(vadd(sackC, T.v(0.6, 0.4, 2.8 * k)), GOLD[2], 0.7, 1, 0.6);
    r.dot(vadd(sackC, T.v(0.9, -0.2, 2.6 * k)), GOLD[1], 0.4, 1, 0.6);
  }
  return r;
}

// ---- Позы ------------------------------------------------------------------

function runO(f: number): ImO {
  const ph = f / 8;
  const a = ph * TAU;
  const o: ImO = { ...I0, lean: 0.35, drag: 1 };
  const L = 2.2;
  const st = (p: number): [number, number] => {
    const q = ((p % 1) + 1) % 1;
    if (q < 0.45) return [L * (0.5 - q / 0.45), 0];
    const k = (q - 0.45) / 0.55;
    return [L * (-0.5 + smooth(k)), Math.sin(PI * k)];
  };
  const [r0, ru] = st(ph);
  const [l0, lu] = st(ph + 0.5);
  o.fR = [0.3 + r0, 1.0, 1.3 * ru];
  o.fL = [0.3 + l0, -1.0, 1.3 * lu];
  o.bob = 0.6 * Math.abs(Math.sin(a));
  o.roll = 0.1 * Math.sin(a);
  o.hR = [1.4 + 1.2 * Math.sin(a), 2.0, 4.0 + 0.6 * Math.cos(a)];
  // Мешок подскакивает с запаздыванием на четверть шага.
  o.sackUp = 0.7 * Math.abs(Math.sin(a - 0.9));
  o.sackSw = 0.5 * Math.sin(a - 0.9);
  o.wing = 0.6 + 0.4 * Math.sin(a * 2);
  o.tail = 0.6 * Math.sin(a - 1.4);
  // Оглядывается через плечо на кадрах 5–7.
  o.hturn = f >= 5 ? -1.4 : 0;
  o.grin = f >= 5 ? 1 : 0.4;
  return o;
}

function idleO(f: number): ImO {
  const a = (f / 8) * TAU;
  const o: ImO = { ...I0 };
  // Хихикает: плечи трясутся, подпрыгивает.
  o.bob = 0.4 * Math.abs(Math.sin(a));
  o.head = 0.15 * Math.sin(a * 2);
  o.hR = [1.8, 2.1, 3.0 + 1.6 * Math.abs(Math.sin(a))];
  o.sackUp = 0.4 * Math.abs(Math.sin(a - 0.6));
  o.wing = 0.3 * Math.sin(a * 2);
  o.tail = 0.5 * Math.sin(a);
  o.grin = 1;
  return o;
}

function impPose(anim: string, f: number): ImO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'run':
      return runO(f);
    case 'idle':
      return idleO(f);
    case 'puff': {
      // 9 кадров (0,35 с): присел (0–0,1), кутается в дым и сжимается.
      const o: ImO = { ...I0 };
      o.bob = -1.5 * sstep(0, 0.1, t);
      o.puff = sstep(0.08, 0.3, t);
      o.spin = 2.5 * sstep(0.1, 0.35, t) ** 2;
      o.grin = 1;
      o.hR = [0.6, 1.4, 5.0];
      return o;
    }
    case 'pop': {
      // 6 кадров (0,25 с): выскочил из клуба — растяжка, приземлился.
      const o: ImO = { ...I0 };
      o.puff = 1 - sstep(0, 0.12, t);
      o.bob = 1.5 * Math.sin(PI * sstep(0, 0.2, t));
      o.hR = [1.2, 2.6, 6.0 - 2.0 * sstep(0.1, 0.25, t)];
      o.grin = 1;
      o.wing = 1;
      return o;
    }
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      return {
        ...I0,
        fwd: -0.8 * b,
        bob: 1.2 * b,
        lean: -0.5 * b,
        head: -0.5 * b,
        grin: 0,
        sackUp: 1.2 * b,
        sackSw: -1 * b,
        hR: [0.8, 2.6, 6.0],
        coins: b,
      };
    }
    case 'die': {
      // 15 кадров (0,6 с): мешок лопнул, монеты веером (0–0,3), бес
      // крутится и уходит в дым (0,2–0,6).
      const o: ImO = { ...I0 };
      o.sack = 1 - sstep(0.03, 0.14, t);
      o.coins = clamp01((t - 0.04) / 0.3);
      o.spin = 6 * sstep(0.1, 0.55, t);
      o.bob = 2.0 * Math.sin(PI * sstep(0, 0.3, t));
      o.puff = sstep(0.25, 0.55, t);
      o.grin = 0;
      o.head = -0.5;
      o.hR = [0.8, 2.6, 6.0];
      return o;
    }
  }
  return { ...I0 };
}

// ---- Кадр -----------------------------------------------------------------

function disc(p: RigOut['p'], x: number, y: number, r: number, c: RGBA): void {
  const r2 = r * r;
  for (let j = Math.floor(-r); j <= r; j++)
    for (let i = Math.floor(-r); i <= r; i++) if (i * i + j * j <= r2) p.set(x + i, y + j, c);
}

/** Клуб дыма: n комьев, разлёт `spread` px, размер `size` 0…1, свет сверху-слева. */
function puffs(
  p: RigOut['p'],
  x: number,
  y: number,
  spread: number,
  size: number,
  seed: number,
): void {
  if (size <= 0.03) return;
  for (let i = 0; i < 9; i++) {
    const a = hash(seed, i, 1) * TAU;
    const s = 0.45 + 0.55 * hash(seed, i, 2);
    const cx = Math.round(x + Math.cos(a) * spread * s * 1.1);
    const cy = Math.round(y + Math.sin(a) * spread * s * 0.6 - 2 * size * s);
    const r = (1.2 + 2.8 * s) * size;
    disc(p, cx, cy, r, SMOKE[3]);
    disc(p, cx - r * 0.25, cy - r * 0.3, r * 0.7, SMOKE[0]);
    if (r > 1.6) disc(p, cx - r * 0.4, cy - r * 0.45, r * 0.35, SMOKE[i % 3 ? 1 : 2]);
  }
}

const IM = kindOf('imp', 80, 72, 40, 54, 900);

const impPic = (anim: string, f: number, d: number): Pic => {
  const o0 = impPose(anim, f);
  const yaw = yawN(d);
  return draw(IM, impRig(o0, yaw), (o, P) => {
    const B = F3.yaw(yaw).scale(SK);
    const [cx, cy] = P(B.p(0, 0, 4.5));
    if (o0.coins > 0) {
      // Золото из мешка — дугой вверх и вниз, монета 2×1.
      const [x, y] = P(B.p(-2.0, -1.3, 8));
      const n = anim === 'die' ? 14 : 7;
      for (let i = 0; i < n; i++) {
        const a = -PI * (0.08 + 0.84 * hash(9, i));
        const v = 5 + 9 * hash(11, i);
        const k = o0.coins;
        const px = x + Math.cos(a) * v * k * 1.5;
        const py = y + Math.sin(a) * v * k + 18 * k * k;
        spark2(o, px, py, GOLD[1], 0.5);
        spark2(o, px + 1, py, GOLD[i % 2 ? 2 : 0], i % 2 ? 0.8 : 0);
      }
      if (anim === 'die' && o0.sack < 1 && o0.sack > 0) {
        // Клочья мешковины.
        spray(o.p, x, y, 10, 10, 1 - o0.sack, 77, SACK.slice(1, 3), 4, 3);
      }
    }
    if (anim === 'puff') puffs(o.p, cx, cy, 2 + 5 * o0.puff, o0.puff, 30);
    else if (anim === 'pop') puffs(o.p, cx, cy, 6 + 7 * (f / 5), 1 - 0.85 * (f / 5), 30);
    else if (o0.puff > 0) puffs(o.p, cx, cy, 2 + 6 * o0.puff, o0.puff, 41);
  });
};

registerMobPainter('f10_imp', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, md === 'f10_puff' ? (m.face ?? 0) : headOf(m), 16);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    f = fi(t, 14);
    anim = 'die';
    ex.linger = 0.65;
    ex.alpha = 1 - sstep(0.45, 0.65, t);
    ex.shadow = 5 * (1 - sstep(0.2, 0.45, t));
    ex.still = true;
  } else if (md === 'f10_puff' || md === 'escape') {
    f = fi(t, 8);
    anim = 'puff';
    ex.alpha = 1 - sstep(0.22, 0.35, t);
    ex.shadow = 5 * (1 - sstep(0.1, 0.3, t));
    ex.still = true;
  } else if (md === 'emerge') {
    // Выскочил из норы: тот же «хлоп» из дыма, растянутый на 0,45 с.
    f = fi(t * (0.25 / 0.45), 5);
    anim = 'pop';
    ex.alpha = sstep(0, 0.1, t);
  } else if (v.prev === 'f10_puff' && t < 0.25) {
    f = fi(t, 5);
    anim = 'pop';
    ex.alpha = 0.5 + 0.5 * sstep(0, 0.06, t);
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m)) {
    f = Math.floor((v.dist / 1.1) * 8) % 8;
    anim = 'run';
  } else {
    f = Math.floor((now + hash(id, 7) * 4) * 9) % 8;
    anim = 'idle';
  }
  if (md !== 'dying') hurtFx(v, now, 1.4, ex);
  const fr = frameOf(IM, anim, f, d, pose, () => impPic(anim, f, d));
  if (anim === 'pop' && t < 0.08) ex.sy = 1.25 - easeOut(t / 0.08) * 0.25;
  return { ...fr, ...ex };
});

registerMobWarm('f10_imp', function* () {
  yield* warmAll(
    IM,
    [
      ['run', 8],
      ['idle', 8],
      ['puff', 9],
      ['pop', 6],
      ['flinch', 5],
      ['die', 15],
    ],
    impPic,
  );
});
