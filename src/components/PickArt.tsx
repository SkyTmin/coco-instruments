// Кирка с редкостью (v2.67): чем реже, тем ярче. Лестница эффектов — по
// ступеням `lib/rarity.ts`. Сама кирка — пиксельная полоса (`lib/props-pixel/picks.ts`):
// значок `icon-<i>` в списках, вращение `spin-<i>` на пьедестале; блёстки, аура и руны
// запечены в полосу, CSS даёт только мягкий фон — свечение, лучи, столб.

import type { CSSProperties, ReactNode } from 'react';
import { PxStrip } from '@/components/PxStrip';
import { PICKS } from '@/lib/prison';
import { FX_PILLAR, FX_RAYS, rarityOf } from '@/lib/rarity';

/** Доля стороны `PickArt`, которую занимает рамка рисунка (остальное — ореол). */
export const PICK_ART = 0.8;
/** С какой стороны рамки (CSS-пикселей) кирка вращается, а не стоит значком. */
const SPIN_MIN = 96;

/** Переменные цвета ступени для CSS: рамка, свет, тень. */
export function rarityVars(rarity: number): CSSProperties {
  const r = rarityOf(rarity);
  return { '--rc': r.color, '--rl': r.light, '--rd': r.dark } as CSSProperties;
}

/** Пиксельный значок кирки (кадр 0 вращения, без блёсток) — для списков и лестницы. */
export function PickPx({ pick, size }: { pick: number; size: number }) {
  const i = Math.max(0, Math.min(PICKS.length - 1, pick));
  return <PxStrip set="picks" name={`icon-${i}`} size={size} mode="still" />;
}

/**
 * Большая кирка — на пьедестале кузницы и в сцене выковки. `fx` выключает
 * живые слои (для списков, где таких кирок много): тогда — значок.
 */
export function PickArt({
  pick,
  size = 120,
  fx = true,
  dim = false,
  className,
}: {
  pick: number;
  size?: number;
  fx?: boolean;
  /** Ещё не выкована: силуэт в цвете ступени. */
  dim?: boolean;
  className?: string;
}) {
  const i = Math.max(0, Math.min(PICKS.length - 1, pick));
  const rar = PICKS[i].rarity;
  const live = fx && !dim;
  const art = Math.round(size * PICK_ART);
  const spin = live && art >= SPIN_MIN;
  return (
    <span
      className={`pkart r${rar}${dim ? ' is-dim' : ''}${live ? ' is-live' : ''}${className ? ` ${className}` : ''}`}
      style={{ ...rarityVars(rar), width: size, height: size }}
      aria-hidden="true"
    >
      {live && rar >= FX_PILLAR && <i className="pkart__pillar" />}
      {live && rar >= FX_RAYS && <i className="pkart__rays" />}
      <i className="pkart__glow" />
      {spin ? (
        <PxStrip set="picks" name={`spin-${i}`} size={art} mode="loop" />
      ) : (
        <PickPx pick={i} size={art} />
      )}
    </span>
  );
}

/** Имя в цвете редкости: у легендарной и выше — золото и перелив. */
export function RarityName({ rarity, children }: { rarity: number; children: ReactNode }) {
  return (
    <b className={`rname r${rarity}`} style={rarityVars(rarity)}>
      {children}
    </b>
  );
}

/** Плашка ступени: «Эпическая». */
export function RarityChip({ rarity }: { rarity: number }) {
  return (
    <span className={`rchip r${rarity}`} style={rarityVars(rarity)}>
      {rarityOf(rarity).name}
    </span>
  );
}
