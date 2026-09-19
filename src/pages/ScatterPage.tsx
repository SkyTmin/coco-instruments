import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { IconGift, IconInfo } from '@/components/icons';
import { CashDesk } from '@/components/CashDesk';
import { SkinSheet } from '@/components/SkinSheet';
import { RewardsSheet, useReadyRewards } from '@/components/RewardsSheet';
import { useFinanceStore } from '@/store';
import type { ScatterSpinOutcome } from '@/store';
import {
  ANTE_COST,
  BUY_BONUS_COST,
  CLUSTER_MIN,
  FREE_SPINS,
  SCATTER_COLS,
  SCATTER_PAYOUTS,
  SCATTER_PAYS,
  SCATTER_ROWS,
  SCATTER_TRIGGER,
  scatterLabel,
  scatterSymbol,
} from '@/lib/scatter';
import type { Orb, ScatterCell, ScatterGrid, ScatterStep, ScatterWin } from '@/lib/scatter';
import { BET_STEP, BETS, clampBet, MAX_BET, MIN_BET } from '@/lib/slots';
import { levelFromXp, levelReward } from '@/lib/slots-meta';
import { loudestTier, multRarity, ORB_TIERS, orbTier } from '@/lib/orb-rarity';
import {
  addTrauma,
  flashFrame,
  HIT_STOP,
  hitStop,
  squashPop,
  stopShake,
  TRAUMA,
} from '@/lib/juice';
import { dustBurst } from '@/lib/dust';
import type { DustCell } from '@/lib/dust';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import {
  anticipation as antiSound,
  coinDing,
  comboHit,
  counterTick,
  jackpotFanfare,
  leverPull,
  multSlam,
  multTick,
  orbDrop,
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

/** Общая «никто не тянет» — константа, чтобы не плодить массивы каждый спин. */
const EMPTY_ANTI: boolean[] = Array(SCATTER_COLS).fill(false);

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Рывок тотема в случайный угол — в игре смещение берётся как четверть
 * экрана в каждую сторону со случайным знаком.
 */
function dart(): { ox: number; oy: number } {
  const w = typeof window === 'undefined' ? 360 : window.innerWidth;
  const h = typeof window === 'undefined' ? 640 : window.innerHeight;
  return {
    ox: Math.round((Math.random() * 2 - 1) * (w / 4)),
    oy: Math.round((Math.random() * 2 - 1) * (h / 4)),
  };
}

/** Ступень эффектов по длине цепочки. */
function tierOf(chain: number): number {
  if (chain >= 5) return 4;
  if (chain >= 4) return 3;
  if (chain >= 3) return 2;
  if (chain >= 2) return 1;
  return 0;
}

function Sym({ id, skin, size = 40 }: { id: ScatterCell; skin: SkinId; size?: number }) {
  return (
    <img
      className="sym"
      src={symbolSrc(skin, id)}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Поле. Вне каскада колонки крутятся лентой, в каскаде — это сетка, где
// исчезают ровно сыгравшие клетки, а верхние съезжают на их места.
// ---------------------------------------------------------------------------

interface BoardCell {
  key: string;
  id: ScatterCell;
  row: number;
  fall: number;
}
type Board = BoardCell[][];

function gridToBoard(grid: ScatterGrid, tag: string): Board {
  return grid.map((col, c) =>
    col.map((id, row) => ({ key: `${tag}-${c}-${row}`, id, row, fall: 0 })),
  );
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
function makeStrip(to: ScatterCell[]): ScatterCell[] {
  return [...Array.from({ length: FILLER }, () => scatterSymbol()), ...to];
}

interface SpinColProps {
  strip: ScatterCell[];
  skin: SkinId;
  spinId: number;
  duration: number;
  /** Колонка решает судьбу бонуса: тянет время и светится. */
  anticipate: boolean;
  onStop: () => void;
}

/** Колонка перерисовывается только при новой ленте — см. `Reel` в «Слотах». */
const SpinCol = memo(
  function SpinCol({ strip, skin, spinId, duration, anticipate, onStop }: SpinColProps) {
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
      <div className={`sboard__col${anticipate ? ' is-anticipate' : ''}`}>
        <div className="sboard__strip" ref={ref}>
          {/* Ключ — позиция в ленте, а не символ: элементы переиспользуются,
            меняется только src (см. тот же приём в «Слотах»). */}
          {strip.map((id, i) => (
            <span className="sbcell sbcell--flow" key={i}>
              <Sym id={id} skin={skin} />
            </span>
          ))}
        </div>
      </div>
    );
  },
  (a, b) =>
    a.strip === b.strip &&
    a.skin === b.skin &&
    a.spinId === b.spinId &&
    a.duration === b.duration &&
    a.anticipate === b.anticipate,
);

export function ScatterPage() {
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
  const buyBonus = useFinanceStore((s) => s.buyScatterBonus);
  const ante = useFinanceStore((s) => s.scatterAnte);
  const setAnte = useFinanceStore((s) => s.setScatterAnte);
  const fs = useFinanceStore((s) => s.scatterFs);
  const claimRescue = useFinanceStore((s) => s.claimSlotsRescue);

  const [strips, setStrips] = useState<ScatterCell[][]>(() =>
    Array.from({ length: SCATTER_COLS }, () =>
      Array.from({ length: SCATTER_ROWS }, () => scatterSymbol()),
    ),
  );
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [durations, setDurations] = useState<number[]>(() =>
    Array.from({ length: SCATTER_COLS }, (_, i) => BASE_MS + i * STEP_MS),
  );
  /** Какие колонки тянут время: на поле уже три скаттера из четырёх. */
  const [anti, setAnti] = useState<boolean[]>(EMPTY_ANTI);
  const [board, setBoard] = useState<Board | null>(null);
  const [dropDur, setDropDur] = useState(DROP_MS);
  const [cascade, setCascade] = useState<{
    step: number;
    phase: 'show' | 'collect' | 'burst' | 'drop';
  } | null>(null);
  /** Сумма сфер, которую счётчик показывает прямо сейчас (тикает вверх). */
  const [collectSum, setCollectSum] = useState(0);
  /** Множитель «припечатался» к выплате — короткая вспышка на счётчике. */
  const [collectDone, setCollectDone] = useState(false);
  const [stepWins, setStepWins] = useState<ScatterWin[]>([]);
  const [stepOrbs, setStepOrbs] = useState<Orb[]>([]);
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
  const [skinSheet, setSkinSheet] = useState(false);
  const [rewards, setRewards] = useState(false);
  // Тикает раз в полминуты — только чтобы счётчик наград на кнопке не залипал.
  const [now, setNow] = useState(() => Date.now());
  // ox/oy — тот самый рывок тотема в случайный угол. Выбирается один раз при
  // показе: если считать его в разметке, он бы менялся на каждой перерисовке.
  const [celebration, setCelebration] = useState<{
    tier: string;
    amount: number;
    ox: number;
    oy: number;
  } | null>(null);
  const [levelUp, setLevelUp] = useState<{
    level: number;
    coins: number;
    freeSpins: number;
  } | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  /** Корпус автомата — его и трясёт, а не всю страницу. */
  const cabinetRef = useRef<HTMLDivElement>(null);
  /** Счётчик выигрыша: его толкает удар множителя. */
  const winRef = useRef<HTMLSpanElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);
  const dustStop = useRef<(() => void) | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const collectRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (tickRef.current) clearInterval(tickRef.current);
      if (collectRef.current) clearInterval(collectRef.current);
      dustStop.current?.();
      stopShake();
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

  // Счётчик наград на кнопке уровня: без этого «колесо готово» появлялось бы
  // только после перезахода на страницу.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const level = levelFromXp(xp);
  // Прогрессия общая с «Слотами» — считаем её тем же хуком, что и там.
  const readyCount = useReadyRewards(now);
  const theme = skinOf(skin);
  const rainSrc = symbolSrc(skin, theme.rain);
  const inBonus = !!fs && fs.left > 0;
  // Ante дороже на четверть; в бонусе вращения бесплатные.
  const stake = inBonus || freeSpins > 0 ? 0 : Math.round(bet * (ante ? ANTE_COST : 1));
  const buyCost = Math.round(bet * BUY_BONUS_COST);
  const broke = balance < MIN_BET && freeSpins <= 0 && !inBonus;
  const canSpin = hydrated && !spinning && balance >= stake;
  const tier = tierOf(chain);
  const marking =
    cascade?.phase === 'show' || cascade?.phase === 'collect' || cascade?.phase === 'burst';
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
      // Напряжение снято — гасим подсветку тянущих колонок.
      setAnti(EMPTY_ANTI);
      // Порядок такта важен: сначала всё замирает, потом вспышка, и только
      // за ней взрыв. Пауза читается как удар, вспышка прячет склейку — и
      // три эффекта сливаются в одно событие вместо трёх подряд.
      const payoff = (tier: 'small' | 'big' | 'mega', after: () => void) => {
        hitStop(cabinetRef.current, HIT_STOP[tier]);
        timers.current.push(
          setTimeout(() => {
            flashFrame(tier);
            addTrauma(cabinetRef.current, TRAUMA[tier]);
            after();
          }, HIT_STOP[tier]),
        );
      };

      if (res.kind === 'mega') {
        notifySuccess();
        payoff('mega', () => {
          jackpotFanfare();
          burstConfetti(180, theme.confetti);
          rainCoins(40, rainSrc);
          setCelebration({ tier: 'mega', amount: res.total, ...dart() });
        });
      } else if (res.kind === 'big') {
        notifySuccess();
        payoff('big', () => {
          winChime('big');
          rainCoins(22, rainSrc);
          burstConfetti(70, theme.confetti);
          setCelebration({ tier: 'big', amount: res.total, ...dart() });
        });
      } else if (res.kind === 'small') {
        tapLight();
        winChime('small');
        flashFrame('small');
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

      // Самая редкая сфера звена задаёт, насколько громко его праздновать.
      const loudest = loudestTier(step.orbs.map((o) => o.value));

      // Такт сбора: сферы слетаются в счётчик, сумма тикает вверх, множитель
      // бьёт по выплате. Нужен только когда есть что умножать — иначе звено
      // не удлиняется ни на миллисекунду.
      const target = res.fs ? Math.max(1, step.totalMult) : step.orbMult;
      const collecting = step.orbs.length > 0 && target > 1;
      // Легендарная и выше получают лишнюю паузу перед вспышкой. Тишина —
      // тоже такт: без неё находка читается как уведомление, а не как событие.
      const hold = loudest.beats >= 3 ? (turbo ? 260 : 520) : 0;
      const collect = collecting ? (turbo ? 460 : 820) + hold : 0;
      // Арифметику показываем в два приёма: сначала база, потом множитель
      // врезается в число и оно пересчитывается. Пока выплата приходила одним
      // готовым числом, бонус существовал только внутри выражения — игрок
      // видел итог и не видел, что его на что-то умножили.
      // Базу берём делением, а добавку — вычитанием из настоящей выплаты:
      // сумма двух тактов тогда точно равна step.payout, без расхождений.
      const baseWin = collecting ? Math.round(step.payout / target) : step.payout;

      setCascade({ step: i, phase: 'show' });
      setBoard(gridToBoard(step.grid, `${res.steps.length}-${i}-g`));
      setStepWins(step.wins);
      setStepOrbs(step.orbs);
      setStepCombo(res.fs ? Math.max(1, step.totalMult) : Math.max(1, step.orbMult));
      setChain(chainN);
      setRunWin((w) => w + baseWin);
      setPending((p) => Math.max(0, p - step.payout));
      // Если собирать нечего (в бонусе множитель уже накоплен, а новых сфер
      // не выпало), множитель считается показанным сразу — иначе строка
      // «что сыграло» осталась бы на базе, а счётчик ушёл бы на итог.
      setCollectDone(!collecting);

      comboHit(chainN);

      // Сферы звучат той же волной, какой появляются: от дешёвой к дорогой,
      // по 90 мс на шаг. Редкая находка слышна раньше, чем прочитано число.
      [...step.orbs]
        .sort((a, b) => a.value - b.value)
        .forEach((o, k) => orbDrop(orbTier(o.value).beats, k * 0.09));
      if (loudest.beats >= 3) notifySuccess();
      else if (loudest.beats === 2) tapMedium();
      else if (loudest.beats === 1) selectionChanged();

      if (t === 0) tapLight();
      else if (t === 1) selectionChanged();
      else if (t === 2) {
        tapMedium();
        burstConfetti(28, theme.confetti);
      } else {
        notifySuccess();
        burstConfetti(t >= 4 ? 90 : 55, theme.confetti);
        rainCoins(t >= 4 ? 22 : 12, rainSrc);
        // Травма копится: длинная цепочка трясёт всё сильнее звено за звеном.
        addTrauma(cabinetRef.current, t >= 4 ? TRAUMA.big : TRAUMA.small);
        if (t >= 4) flashFrame('small');
      }

      if (collecting) {
        timers.current.push(
          setTimeout(() => {
            setCascade({ step: i, phase: 'collect' });
            setCollectSum(res.fs ? Math.max(1, step.totalMult - step.orbMult) : 0);
            // Счёт занимает 60% такта, остаток — пауза на «припечатывание».
            const count = collect * 0.6;
            const from = res.fs ? Math.max(1, step.totalMult - step.orbMult) : 0;
            const started = performance.now();
            if (collectRef.current) clearInterval(collectRef.current);
            collectRef.current = setInterval(() => {
              const k = Math.min(1, (performance.now() - started) / count);
              setCollectSum(Math.round(from + (target - from) * k));
              multTick(k);
              if (k >= 1 && collectRef.current) {
                clearInterval(collectRef.current);
                collectRef.current = null;
                setCollectDone(true);
                multSlam();
                // Второй такт арифметики: множитель ударил — выплата растёт
                // на глазах с базы до настоящей. Это тот самый кадр, в
                // котором видно, что бонус сработал.
                setRunWin((w) => w + (step.payout - baseWin));
                // Счётчик получает толчок в тот же кадр: число не просто
                // меняется, а отскакивает от удара.
                squashPop(winRef.current, 0.6);
                if (loudest.beats >= 2) tapMedium();
              }
            }, 55);
          }, show),
        );
      }

      timers.current.push(
        setTimeout(() => {
          // Сбрасывать «множитель показан» здесь нельзя: строка «что сыграло»
          // видна и в этой фазе и мигнула бы обратно на базу. Сбрасывает его
          // начало следующего звена.
          setCascade({ step: i, phase: 'burst' });
          symbolBurst();
          startDust(step.wins);
        }, show + collect),
      );

      timers.current.push(
        setTimeout(
          () => {
            setDropDur(drop);
            setBoard(collapseBoard(step, `${res.steps.length}-${i}`));
            setCascade({ step: i, phase: 'drop' });
            setStepWins([]);
            setStepOrbs([]);
          },
          show + collect + burst,
        ),
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
          show + collect + burst + drop + stagger * (SCATTER_COLS - 1) + 80,
        ),
      );
    },
    [turbo, theme.confetti, rainSrc, finish, startDust],
  );
  stepRef.current = runStep;

  const spin = useCallback(() => {
    if (!hydrated || spinning || balance < stake) return;
    primeAudio();
    const res = playScatter();
    if (!res) return;
    tapMedium();
    leverPull();

    const scale = turbo ? 0.5 : 1;
    // Предвкушение: как только на уже вставших колонках набралось три
    // скаттера, каждая следующая тянется заметно дольше — до бонуса не
    // хватает ровно одного, и это надо дать прожить. Приём из Олимпа и
    // Sweet Bonanza; без него четвёртый скаттер просто «случается».
    const durs: number[] = [];
    const antiCols: boolean[] = [];
    let seen = 0;
    let extra = 0;
    for (let c = 0; c < SCATTER_COLS; c++) {
      const tense = seen >= SCATTER_TRIGGER - 1;
      if (tense) extra += turbo ? 620 : 1150;
      antiCols.push(tense);
      durs.push((BASE_MS + c * STEP_MS) * scale + extra);
      seen += res.grid[c].filter((id) => id === 'scatter').length;
    }
    setStrips(res.grid.map((col) => makeStrip(col)));
    setDurations(durs);
    setAnti(antiCols);
    // Нарастающий вой начинается ровно тогда, когда тормозит колонка.
    antiCols.forEach((on, c) => {
      if (!on) return;
      timers.current.push(
        setTimeout(
          () => {
            antiSound();
            tapLight();
          },
          c === 0 ? 0 : durs[c - 1],
        ),
      );
    });
    setBoard(null);
    dustStop.current?.();
    setResult(null);
    stopShake();
    setCelebration(null);
    setCascade(null);
    setStepWins([]);
    setStepOrbs([]);
    setChain(0);
    setRunWin(0);
    setCollectSum(0);
    setCollectDone(false);
    if (collectRef.current) clearInterval(collectRef.current);
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
  }, [hydrated, spinning, balance, stake, playScatter, turbo, finish]);

  // Бонус крутится сам: вращения бесплатные, ждать нажатия незачем.
  useEffect(() => {
    if (!inBonus || spinning || celebration) return;
    const t = setTimeout(() => spin(), 700);
    return () => clearTimeout(t);
  }, [inBonus, spinning, celebration, spin]);

  // Автоспин
  useEffect(() => {
    if (auto <= 0 || spinning || inBonus) return;
    if (balance < stake) {
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
  }, [auto, spinning, balance, stake, inBonus, spin, celebration]);

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
    setNow(Date.now());
  };

  const openRewards = () => {
    tapLight();
    primeAudio();
    setRewards(true);
  };

  const label = result ? scatterLabel(result) : null;

  return (
    <Screen
      title="Каскад"
      subtitle={`Поле ${SCATTER_COLS}×${SCATTER_ROWS} · ${CLUSTER_MIN} одинаковых где угодно`}
      className={`slots-screen slots-screen--${skin}`}
      action={
        <div className="row" style={{ gap: 8 }}>
          <button
            className="icon-btn icon-btn--skin"
            onClick={() => {
              tapLight();
              setSkinSheet(true);
            }}
            aria-label="Сменить скин"
          >
            <Sym id={skinOf(skin).preview} skin={skin} size={22} />
          </button>
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
        </div>
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

        <button className="slot-level" onClick={openRewards}>
          <span className="slot-level__lvl">Ур. {level.level}</span>
          <span className="slot-level__bar">
            <i style={{ width: `${Math.min(100, (level.into / level.need) * 100)}%` }} />
          </span>
          {freeSpins > 0 && (
            <span className="slot-level__free" title="Бесплатные вращения">
              🎟 {freeSpins}
            </span>
          )}
          <span className="slot-level__gift">
            <IconGift size={17} />
            {readyCount > 0 && <span className="slot-level__badge">{readyCount}</span>}
          </span>
        </button>

        {inBonus && fs && (
          <div className="bonus-bar">
            <span className="bonus-bar__label">БОНУС</span>
            <span className="bonus-bar__left">осталось {fs.left}</span>
            <span className="bonus-bar__mult">×{Math.max(1, fs.totalMult)}</span>
            <span className="bonus-bar__won">
              {fmt(fs.won)}
              <CoinIcon size={13} />
            </span>
          </div>
        )}

        {/* Трясёт корпус автомата, а не всю страницу: внутри Telegram дёрганье
            всего экрана читается как баг вебвью, а не как удар. */}
        <div className={`cabinet cabinet--wide${inBonus ? ' is-bonus' : ''}`} ref={cabinetRef}>
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
                            cell.id === 'scatter' ? ' is-scatter' : ''
                          }${
                            shownWins.length &&
                            !winCells.has(`${c}-${cell.row}`) &&
                            cell.id !== 'scatter'
                              ? ' is-dim'
                              : ''
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
                      anticipate={anti[i] ?? false}
                      onStop={() => {
                        reelStop(i);
                        if (i === SCATTER_COLS - 1) selectionChanged();
                      }}
                    />
                  ))}
              {shownWins.length > 0 && <div className="sboard__dim" aria-hidden="true" />}
              {/* Сферы-множители: лежат поверх символов и складываются.
                  Появляются волной от дешёвой к дорогой — так самая редкая
                  падает последней, на пике внимания, а не теряется в куче. */}
              {[...stepOrbs]
                .sort((a, b) => a.value - b.value)
                .map((o, i) => {
                  const t = orbTier(o.value);
                  return (
                    <span
                      className={`orb orb--${t.id}${
                        cascade?.phase === 'collect' ? ' is-collect' : ''
                      }`}
                      key={`${o.col}-${o.row}-${o.value}`}
                      style={
                        {
                          left: `calc(${o.col} * (100% / ${SCATTER_COLS}))`,
                          top: `${o.row * SCELL}px`,
                          '--i': i,
                          // Куда лететь при сборе: в центр поля. Считаем в
                          // собственных клетках, чтобы не мерить DOM.
                          '--fx': (SCATTER_COLS - 1) / 2 - o.col,
                          '--fy': `${((SCATTER_ROWS - 1) / 2 - o.row) * SCELL}px`,
                        } as React.CSSProperties
                      }
                    >
                      {t.beats >= 1 && <i className="orb__shock" aria-hidden="true" />}
                      {t.beats >= 2 && <i className="orb__ring" aria-hidden="true" />}×{o.value}
                      {t.beats >= 2 && <b className="orb__tag">{t.name}</b>}
                    </span>
                  );
                })}
              <canvas className="dust" ref={dustRef} aria-hidden="true" />
              <div className="reels__glass" aria-hidden="true" />
              {/* Счётчик множителя. В такте сбора он же принимает слетающиеся
                  сферы и отсчитывает сумму вслух — именно здесь видно, что
                  бонус сработал, а не просто «где-то посчиталось». */}
              {cascade && cascade.phase !== 'drop' && (stepCombo > 1 || collectSum > 0) && (
                <div
                  className={`stamp stamp--t${tier} stamp--${multRarity(stepCombo)}${
                    cascade.phase === 'collect' ? ' is-collect' : ''
                  }${collectDone ? ' is-slam' : ''}`}
                  key={`st-${chain}`}
                  aria-hidden="true"
                >
                  ×{cascade.phase === 'collect' ? collectSum : stepCombo}
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
                  {/* До удара множителя показываем базу, после — итог. Иначе
                      строка проговаривала результат раньше, чем счётчик его
                      посчитал, и множитель выглядел ни на что не влияющим. */}
                  <i>
                    +{fmt(w.pay * bet * (collectDone ? stepCombo : 1))}
                    <CoinIcon size={13} />
                  </i>
                  {stepCombo > 1 && collectDone && <u className="hit__mult">×{stepCombo}</u>}
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
                <span className="status__win" ref={winRef}>
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
                  : inBonus && fs
                    ? `Бонус · ${fs.left}`
                    : broke
                      ? 'Монеты кончились'
                      : freeSpins > 0
                        ? `Бесплатно · ${freeSpins}`
                        : `Крутить · ${fmt(stake)}`}
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

        {/* Ставка Ante и покупка бонуса — оба пути к фриспинам */}
        {!inBonus && (
          <div className="bonus-row">
            <button
              className={`ante${ante ? ' is-on' : ''}`}
              disabled={spinning}
              onClick={() => {
                selectionChanged();
                setAnte(!ante);
              }}
              aria-pressed={ante}
            >
              <b>Ante</b>
              <i>ставка ×{ANTE_COST} — бонус чаще</i>
              <span className="toggle__switch" aria-hidden="true" />
            </button>
            <button
              className="buy-bonus"
              disabled={spinning || balance < buyCost}
              onClick={() => {
                if (!buyBonus()) return;
                tapMedium();
                primeAudio();
                jackpotFanfare();
                burstConfetti(80, theme.confetti);
              }}
            >
              <b>Купить бонус</b>
              <i>
                {fmt(buyCost)}
                <CoinIcon size={13} />
              </i>
            </button>
          </div>
        )}

        <div className="slot-stats">
          <div className="slot-stat">
            <div className="slot-stat__num">{fmt(spins)}</div>
            <div className="slot-stat__lbl">вращений</div>
          </div>
          <div className="slot-stat">
            <div className="slot-stat__num">{fmt(best)}</div>
            <div className="slot-stat__lbl">лучший спин</div>
          </div>
        </div>
      </div>

      {rules && (
        <Sheet title="Как это работает" onClose={() => setRules(false)}>
          <div className="stack slots" data-skin={skin}>
            <div className="combo-rules">
              <div className="combo-rules__title">Восемь одинаковых где угодно</div>
              <p className="combo-rules__text">
                Линий нет: считается, сколько одинаковых символов оказалось на всём поле{' '}
                {SCATTER_COLS}×{SCATTER_ROWS}. От {CLUSTER_MIN} штук — выигрыш, неважно, где они
                стоят. Сыгравшие исчезают, верхние падают на их места, поле считается заново — и
                так, пока выпадают выигрыши.
              </p>
            </div>
            <div className="combo-rules">
              <div className="combo-rules__title">Сферы-множители</div>
              <p className="combo-rules__text">
                На поле случайно падают сферы с числом от ×2 до ×500. Если это звено сыграло, все
                сферы складываются и умножают выплату. Сферы не участвуют в сборе восьмёрок — они
                только множат.
              </p>
              <p className="combo-rules__text">
                Чем крупнее номинал, тем реже сфера и тем громче она приходит: у каждой ступени свой
                цвет, свой звук и своя отдача. Проценты — доля ступени среди всех выпавших сфер.
              </p>
              <div className="rarity-ladder">
                {ORB_TIERS.map((t) => (
                  <div className={`rarity-row rarity-row--${t.id}`} key={t.id}>
                    <i className="rarity-row__dot" aria-hidden="true" />
                    <b className="rarity-row__name">{t.name}</b>
                    <span className="rarity-row__range">
                      {t.id === 'mythic' ? '×250 — ×500' : `от ×${t.min}`}
                    </span>
                    <span className="rarity-row__odds">{t.chance}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="combo-rules">
              <div className="combo-rules__title">Скаттер и бонус</div>
              <p className="combo-rules__text">
                {SCATTER_TRIGGER} и больше скаттеров где угодно платят ×{SCATTER_PAYOUTS[4]} / ×
                {SCATTER_PAYOUTS[5]} / ×{SCATTER_PAYOUTS[6]} ставки и дают {FREE_SPINS} бесплатных
                вращений. В бонусе сферы не сгорают: их значения копятся в общий множитель, который
                держится до конца бонуса. Три скаттера внутри бонуса добавляют ещё вращения.
              </p>
              <div className="combo-rules__ladder">
                <span className="combo-rules__step">
                  <b>{SCATTER_TRIGGER}</b>
                  <i>×{SCATTER_PAYOUTS[4]}</i>
                </span>
                <span className="combo-rules__step">
                  <b>5</b>
                  <i>×{SCATTER_PAYOUTS[5]}</i>
                </span>
                <span className="combo-rules__step">
                  <b>6</b>
                  <i>×{SCATTER_PAYOUTS[6]}</i>
                </span>
              </div>
            </div>
            <div className="combo-rules">
              <div className="combo-rules__title">Ante и покупка</div>
              <p className="combo-rules__text">
                Ante поднимает ставку в {ANTE_COST} раза и делает бонус примерно вдвое чаще — это
                выбор стиля, а не бесплатный плюс: отдача при нём чуть ниже. Покупка бонуса стоит{' '}
                {BUY_BONUS_COST} ставок и сразу запускает {FREE_SPINS} вращений.
              </p>
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
              {betDraft > balance && freeSpins <= 0
                ? 'Не хватает монет'
                : `Играть по ${fmt(betDraft)}`}
            </button>
          </div>
        </Sheet>
      )}

      {settings && (
        <Sheet title="Настройки" onClose={() => setSettings(false)}>
          <div className="stack slots" data-skin={skin}>
            <div className="toggles">
              {[
                {
                  key: 'sound' as const,
                  on: sound,
                  icon: sound ? '🔊' : '🔇',
                  name: 'Звук',
                  hint: 'Барабаны, цепочки и выигрыши',
                },
                {
                  key: 'haptics' as const,
                  on: haptics,
                  icon: haptics ? '📳' : '📴',
                  name: 'Вибрация',
                  hint: 'Отклик на остановку и выигрыш',
                },
                {
                  key: 'turbo' as const,
                  on: turbo,
                  icon: '⚡',
                  name: 'Турбо',
                  hint: 'Вращения и каскады вдвое быстрее',
                },
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
            <CashDesk />
          </div>
        </Sheet>
      )}

      {skinSheet && <SkinSheet onClose={() => setSkinSheet(false)} />}

      {rewards && (
        <RewardsSheet
          skin={skin}
          onClose={() => {
            setRewards(false);
            setNow(Date.now());
          }}
        />
      )}

      {levelUp && (
        <div
          className="levelup"
          data-skin={skin}
          onClick={() => setLevelUp(null)}
          role="presentation"
        >
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
          style={
            { '--ox': `${celebration.ox}px`, '--oy': `${celebration.oy}px` } as React.CSSProperties
          }
          onClick={() => setCelebration(null)}
          role="presentation"
        >
          <div className="totem__flash" />
          <div className="totem__glow" />
          {/* Лучи — только у мега-выигрыша: если крутить их каждый раз,
              они перестают что-либо значить. */}
          {celebration.tier === 'mega' && <div className="totem__rays" aria-hidden="true" />}
          <div className="totem__sparks" aria-hidden="true">
            {Array.from({ length: 46 }, (_, i) => {
              const angle = (i / 46) * 360 + (i % 3) * 7;
              return (
                <i
                  key={i}
                  /* Четверть частиц золотые, три четверти зелёные — как в
                     самой игре: там цвет выбирается random.nextInt(4) == 0. */
                  className={i % 4 === 0 ? 'is-gold' : ''}
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
