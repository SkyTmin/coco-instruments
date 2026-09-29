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
import { ratEye, ratPx, ratSize, RAT_FRAMES, spline } from '../dungeon-rats';
import type { RatAnim } from '../dungeon-rats';
import {
  registerCellPainter,
  registerItemArt,
  registerMobPainter,
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

// ---------------------------------------------------------------------------
// Крысиный король 2.0 и малые короли.
// ---------------------------------------------------------------------------

const KING: Body = { s: 2.05, bulk: 1.28, w: 84, h: 64 };

/** Узел хвостов с привязанными малыми королями (до раскола). */
function kingTails(r: Rig, s: number, f: number, tied: boolean): Item {
  const hip = r.hip;
  return {
    layer: 'back',
    draw: (px) => {
      const knot: V = add(hip, [-6 * s, 2.2 * s]);
      const sway = Math.sin((f / 4) * Math.PI * 2);
      const pink = FUR.king.pink;
      const pd = FUR.king.pinkDark;
      const tails: V[][] = [
        [add(hip, [-2 * s, 1 * s]), add(knot, [2.6 * s, -0.4 * s]), knot],
        [knot, add(knot, [-3 * s, -3 * s + sway]), add(knot, [-6.2 * s, -3.6 * s + sway * 1.4])],
        [knot, add(knot, [-4 * s, 0.8 * s - sway]), add(knot, [-8 * s, 1.4 * s - sway])],
        [knot, add(knot, [-2 * s, 2.6 * s]), add(knot, [-4.8 * s, 3.4 * s + sway * 0.6])],
      ];
      for (const t of tails) {
        const line = spline(t, 8);
        line.forEach(([x, y], i) => {
          px.set(x, y, i % 3 === 0 ? pd : pink);
          px.set(x, y + 1, pd);
        });
      }
      // Узел — клубок в косую полоску.
      px.ell(knot[0], knot[1], 2.4 * s * 0.6, 2 * s * 0.6, (x, y) =>
        (x + y) % 3 === 0 ? pd : (x - y) % 4 === 0 ? hex('#e8aaa2') : pink,
      );
      if (!tied) return;
      // На концах двух хвостов — привязанные малые короли: крысята в
      // венчиках, свернувшиеся клубком, — видно, кто оторвётся на половине.
      for (const [i, end] of [
        [0, tails[1][2]],
        [1, tails[2][2]],
      ] as [number, V][]) {
        const cx = end[0] - 1.8 * s;
        const cy = end[1] + (i ? 0.6 : -0.4) * s;
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
      }
    },
  };
}

/** Плащ короля: за спиной, до колен, с бахромой. */
function kingCape(r: Rig, s: number, f: number): Item {
  const neck = neckOf(r);
  const hip = r.hip;
  const sway = Math.sin((f / 4) * Math.PI * 2) * 0.8 * s;
  return {
    layer: 'back',
    draw: (px) => {
      // Плащ: от плеч назад и вниз до голеней, шире тела — виден за спиной.
      const pts: V[] = [
        add(neck, [-2.6 * s, -0.8 * s]),
        add(neck, [1.2 * s, 0.4 * s]),
        add(hip, [0.6 * s, 4.6 * s]),
        add(hip, [-4 * s + sway, 5.4 * s]),
        add(hip, [-7.4 * s + sway, 4.2 * s]),
      ];
      poly(px, pts, (x, y) => {
        const d = (x - pts[0][0]) * 0.35 + (y - pts[0][1]) * 0.08;
        if ((x * 3 + y) % 11 === 0) return CLOTH.cape[0];
        return d < -1 ? CLOTH.cape[2] : d < 2 ? CLOTH.cape[1] : CLOTH.cape[0];
      });
      // Золотая кайма по низу.
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

interface KingLook {
  blade: boolean;
  split: boolean;
  /** Номер взмаха двуручника: чётный — из-за спины, нечётный — снизу. */
  swing: number;
}

function kingRig(want: Want, look: KingLook): Rig {
  const b = KING;
  const { s } = b;
  const mode = want.mode;
  const t = want.t;
  let anim = want.anim;
  // Свои позы короля.
  if (mode === 'cleaveAim' || mode === 'leapAim' || mode === 'rollAim') anim = 'wind';
  if (mode === 'sweepAim') anim = 'wind';
  if (mode === 'recover' && t < 0.4) anim = 'bite';
  if (mode === 'roar' || mode === 'summon' || mode === 'swap') anim = 'idle';
  if (mode === 'whipAim') anim = 'idle';
  if (mode === 'dizzy') anim = 'hurt';
  const f = want.f;
  const r = anim === 'dead' ? deadPose(b) : basePose(b, anim, f);
  r.cloth = null;
  // Толстое брюхо и короткая шея — король.
  r.ry = 5.2 * s;
  const neck = neckOf(r);
  const sh = add(neck, [-0.6 * s, 1.2 * s]);
  if (mode === 'roar' || mode === 'summon') {
    // Рык: голова задрана, лапы в стороны, пасть нараспашку.
    r.head = add(neck, [1.2 * s, -2.6 * s]);
    r.jaw = 1;
    r.armNear = [sh, add(sh, [2.4 * s, -1 * s]), add(sh, [4 * s, -3 * s])];
    r.armFar = [sh, add(sh, [-2 * s, -1 * s]), add(sh, [-3.4 * s, -3 * s])];
  }
  if (mode === 'rollAim') {
    // Сворачивается: пригнулся, голова к груди.
    r.hip = add(r.hip, [0, 1.6 * s]);
    r.lean = 1.05;
    const nk = neckOf(r);
    r.head = add(nk, [1.4 * s, 0.4 * s]);
    r.squint = true;
  }
  if (mode === 'whipAim') {
    // Хлыст: развернулся боком, хвосты взметнулись над головой.
    r.lean = -0.1;
    r.jaw = 0.5;
  }
  if (mode === 'leapAim') {
    r.hip = add(r.hip, [0, 2 * s]);
    r.lean = 0.8;
    const nk = neckOf(r);
    r.head = add(nk, [1.8 * s, -0.8 * s]);
  }
  if (mode === 'leap') {
    // В воздухе: лапы поджаты, двуручник над головой.
    r.legNear[1] = add(r.legNear[0], [3 * s, -1 * s]);
    r.legNear[2] = add(r.legNear[0], [1.4 * s, 2.6 * s]);
    r.legFar[1] = add(r.legFar[0], [2 * s, -0.6 * s]);
    r.legFar[2] = add(r.legFar[0], [0, 2.8 * s]);
  }
  const nk = neckOf(r);
  const shoulder = add(nk, [-0.6 * s, 1.2 * s]);
  // Руки под оружие.
  let weapon: Item | null = null;
  if (!look.blade) {
    // Тесак в ближней руке, крышка-баклер на дальней.
    let ang = 1.3;
    if (mode === 'cleaveAim') {
      const k = Math.min(1, t / 0.4);
      r.armNear = [
        shoulder,
        add(shoulder, [-1 * s, -2.2 * s]),
        add(shoulder, [(0.4 - k * 0.8) * s, -4.6 * s]),
      ];
      ang = -1.8 - k * 0.6;
    } else if (anim === 'bite') {
      r.armNear = [shoulder, add(shoulder, [2.6 * s, 0.6 * s]), add(shoulder, [5.4 * s, 2.4 * s])];
      ang = 0.9;
    } else if (mode === 'swap') {
      // Бросает тесак: рука отведена назад.
      r.armNear = [shoulder, add(shoulder, [-2 * s, -1 * s]), add(shoulder, [-3.6 * s, -2.4 * s])];
      ang = -2.6;
    }
    if (mode !== 'swap' || t < 0.5) {
      const hand = r.armNear[2];
      const a = ang;
      weapon = {
        layer: 'hand',
        draw: (px) =>
          blade(px, hand, a, { grip: 2.4, len: 9, w: 5, metal: METAL.steel, kind: 'cleaver' }),
      };
    }
    if (anim !== 'dead' && anim !== 'sleep' && mode !== 'rollAim') {
      const lc: V = add(r.armFar[2], [0.6 * s, 0]);
      r.items.push({ layer: 'back', draw: (px) => lid(px, lc, 2.8 * s, 3.4 * s, METAL.iron) });
    }
  } else {
    // Рельс-двуручник обеими руками.
    let ang = -0.9;
    let grip: V = add(shoulder, [2.6 * s, 3 * s]);
    const swing = look.swing % 2;
    if (mode === 'sweepAim') {
      // Чётный взмах — клинок за спиной, нечётный — низко впереди.
      if (swing === 0) {
        grip = add(shoulder, [-1.2 * s, -1.2 * s]);
        ang = -2.5;
      } else {
        grip = add(shoulder, [3.6 * s, 3.6 * s]);
        ang = 0.5;
      }
    } else if (anim === 'bite') {
      grip = add(shoulder, [5 * s, 1.6 * s]);
      ang = 0.15;
    } else if (mode === 'leapAim' || mode === 'leap') {
      grip = add(shoulder, [0.6 * s, -3.4 * s]);
      ang = -1.9;
    } else if (mode === 'swap') {
      // Выхватывает из-за спины: клинок поднят.
      grip = add(shoulder, [0.4 * s, -3 * s]);
      ang = -1.5 - Math.min(1, t) * 0.4;
    } else if (anim === 'run') {
      grip = add(shoulder, [2 * s, 2.4 * s]);
      ang = -0.6;
    }
    r.armNear = [shoulder, lerp(shoulder, grip, 0.5), grip];
    r.armFar = [
      add(shoulder, [-0.6 * s, 0]),
      lerp(shoulder, grip, 0.45),
      add(grip, [-0.6 * s, 0.6 * s]),
    ];
    const g = grip;
    const a = ang;
    weapon = {
      layer: 'hand',
      draw: (px) => blade(px, g, a, { grip: 3, len: 20, w: 3.4, metal: METAL.iron, kind: 'rail' }),
    };
  }
  if (anim !== 'dead') {
    r.items.push(kingCape(r, s, f));
    r.items.push(ermine(r, s));
    const hd = r.head;
    const R = r.headR;
    r.items.push({ layer: 'front', draw: (px) => crown(px, hd, R, true) });
  } else {
    // Корона скатилась с головы.
    const at: V = [r.head[0] + r.headR + 3, b.h - 4];
    r.items.push({ layer: 'front', draw: (px) => crown(px, [at[0], at[1] + 3], r.headR, false) });
  }
  if (anim !== 'dead') r.items.push(kingTails(r, s, f, !look.split));
  if (weapon) r.items.push(weapon);
  if (mode === 'whipAim') {
    // Хвосты взметнулись дугой над головой — кольцо удара вокруг.
    const hip = r.hip;
    const k = Math.min(1, t / 0.6);
    r.items.push({
      layer: 'back',
      draw: (px) => {
        for (let i = 0; i < 3; i++) {
          const a0 = Math.PI * (0.9 + i * 0.25) - k * 0.8;
          const pts: V[] = [add(hip, [-2 * s, 0])];
          for (let j = 1; j <= 4; j++) {
            const a = a0 - j * 0.35 * k;
            pts.push(add(hip, [Math.cos(a) * j * 3 * s, Math.sin(a) * j * 2.6 * s - j * 1.4 * s]));
          }
          spline(pts, 6).forEach(([x, y]) => {
            px.set(x, y, FUR.king.pink);
            px.set(x, y + 1, FUR.king.pinkDark);
          });
        }
      },
    });
  }
  if (mode === 'dizzy') {
    const hd = r.head;
    r.items.push({
      layer: 'hand',
      draw: (px) => {
        for (let k = 0; k < 4; k++) {
          const a = t * 6 + k * 1.57;
          px.set(
            Math.round(hd[0] + Math.cos(a) * 6),
            Math.round(hd[1] - 9 + Math.sin(a) * 2),
            hex('#ffe060'),
          );
          px.set(
            Math.round(hd[0] + Math.cos(a) * 6) + 1,
            Math.round(hd[1] - 9 + Math.sin(a) * 2),
            hex('#fff4b0'),
          );
        }
      },
    });
  }
  return r;
}

/** Клубок короля при перекате: 4 кадра поворота на четверть. */
function kingBall(frame: number, look: KingLook): Px {
  const S = 36;
  const px = new Px(S, S);
  const c: V = [S / 2, S / 2];
  const f = FUR.king;
  oval(px, c, 13, 12, 0, (k) => tone(f, k));
  // Спираль хвоста поверх клубка и корона сбоку — видно вращение.
  const a0 = (frame % 4) * (Math.PI / 2);
  for (let i = 0; i < 40; i++) {
    const a = a0 + i * 0.28;
    const rr = 3 + i * 0.22;
    px.set(
      Math.round(c[0] + Math.cos(a) * rr),
      Math.round(c[1] + Math.sin(a) * rr),
      i % 4 === 0 ? f.pinkDark : f.pink,
    );
  }
  const ca = a0 + Math.PI * 0.25;
  const cp: V = [c[0] + Math.cos(ca) * 10, c[1] + Math.sin(ca) * 10];
  px.ell(cp[0], cp[1], 2.4, 2.4, METAL.gold[2]);
  px.set(Math.round(cp[0]), Math.round(cp[1]), hex('#d8203a'));
  if (!look.split) {
    // Малые на хвостах катятся следом — тёмные бугры по краю.
    for (const k of [2.2, 3.6]) {
      const a = a0 + k;
      px.ell(c[0] + Math.cos(a) * 12, c[1] + Math.sin(a) * 12, 3, 2.4, f.dark);
    }
  }
  return px;
}

registerMobPainter('f1_king', (m, pose) => {
  const small = m.kind === 'kinglet';
  const look: KingLook = {
    blade: !!m.data?.f1blade,
    split: !!m.data?.f1split,
    swing: m.mode === 'sweepAim' ? (m.data?.swing ?? 0) : 0,
  };
  if (small) {
    // Малые короли — прежние крысы-короли (на четырёх лапах), перекат — клубок.
    if (pose.mode === 'roll') {
      const fr = Math.floor(pose.t * 14) % 4;
      const key = `kinglet-roll|${fr}|${pose.flash ? 1 : 0}`;
      const hit = frames.get(key);
      if (hit) return hit;
      let px = kingBall(fr, { blade: false, split: true, swing: 0 });
      const small2 = new Px(24, 24);
      for (let y = 0; y < 24; y++)
        for (let x = 0; x < 24; x++)
          small2.set(x, y, px.get(Math.floor(x * 1.5), Math.floor(y * 1.5)));
      px = small2;
      px.outline(INK);
      if (pose.flash) px = px.tint(WHITE, 0.9);
      const out = { img: px.canvas(), ax: 12, ay: 22, eye: null };
      frames.set(key, out);
      return out;
    }
    const anim = pose.anim as RatAnim;
    const n = RAT_FRAMES[anim] ?? 1;
    const f = ((Math.floor(pose.frame) % n) + n) % n;
    const key = `kinglet|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}`;
    const hit = frames.get(key);
    if (hit) return hit;
    const size = ratSize('kinglet');
    const px = ratPx('kinglet', 'normal', anim, f, pose.left, pose.flash);
    const [ex, ey] = ratEye('kinglet', anim === 'dead' ? 'idle' : anim, f);
    const out: MobFrame = {
      img: px.canvas(),
      ax: pose.left ? size.w - size.body : size.body,
      ay: size.h - 2,
      eye: [pose.left ? size.w - 1 - ex : ex, ey],
    };
    frames.set(key, out);
    return out;
  }
  if (pose.mode === 'roll') {
    const fr = Math.floor(pose.t * 14) % 4;
    const key = `king-roll|${fr}|${look.split ? 1 : 0}|${pose.flash ? 1 : 0}`;
    const hit = frames.get(key);
    if (hit) return hit;
    let px = kingBall(fr, look);
    px.outline(INK);
    if (pose.flash) px = px.tint(WHITE, 0.9);
    const out = { img: px.canvas(), ax: 18, ay: 33, eye: null };
    frames.set(key, out);
    return out;
  }
  const lookKey = `${look.blade ? 1 : 0}${look.split ? 1 : 0}${look.swing % 2}`;
  const fr = bipedFrame(
    'king',
    KING,
    (w) => kingRig(w, look),
    FUR.king,
    m,
    pose,
    () => lookKey,
  );
  if (pose.mode !== 'leap') return fr;
  // В прыжке — кадр выше земли (тень остаётся на полу).
  const lift = Math.round(Math.sin(Math.min(1, pose.t / 0.5) * Math.PI) * 20);
  return { ...fr, ay: fr.ay + lift, eye: fr.eye ? [fr.eye[0], fr.eye[1]] : null };
});

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
