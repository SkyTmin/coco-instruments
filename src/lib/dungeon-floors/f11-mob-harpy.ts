// Гарпия (анимации мобов 11): девушка-птица — руки-крылья с бурыми маховыми
// и бирюзовыми кончиками, перья ниже пояса, жёлтые птичьи лапы, бирюзовые
// волосы назад. Летает туда, куда смотрит (8 сторон честно, мини-3D рига),
// машет по времени, кренится в вираж; техники — 24 к/с от `pose.t`.
//
// Метроном — `f11-brains.ts` (`f11_harpy`, `HARPY`):
// - `f11_flap` 0,85 с: замах крыльями вверх-назад, задержка с дрожью, хлопок
//   вниз-вперёд на последних кадрах; урон (порыв конусом) — в 0,85, кадр
//   контакта — первый кадр `recover` (`flapf`), дальше проводка и отлёт;
// - `f11_claw` 0,5 с — подтянулась, лапы вперёд, когти раскрыты; `f11_lunge`
//   0,26 с — бросок когтями (урон касанием, шлейф); после — торможение (`lungef`);
// - `recover` 1,1 с — пятится от героя, крылья гребут вперёд (окно);
// - `f11_perch` — сидит на насесте, крылья плащом; взлёт — первые 0,42 с `chase`;
// - удар героя — вздрог 5 кадров; смерть 0,9 с: крылья ломаются, падает на пол,
//   перья летят, гаснет.
// Эхо 15-го этажа (`f15_echo`, мотив 4) зовёт этот рисовальщик со своим мобом:
// `windup` (порыв эха 0,7 с) — тот же замах, растянутый по времени; `idle`
// (рождение), `chase`, `recover`, `dying` — свои позы. Отдаём холст (эхо
// перекрашивает его через `drawImage`).

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { HARPY } from './f11-brains';
import {
  F3,
  FPS,
  KRig,
  PI,
  TAU,
  alpha,
  bankOf,
  clamp01,
  dirN,
  draw,
  easeIn,
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
  put,
  smear,
  spark2,
  spray,
  sstep,
  tn,
  trk,
  vadd,
  vlerp,
  vmul,
  visOf,
  warmAll,
  yawN,
} from './f11-mobkit';
import type { Pic, RGBA, RigOut, V3 } from './f11-mobkit';
import type { Mat } from './f15-rig';

const FEATH = tn('#4a2e22', '#7a4a30', '#a8703f', '#d49c62');
const FEATH_D = tn('#3a2219', '#5e3826', '#86562f', '#b07a48');
const TIP = tn('#1e5a5e', '#2c8088', '#48a8ac', '#7cd0cc');
const SKIN = tn('#9a6248', '#c8866a', '#e8ae8e', '#f8d2b4');
const HAIR = tn('#1a3c40', '#28585c', '#3a787a', '#5a9c98');
const TALON = tn('#6a5a20', '#a88c30', '#d8b848', '#f4dc80');
const EYE = hx('#ffd040');
const EYE_HOT = hx('#ff8a3a');
const PLUME: RGBA[] = [hx('#a8703f'), hx('#d49c62'), hx('#48a8ac'), hx('#7a4a30')];
const GUST = hx('#eaf6ff', 230);

/** Эхо 15-го этажа: его порыв короче (`ECHO.gust` в `f15-brains.ts`). */
const ECHO_GUST = 0.7;

interface HaO {
  fwd: number;
  /** Подъём корпуса над высотой полёта, пикс. рига. */
  up: number;
  lean: number;
  roll: number;
  twist: number;
  head: number;
  hturn: number;
  /** Крылья: взмах (−1 вверх … 1 вниз), раскрытие 0…1, отвод назад 0…1, сложены 0…1. */
  flap: number;
  spread: number;
  sweep: number;
  fold: number;
  /** Кончики крыльев отстают от взмаха (−1…1). */
  lag: number;
  /** Лапы: вперёд (1) или назад (−1), поджаты 0…1, когти раскрыты 0…1. */
  legF: number;
  legK: number;
  claw: number;
  /** Волосы и хвост отстают по ходу; хвост качается, раскрыт. */
  drag: number;
  tsw: number;
  tfan: number;
  /** Клюв-рот раскрыт, глаза закрыты, угасание, лежит на полу. */
  scream: number;
  shut: number;
  dim: number;
  down: number;
  /** Глаз горит (замах). */
  hot: number;
}

const H0: HaO = {
  fwd: 0,
  up: 0,
  lean: 0.12,
  roll: 0,
  twist: 0,
  head: 0,
  hturn: 0,
  flap: 0,
  spread: 0.9,
  sweep: 0.15,
  fold: 0,
  lag: 0,
  legF: 0,
  legK: 0.35,
  claw: 0,
  drag: 0.2,
  tsw: 0,
  tfan: 0.4,
  scream: 0,
  shut: 0,
  dim: 0,
  down: 0,
  hot: 0,
};

