// Этаж 8 — Демон-барабанщик (анимации мобов 8). Прежний облик (райдзин):
// красная кожа, белая дикая грива, тёмные рога, тёмная безрукавка, хакама,
// золотой пояс; барабаны вросли в живот и в плечи — красные корпуса с
// золотыми гвоздями, светлая кожа с томоэ. В руках палки-бати. Мини-3D
// (общий человечек `f8-mob-oni.ts`), 8 сторон, все честные.
//
// Метроном мозга (`f8-brains.ts`, `f8_drum`): «когти» `side` 0,85 с — палки
// вскинуты (весь замах — подготовка, задержка в верхней точке), удар по
// брюху в 0,75 (средняя линия `f8_claw`), разлёт рук — по плечевым барабанам
// в 0,87 (крайние линии, это уже первый кадр отдыха); долгий отдых 1,2.
// «Брюхо» `belly` 1,5 с — ритм виден весь замах: удары R-L-R по брюху
// (0,3 / 0,55 / 0,8), двойной в 1,05 (кольцо `f8_boom` вне своей комнаты),
// L в 1,28 и главный двойной в 1,5 (событие `boom`, поворот комнаты).

import type { Mob } from '../dungeon-sim';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import {
  alphaC,
  carry,
  dirN,
  draw,
  easeIn,
  easeOut,
  fi,
  frameOf,
  FPS,
  hash,
  hurtF,
  hurtFx,
  hx,
  kindOf,
  mod,
  moving,
  Rig,
  sampleKeys,
  sstep,
  tn,
  TAU,
  vadd,
  visOf,
  vmul,
  vnorm,
  vsub,
  warmAll,
  yawN,
  type PKey,
  type Pic,
  type RGBA,
  type V3,
} from './f8-mobkit';
import { atP, gait, oniBase, oniRig, type OniJ, type OniO, type OniStyle } from './f8-mob-oni';

const ST: OniStyle = {
  skin: tn('#4a1a1a', '#7a2a24', '#a8443a', '#d06a58'),
  top: tn('#1a1418', '#2a2228', '#3e343c', '#5a4e58'),
  pants: tn('#2a1a14', '#44281c', '#623a28', '#845034'),
  under: hx('#d8c8a8'),
  sash: hx('#e8b84a'),
  hair: tn('#b8b0a0', '#e0d8c8', '#f4ecdc', '#ffffff'),
  hairKind: 'wild',
  horns: 2,
  horn: tn('#3a2a1a', '#5a4428', '#8a6a3a', '#b8945a'),
  eye: hx('#ffb040'),
  leg: 7.4,
  hipW: 2.0,
  torso: 8.0,
  chestW: 3.3,
  chestD: 2.4,
  headR: 3.2,
  arm: 6.8,
  sleeve: 0,
  hakama: true,
  belly: 2.6,
  fang: true,
  thick: 1.3,
};

const RED = tn('#5a0a0a', '#9a1a14', '#c8382a', '#f06a4a');
const GILT = hx('#e8b84a');
const HEAD_T = tn('#a88858', '#d0b080', '#ecd4a0', '#fff0c8');
const STICK = { T: tn('#3a2410', '#6a4420', '#9a6a34', '#c89a5a') };

/** Барабан: корпус с гвоздями по ободу, кожа с томоэ (вспыхивает от удара). */
function drumMats(hit: number) {
  return {
    body: {
      T: RED,
      spec: true,
      pat: (q: V3) => {
        // Гвозди — точки по двум ободам.
        const ring = Math.abs(Math.abs(q[0]) - 0.72) < 0.1;
        const a = Math.atan2(q[2], q[1]);
        return ring && ((a / TAU) * 12 + 12) % 1 < 0.35 ? GILT : null;
      },
    },
    head: {
      T: hit > 0 ? (HEAD_T.map((c) => mixW(c, hit)) as typeof HEAD_T) : HEAD_T,
      glow: hit * 0.8,
      pat: (q: V3) => {
        // Томоэ: три запятые вокруг центра.
        const r = Math.hypot(q[1], q[2]);
        const a = Math.atan2(q[2], q[1]);
        const k = ((a / TAU) * 3 + 3 + r * 0.6) % 1;
        return r > 0.25 && r < 0.7 && k < 0.22 ? RED[1] : r < 0.2 ? RED[1] : null;
      },
    },
  };
}
const mixW = (c: RGBA, k: number): RGBA => [
  Math.round(c[0] + (255 - c[0]) * k),
  Math.round(c[1] + (255 - c[1]) * k),
  Math.round(c[2] + (255 - c[2]) * k),
  255,
];

