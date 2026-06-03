import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { useFinanceStore } from '@/store';
import { Photo } from '@/components/Photo';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

export function OutfitsPage() {
  const navigate = useNavigate();
  const outfits = useFinanceStore((s) => s.outfits);

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
        <EmptyState icon="🧍" title="Пока нет образов" sub="Соберите лук: фото себя + вещи из гардероба" />
      ) : (
        <div className="outfit-grid">
          {outfits.map((o, i) => (
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
              {o.cover ? (
                <Photo src={attachmentHref(o.cover)} />
              ) : (
                <div className="outfit-card__ph">🧥</div>
              )}
              <div className="outfit-card__overlay">
                <div className="outfit-card__name">{o.name}</div>
                <div className="outfit-card__count">
                  {o.itemIds.length} {pluralizeRu(o.itemIds.length, ['вещь', 'вещи', 'вещей'])}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Fab onClick={() => go('/clothing/outfits/new')} />
    </Screen>
  );
}
