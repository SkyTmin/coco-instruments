import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { CoinIcon, SlotArtDefs, SymbolArt } from '@/components/slot-art';
import { IconInfo } from '@/components/icons';
import { useFinanceStore } from '@/store';
import {
  BETS,
  BONUS_COOLDOWN_MS,
  DAILY_BONUS,
  hasAnticipation,
  lineBet,
  outcomeLabel,
  PAYLINES,
  randomSymbol,
  RESCUE_BONUS,
  ROWS,
  SLOT_SYMBOLS,
  symbolOf,
} from '@/lib/slots';
import type { SlotGrid, SlotSymbolId, SpinResult } from '@/lib/slots';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import {
  anticipation as antiSound,
  coinDing,
  counterTick,
  jackpotFanfare,
  leverPull,
  primeAudio,
  reelStop,
  reelTick,
  setMuted,
  winChime,
} from '@/lib/sound';
import { notifySuccess, selectionChanged, tapLight, tapMedium } from '@/lib/haptics';

// Высота ячейки барабана — та же величина в CSS (--cell): лента двигается на
// целое число ячеек, поэтому символы всегда встают ровно в окно.
const CELL = 74;
/** Сколько случайных «пролетающих» символов между стартом и результатом. */
const FILLER = 18;
const BASE_MS = 900;
const STEP_MS = 280;
/** Пауза перед последним барабаном, когда на линии уже два премиума. */
const ANTICIPATION_MS = 900;
const AUTO_SPINS = 10;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const randomColumn = () => Array.from({ length: ROWS }, () => randomSymbol());

/** Лента одного барабана: [видимое сейчас, …мусор, результат, хвост]. */
function makeStrip(from: SlotSymbolId[], to: SlotSymbolId[]): SlotSymbolId[] {
  const filler = Array.from({ length: FILLER }, () => randomSymbol());
  // Хвост нужен, чтобы «отскок» в конце анимации не открыл пустоту.
  return [...from, ...filler, ...to, randomSymbol()];
}

const startGrid = (): SlotGrid => [randomColumn(), randomColumn(), randomColumn()];

