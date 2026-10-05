// Этаж 15, босс «Хозяин подземелья» — техники (v2.87): метки ударов, зоны и
// снаряды босса. Вынесены из `f15-boss-art.ts`, чтобы рисунок тела босса (там)
// и его техники (здесь) можно было делать параллельно. Контакт удара —
// `registerImpactPainter` (движок анимаций, библия §14).
import { Px } from '../dungeon-art';
import { paintSim, registerShotPainter, registerZonePainter } from '../dungeon-paint';
import type { Strike, Zone } from '../dungeon-sim';
import { beatK, f15bView } from './f15-boss-brains';
import {
  hx,
  alpha,
  INK,
  WHITE,
  TAU,
  poly,
  hash,
  STONE,
  STONE_HI,
  VEIN_HOT,
  VEIN_CORE,
  EMBER_HI,
  heartTop,
  VEINS,
  veinPoint,
  TRUNK,
  trunkX,
  rgba,
  kOf,
  cone,
  BLOODC,
  HOT,
  STONEC,
  GHOSTC,
  ringMark,
  QUAD_COL,
  cellSets,
  veinEnds,
  shotSprite,
} from './f15-boss-art';
import type { ZoneX } from './f15-boss-art';

/** Когти льва: три разреза в конусе, ползут к краю. */
registerZonePainter('f15b_claw', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.8;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(BLOODC, 0.1 + 0.22 * k);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = rgba(hx('#ffe0c0'), 0.3 + 0.65 * k);
  for (let i = -1; i <= 1; i++) {
    const aa = a + i * arc * 0.28;
    const r0 = R * 0.3;
    const r1 = R * (0.3 + 0.68 * k);
    g.beginPath();
    g.moveTo(px + Math.cos(aa - 0.12) * r0, py + Math.sin(aa - 0.12) * r0);
    g.quadraticCurveTo(
      px + Math.cos(aa) * (r0 + r1) * 0.55,
      py + Math.sin(aa) * (r0 + r1) * 0.55,
      px + Math.cos(aa + 0.1) * r1,
      py + Math.sin(aa + 0.1) * r1,
    );
    g.stroke();
  }
  g.lineWidth = 1;
  return true;
});

/** Прыжок льва: тень растёт над меткой, по кругу трещины. */
registerZonePainter('f15b_pounce', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#000000'), 0.18 + 0.4 * k);
  g.beginPath();
  g.ellipse(px, py, R * (0.35 + 0.65 * k), R * (0.35 + 0.65 * k) * 0.62, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(BLOODC, 0.5 + 0.5 * k);
  g.lineWidth = 1;
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Четыре когтя-засечки по краю — «сюда ляжет лапа».
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    g.beginPath();
    g.moveTo(px + Math.cos(a) * R * 0.55, py + Math.sin(a) * R * 0.55);
    g.lineTo(
      px + Math.cos(a + 0.15) * R * (0.55 + 0.45 * k),
      py + Math.sin(a + 0.15) * R * (0.55 + 0.45 * k),
    );
    g.stroke();
  }
  return true;
});

registerZonePainter('f15b_shards', (g, z, px, py, S, time) => {
  ringMark(g, z as ZoneX, px, py, S, hx('#ffb070'), time, true);
  return true;
});

registerZonePainter('f15b_shock', (g, z, px, py, S, time) => {
  ringMark(g, z as ZoneX, px, py, S, hx('#ff6050'), time, false);
  return true;
});

/** Удар сердца: алое кольцо волной, внутри — пульс. */
registerZonePainter('f15b_pulse', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const w = (zz.w ?? 0.55) * S;
  g.lineWidth = w * 2;
  g.strokeStyle = rgba(hx('#ff2040'), 0.12 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  // Бегущие по кольцу сгустки света.
  g.lineWidth = 1.5;
  g.strokeStyle = rgba(hx('#ffb0a0'), 0.4 + 0.6 * k);
  for (let i = 0; i < 3; i++) {
    const a0 = time * 2.4 + (i / 3) * TAU;
    g.beginPath();
    g.arc(px, py, R, a0, a0 + 0.9 * k + 0.2);
    g.stroke();
  }
  g.lineWidth = 1;
  return true;
});

