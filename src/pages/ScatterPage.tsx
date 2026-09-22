import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { MoneyCounter } from '@/components/MoneyCounter';
import type { MoneyHandle } from '@/components/MoneyCounter';
import { CoinIcon, OrbGem } from '@/components/slot-art';
import { skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { IconGift, IconInfo } from '@/components/icons';
import { CashDesk } from '@/components/CashDesk';
import { SkinSheet } from '@/components/SkinSheet';
import { RewardsSheet, useReadyRewards } from '@/components/RewardsSheet';
import { useFinanceStore } from '@/store';
import { useExit } from '@/lib/use-exit';
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
  MAX_WIN,
  SCATTER_TRIGGER,
  fillerCell,
  orbOf,
  scatterLabel,
  scatterSymbol,
} from '@/lib/scatter';
import type { Orb, ScatterCell, ScatterGrid, ScatterStep, ScatterWin } from '@/lib/scatter';
import type { SlotSymbolId } from '@/types';
import { BET_STEP, BETS, clampBet, MAX_BET, MIN_BET } from '@/lib/slots';
import { levelFromXp, levelReward } from '@/lib/slots-meta';
import { loudestTier, multRarity, ORB_TIERS, orbTier } from '@/lib/orb-rarity';
import type { OrbTier } from '@/lib/orb-rarity';
import { plainPlan, rollupPlan, runRollup, winTier } from '@/lib/rollup';
import { planReel, restReel, spinReel } from '@/lib/reel-motion';
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
  jackpotFanfare,
  leverPull,
  multSlam,
  multTick,
  orbDrop,
  payoutEnd,
  primeAudio,
  reelStop,
  reelTick,
  rollupTick,
  setMuted,
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

/** Высота ячейки; та же величина в CSS (--scell). */
const SCELL = 68;
/** Размер символа в клетке. */
const SYM = 50;
const BASE_MS = 780;
const STEP_MS = 150;
/** Каскад: подсветить → рассыпать в пыль → уронить верхние. */
const SHOW_MS = 760;
const BURST_MS = 330;
const DROP_MS = 460;
const DROP_STAGGER = 55;
/**
 * Полёт сферы в счётчик: сдвиг между сферами, длительность и доля полёта,
 * на которой она касается жетона. Те же числа уходят в CSS (`--orb-fly`,
 * `--orb-stagger` на поле) — счёт и полёт обязаны совпадать кадр в кадр.
 */
const ORB_STAGGER_MS = 70;
const ORB_FLY_MS = 560;
const ORB_ARRIVE = 0.86;
/**
 * Во сколько раз турбо ускоряет каскад. Та же величина уезжает в CSS
 * переменной `--speed`: раньше турбо сжимал только паузы на таймерах, а
 * сами анимации шли в полную длину и обрывались на середине — отсюда и
 * ощущение, что в турбо «всё не попадает друг в друга».
 */
const TURBO = 0.55;
/** Насколько короче вращение в турбо — и во сколько раз быстрее ровный ход. */
const TURBO_SPIN = 0.5;
const TURBO_SPEEDUP = 1.2;

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

function Sym({
  id,
  skin,
  size = SYM,
}: {
  id: SlotSymbolId | 'scatter';
  skin: SkinId;
  size?: number;
}) {
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

/**
 * Содержимое клетки — по самой клетке, и больше ни по чему. Если в клетке
 * `orb:25`, она показывает самоцвет с числом; иначе — картинку символа.
 * Одним и тем же рисуются и лента вращения, и поле: сфера едет на барабане
 * вместе со всеми и встаёт в клетку, потому что она и есть клетка.
 */
function CellFace({ id, skin, size = SYM }: { id: ScatterCell; skin: SkinId; size?: number }) {
  const value = orbOf(id);
  if (!value) return <Sym id={id as SlotSymbolId | 'scatter'} skin={skin} size={size} />;
  const t = orbTier(value);
  return (
    <>
      {t.beats >= 2 && <i className="orb__ring" aria-hidden="true" />}
      <OrbGem />
      <b className="orb__num">×{value}</b>
      {/* Подписи ступени на самой клетке нет. «ЛЕГЕНДАРНАЯ» в 7 px не влезала
          в крайнюю колонку и срезалась полем, а главное — она тут и не нужна:
          имя называет сольный выход, крупно и целиком. На клетке о редкости
          говорят цвет и орбита. */}
    </>
  );
}

/** Классы и переменные клетки-сферы — одни и те же в ленте и на поле. */
function orbClass(value: number): string {
  return value ? ` sbcell--orb orb--${orbTier(value).id}` : '';
}

// ---------------------------------------------------------------------------
// Поле. Вне каскада колонки крутятся лентой, в каскаде — это сетка, где
// исчезают ровно сыгравшие клетки, а верхние съезжают на их места.
// ---------------------------------------------------------------------------

interface BoardCell {
  key: string;
  /**
   * Что в клетке. Символ, скаттер или сфера — различать их отдельными полями
   * не нужно и нельзя: любое такое поле снова сделало бы сферу чем-то, что
   * лежит НА клетке, а не ею самой. Сфера съезжает, падает и гаснет вместе
   * со всем полем просто потому, что она обычная клетка.
   */
  id: ScatterCell;
  row: number;
  fall: number;
  /** Порядок в волне сбора: от дешёвого камня к дорогому. */
  orbIdx?: number;
}
type Board = BoardCell[][];

/**
 * Раздаёт клеткам-сферам место в волне сбора: дешёвые улетают первыми,
 * дорогая — последней, чтобы её номинал остался на поле дольше всех.
 */
function orderOrbs(board: Board): Board {
  const found: { c: number; i: number; value: number }[] = [];
  board.forEach((col, c) =>
    col.forEach((cell, i) => {
      const value = orbOf(cell.id);
      if (value) found.push({ c, i, value });
    }),
  );
  if (!found.length) return board;
  found.sort((a, b) => a.value - b.value);
  const next = board.map((col) => [...col]);
  found.forEach((o, orbIdx) => {
    next[o.c][o.i] = { ...next[o.c][o.i], orbIdx };
  });
  return next;
}

/**
 * Поле после сбора сфер: опустевшие клетки заполняются так же, как после
 * выигрыша, — всё, что выше, падает вниз, сверху приходят новые символы.
 * Уцелевшим, которые не двигаются, ключ сохраняем: пересоздавать их незачем.
 */
function dropHoles(board: Board, holes: Set<string>, tag: string): Board {
  return board.map((col, c) => {
    const survivors = col.filter((cell) => !holes.has(`${c}-${cell.row}`));
    const gone = SCATTER_ROWS - survivors.length;
    const cells: BoardCell[] = survivors.map((cell, i) => {
      const row = gone + i;
      const fall = row - cell.row;
      // Двигающейся клетке — новый ключ: иначе у неё уже отыгравшая анимация
      // падения, и браузер не запустит её заново — клетка просто прыгнет.
      return fall
        ? { ...cell, key: `${tag}-s-${c}-${cell.row}`, row, fall }
        : { ...cell, row, fall: 0 };
    });
    for (let row = 0; row < gone; row++) {
      cells.unshift({ key: `${tag}-n-${c}-${row}`, id: scatterSymbol(), row, fall: gone });
    }
    return cells.sort((a, b) => a.row - b.row);
  });
}

/** Короткий толчок числа жетона: сфера долетела и прибавилась. */
function bump(el: Element | null, speed: number): void {
  if (!el || reduceMotion()) return;
  try {
    el.animate([{ transform: 'scale(1.32)' }, { transform: 'scale(1)' }], {
      duration: 220 * speed,
      easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)',
    });
  } catch {
    /* движок без WAAPI — обойдёмся */
  }
}

