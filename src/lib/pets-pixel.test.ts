import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pxFit } from './pet-pixel-fit';
import { PET_PX } from './pet-pixel-sprites';
import { PET_SPRITES } from './pet-sprites';
import { PIXEL_PETS } from './pets-pixel/index';
import type { Anim } from './pets-pixel/index';
import { FPS, FRAMES, phoenixFrame, poseAt, RES } from './pets-pixel/phoenix';
import * as Badger from './pets-pixel/badger';
import * as Bulldog from './pets-pixel/bulldog';
import * as Cat from './pets-pixel/cat';
import * as Dragon from './pets-pixel/dragon';
import * as Ferret from './pets-pixel/ferret';
import * as Fox from './pets-pixel/fox';
import * as Owl from './pets-pixel/owl';
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

describe('пиксельный барсук', () => {
  const W = Badger;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.badgerFrame('work', 30, r, v);
        const b = W.badgerFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.badgerFrame('idle', 0, 's', 0).data;
    const gold = W.badgerFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.badger;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.badger.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.badger.variants).toEqual([1]);
    expect(PET_SPRITES.badger).toBeUndefined();
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

  it('трюк: два удара кайлом, камень трескается, кристалл в поднятой лапе, к концу всё убрано', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.rock, end.pick, end.stuck, end.crack, end.gem, end.hit]).toEqual([
      0, 0, 0, 0, -1, -1,
    ]);
    const hit1 = W.poseAt('work', 0.52);
    expect(hit1.hit).toBeGreaterThanOrEqual(0);
    expect([hit1.stuck, hit1.crack, hit1.gem]).toEqual([0, 0, -1]);
    const hit2 = W.poseAt('work', 1.05);
    expect([hit2.stuck, hit2.crack]).toEqual([1, 2]);
    const held = W.poseAt('work', 1.6);
    expect([held.rock, held.pick, held.stuck, held.gem]).toEqual([1, 1, 1, 1]);
    expect(held.gz).toBeGreaterThan(20);
    expect(held.glint).toBeGreaterThan(0);
  });

  it('атака: в кадре удара пасть открыта, когти растопырены; сон — каска на глазах', () => {
    const strike = W.poseAt('attack', 0.42);
    expect(strike.jaw).toBeGreaterThan(0.9);
    expect(strike.claw).toBe(1);
    expect(strike.swipe).toBeGreaterThanOrEqual(0);
    const sleep = W.poseAt('sleep', 1);
    expect(sleep.sit).toBe(1);
    expect(sleep.hatNod).toBeGreaterThan(0.3);
  });

  it('ходьба вперевалку: ноги по очереди, вторая стоит на полу', () => {
    const a = W.poseAt('walk', 0.25);
    expect(a.fLz).toBeGreaterThan(1);
    expect(a.fRz).toBe(0);
    const b = W.poseAt('walk', 0.75);
    expect(b.fRz).toBeGreaterThan(1);
    expect(b.fLz).toBe(0);
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

describe('пиксельная сова', () => {
  const W = Owl;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.owlFrame('work', 20, r, v);
        const b = W.owlFrame('work', 20, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.owlFrame('idle', 0, 's', 0).data;
    const gold = W.owlFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.owl;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.owl.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.owl.variants).toEqual([1]);
    expect(PET_SPRITES.owl).toBeUndefined();
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

  it('фонарь: луч метёт пол, кристалл блеснул и поднят в лапе, к концу трюка всё убрано', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.lamp, end.beam, end.gem, end.held, end.x]).toEqual([0, 0, 0, 0, 0]);
    const sweep = W.poseAt('work', 0.7);
    expect([sweep.lamp, sweep.beam, sweep.gem]).toEqual([1, 1, 0]);
    const found = W.poseAt('work', 1.0);
    expect(found.gem).toBe(1);
    const held = W.poseAt('work', 1.5);
    expect([held.gem, held.held, held.lamp]).toEqual([0, 1, 1]);
    expect(held.fRz).toBeGreaterThan(8);
  });

  it('покой: голова вертится, тело стоит; моргает сначала один глаз, потом другой', () => {
    const at = (t: number) => W.poseAt('idle', t);
    const look = at(0.8);
    expect(Math.abs(look.turn)).toBeGreaterThan(0.3);
    expect([look.x, look.lean]).toEqual([0, 0]);
    const ts = Array.from({ length: 72 }, (_, i) => i / 24);
    const first = (k: 'blinkL' | 'blinkR') => ts.find((t) => at(t)[k] > 0.8) ?? -1;
    expect(first('blinkL')).toBeGreaterThan(0);
    expect(first('blinkR')).toBeGreaterThan(first('blinkL'));
  });
});