const B0: OniO = {
  ...oniBase(ST),
  hu: -0.8,
  lean: 0.06,
  aL: [2.2, -0.6, -4.2],
  aR: [2.2, 0.6, -4.2],
  brow: 0.8,
};

// Точки ударов (оси корпуса): кисть над кожей барабана — палка смотрит вниз-вперёд.
const SH = (s: number): V3 => [0, s * ST.chestW * 0.92, ST.torso * 0.84];
const to = (sh: V3, p: V3): V3 => vsub(p, sh);
const BELLY_HAND = (s: number): V3 => to(SH(s), [ST.chestD + 3.2, s * 1.3, ST.torso * 0.36 + 2.4]);
const UP_HAND = (s: number, k = 1): V3 => [0.4 - 0.6 * k, s * 1.8, 4.2 + 0.8 * k];
const SHOULDER_HAND = (s: number): V3 => [0.4, s * 6.2, 2.4];

// ---- Треки -----------------------------------------------------------------------------

/** «Когти» 0,85: палки вверх, задержка, удар по брюху в 0,75, разлёт к плечам. */
const SIDE: PKey<OniO>[] = carry<OniO>([
  [0, {}],
  [0.3, { aL: UP_HAND(-1), aR: UP_HAND(1), lean: -0.2, hu: -0.4, mouth: 0.5, brow: 1 }, easeOut],
  [0.62, { aL: UP_HAND(-1, 1.3), aR: UP_HAND(1, 1.3), lean: -0.28, hu: -0.2 }],
  [0.75, { aL: BELLY_HAND(-1), aR: BELLY_HAND(1), lean: 0.2, hu: -1.3, mouth: 1 }, easeIn],
  [0.85, { aL: [0.6, -4.2, 3.4], aR: [0.6, 4.2, 3.4], lean: -0.05, hu: -0.9 }, easeOut],
]);
/** Отдых после «когтей» 1,2: удар по плечам в 0,02, отскок, палки опущены, пыхтит. */
const SIDEF: PKey<OniO>[] = carry<OniO>([
  [0, { ...SIDE[4][1] }],
  [0.03, { aL: SHOULDER_HAND(-1), aR: SHOULDER_HAND(1), hu: -1.1, mouth: 1 }, easeIn],
  [0.18, { aL: [0.8, -4.4, 2.0], aR: [0.8, 4.4, 2.0], hu: -0.9 }, easeOut],
  [0.6, { aL: [1.6, -1.6, -5.2], aR: [1.6, 1.6, -5.2], lean: 0.25, hp: 0.3, mouth: 0.6, brow: 0.4 }],
  [1.2, { ...B0 }],
]);

