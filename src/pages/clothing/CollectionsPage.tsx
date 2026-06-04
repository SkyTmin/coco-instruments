import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Fab, Screen } from '@/components/ui';
import { CollectionTile } from '@/components/clothing-cards';
import { useFinanceStore } from '@/store';
import { pluralizeRu } from '@/lib/format';
import { selectionChanged, tapLight } from '@/lib/haptics';

export function CollectionsPage() {
  const navigate = useNavigate();
  const collections = useFinanceStore((s) => s.collections);
  const wardrobe = useFinanceStore((s) => s.wardrobe);
  const byId = useMemo(() => new Map(wardrobe.map((w) => [w.id, w])), [wardrobe]);

  return (
    <Screen
      title="Подборки"
      subtitle={
        collections.length
          ? `${collections.length} ${pluralizeRu(collections.length, ['подборка', 'подборки', 'подборок'])}`
          : 'Группы вещей по настроению'
      }
    >
      {collections.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="Пока нет подборок"
          sub="Например «Для работы», «Чёрное» или «Лето» — соберите туда любимые вещи"
        />
      ) : (
        <div className="collection-grid">
          {collections.map((c, i) => (
            <CollectionTile
              key={c.id}
              collection={c}
              byId={byId}
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
              onClick={() => {
                selectionChanged();
                navigate(`/clothing/collections/${c.id}`);
              }}
            />
          ))}
        </div>
      )}
      <Fab
        onClick={() => {
          tapLight();
          navigate('/clothing/collections/new');
        }}
      />
    </Screen>
  );
}
