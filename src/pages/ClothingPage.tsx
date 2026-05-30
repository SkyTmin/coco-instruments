import { EmptyState, Screen } from '@/components/ui';

export function ClothingPage() {
  return (
    <Screen title="Одежда">
      <EmptyState
        icon="🧥"
        title="Раздел в разработке"
        sub="Скоро здесь появятся размеры одежды и ваш гардероб"
      />
    </Screen>
  );
}
