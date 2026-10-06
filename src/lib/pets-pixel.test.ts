import { describe, expect, it } from 'vitest';
import { PET_PX } from './pet-pixel-sprites';
import { PET_SPRITES } from './pet-sprites';
import { PIXEL_PETS } from './pets-pixel/index';
import type { Anim } from './pets-pixel/index';
import { BOX, FPS, FRAMES, phoenixFrame, poseAt } from './pets-pixel/phoenix';
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
  it('рисунок детерминирован: тот же кадр — те же байты', () => {
    const a = phoenixFrame('work', 30);
    const b = phoenixFrame('work', 30);
    expect(a.w).toBe(b.w);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it('манифест совпадает с рисовальщиком: рамка, число кадров, 24 к/с', () => {
    const m = PET_PX.phoenix;
    expect(m.box).toBe(BOX);
    for (const a of ANIMS) {
      expect(m.anims[a].n).toBe(FRAMES[a]);
      expect(m.anims[a].fps).toBe(FPS);
      expect(PIXEL_PETS.phoenix.anims[a]).toEqual({ n: FRAMES[a], fps: FPS });
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
