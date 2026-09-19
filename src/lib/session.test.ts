import { describe, expect, it } from 'vitest';
import {
  advance,
  chainIntensity,
  emptySession,
  GRADE_NAME,
  MIN_SPINS,
  orbIntensity,
  rankAmong,
  SESSION_GAP_MS,
  sessionGrade,
  sessionLength,
  sessionNet,
  sessionPeak,
  sessionRoi,
  sessionScore,
  winIntensity,
  worthShowing,
} from './session';
import type { Session, SpinRecord } from './session';

const T0 = 1_700_000_000_000;

function rec(over: Partial<SpinRecord> = {}): SpinRecord {
  return {
    game: 'scatter',
    at: T0,
    staked: 100,
    won: 0,
    bet: 100,
    chain: 0,
    orb: 0,
    bonus: false,
    levels: [],
    ...over,
  };
}

/** Прогоняет список спинов через advance, возвращая заход и архив. */
function play(recs: SpinRecord[]): { session: Session; archived: Session[] } {
  let session: Session | null = null;
  const archived: Session[] = [];
  for (const r of recs) {
    const out = advance(session, r);
    if (out.ended) archived.push(out.ended);
    session = out.session;
  }
  return { session: session ?? emptySession(T0), archived };
}

describe('накопление захода', () => {
  it('первый спин открывает заход', () => {
    const { session } = play([rec({ won: 50 })]);
    expect(session.spins).toBe(1);
    expect(session.startedAt).toBe(T0);
    expect(session.won).toBe(50);
    expect(session.staked).toBe(100);
  });

  it('копит ставки, выигрыши и вращения по играм', () => {
    const { session } = play([
      rec({ game: 'scatter', won: 20 }),
      rec({ game: 'slots', at: T0 + 1000, won: 80, staked: 50, bet: 50 }),
    ]);
    expect(session.spins).toBe(2);
    expect(session.staked).toBe(150);
    expect(session.won).toBe(100);
    expect(session.byScatter).toBe(1);
    expect(session.bySlots).toBe(1);
  });

  it('бесплатное вращение не увеличивает вложенное', () => {
    const { session } = play([rec({ staked: 0, won: 300, bet: 100 })]);
    expect(session.staked).toBe(0);
    expect(session.won).toBe(300);
    // Но множитель всё равно считается — от номинальной ставки.
    expect(session.bestMult).toBe(3);
  });

  it('множитель ведётся отдельно от монет', () => {
    // Крупная сумма по большой ставке против скромной по копеечной:
    // запомнится вторая, и лучший множитель должен быть от неё.
    const { session } = play([
      rec({ won: 900, bet: 300, staked: 300 }), // ×3
      rec({ at: T0 + 1000, won: 200, bet: 10, staked: 10 }), // ×20
    ]);
    expect(session.bestWin).toBe(900);
    expect(session.bestMult).toBe(20);
  });

  it('запоминает, на каком спине случилось лучшее', () => {
    const { session } = play([
      rec(),
      rec({ at: T0 + 1 }),
      rec({ at: T0 + 2, won: 500 }),
      rec({ at: T0 + 3 }),
    ]);
    expect(session.bestWinAt).toBe(3);
  });

  it('считает бонусы и уровни', () => {
    const { session } = play([
      rec({ bonus: true }),
      rec({ at: T0 + 1, levels: [7, 8] }),
      rec({ at: T0 + 2, bonus: true }),
    ]);
    expect(session.bonuses).toBe(2);
    expect(session.bonusAt).toBe(1);
    expect(session.levels).toBe(2);
    expect(session.topLevel).toBe(8);
  });
});

