// Этаж 6 — Пепельный летун (анимации мобов 6). Летучая мышь из пепла: серый
// мех, перепонки цвета тлеющей бумаги с горящей кромкой, глаза-угли, уши
// торчком. Мини-3D (риг 15-го), 8 сторон честно. Высоту полёта рисует кадр
// (`lift` 0): полёт, посадка, пике и падение мёртвого — одним движением.
//
// Ход — взмахи 4 Гц (6 кадров): тело подскакивает на взмахе вниз, концы
// крыльев отстают, с перепонок сыплется пепел; быстро — нос вниз, крен в
// поворот. Прицел 0,6 с: взмывает, запрокидывается, крылья распахнуты и
// дрожат, к концу складываются — пике 0,55 с дротиком вниз, в конце крылья
// раскрываются тормозом — посадка 1,1 с: плащ из крыльев, оглядывается,
// толчок и взлёт. Укус 0,55: откинулся, пасть, крылья вверх — бросок с
// взмахом вниз ровно на 0,55. Смерть 0,85 с: дёрнулся, кувырком вниз,
// шлепок пепла, рассыпается кучкой, угли гаснут.

import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { BAT } from './f6-brains';
import { F3, Rig, vadd } from './f15-rig';
import type { Mat } from './f15-rig';
import {
  alpha,
  angD,
  clamp,
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
  hurtFx,
  hx,
  kf,
  kindOf,
  litOn,
  mixc,
  mod,
  PI,
  speedOf,
  sstep,
  TAU,
  tn,
  trk,
  visOf,
  warmAll,
  yawN,
} from './f6-mobkit';
import type { Pic, Proj2 } from './f6-mobkit';

const FUR = tn('#262020', '#46403c', '#6e6660', '#a09690');
const MEMB = tn('#3a120a', '#6e2410', '#a8401a', '#e07a34');
const BONE = hx('#2a2422');
const EDGE_HOT = FIRE[2];
const EYE = hx('#ffb040');
const MAW = tn('#3a0806', '#7a140c', '#c8301a', '#ff7a40');
const FANG = hx('#f4e8d8');
const ASHC = hx('#8a827c');

/** Высота полёта в кадре (клеток рига ≈ пикс.); размер тела. */
const AIR = 11;
const SC = 1.45;

interface BatO {
  z: number;
  fwd: number;
  pitch: number;
  roll: number;
  /** Крыло: угол взмаха (+ вверх), отставание концов, сложено 0…1, вынос вперёд. */
  a: number;
  lag: number;
  fold: number;
  sweep: number;
  /** Задняя кромка вниз 0…1 (перепонка лицом к камере). */
  drape: number;
  /** Голова: нос вниз (+), пасть 0…1, уши назад 0…1, глаза разгорелись. */
  head: number;
  jaw: number;
  ear: number;
  glow: number;
  /** Лапки поджаты 0…1 (в полёте) / держат землю (0). */
  tuck: number;
  /** Пепел с крыльев 0…1, рассыпался 0…1, погас 0…1, щелчок пасти. */
  ash: number;
  crumble: number;
  dark: number;
  snap: number;
}
const B0: BatO = {
  z: AIR,
  fwd: 0,
  pitch: 0,
  roll: 0,
  a: 0.2,
  lag: 0,
  fold: 0,
  sweep: 0,
  drape: 0.2,
  head: 0,
  jaw: 0,
  ear: 0,
  glow: 0.6,
  tuck: 1,
  ash: 0,
  crumble: 0,
  dark: 0,
  snap: 0,
};

/** Взмах: фаза 0…1 → угол, отставание концов, подскок тела. */
function flap(o: BatO, ph: number, amp = 1): void {
  const c = Math.cos(ph * TAU);
  const s = Math.sin(ph * TAU);
  o.a = 0.15 + 0.85 * amp * c;
  o.lag = 0.45 * amp * s;
  o.z += -0.9 * amp * c;
  o.sweep = 0.5 * amp * s;
  o.ash = s > 0 ? s * amp : 0;
}

