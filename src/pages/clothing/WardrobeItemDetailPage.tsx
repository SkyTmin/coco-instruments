import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen, StatRow } from '@/components/ui';
import { IconPencil, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { Photo } from '@/components/Photo';
import { CATEGORY_EMOJI, CATEGORY_LABEL, SEASON_LABEL } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { notifyWarning, tapLight } from '@/lib/haptics';

export function WardrobeItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const item = useFinanceStore((s) => (id ? s.getItem(id) : undefined));
  const outfits = useFinanceStore((s) => s.outfits);
  const collections = useFinanceStore((s) => s.collections);
  const removeItem = useFinanceStore((s) => s.removeItem);
  const [confirm, setConfirm] = useState(false);

  if (!item || !id) return <Navigate to="/clothing/wardrobe" replace />;

  const inOutfits = outfits.filter((o) => o.itemIds.includes(id));
  const inCollections = collections.filter((c) => c.itemIds.includes(id));
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  const hasDetails = item.color || item.season || item.brand || item.size || item.note;

  return (
    <Screen title={item.name}>
      <div className="stack">
        {item.photo ? (
          <div className="item-photo">
            <Photo src={attachmentHref(item.photo)} contain />
          </div>
        ) : (
          <div className="item-photo item-photo--ph">{CATEGORY_EMOJI[item.category]}</div>
        )}

        <div className="card">
          <StatRow label="Категория" value={`${CATEGORY_EMOJI[item.category]} ${CATEGORY_LABEL[item.category]}`} />
          {item.color && <StatRow label="Цвет" value={item.color} />}
          {item.season && <StatRow label="Сезон" value={SEASON_LABEL[item.season]} />}
          {item.brand && <StatRow label="Бренд" value={item.brand} />}
          {item.size && <StatRow label="Размер" value={item.size} />}
          {item.note && <StatRow label="Заметка" value={item.note} />}
          {!hasDetails && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Без деталей — только фото и название.
            </p>
          )}
        </div>

        {(inOutfits.length > 0 || inCollections.length > 0) && (
          <div className="card">
            {inOutfits.length > 0 && (
              <>
                <div className="section-label" style={{ margin: '0 0 10px' }}>
                  В образах
                </div>
                <div className="chips" style={{ marginBottom: inCollections.length ? 14 : 0 }}>
                  {inOutfits.map((o) => (
                    <button key={o.id} className="note-chip" onClick={() => go(`/clothing/outfits/${o.id}`)}>
                      {o.name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {inCollections.length > 0 && (
              <>
                <div className="section-label" style={{ margin: '0 0 10px' }}>
                  В подборках
                </div>
                <div className="chips">
                  {inCollections.map((c) => (
                    <button key={c.id} className="note-chip" onClick={() => go(`/clothing/collections/${c.id}`)}>
                      {c.emoji ? `${c.emoji} ` : ''}
                      {c.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="row" style={{ gap: 12, marginTop: 8 }}>
          <button className="btn btn--block" style={{ flex: 1 }} onClick={() => go(`/clothing/wardrobe/${id}/edit`)}>
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconPencil size={18} /> Изменить
            </span>
          </button>
          <button className="btn btn--danger" onClick={() => setConfirm(true)} aria-label="Удалить">
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      {confirm && (
        <ConfirmDialog
          message={`Удалить «${item.name}»?`}
          onConfirm={() => {
            removeItem(id);
            notifyWarning();
            navigate('/clothing/wardrobe', { replace: true });
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </Screen>
  );
}
