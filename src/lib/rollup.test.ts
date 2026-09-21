import { describe, expect, it } from 'vitest';
import { ROLLUP_MAX_MS, WIN_TIERS, rollupPlan, winTier } from './rollup';
import { MAX_WIN } from './scatter';

describe('лестница выигрышей', () => {
  it('ступени идут вверх и заканчиваются пределом выигрыша', () => {
    for (let i = 1; i < WIN_TIERS.length; i++) {
      expect(WIN_TIERS[i].at).toBeGreaterThan(WIN_TIERS[i - 1].at);
      expect(WIN_TIERS[i].beats).toBeGreaterThanOrEqual(WIN_TIERS[i - 1].beats);
    }
    // Верхняя ступень — это ровно потолок выплаты: «МАКСИМУМ» должен
    // существовать, чтобы его можно было хотеть.
    expect(WIN_TIERS[WIN_TIERS.length - 1].at).toBe(MAX_WIN);
  });

  it('титул берётся из пробитой ступени', () => {
    expect(winTier(0.5)).toBeNull();
    expect(winTier(1)?.id).toBe('back');
    expect(winTier(24.9)?.id).toBe('good');
    expect(winTier(25)?.id).toBe('big');
    expect(winTier(100000)?.id).toBe('max');
  });
});

describe('план счёта', () => {
  it('пустой выигрыш не считается', () => {
    expect(rollupPlan(0, 0, 100).legs).toEqual([]);
    expect(rollupPlan(500, 100, 100).ms).toBe(0);
  });

  it('длительность растёт вместе с выигрышем — в этом вся суть', () => {
    const bet = 100;
    const ms = [0.4, 2, 8, 30, 120, 700, 5000].map((x) => rollupPlan(0, x * bet, bet).ms);
    for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1]);
    // Мелочь — меньше секунды, максимум — больше десяти. Прежний счёт давал
    // и тому и другому по 400 мс, отчего ×500 и проскакивал незамеченным.
    expect(ms[0]).toBeLessThan(1000);
    expect(ms[ms.length - 1]).toBeGreaterThan(10_000);
    expect(ms[ms.length - 1]).toBeLessThanOrEqual(ROLLUP_MAX_MS);
  });

  it('счёт останавливается ровно на каждой пробитой ступени', () => {
    const bet = 50;
    const plan = rollupPlan(0, 300 * bet, bet);
    const stops = plan.legs.filter((l) => l.tier).map((l) => l.tier!.id);
    expect(stops).toEqual(['back', 'nice', 'good', 'big', 'huge', 'mega']);
    // На каждой ступени сумма ровно пороговая — иначе титул врёт.
    plan.legs
      .filter((l) => l.tier)
      .forEach((l) => expect(l.to).toBe(l.tier!.at * bet));
    expect(plan.top?.id).toBe('mega');
    // Последний отрезок доводит до итога и ступени не пробивает.
    expect(plan.legs[plan.legs.length - 1].to).toBe(300 * bet);
    expect(plan.legs[plan.legs.length - 1].tier).toBeNull();
  });

  it('ступени ниже старта не считаются пробитыми заново', () => {
    const bet = 100;
    // База уже 30 ставок — «ВЕРНУЛОСЬ» и «ХОРОШИЙ» остались позади.
    const plan = rollupPlan(30 * bet, 300 * bet, bet);
    const stops = plan.legs.filter((l) => l.tier).map((l) => l.tier!.id);
    expect(stops).toEqual(['huge', 'mega']);
  });

  it('выигрыш чуть выше порога считается быстрее, чем перед следующим', () => {
    const bet = 100;
    const just = rollupPlan(26 * bet, 27 * bet, bet).ms;
    const almost = rollupPlan(26 * bet, 74 * bet, bet).ms;
    expect(just).toBeLessThan(almost);
  });

  it('паузы переживают ужатие по потолку', () => {
    const bet = 1;
    const plan = rollupPlan(0, MAX_WIN * bet, bet);
    expect(plan.ms).toBeLessThanOrEqual(ROLLUP_MAX_MS + 1);
    // Ход ужимается, паузы — нет: пауза и есть событие.
    const holds = plan.legs.reduce((s, l) => s + l.hold, 0);
    expect(holds).toBeGreaterThan(4000);
    expect(plan.legs.every((l) => l.ms > 0)).toBe(true);
  });

  it('отрезки идут строго вверх и доводят ровно до итога', () => {
    const bet = 20;
    for (const x of [0.3, 1, 4, 12, 40, 90, 260, 900, 2600, 5000]) {
      const plan = rollupPlan(0, x * bet, bet);
      let prev = 0;
      for (const l of plan.legs) {
        expect(l.to).toBeGreaterThan(prev);
        expect(l.ms).toBeGreaterThan(0);
        prev = l.to;
      }
      expect(prev).toBeCloseTo(x * bet, 6);
    }
  });
});
