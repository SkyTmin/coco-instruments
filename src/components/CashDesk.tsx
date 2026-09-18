import { useEffect, useState } from 'react';
import { useFinanceStore } from '@/store';
import { getBackupStatus } from '@/lib/backup';
import { CoinIcon } from '@/components/slot-art';
import { rainCoins } from '@/lib/coins';
import { coinDing, primeAudio } from '@/lib/sound';
import { notifySuccess, tapMedium } from '@/lib/haptics';

const AMOUNTS = [10_000, 100_000, 1_000_000];
const fmt = (n: number) => n.toLocaleString('ru-RU');

/**
 * Касса: кнопка «закинуть себе монет». Монеты виртуальные, не продаются и ни
 * на что вне игры не влияют — это не покупка, а способ не ждать бонусов.
 * Видна только владельцу приложения (тому же, кому доступен бэкап): для
 * остальных игра должна оставаться игрой.
 */
export function CashDesk() {
  const add = useFinanceStore((s) => s.addSlotsCoins);
  const [owner, setOwner] = useState(false);

  useEffect(() => {
    let alive = true;
    void getBackupStatus().then((s) => alive && setOwner(s.owner));
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
      <p className="reward-block__hint">
        Отдача автомата от этого не меняется: спины по-прежнему считает честный ГСЧ, и проигрывать
        тоже будет. Это просто способ не ждать ежедневных бонусов.
      </p>
    </div>
  );
}
