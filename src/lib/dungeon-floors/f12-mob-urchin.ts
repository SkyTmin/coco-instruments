// Этаж 12 — Ледяной ёж (анимации мобов 12). Мозг `f12_urchin` (`f12-brains.ts`):
// видит героя — ближе 2,4 клетки `f12_bristle` 0,6 с (иглы дыбом → кольцо из
// 10 игл в миг 0,6 → `recover` 0,6), дальше — `f12_curl` 0,7 с (свернулся) →
// `f12_roll` ≤ 1,7 с шаром на 8 кл/с (урон при касании, 3 отскока от стен) →
// `dizzy` 1,3 с. Свёрнутого бьют вполсилы (×0,35).
//
// Кадры (24 к/с от `pose.t`, 8 сторон): покой 12 (8 к/с, фаза от id), ход 6
// на шаг 0,6 клетки (рысь: диагональные пары, иглы покачиваются с запозданием),
// сворачивание 17 (вдох и иглы торчком → клубок → откат назад и раскрутка),
// шар 8 (поворот по пройденному пути, отскок — сжатие), головокружение 6 +
// петля 12 (раскрылся, шатается, звёзды), ощетинивание 15 (сжался, иглы
// прижаты → встают и светятся → дрожь на пике), выстрел 15 (иглы ушли —
// отдача, обрубки отрастают), оглушение 8, смерть 19 (иглы разлетаются,
// тело оседает набок; `linger`).

import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame } from '../dungeon-paint';
import { hash, hx, ICE, ramp, SNOW, TAU, TEAL } from './f12-rig';
import {
  clamp01,
  dirOf,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  idlePh,
  kindOf,
  lerp,
  limb,
  paintMob,
  pitchParts,
  PI,
  puff,
  rollParts,
  smooth,
  speedOf,
  sstep,
  stars,
  stepPh,
  tf,
  trk,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Part, V3 } from './f12-mobkit';

const FUR = ramp('#121a2a', '#22304a', '#34486a', '#4c6488', '#6a84a8');
const SNOUT = ramp('#4a3a44', '#6a5664', '#8e7686', '#b49aa8', '#d8c0cc');
const NOSE = ramp('#0a0608', '#1a1018', '#2a1a24', '#3a2a34', '#5a4a54');
const EYE = hx('#8af0ff');

const K = kindOf('f12_urchin', { w: 38, h: 36, ox: 19, oy: 26 }, 1100);

/** Поза ежа: отклонения от стойки. */
interface UrcO {
  /** 0 — ёж на лапах … 1 — клубок. */
  curl: number;
  /** Поворот клубка вокруг поперечной оси, рад. */
  spin: number;
  /** Иглы: 0 — лежат … 1 — дыбом; длина 0…1 (после выстрела — обрубки). */
  bristle: number;
  qlen: number;
  /** Иглы прижаты назад 0…1 (сжался перед выстрелом). */
  flat: number;
  /** Иглы качаются (запаздывают за телом) −1…1. */
  jig: number;
  /** Светятся иглы (слой поверх темноты). */
  glow: boolean;
  /** Тело: высота, сжатие по высоте, крен, наклон носом вверх. */
  z: number;
  sq: number;
  roll: number;
  pitch: number;
  /** Мордочка: вперёд, вверх, поворот. */
  sniff: number;
  snz: number;
  look: number;
  /** Лапы [вперёд, вверх]: передняя левая, правая, задняя левая, правая. */
  feet: [number, number][];
  /** Глаза закрыты. */
  shut?: boolean;
  /** Звёзды головокружения (фаза 0…1). */
  stars?: number;
  /** Смерть: иглы разлетаются (0…1). */
  scatter?: number;
  /** Снег из-под клубка (доля 0…1) и куда (рад, в осях модели). */
  snow?: [number, number];
}

const F0: [number, number][] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
const O0: UrcO = {
  curl: 0,
  spin: 0,
  bristle: 0,
  qlen: 1,
  flat: 0,
  jig: 0,
  glow: false,
  z: 0,
  sq: 1,
  roll: 0,
  pitch: 0,
  sniff: 0,
  snz: 0,
  look: 0,
  feet: F0,
};