/** Каменные шипы бегут к герою: круг с шипом, который растёт. */
registerZonePainter('f15b_spike', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#1a0c08'), 0.2 + 0.35 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(HOT, 0.4 + 0.5 * k);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.6, 0, 0, TAU);
  g.stroke();
  // Трещина звездой — из неё вылезет шип.
  g.strokeStyle = rgba(hx('#ffd080'), 0.3 + 0.7 * k);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + Math.cos(a) * R * 0.8 * k, py + Math.sin(a) * R * 0.5 * k);
    g.stroke();
  }
  if (k > 0.85) {
    // Острие показалось.
    g.fillStyle = rgba(STONEC, (k - 0.85) * 6);
    g.beginPath();
    g.moveTo(px - 3, py + 1);
    g.lineTo(px, py - 8 * (k - 0.85) * 6);
    g.lineTo(px + 3, py + 1);
    g.fill();
  }
  return true;
});

/** Пике: широкая полоса через зал, тень крыльев бежит по ней. */
registerZonePainter('f15b_swoop', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 1) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(BLOODC, 0.1 + 0.2 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#ffd0c0'), 0.4 + 0.5 * k);
  g.fillRect(0, -w, L, 1);
  g.fillRect(0, w - 1, L, 1);
  // Шевроны «туда» бегут вдоль.
  g.strokeStyle = rgba(hx('#fff0e0'), 0.3 + 0.6 * k);
  for (let x = ((time * 90) % 18) - 18; x < L; x += 18) {
    g.beginPath();
    g.moveTo(x, -w * 0.6);
    g.lineTo(x + 6, 0);
    g.lineTo(x, w * 0.6);
    g.stroke();
  }
  g.restore();
  return true;
});

/** Перо-мина: воткнутое перо, светится перед взрывом. */
registerZonePainter('f15b_quill', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(HOT, 0.3 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.strokeStyle = rgba(STONEC, 1);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(px - 2, py + 2);
  g.lineTo(px + 3, py - 6);
  g.stroke();
  g.lineWidth = 1;
  if (Math.sin(time * (10 + k * 30)) > 0) {
    g.fillStyle = rgba(hx('#ffe0a0'), k);
    g.fillRect(Math.round(px + 2), Math.round(py - 7), 2, 2);
  }
  return true;
});

/** Порыв крыльев: конус с полосами ветра наружу. */
registerZonePainter('f15b_gust', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 1.5;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(hx('#c8e0ff'), 0.06 + 0.14 * k);
  g.fill();
  g.strokeStyle = rgba(hx('#e8f4ff'), 0.25 + 0.5 * k);
  for (let i = 0; i < 7; i++) {
    const aa = a + (i / 6 - 0.5) * arc * 0.9;
    const r0 = ((time * 70 + i * 23) % (R * 0.8)) + R * 0.15;
    g.beginPath();
    g.moveTo(px + Math.cos(aa) * r0, py + Math.sin(aa) * r0);
    g.lineTo(px + Math.cos(aa) * (r0 + 10), py + Math.sin(aa) * (r0 + 10));
    g.stroke();
  }
  return true;
});

/** Полоса пламени змея-эха: призрачный огонь по линии. */
registerZonePainter('f15b_flame', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#ff5a20'), 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  // Языки пламени растут к удару.
  g.fillStyle = rgba(hx('#ffc060'), 0.3 + 0.6 * k);
  for (let x = 2; x < L; x += 5) {
    const h = (2 + Math.sin(time * 12 + x * 0.7) * 1.5) * k;
    g.fillRect(x, -h, 2, h * 2);
  }
  g.restore();
  return true;
});

registerZonePainter('f15b_bite', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  if ((zz as Strike).shape === 'cone') {
    cone(g, px, py, R, zz.ang ?? 0, zz.arc ?? 1.2);
    g.fillStyle = rgba(BLOODC, 0.12 + 0.25 * k);
    g.fill();
  } else {
    g.fillStyle = rgba(BLOODC, 0.12 + 0.25 * k);
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.fill();
  }
  // Челюсти смыкаются: два зубчатых полукруга сходятся.
  const a = zz.ang ?? -Math.PI / 2;
  const cxm = px + ((zz as Strike).shape === 'cone' ? Math.cos(a) * R * 0.6 : 0);
  const cym = py + ((zz as Strike).shape === 'cone' ? Math.sin(a) * R * 0.6 : 0);
  const gap = (1 - k) * 5 + 1;
  g.fillStyle = rgba(hx('#f4ead8'), 0.4 + 0.6 * k);
  for (let i = -2; i <= 2; i++) {
    g.fillRect(Math.round(cxm + i * 3) - 1, Math.round(cym - gap - 2), 2, 2);
    g.fillRect(Math.round(cxm + i * 3) - 1, Math.round(cym + gap), 2, 2);
  }
  return true;
});

