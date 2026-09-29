// Этаж 7, босс «Отражение героя» — техники (v2.86): метки ударов, зоны и
// снаряды босса. Вынесены из `f7-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { Px } from '../dungeon-art';
import { heroSprite } from '../dungeon-sprites';
import type { Dir4 } from '../dungeon-sprites';
import { floorCell, wallCell } from '../dungeon-tiles';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Sim, Strike, Zone } from '../dungeon-sim';
import { F7_CRYSTAL, F7_GALLERY, F7_HALL, F7_MARK } from './f7';
import { F7_VIEW } from './f7-brains';
import { TAU, TS, MAP_W, zk } from './f7-art';
import type { ZoneX } from './f7-art';

// Тень настоящего Отражения: длинная, от люстры (в фазе теней свет только там).
registerZonePainter('f7_trueshadow', (g, z0, px, py) => {
  const z = z0 as ZoneX;
  const sim = z.sim as Sim | undefined;
  const m = sim?.mobs.find((q) => q.id === z.mob);
  if (!m || (m.data.ghost ?? 0) > 0 || m.mode === 'dying') return true;
  const lx = z.lx as number;
  const ly = z.ly as number;
  const a = Math.atan2(m.y - ly, m.x - lx);
  const d = Math.hypot(m.x - lx, m.y - ly);
  const len = (1.8 + d * 0.22) * TS;
  g.save();
  g.translate(Math.round(px), Math.round(py + 2));
  g.rotate(a);
  // Силуэт тени: ноги у тела, к концу — голова и плечи.
  g.fillStyle = 'rgba(4,2,10,0.62)';
  g.beginPath();
  g.moveTo(0, -3);
  g.lineTo(len * 0.7, -5);
  g.lineTo(len * 0.86, -3.5);
  g.lineTo(len, -2);
  g.lineTo(len, 2);
  g.lineTo(len * 0.86, 3.5);
  g.lineTo(len * 0.7, 5);
  g.lineTo(0, 3);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(len * 0.93, 0, 4, 3.5, 0, 0, TAU);
  g.fill();
  g.restore();
  return true;
});

registerZonePainter('f7_gazeflash', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const k = zk(z);
  const a = (z.ang as number) ?? 0;
  g.fillStyle = `rgba(190,150,255,${0.45 * (1 - k)})`;
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, (z.r as number) * S, a - 0.45, a + 0.45);
  g.closePath();
  g.fill();
  return true;
});

// Зеркало арены вспыхивает перед залпом осколков.
registerZonePainter('f7_mirrorglow', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const mi = z.mi as number;
  const k = zk(z);
  const x = (mi % MAP_W) * S;
  const y = Math.floor(mi / MAP_W) * S;
  const ox = px - (z.x as number) * S;
  const oy = py - (z.y as number) * S;
  const flick = 0.35 + 0.55 * k * (0.7 + 0.3 * Math.sin(k * 40));
  g.fillStyle = `rgba(230,210,255,${flick})`;
  g.fillRect(Math.round(x + ox) + 2, Math.round(y + oy) + 2, S - 4, S - 4);
  return true;
});

// Линия осколков арены: метка — красная полоса, по ней — осколки, густеют.
registerZonePainter('f7_shardline', (g, z0, px, py, S) => {
  const z = z0 as ZoneX;
  const k = zk(z);
  const a = (z.ang as number) ?? 0;
  const len = (z.r as number) * S;
  const hw = ((z.w as number) ?? 0.4) * S;
  g.save();
  g.translate(px, py);
  g.rotate(a);
  g.fillStyle = `rgba(255,60,50,${0.15 + 0.3 * k})`;
  g.fillRect(0, -hw, len, hw * 2);
  g.fillStyle = `rgba(255,120,110,${0.5 * k})`;
  g.fillRect(0, -hw, len, 1);
  g.fillRect(0, hw - 1, len, 1);
  const n = Math.floor((len / 6) * k);
  for (let i = 0; i < n; i++) {
    const x = (i * 6 + ((k * 40) % 6)) % len;
    g.fillStyle = i % 2 ? 'rgba(220,245,255,0.9)' : 'rgba(150,200,240,0.9)';
    g.fillRect(Math.round(x), Math.round(Math.sin(i * 1.7) * hw * 0.5), 2, 1);
  }
  g.restore();
  return true;
});
