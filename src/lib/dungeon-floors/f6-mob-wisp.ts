// Этаж 6 — Огненный дух (анимации мобов 6). Облик прежнего «пламени»
// (Ninja Adventure): капля огня с двумя тёмными глазами, языки сверху.
// Бесформенный — сторон нет: рисуется полем огня (тело-капля и языки),
// глаза смотрят по ходу (8 положений, на север — спиной, без глаз). Ход —
// перетекание: языки отстают и клонятся против хода, тело сплющивается по
// скорости, за ним искры. Раздувание (2 с — весь замах): тело растёт
// ступенями, венец языков, ядро белеет, глаза щурятся, рот «О»; пульс
// фитиля учащается от 3 до 10 Гц (полями кадра), последние 0,25 с — дрожь
// добела. Взрыв: ядро схлопывается вспышкой (картинку взрыва рисует зона).
// Добит — гаснет: оседает углём, дымок (0,8 с, `linger`). Выход из лавы —
// лава вспучивается, языки, потом всё тело, кольцо расходится.

import { Px } from '../dungeon-art';
import { registerMobPainter, registerMobWarm } from '../dungeon-paint';
import type { MobFrame, MobPose } from '../dungeon-paint';
import type { Mob } from '../dungeon-sim';
import { WISP } from './f6-brains';
import {
  alpha,
  clamp,
  clamp01,
  dirN,
  FIRE,
  fi,
  FPS,
  frameOf,
  hash,
  hurtFx,
  hx,
  kindOf,
  mod,
  PI,
  speedOf,
  sstep,
  TAU,
  visOf,
  warmAll,
} from './f6-mobkit';
import type { Pic, RGBA } from './f6-mobkit';

const EDGE = hx('#5a1006');
const EYE = hx('#2a0804');
const SMOKE = hx('#7a6e66');
const LAVA_HI = hx('#ffc440');
const LAVA_MID = hx('#ff8a1e');
const LAVA_DK = hx('#a8240a');
const COAL = [hx('#2a1410'), hx('#5a2414'), hx('#a8400e')];

/** Холст духа и точка «земли» (дух висит над ней — `lift`). */
const W = 34;
const H = 38;
const AX = 17;
const AY = 31;

interface WispO {
  /** Тело: полуоси, подъём середины над землёй кадра. */
  rx: number;
  ry: number;
  cy: number;
  /** Языки: высота, наклон вершин (пикс., + вправо), такт. */
  tongue: number;
  sway: number;
  flick: number;
  /** Венец языков вокруг (раздувание) 0…1; ядро белеет 0…1. */
  crown: number;
  white: number;
  /** Глаза: направление (0…7, −1 — спиной), прищур 0…1, рот «О». */
  look: number;
  squint: number;
  mouth: number;
  /** Темнее (гаснет), искры за спиной (ход). */
  dark: number;
  trail: number;
  /** Срез снизу (выход из лавы): строки ниже не видны. */
  cut: number;
}
const O0: WispO = {
  rx: 5.2,
  ry: 5.0,
  cy: 5,
  tongue: 5,
  sway: 0,
  flick: 0,
  crown: 0,
  white: 0,
  look: 2,
  squint: 0,
  mouth: 0,
  dark: 0,
  trail: 0,
  cut: 99,
};

/** Цвет огня по силе поля: край — красный, сердце — белёсое. */
function fireCol(F: number, white: number, dark: number): RGBA {
  const k = F + white * 0.35;
  let c = k < 0.18 ? FIRE[1] : k < 0.42 ? FIRE[2] : k < 0.68 ? FIRE[3] : FIRE[4];
  if (dark > 0) {
    const d = clamp01(dark);
    c = d > 0.66 ? COAL[Math.min(2, Math.floor(F * 3))] : mixDk(c, d);
  }
  return c;
}
const mixDk = (c: RGBA, d: number): RGBA => [
  Math.round(c[0] * (1 - d * 0.7)),
  Math.round(c[1] * (1 - d * 0.85)),
  Math.round(c[2] * (1 - d * 0.9)),
  255,
];

