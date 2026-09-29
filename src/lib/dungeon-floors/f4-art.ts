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
  frameLRU,
  MOB_PAINTERS,
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
// Анимация (v2.85): кривые, кванты, кеш кадров, память рисовальщика.
// ---------------------------------------------------------------------------

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Доля отрезка времени [a, b], в котором сейчас t. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const eIn = (k: number) => k * k * k;
const eOut = (k: number) => 1 - (1 - k) ** 3;
const eInOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
/** Выход с перелётом: к 1 через 1,1 — тяжёлое тело доезжает дальше и возвращается. */
const eBack = (k: number, s = 1.7) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2;
/** Квант 24 к/с, отсчитанный от `at`: кадр контакта начинается ровно в миг урона. */
const q24 = (t: number, at = 0) => at + Math.floor((t - at) * 24 + 1e-6) / 24;
const qf = (t: number, fps: number) => Math.floor(t * fps + 1e-6) / fps;
/** Число в ступень 1/n — ключ кеша не дробится на лишние кадры. */
const stepN = (x: number, n: number) => Math.round(clamp01(x) * n);

/** Px со сдвигом: рисуем в координатах прежнего холста, а лежит в большем. */
class OPx extends Px {
  readonly ox: number;
  readonly oy: number;
  constructor(w: number, h: number, ox: number, oy: number) {
    super(w, h);
    this.ox = ox;
    this.oy = oy;
  }
  override set(x: number, y: number, c: RGBA | null): void {
    super.set(x + this.ox, y + this.oy, c);
  }
  /** Сплошное ли в координатах рисунка. */
  at(x: number, y: number): boolean {
    return this.solid(Math.round(x) + this.ox, Math.round(y) + this.oy);
  }
  wipe(x: number, y: number): void {
    erase(this, Math.round(x) + this.ox, Math.round(y) + this.oy);
  }
}

/** Контур снаружи фигуры — прямо по данным (у `OPx` свой `set` со сдвигом). */
function outlineRaw(p: Px, c: RGBA): void {
  const { w, h, data } = p;
  const add: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]) continue;
      if (
        (x > 0 && data[(y * w + x - 1) * 4 + 3]) ||
        (x < w - 1 && data[(y * w + x + 1) * 4 + 3]) ||
        (y > 0 && data[((y - 1) * w + x) * 4 + 3]) ||
        (y < h - 1 && data[((y + 1) * w + x) * 4 + 3])
      )
        add.push((y * w + x) * 4);
    }
  for (const i of add) {
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  }
}

/** Перенести непрозрачное из `src` (того же размера) со сдвигом. */
function blit(dst: Px, src: Px, dx: number, dy: number, box: number[]): void {
  const [x0, y0, x1, y1] = box;
  const w = dst.w;
  for (let y = y0; y <= y1; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      const a = src.data[i + 3];
      if (!a) continue;
      const tx = x + dx;
      if (tx < 0 || tx >= w) continue;
      const j = (ty * w + tx) * 4;
      if (a === 255) {
        dst.data[j] = src.data[i];
        dst.data[j + 1] = src.data[i + 1];
        dst.data[j + 2] = src.data[i + 2];
        dst.data[j + 3] = 255;
      } else
        Px.prototype.set.call(dst, tx, ty, [
          src.data[i],
          src.data[i + 1],
          src.data[i + 2],
          a,
        ] as RGBA);
    }
  }
}

