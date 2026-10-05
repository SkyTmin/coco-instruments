// Этаж 12, босс «Двуликий король проклятий» — техники (v2.87): метки ударов, зоны и
// снаряды босса. Вынесены из `f12-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { paintSim, registerZonePainter } from '../dungeon-paint';
import type { Zone } from '../dungeon-sim';
import { F12_FX, KING, f12King } from './f12-brains';
import type { GridView } from './f12-brains';
import {
  hx,
  WHITE,
  TAU,
  PAPER,
  rgba,
  kOf,
  RED,
  CRIMSON,
  SHRINE_W,
  SHRINE_H,
  shrinePx,
  shrineImg,
  fireFrame,
} from './f12-art';
import type { ZX } from './f12-art';

registerZonePainter('f12_grid', (g, z, px, py, S) => {
  const v = (z as ZX).f12 as GridView | undefined;
  const sim = paintSim();
  if (!v || !sim) return true;
  const now = sim.time;
  const warnK = Math.max(0, Math.min(1, 1 - (v.at - now) / KING.gridWarn));
  const cutting = now >= v.at && now < v.at + v.cut;
  if (now >= v.at + v.cut) return true;
  const ks = f12King(sim);
  const wards = ks ? ks.wards : [];
  const R = KING.wardR;
  const sx = (wx: number) => Math.round(px + (wx - z.x) * S);
  const sy = (wy: number) => Math.round(py + (wy - z.y) * S);
  const lines: [boolean, number][] = [];
  for (let x = v.x0 + v.off; x <= v.x1; x += v.step) lines.push([false, x]);
  for (let y = v.y0 + v.off; y <= v.y1; y += v.step) lines.push([true, y]);
  for (const [hz, c] of lines) {
    let segs: [number, number][] = [[hz ? v.x0 : v.y0, hz ? v.x1 : v.y1]];
    for (const w of wards) {
      const d = hz ? Math.abs(w.y - c) : Math.abs(w.x - c);
      if (d >= R) continue;
      const half = Math.sqrt(R * R - d * d);
      const m = hz ? w.x : w.y;
      const out: [number, number][] = [];
      for (const [a, b] of segs) {
        if (m - half > a) out.push([a, Math.min(b, m - half)]);
        if (m + half < b) out.push([Math.max(a, m + half), b]);
      }
      segs = out.filter(([a, b]) => b > a);
    }
    for (const [a, b] of segs) {
      const x0 = hz ? sx(a) : sx(c);
      const y0 = hz ? sy(c) : sy(a);
      const len = hz ? sx(b) - x0 : sy(b) - y0;
      if (cutting) {
        g.fillStyle = rgba(RED, 0.55);
        if (hz) g.fillRect(x0, y0 - 1, len, 3);
        else g.fillRect(x0 - 1, y0, 3, len);
        g.fillStyle = rgba(WHITE, 1);
        if (hz) g.fillRect(x0, y0, len, 1);
        else g.fillRect(x0, y0, 1, len);
      } else {
        g.fillStyle = rgba(RED, 0.18 + 0.6 * warnK);
        if (hz) g.fillRect(x0, y0, len, 1);
        else g.fillRect(x0, y0, 1, len);
        if (warnK > 0.6) {
          g.fillStyle = rgba(RED, (warnK - 0.6) * 0.6);
          if (hz) g.fillRect(x0, y0 - 1, len, 3);
          else g.fillRect(x0 - 1, y0, 3, len);
        }
      }
    }
  }
  return true;
});

registerZonePainter('f12_ward', (g, zz, px, py, S, time) => {
  const z = zz as Zone;
  const k = Math.min(1, z.t / 0.25);
  const a = Math.min(1, (z.life - z.t) / 0.3) * k;
  if (a <= 0) return true;
  const R = z.r * S * (0.4 + 0.6 * k);
  const gold = hx('#ffe08a');
  g.fillStyle = rgba(gold, 0.18 * a);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#fff4c8'), 0.95 * a);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(hx('#ffb030'), 0.6 * a);
  g.beginPath();
  g.arc(px, py, Math.max(1, R - 3), 0, TAU);
  g.stroke();
  // Четыре бумажных печати по кругу.
  for (let i = 0; i < 4; i++) {
    const an = time * 0.8 + (i / 4) * TAU;
    const x = Math.round(px + Math.cos(an) * R);
    const y = Math.round(py + Math.sin(an) * R);
    g.fillStyle = rgba(PAPER[3], a);
    g.fillRect(x - 1, y - 2, 3, 5);
    g.fillStyle = rgba(hx('#c01a2a'), a);
    g.fillRect(x, y, 1, 1);
  }
  return true;
});

