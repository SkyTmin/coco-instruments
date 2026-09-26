import { describe, expect, it } from 'vitest';
import {
  avgKg,
  biteNow,
  biteWait,
  BITE_MIN,
  BOX_CHANCE,
  FISH,
  fishValue,
  normalizeFishing,
  pullOf,
  RODS,
  rodReach,
  rollBite,
  skillOf,
  skillXpFor,
  SPOTS,
  startFight,
  stepFight,
} from './fishing';
import type { FishDef } from './fishing';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Бот-рыбак: держит, пока натяжение не выше 0,8, отпускает, пока не упадёт
 * до 0,5. Видит натяжение с опозданием 0,2 с — как живой человек.
 */
function fight(pull: number, reel: number, rnd: () => number): { end: string; t: number } {
  let f = startFight(0.5, rnd);
  let hold = true;
  const hist: number[] = [];
  for (let s = 0; s < 60 * 120; s++) {
    hist.push(f.tension);
    const seen = hist[Math.max(0, hist.length - 13)];
    if (seen > 0.8) hold = false;
    else if (seen < 0.5) hold = true;
    const r = stepFight(f, 1 / 60, hold, pull, reel, rnd);
    f = r.f;
    if (r.end) return { end: r.end, t: f.t };
  }
  return { end: 'timeout', t: f.t };
}

function rate(pull: number, reel: number, n = 300, seed = 1): { caught: number; t: number } {
  const rnd = lcg(seed);
  let caught = 0;
  let t = 0;
  for (let k = 0; k < n; k++) {
    const r = fight(pull, reel, rnd);
    if (r.end === 'caught') caught++;
    t += r.t;
  }
  return { caught: caught / n, t: t / n };
}

describe('рыбалка: справочники', () => {
  it('места открываются по мастерству, дороже от места к месту', () => {
    for (let i = 1; i < SPOTS.length; i++) {
      expect(SPOTS[i].skill).toBeGreaterThan(SPOTS[i - 1].skill);
      expect(SPOTS[i].base).toBeGreaterThan(SPOTS[i - 1].base * 1.6);
    }
    for (let s = 0; s < SPOTS.length; s++) expect(FISH.filter((f) => f.spot === s).length).toBeGreaterThanOrEqual(5);
  });

  it('удочки: сильнее и дороже по порядку', () => {
    for (let i = 1; i < RODS.length; i++) {
      expect(RODS[i].power).toBeGreaterThan(RODS[i - 1].power);
      expect(RODS[i].price).toBeGreaterThan(RODS[i - 1].price);
    }
  });

  it('мастерство растёт по кривой, до моря — вечер-другой', () => {
    let xp = 0;
    for (let l = 1; l < SPOTS[SPOTS.length - 1].skill; l++) xp += skillXpFor(l);
    expect(skillOf(xp).level).toBe(SPOTS[SPOTS.length - 1].skill);
    // Средняя рыба даёт ≈2,6 опыта: до моря 350–550 рыб.
    expect(xp / 2.6).toBeGreaterThan(350);
    expect(xp / 2.6).toBeLessThan(550);
  });
});

