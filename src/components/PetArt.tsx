// Питомец (v2.72): портрет из ChatGPT (или силуэт-заглушка, пока портрета
// нет), манера движения вида, ореол редкости, золотой и радужный варианты,
// частицы (огонь, иней, искры, звёзды) и радость на ласку.
//
// Движется только трансформ и прозрачность (см. «Бюджет кадра» в
// CLAUDE.md). Портрет один, поэтому у каждого вида своя манера движения
// всей фигуры, а не лап: кто скачет, кто переваливается, кто парит.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { rarityVars } from '@/components/PickArt';
import { eggOf, petOf } from '@/lib/pets';
import type { EggId, PetId } from '@/lib/pets';

/**
 * Какие портреты уже нарисованы (`public/ui/pets/<id>.webp`) и у кого есть
 * второй кадр с закрытыми глазами (`<id>-happy.webp`) — он даёт моргание и
 * радость на ласку. Пока портрета нет — силуэт game-icons в цвете вида.
 */
export const PET_PORTRAIT: Partial<Record<PetId, { happy: boolean }>> = {};

/** Рассинхрон: у каждого вида своя фаза, чтобы отряд не дышал хором. */
function phase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

export function PetArt({
  id,
  size = 72,
  v = 0,
  ghost = false,
  still = false,
  fx,
  joy = 0,
  className,
  onClick,
}: {
  id: PetId;
  size?: number;
  /** 0 — обычный, 1 — золотой, 2 — радужный. */
  v?: number;
  /** Ещё не приручён: тёмный силуэт без движения. */
  ghost?: boolean;
  /** Без движения (списки, где таких много). */
  still?: boolean;
  /** Частицы вида; по умолчанию — с 64 px. */
  fx?: boolean;
  /** Меняется — питомец радуется (прыжок, сердечки, глаза закрыты). */
  joy?: number;
  className?: string;
  onClick?: () => void;
}) {
  const def = petOf(id);
  const art = PET_PORTRAIT[id];
  const [happy, setHappy] = useState(false);
  const first = useRef(joy);
  useEffect(() => {
    if (joy === first.current) return undefined;
    setHappy(false);
    // Кадр без класса — чтобы анимация радости переиграла с начала.
    const raf = requestAnimationFrame(() => setHappy(true));
    const t = setTimeout(() => setHappy(false), 900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [joy]);
  const showFx = !ghost && (fx ?? size >= 64) && !!def.fx;
  const cls = [
    'pet',
    `pet--${def.motion}`,
    `r${def.rarity}`,
    v ? `v${v}` : '',
    ghost ? 'is-ghost' : '',
    still || ghost ? 'is-still' : '',
    happy ? 'is-joy' : '',
    art ? 'has-art' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const style = {
    ...rarityVars(def.rarity),
    '--ps': `${size}px`,
    '--pd': `${-phase(id) * 6}s`,
    '--tint': def.tint,
    '--pimg': art ? `url(/ui/pets/${id}.webp)` : `url(/ui/icons/${def.icon}.svg)`,
  } as CSSProperties;
  return (
    <span
      className={cls}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={ghost ? undefined : def.name}
    >
      {!ghost && def.rarity >= 1 && <i className="pet__aura" aria-hidden="true" />}
      {!ghost && (v === 2 || def.rarity >= 4) && <i className="pet__rays" aria-hidden="true" />}
      <span className="pet__joy">
        <span className="pet__body">
          <span className="pet__breath">
            {art ? (
              <>
                <img className="pet__img" src={`/ui/pets/${id}.webp`} alt="" draggable={false} />
                {art.happy && (
                  <img
                    className="pet__img pet__img--happy"
                    src={`/ui/pets/${id}-happy.webp`}
                    alt=""
                    draggable={false}
                  />
                )}
              </>
            ) : (
              <i className="pet__silw" aria-hidden="true">
                <i className="pet__sil" />
              </i>
            )}
            {!ghost && v > 0 && <i className="pet__shine" aria-hidden="true" />}
          </span>
        </span>
      </span>
      {showFx && (
        <span className={`pet__fx pet__fx--${def.fx}`} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
      {happy && (
        <span className="pet__hearts" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

/** Яйцо: 3D-рендер вида (`scripts/eggs-render`). */
export function EggArt({
  egg,
  size = 72,
  className,
}: {
  egg: EggId;
  size?: number;
  className?: string;
}) {
  return (
    <img
      className={`pegg-img${className ? ` ${className}` : ''}`}
      src={`/ui/eggs/${egg}.webp`}
      width={size}
      height={size}
      alt={eggOf(egg).name}
      draggable={false}
    />
  );
}
