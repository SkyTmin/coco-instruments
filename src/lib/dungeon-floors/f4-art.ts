// Этаж 4 «Двойная крипта» — рисовальщики. Всё нарисовано кодом, в палитре
// камня 0x72 и трёх акцентах этажа: кость (тёплая белая), могильный огонь
// некроманта (кислотно-зелёный) и свет идола (янтарь → белое золото → алый).
// Всё смотрит ВПРАВО, влево — зеркало; кадры кешируются по всему, что меняет
// картинку (вид, поза, кадр, сторона, вспышка, облик).
//
// Монстры: костяк (скелет с ржавым мечом и погребальной тряпкой), кучка
// костей (кости сползаются по мере того, как копится подъём), латник (четыре
// стороны: щит всегда там, куда он смотрит — это и есть его правило),
// некромант (капюшон, посох с черепом и зелёным огнём, гримуар на поясе),
// статуя-страж (каменный воин с двуручным мечом; каждый раз, застывая,
// стоит в новой позе; глаза горят, только пока идёт), Каменный идол
// (сидящий колосс на троне, 60×66: улыбка, глаза-светильники, печать на
// груди — золото, когда уязвим).

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

type RGBA = [number, number, number, number];

const INK = hex('#150f0b');
const WHITE: RGBA = [255, 255, 255, 255];
/** Стереть пиксель: `Px.set` смешивает, и прозрачное поверх ничего не меняет. */
function erase(p: Px, x: number, y: number): void {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= p.w || iy >= p.h) return;
  p.data[(iy * p.w + ix) * 4 + 3] = 0;
}

const BONE = {
  hi: hex('#f4efe0'),
  mid: hex('#d8cfb8'),
  sh: hex('#a79d84'),
  dk: hex('#716853'),
  hole: hex('#1c1412'),
};
const RUST = { hi: hex('#c98a5a'), mid: hex('#8a4a2a'), dk: hex('#58301c') };
const IRON = {
  hi: hex('#d4d8dc'),
  mid: hex('#949aa0'),
  sh: hex('#646a70'),
  dk: hex('#3c4046'),
};
const RAG = { mid: hex('#4d5a46'), dk: hex('#2f382c'), hi: hex('#6a7862') };
const STONE = {
  hi: hex('#c6c8be'),
  mid: hex('#989b91'),
  sh: hex('#6d7069'),
  dk: hex('#474a46'),
  moss: hex('#62784c'),
  mossDk: hex('#44563a'),
};
const GOLD = { hi: hex('#fff2b0'), mid: hex('#dcb44c'), dk: hex('#8a6a20') };
const ROBE = {
  hi: hex('#6e5a7e'),
  mid: hex('#4a3856'),
  dk: hex('#2c2036'),
  deep: hex('#1a1220'),
};
const GREEN = { hi: hex('#e2ffd4'), mid: hex('#8cff7c'), dk: hex('#2eae4c') };
const TABARD = { hi: hex('#a8443a'), mid: hex('#7a2c2a'), dk: hex('#4a1a1a') };
const WOOD = { mid: hex('#6e4a2e'), dk: hex('#432a1a'), hi: hex('#94683e') };
const EYE_RED = hex('#ff3a28');
const EYE_AMBER = hex('#ffb040');

const cache = new Map<string, MobFrame>();
const sprites = new Map<string, Sprite>();

/** Холст из пикселей: зеркало, вспышка белым, облик. */
function finish(px: Px, left: boolean, flash: boolean, look: MobPose['look']): HTMLCanvasElement {
  let p = px;
  if (look === 'elite') {
    // Золотой кант вокруг контура — как у элиты атласа.
    const q = new Px(p.w, p.h);
    q.data.set(p.data);
    q.outline(hex('#ffcc40'));
    p = q;
  } else if (look === 'albino') p = p.tint(hex('#f4ece4'), 0.45);
  if (left) p = p.flipX();
  if (flash) p = p.tint(WHITE, 0.9);
  return p.canvas();
}

const mod = (n: number, k: number) => ((Math.floor(n) % k) + k) % k;

/** Кость: светлая сверху, тень снизу, шишки на концах. */
function bone(p: Px, x0: number, y0: number, x1: number, y1: number, knobs = true): void {
  p.line(x0, y0 + 0.4, x1, y1 + 0.4, BONE.sh);
  p.line(x0, y0, x1, y1, BONE.mid);
  if (knobs) {
    p.set(x0, y0, BONE.hi);
    p.set(x1, y1, BONE.hi);
  }
}

// ---------------------------------------------------------------------------
// Костяк.
// ---------------------------------------------------------------------------

interface SkelPose {
  /** Сдвиг всей фигуры (подскок, наклон). */
  bx: number;
  by: number;
  /** Голова: сдвиг черепа и открыта ли челюсть. */
  hx: number;
  hy: number;
  jaw: boolean;
  /** Ступни (задняя, передняя) и колени. */
  feet: [number, number][];
  knees: [number, number][];
  /** Руки: локоть и кисть — задняя, передняя. */
  elbows: [number, number][];
  hands: [number, number][];
  /** Меч в передней руке: угол (0 — вперёд, −π/2 — вверх). */
  sword: number;
}

const SK_W = 20;
const SK_H = 22;
const SK_CX = 9;
const SK_G = 21;

function skelPose(anim: string, f: number, t: number): SkelPose {
  const base: SkelPose = {
    bx: 0,
    by: 0,
    hx: 0,
    hy: 0,
    jaw: false,
    feet: [
      [SK_CX - 2, SK_G],
      [SK_CX + 2, SK_G],
    ],
    knees: [
      [SK_CX - 2, SK_G - 3],
      [SK_CX + 2, SK_G - 3],
    ],
    elbows: [
      [SK_CX - 3, 13],
      [SK_CX + 3, 13],
    ],
    hands: [
      [SK_CX - 3, 16],
      [SK_CX + 4, 15],
    ],
    sword: 0.5,
  };
  switch (anim) {
    case 'idle': {
      const bob = [0, 0, 1, 0][f];
      base.by = bob;
      base.jaw = f === 2;
      base.hands[1] = [SK_CX + 4, 15 + bob];
      base.sword = 0.7;
      break;
    }
    case 'run': {
      const s = [
        [-3, 3],
        [-1, 1],
        [3, -3],
        [1, -1],
      ][f];
      base.by = f % 2 === 1 ? -1 : 0;
      base.feet = [
        [SK_CX + s[0], SK_G],
        [SK_CX + s[1], SK_G],
      ];
      base.knees = [
        [SK_CX + s[0] * 0.5 - 0.5, SK_G - 3],
        [SK_CX + s[1] * 0.5 + 0.5, SK_G - 3],
      ];
      base.hands = [
        [SK_CX - 2 - s[1] * 0.4, 15],
        [SK_CX + 4 + s[0] * 0.3, 14],
      ];
      base.elbows = [
        [SK_CX - 3, 12],
        [SK_CX + 3, 12],
      ];
      base.sword = 0.3;
      base.jaw = f === 0;
      break;
    }
    case 'wind':
      // Меч занесён над головой, корпус откинут.
      base.bx = -1;
      base.hx = -1;
      base.elbows[1] = [SK_CX + 2, 8];
      base.hands[1] = [SK_CX + 1 + f, 5];
      base.sword = -1.9 + f * 0.25;
      base.jaw = true;
      break;
    case 'bite':
      // Рубит вниз-вперёд, выпад.
      base.bx = 1;
      base.hx = 1;
      base.feet[1] = [SK_CX + 4, SK_G];
      base.knees[1] = [SK_CX + 3, SK_G - 3];
      base.elbows[1] = [SK_CX + 5, 12];
      base.hands[1] = [SK_CX + 7, 14 - f];
      base.sword = 0.45 + f * 0.25;
      base.jaw = true;
      break;
    case 'hurt':
      base.bx = -1;
      base.hx = -2;
      base.hy = -1;
      base.hands = [
        [SK_CX - 5, 11],
        [SK_CX + 5, 12],
      ];
      base.sword = -0.6;
      base.jaw = true;
      break;
  }
  void t;
  return base;
}

/** Череп 7×6 в точке (x, y) — левый верхний угол, смотрит вправо. */
function skull(p: Px, x: number, y: number, jaw: boolean, eyes: RGBA | null): void {
  p.map(
    ['.hhhhh.', 'hhmmmmh', 'hmmmmmm', 'mmssmss', 'smmmnmm', '.sjjjj.'],
    { h: BONE.hi, m: BONE.mid, s: BONE.sh, n: BONE.hole, j: BONE.sh },
    x,
    y,
  );
  // Глазницы — провалы, в них тлеет глаз.
  p.set(x + 2, y + 3, BONE.hole);
  p.set(x + 3, y + 3, BONE.hole);
  p.set(x + 5, y + 3, BONE.hole);
  p.set(x + 6, y + 3, BONE.hole);
  if (eyes) {
    p.set(x + 3, y + 3, eyes);
    p.set(x + 6, y + 3, eyes);
  }
  // Зубы и челюсть.
  p.set(x + 2, y + 5, BONE.hi);
  p.set(x + 4, y + 5, BONE.hi);
  if (jaw) {
    p.set(x + 3, y + 6, BONE.sh);
    p.set(x + 4, y + 6, BONE.mid);
    p.set(x + 5, y + 6, BONE.sh);
    p.set(x + 3, y + 5, BONE.hole);
    p.set(x + 5, y + 5, BONE.hole);
  }
}

/** Ржавый меч: рукоять в кисти (x, y), клинок по углу `a`. */
function rustySword(p: Px, x: number, y: number, a: number, len = 7): void {
  const cx = Math.cos(a);
  const cy = Math.sin(a);
  // Гарда поперёк.
  p.set(Math.round(x - cy), Math.round(y + cx), RUST.dk);
  p.set(Math.round(x + cy), Math.round(y - cx), RUST.dk);
  // Рукоять назад.
  p.set(Math.round(x - cx), Math.round(y - cy), WOOD.dk);
  for (let i = 1; i <= len; i++) {
    const px = Math.round(x + cx * i);
    const py = Math.round(y + cy * i);
    const rust = (i * 7 + 3) % 5 === 0;
    p.set(px, py, rust ? RUST.mid : i === len ? IRON.hi : IRON.mid);
    if (i < len - 1) p.set(Math.round(px - cy * 0.6), Math.round(py + cx * 0.6), IRON.sh);
  }
}