/** Ритм «брюха»: время удара и руки (L, R, B — обе). */
const BEATS: [number, 'L' | 'R' | 'B'][] = [
  [0.3, 'R'],
  [0.55, 'L'],
  [0.8, 'R'],
  [1.05, 'B'],
  [1.28, 'L'],
  [1.5, 'B'],
];
function bellyKeys(): PKey<OniO>[] {
  const keys: PKey<OniO>[] = [[0, {}]];
  const mid = (s: number): V3 => [2.6, s * 1.6, -1.6];
  for (const [tb, h] of BEATS) {
    const big = h === 'B';
    const pre = big ? 0.17 : 0.11;
    const upL = h === 'R' ? mid(-1) : UP_HAND(-1, big ? 1.3 : 0.7);
    const upR = h === 'L' ? mid(1) : UP_HAND(1, big ? 1.3 : 0.7);
    keys.push([tb - pre, { aL: upL, aR: upR, hu: big ? -0.3 : -0.6, lean: big ? -0.22 : -0.08, mouth: big ? 0.6 : 0.3 }, easeOut]);
    const dnL = h === 'R' ? mid(-1) : BELLY_HAND(-1);
    const dnR = h === 'L' ? mid(1) : BELLY_HAND(1);
    keys.push([tb, { aL: dnL, aR: dnR, hu: big ? -1.6 : -1.0, lean: big ? 0.22 : 0.1, mouth: big ? 1 : 0.5 }, easeIn]);
  }
  return carry<OniO>(keys);
}
const BELLY = bellyKeys();
/** Отдых после «брюха» 1,2: гул — живот дрожит, палки висят, выпрямляется. */
const BELLYF: PKey<OniO>[] = carry<OniO>([
  [0, { ...BELLY[BELLY.length - 1][1] }],
  [0.12, { hu: -1.3, aL: [2.4, -1.6, -1.2], aR: [2.4, 1.6, -1.2] }, easeOut],
  [0.6, { aL: [1.6, -1.6, -5.2], aR: [1.6, 1.6, -5.2], lean: 0.2, hp: 0.25, mouth: 0.5 }],
  [1.2, { ...B0 }],
]);
const FLINCH: PKey<OniO>[] = [
  [0, {}],
  [0.05, { lean: -0.3, hf: -0.8, hp: -0.4, aL: [0.6, -3.0, 0.4], aR: [0.6, 3.0, 0.8], squint: 1, mouth: 0.7 }, easeOut],
  [0.2, {}],
];
/** Смерть 0,8: палки вылетают, оседает на колени, валится навзничь на брюшной барабан. */
const DIE: PKey<OniO>[] = carry<OniO>([
  [0, { lean: -0.3, hp: -0.5, aL: [0.4, -3.4, 3.0], aR: [0.4, 3.4, 3.4], mouth: 1, squint: 1 }],
  [0.2, { hu: -4.0, lean: 0.15, hp: 0.4, fL: [2.6, -2.0, 0], fR: [2.2, 2.0, 0], aL: [1.4, -2.6, -5.0], aR: [1.4, 2.6, -5.0] }, easeIn],
  [0.36, { hu: -4.2, lean: 0.25 }],
  [0.56, { hu: -6.0, lean: -1.35, hf: -2.2, hp: -0.3, fL: [3.0, -2.0, 1.4], fR: [2.6, 2.0, 1.8], aL: [0.4, -4.6, 0.6], aR: [0.4, 4.6, 0.8] }, easeIn],
  [0.64, { hu: -5.4 }, easeOut],
  [0.72, { hu: -6.1 }, easeIn],
  [0.8, { hu: -6.1 }],
]);

// ---- Поза по кадру ---------------------------------------------------------------------

const RUN_N = 10;
const IDLE_N = 12;

function poseAt(anim: string, f: number): [OniO, OniO, V3] {
  const t = (f + 0.5) / FPS;
  const lagT = t - 3 / FPS;
  const at = (keys: PKey<OniO>[], T: number) => sampleKeys(B0, keys, Math.max(0, T));
  switch (anim) {
    case 'idle': {
      // Постукивает палкой по брюху в такт дыханию.
      const mk = (q: number): OniO => ({
        ...B0,
        hu: B0.hu + Math.sin(q) * 0.3,
        hy: Math.sin(q * 0.5) * 0.25,
        aR: [2.4, 0.9, -3.0 + Math.max(0, Math.sin(q * 2)) * 1.6],
      });
      const q = (f / IDLE_N) * TAU;
      return [mk(q), mk(q - 0.8), [0, 0, 0]];
    }
    case 'run': {
      const mk = (p: number): OniO => {
        const g = gait({ ...B0, lean: 0.15, hu: -1.1 }, ST, p, 5.6, 1.8, 0.7);
        g.hu -= Math.max(0, Math.cos(p * TAU * 2)) * 0.5;
        return g;
      };
      const ph = f / RUN_N;
      return [mk(ph), mk(ph - 0.12), [-1.2, 0, 0]];
    }
    case 'side':
      return [at(SIDE, t), at(SIDE, lagT), [0, 0, 0]];
    case 'sidef':
      return [at(SIDEF, t), at(SIDEF, lagT), [0, 0, 0]];
    case 'belly':
      return [at(BELLY, t), at(BELLY, lagT), [0, 0, 0]];
    case 'bellyf':
      return [at(BELLYF, t), at(BELLYF, lagT), [0, 0, 0]];
    case 'flinch':
      return [at(FLINCH, t), at(FLINCH, lagT), [0, 0, 0]];
    case 'die':
      return [at(DIE, t), at(DIE, lagT), [0, 0, 0]];
    case 'stun': {
      const q = (f / 6) * TAU;
      const o: OniO = {
        ...B0,
        hu: -1.2,
        lean: 0.12 + Math.sin(q) * 0.1,
        roll: Math.cos(q) * 0.14,
        hr: Math.sin(q) * 0.3,
        hy: Math.cos(q) * 0.3,
        aL: [1.2, -2.6, -5.2],
        aR: [1.2, 2.6, -5.2],
        squint: 1,
        mouth: 0.5,
      };
      return [o, o, [0, 0, 0]];
    }
  }
  return [B0, B0, [0, 0, 0]];
}

