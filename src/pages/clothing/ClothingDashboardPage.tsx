import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, Screen, Sheet, Skeleton } from '@/components/ui';
import { OutfitCarousel } from '@/components/OutfitCarousel';
import { CollectionTile } from '@/components/clothing-cards';
import { Photo } from '@/components/Photo';
import { IconChevron, IconHeart, IconPlus, IconRuler, IconSparkles } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { CATEGORY_EMOJI } from '@/lib/clothing';
import { attachmentHref } from '@/lib/images';
import { pluralizeRu } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

export function ClothingDashboardPage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const outfits = useFinanceStore((s) => s.outfits);
  const collections = useFinanceStore((s) => s.collections);
  const inspiration = useFinanceStore((s) => s.inspiration);
  const wishlist = useFinanceStore((s) => s.wishlist);
  const sizes = useFinanceStore((s) => s.sizes);
  const hydrated = useFinanceStore((s) => s.hydrated);

  const [quickAdd, setQuickAdd] = useState(false);

  const byId = useMemo(() => new Map(wardrobe.map((w) => [w.id, w])), [wardrobe]);
  const looks = useMemo(
    () =>
      [...outfits]
        .sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)))
        .slice(0, 12),
    [outfits],
  );
  const recentItems = useMemo(
    () => [...wardrobe].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 14),
    [wardrobe],
  );

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };
  const open = (path: string) => {
    selectionChanged();
    navigate(path);
  };

  if (!hydrated) {
    return (
      <Screen title="Гардероб" subtitle="Ваш цифровой гардероб">
        <div className="stack">
          <Skeleton height={300} radius={22} />
          <Skeleton height={82} radius={20} />
          <Skeleton height={120} radius={20} />
        </div>
      </Screen>
    );
  }

  const firstRun = wardrobe.length === 0 && outfits.length === 0;
  const composeReady = wardrobe.length > 0;

  return (
    <Screen
      title="Гардероб"
      subtitle={
        firstRun ? (
          'Ваш цифровой гардероб'
        ) : (
          <>
            <AnimatedNumber value={wardrobe.length} />{' '}
            {pluralizeRu(wardrobe.length, ['вещь', 'вещи', 'вещей'])} ·{' '}
            <AnimatedNumber value={outfits.length} />{' '}
            {pluralizeRu(outfits.length, ['образ', 'образа', 'образов'])}
          </>
        )
      }
      action={
        !firstRun ? (
          <button
            className="icon-btn"
            onClick={() => {
              tapLight();
              setQuickAdd(true);
            }}
            aria-label="Добавить"
          >
            <IconPlus size={22} />
          </button>
        ) : undefined
      }
    >
      {firstRun ? (
        <div className="cl-welcome">
          <div className="cl-welcome__icon">👗</div>
          <h2 className="cl-welcome__title">Ваш цифровой гардероб</h2>
          <p className="cl-welcome__sub">
            Сфотографируйте вещи, собирайте из них образы, храните идеи, размеры и желания — всё в
            одном месте.
          </p>
          <button
            className="btn btn--primary btn--block"
            onClick={() => go('/clothing/wardrobe/new')}
          >
            Добавить первую вещь
          </button>
          <div className="cl-welcome__feats">
            <div>
              <span>👕</span>Вещи
            </div>
            <div>
              <span>🧥</span>Образы
            </div>
            <div>
              <span>✨</span>Идеи
            </div>
          </div>
        </div>
      ) : (
        <div className="stack clothing-dash">
          {/* 1 — Образы: лукбук */}
          {outfits.length > 0 && (
            <section>
              <div className="cl-h">
                <span className="cl-h__title">Образы</span>
                <button className="link-all" onClick={() => go('/clothing/outfits')}>
                  Все {outfits.length} ›
                </button>
              </div>
              <OutfitCarousel outfits={looks} />
            </section>
          )}

          {/* 2 — Hero: собрать образ (или добавить готовый, если вещей ещё нет) */}
          <button
            className="cl-hero"
            onClick={() => go(composeReady ? '/clothing/compose' : '/clothing/outfits/new')}
          >
            <span className="cl-hero__icon">
              <IconSparkles />
            </span>
            <span className="cl-hero__text">
              <b>{composeReady ? 'Собрать образ' : 'Добавить образ'}</b>
              <i>
                {composeReady
                  ? 'Примерочная — выберите вещи и составьте лук'
                  : 'Сфотографируйте готовый лук — вещи добавите позже'}
              </i>
            </span>
            <span className="cl-hero__go">
              <IconChevron size={22} />
            </span>
          </button>

          {/* 3 — Вещи: вход в каталог + добавление */}
          <section>
            <div className="cl-h">
              <span className="cl-h__title">Вещи</span>
              {wardrobe.length > 0 && (
                <button className="link-all" onClick={() => go('/clothing/wardrobe')}>
                  Все {wardrobe.length} ›
                </button>
              )}
            </div>
            {wardrobe.length > 0 ? (
              <div className="wardrobe-strip">
                {recentItems.map((it) => (
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
                <button
                  className="wardrobe-strip__add"
                  onClick={() => go('/clothing/wardrobe/new')}
                  aria-label="Добавить вещь"
                >
                  <IconPlus size={22} />
                  <i>Добавить</i>
                </button>
              </div>
            ) : (
              <button className="cl-empty" onClick={() => go('/clothing/wardrobe/new')}>
                <span className="cl-empty__ic">👕</span>
                <span className="cl-empty__txt">
                  <b>Добавьте вещи</b>
                  <i>Сфотографируйте гардероб — по одной или пачкой</i>
                </span>
                <IconPlus size={20} />
              </button>
            )}
          </section>

          {/* 4 — Подборки */}
          {collections.length > 0 ? (
            <section>
              <div className="cl-h">
                <span className="cl-h__title">Подборки</span>
                <button className="link-all" onClick={() => go('/clothing/collections')}>
                  Все {collections.length} ›
                </button>
              </div>
              <div className="cl-hscroll">
                {collections.slice(0, 8).map((c) => (
                  <CollectionTile
                    key={c.id}
                    collection={c}
                    byId={byId}
                    onClick={() => open(`/clothing/collections/${c.id}`)}
                  />
                ))}
                <button
                  className="cl-add-tile"
                  onClick={() => go('/clothing/collections/new')}
                  aria-label="Новая подборка"
                >
                  <IconPlus size={24} />
                  <span>Новая</span>
                </button>
              </div>
            </section>
          ) : (
            wardrobe.length > 0 && (
              <button className="cl-empty" onClick={() => go('/clothing/collections/new')}>
                <span className="cl-empty__ic">🗂</span>
                <span className="cl-empty__txt">
                  <b>Соберите подборку</b>
                  <i>Сгруппируйте вещи: «Для работы», «Чёрное», «Лето»…</i>
                </span>
                <IconPlus size={20} />
              </button>
            )
          )}

          {/* 5 — Вдохновение: доска */}
          {inspiration.length > 0 ? (
            <button className="cl-board" onClick={() => go('/clothing/inspiration')}>
              <div className="cl-board__stack">
                {inspiration.slice(0, 4).map((img) => (
                  <span key={img.id} className="cl-board__ph">
                    <Photo src={attachmentHref(img.photo)} />
                  </span>
                ))}
              </div>
              <div className="cl-board__meta">
                <b>Доска вдохновения</b>
                <span>
                  {inspiration.length} {pluralizeRu(inspiration.length, ['идея', 'идеи', 'идей'])} ·
                  открыть
                </span>
              </div>
            </button>
          ) : (
            <button className="cl-empty" onClick={() => go('/clothing/inspiration')}>
              <span className="cl-empty__ic">✨</span>
              <span className="cl-empty__txt">
                <b>Доска вдохновения</b>
                <i>Скриншоты, референсы и идеи образов</i>
              </span>
              <IconPlus size={20} />
            </button>
          )}

          {/* 6 — Utility */}
          <div className="cl-util">
            <button className="cl-util__card" onClick={() => go('/clothing/sizes')}>
              <IconRuler size={20} />
              <span className="cl-util__name">Размеры</span>
              <span className="cl-util__count">
                {sizes.length ? <AnimatedNumber value={sizes.length} /> : '—'}
              </span>
            </button>
            <button className="cl-util__card" onClick={() => go('/clothing/wishlist')}>
              <IconHeart size={20} />
              <span className="cl-util__name">Желания</span>
              <span className="cl-util__count">
                {wishlist.length ? <AnimatedNumber value={wishlist.length} /> : '—'}
              </span>
            </button>
          </div>
        </div>
      )}

      {quickAdd && (
        <Sheet title="Что добавить?" onClose={() => setQuickAdd(false)}>
          <div className="chat-actions">
            <button
              onClick={() => {
                setQuickAdd(false);
                go('/clothing/wardrobe/new');
              }}
            >
              <span className="chat-actions__ic">👕</span> Вещь
            </button>
            <button
              onClick={() => {
                setQuickAdd(false);
                go('/clothing/compose');
              }}
            >
              <span className="chat-actions__ic">🧥</span> Собрать образ
            </button>
            <button
              onClick={() => {
                setQuickAdd(false);
                go('/clothing/collections/new');
              }}
            >
              <span className="chat-actions__ic">🗂</span> Подборку
            </button>
            <button
              onClick={() => {
                setQuickAdd(false);
                go('/clothing/inspiration');
              }}
            >
              <span className="chat-actions__ic">✨</span> Вдохновение
            </button>
            <button
              onClick={() => {
                setQuickAdd(false);
                go('/clothing/wishlist/new');
              }}
            >
              <span className="chat-actions__ic">♡</span> Желание
            </button>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
