// Этаж 4, босс «Каменный идол» — техники (v2.85): метки ударов, зоны и
// снаряды босса. Вынесены из `f4-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import type { Mob, Shot, Strike, Zone } from '../dungeon-sim';
import type { WorldObj } from '../dungeon-world';
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
import { F4_MARK } from './f4';
import { F4_VIEW, knightGuards } from './f4-brains';
import { ST_G, paintRubble, propSprite, half } from './f4-art';

/** Полоса взора: пока горит метка — наливается алым, по краю бегут засечки. */
registerZonePainter('f4_beam', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / Math.max(0.05, st.warn));
  const len = st.r * scale;
  const hw = (st.w ?? 0.5) * scale;
  const x0 = px;
  const y0 = py - hw;
  const pulse = 0.5 + 0.5 * Math.sin(time * (10 + k * 20));
  g.fillStyle = `rgba(255,60,40,${0.07 + 0.22 * k + (k > 0.8 ? 0.12 * pulse : 0)})`;
  g.fillRect(x0, y0, len, hw * 2);
  g.fillStyle = `rgba(255,120,80,${0.35 + 0.5 * k})`;
  g.fillRect(x0, y0, len, 1);
  g.fillRect(x0, y0 + hw * 2 - 1, len, 1);
  // Засечки бегут от идола к краям — видно, откуда придёт свет.
  g.fillStyle = `rgba(255,210,170,${0.3 + 0.5 * k})`;
  const stepPx = 8;
  const off = (time * 40) % stepPx;
  for (let x = off; x < len; x += stepPx) g.fillRect(Math.round(x0 + x), Math.round(py - 1), 2, 2);
  return true;
});

/** Вспышка взора: белое золото по полосе, гаснет за треть секунды. */
registerZonePainter('f4_flash', (g, z, px, py, scale) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) return true;
  const a = Math.max(0, 1 - (zz.t - warn) / zz.life);
  const hw = (zz.dur ?? 0.5) * scale;
  const len = zz.r * scale;
  g.fillStyle = `rgba(255,236,200,${0.75 * a})`;
  g.fillRect(px, py - hw, len, hw * 2);
  g.fillStyle = `rgba(255,255,255,${0.9 * a})`;
  g.fillRect(px, py - Math.max(1, hw * 0.3), len, Math.max(2, hw * 0.6));
  return true;
});

/** Светлая плита — сюда встать: холодный свет, пульсирующий кант. */
registerZonePainter('f4_plate', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const half = zz.r * scale;
  const pulse = 0.5 + 0.5 * Math.sin(time * 6 + zz.id);
  g.fillStyle = `rgba(200,235,255,${0.28 + 0.2 * pulse})`;
  g.fillRect(px - half, py - half, half * 2, half * 2);
  g.strokeStyle = `rgba(235,250,255,${0.7 + 0.3 * pulse})`;
  g.lineWidth = 1;
  g.strokeRect(
    Math.round(px - half) + 0.5,
    Math.round(py - half) + 0.5,
    half * 2 - 1,
    half * 2 - 1,
  );
  // Столб света над плитой — видно издалека.
  g.fillStyle = `rgba(210,240,255,${0.12 + 0.08 * pulse})`;
  g.fillRect(px - half * 0.6, py - half - scale * 1.2, half * 1.2, scale * 1.2);
  return true;
});

/**
 * Страж собирается заново: груда на постаменте. Последние полторы секунды
 * дрожит и загораются глаза — видно, что сейчас встанет.
 */
registerZonePainter('f4_reform', (g, z, px, py, scale, time) => {
  const zz = z as Zone;
  const sp = propSprite('reform', () => paintRubble(false), ST_G);
  const left = zz.life - zz.t;
  const k = Math.max(0, 1.5 - left) / 1.5;
  const shake = k > 0 ? Math.round(Math.sin(time * 45) * (0.5 + k)) : 0;
  const x = Math.round(px - sp.ax + shake);
  const y = Math.round(py + scale / 2 - 6 - sp.ay);
  g.drawImage(sp.img, x, y);
  if (k > 0) {
    // Глаза в груде: голова лежит на боку слева.
    g.fillStyle = `rgba(255,70,40,${0.4 + 0.6 * k})`;
    g.fillRect(x + 2, y + ST_G - 5, 1, 1);
    g.fillRect(x + 4, y + ST_G - 5, 1, 1);
  }
  return true;
});

/** Кара: столб света падает на того, кто нарушил заповедь. */
registerZonePainter('f4_wrath', (g, z, px, py, scale) => {
  const zz = z as Zone;
  const a = Math.max(0, 1 - zz.t / zz.life);
  const w = scale * 0.9 * (0.6 + 0.4 * a);
  g.fillStyle = `rgba(255,220,150,${0.55 * a})`;
  g.fillRect(px - w / 2, py - scale * 4, w, scale * 4.2);
  g.fillStyle = `rgba(255,255,240,${0.8 * a})`;
  g.fillRect(px - w / 5, py - scale * 4, (w * 2) / 5, scale * 4.2);
  g.fillStyle = `rgba(255,160,60,${0.4 * a})`;
  g.beginPath();
  g.ellipse(px, py, scale, scale * 0.45, 0, 0, Math.PI * 2);
  g.fill();
  return true;
});

/** Удар рукой идола: тень ладони растёт, кант алый. */
registerZonePainter('f4_slam', (g, z, px, py, scale) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / Math.max(0.05, st.warn));
  const r = st.r * scale;
  g.fillStyle = `rgba(10,8,6,${0.2 + 0.35 * k})`;
  g.beginPath();
  g.ellipse(px, py, r * (0.4 + 0.6 * k), r * 0.55 * (0.4 + 0.6 * k), 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = `rgba(255,70,50,${0.4 + 0.5 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.ellipse(px, py, r, r * 0.55, 0, 0, Math.PI * 2);
  g.stroke();
  return true;
});
