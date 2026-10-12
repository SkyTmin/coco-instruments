// Этаж 12 — Снежный дух (анимации мобов 12). Мозг `f12_spirit` (`f12-brains.ts`):
// `chase` — держится в 2,8 клетки, плывёт волной, смотрит на героя; горит
// факел в 7 клетках — `f12_douse` (летит к огню и дует `data.blow` до 0,85 с —
// факел гаснет); ближе 2,8 — `f12_wind` 0,6 с (конус 2,8 / дуга 1, прицел до
// 0,36 с), в 0,6 — урон стужей и зона `f12_breath` → `recover` 0,6 с; у
// горящей жаровни тает — `f12_flee` 1,2 с прочь.
//
// Кадры (8 честных сторон; тело — стекло, сердцевина светится): парение 16 и
// полёт вперёд 16 (16 к/с, фаза от id: хвост — бегущая волна, руки-клочья
// отстают от тела), вдох-замах 15 (отпрянул, раздулся, руки вверх, иней
// стягивается ко рту, глаза вспыхнули, дрожь на пике), выдох 15 (кадр 0 —
// урон: бросок вперёд, рот настежь, струя; сдулся, вернулся), задувание 5+4,
// бегство 12 (вытянут, хвост хлещет, капли тают), вздрог 5, смерть 16
// (вспышка, рассыпается инеем, `linger`), появление 9 (иней собирается в духа).

import type { Px } from '../dungeon-art';
import { registerMobWarm } from '../dungeon-paint';
import type { MobFrame } from '../dungeon-paint';
import { hash, hx, ramp, TAU, TEAL } from './f12-rig';
import {
  clamp,
  clamp01,
  dirOf,
  easeIn,
  easeOut,
  fi,
  frameOf,
  hurtFx,
  kindOf,
  lerp,
  paintMob,
  puff,
  speedOf,
  sstep,
  tf,
  trk,
  visOf,
  warmAll,
} from './f12-mobkit';
import type { Build, Part, RGBA, Scr, V3 } from './f12-mobkit';

const SPIRIT_R = ramp('#2a6a8a', '#4a9ab8', '#7accdc', '#b6eef4', '#ecffff');
const HOLLOW = hx('#0a2030');
const GLARE = hx('#ecffff');
const MOTE: RGBA[] = [hx('#ecffff', 230), hx('#b6eef4', 200), hx('#7ae8f0', 190)];
const DRIP = hx('#7accdc', 220);

const K = kindOf('f12_spirit', { w: 44, h: 48, ox: 22, oy: 36 }, 1050);

/** Тело духа над землёй кадра. */
const Z = 9;

interface SpiO {
  /** Колыхание тела вверх-вниз; наклон вперёд (+) / назад (−). */
  bob: number;
  lean: number;
  /** Раздулся (вдох) / сдулся (−), сжатие по высоте. */
  swell: number;
  sq: number;
  /** Голова: кивок вверх (+). */
  hp: number;
  /** Руки: вверх 0…1, вперёд 0…1, назад (шлейфом) 0…1, волна (фаза, рад). */
  raise: number;
  reach: number;
  back: number;
  wave: number;
  /** Хвост: бегущая волна (фаза), размах, вытянут назад 0…1+. */
  tph: number;
  amp: number;
  stretch: number;
  /** Сердцевина: накал 0…2. */
  core: number;
  /** Глаза: −1 зажмурены … 0 … 1 вспыхнули; рот 0…1. */
  eye: number;
  mouth: number;
  /** Иней вокруг: фаза 0…1 (−1 — нет), стягивается ко рту 0…1. */
  motes: number;
  suck: number;
  /** Струя изо рта: фаза 0…1 (0 — нет), длина. */
  stream: number;
  slen: number;
  /** Тает (прозрачнее) 0…1, разлетается 0…1, всплеск инея 0…1, капли (фаза). */
  fade: number;
  scatter: number;
  burst: number;
  drip: number;
}