/** Какие барабаны звучат в кадре: [брюхо, левое плечо, правое плечо] 0…1. */
function hitsOf(anim: string, f: number): [number, number, number] {
  const t = (f + 0.5) / FPS;
  const near = (tb: number) => Math.max(0, 1 - Math.abs(t - tb) * FPS * 0.6);
  if (anim === 'side') return [near(0.75), 0, 0];
  if (anim === 'sidef') {
    const k = near(0.03);
    return [0, k, k];
  }
  if (anim === 'belly') return [Math.max(...BEATS.map(([tb, h]) => near(tb) * (h === 'B' ? 1 : 0.7))), 0, 0];
  if (anim === 'bellyf') return [near(0), 0, 0];
  return [0, 0, 0];
}

// ---- Барабаны и палки ------------------------------------------------------------------

function drums(r: Rig, J: OniJ, hits: [number, number, number], torn: number): V3[] {
  const C = J.C;
  const out: V3[] = [];
  // Брюхо: ось вперёд.
  const mb = drumMats(hits[0]);
  const bc = C.p(ST.chestD + 0.9, 0, ST.torso * 0.36);
  r.ell(atP(C, bc), [0, 0, 0], [2.3, 4.1, 3.9], mb.body);
  if (torn < 1) r.ell(atP(C, bc), [2.0, 0, 0], [0.55, 3.5, 3.3], mb.head);
  out.push(C.p(ST.chestD + 3.0, 0, ST.torso * 0.36));
  // Плечи: ось наружу.
  for (const s of [-1, 1]) {
    const m = drumMats(s < 0 ? hits[1] : hits[2]);
    const c = C.p(-0.4, s * (ST.chestW + 1.8), ST.torso * 0.98);
    r.ell(atP(C, c), [0, 0, 0], [3.0, 1.9, 3.0], m.body);
    if (torn < 1) r.ell(atP(C, c), [0, s * 1.7, 0], [2.6, 0.5, 2.6], m.head);
    out.push(C.p(-0.4, s * (ST.chestW + 3.6), ST.torso * 0.98));
  }
  return out;
}

/** Палки-бати по ходу предплечья; в смерти — улетают (не рисуются). */
function sticks(r: Rig, J: OniJ): void {
  for (const s of [-1, 1]) {
    const el = s < 0 ? J.elL : J.elR;
    const ha = s < 0 ? J.haL : J.haR;
    const d = vnorm(vsub(ha, el));
    const a = vadd(ha, vmul(d, -0.6));
    const b = vadd(ha, vmul(d, 4.6));
    r.cap(a, b, 0.42, 0.42, STICK);
    r.ball(b, 0.7, STICK);
  }
}

// ---- Кадр ------------------------------------------------------------------------------

const K = kindOf('f8_drum', 80, 66, 40, 50, 1400);