/** Рамка непрозрачного: чтобы переносить только её. */
function boxOf(p: Px): number[] {
  let x0 = p.w;
  let y0 = p.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++)
      if (p.data[(y * p.w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? [0, 0, -1, -1] : [x0, y0, x1, y1];
}

/** Частичная ломаная: трещина растёт от первой точки, `k` — доля длины. */
function polyPart(p: Px, pts: number[][], k: number, dx: number, dy: number, c: RGBA): void {
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * clamp01(k);
  for (let i = 1; i < pts.length && left > 0; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    const f = Math.min(1, left / l);
    p.line(ax + dx, ay + dy, ax + dx + (bx - ax) * f, ay + dy + (by - ay) * f, c);
    left -= l;
  }
}

/** Где кончается растущая трещина — там искрит. */
function polyTip(pts: number[][], k: number): [number, number] {
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  let left = total * clamp01(k);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const l = Math.hypot(bx - ax, by - ay);
    if (left <= l) return [ax + ((bx - ax) * left) / l, ay + ((by - ay) * left) / l];
    left -= l;
  }
  return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
}

// ---------------------------------------------------------------------------
// Статуя-страж: каменный воин с двуручным мечом. Риг: ноги, юбка, кираса с
// наплечниками, шлем, руки и меч — позы ключами, между ними — кривые.
// ---------------------------------------------------------------------------

/** Прежний холст статуи (груда `paintRubble` и сборка стража держатся за него). */
const ST_W = 22;
const ST_H = 32;
const ST_CX = 10;
export const ST_G = 30;
/** Холст живой статуи — шире и выше: меч над головой, дуга удара, распад. */
const SA_OX = 10;
const SA_OY = 10;
const SA_W = 40;
const SA_H = 44;
const SA_AX = ST_CX + SA_OX;
const SA_AY = ST_G + SA_OY;

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

/** Поза статуи. Координаты — прежнего холста 22×32 (x вправо — вперёд). */
interface StatueRig {
  /** Сдвиг корпуса (выпад — вперёд, присед — вниз). */
  bx: number;
  by: number;
  /** Верх корпуса ещё вперёд (наклон). */
  lean: number;
  kneel: number;
  /** Ступни: задняя и передняя (x), подъём ступни на шаге. */
  fb: number;
  ff: number;
  lb: number;
  lf: number;
  /** Юбка отстаёт от шага. */
  sway: number;
  /** Рукоять (обе кисти) и угол клинка. */
  gx: number;
  gy: number;
  sa: number;
  /** Свободная рука тянется вперёд (0 — обе на рукояти). */
  reach: number;
  hx: number;
  hy: number;
  eyes: number;
  crumbs: number[];
  /** След меча: угол от, угол до, яркость. */
  smear: number[] | null;
  gold: boolean;
  cracks: number;
}

const sr = (o: Partial<StatueRig>): StatueRig => ({
  bx: 0,
  by: 0,
  lean: 0,
  kneel: 0,
  fb: 0,
  ff: 0,
  lb: 0,
  lf: 0,
  sway: 0,
  gx: 16,
  gy: 14,
  sa: Math.PI / 2,
  reach: 0,
  hx: 0,
  hy: 0,
  eyes: 0,
  crumbs: [],
  smear: null,
  gold: false,
  cracks: 0,
  ...o,
});

/** Ключевые позы. `rest` — статуя на постаменте (как прежний покой). */
const SP = {
  rest: sr({ gx: 16, gy: 14, sa: Math.PI / 2, hy: 1 }),
  /** Застыла 0: стойка — меч наискось перед собой, колени согнуты. */
  guard: sr({ by: 1, fb: -1, ff: 2, gx: 14, gy: 17, sa: -0.95, lean: 0 }),
  /** Застыла 1: меч над головой. */
  high: sr({ by: 0, lean: -1, fb: -2, ff: 2, gx: 11, gy: 3, sa: -Math.PI / 2 - 0.35, hy: 0 }),
  /** Застыла 2: выпад вперёд. */
  lunge: sr({ bx: 1, by: 1, lean: 2, fb: -3, ff: 4, gx: 17, gy: 16, sa: 0.05 }),
  /** Застыла 3: тянется когтями, меч волочится позади. */
  claw: sr({ lean: 1, fb: -2, ff: 2, gx: 5, gy: 18, sa: 2.35, reach: 1 }),
  /** Замах: меч за головой, корпус откинут. */
  wind: sr({ by: -1, lean: -1, fb: -2, ff: 3, gx: 9, gy: 2, sa: -Math.PI / 2 - 0.7, hy: -1 }),
  /** Удар: остриё в пол перед собой, корпус в выпаде. */
  hit: sr({ bx: 2, by: 1, lean: 2, fb: -3, ff: 4, gx: 18, gy: 19, sa: 0.62, hy: 1 }),
  /** На колене перед взором идола. */
  bow: sr({ kneel: 1, gx: 15, gy: 16, sa: Math.PI / 2, hy: 1 }),
};
const FROZEN = [SP.guard, SP.high, SP.lunge, SP.claw];

function mixStatue(a: StatueRig, b: StatueRig, k: number): StatueRig {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const o = { ...b };
  for (const key of [
    'bx',
    'by',
    'lean',
    'kneel',
    'fb',
    'ff',
    'lb',
    'lf',
    'sway',
    'gx',
    'gy',
    'reach',
    'hx',
    'hy',
    'eyes',
  ] as const)
    o[key] = lerp(a[key], b[key], k);
  // Угол — кратчайшим путём.
  let d = b.sa - a.sa;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  o.sa = a.sa + d * k;
  o.crumbs = [...a.crumbs, ...b.crumbs];
  o.smear = b.smear ?? a.smear;
  return o;
}

/** Трещины по камню стража — растут с его ранами (0…3). */
const STATUE_CRACKS: { on: 'torso' | 'helm' | 'skirt'; pts: number[][] }[] = [
  {
    on: 'skirt',
    pts: [
      [8, 21],
      [9, 25],
      [10, 26],
    ],
  },
  {
    on: 'torso',
    pts: [
      [11, 12],
      [9, 15],
      [11, 18],
    ],
  },
  {
    on: 'helm',
    pts: [
      [9, 4],
      [10, 7],
      [9, 9],
    ],
  },
  {
    on: 'torso',
    pts: [
      [6, 11],
      [8, 13],
      [7, 16],
    ],
  },
];

/** Рисунок статуи по позе — в холсте `SA_W×SA_H`. */
function paintStatueRig(r: StatueRig, hide = 0): OPx {
  const p = new OPx(SA_W, SA_H, SA_OX, SA_OY);
  paintStatueInto(p, r, 0, 0, hide);
  outlineRaw(p, INK);
  return p;
}

/** Части для сборки и распада: 1 — ноги, 2 — юбка, 4 — кираса, 8 — шлем, 16 — меч. */
const S_LEGS = 1;
const S_SKIRT = 2;
const S_TORSO = 4;
const S_HELM = 8;
const S_SWORD = 16;

function paintStatueInto(p: OPx, r: StatueRig, ox: number, oy: number, hide: number): void {
  const R = Math.round;
  const cx = ST_CX + ox;
  const g = ST_G + oy;
  const kneel = r.kneel >= 0.5;
  const down = R(r.kneel * 4);
  const bx = R(r.bx);
  const by = R(r.by) + down;
  const lean = R(r.lean);
  const top = 11 + by;
  const seam = STONE.dk;
  const gold = r.gold;
  const tone = (rel: number, x: number, y: number) =>
    rel < 0.28 ? STONE.hi : rel < 0.66 ? stoneAt(x, y, 0.5) : STONE.sh;
  // Ноги: поножи из-под юбки — шаг видно по ним.
  if (!(hide & S_LEGS)) {
    if (kneel) {
      for (let y = g - 3; y <= g; y++)
        for (let x = cx - 5 + bx; x <= cx + 5 + bx; x++)
          p.set(x, y, tone((x - cx - bx + 5) / 10, x, y));
      // Колено в пол, ступня позади.
      p.rect(cx + 3 + bx, g - 1, cx + 6 + bx, g, STONE.sh);
    } else {
      const fb = R(r.fb) + bx;
      const ff = R(r.ff) + bx;
      const lb = R(r.lb);
      const lf = R(r.lf);
      for (let y = g - 4 - Math.max(0, by); y <= g; y++) {
        if (y <= g - lb)
          for (let x = cx - 3 + fb; x <= cx - 1 + fb; x++) p.set(x, y - lb, STONE.mid);
        if (y <= g - lf)
          for (let x = cx + 1 + ff; x <= cx + 3 + ff; x++) p.set(x, y - lf, STONE.sh);
      }
    }
  }
  // Юбка: колокол со складками; низ отстаёт от шага.
  if (!(hide & S_SKIRT))
    for (let y = top + 8; y <= g - 3 + (kneel ? 1 : 0); y++) {
      const k = (y - top - 8) / Math.max(1, g - 3 - top - 8);
      const half = 4 + k * 2.2;
      const sw = R(r.sway * k);
      const x0 = R(cx - half + lean * 0.5 + bx + sw);
      const x1 = R(cx + half + lean * 0.5 + bx + sw);
      for (let x = x0; x <= x1; x++) {
        const rel = (x - x0) / Math.max(1, x1 - x0);
        p.set(x, y, (x - x0) % 3 === 1 && y > top + 9 ? STONE.sh : tone(rel, x, y));
      }
    }
  const L = lean + bx;
  if (!(hide & S_TORSO)) {
    // Кираса и пояс.
    for (let y = top + 1; y <= top + 8; y++)
      for (let x = cx - 4 + L; x <= cx + 4 + L; x++) p.set(x, y, tone((x - cx + 4 - L) / 8, x, y));
    p.rect(cx - 4 + L, top + 8, cx + 4 + L, top + 8, gold ? GOLD.dk : seam);
    p.line(cx + L, top + 3, cx + L, top + 7, STONE.sh);
    // Наплечники — шире кирасы, с тёмным швом снизу.
    for (const s of [-1, 1]) {
      const px0 = cx + L + s * 5;
      p.rect(px0 - 2, top - 1, px0 + 2, top + 2, s < 0 ? STONE.hi : STONE.sh);
      p.rect(px0 - 2, top - 1, px0 + 2, top - 1, s < 0 ? STONE.hi : STONE.mid);
      p.rect(px0 - 2, top + 3, px0 + 2, top + 3, seam);
    }
  }
  // Шлем: ведро с гребнем и Т-образной прорезью.
  if (!(hide & S_HELM)) {
    const hx = cx - 3 + L + R(r.hx) + 1;
    const hy = top - 7 + R(r.hy);
    for (let y = hy; y <= hy + 6; y++)
      for (let x = hx; x <= hx + 6; x++) p.set(x, y, tone((x - hx) / 6, x, y));
    p.wipe(hx, hy);
    p.wipe(hx + 6, hy);
    p.rect(hx + 3, hy - 2, hx + 3, hy, gold ? GOLD.mid : STONE.hi);
    p.set(hx + 2, hy - 1, gold ? GOLD.dk : STONE.mid);
    p.rect(hx + 1, hy + 3, hx + 5, hy + 3, seam);
    p.rect(hx + 3, hy + 3, hx + 3, hy + 5, seam);
    p.rect(hx, hy + 6, hx + 6, hy + 6, seam);
  }
  // Трещины от ран.
  for (let i = 0; i < Math.min(r.cracks, STATUE_CRACKS.length); i++) {
    const c = STATUE_CRACKS[i];
    if (c.on === 'helm' && hide & S_HELM) continue;
    if (c.on === 'torso' && hide & S_TORSO) continue;
    if (c.on === 'skirt' && hide & S_SKIRT) continue;
    const dx = c.on === 'skirt' ? bx : L + (c.on === 'helm' ? R(r.hx) : 0);
    const dy = by + (c.on === 'helm' ? R(r.hy) : 0);
    polyPart(p, c.pts, 1, dx + ox, dy + oy, seam);
  }
  if (hide & S_SWORD && hide & S_TORSO) return;
  // Руки и меч.
  const sh = top + 1;
  const gx = R(r.gx) + ox + bx;
  const gy = R(r.gy) + oy + by - down;
  // След меча — под клинком, поверх тела.
  if (r.smear) paintSwordSmear(p, r.smear, gx, gy);
  if (!(hide & S_TORSO)) {
    if (r.reach >= 0.5) {
      // Тянется рукой: пальцы-когти вперёд; вторая рука держит меч.
      p.line(cx + 3 + L, sh + 1, cx + 9 + L, sh - 1, STONE.hi);
      p.line(cx + 3 + L, sh + 2, cx + 9 + L, sh, STONE.sh);
      p.set(cx + 10 + L, sh - 2, STONE.hi);
      p.set(cx + 10 + L, sh, STONE.hi);
      p.set(cx + 11 + L, sh - 1, STONE.hi);
      p.line(cx - 3 + L, sh + 1, gx, gy, STONE.sh);
    } else {
      // Обе кисти на рукояти: плечи тянутся к ней.
      p.line(cx - 3 + L, sh + 1, gx - 1, gy, STONE.hi);
      p.line(cx + 4 + L, sh + 1, gx, gy + 1, STONE.sh);
      p.rect(gx - 1, gy - 1, gx + 1, gy, STONE.mid);
    }
  }
  if (!(hide & S_SWORD)) stoneSword(p, gx, gy, r.sa, 12);
}

/** След меча: полумесяц воздуха, где прошёл клинок (как серп меча героя). */
function paintSwordSmear(p: OPx, sm: number[], gx: number, gy: number): void {
  const [a0, a1, k] = sm;
  if (k <= 0) return;
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  for (let y = -15; y <= 15; y++)
    for (let x = -15; x <= 15; x++) {
      const d = Math.hypot(x, y);
      if (d < 6 || d > 13.5) continue;
      let a = Math.atan2(y, x);
      while (a < lo) a += Math.PI * 2;
      while (a > lo + Math.PI * 2) a -= Math.PI * 2;
      if (a > hi) continue;
      // Ярче у клинка (конец дуги), бледнее к хвосту.
      const f = (a - lo) / Math.max(0.01, hi - lo);
      const along = a1 > a0 ? f : 1 - f;
      const edge = d > 11.5 ? 1 : 0.6;
      const al = Math.round(255 * k * edge * (0.15 + 0.75 * along));
      if (al < 18) continue;
      p.set(gx + x, gy + y, d > 12.5 ? hex('#ffffff', al) : hex('#d8dcd4', al));
    }
}

/** Груда камня: те же камни, что у `paintRubble`, по одному (для сборки и распада). */
const RUBBLE_STONES: [number, number, number, number][] = [
  [3, ST_G - 3, 5, 2],
  [8, ST_G - 4, 6, 3],
  [13, ST_G - 2, 4, 2],
  [6, ST_G - 1, 9, 1],
  [16, ST_G - 1, 3, 1],
];

function paintRubbleInto(
  p: Px,
  gold: boolean,
  n: number,
  head: boolean,
  sword: boolean,
  ox = 0,
  oy = 0,
): void {
  const g = ST_G;
  for (let i = 0; i < Math.min(n, RUBBLE_STONES.length); i++) {
    const [x, y, w, h] = RUBBLE_STONES[i];
    fillStone(p, x + ox, y + oy, x + w + ox, y + h + oy);
  }
  if (head) {
    // Голова — на боку.
    fillStone(p, 1 + ox, g - 6 + oy, 5 + ox, g - 3 + oy);
    p.rect(2 + ox, g - 5 + oy, 4 + ox, g - 5 + oy, STONE.dk);
    if (gold) p.rect(1 + ox, g - 6 + oy, 1 + ox, g - 3 + oy, GOLD.mid);
  }
  // Меч обломком.
  if (sword) stoneSword(p, 12 + ox, g - 5 + oy, -0.2, 7);
}

/** Статуя рассыпалась: груда камня, голова откатилась. */
export function paintRubble(gold: boolean): Px {
  const p = new Px(ST_W, ST_H);
  paintRubbleInto(p, gold, RUBBLE_STONES.length, true, true);
  p.outline(INK);
  return p;
}

/** Крошка и пыль с камня: пиксели падают с ускорением и отскакивают. */
function statueCrumbs(t: number, list: number[][]): number[] {
  const out: number[] = [];
  for (const [t0, x, y, dir, fall] of list) {
    const k = (t - t0) / 0.32;
    if (k <= 0 || k >= 1) continue;
    out.push(x + dir * k * 2, y + k * k * fall);
  }
  return out;
}

/**
 * Подъём: глаза мигают и загораются, камень трескается и осыпается с плеч,
 * шлем поднимается, меч отрывается от пола в стойку. Из груды (собран заново)
 * — камни взлетают на место: ноги, юбка, кираса, шлем дугой, меч последним.
 */
function statueRise(t: number, gold: boolean): StatueRig {
  const flick = t < 0.26 ? (Math.floor(t * 24) % 3 === 0 ? 1 : 0) : 1;
  const shrug = eOut(seg(t, 0.2, 0.34)) * (1 - eInOut(seg(t, 0.34, 0.5)));
  const lift = seg(t, 0.44, 0.8);
  let rig = mixStatue({ ...SP.rest, gold }, { ...SP.guard, gold }, lift > 0 ? eBack(lift, 1.4) : 0);
  rig = { ...rig, by: rig.by - shrug, hy: rig.hy - eOut(seg(t, 0.25, 0.45)) * 1, eyes: flick };
  rig.crumbs = statueCrumbs(t, [
    [0.22, 5, 11, -1, 18],
    [0.28, 15, 10, 1, 19],
    [0.34, 10, 3, -1, 26],
    [0.4, 4, 13, -1, 16],
    [0.5, 16, 12, 1, 17],
  ]);
  return rig;
}

/** Ходьба крадучись: 8 кадров на два шага, корпус проседает на опорной. */
function statueCreep(t: number, gold: boolean): StatueRig {
  const f = Math.floor(t * 14) % 8;
  const step = f < 4 ? 1 : -1;
  const ph = f % 4;
  // Контакт (разведены) → присед → проход (вместе, нога поднята) → подъём.
  const spread = [3, 3, 0, 1][ph];
  const bob = [0, 1, 0, -1][ph];
  const lifted = ph === 2 ? 1 : ph === 3 ? 0 : 0;
  const base = { ...SP.claw, gold, eyes: 1 };
  return {
    ...base,
    fb: step > 0 ? -spread : spread - 1,
    ff: step > 0 ? spread : -spread + 1,
    lb: step > 0 ? 0 : lifted,
    lf: step > 0 ? lifted : 0,
    by: bob,
    sway: -step * (ph === 1 || ph === 2 ? 1 : 0),
    hy: ph === 1 ? 1 : 0,
    // Меч волочится и качается в такт.
    sa: 2.35 + (ph === 1 ? 0.08 : ph === 3 ? -0.06 : 0),
  };
}

/**
 * Замах (доля k копится, только пока на статую не смотрят — смотришь, и
 * она замирает посреди замаха): присед, меч уходит за голову, зависание,
 * удар по дуге за три кадра со следом. Контакт — первый кадр `recover`.
 */
const WIND_T = 0.55;
function statueWind(k: number, from: StatueRig, gold: boolean): StatueRig {
  const t = q24(k * WIND_T, WIND_T);
  const kk = t / WIND_T;
  const dip = eInOut(seg(kk, 0, 0.16));
  const up = seg(kk, 0.1, 0.7);
  const hang = seg(kk, 0.7, 0.8);
  const swing = seg(kk, 0.8, 1);
  let r = mixStatue(from, { ...from, by: from.by + 1, gx: from.gx - 2 }, dip);
  if (up > 0) r = mixStatue(r, { ...SP.wind, gold, eyes: 1 }, eInOut(up));
  if (hang > 0) r = { ...r, sa: r.sa - eOut(hang) * 0.15, by: r.by - eOut(hang) * 0.5 };
  if (swing > 0) {
    const s = eIn(swing) * 0.55 + swing * 0.45;
    const prev = r.sa;
    r = mixStatue(r, { ...SP.hit, gold, eyes: 1 }, s);
    // Меч идёт ЧЕРЕЗ верх вперёд: угол растёт от «за головой» к «в пол перед собой».
    r.sa = lerp(prev, SP.hit.sa, s);
    // След — только когда клинок уже прошёл заметную дугу: иначе у острия
    // висело бы пятно.
    if (r.sa - (SP.wind.sa - 0.15) > 0.5) r.smear = [SP.wind.sa - 0.15, r.sa, 0.9];
  }
  return { ...r, eyes: 1, gold };
}

/** После удара: контакт, проводка (меч вгрызается в пол), возврат в стойку. */
function statueRecover(t: number, gold: boolean): { rig: StatueRig; sy: number } {
  const tq = q24(t);
  const bite = seg(tq, 0, 0.08);
  const back = eInOut(seg(tq, 0.2, 0.5));
  let r: StatueRig = { ...SP.hit, gold, eyes: 1 };
  r = { ...r, gy: r.gy + (bite > 0 ? 1 : 0), sa: r.sa + bite * 0.08 };
  if (tq < 0.09) r.smear = [SP.wind.sa - 0.15, SP.hit.sa, 0.9 * (1 - tq / 0.09)];
  r = mixStatue(r, { ...SP.guard, gold, eyes: 1 }, back);
  r.crumbs = statueCrumbs(tq, [
    [0.03, 5, 11, -1, 18],
    [0.07, 16, 11, 1, 18],
  ]);
  const sy = tq < 0.045 ? 0.92 : tq < 0.09 ? 0.96 : tq < 0.16 ? 1.02 : 1;
  return { rig: r, sy };
}

/** Поклон: опускается на колено с весом, меч остриём в пол, голова склонена. */
function statueBow(t: number, from: StatueRig, gold: boolean): { rig: StatueRig; sy: number } {
  const k = seg(q24(t), 0, 0.3);
  const r = mixStatue(from, { ...SP.bow, gold }, eIn(k));
  const land = q24(t) - 0.3;
  const sy = land >= 0 && land < 0.05 ? 0.93 : land >= 0.05 && land < 0.1 ? 0.97 : 1;
  if (land >= 0 && land < 0.35)
    r.crumbs = statueCrumbs(land, [
      [0, 4, 15, -1, 14],
      [0.04, 16, 15, 1, 13],
    ]);
  return { rig: { ...r, eyes: 0 }, sy };
}

/** Распад: трещины, шлем слетает дугой к груде, кираса и юбка рушатся, меч падает. */
const STATUE_LINGER = 1.0;
function paintStatueDeath(t: number, gold: boolean, from: StatueRig): OPx {
  const p = new OPx(SA_W, SA_H, SA_OX, SA_OY);
  const tq = q24(t);
  if (tq < 0.12) {
    // Застыла в трещинах.
    paintStatueInto(p, { ...from, cracks: 4, smear: null, crumbs: [] }, 0, 0, 0);
    outlineRaw(p, INK);
    return p;
  }
  const k = (tq - 0.12) / 0.4;
  if (k < 1) {
    // Куски падают по очереди: шлем дугой влево, кираса вниз, юбка оседает.
    const f = { ...from, cracks: 4, smear: null, crumbs: [] };
    const helmK = clamp01(k * 1.2);
    const torsoK = clamp01((k - 0.15) / 0.7);
    const skirtK = clamp01((k - 0.35) / 0.6);
    const swordK = clamp01((k - 0.05) / 0.8);
    paintRubbleInto(p, gold, Math.floor(clamp01((k - 0.3) / 0.6) * 5), false, false);
    if (skirtK < 1)
      paintStatueInto(p, f, 0, Math.round(eIn(skirtK) * 8), S_TORSO | S_HELM | S_SWORD);
    if (torsoK < 1)
      paintStatueInto(
        p,
        f,
        Math.round(torsoK * -2),
        Math.round(eIn(torsoK) * 16),
        S_LEGS | S_SKIRT | S_HELM | S_SWORD,
      );
    if (helmK < 1) {
      const hx = Math.round(-helmK * 10);
      const hy = Math.round(-Math.sin(helmK * Math.PI) * 4 + eIn(helmK) * 21);
      paintStatueInto(p, f, hx, hy, S_LEGS | S_SKIRT | S_TORSO | S_SWORD);
    } else paintRubbleInto(p, gold, 0, true, false);
    if (swordK < 1)
      stoneSword(
        p,
        Math.round(lerp(f.gx + f.bx, 12, swordK)),
        Math.round(lerp(f.gy + f.by, ST_G - 5, eIn(swordK))),
        lerp(f.sa, -0.2, swordK),
        swordK > 0.6 ? 7 : 12,
      );
    else paintRubbleInto(p, gold, 0, false, true);
  } else {
    paintRubbleInto(p, gold, 5, true, true);
    // Пыль оседает.
    const dk = (tq - 0.52) / 0.4;
    if (dk < 1)
      for (let i = 0; i < 6; i++) {
        const x = 2 + i * 3.4 + dk * (i % 2 ? 2 : -2);
        const y = ST_G - 3 - (1 - dk) * (2 + (i % 3)) - dk * 1;
        p.set(Math.round(x), Math.round(y), hex('#b8bcb0', Math.round(150 * (1 - dk))));
      }
  }
  outlineRaw(p, INK);
  return p;
}

/** Сборка из груды (страж собран заново): камни взлетают на свои места. */
function paintStatueReform(t: number, gold: boolean): OPx {
  const p = new OPx(SA_W, SA_H, SA_OX, SA_OY);
  const tq = q24(t);
  const f = { ...SP.guard, gold, eyes: 1 };
  const legsK = eOut(seg(tq, 0.05, 0.3));
  const skirtK = eOut(seg(tq, 0.12, 0.38));
  const torsoK = eOut(seg(tq, 0.2, 0.5));
  const helmK = seg(tq, 0.32, 0.62);
  const swordK = eOut(seg(tq, 0.42, 0.72));
  // Груда тает по мере того, как камни уходят.
  const left = 5 - Math.floor(clamp01(seg(tq, 0.05, 0.45)) * 5);
  paintRubbleInto(p, gold, left, helmK <= 0, swordK <= 0);
  if (legsK > 0)
    paintStatueInto(p, f, 0, Math.round((1 - legsK) * 4), S_SKIRT | S_TORSO | S_HELM | S_SWORD);
  if (skirtK > 0)
    paintStatueInto(p, f, 0, Math.round((1 - skirtK) * 9), S_LEGS | S_TORSO | S_HELM | S_SWORD);
  if (torsoK > 0)
    paintStatueInto(
      p,
      f,
      Math.round((1 - torsoK) * -2),
      Math.round((1 - torsoK) * 14),
      S_LEGS | S_SKIRT | S_HELM | S_SWORD,
    );
  if (helmK > 0) {
    // Шлем прыгает дугой из груды на плечи.
    const k = eInOut(helmK);
    const hx = Math.round((1 - k) * -10);
    const hy = Math.round((1 - k) * 21 - Math.sin(k * Math.PI) * 6);
    paintStatueInto(p, f, hx, hy, S_LEGS | S_SKIRT | S_TORSO | S_SWORD);
  }
  if (swordK > 0)
    stoneSword(
      p,
      Math.round(lerp(12, f.gx, swordK)),
      Math.round(lerp(ST_G - 5, f.gy + f.by, swordK)),
      lerp(-0.2, f.sa, swordK),
      12,
    );
  outlineRaw(p, INK);
  return p;
}

/** Свет статуи: глаза в прорези шлема, трещины при распаде. */
function paintStatueLit(r: StatueRig, death: number): Px | null {
  const R = Math.round;
  if (r.eyes <= 0 && death <= 0) return null;
  const p = new OPx(SA_W, SA_H, SA_OX, SA_OY);
  if (r.eyes > 0) {
    const down = R(r.kneel * 4);
    const top = 11 + R(r.by) + down;
    const hx = ST_CX - 3 + R(r.lean) + R(r.bx) + R(r.hx) + 1;
    const hy = top - 7 + R(r.hy);
    const a = R(160 + 95 * clamp01(r.eyes));
    p.set(hx + 2, hy + 3, hex('#ff3a28', a));
    p.set(hx + 4, hy + 3, hex('#ff6a40', a));
    p.set(hx + 5, hy + 3, hex('#ff3a28', R(a * 0.35)));
  }
  if (death > 0) {
    const bx = R(r.bx);
    const by = R(r.by) + R(r.kneel * 4);
    const L = R(r.lean) + bx;
    for (const c of STATUE_CRACKS) {
      const dx = c.on === 'skirt' ? bx : L + (c.on === 'helm' ? R(r.hx) : 0);
      const dy = by + (c.on === 'helm' ? R(r.hy) : 0);
      polyPart(p, c.pts, 1, dx, dy, hex('#ffe0a0', R(220 * death)));
    }
  }
  return p;
}

// ---- Рисовальщик статуи -------------------------------------------------------

interface StatueMem {
  mode: string;
  since: number;
  from: StatueRig;
  last: StatueRig;
  flash: number;
  hitAt: number;
  hitDir: number;
  now: number;
}
const statueMem = new Map<number, StatueMem>();
const statueFrames = frameLRU<HTMLCanvasElement>(240);
const statueLits = frameLRU<HTMLCanvasElement | null>(100);

function statueKey(r: StatueRig): string {
  const R = Math.round;
  return [
    R(r.bx),
    R(r.by),
    R(r.lean),
    r.kneel >= 0.5 ? 1 : 0,
    R(r.kneel * 4),
    R(r.fb),
    R(r.ff),
    R(r.lb),
    R(r.lf),
    R(r.sway),
    R(r.gx),
    R(r.gy),
    R(r.sa * 12),
    r.reach >= 0.5 ? 1 : 0,
    R(r.hx),
    R(r.hy),
    r.gold ? 1 : 0,
    r.cracks,
    r.crumbs.map((v) => R(v)).join(','),
    r.smear ? r.smear.map((v) => R(v * 10)).join(',') : '',
  ].join('|');
}

function statueCanvas(
  key: string,
  make: () => Px,
  left: boolean,
  flash: boolean,
  look: MobPose['look'],
) {
  const k = `${key}|${left ? 1 : 0}|${flash ? 1 : 0}|${look}`;
  let img = statueFrames.get(k);
  if (!img) img = statueFrames.set(k, finish(make(), left, flash, look));
  return img;
}

registerMobPainter('f4_statue', (m, pose) => {
  const gold = m.kind === 'f4_statue';
  const mode = pose.mode;
  const now = pose.now;
  // Память: смена режима (для плавных переходов), удар героя (отдача).
  let mem = statueMem.get(m.id);
  if (!mem || now < mem.now - 1) {
    const r0 = { ...SP.rest, gold };
    mem = { mode, since: now - pose.t, from: r0, last: r0, flash: 0, hitAt: -9, hitDir: 1, now };
    statueMem.set(m.id, mem);
  }
  if (mode !== mem.mode) {
    mem.from = mem.last;
    mem.mode = mode;
    mem.since = now - pose.t;
  }
  if (m.flash > mem.flash + 0.01) {
    mem.hitAt = now;
    const sim = paintSim();
    mem.hitDir = sim ? (sim.hero.x < m.x ? 1 : -1) : pose.left ? 1 : -1;
  }
  mem.flash = m.flash;
  mem.now = now;
  const hpK = m.maxHp > 0 ? m.hp / m.maxHp : 1;
  const cracks = hpK > 0.72 ? 0 : hpK > 0.46 ? 1 : hpK > 0.22 ? 2 : 3;
  const out = (
    key: string,
    make: () => Px,
    rig: StatueRig | null,
    extra: Partial<MobFrame> = {},
    death = 0,
  ): MobFrame => {
    const img = statueCanvas(key, make, pose.left, pose.flash, pose.look);
    let lit: HTMLCanvasElement | null = null;
    if (rig) {
      const lk = `${key}|${stepN(rig.eyes, 2)}|${stepN(death, 4)}|${pose.left ? 1 : 0}`;
      const got = statueLits.get(lk);
      if (got !== undefined) lit = got;
      else {
        const lp = paintStatueLit(rig, death);
        lit = statueLits.set(lk, lp ? finish(lp, pose.left, false, 'normal') : null);
      }
    }
    // Отдача от удара героя: камень отшатывается от клинка и возвращается.
    const hk = now - mem.hitAt;
    let dx = extra.dx ?? 0;
    let rot = extra.rot ?? 0;
    if (hk >= 0 && hk < 0.2 && pose.anim !== 'dead') {
      const k = hk < 0.05 ? 1 : 1 - eOut((hk - 0.05) / 0.15);
      dx += mem.hitDir * 1.6 * k;
      rot += mem.hitDir * 0.07 * k;
    }
    return {
      img,
      lit,
      ax: pose.left ? SA_W - 1 - SA_AX : SA_AX,
      ay: SA_AY,
      eye: null,
      still: true,
      shadow: 6,
      ...extra,
      dx,
      rot,
    };
  };
  if (pose.anim === 'dead') {
    const t = Math.min(pose.t, STATUE_LINGER - 0.001);
    const tq = q24(t);
    const from = mem.last;
    const alpha = 1 - seg(tq, 0.75, STATUE_LINGER);
    return out(
      `die|${tq.toFixed(3)}|${statueKey(from)}`,
      () => paintStatueDeath(tq, gold, from),
      { ...from, eyes: 0 },
      { alpha, linger: STATUE_LINGER },
      tq < 0.5 ? 1 - seg(tq, 0.12, 0.5) : 0,
    );
  }
  let rig: StatueRig;
  let sy = 1;
  let ghost: MobFrame['ghost'] = null;
  const since = now - mem.since;
  if (mode === 'sleep' || mode === 'dormant') rig = { ...SP.rest, gold };
  else if (mode === 'rise' || mode === 'alert') {
    const reform = mode === 'rise' && (m.data.vRe ?? 0) > 0;
    const T = mode === 'alert' ? pose.t * (0.8 / 0.35) : pose.t;
    if (reform) {
      const tq = q24(Math.min(T, 0.8));
      mem.last = { ...SP.guard, gold, eyes: 1 };
      return out(`ref|${tq.toFixed(3)}|${gold ? 1 : 0}`, () => paintStatueReform(tq, gold), {
        ...SP.guard,
        gold,
        eyes: tq > 0.55 ? 1 : 0,
      });
    }
    rig = statueRise(q24(Math.min(T, 0.8)), gold);
  } else if (mode === 'stun') {
    // Оглушён ударом — держит прежнюю позу, отдачу рисует удар.
    rig = { ...mem.last, smear: null, crumbs: [] };
  } else if (mode === 'still') {
    // Застыла камнем в новой позе — без перехода: повернулся, а она уже иначе.
    rig = { ...FROZEN[mod(m.data.pose ?? 0, 4)], gold, eyes: m.data.eyes ?? 0 };
  } else if (mode === 'creep' || mode === 'chase') {
    rig = statueCreep(pose.t, gold);
    if (since < 0.14) rig = mixStatue(mem.from, rig, eInOut(since / 0.14));
  } else if (mode === 'wind') {
    const k = clamp01((m.data.wk ?? pose.t) / WIND_T);
    rig = statueWind(k, mem.from, gold);
    rig.eyes = m.data.eyes ?? 1;
    // Удар — быстрое движение всего тела: шлейф силуэтов, как у рывка героя.
    if (k > 0.82) ghost = { every: 0.03, life: 0.16, tint: '#c8ccc0', alpha: 0.32 };
  } else if (mode === 'recover') {
    const got = statueRecover(pose.t, gold);
    rig = got.rig;
    sy = got.sy;
    if (pose.t < 0.05) ghost = { every: 0.03, life: 0.16, tint: '#c8ccc0', alpha: 0.32 };
  } else if (mode === 'bow') {
    const got = statueBow(pose.t, mem.from, gold);
    rig = got.rig;
    sy = got.sy;
  } else rig = { ...SP.guard, gold, eyes: m.data.eyes ?? 0 };
  rig = { ...rig, cracks };
  mem.last = rig;
  const extra: Partial<MobFrame> = sy !== 1 ? { sy, sx: 2 - sy } : {};
  if (ghost) extra.ghost = ghost;
  return out(statueKey(rig), () => paintStatueRig(rig), rig, extra);
});

/** Прогрев стража: подъём, четыре позы, шаг, замах с ударом, поклон — в обе стороны. */
registerMobWarm('f4_statue', function* () {
  for (const left of [false, true]) {
    const make = (r: StatueRig) =>
      statueCanvas(statueKey(r), () => paintStatueRig(r), left, false, 'normal');
    for (let i = 0; i <= 19; i++) {
      make({ ...statueRise(i / 24, true), cracks: 0 });
      yield;
    }
    for (const r of FROZEN) {
      make({ ...r, gold: true, eyes: 0 });
      yield;
    }
    for (let i = 0; i < 8; i++) {
      make({ ...statueCreep(i / 14, true), cracks: 0 });
      yield;
    }
    const from = statueCreep(0, true);
    for (let i = 0; i <= 13; i++) {
      make({ ...statueWind(i / 13.2, from, true), cracks: 0 });
      yield;
    }
    for (let i = 0; i < 12; i++) {
      make({ ...statueRecover(i / 24, true).rig, cracks: 0 });
      yield;
    }
  }
});

// ---------------------------------------------------------------------------
// Каменный идол: сидящий колосс на троне. Трон стоит, живёт тело — риг из
// частей (торс, голова, руки, повязка), каждая со своим узором камня:
// двигаются части, а не пиксели внутри них, поэтому контур не «кипит».
// ---------------------------------------------------------------------------

/** Рисунок идола — в координатах прежнего холста 64×72; холст шире и выше. */
const ID_OX = 4;
const ID_OY = 8;
const ID_W = 72;
const ID_H = 98;
const ID_CX = 32;
const ID_G = 70;
/** Привязка кадра: середина и земля — как у прежнего холста, со сдвигом. */
const ID_AX = ID_CX + ID_OX;
const ID_AY = ID_G + ID_OY;
/** Полуось тени — постоянная: трон не «дышит». */
const ID_SHADOW = 26;

type IdolEyes = 'off' | 'dim' | 'rule' | 'gaze' | 'spent' | 'wrath' | 'open';

/** Трещины: хозяин (торс, голова, ноги) и ломаная в координатах покоя. */
const IDOL_CRACKS: { on: 'torso' | 'head' | 'legs'; pts: number[][] }[] = [
  {
    on: 'torso',
    pts: [
      [27, 30],
      [29, 34],
      [27, 39],
    ],
  },
  {
    on: 'torso',
    pts: [
      [40, 29],
      [38, 33],
      [41, 37],
      [39, 42],
    ],
  },
  {
    on: 'head',
    pts: [
      [24, 9],
      [26, 13],
      [24, 17],
    ],
  },
  {
    on: 'legs',
    pts: [
      [43, 47],
      [45, 51],
      [43, 56],
    ],
  },
  {
    on: 'legs',
    pts: [
      [19, 48],
      [22, 52],
      [20, 57],
    ],
  },
  {
    on: 'head',
    pts: [
      [36, 6],
      [34, 10],
      [36, 12],
    ],
  },
];

/** Смертные трещины: раскалывают всё тело за полсекунды до распада. */
const DEATH_CRACKS: { on: 'torso' | 'head' | 'legs'; pts: number[][] }[] = [
  {
    on: 'torso',
    pts: [
      [32, 26],
      [30, 31],
      [33, 35],
      [30, 40],
      [32, 46],
    ],
  },
  {
    on: 'torso',
    pts: [
      [20, 31],
      [24, 34],
      [22, 38],
      [26, 43],
    ],
  },
  {
    on: 'torso',
    pts: [
      [45, 30],
      [42, 35],
      [45, 39],
      [42, 44],
    ],
  },
  {
    on: 'head',
    pts: [
      [30, 1],
      [31, 6],
      [29, 11],
      [32, 16],
      [30, 22],
    ],
  },
  {
    on: 'legs',
    pts: [
      [26, 50],
      [29, 55],
      [27, 60],
    ],
  },
  {
    on: 'legs',
    pts: [
      [37, 49],
      [35, 54],
      [38, 60],
    ],
  },
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
const BASALT_STEPS = [BASALT.hi, BASALT.lit, BASALT.mid, BASALT.sh, BASALT.dk];

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

// ---- Неподвижное: трон, постамент, ноги --------------------------------------

function paintThrone(p: Px): void {
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
}

function paintLegs(p: Px): void {
  const cx = ID_CX;
  const B = BASALT;
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
}

/** Повязка между колен: низ отстаёт от тела на пиксель-два (`sway`). */
function paintCloth(p: Px, sway: number): void {
  const cx = ID_CX;
  for (let y = 44; y <= 58; y++) {
    const k = (y - 44) / 14;
    const off = Math.round(sway * k * k);
    const half = 4 - (y - 44) * 0.12;
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++)
      p.set(x + off, y, x <= cx - half + 1 ? TABARD.mid : TABARD.dk);
  }
  p.rect(cx - 4, 44, cx + 4, 44, GOLD.mid);
  const off = Math.round(sway);
  p.set(cx - 1 + off, 58, GOLD.dk);
  p.set(cx + 1 + off, 58, GOLD.dk);
}

// ---- Торс: грудь, плечи, ожерелье, печать со створками ------------------------

/** Печать на груди: круг с глазом; створки расходятся на `door` (0…1,15). */
function paintSeal(p: Px, door: number): void {
  const cx = ID_CX;
  const cy = 37;
  const B = BASALT;
  const cr = 5;
  const open = Math.max(0, door);
  // Ниша за створками: тьма и золотое сердце.
  if (open > 0.05) {
    for (let y = -cr; y <= cr; y++)
      for (let x = -cr; x <= cr; x++) {
        const d = Math.hypot(x, y);
        if (d > cr + 0.3) continue;
        p.set(cx + x, cy + y, d > cr - 1.2 ? B.dk : B.deep);
      }
    // Сердце: огранённый самоцвет, 5×5 ромбом.
    for (let y = -2; y <= 2; y++)
      for (let x = -2; x <= 2; x++) {
        if (Math.abs(x) + Math.abs(y) > 2) continue;
        p.set(cx + x, cy + y, x + y < 0 ? GOLD.hi : x + y === 0 ? GOLD.mid : GOLD.dk);
      }
    p.set(cx - 1, cy - 1, WHITE);
  }
  // Створки — половины диска, каждая уезжает в свою сторону.
  const shift = Math.round(open * 5);
  for (const s of [-1, 1]) {
    for (let y = -cr; y <= cr; y++)
      for (let x = 0; x <= cr; x++) {
        const d = Math.hypot(x, y);
        if (d > cr + 0.3) continue;
        const px = cx + s * x + s * shift;
        const rim = d > cr - 1.2;
        const inner = x === 0;
        let c: RGBA;
        if (open <= 0.05) c = rim ? B.dk : B.deep;
        else if (inner) c = B.deep;
        else if (rim) c = GOLD.dk;
        else c = basalt(px, cy + y, s < 0 ? 0.25 : 0.7, (y + cr) / (2 * cr));
        p.set(px, cy + y, c);
      }
  }
  if (open <= 0.05) {
    // Закрыта: крест глаза, как на прежнем рисунке.
    p.rect(cx - 2, cy, cx + 2, cy, B.sh);
    p.set(cx, cy - 1, B.sh);
    p.set(cx, cy + 1, B.sh);
  } else {
    // Руна на внешней стороне створок — половинки глаза разъехались.
    for (const s of [-1, 1]) {
      p.set(cx + s * (shift + 2), cy, GOLD.mid);
      p.set(cx + s * (shift + 3), cy, GOLD.dk);
    }
  }
}

function paintTorso(p: Px, door: number): void {
  const cx = ID_CX;
  const B = BASALT;
  // Шея.
  basaltRect(p, cx - 5, 21, cx + 5, 27);
  p.line(cx - 5, 26, cx + 5, 26, B.dk);
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
  paintSeal(p, door);
}

// ---- Голова ------------------------------------------------------------------

/**
 * Голова. `nod` — лицо ниже (1, склонил) или выше (−1, запрокинул), `turn` —
 * лицо в сторону на пиксель, `jaw` — рот открыт на 0…2, `brow` — брови
 * сдвинуты (прищур), `third` — третий глаз открыт.
 */
function paintHead(p: Px, nod: number, turn: number, jaw: number, brow: number, third: boolean) {
  const cx = ID_CX;
  const B = BASALT;
  const fx = cx + turn;
  const fy = nod;
  for (const s of [-1, 1]) {
    // Уши с вытянутыми мочками и золотой серьгой; при повороте дальнее ухо
    // прячется за голову на пиксель.
    const ex = cx + s * 12 - (s === Math.sign(turn) ? 1 : 0) * s;
    basaltRect(p, ex - 2, 11, ex + 1, 23);
    p.set(ex, 24 + jaw, GOLD.mid);
    p.set(ex, 25 + jaw, GOLD.hi);
  }
  basaltEll(p, cx, 14.5, 11, 10);
  basaltRect(p, cx - 8, 19, cx + 8, 24 + jaw);
  // Подбородок сужается.
  for (let y = 22; y <= 24; y++) {
    const yy = y + jaw;
    (p as OPx).wipe(cx - 8 + (y - 22), yy);
    (p as OPx).wipe(cx + 8 - (y - 22), yy);
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
  // Тяжёлая бровь: сдвинута — ниже и темнее, глаза в прищуре.
  const by = 10 + fy + (brow ? 1 : 0);
  p.rect(fx - 9, by, fx + 9, by, B.dk);
  p.rect(fx - 8, by + 1, fx + 8, by + 1, brow ? B.dk : B.sh);
  if (brow) {
    // Излом бровей к переносице.
    p.set(fx - 2, by + 2, B.dk);
    p.set(fx + 2, by + 2, B.dk);
  }
  // Глазницы-миндалины (свет в них — отдельным слоем поверх темноты).
  for (const s of [-1, 1]) {
    const ex = fx + s * 5;
    for (let x = -3; x <= 3; x++)
      for (let y = -1; y <= 1; y++) {
        if (Math.abs(x) === 3 && y !== 0) continue;
        if (brow && y === -1) continue;
        p.set(ex, 13 + fy + y, B.deep);
        p.set(ex + x, 13 + fy + y, B.deep);
      }
  }
  // Третий глаз на лбу — щель; открыт — шире.
  p.rect(fx, 7, fx, 9 + fy, B.deep);
  if (third) {
    p.set(fx - 1, 8, B.deep);
    p.set(fx + 1, 8, B.deep);
  }
  // Нос.
  p.rect(fx, 13 + fy, fx, 17 + fy, B.hi);
  p.set(fx - 1, 18 + fy, B.deep);
  p.set(fx + 1, 18 + fy, B.deep);
  // УЛЫБКА: широкая резная дуга от уха до уха, с зубами. Рот открыт на `jaw`:
  // верхний ряд зубов на месте, нижняя губа уходит вниз, между ними — тьма.
  for (let x = -9; x <= 9; x++) {
    const k = (x / 9) ** 2;
    const y = 21 + fy - Math.round(k * 3);
    const thick = Math.abs(x) < 6 ? 2 : 1;
    const open = Math.abs(x) < 7 ? jaw : 0;
    for (let t = 0; t < thick + open; t++) p.set(fx + x, y + t, B.deep);
    if (Math.abs(x) < 7 && x % 2 === 0) p.set(fx + x, y, hex('#d8d0b8'));
    if (open && Math.abs(x) < 6 && x % 2 !== 0) p.set(fx + x, y + thick + open - 1, hex('#b8b09a'));
  }
  p.set(fx - 10, 17 + fy, B.dk);
  p.set(fx + 10, 17 + fy, B.dk);
  // Скулы — блик.
  p.set(fx - 6, 16 + fy, B.hi);
  p.set(fx - 7, 17 + fy, B.lit);
}

// ---- Руки --------------------------------------------------------------------

type Hand = 'knee' | 'grip' | 'fist' | 'palm' | 'flat' | 'reach' | 'limp';
/** Рука: локоть и запястье в координатах рисунка, вид кисти. */
interface Arm {
  ex: number;
  ey: number;
  wx: number;
  wy: number;
  hand: Hand;
}
const arm = (ex: number, ey: number, wx: number, wy: number, hand: Hand): Arm => ({
  ex,
  ey,
  wx,
  wy,
  hand,
});
/** Куда ложится ладонь удара (правая рука): пол перед правой ступнёй. */
const ARM_HIT_W = [47, 64];
/** Ключевые позы ПРАВОЙ руки; левая — зеркало по оси идола. */
const ARM = {
  rest: arm(50, 41, 44, 45, 'knee'),
  grip: arm(50, 41, 44, 45, 'grip'),
  lift: arm(53, 40, 47, 41, 'fist'),
  palmUp: arm(60, 26, 58, 14, 'palm'),
  palmPush: arm(58, 32, 55, 24, 'palm'),
  reach: arm(55, 46, 49, 34, 'reach'),
  apex: arm(61, 19, 56, 3, 'palm'),
  hit: arm(60, 44, ARM_HIT_W[0], ARM_HIT_W[1], 'flat'),
  limp: arm(52, 45, 47, 53, 'limp'),
  fist: arm(56, 38, 51, 34, 'fist'),
  roar: arm(58, 36, 54, 30, 'fist'),
};
const mirrorArm = (a: Arm): Arm => ({ ...a, ex: 64 - a.ex, wx: 64 - a.wx });
/**
 * Смешать позы руки. `via` — точка изгиба пути кисти (квадратичная кривая):
 * руки ходят по дугам, а не по прямым.
 */
function mixArm(a: Arm, b: Arm, k: number, via?: number[], viaE?: number[]): Arm {
  const u = 1 - k;
  const bez = (p0: number, p1: number, c: number | undefined) =>
    c === undefined ? p0 + (p1 - p0) * k : u * u * p0 + 2 * u * k * c + k * k * p1;
  return {
    ex: bez(a.ex, b.ex, viaE?.[0]),
    ey: bez(a.ey, b.ey, viaE?.[1]),
    wx: bez(a.wx, b.wx, via?.[0]),
    wy: bez(a.wy, b.wy, via?.[1]),
    hand: k < 0.5 ? a.hand : b.hand,
  };
}

/**
 * Каменный сегмент руки: капсула от (x0, y0) до (x1, y1), радиусы на концах.
 * Свет слева-сверху по нормали; узор привязан к самому сегменту (u вдоль, v
 * поперёк) — рука поворачивается, а камень на ней не «плывёт». Край, лёгший
 * поверх другого камня, — тёмный шов.
 */
function limb(
  p: OPx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r0: number,
  r1: number,
  seed: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const R = Math.max(r0, r1) + 1.5;
  const bx0 = Math.floor(Math.min(x0, x1) - R);
  const bx1 = Math.ceil(Math.max(x0, x1) + R);
  const by0 = Math.floor(Math.min(y0, y1) - R);
  const by1 = Math.ceil(Math.max(y0, y1) + R);
  const rim: [number, number][] = [];
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const u = Math.max(0, Math.min(len, px * ux + py * uy));
      const ax = px - u * ux;
      const ay = py - u * uy;
      const d = Math.hypot(ax, ay);
      const r = r0 + ((r1 - r0) * u) / len;
      if (d > r + 1) continue;
      if (d > r) {
        if (p.at(x, y)) rim.push([x, y]);
        continue;
      }
      // Нормаль к оси — к свету (−0,6; −0,8).
      const lam = d < 0.01 ? 0 : (-(ax / d) * 0.6 - (ay / d) * 0.8) * (d / r);
      const h =
        ((Math.round(u) * 73856093) ^ ((Math.round(ax * uy - ay * ux) + seed) * 19349663)) >>> 0;
      const k = 0.52 - lam * 0.5 + (h % 11 === 0 ? 0.14 : 0);
      p.set(x, y, BASALT_STEPS[Math.max(0, Math.min(4, Math.floor(k * 5)))]);
    }
  for (const [x, y] of rim) p.set(x, y, BASALT.deep);
}

/**
 * Кисть в запястье (wx, wy), `s` — сторона (1 правая), `ux, uy` — куда
 * смотрит предплечье. Форма задана в своих осях (a — вдоль, b — поперёк к
 * большому пальцу) и растрируется обратным отображением: без дыр при любом
 * повороте.
 */
function paintHand(
  p: OPx,
  hand: Hand,
  wx: number,
  wy: number,
  ux: number,
  uy: number,
  s: number,
  rune: number,
): void {
  const B = BASALT;
  // Кисть на колене и сжатая в колене — вид сверху, как на прежнем рисунке.
  if (hand === 'knee' || hand === 'grip' || hand === 'limp') {
    const x = Math.round(wx);
    const y = Math.round(wy);
    const long = hand === 'limp' ? 2 : 0;
    const rows = 4 + long;
    for (let yy = 0; yy < rows; yy++)
      for (let xx = -4; xx <= 4; xx++) {
        const lit = (xx + 4) / 8;
        p.set(x + xx, y + 2 + yy, basalt(x + xx, y + yy, lit, yy / rows));
      }
    p.rect(x - 4, y + 1, x + 4, y + 1, hand === 'grip' ? GOLD.mid : GOLD.dk);
    for (let fx = -3; fx <= 3; fx += 2) {
      const top = hand === 'grip' ? 3 : 2;
      p.line(x + fx, y + top, x + fx, y + 1 + rows, B.deep);
      if (hand === 'grip') p.set(x + fx + 1, y + 2, B.hi);
    }
    if (hand === 'limp') for (let fx = -4; fx <= 4; fx += 2) (p as OPx).wipe(x + fx, y + 1 + rows);
    return;
  }
  // Поперёк — к большому пальцу (для правой руки ладонью к нам — налево).
  const vx = -uy * s;
  const vy = ux * s;
  const shape = (a: number, b: number): RGBA | null => {
    const lit = clamp01(0.5 - b * vx * 0.08 - a * uy * 0.02);
    const tone = (k: number) => BASALT_STEPS[Math.max(0, Math.min(4, Math.floor(k * 5)))];
    switch (hand) {
      case 'fist': {
        // Кулак: ком 9×9, костяшки гребнем, пальцы подогнуты швами, большой
        // палец обнимает их сбоку.
        const da = (a - 4.2) / 4.6;
        const db = b / 4.4;
        if (da * da + db * db > 1) return null;
        if (Math.round(a) <= 1) return Math.abs(b) < 3.6 ? GOLD.dk : null;
        if (Math.round(a) === 6 && Math.round(b) % 2 === 0) return B.hi;
        if (Math.round(a) === 5 && Math.abs(Math.round(b)) <= 3 && Math.round(b) % 2 !== 0)
          return B.deep;
        if (Math.round(b) === -2 && a > 2 && a < 5) return B.dk;
        return tone(0.3 + lit * 0.45 + da * 0.25);
      }
      case 'palm':
      case 'reach': {
        // Ладонь к нам: пясть 9×7 с браслетом, четыре пальца по пикселю через
        // щель (средний длиннее), большой палец в сторону. `reach` — веером.
        const fan = hand === 'reach' ? 0.24 : 0;
        if (a >= 0.5 && a <= 7.5 && Math.abs(b) <= 4.4) {
          if (a > 6.6 && Math.abs(b) > 3.6) return null;
          if (Math.round(a) === 1) return GOLD.mid;
          if (Math.round(a) === 2) return GOLD.dk;
          return tone(0.22 + (Math.abs(b) / 4.4) * 0.3 + (a / 7.5) * 0.12);
        }
        if (a > 7.5 && a <= 12.6) {
          const len = [11.2, 12.6, 12.3, 11];
          const fs = [-3.3, -1.1, 1.1, 3.3];
          for (let i = 0; i < 4; i++) {
            const fb = fs[i] * (1 + fan * (a - 7.5));
            if (Math.abs(b - fb) < 0.7 && a <= len[i]) return a > len[i] - 0.9 ? B.hi : tone(0.3);
          }
          return null;
        }
        if (a >= 2.5 && a <= 6.8 && b <= -4.4 && b >= -6.6 - (a - 2.5) * 0.35) return tone(0.35);
        return null;
      }
      case 'flat': {
        // Ладонь на полу, вид сверху: тыльная сторона, костяшки, растопыренные
        // пальцы к зрителю, большой палец в сторону.
        if (a >= 0 && a <= 6.2 && Math.abs(b) <= 5 + a * 0.25) {
          if (Math.round(a) === 0) return GOLD.mid;
          if (Math.round(a) === 1) return GOLD.dk;
          if (Math.round(a) === 6 && Math.round(b) % 2 === 0) return B.hi;
          return tone(0.2 + (b + 6) * 0.05 + a * 0.03);
        }
        if (a > 6.2 && a <= 11.2) {
          for (const f of [-5, -1.7, 1.7, 5]) {
            const fb = f * (1 + 0.1 * (a - 6.2));
            if (Math.abs(b - fb) < 0.8) return a > 10.3 ? B.dk : tone(0.32);
          }
          return null;
        }
        if (a >= 1 && a <= 5 && b <= -5.6 && b >= -8.2) return tone(0.4);
        return null;
      }
    }
    return null;
  };
  // Кисть лежит в круге радиусом 9 вокруг точки на 6 вдоль предплечья —
  // обходим только его.
  const R = 9;
  const x0 = Math.round(wx + ux * 6);
  const y0 = Math.round(wy + uy * 6);
  const cells: [number, number, RGBA][] = [];
  for (let y = y0 - R; y <= y0 + R; y++)
    for (let x = x0 - R; x <= x0 + R; x++) {
      const px = x + 0.5 - wx;
      const py = y + 0.5 - wy;
      const a = px * ux + py * uy;
      const b = px * vx + py * vy;
      const c = shape(a, b);
      if (c) cells.push([x, y, c]);
    }
  // Шов по краю кисти поверх камня — кисть не сливается с грудью и коленом.
  const own = new Set(cells.map((c) => c[1] * 1000 + c[0]));
  for (const [x, y] of cells)
    for (const [ddx, ddy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + ddx;
      const ny = y + ddy;
      if (own.has(ny * 1000 + nx)) continue;
      if (p.at(nx, ny)) p.set(nx, ny, BASALT.deep);
    }
  for (const [x, y, c] of cells) p.set(x, y, c);
  // Знак заповеди на ладони: вырезан в камне (горит — слоем света).
  if ((hand === 'palm' || hand === 'reach') && rune) {
    for (const [a, b] of runeCells(rune)) {
      const x = Math.round(wx + (a + 4.8) * ux + b * vx);
      const y = Math.round(wy + (a + 4.8) * uy + b * vy);
      p.set(x, y, B.deep);
    }
  }
}

/** Знак заповеди на ладони (оси кисти: a вдоль пальцев, b поперёк). */
function runeCells(rune: number): number[][] {
  if (rune === 1)
    // «Поклонись»: галочка вниз — как на скрижали.
    return [
      [1, -2],
      [0, -1],
      [-1, 0],
      [0, 1],
      [1, 2],
    ];
  if (rune === 2)
    // «Восхвали»: черта с бугром — глаз-холм.
    return [
      [-1, -2],
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [-1, 2],
      [0, -1],
      [0, 0],
      [1, 0],
    ];
  // «Опусти меч»: косой крест.
  return [
    [-2, -2],
    [-1, -1],
    [0, 0],
    [1, 1],
    [2, 2],
    [2, -2],
    [1, -1],
    [-1, 1],
    [-2, 2],
  ];
}

const RUNE_COLOR: Record<number, RGBA> = {
  1: GOLD.hi,
  2: hex('#d8f0ff'),
  3: hex('#ff6a4a'),
};

/** Рука целиком: плечо (sx, sy) → локоть → запястье → кисть. */
function paintArm(p: OPx, s: number, sx: number, sy: number, a: Arm, rune: number): void {
  limb(p, sx, sy + 1, a.ex, a.ey, 4.1, 3.5, s > 0 ? 7 : 3);
  // Плечо — шар поверх начала руки: без шва в суставе.
  for (let y = Math.floor(sy - 5); y <= Math.ceil(sy + 5); y++)
    for (let x = Math.floor(sx - 6); x <= Math.ceil(sx + 6); x++) {
      const dx = (x + 0.5 - sx) / 5;
      const dy = (y + 0.5 - sy) / 4.5;
      if (dx * dx + dy * dy > 1) continue;
      p.set(x, y, basalt(x, y, (dx + 1) / 2, (dy + 1) / 2));
    }
  limb(p, a.ex, a.ey, a.wx, a.wy, 3.6, 3.0, s > 0 ? 11 : 5);
  const len = Math.hypot(a.wx - a.ex, a.wy - a.ey) || 1;
  paintHand(p, a.hand, a.wx, a.wy, (a.wx - a.ex) / len, (a.wy - a.ey) / len, s, rune);
}

// ---- Поза (риг) --------------------------------------------------------------

/** Всё, что меняет кадр идола. Числа — в пикселях рисунка. */
interface IdolRig {
  /** Сдвиг торса (наклон вперёд — вниз, к зрителю). */
  tx: number;
  ty: number;
  /** Сдвиг головы относительно торса. */
  hx: number;
  hy: number;
  nod: number;
  turn: number;
  jaw: number;
  brow: number;
  L: Arm;
  R: Arm;
  /** Створки печати 0…1,15. */
  door: number;
  /** Низ повязки отстаёт, пиксели. */
  cloth: number;
  /** Свет. */
  eye: number;
  eyeMode: IdolEyes;
  third: number;
  rune: number;
  runeK: number;
  runeArm: number;
  core: number;
  crack: number;
  beam: number;
  mouth: number;
  ember: number;
  /** Дым из глазниц (кадр 0…3) или −1. */
  smoke: number;
  /** Крошка: пары x, y в координатах рисунка. */
  crumbs: number[];
  /** След руки при ударе: сторона, доля пути от и до, яркость. */
  smear: number[] | null;
  /** Тень руки кадром раньше — на обрушении. */
  ghost: Arm | null;
  /** Новая трещина растёт 0…1; `deathK` — смертные трещины 0…1. */
  grow: number;
  deathK: number;
}

function restRig(): IdolRig {
  return {
    tx: 0,
    ty: 0,
    hx: 0,
    hy: 0,
    nod: 0,
    turn: 0,
    jaw: 0,
    brow: 0,
    L: mirrorArm(ARM.rest),
    R: ARM.rest,
    door: 0,
    cloth: 0,
    eye: 0.5,
    eyeMode: 'dim',
    third: 0,
    rune: 0,
    runeK: 0,
    runeArm: 1,
    core: 0,
    crack: 0.35,
    beam: 0,
    mouth: 0,
    ember: 0,
    smoke: -1,
    crumbs: [],
    smear: null,
    ghost: null,
    grow: 1,
    deathK: 0,
  };
}

/** Смешать позы: числа — плавно, вид кисти и режим глаз — от ближней. */
function mixRig(a: IdolRig, b: IdolRig, k: number): IdolRig {
  if (k <= 0) return a;
  if (k >= 1) return b;
  const o = { ...a };
  for (const key of [
    'tx',
    'ty',
    'hx',
    'hy',
    'nod',
    'turn',
    'jaw',
    'brow',
    'door',
    'cloth',
    'eye',
    'third',
    'runeK',
    'core',
    'crack',
    'beam',
    'mouth',
    'ember',
  ] as const)
    o[key] = lerp(a[key], b[key], k);
  o.L = mixArm(a.L, b.L, k);
  o.R = mixArm(a.R, b.R, k);
  if (k >= 0.5) {
    o.eyeMode = b.eyeMode;
    o.rune = b.rune;
    o.runeArm = b.runeArm;
    o.smoke = b.smoke;
  }
  o.crumbs = [...a.crumbs, ...b.crumbs];
  o.smear = b.smear ?? a.smear;
  o.ghost = b.ghost ?? a.ghost;
  return o;
}

/** Дыхание камня: грудь поднимается на пиксель, голова — следом, свет в трещинах. */
function breathe(r: IdolRig, now: number, amp = 1): void {
  const ph = (qf(now, 10) % 2.4) / 2.4;
  const up = ph > 0.12 && ph < 0.58 ? 1 : 0;
  const upH = ph > 0.2 && ph < 0.66 ? 1 : 0;
  r.ty -= up * amp;
  r.hy -= (upH - up) * amp;
  const s = Math.sin(ph * Math.PI * 2 - 0.6);
  r.crack += 0.18 * s;
  r.eye += 0.1 * s;
}

/** Крошка с плеч в покое: камешек срывается, падает, отскакивает от колена. */
function crumbAt(t: number, x0: number, y0: number, dir: number): number[] {
  if (t < 0 || t > 0.62) return [];
  if (t < 0.34) {
    const k = t / 0.34;
    return [x0 + dir * k * 2, y0 + k * k * 19];
  }
  const k = (t - 0.34) / 0.28;
  // Отскок от колена наружу и вниз, к постаменту.
  return [x0 + dir * (2 + k * 4), y0 + 19 - Math.sin(k * Math.PI) * 3 + k * 9];
}

// ---- Состояния ---------------------------------------------------------------

/** Покой: дыхание, крошка с плеч раз в две с половиной секунды. */
function idolRest(r: IdolRig, now: number): void {
  breathe(r, now);
  const lp = qf(now, 10) % 4.8;
  r.crumbs.push(...crumbAt(lp - 0.4, 13 + 1, 26 + r.ty, -1));
  r.crumbs.push(...crumbAt(lp - 2.8, 51 - 1, 26 + r.ty, 1));
}

/**
 * Заповедь: рука поднимается по дуге ладонью к герою, на ладони загорается
 * знак (цвет и знак — как на скрижали). Суд — наклон вперёд, прищур, ладонь
 * давит к зрителю.
 */
function idolRule(r: IdolRig, t: number, D: number, J: number, rule: number, now: number): void {
  const R0 = ARM.rest;
  // Подготовка: кисть вдавливается в колено, голова кивает.
  const a0 = eInOut(seg(t, 0, 0.16));
  // Подъём по дуге наружу — к лицу.
  const a1 = seg(t, 0.14, 0.56);
  const up = eBack(a1, 1.2);
  const judge = eInOut(seg(t, J, J + 0.32));
  const creep = seg(t, J + 0.32, D);
  let R = mixArm(R0, ARM.grip, a0);
  R.wy += a0 * 1;
  if (a1 > 0) R = mixArm(R, ARM.palmUp, up, [66, 36], [62, 38]);
  // Кисть раскрывается, едва оторвавшись от колена: плоская «колено» в
  // воздухе читалась бы кирпичом.
  if (a1 > 0.06) R.hand = 'palm';
  if (judge > 0) R = mixArm(R, ARM.palmPush, judge);
  r.R = R;
  // Вторая рука держится за колено — напряжение.
  r.L = mixArm(r.L, mirrorArm(ARM.grip), a0);
  r.nod = a0 * (1 - eOut(a1)) - eOut(a1) * 1 + judge * 2;
  r.hy += -a0 * 0 + judge * 2 + Math.round(creep);
  r.ty += -eOut(a1) + judge * 2;
  r.turn = 0;
  r.brow = judge;
  r.eyeMode = 'rule';
  r.eye = 0.55 + 0.25 * eOut(a1) + 0.2 * judge;
  r.rune = rule;
  r.runeArm = 1;
  const flick = t > D - 0.5 ? 12 : 6;
  r.runeK =
    seg(t, 0.36, 0.6) * (0.75 + 0.25 * Math.round(Math.sin(qf(now, flick) * 40) * 0.5 + 0.5));
  r.cloth = -a0 * 0 + judge * 1;
  if (judge <= 0 && a1 >= 1) breathe(r, now, 1);
}

/**
 * Лик открыт (заповедь соблюдена): рука опускается, идол откидывается —
 * створки печати разъезжаются с перелётом, сердце горит. Под конец створки
 * захлопываются: окно закрывается.
 */
function idolOpen(r: IdolRig, t: number, D: number, now: number, from: IdolRig): void {
  const down = eInOut(seg(t, 0, 0.32));
  const R = mixArm(ARM.palmPush, ARM.rest, down, [60, 40], [60, 40]);
  r.R = R;
  const L = mixArm(mirrorArm(ARM.grip), mirrorArm(ARM.rest), down);
  r.L = L;
  const back = eOut(seg(t, 0.05, 0.35));
  const close = eIn(seg(t, D - 0.36, D - 0.1));
  const bounce = t > D - 0.1 ? Math.sin(seg(t, D - 0.1, D) * Math.PI) * 0.15 : 0;
  const opening = seg(t, 0.08, 0.34);
  r.door = opening > 0 ? eBack(opening, 2.2) * (1 - close) + bounce : 0;
  r.ty += lerp(from.ty, 0, down) - back * (1 - close);
  r.hy += lerp(from.hy, 0, down) - back * (1 - close);
  r.nod = lerp(from.nod, 0, down) - back * (1 - close);
  r.eyeMode = t < 0.12 ? 'rule' : 'open';
  r.eye = 0.35;
  r.core = seg(t, 0.1, 0.3) * (1 - close) * (0.8 + 0.2 * Math.round(Math.sin(qf(now, 8) * 9)));
  r.cloth = (1 - down) * 1 - back * (1 - close);
  if (t > 0.4 && t < D - 0.4) breathe(r, now);
}

/**
 * Взор: подготовка — голова вниз, свет гаснет; рывок вверх с перелётом,
 * третий глаз раскрывается, глаза наливаются добела к первому залпу. На
 * каждую волну — вспышка и отдача головы. После — голова опускается.
 */
function idolGaze(r: IdolRig, t: number, W: number, E: number, now: number): void {
  const dip = eInOut(seg(t, 0, 0.2));
  const snap = seg(t, 0.2, 0.38);
  const fall = eInOut(seg(t, W + 0.8, E));
  const upK = snap > 0 ? eBack(snap, 2.4) : 0;
  const hold = (1 - fall) * upK;
  // Рывок вверх с перелётом, потом голова оседает: подбородок остаётся
  // задран, а глаза встают туда, откуда бьёт конус взора (−57…−58 точек от
  // ног, `IDOL_EYES` у «Техник»).
  const settle = eInOut(seg(t, 0.38, 0.62));
  r.hy += dip * (1 - snap) * 3 - hold * 3 * (1 - settle);
  r.ty += dip * (1 - snap) * 1 - hold * (1 - settle);
  r.nod = dip * (1 - snap) - hold;
  r.jaw = hold * (snap >= 1 ? 1 : 0);
  r.L = mixArm(r.L, mirrorArm(ARM.grip), dip);
  r.R = mixArm(r.R, ARM.grip, dip);
  r.third = hold;
  r.eyeMode = 'gaze';
  // Заряд: к первому залпу глаза добела.
  const charge = seg(t, 0.26, W);
  r.eye = snap > 0 ? 0.4 + 0.6 * eIn(charge) : 0.5 - 0.35 * dip;
  // Последние треть секунды перед залпом накал дрожит — вот-вот ударит.
  if (t > W - 0.33 && t < W) r.eye = Math.floor(qf(now, 12) * 12) % 2 ? 1 : 0.84;
  // Волны: вспышка и отдача головы на три кадра.
  let kick = 0;
  let beam = 0;
  for (let w = 0; w < 4; w++) {
    const dt = t - (W + w * 0.25);
    if (dt >= 0 && dt < 0.125) {
      kick = dt < 0.042 ? 1 : dt < 0.084 ? 0.6 : 0.25;
      beam = 1 - dt / 0.125;
    }
  }
  r.hy -= Math.round(kick);
  r.ty -= kick > 0.5 ? 1 : 0;
  r.beam = beam;
  if (t >= W) r.eye = Math.max(0.55, 1 - fall * 0.6) * (beam > 0 ? 1 : 0.92);
  r.crack += 0.3 * charge * (1 - fall);
  r.cloth = -hold * 1;
  if (t > W + 0.8) r.third = 1 - fall;
  void now;
}

/**
 * Истощён: глаза гаснут, голова падает на грудь с отскоком, плечи оседают,
 * руки сползают с колен; створки печати приоткрыты — сердце еле тлеет. Из
 * глазниц дым. Под конец — поднимается.
 */
function idolSpent(r: IdolRig, t: number, D: number, now: number): void {
  const exhale = eOut(seg(t, 0, 0.12));
  const drop = seg(t, 0.12, 0.46);
  const dropK = drop > 0 ? eBack(drop, 1.6) : 0;
  const rise = eInOut(seg(t, D - 0.55, D - 0.05));
  const slump = dropK * (1 - rise);
  r.hy += -exhale * (1 - drop) * 1 + slump * 5;
  r.ty += slump * 2;
  r.nod = slump;
  r.L = mixArm(mirrorArm(ARM.rest), mirrorArm(ARM.limp), eInOut(drop) * (1 - rise));
  r.R = mixArm(ARM.rest, ARM.limp, eInOut(seg(t, 0.16, 0.5)) * (1 - rise));
  r.eyeMode = 'spent';
  r.eye = lerp(0.9, 0, eOut(seg(t, 0, 0.4))) + rise * 0.45;
  if (rise > 0.5) r.eyeMode = 'dim';
  const crack = seg(t, 0.3, 0.42);
  r.door = (crack > 0.5 ? 0.45 : crack > 0 ? 0.25 : 0) * (1 - eIn(seg(t, D - 0.4, D - 0.1)));
  r.core = r.door > 0 ? 0.25 + 0.15 * Math.round(Math.sin(qf(now, 6) * 5) * 0.5 + 0.5) : 0;
  r.ember =
    t > 0.35 && rise < 0.3 ? 0.5 + 0.5 * Math.round(Math.sin(qf(now, 8) * 7) * 0.5 + 0.5) : 0;
  r.smoke = t > 0.15 && t < D - 0.3 ? Math.floor(qf(now, 8) * 8) % 4 : -1;
  r.crack *= 0.5;
  r.cloth = slump * 1;
  if (t > 0.6 && t < D - 0.6) {
    // Тяжёлое дыхание: плечи поднимаются реже и глубже.
    const ph = (qf(now, 8) % 1.8) / 1.8;
    r.ty -= ph > 0.2 && ph < 0.6 ? 1 : 0;
  }
}

/**
 * Кара (заповедь нарушена): рывок корпуса вперёд, ладонь со знаком — в
 * героя, рот раскрыт рёвом, глаза алые. Потом осаживается.
 */
function idolWrath(r: IdolRig, t: number, from: IdolRig): void {
  const jerk = seg(t, 0, 0.09);
  const jerkK = eOut(jerk);
  const settle = eInOut(seg(t, 0.55, 1.1));
  const k = jerkK * (1 - settle);
  const back = mixArm(from.R, ARM.reach, jerkK);
  r.R = mixArm(back, ARM.rest, settle, [62, 44], [60, 44]);
  r.L = mixArm(from.L, mirrorArm(ARM.grip), jerkK);
  if (settle > 0) r.L = mixArm(r.L, mirrorArm(ARM.rest), settle);
  r.ty = lerp(from.ty, 3, jerkK) * (1 - settle);
  r.hy = lerp(from.hy, 4, jerkK) * (1 - settle);
  r.nod = lerp(from.nod, 1, jerkK) * (1 - settle);
  r.brow = k;
  r.jaw = t < 0.09 ? jerk * 2 : 2 * (1 - settle);
  r.mouth = k;
  r.eyeMode = settle > 0.6 ? 'dim' : 'wrath';
  r.eye = 1 - settle * 0.5;
  r.rune = from.rune;
  r.runeArm = 1;
  r.runeK = (1 - seg(t, 0.2, 0.6)) * 1;
  r.crack += 0.5 * k;
  r.cloth = k * 2 - settle * 0;
}

/**
 * Удар ладонью (фаза гнева), 24 к/с от начала: подготовка (вес на другую
 * сторону, кисть с колена), подъём по дуге наружу и вверх, зависание с
 * откинутым корпусом, обрушение за три кадра со следом, контакт РОВНО в миг
 * урона (0,95 с), проводка (ладонь вдавливается, корпус доезжает), возврат.
 */
const SLAM_HIT = 0.95;
const SLAM_END = 1.8;
/** Путь кисти при обрушении (правая рука): от высшей точки дугой наружу — к полу. */
const SLAM_PATH = [56, 1, 65, 34, ARM_HIT_W[0], ARM_HIT_W[1]];
function slamPath(k: number): [number, number] {
  const [ax, ay, cx, cy, bx, by] = SLAM_PATH;
  const u = 1 - k;
  return [u * u * ax + 2 * u * k * cx + k * k * bx, u * u * ay + 2 * u * k * cy + k * k * by];
}
/** Правая рука удара ладонью в миг tq; `from` — с чего началась, `back` — куда вернётся. */
function slamArm(tq: number, from: Arm, back: Arm): Arm {
  const ant = eInOut(seg(tq, 0, 0.14));
  const raise = seg(tq, 0.1, 0.56);
  const hover = seg(tq, 0.56, 0.86);
  const smash = seg(tq, 0.86, SLAM_HIT);
  const after = seg(tq, SLAM_HIT, 1.25);
  const ret = eInOut(seg(tq, 1.25, SLAM_END));
  if (tq >= SLAM_HIT) {
    // Проводка: ладонь вдавливается, пальцы растопырены; потом — назад по дуге.
    let A: Arm = { ...ARM.hit, wy: ARM.hit.wy + Math.sin(after * Math.PI) * 1.5 };
    if (ret > 0) A = mixArm(A, back, ret, [63, 52], [65, 40]);
    return A;
  }
  let A = mixArm(from, ARM.lift, ant);
  if (raise > 0) A = mixArm(A, ARM.apex, eInOut(raise), [67, 30], [67, 30]);
  if (hover > 0) {
    // Зависание: кисть ещё ползёт вверх — натяжение, а не стоп.
    A = { ...A, wy: A.wy - eOut(hover) * 2, ey: A.ey - eOut(hover) };
  }
  if (smash > 0) {
    // Обрушение по дуге наружу и вниз, к полу перед правой ступнёй.
    const [x, y] = slamPath(smash);
    A = {
      ex: lerp(A.ex, ARM.hit.ex, smash) + Math.sin(smash * Math.PI) * 4,
      ey: lerp(A.ey, ARM.hit.ey, smash),
      wx: x,
      wy: y,
      hand: smash > 0.4 ? 'flat' : 'palm',
    };
  }
  return A;
}

/**
 * Удар ладонью (фаза гнева), 24 к/с от начала: подготовка (вес на другую
 * сторону, кисть с колена), подъём по дуге наружу и вверх, зависание с
 * откинутым корпусом, обрушение за два кадра со следом и тенью руки,
 * контакт РОВНО в миг урона (0,95 с), проводка (ладонь вдавливается,
 * корпус доезжает), возврат по дуге.
 */
function idolSlam(r: IdolRig, t: number, side: number): void {
  const mir = (a: Arm) => (side > 0 ? a : mirrorArm(a));
  const other = side > 0 ? 'L' : 'R';
  const mine = side > 0 ? 'R' : 'L';
  const tq = q24(t, SLAM_HIT);
  // Куда рука вернётся: поза состояния (заповедь могла начаться, пока бил).
  const back = mir(r[mine]);
  const from = mir(r[mine]);
  const ant = eInOut(seg(tq, 0, 0.14));
  const raise = seg(tq, 0.1, 0.56);
  const hover = seg(tq, 0.56, 0.86);
  const smash = seg(tq, 0.86, SLAM_HIT);
  const after = seg(tq, SLAM_HIT, 1.25);
  const ret = eInOut(seg(tq, 1.25, SLAM_END));
  r[mine] = mir(slamArm(tq, from, back));
  // Вторая рука упирается в колено.
  r[other] = mixArm(r[other], side > 0 ? mirrorArm(ARM.grip) : ARM.grip, ant * (1 - ret));
  // Корпус: отклон назад и от руки на замахе, бросок вперёд на ударе.
  const hit = tq >= SLAM_HIT;
  const lean = hit ? 0 : -eOut(raise) * 1.5 - eOut(hover) * 0.6;
  const lunge = hit ? ((1 - eOut(after)) * 4.5 + eOut(after) * 3.2) * (1 - ret) : eIn(smash) * 4;
  r.ty += lean * (1 - smash) + lunge;
  r.tx += hit ? side * 2 * (1 - ret) : -side * eOut(raise) * (1 - smash) + side * eIn(smash) * 2;
  r.hy += lean * (1 - smash) + lunge * 0.8;
  r.nod = tq < 0.86 ? -eOut(raise) : 1 - ret;
  r.turn = side * (raise > 0.3 ? 1 : 0) * (1 - ret);
  r.brow = eOut(raise) * (1 - ret);
  r.jaw = smash > 0.5 && ret < 0.5 ? 1 : 0;
  r.eyeMode = 'wrath';
  r.eye = 0.55 + 0.45 * eOut(raise) * (1 - ret);
  r.cloth = side * (smash > 0 ? 2 : 0) * (1 - after) - side * eOut(raise) * (1 - smash);
  // След: полоса там, где прошла кисть, и тень руки кадром раньше.
  if (smash > 0 && !hit) {
    r.smear = [side, 0, smash, 1];
    r.ghost = mir(slamArm(tq - 1 / 24, from, back));
  } else if (hit && tq < SLAM_HIT + 0.09) {
    const f = tq < SLAM_HIT + 0.04 ? 1 : 0.45;
    r.smear = [side, 0.3, 1, f];
    if (f > 0.5) r.ghost = mir(slamArm(SLAM_HIT - 1 / 24, from, back));
  }
  if (after > 0 && after < 1) {
    // Крошка с плеча и предплечья от удара.
    const k = after;
    const sx = 32 + side * 20;
    r.crumbs.push(sx - side * 2, 27 + k * k * 30, sx + side * 4, 34 + k * k * 34);
  }
}

/** Смена фазы: рык — голова назад, кулаки с колен, трещины вспыхивают. */
function roarRig(base: IdolRig, t: number): IdolRig {
  const r = { ...base, L: base.L, R: base.R, crumbs: [...base.crumbs] };
  r.ty = base.ty - 1;
  r.hy = base.hy - 3;
  r.nod = -1;
  r.jaw = 2;
  r.mouth = 1;
  r.brow = 1;
  r.L = mirrorArm(ARM.roar);
  r.R = ARM.roar;
  r.eyeMode = 'wrath';
  r.eye = 1;
  r.crack = 1;
  r.cloth = 0;
  const k = seg(t, 0.1, 0.8);
  for (let i = 0; i < 4; i++) {
    const tt = (k * 1.4 + i * 0.27) % 1;
    const s = i % 2 ? 1 : -1;
    r.crumbs.push(32 + s * (14 + i * 2), 24 + tt * tt * 36);
  }
  return r;
}

/** Спящий идол до боя: голова склонена, глаза тёмные. */
function dormantRig(): IdolRig {
  const r = restRig();
  r.hy = 2;
  r.nod = 1;
  r.eye = 0;
  r.eyeMode = 'off';
  return r;
}

/** Пробуждение в начале боя: глаза мигают и загораются, голова поднимается. */
function wakeRig(base: IdolRig, t: number): IdolRig {
  const r = { ...base, crumbs: [...base.crumbs] };
  const lift = eInOut(seg(t, 0.35, 1.0));
  r.hy = base.hy + (1 - lift) * 2;
  r.nod = (1 - lift) * 1;
  const flick = t < 0.35 ? (Math.floor(t * 20) % 3 === 1 ? 0.6 : 0) : 1;
  r.eye = base.eye * flick;
  r.eyeMode = flick ? base.eyeMode : 'off';
  if (t > 0.3 && t < 1.2) {
    for (let i = 0; i < 5; i++) {
      const tt = seg(t, 0.3 + i * 0.12, 0.75 + i * 0.12);
      if (tt <= 0 || tt >= 1) continue;
      const s = i % 2 ? 1 : -1;
      r.crumbs.push(32 + s * (6 + i * 3), 2 + i + tt * tt * (40 - i * 3));
    }
  }
  return r;
}

// ---- Кадр --------------------------------------------------------------------

/** Кеш частей (торс, голова, неподвижное) — их мало, кадров из них — сотни. */
const idolParts = frameLRU<{ p: Px; box: number[] }>(90);
function idolPart(key: string, make: (p: OPx) => void): { p: Px; box: number[] } {
  let got = idolParts.get(key);
  if (!got) {
    const p = new OPx(ID_W, ID_H, ID_OX, ID_OY);
    make(p);
    got = { p, box: boxOf(p) };
    idolParts.set(key, got);
  }
  return got;
}

/** Сколько трещин и какая растёт — части тела с их трещинами. */
function crackSet(
  on: 'torso' | 'head' | 'legs',
  n: number,
  grow: number,
  death: number,
): { list: number[][][]; last: number; key: string } {
  const list: number[][][] = [];
  let last = -1;
  for (let i = 0; i < Math.min(n, IDOL_CRACKS.length); i++)
    if (IDOL_CRACKS[i].on === on) {
      list.push(IDOL_CRACKS[i].pts);
      if (i === n - 1) last = list.length - 1;
    }
  const g = last >= 0 ? stepN(grow, 5) : 5;
  const dk = stepN(death, 6);
  return { list, last, key: `${on}|${n}|${g}|${dk}` };
}

function paintCracks(
  p: Px,
  set: { list: number[][][]; last: number },
  on: 'torso' | 'head' | 'legs',
  grow: number,
  death: number,
): void {
  set.list.forEach((pts, i) =>
    polyPart(p, pts, i === set.last ? stepN(grow, 5) / 5 : 1, 0, 0, BASALT.deep),
  );
  if (death > 0)
    for (const c of DEATH_CRACKS)
      if (c.on === on) polyPart(p, c.pts, stepN(death, 6) / 6, 0, 0, BASALT.deep);
}

interface IdolFrameIn {
  rig: IdolRig;
  cracks: number;
}

/** Ключ кадра тела: всё, что меняет пиксели тела (свет — отдельно). */
function idolBodyKey(r: IdolRig, cracks: number): string {
  const R = Math.round;
  const armKey = (a: Arm) => `${R(a.ex)},${R(a.ey)},${R(a.wx)},${R(a.wy)},${a.hand}`;
  return [
    R(r.tx),
    R(r.ty),
    R(r.hx),
    R(r.hy),
    R(r.nod),
    R(r.turn),
    R(r.jaw),
    R(r.brow),
    armKey(r.L),
    armKey(r.R),
    stepN(r.door / 1.15, 8),
    R(r.cloth),
    r.rune && r.runeK > 0 ? r.rune : 0,
    r.smoke,
    r.crumbs.map((v) => R(v)).join(','),
    r.smear ? r.smear.map((v) => R(v * 24)).join(',') : '',
    r.ghost ? armKey(r.ghost) : '',
    cracks,
    stepN(r.grow, 5),
    stepN(r.deathK, 6),
    r.third > 0.5 ? 1 : 0,
  ].join('|');
}

/**
 * Кадр тела. `tint` — вспышка (удар героя, раскол): белеет только сам
 * идол, трон остаётся камнем.
 */
function paintIdolBody(r: IdolRig, cracks: number, tint: RGBA | null = null, tk = 0.7): Px {
  const R = Math.round;
  const p = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  const throne = idolPart('throne', paintThrone);
  p.data.set(throne.p.data);
  const legs = crackSet('legs', cracks, r.grow, r.deathK);
  const lp = idolPart(`legs|${legs.key}`, (q) => {
    paintLegs(q);
    paintCracks(q, legs, 'legs', r.grow, r.deathK);
  });
  blit(p, lp.p, 0, 0, lp.box);
  paintCloth(p, R(r.cloth));
  const tx = R(r.tx);
  const ty = R(r.ty);
  const tc = crackSet('torso', cracks, r.grow, r.deathK);
  const door = stepN(r.door / 1.15, 8);
  const torso = idolPart(`torso|${tc.key}|${door}`, (q) => {
    paintTorso(q, (door / 8) * 1.15);
    paintCracks(q, tc, 'torso', r.grow, r.deathK);
  });
  blit(p, torso.p, tx, ty, torso.box);
  const hc = crackSet('head', cracks, r.grow, r.deathK);
  const nod = Math.max(-1, Math.min(1, R(r.nod)));
  const turn = Math.max(-1, Math.min(1, R(r.turn)));
  const jaw = Math.max(0, Math.min(2, R(r.jaw)));
  const brow = r.brow >= 0.5 ? 1 : 0;
  const third = r.third > 0.5;
  const head = idolPart(`head|${hc.key}|${nod}|${turn}|${jaw}|${brow}|${third ? 1 : 0}`, (q) => {
    paintHead(q, nod, turn, jaw, brow, third);
    paintCracks(q, hc, 'head', r.grow, r.deathK);
  });
  blit(p, head.p, tx + R(r.hx), ty + R(r.hy), head.box);
  const armOf = (a: Arm): Arm => ({
    ...a,
    ex: R(a.ex),
    ey: R(a.ey),
    wx: R(a.wx),
    wy: R(a.wy),
  });
  // След удара: пыль и воздух там, где прошла рука, и её тень кадром
  // раньше — под самой рукой.
  if (r.smear) paintSmear(p, r.smear);
  if (r.ghost) {
    const side = r.smear ? r.smear[0] : 1;
    paintGhostArm(p, side, 32 + side * 18 + tx, 29 + ty, armOf(r.ghost));
  }
  const rune = r.rune && r.runeK > 0 ? r.rune : 0;
  paintArm(p, -1, 14 + tx, 29 + ty, armOf(r.L), r.runeArm < 0 ? rune : 0);
  paintArm(p, 1, 50 + tx, 29 + ty, armOf(r.R), r.runeArm > 0 ? rune : 0);
  // Дым из погасших глазниц.
  if (r.smoke >= 0) {
    const hx = tx + R(r.hx);
    const hy = ty + R(r.hy) + nod;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const k = (r.smoke + i * 1.33) % 4;
        const x = 32 + s * 5 + hx + Math.round(Math.sin(k * 1.7 + s) * 1);
        const y = 11 + hy - Math.round(k * 2.2);
        p.set(x, y, hex('#8a857a', Math.round(150 - k * 34)));
      }
    }
  }
  for (let i = 0; i + 1 < r.crumbs.length; i += 2) {
    const x = R(r.crumbs[i]);
    const y = R(r.crumbs[i + 1]);
    p.set(x, y, BASALT.lit);
    p.set(x, y + 1, BASALT.sh);
  }
  if (tint) {
    // Белеет всё, что не трон: там, где кадр отличается от голого трона.
    const d = p.data;
    const t0 = throne.p.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      if (
        d[i] === t0[i] &&
        d[i + 1] === t0[i + 1] &&
        d[i + 2] === t0[i + 2] &&
        d[i + 3] === t0[i + 3]
      )
        continue;
      d[i] += (tint[0] - d[i]) * tk;
      d[i + 1] += (tint[1] - d[i + 1]) * tk;
      d[i + 2] += (tint[2] - d[i + 2]) * tk;
    }
  }
  outlineRaw(p, INK);
  return p;
}