function wispPx(o: WispO): Pic {
  const p = new Px(W, H);
  const cx = AX;
  const cy = AY - o.cy;
  const field = new Float32Array(W * H);
  // Тело-капля: эллипс, сверху сужается к языкам.
  const put = (x: number, y: number, F: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (F > field[i]) field[i] = F;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / o.rx;
      const up = y + 0.5 < cy ? 1 + (cy - y - 0.5) * 0.05 : 1;
      const dy = (y + 0.5 - cy) / (o.ry * up);
      const F = 1 - Math.sqrt(dx * dx + dy * dy);
      if (F > 0) put(x, y, F);
    }
  // Языки: конусы вверх от темени, вершины клонятся (`sway`) и дрожат.
  const n = 5;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * o.rx * 0.42;
    const fl = 0.7 + 0.45 * Math.sin(((o.flick + i * 3) % 8) * (TAU / 8) + i * 1.3);
    const h = o.tongue * fl * (1 - Math.abs(off) / (o.rx * 1.6));
    if (h < 0.8) continue;
    const bx = cx + off;
    const by = cy - o.ry * 0.55;
    const w = 1.6 + o.rx * 0.12;
    for (let y = Math.floor(by - h - 1); y <= by + 1; y++)
      for (let x = Math.floor(bx - w - 4); x <= bx + w + 4; x++) {
        const t = clamp01((by - (y + 0.5)) / h);
        const ax = bx + o.sway * t * t;
        const ww = w * (1 - t) + 0.25;
        const d = Math.abs(x + 0.5 - ax) / ww;
        if (d > 1) continue;
        put(x, y, (1 - d) * (1 - t) * 0.75);
      }
  }
  // Венец раздувания: языки по кругу, растут с раздуванием.
  if (o.crown > 0) {
    const m = 10;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * TAU + o.flick * 0.2;
      const R = Math.max(o.rx, o.ry) * 0.85;
      const bx = cx + Math.cos(a) * R;
      const by = cy + Math.sin(a) * R * 0.8;
      const h = (2 + o.crown * 5) * (0.75 + 0.4 * hash(i, o.flick % 4));
      const dx = Math.cos(a);
      const dy = Math.sin(a) * 0.8 - 0.6;
      const l = Math.hypot(dx, dy);
      for (let s = 0; s <= h; s += 0.5) {
        const t = s / h;
        const X = bx + (dx / l) * s;
        const Y = by + (dy / l) * s;
        const ww = (1 - t) * (1 + o.crown * 0.6);
        for (let ox = -2; ox <= 2; ox++)
          for (let oy = -2; oy <= 2; oy++) {
            const d = Math.hypot(ox, oy) / (ww + 0.3);
            if (d <= 1) put(Math.round(X + ox), Math.round(Y + oy), (1 - d) * (1 - t) * 0.6);
          }
      }
    }
  }
  // Цвет, срез снизу, контур.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const F = field[y * W + x];
      if (F <= 0 || y > o.cut) continue;
      p.set(x, y, fireCol(F, o.white, o.dark));
    }
  p.outline(o.dark > 0.66 ? hx('#140a08') : EDGE);
  // Глаза: смотрят по ходу; на север — спиной.
  let eye: [number, number] | null = null;
  if (o.look >= 0 && o.dark < 0.5) {
    const a = (o.look / 8) * TAU;
    const ex = Math.round(cx + Math.cos(a) * o.rx * 0.35);
    const ey = Math.round(cy + 0.5 + Math.sin(a) * o.ry * 0.18);
    for (const sd of [-1, 1]) {
      const x = ex + sd * Math.max(2, Math.round(o.rx * 0.36));
      p.set(x, ey, EYE);
      if (o.squint < 0.5) p.set(x, ey - 1, EYE);
      if (o.squint > 0.3) p.set(x - sd, ey - 1 - (o.squint > 0.6 ? 1 : 0), EYE);
    }
    if (o.mouth > 0) {
      const my = ey + 2 + Math.round(o.mouth);
      p.set(ex, my, EYE);
      if (o.mouth > 0.5) {
        p.set(ex - 1, my, EYE);
        p.set(ex, my + 1, EYE);
      }
    }
    eye = [ex - 2, ey];
  }
  // Искры за спиной — след хода.
  if (o.trail > 0)
    for (let i = 0; i < 4; i++) {
      const k = (i + 1) / 4;
      const x = Math.round(cx - o.sway * 1.6 * k + (hash(i, o.flick) - 0.5) * 3);
      const y = Math.round(cy + 2 - k * 6 + hash(i, o.flick, 2) * 3);
      p.set(x, y, k < 0.5 ? FIRE[3] : FIRE[2]);
    }
  return { p, lit: null, ax: AX, ay: AY, eye };
}

