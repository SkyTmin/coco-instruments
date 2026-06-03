import { useNavigate } from 'react-router-dom';
import { Screen, SectionCard, Skeleton } from '@/components/ui';
import { IconHeart, IconImage, IconRuler, IconShirt } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { pluralizeRu } from '@/lib/format';
import { tapLight } from '@/lib/haptics';

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

  return (
    <Screen title="Одежда" subtitle="Гардероб и образы">
      <div className="stack">
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
