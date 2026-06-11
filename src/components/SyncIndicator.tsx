import { useEffect, useState } from 'react';

import { useSyncStatus } from '@/lib/sync-status';
import { showToast } from '@/components/Toast';

// Small dot in the top-right corner: nothing when idle, a pulsing dot while a
// save is in flight for a noticeable time, red when retries keep failing.
export function SyncIndicator() {
  const state = useSyncStatus((s) => s.state);
  const pendingCount = useSyncStatus((s) => s.pendingCount);
  const [showSaving, setShowSaving] = useState(false);

  // Only surface "saving" if it lasts >800ms — normal saves are invisible.
  useEffect(() => {
    if (state !== 'saving') {
      setShowSaving(false);
      return;
    }
    const t = setTimeout(() => setShowSaving(true), 800);
    return () => clearTimeout(t);
  }, [state]);

  if (state === 'error') {
    return (
      <div
        className="sync-dot sync-dot--error"
        role="button"
        aria-label="Ошибка синхронизации"
        onClick={() =>
          showToast(
            `Нет связи с сервером — изменения (${pendingCount}) сохранены на устройстве и будут досланы автоматически.`,
            'error',
          )
        }
      />
    );
  }
  if (state === 'saving' && showSaving) {
    return <div className="sync-dot sync-dot--saving" aria-label="Сохранение…" />;
  }
  return null;
}
