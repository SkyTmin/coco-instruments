// Награды: уровень, ежедневная лесенка, колесо, цели дня и страховка от тупика.
//
// Вся прогрессия в сторе общая для обеих игр — опыт, серия дней и цели копятся
// хоть в «Слотах», хоть в «Каскаде». Поэтому лист один и тот же: он сам берёт
// всё из стора, и странице достаточно его открыть.

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { skinOf, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import {
  DAILY_LADDER,
  EMPTY_COUNTERS,
  WHEEL,
  WHEEL_COOLDOWN_MS,
  dailyMissions,
  dailyStatus,
  dayKey,
  ladderReward,
  levelFromXp,
  missionDone,
} from '@/lib/slots-meta';
import type { WheelSector } from '@/lib/slots-meta';
import { BETS, MIN_BET, RESCUE_COOLDOWN_MS, RESCUE_SPINS } from '@/lib/slots';
import { burstConfetti } from '@/lib/confetti';
import { rainCoins } from '@/lib/coins';
import { coinDing, leverPull, primeAudio, reelTick, winChime } from '@/lib/sound';
import { notifySuccess, tapMedium, tapLight } from '@/lib/haptics';
import { useFinanceStore } from '@/store';

const SECTOR = 360 / WHEEL.length;
const WHEEL_MS = 4200;

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

const reduceMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** «3 ч 20 мин» — сколько ждать до следующей бесплатной награды. */
export function fmtLeft(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} мин`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export function plural(n: number, one: string, few: string, many: string): string {
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

/**
 * Сколько наград ждут прямо сейчас — число на кнопке «Награды».
 * Считается из стора, поэтому одинаково в обеих играх.
 */
export function useReadyRewards(now: number): number {
  const balance = useFinanceStore((s) => s.slotsBalance);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const dayStreak = useFinanceStore((s) => s.slotsStreak);
  const dailyAt = useFinanceStore((s) => s.slotsDailyAt);
  const missionState = useFinanceStore((s) => s.slotsMissions);
  const wheelAt = useFinanceStore((s) => s.slotsWheelAt);
  const bonusAt = useFinanceStore((s) => s.slotsBonusAt);

  const today = dayKey(now);
  const daily = dailyStatus({ streak: dayStreak, lastClaim: dailyAt }, today);
  const counters = missionState.day === today ? missionState.counters : EMPTY_COUNTERS;
  const claimedIds = missionState.day === today ? missionState.claimed : [];
  const missionsReady = dailyMissions(today).filter(
    (m) => missionDone(m, { ...EMPTY_COUNTERS, ...counters }) && !claimedIds.includes(m.id),
  ).length;
  const wheelReady = (wheelAt ? wheelAt + WHEEL_COOLDOWN_MS - now : 0) <= 0;
  const broke = balance < MIN_BET && freeSpins <= 0;
  const rescueReady = broke && (bonusAt ? bonusAt + RESCUE_COOLDOWN_MS - now : 0) <= 0;

  return (daily.ready ? 1 : 0) + (wheelReady ? 1 : 0) + missionsReady + (rescueReady ? 1 : 0);
}

export function RewardsSheet({ skin, onClose }: { skin: SkinId; onClose: () => void }) {
  const balance = useFinanceStore((s) => s.slotsBalance);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const xp = useFinanceStore((s) => s.slotsXp);
  const dayStreak = useFinanceStore((s) => s.slotsStreak);
  const dailyAt = useFinanceStore((s) => s.slotsDailyAt);
  const missionState = useFinanceStore((s) => s.slotsMissions);
  const wheelAt = useFinanceStore((s) => s.slotsWheelAt);
  const bonusAt = useFinanceStore((s) => s.slotsBonusAt);
  const claimDaily = useFinanceStore((s) => s.claimSlotsDaily);
  const claimMission = useFinanceStore((s) => s.claimSlotsMission);
  const spinTheWheel = useFinanceStore((s) => s.spinSlotsWheel);
  const claimRescue = useFinanceStore((s) => s.claimSlotsRescue);

  const [now, setNow] = useState(() => Date.now());
  const [wheelAngle, setWheelAngle] = useState(0);
  const [wheelBusy, setWheelBusy] = useState(false);
  const [wheelPrize, setWheelPrize] = useState<{ coins: number; freeSpins: number } | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Обратные отсчёты идут, пока лист открыт.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current);
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const theme = skinOf(skin);
  const rainSrc = symbolSrc(skin, theme.rain);

  const today = dayKey(now);
  const level = levelFromXp(xp);
  const daily = dailyStatus({ streak: dayStreak, lastClaim: dailyAt }, today);
  const missions = dailyMissions(today);
  const counters = missionState.day === today ? missionState.counters : EMPTY_COUNTERS;
  const claimedIds = missionState.day === today ? missionState.claimed : [];
  const wheelLeft = wheelAt ? wheelAt + WHEEL_COOLDOWN_MS - now : 0;
  const wheelReady = wheelLeft <= 0;
  const rescueLeft = bonusAt ? bonusAt + RESCUE_COOLDOWN_MS - now : 0;
  const broke = balance < MIN_BET && freeSpins <= 0;
  const rescueReady = broke && rescueLeft <= 0;
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const tillMidnight = midnight.getTime() - now;

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

  const takeRescue = () => {
    primeAudio();
    const got = claimRescue();
    if (!got) return;
    tapMedium();
    coinDing();
    winChime('small');
    rainCoins(14, rainSrc);
    notifySuccess();
    onClose();
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
    const delta = quick ? needed - mod : ((((needed - mod) % 360) + 360) % 360) + 360 * 5;
    setWheelAngle(wheelAngle + delta);

    if (!quick) tickRef.current = setInterval(() => reelTick(), 95);
    timers.current.push(
      setTimeout(
        () => {
          if (tickRef.current) clearInterval(tickRef.current);
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

  return (
    <Sheet title="Награды" onClose={onClose}>
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
            Опыт капает за каждое вращение в любой из игр — выигрыш ускоряет, но не решает. За
            уровень дают монеты, каждый третий добавляет бесплатные вращения, а уровни 5, 9 и 12
            открывают новые скины.
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
              Серия прервалась — начинаем с первой ступени. Ничего страшного, за неделю снова дойдём
              до {fmt(DAILY_LADDER[DAILY_LADDER.length - 1])}.
            </p>
          )}
          {daily.ready ? (
            <button className="btn btn--block rewards-cta" onClick={takeDaily}>
              Забрать +{fmt(daily.reward)}
              <CoinIcon size={17} />
            </button>
          ) : (
            <p className="reward-block__hint">
              Сегодня забрано. Завтра ступень{' '}
              {daily.step === DAILY_LADDER.length ? 1 : daily.step + 1}
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
            {wheelBusy
              ? 'Крутится…'
              : wheelReady
                ? 'Крутить колесо'
                : `Через ${fmtLeft(wheelLeft)}`}
          </button>
          <p className="reward-block__hint">
            Бесплатно раз в 4 часа. Сектор выбирается до вращения — колесо доезжает ровно до него и
            никогда не «доворачивает» мимо.
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
            {RESCUE_SPINS} бесплатных вращений. Ставка при этом опустится до {fmt(BETS[0])}.
            Застрять в игре насовсем нельзя.
          </p>
          {rescueReady && (
            <button className="btn btn--block rewards-cta" onClick={takeRescue}>
              🍀 Взять {RESCUE_SPINS} вращений
            </button>
          )}
        </div>

        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Награды добавляют монет, но не трогают барабаны: шанс выигрыша всегда один и тот же.
          Никаких подкрученных «почти выигрышей» и проигрышей под видом победы — только честный ГСЧ.
        </p>
      </div>
    </Sheet>
  );
}
