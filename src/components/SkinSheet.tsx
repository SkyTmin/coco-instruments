// Выбор скина. Скин общий для обеих игр (лежит в сторе как `slotsSkin`),
// поэтому и лист один на всех — «Слоты» и «Каскад» показывают его одинаково.

import { Sheet } from '@/components/ui';
import { IconLock } from '@/components/icons';
import { SKINS, symbolSrc } from '@/lib/skins';
import type { SkinId } from '@/lib/skins';
import { SKIN_UNLOCK, isSkinUnlocked } from '@/lib/slots-meta';
import { useFinanceStore } from '@/store';
import { levelFromXp } from '@/lib/slots-meta';
import { selectionChanged } from '@/lib/haptics';

export function SkinSheet({ onClose }: { onClose: () => void }) {
  const skin = useFinanceStore((s) => s.slotsSkin);
  const xp = useFinanceStore((s) => s.slotsXp);
  const setPrefs = useFinanceStore((s) => s.setSlotsPrefs);
  const level = levelFromXp(xp).level;

  const pick = (id: SkinId) => {
    selectionChanged();
    setPrefs({ skin: id });
    onClose();
  };

  return (
    <Sheet title="Скины автомата" onClose={onClose}>
      <div className="skin-grid">
        {SKINS.map((sk) => {
          const unlocked = isSkinUnlocked(sk.id, level);
          return (
            <button
              key={sk.id}
              className={`skin-card${sk.id === skin ? ' is-active' : ''}${
                unlocked ? '' : ' is-locked'
              }`}
              data-skin={sk.id}
              disabled={!unlocked}
              onClick={() => pick(sk.id)}
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
  );
}
