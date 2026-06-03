import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog, EmptyState, Screen, Sheet } from '@/components/ui';
import { IconCheck, IconPencil, IconPlus, IconSparkles, IconTrash } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { Photo } from '@/components/Photo';
import { WardrobeCard } from '@/components/clothing-cards';
import { CATEGORIES, CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import type { ClothingCategory, WardrobeItem } from '@/types';
import { notifySuccess, notifyWarning, selectionChanged, tapLight } from '@/lib/haptics';

export function OutfitDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const outfit = useFinanceStore((s) => (id ? s.getOutfit(id) : undefined));
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const updateOutfit = useFinanceStore((s) => s.updateOutfit);
  const removeOutfit = useFinanceStore((s) => s.removeOutfit);
  const logWear = useFinanceStore((s) => s.logWear);
  const [confirm, setConfirm] = useState(false);
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<ClothingCategory | 'all'>('all');

  if (!outfit || !id) return <Navigate to="/clothing/outfits" replace />;

  const members = outfit.itemIds
    .map((iid) => wardrobe.find((w) => w.id === iid))
    .filter((w): w is WardrobeItem => Boolean(w));
  const pickList = filter === 'all' ? wardrobe : wardrobe.filter((w) => w.category === filter);

  const toggle = (itemId: string) => {
    selectionChanged();
    const has = outfit.itemIds.includes(itemId);
    updateOutfit(id, {
      itemIds: has ? outfit.itemIds.filter((x) => x !== itemId) : [...outfit.itemIds, itemId],
    });
  };
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen title={outfit.name}>
      <div className="stack">
        {outfit.cover && (
          <div className="item-photo">
            <Photo src={attachmentHref(outfit.cover)} contain />
          </div>
        )}

        <div className="section-label" style={{ margin: '4px 2px' }}>
          Вещи в образе · {members.length}
        </div>
        {members.length === 0 ? (
          <EmptyState
            icon="👚"
            title="Вещей пока нет"
            sub="Нажмите «Добавить вещь», чтобы привязать вещи из гардероба"
          />
        ) : (
          <div className="wardrobe-grid">
            {members.map((it) => (
              <WardrobeCard key={it.id} item={it} onClick={() => go(`/clothing/wardrobe/${it.id}`)} />
            ))}
          </div>
        )}

        <button className="btn btn--primary btn--block" onClick={() => go(`/clothing/outfits/${id}/build`)}>
          <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <IconSparkles size={18} /> Собрать коллаж
          </span>
        </button>

        <button
          className="btn btn--block"
          onClick={() => {
            tapLight();
            setPicking(true);
          }}
        >
          <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <IconPlus size={18} /> Добавить вещь
          </span>
        </button>

        {members.length > 0 && (
          <button
            className="btn btn--block"
            onClick={() => {
              notifySuccess();
              logWear(outfit.itemIds);
            }}
          >
            <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <IconCheck size={18} /> Надел сегодня
            </span>
          </button>
        )}

        <div className="row" style={{ gap: 12 }}>
          <button className="btn btn--block" style={{ flex: 1 }} onClick={() => go(`/clothing/outfits/${id}/edit`)}>
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
                  const on = outfit.itemIds.includes(it.id);
                  return (
                    <button key={it.id} className={`picker-card${on ? ' is-on' : ''}`} onClick={() => toggle(it.id)}>
                      {it.photo ? (
                        <img src={attachmentHref(it.photo)} alt="" />
                      ) : (
                        <div className="wardrobe-card__ph">{CATEGORY_EMOJI[it.category]}</div>
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
          message={`Удалить образ «${outfit.name}»? Вещи останутся в гардеробе.`}
          onConfirm={() => {
            removeOutfit(id);
            notifyWarning();
            navigate('/clothing/outfits', { replace: true });
          }}
          onClose={() => setConfirm(false)}
        />
      )}
    </Screen>
  );
}
