import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatedNumber } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { skinOf } from '@/lib/skins';
import {
  GAME_ROUTES,
  GRADE_NAME,
  isStale,
  rankAmong,
  sessionGrade,
  sessionLength,
  sessionNet,
  sessionPeak,
} from '@/lib/session';
import type { Grade, Peak } from '@/lib/session';
import { burstConfetti } from '@/lib/confetti';
import { coinDing, jackpotFanfare, primeAudio, winChime } from '@/lib/sound';
import { notifySuccess, tapLight } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Оформление пика по его яркости — та же лестница, что у сфер. Заход с
 * реликвией и заход с одной удачной вишней не имеют права выглядеть одинаково.
 */
function peakTone(p: Peak): string {
  if (p.intensity >= 85) return 'mythic';
  if (p.intensity >= 60) return 'legendary';
  if (p.intensity >= 45) return 'epic';
  if (p.intensity >= 25) return 'rare';
  return 'plain';
}

/** Сколько праздновать сам показ карточки. Тихий заход не празднуют вовсе. */
function fanfare(grade: Grade, palette: string[]): void {
  if (grade === 'unforgettable') {
    notifySuccess();
    jackpotFanfare();
    burstConfetti(120, palette);
  } else if (grade === 'great') {
    notifySuccess();
    winChime('big');
    burstConfetti(45, palette);
  } else if (grade === 'good') {
    coinDing();
  }
}

/**
 * Итог захода.
 *
 * Зачем это вообще: впечатление от эпизода складывается примерно из самого
 * яркого момента и последнего (Канеман, Фредриксон), а длительность почти не
 * учитывается. То есть игра запоминается по пику — но только если на нём и
 * заканчивается. Раньше заход растворялся в десятке ровных спинов и резко
 * закрытом приложении, и вспоминать было нечего. Эта карточка и есть конец:
 * она достаёт пик обратно и кладёт его последним кадром.
 *
 * Показывается поверх всего приложения, потому что закрывают его откуда
 * угодно, а не обязательно с экрана игры.
 */
export function SessionCard() {
  // На текущий заход НЕ подписываемся: он меняется каждый спин, а карточка
  // почти всегда невидима — это была бы перерисовка на ровном месте. Там, где
  // он нужен, берём его разово через getState().
  const session = useFinanceStore((s) => s.sessionCard);
  const past = useFinanceStore((s) => s.sessionPast);
  const dismiss = useFinanceStore((s) => s.dismissSession);
  const closeSession = useFinanceStore((s) => s.closeSession);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const xp = useFinanceStore((s) => s.slotsXp);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const theme = skinOf(skin);

  const grade = session ? sessionGrade(session) : 'quiet';

  // Уход с игровых экранов — и есть конец захода. Таймера простоя здесь
  // намеренно нет: человек может три минуты читать правила или выбирать скин,
  // и выкидывать ему итог посреди этого — значит наказывать за внимательность.
  const wasInGame = useRef(false);
  useEffect(() => {
    const inGame = GAME_ROUTES.includes(pathname);
    if (wasInGame.current && !inGame) closeSession();
    wasInGame.current = inGame;
  }, [pathname, closeSession]);

  // Возврат в приложение, которое не перезагружалось: Telegram часто держит
  // вебвью живым, и тогда hydrate заново не отработает. Если за время отлучки
  // заход успел «протухнуть», закрываем его здесь.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (isStale(useFinanceStore.getState().sessionNow, Date.now())) closeSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [closeSession]);

  useEffect(() => {
    if (!session) return;
    fanfare(grade, theme.confetti);
  }, [session, grade, theme.confetti]);

  if (!session) return null;

  const peak = sessionPeak(session);
  const tone = peakTone(peak);
  const net = sessionNet(session);
  // Прошлые заходы уже содержат этот — сравниваем с остальными.
  const rank = rankAmong(
    session,
    past.filter((p) => p.startedAt !== session.startedAt),
  );
  const level = levelFromXp(xp);
  const toNext = Math.max(0, level.need - level.into);
  // Куда звать обратно: туда, где он в этот заход в основном и был.
  const back = session.byScatter >= session.bySlots ? '/scatter' : '/slots';

  const close = () => {
    tapLight();
    dismiss();
  };

  const rankLine = rank.of < 3 ? null : rank.rank === 1 ? `Лучший заход за ${rank.of}` : null;

  return (
    <div className="ses" role="presentation" onClick={close}>
      <div
        className={`ses__card ses__card--${grade}`}
        role="dialog"
        aria-label="Итог захода"
        onClick={(e) => e.stopPropagation()}
      >
        {grade === 'unforgettable' && <div className="ses__rays" aria-hidden="true" />}

        <div className="ses__grade">{GRADE_NAME[grade]}</div>

        {/* Пик — единственное, что здесь по-настоящему крупно. Заход должен
            вспоминаться одним кадром, а не таблицей достижений. */}
        <div className={`ses__peak ses__peak--${tone}`}>
          <div className="ses__peak-label">
            {peak.kind === 'none' ? 'Без громких событий' : 'Пик захода'}
          </div>
          <div className="ses__peak-title">{peak.title}</div>
          <div className="ses__peak-detail">{peak.detail}</div>
        </div>

        <div className={`ses__net${net >= 0 ? ' is-up' : ' is-down'}`}>
          {net >= 0 ? '+' : '−'}
          <AnimatedNumber value={Math.abs(net)} format={(n) => fmt(n)} duration={900} />
          <CoinIcon size={22} />
        </div>

        {rankLine && <div className="ses__rank">{rankLine}</div>}

        <div className="ses__stats">
          <span>
            <b>{fmt(session.spins)}</b>
            <i>вращений</i>
          </span>
          <span>
            <b>{fmt(session.bestWin)}</b>
            <i>лучший спин</i>
          </span>
          <span>
            <b>{sessionLength(session)}</b>
            <i>за игрой</i>
          </span>
        </div>

        {/* Крючок на возврат — честный и без восклицаний: просто сколько
            осталось до следующего уровня. */}
        <div className="ses__hook">
          До {level.level + 1} уровня — {fmt(toNext)} опыта
        </div>

        <div className="ses__actions">
          <button
            className="ses__btn ses__btn--go"
            onClick={() => {
              primeAudio();
              tapLight();
              dismiss();
              navigate(back);
            }}
          >
            Ещё разок
          </button>
          <button className="ses__btn" onClick={close}>
            На сегодня хватит
          </button>
        </div>
      </div>
    </div>
  );
}