function paintSkel(anim: string, f: number, t: number, eyes: RGBA | null): Px {
  const p = new Px(SK_W, SK_H);
  const s = skelPose(anim, f, t);
  const ox = s.bx;
  const oy = s.by;
  const pelvisY = 15 + oy;
  const chestY = 10 + oy;
  const neckY = 8 + oy;
  const cx = SK_CX + ox;
  // Задняя рука и нога — тенью.
  const [be, bh] = [s.elbows[0], s.hands[0]];
  p.line(cx - 2, chestY, be[0] + ox, be[1] + oy, BONE.sh);
  p.line(be[0] + ox, be[1] + oy, bh[0] + ox, bh[1] + oy, BONE.sh);
  p.line(cx - 1, pelvisY + 1, s.knees[0][0] + ox, s.knees[0][1], BONE.sh);
  p.line(s.knees[0][0] + ox, s.knees[0][1], s.feet[0][0], s.feet[0][1], BONE.sh);
  p.set(s.feet[0][0] - 1, s.feet[0][1], BONE.dk);
  // Таз и тряпка.
  p.rect(cx - 2, pelvisY, cx + 2, pelvisY + 1, BONE.mid);
  p.set(cx - 2, pelvisY, BONE.hi);
  p.rect(cx - 2, pelvisY + 1, cx + 1, pelvisY + 3, RAG.mid);
  p.set(cx - 2, pelvisY + 3, RAG.dk);
  p.set(cx, pelvisY + 4, RAG.dk);
  p.set(cx - 1, pelvisY + 1, RAG.hi);
  // Хребет и рёбра: светлая кость, между рёбрами — пусто.
  p.line(cx, neckY, cx, pelvisY - 1, BONE.sh);
  for (const [dy, w] of [
    [0, 3],
    [2, 3],
    [4, 2],
  ]) {
    const y = chestY + dy - 1;
    p.line(cx - w + 1, y, cx + w, y, BONE.mid);
    p.set(cx - w + 1, y, BONE.hi);
    p.set(cx + w, y + 1, BONE.sh);
  }
  // Передняя нога.
  const [fk, ff] = [s.knees[1], s.feet[1]];
  bone(p, cx + 1, pelvisY + 1, fk[0] + ox, fk[1]);
  bone(p, fk[0] + ox, fk[1], ff[0], ff[1]);
  p.set(ff[0] + 1, ff[1], BONE.mid);
  // Череп.
  skull(p, cx - 3 + s.hx, 2 + oy + s.hy, s.jaw, eyes);
  // Передняя рука с мечом.
  const [fe, fh] = [s.elbows[1], s.hands[1]];
  bone(p, cx + 2, chestY, fe[0] + ox, fe[1] + oy, false);
  bone(p, fe[0] + ox, fe[1] + oy, fh[0] + ox, fh[1] + oy);
  rustySword(p, fh[0] + ox, fh[1] + oy, s.sword);
  p.outline(INK);
  return p;
}

/**
 * Кучка костей: `k` — сколько накопилось подъёма (0 — только рассыпались,
 * 1 — встаёт). Кости сползаются к середине, череп поднимается, глаза
 * разгораются. `j` — дрожь (кадр).
 */
function paintPile(k: number, j: number, eyesOn: boolean): Px {
  const p = new Px(20, 12);
  const g = 11;
  const sp = (1 - k) * 3; // разброс
  const jit = (n: number) => (j % 2 === 0 ? 0 : ((n * 7) % 3) - 1) * (k > 0.3 ? 1 : 0);
  // Бедренные кости крест-накрест.
  bone(p, 3 - sp + jit(1), g - 1, 11 - sp * 0.3, g - 4 + jit(2));
  bone(p, 8 + sp * 0.3, g - 4, 16 + sp, g - 1 + jit(3));
  // Рёбра дугами.
  for (let i = 0; i < 3; i++) {
    const x = 6 + i * 2 - sp * 0.5 + jit(i + 4);
    p.line(x, g - 2, x + 2, g - 3, BONE.mid);
    p.set(x, g - 2, BONE.sh);
  }
  // Таз.
  p.rect(10 + sp * 0.4, g - 2, 12 + sp * 0.4, g - 1, BONE.sh);
  p.set(10 + sp * 0.4, g - 2, BONE.mid);
  // Тряпка.
  p.rect(12 + sp * 0.6, g - 1, 14 + sp * 0.6, g, RAG.dk);
  // Череп: чем ближе подъём, тем выше он сидит.
  const sy = Math.round(g - 6 - k * 2);
  const sx = Math.round(7 + sp * 0.2) + jit(9);
  skull(p, sx, sy, k > 0.8 && j % 2 === 1, eyesOn ? mix(EYE_RED, WHITE, 0.2) : null);
  p.outline(INK);
  return p;
}

registerMobPainter('f4_skel', (m, pose) => {
  let anim: string = pose.anim;
  let frame = pose.frame;
  // Встаёт из кучки: четыре стадии сборки.
  if (pose.mode === 'rise' || pose.mode === 'alert') {
    const k = Math.min(1, pose.t / (pose.mode === 'alert' ? 0.35 : 0.55));
    anim = 'rise';
    frame = Math.min(3, Math.floor(k * 4));
  } else if (anim === 'sleep') anim = 'rest';
  else if (anim === 'dead') anim = 'dead';
  const f =
    anim === 'idle' || anim === 'run' ? mod(frame, 4) : anim === 'rise' ? frame : mod(frame, 2);
  const key = `sk|${anim}|${f}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let px: Px;
  const eyes = mix(EYE_RED, WHITE, 0.15);
  if (anim === 'dead') px = paintPile(0, 0, false);
  else if (anim === 'rest') px = paintPile(0.55, 0, false);
  else if (anim === 'rise') {
    // Сборка: кучка внизу, фигура проявляется снизу вверх.
    const full = paintSkel('idle', 0, 0, f >= 3 ? eyes : null);
    const pile = paintPile(0.9, 0, f >= 2);
    px = new Px(SK_W, SK_H);
    const cut = [SK_H - 6, SK_H - 11, SK_H - 16, 0][f];
    for (let y = 0; y < SK_H; y++)
      for (let x = 0; x < SK_W; x++) {
        const c = full.get(x, y);
        if (c[3] && y >= cut) px.set(x, y + (3 - f), c);
      }
    if (f < 3)
      for (let y = 0; y < pile.h; y++)
        for (let x = 0; x < pile.w; x++) {
          const c = pile.get(x, y);
          if (c[3] && !px.solid(x - 1, SK_H - pile.h + y)) px.set(x - 1, SK_H - pile.h + y, c);
        }
  } else px = paintSkel(anim, f, pose.t, eyes);
  const pile = anim === 'dead' || anim === 'rest';
  const out: MobFrame = {
    img: finish(px, pose.left, pose.flash, pose.look),
    ax: pile ? 10 : pose.left ? SK_W - 1 - SK_CX : SK_CX,
    ay: pile ? 10 : SK_G,
    eye:
      pile || anim === 'rise' ? null : [pose.left ? SK_W - 1 - (SK_CX - 3 + 3) : SK_CX - 3 + 3, 5],
  };
  cache.set(key, out);
  void m;
  return out;
});

registerMobPainter('f4_bones', (m, pose) => {
  const k = Math.min(1, m.data.k ?? 0);
  const ks = Math.floor(k * 6);
  const j = k > 0.35 ? mod(pose.frame, 2) : 0;
  const key = `pile|${ks}|${j}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const px = paintPile(ks / 6, j, ks >= 4);
  const out: MobFrame = {
    img: finish(px, pose.left, pose.flash, 'normal'),
    ax: 10,
    ay: 10,
    eye: null,
  };
  cache.set(key, out);
  return out;
});

// ---------------------------------------------------------------------------
// Латник склепа: четыре стороны, щит — туда, куда смотрит.
// ---------------------------------------------------------------------------

type Dir4 = 'down' | 'up' | 'side';

function dirOf(face: number): { dir: Dir4; left: boolean } {
  const s = Math.sin(face);
  const c = Math.cos(face);
  if (s > 0.72) return { dir: 'down', left: c < 0 };
  if (s < -0.72) return { dir: 'up', left: c < 0 };
  return { dir: 'side', left: c < 0 };
}

const KN_W = 24;
const KN_H = 30;
const KN_CX = 12;
const KN_G = 29;

/** Башенный щит лицом к зрителю: железная оковка, тёмно-красное поле, костяной знак. */
function towerShield(p: Px, x0: number, y0: number, w: number, h: number, knocked = false): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || x === w - 1 || y === 0 || y === h - 1;
      // Низ щита — клином.
      if (y === h - 1 && (x === 0 || x === w - 1)) continue;
      const c = edge
        ? x === 0 || y === 0
          ? IRON.hi
          : IRON.sh
        : x < 2
          ? TABARD.hi
          : x > w - 3
            ? TABARD.dk
            : TABARD.mid;
      p.set(x0 + x, y0 + y, knocked ? mix(c, IRON.dk, 0.25) : c);
    }
  // Знак: череп склепа (светлый) на поле.
  const sx = x0 + Math.floor(w / 2) - 1;
  const sy = y0 + Math.floor(h / 2) - 2;
  p.rect(sx, sy, sx + 2, sy + 1, BONE.mid);
  p.set(sx, sy + 2, BONE.sh);
  p.set(sx + 2, sy + 2, BONE.sh);
  p.set(sx + 1, sy + 2, BONE.mid);
  p.set(sx, sy + 1, BONE.hole);
  p.set(sx + 2, sy + 1, BONE.hole);
  // Заклёпки.
  p.set(x0 + 1, y0 + 1, IRON.hi);
  p.set(x0 + w - 2, y0 + 1, IRON.mid);
  p.set(x0 + 1, y0 + h - 2, IRON.mid);
}

/** Щит сбоку — ребром: узкая полоса с оковкой. */
function shieldEdge(p: Px, x0: number, y0: number, h: number, tilt = 0): void {
  for (let y = 0; y < h; y++) {
    const x = x0 + Math.round((y / h) * tilt);
    p.set(x, y0 + y, IRON.hi);
    p.set(x + 1, y0 + y, TABARD.mid);
    p.set(x + 2, y0 + y, TABARD.dk);
    p.set(x + 3, y0 + y, IRON.sh);
  }
}

/** Копьё: древко от (x, y) по углу `a` длиной `len`, железный наконечник. */
function spear(p: Px, x: number, y: number, a: number, len: number, back = 4): void {
  const cx = Math.cos(a);
  const cy = Math.sin(a);
  for (let i = -back; i <= len; i++) {
    const px = Math.round(x + cx * i);
    const py = Math.round(y + cy * i);
    if (i >= len - 2) p.set(px, py, i === len ? IRON.hi : IRON.mid);
    else p.set(px, py, i % 3 === 0 ? WOOD.hi : WOOD.mid);
  }
  // Крылья наконечника.
  const bx = Math.round(x + cx * (len - 2));
  const by = Math.round(y + cy * (len - 2));
  p.set(Math.round(bx - cy), Math.round(by + cx), IRON.sh);
  p.set(Math.round(bx + cy), Math.round(by - cx), IRON.sh);
}

/** Шлем-ведро со смотровой щелью; `eyes` — тлеющий взгляд в щели. */
function helm(p: Px, x: number, y: number, dir: Dir4, eyes: boolean): void {
  // Гребень — тёмно-красный.
  p.rect(x + 2, y - 2, x + 4, y - 1, TABARD.mid);
  p.set(x + 2, y - 2, TABARD.hi);
  p.rect(x, y, x + 6, y + 6, IRON.mid);
  p.rect(x, y, x + 1, y + 6, IRON.hi);
  p.rect(x + 5, y, x + 6, y + 6, IRON.sh);
  p.rect(x, y + 6, x + 6, y + 6, IRON.dk);
  if (dir === 'down') {
    p.rect(x + 1, y + 3, x + 5, y + 3, IRON.dk);
    p.rect(x + 3, y + 3, x + 3, y + 5, IRON.dk);
    if (eyes) {
      p.set(x + 2, y + 3, EYE_AMBER);
      p.set(x + 4, y + 3, EYE_AMBER);
    }
  } else if (dir === 'side') {
    p.rect(x + 3, y + 3, x + 6, y + 3, IRON.dk);
    p.set(x + 6, y + 4, IRON.dk);
    if (eyes) p.set(x + 5, y + 3, EYE_AMBER);
  } else {
    // Затылок: заклёпки по шву.
    p.set(x + 3, y + 1, IRON.sh);
    p.set(x + 3, y + 3, IRON.sh);
    p.set(x + 3, y + 5, IRON.sh);
  }
}

