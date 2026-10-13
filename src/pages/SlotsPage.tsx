import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAction } from '@/input/hooks';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatedNumber } from '@/components/ui';
import { useNavigate } from 'react-router-dom';
import { GameScreen } from '@/game-shell/GameScreen';
import { GameTop, GxSheet, KIcon } from '@/components/gx';
import { Bar } from '@/ui-px';
import {
  CasAutoPicker,
  CasBetPicker,
  CasDeck,
  CasStat,
  CasToggles,
  fitStyles,
  CasRound,
  CasTools,
  keepDot,
  KitIcon,
  SKIP_GUARD_MS,
  SKIP_TEMPO,
  useCasLayout,
  useCasLying,
  useFit,
  useReelSpin,
} from './casino-ui';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon, SlotArtDefs } from '@/components/slot-art';
import { skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { CashDesk } from '@/components/CashDesk';
import { SkinSheet } from '@/components/SkinSheet';
import { useFinanceStore } from '@/store';
import { useExit } from '@/lib/use-exit';
import { useGameAudio } from '@/lib/use-game-audio';
import type { SlotsSpinOutcome } from '@/store';
import { levelFromXp, levelReward } from '@/lib/slots-meta';
import { fmtCompact, fmtNum, lineIn, lineName, skinText, t, useT, winStepName } from '@/i18n';
import {
  BET_STEP,
  BETS,
  clampBet,
  COMBO_LADDER,
  hasAnticipation,
  LINE_UNIT,
  lineBet,
  MAX_BET,
  MIN_BET,
  outcomeLabel,
  PAYLINES,
  randomSymbol,
  ROWS,
  SLOT_SYMBOLS,
  symbolOf,
} from '@/lib/slots';
import type { CascadeStep, LineWin, SlotGrid, SlotSymbolId, SpinResult } from '@/lib/slots';
import { plainPlan, rollupPlan, runRollup, winTier } from '@/lib/rollup';
import { planReel, restReel } from '@/lib/reel-motion';
import type { ReelPlan } from '@/lib/reel-motion';
import type { WinTier } from '@/lib/rollup';
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
  payoutEnd,
  primeAudio,
  reelStop,
  reelSpin,
  rollupTick,
  symbolBurst,
  tierBreak,
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

// Высота ячейки барабана — та же величина в CSS (--cell): лента двигается на
// целое число ячеек, поэтому символы всегда встают ровно в окно.
const CELL = 74;
const BASE_MS = 900;
const STEP_MS = 280;
/** Пауза перед последним барабаном, когда на линии уже два премиума. */
const ANTICIPATION_MS = 900;
/** Варианты автоспина. Infinity — крутить, пока не кончатся монеты. */
const AUTO_OPTIONS: { value: number; label: string; hint: 'h10' | 'h25' | 'h50' | 'hInf' }[] = [
  { value: 10, label: '10', hint: 'h10' },
  { value: 25, label: '25', hint: 'h25' },
  { value: 50, label: '50', hint: 'h50' },
  { value: Infinity, label: '∞', hint: 'hInf' },
];
/** Каскад: подсветить выигрыш → рассыпать символы в пыль → уронить верхние. */
const SHOW_MS = 700;
const BURST_MS = 320;
const DROP_MS = 430;
/** Сдвиг падения по колонкам — столбцы приземляются не разом. */
const DROP_STAGGER = 70;

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const fmt = fmtNum;

/** Подпись результата на языке игрока (`outcomeLabel` в lib — по-русски, для тестов). */
function outcomeText(result: SpinResult): string {
  if (result.kind === 'none') return t('slots.outcome.miss');
  if (result.kind === 'jackpot') return t('slots.outcome.jackpot');
  if (result.wins.length > 1) return t('slots.outcome.lines', { n: result.wins.length });
  const best = [...result.wins].sort((x, y) => y.payout - x.payout)[0];
  const line = lineIn(PAYLINES[best.line].id);
  return best.count === 3 ? t('slots.outcome.three', { line }) : t('slots.outcome.pair', { line });
}

const randomColumn = () => Array.from({ length: ROWS }, () => randomSymbol());

const startGrid = (): SlotGrid => [randomColumn(), randomColumn(), randomColumn()];

/** Темп вращения в турбо: фазы вдвое короче, ровный ход чуть быстрее. */
const TURBO_TEMPO = 0.5;
const TURBO_SPEEDUP = 1.2;

/**
 * Одна ячейка поля во время каскада. Поле здесь не лента, а сетка: исчезают
 * ровно сыгравшие символы, остальные съезжают вниз в освободившиеся места —
 * именно это и читается как «каскад», а не как новое вращение.
 */
interface BoardCell {
  key: string;
  id: SlotSymbolId;
  /** Ряд, в котором ячейка стоит после падения. */
  row: number;
  /** На сколько ячеек она падает (0 — стоит на месте). */
  fall: number;
}

type Board = BoardCell[][];

/** Неподвижное поле: всё уже на местах. */
function gridToBoard(grid: SlotGrid, tag: string): Board {
  return grid.map((col, c) =>
    col.map((id, row) => ({ key: `${tag}-${c}-${row}`, id, row, fall: 0 })),
  );
}

/**
 * Поле после схлопывания. Для каждой колонки: уцелевшие символы съезжают вниз
 * ровно на число исчезнувших под ними, а сверху досыпаются новые — они падают
 * из-за верхнего края.
 */
function collapseBoard(step: CascadeStep, tag: string): Board {
  const dead = new Set(step.wins.flatMap((w) => w.cells.map(([c, r]) => `${c}:${r}`)));
  return step.grid.map((col, c) => {
    const survivors: BoardCell[] = [];
    col.forEach((id, row) => {
      if (dead.has(`${c}:${row}`)) return;
      survivors.push({ key: `${tag}-s-${c}-${row}`, id, row, fall: 0 });
    });
    const gone = ROWS - survivors.length;
    const cells: BoardCell[] = survivors.map((cell, i) => {
      const row = gone + i;
      return { ...cell, row, fall: row - cell.row };
    });
    // Новые символы берём из уже посчитанного поля — они стоят сверху.
    for (let row = 0; row < gone; row++) {
      cells.unshift({ key: `${tag}-n-${c}-${row}`, id: step.next[c][row], row, fall: gone });
    }
    return cells.sort((a, b) => a.row - b.row);
  });
}

/** Ступень эффектов по длине цепочки — чем длиннее комбо, тем громче праздник. */
function comboTier(chain: number): number {
  if (chain >= 5) return 4;
  if (chain >= 4) return 3;
  if (chain >= 3) return 2;
  if (chain >= 2) return 1;
  return 0;
}

/** Символ выбранного скина. Картинка одна и та же на любом телефоне. */
function Sym({ id, skin, size = 58 }: { id: SlotSymbolId; skin: SkinId; size?: number }) {
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

/** Барабан: лента едет вверх, символы приходят снизу. */
interface ReelProps {
  /** План вращения (lib/reel-motion.ts): лента, кадры, моменты размытия и удара. */
  plan: ReelPlan<SlotSymbolId>;
  skin: SkinId;
  spinId: number;
  onStop: () => void;
  /** Растёт по «Пропустить»: лента встаёт сразу (useReelSpin). */
  slam: number;
}

/**
 * Барабан живёт своей жизнью: пока лента та же, перерисовывать его незачем.
 * Во время каскада страница обновляется десятки раз (счётчики, комбо, монеты),
 * и без memo каждое такое обновление заново сверяло бы сотню картинок.
 * `onStop` в сравнении не участвует — он и так читается через ref.
 */
const Reel = memo(
  function Reel({ plan, skin, spinId, onStop, slam }: ReelProps) {
    const ref = useRef<HTMLDivElement>(null);
    useReelSpin(ref, plan, spinId, onStop, slam);

    return (
      <div className="reel">
        <div className="reel__strip" ref={ref}>
          {/* Ключ — позиция в ленте, а не символ: так React переиспользует те же
            элементы и лишь меняет src, вместо того чтобы каждое вращение
            создавать и выбрасывать по сотне картинок. */}
          {plan.strip.map((id, i) => (
            <span className="reel__cell" key={i}>
              <Sym id={id} skin={skin} />
            </span>
          ))}
        </div>
      </div>
    );
  },
  (a, b) => a.plan === b.plan && a.skin === b.skin && a.spinId === b.spinId && a.slam === b.slam,
);

/**
 * Поле каскада. Каждая ячейка стоит на своём ряду и при необходимости
 * «прилетает» сверху: анимация стартует со смещения вверх на `--dy` ячеек.
 */
function BoardView({
  board,
  skin,
  dying,
  duration,
}: {
  board: Board;
  skin: SkinId;
  dying: Set<string>;
  duration: number;
}) {
  return (
    <div className="board">
      {board.map((col, c) => (
        <div className="board__col" key={c}>
          {col.map((cell) => {
            const doomed = dying.has(`${c}-${cell.row}`);
            return (
              <span
                key={cell.key}
                className={`bcell${cell.fall ? ' is-fall' : ''}${doomed ? ' is-dust' : ''}`}
                style={
                  {
                    top: `${cell.row * CELL}px`,
                    '--dy': cell.fall,
                    // Время падения ∝ √высоты — см. .sbcell.is-fall в theme.css.
                    '--fk': Math.sqrt(cell.fall / ROWS).toFixed(3),
                    '--dur': `${duration}ms`,
                    '--delay': `${c * DROP_STAGGER}ms`,
                  } as React.CSSProperties
                }
                data-cell={`${c}-${cell.row}`}
              >
                <Sym id={cell.id} skin={skin} />
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Баннер крупного выигрыша в духе тотема бессмертия из Minecraft: символ
 * вырастает в центре, качается и уходит вверх, а вокруг разлетаются
 * зелёно-золотые квадратные искры — там частицы тоже пиксельные.
 */
const SPARKS = Array.from({ length: 46 }, (_, i) => {
  const angle = (i / 46) * 360 + (i % 3) * 7;
  return {
    angle,
    dist: 120 + ((i * 37) % 130),
    delay: ((i * 53) % 360) / 1000,
    size: 5 + ((i * 17) % 7),
    gold: i % 3 === 0,
    dur: 900 + ((i * 71) % 500),
  };
});

/**
 * Прочерченные линии выплат поверх поля.
 *
 * Длину штриха задаём В ПИКСЕЛЯХ ЭКРАНА, по каждой линии. Раньше стоял
 * общий `stroke-dasharray: 200`, но при `vector-effect: non-scaling-stroke`
 * штрих меряется на экране, а не в единицах viewBox: V-образная линия длиной
 * ~350 px рисовалась на 200 и обрывалась — правое плечо не появлялось вовсе.
 * `pathLength` тут не спасает: с тем же non-scaling-stroke Chromium делит
 * штрих неверно. Поэтому считаем длину сами, до первой отрисовки.
 */
function PaylineOverlay({ wins }: { wins: SpinResult['wins'] }) {
  const ref = useRef<SVGSVGElement>(null);
  const x = (col: number) => ((col + 0.5) / 3) * 100;
  const y = (row: number) => ((row + 0.5) / 3) * 100;

  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    svg.querySelectorAll<SVGPolylineElement>('.payline').forEach((line, i) => {
      const cells = wins[i]?.cells ?? [];
      let len = 0;
      for (let k = 1; k < cells.length; k++) {
        const dx = ((x(cells[k][0]) - x(cells[k - 1][0])) / 100) * width;
        const dy = ((y(cells[k][1]) - y(cells[k - 1][1])) / 100) * height;
        len += Math.hypot(dx, dy);
      }
      const dash = `${Math.ceil(len) + 4}`;
      line.style.strokeDasharray = dash;
      line.style.strokeDashoffset = dash;
    });
  }, [wins]);

  if (!wins.length) return null;
  return (
    <svg
      className="paylines"
      ref={ref}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
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
  const tr = useT();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const bet = useFinanceStore((s) => s.slotsBet);
  const spins = useFinanceStore((s) => s.slotsSpins);
  const best = useFinanceStore((s) => s.slotsBest);
  const history = useFinanceStore((s) => s.slotsHistory);
  const jackpotPool = useFinanceStore((s) => s.slotsJackpot);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const sound = useFinanceStore((s) => s.slotsSound);
  const music = useFinanceStore((s) => s.slotsMusic);
  useGameAudio('slots', 'slots');
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const turbo = useFinanceStore((s) => s.slotsTurbo);
  const xp = useFinanceStore((s) => s.slotsXp);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const setBet = useFinanceStore((s) => s.setSlotsBet);
  const playSlots = useFinanceStore((s) => s.playSlots);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);

  const [plans, setPlans] = useState<ReelPlan<SlotSymbolId>[]>(() =>
    startGrid().map((col) => restReel(col, randomSymbol, CELL)),
  );
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [stopped, setStopped] = useState(3);
  // Поле каскада: не null — значит на экране сетка, а не крутящиеся ленты.
  const [board, setBoard] = useState<Board | null>(null);
  const [dropDur, setDropDur] = useState(DROP_MS);
  const [result, setResult] = useState<SlotsSpinOutcome | null>(null);
  // Каскад: какое звено сейчас на экране и в какой фазе.
  const [cascade, setCascade] = useState<{ step: number; phase: 'show' | 'burst' | 'drop' } | null>(
    null,
  );
  const [stepWins, setStepWins] = useState<LineWin[]>([]);
  const [stepCombo, setStepCombo] = useState(1);
  const [chain, setChain] = useState(0);
  /** Идёт подсчёт выплаты — см. lib/rollup.ts. */
  const [counting, setCounting] = useState(false);
  /** Ступень, которую счёт пробил последней: она даёт титул. */
  const [winStep, setWinStep] = useState<WinTier | null>(null);
  const [pending, setPending] = useState(0);
  const [auto, setAuto] = useState(0);
  const [autoSheet, setAutoSheet] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [skinSheet, setSkinSheet] = useState(false);
  const [settings, setSettings] = useState(false);
  const [betSheet, setBetSheet] = useState(false);
  const [betDraft, setBetDraft] = useState(BETS[0]);
  const [levelUp, setLevelUp] = useState<{
    level: number;
    coins: number;
    freeSpins: number;
    skin?: string;
  } | null>(null);
  // Оверлеи уходят, а не обрываются (lib/use-exit.ts): состояние уже null,
  // а разметка ещё доигрывает уход.
  const [lvlShown, lvlLeaving] = useExit(levelUp, 240);
  const [lever, setLever] = useState(0);
  const [streak, setStreak] = useState(0);
  const [celebration, setCelebration] = useState<{
    tier: 'big' | 'jackpot';
    amount: number;
  } | null>(null);
  const [totem, totemLeaving] = useExit(celebration, 300);
  const [jackpotWin, setJackpotWin] = useState(0);
  // «Пропустить» (кнопка «Крутить» во время спина): `slam` ставит ленты на место, `hurry` —
  // темп оставшихся звеньев и счёта, `reelsDone` — досрочный конец вращения.
  const [slam, setSlam] = useState(0);
  const [hurried, setHurried] = useState(false);
  const hurry = useRef(1);
  const skipAt = useRef(-1e9);
  const reelsDone = useRef<(() => void) | null>(null);

  const reelsRef = useRef<HTMLDivElement>(null);

  /**
   * Корпус автомата — его и трясёт (lib/juice.ts), как в «Каскаде». Раньше
   * здесь была CSS-тряска классом, и снимал её `onAnimationEnd` на корпусе —
   * а это событие всплывает от КАЖДОЙ дочерней анимации: первая же упавшая
   * клетка обрывала тряску посреди размаха, и корпус щёлкал на место.
   */
  const cabinetRef = useRef<HTMLDivElement>(null);
  // Рамка страницы (казино, волна 2): корпус вписывается в сцену целиком.
  const pageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fit = useFit(stageRef, cabinetRef);
  const fitCss = fitStyles(fit);
  const lay = useCasLayout();
  const lying = useCasLying();
  const nav = useNavigate();
  const goBack = () => {
    if (window.history.length > 1) nav(-1);
    else nav('/');
  }; /** Счётчик выигрыша: его толкает конец счёта. */
  const winRef = useRef<HTMLSpanElement>(null);
  /** Шток рычага: его дёргает и кнопка «Крутить», а не только палец. */
  const armRef = useRef<HTMLSpanElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);
  const dustStop = useRef<(() => void) | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Вращение звучит петлёй; интервал лишь подстраховывает старт, если
  // петля ещё грузилась в миг нажатия.
  const stopReelSound = () => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    reelSpin(false);
  };
  const startReelSound = (fast: boolean) => {
    reelSpin(true, fast);
    tickRef.current = setInterval(() => reelSpin(true, fast), 300);
  };
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Счётчики обновляются императивно: счёт идёт каждый кадр (см. MoneyCounter).
  const winOdo = useRef<MoneyHandle>(null);
  const totemOdo = useRef<MoneyHandle>(null);
  const balOdo = useRef<MoneyHandle>(null);
  /** Сколько монет счётчик показывает прямо сейчас — отсюда стартует счёт. */
  const wonRef = useRef(0);
  const rollStop = useRef<(() => void) | null>(null);
  const dragRef = useRef<{ y: number; id: number } | null>(null);
  const leverVal = useRef(0);
  /**
   * Что стоит на поле прямо сейчас. С этого начинается следующее вращение:
   * лента обязана стартовать с того, что игрок видит, иначе в первый кадр
   * спина всё поле подменяется другими символами.
   */
  const shownGrid = useRef<SlotGrid | null>(null);
  if (!shownGrid.current) shownGrid.current = plans.map((p) => p.strip.slice(1, 1 + ROWS));

  useEffect(() => setHapticsMuted(!haptics), [haptics]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      stopReelSound();
      rollStop.current?.();
      dustStop.current?.();
      stopShake();
    },
    [],
  );

  /**
   * Один удар: стоп-кадр → вспышка → тряска — тот же, что в «Каскаде».
   * Эффекты у обеих игр обязаны быть одними: иначе одна ощущается дешевле.
   */
  const beat = useCallback((level: 'small' | 'big' | 'mega', after?: () => void) => {
    hitStop(cabinetRef.current, HIT_STOP[level]);
    timers.current.push(
      setTimeout(() => {
        flashFrame(level);
        addTrauma(cabinetRef.current, TRAUMA[level]);
        after?.();
      }, HIT_STOP[level]),
    );
  }, []);

  // Ставка всегда по карману: если монет на текущую не хватает, опускаемся к
  // максимальной доступной — иначе кнопка «Крутить» мертва без объяснений.
  useEffect(() => {
    if (!hydrated || spinning || balance >= bet) return;
    // Сначала пробуем быструю ставку, иначе опускаемся к любой посильной —
    // с восемью монетами в кармане игрок всё ещё должен мочь крутить.
    const affordable = [...BETS].reverse().find((b) => b <= balance) ?? clampBet(balance);
    if (affordable <= balance && affordable !== bet) setBet(affordable);
  }, [hydrated, spinning, balance, bet, setBet]);

  // ---- прогрессия ----------------------------------------------------------
  // Уровень — только знак и скины (v2.66): денег за него больше нет.
  const level = levelFromXp(xp);
  const broke = balance < MIN_BET && freeSpins <= 0;
  const canSpin = hydrated && !spinning && (freeSpins > 0 || balance >= bet);
  // На табло — копилка плюс то, что заплатит сама линия семёрок.
  const jackpotPrize = jackpotPool + lineBet(bet) * symbolOf('seven').three;

  const theme = skinOf(skin);
  const rainSrc = symbolSrc(skin, theme.rain);

  /** Спин закончен окончательно — после того, как деньги досчитаны. */
  const finish = useCallback((res: SlotsSpinOutcome) => {
    stopReelSound();
    setCounting(false);
    setResult(res);
    setPending(0);
    setSpinning(false);
    setJackpotWin(res.jackpotWin);
    setStreak((n) => (res.total > 0 ? n + 1 : 0));
    // Новый уровень — отдельная плашка: награда уже начислена стором.
    if (res.levelUps.length) {
      const lvl = res.levelUps[res.levelUps.length - 1];
      setLevelUp({ level: lvl, ...levelReward(lvl) });
    }
  }, []);

  /**
   * Подсчёт выплаты — тот же ролл-ап, что и в «Каскаде» (см. lib/rollup.ts):
   * длительность от величины выигрыша, ступени с паузами, титул от пробитой
   * ступени. Счёт один на обе игры нарочно — деньги должны считаться
   * одинаково, иначе одна из игр ощущается дешевле другой.
   */
  const payout = useCallback(
    (res: SlotsSpinOutcome, from: number) => {
      const to = res.total;
      rollStop.current?.();
      // Крупный выигрыш считается С НУЛЯ, как в любом автомате: счёт — это
      // не «дописать остаток», а отдельная сцена, и она обязана пройти всю
      // лестницу целиком, от «ВЕРНУЛОСЬ» до своей вершины. Без этого в
      // «Слотах» торжественного счёта не было вовсе: там вся сумма уже
      // набежала за каскад, и дописывать было нечего.
      //
      // Сброс счётчика на ноль прячется вспышкой открывающего удара — тот
      // самый кадр-вспышка из juice.ts: всё, что меняется во время неё,
      // читается как ею вызванное.
      // Порог церемонии — «ХОРОШИЙ ВЫИГРЫШ» (10 ставок). Не 25: там, где
      // церемония начинается с «КРУПНОГО», в «Слотах» она выпадала бы раз в
      // 355 вращений, потому что звенья каскада дают ровно 100% итога и
      // дописывать после них нечего. На десятке это раз в шестьдесят — своя
      // редкость есть, но её успеваешь увидеть.
      const top = winTier(to / Math.max(1, bet));
      const ceremony = (top?.beats ?? 0) >= 1;
      const start = ceremony ? 0 : from;
      if (!(to > start)) {
        wonRef.current = to;
        winOdo.current?.set(to);
        finish(res);
        return;
      }
      const plan = rollupPlan(start, to, Math.max(1, bet));
      const speed = (turbo ? 0.55 : 1) * hurry.current;
      const topBeats = plan.top?.beats ?? 0;

      setCounting(true);
      setWinStep(null);
      wonRef.current = start;
      winOdo.current?.set(start);
      tapLight();
      // Церемония начинается с нуля — сброс счётчика прячет вспышка
      // открывающего удара. Мелкому выигрышу сбрасывать нечего, и вспышка
      // на каждом «ВЕРНУЛОСЬ» только обесценила бы её.
      if (ceremony) beat('small', () => winChime('small'));
      else winChime('small');

      // См. «Каскад»: при синхронном плане (reduce-motion) `done` проходит
      // до присваивания, и в `rollStop` осталась бы отработавшая функция.
      let live = true;
      const stop = runRollup(
        plan,
        {
          value: (n) => {
            wonRef.current = n;
            winOdo.current?.set(n);
            totemOdo.current?.set(n);
            // Баланс растёт в один ход с выигрышем.
            balOdo.current?.set(Math.max(0, balance - (to - n)));
          },
          tick: rollupTick,
          tier: (t) => {
            setWinStep(t);
            tierBreak(t.beats);
            if (t.beats >= 3) {
              notifySuccess();
              beat('mega', () => {
                burstConfetti(t.beats >= 4 ? 200 : 140, theme.confetti);
                rainCoins(t.beats >= 4 ? 44 : 30, rainSrc);
              });
            } else if (t.beats === 2) {
              notifySuccess();
              beat('big', () => {
                burstConfetti(70, theme.confetti);
                rainCoins(20, rainSrc);
              });
            } else if (t.beats === 1) {
              tapMedium();
              flashFrame('small');
              addTrauma(cabinetRef.current, TRAUMA.small);
            } else {
              selectionChanged();
            }
            // Со ступени «КРУПНЫЙ» сцену забирает баннер, и счёт продолжается
            // уже в нём — число не сбрасывается и не начинается заново.
            if (t.beats >= 2) {
              setCelebration(
                (c) =>
                  c ?? {
                    tier: res.kind === 'jackpot' || t.beats >= 3 ? 'jackpot' : 'big',
                    amount: to,
                  },
              );
            }
          },
          done: () => {
            live = false;
            rollStop.current = null;
            wonRef.current = to;
            balOdo.current?.set(balance);
            payoutEnd(topBeats);
            if (topBeats >= 3 || res.kind === 'jackpot') jackpotFanfare();
            squashPop(winRef.current, 0.5);
            finish(res);
          },
        },
        speed,
      );
      if (live) rollStop.current = stop;
    },
    [bet, turbo, balance, beat, finish, theme.confetti, rainSrc],
  );
  const payoutRef = useRef(payout);
  payoutRef.current = payout;

  /** Досчитать немедленно — по тапу. Длинный счёт обязан быть пропускаемым. */
  const skipCount = useCallback(() => {
    if (!rollStop.current) return false;
    tapLight();
    rollStop.current();
    return true;
  }, []);

  // Плашка уровня живёт 6 секунд — успеть прочитать, но не мешать игре.
  useEffect(() => {
    if (!levelUp) return undefined;
    coinDing(0.1);
    const t = setTimeout(() => setLevelUp(null), 6000);
    return () => clearTimeout(t);
  }, [levelUp]);

  /** Рассыпать сыгравшие ячейки в пыль (эффект удаления сообщения в Telegram). */
  const startDust = useCallback((wins: LineWin[]) => {
    const host = reelsRef.current;
    const canvas = dustRef.current;
    if (!host || !canvas || reduceMotion()) return;
    const base = host.getBoundingClientRect();
    const seen = new Set<string>();
    const cells: DustCell[] = [];
    for (const w of wins) {
      for (const [c, r] of w.cells) {
        const key = `${c}-${r}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const img = host.querySelector<HTMLImageElement>(`[data-cell="${key}"] img`);
        if (!img) continue;
        const rect = img.getBoundingClientRect();
        // Корпус масштабирован целиком (рамка казино): экранные точки делим
        // на масштаб, чтобы пыль легла в координаты канвы поля.
        const k = base.width / (host.offsetWidth || base.width) || 1;
        cells.push({
          img,
          x: (rect.left - base.left) / k,
          y: (rect.top - base.top) / k,
          size: rect.width / k,
        });
      }
    }
    dustStop.current?.();
    dustStop.current = dustBurst(canvas, cells);
  }, []);

  // Каскад по звеньям: показать выигрыш → взорвать символы → уронить новые.
  // Порядок и суммы уже посчитаны в lib/slots — страница только проигрывает.
  const stepRef = useRef<(res: SlotsSpinOutcome, i: number) => void>(() => {});

  const runStep = useCallback(
    (res: SlotsSpinOutcome, i: number) => {
      const step = res.steps[i];
      const scale = (turbo ? 0.55 : 1) * hurry.current;
      const show = SHOW_MS * scale;
      const burst = BURST_MS * scale;
      const drop = DROP_MS * scale;
      const stagger = DROP_STAGGER * scale;
      const chainN = i + 1;
      const tier = comboTier(chainN);

      setCascade({ step: i, phase: 'show' });
      // Поле пересобираем ТОЛЬКО на первом звене — дальше на экране уже стоит
      // результат прошлого схлопывания, и он в точности равен `step.grid`.
      // Пересборка меняла всем клеткам React-ключ, то есть уничтожала и
      // создавала заново каждый span с картинкой. См. тот же комментарий в
      // «Каскаде».
      if (i === 0) setBoard(gridToBoard(step.grid, `${res.steps.length}-0-g`));
      setStepWins(step.wins);
      setStepCombo(step.combo);
      setChain(chainN);
      // Выплата звена: короткий ровный ход без ступеней — у каскада свой
      // ритм, и паузы с титулами посреди него сбивали бы его.
      rollStop.current?.();
      const fromBase = wonRef.current;
      const toBase = fromBase + step.payout;
      // Даже у звена длина хода зависит от суммы: крупное звено считается
      // заметно дольше мелкого. Фиксированная длительность — та же ошибка,
      // что и в большом счёте, просто в миниатюре.
      const legMs = 240 + Math.min(900, ((toBase - fromBase) / Math.max(1, bet)) * 420);
      let legLive = true;
      const legStop = runRollup(
        plainPlan(fromBase, toBase, legMs),
        {
          value: (n) => {
            wonRef.current = n;
            winOdo.current?.set(n);
          },
          tick: rollupTick,
          done: () => {
            legLive = false;
            rollStop.current = null;
            wonRef.current = toBase;
          },
        },
        scale,
      );
      if (legLive) rollStop.current = legStop;
      setPending((p) => Math.max(0, p - step.payout));

      // Эффекты растут ступенями: звук выше, тряска и конфетти — только на длинных.
      comboHit(chainN);
      if (tier === 0) tapLight();
      else if (tier === 1) selectionChanged();
      else if (tier === 2) {
        tapMedium();
        burstConfetti(28, theme.confetti);
      } else {
        notifySuccess();
        burstConfetti(tier >= 4 ? 90 : 55, theme.confetti);
        rainCoins(tier >= 4 ? 22 : 12, rainSrc);
        // Травма копится: длинная цепочка трясёт всё сильнее звено за звеном.
        addTrauma(cabinetRef.current, tier >= 4 ? TRAUMA.big : TRAUMA.small);
        if (tier >= 4) flashFrame('small');
      }

      // Пыль: сыгравшие символы рассыпаются на пиксели (эффект как в Telegram).
      timers.current.push(
        setTimeout(() => {
          setCascade({ step: i, phase: 'burst' });
          symbolBurst();
          startDust(step.wins);
        }, show),
      );

      // Падение: уцелевшие съезжают вниз, сверху приходят новые.
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
              // Следующее вращение должно стартовать с того, что сейчас на поле.
              shownGrid.current = res.steps[i].next;
              // Каскад отыграл — дальше деньги, и счёт стартует ровно с той
              // суммы, которую счётчик показывает прямо сейчас.
              payoutRef.current(res, wonRef.current);
            }
          },
          show + burst + drop + stagger * 2 + 80,
        ),
      );
    },
    [turbo, bet, theme.confetti, rainSrc, startDust],
  );
  stepRef.current = runStep;

  /**
   * Рычаг дёргается и от кнопки, и от автоспина, и от пробела. Раньше он
   * стоял мёртвым всегда, кроме случая, когда его тянули пальцем, — и звук
   * `leverPull` звучал при неподвижном рычаге.
   */
  const pullLever = useCallback(() => {
    const el = armRef.current;
    if (!el || reduceMotion()) return;
    try {
      el.animate(
        [
          { transform: 'translateY(0)', easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)' },
          { transform: 'translateY(44px)', offset: 0.3, easing: 'cubic-bezier(0.3, 1.5, 0.5, 1)' },
          { transform: 'translateY(0)' },
        ],
        { duration: 560 * (turbo ? 0.7 : 1) },
      );
    } catch {
      /* движок без WAAPI — рычаг просто постоит */
    }
  }, [turbo]);

  const spin = useCallback(
    (byHand = false) => {
      if (!hydrated || spinning || (freeSpins <= 0 && balance < bet)) return;
      primeAudio();
      const res = playSlots();
      if (!res) return;
      tapMedium();
      leverPull();
      // Тянули пальцем — рычаг уже внизу и сам пружинит назад.
      if (!byHand) pullLever();

      // Драма «почти выиграл»: два премиума на линии — третий барабан тормозит.
      const drama = hasAnticipation(res.grid);
      const scale = turbo ? TURBO_TEMPO : 1;
      const durs = [0, 1, 2].map(
        (i) => (BASE_MS + i * STEP_MS + (drama && i === 2 ? ANTICIPATION_MS : 0)) * scale,
      );
      // Путь каждой ленты считается из её длительности, а скорость у всех одна:
      // последний барабан не медленнее первого, он просто дольше крутится.
      const from = shownGrid.current ?? startGrid();
      const next = res.grid.map((col, i) =>
        planReel({
          from: from[i]?.length === ROWS ? from[i] : randomColumn(),
          to: col,
          filler: randomSymbol,
          cell: CELL,
          duration: durs[i],
          tempo: scale,
          speedup: turbo ? TURBO_SPEEDUP : 1,
        }),
      );
      shownGrid.current = res.grid;

      setPlans(next);
      setBoard(null);
      dustStop.current?.();
      setStopped(0);
      setResult(null);
      stopShake();
      setCelebration(null);
      setJackpotWin(0);
      setPending(res.total);
      setCascade(null);
      setStepWins([]);
      setChain(0);
      setCounting(false);
      setWinStep(null);
      // Счётчик обнуляем и в рефе, и в самом одометре: от него стартует счёт.
      rollStop.current?.();
      rollStop.current = null;
      wonRef.current = 0;
      winOdo.current?.set(0);
      setSpinId((n) => n + 1);
      setSpinning(true);
      hurry.current = 1;
      setHurried(false);

      // Барабаны отъехали (или их остановил «Пропустить») — дальше каскад или деньги.
      const reelTimers: ReturnType<typeof setTimeout>[] = [];
      const afterReels = () => {
        reelsDone.current = null;
        reelTimers.forEach(clearTimeout);
        stopReelSound();
        if (res.steps.length) stepRef.current(res, 0);
        else payoutRef.current(res, 0);
      };
      // Пока барабаны в движении — дробный стрёкот механики.
      stopReelSound();
      if (!reduceMotion()) {
        startReelSound(turbo);
        if (drama) reelTimers.push(setTimeout(() => antiSound(), durs[1]));
      }
      reelTimers.push(setTimeout(afterReels, durs[2] + 40));
      timers.current.push(...reelTimers);
      reelsDone.current = afterReels;
    },
    [hydrated, spinning, balance, bet, freeSpins, playSlots, turbo, pullLever],
  );

  /**
   * «Пропустить» — та же кнопка «Крутить», пока спин идёт: исход уже решён, правила не
   * тронуты. Первое нажатие ставит барабаны на место сразу; следующие досчитывают текущий
   * ход, а оставшиеся звенья и счёт идут в темпе SKIP_TEMPO (обычный спин — как турбо).
   */
  const skip = useCallback(() => {
    if (!spinning) return;
    skipAt.current = performance.now();
    const land = reelsDone.current;
    if (land) {
      tapLight();
      setSlam((n) => n + 1);
      land();
      return;
    }
    hurry.current = SKIP_TEMPO;
    setHurried(true);
    if (!skipCount()) tapLight();
  }, [spinning, skipCount]);
  // Спин от игрока (кнопка, Space, «A»): тап сразу после «Пропустить» нового спина не начинает.
  const pressSpin = useCallback(() => {
    if (performance.now() - skipAt.current < SKIP_GUARD_MS) return;
    spin();
  }, [spin]);

  // Баннер крупного выигрыша живёт ~4 секунды: вспышка → лучи → счёт с тиканьем.
  useEffect(() => {
    // Пока идёт счёт, баннер не убираем и не торопим: в нём и происходит
    // самое интересное.
    if (!celebration || counting) return undefined;
    const ticks = setInterval(() => counterTick(), 70);
    const stopTicks = setTimeout(() => clearInterval(ticks), 1500);
    const hide = setTimeout(() => setCelebration(null), 4200);
    return () => {
      clearInterval(ticks);
      clearTimeout(stopTicks);
      clearTimeout(hide);
    };
  }, [celebration, counting]);

  // Автоспин: очередь вращений, прерывается кнопкой или нехваткой монет.
  useEffect(() => {
    if (auto <= 0 || spinning) return;
    // Бесконечный автоспин сам останавливается, когда крутить уже не на что.
    if (freeSpins <= 0 && balance < bet) {
      setAuto(0);
      notifyWarning();
      return;
    }
    // Во время большого выигрыша пауза длиннее — дать досмотреть празднование.
    const t = setTimeout(
      () => {
        setAuto((n) => n - 1);
        spin();
      },
      celebration ? 3200 : 700,
    );
    return () => clearTimeout(t);
  }, [auto, spinning, balance, bet, freeSpins, spin, celebration]);

  const onReelStop = (index: number) => {
    setStopped((n) => Math.max(n, index + 1));
    reelStop(index);
    selectionChanged();
  };

  const startAuto = (count: number) => {
    selectionChanged();
    primeAudio();
    setAutoSheet(false);
    setAuto(count);
  };

  const stopAuto = () => {
    tapLight();
    setAuto(0);
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
    leverVal.current = Math.max(0, Math.min(1, (e.clientY - d.y) / 72));
    setLever(leverVal.current);
  };
  const leverUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    // Решение — по рефу, а не внутри updater'а setState: побочный эффект
    // (целый спин) в updater'е React вправе вызвать дважды.
    const pulled = leverVal.current > 0.55;
    leverVal.current = 0;
    setLever(0);
    if (pulled) spin(true);
  };

  // Пробел/Enter и «A» геймпада — крутить (слой действий src/input). Кнопка в
  // фокусе жмётся сама: Enter — браузером, «A» — навигацией фокуса.
  useAction(
    'confirm',
    (e) => {
      const t = (e.native?.target ?? document.activeElement) as HTMLElement | null;
      if (t && ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return false;
      // Тот же путь, что у кнопки: стоп автоспина, «Пропустить» во время спина, иначе спин.
      if (auto > 0) stopAuto();
      else if (spinning) skip();
      else pressSpin();
      return true;
    },
    { scope: pageRef },
  );

  const shownBalance = Math.max(0, balance - pending);
  // Подсветка живёт только на фазе показа звена: после схлопывания этих
  // символов на поле уже нет, и рисовать по ним линии было бы враньём.
  const marking = cascade?.phase === 'show' || cascade?.phase === 'burst';
  const shownWins = marking ? stepWins : [];
  const winCells = new Set(shownWins.flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)));
  const bursting = cascade?.phase === 'burst';
  // Ячейки, которые прямо сейчас рассыпаются в пыль.
  const dyingCells = new Set(
    bursting ? stepWins.flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)) : [],
  );
  const tier = comboTier(chain);

  // Кнопки шапки (скины, правила, настройки). На лежачем телефоне ряда GameTop нет — он
  // съедал 62 из 390 px: те же кнопки и «Назад» стоят строкой наверху сводки (CasTools).
  const topRight = (
    <>
      <CasRound
        className="cas-skin-btn"
        onClick={() => {
          tapLight();
          setSkinSheet(true);
        }}
        aria-label={tr('slots.a11y.skin')}
        data-tip={tr('slots.a11y.skin')}
        data-act="skin"
      >
        <Sym id={skinOf(skin).preview} skin={skin} size={22} />
      </CasRound>
      <CasRound
        onClick={() => {
          tapLight();
          setSheet(true);
        }}
        aria-label={tr('slots.a11y.rules')}
        data-tip={tr('slots.a11y.rules')}
      >
        <KIcon name="information" />
      </CasRound>
      <CasRound
        onClick={() => {
          tapLight();
          primeAudio();
          setSettings(true);
        }}
        aria-label={tr('common.settings')}
        data-tip={tr('common.settings')}
        data-act="settings"
      >
        <KIcon name="gear" />
      </CasRound>
    </>
  );

  return (
    <GameScreen
      className="gx cas-page"
      bg={
        <div className="slots cas-bg cas-ground pxt-stone" data-skin={skin}>
          {/* Сцена темы: фон и декор за всем содержимым страницы */}
          <div className="slots-scene" aria-hidden="true">
            <span className="slots-scene__decor" />
          </div>
        </div>
      }
      top={
        lying ? undefined : (
          <GameTop title={skinText(skin, 'title')} onBack={goBack} right={topRight} />
        )
      }
    >
      {/* --speed уезжает во ВСЕ CSS-анимации страницы. Без него турбо сжимал
          только паузы на таймерах, а жетон, титул ступени, счётчик и рамки
          выигрыша шли в полную длину и обрывались на середине следующим
          звеном. 0.55 — та же доля, что и у таймеров этой страницы
          (`scale` в runStep и `speed` в выплате), иначе CSS и JS разъедутся. */}
      <div
        className="slots cas cas--slots"
        data-skin={skin}
        ref={pageRef}
        data-lay={lay}
        style={
          { '--speed': (turbo ? 0.55 : 1) * (hurried ? SKIP_TEMPO : 1) } as React.CSSProperties
        }
      >
        <SlotArtDefs />
        {/* Сводка: уровень, джекпот, спины, лучший выигрыш, последние спины.
            Все ячейки фиксированной высоты — числа меняются, рамки стоят. */}
        <section className="cas-info px">
          {lying && <CasTools onBack={goBack}>{topRight}</CasTools>}
          {/* Полоса уровня. Наград за уровень больше нет — только знак и скины. */}
          <div className="cas-lvl">
            <b className="cas-lvl__n px-num">{tr('slots.hud.lvl', { n: level.level })}</b>
            <Bar value={level.into / level.need} />
            <span
              className={`cas-lvl__free px-num${freeSpins > 0 ? '' : ' is-none'}`}
              data-tip={tr('slots.hud.free')}
              aria-label={tr('slots.hud.free')}
            >
              🎟 {freeSpins}
            </span>
          </div>
          <CasStat
            fit
            className="cas-stat--jp"
            tone="gold"
            icon={
              <span className="cas-777">
                <Sym id="seven" skin={skin} size={18} />
              </span>
            }
            value={
              <>
                {/* Рекорды и копилка — не крутящийся баланс: им хватает короткой
                    записи («1,2 млн»), точное число — в подсказке. */}
                <AnimatedNumber value={jackpotPrize} format={(n) => fmtCompact(n)} duration={600} />
                <CoinIcon size={16} />
              </>
            }
            label={tr('slots.hud.jackpot')}
            tip={`${tr('slots.hud.jackpot')}: ${fmt(jackpotPrize)}`}
          />
          <CasStat
            fit
            className="cas-stat--sp"
            icon={<KitIcon name="play" />}
            value={fmt(spins)}
            label={tr('slots.statSpins')}
          />
          <CasStat
            fit
            className="cas-stat--best"
            icon={<KitIcon name="star" />}
            value={
              <>
                {fmtCompact(best)}
                <CoinIcon size={16} />
              </>
            }
            label={tr('slots.statBestWin')}
            tip={`${tr('slots.statBestWin')}: ${fmt(best)}`}
          />
          {/* Ряд последних спинов стоит всегда: появись он после первого
              спина — поле над ним уехало бы. */}
          <div className="cas-hist">
            <i className="cas-cap">{tr('slots.recent')}</i>
            {broke ? (
              <p className="cas-broke">{tr('slots.brokeHint')}</p>
            ) : (
              <div className="cas-hist__row">
                {history.length === 0 &&
                  [0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="cas-hchip is-empty" aria-hidden />
                  ))}
                {history.map((h) => (
                  <div key={h.id} className={`cas-hchip cas-well${h.payout > 0 ? ' is-win' : ''}`}>
                    <span className="cas-hchip__reels">
                      {h.reels.map((id, i) => (
                        <Sym key={i} id={id} skin={skin} size={17} />
                      ))}
                    </span>
                    <span className="cas-hchip__sum px-num">
                      {h.payout > 0 ? `+${fmt(h.payout)}` : `−${fmt(h.bet)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Сцена: корпус автомата рисуется в прежних пикселях и целиком
            масштабируется под место (лента барабана ездит в тех же пикселях). */}
        <div className="cas-stage" ref={stageRef}>
          <div className="cas-fit" style={fitCss.wrap}>
            {/* Корпус автомата */}
            <div
              className={`cabinet${result?.kind === 'jackpot' ? ' is-jackpot' : ''}${
                spinning ? ' is-spinning' : ''
              }`}
              ref={cabinetRef}
              style={fitCss.item}
              // Тап по автомату досчитывает выплату: длинный счёт обязан быть
              // пропускаемым, иначе награда превращается в ожидание.
              onClick={() => skipCount()}
              role="presentation"
            >
              <div className="cabinet__bulbs" aria-hidden="true">
                {Array.from({ length: 14 }, (_, i) => (
                  <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />
                ))}
              </div>

              <div className="cabinet__sign">
                <span>{skinOf(skin).sign[0]}</span>
                <b>{skinOf(skin).sign[1]}</b>
              </div>

              <div className="cabinet__body">
                <div className="cabinet__window">
                  <span className="cabinet__bolts" aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <div className="reels" ref={reelsRef}>
                    {/* Вращение рисуют ленты, каскад — сетка: в каскаде исчезают
                        ровно сыгравшие ячейки, а верхние съезжают в их места. */}
                    {board ? (
                      <BoardView board={board} skin={skin} dying={dyingCells} duration={dropDur} />
                    ) : (
                      plans.map((plan, i) => (
                        <Reel
                          key={i}
                          plan={plan}
                          skin={skin}
                          spinId={spinId}
                          slam={slam}
                          onStop={() => onReelStop(i)}
                        />
                      ))
                    )}
                    {/* Живёт всегда и лишь гаснет — см. тот же приём в «Каскаде». */}
                    <div
                      className={`reels__dim${shownWins.length ? ' is-on' : ''}`}
                      aria-hidden="true"
                    />
                    {shownWins.length > 0 && (
                      <div className="reels__marks" aria-hidden="true">
                        {[0, 1, 2].map((col) =>
                          [0, 1, 2].map((row) =>
                            winCells.has(`${col}-${row}`) ? (
                              <span
                                key={`${col}-${row}`}
                                className={`reels__mark${bursting ? ' is-burst' : ''}`}
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
                    {shownWins.length > 0 && <PaylineOverlay wins={shownWins} />}
                    {/* Канва пыли: поверх поля, чтобы пиксели летели над символами */}
                    <canvas className="dust" ref={dustRef} aria-hidden="true" />
                    {/* Множитель звена крупно в центре — чтобы комбо читалось сразу.
                        На первом звене множителя нет, и «×1» был бы шумом. */}
                    {cascade && cascade.phase !== 'drop' && stepCombo > 1 && (
                      <div
                        className={`stamp stamp--t${tier}`}
                        key={`st-${chain}`}
                        aria-hidden="true"
                      >
                        <i className="stamp__cap">{tr('slots.stamp')}</i>
                        <b className="stamp__n">×{stepCombo}</b>
                      </div>
                    )}
                    <div className="reels__glass" aria-hidden="true" />
                    {/* Титул ступени. Он не появляется и не исчезает — он
                        СМЕНЯЕТСЯ: по нему видно, что счёт пошёл выше. */}
                    {counting && winStep && (
                      <div
                        className={`win-title win-title--b${winStep.beats}`}
                        key={winStep.id}
                        aria-hidden="true"
                      >
                        {winStepName(winStep.id)}
                      </div>
                    )}
                  </div>
                  {/* Счётчик комбо — над окном, чтобы не закрывать сыгравший ряд */}
                  {chain >= 1 && cascade && (
                    <div className={`combo combo--t${tier}`} key={chain}>
                      <b>{chain >= 2 ? tr('slots.combo', { n: chain }) : tr('slots.anyWin')}</b>
                      {stepCombo > 1 && <i>{tr('slots.payout', { n: stepCombo })}</i>}
                    </div>
                  )}
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
                  aria-label={tr('slots.a11y.lever')}
                >
                  <span className="lever__slot" />
                  <span className="lever__base" />
                  <span
                    className="lever__arm"
                    ref={armRef}
                    style={{
                      transform: `translateY(${lever * 44}px)`,
                      transition: dragRef.current
                        ? 'none'
                        : 'transform .35s cubic-bezier(.3,1.5,.5,1)',
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
            </div>
          </div>
        </div>

        {/* Строка статуса и выигрыша — ВНЕ корпуса: корпус масштабируется целиком, и
            текст в нём на телефоне выходил 9–14 px. Здесь он кегля набора, высота
            постоянная — спины меняют только содержимое. */}
        <div className="cabinet__status cas-status">
          {cascade || counting ? (
            <>
              <span className={`status status--combo status--t${tier}`}>
                {/* Во время счёта строка говорит только, что идёт счёт.
                    Название ступени несёт плашка над полем — дублировать
                    его здесь значит забивать узкую строку длинным словом
                    и сжимать сам счётчик. */}
                {counting
                  ? tr('slots.status.counting')
                  : chain >= 2
                    ? tr('slots.status.combo', { n: chain })
                    : tr('slots.status.win')}
              </span>
              {/* Один счётчик на весь спин: набирает базу за каскад, а
                  потом с неё же уезжает к итогу. */}
              <span className={`status__win${counting ? ' is-counting' : ''}`} ref={winRef}>
                +<MoneyCounter ref={winOdo} value={0} format={fmt} />
                <CoinIcon size={20} />
              </span>
              {!counting && stepCombo > 1 && (
                <span className="status__mult">{tr('slots.payout', { n: stepCombo })}</span>
              )}
            </>
          ) : spinning ? (
            <span className="status status--spin">
              {stopped === 2 ? tr('slots.status.lastReel') : tr('slots.status.spinning')}
            </span>
          ) : result ? (
            <>
              <span className="status">
                {outcomeLabel(result).symbol && (
                  <Sym id={outcomeLabel(result).symbol!} skin={skin} size={22} />
                )}
                {result.combo >= 2
                  ? tr('slots.status.comboOf', { n: result.combo })
                  : outcomeText(result)}
              </span>
              {result.total > 0 && (
                <span className={`status__win${result.kind === 'jackpot' ? ' is-jackpot' : ''}`}>
                  {/* Без анимации: сумму только что досчитали на глазах. */}+{fmt(result.total)}
                  <CoinIcon size={20} />
                </span>
              )}
              {result.multiplier >= 3 && (
                <span className="status__mult">×{fmt(result.multiplier)}</span>
              )}
              {jackpotWin > 0 && <span className="status__pool">{tr('slots.status.pool')}</span>}
              {streak >= 2 && result.total > 0 && (
                <span className="status__streak">🔥 {streak}</span>
              )}
            </>
          ) : (
            <span className="status status--hint">{tr('slots.status.hintLever')}</span>
          )}
        </div>

        <CasDeck
          balance={
            <>
              {/* Баланс — тот же механический счётчик, и во время выплаты он
                  крутится В ОДИН ХОД с выигрышем. */}
              <MoneyCounter ref={balOdo} value={shownBalance} format={fmt} />
              <CoinIcon size={22} />
            </>
          }
          balanceNum={balance}
          bet={bet}
          freeSpins={freeSpins}
          spinning={spinning}
          setBet={setBet}
          onCustomBet={() => {
            setBetDraft(bet);
            setBetSheet(true);
          }}
          spinDisabled={!canSpin && auto === 0}
          busy={spinning}
          onSpin={() => (auto > 0 ? stopAuto() : pressSpin())}
          onSkip={skip}
          spinLabel={
            auto > 0
              ? tr('slots.btn.stopShort')
              : broke
                ? tr('slots.btn.brokeShort')
                : freeSpins > 0
                  ? tr('slots.btn.freeShort')
                  : tr('slots.btn.spinShort')
          }
          spinBadge={auto === 0 && freeSpins > 0 ? fmt(freeSpins) : undefined}
          auto={auto}
          autoDisabled={!canSpin && auto === 0}
          onAuto={() => {
            tapLight();
            primeAudio();
            if (auto > 0) stopAuto();
            else setAutoSheet(true);
          }}
          turbo={turbo}
          onTurbo={() => {
            selectionChanged();
            setPrefs({ turbo: !turbo });
          }}
        />
      </div>

      {sheet && (
        <GxSheet title={tr('slots.pay.title')} onClose={() => setSheet(false)}>
          {/* Правила — одна строка на раздел и картинка (таблица, лестница, линии); длинные
              абзацы — под «Подробнее» (critic K2 #8: на пергаменте 12-px абзацы не читались). */}
          <div className="cas-rules">
            <p className="cas-rules__lead">{keepDot(tr('slots.pay.introShort'))}</p>
            <div className="paytable">
              {[...SLOT_SYMBOLS].reverse().map((s) => (
                <div className="paytable__row cas-well" key={s.id}>
                  <span className="paytable__syms">
                    <Sym id={s.id} skin={skin} size={26} />
                    <Sym id={s.id} skin={skin} size={26} />
                    <Sym id={s.id} skin={skin} size={26} />
                  </span>
                  <span className="paytable__mult px-num">×{s.three}</span>
                  <span className="paytable__pair">{tr('slots.pay.pair', { n: s.pair })}</span>
                </div>
              ))}
            </div>
            <div className="lines-grid">
              {PAYLINES.map((line) => (
                <div
                  className="line-card cas-well"
                  key={line.id}
                  role="img"
                  aria-label={lineName(line.id)}
                  data-tip={lineName(line.id)}
                >
                  <svg viewBox="0 0 30 30" aria-hidden="true">
                    {[0, 1, 2].map((col) =>
                      [0, 1, 2].map((row) => (
                        <rect
                          key={`${col}-${row}`}
                          x={col * 10 + 1}
                          y={row * 10 + 1}
                          width="8"
                          height="8"
                          className={line.rows[col] === row ? 'is-on' : ''}
                        />
                      )),
                    )}
                  </svg>
                </div>
              ))}
            </div>
            <section className="cas-rules__sec">
              <h3 className="cas-rules__h">{tr('slots.pay.cascTitle')}</h3>
              <p className="cas-rules__lead">{tr('slots.pay.cascShort')}</p>
              <div className="combo-rules__ladder">
                {COMBO_LADDER.map((m, i) => (
                  <span key={i} className="combo-rules__step cas-well">
                    <b className="px-num">{i + 1 === COMBO_LADDER.length ? `${i + 1}+` : i + 1}</b>
                    <i className="px-num">×{m}</i>
                  </span>
                ))}
              </div>
            </section>
            <details className="cas-more">
              <summary>{tr('slots.pay.more')}</summary>
              <p>{tr('slots.pay.intro', { unit: LINE_UNIT, bet, line: lineBet(bet) })}</p>
              <p>{tr('slots.pay.cascText')}</p>
              <p>{tr('slots.pay.note')}</p>
            </details>
          </div>
        </GxSheet>
      )}

      {skinSheet && <SkinSheet onClose={() => setSkinSheet(false)} />}

      {autoSheet && (
        <GxSheet title={tr('slots.a11y.auto')} onClose={() => setAutoSheet(false)}>
          <CasAutoPicker
            options={AUTO_OPTIONS}
            hint={(h) => tr(`slots.auto.${h}`)}
            onPick={(v) => startAuto(v)}
            note={tr('slots.auto.short')}
          />
        </GxSheet>
      )}

      {settings && (
        <GxSheet title={tr('common.settings')} onClose={() => setSettings(false)}>
          <CasToggles
            items={[
              {
                key: 'sound' as const,
                on: sound,
                icon: sound ? ('sound' as const) : ('mute' as const),
                name: tr('slots.toggle.sound'),
                hint: tr('slots.toggle.soundSlots'),
              },
              {
                key: 'music' as const,
                on: music,
                icon: music ? ('music' as const) : ('nomusic' as const),
                name: tr('slots.toggle.music'),
                hint: tr('slots.toggle.musicHint'),
              },
              {
                key: 'haptics' as const,
                on: haptics,
                icon: 'buzz' as const,
                name: tr('slots.toggle.haptics'),
                hint: tr('slots.toggle.hapticsHint'),
              },
              {
                key: 'turbo' as const,
                on: turbo,
                icon: 'bolt' as const,
                name: tr('slots.toggle.turbo'),
                hint: tr('slots.toggle.turboHint'),
              },
            ].map((it) => ({
              ...it,
              onClick: () => {
                primeAudio();
                // Вибрацию выключаем после отклика, включаем — до него.
                if (it.key === 'haptics' && !it.on) setHapticsMuted(false);
                selectionChanged();
                setPrefs({ [it.key]: !it.on });
              },
            }))}
          />
          <CashDesk />
        </GxSheet>
      )}

      {betSheet && (
        <GxSheet title={tr('slots.a11y.bet')} onClose={() => setBetSheet(false)}>
          <CasBetPicker
            value={betDraft}
            min={MIN_BET}
            max={MAX_BET}
            step={BET_STEP}
            onChange={(v) => setBetDraft(clampBet(v))}
            lessLabel={tr('slots.bet.less')}
            moreLabel={tr('slots.bet.more')}
            note={keepDot(
              [
                tr('slots.bet.short', { min: MIN_BET, max: MAX_BET, step: BET_STEP }),
                tr('slots.bet.lineShort', { unit: LINE_UNIT }),
              ].join(' · '),
            )}
            cta={
              betDraft > balance && freeSpins <= 0
                ? tr('slots.bet.noCoins')
                : tr('slots.bet.play', { bet: betDraft })
            }
            ctaOff={betDraft > balance && freeSpins <= 0}
            onConfirm={() => {
              tapMedium();
              setBet(betDraft);
              setBetSheet(false);
            }}
          />
        </GxSheet>
      )}

      {lvlShown && (
        <div
          className={`levelup${lvlLeaving ? ' is-leaving' : ''}`}
          data-skin={skin}
          onClick={() => setLevelUp(null)}
          role="presentation"
        >
          <div className="levelup__card">
            <div className="levelup__lvl">{tr('slots.levelup.level', { n: lvlShown.level })}</div>
            {lvlShown.coins > 0 && (
              <div className="levelup__gain">
                +{fmt(lvlShown.coins)}
                <CoinIcon size={18} />
              </div>
            )}
            {lvlShown.skin && (
              <div className="levelup__skin">
                {tr('slots.levelup.skin', { name: skinText(lvlShown.skin as SkinId, 'name') })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Крупный выигрыш — в духе тотема бессмертия: символ вырастает в центре,
          качается и уходит вверх, вокруг разлетаются квадратные искры. */}
      {totem && (
        <div
          className={`totem${totemLeaving ? ' is-leaving' : ''} totem--${winStep && winStep.beats >= 3 ? 'jackpot' : totem.tier}`}
          onClick={() => {
            // Пока идут деньги — тап досчитывает их, а не закрывает карточку.
            if (!skipCount()) setCelebration(null);
          }}
          role="presentation"
        >
          <div className="totem__flash" />
          <div className="totem__glow" />
          <div className="totem__sparks" aria-hidden="true">
            {SPARKS.map((sp, i) => (
              <i
                key={i}
                className={sp.gold ? 'is-gold' : ''}
                style={
                  {
                    '--a': `${sp.angle}deg`,
                    '--d': `${sp.dist}px`,
                    '--s': `${sp.size}px`,
                    animationDelay: `${sp.delay}s`,
                    animationDuration: `${sp.dur}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <div className="totem__item">
            <Sym id={theme.preview} skin={skin} size={140} />
          </div>
          <div className="totem__card">
            {/* Титул живёт ступенью счёта и меняется прямо на глазах:
                карточка открывается «КРУПНЫМ», а через пару секунд на ней
                уже «МЕГА». Ключ по ступени — чтобы каждый титул прилетал
                своим кадром, а не подменялся текстом. */}
            <div className="totem__title" key={winStep?.id ?? totem.tier}>
              {totem.tier === 'jackpot' && !winStep
                ? tr('slots.totem.jackpot')
                : winStepName(winStep?.id ?? 'big')}
            </div>
            <div className="totem__amount">
              {/* Счёт НЕ начинается заново: он продолжает тот же ход, что
                  шёл в автомате, просто теперь на крупном плане. */}
              <MoneyCounter ref={totemOdo} value={wonRef.current} />
              <CoinIcon size={30} />
            </div>
            <div className="totem__hint">
              {counting ? tr('slots.totem.tapSkip') : tr('slots.totem.tapGo')}
            </div>
          </div>
        </div>
      )}
    </GameScreen>
  );
}
