import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, Screen, StatRow } from '@/components/ui';
import { IconCheck, IconPencil, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORY_EMOJI, CATEGORY_LABEL, SEASON_LABEL } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { formatRUB, pluralizeRu, relativeDay } from '@/lib/format';
import { notifySuccess, notifyWarning, tapLight } from '@/lib/haptics';

export function WardrobeItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const item = useFinanceStore((s) => (id ? s.getItem(id) : undefined));
  const outfits = useFinanceStore((s) => s.outfits);
  const removeItem = useFinanceStore((s) => s.removeItem);
  const logWear = useFinanceStore((s) => s.logWear);
  const [confirm, setConfirm] = useState(false);

  if (!item || !id) return <Navigate to="/clothing/wardrobe" replace />;

  const inOutfits = outfits.filter((o) => o.itemIds.includes(id));
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen title={item.name}>
      <div className="stack">
        {item.photo ? (
          <div className="item-photo">
            <img src={attachmentHref(item.photo)} alt="" />
          </div>
        ) : (
          <div className="item-photo item-photo--ph">{CATEGORY_EMOJI[item.category]}</div>
        )}

        <div className="card wear-card">
          <div className="wear-card__main">
            <div className="wear-card__count">
              {item.wears ?? 0} {pluralizeRu(item.wears ?? 0, ['раз', 'раза', 'раз'])}
            </div>
            <div className="wear-card__sub">
              {item.lastWornAt ? `Последний раз — ${relativeDay(item.lastWornAt)}` : 'Ещё не надевали'}
              {item.price && (item.wears ?? 0) > 0
                ? ` · ${formatRUB(Math.round(item.price / (item.wears ?? 1)))} за носку`
                : ''}
            </div>
          </div>
          <button
            className="btn btn--primary"
            onClick={() => {
              notifySuccess();
              logWear([id]);
            }}
          >
            <span className="row" style={{ gap: 6 }}>
              <IconCheck size={18} /> Надел
            </span>
          </button>
        </div>

        <div className="card">
          <StatRow label="Категория" value={`${CATEGORY_EMOJI[item.category]} ${CATEGORY_LABEL[item.category]}`} />
          {item.color && <StatRow label="Цвет" value={item.color} />}
          {item.season && <StatRow label="Сезон" value={SEASON_LABEL[item.season]} />}
          {item.brand && <StatRow label="Бренд" value={item.brand} />}
          {item.size && <StatRow label="Размер" value={item.size} />}
          {item.price ? <StatRow label="Цена" value={formatRUB(item.price)} /> : null}
          {item.note && <StatRow label="Заметка" value={item.note} />}
        </div>

        {inOutfits.length > 0 && (
          <div className="card">
            <div className="section-label" style={{ margin: '0 0 10px' }}>
              В образах
            </div>
            <div className="chips">
              {inOutfits.map((o) => (
                <button key={o.id} className="note-chip" onClick={() => go(`/clothing/outfits/${o.id}`)}>
                  {o.name}
                </button>
              ))}
            </div>
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
