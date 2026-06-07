import { getServerAuth } from '@/lib/storage';

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
