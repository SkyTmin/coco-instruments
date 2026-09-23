// Мир подземелья: одна цельная карта из районов, сложенных снизу вверх.
// Ни экранов, ни переходов: район кончается там, где начинается следующий,
// проход тянется в тех же столбцах. Здесь только постоянная часть мира —
// клетки, предметы на своих местах, свет, рельсы. Что сломано и кто где
// бегает, живёт в симуляции (`dungeon-sim.ts`).
//
// Координаты. Клетка — один метр. В мире `y` растёт вниз, как на экране,
// а районы добавляются СВЕРХУ (глубже). Поэтому всё, что сохраняется, —
// разведка, лампы, тайники, место вылазки — хранится В КООРДИНАТАХ РАЙОНА
// (`area`, `x`, `ly`): новый район сверху сдвинет мировые ряды, но не
// местные.

import { AREAS } from './dungeon';
import type { AreaDef, AreaId, DeepMineId } from './dungeon';
import { MAP_HAUL, MAP_MOUTH } from './dungeon-maps';

export const WORLD_W = 64;

/** Вид клетки. Обычный объект, а не `const enum`: сборщик собирает файлы
 * поодиночке и чужой `const enum` не подставил бы. */
export const Tile = {
  Void: 0,
  Wall: 1,
  Floor: 2,
  RailV: 3,
  RailH: 4,
  Puddle: 5,
  Crack: 6,
  Grate: 7,
  Gate: 8,
  Rubble: 9,
  Lift: 10,
} as const;

/** Сквозь что нельзя пройти (без учёта открытых решёток и ворот). */
export const isWallTile = (t: number) =>
  t === Tile.Wall || t === Tile.Crack || t === Tile.Rubble || t === Tile.Void;

export type ObjKind =
  | 'crate'
  | 'barrel'
  | 'powder'
  | 'nest'
  | 'cartnest'
  | 'cart'
  | 'pillar'
  | 'lamp'
  | 'lantern'
  | 'unlit'
  | 'burrow'
  | 'secret'
  | 'board'
  | 'lift'
  | 'mine'
  | 'gate'
  | 'boss'
  | 'plaque'
  | 'grate'
  | 'ambush'
  | 'group'
  | 'crack';

export interface WorldObj {
  /** Постоянный номер: район и местные координаты. */
  id: string;
  kind: ObjKind;
  area: AreaId;
  /** Клетка в мире. */
  x: number;
  y: number;
  /** Местный ряд района. */
  ly: number;
  /** Для нор: клетка пола, куда выходят крысы. */
  out?: [number, number];
  /** Для нор на южной грани стены — дыра видна на торце. */
  face?: 'front' | 'side';
  /** Для вагонеток: ось рельсов. */
  axis?: 'v' | 'h';
  /** Для шахт и клетей — что это. */
  ref?: string;
}

export interface Rail {
  axis: 'v' | 'h';
  /** Столбец (верт.) или ряд (гориз.). */
  at: number;
  /** Первая и последняя клетка пути, включительно. */
  from: number;
  to: number;
}

export interface Light {
  x: number;
  y: number;
  r: number;
  /** Тёплый, холодный, бирюзовый. */
  tint: 'warm' | 'cold' | 'teal' | 'red';
  /** Если свет зажигается — номер фонаря. */
  lamp?: string;
}

export interface AreaBand {
  def: AreaDef;
  /** Первый мировой ряд района. */
  top: number;
  h: number;
}

export interface World {
  w: number;
  h: number;
  tiles: Uint8Array;
  /** Узор клетки 0…255 — постоянный, от координат. */
  deco: Uint8Array;
  /** Пол другого вида (`,` на карте): грунт в Устье, плиты в Откатке. */
  alt: Uint8Array;
  bands: AreaBand[];
  /** Район мирового ряда. */
  rowArea: AreaId[];
  objs: WorldObj[];
  rails: Rail[];
  lights: Light[];
}