registerZonePainter('f12_shrine', (g, _z, px, py, _S, time) => {
  const k = F12_FX.domain;
  if (k <= 0) return true;
  const f = Math.floor(time * 3) % 2;
  if (!shrineImg[f]) shrineImg[f] = shrinePx(f).canvas();
  const img = shrineImg[f];
  // Храм встаёт из пола: сначала крыша, потом пасть.
  const hk = Math.max(1, Math.round(SHRINE_H * k));
  g.drawImage(
    img,
    0,
    0,
    SHRINE_W,
    hk,
    Math.round(px - SHRINE_W / 2),
    Math.round(py - hk),
    SHRINE_W,
    hk,
  );
  return true;
});

registerZonePainter('f12_fire', (g, zz, px, py, S, time) => {
  const z = zz as Zone;
  const a = Math.min(1, (z.life - z.t) / 0.6, z.t / 0.15);
  if (a <= 0) return true;
  g.fillStyle = rgba(hx('#ff6a10'), 0.16 * a);
  g.beginPath();
  g.arc(px, py, z.r * S * 0.8, 0, TAU);
  g.fill();
  g.globalAlpha = a;
  for (let i = 0; i < 2; i++) {
    const f = (Math.floor(time * 10) + z.id + i * 2) % 4;
    const ox = i ? 3 : -5;
    const oy = i ? 2 : 0;
    g.drawImage(fireFrame(f), Math.round(px + ox - 5), Math.round(py + oy - 12));
  }
  g.globalAlpha = 1;
  return true;
});

registerZonePainter('f12_cut', (g, z, px, py, S) => {
  const s = z as ZX;
  const k = kOf(z);
  const L = s.r * S;
  const w = Math.max(2, (s.w ?? 0.36) * S);
  g.save();
  g.translate(px, py);
  g.rotate(s.ang ?? 0);
  g.fillStyle = rgba(RED, 0.08 + 0.22 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(RED, 0.45 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Разрез проступает от короля к концу линии.
  g.fillStyle = rgba(WHITE, 0.4 + 0.6 * k);
  g.fillRect(0, 0, Math.round(L * k), 1);
  g.fillRect(Math.round(L * k) - 2, -1, 3, 3);
  g.restore();
  return true;
});

registerZonePainter('f12_arrow', (g, z, px, py, S) => {
  const s = z as ZX;
  const L = s.r * S;
  const w = Math.max(2, (s.w ?? 1) * S * 0.5);
  g.save();
  g.translate(px, py);
  g.rotate(s.ang ?? 0);
  g.fillStyle = rgba(hx('#ff6a10'), 0.55);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#ffd060'), 0.9);
  g.fillRect(0, -2, L, 4);
  g.fillStyle = rgba(WHITE, 1);
  g.fillRect(0, -1, L, 2);
  g.restore();
  return true;
});

registerZonePainter('f12_pyre', (g, z, px, py, S, time) => {
  const k = kOf(z);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#ff3a10'), 0.08 + 0.25 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = rgba(hx('#ffb040'), 0.5 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Знак огня сжимается к центру; искры поднимаются.
  g.strokeStyle = rgba(hx('#ff6a20'), 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * (1 - 0.6 * k), time * 3, time * 3 + Math.PI * 1.4);
  g.stroke();
  g.fillStyle = rgba(hx('#ffe080'), 0.8 * k);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + z.id;
    const u = (time * 1.4 + i * 0.17) % 1;
    g.fillRect(
      Math.round(px + Math.cos(a) * R * 0.7),
      Math.round(py + Math.sin(a) * R * 0.5 - u * 10 * k),
      1,
      2,
    );
  }
  return true;
});

registerZonePainter('f12_claw', (g, z, px, py, S) => {
  const s = z as ZX;
  const k = kOf(z);
  const R = s.r * S;
  const a = s.ang ?? 0;
  const arc = s.arc ?? 1.9;
  g.fillStyle = rgba(CRIMSON, 0.1 + 0.22 * k);
  g.beginPath();
  g.moveTo(px, py);
  g.arc(px, py, R, a - arc / 2, a + arc / 2);
  g.closePath();
  g.fill();
  // Четыре руки — четыре когтя, дугами.
  g.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const r = R * (0.45 + i * 0.17);
    g.strokeStyle = rgba(i % 2 ? WHITE : hx('#ffb0c0'), 0.3 + 0.6 * k);
    g.beginPath();
    g.arc(px, py, r, a - arc / 2, a - arc / 2 + arc * k);
    g.stroke();
  }
  return true;
});