/**
 * След обрушения руки: полоса пыли-воздуха по пути кисти (доли k0…k1),
 * толще и ярче к кисти, со светлой жилой посередине. Прозрачность — по
 * максимуму, а не накоплением: иначе середина полосы слипалась бы в пятно.
 */
function paintSmear(p: OPx, sm: number[]): void {
  const [side, k0, k1, fade] = sm;
  const W = ID_W;
  const acc = new Float32Array(ID_W * ID_H);
  const core = new Float32Array(ID_W * ID_H);
  const put = (m: Float32Array, x: number, y: number, a: number) => {
    const X = Math.round(x) + ID_OX;
    const Y = Math.round(y) + ID_OY;
    if (X < 0 || Y < 0 || X >= W || Y >= ID_H) return;
    const i = Y * W + X;
    if (m[i] < a) m[i] = a;
  };
  for (let k = k0; k <= k1 + 1e-6; k += 0.02) {
    const [px, py] = slamPath(k);
    const x = side > 0 ? px : 64 - px;
    const f = (k - k0) / Math.max(0.01, k1 - k0);
    const w = 1.2 + f * 3.4;
    const a = (50 + 150 * f) * fade;
    const c = Math.ceil(w);
    for (let dy = -c; dy <= c; dy++)
      for (let dx = -c; dx <= c; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 <= w * w) put(acc, x + dx, py + dy, a * (1 - Math.sqrt(d2) / (w + 1)) + a * 0.3);
      }
    if (f > 0.25) put(core, x, py, (120 + 135 * f) * fade);
  }
  const dust = hex('#d8d0bc');
  const hot = hex('#fff6e0');
  for (let i = 0; i < acc.length; i++) {
    if (acc[i] > 0)
      Px.prototype.set.call(p, i % W, Math.floor(i / W), [
        dust[0],
        dust[1],
        dust[2],
        Math.min(210, Math.round(acc[i])),
      ] as RGBA);
    if (core[i] > 0)
      Px.prototype.set.call(p, i % W, Math.floor(i / W), [
        hot[0],
        hot[1],
        hot[2],
        Math.min(235, Math.round(core[i])),
      ] as RGBA);
  }
}

