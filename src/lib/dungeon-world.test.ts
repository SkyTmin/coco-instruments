import { describe, expect, it } from 'vitest';
import { MAP_HAUL, MAP_MOUTH } from './dungeon-maps';
import {
  arenaCells,
  bandOf,
  buildWorld,
  liftOf,
  reachable,
  Tile,
  tileAt,
  toLocal,
  toWorld,
  walkableTile,
  WORLD_W,
} from './dungeon-world';
import type { World } from './dungeon-world';

const world = buildWorld();

/** Кратчайший путь по клеткам: решётка — по флагу. */
function pathLen(wd: World, from: [number, number], to: [number, number], grateOpen: boolean) {
  const dist = new Int32Array(wd.w * wd.h).fill(-1);
  const q = [from[1] * wd.w + from[0]];
  dist[q[0]] = 0;
  const pass = (t: number) =>
    walkableTile(t) || t === Tile.Gate || t === Tile.Crack || (grateOpen && t === Tile.Grate);
  while (q.length) {
    const i = q.shift()!;
    const x = i % wd.w;
    const y = Math.floor(i / wd.w);
    if (x === to[0] && y === to[1]) return dist[i];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const j = (y + dy) * wd.w + x + dx;
      if (dist[j] >= 0 || !pass(wd.tiles[j])) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return -1;
}

describe('подземелье: карта', () => {
  it('ряды ровно по ширине мира, края — порода', () => {
    for (const map of [MAP_MOUTH, MAP_HAUL]) {
      for (const row of map) {
        expect(row.length).toBe(WORLD_W);
        expect(row[0]).toBe('#');
        expect(row[WORLD_W - 1]).toBe('#');
      }
    }
    // Низ устья — глухой: ниже ничего нет.
    expect(MAP_MOUTH[MAP_MOUTH.length - 1]).toMatch(/^#+$/);
  });

  it('районы стыкуются без швов: проход в тех же столбцах', () => {
    const top = MAP_MOUTH[0];
    const bottom = MAP_HAUL[MAP_HAUL.length - 1];
    let shared = 0;
    for (let x = 0; x < WORLD_W; x++) if (top[x] !== '#' && bottom[x] !== '#') shared += 1;
    expect(shared).toBeGreaterThanOrEqual(6);
  });

  it('от клети устья достижимо всё: шахты, арена, тайник, верхняя клеть', () => {
    const lift = liftOf(world, 'mouth')!;
    const seen = reachable(world, lift.x, lift.y);
    for (const o of world.objs) {
      if (o.kind === 'ambush' || o.kind === 'group') continue;
      const [x, y] = o.out ?? (walkableTile(tileAt(world, o.x, o.y)) ? [o.x, o.y] : [o.x, o.y + 1]);
      // Завал — граница построенного; за ним будущие районы.
      if (tileAt(world, o.x, o.y) === Tile.Rubble) continue;
      const ok = seen[y * world.w + x] === 1 || seen[o.y * world.w + o.x] === 1;
      if (!ok) throw new Error(`не достать: ${o.kind} ${o.id}`);
    }
  });

  it('лампы, шахты и доска висят на стене, под ними пол', () => {
    for (const o of world.objs) {
      if (o.kind !== 'lamp' && o.kind !== 'mine' && o.kind !== 'board') continue;
      expect(tileAt(world, o.x, o.y)).toBe(Tile.Wall);
      expect(walkableTile(tileAt(world, o.x, o.y + 1))).toBe(true);
    }
  });

  it('у каждой норы есть выход на пол', () => {
    const burrows = world.objs.filter((o) => o.kind === 'burrow');
    expect(burrows.length).toBeGreaterThanOrEqual(16);
    for (const b of burrows) {
      expect(b.out).toBeDefined();
      expect(walkableTile(tileAt(world, b.out![0], b.out![1]))).toBe(true);
    }
  });

  it('вагонетки стоят на рельсах длиной не меньше пяти клеток', () => {
    const carts = world.objs.filter((o) => o.kind === 'cart');
    expect(carts.length).toBeGreaterThanOrEqual(4);
    for (const c of carts) {
      const r = world.rails.find((r) =>
        r.axis === 'v'
          ? r.at === c.x && c.y >= r.from && c.y <= r.to
          : r.at === c.y && c.x >= r.from && c.x <= r.to,
      );
      expect(r).toBeDefined();
      expect(r!.to - r!.from).toBeGreaterThanOrEqual(4);
    }
  });

  it('арена короля замкнута: выход только воротами', () => {
    const boss = world.objs.find((o) => o.kind === 'boss')!;
    const cells = arenaCells(world, boss);
    expect(cells.size).toBeGreaterThan(120);
    // Ни одной клети, шахты или выхода внутри.
    const lift = liftOf(world, 'mouth')!;
    expect(cells.has(lift.y * world.w + lift.x)).toBe(false);
    // Соседи арены — только стены и ворота.
    const gates = new Set<number>();
    for (const i of cells) {
      const x = i % world.w;
      const y = Math.floor(i / world.w);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const j = (y + dy) * world.w + x + dx;
        if (cells.has(j)) continue;
        const t = world.tiles[j];
        expect(walkableTile(t)).toBe(false);
        if (t === Tile.Gate) gates.add(j);
      }
    }
    expect(gates.size).toBe(3);
  });

  it('вентиляционный ходок — короткий путь, открытый решёткой', () => {
    const a = liftOf(world, 'mouth')!;
    const b = liftOf(world, 'haul')!;
    const closed = pathLen(world, [a.x, a.y], [b.x, b.y], false);
    const open = pathLen(world, [a.x, a.y], [b.x, b.y], true);
    expect(closed).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(0);
    expect(open).toBeLessThan(closed);
  });

  it('местные координаты переживают пересборку мира', () => {
    const p = toWorld(world, 'haul', 12, 40);
    expect(toLocal(world, p.x, p.y)).toEqual({ area: 'haul', x: 12, ly: 40 });
    const mouth = bandOf(world, 'mouth')!;
    expect(mouth.top).toBe(MAP_HAUL.length);
  });

  it('света хватает: у клетей и шахт есть лампы', () => {
    expect(world.lights.length).toBeGreaterThan(12);
    for (const o of world.objs.filter((x) => x.kind === 'lift' || x.kind === 'mine')) {
      const near = world.lights.some((l) => Math.hypot(l.x - o.x, l.y - o.y) < 3);
      expect(near).toBe(true);
    }
  });
});
