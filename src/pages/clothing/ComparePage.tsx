import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState, Screen, Sheet } from '@/components/ui';
import { Photo } from '@/components/Photo';
import { IconSwap } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import type { Outfit, WardrobeItem } from '@/types';
import { selectionChanged, tapLight } from '@/lib/haptics';

/** Side-by-side look comparison. No winners, no scoring — just two looks at once. */
export function ComparePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const outfits = useFinanceStore((s) => s.outfits);
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const byId = useMemo(() => new Map(wardrobe.map((w) => [w.id, w])), [wardrobe]);

  const initialA = params.get('a');
  const initialB = params.get('b');
  const [a, setA] = useState<string | null>(
    initialA && outfits.some((o) => o.id === initialA) ? initialA : null,
  );
  const [b, setB] = useState<string | null>(
    initialB && outfits.some((o) => o.id === initialB) ? initialB : null,
  );
  const [pick, setPick] = useState<'a' | 'b' | null>(null);

  const outfitA = a ? outfits.find((o) => o.id === a) : undefined;
  const outfitB = b ? outfits.find((o) => o.id === b) : undefined;

  const choose = (id: string) => {
    selectionChanged();
    if (pick === 'a') setA(id);
    else if (pick === 'b') setB(id);
    setPick(null);
  };
  const swap = () => {
    tapLight();
    setA(b);
    setB(a);
  };

  if (outfits.length < 2) {
    return (
      <Screen title="Сравнить образы">
        <EmptyState
          icon="⇆"
          title="Нужно минимум два образа"
          sub="Соберите ещё образы, чтобы сравнивать их рядом"
        />
      </Screen>
    );
  }

  return (
    <Screen title="Сравнить образы" subtitle="Два образа рядом — выбор за вами">
      <div className="compare-grid">
        <CompareColumn
          outfit={outfitA}
          byId={byId}
          onPick={() => {
            tapLight();
            setPick('a');
          }}
          navigate={navigate}
        />
        <CompareColumn
          outfit={outfitB}
          byId={byId}
          onPick={() => {
            tapLight();
            setPick('b');
          }}
          navigate={navigate}
        />
      </div>

      {a && b && (
        <button className="compare-swap" onClick={swap}>
          <IconSwap size={16} /> Поменять местами
        </button>
      )}

      {pick && (
        <Sheet title="Выберите образ" onClose={() => setPick(null)}>
          <div className="picker-grid">
            {outfits.map((o) => {
              const taken = (pick === 'a' && o.id === b) || (pick === 'b' && o.id === a);
              return (
                <button
                  key={o.id}
                  className="picker-card"
                  disabled={taken}
                  style={taken ? { opacity: 0.4 } : undefined}
                  onClick={() => choose(o.id)}
                >
                  {o.cover ? (
                    <img src={attachmentHref(o.cover)} alt="" />
                  ) : (
                    <div className="picker-card__ph">🧥</div>
                  )}
                  <span>{o.name}</span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </Screen>
  );
}

function CompareColumn({
  outfit,
  byId,
  onPick,
  navigate,
}: {
  outfit: Outfit | undefined;
  byId: Map<string, WardrobeItem>;
  onPick: () => void;
  navigate: (path: string) => void;
}) {
  if (!outfit) {
    return (
      <button className="compare-col compare-col--empty" onClick={onPick}>
        <span className="compare-col__plus">+</span>
        <span>Выбрать образ</span>
      </button>
    );
  }
  const members = outfit.itemIds
    .map((id) => byId.get(id))
    .filter((w): w is WardrobeItem => Boolean(w));
  return (
    <div className="compare-col">
      <button className="compare-col__cover" onClick={onPick} aria-label="Сменить образ">
        {outfit.cover ? (
          <Photo src={attachmentHref(outfit.cover)} />
        ) : (
          <div className="compare-col__ph">🧥</div>
        )}
        {outfit.favorite && (
          <span className="outfit-card__fav" aria-hidden>
            ♥
          </span>
        )}
      </button>
      <div className="compare-col__name">{outfit.name}</div>
      <div className="compare-col__count">
        {outfit.itemIds.length
          ? `${outfit.itemIds.length} ${pluralizeRu(outfit.itemIds.length, ['вещь', 'вещи', 'вещей'])}`
          : 'фото-образ'}
      </div>
      {outfit.note && <div className="compare-col__note">{outfit.note}</div>}
      {members.length > 0 && (
        <div className="compare-col__items">
          {members.map((it) => (
            <button
              key={it.id}
              className="compare-thumb"
              onClick={() => navigate(`/clothing/wardrobe/${it.id}`)}
              aria-label={it.name}
            >
              {it.photo ? (
                <Photo src={attachmentHref(it.photo)} />
              ) : (
                <span className="compare-thumb__ph">{CATEGORY_EMOJI[it.category]}</span>
              )}
            </button>
          ))}
        </div>
      )}
      <button
        className="compare-col__open"
        onClick={() => navigate(`/clothing/outfits/${outfit.id}`)}
      >
        Открыть
      </button>
    </div>
  );
}