function paintKnight(dir: Dir4, mode: string, f: number, eyes: boolean): Px {
  const p = new Px(KN_W, KN_H);
  const cx = KN_CX;
  const g = KN_G;
  const lunge = mode === 'lunge';
  const aim = mode === 'aim';
  const open = mode === 'open';
  const stag = mode === 'stagger';
  const dead = mode === 'dead';
  if (dead) {
    // Латы грудой: шлем на боку, щит плашмя, копьё поперёк.
    spear(p, 3, g - 1, -0.08, 17, 0);
    p.rect(5, g - 4, 15, g - 1, TABARD.dk);
    p.rect(6, g - 5, 14, g - 3, TABARD.mid);
    p.set(8, g - 4, BONE.mid);
    p.set(10, g - 4, BONE.mid);
    p.rect(14, g - 5, 19, g - 1, IRON.mid);
    p.rect(14, g - 5, 15, g - 1, IRON.hi);
    p.rect(16, g - 3, 19, g - 3, IRON.dk);
    p.outline(INK);
    return p;
  }
  const step = mode === 'run' ? [0, 1, 0, -1][f] : 0;
  const bob = mode === 'idle' ? [0, 0, 1, 1][f] : mode === 'run' ? f % 2 : 0;
  const lean = lunge ? 2 : aim ? -1 : stag ? -2 : 0;
  const top = 7 + bob;
  // Ноги в поножах.
  const legL = cx - 3 + (dir === 'side' ? -step : 0);
  const legR = cx + 1 + (dir === 'side' ? step + (lunge ? 2 : 0) : 0);
  const legH = dir === 'side' || dir === 'up' ? step : 0;
  p.rect(legL, g - 6 + Math.max(0, legH), legL + 1, g, IRON.sh);
  p.rect(legR, g - 6 + Math.max(0, -legH), legR + 1, g, IRON.mid);
  p.set(legL - 1, g, IRON.dk);
  p.set(legR + 2, g, IRON.dk);
  // Корпус: кираса под сюрко.
  const bx = cx - 4 + lean;
  p.rect(bx, top + 7, bx + 8, top + 16, IRON.mid);
  p.rect(bx, top + 7, bx + 1, top + 16, IRON.hi);
  p.rect(bx + 7, top + 7, bx + 8, top + 16, IRON.sh);
  // Сюрко (накидка) — тёмно-красная, с рваным низом; сбоку — узкой полосой.
  if (dir === 'side') {
    p.rect(bx + 5, top + 9, bx + 6, top + 18, TABARD.mid);
    p.set(bx + 5, top + 19, TABARD.dk);
  } else {
    p.rect(bx + 2, top + 9, bx + 6, top + 18, TABARD.mid);
    p.rect(bx + 2, top + 9, bx + 2, top + 18, TABARD.hi);
    p.set(bx + 3, top + 19, TABARD.dk);
    p.set(bx + 5, top + 19, TABARD.dk);
  }
  p.rect(bx + 1, top + 13, bx + 7, top + 13, WOOD.dk);
  p.set(bx + 4, top + 13, GOLD.dk);
  // Наплечники.
  p.rect(bx - 1, top + 7, bx + 1, top + 9, IRON.hi);
  p.rect(bx + 7, top + 7, bx + 9, top + 9, IRON.sh);
  // Шлем.
  helm(p, cx - 3 + lean, top, dir, eyes);

  if (dir === 'up') {
    // Спиной: плащ на всю спину, щит ребром слева, копьё справа.
    p.rect(bx + 1, top + 8, bx + 7, top + 19, TABARD.dk);
    p.rect(bx + 1, top + 8, bx + 2, top + 19, TABARD.mid);
    for (let x = bx + 1; x <= bx + 7; x += 2) p.set(x, top + 20, TABARD.dk);
    shieldEdge(p, bx - 3, top + 8, 13, open ? 3 : 0);
    if (lunge) spear(p, bx + 9, top + 12, -Math.PI / 2, 16, 2);
    else if (aim) spear(p, bx + 9, top + 18, -Math.PI / 2, 10, 2);
    else spear(p, bx + 10, top + 17, -Math.PI / 2 - 0.05, 18, 3);
  } else if (dir === 'down') {
    // Лицом: щит закрывает грудь и ноги; в замахе и выпаде копьё — ПЕРЕД
    // щитом, остриём к зрителю (иначе щит его прятал).
    if (open) spear(p, cx + 6, top + 10, Math.PI / 2 - 0.4, 12, 3);
    else if (!lunge && !aim) spear(p, cx + 6, top + 19, -Math.PI / 2 + 0.03, 20, 2);
    if (open || stag) towerShield(p, bx - 4, top + 12, 7, 11, true);
    else towerShield(p, cx - 6 + lean, top + 8 - (aim ? 1 : 0), 10, 13);
    if (lunge) spear(p, cx + 3, top + 13, Math.PI / 2 - 0.08, 15, 2);
    else if (aim) spear(p, cx + 6, top + 6, Math.PI / 2 - 0.25, 9, 5);
  } else {
    // Сбоку (вправо): плащ за спиной, кираса видна; щит впереди в три
    // четверти — оковка, красное поле, костяной знак; копьё над щитом.
    p.rect(bx - 2, top + 8, bx, top + 19, TABARD.dk);
    p.set(bx - 2, top + 20, TABARD.dk);
    p.set(bx - 1, top + 9, TABARD.mid);
    if (lunge) spear(p, bx + 6, top + 11, 0, 14, 7);
    else if (aim) spear(p, bx + 2, top + 10, 0, 9, 6);
    else if (open) spear(p, bx + 7, top + 12, 0.7, 10, 4);
    else if (stag) spear(p, bx + 4, top + 9, -1.9, 12, 3);
    else spear(p, bx + 9, top + 18, -Math.PI / 2 + 0.2, 20, 2);
    if (open) towerShield(p, bx - 3, top + 12, 5, 10, true);
    else if (stag) shieldEdge(p, bx - 4, top + 5, 11, -4);
    else towerShield(p, bx + 5 + (aim ? -1 : 0) + (lunge ? 2 : 0), top + 7, 6, 14);
  }
  p.outline(INK);
  return p;
}

registerMobPainter('f4_knight', (m, pose) => {
  const { dir, left } = dirOf(m.face);
  let mode = pose.mode;
  if (pose.anim === 'dead') mode = 'dead';
  else if (mode === 'guard' || mode === 'chase')
    mode = Math.hypot(m.vx, m.vy) > 0.4 ? 'run' : 'idle';
  else if (mode !== 'aim' && mode !== 'lunge' && mode !== 'open' && mode !== 'stagger')
    mode = pose.anim === 'run' ? 'run' : 'idle';
  const f = mode === 'idle' || mode === 'run' ? mod(pose.frame, 4) : 0;
  const flip = dir === 'side' ? left : false;
  // Щит закрыт от героя — кант щита светлее (видно, что он «держит»).
  const key = `kn|${dir}|${mode}|${f}|${flip ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const px = paintKnight(dir, mode, f, mode !== 'dead');
  const out: MobFrame = {
    img: finish(px, flip, pose.flash, pose.look),
    ax: KN_CX,
    ay: KN_G,
    eye: null,
  };
  cache.set(key, out);
  void knightGuards;
  return out;
});

// ---------------------------------------------------------------------------
// Некромант.
// ---------------------------------------------------------------------------

const NC_W = 22;
const NC_H = 28;
const NC_CX = 10;
const NC_G = 26;

function flame(p: Px, x: number, y: number, f: number, big = false): void {
  const h = big ? 5 : 3;
  const sway = [0, 1, 0, -1][f % 4];
  for (let i = 0; i < h; i++) {
    const w = Math.max(0, Math.round((h - i) / (big ? 2 : 2.2)));
    const xx = x + (i > 1 ? sway : 0);
    const c = i < 1 ? GREEN.hi : i < h - 1 ? GREEN.mid : GREEN.dk;
    p.rect(xx - w, y - i, xx + w, y - i, c);
  }
  p.set(x + sway, y - h, GREEN.dk);
}

function paintNecro(mode: string, f: number, t: number): Px {
  const p = new Px(NC_W, NC_H);
  const cx = NC_CX;
  const float = mode === 'dead' ? 0 : [0, -1, -1, 0][f % 4];
  const g = NC_G + float;
  if (mode === 'dead') {
    // Балахон осел пустой грудой, посох рядом, гримуар раскрыт.
    p.rect(cx - 6, g - 3, cx + 5, g, ROBE.dk);
    p.rect(cx - 5, g - 4, cx + 3, g - 3, ROBE.mid);
    p.set(cx - 2, g - 5, ROBE.mid);
    spear(p, cx - 8, g + 1, -0.1, 17, 0);
    p.rect(cx + 3, g - 1, cx + 6, g, hex('#6a2a2a'));
    p.set(cx + 4, g - 1, BONE.hi);
    p.outline(INK);
    return p;
  }
  const lean = mode === 'run' ? 1 : mode === 'aim' ? 1 : 0;
  // Балахон: трапеция с рваным подолом, свет слева.
  for (let y = 9; y <= g - 1; y++) {
    const k = (y - 9) / (g - 10);
    const half = 3 + k * 3.5;
    const x0 = Math.round(cx - half + lean * (1 - k));
    const x1 = Math.round(cx + half + lean * (1 - k));
    for (let x = x0; x <= x1; x++) {
      const rel = (x - x0) / Math.max(1, x1 - x0);
      let c = rel < 0.22 ? ROBE.hi : rel < 0.7 ? ROBE.mid : ROBE.dk;
      if ((x + y) % 5 === 0 && rel > 0.3) c = ROBE.dk; // складки
      p.set(x, y, c);
    }
  }
  // Рваный подол колышется.
  for (let x = cx - 6; x <= cx + 6; x += 2) {
    const sway = (x + f) % 3 === 0 ? 1 : 0;
    p.set(x + sway, g, ROBE.dk);
  }
  // Пояс-верёвка и гримуар.
  p.rect(cx - 3 + lean, 15, cx + 3 + lean, 15, GOLD.dk);
  p.rect(cx - 5 + lean, 16, cx - 3 + lean, 19, hex('#6a2a2a'));
  p.set(cx - 5 + lean, 16, hex('#9a4a3a'));
  p.set(cx - 4 + lean, 17, GOLD.mid);
  // Капюшон и тьма лица, в ней — два зелёных глаза.
  const hx = cx - 3 + lean;
  p.rect(hx, 2, hx + 6, 9, ROBE.mid);
  p.rect(hx, 3, hx + 1, 9, ROBE.hi);
  erase(p, hx, 2);
  erase(p, hx + 6, 2);
  p.set(hx + 3, 1, ROBE.mid);
  p.set(hx + 4, 1, ROBE.dk);
  p.rect(hx + 2, 4, hx + 6, 8, ROBE.deep);
  p.set(hx + 3, 6, GREEN.mid);
  p.set(hx + 5, 6, GREEN.mid);
  // Посох с черепом и огнём.
  const raise = mode === 'raise';
  const cast = mode === 'aim';
  const sx = cx + 5 + lean + (cast ? 2 : 0);
  const topY = raise ? 1 : cast ? 4 : 5;
  const tilt = cast ? 0.45 : 0;
  for (let y = topY + 3; y <= g - 1; y++) {
    const x = Math.round(sx - (y - topY) * tilt * 0.3);
    p.set(x, y, y % 4 === 0 ? WOOD.hi : WOOD.dk);
  }
  // Кисть на посохе — кость.
  p.set(sx - 1, topY + 9, BONE.mid);
  p.set(sx - 1, topY + 10, BONE.sh);
  // Череп на навершии.
  p.rect(sx - 1, topY + 1, sx + 1, topY + 2, BONE.mid);
  p.set(sx - 1, topY + 1, BONE.hi);
  p.set(sx, topY + 2, BONE.hole);
  p.set(sx - 1, topY + 3, BONE.sh);
  p.set(sx + 1, topY + 3, BONE.sh);
  flame(p, sx, topY, f, cast || raise);
  if (raise) {
    // Вторая рука вверх — зовёт кости.
    p.line(cx - 4, 10, cx - 6, 5, ROBE.mid);
    p.set(cx - 6, 4, BONE.mid);
    p.set(cx - 7, 3, GREEN.mid);
  } else {
    p.set(cx - 5 + lean, 12, ROBE.hi);
    p.set(cx - 5 + lean, 13, BONE.sh);
  }
  p.outline(INK);
  // Колдовство — зелёные искры вокруг (поверх контура).
  if (cast || raise) {
    const n = raise ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 6;
      p.set(Math.round(sx + Math.cos(a) * 3), Math.round(topY + 1 + Math.sin(a) * 2), GREEN.hi);
    }
  }
  return p;
}

registerMobPainter('f4_necro', (m, pose) => {
  let mode = pose.mode;
  if (pose.anim === 'dead') mode = 'dead';
  else if (
    mode === 'chase' ||
    mode === 'recover' ||
    mode === 'stun' ||
    mode === 'alert' ||
    mode === 'emerge' ||
    mode === 'sleep'
  )
    mode = pose.anim === 'run' ? 'run' : 'idle';
  const fade =
    mode === 'blink'
      ? Math.min(1, pose.t / 0.35)
      : mode === 'appear'
        ? 1 - Math.min(1, pose.t / 0.35)
        : 0;
  const fs = Math.floor(fade * 4);
  if (mode === 'blink' || mode === 'appear') mode = 'idle';
  const f = mod(pose.frame, 4);
  const ts = mode === 'aim' || mode === 'raise' ? mod(pose.t * 10, 6) : 0;
  const key = `nc|${mode}|${f}|${ts}|${fs}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const px = paintNecro(mode, f, ts / 10);
  // Исчезает в пыль: выпадают пиксели по шуму, снизу вверх.
  if (fs > 0)
    for (let y = 0; y < px.h; y++)
      for (let x = 0; x < px.w; x++) {
        const n = ((x * 7 + y * 13) % 11) / 11;
        if (n < fs / 4 + (y / px.h) * 0.25 * (fs / 4)) erase(px, x, y);
      }
  const out: MobFrame = {
    img: finish(px, pose.left, pose.flash, pose.look),
    ax: pose.left ? NC_W - 1 - NC_CX : NC_CX,
    ay: NC_G,
    eye: fs >= 3 ? null : [pose.left ? NC_W - 1 - (NC_CX + 1) : NC_CX + 1, 6],
  };
  cache.set(key, out);
  void m;
  return out;
});

