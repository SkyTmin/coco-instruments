import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/ui';
import { GameTop, KIcon } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import { symbolSrc } from '@/lib/skins';
import { levelFromXp } from '@/lib/slots-meta';
import { rankLetter } from '@/lib/prison';
import { SCATTER_COLS, SCATTER_ROWS } from '@/lib/scatter';
import type { SlotSymbolId } from '@/lib/slots';
import { tapLight } from '@/lib/haptics';
import { useGameAudio } from '@/lib/use-game-audio';
import { AudioToggles } from '@/components/AudioToggles';
import { GameScreen } from '@/game-shell/GameScreen';
import { Bar } from '@/ui-px';
import { fmtNum as fmt, skinText, useT } from '@/i18n';
import { GameSettings } from '@/settings';
import { CasStat, KitIcon, useCasLayout } from './casino-ui';

/**
 * Казино — здание двора (v2.66). Каторга — главная игра, автоматы — её
 * дополнение на тех же монетах: сюда приходят рискнуть заработанным в шахте.
 * Бесплатных денег здесь больше нет — ни лесенки, ни колеса, ни наград.
 *
 * UI v2 (K): зал — пусковая панель. Сверху общий кошелёк и уровень казино,
 * под ним три большие карточки: «Слоты», «Каскад» и сама «Каторга» — у каждой
 * картинка, два главных факта числом и «Играть». Стрелками/крестовиной — по
 * карточкам, Enter/«A» — войти.
 */
export function GamesPage() {
  const nav = useNavigate();
  const balance = useFinanceStore((s) => s.slotsBalance);
  const xp = useFinanceStore((s) => s.slotsXp);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const slotsSpins = useFinanceStore((s) => s.slotsSpins);
  const slotsBest = useFinanceStore((s) => s.slotsBest);
  const scatterSpins = useFinanceStore((s) => s.scatterSpins);
  const scatterBest = useFinanceStore((s) => s.scatterBest);
  const rank = useFinanceStore((s) => s.prison.rank);
  const tokens = useFinanceStore((s) => s.prison.tokens);
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useGameAudio('hall');
  const level = levelFromXp(xp);
  const lay = useCasLayout();

  const go = (path: string) => {
    tapLight();
    nav(path);
  };

  const sym = (id: SlotSymbolId) => <img key={id} src={symbolSrc(skin, id)} alt="" />;
  const coins = (n: number) => (
    <>
      {fmt(n)}
      <CoinIcon size={16} />
    </>
  );

  return (
    <GameScreen
      className="gx cas-hall"
      bg={<div className="yard-scene-bg" />}
      top={
        <GameTop
          title={t('hall.title')}
          onBack={() => nav(-1)}
          right={
            <>
              <AudioToggles />
              <button
                type="button"
                className="gx-round gx-round--dark"
                aria-label={t('common.settings')}
                onClick={() => {
                  tapLight();
                  setSettingsOpen(true);
                }}
              >
                <KIcon name="gear" />
              </button>
            </>
          }
        />
      }
    >
      <div className="hall px" data-lay={lay}>
        {/* Общий кошелёк: те же монеты, что в шахте, и уровень казино. */}
        <section className="hall-wallet" aria-label={t('hall.wallet')}>
          <div className="hall-wallet__money">
            <i className="cas-cap">{t('hall.wallet')}</i>
            <b className="hall-wallet__v px-num">
              <CoinIcon size={26} />
              <AnimatedNumber value={balance} format={(n) => fmt(n)} duration={450} />
            </b>
          </div>
          <div className="hall-wallet__lvl">
            <b className="hall-wallet__n px-num">{t('common.level', { n: level.level })}</b>
            <Bar value={level.into / level.need} />
          </div>
        </section>

        <div className="hall-cards">
          <HallCard
            autoFocus
            title={skinText(skin, 'title')}
            art={<span className="hall-card__reels">{(['seven', 'star', 'bell'] as const).map(sym)}</span>}
            tags={[t('hall.reels', { n: 3 }), t('hall.lines', { n: 5 })]}
            facts={
              <>
                <CasStat icon={<KitIcon name="play" />} value={fmt(slotsSpins)} label={t('slots.statSpins')} />
                <CasStat
                  tone="gold"
                  icon={<KitIcon name="star" />}
                  value={coins(slotsBest)}
                  label={t('slots.statBestWin')}
                />
              </>
            }
            play={t('hall.play')}
            onClick={() => go('/slots')}
          />
          <HallCard
            title={t('hall.cascade')}
            art={
              <span className="hall-card__grid">
                {(['diamond', 'grape', 'cherry', 'bell', 'lemon', 'star'] as const).map(sym)}
              </span>
            }
            tags={[
              t('hall.grid', { cols: SCATTER_COLS, rows: SCATTER_ROWS }),
              t('hall.orbsUpTo', { x: 500 }),
            ]}
            facts={
              <>
                <CasStat
                  icon={<KitIcon name="play" />}
                  value={fmt(scatterSpins)}
                  label={t('slots.session.spins')}
                />
                <CasStat
                  tone="gold"
                  icon={<KitIcon name="star" />}
                  value={coins(scatterBest)}
                  label={t('slots.hud.best')}
                />
              </>
            }
            play={t('hall.play')}
            onClick={() => go('/scatter')}
          />
          <HallCard
            title={t('hall.prison')}
            art={<img className="hall-card__cover" src="/ui/areas/mouth.png" alt="" />}
            tags={[t('hall.main')]}
            facts={
              <>
                <CasStat icon={<KitIcon name="up" />} value={rankLetter(rank)} label={t('hall.rank')} />
                <CasStat icon={<KitIcon name="token" />} value={fmt(tokens)} label={t('hall.tokens')} />
              </>
            }
            play={t('hall.play')}
            onClick={() => go('/prison')}
          />
        </div>
        <p className="hall-note px-dark px-shadow">{t('hall.note')}</p>
      </div>
      {settingsOpen && <GameSettings onClose={() => setSettingsOpen(false)} />}
    </GameScreen>
  );
}

/** Карточка игры: вся — одна кнопка; «Играть» внутри только нарисована. */
function HallCard({
  title,
  art,
  tags,
  facts,
  play,
  autoFocus,
  onClick,
}: {
  title: string;
  art: ReactNode;
  tags: string[];
  facts: ReactNode;
  play: string;
  /** Первая цель фокуса с клавиатуры и геймпада. */
  autoFocus?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hall-card px-f"
      data-autofocus={autoFocus ? '' : undefined}
      onClick={onClick}
    >
      <span className="hall-card__art pxk-frame-obsidian px-nofill px-stage pxt-stone" aria-hidden="true">
        {art}
      </span>
      <span className="hall-card__body">
        <b className="hall-card__t px-h">{title}</b>
        <span className="hall-card__tags">
          {tags.map((tag) => (
            <i key={tag} className="cas-well">
              {tag}
            </i>
          ))}
        </span>
        <span className="hall-card__facts">{facts}</span>
      </span>
      <span className="hall-card__go px-btn px-btn--gold" aria-hidden="true">
        {play}
        <KitIcon name="right" />
      </span>
    </button>
  );
}
