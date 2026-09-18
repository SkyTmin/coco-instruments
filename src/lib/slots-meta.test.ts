import { describe, expect, it } from 'vitest';
import {
  DAILY_LADDER,
  EMPTY_COUNTERS,
  SKIN_UNLOCK,
  WHEEL,
  WHEEL_COOLDOWN_MS,
  dailyMissions,
  dailyStatus,
  dayKey,
  daysBetween,
  isSkinUnlocked,
  ladderReward,
  ladderStep,
  levelFromXp,
  levelReward,
  missionDone,
  spinWheel,
  wheelAverage,
  xpForLevel,
  xpForSpin,
} from './slots-meta';
import type { MissionCounters } from './slots-meta';

describe('ежедневная лесенка', () => {
  it('первый заход в жизни даёт первую ступень', () => {
    const st = dailyStatus({ streak: 0 }, '2026-03-10');
    expect(st.ready).toBe(true);
    expect(st.nextStreak).toBe(1);
    expect(st.reward).toBe(DAILY_LADDER[0]);
    expect(st.broken).toBe(false);
  });

  it('вчерашний заход продолжает серию', () => {
    const st = dailyStatus({ streak: 3, lastClaim: '2026-03-09' }, '2026-03-10');
    expect(st.nextStreak).toBe(4);
    expect(st.reward).toBe(DAILY_LADDER[3]);
    expect(st.broken).toBe(false);
  });

  it('пропущенный день обнуляет серию и честно об этом сообщает', () => {
    const st = dailyStatus({ streak: 5, lastClaim: '2026-03-07' }, '2026-03-10');
    expect(st.nextStreak).toBe(1);
    expect(st.reward).toBe(DAILY_LADDER[0]);
    expect(st.broken).toBe(true);
  });

  it('сегодня уже забрали — второй раз нельзя', () => {
    const st = dailyStatus({ streak: 2, lastClaim: '2026-03-10' }, '2026-03-10');
    expect(st.ready).toBe(false);
  });

  it('серия переваливает за неделю и идёт по кругу, не теряя счёт дней', () => {
    const st = dailyStatus({ streak: 7, lastClaim: '2026-03-09' }, '2026-03-10');
    expect(st.nextStreak).toBe(8);
    expect(st.step).toBe(1);
    expect(st.reward).toBe(DAILY_LADDER[0]);
    expect(ladderStep(14)).toBe(7);
    expect(ladderReward(14)).toBe(DAILY_LADDER[6]);
  });

  it('лесенка только растёт внутри недели', () => {
    for (let i = 1; i < DAILY_LADDER.length; i++) {
      expect(DAILY_LADDER[i]).toBeGreaterThan(DAILY_LADDER[i - 1]);
    }
  });

  it('dayKey и daysBetween считают календарные дни', () => {
    expect(dayKey(new Date(2026, 2, 9, 23, 59))).toBe('2026-03-09');
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1); // 2026 — не високосный
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
  });
});

