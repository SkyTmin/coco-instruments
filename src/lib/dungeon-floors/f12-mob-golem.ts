// Этаж 12 — Ледяной голем (анимации мобов 12). Мозг `f12_golem`
// (`f12-brains.ts`): `chase` — идёт к герою (`m.face` всегда на героя);
// рядом — каждый третий раз `f12_stomp`, иначе `f12_wind`. `f12_wind` 0,9 с:
// прицел до 0,45, круг r 1,25 в 1,4 клетки впереди, урон в 0,9 (+ зона
// `f12_frostburst`, тряска 0,25) → `recover` 0,9. `f12_stomp` 1,15 с: кольцо
// r 2,7 вокруг, урон в 1,15 (+ `f12_stompring`, тряска 0,4, тонкий лёд
// трескается) → `recover` 0,9. Что было перед отходом — по `data.n`
// (кратно 3 — топот). Ядро в спине: сзади урон ×1,5.
//
// Кадры (24 к/с от `pose.t`, 8 честных сторон; удержания и медленные хвосты
// — общими кадрами): покой 8 (4 к/с, фаза от id: дышит, ядро пульсирует,
// снег сыплется с плеч), шаг 8 по пройденному пути (и по повороту на месте),
// удар 22→19 (кулак назад-вниз, шаг левой, кулак над головой, корпус
// закручен, иней трещит на пике; бросок — 3 кадра со следом), отход после
// удара 22→16 (кадр 0 — урон: кулак во льду, осколки; вздрог, выдёргивает,
// встаёт), топот 28→18 (руки в стороны, правая нога и руки вверх, держит;
// обрушил), отход после топота 22→14 (кадр 0 — урон: присел, снег кольцом),
// вздрог 6, смерть 24→18 (трещины, ядро гаснет, осыпается грудой, `linger`).

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { bez, hash, hx, ICE, ramp, SNOW, TAU, TEAL, WHITE } from './f12-rig';
import {
  angD,
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
  paintMob,
  pitchParts,
  PI,
  puff,
  rollParts,
  speedOf,
  sstep,
  tf,
  trk,
  visOf,
  warmAll,
  yawParts,
} from './f12-mobkit';
import type { Build, Ease, Part, RGBA, Scr, V3 } from './f12-mobkit';

const G_SNOW = ramp('#3a4c72', '#5a7098', '#8098c0', '#aec2e0', '#dce8f6');
const G_DEEP = ramp('#26355a', '#40547c', '#5e78a2', '#86a0c6', '#b4c8e4');
const EYE = hx('#6cf0ff');
const CRACK = hx('#1a2a4a');
const CHIP: RGBA[] = [hx('#ecfaff'), hx('#a0d0ee'), hx('#5c9ccb')];
const SPARK: RGBA[] = [hx('#ffffff'), hx('#d8fcff'), hx('#7ae8f0')];

const K = kindOf('f12_golem', { w: 64, h: 70, ox: 32, oy: 52 }, 1000);

// ---------------------------------------------------------------------------
// Поза и модель.
// ---------------------------------------------------------------------------

/** Поза голема: отклонения от стойки. */
interface GolO {
  /** Наклон корпуса вперёд от пояса, рад. */
  lean: number;
  /** Закрутка плеч (+ — правое плечо назад), рад. */
  tw: number;
  /** Крен всей модели (+ — на правую ногу), рад. */
  roll: number;
  /** Сжатие корпуса 0…1 (−0,1 — вытянут). */
  sq: number;
  /** Высота пояса (+ выше). */
  z: number;
  /** Кулаки — точки модели (x вперёд, y вправо, z вверх). */
  fistR: V3;
  fistL: V3;
  /** Стопы: [вперёд, подъём]. */
  footR: [number, number];
  footL: [number, number];
  /** Голова: кивок (+ вверх) и поворот. */
  nod: number;
  hyaw: number;
  /** Вдох −1…1 (грудь), ядро 0…1 (ярче, крупнее). */
  breath: number;
  core: number;
  /** Глаза закрыты / погасли. */
  shut?: boolean;
  /** Осыпание (смерть) 0…1. */
  cr?: number;
  /** Трещины 0…1. */
  crack?: number;
  /** Осколки льда у кулака 0…1 (кадр контакта и после). */
  chips?: number;
  /** Снег комьями с кулака (выдернул) 0…1. */
  clods?: number;
  /** Снег кольцом из-под стоп (топот) 0…1. */
  ring?: number;
  /** Иней трещит у правого кулака (фаза кадра), −1 — нет. */
  frost?: number;
  /** Снежинки с плеч (фаза 0…1). */
  flakes?: number;
  /** Ядро разбилось: искры 0…1. */
  shatter?: number;
  /** Пыль из-под стопы при шаге: −1 левая, 1 правая, доля разлёта. */
  dust?: [number, number];
}

