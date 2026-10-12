import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as eggs from './props-pixel/eggs';
import { propFit } from './props-pixel/fit';
import { PX_SETS, pxSrc } from './props-pixel/manifest';
import { PX } from './props-pixel/sprites-eggs';
import { manifestProblems, sameBytes, seamRatio } from './props-pixel/testkit';
import type { Res } from './props-pixel/types';

const ROOT = path.resolve(__dirname, '../..');

describe('пиксельные предметы: инфраструктура', () => {
  it('propFit: целое число точек на пиксель, крупная — от двух точек, сглаживание мельче 1,5', () => {
    const fit = (size: number, dpr: number, box = 36, large: number | undefined = 112) => {
      const f = propFit(size, box, large, dpr);
      return [f.large ? 'l' : 's', Math.round(f.s * 10) / 10, f.crisp];
    };
    expect(fit(220, 3)).toEqual(['l', 224, true]);
    expect(fit(220, 2)).toEqual(['l', 224, true]);
    expect(fit(72, 3)).toEqual(['l', 74.7, true]);
    expect(fit(72, 2)).toEqual(['s', 72, true]);
    expect(fit(26, 3)).toEqual(['s', 24, true]);
    expect(fit(20, 2)).toEqual(['s', 20, false]);
    // Только крупная полоса: берётся она, даже если на пиксель меньше двух точек.
    expect(propFit(100, undefined, 112, 1)).toEqual({ s: 112, crisp: true, large: true });
    for (const dpr of [2, 2.625, 3])
      for (const size of [26, 40, 52, 58, 72, 88, 220]) {
        const f = propFit(size, 36, 112, dpr);
        expect(Math.abs(f.s / size - 1)).toBeLessThanOrEqual(0.15);
      }
  });

  it('реестр знает все четыре набора, адрес полосы несёт метку содержимого', () => {
    expect(Object.keys(PX_SETS).sort()).toEqual(['books', 'chests', 'eggs', 'picks']);
    for (const [set, m] of Object.entries(PX_SETS)) expect(m.set).toBe(set);
    const [name] = Object.keys(PX.strips);
    expect(pxSrc('eggs', name, true)).toBe(`/ui/px/eggs/${name}-l.webp?v=${PX.strips[name].rev}`);
  });
});

describe('пиксельные яйца', () => {
  it('рисунок детерминирован, у каждой полосы свой холст', () => {
    for (const r of ['s', 'l'] as Res[])
      for (const name of Object.keys(eggs.STRIPS)) {
        const a = eggs.frame(name, 5, r);
        const b = eggs.frame(name, 5, r);
        expect([a.w, a.h]).toEqual([eggs.RES[r].cw, eggs.RES[r].ch]);
        expect(sameBytes(a, b)).toBe(true);
      }
  });

  it('манифест и файлы совпадают с рисовальщиком', () => {
    expect(manifestProblems(eggs, PX, ROOT)).toEqual([]);
  });

  it('петли без шва', () => {
    for (const [name, d] of Object.entries(eggs.STRIPS))
      if (d.loop)
        for (const r of ['s', 'l'] as Res[])
          expect([name, r, seamRatio(eggs, name, r) <= 1]).toEqual([name, r, true]);
  });
});