describe('рыбалка: вываживание', () => {
  it('рыба слабее удочки ловится почти всегда и быстро', () => {
    const r = rate(1.2, 1);
    expect(r.caught).toBeGreaterThan(0.97);
    expect(r.t).toBeLessThan(15);
  });

  it('сильная рыба — риск, а не приговор и не формальность', () => {
    const r = rate(2, 1);
    expect(r.caught).toBeGreaterThan(0.65);
    expect(r.caught).toBeLessThan(0.97);
  });

  it('рыба втрое сильнее удочки почти всегда рвёт леску', () => {
    expect(rate(3.2, 1).caught).toBeLessThan(0.1);
  });

  it('хорошая катушка помогает против сильной рыбы', () => {
    expect(rate(2.4, 2).caught).toBeGreaterThan(rate(2.4, 1).caught);
  });

  it('удочка N — под место N: подсказка в «Снастях» не врёт', () => {
    expect(RODS.map((_, i) => rodReach(i))).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('с удочкой своего места обычная рыба не рвётся, редкая — требует рук', () => {
    const rodFor = [0, 1, 2, 3, 4];
    for (const f of FISH) {
      const pull = pullOf(f, avgKg(f), rodFor[f.spot]);
      if (f.rarity === 'common') expect(pull).toBeLessThan(1.45);
      else expect(pull).toBeLessThan(2.6);
    }
  });
});

describe('рыбалка: поклёвка и цена', () => {
  it('шкатулка — редкость, ракушки — только где водятся', () => {
    const rnd = lcg(3);
    let box = 0;
    let mussel = 0;
    const n = 50_000;
    for (let k = 0; k < n; k++) {
      const b = rollBite(1, 1, 0.5, rnd);
      if (b.kind === 'box') box++;
      if (b.kind === 'mussel') mussel++;
    }
    expect(box / n).toBeCloseTo(BOX_CHANCE, 2);
    expect(mussel).toBe(0);
  });

  it('клёв и дальний заброс поднимают долю редких', () => {
    const share = (bite: number, dist: number) => {
      const rnd = lcg(4);
      let rare = 0;
      let all = 0;
      for (let k = 0; k < 40_000; k++) {
        const b = rollBite(2, bite, dist, rnd);
        if (b.kind !== 'fish') continue;
        all++;
        if (b.fish.rarity !== 'common') rare++;
      }
      return rare / all;
    };
    expect(share(1, 1)).toBeGreaterThan(share(0.2, 0) * 1.5);
  });

  it('клёв падает и отрастает, но не ниже дна', () => {
    expect(biteNow(0.5, 0, 60_000)).toBeCloseTo(0.62, 2);
    expect(biteNow(0, 0, 0)).toBe(BITE_MIN);
    expect(biteNow(0.9, 0, 3_600_000)).toBe(1);
    expect(biteWait(0.2, 1, () => 0.5)).toBeGreaterThan(biteWait(1, 0, () => 0.5));
  });

  it('тяжёлая дороже лёгкой, мастерство — сверху', () => {
    const f = FISH.find((x) => x.id === 'pike') as FishDef;
    expect(fishValue(f, 6, 1)).toBeGreaterThan(fishValue(f, 2, 1));
    expect(fishValue(f, 3, 20)).toBeGreaterThan(fishValue(f, 3, 1));
  });

  it('доход в минуту растёт от места к месту и не обгоняет лес', () => {
    // Рыба в минуту: заброс, ожидание при клёве 0,7, бой, карточка ≈ 15 с.
    const perFish = 15;
    const incomes = SPOTS.map((s, i) => {
      const rnd = lcg(10 + i);
      let v = 0;
      let n = 0;
      for (let k = 0; k < 20_000; k++) {
        const b = rollBite(i, 0.7, 0.5, rnd);
        if (b.kind !== 'fish') continue;
        v += fishValue(b.fish, b.kg, s.skill);
        n++;
      }
      return ((v / n) * 60) / perFish;
    });
    for (let i = 1; i < incomes.length; i++) expect(incomes[i]).toBeGreaterThan(incomes[i - 1] * 2);
    // Пруд — около 500 в минуту, как ива в лесу; море — ≈24 тыс., меньше верхней делянки леса (≈33 тыс.):
    // рыба — ещё один промысел, а не станок, который печатает деньги мимо шахты.
    expect(incomes[0]).toBeGreaterThan(300);
    expect(incomes[0]).toBeLessThan(800);
    expect(incomes[incomes.length - 1]).toBeLessThan(28_000);
  });

  it('битое сохранение не ломает рыбалку', () => {
    const s = normalizeFishing({ xp: -5, rod: 99, spot: 4, bite: [5, -1], records: { pike: 3, nope: 9 } } as never);
    expect(s.xp).toBe(0);
    expect(s.rod).toBe(RODS.length - 1);
    // Место моря закрыто без мастерства — возвращаем на пруд.
    expect(s.spot).toBe(0);
    expect(s.bite[0]).toBe(1);
    expect(s.bite[1]).toBe(BITE_MIN);
    expect(s.records).toEqual({ pike: 3 });
  });
});
