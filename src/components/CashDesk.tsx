import { useEffect, useState } from 'react';
import { useFinanceStore } from '@/store';
import { getBackupStatus } from '@/lib/backup';
import type { BackupStatus } from '@/lib/backup';
import { CoinIcon } from '@/components/slot-art';
import { rainCoins } from '@/lib/coins';
import { coinDing, primeAudio } from '@/lib/sound';
import { notifySuccess, tapMedium } from '@/lib/haptics';
import { CreativeRow } from '@/components/CreativePanel';
import { Button, Icon } from '@/ui-px';
import '@/pages/casino.css';
import { fmtDate, fmtNum as fmt, fmtShort, t, useT } from '@/i18n';

const AMOUNTS = [10_000, 100_000, 1_000_000];
/** Токены каторги: их в игре добывать тяжелее всего. */
const TOKENS = [1_000, 10_000, 100_000];
/** Миллион — коротко («1 млн»): полная запись не влезает в кнопку на телефоне. */
const amount = (n: number) => (n >= 1_000_000 ? fmtShort(n) : fmt(n));

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
  useT();

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
    <section className="cash px" aria-label={t('cash.title')}>
      <div className="cash__head">
        <h3 className="px-h">{t('cash.title')}</h3>
        <span className="cash__meta">{t('cash.meta')}</span>
      </div>
      {/* Что выдаёт ряд — значок в его начале; на кнопках только суммы. */}
      <div className="cash__row">
        <span className="cash__what">
          <CoinIcon size={22} />
        </span>
        {AMOUNTS.map((n) => (
          <Button key={n} kind="primary" className="cash__btn" onClick={() => give(n)}>
            <b className="px-num">+{amount(n)}</b>
          </Button>
        ))}
      </div>
      <div className="cash__row">
        <span className="cash__what">
          <Icon name="token" />
        </span>
        {TOKENS.map((n) => (
          <Button key={n} className="cash__btn" onClick={() => giveTokens(n)}>
            <b className="px-num">+{amount(n)}</b>
          </Button>
        ))}
      </div>
      <div className="cash__creative px-dark">
        <CreativeRow className="px-btn px-f px-btn--iron" />
      </div>
      {/* Одна строка; полный текст — в подсказке (critic K2 #14). */}
      <p className="cash__hint" data-tip={t('cash.hint')}>
        {t('cash.hintShort')}
      </p>
      <BackupHealth s={status} />
    </section>
  );
}

const when = (iso: string) =>
  fmtDate(new Date(iso), {
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
    <div className="cash-health">
      <div className="cash-health__row">
        <span>{t('cash.telegram')}</span>
        <b className={out?.ok ? 'is-ok' : 'is-bad'}>
          {out == null ? '—' : out.ok ? t('cash.linkOk', { ms: out.ms ?? 0 }) : t('cash.linkNo')}
        </b>
      </div>
      {out && !out.ok && out.error && <p className="cash-health__err">{out.error}</p>}

      <div className="cash-health__row">
        <span>{t('cash.disk')}</span>
        <b className={s.freeMb != null && s.freeMb < 300 ? 'is-bad' : 'is-ok'}>
          {s.freeMb != null ? t('cash.mb', { n: s.freeMb }) : '—'}
        </b>
      </div>

      <div className="cash-health__row">
        <span>{t('cash.last')}</span>
        <b className={stale ? 'is-bad' : 'is-ok'}>
          {s.lastBackup
            ? `${when(s.lastBackup.at)} · ${t('cash.mb', { n: s.lastBackup.sizeMb })}`
            : t('cash.none')}
        </b>
      </div>

      {s.lastError && (
        <p className="cash-health__err">
          {t('cash.failed', { stage: s.lastError.stage, error: s.lastError.error })}
        </p>
      )}
      <p className="cash__hint">{t('cash.schedule')}</p>
    </div>
  );
}
