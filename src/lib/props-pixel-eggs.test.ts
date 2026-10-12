import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EGGS } from './pets';
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

  it('полоса вылупления есть на каждую редкость, что выпадает из яйца', () => {
    for (const e of EGGS) {
      const can = e.odds.flatMap((w, r) => (w > 0 ? [r] : []));
      expect([e.id, eggs.EGG_RARITIES[e.id]]).toEqual([e.id, can]);
      for (const r of can) expect(eggs.STRIPS[`hatch-${e.id}-r${r}`]?.res).toEqual(['l']);
    }
  });

  it('вылупление начинается кадром покоя и кончается пустым кадром', () => {
    const empty = (p: { data: Uint8ClampedArray | Uint8Array }) => p.data.every((v, i) => i % 4 !== 3 || v === 0);
    for (const [name, d] of Object.entries(eggs.STRIPS)) {
      if (d.loop) continue;
      const res = d.res![0];
      const kind = name.split('-')[1];
      expect([name, sameBytes(eggs.frame(name, 0, res), eggs.frame(`idle-${kind}`, 0, res))]).toEqual([name, true]);
      expect([name, empty(eggs.frame(name, d.frames - 1, res))]).toEqual([name, true]);
      expect([name, empty(eggs.frame(name, d.marks!.burst - 1, res))]).toEqual([name, false]);
    }
  });

  it('метки по порядку: трещина → качка, разлом, потом пусто в середине', () => {
    for (const [name, d] of Object.entries(eggs.STRIPS)) {
      if (!name.startsWith('hatch-')) continue;
      const m = d.marks!;
      const order = [m.crack1, m.w2, m.crack2, m.w3, m.crack3, m.burst, m.clear, d.frames];
      expect([name, order.every((v, i) => i === 0 || v > order[i - 1])]).toEqual([name, true]);
      const r = Number(name.slice(-1));
      expect(d.frames).toBe(Math.round((eggs.HATCH_WOB[r] + eggs.HATCH_POST[r]) * eggs.FPS));
    }
  });

  it('качка: самая низкая точка яйца на полу (не тонет, не висит), парение — выше пола', () => {
    for (const kind of eggs.EGG_KINDS)
      for (const r of eggs.EGG_RARITIES[kind]) {
        const pl = eggs.hatchPlan(r);
        for (let i = 0; i < pl.b * eggs.FPS; i++) {
          const z = eggs.lowestZ(kind, r, i / eggs.FPS);
          if (r < 3) expect([kind, r, i, Math.abs(z) < 0.35]).toEqual([kind, r, i, true]);
          else expect([kind, r, i, z > -0.35]).toEqual([kind, r, i, true]);
        }
      }
  });

  it('петли без шва', () => {
    for (const [name, d] of Object.entries(eggs.STRIPS))
      if (d.loop)
        for (const r of ['s', 'l'] as Res[])
          expect([name, r, seamRatio(eggs, name, r) <= 1]).toEqual([name, r, true]);
  });
});
