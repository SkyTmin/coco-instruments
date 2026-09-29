// Этаж 1 «Крысиные норы» — рисовальщики (v2.81): крысолюды, король 2.0,
// крысы с чарами шамана, ловушки, факелы, тотемы, трон, свои клетки нор,
// метки ударов и иконки материалов.
//
// КРЫСОЛЮДЫ — это крысы, вставшие на задние лапы, а не человечки с
// крысиной головой. Их держит один скелет (`Rig`): таз, сутулый торс
// овалом со светотенью по нормали (как у крыс `dungeon-rats.ts`), голова с
// клином морды и розовым носом, ухо с розовым нутром, лапы-палки с
// розовыми ступнями, хвост сплайном. Вид отличает поклажа и силуэт:
//   • крысолюд — тряпка на бёдрах и короткая заточка обратным хватом;
//   • пращник — худой, красная повязка, праща раскручивается над головой;
//   • шаман — седой, горбатый, череп вместо капюшона, посох с зелёным
//     огнём (он ещё и светится сам — виден в темноте, убей первым);
//   • латник — широкий, ведро на голове со щелью, крышка котла щитом,
//     булава из трубы с гайкой.
// Король 2.0 — крупный крысолюд в плаще и короне: за ним тянется узел из
// хвостов, к которым привязаны два малых короля (до раскола), в руке тесак
// и крышка-баклер, на последней полосе — рельс-двуручник.
//
// Всё смотрит ВПРАВО; влево — зеркало. Кадр рисуется один раз на ключ
// (вид, поза, кадр, сторона, вспышка, облик, чары) и лежит в кеше.
// Свет сверху-слева; контур `#150f0b`; насыщенное — только акценты:
// зелёный огонь шамана, красная повязка пращника, золото короны.

// Порядок важен (как в `dungeon-mobart.ts`): плитки раньше рисунков —
// модули плиток, спрайтов и рисунков ссылаются друг на друга по кругу, и
// начатый с рисунков круг застаёт плитки без `hex`.
import { blit, floorCell } from '../dungeon-tiles';
import { hex, Px, TS } from '../dungeon-art';
import { KING_PAL, ratEye, ratPx, ratSize, RAT_FRAMES, shadeOf, spline } from '../dungeon-rats';
import type { Ell, RatAnim } from '../dungeon-rats';
import {
  frameLRU,
  paintSim,
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
  registerMobWarm,
  registerPropPainter,
  registerShotPainter,
  registerZonePainter,
} from '../dungeon-paint';
import type { CellCtx, MobFrame, MobPose, Sprite } from '../dungeon-paint';
import type { Mob, Strike, Zone } from '../dungeon-sim';
import { F1, F1_MARK } from './f1';
import { MAP_HAUL, MAP_MOUTH } from './f1-map';

type RGBA = [number, number, number, number];
type V = [number, number];

export const INK = hex('#150f0b');
const WHITE: RGBA = [255, 255, 255, 255];

// Свет сверху-слева-спереди (как у крыс).
const LX = -0.45;
const LY = -0.75;
const LZ = 0.5;

// ---------------------------------------------------------------------------
// Палитры.
// ---------------------------------------------------------------------------

interface Fur {
  dark: RGBA;
  fur: RGBA;
  light: RGBA;
  hi: RGBA;
  belly: RGBA;
  pink: RGBA;
  pinkDark: RGBA;
  eye: RGBA;
  eyeHi: RGBA;
}

const fur = (d: string, f: string, l: string, h: string, b: string, eye = '#ff4a2e'): Fur => ({
  dark: hex(d),
  fur: hex(f),
  light: hex(l),
  hi: hex(h),
  belly: hex(b),
  pink: hex('#d08a82'),
  pinkDark: hex('#935654'),
  eye: hex(eye),
  eyeHi: hex('#ffd7a8'),
});

const FUR = {
  ratman: fur('#33271f', '#4e3e32', '#6b5645', '#8a735c', '#85705e'),
  slinger: fur('#3b2c20', '#5a4431', '#7a5e44', '#9b7c5a', '#9a8068'),
  shaman: fur('#3a3a36', '#5c5a52', '#7d7a6e', '#a39f90', '#8e8a7c', '#9dff6a'),
  guard: fur('#2c2420', '#443830', '#5e4d40', '#7a6554', '#6e5c4e', '#ffa030'),
  king: fur('#2a2022', '#463836', '#62504c', '#86706a', '#7a6660', '#ffcc30'),
  elite: fur('#34201f', '#56302a', '#7a4636', '#a0664a', '#8e6a5a', '#ffb020'),
  albino: fur('#9e9294', '#d6cdca', '#efe8e5', '#ffffff', '#fbf6f2', '#ff2a52'),
};

const CLOTH = {
  rag: [hex('#3b3322'), hex('#574b30'), hex('#72633f')] as RGBA[],
  red: [hex('#5a1614'), hex('#8e2a22'), hex('#b8483a')] as RGBA[],
  hide: [hex('#4a3a2c'), hex('#6a5440'), hex('#8a7058')] as RGBA[],
  cape: [hex('#40101c'), hex('#6a1a2a'), hex('#94303e')] as RGBA[],
};

export const METAL = {
  steel: [hex('#3a3e44'), hex('#6a7078'), hex('#a8b0b8'), hex('#e6ecf0')] as RGBA[],
  rust: [hex('#4a2a1a'), hex('#7a4424'), hex('#a8643a'), hex('#d09060')] as RGBA[],
  iron: [hex('#2a2a2e'), hex('#4a4a50'), hex('#76767e'), hex('#b0b0b8')] as RGBA[],
  gold: [hex('#7a5210'), hex('#b88420'), hex('#e8b830'), hex('#fff0a0')] as RGBA[],
};

const BONE = [hex('#8e8470'), hex('#c8bea4'), hex('#ece4cc')] as RGBA[];
const WOOD = [hex('#3e2414'), hex('#6a4024'), hex('#8e5a34')] as RGBA[];
const GREEN = [hex('#1e6a2a'), hex('#46c050'), hex('#9dff6a'), hex('#e8ffd0')] as RGBA[];

// ---------------------------------------------------------------------------
// Растеризация: овал со светом, толстая линия, многоугольник.
// ---------------------------------------------------------------------------

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const lerp = (a: V, b: V, k: number): V => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

/** Тон по свету: четыре ступени шерсти. */
function tone(f: Fur, k: number): RGBA {
  if (k > 0.78) return f.hi;
  if (k > 0.45) return f.light;
  if (k > 0.05) return f.fur;
  return f.dark;
}

/**
 * Овал, повёрнутый на угол `ang` (0 — большая ось вверх), с тоном по
 * нормали. `paint(k, across, along)` решает цвет: k — свет, across/along —
 * доли радиусов (across > 0 — вперёд).
 */
function oval(
  px: Px,
  c: V,
  rx: number,
  ry: number,
  ang: number,
  paint: (k: number, across: number, along: number) => RGBA | null,
): void {
  const ax: V = [Math.sin(ang), -Math.cos(ang)];
  const bx: V = [Math.cos(ang), Math.sin(ang)];
  const R = Math.max(rx, ry) + 1;
  for (let y = Math.floor(c[1] - R); y <= Math.ceil(c[1] + R); y++)
    for (let x = Math.floor(c[0] - R); x <= Math.ceil(c[0] + R); x++) {
      const dx = x + 0.5 - c[0];
      const dy = y + 0.5 - c[1];
      const along = (dx * ax[0] + dy * ax[1]) / ry;
      const across = (dx * bx[0] + dy * bx[1]) / rx;
      const r2 = along * along + across * across;
      if (r2 > 1) continue;
      const nx = across * bx[0] + along * ax[0];
      const ny = across * bx[1] + along * ax[1];
      const nz = Math.sqrt(Math.max(0, 1 - r2));
      const col = paint(nx * LX + ny * LY + nz * LZ, across, along);
      if (col) px.set(x, y, col);
    }
}

/** Толстая линия (лапа, древко): диск по пути, дальняя — темнее. */
function limb(px: Px, a: V, b: V, w: number, col: RGBA, hi?: RGBA): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
  const r = w / 2;
  for (let i = 0; i <= n; i++) {
    const [x, y] = lerp(a, b, i / n);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++)
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy > r * r + 0.25) continue;
        const up = hi && dy < 0 && dx <= 0;
        px.set(Math.floor(x + dx), Math.floor(y + dy), up ? hi : col);
      }
  }
}

/** Многоугольник: заливка по строкам (чётно-нечётно). */
function poly(px: Px, pts: V[], col: RGBA | ((x: number, y: number) => RGBA | null)): void {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [, y] of pts) {
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      if (ay === by) continue;
      if ((yc >= ay && yc < by) || (yc >= by && yc < ay))
        xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) {
        const c = typeof col === 'function' ? col(x, y) : col;
        if (c) px.set(x, y, c);
      }
  }
}

/** Контур снаружи и золотой кант элиты поверх контура. */
function finish(px: Px, look: MobPose['look']): Px {
  px.outline(INK);
  if (look === 'elite') px.outline(hex('#ffcc40'));
  return px;
}

// ---------------------------------------------------------------------------
// Скелет крысолюда.
// ---------------------------------------------------------------------------

interface Item {
  /**
   * Где рисовать: за телом, поверх торса, поверх головы, в ближней руке
   * (последним — оружие поверх лапы).
   */
  layer: 'back' | 'mid' | 'front' | 'hand';
  draw: (px: Px) => void;
}

interface Rig {
  hip: V;
  /** Наклон торса вперёд, рад (0 — прямо). */
  lean: number;
  torsoLen: number;
  rx: number;
  ry: number;
  head: V;
  headR: number;
  snout: number;
  drop: number;
  jaw: number;
  squint: boolean;
  /** Ноги: бедро, колено, стопа (дальняя, ближняя). */
  legFar: [V, V, V];
  legNear: [V, V, V];
  /** Руки: плечо, локоть, кисть (дальняя, ближняя). */
  armFar: [V, V, V];
  armNear: [V, V, V];
  tail: V[];
  /** Толщина лап. */
  lw: number;
  aw: number;
  items: Item[];
  /** Тряпьё на бёдрах. */
  cloth: RGBA[] | null;
  /** Уши торчат (нет шлема/черепа). */
  ear: boolean;
}

/** Точка шеи по тазу и наклону. */
const neckOf = (r: Rig): V =>
  add(r.hip, [Math.sin(r.lean) * r.torsoLen, -Math.cos(r.lean) * r.torsoLen]);

function drawRig(r: Rig, f: Fur, w: number, h: number): Px {
  const px = new Px(w, h);
  const neck = neckOf(r);
  const big = r.headR > 4;
  // Хвост — первым: за телом. Толще у основания, к кончику тоньше.
  if (r.tail.length > 1) {
    const line = spline(r.tail, big ? 10 : 6);
    line.forEach(([x, y], i) => {
      const k = i / line.length;
      px.set(x, y, k < 0.55 ? f.pink : f.pinkDark);
      if (k < 0.45) px.set(x, y + 1, f.pinkDark);
      if (big && k < 0.3) px.set(x, y - 1, f.pink);
    });
  }
  for (const it of r.items) if (it.layer === 'back') it.draw(px);
  // Лапа: бедро толще голени, ступня — розовые пальцы вперёд. Ближней
  // лапе и руке — тёмная подложка: так они не тонут в торсе того же меха.
  const leg = (l: [V, V, V], far: boolean) => {
    const col = far ? f.dark : f.fur;
    if (!far) limb(px, l[1], l[2], r.lw + 0.9, f.dark);
    limb(px, l[1], l[2], r.lw, col);
    // Бедро — мясистый овал от таза к колену (у крыс мощные ляжки).
    const d: V = [l[1][0] - l[0][0], l[1][1] - l[0][1]];
    const len = Math.hypot(d[0], d[1]) || 1;
    const ang = Math.atan2(d[0], -d[1]);
    const c = lerp(l[0], l[1], 0.42);
    if (!far) oval(px, c, r.lw * 1.25 + 0.5, len * 0.62 + 0.5, ang, () => f.dark);
    oval(px, c, r.lw * 1.25, len * 0.62, ang, (k) =>
      far ? (k > 0.5 ? f.fur : f.dark) : tone(f, k),
    );
    const [fx, fy] = l[2];
    const toe = far ? f.pinkDark : f.pink;
    const n = big ? 5 : 3;
    for (let i = -1; i < n; i++) px.set(fx + i, fy, i === n - 1 ? f.pinkDark : toe);
    if (big) px.set(fx + n, fy, hex('#e8e0d0'));
  };
  const arm = (a: [V, V, V], far: boolean) => {
    const col = far ? f.dark : f.fur;
    if (!far) {
      limb(px, a[0], a[1], r.aw + 1, f.dark);
      limb(px, a[1], a[2], r.aw + 0.6, f.dark);
    }
    limb(px, a[0], a[1], r.aw, col, far ? undefined : f.light);
    limb(px, a[1], a[2], r.aw - 0.4, col);
    const [hx, hy] = a[2];
    px.set(hx, hy, far ? f.pinkDark : f.pink);
    px.set(hx + 1, hy, far ? f.pinkDark : f.pink);
    if (big) px.ell(hx + 0.5, hy, 1.4, 1.2, far ? f.pinkDark : f.pink);
  };
  arm(r.armFar, true);
  leg(r.legFar, true);
  // Торс: сутулый овал от таза к шее, светлое брюхо спереди; у крупных —
  // штрихи шерсти по спине.
  const mid = lerp(r.hip, neck, 0.56);
  oval(px, mid, r.rx, r.ry, r.lean, (k, across, along) => {
    if (across > 0.28 && along < 0.5) return k > 0.15 ? f.belly : f.fur;
    const c = tone(f, k);
    if (
      big &&
      across < 0 &&
      k > 0.05 &&
      k < 0.8 &&
      Math.abs(Math.sin(along * 9 + across * 4)) > 0.93
    )
      return f.dark;
    return c;
  });
  // Тряпка на бёдрах.
  if (r.cloth) {
    const cl = r.cloth;
    oval(px, lerp(r.hip, neck, 0.1), r.rx + 0.5, r.ry * 0.36, r.lean, (k) =>
      k > 0.5 ? cl[2] : k > 0.1 ? cl[1] : cl[0],
    );
    // Лоскут свисает между ног.
    const a = add(r.hip, [0.4, 1.2]);
    poly(px, [a, add(a, [2.4, 0]), add(a, [1.6, 3.4]), add(a, [0.4, 2.8])], cl[0]);
  }
  for (const it of r.items) if (it.layer === 'mid') it.draw(px);
  leg(r.legNear, false);
  paintHead(px, r, f);
  for (const it of r.items) if (it.layer === 'front') it.draw(px);
  arm(r.armNear, false);
  for (const it of r.items) if (it.layer === 'hand') it.draw(px);
  return px;
}

/**
 * Голова крысы: круглый череп, морда — вытянутый овал с круглым
 * подбородком (не клин — клин на крупном масштабе читался клювом),
 * розовый нос на кончике, резцы под носом, большое круглое ухо.
 */
function paintHead(px: Px, r: Rig, f: Fur): void {
  const [hx, hy] = r.head;
  const R = r.headR;
  // Морда: центр впереди черепа и чуть ниже.
  const mc: V = [hx + R * 0.55 + r.snout * 0.55, hy + r.drop * 0.55 + R * 0.12];
  const mrx = R * 0.5 + r.snout * 0.62;
  const mry = R * 0.56 - r.jaw * R * 0.05;
  const skull = (k: number) => tone(f, k);
  oval(px, [hx, hy], R * 0.92, R * 1.02, Math.PI / 2 + 0.12, skull);
  oval(px, mc, mry, mrx, Math.PI / 2 + Math.atan2(r.drop, r.snout + R) * 0.7, (k, across) =>
    across < -0.35 ? (k > 0.3 ? f.belly : f.fur) : k > 0.62 ? f.light : k > 0.05 ? f.fur : f.dark,
  );
  // Щека — светлее, подбородок снизу — тень.
  px.set(Math.round(hx + R * 0.35), Math.round(hy + R * 0.45), f.light);
  const tip: V = [mc[0] + mrx - 0.4, mc[1] - mry * 0.25];
  // Пасть.
  if (r.jaw > 0.2) {
    const open = Math.max(1, Math.round(r.jaw * (R > 4 ? 3 : 2)));
    const x0 = Math.round(hx + R * 0.35);
    const my = Math.round(mc[1] + mry * 0.35);
    for (let x = x0; x <= Math.round(tip[0]) - 1; x++)
      for (let k = 0; k < open; k++) px.set(x, my + k, hex('#4a1418'));
    for (let x = x0; x <= Math.round(tip[0]) - 2; x++) px.set(x, my + open, f.fur);
  }
  // Нос и резцы.
  px.set(Math.round(tip[0]), Math.round(tip[1]), f.pink);
  if (R > 4) {
    px.set(Math.round(tip[0]) - 1, Math.round(tip[1]), f.pink);
    px.set(Math.round(tip[0]), Math.round(tip[1]) - 1, hex('#f0b0a8'));
  }
  // Ухо: большое, круглое, с розовым нутром — у крыс его видно издали.
  if (r.ear) {
    const ec: V = [hx - R * 0.42, hy - R * 0.78];
    const er = R * 0.58;
    px.ell(ec[0], ec[1], er, er * 1.08, f.dark);
    px.ell(ec[0] + 0.2, ec[1] + 0.1, er - 0.7, er * 1.08 - 0.7, f.fur);
    px.ell(
      ec[0] + 0.5,
      ec[1] + 0.4,
      Math.max(0.8, er - 1.5),
      Math.max(0.9, er * 1.08 - 1.5),
      f.pink,
    );
  }
}

/** Глаз, усы и резцы — поверх контура (иначе контур сделал бы их толстыми). */
function eyeOf(r: Rig): V {
  return [Math.round(r.head[0] + r.headR * 0.42), Math.round(r.head[1] - r.headR * 0.2)];
}

function paintEye(px: Px, r: Rig, f: Fur, dead = false): void {
  const [gx, gy] = eyeOf(r);
  const R = r.headR;
  const big = R > 4;
  // Усы и резцы.
  if (!dead) {
    const mc: V = [r.head[0] + R * 0.55 + r.snout * 0.55, r.head[1] + r.drop * 0.55 + R * 0.12];
    const mrx = R * 0.5 + r.snout * 0.62;
    const mry = R * 0.56;
    const tip: V = [mc[0] + mrx - 0.4, mc[1] - mry * 0.25];
    const wh: RGBA = [214, 206, 190, 190];
    const bx = Math.round(tip[0] - mrx * 0.5);
    const by = Math.round(tip[1] + 1);
    for (let i = 1; i <= (big ? 5 : 3); i++) {
      px.set(bx + i, by - Math.round(i * 0.35), wh);
      px.set(bx + i, by + 1 + Math.round(i * 0.25), wh);
    }
    const tooth = hex('#f2e6b8');
    const tx = Math.round(tip[0]) - 1;
    const ty = Math.round(tip[1]) + 1;
    px.set(tx, ty, tooth);
    if (big) {
      px.set(tx - 1, ty, tooth);
      px.set(tx, ty + 1, tooth);
      px.set(tx - 1, ty + 1, hex('#d8c890'));
    }
  }
  if (dead) {
    px.set(gx - 1, gy - 1, INK);
    px.set(gx + 1, gy + 1, INK);
    px.set(gx + 1, gy - 1, INK);
    px.set(gx - 1, gy + 1, INK);
    px.set(gx, gy, INK);
    return;
  }
  if (r.squint) {
    px.set(gx, gy + 1, INK);
    px.set(gx + 1, gy + 1, INK);
    if (big) px.set(gx - 1, gy + 1, INK);
    return;
  }
  px.set(gx, gy, f.eye);
  px.set(gx + 1, gy, f.eyeHi);
  px.set(gx, gy + 1, f.eye);
  if (big) {
    px.set(gx + 1, gy + 1, f.eye);
    px.set(gx - 1, gy, INK);
    px.set(gx - 1, gy + 1, INK);
  }
}

// ---------------------------------------------------------------------------
// Поклажа: оружие, щит, праща, посох, шлем, череп, корона.
// ---------------------------------------------------------------------------

/**
 * Клинок от рукояти `a` под углом `ang`: рукоять `grip`, лезвие `len` ×
 * `w`, у тесака — широкий прямоугольник, у рельса — зубья.
 */
export function blade(
  px: Px,
  a: V,
  ang: number,
  o: { grip: number; len: number; w: number; metal: RGBA[]; kind?: 'shiv' | 'cleaver' | 'rail' },
): void {
  const dir: V = [Math.cos(ang), Math.sin(ang)];
  const nrm: V = [-dir[1], dir[0]];
  const g1 = add(a, [dir[0] * o.grip, dir[1] * o.grip]);
  limb(px, add(a, [-dir[0], -dir[1]]), g1, 1.6, WOOD[1], WOOD[2]);
  const tip = add(g1, [dir[0] * o.len, dir[1] * o.len]);
  const hw = o.w / 2;
  const m = o.metal;
  if (o.kind === 'cleaver') {
    // Тесак: прямоугольник, спинка прямая, лезвие снизу светлое.
    const back: V[] = [
      add(g1, [nrm[0] * -hw, nrm[1] * -hw]),
      add(tip, [nrm[0] * -hw, nrm[1] * -hw]),
    ];
    const edge: V[] = [add(tip, [nrm[0] * hw, nrm[1] * hw]), add(g1, [nrm[0] * hw, nrm[1] * hw])];
    poly(px, [back[0], back[1], edge[0], edge[1]], m[1]);
    limb(px, edge[1], edge[0], 1, m[3]);
    limb(px, back[0], back[1], 1, m[0]);
    px.set(Math.round(g1[0] + dir[0] * 2), Math.round(g1[1] + dir[1] * 2), m[0]);
    return;
  }
  const pts: V[] = [
    add(g1, [nrm[0] * hw, nrm[1] * hw]),
    add(tip, [nrm[0] * hw * 0.3, nrm[1] * hw * 0.3]),
    add(tip, [dir[0] * 1.5, dir[1] * 1.5]),
    add(tip, [nrm[0] * -hw * 0.3, nrm[1] * -hw * 0.3]),
    add(g1, [nrm[0] * -hw, nrm[1] * -hw]),
  ];
  poly(px, pts, m[1]);
  limb(px, add(g1, [nrm[0] * hw * 0.5, nrm[1] * hw * 0.5]), tip, 1, m[3]);
  if (o.kind === 'rail') {
    // Зубья пилы по нижней кромке и гарда из гайки.
    for (let t = 2; t < o.len; t += 3) {
      const p = add(g1, [dir[0] * t + nrm[0] * (hw + 0.8), dir[1] * t + nrm[1] * (hw + 0.8)]);
      px.set(Math.round(p[0]), Math.round(p[1]), m[2]);
    }
    limb(
      px,
      add(g1, [nrm[0] * -hw * 1.8, nrm[1] * -hw * 1.8]),
      add(g1, [nrm[0] * hw * 1.8, nrm[1] * hw * 1.8]),
      2,
      METAL.rust[1],
      METAL.rust[2],
    );
  } else
    limb(
      px,
      add(g1, [nrm[0] * -1.2, nrm[1] * -1.2]),
      add(g1, [nrm[0] * 1.2, nrm[1] * 1.2]),
      1,
      m[0],
    );
}

/** Крышка от котла: овал с ободом, ручкой-шишкой и заклёпками. */
function lid(px: Px, c: V, rx: number, ry: number, m: RGBA[]): void {
  oval(px, c, rx, ry, 0, (k, across, along) => {
    const r2 = across * across + along * along;
    if (r2 > 0.72) return k > 0.35 ? m[3] : m[1];
    return k > 0.55 ? m[2] : k > 0.1 ? m[1] : m[0];
  });
  px.ell(c[0] - 0.3, c[1] - 0.3, 1.1, 1.1, m[3]);
  px.set(Math.round(c[0] + 0.6), Math.round(c[1] + 0.6), m[0]);
  for (const a of [0.4, 2, 3.6, 5.2]) {
    px.set(
      Math.round(c[0] + Math.cos(a) * rx * 0.72),
      Math.round(c[1] + Math.sin(a) * ry * 0.72),
      m[0],
    );
  }
}

/** Булава из трубы с гайкой. */
function club(px: Px, a: V, ang: number, len: number): void {
  const dir: V = [Math.cos(ang), Math.sin(ang)];
  const end = add(a, [dir[0] * len, dir[1] * len]);
  limb(px, add(a, [-dir[0] * 1.5, -dir[1] * 1.5]), end, 1.8, METAL.iron[1], METAL.iron[2]);
  px.ell(end[0], end[1], 2.4, 2.4, METAL.rust[1]);
  px.ell(end[0] - 0.6, end[1] - 0.6, 1.2, 1.2, METAL.rust[3]);
  for (const k of [0, 1.6, 3.2, 4.8])
    px.set(
      Math.round(end[0] + Math.cos(k + ang) * 3),
      Math.round(end[1] + Math.sin(k + ang) * 3),
      METAL.iron[3],
    );
}

/**
 * Ведро на голове: оцинкованная трапеция (дно сверху уже), два обруча,
 * ржавые подтёки, дужка ведра — ремешком под подбородком, щель для глаз.
 * Ржавым и без обручей оно читалось цилиндром (круг 3 самокритики).
 */
function bucket(px: Px, head: V, R: number): void {
  const [hx, hy] = head;
  const top = hy - R - 2.2;
  const bot = hy + 0.8;
  const s = METAL.steel;
  // Дужка — полукруг под мордой, за ведром.
  for (let a = 0.15; a < Math.PI - 0.15; a += 0.18) {
    px.set(
      Math.round(hx + 0.4 + Math.cos(a) * (R + 0.8)),
      Math.round(bot + Math.sin(a) * R * 0.8),
      s[0],
    );
  }
  poly(
    px,
    [
      [hx - R - 0.8, bot],
      [hx - R + 0.8, top],
      [hx + R - 0.2, top],
      [hx + R + 1.6, bot],
    ],
    (x) => (x < hx - R * 0.35 ? s[2] : x < hx + R * 0.45 ? s[1] : s[0]),
  );
  // Обручи: светлая кромка над тёмной.
  for (const t of [0.2, 0.92]) {
    const y = top + (bot - top) * t;
    const w = R - 0.2 + t * 1.2;
    limb(px, [hx - w, y], [hx + w + 0.8, y], 1, s[3]);
    limb(px, [hx - w, y + 1], [hx + w + 0.8, y + 1], 1, s[0]);
  }
  limb(px, [hx - R + 0.6, top], [hx + R - 0.4, top], 1, s[3]);
  // Подтёки ржавчины из-под обручей.
  px.set(Math.round(hx - R * 0.2), Math.round(top + (bot - top) * 0.2 + 2), METAL.rust[1]);
  px.set(Math.round(hx - R * 0.2), Math.round(top + (bot - top) * 0.2 + 3), METAL.rust[0]);
  px.set(Math.round(hx + R * 0.6), Math.round(top + (bot - top) * 0.2 + 2), METAL.rust[1]);
  // Щель: тёмная полоса, в ней светится глаз.
  limb(px, [hx - 0.2, hy - R * 0.3], [hx + R + 0.6, hy - R * 0.3], 1, hex('#120a08'));
}

/** Череп-маска шамана поверх головы, с рогами-перьями. */
function skullMask(px: Px, head: V, R: number): void {
  const [hx, hy] = head;
  oval(px, [hx + 0.3, hy - R * 0.45], R * 1.05, R * 0.85, 0, (k) =>
    k > 0.55 ? BONE[2] : k > 0.1 ? BONE[1] : BONE[0],
  );
  px.set(Math.round(hx + R * 0.35), Math.round(hy - R * 0.45), hex('#1a1410'));
  px.set(Math.round(hx - R * 0.35), Math.round(hy - R * 0.45), hex('#1a1410'));
  // Перья: два торчат назад-вверх.
  limb(px, [hx - R * 0.6, hy - R * 1.1], [hx - R * 1.6, hy - R * 2.2], 1, hex('#5a4a3a'));
  limb(px, [hx - R * 0.2, hy - R * 1.2], [hx - R * 0.8, hy - R * 2.5], 1, hex('#7a3a2a'));
}

/** Корона: обод, три зубца, рубин. */
function crown(px: Px, head: V, R: number, big: boolean): void {
  const [hx, hy] = head;
  const x0 = Math.round(hx - R * 0.85);
  const y0 = Math.round(hy - R * 0.78);
  const cw = Math.round(R * 1.6);
  const ch = big ? 5 : 3;
  const g = METAL.gold;
  // Обод с тенью и бликом, зубцы с шишками, рубин посередине.
  px.rect(x0, y0, x0 + cw, y0 + 2, g[2]);
  px.rect(x0, y0 + 2, x0 + cw, y0 + 2, g[1]);
  px.rect(x0, y0, x0 + 1, y0 + 2, g[3]);
  for (const k of [0, 0.34, 0.67, 1]) {
    const x = Math.round(x0 + cw * k);
    px.rect(x, y0 - ch + 1, x + (big ? 1 : 0), y0, k < 0.5 ? g[2] : g[1]);
    px.set(x, y0 - ch, g[3]);
  }
  px.rect(
    Math.round(x0 + cw / 2),
    y0 + 1,
    Math.round(x0 + cw / 2) + (big ? 1 : 0),
    y0 + 1,
    hex('#d8203a'),
  );
  if (big) px.set(Math.round(x0 + cw / 2), y0 + 1, hex('#ff7a8a'));
}

// ---------------------------------------------------------------------------
// Позы крысолюда: общий скелет по действию и кадру.
// ---------------------------------------------------------------------------

interface Body {
  /** Масштаб скелета. */
  s: number;
  /** Ширина торса (толщина), 1 — крысолюд. */
  bulk: number;
  w: number;
  h: number;
}