const O0: SpiO = {
  bob: 0,
  lean: 0,
  swell: 0,
  sq: 1,
  hp: 0,
  raise: 0.15,
  reach: 0,
  back: 0,
  wave: 0,
  tph: 0,
  amp: 1,
  stretch: 0.2,
  core: 0.5,
  eye: 0,
  mouth: 0,
  motes: -1,
  suck: 0,
  stream: 0,
  slen: 10,
  fade: 0,
  scatter: 0,
  burst: 0,
  drip: -1,
};

const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mix3 = (a: V3, b: V3, k: number): V3 => [
  lerp(a[0], b[0], k),
  lerp(a[1], b[1], k),
  lerp(a[2], b[2], k),
];

function spiritBuild(o: SpiO): Build {
  const parts: Part[] = [];
  const s = 1 + o.swell * 0.22;
  const fa = 1 - o.fade;
  const sc = o.scatter;
  const glass = (
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    a: number,
    ex: Partial<Part> = {},
  ) => {
    if (a * fa < 0.04) return;
    parts.push({ x, y, z, rx, ry, rz, ramp: SPIRIT_R, alpha: a * fa, ...ex });
  };
  const bx = o.lean * 1.1;
  const bz = Z + o.bob + sc * 1.5;
  // Тело и сердцевина.
  glass(bx, 0, bz, 3.1 * s, 3.3 * s, 3.6 * s * o.sq, 0.66, { pitch: -o.lean * 0.5 });
  const cr = 1.2 * (1 - o.fade) + o.core * 0.35;
  if (cr > 0.25)
    parts.push({
      x: bx + 0.6,
      y: 0,
      z: bz + 0.8,
      rx: cr,
      ry: cr,
      rz: cr * 1.1,
      ramp: TEAL,
      glow: true,
    });
  // Голова.
  const hxp = bx + 0.4 + o.lean * 1.4;
  const hz = bz + 4.3 * s * o.sq + sc * 3;
  glass(hxp, 0, hz, 2.8 * (1 + o.swell * 0.08), 2.9 * (1 + o.swell * 0.08), 2.7, 0.72, {
    pitch: o.hp,
  });
  const ch = Math.cos(o.hp);
  const sh = Math.sin(o.hp);
  const face = (x: number, y: number, z: number): V3 => [
    hxp + x * ch - z * sh,
    y,
    hz + x * sh + z * ch,
  ];
  // Руки-клочья: три клуба, каждый отстаёт от предыдущего.
  for (const e of [-1, 1]) {
    const sx = bx + 0.6;
    const sy = e * 2.9 * s * (1 + sc);
    const sz = bz + 1.2;
    const hang: V3 = [0.4, e * 0.5, -0.75];
    const up: V3 = [0.05, e * 0.6, 0.8];
    const fwd: V3 = [1, e * 0.25, 0.1];
    const bk: V3 = [-1, e * 0.45, -0.1];
    const d = nrm(mix3(mix3(mix3(hang, up, o.raise), fwd, o.reach), bk, o.back));
    for (let k = 1; k <= 3; k++) {
      const w = Math.sin(o.wave - k * 0.9) * 0.45 * k;
      const r = (2.0 - k * 0.42) * (1 + o.swell * 0.1);
      glass(
        sx + d[0] * 1.6 * k * (1 + sc),
        sy + d[1] * 1.6 * k * (1 + sc),
        sz + d[2] * 1.6 * k + w,
        r * 1.15,
        r,
        r * 0.9,
        0.52 - k * 0.06,
      );
    }
  }
  // Хвост: бегущая волна, к концу тоньше и прозрачнее.
  const tb: V3 = [bx - 0.8, 0, bz - 2.8 * s];
  for (let i = 1; i <= 6; i++) {
    const k = i / 6;
    const x = tb[0] - (1.15 + o.stretch * 0.95) * i - sc * 2 * i;
    const y = Math.sin(o.tph - i * 0.9) * (0.35 + 0.33 * i) * o.amp;
    const z = lerp(tb[2], 1.8, k ** 1.15) + Math.cos(o.tph - i * 0.9) * 0.25 * i * o.amp * 0.4;
    const r = 2.4 - i * 0.28;
    glass(x, y, z, r, r, r * 0.9, 0.5 - k * 0.2);
  }

  const eyeA = face(2.35, -1.05, 0.35);
  const eyeB = face(2.35, 1.05, 0.35);
  const mouth = face(2.45, 0, -1.05);
  const far = o.stream > 0 || o.motes >= 0 || o.burst > 0 || o.drip >= 0;
  return {
    parts,
    extent: far
      ? [
          [-12, -12, 0],
          [12 + (o.stream > 0 ? o.slen : 0), 12, 0],
          [0, 0, Z + 16],
        ]
      : undefined,
    post: (p, scr) => {
      // Глаза и рот — по лицу (стекло их не прячет, прячем сами: лицо от нас — не видно).
      const [, , hd] = scr(hxp, 0, hz);
      if (fa > 0.3) {
        for (const q of [eyeA, eyeB]) {
          const [x, y, d] = scr(q[0], q[1], q[2]);
          if (d < hd - 0.2) continue;
          if (o.eye < 0) {
            p.set(x, y, HOLLOW);
          } else {
            const c = o.eye > 0 ? GLARE : HOLLOW;
            p.set(x, y, c);
            p.set(x, y - 1, c);
          }
        }
        if (o.mouth > 0.12) {
          const [x, y, d] = scr(mouth[0], mouth[1], mouth[2]);
          if (d >= hd - 0.2) {
            const w = o.mouth > 0.6 ? 1 : 0;
            const h = o.mouth > 0.35 ? 1 : 0;
            for (let yy = 0; yy <= h; yy++)
              for (let xx = -w; xx <= w; xx++) p.set(x + xx, y + yy, HOLLOW);
          }
        }
      }
      if (o.motes >= 0) motes(p, scr, o, hxp, hz);
      if (o.stream > 0) stream(p, scr, o, mouth);
      if (o.burst > 0) {
        puff(p, scr, bx, 0, o.burst, 26, 12, 23, MOTE);
        if (o.burst < 0.35) {
          // Кольцо инея в миг, когда дух лопнул.
          const R = 3 + (o.burst / 0.35) * 9;
          const c = GLARE;
          const al = Math.round(255 * (1 - o.burst / 0.35));
          for (let i = 0; i < 20; i++) {
            const a = (i / 20) * TAU;
            const [x, y] = scr(bx + Math.cos(a) * R, Math.sin(a) * R, bz - 1);
            p.set(x, y, [c[0], c[1], c[2], al]);
          }
        }
      }
      if (o.drip >= 0)
        for (let i = 0; i < 3; i++) {
          const k = (o.drip + i / 3) % 1;
          const [x, y] = scr(bx - 1 - i * 1.5, (i - 1) * 1.6, bz - 3 - k * 6);
          p.set(x, y, [DRIP[0], DRIP[1], DRIP[2], Math.round(DRIP[3] * (1 - k))]);
        }
    },
  };
}

