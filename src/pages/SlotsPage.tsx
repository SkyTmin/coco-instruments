import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { CoinIcon, SlotArtDefs } from '@/components/slot-art';
import { SKINS, skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { IconGift, IconInfo, IconLock } from '@/components/icons';
import { CashDesk } from '@/components/CashDesk';
import { useFinanceStore } from '@/store';
import type { SlotsSpinOutcome } from '@/store';
import {
  DAILY_LADDER,
  EMPTY_COUNTERS,
  SKIN_UNLOCK,
  WHEEL,
  WHEEL_COOLDOWN_MS,
  dailyMissions,
  dailyStatus,
  dayKey,
  isSkinUnlocked,
  ladderReward,
  levelFromXp,
  levelReward,
  missionDone,
} from '@/lib/slots-meta';
import type { WheelSector } from '@/lib/slots-meta';
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
  RESCUE_COOLDOWN_MS,
  RESCUE_SPINS,
  ROWS,
  SLOT_SYMBOLS,
  symbolOf,
} from '@/lib/slots';
import type { CascadeStep, LineWin, SlotGrid, SlotSymbolId, SpinResult } from '@/lib/slots';
import { DUST_MS, dustBurst } from '@/lib/dust';
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

// Высота ячейки барабана — та же величина в CSS (--cell): лента двигается на
// целое число ячеек, поэтому символы всегда встают ровно в окно.
const CELL = 74;
/** Сколько случайных «пролетающих» символов между стартом и результатом. */
const FILLER = 18;
const BASE_MS = 900;
const STEP_MS = 280;
/** Пауза перед последним барабаном, когда на линии уже два премиума. */
const ANTICIPATION_MS = 900;
/** Варианты автоспина. Infinity — крутить, пока не кончатся монеты. */
const AUTO_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 10, label: '10', hint: 'десять вращений' },
  { value: 25, label: '25', hint: 'двадцать пять' },
  { value: 50, label: '50', hint: 'пятьдесят' },
  { value: Infinity, label: '∞', hint: 'пока не кончатся монеты' },
];
/** Каскад: подсветить выигрыш → рассыпать символы в пыль → уронить верхние. */
const SHOW_MS = 700;
const BURST_MS = 320;
const DROP_MS = 430;
/** Сдвиг падения по колонкам — столбцы приземляются не разом. */
const DROP_STAGGER = 70;