const NQ = 18;
/** Направления игл: на лапах — два кольца по спине назад, в клубке — по сфере. */
const QUN: V3[] = [];
const QBALL: V3[] = [];
for (let i = 0; i < NQ; i++) {
  const ring = i % 3;
  const a = (i / NQ) * TAU;
  const lat = [0.35, 0.8, 1.2][ring];
  QUN.push([Math.cos(lat) * Math.cos(a) * 0.55 - 0.45, Math.cos(lat) * Math.sin(a), Math.sin(lat)]);
  const la = (((i * 0.618) % 1) - 0.5) * PI;
  const lo = a * 1.7;
  QBALL.push([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]);
}

function urchinBuild(o: UrcO): Build {
  const parts: Part[] = [];
  const c = o.curl;
  const rx = lerp(5.2, 4.6, c);
  const ry = lerp(4.4, 4.6, c);
  const rz = lerp(3.6, 4.6, c) * o.sq;
  const z = lerp(3.8, 4.8, c) * o.sq + o.z;
  parts.push({ x: 0, y: 0, z, rx, ry, rz, ramp: FUR, fur: 0.2, pitch: c > 0.5 ? o.spin : 0 });
  // Мордочка прячется в клубок.
  const k = 1 - sstep(0, 0.7, c);
  if (k > 0.02) {
    const sx = rx * 0.9 + o.sniff - (1 - k) * 1.5;
    const sz = z - 0.8 + o.snz;
    const ca = Math.cos(o.look);
    const sa = Math.sin(o.look);
    parts.push({
      x: sx * ca,
      y: sx * sa,
      z: sz,
      rx: 2.2 * k + 0.3,
      ry: 1.8 * k + 0.3,
      rz: 1.6 * k + 0.3,
      ramp: SNOUT,
      yaw: o.look,
    });
    const nx = sx + 2 * k;
    parts.push({ x: nx * ca, y: nx * sa, z: sz - 0.4, rx: 0.8, ry: 0.8, rz: 0.7, ramp: NOSE });
    // Лапы (поджимаются в клубок).
    const tuck = c * 2.4;
    for (let q = 0; q < 4; q++) {
      const front = q < 2;
      const y = q % 2 ? 2.6 : -2.6;
      const [dx, dz] = o.feet[q];
      const hx0 = front ? 2.6 : -2.6;
      const hip: V3 = [hx0, y, 2 + o.z * 0.6];
      const foot: V3 = [hx0 * (1 - c * 0.4) + dx, y * 1.05, 0.9 + dz + tuck];
      const knee: V3 = [
        (hip[0] + foot[0]) / 2 + (front ? -0.3 : 0.4),
        y * 1.1,
        (hip[2] + foot[2]) / 2,
      ];
      limb(parts, hip, knee, foot, 1, 0.9, FUR, 30 + q, 1);
    }
  }
  // Иглы.
  const scat = o.scatter ?? 0;
  const len = (2.4 + o.bristle * 2.6) * o.qlen;
  const ball = sstep(0.3, 0.75, c);
  const cs = Math.cos(o.spin);
  const sn = Math.sin(o.spin);
  const ice = ICE;
  for (let i = 0; i < NQ; i++) {
    const u = QUN[i];
    const b = QBALL[i];
    // Прижаты — назад и к спине; дыбом — от центра; качка — запаздывание.
    let ux = u[0] + o.bristle * 0.5 - o.flat * 0.5 - o.jig * 0.18 * ((i % 2) * 2 - 1);
    let uz = u[2] * (1 - o.flat * 0.55) + o.bristle * 0.35;
    let uy = u[1] * (1 + o.bristle * 0.2);
    const bx = b[0] * cs - b[2] * sn;
    const bz = b[0] * sn + b[2] * cs;
    ux = lerp(ux, bx, ball);
    uy = lerp(uy, b[1], ball);
    uz = lerp(uz, bz, ball);
    if (ball < 0.5 && uz < 0.12) uz = 0.12 + Math.abs(uz) * 0.3;
    const nl = Math.hypot(ux, uy, uz) || 1;
    ux /= nl;
    uy /= nl;
    uz /= nl;
    // Смерть: иглы брызгами по сфере (во все стороны и вверх) и падают.
    const fly = scat * (3 + hash(i, 5, 71) * 5);
    const fall = scat * scat * 9;
    const px = ux * rx * 0.85 + ux * len * 0.55 + b[0] * fly;
    const py = uy * ry * 0.9 + uy * len * 0.55 + b[1] * fly;
    let pz = z + uz * rz * 0.85 + uz * len * 0.55 + (Math.abs(b[2]) + 0.4) * fly * 0.6 - fall;
    if (scat > 0) pz = Math.max(0.6, pz);
    if (pz < 0.5) continue;
    parts.push({
      x: px,
      y: py,
      z: pz,
      rx: Math.max(0.6, len * 0.6),
      ry: 0.75,
      rz: 0.75,
      yaw: Math.atan2(uy, ux),
      // Упавшие на снег лежат плашмя.
      pitch: scat > 0.6 ? 0 : Math.asin(Math.max(-1, Math.min(1, uz))),
      ramp: o.glow ? TEAL : ice,
      gloss: true,
      glow: o.glow,
    });
  }
  pitchParts(parts, o.pitch, 0, z);
  rollParts(parts, o.roll, z);
  const eyes =
    c < 0.6
      ? [
          { x: rx * 0.75, y: -1.5, z: z + 0.4, c: o.shut ? FUR[1] : EYE },
          { x: rx * 0.75, y: 1.5, z: z + 0.4, c: o.shut ? FUR[1] : EYE },
        ]
      : [];
  pitchParts(eyes, o.pitch, 0, z);
  rollParts(eyes, o.roll, z);
  const st = o.stars ?? -1;
  const sn2 = o.snow;
  return {
    parts,
    eyes,
    post:
      st >= 0 || sn2
        ? (p, scr) => {
            if (st >= 0) stars(p, scr, z + rz + 4, st);
            if (sn2) puff(p, scr, -rx * 0.6, 0, sn2[0], 9, 7, 31, SNOW, sn2[1], 1.8);
          }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Дорожки.
// ---------------------------------------------------------------------------

/** Рысь: диагональные пары, `u` — фаза шага 0…1. */
function trot(u: number, A = 1.5, H = 1): [number, number][] {
  const leg = (ph: number): [number, number] => {
    const a = (u + ph) * TAU;
    return [Math.sin(a) * A, Math.max(0, Math.cos(a)) * H];
  };
  return [leg(0), leg(0.5), leg(0.5), leg(0)];
}

function pose(anim: string, f: number): UrcO {
  switch (anim) {
    case 'idle': {
      const ph = (f / 12) * TAU;
      return {
        ...O0,
        sq: 1 + Math.sin(ph) * 0.03,
        bristle: 0.06 + Math.sin(ph) * 0.06,
        jig: Math.sin(ph - 1) * 0.3,
        sniff: f === 3 || f === 4 || f === 9 ? 0.4 : 0,
        snz: f === 3 || f === 9 ? 0.3 : 0,
        look: trk(f, [
          [0, 0],
          [5, 0],
          [7, -0.35],
          [10, -0.35],
          [11.5, 0],
        ]),
      };
    }
    case 'walk': {
      const u = f / 6;
      const bob = Math.cos(u * TAU * 2);
      return {
        ...O0,
        feet: trot(u),
        z: bob * 0.3,
        roll: Math.sin(u * TAU) * 0.06,
        jig: -Math.cos(u * TAU * 2 - 1),
        sniff: 0.2,
      };
    }
    case 'curl': {
      // 0,7 с: вдох носом вверх (иглы торчком) → клубок → откат и раскрутка.
      const k = tf(f) / 0.7;
      const c = trk(k, [
        [0, 0],
        [0.2, 0],
        [0.5, 1, smooth],
      ]);
      const spin = trk(k, [
        [0, 0],
        [0.5, 0],
        [0.68, -0.7, easeOut],
        [1, 2.6 * PI, easeIn],
      ]);
      return {
        ...O0,
        curl: c,
        spin,
        bristle: trk(k, [
          [0, 0],
          [0.15, 0.45, easeOut],
          [0.4, 0.25],
          [1, 0.2],
        ]),
        pitch: trk(k, [
          [0, 0],
          [0.15, 0.18, easeOut],
          [0.35, 0],
        ]),
        snz: trk(k, [
          [0, 0],
          [0.15, 0.6],
          [0.3, 0],
        ]),
        z: k > 0.55 ? -0.3 : 0,
        snow: k > 0.72 ? [(k - 0.72) / 0.3, PI] : undefined,
      };
    }
    case 'roll':
      return { ...O0, curl: 1, spin: (f / 8) * TAU, snow: [0.3 + (f % 4) * 0.15, PI] };
    case 'dizzy': {
      if (f < 6) {
        // Раскрылся: клубок лопается, тело подпрыгивает.
        const k = (f + 0.5) / 6;
        return {
          ...O0,
          curl: lerp(1, 0.2, easeOut(k)),
          z: Math.sin(k * PI) * 0.8,
          shut: true,
          stars: k * 0.3,
        };
      }
      const a = ((f - 6) / 12) * TAU;
      return {
        ...O0,
        curl: 0.2,
        roll: Math.sin(a) * 0.12,
        look: Math.sin(a + 0.8) * 0.35,
        snz: Math.cos(a) * 0.3,
        jig: Math.sin(a - 1),
        shut: (f - 6) % 6 > 2,
        stars: (f - 6) / 12,
      };
    }
    case 'bristle': {
      // 0,6 с: сжался, иглы прижаты → встают и светятся → дрожь на пике.
      const k = tf(f) / 0.6;
      const up = trk(k, [
        [0, 0],
        [0.25, 0],
        [0.8, 1, easeIn],
      ]);
      const crouch = trk(k, [
        [0, 0],
        [0.25, 1, easeOut],
        [0.8, 0],
      ]);
      return {
        ...O0,
        curl: 0.15,
        bristle: up,
        flat: crouch * 0.8,
        sq: 1 - crouch * 0.12 + up * 0.06,
        z: -crouch * 0.4,
        jig: k > 0.8 ? (f % 2 ? 0.6 : -0.6) : 0,
        snz: -crouch * 0.4,
        glow: k > 0.5,
      };
    }
    case 'fired': {
      // Выстрел: иглы ушли — отдача вверх, обрубки отрастают.
      const k = tf(f) / 0.6;
      return {
        ...O0,
        curl: 0.15 * (1 - k),
        qlen: lerp(0.25, 1, easeOut(sstep(0.1, 0.95, k))),
        bristle: 0.4 * (1 - k),
        z: trk(k, [
          [0, 0.7],
          [0.15, 0.9, easeOut],
          [0.4, 0],
        ]),
        sq: trk(k, [
          [0, 1.1],
          [0.15, 1.08],
          [0.3, 0.92],
          [0.5, 1],
        ]),
        roll: k > 0.3 && k < 0.8 ? Math.sin((k - 0.3) * TAU * 3) * 0.08 : 0,
        jig: k < 0.4 ? Math.sin(k * 30) : 0,
        glow: f < 2,
      };
    }
    case 'stun': {
      const a = (f / 8) * TAU;
      return {
        ...O0,
        curl: 0.35,
        roll: Math.sin(a) * 0.08,
        shut: true,
        flat: 0.4,
        jig: Math.sin(a * 2),
      };
    }
    default: {
      // Смерть: иглы брызгами в стороны, тело оседает набок.
      const t = tf(f);
      const k = clamp01(t / 0.7);
      return {
        ...O0,
        curl: 0.3,
        scatter: easeOut(clamp01(t / 0.45)),
        sq: lerp(1, 0.62, easeOut(k)),
        roll: trk(t, [
          [0, 0],
          [0.15, 0.2],
          [0.45, 1.1, easeIn],
        ]),
        shut: t > 0.1,
        flat: 0.6,
      };
    }
  }
}

const N: Record<string, number> = {
  idle: 12,
  walk: 6,
  curl: 17,
  roll: 8,
  dizzy: 18,
  bristle: 15,
  fired: 15,
  stun: 8,
  die: 19,
};
const build = (anim: string, f: number) => urchinBuild(pose(anim, f));

const DIE = 0.8;
/** Радиус клубка, клеток: поворот шара по пройденному пути. */
const BALL_R = 4.8 / 16;

paintMob('f12_urchin', (m, p) => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const mv = speedOf(m) > 0.3;
  const roll = mode === 'f12_roll';
  const want = (mv && mode === 'chase') || roll ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  const v = visOf(m, p, want, roll ? 60 : mode === 'chase' ? 7 : 20);
  const ex: Partial<MobFrame> = { shadow: 5.5 };
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, N.die - 1);
    if (t < 0.12) {
      const s = 1 - t / 0.12;
      ex.sx = 1 + 0.15 * s;
      ex.sy = 1 - 0.12 * s;
    }
    ex.alpha = 1 - sstep(0.55, DIE, t);
    ex.linger = DIE;
    ex.still = true;
  } else if (mode === 'f12_curl') {
    anim = 'curl';
    f = fi(t, N.curl - 1);
    const k = t / 0.7;
    const fc = m.face ?? 0;
    // Откатился назад перед рывком, сжался — и вперёд.
    const back = trk(k, [
      [0, 0],
      [0.5, 0],
      [0.7, -1.4, easeOut],
      [1, 0.4, easeIn],
    ]);
    ex.dx = Math.cos(fc) * back;
    ex.dy = Math.sin(fc) * back * 0.6;
    const sq = trk(k, [
      [0, 0],
      [0.55, 0],
      [0.75, 1],
      [1, 0.4],
    ]);
    ex.sx = 1 + 0.1 * sq;
    ex.sy = 1 - 0.1 * sq;
    ex.still = true;
  } else if (roll) {
    anim = 'roll';
    f = Math.floor(((v.dist / BALL_R / TAU) % 1) * N.roll) % N.roll;
    const b = now - v.bump;
    if (b >= 0 && b < 0.14) {
      // Отскок от стены: шар сплющило.
      const s = 1 - b / 0.14;
      ex.sx = 1 - 0.2 * s;
      ex.sy = 1 - 0.14 * s;
    }
    ex.still = true;
    ex.ghost = { every: 0.04, life: 0.16, tint: '#8ad8ff', alpha: 0.35 };
  } else if (mode === 'dizzy') {
    anim = 'dizzy';
    f = t < 0.25 ? fi(t, 5) : 6 + (fi(t - 0.25, 999) % 12);
  } else if (mode === 'f12_bristle') {
    anim = 'bristle';
    f = fi(t, N.bristle - 1);
    ex.still = true;
  } else if (mode === 'recover') {
    anim = 'fired';
    f = fi(t, N.fired - 1);
    if (t < 0.1) {
      const s = 1 - t / 0.1;
      ex.sx = 1 - 0.08 * s;
      ex.sy = 1 + 0.1 * s;
    }
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, 99) % N.stun;
  } else if (mv) {
    anim = 'walk';
    f = Math.floor(stepPh(v, 0.6) * N.walk) % N.walk;
  } else {
    f = idlePh(m, now, 8, N.idle);
  }
  const fr = frameOf(K, anim, f, dirOf(v.yaw), p, () => build(anim, f));
  if (mode !== 'dying') hurtFx(v, now, roll ? 0.8 : 1.6, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_urchin', () => warmAll(K, Object.entries(N) as [string, number][], build));
