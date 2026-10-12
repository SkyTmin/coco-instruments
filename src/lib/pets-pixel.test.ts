import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pxFit } from './pet-pixel-fit';
import { PET_PX } from './pet-pixel-sprites';
import { PET_SPRITES } from './pet-sprites';
import { PIXEL_PETS } from './pets-pixel/index';
import type { Anim } from './pets-pixel/index';
import { FPS, FRAMES, phoenixFrame, poseAt, RES } from './pets-pixel/phoenix';
import * as Dragon from './pets-pixel/dragon';
import * as Fox from './pets-pixel/fox';
import * as Raccoon from './pets-pixel/raccoon';
import * as Raven from './pets-pixel/raven';
import * as Shepherd from './pets-pixel/shepherd';
import * as Spider from './pets-pixel/spider';
import * as Wolf from './pets-pixel/wolf';
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

describe('без радужной ступени (v2.111)', () => {
  it('у пиксельных есть обычный и золотой, полос радужного нет', () => {
    for (const id of Object.keys(PET_PX)) {
      const files = fs.readdirSync(`public/ui/pets/${id}`);
      expect([id, files.filter((f) => f.includes('-v2'))]).toEqual([id, []]);
      for (const a of ANIMS)
        for (const f of [`${a}.webp`, `${a}-v1.webp`]) expect(files).toContain(f);
      expect(files).toContain('thumb-v1.webp');
    }
  });
});

describe('пиксельный дракон', () => {
  const D = Dragon;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = D.dragonFrame('work', 30, r, v);
        const b = D.dragonFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([D.RES[r].cw, D.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = D.dragonFrame('idle', 0, 's', 0).data;
    const gold = D.dragonFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, варианты свои', () => {
    const m = PET_PX.dragon;
    expect(m.box).toBe(D.RES.s.box);
    expect(m.large?.box).toBe(D.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(D.FRAMES[a]);
        expect(set.anims[a].fps).toBe(D.FPS);
      }
      expect(PIXEL_PETS.dragon.anims[a]).toEqual({ n: D.FRAMES[a], fps: D.FPS });
    }
    // Радужного нет (v2.111): только золотой свой; полос `-v2` в игре нет.
    expect(PIXEL_PETS.dragon.variants).toEqual([1]);
    for (const p of Object.values(PIXEL_PETS)) expect(p.variants ?? []).not.toContain(2);
    expect(PIXEL_PETS.phoenix.variants).toBeUndefined();
    // Длительности по брифу: покой и сон ~3 с, ходьба 1 с, радость ~1,1, трюк 2, атака ~0,9.
    const sec = (a: Anim) => D.FRAMES[a] / D.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => D.FRAMES[a] / D.FPS;
    const rest = D.poseAt('idle', 0);
    const lag0 = D.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(D.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(D.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(D.poseAt(a, T(a)), D.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(D.lagOf(a, T(a)), D.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });
});

describe('пиксельный волк', () => {
  const W = Wolf;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.wolfFrame('work', 24, r, v);
        const b = W.wolfFrame('work', 24, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.wolfFrame('idle', 0, 's', 0).data;
    const gold = W.wolfFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.wolf;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.wolf.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.wolf.variants).toEqual([1]);
    const sec = (a: Anim) => W.FRAMES[a] / W.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => W.FRAMES[a] / W.FPS;
    const rest = W.poseAt('idle', 0);
    const lag0 = W.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), W.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), W.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });
});

describe('пиксельный ворон', () => {
  const W = Raven;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.ravenFrame('work', 24, r, v);
        const b = W.ravenFrame('work', 24, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.ravenFrame('idle', 0, 's', 0).data;
    const gold = W.ravenFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.raven;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.raven.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.raven.variants).toEqual([1]);
    expect(PET_SPRITES.raven).toBeUndefined();
    const sec = (a: Anim) => W.FRAMES[a] / W.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => W.FRAMES[a] / W.FPS;
    const rest = W.poseAt('idle', 0);
    const lag0 = W.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), W.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), W.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });
});

describe('пиксельный лис', () => {
  const W = Fox;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.foxFrame('work', 30, r, v);
        const b = W.foxFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.foxFrame('idle', 0, 's', 0).data;
    const gold = W.foxFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.fox;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.fox.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.fox.variants).toEqual([1]);
    expect(PET_SPRITES.fox).toBeUndefined();
    const sec = (a: Anim) => W.FRAMES[a] / W.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => W.FRAMES[a] / W.FPS;
    const rest = W.poseAt('idle', 0);
    const lag0 = W.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), W.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), W.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });

  it('напёрстки: после трюка реквизит на местах покоя (ящик растаял, стаканчики не сдвинуты)', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.game, end.liftI, end.pile, end.coin]).toEqual([0, -1, 0, 0]);
    const mid = W.poseAt('work', 1.4);
    expect(mid.pile).toBe(1);
    expect(mid.liftI).toBeGreaterThanOrEqual(0);
  });
});