const SK = 1.45;
const HIP_Z = 7.2;

/**
 * Размах крыльев на боковых сторонах доворачивается к зрителю (до 40°): с
 * честного бока крылья смотрят на камеру ребром и пропадают. Корпус, голова,
 * лапы и хвост — по курсу.
 */
/** Плоскость крыльев к камере: анфас — задней кромкой вверх, в профиль —
 *  ближним крылом вниз (верх крыла смотрит в камеру). */
const wingTo = (T: F3, yaw: number): F3 =>
  T.turn(0.6 * Math.cos(yaw) ** 3)
    .pitch(0.6 * Math.max(0, Math.sin(yaw)) ** 2)
    .roll(0.2 * Math.cos(yaw));

/** Корпус: таз и грудь в мире по позе. */
function frames(o: HaO, yaw: number): { B: F3; P: F3; T: F3 } {
  const B = F3.yaw(yaw).scale(SK);
  const dn = o.down;
  const P = B.at(o.fwd, 0, HIP_Z + o.up - dn * (HIP_Z - 1.6))
    .roll(o.roll + dn * 0.25)
    .pitch(o.lean + dn * 1.25);
  const T = P.turn(o.twist);
  return { B, P, T };
}

/** Точки крыла: плечо, локоть, запястье, концы маховых (наружу → назад). */
function wingPts(
  T: F3,
  sd: number,
  o: HaO,
  D: F3 = T,
): { root: V3; elb: V3; wr: V3; tips: V3[]; back: V3 } {
  const root = T.p(-0.15, sd * 1.55, 4.7);
  // D — плоскость крыла, наклонённая к камере (wingTo): иначе анфас и в профиль
  // крыло видно ребром.
  const out = D.v(0, sd, 0);
  const up = D.v(0, 0, 1);
  const back = D.v(-1, 0, 0);
  const fw = D.v(1, 0, 0);
  const sp = o.spread * (1 - o.fold);
  const e = -o.flap * 0.95;
  const el = -(o.flap + o.lag * 0.6) * 1.15;
  const dir = (a: number, s: number, b: number): V3 =>
    vadd(vadd(vmul(out, Math.cos(a) * s), vmul(up, Math.sin(a) * s)), vmul(back, b));
  // Сложены — плечо и предплечье вдоль бока вниз-назад, маховые вниз.
  const fold = o.fold;
  const elbOpen = vadd(root, dir(e, 2.6 + 0.8 * sp, 0.5 + o.sweep * 1.3 - sp * 0.3));
  const elbFold = vadd(root, vadd(vmul(back, 1.4), vadd(vmul(up, -2.2), vmul(out, 0.6))));
  const elb = vlerp(elbOpen, elbFold, fold);
  const wrOpen = vadd(elb, dir(el, 1.6 + 2.0 * sp, 0.3 + o.sweep * 1.8 - sp * 0.4));
  const wrFold = vadd(elbFold, vadd(vmul(fw, 0.9), vadd(vmul(up, -1.6), vmul(out, 0.3))));
  const wr = vlerp(wrOpen, wrFold, fold);
  const tips: V3[] = [];
  const tipE = -(o.flap + o.lag) * 1.2;
  for (let i = 0; i < 5; i++) {
    const L = 5.6 - i * 0.55;
    // Веер: от «наружу» к «назад», раскрытие разводит маховые.
    const a = (0.05 + i * (0.16 + 0.12 * sp)) * (1 - 0.5 * fold);
    const fo = Math.cos(a) * (0.35 + 0.65 * sp);
    const fb = Math.sin(a) + o.sweep * 0.6 + (1 - sp) * 0.5;
    const u = Math.sin(tipE) * fo - 0.15 * i * (1 - fold);
    const ox = Math.cos(tipE) * fo;
    const d0 = vadd(vadd(vmul(out, ox), vmul(up, u)), vmul(back, fb));
    const dOpen = vmul(d0, L);
    const dFold: V3 = vadd(
      vmul(back, 1.6 + i * 0.5),
      vadd(vmul(up, -4.2 + i * 0.3), vmul(out, 0.3)),
    );
    tips.push(vadd(wr, vlerp(dOpen, dFold, fold)));
  }
  // Задняя кромка у тела (вторичные маховые ложатся до бедра).
  const back0 = vadd(root, D.v(-0.75 - 0.6 * (1 - fold), -sd * 0.3, -2.1));
  return { root, elb, wr, tips, back: back0 };
}

