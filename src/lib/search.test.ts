import { describe, expect, it } from 'vitest';

import type { SearchIndex } from '@/lib/search';
import { searchAll } from '@/lib/search';

const empty: SearchIndex = {
  notes: [],
  people: [],
  expenses: [],
  savings: [],
  recurring: [],
  transactions: [],
  incomeSources: [],
  wardrobe: [],
  outfits: [],
  wishlist: [],
};

const ts = { createdAt: 0, updatedAt: 0 };

describe('searchAll', () => {
  it('returns nothing for short queries', () => {
    expect(searchAll(empty, '')).toEqual([]);
    expect(searchAll(empty, 'a')).toEqual([]);
  });

  it('finds entities across different sections with deep links', () => {
    const index: SearchIndex = {
      ...empty,
      notes: [{ id: 'n1', title: 'Идеи для отпуска', body: 'Сочи', ...ts }],
      people: [
        {
          id: 'p1',
          name: 'Отдел кадров',
          category: 'work',
          closeness: 3,
          tags: [],
          favorite: false,
          ...ts,
        },
      ],
      incomeSources: [
        { id: 'i1', name: 'Отпускные', scheme: 'oneoff', startDate: '2026-07-01', ...ts },
      ],
    };
    const results = searchAll(index, 'от');
    const routes = results.map((r) => r.route);
    expect(routes).toContain('/notes/n1');
    expect(routes).toContain('/people/p1');
    expect(routes).toContain('/finance/income/i1');
  });

  it('ranks a title/prefix match above a body-only match', () => {
    const index: SearchIndex = {
      ...empty,
      notes: [
        { id: 'body', title: 'Список дел', body: 'купить кофе', ...ts },
        { id: 'title', title: 'Кофейни города', body: '', ...ts },
      ],
    };
    const results = searchAll(index, 'кофе');
    expect(results[0].route).toBe('/notes/title');
  });

  it('matches a transaction by its category label', () => {
    const index: SearchIndex = {
      ...empty,
      transactions: [
        {
          id: 't1',
          direction: 'expense',
          amount: 500,
          date: '2026-07-01',
          category: 'food',
          ...ts,
        },
      ],
    };
    const results = searchAll(index, 'проду');
    expect(results.map((r) => r.route)).toContain('/finance/transactions/t1/edit');
  });
});