/** Базовая поза: покой, бег, замах, выпад, удар, сон, смерть. */
function basePose(b: Body, anim: string, f: number): Rig {
  const { s } = b;
  const gy = b.h - 3;
  const cx = Math.round(b.w / 2);
  let hip: V = [cx - 1 * s, gy - 7 * s];
  let lean = 0.32;
  let bob = 0;
  let headLift = 0;
  let snout = 2.6 * s;
  const drop = 1 * s;
  let jaw = 0;
  let squint = false;
  // Лапы: колено вперёд-вниз от таза, пятка под тазом, пальцы вперёд.
  // Стопа — [сдвиг от таза по x, подъём над землёй].
  let kneeF: V = [1.2 * s, 3.2 * s];
  let kneeN: V = [1.8 * s, 3.2 * s];
  let footF: V = [-1.2 * s, 0];
  let footN: V = [0.2 * s, 0];
  // Руки: локоть и кисть относительно плеча.
  let elbF: V = [0.6 * s, 2.6 * s];
  let handF: V = [2.2 * s, 4.6 * s];
  let elbN: V = [1 * s, 2.8 * s];
  let handN: V = [3 * s, 4.4 * s];
  let tailWave = 0;
  let tailLift = 0;
  const ph = (n: number) => (f / n) * Math.PI * 2;
  switch (anim) {
    case 'idle': {
      bob = [0, 0.35, 0.6, 0.3][f % 4] * s;
      headLift = f % 4 === 2 ? 0.5 : 0;
      snout += f % 4 === 2 ? 0.5 : 0;
      tailWave = Math.sin(ph(4)) * 1.4;
      handN = [3 * s, (4.4 + bob * 0.4) * s];
      break;
    }
    case 'run': {
      const p = ph(6);
      lean = 0.5;
      bob = Math.abs(Math.sin(p)) * 1.2 * s;
      const sw = Math.cos(p) * 3.2 * s;
      const lift = (k: number) => Math.max(0, Math.sin(p + k)) * 2.2 * s;
      footN = [0.2 * s + sw, lift(0)];
      footF = [-0.6 * s - sw, lift(Math.PI)];
      kneeN = [1.8 * s + sw * 0.55, 3.2 * s - lift(0) * 0.6];
      kneeF = [1.2 * s - sw * 0.55, 3.2 * s - lift(Math.PI) * 0.6];
      elbN = [0.4 * s - sw * 0.4, 2.6 * s];
      handN = [2 * s - sw * 0.8, 4 * s];
      elbF = [0.4 * s + sw * 0.3, 2.4 * s];
      handF = [1.6 * s + sw * 0.6, 4 * s];
      tailWave = Math.sin(p + 1.2) * 1.8;
      tailLift = -1;
      break;
    }
    case 'wind': {
      // Замах: откинулся, ближняя лапа с оружием отведена назад-вверх.
      const k = f === 0 ? 0.6 : 1;
      lean = 0.1 - 0.15 * k;
      elbN = [-1.8 * s * k, 0.2 * s];
      handN = [-3.2 * s * k, -1.8 * s * k];
      elbF = [1.4 * s, 1.8 * s];
      handF = [3.4 * s, 2.6 * s];
      kneeN = [2.4 * s, 2.8 * s];
      footN = [2.4 * s, 0];
      kneeF = [0.2 * s, 3.2 * s];
      footF = [-2.4 * s, 0];
      jaw = 0.5 * k;
      tailLift = 1;
      break;
    }
    case 'bite': {
      // Удар: подался вперёд, лапа с оружием вытянута.
      const k = f === 0 ? 1 : 0.6;
      lean = 0.62;
      hip = [hip[0] + 1.2 * s * k, hip[1] + 0.4 * s];
      elbN = [2.6 * s * k, 1.2 * s];
      handN = [5.6 * s * k, 1.6 * s];
      elbF = [-0.6 * s, 2.4 * s];
      handF = [-1 * s, 4.4 * s];
      kneeN = [3 * s, 2.4 * s];
      footN = [3.6 * s, 0];
      kneeF = [-0.6 * s, 3 * s];
      footF = [-3.4 * s, 0];
      jaw = 0.8 * k;
      tailWave = -1;
      break;
    }
    case 'hurt':
      lean = -0.18;
      hip = [hip[0] - 1 * s, hip[1]];
      headLift = -0.6;
      jaw = 0.4;
      squint = true;
      elbN = [0.4 * s, 1 * s];
      handN = [2 * s, -0.6 * s];
      tailLift = -2;
      tailWave = 2;
      break;
    case 'sleep': {
      // Сидит, свернувшись: таз низко, голова на груди.
      const k = f % 2 === 0 ? 0 : 0.4;
      hip = [hip[0], gy - 3.2 * s];
      lean = 0.9;
      bob = k * s;
      headLift = -2.2;
      squint = true;
      kneeN = [2.8 * s, -0.6 * s];
      kneeF = [2.2 * s, -0.4 * s];
      footN = [3.4 * s, 0];
      footF = [2.6 * s, 0];
      elbN = [1.4 * s, 1.6 * s];
      handN = [2.6 * s, 2.6 * s];
      break;
    }
  }
  hip = [hip[0], hip[1] - bob];
  const torsoLen = 7 * s;
  const rig: Rig = {
    hip,
    lean,
    torsoLen,
    rx: 3.2 * s * b.bulk,
    ry: 4.4 * s,
    head: [0, 0],
    headR: 2.9 * s,
    snout,
    drop,
    jaw,
    squint,
    legFar: [add(hip, [-0.8 * s, 0.4 * s]), [0, 0], [0, 0]],
    legNear: [add(hip, [0.6 * s, 0.6 * s]), [0, 0], [0, 0]],
    armFar: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    armNear: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    tail: [],
    lw: 1.9 * s,
    aw: 1.7 * s,
    items: [],
    cloth: null,
    ear: true,
  };
  const neck = neckOf(rig);
  rig.head = add(neck, [1.6 * s + Math.sin(lean) * 1.4 * s, -1.9 * s - headLift * s]);
  // Колено и стопа — от таза вниз, стопа на земле.
  const gnd = (x: number, lift: number): V => [hip[0] + x, gy - lift];
  rig.legFar[1] = add(rig.legFar[0], kneeF);
  rig.legFar[2] = gnd(footF[0] - 0.8 * s, footF[1]);
  rig.legNear[1] = add(rig.legNear[0], kneeN);
  rig.legNear[2] = gnd(footN[0] + 0.6 * s, footN[1]);
  const shoulder = add(neck, [-0.6 * s, 1.2 * s]);
  rig.armFar = [add(shoulder, [-0.6 * s, 0]), add(shoulder, elbF), add(shoulder, handF)];
  rig.armNear = [add(shoulder, [0.4 * s, 0.3 * s]), add(shoulder, elbN), add(shoulder, handN)];
  // Хвост: от основания назад, по земле, кончик загнут.
  const t0 = add(hip, [-2.4 * s, 1.2 * s]);
  const L = 9 * s;
  rig.tail = [
    t0,
    [t0[0] - L * 0.3, t0[1] + 1.6 * s + tailWave * 0.3 + tailLift * 0.4],
    [t0[0] - L * 0.6, Math.min(gy + 1, t0[1] + 3 * s + tailWave * 0.8 + tailLift)],
    [t0[0] - L * 0.85, Math.min(gy + 1, t0[1] + 2.6 * s + tailWave * 1.2 + tailLift * 1.5)],
    [t0[0] - L, t0[1] + 1 * s + tailWave * 1.6 + tailLift * 2],
  ];
  return rig;
}

/** Мёртвый: лежит на боку — торс вдоль земли, лапы торчат. */
function deadPose(b: Body): Rig {
  const r = basePose(b, 'idle', 0);
  const { s } = b;
  const gy = b.h - 3;
  r.hip = [Math.round(b.w / 2) - 4 * s, gy - 2.4 * s];
  r.lean = Math.PI / 2 - 0.05;
  const neck = neckOf(r);
  r.head = add(neck, [2 * s, 0.6 * s]);
  r.squint = false;
  r.jaw = 0.3;
  r.legFar = [add(r.hip, [0, 0]), add(r.hip, [-2 * s, -2 * s]), add(r.hip, [-3.6 * s, -3.4 * s])];
  r.legNear = [
    add(r.hip, [0.6 * s, 0.6 * s]),
    add(r.hip, [-1 * s, -2.8 * s]),
    add(r.hip, [-1.6 * s, -4.4 * s]),
  ];
  const sh = add(neck, [-0.6 * s, -0.4 * s]);
  r.armFar = [sh, add(sh, [0.4 * s, -2.4 * s]), add(sh, [1.4 * s, -3.8 * s])];
  r.armNear = [sh, add(sh, [1.6 * s, -1.8 * s]), add(sh, [3 * s, -2.6 * s])];
  r.tail = [add(r.hip, [-2 * s, 1 * s]), [r.hip[0] - 5 * s, gy], [r.hip[0] - 9 * s, gy - 0.4]];
  return r;
}

// ---------------------------------------------------------------------------
// Виды крысолюдов.
// ---------------------------------------------------------------------------

const RATMAN: Body = { s: 1, bulk: 1, w: 32, h: 28 };
const SLINGER: Body = { s: 0.95, bulk: 0.88, w: 32, h: 30 };
const SHAMAN: Body = { s: 1.02, bulk: 1.05, w: 32, h: 34 };
const GUARD: Body = { s: 1.22, bulk: 1.3, w: 40, h: 34 };

/** Режим ИИ → действие и кадр для своих поз. */
interface Want {
  anim: string;
  f: number;
  mode: string;
  t: number;
}

function wantOf(pose: MobPose, runFrames = 6): Want {
  const anim: string = pose.anim;
  let f = pose.frame;
  if (anim === 'run') f = ((f % runFrames) + runFrames) % runFrames;
  else if (anim === 'idle' || anim === 'wind' || anim === 'bite' || anim === 'sleep') {
    const n = RAT_FRAMES[anim as RatAnim];
    f = ((f % n) + n) % n;
  } else f = 0;
  return { anim, f, mode: pose.mode, t: pose.t };
}

function ratmanRig(want: Want): Rig {
  const b = RATMAN;
  const { s } = b;
  let anim = want.anim;
  let f = want.f;
  let blade = { ang: 1.2, back: false };
  // Свои позы крысолюда.
  if (want.mode === 'feint') {
    anim = 'wind';
    f = want.t < 0.15 ? 0 : 1;
  } else if (want.mode === 'lungeAim') {
    anim = 'wind';
    f = 1;
  } else if (want.mode === 'lunge') {
    anim = 'bite';
    f = 0;
  } else if (want.mode === 'hop') {
    anim = 'run';
    f = 1;
  } else if (want.mode === 'recover' && want.t < 0.3) {
    anim = 'bite';
    f = 1;
  }
  const r = anim === 'dead' ? deadPose(b) : basePose(b, anim, f);
  if (want.mode === 'lungeAim') {
    // Присел перед выпадом: таз ниже, торс вперёд, заточка у бедра.
    r.hip = add(r.hip, [0, 1.4 * s]);
    r.lean = 0.7;
    const neck = neckOf(r);
    r.head = add(neck, [2.2 * s, -1.2 * s]);
    const sh = add(neck, [-0.6 * s, 1.2 * s]);
    r.armNear = [sh, add(sh, [-1.6 * s, 2 * s]), add(sh, [-0.4 * s, 4 * s])];
    r.armFar = [sh, add(sh, [1 * s, 2 * s]), add(sh, [3 * s, 2.6 * s])];
    r.legNear[1] = add(r.legNear[0], [3 * s, -1.4 * s]);
  }
  if (want.mode === 'lunge') {
    r.hip = add(r.hip, [1.5 * s, 0.6 * s]);
    r.lean = 1.0;
    const neck = neckOf(r);
    r.head = add(neck, [2.4 * s, -0.6 * s]);
    const sh = add(neck, [-0.4 * s, 1 * s]);
    r.armNear = [sh, add(sh, [2.4 * s, 0.4 * s]), add(sh, [5.4 * s, 0.4 * s])];
    r.legFar[2] = [r.hip[0] - 5 * s, RATMAN.h - 3];
    r.legFar[1] = lerp(r.legFar[0], r.legFar[2], 0.5);
  }
  r.cloth = CLOTH.rag;
  // Заточка обратным хватом: в покое вниз, в замахе вверх, в ударе вперёд.
  if (anim === 'wind' || want.mode === 'feint') blade = { ang: -1.9, back: false };
  else if (anim === 'bite' || want.mode === 'lunge') blade = { ang: 0.05, back: false };
  else if (anim === 'run') blade = { ang: 2.2, back: false };
  else if (anim === 'dead') blade = { ang: 0.4, back: true };
  if (anim !== 'sleep') {
    const hand = r.armNear[2];
    const bl = blade;
    r.items.push({
      layer: bl.back ? 'back' : 'hand',
      draw: (px) => drawShiv(px, bl.back ? add(r.hip, [6 * s, 2 * s]) : hand, bl.ang),
    });
  }
  return r;
}

function drawShiv(px: Px, hand: V, ang: number): void {
  blade(px, hand, ang, { grip: 1.6, len: 4.4, w: 1.6, metal: METAL.steel });
}

function slingerRig(want: Want): Rig {
  const b = SLINGER;
  const { s } = b;
  let anim = want.anim;
  const f = want.f;
  if (want.mode === 'aim') anim = 'idle';
  if (want.mode === 'recover' && want.t < 0.35) anim = 'bite';
  const r = anim === 'dead' ? deadPose(b) : basePose(b, anim, anim === 'bite' ? 0 : f);
  r.cloth = CLOTH.hide;
  const neck = neckOf(r);
  // Красная повязка на лбу — примета пращника издали.
  const R = r.headR;
  const hd = r.head;
  r.items.push({
    layer: 'front',
    draw: (px) => {
      limb(
        px,
        [hd[0] - R * 0.8, hd[1] - R * 0.55],
        [hd[0] + R * 0.6, hd[1] - R * 0.7],
        1.2,
        CLOTH.red[1],
      );
      limb(
        px,
        [hd[0] - R * 0.9, hd[1] - R * 0.5],
        [hd[0] - R * 1.9, hd[1] + R * 0.1],
        1,
        CLOTH.red[0],
      );
    },
  });
  // Сумка с камнями на бедре и ремень через грудь.
  const hip = r.hip;
  r.items.push({
    layer: 'mid',
    draw: (px) => {
      limb(px, add(neck, [-1 * s, 0.6 * s]), add(hip, [2 * s, 0.6 * s]), 1, CLOTH.hide[0]);
      px.ell(hip[0] - 1.4 * s, hip[1] + 1.2 * s, 1.6 * s, 1.4 * s, CLOTH.hide[1]);
      px.set(Math.round(hip[0] - 1.8 * s), Math.round(hip[1] + 0.6 * s), CLOTH.hide[2]);
    },
  });
  if (want.mode === 'aim') {
    // Праща над головой: кисть поднята, ремень с камнем крутится.
    const sh = add(neck, [-0.2 * s, 1 * s]);
    r.armNear = [sh, add(sh, [1.2 * s, -2.2 * s]), add(sh, [1.6 * s, -4.6 * s])];
    r.jaw = 0.3;
    const hand = r.armNear[2];
    const a = Math.floor(want.t * 16) * (Math.PI / 3);
    const stone: V = add(hand, [Math.cos(a) * 4.4 * s, Math.sin(a) * 1.8 * s - 1.4 * s]);
    r.items.push({
      layer: 'hand',
      draw: (px) => {
        limb(px, hand, stone, 1, hex('#6a5038'));
        px.ell(stone[0], stone[1], 1.2, 1.2, hex('#8a8478'));
        px.set(Math.round(stone[0] - 0.5), Math.round(stone[1] - 0.5), hex('#c8c0b0'));
        // След вращения: дуга светлых точек.
        for (let k = 1; k <= 3; k++) {
          const aa = a - k * 0.55;
          px.set(
            Math.round(hand[0] + Math.cos(aa) * 4.4 * s),
            Math.round(hand[1] + Math.sin(aa) * 1.8 * s - 1.4 * s),
            [230, 220, 200, 200 - k * 50],
          );
        }
      },
    });
  } else if (anim !== 'sleep' && anim !== 'dead') {
    // Праща свисает из кисти.
    const hand = r.armNear[2];
    const end: V = anim === 'bite' ? add(hand, [3.6 * s, -1.4 * s]) : add(hand, [0.6 * s, 3 * s]);
    r.items.push({
      layer: 'hand',
      draw: (px) => {
        limb(px, hand, end, 1, hex('#6a5038'));
        px.ell(end[0], end[1], 1, 1, hex('#6a5038'));
      },
    });
  }
  return r;
}

function shamanRig(want: Want): Rig {
  const b = SHAMAN;
  const { s } = b;
  let anim = want.anim;
  if (want.mode === 'cast' || want.mode === 'call') anim = 'idle';
  const r = anim === 'dead' ? deadPose(b) : basePose(b, anim, want.f);
  // Горб: сильнее сутулится, голова ниже.
  if (anim !== 'dead') {
    r.lean += 0.2;
    const neck = neckOf(r);
    r.head = add(neck, [1.8 * s, -1.2 * s]);
    const sh = add(neck, [-0.6 * s, 1.2 * s]);
    r.armFar = [sh, add(sh, [0.4 * s, 2.2 * s]), add(sh, [1.6 * s, 3.6 * s])];
    r.armNear = [sh, add(sh, [1 * s, 2.4 * s]), add(sh, [3 * s, 3.6 * s])];
  }
  r.ear = false;
  r.cloth = CLOTH.hide;
  const neck = neckOf(r);
  const casting = want.mode === 'cast' || want.mode === 'call';
  const pulse = casting ? Math.floor(want.t * 10) % 3 : 0;
  if (casting) {
    // Посох поднят над головой, пасть открыта.
    const sh = add(neck, [-0.6 * s, 1 * s]);
    r.armFar = [sh, add(sh, [1.4 * s, -2.6 * s]), add(sh, [2.4 * s, -5 * s])];
    if (want.mode === 'call')
      r.armNear = [sh, add(sh, [2 * s, -1.8 * s]), add(sh, [3.4 * s, -4 * s])];
    r.jaw = 0.7;
  }
  // Плащ из шкур: полукруг за спиной.
  const hip = r.hip;
  r.items.push({
    layer: 'back',
    draw: (px) => {
      poly(
        px,
        [
          add(neck, [-1.6 * s, -0.4 * s]),
          add(neck, [1 * s, 0]),
          add(hip, [1.4 * s, 2.4 * s]),
          add(hip, [-3.4 * s, 2.6 * s]),
        ],
        (x, y) =>
          (x + y) % 5 === 0 ? CLOTH.hide[0] : x < hip[0] - 1 ? CLOTH.hide[1] : CLOTH.hide[0],
      );
    },
  });
  if (anim !== 'dead') {
    const hd = r.head;
    const R = r.headR;
    r.items.push({ layer: 'front', draw: (px) => skullMask(px, hd, R) });
  }
  // Посох в дальней руке: древко, на верхушке череп и зелёный огонь.
  if (anim !== 'sleep') {
    const hand = r.armFar[2];
    const top: V =
      anim === 'dead'
        ? add(hip, [7 * s, 1 * s])
        : casting
          ? add(hand, [0.6 * s, -6 * s])
          : add(hand, [0.4 * s, -9 * s]);
    const bot: V =
      anim === 'dead'
        ? add(hip, [-5 * s, 2.4 * s])
        : casting
          ? add(hand, [-0.4 * s, 3 * s])
          : [hand[0] - 0.2 * s, b.h - 3];
    r.items.push({
      layer: 'back',
      draw: (px) => {
        limb(px, bot, top, 1.4, WOOD[1], WOOD[2]);
        px.ell(top[0], top[1] + 0.6, 1.6, 1.4, BONE[1]);
        px.set(Math.round(top[0] + 0.5), Math.round(top[1] + 0.6), hex('#1a1410'));
        if (anim !== 'dead') {
          const fr = casting ? 2.2 + pulse * 0.6 : 1.4;
          px.ell(top[0], top[1] - 1.4 - pulse * 0.3, fr, fr + 0.8, GREEN[1]);
          px.ell(top[0], top[1] - 1.2, fr * 0.55, fr * 0.7, GREEN[2]);
          px.set(Math.round(top[0]), Math.round(top[1] - 1), GREEN[3]);
          if (casting)
            for (let k = 0; k < 3; k++) {
              const a = want.t * 6 + k * 2.1;
              px.set(
                Math.round(top[0] + Math.cos(a) * 3.6),
                Math.round(top[1] - 1 + Math.sin(a) * 2.6),
                GREEN[2],
              );
            }
        }
      },
    });
  }
  return r;
}

function guardRig(want: Want): Rig {
  const b = GUARD;
  const { s } = b;
  let anim = want.anim;
  const mode = want.mode;
  if (mode === 'bashAim' || mode === 'bash' || mode === 'chase' || mode === 'alert') {
    if (anim !== 'run') anim = 'idle';
  }
  if (mode === 'dizzy') anim = 'hurt';
  if (mode === 'recover' && want.t < 0.5) anim = 'bite';
  const r = anim === 'dead' ? deadPose(b) : basePose(b, anim, want.f);
  r.ear = false;
  r.cloth = CLOTH.rag;
  if (mode === 'bashAim' || mode === 'bash') {
    // Прижался к щиту: таз ниже, торс вперёд.
    r.hip = add(r.hip, [mode === 'bash' ? 1.4 * s : 0, 1 * s]);
    r.lean = 0.62;
    const nk = neckOf(r);
    r.head = add(nk, [1.4 * s, -1.2 * s]);
  }
  const nk = neckOf(r);
  const sh = add(nk, [-0.6 * s, 1.2 * s]);
  // Щит (ближняя рука): впереди торса, пока латник закрыт.
  const shieldUp = anim !== 'dead' && anim !== 'sleep' && mode !== 'dizzy' && !(mode === 'recover');
  const lidC: V = shieldUp
    ? add(nk, [mode === 'bash' ? 4.4 * s : 3.4 * s, 3 * s])
    : add(r.hip, [2.6 * s, 1.6 * s]);
  if (shieldUp) r.armNear = [sh, add(sh, [2 * s, 1.4 * s]), add(lidC, [-0.6 * s, 0])];
  // Булава (дальняя рука): в замахе над головой, после удара — вперёд-вниз.
  let clubAng = -1.1;
  let hand = r.armFar[2];
  if (anim === 'wind' || mode === 'windup') {
    r.armFar = [sh, add(sh, [-1 * s, -2.4 * s]), add(sh, [-0.6 * s, -5 * s])];
    hand = r.armFar[2];
    clubAng = want.t > 0.35 ? -2.4 : -2;
  } else if (anim === 'bite') {
    r.armFar = [sh, add(sh, [2.4 * s, 0.8 * s]), add(sh, [4.6 * s, 2.6 * s])];
    hand = r.armFar[2];
    clubAng = 0.7;
  } else {
    hand = r.armFar[2];
    clubAng = anim === 'run' ? -1.4 : -1.2;
  }
  if (anim !== 'sleep') {
    const hd = hand;
    const ca = clubAng;
    r.items.push({ layer: 'back', draw: (px) => club(px, hd, ca, 7 * s) });
  }
  if (anim !== 'dead') {
    const hd = r.head;
    const R = r.headR;
    r.items.push({ layer: 'front', draw: (px) => bucket(px, hd, R) });
    // Наплечник — кусок кастрюли.
    r.items.push({
      layer: 'mid',
      draw: (px) =>
        oval(px, add(sh, [0.4 * s, 0.4 * s]), 2.2 * s, 1.6 * s, r.lean, (k) =>
          k > 0.5 ? METAL.iron[3] : k > 0.1 ? METAL.iron[2] : METAL.iron[1],
        ),
    });
  }
  r.items.push({
    layer: 'hand',
    draw: (px) => lid(px, lidC, 3.4 * s, 4.2 * s, METAL.steel),
  });
  if (mode === 'dizzy') {
    const hd = r.head;
    const t = want.t;
    r.items.push({
      layer: 'hand',
      draw: (px) => {
        for (let k = 0; k < 3; k++) {
          const a = t * 7 + k * 2.1;
          px.set(
            Math.round(hd[0] + Math.cos(a) * 4),
            Math.round(hd[1] - 6 + Math.sin(a) * 1.4),
            hex('#ffe060'),
          );
        }
      },
    });
  }
  return r;
}

/** Облик палитры: элита — рыжая с золотым кантом, альбинос — белый. */
function furOf(base: Fur, look: MobPose['look']): Fur {
  if (look === 'albino') return FUR.albino;
  if (look === 'elite') return { ...FUR.elite, eye: base.eye };
  return base;
}

/** Цвет канта чар: жёлтый — прыть, красный — ярость, зелёный — лечение. */
const BUFF_COL: Record<number, RGBA> = {
  1: hex('#ffe070'),
  2: hex('#ff5a3a'),
  4: hex('#8cff6a'),
};

const frames = new Map<string, MobFrame>();

/** Режимы, поза которых зависит от времени внутри режима. */
const TIMED = new Set([
  'feint',
  'aim',
  'cast',
  'call',
  'windup',
  'recover',
  'dizzy',
  'swap',
  'leap',
  'cleaveAim',
  'whipAim',
  'sweepAim',
  'leapAim',
]);

/** Общая выдача кадра крысолюда: рисунок, зеркало, вспышка, кеш. */
function bipedFrame(
  kind: string,
  body: Body,
  make: (w: Want) => Rig,
  base: Fur,
  m: Mob,
  pose: MobPose,
  extra: (w: Want) => string = () => '',
): MobFrame {
  const want = wantOf(pose);
  // Свои позы зависят от времени в режиме — квантуем его; покою и бегу
  // время не нужно, иначе кеш рос бы на каждую десятую секунды погони.
  const tq = TIMED.has(want.mode) ? Math.min(40, Math.floor(want.t * 10)) : 0;
  const buff = m.data?.f1buff ?? 0;
  const key = `${kind}|${want.anim}|${want.f}|${want.mode}|${tq}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}|${buff}|${extra(want)}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const f = furOf(base, pose.look);
  const w2: Want = { ...want, t: tq / 10 };
  const rig = make(w2);
  let px = drawRig(rig, f, body.w, body.h);
  finish(px, pose.look);
  // Чары шамана — кант цвета чары (как у крыс).
  if (buff) {
    const col = BUFF_COL[buff & 4 ? 4 : buff & 2 ? 2 : 1];
    px.outline([col[0], col[1], col[2], 200]);
  }
  paintEye(px, rig, f, want.anim === 'dead');
  const [ex, ey] = eyeOf(rig);
  if (pose.left) px = px.flipX();
  if (pose.flash) px = px.tint(WHITE, 0.9);
  const cx = Math.round(body.w / 2);
  const out: MobFrame = {
    img: px.canvas(),
    ax: pose.left ? body.w - cx : cx,
    ay: body.h - 2,
    eye: [pose.left ? body.w - 1 - ex : ex, ey],
  };
  frames.set(key, out);
  return out;
}

registerMobPainter('f1_ratman', (m, pose) =>
  bipedFrame('ratman', RATMAN, ratmanRig, FUR.ratman, m, pose),
);
registerMobPainter('f1_slinger', (m, pose) =>
  bipedFrame('slinger', SLINGER, slingerRig, FUR.slinger, m, pose),
);
registerMobPainter('f1_shaman', (m, pose) =>
  bipedFrame('shaman', SHAMAN, shamanRig, FUR.shaman, m, pose),
);
registerMobPainter('f1_guard', (m, pose) =>
  bipedFrame('guard', GUARD, guardRig, FUR.guard, m, pose),
);

// ---------------------------------------------------------------------------
// Крысы с чарами шамана: кадр крысы + кант цвета чар и искры.
// ---------------------------------------------------------------------------

registerMobPainter('f1_rat', (m, pose) => {
  const anim = pose.anim as RatAnim;
  const n = RAT_FRAMES[anim] ?? 1;
  const f = ((Math.floor(pose.frame) % n) + n) % n;
  const buff = m.data?.f1buff ?? 0;
  const key = `rat|${m.kind}|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}|${buff}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const size = ratSize(m.kind);
  let px = ratPx(m.kind, pose.look, anim, f, pose.left, pose.flash);
  if (buff && !pose.flash) {
    // Кант снаружи контура: жёлтый — прыть, красный — ярость, зелёный — лечение.
    const col = BUFF_COL[buff & 4 ? 4 : buff & 2 ? 2 : 1];
    const big = new Px(px.w, px.h + 4);
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) big.set(x, y + 4, px.get(x, y));
    big.outline([col[0], col[1], col[2], 200]);
    // Искры над спиной.
    const sx = pose.left ? px.w - size.body : size.body;
    big.set(sx - 3, 1, col);
    big.set(sx + 1, 0, col);
    big.set(sx + 4, 2, col);
    if (buff & 1) {
      // Прыть: полосы скорости за хвостом.
      const back = pose.left ? px.w - 3 : 2;
      for (const yy of [8, 11, 14]) big.set(back, yy, [255, 240, 150, 180]);
    }
    px = big;
  }
  const [ex, ey] = ratEye(m.kind, anim === 'dead' ? 'idle' : anim, f);
  const dy = px.h - size.h;
  const out: MobFrame = {
    img: px.canvas(),
    ax: pose.left ? size.w - size.body : size.body,
    ay: size.h - 2 + dy,
    eye: [pose.left ? size.w - 1 - ex : ex, ey + dy],
  };
  frames.set(key, out);
  return out;
});

// ⟦king-begin⟧
// ---------------------------------------------------------------------------
// Крысиный король 2.0 и малые короли — анимация (v2.85, библия §14).
//
// Владелец: «сами боссы нравятся, анимация — ужас». Облик короля прежний
// (крысолюд в короне, горностае и плаще, узел хвостов с привязанными
// малыми, тесак с крышкой, на последней полосе — рельс), а движение
// собрано заново по правилам меча героя:
//   • поза — числа (`KP`): таз, наклон, голова, пасть, стопы, кисти, угол
//     оружия, хвосты, плащ; колени и локти решает обратная кинематика,
//     поэтому присед, выпад и прыжок не ломают лап;
//   • техника — дорожка ключевых поз (`Key`) с кривыми разгона и
//     торможения, 24 к/с от `pose.t`; мозг — метроном: последние кадры
//     замаха привязаны к концу замаха, кадр контакта — первый кадр
//     следующего режима, ровно в миг урона;
//   • след оружия (smear) — область, которую клинок прошёл между кадрами,
//     считается по той же дорожке; яркая кромка ещё и в `lit`;
//   • плащ и хвосты отстают: берут позу из прошлого и тянутся за
//     скоростью тела;
//   • общий ход тела (выпад, прыжок, вес, отдача от удара героя) — полями
//     движка `dx/dy/sx/sy/rot`, непрерывно;
//   • клубок — настоящий шар: узор (хвосты, плащ, корона, горностай)
//     лежит на сфере и поворачивается вокруг оси качения, а свет стоит
//     на месте — поэтому видно качение, а не вертящуюся картинку.
// Кадры — в `frameLRU`, техники первой фазы прогреваются заранее.
// ---------------------------------------------------------------------------

const KING: Body = { s: 2.05, bulk: 1.28, w: 84, h: 64 };
const KS = KING.s;
const FPS = 24;
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Холст кадра: обычный и широкий (кольцо хлыста, смерть, бросок). */
interface Geo {
  w: number;
  h: number;
  cx: number;
  /** Земля (строка ступней). */
  gy: number;
  id: string;
}
const GEO_N: Geo = { w: 92, h: 70, cx: 46, gy: 64, id: 'n' };
const GEO_W: Geo = { w: 124, h: 92, cx: 62, gy: 76, id: 'w' };

/**
 * Сустав двухзвенника: корень `a`, цель `c`, длины звеньев, `side` +1 —
 * сустав по часовой стрелке от линии «корень → цель». Возвращает сустав и
 * конец (цель, если дотянулся).
 */
function ik2(a: V, c: V, l1: number, l2: number, side: number): [V, V] {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const d = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / d;
  const uy = dy / d;
  const dd = clamp(d, Math.abs(l1 - l2) + 0.05, l1 + l2 - 0.05);
  const cosA = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1);
  const A = Math.acos(cosA) * side;
  const cs = Math.cos(A);
  const sn = Math.sin(A);
  return [
    [a[0] + l1 * (ux * cs - uy * sn), a[1] + l1 * (ux * sn + uy * cs)],
    [a[0] + ux * dd, a[1] + uy * dd],
  ];
}

// ---- Поза числами --------------------------------------------------------

/**
 * Поза короля. Длины — в долях роста `s`, углы — радианы, всё смотрит
 * вправо. Значения по умолчанию (`REST`) дают прежний кадр покоя.
 */