describe('пиксельный бульдог', () => {
  const W = Bulldog;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.bulldogFrame('work', 30, r, v);
        const b = W.bulldogFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.bulldogFrame('idle', 0, 's', 0).data;
    const gold = W.bulldogFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.bulldog;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.bulldog.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.bulldog.variants).toEqual([1]);
    expect(PET_SPRITES.bulldog).toBeUndefined();
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

  it('трюк: блок, замах, удар кастетом, щебень, блик на кастете — к концу всё убрано', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.block, end.hit, end.stone, end.prop, end.glint]).toEqual([0, -1, -1, 0, -1]);
    const aim = W.poseAt('work', 0.5);
    expect(aim.block).toBe(1);
    expect(aim.turn).toBeGreaterThan(0.2);
    const wind = W.poseAt('work', 0.86);
    expect(wind.fRz).toBeGreaterThan(6);
    expect(wind.fRx).toBeLessThan(-3);
    const hit = W.poseAt('work', 1.0);
    expect(hit.hit).toBeGreaterThanOrEqual(0);
    expect(hit.fRx).toBeGreaterThan(4);
    const broke = W.poseAt('work', 1.3);
    expect([broke.block, broke.prop]).toEqual([0, 1]);
    expect(broke.stone).toBeGreaterThan(0);
    const adm = W.poseAt('work', 1.6);
    expect(adm.glint).toBeGreaterThanOrEqual(0);
    expect(adm.fRz).toBeGreaterThan(9);
  });

  it('атака: в кадре удара пасть с клыками открыта и кулак с кастетом у морды; сон — лёжа, пузырь', () => {
    const strike = W.poseAt('attack', 0.42);
    expect(strike.jaw).toBeGreaterThan(0.5);
    expect(strike.fRz).toBeGreaterThan(10);
    expect(strike.fRy).toBeGreaterThan(5);
    expect(strike.punch).toBeGreaterThanOrEqual(0);
    expect(strike.scale).toBeGreaterThan(1.1);
    const sleep = W.poseAt('sleep', 1.5);
    expect(sleep.lie).toBe(1);
    expect(sleep.bubble).toBeGreaterThan(0.9);
  });

  it('ходьба вразвалку: передние лапы по очереди, вторая стоит на полу', () => {
    const a = W.poseAt('walk', 0.25);
    expect(a.fLz).toBeGreaterThan(1);
    expect(a.fRz).toBe(0);
    const b = W.poseAt('walk', 0.75);
    expect(b.fRz).toBeGreaterThan(1);
    expect(b.fLz).toBe(0);
  });
});