function wing(r: Rig, C: F3, sd: number, o: BatO, m: Mat, em: Mat): void {
  const S = C.p(0.4, sd * 1.1, 0.7);
  const k = 1 - 0.62 * o.fold;
  // Задняя кромка: назад по телу или (`drape`) вниз — перепонка к камере.
  const pt = (fc: number, sp: number, ang: number) => {
    const back = Math.min(0, fc);
    const f = fc - back * o.drape - o.fold * sp * 0.28 + (o.sweep * sp) / 9;
    return vadd(S, C.v(f, sd * sp * k * Math.cos(ang), sp * k * Math.sin(ang) + back * o.drape));
  };
  const el = pt(0.9, 3.0, o.a);
  const wr = pt(1.3, 5.6, o.a + o.lag * 0.4);
  const t1 = pt(-0.2, 9.2, o.a + o.lag);
  const t2 = pt(-3.2, 7.6, o.a + o.lag * 0.9);
  const t3 = pt(-4.0, 4.6, o.a + o.lag * 0.6);
  const hip = C.p(-1.6, sd * 0.9, -0.3 - o.drape);
  r.poly([S, el, wr], m);
  r.poly([S, wr, t1], m);
  r.poly([S, t1, t2], m);
  r.poly([S, t2, t3], m);
  r.poly([S, t3, hip], m);
  // Кости и тлеющая кромка перепонки.
  r.cap(S, el, 0.7, 0.55, em);
  r.cap(el, wr, 0.55, 0.45, em);
  r.line(wr, t1, BONE, 0, 0.4);
  r.line(wr, t2, BONE, 0, 0.4);
  r.line(wr, t3, BONE, 0, 0.4);
  const hot = alpha(mixc(EDGE_HOT, MEMB[1], o.dark), 1);
  const g = 0.55 * (1 - o.dark);
  r.line(t1, t2, hot, g, 0.5);
  r.line(t2, t3, hot, g, 0.5);
  r.line(t3, hip, hot, g * 0.6, 0.5);
  r.dot(wr, FUR[3], 0, 1, 0.6);
}

function batRig(o: BatO, yaw: number): Rig {
  const r = new Rig();
  const B = F3.yaw(yaw);
  const C = B.at(o.fwd, 0, o.z).pitch(o.pitch).roll(o.roll).scale(SC);
  const furM: Mat = { T: FUR, bias: -o.dark * 0.6 };
  const memM: Mat = { T: MEMB, bias: -0.05 - o.dark * 0.6, glow: 0.12 * (1 - o.dark) };
  // Крылья — первыми: тело перекрывает их корень.
  for (const sd of [-1, 1]) wing(r, C, sd, o, memM, furM);
  // Тельце, грудка светлее.
  r.ell(C, [0, 0, 0], [2.2, 1.8, 1.9], furM);
  r.ell(C, [0.9, 0, -0.2], [1.0, 1.1, 1.2], { T: FUR, bias: 0.2 - o.dark * 0.6 });
  // Лапки: в полёте поджаты, на земле — упор.
  for (const sd of [-1, 1]) {
    const a = C.p(-0.9, sd * 0.6, -1.2);
    const b = vadd(a, B.v(-0.4 - o.tuck * 0.9, sd * 0.3, -1.8 + o.tuck * 0.7));
    r.cap(a, b, 0.45, 0.3, furM);
  }
  // Голова, уши, морда.
  const H = C.at(1.9, 0, 0.9).pitch(o.head);
  r.ell(H, [0, 0, 0], [1.6, 1.7, 1.5], furM);
  r.ell(H, [1.1, 0, -0.3], [0.8, 0.75, 0.6], furM);
  for (const sd of [-1, 1]) {
    r.spike(
      H.p(-0.2, sd * 0.75, 0.9),
      H.v(-0.3 - o.ear * 0.9, sd * 0.45, 1 - o.ear * 0.3),
      2.5 * SC,
      0.6 * SC,
      furM,
      3,
    );
    r.dot(H.p(1.0, sd * 0.68, 0.35), EYE, (0.6 + o.glow * 0.4) * (1 - o.dark), 1, 2.2);
  }
  if (o.jaw > 0.05) {
    r.ell(H, [1.45, 0, -0.55 - o.jaw * 0.3], [0.5, 0.55, 0.3 + o.jaw * 0.35], {
      T: MAW,
      glow: 0.4 * o.jaw,
    });
    if (o.jaw > 0.3) for (const sd of [-1, 1]) r.dot(H.p(1.75, sd * 0.3, -0.35), FANG, 0, 1, 2.4);
  }
  if (o.snap > 0) r.dot(H.p(2.4, 0, -0.5), alpha(hx('#fff4c0'), o.snap), 1, 2, 1);
  r.eye = H.p(1.0, (Math.cos(yaw) >= 0 ? 1 : -1) * 0.68, 0.35);
  if (o.crumble > 0) r.explode(o.crumble, C.p(0, 0, -1), 5, 4, 14, 0, 0.6);
  return r;
}

