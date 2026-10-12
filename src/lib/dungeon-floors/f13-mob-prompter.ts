// Суфлёр (анимации мобов 13). Облик прежний: сутулый человечек в коричневом
// сюртуке, белый колпак с кисточкой загнут назад, очки, свиток роли в левой.
//
// Суфлёр прибит к своему месту у будки (`f13-brains.ts` суфлёр): `f13_peek` —
// читает роль (палец по строкам, взгляд поверх очков на героя, лизнул палец,
// перевернул лист), шепчет соседям (жест — когда мозг раздаёт подсказку,
// `buffCd` только что взведён), `aim` 0,55 с — вырывает лист, замахивается из-
// за головы, держит, бросает; бросок — в конце `aim`, кадр контакта — первый
// кадр `f13_peek` после `aim` (листок уже в полёте, рука вытянута, проводка
// поперёк тела). `f13_hide` — ныряет в люк под ногами (люк в кадре: крышка
// встала, из щели торчат колпак и очки, вертит головой), из люка выпрыгивает
// пружиной. 8 честных сторон (свиток слева, бросает правой). Не ходит.

import type { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { P, Rig, humanoid, hx, limb, onHead, v3, vadd, vnorm, vsc } from './f13-art';
import type { Body, Joints, Pose, RGBA, V3 } from './f13-art';
import {
  PI,
  TAU,
  dirN,
  dl,
  draw,
  eBack,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hash,
  hurtAge,
  hurtFx,
  hurtP,
  kindOf,
  lin,
  puff,
  smearInto,
  sstep,
  tf,
  track,
  visOf,
  warmAll,
  yawN,
} from './f13-mobkit';
import type { PKey, Pic, Proj2 } from './f13-mobkit';

// ---- тело (было в `f13-art.ts`) ------------------------------------------------

const PROMPT_BODY: Body = {
  hip: 6,
  torso: 6,
  waist: 3,
  chest: 3.2,
  neck: 0.4,
  head: 3.3,
  shW: 3,
  upper: 3.2,
  fore: 3,
  armR: 1.1,
  hand: 1.1,
  hipW: 1.5,
  thigh: 3.2,
  shin: 3,
  legR: 1.1,
  foot: 1.8,
  T: {
    torso: P.wood,
    arm: P.wood,
    leg: P.black,
    head: P.skin,
    hand: P.skin,
    foot: P.black,
    joint: P.wood,
    pelvis: P.wood,
  },
  joints: false,
};

/**
 * Поза суфлёра: колпак качнулся `cp` (+ вперёд, − назад; кисточка отстаёт),
 * перелистываемый лист `fl` (0 — нет; 0…π — летит через свиток), блик очков
 * `gl`.
 */
interface PP extends Pose {
  cp: number;
  fl: number;
  gl: number;
}
const pp = (o: Partial<PP>, b: PP): PP => ({ ...b, ...o });

/** Читает: сгорбился, свиток перед грудью, палец правой у строки. */
const P0: PP = {
  bob: 0,
  lean: 0.3,
  side: 0,
  twist: 0,
  hp: 0.12,
  hy: 0,
  hr: 0,
  aL: limb(1.0, 0.15, 1.0),
  aR: limb(0.9, 0.2, 1.2),
  lL: limb(0.25, 0.08, 0.5),
  lR: limb(0.1, 0.08, 0.45),
  sink: 1.5,
  cp: 0,
  fl: 0,
  gl: 0,
};

const AIM = 0.55;
const PK_N = 24;
const WH_N = 14;
const AIM_N = 14;
const THR_N = 11;
const DN_N = 8;
const HID_N = 12;
const UP_N = 8;
const HURT_N = 8;
const DIE_N = 20;
const DEEP = 14;

// ---- покой: роль ----------------------------------------------------------------

const R1 = pp({ aR: limb(0.95, 0.04, 1.25), hy: -0.16 }, P0);
const R2 = pp({ aR: limb(0.85, 0.32, 1.15), hy: 0.14, hp: 0.16 }, P0);
const PEER = pp(
  { hp: -0.42, lean: 0.22, aR: limb(0.45, 0.22, 0.6), gl: 1, cp: -0.15, bob: 0.3 },
  P0,
);
const LICK = pp({ aR: limb(1.35, 0.02, 2.35), hp: -0.02, cp: 0.08 }, P0);
const PK: PKey<PP>[] = [
  [0, R1],
  [3, R2, lin],
  [4, pp({ hp: 0.2 }, R1)],
  [7, R2, lin],
  [8, R1],
  [10, PEER, easeOut],
  [13, pp({ hy: -0.12 }, PEER)],
  [15, P0],
  [16, LICK, easeOut],
  [17, LICK],
  [18, P0],
  [19, pp({ fl: 0.9, aR: limb(1.15, -0.05, 1.3) }, P0)],
  [20, pp({ fl: 2.0, aR: limb(1.2, 0.2, 1.1), hy: 0.1 }, P0)],
  [21, pp({ fl: 2.9, aR: limb(1.05, 0.38, 1.0) }, P0)],
  [22, R1],
  [24, R1],
];

/** Шепчет подсказку: ладонь у рта, голова набок, подался вперёд. */
const W1 = pp(
  { aR: limb(1.25, 0.55, 2.05), hy: 0.55, hr: 0.15, side: 0.12, lean: 0.4, hp: 0, cp: 0.15 },
  P0,
);
const WH: PKey<PP>[] = [
  [0, P0],
  [0.1, W1, easeOut],
  [0.42, pp({ lean: 0.46, hp: 0.06, cp: 0.25 }, W1)],
  [0.58, P0],
];

// ---- бросок листа ---------------------------------------------------------------

/** Рвёт лист: правая к свитку. */
const T1 = pp({ aR: limb(1.1, -0.28, 1.45), sink: 2, lean: 0.36, hp: 0.12, cp: 0.2 }, P0);
/** Замах из-за головы, корпус довернул, свиток вперёд. */
const T2 = pp(
  {
    aR: limb(2.6, 0.35, 1.6),
    aL: limb(1.3, 0.25, 0.6),
    twist: 0.5,
    lean: -0.05,
    hp: -0.3,
    sink: 1,
    cp: -0.4,
    lL: limb(0.05, 0.08, 0.4),
    lR: limb(0.2, 0.08, 0.5),
  },
  P0,
);
/** Пик: дотянул, целится поверх очков. */
const T3 = pp({ aR: limb(2.75, 0.4, 1.8), twist: 0.6, lean: -0.1, gl: 1, cp: -0.3 }, T2);
/** Контакт: рука вытянута к цели, шаг вперёд. */
const TC = pp(
  {
    aR: limb(1.6, 0.12, 0.1),
    aL: limb(0.7, 0.3, 0.9),
    twist: -0.45,
    lean: 0.42,
    hp: -0.1,
    sink: 2,
    cp: 0.4,
    gl: 0,
    lL: limb(0.5, 0.1, 0.4),
    lR: limb(-0.3, 0.1, 0.4),
  },
  P0,
);
/** Проводка: рука ушла поперёк тела вниз. */
const TF = pp(
  { aR: limb(0.9, -0.3, 0.2), twist: -0.65, lean: 0.52, hp: 0.05, sink: 2.4, cp: 0.6 },
  TC,
);
/** Отдача. */
const TR = pp({ aR: limb(0.8, 0.2, 1.0), twist: -0.1, lean: 0.3, cp: 0, sink: 1.6 }, P0);
const AIM_K: PKey<PP>[] = [
  [0, P0],
  [0.1, T1],
  [0.21, T2, easeOut],
  [0.44, T3, lin],
  [AIM, TC, easeIn],
];
const THR_K: PKey<PP>[] = [
  [0, TC],
  [0.083, TF, easeOut],
  [0.21, TR],
  [0.42, P0, eBack],
];

// ---- люк ---------------------------------------------------------------------------

/** Присел, придержал колпак — и вниз. */
const N1 = pp(
  {
    sink: 3,
    lean: 0.15,
    hp: -0.1,
    aR: limb(2.5, 0.25, 2.2),
    aL: limb(1.1, 0.2, 1.1),
    lL: limb(0.6, 0.12, 1.3),
    lR: limb(0.5, 0.12, 1.25),
    cp: 0.3,
  },
  P0,
);
const N2 = pp({ sink: 1, bob: 1.2, lean: 0.05, toe: 0.4, cp: -0.35 }, N1);
const N3 = pp({ sink: DEEP, bob: 0, lean: 0.1, hp: -0.2, cp: -0.5, toe: 0 }, N1);
const DN: PKey<PP>[] = [
  [0, P0],
  [0.08, N1, easeOut],
  [0.13, N2, easeOut],
  [0.29, N3, easeIn],
];
/** Выпрыгнул: колпак сжат — пружина — перелёт — приземление. */
const U0 = pp({ sink: DEEP + 1, cp: 0.5, hp: 0.1 }, N3);
const U1 = pp(
  {
    sink: -1.5,
    bob: 1.5,
    lean: -0.1,
    hp: -0.25,
    aL: limb(1.6, 0.6, 0.6),
    aR: limb(1.8, 0.6, 0.6),
    lL: limb(0.1, 0.1, 0.2),
    lR: limb(-0.05, 0.1, 0.2),
    toe: 0.6,
    cp: -0.6,
  },
  P0,
);
const U2 = pp({ sink: 2.6, lean: 0.4, hp: 0.25, cp: 0.55, aR: limb(1.1, 0.3, 1.3) }, P0);
const UP: PKey<PP>[] = [
  [0, U0],
  [0.04, U0],
  [0.13, U1, easeOut],
  [0.21, U2, easeIn],
  [0.33, P0, eBack],
];

// ---- смерть: схватился за грудь, листы роли разлетелись, сел — и навзничь --------

const X1 = pp(
  {
    lean: -0.35,
    hp: -0.55,
    bob: 1.5,
    aL: limb(2.0, 0.8, 0.3),
    aR: limb(1.6, 0.4, 1.9),
    cp: -0.6,
    toe: 0.5,
  },
  P0,
);
const X2 = pp(
  {
    sink: 4,
    lean: 0.35,
    hp: 0.5,
    aL: limb(0.4, 0.6, 0.2),
    aR: limb(0.9, 0.3, 2.0),
    lL: limb(1.2, 0.3, 1.8),
    lR: limb(1.0, 0.3, 1.7),
    cp: 0.5,
    toe: 0,
  },
  P0,
);
const X3 = pp(
  {
    sink: 5.5,
    lean: -1.3,
    hp: -0.3,
    hr: 0.3,
    aL: limb(2.6, 1.0, 0.2),
    aR: limb(2.4, 0.9, 0.5),
    lL: limb(1.5, 0.3, 0.4),
    lR: limb(1.1, 0.25, 0.6),
    cp: -0.8,
  },
  X2,
);
const X4 = pp({ sink: 5, lean: -1.15, lL: limb(1.7, 0.3, 0.3), lR: limb(1.3, 0.25, 0.5) }, X3);
const DIE: PKey<PP>[] = [
  [0, P0],
  [0.08, X1, easeOut],
  [0.3, X2, easeIn],
  [0.48, X3, easeIn],
  [0.56, X4, easeOut],
  [0.64, X3, easeIn],
];

// ---- поза по анимации и кадру ------------------------------------------------

function pPose(anim: string, f: number): PP {
  const t = tf(f);
  switch (anim) {
    case 'pk':
      return track(f, PK);
    case 'wh':
      return track(t, WH);
    case 'aim':
      return track(t, AIM_K);
    case 'thr':
      return track(t, THR_K);
    case 'dn':
      return track(t, DN);
    case 'hid': {
      // В люке: вертит головой, колпак качается.
      const ph = (f / HID_N) * TAU;
      return pp(
        {
          hy: 0.7 * Math.sin(ph),
          hr: 0.12 * Math.sin(ph * 2),
          cp: 0.3 * Math.sin(ph - 0.8),
          gl: f === 3 || f === 9 ? 1 : 0,
        },
        N3,
      );
    }
    case 'up':
      return track(t, UP);
    case 'hu': {
      const q = hurtP(P0, t) as PP;
      const k = t < 0.05 ? t / 0.05 : 1 - sstep(0.05, 0.3, t);
      return { ...q, cp: -0.6 * k };
    }
    case 'al': {
      const k = Math.sin(PI * Math.min(1, t / 0.35));
      return pp(
        {
          bob: 2.2 * k,
          hp: P0.hp - 0.5 * k,
          lean: P0.lean - 0.3 * k,
          aL: dl(P0.aL, 0.6 * k, 0.3 * k),
          aR: dl(P0.aR, 0.9 * k, 0.4 * k),
          cp: -0.5 * k,
          gl: k > 0.6 ? 1 : 0,
          toe: 0.4 * k,
        },
        P0,
      );
    }
    case 'sl': {
      // Задремал над ролью: голова клюёт.
      const nod = f === 1 || f === 2 ? 0.12 : 0;
      return pp(
        { hp: 0.55 + nod, lean: 0.42, sink: 2, aR: limb(0.5, 0.2, 0.8), cp: 0.5 + nod },
        P0,
      );
    }
    case 'die':
      return track(t, DIE);
  }
  return P0;
}

// ---- рисунок -----------------------------------------------------------------

const PAGE_C = P.cream;

/** Свиток в левой: валик и свисающий лист; `fl` — перелистываемый лист. */
function scroll(rig: Rig, j: Joints, q: PP, dead: boolean): void {
  const c = j.haL;
  const s = vnorm(v3(j.right.x, 0, j.right.z));
  const a = vadd(c, vsc(s, -1.6));
  const b = vadd(c, vsc(s, 1.6));
  rig.cap(a, b, 1.05, 1.05, P.cream, (t) => (t < 0.14 || t > 0.86 ? P.wood : null));
  if (dead) return;
  // Лист свисает к читающему.
  const f = vnorm(v3(j.fwd.x, 0, j.fwd.z));
  const down = vnorm(vadd(v3(0, -1, 0), vsc(f, -0.35)));
  const h = 3.4;
  rig.quad(a, b, vadd(b, vsc(down, h)), vadd(a, vsc(down, h)), PAGE_C, (_u, v) =>
    v > 0.3 && v < 0.38 ? P.cream[1] : v > 0.6 && v < 0.68 ? P.cream[1] : null,
  );
  if (q.fl > 0.05 && q.fl < PI - 0.05) {
    const d = vnorm(vadd(vsc(down, Math.cos(q.fl)), vsc(f, Math.sin(q.fl) * 1.0)));
    rig.quad(a, b, vadd(b, vsc(d, h)), vadd(a, vsc(d, h)), PAGE_C);
  }
}

/** Лист в пальцах правой (замах). */
function page(rig: Rig, j: Joints): void {
  const c = j.haR;
  const s = vnorm(v3(j.right.x, 0, j.right.z));
  const u = j.foreR;
  rig.quad(
    vadd(c, vsc(s, -1.2)),
    vadd(c, vsc(s, 1.2)),
    vadd(vadd(c, vsc(s, 1.2)), vsc(u, 2.6)),
    vadd(vadd(c, vsc(s, -1.2)), vsc(u, 2.6)),
    PAGE_C,
  );
}

interface Built {
  rig: Rig;
  j: Joints;
  lens: [V3, V3];
}

function promptRig(q: PP, opt: { page?: boolean; dead?: boolean } = {}): Built {
  const rig = new Rig();
  const j = humanoid(rig, PROMPT_BODY, q);
  const R = PROMPT_BODY.head;
  // Колпак, загнутый назад; кисточка отстаёт (`cp`).
  const a = onHead(j, R, -0.1, 0, 0.7);
  const b = vadd(a, vadd(vsc(j.hUp, 3), vsc(j.hFwd, -2.4 + q.cp * 0.8)));
  const tip = vadd(b, vadd(vsc(j.hUp, -1 + q.cp * 0.6), vsc(j.hFwd, -2.4 + q.cp * 2)));
  rig.cap(a, b, 3.2, 1.6, P.cream);
  rig.cap(b, tip, 1.6, 0.6, P.cream);
  rig.ball(tip, 1, P.red);
  // Очки и нос.
  const lens: [V3, V3] = [onHead(j, R, 0.95, -0.4, 0.1), onHead(j, R, 0.95, 0.4, 0.1)];
  rig.dot(lens[0], P.gold[3], 2);
  rig.dot(lens[1], P.gold[3], 2);
  rig.ball(onHead(j, R, 1.05, 0, -0.15), 0.9, P.skin);
  scroll(rig, j, q, !!opt.dead);
  if (opt.page) page(rig, j);
  return { rig, j, lens };
}

const SMEAR_C = hx('#fff6e0');
const GLINT = hx('#ffffff');
const PAPER: readonly RGBA[] = [P.cream[3], P.cream[2], P.cream[1], hx('#fffaf0')];
const DUST: readonly RGBA[] = [P.wood[2], P.wood[3], hx('#3a2a1a'), P.cream[1]];

/** Рука с листом на экране: [предплечье, конец листа] в момент `ta` броска. */
function armAt(ta: number, Pj: Proj2): [number, number, number, number] {
  const q = ta < AIM ? track(ta, AIM_K) : track(ta - AIM, THR_K);
  const j = humanoid(new Rig(), PROMPT_BODY, q);
  const a = Pj(j.elR);
  const b = Pj(vadd(j.haR, vsc(j.foreR, 2.4)));
  return [a[0], a[1], b[0], b[1]];
}

// Люк под ногами (экранный, как `f13_hatch`): проём, обвязка, крышка.
const HOLE = hx('#0a0408');
const RIM_A = P.wood[2];
const RIM_B = P.wood[3];

/** Всё, что ниже кромки, — под полом: срезать; в проёме — в тени. */
function inHole(p: Px, ay: number): void {
  const { w, h, data } = p;
  const lip = ay + 5;
  if (lip < h) data.fill(0, Math.max(0, lip) * w * 4, h * w * 4);
  for (let y = Math.max(0, ay + 1); y < Math.min(h, lip); y++)
    for (let x = 0, i = y * w * 4; x < w; x++, i += 4)
      if (data[i + 3]) {
        data[i] *= 0.45;
        data[i + 1] *= 0.45;
        data[i + 2] *= 0.5;
      }
}

/** Люк позади фигуры (`lid` — крышка поднята 0…1, `open` — проём). */
function hatch(p: Px, ax: number, ay: number, open: number, lid: number): void {
  const behind = (x: number, y: number, c: RGBA) => {
    if (!p.solid(x, y)) p.set(x, y, c);
  };
  if (open > 0)
    for (let y = ay - 5; y <= ay + 4; y++)
      for (let x = ax - 8; x <= ax + 7; x++) {
        const edge = x === ax - 8 || x === ax + 7 || y === ay - 5;
        behind(x, y, edge ? RIM_A : HOLE);
      }
  const lh = Math.round(7 * lid);
  for (let y = ay - 5 - lh; y < ay - 5; y++)
    for (let x = ax - 8; x <= ax + 7; x++) {
      const top = y === ay - 5 - lh;
      const seam = (x - ax + 8) % 5 === 4;
      behind(x, y, top ? RIM_B : seam ? P.wood[0] : P.wood[1]);
    }
  // Передняя кромка — перед фигурой.
  if (open > 0) for (let x = ax - 9; x <= ax + 8; x++) p.set(x, ay + 5, x % 3 ? RIM_A : RIM_B);
}

const K = kindOf('f13_prompter', 48, 48, 24, 36, 1200);

const pPic = (anim: string, f: number, d: number): Pic => {
  const q = pPose(anim, f);
  const yaw = yawN(d);
  const pg = anim === 'aim' && f >= 5;
  const dead = anim === 'die' && f >= 3;
  const { rig, j, lens } = promptRig(q, { page: pg, dead });
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // Бросок: след руки с листом — разгон и контакт.
    if (anim === 'aim' || anim === 'thr') {
      const ta = anim === 'aim' ? tf(f) : AIM + tf(f);
      if (ta >= tf(11) && ta <= AIM + tf(1)) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 6; i++) segs.push(armAt(ta - i / 96, Pj));
        smearInto(lit(), segs, SMEAR_C, ta >= AIM ? 0.75 : 0.55);
      }
    }
    // Блик очков — поверх (в темноте его ведёт движок по `eye`).
    if (q.gl > 0.5)
      for (const l of lens) {
        const [x, y] = Pj(l);
        o.px.set(x, y - 1, GLINT);
      }
    if (anim === 'die' && f >= 2 && f <= 13) {
      const [x, y] = Pj(j.haL);
      puff(o.px, x, y, (f - 1.5) / 12, 53, PAPER, 9, 11);
    }
    // Люк: нырок, сидит, выпрыгнул.
    let open = 0;
    let lid = 0;
    if (anim === 'dn') {
      open = f >= 1 ? 1 : 0;
      lid = Math.min(1, f / 3);
    } else if (anim === 'hid') {
      open = 1;
      lid = 1;
    } else if (anim === 'up' && f <= 5) {
      open = 1;
      lid = f <= 3 ? 1 : f === 4 ? 0.5 : 0.15;
    }
    if (open) {
      if (anim !== 'dn' || f >= 3) inHole(o.px, K.ay);
      hatch(o.px, K.ax, K.ay, open, lid);
    }
    if (anim === 'up' && f >= 5) puff(o.px, K.ax, K.ay + 1, (f - 4.5) / 3.5, 59, DUST, 7, 8);
  });
};