const REST_R: V3 = [5, 8.6, 3.6];
const REST_L: V3 = [5, -8.6, 3.6];
const O0: GolO = {
  lean: 0.2,
  tw: 0,
  roll: 0,
  sq: 0,
  z: 0,
  fistR: REST_R,
  fistL: REST_L,
  footR: [0, 0],
  footL: [0, 0],
  nod: 0,
  hyaw: 0,
  breath: 0,
  core: 0.5,
};

function golemBuild(o: GolO): Build {
  const parts: Part[] = [];
  const cr = o.cr ?? 0;
  const pz = 10.2 * (1 - 0.14 * o.sq) + o.z;
  // Ноги — тумбы: бедро-ком и стопа-глыба.
  const feet: V3[] = [];
  for (const e of [-1, 1]) {
    const [ff, fl] = e > 0 ? o.footR : o.footL;
    const foot: V3 = [ff, e * 4.3, 2.2 + fl];
    feet.push(foot);
    const thigh: V3 = [ff * 0.45 + 0.6, e * 4, (pz - 1.5 + foot[2]) / 2 + 0.6];
    parts.push({
      x: thigh[0],
      y: thigh[1],
      z: thigh[2],
      rx: 2.8,
      ry: 2.7,
      rz: 3,
      ramp: G_SNOW,
      fur: 0.06,
      id: 10 + e,
    });
    parts.push({
      x: foot[0] + 0.4,
      y: foot[1],
      z: foot[2],
      rx: 3.5,
      ry: 3,
      rz: 2.3,
      ramp: G_DEEP,
      id: 12 + e,
    });
  }
  // Пояс — нижний ком.
  parts.push({
    x: 0,
    y: 0,
    z: pz,
    rx: 6,
    ry: 6.8,
    rz: 4.5 * (1 - 0.1 * o.sq),
    ramp: G_SNOW,
    fur: 0.08,
    id: 20,
  });
  // Верх своей группой: грудь, ядро, ледяные плечи, сосульки, голова —
  // наклон у пояса и закрутка плеч.
  const u0 = parts.length;
  const br = 1 + 0.035 * o.breath;
  const cz = pz + 7.2 + 0.25 * o.breath;
  parts.push({
    x: 0,
    y: 0,
    z: cz,
    rx: 6 * br,
    ry: 7.6 * br,
    rz: 5.6,
    ramp: G_SNOW,
    fur: 0.08,
    id: 21,
  });
  const coreAt = parts.length;
  const ck = 0.85 + 0.3 * o.core;
  parts.push({
    x: -5.3,
    y: 0,
    z: cz + 0.6,
    rx: 1.6 * ck,
    ry: 2.4 * ck,
    rz: 2.8 * ck,
    ramp: TEAL,
    glow: true,
    gloss: true,
    id: 22,
  });
  for (const e of [-1, 1]) {
    parts.push({
      x: -0.5,
      y: e * 6.5,
      z: cz + 3.4,
      rx: 2.6,
      ry: 2.3,
      rz: 2.5,
      yaw: e * 0.6,
      ramp: ICE,
      gloss: true,
      id: 24 + e,
    });
    // Сосульки-шипы на плечах.
    parts.push({
      x: -1.6,
      y: e * 6.9,
      z: cz + 6.2,
      rx: 0.8,
      ry: 0.8,
      rz: 1.9,
      pitch: -0.25,
      roll: e * 0.3,
      ramp: ICE,
      gloss: true,
      id: 27 + e,
    });
  }
  const h0 = parts.length;
  const hx2 = 2.2;
  const hz2 = cz + 4.6;
  parts.push({ x: hx2, y: 0, z: hz2, rx: 3, ry: 3.2, rz: 2.8, ramp: G_SNOW, id: 30 });
  parts.push({
    x: hx2 - 0.4,
    y: 0,
    z: hz2 + 2.2,
    rx: 1.7,
    ry: 2.2,
    rz: 1,
    ramp: ICE,
    gloss: true,
    id: 31,
  });
  const eyePts = [
    { x: hx2 + 2.6, y: -1.2, z: hz2 + 0.4 },
    { x: hx2 + 2.6, y: 1.2, z: hz2 + 0.4 },
  ];
  pitchParts(parts, o.nod, hx2 - 1, hz2 - 1.5, h0);
  pitchParts(eyePts, o.nod, hx2 - 1, hz2 - 1.5);
  yawParts(parts, o.hyaw, hx2 - 1, h0);
  yawParts(eyePts, o.hyaw, hx2 - 1);
  // Плечи (точки) едут с верхом.
  const sh = [
    { x: 0.4, y: -7.6, z: cz + 2.2 },
    { x: 0.4, y: 7.6, z: cz + 2.2 },
  ];
  const chestPt = [{ x: 4.5, y: 0, z: cz }];
  pitchParts(parts, -o.lean, 0, pz, u0);
  yawParts(parts, -o.tw, 0, u0);
  for (const g of [eyePts, sh, chestPt]) {
    pitchParts(g, -o.lean, 0, pz);
    yawParts(g, -o.tw, 0);
  }
  // Руки: плечо → локоть (наружу, назад) → кулак-глыба.
  for (const [i, e] of [
    [0, -1],
    [1, 1],
  ] as const) {
    const s = sh[i];
    const f = e > 0 ? o.fistR : o.fistL;
    const el: V3 = [(s.x + f[0]) / 2 - 1.5, (s.y + f[1]) / 2 + e * 2.2, (s.z + f[2]) / 2 + 0.5];
    bez([s.x, s.y, s.z], el, f, 3).forEach((pt, j) => {
      if (j === 3) return;
      const r = 2.5 + j * 0.25;
      parts.push({ x: pt[0], y: pt[1], z: pt[2], rx: r, ry: r, rz: r, ramp: G_SNOW, id: 40 + e });
    });
    parts.push({
      x: f[0],
      y: f[1],
      z: f[2],
      rx: 3.4,
      ry: 3.3,
      rz: 3.2,
      ramp: ICE,
      gloss: true,
      id: 42 + e,
    });
  }
  const fR = o.fistR;
  const fL = o.fistL;
  const fM: V3 = [(fR[0] + fL[0]) / 2, (fR[1] + fL[1]) / 2, (fR[2] + fL[2]) / 2];
  // Крен всей модели — над стопами.
  rollParts(parts, o.roll, 2);
  rollParts(eyePts, o.roll, 2);
  // Осыпание: части оседают с задержкой и раскатываются; ядро гаснет.
  let shut = !!o.shut;
  if (cr > 0) {
    parts.forEach((p, i) => {
      const dl = 0.05 + hash(i, 5, 91) * 0.35 + (p.z / 40) * 0.25;
      const k = sstep(0, 1, (cr - dl) / (1 - dl - 0.05));
      if (k <= 0) return;
      const sc = 1 - 0.3 * k;
      p.rx *= sc;
      p.ry *= sc;
      p.rz *= sc;
      const r = Math.min(p.rx, p.ry, p.rz);
      const a = Math.atan2(p.y, p.x) + (hash(i, 7, 91) - 0.5) * 1.2;
      const go = k * (2 + hash(i, 9, 91) * 4);
      p.x += Math.cos(a) * go;
      p.y += Math.sin(a) * go;
      p.z = lerp(p.z, r * 0.8, k);
      p.pitch = (p.pitch ?? 0) + k * (hash(i, 11, 91) - 0.5) * 1.5;
    });
    if (cr > 0.45) parts.splice(coreAt, 1);
    shut = shut || cr > 0.3;
  }
  const eyes = shut ? [] : eyePts.map((e) => ({ ...e, c: EYE }));
  const chest = chestPt[0];
  return {
    parts,
    eyes,
    post: (p, scr) => {
      if (o.chips !== undefined) puff(p, scr, fM[0] + 1, fM[1], o.chips, 14, 10, 31, CHIP, 0, TAU);
      if (o.clods !== undefined) clodsOf(p, scr, fM, o.clods);
      if (o.ring !== undefined) {
        for (const [i, f] of feet.entries())
          puff(
            p,
            scr,
            f[0],
            f[1],
            o.ring,
            10,
            12,
            41 + i,
            SNOW,
            f[1] > 0 ? PI / 2 : -PI / 2,
            PI * 1.6,
          );
        puff(p, scr, 4, 0, o.ring, 8, 13, 43, SNOW, 0, 1.4);
      }
      if (o.frost !== undefined && o.frost >= 0) {
        frostOf(p, scr, fR, o.frost);
        frostOf(p, scr, fL, o.frost + 17);
      }
      if (o.flakes !== undefined) flakesOf(p, scr, o.flakes, cz, o.lean);
      if (o.crack) crackOf(p, scr, chest, o.crack);
      if (o.shatter !== undefined) puff(p, scr, -4, 0, o.shatter, 12, 10, 51, SPARK, PI, TAU);
      if (o.dust) {
        const f = feet[o.dust[0] > 0 ? 1 : 0];
        puff(p, scr, f[0] + 1, f[1], o.dust[1], 6, 6, 61, SNOW, 0, TAU);
      }
    },
  };
}

