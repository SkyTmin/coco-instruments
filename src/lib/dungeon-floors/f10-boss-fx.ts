// Этаж 10, босс «Король демонов» — техники (v2.86): метки ударов, зоны и
// снаряды босса. Вынесены из `f10-art.ts`, чтобы рисунок тела босса (там)
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
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { x72 } from '../dungeon-tiles';
import { F10_GALLERY, F10_GATES, F10_MARK, F10_THRONE } from './f10';
import { F10_FX, GUARD, KING } from './f10-brains';
import { hx, WHITE, TAU, stroke, hash, GOLD, FIRE, rgba, kOf, cone, BLOOD_RED } from './f10-art';
import type { ZoneX } from './f10-art';

registerZonePainter('f10_command', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 0.6);
  const R = z.r * S;
  // Зов трона: красный круг с рогатой короной на помосте — король открыт.
  g.strokeStyle = rgba(BLOOD_RED, 0.5 + 0.4 * Math.sin(time * 10) * 0.5);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.stroke();
  g.beginPath();
  g.arc(px, py, R * k * 0.7, 0, TAU);
  g.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + time * 1.5;
    g.fillStyle = rgba(GOLD[3], 0.9);
    g.fillRect(
      Math.round(px + Math.cos(a) * R * k * 0.85),
      Math.round(py + Math.sin(a) * R * k * 0.85 * 0.6),
      2,
      1,
    );
  }
  return true;
});

registerZonePainter('f10_slash', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2.4;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(BLOOD_RED, 0.14 + 0.3 * k);
  g.fill();
  // Кровавая дуга меча: чем ближе удар, тем ярче кромка.
  g.strokeStyle = rgba(hx('#ff5a3a'), 0.4 + 0.6 * k);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, R - 1, a - arc / 2, a + arc / 2);
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(WHITE, 0.3 + 0.7 * k);
  g.beginPath();
  g.arc(px, py, R * (0.4 + 0.6 * k), a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

registerZonePainter('f10_cleave', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.75) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(BLOOD_RED, 0.14 + 0.32 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#ff5a3a'), 0.6 + 0.4 * k);
  g.fillRect(0, -1, Math.round(L * k), 2);
  g.fillStyle = rgba(WHITE, 0.3 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  g.restore();
  return true;
});

registerZonePainter('f10_rift', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const fade = Math.min(1, ((zz as Zone).life - (zz as Zone).t) / 0.8);
  const a = zz.ang ?? 0;
  const L = (zz.len ?? 4) * S;
  // Трещина от меча в плитах, в ней тлеет.
  g.strokeStyle = rgba(hx('#0a0204'), 0.9 * fade);
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const j = (hash(i, zz.id) - 0.5) * 3;
    const x = px + Math.cos(a) * L * t - Math.sin(a) * j;
    const y = py + Math.sin(a) * L * t + Math.cos(a) * j;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#ff5a1a'), (0.5 + 0.3 * Math.sin(time * 12)) * fade);
  g.stroke();
  return true;
});

registerZonePainter('f10_shock', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(BLOOD_RED, 0.1 + 0.2 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#ffb080'), 0.4 + 0.6 * k);
  g.lineWidth = 1;
  for (const f of [1, 0.66, 0.33]) {
    g.beginPath();
    g.arc(px, py, R * f * (0.5 + 0.5 * k), 0, TAU);
    g.stroke();
  }
  return true;
});

registerZonePainter('f10_shockring', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.strokeStyle = rgba(hx('#ff7a4a'), 0.2 + 0.3 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R * (0.4 + 0.6 * k), 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(WHITE, 0.6 + 0.4 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f10_divemark', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const R = zz.r * S;
  const locked = !zz.follow;
  // Метка пике: тень крыльев над героем; замерла — налилась красным.
  g.fillStyle = rgba(hx('#000000'), locked ? 0.45 : 0.25);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.55, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(locked ? BLOOD_RED : hx('#ffb080'), locked ? 1 : 0.7);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Перекрестье — «сюда».
  const s = locked ? 1 : 0.5 + 0.5 * Math.sin(time * 8);
  g.fillStyle = rgba(WHITE, s);
  g.fillRect(Math.round(px - R), Math.round(py), Math.round(R * 2), 1);
  g.fillRect(Math.round(px), Math.round(py - R * 0.6), 1, Math.round(R * 1.2));
  return true;
});

registerZonePainter('f10_diveland', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(BLOOD_RED, 0.2 + 0.35 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(WHITE, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R * (1 - k * 0.5), 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f10_feather', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  // Перо пламени падает: метка и само перо над ней.
  g.strokeStyle = rgba(hx('#ff7a2a'), 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  const fy = py - (1 - k) * 40;
  g.fillStyle = rgba(FIRE[2], 1);
  g.fillRect(Math.round(px + Math.sin(time * 9) * 2), Math.round(fy) - 3, 2, 4);
  g.fillStyle = rgba(FIRE[3], 1);
  g.fillRect(Math.round(px + Math.sin(time * 9) * 2), Math.round(fy) - 3, 1, 2);
  return true;
});

registerZonePainter('f10_redglow', (g, z, px, py, S, time) => {
  // Отсвет жаровен по полу тронного зала (картинка, без действия).
  const R = z.r * S;
  const a = 0.07 + 0.02 * Math.sin(time * 2);
  const grd = g.createRadialGradient(px, py, R * 0.2, px, py, R);
  grd.addColorStop(0, `rgba(160,20,24,${a.toFixed(3)})`);
  grd.addColorStop(1, 'rgba(160,20,24,0)');
  g.fillStyle = grd;
  g.fillRect(px - R, py - R, R * 2, R * 2);
  return true;
});