function wispPose(anim: string, f: number, d: number): WispO {
  const o: WispO = { ...O0, flick: f, look: d === 6 ? -1 : d };
  switch (anim) {
    case 'fly': {
      // 8 кадров огня; `d` — куда смотрят глаза; наклон языков — в ключе.
      break;
    }
    case 'swell': {
      // 12 ступеней раздувания; f — ступень·4 + такт огня.
      const k = (Math.floor(f / 4) + 1) / 12;
      o.flick = f % 4;
      o.rx = 5.2 + k * 3.6;
      o.ry = 5.0 + k * 3.2;
      o.cy = 5 + k * 2.6;
      o.tongue = 5 + k * 3;
      o.crown = sstep(0.15, 1, k);
      o.white = k * 0.9;
      o.squint = sstep(0.1, 0.5, k);
      o.mouth = sstep(0.4, 0.9, k) * 1.2;
      break;
    }
    case 'flinch': {
      const b = Math.sin(PI * Math.min(1, (f / 4) * 1.25)) * (1 - (f / 4) * 0.5);
      o.rx = 5.2 + b * 1.2;
      o.ry = 5.0 - b * 1.2;
      o.tongue = 5 - b * 2.5;
      o.squint = b;
      o.white = b * 0.4;
      break;
    }
    case 'sleep': {
      o.rx = 4.4;
      o.ry = 3.8;
      o.cy = 5;
      o.tongue = 2.5 + (f % 2) * 0.6;
      o.squint = 1;
      o.look = 2;
      o.dark = 0.3;
      break;
    }
    case 'alert': {
      const k = f / 8;
      const up = Math.sin(PI * Math.min(1, k * 1.4));
      o.tongue = 5 + up * 3;
      o.ry = 5 + up * 0.8;
      o.white = up * 0.4;
      break;
    }
    case 'out': {
      // Гаснет 0,8 с (19 кадров): оседает, темнеет до угля.
      const t = f / FPS;
      const q = sstep(0, 0.7, t);
      o.rx = 5.2 + q * 1.4;
      o.ry = 5 - q * 3.6;
      o.cy = 5 - q * 3.4;
      o.tongue = 5 * (1 - sstep(0, 0.4, t));
      o.squint = sstep(0, 0.2, t);
      o.dark = sstep(0.1, 0.65, t);
      o.look = t < 0.3 ? 2 : -1;
      break;
    }
    case 'pop': {
      // Взрыв: ядро схлопывается за три кадра.
      o.rx = 8.8 - f * 2.6;
      o.ry = 8.2 - f * 2.4;
      o.cy = 7.6;
      o.white = 1.1 - f * 0.1;
      o.crown = 1 - f * 0.45;
      o.tongue = 6 - f * 2;
      o.look = -1;
      break;
    }
  }
  return o;
}

const WK = kindOf('f6_wisp', W, H, AX, AY, 1400);

/** Ключ хода: 5 наклонов языков (против хода) × искры. */
const SWAYS = [-3, -1.5, 0, 1.5, 3];

function wispPic(anim: string, f: number, d: number): Pic {
  if (anim.startsWith('fly')) {
    const s = Number(anim.slice(3)) || 0;
    const o = wispPose('fly', f, d);
    o.sway = SWAYS[s] ?? 0;
    o.trail = s === 2 ? 0 : 1;
    if (s !== 2) {
      o.rx = 5.6;
      o.ry = 4.7;
    }
    return wispPx(o);
  }
  if (anim === 'rise') return risePic(f, d);
  return wispPx(wispPose(anim, f, d));
}