function wing(r: KRig, T: F3, sd: number, o: HaO, D: F3): void {
  const { root, elb, wr, tips, back } = wingPts(T, sd, o, D);
  const cov: Mat = { T: FEATH, bias: 0.12 };
  const fl: Mat = { T: FEATH_D, bias: 0.05 };
  // Маховые: перо — грань от запястья к концу, соседние перекрываются.
  for (let i = 4; i >= 0; i--) {
    const a = tips[i];
    const b = i < 4 ? tips[i + 1] : vlerp(wr, back, 0.55);
    const mid = vlerp(a, b, 0.5);
    r.poly([wr, a, vlerp(mid, wr, 0.15)], fl);
  }
  // Вторичные — от предплечья к задней кромке.
  r.poly([elb, wr, tips[4], back], fl);
  r.poly([root, elb, back], fl);
  // Кроющие по кости — светлая полоса поверх маховых.
  r.poly([root, elb, vlerp(elb, back, 0.45), vlerp(root, back, 0.5)], cov);
  r.poly([elb, wr, vlerp(wr, tips[3], 0.35), vlerp(elb, back, 0.45)], cov);
  r.cap(root, elb, 0.75, 0.6, cov);
  r.cap(elb, wr, 0.6, 0.45, cov);
  // Бирюзовые кончики маховых.
  for (let i = 0; i < 5; i++) {
    const t0 = vlerp(wr, tips[i], 0.84);
    r.cap(t0, tips[i], 0.3, 0.15, { T: TIP, bias: 0.1 });
  }
}

function harpyRig(o: HaO, yaw: number): KRig {
  const r = new KRig(SK);
  const { B, P, T } = frames(o, yaw);
  const cs = Math.cos(yaw) >= 0 ? 1 : -1;
  const skin: Mat = { T: SKIN };
  const feath: Mat = { T: FEATH, bias: 0.05 };
  // Крылья — первыми (глубина рассудит).
  const Dw = wingTo(T, yaw);
  wing(r, T, 1, o, Dw);
  wing(r, T, -1, o, Dw);
  // Хвост — веер из пяти перьев назад-вниз, качается.
  const tq = P.p(-1.3, 0, -1.4);
  for (let i = -2; i <= 2; i++) {
    const s = i * (0.45 + 0.5 * o.tfan) + o.tsw * 1.2;
    const end = vadd(tq, P.v(-3.6 - o.drag * 0.8 + Math.abs(i) * 0.4, s, -1.6 + o.drag * 1.2));
    r.cap(tq, end, 0.75, 0.5, i === 0 ? feath : { T: FEATH_D });
    r.cap(vlerp(tq, end, 0.75), end, 0.5, 0.35, { T: TIP });
  }
  // Лапы: из перьевых «штанов», в полёте висят, на броске — вперёд.
  for (const sd of [-1, 1]) {
    const hip = P.p(0.1, sd * 0.85, -1.0);
    const k = o.legK + (sd > 0 ? 0.1 : 0);
    const fwd = o.legF;
    let foot = P.p(-0.8 + fwd * 3.6 - k * 0.6, sd * 0.75, -4.6 + k * 1.6 + Math.max(0, fwd) * 1.4);
    if (o.down > 0) foot = vlerp(foot, B.p(-2.4, sd * 1.4, 0.4), o.down);
    leg(r, hip, foot, 2.6 * SK, 2.4 * SK, P.v(-1, 0, 0.2), [0.75, 0.42, 0.35], { T: TALON });
    // Пальцы: три вперёд, один назад; когти раскрываются.
    const fF = P.v(1, 0, -0.35 + 0.5 * o.claw);
    for (const q of [-1, 0, 1]) {
      const toe = vadd(
        foot,
        vadd(vmul(fF, 1.3 + 0.5 * o.claw), P.v(0, q * (0.45 + 0.6 * o.claw), 0)),
      );
      r.cap(foot, toe, 0.32, 0.18, { T: TALON });
      r.cap(toe, vadd(toe, P.v(0.2, q * 0.1, -0.7)), 0.18, 0.05, {
        T: tn('#1a1408', '#2e2414', '#4a3a20', '#6a5a3a'),
      });
    }
    r.cap(foot, vadd(foot, P.v(-1.0, 0, -0.2)), 0.28, 0.14, { T: TALON });
  }
  // Перья ниже пояса и тело.
  r.ell(P, [0, 0, -0.4], [1.6, 1.85, 1.5], feath);
  r.ell(P, [-0.3, 0, -1.4], [1.4, 1.6, 1.0], { T: FEATH_D });
  r.ell(T, [0.1, 0, 1.9], [1.05, 1.4, 1.5], skin);
  r.ell(T, [0.15, 0, 3.6], [1.25, 1.7, 1.3], skin);
  // Пуховой воротник на плечах — переход к крыльям.
  r.ell(T, [-0.1, 0, 4.5], [1.2, 2.0, 0.75], feath);
  r.cap(T.p(0.05, 0, 4.8), T.p(0.25, 0, 5.8), 0.6, 0.55, skin);
  // Голова: лицо, волосы назад, хохолок.
  const Hd = T.at(0.35, 0, 7.0).turn(o.hturn).pitch(o.head);
  r.ball(Hd.p(0, 0, 0), 1.75, skin);
  const hair: Mat = { T: HAIR, bias: -0.05 };
  r.ell(Hd, [-0.5, 0, 0.4], [1.55, 1.85, 1.6], hair);
  r.ell(Hd, [0.7, 0, 1.15], [0.8, 1.6, 0.5], hair);
  // Волосы — гривой назад-вниз, две пряди отстают по ходу.
  for (const s of [-1, 1]) {
    const a = Hd.p(-1.1, s * 0.75, 0.3);
    const b = vadd(a, B.v(-1.0 - o.drag * 1.0, s * 0.4 + o.tsw * 0.3, -1.5 + o.drag * 0.9));
    const c = vadd(b, B.v(-0.7 - o.drag * 1.0, s * 0.3 + o.tsw * 0.6, -1.3 + o.drag * 1.0));
    r.cap(a, b, 0.8, 0.55, hair);
    r.cap(b, c, 0.55, 0.25, { T: HAIR, bias: -0.1 });
  }
  const lit = o.shut < 0.5 && o.dim < 0.7;
  for (const sd of [-1, 1])
    if (lit)
      r.dot(
        Hd.p(1.5, sd * 0.65, 0.15),
        alpha(o.hot > 0.5 ? EYE_HOT : EYE, 1 - o.dim),
        0.5 * (1 - o.dim),
        1,
        0.6,
      );
  if (o.scream > 0.3) r.dot(Hd.p(1.65, 0, -0.75), hx('#5a1a14'), 0, 1, 0.5);
  r.eye = lit && o.dim < 0.5 ? Hd.p(1.5, cs * 0.65, 0.15) : null;
  return r;
}

