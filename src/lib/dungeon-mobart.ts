// Общая рисовка того, что придумали этажи (v2.81): монстры из атласа 0x72,
// снаряды, лужи и удары по площади без своего рисовальщика, «глубина»
// (вода, пропасть), лестница вниз и печать за ареной. Своё этаж рисует сам
// (`dungeon-paint.ts`); здесь — то, что годится всем и не даёт пустоты.

// Порядок важен: плитки раньше рисунков — модули плиток, спрайтов и
// рисунков ссылаются друг на друга по кругу, и начатый с рисунков круг
// застаёт плитки без `hex`.
import { x72 } from './dungeon-tiles';
import { MOBS } from './dungeon';
import { hex, mix, mobArt, Px, TS } from './dungeon-art';
import { MOB_PAINTERS } from './dungeon-paint';
import type { MobAnim, MobFrame, Sprite } from './dungeon-paint';
import type { Mob } from './dungeon-sim';
import { X72_FRAMES } from './dungeon-x72-frames';
import type { X72Name } from './dungeon-x72-frames';

type RGBA = [number, number, number, number];

const INK: RGBA = hex('#150f0b');
const WHITE: RGBA = [255, 255, 255, 255];

const has = (n: string): n is X72Name => n in X72_FRAMES;

/** Кадры вида в атласе: покой, бег, удар. У части видов одна полоса `_anim_`. */
function strips(name: string): { idle: X72Name[]; run: X72Name[]; hit: X72Name | null } {
  const list = (pre: string) => {
    const out: X72Name[] = [];
    for (let i = 0; i < 8; i++) {
      const n = `${pre}_f${i}`;
      if (has(n)) out.push(n);
    }
    return out;
  };
  let idle = list(`${name}_idle_anim`);
  let run = list(`${name}_run_anim`);
  if (!idle.length) idle = list(`${name}_anim`);
  if (!run.length) run = idle;
  const hit = `${name}_hit_anim_f0`;
  return { idle, run, hit: has(hit) ? hit : null };
}

/** Есть ли вид в атласе — для тестов этажей. */
export const x72HasMob = (name: string) => strips(name).idle.length > 0;

const frames = new Map<string, MobFrame | null>();

/**
 * Кадр монстра из атласа 0x72: поза по режиму ИИ, отражение, масштаб
 * (целый — пиксели остаются квадратами), перекраска, элита — золотой кант,
 * альбинос — белёсый, удар — белым.
 */
export function x72MobFrame(
  art: { name: string; scale?: number; tint?: string; k?: number },
  anim: MobAnim,
  frame: number,
  left: boolean,
  flash: boolean,
  look: 'normal' | 'elite' | 'albino',
): MobFrame | null {
  const s = strips(art.name);
  if (!s.idle.length) return null;
  let name: X72Name;
  let dark = 0;
  let red = 0;
  switch (anim) {
    case 'run':
      name = s.run[((frame % s.run.length) + s.run.length) % s.run.length];
      break;
    case 'wind':
      // Замах: застыл на первом кадре и наливается красным.
      name = s.idle[0];
      red = 0.35;
      break;
    case 'bite':
      name = s.run[Math.min(s.run.length - 1, 2)];
      break;
    case 'hurt':
      name = s.hit ?? s.idle[0];
      break;
    case 'sleep':
      name = s.idle[0];
      dark = 0.35;
      break;
    case 'dead':
      name = s.idle[0];
      dark = 0.5;
      break;
    default:
      name = s.idle[((frame % s.idle.length) + s.idle.length) % s.idle.length];
  }
  const sc = Math.max(1, Math.round(art.scale ?? 1));
  const key = `${name}|${sc}|${art.tint ?? ''}|${art.k ?? 0}|${left ? 1 : 0}|${flash ? 1 : 0}|${look}|${dark}|${red}`;
  const hit = frames.get(key);
  if (hit !== undefined) return hit;
  const src = x72(name);
  if (!src) return null;
  const tint = art.tint ? hex(art.tint) : null;
  const gold = hex('#ffcc40');
  const pale = hex('#f4ece4');
  const redC = hex('#ff3a28');
  // Поле в пиксель под кант.
  const pad = look === 'elite' ? 1 : 0;
  const w = src.w + pad * 2;
  const h = src.h + pad * 2;
  const p = new Px(w, h);
  let bottom = 0;
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      let c = src.get(x, y) as RGBA;
      if (!c[3]) continue;
      bottom = Math.max(bottom, y);
      if (tint) c = mix(c, [tint[0], tint[1], tint[2], c[3]], art.k ?? 0.4);
      if (look === 'albino') {
        const l = (c[0] + c[1] + c[2]) / 3;
        c = mix([l, l, l, c[3]], [pale[0], pale[1], pale[2], c[3]], 0.45);
      }
      if (red) c = mix(c, [redC[0], redC[1], redC[2], c[3]], red);
      if (dark) c = mix(c, [0, 0, 0, c[3]], dark);
      if (flash) c = [WHITE[0], WHITE[1], WHITE[2], c[3]];
      p.set(left ? w - 1 - (x + pad) : x + pad, y + pad, c);
    }
  if (look === 'elite') p.outline(gold);
  let img = p.canvas();
  if (sc > 1) {
    const c = document.createElement('canvas');
    c.width = w * sc;
    c.height = h * sc;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, c.width, c.height);
    img = c;
  }
  const out: MobFrame = { img, ax: (w * sc) / 2, ay: (bottom + pad + 1) * sc, eye: null };
  frames.set(key, out);
  return out;
}