/** Иней вокруг духа: кружит и поднимается; `suck` — стягивается ко рту. */
function motes(p: Px, scr: Scr, o: SpiO, hxp: number, hz: number): void {
  const n = o.suck > 0 ? 10 : 5;
  for (let i = 0; i < n; i++) {
    const a = hash(i, 3, 41) * TAU + o.motes * TAU * 0.5;
    const r = (4.5 + hash(i, 3, 42) * 4) * (1 - easeIn(o.suck));
    const rise = ((o.motes + hash(i, 3, 43)) % 1) * 6 - 3;
    const z = lerp(Z + rise, hz - 0.8, easeIn(o.suck));
    const x = lerp(Math.cos(a) * r, hxp + 2.6, easeIn(o.suck) * 0.6);
    const [sx, sy] = scr(x, Math.sin(a) * r, z);
    p.set(sx, sy, MOTE[i % 3]);
  }
}

/** Струя стужи изо рта вперёд: крупинки веером по конусу (дуга 1) и тают. */
function stream(p: Px, scr: Scr, o: SpiO, m: V3): void {
  const n = 22;
  for (let i = 0; i < n; i++) {
    const k = (i / n + o.stream * 0.55) % 1;
    const d = 0.8 + k * o.slen;
    const a = (hash(i, 9, 61) - 0.5) * 1.0;
    const [x, y] = scr(
      m[0] + Math.cos(a) * d,
      m[1] + Math.sin(a) * d,
      m[2] - d * 0.08 + (hash(i, 9, 62) - 0.5) * 1.2,
    );
    const c = MOTE[i % 3];
    const al = Math.round(c[3] * (1 - k * 0.75));
    p.set(x, y, [c[0], c[1], c[2], al]);
    if (k < 0.4) p.set(x + 1, y, [c[0], c[1], c[2], Math.round(al * 0.7)]);
  }
  if (o.stream < 0.3) {
    // Клуб у рта в миг выдоха.
    const [x, y] = scr(m[0] + 1.2, m[1], m[2]);
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, -1],
      [1, -1],
      [2, 0],
      [0, 1],
    ])
      p.set(x + dx, y + dy, GLARE);
  }
}

