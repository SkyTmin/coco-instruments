import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, SectionHeader, Skeleton } from '@/components/ui';
import { OutfitCarousel } from '@/components/OutfitCarousel';
import { CollectionTile } from '@/components/clothing-cards';
import { Photo } from '@/components/Photo';
import { IconChevron, IconHeart, IconPlus, IconRuler, IconSparkles } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { selectionChanged, tapLight } from '@/lib/haptics';

function Cta({ emoji, title, sub, onClick }: { emoji: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button className="cl-cta" onClick={onClick}>
      <span className="cl-cta__emoji">{emoji}</span>
      <span className="cl-cta__text">
        <b>{title}</b>
        <i>{sub}</i>
      </span>
      <IconPlus size={20} />
    </button>
  );
}

export function ClothingDashboardPage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const outfits = useFinanceStore((s) => s.outfits);
  const collections = useFinanceStore((s) => s.collections);
  const inspiration = useFinanceStore((s) => s.inspiration);
  const hydrated = useFinanceStore((s) => s.hydrated);
  const byId = useMemo(() => new Map(wardrobe.map((w) => [w.id, w])), [wardrobe]);
  const feed = useMemo(
    () => [...outfits].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite))).slice(0, 12),
    [outfits],
  );

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const open = (path: string) => {
    selectionChanged();
    navigate(path);
  };
  const all = (path: string): ReactNode => (
    <button className="link-all" onClick={() => go(path)}>
      Все ›
    </button>
  );

  if (!hydrated) {
    return (
      <Screen title="Одежда" subtitle="Ваш визуальный гардероб">
        <div className="stack">
          <Skeleton height={20} width="40%" radius={8} />
          <Skeleton height={320} radius={20} />
          <Skeleton height={20} width="40%" radius={8} />
          <Skeleton height={74} radius={16} />
        </div>
      </Screen>
    );
  }

  return (
    <Screen title="Одежда" subtitle="Ваш визуальный гардероб">
      <div className="stack clothing-dash">
        {/* Образы — главный объект */}
        <SectionHeader title="Образы" action={outfits.length ? all('/clothing/outfits') : undefined} />
        {outfits.length ? (
          <OutfitCarousel outfits={feed} />
        ) : (
          <Cta
            emoji="🧥"
            title="Образов пока нет"
            sub="Соберите первый образ из вещей гардероба"
            onClick={() => go('/clothing/compose')}
          />
        )}

        {/* Собрать образ — заметное действие */}
        <button className="compose-cta" onClick={() => go('/clothing/compose')}>
          <span className="compose-cta__icon">
            <IconSparkles />
          </span>
          <span className="compose-cta__text">
            <b>Собрать образ</b>
            <i>Примерочная из вещей гардероба</i>
          </span>
          <IconChevron size={20} />
        </button>

        {/* Гардероб */}
        <SectionHeader title="Гардероб" action={wardrobe.length ? all('/clothing/wardrobe') : undefined} />
        {wardrobe.length ? (
          <div className="wardrobe-strip">
            {wardrobe.slice(0, 16).map((it) => (
              <button
                key={it.id}
                className="wardrobe-strip__item"
                onClick={() => open(`/clothing/wardrobe/${it.id}`)}
                aria-label={it.name}
              >
                {it.photo ? (
                  <Photo src={attachmentHref(it.photo)} />
                ) : (
                  <span className="wardrobe-strip__ph">{CATEGORY_EMOJI[it.category]}</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <Cta
            emoji="👕"
            title="Добавьте вещи"
            sub="Сфотографируйте гардероб — по одной или пачкой"
            onClick={() => go('/clothing/wardrobe')}
          />
        )}

        {/* Подборки */}
        <SectionHeader title="Подборки" action={collections.length ? all('/clothing/collections') : undefined} />
        {collections.length ? (
          <div className="cl-hscroll">
            {collections.slice(0, 8).map((c) => (
              <CollectionTile
                key={c.id}
                collection={c}
                byId={byId}
                onClick={() => open(`/clothing/collections/${c.id}`)}
              />
            ))}
          </div>
        ) : (
          <Cta
            emoji="🗂"
            title="Создайте подборку"
            sub="«Для работы», «Чёрное», «Лето»…"
            onClick={() => go('/clothing/collections/new')}
          />
        )}

        {/* Вдохновение */}
        <SectionHeader title="Вдохновение" action={inspiration.length ? all('/clothing/inspiration') : undefined} />
        {inspiration.length ? (
          <div className="wardrobe-strip">
            {inspiration.slice(0, 16).map((img) => (
              <button
                key={img.id}
                className="wardrobe-strip__item"
                onClick={() => open('/clothing/inspiration')}
                aria-label="Вдохновение"
              >
                <Photo src={attachmentHref(img.photo)} />
              </button>
            ))}
          </div>
        ) : (
          <Cta
            emoji="✨"
            title="Доска вдохновения"
            sub="Скриншоты, фото и идеи образов"
            onClick={() => go('/clothing/inspiration')}
          />
        )}

        {/* Утилиты — в самом низу, без акцента */}
        <div className="cl-util">
          <button className="cl-util__btn" onClick={() => go('/clothing/sizes')}>
            <IconRuler size={20} />
            <span>Размеры</span>
          </button>
          <button className="cl-util__btn" onClick={() => go('/clothing/wishlist')}>
            <IconHeart size={20} />
            <span>Желания</span>
          </button>
        </div>
      </div>
    </Screen>
  );
}
