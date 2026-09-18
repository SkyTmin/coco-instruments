import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { IconGift, IconInfo } from '@/components/icons';
import { useFinanceStore } from '@/store';
import type { ScatterSpinOutcome } from '@/store';
import {
  CLUSTER_MIN,
  SCATTER_COLS,
  SCATTER_LADDER,
  SCATTER_PAYS,
  SCATTER_ROWS,
  scatterLabel,
  scatterSymbol,
} from '@/lib/scatter';
import type { ScatterGrid, ScatterStep, ScatterWin } from '@/lib/scatter';
import { BET_STEP, BETS, clampBet, MAX_BET, MIN_BET } from '@/lib/slots';
import type { SlotSymbolId } from '@/lib/slots';
import { levelFromXp, levelReward } from '@/lib/slots-meta';
import { DUST_MS, dustBurst } from '@/lib/dust';
import type { DustCell } from '@/lib/dust';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import {
  coinDing,
  comboHit,
  counterTick,
  jackpotFanfare,
  leverPull,
  primeAudio,
  reelStop,
  reelTick,
  setMuted,
  symbolBurst,
  winChime,
} from '@/lib/sound';
import {
  notifySuccess,
  notifyWarning,
  selectionChanged,
  setHapticsMuted,
  tapLight,
  tapMedium,
} from '@/lib/haptics';

/** Высота ячейки; та же величина в CSS (--scell). */
const SCELL = 54;
/** Сколько «пролетающих» символов между стартом и результатом. */
const FILLER = 14;
const BASE_MS = 780;
const STEP_MS = 150;
/** Каскад: подсветить → рассыпать в пыль → уронить верхние. */
const SHOW_MS = 760;
const BURST_MS = 330;
const DROP_MS = 460;
const DROP_STAGGER = 55;

const AUTO_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 10, label: '10', hint: 'десять вращений' },
  { value: 25, label: '25', hint: 'двадцать пять' },
  { value: 50, label: '50', hint: 'пятьдесят' },
  { value: Infinity, label: '∞', hint: 'пока не кончатся монеты' },
];

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/** Ступень эффектов по длине цепочки. */
function tierOf(chain: number): number {
  if (chain >= 5) return 4;
  if (chain >= 4) return 3;
  if (chain >= 3) return 2;
  if (chain >= 2) return 1;
  return 0;
}

function Sym({ id, skin, size = 40 }: { id: SlotSymbolId; skin: SkinId; size?: number }) {
  return (
    <img className="sym" src={symbolSrc(skin, id)} width={size} height={size} alt="" draggable={false} />
  );
}

// ---------------------------------------------------------------------------
// Поле. Вне каскада колонки крутятся лентой, в каскаде — это сетка, где
// исчезают ровно сыгравшие клетки, а верхние съезжают на их места.
// ---------------------------------------------------------------------------

interface BoardCell {
  key: string;
  id: SlotSymbolId;
  row: number;
  fall: number;
}
type Board = BoardCell[][];

function gridToBoard(grid: ScatterGrid, tag: string): Board {
  return grid.map((col, c) => col.map((id, row) => ({ key: `${tag}-${c}-${row}`, id, row, fall: 0 })));
}

function collapseBoard(step: ScatterStep, tag: string): Board {
  const dead = new Set(step.wins.flatMap((w) => w.cells.map(([c, r]) => `${c}:${r}`)));
  return step.grid.map((col, c) => {
    const survivors: BoardCell[] = [];
    col.forEach((id, row) => {
      if (dead.has(`${c}:${row}`)) return;
      survivors.push({ key: `${tag}-s-${c}-${row}`, id, row, fall: 0 });
    });
    const gone = SCATTER_ROWS - survivors.length;
    const cells: BoardCell[] = survivors.map((cell, i) => {
      const row = gone + i;
      return { ...cell, row, fall: row - cell.row };
    });
    for (let row = 0; row < gone; row++) {
      cells.unshift({ key: `${tag}-n-${c}-${row}`, id: step.next[c][row], row, fall: gone });
    }
    return cells.sort((a, b) => a.row - b.row);
  });
}