/** Районы, которые уже построены, СНИЗУ ВВЕРХ, со своими картами. */
const BUILT: { id: AreaId; rows: string[] }[] = [
  { id: 'mouth', rows: MAP_MOUTH },
  { id: 'haul', rows: MAP_HAUL },
];

/** Какая подземная шахта за каким входом. */
const MINE_AT: Partial<Record<AreaId, DeepMineId>> = { mouth: 'pyrite1', haul: 'pyrite2' };

const hash = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) & 255;
};

export function buildWorld(): World {
  // Сверху — самый глубокий район: порядок BUILT обратный.
  const order = [...BUILT].reverse();
  const h = order.reduce((s, a) => s + a.rows.length, 0);
  const w = WORLD_W;
  const tiles = new Uint8Array(w * h);
  const deco = new Uint8Array(w * h);
  const alt = new Uint8Array(w * h);
  const bands: AreaBand[] = [];
  const rowArea: AreaId[] = [];
  const objs: WorldObj[] = [];
  const lights: Light[] = [];
  let top = 0;
  for (const a of order) {
    const def = AREAS.find((d) => d.id === a.id)!;
    bands.push({ def, top, h: a.rows.length });
    for (let ly = 0; ly < a.rows.length; ly++) {
      rowArea.push(a.id);
      const row = a.rows[ly];
      const y = top + ly;
      for (let x = 0; x < w; x++) {
        const ch = row[x] ?? '#';
        const i = y * w + x;
        deco[i] = hash(x, y);
        const id = `${a.id}:${x}:${ly}`;
        const obj = (kind: ObjKind, extra: Partial<WorldObj> = {}) =>
          objs.push({ id, kind, area: a.id, x, y, ly, ...extra });
        let t: number = Tile.Floor;
        switch (ch) {
          case '#':
            t = Tile.Wall;
            break;
          case '!':
            t = Tile.RailV;
            break;
          case '=':
            t = Tile.RailH;
            break;
          case '~':
            t = Tile.Puddle;
            break;
          case '%':
            t = Tile.Crack;
            obj('crack');
            break;
          case 'D':
            t = Tile.Grate;
            obj('grate');
            break;
          case 'G':
            t = Tile.Gate;
            obj('gate');
            break;
          case 'Y':
            t = Tile.Rubble;
            break;
          case 'E':
            t = Tile.Lift;
            obj('lift', { ref: a.id });
            break;
          case 'L':
            t = Tile.Wall;
            obj('lamp');
            lights.push({ x: x + 0.5, y: y + 1.2, r: 5.5, tint: 'warm' });
            break;
          case 'o':
            t = Tile.Wall;
            obj('burrow');
            break;
          case 'M':
            t = Tile.Wall;
            obj('mine', { ref: MINE_AT[a.id] });
            lights.push({ x: x + 0.5, y: y + 1.1, r: 3.2, tint: 'warm' });
            break;
          case 'b':
            t = Tile.Wall;
            obj('board');
            break;
          case 'c':
            obj('cart');
            break;
          case 'C':
            obj('crate');
            break;
          case 'B':
            obj('barrel');
            break;
          case 'X':
            obj('powder');
            break;
          case 'n':
            obj('nest');
            break;
          case 'v':
            obj('cartnest');
            break;
          case 'P':
            obj('pillar');
            break;
          case 'l':
            obj('lantern');
            lights.push({ x: x + 0.5, y: y + 0.4, r: 4.6, tint: 'warm' });
            break;
          case 'u':
            obj('unlit');
            lights.push({ x: x + 0.5, y: y + 0.4, r: 4.6, tint: 'warm', lamp: id });
            break;
          case '$':
            obj('secret');
            break;
          case 'T':
            obj('plaque');
            break;
          case 'K':
            obj('boss', { ref: 'king' });
            break;
          case 'a':
            obj('ambush');
            break;
          case 'R':
            obj('group');
            break;
          case ',':
            alt[i] = 1;
            break;
          case '.':
          case '@':
            break;
          default:
            t = Tile.Floor;
        }
        tiles[i] = t;
      }
    }
    top += a.rows.length;
  }

  // Под предметом пол того вида, что вокруг: большинство соседей.
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (tiles[i] === Tile.Wall || !objs.length) continue;
      let a = 0;
      let n = 0;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = (y + dy) * w + x + dx;
        if (j < 0 || j >= w * h || tiles[j] === Tile.Wall) continue;
        n++;
        a += alt[j];
      }
      if (n && a * 2 > n) alt[i] = 1;
    }

  const world: World = { w, h, tiles, deco, alt, bands, rowArea, objs, rails: [], lights };

  // Площадка клети — три на три пола вокруг центра.
  for (const o of objs) {
    if (o.kind !== 'lift') continue;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = (o.y + dy) * w + o.x + dx;
        if (tiles[i] !== Tile.Wall) tiles[i] = Tile.Lift;
      }
    lights.push({ x: o.x + 0.5, y: o.y - 0.8, r: 5, tint: 'cold' });
  }

  // Вагонетка стоит на рельсах: ось — по соседям.
  for (const o of objs) {
    if (o.kind !== 'cart') continue;
    const v =
      tileAt(world, o.x, o.y - 1) === Tile.RailV || tileAt(world, o.x, o.y + 1) === Tile.RailV;
    o.axis = v ? 'v' : 'h';
    tiles[o.y * w + o.x] = v ? Tile.RailV : Tile.RailH;
  }

  // Норы: выход — соседняя клетка пола; на какой грани дыра.
  for (const o of objs) {
    if (o.kind !== 'burrow') continue;
    const tries: [number, number, 'front' | 'side'][] = [
      [0, 1, 'front'],
      [1, 0, 'side'],
      [-1, 0, 'side'],
      [0, -1, 'side'],
    ];
    for (const [dx, dy, face] of tries) {
      if (walkableTile(tileAt(world, o.x + dx, o.y + dy))) {
        o.out = [o.x + dx, o.y + dy];
        o.face = face;
        break;
      }
    }
  }

  world.rails = findRails(world);
  return world;
}