interface KP {
  /** Таз: сдвиг от места покоя (y вниз). */
  hx: number;
  hy: number;
  /** Наклон торса вперёд. */
  ln: number;
  /** Голова: сдвиг от места у шеи. */
  nx: number;
  ny: number;
  /** Пасть 0…1, морда длиннее, опущена (1) или задрана (< 0), прищур (≥ 0,5). */
  jaw: number;
  sn: number;
  dr: number;
  sq: number;
  /** Стопы: x от таза, подъём над землёй (дальняя, ближняя). */
  ffx: number;
  ffl: number;
  nfx: number;
  nfl: number;
  /** Кисти от плеча (дальняя с крышкой, ближняя с оружием). */
  fhx: number;
  fhy: number;
  nhx: number;
  nhy: number;
  /** Сторона локтя: ≥ 0 — по часовой (как в покое). */
  ebn: number;
  ebf: number;
  /** Угол оружия в ближней руке. */
  wa: number;
  /** Хвосты: качание, подъём над спиной, закрутка. */
  ts: number;
  tu: number;
  tc: number;
  /** Плащ: взлёт подола назад-вверх и качание. */
  cf: number;
  cs: number;
  /** Корона: наклон. */
  ca: number;
  /** Комок: торс короче и круглее (сворачивается в клубок) 0…1. */
  bl: number;
}

const REST: KP = {
  hx: 0,
  hy: 0,
  ln: 0.32,
  nx: 0,
  ny: 0,
  jaw: 0,
  sn: 0,
  dr: 1,
  sq: 0,
  ffx: -2,
  ffl: 0,
  nfx: 0.8,
  nfl: 0,
  fhx: 2.2,
  fhy: 4.6,
  nhx: 3,
  nhy: 4.4,
  ebn: 1,
  ebf: 1,
  wa: 1.3,
  ts: 0,
  tu: 0,
  tc: 0,
  cf: 0,
  cs: 0,
  ca: 0,
  bl: 0,
};
const KP_FIELDS = Object.keys(REST) as (keyof KP)[];
const kp = (base: KP, over: Partial<KP>): KP => ({ ...base, ...over });

function mixKP(a: KP, b: KP, k: number): KP {
  const o = { ...a };
  for (const f of KP_FIELDS) o[f] = a[f] + (b[f] - a[f]) * k;
  return o;
}

/** Кривые: разгон, торможение, «вдох-выдох», перелёт. */
type Ease = (k: number) => number;
const EZ = {
  lin: (k: number) => k,
  in2: (k: number) => k * k,
  in3: (k: number) => k * k * k,
  out2: (k: number) => 1 - (1 - k) * (1 - k),
  out3: (k: number) => 1 - (1 - k) ** 3,
  io: (k: number) => k * k * (3 - 2 * k),
  /** Держать прежнюю позу до следующего ключа. */
  hold: () => 0,
} satisfies Record<string, Ease>;

/** Ключ дорожки: к моменту `t` поза `p`, дорога к ней — по кривой `e`. */
interface Key {
  t: number;
  p: KP;
  e?: Ease;
}

function track(keys: Key[], T: number): KP {
  if (T <= keys[0].t) return keys[0].p;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (T < b.t) {
      const a = keys[i - 1];
      const k = (b.e ?? EZ.io)((T - a.t) / Math.max(1e-6, b.t - a.t));
      return mixKP(a.p, b.p, k);
    }
  }
  return keys[keys.length - 1].p;
}

/** Число по дорожке `[t, v, кривая]` — для трансформа и мелочей. */
function curve(keys: [number, number, Ease?][], T: number): number {
  if (T <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (T < b[0]) {
      const a = keys[i - 1];
      const k = (b[2] ?? EZ.io)((T - a[0]) / Math.max(1e-6, b[0] - a[0]));
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return keys[keys.length - 1][1];
}

// ---- Что сверх позы: оружие, след, глаза, мелочи --------------------------

type Weapon = 'cleaver' | 'rail' | 'none';

interface KFx {
  weapon: Weapon;
  /**
   * Слой оружия: за телом (`back`), за головой, но поверх торса (`mid`,
   * рельс на плече), иначе — поверх всего, со своим контуром.
   */
  wLayer?: 'back' | 'mid';
  /** Рельс одной рукой (на плече); иначе вторая кисть — на рукояти. */
  oneHand?: boolean;
  /** Рельс виден лишь частью — вынимается из-за спины (0…1). */
  wShow?: number;
  /** Крышка-щит на дальней руке (у тесака). */
  lid?: boolean;
  /** След оружия: время дорожки «от» и «до», сила 0…1. */
  smear?: [number, number, number];
  /** Глаз: открыт, прищур, злой, кружится, мёртв. */
  eye?: 'open' | 'squint' | 'angry' | 'dizzy' | 'dead';
  /** Звёзды над головой — фаза. */
  stars?: number;
  /** Блеск на кромке оружия 0…1 (сигнал «сейчас ударит»). */
  glint?: number;
  /** Искра удара о крышку: точка у дальней кисти, сила. */
  spark?: number;
  /** Пар из ноздрей 0…1. */
  steam?: number;
  /** Брызги рыка 0…1. */
  roar?: number;
  /** Корона слетела: где лежит (пиксели от ног), наклон. */
  crownOff?: [number, number, number];
  /** Оружие на полу: где (пиксели от ног), угол. */
  dropped?: [number, number, number];
  /** Хвосты: волна (фаза) и её размах. */
  wave?: number;
  waveAmp?: number;
  /** Хвосты безвольно лежат (смерть). */
  limp?: number;
  /** Кольцо хвостов при развороте хлыста: фаза 0…1 и сила. */
  whirl?: [number, number];
  /** Ширина тела на развороте (трансформ `sx`): кольцо рисуется шире на 1/sx. */
  whirlSx?: number;
  /** Крышка отлетела: где она (пиксели от ног). */
  lidAt?: [number, number];
  /** Кадр смотрит в другую сторону (разворот). */
  flip?: boolean;
  /** Привязанные малые летят по кольцу, а не висят на хвостах. */
  noTied?: boolean;
  /** Растворение 0…1 (смерть). */
  dissolve?: number;
}

interface Shot {
  p: KP;
  fx: KFx;
}

/** Общий ход тела поверх кадра (движок: dx/dy/sx/sy/rot), вправо. */
interface Xf {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  shadow?: number;
  ghost?: MobFrame['ghost'];
  alpha?: number;
}
const XF0: Xf = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };

/**
 * Клип — техника целиком: поза по времени, ход тела, холст. Время клипа
 * сквозное через несколько режимов мозга (замах → отдых), чтобы след и
 * отстающие части видели прошлое.
 */
interface Clip {
  id: string;
  geo: Geo;
  at(T: number): Shot;
  /** Ход тела: `T` — непрерывное время, `Tq` — время кадра (для ступенчатого). */
  xf?(T: number, Tq: number): Xf;
  /** Зациклен (покой, бег): время по модулю `loop`. */
  loop?: number;
}

// ---- Скелет по позе -------------------------------------------------------

/** Длины звеньев — из позы покоя, чтобы кинематика вернула прежний кадр. */
const LEG_N: [number, number] = [Math.hypot(1.8, 3.2) * KS, Math.hypot(1.6, 3.2) * KS];
const LEG_F: [number, number] = [Math.hypot(1.2, 3.2) * KS, Math.hypot(2.4, 3.4) * KS];
const ARM_N: [number, number] = [Math.hypot(0.6, 2.5) * KS, Math.hypot(2, 1.6) * KS];
const ARM_F: [number, number] = [Math.hypot(1.2, 2.6) * KS, Math.hypot(1.6, 2) * KS];

interface KRig {
  r: Rig;
  sh: V;
  neck: V;
}

function kRig(P: KP, G: Geo): KRig {
  const s = KS;
  const hip: V = [G.cx - s + P.hx * s, G.gy - 7 * s + P.hy * s];
  const z: V = [0, 0];
  const r: Rig = {
    hip,
    lean: P.ln,
    torsoLen: 7 * s * (1 - 0.3 * P.bl),
    rx: 3.2 * s * KING.bulk * (1 + 0.18 * P.bl),
    ry: 5.2 * s * (1 - 0.26 * P.bl),
    head: z,
    headR: 2.9 * s,
    snout: (2.6 + P.sn) * s,
    drop: P.dr * s,
    jaw: clamp(P.jaw, 0, 1),
    squint: P.sq >= 0.5,
    legFar: [z, z, z],
    legNear: [z, z, z],
    armFar: [z, z, z],
    armNear: [z, z, z],
    tail: [],
    lw: 1.9 * s,
    aw: 1.7 * s,
    items: [],
    cloth: null,
    ear: true,
  };
  const neck = neckOf(r);
  r.head = add(neck, [1.6 * s + Math.sin(P.ln) * 1.4 * s + P.nx * s, -1.9 * s + P.ny * s]);
  const rf = add(hip, [-0.8 * s, 0.4 * s]);
  const [kf, ff] = ik2(rf, [hip[0] + P.ffx * s, G.gy - P.ffl * s], LEG_F[0], LEG_F[1], -1);
  r.legFar = [rf, kf, ff];
  const rn = add(hip, [0.6 * s, 0.6 * s]);
  const [kn, fn] = ik2(rn, [hip[0] + P.nfx * s, G.gy - P.nfl * s], LEG_N[0], LEG_N[1], -1);
  r.legNear = [rn, kn, fn];
  const sh = add(neck, [-0.6 * s, 1.2 * s]);
  const raf = add(sh, [-0.6 * s, 0]);
  const [ef, hf] = ik2(raf, add(sh, [P.fhx * s, P.fhy * s]), ARM_F[0], ARM_F[1], P.ebf >= 0 ? 1 : -1);
  r.armFar = [raf, ef, hf];
  const ran = add(sh, [0.4 * s, 0.3 * s]);
  const [en, hn] = ik2(ran, add(sh, [P.nhx * s, P.nhy * s]), ARM_N[0], ARM_N[1], P.ebn >= 0 ? 1 : -1);
  r.armNear = [ran, en, hn];
  // Простой хвост по земле (как у всех крысолюдов) — под узлом.
  const t0 = add(hip, [-2.4 * s, 1.2 * s]);
  const L = 9 * s;
  const wv = P.ts * 1.4;
  const lf = -P.tu * 2;
  const gy1 = G.gy + 1;
  r.tail = [
    t0,
    [t0[0] - L * 0.3, t0[1] + 1.6 * s + wv * 0.3 + lf * 0.4],
    [t0[0] - L * 0.6, Math.min(gy1, t0[1] + 3 * s + wv * 0.8 + lf)],
    [t0[0] - L * 0.85, Math.min(gy1, t0[1] + 2.6 * s + wv * 1.2 + lf * 1.5)],
    [t0[0] - L, Math.min(gy1, t0[1] + 1 * s + wv * 1.6 + lf * 2)],
  ];
  return { r, sh, neck };
}

/** Оружие в ближней кисти: рукоять, конец клинка, направление. */
const WPN = {
  cleaver: { grip: 2.4, len: 9, w: 5 },
  rail: { grip: 3, len: 20, w: 3.4 },
};

function drawWeapon(px: Px, hand: V, ang: number, kind: Weapon, show = 1): void {
  if (kind === 'cleaver')
    blade(px, hand, ang, { ...WPN.cleaver, metal: METAL.steel, kind: 'cleaver' });
  else if (kind === 'rail') {
    // Вынимается из-за спины: виден кусок у рукояти.
    const o = WPN.rail;
    blade(px, hand, ang, {
      grip: o.grip,
      len: Math.max(2, o.len * show),
      w: o.w,
      metal: METAL.iron,
      kind: 'rail',
    });
  }
}

/** Кисть на рукояти рельса выше ближней: вторая рука двуручника. */
function railHand2(hand: V, ang: number): V {
  return [hand[0] + Math.cos(ang) * 2.4, hand[1] + Math.sin(ang) * 2.4];
}

// ---- Части короля: плащ, хвосты, корона ------------------------------------

/** Плащ: от плеч до голеней; подол отстаёт и взлетает на рывках. */
function kingCape2(r: Rig, cf: number, cs: number, gy: number): Item {
  const s = KS;
  const neck = neckOf(r);
  const hip = r.hip;
  const f = clamp(cf, -0.8, 2.2);
  const lo = (p: V): V => [p[0], Math.min(gy, p[1])];
  const pts: V[] = [
    add(neck, [-2.6 * s, -0.8 * s]),
    add(neck, [1.2 * s, 0.4 * s]),
    lo(add(hip, [(0.6 - 0.5 * f) * s, (4.6 - 0.6 * f) * s])),
    lo(add(hip, [(-4 + cs - 1.7 * f) * s, (5.4 - 1.9 * f) * s])),
    lo(add(hip, [(-7.4 + cs * 1.3 - 2.3 * f) * s, (4.2 - 2.6 * f) * s])),
  ];
  const o = pts[0];
  return {
    layer: 'back',
    draw: (px) => {
      poly(px, pts, (x, y) => {
        const d = (x - o[0]) * 0.35 + (y - o[1]) * 0.08;
        // Крап ткани привязан к плечу — едет вместе с плащом, а не «плывёт».
        if (((x - Math.round(o[0])) * 3 + (y - Math.round(o[1]))) % 11 === 0)
          return CLOTH.cape[0];
        return d < -1 ? CLOTH.cape[2] : d < 2 ? CLOTH.cape[1] : CLOTH.cape[0];
      });
      const a = pts[4];
      const b = pts[2];
      for (let i = 0; i <= 1; i += 0.04) {
        const k = i < 0.5 ? i * 2 : (i - 0.5) * 2;
        const p = i < 0.5 ? lerp(a, pts[3], k) : lerp(pts[3], b, k);
        px.set(Math.round(p[0]), Math.round(p[1]), METAL.gold[1]);
        px.set(Math.round(p[0]), Math.round(p[1]) - 1, METAL.gold[2]);
      }
    },
  };
}

/** Точка на хвосте: база от узла, подъём, закрутка, волна. */
function tailPts(
  knot: V,
  mid: V,
  end: V,
  lift: number,
  curl: number,
  wave: (k: number) => number,
  gy: number,
  s = KS,
): V[] {
  const rot = (v: V, a: number): V => [
    v[0] * Math.cos(a) - v[1] * Math.sin(a),
    v[0] * Math.sin(a) + v[1] * Math.cos(a),
  ];
  const m = rot([mid[0] * s, mid[1] * s], lift);
  const e0: V = [(end[0] - mid[0]) * s, (end[1] - mid[1]) * s];
  const e = add(m, rot(e0, lift + curl));
  const dir: V = [e[0], e[1]];
  const L = Math.hypot(dir[0], dir[1]) || 1;
  const n: V = [-dir[1] / L, dir[0] / L];
  const p1 = add(knot, add(m, [n[0] * wave(0.5), n[1] * wave(0.5)]));
  const p2 = add(knot, add(e, [n[0] * wave(1), n[1] * wave(1)]));
  return [knot, [p1[0], Math.min(gy, p1[1])], [p2[0], Math.min(gy, p2[1])]];
}

/** Концы хвостов — для привязанных малых и для следа хлыста. */
interface Tails {
  item: Item;
  ends: V[];
  knot: V;
}

function kingTails2(
  r: Rig,
  P: KP,
  fx: KFx,
  split: boolean,
  gy: number,
  wave: number,
  amp: number,
): Tails {
  const s = KS;
  const hip = r.hip;
  const tu = P.tu;
  const limp = fx.limp ?? 0;
  const knot: V = add(hip, [(-6 + 1.6 * tu) * s, (2.2 - 3.4 * tu + limp * 1.2) * s]);
  const base: [V, V, number][] = [
    [[-3, -3], [-6.2, -3.6], 1.0],
    [[-4, 0.8], [-8, 1.4], 1.25],
    [[-2, 2.6], [-4.8, 3.4], 0.7],
  ];
  const tails = base.map(([m, e, lk], i) => {
    const lift = tu * lk - limp * 0.5 * (i === 0 ? 1 : 0.4);
    const w = (k: number) =>
      (P.ts * 0.9 + Math.sin(wave - k * 2.4 + i * 1.3) * amp * (1 - limp)) * k * s;
    return tailPts(knot, m, e, lift, P.tc * 1.5 * (i === 2 ? 0.6 : 1), w, gy);
  });
  const root: V[] = [add(hip, [-2 * s, 1 * s]), add(knot, [2.6 * s, -0.4 * s]), knot];
  const pink = FUR.king.pink;
  const pd = FUR.king.pinkDark;
  const ends = [tails[0][2], tails[1][2]];
  return {
    ends,
    knot,
    item: {
      layer: 'back',
      draw: (px) => {
        for (const t of [root, ...tails]) {
          spline(t, 8).forEach(([x, y], i) => {
            px.set(x, y, i % 3 === 0 ? pd : pink);
            px.set(x, y + 1, pd);
          });
        }
        px.ell(knot[0], knot[1], 2.4 * s * 0.6, 2 * s * 0.6, (x, y) =>
          (x + y) % 3 === 0 ? pd : (x - y) % 4 === 0 ? hex('#e8aaa2') : pink,
        );
        if (fx.noTied && !split) return;
        if (split) {
          // Огрызки: малые отгрызли хвосты — концы тёмные, рваные.
          for (const e of ends) {
            px.set(Math.round(e[0]), Math.round(e[1]), hex('#5a1a1c'));
            px.set(Math.round(e[0]) - 1, Math.round(e[1]), hex('#8a2a2a'));
            px.set(Math.round(e[0]) - 1, Math.round(e[1]) + 1, hex('#5a1a1c'));
          }
          return;
        }
        // Привязанные малые короли — крысята в венчиках, свернулись клубком.
        ends.forEach((end, i) => {
          const bob = Math.sin(wave * 0.5 + i * 2) * 0.35 * s * (1 - limp);
          const cx = end[0] - 1.8 * s;
          const cy = end[1] + (i ? 0.6 : -0.4) * s + bob;
          const kf = FUR.ratman;
          oval(px, [cx, cy], 1.7 * s, 2.3 * s, Math.PI / 2, (k) => tone(kf, k));
          const hx = cx - 1.8 * s;
          const hy = cy - 0.3 * s;
          oval(px, [hx, hy], 1.2 * s, 1.1 * s, Math.PI / 2, (k) => tone(kf, k + 0.1));
          px.set(Math.round(hx - 1.2 * s), Math.round(hy + 0.2 * s), kf.pink);
          px.ell(hx + 0.4 * s, hy - 1 * s, 0.7 * s, 0.7 * s, kf.pink);
          px.rect(
            Math.round(hx - 0.6 * s),
            Math.round(hy - 1.6 * s),
            Math.round(hx + 0.8 * s),
            Math.round(hy - 1.3 * s),
            METAL.gold[2],
          );
          px.set(Math.round(hx - 0.6 * s), Math.round(hy - 2.1 * s), METAL.gold[3]);
          px.set(Math.round(hx + 0.8 * s), Math.round(hy - 2.1 * s), METAL.gold[3]);
        });
      },
    },
  };
}

/** Корона с наклоном: прямая — прежняя, наклонённая — поворот её же пикселей. */
function crownAt(px: Px, head: V, R: number, ang: number): void {
  if (Math.abs(ang) < 0.09) {
    crown(px, head, R, true);
    return;
  }
  // Прямая корона во временном холсте, потом поворот вокруг низа обода.
  const W = 24;
  const tmp = new Px(W, W);
  const c: V = [W / 2, W / 2 + 4];
  crown(tmp, c, R, true);
  const pivot: V = [c[0], c[1] - R * 0.78 + 2];
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  const off: V = [head[0] - c[0], head[1] - c[1]];
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      // Обратное отображение: какой пиксель прямой короны сюда попадает.
      const dx = x + 0.5 - pivot[0];
      const dy = y + 0.5 - pivot[1];
      const sx = Math.floor(pivot[0] + dx * cs + dy * sn);
      const sy = Math.floor(pivot[1] - dx * sn + dy * cs);
      const col = tmp.get(sx, sy);
      if (col[3]) px.set(x + off[0], y + off[1], col);
    }
}

/** Корона сама по себе (слетела): низ обода в точке `at`, наклон `ang`. */
function crownLoose(px: Px, at: V, R: number, ang: number): void {
  // Голова, для которой низ обода окажется в `at`.
  const head: V = [at[0], at[1] + R * 0.78 - 2];
  crownAt(px, head, R, ang || 0.1);
}

/** Горностаевый воротник: белый мех с чёрными хвостиками — король видно издали. */
function ermine(r: Rig, s: number): Item {
  const neck = neckOf(r);
  return {
    layer: 'mid',
    draw: (px) => {
      const c = add(neck, [0.2 * s, 0.6 * s]);
      oval(px, c, 2.4 * s, 3.6 * s, Math.PI / 2 + r.lean * 0.6, (k) =>
        k > 0.55 ? hex('#fbf6ee') : k > 0.1 ? hex('#e2dccf') : hex('#b8b0a2'),
      );
      for (const [dx, dy] of [
        [-2.2, 0.4],
        [0, 1.2],
        [2.2, 0.2],
        [-1, -0.6],
      ] as V[])
        px.set(Math.round(c[0] + dx * s), Math.round(c[1] + dy * s), hex('#1a1414'));
      px.ell(c[0] + 2.6 * s, c[1] + 0.2 * s, 1.1 * s, 1.1 * s, METAL.gold[2]);
      px.set(Math.round(c[0] + 2.4 * s), Math.round(c[1]), METAL.gold[3]);
    },
  };
}


// ---- Кадр короля ----------------------------------------------------------

interface KingLook {
  /** Рельс вместо тесака (полоса IV). */
  blade: boolean;
  /** Узел лопнул — малых на хвостах нет. */
  split: boolean;
}

/** След оружия: кромка, тело, хвост (тусклая сетка). */
const SMEAR = {
  cleaver: [hex('#ffffff'), hex('#d6e4f0'), hex('#8ea4b8')],
  rail: [hex('#fff2dc'), hex('#dcc4a2'), hex('#98785c')],
  tail: [hex('#ffe0d8'), hex('#eaa49c'), hex('#b06a64')],
};

/** Кисть с оружием и его угол в миг `T` клипа — для следа. */
function weaponAt(clip: Clip, T: number): { hand: V; ang: number; kind: Weapon; show: number } {
  const sh = clip.at(T);
  const k = kRig(sh.p, clip.geo);
  return { hand: k.r.armNear[2], ang: sh.p.wa, kind: sh.fx.weapon, show: sh.fx.wShow ?? 1 };
}

/**
 * След оружия: область, которую клинок прошёл между `a` и `b` (время
 * клипа). У свежего края — белая кромка и плотное тело, у старого —
 * тусклая сетка: дуга читается направлением, а не пятном. Яркое — ещё и
 * в `lit`, чтобы удар был виден в темноте арены.
 */
function paintSmear(px: Px, lit: Px, clip: Clip, a: number, b: number, k: number): void {
  const w0 = weaponAt(clip, a);
  const w1 = weaponAt(clip, b);
  const kind = w1.kind !== 'none' ? w1.kind : w0.kind;
  if (kind === 'none') return;
  const o = WPN[kind];
  const reach = o.grip + o.len;
  const move =
    Math.abs(w1.ang - w0.ang) * reach + Math.hypot(w1.hand[0] - w0.hand[0], w1.hand[1] - w0.hand[1]);
  const n = clamp(Math.ceil(move * 1.6) + 2, 3, 64);
  const col = SMEAR[kind];
  // След — серп у конца клинка, а не веер от кулака.
  const r0 = o.grip + o.len * (kind === 'rail' ? 0.6 : 0.4);
  const r1 = reach + 1.5;
  // Дорожку спрашиваем в нескольких точках, между ними — по прямой: след
  // гладкий, а кадр не пересчитывает скелет сотню раз.
  const K = 8;
  const probe = [w0];
  for (let i = 1; i < K; i++) probe.push(weaponAt(clip, a + ((b - a) * i) / K));
  probe.push(w1);
  // Уже закрашенные точки — маской по кадру (не множеством): след рисуется
  // от свежего края к старому, и старый не перекрывает свежий.
  const W = px.w;
  const H = px.h;
  if (seenBuf.length < W * H) seenBuf = new Uint8Array(W * H);
  const seen = seenBuf;
  seen.fill(0, 0, W * H);
  const half = SMEAR_HALF[kind];
  const litC = SMEAR_LIT[kind];
  for (let i = n; i >= 0; i--) {
    const u = i / n;
    const g = Math.min(K - 1, Math.floor(u * K));
    const v = u * K - g;
    const pa = probe[g];
    const pb = probe[g + 1];
    const hx = pa.hand[0] + (pb.hand[0] - pa.hand[0]) * v;
    const hy = pa.hand[1] + (pb.hand[1] - pa.hand[1]) * v;
    const ang = pa.ang + (pb.ang - pa.ang) * v;
    const show = pa.show + (pb.show - pa.show) * v;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    // Укороченный в ракурсе клинок (вращение над головой) — короче и след.
    const rr1 = o.grip + o.len * show + 1.5;
    const rr0 = Math.min(r0, rr1 - 3);
    for (let r = rr0; r <= rr1; r += 0.5) {
      const x = Math.round(hx + dx * r);
      const y = Math.round(hy + dy * r);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const id = y * W + x;
      if (seen[id]) continue;
      seen[id] = 1;
      const q = (r - rr0) / Math.max(1, rr1 - rr0);
      // Ярус: 0 — кромка, 1 — тело, 2 — тусклый хвост; слабый след — на ярус ниже.
      let tier = u > 0.7 ? (q > 0.5 ? 0 : 1) : u > 0.3 ? (q > 0.45 ? 1 : 2) : q > 0.6 ? 2 : 3;
      if (k < 0.75) tier++;
      if (tier > 2) continue;
      if (tier === 2 && ((x + y) & 1) === 1) continue;
      // По телу — только кромка целиком и тело следа вполсилы: морду и
      // руки видно сквозь взмах.
      if (px.data[id * 4 + 3]) {
        if (tier === 2) continue;
        if (tier === 1) {
          px.set(x, y, half);
          continue;
        }
      }
      px.set(x, y, col[tier]);
      if (tier < 2) lit.set(x, y, litC[tier]);
    }
  }
}

let seenBuf = new Uint8Array(0);
const withA = (c: RGBA, a: number): RGBA => [c[0], c[1], c[2], a];
/** Тело следа поверх тела короля — вполсилы; яркое — в слой поверх темноты. */
const SMEAR_HALF = {
  cleaver: withA(SMEAR.cleaver[1], 115),
  rail: withA(SMEAR.rail[1], 115),
  tail: withA(SMEAR.tail[1], 115),
};
const SMEAR_LIT = {
  cleaver: [withA(SMEAR.cleaver[0], 220), withA(SMEAR.cleaver[1], 150)],
  rail: [withA(SMEAR.rail[0], 220), withA(SMEAR.rail[1], 150)],
  tail: [withA(SMEAR.tail[0], 220), withA(SMEAR.tail[1], 150)],
};

/** Кольцо хвостов на развороте хлыста: эллипс у ног, свежая часть ярче. */
function paintWhirl(
  px: Px,
  lit: Px | null,
  G: Geo,
  ph: number,
  frac: number,
  back: boolean,
  R: number,
  stretch: number,
  tied = false,
  mirror = false,
): void {
  const cx = G.cx - 1;
  // Кадр потом отзеркалят (разворот) — кольцо рисуем зеркально заранее.
  const mx = mirror ? -1 : 1;
  const cy = G.gy - 3;
  const rx = R * stretch;
  const ry = R * 0.36;
  const col = SMEAR.tail;
  const n = Math.ceil(rx * 4.5);
  const litC = SMEAR_LIT.tail[0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const sa = Math.sin(a);
    // Верхняя половина эллипса — за телом, нижняя — перед ним.
    if (back !== sa < 0) continue;
    // Сколько времени назад хвост был здесь: 0 — сейчас.
    const age = ((ph * TAU - a) % TAU + TAU) % TAU / TAU;
    if (age > frac) continue;
    const tier = age < 0.2 ? 0 : age < 0.5 ? 1 : 2;
    // Три хвоста — три пряди: у головы кольца полоса в 4 пикселя, дальше тоньше.
    for (const dr of tier === 0 ? [-2, -1, 0, 1] : tier === 1 ? [-1, 0.5] : [0]) {
      const x = Math.round(cx + mx * Math.cos(a) * (rx + dr));
      const y = Math.round(cy + sa * (ry + dr * 0.4));
      if (tier === 2 && ((x + y) & 1) === 1) continue;
      px.set(x, y, col[tier]);
      if (lit && tier === 0) lit.set(x, y, litC);
    }
  }
  if (!tied || frac < 0.3) return;
  // Привязанные малые летят на концах хвостов — кистени по кругу.
  for (const da of [0, -0.45]) {
    const a = ph * TAU + da;
    const sa = Math.sin(a);
    if (back !== sa < 0) continue;
    const x = cx + mx * Math.cos(a) * (rx + 1);
    const y = cy + sa * ry - 2;
    const kf = FUR.ratman;
    oval(px, [x, y], 2.6, 3.4, Math.PI / 2 + a, (k) => tone(kf, k));
    px.set(Math.round(x - 1), Math.round(y - 3), METAL.gold[2]);
    px.set(Math.round(x + 1), Math.round(y - 3), METAL.gold[3]);
  }
}

/** Звезда-искра: крест с белой серединой. */
function sparkAt(p: Px, x: number, y: number, r: number, col: RGBA, core: RGBA): void {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let i = 1; i <= r; i++) {
    const c = i === r ? col : core;
    p.set(cx + i, cy, c);
    p.set(cx - i, cy, c);
    p.set(cx, cy + i, c);
    p.set(cx, cy - i, c);
  }
  if (r >= 3) {
    p.set(cx + 1, cy + 1, col);
    p.set(cx - 1, cy - 1, col);
    p.set(cx + 1, cy - 1, col);
    p.set(cx - 1, cy + 1, col);
  }
  p.set(cx, cy, core);
}

const hash01 = (x: number, y: number, k: number) => {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Контур снаружи — как `Px.outline`, но по маске альфы: в разы быстрее. */
let maskBuf = new Uint8Array(0);
function outlineFast(px: Px, c: RGBA): void {
  const { w, h, data } = px;
  if (maskBuf.length < w * h) maskBuf = new Uint8Array(w * h);
  const a = maskBuf;
  for (let i = 0, j = 3; i < w * h; i++, j += 4) a[i] = data[j] > 0 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (a[i]) continue;
      if (
        (x > 0 && a[i - 1]) ||
        (x < w - 1 && a[i + 1]) ||
        (y > 0 && a[i - w]) ||
        (y < h - 1 && a[i + w])
      ) {
        const j = i * 4;
        data[j] = c[0];
        data[j + 1] = c[1];
        data[j + 2] = c[2];
        data[j + 3] = 255;
      }
    }
  }
}

/** Оружие поверх всего — со своим контуром, в своей рамке (не во весь кадр). */
function weaponOver(px: Px, hand: V, ang: number, kind: Weapon, show: number): void {
  if (kind === 'none') return;
  const o = WPN[kind];
  const L = o.grip + o.len * show + 2;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const pad = o.w * 1.2 + 4;
  const x0 = Math.floor(Math.min(hand[0] - dx * 2, hand[0] + dx * L) - pad);
  const x1 = Math.ceil(Math.max(hand[0] - dx * 2, hand[0] + dx * L) + pad);
  const y0 = Math.floor(Math.min(hand[1] - dy * 2, hand[1] + dy * L) - pad);
  const y1 = Math.ceil(Math.max(hand[1] - dy * 2, hand[1] + dy * L) + pad);
  const wp = new Px(x1 - x0 + 1, y1 - y0 + 1);
  drawWeapon(wp, [hand[0] - x0, hand[1] - y0], ang, kind, show);
  outlineFast(wp, INK);
  for (let y = 0; y < wp.h; y++) {
    const ty = y + y0;
    if (ty < 0 || ty >= px.h) continue;
    for (let x = 0; x < wp.w; x++) {
      const tx = x + x0;
      if (tx < 0 || tx >= px.w) continue;
      const i = (y * wp.w + x) * 4;
      if (!wp.data[i + 3]) continue;
      const j = (ty * px.w + tx) * 4;
      px.data[j] = wp.data[i];
      px.data[j + 1] = wp.data[i + 1];
      px.data[j + 2] = wp.data[i + 2];
      px.data[j + 3] = 255;
    }
  }
}

