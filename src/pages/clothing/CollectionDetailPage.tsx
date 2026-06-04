import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, EmptyState, Screen, Sheet } from '@/components/ui';
import { IconPencil, IconPlus, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { WardrobeCard } from '@/components/clothing-cards';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import type { ClothingCategory, WardrobeItem } from '@/types';
import { notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

export function CollectionDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const collection = useFinanceStore((s) => (id ? s.getCollection(id) : undefined));
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const updateCollection = useFinanceStore((s) => s.updateCollection);
  const removeCollection = useFinanceStore((s) => s.removeCollection);
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<ClothingCategory | 'all'>('all');

  if (!collection || !id) return <Navigate to="/clothing/collections" replace />;

  const members = collection.itemIds
    .map((iid) => wardrobe.find((w) => w.id === iid))
    .filter((w): w is WardrobeItem => Boolean(w));
  const pickList = filter === 'all' ? wardrobe : wardrobe.filter((w) => w.category === filter);

  const toggle = (itemId: string) => {
    selectionChanged();
    const has = collection.itemIds.includes(itemId);
    updateCollection(id, {
      itemIds: has ? collection.itemIds.filter((x) => x !== itemId) : [...collection.itemIds, itemId],
    });
  };
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen title={`${collection.emoji ? collection.emoji + ' ' : ''}${collection.name}`}>
      <div className="stack">
        <div className="section-label" style={{ margin: '2px 2px' }}>
          Вещей · {members.length}
        </div>
        {members.length === 0 ? (
          <EmptyState icon="🗂" title="Подборка пуста" sub="Добавьте сюда вещи из гардероба" />
        ) : (
          <div className="wardrobe-grid">
            {members.map((it) => (
              <WardrobeCard key={it.id} item={it} onClick={() => go(`/clothing/wardrobe/${it.id}`)} />
            ))}
          </div>
        )}

        <button className="btn btn--block" onClick={() => { tapLight(); setPicking(true); }}>
          <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <IconPlus size={18} /> Добавить вещь
          </span>
        </button>

        <div className="row" style={{ gap: 12 }}>
          <button className="btn btn--block" style={{ flex: 1 }} onClick={() => go(`/clothing/collections/${id}/edit`)}>
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconPencil size={18} /> Изменить
            </span>
          </button>
          <button className="btn btn--danger" onClick={() => setConfirm(true)} aria-label="Удалить">
            <IconTrash size={18} />
          </button>
        </div>
      </div>

      {picking && (
        <Sheet title="Добавить вещь" onClose={() => setPicking(false)}>
          {wardrobe.length === 0 ? (
            <p className="muted" style={{ margin: '0 0 14px' }}>
              Гардероб пуст — сначала добавьте вещи.
            </p>
          ) : (
            <>
              <div className="chips" style={{ marginBottom: 12 }}>
                <button className={`chip${filter === 'all' ? ' is-active' : ''}`} onClick={() => setFilter('all')}>
                  Все
                </button>
                {CATEGORIES.filter((c) => wardrobe.some((w) => w.category === c.id)).map((c) => (
                  <button
                    key={c.id}
                    className={`chip${filter === c.id ? ' is-active' : ''}`}
                    onClick={() => setFilter(c.id)}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
              <div className="picker-grid">
                {pickList.map((it) => {
                  const on = collection.itemIds.includes(it.id);
                  return (
                    <button key={it.id} className={`picker-card${on ? ' is-on' : ''}`} onClick={() => toggle(it.id)}>
                      {it.photo ? (
                        <img src={attachmentHref(it.photo)} alt="" />
                      ) : (
                        <div className="picker-card__ph">{CATEGORY_EMOJI[it.category]}</div>
                      )}
                      <span>{it.name}</span>
                      {on && <i className="picker-card__check">✓</i>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button className="btn btn--primary btn--block" style={{ marginTop: 14 }} onClick={() => setPicking(false)}>
            Готово
          </button>
        </Sheet>
      )}

      {confirm && (
        <ConfirmDialog
          message={`Удалить подборку «${collection.name}»? Вещи останутся в гардеробе.`}
          onConfirm={() => {
            removeCollection(id);
            notifyWarning();
            navigate('/clothing/collections', { replace: true });
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </Screen>
  );
}