/** Комья снега с выдернутого кулака: падают вниз и отстают. */
function clodsOf(p: Px, scr: Scr, f: V3, k: number): void {
  for (let i = 0; i < 6; i++) {
    const q = clamp01(k * 1.3 - i * 0.06);
    const x = f[0] + (hash(i, 1, 33) - 0.5) * 4;
    const y = f[1] + (hash(i, 2, 33) - 0.5) * 4;
    const z = Math.max(0.5, f[2] - 1 - q * q * 14);
    const [sx, sy] = scr(x, y, z);
    const c = SNOW[3 + (i % 2)];
    p.set(sx, sy, c);
    if (i % 2 === 0) p.set(sx + 1, sy, SNOW[2]);
  }
}

/** Иней трещит у поднятого кулака: искры вокруг, свой рисунок на кадр. */
function frostOf(p: Px, scr: Scr, f: V3, ph: number): void {
  for (let i = 0; i < 4; i++) {
    const a = hash(i, ph, 71) * TAU;
    const r = 3.6 + hash(i, ph, 72) * 1.5;
    const [sx, sy] = scr(f[0] + Math.cos(a) * r, f[1], f[2] + Math.sin(a) * r);
    p.set(sx, sy, SPARK[i % 3]);
  }
}

/** Снежинки сыплются с плеч: три крупинки по своей дорожке. */
function flakesOf(p: Px, scr: Scr, ph: number, cz: number, lean: number): void {
  for (let i = 0; i < 3; i++) {
    const q = (ph + i / 3) % 1;
    const e = i === 1 ? 1 : -1;
    const [sx, sy] = scr(
      Math.sin(lean) * 9 - 1 + hash(i, 3, 81) * 2,
      e * (8.5 + q * 1.5),
      cz + 4 - q * 12,
    );
    p.set(sx, sy, [WHITE[0], WHITE[1], WHITE[2], Math.round(230 * (1 - q * 0.6))]);
  }
}