// ---------------------------------------------------------------------------
// Статуя-страж: каменный воин с двуручным мечом.
// ---------------------------------------------------------------------------

const ST_W = 22;
const ST_H = 32;
const ST_CX = 10;
const ST_G = 30;

/** Камень со светом слева-сверху, мхом и трещинами — постоянными по пикселю. */
function stoneAt(x: number, y: number, rel: number, moss = true): RGBA {
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  if (moss && h % 41 === 0) return STONE.moss;
  if (moss && h % 59 === 0) return STONE.mossDk;
  if (rel < 0.25) return STONE.hi;
  if (rel < 0.7) return h % 7 === 0 ? STONE.sh : STONE.mid;
  return STONE.sh;
}

function fillStone(p: Px, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) p.set(x, y, stoneAt(x, y, (x - x0) / Math.max(1, x1 - x0)));
}

/** Каменный меч: крестовина, клинок по углу. */
function stoneSword(p: Px, x: number, y: number, a: number, len: number): void {
  // Клинок темнее одеяния (сланец со светлой кромкой) — иначе меч
  // пропадает на фоне статуи.
  const blade = hex('#4c4f52');
  const edge = hex('#a8adb0');
  const cx = Math.cos(a);
  const cy = Math.sin(a);
  for (let i = -2; i <= len; i++) {
    const px = Math.round(x + cx * i);
    const py = Math.round(y + cy * i);
    p.set(px, py, i < 0 ? STONE.dk : i === len ? edge : blade);
    if (i > 0 && i < len) p.set(Math.round(px - cy), Math.round(py + cx), edge);
  }
  // Крестовина.
  for (const s of [-2, -1, 1, 2]) p.set(Math.round(x - cy * s), Math.round(y + cx * s), STONE.dk);
}

/**
 * Поза статуи: 0 — меч остриём в пол, руки на навершии (покой); 1 — меч
 * над головой; 2 — выпад мечом вперёд; 3 — рука тянется вперёд; `stride` —
 * шаг (идёт); `kneel` — склонилась перед взором; `strike` — рубит вниз.
 */
function paintStatue(
  pose: number,
  stride: number,
  kneel: boolean,
  strike: boolean,
  eyes: boolean,
  gold: boolean,
): Px {
  // Каменный латник: шлем с гребнем, широкие наплечники, кираса, юбка
  // складками, двуручный меч сланцем. Свет слева: правая треть — в тени,
  // части разделены тёмными швами, иначе статуя читается простынёй.
  const p = new Px(ST_W, ST_H);
  const cx = ST_CX;
  const g = ST_G;
  const down = kneel ? 4 : 0;
  const lean = pose === 2 || strike ? 2 : pose === 3 ? 1 : 0;
  const top = 11 + down;
  const seam = STONE.dk;
  const tone = (rel: number, x: number, y: number) =>
    rel < 0.28 ? STONE.hi : rel < 0.66 ? stoneAt(x, y, 0.5) : STONE.sh;
  // Поножи из-под юбки — шаг видно по ним.
  const fwd = stride !== 0 ? stride : pose === 2 ? 2 : 0;
  if (kneel) {
    for (let y = g - 3; y <= g; y++)
      for (let x = cx - 5; x <= cx + 5; x++) p.set(x, y, tone((x - cx + 5) / 10, x, y));
  } else {
    for (let y = g - 4; y <= g; y++) {
      for (let x = cx - 3 - Math.max(0, -fwd); x <= cx - 1 - Math.max(0, -fwd); x++)
        p.set(x, y, STONE.mid);
      for (let x = cx + 1 + Math.max(0, fwd); x <= cx + 3 + Math.max(0, fwd); x++)
        p.set(x, y, STONE.sh);
    }
  }
  // Юбка: колокол со складками.
  for (let y = top + 8; y <= g - 3 + (kneel ? 1 : 0); y++) {
    const k = (y - top - 8) / Math.max(1, g - 3 - top - 8);
    const half = 4 + k * 2.2;
    const x0 = Math.round(cx - half + lean * 0.5);
    const x1 = Math.round(cx + half + lean * 0.5);
    for (let x = x0; x <= x1; x++) {
      const rel = (x - x0) / Math.max(1, x1 - x0);
      p.set(x, y, (x - x0) % 3 === 1 && y > top + 9 ? STONE.sh : tone(rel, x, y));
    }
  }
  // Кираса и пояс.
  for (let y = top + 1; y <= top + 8; y++)
    for (let x = cx - 4 + lean; x <= cx + 4 + lean; x++)
      p.set(x, y, tone((x - cx + 4 - lean) / 8, x, y));
  p.rect(cx - 4 + lean, top + 8, cx + 4 + lean, top + 8, gold ? GOLD.dk : seam);
  p.line(cx + lean, top + 3, cx + lean, top + 7, STONE.sh);
  // Наплечники — шире кирасы, с тёмным швом снизу.
  for (const s of [-1, 1]) {
    const px0 = cx + lean + s * 5;
    p.rect(px0 - 2, top - 1, px0 + 2, top + 2, s < 0 ? STONE.hi : STONE.sh);
    p.rect(px0 - 2, top - 1, px0 + 2, top - 1, s < 0 ? STONE.hi : STONE.mid);
    p.rect(px0 - 2, top + 3, px0 + 2, top + 3, seam);
  }
  // Шлем: ведро с гребнем и Т-образной прорезью.
  const hx = cx - 3 + lean + (pose === 0 && !kneel ? 0 : 1);
  const hy = top - 7 + (pose === 0 || kneel ? 1 : 0);
  for (let y = hy; y <= hy + 6; y++)
    for (let x = hx; x <= hx + 6; x++) p.set(x, y, tone((x - hx) / 6, x, y));
  erase(p, hx, hy);
  erase(p, hx + 6, hy);
  p.rect(hx + 3, hy - 2, hx + 3, hy, gold ? GOLD.mid : STONE.hi);
  p.set(hx + 2, hy - 1, gold ? GOLD.dk : STONE.mid);
  p.rect(hx + 1, hy + 3, hx + 5, hy + 3, seam);
  p.rect(hx + 3, hy + 3, hx + 3, hy + 5, seam);
  if (eyes) {
    p.set(hx + 2, hy + 3, EYE_RED);
    p.set(hx + 4, hy + 3, EYE_RED);
  }
  p.rect(hx, hy + 6, hx + 6, hy + 6, seam);
  // Руки и меч.
  const sh = top + 1;
  if (strike) {
    p.line(cx + 3 + lean, sh, cx + 7, sh + 5, STONE.mid);
    stoneSword(p, cx + 7, sh + 5, 0.35, 11);
  } else if (pose === 1) {
    p.line(cx - 3 + lean, sh, cx + 1, sh - 7, STONE.hi);
    p.line(cx + 4 + lean, sh, cx + 2, sh - 7, STONE.sh);
    stoneSword(p, cx + 1, sh - 8, -Math.PI / 2 - 0.15, 12);
  } else if (pose === 2) {
    p.line(cx + 2 + lean, sh + 2, cx + 7, sh + 3, STONE.hi);
    p.line(cx - 3 + lean, sh + 2, cx + 6, sh + 4, STONE.sh);
    stoneSword(p, cx + 7, sh + 3, 0.05, 12);
  } else if (pose === 3) {
    // Тянется рукой: пальцы-когти, меч опущен позади.
    stoneSword(p, cx - 5, sh + 4, 2.3, 10);
    p.line(cx + 3 + lean, sh + 1, cx + 9, sh - 1, STONE.hi);
    p.line(cx + 3 + lean, sh + 2, cx + 9, sh, STONE.sh);
    p.set(cx + 10, sh - 2, STONE.hi);
    p.set(cx + 10, sh, STONE.hi);
    p.set(cx + 11, sh - 1, STONE.hi);
  } else {
    // Покой: обе руки на навершии, меч остриём в пол перед собой.
    const px0 = cx + (kneel ? 5 : 6);
    stoneSword(p, px0, sh + 3, Math.PI / 2, g - sh - 4);
    p.line(cx - 2 + lean, sh + 1, px0 - 1, sh + 3, STONE.hi);
    p.line(cx + 3 + lean, sh + 1, px0, sh + 2, STONE.sh);
    p.rect(px0 - 1, sh + 2, px0 + 1, sh + 3, STONE.mid);
  }
  // Трещина по камню — всегда одна и та же.
  p.line(cx - 2, top + 10, cx - 1, top + 14, seam);
  p.set(cx, top + 15, seam);
  p.outline(INK);
  return p;
}