describe('границы захода', () => {
  it('долгий перерыв начинает новый заход', () => {
    const recs = Array.from({ length: MIN_SPINS }, (_, i) => rec({ at: T0 + i * 1000, won: 10 }));
    const after = rec({ at: T0 + SESSION_GAP_MS + 10_000 });
    const { session, archived } = play([...recs, after]);
    expect(archived).toHaveLength(1);
    expect(archived[0].spins).toBe(MIN_SPINS);
    expect(session.spins).toBe(1);
  });

  it('короткий перерыв заход не рвёт', () => {
    const { session, archived } = play([rec(), rec({ at: T0 + SESSION_GAP_MS - 1000 })]);
    expect(archived).toHaveLength(0);
    expect(session.spins).toBe(2);
  });

  it('огрызок в архив не попадает', () => {
    // Два вращения полчаса назад — не заход, архивировать нечего.
    const { archived } = play([rec(), rec({ at: T0 + SESSION_GAP_MS + 5000 })]);
    expect(archived).toHaveLength(0);
  });
});

describe('шкала яркости', () => {
  it('выигрыш растёт по множителю и упирается в сотню', () => {
    expect(winIntensity(0)).toBe(0);
    expect(winIntensity(1)).toBeLessThan(winIntensity(3));
    expect(winIntensity(3)).toBeLessThan(winIntensity(7));
    expect(winIntensity(7)).toBeLessThan(winIntensity(30));
    expect(winIntensity(60)).toBe(100);
    expect(winIntensity(5000)).toBe(100);
  });

  it('сфера меряется по лестнице редкости', () => {
    expect(orbIntensity(0)).toBe(0);
    expect(orbIntensity(3)).toBe(0); // обычная пиком не бывает
    expect(orbIntensity(10)).toBeGreaterThan(orbIntensity(5));
    expect(orbIntensity(50)).toBeGreaterThan(orbIntensity(20));
    expect(orbIntensity(500)).toBe(100);
  });

  it('цепочка из одного звена — не событие', () => {
    expect(chainIntensity(1)).toBe(0);
    expect(chainIntensity(2)).toBeGreaterThan(0);
    expect(chainIntensity(6)).toBeGreaterThan(chainIntensity(3));
    expect(chainIntensity(50)).toBeLessThanOrEqual(95);
  });
});

describe('выбор пика', () => {
  it('без событий — честное «ровный заход»', () => {
    const { session } = play(Array.from({ length: 12 }, (_, i) => rec({ at: T0 + i })));
    const peak = sessionPeak(session);
    expect(peak.kind).toBe('none');
    expect(peak.intensity).toBe(0);
  });

  it('реликвия перебивает средний выигрыш', () => {
    const { session } = play([
      rec({ won: 700, bet: 100 }), // ×7 → 48
      rec({ at: T0 + 1, orb: 500 }), // реликвия → 100
    ]);
    expect(sessionPeak(session).kind).toBe('orb');
  });

  it('огромный выигрыш перебивает редкую сферу', () => {
    const { session } = play([
      rec({ orb: 12 }), // редкая → 32
      rec({ at: T0 + 1, won: 6000, bet: 100 }), // ×60 → 100
    ]);
    expect(sessionPeak(session).kind).toBe('win');
  });

  it('при ничьей выигрыш идёт первым', () => {
    // ×60 и реликвия дают по сотне: показываем выигрыш — он включает в себя
    // и эффект сферы, то есть рассказывает ту же историю целиком.
    const { session } = play([rec({ won: 6000, bet: 100, orb: 500 })]);
    expect(sessionPeak(session).kind).toBe('win');
  });

  it('если больше ничего не случилось, пик — бонус', () => {
    const { session } = play([rec({ bonus: true }), rec({ at: T0 + 1, won: 120, bet: 100 })]);
    expect(sessionPeak(session).kind).toBe('bonus');
  });

  it('пик всегда один и с обеими строками', () => {
    const { session } = play([rec({ won: 900, bet: 100, orb: 250, chain: 4, bonus: true })]);
    const peak = sessionPeak(session);
    expect(peak.title).toBeTruthy();
    expect(peak.detail).toBeTruthy();
    expect(peak.detail).toContain('из 1');
  });

  it('в подписи видно, на каком спине это было', () => {
    const { session } = play([
      rec(),
      rec({ at: T0 + 1 }),
      rec({ at: T0 + 2, orb: 250 }),
      rec({ at: T0 + 3 }),
    ]);
    expect(sessionPeak(session).detail).toBe('на 3-м спине из 4');
  });

  it('множитель пишется без лишнего хвоста', () => {
    const { session } = play([rec({ won: 1200, bet: 100 })]);
    expect(sessionPeak(session).title).toBe('×12 за один спин');
  });
});

