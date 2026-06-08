import { getServerAuth } from '@/lib/storage';

/** Whether the current Telegram account is the backup owner (controls UI). */
export async function getBackupStatus(): Promise<{ owner: boolean }> {
  try {
    const res = await fetch('/api/backup/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: getServerAuth() }),
    });
    if (!res.ok) return { owner: false };
    return (await res.json()) as { owner: boolean };
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
      body: JSON.stringify({ initData: getServerAuth() }),
    });
    if (!res.ok) return { ok: false };
    return (await res.json()) as { ok: boolean; dispatched?: boolean };
  } catch {
    return { ok: false };
  }
}