function batPose(anim: string, f: number): BatO {
  const o: BatO = { ...B0 };
  switch (anim) {
    case 'fly': {
      flap(o, f / 6);
      o.pitch = -0.05;
      break;
    }
    case 'flyf': {
      // Быстро: нос вниз, гребок назад, уши прижаты.
      flap(o, f / 6, 1.1);
      o.pitch = 0.3;
      o.sweep -= 0.6;
      o.ear = 0.5;
      o.z -= 0.6;
      break;
    }
    case 'aim': {
      // 0,6 с: взмыл и запрокинулся (до 0,5), крылья распахнуты и дрожат
      // (до 0,85), складываются к пике (до 1).
      const k = kf(f, BAT.aim);
      o.z =
        AIR +
        trk(k, [
          [0, 0],
          [0.5, 3.2, easeOut],
          [0.85, 3.4],
          [1, 2.6, easeIn],
        ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.5, -0.2, easeOut],
        [0.85, -0.22],
        [1, 0.45, easeIn],
      ]);
      o.a = trk(k, [
        [0, 0.2],
        [0.4, 1.05, easeOut],
        [0.85, 0.95],
        [1, 0.3, easeIn],
      ]);
      o.a += k > 0.4 && k < 0.85 ? (f % 2 ? 0.08 : -0.08) : 0;
      o.fold = sstep(0.82, 1, k) * 0.8;
      o.sweep = -sstep(0.82, 1, k) * 1.5;
      o.head = -0.25 * sstep(0, 0.5, k) + 0.5 * sstep(0.85, 1, k);
      o.ear = 0.3 + 0.6 * sstep(0.7, 1, k);
      o.glow = 0.6 + 0.4 * sstep(0.2, 0.6, k);
      o.jaw = 0.5 * Math.sin(PI * clamp01((k - 0.2) / 0.6));
      // Распахнул перепонки к герою — угроза читается спереди.
      o.drape = 0.2 + 0.6 * sstep(0, 0.4, k) * (1 - sstep(0.82, 1, k));
      break;
    }
    case 'swoop': {
      // 0,55 с: дротик вниз, крылья прижаты (дрожь перьев), в конце —
      // тормоз: крылья раскрыты вверх-вперёд.
      const k = kf(f, BAT.len / BAT.speed);
      o.z = trk(k, [
        [0, AIR + 2.6],
        [0.55, 4.5, easeIn],
        [0.85, 4],
        [1, 4.8],
      ]);
      o.pitch = trk(k, [
        [0, 0.45],
        [0.55, 0.35],
        [0.8, 0.1],
        [1, -0.45, easeOut],
      ]);
      o.fold = 0.85 * (1 - sstep(0.8, 1, k));
      o.a = 0.3 + (f % 2 ? 0.06 : -0.06) * (1 - sstep(0.8, 1, k)) + 0.5 * sstep(0.8, 1, k);
      o.sweep = -1.5 * (1 - sstep(0.8, 1, k)) + 1.2 * sstep(0.8, 1, k);
      o.ear = 1;
      o.glow = 1;
      o.jaw = 0.7;
      break;
    }
    case 'perch': {
      // 1,1 с: сел (до 0,15) — плащ из крыльев, оглядывается — толчок и
      // взлёт (с 0,85).
      const t = f / FPS;
      const land = sstep(0, 0.15, t);
      const go = sstep(0.85, 1.1, t);
      o.z = 2.2 + (AIR + 1 - 2.2) * (1 - land) * (1 - land) * 0.5 + (AIR - 2.2) * go * go;
      if (t < 0.85) o.z += (1 - land) * (4 - 2.2) * 0.5;
      o.tuck = t < 0.12 ? 0.6 : t > 0.9 ? 0.5 : 0;
      if (t < 0.15) {
        // Тормоз: крылья вверх-вперёд, перепонки парусом.
        o.a = 0.9 - 0.4 * land;
        o.sweep = 1.6;
        o.drape = 0.7;
        o.pitch = -0.3 * (1 - land);
      } else if (t < 0.85) {
        // Плащ: крылья опущены вдоль тела, грудь дышит, голова вертится.
        const q = sstep(0.15, 0.3, t);
        o.fold = 0.7 * q;
        o.a = 0.5 - 0.35 * q;
        o.sweep = 0.8 * q;
        o.drape = 0.7 + 0.3 * q;
        o.z += 0.6 * q;
        o.z += Math.sin(t * 9) * 0.15;
        o.head = 0.1;
        o.roll = Math.sin(t * 5) * 0.06;
        o.ear = 0.1 + 0.2 * Math.max(0, Math.sin(t * 11));
      } else {
        // Толчок вниз и два взмаха.
        const ph = ((t - 0.85) / 0.25) * 2;
        o.fold = 0.7 * (1 - sstep(0.85, 0.92, t));
        flap(o, ph % 1, 1.2);
        o.z += 0;
        o.pitch = -0.2;
      }
      break;
    }
    case 'bite': {
      // Замах 0,55 с (14 кадров): откинулся, пасть, крылья вверх, дрожь
      // (до 0,75) — бросок вперёд со взмахом вниз (до 1 = 0,55).
      const k = kf(f, 0.55);
      o.fwd = trk(k, [
        [0, 0],
        [0.7, -1.3, easeOut],
        [0.8, -1.4],
        [1, 1.8, easeIn],
      ]);
      o.pitch = trk(k, [
        [0, 0],
        [0.7, -0.25, easeOut],
        [0.8, -0.28],
        [1, 0.45, easeIn],
      ]);
      o.a = trk(k, [
        [0, 0.3],
        [0.7, 1.15, easeOut],
        [0.8, 1.2],
        [1, -0.65, easeIn],
      ]);
      o.lag = k > 0.8 ? 0.5 : -0.1;
      o.z = AIR + 1.2 * sstep(0, 0.7, k) - 1.8 * sstep(0.8, 1, k);
      o.head = -0.35 * sstep(0, 0.7, k) + 0.6 * sstep(0.8, 1, k);
      o.jaw = sstep(0.1, 0.6, k) * (k > 0.97 ? 0.3 : 1);
      o.drape = 0.2 + 0.4 * sstep(0, 0.7, k) * (1 - sstep(0.8, 1, k));
      o.ear = 0.8 * sstep(0.5, 0.8, k);
      o.glow = 0.6 + 0.4 * sstep(0.3, 0.7, k);
      if (k > 0.75 && k < 0.8) o.roll = f % 2 ? 0.05 : -0.05;
      break;
    }
    case 'bitef': {
      // Проводка 0,5 с (12 кадров): щелчок, отпрянул, вернулся к взмахам.
      const k = kf(f, 0.5);
      o.snap = f < 2 ? 1 - f * 0.4 : 0;
      o.fwd = 1.8 * (1 - easeOut(k / 0.5));
      if (k > 0.5) o.fwd = 0;
      o.pitch = 0.45 * (1 - sstep(0, 0.4, k));
      o.jaw = f < 2 ? 0.1 : 0.4 * (1 - sstep(0.2, 0.6, k));
      o.head = 0.6 * (1 - sstep(0, 0.4, k));
      flap(o, mod(0.5 + k * 2, 1) + 0.0001, 0.6 + 0.4 * k);
      o.z -= 1.8 * (1 - sstep(0, 0.5, k));
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.25)) * (1 - (f / 4) * 0.5);
      o.a = 0.2 + 1.0 * b;
      o.fold = 0.5 * b;
      o.pitch = -0.4 * b;
      o.roll = 0.3 * b;
      o.ear = b;
      o.glow = 0.2;
      o.jaw = 0.5 * b;
      break;
    }
    case 'sleep': {
      // На земле, завернулся в крылья, дышит.
      o.z = 2.8 + (f % 2) * 0.15;
      o.fold = 0.75;
      o.a = 0.1;
      o.drape = 1;
      o.sweep = 0.8;
      o.tuck = 0;
      o.head = 0.4;
      o.ear = 0.6;
      o.glow = 0;
      o.dark = 0.15;
      break;
    }
    case 'alert': {
      // Встрепенулся: крылья распахнулись, взлёт.
      const k = f / 8;
      o.fold = 0.75 * (1 - sstep(0, 0.4, k));
      o.z = 2.8 + (AIR - 2.8) * easeOut(sstep(0.2, 1, k));
      o.a = 0.1 + 0.9 * sstep(0, 0.4, k) - 0.8 * sstep(0.5, 0.8, k);
      o.drape = 1 - 0.8 * sstep(0.2, 0.8, k);
      o.tuck = sstep(0.3, 0.6, k);
      o.ear = 0.6 * (1 - sstep(0, 0.3, k));
      o.glow = 0.6 + 0.4 * Math.sin(PI * k);
      o.head = 0.4 * (1 - sstep(0, 0.3, k)) - 0.2 * Math.sin(PI * k);
      break;
    }
    case 'die': {
      // 0,85 с (21 кадр): дёрнулся (до 0,1), кувырком вниз (до 0,42),
      // шлепок, рассыпается пеплом, угли гаснут.
      const t = f / FPS;
      const fall = sstep(0.1, 0.42, t);
      o.z = AIR + 1 * sstep(0, 0.08, t) - (AIR + 1 - 1.8) * easeIn(clamp01((t - 0.1) / 0.32));
      if (t < 0.1) {
        o.a = 1.2;
        o.fold = 0.2;
        o.ear = 1;
        o.jaw = 0.8;
        o.glow = 1;
        o.pitch = -0.5;
      } else {
        o.a = 0.3 + Math.sin(f * 1.9) * 0.4 * (1 - fall) - 0.6 * fall;
        o.fold = 0.3;
        o.roll = fall * 1.4;
        o.pitch = fall * 0.6;
        o.jaw = 0.4;
        o.tuck = 0.3;
      }
      o.crumble = sstep(0.42, 0.85, t);
      o.dark = sstep(0.3, 0.75, t);
      break;
    }
  }
  return o;
}

