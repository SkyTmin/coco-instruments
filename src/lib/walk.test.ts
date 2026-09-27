import { describe, expect, it } from 'vitest';
import { collideGrid, moveBody, overlapsGrid, steerVelocity, walkRow } from './walk';
import type { Grid } from './walk';

/** Сетка из строк: '#' — стена. За краем — тоже стена. */
function grid(rows: string[], cell = 1): Grid {
  const h = rows.length;
  const w = rows[0].length;
  return {
    w,
    h,
    cell,
    solid: (x, y) => x < 0 || y < 0 || x >= w || y >= h || rows[y][x] === '#',
  };
}

const ROOM = [
  '##########',
  '#........#',
  '#........#',
  '#...##...#',
  '#...##...#',
  '#........#',
  '#........#',
  '##########',
];

function walk(
  g: Grid,
  b: { x: number; y: number; r: number; vx: number; vy: number },
  secs: number,
  mx: number,
  my: number,
  speed = 5,
) {
  const dt = 1 / 60;
  let path = 0;
  for (let t = 0; t < secs; t += dt) {
    steerVelocity(b, mx, my, speed, dt);
    path += moveBody(g, b, dt);
    expect(overlapsGrid(g, b.x, b.y, b.r - 1e-6)).toBe(false);
  }
  return path;
}

describe('ходьба по сетке', () => {
  it('вдоль стены скользит, а не прилипает', () => {
    const g = grid(ROOM);
    // Идёт вверх и вправо под углом, упираясь в северную стену.
    const b = { x: 2, y: 1.5, r: 0.3, vx: 0, vy: 0 };
    walk(g, b, 0.8, Math.SQRT1_2, -Math.SQRT1_2);
    // Прижат к стене (y = 1 + r), а по x уехал вперёд.
    expect(b.y).toBeCloseTo(1.3, 3);
    expect(b.x).toBeGreaterThan(3.5);
  });

  it('никогда не кончает ход внутри стены — ни на какой скорости', () => {
    const g = grid(ROOM);
    for (const speed of [1, 5, 12, 40]) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        const b = { x: 3, y: 5.5, r: 0.3, vx: 0, vy: 0 };
        walk(g, b, 1.2, Math.cos(a), Math.sin(a), speed);
        expect(g.solid(Math.floor(b.x), Math.floor(b.y))).toBe(false);
      }
    }
  });

  it('по диагонали в угол — встаёт в угол, касаясь обеих стен', () => {
    const g = grid(ROOM);
    const b = { x: 7, y: 5, r: 0.3, vx: 0, vy: 0 };
    walk(g, b, 2, Math.SQRT1_2, Math.SQRT1_2);
    expect(b.x).toBeCloseTo(9 - 0.3, 3);
    expect(b.y).toBeCloseTo(7 - 0.3, 3);
  });

  it('половинные клетки площади — те же формулы в своих единицах', () => {
    // Клетка 0,5: столб из одной клетки — квадрат полплитки.
    const g = grid(['######', '#....#', '#..#.#', '#....#', '######'], 0.5);
    const b = { x: 0.8, y: 1.25, r: 0.2, vx: 0, vy: 0 };
    walk(g, b, 1, 1, 0);
    // Уперся в столб [1.5, 2) по x на ряду y ∈ [1, 1.5).
    expect(b.x).toBeCloseTo(1.5 - 0.2, 3);
    // Отодвинуть внутрь стены — collideGrid вытолкнет наружу.
    const c = { x: 1.6, y: 1.2, r: 0.2 };
    expect(collideGrid(g, c)).toBe(true);
    expect(overlapsGrid(g, c.x, c.y, c.r - 1e-6)).toBe(false);
  });

  it('шаг ног — по пройденному пути, по кругу из четырёх кадров', () => {
    expect([0, 0.36, 0.72, 1.08, 1.44].map(walkRow)).toEqual([0, 1, 2, 3, 0]);
    expect(walkRow(-0.1)).toBeGreaterThanOrEqual(0);
  });
});
