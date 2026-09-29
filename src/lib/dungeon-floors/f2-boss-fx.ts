// Этаж 2, босс «Живые доспехи» — техники (v2.85): метки ударов, зоны и
// снаряды босса. Вынесены из `f2-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { x72 } from '../dungeon-tiles';
import { hex, mix, Px, TS } from '../dungeon-art';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import type { X72Name } from '../dungeon-x72-frames';
import { F2_GROT, F2_RUIN, MK } from './f2';
import { TAU, rgba } from './f2-art';

/** Взмах меча: стальной веер, по краю — светлая дуга клинка. */
registerZonePainter('f2_sword', (g, z, px, py, scale) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  const a = st.ang ?? 0;
  const h = (st.arc ?? 1) / 2;
  const S = hex('#c8d4e8');
  g.fillStyle = rgba(hex('#ff5a3a'), 0.12 + 0.22 * k);
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - h, a + h);
  g.closePath();
  g.fill();
  // Кромка наливается от края к краю — куда пройдёт клинок.
  g.strokeStyle = rgba(S, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, a - h, a - h + 2 * h * k);
  g.stroke();
  return true;
});

/** Прыжок лат: круг с трещинами — сюда рухнут. */
registerZonePainter('f2_leap', (g, z, px, py, scale) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  g.fillStyle = rgba(hex('#ff5a3a'), 0.1 + 0.25 * k);
  g.beginPath();
  g.arc(px, py, R * k, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hex('#ff8a5a'), 0.6 + 0.3 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(hex('#2a1a14'), 0.5 * k);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + 0.3;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3);
    g.lineTo(px + Math.cos(a) * R * k * 0.9, py + Math.sin(a) * R * k * 0.9);
    g.stroke();
  }
  return true;
});
