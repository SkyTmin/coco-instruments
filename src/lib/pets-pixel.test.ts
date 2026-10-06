import { describe, expect, it } from 'vitest';
import { pxFit } from './pet-pixel-fit';
import { PET_PX } from './pet-pixel-sprites';
import { PET_SPRITES } from './pet-sprites';
import { PIXEL_PETS } from './pets-pixel/index';
import type { Anim } from './pets-pixel/index';
import { FPS, FRAMES, phoenixFrame, poseAt, RES } from './pets-pixel/phoenix';
import pixelList from '../../scripts/pets-pixel/pets.json';

const ANIMS: Anim[] = ['idle', 'walk', 'happy', 'work', 'attack', 'sleep'];

/** Числовые поля позы, которые расходятся больше чем на `eps`, и разные строковые. */
function poseDiff(a: object, b: object, eps = 0.02): string[] {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return Object.keys(y).filter((k) =>
    typeof x[k] === 'number' && typeof y[k] === 'number'
      ? Math.abs((x[k] as number) - (y[k] as number)) > eps
      : x[k] !== y[k],
  );
}

describe('пиксельные питомцы', () => {
  it('рисунок детерминирован: тот же кадр — те же байты, у каждой полосы свой холст', () => {
    for (const r of ['s', 'l'] as const) {
      const a = phoenixFrame('work', 30, r);
      const b = phoenixFrame('work', 30, r);
      expect([a.w, a.h]).toEqual([RES[r].cw, RES[r].ch]);
      expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    }
  });

  it('манифест совпадает с рисовальщиком: рамки обеих полос, число кадров, 24 к/с', () => {
    const m = PET_PX.phoenix;
    expect(m.box).toBe(RES.s.box);
    expect(m.large?.box).toBe(RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(FRAMES[a]);
        expect(set.anims[a].fps).toBe(FPS);
      }
      expect(PIXEL_PETS.phoenix.anims[a]).toEqual({ n: FRAMES[a], fps: FPS });
    }
  });

  it('pxFit: крупная в карточке, вылуплении и Питомнике при DPR 3, малая в шахте; целое число точек', () => {
    const m = PET_PX.phoenix;
    const fit = (size: number, dpr: number) => {
      const f = pxFit(size, m, dpr);
      return [f.large ? 'l' : 's', Math.round(f.s * 10) / 10, f.crisp];
    };
    expect(fit(150, 3)).toEqual(['l', 149.3, true]);
    expect(fit(150, 2)).toEqual(['l', 168, true]);
    expect(fit(190, 3)).toEqual(['l', 186.7, true]);
    expect(fit(190, 2)).toEqual(['l', 168, true]);
    expect(fit(74, 3)).toEqual(['l', 74.7, true]);
    expect(fit(74, 2)).toEqual(['s', 72, true]);
    expect(fit(44, 3)).toEqual(['s', 48, true]);
    expect(fit(44, 2)).toEqual(['s', 48, true]);
    expect(fit(30, 2)).toEqual(['s', 30, false]);
    for (const dpr of [2, 2.75, 3])
      for (const size of [44, 48, 74, 150, 190]) {
        const f = pxFit(size, m, dpr);
        const box = f.large ? m.large!.box : m.box;
        if (f.crisp) expect(Math.abs(((f.s * dpr) / box) % 1) < 1e-6 || f.s === size).toBe(true);
        expect(Math.abs(f.s / size - 1)).toBeLessThanOrEqual(0.15);
      }
  });

  it('разовые кончаются позой начала покоя, петли — без шва', () => {
    const rest = poseAt('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(poseAt(a, FRAMES[a] / FPS), rest)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(poseAt(a, FRAMES[a] / FPS), poseAt(a, 0))]).toEqual([a, []]);
    }
  });

  it('тушь не знает пиксельных: их нет в PET_SPRITES, список туши читает pets.json', () => {
    expect(pixelList).toEqual(Object.keys(PET_PX).sort());
    for (const id of pixelList) expect(PET_SPRITES[id]).toBeUndefined();
  });
});