// ---- рисовальщик -------------------------------------------------------------

/** Подсказка соседям: мозг взводит `buffCd` на 3 с — жест первые 0,58 с. */
const whisperAge = (m: Mob) => 3 - (m.data?.buffCd ?? 0);

registerMobPainter('f13_prompter', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const v = visOf(m, pose, m.face ?? 0, 9);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 5 };
  let anim = 'pk';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.62, 0.85, t);
    ex.shadow = 5 * (1 - sstep(0.3, 0.6, t));
  } else if (md === 'f13_hide') {
    if (t < tf(DN_N)) {
      anim = 'dn';
      f = fi(t, DN_N - 1);
      ex.shadow = 5 * (1 - sstep(0.04, 0.12, t));
    } else {
      anim = 'hid';
      f = Math.floor(now * 6 + hash(id, 5) * HID_N) % HID_N;
      ex.shadow = 0;
    }
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, AIM_N - 1);
  } else if (md === 'f13_peek' && v.prev === 'aim' && t < 0.45) {
    anim = 'thr';
    f = fi(t, THR_N - 1);
    const k = 1 - sstep(0, 0.12, t);
    ex.sx = 1 + 0.08 * k;
    ex.sy = 1 - 0.08 * k;
  } else if (md === 'f13_peek' && v.prev === 'f13_hide' && t < tf(UP_N)) {
    anim = 'up';
    f = fi(t, UP_N - 1);
    ex.shadow = f >= 4 ? 5 : 0;
    // Пружина: вытянулся в прыжке, приземлился — вжался.
    const st = sstep(0.04, 0.1, t) * (1 - sstep(0.12, 0.18, t));
    const land = Math.sin(PI * Math.min(1, Math.max(0, (t - 0.17) / 0.12)));
    ex.sx = (1 - 0.08 * st) * (1 + 0.12 * land);
    ex.sy = (1 + 0.12 * st) * (1 - 0.12 * land);
  } else if (md === 'stun') {
    anim = 'hu';
    f = fi(t, HURT_N - 1);
  } else if (md === 'sleep') {
    anim = 'sl';
    f = Math.floor(now * 2 + id) % 4;
  } else if (hurtAge(v, now) < 0.3) {
    anim = 'hu';
    f = fi(hurtAge(v, now), HURT_N - 1);
  } else if (md === 'alert') {
    anim = 'al';
    f = fi(t, 8);
  } else if (md === 'f13_peek' && whisperAge(m) >= 0 && whisperAge(m) < tf(WH_N)) {
    anim = 'wh';
    f = fi(whisperAge(m), WH_N - 1);
  } else {
    f = Math.floor(now * 8 + hash(id, 7) * PK_N) % PK_N;
  }
  if (md !== 'dying' && md !== 'f13_hide') hurtFx(v, now, 1.3, ex);
  return { ...frameOf(K, anim, f, d, pose, () => pPic(anim, f, d)), ...ex };
});

registerMobWarm('f13_prompter', function* () {
  yield* warmAll(
    K,
    [
      ['pk', PK_N],
      ['wh', WH_N],
      ['aim', AIM_N],
      ['thr', THR_N],
      ['dn', DN_N],
      ['hid', HID_N],
      ['up', UP_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      ['al', 9],
      ['sl', 4],
    ],
    pPic,
  );
});