// ---- Дорожки ----------------------------------------------------------------

const FLAP_T = HARPY.flap;
const CLAW_T = HARPY.claw;

/** Полёт на месте (8 кадров цикла) и на ходу (`run`): вниз быстро, вверх плавно. */
function flyO(f: number, run: boolean): HaO {
  const ph = f / 8;
  // Взмах: вниз на кадрах 0–3 (быстрее), вверх 3–8.
  const k = ph < 0.4 ? easeIn(ph / 0.4) : 1 - sstep(0.4, 1, ph);
  const o: HaO = { ...H0 };
  o.flap = -0.85 + 1.75 * k;
  o.lag = trk(ph, [
    [0, -0.5],
    [0.15, 0.6],
    [0.45, 0.2],
    [0.6, -0.7],
    [1, -0.5],
  ]);
  o.up = 0.9 * Math.sin(ph * TAU - 0.4);
  o.tsw = 0.45 * Math.sin(ph * TAU - 1.6);
  o.legK = 0.35 + 0.15 * Math.sin(ph * TAU - 2);
  if (run) {
    o.lean = 0.45;
    o.legF = -0.55;
    o.legK = 0.6;
    o.sweep = 0.2;
    o.drag = 0.7;
    o.tfan = 0.15;
    o.head = -0.25;
  } else o.drag = 0.25 + 0.1 * Math.sin(ph * TAU - 1);
  return o;
}

/** Пятится от героя: корпус откинут, крылья гребут вперёд, лапы вперёд. */
function backO(f: number): HaO {
  const o = flyO(f, false);
  o.lean = -0.25;
  o.sweep = -0.25;
  o.legF = 0.35;
  o.tfan = 0.8;
  o.head = 0.1;
  return o;
}

