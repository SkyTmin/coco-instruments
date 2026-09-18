import { useNavigate } from 'react-router-dom';
import { AnimatedNumber, Screen } from '@/components/ui';
import { CoinIcon } from '@/components/slot-art';
import { IconGift } from '@/components/icons';
import { useFinanceStore } from '@/store';
import { skinOf, symbolSrc } from '@/lib/skins';
import { levelFromXp } from '@/lib/slots-meta';
import { CLUSTER_MIN, FREE_SPINS, SCATTER_COLS, SCATTER_ROWS } from '@/lib/scatter';
import { COMBO_LADDER } from '@/lib/slots';
import type { SlotSymbolId } from '@/lib/slots';
import { tapLight } from '@/lib/haptics';

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * Зал игр. Кошелёк, уровень и награды общие, поэтому баланс живёт здесь —
 * над обеими играми, а не дублируется на каждой плитке главного экрана.
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

  const level = levelFromXp(xp);
  const theme = skinOf(skin);

  const go = (path: string) => {
    tapLight();
    nav(path);
  };

  const preview = (ids: SlotSymbolId[]) => (
    <span className="game-card__reels">
      {ids.map((id) => (
        <img key={id} src={symbolSrc(skin, id)} width={30} height={30} alt="" />
      ))}
    </span>
  );

  return (
    <Screen title="Игры" subtitle="Один кошелёк на оба автомата" className={`slots-screen slots-screen--${skin}`}>
      <div className="stack slots games" data-skin={skin}>
        <div className="slots-scene" aria-hidden="true">
          <span className="slots-scene__decor" />
        </div>

        <div className="slot-hud">
          <div className="slot-hud__cell">
            <span className="slot-hud__label">Баланс</span>
            <span className="slot-hud__value">
              <AnimatedNumber value={balance} format={(n) => fmt(n)} duration={450} />
              <CoinIcon size={18} />
            </span>
          </div>
          <div className="slot-hud__cell">
            <span className="slot-hud__label">Уровень</span>
            <span className="slot-hud__value">
              {level.level}
              {freeSpins > 0 && <span className="slot-level__free">🎟 {freeSpins}</span>}
            </span>
          </div>
        </div>

        <button className="game-card" onClick={() => go('/slots')}>
          {preview(['seven', 'star', 'bell'])}
          <span className="game-card__body">
            <b>{theme.title}</b>
            <i>Три барабана, пять линий, каскады до ×{COMBO_LADDER[COMBO_LADDER.length - 1]}</i>
            <em>
              {slotsSpins ? `${fmt(slotsSpins)} вращений · лучший ${fmt(slotsBest)}` : 'Классика'}
            </em>
          </span>
        </button>

        <button className="game-card" onClick={() => go('/scatter')}>
          {preview(['diamond', 'grape', 'cherry'])}
          <span className="game-card__body">
            <b>Каскад</b>
            <i>
              Поле {SCATTER_COLS}×{SCATTER_ROWS}, {CLUSTER_MIN} одинаковых где угодно, сферы до ×500
              и {FREE_SPINS} фриспинов
            </i>
            <em>
              {scatterSpins
                ? `${fmt(scatterSpins)} вращений · лучший ${fmt(scatterBest)}`
                : 'Большое поле'}
            </em>
          </span>
        </button>

        <button className="btn btn--block rewards-cta" onClick={() => go('/slots')}>
          <IconGift size={18} />
          Награды, уровень и скины
        </button>

        <p className="muted" style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>
          Монеты виртуальные: купить их нельзя. Баланс, опыт, цели дня и бесплатные вращения общие
          для обеих игр.
        </p>
      </div>
    </Screen>
  );
}
