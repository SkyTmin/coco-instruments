import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { IconInfo } from '@/components/icons';
import { useFinanceStore } from '@/store';
import {
  BETS,
  BONUS_COOLDOWN_MS,
  DAILY_BONUS,
  emojiOf,
  evaluateSpin,
  outcomeLabel,
  randomSymbol,
  RESCUE_BONUS,
  SLOT_SYMBOLS,
} from '@/lib/slots';
import type { SlotSymbolId, SpinOutcome } from '@/lib/slots';
import { burstConfetti } from '@/lib/confetti';
import { notifySuccess, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

// Высота окна барабана: та же величина в CSS (--slot-cell) — лента двигается
// ровно на целое число ячеек, поэтому символ всегда останавливается по центру.
const CELL = 76;
/** Сколько случайных символов прокручивается до результата. */
const STRIP_LEN = 14;
const REEL_BASE_MS = 850;
const REEL_STEP_MS = 320;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const fmt = (n: number) => n.toLocaleString('ru-RU');

/** Лента символов: [текущий, …случайные, результат] — конец ленты и есть кадр. */
function makeStrip(from: SlotSymbolId, to: SlotSymbolId): SlotSymbolId[] {
  const strip: SlotSymbolId[] = [from];
  for (let i = 0; i < STRIP_LEN; i++) strip.push(randomSymbol());
  strip.push(to);
  return strip;
}

function Reel({
  strip,
  spinId,
  index,
  highlighted,
}: {
  strip: SlotSymbolId[];
  spinId: number;
  index: number;
  highlighted: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Каждый новый спин: мгновенно ставим ленту в начало (первый кадр совпадает
  // с тем, что уже видно), затем запускаем прокрутку к последнему символу.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || spinId === 0) return;
    const distance = (strip.length - 1) * CELL;
    if (reduceMotion()) {
      el.style.transition = 'none';
      el.style.transform = `translateY(-${distance}px)`;
      return;
    }
    el.style.transition = 'none';
    el.style.transform = 'translateY(0)';
    void el.offsetHeight; // reflow — иначе браузер склеит оба присваивания
    el.style.transition = `transform ${(REEL_BASE_MS + index * REEL_STEP_MS) / 1000}s cubic-bezier(.16,.74,.2,1)`;
    el.style.transform = `translateY(-${distance}px)`;
  }, [spinId, strip, index]);

  return (
    <div className={`slot-reel${highlighted ? ' is-win' : ''}`}>
      <div className="slot-reel__strip" ref={ref}>
        {strip.map((id, i) => (
          <span className="slot-reel__cell" key={`${id}-${i}`}>
            {emojiOf(id)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SlotsPage() {
  const hydrated = useFinanceStore((s) => s.hydrated);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const bet = useFinanceStore((s) => s.slotsBet);
  const spins = useFinanceStore((s) => s.slotsSpins);
  const best = useFinanceStore((s) => s.slotsBest);
  const bonusAt = useFinanceStore((s) => s.slotsBonusAt);
  const history = useFinanceStore((s) => s.slotsHistory);
  const setBet = useFinanceStore((s) => s.setSlotsBet);
  const playSlots = useFinanceStore((s) => s.playSlots);
  const claimBonus = useFinanceStore((s) => s.claimSlotsBonus);

  const [strips, setStrips] = useState<SlotSymbolId[][]>([['cherry'], ['lemon'], ['grape']]);
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [outcome, setOutcome] = useState<SpinOutcome | null>(null);
  // Пока барабаны крутятся, выигрыш ещё не показываем: баланс в сторе уже
  // обновлён, поэтому вычитаем «неоткрытую» выплату из отображаемого числа.
  const [pending, setPending] = useState(0);
  const [payTable, setPayTable] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  // Тикаем раз в минуту — обновляет обратный отсчёт до ежедневного бонуса.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Ставка всегда по карману: как только монет на текущую не хватает,
  // опускаемся к максимальной доступной — иначе кнопка «Крутить» мертва и
  // игрок не понимает, что делать.
  useEffect(() => {
    if (!hydrated || spinning || balance >= bet) return;
    const affordable = [...BETS].reverse().find((b) => b <= balance);
    if (affordable && affordable !== bet) setBet(affordable);
  }, [hydrated, spinning, balance, bet, setBet]);

  const bonusLeft = bonusAt ? bonusAt + BONUS_COOLDOWN_MS - now : 0;
  const dailyReady = bonusLeft <= 0;
  const broke = balance < Math.min(...BETS);
  const canSpin = hydrated && !spinning && balance >= bet;

  const spin = () => {
    if (!canSpin) return;
    const res = playSlots();
    if (!res) return;
    tapMedium();
    const from = strips.map((s) => s[s.length - 1]);
    setStrips(res.reels.map((to, i) => makeStrip(from[i], to)));
    setSpinId((n) => n + 1);
    setSpinning(true);
    setOutcome(null);
    setPending(res.payout);

    const instant = reduceMotion();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    // Барабаны останавливаются по очереди — щелчок на каждом.
    for (let i = 0; i < 3; i++) {
      const at = instant ? 0 : REEL_BASE_MS + i * REEL_STEP_MS;
      timers.current.push(setTimeout(() => selectionChanged(), at));
    }
    const endAt = instant ? 0 : REEL_BASE_MS + 2 * REEL_STEP_MS + 60;
    timers.current.push(
      setTimeout(() => {
        const out = evaluateSpin(res.reels, bet);
        setOutcome(out);
        setPending(0);
        setSpinning(false);
        if (out.kind === 'jackpot') {
          notifySuccess();
          burstConfetti(160);
        } else if (out.kind === 'triple') {
          notifySuccess();
          burstConfetti();
        } else if (out.kind === 'pair') {
          tapLight();
        }
      }, endAt),
    );
  };

  const takeBonus = (amount: number) => {
    tapLight();
    claimBonus(amount);
    notifySuccess();
    setNow(Date.now());
  };

  // Пробел/Enter — крутить (десктопный Telegram и браузер).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        spin();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shownBalance = Math.max(0, balance - pending);
  const winLabel = outcome && outcome.payout > 0 ? `+${fmt(outcome.payout)}` : '';

  return (
    <Screen
      title="Слоты"
      subtitle="Мини-игра на удачу"
      action={
        <button
          className="icon-btn"
          onClick={() => {
            tapLight();
            setPayTable(true);
          }}
          aria-label="Таблица выплат"
        >
          <IconInfo size={21} />
        </button>
      }
    >
      <div className="stack">
        <div className="slot-balance">
          <span className="slot-balance__label">Баланс</span>
          <span className="slot-balance__value">
            <AnimatedNumber value={shownBalance} format={(n) => fmt(Math.round(n))} /> 🪙
          </span>
        </div>

        <div className={`slot-machine${outcome?.kind === 'jackpot' ? ' is-jackpot' : ''}`}>
          <div className="slot-machine__reels">
            {strips.map((strip, i) => (
              <Reel
                key={i}
                strip={strip}
                spinId={spinId}
                index={i}
                highlighted={!spinning && !!outcome?.matched.includes(i)}
              />
            ))}
          </div>
          <div className="slot-machine__status">
            {spinning ? (
              <span className="slot-status__spin">Крутим…</span>
            ) : outcome ? (
              <>
                <span className="slot-status__text">{outcomeLabel(outcome)}</span>
                {winLabel && <span className="slot-status__win">{winLabel} 🪙</span>}
              </>
            ) : (
              <span className="slot-status__text">
                Ставка {fmt(bet)} 🪙 — три одинаковых дают главный выигрыш
              </span>
            )}
          </div>
        </div>

        <div className="slot-bets">
          {BETS.map((b) => (
            <button
              key={b}
              className={`slot-bet${b === bet ? ' is-active' : ''}`}
              disabled={spinning || b > balance}
              onClick={() => {
                selectionChanged();
                setBet(b);
              }}
            >
              {fmt(b)}
            </button>
          ))}
        </div>

        <button
          className="btn btn--primary btn--block slot-spin"
          disabled={!canSpin}
          onClick={spin}
        >
          {spinning
            ? 'Барабаны крутятся…'
            : broke
              ? 'Монеты кончились — заберите бонус'
              : `Крутить за ${fmt(bet)} 🪙`}
        </button>

        {(dailyReady || broke) && (
          <button
            className="btn btn--ghost btn--block"
            onClick={() => takeBonus(dailyReady ? DAILY_BONUS : RESCUE_BONUS)}
          >
            {dailyReady
              ? `🎁 Ежедневный бонус +${fmt(DAILY_BONUS)} 🪙`
              : `🍀 Спасательные +${fmt(RESCUE_BONUS)} 🪙`}
          </button>
        )}
        {!dailyReady && !broke && (
          <p className="slot-bonus-hint">
            Следующий бонус через{' '}
            {bonusLeft > 60 * 60 * 1000
              ? `${Math.ceil(bonusLeft / (60 * 60 * 1000))} ч`
              : `${Math.max(1, Math.ceil(bonusLeft / 60_000))} мин`}
          </p>
        )}

        {history.length > 0 && (
          <div className="slot-history">
            <div className="slot-history__label">Последние</div>
            <div className="slot-history__row">
              {history.map((h) => (
                <div
                  key={h.id}
                  className={`slot-chip${h.payout > 0 ? ' is-win' : ''}`}
                  title={`Ставка ${fmt(h.bet)}`}
                >
                  <span className="slot-chip__reels">{h.reels.map(emojiOf).join('')}</span>
                  <span className="slot-chip__sum">
                    {h.payout > 0 ? `+${fmt(h.payout)}` : `−${fmt(h.bet)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="slot-stats">
          <div className="slot-stat">
            <div className="slot-stat__num">{fmt(spins)}</div>
            <div className="slot-stat__lbl">спинов</div>
          </div>
          <div className="slot-stat">
            <div className="slot-stat__num">{fmt(best)} 🪙</div>
            <div className="slot-stat__lbl">лучший выигрыш</div>
          </div>
        </div>
      </div>

      {payTable && (
        <Sheet title="Таблица выплат" onClose={() => setPayTable(false)}>
          <div className="stack">
            <div className="paytable">
              {[...SLOT_SYMBOLS].reverse().map((s) => (
                <div className="paytable__row" key={s.id}>
                  <span className="paytable__syms">
                    {s.emoji}
                    {s.emoji}
                    {s.emoji}
                  </span>
                  <span className="paytable__mult">×{s.three}</span>
                  <span className="paytable__pair">пара ×{s.pair}</span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Выигрыш = ставка × множитель. Три 7️⃣ — джекпот ×500. Монеты виртуальные:
              купить их нельзя, пополняются ежедневным бонусом.
            </p>
          </div>
        </Sheet>
      )}
    </Screen>
  );
}
