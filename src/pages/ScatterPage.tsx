import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAction } from '@/input/hooks';
import { AnimatedNumber } from '@/components/ui';
import { useNavigate } from 'react-router-dom';
import { GameScreen } from '@/game-shell/GameScreen';
import { GameTop, GxSheet, KIcon } from '@/components/gx';
import { Bar, Button } from '@/ui-px';
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
import { CoinIcon, OrbGem } from '@/components/slot-art';
import { skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { CashDesk } from '@/components/CashDesk';
import { SkinSheet } from '@/components/SkinSheet';
import { useFinanceStore } from '@/store';
import { useExit } from '@/lib/use-exit';
import { useGameAudio } from '@/lib/use-game-audio';
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
  mkOrb,
  orbOf,
  scatterLabel,
  scatterSymbol,
} from '@/lib/scatter';
import type {
  Orb,
  ScatterCell,
  ScatterGrid,
  ScatterRound,
  ScatterStep,
  ScatterWin,
} from '@/lib/scatter';
import type { SlotSymbolId } from '@/types';
import { BET_STEP, BETS, clampBet, MAX_BET, MIN_BET } from '@/lib/slots';
import { levelFromXp, levelReward } from '@/lib/slots-meta';
import { fmtCompact, fmtDec, fmtNum, orbName, rich, t, useT, winStepName } from '@/i18n';
import { loudestTier, multRarity, ORB_TIERS, orbTier } from '@/lib/orb-rarity';
import type { OrbTier } from '@/lib/orb-rarity';
import { plainPlan, rollupPlan, runRollup, winTier } from '@/lib/rollup';
import { planReel, restReel } from '@/lib/reel-motion';
import { MERGE, planMerge } from '@/lib/orb-merge';
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
  bubbleForm,
  bubbleMerge,
  bubblePop,
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

const AUTO_OPTIONS: { value: number; label: string; hint: 'h10' | 'h25' | 'h50' | 'hInf' }[] = [
  { value: 10, label: '10', hint: 'h10' },
  { value: 25, label: '25', hint: 'h25' },
  { value: 50, label: '50', hint: 'h50' },
  { value: Infinity, label: '∞', hint: 'hInf' },
];

/** Общая «никто не тянет» — константа, чтобы не плодить массивы каждый спин. */
const EMPTY_ANTI: boolean[] = Array(SCATTER_COLS).fill(false);

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

const fmt = fmtNum;

/** Подпись результата на языке игрока (`scatterLabel` в lib — по-русски, для тестов). */
function scatterText(out: ScatterRound): string {
  if (out.freeSpins && !out.steps.length) return t('slots.outcome.scatBonus', { n: out.scatters });
  if (out.kind === 'none') return t('slots.outcome.miss');
  const best = out.steps.flatMap((s) => s.wins).sort((a, b) => b.pay - a.pay)[0];
  if (!best) return t('slots.outcome.scatPaid');
  if (out.combo >= 2) return t('slots.status.chainOf', { n: out.combo });
  return t('slots.outcome.symbols', { n: best.count });
}

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
function CellFace({
  id,
  skin,
  size = SYM,
  bubble = false,
}: {
  id: ScatterCell;
  skin: SkinId;
  size?: number;
  /** Сфера сейчас сливается с другими — вокруг камня надут пузырь. */
  bubble?: boolean;
}) {
  const value = orbOf(id);
  if (!value) return <Sym id={id as SlotSymbolId | 'scatter'} skin={skin} size={size} />;
  const t = orbTier(value);
  // Тело — отдельной обёрткой: клетку двигает план слияния, а тело внутри
  // колышется от ударов. Два трансформа на одном элементе дрались бы.
  return (
    <span className="orb__body">
      {t.beats >= 2 && <i className="orb__ring" aria-hidden="true" />}
      <OrbGem />
      <b className="orb__num">×{value}</b>
      {bubble && <Bubble />}
      {/* Подписи ступени на самой клетке нет. «ЛЕГЕНДАРНАЯ» в 7 px не влезала
          в крайнюю колонку и срезалась полем, а главное — она тут и не нужна:
          имя называет сольный выход, крупно и целиком. На клетке о редкости
          говорят цвет и орбита. */}
    </span>
  );
}

