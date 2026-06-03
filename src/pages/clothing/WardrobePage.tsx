import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import type { ClothingCategory } from '@/types';
import { selectionChanged, tapLight } from '@/lib/haptics';

export function WardrobePage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const [filter, setFilter] = useState<ClothingCategory | 'all'>('all');

  const counts = useMemo(() => {
    const m: Partial<Record<ClothingCategory, number>> = {};
    for (const it of wardrobe) m[it.category] = (m[it.category] ?? 0) + 1;
    return m;
  }, [wardrobe]);
  const items = useMemo(
    () => (filter === 'all' ? wardrobe : wardrobe.filter((it) => it.category === filter)),
    [wardrobe, filter],
  );

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen
      title="Гардероб"
      subtitle={
        wardrobe.length
          ? `${wardrobe.length} ${pluralizeRu(wardrobe.length, ['вещь', 'вещи', 'вещей'])}`
          : 'Ваши вещи'
      }
    >
      {wardrobe.length === 0 ? (
        <EmptyState
          icon="👕"
          title="Гардероб пуст"
          sub="Сфотографируйте вещи по кнопке + — и всегда будете помнить, что у вас есть"
        />
      ) : (
        <>
          <div className="chips wardrobe-filter">
            <button
              className={`chip${filter === 'all' ? ' is-active' : ''}`}
              onClick={() => {
                selectionChanged();
                setFilter('all');
              }}
            >
              Все · {wardrobe.length}
            </button>
            {CATEGORIES.filter((c) => counts[c.id]).map((c) => (
              <button
                key={c.id}
                className={`chip${filter === c.id ? ' is-active' : ''}`}
                onClick={() => {
                  selectionChanged();
                  setFilter(c.id);
                }}
              >
                {c.emoji} {c.label} · {counts[c.id]}
              </button>
            ))}
          </div>

          <div className="wardrobe-grid">
            {items.map((it, i) => (
              <div
                key={it.id}
                className="wardrobe-card"
                style={{ animationDelay: `${Math.min(i, 16) * 24}ms` }}
                onClick={() => {
                  selectionChanged();
                  navigate(`/clothing/wardrobe/${it.id}`);
                }}
                role="button"
              >
                {it.photo ? (
                  <img src={attachmentHref(it.photo)} alt="" loading="lazy" />
                ) : (
                  <div className="wardrobe-card__ph">{CATEGORY_EMOJI[it.category]}</div>
                )}
                <div className="wardrobe-card__name">{it.name}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <Fab onClick={() => go('/clothing/wardrobe/new')} />
    </Screen>
  );
}
