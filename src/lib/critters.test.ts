import { describe, expect, it } from 'vitest';
import {
  BAT_GAP_MS,
  BAT_PER_BLOCK,
  batAt,
  batOffers,
  batPath,
  batRoll,
  cardRank,
  newTreasure,
  normalizeTreasure,
  riskable,
  riskDeal,
  riskReveal,
  shinyRoll,
  shinyValue,
} from './critters';
import { rankCost } from './prison';

/** Детерминированный ГСЧ: тесты не зависят от удачи прогона. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('летучая мышь', () => {
  it('не летает чаще раза в сто секунд', () => {
    const rnd = lcg(1);
    expect(batRoll(1000, BAT_GAP_MS - 1, rnd)).toBe(false);
    expect(batRoll(0, 1e9, rnd)).toBe(false);
  });

  it('шанс — на каждый сломанный блок', () => {
    const rnd = lcg(2);
    let n = 0;
    const tries = 200_000;
    for (let i = 0; i < tries; i++) if (batRoll(1, 1e9, rnd)) n++;
    expect(n / tries).toBeCloseTo(BAT_PER_BLOCK, 3);
    // Волна отбойника (много блоков разом) пугает мышь вероятнее одиночного удара.
    let m = 0;
    for (let i = 0; i < 20_000; i++) if (batRoll(60, 1e9, rnd)) m++;
    expect(m / 20_000).toBeGreaterThan(0.1);
  });

  it('влетает из-за края, пересекает поле и не уходит за верх и низ', () => {
    const rnd = lcg(3);
    for (let k = 0; k < 200; k++) {
      const p = batPath(rnd, rnd() < 0.2);
      const a = batAt(p, 0);
      const b = batAt(p, 1);
      expect(Math.min(a.x, b.x)).toBeLessThan(0);
      expect(Math.max(a.x, b.x)).toBeGreaterThan(1);
      for (let t = 0; t <= 1; t += 0.02) {
        const { y } = batAt(p, t);
        expect(y).toBeGreaterThanOrEqual(0.06);
        expect(y).toBeLessThanOrEqual(0.94);
      }
    }
  });
});

describe('сундучок', () => {
  it('три карты разного рода, и всегда есть чем рискнуть', () => {
    const rnd = lcg(4);
    for (let k = 0; k < 500; k++) {
      const o = batOffers({ rank: k % 26, prestige: 0 }, false, rnd);
      expect(o).toHaveLength(3);
      expect(new Set(o.map((r) => r.kind)).size).toBe(3);
      expect(o.some(riskable)).toBe(true);
    }
  });

  it('синяя мышь щедрее', () => {
    const plain = batOffers({ rank: 10, prestige: 0 }, false, lcg(5));
    const rare = batOffers({ rank: 10, prestige: 0 }, true, lcg(5));
    const coins = (o: typeof plain) => o.find((r) => r.kind === 'coins');
    const a = coins(plain);
    const b = coins(rare);
    if (a?.kind === 'coins' && b?.kind === 'coins') expect(b.amount).toBeGreaterThan(a.amount);
  });

  it('монеты сундучка — малая доля цены ранга: это внимание, а не доход', () => {
    const o = batOffers({ rank: 12, prestige: 0 }, false, lcg(6));
    const c = o.find((r) => r.kind === 'coins');
    if (c?.kind === 'coins') expect(c.amount / rankCost(12)).toBeLessThan(0.08);
  });

  it('одна карта (мешочек сороки) — сразу выбрана и стоит на кону', () => {
    const t = newTreasure('magpie', [{ kind: 'coins', amount: 1200 }]);
    expect(t.pick).toBe(0);
    expect(t.stake).toBe(1200);
  });

  it('битое сохранение не ломает игру', () => {
    expect(normalizeTreasure(null)).toBeNull();
    expect(normalizeTreasure({ options: [] })).toBeNull();
    expect(normalizeTreasure({ options: [{ kind: 'pet', id: 'x' }] })).toBeNull();
    const t = normalizeTreasure({
      from: 'batRare',
      options: [{ kind: 'coins', amount: 10 }, { kind: 'keys', amount: 1 }],
      pick: 9,
      stake: -5,
      step: 99,
      dealer: 77,
    });
    expect(t).toEqual({
      from: 'batRare',
      options: [
        { kind: 'coins', amount: 10 },
        { kind: 'keys', amount: 1 },
      ],
      pick: 1,
      stake: 0,
      step: 4,
      dealer: 51,
    });
  });
});

describe('риск-игра', () => {
  it('четыре закрытые карты разные и не повторяют карту сдающего', () => {
    const rnd = lcg(7);
    for (let k = 0; k < 2000; k++) {
      const d = riskDeal(rnd);
      const r = riskReveal(d, k % 4, rnd);
      expect(new Set([...r.cards, d]).size).toBe(5);
    }
  });

  it('честная: выиграть и проиграть одинаково вероятно', () => {
    const rnd = lcg(8);
    let win = 0;
    let lose = 0;
    const n = 300_000;
    for (let k = 0; k < n; k++) {
      const r = riskReveal(riskDeal(rnd), Math.floor(rnd() * 4), rnd);
      if (r.outcome === 'win') win++;
      else if (r.outcome === 'lose') lose++;
    }
    expect(Math.abs(win - lose) / n).toBeLessThan(0.006);
    // Ничья — примерно каждая семнадцатая (3 из 51 карты того же достоинства).
    expect((n - win - lose) / n).toBeCloseTo(3 / 51, 2);
  });

  it('в среднем риск ничего не отнимает и не дарит', () => {
    // Игрок рискует до конца (ничья — переигрывается): ставка в среднем та же.
    const rnd = lcg(9);
    let sum = 0;
    const n = 100_000;
    for (let k = 0; k < n; k++) {
      let stake = 1;
      for (;;) {
        const r = riskReveal(riskDeal(rnd), 0, rnd);
        if (r.outcome === 'draw') continue;
        stake = r.outcome === 'win' ? stake * 2 : 0;
        break;
      }
      sum += stake;
    }
    expect(sum / n).toBeGreaterThan(0.97);
    expect(sum / n).toBeLessThan(1.03);
  });

  it('старшинство: туз старше короля, двойка младше всех', () => {
    expect(cardRank(12)).toBeGreaterThan(cardRank(11));
    expect(cardRank(13)).toBe(0);
  });
});

describe('сорока', () => {
  it('ключ — редкость, и только пока он ещё не выпал', () => {
    const rnd = lcg(10);
    let keys = 0;
    for (let k = 0; k < 10_000; k++) if (shinyRoll(rnd, true) === 'key') keys++;
    expect(keys / 10_000).toBeLessThan(0.06);
    for (let k = 0; k < 10_000; k++) expect(shinyRoll(rnd, false)).not.toBe('key');
  });

  it('налёт стоит примерно как метеорит, а не как ранг', () => {
    // ≈34 броска за налёт, подобрано две трети — средний мешочек.
    const rnd = lcg(11);
    const p = { rank: 10, prestige: 0 };
    let coins = 0;
    for (let k = 0; k < 23; k++) coins += shinyValue(shinyRoll(rnd, false), p).coins;
    const share = coins / rankCost(10);
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.3);
  });
});
