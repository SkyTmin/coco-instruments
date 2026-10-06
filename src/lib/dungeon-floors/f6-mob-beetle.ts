// Этаж 6 — Жук-огнёвка (анимации мобов 6). Облик прежнего жука: обугленный
// купол надкрылий с тлеющими полосами, рыжие лапы, брюшко дышит светом и
// перед укусом разгорается. Мини-3D риг (`f15-rig.ts`), 8 сторон честно.
//
// Бегает трёхногой походкой (тройки лап попеременно), шаг — по пути; рывки
// зигзагом мозга — курс с пределом поворота, корпус кренится в поворот. Укус
// (0,3 с — весь замах): приседает задом, задирает перед, жвала настежь, брюшко
// раскаляется; бросок — кадр контакта = первый кадр `recover`; отдача.
// Смерть: раскаляется добела (0,18 с — когда мозг кладёт угли), лопается:
// надкрылья отлетают, лапы поджимаются, угли гаснут (0,7 с).

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { F3, Rig, vadd, vlerp } from './f15-rig';
import type { Mat } from './f15-rig';
import {
  alpha,
  angD,
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
  headOf,
  hurtFx,
  hx,
  kf,
  kindOf,
  litOn,
  mixc,
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
import type { Pic, RGBA } from './f6-mobkit';

const SHELL = tn('#1a100c', '#33201a', '#553226', '#86503a');
const EMBER = hx('#7a2a16');
const EMBER_HOT = hx('#ff9a38');
const LEG = tn('#4a1606', '#9a3a0c', '#ff8a24', '#ffc060');
const HEAD = tn('#140c0a', '#2a1a14', '#46302a', '#6e4c3e');
const JAW = hx('#d8b070');
const EYE = hx('#ffe060');
const BELLY = tn('#5a1c08', '#c84a10', '#ff9a30', '#ffe07a');

interface BugO {
  fwd: number;
  lift: number;
  pitch: number;
  roll: number;
  /** Голова: нос вниз (+); жвала 0…1. */
  head: number;
  jaw: number;
  /** Брюшко: жар 0…1 (свет полос и брюшка), подъём заднего края. */
  heat: number;
  gas: number;
  /** Усики: назад 0…1, взмах. */
  ant: number;
  antW: number;
  /** Шаг: фаза 0…1, доля; лапы поджаты; дрыгают. */
  ph: number;
  step: number;
  tuck: number;
  kick: number;
  /** Надкрылья отлетели 0…1 (смерть). */
  pop: number;
  /** Темнее (угли гаснут). */
  dark: number;
  snap: number;
}
const B0: BugO = {
  fwd: 0,
  lift: 0,
  pitch: 0,
  roll: 0,
  head: 0,
  jaw: 0.2,
  heat: 0.3,
  gas: 0,
  ant: 0.2,
  antW: 0,
  ph: 0,
  step: 0,
  tuck: 0,
  kick: 0,
  pop: 0,
  dark: 0,
  snap: 0,
};

const FOOT_F = [3.4, 0.4, -3.2];
const FOOT_S = [4.4, 5.0, 4.6];
const HIP_F = [1.4, 0.3, -0.9];

function bugRig(o: BugO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const zc = 2.6 + o.lift;
  const C = B.at(o.fwd, 0, zc).pitch(o.pitch).roll(o.roll);
  const heat = clamp01(o.heat);
  const stripe = mixc(EMBER, EMBER_HOT, heat);
  const shellM: Mat = {
    T: SHELL,
    spec: true,
    bias: -o.dark,
    pat: (q) => {
      // Шов надкрылий — тёмный; поперечные полосы тлеют.
      if (Math.abs(q[1]) < 0.09 && q[2] > 0) return SHELL[0];
      const b = Math.abs((((q[0] + 1.2) * 2.6) % 1) - 0.5);
      if (b < 0.12 && q[2] > -0.2) return stripe;
      return null;
    },
    gpat: (q) => {
      if (Math.abs(q[1]) < 0.09 && q[2] > 0) return 0;
      const b = Math.abs((((q[0] + 1.2) * 2.6) % 1) - 0.5);
      return b < 0.12 && q[2] > -0.2 ? heat * 0.9 * (1 - o.dark) : 0;
    },
  };
  const legM: Mat = { T: LEG, bias: -o.dark };
  const headM: Mat = { T: HEAD, bias: -o.dark };
  // Брюшко: светится из-под заднего края надкрылий.
  const G = C.at(-1.6, 0, -0.6).pitch(-o.gas);
  r.ell(G, [-0.6, 0, 0], [2.8, 2.6, 1.4], {
    T: BELLY,
    glow: (0.35 + heat * 0.6) * (1 - o.dark),
    bias: -0.2 + heat * 0.4 - o.dark,
  });
  // Надкрылья: две половины купола; на смерти отлетают.
  const pop = o.pop;
  for (const sd of [-1, 1]) {
    const E = C.at(-0.2, sd * (0.05 + pop * 3.5), 0.4 + pop * 4 - pop * pop * 5).roll(
      sd * pop * 1.6,
    );
    r.ell(E, [0, sd * 1.55, 0.2], [3.9, 1.75, 2.15], shellM, (q) => q[1] * sd < -0.85);
  }
  // Голова и жвала.
  const H = C.at(3.2, 0, -0.1).pitch(o.head);
  r.ell(H, [0.6, 0, 0], [1.5, 1.7, 1.25], headM);
  for (const sd of [-1, 1]) {
    r.dot(H.p(1.2, sd * 1.2, 0.8), EYE, 0.8 * (1 - o.dark), 1, 1.5);
    const j0 = H.p(1.6, sd * 0.8, -0.4);
    const j1 = H.p(2.9, sd * (0.9 + o.jaw * 1.4), -0.5);
    const j2 = H.p(3.5, sd * (0.15 + o.jaw * 1.5), -0.55);
    r.cap(j0, j1, 0.5, 0.4, { T: [hx('#5a3a1a'), hx('#8a6030'), JAW, hx('#f4e0b0')] });
    r.line(j1, j2, JAW, 0, 0.5);
    // Усики.
    const a0 = H.p(1.4, sd * 0.7, 0.9);
    const a1 = H.p(2.6 - o.ant * 2, sd * (1.6 + o.ant), 2.6 + o.antW * (sd > 0 ? 1 : -0.7));
    r.line(a0, a1, LEG[1], 0, 0.5);
  }
  r.eye = H.p(1.2, (Math.cos(yaw) >= 0 ? 1 : -1) * 1.2, 0.8);
  if (o.snap > 0) r.dot(H.p(3.6, 0, -0.5), alpha(hx('#fff4c0'), o.snap), 1, 2, 1);
  // Лапы: тройки попеременно.
  for (let i = 0; i < 3; i++)
    for (const sd of [-1, 1]) {
      const hip = C.p(HIP_F[i], sd * 1.4, -0.8);
      const grp = (i + (sd > 0 ? 1 : 0)) % 2;
      const ps = mod((o.ph + grp * 0.5) * 1000, 1000) / 1000;
      const L = 3.2 * o.step;
      let off = 0;
      let rise = 0;
      if (ps < 0.5) off = L / 2 - L * (ps / 0.5);
      else {
        off = -L / 2 + L * ((ps - 0.5) / 0.5);
        rise = Math.sin(PI * ((ps - 0.5) / 0.5)) * 1.3 * o.step;
      }
      let foot = B.p(FOOT_F[i] + o.fwd * 0.4 + off, sd * FOOT_S[i], rise);
      if (o.tuck > 0) {
        const kk = o.kick * Math.sin(i * 2.1 + (sd > 0 ? 1.3 : 0));
        foot = vlerp(foot, C.p(HIP_F[i] * 0.9 + kk * 0.5, sd * (2.4 + kk * 0.4), -1.6), o.tuck);
      }
      const mid = vlerp(hip, foot, 0.45);
      const knee = vadd(mid, vadd(B.v(0, sd * 0.9, 0), [0, 0, 2.0 * (1 - o.tuck * 0.6)]));
      r.cap(hip, knee, 0.55, 0.45, legM);
      r.cap(knee, foot, 0.45, 0.3, legM);
    }
  return r;
}

/** Угли из лопнувшего жука: искры дугами, гаснут. */
function sparks(p: Pic['p'], lit: Pic['p'], cx: number, cy: number, k: number, seed: number) {
  for (let i = 0; i < 9; i++) {
    const a = hash(i, seed) * TAU;
    const v = 0.6 + hash(i, seed, 3) * 0.9;
    const x = cx + Math.cos(a) * k * 9 * v;
    const y = cy + Math.sin(a) * k * 5 * v - k * 8 * v + k * k * 10;
    const c: RGBA = k < 0.4 ? FIRE[4] : k < 0.7 ? FIRE[3] : FIRE[1];
    if (hash(i, seed, 9) < 1 - k * 0.6) {
      p.set(Math.round(x), Math.round(y), c);
      lit.set(Math.round(x), Math.round(y), c);
    }
  }
}

function bugPose(anim: string, f: number): BugO {
  const o: BugO = { ...B0 };
  switch (anim) {
    case 'idle': {
      // 8 кадров по 6 к/с: брюшко дышит светом, усики ощупывают.
      const a = (f / 8) * TAU;
      o.heat = 0.3 + 0.25 * (0.5 + 0.5 * Math.sin(a));
      o.gas = 0.06 * Math.sin(a);
      o.ant = 0.2 + 0.15 * Math.sin(a * 2);
      o.antW = Math.sin(a * 2 + 1) * 0.8;
      o.jaw = 0.2 + 0.15 * Math.max(0, Math.sin(a * 2));
      o.lift = 0.1 * Math.sin(a);
      break;
    }
    case 'run': {
      // 8 кадров на цикл (0,45 клетки пути).
      o.ph = f / 8;
      o.step = 1;
      o.lift = 0.25 * Math.abs(Math.sin(o.ph * TAU));
      o.pitch = 0.05;
      o.ant = 0.55;
      o.antW = Math.sin(o.ph * TAU) * 0.6;
      o.heat = 0.45;
      o.gas = 0.04 * Math.sin(o.ph * TAU * 2);
      break;
    }
    case 'bite': {
      // Замах 0,3 с (7 кадров): зад вниз, перед вверх, жвала настежь,
      // брюшко раскаляется (до 0,6), дрожь (до 0,8), бросок (до 1).
      const k = kf(f, 0.3);
      o.fwd = trk(k, [
        [0, 0],
        [0.6, -1.4, easeOut],
        [0.8, -1.5],
        [1, 1.4, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.6, -0.35, easeOut],
        [0.8, -0.38],
        [1, 0.12, easeIn],
      ]);
      o.lift = trk(k, [
        [0, 0],
        [0.6, 0.6],
        [1, 0.1, easeIn],
      ]);
      o.jaw = trk(k, [
        [0, 0.2],
        [0.5, 1, easeOut],
        [1, 1],
      ]);
      if (k > 0.6 && k < 0.85) o.jaw += f % 2 ? 0.08 : -0.06;
      o.heat = 0.4 + 0.6 * easeOut(k / 0.6);
      o.gas = 0.25 * sstep(0, 0.6, k);
      o.ant = 0.7;
      break;
    }
    case 'bitef': {
      // Отдых 0,4 с: сомкнул (вспышка), проводка, отдача, жар стихает.
      const t = f / FPS;
      o.fwd = trk(t, [
        [0, 1.6],
        [0.05, 1.9, easeOut],
        [0.2, -0.5],
        [0.4, 0],
      ]);
      o.pitch = trk(t, [
        [0, 0.12],
        [0.08, 0.1],
        [0.22, -0.05],
        [0.4, 0],
      ]);
      o.jaw = trk(t, [
        [0, 0],
        [0.12, 0],
        [0.26, 0.5],
        [0.4, 0.2],
      ]);
      o.heat = 1 - 0.6 * sstep(0, 0.4, t);
      o.gas = trk(t - 0.05, [
        [0, -0.15],
        [0.12, 0.12],
        [0.3, 0],
      ]);
      o.snap = f === 0 ? 1 : f === 1 ? 0.5 : 0;
      o.ant = 0.7 - t;
      break;
    }
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      o.fwd = -1 * b;
      o.lift = -0.4 * b;
      o.head = -0.3 * b;
      o.jaw = 0.2 + 0.6 * b;
      o.gas = 0.3 * b;
      o.ant = 0.2 + 0.7 * b;
      o.heat = 0.3 + 0.5 * b;
      break;
    }
    case 'sleep': {
      o.tuck = 1;
      o.lift = -1.1;
      o.head = 0.3;
      o.ant = 0.9;
      o.jaw = 0.05;
      o.heat = 0.12 + (f ? 0.1 : 0);
      break;
    }
    case 'alert': {
      const k = kf(f, 0.35);
      const up = Math.sin(PI * Math.min(1, k * 1.4));
      o.pitch = -0.3 * up;
      o.lift = 0.6 * up;
      o.ant = 0.2 - 0.3 * up;
      o.jaw = 0.2 + 0.5 * up;
      o.heat = 0.3 + 0.6 * easeOut(k);
      break;
    }
    case 'die': {
      // 0,7 с (17 кадров): раскаляется добела (0–0,18), лопается — надкрылья
      // отлетают, лапы поджаты и дрыгают, угли гаснут.
      const t = f / FPS;
      o.heat = t < 0.18 ? 0.6 + 2.2 * t : 1;
      o.gas = t < 0.18 ? 0.4 * (t / 0.18) : 0.1;
      o.lift = t < 0.18 ? 0.5 * (t / 0.18) : -1.2 * sstep(0.18, 0.35, t);
      o.pop = sstep(0.17, 0.5, t);
      o.tuck = sstep(0.18, 0.35, t);
      o.kick = t > 0.2 ? Math.sin(f * 2.3) * 1.4 * (1 - sstep(0.2, 0.6, t)) : 0;
      o.jaw = 0.9;
      o.ant = 0.9;
      o.dark = 0.5 * sstep(0.3, 0.7, t);
      o.roll = (f % 2 ? 0.06 : -0.06) * (t < 0.18 ? 1 : 0);
      break;
    }
  }
  return o;
}