function drumPic(anim: string, f: number, d: number): Pic {
  const yaw = yawN(d);
  const [o, lagO, wind] = poseAt(anim, f);
  const dead = anim === 'die' && f > 8;
  const r = new Rig();
  const J = oniRig(r, o, ST, yaw, { lag: lagO, wind, dead });
  const hits = hitsOf(anim, f);
  const heads = drums(r, J, hits, anim === 'die' && f >= 13 ? 1 : 0);
  if (!(anim === 'die' && f >= 2)) sticks(r, J);
  if (dead) r.eye = null;
  return draw(K, r, (p, lit, P) => {
    // Удар: кольца звука от кожи барабана (поверх темноты).
    hits.forEach((h, i) => {
      if (h < 0.3) return;
      const [x, y] = P(heads[i]);
      const L = lit();
      for (const R of [2.5, 4.5]) {
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * TAU;
          L.set(Math.floor(x + Math.cos(a) * R), Math.floor(y + Math.sin(a) * R * 0.75), alphaC(hx('#fff0c8'), h * (R < 3 ? 0.9 : 0.5)));
        }
      }
    });
    if (anim === 'die' && f >= 2 && f <= 12) {
      // Палки летят прочь, кувыркаясь.
      const k = (f - 2) / 10;
      for (const s of [-1, 1]) {
        const [x, y] = P(J.B.p(-2 * k, s * (4 + k * 8), 10 + k * 6 - k * k * 14));
        const a = f * 0.9 + s;
        for (let i = -2; i <= 2; i++) p.set(Math.floor(x + Math.cos(a) * i), Math.floor(y + Math.sin(a) * i), STICK.T[2]);
      }
    }
    if (anim === 'die' && f >= 13 && f <= 17) {
      // Удар о пол лопнувшим барабаном — щепа и кожа клочьями.
      const k = (f - 13) / 4;
      const [x, y] = P(heads[0]);
      for (let i = 0; i < 10; i++) {
        const a = hash(i, 3) * TAU;
        const R = 2 + k * (4 + hash(i, 5) * 5);
        p.set(Math.floor(x + Math.cos(a) * R), Math.floor(y + Math.sin(a) * R * 0.7 - k * 2), i % 2 ? RED[2] : HEAD_T[2]);
      }
    }
    if (anim === 'stun') {
      const [hxp, hyp] = P(J.H.p(0, 0, ST.headR * 1.8));
      for (let i = 0; i < 3; i++) {
        const a = (f / 6) * TAU + (i / 3) * TAU;
        const x = Math.floor(hxp + Math.cos(a) * 5);
        const y = Math.floor(hyp - 2 + Math.sin(a) * 1.6);
        lit().set(x, y, hx('#fff27a'));
        p.set(x, y, hx('#ffffff'));
      }
    }
  });
}

registerMobPainter('f8_drum', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 6);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 8 };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 19);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.64, 0.85, t);
    ex.shadow = 8 * (1 - sstep(0.55, 0.8, t));
    ex.still = true;
  } else if (md === 'side') {
    anim = 'side';
    f = fi(t, 20);
    ex.still = true;
  } else if (md === 'belly') {
    anim = 'belly';
    f = fi(t, 35);
    ex.still = true;
  } else if (md === 'recover') {
    anim = v.prev === 'belly' ? 'bellyf' : 'sidef';
    f = fi(t, 28);
    ex.still = true;
  } else if (md === 'stun') {
    anim = 'stun';
    f = mod(now * 14, 6);
  } else if (hurtF(v, now) >= 0 && !moving(m)) {
    anim = 'flinch';
    f = hurtF(v, now);
  } else if (moving(m)) {
    anim = 'run';
    // Шаг — по пройденному пути (пятится — назад): цикл 1,0 клетки.
    f = mod(v.dist * RUN_N, RUN_N);
  } else {
    anim = 'idle';
    f = mod((now + hash(id, 7) * 4) * 6, IDLE_N);
  }
  // Удар по барабану — корпус вздрагивает (вес).
  const h = hitsOf(anim, f);
  if (Math.max(...h) > 0.6) {
    ex.sx = 1.05;
    ex.sy = 0.96;
  }
  if (md === 'f8_out') ex.alpha = 0.25 + 0.75 * easeOut(t / 0.4);
  if (md !== 'dying') hurtFx(v, now, 1.0, ex);
  return { ...frameOf(K, anim, f, d, pose, () => drumPic(anim, f, d)), ...ex };
});

registerMobWarm('f8_drum', function* () {
  yield* warmAll(
    K,
    [
      ['run', RUN_N],
      ['idle', IDLE_N],
      ['side', 21],
      ['sidef', 29],
      ['belly', 36],
      ['bellyf', 29],
      ['flinch', 5],
      ['stun', 6],
      ['die', 20],
    ],
    drumPic,
  );
});