/** Брызги лопнувшего пузыря: углы и дальность разные — чтобы не звездой. */
const DROPS = Array.from({ length: 11 }, (_, i) => ({
  a: i * 33 + ((i * 47) % 19),
  d: 0.7 + ((i * 37) % 10) / 22,
  s: 3 + ((i * 29) % 4),
}));

/**
 * Мыльный пузырь вокруг камня. Плёнка — два неподвижных конических слоя,
 * перелив — их встречная смена прозрачности: вращать внутри корпуса нельзя
 * (скруглённый overflow снимает вращение с композитора на части Android
 * WebView, см. CLAUDE.md), а прозрачность считает композитор всегда.
 */
function Bubble() {
  return (
    <i className="bubble" aria-hidden="true">
      <i className="bubble__film" />
      <i className="bubble__film bubble__film--b" />
      <i className="bubble__shine" />
      {DROPS.map((d, i) => (
        <i
          key={i}
          className="bubble__drop"
          style={
            {
              '--a': `${d.a}deg`,
              '--d': d.d,
              '--s': `${d.s}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </i>
  );
}

/** Поглощаемый пузырь вытягивается к цели — его втягивает общая плёнка. */
function stretch(el: Element | null | undefined, angle: number, k: number): void {
  if (!el || reduceMotion()) return;
  const r = `${angle.toFixed(3)}rad`;
  try {
    el.animate(
      [
        { transform: `rotate(${r}) scale(1, 1) rotate(-${r})` },
        { transform: `rotate(${r}) scale(1.28, 0.8) rotate(-${r})` },
      ],
      { duration: MERGE.absorbMs * k, easing: 'ease-in', fill: 'forwards' },
    );
  } catch {
    /* без WAAPI — просто вольётся */
  }
}

/**
 * Колыхание общего пузыря после слияния: удар приходит с той стороны, откуда
 * влился поглощённый, и плёнка затухающе качается по этой оси. Объём
 * сохраняется (sx·sy ≈ 1) — отсюда «жидкое», а не «резиновое».
 */
function wobble(el: Element | null | undefined, angle: number, k: number): void {
  if (!el || reduceMotion()) return;
  const r = `${angle.toFixed(3)}rad`;
  const f = (sx: number, sy: number) => ({
    transform: `rotate(${r}) scale(${sx}, ${sy}) rotate(-${r})`,
  });
  try {
    el.animate([f(1, 1), f(0.8, 1.22), f(1.14, 0.88), f(0.95, 1.05), f(1.02, 0.98), f(1, 1)], {
      duration: 460 * Math.max(0.6, k),
      easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)',
    });
  } catch {
    /* без WAAPI — без колыхания */
  }
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
  /** Растёт по «Пропустить»: колонка встаёт сразу (useReelSpin). */
  slam: number;
}

/** Колонка перерисовывается только при новой ленте — см. `Reel` в «Слотах». */
const SpinCol = memo(
  function SpinCol({ plan, skin, spinId, anticipate, onStop, slam }: SpinColProps) {
    const ref = useRef<HTMLDivElement>(null);
    // До отрисовки, а не после: иначе первый кадр спина успевал показать
    // ленту в исходном положении, ещё без анимации.
    useReelSpin(ref, plan, spinId, onStop, slam);

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
    a.anticipate === b.anticipate &&
    a.slam === b.slam,
);

export function ScatterPage() {
  const tr = useT();
  const hydrated = useFinanceStore((s) => s.hydrated);
  const balance = useFinanceStore((s) => s.slotsBalance);
  const bet = useFinanceStore((s) => s.slotsBet);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const sound = useFinanceStore((s) => s.slotsSound);
  const music = useFinanceStore((s) => s.slotsMusic);
  useGameAudio('cascade', 'slots');
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

  const [plans, setPlans] = useState<ReelPlan<ScatterCell>[]>(() =>
    startGrid().map((col) => restReel(col, () => fillerCell(), SCELL)),
  );
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  /** Какие колонки тянут время: на поле уже три скаттера из четырёх. */
  const [anti, setAnti] = useState<boolean[]>(EMPTY_ANTI);
  // «Пропустить» (кнопка «Крутить» во время спина): `slam` ставит колонки на место, `hurry` —
  // темп оставшихся звеньев, сбора сфер и счёта, `reelsDone` — досрочный конец вращения.
  const [slam, setSlam] = useState(0);
  const [hurried, setHurried] = useState(false);
  const hurry = useRef(1);
  const skipAt = useRef(-1e9);
  const reelsDone = useRef<(() => void) | null>(null);
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
  /**
   * Слияние пузырями: `on` — сферы надуты и плывут, `pop` — общий лопнул.
   * Класс висит на всём поле, а не на клетках: поглощённые к этому времени
   * уже невидимы, и лопается ровно тот, кто остался.
   */
  const [merging, setMerging] = useState<'on' | 'pop' | null>(null);
  /** «Дожать слияние» — по тапу, пока пузыри ещё плывут. */
  const mergeSkip = useRef<(() => void) | null>(null);
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
  };
  /** Счётчик выигрыша: его толкает удар множителя. */
  const winRef = useRef<HTMLSpanElement>(null);
  /** Число на жетоне: его толкает каждая долетевшая сфера. */
  const stampNumRef = useRef<HTMLElement>(null);
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
    stopReelSound();
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
      const speed = (turbo ? TURBO : 1) * hurry.current;
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
    if (mergeSkip.current) {
      const fast = mergeSkip.current;
      mergeSkip.current = null;
      tapLight();
      fast();
      return true;
    }
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
      const scale = (turbo ? TURBO : 1) * hurry.current;
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
      const scale = (turbo ? TURBO : 1) * hurry.current;
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

      const slam = (refillDelay = 0) => {
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
        const refill = () => {
          const holes = new Set(res.orbs.map((o) => `${o.col}-${o.row}`));
          setDropDur(DROP_MS * scale);
          setMerging(null);
          // Считаем снаружи, а не в updater'е setBoard: в StrictMode React
          // зовёт updater дважды, и случайные символы досыпки разошлись бы с
          // тем, что запомнено как «на поле сейчас».
          const now = boardNow.current;
          if (now) {
            const next = dropHoles(now, holes, `refill-${res.steps.length}`);
            shownGrid.current = next.map((col) => col.map((cell) => cell.id));
            setBoard(next);
          }
        };
        // После пузыря досыпка ждёт, пока доиграют брызги: клетка лопнувшего
        // пузыря уходит с поля вместе с ними.
        if (refillDelay > 0) timers.current.push(setTimeout(refill, refillDelay));
        else refill();
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

      /**
       * Слияние пузырями — когда сфер на поле больше одной (lib/orb-merge.ts).
       * План двигает сами клетки-сферы: они надуваются пузырями, плывут,
       * вливаются друг в друга, и число на общем пузыре растёт с каждым
       * слиянием. Общий лопается — и из брызг встаёт жетон с ударом.
       *
       * Тап по автомату дожимает слияние до конца: как и счёт, оно обязано
       * быть пропускаемым — в автоспине и бонусе особенно.
       */
      const mergeCollect = () => {
        const host = boardRef.current;
        const found = res.orbs
          .map((o) => {
            const el = host?.querySelector<HTMLElement>(`[data-cell="${o.col}-${o.row}"]`);
            const col = el?.parentElement;
            if (!el || !col) return null;
            // offset*, а не getBoundingClientRect: корпус в этот миг может
            // трястись (juice), и повёрнутая рамка сдвинула бы замер.
            return {
              id: `${o.col}-${o.row}`,
              x: col.offsetLeft + el.offsetLeft + el.offsetWidth / 2,
              y: col.offsetTop + el.offsetTop + el.offsetHeight / 2,
              value: o.value,
              el,
            };
          })
          .filter((o): o is NonNullable<typeof o> => !!o);
        if (!host || found.length < 2) {
          collect();
          return;
        }

        const plan = planMerge(found, {
          width: host.clientWidth,
          height: host.clientHeight,
          radius: Math.min(found[0].el.offsetWidth, found[0].el.offsetHeight) / 2,
          speed: scale,
          stampShown: start > 0,
        });
        const k = plan.timeScale;
        const byId = new Map(found.map((o) => [o.id, o]));
        const body = (id: string) => byId.get(id)?.el.querySelector<HTMLElement>('.orb__body');
        const local: ReturnType<typeof setTimeout>[] = [];
        const at = (ms: number, fn: () => void) => {
          const t = setTimeout(fn, ms);
          local.push(t);
          timers.current.push(t);
        };

        setCascade({ step: Math.max(0, res.steps.length - 1), phase: 'collect' });
        setCollectSum(start);
        setCollectDone(false);
        setMerging('on');
        bubbleForm();

        // Пути: клетка едет от своего гнезда, поэтому сдвиг — от него.
        const anims: Animation[] = [];
        for (const o of found) {
          const frames = plan.tracks[o.id];
          if (!frames?.length) continue;
          try {
            anims.push(
              o.el.animate(
                frames.map((f) => ({
                  offset: Math.min(1, f.t / plan.end),
                  transform: `translate(${(f.x - o.x).toFixed(1)}px, ${(f.y - o.y).toFixed(1)}px) scale(${f.s.toFixed(3)})`,
                  opacity: f.o,
                })),
                { duration: plan.end, fill: 'forwards' },
              ),
            );
          } catch {
            /* движок без WAAPI — пузыри постоят, суммы всё равно сложатся */
          }
        }

        const showSum = (id: string, sum: number) => {
          const [c, r] = id.split('-').map(Number);
          setBoard((b) =>
            b
              ? b.map((col, ci) =>
                  ci !== c
                    ? col
                    : col.map((cell) => (cell.row === r ? { ...cell, id: mkOrb(sum) } : cell)),
                )
              : b,
          );
        };

        for (const m of plan.merges) {
          // Поглощаемый вытягивается к цели — его втягивает плёнка.
          at(Math.max(0, m.at - MERGE.absorbMs * k), () => stretch(body(m.from), m.angle, k));
          at(m.at, () => {
            showSum(m.into, m.sum);
            bubbleMerge(m.k);
            selectionChanged();
            wobble(body(m.into), m.angle, k);
          });
        }

        // Легендарная и выше: общий пузырь висит лишний такт — тишина перед ударом.
        const hold = loudest.beats >= 3 ? 520 * scale : 0;
        const pop = (delay: number) => {
          at(delay, () => {
            // Лопнул — дожимать больше нечего. Иначе тап во время удара
            // перезапустил бы лопание, и жетон ударил бы дважды.
            mergeSkip.current = null;
            setMerging('pop');
            bubblePop();
            tapLight();
          });
          at(delay + 70 * scale, () => slam(240 * scale));
          at(delay + 70 * scale + 420 * scale, () => {
            setCollectOut(true);
            toPayout();
            timers.current.push(setTimeout(() => setCollectOut(false), 300 * scale));
          });
        };
        pop(plan.end + hold);

        mergeSkip.current = () => {
          local.forEach(clearTimeout);
          local.length = 0;
          anims.forEach((a) => {
            try {
              a.finish();
            } catch {
              /* уже снята */
            }
          });
          const last = plan.merges[plan.merges.length - 1];
          if (last) showSum(last.into, last.sum);
          pop(0);
        };
      };

      // Сфер больше одной — сливаются пузырями; одна улетает в жетон, как раньше.
      const run = order.length >= 2 && !reduceMotion() ? mergeCollect : collect;

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
            run();
          }, shown),
          setTimeout(() => setSolo(null), shown + 260 * scale),
        );
      } else {
        run();
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
    const antiTimers: ReturnType<typeof setTimeout>[] = [];
    antiCols.forEach((on, c) => {
      if (!on) return;
      antiTimers.push(
        setTimeout(
          () => {
            antiSound();
            tapLight();
          },
          c === 0 ? 0 : durs[c - 1],
        ),
      );
    });
    timers.current.push(...antiTimers);
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
    setMerging(null);
    mergeSkip.current = null;
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
    hurry.current = 1;
    setHurried(false);

    stopReelSound();
    if (!reduceMotion()) startReelSound(turbo);

    // Колонки отъехали (или их остановил «Пропустить») — дальше сферы, каскад или деньги.
    const landAt = durs[durs.length - 1] + 60;
    const landTimer = setTimeout(() => reelsDone.current?.(), landAt);
    timers.current.push(landTimer);
    reelsDone.current = () => {
      reelsDone.current = null;
      clearTimeout(landTimer);
      // Вой предвкушения ещё не начался — и не начнётся.
      antiTimers.forEach(clearTimeout);
      stopReelSound();
      // Подменять поле на сетку здесь больше НЕ НУЖНО и не нужно снова:
      // сферы приехали в самой ленте и уже стоят в своих клетках — это те
      // же клетки, которые только что крутились. Остаётся озвучить находку
      // и дать её разглядеть, прежде чем начнётся каскад.
      const landed = res.steps[0]?.orbs ?? res.orbs;
      if (landed.length) playOrbs(landed);
      const pause = landed.length ? 460 * (turbo ? TURBO : 1) * hurry.current : 0;
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
    };
  }, [hydrated, spinning, balance, stake, playScatter, turbo, playOrbs]);

  /**
   * «Пропустить» — та же кнопка «Крутить», пока спин идёт: исход уже решён, правила не
   * тронуты. Первое нажатие ставит колонки на место сразу; следующие досчитывают текущий ход
   * (и дожимают слияние сфер), а оставшиеся звенья и счёт идут в темпе SKIP_TEMPO.
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

  // Пробел/Enter и «A» геймпада — крутить, как в «Слотах» (слой действий).
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

  const label = result ? scatterLabel(result) : null;

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
          setRules(true);
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
        <div className="slots cas-bg" data-skin={skin}>
          <div className="slots-scene" aria-hidden="true">
            <span className="slots-scene__decor" />
          </div>
        </div>
      }
      top={
        lying ? undefined : <GameTop title={tr('hall.cascade')} onBack={goBack} right={topRight} />
      }
    >
      {/* --speed уезжает во ВСЕ анимации каскада. Без него турбо сжимал
          только паузы на таймерах, а CSS-анимации шли в полную длину и
          обрывались на середине — отсюда «в турбо всё не попадает». */}
      <div
        className="slots scatter cas cas--scatter"
        data-skin={skin}
        ref={pageRef}
        data-lay={lay}
        style={
          { '--speed': (turbo ? TURBO : 1) * (hurried ? SKIP_TEMPO : 1) } as React.CSSProperties
        }
      >
        <section className="cas-info px">
          {lying && <CasTools onBack={goBack}>{topRight}</CasTools>}
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
          {/* Без монет подсказка встаёт на место «лучшего спина» — та же
              ячейка, ничего не сдвигается. */}
          {broke ? (
            <p className="cas-broke cas-stat--best">{tr('slots.brokeHint')}</p>
          ) : (
            <CasStat
              fit
              className="cas-stat--best"
              tone="gold"
              icon={<KitIcon name="star" />}
              value={
                <>
                  {/* Рекорд — не крутящийся баланс: короткая запись, точное — в подсказке. */}
                  <AnimatedNumber value={best} format={(n) => fmtCompact(n)} duration={450} />
                  <CoinIcon size={16} />
                </>
              }
              label={tr('slots.hud.best')}
              tip={`${tr('slots.hud.best')}: ${fmt(best)}`}
            />
          )}
          <CasStat
            fit
            className="cas-stat--sp"
            icon={<KitIcon name="play" />}
            value={fmt(spins)}
            label={tr('slots.session.spins')}
          />
        </section>

        <div className="cas-stage" ref={stageRef}>
          <div className="cas-fit" style={fitCss.wrap}>
            {/* Трясёт корпус автомата, а не всю страницу: внутри Telegram дёрганье
                всего экрана читается как баг вебвью, а не как удар. */}
            {/* Тап по автомату досчитывает выплату. Длинный счёт обязан быть
                пропускаемым — иначе награда за крупный выигрыш превращается в
                наказание ожиданием, особенно в автоспине. */}
            <div
              className={`cabinet cabinet--wide${inBonus ? ' is-bonus' : ''}`}
              ref={cabinetRef}
              style={fitCss.item}
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
                    <span className="sign-bonus__label">{tr('slots.cascade.bonus')}</span>
                    {/* Числа — состояние ПОЛЯ, а не стора: пока крутится, они
                        держат прошлые значения и не выдают результат вперёд
                        барабанов. Раньше плашка успевала показать новый множитель
                        до того, как сферы появлялись на поле. */}
                    <span className="sign-bonus__left">
                      {tr('slots.cascade.left', { n: shownFs?.left ?? fs.left })}
                    </span>
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
                  className={`sboard${merging ? ' is-merging' : ''}${merging === 'pop' ? ' is-popping' : ''}`}
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
                                  value && cascade?.phase === 'collect' && !merging
                                    ? ' is-collect'
                                    : ''
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
                                <CellFace id={cell.id} skin={skin} bubble={!!merging && !!value} />
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
                          slam={slam}
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
                    <div
                      className={`sboard__veil${collectOut ? ' is-out' : ''}`}
                      aria-hidden="true"
                    />
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
                      <i className="stamp__cap">{tr('slots.stamp')}</i>
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
                      <div className="solo__name">{orbName(solo.tier.id)}</div>
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
                      {winStepName(winStep.id)}
                    </div>
                  )}
                </div>
                {chain >= 1 && cascade && (
                  <div className={`combo combo--t${tier}`} key={chain}>
                    <b>{chain >= 2 ? tr('slots.chainCap', { n: chain }) : tr('slots.anyWin')}</b>
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
                    ? tr('slots.status.chain', { n: chain })
                    : tr('slots.status.win')}
              </span>
              {/* Один и тот же счётчик на весь спин: он набирает базу за
                  каскад, а потом с неё же уезжает к итогу. Раньше здесь
                  сменялись три разных числа с тремя разными анимациями —
                  отсюда и ощущение «проскакивает». */}
              <span className={`status__win${counting ? ' is-counting' : ''}`} ref={winRef}>
                +<MoneyCounter ref={winOdo} value={0} format={fmt} />
                <CoinIcon size={20} />
              </span>
            </>
          ) : spinning ? (
            <span className="status status--spin">{tr('slots.status.spinning')}</span>
          ) : result && label ? (
            <>
              <span className="status">
                {label.symbol && <Sym id={label.symbol} skin={skin} size={22} />}
                {scatterText(result)}
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
            <span className="status status--hint">
              {tr('slots.status.hintCollect', { n: CLUSTER_MIN })}
            </span>
          )}
        </div>

        <CasDeck
          balance={
            <>
              {/* Баланс — тот же механический счётчик, и во время выплаты он
                  крутится В ОДИН ХОД с выигрышем: видно, как деньги прибывают
                  в карман, а не появляются там задним числом. */}
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
              : inBonus && fs
                ? tr('slots.btn.bonusShort')
                : broke
                  ? tr('slots.btn.brokeShort')
                  : freeSpins > 0
                    ? tr('slots.btn.freeShort')
                    : tr('slots.btn.spinShort')
          }
          spinBadge={
            auto > 0
              ? undefined
              : inBonus && fs
                ? fmt(fs.left)
                : freeSpins > 0
                  ? fmt(freeSpins)
                  : undefined
          }
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
          extra={
            /* Ставка Ante и покупка бонуса — оба пути к фриспинам. В бонусе
               ряд не исчезает, а гаснет: иначе поле над ним прыгало бы. */
            <div
              className={`cas-bonus${inBonus ? ' is-hidden' : ''}`}
              aria-hidden={inBonus || undefined}
            >
              <Button
                on={ante}
                off={spinning}
                data-tip={tr('slots.cascade.anteHint', { n: ANTE_COST })}
                aria-label={`Ante · ${tr('slots.cascade.anteHint', { n: ANTE_COST })}`}
                onClick={() => {
                  if (spinning || inBonus) return;
                  selectionChanged();
                  setAnte(!ante);
                }}
              >
                <b>Ante</b>
                {/* Одна строка значков вместо абзаца в кнопке: монета — во сколько
                    раз ставка, скаттер — во сколько раз чаще бонус (≈ вдвое, см.
                    правила); фраза целиком — в подсказке и в листе правил. */}
                <i className="cas-bonus__sub" aria-hidden="true">
                  <CoinIcon size={14} />
                  {tr('slots.cascade.anteChip', { n: ANTE_COST })}
                  <span className="cas-bonus__sep">·</span>
                  <Sym id="scatter" skin={skin} size={16} />
                  {tr('slots.cascade.anteChip', { n: 2 })}
                </i>
              </Button>
              <Button
                kind="primary"
                off={spinning || balance < buyCost}
                onClick={() => {
                  if (spinning || inBonus || balance < buyCost) return;
                  if (!buyBonus()) return;
                  // Новый бонус — плашка начинает с чистого листа.
                  setShownFs(null);
                  tapMedium();
                  primeAudio();
                  jackpotFanfare();
                  burstConfetti(80, theme.confetti);
                }}
              >
                <b>{tr('slots.cascade.buy')}</b>
                <i>
                  {fmt(buyCost)}
                  <CoinIcon size={13} />
                </i>
              </Button>
            </div>
          }
        />
      </div>

      {rules && (
        <GxSheet title={tr('slots.rules.title')} onClose={() => setRules(false)}>
          {/* Раздел = заголовок + одна строка + картинка; длинные абзацы — под «Подробнее»
              (critic K2 #8). Редкость сфер — чернильные плашки цвета ступени. */}
          <div className="cas-rules">
            <section className="cas-rules__sec">
              <h3 className="cas-rules__h">{tr('slots.rules.anyTitle')}</h3>
              <p className="cas-rules__lead">{tr('slots.cascade.howShort', { n: CLUSTER_MIN })}</p>
              <div className="paytable">
                {[...SCATTER_PAYS].reverse().map((p) => (
                  <div className="paytable__row cas-well" key={p.id}>
                    <span className="paytable__syms">
                      <Sym id={p.id} skin={skin} size={26} />
                    </span>
                    <span className="paytable__mult px-num">×{p.tiers[2]}</span>
                    <span className="paytable__pair px-num">
                      8–9 ×{p.tiers[0]} · 10–11 ×{p.tiers[1]}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            <section className="cas-rules__sec">
              <h3 className="cas-rules__h">{tr('slots.rules.orbTitle')}</h3>
              <p className="cas-rules__lead">{tr('slots.rules.orbShort')}</p>
              <div className="rarity-ladder">
                {ORB_TIERS.map((t) => (
                  <div className={`rarity-row rarity-row--${t.id} cas-well`} key={t.id}>
                    <b className="rarity-row__name">{orbName(t.id)}</b>
                    <span className="rarity-row__range px-num">
                      {t.id === 'mythic' ? '×250 — ×500' : tr('slots.rules.fromX', { n: t.min })}
                    </span>
                    <span className="rarity-row__odds px-num">{fmtDec(t.chance, 1)}%</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="cas-rules__sec">
              <h3 className="cas-rules__h">{tr('slots.rules.scatTitle')}</h3>
              <p className="cas-rules__lead">
                {tr('slots.rules.scatShort', { trigger: SCATTER_TRIGGER, fs: FREE_SPINS })}
              </p>
              <div className="combo-rules__ladder">
                {[4, 5, 6].map((n) => (
                  <span key={n} className="combo-rules__step cas-well">
                    <b className="px-num">{n === 4 ? SCATTER_TRIGGER : n}</b>
                    <i className="px-num">×{SCATTER_PAYOUTS[n]}</i>
                  </span>
                ))}
              </div>
            </section>
            <section className="cas-rules__sec">
              <h3 className="cas-rules__h">{tr('slots.rules.anteTitle')}</h3>
              <p className="cas-rules__lead">
                {keepDot(tr('slots.rules.anteShort', { ante: ANTE_COST, buy: BUY_BONUS_COST }))}
              </p>
            </section>
            <details className="cas-more">
              <summary>{tr('slots.pay.more')}</summary>
              <p>
                {tr('slots.rules.any', { cols: SCATTER_COLS, rows: SCATTER_ROWS, n: CLUSTER_MIN })}
              </p>
              <p>{rich('slots.rules.orb', { cell: <b>{tr('slots.rules.orbCell')}</b> })}</p>
              <p>{tr('slots.rules.orb2')}</p>
              <p>
                {tr('slots.rules.scat', {
                  trigger: SCATTER_TRIGGER,
                  p4: SCATTER_PAYOUTS[4],
                  p5: SCATTER_PAYOUTS[5],
                  p6: SCATTER_PAYOUTS[6],
                  fs: FREE_SPINS,
                  max: MAX_WIN,
                })}
              </p>
              <p>
                {tr('slots.rules.ante', { ante: ANTE_COST, buy: BUY_BONUS_COST, fs: FREE_SPINS })}
              </p>
              <p>{tr('slots.rules.note')}</p>
            </details>
          </div>
        </GxSheet>
      )}

      {autoSheet && (
        <GxSheet title={tr('slots.a11y.auto')} onClose={() => setAutoSheet(false)}>
          <CasAutoPicker
            options={AUTO_OPTIONS}
            hint={(h) => tr(`slots.auto.${h}`)}
            onPick={(v) => {
              selectionChanged();
              primeAudio();
              setAutoSheet(false);
              setAuto(v);
            }}
          />
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

      {settings && (
        <GxSheet title={tr('common.settings')} onClose={() => setSettings(false)}>
          <CasToggles
            items={[
              {
                key: 'sound' as const,
                on: sound,
                icon: sound ? ('sound' as const) : ('mute' as const),
                name: tr('slots.toggle.sound'),
                hint: tr('slots.toggle.soundCascade'),
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

      {skinSheet && <SkinSheet onClose={() => setSkinSheet(false)} />}

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
              {winStepName(winStep?.id ?? (totem.tier === 'mega' ? 'mega' : 'big'))}
            </div>
            <div className="totem__amount">
              {/* Счётчик НЕ начинается заново: он продолжает тот же счёт,
                  что шёл в автомате, просто теперь на крупном плане. */}
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