describe('пиксельный кот', () => {
  const W = Cat;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.catFrame('work', 30, r, v);
        const b = W.catFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.catFrame('idle', 0, 's', 0).data;
    const gold = W.catFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.cat;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.cat.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.cat.variants).toEqual([1]);
    expect(PET_SPRITES.cat).toBeUndefined();
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

  it('трюк: рыба взлетает, во вспышке становится монетой, монета в лапах, к концу всё убрано', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.fish, end.coin, end.flash, end.glint]).toEqual([0, 0, 0, 0]);
    const toss = W.poseAt('work', 0.7);
    expect([toss.fish, toss.coin]).toEqual([1, 0]);
    expect(toss.iz).toBeGreaterThan(30);
    expect(W.poseAt('work', 0.83).flash).toBeGreaterThan(0.5);
    const held = W.poseAt('work', 1.4);
    expect([held.fish, held.coin]).toEqual([0, 1]);
    expect(held.iz).toBeLessThan(16);
    expect(held.lid).toBeGreaterThan(0.5);
    expect(held.glint).toBeGreaterThan(0);
  });

  it('атака: в кадре удара пасть открыта с клыками, когти наружу; сон — клубком', () => {
    const strike = W.poseAt('attack', 0.4);
    expect(strike.jaw).toBeGreaterThan(0.9);
    expect(strike.claw).toBe(1);
    expect(strike.swipe).toBeGreaterThanOrEqual(0);
    expect(W.poseAt('attack', 0.34).fRz).toBeGreaterThan(20);
    const sleep = W.poseAt('sleep', 1);
    expect(sleep.curl).toBe(1);
    expect(sleep.eye).toBe('sleep');
  });

  it('ходьба: лапы по очереди, опорные стоят на полу', () => {
    const a = W.poseAt('walk', 0);
    expect(a.fRz).toBeGreaterThan(1);
    expect(a.fLz).toBe(0);
    const b = W.poseAt('walk', 0.5);
    expect(b.fLz).toBeGreaterThan(1);
    expect(b.fRz).toBe(0);
    const c = W.poseAt('walk', 0.25);
    expect(c.hLz).toBeGreaterThan(1);
    expect(c.hRz).toBe(0);
  });
});

describe('пиксельный хорёк', () => {
  const W = Ferret;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.ferretFrame('work', 24, r, v);
        const b = W.ferretFrame('work', 24, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.ferretFrame('idle', 0, 's', 0).data;
    const gold = W.ferretFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.ferret;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.ferret.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.ferret.variants).toEqual([1]);
    expect(PET_SPRITES.ferret).toBeUndefined();
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

  it('трюк «псст»: оглянулся, распахнул пальто, щёлкнул секундомером, к концу всё убрано', () => {
    expect(W.poseAt('work', 0.3).turn).toBeLessThan(-0.4);
    expect(W.poseAt('work', 0.56).turn).toBeGreaterThan(0.4);
    const open = W.poseAt('work', 1.0);
    expect(open.open).toBe(1);
    expect(open.glint).toBeGreaterThan(0.5);
    expect(open.watch).toBe(0);
    const click = W.poseAt('work', 1.5);
    expect(click.watch).toBe(1);
    expect(click.click).toBeGreaterThanOrEqual(0);
    expect(click.hRz).toBeGreaterThan(20);
    expect(W.poseAt('work', 1.62).speed).toBe(1);
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.open, end.glint, end.watch, end.press, end.click, end.hand, end.speed]).toEqual([
      0, 0, 0, 0, -1, 0, 0,
    ]);
  });

  it('атака: в кадре удара пасть открыта, когти растопырены; сон — клубком, кепка на глазах', () => {
    const strike = W.poseAt('attack', 0.42);
    expect(strike.jaw).toBeGreaterThan(0.9);
    expect(strike.claws).toBe(1);
    expect(strike.bite).toBeGreaterThanOrEqual(0);
    const sleep = W.poseAt('sleep', 1);
    expect(sleep.curl).toBe(1);
    expect(sleep.capDn).toBe(1);
    expect(sleep.eye).toBe('sleep');
  });

  it('побежка: ноги по очереди, вторая стоит на полу', () => {
    const a = W.poseAt('walk', 0.125);
    expect(a.fLz).toBeGreaterThan(1);
    expect(a.fRz).toBe(0);
    const b = W.poseAt('walk', 0.375);
    expect(b.fRz).toBeGreaterThan(1);
    expect(b.fLz).toBe(0);
  });
});