/** Порыв: T — время от начала замаха; урон и контакт — FLAP_T. */
function flapO(T: number): HaO {
  const o: HaO = { ...H0 };
  const C = FLAP_T;
  o.flap = trk(T, [
    [0, 0],
    [0.12, 0.45, easeOut],
    [0.42, -1.2],
    [C - 0.1, -1.3],
    [C - 0.02, 1.05, easeIn],
    [C + 0.06, 1.2],
    [C + 0.22, -0.2],
    [C + 0.42, 0.1],
  ]);
  o.lag = trk(T, [
    [0, 0],
    [0.3, 0.5],
    [C - 0.1, 0.35],
    [C - 0.04, -0.6, easeIn],
    [C + 0.04, -0.9],
    [C + 0.14, 0.6],
    [C + 0.3, -0.2],
    [C + 0.45, 0],
  ]);
  o.sweep = trk(T, [
    [0, 0.15],
    [0.42, 0.75],
    [C - 0.1, 0.8],
    [C - 0.02, -0.55, easeIn],
    [C + 0.12, -0.45],
    [C + 0.4, 0.1],
  ]);
  o.spread = trk(T, [
    [0, 0.9],
    [0.4, 1],
    [C + 0.15, 1],
    [C + 0.4, 0.9],
  ]);
  o.up = trk(T, [
    [0, 0],
    [0.12, -0.6],
    [0.45, 1.6, easeOut],
    [C - 0.08, 1.9],
    [C, -0.4, easeIn],
    [C + 0.12, -0.7],
    [C + 0.42, 0],
  ]);
  o.lean = trk(T, [
    [0, 0.12],
    [0.45, -0.32],
    [C - 0.06, -0.38],
    [C, 0.42, easeIn],
    [C + 0.12, 0.38],
    [C + 0.42, 0.05],
  ]);
  o.head = trk(T, [
    [0, 0],
    [0.4, -0.25],
    [C - 0.04, -0.3],
    [C + 0.02, 0.2],
    [C + 0.4, 0],
  ]);
  o.legK = trk(T, [
    [0, 0.35],
    [0.45, 0.85],
    [C, 0.2],
    [C + 0.35, 0.35],
  ]);
  o.tfan = trk(T, [
    [0, 0.4],
    [0.45, 1],
    [C + 0.2, 1],
    [C + 0.45, 0.4],
  ]);
  o.tsw = 0.5 * Math.sin(T * 11) * (1 - sstep(C - 0.1, C, T)) * sstep(0, 0.3, T);
  o.scream = T > 0.35 && T < C + 0.25 ? 1 : 0;
  o.hot = T > 0.3 && T < C + 0.1 ? 1 : 0;
  // Задержка на пике — дрожь крыльев.
  if (T > 0.5 && T < C - 0.1) {
    const j = Math.floor(T * FPS) % 2 ? 1 : -1;
    o.lag += 0.12 * j;
    o.up += 0.18 * j;
  }
  return o;
}

/** Когти: подтянулась (0–0,4), задержка, бросок (лапы вперёд) — с CLAW_T. */
function clawO(T: number): HaO {
  const o: HaO = { ...H0 };
  const C = CLAW_T;
  o.up = trk(T, [
    [0, 0],
    [0.3, 1.8, easeOut],
    [C, 2.0],
    [C + 0.1, -0.6, easeIn],
    [C + 0.26, -1.0],
  ]);
  o.lean = trk(T, [
    [0, 0.12],
    [0.3, -0.35, easeOut],
    [C, -0.4],
    [C + 0.08, 0.55, easeIn],
    [C + 0.26, 0.5],
  ]);
  o.flap = trk(T, [
    [0, 0],
    [0.18, 0.7],
    [0.38, -1.0, easeOut],
    [C, -1.05],
    [C + 0.08, 0.2, easeIn],
    [C + 0.26, 0.4],
  ]);
  o.sweep = trk(T, [
    [0, 0.15],
    [C, 0.4],
    [C + 0.06, 1, easeIn],
  ]);
  o.spread = trk(T, [
    [0, 0.9],
    [C, 1],
    [C + 0.08, 0.45],
  ]);
  o.lag = trk(T, [
    [0, 0],
    [0.2, -0.4],
    [0.4, 0.5],
    [C, 0.3],
    [C + 0.08, 0.8],
  ]);
  o.legF = trk(T, [
    [0, 0],
    [0.35, 0.65, easeOut],
    [C, 0.75],
    [C + 0.06, 1.15, easeIn],
  ]);
  o.legK = trk(T, [
    [0, 0.35],
    [0.35, 0.9],
    [C, 0.95],
    [C + 0.06, 0, easeIn],
  ]);
  o.claw = sstep(0.1, 0.4, T);
  o.drag = trk(T, [
    [0, 0.2],
    [C, 0.3],
    [C + 0.08, 1.4],
  ]);
  o.tfan = trk(T, [
    [0, 0.4],
    [C, 0.9],
    [C + 0.08, 0.1],
  ]);
  o.scream = T > 0.2 ? 1 : 0;
  o.hot = T > 0.15 ? 1 : 0;
  o.head = T < C ? -0.15 : 0.25;
  if (T > 0.38 && T < C) o.up += Math.floor(T * FPS) % 2 ? 0.2 : -0.2;
  return o;
}

/** Торможение после броска: хлопок вперёд, корпус встаёт (u — время отдыха). */
function lungeFO(u: number): HaO {
  const o: HaO = { ...clawO(CLAW_T + 0.26) };
  o.lean = trk(u, [
    [0, 0.5],
    [0.12, -0.45, easeOut],
    [0.4, -0.25],
  ]);
  o.up = trk(u, [
    [0, -1.0],
    [0.15, 1.2, easeOut],
    [0.4, 0],
  ]);
  o.flap = trk(u, [
    [0, 0.4],
    [0.06, -1.0, easeOut],
    [0.16, 1.1, easeIn],
    [0.3, -0.4],
    [0.42, 0],
  ]);
  o.sweep = trk(u, [
    [0, 1],
    [0.12, -0.35],
    [0.42, -0.2],
  ]);
  o.spread = trk(u, [
    [0, 0.45],
    [0.1, 1],
    [0.42, 0.9],
  ]);
  o.legF = trk(u, [
    [0, 1.15],
    [0.25, 0.35],
  ]);
  o.legK = trk(u, [
    [0, 0],
    [0.25, 0.35],
  ]);
  o.claw = 1 - sstep(0.1, 0.35, u);
  o.drag = trk(u, [
    [0, 1.4],
    [0.35, 0.25],
  ]);
  o.tfan = trk(u, [
    [0, 0.1],
    [0.15, 1],
    [0.42, 0.8],
  ]);
  o.scream = 0;
  o.hot = 0;
  o.head = 0.1;
  return o;
}

