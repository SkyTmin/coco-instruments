// Тень-актёр (анимации мобов 13). Облик прежний: тёмно-фиолетовый силуэт в
// плаще и цилиндре, горят сиреневые глаза; своей тени на полу нет — он сам
// тень.
//
// Живёт в луче софита (`f13-brains.ts` `f13_shade`): в луче — плотный
// силуэт (прозрачность 0,88); вне луча (`m.data.ghost`) неуязвим и тает в
// дым (0,12–0,2, мерцает), вернулся в луч — собирается обратно. Замах
// гаснет, если луч ушёл (мозг → `chase`): тень отдёргивается и тает.
// Удар — общий `melee`: урон в конце `windup` 0,6 с, тем же шагом —
// `recover`; кадр контакта — первый кадр `recover`.
//
// Замах — трек 24 к/с: съёживается, кутаясь в плащ → вырастает (тень
// вытягивается, как от низкого света), руки с когтями вскинуты, плащ
// распахнут крыльями, загорается ухмылка → нависает над целью (держит) →
// крест-накрест когтями вниз со следом → контакт с выпадом и вжатием →
// проводка, плащ догоняет и перехлёстывает → оседает с перелётом. Шаг —
// крадётся на цыпочках, руки с повисшими когтями вперёд, по пути. Смерть —
// свет выжигает: выгибается, стекает лужей, цилиндр слетает рядом, глаза
// гаснут последними, дымок. Появление — встаёт из лужи. 5 сторон рисуются,
// 3 — зеркало (фигура симметрична; шаг в зеркале — со сдвигом на полшага).

import type { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import {
  KNIGHT_BODY,
  P,
  Rig,
  humanoid,
  hx,
  limb,
  onHead,
  pose0,
  v3,
  vadd,
  vmix,
  vnorm,
  vsc,
  withA,
} from './f13-art';
import type { Body, Joints, Pose, RGBA, Tone, V3 } from './f13-art';
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
  gaitP,
  hash,
  headOf,
  hurtAge,
  hurtFx,
  hurtP,
  jointsOf,
  kindOf,
  lerp,
  lin,
  moving,
  puff,
  smearInto,
  smooth,
  spark,
  sstep,
  tf,
  track,
  visOf,
  warmAll,
  yawN,
} from './f13-mobkit';
import type { PKey, Pic, Proj2 } from './f13-mobkit';

const SHADE_BODY: Body = {
  ...KNIGHT_BODY,
  hip: 10,
  torso: 8,
  waist: 2.4,
  chest: 3.4,
  head: 2.7,
  armR: 1.1,
  legR: 1.2,
  T: {
    torso: P.shade,
    arm: P.shade,
    leg: P.shade,
    head: P.shade,
    hand: P.shade,
    foot: P.shade,
    joint: P.shade,
    pelvis: P.shade,
  },
  // Узоры лат рыцаря тени ни к чему: чистый силуэт.
  torsoPat: undefined,
  legPat: undefined,
  joints: false,
};

/**
 * Поза тени: + плащ (`cl` отстал назад, px; `cs` распахнут руками 0…1;
 * `rp` фаза ряби подола), лицо (`ey` глаза вспыхнули, `gr` ухмылка), когти
 * (`cw` растопырены, `dr` кисти повисли), `dis` растаял в дым, `pud` лужа
 * тени (px), `hat` цилиндр слетел на лужу (`hs` — утонул), `kx/ky` — ширина и рост фигуры
 * (тень вытягивается и стекает).
 */
interface SP extends Pose {
  cl: number;
  cs: number;
  rp: number;
  ey: number;
  gr: number;
  cw: number;
  dr: number;
  dis: number;
  pud: number;
  hat: number;
  hs: number;
  kx: number;
  ky: number;
}
const S0: SP = {
  ...pose0(),
  cl: 0.4,
  cs: 0,
  rp: 0,
  ey: 0,
  gr: 0,
  cw: 0.4,
  dr: 0,
  dis: 0,
  pud: 0,
  hat: 0,
  hs: 0,
  kx: 1,
  ky: 1,
};
const sp = (o: Partial<SP>, b: SP = S0): SP => ({ ...b, ...o });