function Reel({
  strip,
  spinId,
  duration,
  onStop,
}: {
  strip: SlotSymbolId[];
  spinId: number;
  duration: number;
  onStop: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stopRef = useRef(onStop);
  stopRef.current = onStop;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || spinId === 0) return;
    const distance = (strip.length - ROWS - 1) * CELL;
    if (reduceMotion()) {
      el.style.transition = 'none';
      el.style.transform = `translateY(-${distance}px)`;
      stopRef.current();
      return;
    }
    el.style.transition = 'none';
    el.style.transform = 'translateY(0)';
    el.classList.add('is-blur');
    void el.offsetHeight; // reflow, иначе браузер склеит оба присваивания
    // Небольшой «перелёт» в конце — барабан отскакивает, как механический.
    el.style.transition = `transform ${duration}ms cubic-bezier(.18,.76,.24,1.06)`;
    el.style.transform = `translateY(-${distance}px)`;
    const t = setTimeout(() => {
      el.classList.remove('is-blur');
      stopRef.current();
    }, duration);
    return () => clearTimeout(t);
  }, [spinId, strip, duration]);

  return (
    <div className="reel">
      <div className="reel__strip" ref={ref}>
        {strip.map((id, i) => (
          <span className="reel__cell" key={`${id}-${i}`}>
            <SymbolArt id={id} size={58} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Прочерченные линии выплат поверх поля. */
function PaylineOverlay({ wins }: { wins: SpinResult['wins'] }) {
  if (!wins.length) return null;
  const x = (col: number) => ((col + 0.5) / 3) * 100;
  const y = (row: number) => ((row + 0.5) / 3) * 100;
  return (
    <svg className="paylines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {wins.map((w, i) => (
        <polyline
          key={`${w.line}-${i}`}
          className="payline"
          style={{ animationDelay: `${i * 0.12}s` }}
          points={w.cells.map(([col, row]) => `${x(col)},${y(row)}`).join(' ')}
        />
      ))}
    </svg>
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
  const jackpotPool = useFinanceStore((s) => s.slotsJackpot);
  const sound = useFinanceStore((s) => s.slotsSound);
  const turbo = useFinanceStore((s) => s.slotsTurbo);
  const setBet = useFinanceStore((s) => s.setSlotsBet);
  const playSlots = useFinanceStore((s) => s.playSlots);
  const claimBonus = useFinanceStore((s) => s.claimSlotsBonus);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);

  const [strips, setStrips] = useState<SlotSymbolId[][]>(() => startGrid());
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [durations, setDurations] = useState([BASE_MS, BASE_MS, BASE_MS]);
  const [stopped, setStopped] = useState(3);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [pending, setPending] = useState(0);
  const [auto, setAuto] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [lever, setLever] = useState(0);
  const [shake, setShake] = useState(false);
  const [streak, setStreak] = useState(0);
  const [celebration, setCelebration] = useState<{ tier: 'big' | 'jackpot'; amount: number } | null>(
    null,
  );
  const [jackpotWin, setJackpotWin] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragRef = useRef<{ y: number; id: number } | null>(null);

  useEffect(() => setMuted(!sound), [sound]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (tickRef.current) clearInterval(tickRef.current);
    },
    [],
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Ставка всегда по карману: если монет на текущую не хватает, опускаемся к
  // максимальной доступной — иначе кнопка «Крутить» мертва без объяснений.
  useEffect(() => {
    if (!hydrated || spinning || balance >= bet) return;
    const affordable = [...BETS].reverse().find((b) => b <= balance);
    if (affordable && affordable !== bet) setBet(affordable);
  }, [hydrated, spinning, balance, bet, setBet]);

  const bonusLeft = bonusAt ? bonusAt + BONUS_COOLDOWN_MS - now : 0;
  const dailyReady = bonusLeft <= 0;
  const broke = balance < Math.min(...BETS);
  const canSpin = hydrated && !spinning && balance >= bet;
  // На табло — копилка плюс то, что заплатит сама линия семёрок.
  const jackpotPrize = jackpotPool + lineBet(bet) * symbolOf('seven').three;

  const finish = useCallback((res: SpinResult & { jackpotWin: number }) => {
    if (tickRef.current) clearInterval(tickRef.current);
    setResult(res);
    setPending(0);
    setSpinning(false);
    setJackpotWin(res.jackpotWin);
    setStreak((n) => (res.total > 0 ? n + 1 : 0));
    if (res.kind === 'jackpot') {
      notifySuccess();
      jackpotFanfare();
      burstConfetti(180);
      rainCoins(40);
      setShake(true);
      setCelebration({ tier: 'jackpot', amount: res.total });
    } else if (res.kind === 'big') {
      notifySuccess();
      winChime('big');
      rainCoins(22);
      burstConfetti(70);
      setCelebration({ tier: 'big', amount: res.total });
    } else if (res.kind === 'small') {
      tapLight();
      winChime('small');
    }
  }, []);

  const spin = useCallback(() => {
    if (!hydrated || spinning || balance < bet) return;
    primeAudio();
    const res = playSlots();
    if (!res) return;
    tapMedium();
    leverPull();

    const from: SlotSymbolId[][] = strips.map((s) => s.slice(-ROWS - 1, -1));
    const next = res.grid.map((col, i) =>
      makeStrip(from[i]?.length === ROWS ? from[i] : randomColumn(), col),
    );
    // Драма «почти выиграл»: два премиума на линии — третий барабан тормозит.
    const drama = hasAnticipation(res.grid);
    const scale = turbo ? 0.5 : 1;
    const durs = [0, 1, 2].map(
      (i) => (BASE_MS + i * STEP_MS + (drama && i === 2 ? ANTICIPATION_MS : 0)) * scale,
    );

    setStrips(next);
    setDurations(durs);
    setStopped(0);
    setResult(null);
    setShake(false);
    setCelebration(null);
    setJackpotWin(0);
    setPending(res.total);
    setSpinId((n) => n + 1);
    setSpinning(true);

    // Пока барабаны в движении — дробный стрёкот механики.
    if (tickRef.current) clearInterval(tickRef.current);
    if (!reduceMotion()) {
      tickRef.current = setInterval(() => reelTick(), turbo ? 55 : 80);
      if (drama) timers.current.push(setTimeout(() => antiSound(), durs[1]));
    }

    timers.current.push(setTimeout(() => finish(res), durs[2] + 40));
  }, [hydrated, spinning, balance, bet, playSlots, strips, turbo, finish]);

  // Баннер крупного выигрыша живёт ~4 секунды: вспышка → лучи → счёт с тиканьем.
  useEffect(() => {
    if (!celebration) return undefined;
    const ticks = setInterval(() => counterTick(), 70);
    const stopTicks = setTimeout(() => clearInterval(ticks), 1500);
    const hide = setTimeout(() => setCelebration(null), 4200);
    return () => {
      clearInterval(ticks);
      clearTimeout(stopTicks);
      clearTimeout(hide);
    };
  }, [celebration]);

  // Автоспин: очередь вращений, прерывается кнопкой или нехваткой монет.
  useEffect(() => {
    if (auto <= 0 || spinning) return;
    if (balance < bet) {
      setAuto(0);
      return;
    }
    // Во время большого выигрыша пауза длиннее — дать досмотреть празднование.
    const t = setTimeout(() => {
      setAuto((n) => n - 1);
      spin();
    }, celebration ? 3200 : 700);
    return () => clearTimeout(t);
  }, [auto, spinning, balance, bet, spin, celebration]);

  const onReelStop = (index: number) => {
    setStopped((n) => Math.max(n, index + 1));
    reelStop(index);
    selectionChanged();
  };

  const takeBonus = (amount: number) => {
    primeAudio();
    tapLight();
    claimBonus(amount);
    coinDing();
    coinDing(0.12);
    rainCoins(14);
    notifySuccess();
    setNow(Date.now());
  };

  // ---- рычаг ---------------------------------------------------------------
  const leverDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canSpin) return;
    dragRef.current = { y: e.clientY, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const leverMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setLever(Math.max(0, Math.min(1, (e.clientY - d.y) / 72)));
  };
  const leverUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setLever((v) => {
      if (v > 0.55) spin();
      return 0;
    });
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
  }, [spin]);

  const shownBalance = Math.max(0, balance - pending);
  const winCells = new Set(
    (result?.wins ?? []).flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)),
  );

  return (
    <Screen
      title="Слоты"
      subtitle="Мини-игра на удачу"
      action={
        <button
          className="icon-btn"
          onClick={() => {
            tapLight();
            setSheet(true);
          }}
          aria-label="Правила и выплаты"
        >
          <IconInfo size={21} />
        </button>
      }
    >
      <div className="stack slots">
        <SlotArtDefs />
        {/* Табло: баланс и текущий джекпот */}
        <div className="slot-hud">
          <div className="slot-hud__cell">
            <span className="slot-hud__label">Баланс</span>
            <span className="slot-hud__value">
              <AnimatedNumber value={shownBalance} format={(n) => fmt(n)} duration={450} />
              <CoinIcon size={18} />
            </span>
          </div>
          <div className="slot-hud__cell slot-hud__cell--jackpot">
            <span className="slot-hud__label">
              Джекпот
              <SymbolArt id="seven" size={13} />
              <SymbolArt id="seven" size={13} />
              <SymbolArt id="seven" size={13} />
            </span>
            <span className="slot-hud__value slot-hud__value--jackpot">
              <AnimatedNumber value={jackpotPrize} format={(n) => fmt(n)} duration={600} />
              <CoinIcon size={18} />
            </span>
          </div>
        </div>

        {/* Корпус автомата */}
        <div
          className={`cabinet${result?.kind === 'jackpot' ? ' is-jackpot' : ''}${
            shake ? ' is-shake' : ''
          }${spinning ? ' is-spinning' : ''}`}
          onAnimationEnd={() => setShake(false)}
        >
          <div className="cabinet__bulbs" aria-hidden="true">
            {Array.from({ length: 14 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />
            ))}
          </div>

          <div className="cabinet__sign">
            <span>COCO</span>
            <b>SLOTS</b>
          </div>

          <div className="cabinet__body">
            <div className="cabinet__window">
              <span className="cabinet__bolts" aria-hidden="true">
                <i />
                <i />
              </span>
              <div className="reels">
                {strips.map((strip, i) => (
                  <Reel
                    key={i}
                    strip={strip}
                    spinId={spinId}
                    duration={durations[i]}
                    onStop={() => onReelStop(i)}
                  />
                ))}
                {!spinning && result && result.wins.length > 0 && (
                  <div className="reels__dim" aria-hidden="true" />
                )}
                {!spinning && result && result.wins.length > 0 && (
                  <div className="reels__marks" aria-hidden="true">
                    {[0, 1, 2].map((col) =>
                      [0, 1, 2].map((row) =>
                        winCells.has(`${col}-${row}`) ? (
                          <span
                            key={`${col}-${row}`}
                            className="reels__mark"
                            style={{
                              left: `calc(${col} * (100% / 3))`,
                              top: `calc(${row} * (100% / 3))`,
                            }}
                          />
                        ) : null,
                      ),
                    )}
                  </div>
                )}
                {!spinning && result && <PaylineOverlay wins={result.wins} />}
                <div className="reels__glass" aria-hidden="true" />
              </div>
            </div>

            {/* Рычаг */}
            <div
              className={`lever${canSpin ? '' : ' is-off'}`}
              onPointerDown={leverDown}
              onPointerMove={leverMove}
              onPointerUp={leverUp}
              onPointerCancel={leverUp}
              role="button"
              tabIndex={-1}
              aria-label="Рычаг — потяните вниз"
            >
              <span className="lever__slot" />
              <span className="lever__base" />
              <span
                className="lever__arm"
                style={{
                  transform: `translateY(${lever * 44}px)`,
                  transition: dragRef.current ? 'none' : 'transform .35s cubic-bezier(.3,1.5,.5,1)',
                }}
              >
                <span className="lever__knob" />
                <span className="lever__rod" />
              </span>
            </div>
          </div>

          <div className="cabinet__tray" aria-hidden="true">
            <span className="cabinet__slot-in" />
            <span className="cabinet__vent" />
          </div>

          <div className="cabinet__status">
            {spinning ? (
              <span className="status status--spin">
                {stopped === 2 ? 'Последний барабан…' : 'Крутится…'}
              </span>
            ) : result ? (
              <>
                <span className="status">
                  {outcomeLabel(result).symbol && (
                    <SymbolArt id={outcomeLabel(result).symbol!} size={22} />
                  )}
                  {outcomeLabel(result).text}
                </span>
                {result.total > 0 && (
                  <span className={`status__win${result.kind === 'jackpot' ? ' is-jackpot' : ''}`}>
                    +<AnimatedNumber value={result.total} format={(n) => fmt(n)} duration={700} />
                    <CoinIcon size={20} />
                  </span>
                )}
                {result.multiplier >= 3 && (
                  <span className="status__mult">×{fmt(result.multiplier)}</span>
                )}
                {jackpotWin > 0 && <span className="status__pool">копилка!</span>}
                {streak >= 2 && result.total > 0 && (
                  <span className="status__streak">🔥 {streak}</span>
                )}
              </>
            ) : (
              <span className="status status--hint">Потяните рычаг или жмите «Крутить»</span>
            )}
          </div>
        </div>

        {/* Ставки */}
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

        {/* Кнопки управления */}
        <div className="slot-actions">
          <button
            className={`spin-btn${spinning ? ' is-busy' : ''}`}
            disabled={!canSpin && auto === 0}
            onClick={() => (auto > 0 ? setAuto(0) : spin())}
          >
            {auto > 0
              ? `Стоп (${auto})`
              : spinning
                ? 'Крутится…'
                : broke
                  ? 'Монеты кончились'
                  : `Крутить · ${fmt(bet)}`}
          </button>
          <button
            className="slot-mini"
            disabled={!canSpin && auto === 0}
            onClick={() => {
              tapLight();
              primeAudio();
              setAuto((n) => (n > 0 ? 0 : AUTO_SPINS));
            }}
            aria-label="Автоспин 10 раз"
          >
            ↻10
          </button>
          <button
            className={`slot-mini${turbo ? ' is-on' : ''}`}
            onClick={() => {
              selectionChanged();
              setPrefs({ turbo: !turbo });
            }}
            aria-label="Турбо-режим"
          >
            ⚡
          </button>
          <button
            className={`slot-mini${sound ? ' is-on' : ''}`}
            onClick={() => {
              selectionChanged();
              primeAudio();
              setPrefs({ sound: !sound });
            }}
            aria-label="Звук"
          >
            {sound ? '🔊' : '🔇'}
          </button>
        </div>

        {(dailyReady || broke) && (
          <button
            className="btn btn--ghost btn--block"
            onClick={() => takeBonus(dailyReady ? DAILY_BONUS : RESCUE_BONUS)}
          >
            {dailyReady
              ? `🎁 Ежедневный бонус +${fmt(DAILY_BONUS)}`
              : `🍀 Спасательные +${fmt(RESCUE_BONUS)}`}
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
                <div key={h.id} className={`slot-chip${h.payout > 0 ? ' is-win' : ''}`}>
                  <span className="slot-chip__reels">
                    {h.reels.map((id, i) => (
                      <SymbolArt key={i} id={id} size={17} />
                    ))}
                  </span>
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
            <div className="slot-stat__num">
              {fmt(best)} <CoinIcon size={15} />
            </div>
            <div className="slot-stat__lbl">лучший выигрыш</div>
          </div>
        </div>
      </div>

      {sheet && (
        <Sheet title="Выплаты и линии" onClose={() => setSheet(false)}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Ставка делится между пятью линиями (по {fmt(lineBet(bet))} монет). Линия платит слева
              направо: три одинаковых — главный выигрыш, два первых — небольшой возврат.
            </p>
            <div className="paytable">
              {[...SLOT_SYMBOLS].reverse().map((s) => (
                <div className="paytable__row" key={s.id}>
                  <span className="paytable__syms">
                    <SymbolArt id={s.id} size={26} />
                    <SymbolArt id={s.id} size={26} />
                    <SymbolArt id={s.id} size={26} />
                  </span>
                  <span className="paytable__mult">×{s.three}</span>
                  <span className="paytable__pair">пара ×{s.pair}</span>
                </div>
              ))}
            </div>
            <div className="lines-grid">
              {PAYLINES.map((line) => (
                <div className="line-card" key={line.id}>
                  <svg viewBox="0 0 30 30" aria-hidden="true">
                    {[0, 1, 2].map((col) =>
                      [0, 1, 2].map((row) => (
                        <rect
                          key={`${col}-${row}`}
                          x={col * 10 + 1}
                          y={row * 10 + 1}
                          width="8"
                          height="8"
                          rx="2"
                          className={line.rows[col] === row ? 'is-on' : ''}
                        />
                      )),
                    )}
                  </svg>
                  <span>{line.name}</span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Монеты виртуальные: купить их нельзя, пополняются ежедневным бонусом. Отдача
              автомата — около 93%.
            </p>
          </div>
        </Sheet>
      )}

      {celebration && (
        <div
          className={`bigwin bigwin--${celebration.tier}`}
          onClick={() => setCelebration(null)}
          role="presentation"
        >
          <div className="bigwin__flash" />
          <div className="bigwin__rays" />
          <div className="bigwin__card">
            <div className="bigwin__title">
              {celebration.tier === 'jackpot' ? 'ДЖЕКПОТ!' : 'БОЛЬШОЙ ВЫИГРЫШ'}
            </div>
            <div className="bigwin__amount">
              <AnimatedNumber value={celebration.amount} format={(n) => fmt(n)} duration={1400} />
              <CoinIcon size={30} />
            </div>
            <div className="bigwin__hint">нажмите, чтобы продолжить</div>
          </div>
        </div>
      )}
    </Screen>
  );
}