/** Проводка порыва (u — время отдыха): крылья доходят вперёд-вниз и возвращаются. */
function flapFO(u: number): HaO {
  const o = flapO(FLAP_T + u);
  // К концу проводки — переход в «пятится» (откинутый корпус).
  const k = sstep(0.25, 0.5, u);
  o.lean = o.lean * (1 - k) - 0.25 * k;
  o.legF = 0.35 * k;
  return o;
}

/** Насест: сидит, крылья плащом; оглядывается, перья топорщатся. */
function perchO(f: number, shut = false): HaO {
  const a = (f / 8) * TAU;
  const o: HaO = { ...H0 };
  o.fold = 1;
  o.up = -(HIP_Z - 3.6) + 0.15 * Math.sin(a);
  o.lean = 0.05;
  o.legK = 1;
  o.legF = 0.1;
  o.hturn = f >= 3 && f <= 5 ? 0.8 : f === 2 || f === 6 ? 0.4 : 0;
  o.head = 0.08 * Math.sin(a);
  o.tsw = 0.15 * Math.sin(a * 2);
  o.tfan = 0.2;
  o.drag = 0;
  if (shut) {
    o.shut = 1;
    o.hturn = 0;
    o.head = 0.35;
  }
  return o;
}

/** Взлёт с насеста (0,42 с): присела, оттолкнулась, первый взмах. */
function takeoffO(T: number): HaO {
  const k = sstep(0.05, 0.3, T);
  const o = flyO(Math.floor(T * 20) % 8, false);
  const p = perchO(0);
  o.fold = 1 - sstep(0.04, 0.2, T);
  o.up = trk(T, [
    [0, p.up],
    [0.06, p.up - 0.6],
    [0.3, 1.2, easeOut],
    [0.42, 0],
  ]);
  o.flap = trk(T, [
    [0.04, 0],
    [0.14, -1.1, easeOut],
    [0.24, 1.1, easeIn],
    [0.34, -0.6],
    [0.42, -0.3],
  ]);
  o.legK = 1 - 0.6 * k;
  o.scream = T > 0.06 && T < 0.3 ? 1 : 0;
  o.tfan = 0.2 + 0.7 * k;
  return o;
}

function harpyPose(anim: string, f: number): HaO {
  const t = (f + 0.5) / FPS;
  switch (anim) {
    case 'fly':
      return flyO(f, false);
    case 'flym':
      return flyO(f, true);
    case 'back':
      return backO(f);
    case 'flap':
      return flapO(Math.min(t, FLAP_T - 0.005));
    case 'flapf':
      return flapFO(t - 0.5 / FPS + 0.004);
    case 'claw':
      return clawO(Math.min(t, CLAW_T - 0.005));
    case 'lunge':
      return clawO(CLAW_T + t);
    case 'lungef':
      return lungeFO(t - 0.5 / FPS + 0.004);
    case 'perch':
      return perchO(f);
    case 'sleep':
      return perchO(f * 4, true);
    case 'takeoff':
      return takeoffO(t);
    case 'flinch': {
      const k = f / 4;
      const b = Math.sin(PI * Math.min(1, k * 1.25)) * (1 - k * 0.5);
      return {
        ...H0,
        lean: 0.12 - 0.5 * b,
        head: -0.45 * b,
        fwd: -1.0 * b,
        up: 0.6 * b,
        flap: -1.0 * b,
        lag: 0.8 * b,
        spread: 0.9 + 0.1 * b,
        legK: 0.35 + 0.5 * b,
        tfan: 0.4 + 0.5 * b,
        shut: b > 0.5 ? 1 : 0,
        scream: b > 0.3 ? 1 : 0,
        tsw: 0.6 * b,
      };
    }
    case 'die': {
      // 22 кадра (0,9 с): вскрик, крылья вверх (0–0,12), ломаются и падает
      // (0,12–0,42), отскок, лежит, крыло вздрагивает, гаснет (0,5–0,9).
      const o: HaO = { ...H0 };
      o.flap = trk(t, [
        [0, -1.2, easeOut],
        [0.12, -1.0],
        [0.4, 0.9, easeIn],
        [0.46, 0.6],
        [0.52, 1.0],
        [0.62, 0.85],
        [0.7, 1.0],
      ]);
      o.lag = trk(t, [
        [0, 0.6],
        [0.2, -0.8],
        [0.42, 0.9],
        [0.5, 0],
      ]);
      o.spread = trk(t, [
        [0, 1],
        [0.42, 0.8],
        [0.6, 0.6],
      ]);
      o.sweep = trk(t, [
        [0, 0.2],
        [0.42, 0.55],
      ]);
      o.lean = trk(t, [
        [0, -0.45, easeOut],
        [0.14, -0.35],
        [0.3, 0.2],
      ]);
      o.head = trk(t, [
        [0, -0.55],
        [0.2, -0.3],
        [0.44, 0.55],
      ]);
      o.down = trk(t, [
        [0.12, 0],
        [0.4, 1, easeIn],
        [0.45, 0.9],
        [0.5, 1],
      ]);
      o.legK = 0.9;
      o.claw = 0.6 * (1 - sstep(0.4, 0.7, t));
      o.tfan = 0.9;
      o.tsw = trk(t, [
        [0, 0.7],
        [0.4, -0.5],
        [0.5, 0],
      ]);
      o.scream = t < 0.3 ? 1 : 0;
      o.shut = t > 0.42 ? 1 : 0;
      o.dim = sstep(0.45, 0.8, t);
      o.drag = 0.6;
      return o;
    }
  }
  return { ...H0 };
}

