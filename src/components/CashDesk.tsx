import { useEffect, useState } from 'react';
import { useFinanceStore } from '@/store';
import { getBackupStatus } from '@/lib/backup';
import type { BackupStatus } from '@/lib/backup';
import { CoinIcon } from '@/components/slot-art';
import { rainCoins } from '@/lib/coins';
import { coinDing, primeAudio } from '@/lib/sound';
import { notifySuccess, tapMedium } from '@/lib/haptics';

const AMOUNTS = [10_000, 100_000, 1_000_000];
/** Токены каторги: их в игре добывать тяжелее всего. */
const TOKENS = [1_000, 10_000, 100_000];
const fmt = (n: number) => n.toLocaleString('ru-RU');

/**
 * Касса: кнопка «закинуть себе монет» — и токенов каторги. Монеты и токены
 * виртуальные, не продаются и ни на что вне игры не влияют — это не покупка,
 * а способ не ждать бонусов.
 * Видна только владельцу приложения (тому же, кому доступен бэкап): для
 * остальных игра должна оставаться игрой.
 */
export function CashDesk() {
  const add = useFinanceStore((s) => s.addSlotsCoins);
  const addTokens = useFinanceStore((s) => s.prisonAddTokens);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const owner = !!status?.owner;

  useEffect(() => {
    let alive = true;
    void getBackupStatus().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  const give = (amount: number) => {
    primeAudio();
    tapMedium();
    add(amount);
    coinDing();
    coinDing(0.12);
    rainCoins(20);
    notifySuccess();
  };

  const giveTokens = (amount: number) => {
    primeAudio();
    tapMedium();
    addTokens(amount);
    coinDing();
    notifySuccess();
  };

  if (!owner) return null;

  return (
    <div className="reward-block">
      <div className="reward-block__head">
        <span className="reward-block__title">Касса</span>
        <span className="reward-block__meta">монеты виртуальные</span>
      </div>
      <div className="cash-row">
        {AMOUNTS.map((n) => (
          <button key={n} className="cash-btn" onClick={() => give(n)}>
            +{fmt(n)}
            <CoinIcon size={14} />
          </button>
        ))}
      </div>
      <div className="cash-row">
        {TOKENS.map((n) => (
          <button key={n} className="cash-btn cash-btn--token" onClick={() => giveTokens(n)}>
            +{fmt(n)} ✦
          </button>
        ))}
      </div>
      <p className="reward-block__hint">
        Отдача автомата от этого не меняется: спины по-прежнему считает честный ГСЧ, и проигрывать
        тоже будет. Это просто способ не ждать ежедневных бонусов.
      </p>
      <BackupHealth s={status} />
    </div>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Состояние резервных копий. Они делаются ночью по таймеру, и когда ломаются,
 * никто этого не замечает: однажды копии пропали на неделю, и заметили только
 * когда понадобились. Поэтому владелец видит здесь три вещи, которых хватает
 * для диагноза: доходит ли сервер до Telegram, есть ли место на диске и когда
 * была последняя копия.
 */
function BackupHealth({ s }: { s: BackupStatus | null }) {
  if (!s?.owner) return null;
  const out = s.outbound;
  const stale =
    !s.lastBackup || Date.now() - new Date(s.lastBackup.at).getTime() > 36 * 60 * 60 * 1000;

  return (
    <div className="backup-health">
      <div className="backup-health__row">
        <span>Связь с Telegram</span>
        <b className={out?.ok ? 'is-ok' : 'is-bad'}>
          {out == null ? '—' : out.ok ? `есть · ${out.ms} мс` : 'НЕТ'}
        </b>
      </div>
      {out && !out.ok && out.error && <p className="backup-health__err">{out.error}</p>}

      <div className="backup-health__row">
        <span>Свободно на диске</span>
        <b className={s.freeMb != null && s.freeMb < 300 ? 'is-bad' : 'is-ok'}>
          {s.freeMb != null ? `${s.freeMb.toLocaleString('ru-RU')} МБ` : '—'}
        </b>
      </div>

      <div className="backup-health__row">
        <span>Последняя копия</span>
        <b className={stale ? 'is-bad' : 'is-ok'}>
          {s.lastBackup ? `${when(s.lastBackup.at)} · ${s.lastBackup.sizeMb} МБ` : 'нет ни одной'}
        </b>
      </div>

      {s.lastError && (
        <p className="backup-health__err">
          Прошлый запуск не удался ({s.lastError.stage}): {s.lastError.error}
        </p>
      )}
      <p className="reward-block__hint" style={{ marginBottom: 0 }}>
        Копии собираются каждую ночь в 03:30 и приходят в бота. Забрать прямо сейчас — команда
        /backup.
      </p>
    </div>
  );
}