function gridToBoard(grid: ScatterGrid, tag: string): Board {
  return orderOrbs(
    grid.map((col, c) => col.map((id, row) => ({ key: `${tag}-${c}-${row}`, id, row, fall: 0 }))),
  );
}

function collapseBoard(step: ScatterStep, tag: string): Board {
  const dead = new Set(step.wins.flatMap((w) => w.cells.map(([c, r]) => `${c}:${r}`)));
  return orderOrbs(
    step.grid.map((col, c) => {
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
    }),
  );
}

/** Случайное поле для первого показа — до первого вращения. */
const startGrid = (): ScatterGrid =>
  Array.from({ length: SCATTER_COLS }, () =>
    Array.from({ length: SCATTER_ROWS }, () => fillerCell()),
  );

interface SpinColProps {
  /**
   * План вращения колонки (lib/reel-motion.ts). Пролетающие клетки берутся
   * тем же генератором, что и поле, — поэтому мимо глаза проносятся и сферы,
   * и остановка барабана ничем не отличается от остановки на символе.
   */
  plan: ReelPlan<ScatterCell>;
  skin: SkinId;
  spinId: number;
  /** Колонка решает судьбу бонуса: тянет время и светится. */
  anticipate: boolean;
  onStop: () => void;
}

/** Колонка перерисовывается только при новой ленте — см. `Reel` в «Слотах». */
const SpinCol = memo(
  function SpinCol({ plan, skin, spinId, anticipate, onStop }: SpinColProps) {
    const ref = useRef<HTMLDivElement>(null);
    const stopRef = useRef(onStop);
    stopRef.current = onStop;

    // До отрисовки, а не после: иначе первый кадр спина успевал показать
    // ленту в исходном положении, ещё без анимации.
    useLayoutEffect(
      () => spinReel(ref.current, plan, spinId, () => stopRef.current()),
      [spinId, plan],
    );

    return (
      <div className={`sboard__col${anticipate ? ' is-anticipate' : ''}`}>
        <div className="sboard__strip" ref={ref}>
          {/* Ключ — позиция в ленте, а не символ: элементы переиспользуются,
            меняется только содержимое (см. тот же приём в «Слотах»). */}
          {plan.strip.map((id, i) => {
            const value = orbOf(id);
            return (
              <span
                className={`sbcell sbcell--flow${orbClass(value)}`}
                key={i}
                style={{ '--len': value ? String(value).length : 1 } as React.CSSProperties}
              >
                <CellFace id={id} skin={skin} />
              </span>
            );
          })}
        </div>
      </div>
    );
  },
  (a, b) =>
    a.plan === b.plan &&
    a.skin === b.skin &&
    a.spinId === b.spinId &&
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

  const [plans, setPlans] = useState<ReelPlan<ScatterCell>[]>(() =>
    startGrid().map((col) => restReel(col, () => fillerCell(), SCELL)),
  );
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  /** Какие колонки тянут время: на поле уже три скаттера из четырёх. */
  const [anti, setAnti] = useState<boolean[]>(EMPTY_ANTI);
  const [board, setBoard] = useState<Board | null>(null);
  /** Поле, каким оно отрисовано сейчас, — для досыпки после сбора сфер. */
  const boardNow = useRef<Board | null>(null);
  boardNow.current = board;
  const [dropDur, setDropDur] = useState(DROP_MS);
  const [cascade, setCascade] = useState<{
    step: number;
    phase: 'show' | 'collect' | 'burst' | 'drop';
  } | null>(null);
  /**
   * Что показывает плашка бонуса. Стор обновляется в момент НАЖАТИЯ — там
   * уже известны и новый множитель, и выигрыш, — а поле показывает это
   * секунды спустя. Плашка проговаривала результат вперёд поля, то есть
   * спойлерила спин. Здесь лежит состояние «как на поле прямо сейчас».
   */
  const [shownFs, setShownFs] = useState<{ left: number; mult: number; won: number } | null>(null);
  /** Сумма сфер, которую счётчик показывает прямо сейчас (тикает вверх). */
  const [collectSum, setCollectSum] = useState(0);
  /** Множитель «припечатался» к выплате — короткая вспышка на счётчике. */
  const [collectDone, setCollectDone] = useState(false);
  /**
   * Сбор кончился, счёт уже пошёл, а жетон с вуалью ещё уходят. Раньше они
   * снимались одним кадром: тёмное поле мгновенно становилось светлым.
   */
  const [collectOut, setCollectOut] = useState(false);
  const [stepWins, setStepWins] = useState<ScatterWin[]>([]);
  const [chain, setChain] = useState(0);
  /**
   * Идёт подсчёт выплаты. Отдельно от `cascade`: счёт начинается ПОСЛЕ
   * каскада и живёт своей жизнью — секунду на мелочи и полтора десятка
   * секунд на максимуме.
   */
  const [counting, setCounting] = useState(false);
  /** Ступень, которую счёт пробил последней. Она же даёт титул. */
  const [winStep, setWinStep] = useState<WinTier | null>(null);
  /** Сольный выход редкой сферы перед сбором: камень крупно и по имени. */
  const [solo, setSolo] = useState<{ value: number; tier: OrbTier; leaving: boolean } | null>(null);
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
  const [totem, totemLeaving] = useExit(celebration, 300);
  const [levelUp, setLevelUp] = useState<{
    level: number;
    coins: number;
    freeSpins: number;
  } | null>(null);
  // Оверлеи уходят, а не обрываются (lib/use-exit.ts): состояние уже null,
  // а разметка ещё доигрывает уход.
  const [lvlShown, lvlLeaving] = useExit(levelUp, 240);

  const boardRef = useRef<HTMLDivElement>(null);
  /** Корпус автомата — его и трясёт, а не всю страницу. */
  const cabinetRef = useRef<HTMLDivElement>(null);
  /** Счётчик выигрыша: его толкает удар множителя. */
  const winRef = useRef<HTMLSpanElement>(null);
  /** Число на жетоне: его толкает каждая долетевшая сфера. */
  const stampNumRef = useRef<HTMLElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);
  const dustStop = useRef<(() => void) | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Счётчики обновляются ИМПЕРАТИВНО: счёт идёт каждый кадр, и гонять через
  // него состояние React значило бы перерисовывать половину страницы
  // шестьдесят раз в секунду. См. components/MoneyCounter.
  const winOdo = useRef<MoneyHandle>(null);
  const totemOdo = useRef<MoneyHandle>(null);
  const balOdo = useRef<MoneyHandle>(null);
  /** Сколько монет счётчик показывает прямо сейчас — отсюда стартует счёт. */
  const wonRef = useRef(0);
  /** «Оборвать счёт» — и по тапу игрока, и при уходе со страницы. */
  const rollStop = useRef<(() => void) | null>(null);
  /**
   * Что стоит на поле прямо сейчас — с этого начинается следующее вращение.
   * Раньше лента стартовала со случайных клеток, и в первый кадр каждого
   * спина всё поле 6×5 подменялось другими символами.
   */
  const shownGrid = useRef<ScatterGrid | null>(null);
  if (!shownGrid.current) shownGrid.current = plans.map((p) => p.strip.slice(1, 1 + SCATTER_ROWS));

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (tickRef.current) clearInterval(tickRef.current);
      rollStop.current?.();
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

  /**
   * Один удар: стоп-кадр → вспышка → тряска. Порядок важен — пауза читается
   * как удар, вспышка прячет склейку, и три эффекта сливаются в одно событие
   * вместо трёх подряд.
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

  /** Спин закончен окончательно — после того, как деньги досчитаны. */
  const finish = useCallback((res: ScatterSpinOutcome) => {
    if (tickRef.current) clearInterval(tickRef.current);
    setCounting(false);
    setResult(res);
    setPending(0);
    setSpinning(false);
    // Напряжение снято — гасим подсветку тянущих колонок.
    setAnti(EMPTY_ANTI);
    // Плашка бонуса обновляется только теперь, когда поле всё показало.
    setShownFs(res.fs ? { left: res.fs.left, mult: res.fs.totalMult, won: res.fs.won } : null);
    if (res.levelUps.length) {
      const lvl = res.levelUps[res.levelUps.length - 1];
      setLevelUp({ level: lvl, ...levelReward(lvl) });
    }
  }, []);

  /**
   * Подсчёт выплаты — главная сцена спина.
   *
   * Что здесь важно и чего раньше не было. Счёт идёт ОТ уже показанной суммы
   * (базы каскада) К итогу, ровным ходом, и по дороге пробивает ступени. На
   * каждой он замирает, звучит удар, меняется титул — и продолжается дальше.
   * Именно «не остановился» и есть то, ради чего на это смотрят: пока число
   * просто доезжало до итога за фиксированные 400 мс, размер выигрыша ничем
   * не ощущался — ×500 проскакивал за то же время, что и мелочь.
   *
   * Со ступени «КРУПНЫЙ ВЫИГРЫШ» сцену забирает тотем, и счёт продолжается
   * уже в нём: счётчик не сбрасывается и не начинается заново, он просто
   * переезжает на крупный план.
   */
  const payout = useCallback(
    (res: ScatterSpinOutcome, from: number) => {
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
      const speed = turbo ? TURBO : 1;
      const topBeats = plan.top?.beats ?? 0;

      setCounting(true);
      setWinStep(null);
      wonRef.current = start;
      winOdo.current?.set(start);
      tapLight();
      // Церемония начинается с нуля — сброс счётчика прячет вспышка
      // открывающего удара. Мелкому выигрышу сбрасывать нечего: вспышка
      // на каждом «ВЕРНУЛОСЬ» мигала экраном через спин и обесценивала себя.
      if (ceremony) beat('small', () => winChime('small'));
      else winChime('small');

      // `live` — не перестраховка. Если план отыгрывается синхронно (пустой
      // ход или prefers-reduced-motion), `done` проходит ДО присваивания, и
      // в `rollStop` осталась бы уже отработавшая функция: `skipCount` после
      // этого возвращал бы «да, прервал», и тап по тотему перестал бы его
      // закрывать.
      let live = true;
      const stop = runRollup(
        plan,
        {
          value: (n) => {
            wonRef.current = n;
            winOdo.current?.set(n);
            totemOdo.current?.set(n);
            // Баланс растёт ВМЕСТЕ со счётчиком. Деньги не «начисляются
            // потом» — видно, как они прибывают в карман прямо сейчас.
            balOdo.current?.set(Math.max(0, balance - (to - n)));
          },
          tick: rollupTick,
          tier: (t) => {
            setWinStep(t);
            tierBreak(t.beats);
            // Эскалация неравномерная: ступень отличается не цветом плашки,
            // а числом тактов, которое ей отводят.
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
            if (t.beats >= 2) {
              setCelebration(
                (c) => c ?? { tier: t.beats >= 3 ? 'mega' : 'big', amount: to, ...dart() },
              );
            }
          },
          done: () => {
            live = false;
            rollStop.current = null;
            wonRef.current = to;
            balOdo.current?.set(balance);
            payoutEnd(topBeats);
            if (topBeats >= 3) jackpotFanfare();
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

  useEffect(() => {
    if (!levelUp) return undefined;
    coinDing(0.1);
    const t = setTimeout(() => setLevelUp(null), 6000);
    return () => clearTimeout(t);
  }, [levelUp]);

  useEffect(() => {
    // Пока идёт счёт, тотем не убираем и не торопим: в нём и происходит
    // самое интересное. Таймер скрытия заводится только после того, как
    // деньги досчитаны.
    if (!celebration || counting) return undefined;
    const hide = setTimeout(() => setCelebration(null), 4200);
    return () => clearTimeout(hide);
  }, [celebration, counting]);

  const startDust = useCallback((wins: ScatterWin[], speed = 1) => {
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
    dustStop.current = dustBurst(canvas, cells, speed);
  }, []);

  /**
   * Голос сфер: звучат по возрастанию номинала, волной по 90 мс. Редкая
   * находка слышна раньше, чем игрок успевает прочитать число.
   */
  const playOrbs = useCallback((list: Orb[]) => {
    if (!list.length) return;
    [...list]
      .sort((a, b) => a.value - b.value)
      .forEach((o, k) => orbDrop(orbTier(o.value).beats, k * 0.09));
    const loudest = loudestTier(list.map((o) => o.value));
    if (loudest.beats >= 3) notifySuccess();
    else if (loudest.beats === 2) tapMedium();
    else if (loudest.beats === 1) selectionChanged();
  }, []);

  const stepRef = useRef<(res: ScatterSpinOutcome, i: number) => void>(() => {});
  const finaleRef = useRef<(res: ScatterSpinOutcome) => void>(() => {});

  const runStep = useCallback(
    (res: ScatterSpinOutcome, i: number) => {
      const step = res.steps[i];
      const scale = turbo ? TURBO : 1;
      const show = SHOW_MS * scale;
      const burst = BURST_MS * scale;
      const drop = DROP_MS * scale;
      const stagger = DROP_STAGGER * scale;
      const chainN = i + 1;
      const t = tierOf(chainN);

      setCascade({ step: i, phase: 'show' });
      // Поле пересобираем ТОЛЬКО на первом звене. Дальше на экране уже стоит
      // результат прошлого схлопывания, а он в точности равен `step.grid`
      // (движок берёт следующее поле из `step.next`). Пересборка меняла всем
      // тридцати клеткам React-ключ, то есть уничтожала и создавала заново
      // тридцать span'ов с картинками — ровно в тот кадр, когда начинают
      // играть рамки выигрыша. Именно это и дёргалось.
      if (i === 0) setBoard(gridToBoard(step.grid, `${res.steps.length}-0-g`));
      setStepWins(step.wins);
      setChain(chainN);
      // Выплата звена: только база — множитель применяется ОДИН раз, в самом
      // конце. Ход короткий и без ступеней: у каскада свой ритм, и титулы с
      // паузами посреди него сбивали бы его, а не украшали.
      rollStop.current?.();
      const fromBase = wonRef.current;
      const toBase = fromBase + step.base;
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
      setPending((p) => Math.max(0, p - step.base));

      comboHit(chainN);

      // Звучат только СВЕЖИЕ сферы этого звена — иначе уже лежащие
      // перезванивали бы на каждом падении.
      playOrbs(step.newOrbs);

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

      timers.current.push(
        setTimeout(() => {
          setCascade({ step: i, phase: 'burst' });
          symbolBurst();
          startDust(step.wins, scale);
        }, show),
      );

      timers.current.push(
        setTimeout(() => {
          setDropDur(drop);
          setBoard(collapseBoard(step, `${res.steps.length}-${i}`));
          setCascade({ step: i, phase: 'drop' });
          setStepWins([]);
          // Сферы убирать нечем: они не выигрывают, значит и не исчезают —
          // просто съезжают вниз вместе с колонкой, как любая уцелевшая клетка.
        }, show + burst),
      );

      timers.current.push(
        setTimeout(
          () => {
            if (i + 1 < res.steps.length) stepRef.current(res, i + 1);
            else {
              shownGrid.current = res.steps[i].next;
              finaleRef.current(res);
            }
          },
          show + burst + drop + stagger * (SCATTER_COLS - 1) + 80,
        ),
      );
    },
    [turbo, bet, theme.confetti, rainSrc, startDust, playOrbs],
  );
  stepRef.current = runStep;

  /**
   * Финал последовательности: все накопленные сферы слетаются в счётчик,
   * сумма растёт и одним ударом множит ВСЮ базу. Так устроен Олимп — и так
   * это наконец читается: один крупный момент вместо десятка мелких.
   *
   * Сумма растёт ПО ПРИЛЁТУ, а не по часам. Раньше счётчик тикал ровно
   * полсекунды от нуля до итога, а сферы летели своим расписанием — и при
   * пяти сферах удар звучал, когда четыре из них ещё были в воздухе.
   * Теперь каждая сфера прибавляет свой номинал в тот кадр, когда долетела,
   * и удар — после последней. «Бонус виден делающим работу».
   */
  const finale = useCallback(
    (res: ScatterSpinOutcome) => {
      const scale = turbo ? TURBO : 1;
      // Каскад отыграл — дальше деньги. Счёт стартует ровно с той суммы,
      // которую счётчик показывает прямо сейчас.
      const toPayout = () => {
        setCascade(null);
        setChain(0);
        payoutRef.current(res, wonRef.current);
      };
      if (!res.orbs.length || res.applied <= 1 || res.base <= 0) {
        toPayout();
        return;
      }

      const loudest = loudestTier(res.orbs.map((o) => o.value));
      const topOrb = res.orbs.reduce((m, o) => Math.max(m, o.value), 0);
      // Тот же порядок, что у --i на поле (orderOrbs): от дешёвой к дорогой.
      const order = [...res.orbs].sort((a, b) => a.value - b.value);
      // В бонусе множитель копился и до этого спина — счётчик стартует с того,
      // что уже было, чтобы виден был именно прирост. Вне бонуса — с нуля, и
      // жетона до прилёта первой сферы нет: «×0» посреди поля — это шум.
      const start = res.fs ? Math.max(0, res.applied - res.orbMult) : 0;
      const arrive = (k: number) => (k * ORB_STAGGER_MS + ORB_FLY_MS * ORB_ARRIVE) * scale;
      // Легендарная и выше получают лишнюю паузу перед ударом. Тишина — тоже
      // такт: без неё находка читается как уведомление, а не как событие.
      const hold = loudest.beats >= 3 ? 520 * scale : 0;
      const slamAt = arrive(order.length - 1) + 170 * scale + hold;

      const slam = () => {
        setCollectSum(res.applied);
        setCollectDone(true);
        multSlam();
        // Удар множителя = деньги. Сколько монет — по номиналу, который
        // сложился: ×3 это горсть, ×200 — ливень.
        burstConfetti(loudest.beats >= 2 ? 70 : 34, theme.confetti);
        rainCoins(Math.round(Math.min(46, 10 + res.applied * 0.6)), rainSrc);
        coinDing();
        coinDing(0.09);
        // Жетон в этот кадр рывком встаёт крупным — склейку прячет вспышка.
        flashFrame(loudest.beats >= 3 ? 'big' : 'small');
        // Множитель припечатался. Саму выплату отсюда НЕ подставляем: за неё
        // отвечает счёт (payout), и он поедет от базы к итогу со ступенями.
        if (res.fs) setShownFs((v) => ({ ...(v ?? { left: 0, won: 0 }), mult: res.totalMult }));
        // Сферы улетели — и поле схлопывается, как после выигрыша: всё, что
        // над опустевшими клетками, падает вниз, сверху приходят новые.
        // Раньше в дыру падал символ ровно из соседней клетки сверху — он
        // проезжал поверх неё, и вся колонка на миг двоилась. Символы здесь
        // чисто внешние: раунд посчитан, следующий спин перекрутит поле.
        const holes = new Set(res.orbs.map((o) => `${o.col}-${o.row}`));
        setDropDur(DROP_MS * scale);
        // Считаем снаружи, а не в updater'е setBoard: в StrictMode React
        // зовёт updater дважды, и случайные символы досыпки разошлись бы с
        // тем, что запомнено как «на поле сейчас».
        const now = boardNow.current;
        if (now) {
          const next = dropHoles(now, holes, `refill-${res.steps.length}`);
          shownGrid.current = next.map((col) => col.map((cell) => cell.id));
          setBoard(next);
        }
        squashPop(winRef.current, 0.6);
        addTrauma(cabinetRef.current, loudest.beats >= 3 ? TRAUMA.big : TRAUMA.small);
        if (loudest.beats >= 2) tapMedium();
      };

      const collect = () => {
        setCascade({ step: Math.max(0, res.steps.length - 1), phase: 'collect' });
        setCollectSum(start);
        setCollectDone(false);
        let sum = start;
        order.forEach((o, k) => {
          timers.current.push(
            setTimeout(() => {
              sum += o.value;
              setCollectSum(sum);
              multTick(order.length > 1 ? k / (order.length - 1) : 1);
              // Жетон «глотает» сферу. Первую — входом (он только что
              // появился), каждую следующую — коротким толчком числа.
              if (k > 0 || start > 0) bump(stampNumRef.current, scale);
            }, arrive(k)),
          );
        });
        timers.current.push(setTimeout(slam, slamAt));
        timers.current.push(
          setTimeout(
            () => {
              setCollectOut(true);
              toPayout();
              timers.current.push(setTimeout(() => setCollectOut(false), 300 * scale));
            },
            slamAt + 420 * scale,
          ),
        );
      };

      // Сольный выход. Редкая сфера и выше сначала показывается крупно и
      // названа по имени — и только потом уходит в общую волну сбора.
      // Ступени ниже этого выходят молча: выход, который случается каждый
      // второй спин, перестаёт быть выходом и становится задержкой.
      if (loudest.beats >= 2) {
        setSolo({ value: topOrb, tier: loudest, leaving: false });
        orbDrop(loudest.beats);
        if (loudest.beats >= 3) notifySuccess();
        else tapMedium();
        addTrauma(cabinetRef.current, loudest.beats >= 3 ? TRAUMA.big : TRAUMA.small);
        const shown = (loudest.beats >= 3 ? 1500 : 1050) * scale;
        timers.current.push(
          // Уход соло и начало сбора — одним движением: камень уменьшается и
          // гаснет, а под ним сферы уже срываются с мест. Вуаль лежит под
          // соло с самого начала, поэтому между ними нет светлого кадра.
          setTimeout(() => {
            setSolo((v) => (v ? { ...v, leaving: true } : v));
            collect();
          }, shown),
          setTimeout(() => setSolo(null), shown + 260 * scale),
        );
      } else {
        collect();
      }
    },
    [turbo, theme.confetti, rainSrc],
  );
  finaleRef.current = finale;

  const spin = useCallback(() => {
    if (!hydrated || spinning || balance < stake) return;
    primeAudio();
    const res = playScatter();
    if (!res) return;
    tapMedium();
    leverPull();

    const scale = turbo ? TURBO_SPIN : 1;
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
    const from = shownGrid.current ?? startGrid();
    setPlans(
      res.grid.map((col, c) =>
        planReel({
          from: from[c]?.length === SCATTER_ROWS ? from[c] : col.map(() => fillerCell()),
          to: col,
          filler: () => fillerCell(),
          cell: SCELL,
          duration: durs[c],
          tempo: scale,
          speedup: turbo ? TURBO_SPEEDUP : 1,
        }),
      ),
    );
    shownGrid.current = res.grid;
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
    setSolo(null);
    setStepWins([]);
    setChain(0);
    setCollectSum(0);
    setCollectDone(false);
    setCollectOut(false);
    setCounting(false);
    setWinStep(null);
    // Счётчик обнуляем и в рефе, и в самом одометре: от него стартует счёт.
    rollStop.current?.();
    rollStop.current = null;
    wonRef.current = 0;
    winOdo.current?.set(0);
    setPending(res.total);
    setSpinId((n) => n + 1);
    setSpinning(true);

    if (tickRef.current) clearInterval(tickRef.current);
    if (!reduceMotion()) tickRef.current = setInterval(() => reelTick(), turbo ? 55 : 80);

    timers.current.push(
      setTimeout(
        () => {
          if (tickRef.current) clearInterval(tickRef.current);
          // Подменять поле на сетку здесь больше НЕ НУЖНО и не нужно снова:
          // сферы приехали в самой ленте и уже стоят в своих клетках — это те
          // же клетки, которые только что крутились. Остаётся озвучить находку
          // и дать её разглядеть, прежде чем начнётся каскад.
          const landed = res.steps[0]?.orbs ?? res.orbs;
          if (landed.length) playOrbs(landed);
          const pause = landed.length ? 460 * (turbo ? TURBO : 1) : 0;
          if (res.steps.length) {
            timers.current.push(setTimeout(() => stepRef.current(res, 0), pause));
          } else {
            // Каскада не было — но скаттеры могли заплатить, и это тоже
            // деньги: считаем их тем же ходом. Если платить нечего, payout
            // сам сведёт спин к `finish`.
            //
            // Камень при этом просто остаётся лежать на поле до следующего
            // вращения: он честно выпал, просто рядом ничего не собралось.
            payoutRef.current(res, 0);
          }
        },
        durs[durs.length - 1] + 60,
      ),
    );
  }, [hydrated, spinning, balance, stake, playScatter, turbo, playOrbs]);

  // Бонус крутится сам: вращения бесплатные, ждать нажатия незачем.
  useEffect(() => {
    if (!inBonus || spinning || celebration) return;
    // Пауза между вращениями бонуса. Было 700 мс — и следующий спин начинался
    // раньше, чем досчитывался предыдущий: счётчик выигрыша анимируется до
    // 900 мс, и его срезало на середине. Ждём, пока счёт договорит.
    const t = setTimeout(() => spin(), turbo ? 520 : 1000);
    return () => clearTimeout(t);
  }, [inBonus, spinning, celebration, spin, turbo]);

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
      {/* --speed уезжает во ВСЕ анимации каскада. Без него турбо сжимал
          только паузы на таймерах, а CSS-анимации шли в полную длину и
          обрывались на середине — отсюда «в турбо всё не попадает». */}
      <div
        className="stack slots scatter"
        data-skin={skin}
        style={{ '--speed': turbo ? TURBO : 1 } as React.CSSProperties}
      >
        <div className="slots-scene" aria-hidden="true">
          <span className="slots-scene__decor" />
        </div>

        <div className="slot-hud">
          <div className="slot-hud__cell">
            <span className="slot-hud__label">Баланс</span>
            <span className="slot-hud__value">
              {/* Баланс — тот же механический счётчик, и во время выплаты он
                  крутится В ОДИН ХОД с выигрышем: видно, как деньги прибывают
                  в карман, а не появляются там задним числом. */}
              <MoneyCounter ref={balOdo} value={shownBalance} />
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

        {/* Трясёт корпус автомата, а не всю страницу: внутри Telegram дёрганье
            всего экрана читается как баг вебвью, а не как удар. */}
        {/* Тап по автомату досчитывает выплату. Длинный счёт обязан быть
            пропускаемым — иначе награда за крупный выигрыш превращается в
            наказание ожиданием, особенно в автоспине. */}
        <div
          className={`cabinet cabinet--wide${inBonus ? ' is-bonus' : ''}`}
          ref={cabinetRef}
          onClick={() => skipCount()}
          role="presentation"
        >
          <div className="cabinet__bulbs" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} style={{ animationDelay: `${i * 0.09}s` }} />
            ))}
          </div>
          {/* Состояние бонуса живёт в «короне» автомата — на месте вывески,
              а не отдельной плашкой над корпусом. Отдельная плашка появлялась
              и исчезала вместе с бонусом и каждый раз сдвигала всё поле вниз
              на свою высоту. Здесь же меняется только содержимое, геометрия
              остаётся та же, и поле стоит на месте. */}
          <div className={`cabinet__sign cabinet__sign--wide${inBonus ? ' is-bonus' : ''}`}>
            {inBonus && fs ? (
              <>
                <span className="sign-bonus__label">БОНУС</span>
                {/* Числа — состояние ПОЛЯ, а не стора: пока крутится, они
                    держат прошлые значения и не выдают результат вперёд
                    барабанов. Раньше плашка успевала показать новый множитель
                    до того, как сферы появлялись на поле. */}
                <span className="sign-bonus__left">ещё {shownFs?.left ?? fs.left}</span>
                <span className="sign-bonus__mult">
                  ×{Math.max(1, shownFs?.mult ?? fs.totalMult)}
                </span>
                <span className="sign-bonus__won">
                  <AnimatedNumber
                    value={shownFs?.won ?? fs.won}
                    format={(n) => fmt(n)}
                    duration={500}
                  />
                  <CoinIcon size={13} />
                </span>
              </>
            ) : (
              <>
                <span>{theme.sign[0]}</span>
                <b>CASCADE</b>
              </>
            )}
          </div>
          <div className="cabinet__window">
            <div
              className="sboard"
              ref={boardRef}
              style={
                {
                  '--orb-fly': `${ORB_FLY_MS}ms`,
                  '--orb-stagger': `${ORB_STAGGER_MS}ms`,
                } as React.CSSProperties
              }
            >
              {board
                ? board.map((col, c) => (
                    <div className="sboard__col" key={c}>
                      {col.map((cell) => {
                        // Клетка с самоцветом — такая же клетка, просто её
                        // содержимое другое. Ни отдельного слоя, ни подгонки
                        // координат: падает, съезжает и гаснет она вместе со
                        // всем полем, потому что она и есть поле.
                        const value = orbOf(cell.id);
                        return (
                          <span
                            key={cell.key}
                            className={`sbcell${cell.fall ? ' is-fall' : ''}${
                              dying.has(`${c}-${cell.row}`) ? ' is-dust' : ''
                            }${winCells.has(`${c}-${cell.row}`) ? ' is-win' : ''}${
                              cell.id === 'scatter' ? ' is-scatter' : ''
                            }${orbClass(value)}${
                              value && cascade?.phase === 'collect' ? ' is-collect' : ''
                            }${
                              shownWins.length &&
                              !winCells.has(`${c}-${cell.row}`) &&
                              cell.id !== 'scatter' &&
                              !value
                                ? ' is-dim'
                                : ''
                            }`}
                            style={
                              {
                                top: `${cell.row * SCELL}px`,
                                '--dy': cell.fall,
                                // Время падения ∝ √высоты — см. .sbcell.is-fall.
                                '--fk': Math.sqrt(cell.fall / SCATTER_ROWS).toFixed(3),
                                '--dur': `${dropDur}ms`,
                                '--delay': `${c * DROP_STAGGER}ms`,
                                '--wi': winOrder.get(`${c}-${cell.row}`) ?? 0,
                                '--i': cell.orbIdx ?? 0,
                                '--len': value ? String(value).length : 1,
                                // Куда лететь при сборе — в центр поля.
                                // Считаем в собственных клетках, без замеров DOM.
                                '--fx': (SCATTER_COLS - 1) / 2 - c,
                                '--fy': `${((SCATTER_ROWS - 1) / 2 - cell.row) * SCELL}px`,
                              } as React.CSSProperties
                            }
                            data-cell={`${c}-${cell.row}`}
                          >
                            <CellFace id={cell.id} skin={skin} />
                          </span>
                        );
                      })}
                    </div>
                  ))
                : plans.map((plan, i) => (
                    <SpinCol
                      key={i}
                      plan={plan}
                      skin={skin}
                      spinId={spinId}
                      anticipate={anti[i] ?? false}
                      onStop={() => {
                        reelStop(i);
                        if (i === SCATTER_COLS - 1) selectionChanged();
                      }}
                    />
                  ))}
              {/* Затемнение живёт всегда и лишь гаснет: раньше оно снималось
                  одним кадром, и поле вспыхивало светлым ровно тогда, когда
                  начиналось падение. */}
              <div
                className={`sboard__dim${shownWins.length ? ' is-on' : ''}`}
                aria-hidden="true"
              />
              {/* Пока считается множитель, поле гаснет: смотреть в этот момент
                  надо на жетон, а не на символы под ним. Вуаль ложится уже под
                  сольный выход — иначе между ним и сбором проскакивал светлый
                  кадр: соло снято, а вуаль ещё только проявляется. */}
              {(cascade?.phase === 'collect' || solo || collectOut) && (
                <div className={`sboard__veil${collectOut ? ' is-out' : ''}`} aria-hidden="true" />
              )}
              <canvas className="dust" ref={dustRef} aria-hidden="true" />
              <div className="reels__glass" aria-hidden="true" />
              {/* Счётчик множителя. В такте сбора он же принимает слетающиеся
                  сферы и отсчитывает сумму вслух — именно здесь видно, что
                  бонус сработал, а не просто «где-то посчиталось». */}
              {/* Счётчик живёт только в такте сбора: до него множителя ещё
                  нет — сферы копятся и срабатывают один раз, в конце. */}
              {(cascade?.phase === 'collect' || collectOut) && collectSum > 0 && (
                <div
                  className={`stamp stamp--t${tier} stamp--${multRarity(collectSum)}${
                    collectOut ? ' is-out' : collectDone ? ' is-slam' : ' is-collect'
                  }`}
                  // Ключ постоянный: цепочка обнуляется в тот же кадр, когда
                  // жетон начинает уходить, и ключ по ней перезапустил бы вход.
                  key="collect"
                  aria-hidden="true"
                >
                  {/* Число — отдельным элементом: у жетона собственный фон, а
                      градиентные ступени красятся через background-clip: text
                      и съели бы оправу, будь они на нём самом. */}
                  {/* Подпись внутри жетона: без неё «×15» посреди поля —
                      просто число. Игрок должен видеть, что это множитель
                      ВЫПЛАТЫ, а не длины цепочки и не чего-то ещё. */}
                  <i className="stamp__cap">выплата</i>
                  {/* Цвет — по редкости СУММЫ, и он растёт вместе с ней: три
                      обычные сферы, сложившись в ×12, на глазах краснеют в
                      редкую находку. */}
                  <b className="stamp__n" ref={stampNumRef}>
                    ×{collectSum}
                  </b>
                </div>
              )}
              {/* Сольный выход редкой сферы: поле гаснет, камень выходит
                  крупно и назван по имени. До этого ×500 улетал в общей
                  волне вместе с ×2 — редкость была написана на нём, но
                  ничем не подтверждалась. */}
              {solo && (
                <div
                  className={`solo orb--${solo.tier.id}${solo.leaving ? ' is-leaving' : ''}`}
                  aria-hidden="true"
                >
                  <div className="solo__gem">
                    <OrbGem />
                    <b className="solo__num">×{solo.value}</b>
                  </div>
                  <div className="solo__name">{solo.tier.name}</div>
                </div>
              )}
              {/* Титул ступени. Он не появляется и не исчезает — он
                  СМЕНЯЕТСЯ: каждый новый прилетает своим кадром, и по нему
                  видно, что счёт пошёл выше, а не остановился. */}
              {counting && winStep && (
                <div
                  className={`win-title win-title--b${winStep.beats}`}
                  key={winStep.id}
                  aria-hidden="true"
                >
                  {winStep.name}
                </div>
              )}
            </div>
            {chain >= 1 && cascade && (
              <div className={`combo combo--t${tier}`} key={chain}>
                <b>{chain >= 2 ? `ЦЕПОЧКА ×${chain}` : 'ЕСТЬ ВЫИГРЫШ'}</b>
                {/* «выплата ×N» здесь больше нет: в такте сбора её и так
                    показывает жетон посреди поля, вдесятеро крупнее. */}
              </div>
            )}
          </div>

          {/* Что именно сыграло: символ, сколько его на поле и сколько платит.
              Линий здесь нет, поэтому объясняем выигрыш словами и числами.

              Контейнер рендерится ВСЕГДА, даже пустым: иначе он то появлялся,
              то пропадал, и вместе с ним на полсотни пикселей ездило всё,
              что ниже, — поле выглядело прыгающим. */}
          <div className="hits" key={`h-${chain}`}>
            {shownWins.length > 0 &&
              shownWins.map((w) => (
                <span className="hit" key={w.symbol}>
                  <Sym id={w.symbol} skin={skin} size={22} />
                  <b>×{w.count}</b>
                  {/* Здесь всегда база: множитель применяется в конце, ко
                      всей последовательности сразу, и показывает его счётчик
                      посередине поля. Проговаривать его ещё и здесь значило
                      бы сообщить итог раньше, чем он случился. */}
                  <i>
                    +{fmt(w.pay * bet)}
                    <CoinIcon size={13} />
                  </i>
                </span>
              ))}
          </div>

          <div className="cabinet__status">
            {cascade || counting ? (
              <>
                <span className={`status status--combo status--t${tier}`}>
                  {/* Во время счёта строка говорит только, что идёт счёт.
                      Название ступени несёт плашка над полем — дублировать
                      его здесь значит забивать узкую строку длинным словом
                      и сжимать сам счётчик. */}
                  {counting ? 'Считаем…' : chain >= 2 ? `Цепочка ×${chain}!` : 'Есть выигрыш!'}
                </span>
                {/* Один и тот же счётчик на весь спин: он набирает базу за
                    каскад, а потом с неё же уезжает к итогу. Раньше здесь
                    сменялись три разных числа с тремя разными анимациями —
                    отсюда и ощущение «проскакивает». */}
                <span className={`status__win${counting ? ' is-counting' : ''}`} ref={winRef}>
                  +<MoneyCounter ref={winOdo} value={0} />
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
                    {/* Без анимации: сумму только что досчитали на глазах,
                        считать её заново было бы враньём. */}
                    +{fmt(result.total)}
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
                // Новый бонус — плашка начинает с чистого листа.
                setShownFs(null);
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
                Сфера с числом от ×2 до ×500 — это <b>такая же клетка барабана</b>, как вишня или
                скаттер: она крутится вместе со всеми, встаёт в поле и съезжает вниз при каскаде.
                Символа под ней нет, поэтому в восьмёрку эта клетка не идёт — в этом и размен: сфера
                платит, но загромождает поле. Выигрышем сфера не бывает, а значит и не исчезает: она
                остаётся на поле до конца цепочки. В самом конце все сферы поля складываются и разом
                умножают весь её выигрыш. Складываются, а не перемножаются: ×20 и ×50 дают ×70.
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
                вращений. В бонусе общий множитель не сбрасывается между вращениями: сферы копят его
                до самого конца бонуса. Три скаттера внутри бонуса добавляют ещё вращения. Выигрыш
                за одно вращение ограничен {fmt(MAX_WIN)} ставками.
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

      {lvlShown && (
        <div
          className={`levelup${lvlLeaving ? ' is-leaving' : ''}`}
          data-skin={skin}
          onClick={() => setLevelUp(null)}
          role="presentation"
        >
          <div className="levelup__card">
            <div className="levelup__lvl">Уровень {lvlShown.level}</div>
            <div className="levelup__gain">
              +{fmt(lvlShown.coins)}
              <CoinIcon size={18} />
              {lvlShown.freeSpins > 0 && <span> · 🎟 {lvlShown.freeSpins}</span>}
            </div>
          </div>
        </div>
      )}

      {totem && (
        <div
          className={`totem${totemLeaving ? ' is-leaving' : ''} totem--${winStep && winStep.beats >= 3 ? 'mega' : totem.tier}`}
          style={{ '--ox': `${totem.ox}px`, '--oy': `${totem.oy}px` } as React.CSSProperties}
          onClick={() => {
            // Пока идут деньги — тап досчитывает их, а не закрывает карточку.
            // Закрыть недосчитанный выигрыш нельзя: это выглядело бы как
            // «отобрали».
            if (!skipCount()) setCelebration(null);
          }}
          role="presentation"
        >
          <div className="totem__flash" />
          <div className="totem__glow" />
          {/* Лучи — только у мега-выигрыша: если крутить их каждый раз,
              они перестают что-либо значить. Ступень берём из счёта, поэтому
              лучи включаются ровно в тот момент, когда он до них добирается. */}
          {(winStep ? winStep.beats >= 3 : totem.tier === 'mega') && (
            <div className="totem__rays" aria-hidden="true" />
          )}
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
            {/* Титул живёт ступенью счёта и меняется прямо на глазах: карточка
                открывается «КРУПНЫМ ВЫИГРЫШЕМ», а через пару секунд на ней
                уже «МЕГА». Ключ по ступени — чтобы каждый титул прилетал
                своим кадром, а не подменялся текстом. */}
            <div className="totem__title" key={winStep?.id ?? totem.tier}>
              {winStep?.name ?? (totem.tier === 'mega' ? 'МЕГА-ВЫИГРЫШ' : 'КРУПНЫЙ ВЫИГРЫШ')}
            </div>
            <div className="totem__amount">
              {/* Счётчик НЕ начинается заново: он продолжает тот же счёт,
                  что шёл в автомате, просто теперь на крупном плане. */}
              <MoneyCounter ref={totemOdo} value={wonRef.current} />
              <CoinIcon size={30} />
            </div>
            <div className="totem__hint">
              {counting ? 'нажмите, чтобы досчитать' : 'нажмите, чтобы продолжить'}
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}