/** Нет рисовальщика — тёмный комок с глазом: видно, что тут кто-то есть. */
export function blobFrame(r: number, flash: boolean): MobFrame {
  const key = `blob|${r.toFixed(2)}|${flash ? 1 : 0}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const d = Math.max(6, Math.round(r * 2 * TS));
  const p = new Px(d + 2, d + 2);
  const body: RGBA = flash ? WHITE : hex('#3a3040');
  p.ell(d / 2 + 1, d / 2 + 1, d / 2, d / 2.4, body);
  p.ell(d / 2 - d / 6 + 1, d / 2 - d / 6 + 1, d / 6, d / 8, mix(body, WHITE, 0.2));
  p.outline(INK);
  const out: MobFrame = {
    img: p.canvas(),
    ax: (d + 2) / 2,
    ay: d / 2 + 1 + d / 2.4 + 1,
    eye: [Math.round(d / 2 + d / 5 + 1), Math.round(d / 2)],
  };
  frames.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Цвета статусов — одни на метки, лужи, снаряды и табло.
// ---------------------------------------------------------------------------

export const STATUS_COLOR: Record<string, [number, number, number]> = {
  poison: [120, 220, 80],
  burn: [255, 130, 40],
  slow: [110, 150, 255],
  chill: [150, 230, 255],
  stun: [255, 230, 90],
  none: [255, 60, 40],
};

export const statusRgb = (s?: string) => STATUS_COLOR[s ?? 'none'] ?? STATUS_COLOR.none;

/** Снаряд без рисовальщика: светящийся шарик цвета статуса. */
export function orbSprite(status?: string): Sprite {
  const key = `orb|${status ?? ''}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const [r, g, b] = statusRgb(status);
  const p = new Px(7, 7);
  p.ell(3, 3, 3, 3, [r, g, b, 255]);
  p.ell(3, 3, 1.6, 1.6, mix([r, g, b, 255], WHITE, 0.6));
  p.set(2, 2, WHITE);
  p.outline(INK);
  const out = { img: p.canvas(), ax: 3.5, ay: 3.5 };
  sprites.set(key, out);
  return out;
}

const sprites = new Map<string, Sprite>();

// ---------------------------------------------------------------------------
// Лестница вниз и печать.
// ---------------------------------------------------------------------------

/** Лестница вниз: ступени уходят в темноту, край подсвечен. 16×16. */
export function stairsPx(): Px {
  const p = new Px(TS, TS);
  const rim = hex('#6a5a58');
  const step = [hex('#4a3e3c'), hex('#382e2e'), hex('#282022'), hex('#1a1416'), hex('#0e0a0c')];
  p.rect(0, 0, 15, 15, hex('#08060a'));
  for (let i = 0; i < 5; i++) {
    const y = 1 + i * 3;
    const inset = i;
    p.rect(1 + inset, y, 14 - inset, y + 1, step[i]);
    p.rect(1 + inset, y, 14 - inset, y, mix(step[i], WHITE, 0.12));
  }
  p.rect(0, 0, 15, 0, rim);
  p.rect(0, 0, 0, 15, rim);
  p.rect(15, 0, 15, 15, mix(rim, [0, 0, 0, 255], 0.4));
  return p;
}