interface KPainted {
  img: HTMLCanvasElement;
  lit: HTMLCanvasElement | null;
  /** Глаз в кадре (уже с учётом зеркала). */
  eye: V | null;
  /** Точка ног в кадре. */
  ax: number;
  ay: number;
}

/**
 * Обрезать кадр (и слой поверх темноты — той же рамкой) по содержимому,
 * отзеркалить, перевести в холсты. Холст меньше — дешевле и в памяти, и на
 * экране: пустые поля широкого кадра не рисуются.
 */
function cropFrame(
  px: Px,
  lit: Px | null,
  ax0: number,
  ay0: number,
  eye0: V | null,
  flip: boolean,
): KPainted {
  const { w, h } = px;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (const p of lit ? [px, lit] : [px])
    for (let y = 0; y < h; y++)
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4)
        if (p.data[i]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  if (x1 < 0) {
    x0 = y0 = 0;
    x1 = y1 = 0;
  }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const cut = (p: Px): HTMLCanvasElement => {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    if (!g) return c;
    const img = g.createImageData(cw, ch);
    const o = img.data;
    for (let y = 0; y < ch; y++) {
      const src = ((y + y0) * w + x0) * 4;
      if (!flip) o.set(p.data.subarray(src, src + cw * 4), y * cw * 4);
      else
        for (let x = 0; x < cw; x++) {
          const i = src + x * 4;
          const j = (y * cw + (cw - 1 - x)) * 4;
          o[j] = p.data[i];
          o[j + 1] = p.data[i + 1];
          o[j + 2] = p.data[i + 2];
          o[j + 3] = p.data[i + 3];
        }
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  const ax = flip ? cw - (ax0 - x0) : ax0 - x0;
  const eye: V | null = eye0
    ? [flip ? cw - 1 - (eye0[0] - x0) : eye0[0] - x0, eye0[1] - y0]
    : null;
  return { img: cut(px), lit: lit ? cut(lit) : null, eye, ax, ay: ay0 - y0 };
}

/** Нарисовать кадр клипа в миг `T` (вправо, без вспышки). */
function kingPaint(
  clip: Clip,
  T: number,
  look: KingLook,
  elite: boolean,
  left: boolean,
): KPainted {
  const KT = ((globalThis as any).__kt ??= {}); let q0 = performance.now(); const mk = (n: string) => { const q = performance.now(); KT[n] = (KT[n] ?? 0) + q - q0; q0 = q; };
  const G = clip.geo;
  const sh = clip.at(T);
  const P = sh.p;
  const fx = sh.fx;
  const k = kRig(P, G);
  const r = k.r;
  const f = elite ? furOf(FUR.king, 'elite') : FUR.king;
  const s = KS;
  // Отстающие части: плащ смотрит на позу 3 кадра назад, хвосты — на 4;
  // скорость таза (с общим ходом тела) тянет подол и хвосты назад.
  const pc = clip.at(T - 0.07).p;
  const pt = clip.at(T - 0.11).p;
  const pb = clip.at(T - 0.05).p;
  const xa = clip.xf?.(T, T) ?? XF0;
  const xb = clip.xf?.(T - 0.05, T - 0.05) ?? XF0;
  const vx = ((P.hx - pb.hx) * s + (xa.dx - xb.dx)) / 0.05;
  const vy = ((P.hy - pb.hy) * s + (xa.dy - xb.dy)) / 0.05;
  const drag = clamp(vx / 70, -1.2, 1.6);
  const rise = clamp(-vy / 90, -1, 1);
  // Двуручник: вторая кисть — на рукояти выше первой.
  if (fx.weapon === 'rail' && !fx.oneHand) {
    const tgt = railHand2(r.armNear[2], P.wa);
    const [e2, h2] = ik2(r.armFar[0], tgt, ARM_F[0], ARM_F[1], P.ebf >= 0 ? 1 : -1);
    r.armFar = [r.armFar[0], e2, h2];
  }
  if (fx.lid) {
    const lc: V = add(r.armFar[2], [0.6 * s, 0]);
    r.items.push({ layer: 'back', draw: (px) => lid(px, lc, 2.8 * s, 3.4 * s, METAL.iron) });
  }
  // Слой поверх темноты — только если в кадре есть что-то светящееся.
  let litPx: Px | null = null;
  const lit = () => (litPx ??= new Px(G.w, G.h));
  r.items.push(kingCape2(r, pc.cf + drag * 0.9 + rise * 0.5, pc.cs - drag * 0.3, G.gy));
  const wst = 1 / (fx.whirlSx ?? 1);
  if (fx.whirl && fx.whirl[1] > 0)
    r.items.push({
      layer: 'back',
      draw: (px) =>
        paintWhirl(px, lit(), G, fx.whirl![0], fx.whirl![1], true, WHIRL_R, wst, !look.split, !!fx.flip),
    });
  if (fx.lidAt) {
    const la: V = [G.cx + fx.lidAt[0], G.gy + fx.lidAt[1]];
    r.items.push({ layer: 'back', draw: (px) => lid(px, la, 2.8 * s, 3.4 * s, METAL.iron) });
  }
  const tails = kingTails2(
    r,
    kp(P, { ts: pt.ts + drag * 0.6, tu: pt.tu + rise * 0.25, tc: pt.tc }),
    fx,
    look.split,
    G.gy,
    fx.wave ?? T * 7,
    fx.waveAmp ?? 0.35,
  );
  r.items.push(tails.item);
  r.items.push(ermine(r, s));
  if (!fx.crownOff) {
    const hd = r.head;
    const R = r.headR;
    const ca = P.ca;
    r.items.push({ layer: 'front', draw: (px) => crownAt(px, hd, R, ca) });
  }
  const hand = r.armNear[2];
  const wFront = fx.weapon !== 'none' && !fx.wLayer;
  if (fx.weapon !== 'none' && fx.wLayer) {
    const a = P.wa;
    const show = fx.wShow ?? 1;
    const kind = fx.weapon;
    r.items.push({ layer: fx.wLayer, draw: (px) => drawWeapon(px, hand, a, kind, show) });
  }
  if (fx.dropped) {
    const [dx0, dy0, da] = fx.dropped;
    const kind: Weapon = look.blade ? 'rail' : 'cleaver';
    r.items.push({
      layer: 'back',
      draw: (px) => drawWeapon(px, [G.cx + dx0, G.gy + dy0], da, kind),
    });
  }
  if (fx.crownOff) {
    const [cx0, cy0, ca] = fx.crownOff;
    r.items.push({
      layer: 'back',
      draw: (px) => crownLoose(px, [G.cx + cx0, G.gy + cy0], r.headR, ca),
    });
  }
  mk('prep');
  const px = drawRig(r, f, G.w, G.h);
  mk('rig');
  if (fx.whirl && fx.whirl[1] > 0)
    paintWhirl(px, lit(), G, fx.whirl[0], fx.whirl[1], false, WHIRL_R, wst, !look.split, !!fx.flip);
  outlineFast(px, INK);
  mk('outline');
  if (elite) outlineFast(px, hex('#ffcc40'));
  // Глаз.
  const eyeMode = fx.eye ?? 'open';
  const [gx, gy] = eyeOf(r);
  let eye: V | null = [gx, gy];
  if (eyeMode === 'dizzy') {
    // Глаза «плывут»: зрачок обходит квадрат 2×2.
    paintEye(px, { ...r, squint: true }, f);
    const q = Math.floor(T * 10) % 4;
    const ex = gx + (q === 1 || q === 2 ? 1 : 0);
    const ey = gy + (q >= 2 ? 1 : 0);
    px.set(ex, ey, f.eye);
    eye = [ex, ey];
  } else {
    paintEye(px, { ...r, squint: eyeMode === 'squint' || r.squint }, f, eyeMode === 'dead');
    if (eyeMode === 'dead') eye = null;
    if (eyeMode === 'angry') {
      // Бровь: тёмный клин над глазом, к морде ниже.
      px.set(gx - 1, gy - 2, INK);
      px.set(gx, gy - 2, INK);
      px.set(gx + 1, gy - 1, INK);
      px.set(gx + 2, gy - 1, INK);
    }
  }
  // След — поверх тела, под клинком (он сам поверх следа).
  mk('eye');
  if (fx.smear) {
    paintSmear(px, lit(), clip, fx.smear[0], fx.smear[1], fx.smear[2]);
  }
  mk('smear');
  if (wFront) weaponOver(px, hand, P.wa, fx.weapon, fx.wShow ?? 1);
  mk('weapon');
  // Блеск на кромке: крест на конце клинка — «сейчас ударит».
  if (fx.glint && fx.glint > 0.05 && fx.weapon !== 'none') {
    const o = WPN[fx.weapon];
    const along = o.grip + o.len * 0.72;
    const nx = -Math.sin(P.wa);
    const ny = Math.cos(P.wa);
    const gx2 = hand[0] + Math.cos(P.wa) * along + nx * (o.w / 2);
    const gy2 = hand[1] + Math.sin(P.wa) * along + ny * (o.w / 2);
    const rr = fx.glint > 0.66 ? 3 : fx.glint > 0.33 ? 2 : 1;
    sparkAt(lit(), gx2, gy2, rr, [255, 244, 200, 230], [255, 255, 255, 255]);
  }
  if (fx.spark && fx.spark > 0.05) {
    const lc: V = add(r.armFar[2], [0.6 * s, -1.2 * s]);
    const rr = Math.round(2 + fx.spark * 3);
    sparkAt(lit(), lc[0], lc[1], rr, [255, 210, 120, 230], [255, 255, 240, 255]);
  }
  if (fx.stars !== undefined) {
    // Звёзды кружат над головой по эллипсу; дальняя половина — тусклее.
    const hd = r.head;
    for (let i = 0; i < 3; i++) {
      const a = fx.stars + (i * TAU) / 3;
      const x = hd[0] - 1 + Math.cos(a) * 7.5;
      const y = hd[1] - r.headR - 6 + Math.sin(a) * 2.2;
      const near = Math.sin(a) > 0;
      sparkAt(
        lit(),
        x,
        y,
        near ? 2 : 1,
        near ? [255, 220, 90, 255] : [200, 160, 70, 200],
        [255, 250, 210, 255],
      );
    }
  }
  if (fx.roar && fx.roar > 0.05) {
    // Рык: брызги и три штриха от пасти вперёд.
    const tip: V = [r.head[0] + r.headR * 1.5 + r.snout * 0.6, r.head[1] + r.headR * 0.35];
    const L = Math.round(2 + fx.roar * 4);
    const c: RGBA = [255, 240, 225, Math.round(120 + fx.roar * 120)];
    for (const [ax, ay] of [
      [1, -0.55],
      [1, 0],
      [1, 0.55],
    ] as V[]) {
      const x0 = tip[0] + 3 + ax * 2;
      const y0 = tip[1] + ay * 3;
      for (let i = 0; i < L; i++) lit().set(x0 + ax * i, y0 + ay * i, c);
    }
  }
  if (fx.steam && fx.steam > 0.05) {
    // Пар из ноздрей: два клуба уходят вперёд-вверх и тают.
    const tip: V = [r.head[0] + r.headR * 1.4 + r.snout * 0.6, r.head[1] + r.headR * 0.05];
    const k2 = fx.steam;
    const a = Math.round(170 * (1 - k2));
    const c: RGBA = [228, 224, 216, a];
    const x = tip[0] + 2 + k2 * 6;
    const y = tip[1] - k2 * 3;
    px.ell(x, y, 1 + k2 * 1.2, 0.8 + k2, c);
    px.ell(x + 3 + k2 * 3, y - 1 - k2 * 2, 0.6 + k2, 0.6 + k2 * 0.8, c);
  }
  if (fx.dissolve && fx.dissolve > 0) {
    // Распад: пиксели уходят по шуму крупными зёрнами 2×2, снизу раньше.
    const d = fx.dissolve;
    for (let y = 0; y < G.h; y++)
      for (let x = 0; x < G.w; x++) {
        const i = (y * G.w + x) * 4;
        if (!px.data[i + 3]) continue;
        const h = hash01(x >> 1, y >> 1, 11) * 0.8 + (1 - y / G.h) * 0.2;
        if (h < d) px.data[i + 3] = 0;
        else if (h < d + 0.08) {
          px.data[i] = 120;
          px.data[i + 1] = 104;
          px.data[i + 2] = 92;
        }
      }
  }
  mk('extras');
  // Смотрит влево (или разворачивается) — зеркало кадра, слоя и глаза.
  const flip = left !== !!fx.flip;
  const out = cropFrame(px, litPx, G.cx, G.gy + 1, eye, flip);
  mk('canvas');
  return out;
}

// ---- Клипы короля ---------------------------------------------------------

/** Рельс на плече: кисть у груди, клинок назад-вверх — тяжесть видна в покое. */
const REST_RAIL: KP = kp(REST, { nhx: 2.3, nhy: 2.2, wa: -2.5, fhx: 1.6, fhy: 4.4 });

const wpnOf = (look: KingLook): Weapon => (look.blade ? 'rail' : 'cleaver');
const restOf = (look: KingLook): KP => (look.blade ? REST_RAIL : REST);

/** Покой: дыхание, принюхивание, моргание, хвосты и плащ живут сами (2,4 с). */
const IDLE_T = 2.4;
function idleClip(look: KingLook): Clip {
  const base = restOf(look);
  const weapon = wpnOf(look);
  return {
    id: `idle${look.blade ? 'R' : 'C'}`,
    geo: GEO_N,
    loop: IDLE_T,
    at(T0) {
      const T = ((T0 % IDLE_T) + IDLE_T) % IDLE_T;
      const ph = (T / IDLE_T) * TAU;
      // Вдох дважды за цикл: грудь и плечи поднимаются на пиксель.
      const br = 0.5 - 0.5 * Math.cos(ph * 2);
      const p = kp(base, {
        hy: base.hy - 0.5 * br,
        ny: base.ny - 0.25 * br,
        nhy: base.nhy - 0.4 * br,
        fhy: base.fhy - 0.35 * br,
        ts: 0.5 * Math.sin(ph + 1),
        cs: 0.35 * Math.sin(ph * 2 - 1.2),
        sn: T > 1.5 && T < 1.62 ? 0.4 : T >= 1.62 && T < 1.74 ? -0.2 : 0,
        sq: T >= 0.9 && T < 1.0 ? 1 : 0,
        wa: base.wa + 0.06 * Math.sin(ph * 2 - 0.6),
      });
      // Раз в цикл король играет оружием: тесак делает оборот в кисти,
      // рельс подпрыгивает на плече.
      const fl = clamp((T - 1.84) / 0.36, 0, 1);
      let smear: KFx['smear'];
      if (fl > 0 && fl < 1) {
        const e = EZ.io(fl);
        if (look.blade) {
          p.wa += Math.sin(fl * Math.PI) * 0.35;
          p.nhy -= Math.sin(fl * Math.PI) * 0.7;
          p.hy += Math.sin(fl * Math.PI) * 0.25;
        } else {
          p.wa -= e * TAU;
          p.nhy -= Math.sin(fl * Math.PI) * 0.8;
          p.nhx += Math.sin(fl * Math.PI) * 0.4;
          if (fl > 0.15 && fl < 0.85) smear = [T - 0.06, T, 0.5];
        }
      }
      return {
        p,
        fx: {
          weapon,
          lid: !look.blade,
          smear,
          wave: ph * 2,
          waveAmp: 0.4,
          // Рельс лежит на плече одной рукой, за головой.
          ...(look.blade ? { oneHand: true, wLayer: 'mid' as const } : {}),
        },
      };
    },
  };
}

/**
 * Бег: 8 поз на шаг двумя лапами; нижняя точка — сразу после касания,
 * верхняя — на толчке. Шаг идёт по ПРОЙДЕННОМУ пути (ноги не скользят).
 */
const RUN_T = 0.64;
function runClip(look: KingLook): Clip {
  const base = restOf(look);
  const weapon = wpnOf(look);
  const at = (T0: number): Shot => {
    const T = ((T0 % RUN_T) + RUN_T) % RUN_T;
    const p = (T / RUN_T) * TAU;
    const sw = Math.cos(p) * 3.1;
    const lift = (k: number) => Math.max(0, Math.sin(p + k)) * 2.3;
    const bob = Math.abs(Math.sin(p - 0.45));
    const pp = kp(base, {
      ln: 0.5 + 0.05 * Math.sin(p * 2 - 0.4),
      hy: 0.55 - bob * 1.15,
      hx: 0.3,
      nx: 0.2,
      ny: 0.25 * Math.sin(p * 2 - 1.3),
      nfx: 0.8 + sw,
      nfl: lift(0),
      ffx: -1.4 - sw,
      ffl: lift(Math.PI),
      nhx: look.blade ? base.nhx + 0.25 * Math.sin(p * 2) : 2.4 - sw * 0.75,
      nhy: look.blade ? base.nhy + 0.3 * bob : 3.9 - Math.max(0, -sw) * 0.35,
      fhx: 1.9 + sw * 0.6,
      fhy: 3.9 - Math.max(0, sw) * 0.3,
      wa: look.blade ? base.wa + 0.08 * Math.sin(p * 2 - 0.8) : 1.25 - sw * 0.1,
      ts: 0.3 * Math.sin(p * 2),
      tu: 0.12,
      cf: 0.35,
      cs: 0.35 * Math.sin(p * 2 - 1),
      jaw: 0.15,
    });
    return {
      p: pp,
      fx: {
        weapon,
        lid: !look.blade,
        wave: p * 2,
        waveAmp: 0.55,
        ...(look.blade ? { oneHand: true, wLayer: 'mid' as const } : {}),
      },
    };
  };
  return {
    id: `run${look.blade ? 'R' : 'C'}`,
    geo: GEO_N,
    loop: RUN_T,
    at,
    xf(T0) {
      const T = ((T0 % RUN_T) + RUN_T) % RUN_T;
      const p = (T / RUN_T) * TAU;
      // Вес: сжатие на касании, вытянут на толчке.
      const c = Math.cos(2 * (p - 0.45));
      return { ...XF0, sx: 1 + 0.025 * c, sy: 1 - 0.035 * c };
    },
  };
}

/**
 * Рубка тесаком. Замах медленный (тесак уходит за голову, вес на заднюю
 * лапу, крышка вперёд для равновесия), за 0,25 с до удара — блеск на
 * кромке и довод за спину; удар — два кадра со следом; контакт — первый
 * кадр отдыха: тесак в полу перед мордой, выпад, пасть нараспашку;
 * дальше выдирает тесак из пола и возвращается.
 */
function cleaveClip(wu: number, rec: number): Clip {
  const set = kp(REST, { nfx: 1.3, ffx: -2.6, hy: 0.25, jaw: 0.1 });
  // Тесак идёт вверх ВПЕРЕДИ морды, на вытянутой руке, и уходит за
  // голову сверху — морду он не закрывает ни на одном кадре.
  const lift1 = kp(set, {
    nhx: 4.4,
    nhy: 0.2,
    wa: -0.7,
    ln: 0.22,
    fhx: 3.2,
    fhy: 3.4,
    tu: 0.12,
    hy: 0.35,
  });
  const over = kp(set, {
    nhx: 2.6,
    nhy: -5.0,
    wa: -1.75,
    ln: 0.1,
    fhx: 3.8,
    fhy: 2.4,
    tu: 0.22,
    hy: 0.3,
    ny: -0.2,
  });
  const top = kp(set, {
    hx: -0.45,
    hy: 0.35,
    ln: -0.02,
    nx: -0.25,
    ny: -0.35,
    jaw: 0.3,
    nhx: -0.6,
    nhy: -4.5,
    wa: -2.3,
    fhx: 4.2,
    fhy: 1.8,
    nfx: 1.9,
    ffx: -3.0,
    tu: 0.3,
    cf: 0.3,
  });
  const cock = kp(top, { hx: -0.7, hy: 0.6, ln: -0.14, nhx: -1.2, nhy: -4.1, wa: -2.6, jaw: 0.55 });
  const s1 = kp(cock, { hx: -0.1, hy: 0.45, ln: 0.18, nhx: 1.0, nhy: -4.8, wa: -1.6, jaw: 0.7 });
  const s2 = kp(cock, {
    hx: 0.55,
    hy: 0.7,
    ln: 0.58,
    nx: 0.3,
    ny: 0.25,
    nhx: 4.6,
    nhy: -0.8,
    wa: -0.15,
    jaw: 0.9,
    fhx: 1.4,
    fhy: 3.8,
    nfx: 2.3,
  });
  const hit = kp(REST, {
    hx: 1.0,
    hy: 1.35,
    ln: 0.95,
    nx: 0.6,
    ny: 1.1,
    jaw: 1,
    nhx: 5.0,
    nhy: 5.3,
    wa: 1.25,
    nfx: 2.8,
    ffx: -3.2,
    fhx: 0.4,
    fhy: 4.2,
    tu: 0.55,
    cf: 0.9,
  });
  const bite = kp(hit, { hy: 1.5, nhy: 5.6, wa: 1.36, ln: 1.0, jaw: 0.85 });
  const pull = kp(hit, {
    hy: 0.75,
    ln: 0.62,
    nx: 0.2,
    ny: 0.4,
    nhx: 3.7,
    nhy: 3.1,
    wa: 0.75,
    jaw: 0.3,
    tu: 0.1,
    cf: 0.15,
  });
  const H = wu;
  const f = 1 / FPS;
  const keys: Key[] = [
    { t: 0, p: set },
    { t: Math.min(0.14, H * 0.2), p: lift1, e: EZ.out2 },
    { t: Math.min(0.3, H * 0.42), p: over, e: EZ.io },
    { t: H - 0.24, p: top, e: EZ.io },
    { t: H - 3 * f, p: cock, e: EZ.out2 },
    { t: H - 2 * f, p: s1, e: EZ.in2 },
    { t: H - f, p: s2, e: EZ.lin },
    { t: H, p: hit, e: EZ.out2 },
    { t: H + f, p: bite, e: EZ.out2 },
    { t: H + 0.16, p: bite, e: EZ.hold },
    { t: H + 0.36, p: pull, e: EZ.io },
    { t: H + rec - 0.04, p: REST, e: EZ.io },
  ];
  return {
    id: `cleave${H.toFixed(3)}`,
    geo: GEO_N,
    at(T) {
      const p = track(keys, T);
      let smear: KFx['smear'];
      if (T >= H - 2 * f - 1e-4 && T < H - f - 1e-4) smear = [H - 2.7 * f, T, 0.7];
      else if (T >= H - f - 1e-4 && T < H - 1e-4) smear = [H - 2.2 * f, T, 1];
      else if (T >= H - 1e-4 && T < H + f - 1e-4) smear = [H - 1.7 * f, T, 1];
      else if (T >= H + f - 1e-4 && T < H + 2 * f - 1e-4) smear = [H - 0.2 * f, H + f, 0.5];
      const tell = T - (H - 0.3);
      return {
        p,
        fx: {
          weapon: 'cleaver',
          // Клинок, занесённый назад за голову, — за телом.
          wLayer: p.wa < -2.0 && p.nhy < -2 ? 'back' : undefined,
          lid: true,
          smear,
          eye: T > 0.12 && T < H + 0.3 ? 'angry' : 'open',
          glint: tell > 0 && tell < 0.16 ? 1 - Math.abs(tell - 0.06) / 0.1 : 0,
          wave: T * 8,
          waveAmp: 0.3,
          steam: T > H + 0.3 && T < H + 0.62 ? (T - H - 0.3) / 0.32 : 0,
        },
      };
    },
    xf(T) {
      const dx = curve(
        [
          [H - 2 * f, 0],
          [H, 2.6, EZ.out2],
          [H + 0.12, 2.6, EZ.hold],
          [H + 0.45, 0, EZ.io],
        ],
        T,
      );
      const sq = curve(
        [
          [H - f, 0],
          [H, 1, EZ.out3],
          [H + 0.16, 0, EZ.out2],
        ],
        T,
      );
      // Замах: чуть поднялся на носки; удар — сплющился от веса.
      const up = curve(
        [
          [0, 0],
          [H - 0.24, 0.03, EZ.io],
          [H - 3 * f, 0.035],
          [H - f, 0, EZ.in2],
        ],
        T,
      );
      return { ...XF0, dx, sx: 1 + 0.07 * sq - up * 0.5, sy: 1 - 0.07 * sq + up };
    },
  };
}

/**
 * Рык (начало боя, полоса I; 1,2 с): вдох — сжался, голова к груди; взрыв —
 * выпрямился, голова запрокинута, лапы в стороны, пасть нараспашку; дрожь
 * рыка; выдох. На полосе II (`split`) начало другое: хвосты лопнули —
 * рывок вперёд от боли, хвосты-огрызки хлещут, потом тот же рёв.
 */
function roarClip(look: KingLook): Clip {
  const b0 = restOf(look);
  const rail = look.blade;
  const inhale = kp(b0, {
    hy: 0.9,
    ln: 0.78,
    nx: 0.3,
    ny: 0.9,
    sq: 1,
    nhx: 1.8,
    nhy: 3.4,
    wa: rail ? -2.5 : 1.9,
    fhx: 1.2,
    fhy: 3.6,
    nfx: 1.6,
    ffx: -2.8,
    tu: -0.1,
    cf: -0.3,
  });
  const pain = kp(b0, {
    hx: 0.9,
    hy: 0.6,
    ln: 0.85,
    nx: 0.5,
    ny: 0.8,
    jaw: 0.8,
    sq: 1,
    nhx: 4.2,
    nhy: 1.6,
    wa: rail ? -2.5 : 0.4,
    fhx: -1.6,
    fhy: 1.6,
    nfx: 2.6,
    ffx: -2.4,
    tu: 1.1,
    ts: -1.2,
    cf: 1.1,
  });
  // Пик рыка: морда задрана к своду, лапы вразлёт — тесак вперёд-вниз,
  // крышка назад-вверх; морду ничего не закрывает.
  const peak = kp(b0, {
    hy: -0.6,
    ln: -0.12,
    nx: -0.1,
    ny: -1.0,
    dr: -1.5,
    sn: 0.3,
    jaw: 1,
    nhx: rail ? 2.3 : 4.8,
    nhy: rail ? 2.2 : 2.8,
    wa: rail ? -2.5 : 0.95,
    fhx: -2.6,
    fhy: -1.0,
    ebf: -1,
    nfx: 1.8,
    ffx: -2.9,
    tu: 0.9,
    cf: 1.1,
  });
  const over = kp(peak, { hy: -0.8, ny: -1.25, dr: -1.8, ln: -0.18 });
  const hold = kp(peak, { hy: -0.5, ny: -0.9, dr: -1.3, tu: 0.7, cf: 0.8 });
  const keys: Key[] = look.split
    ? [
        { t: 0, p: pain },
        { t: 0.16, p: kp(pain, { hx: 1.2, ln: 0.95, ny: 1.1 }), e: EZ.out2 },
        { t: 0.3, p: inhale, e: EZ.io },
        { t: 0.38, p: peak, e: EZ.out3 },
        { t: 0.44, p: over, e: EZ.out2 },
        { t: 0.98, p: hold, e: EZ.io },
        { t: 1.2, p: b0, e: EZ.io },
      ]
    : [
        { t: 0, p: b0 },
        { t: 0.22, p: inhale, e: EZ.io },
        { t: 0.3, p: peak, e: EZ.out3 },
        { t: 0.36, p: over, e: EZ.out2 },
        { t: 0.96, p: hold, e: EZ.io },
        { t: 1.2, p: b0, e: EZ.io },
      ];
  const t1 = look.split ? 0.38 : 0.3;
  return {
    id: `roar${look.split ? 'S' : ''}${rail ? 'R' : 'C'}`,
    geo: GEO_N,
    at(T) {
      let p = track(keys, T);
      const sustain = T > t1 + 0.06 && T < 0.96;
      // Дрожь рыка: голова и пасть бьются на пиксель, 12 раз в секунду.
      if (sustain && Math.floor(T * 12) % 2 === 1) p = kp(p, { ny: p.ny + 0.45, dr: p.dr + 0.3, jaw: 0.85 });
      return {
        p,
        fx: {
          weapon: wpnOf(look),
          lid: !rail,
          ...(rail ? { oneHand: true, wLayer: 'mid' as const } : {}),
          eye: T < t1 ? 'squint' : 'angry',
          // Волны рыка от пасти рисуют «Техники» (f1-boss-fx, `shout`).
          wave: T * (look.split ? 16 : 10),
          waveAmp: look.split ? (T < 0.5 ? 1.4 : 0.7) : T > t1 && T < 0.96 ? 0.8 : 0.3,
          steam: T > 1.0 ? (T - 1.0) / 0.2 : 0,
        },
      };
    },
    xf(T) {
      const sq = curve(
        [
          [0, 0],
          [t1 - 0.08, 1, EZ.io],
          [t1, -1, EZ.out3],
          [t1 + 0.14, 0, EZ.out2],
        ],
        T,
      );
      const jolt = look.split
        ? curve(
            [
              [0, 2.4],
              [0.2, 3, EZ.out2],
              [0.5, 0, EZ.io],
            ],
            T,
          )
        : 0;
      const sustain = T > t1 + 0.06 && T < 0.96;
      const shake = sustain ? Math.sin(T * 97) * 0.5 : 0;
      return { ...XF0, dx: jolt + shake, sx: 1 + 0.045 * sq, sy: 1 - 0.06 * sq };
    },
  };
}

/**
 * Призыв (1 с): дважды бьёт тесаком в крышку, как в гонг (искры), потом
 * тычет тесаком вперёд и орёт — из нор лезут крысы.
 */
function summonClip(look: KingLook): Clip {
  const b0 = restOf(look);
  const rail = look.blade;
  // Крышка — перед брюхом, как гонг; тесак заносится ЗА голову и бьёт
  // сверху вниз: морда открыта на всех кадрах.
  const guard = kp(b0, { fhx: 3.8, fhy: 2.6, ln: 0.25, jaw: 0.2 });
  const up1 = kp(guard, { nhx: 0.2, nhy: -3.2, wa: -2.05, hy: -0.2, jaw: 0.35, tu: 0.2, ny: -0.2 });
  const bang = kp(guard, { nhx: 3.6, nhy: 1.9, wa: 0.75, hy: 0.35, jaw: 0.6, ny: 0.3 });
  const reb = kp(guard, { nhx: 3.0, nhy: 0.8, wa: 0.2, hy: 0.2 });
  const up2 = kp(guard, { nhx: -0.3, nhy: -3.6, wa: -2.3, hy: -0.35, jaw: 0.5, tu: 0.35, ny: -0.3 });
  const bang2 = kp(bang, { hy: 0.5, jaw: 0.8 });
  const point = kp(b0, {
    ln: 0.48,
    hx: 0.5,
    nx: 0.55,
    ny: -0.5,
    jaw: 1,
    nhx: 5.2,
    nhy: 1.4,
    wa: -0.12,
    fhx: -1.2,
    fhy: 2.4,
    nfx: 2.2,
    ffx: -2.8,
    tu: 0.5,
    cf: 0.6,
  });
  const keys: Key[] = [
    { t: 0, p: b0 },
    { t: 0.14, p: up1, e: EZ.out2 },
    { t: 0.22, p: bang, e: EZ.in2 },
    { t: 0.27, p: reb, e: EZ.out2 },
    { t: 0.4, p: up2, e: EZ.io },
    { t: 0.48, p: bang2, e: EZ.in2 },
    { t: 0.53, p: reb, e: EZ.out2 },
    { t: 0.64, p: point, e: EZ.out3 },
    { t: 1.0, p: kp(point, { ny: -0.3, jaw: 0.9 }), e: EZ.io },
  ];
  const sparkAtT = (T: number) =>
    T >= 0.22 && T < 0.3 ? 0.65 * (1 - (T - 0.22) / 0.1) : T >= 0.48 && T < 0.58 ? 1 - (T - 0.48) / 0.12 : 0;
  return {
    id: `summon${rail ? 'R' : 'C'}`,
    geo: GEO_N,
    at(T) {
      const p = track(keys, T);
      const f = 1 / FPS;
      let smear: KFx['smear'];
      if (!rail && ((T >= 0.18 && T < 0.22 + f) || (T >= 0.44 && T < 0.48 + f)))
        smear = [T - 1.5 * f, T, 0.8];
      return {
        p,
        fx: {
          weapon: wpnOf(look),
          // Занесён за голову — за телом: корону и морду не закрывает.
          wLayer: p.wa < -1.9 ? 'back' : undefined,
          lid: !rail,
          smear,
          spark: rail ? 0 : sparkAtT(T),
          eye: 'angry',
          // Крик зова — волнами у «Техник»; здесь только открытая пасть.
          wave: T * 9,
          waveAmp: 0.5,
        },
      };
    },
    xf(T) {
      const k = Math.max(
        0,
        T >= 0.22 && T < 0.34 ? 1 - (T - 0.22) / 0.12 : T >= 0.48 && T < 0.62 ? 1 - (T - 0.48) / 0.14 : 0,
      );
      return { ...XF0, sx: 1 + 0.035 * k, sy: 1 - 0.045 * k };
    },
  };
}

// ---- Клубок ---------------------------------------------------------------

/** Малые короли — палитра прежних крыс-королей (`KING_PAL`). */
const KINGLET_PAL: Fur = KING_PAL;

/** Узор клубка — единичные векторы на сфере (в «домашнем» повороте). */
const nrm3 = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
};
type V3 = [number, number, number];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Камера: наклон 45°, к зрителю (+y по полу) и вверх (+z). */
const CAM_V: V3 = nrm3(0, 1, 1);
const CAM_U: V3 = nrm3(0, -1, 1);
const B_SPIRAL = nrm3(0, 0.7, 0.72);
const B_CROWN = nrm3(0.92, -0.1, 0.36);
const B_ERMINE = nrm3(-0.35, 0.78, 0.2);
const B_CAPE = nrm3(-0.3, -0.75, 0.4);
const B_EYE = nrm3(0.62, 0.72, -0.08);
const B_TIED: V3[] = [nrm3(-0.85, -0.1, -0.5), nrm3(0.1, -0.8, -0.6)];

/** Поворот v вокруг единичной оси u на угол a (Родриг). */
function rot3(v: V3, u: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = dot3(u, v) * (1 - c);
  return [
    v[0] * c + (u[1] * v[2] - u[2] * v[1]) * s + u[0] * d,
    v[1] * c + (u[2] * v[0] - u[0] * v[2]) * s + u[1] * d,
    v[2] * c + (u[0] * v[1] - u[1] * v[0]) * s + u[2] * d,
  ];
}

/**
 * Клубок короля: шар радиуса `R` с узором на сфере. `dirA` — куда катится
 * по полу (0 — вправо, π/2 — к зрителю), `th` — угол поворота. Свет стоит
 * на месте, узор (спираль хвостов, плащ, корона, горностай, глаз)
 * поворачивается вокруг оси качения — видно, что шар катится.
 */
function ballPx(R: number, dirA: number, th: number, split: boolean, small: boolean): Px {
  const S = Math.ceil(R * 2 + (split ? 6 : 14));
  const px = new Px(S, S);
  const c: V = [S / 2, S - R - 3];
  const f = small ? KINGLET_PAL : FUR.king;
  const axis: V3 = [-Math.sin(dirA), Math.cos(dirA), 0];
  const toBall = (n: V3): V3 => rot3(n, axis, -th);
  const toWorld = (q: V3): V3 => rot3(q, axis, th);
  // Привязанные малые: бугры по краю; дальние — до шара, ближние — после.
  const tied = (small || split ? [] : B_TIED).map((d) => {
    const w = toWorld(d);
    const sx = w[0];
    const sy = -dot3(w, CAM_U);
    return { x: c[0] + sx * (R + 1.5), y: c[1] + sy * (R + 1.5), z: dot3(w, CAM_V) };
  });
  const bump = (b: { x: number; y: number }) => {
    const kf = FUR.ratman;
    oval(px, [b.x, b.y], 3.2, 3.2, 0, (k) => tone(kf, k));
    px.set(Math.round(b.x - 1), Math.round(b.y - 3), METAL.gold[2]);
    px.set(Math.round(b.x + 1), Math.round(b.y - 3), METAL.gold[2]);
  };
  for (const b of tied) if (b.z < 0) bump(b);
  const cape = CLOTH.cape;
  const gold = METAL.gold;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const xs = (x + 0.5 - c[0]) / R;
      const ys = (y + 0.5 - c[1]) / R;
      const r2 = xs * xs + ys * ys;
      if (r2 > 1) continue;
      const zs = Math.sqrt(1 - r2);
      const k = xs * LX + ys * LY + zs * LZ;
      const n: V3 = [
        xs,
        -ys * CAM_U[1] + zs * CAM_V[1],
        -ys * CAM_U[2] + zs * CAM_V[2],
      ];
      const q = toBall(n);
      let col: RGBA = tone(f, k);
      const dc = dot3(q, B_CAPE);
      const ds = dot3(q, B_SPIRAL);
      const dk = dot3(q, B_CROWN);
      const de = dot3(q, B_ERMINE);
      const dy = dot3(q, B_EYE);
      if (Math.abs(Math.sin(q[0] * 9 + q[1] * 4 + q[2] * 7)) > 0.94 && k > 0.05 && k < 0.8)
        col = f.dark;
      if (!small && dc > 0.42) col = dc < 0.5 ? (k > 0.3 ? gold[2] : gold[1]) : k > 0.45 ? cape[2] : k > 0.05 ? cape[1] : cape[0];
      if (ds > 0.5) {
        // Спираль сплетённых хвостов: три витка к центру.
        const a = Math.atan2(dot3(q, [1, 0, 0]), dot3(q, [0, -0.72, 0.7]));
        const rho = Math.acos(clamp(ds, -1, 1));
        const v = (((a / TAU + rho * 3.3) % 1) + 1) % 1;
        if (v < 0.36) col = v < 0.1 || k < 0.1 ? f.pinkDark : f.pink;
      }
      if (!small && de > 0.9) col = k > 0.35 ? hex('#fbf6ee') : hex('#d8d0c2');
      if (!small && de > 0.9 && Math.abs(Math.sin(q[0] * 31 + q[2] * 23)) > 0.93) col = hex('#1a1414');
      if (dk > (small ? 0.94 : 0.9)) col = dk > 0.985 ? hex('#d8203a') : k > 0.4 ? gold[3] : k > 0.05 ? gold[2] : gold[1];
      if (dy > 0.992) col = f.eye;
      px.set(x, y, col);
    }
  for (const b of tied) if (b.z >= 0) bump(b);
  outlineFast(px, INK);
  return px;
}

