import { getServerAuth } from '@/lib/storage';

/** Диагностика бэкапа — сервер отдаёт её только владельцу. */
export interface BackupStatus {
  owner: boolean;
  configured?: boolean;
  /** Достаёт ли сервер api.telegram.org. Без этого копию не отправить. */
  outbound?: { ok: boolean; ms?: number; error?: string } | null;
  /** Сколько мегабайт свободно там, где лежат данные. */
  freeMb?: number | null;
  /** Когда и какого размера был последний собранный архив. */
  lastBackup?: { at: string; sizeMb: number } | null;
  /** На чём споткнулся прошлый запуск, если споткнулся. */
  lastError?: { at: string; stage: string; error: string } | null;
}

/** Whether the current Telegram account is the backup owner (controls UI). */
export async function getBackupStatus(): Promise<BackupStatus> {
  try {
    const res = await fetch('/api/backup/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ initData: getServerAuth() }),
    });
    if (!res.ok) return { owner: false };
    return (await res.json()) as BackupStatus;
  } catch {
    return { owner: false };
  }
}

/** Ask the server to make a backup and deliver it to this Telegram account. */
export async function requestTelegramBackup(): Promise<{ ok: boolean; dispatched?: boolean }> {
  try {
    const res = await fetch('/api/backup/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ initData: getServerAuth() }),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; dispatched?: boolean };
  } catch {
    return { ok: false };
  }
}