/** Выход из лавы 0,6 с (15 кадров): лава вспучивается, языки, всё тело. */
function risePic(k: number, d: number): Pic {
  const o = wispPose('fly', k % 8, d);
  const q = (k + 1) / 15;
  const e = 1 - (1 - q) ** 3;
  const surf = AY;
  // Конец подъёма — там же, где дух висит в ходе (5 + `lift` 6).
  o.cy = 11 - (1 - e) * 17;
  o.cut = surf;
  o.tongue = 5 * sstep(0.1, 0.4, q) + 1;
  if (q < 0.3) o.look = -1;
  const pic = wispPx(o);
  const p = pic.p;
  const rx = 3 + q * 7;
  const ry = 1 + q * 1.6;
  const fade = q < 0.6 ? 1 : 1 - (q - 0.6) / 0.5;
  // Кольцо по лаве: задняя половина — под телом (рисуем прямо поверх: тело
  // выше поверхности), передняя — поверх.
  for (let a = 0; a < TAU; a += 0.06) {
    const x = Math.round(AX + Math.cos(a) * rx);
    const y = Math.round(surf + Math.sin(a) * ry);
    const front = Math.sin(a) > 0;
    if (!front && p.solid(x, y)) continue;
    p.set(x, y, alpha(front ? LAVA_HI : LAVA_MID, fade));
    if (front) p.set(x, y + 1, alpha(LAVA_DK, 0.8 * fade));
  }
  if (k < 3) {
    // Лава вспучивается куполом раньше, чем покажется пламя.
    const h = 1.5 + k;
    for (let y = 0; y <= h; y++) {
      const w = Math.round(Math.sqrt(1 - (y / (h + 0.5)) ** 2) * (3 + k));
      for (let x = -w; x <= w; x++)
        p.set(AX + x, surf - y, y === Math.round(h) || Math.abs(x) === w ? LAVA_MID : LAVA_HI);
    }
  }
  if (q < 0.7)
    for (let i = 0; i < 6; i++) {
      const side = hash(i, 19) < 0.5 ? -1 : 1;
      const v = 0.6 + hash(i, 17) * 0.8;
      const tt = q * 1.6;
      const x = Math.round(AX + side * (2 + tt * 6 * v));
      const y = Math.round(surf - 1 - tt * 9 * v + tt * tt * 7);
      if (y < surf) p.set(x, y, i % 2 ? LAVA_HI : FIRE[3]);
    }
  return pic;
}

/** Дым погасшего: клубы вверх поверх кадра (кадр k из 19). */
function smokeOn(p: Px, k: number): void {
  const q = k / 18;
  for (let i = 0; i < 3; i++) {
    const tt = q - 0.2 - i * 0.14;
    if (tt <= 0) continue;
    const y = AY - 6 - tt * 16;
    const x = AX + Math.sin(tt * 7 + i * 2) * 2;
    const r = 1.4 + tt * 3;
    p.ell(x, y, r, r * 0.8, alpha(SMOKE, 0.7 * (1 - tt)));
  }
}

/** Пульс фитиля: такт учащается от 3 до 10 Гц к взрыву. */
function pulse(t: number): number {
  const T = WISP.swell;
  const ph = 3 * t + (7 * t * t * t) / (3 * T * T);
  const s = Math.sin(ph * TAU);
  return s > 0 ? s * s : 0;
}

