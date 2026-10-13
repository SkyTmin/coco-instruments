import { useRef, useState } from 'react';
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
import { Bar, usePress } from '@/ui-px';
import { fmtCompact, fmtNum as fmt, skinText, useT } from '@/i18n';
import { GameSettings } from '@/settings';
import { CasRound, CasStat, KitIcon, useCasLayout } from './casino-ui';

/**
 * Казино — здание двора (v2.66). Каторга — главная игра, автоматы — её
 * дополнение на тех же монетах: сюда приходят рискнуть заработанным в шахте.
 * Бесплатных денег здесь больше нет — ни лесенки, ни колеса, ни наград.
 *
 * UI v2 (K, K2): зал — пусковая панель. Сверху общий кошелёк и уровень казино,
 * под ним две большие карточки — «Слоты» и «Каскад»: картинка, два главных
 * факта числом и «Играть». «Каторга» — тонкая строка под ними (она дублировала
 * «Назад» и съедала треть зала). Стрелками/крестовиной — по карточкам,
 * Enter/«A» — войти.
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

  const sym = (id: SlotSymbolId, i: number) => (
    <img key={i} src={symbolSrc(skin, id)} alt="" loading="lazy" decoding="async" />
  );
  // Рекорды — общей короткой записью игры (fmtCompact: «18 тыс.», «1,2 млн»), точное — в
  // подсказке. Кошелёк — точный.
  const coins = (n: number) => (
    <>
      {fmtCompact(n)}
      <CoinIcon size={16} />
    </>
  );

  return (
    <GameScreen
      className="gx cas-hall"
      bg={<div className="cas-ground pxt-stone" />}
      top={
        <GameTop
          title={t('hall.title')}
          onBack={() => nav(-1)}
          right={
            <>
              <AudioToggles />
              <CasRound
                aria-label={t('common.settings')}
                onClick={() => {
                  tapLight();
                  setSettingsOpen(true);
                }}
              >
                <KIcon name="gear" />
              </CasRound>
            </>
          }
        />
      }
    >
      <div className="hall px" data-lay={lay}>
        {/* Общий кошелёк: те же монеты, что в шахте, и уровень казино. */}
        <section className="hall-wallet" aria-label={t('hall.wallet')}>
          {/* Ширина числа — под максимум (11 знаков): уровень рядом не едет, пока
              баланс докручивается. */}
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
            art={
              <span className="hall-card__syms">
                {(
                  [
                    'cherry',
                    'lemon',
                    'bell',
                    'seven',
                    'seven',
                    'seven',
                    'star',
                    'grape',
                    'diamond',
                  ] as const
                ).map(sym)}
              </span>
            }
            tags={[t('hall.reels', { n: 3 }), t('hall.lines', { n: 5 })]}
            facts={
              <>
                <CasStat
                  fit
                  icon={<KitIcon name="play" />}
                  value={fmt(slotsSpins)}
                  label={t('slots.statSpins')}
                  tip={`${t('slots.statSpins')}: ${fmt(slotsSpins)}`}
                />
                <CasStat
                  fit
                  tone="gold"
                  icon={<KitIcon name="star" />}
                  value={coins(slotsBest)}
                  label={t('slots.statBestWin')}
                  tip={`${t('slots.statBestWin')}: ${fmt(slotsBest)}`}
                />
              </>
            }
            play={t('hall.play')}
            onClick={() => go('/slots')}
          />
          <HallCard
            title={t('hall.cascade')}
            art={
              <span className="hall-card__syms">
                {(
                  [
                    'diamond',
                    'grape',
                    'cherry',
                    'bell',
                    'diamond',
                    'star',
                    'diamond',
                    'lemon',
                    'grape',
                  ] as const
                ).map(sym)}
              </span>
            }
            tags={[
              t('hall.grid', { cols: SCATTER_COLS, rows: SCATTER_ROWS }),
              t('hall.orbsUpTo', { x: 500 }),
            ]}
            facts={
              <>
                <CasStat
                  fit
                  icon={<KitIcon name="play" />}
                  value={fmt(scatterSpins)}
                  label={t('slots.session.spins')}
                  tip={`${t('slots.session.spins')}: ${fmt(scatterSpins)}`}
                />
                <CasStat
                  fit
                  tone="gold"
                  icon={<KitIcon name="star" />}
                  value={coins(scatterBest)}
                  label={t('slots.hud.best')}
                  tip={`${t('slots.hud.best')}: ${fmt(scatterBest)}`}
                />
              </>
            }
            play={t('hall.play')}
            onClick={() => go('/scatter')}
          />
        </div>
        <HallRow
          title={t('hall.prison')}
          rank={rankLetter(rank)}
          rankTip={t('hall.rank')}
          tokens={fmtCompact(tokens)}
          tokensTip={`${t('hall.tokens')}: ${fmt(tokens)}`}
          play={t('hall.play')}
          onClick={() => go('/prison')}
        />
        <p className="hall-note">{t('hall.note')}</p>
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
  // Нажатие видно в первый же кадр (`.is-down` на pointerdown): переход на экран игры
  // случается после отпускания, и `:active` на телефоне до него не доживал.
  const ref = useRef<HTMLButtonElement>(null);
  const press = usePress(ref);
  return (
    <button
      ref={ref}
      type="button"
      {...press}
      className="hall-card px-f"
      data-autofocus={autoFocus ? '' : undefined}
      onClick={onClick}
    >
      <span
        className="hall-card__art pxk-frame-obsidian px-nofill px-stage pxt-stone"
        aria-hidden="true"
      >
        {art}
      </span>
      <span className="hall-card__body">
        {/* Длинное имя скина («Nuit des citrouilles») — шрифт на ступень меньше и две строки,
            а не многоточие. */}
        <b className={`hall-card__t px-h${title.length > 10 ? ' is-long' : ''}`}>{title}</b>
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

/** «Каторга» — тонкая строка под автоматами: обложка, имя, ранг, токены, стрелка. */
function HallRow({
  title,
  rank,
  rankTip,
  tokens,
  tokensTip,
  play,
  onClick,
}: {
  title: string;
  rank: string;
  rankTip: string;
  tokens: string;
  tokensTip: string;
  play: string;
  onClick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = usePress(ref);
  return (
    <button
      ref={ref}
      type="button"
      {...press}
      className="hall-row px-f"
      aria-label={`${title} · ${rankTip}: ${rank} · ${play}`}
      onClick={onClick}
    >
      {/* The rank letter sits on the cover as a corner badge: beside the name it took 36 px and
          cut «Каторга» mid-letter at 360 px. */}
      <span className="hall-row__art pxk-frame-obsidian px-nofill" data-tip={rankTip}>
        <img src="/ui/areas/mouth.png" alt="" loading="lazy" decoding="async" />
        <b className="hall-row__rank px-num" aria-hidden="true">
          {rank}
        </b>
      </span>
      <b className="hall-row__t px-h">{title}</b>
      <span className="hall-row__fact" data-tip={tokensTip}>
        <KitIcon name="token" />
        <b className="px-num">{tokens}</b>
      </span>
      <span className="hall-row__go px-btn px-btn--gold" aria-hidden="true">
        <KitIcon name="right" />
      </span>
    </button>
  );
}