registerZonePainter('f15b_axe', (g, z, px, py, S) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(BLOODC, 0.12 + 0.26 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#e8e8f0'), 0.4 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * (1.2 - 0.2 * k), 0, TAU);
  g.stroke();
  // Секира падает: тень лезвия сужается.
  g.fillStyle = rgba(hx('#000000'), 0.2 + 0.3 * k);
  g.fillRect(
    Math.round(px - R * 0.1),
    Math.round(py - R * (1 - k)),
    Math.round(R * 0.2),
    Math.round(R * (1 - k) * 2) + 1,
  );
  return true;
});

registerZonePainter('f15b_slash', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const R = zz.r * S;
  const a = zz.ang ?? 0;
  const arc = zz.arc ?? 2;
  cone(g, px, py, R, a, arc);
  g.fillStyle = rgba(hx('#8a60ff'), 0.1 + 0.24 * k);
  g.fill();
  g.strokeStyle = rgba(GHOSTC, 0.35 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R, a - arc / 2, a - arc / 2 + arc * k);
  g.stroke();
  return true;
});

registerZonePainter('f15b_cleave', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.7) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#8a60ff'), 0.12 + 0.28 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(GHOSTC, 0.5 + 0.5 * k);
  g.fillRect(Math.round(L * k) - 4, -1, 4, 2);
  g.restore();
  return true;
});

/** Молния эха: сперва круг-метка, в удар — зигзаг с неба (поверх темноты). */
registerZonePainter('f15b_bolt', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.strokeStyle = rgba(hx('#b8a0ff'), 0.35 + 0.55 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.stroke();
  g.fillStyle = rgba(hx('#6a50d0'), 0.08 + 0.22 * k);
  g.fill();
  if (k > 0.8) {
    const a = (k - 0.8) * 5;
    g.lineWidth = 2;
    g.strokeStyle = rgba(hx('#d8c8ff'), a);
    g.beginPath();
    let x = px;
    g.moveTo(x, py - 60);
    for (let i = 1; i <= 6; i++) {
      x = px + (i === 6 ? 0 : (hash(i, Math.floor(time * 20), z.id) - 0.5) * 12);
      g.lineTo(x, py - 60 + i * 10);
    }
    g.stroke();
    g.lineWidth = 1;
  }
  return true;
});

/** Извержение лавы: пузырь вспухает, по краю искры. */
registerZonePainter('f15b_erupt', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#ff5010'), 0.14 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.fillStyle = rgba(hx('#ffd060'), 0.3 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * 0.45 * k, 0, TAU);
  g.fill();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + time * 3;
    g.fillRect(
      Math.round(px + Math.cos(a) * R),
      Math.round(py + Math.sin(a) * R * 0.8) - (Math.sin(time * 15 + i) > 0 ? 1 : 0),
      1,
      1,
    );
  }
  return true;
});

/** Гейзер бездны: бирюзовый круг, вода вскипает. */
registerZonePainter('f15b_geyser', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#20a0b0'), 0.12 + 0.3 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#c0ffff'), 0.4 + 0.6 * k);
  for (let i = 0; i < 3; i++) {
    const r = R * (((time * 1.4 + i / 3) % 1) * k);
    g.beginPath();
    g.arc(px, py, r, 0, TAU);
    g.stroke();
  }
  return true;
});

/** Луч зеркала: тонкая холодная линия, в удар — слепящая. */
registerZonePainter('f15b_beam', (g, z, px, py, S) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.38) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#a0c0ff'), 0.08 + 0.2 * k);
  g.fillRect(0, -w, L, w * 2);
  g.fillStyle = rgba(hx('#f0f8ff'), 0.3 + 0.7 * k);
  g.fillRect(0, -0.5, L * Math.min(1, k * 1.3), 1);
  g.restore();
  return true;
});

