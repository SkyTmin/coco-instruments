// Этаж 12 — Лемминг (анимации мобов 12). Мозг `f12_lemming` (`f12-brains.ts`):
// стайка зигзагом, `f12_wind` 0,32 с (присел) → `f12_hop` 0,16 с (прыжок,
// укус при касании) → `recover` 0,4 с. Удар героя — всегда `stun` 0,2 с.
//
// Кадры (24 к/с от `pose.t`, 8 сторон): покой 12 (8 к/с, фаза от id), бег —
// прыжками по пройденному пути (6 на шаг 0,8 клетки: вытянулся — приземлил
// передние — подобрал задние — сжался — толчок — полёт), замах 8 (присед,
// таз вертится, уши прижаты, резцы), прыжок 4 (вытянут в струну, пасть —
// укус на 3-м), приземление 10 (сжатие, юз, мотает головой), оглушение 6,
// смерть 19 (подброшен, переворот на спину, лапки дрыгают; `linger`).

import type { MobFrame } from '../dungeon-paint';
import { BONE, hx, ramp, SNOW, TAU, WHITE } from './f12-rig';
import { registerMobWarm } from '../dungeon-paint';
import {
  clamp01,
  dirOf,
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
  speedOf,
  sstep,
  stars,
  stepPh,
  tf,
  trk,
  visOf,
  warmAll,
  yawParts,
} from './f12-mobkit';
import type { Build, Part, V3 } from './f12-mobkit';

const BACK = ramp('#1a100a', '#33200f', '#54361a', '#7a5228', '#a2763a');
const SIDE = ramp('#5a3a14', '#8a5a20', '#b8862e', '#dcae4a', '#f4d27a');
const BELLY = ramp('#6a5a48', '#9a8a70', '#c8b898', '#e6dcc4', '#fff6e4');
const EYE = hx('#0a0604');
const MOUTH = hx('#2a0a08');

const K = kindOf('f12_lemming', { w: 26, h: 26, ox: 13, oy: 19 }, 600);

/** Поза лемминга: отклонения от стойки. */
interface LemO {
  /** Высота тела (+ выше). */
  z: number;
  /** Хребет: −1 сжат … +1 вытянут. */
  st: number;
  /** Наклон всей модели носом вверх, рад. */
  pitch: number;
  /** Крен всей модели (π — на спине). */
  roll: number;
  /** Голова: вперёд, вверх, поворот. */
  hx: number;
  hz: number;
  hyaw: number;
  /** Пасть 0…1 (резцы, открыта). */
  mouth: number;
  /** Уши: 0 торчком … 1 прижаты. */
  earL: number;
  earR: number;
  /** Хвостик вверх-вниз. */
  tail: number;
  /** Лапы: передняя левая, правая, задняя левая, правая — [вперёд, вверх]. */
  feet: [number, number][];
  /** Таз вбок (замах: вертит задом), рад. */
  wig?: number;
  /** Дыхание −1…1. */
  breath: number;
  /** Глаза закрыты. */
  shut?: boolean;
  /** Звёзды над головой (фаза 0…1), −1 — нет. */
  stars?: number;
  /** Снег из-под лап: доля разлёта 0…1 и где (−1 — задние, 1 — передние). */
  snow?: [number, number];
}

const FEET0: [number, number][] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
const O0: LemO = {
  z: 0,
  st: 0,
  pitch: 0,
  roll: 0,
  hx: 0,
  hz: 0,
  hyaw: 0,
  mouth: 0,
  earL: 0,
  earR: 0,
  tail: 0,
  feet: FEET0,
  breath: 0,
};

