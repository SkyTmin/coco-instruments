import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pxFit } from './pet-pixel-fit';
import { PET_PX } from './pet-pixel-sprites';
import { PET_SPRITES } from './pet-sprites';
import { PIXEL_PETS } from './pets-pixel/index';
import type { Anim } from './pets-pixel/index';
import { FPS, FRAMES, phoenixFrame, poseAt, RES, wingAt } from './pets-pixel/phoenix';
import * as Badger from './pets-pixel/badger';
import * as Bulldog from './pets-pixel/bulldog';
import * as Cat from './pets-pixel/cat';
import * as Dragon from './pets-pixel/dragon';
import * as Ferret from './pets-pixel/ferret';
import * as Fox from './pets-pixel/fox';
import * as Mole from './pets-pixel/mole';
import * as Mouse from './pets-pixel/mouse';
import * as Owl from './pets-pixel/owl';
import * as Pigeon from './pets-pixel/pigeon';
import * as Raccoon from './pets-pixel/raccoon';
import * as Raven from './pets-pixel/raven';
import * as Roach from './pets-pixel/roach';
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

  it('атака: в проводке крылья запахнуты ВПЕРЁД и в стороны, а не за склонённую грудь', () => {
    for (let f = 10; f <= 17; f++)
      for (const side of [-1, 1] as const) {
        const w = wingAt('attack', f / FPS, side);
        // Корень крыла уходит вперёд с поклоном: перед грудью, пока крылья запахнуты.
        if (f <= 14) expect([f, side, w.root[1] > w.chest[1]]).toEqual([f, side, true]);
        // Крыло смотрит наружу, кончик — над полом и впереди груди.
        expect([f, side, w.arm[0] * side > 0.2, w.tip[2] > 0, w.tip[1] > w.chest[1] + 5]).toEqual([
          f,
          side,
          true,
          true,
          true,
        ]);
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

  it('трюк: ключ в КЛЮВЕ (крыло не держит), бородка в скважине, потом ключ остаётся в замке', () => {
    type V = [number, number, number];
    const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const res of ['s', 'l'] as const) {
      let held = 0;
      for (let f = 0; f < W.FRAMES.work; f++) {
        const t = f / W.FPS;
        const o = W.poseAt('work', t);
        if (!o.hold) continue;
        const g = W.keyAt(t, res)!;
        held++;
        // Кольцо ключа — в кончике клюва, клюв сомкнут на нём.
        const ring = [0, 1, 2].map((i) => g.top[i] + g.d[i] * g.k) as V;
        expect([f, dist(ring, g.grip) < 1e-6, o.beak]).toEqual([f, true, 0]);
        // До скважины ключ продолжает клюв (перед лицом), в голову не входит.
        if (o.keyIn === 0) expect([f, dot(g.d, g.beak) > 0.999]).toEqual([f, true]);
      }
      expect(held).toBeGreaterThan(20);
      // Вставлен и повёрнут: бородка в скважине, ключ почти по линии клюва.
      for (const t of [0.92, 1.0, 1.08]) {
        const g = W.keyAt(t, res)!;
        expect([res, t, dist(g.tip, g.hole) < 1.2, dot(g.d, g.beak) > Math.cos(0.3)]).toEqual([
          res,
          t,
          true,
          true,
        ]);
      }
      // Щелчок — отпустил: ключ остался в скважине и ездит с замком.
      for (const t of [1.17, 1.25, 1.5]) {
        const g = W.keyAt(t, res)!;
        const o = W.poseAt('work', t);
        expect([res, t, o.hold, dist(g.tip, g.hole) < 1.2 * o.lock]).toEqual([res, t, 0, true]);
      }
      expect(W.keyAt(1.9, res)).toBeNull();
    }
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

  it('трюк: кайло в двух лапах, замах над плечом, удар боком с наклоном, остриё в верх камня', () => {
    type V = [number, number, number];
    const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Расстояние ближней лапы от прямой рукояти через дальнюю — обе лапы на рукояти.
    const offHandle = (t: number) => {
      const o = W.poseAt('work', t);
      const S = W.skel(o);
      const d: V = [o.pdx, o.pdy, o.pdz];
      const q = sub(S.paw[0], S.paw[1]);
      const u = dot(q, d);
      return { o, S, u, perp: Math.hypot(...sub(q, [d[0] * u, d[1] * u, d[2] * u])) };
    };
    for (let t = 0.2; t <= 1.08; t += 0.04) {
      const h = offHandle(t);
      expect([t, h.perp < 0.6]).toEqual([t, true]);
      // ближняя — выше по рукояти, к головке
      expect(h.u).toBeGreaterThan(0.5);
    }
    // Верх замаха: кайло над плечами, корпус откинут назад; ближняя лапа сдвинулась к головке.
    const top = offHandle(0.42);
    expect(top.o.pdz).toBeGreaterThan(0.3);
    expect(top.o.bow).toBeLessThan(0);
    expect(top.u).toBeGreaterThan(offHandle(0.5).u + 2);
    // Удар: боком, наклон в поясе, присед; рукоять к земле 30–50°.
    for (const t of [0.5, 1.0]) {
      const o = W.poseAt('work', t);
      expect(o.yaw).toBeGreaterThan(1.1);
      expect(o.bow).toBeGreaterThan(0.4);
      expect(o.cz).toBeGreaterThan(1);
      const ang = (-Math.asin(o.pdz) * 180) / Math.PI;
      expect(ang).toBeGreaterThan(30);
      expect(ang).toBeLessThan(50);
    }
    // Остриё — в верхушке камня; камень дальше вытянутой лапы, справа.
    const H = W.hitGeo();
    expect(H.T[2]).toBeGreaterThan(H.rc[2] + 0.7 * H.rr[2]);
    expect(Math.hypot(H.T[0] - H.rc[0], H.T[1] - H.rc[1])).toBeLessThan(0.6 * H.rr[0]);
    expect(H.rc[0] - H.rr[0]).toBeGreaterThan(14);
    // Ноги стоят, пока он бьёт и ловит.
    for (let t = 0.26; t <= 1.42; t += 0.04) {
      const o = W.poseAt('work', t);
      expect([t, o.fLz, o.fRz]).toEqual([t, 0, 0]);
    }
    // Кристалл — в дальней лапе с поимки до конца.
    for (const t of [1.34, 1.5, 1.7]) {
      const o = W.poseAt('work', t);
      const p = W.skel(o).paw[1];
      expect(Math.hypot(o.gx - p[0], o.gy - p[1], o.gz - p[2])).toBeLessThan(3.5);
    }
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

  it('стетоскоп: слушает валун — оливы в ушах по бокам головы, потом снова на шее', () => {
    // Пока головка на валуне (0,32–0,86 с), концы дуги — у боков головы (полуось
    // 8) под ушами-лопухами, выше подбородка (голова наклонена к валуну), а не на шее.
    for (const t of [0.34, 0.6, 0.84]) {
      expect(W.poseAt('work', t).phones).toBe(1);
      const { tips, head, k, neck, ears } = W.earTips('work', t);
      tips.forEach((p, j) => {
        const side = j ? 1 : -1;
        const out = (p[0] - head[0]) * side;
        expect([t, side, out > 6 * k && out < 8.5 * k]).toEqual([t, side, true]);
        expect([t, side, p[2] < ears[j][2] - 3 && p[2] > head[2] - 5 * k]).toEqual([t, side, true]);
        // Выше и дальше вбок, чем точка дуги на шее.
        const up = p[2] - neck[j][2];
        const wide = (p[0] - neck[j][0]) * side;
        expect([t, side, up > 1.5 && wide > 1.5]).toEqual([t, side, true]);
      });
    }
    // До и после — дуга на шее, как в покое; в остальных анимациях оливы не трогаются.
    for (const t of [0, 1.1, W.FRAMES.work / W.FPS]) {
      const { tips, neck } = W.earTips('work', t);
      expect(tips).toEqual(neck);
    }
    for (const a of ['idle', 'walk', 'happy', 'attack', 'sleep'] as Anim[])
      for (let i = 0; i < W.FRAMES[a]; i += 3) expect(W.poseAt(a, i / W.FPS).phones).toBe(0);
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
    // Лапа садится НА кристалл и только потом поднимает его (не прыгает с пола в лапу).
    const grab = W.poseAt('work', 1.34);
    expect([grab.fRz, grab.held]).toEqual([0, 1]);
    expect(grab.grip).toBeGreaterThan(0.9);
  });

  it('луч фонаря идёт СПЕРЕДИ: светом по груди, пиксели не просвечивают', () => {
    // Фонарь на лбу, луч к полу перед лапами: середина прохода (кадр 17) — луч
    // по груди под фонарём; фонарь ещё не горит — кадр 4. Колонка середины груди.
    for (const r of ['s', 'l'] as const) {
      const cv = W.RES[r];
      const x = Math.floor(cv.bx + cv.box / 2);
      const lit = W.owlFrame('work', 17, r, 0).data;
      const off = W.owlFrame('work', 4, r, 0).data;
      for (let y = Math.round(cv.by + 0.65 * cv.box); y <= Math.round(cv.by + 0.8 * cv.box); y++) {
        const i = (y * cv.cw + x) * 4;
        const sum = (d: Uint8ClampedArray) => d[i] + d[i + 1] + d[i + 2];
        expect([r, y, lit[i + 3]]).toEqual([r, y, 255]);
        expect(sum(lit) - sum(off)).toBeGreaterThan(30);
      }
    }
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

  it('ходьба вразвалку: вес над ОПОРНОЙ лапой, стоящая лапа не едет', () => {
    // Левая лапа (x < 0) в воздухе — тело и крен к правой (+x), и наоборот.
    let seen = 0;
    for (let i = 0; i < W.FRAMES.walk; i++) {
      const o = W.poseAt('walk', i / W.FPS);
      const up = o.fLz > 0.3 ? -1 : o.fRz > 0.3 ? 1 : 0;
      if (!up) continue;
      seen++;
      const stance = -up;
      expect([i, Math.sign(o.x), Math.sign(o.lean)]).toEqual([i, stance, stance]);
      const [sz, sx] = stance > 0 ? [o.fRz, o.fRx] : [o.fLz, o.fLx];
      expect([i, Math.abs(sz) + Math.abs(sx) + Math.abs(o.fz)]).toEqual([i, 0]);
    }
    expect(seen).toBeGreaterThan(12);
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

describe('пиксельный крот', () => {
  const W = Mole;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.moleFrame('work', 30, r, v);
        const b = W.moleFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.moleFrame('idle', 0, 's', 0).data;
    const gold = W.moleFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.mole;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.mole.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.mole.variants).toEqual([1]);
    expect(PET_SPRITES.mole).toBeUndefined();
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

  it('трюк: фонарь горит, пока роет; гребки по очереди; руда в ладонях; к концу всё убрано', () => {
    const end = W.poseAt('work', W.FRAMES.work / W.FPS);
    expect([end.heap, end.hp, end.ore, end.beam, end.lamp, end.glint]).toEqual([0, 0, -1, 0, 0, 0]);
    const dig = W.poseAt('work', 0.6);
    expect([dig.lamp, dig.beam, dig.heap]).toEqual([1, 1, 1]);
    expect(dig.ore).toBe(-1);
    // Короткие лапы: до кучи достаёт, только согнувшись и присев.
    expect(dig.bow).toBeGreaterThan(0.2);
    expect(dig.cz).toBeGreaterThan(1);
    // Броски комьев чередуют стороны: правая, левая, …
    expect(W.THROWS.map(([, s]) => s)).toEqual([1, -1, 1, -1, 1, -1]);
    const early = W.poseAt('work', 0.4).hp;
    const late = W.poseAt('work', 1.0).hp;
    expect(late).toBeGreaterThan(early + 0.3);
    const held = W.poseAt('work', 1.5);
    expect([held.ore, held.oreU, held.palm]).toEqual([1, 1, 1]);
    expect(held.glint).toBeGreaterThan(0);
    expect(held.eye).toBe('happy');
    // Держит перед грудью обеими лапами: запястья рядом, выше пояса.
    const S = W.skel(held);
    expect(Math.abs(S.paw[0][0] - S.paw[1][0])).toBeLessThan(10);
    expect(Math.min(S.paw[0][2], S.paw[1][2])).toBeGreaterThan(10);
    expect(W.poseAt('work', 1.8).lamp).toBe(0);
  });

  it('гребок: запястье над кучей перед кротом, а не у ступни', () => {
    for (const [th] of W.THROWS) {
      // Миг, когда когти в куче (гребок начался на 0,08 с раньше броска).
      const S = W.skel(W.poseAt('work', th - 0.03));
      const p = S.paw[0][2] < S.paw[1][2] ? S.paw[0] : S.paw[1];
      expect(p[1]).toBeGreaterThan(8);
      expect(p[2]).toBeLessThan(11);
    }
  });

  it('атака: в кадре удара пасть открыта, нос вверх, когти растопырены; сон — каска на глазах, фонарь тлеет', () => {
    const strike = W.poseAt('attack', 0.42);
    expect(strike.jaw).toBeGreaterThan(0.9);
    expect(strike.claw).toBe(1);
    expect(strike.nod).toBeLessThan(-0.2);
    expect(strike.swipe).toBeGreaterThanOrEqual(0);
    const sleep = W.poseAt('sleep', 1);
    expect(sleep.sit).toBe(1);
    expect(sleep.hatNod).toBeGreaterThan(0.3);
    expect(sleep.lamp).toBeGreaterThan(0.1);
    expect(sleep.lamp).toBeLessThan(0.5);
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

describe('пиксельный таракан', () => {
  const W = Roach;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.roachFrame('work', 30, r, v);
        const b = W.roachFrame('work', 30, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.roachFrame('idle', 0, 's', 0).data;
    const gold = W.roachFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.roach;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.roach.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.roach.variants).toEqual([1]);
    expect(PET_SPRITES.roach).toBeUndefined();
    expect(pixelList).toContain('roach');
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

  it('трюк: очки опускает рукой, забег за край и обратно с другой стороны, юз, палец вверх — к концу всё убрано', () => {
    const P = (t: number) => W.poseAt('work', t);
    expect(P(0.2).grab).toBeGreaterThan(0.9);
    expect(P(0.2).gog).toBeGreaterThan(0.2);
    expect(P(0.4).gog).toBe(1);
    // Убегает вправо, лицом вправо, сзади — пыль старта.
    expect(P(0.8).x).toBeGreaterThan(40);
    expect(P(0.8).yaw).toBeGreaterThan(0.5);
    expect(P(0.8).dust1).toBeGreaterThanOrEqual(0);
    // Возвращается слева, бежит туда же (вправо).
    expect(P(0.86).x).toBeLessThan(-40);
    expect(P(0.95).x).toBeGreaterThan(P(0.86).x);
    // Юз: откинулся назад, ступни впереди, пыль из-под ног.
    const sk = P(1.3);
    expect(sk.lean).toBeLessThan(-0.1);
    expect(sk.fLx).toBeGreaterThan(1);
    expect(sk.dust2).toBeGreaterThanOrEqual(0);
    const th = P(1.55);
    expect(th.thumb).toBeGreaterThan(0.9);
    expect(th.glint).toBeGreaterThanOrEqual(0);
    expect(th.gog).toBe(1);
    // Очки поднимает той же рукой.
    expect(P(1.8).grab).toBeGreaterThan(0.9);
    expect(P(1.8).gog).toBeLessThan(0.5);
    const end = P(2);
    expect([
      end.gog,
      end.grab,
      end.thumb,
      end.glint,
      end.dust1,
      end.dust2,
      end.speed,
      end.x,
    ]).toEqual([0, 0, 0, -1, -1, -1, 0, 0]);
  });

  it('атака: замах руками вверх, удар — кисти впереди, жвалы открыты; сон — сидя, очки на глазах', () => {
    const wind = W.poseAt('attack', 0.25);
    expect(wind.aRz).toBeGreaterThan(23);
    expect(wind.aLz).toBeGreaterThan(23);
    const strike = W.poseAt('attack', 0.42);
    expect(strike.jaw).toBeGreaterThan(0.5);
    expect(strike.bite).toBeGreaterThanOrEqual(0);
    expect(strike.scale).toBeGreaterThan(1.1);
    expect(strike.aRy).toBeGreaterThan(6);
    expect(strike.bLy).toBeGreaterThan(6);
    const sleep = W.poseAt('sleep', 1.5);
    expect([sleep.sit, sleep.gog, sleep.droop]).toEqual([1, 1, 1]);
  });

  it('ходьба: ноги по очереди, опорная стоит на полу и не едет за телом', () => {
    const a = W.poseAt('walk', 0.125);
    expect(a.fLz).toBeGreaterThan(1);
    expect(a.fRz).toBe(0);
    const b = W.poseAt('walk', 0.375);
    expect(b.fRz).toBeGreaterThan(1);
    expect(b.fLz).toBe(0);
    for (let i = 0; i < W.FRAMES.walk; i++) {
      const o = W.poseAt('walk', i / W.FPS);
      expect([o.carry, o.fLx, o.fRx]).toEqual([0, 0, 0]);
    }
  });
});

describe('пиксельная мышь', () => {
  const W = Mouse;
  const at = (i: number) => {
    const o = W.poseAt('work', i / W.FPS);
    const S = W.skel(o);
    return { o, S, T: W.tokAt(o, S), lag: W.lagOf('work', i / W.FPS) };
  };
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  /** Пиксели латуни жетона правее середины кадра (жетон на цепочке — в левой лапе, левее). */
  const brassRight = (i: number, r: 's' | 'l', v: number) => {
    const p = W.mouseFrame('work', i, r, v);
    const cv = W.RES[r];
    const x0 = cv.bx + cv.box / 2 + Math.round(cv.box / 48);
    const pal = W.PAL_V[v][W.P_BRASS].map((c) => c.slice(0, 3).join(','));
    let n = 0;
    for (let y = 0; y < p.h; y++)
      for (let x = x0; x < p.w; x++) {
        const j = (y * p.w + x) * 4;
        if (p.data[j + 3] === 255 && pal.includes(`${p.data[j]},${p.data[j + 1]},${p.data[j + 2]}`))
          n++;
      }
    return n;
  };

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.mouseFrame('work', 26, r, v);
        const b = W.mouseFrame('work', 26, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.mouseFrame('idle', 0, 's', 0).data;
    const gold = W.mouseFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.mouse;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.mouse.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.mouse.variants).toEqual([1]);
    expect(PET_SPRITES.mouse).toBeUndefined();
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

  it('трюк: жетон лежит на полу перед правой ступнёй; в кадре касания пальцы на нём', () => {
    const before = at(12);
    expect(before.o.tokU).toBe(0);
    const T0 = before.T!;
    expect(T0.c[2]).toBeLessThan(1);
    const foot = before.S.foot[1];
    expect(T0.c[1]).toBeGreaterThan(foot[1] + 4);
    expect(Math.abs(T0.c[0] - foot[0])).toBeLessThan(2.5);
    // Заметила: глаза шире, блик на жетоне.
    expect(before.o.eye).toBe('wide');
    expect(before.o.glint).toBeGreaterThan(0.3);
    // Кадр касания — целый кадр; за кадр до него жетон ещё на полу, лапа над ним.
    const gi = Math.round(W.GRAB * W.FPS);
    expect(gi / W.FPS).toBe(W.GRAB);
    expect(at(gi - 1).o.tokU).toBe(0);
    const g = at(gi);
    expect(g.o.tokU).toBeGreaterThan(0);
    expect(dist(g.S.grip[1], T0.c)).toBeLessThan(1);
    expect(dist(g.T!.c, T0.c)).toBeLessThan(0.05);
    // Достаёт, нагнувшись и присев: рука не длиннее себя.
    expect(g.o.bow).toBeGreaterThan(0.3);
    expect(g.o.cz).toBeGreaterThan(1.5);
  });

  it('жетон в правой лапе от касания до пелерины, поднят над плечом, потом спрятан', () => {
    const gi = Math.round(W.GRAB * W.FPS);
    for (let i = gi; i < 39; i++) {
      const { S, T } = at(i);
      expect([i, T !== null]).toEqual([i, true]);
      expect([i, dist(T!.c, S.grip[1]) < 1]).toEqual([i, true]);
    }
    // Поднят: над плечом и сбоку от головы.
    const hi = at(28);
    expect(hi.T!.c[2]).toBeGreaterThan(hi.S.sh[1][2] + 4);
    expect(hi.T!.c[0]).toBeGreaterThan(9);
    expect(hi.o.glint).toBeGreaterThan(0.5);
    // Под кокеткой: внутри пелерины, спереди его закрывает ткань (не разрез).
    const tk = Math.ceil(W.TUCKED * W.FPS);
    const u = at(tk);
    expect(u.o.tuck).toBe(1);
    expect(W.underCape(u.o, u.S, u.lag, u.T!.c)).toBe(true);
    // После — жетона нет, подмигнула.
    for (let i = tk + 1; i < W.FRAMES.work; i++) expect(at(i).T).toBeNull();
    expect(W.poseAt('work', 1.72).wink).toBeGreaterThan(0.5);
  });

  it('жетон уходит ЗА край пелерины: виден, пока поднят и у края, не виден под кокеткой', () => {
    const tk = Math.ceil(W.TUCKED * W.FPS);
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        expect([r, v, brassRight(28, r, v) > 0]).toEqual([r, v, true]);
        expect([r, v, brassRight(34, r, v) > 0]).toEqual([r, v, true]);
        expect([r, v, brassRight(tk, r, v)]).toEqual([r, v, 0]);
      }
  });

  it('атака: в кадре удара резцы наголо, морда вверх, когти; сон — сидит, закутана, уши обвисли', () => {
    const strike = W.poseAt('attack', 0.42);
    expect(strike.jaw).toBeGreaterThan(0.9);
    expect(strike.claw).toBe(1);
    expect(strike.nod).toBeLessThan(-0.2);
    expect(strike.swipe).toBeGreaterThanOrEqual(0);
    const sleep = W.poseAt('sleep', 1);
    expect([sleep.sit, sleep.wrap, sleep.earDrop, sleep.eye]).toEqual([1, 1, 1, 'sleep']);
  });

  it('ступни не скользят: двигаются только в воздухе (прыжки атаки и радости, шаг)', () => {
    for (const an of ['idle', 'happy', 'work', 'attack', 'sleep'] as Anim[])
      for (let i = 0; i < W.FRAMES[an]; i++) {
        const a = W.poseAt(an, i / W.FPS);
        const b = W.poseAt(an, (i + 1) / W.FPS);
        if (Math.max(a.z, b.z, a.fLz, b.fLz, a.fRz, b.fRz) > 0) continue;
        for (const j of [0, 1]) {
          const d = dist(W.skel(a).foot[j], W.skel(b).foot[j]);
          expect([an, i, j, d < 0.35]).toEqual([an, i, j, true]);
        }
      }
  });

  it('ходьба на цыпочках: ноги по очереди, опорная стоит на месте', () => {
    const a = W.poseAt('walk', 0.125);
    expect(a.fLz).toBeGreaterThan(1);
    expect(a.fRz).toBe(0);
    const b = W.poseAt('walk', 0.375);
    expect(b.fRz).toBeGreaterThan(1);
    expect(b.fLz).toBe(0);
    const R0 = W.skel(a).foot[1];
    const R1 = W.skel(W.poseAt('walk', 0.6)).foot[1];
    expect(W.poseAt('walk', 0.6).fRz).toBe(0);
    expect(dist(R0, R1)).toBeLessThan(0.01);
  });
});

describe('пиксельный голубь', () => {
  const W = Pigeon;

  it('рисунок детерминирован; золотой рисует сам, на том же холсте', () => {
    for (const r of ['s', 'l'] as const)
      for (const v of [0, 1]) {
        const a = W.pigeonFrame('work', 26, r, v);
        const b = W.pigeonFrame('work', 26, r, v);
        expect([a.w, a.h]).toEqual([W.RES[r].cw, W.RES[r].ch]);
        expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
      }
    const plain = W.pigeonFrame('idle', 0, 's', 0).data;
    const gold = W.pigeonFrame('idle', 0, 's', 1).data;
    expect(Buffer.from(plain).equals(Buffer.from(gold))).toBe(false);
  });

  it('манифест совпадает с рисовальщиком: обе полосы, кадры, 24 к/с, только свой золотой', () => {
    const m = PET_PX.pigeon;
    expect(m.box).toBe(W.RES.s.box);
    expect(m.large?.box).toBe(W.RES.l.box);
    for (const a of ANIMS) {
      for (const set of [m, m.large!]) {
        expect(set.anims[a].n).toBe(W.FRAMES[a]);
        expect(set.anims[a].fps).toBe(W.FPS);
      }
      expect(PIXEL_PETS.pigeon.anims[a]).toEqual({ n: W.FRAMES[a], fps: W.FPS });
    }
    expect(PIXEL_PETS.pigeon.variants).toEqual([1]);
    expect(PET_SPRITES.pigeon).toBeUndefined();
    expect(pixelList).toContain('pigeon');
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

  it('трюк: записка слетает с лапки в крылья, разворачивается, «!», клевер выпрыгивает, записка снова на лапке', () => {
    const P = (t: number) => W.poseAt('work', t);
    // Начинает привязанной; лапку поднял и трясёт.
    expect(P(0).tied).toBe(1);
    expect(P(0.18).tied).toBe(1);
    expect(P(0.18).fRz).toBeGreaterThan(1);
    // Нитка лопнула — записка в полёте, ещё не в крыльях.
    const pop = P(0.26);
    expect([pop.tied, pop.pop >= 0, pop.fly > 0, pop.holdL < 1]).toEqual([0, true, true, true]);
    // Поймал обоими крыльями, развернул, читает.
    const c = P(0.5);
    expect([c.fly, c.holdL, c.holdR]).toEqual([-1, 1, 1]);
    const r = P(0.9);
    expect([r.spread, r.holdL, r.holdR]).toEqual([1, 1, 1]);
    expect(r.lookY).toBeGreaterThan(0);
    // «!» — после чтения; клевер выпрыгивает из листа, пока лист развёрнут.
    expect(P(0.95).bang).toBe(0);
    const b = P(1.1);
    expect(b.bang).toBe(1);
    expect(b.clover).toBeGreaterThan(0);
    expect(b.spread).toBe(1);
    expect(P(1.0).clover).toBe(-1);
    // Свёрток несёт одно правое крыло к поднятой лапке, вес на левой, привязывает.
    const tie = P(1.68);
    expect([tie.tied, tie.holdL, tie.holdR]).toEqual([0, 0, 1]);
    expect(tie.fRz).toBeGreaterThan(2);
    expect(tie.x).toBeLessThan(0);
    expect(P(1.76).tied).toBe(1);
    const end = P(2);
    expect([end.tied, end.fly, end.pop, end.bang, end.clover, end.holdL, end.holdR]).toEqual([
      1, -1, -1, 0, -1, 0, 0,
    ]);
    expect([end.spread, end.tie, end.fRz, end.x]).toEqual([0, 0, 0, 0]);
  });

  it('атака: в кадре удара крылья распахнуты, клюв раскрыт, голова к зрителю; сон — голова в пере', () => {
    const strike = W.poseAt('attack', 9 / 24);
    expect(strike.scale).toBeGreaterThan(1.1);
    expect(strike.beak).toBeGreaterThan(0.8);
    expect(Math.min(strike.thL, strike.thR)).toBeGreaterThan(1.4);
    expect(strike.hy).toBeGreaterThan(2);
    expect(strike.strike).toBeGreaterThanOrEqual(0);
    expect(strike.eye).toBe('angry');
    // Лапки переступают только в воздухе: на земле они не едут.
    let prev = W.poseAt('attack', 0);
    for (let i = 1; i < W.FRAMES.attack; i++) {
      const o = W.poseAt('attack', i / W.FPS);
      if (o.z === 0 && prev.z === 0) expect([i, o.fLy]).toEqual([i, prev.fLy]);
      prev = o;
    }
    const sleep = W.poseAt('sleep', 1.5);
    // Шлем съехал, но очки остаются на козырьке (на 0,4 они ложились на глаза).
    expect([sleep.tuck, sleep.eye]).toEqual([1, 'sleep']);
    expect(sleep.capTip).toBeGreaterThan(0.1);
    expect(sleep.capTip).toBeLessThan(0.25);
  });

  it('ходьба: лапки по очереди, опорная стоит; голова держится на месте и догоняет тело рывком', () => {
    const a = W.poseAt('walk', 0.25);
    expect(a.fLz).toBeGreaterThan(1);
    expect([a.fRz, a.fRy]).toEqual([0, 0]);
    const b = W.poseAt('walk', 0.75);
    expect(b.fRz).toBeGreaterThan(1);
    expect([b.fLz, b.fLy]).toEqual([0, 0]);
    for (let i = 0; i < W.FRAMES.walk; i++) {
      const o = W.poseAt('walk', i / W.FPS);
      expect([o.fz, o.fLx, o.fRx]).toEqual([0, 0, 0]);
    }
    // Тело качается, а голова в мире стоит, пока не пришёл рывок.
    const h0 = W.poseAt('walk', 0.0);
    const h1 = W.poseAt('walk', 0.1);
    expect(Math.abs(h0.x - h1.x)).toBeGreaterThan(0.05);
    expect(Math.abs(h0.x + h0.hx - (h1.x + h1.hx))).toBeLessThan(1e-9);
    expect(W.poseAt('walk', 0.17).hy).toBeGreaterThan(h1.hy + 1);
  });
});