const W = 0.6;
const IDLE_N = 16;
const WALK_N = 12;
const STRIDE = 1.6;
const WIND_N = 15;
const REC_N = 11;
const HURT_N = 8;
const DIE_N = 20;
const GH_N = 12;
const FO_N = 5;
const WX_N = 6;
const FI_N = 8;
const RS_N = 10;
/** Прозрачность в луче (прежняя) и порог растворения. */
const A_IN = 0.88;

// ---- позы ----------------------------------------------------------------------

/** Стойка: пальцы домиком у груди — замышляет. */
const G = sp({
  bob: 0.3,
  lean: 0.14,
  hp: 0.1,
  aL: limb(0.95, -0.42, 1.5),
  aR: limb(0.95, -0.42, 1.5),
  lL: limb(0.08, 0.1, 0.15),
  lR: limb(-0.06, 0.1, 0.12),
});

function idleP(ph: number): SP {
  const s = Math.sin(ph);
  return sp(
    {
      bob: 0.3 + 0.35 * Math.sin(ph * 2),
      side: 0.04 * s,
      hr: 0.12 * s,
      hy: 0.3 * Math.sin(ph + 0.8),
      rp: ph * 2,
      // Барабанит когтями.
      cw: 0.4 + 0.35 * Math.sin(ph * 4),
      cl: 0.4 + 0.25 * Math.cos(ph),
    },
    G,
  );
}

/** Крадётся: на цыпочках, согнулся, руки вперёд, кисти повисли. */
function walkP(ph: number): SP {
  const g = gaitP(ph, 1.15);
  const s = Math.sin(ph);
  return sp({
    ...g,
    lean: 0.36,
    hp: -0.14,
    aL: limb(1.35 + 0.12 * s, 0.3, -0.15),
    aR: limb(1.35 - 0.12 * s, 0.3, -0.15),
    toe: 0.6,
    dr: 0.75,
    cw: 0.6,
    cl: 1.7 + 0.6 * Math.abs(s),
    rp: ph * 2,
  });
}

/** Вне луча: дым, кутается в плащ, ног нет — висит. */
function ghP(ph: number): SP {
  const s = Math.sin(ph);
  return sp({
    dis: 1,
    bob: 1.6 + 0.8 * s,
    sink: 2.2,
    lean: 0.18,
    hp: 0.25,
    side: 0.05 * s,
    hr: 0.1 * Math.cos(ph),
    aL: limb(0.55, -0.55, 1.6),
    aR: limb(0.55, -0.55, 1.6),
    cl: 0.8 + 0.4 * Math.sin(ph + 1),
    rp: ph * 2,
    ey: 0.5,
    cw: 0,
    kx: 0.94,
    ky: 0.92,
  });
}
const GH0 = ghP(0);

// ---- замах и удар ------------------------------------------------------------------