/** Голова гидры из круга: пасть зелёным кругом. */
registerZonePainter('f15b_hbite', (g, z, px, py, S, time) => {
  const k = kOf(z as ZoneX);
  const R = z.r * S;
  g.fillStyle = rgba(hx('#40c040'), 0.12 + 0.28 * k);
  g.beginPath();
  g.arc(px, py, R, 0, TAU);
  g.fill();
  g.strokeStyle = rgba(hx('#b0ff90'), 0.4 + 0.6 * k);
  g.beginPath();
  g.arc(px, py, R * (1 - 0.3 * Math.sin(time * 9) * k), 0, TAU);
  g.stroke();
  return true;
});

/** Артерия хлещет: жила-линия, пульс бежит от сердца. */
registerZonePainter('f15b_artery', (g, z, px, py, S, time) => {
  const zz = z as ZoneX;
  const k = kOf(zz);
  const L = zz.r * S;
  const w = (zz.w ?? 0.5) * S;
  g.save();
  g.translate(px, py);
  g.rotate(zz.ang ?? 0);
  g.fillStyle = rgba(hx('#c01028'), 0.12 + 0.3 * k);
  g.fillRect(0, -w, L, w * 2);
  // Волнистая жила по оси, пульс-сгусток бежит наружу.
  g.strokeStyle = rgba(hx('#ff5060'), 0.5 + 0.5 * k);
  g.beginPath();
  for (let x = 0; x <= L; x += 4) {
    const y = Math.sin(x * 0.2 + time * 8) * 1.5 * k;
    if (x === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = rgba(hx('#ffd0b0'), 0.6 + 0.4 * k);
  g.fillRect(Math.round(L * k) - 3, -2, 4, 4);
  g.restore();
  return true;
});

registerZonePainter('f15b_flames', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const life = zz.t - (zz.warn ?? 0);
  const fade = Math.min(1, (zz.life - life) / 0.5);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#8a1a06'), 0.35 * fade);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.7, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + zz.id;
    const r = R * (0.2 + 0.6 * hash(i, zz.id));
    const x = px + Math.cos(a) * r;
    const y = py + Math.sin(a) * r * 0.7;
    const h = (3 + Math.sin(time * 14 + i * 2) * 2) * fade;
    g.fillStyle = rgba(hx('#ff8a20'), 0.8 * fade);
    g.fillRect(Math.round(x), Math.round(y - h), 2, Math.round(h));
    g.fillStyle = rgba(hx('#ffe080'), 0.8 * fade);
    g.fillRect(Math.round(x), Math.round(y - h), 1, 1);
  }
  return true;
});

registerZonePainter('f15b_miasma', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const warn = zz.warn ?? 0;
  const R = zz.r * S;
  if (zz.t < warn) {
    const k = zz.t / warn;
    g.strokeStyle = rgba(hx('#90e040'), 0.4 + 0.5 * k);
    g.beginPath();
    g.arc(px, py, R, 0, TAU);
    g.stroke();
    return true;
  }
  const fade = Math.min(1, (zz.life - (zz.t - warn)) / 0.6);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + time * 0.5 + zz.id;
    const r = R * (0.25 + 0.55 * ((i * 0.37 + time * 0.15) % 1));
    g.fillStyle = rgba(hx('#6aa020'), 0.3 * fade);
    g.beginPath();
    g.arc(px + Math.cos(a) * r, py + Math.sin(a) * r * 0.7, 3 + (i % 3), 0, TAU);
    g.fill();
  }
  return true;
});

registerZonePainter('f15b_pool', (g, z, px, py, S) => {
  const zz = z as Zone;
  const fade = Math.min(1, (zz.life - zz.t) / 0.6);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#4a0610'), 0.55 * fade);
  g.beginPath();
  g.ellipse(px, py, R, R * 0.62, 0, 0, TAU);
  g.fill();
  g.fillStyle = rgba(hx('#a01828'), 0.5 * fade);
  g.beginPath();
  g.ellipse(px - R * 0.2, py - R * 0.15, R * 0.5, R * 0.25, 0, 0, TAU);
  g.fill();
  return true;
});

/** Туман под эхом: холодное облако у ног, струйки вверх. */
registerZonePainter('f15b_mist', (g, z, px, py, S, time) => {
  const R = z.r * S;
  g.fillStyle = rgba(hx('#6ab0e0'), 0.18);
  g.beginPath();
  g.ellipse(px, py, R * 1.2, R * 0.5, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 5; i++) {
    const t = (time * 0.6 + i / 5) % 1;
    const x = px + Math.sin(i * 2.3 + time) * R * 0.8;
    g.fillStyle = rgba(hx('#c8f0ff'), 0.35 * (1 - t));
    g.fillRect(Math.round(x), Math.round(py - t * 18), 1, 2);
  }
  return true;
});