/** Тень руки кадром раньше: светлый полупрозрачный силуэт позади настоящей. */
function paintGhostArm(p: OPx, side: number, sx: number, sy: number, a: Arm): void {
  const g = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  paintArm(g, side, sx, sy, a, 0);
  const dust = hex('#d8d0bc');
  for (let i = 0; i < g.data.length; i += 4) {
    if (!g.data[i + 3]) continue;
    const c: RGBA = [
      Math.round((g.data[i] + dust[0]) / 2),
      Math.round((g.data[i + 1] + dust[1]) / 2),
      Math.round((g.data[i + 2] + dust[2]) / 2),
      110,
    ];
    const px = (i / 4) % ID_W;
    const py = Math.floor(i / 4 / ID_W);
    Px.prototype.set.call(p, px, py, c);
  }
}

/** Ключ и рисунок слоя света: глаза, третий глаз, знак, сердце, трещины. */
function idolLitKey(r: IdolRig, cracks: number, lx: number, ly: number): string {
  const R = Math.round;
  return [
    R(r.tx),
    R(r.ty),
    R(r.hx),
    R(r.hy),
    Math.max(-1, Math.min(1, R(r.nod))),
    Math.max(-1, Math.min(1, R(r.turn))),
    r.brow >= 0.5 ? 1 : 0,
    Math.max(0, Math.min(2, R(r.jaw))),
    r.eyeMode,
    stepN(r.eye, 6),
    stepN(r.third, 3),
    r.rune,
    stepN(r.runeK, 4),
    r.runeK > 0 ? `${R(r.R.wx)},${R(r.R.wy)},${R(r.R.ex)},${R(r.R.ey)}` : '',
    stepN(r.core, 5),
    stepN(r.door / 1.15, 8),
    stepN(r.crack, 5),
    stepN(r.beam, 3),
    stepN(r.mouth, 3),
    stepN(r.ember, 2),
    cracks,
    stepN(r.grow, 5),
    stepN(r.deathK, 6),
    lx,
    ly,
  ].join('|');
}