/** Съёжился, кутается в плащ, глаза щурятся. */
const A1 = sp({
  sink: 1.4,
  lean: 0.34,
  hp: 0.3,
  aL: limb(0.7, -0.6, 1.9),
  aR: limb(0.7, -0.6, 1.9),
  lL: limb(0.3, 0.12, 0.6),
  lR: limb(-0.1, 0.12, 0.5),
  cl: 0.2,
  cw: 0.1,
  ey: 0.3,
  kx: 1.05,
  ky: 0.93,
});
/** Вырос: руки с когтями вскинуты, плащ крыльями, ухмылка. */
const A2 = sp({
  bob: 2.4,
  lean: -0.22,
  hp: -0.3,
  aL: limb(2.5, 0.95, 0.35),
  aR: limb(2.5, 0.95, 0.35),
  lL: limb(0.1, 0.12, 0.2),
  lR: limb(-0.1, 0.12, 0.2),
  toe: 0.7,
  cl: 0.6,
  cs: 1,
  cw: 1,
  ey: 1,
  gr: 1,
  kx: 0.95,
  ky: 1.2,
});
/** Нависает над целью: держит, подаётся вперёд. */
const A3 = sp(
  {
    bob: 2.7,
    lean: 0.06,
    hp: 0,
    aL: limb(2.25, 0.85, 0.55),
    aR: limb(2.25, 0.85, 0.55),
    ky: 1.23,
    rp: 1.2,
  },
  A2,
);
/** Контакт: когти крест-накрест внизу, выпад, плащ отстал. */
const C = sp({
  sink: 1.2,
  lean: 0.55,
  hp: -0.3,
  aL: limb(0.65, -0.45, 0.05),
  aR: limb(0.65, -0.45, 0.05),
  lL: limb(0.6, 0.1, 0.35),
  lR: limb(-0.5, 0.1, 0.3),
  cl: 2.2,
  cs: 0.45,
  cw: 1,
  ey: 1,
  gr: 0.7,
  kx: 1.06,
  ky: 0.92,
  rp: 2.4,
});
/** Проводка: когти ушли вниз-назад, плащ перехлестнул вперёд. */
const FT = sp(
  {
    sink: 1.8,
    lean: 0.68,
    hp: -0.25,
    aL: limb(-0.05, -0.2, 0.05),
    aR: limb(-0.05, -0.2, 0.05),
    cl: -0.6,
    cs: 0.15,
    kx: 1.06,
    ky: 0.9,
    rp: 3.4,
  },
  C,
);
/** Отдача: выпрямляется, плащ оседает. */
const R1 = sp({
  bob: 0.6,
  sink: 0.6,
  lean: 0.3,
  hp: -0.05,
  aL: limb(0.6, -0.3, 1.0),
  aR: limb(0.6, -0.3, 1.0),
  lL: limb(0.2, 0.1, 0.25),
  lR: limb(-0.15, 0.1, 0.2),
  cl: 0.9,
  cw: 0.5,
  ey: 0.4,
  ky: 0.98,
  rp: 4.4,
});

const WIND: PKey<SP>[] = [
  [0, G],
  [0.1, A1],
  [0.28, A2, easeOut],
  [0.47, A3, lin],
  [W, C, easeIn],
];
const REC: PKey<SP>[] = [
  [0, C],
  [0.083, FT, easeOut],
  [0.22, R1],
  [0.42, G, eBack],
];

// ---- растворение, сборка, появление, смерть ---------------------------------

const FO: PKey<SP>[] = [
  [0, G],
  [tf(FO_N - 1), GH0, easeIn],
];
/** Луч ушёл посреди замаха: отдёрнулся от темноты и растаял. */
const WX: PKey<SP>[] = [
  [0, A3],
  [
    0.08,
    sp(
      {
        lean: -0.35,
        hp: -0.4,
        aL: limb(1.2, 0.3, 1.6),
        aR: limb(1.2, 0.3, 1.6),
        cs: 0.4,
        dis: 0.4,
        gr: 0,
        kx: 0.9,
        ky: 1.05,
      },
      A3,
    ),
    easeOut,
  ],
  [tf(WX_N - 1), GH0],
];
/** Снова в луче: дым собрался, плащ хлопнул, глаза вспыхнули. */
const FI: PKey<SP>[] = [
  [0, GH0],
  [0.12, sp({ bob: 1.4, lean: -0.05, cs: 0.5, ey: 1, kx: 0.96, ky: 1.07 }, G), easeOut],
  [tf(FI_N - 1), G, eBack],
];

