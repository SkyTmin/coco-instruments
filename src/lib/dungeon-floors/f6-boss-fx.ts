// Этаж 6, босс «Красный змей» — техники (v2.86): метки ударов, зоны и
// снаряды босса. Вынесены из `f6-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { Px } from '../dungeon-art';
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
import { x72 } from '../dungeon-tiles';
import type { X72Name } from '../dungeon-x72-frames';
import { F6_GALLERY, F6_LAKES, F6_MARK, F6_NEST } from './f6';
import { GOLEM, serpentView, WISP } from './f6-brains';
import {
  hx,
  rgba,
  TAU,
  stroke,
  hash,
  FIRE,
  BASALT,
  BONE,
  kOf,
  lifeOf,
  cone,
  tongues,
  riseMark,
} from './f6-art';
import type { ZoneX } from './f6-art';

// Волна пламени: полоса через арену. Пока метка — по полу бежит огненная
// жилка (ярче к удару); когда ударила — стена огня (зона `f6_waveflame`).
registerZonePainter('f6_wave', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const a = zz.ang ?? 0;
  const L = zz.r * S;
  const w = (zz.w ?? 0.6) * S;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = rgba(FIRE[0], 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  // Кромки полосы — чёткие: видно, где просвет.
  g.fillStyle = rgba(FIRE[2], 0.35 + 0.55 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Жилка по оси: бежит к удару.
  g.fillStyle = rgba(FIRE[3], 0.3 + 0.6 * k);
  const n = Math.floor(L / 3);
  for (let i = 0; i < n; i++) {
    if ((i + Math.floor(time * 20)) % 4 > Math.floor(k * 4)) continue;
    g.fillRect(i * 3, -0.5, 2, 1);
  }
  g.restore();
  return true;
});

registerZonePainter('f6_waveflame', (g, z, px, py, S, time) => {
  const zz = z as Zone & { ang?: number; len?: number };
  const l = lifeOf(zz);
  if (l < 0) return true;
  const a = zz.ang ?? 0;
  const L = (zz.len ?? 20) * S;
  const x0 = px - (Math.cos(a) * L) / 2;
  const y0 = py - (Math.sin(a) * L) / 2;
  const x1 = px + (Math.cos(a) * L) / 2;
  const y1 = py + (Math.sin(a) * L) / 2;
  g.strokeStyle = rgba(FIRE[1], 0.5 * l);
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  tongues(g, x0, y0, x1, y1, Math.floor(L / 4), 9 * l + 3, time, Math.min(1, l * 1.6), zz.id);
  return true;
});

// Пламя веером: сектор метки, края ярче; порядок — по времени удара.
registerZonePainter('f6_sweep', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 0.5;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(FIRE[0], 0.1 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(FIRE[2], 0.25 + 0.6 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (0.3 + 0.7 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  g.fillStyle = rgba(FIRE[3], 0.5 * k);
  for (let i = 0; i < 4; i++) {
    const t = (time * 1.4 + i * 0.25) % 1;
    const aa = a + (hash(i, zz.id) - 0.5) * arc;
    g.fillRect(Math.round(px + Math.cos(aa) * R * t), Math.round(py + Math.sin(aa) * R * t), 1, 1);
  }
  return true;
});

// Струя пламени изо рта: комья огня, у пасти белые, к краю красные.
registerZonePainter('f6_breath', (g, z, px, py, S, time) => {
  const zz = z as ZoneX & Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  const R = zz.r * S;
  let a = zz.ang ?? 0;
  const arc = zz.sweep ? 0.5 : 0.6;
  // Веер: струя поворачивается за время жизни.
  if (zz.sweep) a += zz.sweep * (t - 0.5) * 3.3;
  const reach = Math.min(1, t * 5);
  const fade = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
  const seed = Math.floor(time * 24);
  for (let i = 0; i < 24; i++) {
    const k = (i + 0.5) / 24;
    const d = R * k * reach;
    const spread = (hash(i, seed) - 0.5) * arc * (0.3 + k * 0.7);
    const x = px + Math.cos(a + spread) * d;
    const y = py - 8 + Math.sin(a + spread) * d;
    const r = 1.4 + k * 3.4 + hash(i, seed, 2) * 1.2;
    const col = k < 0.2 ? FIRE[3] : k < 0.5 ? FIRE[2] : k < 0.8 ? FIRE[1] : FIRE[0];
    g.fillStyle = rgba(col, 0.88 * fade);
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), r, 0, TAU);
    g.fill();
  }
  return true;
});

// Бросок головой: полоса с «зубами» на конце.
registerZonePainter('f6_bite', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const a = zz.ang ?? 0;
  const L = zz.r * S;
  const w = (zz.w ?? 0.7) * S;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = rgba(hx('#c81a10'), 0.14 + 0.3 * k);
  g.fillRect(0, -w, L, w * 2);
  // Клыки на конце — где сомкнутся челюсти.
  g.fillStyle = rgba(BONE[3], 0.4 + 0.6 * k);
  for (let i = -2; i <= 2; i++) {
    g.fillRect(Math.round(L - 4 + Math.abs(i)), Math.round(i * (w / 2.5)) - 1, 3, 2);
  }
  g.strokeStyle = rgba(FIRE[2], 0.4 + 0.6 * k);
  g.lineWidth = 1;
  g.strokeRect(0, -w, L * k, w * 2);
  g.restore();
  return true;
});