function lemmingBuild(o: LemO): Build {
  const parts: Part[] = [];
  const Lz = 3.2 + o.z;
  const L = 4.2 * (1 + 0.3 * o.st);
  const br = 1 + 0.045 * o.breath;
  parts.push({
    x: -0.4,
    y: 0,
    z: Lz,
    rx: L,
    ry: 3.3 * br,
    rz: 2.9 * (1 - 0.12 * o.st) * br,
    ramp: SIDE,
    fur: 0.12,
  });
  parts.push({
    x: -0.2,
    y: 0,
    z: Lz + 1.3 * (1 - 0.15 * o.st),
    rx: L * 0.86,
    ry: 2.7 * br,
    rz: 2.0,
    ramp: BACK,
    fur: 0.15,
  });
  parts.push({ x: 0, y: 0, z: Lz - 1.2, rx: L * 0.75, ry: 2.4, rz: 1.6, ramp: BELLY });
  // Хвостик.
  parts.push({ x: -L - 0.4, y: 0, z: Lz + 0.2 + o.tail, rx: 1, ry: 0.8, rz: 0.8, ramp: SIDE });
  // Лапы: бёдра у тела, стопы — от стойки. Локоть передних — назад, колено задних — вперёд.
  const fx = L * 0.5;
  const bx = -L * 0.55;
  const hz = Lz - 1;
  for (let k = 0; k < 4; k++) {
    const front = k < 2;
    const y = k % 2 ? 2 : -2;
    const [dx, dz] = o.feet[k];
    const hip: V3 = [front ? fx : bx, y, hz];
    const foot: V3 = [(front ? fx + 0.4 : bx + 0.5) + dx, y * 1.05, 0.8 + dz];
    const knee: V3 = [
      (hip[0] + foot[0]) / 2 + (front ? -0.5 : 0.7),
      y * 1.08,
      (hip[2] + foot[2]) / 2,
    ];
    limb(parts, hip, knee, foot, 1, 0.8, BACK, 20 + k, 1);
  }
  // Голова — своей группой (поворот вокруг шеи).
  const h0 = parts.length;
  // Таз вбок: всё, кроме головы, поворачивается у плеч.
  if (o.wig) yawParts(parts.slice(0, h0), o.wig, L * 0.45);
  const hx2 = L * 0.82 + o.hx;
  const hzz = Lz + 0.6 + o.hz;
  parts.push({ x: hx2, y: 0, z: hzz, rx: 2.5, ry: 2.4, rz: 2.2, ramp: BACK, fur: 0.1 });
  parts.push({ x: hx2 + 1.6, y: 0, z: hzz - 0.6, rx: 1.3, ry: 1.2, rz: 1, ramp: SIDE });
  for (const [s, e] of [
    [-1, o.earL],
    [1, o.earR],
  ] as const)
    parts.push({
      x: hx2 - 0.6 - e * 0.9,
      y: s * (1.6 + e * 0.2),
      z: hzz + 1.8 - e * 0.9,
      rx: 0.8 + e * 0.2,
      ry: 0.8,
      rz: 0.9 - e * 0.25,
      ramp: BACK,
    });
  // Точки, что едут с головой: глаза, резцы, низ пасти.
  const ec = o.shut ? BACK[1] : EYE;
  const pts = [
    { x: hx2 + 1, y: -1.3, z: hzz + 0.7 },
    { x: hx2 + 1, y: 1.3, z: hzz + 0.7 },
    { x: hx2 + 2.5, y: 0, z: hzz - 1.1 },
    { x: hx2 + 2.2, y: 0, z: hzz - 1.1 - o.mouth * 1.2 },
  ];
  yawParts(parts, o.hyaw, hx2 - 1.5, h0);
  yawParts(pts, o.hyaw, hx2 - 1.5);
  pitchParts(parts, o.pitch, -0.4, Lz);
  pitchParts(pts, o.pitch, -0.4, Lz);
  rollParts(parts, o.roll, Lz);
  rollParts(pts, o.roll, Lz);
  const eyes = [
    { ...pts[0], c: ec },
    { ...pts[1], c: ec },
  ];
  const tip = pts[2];
  const low = pts[3];
  const st = o.stars ?? -1;
  const sn = o.snow;
  return {
    parts,
    eyes,
    post: (p, scr) => {
      if (o.mouth > 0.05 && Math.abs(o.roll) < 1) {
        // Резцы: белые сверху, пасть темнеет, нижние — ниже на раскрытие.
        const [x, y] = scr(tip.x, tip.y, tip.z);
        const [, y2] = scr(low.x, low.y, low.z);
        p.set(x, y, WHITE);
        if (y2 - y >= 2) {
          for (let yy = y + 1; yy < y2; yy++) p.set(x, yy, MOUTH);
          p.set(x, y2, BONE[3]);
        } else p.set(x, y + 1, BONE[3]);
      }
      if (st >= 0) stars(p, scr, hzz + 4, st, hx2, 0, 3);
      if (sn)
        puff(
          p,
          scr,
          sn[1] > 0 ? fx + 1 : bx,
          0,
          sn[0],
          7,
          5,
          7 + (sn[1] > 0 ? 1 : 0),
          SNOW,
          sn[1] > 0 ? 0 : PI,
          1.6,
        );
    },
  };
}