/** Печать: решётка из светящихся рун поперёк прохода. Кадр — мерцание. */
export function sealSprite(frame: number): Sprite {
  const f = ((frame % 4) + 4) % 4;
  const key = `seal|${f}`;
  const hit = sprites.get(key);
  if (hit) return hit;
  const p = new Px(TS, 22);
  const glow = hex('#b890ff');
  const core = hex('#f0e4ff');
  const bar = hex('#3a2a58');
  for (const x of [2, 7, 12]) {
    p.rect(x, 2, x + 1, 21, bar);
    p.rect(x, 2 + ((f + x) % 4) * 4, x + 1, 4 + ((f + x) % 4) * 4, glow);
  }
  p.rect(0, 6, 15, 7, bar);
  p.rect(0, 14, 15, 15, bar);
  p.set(4 + f, 6, core);
  p.set(11 - f, 14, core);
  p.set(8, 10, core);
  p.outline(INK);
  const out = { img: p.canvas(), ax: TS / 2, ay: 22 };
  sprites.set(key, out);
  return out;
}

/**
 * «Глубина» без рисовальщика района: тёмная вода с бликами, у кромки —
 * светлее (мелководье). `edge(dx, dy)` — сосед не глубина.
 */
export function deepPx(wx: number, wy: number, edge: (dx: number, dy: number) => boolean): Px {
  const p = new Px(TS, TS);
  const deep = hex('#0a1420');
  const mid = hex('#12243a');
  const shoal = hex('#2a4a66');
  const glint = hex('#6a9ac0');
  for (let y = 0; y < TS; y++)
    for (let x = 0; x < TS; x++) {
      const n = ((wx * 16 + x) * 7 + (wy * 16 + y) * 13) % 23;
      p.set(x, y, n < 4 ? mid : deep);
    }
  if (edge(0, -1)) p.rect(0, 0, 15, 2, shoal);
  if (edge(-1, 0)) p.rect(0, 0, 1, 15, shoal);
  if (edge(1, 0)) p.rect(14, 0, 15, 15, shoal);
  if (edge(0, 1)) p.rect(0, 14, 15, 15, shoal);
  const h = (wx * 73856093) ^ (wy * 19349663);
  p.set(3 + (Math.abs(h) % 9), 5 + (Math.abs(h >> 4) % 7), glint);
  p.set(4 + (Math.abs(h) % 9), 5 + (Math.abs(h >> 4) % 7), glint);
  return p;
}

/**
 * Портрет монстра для бестиария и лобби: покой, лицом вправо. Крысы —
 * прежним рисунком, атлас — первым кадром, этаж — своим рисовальщиком с
 * пустым «мобом» (радиус и вид — из описания).
 */
export function mobPortrait(kind: string): HTMLCanvasElement {
  const def = MOBS[kind];
  const art = def?.art ?? { kind: 'rat' as const };
  if (art.kind === 'rat') return mobArt(kind, 'normal', 'run0', false);
  if (art.kind === 'x72') {
    const f = x72MobFrame(art, 'idle', 0, false, false, 'normal');
    if (f) return f.img;
  } else {
    const fake = {
      id: 0,
      kind,
      x: 0,
      y: 0,
      r: def?.radius ?? 0.3,
      mode: 'idle',
      t: 0,
      face: 0,
      dir: 0,
      hp: 1,
      maxHp: 1,
      flash: 0,
      elite: false,
      albino: false,
      data: {},
    } as unknown as Mob;
    const f = MOB_PAINTERS.get(art.id)?.(fake, {
      anim: 'idle',
      frame: 0,
      mode: 'idle',
      t: 0,
      left: false,
      flash: false,
      look: 'normal',
    });
    if (f) return f.img;
  }
  return blobFrame(def?.radius ?? 0.3, false).img;
}