/** Лента для обычного вращения одной колонки. */
function makeStrip(to: SlotSymbolId[]): SlotSymbolId[] {
  return [...Array.from({ length: FILLER }, () => scatterSymbol()), ...to];
}

function SpinCol({
  strip,
  skin,
  spinId,
  duration,
  onStop,
}: {
  strip: SlotSymbolId[];
  skin: SkinId;
  spinId: number;
  duration: number;
  onStop: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stopRef = useRef(onStop);
  stopRef.current = onStop;

  useEffect(() => {
    const el = ref.current;
    if (!el || spinId === 0) return;
    const to = -(strip.length - SCATTER_ROWS) * SCELL;
    if (reduceMotion()) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${to}px)`;
      stopRef.current();
      return;
    }
    el.style.transition = 'none';
    el.style.transform = 'translateY(0)';
    el.classList.add('is-blur');
    void el.offsetHeight;
    el.style.transition = `transform ${duration}ms cubic-bezier(.18,.76,.24,1.06)`;
    el.style.transform = `translateY(${to}px)`;
    const t = setTimeout(() => {
      el.classList.remove('is-blur');
      stopRef.current();
    }, duration);
    return () => clearTimeout(t);
  }, [spinId, strip, duration]);

  return (
    <div className="sboard__col">
      <div className="sboard__strip" ref={ref}>
        {strip.map((id, i) => (
          <span className="sbcell sbcell--flow" key={`${id}-${i}`}>
            <Sym id={id} skin={skin} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function ScatterPage() {
  const nav = useNavigate();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const bet = useFinanceStore((s) => s.slotsBet);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const sound = useFinanceStore((s) => s.slotsSound);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const turbo = useFinanceStore((s) => s.slotsTurbo);
  const xp = useFinanceStore((s) => s.slotsXp);
  const spins = useFinanceStore((s) => s.scatterSpins);
  const best = useFinanceStore((s) => s.scatterBest);
  const setBet = useFinanceStore((s) => s.setSlotsBet);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  const playScatter = useFinanceStore((s) => s.playScatter);
  const claimRescue = useFinanceStore((s) => s.claimSlotsRescue);

  const [strips, setStrips] = useState<SlotSymbolId[][]>(() =>
    Array.from({ length: SCATTER_COLS }, () =>
      Array.from({ length: SCATTER_ROWS }, () => scatterSymbol()),
    ),
  );
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [durations, setDurations] = useState<number[]>(() =>
    Array.from({ length: SCATTER_COLS }, (_, i) => BASE_MS + i * STEP_MS),
  );
  const [board, setBoard] = useState<Board | null>(null);
  const [dropDur, setDropDur] = useState(DROP_MS);
  const [cascade, setCascade] = useState<{ step: number; phase: 'show' | 'burst' | 'drop' } | null>(
    null,
  );
  const [stepWins, setStepWins] = useState<ScatterWin[]>([]);
  const [stepCombo, setStepCombo] = useState(1);
  const [chain, setChain] = useState(0);
  const [runWin, setRunWin] = useState(0);
  const [pending, setPending] = useState(0);
  const [result, setResult] = useState<ScatterSpinOutcome | null>(null);
  const [auto, setAuto] = useState(0);
  const [autoSheet, setAutoSheet] = useState(false);
  const [betSheet, setBetSheet] = useState(false);
  const [betDraft, setBetDraft] = useState(bet);
  const [settings, setSettings] = useState(false);
  const [rules, setRules] = useState(false);
  const [shake, setShake] = useState(false);
  const [celebration, setCelebration] = useState<{ tier: string; amount: number } | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; coins: number; freeSpins: number } | null>(
    null,
  );

  const boardRef = useRef<HTMLDivElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);
  const dustStop = useRef<(() => void) | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (tickRef.current) clearInterval(tickRef.current);
      dustStop.current?.();
    },
    [],
  );

  // Ставка всегда по карману.
  useEffect(() => {
    if (!hydrated || spinning || balance >= bet) return;
    // Сначала пробуем быструю ставку, иначе опускаемся к любой посильной —
    // с восемью монетами в кармане игрок всё ещё должен мочь крутить.
    const affordable = [...BETS].reverse().find((b) => b <= balance) ?? clampBet(balance);
    if (affordable <= balance && affordable !== bet) setBet(affordable);
  }, [hydrated, spinning, balance, bet, setBet]);

  const level = levelFromXp(xp);
  const theme = skinOf(skin);
  const rainSrc = symbolSrc(skin, theme.rain);
  const broke = balance < MIN_BET && freeSpins <= 0;
  const canSpin = hydrated && !spinning && (freeSpins > 0 || balance >= bet);
  const tier = tierOf(chain);
  const marking = cascade?.phase === 'show' || cascade?.phase === 'burst';
  const shownWins = marking ? stepWins : [];
  const winCells = new Set(shownWins.flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)));
  const winOrder = new Map<string, number>();
  shownWins
    .flatMap((w) => w.cells)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .forEach(([c, r], i) => winOrder.set(`${c}-${r}`, i));
  const dying = new Set(
    cascade?.phase === 'burst' ? stepWins.flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)) : [],
  );
  const shownBalance = Math.max(0, balance - pending);

  const finish = useCallback(
    (res: ScatterSpinOutcome) => {
      if (tickRef.current) clearInterval(tickRef.current);
      setResult(res);
      setPending(0);
      setSpinning(false);
      if (res.kind === 'mega') {
        notifySuccess();
        jackpotFanfare();
        burstConfetti(180, theme.confetti);
        rainCoins(40, rainSrc);
        setShake(true);
        setCelebration({ tier: 'mega', amount: res.total });
      } else if (res.kind === 'big') {
        notifySuccess();
        winChime('big');
        rainCoins(22, rainSrc);
        burstConfetti(70, theme.confetti);
        setCelebration({ tier: 'big', amount: res.total });
      } else if (res.kind === 'small') {
        tapLight();
        winChime('small');
      }
      if (res.levelUps.length) {
        const lvl = res.levelUps[res.levelUps.length - 1];
        setLevelUp({ level: lvl, ...levelReward(lvl) });
      }
    },
    [theme.confetti, rainSrc],
  );

  useEffect(() => {
    if (!levelUp) return undefined;
    coinDing(0.1);
    const t = setTimeout(() => setLevelUp(null), 6000);
    return () => clearTimeout(t);
  }, [levelUp]);

  useEffect(() => {
    if (!celebration) return undefined;
    const ticks = setInterval(() => counterTick(), 70);
    const stop = setTimeout(() => clearInterval(ticks), 1500);
    const hide = setTimeout(() => setCelebration(null), 4200);
    return () => {
      clearInterval(ticks);
      clearTimeout(stop);
      clearTimeout(hide);
    };
  }, [celebration]);

  const startDust = useCallback((wins: ScatterWin[]) => {
    const host = boardRef.current;
    const canvas = dustRef.current;
    if (!host || !canvas || reduceMotion()) return;
    const base = host.getBoundingClientRect();
    const cells: DustCell[] = [];
    for (const w of wins) {
      for (const [c, r] of w.cells) {
        const img = host.querySelector<HTMLImageElement>(`[data-cell="${c}-${r}"] img`);
        if (!img) continue;
        const rect = img.getBoundingClientRect();
        cells.push({ img, x: rect.left - base.left, y: rect.top - base.top, size: rect.width });
      }
    }
    dustStop.current?.();
    dustStop.current = dustBurst(canvas, cells);
  }, []);

  const stepRef = useRef<(res: ScatterSpinOutcome, i: number) => void>(() => {});

  const runStep = useCallback(
    (res: ScatterSpinOutcome, i: number) => {
      const step = res.steps[i];
      const scale = turbo ? 0.55 : 1;
      const show = SHOW_MS * scale;
      const burst = BURST_MS * scale;
      const drop = DROP_MS * scale;
      const stagger = DROP_STAGGER * scale;
      const chainN = i + 1;
      const t = tierOf(chainN);

      setCascade({ step: i, phase: 'show' });
      setBoard(gridToBoard(step.grid, `${res.steps.length}-${i}-g`));
      setStepWins(step.wins);
      setStepCombo(step.combo);
      setChain(chainN);
      setRunWin((w) => w + step.payout);
      setPending((p) => Math.max(0, p - step.payout));

      comboHit(chainN);
      if (t === 0) tapLight();
      else if (t === 1) selectionChanged();
      else if (t === 2) {
        tapMedium();
        burstConfetti(28, theme.confetti);
      } else {
        notifySuccess();
        burstConfetti(t >= 4 ? 90 : 55, theme.confetti);
        rainCoins(t >= 4 ? 22 : 12, rainSrc);
        setShake(true);
      }

      timers.current.push(
        setTimeout(() => {
          setCascade({ step: i, phase: 'burst' });
          symbolBurst();
          startDust(step.wins);
        }, show),
      );

      timers.current.push(
        setTimeout(() => {
          setDropDur(drop);
          setBoard(collapseBoard(step, `${res.steps.length}-${i}`));
          setCascade({ step: i, phase: 'drop' });
          setStepWins([]);
        }, show + burst),
      );

      timers.current.push(
        setTimeout(
          () => {
            if (i + 1 < res.steps.length) stepRef.current(res, i + 1);
            else {
              setCascade(null);
              setChain(0);
              setStrips(res.steps[i].next.map((col) => [...col]));
              finish(res);
            }
          },
          show + burst + drop + stagger * (SCATTER_COLS - 1) + 80,
        ),
      );
    },
    [turbo, theme.confetti, rainSrc, finish, startDust],
  );
  stepRef.current = runStep;

  const spin = useCallback(() => {
    if (!hydrated || spinning || (freeSpins <= 0 && balance < bet)) return;
    primeAudio();
    const res = playScatter();
    if (!res) return;
    tapMedium();
    leverPull();

    const scale = turbo ? 0.5 : 1;
    const durs = res.grid.map((_, i) => (BASE_MS + i * STEP_MS) * scale);
    setStrips(res.grid.map((col) => makeStrip(col)));
    setDurations(durs);
    setBoard(null);
    dustStop.current?.();
    setResult(null);
    setShake(false);
    setCelebration(null);
    setCascade(null);
    setStepWins([]);
    setChain(0);
    setRunWin(0);
    setPending(res.total);
    setSpinId((n) => n + 1);
    setSpinning(true);

    if (tickRef.current) clearInterval(tickRef.current);
    if (!reduceMotion()) tickRef.current = setInterval(() => reelTick(), turbo ? 55 : 80);

    timers.current.push(
      setTimeout(
        () => {
          if (tickRef.current) clearInterval(tickRef.current);
          if (res.steps.length) stepRef.current(res, 0);
          else finish(res);
        },
        durs[durs.length - 1] + 60,
      ),
    );
  }, [hydrated, spinning, balance, bet, freeSpins, playScatter, turbo, finish]);

  // Автоспин
  useEffect(() => {
    if (auto <= 0 || spinning) return;
    if (freeSpins <= 0 && balance < bet) {
      setAuto(0);
      notifyWarning();
      return;
    }
    const t = setTimeout(
      () => {
        setAuto((n) => n - 1);
        spin();
      },
      celebration ? 3200 : 620,
    );
    return () => clearTimeout(t);
  }, [auto, spinning, balance, bet, freeSpins, spin, celebration]);

  const stopAuto = () => {
    tapLight();
    setAuto(0);
  };

  const takeRescue = () => {
    primeAudio();
    if (!claimRescue()) return;
    tapMedium();
    coinDing();
    winChime('small');
    rainCoins(14, rainSrc);
    notifySuccess();
  };

  const label = result ? scatterLabel(result) : null;

  return (
    <Screen
      title="Каскад"
      subtitle={`Поле ${SCATTER_COLS}×${SCATTER_ROWS} · ${CLUSTER_MIN} одинаковых где угодно`}
      className={`slots-screen slots-screen--${skin}`}
      action={
        <button
          className="icon-btn"
          onClick={() => {
            tapLight();
            setRules(true);
          }}
          aria-label="Правила и выплаты"
        >
          <IconInfo size={21} />
        </button>
      }
    >
      <div className="stack slots scatter" data-skin={skin}>
        <div className="slots-scene" aria-hidden="true">
          <span className="slots-scene__decor" />
        </div>

        <div className="slot-hud">
          <div className="slot-hud__cell">
            <span className="slot-hud__label">Баланс</span>
            <span className="slot-hud__value">
              <AnimatedNumber value={shownBalance} format={(n) => fmt(n)} duration={450} />
              <CoinIcon size={18} />
            </span>
          </div>
          <div className="slot-hud__cell">
            <span className="slot-hud__label">Лучший спин</span>
            <span className="slot-hud__value">
              <AnimatedNumber value={best} format={(n) => fmt(n)} duration={450} />
              <CoinIcon size={18} />
            </span>
          </div>
        </div>

        <button className="slot-level" onClick={() => nav('/slots')}>
          <span className="slot-level__lvl">Ур. {level.level}</span>
          <span className="slot-level__bar">
            <i style={{ width: `${Math.min(100, (level.into / level.need) * 100)}%` }} />
          </span>
          {freeSpins > 0 && <span className="slot-level__free">🎟 {freeSpins}</span>}
          <span className="slot-level__gift">
            <IconGift size={17} />
          </span>
        </button>

        <div className={`cabinet cabinet--wide${shake ? ' is-shake' : ''}`} onAnimationEnd={() => setShake(false)}>
          <div className="cabinet__bulbs" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.09}s` }} />
            ))}
          </div>
          <div className="cabinet__sign cabinet__sign--wide">
            <span>{theme.sign[0]}</span>
            <b>CASCADE</b>
          </div>
          <div className="cabinet__window">
            <div className="sboard" ref={boardRef}>
              {board
                ? board.map((col, c) => (
                    <div className="sboard__col" key={c}>
                      {col.map((cell) => (
                        <span
                          key={cell.key}
                          className={`sbcell${cell.fall ? ' is-fall' : ''}${
                            dying.has(`${c}-${cell.row}`) ? ' is-dust' : ''
                          }${winCells.has(`${c}-${cell.row}`) ? ' is-win' : ''}${
                            shownWins.length && !winCells.has(`${c}-${cell.row}`) ? ' is-dim' : ''
                          }`}
                          style={
                            {
                              top: `${cell.row * SCELL}px`,
                              '--dy': cell.fall,
                              '--dur': `${dropDur}ms`,
                              '--delay': `${c * DROP_STAGGER}ms`,
                              '--wi': winOrder.get(`${c}-${cell.row}`) ?? 0,
                            } as React.CSSProperties
                          }
                          data-cell={`${c}-${cell.row}`}
                        >
                          <Sym id={cell.id} skin={skin} />
                        </span>
                      ))}
                    </div>
                  ))
                : strips.map((strip, i) => (
                    <SpinCol
                      key={i}
                      strip={strip}
                      skin={skin}
                      spinId={spinId}
                      duration={durations[i]}
                      onStop={() => {
                        reelStop(i);
                        if (i === SCATTER_COLS - 1) selectionChanged();
                      }}
                    />
                  ))}
              <canvas className="dust" ref={dustRef} aria-hidden="true" />
              <div className="reels__glass" aria-hidden="true" />
              {cascade && cascade.phase !== 'drop' && stepCombo > 1 && (
                <div className={`stamp stamp--t${tier}`} key={`st-${chain}`} aria-hidden="true">
                  ×{stepCombo}
                </div>
              )}
            </div>
            {chain >= 1 && cascade && (
              <div className={`combo combo--t${tier}`} key={chain}>
                <b>{chain >= 2 ? `ЦЕПОЧКА ×${chain}` : 'ЕСТЬ ВЫИГРЫШ'}</b>
                {stepCombo > 1 && <i>выплата ×{stepCombo}</i>}
              </div>
            )}
          </div>

          {/* Что именно сыграло: символ, сколько его на поле и сколько платит.
              Линий здесь нет, поэтому объясняем выигрыш словами и числами. */}
          {shownWins.length > 0 && (
            <div className="hits" key={`h-${chain}`}>
              {shownWins.map((w) => (
                <span className="hit" key={w.symbol}>
                  <Sym id={w.symbol} skin={skin} size={22} />
                  <b>×{w.count}</b>
                  <i>
                    +{fmt(w.pay * bet * stepCombo)}
                    <CoinIcon size={13} />
                  </i>
                </span>
              ))}
            </div>
          )}

          <div className="cabinet__status">
            {cascade ? (
              <>
                <span className={`status status--combo status--t${tier}`}>
                  {chain >= 2 ? `Цепочка ×${chain}!` : 'Есть выигрыш!'}
                </span>
                <span className="status__win">
                  +<AnimatedNumber value={runWin} format={(n) => fmt(n)} duration={400} />
                  <CoinIcon size={20} />
                </span>
              </>
            ) : spinning ? (
              <span className="status status--spin">Крутится…</span>
            ) : result && label ? (
              <>
                <span className="status">
                  {label.symbol && <Sym id={label.symbol} skin={skin} size={22} />}
                  {label.text}
                </span>
                {result.total > 0 && (
                  <span className="status__win">
                    +<AnimatedNumber value={result.total} format={(n) => fmt(n)} duration={700} />
                    <CoinIcon size={20} />
                  </span>
                )}
              </>
            ) : (
              <span className="status status--hint">Соберите {CLUSTER_MIN} одинаковых</span>
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
          <button
            className={`slot-bet slot-bet--more${BETS.includes(bet) ? '' : ' is-active'}`}
            disabled={spinning}
            onClick={() => {
              tapLight();
              setBetDraft(bet);
              setBetSheet(true);
            }}
            aria-label="Своя ставка"
          >
            {BETS.includes(bet) ? '⋯' : fmt(bet)}
          </button>
        </div>

        <div className="slot-actions">
          <button
            className={`spin-btn${spinning ? ' is-busy' : ''}`}
            disabled={!canSpin && auto === 0}
            onClick={() => (auto > 0 ? stopAuto() : spin())}
          >
            {auto > 0
              ? auto === Infinity
                ? 'Стоп · ∞'
                : `Стоп (${auto})`
              : cascade
                ? chain >= 2
                  ? `Цепочка ×${chain}…`
                  : 'Каскад…'
                : spinning
                  ? 'Крутится…'
                  : broke
                    ? 'Монеты кончились'
                    : freeSpins > 0
                      ? `Бесплатно · ${freeSpins}`
                      : `Крутить · ${fmt(bet)}`}
          </button>
          <button
            className={`slot-mini${auto > 0 ? ' is-on' : ''}`}
            disabled={!canSpin && auto === 0}
            onClick={() => {
              tapLight();
              primeAudio();
              if (auto > 0) stopAuto();
              else setAutoSheet(true);
            }}
            aria-label={auto > 0 ? 'Остановить автоспин' : 'Автоспин'}
          >
            {auto > 0 ? (auto === Infinity ? '↻∞' : `↻${auto}`) : '↻'}
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
            className="slot-mini"
            onClick={() => {
              tapLight();
              primeAudio();
              setSettings(true);
            }}
            aria-label="Настройки"
          >
            ⚙
          </button>
        </div>

        {broke && (
          <button className="btn btn--block rewards-cta" onClick={takeRescue}>
            🍀 Спасательные вращения · 10
          </button>
        )}

        <div className="slot-stats">
          <div className="slot-stat">
            <div className="slot-stat__num">{fmt(spins)}</div>
            <div className="slot-stat__lbl">вращений</div>
          </div>
          <div className="slot-stat">
            <div className="slot-stat__num">×{SCATTER_LADDER[SCATTER_LADDER.length - 1]}</div>
            <div className="slot-stat__lbl">максимум цепочки</div>
          </div>
        </div>
      </div>

      {rules && (
        <Sheet title="Как это работает" onClose={() => setRules(false)}>
          <div className="stack slots" data-skin={skin}>
            <div className="combo-rules">
              <div className="combo-rules__title">Восемь одинаковых где угодно</div>
              <p className="combo-rules__text">
                Линий нет: считается, сколько одинаковых символов оказалось на всём поле
                {' '}{SCATTER_COLS}×{SCATTER_ROWS}. От {CLUSTER_MIN} штук — выигрыш, неважно, где они
                стоят. Символы исчезают, верхние падают на их места, поле считается заново, и общий
                множитель растёт:
              </p>
              <div className="combo-rules__ladder">
                {SCATTER_LADDER.map((m, i) => (
                  <span key={i} className="combo-rules__step">
                    <b>{i + 1 === SCATTER_LADDER.length ? `${i + 1}+` : i + 1}</b>
                    <i>×{m}</i>
                  </span>
                ))}
              </div>
            </div>
            <div className="paytable">
              {[...SCATTER_PAYS].reverse().map((p) => (
                <div className="paytable__row" key={p.id}>
                  <span className="paytable__syms">
                    <Sym id={p.id} skin={skin} size={26} />
                  </span>
                  <span className="paytable__mult">×{p.tiers[2]}</span>
                  <span className="paytable__pair">
                    8–9 ×{p.tiers[0]} · 10–11 ×{p.tiers[1]}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Множители считаются от всей ставки. Кошелёк, уровень и цели дня общие со «Слотами».
              Отдача — около 92%, символы берёт тот же честный ГСЧ.
            </p>
          </div>
        </Sheet>
      )}

      {autoSheet && (
        <Sheet title="Автоспин" onClose={() => setAutoSheet(false)}>
          <div className="stack slots" data-skin={skin}>
            <div className="auto-grid">
              {AUTO_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  className={`auto-card${o.value === Infinity ? ' is-endless' : ''}`}
                  onClick={() => {
                    selectionChanged();
                    primeAudio();
                    setAutoSheet(false);
                    setAuto(o.value);
                  }}
                >
                  <span className="auto-card__num">{o.label}</span>
                  <span className="auto-card__hint">{o.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {betSheet && (
        <Sheet title="Своя ставка" onClose={() => setBetSheet(false)}>
          <div className="stack slots bet-sheet" data-skin={skin}>
            <div className="bet-sheet__value">
              {fmt(betDraft)}
              <CoinIcon size={26} />
            </div>
            <div className="bet-sheet__row">
              <button
                className="bet-step"
                onClick={() => {
                  selectionChanged();
                  setBetDraft((v) => clampBet(v - BET_STEP));
                }}
                aria-label="Меньше"
              >
                −
              </button>
              <input
                className="bet-slider"
                type="range"
                min={MIN_BET}
                max={MAX_BET}
                step={BET_STEP}
                value={betDraft}
                onChange={(e) => setBetDraft(clampBet(Number(e.target.value)))}
              />
              <button
                className="bet-step"
                onClick={() => {
                  selectionChanged();
                  setBetDraft((v) => clampBet(v + BET_STEP));
                }}
                aria-label="Больше"
              >
                +
              </button>
            </div>
            <button
              className="btn btn--block rewards-cta"
              disabled={betDraft > balance && freeSpins <= 0}
              onClick={() => {
                tapMedium();
                setBet(betDraft);
                setBetSheet(false);
              }}
            >
              {betDraft > balance && freeSpins <= 0 ? 'Не хватает монет' : `Играть по ${fmt(betDraft)}`}
            </button>
          </div>
        </Sheet>
      )}

      {settings && (
        <Sheet title="Настройки" onClose={() => setSettings(false)}>
          <div className="stack slots" data-skin={skin}>
            <div className="toggles">
              {[
                { key: 'sound' as const, on: sound, icon: sound ? '🔊' : '🔇', name: 'Звук', hint: 'Барабаны, цепочки и выигрыши' },
                { key: 'haptics' as const, on: haptics, icon: haptics ? '📳' : '📴', name: 'Вибрация', hint: 'Отклик на остановку и выигрыш' },
                { key: 'turbo' as const, on: turbo, icon: '⚡', name: 'Турбо', hint: 'Вращения и каскады вдвое быстрее' },
              ].map((t) => (
                <button
                  key={t.key}
                  className={`toggle${t.on ? ' is-on' : ''}`}
                  onClick={() => {
                    primeAudio();
                    if (t.key === 'haptics' && !t.on) setHapticsMuted(false);
                    selectionChanged();
                    setPrefs({ [t.key]: !t.on });
                  }}
                  aria-pressed={t.on}
                >
                  <span className="toggle__icon">{t.icon}</span>
                  <span className="toggle__text">
                    <b>{t.name}</b>
                    <i>{t.hint}</i>
                  </span>
                  <span className="toggle__switch" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        </Sheet>
      )}

      {levelUp && (
        <div className="levelup" data-skin={skin} onClick={() => setLevelUp(null)} role="presentation">
          <div className="levelup__card">
            <div className="levelup__lvl">Уровень {levelUp.level}</div>
            <div className="levelup__gain">
              +{fmt(levelUp.coins)}
              <CoinIcon size={18} />
              {levelUp.freeSpins > 0 && <span> · 🎟 {levelUp.freeSpins}</span>}
            </div>
          </div>
        </div>
      )}

      {celebration && (
        <div
          className={`totem totem--${celebration.tier}`}
          onClick={() => setCelebration(null)}
          role="presentation"
        >
          <div className="totem__flash" />
          <div className="totem__glow" />
          <div className="totem__sparks" aria-hidden="true">
            {Array.from({ length: 46 }, (_, i) => {
              const angle = (i / 46) * 360 + (i % 3) * 7;
              return (
                <i
                  key={i}
                  className={i % 3 === 0 ? 'is-gold' : ''}
                  style={
                    {
                      '--a': `${angle}deg`,
                      '--d': `${120 + ((i * 37) % 130)}px`,
                      '--s': `${5 + ((i * 17) % 7)}px`,
                      animationDelay: `${((i * 53) % 360) / 1000}s`,
                      animationDuration: `${900 + ((i * 71) % 500)}ms`,
                    } as React.CSSProperties
                  }
                />
              );
            })}
          </div>
          <div className="totem__item">
            <Sym id={theme.preview} skin={skin} size={140} />
          </div>
          <div className="totem__card">
            <div className="totem__title">
              {celebration.tier === 'mega' ? 'МЕГА-ЦЕПОЧКА!' : 'БОЛЬШОЙ ВЫИГРЫШ'}
            </div>
            <div className="totem__amount">
              <AnimatedNumber value={celebration.amount} format={(n) => fmt(n)} duration={1400} />
              <CoinIcon size={30} />
            </div>
            <div className="totem__hint">нажмите, чтобы продолжить</div>
          </div>
        </div>
      )}
    </Screen>
  );
}