/** Статуя рассыпалась: груда камня, голова откатилась. */
function paintRubble(gold: boolean): Px {
  const p = new Px(ST_W, ST_H);
  const g = ST_G;
  const stones: [number, number, number, number][] = [
    [3, g - 3, 5, 2],
    [8, g - 4, 6, 3],
    [13, g - 2, 4, 2],
    [6, g - 1, 9, 1],
    [16, g - 1, 3, 1],
  ];
  for (const [x, y, w, h] of stones) fillStone(p, x, y, x + w, y + h);
  // Голова — на боку.
  fillStone(p, 1, g - 6, 5, g - 3);
  p.rect(2, g - 5, 4, g - 5, STONE.dk);
  if (gold) p.rect(1, g - 6, 1, g - 3, GOLD.mid);
  // Меч обломком.
  stoneSword(p, 12, g - 5, -0.2, 7);
  p.outline(INK);
  return p;
}

/** Кадр статуи: для мобов (страж, страж идола) и для мёртвых на постаменте. */
function statueFrame(
  key: string,
  make: () => Px,
  left: boolean,
  flash: boolean,
  look: MobPose['look'],
  eyes: boolean,
  eyeX: number,
  eyeY: number,
): MobFrame {
  const hit = cache.get(key);
  if (hit) return hit;
  const px = make();
  const out: MobFrame = {
    img: finish(px, left, flash, look),
    ax: left ? ST_W - 1 - ST_CX : ST_CX,
    ay: ST_G,
    eye: eyes ? [left ? ST_W - 1 - eyeX : eyeX, eyeY] : null,
  };
  cache.set(key, out);
  return out;
}

registerMobPainter('f4_statue', (m, pose) => {
  const gold = m.kind === 'f4_statue';
  const mode = pose.mode;
  if (pose.anim === 'dead')
    return statueFrame(
      `stR|${gold ? 1 : 0}|${pose.left ? 1 : 0}`,
      () => paintRubble(gold),
      pose.left,
      false,
      'normal',
      false,
      0,
      0,
    );
  const eyes = (m.data.eyes ?? 0) > 0 && mode !== 'dormant' && mode !== 'sleep';
  let fp = mod(m.data.pose ?? 0, 4);
  let stride = 0;
  let kneel = false;
  let strike = false;
  if (mode === 'sleep' || mode === 'dormant' || mode === 'rise' || mode === 'alert') fp = 0;
  else if (mode === 'bow') {
    fp = 0;
    kneel = true;
  } else if (mode === 'creep') {
    fp = 3;
    stride = mod(pose.frame / 2, 2) === 0 ? 2 : -1;
  } else if (mode === 'wind') fp = 1;
  else if (mode === 'recover') {
    fp = 2;
    strike = pose.t < 0.3;
  }
  // Глаз — посередине прорези (для свечения в темноте).
  const hx = ST_CX - 3 + (fp === 0 && !kneel ? 0 : 1) + (fp === 2 || strike ? 2 : fp === 3 ? 1 : 0);
  const hy = 10 + (kneel ? 4 : 0) - 7 + (fp === 0 || kneel ? 1 : 0);
  const riseFlick = mode === 'rise' && mod(pose.t * 12, 2) === 0;
  return statueFrame(
    `st|${gold ? 1 : 0}|${fp}|${stride}|${kneel ? 1 : 0}|${strike ? 1 : 0}|${eyes || riseFlick ? 1 : 0}|${pose.left ? 1 : 0}|${pose.flash ? 1 : 0}|${pose.look}`,
    () => paintStatue(fp, stride, kneel, strike, eyes || riseFlick, gold),
    pose.left,
    pose.flash,
    pose.look,
    eyes,
    hx + 4,
    hy + 3,
  );
});

// ---------------------------------------------------------------------------
// Каменный идол: сидящий колосс на троне.
// ---------------------------------------------------------------------------

const ID_W = 64;
const ID_H = 72;
const ID_CX = 32;
const ID_G = 70;

type IdolEyes = 'off' | 'dim' | 'rule' | 'gaze' | 'spent' | 'wrath';

/** Трещины по телу идола: чем больше разбитых стражей, тем их больше. */
const IDOL_CRACKS: [number, number][][] = [
  [
    [27, 30],
    [29, 34],
    [27, 39],
  ],
  [
    [40, 29],
    [38, 33],
    [41, 37],
    [39, 42],
  ],
  [
    [24, 9],
    [26, 13],
    [24, 17],
  ],
  [
    [43, 47],
    [45, 51],
    [43, 56],
  ],
  [
    [19, 48],
    [22, 52],
    [20, 57],
  ],
  [
    [36, 6],
    [34, 10],
    [36, 12],
  ],
];

/** Базальт идола — темнее и теплее камня статуй: он старше их. */
const BASALT = {
  hi: hex('#a8a28e'),
  lit: hex('#878170'),
  mid: hex('#6a6558'),
  sh: hex('#4d4940'),
  dk: hex('#34312b'),
  deep: hex('#15130f'),
};

/** Тон базальта по свету слева-сверху: доля по ширине и по высоте детали. */
function basalt(x: number, y: number, rx: number, ry: number): RGBA {
  const v = rx * 0.72 + ry * 0.28;
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const step = h % 13 === 0 ? 0.14 : 0;
  const k = v + step;
  if (k < 0.16) return BASALT.hi;
  if (k < 0.36) return BASALT.lit;
  if (k < 0.62) return BASALT.mid;
  if (k < 0.86) return BASALT.sh;
  return BASALT.dk;
}

/** Залить эллипс базальтом со светотенью. */
function basaltEll(p: Px, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      p.set(x, y, basalt(x, y, (dx + 1) / 2, (dy + 1) / 2));
    }
}

function basaltRect(p: Px, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++)
      p.set(x, y, basalt(x, y, (x - x0) / Math.max(1, x1 - x0), (y - y0) / Math.max(1, y1 - y0)));
}

function idolEyesColor(e: IdolEyes, pulse: number): RGBA | null {
  switch (e) {
    case 'dim':
      return mix(EYE_AMBER, hex('#6a3a14'), 0.35);
    case 'rule':
      return mix(GOLD.mid, GOLD.hi, pulse);
    case 'gaze':
      return mix(EYE_RED, hex('#fff0d0'), pulse * 0.6);
    case 'wrath':
      return EYE_RED;
    default:
      return null;
  }
}

/**
 * Идол. `eyes` — чем горят глаза; `core` — печать на груди горит золотом
 * (уязвим); `arm` — поднятая рука (−1 левая, 1 правая, 0 — обе на коленях),
 * `slam` — рука ударила о пол; `cracks` — трещины; `broken` — разбит.
 */
