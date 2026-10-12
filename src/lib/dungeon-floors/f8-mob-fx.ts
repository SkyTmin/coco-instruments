// Этаж 8 — контакты ударов мобов (анимации мобов 8). Второй слой контакта:
// кадр моба рисует сам удар (руки, когти, палки), а здесь — то, что удар
// оставляет на полу в миг урона: борозды, отпечаток ладоней, волна, рвущаяся
// нить, длинная рука хватки, вспышка снаряда фонаря. Метки (до удара) — в
// `f8-art.ts`, зоны `f8_palm`…`f8_claws`.
//
// Рисуется пикселями `fillRect` в мировых пикселях кадра (S = 16 на клетку);
// случайности нет — только `rec.seed` и номер частицы.

import { Px } from '../dungeon-art';
import { registerImpactPainter, registerShotPainter, registerZonePainter } from '../dungeon-paint';
import type { ImpactRec, Sprite } from '../dungeon-paint';
import type { Zone } from '../dungeon-sim';
import { clamp01, easeIn, easeOut, hash, hx, mixc, PI, TAU, type RGBA } from './f8-mobkit';

const px1 = (g: CanvasRenderingContext2D, x: number, y: number, w = 1, h = 1) =>
  g.fillRect(Math.round(x), Math.round(y), w, h);