/** Свет выжег: выгнулся, руки вразлёт. */
const D1 = sp({
  bob: 2,
  lean: -0.42,
  hp: -0.55,
  aL: limb(2.3, 1.05, 0.2),
  aR: limb(2.1, 1.1, 0.3),
  lL: limb(0.2, 0.15, 0.3),
  lR: limb(-0.2, 0.15, 0.3),
  toe: 0.6,
  cl: -0.5,
  cs: 0.8,
  cw: 1,
  ey: 1,
  kx: 0.94,
  ky: 1.12,
});
/** Стекает в лужу: обмяк, руки повисли; цилиндр подбросило. */
const D2 = sp({
  sink: 1.2,
  lean: 0.2,
  hp: 0.4,
  side: 0.1,
  aL: limb(0.2, 0.25, 0.3),
  aR: limb(0.15, 0.3, 0.3),
  lL: limb(0.3, 0.15, 0.6),
  lR: limb(-0.2, 0.15, 0.5),
  cl: 0.8,
  cs: 0.25,
  cw: 0.2,
  ey: 0.7,
  kx: 1.05,
  ky: 0.7,
  pud: 4.5,
  hat: 0.15,
});
/** Осел лужей; цилиндр встал на неё. */
const D3 = sp(
  {
    sink: 2,
    lean: 0.35,
    hp: 0.5,
    cl: 1.2,
    cs: 0,
    ey: 0.6,
    kx: 1.15,
    ky: 0.26,
    pud: 7,
    hat: 1,
    rp: 2,
  },
  D2,
);
/** Одна лужа, цилиндр и глаза в ней. */
const D4 = sp({ ky: 0.08, pud: 7.6, ey: 0.75, rp: 4 }, D3);
const D5 = sp({ pud: 7, ey: 0.5, hs: 0.35, rp: 5 }, D4);
const D6 = sp({ pud: 4, ey: 0, hs: 1, rp: 6 }, D5);
const DIE: PKey<SP>[] = [
  [0, G],
  [0.06, D1, easeOut],
  [0.2, D2, smooth],
  [0.36, D3, easeIn],
  [0.48, D4],
  [0.62, D5],
  [tf(DIE_N - 1), D6],
];

/** Появление: встаёт из лужи, цилиндр с лужи — на голову. */
const RISE: PKey<SP>[] = [
  [0, sp({ pud: 6.5, ey: 0.6, hs: 0.5 }, D4)],
  [
    0.17,
    sp(
      {
        sink: 1,
        lean: -0.1,
        hp: -0.2,
        cs: 0.55,
        ey: 0.9,
        kx: 1.08,
        ky: 0.65,
        pud: 4,
        cl: 0.2,
        hat: 0.4,
      },
      G,
    ),
    easeOut,
  ],
  [0.3, sp({ bob: 1, cs: 0.25, kx: 0.97, ky: 1.08, pud: 1.5 }, G), smooth],
  [tf(RS_N - 1), G, eBack],
];

function sPose(anim: string, f: number): SP {
  const t = tf(f);
  switch (anim) {
    case 'wind':
      return track(t, WIND);
    case 'rec':
      return track(t, REC);
    case 'hu': {
      // Удар героя: тень рвануло, плащ хлестнул вперёд, силуэт дрогнул.
      const k = t < 0.05 ? easeOut(t / 0.05) : 1 - sstep(0.05, 0.3, t);
      const q = hurtP(G, t) as SP;
      return { ...q, cl: G.cl - 1.8 * k, kx: 1 + 0.08 * k, ky: 1 - 0.07 * k, ey: 0.6 * k };
    }
    case 'die':
      return track(t, DIE);
    case 'rs':
      return track(t, RISE);
    case 'gh':
      return ghP((f / GH_N) * TAU);
    case 'fo':
      return track(t, FO);
    case 'wx':
      return track(t, WX);
    case 'fi':
      return track(t, FI);
    case 'walk':
      return walkP((f / WALK_N) * TAU);
  }
  return idleP((f / IDLE_N) * TAU);
}

// ---- рисунок -----------------------------------------------------------------

const CLOAK: Tone = [hx('#06030a'), hx('#140c20'), hx('#261a3a'), hx('#4a3a6a')];
const CLAW: Tone = [hx('#2e2046'), hx('#6a5890'), hx('#b0a0d8'), hx('#ece4ff')];
const PUD: Tone = [hx('#06030a'), hx('#06030a'), hx('#120a1c'), hx('#2e2046')];
const HAT: Tone = [hx('#0a0810'), hx('#1e1a28'), hx('#36304a'), hx('#6a6088')];
const BAND: Tone = [P.shade[2], P.shade[3], hx('#7a68a0'), hx('#9a88c0')];
const EYE = hx('#e0d0ff');
const GRIN = hx('#f4ecff');
const SMEAR_C = hx('#e8dcff');
const SPARK_C = hx('#ffffff');
const SHRED: readonly RGBA[] = [P.shade[1], P.shade[2], P.shade[3], hx('#8a7ab0')];
const WISP: readonly RGBA[] = [hx('#3a2c50'), hx('#8a7ab0'), hx('#58447e')];
const DOWN = v3(0, -1, 0);
/** Подол рваный: полосы плаща кончаются на разной высоте. */
const JAG = [1.3, 0.2, 0.9, 0];