/** Номер шага поворота клубка и направление качения (зеркало — для левого). */
function ballKey(dir: number): { q: number; left: boolean; dirA: number } {
  const cx = Math.cos(dir);
  const left = cx < -0.05;
  const a = Math.atan2(Math.sin(dir), Math.abs(cx));
  const q = clamp(Math.round(a / (Math.PI / 4)), -2, 2);
  return { q, left, dirA: q * (Math.PI / 4) };
}

/** Перекат: прицел (сжимается в комок) → клубок раскручивается на месте. */
function rollAimClip(D: number, look: KingLook): Clip {
  const b0 = restOf(look);
  const rail = look.blade;
  const crouch = kp(b0, {
    hy: 1.4,
    ln: 0.7,
    nx: -0.3,
    ny: 1.8,
    dr: 1.8,
    bl: 0.5,
    sq: 1,
    nhx: 1.4,
    nhy: 3.0,
    wa: rail ? -2.7 : 2.3,
    fhx: 0.9,
    fhy: 3.3,
    nfx: 1.4,
    ffx: -1.5,
    tu: 0.3,
    tc: 0.5,
    cf: 0.4,
  });
  // Комок: спина дугой, голова спрятана к груди, колени к подбородку.
  const curl = kp(crouch, {
    hy: 2.3,
    ln: 0.75,
    nx: -1.7,
    ny: 2.8,
    dr: 2.4,
    bl: 1,
    nhx: 1.8,
    nhy: 4.6,
    fhx: 1.4,
    fhy: 4.8,
    nfx: 0.9,
    nfl: 0.8,
    ffx: -0.8,
    tu: 0.5,
    tc: 1,
    cf: 0.8,
  });
  const keys: Key[] = [
    { t: 0, p: b0 },
    { t: Math.min(0.18, D * 0.25), p: crouch, e: EZ.out2 },
    { t: D * 0.6, p: curl, e: EZ.io },
  ];
  return {
    id: `rollAim${D.toFixed(3)}${rail ? 'R' : 'C'}`,
    geo: GEO_N,
    at(T) {
      return {
        p: track(keys, T),
        fx: {
          weapon: wpnOf(look),
          lid: !rail,
          ...(rail ? { oneHand: true, wLayer: 'mid' as const } : {}),
          eye: 'squint',
          wave: T * 6,
          waveAmp: 0.25,
        },
      };
    },
    xf(T) {
      const sq = curve(
        [
          [0, 0],
          [Math.min(0.18, D * 0.25), 0.6, EZ.out2],
          [D * 0.6, 1, EZ.io],
        ],
        T,
      );
      return { ...XF0, sx: 1 + 0.07 * sq, sy: 1 - 0.1 * sq };
    },
  };
}

/** Когда в прицеле переката король уже клубок. */
const BALL_FROM = 0.64;
/** Шагов поворота клубка на оборот: король — 13 (≈11,6 рад/с при 24 к/с), малый — 8. */
const BALL_STEPS = { king: 13, kinglet: 8 };

/** Угол раскрутки клубка на месте: разгон от нуля до скорости качения. */
function revSteps(tau: number, dur: number): number {
  // Полная скорость — шаг за кадр. Скорость растёт от трети до полной:
  // θ = v0·τ + ½·α·τ² — видно, что раскручивается, и сразу видно, что крутится.
  const d = Math.max(0.05, dur);
  return Math.floor(FPS * (tau / 3 + (tau * tau) / (3 * d)));
}

/**
 * Оглушён (после переката; 1,3 с): вываливается из клубка враскоряку,
 * встаёт и шатается, голова ходит кругом, глаза плывут, корона съехала,
 * над головой звёзды; в конце трясёт головой — и снова в бой.
 */
function dizzyClip(D: number, look: KingLook): Clip {
  const b0 = restOf(look);
  const rail = look.blade;
  const sprawl = kp(b0, {
    hy: 2.4,
    ln: 1.1,
    nx: 0.4,
    ny: 1.5,
    sq: 1,
    nhx: 4.2,
    nhy: 2.4,
    wa: rail ? 0.2 : 0.9,
    fhx: -1.6,
    fhy: 3.6,
    nfx: 2.6,
    ffx: -3.2,
    tu: -0.2,
    ca: 0.35,
    jaw: 0.4,
  });
  const wob = kp(b0, {
    hy: 0.5,
    ln: 0.3,
    nx: 0.2,
    ny: 0.3,
    jaw: 0.55,
    nhx: 2.8,
    nhy: 4.9,
    wa: rail ? 0.9 : 1.65,
    fhx: 1.6,
    fhy: 5.0,
    nfx: 1.3,
    ffx: -2.6,
    ca: -0.25,
  });
  const end = D - 0.1;
  const keys: Key[] = [
    { t: 0, p: sprawl },
    { t: 0.14, p: wob, e: EZ.out2 },
    { t: end - 0.18, p: wob, e: EZ.lin },
    { t: end, p: kp(b0, { jaw: 0.3 }), e: EZ.io },
    { t: D, p: b0, e: EZ.io },
  ];
  return {
    id: `dizzy${D.toFixed(2)}${rail ? 'R' : 'C'}`,
    geo: GEO_N,
    at(T) {
      let p = track(keys, T);
      const w = T > 0.14 && T < end - 0.18 ? Math.min(1, (T - 0.14) / 0.15) : 0;
      if (w > 0) {
        const a = T * TAU * 1.4;
        p = kp(p, {
          nx: p.nx + 0.4 * Math.cos(a) * w,
          ny: p.ny + 0.3 * Math.sin(a) * w,
          hx: p.hx + 0.3 * Math.sin(T * TAU * 0.8) * w,
          ca: p.ca + 0.18 * Math.sin(a - 1.2) * w,
          ts: 0.8 * Math.sin(T * TAU * 0.8),
        });
      }
      // Встряхнул головой: голова туда-сюда через кадр.
      if (T >= end - 0.18 && T < end - 0.02) {
        const k = Math.floor((T - (end - 0.18)) * FPS) % 2 ? 1 : -1;
        p = kp(p, { nx: p.nx + 0.55 * k, sn: 0.2 });
      }
      return {
        p,
        fx: {
          weapon: wpnOf(look),
          lid: !rail,
          eye: T < end - 0.18 ? 'dizzy' : 'angry',
          stars: T < end - 0.18 ? T * 5.5 : undefined,
          wave: T * 5,
          waveAmp: 0.4,
          steam: T > end - 0.02 && T < D ? (T - end + 0.02) / 0.12 : 0,
        },
      };
    },
    xf(T) {
      const w = T > 0.14 && T < end - 0.18 ? Math.min(1, (T - 0.14) / 0.15) : 0;
      const pop = curve(
        [
          [0, 1],
          [0.14, 0, EZ.out2],
        ],
        T,
      );
      return {
        ...XF0,
        rot: 0.07 * Math.sin(T * TAU * 0.8) * w,
        sx: 1 + 0.08 * pop,
        sy: 1 - 0.1 * pop,
      };
    },
  };
}

/**
 * Хлыст хвостами (замах 0,7 с, кольцо вокруг). Король пригибается и
 * заводит узел хвостов высоко над спиной, как скорпион; последние 0,25 с
 * хвосты трещат — сигнал; удар — полный оборот на месте за шесть кадров
 * (бок → сжат «лицом» → другой бок …), хвосты вытянуты и оставляют
 * кольцо-след ровно по метке удара; потом хвосты опадают с перелётом.
 */
/**
 * След хвостов в кадре — размытие самих хвостов у тела (их длина, на уровне
 * бедра), а не всё кольцо удара: полный круг по полу на радиусе метки
 * рисует контакт `f1_whip` («Техники», от мига урона).
 */
const WHIRL_R = 1.35 * TS;
/** Кадры разворота: зеркало, ширина тела, голова следа (доля круга), сколько круга видно. */
const SPIN: [boolean, number, number, number][] = [
  [false, 0.55, 0.67, 0.25],
  [true, 0.55, 0.83, 0.36],
  [true, 1, 0, 0.42],
  [true, 0.55, 0.17, 0.32],
  [false, 0.55, 0.33, 0.18],
  [false, 1, 0.5, 0],
];

function whipClip(wu: number, rec: number, look: KingLook): Clip {
  const b0 = restOf(look);
  const rail = look.blade;
  const coil = kp(b0, {
    hy: 0.8,
    ln: 0.55,
    nx: -0.35,
    jaw: 0.4,
    nhx: 1.2,
    nhy: 3.8,
    wa: rail ? -2.5 : 1.8,
    fhx: 3.4,
    fhy: 2.8,
    nfx: 2.0,
    ffx: -3.0,
    tu: 0.75,
    tc: 0.5,
    cf: 0.4,
  });
  const full = kp(coil, { hy: 1.05, ln: 0.72, tu: 1.1, tc: 1, jaw: 0.6, nx: -0.45 });
  const spin = kp(b0, {
    hy: 0.55,
    ln: 0.4,
    jaw: 1,
    nhx: 4.2,
    nhy: 2.0,
    wa: rail ? -0.6 : 0.35,
    fhx: -1.8,
    fhy: 2.0,
    ebf: -1,
    nfx: 1.8,
    ffx: -2.6,
    tu: 0.25,
    tc: 0,
    cf: 1.1,
  });
  const settle = kp(b0, { tu: -0.25, ts: 0.6, hy: 0.4, jaw: 0.3 });
  const f = 1 / FPS;
  const H = wu;
  const keys: Key[] = [
    { t: 0, p: b0 },
    { t: Math.min(0.15, H * 0.22), p: coil, e: EZ.out2 },
    { t: H - 0.24, p: full, e: EZ.io },
    { t: H - 3 * f, p: full, e: EZ.lin },
    { t: H - 2 * f, p: spin, e: EZ.out2 },
    { t: H + 3 * f, p: spin, e: EZ.lin },
    { t: H + 0.3, p: settle, e: EZ.out2 },
    { t: H + rec - 0.04, p: b0, e: EZ.io },
  ];
  const spinOf = (T: number) => {
    const k = Math.floor((T - (H - 2 * f)) * FPS + 1e-4);
    return k >= 0 && k < SPIN.length ? SPIN[k] : null;
  };
  return {
    id: `whip${H.toFixed(3)}${rail ? 'R' : 'C'}`,
    geo: GEO_W,
    at(T) {
      const p = track(keys, T);
      const sp = spinOf(T);
      const rattle = T > H - 0.26 && T < H - 2 * f;
      return {
        p,
        fx: {
          weapon: wpnOf(look),
          lid: !rail,
          ...(rail ? { oneHand: true, wLayer: 'mid' as const } : {}),
          eye: T > 0.1 && T < H + 0.2 ? 'angry' : 'open',
          flip: sp ? sp[0] : false,
          whirl: sp ? [sp[2], sp[3]] : undefined,
          whirlSx: sp ? sp[1] : 1,
          noTied: !!sp && sp[3] >= 0.3,
          wave: rattle ? T * 55 : T * 9,
          waveAmp: rattle ? 0.55 : T > H ? 0.9 * Math.max(0, 1 - (T - H) / 0.5) + 0.2 : 0.35,
        },
      };
    },
    xf(T, Tq) {
      const sp = spinOf(Tq);
      const rattle = T > H - 0.26 && T < H - 2 * f;
      const sq = curve(
        [
          [0, 0],
          [Math.min(0.15, H * 0.22), 0.5, EZ.out2],
          [H - 0.24, 1, EZ.io],
          [H - 2 * f, 1],
          [H - f, -0.6, EZ.out2],
          [H + 0.2, 0, EZ.io],
        ],
        T,
      );
      return {
        ...XF0,
        dx: rattle ? Math.sin(T * 120) * 0.4 : 0,
        sx: (sp ? sp[1] : 1) * (1 + 0.04 * sq),
        sy: 1 - 0.05 * sq,
      };
    },
  };
}

/**
 * Смена оружия (полоса IV, 1,5 с). Тесак швырнул в сторону (он ляжет на
 * пол — это рисует зона), крышку отбросил; обеими лапами — за спину, тянет
 * рельс вверх, кончик выходит из-за головы — рельс описывает круг над
 * головой, удар в пол перед собой, стойка с рёвом, и рельс ложится на плечо.
 * `front` — тесак летит вперёд (зона тесака лежит слева от короля, а
 * король смотрит влево).
 */
function swapClip(front: boolean): Clip {
  const f = 1 / FPS;
  const R2 = -TAU;
  // Бросок сверху: в t = 0 тесак уже сорвался с поднятой лапы над головой —
  // дальше его несёт зона пола (f1-boss-fx: полёт до 0,42 с, отскок до 0,66).
  // Летит он в мире влево: королю, смотрящему вправо, — за спину (кидает
  // через плечо), смотрящему влево — вперёд. До t = 0 — только замах в
  // дорожке (отрицательное время) — из него след броска.
  const pre = kp(REST, {});
  const wind = front
    ? kp(REST, { ln: 0.05, nx: -0.2, ny: -0.2, nhx: -2.2, nhy: -2.6, wa: -2.8, jaw: 0.4 })
    : kp(REST, { ln: 0.5, nhx: 4.4, nhy: 0.6, wa: 0.2, jaw: 0.4 });
  const toss = front
    ? kp(REST, { ln: 0.3, hx: 0.2, nhx: -1.1, nhy: -4.4, wa: -1.7, jaw: 0.8, nfx: 1.8, fhx: 0.8 })
    : kp(REST, { ln: 0.2, nx: -0.3, ny: -0.3, nhx: 0.1, nhy: -4.6, wa: -2.0, jaw: 0.8, ffx: -2.8, fhx: 3.2, fhy: 3.0 });
  const follow = front
    ? kp(REST, { ln: 0.6, hx: 0.5, nhx: 4.4, nhy: 0.2, wa: 0.6, jaw: 0.6, nfx: 2.2 })
    : kp(REST, { ln: 0.05, nx: -0.4, ny: -0.2, nhx: -2.0, nhy: -2.8, wa: -2.8, jaw: 0.6, ffx: -2.8, fhx: 3.0, fhy: 2.6 });
  const empty = kp(REST, { hy: 0.2, jaw: 0.3, nhx: 2.6, nhy: 3.8, wa: 1.9, fhx: -1.6, fhy: 1.4, ebf: -1 });
  const reach = kp(REST, {
    ln: 0.12,
    nx: -0.4,
    ny: 0.2,
    hy: 0.3,
    nhx: -0.6,
    nhy: -3.3,
    wa: 2.45,
    fhx: -0.3,
    fhy: -2.6,
    jaw: 0.2,
  });
  const pull = kp(reach, { hy: -0.2, ln: 0.05, nhx: 0.6, nhy: -5.8, wa: 2.25, ny: -0.3, fhx: 0.2, fhy: -4.8 });
  const draw = kp(pull, { nhx: 1.0, nhy: -6.0, wa: 0, fhx: -1.6, fhy: 1.0, ebf: -1, jaw: 0.5 });
  // Вертушка над головой: рельс ходит по кругу в плоскости пола — в
  // ракурсе он то длинный (поперёк), то короткий (к нам и от нас).
  const TW0 = 0.74;
  const TW1 = 1.02;
  const TURNS = 1.25;
  const twirlAng = (T: number) => {
    const ph = ((T - TW0) / (TW1 - TW0)) * TAU * TURNS;
    const g = ph + Math.atan2(0.32 * Math.sin(ph), Math.cos(ph)) - Math.atan2(Math.sin(ph), Math.cos(ph));
    return { wa: -g, show: Math.hypot(Math.cos(ph), 0.32 * Math.sin(ph)), far: Math.sin(ph) > 0.05 };
  };
  const twirl = kp(draw, { wa: twirlAng(TW1).wa });
  const slam = kp(REST, {
    hx: 0.6,
    hy: 1.2,
    ln: 0.7,
    ny: 0.6,
    jaw: 0.8,
    nhx: 4.3,
    nhy: 3.0,
    wa: 0.5 + R2,
    nfx: 2.4,
    ffx: -3.0,
    cf: 0.7,
    tu: 0.4,
  });
  const guard = kp(REST, {
    hy: 0.2,
    ln: 0.38,
    nx: 0.2,
    ny: -0.4,
    jaw: 1,
    nhx: 2.8,
    nhy: 2.5,
    wa: -0.75 + R2,
    nfx: 1.8,
    ffx: -2.8,
    tu: 0.3,
  });
  const shoulder = kp(REST_RAIL, { wa: REST_RAIL.wa + R2 });
  const keys: Key[] = [
    { t: -0.2, p: pre },
    { t: -2 * f, p: wind, e: EZ.io },
    { t: 0, p: toss, e: EZ.in2 },
    { t: 0.1, p: follow, e: EZ.out2 },
    { t: 0.22, p: empty, e: EZ.io },
    { t: 0.34, p: reach, e: EZ.io },
    { t: 0.58, p: pull, e: EZ.io },
    { t: 0.74, p: draw, e: EZ.in2 },
    { t: 1.02, p: twirl, e: EZ.lin },
    { t: 1.12, p: slam, e: EZ.in2 },
    { t: 1.16, p: kp(slam, { hy: 1.4 }), e: EZ.out2 },
    { t: 1.28, p: guard, e: EZ.out2 },
    { t: 1.36, p: guard, e: EZ.lin },
    { t: 1.5, p: shoulder, e: EZ.io },
  ];
  return {
    id: `swap${front ? 'F' : 'B'}`,
    geo: GEO_W,
    at(T) {
      let p = track(keys, T);
      const weapon: Weapon = T < 0 ? 'cleaver' : T < 0.3 ? 'none' : 'rail';
      let wShow: number | undefined;
      let far = false;
      if (T >= TW0 && T < TW1) {
        const tw = twirlAng(T);
        p = kp(p, { wa: tw.wa });
        wShow = tw.show;
        far = tw.far;
      } else if (T >= TW1 && T < TW1 + 0.06) wShow = 0.32 + (0.68 * (T - TW1)) / 0.06;
      let smear: KFx['smear'];
      if (T < f - 1e-4) smear = [-2 * f, -0.001, 1];
      else if (T < 2 * f - 1e-4) smear = [-0.5 * f, -0.001, 0.5];
      else if (T >= 0.66 && T < TW0) smear = [T - 1.3 * f, T, 0.8];
      else if (T >= TW0 && T < TW1) smear = [T - 1.5 * f, T, 1];
      else if (T >= TW1 && T < 1.12 + f) smear = [T - 1.6 * f, T, 1];
      // Крышка отлетает назад дугой и уходит за край.
      const lt = T - 0.12;
      const lidAt: [number, number] | undefined =
        lt > 0 && lt < 0.3 ? [-8 - lt * 150, -30 - lt * 60 + lt * lt * 700] : undefined;
      return {
        p,
        fx: {
          weapon,
          lid: T < 0.12,
          lidAt,
          wLayer: (T >= 0.3 && T < 0.66) || far ? 'back' : undefined,
          wShow,
          oneHand: T < 1.02 || T >= 1.36,
          smear,
          eye: T > 0.3 ? 'angry' : 'open',
          roar: T > 1.22 && T < 1.42 ? 1 - Math.abs(T - 1.3) / 0.12 : 0,
          wave: T * 8,
          waveAmp: 0.45,
          steam: T > 1.38 ? (T - 1.38) / 0.12 : 0,
        },
      };
    },
    xf(T) {
      const imp = curve(
        [
          [1.1, 0],
          [1.12, 1, EZ.out3],
          [1.3, 0, EZ.out2],
        ],
        T,
      );
      const up = curve(
        [
          [0.34, 0],
          [0.58, 1, EZ.io],
          [0.74, 1],
          [1.02, 0.4, EZ.io],
          [1.1, 0, EZ.in2],
        ],
        T,
      );
      return { ...XF0, sx: 1 + 0.08 * imp - 0.02 * up, sy: 1 - 0.1 * imp + 0.04 * up };
    },
  };
}

/**
 * Три взмаха рельсом (полоса IV): замахи 0,55 / 0,38 / 0,38, урон в конце
 * каждого, после третьего — отдых 1,1. Одна сквозная дорожка:
 *   A — косой рубящий из-за спины сверху вниз вперёд;
 *   B — восходящий снизу вверх (рельс из проводки A идёт в замах B);
 *   C — добивающий сверху в пол: король вытягивается на носках и
 *       обрушивает рельс, пол держит удар (сплющен), рельс застрял;
 * выдирает рельс и кладёт на плечо. Контакт каждого взмаха — первый кадр
 * следующего режима.
 */
