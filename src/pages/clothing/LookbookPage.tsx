import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen, Sheet } from '@/components/ui';
import { OutfitCarousel } from '@/components/OutfitCarousel';
import { useFinanceStore } from '@/store';
import { IconImage, IconList, IconSparkles } from '@/components/icons';
import { pluralizeRu } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

/** "Образы" as a swipeable lookbook (the home-screen entry) — flip through
 *  outfits like in Гардероб, instead of the grid. */
export function LookbookPage() {
  const navigate = useNavigate();
  const outfits = useFinanceStore((s) => s.outfits);
  const [adding, setAdding] = useState(false);

  // Favourites float to the front of the carousel.
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
          ? `${outfits.length} ${pluralizeRu(outfits.length, ['образ', 'образа', 'образов'])} · листайте`
          : 'Готовые луки'
      }
      action={
        outfits.length > 0 ? (
          <button
            className="icon-btn"
            onClick={() => go('/clothing/outfits')}
            aria-label="Показать списком"
          >
            <IconList size={20} />
          </button>
        ) : undefined
      }
    >
      {outfits.length === 0 ? (
        <>
          <EmptyState
            icon="🧍"
            title="Образов пока нет"
            sub="Соберите первый образ из вещей гардероба"
          />
          <button className="btn btn--primary btn--block" onClick={() => go('/clothing/compose')}>
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconSparkles size={18} /> Собрать образ
            </span>
          </button>
          <button
            className="btn btn--block"
            style={{ marginTop: 10 }}
            onClick={() => go('/clothing/outfits/new')}
          >
            Загрузить фото образа
          </button>
        </>
      ) : (
        <div className="lookbook">
          <OutfitCarousel outfits={sorted} />
          <p className="lookbook__hint">Смахивайте, чтобы листать образы. Тап — открыть.</p>
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