export function tileAt(wd: World, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= wd.w || y >= wd.h) return Tile.Void;
  return wd.tiles[y * wd.w + x];
}

/** Можно ли стоять на клетке (решётки и ворота — по их состоянию, здесь закрыты). */
export const walkableTile = (t: number) =>
  t === Tile.Floor || t === Tile.RailV || t === Tile.RailH || t === Tile.Puddle || t === Tile.Lift;

/** Непрерывные отрезки рельсов: по ним катаются вагонетки. */
function findRails(wd: World): Rail[] {
  const out: Rail[] = [];
  for (let x = 0; x < wd.w; x++) {
    let from = -1;
    for (let y = 0; y <= wd.h; y++) {
      const on = y < wd.h && tileAt(wd, x, y) === Tile.RailV;
      if (on && from < 0) from = y;
      if (!on && from >= 0) {
        if (y - from >= 2) out.push({ axis: 'v', at: x, from, to: y - 1 });
        from = -1;
      }
    }
  }
  for (let y = 0; y < wd.h; y++) {
    let from = -1;
    for (let x = 0; x <= wd.w; x++) {
      const on = x < wd.w && tileAt(wd, x, y) === Tile.RailH;
      if (on && from < 0) from = x;
      if (!on && from >= 0) {
        if (x - from >= 2) out.push({ axis: 'h', at: y, from, to: x - 1 });
        from = -1;
      }
    }
  }
  return out;
}

export function railAt(wd: World, x: number, y: number, axis: 'v' | 'h'): Rail | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (const r of wd.rails) {
    if (r.axis !== axis) continue;
    if (axis === 'v' && r.at === cx && cy >= r.from && cy <= r.to) return r;
    if (axis === 'h' && r.at === cy && cx >= r.from && cx <= r.to) return r;
  }
  return null;
}