// ---- Кадр -------------------------------------------------------------------

const HA = kindOf('harpy', 72, 66, 36, 54, 1400);

/** Концы крыльев на экране (след хлопка). */
function tipsOf(anim: string, f: number, d: number, P2: (v: V3) => [number, number]) {
  const o = harpyPose(anim, f);
  const yaw = yawN(d);
  const { T } = frames(o, yaw);
  const Dw = wingTo(T, yaw);
  const out: { a: [number, number]; b: [number, number] }[] = [];
  for (const sd of [-1, 1]) {
    const w = wingPts(T, sd, o, Dw);
    out.push({ a: P2(w.tips[0]), b: P2(w.wr) });
  }
  return out;
}

const harpyPic = (anim: string, f: number, d: number): Pic => {
  const o0 = harpyPose(anim, f);
  const yaw = yawN(d);
  return draw(HA, harpyRig(o0, yaw), (o: RigOut, P2) => {
    // След хлопка порыва: кончики крыльев за последние кадры (лента воздуха).
    const swing =
      (anim === 'flap' && f >= 18) || (anim === 'flapf' && f <= 2)
        ? 2
        : anim === 'lungef' && f <= 2
          ? 1
          : 0;
    if (swing) {
      for (const side of [0, 1]) {
        const tips: [number, number][] = [];
        const bases: [number, number][] = [];
        for (let i = swing; i >= 0; i--) {
          let a = anim;
          let g = f - i;
          if (g < 0 && anim === 'flapf') {
            a = 'flap';
            g = 20 + g + 1;
          }
          if (g < 0 && anim === 'lungef') {
            a = 'lunge';
            g = 6 + g + 1;
          }
          if (g < 0) continue;
          const w = tipsOf(a, g, d, (v) => {
            const q = P2(v);
            return [q[0], q[1]];
          })[side];
          tips.push(w.a);
          bases.push([(w.a[0] * 2 + w.b[0]) / 3, (w.a[1] * 2 + w.b[1]) / 3]);
        }
        if (tips.length > 1) smear(o, tips, bases, GUST, 0.45);
      }
    }
    if (anim === 'flapf' && f <= 4) {
      // Порыв ушёл вперёд: струи воздуха перед ней.
      const B = F3.yaw(yaw).scale(SK);
      const k = (f + 1) / 5;
      for (let i = 0; i < 5; i++) {
        const s = (i - 2) * 1.6;
        const a0 = P2(B.p(3 + 6 * k, s * (1 + k), 5 - 2 * k));
        const L = 3 + (i % 2);
        for (let j = 0; j < L; j++) {
          const q = P2(B.p(3 + 6 * k + j * 0.8, s * (1 + k), 5 - 2 * k));
          spark2(o, q[0], q[1], alpha(GUST, (0.85 - k * 0.5) * (1 - j / L)), 0.3);
        }
        void a0;
      }
    }
    if (anim === 'die' && f >= 8) {
      // Перья летят и оседают.
      const [x, y] = P2([0, 0, 4]);
      spray(o.p, x, y, 12, 12, Math.min(1, (f - 7) / 12), 53, PLUME, 7, 6);
    }
    if (anim === 'flinch' && f <= 2) {
      const [x, y] = P2([0, 0, 10]);
      spray(o.p, x, y, 5, 7, (f + 1) / 3, 17 + f, PLUME, 2, 2);
    }
    if (anim === 'lunge') {
      // Когти блестят на броске.
      const { P } = frames(o0, yaw);
      const q = P2(P.p(0.8 + o0.legF * 3.6 + 1.4, 0, -4.6 + 1.4 + 0.3));
      spark2(o, q[0], q[1], hx('#fff0b0'), 0.6);
    }
  });
};