// ---------------------------------------------------------------------------
// Позы.
// ---------------------------------------------------------------------------

function float(f: number): SpiO {
  const ph = (f / 16) * TAU;
  return {
    ...O0,
    bob: Math.sin(ph) * 0.8,
    tph: ph,
    wave: ph - 0.6,
    raise: 0.15 + 0.12 * Math.sin(ph - 0.8),
    core: 0.5 + 0.2 * Math.sin(ph * 2),
    motes: f / 16,
  };
}

function drift(f: number): SpiO {
  const ph = (f / 16) * TAU;
  return {
    ...O0,
    bob: Math.sin(ph) * 0.4,
    lean: 0.35,
    tph: ph * 2,
    amp: 0.8,
    stretch: 1,
    wave: ph * 2 - 0.6,
    raise: 0,
    back: 0.75,
    core: 0.6,
    motes: f / 16,
  };
}

/** Вдох-замах 0,6 с: отпрянул и поднялся, раздулся, руки вверх, иней ко рту, пик — дрожь. */
function wind(f: number): SpiO {
  const t = tf(f);
  return {
    ...O0,
    bob: trk(t, [
      [0, 0],
      [0.36, 1.8, easeOut],
      [0.5, 2],
      [0.6, 1.6],
    ]),
    lean: trk(t, [
      [0, 0],
      [0.12, -0.25],
      [0.36, -0.4],
      [0.5, -0.4],
      [0.6, -0.55, easeIn],
    ]),
    swell: trk(t, [
      [0.06, 0],
      [0.36, 1, easeOut],
      [0.5, 1.05],
      [0.6, 1.15],
    ]),
    hp: trk(t, [
      [0, 0],
      [0.36, 0.4],
      [0.6, 0.5],
    ]),
    raise: trk(t, [
      [0, 0.15],
      [0.36, 1.2, easeOut],
      [0.6, 1.3],
    ]),
    wave: t * 9,
    tph: t * 14,
    amp: trk(t, [
      [0, 1],
      [0.36, 1.5],
    ]),
    stretch: trk(t, [
      [0, 0.2],
      [0.36, -0.35],
    ]),
    core: trk(t, [
      [0, 0.5],
      [0.36, 1.25],
      [0.6, 1.6],
    ]),
    eye: t > 0.36 ? 1 : 0,
    mouth: trk(t, [
      [0.5, 0],
      [0.6, 0.4],
    ]),
    motes: t / 0.6,
    suck: sstep(0.06, 0.5, t),
  };
}

/** Выдох 0,6 с: кадр 0 — урон (рывок вперёд, рот настежь, струя), сдулся, вернулся. */
function breath(f: number): SpiO {
  const t = tf(f);
  return {
    ...O0,
    bob: trk(t, [
      [0, 1.2],
      [0.3, 0],
    ]),
    lean: trk(t, [
      [0, 0.55],
      [0.12, 0.6],
      [0.3, -0.1],
      [0.6, 0],
    ]),
    swell: trk(t, [
      [0, 0.75],
      [0.12, 0.2],
      [0.25, -0.2],
      [0.45, 0],
    ]),
    sq: trk(t, [
      [0, 0.88],
      [0.2, 0.92],
      [0.4, 1],
    ]),
    mouth: trk(t, [
      [0, 1],
      [0.2, 0.85],
      [0.35, 0],
    ]),
    reach: trk(t, [
      [0, 1],
      [0.15, 0.9],
      [0.4, 0],
    ]),
    raise: trk(t, [
      [0, 0.3],
      [0.4, 0.15],
    ]),
    hp: trk(t, [
      [0, -0.15],
      [0.3, 0],
    ]),
    eye: t < 0.2 ? 1 : 0,
    core: trk(t, [
      [0, 1.5],
      [0.3, 0.3],
      [0.6, 0.5],
    ]),
    wave: 2 + t * 8,
    tph: 3 + t * 10,
    amp: trk(t, [
      [0, 1.6],
      [0.5, 1],
    ]),
    stretch: trk(t, [
      [0, 1.3],
      [0.15, 1.1],
      [0.5, 0.2],
    ]),
    stream: t < 0.32 ? 0.05 + t / 0.32 : 0,
    slen: 13,
  };
}

