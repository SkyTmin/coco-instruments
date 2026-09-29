// Этаж 9, босс «Многоглавая гидра» — техники (v2.86): метки ударов, зоны и
// снаряды босса. Вынесены из `f9-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { Px, TS } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
import { F9_LAIR, F9_MARK, F9_MAZE, F9_RUINS, isBogMark, isRingMark, isWaterMark } from './f9';
import { F9_VIEW, RS } from './f9-brains';
import {
  hx,
  alpha,
  clamp01,
  INK,
  WHITE,
  TAU,
  T,
  shadeEll,
  stroke,
  hash,
  cyc,
  ELEM,
  spriteOf,
  FIRE,
  rgba,
  kOf,
  lifeK,
  warned,
  cone,
  ringPath,
  dot,
  puddle,
  TAIL_C,
  lineMark,
  blobShot,
} from './f9-art';
import type { ZoneX } from './f9-art';

registerZonePainter('f9_frost', (g, z, px, py, S, time) => {
  puddle(g, z as ZoneX, px, py, S, time, hx('#6a9ad0'), hx('#e0f8ff'), 'frost');
  return true;
});

registerZonePainter('f9_embers', (g, z, px, py, S, time) => {
  puddle(g, z as ZoneX, px, py, S, time, hx('#6a1a08'), hx('#ff8a2a'), 'embers');
  return true;
});

// Конус огненной головы: наливается, угольки бегут к краю.
registerZonePainter('f9_firecone', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(FIRE[0], 0.14 + 0.26 * k);
  g.fill();
  g.strokeStyle = rgba(FIRE[2], 0.35 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (0.35 + 0.65 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const t = (time * 1.6 + i * 0.37) % 1;
    const aa = a + (hash(i, 3) - 0.5) * arc;
    const r = R * t * k;
    dot(g, px + Math.cos(aa) * r, py + Math.sin(aa) * r, rgba(FIRE[3], 0.5 + 0.4 * k));
  }
  return true;
});

registerZonePainter('f9_tail', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.2;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(TAIL_C[0], 0.18 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(TAIL_C[2], 0.3 + 0.55 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  // Кольца волн у кромки.
  for (let i = 0; i < 3; i++) {
    const t = (time * 0.9 + i / 3) % 1;
    g.strokeStyle = rgba(TAIL_C[1], (1 - t) * 0.5 * k);
    g.beginPath();
    g.arc(px, py, R * (0.3 + 0.7 * t), a - arc / 2, a + arc / 2);
    g.stroke();
  }
  // Гребень хвоста: изогнутая спина с плавником, бежит по дуге.
  const sweep = a - arc / 2 + arc * Math.min(1, k * 1.05);
  const rise = Math.sin(Math.min(1, k) * Math.PI * 0.5);
  for (let i = 0; i < 9; i++) {
    const f = i / 8;
    const r = R * (0.25 + 0.72 * f);
    const aa = sweep - 0.18 * f;
    const x = px + Math.cos(aa) * r;
    const y = py + Math.sin(aa) * r - rise * (2 + 3 * Math.sin(f * Math.PI));
    const s = Math.max(1, Math.round((1 - f) * 3 + 1));
    g.fillStyle = rgba(TAIL_C[1], 0.55 + 0.4 * k);
    g.fillRect(Math.round(x) - s, Math.round(y) - s, s * 2, s * 2);
    if (i % 2 === 0) dot(g, x, y - s - 1, rgba(TAIL_C[3], 0.4 + 0.5 * k), 1);
  }
  return true;
});

// Сама струя пламени — после метки, полсекунды.
registerZonePainter('f9_flame', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  if (!warned(zz)) return true;
  const t = lifeK(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = 0.9;
  const reach = Math.min(1, t * 4);
  const fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  const seed = Math.floor(time * 24);
  for (let i = 0; i < 26; i++) {
    const k = (i + 0.5) / 26;
    const d = R * k * reach;
    const spread = (hash(i, seed) - 0.5) * arc * (0.35 + k * 0.65);
    const x = px + Math.cos(a + spread) * d;
    const y = py - 3 + Math.sin(a + spread) * d;
    const r = 1.5 + k * 3.2 + hash(i, seed, 2) * 1.5;
    g.fillStyle = rgba(
      k < 0.2 ? FIRE[3] : k < 0.5 ? FIRE[2] : k < 0.8 ? FIRE[1] : FIRE[0],
      0.9 * fade,
    );
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), r, 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f9_bolt', (g, z, px, py, S, time) => {
  lineMark(g, z as ZoneX, px, py, S, time, hx('#3a2a8a'), hx('#fff8a0'), 3);
  return true;
});

const RAY = [
  [hx('#6a1a08'), FIRE[2]],
  [hx('#34568a'), hx('#e8fcff')],
  [hx('#26521a'), hx('#c8f04a')],
  [hx('#2e2468'), hx('#fff8a0')],
  [hx('#a89468'), hx('#ffffff')],
] as const;
for (let i = 0; i < 5; i++)
  registerZonePainter(`f9_ray${i}`, (g, z, px, py, S, time) => {
    lineMark(g, z as ZoneX, px, py, S, time, RAY[i][0], RAY[i][1], i === 3 ? 2.5 : 0.8);
    return true;
  });

// Укус головы: круг, по краю — зубы смыкаются.
registerZonePainter('f9_bite', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#a82a2a'), 0.12 + 0.28 * k);
  ringPath(g, px, py, R, 0.7);
  g.fill();
  g.strokeStyle = rgba(hx('#ff6a5a'), 0.5 + 0.4 * k);
  g.lineWidth = 1;
  ringPath(g, px, py, R, 0.7);
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const d = R * (1 - 0.55 * k);
    dot(g, px + Math.cos(a) * d, py + Math.sin(a) * d * 0.7, rgba(WHITE, 0.6 + 0.4 * k), 2);
  }
  return true;
});

