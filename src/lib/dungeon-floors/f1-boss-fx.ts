// Этаж 1, босс «Крысиный король» — техники (v2.85): метки ударов, зоны и
// снаряды босса. Вынесены из `f1-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { blit, floorCell } from '../dungeon-tiles';
import { hex, Px, TS } from '../dungeon-art';
import { ratEye, ratPx, ratSize, RAT_FRAMES, spline } from '../dungeon-rats';
import type { RatAnim } from '../dungeon-rats';
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
import { F1, F1_MARK } from './f1';
import { MAP_HAUL, MAP_MOUTH } from './f1-map';
import { INK, METAL, blade, cachedSprite } from './f1-art';

/** Волна после прыжка короля: кольцо с пылью. */
registerZonePainter('f1_shock', (g, z, px, py, scale) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  const w = (st.w ?? 0.5) * scale;
  g.strokeStyle = `rgba(255,120,60,${0.2 + 0.4 * k})`;
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R * (0.4 + 0.6 * k), 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = `rgba(255,220,160,${0.5 + 0.4 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, Math.PI * 2);
  g.stroke();
  return true;
});

/** Брошенный тесак короля на полу. */
registerZonePainter('f1_cleaver', (g, _z, px, py) => {
  const sp = cachedSprite('cleaver-floor', () => {
    const p = new Px(22, 12);
    blade(p, [3, 7], -0.15, { grip: 3, len: 12, w: 6, metal: METAL.steel, kind: 'cleaver' });
    p.outline(INK);
    return { img: p.canvas(), ax: 11, ay: 6 };
  });
  g.drawImage(sp.img, Math.round(px - sp.ax), Math.round(py - sp.ay));
  return true;
});