function paintIdol(
  eyes: IdolEyes,
  pulse: number,
  core: boolean,
  arm: number,
  slam: boolean,
  cracks: number,
  broken: boolean,
): Px {
  const p = new Px(ID_W, ID_H);
  const cx = ID_CX;
  const g = ID_G;
  const B = BASALT;
  // Спинка трона: тёмная арка в золотой кайме, по бокам — колонны.
  for (let y = 2; y <= 62; y++) {
    const half = y < 13 ? 21 * Math.sqrt(Math.max(0, 1 - ((13 - y) / 11) ** 2)) : 21;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      const edge = Math.abs(x - cx) >= half - 1.2 || y === 2;
      p.set(
        x,
        y,
        edge ? GOLD.dk : y % 6 === 0 && Math.abs(x - cx) > half - 4 ? B.deep : hex('#24221d'),
      );
    }
  }
  for (const s of [-1, 1]) {
    const px0 = cx + s * 22 - 2;
    basaltRect(p, px0, 16, px0 + 4, 62);
    p.rect(px0 - 1, 14, px0 + 5, 16, GOLD.mid);
    p.rect(px0 - 1, 14, px0 + 5, 14, GOLD.hi);
  }
  // Постамент в две ступени, золотой пояс.
  basaltRect(p, 7, 62, 57, 65);
  basaltRect(p, 5, 66, 59, g);
  p.rect(7, 62, 57, 62, B.hi);
  p.rect(5, 66, 59, 66, B.lit);
  for (let x = 9; x <= 55; x += 5) p.set(x, 64, GOLD.dk);
  if (broken) {
    // Разбит: торс рассечён, голова скатилась к подножию и всё так же ухмыляется.
    for (let y = 30; y <= 61; y++) {
      const half = 17 - (y - 30) * 0.1;
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        if (y < 34 + Math.abs(x - cx - 3) * 0.6) continue;
        p.set(x, y, basalt(x, y, (x - cx + half) / (2 * half), (y - 30) / 31));
      }
    }
    p.line(cx - 2, 36, cx + 4, 61, B.deep);
    p.line(cx + 4, 46, cx + 12, 52, B.deep);
    basaltEll(p, cx + 17, g - 9, 10, 8);
    p.rect(cx + 11, g - 11, cx + 14, g - 10, B.deep);
    p.rect(cx + 19, g - 11, cx + 22, g - 10, B.deep);
    for (let x = -6; x <= 6; x++) p.set(cx + 17 + x, g - 6 + Math.round((x / 6) ** 2 * -2), B.deep);
    p.rect(cx + 8, g - 17, cx + 26, g - 16, GOLD.dk);
    for (const [x, y] of [
      [cx - 22, g - 6],
      [cx - 13, g - 5],
      [cx + 26, g - 4],
    ])
      basaltRect(p, x, y - 3, x + 4, y);
    p.outline(INK);
    return p;
  }
  // Голени и ступни.
  for (const s of [-1, 1]) {
    const lx = cx + s * 10;
    basaltRect(p, lx - 5, 52, lx + 5, 61);
    basaltRect(p, lx - 6, 59, lx + 6, 61);
    for (let t = -4; t <= 4; t += 2) p.set(lx + t, 61, B.deep);
  }
  // Бёдра и колени — глыбы к зрителю.
  for (const s of [-1, 1]) {
    basaltRect(p, cx + (s < 0 ? -18 : 3), 44, cx + (s < 0 ? -3 : 18), 50);
    basaltEll(p, cx + s * 10, 50, 8, 5.2);
    p.line(cx + s * 10 - 5, 54, cx + s * 10 + 5, 54, B.dk);
  }
  // Набедренная повязка между колен — тёмно-красная с золотой каймой.
  for (let y = 44; y <= 58; y++) {
    const half = 4 - (y - 44) * 0.12;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++)
      p.set(x, y, x <= cx - half + 1 ? TABARD.mid : TABARD.dk);
  }
  p.rect(cx - 4, 44, cx + 4, 44, GOLD.mid);
  p.set(cx - 1, 58, GOLD.dk);
  p.set(cx + 1, 58, GOLD.dk);
  // Торс: широкие плечи, грудь, живот.
  for (let y = 25; y <= 46; y++) {
    const half = y < 29 ? 13 + (y - 25) * 1.6 : 19.4 - (y - 29) * 0.3;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++)
      p.set(x, y, basalt(x, y, (x - cx + half) / (2 * half), (y - 25) / 21));
  }
  // Грудные мышцы и пупок — тенью.
  for (let x = -12; x <= 12; x++) {
    if (Math.abs(x) < 2) continue;
    p.set(cx + x, 33 + Math.round(Math.abs(x) / 5), B.sh);
  }
  p.set(cx, 43, B.dk);
  // Ожерелье из золотых бляшек.
  for (let x = -11; x <= 11; x += 2) {
    const y = 27 + Math.round((x / 11) ** 2 * 3);
    p.set(cx + x, y, x % 4 === 0 ? GOLD.hi : GOLD.mid);
    p.set(cx + x, y + 1, GOLD.dk);
  }
  // Печать на груди: круг с глазом; горит золотом, когда идол уязвим.
  const cr = 5;
  for (let y = -cr; y <= cr; y++)
    for (let x = -cr; x <= cr; x++) {
      const d = Math.hypot(x, y);
      if (d > cr + 0.3) continue;
      const rim = d > cr - 1.2;
      const c = rim ? (core ? GOLD.mid : B.dk) : core ? mix(GOLD.hi, GOLD.mid, d / cr) : B.deep;
      p.set(cx + x, 37 + y, c);
    }
  p.rect(cx - 2, 37, cx + 2, 37, core ? WHITE : B.sh);
  p.set(cx, 36, core ? GOLD.hi : B.sh);
  p.set(cx, 38, core ? GOLD.hi : B.sh);
  // Руки: плечо, локоть, предплечье на колене, кисть свисает с колена.
  for (const s of [-1, 1]) {
    const raised = arm === s && !slam;
    const slammed = arm === s && slam;
    const shx = cx + s * 18;
    basaltEll(p, shx, 29, 5, 4.5);
    if (raised) {
      // Замах: рука вверх, кулак над плечом.
      basaltRect(p, shx - 3 + s * 2, 8, shx + 3 + s * 2, 28);
      basaltEll(p, shx + s * 3, 7, 5.5, 4.5);
      p.line(shx + s * 3 - 3, 7, shx + s * 3 + 3, 7, B.deep);
      p.line(shx - 3 + s * 2, 20, shx + 3 + s * 2, 20, B.dk);
      continue;
    }
    basaltRect(p, shx - 3, 30, shx + 3, 42);
    p.line(shx - 3, 42, shx + 3, 42, B.dk);
    // Предплечье — к колену.
    const hx = cx + s * (slammed ? 16 : 12);
    const hy = slammed ? g - 6 : 47;
    for (let t = 0; t <= 1; t += 0.1) {
      const x = Math.round(shx + (hx - shx) * t);
      const y = Math.round(42 + (hy - 3 - 42) * t);
      basaltRect(p, x - 3, y, x + 3, y + 3);
    }
    // Кисть: пальцы на колене.
    basaltRect(p, hx - 4, hy - 1, hx + 4, hy + 3);
    for (let fx = -3; fx <= 3; fx += 2) p.line(hx + fx, hy, hx + fx, hy + 3, B.deep);
    p.rect(hx - 4, hy - 1, hx + 4, hy - 1, GOLD.dk);
  }
  // Шея и голова.
  basaltRect(p, cx - 5, 21, cx + 5, 27);
  p.line(cx - 5, 26, cx + 5, 26, B.dk);
  for (const s of [-1, 1]) {
    // Уши с вытянутыми мочками и золотой серьгой.
    basaltRect(p, cx + s * 12 - 2, 11, cx + s * 12 + 1, 23);
    p.set(cx + s * 12, 24, GOLD.mid);
    p.set(cx + s * 12, 25, GOLD.hi);
  }
  basaltEll(p, cx, 14.5, 11, 10);
  basaltRect(p, cx - 8, 19, cx + 8, 24);
  // Подбородок сужается.
  for (let y = 22; y <= 24; y++) {
    erase(p, cx - 8 + (y - 22), y);
    erase(p, cx + 8 - (y - 22), y);
  }
  // Венец: золотой обод и пять зубцов, средний выше.
  p.rect(cx - 11, 5, cx + 11, 7, GOLD.mid);
  p.rect(cx - 11, 5, cx + 11, 5, GOLD.hi);
  p.rect(cx - 11, 7, cx + 11, 7, GOLD.dk);
  for (const [dx, h] of [
    [-10, 3],
    [-5, 4],
    [0, 6],
    [5, 4],
    [10, 3],
  ]) {
    for (let i = 0; i < h; i++) {
      const w = Math.max(0, Math.round((h - i) * 0.35));
      p.rect(cx + dx - w, 4 - i, cx + dx + w, 4 - i, i === h - 1 ? GOLD.hi : GOLD.mid);
    }
  }
  p.set(cx, 6, EYE_RED);
  // Тяжёлая бровь.
  p.rect(cx - 9, 10, cx + 9, 10, B.dk);
  p.rect(cx - 8, 11, cx + 8, 11, B.sh);
  // Глазницы-миндалины и свет в них.
  const ec = idolEyesColor(eyes, pulse);
  for (const s of [-1, 1]) {
    const ex = cx + s * 5;
    for (let x = -3; x <= 3; x++)
      for (let y = -1; y <= 1; y++) {
        if (Math.abs(x) === 3 && y !== 0) continue;
        p.set(ex + x, 13 + y, B.deep);
      }
    if (ec) {
      p.rect(ex - 1, 12, ex + 1, 14, ec);
      p.set(ex, 13, mix(ec, WHITE, 0.7));
    } else p.set(ex, 13, B.sh);
  }
  // Третий глаз на лбу — щель, горит во время взора.
  p.rect(cx, 7, cx, 9, eyes === 'gaze' || eyes === 'wrath' ? EYE_RED : B.deep);
  // Нос.
  p.rect(cx, 13, cx, 17, B.hi);
  p.set(cx - 1, 18, B.deep);
  p.set(cx + 1, 18, B.deep);
  // УЛЫБКА: широкая резная дуга от уха до уха, с зубами. Её видно издалека.
  for (let x = -9; x <= 9; x++) {
    const k = (x / 9) ** 2;
    const y = 21 - Math.round(k * 3);
    const thick = Math.abs(x) < 6 ? 2 : 1;
    for (let t = 0; t < thick; t++) p.set(cx + x, y + t, B.deep);
    if (Math.abs(x) < 7 && x % 2 === 0) p.set(cx + x, y, hex('#d8d0b8'));
  }
  p.set(cx - 10, 17, B.dk);
  p.set(cx + 10, 17, B.dk);
  // Скулы — блик.
  p.set(cx - 6, 16, B.hi);
  p.set(cx - 7, 17, B.lit);
  // Трещины от разбитых стражей.
  for (let i = 0; i < Math.min(cracks, IDOL_CRACKS.length); i++) {
    const c = IDOL_CRACKS[i];
    for (let k = 0; k < c.length - 1; k++)
      p.line(c[k][0], c[k][1], c[k + 1][0], c[k + 1][1], B.deep);
  }
  p.outline(INK);
  // Лучи из глаз во время взора — поверх контура.
  if (eyes === 'gaze')
    for (const s of [-1, 1]) {
      const ex = cx + s * 5;
      for (let i = 1; i <= 4; i++) p.set(ex + s * i, 13 + i, mix(EYE_RED, WHITE, 0.45));
    }
  return p;
}

function idolKey(
  e: IdolEyes,
  pulse: number,
  core: boolean,
  arm: number,
  slam: boolean,
  cracks: number,
  broken: boolean,
): string {
  return `${e}|${pulse}|${core ? 1 : 0}|${arm}|${slam ? 1 : 0}|${cracks}|${broken ? 1 : 0}`;
}

const idolPx = new Map<string, Px>();
function idolImage(
  e: IdolEyes,
  pulse: number,
  core: boolean,
  arm: number,
  slam: boolean,
  cracks: number,
  broken: boolean,
): Px {
  const k = idolKey(e, pulse, core, arm, slam, cracks, broken);
  let p = idolPx.get(k);
  if (!p) {
    p = paintIdol(e, pulse / 3, core, arm, slam, cracks, broken);
    idolPx.set(k, p);
  }
  return p;
}

registerMobPainter('f4_idol', (m, pose) => {
  const st = m.data.st ?? 0;
  const dying = pose.anim === 'dead';
  const eyes: IdolEyes = dying
    ? 'off'
    : st === 1
      ? 'rule'
      : st === 3
        ? 'gaze'
        : st === 2 || st === 4
          ? 'spent'
          : st === 5
            ? 'wrath'
            : 'dim';
  const pulse = eyes === 'rule' || eyes === 'gaze' ? mod(pose.t * 8 + (m.data.stK ?? 0) * 6, 4) : 0;
  const core = !dying && (st === 2 || st === 4);
  const slamT = m.data.slamT ?? 0;
  const arm = slamT > 0 ? (m.data.slamSide ?? 1) : 0;
  const slam = slamT > 0 && slamT < 0.22;
  const cracks = Math.min(6, (m.data.cracks ?? 0) + (m.data.phase ?? 0));
  const key = `id|${idolKey(eyes, pulse, core, arm, slam, cracks, dying)}|${pose.flash ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let px = idolImage(eyes, pulse, core, arm, slam, cracks, dying);
  if (pose.flash) px = px.tint(WHITE, 0.7);
  const out: MobFrame = { img: px.canvas(), ax: ID_CX, ay: ID_G, eye: null };
  cache.set(key, out);
  return out;
});

// ---------------------------------------------------------------------------
// Снаряды, лучи, плиты, кара.
// ---------------------------------------------------------------------------

registerShotPainter('f4_gravefire', (s: Shot, time: number) => {
  const f = mod(time * 12 + s.id, 3);
  const key = `gf|${f}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const p = new Px(10, 10);
  // Зелёный череп в огне: огонь хвостом назад, череп светлый.
  p.ell(5, 5, 3.6, 3.2, GREEN.dk);
  p.ell(5, 4.5, 2.6, 2.4, GREEN.mid);
  p.rect(3, 3, 6, 5, GREEN.hi);
  p.set(4, 4, ROBE.deep);
  p.set(6, 4, ROBE.deep);
  p.set(5, 6, ROBE.deep);
  p.set(1 + f, 1, GREEN.mid);
  p.set(8 - f, 2, GREEN.dk);
  p.outline(hex('#0c2a12'));
  const out = { img: p.canvas(), ax: 5, ay: 5 };
  sprites.set(key, out);
  return out;
});

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

// ---------------------------------------------------------------------------
// Предметы этажа.
// ---------------------------------------------------------------------------

function propSprite(key: string, make: () => Px, ay?: number): Sprite {
  const hit = sprites.get(key);
  if (hit) return hit;
  const p = make();
  const out = { img: p.canvas(), ax: p.w / 2, ay: ay ?? p.h };
  sprites.set(key, out);
  return out;
}

/** Саркофаг на две клетки: крышка с изваянием лежащего, бок с панелями. */
function sarcPx(): Px {
  const p = new Px(32, 16);
  // Бок: камень с резными панелями, в середине — череп.
  for (let y = 7; y <= 15; y++)
    for (let x = 1; x <= 30; x++) p.set(x, y, stoneAt(x, y, (y - 7) / 9, false));
  p.rect(1, 7, 30, 7, STONE.hi);
  p.rect(1, 15, 30, 15, STONE.dk);
  for (const x0 of [3, 21]) {
    p.rect(x0, 9, x0 + 7, 13, STONE.sh);
    p.rect(x0 + 1, 10, x0 + 6, 12, STONE.dk);
  }
  p.rect(14, 9, 17, 12, BONE.mid);
  p.set(14, 11, BONE.hole);
  p.set(16, 11, BONE.hole);
  p.rect(15, 13, 16, 13, BONE.sh);
  // Крышка сверху.
  for (let y = 1; y <= 6; y++)
    for (let x = 0; x <= 31; x++) p.set(x, y, stoneAt(x, y, y / 6, false));
  p.rect(0, 1, 31, 1, STONE.hi);
  p.rect(0, 6, 31, 6, STONE.sh);
  // Изваяние: голова на подушке, сложенные на груди руки, ступни.
  p.rect(2, 2, 4, 5, STONE.sh);
  p.ell(6.5, 3.6, 2, 1.6, STONE.hi);
  p.rect(9, 2, 24, 5, STONE.mid);
  p.rect(9, 2, 24, 2, STONE.hi);
  p.rect(13, 3, 16, 4, STONE.hi);
  p.set(14, 3, STONE.sh);
  p.line(9, 5, 24, 5, STONE.sh);
  p.rect(26, 2, 27, 3, STONE.hi);
  p.rect(26, 4, 27, 5, STONE.hi);
  p.outline(INK);
  return p;
}

