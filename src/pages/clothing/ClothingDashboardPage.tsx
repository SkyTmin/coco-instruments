import { useNavigate } from 'react-router-dom';
import { Screen, SectionCard, Skeleton } from '@/components/ui';
import { IconChart, IconHeart, IconImage, IconRuler, IconShirt, IconSparkles } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { attachmentHref } from '@/lib/images';
import { CATEGORY_EMOJI } from '@/lib/clothing';
import { pluralizeRu } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

export function ClothingDashboardPage() {
  const navigate = useNavigate();
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const outfits = useFinanceStore((s) => s.outfits);
  const wishlist = useFinanceStore((s) => s.wishlist);
  const sizes = useFinanceStore((s) => s.sizes);
  const hydrated = useFinanceStore((s) => s.hydrated);

  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  if (!hydrated) {
    return (
      <Screen title="Одежда" subtitle="Гардероб и образы">
        <div className="stack">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} radius={18} />
          ))}
        </div>
      </Screen>
    );
  }

  const recent = wardrobe.slice(0, 12);

  return (
    <Screen title="Одежда" subtitle="Гардероб и образы">
      <div className="stack">
        {wardrobe.length >= 2 && (
          <button className="shuffle-hero" onClick={() => go('/clothing/shuffle')}>
            <div className="shuffle-hero__icon">
              <IconSparkles />
            </div>
            <div className="shuffle-hero__body">
              <div className="shuffle-hero__title">Что надеть?</div>
              <div className="shuffle-hero__sub">Соберу случайный образ из ваших вещей</div>
            </div>
          </button>
        )}

        {recent.length > 0 && (
          <div className="wardrobe-strip">
            {recent.map((it) => (
              <button
                key={it.id}
                className="wardrobe-strip__item"
                onClick={() => {
                  selectionChanged();
                  navigate(`/clothing/wardrobe/${it.id}`);
                }}
                aria-label={it.name}
              >
                {it.photo ? (
                  <img src={attachmentHref(it.photo)} alt="" loading="lazy" />
                ) : (
                  <span className="wardrobe-strip__ph">{CATEGORY_EMOJI[it.category]}</span>
                )}
              </button>
            ))}
          </div>
        )}

        <SectionCard
          icon={<IconShirt />}
          title="Гардероб"
          sub={
            wardrobe.length
              ? `${wardrobe.length} ${pluralizeRu(wardrobe.length, ['вещь', 'вещи', 'вещей'])}`
              : 'Сфотографируйте свои вещи'
          }
          onClick={() => go('/clothing/wardrobe')}
        />
        <SectionCard
          icon={<IconImage />}
          title="Образы"
          sub={
            outfits.length
              ? `${outfits.length} ${pluralizeRu(outfits.length, ['образ', 'образа', 'образов'])}`
              : 'Соберите готовые луки'
          }
          onClick={() => go('/clothing/outfits')}
        />
        {wardrobe.length > 0 && (
          <SectionCard
            icon={<IconChart />}
            title="Аналитика"
            sub="Состав, носки и цена за носку"
            onClick={() => go('/clothing/insights')}
          />
        )}
        <SectionCard
          icon={<IconRuler />}
          title="Размеры"
          sub={
            sizes.length
              ? `${sizes.length} ${pluralizeRu(sizes.length, ['запись', 'записи', 'записей'])} · калькулятор`
              : 'Запись и калькулятор'
          }
          onClick={() => go('/clothing/sizes')}
        />
        <SectionCard
          icon={<IconHeart />}
          title="Список желаний"
          sub={
            wishlist.length
              ? `${wishlist.length} ${pluralizeRu(wishlist.length, ['вещь', 'вещи', 'вещей'])}`
              : 'Что хочется купить'
          }
          onClick={() => go('/clothing/wishlist')}
        />
      </div>
    </Screen>
  );
}
