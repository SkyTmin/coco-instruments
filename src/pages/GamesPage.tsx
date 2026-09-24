import { useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/ui';
import { GameTop, GxIcon, KIcon } from '@/components/gx';
import { CoinIcon } from '@/components/slot-art';
import { useFinanceStore } from '@/store';
import { skinOf, symbolSrc } from '@/lib/skins';
import { levelFromXp } from '@/lib/slots-meta';
import { SCATTER_COLS, SCATTER_ROWS } from '@/lib/scatter';
import type { SlotSymbolId } from '@/lib/slots';
import { tapLight } from '@/lib/haptics';
import { rankLetter } from '@/lib/prison';
import { rockTexture } from '@/lib/prison-art';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Зал игр. Кошелёк, уровень и награды общие, поэтому баланс живёт здесь —
 * над всеми играми, а не дублируется на каждой плитке главного экрана.
 */
export function GamesPage() {
  const nav = useNavigate();
  const balance = useFinanceStore((s) => s.slotsBalance);
  const freeSpins = useFinanceStore((s) => s.slotsFreeSpins);
  const xp = useFinanceStore((s) => s.slotsXp);
  const skin = useFinanceStore((s) => s.slotsSkin);
  const slotsSpins = useFinanceStore((s) => s.slotsSpins);
  const slotsBest = useFinanceStore((s) => s.slotsBest);
  const scatterSpins = useFinanceStore((s) => s.scatterSpins);
  const scatterBest = useFinanceStore((s) => s.scatterBest);
  const prison = useFinanceStore((s) => s.prison);

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
          title="Игры"
          onBack={() => nav(-1)}
          chips={
            <>
              <span className="gx-chip">
                <CoinIcon size={18} />
                <AnimatedNumber value={balance} format={(n) => fmt(n)} duration={450} />
              </span>
              <span className="gx-chip">
                <KIcon name="star" size={16} /> {level.level} ур.
              </span>
              {freeSpins > 0 && (
                <span className="gx-chip">
                  <GxIcon name="slots" size={16} /> {freeSpins}
                </span>
              )}
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
        <GameCard
          title="Каторга"
          dark
          art={
            <span className="gxh-card__reels gxh-card__reels--rocks">
              {[14, 23, 25].map((r) => (
                <img key={r} src={rockTexture(r)} alt="" />
              ))}
            </span>
          }
          tags={['Шахта', 'Лес', 'Подземелье']}
          stat={prison.mined ? `Ранг ${rankLetter(prison.rank)}` : null}
          onClick={() => go('/yard')}
        />

        <button
          type="button"
          className="gx-btn gx-btn--red gx-btn--big gx-btn--block"
          onClick={() => go('/slots')}
        >
          <GxIcon name="gift" /> Награды и скины
        </button>
        <p className="gxh__note">Монеты виртуальные — купить их нельзя</p>
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
