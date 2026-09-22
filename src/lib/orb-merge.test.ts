import { describe, expect, it } from 'vitest';
import { bubbleScale, MERGE, MERGE_VARIANTS, pickVariant, planMerge } from './orb-merge';
import type { MergeFrame, MergeOrb, MergePlan, MergeVariant } from './orb-merge';

/** Детерминированный ГСЧ: тесты не должны зависеть от удачи. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Поле 6×5 по 62×68 px, как на телефоне; сфера — в центре своей клетки. */
const W = 372;
const H = 340;
const cell = (c: number, r: number, value: number): MergeOrb => ({
  id: `${c}-${r}`,
  x: c * 62 + 31,
  y: r * 68 + 34,
  value,
});

const LAYOUTS: MergeOrb[][] = [
  [cell(0, 0, 2), cell(5, 4, 10)],
  [cell(2, 2, 3), cell(2, 3, 5)],
  [cell(0, 4, 2), cell(3, 0, 25), cell(5, 2, 4)],
  [cell(1, 1, 2), cell(1, 3, 2), cell(4, 1, 8), cell(4, 4, 100)],
  [cell(0, 0, 2), cell(1, 4, 3), cell(2, 2, 5), cell(3, 1, 10), cell(4, 3, 15), cell(5, 0, 50)],
];

const VARIANTS = Object.keys(MERGE_VARIANTS) as MergeVariant[];

/** Где пузырь в момент t — так, как его проиграет браузер (линейно между кадрами). */
function at(frames: MergeFrame[], t: number): MergeFrame {
  if (t <= frames[0].t) return frames[0];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (t <= b.t) {
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return {
        t,
        x: a.x + (b.x - a.x) * k,
        y: a.y + (b.y - a.y) * k,
        s: a.s + (b.s - a.s) * k,
        o: a.o + (b.o - a.o) * k,
      };
    }
  }
  return frames[frames.length - 1];
}

function each(fn: (plan: MergePlan, orbs: MergeOrb[], v: MergeVariant, turbo: boolean) => void) {
  for (const v of VARIANTS) {
    for (const orbs of LAYOUTS) {
      for (const turbo of [false, true]) {
        for (const stampShown of [false, true]) {
          const plan = planMerge(orbs, {
            width: W,
            height: H,
            radius: 31,
            speed: turbo ? 0.55 : 1,
            stampShown,
            rng: seeded(orbs.length * 31 + v.length),
            variant: v,
          });
          fn(plan, orbs, v, turbo);
        }
      }
    }
  }
}

describe('слияние сфер: арифметика', () => {
  it('ровно n−1 слияний, и в конце общий пузырь показывает всю сумму', () => {
    each((plan, orbs) => {
      expect(plan.merges).toHaveLength(orbs.length - 1);
      const total = orbs.reduce((s, o) => s + o.value, 0);
      expect(plan.merges[plan.merges.length - 1].sum).toBe(total);
      expect(plan.merges[plan.merges.length - 1].into).toBe(plan.survivor);
    });
  });

  it('каждая сфера поглощается ровно один раз, выживший — ни разу', () => {
    each((plan, orbs) => {
      const eaten = plan.merges.map((m) => m.from);
      expect(new Set(eaten).size).toBe(eaten.length);
      expect(eaten).not.toContain(plan.survivor);
      expect(new Set([...eaten, plan.survivor]).size).toBe(orbs.length);
      // Поглощённый дальше ни в кого не вливает: после смерти не живут.
      plan.merges.forEach((m, i) => {
        const later = plan.merges.slice(i + 1);
        expect(later.some((n) => n.into === m.from || n.from === m.from)).toBe(false);
      });
    });
  });

  it('слияния идут по одному и не сливаются в одно «блоп»', () => {
    each((plan, _orbs, _v, turbo) => {
      const gap = MERGE.gapMs * (turbo ? 0.55 : 1) * 0.5;
      for (let i = 1; i < plan.merges.length; i++) {
        expect(plan.merges[i].at - plan.merges[i - 1].at).toBeGreaterThanOrEqual(gap);
      }
    });
  });
});