describe('оценка и сравнение', () => {
  /** Двенадцать вращений, и ни одного события. */
  const flat = play(Array.from({ length: 12 }, (_, i) => rec({ at: T0 + i }))).session;
  const great = play([
    ...Array.from({ length: 10 }, (_, i) => rec({ at: T0 + i })),
    rec({ at: T0 + 20, won: 3000, bet: 100 }),
  ]).session;

  it('ступень растёт вместе с пиком', () => {
    // Двенадцать пустых вращений — это всё-таки заход, просто без историй.
    expect(sessionGrade(flat)).toBe('ordinary');
    expect(['great', 'unforgettable']).toContain(sessionGrade(great));
  });

  it('совсем короткий и пустой заход называется тихим', () => {
    const short = play(Array.from({ length: MIN_SPINS }, (_, i) => rec({ at: T0 + i }))).session;
    expect(sessionGrade(short)).toBe('quiet');
  });

  it('у каждой ступени есть название', () => {
    for (const g of ['quiet', 'ordinary', 'good', 'great', 'unforgettable'] as const) {
      expect(GRADE_NAME[g]).toBeTruthy();
    }
  });

  it('плюс без событий всё же считается удачным', () => {
    const { session } = play(
      Array.from({ length: 12 }, (_, i) => rec({ at: T0 + i, won: 140, bet: 100 })),
    );
    expect(sessionNet(session)).toBeGreaterThan(0);
    expect(sessionGrade(session)).toBe('good');
  });

  it('итог и доходность считаются от вложенного', () => {
    const { session } = play([rec({ staked: 100, won: 150 })]);
    expect(sessionNet(session)).toBe(50);
    expect(sessionRoi(session)).toBeCloseTo(0.5, 6);
  });

  it('заход с событием ценится выше ровного плюса', () => {
    // Смысл шкалы: яркий момент важнее аккуратного профита.
    expect(sessionScore(great)).toBeGreaterThan(sessionScore(flat));
  });

  it('место среди прошлых считается честно', () => {
    expect(rankAmong(great, [flat, flat])).toEqual({ rank: 1, of: 3 });
    expect(rankAmong(flat, [great, great])).toEqual({ rank: 3, of: 3 });
    expect(rankAmong(great, [])).toEqual({ rank: 1, of: 1 });
  });
});

describe('когда показывать', () => {
  it('короткий заглянул — не показываем', () => {
    const { session } = play(Array.from({ length: MIN_SPINS - 1 }, (_, i) => rec({ at: T0 + i })));
    expect(worthShowing(session)).toBe(false);
  });

  it('настоящий заход — показываем', () => {
    const { session } = play(Array.from({ length: MIN_SPINS }, (_, i) => rec({ at: T0 + i })));
    expect(worthShowing(session)).toBe(true);
  });

  it('пустоту не показываем', () => {
    expect(worthShowing(null)).toBe(false);
  });
});

describe('длительность словами', () => {
  it('считает минуты и часы', () => {
    const base = emptySession(T0);
    expect(sessionLength({ ...base, lastAt: T0 + 20_000 })).toBe('меньше минуты');
    expect(sessionLength({ ...base, lastAt: T0 + 7 * 60_000 })).toBe('7 мин');
    expect(sessionLength({ ...base, lastAt: T0 + 60 * 60_000 })).toBe('1 ч');
    expect(sessionLength({ ...base, lastAt: T0 + 95 * 60_000 })).toBe('1 ч 35 мин');
  });
});