describe('уровни', () => {
  it('первый уровень берётся быстро, дальше дороже', () => {
    expect(xpForLevel(1)).toBeLessThan(120);
    for (let l = 1; l < 30; l++) {
      expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    }
  });

  it('levelFromXp не теряет опыт', () => {
    for (const xp of [0, 50, 105, 500, 5_000, 250_000]) {
      const info = levelFromXp(xp);
      expect(info.into).toBeGreaterThanOrEqual(0);
      expect(info.into).toBeLessThan(info.need);
      expect(info.level).toBeGreaterThanOrEqual(1);
    }
  });

  it('опыт монотонен по количеству опыта', () => {
    let prev = 0;
    for (let xp = 0; xp < 20_000; xp += 137) {
      const { level } = levelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it('за спин всегда капает опыт, джекпот даёт заметно больше', () => {
    expect(xpForSpin(0, 25, 'none')).toBeGreaterThan(0);
    expect(xpForSpin(100, 25, 'small')).toBeGreaterThan(xpForSpin(0, 25, 'none'));
    expect(xpForSpin(9000, 25, 'jackpot')).toBeGreaterThan(xpForSpin(400, 25, 'big'));
  });

  it('крупная ставка ускоряет прогресс не больше чем вдвое', () => {
    const base = xpForSpin(0, 10, 'none');
    expect(xpForSpin(0, 100_000, 'none')).toBeLessThanOrEqual(base * 2 + 1);
  });

  it('награда за уровень растёт, каждый третий даёт вращения', () => {
    expect(levelReward(4).coins).toBeGreaterThan(levelReward(3).coins);
    expect(levelReward(3).freeSpins).toBe(5);
    expect(levelReward(4).freeSpins).toBe(0);
  });

  it('уровни 5 и 9 открывают скины', () => {
    expect(levelReward(5).skin).toBe('neon');
    expect(levelReward(9).skin).toBe('winter');
    expect(isSkinUnlocked('neon', 4)).toBe(false);
    expect(isSkinUnlocked('neon', 5)).toBe(true);
    expect(isSkinUnlocked('classic', 1)).toBe(true);
  });
});

describe('ежедневные миссии', () => {
  it('три штуки, детерминированные для даты', () => {
    const a = dailyMissions('2026-03-10');
    const b = dailyMissions('2026-03-10');
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it('в один день не бывает двух одинаковых целей', () => {
    for (const day of ['2026-01-01', '2026-03-10', '2026-07-22', '2026-12-31']) {
      const kinds = dailyMissions(day).map((m) => m.kind);
      expect(new Set(kinds).size).toBe(3);
    }
  });

  it('за месяц набор успевает поменяться', () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      seen.add(
        dailyMissions(`2026-06-${String(d).padStart(2, '0')}`)
          .map((m) => `${m.kind}:${m.goal}`)
          .join('|'),
      );
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('миссия засчитывается по счётчику дня', () => {
    const [m] = dailyMissions('2026-03-10');
    const counters: MissionCounters = { ...EMPTY_COUNTERS, [m.kind]: m.goal };
    expect(missionDone(m, EMPTY_COUNTERS)).toBe(false);
    expect(missionDone(m, counters)).toBe(true);
  });

  it('награда за миссию заметна, но не ломает экономику', () => {
    for (const m of dailyMissions('2026-03-10')) {
      expect(m.reward).toBeGreaterThan(100);
      expect(m.reward).toBeLessThanOrEqual(1500);
    }
  });
});

describe('колесо', () => {
  it('сектора распределены по весам', () => {
    const hits = new Array(WHEEL.length).fill(0);
    let seed = 1;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 40_000; i++) hits[spinWheel(rng)] += 1;
    const total = WHEEL.reduce((s, w) => s + w.weight, 0);
    WHEEL.forEach((sector, i) => {
      const share = hits[i] / 40_000;
      expect(Math.abs(share - sector.weight / total)).toBeLessThan(0.02);
    });
  });

  it('крутится не чаще раза в четыре часа', () => {
    expect(WHEEL_COOLDOWN_MS).toBe(4 * 60 * 60 * 1000);
  });

  it('средняя выдача колеса скромнее ежедневного бонуса', () => {
    const avg = wheelAverage();
    expect(avg).toBeGreaterThan(200);
    expect(avg).toBeLessThan(DAILY_LADDER[0]);
  });

  it('у всех секторов есть награда — пустых «спасибо за игру» нет', () => {
    for (const s of WHEEL) expect(s.coins + s.freeSpins).toBeGreaterThan(0);
  });
});

describe('скины', () => {
  it('стартовый набор доступен сразу', () => {
    const free = Object.entries(SKIN_UNLOCK).filter(([, lvl]) => lvl === 1);
    expect(free.length).toBeGreaterThanOrEqual(6);
  });
});
