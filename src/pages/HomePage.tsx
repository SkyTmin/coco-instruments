import { useNavigate } from 'react-router-dom';
import { Screen } from '@/components/ui';
import { IconShirt, IconWallet } from '@/components/icons';
import { tapLight } from '@/lib/haptics';

export function HomePage() {
  const navigate = useNavigate();
  const go = (path: string) => {
    tapLight();
    navigate(path);
  };

  return (
    <Screen title="Coco" subtitle="Личный помощник">
      <div className="home-grid">
        <div className="home-card" onClick={() => go('/finance')} role="button">
          <div className="home-card__glow" />
          <div className="home-card__icon">
            <IconWallet />
          </div>
          <div>
            <div className="home-card__title">Финансы</div>
            <div className="home-card__desc">Расходы, кредиты, рассрочки и накопления</div>
          </div>
        </div>

        <div className="home-card is-muted" onClick={() => go('/clothing')} role="button">
          <div className="home-card__badge">Скоро</div>
          <div className="home-card__icon">
            <IconShirt />
          </div>
          <div>
            <div className="home-card__title">Одежда</div>
            <div className="home-card__desc">Раздел в разработке</div>
          </div>
        </div>
      </div>
    </Screen>
  );
}
