import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Screen } from '@/components/ui';
import { IconCheck, IconSparkles } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORY_EMOJI, CATEGORY_LABEL, suggestOutfit } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { notifySuccess, tapLight } from '@/lib/haptics';

export function ShufflePage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const addOutfit = useFinanceStore((s) => s.addOutfit);
  const logWear = useFinanceStore((s) => s.logWear);
  const [combo, setCombo] = useState(() => suggestOutfit(wardrobe));
  const [spin, setSpin] = useState(0);

  if (wardrobe.length < 2) {
    return (
      <Screen title="Что надеть?">
        <EmptyState
          icon="🪄"
          title="Маловато вещей"
          sub="Добавьте несколько вещей в гардероб — и я соберу из них образ"
        />
      </Screen>
    );
  }

  const reshuffle = () => {
    tapLight();
    setCombo(suggestOutfit(wardrobe));
    setSpin((s) => s + 1);
  };

  const save = () => {
    const created = addOutfit({ name: 'Образ-сюрприз', itemIds: combo.map((i) => i.id) });
    notifySuccess();
    navigate(`/clothing/outfits/${created.id}`);
  };

  return (
    <Screen title="Что надеть?" subtitle="Случайный образ из ваших вещей">
      <div className="stack">
        <div key={spin} className="wardrobe-grid">
          {combo.map((it, i) => (
            <div
              key={it.id}
              className="wardrobe-card"
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => {
                tapLight();
                navigate(`/clothing/wardrobe/${it.id}`);
              }}
              role="button"
            >
              {it.photo ? (
                <img src={attachmentHref(it.photo)} alt="" loading="lazy" />
              ) : (
                <div className="wardrobe-card__ph">{CATEGORY_EMOJI[it.category]}</div>
              )}
              <div className="wardrobe-card__name">{it.name}</div>
              <div className="shuffle-slot">{CATEGORY_LABEL[it.category]}</div>
            </div>
          ))}
        </div>

        <button className="btn btn--primary btn--block" onClick={reshuffle}>
          <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <IconSparkles size={18} /> Ещё вариант
          </span>
        </button>
        <button className="btn btn--block" onClick={save}>
          Сохранить как образ
        </button>
        <button
          className="btn btn--block"
          onClick={() => {
            notifySuccess();
            logWear(combo.map((i) => i.id));
          }}
        >
          <span className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <IconCheck size={18} /> Надел это
          </span>
        </button>
      </div>
    </Screen>
  );
}