const TECH = new Set(['f11_flap', 'f11_claw', 'f11_lunge', 'f11_perch', 'windup', 'sleep']);

registerMobPainter('f11_harpy', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const retreat = md === 'recover';
  const v = visOf(
    m,
    pose,
    TECH.has(md) || retreat || md === 'alert' ? (m.face ?? 0) : headOf(m, 0.6),
    md === 'f11_lunge' ? 30 : 7,
  );
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { shadow: 6, lift: 7, still: true };
  const ph = hash(id, 7);
  let anim = 'fly';
  let f = 0;
  let dark = 0;
  if (md === 'dying') {
    f = fi(t, 21);
    anim = 'die';
    ex.linger = 0.9;
    ex.alpha = 1 - sstep(0.76, 0.9, t);
    // Падает: высота полёта уходит к полу вместе с телом.
    ex.lift = 7 * (1 - sstep(0.12, 0.4, t) ** 1.5);
    ex.shadow = 6 + 2 * sstep(0.3, 0.45, t);
  } else if (md === 'f11_flap' || md === 'windup') {
    // Эхо 15-го: его порыв короче — та же дорожка, быстрее.
    const T = md === 'windup' ? t * (FLAP_T / ECHO_GUST) : t;
    f = fi(T, 20);
    anim = 'flap';
  } else if (md === 'f11_claw') {
    f = fi(t, 11);
    anim = 'claw';
  } else if (md === 'f11_lunge') {
    f = fi(t, 6);
    anim = 'lunge';
    ex.lift = 7 - 3 * sstep(0, 0.12, t);
    ex.ghost = { every: 0.03, life: 0.16, tint: '#7cd0cc', alpha: 0.32 };
  } else if (retreat && v.prev === 'f11_flap' && t < 0.5) {
    f = fi(t, 11);
    anim = 'flapf';
  } else if (retreat && v.prev === 'f11_lunge' && t < 0.42) {
    f = fi(t, 9);
    anim = 'lungef';
    ex.lift = 4 + 3 * sstep(0, 0.3, t);
  } else if (retreat) {
    f = Math.floor(now * 12 + ph * 8) % 8;
    anim = 'back';
  } else if (md === 'f11_perch') {
    f = Math.floor(now * 3 + ph * 8) % 8;
    anim = 'perch';
    ex.lift = 1;
    ex.shadow = 5;
  } else if (md === 'sleep') {
    f = Math.floor(now * 1.2 + ph * 2) % 2;
    anim = 'sleep';
    ex.lift = 1;
    ex.shadow = 5;
  } else if (
    (md === 'chase' && v.prev === 'f11_perch' && t < 0.42) ||
    md === 'alert' ||
    (md === 'chase' && v.prev === 'sleep' && t < 0.42)
  ) {
    const T = md === 'alert' ? t * (0.42 / 0.35) : t;
    f = fi(T, 9);
    anim = 'takeoff';
    ex.lift = 1 + 6 * sstep(0.04, 0.3, T);
  } else if (md === 'emerge' || md === 'drop') {
    const k = clamp01(t / (md === 'emerge' ? 0.45 : 0.55));
    f = Math.floor(now * 12 + ph * 8) % 8;
    dark = md === 'emerge' ? 3 - Math.min(3, Math.floor(k * 4)) : 0;
  } else if (md === 'stun' || hurtAge(v, now) < 0.2) {
    f = fi(md === 'stun' ? t : hurtAge(v, now), 4);
    anim = 'flinch';
  } else if (moving(m, 0.6)) {
    f = Math.floor(now * 13 + ph * 8) % 8;
    anim = 'flym';
    ex.rot = bankOf(v);
  } else {
    f = Math.floor(now * 10 + ph * 8) % 8;
    anim = 'fly';
    ex.rot = bankOf(v, 0.05, 0.1);
  }
  if (md !== 'dying') hurtFx(v, now, 1.3, ex);
  return put(
    frameOf(HA, anim, f, d, pose, (dd) => harpyPic(anim, f, dd), dark),
    ex,
  );
});

registerMobWarm('f11_harpy', function* () {
  yield* warmAll(
    HA,
    [
      ['fly', 8],
      ['flym', 8],
      ['back', 8],
      ['flap', 21],
      ['flapf', 12],
      ['claw', 12],
      ['lunge', 7],
      ['lungef', 10],
      ['flinch', 5],
      ['die', 22],
      ['perch', 8],
      ['takeoff', 10],
    ],
    harpyPic,
  );
});
