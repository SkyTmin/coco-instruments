// Этаж 3, босс «Алая пасть» — техники (v2.85): метки ударов, зоны и
// снаряды босса. Вынесены из `f3-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { P } from '../dungeon-tiles';
import { hex, mix, Px, TS } from '../dungeon-art';
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
import { Tile } from '../dungeon-world';
import type { WorldObj } from '../dungeon-world';
import { F3_MARK } from './f3';
import type { F3Zone } from './f3-brains';
import { INK, WHITE, cyc, cells, sprite, rgba } from './f3-art';

/** Приземление пасти: тень растёт, кольцо алое, внутри брызги. */
registerZonePainter('f3_splash', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  g.save();
  // Тень падающего тела — растёт к приземлению.
  g.fillStyle = `rgba(20,0,4,${0.18 + 0.4 * k})`;
  g.beginPath();
  g.ellipse(px, py, R * (0.35 + 0.55 * k), R * (0.2 + 0.32 * k), 0, 0, Math.PI * 2);
  g.fill();
  // Кольцо и наливающийся диск.
  g.strokeStyle = `rgba(255,70,50,${0.55 + 0.4 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = `rgba(255,60,40,${0.1 + 0.22 * k})`;
  g.beginPath();
  g.arc(px, py, R * k, 0, Math.PI * 2);
  g.fill();
  // Зубцы по кольцу — как пасть сверху.
  g.fillStyle = `rgba(255,220,200,${0.5 + 0.4 * k})`;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + time * 0.6;
    g.fillRect(Math.round(px + Math.cos(a) * R) - 1, Math.round(py + Math.sin(a) * R) - 1, 2, 2);
  }
  g.restore();
  return true;
});

/** Хлёст хвостом на берегу: кольцо метёт вокруг тела. */
registerZonePainter('f3_thrash', (g, z, px, py, scale) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  g.save();
  g.strokeStyle = `rgba(255,90,60,${0.5 + 0.4 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = `rgba(255,70,40,${0.12 + 0.22 * k})`;
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
  g.closePath();
  g.fill();
  g.restore();
  return true;
});

/** Волна хвоста: конус воды, гребни наливаются от пасти к краю. */
registerZonePainter('f3_wave', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  const R = st.r * scale;
  const a = st.ang ?? 0;
  const h = (st.arc ?? 1) / 2;
  g.save();
  g.fillStyle = `rgba(120,220,230,${0.1 + 0.2 * k})`;
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - h, a + h);
  g.closePath();
  g.fill();
  g.strokeStyle = `rgba(210,255,250,${0.35 + 0.5 * k})`;
  g.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    const r = R * Math.min(1, (i / 4) * (0.35 + 0.65 * k) + ((time * 0.8) % 0.25));
    g.beginPath();
    g.arc(px, py, r, a - h, a + h);
    g.stroke();
  }
  g.strokeStyle = `rgba(255,80,60,${0.5 + 0.4 * k})`;
  g.beginPath();
  g.arc(px, py, R, a - h, a + h);
  g.stroke();
  g.restore();
  return true;
});

/** Прилив: отмели, которые зальёт, заранее блестят водой. */
registerZonePainter('f3_tide', (g, z, px, py, scale, time) => {
  const zz = z as Zone & F3Zone;
  if (!zz.cells || !zz.ww) return true;
  const k = Math.min(1, zz.t / 1.8);
  g.save();
  for (const i of zz.cells) {
    const cx = (i % zz.ww) + 0.5;
    const cy = Math.floor(i / zz.ww) + 0.5;
    const x = px + (cx - zz.x) * scale;
    const y = py + (cy - zz.y) * scale;
    const w = 0.5 + 0.5 * Math.sin(time * 6 + cx * 0.9 + cy * 0.7);
    g.fillStyle = `rgba(80,210,220,${(0.15 + 0.25 * w) * k})`;
    g.fillRect(x - 8, y - 8, 16, 16);
  }
  g.restore();
  return true;
});

registerShotPainter('f3_spit', (s: Shot, time: number) => {
  const f = cyc(time * 10 + s.id, 3);
  return sprite(
    `spit|${f}`,
    () => {
      const p = new Px(10, 10);
      p.ell(5, 5, 3.4 + (f === 1 ? 0.4 : 0), 3.2 - (f === 1 ? 0.3 : 0), hex('#1c6a74'));
      p.ell(4.4, 4.2, 1.8, 1.4, hex('#5ad0cc'));
      p.set(4, 3, WHITE);
      p.set(8 - f, 8, hex('#9ae8e0'));
      p.outline(INK);
      return p;
    },
    5,
    5,
  );
});
