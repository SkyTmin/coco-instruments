import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatedNumber, Screen, Sheet } from '@/components/ui';
import { CoinIcon, SlotArtDefs } from '@/components/slot-art';
import { SKINS, skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { IconGift, IconInfo, IconLock } from '@/components/icons';
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
  BETS,
  BONUS_COOLDOWN_MS,
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
            <Sym id={id} skin={skin} />
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
  const turbo = useFinanceStore((s) => s.slotsTurbo);
  const xp = useFinanceStore((s) => s.slotsXp);
  const dayStreak = useFinanceStore((s) => s.slotsStreak);
  const dailyAt = useFinanceStore((s) => s.slotsDailyAt);
  const missionState = useFinanceStore((s) => s.slotsMissions);
  const wheelAt = useFinanceStore((s) => s.slotsWheelAt);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const setBet = useFinanceStore((s) => s.setSlotsBet);
  const playSlots = useFinanceStore((s) => s.playSlots);
  const claimBonus = useFinanceStore((s) => s.claimSlotsBonus);
  const claimDaily = useFinanceStore((s) => s.claimSlotsDaily);
  const claimMission = useFinanceStore((s) => s.claimSlotsMission);
  const spinTheWheel = useFinanceStore((s) => s.spinSlotsWheel);
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
  const [skinSheet, setSkinSheet] = useState(false);
  const [rewards, setRewards] = useState(false);
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

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wheelTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const dragRef = useRef<{ y: number; id: number } | null>(null);

  useEffect(() => setMuted(!sound), [sound]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (tickRef.current) clearInterval(tickRef.current);
      if (wheelTickRef.current) clearInterval(wheelTickRef.current);
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
  // Сколько наград ждут прямо сейчас — это число и зовёт вернуться.
  const readyCount = (daily.ready ? 1 : 0) + (wheelReady ? 1 : 0) + missionsReady;
  // До полуночи: тогда обновятся цели дня и откроется следующая ступень.
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const tillMidnight = midnight.getTime() - now;

  const rescueLeft = bonusAt ? bonusAt + BONUS_COOLDOWN_MS - now : 0;
  const broke = balance < Math.min(...BETS) && freeSpins <= 0;
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
    if (freeSpins <= 0 && balance < bet) {
      setAuto(0);
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

  const takeBonus = (amount: number) => {
    primeAudio();
    tapLight();
    claimBonus(amount);
    coinDing();
    coinDing(0.12);
    rainCoins(14, rainSrc);
    notifySuccess();
    setNow(Date.now());
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
  const winCells = new Set(
    (result?.wins ?? []).flatMap((w) => w.cells.map(([c, r]) => `${c}-${r}`)),
  );

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
              <div className="reels">
                {strips.map((strip, i) => (
                  <Reel
                    key={i}
                    strip={strip}
                    skin={skin}
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
                    <Sym id={outcomeLabel(result).symbol!} skin={skin} size={22} />
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
                  : freeSpins > 0
                    ? `Бесплатно · ${freeSpins}`
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

        {readyCount > 0 && (
          <button className="btn btn--block rewards-cta" onClick={openRewards}>
            <IconGift size={18} />
            Забрать награды · {readyCount}
          </button>
        )}
        {broke && rescueLeft <= 0 && (
          <button className="btn btn--ghost btn--block" onClick={() => takeBonus(RESCUE_BONUS)}>
            🍀 Спасательные +{fmt(RESCUE_BONUS)}
          </button>
        )}
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
              Ставка делится между пятью линиями (по {fmt(lineBet(bet))} монет). Линия платит слева
              направо: три одинаковых — главный выигрыш, два первых — небольшой возврат.
            </p>
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
              Монеты виртуальные: купить их нельзя, пополняются ежедневным бонусом. Отдача
              автомата — около 93%.
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