function sweepClip(wa: number, wb: number): Clip {
  const f = 1 / FPS;
  const TA = wa;
  const TB = wa + wb;
  const TC = wa + 2 * wb;
  const hold = kp(REST_RAIL, { nhx: 1.2, nhy: -0.8, wa: -2.2, hy: 0.3, nfx: 1.8, ffx: -2.8, fhx: 0.6, fhy: 2.8 });
  const aWind = kp(hold, {
    hx: -0.6,
    hy: 0.55,
    ln: -0.12,
    nx: -0.2,
    jaw: 0.5,
    nhx: -1.3,
    nhy: -3.1,
    wa: -2.8,
    tu: 0.3,
    cf: 0.3,
  });
  const aCock = kp(aWind, { hx: -0.8, hy: 0.7, nhx: -1.6, nhy: -2.9, wa: -2.95, ln: -0.18 });
  const aS1 = kp(aCock, { hx: -0.2, hy: 0.5, ln: 0.15, nhx: 0.4, nhy: -4.7, wa: -1.95, jaw: 0.8 });
  const aS2 = kp(aCock, { hx: 0.4, hy: 0.7, ln: 0.5, nhx: 3.6, nhy: -2.6, wa: -0.75, jaw: 0.9 });
  const aHit = kp(REST_RAIL, {
    hx: 0.9,
    hy: 1.2,
    ln: 0.85,
    nx: 0.5,
    ny: 0.8,
    jaw: 1,
    nhx: 5.0,
    nhy: 2.4,
    wa: 0.55,
    nfx: 2.8,
    ffx: -3.0,
    tu: 0.5,
    cf: 0.9,
  });
  const aFol = kp(aHit, { hy: 1.35, ln: 0.95, nhx: 4.6, nhy: 3.6, wa: 1.0 });
  const aEnd = kp(aHit, { hy: 1.2, ln: 0.9, nhx: 3.0, nhy: 4.6, wa: 1.6, jaw: 0.6 });
  const bWind = kp(aEnd, { hx: -0.3, hy: 1.1, ln: 0.7, nhx: 1.2, nhy: 5.0, wa: 2.35, jaw: 0.5, nx: -0.1 });
  const bCock = kp(bWind, { hx: -0.45, nhx: 0.8, nhy: 5.2, wa: 2.6 });
  const bS1 = kp(bCock, { hx: 0, hy: 1.0, ln: 0.65, nhx: 3.2, nhy: 4.2, wa: 1.0, jaw: 0.8 });
  const bS2 = kp(bCock, { hx: 0.4, hy: 0.6, ln: 0.45, nhx: 5.0, nhy: 1.2, wa: 0.05, jaw: 0.9 });
  const bHit = kp(REST_RAIL, {
    hx: 0.6,
    hy: -0.4,
    ln: 0.1,
    nx: 0.2,
    ny: -0.7,
    jaw: 1,
    nhx: 4.2,
    nhy: -3.4,
    wa: -0.9,
    nfx: 2.2,
    nfl: 0.5,
    ffx: -2.6,
    tu: 0.6,
    cf: 0.8,
  });
  const bFol = kp(bHit, { nhx: 3.2, nhy: -4.6, wa: -1.35, hy: -0.55 });
  const bEnd = kp(bHit, { nhx: 2.4, nhy: -5.2, wa: -1.7, hy: -0.5, jaw: 0.7 });
  const cWind = kp(bEnd, { hx: -0.3, hy: -0.7, ln: -0.1, ny: -0.5, nhx: 0.2, nhy: -5.6, wa: -2.4, nfl: 0.6, ffl: 0.3, tu: 0.7 });
  const cCock = kp(cWind, { hy: -0.85, nhx: -0.4, nhy: -5.4, wa: -2.75 });
  const cS1 = kp(cCock, { hy: -0.5, ln: 0.2, nhx: 1.8, nhy: -5.6, wa: -1.6, jaw: 1 });
  const cS2 = kp(cCock, { hx: 0.5, hy: 0.4, ln: 0.6, nhx: 4.8, nhy: -2.0, wa: -0.3, nfl: 0, ffl: 0 });
  const cHit = kp(REST_RAIL, {
    hx: 1.1,
    hy: 1.9,
    ln: 1.05,
    nx: 0.6,
    ny: 1.0,
    jaw: 1,
    nhx: 5.2,
    nhy: 3.8,
    wa: 0.62,
    nfx: 3.0,
    ffx: -3.4,
    tu: 0.8,
    cf: 1.2,
  });
  const cBite = kp(cHit, { hy: 2.05, wa: 0.66 });
  const pullUp = kp(cHit, { hy: 0.8, ln: 0.6, nhx: 3.4, nhy: 2.6, wa: -0.2, jaw: 0.3, tu: 0.1, cf: 0.2 });
  // Рельс на плечо — через верх назад (угол убывает).
  const keys: Key[] = [
    { t: 0, p: REST_RAIL },
    { t: Math.min(0.14, TA * 0.25), p: hold, e: EZ.out2 },
    { t: TA - 0.18, p: aWind, e: EZ.io },
    { t: TA - 3 * f, p: aCock, e: EZ.out2 },
    { t: TA - 2 * f, p: aS1, e: EZ.in2 },
    { t: TA - f, p: aS2, e: EZ.lin },
    { t: TA, p: aHit, e: EZ.out2 },
    { t: TA + f, p: aFol, e: EZ.out2 },
    { t: TA + 3 * f, p: aEnd, e: EZ.out2 },
    { t: TB - 0.12, p: bWind, e: EZ.io },
    { t: TB - 3 * f, p: bCock, e: EZ.out2 },
    { t: TB - 2 * f, p: bS1, e: EZ.in2 },
    { t: TB - f, p: bS2, e: EZ.lin },
    { t: TB, p: bHit, e: EZ.out2 },
    { t: TB + f, p: bFol, e: EZ.out2 },
    { t: TB + 3 * f, p: bEnd, e: EZ.out2 },
    { t: TC - 0.12, p: cWind, e: EZ.io },
    { t: TC - 3 * f, p: cCock, e: EZ.out2 },
    { t: TC - 2 * f, p: cS1, e: EZ.in2 },
    { t: TC - f, p: cS2, e: EZ.lin },
    { t: TC, p: cHit, e: EZ.out3 },
    { t: TC + f, p: cBite, e: EZ.out2 },
    { t: TC + 0.3, p: cBite, e: EZ.hold },
    { t: TC + 0.6, p: pullUp, e: EZ.io },
    { t: TC + 1.06, p: REST_RAIL, e: EZ.io },
  ];
  const hits = [TA, TB, TC];
  return {
    id: `sweep${TA.toFixed(3)}_${wb.toFixed(3)}`,
    geo: GEO_N,
    at(T) {
      const p = track(keys, T);
      let smear: KFx['smear'];
      for (const H of hits) {
        if (T >= H - 2 * f - 1e-4 && T < H - f - 1e-4) smear = [H - 2.8 * f, T, 0.7];
        else if (T >= H - f - 1e-4 && T < H - 1e-4) smear = [H - 2.3 * f, T, 1];
        else if (T >= H - 1e-4 && T < H + f - 1e-4) smear = [H - 1.8 * f, T, 1];
        else if (T >= H + f - 1e-4 && T < H + 2 * f - 1e-4) smear = [H - 0.2 * f, H + f, 0.5];
      }
      // Рельс за спиной (замахи A и B, из-за головы — C) — за телом.
      const back = (p.wa < -2.35 && p.nhy < -1.5) || (p.wa > 2.0 && T > TA);
      const shoulder = T < 0.05 || T > TC + 0.8;
      return {
        p,
        fx: {
          weapon: 'rail',
          wLayer: back ? 'back' : shoulder ? 'mid' : undefined,
          oneHand: shoulder,
          smear,
          eye: T > 0.1 && T < TC + 0.4 ? 'angry' : 'open',
          glint: T > TA - 0.28 && T < TA - 0.12 ? 1 - Math.abs(T - TA + 0.2) / 0.08 : 0,
          wave: T * 9,
          waveAmp: 0.4,
          steam: T > TC + 0.36 && T < TC + 0.7 ? (T - TC - 0.36) / 0.34 : 0,
        },
      };
    },
    xf(T) {
      let dx = 0;
      let sq = 0;
      for (const [i, H] of hits.entries()) {
        const big = i === 2 ? 1.6 : 1;
        dx += curve(
          [
            [H - f, 0],
            [H, 1.6 * big, EZ.out2],
            [H + 0.2, 0, EZ.io],
          ],
          T,
        );
        sq += curve(
          [
            [H - f, 0],
            [H, big, EZ.out3],
            [H + 0.14 * big, 0, EZ.out2],
          ],
          T,
        );
      }
      // C: вытягивается на носках перед ударом.
      const st = curve(
        [
          [TB + 3 * f, 0],
          [TC - 3 * f, 1, EZ.io],
          [TC - f, 0.4],
          [TC, 0, EZ.in2],
        ],
        T,
      );
      return { ...XF0, dx, sx: 1 + 0.06 * sq - 0.02 * st, sy: 1 - 0.07 * sq + 0.05 * st };
    },
  };
}

/**
 * Прыжок (полоса IV): присел с рельсом над головой (0,7 с) → полёт 0,5 с
 * по дуге (растянут на отрыве, поджат в воздухе, шлейф) → рельс рушится
 * в пол в миг приземления, тело сплющено, пол держит удар; отдых 1 с.
 */
function leapClip(wu: number): Clip {
  const f = 1 / FPS;
  const TL = wu + 0.5;
  const lift = kp(REST_RAIL, { nhx: 0.8, nhy: -4.6, wa: -2.0, hy: 0.4, ln: 0.3, nfx: 1.6, ffx: -2.6, fhx: 0.2, fhy: -3.8 });
  const crouch = kp(lift, {
    hy: 2.3,
    ln: 0.55,
    nx: 0.3,
    ny: 1.0,
    nhx: 1.3,
    nhy: -2.6,
    wa: -2.25,
    nfx: 1.9,
    ffx: -2.6,
    tu: -0.2,
    cf: -0.2,
    jaw: 0.4,
  });
  const deep = kp(crouch, { hy: 2.6, ny: 1.2, jaw: 0.6 });
  const off = kp(REST_RAIL, {
    hy: -1.3,
    ln: 0.25,
    ny: -0.8,
    nhx: 0.6,
    nhy: -5.6,
    wa: -1.8,
    nfx: 0.6,
    ffx: -2.6,
    jaw: 0.8,
    tu: 0.3,
    cf: 0.6,
  });
  const tuck = kp(off, {
    hy: -0.6,
    ln: 0.45,
    nhx: 0.2,
    nhy: -5.8,
    wa: -2.35,
    nfx: 1.9,
    nfl: 3.0,
    ffx: -1.0,
    ffl: 2.4,
    tu: 0.7,
    cf: 1.3,
    ny: -0.3,
  });
  const apex = kp(tuck, { wa: -2.65, nhx: -0.3, nhy: -5.5, ln: 0.35 });
  const d1 = kp(apex, { nhx: 2.4, nhy: -5.0, wa: -1.5, nfl: 1.2, ffl: 1.0, ln: 0.55, jaw: 1 });
  const d2 = kp(apex, { nhx: 5.0, nhy: -1.0, wa: -0.2, nfl: 0.4, ffl: 0.3, ln: 0.8, jaw: 1, nfx: 2.2 });
  const land = kp(REST_RAIL, {
    hx: 0.6,
    hy: 2.4,
    ln: 0.78,
    nx: 0.5,
    ny: 1.2,
    jaw: 1,
    nhx: 5.0,
    nhy: 4.0,
    wa: 0.75,
    nfx: 2.6,
    ffx: -3.2,
    tu: 0.9,
    cf: 1.4,
  });
  const rise = kp(land, { hy: 0.6, ln: 0.5, nhx: 3.2, nhy: 2.6, wa: -0.3, jaw: 0.3, tu: 0.1, cf: 0.2 });
  const keys: Key[] = [
    { t: 0, p: REST_RAIL },
    { t: Math.min(0.18, wu * 0.28), p: lift, e: EZ.out2 },
    { t: wu - 0.14, p: crouch, e: EZ.io },
    { t: wu - f, p: deep, e: EZ.in2 },
    { t: wu, p: off, e: EZ.out3 },
    { t: wu + 0.12, p: tuck, e: EZ.out2 },
    { t: wu + 0.3, p: apex, e: EZ.io },
    { t: TL - 2 * f, p: d1, e: EZ.in2 },
    { t: TL - f, p: d2, e: EZ.lin },
    { t: TL, p: land, e: EZ.out3 },
    { t: TL + f, p: kp(land, { hy: 2.6 }), e: EZ.out2 },
    { t: TL + 0.2, p: kp(land, { hy: 2.5 }), e: EZ.lin },
    { t: TL + 0.5, p: rise, e: EZ.io },
    { t: TL + 0.94, p: REST_RAIL, e: EZ.io },
  ];
  return {
    id: `leap${wu.toFixed(3)}`,
    geo: GEO_N,
    at(T) {
      const p = track(keys, T);
      let smear: KFx['smear'];
      if (T >= TL - 2 * f - 1e-4 && T < TL - f - 1e-4) smear = [TL - 2.8 * f, T, 0.7];
      else if (T >= TL - f - 1e-4 && T < TL - 1e-4) smear = [TL - 2.3 * f, T, 1];
      else if (T >= TL - 1e-4 && T < TL + f - 1e-4) smear = [TL - 1.8 * f, T, 1];
      else if (T >= TL + f - 1e-4 && T < TL + 2 * f - 1e-4) smear = [TL - 0.2 * f, TL + f, 0.5];
      const air = T >= wu && T < TL;
      const back = p.wa < -2.2 && p.nhy < -2;
      return {
        p,
        fx: {
          weapon: 'rail',
          wLayer: back ? 'back' : T < 0.05 || T > TL + 0.85 ? 'mid' : undefined,
          oneHand: T < 0.05 || T > TL + 0.85,
          smear,
          eye: T > 0.08 && T < TL + 0.5 ? 'angry' : 'open',
          wave: T * (air ? 14 : 8),
          waveAmp: air ? 0.8 : 0.35,
          steam: T > TL + 0.4 && T < TL + 0.8 ? (T - TL - 0.4) / 0.4 : 0,
        },
      };
    },
    xf(T) {
      const k = clamp((T - wu) / 0.5, 0, 1);
      const air = T >= wu && T < TL;
      // Дуга: вверх быстрее, вниз — тяжело, с разгоном.
      const dy = air ? -28 * Math.sin(Math.PI * Math.pow(k, 0.85)) : 0;
      const sx = curve(
        [
          [0, 1],
          [wu - 0.14, 1.08, EZ.io],
          [wu - f, 1.12, EZ.in2],
          [wu, 0.88, EZ.out3],
          [wu + 0.14, 1, EZ.out2],
          [TL - 3 * f, 1],
          [TL - f, 0.94, EZ.in2],
          [TL, 1.22, EZ.out3],
          [TL + 0.12, 0.97, EZ.out2],
          [TL + 0.26, 1, EZ.io],
        ],
        T,
      );
      const sy = 1 / Math.sqrt(sx) - (sx > 1 ? (sx - 1) * 0.55 : 0);
      const rot = air ? curve([[0, 0], [0.4, -0.08, EZ.io], [0.8, 0.14, EZ.io], [1, 0.05]], k) : 0;
      return {
        ...XF0,
        dy,
        sx,
        sy,
        rot,
        shadow: air ? 16 - 6 * Math.sin(Math.PI * k) : 16,
        ghost: air ? { every: 0.03, life: 0.2, tint: '#e2cdb6', alpha: 0.34 } : null,
      };
    },
  };
}

/**
 * Смерть — сцена 1,5 с: последний удар отбрасывает (голова назад, пасть,
 * лапы вразлёт), корона слетает, колени подламываются, оружие падает
 * из лапы, король валится на спину, пол его подбрасывает, хвосты опадают
 * и ещё дёргаются; корона катится вперёд, покачивается и ложится на бок;
 * потом тело рассыпается.
 */
const DIE_T = 1.5;
function deathClip(look: KingLook): Clip {
  const rail = look.blade;
  const b0 = restOf(look);
  const blow = kp(b0, {
    hx: -0.4,
    hy: -0.3,
    ln: -0.35,
    nx: -0.5,
    ny: -1.2,
    jaw: 1,
    sq: 1,
    nhx: 4.2,
    nhy: -1.6,
    wa: rail ? -1.0 : -0.6,
    fhx: -2.2,
    fhy: 0.4,
    ebf: -1,
    tu: 0.8,
    cf: 0.8,
  });
  const buckle = kp(b0, {
    hx: -0.2,
    hy: 2.3,
    ln: 0.55,
    nx: 0.2,
    ny: 0.8,
    jaw: 0.6,
    sq: 1,
    nhx: 3.3,
    nhy: 5.4,
    wa: 2.3,
    fhx: 1.4,
    fhy: 5.6,
    nfx: 2.2,
    ffx: -1.4,
    tu: 0.2,
    cf: 0.3,
  });
  // Лёг на спину: торс вдоль пола, голова вправо, лапы кверху.
  const down = kp(REST, {
    hx: -3.0,
    hy: 4.6,
    ln: 1.52,
    nx: -1.0,
    ny: 2.5,
    jaw: 0.5,
    nhx: 3.4,
    nhy: 1.2,
    wa: 1.3,
    fhx: 1.2,
    fhy: 1.6,
    ffx: -3.4,
    ffl: 5.6,
    nfx: -1.5,
    nfl: 6.4,
    tu: 0.9,
    cf: 0.2,
  });
  const flat = kp(down, { ffl: 4.2, nfl: 5.0, ffx: -3.8, nfx: -2.2, nhy: 1.6, fhy: 2.0, tu: -0.3, jaw: 0.35 });
  const kick = kp(flat, { nfl: 6.2, nfx: -1.4 });
  const keys: Key[] = [
    { t: 0, p: blow },
    { t: 0.12, p: kp(blow, { hy: -0.1, ny: -1.0 }), e: EZ.out2 },
    { t: 0.38, p: buckle, e: EZ.io },
    { t: 0.62, p: down, e: EZ.in2 },
    { t: 0.72, p: kp(down, { hy: 4.3 }), e: EZ.out2 },
    { t: 0.84, p: flat, e: EZ.io },
    { t: 0.98, p: flat, e: EZ.lin },
    { t: 1.03, p: kick, e: EZ.out2 },
    { t: 1.12, p: flat, e: EZ.in2 },
  ];
  // Корона: полёт дугой вперёд, два отскока, покачивание и лёг на бок.
  const crownPath = (T: number): [number, number, number] | undefined => {
    if (T < 0.05) return undefined;
    const t = T - 0.05;
    if (t < 0.42) {
      const k = t / 0.42;
      return [6 + 22 * k, -40 + 46 * k * k - 18 * k, 0.3 + 3.2 * k];
    }
    if (t < 0.6) {
      const k = (t - 0.42) / 0.18;
      return [28 + 7 * k, -5 * Math.sin(Math.PI * k), 3.5 + 1.4 * k];
    }
    if (t < 0.72) {
      const k = (t - 0.6) / 0.12;
      return [35 + 3 * k, -1.5 * Math.sin(Math.PI * k), 4.9 + 0.8 * k];
    }
    // Катится и качается, пока не ляжет на бок.
    // Катится ободом, покачивается и встаёт ровно — корона лежит перед
    // мёртвым королём, её видно издали.
    const k = clamp((t - 0.72) / 0.45, 0, 1);
    const wob = Math.sin(k * Math.PI * 3) * (1 - k) * 0.5;
    return [38 + 7 * EZ.out2(k), 0, TAU + 0.12 + (5.7 - TAU) * (1 - EZ.out2(k)) + wob];
  };
  return {
    id: `die${rail ? 'R' : 'C'}`,
    geo: GEO_W,
    at(T) {
      const p = track(keys, T);
      const cr = crownPath(T);
      // Оружие выскальзывает на кадре 0,42 и ложится перед лапами.
      const drop = T >= 0.42;
      const bounce = T < 0.5 ? 0.45 : 0.08;
      return {
        p,
        fx: {
          weapon: drop ? 'none' : wpnOf(look),
          lid: !rail && T < 0.42,
          crownOff: cr,
          dropped: drop ? [rail ? 2 : 10, -1, (rail ? 0.02 : 0.15) + bounce] : undefined,
          eye: T < 0.6 ? 'squint' : 'dead',
          wave: T * 12,
          waveAmp: T < 0.6 ? 0.9 : T < 1.2 ? 0.4 * (1.2 - T) : 0,
          limp: clamp((T - 0.7) / 0.3, 0, 1) * (T > 1.14 && T < 1.22 ? 0.6 : 1),
          dissolve: T > 1.12 ? Math.min(1, (T - 1.12) / 0.34) : 0,
        },
      };
    },
    xf(T) {
      const imp = curve(
        [
          [0.58, 0],
          [0.62, 1, EZ.in2],
          [0.76, 0, EZ.out2],
        ],
        T,
      );
      const jolt = curve(
        [
          [0, 0],
          [0.05, -2.6, EZ.out3],
          [0.3, -1.2, EZ.io],
          [0.62, -1.8, EZ.io],
        ],
        T,
      );
      return {
        ...XF0,
        dx: jolt,
        sx: 1 + 0.1 * imp,
        sy: 1 - 0.14 * imp,
        shadow: T < 0.6 ? 16 : T < 1.12 ? 19 : Math.max(0, 19 * (1 - (T - 1.12) / 0.25)),
      };
    },
  };
}

// ---- Малые короли ---------------------------------------------------------
//
// Малый король — прежняя крыса-король на четырёх лапах (`KING_PAL`, мантия,
// венчик, узел из трёх хвостов), но поза теперь числа, а не номер кадра:
// растяжка, «встал на задние», выпад, стопы, хвосты. Геометрия покоя —
// та же, что у `paintKing(small)` в `dungeon-rats.ts`, поэтому облик прежний.

const QS = 1.35;
const QFAT = 1.4;
/** Холст малого: шире прежнего (хвосты не обрезаются), ноги — в (40, 36). */
const QG = { w: 84, h: 52, cx: 40, base: 40 };
/** Смещение прежнего кадра 50×28 (ноги в (27, 26)) в новый холст. */
const QOX = QG.cx - 27;
const QOY = QG.base - 26;

interface QP {
  /** Сдвиг всего тела, пиксели; подъём тела (доли роста). */
  bx: number;
  by: number;
  bob: number;
  /** Растяжка (галоп), встал на задние 0…1, выпад 0…1. */
  st: number;
  rear: number;
  lg: number;
  /** Голова: сдвиг; пасть; прищур; морда длиннее. */
  hx: number;
  hy: number;
  jaw: number;
  sq: number;
  sn: number;
  /** Стопы: сдвиг по x и подъём (передняя дальняя/ближняя, задняя дальняя/ближняя). */
  f1x: number;
  f1l: number;
  f2x: number;
  f2l: number;
  h1x: number;
  h1l: number;
  h2x: number;
  h2l: number;
  /** Хвосты: подъём над спиной, закрутка, качание. */
  tu: number;
  tc: number;
  ts: number;
  /** Лёг на бок (смерть) 0…1. */
  dead: number;
}

const QREST: QP = {
  bx: 0,
  by: 0,
  bob: 0,
  st: 0,
  rear: 0,
  lg: 0,
  hx: 0,
  hy: 0,
  jaw: 0,
  sq: 0,
  sn: 0,
  f1x: 0,
  f1l: 0,
  f2x: 0,
  f2l: 0,
  h1x: 0,
  h1l: 0,
  h2x: 0,
  h2l: 0,
  tu: 0,
  tc: 0,
  ts: 0,
  dead: 0,
};
const QP_FIELDS = Object.keys(QREST) as (keyof QP)[];
const qp = (b: QP, o: Partial<QP>): QP => ({ ...b, ...o });
function mixQP(a: QP, b: QP, k: number): QP {
  const o = { ...a };
  for (const f of QP_FIELDS) o[f] = a[f] + (b[f] - a[f]) * k;
  return o;
}
interface QKey {
  t: number;
  p: QP;
  e?: Ease;
}
function qtrack(keys: QKey[], T: number): QP {
  if (T <= keys[0].t) return keys[0].p;
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (T < b.t) {
      const a = keys[i - 1];
      return mixQP(a.p, b.p, (b.e ?? EZ.io)((T - a.t) / Math.max(1e-6, b.t - a.t)));
    }
  }
  return keys[keys.length - 1].p;
}

interface QFx {
  eye?: 'open' | 'squint' | 'dizzy' | 'dead';
  wave?: number;
  waveAmp?: number;
  whirl?: [number, number];
  whirlSx?: number;
  flip?: boolean;
  stars?: number;
  crownOff?: [number, number, number];
  dissolve?: number;
}

/** Нарисовать малого короля по позе (вправо). */
function paintQuad(P: QP, fx: QFx, T: number): { px: Px; lit: Px | null; eye: V | null } {
  const s = QS;
  const pal = KING_PAL;
  const W = QG.w;
  const H = QG.h;
  const base = QG.base;
  const px = new Px(W, H);
  let litPx: Px | null = null;
  const lit = () => (litPx ??= new Px(W, H));
  // Покой прежнего кадра, сдвинутый в новый холст.
  const o = 10 * s;
  const X = (v: number) => v + QOX + P.bx;
  const Y = (v: number) => v + QOY + P.by;
  const d = P.dead;
  const hx0 = o + 5 * s;
  const hy0 = 26 - 4.2 * s;
  const cx0 = o + 10.5 * s;
  const cy0 = 26 - 3.9 * s;
  const hrx = 5.4 * s * Math.sqrt(QFAT);
  const hry = 3.7 * s * QFAT * (1 - 0.2 * d);
  const crx = 4.3 * s;
  const cry = 3 * s * (1 - 0.15 * d);
  const headR = 3 * s;
  const hx = X(hx0 - P.st * 0.5 * s + (-0.6 * P.rear + 0.8 * P.lg) * s);
  const hy = Y(hy0 + 0.3 * s * P.rear - P.bob * s + d * 1.6 * s);
  const cx = X(cx0 + P.st * 0.5 * s + (-1.8 * P.rear + 2.6 * P.lg) * s);
  const cy = Y(cy0 - 3.4 * s * P.rear + 0.4 * s * P.lg - P.bob * 0.8 * s + d * 1.5 * s);
  const headX = X(o + 15.2 * s + P.st * 0.7 * s + (-1.6 * P.rear + 4.2 * P.lg + P.hx + 0.8 * d) * s);
  const headY = Y(26 - 5.2 * s - 5.4 * s * P.rear + P.lg * s + P.hy * s - P.bob * 0.7 * s + d * 2.2 * s);
  const snout = (2.8 + 0.8 * P.lg + P.sn) * s;
  const snoutDrop = (1.2 - 0.9 * P.rear) * s;
  const gnd = Y(base - QOY);
  // Лапы: у тела — к стопе; вставший на задние держит передние у груди.
  const front = (fx0: number, l: number, px0: number, py0: number): V => {
    const g: V = [X(cx0 + fx0 * s), gnd - l * s];
    const paw: V = [cx + px0 * s, cy + py0 * s];
    return lerp(g, paw, P.rear);
  };
  const deadLeg = (a: V, k: number): V => [a[0] + (k - 0.5) * 3 * s, a[1] - (2.2 + P.f1l) * s];
  let legs: [V, V][] = [
    [[cx + 1.2 * s, cy + 1.6 * s], front(1.8 + P.f1x, P.f1l, 3.6, 0.5)],
    [[cx - 0.3 * s, cy + 1.6 * s], front(0.2 + P.f2x, P.f2l, 3, 1.8)],
    [[hx + 2 * s, hy + 2.2 * s], [X(hx0 + 2.8 * s + P.h1x * s), gnd - P.h1l * s]],
    [[hx - 0.5 * s, hy + 2.4 * s], [X(hx0 + 0.3 * s + P.h2x * s), gnd - P.h2l * s]],
  ];
  if (d > 0)
    legs = legs.map(([a, b], i) => [a, lerp(b, deadLeg(a, i / 3), d)] as [V, V]);
  // Хвосты: узел за задом, три конца — вверх с завитком, назад, по земле.
  const kx = hx - hrx - 2.6 * s;
  const ky = hy + 0.6 * s - P.tu * 2.4 * s;
  const wave = fx.wave ?? T * 6;
  const amp = fx.waveAmp ?? 0.4;
  const strands: [V, V][] = [
    [
      [-3, -5],
      [-8, -4.5],
    ],
    [
      [-5, -0.8],
      [-11.5, -1.2],
    ],
    [
      [-3.5, 2.8],
      [-10, 2.6],
    ],
  ];
  const tails = strands.map(([m, e], i) =>
    tailPts(
      [kx, ky],
      m,
      e,
      P.tu * [0.9, 1.3, 0.7][i] - d * 0.3,
      P.tc * 1.6 * (i === 2 ? 0.6 : 1),
      (k) => (P.ts * 0.8 + Math.sin(wave - k * 2.4 + i * 1.3) * amp * (1 - d)) * k * s,
      gnd + 1,
      s,
    ),
  );
  const root: V[] = [
    [hx - hrx * 0.8, hy],
    [kx + 1.5 * s, ky - 0.5 * s],
    [kx, ky],
  ];
  for (const t of [root, ...tails]) {
    spline(t, 7).forEach(([x, y], i, arr) => {
      const k = i / arr.length;
      px.set(x, y, k < 0.5 ? pal.pink : pal.pinkDark);
      if (k < 0.6) px.set(x, y + 1, pal.pinkDark);
    });
  }
  // Огрызки хвостов: оторвались от короля.
  for (const t of tails.slice(0, 2)) {
    const e = t[t.length - 1];
    px.set(Math.round(e[0]), Math.round(e[1]), hex('#5a1a1c'));
  }
  px.ell(kx, ky, 2.3 * s, 2.3 * s * 0.85, (x, y) =>
    (x + y) % 3 === 0 ? pal.pinkDark : (x - y) % 4 === 0 ? hex('#e8aaa2') : pal.pink,
  );
  // Кольцо хвостов на развороте — за телом.
  const wst = 1 / (fx.whirlSx ?? 1);
  const G: Geo = { w: W, h: H, cx: QG.cx + 1, gy: base + 1, id: 'q' };
  if (fx.whirl && fx.whirl[1] > 0) {
    paintWhirl(px, lit(), G, fx.whirl[0], fx.whirl[1], true, 0.95 * TS, wst, false, !!fx.flip);
  }
  const leg = (l: [V, V], far: boolean) => {
    const [[x0, y0], [x1, y1]] = l;
    px.line(x0, y0, x1, y1, far ? pal.dark : pal.fur);
    px.line(x0 + 1, y0, x1 + 1, y1, far ? pal.dark : pal.fur);
    px.set(x1, y1, far ? pal.pinkDark : pal.pink);
    px.set(x1 + 1, y1, far ? pal.pinkDark : pal.pink);
    px.set(x1 + 2, y1, far ? pal.pinkDark : pal.pink);
  };
  leg(legs[0], true);
  leg(legs[2], true);
  const haunch: Ell = { x: hx, y: hy, rx: hrx, ry: hry };
  const chest: Ell = { x: cx, y: cy, rx: crx, ry: cry };
  const head: Ell = { x: headX, y: headY, rx: headR, ry: headR * 0.92 };
  const inE = (e: Ell, x: number, y: number) => {
    const dx = (x + 0.5 - e.x) / e.rx;
    const dy = (y + 0.5 - e.y) / e.ry;
    return dx * dx + dy * dy <= 1;
  };
  const box = (e: Ell) => [
    Math.floor(e.x - e.rx - 1),
    Math.ceil(e.x + e.rx + 1),
    Math.floor(e.y - e.ry - 1),
    Math.ceil(e.y + e.ry + 1),
  ];
  for (const e of [haunch, chest]) {
    const [a, b, c, dd] = box(e);
    for (let y = c; y <= dd; y++)
      for (let x = a; x <= b; x++) {
        if (e === chest && inE(haunch, x, y)) continue;
        if (inE(e, x, y)) px.set(x, y, shadeOf(pal, e, x, y, true));
      }
  }
  // Голова с клином морды к носу.
  const nx = headX + headR + snout;
  const ny = headY + snoutDrop;
  const [ha, hb, hc] = box(head);
  for (let y = hc; y <= Math.ceil(headY + headR + 2); y++)
    for (let x = ha; x <= Math.max(hb, Math.ceil(nx + 1)); x++) {
      const inHead = inE(head, x, y);
      const tx = (x + 0.5 - headX) / (nx - headX);
      let inSnout = false;
      if (tx > 0 && tx <= 1) {
        const top = headY - headR * 0.75 + (ny - (headY - headR * 0.75)) * tx;
        const bot =
          headY + headR * (0.7 - P.jaw * 0.2) + (ny + 0.5 - (headY + headR * 0.7)) * tx;
        inSnout = y + 0.5 >= top && y + 0.5 <= bot + 0.5;
      }
      if (inHead || inSnout)
        px.set(x, y, inHead ? shadeOf(pal, head, x, y, false) : y + 0.5 < ny - 0.3 ? pal.light : pal.fur);
    }
  if (P.jaw > 0.2) {
    const mx0 = Math.round(headX + headR * 0.3);
    const my = Math.round(ny + 0.5);
    const open = Math.round(P.jaw * 2);
    for (let x = mx0; x <= Math.round(nx) - 1; x++)
      for (let k = 0; k < open; k++) px.set(x, my + k, hex('#4a1418'));
    const tooth = hex('#f4ece0');
    px.set(Math.round(nx) - 1, my, tooth);
    px.set(Math.round(nx) - 2, my, tooth);
    for (let x = mx0; x <= Math.round(nx) - 2; x++) px.set(x, my + open, pal.fur);
  }
  px.set(Math.round(nx), Math.round(ny), pal.pink);
  const ex = headX - headR * 0.35;
  const ey = headY - headR * 0.95;
  px.ell(ex, ey, 2.2, 2.2, pal.fur);
  px.ell(ex + 0.3, ey + 0.2, 1.2, 1.2, pal.pink);
  leg(legs[1], false);
  leg(legs[3], false);
  // Мантия по холке.
  if (d < 0.5) {
    const mx0 = hx - hrx * 0.5;
    const mx1 = cx + crx * 0.4;
    for (let x = Math.floor(mx0); x <= Math.ceil(mx1); x++) {
      const t = (x - mx0) / (mx1 - mx0);
      const topY = hy - hry + (cy - cry - (hy - hry)) * t - 0.5;
      const len = (2.4 + Math.sin(t * Math.PI) * 1.6) * s;
      for (let y = Math.floor(topY); y <= topY + len; y++) {
        const edge = y > topY + len - 1;
        px.set(x, y, edge ? CLOTH.cape[0] : y < topY + 1.2 ? CLOTH.cape[2] : CLOTH.cape[1]);
      }
      if (x % 3 === 0) px.set(x, Math.floor(topY + len) + 1, METAL.gold[0]);
    }
  }
  // Венчик — на голове или слетел.
  const cw = Math.round(headR * 1.7);
  const drawCrown = (x0: number, y0: number) => {
    const ch = 3;
    px.rect(x0, y0, x0 + cw, y0 + 1, METAL.gold[2]);
    px.rect(x0, y0 + 1, x0 + cw, y0 + 1, METAL.gold[0]);
    for (const k of [0, 0.5, 1]) {
      const x = Math.round(x0 + cw * k);
      px.rect(x, y0 - ch + 1, x, y0, METAL.gold[2]);
      px.set(x, y0 - ch, METAL.gold[3]);
    }
    px.set(Math.round(x0 + cw / 2), y0, hex('#d8203a'));
  };
  if (fx.crownOff) {
    const [ox2, oy2, a] = fx.crownOff;
    if (Math.abs(a) < 0.6) drawCrown(Math.round(QG.cx + ox2), Math.round(base + oy2 - 1));
    else {
      // На боку: обод полоской, зубцы вбок.
      const x0 = Math.round(QG.cx + ox2);
      const y0 = Math.round(base + oy2);
      px.rect(x0, y0 - cw, x0 + 1, y0, METAL.gold[2]);
      px.set(x0 + 2, y0 - cw, METAL.gold[3]);
      px.set(x0 + 2, y0 - Math.round(cw / 2), METAL.gold[3]);
      px.set(x0 + 2, y0, METAL.gold[3]);
      px.set(x0, y0 - Math.round(cw / 2), hex('#d8203a'));
    }
  } else drawCrown(Math.round(headX - headR * 0.9), Math.round(headY - headR * 1.15));
  outlineFast(px, KING_PAL.ink);
  if (fx.whirl && fx.whirl[1] > 0)
    paintWhirl(px, lit(), G, fx.whirl[0], fx.whirl[1], false, 0.95 * TS, wst, false, !!fx.flip);
  // Глаз.
  const gx = Math.round(headX + headR * 0.35);
  const gy = Math.round(headY - headR * 0.2);
  let eye: V | null = [gx, gy];
  const em = fx.eye ?? (P.sq >= 0.5 ? 'squint' : 'open');
  if (em === 'dead') {
    px.set(gx - 1, gy - 1, pal.ink);
    px.set(gx + 1, gy + 1, pal.ink);
    px.set(gx + 1, gy - 1, pal.ink);
    px.set(gx - 1, gy + 1, pal.ink);
    px.set(gx, gy, pal.ink);
    eye = null;
  } else if (em === 'squint') {
    px.set(gx, gy + 1, pal.ink);
    px.set(gx + 1, gy + 1, pal.ink);
  } else if (em === 'dizzy') {
    const q = Math.floor(T * 10) % 4;
    const ex2 = gx + (q === 1 || q === 2 ? 1 : 0);
    const ey2 = gy + (q >= 2 ? 1 : 0);
    px.set(ex2, ey2, pal.eye);
    eye = [ex2, ey2];
  } else {
    px.rect(gx, gy, gx + 1, gy + 1, pal.eye);
    px.set(gx + 1, gy, pal.eyeHi);
  }
  if (fx.stars !== undefined) {
    for (let i = 0; i < 3; i++) {
      const a = fx.stars + (i * TAU) / 3;
      const near = Math.sin(a) > 0;
      sparkAt(
        lit(),
        headX - 1 + Math.cos(a) * 5.5,
        headY - headR - 5 + Math.sin(a) * 1.6,
        near ? 2 : 1,
        near ? [255, 220, 90, 255] : [200, 160, 70, 200],
        [255, 250, 210, 255],
      );
    }
  }
  if (fx.dissolve && fx.dissolve > 0) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (!px.data[i + 3]) continue;
        const h = hash01(x >> 1, y >> 1, 13) * 0.8 + (1 - y / H) * 0.2;
        if (h < fx.dissolve) px.data[i + 3] = 0;
      }
  }
  return { px, lit: litPx, eye };
}

