// Этаж 11, босс «Древний страж» — техники (v2.87): метки ударов, зоны и
// снаряды босса. Вынесены из `f11-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { Px } from '../dungeon-art';
import { paintSim, registerShotPainter, registerZonePainter } from '../dungeon-paint';
import type { Zone } from '../dungeon-sim';
import { hx, alpha, TAU, TS, hash, tn, limb, ink, sprite, beamFx } from './f11-art';

registerZonePainter('f11_beamfx', (g, z, px, py) => {
  beamFx(g, z as Zone, px, py, 5, 'rgba(255,255,245,1)', 'rgba(255,70,40,0.75)');
  return true;
});

/** Пар из решётки: метка — дрожание, потом столб пара. */
registerZonePainter('f11_steam', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.strokeStyle = `rgba(255,140,90,${0.4 + 0.5 * k})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, zz.r * TS, 0, TAU);
    g.stroke();
    g.fillStyle = 'rgba(255,220,200,0.7)';
    for (let i = 0; i < 3; i++)
      g.fillRect(Math.round(px - 4 + i * 4), Math.round(py - 2 - ((time * 20 + i * 3) % 6)), 1, 1);
    return true;
  }
  const k = (zz.t - warn) / zz.life;
  g.globalAlpha = 0.7 * (1 - k * 0.8);
  g.fillStyle = '#f4f0ee';
  for (let i = 0; i < 8; i++) {
    const t = (time * 1.4 + i * 0.13) % 1;
    const r = 3 + t * 7;
    g.beginPath();
    g.arc(px + Math.sin(time * 3 + i) * 3, py - t * 30, r, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return true;
});

/** Лужа огня от ракеты. */
registerZonePainter('f11_scorch', (g, z, px, py, _s, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / zz.life);
  g.fillStyle = `rgba(40,30,30,${0.4 * (1 - k)})`;
  g.beginPath();
  g.ellipse(px, py, zz.r * TS, zz.r * TS * 0.6, 0, 0, TAU);
  g.fill();
  g.fillStyle = `rgba(255,140,50,${0.8 * (1 - k)})`;
  for (let i = 0; i < 6; i++) {
    const a = i + time * 2;
    const r = zz.r * TS * 0.6 * hash(i, 3, 441);
    g.fillRect(
      Math.round(px + Math.cos(a) * r),
      Math.round(py + Math.sin(a) * r * 0.6 - ((time * 12 + i * 4) % 5)),
      1,
      2,
    );
  }
  return true;
});

/** Лучи пилонов к стражу — купол держится ими. */
registerZonePainter('f11_pylonbeam', (g, z, px, py, _s, time) => {
  const sim = paintSim();
  if (!sim) return true;
  const zz = z as Zone & { pylon?: number };
  const pylon = sim.mobs.find((m) => m.id === zz.pylon && m.mode !== 'dying');
  const boss = sim.mobs.find((m) => m.kind === 'f11boss' && m.mode !== 'dying');
  if (!pylon || !boss) return true;
  const sx = px + (pylon.x - z.x) * TS;
  const sy = py + (pylon.y - z.y) * TS - 14;
  const ex = px + (boss.x - z.x) * TS;
  const ey = py + (boss.y - z.y) * TS - 22;
  const n = Math.ceil(Math.hypot(ex - sx, ey - sy));
  for (let i = 0; i < n; i += 1) {
    const t = i / n;
    const wob = Math.sin(t * 20 - time * 14) * 1.2;
    const x = sx + (ex - sx) * t - ((ey - sy) / n) * wob;
    const y = sy + (ey - sy) * t + ((ex - sx) / n) * wob;
    g.fillStyle =
      (i + Math.floor(time * 40)) % 5 === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(120,220,255,0.7)';
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  return true;
});

registerShotPainter('f11_rocket', (s, time) => {
  const a = Math.atan2(s.vy - (s.lob ? 1 : 0), s.vx);
  const q = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  const f = Math.floor(time * 16) % 2;
  return sprite(`rocket|${q}|${f}`, () => {
    const p = new Px(14, 14);
    const dx = Math.cos((q * TAU) / 8);
    const dy = Math.sin((q * TAU) / 8);
    // Пламя сзади.
    for (let k = 2; k < 6 + f; k++) {
      const x = 7 - dx * k;
      const y = 7 - dy * k;
      p.set(
        Math.round(x),
        Math.round(y),
        k < 4 ? hx('#fff0a0') : alpha(hx('#ff8a3a'), 1 - (k - 3) * 0.2),
      );
    }
    limb(
      p,
      7 - dx * 2,
      7 - dy * 2,
      7 + dx * 3,
      7 + dy * 3,
      1.5,
      1.2,
      tn('#4a4a50', '#7a7a84', '#aaaab4', '#dcdce4'),
    );
    p.set(Math.round(7 + dx * 3.5), Math.round(7 + dy * 3.5), hx('#e84a3a'));
    return { p: ink(p), ax: 7, ay: 7 };
  });
});
