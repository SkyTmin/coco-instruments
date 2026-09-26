// Кирка с редкостью (v2.67): чем реже, тем ярче. Лестница эффектов — по
// ступеням `lib/rarity.ts`: рамка → свечение → блик → искры → лучи → аура →
// столб света. Всё движется только прозрачностью и поворотом (бюджет кадра
// в CLAUDE.md): вращающийся слой рисуется один раз и крутится трансформом.

import type { CSSProperties, ReactNode } from 'react';
import { PICKS } from '@/lib/prison';
import { FX_AURA, FX_PILLAR, FX_RAYS, FX_SHINE, FX_SPARKS, rarityOf } from '@/lib/rarity';

/**
 * Картинка кирки. v2.69 — рендер 3D-модели 640 px (scripts/picks-render):
 * прежние 64 px из Kenney Voxel Pack на пьедестале растягивались вдесятеро.
 * Новый каталог, а не те же имена: старые картинки сидят в прекеше
 * service worker, и телефон показывал бы их до переустановки воркера.
 */
export const pickSrc = (i: number) => `/ui/picks/v2/p${i}.webp`;

/** Переменные цвета ступени для CSS: рамка, свет, тень. */
export function rarityVars(rarity: number): CSSProperties {
  const r = rarityOf(rarity);
  return { '--rc': r.color, '--rl': r.light, '--rd': r.dark } as CSSProperties;
}

/**
 * Большая кирка — на пьедестале кузницы и в сцене выковки. `fx` выключает
 * живые слои (для списков, где таких кирок много).
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
  return (
    <span
      className={`pkart r${rar}${dim ? ' is-dim' : ''}${live ? ' is-live' : ''}${className ? ` ${className}` : ''}`}
      style={
        {
          ...rarityVars(rar),
          width: size,
          height: size,
          '--pkimg': `url(${pickSrc(i)})`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {live && rar >= FX_PILLAR && <i className="pkart__pillar" />}
      {live && rar >= FX_RAYS && <i className="pkart__rays" />}
      <i className="pkart__glow" />
      {live && rar >= FX_AURA && (
        <i className="pkart__aura">
          {Array.from({ length: 6 }, (_, k) => (
            <b key={k} style={{ '--k': k } as CSSProperties} />
          ))}
        </i>
      )}
      <img src={pickSrc(i)} alt="" draggable={false} />
      {live && rar >= FX_SHINE && <i className="pkart__shine" />}
      {live && rar >= FX_SPARKS && (
        <i className="pkart__sparks">
          {Array.from({ length: 4 }, (_, k) => (
            <b key={k} style={{ '--k': k } as CSSProperties} />
          ))}
        </i>
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