const BUG = kindOf('f6_beetle', 36, 30, 18, 20, 1400);

function bugPic(anim: string, f: number, d: number): Pic {
  const o = bugPose(anim, f);
  return draw(BUG, bugRig(o, yawN(d)), (out, P) => {
    if (anim === 'die') {
      const t = f / FPS;
      const lit = litOn(out);
      const [cx, cy] = P([0, 0, 2.4]);
      if (t < 0.2) {
        // Раскалился: белое ядро под панцирем.
        const k = t / 0.2;
        out.p.ell(cx, cy - 1, 1 + k * 2.2, 0.8 + k * 1.6, alpha(FIRE[4], 0.5 + k * 0.4));
        lit.ell(cx, cy - 1, 1 + k * 2.2, 0.8 + k * 1.6, alpha(FIRE[4], 0.6 + k * 0.4));
      } else sparks(out.p, lit, cx, cy, clamp01((t - 0.18) / 0.5), 3);
    }
  });
}

registerMobPainter('f6_beetle', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const tech = md === 'windup' || md === 'alert';
  const want = tech ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, tech ? 18 : 12);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5, still: true };
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 16);
    ex.alpha = 1 - sstep(0.55, 0.7, t);
    ex.shadow = 5 * (1 - sstep(0.3, 0.6, t));
    // Раскаляется — дрожит и пухнет.
    if (t < 0.18) {
      ex.sx = 1 + t * 0.8;
      ex.sy = 1 + t * 0.8;
      ex.dx = f % 2 ? 0.5 : -0.5;
    }
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 6);
  } else if (md === 'recover' && v.prev === 'windup') {
    anim = 'bitef';
    f = fi(t, 9);
    if (f <= 1) {
      ex.sx = 1.12;
      ex.sy = 0.9;
    }
  } else if (md === 'stun') {
    anim = 'flinch';
    f = fi(t, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(now * 1.3 + hash(id, 3) * 2) % 2;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else if (moving(m)) {
    anim = 'run';
    f = Math.floor((v.dist / 0.45) * 8) % 8;
    // Крен в поворот: зигзаг виден корпусом, а не боковым ходом.
    const turn = angD(want, v.yaw);
    ex.rot = clamp01(Math.abs(turn) / 0.6) * Math.sign(turn) * 0.08;
  } else {
    anim = 'idle';
    f = Math.floor((now + hash(id, 7) * 3) * 6) % 8;
  }
  if (md !== 'dying') hurtFx(v, now, 1.2, ex);
  return { ...frameOf(BUG, anim, f, d, pose, () => bugPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_beetle', function* () {
  yield* warmAll(
    BUG,
    [
      ['run', 8],
      ['idle', 8],
      ['bite', 7],
      ['bitef', 10],
      ['flinch', 5],
      ['die', 17],
      ['alert', 9],
      ['sleep', 2],
    ],
    bugPic,
  );
});