describe('слияние сфер: движение', () => {
  it('поглощённый доплывает ровно до поглотившего и там гаснет', () => {
    each((plan) => {
      for (const m of plan.merges) {
        const a = at(plan.tracks[m.from], m.at);
        const b = at(plan.tracks[m.into], m.at);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(2);
        expect(a.o).toBeLessThan(0.05);
        // До касания он виден целиком — не тает на полпути.
        expect(at(plan.tracks[m.from], m.at - MERGE.absorbMs * 1.2).o).toBeGreaterThan(0.95);
      }
    });
  });

  it('общий пузырь заканчивает в точке, где лопнет, и остаётся видимым', () => {
    each((plan) => {
      const last = at(plan.tracks[plan.survivor], plan.end);
      expect(Math.hypot(last.x - plan.home.x, last.y - plan.home.y)).toBeLessThan(2);
      expect(last.o).toBe(1);
      // Он раздулся: поглотил остальных.
      expect(last.s).toBeGreaterThan(MERGE.base);
      expect(last.s).toBeLessThanOrEqual(MERGE.maxScale);
    });
  });

  it('никто не уплывает за край поля', () => {
    each((plan) => {
      for (const frames of Object.values(plan.tracks)) {
        for (const f of frames) {
          expect(f.x).toBeGreaterThanOrEqual(0);
          expect(f.x).toBeLessThanOrEqual(W);
          expect(f.y).toBeGreaterThanOrEqual(0);
          expect(f.y).toBeLessThanOrEqual(H);
        }
      }
    });
  });

  it('раздутый пузырь целиком внутри поля, а не срезан кромкой', () => {
    each((plan) => {
      for (const frames of Object.values(plan.tracks)) {
        for (const f of frames) {
          // Кадр 0 — гнездо клетки: пузырь в нём ещё только надувается.
          if (f.t < MERGE.inflateMs * plan.timeScale || f.o < 0.5) continue;
          const r = 31 * MERGE.span * f.s;
          expect(f.x - r).toBeGreaterThanOrEqual(-1);
          expect(f.x + r).toBeLessThanOrEqual(W + 1);
          expect(f.y - r).toBeGreaterThanOrEqual(-1);
          expect(f.y + r).toBeLessThanOrEqual(H + 1);
        }
      }
    });
  });

  it('в бонусе общий пузырь лопается выше середины — не под жетоном', () => {
    const plan = planMerge(LAYOUTS[3], {
      width: W,
      height: H,
      radius: 31,
      stampShown: true,
      rng: seeded(3),
      variant: 'gather',
    });
    expect(plan.home.y).toBeLessThan(H * 0.4);
  });

  it('кадры идут по времени и не прыгают', () => {
    each((plan) => {
      for (const frames of Object.values(plan.tracks)) {
        for (let i = 1; i < frames.length; i++) {
          expect(frames[i].t).toBeGreaterThanOrEqual(frames[i - 1].t);
          const dt = frames[i].t - frames[i - 1].t;
          const d = Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y);
          // Пузырь плывёт: за 40 мс кадра — не больше трети поля даже в турбо.
          if (dt > 0) expect(d / dt).toBeLessThan(3);
          else expect(d).toBeLessThan(1);
        }
      }
    });
  });

  it('стартует с места своей клетки', () => {
    each((plan, orbs) => {
      for (const o of orbs) {
        const f = plan.tracks[o.id][0];
        expect(f.t).toBe(0);
        expect(Math.hypot(f.x - o.x, f.y - o.y)).toBeLessThan(0.5);
        expect(f.s).toBe(1);
      }
    });
  });
});

describe('слияние сфер: темп', () => {
  it('укладывается в потолок и в турбо заметно короче', () => {
    each((plan, _o, _v, turbo) => {
      expect(plan.end).toBeLessThanOrEqual(turbo ? MERGE.capTurboMs : MERGE.capMs);
      expect(plan.end).toBeGreaterThan(0);
    });
  });

  it('в турбо выпадают только быстрые варианты', () => {
    const rng = seeded(7);
    for (let i = 0; i < 400; i++) expect(MERGE_VARIANTS[pickVariant(rng, true)].turbo).toBe(true);
  });

  it('все варианты действительно выпадают', () => {
    const rng = seeded(11);
    const seen = new Set<MergeVariant>();
    for (let i = 0; i < 600; i++) seen.add(pickVariant(rng, false));
    expect(seen.size).toBe(VARIANTS.length);
  });

  it('размер растёт с поглощёнными, но не бесконечно', () => {
    expect(bubbleScale(1)).toBeGreaterThan(bubbleScale(0));
    expect(bubbleScale(3)).toBeGreaterThan(bubbleScale(1));
    expect(bubbleScale(50)).toBe(MERGE.maxScale);
  });

  it('одну сферу сливать не с чем', () => {
    expect(() => planMerge([cell(0, 0, 2)], { width: W, height: H, radius: 31 })).toThrow();
  });
});