describe('пиксельная овчарка', () => {
  const W = Shepherd;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.shepherdFrame('work', 22, r, v);
        const b = W.shepherdFrame('work', 22, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.shepherdFrame('idle', 0, 's', 0).data;
    const gold = W.shepherdFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.shepherd;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.shepherd.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.shepherd.variants).toEqual([1]);
    expect(PET_SPRITES.shepherd).toBeUndefined();
    const sec = (a: Anim) => W.FRAMES[a] / W.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => W.FRAMES[a] / W.FPS;
    const rest = W.poseAt('idle', 0);
    const lag0 = W.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), W.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), W.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });

  it('лай: трещины и камешки появляются после лая и к концу трюка убраны', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.bark, end.crack, end.prop, end.stone]).toEqual([-1, 0, 0, -1]);
    const mid = W.poseAt('work', 1.2);
    expect(mid.crack).toBe(1);
    expect(mid.prop).toBe(1);
    expect(mid.stone).toBeGreaterThan(0);
    expect(W.poseAt('work', 0.5).bark).toBe(-1);
  });
});

describe('пиксельный паук', () => {
  const W = Spider;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.spiderFrame('work', 31, r, v);
        const b = W.spiderFrame('work', 31, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.spiderFrame('idle', 0, 's', 0).data;
    const gold = W.spiderFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.spider;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.spider.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.spider.variants).toEqual([1]);
    expect(PET_SPRITES.spider).toBeUndefined();
    const sec = (a: Anim) => W.FRAMES[a] / W.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => W.FRAMES[a] / W.FPS;
    const rest = W.poseAt('idle', 0);
    const lag0 = W.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), W.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), W.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });

  it('паутина: плетётся с поднятыми лапами, жетон влипает, к концу трюка всё убрано', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.web, end.tok, end.prop, end.raiseL, end.raiseR]).toEqual([-1, -1, 0, 0, 0]);
    const spin = W.poseAt('work', 0.7);
    expect(spin.raiseL).toBe(1);
    expect(spin.web).toBeGreaterThan(0);
    expect(spin.tok).toBe(-1);
    const stuck = W.poseAt('work', 1.4);
    expect([stuck.web, stuck.tok, stuck.prop]).toEqual([1, 1, 1]);
  });

  it('ходьба — чередующиеся четвёрки: L1 R2 L3 R4 в воздухе, когда R1 L2 R3 L4 стоят', () => {
    const p = W.poseAt('walk', 0.25) as unknown as Record<string, number>;
    for (const k of ['lL0', 'lR1', 'lL2', 'lR3']) expect(p[k]).toBeGreaterThan(1);
    for (const k of ['lR0', 'lL1', 'lR2', 'lL3']) expect(p[k]).toBe(0);
  });
});

describe('пиксельный енот', () => {
  const W = Raccoon;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.raccoonFrame('work', 31, r, v);
        const b = W.raccoonFrame('work', 31, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.raccoonFrame('idle', 0, 's', 0).data;
    const gold = W.raccoonFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.raccoon;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.raccoon.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.raccoon.variants).toEqual([1]);
    expect(PET_SPRITES.raccoon).toBeUndefined();
    const sec = (a: Anim) => W.FRAMES[a] / W.FPS;
    expect([sec('idle'), sec('sleep'), sec('walk'), sec('work')]).toEqual([3, 3, 1, 2]);
    expect(Math.abs(sec('happy') - 1.1)).toBeLessThan(0.05);
    expect(Math.abs(sec('attack') - 0.9)).toBeLessThan(0.05);
  });

  it('разовые кончаются позой начала покоя, петли — без шва (и поза, и вторичное движение)', () => {
    const T = (a: Anim) => W.FRAMES[a] / W.FPS;
    const rest = W.poseAt('idle', 0);
    const lag0 = W.lagOf('idle', 0);
    for (const a of ['happy', 'work', 'attack'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), rest)]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), lag0, 0.05)]).toEqual([a, []]);
    }
    for (const a of ['idle', 'walk', 'sleep'] as Anim[]) {
      expect([a, poseDiff(W.poseAt(a, T(a)), W.poseAt(a, 0))]).toEqual([a, []]);
      expect([a, poseDiff(W.lagOf(a, T(a)), W.lagOf(a, 0), 0.05)]).toEqual([a, []]);
    }
  });

  it('валун: слушает со стетоскопом, бьёт молоточком, половинки с рудой; к концу всё убрано', () => {
    const listen = W.poseAt('work', 0.6);
    expect([listen.rock, listen.bell, listen.ticks, listen.split]).toEqual([1, 1, 1, 0]);
    const tap = W.poseAt('work', 1.14);
    expect(tap.ham).toBe(1);
    expect(tap.crack).toBeGreaterThan(0.5);
    const open = W.poseAt('work', 1.5);
    expect([open.rock, open.split]).toEqual([1, 1]);
    expect(open.glint).toBeGreaterThan(0);
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.rock, end.split, end.crack, end.ham, end.bell, end.ticks]).toEqual([
      0, 0, 0, 0, 0, -1,
    ]);
  });
});
