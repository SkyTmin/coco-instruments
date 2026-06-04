import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen, Sheet } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { Photo } from '@/components/Photo';
import { IconImage, IconSparkles } from '@/components/icons';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

export function OutfitsPage() {
  const navigate = useNavigate();
  const outfits = useFinanceStore((s) => s.outfits);
  const [adding, setAdding] = useState(false);

  // Favourites float to the top.
  const sorted = useMemo(
    () => [...outfits].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))),
    [outfits],
  );

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen
      title="Образы"
      subtitle={
        outfits.length
          ? `${outfits.length} ${pluralizeRu(outfits.length, ['образ', 'образа', 'образов'])}`
          : 'Готовые луки'
      }
    >
      {outfits.length === 0 ? (
        <>
          <EmptyState icon="🧍" title="Образов пока нет" sub="Соберите первый образ из вещей гардероба" />
          <button className="btn btn--primary btn--block" onClick={() => go('/clothing/compose')}>
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconSparkles size={18} /> Собрать образ
            </span>
          </button>
          <button className="btn btn--block" style={{ marginTop: 10 }} onClick={() => go('/clothing/outfits/new')}>
            Загрузить фото образа
          </button>
        </>
      ) : (
        <div className="outfit-grid">
          {sorted.map((o, i) => (
            <div
              key={o.id}
              className="outfit-card"
              style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
              onClick={() => {
                selectionChanged();
                navigate(`/clothing/outfits/${o.id}`);
              }}
              role="button"
            >
              {o.cover ? <Photo src={attachmentHref(o.cover)} /> : <div className="outfit-card__ph">🧥</div>}
              {o.favorite && <span className="outfit-card__fav" aria-hidden>♥</span>}
              <div className="outfit-card__overlay">
                <div className="outfit-card__name">{o.name}</div>
                <div className="outfit-card__count">
                  {o.itemIds.length
                    ? `${o.itemIds.length} ${pluralizeRu(o.itemIds.length, ['вещь', 'вещи', 'вещей'])}`
                    : 'фото-образ'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {outfits.length > 0 && (
        <Fab
          onClick={() => {
            tapLight();
            setAdding(true);
          }}
        />
      )}

      {adding && (
        <Sheet title="Новый образ" onClose={() => setAdding(false)}>
          <div className="stack">
            <button className="btn btn--primary btn--block" onClick={() => go('/clothing/compose')}>
              <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
                <IconSparkles size={18} /> Собрать из вещей
              </span>
            </button>
            <button className="btn btn--block" onClick={() => go('/clothing/outfits/new')}>
              <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
                <IconImage size={18} /> Загрузить фото образа
              </span>
            </button>
            <button className="btn btn--ghost btn--block" onClick={() => setAdding(false)}>
              Отмена
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