/** Задувает огонь: 0–4 вдох, 5–8 дует (петля). */
function blow(f: number): SpiO {
  if (f < 5) {
    const k = (f + 1) / 5;
    return {
      ...O0,
      swell: 0.6 * easeOut(k),
      raise: lerp(0.15, 0.5, k),
      lean: -0.2 * k,
      hp: 0.15 * k,
      tph: k * 3,
      wave: k * 3,
      core: 0.5 + 0.4 * k,
    };
  }
  const k = (f - 5) / 4;
  return {
    ...O0,
    swell: 0.3,
    lean: 0.25,
    raise: 0.4,
    reach: 0.5,
    mouth: 0.6,
    hp: -0.05,
    tph: 3 + k * TAU,
    wave: 3 + k * TAU,
    core: 0.7,
    stream: 0.05 + k * 0.95,
    slen: 7,
  };
}

/** Бегство от жаровни: вытянулся, хвост хлещет, тает каплями. */
function flee(f: number): SpiO {
  const ph = (f / 12) * TAU;
  return {
    ...O0,
    lean: 0.5,
    stretch: 1.5,
    amp: 1.5,
    tph: ph * 2,
    wave: ph * 2,
    raise: 0,
    back: 1,
    eye: -1,
    swell: -0.12,
    sq: 0.92,
    bob: Math.sin(ph * 2) * 0.5,
    core: 0.9 + 0.3 * Math.sin(ph * 4),
    drip: f / 12,
  };
}

/** Вздрог: смяло, клочья врозь — и собрался. */
function stun(f: number): SpiO {
  const k = easeOut(f / 4);
  return {
    ...O0,
    sq: lerp(0.72, 1, k),
    swell: lerp(0.4, 0, k),
    raise: lerp(1, 0.15, k),
    lean: lerp(-0.5, 0, k),
    scatter: lerp(0.35, 0, k),
    eye: f < 3 ? -1 : 0,
    amp: lerp(2, 1, k),
    tph: f * 1.3,
    wave: f * 1.5,
    core: lerp(1.2, 0.5, k),
  };
}

/**
 * Смерть 0,67 с: дрожь и вспышка сердцевины, сжался — и рассыпался инеем
 * (тело пропадает разом, клубы инея разлетаются; гаснет — `alpha` кадра).
 */
function die(f: number): SpiO {
  const t = tf(f);
  const sh = t < 0.15 ? (f % 2 ? 0.3 : -0.3) : 0;
  const gone = t >= 0.25;
  return {
    ...O0,
    lean: sh,
    bob: trk(t, [
      [0, 0],
      [0.25, 1.2],
    ]),
    swell: trk(t, [
      [0, 0.3],
      [0.1, 0.7],
      [0.22, -0.45, easeIn],
    ]),
    core: gone
      ? trk(t, [
          [0.25, 2.2],
          [0.6, 0],
        ])
      : trk(t, [
          [0, 1.6],
          [0.12, 2],
          [0.22, 2.4],
        ]),
    raise: trk(t, [
      [0, 0.6],
      [0.2, 1.2],
    ]),
    eye: t < 0.1 ? 1 : -1,
    mouth: t < 0.2 ? 0.7 : 0,
    fade: gone ? 1 : 0,
    burst: gone ? clamp01((t - 0.2) / 0.5) : 0,
    motes: gone ? t : -1,
    tph: t * 12,
    wave: t * 10,
    amp: 1.6,
  };
}