/** Половина большой картинки: левая или правая клетка саркофага. */
function half(src: Px, right: boolean): Px {
  const p = new Px(16, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < 16; x++) {
      const c = src.get(x + (right ? 16 : 0), y);
      if (c[3]) p.set(x, y, c);
    }
  return p;
}

function candlesPx(f: number): Px {
  const p = new Px(12, 12);
  const wax = hex('#e6dcc0');
  const waxD = hex('#b8aa88');
  for (const [x, h] of [
    [2, 5],
    [5, 8],
    [8, 4],
  ] as [number, number][]) {
    p.rect(x, 11 - h, x + 1, 11, wax);
    p.set(x + 1, 11 - h + 1, waxD);
    p.set(x, 11, waxD);
    const fl = (f + x) % 3;
    p.set(x, 10 - h, hex('#ffd76a'));
    p.set(x + (fl === 1 ? 1 : 0), 9 - h, hex('#fff6c8'));
    if (fl === 2) p.set(x, 8 - h, hex('#ffb040'));
  }
  // Лужица воска.
  p.rect(1, 11, 10, 11, waxD);
  p.outline(INK);
  return p;
}

function urnPx(): Px {
  const p = new Px(10, 13);
  const c = hex('#7a5a3a');
  const d = hex('#4a321e');
  const l = hex('#a8804e');
  p.ell(5, 7.5, 4, 4, c);
  p.ell(3.8, 6.5, 1.4, 2, l);
  p.rect(3, 1, 7, 3, c);
  p.rect(2, 1, 8, 1, l);
  p.rect(3, 11, 7, 12, d);
  p.set(7, 8, d);
  p.set(6, 10, d);
  p.rect(2, 5, 8, 5, GOLD.dk);
  p.outline(INK);
  return p;
}

function columnPx(): Px {
  const p = new Px(14, 42);
  for (let y = 5; y <= 37; y++)
    for (let x = 3; x <= 10; x++) {
      const rel = (x - 3) / 7;
      let c = stoneAt(x, y, rel, true);
      if (x === 5 || x === 8) c = STONE.sh; // каннелюры
      p.set(x, y, c);
    }
  // Капитель и база.
  for (const y0 of [1, 37])
    for (let y = y0; y <= y0 + 4; y++)
      for (let x = 1; x <= 12; x++) p.set(x, y, stoneAt(x, y, (x - 1) / 11, false));
  p.rect(1, 1, 12, 1, STONE.hi);
  p.rect(1, 41, 12, 41, STONE.dk);
  p.rect(1, 5, 12, 5, STONE.dk);
  p.outline(INK);
  return p;
}

function skullsPx(): Px {
  const p = new Px(18, 18);
  // Курган из костей, на нём черепа пирамидой — круглые, с зубами.
  for (let x = 1; x <= 16; x++) {
    const h = Math.round(4 - Math.abs(x - 8.5) * 0.35);
    for (let y = 17 - h; y <= 17; y++) p.set(x, y, (x + y) % 3 === 0 ? BONE.sh : BONE.dk);
  }
  bone(p, 2, 16, 8, 14);
  bone(p, 10, 14, 16, 16);
  const one = (x: number, y: number) => {
    p.map(
      ['.hhh.', 'hmmmm', 'mssms', 'mmmmm', '.tjt.'],
      { h: BONE.hi, m: BONE.mid, s: BONE.hole, t: BONE.sh, j: BONE.dk },
      x,
      y,
    );
  };
  for (const [x, y] of [
    [1, 9],
    [6, 10],
    [11, 9],
    [3, 5],
    [9, 5],
    [6, 1],
  ] as [number, number][])
    one(x, y);
  p.outline(INK);
  return p;
}

function rackPx(): Px {
  const p = new Px(14, 22);
  // Крестовина-стойка.
  p.rect(6, 6, 7, 21, WOOD.mid);
  p.rect(2, 21, 11, 21, WOOD.dk);
  p.rect(2, 9, 11, 9, WOOD.dk);
  // Кираса и шлем, ржавые.
  p.rect(3, 10, 10, 17, IRON.mid);
  p.rect(3, 10, 4, 17, IRON.hi);
  p.rect(9, 10, 10, 17, IRON.sh);
  p.set(6, 13, RUST.mid);
  p.set(8, 15, RUST.mid);
  p.rect(4, 1, 9, 6, IRON.mid);
  p.rect(4, 1, 5, 6, IRON.hi);
  p.rect(5, 4, 8, 4, IRON.dk);
  p.set(7, 2, RUST.mid);
  p.outline(INK);
  return p;
}

function coffinPx(): Px {
  const p = new Px(18, 12);
  // Открытый гроб: доски, внутри — темнота и кость.
  p.rect(1, 3, 16, 10, WOOD.mid);
  p.rect(1, 3, 16, 3, WOOD.hi);
  p.rect(3, 5, 14, 8, hex('#1a1210'));
  p.line(5, 7, 11, 6, BONE.mid);
  p.set(12, 6, BONE.hi);
  p.rect(1, 10, 16, 11, WOOD.dk);
  // Крышка сдвинута набок.
  p.rect(11, 0, 17, 2, WOOD.dk);
  p.rect(11, 0, 17, 0, WOOD.hi);
  p.outline(INK);
  return p;
}

function brazierPx(f: number): Px {
  const p = new Px(14, 18);
  // Ножки и чаша.
  p.line(3, 17, 5, 11, IRON.dk);
  p.line(10, 17, 8, 11, IRON.dk);
  p.rect(2, 9, 11, 11, IRON.mid);
  p.rect(2, 9, 11, 9, IRON.hi);
  p.rect(3, 12, 10, 12, IRON.sh);
  // Огонь — четыре кадра.
  const fire = [hex('#ffd76a'), hex('#ff9a3a'), hex('#e0462a')];
  for (let i = 0; i < 7; i++) {
    const w = Math.max(0, 3 - Math.floor(i / 2));
    const sway = ((f + i) % 4 === 0 ? 1 : (f + i) % 4 === 2 ? -1 : 0) * (i > 2 ? 1 : 0);
    p.rect(7 - w + sway, 8 - i, 6 + w + sway, 8 - i, fire[Math.min(2, Math.floor(i / 2.5))]);
  }
  p.set(6 + (f % 2), 1, hex('#e0462a'));
  p.rect(5, 8, 8, 8, hex('#fff6c8'));
  p.outline(INK);
  return p;
}

/** Скрижаль: каменная плита с письменами; горит, когда идол требует. */
function tabletPx(rule: string, pulse: number): Px {
  const p = new Px(16, 22);
  for (let y = 2; y <= 19; y++)
    for (let x = 2; x <= 13; x++) {
      if (y < 5 && Math.hypot(x - 7.5, y - 5) > 6) continue;
      p.set(x, y, stoneAt(x, y, (x - 2) / 11, false));
    }
  p.rect(1, 19, 14, 21, STONE.sh);
  p.rect(1, 19, 14, 19, STONE.hi);
  const glow: RGBA | null =
    rule === 'bow'
      ? GOLD.hi
      : rule === 'praise'
        ? hex('#d8f0ff')
        : rule === 'sheathe'
          ? hex('#ff6a4a')
          : rule === 'gaze'
            ? EYE_RED
            : null;
  const ink = glow ? mix(glow, WHITE, pulse * 0.4) : STONE.dk;
  // Строки письмен.
  for (let r = 0; r < 4; r++) {
    const y = 7 + r * 3;
    for (let x = 4; x <= 11; x++) if ((x * 5 + r * 3) % 4 !== 0) p.set(x, y, ink);
  }
  // Знак заповеди поверх письмен.
  if (rule === 'bow') {
    p.line(5, 5, 7, 7, ink);
    p.line(10, 5, 8, 7, ink);
  } else if (rule === 'praise') {
    p.rect(5, 5, 10, 5, ink);
    p.set(7, 4, ink);
    p.set(8, 4, ink);
  } else if (rule === 'sheathe') {
    p.line(5, 4, 10, 9, ink);
    p.line(10, 4, 5, 9, ink);
  }
  p.outline(INK);
  return p;
}

/** Мёртвая статуя на постаменте — ровно как живой страж в покое. */
const deadStatue = (gold: boolean) => paintStatue(0, 0, false, false, false, gold);

registerPropPainter('f4_sarcL', () => propSprite('sarcL', () => half(sarcPx(), false)));
registerPropPainter('f4_sarcR', () => propSprite('sarcR', () => half(sarcPx(), true)));
registerPropPainter('f4_candle', (_o, time) => {
  const f = mod(time * 6, 3);
  return propSprite(`cand|${f}`, () => candlesPx(f));
});
registerPropPainter('f4_urn', (_o, _t, _alive, flash) =>
  propSprite(`urn|${flash ? 1 : 0}`, () => (flash ? urnPx().tint(WHITE, 0.8) : urnPx())),
);
registerPropPainter('f4_column', () => propSprite('col', columnPx));
registerPropPainter('f4_skulls', () => propSprite('skulls', skullsPx));
registerPropPainter('f4_rack', () => propSprite('rack', rackPx));
registerPropPainter('f4_coffin', () => propSprite('coffin', coffinPx));
registerPropPainter('f4_brazier', (_o, time) => {
  const f = mod(time * 8, 4);
  return propSprite(`braz|${f}`, () => brazierPx(f));
});
registerPropPainter('f4_statue', () => propSprite('statue', () => deadStatue(false), ST_G + 6));
registerPropPainter('f4_sped', () => null);
registerPropPainter('f4_astat', () => {
  if (F4_VIEW.idol === 'fight') return null;
  if (F4_VIEW.idol === 'broken') return propSprite('astatR', () => paintRubble(true), ST_G + 6);
  return propSprite('astat', () => deadStatue(true), ST_G + 6);
});
registerPropPainter('f4_idol', () => {
  if (F4_VIEW.idol === 'fight') return null;
  const broken = F4_VIEW.idol === 'broken';
  return propSprite(
    `idol|${broken ? 1 : 0}`,
    () => idolImage('off', 0, false, 0, false, 0, broken),
    ID_G + 6,
  );
});
registerPropPainter('f4_tablet', (_o, time) => {
  const rule = F4_VIEW.rule;
  const pulse = rule ? mod(time * 6, 3) : 0;
  return propSprite(`tab|${rule}|${pulse}`, () => tabletPx(rule, pulse / 3));
});

// ---------------------------------------------------------------------------
// Свои клетки: кости на полу, надгробные плиты, дорожка, трещины,
// постаменты, помост, плиты света, ниши в стенах, барельефы.
// ---------------------------------------------------------------------------

const cells = new Map<string, Px>();
function cellPx(key: string, make: () => Px): Px {
  let p = cells.get(key);
  if (!p) {
    p = make();
    cells.set(key, p);
  }
  return p;
}

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

