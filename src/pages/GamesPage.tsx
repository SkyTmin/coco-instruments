import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/ui';
import { GameTop, KIcon } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import { skinOf, symbolSrc } from '@/lib/skins';
import { levelFromXp } from '@/lib/slots-meta';
import { SCATTER_COLS, SCATTER_ROWS } from '@/lib/scatter';
import type { SlotSymbolId } from '@/lib/slots';
import { tapLight } from '@/lib/haptics';
import { useGameAudio } from '@/lib/use-game-audio';
import { AudioToggles } from '@/components/AudioToggles';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Казино — здание двора (v2.66). Каторга — главная игра, автоматы — её
 * дополнение на тех же монетах: сюда приходят рискнуть заработанным в шахте.
 * Бесплатных денег здесь больше нет — ни лесенки, ни колеса, ни наград.
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

  useGameAudio('hall');
  const level = levelFromXp(xp);
  const theme = skinOf(skin);

  const go = (path: string) => {
    tapLight();
    nav(path);
  };

  const reels = (ids: SlotSymbolId[]) =>
    ids.map((id) => <img key={id} src={symbolSrc(skin, id)} alt="" />);

  return (
    <div className="gx gxh">
      <div className="yard-scene-bg" aria-hidden="true" />
      <div className="gxh__wrap">
        <GameTop
          title="Казино"
          onBack={() => nav(-1)}
          right={<AudioToggles />}
          chips={
            <>
              <span className="gx-chip">
                <CoinIcon size={18} />
                <AnimatedNumber value={balance} format={(n) => fmt(n)} duration={450} />
              </span>
              <span className="gx-chip">
                <KIcon name="star" size={16} /> {level.level} ур.
              </span>
            </>
          }
        />

        <GameCard
          title={theme.title}
          art={<span className="gxh-card__reels">{reels(['seven', 'star', 'bell'])}</span>}
          tags={['3 барабана', '5 линий']}
          stat={slotsSpins ? `${fmt(slotsSpins)} спинов · лучший ${fmt(slotsBest)}` : null}
          onClick={() => go('/slots')}
        />
        <GameCard
          title="Каскад"
          art={<span className="gxh-card__reels">{reels(['diamond', 'grape', 'cherry'])}</span>}
          tags={[`Поле ${SCATTER_COLS}×${SCATTER_ROWS}`, 'Сферы до ×500']}
          stat={scatterSpins ? `${fmt(scatterSpins)} спинов · лучший ${fmt(scatterBest)}` : null}
          onClick={() => go('/scatter')}
        />
        <p className="gxh__note">Те же монеты, что в шахте. Купить их нельзя — только заработать</p>
      </div>
    </div>
  );
}

function GameCard({
  title,
  art,
  tags,
  stat,
  dark,
  onClick,
}: {
  title: string;
  art: ReactNode;
  tags: string[];
  stat: string | null;
  dark?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="gx-panel gx-panel--wood-fancy gxh-card" onClick={onClick}>
      <span className={`gxh-card__art${dark ? ' is-dark' : ''}`}>{art}</span>
      <span className="gxh-card__body">
        <b>{title}</b>
        <span className="gxh-card__tags">
          {tags.map((t) => (
            <i key={t}>{t}</i>
          ))}
        </span>
        {stat && <em>{stat}</em>}
      </span>
      <span className="gx-round gx-round--red gxh-card__go" aria-hidden="true">
        <KIcon name="arrowRight" />
      </span>
    </button>
  );
}