const EYE_COLOR: Record<IdolEyes, RGBA> = {
  off: hex('#000000', 0),
  dim: mix(EYE_AMBER, hex('#6a3a14'), 0.35),
  rule: GOLD.mid,
  open: mix(GOLD.mid, hex('#6a4a14'), 0.3),
  gaze: EYE_RED,
  spent: hex('#b02818'),
  wrath: EYE_RED,
};

function paintIdolLit(r: IdolRig, cracks: number, lx: number, ly: number): Px | null {
  const R = Math.round;
  const p = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  let any = false;
  const tx = R(r.tx);
  const ty = R(r.ty);
  const nod = Math.max(-1, Math.min(1, R(r.nod)));
  const turn = Math.max(-1, Math.min(1, R(r.turn)));
  const hx = tx + R(r.hx) + turn;
  const hy = ty + R(r.hy) + nod;
  const brow = r.brow >= 0.5;
  // Глаза: у взора накал идёт от красного через оранжевый к белому, ореол
  // растёт, свет ложится на скулы.
  const eye = stepN(r.eye, 6) / 6;
  if (r.eyeMode !== 'off' && eye > 0) {
    any = true;
    const gaze = r.eyeMode === 'gaze';
    const hot = gaze
      ? eye < 0.5
        ? mix(EYE_RED, hex('#ff7a2a'), eye * 2)
        : mix(hex('#ff7a2a'), hex('#fff2c0'), (eye - 0.5) * 2)
      : EYE_COLOR[r.eyeMode];
    const core = mix(hot, WHITE, 0.3 + eye * 0.5);
    const tint = (al: number): RGBA => [hot[0], hot[1], hot[2], Math.max(0, Math.min(255, R(al)))];
    for (const s of [-1, 1]) {
      const ex = 32 + s * 5 + hx;
      const ey = 13 + hy;
      const a = 100 + 155 * eye;
      if (eye > 0.45) {
        p.set(ex - 2, ey, tint(110 * eye));
        p.set(ex + 2, ey, tint(110 * eye));
      }
      if (gaze && eye > 0.66) {
        // Ореол: кольцо вокруг глазницы и свет на скуле.
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -4; dx <= 4; dx++) {
            const d = Math.hypot(dx * 0.8, dy);
            if (d < 2.1 || d > 3.2) continue;
            p.set(ex + dx, ey + dy, tint(95 * (eye - 0.5)));
          }
        for (let dx = -1; dx <= 1; dx++) p.set(ex + dx, ey + 3, tint(70 * eye));
      }
      p.rect(ex - 1, ey - (brow ? 0 : 1), ex + 1, ey + 1, tint(a));
      // Зрачок — самый яркий пиксель; смотрит на героя.
      p.set(ex + lx, ey + (brow ? 0 : ly), [core[0], core[1], core[2], Math.min(255, R(a + 40))]);
    }
  }
  // Угольки в погасших глазах.
  if (r.ember > 0 && r.eyeMode === 'spent') {
    any = true;
    for (const s of [-1, 1])
      p.set(32 + s * 5 + hx, 13 + hy + 1, hex('#ff4a1c', R(90 + 90 * r.ember)));
  }
  // Лучи из глаз на залпе: вниз, в зал, чуть врозь; у глаза — толще и
  // белее, к низу кадра — тоньше и краснее. Гаснут за три кадра.
  if (r.beam > 0) {
    any = true;
    const b = stepN(r.beam, 3) / 3;
    for (const s of [-1, 1]) {
      const ex = 32 + s * 5 + hx;
      const ey = 13 + hy;
      // Луч уходит за нижний край кадра — в зал, где его ловит полоса.
      const n = 88 - ey;
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        const x = ex + s * Math.round(i * 0.14);
        const y = ey + i;
        const al = 255 * b * (1 - f * 0.55);
        const core = mix(hex('#fff4d0'), hex('#ff6a3a'), f * 0.8);
        p.set(x, y, [core[0], core[1], core[2], R(al)]);
        if (f < 0.35) p.set(x + s, y, [core[0], core[1], core[2], R(al * 0.8)]);
        p.set(x - 1 + (f < 0.35 && s < 0 ? -1 : 0), y, [255, 90, 50, R(al * 0.45)]);
        p.set(x + 1 + (f < 0.35 && s > 0 ? 1 : 0), y, [255, 90, 50, R(al * 0.45)]);
      }
    }
  }
  // Третий глаз.
  const th = stepN(r.third, 3) / 3;
  if (th > 0) {
    any = true;
    const c = mix(EYE_RED, hex('#fff0d0'), th * 0.5);
    p.rect(32 + hx, 7 + ty + R(r.hy), 32 + hx, 9 + hy, c);
    if (th > 0.6) {
      p.set(31 + hx, 8 + ty + R(r.hy), [c[0], c[1], c[2], 160]);
      p.set(33 + hx, 8 + ty + R(r.hy), [c[0], c[1], c[2], 160]);
    }
  }
  // Пасть: рык светится изнутри.
  const mouth = stepN(r.mouth, 3) / 3;
  const jaw = Math.max(0, Math.min(2, R(r.jaw)));
  if (mouth > 0 && jaw > 0) {
    any = true;
    for (let x = -5; x <= 5; x++) {
      const y = 21 + hy - Math.round((x / 9) ** 2 * 3) + (Math.abs(x) < 6 ? 2 : 1);
      p.set(32 + x + hx, y + jaw - 1, hex('#ff5a28', R(120 + 120 * mouth)));
    }
  }
  // Знак на ладони: сам знак и тонкий ореол вокруг — видно издалека.
  if (r.rune && r.runeK > 0) {
    any = true;
    const A = r.R;
    const wx = R(A.wx);
    const wy = R(A.wy);
    const len = Math.hypot(wx - R(A.ex), wy - R(A.ey)) || 1;
    const ux = (wx - R(A.ex)) / len;
    const uy = (wy - R(A.ey)) / len;
    const vx = -uy;
    const vy = ux;
    const k = stepN(r.runeK, 4) / 4;
    const c = RUNE_COLOR[r.rune] ?? GOLD.hi;
    const cells = runeCells(r.rune).map(([aa, bb]) => [
      Math.round(wx + (aa + 4.8) * ux + bb * vx),
      Math.round(wy + (aa + 4.8) * uy + bb * vy),
    ]);
    // Свечение — на соседях знака, слабее.
    for (const [x, y] of cells)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        p.set(x + dx, y + dy, [c[0], c[1], c[2], R(55 * k)]);
    for (const [x, y] of cells)
      p.set(x, y, mix(c, WHITE, 0.35 * k).map((v, j) => (j === 3 ? R(140 + 115 * k) : v)) as RGBA);
    // Ореол вокруг ладони.
    const cxp = wx + 5.5 * ux;
    const cyp = wy + 5.5 * uy;
    for (let dy = -7; dy <= 7; dy++)
      for (let dx = -7; dx <= 7; dx++) {
        const d = Math.hypot(dx, dy);
        if (d < 5.6 || d > 6.6) continue;
        if ((dx + dy) % 2) continue;
        p.set(R(cxp + dx), R(cyp + dy), [c[0], c[1], c[2], R(70 * k)]);
      }
  }
  // Сердце в раскрытой печати.
  const core = stepN(r.core, 5) / 5;
  const door = stepN(r.door / 1.15, 8) / 8;
  if (core > 0 && door > 0) {
    any = true;
    const cx = 32 + tx;
    const cy = 37 + ty;
    const open = Math.min(5, Math.round(door * 1.15 * 5));
    for (let y = -4; y <= 4; y++)
      for (let x = -open; x <= open; x++) {
        const d = Math.hypot(x, y);
        if (d > 4.3) continue;
        const k = 1 - d / 4.3;
        const c = mix(GOLD.mid, hex('#fffbe8'), k);
        p.set(cx + x, cy + y, [c[0], c[1], c[2], R(255 * core * (0.35 + 0.65 * k))]);
      }
    // Лучи крестом — только когда горит сильно.
    if (core > 0.7)
      for (let i = 5; i <= 8; i++) {
        const a = R(150 * core * (1 - (i - 5) / 4));
        p.set(cx, cy - i, hex('#fff2b0', a));
        p.set(cx, cy + i, hex('#fff2b0', a));
      }
  }
  // Трещины дышат светом изнутри.
  const glow = stepN(r.crack, 5) / 5;
  if (glow > 0) {
    const col = mix(EYE_AMBER, hex('#ffe0a0'), glow * 0.5);
    const lay = (on: 'torso' | 'head' | 'legs', dx: number, dy: number) => {
      const set = crackSet(on, cracks, r.grow, r.deathK);
      set.list.forEach((pts, i) => {
        const k = i === set.last ? stepN(r.grow, 5) / 5 : 1;
        polyPart(p, pts, k, dx, dy, [col[0], col[1], col[2], R(60 + 150 * glow)]);
        if (i === set.last && k < 1) {
          const [x, y] = polyTip(pts, k);
          p.set(R(x + dx), R(y + dy), WHITE);
        }
      });
      if (r.deathK > 0)
        for (const c of DEATH_CRACKS)
          if (c.on === on)
            polyPart(p, c.pts, stepN(r.deathK, 6) / 6, dx, dy, [
              255,
              240,
              200,
              R(120 + 135 * glow),
            ]);
    };
    lay('legs', 0, 0);
    lay('torso', tx, ty);
    lay('head', tx + R(r.hx), ty + R(r.hy));
    // Шов печати светится тонкой нитью, пока она закрыта.
    if (door <= 0) {
      const a = R(40 + 80 * glow);
      p.rect(32 + tx, 33 + ty, 32 + tx, 41 + ty, hex('#ffb040', a));
    }
    any = true;
  }
  // Рубин венца.
  p.set(32 + tx + R(r.hx), 6 + ty + R(r.hy), hex('#ff6a50', R(140 + 60 * eye)));
  return any ? p : null;
}

