import { describe, expect, it } from 'vitest';
import {
  barygaLots,
  BARYGA_LOTS,
  convoyAsk,
  eventDue,
  eventOf,
  eventPrize,
  EVENTS,
  kuivaCells,
  spawnEvent,
} from './yard';
import {
  freshMine,
  MINE_CELLS,
  MINE_COLS,
  MINE_ROWS,
  modsOf,
  normalizePrison,
  PRISON_START,
  rankCost,
} from './prison';
import type { PrisonState, YardEvent } from './prison';
import { forestMods } from './forest';

const lcg = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const player = (rank = 6): PrisonState =>
  normalizePrison({ ...PRISON_START, rank, mine: freshMine(rank, 42) });

const live = (id: YardEvent['id']): YardEvent => ({
  id,
  place: 'mine',
  from: 0,
  until: Date.now() + 60_000,
  cell: 0,
  hp: 0,
  rock: -1,
  need: 0,
  have: 0,
});

describe('события двора', () => {
  it('шахта получает только события шахты, лес — только леса', () => {
    const rnd = lcg(5);
    const p = player();
    for (let i = 0; i < 400; i++) {
      const m = eventOf(spawnEvent('mine', p, 1000, rnd).id);
      expect(['mine', 'both']).toContain(m.place);
      const f = eventOf(spawnEvent('forest', p, 1000, rnd).id);
      expect(['forest', 'both']).toContain(f.place);
    }
  });

  it('каждое событие хоть раз выпадает', () => {
    const rnd = lcg(9);
    const p = player();
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      seen.add(spawnEvent('mine', p, 0, rnd).id);
      seen.add(spawnEvent('forest', p, 0, rnd).id);
    }
    expect([...seen].sort()).toEqual(EVENTS.map((e) => e.id).sort());
  });

  it('Куйва целиком стоит в поле, метеорит — в клетке, где есть что ломать', () => {
    const rnd = lcg(3);
    const p = player();
    p.mine.dug = p.mine.dug.map((_, c) => (c % 2 ? 5 : 0));
    for (let i = 0; i < 300; i++) {
      const e = spawnEvent('mine', p, 0, rnd);
      if (e.id === 'kuiva') {
        const cells = kuivaCells(e.cell);
        expect(cells).toHaveLength(9);
        for (const c of cells) expect(c).toBeLessThan(MINE_CELLS);
        const x = e.cell % MINE_COLS;
        const y = Math.floor(e.cell / MINE_COLS);
        expect(x).toBeLessThanOrEqual(MINE_COLS - 3);
        expect(y).toBeLessThanOrEqual(MINE_ROWS - 3);
        expect(e.hp).toBeGreaterThan(0);
      }
      if (e.id === 'meteor') expect(p.mine.dug[e.cell]).toBe(0);
    }
  });

  it('конвой просит породу, которая в шахте есть, и посильно', () => {
    for (let rank = 0; rank < 20; rank += 3) {
      const ask = convoyAsk(player(rank));
      expect(ask.need).toBeGreaterThanOrEqual(15);
      expect(ask.need).toBeLessThanOrEqual(80);
      expect(ask.rock).toBeGreaterThanOrEqual(0);
    }
  });

  it('двор молчит до ранга B, до первой паузы и во время события', () => {
    const now = 10_000_000;
    expect(eventDue({ ...player(0), eventNext: 1 }, now)).toBe(false);
    expect(eventDue({ ...player(3), eventNext: 0 }, now)).toBe(false);
    expect(eventDue({ ...player(3), eventNext: now + 1 }, now)).toBe(false);
    expect(eventDue({ ...player(3), eventNext: 1 }, now)).toBe(true);
    expect(
      eventDue({ ...player(3), eventNext: 1, event: { ...live('gold'), until: now + 5 } }, now),
    ).toBe(false);
  });

  it('получка удваивает продажу, жила утраивает добычу, буря валит лес', () => {
    const p = player();
    expect(modsOf({ ...p, event: live('payday') }).sell).toBeCloseTo(modsOf(p).sell * 2);
    expect(modsOf({ ...p, event: live('gold') }).fortune).toBeCloseTo(modsOf(p).fortune + 2);
    expect(forestMods({ ...p, event: live('blizzard') }).storm).toBe(1);
    // Кончившееся событие не действует.
    expect(modsOf({ ...p, event: { ...live('payday'), until: 1 } }).sell).toBeCloseTo(
      modsOf(p).sell,
    );
  });

  it('награда растёт с рангом', () => {
    const rnd = lcg(1);
    for (const id of ['meteor', 'kuiva', 'convoy'] as const) {
      const lo = eventPrize(id, player(2), rnd);
      const hi = eventPrize(id, player(18), rnd);
      expect(hi.coins).toBeGreaterThan(lo.coins);
      expect(hi.tokens).toBeGreaterThan(lo.tokens);
    }
  });
});

describe('Барыга', () => {
  it('товар одинаков в одном окне и другой в следующем', () => {
    const p = player();
    expect(barygaLots(100, p)).toEqual(barygaLots(100, p));
    expect(JSON.stringify(barygaLots(101, p))).not.toEqual(JSON.stringify(barygaLots(100, p)));
  });

  it('четыре лота, один горячий, цены постоянные', () => {
    for (let w = 1; w < 60; w++) {
      const lots = barygaLots(w, player(8));
      expect(lots).toHaveLength(BARYGA_LOTS);
      expect(lots.filter((l) => l.hot)).toHaveLength(1);
      // Ранг игрока цену не двигает — тот же товар стоит так же на A и на Y.
      expect(barygaLots(w, player(20)).map((l) => l.price)).toEqual(lots.map((l) => l.price));
      for (const l of lots) {
        expect(l.stock).toBeGreaterThan(0);
        expect(l.price).toBeGreaterThanOrEqual(2_400);
        expect(l.price).toBeLessThanOrEqual(20_000);
        // Горячий — видимая скидка от прежней цены.
        if (l.hot) expect(l.price).toBeLessThan(l.was);
        else expect(l.price).toBe(l.was);
      }
    }
  });
});