registerZonePainter('f9_geyser', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#3a6a14'), 0.15 + 0.3 * k);
  ringPath(g, px, py, R, 0.7);
  g.fill();
  const seed = Math.floor(time * 8);
  for (let i = 0; i < 8; i++) {
    if (hash(i, seed, 2) > 0.3 + k * 0.6) continue;
    const a = hash(i, 5) * TAU;
    const d = hash(i, 6) * R;
    dot(g, px + Math.cos(a) * d, py + Math.sin(a) * d * 0.7 - k * 3, rgba(hx('#c8f04a'), 0.9), 2);
  }
  g.strokeStyle = rgba(hx('#c8f04a'), 0.4 + 0.5 * k);
  g.lineWidth = 1;
  ringPath(g, px, py, R * (0.3 + 0.7 * k), 0.7);
  g.stroke();
  return true;
});

// Водоворот скрытой головы: спираль в иле стягивается.
registerZonePainter('f9_whirl', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#2a1a3a'), 0.25 + 0.35 * k);
  ringPath(g, px, py, R, 0.66);
  g.fill();
  for (let arm = 0; arm < 3; arm++)
    for (let t = 0; t < 1; t += 0.04) {
      const a = t * 5 + arm * (TAU / 3) + time * (3 + k * 6);
      const r = R * (1 - t);
      dot(
        g,
        px + Math.cos(a) * r,
        py + Math.sin(a) * r * 0.66,
        rgba(hx('#b88aff'), (0.3 + 0.6 * k) * (1 - t * 0.5)),
      );
    }
  return true;
});

registerZonePainter('f9_glare', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#fff0b0'), 0.12 + 0.3 * k);
  ringPath(g, px, py, R, 0.7);
  g.fill();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + time * 2;
    g.fillStyle = rgba(WHITE, 0.3 + 0.6 * k);
    g.fillRect(
      Math.round(px + Math.cos(a) * R * k),
      Math.round(py + Math.sin(a) * R * 0.7 * k),
      2,
      1,
    );
  }
  return true;
});

// Огонь в руке: пламя вокруг ног и над плечом, пока горит.
registerZonePainter('f9_handfire', (g, _z, px, py, S, time) => {
  const k = F9_VIEW.fire;
  if (k <= 0) return true;
  const seed = Math.floor(time * 14);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + time * 2.5;
    const x = px + Math.cos(a) * 0.45 * S;
    const y = py + 1 + Math.sin(a) * 0.25 * S;
    const h = 2 + ((seed + i) % 3);
    g.fillStyle = rgba(FIRE[((i + seed) % 3) + 1], 0.85);
    g.fillRect(Math.round(x), Math.round(y - h), 1, h);
  }
  // Факел над плечом: язык пламени, тает к концу срока.
  const fx = px + 5;
  const fy = py - 16;
  for (let i = 0; i < 6; i++) {
    const w = (1 - i / 6) * 2.2 * (0.5 + 0.5 * k);
    const sway = Math.sin(time * 12 + i) * 0.8;
    g.fillStyle = rgba(i < 2 ? FIRE[3] : i < 4 ? FIRE[2] : FIRE[1], 0.95);
    g.fillRect(Math.round(fx - w + sway), Math.round(fy - i), Math.max(1, Math.round(w * 2)), 1);
  }
  return true;
});

registerZonePainter('f9_sear', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const d = (0.2 + k) * S;
    dot(
      g,
      px + Math.cos(a) * d,
      py + Math.sin(a) * d * 0.6 - k * 8,
      rgba(i % 2 ? FIRE[3] : FIRE[2], 1 - k),
      2,
    );
  }
  g.fillStyle = rgba(hx('#8a8a88'), 0.5 * (1 - k));
  g.beginPath();
  g.arc(Math.round(px), Math.round(py - 6 - k * 10), 3 + k * 5, 0, TAU);
  g.fill();
  return true;
});

registerZonePainter('f9_regrow', (g, z, px, py, S) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  g.strokeStyle = rgba(hx('#c83a2a'), 1 - k);
  g.lineWidth = 2;
  ringPath(g, px, py, (0.3 + k * 1.2) * S, 0.6);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    dot(
      g,
      px + Math.cos(a) * k * S,
      py + Math.sin(a) * k * S * 0.6 - 4,
      rgba(hx('#e04a3a'), 1 - k),
      2,
    );
  }
  return true;
});

registerZonePainter('f9_healed', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = clamp01(zz.t / Math.max(0.01, zz.life));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + time * 3;
    dot(
      g,
      px + Math.cos(a) * 0.6 * S,
      py - 10 + Math.sin(a) * 4 - k * 8,
      rgba(hx('#fff4c0'), 1 - k),
      2,
    );
  }
  return true;
});

registerShotPainter(
  'f9_venomglob',
  blobShot('vglob', T('#142a0a', '#2a5a1a', '#5a9a2a', '#b8f050'), hx('#94d046'), 2),
);

registerShotPainter('f9_iceball', (s: Shot, time: number) => {
  const f = cyc(time * 10 + s.id, 4);
  return spriteOf(`ice|${f}`, () => {
    const p = new Px(14, 14);
    shadeEll(p, 7, 7, 3.6, 3.6, ELEM[1].skin);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + f * 0.4;
      stroke(p, 7, 7, 7 + Math.cos(a) * 5.5, 7 + Math.sin(a) * 5.5, ELEM[1].crest[2]);
    }
    p.outline(alpha(INK, 0.7));
    p.set(6, 5, WHITE);
    return { img: p.canvas(), ax: 7, ay: 9 };
  });
});