// ---- Смерть: трещины, распад, голова катится к подножию ----------------------

/** Сколько длится сцена смерти (движок держит копию моба, `linger`). */
const IDOL_LINGER = 1.5;
/** Линия раскола: выше неё торс отваливается, ниже — остаётся пнём. */
const cutY = (x: number) => 35 + Math.abs(x - 34) * 0.45 + ((x * 7) % 3);

/** Поза, в которой идол застывает перед распадом. */
function deathRig(t: number): IdolRig {
  const r = restRig();
  const flare = eOut(seg(t, 0, 0.12));
  const sink = eIn(seg(t, 0.2, 0.6));
  r.hy = -3 * flare + sink * 1;
  r.ty = -1 * flare;
  r.nod = -flare;
  r.jaw = 2 * flare;
  r.mouth = flare;
  r.brow = 0;
  r.L = mixArm(mirrorArm(ARM.rest), mirrorArm(ARM.roar), flare);
  r.R = mixArm(ARM.rest, ARM.roar, flare);
  r.eyeMode = 'gaze';
  r.eye = t < 0.55 ? 1 : 1;
  r.third = flare;
  r.crack = 1;
  r.deathK = seg(t, 0.1, 0.52);
  r.grow = 1;
  r.cloth = flare * -1;
  // Крошка сыплется отовсюду — камень уже не держит.
  const k = seg(t, 0.15, 0.62);
  if (k > 0 && k < 1)
    for (let i = 0; i < 6; i++) {
      const tt = (k * 2.2 + i * 0.19) % 1;
      const s = i % 2 ? 1 : -1;
      r.crumbs.push(32 + s * (5 + i * 3), 20 + i * 2 + tt * tt * 34);
    }
  return r;
}