/** Трещины по груди: зигзаги от центра, растут с `k`. */
function crackOf(p: Px, scr: Scr, c: { x: number; y: number; z: number }, k: number): void {
  const [cx, cy] = scr(c.x, c.y, c.z);
  for (let j = 0; j < 4; j++) {
    const a = (j / 4) * TAU + 0.6;
    const n = Math.round(2 + k * 6);
    let x = cx;
    let y = cy;
    for (let s = 0; s < n; s++) {
      x += Math.round(Math.cos(a) + (hash(j, s, 21) - 0.5) * 1.2);
      y += Math.round(Math.sin(a) * 0.8 + (hash(j, s, 22) - 0.5) * 1.2);
      p.set(x, y, CRACK);
    }
  }
}

// ---------------------------------------------------------------------------
// Дорожки.
// ---------------------------------------------------------------------------

type Key3 = [number, V3, Ease?];
const trk3 = (k: number, keys: Key3[]): V3 => [
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[0], e]),
  ),
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[1], e]),
  ),
  trk(
    k,
    keys.map(([t, v, e]) => [t, v[2], e]),
  ),
];

/** Шаг (8 на цикл из двух шагов): фаза 0…1. Плант левой — 0, правой — 0,5. */
function walkPose(f: number): GolO {
  const ph = f / 8;
  const legOf = (q: number): [number, number] => {
    const u = ((q % 1) + 1) % 1;
    // Опора — стопа едет назад, перенос — вперёд по дуге.
    if (u < 0.5) return [lerp(3.2, -3.2, u / 0.5), 0];
    const s = (u - 0.5) / 0.5;
    return [lerp(-3.2, 3.2, easeOut(s)), Math.sin(s * PI) * 3.4];
  };
  const L = legOf(ph);
  const R = legOf(ph + 0.5);
  const sw = Math.sin(ph * TAU);
  const plant = Math.max(0, Math.cos(ph * 2 * TAU));
  return {
    ...O0,
    footL: L,
    footR: R,
    // Вес на опорную ногу, просел в миг постановки.
    roll: -sw * 0.07,
    sq: 0.18 * plant,
    z: -0.4 * plant,
    lean: 0.26,
    tw: sw * 0.08,
    fistR: [REST_R[0] - R[0], REST_R[1], REST_R[2] + 0.6 + Math.max(0, -R[0]) * 0.4],
    fistL: [REST_L[0] - L[0], REST_L[1], REST_L[2] + 0.6 + Math.max(0, -L[0]) * 0.4],
    nod: -0.08 * plant,
    dust:
      f === 0
        ? [-1, 0.35]
        : f === 4
          ? [1, 0.35]
          : f === 1
            ? [-1, 0.7]
            : f === 5
              ? [1, 0.7]
              : undefined,
  };
}