registerZonePainter('f15b_qwarn', (g, z, px, py, S, time) => {
  const zz = z as ZoneX & Zone;
  const s = paintSim();
  if (!s || !zz.cells) return true;
  const W = s.world.w;
  const col = QUAD_COL[zz.q ?? 0];
  const left = zz.life - zz.t;
  // Мерцание сильнее к моменту перемены; обводка — форма будущего пятна.
  const k = Math.max(0, Math.min(1, 1 - left / 1.6));
  if (k <= 0) return true;
  let set = cellSets.get(zz.cells);
  if (!set) {
    set = new Set(zz.cells);
    cellSets.set(zz.cells, set);
  }
  const on = Math.sin(time * (8 + k * 14)) > 0;
  g.fillStyle = rgba(col, 0.05 + k * 0.14 + (on ? 0.05 : 0));
  const edge = rgba(col, 0.35 + k * 0.55);
  for (const i of zz.cells) {
    const x = Math.round(px + ((i % W) - zz.x) * S);
    const y = Math.round(py + (Math.floor(i / W) - zz.y) * S);
    g.fillRect(x, y, S, S);
  }
  g.fillStyle = edge;
  const w = Math.max(1, Math.round(S / 8));
  for (const i of zz.cells) {
    const x = Math.round(px + ((i % W) - zz.x) * S);
    const y = Math.round(py + (Math.floor(i / W) - zz.y) * S);
    if (!set.has(i - 1)) g.fillRect(x, y, w, S);
    if (!set.has(i + 1)) g.fillRect(x + S - w, y, w, S);
    if (!set.has(i - W)) g.fillRect(x, y, S, w);
    if (!set.has(i + W)) g.fillRect(x, y + S - w, S, w);
  }
  return true;
});

/** Стена вот-вот сожмётся: плоть вспухает над клетками кольца. */
registerZonePainter('f15b_swellwarn', (g, z, px, py, S, time) => {
  const zz = z as ZoneX & Zone;
  const s = paintSim();
  if (!s || !zz.cells) return true;
  const W = s.world.w;
  const k = Math.min(1, zz.t / Math.max(0.1, zz.life - 0.2));
  const pulse = 0.5 + 0.5 * Math.sin(time * (6 + k * 10));
  for (const i of zz.cells) {
    const x = Math.round(px + ((i % W) - zz.x) * S);
    const y = Math.round(py + (Math.floor(i / W) - zz.y) * S);
    g.fillStyle = rgba(hx('#8a1a2a'), 0.25 + 0.4 * k * pulse);
    g.fillRect(x + 1, y + 1, S - 2, S - 2);
    g.fillStyle = rgba(hx('#ff5060'), 0.3 + 0.5 * k);
    g.fillRect(x + 3, y + 3, 2, 2);
    g.fillRect(x + S - 5, y + S - 6, 2, 2);
  }
  return true;
});

/** Водоворот: закрученные дуги вокруг омута. */
registerZonePainter('f15b_swirl', (g, z, px, py, S, time) => {
  const R = z.r * S;
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 0.95);
  g.strokeStyle = rgba(hx('#70e0f0'), 0.25 + 0.5 * k);
  for (let i = 0; i < 4; i++) {
    const a0 = -time * (3 + k * 3) + (i / 4) * TAU;
    g.beginPath();
    g.arc(px, py, R * (0.35 + i * 0.17), a0, a0 + 1.6);
    g.stroke();
  }
  return true;
});

/** Вспышка круга-телепорта. */
registerZonePainter('f15b_warp', (g, z, px, py, S, time) => {
  const zz = z as Zone;
  const k = Math.min(1, zz.t / 0.55);
  const R = zz.r * S;
  g.fillStyle = rgba(hx('#b0ffc8'), 0.2 + 0.5 * k);
  g.beginPath();
  g.arc(px, py, R * (1.2 - k * 0.6), 0, TAU);
  g.fill();
  g.strokeStyle = rgba(WHITE, 0.6 + 0.4 * Math.sin(time * 30));
  g.beginPath();
  g.arc(px, py, R * (0.4 + k * 0.8), 0, TAU);
  g.stroke();
  return true;
});

