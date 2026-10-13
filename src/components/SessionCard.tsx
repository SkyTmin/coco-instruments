import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatedNumber } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { skinOf } from '@/lib/skins';
import {
  GAME_ROUTES,
  isStale,
  rankAmong,
  sessionGrade,
  sessionNet,
  sessionPeak,
} from '@/lib/session';
import type { Grade, Peak, Session } from '@/lib/session';
import { orbRarity } from '@/lib/orb-rarity';
import { fmtDec, fmtNum as fmt, t, useT } from '@/i18n';
import { burstConfetti } from '@/lib/confetti';
import { coinDing, jackpotFanfare, primeAudio, winChime } from '@/lib/sound';
import { notifySuccess, tapLight } from '@/lib/haptics';
import { Button, Panel } from '@/ui-px';
import '@/pages/casino.css';

/** Множитель: ×12 без хвоста, ×2,4 — с одним знаком (по локали). */
const fmtMult = (m: number) => `×${m >= 10 ? fmt(m) : fmtDec(m, 1).replace(/[.,]0$/, '')}`;

/** Строки пика по его виду — `sessionPeak` в lib отдаёт их по-русски для тестов. */
function peakText(p: Peak, s: Session): { title: string; detail: string } {
  const at = (n: number) => t('slots.session.at', { at: n, of: s.spins });
  switch (p.kind) {
    case 'win':
      return {
        title: t('slots.session.winTitle', { x: fmtMult(s.bestMult) }),
        detail: t('slots.session.winDetail', {
          coins: t('common.coins', { n: s.bestWin }),
          at: s.bestWinAt,
          of: s.spins,
        }),
      };
    case 'orb':
      return {
        title: `${t(`slots.orb.${orbRarity(s.bestOrb)}`)} ×${s.bestOrb}`,
        detail: at(s.bestOrbAt),
      };
    case 'chain':
      return { title: t('slots.session.chain', { n: s.bestChain }), detail: at(s.bestChainAt) };
    case 'bonus':
      return {
        title:
          s.bonuses > 1
            ? t('slots.session.bonusTimes', { n: s.bonuses })
            : t('slots.session.bonusOnce'),
        detail: t('slots.session.bonusDetail', { at: s.bonusAt, of: s.spins }),
      };
    case 'level':
      return {
        title: t('slots.session.level', { n: s.topLevel }),
        detail: s.levels > 1 ? t('slots.session.levelMore', { n: s.levels - 1 }) : at(s.levelAt),
      };
    default:
      return {
        title: t('slots.session.flat'),
        detail: t('slots.session.flatDetail', { n: s.spins }),
      };
  }
}

function sessionLength(s: Session): string {
  const mins = Math.round((s.lastAt - s.startedAt) / 60_000);
  if (mins < 1) return t('slots.session.lessMin');
  if (mins < 60) return t('slots.session.min', { m: mins });
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? t('slots.session.hm', { h, m }) : t('slots.session.h', { h });
}

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
  const tr = useT();
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
  const text = peakText(peak, session);
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

  const rankLine =
    rank.of < 3 ? null : rank.rank === 1 ? tr('slots.session.best', { n: rank.of }) : null;

  return (
    <div className="ses" role="presentation" onClick={close}>
      <Panel
        material="wood"
        className={`sesk sesk--${grade}`}
        role="dialog"
        aria-label={tr('slots.session.aria')}
        onClick={(e) => e.stopPropagation()}
      >
        {grade === 'unforgettable' && <div className="ses__rays" aria-hidden="true" />}

        <div className="sesk__grade px-ribbon">{tr(`slots.session.grade.${grade}`)}</div>

        {/* Две колонки — только на низком экране (телефон лёжа); иначе обёртки прозрачны. */}
        <div className="sesk__col">
          {/* Пик — единственное, что здесь по-настоящему крупно. Заход должен
              вспоминаться одним кадром, а не таблицей достижений. Плита тёмная:
              цвет редкости читается только на тёмном. */}
          <div className={`sesk__peak sesk__peak--${tone} pxk-frame-iron px-nofill px-dark`}>
            <div className="sesk__peak-label">
              {peak.kind === 'none' ? tr('slots.session.noPeak') : tr('slots.session.peak')}
            </div>
            <div className="sesk__peak-title">{text.title}</div>
            <div className="sesk__peak-detail">{text.detail}</div>
          </div>

          <div className={`sesk__net px-num${net >= 0 ? ' is-up' : ' is-down'}`}>
            {net >= 0 ? '+' : '−'}
            <AnimatedNumber value={Math.abs(net)} format={(n) => fmt(n)} duration={900} />
            <CoinIcon size={24} />
          </div>

          {rankLine && <div className="sesk__rank">{rankLine}</div>}
        </div>

        <div className="sesk__col">
          <div className="sesk__stats">
            <span className="cas-well">
              <b className="px-num">{fmt(session.spins)}</b>
              <i>{tr('slots.session.spins')}</i>
            </span>
            <span className="cas-well">
              <b className="px-num">{fmt(session.bestWin)}</b>
              <i>{tr('slots.session.bestSpin')}</i>
            </span>
            <span className="cas-well">
              <b className="px-num">{sessionLength(session)}</b>
              <i>{tr('slots.session.played')}</i>
            </span>
          </div>

          {/* Крючок на возврат — честный и без восклицаний: просто сколько
              осталось до следующего уровня. */}
          <div className="sesk__hook">
            {tr('slots.session.hook', { lvl: level.level + 1, xp: toNext })}
          </div>

          <div className="sesk__actions">
            <Button
              kind="primary"
              wide
              data-autofocus=""
              onClick={() => {
                primeAudio();
                tapLight();
                dismiss();
                navigate(back);
              }}
            >
              {tr('slots.session.again')}
            </Button>
            <Button wide onClick={close}>
              {tr('slots.session.enough')}
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