const scaler = (q: SP) => (p: V3) => v3(p.x * q.kx, p.y * q.ky, p.z * q.kx);

/** Тень вытягивается и стекает: вся фигура — по росту и ширине от пола. */
function scaleRig(r: Rig, kx: number, ky: number): void {
  if (kx === 1 && ky === 1) return;
  const T = (p: V3) => v3(p.x * kx, p.y * ky, p.z * kx);
  const kr = Math.min(kx, Math.sqrt(kx * ky));
  for (const p of r.prims) {
    switch (p.k) {
      case 0:
        p.a = T(p.a);
        p.b = T(p.b);
        p.r0 *= kr;
        p.r1 *= kr;
        break;
      case 1:
        p.c = T(p.c);
        p.r *= kx;
        p.h *= ky;
        break;
      case 2:
        p.a = T(p.a);
        break;
      case 3:
        p.a = T(p.a);
        p.b = T(p.b);
        p.r *= kr;
        break;
      case 4:
        p.p = [T(p.p[0]), T(p.p[1]), T(p.p[2]), T(p.p[3])];
        break;
    }
  }
}

/** Горизонтальные орты таза: вправо и вперёд по полу. */
function floorAxes(j: Joints): [V3, V3] {
  const rh = vnorm(v3(j.right.x, 0, j.right.z));
  return [rh, v3(-rh.z, 0, rh.x)];
}

/** Плащ: по четыре складки с боку, от ворота и плеч до пола; `cs` — подол вздуло. */
function cloak(rig: Rig, j: Joints, q: SP): void {
  const [rh, fh] = floorAxes(j);
  const nb = vadd(vadd(j.chest, vsc(j.up, 0.3)), vsc(j.fwd, -1.3));
  const gy = 0.6;
  const hc = vadd(v3(j.pelvis.x, gy, j.pelvis.z), vsc(fh, -(1.3 + q.cl)));
  const n = JAG.length;
  for (const s of [-1, 1]) {
    const sh = s < 0 ? j.shL : j.shR;
    const tO = vadd(vadd(sh, vsc(j.up, 0.5)), vsc(j.fwd, -1.0));
    const n0 = vadd(nb, vsc(j.right, s * 0.4));
    const top = (u: number) => vmix(n0, tO, u);
    const hem = (u: number, i: number) => {
      const w = Math.sin(q.rp + i * 1.7 + (s > 0 ? 0.9 : 0));
      const out = 0.5 + u * (3.4 + 4.2 * q.cs + 1.2 * q.dis);
      const fw = u * (1 + 3.2 * q.dis - 1.6 * q.cs) - 0.7 * w * u;
      const y =
        JAG[i] * (0.6 + 0.4 * q.dis + q.cs) + 4.5 * q.cs * u * u + 0.6 * w * (0.4 + 0.6 * u);
      return vadd(vadd(vadd(hc, vsc(rh, s * out)), vsc(fh, fw)), v3(0, y, 0));
    };
    // Складки — конусы от плеча к подолу (растр по пикселям дешевле лоскута точками).
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const lo = hem(u, i);
      const wd = Math.hypot(lo.x - hem(u - 0.5 / n, i).x, lo.z - hem(u - 0.5 / n, i).z);
      rig.cap(top(u), lo, 0.75, Math.max(0.8, wd * 1.25), CLOAK);
    }
  }
}

