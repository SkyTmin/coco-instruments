import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { IconImage } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { WardrobeCard } from '@/components/clothing-cards';
import { CATEGORIES } from '@/lib/clothing';
import { fileToAttachment } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import type { ClothingCategory } from '@/types';
import { notifySuccess, selectionChanged, tapLight } from '@/lib/haptics';

type Filter = ClothingCategory | 'all' | 'fav';

export function WardrobePage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const addItem = useFinanceStore((s) => s.addItem);
  const fitting = useFinanceStore((s) => s.fitting);
  const toggleFitting = useFinanceStore((s) => s.toggleFitting);
  const [filter, setFilter] = useState<Filter>('all');
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const bulkRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    const m: Partial<Record<ClothingCategory, number>> = {};
    for (const it of wardrobe) m[it.category] = (m[it.category] ?? 0) + 1;
    return m;
  }, [wardrobe]);
  const favCount = useMemo(() => wardrobe.filter((it) => it.favorite).length, [wardrobe]);
  const items = useMemo(() => {
    if (filter === 'all') return wardrobe;
    if (filter === 'fav') return wardrobe.filter((it) => it.favorite);
    return wardrobe.filter((it) => it.category === filter);
  }, [wardrobe, filter]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  const bulkAdd = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files).slice(0, 40);
    setBulk({ done: 0, total: arr.length });
    let n = 0;
    for (const file of arr) {
      try {
        const photo = await fileToAttachment(file);
        addItem({ name: 'Новая вещь', category: 'other', photo });
      } catch {
        /* skip a file that failed */
      }
      n += 1;
      setBulk({ done: n, total: arr.length });
    }
    setBulk(null);
    notifySuccess();
  };

  return (
    <Screen
      title="Гардероб"
      subtitle={
        wardrobe.length
          ? `${wardrobe.length} ${pluralizeRu(wardrobe.length, ['вещь', 'вещи', 'вещей'])}`
          : 'Ваши вещи'
      }
      action={
        <button className="icon-round" onClick={() => bulkRef.current?.click()} aria-label="Загрузить несколько фото">
          <IconImage size={20} />
        </button>
      }
    >
      <input
        ref={bulkRef}
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          void bulkAdd(e.target.files);
          e.target.value = '';
        }}
      />

      {wardrobe.length === 0 ? (
        <>
          <EmptyState
            icon="👕"
            title="Вещей пока нет"
            sub="Добавьте первую вещь, чтобы начать собирать образы"
          />
          <button className="btn btn--primary btn--block" onClick={() => bulkRef.current?.click()}>
            Загрузить несколько фото
          </button>
        </>
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
            {favCount > 0 && (
              <button
                className={`chip${filter === 'fav' ? ' is-active' : ''}`}
                onClick={() => {
                  selectionChanged();
                  setFilter('fav');
                }}
              >
                ♥ Избранное · {favCount}
              </button>
            )}
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

          <div className="wardrobe-grid" style={{ paddingBottom: fitting.length ? 64 : 0 }}>
            {items.map((it, i) => (
              <WardrobeCard
                key={it.id}
                item={it}
                style={{ animationDelay: `${Math.min(i, 16) * 24}ms` }}
                inFitting={fitting.includes(it.id)}
                onToggleFitting={() => {
                  selectionChanged();
                  toggleFitting(it.id);
                }}
                onClick={() => {
                  selectionChanged();
                  navigate(`/clothing/wardrobe/${it.id}`);
                }}
              />
            ))}
            {items.length === 0 && (
              <p className="muted" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 16 }}>
                Ничего не найдено
              </p>
            )}
          </div>
        </>
      )}

      <Fab onClick={() => go('/clothing/wardrobe/new')} />

      {fitting.length > 0 && (
        <button className="fitting-bar" onClick={() => go('/clothing/compose')}>
          <span className="fitting-bar__icon">🪞</span>
          <span className="fitting-bar__text">
            В примерочной: {fitting.length} {pluralizeRu(fitting.length, ['вещь', 'вещи', 'вещей'])}
          </span>
          <span className="fitting-bar__cta">Собрать ›</span>
        </button>
      )}

      {bulk && (
        <div className="bulk-overlay">
          <div className="bulk-overlay__card">
            <div className="bulk-overlay__spin" />
            Загрузка фото… {bulk.done}/{bulk.total}
          </div>
        </div>
      )}
    </Screen>
  );
}
