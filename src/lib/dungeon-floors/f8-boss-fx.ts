// Этаж 8, босс «Демон семи лун» — техники (v2.86): метки ударов, зоны и
// снаряды босса. Вынесены из `f8-art.ts`, чтобы рисунок тела босса (там)
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
import { F8_HALLS, F8_LOWER, F8_MARK, F8_MOON } from './f8';
import { doorOpen, F8_CLOCK } from './f8-brains';
import { hx, TAU, stroke, cached, spr, crescentArc } from './f8-art';

/** Веер полумесяцев: конус бледно, на его краю — серп. */
registerZonePainter('f8_crescent', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  const R = z.r * S;
  const a = z.ang ?? 0;
  const h = (z.arc ?? 0.3) / 2;
  g.fillStyle = `rgba(190,150,255,${0.08 + 0.2 * k})`;
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - h, a + h);
  g.closePath();
  g.fill();
  crescentArc(g, px, py, R, a - h * 1.15, a + h * 1.15, k, k > 0.8 ? '255,250,210' : '230,200,255');
  return true;
});

/** Рез вплотную — широкий конус, серп по краю. */
registerZonePainter('f8_sweep', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  const R = z.r * S;
  const a = z.ang ?? 0;
  const h = (z.arc ?? 2) / 2;
  g.fillStyle = `rgba(255,90,70,${0.12 + 0.28 * k})`;
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - h, a + h);
  g.closePath();
  g.fill();
  crescentArc(g, px, py, R, a - h, a + h, k, '255,230,200');
  return true;
});

/** След выпада: линия с отставшими серпами. */
registerZonePainter('f8_trail', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  const L = z.r * S;
  const w = (z.w ?? 0.5) * S;
  g.fillStyle = `rgba(200,160,255,${0.15 + 0.35 * k})`;
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = `rgba(255,245,210,${0.5 + 0.5 * k})`;
  for (let x = 4; x < L; x += 9) {
    g.fillRect(Math.round(x), -2, 2, 1);
    g.fillRect(Math.round(x) + 1, -1, 2, 2);
    g.fillRect(Math.round(x), 1, 2, 1);
  }
  g.restore();
  return true;
});

/** Шесть глаз: длинная метка с глазом посередине; бьёт позже. */
registerZonePainter('f8_eyeslash', (g, z0, px, py, S, time) => {
  const z = z0 as Strike & { eye?: number };
  const k = Math.min(1, z.t / z.warn);
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  const L = z.r * S;
  const w = (z.w ?? 0.5) * S;
  g.fillStyle = `rgba(255,200,80,${0.08 + 0.3 * k})`;
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = `rgba(255,240,180,${0.35 + 0.6 * k})`;
  g.fillRect(0, 0, L, 1);
  // Глаз: открывается к удару, зрачок — золотая щель.
  const ex = L * 0.5;
  const open = Math.min(1, k * 1.4);
  g.fillStyle = `rgba(20,10,30,${0.6 + 0.3 * k})`;
  g.fillRect(Math.round(ex - 4), -Math.round(2 * open) - 1, 8, Math.round(4 * open) + 2);
  g.fillStyle = k > 0.85 && Math.floor(time * 16) % 2 ? '#ffffff' : '#ffd84a';
  g.fillRect(Math.round(ex - 1), -Math.round(open), 2, Math.round(2 * open) + 1);
  g.restore();
  return true;
});

/** Дуга кольца: кусок полумесяца на окружности вокруг босса. */
registerZonePainter('f8_arc', (g, z0, px, py, S) => {
  const z = z0 as Strike & { ang0: number; R: number; cx: number; cy: number };
  const k = Math.min(1, z.t / z.warn);
  const cx = px + (z.cx - z.x) * S;
  const cy = py + (z.cy - z.y) * S;
  const half = 0.5 / Math.max(1, z.R);
  const R = z.R * S;
  g.strokeStyle = `rgba(200,170,255,${0.2 + 0.3 * k})`;
  g.lineWidth = Math.max(2, z.r * S * 1.6 * (0.5 + 0.5 * k));
  g.beginPath();
  g.arc(cx, cy, R, z.ang0 - half * 1.05, z.ang0 + half * 1.05);
  g.stroke();
  g.strokeStyle = k > 0.85 ? 'rgba(255,250,215,0.95)' : `rgba(240,220,255,${0.5 + 0.4 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(cx, cy, R + 1, z.ang0 - half * 1.05, z.ang0 + half * 1.05);
  g.stroke();
  return true;
});

/** Луч луны через арену. */
registerZonePainter('f8_moonray', (g, z0, px, py, S) => {
  const z = z0 as Strike;
  const k = Math.min(1, z.t / z.warn);
  g.save();
  g.translate(px, py);
  g.rotate(z.ang ?? 0);
  const L = z.r * S;
  const w = (z.w ?? 0.4) * S;
  g.fillStyle = `rgba(200,215,255,${0.08 + 0.25 * k})`;
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = `rgba(245,248,255,${0.3 + 0.7 * k})`;
  g.fillRect(0, 0, L, k > 0.8 ? 2 : 1);
  g.restore();
  return true;
});

/** Глаз на полу арены («шесть глаз»): смотрит, моргает. */
registerZonePainter('f8_floor_eye', (g, z0, px, py, S, time) => {
  const z = z0 as Zone;
  const blink = Math.floor(time * 2 + z.id) % 9 === 0;
  const rx = z.r * S;
  g.fillStyle = 'rgba(20,10,30,0.55)';
  g.beginPath();
  g.ellipse(px, py, rx, rx * 0.45, 0, 0, TAU);
  g.fill();
  if (blink) return true;
  g.fillStyle = 'rgba(255,216,74,0.85)';
  g.beginPath();
  g.ellipse(px, py, rx * 0.55, rx * 0.35, 0, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(30,10,20,0.95)';
  g.fillRect(Math.round(px - 1), Math.round(py - rx * 0.3), 2, Math.round(rx * 0.6));
  return true;
});

/** Летящий серп: полумесяц, повёрнутый по ходу. */
registerShotPainter('f8_serp', (s: Shot) => {
  const a = Math.atan2(s.vy, s.vx);
  const q = ((Math.round((a / TAU) * 16) % 16) + 16) % 16;
  return cached(`serp|${q}`, () => {
    const p = new Px(15, 15);
    const ang = (q / 16) * TAU;
    // Полумесяц выпуклостью вперёд: внешний круг минус сдвинутый назад.
    for (let y = 0; y < 15; y++)
      for (let x = 0; x < 15; x++) {
        const dx = x + 0.5 - 7.5;
        const dy = y + 0.5 - 7.5;
        const outer = Math.hypot(dx, dy) < 6.2;
        const bx = dx + Math.cos(ang) * 2.6;
        const by = dy + Math.sin(ang) * 2.6;
        const inner = Math.hypot(bx, by) < 5.6;
        if (outer && !inner) {
          const edge = Math.hypot(dx, dy) > 5.2;
          p.set(x, y, edge ? hx('#fff6d8') : hx('#c8a8ff'));
        }
      }
    return spr(p, 7.5, 7.5);
  });
});