/** Коготь `k` (−1, 0, 1) руки `s`: [основание, острие]. */
function clawOf(j: Joints, q: SP, s: number, k: number): [V3, V3] {
  const ha = s < 0 ? j.haL : j.haR;
  const fo = s < 0 ? j.foreL : j.foreR;
  const d = vnorm(vadd(vnorm(vmix(fo, DOWN, q.dr)), vsc(j.right, k * s * (0.16 + 0.3 * q.cw))));
  return [vadd(ha, vsc(d, 0.6)), vadd(ha, vsc(d, 3.4 + 1.8 * q.cw))];
}

/** Цилиндр: поля и тулья; `sunk` — утонул в луже (поля уже под ней). */
function hatAt(rig: Rig, base: V3, axis: V3, sunk = 0, flat = false): void {
  // На голове поля — плоский диск (дёшево, как в прежнем рисунке); слетевший — честный цилиндр.
  if (flat) rig.disc(vadd(base, vsc(axis, 0.1)), 3.8, 0.5, HAT);
  else if (sunk < 0.15)
    rig.cyl(
      vadd(base, vsc(axis, -0.2)),
      vadd(base, vsc(axis, 0.35)),
      3.8,
      HAT,
      undefined,
      false,
      0.3,
    );
  const top = 6 * (1 - sunk);
  if (top > 0.4)
    rig.cyl(base, vadd(base, vsc(axis, top)), 2, HAT, (t) =>
      t * top < 1.2 && t * top > 0.3 ? BAND : null,
    );
}

/** Тело тоньше этого — уже лужа: не рисуется. */
const FLAT = 0.15;

function shadeRig(q: SP): { rig: Rig; j: Joints } {
  const rig = new Rig();
  const body = q.ky >= FLAT;
  const j = humanoid(body ? rig : new Rig(), SHADE_BODY, q, { legs: q.dis > 0.5 });
  const R = SHADE_BODY.head;
  const hb = onHead(j, R, 0, 0, 0.85);
  const [rh, fh] = floorAxes(j);
  if (body) {
    cloak(rig, j, q);
    for (const s of [-1, 1])
      for (const k of [-1, 0, 1]) {
        const [a, b] = clawOf(j, q, s, k);
        rig.cap(a, b, 0.55, 0.22, CLAW);
      }
    // Глаза (первая светящаяся точка — глаз движка), в замахе — ухмылка.
    const es = q.ey > 0.5 ? 2 : 1;
    if (q.ky > 0.35) {
      rig.dot(onHead(j, R, 0.98, -0.38, 0.05), EYE, es, true);
      rig.dot(onHead(j, R, 0.98, 0.38, 0.05), EYE, es, true);
    }
    if (q.gr > 0.3) {
      const m = q.gr > 0.65 ? 3 : 2;
      for (let i = -m; i <= m; i++) {
        const x = i / 3;
        rig.dot(onHead(j, R, 0.96, x * 0.8, -0.5 + 0.32 * x * x), GRIN, 1, true);
      }
    }
    if (q.hat <= 0) hatAt(rig, hb, j.hUp, 0, true);
    scaleRig(rig, q.kx, q.ky);
  }
  if (q.pud > 0.5) rig.disc(v3(0, 0.05, 0), q.pud, 0.2, PUD);
  // Стёк в лужу: глаза светятся из неё, пока не погаснут.
  if (q.ky <= 0.35 && q.ey > 0.05)
    for (const s of [-1, 1])
      rig.dot(vadd(vadd(vsc(fh, 2), vsc(rh, s * 1.2)), v3(0, 0.6, 0)), EYE, 1, true);
  if (q.hat > 0) {
    // Цилиндр подбросило — он падает на лужу стоймя, качнувшись, и тонет.
    const rest = vadd(vsc(fh, -0.6), v3(0, 0.3, 0));
    const from = scaler(q)(hb);
    const k = easeIn(q.hat);
    const base = vadd(vmix(from, rest, k), v3(0, Math.sin(q.hat * PI) * 4, 0));
    const tilt = vadd(v3(0, 1, 0), vsc(rh, 0.35 * Math.sin(q.hat * PI * 2)));
    hatAt(rig, base, vnorm(vmix(j.hUp, tilt, k)), q.hs);
  }
  return { rig, j };
}