registerMobPainter('f6_wisp', (m: Mob, pose: MobPose) => {
  const md = pose.mode;
  const t = pose.t;
  const now = pose.now || 0;
  const id = m.id ?? 0;
  const vx = m.vx ?? 0;
  const vy = m.vy ?? 0;
  const sp = speedOf(m);
  const want = sp > 0.3 ? Math.atan2(vy, vx) : (m.face ?? 0);
  const v = visOf(m, pose, want, 8);
  // Глаза по ходу (8 положений); на север — спиной, без глаз.
  const dd = dirN(v.yaw);
  const fl = mod(Math.floor((now + hash(id, 3)) * 12), 8);
  const bob = Math.sin(now * 4 + id * 1.7) * 1.2;
  const ex: Partial<MobFrame> = { still: true, lift: 6 + bob, shadow: 5 };
  let anim = 'fly2';
  let f = fl;
  let d = dd;
  if (md === 'dying') {
    ex.lift = 6;
    if ((m.data?.ghost ?? 0) === 1) {
      // Сгорел во взрыве: ядро схлопывается под вспышкой зоны.
      const k = Math.min(3, Math.floor(t * FPS));
      if (k >= 3)
        return {
          ...frameOf(WK, 'pop', 2, 6, pose, () => wispPic('pop', 2, 6)),
          alpha: 0,
          shadow: 0,
          still: true,
          eye: null,
        };
      anim = 'pop';
      f = k;
      d = 6;
      ex.sx = 1.3;
      ex.sy = 1.3;
    } else {
      anim = 'out';
      f = fi(t, 18);
      d = 2;
      ex.linger = 0.8;
      ex.lift = 6 * (1 - sstep(0.1, 0.6, t));
      ex.shadow = 5 * (1 - sstep(0.3, 0.8, t));
      ex.alpha = 1 - sstep(0.65, 0.8, t);
      const fr = frameOf(WK, anim, f, d, pose, () => {
        const pic = wispPic('out', f, 2);
        smokeOn(pic.p, f);
        return pic;
      });
      return { ...fr, ...ex };
    }
  } else if (md === 'f6_swell') {
    // 12 ступеней раздувания, огонь 12 к/с; пульс — полями кадра.
    const k = Math.min(11, Math.floor((t / WISP.swell) * 12));
    anim = 'swell';
    f = k * 4 + mod(Math.floor(t * 12), 4);
    d = 2;
    const q = Math.min(1, t / WISP.swell);
    const pu = pulse(t);
    const sc = 1 + pu * (0.05 + q * 0.08);
    ex.sx = sc;
    ex.sy = sc * (1 - pu * 0.04);
    ex.lift = 6;
    if (t > WISP.swell - 0.25) ex.dx = (Math.floor(t * 40) % 2 ? 1 : -1) * 0.8;
  } else if (md === 'f6_rise') {
    anim = 'rise';
    f = fi(t, 14);
    ex.lift = 0;
    ex.shadow = 0;
  } else if (md === 'stun') {
    anim = 'flinch';
    f = fi(t, 4);
  } else if (md === 'sleep') {
    anim = 'sleep';
    f = Math.floor(now * 1.2 + hash(id, 5) * 2) % 2;
    d = 2;
    ex.lift = 3 + bob * 0.4;
  } else if (md === 'alert') {
    anim = 'alert';
    f = fi(t, 8);
  } else {
    // Ход: языки клонятся против хода по экрану (5 наклонов).
    const sx = sp > 0.3 ? -vx / Math.max(1, sp) : 0;
    const s = clamp(Math.round(sx * 2) + 2, 0, 4);
    anim = `fly${s}`;
    const k = clamp01(sp / 3.3);
    ex.sx = 1 + 0.06 * k;
    ex.sy = 1 - 0.05 * k;
    ex.rot = clamp(vx * 0.02, -0.08, 0.08);
  }
  if (md !== 'dying') {
    const age = hurtFx(v, now, 1.8, ex);
    // Удар героя сбивает пламя: языки сдувает (кадр ушиба), потом обратно.
    if (age >= 0 && age < 0.2 && md !== 'f6_swell' && md !== 'f6_rise') {
      anim = 'flinch';
      f = Math.min(4, Math.floor(age * FPS));
    }
  }
  return { ...frameOf(WK, anim, f, d, pose, () => wispPic(anim, f, d)), ...ex };
});

registerMobWarm('f6_wisp', function* () {
  const all = [0, 1, 2, 3, 4, 5, 6, 7];
  yield* warmAll(WK, [['fly2', 8]], wispPic, all);
  yield* warmAll(
    WK,
    [
      ['fly0', 8],
      ['fly1', 8],
      ['fly3', 8],
      ['fly4', 8],
    ],
    wispPic,
    all,
  );
  yield* warmAll(WK, [['swell', 48]], wispPic, [2]);
  yield* warmAll(
    WK,
    [
      ['out', 19],
      ['sleep', 2],
    ],
    (a, f) => {
      const pic = wispPic(a, f, a === 'pop' ? 6 : 2);
      if (a === 'out') smokeOn(pic.p, f);
      return pic;
    },
    [2],
  );
  yield* warmAll(WK, [['pop', 3]], wispPic, [6]);
  yield* warmAll(WK, [['rise', 15]], wispPic, all);
  yield* warmAll(
    WK,
    [
      ['flinch', 5],
      ['alert', 9],
    ],
    wispPic,
    all,
  );
});
