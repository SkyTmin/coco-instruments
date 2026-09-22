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

/**
 * Владелец, как его уже знает сервер: сравнение id из подписанного `initData`
 * с настроенным админом. Ответ запоминаем на время жизни вкладки — статус за
 * сессию не меняется, а спрашивать его теперь хочет не только «Касса», но и
 * лист скинов, и лишний запрос на каждое открытие листа ни к чему.
 */
let ownerSeen: boolean | null = null;

/** Что сервер ответил про владельца раньше; `null` — ещё не спрашивали. */
export function cachedOwner(): boolean | null {
  return ownerSeen;
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
    const status = (await res.json()) as BackupStatus;
    ownerSeen = !!status.owner;
    return status;
  } catch {
    // Сети нет — прошлый ответ не отменяем: «не дозвонились» не значит
    // «не владелец», а скин, который пропадает при моргнувшем интернете,
    // хуже, чем скин, выданный на слово сервера минуту назад.
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
