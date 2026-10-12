import { describe, expect, it } from 'vitest';
import { RARITIES } from '@/lib/rarity';
import { measureSlice, PIECES, sliceSafe } from './paint';

const frames = PIECES.filter((p) => p.kind === 'frame');

describe('ui-px: пиксельный набор', () => {
  it('у каждой рамки объявленный срез = измеренный по пикселям и безопасен для растяжки', () => {
    for (const piece of frames) {
      const p = piece.draw();
      const rep = piece.repeat ?? 'stretch';
      const m = measureSlice(p, rep, piece.fixedH);
      expect(piece.slice, piece.name).toBeDefined();
      expect(m, piece.name).toEqual(piece.slice);
      expect(sliceSafe(p, m, rep, piece.fixedH), piece.name).toBe(true);
    }
  });

  it('рисунок детерминирован: два прогона — те же байты', () => {
    for (const piece of PIECES) {
      const a = piece.draw().data;
      const b = piece.draw().data;
      expect(Buffer.from(a).equals(Buffer.from(b)), piece.name).toBe(true);
    }
  });

  it('значки — маски 9×9: только белое и прозрачное', () => {
    const icons = PIECES.filter((p) => p.kind === 'icon');
    expect(icons.length).toBeGreaterThan(20);
    for (const piece of icons) {
      const p = piece.draw();
      expect([p.w, p.h], piece.name).toEqual([9, 9]);
      for (let i = 0; i < p.data.length; i += 4) {
        const [r, g, b, a] = p.data.slice(i, i + 4);
        if (a) expect([r, g, b, a], piece.name).toEqual([255, 255, 255, 255]);
      }
    }
  });

  it('рамка ячейки — на каждую редкость, без полупрозрачных пикселей', () => {
    for (let r = 0; r < RARITIES.length; r++)
      expect(frames.some((p) => p.name === `slot-r${r}`)).toBe(true);
    for (const piece of PIECES) {
      const d = piece.draw().data;
      for (let i = 3; i < d.length; i += 4)
        expect(d[i] === 0 || d[i] === 255, piece.name).toBe(true);
    }
  });

  it('имена кусков не повторяются', () => {
    const names = PIECES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
