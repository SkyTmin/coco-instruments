import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen, SwipeRow } from '@/components/ui';
import { IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { attachmentHref } from '@/lib/images';
import { WISH_STATUS_EMOJI, WISH_STATUS_LABEL } from '@/lib/clothing';
import { formatRUB, pluralizeRu } from '@/lib/format';
import { notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

export function WishlistPage() {
  const navigate = useNavigate();
  const wishlist = useFinanceStore((s) => s.wishlist);
  const outfits = useFinanceStore((s) => s.outfits);
  const removeWish = useFinanceStore((s) => s.removeWish);
  const outfitName = useMemo(() => new Map(outfits.map((o) => [o.id, o.name])), [outfits]);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen
      title="Список желаний"
      subtitle={
        wishlist.length
          ? `${wishlist.length} ${pluralizeRu(wishlist.length, ['вещь', 'вещи', 'вещей'])}`
          : 'Что хочется купить'
      }
    >
      {wishlist.length === 0 ? (
        <EmptyState icon="✨" title="Пока пусто" sub="Добавьте вещи, которые хотите купить" />
      ) : (
        <div className="stack">
          {wishlist.map((w) => (
            <SwipeRow
              key={w.id}
              onTap={() => {
                selectionChanged();
                navigate(`/clothing/wishlist/${w.id}/edit`);
              }}
              actions={[
                {
                  icon: <IconTrash size={20} />,
                  label: 'Удалить',
                  danger: true,
                  onClick: () => {
                    notifyWarning();
                    removeWish(w.id);
                  },
                },
              ]}
            >
              <div className="wish-row">
                {w.photo ? (
                  <img className="wish-row__thumb" src={attachmentHref(w.photo)} alt="" loading="lazy" />
                ) : (
                  <div className="wish-row__thumb wish-row__thumb--ph">✨</div>
                )}
                <div className="wish-row__main">
                  <div className="wish-row__name">{w.name}</div>
                  {(w.price || w.note) && (
                    <div className="wish-row__sub">
                      {w.price ? formatRUB(w.price) : ''}
                      {w.price && w.note ? ' · ' : ''}
                      {w.note ?? ''}
                    </div>
                  )}
                  <div className="wish-row__tags">
                    {w.status && w.status !== 'want' && (
                      <span className={`wish-badge wish-badge--${w.status}`}>
                        {WISH_STATUS_EMOJI[w.status]} {WISH_STATUS_LABEL[w.status]}
                      </span>
                    )}
                    {w.outfitId && outfitName.has(w.outfitId) && (
                      <span className="wish-badge wish-badge--outfit">🧥 {outfitName.get(w.outfitId)}</span>
                    )}
                  </div>
                </div>
                {w.link && (
                  <a
                    className="wish-row__link"
                    href={w.link}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </a>
                )}
              </div>
            </SwipeRow>
          ))}
        </div>
      )}
      <Fab onClick={() => go('/clothing/wishlist/new')} />
    </Screen>
  );
}
