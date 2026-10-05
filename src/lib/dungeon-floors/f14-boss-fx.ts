// Этаж 14, босс «Повелитель часа» — техники (v2.87): метки ударов, зоны и
// снаряды босса. Вынесены из `f14-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { registerZonePainter } from '../dungeon-paint';
import { F14_FX } from './f14-brains';
import { hx, INK, TAU, TEAL, SAND, TEAL_GLOW, rgba, kOf, lifeK, cone, RED, HOT } from './f14-art';
import type { ZoneX } from './f14-art';

/** Отмотка Повелителя: кольцо песка течёт к центру, против часовой. */
registerZonePainter('f14_glassring', (g, z, px, py, S) => {
  const R = z.r * S;
  const t = F14_FX.clock;
  const k = lifeK(z as ZoneX);
  g.strokeStyle = rgba(TEAL_GLOW, 0.5);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Сектор — сколько времени у тебя осталось.
  g.fillStyle = rgba(TEAL[2], 0.14);
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - k));
  g.closePath();
  g.fill();
  for (let i = 0; i < 18; i++) {
    const a = -(i / 18) * TAU - t * 1.4;
    const rr = R * (1 - ((i * 0.37 + t * 0.8) % 1));
    g.fillStyle = rgba(i % 3 ? SAND[3] : TEAL_GLOW, 0.8);
    g.fillRect(Math.round(px + Math.cos(a) * rr), Math.round(py + Math.sin(a) * rr), 1, 1);
  }
  return true;
});

/** Часовая Повелителя: тяжёлый конус, по нему проходит тень стрелки. */
registerZonePainter('f14_lordhour', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.9;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(RED, 0.14 + 0.3 * k);
  g.fill();
  g.strokeStyle = rgba(RED, 0.7 + 0.3 * k);
  g.lineWidth = 1;
  g.stroke();
  // Тень стрелки ползёт от края к краю.
  const sa = a - arc / 2 + arc * k;
  g.strokeStyle = rgba(INK, 0.55);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(px, py);
  g.lineTo(px + Math.cos(sa) * R, py + Math.sin(sa) * R);
  g.stroke();
  return true;
});

/** Разворот стрелок: кольцо, по нему бегут два клинка. */
registerZonePainter('f14_lordspin', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const w = (zz.w ?? 0.72) * S;
  g.strokeStyle = rgba(RED, 0.16 + 0.3 * k);
  g.lineWidth = w * 2;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(RED, 0.7);
  g.lineWidth = 1;
  for (const rr of [R - w, R + w]) {
    g.beginPath();
    g.arc(px, py, rr, 0, TAU);
    g.stroke();
  }
  for (let i = 0; i < 2; i++) {
    const a = k * TAU * 1.5 + i * Math.PI;
    g.strokeStyle = rgba(HOT, 0.9);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py, R, a - 0.4, a);
    g.stroke();
  }
  return true;
});

/**
 * Двенадцатый удар: темнеет вся арена, кроме ступицы. Ступица светится —
 * куда бежать, видно сразу; двенадцать лучей часов по полу.
 */
registerZonePainter('f14_midnight', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = z.r * S;
  const w = (zz.w ?? 4.5) * S;
  const inner = R - w;
  const outer = R + w;
  g.fillStyle = rgba(hx('#2a0a3a'), 0.25 + 0.4 * k);
  g.beginPath();
  g.arc(px, py, outer, 0, TAU);
  g.arc(px, py, inner, 0, TAU, true);
  g.fill('evenodd');
  g.strokeStyle = rgba(RED, 0.6 + 0.4 * k);
  g.lineWidth = 1;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * inner, py + Math.sin(a) * inner);
    g.lineTo(
      px + Math.cos(a) * (inner + (outer - inner) * k),
      py + Math.sin(a) * (inner + (outer - inner) * k),
    );
    g.stroke();
  }
  // Спасение — ступица: белое кольцо пульсирует.
  g.strokeStyle = rgba(hx('#dfe8ff'), 0.7 + 0.3 * Math.sin(k * 30));
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px, py, inner - 2, 0, TAU);
  g.stroke();
  return true;
});
