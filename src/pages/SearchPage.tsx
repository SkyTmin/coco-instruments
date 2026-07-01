import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Screen } from '@/components/ui';
import { IconSearch } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { searchAll, type SearchIndex } from '@/lib/search';
import { tapLight } from '@/lib/haptics';

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const index = useFinanceStore(
    (s): SearchIndex => ({
      notes: s.notes,
      people: s.people,
      expenses: s.expenses,
      savings: s.savings,
      recurring: s.recurring,
      transactions: s.transactions,
      incomeSources: s.incomeSources,
      wardrobe: s.wardrobe,
      outfits: s.outfits,
      wishlist: s.wishlist,
    }),
  );

  const results = useMemo(() => searchAll(index, query), [index, query]);
  const trimmed = query.trim();

  const open = (route: string) => {
    tapLight();
    navigate(route);
  };

  return (
    <Screen title="Поиск" subtitle="По всему приложению">
      <div className="search-bar">
        <IconSearch size={18} className="search-bar__icon" />
        <input
          className="input search-bar__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Заметки, люди, деньги, гардероб…"
          autoFocus
        />
      </div>

      {trimmed.length < 2 ? (
        <EmptyState
          icon="🔎"
          title="Ищите что угодно"
          sub="Заметки, люди, платежи, доходы, вещи — всё в одном месте"
        />
      ) : results.length === 0 ? (
        <EmptyState icon="🤷" title="Ничего не найдено" sub={`По запросу «${trimmed}» пусто`} />
      ) : (
        <div className="stack" style={{ marginTop: 4 }}>
          {results.map((r) => (
            <button
              key={`${r.kind}-${r.route}`}
              className="search-hit"
              onClick={() => open(r.route)}
            >
              <span className="search-hit__emoji">{r.emoji}</span>
              <span className="search-hit__body">
                <span className="search-hit__title">{r.title}</span>
                {r.subtitle && <span className="search-hit__sub">{r.subtitle}</span>}
              </span>
              <span className="search-hit__group">{r.group}</span>
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}