/** Покой малого: дышит, принюхивается, хвосты ходят (2 с, 8 к/с). */
function qIdle(T0: number): [QP, QFx] {
  const T = ((T0 % 2) + 2) % 2;
  const ph = (T / 2) * TAU;
  const br = 0.5 - 0.5 * Math.cos(ph * 2);
  return [
    qp(QREST, {
      bob: 0.35 * br,
      hy: T > 1.1 && T < 1.35 ? -0.5 : 0,
      sn: T > 1.1 && T < 1.35 ? 0.5 : 0,
      sq: T > 0.5 && T < 0.62 ? 1 : 0,
      ts: 0.6 * Math.sin(ph + 1),
    }),
    { wave: ph * 2, waveAmp: 0.45 },
  ];
}

/** Галоп малого: 8 поз на цикл — растяжка, группировка, полёт. */
function qRun(u: number): [QP, QFx] {
  const ph = u * TAU;
  const st = Math.sin(ph) * 1.9;
  const bob = Math.max(0, Math.sin(ph + 0.9)) * 1.4;
  const fr = Math.cos(ph) * 3;
  const hr = -Math.cos(ph) * 3.2;
  const lift = (k: number) => Math.max(0, Math.sin(ph + k)) * 1.6;
  return [
    qp(QREST, {
      st,
      bob,
      hy: Math.sin(ph) * 0.3,
      f1x: fr - 0.4,
      f1l: lift(0.3),
      f2x: fr * 0.8,
      f2l: lift(0.9),
      h1x: hr - 0.8,
      h1l: lift(3.4),
      h2x: hr * 0.8,
      h2l: lift(4),
      tu: 0.25,
      ts: -0.4,
    }),
    { wave: ph * 2, waveAmp: 0.7 },
  ];
}

const Q_CROUCH = qp(QREST, { by: 2.2, st: -1.2, hx: -0.8, hy: 1.4, sq: 1, tu: 0.4, tc: 0.8, f1x: -0.6, h1x: 0.8 });

/** Хлыст малого (замах 0,7): встаёт на задние, хвосты скорпионом над спиной, трещат; разворот с кольцом. */
function qWhip(T: number, wu: number, rec: number): [QP, QFx, number] {
  const f = 1 / FPS;
  const up = qp(QREST, { rear: 0.85, jaw: 0.6, tu: 1.1, tc: 1, hy: -0.3 });
  const spin = qp(QREST, { rear: 0.2, jaw: 1, tu: 0.3, st: 0.6 });
  const keys: QKey[] = [
    { t: 0, p: QREST },
    { t: Math.min(0.16, wu * 0.25), p: qp(up, { rear: 0.5, tu: 0.7 }), e: EZ.out2 },
    { t: wu - 0.22, p: up, e: EZ.io },
    { t: wu - 3 * f, p: up },
    { t: wu - 2 * f, p: spin, e: EZ.out2 },
    { t: wu + 3 * f, p: spin },
    { t: wu + 0.3, p: qp(QREST, { tu: -0.2, ts: 0.6 }), e: EZ.out2 },
    { t: wu + rec - 0.04, p: QREST, e: EZ.io },
  ];
  const p = qtrack(keys, T);
  const k = Math.floor((T - (wu - 2 * f)) * FPS + 1e-4);
  const sp = k >= 0 && k < SPIN.length ? SPIN[k] : null;
  const rattle = T > wu - 0.24 && T < wu - 2 * f;
  return [
    p,
    {
      flip: sp ? sp[0] : false,
      whirl: sp ? [sp[2], sp[3]] : undefined,
      whirlSx: sp ? sp[1] : 1,
      wave: rattle ? T * 55 : T * 9,
      waveAmp: rattle ? 0.6 : 0.4,
    },
    sp ? sp[1] : 1,
  ];
}

const QFR = frameLRU<KPainted>(220);

/** Кадр малого короля. */
function kingletFrame(m: Mob, pose: MobPose): MobFrame {
  const st = kstate(m, pose);
  const h = hasteOf(m);
  const look: KingLook = { blade: false, split: true };
  if (pose.mode === 'roll' || pose.mode === 'rollAim') {
    const b = kingBallFrame(m, pose, look, h, st, true);
    if (b) return b;
  }
  const t = pose.t;
  let id: string;
  let Tq: number;
  let P: QP;
  let fx: QFx = {};
  let sx = 1;
  let sy = 1;
  let dx = 0;
  let dy = 0;
  let rot = 0;
  let linger: number | undefined;
  const mode = pose.mode;
  const rec = m.data?.rec ?? 0;
  const wu = 0.7 / h;
  if (mode === 'whipAim' || (mode === 'recover' && Math.abs(rec - 0.6) < 0.01)) {
    const T = mode === 'whipAim' ? quant(t, wu, true) : wu + quant(t, 0.6, false);
    Tq = T;
    id = `qw${wu.toFixed(3)}`;
    const r = qWhip(T, wu, 0.6);
    P = r[0];
    fx = r[1];
    sx = r[2];
    const Tc = mode === 'whipAim' ? t : wu + t;
    if (Tc > wu - 0.24 && Tc < wu - 2 / FPS) dx = Math.sin(Tc * 120) * 0.35;
  } else if (mode === 'rollAim') {
    // До клубка: сжался в комок.
    const D = 0.8 / h;
    Tq = quant(t, D, false);
    id = `qa${D.toFixed(3)}`;
    P = mixQP(QREST, Q_CROUCH, EZ.io(clamp(Tq / (D * BALL_FROM), 0, 1)));
    fx = { eye: 'squint' };
    const k = clamp(t / (D * BALL_FROM), 0, 1);
    sx = 1 + 0.08 * k;
    sy = 1 - 0.12 * k;
  } else if (mode === 'dizzy') {
    Tq = quant(t, 0.8, false);
    id = 'qd';
    const w = Math.min(1, Tq / 0.12);
    P = qp(QREST, {
      by: 1.2 * (1 - w),
      hx: 0.4 * Math.cos(Tq * TAU * 1.5),
      hy: 0.3 * Math.sin(Tq * TAU * 1.5),
      jaw: 0.5,
      ts: 0.7 * Math.sin(Tq * 5),
    });
    fx = { eye: Tq < 0.66 ? 'dizzy' : 'open', stars: Tq < 0.66 ? Tq * 6 : undefined };
    rot = 0.08 * Math.sin(t * TAU * 1.2) * Math.min(1, t / 0.12);
    const pop = Math.max(0, 1 - t / 0.12);
    sx = 1 + 0.12 * pop;
    sy = 1 - 0.14 * pop;
  } else if (mode === 'stun') {
    // Оторвался от короля: кувырок клубком и шлепок о пол.
    if (t < 0.24) {
      const b = kingBallFrame({ ...m, mode: 'roll', dir: m.dir } as Mob, { ...pose, mode: 'roll', t: t * 1.6 }, look, h, st, true);
      if (b) return { ...b, dy: -10 * Math.sin((t / 0.24) * Math.PI), shadow: 7 };
    }
    Tq = quant(t, 0.4, false);
    id = 'qs';
    const k = clamp((Tq - 0.24) / 0.16, 0, 1);
    P = qp(QREST, { by: 1.6 * (1 - k), st: 1.2 * (1 - k), sq: 1, jaw: 0.5, h1x: -1, f1x: 1.2 });
    fx = { eye: 'squint' };
    const land = Math.max(0, 1 - (t - 0.24) / 0.14);
    sx = 1 + 0.2 * land;
    sy = 1 - 0.22 * land;
  } else if (mode === 'dying') {
    Tq = quant(t, 1.0, false);
    id = 'qx';
    linger = 1.0;
    const T = Tq;
    const flop = EZ.out2(clamp(T / 0.22, 0, 1));
    const kick = T > 0.3 && T < 0.62 ? Math.max(0, Math.sin((T - 0.3) * 30)) * 1.2 : 0;
    P = qp(QREST, { dead: flop, jaw: 0.6, f1l: kick, sq: 1 });
    // Венчик слетает и катится вперёд.
    const c = T - 0.04;
    const cr: [number, number, number] | undefined =
      c < 0
        ? undefined
        : c < 0.3
          ? [8 + 30 * c, -22 + 150 * c * c - 40 * c, 0.3 + c * 6]
          : [17 + 8 * EZ.out2(clamp((c - 0.3) / 0.4, 0, 1)), 0, 1.4];
    fx = {
      eye: T < 0.2 ? 'squint' : 'dead',
      crownOff: cr,
      dissolve: T > 0.62 ? Math.min(1, (T - 0.62) / 0.34) : 0,
      waveAmp: 0.3 * (1 - flop),
    };
    const imp = T > 0.14 && T < 0.3 ? 1 - (T - 0.14) / 0.16 : 0;
    sx = 1 + 0.1 * imp;
    sy = 1 - 0.14 * imp;
  } else if (Math.hypot(m.vx, m.vy) > 0.4) {
    const u = Math.floor(st.run * 8) / 8;
    Tq = u;
    id = 'qr';
    [P, fx] = qRun(u);
    const c = Math.cos(2 * (u * TAU - 0.9));
    sx = 1 + 0.03 * c;
    sy = 1 - 0.04 * c;
  } else {
    const T = pose.now % 2;
    Tq = Math.floor(T * 8) / 8;
    id = 'qi';
    [P, fx] = qIdle(Tq);
  }
  const hurt = pose.now - st.hitAt < 0.12 && (id === 'qi' || id === 'qr');
  if (hurt) P = qp(P, { sq: 1, hx: P.hx - 0.6, jaw: 0.5 });
  const key = `${id}|${Math.round(Tq * 1000)}|${hurt ? 1 : 0}|${pose.left ? 1 : 0}`;
  let fr = QFR.get(key);
  if (!fr) {
    MISS.q++; // TEMP-BENCH
    const r = paintQuad(P, fx, Tq);
    const flip = pose.left !== !!fx.flip;
    fr = QFR.set(key, cropFrame(r.px, r.lit, QG.cx, QG.base, r.eye, flip));
  }
  const rc = recoil(st, pose.now);
  const sgn = pose.left ? -1 : 1;
  return {
    img: pose.flash ? flashOf('q' + key, fr.img) : fr.img,
    ax: fr.ax,
    ay: fr.ay,
    eye: fr.eye,
    dx: dx * sgn + rc.dx * 0.8,
    dy,
    sx: sx * rc.sx,
    sy: sy * rc.sy,
    rot: rot * sgn + rc.rot,
    still: true,
    shadow: mode === 'dying' ? Math.max(0, 9 * (1 - Math.max(0, t - 0.62) / 0.3)) : 9,
    lit: fr.lit,
    linger,
  };
}

// ---- Выбор клипа по режиму мозга -------------------------------------------

/**
 * Время кадра на сетке 24 к/с. Отрезок замаха, кончающийся ударом,
 * считается с КОНЦА: два последних кадра — удар со следом, и они полные
 * при любой длине замаха; короткий кадр уходит в середину отрезка.
 */
function quant(t: number, D: number, fromEnd: boolean, fps = FPS): number {
  if (!fromEnd || t < D / 2) return Math.floor(t * fps + 1e-6) / fps;
  // Кадр j от конца занимает [D − (j+1)/fps, D − j/fps).
  const j = Math.max(0, Math.ceil((D - t) * fps - 1e-6) - 1);
  return Math.max(0, D - (j + 1) / fps);
}

interface Pick {
  clip: Clip;
  /** Время позы (на сетке) и время хода тела (непрерывное). */
  Tq: number;
  Tc: number;
}

const seg = (clip: Clip, off: number, t: number, D: number, fromEnd: boolean): Pick => ({
  clip,
  Tq: off + quant(Math.max(0, t), D, fromEnd),
  Tc: off + Math.max(0, t),
});

/** Клипы с числами из мозга живут в кеше: собрать дорожку — не на каждом кадре. */
const CLIPS = new Map<string, Clip>();
function clipOf(key: string, make: () => Clip): Clip {
  let c = CLIPS.get(key);
  if (!c) {
    c = make();
    CLIPS.set(key, c);
    if (CLIPS.size > 120) CLIPS.delete(CLIPS.keys().next().value as string);
  }
  return c;
}

/** Ускорение мозга (ярость после 150 с, рельс ниже 10 %): тайминги короче. */
function hasteOf(m: Mob): number {
  if (m.kind !== 'king' && m.kind !== 'kinglet') return 1;
  const b = paintSim()?.boss;
  if (!b) return 1;
  let h = b.t > 150 ? 1.35 : 1;
  if (m.kind === 'king' && b.phase >= 3 && m.hp < m.maxHp * 0.1) h *= 1.15;
  return h;
}

/** Что помнит рисовальщик о моба между кадрами: шаг бега, отдача. */
interface KSt {
  now: number;
  run: number;
  fl: number;
  hitAt: number;
  hitDir: number;
  dir: number;
  bumpAt: number;
  bumpX: boolean;
}
const KST = new Map<number, KSt>();

function kstate(m: Mob, pose: MobPose): KSt {
  let st = KST.get(m.id);
  if (!st || pose.now < st.now - 0.5) {
    if (KST.size > 48) KST.clear();
    st = { now: pose.now, run: 0, fl: 0, hitAt: -9, hitDir: 1, dir: m.dir, bumpAt: -9, bumpX: true };
    KST.set(m.id, st);
  }
  const dt = clamp(pose.now - st.now, 0, 0.1);
  st.now = pose.now;
  // Шаг бега — по пройденному пути: ~27 пикселей на цикл из двух шагов.
  const v = Math.hypot(m.vx, m.vy) * TS;
  st.run = (st.run + (dt * v) / (m.kind === 'kinglet' ? 20 : 27)) % 1;
  // Удар героя: фронт вспышки — отдача прочь от героя.
  if (m.flash > st.fl + 0.02 && m.mode !== 'dying') {
    st.hitAt = pose.now;
    const h = paintSim()?.hero;
    st.hitDir = h ? (m.x >= h.x ? 1 : -1) : pose.left ? 1 : -1;
  }
  st.fl = m.flash;
  // Отскок клубка от стены: направление сменилось — сплющить по оси удара.
  if (m.mode === 'roll' && Math.abs(Math.atan2(Math.sin(m.dir - st.dir), Math.cos(m.dir - st.dir))) > 0.3) {
    st.bumpAt = pose.now;
    st.bumpX = Math.abs(Math.cos(m.dir) + Math.cos(st.dir)) < Math.abs(Math.sin(m.dir) + Math.sin(st.dir));
  }
  st.dir = m.dir;
  return st;
}

/** Вздрогнул от удара героя: прищур, голова назад (поверх покоя и бега). */
function flinchClip(base: Clip): Clip {
  return {
    ...base,
    id: base.id + 'H',
    at(T) {
      const sh = base.at(T);
      const p = sh.p;
      return {
        p: kp(p, { sq: 1, jaw: 0.45, nx: p.nx - 0.45, ny: p.ny - 0.3, ln: p.ln - 0.1 }),
        fx: sh.fx,
      };
    },
  };
}

/** Ярость (после 150 с): в покое злые глаза и пар из ноздрей. */
function rageClip(base: Clip): Clip {
  return {
    ...base,
    id: base.id + '!',
    at(T) {
      const sh = base.at(T);
      const k = ((T % 1.2) + 1.2) % 1.2;
      return { p: kp(sh.p, { jaw: 0.25 }), fx: { ...sh.fx, eye: 'angry', steam: k < 0.5 ? k / 0.5 : 0 } };
    },
  };
}

function kingPick(m: Mob, pose: MobPose, look: KingLook, h: number, st: KSt): Pick {
  const t = pose.t;
  const echo = m.kind !== 'king';
  const rec = m.data?.rec ?? 0;
  const L = `${look.blade ? 'R' : 'C'}${look.split ? 'S' : ''}`;
  const is = (v: number) => Math.abs(rec - v) < 0.01;
  const cleave = (wu: number, r: number) => clipOf(`cl${wu}|${r}`, () => cleaveClip(wu, r));
  const whip = (wu: number) => clipOf(`wh${wu}${L}`, () => whipClip(wu, 0.6, look));
  const sweep = (wa: number, wb: number) => clipOf(`sw${wa}|${wb}`, () => sweepClip(wa, wb));
  const leap = (wu: number) => clipOf(`lp${wu}`, () => leapClip(wu));
  switch (pose.mode) {
    case 'roar':
      return seg(clipOf(`roar${L}`, () => roarClip(look)), 0, t, 1.2, false);
    case 'summon':
      return seg(clipOf(`sum${L}`, () => summonClip(look)), 0, t, 1.0, false);
    case 'rollAim': {
      const D = echo ? 0.85 : 0.8 / h;
      return seg(clipOf(`ra${D}${L}`, () => rollAimClip(D, look)), 0, t, D, false);
    }
    case 'dizzy':
    case 'stun': {
      const D = echo ? 1.6 : 1.3;
      return seg(clipOf(`dz${D}${L}`, () => dizzyClip(D, look)), 0, t, D, false);
    }
    case 'cleaveAim': {
      const wu = 0.75 / h;
      return seg(cleave(wu, 0.7), 0, t, wu, true);
    }
    case 'windup':
      // Эхо на 15-м: рубка тем же клипом (замах 0,7, отдых 0,55).
      return seg(cleave(0.7, 0.55), 0, t, 0.7, true);
    case 'whipAim': {
      const wu = 0.7 / h;
      return seg(whip(wu), 0, t, wu, true);
    }
    case 'swap':
      return seg(clipOf(`swap${pose.left ? 'F' : 'B'}`, () => swapClip(pose.left)), 0, t, 1.5, false);
    case 'sweepAim': {
      const wa = 0.55 / h;
      const wb = 0.38 / h;
      const combo = m.data?.combo ?? 3;
      const off = combo >= 3 ? 0 : combo === 2 ? wa : wa + wb;
      return seg(sweep(wa, wb), off, t, combo >= 3 ? wa : wb, true);
    }
    case 'leapAim': {
      const wu = 0.7 / h;
      return seg(leap(wu), 0, t, wu, true);
    }
    case 'leap': {
      const wu = 0.7 / h;
      return seg(leap(wu), wu, t, 0.5, true);
    }
    case 'recover': {
      if (echo) return seg(cleave(0.7, 0.55), 0.7, t, 0.55, false);
      if (is(0.7)) return seg(cleave(0.75 / h, 0.7), 0.75 / h, t, 0.7, false);
      if (is(0.6)) return seg(whip(0.7 / h), 0.7 / h, t, 0.6, false);
      if (is(1.1)) {
        const wa = 0.55 / h;
        const wb = 0.38 / h;
        return seg(sweep(wa, wb), wa + 2 * wb, t, 1.1, false);
      }
      if (is(1.0)) return seg(leap(0.7 / h), 0.7 / h + 0.5, t, 1.0, false);
      break;
    }
    case 'dying':
      return seg(clipOf(`die${L}`, () => deathClip(look)), 0, t, DIE_T, false);
    default:
      break;
  }
  // Покой и бег; вздрогнул от удара — своя поза на 0,12 с.
  const hurt = pose.now - st.hitAt < 0.12;
  const rage = !echo && h >= 1.35;
  const running = Math.hypot(m.vx, m.vy) > 0.4;
  if (running) {
    let clip = clipOf(`run${L}`, () => runClip(look));
    if (hurt) clip = clipOf(`run${L}H`, () => flinchClip(runClip(look)));
    const T = (Math.floor(st.run * 8) / 8) * RUN_T;
    return { clip, Tq: T, Tc: st.run * RUN_T };
  }
  let clip = clipOf(`idle${L}`, () => idleClip(look));
  if (rage) clip = clipOf(`idle${L}!`, () => rageClip(idleClip(look)));
  if (hurt) clip = clipOf(`idle${L}${rage ? '!' : ''}H`, () => flinchClip(clip));
  const T = pose.now % IDLE_T;
  return { clip, Tq: Math.floor(T * 10) / 10, Tc: T };
}

/** Клубок: катится (`roll`) или раскручивается на месте в конце прицела. */
function kingBallFrame(m: Mob, pose: MobPose, look: KingLook, h: number, st: KSt, small: boolean): MobFrame | null {
  const t = pose.t;
  const echo = m.kind !== 'king' && m.kind !== 'kinglet';
  const steps = small ? BALL_STEPS.kinglet : BALL_STEPS.king;
  let step: number;
  let xf: Xf = XF0;
  if (pose.mode === 'rollAim') {
    const D = echo ? 0.85 : 0.8 / h;
    const t0 = D * BALL_FROM;
    if (t < t0) return null;
    const tau = t - t0;
    const dur = D - t0;
    step = revSteps(Math.floor(tau * FPS) / FPS, dur);
    const k = clamp(tau / dur, 0, 1);
    const pop = Math.max(0, 1 - tau / 0.1);
    // Взвёлся назад, как пружина; дрожит от оборотов.
    xf = {
      ...XF0,
      dx: -2 * EZ.out2(k) + Math.sin(pose.now * 90) * 0.5 * k,
      sx: 1 + 0.16 * pop,
      sy: 1 - 0.16 * pop,
    };
  } else {
    step = Math.floor(t * FPS + 1e-6);
    const launch = Math.max(0, 1 - t / 0.12);
    const bump = pose.now - st.bumpAt;
    const b = bump >= 0 && bump < 0.16 ? Math.sin((bump / 0.16) * Math.PI) : 0;
    const along = Math.abs(Math.cos(m.dir)) > Math.abs(Math.sin(m.dir));
    // Удар о стену — сплющился по оси удара; старт — вытянут по ходу.
    const sxK = (st.bumpX ? -0.22 : 0.14) * b + (along ? 0.12 : -0.08) * launch;
    const syK = (st.bumpX ? 0.14 : -0.22) * b + (along ? -0.1 : 0.12) * launch;
    // Шар бугристый: подскакивает на корону и узлы.
    const hop = -Math.abs(Math.sin((step / steps) * TAU * 2)) * 1.2;
    xf = {
      ...XF0,
      dy: hop,
      sx: 1 + sxK,
      sy: 1 + syK,
      ghost: { every: 0.035, life: 0.16, tint: small ? '#c89a92' : '#d2aaa2', alpha: 0.3 },
    };
  }
  const bk = ballKey(m.dir);
  const s = ((step % steps) + steps) % steps;
  const { key, fr } = ballFrame(small, bk, s, steps, look.split);
  return {
    img: pose.flash ? flashOf(key, fr.img) : fr.img,
    ax: fr.ax,
    ay: fr.ay,
    eye: null,
    dx: xf.dx,
    dy: xf.dy,
    sx: xf.sx,
    sy: xf.sy,
    rot: 0,
    still: true,
    shadow: small ? 8 : 14,
    ghost: xf.ghost ?? null,
  };
}

// ---- Рисовальщик ----------------------------------------------------------

const MISS = { k: 0, b: 0, q: 0, f: 0 }; // TEMP-BENCH
const KFR = frameLRU<KPainted>(400);
/** Клубки — отдельно: 8 направлений × 13 шагов не должны вытеснять техники. */
const BFR = frameLRU<KPainted>(200);

function ballFrame(
  small: boolean,
  bk: { q: number; left: boolean; dirA: number },
  s: number,
  steps: number,
  split: boolean,
): { key: string; fr: KPainted } {
  const key = `ball${small ? 'k' : ''}|${bk.q}|${s}|${split ? 1 : 0}|${bk.left ? 1 : 0}`;
  let fr = BFR.get(key);
  if (!fr) {
    MISS.b++; // TEMP-BENCH
    const px = ballPx(small ? 8.5 : 14, bk.dirA, (s / steps) * TAU, split, small);
    fr = BFR.set(key, cropFrame(px, null, px.w / 2, px.h - 2, null, bk.left));
  }
  return { key, fr };
}

/** Кадр клипа из кеша (или нарисовать): ключ покрывает всё, что читает рисунок. */
function kingCached(
  clip: Clip,
  Tq: number,
  look: KingLook,
  left: boolean,
  lk: MobPose['look'],
): { key: string; fr: KPainted } {
  const key = `${clip.id}|${Math.round(Tq * 1000)}|${look.blade ? 1 : 0}${look.split ? 1 : 0}|${left ? 1 : 0}|${lk}`;
  let fr = KFR.get(key);
  if (!fr) {
    MISS.k++; // TEMP-BENCH
    fr = KFR.set(key, kingPaint(clip, Tq, look, lk === 'elite', left));
  }
  return { key, fr };
}
const KFLASH = frameLRU<HTMLCanvasElement>(48);

/** Белая вспышка удара — копия кадра, перекрашенная на 90 %. */
function flashOf(key: string, img: HTMLCanvasElement): HTMLCanvasElement {
  let c = KFLASH.get(key);
  if (c) return c;
  MISS.f++; // TEMP-BENCH
  c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 0, c.width, c.height);
  return KFLASH.set(key, c);
}

/** Отдача от удара героя: толчок прочь, наклон, сжатие — 0,2 с. */
function recoil(st: KSt, now: number): Xf {
  const a = now - st.hitAt;
  if (a < 0 || a > 0.22) return XF0;
  const e = a < 0.035 ? a / 0.035 : Math.max(0, 1 - (a - 0.035) / 0.185) ** 2;
  return {
    dx: st.hitDir * 2.2 * e,
    dy: 0,
    sx: 1 + 0.04 * e,
    sy: 1 - 0.04 * e,
    rot: st.hitDir * 0.05 * e,
  };
}

function kingFrame(m: Mob, pose: MobPose): MobFrame {
  const look: KingLook = { blade: !!m.data?.f1blade, split: !!m.data?.f1split };
  const st = kstate(m, pose);
  const h = hasteOf(m);
  if (pose.mode === 'roll' || pose.mode === 'rollAim') {
    const b = kingBallFrame(m, pose, look, h, st, false);
    if (b) return b;
  }
  const sel = kingPick(m, pose, look, h, st);
  const { key, fr } = kingCached(sel.clip, sel.Tq, look, pose.left, pose.look);
  const xf = sel.clip.xf?.(sel.Tc, sel.Tq) ?? XF0;
  const rc = recoil(st, pose.now);
  const sgn = pose.left ? -1 : 1;
  return {
    img: pose.flash ? flashOf(key, fr.img) : fr.img,
    ax: fr.ax,
    ay: fr.ay,
    eye: fr.eye,
    dx: xf.dx * sgn + rc.dx,
    dy: xf.dy + rc.dy,
    sx: xf.sx * rc.sx,
    sy: xf.sy * rc.sy,
    rot: xf.rot * sgn + rc.rot,
    still: true,
    shadow: xf.shadow ?? 16,
    lit: fr.lit,
    ghost: xf.ghost ?? null,
    alpha: xf.alpha,
    linger: pose.mode === 'dying' ? DIE_T : undefined,
  };
}

registerMobPainter('f1_king', (m, pose) =>
  m.kind === 'kinglet' ? kingletFrame(m, pose) : kingFrame(m, pose),
);

// ---- Прогрев ---------------------------------------------------------------

/** Все времена кадров отрезка (как их выдаст `quant`). */
function segTimes(D: number, fromEnd: boolean): number[] {
  const out = new Set<number>();
  for (let t = 0; t < D; t += 1 / (FPS * 4)) out.add(quant(t, D, fromEnd));
  return [...out];
}

/**
 * Прогрев первой фазы: покой, бег, рык, перекат (и клубок во все стороны),
 * оглушение, рубка и хлыст — в обе стороны, по кадру на шаг. Рендер тратит
 * на это до 3 мс за кадр, пока король в мире (спит на троне до боя).
 */