// Хвост вкруговую: кольцо штрихов вращается.
registerZonePainter('f6_tail', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#a01810'), 0.1 + 0.24 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#ffc890'), 0.4 + 0.6 * k);
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a0 = time * 7 * (0.5 + k) + (i / 6) * TAU;
    g.beginPath();
    g.arc(px, py, R, a0, a0 + 0.5);
    g.stroke();
  }
  return true;
});

// Пике: тень змея растёт в круге, крест прицела.
registerZonePainter('f6_dive', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#200404'), 0.2 + 0.4 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.3 + 0.7 * k), R * (0.2 + 0.5 * k), 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(FIRE[1], 0.6 + 0.4 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  const d = R * (1.3 - 0.4 * k);
  g.strokeStyle = rgba(FIRE[2], 0.5 + 0.5 * Math.sin(time * 20));
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    g.beginPath();
    g.moveTo(px + dx * d, py + dy * d * 0.8);
    g.lineTo(px + dx * (d - 4), py + dy * (d - 4) * 0.8);
    g.stroke();
  }
  return true;
});

// Удар пике: кольцо огня и камни.
registerZonePainter('f6_impact', (g, z, px, py, S) => {
  const zz = z as Zone;
  const t = Math.min(1, zz.t / Math.max(0.01, zz.life));
  const R = zz.r * S * (0.5 + t);
  g.strokeStyle = rgba(FIRE[2], 1 - t);
  g.lineWidth = 3 * (1 - t) + 1;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(BASALT[2], 1 - t);
  for (let i = 0; i < 10; i++) {
    const a = hash(i, zz.id) * TAU;
    const d = R * (0.4 + hash(i, zz.id, 2) * 0.6);
    g.fillRect(
      Math.round(px + Math.cos(a) * d),
      Math.round(py + Math.sin(a) * d * 0.7 - t * 8),
      2,
      2,
    );
  }
  return true;
});

// Угли с неба: метка — круг, в неё падает уголёк с хвостом.
registerZonePainter('f6_ember', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(FIRE[0], 0.12 + 0.25 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.8, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(FIRE[2], 0.4 + 0.5 * k);
  g.lineWidth = 1;
  g.stroke();
  // Уголёк падает сверху: высота убывает к удару.
  const h = (1 - k) * 60;
  g.fillStyle = rgba(FIRE[1], 0.8);
  g.fillRect(Math.round(px) - 1, Math.round(py - h - 6), 3, 6);
  g.fillStyle = rgba(FIRE[3], 1);
  g.fillRect(Math.round(px), Math.round(py - h - 1), 1, 2);
  return true;
});

registerZonePainter('f6_crack', (g, z, px, py, S, time) => {
  riseMark(g, z as Zone, px, py, S, time, true);
  return true;
});
