// Этаж 5, босс «Минотавр» — техники (v2.85): метки ударов, зоны и
// снаряды босса. Вынесены из `f5-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { Px } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { F5_ARENA, F5_MARK, F5_MAZE } from './f5';
import { TAU, stroke, hash, rgba, cone, kOf } from './f5-art';
import type { ZoneX } from './f5-art';

registerZonePainter('f5_axe', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2.3;
  cone(g, px, py, R, a, arc);
  g.fillStyle = `rgba(160,20,10,${(0.16 + 0.3 * k).toFixed(3)})`;
  g.fill();
  // Трещины по полу к краю удара.
  g.strokeStyle = `rgba(40,6,4,${(0.4 + 0.5 * k).toFixed(3)})`;
  g.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const aa = a - arc / 2 + ((i + 0.5) / 5) * arc;
    g.beginPath();
    g.moveTo(px + Math.cos(aa) * R * 0.3, py + Math.sin(aa) * R * 0.3);
    g.lineTo(
      px + Math.cos(aa + 0.08) * R * (0.3 + 0.7 * k),
      py + Math.sin(aa + 0.08) * R * (0.3 + 0.7 * k),
    );
    g.stroke();
  }
  g.strokeStyle = `rgba(255,${Math.round(90 + 120 * k)},60,${(0.5 + 0.5 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.stroke();
  return true;
});

registerZonePainter('f5_whirl', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = `rgba(170,20,10,${(0.12 + 0.28 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  // Кольцо из штрихов крутится — видно, что сейчас пойдёт вкруговую.
  g.strokeStyle = `rgba(255,200,120,${(0.4 + 0.6 * k).toFixed(3)})`;
  g.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    const a0 = time * 6 * (0.5 + k) + (i / 8) * TAU;
    g.beginPath();
    g.arc(px, py, R, a0, a0 + 0.4);
    g.stroke();
  }
  return true;
});

registerZonePainter('f5_roar', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = `rgba(255,220,90,${(0.08 + 0.18 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  // Волны рёва сходятся к быку — круг оглушения.
  g.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const t = 1 - ((time * 1.8 + i / 3) % 1);
    g.strokeStyle = `rgba(255,236,140,${(0.25 + 0.5 * k * t).toFixed(3)})`;
    g.beginPath();
    g.arc(px, py, R * t, 0, TAU);
    g.stroke();
  }
  g.strokeStyle = `rgba(255,240,160,${(0.6 + 0.4 * k).toFixed(3)})`;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f5_rift', (g, z, px, py, S, time) => {
  const zz = z as Zone & { ang?: number };
  const warn = zz.warn ?? 0;
  const life = zz.life;
  const on = zz.t >= warn;
  const fade = Math.min(1, (warn + life - zz.t) / 0.8);
  const a = (zz.ang ?? 0) + Math.PI / 2;
  const L = zz.r * S * 1.3;
  // Трещина поперёк удара.
  g.strokeStyle = `rgba(20,4,2,${(0.9 * fade).toFixed(3)})`;
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const k = i / 6 - 0.5;
    const j = (hash(i, zz.id) - 0.5) * 3;
    const x = px + Math.cos(a) * L * k * 2 + Math.cos(a + Math.PI / 2) * j;
    const y = py + Math.sin(a) * L * k * 2 + Math.sin(a + Math.PI / 2) * j;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.stroke();
  if (!on) return true;
  // Огонь в трещине.
  for (let i = 0; i < 5; i++) {
    const k = i / 4 - 0.5;
    const x = px + Math.cos(a) * L * k * 1.8;
    const y = py + Math.sin(a) * L * k * 1.8;
    const h = 3 + ((time * 9 + i * 1.7) % 3);
    g.fillStyle = `rgba(255,120,30,${(0.8 * fade).toFixed(3)})`;
    g.fillRect(Math.round(x) - 1, Math.round(y - h), 2, Math.round(h));
    g.fillStyle = `rgba(255,230,120,${(0.9 * fade).toFixed(3)})`;
    g.fillRect(Math.round(x), Math.round(y - h + 1), 1, Math.round(h * 0.6));
  }
  return true;
});