/** Полоса района по мировому ряду. */
export function bandAt(wd: World, y: number): AreaBand {
  const yy = Math.max(0, Math.min(wd.h - 1, Math.floor(y)));
  for (const b of wd.bands) if (yy >= b.top && yy < b.top + b.h) return b;
  return wd.bands[wd.bands.length - 1];
}

export function bandOf(wd: World, id: AreaId): AreaBand | null {
  return wd.bands.find((b) => b.def.id === id) ?? null;
}

/** Мировые координаты из местных. */
export function toWorld(wd: World, area: AreaId, x: number, ly: number): { x: number; y: number } {
  const b = bandOf(wd, area) ?? wd.bands[wd.bands.length - 1];
  return { x, y: b.top + ly };
}

/** Местные координаты района из мировых. */
export function toLocal(wd: World, x: number, y: number): { area: AreaId; x: number; ly: number } {
  const b = bandAt(wd, y);
  return { area: b.def.id, x, ly: y - b.top };
}

export const objById = (wd: World, id: string) => wd.objs.find((o) => o.id === id) ?? null;

/** Клеть района — точка спуска и выхода. */
export function liftOf(wd: World, area: AreaId): WorldObj | null {
  return wd.objs.find((o) => o.kind === 'lift' && o.area === area) ?? null;
}

// ---------------------------------------------------------------------------
// Разведка: какие клетки района видел. Битовая строка в base64 — по районам.
// ---------------------------------------------------------------------------

export function fogBits(b: AreaBand, w = WORLD_W): Uint8Array {
  return new Uint8Array(Math.ceil((w * b.h) / 8));
}

export function fogDecode(s: string | undefined, b: AreaBand, w = WORLD_W): Uint8Array {
  const out = fogBits(b, w);
  if (!s) return out;
  try {
    const bin = atob(s);
    for (let i = 0; i < Math.min(bin.length, out.length); i++) out[i] = bin.charCodeAt(i);
  } catch {
    /* битая строка — разведка с нуля */
  }
  return out;
}

export function fogEncode(bits: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += String.fromCharCode(bits[i]);
  return btoa(s);
}

export const fogGet = (bits: Uint8Array, x: number, ly: number, w = WORLD_W) => {
  const i = ly * w + x;
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
};

export const fogSet = (bits: Uint8Array, x: number, ly: number, w = WORLD_W) => {
  const i = ly * w + x;
  bits[i >> 3] |= 1 << (i & 7);
};

/**
 * Обход в ширину по полу от клетки. Решётки и ворота считаются проходимыми
 * (их открывают), треснувшая стена — тоже (её ломают). Для тестов карты.
 */
export function reachable(wd: World, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(wd.w * wd.h);
  const q: number[] = [sy * wd.w + sx];
  seen[q[0]] = 1;
  const pass = (t: number) =>
    walkableTile(t) || t === Tile.Grate || t === Tile.Gate || t === Tile.Crack;
  while (q.length) {
    const i = q.shift()!;
    const x = i % wd.w;
    const y = Math.floor(i / wd.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= wd.w || ny >= wd.h) continue;
      const j = ny * wd.w + nx;
      if (seen[j] || !pass(wd.tiles[j])) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return seen;
}

/** Прямоугольник арены босса: пол, из которого нет выхода, кроме ворот. */
export function arenaCells(wd: World, boss: WorldObj): Set<number> {
  const out = new Set<number>();
  const q = [boss.y * wd.w + boss.x];
  out.add(q[0]);
  while (q.length) {
    const i = q.shift()!;
    const x = i % wd.w;
    const y = Math.floor(i / wd.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const j = (y + dy) * wd.w + x + dx;
      if (out.has(j) || !walkableTile(wd.tiles[j])) continue;
      out.add(j);
      q.push(j);
    }
  }
  return out;
}