// ---------------------------------------------------------------------------
// Дорожки.
// ---------------------------------------------------------------------------

/** Шаг-прыжок: [вперёд передних, вверх передних, вперёд задних, вверх задних, хребет, высота, наклон]. */
const RUN: number[][] = [
  [2.1, 0.8, -2.2, 0.4, 0.6, 0.6, 0],
  [1.2, 0, -1.5, 0.9, 0.25, 0.25, -0.13],
  [0, 0, 0.3, 1.1, -0.35, -0.25, -0.06],
  [-1.2, 0, 1.6, 0, -0.65, -0.5, 0.05],
  [0.2, 1, 0.4, 0, -0.2, 0.05, 0.16],
  [1.6, 1, -1.3, 0, 0.35, 0.5, 0.07],
];
const runFeet = (f: number): [number, number][] => {
  const a = RUN[f];
  const b = RUN[(f + 5) % 6];
  // Правая пара чуть отстаёт: полупрыжок, а не «утка».
  const r = (i: number) => lerp(a[i], b[i], 0.35);
  return [
    [a[0], a[1]],
    [r(0), r(1)],
    [a[2], a[3]],
    [r(2), r(3)],
  ];
};

function pose(anim: string, f: number): LemO {
  switch (anim) {
    case 'idle': {
      // 12 кадров по 8 к/с: вдох, нос шевелится, оглядывается, ухо дёргается.
      const ph = (f / 12) * TAU;
      const sniff = f === 2 || f === 4 || f === 9 ? 0.3 : 0;
      return {
        ...O0,
        breath: Math.sin(ph),
        z: Math.sin(ph) * 0.12,
        hx: sniff,
        hz: sniff * 0.3,
        hyaw: trk(f, [
          [0, 0],
          [5, 0],
          [6.5, 0.4],
          [9, 0.4],
          [11, 0],
        ]),
        earL: f === 6 ? 0.55 : f === 7 ? 0.2 : 0,
        tail: Math.sin(ph + 1) * 0.25,
      };
    }
    case 'run': {
      const a = RUN[f];
      const lag = RUN[(f + 5) % 6];
      return {
        ...O0,
        st: a[4],
        z: a[5],
        pitch: a[6],
        feet: runFeet(f),
        // Уши и хвост — на кадр позже тела.
        earL: 0.45 - lag[5] * 0.5,
        earR: 0.45 - lag[5] * 0.5,
        tail: -lag[5] * 0.8,
        hz: -lag[5] * 0.3,
      };
    }
    case 'wind': {
      // 0,32 с: присел носом к земле, задние подобраны, таз вертится, уши
      // прижаты; на последних двух — резцы и стоп перед прыжком.
      const k = tf(f) / 0.32;
      const dip = trk(k, [
        [0, 0],
        [0.45, 1, easeOut],
        [1, 1.1],
      ]);
      const wig = [0, 0, 0.05, 0.16, -0.16, 0.12, -0.04, 0][f];
      return {
        ...O0,
        z: -1.2 * dip,
        st: -0.5 * dip,
        pitch: -0.3 * dip,
        wig: wig * 2.2,
        hz: -0.5 * dip,
        hx: -0.3 * dip,
        earL: clamp01(k * 2),
        earR: clamp01(k * 2 - 0.1),
        tail: [0, 0.3, 0.6, 0.9, 0.3, 0.9, 0.5, 0.6][f],
        mouth: f >= 6 ? 0.5 : 0,
        feet: [
          [0.3 * dip, 0],
          [0.3 * dip, 0],
          [1.1 * dip, 0],
          [1.1 * dip, 0],
        ],
      };
    }
    case 'hop': {
      // 0,16 с: струной вперёд, пасть настежь — укус (3-й кадр сжимает).
      const H: number[][] = [
        [0.9, 0.8, 0.12, 2.4, 1.6, -2.4, 0.4, 1],
        [1, 1.2, 0.05, 2.6, 1.2, -2.6, 1, 1],
        [0.8, 1, -0.08, 2.2, 0.6, -2, 1.2, 0.25],
        [0.4, 0.5, -0.15, 1.4, 0.2, -1.2, 1, 0.15],
      ];
      const [st, z, pitch, ff, fz, hf, hzz, mouth] = H[f];
      return {
        ...O0,
        st,
        z,
        pitch,
        mouth,
        earL: 1,
        earR: 1,
        tail: -0.5,
        hx: 0.3,
        feet: [
          [ff, fz],
          [ff - 0.2, fz - 0.1],
          [hf, hzz],
          [hf + 0.2, hzz - 0.1],
        ],
        snow: f === 0 ? [0.35, -1] : f === 1 ? [0.65, -1] : undefined,
      };
    }
    case 'land': {
      // 0,4 с: удар о лёд, юз на упёртых лапах, мотает головой, встаёт.
      const k = tf(f) / 0.4;
      const sq = trk(k, [
        [0, 1],
        [0.12, 0.7],
        [0.35, 0.15],
        [0.7, 0],
      ]);
      const shake = [0, 0, 0, 0.38, -0.38, 0.26, -0.16, 0.06, 0, 0][f];
      const flop = [0, 0, 0.2, 0.5, 0.9, 0.3, 0.7, 0.2, 0, 0][f];
      return {
        ...O0,
        z: -0.85 * sq,
        st: -0.5 * sq + 0.1 * sstep(0.4, 0.7, k),
        pitch: -0.1 * sq,
        mouth: f < 2 ? 0.6 - f * 0.3 : 0,
        hyaw: shake,
        hz: -0.3 * sq,
        earL: 0.4 * sq + flop * 0.6,
        earR: 0.4 * sq + (0.9 - flop) * 0.4 * (f > 2 && f < 8 ? 1 : 0),
        tail: shake * 0.8,
        feet: [
          [lerp(0, 1.4, sq), 0],
          [lerp(0, 1.2, sq), 0],
          [lerp(0, -0.4, sq), 0],
          [lerp(0, -0.3, sq), 0],
        ],
        snow: f < 4 ? [(f + 1) / 5, 1] : undefined,
      };
    }
    case 'stun': {
      const a = (f / 6) * TAU;
      return {
        ...O0,
        z: -0.35,
        roll: Math.sin(a) * 0.1,
        hyaw: Math.sin(a + 1) * 0.3,
        hz: -0.4,
        earL: 0.9,
        earR: 0.7,
        shut: f % 3 !== 0,
        stars: f / 6,
      };
    }
    default: {
      // Смерть, 19 кадров: подброшен, в воздухе переворот на спину, шлепок,
      // лапки дрыгают и стихают.
      const t = tf(f);
      const flip = trk(t, [
        [0, 0],
        [0.28, PI, easeOut],
      ]);
      const kick =
        t > 0.3 ? Math.sin((t - 0.3) * TAU * 5) * 0.9 * (1 - clamp01((t - 0.3) / 0.32)) : 0;
      // Лапки торчат вверх, когда перевернулся.
      const up = (flip / PI) * 1.8;
      const land = t >= 0.28 && t < 0.36 ? 1 - (t - 0.28) / 0.08 : 0;
      return {
        ...O0,
        roll: flip,
        z: -0.2 - land * 0.5,
        st: -0.2 * land,
        mouth: t > 0.28 ? 0.4 : 0.8,
        earL: 0.8,
        earR: 0.8,
        shut: t > 0.3,
        feet: [
          [0.3, 0.6 - up - kick],
          [-0.2, 0.6 - up + kick],
          [-0.3, 0.4 - up + kick],
          [0.2, 0.4 - up - kick],
        ],
        tail: kick * 0.5,
      };
    }
  }
}