registerMobWarm('f1_king', function* () {
  const look: KingLook = { blade: false, split: false };
  const clips: [Clip, number[]][] = [];
  const idle = clipOf('idleC', () => idleClip(look));
  clips.push([idle, Array.from({ length: IDLE_T * 10 }, (_, i) => i / 10)]);
  const run = clipOf('runC', () => runClip(look));
  clips.push([run, Array.from({ length: 8 }, (_, i) => (i / 8) * RUN_T)]);
  clips.push([clipOf('roarC', () => roarClip(look)), segTimes(1.2, false)]);
  const cl = clipOf('cl0.75|0.7', () => cleaveClip(0.75, 0.7));
  clips.push([cl, [...segTimes(0.75, true), ...segTimes(0.7, false).map((t) => t + 0.75)]]);
  const wh = clipOf('wh0.7C', () => whipClip(0.7, 0.6, look));
  clips.push([wh, [...segTimes(0.7, true), ...segTimes(0.6, false).map((t) => t + 0.7)]]);
  const ra = clipOf('ra0.8C', () => rollAimClip(0.8, look));
  clips.push([ra, segTimes(0.8 * BALL_FROM, false)]);
  clips.push([clipOf('dz1.3C', () => dizzyClip(1.3, look)), segTimes(1.3, false)]);
  for (const [clip, times] of clips)
    for (const left of [false, true])
      for (const T of times) {
        kingCached(clip, T, look, left, 'normal');
        yield 0;
      }
  // Клубок: восемь направлений качения, полный оборот.
  for (let q = -4; q < 4; q++) {
    const bk = ballKey((q * Math.PI) / 4 + 0.01);
    for (let st = 0; st < BALL_STEPS.king; st++) {
      ballFrame(false, bk, st, BALL_STEPS.king, false);
      yield 0;
    }
  }
});

// TEMP-BENCH
(globalThis as unknown as Record<string, unknown>).__f1k = {
  MISS,
  kingPaint,
  cleaveClip,
  sweepClip,
  whipClip,
  idleClip,
  paintQuad,
  qIdle,
  ballPx,
  drawRig,
  kRig,
};
// ⟦king-end⟧

// ---------------------------------------------------------------------------
// Снаряд: камень пращи. Кувыркается — два кадра.
// ---------------------------------------------------------------------------

const sprites = new Map<string, Sprite>();

export function cachedSprite(key: string, make: () => Sprite): Sprite {
  let s = sprites.get(key);
  if (!s) {
    s = make();
    sprites.set(key, s);
  }
  return s;
}

registerShotPainter('f1_stone', (s, time) => {
  const f = Math.floor(time * 12 + s.id) % 2;
  return cachedSprite(`stone|${f}`, () => {
    const px = new Px(7, 7);
    px.ell(3.5, 3.5, 2.6, 2.2, hex('#7a746a'));
    px.set(f ? 2 : 3, 2, hex('#c8c0b0'));
    px.set(f ? 3 : 2, 2, hex('#a8a090'));
    px.set(4, 4, hex('#4a4640'));
    px.outline(INK);
    return { img: px.canvas(), ax: 3.5, ay: 3.5 };
  });
});

// ---------------------------------------------------------------------------
// Метки и лужи-рисунки на полу.
// ---------------------------------------------------------------------------

/** Кружок-метка с заливкой, как у движка, но своего цвета. */
function ringMark(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  k: number,
  rgb: string,
): void {
  g.strokeStyle = `rgba(${rgb},${0.45 + 0.45 * k})`;
  g.lineWidth = 1;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = `rgba(${rgb},${0.1 + 0.25 * k})`;
  g.beginPath();
  g.arc(x, y, r * Math.max(0.05, k), 0, Math.PI * 2);
  g.fill();
}

/** Камень камнепада: тень растёт, камень падает сверху. */
registerZonePainter('f1_rock', (g, z, px, py, scale, time) => {
  const st = z as Strike;
  const k = Math.min(1, st.t / st.warn);
  ringMark(g, px, py, st.r * scale, k, '255,200,120');
  // Сам камень — в воздухе над меткой, ниже с каждым кадром.
  const h = (1 - k * k) * 70;
  const img = cachedSprite(`fallrock|${Math.floor(time * 8) % 2}`, () => {
    const p = new Px(9, 8);
    p.ell(4.5, 4, 3.8, 3.2, hex('#6a6258'));
    p.ell(3.5, 3, 1.6, 1.2, hex('#9a9084'));
    p.set(6, 5, hex('#3e3a34'));
    p.outline(INK);
    return { img: p.canvas(), ax: 4.5, ay: 8 };
  });
  g.globalAlpha = Math.min(1, k * 2);
  g.drawImage(img.img, Math.round(px - img.ax), Math.round(py - img.ay - h));
  g.globalAlpha = 1;
  return true;
});

/** Круг колдовства шамана: сходящиеся руны цвета чары. */
function castPainter(rgb: string): Parameters<typeof registerZonePainter>[1] {
  return (g, z, px, py, scale, time) => {
    const zz = z as Zone;
    const k = Math.min(1, zz.t / Math.max(0.1, zz.life));
    const R = zz.r * scale;
    g.strokeStyle = `rgba(${rgb},${0.25 + 0.4 * k})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(px, py, R, 0, Math.PI * 2);
    g.stroke();
    // Внутреннее кольцо стягивается к шаману.
    g.strokeStyle = `rgba(${rgb},${0.5 + 0.4 * k})`;
    g.beginPath();
    g.arc(px, py, R * (1 - k * 0.85), 0, Math.PI * 2);
    g.stroke();
    // Руны по кругу — квадратики, вращаются.
    g.fillStyle = `rgba(${rgb},${0.6 + 0.4 * k})`;
    for (let i = 0; i < 8; i++) {
      const a = time * 1.6 + (i / 8) * Math.PI * 2;
      g.fillRect(
        Math.round(px + Math.cos(a) * R) - 1,
        Math.round(py + Math.sin(a) * R * 0.9) - 1,
        2,
        2,
      );
    }
    return true;
  };
}

registerZonePainter('f1_cast_heal', castPainter('140,255,110'));
registerZonePainter('f1_cast_haste', castPainter('255,225,110'));
registerZonePainter('f1_cast_rage', castPainter('255,90,60'));

/** Захлопнутый капкан на полу. */
registerZonePainter('f1_trap_shut', (g, _z, px, py) => {
  const sp = trapSprite(true, 0);
  g.drawImage(sp.img, Math.round(px - 8), Math.round(py - 8));
  return true;
});

/** Порванная растяжка: обрывки у колышков. */
registerZonePainter('f1_wire_cut', (g, _z, px, py) => {
  const sp = cachedSprite('wirecut', () => {
    const p = new Px(16, 16);
    p.line(0, 9, 4, 11, hex('#b8a888'));
    p.line(15, 8, 11, 12, hex('#b8a888'));
    return { img: p.canvas(), ax: 8, ay: 8 };
  });
  g.drawImage(sp.img, Math.round(px - 8), Math.round(py - 8));
  return true;
});

registerZonePainter('f1_rattle_cut', (g, _z, px, py) => {
  const sp = cachedSprite('rattlecut', () => {
    const p = new Px(16, 16);
    p.line(0, 9, 5, 12, hex('#8a7a5a'));
    p.ell(9, 12, 1.6, 1.2, BONE[1]);
    p.rect(12, 11, 13, 13, METAL.rust[1]);
    return { img: p.canvas(), ax: 8, ay: 8 };
  });
  g.drawImage(sp.img, Math.round(px - 8), Math.round(py - 8));
  return true;
});

// ---------------------------------------------------------------------------
// Предметы этажа: капкан, растяжка, гремушка, факел, тотем, трон, хлам.
// ---------------------------------------------------------------------------

/** Капкан: дуги челюстей с зубьями на пружине, цепь к колышку. */
function trapSprite(shut: boolean, glint: number): Sprite {
  return cachedSprite(`trap|${shut ? 1 : 0}|${glint}`, () => {
    const p = new Px(16, 16);
    const st = METAL.rust;
    // Цепь к колышку.
    for (let x = 1; x < 5; x++) p.set(x, 12 + (x % 2), METAL.iron[1]);
    p.rect(0, 11, 1, 13, WOOD[1]);
    if (shut) {
      // Челюсти сомкнуты: одна полоса с зубьями вверх и вниз.
      p.rect(4, 9, 12, 10, st[1]);
      p.rect(4, 9, 12, 9, st[2]);
      for (let x = 5; x < 12; x += 2) {
        p.set(x, 8, st[3]);
        p.set(x + 1, 11, st[3]);
      }
    } else {
      // Раскрыт: две полукруглые челюсти с зубьями, тарелка посередине.
      p.ell(8, 10, 5.6, 3.2, st[1]);
      p.ell(8, 10, 4.4, 2.2, hex('#2a1e18'));
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        p.set(Math.round(8 + Math.cos(a) * 4.6), Math.round(10 + Math.sin(a) * 2.6), st[3]);
      }
      p.rect(6, 9, 10, 11, METAL.iron[1]);
      p.rect(6, 9, 10, 9, METAL.iron[2]);
      if (glint) {
        p.set(4, 8, WHITE);
        p.set(5, 8, [255, 255, 255, 200]);
        p.set(12, 12, [255, 255, 255, 180]);
      }
    }
    p.outline([21, 15, 11, 200]);
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
}

registerPropPainter('f1_trap', (o, time) => {
  // Раз в пару секунд по челюстям пробегает блик — видно, если смотреть.
  const g = Math.floor(time * 1.6 + o.x * 0.7 + o.y * 0.3) % 2 === 0 ? 1 : 0;
  return trapSprite(false, g);
});

registerPropPainter('f1_wire', (o, time) => {
  const g = Math.floor(time * 2 + o.x * 0.5) % 5 === 0 ? 1 : 0;
  return cachedSprite(`wire|${g}`, () => {
    const p = new Px(16, 16);
    // Натянутая бечёвка у самого пола, с провисом; колышек по краю клетки.
    for (let x = 0; x < 16; x++) {
      const y = 10 + Math.round(Math.sin((x / 15) * Math.PI) * 0.8);
      p.set(x, y, g && x % 5 === 2 ? WHITE : hex('#c8b890'));
    }
    p.rect(0, 9, 0, 12, WOOD[2]);
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

registerPropPainter('f1_rattle', (o, time) => {
  const f = Math.floor(time * 3 + o.x) % 2;
  return cachedSprite(`rattle|${f}`, () => {
    const p = new Px(16, 16);
    for (let x = 0; x < 16; x++) p.set(x, 9, hex('#a89870'));
    // Консервные банки и кости на бечёвке — покачиваются.
    const hang = (x: number, kind: number) => {
      const dx = f ? 1 : 0;
      p.line(x, 9, x + dx, 11, hex('#8a7a5a'));
      if (kind === 0) {
        p.rect(x - 1 + dx, 11, x + 1 + dx, 13, METAL.rust[1]);
        p.set(x - 1 + dx, 11, METAL.rust[3]);
      } else p.ell(x + dx, 12, 1.2, 1.6, BONE[1]);
    };
    hang(3, 0);
    hang(8, 1);
    hang(13, 0);
    p.outline([21, 15, 11, 160]);
    return { img: p.canvas(), ax: 8, ay: 16 };
  });
});

registerPropPainter('f1_torch', (_o, time) => {
  const f = Math.floor(time * 10) % 4;
  return cachedSprite(`torch|${f}`, () => {
    const p = new Px(12, 24);
    // Треножник из жердей, чаша с огнём.
    p.line(2, 23, 6, 12, WOOD[0]);
    p.line(10, 23, 6, 12, WOOD[0]);
    p.line(6, 23, 6, 12, WOOD[1]);
    p.rect(3, 10, 9, 12, METAL.iron[1]);
    p.rect(3, 10, 9, 10, METAL.iron[2]);
    const flame = [hex('#ff6a1a'), hex('#ffb040'), hex('#fff0a0')];
    const hgt = [7, 8, 6, 8][f];
    for (let y = 0; y < hgt; y++) {
      const w = Math.max(0, Math.round((hgt - y) * 0.5 - (y === 0 ? 1 : 0)));
      const sway = f % 2 === 0 ? 0 : y > hgt / 2 ? 1 : 0;
      for (let x = -w; x <= w; x++) {
        const c = Math.abs(x) >= w ? flame[0] : Math.abs(x) >= w - 1 ? flame[1] : flame[2];
        p.set(6 + x + sway, 9 - y, c);
      }
    }
    return { img: p.canvas(), ax: 6, ay: 22 };
  });
});

registerPropPainter('f1_totem', (_o, time) => {
  const f = Math.floor(time * 4) % 3;
  return cachedSprite(`totem|${f}`, () => {
    const p = new Px(14, 28);
    // Жердь, на ней крысиный череп, ниже — связки хвостов и перья.
    p.rect(6, 8, 7, 27, WOOD[1]);
    p.rect(6, 8, 6, 27, WOOD[2]);
    p.ell(7, 6, 4, 3.4, BONE[1]);
    p.ell(6, 5, 2.4, 1.8, BONE[2]);
    p.rect(9, 6, 12, 8, BONE[1]);
    p.set(5, 6, hex('#1a1410'));
    p.set(8, 6, hex('#1a1410'));
    // Глаза черепа тлеют зелёным.
    const glow = [GREEN[1], GREEN[2], GREEN[3]][f];
    p.set(5, 6, glow);
    p.set(8, 6, glow);
    for (const [x, y, c] of [
      [4, 12, FUR.ratman.pink],
      [9, 13, FUR.ratman.pinkDark],
      [3, 15, FUR.ratman.pink],
    ] as [number, number, RGBA][])
      p.line(x, y, x + (x < 6 ? 2 : -2), y + 5, c);
    p.line(8, 10, 12, 16, hex('#7a3a2a'));
    p.outline(INK);
    return { img: p.canvas(), ax: 7, ay: 26 };
  });
});

registerPropPainter('f1_throne', () =>
  cachedSprite('throne', () => {
    const p = new Px(36, 40);
    // Трон из хлама: спинка из досок и рельса, подлокотники-бочки, черепа.
    p.rect(8, 4, 27, 30, WOOD[0]);
    for (let x = 9; x < 27; x += 3) p.rect(x, 5, x + 1, 29, WOOD[1]);
    p.rect(6, 2, 29, 4, METAL.iron[1]);
    p.rect(6, 2, 29, 2, METAL.iron[2]);
    // Зубцы спинки — как у короны.
    for (const x of [7, 13, 19, 25]) {
      p.rect(x, 0, x + 2, 2, METAL.gold[1]);
      p.set(x + 1, 0, METAL.gold[3]);
    }
    // Сиденье и подлокотники.
    p.rect(4, 26, 31, 33, WOOD[1]);
    p.rect(4, 26, 31, 27, WOOD[2]);
    p.ell(5, 25, 4, 5, METAL.rust[1]);
    p.ell(30, 25, 4, 5, METAL.rust[1]);
    p.ell(4, 23, 2, 2, METAL.rust[3]);
    p.ell(29, 23, 2, 2, METAL.rust[3]);
    // Черепа на спинке и красная тряпка.
    for (const x of [12, 23]) {
      p.ell(x, 12, 2.6, 2.2, BONE[1]);
      p.set(x - 1, 12, hex('#1a1410'));
      p.set(x + 1, 12, hex('#1a1410'));
    }
    p.rect(14, 16, 21, 26, CLOTH.cape[1]);
    p.rect(14, 16, 21, 17, CLOTH.cape[2]);
    p.rect(4, 34, 31, 38, WOOD[0]);
    p.outline(INK);
    return { img: p.canvas(), ax: 18, ay: 38 };
  }),
);

registerPropPainter('f1_junk', (_o, _t, _alive, flash) =>
  cachedSprite(`junk|${flash ? 1 : 0}`, () => {
    let p = new Px(16, 14);
    // Куча: доски, кастрюля, кости, тряпка.
    p.ell(8, 10, 7, 3.6, WOOD[0]);
    p.line(2, 9, 12, 5, WOOD[2]);
    p.line(3, 11, 14, 8, WOOD[1]);
    p.ell(10, 6, 2.6, 2, METAL.rust[1]);
    p.set(9, 5, METAL.rust[3]);
    p.ell(5, 8, 1.6, 1, BONE[1]);
    p.rect(11, 10, 14, 12, CLOTH.rag[1]);
    p.outline(INK);
    if (flash) p = p.tint(WHITE, 0.8);
    return { img: p.canvas(), ax: 8, ay: 14 };
  }),
);

// ---------------------------------------------------------------------------
// Свои клетки нор: кости, нечистоты, подстилка, зарубки, Зал черепов.
// ---------------------------------------------------------------------------

const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

function bonesCell(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const h = hash(c.wx, c.wy, 3);
  const lit = hex('#aea48c');
  const mid = hex('#8a8170');
  const dark = hex('#5a5244');
  const shade: RGBA = [0, 0, 0, 80];
  // Кость лежит наискось: стержень, на концах — по две шишки, под ней тень.
  const bone = (x: number, y: number, len: number, dir: number) => {
    const dx = dir === 0 ? 1 : dir === 1 ? 1 : 0;
    const dy = dir === 0 ? 0 : 1;
    for (let i = 0; i <= len; i++) {
      p.set(x + dx * i, y + dy * i + 1, shade);
      p.set(x + dx * i, y + dy * i, i === 0 || i === len ? lit : mid);
    }
    // Шишки поперёк стержня.
    const ex = x + dx * len;
    const ey = y + dy * len;
    const nx = dy;
    const ny = -dx;
    p.set(x - nx, y - ny, lit);
    p.set(ex - nx, ey - ny, lit);
    p.set(x + nx, y + ny, dark);
    p.set(ex + nx, ey + ny, dark);
  };
  bone(3 + (h % 6), 4 + ((h >> 3) % 5), 3 + ((h >> 6) % 2), (h >> 8) % 3);
  if ((h >> 10) % 2 === 0)
    bone(8 + ((h >> 11) % 4), 9 + ((h >> 13) % 3), 2 + ((h >> 15) % 2), (h >> 17) % 3);
  if ((h >> 19) % 4 === 0) {
    // Крысиный череп: вытянутый, с тёмной глазницей.
    const x = 4 + ((h >> 21) % 7);
    p.rect(x - 1, 13, x + 3, 13, shade);
    p.rect(x - 1, 11, x + 1, 12, mid);
    p.rect(x + 2, 12, x + 3, 12, mid);
    p.set(x - 1, 11, lit);
    p.set(x, 11, lit);
    p.set(x + 1, 12, hex('#241a14'));
  }
  return p;
}

function filthCell(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const deep = hex('#2a2e14');
  const mid = hex('#3e4420');
  const scum = hex('#5a6230');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      // Края к сухим соседям — рваные.
      const edge =
        (y < 2 && c.markAt(0, -1) !== F1_MARK.filth) ||
        (y > 13 && c.markAt(0, 1) !== F1_MARK.filth) ||
        (x < 2 && c.markAt(-1, 0) !== F1_MARK.filth) ||
        (x > 13 && c.markAt(1, 0) !== F1_MARK.filth);
      const n = hash(c.wx * 16 + x, c.wy * 16 + y) % 11;
      if (edge && n < 5) continue;
      p.set(x, y, n < 2 ? scum : n < 6 ? mid : deep);
    }
  // Пузыри и плёнка.
  const h = hash(c.wx, c.wy, 9);
  p.set(3 + (h % 9), 4 + ((h >> 4) % 8), hex('#8a9448'));
  p.set(8 + ((h >> 8) % 6), 9 + ((h >> 12) % 5), hex('#7a8440'));
  return p;
}

function strawCell(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const cols = [hex('#b89448'), hex('#d8b460'), hex('#8a6a34'), hex('#6a5a44')];
  // Подстилка гнезда: соломины и клочья тряпья, гуще к середине клетки.
  for (let i = 0; i < 18; i++) {
    const r = hash(c.wx, c.wy, 20 + i);
    const x = 1 + (r % 14);
    const y = 1 + ((r >> 4) % 14);
    const len = 2 + ((r >> 8) % 3);
    const dir = (r >> 11) % 3;
    const col = cols[(r >> 13) % cols.length];
    for (let k = 0; k < len; k++)
      p.set(x + (dir === 0 ? k : dir === 1 ? k : -k), y + (dir === 0 ? 0 : k >> 1), col);
  }
  const r = hash(c.wx, c.wy, 90);
  if (r % 3 === 0)
    p.rect(4 + (r % 7), 6 + ((r >> 3) % 6), 6 + (r % 7), 7 + ((r >> 3) % 6), hex('#5a4a38'));
  return p;
}

/** Черта круга черепов: бурая, тянется к соседям-чертам. */
function ringLineCell(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const col: RGBA = [124, 34, 24, 220];
  const col2: RGBA = [160, 60, 40, 180];
  let any = false;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as V[]) {
    if (c.markAt(dx, dy) !== F1_MARK.ringLine) continue;
    any = true;
    p.line(8, 8, 8 + dx * 8, 8 + dy * 8, col);
    p.line(8, 9, 8 + dx * 8, 9 + dy * 8, col2);
  }
  if (!any) p.ell(8, 8, 2, 2, col);
  // Коготь-знак на каждой третьей клетке.
  if (hash(c.wx, c.wy, 7) % 3 === 0) {
    p.line(5, 3, 7, 6, col);
    p.line(8, 2, 9, 6, col);
    p.line(11, 3, 10, 6, col);
  }
  return p;
}

/** Ковёр к трону: вытертый бордо, золотая кромка у краёв. */
function carpetCell(c: CellCtx): Px {
  const p = new Px(TS, TS);
  const base = hex('#4a1a1e');
  const light = hex('#5e2628');
  const worn = hex('#3a2a24');
  const gold = hex('#8a6a2a');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = hash(c.wx * 16 + x, c.wy * 16 + y) % 13;
      p.set(x, y, n === 0 ? worn : (x + y * 3) % 8 === 0 ? light : base);
    }
  const left = c.markAt(-1, 0) !== F1_MARK.carpet;
  const right = c.markAt(1, 0) !== F1_MARK.carpet;
  if (left) {
    p.rect(0, 0, 0, 15, [0, 0, 0, 0]);
    p.rect(1, 0, 1, 15, gold);
  }
  if (right) {
    p.rect(15, 0, 15, 15, [0, 0, 0, 0]);
    p.rect(14, 0, 14, 15, gold);
  }
  // Бахрома рвётся: дыры по краю.
  const h = hash(c.wx, c.wy, 31);
  if (left && h % 3 === 0) p.rect(0, 4 + (h % 8), 2, 6 + (h % 8), [0, 0, 0, 0]);
  if (right && (h >> 4) % 3 === 0)
    p.rect(13, 3 + ((h >> 5) % 9), 15, 5 + ((h >> 5) % 9), [0, 0, 0, 0]);
  return p;
}

/** Знамя на стене тронного зала: бордовое полотнище с крысиным черепом. */
function bannerCell(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const p = new Px(TS, TS);
  p.rect(2, 1, 13, 1, METAL.iron[2]);
  for (let y = 2; y < 15; y++) {
    const w = y > 11 ? 5 - (y - 11) : 5;
    for (let x = 8 - w; x <= 7 + w; x++)
      p.set(x, y, x < 5 ? CLOTH.cape[2] : (x + y) % 6 === 0 ? CLOTH.cape[0] : CLOTH.cape[1]);
  }
  // Рваный низ.
  p.set(4, 14, [0, 0, 0, 0]);
  p.set(11, 13, [0, 0, 0, 0]);
  // Череп: белое пятно с глазницами и резцами.
  p.rect(6, 5, 9, 8, BONE[1]);
  p.rect(7, 9, 8, 9, BONE[1]);
  p.set(6, 6, hex('#1a1410'));
  p.set(9, 6, hex('#1a1410'));
  p.set(7, 10, BONE[2]);
  p.set(8, 10, BONE[2]);
  p.rect(3, 3, 12, 3, METAL.gold[1]);
  void c;
  return p;
}

function scratchCell(c: CellCtx): Px | null {
  if (!c.open(0, 1)) return null;
  const p = new Px(TS, TS);
  const cut = hex('#1e1612');
  const lit = hex('#8a7a6a');
  // Зарубки счёта: пучок по четыре и перечёркивание.
  const x0 = 3 + (hash(c.wx, c.wy) % 3);
  for (let k = 0; k < 4; k++) {
    p.line(x0 + k * 2, 5, x0 + k * 2, 11, cut);
    p.set(x0 + k * 2 + 1, 5, lit);
  }
  p.line(x0 - 1, 10, x0 + 7, 6, cut);
  return p;
}

function ringCell(c: CellCtx): Px {
  const p = new Px(TS, TS);
  // Круг черепов: тёмный пол с нацарапанной спиралью и бурыми пятнами.
  const h = hash(c.wx, c.wy, 13);
  for (let i = 0; i < 6; i++) {
    const r = hash(c.wx, c.wy, 40 + i);
    p.set(r % 16, (r >> 4) % 16, [70, 26, 20, 150]);
  }
  if (h % 3 === 0) p.line(2, 8, 13, 9, [30, 20, 16, 200]);
  return p;
}

function heartCell(): Px {
  const p = new Px(TS, TS);
  // Сердце зала: знак норы — круг с тремя когтями.
  p.ell(8, 8, 6, 6, [60, 18, 14, 200]);
  p.ell(8, 8, 4.4, 4.4, [0, 0, 0, 0]);
  for (let a = 0; a < 3; a++) {
    const ang = -Math.PI / 2 + (a - 1) * 0.5;
    p.line(
      8,
      8,
      Math.round(8 + Math.cos(ang) * 5),
      Math.round(8 + Math.sin(ang) * 5),
      [120, 30, 20, 230],
    );
  }
  return p;
}

function mouthCell(): Px {
  const p = new Px(TS, TS);
  // Устье зала: трещины в своде видны на полу — сюда рухнет завал.
  p.line(1, 3, 7, 7, [20, 14, 10, 200]);
  p.line(7, 7, 14, 5, [20, 14, 10, 200]);
  p.line(7, 7, 9, 13, [20, 14, 10, 200]);
  for (const [x, y] of [
    [3, 11],
    [12, 10],
    [10, 2],
  ])
    p.set(x, y, [120, 100, 80, 220]);
  return p;
}

/**
 * Пол под костями и подстилкой в пещерах Входа. Движок выбирает вид пола
 * клетки с маркой по большинству четырёх соседей, и в куче подстилки
 * (соседи — тоже марки) пещерный грунт сменялся плитами: посреди крысятника
 * проступала сетка кирпичного пола (круг 3 самокритики). Здесь вид пола
 * берётся по окрестности 7×7 карты района, и под кучей в пещере ложится
 * грунт — тот же, что у движка, и той же перекраской района.
 */
let caveMarks: Set<number> | null = null;
function caveMark(wx: number, wy: number): boolean {
  if (!caveMarks) {
    caveMarks = new Set();
    // Районы в мире сверху вниз в обратном порядке: Вход — под штреками.
    const top = MAP_HAUL.length;
    const at = (x: number, y: number) => MAP_MOUTH[y]?.[x] ?? '#';
    for (let y = 0; y < MAP_MOUTH.length; y++)
      for (let x = 0; x < MAP_MOUTH[y].length; x++) {
        const ch = at(x, y);
        if (!'khtHqwjg'.includes(ch)) continue;
        let a = 0;
        let n = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const o = at(x + dx, y + dy);
            if (o === ',') a++;
            if (o === ',' || o === '.') n++;
          }
        if (n && a * 2 > n) caveMarks.add((top + y) * 64 + x);
      }
  }
  return caveMarks.has(wy * 64 + wx);
}

/** Грунт пещеры под клеткой (с перекраской района) и поверх — `top`. */
function onCave(c: CellCtx, top: Px | null): Px | null {
  // Под костями и подстилкой мелочь грунта не нужна; под предметом — как у движка.
  const base = floorCell(
    'mouth',
    c.wx,
    c.wy,
    !c.open(0, -1),
    !c.open(-1, 0),
    !c.open(1, 0),
    'ground',
    !!top,
  );
  if (!base) return top;
  const tint = F1.areas.find((a) => a.id === 'mouth')?.skin.tint;
  if (tint) {
    const [mr, mg, mb] = tint.mul;
    const k = tint.k ?? 0;
    const v = tint.mix ? parseInt(tint.mix.slice(1), 16) : 0;
    const d = base.data;
    for (let o = 0; o < d.length; o += 4) {
      if (!d[o + 3]) continue;
      d[o] = d[o] * mr * (1 - k) + ((v >> 16) & 255) * k;
      d[o + 1] = d[o + 1] * mg * (1 - k) + ((v >> 8) & 255) * k;
      d[o + 2] = d[o + 2] * mb * (1 - k) + (v & 255) * k;
    }
  }
  if (top) blit(base, top, 0, 0);
  return base;
}

function f1Cells(c: CellCtx, area: string): Px | null {
  const low = c.mark === F1_MARK.bones || c.mark === F1_MARK.straw || c.mark === F1_MARK.bare;
  if (low && area === 'mouth' && caveMark(c.wx, c.wy))
    return onCave(
      c,
      c.mark === F1_MARK.bones ? bonesCell(c) : c.mark === F1_MARK.straw ? strawCell(c) : null,
    );
  switch (c.mark) {
    case F1_MARK.bones:
      return bonesCell(c);
    case F1_MARK.filth:
      return filthCell(c);
    case F1_MARK.straw:
      return strawCell(c);
    case F1_MARK.scratch:
      return scratchCell(c);
    case F1_MARK.ring:
      return ringCell(c);
    case F1_MARK.ringLine:
      return ringLineCell(c);
    case F1_MARK.carpet:
      return carpetCell(c);
    case F1_MARK.banner:
      return bannerCell(c);
    case F1_MARK.heart:
      return heartCell();
    case F1_MARK.mouth:
      return mouthCell();
  }
  return null;
}

registerCellPainter('mouth', (c) => f1Cells(c, 'mouth'));
registerCellPainter('haul', (c) => f1Cells(c, 'haul'));

// ---------------------------------------------------------------------------
// Иконки материалов (10×10).
// ---------------------------------------------------------------------------

registerItemArt('f1_shiv', () => {
  const p = new Px(10, 10);
  p.line(2, 8, 4, 6, WOOD[1]);
  p.line(4, 6, 8, 2, METAL.steel[1]);
  p.line(5, 6, 8, 3, METAL.steel[3]);
  p.set(3, 5, METAL.steel[0]);
  p.set(5, 7, METAL.steel[0]);
  p.outline(INK);
  return p;
});

registerItemArt('f1_strap', () => {
  const p = new Px(10, 10);
  for (let x = 1; x < 9; x++) p.set(x, 3 + Math.round(Math.sin(x * 0.8) * 1.4), hex('#7a5a3a'));
  p.ell(6, 6.5, 2.4, 1.8, hex('#6a4a30'));
  p.set(5, 6, hex('#9a7a5a'));
  p.outline(INK);
  return p;
});

registerItemArt('f1_charm', () => {
  const p = new Px(10, 10);
  p.line(1, 1, 5, 4, hex('#8a7a5a'));
  p.line(8, 1, 5, 4, hex('#8a7a5a'));
  p.ell(5, 6, 2.6, 2.4, BONE[1]);
  p.set(4, 6, GREEN[2]);
  p.set(6, 6, GREEN[2]);
  p.set(5, 5, BONE[2]);
  p.outline(INK);
  return p;
});

registerItemArt('f1_scrap', () => {
  const p = new Px(10, 10);
  p.ell(5, 5, 3.6, 3.2, METAL.rust[1]);
  p.ell(4.5, 4.5, 1.6, 1.4, METAL.rust[3]);
  p.rect(6, 6, 8, 8, METAL.iron[2]);
  p.set(7, 7, METAL.iron[0]);
  p.outline(INK);
  return p;
});