function bonesCell(v: number): Px {
  const p = new Px(TS, TS);
  const r = (n: number) => ((v >> n) & 7) / 7;
  bone(p, 2 + r(0) * 3, 10 + r(3) * 3, 8 + r(6) * 3, 8 + r(9) * 2);
  bone(p, 9, 12 + r(12) * 2, 13, 13 - r(15) * 3);
  if (v % 3 === 0) {
    p.rect(4, 3, 6, 5, BONE.mid);
    p.set(4, 4, BONE.hole);
    p.set(6, 4, BONE.hole);
  }
  p.set(11, 5, BONE.sh);
  p.set(12, 5, BONE.dk);
  return p;
}

function graveCell(v: number): Px {
  const p = new Px(TS, TS);
  const slab = hex('#5a5c54');
  const edge = hex('#34362f');
  const hi = hex('#7a7c70');
  p.rect(2, 1, 13, 14, slab);
  p.rect(2, 1, 13, 1, hi);
  p.rect(2, 14, 13, 14, edge);
  p.rect(13, 1, 13, 14, edge);
  // Высеченный знак: крест или руна.
  if (v % 2 === 0) {
    p.rect(7, 3, 8, 11, edge);
    p.rect(5, 5, 10, 6, edge);
  } else {
    p.line(5, 4, 10, 9, edge);
    p.line(10, 4, 5, 9, edge);
    p.rect(5, 11, 10, 11, edge);
  }
  return p;
}

function carpetCell(c: CellCtx): Px {
  const l = c.markAt(-1, 0) !== F4_MARK.carpet;
  const r = c.markAt(1, 0) !== F4_MARK.carpet;
  const key = `carp|${l ? 1 : 0}|${r ? 1 : 0}|${c.wy & 1}`;
  return cellPx(key, () => {
    const p = new Px(TS, TS);
    const red = hex('#5e2020', 225);
    const redL = hex('#7a2c26', 225);
    p.rect(0, 0, 15, 15, red);
    for (let y = c.wy & 1; y < 16; y += 4) p.rect(0, y, 15, y, redL);
    if (l) p.rect(0, 0, 1, 15, hex('#8a6a20', 235));
    if (r) p.rect(14, 0, 15, 15, hex('#8a6a20', 235));
    return p;
  });
}

function crackCell(v: number): Px {
  const p = new Px(TS, TS);
  const d = hex('#161412', 200);
  let x = 3 + (v % 5);
  let y = 2;
  while (y < 14) {
    p.set(x, y, d);
    y += 1;
    x += ((v >> y) & 1) === 0 ? 1 : -1;
    if (((v >> (y + 3)) & 3) === 0) p.set(x + 1, y, d);
  }
  return p;
}

/** Постамент статуи: квадратная плита в три четверти. */
function plinthCell(): Px {
  const p = new Px(TS, TS);
  for (let y = 2; y <= 10; y++)
    for (let x = 1; x <= 14; x++) p.set(x, y, stoneAt(x, y, (x - 1) / 13, false));
  p.rect(1, 2, 14, 2, STONE.hi);
  p.rect(1, 11, 14, 14, STONE.sh);
  p.rect(1, 14, 14, 14, STONE.dk);
  p.rect(1, 2, 1, 14, STONE.dk);
  p.rect(14, 2, 14, 14, STONE.dk);
  return p;
}

function daisCell(c: CellCtx): Px {
  const top = c.markAt(0, -1) !== F4_MARK.dais;
  const bottom = c.markAt(0, 1) !== F4_MARK.dais;
  const l = c.markAt(-1, 0) !== F4_MARK.dais;
  const r = c.markAt(1, 0) !== F4_MARK.dais;
  const key = `dais|${top ? 1 : 0}${bottom ? 1 : 0}${l ? 1 : 0}${r ? 1 : 0}|${(c.wx + c.wy) & 1}`;
  return cellPx(key, () => {
    const p = new Px(TS, TS);
    const a = hex('#45473f');
    const b = hex('#3c3e37');
    p.rect(0, 0, 15, 15, (c.wx + c.wy) & 1 ? a : b);
    p.rect(0, 0, 15, 0, hex('#585a50'));
    // Золотая вставка по узору.
    if (((c.wx + c.wy) & 1) === 0) {
      p.set(7, 7, GOLD.dk);
      p.set(8, 8, GOLD.dk);
    }
    if (bottom) {
      p.rect(0, 12, 15, 15, hex('#24251f'));
      p.rect(0, 12, 15, 12, hex('#6e7064'));
      p.rect(0, 13, 15, 13, GOLD.dk);
    }
    if (l) p.rect(0, 0, 0, 15, hex('#24251f'));
    if (r) p.rect(15, 0, 15, 15, hex('#24251f'));
    void top;
    return p;
  });
}

/** Плита света 2×2: высеченный круг с руной; каждая клетка рисует свою четверть. */
function plateCell(c: CellCtx): Px {
  const left = c.markAt(-1, 0) !== F4_MARK.plate;
  const top = c.markAt(0, -1) !== F4_MARK.plate;
  const key = `plate|${left ? 1 : 0}${top ? 1 : 0}`;
  return cellPx(key, () => {
    const p = new Px(TS, TS);
    // Центр плиты — угол клетки, общий для четырёх.
    const ox = left ? TS : 0;
    const oy = top ? TS : 0;
    const groove = hex('#23262a', 230);
    const face = hex('#6a7078', 200);
    const rune = hex('#9ab4c8', 230);
    for (let y = 0; y < TS; y++)
      for (let x = 0; x < TS; x++) {
        const d = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
        if (d < 13.5) p.set(x, y, face);
        if (d >= 13.5 && d < 15) p.set(x, y, groove);
        if (d >= 8 && d < 9) p.set(x, y, groove);
        if (d >= 9 && d < 10 && (x + y) % 3 === 0) p.set(x, y, rune);
      }
    // Рамка плиты.
    if (left) p.rect(0, 0, 0, 15, groove);
    else p.rect(15, 0, 15, 15, groove);
    if (top) p.rect(0, 0, 15, 0, groove);
    else p.rect(0, 15, 15, 15, groove);
    return p;
  });
}

/** Погребальная ниша на лицевой грани стены: арка, в ней кости или гроб. */
function nicheCell(coffin: boolean, v: number): Px {
  const p = new Px(TS, TS);
  const dark = hex('#0e0a0a');
  const rim = hex('#6a6258');
  for (let y = 4; y <= 14; y++)
    for (let x = 3; x <= 12; x++) {
      if (y < 7 && Math.hypot(x + 0.5 - 8, y - 7) > 5) continue;
      p.set(x, y, dark);
    }
  for (let x = 3; x <= 12; x++) p.set(x, 14, rim);
  p.line(2, 7, 2, 14, rim);
  p.line(13, 7, 13, 14, rim);
  if (coffin) {
    p.rect(4, 10, 11, 13, WOOD.mid);
    p.rect(4, 10, 11, 10, WOOD.hi);
    p.rect(11, 10, 11, 13, WOOD.dk);
  } else {
    p.line(4, 13, 10, 12, BONE.mid);
    p.set(3 + (v % 3), 12, BONE.sh);
    p.rect(8, 9, 10, 11, BONE.mid);
    p.set(8, 10, BONE.hole);
    p.set(10, 10, BONE.hole);
  }
  return p;
}

/** Барельеф: высеченный глаз в круге — знак идола. */
function reliefCell(v: number): Px {
  const p = new Px(TS, TS);
  const cut = hex('#1e1c1a', 210);
  const hi = hex('#8a8474', 200);
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d >= 5 && d < 6) p.set(x, y, cut);
      if (d >= 6 && d < 6.8 && y < 8) p.set(x, y, hi);
    }
  p.rect(5, 8, 10, 8, cut);
  p.rect(7, 7, 8, 9, cut);
  if (v % 4 === 0) p.set(8, 8, hex('#8a6a20'));
  return p;
}

function cellPainter(c: CellCtx): Px | null {
  const v = hash(c.wx, c.wy);
  switch (c.mark) {
    case F4_MARK.bones:
      return cellPx(`bones|${v % 8}`, () => bonesCell(v % 8 === 0 ? 3 : v));
    case F4_MARK.grave:
      return cellPx(`grave|${v % 2}`, () => graveCell(v));
    case F4_MARK.carpet:
      return carpetCell(c);
    case F4_MARK.crack:
      return cellPx(`crack|${v % 6}`, () => crackCell(v % 6));
    case F4_MARK.plinth:
      return cellPx('plinth', plinthCell);
    case F4_MARK.dais:
      return daisCell(c);
    case F4_MARK.plate:
      return plateCell(c);
    case F4_MARK.niche:
      return cellPx(`niche|${v % 3}`, () => nicheCell(false, v % 3));
    case F4_MARK.coffin:
      return cellPx('coffin', () => nicheCell(true, 0));
    case F4_MARK.relief:
      return cellPx(`relief|${v % 4 === 0 ? 1 : 0}`, () => reliefCell(v % 4 === 0 ? 0 : 1));
  }
  return null;
}

registerCellPainter('f4crypt', cellPainter);
registerCellPainter('f4sanct', cellPainter);

// ---------------------------------------------------------------------------
// Иконки вещей 10×10.
// ---------------------------------------------------------------------------

registerItemArt('f4_bone', () => {
  const p = new Px(10, 10);
  bone(p, 2, 7, 7, 2);
  p.set(1, 7, BONE.hi);
  p.set(2, 8, BONE.mid);
  p.set(7, 1, BONE.hi);
  p.set(8, 2, BONE.mid);
  p.outline(INK);
  return p;
});
registerItemArt('f4_iron', () => {
  const p = new Px(10, 10);
  p.rect(2, 2, 7, 8, IRON.mid);
  p.rect(2, 2, 3, 8, IRON.hi);
  p.rect(6, 2, 7, 8, IRON.sh);
  p.set(4, 4, RUST.mid);
  p.set(5, 6, RUST.mid);
  p.set(3, 7, RUST.dk);
  p.outline(INK);
  return p;
});
registerItemArt('f4_page', () => {
  const p = new Px(10, 10);
  p.rect(2, 1, 7, 8, hex('#d8c8a0'));
  p.rect(2, 1, 7, 1, hex('#f0e4c0'));
  for (let y = 3; y <= 7; y += 2) p.rect(3, y, 6, y, GREEN.dk);
  p.set(6, 3, GREEN.mid);
  p.outline(INK);
  return p;
});
registerItemArt('f4_shard', () => {
  const p = new Px(10, 10);
  p.line(2, 8, 5, 1, STONE.hi);
  p.rect(3, 4, 6, 8, STONE.mid);
  p.set(7, 7, STONE.sh);
  p.set(6, 3, STONE.mid);
  p.set(4, 6, EYE_RED);
  p.outline(INK);
  return p;
});
registerItemArt('f4_eye', () => {
  const p = new Px(10, 10);
  p.ell(5, 5, 4, 3, STONE.mid);
  p.ell(5, 5, 2.4, 1.6, EYE_AMBER);
  p.rect(4, 5, 6, 5, GOLD.hi);
  p.set(3, 3, STONE.hi);
  p.outline(INK);
  return p;
});
registerItemArt('f4_ration', () => {
  const p = new Px(10, 10);
  p.rect(1, 4, 8, 8, hex('#8a6a44'));
  p.rect(1, 4, 8, 4, hex('#b08a5a'));
  p.rect(4, 3, 5, 8, hex('#5a3a22'));
  p.set(2, 6, hex('#d8b880'));
  p.outline(INK);
  return p;
});

// Пустые обращения — чтобы импорт типов не терялся при чистке.
export type { Mob, WorldObj };