/** Появление: иней стягивается, дух проявляется (прозрачность — `alpha` кадра). */
function form(f: number): SpiO {
  const k = (f + 1) / 9;
  return {
    ...float(f),
    swell: lerp(-0.45, 0, easeOut(k)),
    sq: lerp(0.8, 1, k),
    motes: k,
    suck: 1 - k,
    eye: k > 0.6 ? 0 : -1,
  };
}

function pose(anim: string, f: number): SpiO {
  switch (anim) {
    case 'float':
      return float(f);
    case 'drift':
      return drift(f);
    case 'wind':
      return wind(f);
    case 'breath':
      return breath(f);
    case 'blow':
      return blow(f);
    case 'flee':
      return flee(f);
    case 'stun':
      return stun(f);
    case 'form':
      return form(f);
    default:
      return die(f);
  }
}

const N: Record<string, number> = {
  float: 16,
  drift: 16,
  wind: 15,
  breath: 15,
  blow: 9,
  flee: 12,
  stun: 5,
  form: 9,
  die: 16,
};
const build = (anim: string, f: number) => spiritBuild(pose(anim, f));

const DIE = 0.8;
const FLEE_GHOST = { every: 0.06, life: 0.25, tint: '#bff8ff', alpha: 0.3 };

paintMob('f12_spirit', (m, p) => {
  const mode = p.mode;
  const t = p.t || 0;
  const now = p.now || 0;
  const id = m.id ?? 0;
  const vx = m.vx ?? 0;
  const vy = m.vy ?? 0;
  const fl = mode === 'f12_flee';
  const want = fl && speedOf(m) > 0.5 ? Math.atan2(vy, vx) : (m.face ?? 0);
  const v = visOf(m, p, want, mode === 'f12_wind' ? 20 : fl ? 10 : 8);
  const ex: Partial<MobFrame> = { still: true, lift: 2, shadow: 3.5 };
  const loop = (n: number, rate: number) => Math.floor(now * rate + hash(id, 7) * n) % n;
  const lean = () => {
    ex.rot = clamp(vx * 0.03, -0.12, 0.12);
  };
  let anim = 'float';
  let f = 0;
  if (mode === 'dying') {
    anim = 'die';
    f = fi(t, N.die - 1);
    ex.alpha = 1 - sstep(0.5, DIE, t);
    ex.linger = DIE;
  } else if (mode === 'f12_wind') {
    anim = 'wind';
    f = fi(t, N.wind - 1);
    // Дрожь на пике (прицел уже взят).
    if (t > 0.36 && t < 0.5) ex.dx = f % 2 ? 0.5 : -0.5;
  } else if (mode === 'recover') {
    anim = 'breath';
    f = fi(t, N.breath - 1);
    if (t < 0.1) {
      const q = 1 - t / 0.1;
      ex.dx = Math.cos(v.yaw) * 1.2 * q;
      ex.dy = Math.sin(v.yaw) * 0.7 * q;
    }
  } else if (mode === 'f12_douse' && (m.data?.blow ?? 0) > 0) {
    anim = 'blow';
    const b = m.data.blow;
    f = b < 0.2 ? fi(b, 4) : 5 + (fi(b - 0.2, 999) % 4);
  } else if (fl) {
    anim = 'flee';
    f = loop(12, 24);
    ex.alpha = 0.8;
    ex.ghost = FLEE_GHOST;
    lean();
  } else if (mode === 'stun') {
    anim = 'stun';
    f = fi(t, N.stun - 1);
  } else if (mode === 'chase' && !v.prev && t < 0.375) {
    anim = 'form';
    f = fi(t, N.form - 1);
    ex.alpha = 0.15 + 0.85 * easeOut(t / 0.375);
  } else {
    const fw = vx * Math.cos(v.yaw) + vy * Math.sin(v.yaw);
    anim = fw > 1.2 ? 'drift' : 'float';
    f = loop(16, 16);
    lean();
  }
  const fr = frameOf(K, anim, f, dirOf(v.yaw), p, () => build(anim, f));
  if (mode !== 'dying') hurtFx(v, now, 1.8, ex);
  return { ...fr, ...ex };
});

registerMobWarm('f12_spirit', () => warmAll(K, Object.entries(N) as [string, number][], build));