const rgba = (c: string, a: number) => {
  const v = parseInt(c.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${clamp01(a).toFixed(3)})`;
};

/** Отрезок по пикселям. */
function seg(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) px1(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n);
}

// ---- Глазастые сёдзи: когти в пол на конце линии --------------------------------------------

registerImpactPainter('f8_claws', {
  life: 0.55,
  shake: 0.12,
  paint(g, rec: ImpactRec, px, py, S, age) {
    const a = rec.ang ?? PI / 2;
    const L = (rec.r ?? 3.55) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const tx = px + ux * (L - 1);
    const ty = py + uy * (L - 1);
    // Борозды: когти скребут к стене (кадр моба тянет руки назад).
    const drag = 3 + 7 * easeOut(age / 0.4);
    const fade = 1 - clamp01((age - 0.3) / 0.25);
    for (let s = -1; s <= 1; s += 2)
      for (let c = -1; c <= 1; c++) {
        const ox = tx + nx * (s * 3 + c * 1.2);
        const oy = ty + ny * (s * 3 + c * 1.2);
        g.fillStyle = rgba('#2a0c10', 0.75 * fade);
        seg(g, ox, oy, ox - ux * drag, oy - uy * drag);
        if (age < 0.12) {
          g.fillStyle = rgba('#fff0e8', 1 - age / 0.12);
          px1(g, ox, oy);
        }
      }
    // Миг удара: вспышка пятном и пыль кольцом.
    if (age < 0.07) {
      g.fillStyle = rgba('#ffffff', 0.9);
      px1(g, tx - 2, ty - 1, 5, 3);
    }
    const R = 3 + 10 * easeOut(age / 0.35);
    g.fillStyle = rgba('#d8c8b0', 0.55 * (1 - age / 0.35));
    if (age < 0.35)
      for (let i = 0; i < 10; i++) {
        const t = (i / 10) * TAU + hash(i, rec.seed) * 0.4;
        px1(g, tx + Math.cos(t) * R, ty + Math.sin(t) * R * 0.6);
      }
    // Клочки бумаги, сорванные с рук, кружат и падают.
    for (let i = 0; i < 5; i++) {
      const k = clamp01(age / 0.55);
      const sx = tx + (hash(i, rec.seed + 3) - 0.5) * 14 + Math.sin(age * 9 + i) * 2;
      const sy = ty - 10 + k * 12 + hash(i, rec.seed + 5) * 4;
      g.fillStyle = rgba(i % 2 ? '#fff6d8' : '#d8c690', 0.9 * (1 - k));
      px1(g, sx, sy, i % 3 ? 1 : 2, 1);
    }
    return true;
  },
});

// ---- Многорукий: ладони звезды и длинная рука хватки ----------------------------------------

registerImpactPainter('f8_palm', {
  life: 0.4,
  shake: 0.1,
  paint(g, rec, px, py, S, age) {
    const a = rec.ang ?? 0;
    const R = (rec.r ?? 2) * S;
    const k = clamp01(age / 0.4);
    // Отпечаток ладони на конце луча: пятерня и волна дугой.
    const d = R * (0.7 + 0.25 * easeOut(k));
    const cx = px + Math.cos(a) * d;
    const cy = py + Math.sin(a) * d;
    g.fillStyle = rgba(age < 0.06 ? '#ffffff' : '#ffb070', 0.9 * (1 - k));
    px1(g, cx - 1, cy - 1, 3, 3);
    for (let i = -2; i <= 2; i++) {
      const fa = a + i * 0.38;
      const L = 3 + (i === 0 ? 2 : 1) + 3 * easeOut(k);
      seg(g, cx + Math.cos(fa) * 2, cy + Math.sin(fa) * 2, cx + Math.cos(fa) * L, cy + Math.sin(fa) * L);
    }
    g.fillStyle = rgba('#ff7a3a', 0.7 * (1 - k));
    const h = (rec.arc ?? 0.5) / 2;
    for (let i = 0; i <= 8; i++) {
      const t = a - h + (i / 8) * h * 2;
      px1(g, px + Math.cos(t) * (R * 0.5 + R * 0.6 * easeOut(k)), py + Math.sin(t) * (R * 0.5 + R * 0.6 * easeOut(k)));
    }
    return true;
  },
});

const ARM_SKIN: RGBA[] = [hx('#183640'), hx('#2a5a68'), hx('#46869a'), hx('#7ab8c8')];
const css = (c: RGBA, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

registerImpactPainter('f8_grab', {
  life: 0.42,
  shake: 0.1,
  paint(g, rec, px, py, S, age) {
    // Длинная рука вылетает к концу линии в миг удара, держит 0,1 с и
    // втягивается к многорукому (тянет героя — отброс мозга со знаком минус).
    const a = rec.ang ?? 0;
    const L = (rec.r ?? 4) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    const out = age < 0.04 ? easeOut(age / 0.04) : age < 0.14 ? 1 : 1 - easeIn((age - 0.14) / 0.28);
    const r0 = 0.45 * S;
    const r1 = r0 + (L - r0) * out;
    if (r1 <= r0 + 1) return true;
    // Рука: тень, контур, тело, блик; локтевые бугры по длине.
    const line = (off: number, c: string) => {
      g.fillStyle = c;
      seg(g, px + ux * r0 + nx * off, py + uy * r0 + ny * off + 2, px + ux * r1 + nx * off, py + uy * r1 + ny * off + 2);
    };
    g.fillStyle = 'rgba(0,0,0,0.25)';
    seg(g, px + ux * r0, py + uy * r0 + 4, px + ux * r1, py + uy * r1 + 4);
    line(-2, css(hx('#0a1418')));
    line(2, css(hx('#0a1418')));
    line(-1, css(ARM_SKIN[1]));
    line(0, css(ARM_SKIN[2]));
    line(1, css(ARM_SKIN[1]));
    g.fillStyle = css(ARM_SKIN[3]);
    for (let d = r0 + 6; d < r1 - 6; d += 9) px1(g, px + ux * d - nx, py + uy * d - ny + 1, 2, 1);
    // Кисть: ладонь и пальцы — растопырены на вылете, сжаты на возврате.
    const hx0 = px + ux * r1;
    const hy0 = py + uy * r1 + 2;
    const grip = age < 0.1 ? 0 : 1;
    g.fillStyle = css(hx('#0a1418'));
    px1(g, hx0 - 3, hy0 - 3, 6, 6);
    g.fillStyle = css(ARM_SKIN[2]);
    px1(g, hx0 - 2, hy0 - 2, 4, 4);
    for (let i = -2; i <= 2; i++) {
      const fa = a + i * (grip ? 0.25 : 0.5);
      const fl = grip ? 2 : 4;
      g.fillStyle = css(ARM_SKIN[3]);
      seg(g, hx0 + Math.cos(fa) * 2, hy0 + Math.sin(fa) * 2, hx0 + Math.cos(fa) * (2 + fl), hy0 + Math.sin(fa) * (2 + fl));
    }
    if (age < 0.07) {
      g.fillStyle = 'rgba(255,255,255,0.9)';
      px1(g, hx0 - 1, hy0 - 1, 3, 3);
    }
    return true;
  },
});

// ---- Паук: натянутая нить лопается -----------------------------------------------------------

registerImpactPainter('f8_cut', {
  life: 0.4,
  shake: 0.08,
  paint(g, rec, px, py, S, age) {
    const a = rec.ang ?? 0;
    const L = (rec.r ?? 4) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    if (age < 0.06) {
      // Разрез — белая черта во всю длину.
      g.fillStyle = 'rgba(255,255,255,0.95)';
      seg(g, px, py, px + ux * L, py + uy * L);
      g.fillStyle = 'rgba(255,120,200,0.6)';
      seg(g, px + nx, py + ny, px + ux * L + nx, py + uy * L + ny);
      return true;
    }
    // Две половины отдёргиваются к концам и вьются.
    const k = easeOut((age - 0.06) / 0.34);
    const fade = 1 - k;
    g.fillStyle = rgba('#ece6f8', 0.85 * fade);
    for (const half of [0, 1]) {
      const from = half ? L : 0;
      const len = (L / 2) * (1 - k);
      const dir = half ? -1 : 1;
      for (let i = 0; i <= len; i += 1) {
        const w = Math.sin(i * 0.5 + age * 40) * 2 * k * (i / Math.max(1, len));
        const d = from + dir * i;
        px1(g, px + ux * d + nx * w, py + uy * d + ny * w);
      }
    }
    g.fillStyle = rgba('#ffffff', fade);
    for (let i = 0; i < 6; i++) {
      const d = L / 2 + (hash(i, rec.seed) - 0.5) * L * 0.5 * k;
      px1(g, px + ux * d + nx * (hash(i, 7) - 0.5) * 8 * k, py + uy * d + ny * (hash(i, 9) - 0.5) * 8 * k - 6 * k);
    }
    return true;
  },
});

// ---- Барабанщик: когти по полу и волна брюха --------------------------------------------------

registerImpactPainter('f8_claw', {
  life: 0.5,
  shake: 0.08,
  paint(g, rec, px, py, S, age) {
    const a = rec.ang ?? 0;
    const L = (rec.r ?? 3) * S;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const nx = -uy;
    const ny = ux;
    // Борозда бежит от барабанщика за 0,08 с, остаётся и гаснет; пыль клубами.
    const run = L * easeOut(age / 0.08);
    const fade = 1 - clamp01((age - 0.25) / 0.25);
    g.fillStyle = rgba('#1e0e08', 0.7 * fade);
    seg(g, px, py, px + ux * run, py + uy * run);
    g.fillStyle = rgba('#ffd8a0', 0.6 * fade);
    seg(g, px + nx, py + ny, px + ux * run + nx, py + uy * run + ny);
    if (age < 0.12) {
      g.fillStyle = 'rgba(255,240,210,0.95)';
      px1(g, px + ux * run - 1, py + uy * run - 1, 3, 3);
    }
    for (let i = 0; i < 5; i++) {
      const d = ((i + 0.5) / 5) * run;
      const k = clamp01((age - (i / 5) * 0.08) / 0.4);
      if (k <= 0 || k >= 1) continue;
      g.fillStyle = rgba('#c8a888', 0.5 * (1 - k));
      px1(g, px + ux * d + nx * (2 + k * 4), py + uy * d + ny * (2 + k * 4) - k * 4, 2, 1);
      px1(g, px + ux * d - nx * (2 + k * 4), py + uy * d - ny * (2 + k * 4) - k * 4, 2, 1);
    }
    return true;
  },
});

registerImpactPainter('f8_boom', {
  life: 0.5,
  shake: 0.2,
  paint(g, rec, px, py, S, age) {
    const R = (rec.r ?? 2.1) * S;
    const k = easeOut(age / 0.5);
    // Две волны: тугая и за ней широкая; томоэ разлетаются по кругу.
    for (const [lag, c, w] of [
      [0, '#fff0d0', 1],
      [0.08, '#ff8a3a', 2],
    ] as [number, string, number][]) {
      const kk = easeOut(clamp01((age - lag) / 0.42));
      if (kk <= 0 || kk >= 1) continue;
      const r = R * (0.55 + 0.6 * kk);
      g.fillStyle = rgba(c, 0.85 * (1 - kk));
      const n = Math.round(r * 0.9);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU;
        px1(g, px + Math.cos(t) * r, py + Math.sin(t) * r * 0.75, w, 1);
      }
    }
    g.fillStyle = rgba('#ffe0b0', 0.9 * (1 - k));
    for (let i = 0; i < 3; i++) {
      const t = (i / 3) * TAU + age * 6;
      const r = R * (0.4 + 0.9 * k);
      px1(g, px + Math.cos(t) * r - 1, py + Math.sin(t) * r * 0.75 - 1, 3, 3);
    }
    return true;
  },
});

// ---- Бива: лопнувшая струна — кольцо волны (зона-картинка `api.vfx`) --------------------------

registerZonePainter('f8_snap', (g, z0, px, py, S) => {
  const z = z0 as Zone;
  const k = clamp01(z.t / Math.max(0.01, z.life));
  const R = z.r * S * (0.25 + 0.75 * easeOut(k));
  g.fillStyle = rgba('#e0c8ff', 0.85 * (1 - k));
  const n = Math.max(12, Math.round(R * 0.8));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU;
    // Волна дрожит, как струна: радиус бежит синусом.
    const w = Math.sin(t * 6 + z.t * 30) * 1.2 * (1 - k);
    px1(g, px + Math.cos(t) * (R + w), py + Math.sin(t) * (R + w) * 0.7);
  }
  g.fillStyle = rgba('#9a6ae0', 0.6 * (1 - k));
  for (let i = 0; i < n; i += 2) {
    const t = (i / n) * TAU + 0.2;
    px1(g, px + Math.cos(t) * R * 0.8, py + Math.sin(t) * R * 0.8 * 0.7);
  }
  // Ноты разлетаются.
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * TAU + 0.6;
    const r = R * 0.9;
    const x = px + Math.cos(t) * r;
    const y = py + Math.sin(t) * r * 0.7 - k * 6;
    g.fillStyle = rgba('#f0e0ff', 1 - k);
    px1(g, x, y, 2, 1);
    px1(g, x + 1, y - 2, 1, 2);
  }
  return true;
});

// ---- Фонарь: огонёк со следом и вспышка попадания ---------------------------------------------

const WISP: RGBA[] = [hx('#c83a14'), hx('#ff8a30'), hx('#ffcc60'), hx('#fff8d0')];
const wispSprites = new Map<string, Sprite>();

/** Огонёк: ядро и хвост против хода (8 румбов × 3 кадра трепета). */
function wispSprite(d: number, f: number): Sprite {
  const key = `${d}|${f}`;
  let s = wispSprites.get(key);
  if (s) return s;
  const W = 21;
  const p = new Px(W, W);
  const c = 10;
  const a = (d / 8) * TAU;
  const bx = -Math.cos(a);
  const by = -Math.sin(a);
  // Хвост: три клуба по убыванию, гаснут к концу.
  for (let i = 3; i >= 1; i--) {
    const r = 2.6 - i * 0.6 + (f === i % 3 ? 0.3 : 0);
    const x = c + bx * i * 2.6 + Math.sin(f * 2 + i) * 0.5;
    const y = c + by * i * 2.6 - i * 0.4;
    p.ell(x, y, r, r, mixc(WISP[1], WISP[0], i / 3));
  }
  p.ell(c, c, 3, 3, WISP[1]);
  p.ell(c - 0.4, c - 0.4, 2, 2, WISP[2]);
  p.ell(c - 0.6, c - 0.6, 1, 1, WISP[3]);
  // Язычок пламени вверх — трепещет.
  p.set(c + (f - 1), c - 4, WISP[2]);
  p.set(c + (f - 1), c - 5 + (f === 2 ? 1 : 0), WISP[3]);
  p.outline(hx('#3a1408'));
  s = { img: p.canvas(), ax: c, ay: c + 3 };
  wispSprites.set(key, s);
  return s;
}

registerShotPainter('f8_wisp', (s, time) => {
  const d = (((Math.round((Math.atan2(s.vy, s.vx) / TAU) * 8) % 8) + 8) % 8) as number;
  const f = Math.floor(time * 14 + s.id) % 3;
  return wispSprite(d, f);
});

registerImpactPainter('f8_wisp', {
  life: 0.35,
  shake: 0.05,
  paint(g, rec, px, py, S, age) {
    void S;
    const k = clamp01(age / 0.35);
    const a = Math.atan2(rec.vy ?? 0, rec.vx ?? 1);
    if (age < 0.05) {
      g.fillStyle = 'rgba(255,248,208,0.95)';
      px1(g, px - 2, py - 2, 5, 5);
    }
    // Искры разлетаются вперёд по ходу огонька и гаснут, кольцо копоти.
    for (let i = 0; i < 7; i++) {
      const t = a + (hash(i, rec.seed) - 0.5) * 2.4;
      const r = 2 + (5 + hash(i, rec.seed + 1) * 6) * easeOut(k);
      g.fillStyle = rgba(i % 2 ? '#ffcc60' : '#ff8a30', 1 - k);
      px1(g, px + Math.cos(t) * r, py + Math.sin(t) * r - k * 3);
    }
    g.fillStyle = rgba('#3a1408', 0.4 * (1 - k));
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * TAU;
      px1(g, px + Math.cos(t) * (3 + 4 * k), py + Math.sin(t) * (3 + 4 * k) * 0.6);
    }
    return true;
  },
});