/** Острие среднего когтя на экране в момент `ta` от начала замаха: [основание, острие]. */
function clawAt(ta: number, s: number, Pj: Proj2): [number, number, number, number] {
  const q = ta < W ? track(ta, WIND) : track(ta - W, REC);
  const j = jointsOf(SHADE_BODY, q);
  const T = scaler(q);
  const [a, b] = clawOf(j, q, s, 0);
  const pa = Pj(T(a));
  const pb = Pj(T(b));
  return [pa[0], pa[1], pb[0], pb[1]];
}

/** Дымок от лужи: тает вверх. */
function wisps(p: Px, x: number, y: number, k: number, seed: number): void {
  if (k <= 0 || k >= 1) return;
  for (let i = 0; i < 7; i++) {
    const k2 = clamp01(k * 1.3 - hash(seed, i) * 0.3);
    if (k2 <= 0) continue;
    const px = x + (hash(seed, i, 2) - 0.5) * 12 + Math.sin(k2 * 5 + i) * 1.5;
    const py = y - 2 - k2 * 14;
    p.set(px, py, withA(WISP[i % WISP.length], 0.85 * (1 - k2)));
  }
}

const K = kindOf('f13_shade', 64, 60, 32, 48, 800);
const SIDES = [0, 1, 2, 6, 7] as const;

const sPic = (anim: string, f: number, d: number): Pic => {
  const q = sPose(anim, f);
  const yaw = yawN(d);
  const { rig, j } = shadeRig(q);
  return draw(K, rig, yaw, (o, Pj, lit) => {
    // След когтей крест-накрест: разгон и контакт.
    const ta = anim === 'wind' ? tf(f) : anim === 'rec' ? W + tf(f) : -1;
    if (ta >= 0.47 && ta <= W + tf(1))
      for (const s of [-1, 1]) {
        const segs: [number, number, number, number][] = [];
        for (let i = 0; i <= 6; i++) segs.push(clawAt(ta - i / 96, s, Pj));
        smearInto(lit(), segs, SMEAR_C, ta >= W ? 0.8 : 0.55);
      }
    if (anim === 'rec' && f <= 7) {
      const T = scaler(q);
      const a = Pj(T(clawOf(j, q, -1, 0)[1]));
      const b = Pj(T(clawOf(j, q, 1, 0)[1]));
      const x = (a[0] + b[0]) / 2;
      const y = (a[1] + b[1]) / 2;
      if (f <= 1) spark(lit(), x, y, SPARK_C, f === 0 ? 1 : 0.6);
      // Клочья тени с когтей.
      if (f >= 1) puff(o.px, x, y, (f - 0.5) / 7.5, 23, SHRED, 7, 7);
    }
    if (anim === 'die' && f >= 8) {
      const [x, y] = Pj(v3(0, 0, 0));
      wisps(o.px, x, y, (f - 7.5) / (DIE_N - 7), 41);
    }
  });
};

// ---- рисовальщик -------------------------------------------------------------

/** Луч: был ли призраком, миг смены, последний замах (гаснущий замах — свой кадр). */
interface Beam {
  g: number;
  at: number;
  wt: number;
  wx: boolean;
}
const BEAM = new WeakMap<Mob, Beam>();

const TECH = new Set(['windup', 'recover', 'stun']);
const STRIKE_GHOST = { every: 0.04, life: 0.2, tint: '#3a2c50', alpha: 0.45 };