const BK = kindOf('f6_ashbat', 54, 50, 27, 40, 1400);

/** Пепел с перепонок: хлопья под крыльями, сносит назад. */
function ashOn(out: { p: Pic['p'] }, P: Proj2, o: BatO, yaw: number, f: number): void {
  if (o.ash <= 0.1) return;
  const B = F3.yaw(yaw);
  for (let i = 0; i < 4; i++) {
    const sd = i % 2 ? 1 : -1;
    const sp = 3 + hash(i, f, 3) * 5;
    const [x, y] = P(B.p(-1 - hash(i, f, 5) * 3, sd * sp, o.z - 2 - hash(i, f, 7) * 3));
    if (hash(i, f, 9) < o.ash) out.p.set(Math.round(x), Math.round(y), alpha(ASHC, 0.85));
  }
}

function batPic(anim: string, f: number, d: number): Pic {
  const o = batPose(anim, f);
  const yaw = yawN(d);
  return draw(BK, batRig(o, yaw), (out, P) => {
    ashOn(out, P, o, yaw, f);
    if (anim === 'die') {
      const t = f / FPS;
      // Шлепок: кольцо пепла по полу.
      if (t > 0.4 && t < 0.7) {
        const k = (t - 0.4) / 0.3;
        const [cx, cy] = P([0, 0, 0]);
        const R = 3 + k * 7;
        for (let a = 0; a < TAU; a += 0.35) {
          const x = Math.round(cx + Math.cos(a) * R);
          const y = Math.round(cy + Math.sin(a) * R * 0.45 - k * 2);
          out.p.set(x, y, alpha(ASHC, 0.8 * (1 - k)));
        }
      }
      // Угли в кучке гаснут.
      if (t > 0.42) {
        const lit = litOn(out);
        const [cx, cy] = P([0, 0, 0.8]);
        for (let i = 0; i < 4; i++)
          if (hash(i, f, 11) < 1 - sstep(0.5, 0.85, t)) {
            const x = Math.round(cx + (hash(i, 3) - 0.5) * 6);
            const y = Math.round(cy + (hash(i, 4) - 0.5) * 2);
            out.p.set(x, y, FIRE[2]);
            lit.set(x, y, FIRE[2]);
          }
      }
    }
  });
}