function pose(anim: string, f: number): GolO {
  switch (anim) {
    case 'idle': {
      // 8 кадров по 4 к/с: дышит, плечи ходят, ядро пульсирует.
      const ph = (f / 8) * TAU;
      return {
        ...O0,
        breath: Math.sin(ph),
        z: Math.sin(ph) * 0.2,
        lean: 0.2 - Math.sin(ph) * 0.03,
        fistR: [REST_R[0], REST_R[1], REST_R[2] + Math.sin(ph - 0.6) * 0.5],
        fistL: [REST_L[0], REST_L[1], REST_L[2] + Math.sin(ph - 0.9) * 0.5],
        hyaw: f >= 5 && f <= 6 ? 0.25 : 0,
        core: 0.5 + Math.sin(ph) * 0.5,
        shut: f === 3,
        flakes: f / 8,
      };
    }
    case 'walk':
      return walkPose(f);
    case 'punch': {
      // 0,9 с: «молот» двумя кулаками — кулаки назад-вниз, шаг левой, дугой
      // над головой (сцеплены), откинулся, держит (иней трещит), обрушил
      // вниз-вперёд за 3 кадра.
      const k = tf(f) / 0.9;
      const hold = k > 0.55 && k < 0.84;
      const arc = (e: number): Key3[] => [
        [0, e > 0 ? REST_R : REST_L],
        [0.2, [-3, e * 9.4, 6.5]],
        [0.38, [-5, e * 8, 20], easeOut],
        [0.55, [-1.5, e * 2.6, 32.5]],
        [0.84, [-2.5, e * 2.6, 33.5]],
        [0.92, [9, e * 2.4, 25], easeIn],
        [0.97, [14.5, e * 2.4, 12]],
        [1, [16.5, e * 2.4, 4.5]],
      ];
      return {
        ...O0,
        lean: trk(k, [
          [0, 0.2],
          [0.2, 0.32],
          [0.55, -0.3, easeOut],
          [0.84, -0.36],
          [0.92, 0.25, easeIn],
          [1, 0.75, easeIn],
        ]),
        fistR: trk3(k, arc(1)),
        fistL: trk3(k, arc(-1)),
        footL: [
          trk(k, [
            [0.1, 0],
            [0.4, 3],
          ]),
          k > 0.1 && k < 0.4 ? Math.sin(((k - 0.1) / 0.3) * PI) * 3 : 0,
        ],
        footR: [
          trk(k, [
            [0.1, 0],
            [0.4, -1.2],
          ]),
          0,
        ],
        roll: trk(k, [
          [0, 0],
          [0.25, 0.06],
          [0.5, 0],
        ]),
        sq: trk(k, [
          [0, 0],
          [0.2, 0.2],
          [0.55, -0.12, easeOut],
          [0.84, -0.14],
          [1, 0.3, easeIn],
        ]),
        z: trk(k, [
          [0, 0],
          [0.2, -0.5],
          [0.55, 0.4],
          [0.84, 0.5],
          [1, -0.6, easeIn],
        ]),
        nod: trk(k, [
          [0, 0],
          [0.55, 0.3],
          [0.84, 0.32],
          [1, -0.25],
        ]),
        core: hold ? 1 : 0.6,
        frost: hold ? f : undefined,
      };
    }
    case 'prec': {
      // Кадр 0 — урон: кулаки во льду, осколки; вздрог; согнулся; рывком
      // выдёргивает с комьями снега; встаёт в стойку с перелётом.
      const t = tf(f);
      const sq = trk(t, [
        [0, 0.5],
        [0.1, 0.05],
        [0.16, 0.14],
        [0.3, 0.08],
        [0.8, 0],
      ]);
      const yank = sstep(0.3, 0.46, t);
      const back = sstep(0.42, 0.8, t);
      const out = (e: number): Key3[] => [
        [0, [16.5, e * 2.4, 3.4]],
        [0.3, [16, e * 2.4, 3.4]],
        [0.46, [11, e * 5, 11], easeOut],
        [0.66, [e > 0 ? REST_R[0] + 1.5 : REST_L[0] + 1.5, e * 8.8, 6]],
        [0.8, e > 0 ? REST_R : REST_L],
      ];
      return {
        ...O0,
        lean: lerp(lerp(0.75, 0.62, sstep(0, 0.16, t)), 0.2, back) + 0.08 * Math.sin(yank * PI),
        sq,
        z: -0.7 * sq,
        roll: f > 0 && f < 4 ? [0, 0.04, -0.03, 0.015][f] : 0,
        fistR: trk3(t, out(1)),
        fistL: trk3(t, out(-1)),
        footL: [
          lerp(3, 0, sstep(0.5, 0.75, t)),
          t > 0.5 && t < 0.75 ? Math.sin(((t - 0.5) / 0.25) * PI) * 2.4 : 0,
        ],
        footR: [lerp(-1.2, 0, back), 0],
        nod: trk(t, [
          [0, -0.25],
          [0.2, -0.1],
          [0.34, 0.15],
          [0.6, 0],
        ]),
        chips: f < 7 ? (f + 0.6) / 7 : undefined,
        clods: t > 0.32 && t < 0.76 ? (t - 0.32) / 0.44 : undefined,
      };
    }
    case 'stomp': {
      // 1,15 с: присел, руки в стороны; правая нога и обе руки вверх,
      // корпус назад; держит; обрушил ногу и руки.
      const k = tf(f) / 1.15;
      const up = trk(k, [
        [0, 0],
        [0.15, 0],
        [0.6, 1, easeOut],
        [0.84, 1.08],
        [1, 0.15, easeIn],
      ]);
      const crouch = trk(k, [
        [0, 0],
        [0.15, 1],
        [0.4, 0],
      ]);
      const hold = k > 0.6 && k < 0.85;
      return {
        ...O0,
        lean: 0.2 - 0.35 * up + 0.15 * crouch,
        sq: 0.25 * crouch - 0.08 * up,
        z: -0.8 * crouch,
        roll: -0.15 * up,
        footR: [3.5 * up, 8 * up],
        fistR: trk3(k, [
          [0, REST_R],
          [0.15, [3, 12, 9]],
          [0.6, [0, 6.5, 30], easeOut],
          [0.84, [-1, 6, 31.5]],
          [1, [4, 10.5, 12], easeIn],
        ]),
        fistL: trk3(k, [
          [0, REST_L],
          [0.15, [3, -12, 9]],
          [0.6, [0, -6.5, 30], easeOut],
          [0.84, [-1, -6, 31.5]],
          [1, [4, -10.5, 12], easeIn],
        ]),
        nod: 0.2 * up,
        core: hold ? 1 : 0.6,
        frost: hold ? f + 40 : undefined,
      };
    }
    case 'srec': {
      // Кадр 0 — урон: обе стопы врезались, присел, руки вниз-врозь, снег
      // кольцом; отскок вверх, оседает, встаёт.
      const t = tf(f);
      const sq = trk(t, [
        [0, 0.6],
        [0.1, -0.1],
        [0.2, 0.15],
        [0.32, 0],
      ]);
      const back = sstep(0.3, 0.85, t);
      return {
        ...O0,
        sq,
        z: -1 * Math.max(0, sq),
        lean: lerp(0.45, 0.2, back),
        footR: [lerp(3.5, 0, back), 0],
        fistR: trk3(t, [
          [0, [4, 11, 3.6]],
          [0.1, [4, 11, 6]],
          [0.3, [4.5, 10.5, 4]],
          [0.85, REST_R],
        ]),
        fistL: trk3(t, [
          [0, [4, -11, 3.6]],
          [0.1, [4, -11, 6]],
          [0.3, [4.5, -10.5, 4]],
          [0.85, REST_L],
        ]),
        nod: t < 0.15 ? -0.2 : 0,
        ring: f < 8 ? (f + 0.6) / 8 : undefined,
      };
    }
    case 'stun': {
      // 0,25 с: качнуло назад, голова мотнулась, руки вразлёт.
      const a = [0, 1, 0.8, 0.45, 0.2, 0.05][f];
      return {
        ...O0,
        lean: 0.2 - 0.35 * a,
        roll: [0, 0.06, -0.05, 0.03, -0.01, 0][f],
        hyaw: [0, 0.3, -0.2, 0.1, 0, 0][f],
        fistR: [REST_R[0] - 2 * a, REST_R[1] + 2 * a, REST_R[2] + 4 * a],
        fistL: [REST_L[0] - 2 * a, REST_L[1] - 2 * a, REST_L[2] + 3 * a],
        shut: f === 1 || f === 2,
      };
    }
    default: {
      // Смерть 1 с: трещины, ядро вспыхнуло и погасло, голова поникла,
      // колени подломились, осыпался грудой.
      const t = tf(f);
      const sag = sstep(0.1, 0.38, t);
      return {
        ...O0,
        lean: 0.2 + 0.45 * sag,
        sq: 0.3 * sag,
        z: -2 * sag,
        nod: -0.4 * sag,
        roll: 0.1 * sag,
        fistR: [lerp(REST_R[0], 7, sag), REST_R[1] + 1, lerp(REST_R[2], 2.5, sag)],
        fistL: [lerp(REST_L[0], 6, sag), REST_L[1] - 1, lerp(REST_L[2], 2.5, sag)],
        core: t < 0.15 ? 1 : 0.2,
        shut: t > 0.2,
        crack: sstep(0, 0.25, t),
        cr: sstep(0.26, 0.74, t),
        shatter: t > 0.3 && t < 0.65 ? (t - 0.3) / 0.35 : undefined,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Кадры: время → поза (удержания и медленные хвосты — общими кадрами).
// ---------------------------------------------------------------------------

const span = (a: number, b: number, step = 1) => {
  const out: number[] = [];
  for (let i = a; i <= b; i += step) out.push(i);
  return out;
};
/** Кадры позы на дорожке техники: номер кадра 24 к/с, с которого поза. */
const KEYS: Record<string, number[]> = {
  idle: span(0, 7),
  walk: span(0, 7),
  punch: [...span(0, 12), 13, 15, 17, 19, 20, 21],
  prec: [...span(0, 9), ...span(10, 21, 2)],
  stomp: [...span(0, 14, 2), ...span(15, 19), 21, 23, 24, 25, 26, 27],
  srec: [...span(0, 5), ...span(6, 21, 2)],
  stun: span(0, 5),
  die: [...span(0, 11), ...span(12, 23, 2)],
};
const LAST: Record<string, number> = { punch: 21, prec: 21, stomp: 27, srec: 21, stun: 5, die: 23 };
/** Номер позы для кадра 24 к/с. */
function keyOf(anim: string, f: number): number {
  const ks = KEYS[anim];
  let i = 0;
  while (i + 1 < ks.length && ks[i + 1] <= f) i++;
  return i;
}
const build = (anim: string, i: number) => golemBuild(pose(anim, KEYS[anim][i]));
const N = Object.fromEntries(Object.entries(KEYS).map(([a, ks]) => [a, ks.length]));

const DIE = 1;
/** Поворот на месте переступанием: свой путь шага по углу. */
const TURN = new WeakMap<Mob, { yaw: number; acc: number; until: number }>();

paintMob('f12_golem', (m: Mob, p: MobPose): MobFrame => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const mv = speedOf(m) > 0.3;
  const atk = mode === 'f12_wind' || mode === 'f12_stomp' || mode === 'recover';
  const want = mv && !atk ? Math.atan2(m.vy, m.vx) : (m.face ?? 0);
  const v = visOf(m, p, want, atk ? 9 : 5);
  let tr = TURN.get(m);
  if (!tr) TURN.set(m, (tr = { yaw: v.yaw, acc: 0, until: -9 }));
  const dy = Math.abs(angD(v.yaw, tr.yaw));
  tr.yaw = v.yaw;
  tr.acc += dy * 1.4;
  // Переступает, пока поворачивается, и ещё четверть секунды после.
  if (dy > 0.004) tr.until = now + 0.25;
  const turning = now < tr.until;
  const fc = v.yaw;
  const cf = Math.cos(fc);
  const sf = Math.sin(fc) * 0.77;
  const ex: Partial<MobFrame> = { shadow: 11 };
  let anim = 'idle';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, LAST.die);
    ex.alpha = 1 - sstep(0.78, DIE, t);
    ex.linger = DIE;
    ex.still = true;
    ex.shadow = 11 * (1 - 0.3 * sstep(0.3, 0.9, t));
  } else if (mode === 'f12_wind') {
    anim = 'punch';
    f = fi(t, LAST.punch);
    ex.still = true;
    // Шаг левой вперёд — корпус подался; бросок — рывок вперёд.
    const go = 1.2 * sstep(0.1, 0.4, t / 0.9) + 1.2 * sstep(0.84, 1, t / 0.9);
    ex.dx = cf * go;
    ex.dy = sf * go;
    if (f >= 19) ex.ghost = { every: 0.03, life: 0.14, tint: '#a0d0ee', alpha: 0.35 };
  } else if (mode === 'f12_stomp') {
    anim = 'stomp';
    f = fi(t, LAST.stomp);
    ex.still = true;
    if (f >= 24) ex.ghost = { every: 0.03, life: 0.12, tint: '#a0d0ee', alpha: 0.3 };
  } else if (mode === 'recover') {
    const stomp = (m.data?.n ?? 0) % 3 === 0;
    anim = stomp ? 'srec' : 'prec';
    f = fi(t, LAST[anim]);
    ex.still = f < 10;
    if (!stomp) {
      const go = 2.4 * (1 - sstep(0.55, 0.88, t));
      ex.dx = cf * go;
      ex.dy = sf * go;
    }
    if (f === 0) {
      ex.sx = stomp ? 1.1 : 1.06;
      ex.sy = stomp ? 0.88 : 0.93;
    } else if (f === 1) {
      ex.sx = stomp ? 1.04 : 1.02;
      ex.sy = stomp ? 0.95 : 0.98;
    }
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, LAST.stun);
    const a = [0, 1, 0.8, 0.45, 0.2, 0.05][f];
    ex.dx = -cf * a * 1.5;
    ex.dy = -sf * a * 1.5;
  } else if (mv || turning) {
    anim = 'walk';
    const ph = ((((v.dist + tr.acc) / 1.6) % 1) + 1) % 1;
    f = Math.floor(ph * 8) % 8;
  } else {
    f = idlePh(m, now, 4, 8);
  }
  const i = keyOf(anim, f);
  const fr = frameOf(K, anim, i, dirOf(fc), p, () => build(anim, i));
  if (mode !== 'dying') hurtFx(v, now, 1, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_golem', () => warmAll(K, Object.entries(N) as [string, number][], build));
