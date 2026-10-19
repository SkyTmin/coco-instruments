import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RIBBON, chamfer, chamferGrid, chamferSize, ribbonGrid, socket } from './dark-art';

const INK = { ink: '#000001', hi: '#000002', lo: '#000003', fill: '#000004', lip: '#000005' };
const css = readFileSync(new URL('./dark.css', import.meta.url), 'utf8');
/** `--pxd-s` declared for a frame class in dark.css. */
const declared = (cls: string) => {
  const m = new RegExp(`\\.${cls}\\s*\\{[^}]*--pxd-s:\\s*(\\d+)`).exec(css);
  return m ? Number(m[1]) : null;
};

describe('dark kit art', () => {
  it('chamfer frames: centre = fill, the stretched edges uniform, cut corners empty', () => {
    for (const cut of [1, 2, 3, 6])
      for (const lip of [0, 2])
        for (const down of lip ? [false, true] : [false]) {
          const g = chamferGrid(cut, INK, lip, down);
          const { n, s } = chamferSize(cut);
          const top = s + (down ? lip : 0);
          const bottom = s + (down ? 0 : lip);
          const tag = `cut ${cut} lip ${lip}${down ? ' down' : ''}`;
          expect(g.w, tag).toBe(n);
          expect(g.h, tag).toBe(n + lip);
          expect(g.at(0, 0), tag).toBeNull();
          expect(g.at(n - 1, g.h - 1), tag).toBeNull();
          for (let y = top; y < g.h - bottom; y++)
            for (let x = s; x < n - s; x++)
              expect(g.at(x, y), `${tag} centre ${x},${y}`).toBe(INK.fill);
          for (let y = 0; y < g.h; y++) {
            if (y >= top && y < g.h - bottom) continue;
            const row = new Set(Array.from({ length: n - 2 * s }, (_, i) => g.at(s + i, y)));
            expect(row.size, `${tag} row ${y}`).toBe(1);
          }
          for (let x = 0; x < n; x++) {
            if (x >= s && x < n - s) continue;
            const col = new Set(
              Array.from({ length: g.h - top - bottom }, (_, i) => g.at(x, top + i)),
            );
            expect(col.size, `${tag} column ${x}`).toBe(1);
          }
        }
  });

  it('the slices declared in dark.css match the pictures', () => {
    expect(declared('pxd-f')).toBe(chamferSize(2).s); // panel, sel
    expect(declared('pxd-f--well')).toBe(chamferSize(1).s);
    expect(declared('pxd-f--oct')).toBe(chamferSize(6).s);
    expect(declared('pxd-f--off')).toBe(chamferSize(3).s); // act / off share the block
    expect(css).toMatch(/border-image-slice: 5 5 7 fill/); // act: cut 3 + a 2-pixel slab
    expect(css).toMatch(/border-image-slice: 7 5 5 fill/); // pressed: the face 2 px lower
    expect(css).toMatch(new RegExp(`border-image-slice: 0 ${RIBBON.L} fill`));
    expect(css).toMatch(new RegExp(`height: calc\\(${RIBBON.H} \\* var\\(--u\\)\\)`));
  });

  it('ribbon: fixed height, the middle columns stretch without seams', () => {
    const g = ribbonGrid({ ink: '#1', face: '#2', hi: '#3', lo: '#4', tail: '#5', fold: '#6' });
    expect(g.h).toBe(RIBBON.H);
    expect(g.w).toBe(2 * RIBBON.L + RIBBON.M);
    for (let y = 0; y < g.h; y++) {
      const mid = new Set(Array.from({ length: RIBBON.M }, (_, i) => g.at(RIBBON.L + i, y)));
      expect(mid.size, `row ${y}`).toBe(1);
      expect(g.at(RIBBON.L - 1, y), `row ${y} joins the middle`).toBe(g.at(RIBBON.L, y));
    }
  });

  it('pictures are deterministic and pixel-crisp', () => {
    expect(chamfer(2, INK)).toBe(chamfer(2, INK));
    const s = socket({ ink: '#1', hi: '#2', lo: '#3', well: '#4', mark: '#5' });
    expect(s).toBe(socket({ ink: '#1', hi: '#2', lo: '#3', well: '#4', mark: '#5' }));
    expect(decodeURIComponent(s)).toContain("shape-rendering='crispEdges'");
  });
});