registerZonePainter('f15b_veins', (g, z, px, py, S) => {
  const s = paintSim();
  const v = f15bView(s);
  const b = s?.boss;
  if (!s || !v || !b || b.state !== 'fight') return true;
  const k = beatK(v, s.time);
  if (k >= 1) return true;
  const front = 3.8 + k * 16;
  const ends = veinEnds(s);
  const top = heartTop();
  const put = (x: number, y: number, e: number, w: number) => {
    const sx = Math.round(px + (x - z.x) * S);
    const sy = Math.round(py + (y + top - z.y) * S);
    g.fillStyle = rgba(VEIN_HOT, 0.22 * e);
    g.fillRect(sx - w, sy - w, w * 2, w * 2);
    g.fillStyle = rgba(VEIN_CORE, 0.75 * e);
    g.fillRect(sx - 1, sy - 1, 2, 2);
  };
  const fade = 1 - k * 0.55;
  for (let i = 0; i < VEINS.length; i++)
    for (let d = front - 1.6; d <= front; d += 0.14) {
      if (d < 3.8 || d > ends[i]) continue;
      const e = ((d - front + 1.6) / 1.6) * fade;
      const [x, y] = veinPoint(i, d);
      put(x, y, e, 3);
    }
  // Стволы горловины: волна идёт дальше вниз, к стыку.
  for (let d = front - 1.6; d <= front; d += 0.14) {
    const y = TRUNK.y0 + (d - 10.2);
    if (y < TRUNK.y0 || y > TRUNK.y1) continue;
    const e = ((d - front + 1.6) / 1.6) * fade;
    for (const side of [-1, 1] as const) put(trunkX(y, side), y, e, 3);
  }
  return true;
});

/** Каменное перо: поворот по полёту — 8 направлений. */
registerShotPainter('f15b_feather', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const d = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  return shotSprite(`feather|${d}`, () => {
    const p = new Px(14, 14);
    const aa = (d / 8) * TAU;
    const ux = Math.cos(aa);
    const uy = Math.sin(aa);
    // Стержень и опахало: камень с тлеющим кончиком.
    for (let t = -5; t <= 5; t++) {
      const x = 7 + ux * t;
      const y = 7 + uy * t;
      p.set(Math.round(x), Math.round(y), t > 3 ? EMBER_HI : STONE_HI);
      const w = t > -4 && t < 4 ? 1.6 - Math.abs(t) * 0.2 : 0;
      if (w > 0) {
        p.set(Math.round(x - uy * w), Math.round(y + ux * w), STONE[2]);
        p.set(Math.round(x + uy * w), Math.round(y - ux * w), STONE[1]);
      }
    }
    p.outline(INK);
    return { p, ax: 7, ay: 7 };
  });
});

registerShotPainter('f15b_fireball', (s, time) => {
  const f = Math.floor(time * 12) % 3;
  return shotSprite(`fireball|${f}`, () => {
    const p = new Px(12, 12);
    p.ell(6, 6, 4.2 + f * 0.3, 4.2, hx('#c83a0a'));
    p.ell(6, 5.5, 2.8, 2.6, hx('#ff9a2a'));
    p.ell(5.5, 5, 1.4, 1.2, hx('#fff0a0'));
    for (let i = 0; i < 4; i++)
      p.set(
        Math.round(6 + Math.cos(i * 1.7 + f) * 5),
        Math.round(6 + Math.sin(i * 1.7 + f) * 5),
        alpha(GHOSTC, 0.8),
      );
    return { p, ax: 6, ay: 6 };
  });
});

registerShotPainter('f15b_ice', (s) => {
  const a = Math.atan2(s.vy, s.vx);
  const d = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
  return shotSprite(`ice|${d}`, () => {
    const p = new Px(12, 12);
    const aa = (d / 8) * TAU;
    poly(
      p,
      [
        [6 + Math.cos(aa) * 5, 6 + Math.sin(aa) * 5],
        [6 + Math.cos(aa + 2.4) * 2.4, 6 + Math.sin(aa + 2.4) * 2.4],
        [6 - Math.cos(aa) * 3, 6 - Math.sin(aa) * 3],
        [6 + Math.cos(aa - 2.4) * 2.4, 6 + Math.sin(aa - 2.4) * 2.4],
      ],
      (x, y) => ((x + y) % 3 === 0 ? hx('#ffffff') : hx('#90e0ff')),
    );
    p.outline(hx('#10304a'));
    return { p, ax: 6, ay: 6 };
  });
});