/** Части распада: пень (низ живота) и две половины верха с руками. */
interface IdolWreck {
  stump: Px;
  halves: [Px, Px];
  boxes: [number[], number[]];
  head: Px;
  headBox: number[];
  /** Где голова стоит в миг раскола и куда падает (сдвиги кадра). */
  headFrom: [number, number];
  headTo: [number, number];
  /** Голова на боку — последние кадры и предмет «разбит». */
  lying: Px;
  lyingBox: number[];
  /** Та же голова стоймя с сомкнутой ухмылкой — для кадров поворота. */
  still: Px;
  stillBox: number[];
  chunks: Px;
}

let wreckCache: IdolWreck | null = null;
/** Миг раскола и поза, в которой идол застыл перед ним. */
const BREAK_T = 0.62;

/** Разобрать позу распада на куски — один раз на игру. */
function idolWreck(): IdolWreck {
  if (wreckCache) return wreckCache;
  const r = deathRig(BREAK_T - 0.01);
  const R = Math.round;
  const tx = R(r.tx);
  const ty = R(r.ty);
  // Тело без трона: торс и руки — ровно как в последнем кадре до раскола.
  const body = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  const tc = crackSet('torso', 6, 1, 1);
  const torso = idolPart(`torso|${tc.key}|0`, (q) => {
    paintTorso(q, 0);
    paintCracks(q, tc, 'torso', 1, 1);
  });
  blit(body, torso.p, tx, ty, torso.box);
  const armOf = (a: Arm): Arm => ({ ...a, ex: R(a.ex), ey: R(a.ey), wx: R(a.wx), wy: R(a.wy) });
  paintArm(body, -1, 14 + tx, 29 + ty, armOf(r.L), 0);
  paintArm(body, 1, 50 + tx, 29 + ty, armOf(r.R), 0);
  const stump = new Px(ID_W, ID_H);
  const left = new Px(ID_W, ID_H);
  const right = new Px(ID_W, ID_H);
  for (let y = 0; y < ID_H; y++)
    for (let x = 0; x < ID_W; x++) {
      const i = (y * ID_W + x) * 4;
      if (!body.data[i + 3]) continue;
      const dx = x - ID_OX;
      const dy = y - ID_OY;
      const dst = dy >= cutY(dx) ? stump : dx < 32 ? left : right;
      for (let k = 0; k < 4; k++) dst.data[i + k] = body.data[i + k];
    }
  // Шов раскола по пню — свежий излом светлее.
  for (let x = 12; x <= 52; x++) {
    const y = Math.ceil(cutY(x));
    const i = ((y + ID_OY) * ID_W + x + ID_OX) * 4;
    if (stump.data[i + 3]) {
      stump.data[i] = BASALT.lit[0];
      stump.data[i + 1] = BASALT.lit[1];
      stump.data[i + 2] = BASALT.lit[2];
    }
  }
  // Голова в миг раскола — та же, что в кадре до него (рык, третий глаз).
  const hc = crackSet('head', 6, 1, 1);
  const nod = Math.max(-1, Math.min(1, R(r.nod)));
  const jaw = Math.max(0, Math.min(2, R(r.jaw)));
  const third = r.third > 0.5;
  const head = idolPart(`head|${hc.key}|${nod}|0|${jaw}|0|${third ? 1 : 0}`, (q) => {
    paintHead(q, nod, 0, jaw, 0, third);
    paintCracks(q, hc, 'head', 1, 1);
  });
  // Лежит она уже с сомкнутой ухмылкой — повернуть на четверть по часовой
  // можно без потерь пикселей.
  const still = idolPart(`head|${hc.key}|0|0|0|0|0`, (q) => {
    paintHead(q, 0, 0, 0, 0, false);
    paintCracks(q, hc, 'head', 1, 1);
  });
  const [x0, y0, x1, y1] = still.box;
  const lying = new Px(ID_W, ID_H);
  const hw = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  // Центр лежащей головы — на полу у подножия, справа от середины.
  const cxL = 48 + ID_OX;
  const cyL = 75 + ID_OY;
  const lx0 = Math.round(cxL - hh / 2);
  const ly0 = Math.round(cyL - hw / 2);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * ID_W + x) * 4;
      if (!still.p.data[i + 3]) continue;
      const nx = lx0 + (y1 - y);
      const ny = ly0 + (x - x0);
      if (nx < 0 || ny < 0 || nx >= ID_W || ny >= ID_H) continue;
      const j = (ny * ID_W + nx) * 4;
      for (let k = 0; k < 4; k++) lying.data[j + k] = still.p.data[i + k];
    }
  const headFrom: [number, number] = [tx + R(r.hx), ty + R(r.hy)];
  const [hx0, hy0, hx1, hy1] = head.box;
  const headTo: [number, number] = [
    Math.round(cxL - (hx0 + hx1) / 2),
    Math.round(cyL - (hy0 + hy1) / 2),
  ];
  // Обломки там, где разбились половины торса: слева у подножия, справа на
  // ступени у колонны.
  const chunks = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  for (const [x, y, w, h] of [
    [1, 66, 7, 4],
    [8, 68, 5, 3],
    [3, 71, 4, 2],
    [13, 69, 3, 2],
    [51, 55, 5, 3],
    [55, 59, 4, 4],
    [49, 60, 3, 2],
  ])
    basaltRect(chunks, x, y, x + w, y + h);
  chunks.rect(4, 66, 8, 66, GOLD.dk);
  chunks.rect(52, 55, 55, 55, GOLD.mid);
  wreckCache = {
    stump,
    halves: [left, right],
    boxes: [boxOf(left), boxOf(right)],
    head: head.p,
    headBox: head.box,
    headFrom,
    headTo,
    lying,
    lyingBox: boxOf(lying),
    still: still.p,
    stillBox: still.box,
    chunks,
  };
  return wreckCache;
}

/** Пыль от удара о пол: клочья по 2 точки расходятся, поднимаются и тают. */
function dustAt(p: OPx, x: number, y: number, k: number, w: number, seed: number): void {
  if (k <= 0 || k >= 1) return;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI + ((seed * 13 + i * 7) % 5) * 0.08;
    const d = w * (0.25 + 0.75 * eOut(k));
    const px = Math.round(x + Math.cos(a) * d);
    const py = Math.round(y - Math.sin(a) * d * 0.3 - k * 3);
    const al = Math.round(160 * (1 - k));
    const c = i % 2 ? hex('#b8b2a0', al) : hex('#d0caba', al);
    p.set(px, py, c);
    if (k < 0.6) {
      p.set(px + 1, py, c);
      p.set(px, py - 1, hex('#d8d2c0', Math.round(al * 0.5)));
    }
  }
}

/**
 * Половина торса бьётся о пол и рассыпается: картинка режется на куски 6×6,
 * каждый отлетает от середины низа и падает — два кадра, пока пыль не
 * накроет подмену на обломки.
 */
function shatterBlit(p: Px, src: Px, box: number[], dx: number, dy: number, k: number): void {
  const [x0, y0, x1, y1] = box;
  const cx = (x0 + x1) / 2;
  const w = p.w;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      if (!src.data[i + 3]) continue;
      const bx = Math.floor((x - x0) / 6);
      const by = Math.floor((y - y0) / 6);
      const cxb = x0 + bx * 6 + 3;
      const spread = (cxb - cx) / 6;
      const up = (y1 - (y0 + by * 6)) / 6;
      const jit = ((bx * 7 + by * 13) % 5) - 2;
      const tx = Math.round(x + dx + spread * k * 5 + jit * k);
      const ty = Math.round(y + dy - up * k * 3 + k * k * 6);
      if (tx < 0 || ty < 0 || tx >= w || ty >= p.h) continue;
      const j = (ty * w + tx) * 4;
      for (let c = 0; c < 4; c++) p.data[j + c] = src.data[i + c];
    }
}

/**
 * Поворот куска вокруг его середины — кадр-другой, пока голова валится на
 * бок. Ближайший пиксель: в движении рваный край не читается.
 */
function rotBlit(p: Px, src: Px, box: number[], ang: number, dcx: number, dcy: number): void {
  const [x0, y0, x1, y1] = box;
  const scx = (x0 + x1 + 1) / 2;
  const scy = (y0 + y1 + 1) / 2;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const rad = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2) + 1;
  for (let y = Math.floor(dcy - rad); y <= Math.ceil(dcy + rad); y++)
    for (let x = Math.floor(dcx - rad); x <= Math.ceil(dcx + rad); x++) {
      if (x < 0 || y < 0 || x >= p.w || y >= p.h) continue;
      const vx = x + 0.5 - dcx;
      const vy = y + 0.5 - dcy;
      const sx = Math.floor(scx + c * vx + sn * vy);
      const sy = Math.floor(scy - sn * vx + c * vy);
      if (sx < x0 || sy < y0 || sx > x1 || sy > y1) continue;
      const i = (sy * src.w + sx) * 4;
      if (!src.data[i + 3]) continue;
      const j = (y * p.w + x) * 4;
      for (let k = 0; k < 4; k++) p.data[j + k] = src.data[i + k];
    }
}

