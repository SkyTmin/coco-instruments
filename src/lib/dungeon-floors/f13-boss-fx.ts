// Этаж 13, босс «Колосс» — техники (v2.87): метки ударов, зоны и
// снаряды босса. Вынесены из `f13-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { paintSim, registerZonePainter } from '../dungeon-paint';
import type { Zone } from '../dungeon-sim';
import { hx, TAU, rgba, RED, STEAMC, kOf, fadeOf, specks, billow, stompRing } from './f13-art';
import type { ZoneX } from './f13-art';

registerZonePainter('f13_foot', (g, z, px, py, S) => {
  stompRing(g, z as ZoneX, px, py, S, RED, true);
  return true;
});

registerZonePainter('f13_steamring', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  stompRing(g, zz, px, py, S, hx('#ffb080'), false);
  const k = kOf(zz);
  if (k > 0.6) specks(g, px, py, zz.r * S, 18, STEAMC, (k - 0.6) * 2, time, zz.id);
  return true;
});

registerZonePainter('f13_cloak', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  const sim = paintSim();
  const col = sim?.mobs.find((m) => m.kind === 'f13boss');
  // Сорван крюком — плащ редеет, затылок виден.
  const bare = (col?.data.bareT ?? 0) > 0;
  const a0 = (bare ? 0.12 : 0.34) * fadeOf(zz);
  // Туман у ног — плотный, кольцом.
  g.fillStyle = rgba(STEAMC, a0 * 0.7);
  g.beginPath();
  g.ellipse(px, py, R * 1.1, R * 0.5, 0, 0, TAU);
  g.fill();
  // Клубы по всему росту: поднимаются и кружат вокруг тела.
  for (let i = 0; i < 14; i++) {
    const ph = (time * 0.35 + i / 14) % 1;
    const a = (i / 14) * TAU + time * 0.6;
    const x = px + Math.cos(a) * R * (0.7 + 0.25 * Math.sin(i));
    const y = py + Math.sin(a) * R * 0.35 - ph * 70;
    const rr = 5 + ph * 7 + (i % 3);
    g.fillStyle = rgba(STEAMC, a0 * (1 - ph * 0.7));
    g.beginPath();
    g.arc(Math.round(x), Math.round(y), rr, 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f13_heat', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  // Жар вокруг: оранжевое кольцо дрожит, угли взлетают.
  g.strokeStyle = rgba(hx('#ff6a1a'), 0.3 + 0.12 * Math.sin(time * 7));
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(hx('#ff5a18'), 0.1 * fadeOf(zz));
  g.fill();
  specks(g, px, py - 6, R, 12, hx('#ffb040'), 0.8 * fadeOf(zz), time, zz.id);
  return true;
});

registerZonePainter('f13_jet', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const warn = (zz as Zone).warn ?? 0;
  const R = zz.r * S;
  if (zz.t < warn) {
    // Отдушина раскаляется: кольцо и шипение.
    const k = zz.t / warn;
    g.strokeStyle = rgba(hx('#ff8a2a'), 0.4 + 0.6 * k);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.stroke();
    g.fillStyle = rgba(hx('#ff6a1a'), 0.12 + 0.25 * k);
    g.fill();
    specks(g, px, py, R * 0.6, 6, STEAMC, 0.5 * k, time, zz.id);
    return true;
  }
  // Столб пара.
  const t = (zz.t - warn) / Math.max(0.1, ((zz as Zone).life ?? 1.2) - warn);
  for (let i = 0; i < 7; i++) {
    const h = i * 6 + ((time * 40) % 6);
    const rr = R * (0.45 + i * 0.08);
    g.fillStyle = rgba(STEAMC, (0.6 - i * 0.07) * (1 - t * 0.6));
    g.beginPath();
    g.arc(Math.round(px + Math.sin(i + time * 5) * 1.5), Math.round(py - h), rr, 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f13_ventburst', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const warn = (zz as Zone).warn ?? 0;
  const R = zz.r * S;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.fillStyle = rgba(hx('#ffb080'), 0.08 + 0.2 * k);
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.fill();
    g.strokeStyle = rgba(STEAMC, 0.4 + 0.6 * k);
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.arc(px, py, R * k, 0, TAU);
    g.stroke();
    return true;
  }
  const t = (zz.t - warn) / Math.max(0.1, ((zz as Zone).life ?? 2) - warn);
  billow(g, px, py, R * (0.8 + t * 0.4), STEAMC, 0.55 * (1 - t), time * 0.8, zz.id, 8, 12);
  return true;
});