registerMobPainter('f13_shade', (m: Mob, pose: MobPose): MobFrame => {
  const md = pose.mode;
  const t = pose.t || 0;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const data = m.data ?? {};
  const g = (data.ghost ?? 0) > 0 ? 1 : 0;
  const want = TECH.has(md) ? (m.face ?? 0) : headOf(m);
  const v = visOf(m, pose, want, md === 'windup' ? 6 : 9);
  let b = BEAM.get(m);
  if (!b) {
    // Лист кадров: `vSheetGh` — смена луча в начале строки.
    const sh = !!data.vSheetGh;
    b = { g, at: sh ? now - t : -9, wt: 0, wx: sh && g === 1 && v.prev === 'windup' };
    BEAM.set(m, b);
  } else if (b.g !== g) {
    b.wx = g === 1 && md !== 'windup' && v.prev === 'windup' && b.wt >= 0.25;
    b.g = g;
    b.at = now;
  }
  if (md === 'windup') b.wt = t;
  const ag = now - b.at;
  const gA = 0.12 + 0.08 * Math.sin(now * 6 + id);
  const ex: Partial<MobFrame> = {
    shadow: 0,
    alpha: g ? lerp(A_IN, gA, sstep(0, 0.15, ag)) : lerp(gA, A_IN, sstep(0, 0.12, ag)),
  };
  const fx = Math.cos(v.yaw);
  const fy = Math.sin(v.yaw) * 0.56;
  let anim = 'idle';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, DIE_N - 1);
    ex.linger = 0.85;
    ex.alpha = A_IN * (1 - sstep(0.62, 0.85, t));
  } else if (g) {
    const n = b.wx ? WX_N : FO_N;
    if (ag < n / 24) {
      anim = b.wx ? 'wx' : 'fo';
      f = fi(ag, n - 1);
    } else {
      anim = 'gh';
      f = Math.floor(now * 8 + hash(id, 7) * GH_N) % GH_N;
    }
  } else if (md === 'windup') {
    anim = 'wind';
    f = fi(t, WIND_N - 1);
    // Съёжился и вырос — отпрянул от цели; в разгоне — к ней.
    const back = sstep(0.1, 0.28, t) * (1 - sstep(0.47, W, t));
    ex.dx = -fx * back;
    ex.dy = -fy * back;
    if (t >= 0.47) ex.ghost = STRIKE_GHOST;
  } else if (md === 'recover' && t < 0.45) {
    anim = 'rec';
    f = fi(t, REC_N - 1);
    const k = 1 - sstep(0, 0.16, t);
    ex.sx = 1 + 0.06 * k;
    ex.sy = 1 - 0.06 * k;
    const lunge = 1.6 * (1 - sstep(0.04, 0.3, t));
    ex.dx = fx * lunge;
    ex.dy = fy * lunge;
    if (t < 0.1) ex.ghost = STRIKE_GHOST;
  } else if (md === 'stun' || hurtAge(v, now) < HURT_N / 24) {
    anim = 'hu';
    f = fi(md === 'stun' ? t : hurtAge(v, now), HURT_N - 1);
  } else if (md === 'chase' && v.prev === '' && t < RS_N / 24) {
    anim = 'rs';
    f = fi(t, RS_N - 1);
  } else if (ag < FI_N / 24) {
    anim = 'fi';
    f = fi(ag, FI_N - 1);
  } else if (moving(m, 0.4)) {
    anim = 'walk';
    f = Math.floor((v.dist / STRIDE) * WALK_N) % WALK_N;
  } else {
    f = Math.floor(now * 10 + hash(id, 7) * IDLE_N) % IDLE_N;
  }
  const d = dirN(v.yaw);
  const mir = d >= 3 && d <= 5;
  const ds = mir ? (12 - d) % 8 : d;
  // Зеркало меняет ноги местами — полшага сдвига держит левую ногу левой.
  if (mir && anim === 'walk') f = (f + WALK_N / 2) % WALK_N;
  if (md !== 'dying' && !g) hurtFx(v, now, 1.2, ex);
  const fr = frameOf(K, anim, f, ds, pose, () => sPic(anim, f, ds));
  if (mir) ex.sx = -(ex.sx ?? 1);
  return { ...fr, ...ex };
});

registerMobWarm('f13_shade', function* () {
  yield* warmAll(
    K,
    [
      ['idle', IDLE_N],
      ['walk', WALK_N],
      ['wind', WIND_N],
      ['rec', REC_N],
      ['hu', HURT_N],
      ['die', DIE_N],
      // Луч ушёл и вернулся; появление из лужи.
      ['gh', GH_N],
      ['fo', FO_N],
      ['wx', WX_N],
      ['fi', FI_N],
      ['rs', RS_N],
    ],
    sPic,
    SIDES,
  );
});