/** Клуб пыли: плотный в первые кадры — под ним одна картинка сменяет другую. */
function dustCloud(p: OPx, x: number, y: number, k: number, w: number, seed: number): void {
  if (k <= 0 || k >= 1) return;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI + (((seed * 13 + i * 7) % 5) - 2) * 0.1;
    const d = w * (0.15 + 0.85 * eOut(k)) * (0.6 + ((i * 5 + seed) % 4) * 0.13);
    const px = Math.round(x + Math.cos(a) * d);
    const py = Math.round(y - Math.sin(a) * d * 0.45 - k * 4);
    const al = Math.round(200 * (1 - k) * (1 - k * 0.4));
    const c = i % 3 ? hex('#aaa494', al) : hex('#cfc9b8', al);
    const sz = k < 0.35 ? 2 : k < 0.7 ? 1 : 0;
    for (let yy = 0; yy <= sz; yy++) for (let xx = 0; xx <= sz; xx++) p.set(px + xx, py - yy, c);
  }
}

/** Кадр распада после раскола (t ≥ BREAK_T). */
function paintIdolCollapse(t: number): Px {
  const W = idolWreck();
  const p = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  const legs = crackSet('legs', 6, 1, 1);
  const base = idolPart(`base|${legs.key}`, (q) => {
    paintThrone(q);
    paintLegs(q);
    paintCracks(q, legs, 'legs', 1, 1);
  });
  p.data.set(base.p.data);
  paintCloth(p, 0);
  blit(p, W.stump, 0, 0, boxOf(W.stump));
  const tt = t - BREAK_T;
  // Половины торса: расходятся по шву, падают с разгоном, бьются и крошатся.
  const LAND = 0.3;
  const CRUMBLE = 2 / 24;
  if (tt < LAND) {
    const k = tt / LAND;
    blit(p, W.halves[0], -Math.round(1 + k * 8), Math.round(k * k * 30), W.boxes[0]);
    blit(p, W.halves[1], Math.round(1 + k * 6), Math.round(k * k * 22), W.boxes[1]);
  } else {
    const c = (tt - LAND) / CRUMBLE;
    if (c < 1) {
      // Удар о пол: половины рассыпаются на куски, обломки уже лежат под ними.
      blit(p, W.chunks, 0, 0, boxOf(W.chunks));
      shatterBlit(p, W.halves[0], W.boxes[0], -9, 30, 0.5 + c * 0.5);
      shatterBlit(p, W.halves[1], W.boxes[1], 7, 22, 0.5 + c * 0.5);
    } else blit(p, W.chunks, 0, 0, boxOf(W.chunks));
    dustCloud(p, 8, 72, (tt - LAND) / 0.55, 15, 1);
    dustCloud(p, 54, 62, (tt - LAND) / 0.55, 12, 2);
  }
  // Голова: раскол подбрасывает её, она падает дугой к подножию, отскакивает
  // и валится на бок.
  const HL = 0.36;
  const [fx, fy] = W.headFrom;
  const [ex, ey] = W.headTo;
  if (tt < HL) {
    const k = tt / HL;
    const dx = lerp(fx, ex, k);
    const dy = lerp(fy, ey, k * k) - Math.sin(k * Math.PI) * 6;
    blit(p, W.head, Math.round(dx), Math.round(dy), W.headBox);
  } else if (tt < HL + 0.1) {
    // Отскок: подпрыгнула на три точки.
    const k = (tt - HL) / 0.1;
    blit(p, W.head, ex, Math.round(ey - Math.sin(k * Math.PI) * 3), W.headBox);
    dustAt(p, 48, 87, k * 0.5, 12, 4);
  } else if (tt < HL + 0.1 + 2 / 24) {
    // Валится на бок: два кадра поворота, на втором — почти лёжа.
    const k = tt - HL - 0.1 < 1 / 24 ? 0.33 : 0.72;
    const [hx0, hy0, hx1, hy1] = W.headBox;
    const cx = (hx0 + hx1 + 1) / 2 + ex;
    const cy = (hy0 + hy1 + 1) / 2 + ey;
    rotBlit(p, W.still, W.stillBox, (k * Math.PI) / 2, cx + k * 1, cy + k * 1);
    dustAt(p, 48, 87, 0.5, 12, 4);
  } else {
    blit(p, W.lying, 0, 0, W.lyingBox);
    dustCloud(p, 50, 86, (tt - HL - 0.1 - 2 / 24) / 0.5, 11, 3);
    dustAt(p, 48, 87, 0.5 + (tt - HL - 0.1) / 0.8, 12, 3);
  }
  outlineRaw(p, INK);
  return p;
}

/** Идол разбит — последний кадр сцены смерти; им же рисуется трон после боя. */
function paintIdolBroken(): Px {
  return paintIdolCollapse(IDOL_LINGER);
}

/** Свет сцены смерти: трещины горят, в миг раскола — вспышка, потом гаснет. */
function paintIdolDeathLit(t: number): Px | null {
  if (t < BREAK_T) return paintIdolLit(deathRig(t), 6, 0, 0);
  const k = 1 - seg(t, BREAK_T, 1.2);
  if (k <= 0) return null;
  const p = new OPx(ID_W, ID_H, ID_OX, ID_OY);
  const set = crackSet('legs', 6, 1, 1);
  const a = Math.round(220 * k);
  for (const pts of set.list) polyPart(p, pts, 1, 0, 0, hex('#ffe0a0', a));
  for (const c of DEATH_CRACKS) if (c.on === 'legs') polyPart(p, c.pts, 1, 0, 0, hex('#fff4d8', a));
  // Излом пня тлеет.
  for (let x = 14; x <= 50; x++) p.set(x, Math.ceil(cutY(x)), hex('#ffb040', Math.round(200 * k)));
  return p;
}

// ---- Рисовальщик -------------------------------------------------------------

/** Память по мобу: куда смотрит, когда получил удар. Только для картинки. */
interface IdolMem {
  lx: number;
  ly: number;
  lookAt: number;
  flash: number;
  hitAt: number;
  hitX: number;
  now: number;
}
const idolMem = new Map<number, IdolMem>();
/** Когда кончится сцена смерти — до тех пор трон «разбит» не рисуется. */
let idolDeathEnd = -1;

/** Бюджет — 400 кадров на босса: 300 тела и 100 света (свет дешёвый — 0,1 мс). */
const idolFrames = frameLRU<HTMLCanvasElement>(300);
const idolLits = frameLRU<HTMLCanvasElement | null>(100);

/** Числа сценария, что мозг кладёт для рисунка (`v…`), с запасом на их отсутствие. */
function idolState(m: Mob, pose: MobPose, look = 0): IdolRig {
  const d = m.data;
  const st = d.st ?? 0;
  const t = Math.max(0, pose.t - (d.vT0 ?? 0));
  const D = d.vDur ?? [2.2, 3.8, 5, 3.2, 3.6, 1.1][st] ?? 2;
  const now = pose.now;
  let r = restRig();
  switch (st) {
    case 1:
      idolRule(r, q24(t), D, d.vJudge ?? D - 1.5, d.vRule ?? 1, now);
      break;
    case 2: {
      const from = restRig();
      idolRule(from, 3, 3, 1.5, d.vRule ?? 1, 0);
      idolOpen(r, q24(t), D, now, from);
      break;
    }
    case 3:
      idolGaze(r, q24(t, d.vWarn ?? D - 1.1), d.vWarn ?? D - 1.1, D, now);
      break;
    case 4:
      idolSpent(r, q24(t), D, now);
      break;
    case 5: {
      const from = restRig();
      idolRule(from, 2.2, 3, 1.5, d.vRule ?? 1, 0);
      idolWrath(r, q24(t), from);
      break;
    }
    default:
      idolRest(r, now);
  }
  // Голова не спеша поворачивается к герою — там, где поза её не занимает.
  if (
    st === 0 ||
    (st === 1 && t > 0.6 && t < (d.vJudge ?? D - 1.5)) ||
    (st === 2 && t > 0.4 && t < D - 0.4)
  )
    r.turn = look;
  // Удар рукой поверх любого состояния.
  const slamT = pose.t - (d.vSlam0 ?? -99);
  if (slamT >= 0 && slamT < SLAM_END) idolSlam(r, slamT, d.slamSide ?? 1);
  // Смена фазы — рык поверх всего.
  const ph = pose.t - (d.vPh0 ?? -99);
  if (ph >= 0 && ph < 0.95) {
    const w = eOut(seg(ph, 0, 0.12)) * (1 - eInOut(seg(ph, 0.62, 0.95)));
    r = mixRig(r, roarRig(r, q24(ph)), w);
  }
  // Пробуждение в начале боя (режим идола — `roar` с первой секунды).
  if (m.mode === 'roar' && st === 0 && pose.t < 1.25 && (d.vT0 ?? 0) > -0.5)
    r = wakeRig(r, q24(pose.t));
  // Новая трещина растёт от стража или от фазы.
  const born = Math.max(d.vCr0 ?? -99, d.vPh0 ?? -99);
  r.grow = seg(pose.t - born, 0.05, 0.45);
  return r;
}

registerMobPainter('f4_idol', (m, pose) => {
  const now = pose.now;
  if (pose.anim === 'dead') {
    // Сцена смерти: трещины, раскол, голова у подножия.
    const t = q24(Math.min(pose.t, IDOL_LINGER - 0.001));
    idolDeathEnd = Math.max(idolDeathEnd, now - pose.t + IDOL_LINGER);
    const key = `D|${t.toFixed(4)}|${pose.flash && t < BREAK_T ? 1 : 0}`;
    let img = idolFrames.get(key);
    if (!img) {
      // Кадр перед расколом — камень раскалён добела: склейка под вспышкой.
      const white = t >= BREAK_T - 1 / 24 - 1e-6 && t < BREAK_T;
      const px =
        t >= BREAK_T
          ? paintIdolCollapse(t)
          : white
            ? paintIdolBody(deathRig(t), 6, hex('#fff4d8'), 0.6)
            : paintIdolBody(deathRig(t), 6, pose.flash ? WHITE : null);
      img = idolFrames.set(key, px.canvas());
    }
    const lkey = `D|${t.toFixed(4)}`;
    let lit = idolLits.get(lkey);
    if (lit === undefined) lit = idolLits.set(lkey, paintIdolDeathLit(t)?.canvas() ?? null);
    return {
      img,
      lit,
      ax: ID_AX,
      ay: ID_AY,
      eye: null,
      still: true,
      shadow: ID_SHADOW,
      linger: IDOL_LINGER,
    };
  }
  // Память: взгляд на героя (с задержкой, чтобы глаза не метались), удар.
  let mem = idolMem.get(m.id);
  if (!mem || now < mem.now - 1) {
    mem = { lx: 0, ly: 1, lookAt: 0, flash: 0, hitAt: -9, hitX: 0, now };
    idolMem.set(m.id, mem);
  }
  const sim = paintSim();
  if (sim) {
    const dx = sim.hero.x - m.x;
    const dy = sim.hero.y - m.y;
    const tx = dx < -1.8 ? -1 : dx > 1.8 ? 1 : 0;
    const ty = dy > 6.5 ? 0 : 1;
    if ((tx !== mem.lx || ty !== mem.ly) && now - mem.lookAt > 0.18) {
      mem.lx += Math.sign(tx - mem.lx);
      mem.ly = ty;
      mem.lookAt = now;
    }
    if (m.flash > mem.flash + 0.01) {
      mem.hitAt = now;
      mem.hitX = dx < -0.6 ? -1 : dx > 0.6 ? 1 : 0;
    }
  }
  mem.flash = m.flash;
  mem.now = now;
  const cracks = Math.min(6, (m.data.cracks ?? 0) + (m.data.phase ?? 0));
  const r = idolState(m, pose, mem.lx);
  // Удар героя: торс и голова отдают на пиксель от героя, трещины и сердце
  // вспыхивают — камень держит удар, но его видно.
  const hk = now - mem.hitAt;
  if (hk >= 0 && hk < 0.16) {
    const k = hk < 0.06 ? 1 : 0.5;
    r.tx -= mem.hitX * k;
    r.ty -= k;
    r.hy -= hk < 0.06 ? 0 : 1;
    r.crack = Math.min(1, r.crack + 0.5 * k);
    if (r.core > 0) r.core = 1;
  }
  const key = `${idolBodyKey(r, cracks)}|${pose.flash ? 1 : 0}`;
  let img = idolFrames.get(key);
  if (!img) {
    const px = paintIdolBody(r, cracks, pose.flash ? WHITE : null);
    img = idolFrames.set(key, px.canvas());
  }
  const lkey = idolLitKey(r, cracks, mem.lx, mem.ly);
  let lit = idolLits.get(lkey);
  if (lit === undefined)
    lit = idolLits.set(lkey, paintIdolLit(r, cracks, mem.lx, mem.ly)?.canvas() ?? null);
  const out: MobFrame = {
    img,
    lit,
    ax: ID_AX,
    ay: ID_AY,
    eye: null,
    still: true,
    shadow: ID_SHADOW,
  };
  return out;
});

/**
 * Прогрев: части тела с трещинами всех фаз и то, что игрок видит в первой
 * фазе, — заповеди, лик открыт, взор, истощение, кара (через кадр: части
 * тела готовы, соседний кадр потом — одна сборка). Покой (цикл 4,8 с на
 * 10 к/с) — последним: кеш вытесняет давно не нужное, а покой нужен чаще
 * всего. Всего ~250 кадров — в пределе кеша. Кадр на шаг.
 */
registerMobWarm('f4_idol', function* () {
  const m = { id: -1, mode: 'roar', t: 0, flash: 0, x: 0, y: 0, data: {} } as unknown as Mob;
  const pose: MobPose = {
    anim: 'wind',
    frame: 0,
    mode: 'roar',
    t: 0,
    left: false,
    flash: false,
    look: 'normal',
    now: 0,
  };
  const paint = (data: Record<string, number>, t: number, now: number) => {
    m.data = { ...data };
    pose.t = t;
    pose.now = now;
    MOB_PAINTERS.get('f4_idol')?.(m, pose);
  };
  // Трещины фаз: торс, голова и ноги с 1…6 трещинами.
  for (let c = 1; c <= 6; c++) {
    paint({ st: 0, vT0: -10, cracks: c }, 10, 0);
    yield;
  }
  const run = function* (data: Record<string, number>, dur: number, stride: number) {
    for (let i = 0; i < dur * 24; i += stride) {
      paint(data, 10 + i / 24, i / 24);
      yield;
    }
  };
  yield* run({ st: 1, vT0: 10, vDur: 3.8, vJudge: 2.3, vRule: 1 }, 3.8, 2);
  yield* run({ st: 1, vT0: 10, vDur: 3.8, vJudge: 2.3, vRule: 2 }, 3.8, 2);
  yield* run({ st: 2, vT0: 10, vDur: 5, vRule: 1 }, 5, 3);
  yield* run({ st: 3, vT0: 10, vDur: 3.2, vWarn: 2.1 }, 3.2, 2);
  yield* run({ st: 4, vT0: 10, vDur: 3.6 }, 3.6, 3);
  yield* run({ st: 5, vT0: 10, vDur: 1.1, vRule: 1 }, 1.1, 2);
  for (let i = 0; i < 48; i++) {
    paint({ st: 0, vT0: -10 }, 10, i / 10);
    yield;
  }
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

// ---------------------------------------------------------------------------
// Предметы этажа.
// ---------------------------------------------------------------------------

export function propSprite(key: string, make: () => Px, ay?: number): Sprite {
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
export function half(src: Px, right: boolean): Px {
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
const deadStatue = (gold: boolean) => paintStatueRig({ ...SP.rest, gold });

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
registerPropPainter('f4_statue', () => propSprite('statue', () => deadStatue(false), SA_AY + 6));
registerPropPainter('f4_sped', () => null);
registerPropPainter('f4_astat', () => {
  if (F4_VIEW.idol === 'fight') return null;
  if (F4_VIEW.idol === 'broken') return propSprite('astatR', () => paintRubble(true), ST_G + 6);
  return propSprite('astat', () => deadStatue(true), SA_AY + 6);
});
registerPropPainter('f4_idol', (_o, time) => {
  if (F4_VIEW.idol === 'fight') return null;
  if (F4_VIEW.idol === 'broken') {
    // Пока идёт сцена смерти, трон рисует моб (копия у движка): иначе
    // обломки легли бы поверх распада.
    const sim = paintSim();
    if (sim?.mobs.some((m) => m.kind === 'f4_idol')) return null;
    if (time < idolDeathEnd && idolDeathEnd - time < IDOL_LINGER + 0.5) return null;
    return propSprite('idol|1', paintIdolBroken, ID_AY + 6);
  }
  // До боя идол спит: голова склонена, глаза тёмные — бой начнётся с пробуждения.
  return propSprite('idol|0', () => paintIdolBody(dormantRig(), 0), ID_AY + 6);
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