const SWOOP_GHOST = { every: 0.03, life: 0.18, tint: '150,140,130', alpha: 0.5 };

registerMobPainter('f6_ashbat', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const sp = speedOf(m);
  const tech = md === 'aim' || md === 'f6_swoop' || md === 'windup';
  const want = tech || sp < 0.6 ? (m.face ?? 0) : Math.atan2(m.vy ?? 0, m.vx ?? 0);
  const v = visOf(m, pose, want, tech ? 18 : 9);
  const d = dirN(v.yaw);
  const ex: Partial<MobFrame> = { lift: 0, still: true, shadow: 4 };
  let anim = 'fly';
  let f = 0;
  if (md === 'dying') {
    anim = 'die';
    f = fi(t, 20);
    ex.linger = 0.85;
    ex.alpha = 1 - sstep(0.72, 0.85, t);
    ex.shadow = 3 + 2 * sstep(0.1, 0.42, t);
    if (t > 0.42 && t < 0.5) {
      ex.sx = 1.2;
      ex.sy = 0.8;
    }
  } else if (md === 'aim') {
    anim = 'aim';
    f = fi(t, 14);
  } else if (md === 'f6_swoop') {
    anim = 'swoop';
    f = fi(t, 13);
    ex.ghost = SWOOP_GHOST;
    ex.shadow = 5;
  } else if (md === 'f6_perch') {
    anim = 'perch';
    f = fi(t, 26);
    ex.shadow = 5;
  } else if (md === 'windup') {
    anim = 'bite';
    f = fi(t, 13);
  } else if (md === 'recover' && v.prev === 'windup') {
    anim = 'bitef';
    f = fi(t, 11);
  } else if (md === 'stun') {
    anim = 'flinch';
    f = fi(t, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(now * 1.1 + hash(id, 3) * 2) % 2;
    ex.shadow = 5;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else {
    // Полёт: взмахи 4 Гц, фаза по id; быстро — нос вниз; крен в поворот.
    anim = sp > 2.5 ? 'flyf' : 'fly';
    f = mod(Math.floor((now + hash(id, 7)) * FPS), 6);
    const turn = angD(want, v.yaw);
    ex.rot = clamp(turn * 0.12, -0.12, 0.12);
  }
  if (md !== 'dying') {
    const age = hurtFx(v, now, 1.6, ex);
    // Удар героя: крылья смяло на 0,2 с (кроме атак — их читаемость важнее).
    if (age >= 0 && age < 0.2 && (anim === 'fly' || anim === 'flyf')) {
      anim = 'flinch';
      f = Math.min(4, Math.floor(age * FPS));
    }
  }
  return { ...frameOf(BK, anim, f, d, pose, () => batPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_ashbat', function* () {
  yield* warmAll(
    BK,
    [
      ['fly', 6],
      ['flyf', 6],
      ['aim', 15],
      ['swoop', 14],
      ['bite', 14],
      ['bitef', 12],
      ['flinch', 5],
      ['perch', 27],
      ['die', 21],
      ['alert', 9],
      ['sleep', 2],
    ],
    batPic,
  );
});