/** Один сектор колеса удачи в градусах. */
const SECTOR = 360 / WHEEL.length;
/** Сколько крутится колесо до остановки. */
const WHEEL_MS = 4200;

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
function Reel({
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

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || spinId === 0) return;
    const to = -(strip.length - ROWS - 1) * CELL;
    if (reduceMotion()) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${to}px)`;
      stopRef.current();
      return;
    }
    el.style.transition = 'none';
    el.style.transform = 'translateY(0)';
    el.classList.add('is-blur');
    void el.offsetHeight; // reflow, иначе браузер склеит оба присваивания
    // Небольшой «перелёт» в конце — барабан отскакивает, как механический.
    el.style.transition = `transform ${duration}ms cubic-bezier(.18,.76,.24,1.06)`;
    el.style.transform = `translateY(${to}px)`;
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
            <Sym id={id} skin={skin} />
          </span>
        ))}
      </div>
    </div>
  );
}

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

/** «3 ч 20 мин» — сколько ждать до следующей бесплатной награды. */
function fmtLeft(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Точка на окружности по углу, отсчитанному по часовой стрелке от «12 часов». */
function polar(deg: number, r: number): string {
  const a = (deg * Math.PI) / 180;
  return `${(Math.sin(a) * r).toFixed(2)} ${(-Math.cos(a) * r).toFixed(2)}`;
}

/** Короткая надпись сектора — в 45° дуги длинный текст не помещается. */
function sectorFace(s: WheelSector): string {
  return s.freeSpins ? `${s.freeSpins} вращ.` : fmt(s.coins);
}

/**
 * Колесо удачи. Диск поворачивается ровно к тому сектору, который выбрал
 * spinWheel() — картинка всегда показывает настоящий результат.
 */
function WheelArt({ angle, instant }: { angle: number; instant: boolean }) {
  return (
    <div className="wheel">
      <span className="wheel__pin" aria-hidden="true" />
      <svg
        className="wheel__disc"
        viewBox="-50 -50 100 100"
        style={{
          transform: `rotate(${angle}deg)`,
          transition: instant ? 'none' : `transform ${WHEEL_MS}ms cubic-bezier(.12,.72,.15,1)`,
        }}
        aria-hidden="true"
      >
        <circle className="wheel__rim" cx="0" cy="0" r="47" />
        {WHEEL.map((s, i) => {
          const a0 = i * SECTOR;
          const a1 = a0 + SECTOR;
          const top = s.coins >= 2500;
          return (
            <path
              key={s.label}
              className={`wheel__sec${i % 2 ? ' is-alt' : ''}${top ? ' is-top' : ''}`}
              d={`M 0 0 L ${polar(a0, 44)} A 44 44 0 0 1 ${polar(a1, 44)} Z`}
            />
          );
        })}
        {WHEEL.map((s, i) => {
          const face = sectorFace(s);
          const at = (i + 0.5) * SECTOR;
          // Левая половина колеса: без разворота надпись читалась бы вверх ногами.
          const flip = at > 90 && at < 270;
          return (
            <text
              key={s.label}
              className={`wheel__label${s.freeSpins ? ' is-small' : ''}`}
              transform={`rotate(${at}) translate(0 -30)${flip ? ' rotate(180)' : ''}`}
              textAnchor="middle"
              dy={flip ? -2 : 2}
            >
              {face}
            </text>
          );
        })}
        <circle className="wheel__hub" cx="0" cy="0" r="9" />
      </svg>
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
  const jackpotPool = useFinanceStore((s) => s.slotsJackpot);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const sound = useFinanceStore((s) => s.slotsSound);
  const haptics = useFinanceStore((s) => s.slotsHaptics);
  const turbo = useFinanceStore((s) => s.slotsTurbo);
  const xp = useFinanceStore((s) => s.slotsXp);
  const dayStreak = useFinanceStore((s) => s.slotsStreak);
  const dailyAt = useFinanceStore((s) => s.slotsDailyAt);
  const missionState = useFinanceStore((s) => s.slotsMissions);
  const wheelAt = useFinanceStore((s) => s.slotsWheelAt);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const setBet = useFinanceStore((s) => s.setSlotsBet);
  const playSlots = useFinanceStore((s) => s.playSlots);
  const claimRescue = useFinanceStore((s) => s.claimSlotsRescue);
  const claimDaily = useFinanceStore((s) => s.claimSlotsDaily);
  const claimMission = useFinanceStore((s) => s.claimSlotsMission);
  const spinTheWheel = useFinanceStore((s) => s.spinSlotsWheel);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);

  const [strips, setStrips] = useState<SlotSymbolId[][]>(() => startGrid());
  const [spinId, setSpinId] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [durations, setDurations] = useState([BASE_MS, BASE_MS, BASE_MS]);
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
  const [runWin, setRunWin] = useState(0);
  const [pending, setPending] = useState(0);
  const [auto, setAuto] = useState(0);
  const [autoSheet, setAutoSheet] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [skinSheet, setSkinSheet] = useState(false);
  const [rewards, setRewards] = useState(false);
  const [settings, setSettings] = useState(false);
  const [betSheet, setBetSheet] = useState(false);
  const [betDraft, setBetDraft] = useState(BETS[0]);
  const [wheelAngle, setWheelAngle] = useState(0);
  const [wheelBusy, setWheelBusy] = useState(false);
  const [wheelPrize, setWheelPrize] = useState<{ coins: number; freeSpins: number } | null>(null);
  const [levelUp, setLevelUp] = useState<{ level: number; coins: number; freeSpins: number; skin?: string } | null>(
    null,
  );
  const [lever, setLever] = useState(0);
  const [shake, setShake] = useState(false);
  const [streak, setStreak] = useState(0);
  const [celebration, setCelebration] = useState<{ tier: 'big' | 'jackpot'; amount: number } | null>(
    null,
  );
  const [jackpotWin, setJackpotWin] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const reelsRef = useRef<HTMLDivElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);
  const dustStop = useRef<(() => void) | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wheelTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragRef = useRef<{ y: number; id: number } | null>(null);

  useEffect(() => setMuted(!sound), [sound]);
  useEffect(() => setHapticsMuted(!haptics), [haptics]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (tickRef.current) clearInterval(tickRef.current);
      if (wheelTickRef.current) clearInterval(wheelTickRef.current);
      dustStop.current?.();
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
    // Сначала пробуем быструю ставку, иначе опускаемся к любой посильной —
    // с восемью монетами в кармане игрок всё ещё должен мочь крутить.
    const affordable = [...BETS].reverse().find((b) => b <= balance) ?? clampBet(balance);
    if (affordable <= balance && affordable !== bet) setBet(affordable);
  }, [hydrated, spinning, balance, bet, setBet]);

  // ---- прогрессия ----------------------------------------------------------
  const today = dayKey(now);
  const level = levelFromXp(xp);
  const daily = dailyStatus({ streak: dayStreak, lastClaim: dailyAt }, today);
  const missions = dailyMissions(today);
  const counters = missionState.day === today ? missionState.counters : EMPTY_COUNTERS;
  const claimedIds = missionState.day === today ? missionState.claimed : [];
  const wheelLeft = wheelAt ? wheelAt + WHEEL_COOLDOWN_MS - now : 0;
  const wheelReady = wheelLeft <= 0;
  const missionsReady = missions.filter(
    (m) => missionDone(m, { ...EMPTY_COUNTERS, ...counters }) && !claimedIds.includes(m.id),
  ).length;
  const rescueLeft = bonusAt ? bonusAt + RESCUE_COOLDOWN_MS - now : 0;
  const broke = balance < MIN_BET && freeSpins <= 0;
  const rescueReady = broke && rescueLeft <= 0;
  // Сколько наград ждут прямо сейчас — это число и зовёт вернуться.
  const readyCount =
    (daily.ready ? 1 : 0) + (wheelReady ? 1 : 0) + missionsReady + (rescueReady ? 1 : 0);
  // До полуночи: тогда обновятся цели дня и откроется следующая ступень.
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const tillMidnight = midnight.getTime() - now;
  const canSpin = hydrated && !spinning && (freeSpins > 0 || balance >= bet);
  // На табло — копилка плюс то, что заплатит сама линия семёрок.
  const jackpotPrize = jackpotPool + lineBet(bet) * symbolOf('seven').three;

  const theme = skinOf(skin);
  const rainSrc = symbolSrc(skin, theme.rain);

  const finish = useCallback((res: SlotsSpinOutcome) => {
    if (tickRef.current) clearInterval(tickRef.current);
    setResult(res);
    setPending(0);
    setSpinning(false);
    setJackpotWin(res.jackpotWin);
    setStreak((n) => (res.total > 0 ? n + 1 : 0));
    if (res.kind === 'jackpot') {
      notifySuccess();
      jackpotFanfare();
      burstConfetti(180, theme.confetti);
      rainCoins(40, rainSrc);
      setShake(true);
      setCelebration({ tier: 'jackpot', amount: res.total });
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
    // Новый уровень — отдельная плашка: награда уже начислена стором.
    if (res.levelUps.length) {
      const lvl = res.levelUps[res.levelUps.length - 1];
      setLevelUp({ level: lvl, ...levelReward(lvl) });
    }
  }, [theme.confetti, rainSrc]);

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
        cells.push({
          img,
          x: rect.left - base.left,
          y: rect.top - base.top,
          size: rect.width,
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
      const scale = turbo ? 0.55 : 1;
      const show = SHOW_MS * scale;
      const burst = BURST_MS * scale;
      const drop = DROP_MS * scale;
      const stagger = DROP_STAGGER * scale;
      const chainN = i + 1;
      const tier = comboTier(chainN);

      setCascade({ step: i, phase: 'show' });
      setBoard(gridToBoard(step.grid, `${res.steps.length}-${i}-g`));
      setStepWins(step.wins);
      setStepCombo(step.combo);
      setChain(chainN);
      setRunWin((w) => w + step.payout);
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
        setShake(true);
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
              setStrips(res.steps[i].next.map((col) => [...col, randomSymbol()]));
              finish(res);
            }
          },
          show + burst + drop + stagger * 2 + 80,
        ),
      );
    },
    [turbo, theme.confetti, rainSrc, finish, startDust],
  );
  stepRef.current = runStep;

  const spin = useCallback(() => {
    if (!hydrated || spinning || (freeSpins <= 0 && balance < bet)) return;
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
    setBoard(null);
    dustStop.current?.();
    setStopped(0);
    setResult(null);
    setShake(false);
    setCelebration(null);
    setJackpotWin(0);
    setPending(res.total);
    setCascade(null);
    setStepWins([]);
    setChain(0);
    setRunWin(0);
    setSpinId((n) => n + 1);
    setSpinning(true);

    // Пока барабаны в движении — дробный стрёкот механики.
    if (tickRef.current) clearInterval(tickRef.current);
    if (!reduceMotion()) {
      tickRef.current = setInterval(() => reelTick(), turbo ? 55 : 80);
      if (drama) timers.current.push(setTimeout(() => antiSound(), durs[1]));
    }

    timers.current.push(
      setTimeout(() => {
        if (tickRef.current) clearInterval(tickRef.current);
        if (res.steps.length) stepRef.current(res, 0);
        else finish(res);
      }, durs[2] + 40),
    );
  }, [hydrated, spinning, balance, bet, freeSpins, playSlots, strips, turbo, finish]);

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
    // Бесконечный автоспин сам останавливается, когда крутить уже не на что.
    if (freeSpins <= 0 && balance < bet) {
      setAuto(0);
      notifyWarning();
      return;
    }
    // Во время большого выигрыша пауза длиннее — дать досмотреть празднование.
    const t = setTimeout(() => {
      setAuto((n) => n - 1);
      spin();
    }, celebration ? 3200 : 700);
    return () => clearTimeout(t);
  }, [auto, spinning, balance, bet, freeSpins, spin, celebration]);

  const onReelStop = (index: number) => {
    setStopped((n) => Math.max(n, index + 1));
    reelStop(index);
    selectionChanged();
  };

  const takeRescue = () => {
    primeAudio();
    const got = claimRescue();
    if (!got) return;
    tapMedium();
    coinDing();
    coinDing(0.12);
    winChime('small');
    rainCoins(14, rainSrc);
    notifySuccess();
    setNow(Date.now());
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

  const openRewards = () => {
    tapLight();
    primeAudio();
    setWheelPrize(null);
    setRewards(true);
  };

  const takeDaily = () => {
    const got = claimDaily();
    if (!got) return;
    tapMedium();
    coinDing();
    coinDing(0.12);
    winChime(got.streak >= 5 ? 'big' : 'small');
    burstConfetti(60, theme.confetti);
    rainCoins(18, rainSrc);
    notifySuccess();
    setNow(Date.now());
  };

  const takeMission = (id: string) => {
    const got = claimMission(id);
    if (!got) return;
    tapLight();
    coinDing();
    rainCoins(10, rainSrc);
    notifySuccess();
  };

  // Колесо честное: стор уже выбрал сектор, диск просто доезжает до него.
  const turnWheel = () => {
    if (wheelBusy || !wheelReady) return;
    primeAudio();
    const got = spinTheWheel();
    if (!got) return;
    tapMedium();
    leverPull();
    setWheelPrize(null);
    setWheelBusy(true);

    const mod = ((wheelAngle % 360) + 360) % 360;
    const needed = (360 - (got.index + 0.5) * SECTOR) % 360;
    const quick = reduceMotion();
    const delta = quick ? needed - mod : (((needed - mod) % 360) + 360) % 360 + 360 * 5;
    setWheelAngle(wheelAngle + delta);

    if (!quick) wheelTickRef.current = setInterval(() => reelTick(), 95);
    timers.current.push(
      setTimeout(
        () => {
          if (wheelTickRef.current) clearInterval(wheelTickRef.current);
          setWheelBusy(false);
          setWheelPrize({ coins: got.coins, freeSpins: got.freeSpins });
          winChime(got.coins >= 1000 || got.freeSpins >= 10 ? 'big' : 'small');
          burstConfetti(50, theme.confetti);
          rainCoins(14, rainSrc);
          notifySuccess();
          setNow(Date.now());
        },
        quick ? 30 : WHEEL_MS,
      ),
    );
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

  return (
    <Screen
      title={skinOf(skin).title}
      subtitle={skinOf(skin).subtitle}
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
              setSheet(true);
            }}
            aria-label="Правила и выплаты"
          >
            <IconInfo size={21} />
          </button>
        </div>
      }
    >
      <div className="stack slots" data-skin={skin}>
        {/* Сцена темы: фон и декор за всем содержимым страницы */}
        <div className="slots-scene" aria-hidden="true">
          <span className="slots-scene__decor" />
        </div>
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
              <Sym id="seven" skin={skin} size={14} />
              <Sym id="seven" skin={skin} size={14} />
              <Sym id="seven" skin={skin} size={14} />
            </span>
            <span className="slot-hud__value slot-hud__value--jackpot">
              <AnimatedNumber value={jackpotPrize} format={(n) => fmt(n)} duration={600} />
              <CoinIcon size={18} />
            </span>
          </div>
        </div>

        {/* Полоса уровня — она же вход в награды */}
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
                  strips.map((strip, i) => (
                    <Reel
                      key={i}
                      strip={strip}
                      skin={skin}
                      spinId={spinId}
                      duration={durations[i]}
                      onStop={() => onReelStop(i)}
                    />
                  ))
                )}
                {shownWins.length > 0 && <div className="reels__dim" aria-hidden="true" />}
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
                  <div className={`stamp stamp--t${tier}`} key={`st-${chain}`} aria-hidden="true">
                    ×{stepCombo}
                  </div>
                )}
                <div className="reels__glass" aria-hidden="true" />
              </div>
              {/* Счётчик комбо — над окном, чтобы не закрывать сыгравший ряд */}
              {chain >= 1 && cascade && (
                <div className={`combo combo--t${tier}`} key={chain}>
                  <b>{chain >= 2 ? `КОМБО ×${chain}` : 'ЕСТЬ ВЫИГРЫШ'}</b>
                  {stepCombo > 1 && <i>выплата ×{stepCombo}</i>}
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
            {cascade ? (
              <>
                <span className={`status status--combo status--t${tier}`}>
                  {chain >= 2 ? `Комбо ×${chain}!` : 'Есть выигрыш!'}
                </span>
                <span className="status__win">
                  +<AnimatedNumber value={runWin} format={(n) => fmt(n)} duration={400} />
                  <CoinIcon size={20} />
                </span>
                {stepCombo > 1 && <span className="status__mult">выплата ×{stepCombo}</span>}
              </>
            ) : spinning ? (
              <span className="status status--spin">
                {stopped === 2 ? 'Последний барабан…' : 'Крутится…'}
              </span>
            ) : result ? (
              <>
                <span className="status">
                  {outcomeLabel(result).symbol && (
                    <Sym id={outcomeLabel(result).symbol!} skin={skin} size={22} />
                  )}
                  {result.combo >= 2 ? `комбо из ${result.combo} звеньев!` : outcomeLabel(result).text}
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

        {/* Ставки: быстрые кнопки и «⋯» для любой другой */}
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

        {/* Кнопки управления */}
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
                  ? `Комбо ×${chain}…`
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

        {readyCount > 0 && (
          <button className="btn btn--block rewards-cta" onClick={openRewards}>
            <IconGift size={18} />
            Забрать награды · {readyCount}
          </button>
        )}
        {/* Тупик: монет не хватает даже на минимальную ставку */}
        {broke &&
          (rescueReady ? (
            <button className="btn btn--block rewards-cta" onClick={takeRescue}>
              🍀 Спасательные вращения · {RESCUE_SPINS}
            </button>
          ) : (
            <p className="slot-bonus-hint">
              Спасательные вращения — через {fmtLeft(rescueLeft)}
              {wheelReady ? ' · или крутите колесо прямо сейчас' : ''}
            </p>
          ))}
        {readyCount === 0 && (
          <p className="slot-bonus-hint">
            {daily.ready
              ? ''
              : `Завтра — ${fmt(ladderReward(dayStreak + 1))} монет за ${dayStreak + 1}-й день серии`}
            {!wheelReady && ` · колесо через ${fmtLeft(wheelLeft)}`}
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
                      <Sym key={i} id={id} skin={skin} size={17} />
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
              Пять линий, каждая платит слева направо: три одинаковых — главный выигрыш, два
              первых — небольшой возврат. Множитель из таблицы умножается на ставку ÷ {LINE_UNIT} —
              при ставке {fmt(bet)} это {fmt(lineBet(bet))}.
            </p>
            {/* Каскады — главная механика: объясняем её до таблицы выплат */}
            <div className="combo-rules">
              <div className="combo-rules__title">Каскады и комбо</div>
              <p className="combo-rules__text">
                Сыгравшие символы исчезают, оставшиеся падают вниз, сверху приходят новые — и поле
                считается заново. Пока выпадают выигрыши, цепочка продолжается, а множитель растёт:
              </p>
              <div className="combo-rules__ladder">
                {COMBO_LADDER.map((m, i) => (
                  <span key={i} className="combo-rules__step">
                    <b>{i + 1 === COMBO_LADDER.length ? `${i + 1}+` : i + 1}</b>
                    <i>×{m}</i>
                  </span>
                ))}
              </div>
            </div>
            <div className="paytable">
              {[...SLOT_SYMBOLS].reverse().map((s) => (
                <div className="paytable__row" key={s.id}>
                  <span className="paytable__syms">
                    <Sym id={s.id} skin={skin} size={26} />
                    <Sym id={s.id} skin={skin} size={26} />
                    <Sym id={s.id} skin={skin} size={26} />
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
              Монеты виртуальные: купить их нельзя, пополняются ежедневным бонусом. Отдача автомата
              с учётом каскадов — около 91%, и она не меняется ни от ставки, ни от серии: каждый
              символ каждый раз берётся одним и тем же взвешенным ГСЧ.
            </p>
          </div>
        </Sheet>
      )}

      {skinSheet && (
        <Sheet title="Скины автомата" onClose={() => setSkinSheet(false)}>
          <div className="skin-grid">
            {SKINS.map((sk) => {
              const unlocked = isSkinUnlocked(sk.id, level.level);
              return (
                <button
                  key={sk.id}
                  className={`skin-card${sk.id === skin ? ' is-active' : ''}${
                    unlocked ? '' : ' is-locked'
                  }`}
                  data-skin={sk.id}
                  disabled={!unlocked}
                  onClick={() => {
                    selectionChanged();
                    setPrefs({ skin: sk.id });
                    setSkinSheet(false);
                  }}
                >
                  <span className="skin-card__reels">
                    <img src={symbolSrc(sk.id, 'seven')} width={26} height={26} alt="" />
                    <img src={symbolSrc(sk.id, 'star')} width={26} height={26} alt="" />
                    <img src={symbolSrc(sk.id, 'bell')} width={26} height={26} alt="" />
                  </span>
                  <span className="skin-card__name">{sk.name}</span>
                  <span className="skin-card__hint">{sk.hint}</span>
                  {!unlocked && (
                    <span className="skin-card__lock">
                      <IconLock size={15} />с {SKIN_UNLOCK[sk.id]} уровня
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
            Символы — Twemoji (CC-BY 4.0, Twitter Inc. и контрибьюторы).
          </p>
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
                  onClick={() => startAuto(o.value)}
                >
                  <span className="auto-card__num">{o.label}</span>
                  <span className="auto-card__hint">{o.hint}</span>
                </button>
              ))}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Автоспин останавливается кнопкой «Стоп» и сам замирает, когда монет не хватает на
              ставку. Бесплатные вращения тратятся первыми. Режим «∞» удобно включать вместе с
              турбо — тогда барабаны крутятся вдвое быстрее.
            </p>
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
                  hint: 'Барабаны, комбо и выигрыши',
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
                    // Вибрацию выключаем после отклика, включаем — до него.
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
            <p className="reward-block__hint" style={{ textAlign: 'center' }}>
              От {MIN_BET} до {MAX_BET} монет шагом {BET_STEP}. Выплата линии считается от ставки ÷{' '}
              {LINE_UNIT} — сейчас это {fmt(betDraft / LINE_UNIT)}.
            </p>
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

      {rewards && (
        <Sheet title="Награды" onClose={() => setRewards(false)}>
          <div className="stack rewards" data-skin={skin}>
            {/* Уровень */}
            <div className="reward-block">
              <div className="reward-block__head">
                <span className="reward-block__title">Уровень {level.level}</span>
                <span className="reward-block__meta">
                  {fmt(level.into)} / {fmt(level.need)} XP
                </span>
              </div>
              <div className="xpbar">
                <i style={{ width: `${Math.min(100, (level.into / level.need) * 100)}%` }} />
              </div>
              <p className="reward-block__hint">
                Опыт капает за каждое вращение — выигрыш ускоряет, но не решает. За уровень дают
                монеты, каждый третий добавляет бесплатные вращения, а уровни 5 и 9 открывают новые
                скины.
              </p>
            </div>

            {/* Ежедневная лесенка */}
            <div className="reward-block">
              <div className="reward-block__head">
                <span className="reward-block__title">Ежедневный бонус</span>
                <span className="reward-block__meta">
                  {dayStreak > 0
                    ? `серия ${dayStreak} ${plural(dayStreak, 'день', 'дня', 'дней')}`
                    : 'серия ещё не начата'}
                </span>
              </div>
              <div className="ladder">
                {DAILY_LADDER.map((coins, i) => {
                  const step = i + 1;
                  const done = daily.ready ? step < daily.step : step <= daily.step;
                  const next = daily.ready && step === daily.step;
                  return (
                    <div
                      key={step}
                      className={`ladder__day${done ? ' is-done' : ''}${next ? ' is-next' : ''}`}
                    >
                      <span className="ladder__num">{step}</span>
                      <span className="ladder__sum">{fmt(coins)}</span>
                    </div>
                  );
                })}
              </div>
              {daily.broken && (
                <p className="reward-block__warn">
                  Серия прервалась — начинаем с первой ступени. Ничего страшного, за неделю снова
                  дойдём до {fmt(DAILY_LADDER[DAILY_LADDER.length - 1])}.
                </p>
              )}
              {daily.ready ? (
                <button className="btn btn--block rewards-cta" onClick={takeDaily}>
                  Забрать +{fmt(daily.reward)}
                  <CoinIcon size={17} />
                </button>
              ) : (
                <p className="reward-block__hint">
                  Сегодня забрано. Завтра ступень {daily.step === DAILY_LADDER.length ? 1 : daily.step + 1}
                  {' — '}
                  {fmt(ladderReward(dayStreak + 1))} монет. Обновление через {fmtLeft(tillMidnight)}.
                </p>
              )}
            </div>

            {/* Колесо удачи */}
            <div className="reward-block">
              <div className="reward-block__head">
                <span className="reward-block__title">Колесо удачи</span>
                <span className="reward-block__meta">
                  {wheelReady ? 'готово' : `через ${fmtLeft(wheelLeft)}`}
                </span>
              </div>
              <WheelArt angle={wheelAngle} instant={false} />
              {wheelPrize && (
                <p className="wheel__prize">
                  {wheelPrize.coins > 0
                    ? `+${fmt(wheelPrize.coins)} монет`
                    : `+${wheelPrize.freeSpins} ${plural(
                        wheelPrize.freeSpins,
                        'бесплатное вращение',
                        'бесплатных вращения',
                        'бесплатных вращений',
                      )}`}
                </p>
              )}
              <button
                className="btn btn--block rewards-cta"
                disabled={!wheelReady || wheelBusy}
                onClick={turnWheel}
              >
                {wheelBusy ? 'Крутится…' : wheelReady ? 'Крутить колесо' : `Через ${fmtLeft(wheelLeft)}`}
              </button>
              <p className="reward-block__hint">
                Бесплатно раз в 4 часа. Сектор выбирается до вращения — колесо доезжает ровно до
                него и никогда не «доворачивает» мимо.
              </p>
            </div>

            {/* Цели дня */}
            <div className="reward-block">
              <div className="reward-block__head">
                <span className="reward-block__title">Цели дня</span>
                <span className="reward-block__meta">обновятся через {fmtLeft(tillMidnight)}</span>
              </div>
              <div className="missions">
                {missions.map((m) => {
                  const have = Math.min(counters[m.kind] ?? 0, m.goal);
                  const done = have >= m.goal;
                  const taken = claimedIds.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      className={`mission${taken ? ' is-taken' : done ? ' is-done' : ''}`}
                    >
                      <div className="mission__top">
                        <span className="mission__title">{m.title}</span>
                        <span className="mission__reward">
                          +{fmt(m.reward)}
                          <CoinIcon size={13} />
                        </span>
                      </div>
                      <div className="mission__bar">
                        <i style={{ width: `${(have / m.goal) * 100}%` }} />
                      </div>
                      <div className="mission__foot">
                        <span>
                          {fmt(have)} / {fmt(m.goal)}
                        </span>
                        {taken ? (
                          <span className="mission__ok">забрано</span>
                        ) : done ? (
                          <button className="mission__btn" onClick={() => takeMission(m.id)}>
                            Забрать
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Страховка от тупика */}
            <div className="reward-block">
              <div className="reward-block__head">
                <span className="reward-block__title">Спасательные вращения</span>
                <span className="reward-block__meta">
                  {!broke ? 'пока не нужны' : rescueReady ? 'готовы' : `через ${fmtLeft(rescueLeft)}`}
                </span>
              </div>
              <p className="reward-block__hint">
                Если монет не хватит даже на минимальную ставку, под барабанами появится кнопка на{' '}
                {RESCUE_SPINS} бесплатных вращений — раз в час. Ставка при этом опустится до{' '}
                {fmt(BETS[0])}. Застрять в игре насовсем нельзя.
              </p>
              {rescueReady && (
                <button
                  className="btn btn--block rewards-cta"
                  onClick={() => {
                    takeRescue();
                    setRewards(false);
                  }}
                >
                  🍀 Взять {RESCUE_SPINS} вращений
                </button>
              )}
            </div>

            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Награды добавляют монет, но не трогают барабаны: шанс выигрыша всегда один и тот же.
              Никаких подкрученных «почти выигрышей» и проигрышей под видом победы — только честный
              ГСЧ и отдача около 93%.
            </p>
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
            {levelUp.skin && (
              <div className="levelup__skin">Открыт скин «{skinOf(levelUp.skin as SkinId).name}»</div>
            )}
          </div>
        </div>
      )}

      {/* Крупный выигрыш — в духе тотема бессмертия: символ вырастает в центре,
          качается и уходит вверх, вокруг разлетаются квадратные искры. */}
      {celebration && (
        <div
          className={`totem totem--${celebration.tier}`}
          onClick={() => setCelebration(null)}
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
            <div className="totem__title">
              {celebration.tier === 'jackpot' ? 'ДЖЕКПОТ!' : 'БОЛЬШОЙ ВЫИГРЫШ'}
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