const N: Record<string, number> = { idle: 12, run: 6, wind: 8, hop: 4, land: 10, stun: 6, die: 19 };
const build = (anim: string, f: number) => lemmingBuild(pose(anim, f));

const DIE = 0.8;

paintMob('f12_lemming', (m, p) => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const mv = speedOf(m) > 0.4;
  const want = mv && mode !== 'f12_wind' ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  // Замах и прыжок — разворот почти сразу (мозг ставит курс в миг замаха).
  const v = visOf(m, p, want, mode === 'chase' ? 14 : 40);
  const ex: Partial<MobFrame> = { shadow: 4 };
  const fc = m.face ?? 0;
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, N.die - 1);
    // Подброшен по отдаче, шлепок о лёд, тает к концу.
    const up = t < 0.28 ? Math.sin((t / 0.28) * PI) * 5 : 0;
    const go = easeOut(t / 0.3) * 4;
    ex.dx = v.kx * go;
    ex.dy = v.ky * go * 0.6 - up;
    if (t >= 0.28 && t < 0.4) {
      const s = 1 - (t - 0.28) / 0.12;
      ex.sx = 1 + 0.16 * s;
      ex.sy = 1 - 0.16 * s;
    }
    ex.alpha = 1 - sstep(0.6, DIE, t);
    ex.linger = DIE;
    ex.still = true;
  } else if (mode === 'f12_wind') {
    anim = 'wind';
    f = fi(t, N.wind - 1);
    // Отпрянул назад перед прыжком — и замер.
    const back = easeOut(t / 0.2) * 1;
    ex.dx = -Math.cos(fc) * back;
    ex.dy = -Math.sin(fc) * back * 0.6;
    ex.sx = 1 + 0.06 * clamp01(t / 0.2);
    ex.sy = 1 - 0.06 * clamp01(t / 0.2);
    ex.still = true;
  } else if (mode === 'f12_hop') {
    anim = 'hop';
    f = fi(t, N.hop - 1);
    ex.dy = -Math.sin(clamp01(t / 0.16) * PI) * 4;
    ex.sx = 0.94;
    ex.sy = 1.08;
    ex.still = true;
    ex.ghost = { every: 0.03, life: 0.14, tint: '#f4d27a', alpha: 0.35 };
  } else if (mode === 'recover') {
    anim = 'land';
    f = fi(t, N.land - 1);
    if (t < 0.12) {
      const s = 1 - t / 0.12;
      ex.sx = 1 + 0.16 * s;
      ex.sy = 1 - 0.18 * s;
    }
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, 30) % N.stun;
  } else if (mv) {
    anim = 'run';
    f = Math.floor(stepPh(v, 0.8) * N.run) % N.run;
  } else {
    f = idlePh(m, now, 8, N.idle);
  }
  const fr = frameOf(K, anim, f, dirOf(v.yaw), p, () => build(anim, f));
  if (mode !== 'dying') hurtFx(v, now, 2, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_lemming', () => warmAll(K, Object.entries(N) as [string, number][], build));
